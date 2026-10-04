// =============================================================================
// SERVER-SIDE AST MUTATION EXECUTOR
//
// Invariant: AI models return structured AstFixPlan operations.
// This engine parses the target syntax tree, applies operations, re-parses
// to verify syntax validity, and serializes the modified source code.
//
// Zero fallbacks to regex or string manipulation. Unsupported operations fail closed.
// Display-only unified diffs are produced strictly for presentation.
// =============================================================================

import { Project, SyntaxKind, ObjectLiteralExpression, Node } from "ts-morph";
import { parse as parseHtml, HTMLElement } from "node-html-parser";
import { createHash } from "crypto";
import type { AstFixPlan, PreparedAstChange, AstOperation } from "./types";
import { logger } from "@/lib/logger";

// ── Unified Diff Generator (Display-only presentation helper) ────────────────

export function generateDisplayUnifiedDiff(
  original: string,
  modified: string,
  filePath: string,
): string {
  const origLines = original.replace(/\r\n/g, "\n").split("\n");
  const modLines = modified.replace(/\r\n/g, "\n").split("\n");

  const diffLines: string[] = [
    `--- a/${filePath}`,
    `+++ b/${filePath}`,
    `@@ -1,${origLines.length} +1,${modLines.length} @@`,
  ];

  let lineCount = 0;
  for (let i = 0; i < Math.max(origLines.length, modLines.length); i++) {
    const orig = origLines[i];
    const mod = modLines[i];

    if (orig !== undefined && mod !== undefined) {
      if (orig === mod) {
        if (lineCount < 50) diffLines.push(` ${orig}`);
      } else {
        diffLines.push(`-${orig}`);
        diffLines.push(`+${mod}`);
      }
    } else if (orig !== undefined) {
      diffLines.push(`-${orig}`);
    } else if (mod !== undefined) {
      diffLines.push(`+${mod}`);
    }
    lineCount++;
  }

  return diffLines.join("\n");
}

/** Compute SHA256 of string */
function computeSha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

// ── Robots.txt Directive AST Model & Application ─────────────────────────────

interface RobotsRule {
  directive: "Allow" | "Disallow";
  path: string;
}

interface RobotsGroup {
  userAgent: string;
  rules: RobotsRule[];
}

interface RobotsAst {
  groups: RobotsGroup[];
  sitemaps: string[];
}

function parseRobotsAst(content: string): RobotsAst {
  const ast: RobotsAst = { groups: [], sitemaps: [] };
  let currentGroup: RobotsGroup | null = null;

  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim().toLowerCase();
    const val = trimmed.slice(colonIdx + 1).trim();

    if (key === "user-agent") {
      currentGroup = { userAgent: val, rules: [] };
      ast.groups.push(currentGroup);
    } else if (key === "disallow" || key === "allow") {
      const directive = key === "disallow" ? "Disallow" : "Allow";
      if (!currentGroup) {
        currentGroup = { userAgent: "*", rules: [] };
        ast.groups.push(currentGroup);
      }
      currentGroup.rules.push({ directive, path: val });
    } else if (key === "sitemap") {
      ast.sitemaps.push(val);
    }
  }

  return ast;
}

function serializeRobotsAst(ast: RobotsAst): string {
  const lines: string[] = [];
  for (const group of ast.groups) {
    lines.push(`User-agent: ${group.userAgent}`);
    for (const rule of group.rules) {
      lines.push(`${rule.directive}: ${rule.path}`);
    }
    lines.push("");
  }
  for (const sitemap of ast.sitemaps) {
    lines.push(`Sitemap: ${sitemap}`);
  }
  return lines.join("\n").trim() + "\n";
}

function applyRobotsAstOperations(
  sourceCode: string,
  filePath: string,
  operations: AstOperation[],
): string {
  const ast = parseRobotsAst(sourceCode);

  for (const op of operations) {
    if (op.kind === "setRobotsDirective") {
      let group = ast.groups.find(
        (g) => g.userAgent.toLowerCase() === op.userAgent.toLowerCase(),
      );
      if (!group) {
        group = { userAgent: op.userAgent, rules: [] };
        ast.groups.push(group);
      }
      const existing = group.rules.find(
        (r) => r.directive === op.directive && r.path === op.path,
      );
      if (!existing) {
        group.rules.push({ directive: op.directive, path: op.path });
      }
    } else if (op.kind === "removeRobotsDirective") {
      const group = ast.groups.find(
        (g) => g.userAgent.toLowerCase() === op.userAgent.toLowerCase(),
      );
      if (group) {
        group.rules = group.rules.filter(
          (r) => !(r.directive === op.directive && r.path === op.path),
        );
      }
    } else {
      throw new Error(
        `AST_MUTATION_UNSUPPORTED: Operation kind '${(op as any).kind}' is not supported for robots.txt.`,
      );
    }
  }

  return serializeRobotsAst(ast);
}

// ── XML AST Application ─────────────────────────────────────────────────────

function applyXmlAstOperations(
  sourceCode: string,
  filePath: string,
  operations: AstOperation[],
): string {
  if (!sourceCode.trim().startsWith("<?xml") && !sourceCode.trim().startsWith("<")) {
    throw new Error(`AST_PARSE_FAILED: File ${filePath} is not a valid XML document.`);
  }

  const root = parseHtml(sourceCode, { comment: true });

  for (const op of operations) {
    if (op.kind === "setXmlNode") {
      const nodes = root.querySelectorAll(op.targetTag);
      if (nodes.length === 0) {
        throw new Error(`AST_TARGET_NOT_FOUND: XML tag '${op.targetTag}' not found in ${filePath}`);
      }
      let targetNodes: HTMLElement[] = [];
      if (nodes.length > 1) {
        if (op.occurrence !== undefined) {
          if (op.occurrence < 1 || op.occurrence > nodes.length) {
            throw new Error(`AST_TARGET_NOT_FOUND: Occurrence ${op.occurrence} of XML tag '${op.targetTag}' out of range (${nodes.length} found)`);
          }
          targetNodes = [nodes[op.occurrence - 1]];
        } else if (op.allMatches === true) {
          targetNodes = nodes;
        } else {
          throw new Error(`AST_TARGET_AMBIGUOUS: XML tag '${op.targetTag}' matched ${nodes.length} elements in ${filePath}. Specify occurrence or set allMatches: true.`);
        }
      } else {
        targetNodes = nodes;
      }
      for (const n of targetNodes) {
        n.set_content(op.value);
      }
    } else {
      throw new Error(`AST_MUTATION_UNSUPPORTED: Operation kind '${(op as any).kind}' is not supported for XML.`);
    }
  }

  return root.toString();
}

/** Compute strict AST structural fingerprint without string fallbacks */
function computeAstFingerprint(code: string, language: string): string {
  try {
    if (language === "typescript" || language === "tsx" || language === "javascript" || language === "jsx") {
      const project = new Project({ useInMemoryFileSystem: true, compilerOptions: { allowJs: true, jsx: 1 } });
      const sf = project.createSourceFile("fp_temp.tsx", code);
      const tokens: string[] = [];
      sf.forEachDescendant((node) => {
        const k = node.getKindName();
        if (k !== "WhitespaceTrivia" && k !== "SingleLineCommentTrivia" && k !== "MultiLineCommentTrivia") {
          if (Node.isIdentifier(node) || Node.isPropertyAssignment(node)) {
            tokens.push(`${k}:${node.getText()}`);
          } else {
            tokens.push(k);
          }
        }
      });
      return createHash("sha256").update(tokens.join(";")).digest("hex");
    } else if (language === "html" || language === "xml") {
      const root = parseHtml(code);
      const tokens: string[] = [];
      root.querySelectorAll("*").forEach((el) => {
        const attrs = Object.keys(el.attributes).sort().join(",");
        tokens.push(`${el.tagName}:${attrs}`);
      });
      return createHash("sha256").update(tokens.join(";")).digest("hex");
    } else if (language === "json") {
      const obj = JSON.parse(code);
      const keys = Object.keys(obj).sort().join(";");
      return createHash("sha256").update(keys).digest("hex");
    } else if (language === "robots") {
      const ast = parseRobotsAst(code);
      const summary = ast.groups.map(g => `${g.userAgent}:${g.rules.map(r=>r.directive+r.path).join(",")}`).join(";");
      return createHash("sha256").update(summary).digest("hex");
    }
  } catch (err) {
    throw new Error(`AST_FINGERPRINT_FAILED: Failed to generate AST fingerprint for language '${language}': ${(err as Error)?.message}`);
  }

  throw new Error(`AST_FINGERPRINT_FAILED: Fingerprint calculation not implemented for language '${language}'`);
}

// ── TypeScript / TSX AST Application ───────────────────────────────────────

function applyTsxAstOperations(
  sourceCode: string,
  filePath: string,
  operations: AstOperation[],
): string {
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: { allowJs: true, jsx: 1 },
  });

  const sourceFile = project.createSourceFile(filePath, sourceCode);
  const initialImports = sourceFile.getImportDeclarations().map(i => i.getText());

  for (const op of operations) {
    switch (op.kind) {
      case "setObjectProperty":
      case "insertObjectProperty": {
        let objExpr: ObjectLiteralExpression | undefined;

        // Semantic lock 1: Enforce top-level exported VariableDeclaration matching target name (e.g. export const metadata = {...})
        const exportedVarDecls = sourceFile.getVariableDeclarations().filter((v) => {
          if (v.getName() !== op.target) return false;
          const stmt = v.getFirstAncestorByKind(SyntaxKind.VariableStatement);
          const isTopLevel = v.getSourceFile() === sourceFile && (!stmt || stmt.getParent() === sourceFile);
          return isTopLevel && (v.isExported() || (stmt ? stmt.isExported() : false));
        });

        if (exportedVarDecls.length === 1) {
          const init = exportedVarDecls[0].getInitializer();
          if (Node.isObjectLiteralExpression(init)) {
            objExpr = init;
          }
        } else if (exportedVarDecls.length > 1) {
          throw new Error(
            `AST_TARGET_AMBIGUOUS: Ambiguous top-level exported target '${op.target}' in ${filePath}`,
          );
        }

        // Semantic lock 2: Target property on top-level object if not matching export directly
        if (!objExpr && op.target !== "metadata") {
          sourceFile.forEachDescendant((node) => {
            if (Node.isPropertyAssignment(node) && node.getName() === op.target) {
              const init = node.getInitializer();
              if (Node.isObjectLiteralExpression(init)) {
                objExpr = init;
              }
            }
          });
        }

        if (!objExpr) {
          throw new Error(
            `AST_TARGET_NOT_FOUND: Semantic target object '${op.target}' not found in AST of ${filePath}`,
          );
        }

        // Handle nested properties (e.g. property = "openGraph.title")
        const propParts = op.property.split(".");
        let currentObj = objExpr;
        for (let i = 0; i < propParts.length - 1; i++) {
          const part = propParts[i];
          let subProp = currentObj.getProperty(part);
          if (!subProp) {
            currentObj.addPropertyAssignment({
              name: part,
              initializer: "{}",
            });
            subProp = currentObj.getProperty(part);
          }
          if (subProp && Node.isPropertyAssignment(subProp)) {
            const init = subProp.getInitializer();
            if (Node.isObjectLiteralExpression(init)) {
              currentObj = init;
            }
          }
        }

        const targetPropName = propParts[propParts.length - 1];
        const existingProp = currentObj.getProperty(targetPropName);

        // Guard: Expected Current Value check
        if (op.expectedCurrentValue !== undefined) {
          const currentValText = existingProp ? existingProp.getText() : undefined;
          if (
            currentValText !== undefined &&
            !currentValText.includes(String(op.expectedCurrentValue))
          ) {
            throw new Error(
              `STALE_FIX_ABORTED: Current AST value for property '${op.property}' does not match expected value.`,
            );
          }
        }

        const formattedValue =
          typeof op.value === "string"
            ? JSON.stringify(op.value)
            : typeof op.value === "object"
              ? JSON.stringify(op.value, null, 2)
              : String(op.value);

        if (existingProp) {
          if (Node.isPropertyAssignment(existingProp)) {
            existingProp.setInitializer(formattedValue);
          }
        } else {
          currentObj.addPropertyAssignment({
            name: targetPropName,
            initializer: formattedValue,
          });
        }
        break;
      }

      case "removeObjectProperty": {
        let removed = false;
        sourceFile.getVariableDeclarations().forEach((node) => {
          if (node.getName() === op.target) {
            const init = node.getInitializer();
            if (Node.isObjectLiteralExpression(init)) {
              const prop = init.getProperty(op.property);
              if (prop) {
                prop.remove();
                removed = true;
              }
            }
          }
        });
        if (!removed) {
          throw new Error(`AST_TARGET_NOT_FOUND: Property '${op.property}' not found on '${op.target}'`);
        }
        break;
      }

      case "setJsxAttribute": {
        const targetTag = op.elementTag || op.componentName;
        if (!targetTag) {
          throw new Error(`AST_TARGET_AMBIGUOUS: setJsxAttribute requires an explicit elementTag or componentName target.`);
        }

        const matchingNodes: (import("ts-morph").JsxSelfClosingElement | import("ts-morph").JsxOpeningElement)[] = [];
        sourceFile.forEachDescendant((node) => {
          if (Node.isJsxSelfClosingElement(node) || Node.isJsxOpeningElement(node)) {
            const tagName = node.getTagNameNode().getText();
            if (tagName === targetTag) {
              matchingNodes.push(node);
            }
          }
        });

        if (matchingNodes.length === 0) {
          throw new Error(`AST_TARGET_NOT_FOUND: JSX element tag '${targetTag}' not found in ${filePath}`);
        }

        let selectedNodes: typeof matchingNodes = [];
        if (matchingNodes.length > 1) {
          if (op.occurrence !== undefined) {
            if (op.occurrence < 1 || op.occurrence > matchingNodes.length) {
              throw new Error(`AST_TARGET_NOT_FOUND: Occurrence ${op.occurrence} of JSX tag '${targetTag}' out of range (${matchingNodes.length} found)`);
            }
            selectedNodes = [matchingNodes[op.occurrence - 1]];
          } else if (op.allMatches === true) {
            selectedNodes = matchingNodes;
          } else {
            throw new Error(`AST_TARGET_AMBIGUOUS: Matched ${matchingNodes.length} '${targetTag}' JSX elements in ${filePath}. Specify occurrence index or set allMatches: true.`);
          }
        } else {
          selectedNodes = matchingNodes;
        }

        const valStr = typeof op.value === "string" ? `"${op.value}"` : `{${op.value}}`;
        for (const node of selectedNodes) {
          const attr = node.getAttribute(op.attributeName);
          if (attr && Node.isJsxAttribute(attr)) {
            if (op.expectedCurrentValue !== undefined) {
              const curText = attr.getInitializer()?.getText().replace(/^["']|["']$/g, "");
              if (curText !== undefined && curText !== String(op.expectedCurrentValue)) {
                throw new Error(`STALE_FIX_ABORTED: JSX attribute '${op.attributeName}' value does not match expected value.`);
              }
            }
            attr.setInitializer(valStr);
          } else {
            node.addAttribute({
              name: op.attributeName,
              initializer: valStr,
            });
          }
        }
        break;
      }

      case "removeJsxAttribute": {
        const targetTag = op.elementTag || op.componentName;
        if (!targetTag) {
          throw new Error(`AST_TARGET_AMBIGUOUS: removeJsxAttribute requires an explicit elementTag or componentName target.`);
        }

        const matchingNodes: (import("ts-morph").JsxSelfClosingElement | import("ts-morph").JsxOpeningElement)[] = [];
        sourceFile.forEachDescendant((node) => {
          if (Node.isJsxSelfClosingElement(node) || Node.isJsxOpeningElement(node)) {
            if (node.getTagNameNode().getText() === targetTag) {
              matchingNodes.push(node);
            }
          }
        });

        if (matchingNodes.length === 0) {
          throw new Error(`AST_TARGET_NOT_FOUND: JSX element tag '${targetTag}' not found in ${filePath}`);
        }

        let selectedNodes: typeof matchingNodes = [];
        if (matchingNodes.length > 1) {
          if (op.occurrence !== undefined) {
            if (op.occurrence < 1 || op.occurrence > matchingNodes.length) {
              throw new Error(`AST_TARGET_NOT_FOUND: Occurrence ${op.occurrence} of JSX tag '${targetTag}' out of range (${matchingNodes.length} found)`);
            }
            selectedNodes = [matchingNodes[op.occurrence - 1]];
          } else if (op.allMatches === true) {
            selectedNodes = matchingNodes;
          } else {
            throw new Error(`AST_TARGET_AMBIGUOUS: Matched ${matchingNodes.length} '${targetTag}' JSX elements in ${filePath}. Specify occurrence index or set allMatches: true.`);
          }
        } else {
          selectedNodes = matchingNodes;
        }

        for (const node of selectedNodes) {
          const attr = node.getAttribute(op.attributeName);
          if (attr) attr.remove();
        }
        break;
      }

      case "insertJsxElement": {
        let snippet = op.jsxSnippet;
        if (!snippet && op.tagName) {
          const attrsStr = op.attributes
            ? Object.entries(op.attributes)
                .map(([k, v]) => (typeof v === "string" ? `${k}="${v}"` : `${k}={${v}}`))
                .join(" ")
            : "";
          snippet = op.childrenText
            ? `<${op.tagName} ${attrsStr}>${op.childrenText}</${op.tagName}>`
            : `<${op.tagName} ${attrsStr} />`;
        }

        if (!snippet) throw new Error("AST_MUTATION_FAILED: insertJsxElement requires jsxSnippet or tagName");

        const targetTag = op.parentTag || op.targetSelector;
        const matchingParents: import("ts-morph").JsxElement[] = [];

        sourceFile.forEachDescendant((node) => {
          if (Node.isJsxElement(node)) {
            const tag = node.getOpeningElement().getTagNameNode().getText();
            if (!targetTag || tag === targetTag) {
              matchingParents.push(node);
            }
          }
        });

        if (matchingParents.length === 0) {
          if (targetTag) {
            throw new Error(`AST_TARGET_NOT_FOUND: Could not find parent JSX tag '${targetTag}' in ${filePath}`);
          }
          let inserted = false;
          sourceFile.forEachDescendant((node) => {
            if (!inserted && Node.isReturnStatement(node)) {
              const expr = node.getExpression();
              if (expr && Node.isJsxElement(expr)) {
                const closing = expr.getClosingElement();
                if (closing) {
                  closing.replaceWithText(`${snippet}\n${closing.getText()}`);
                  inserted = true;
                }
              } else if (expr && Node.isJsxFragment(expr)) {
                const closing = expr.getClosingFragment();
                if (closing) {
                  closing.replaceWithText(`${snippet}\n${closing.getText()}`);
                  inserted = true;
                }
              }
            }
          });
          if (!inserted) throw new Error(`AST_TARGET_NOT_FOUND: Could not find return statement JSX element in ${filePath}`);
          break;
        }

        let selectedParents: typeof matchingParents = [];
        if (matchingParents.length > 1) {
          if (op.occurrence !== undefined) {
            if (op.occurrence < 1 || op.occurrence > matchingParents.length) {
              throw new Error(`AST_TARGET_NOT_FOUND: Occurrence ${op.occurrence} of parent JSX tag '${targetTag}' out of range (${matchingParents.length} found)`);
            }
            selectedParents = [matchingParents[op.occurrence - 1]];
          } else if (op.allMatches === true) {
            selectedParents = matchingParents;
          } else {
            throw new Error(`AST_TARGET_AMBIGUOUS: Matched ${matchingParents.length} parent JSX elements for '${targetTag}' in ${filePath}. Specify occurrence index or set allMatches: true.`);
          }
        } else {
          selectedParents = matchingParents;
        }

        for (const parent of selectedParents) {
          const closing = parent.getClosingElement();
          if (closing) {
            closing.replaceWithText(`${snippet}\n${closing.getText()}`);
          }
        }
        break;
      }

      case "replaceJsxText": {
        const matchingTextNodes: import("ts-morph").JsxText[] = [];
        sourceFile.forEachDescendant((node) => {
          if (Node.isJsxText(node)) {
            if (op.targetSelector) {
              const parentTag = node.getParent() && Node.isJsxElement(node.getParent())
                ? (node.getParent() as import("ts-morph").JsxElement).getOpeningElement().getTagNameNode().getText()
                : undefined;
              if (parentTag === op.targetSelector) {
                matchingTextNodes.push(node);
              }
            } else {
              matchingTextNodes.push(node);
            }
          }
        });

        if (matchingTextNodes.length === 0) {
          throw new Error(`AST_TARGET_NOT_FOUND: JSX text node not found in ${filePath}`);
        }

        let selectedTextNodes: typeof matchingTextNodes = [];
        if (matchingTextNodes.length > 1) {
          if (op.occurrence !== undefined) {
            if (op.occurrence < 1 || op.occurrence > matchingTextNodes.length) {
              throw new Error(`AST_TARGET_NOT_FOUND: Occurrence ${op.occurrence} of JSX text node out of range (${matchingTextNodes.length} found)`);
            }
            selectedTextNodes = [matchingTextNodes[op.occurrence - 1]];
          } else if (op.allMatches === true) {
            selectedTextNodes = matchingTextNodes;
          } else {
            throw new Error(`AST_TARGET_AMBIGUOUS: Matched ${matchingTextNodes.length} JSX text nodes in ${filePath}. Specify occurrence index or set allMatches: true.`);
          }
        } else {
          selectedTextNodes = matchingTextNodes;
        }

        for (const textNode of selectedTextNodes) {
          if (op.expectedCurrentValue && !textNode.getText().includes(String(op.expectedCurrentValue))) {
            throw new Error(`STALE_FIX_ABORTED: JSX text does not match expected current value.`);
          }
          textNode.replaceWithText(op.text);
        }
        break;
      }

      default:
        throw new Error(`AST_MUTATION_UNSUPPORTED: Operation kind '${(op as any).kind}' is not supported for TSX/JS.`);
    }
  }

  // Untouched imports check: verify that initial import declarations were not modified
  const postImports = sourceFile.getImportDeclarations().map(i => i.getText());
  if (initialImports.length !== postImports.length || !initialImports.every((imp, i) => imp === postImports[i])) {
    throw new Error("AST_MUTATION_FAILED: Untouched import declarations were modified.");
  }

  return sourceFile.getFullText();
}

// ── HTML DOM AST Application ────────────────────────────────────────────────

function applyHtmlAstOperations(
  sourceCode: string,
  filePath: string,
  operations: AstOperation[],
): string {
  const root = parseHtml(sourceCode);

  for (const op of operations) {
    switch (op.kind) {
      case "setHtmlAttribute": {
        const elements = root.querySelectorAll(op.selector);
        if (elements.length === 0) {
          throw new Error(`AST_TARGET_NOT_FOUND: Selector '${op.selector}' not found in HTML ${filePath}`);
        }
        let targetElements: HTMLElement[] = [];
        if (elements.length > 1) {
          if (op.occurrence !== undefined) {
            if (op.occurrence < 1 || op.occurrence > elements.length) {
              throw new Error(`AST_TARGET_NOT_FOUND: Occurrence ${op.occurrence} of selector '${op.selector}' out of range (${elements.length} found)`);
            }
            targetElements = [elements[op.occurrence - 1]];
          } else if (op.allMatches === true) {
            targetElements = elements;
          } else {
            throw new Error(`AST_TARGET_AMBIGUOUS: Selector '${op.selector}' matched ${elements.length} HTML elements in ${filePath}. Specify occurrence index or set allMatches: true.`);
          }
        } else {
          targetElements = elements;
        }

        for (const el of targetElements) {
          if (op.expectedCurrentValue !== undefined) {
            const cur = el.getAttribute(op.attributeName);
            if (cur !== undefined && cur !== String(op.expectedCurrentValue)) {
              throw new Error(`STALE_FIX_ABORTED: Attribute '${op.attributeName}' on '${op.selector}' does not match expected value.`);
            }
          }
          el.setAttribute(op.attributeName, op.value);
        }
        break;
      }

      case "removeHtmlAttribute": {
        const elements = root.querySelectorAll(op.selector);
        if (elements.length === 0) {
          throw new Error(`AST_TARGET_NOT_FOUND: Selector '${op.selector}' not found in HTML ${filePath}`);
        }
        let targetElements: HTMLElement[] = [];
        if (elements.length > 1) {
          if (op.occurrence !== undefined) {
            if (op.occurrence < 1 || op.occurrence > elements.length) {
              throw new Error(`AST_TARGET_NOT_FOUND: Occurrence ${op.occurrence} of selector '${op.selector}' out of range (${elements.length} found)`);
            }
            targetElements = [elements[op.occurrence - 1]];
          } else if (op.allMatches === true) {
            targetElements = elements;
          } else {
            throw new Error(`AST_TARGET_AMBIGUOUS: Selector '${op.selector}' matched ${elements.length} HTML elements in ${filePath}. Specify occurrence index or set allMatches: true.`);
          }
        } else {
          targetElements = elements;
        }

        for (const el of targetElements) {
          el.removeAttribute(op.attributeName);
        }
        break;
      }

      case "insertHtmlElement": {
        const parents = root.querySelectorAll(op.parentSelector);
        if (parents.length === 0) {
          throw new Error(`AST_TARGET_NOT_FOUND: Parent selector '${op.parentSelector}' not found in HTML ${filePath}`);
        }

        let snippet = op.htmlSnippet;
        if (!snippet && op.tagName) {
          const attrsStr = op.attributes
            ? Object.entries(op.attributes)
                .map(([k, v]) => `${k}="${v}"`)
                .join(" ")
            : "";
          snippet = op.childrenText
            ? `<${op.tagName} ${attrsStr}>${op.childrenText}</${op.tagName}>`
            : `<${op.tagName} ${attrsStr} />`;
        }

        if (!snippet) throw new Error("AST_MUTATION_FAILED: insertHtmlElement requires htmlSnippet or tagName");

        let targetParents: HTMLElement[] = [];
        if (parents.length > 1) {
          if (op.occurrence !== undefined) {
            if (op.occurrence < 1 || op.occurrence > parents.length) {
              throw new Error(`AST_TARGET_NOT_FOUND: Occurrence ${op.occurrence} of parent selector '${op.parentSelector}' out of range (${parents.length} found)`);
            }
            targetParents = [parents[op.occurrence - 1]];
          } else if (op.allMatches === true) {
            targetParents = parents;
          } else {
            throw new Error(`AST_TARGET_AMBIGUOUS: Parent selector '${op.parentSelector}' matched ${parents.length} HTML elements in ${filePath}. Specify occurrence index or set allMatches: true.`);
          }
        } else {
          targetParents = parents;
        }

        for (const parent of targetParents) {
          if (op.position === "prepend") {
            parent.insertAdjacentHTML("afterbegin", snippet);
          } else {
            parent.insertAdjacentHTML("beforeend", snippet);
          }
        }
        break;
      }

      default:
        throw new Error(`AST_MUTATION_UNSUPPORTED: Operation kind '${(op as any).kind}' is not supported for HTML.`);
    }
  }

  return root.toString();
}



// ── Main Server-Side AST Application Engine ──────────────────────────────────

export function applyAstFixPlan(
  sourceCode: string,
  plan: AstFixPlan,
): PreparedAstChange {
  if (!plan.operations || plan.operations.length === 0) {
    throw new Error("AST_MUTATION_FAILED: AstFixPlan contains zero operations.");
  }

  const hashBefore = computeSha256(sourceCode);
  const astFpBefore = computeAstFingerprint(sourceCode, plan.language);
  let modifiedCode = sourceCode;

  if (
    plan.language === "typescript" ||
    plan.language === "tsx" ||
    plan.language === "javascript" ||
    plan.language === "jsx"
  ) {
    modifiedCode = applyTsxAstOperations(sourceCode, plan.filePath, plan.operations);
  } else if (plan.language === "html" || plan.language === "mdx") {
    modifiedCode = applyHtmlAstOperations(sourceCode, plan.filePath, plan.operations);
  } else if (plan.language === "robots") {
    modifiedCode = applyRobotsAstOperations(sourceCode, plan.filePath, plan.operations);
  } else if (plan.language === "xml") {
    modifiedCode = applyXmlAstOperations(sourceCode, plan.filePath, plan.operations);
  } else if (plan.language === "json") {
    try {
      const obj = JSON.parse(sourceCode);
      for (const op of plan.operations) {
        if (op.kind === "setObjectProperty" || op.kind === "insertObjectProperty") {
          obj[op.property] = op.value;
        } else if (op.kind === "removeObjectProperty") {
          delete obj[op.property];
        } else {
          throw new Error(`AST_MUTATION_UNSUPPORTED: Operation kind '${(op as any).kind}' is not supported for JSON.`);
        }
      }
      modifiedCode = JSON.stringify(obj, null, 2);
    } catch (err) {
      if ((err as Error)?.message?.includes("AST_MUTATION_UNSUPPORTED")) throw err;
      throw new Error(`AST_MUTATION_FAILED: Invalid JSON in ${plan.filePath}`);
    }
  } else {
    throw new Error(`AST_MUTATION_UNSUPPORTED: Unsupported language '${plan.language}'`);
  }

  // ── Verification Re-parse Step ───────────────────────────────────────────
  try {
    if (
      plan.language === "typescript" ||
      plan.language === "tsx" ||
      plan.language === "javascript" ||
      plan.language === "jsx"
    ) {
      const reParseProject = new Project({
        useInMemoryFileSystem: true,
        compilerOptions: { allowJs: true, jsx: 1 },
      });
      const sf = reParseProject.createSourceFile("temp-reparse.tsx", modifiedCode);
      const diagnostics = sf.getPreEmitDiagnostics();
      const syntaxErrors = diagnostics.filter((d) => d.getCategory() === 1 && d.getCode() < 2000);
      if (syntaxErrors.length > 0) {
        throw new Error(
          `AST_REPARSE_FAILED: Generated code failed syntax re-parse (${syntaxErrors[0].getMessageText()})`,
        );
      }
    } else if (plan.language === "html") {
      parseHtml(modifiedCode);
    } else if (plan.language === "json") {
      JSON.parse(modifiedCode);
    }
  } catch (err) {
    if ((err as Error)?.message?.includes("AST_REPARSE_FAILED")) throw err;
    throw new Error(`AST_REPARSE_FAILED: Reparse verification failed: ${(err as Error)?.message}`);
  }

  const hashAfter = computeSha256(modifiedCode);
  const astFpAfter = computeAstFingerprint(modifiedCode, plan.language);
  const displayDiff = generateDisplayUnifiedDiff(sourceCode, modifiedCode, plan.filePath);

  logger.info("[AstExecutor] AST Fix Plan successfully executed and verified", {
    filePath: plan.filePath,
    operationsCount: plan.operations.length,
    hashBefore,
    hashAfter,
    astFpBefore,
    astFpAfter,
  });

  return {
    findingFingerprint: plan.findingFingerprint,
    filePath: plan.filePath,
    baseBlobSha: plan.baseBlobSha,
    language: plan.language,
    serializedContent: modifiedCode,
    contentHash: hashAfter,
    unifiedDiff: displayDiff,
    astFingerprintBefore: astFpBefore,
    astFingerprintAfter: astFpAfter,
    appliedOperationsCount: plan.operations.length,
  };
}
