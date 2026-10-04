// =============================================================================
// SERVER-SIDE AST MUTATION EXECUTOR
//
// Invariant: AI models return structured AstFixPlan operations.
// This engine parses the target syntax tree, applies operations, re-parses
// to verify syntax validity, and serializes the modified source code.
//
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

        // Semantic lock 1: Exported VariableDeclaration with matching target name (e.g. export const metadata = {...})
        sourceFile.forEachDescendant((node) => {
          if (Node.isVariableDeclaration(node) && node.getName() === op.target) {
            const init = node.getInitializer();
            if (Node.isObjectLiteralExpression(init)) {
              objExpr = init;
            }
          }
        });

        // Semantic lock 2: Target property on metadata object (e.g. metadata.openGraph)
        if (!objExpr) {
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
            `AST_MUTATION_FAILED: Semantic target object '${op.target}' not found in AST of ${filePath}`,
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
        sourceFile.forEachDescendant((node) => {
          if (Node.isVariableDeclaration(node) && node.getName() === op.target) {
            const init = node.getInitializer();
            if (Node.isObjectLiteralExpression(init)) {
              const prop = init.getProperty(op.property);
              if (prop) prop.remove();
            }
          }
        });
        break;
      }

      case "setJsxAttribute": {
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
            }
          }
        });
        break;
      }

      default:
        break;
    }
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
          throw new Error(`AST_MUTATION_FAILED: Selector '${op.selector}' not found in HTML ${filePath}`);
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
          throw new Error(`AST_MUTATION_FAILED: Parent selector '${op.parentSelector}' not found in HTML ${filePath}`);
        }
        for (const parent of parents) {
          if (op.position === "prepend") {
            parent.insertAdjacentHTML("afterbegin", op.htmlSnippet);
          } else {
            parent.insertAdjacentHTML("beforeend", op.htmlSnippet);
          }
        }
        break;
      }

      default:
        break;
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
  } else if (plan.language === "json") {
    try {
      const obj = JSON.parse(sourceCode);
      for (const op of plan.operations) {
        if (op.kind === "setObjectProperty") {
          obj[op.property] = op.value;
        }
      }
      modifiedCode = JSON.stringify(obj, null, 2);
    } catch {
      throw new Error(`AST_MUTATION_FAILED: Invalid JSON in ${plan.filePath}`);
    }
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
  const displayDiff = generateDisplayUnifiedDiff(sourceCode, modifiedCode, plan.filePath);

  logger.info("[AstExecutor] AST Fix Plan successfully executed and verified", {
    filePath: plan.filePath,
    operationsCount: plan.operations.length,
    hashBefore,
    hashAfter,
  });

  return {
    findingFingerprint: plan.findingFingerprint,
    filePath: plan.filePath,
    baseBlobSha: plan.baseBlobSha,
    language: plan.language,
    serializedContent: modifiedCode,
    contentHash: hashAfter,
    unifiedDiff: displayDiff,
    astFingerprintBefore: hashBefore,
    astFingerprintAfter: hashAfter,
    appliedOperationsCount: plan.operations.length,
  };
}
