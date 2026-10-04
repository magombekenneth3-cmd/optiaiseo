// =============================================================================
// CANONICAL AST REMEDIATION TYPES
//
// Invariant: AI never returns source code, full file strings, or textual diffs
// for execution. AI returns structured AST operations. Only the server-side
// AST engine executes operations and produces serialized source code.
// =============================================================================

import type { FixRisk, VerificationCriterion } from "@/lib/seo-audit/contracts";

export type AstLanguage =
  | "typescript"
  | "tsx"
  | "javascript"
  | "jsx"
  | "html"
  | "mdx"
  | "json"
  | "xml"
  | "robots";

// ── AST Operation Kinds ──────────────────────────────────────────────────────

export interface SetObjectPropertyOp {
  kind: "setObjectProperty";
  target: string; // e.g. "metadata", "openGraph", "alternates"
  property: string;
  value: unknown;
  expectedCurrentValue?: unknown;
}

export interface RemoveObjectPropertyOp {
  kind: "removeObjectProperty";
  target: string;
  property: string;
  expectedCurrentValue?: unknown;
}

export interface InsertObjectPropertyOp {
  kind: "insertObjectProperty";
  target: string;
  property: string;
  value: unknown;
  expectedCurrentValue?: unknown;
}

export interface SetJsxAttributeOp {
  kind: "setJsxAttribute";
  componentName?: string;
  elementTag?: string;
  attributeName: string;
  value: string | boolean | number;
  expectedCurrentValue?: unknown;
  occurrence?: number;
  allMatches?: boolean;
}

export interface RemoveJsxAttributeOp {
  kind: "removeJsxAttribute";
  componentName?: string;
  elementTag?: string;
  attributeName: string;
  occurrence?: number;
  allMatches?: boolean;
}

export interface InsertJsxElementOp {
  kind: "insertJsxElement";
  targetSelector?: string;
  parentTag?: string;
  tagName?: string;
  attributes?: Record<string, string | boolean | number>;
  childrenText?: string;
  jsxSnippet?: string;
  occurrence?: number;
  allMatches?: boolean;
}

export interface ReplaceJsxTextOp {
  kind: "replaceJsxText";
  targetSelector?: string;
  text: string;
  expectedCurrentValue?: unknown;
  occurrence?: number;
  allMatches?: boolean;
}

export interface SetHtmlAttributeOp {
  kind: "setHtmlAttribute";
  selector: string;
  attributeName: string;
  value: string;
  expectedCurrentValue?: unknown;
  occurrence?: number;
  allMatches?: boolean;
}

export interface RemoveHtmlAttributeOp {
  kind: "removeHtmlAttribute";
  selector: string;
  attributeName: string;
  occurrence?: number;
  allMatches?: boolean;
}

export interface InsertHtmlElementOp {
  kind: "insertHtmlElement";
  parentSelector: string;
  position?: "append" | "prepend";
  tagName?: string;
  attributes?: Record<string, string>;
  childrenText?: string;
  htmlSnippet?: string;
  occurrence?: number;
  allMatches?: boolean;
}

export interface UpdateJsonLdPropertyOp {
  kind: "updateJsonLdProperty";
  schemaType?: string;
  property: string;
  value: unknown;
  expectedCurrentValue?: unknown;
}

export interface InsertJsonLdNodeOp {
  kind: "insertJsonLdNode";
  schemaType: string;
  data: Record<string, unknown>;
}

export interface RemoveJsonLdNodeOp {
  kind: "removeJsonLdNode";
  schemaType: string;
}

export interface SetRobotsDirectiveOp {
  kind: "setRobotsDirective";
  userAgent: string;
  directive: "Allow" | "Disallow";
  path: string;
}

export interface RemoveRobotsDirectiveOp {
  kind: "removeRobotsDirective";
  userAgent: string;
  directive: "Allow" | "Disallow";
  path: string;
}

export interface SetXmlNodeOp {
  kind: "setXmlNode";
  targetTag: string;
  value: string;
  occurrence?: number;
  allMatches?: boolean;
}

export type AstOperation =
  | SetObjectPropertyOp
  | RemoveObjectPropertyOp
  | InsertObjectPropertyOp
  | SetJsxAttributeOp
  | RemoveJsxAttributeOp
  | InsertJsxElementOp
  | ReplaceJsxTextOp
  | SetHtmlAttributeOp
  | RemoveHtmlAttributeOp
  | InsertHtmlElementOp
  | UpdateJsonLdPropertyOp
  | InsertJsonLdNodeOp
  | RemoveJsonLdNodeOp
  | SetRobotsDirectiveOp
  | RemoveRobotsDirectiveOp
  | SetXmlNodeOp;

// ── AST Fix Plan ─────────────────────────────────────────────────────────────

export interface AstFixPlan {
  version: 1;
  findingFingerprint: string;
  filePath: string;
  baseBlobSha?: string;
  language: AstLanguage;
  operations: AstOperation[];
  rationale: string;
  risk: FixRisk;
  verification: VerificationCriterion[];
}

// ── Prepared AST Change (Output of Server-Side AST Engine) ───────────────────

export interface PreparedAstChange {
  proposalId?: string;
  findingFingerprint: string;
  filePath: string;
  baseBlobSha?: string;
  language: AstLanguage;
  /** Serialized source code produced ONLY by the trusted AST printer */
  serializedContent: string;
  /** SHA256 of the serialized content */
  contentHash: string;
  /** Presentation unified diff (for UI display only — never executed) */
  unifiedDiff: string;
  /** Hash of AST structure before operations */
  astFingerprintBefore: string;
  /** Hash of AST structure after operations */
  astFingerprintAfter: string;
  /** Number of AST operations applied */
  appliedOperationsCount: number;
}
