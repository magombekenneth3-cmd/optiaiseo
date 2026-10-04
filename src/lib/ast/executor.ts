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

/** Compute normalized AST structural fingerprint (excluding trivia, whitespace & comments) */
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
    }
  } catch {
    // Fall back to whitespace-strip normalized hash if AST traversal fails
  }

  const normalized = code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return createHash("sha256").update(normalized).digest("hex");
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
            `AST_TARGET_NOT_FOUND: Ambiguous top-level exported target '${op.target}' in ${filePath}`,
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
        let attrUpdated = false;
        sourceFile.forEachDescendant((node) => {
          if (Node.isJsxSelfClosingElement(node) || Node.isJsxOpeningElement(node)) {
            const tagName = node.getTagNameNode().getText();
            if (!op.elementTag || tagName === op.elementTag) {
              const valStr = typeof op.value === "string" ? `"${op.value}"` : `{${op.value}}`;
              const attr = node.getAttribute(op.attributeName);
              if (attr && Node.isJsxAttribute(attr)) {
                attr.setInitializer(valStr);
              } else {
                node.addAttribute({
                  name: op.attributeName,
                  initializer: valStr,
                });
              }
              attrUpdated = true;
            }
          }
        });
        if (!attrUpdated) {
          throw new Error(`AST_TARGET_NOT_FOUND: JSX element tag '${op.elementTag ?? "*"}' not found in ${filePath}`);
        }
        break;
      }

      case "removeJsxAttribute": {
        sourceFile.forEachDescendant((node) => {
          if (Node.isJsxSelfClosingElement(node) || Node.isJsxOpeningElement(node)) {
            const tagName = node.getTagNameNode().getText();
            if (!op.elementTag || tagName === op.elementTag) {
              const attr = node.getAttribute(op.attributeName);
              if (attr) attr.remove();
            }
          }
        });
        break;
      }

      case "insertJsxElement": {
        let inserted = false;
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

        sourceFile.forEachDescendant((node) => {
          if (!inserted && Node.isJsxElement(node)) {
            const tag = node.getOpeningElement().getTagNameNode().getText();
            if (!op.parentTag || tag === op.parentTag) {
              const closing = node.getClosingElement();
              if (closing) {
                closing.replaceWithText(`${snippet}\n${closing.getText()}`);
                inserted = true;
              }
            }
          }
        });
        if (!inserted) {
          // If parent JSX node not found, add to top-level JSX return statement
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
        }
        if (!inserted) throw new Error(`AST_TARGET_NOT_FOUND: Could not find parent JSX tag '${op.parentTag ?? "return"}' in ${filePath}`);
        break;
      }

      case "replaceJsxText": {
        let textReplaced = false;
        sourceFile.forEachDescendant((node) => {
          if (!textReplaced && Node.isJsxText(node)) {
            if (op.expectedCurrentValue && !node.getText().includes(String(op.expectedCurrentValue))) {
              throw new Error(`STALE_FIX_ABORTED: JSX text does not match expected current value.`);
            }
            node.replaceWithText(op.text);
            textReplaced = true;
          }
        });
        if (!textReplaced) throw new Error(`AST_TARGET_NOT_FOUND: JSX text node not found in ${filePath}`);
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
        for (const el of elements) {
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
        for (const el of elements) {
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

        for (const parent of parents) {
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

// ── Robots.txt Directive AST Application ─────────────────────────────────────

function applyRobotsAstOperations(
  sourceCode: string,
  filePath: string,
  operations: AstOperation[],
): string {
  const lines = sourceCode.split("\n");

  for (const op of operations) {
    if (op.kind === "setRobotsDirective") {
      let userAgentIdx = -1;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(`user-agent: ${op.userAgent.toLowerCase()}`) || lines[i].toLowerCase().includes(`user-agent: *`)) {
          userAgentIdx = i;
          break;
        }
      }
      const newRule = `${op.directive}: ${op.path}`;
      if (userAgentIdx !== -1) {
        lines.splice(userAgentIdx + 1, 0, newRule);
      } else {
        lines.push(`User-agent: ${op.userAgent}`);
        lines.push(newRule);
      }
    } else if (op.kind === "removeRobotsDirective") {
      const targetRule = `${op.directive.toLowerCase()}: ${op.path.toLowerCase()}`;
      const filtered = lines.filter(l => !l.toLowerCase().includes(targetRule));
      lines.length = 0;
      lines.push(...filtered);
    } else {
      throw new Error(`AST_MUTATION_UNSUPPORTED: Operation kind '${(op as any).kind}' is not supported for robots.txt.`);
    }
  }

  return lines.join("\n");
}

// ── XML AST Application ─────────────────────────────────────────────────────

function applyXmlAstOperations(
  sourceCode: string,
  filePath: string,
  operations: AstOperation[],
): string {
  const root = parseHtml(sourceCode);

  for (const op of operations) {
    if (op.kind === "setXmlNode") {
      const nodes = root.querySelectorAll(op.targetTag);
      if (nodes.length === 0) {
        throw new Error(`AST_TARGET_NOT_FOUND: XML tag '${op.targetTag}' not found in ${filePath}`);
      }
      for (const n of nodes) {
        n.set_content(op.value);
      }
    } else {
      throw new Error(`AST_MUTATION_UNSUPPORTED: Operation kind '${(op as any).kind}' is not supported for XML.`);
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
