/**
 * migrate-inngest-v4.mjs
 *
 * Migrates all inngest.createFunction(config, trigger, handler) calls
 * (Inngest v3 3-arg API) to the v4 2-arg form:
 *   inngest.createFunction({ ...config, trigger }, handler)
 *
 * Handles:
 *   - Multi-line config objects
 *   - Single-line config objects
 *   - { event: "..." } and { cron: "..." } triggers
 *   - Nested braces inside config (throttle, concurrency, onFailure, etc.)
 */

import { readFileSync, writeFileSync } from "fs";
import path from "path";

const ROOT = process.cwd();

const FILES = [
  "src/lib/inngest/freshness-decay.ts",
  "src/lib/inngest/functions/aeo.ts",
  "src/lib/inngest/functions/audit.ts",
  "src/lib/inngest/functions/backlinks.ts",
  "src/lib/inngest/functions/benchmarks.ts",
  "src/lib/inngest/functions/blog-citation-monitor.ts",
  "src/lib/inngest/functions/blog.ts",
  "src/lib/inngest/functions/citation-gap.ts",
  "src/lib/inngest/functions/competitor-velocity.ts",
  "src/lib/inngest/functions/competitors.ts",
  "src/lib/inngest/functions/credits-reset.ts",
  "src/lib/inngest/functions/cron-workers.ts",
  "src/lib/inngest/functions/free-audit.ts",
  "src/lib/inngest/functions/free-report-email.ts",
  "src/lib/inngest/functions/full-strategy.ts",
  "src/lib/inngest/functions/github-autofix.ts",
  "src/lib/inngest/functions/healing-outcomes.ts",
  "src/lib/inngest/functions/internal-links-on-publish.ts",
  "src/lib/inngest/functions/lead-drip.ts",
  "src/lib/inngest/functions/lead-webhook.ts",
  "src/lib/inngest/functions/magic-first-audit.ts",
  "src/lib/inngest/functions/page-audit.ts",
  "src/lib/inngest/functions/planner-cms.ts",
  "src/lib/inngest/functions/query-discovery.ts",
  "src/lib/inngest/functions/query-library.ts",
  "src/lib/inngest/functions/rank-alert-checker.ts",
  "src/lib/inngest/functions/rank-tracker.ts",
  "src/lib/inngest/functions/tracked-rank-checker.ts",
  "src/lib/inngest/functions/uptime-monitor.ts",
];

/**
 * Given file source, migrate all createFunction(config, trigger, handler)
 * → createFunction({ ...config, trigger }, handler)
 */
function migrateSource(src, filename) {
  let result = src;
  let totalFixed = 0;

  // Find every occurrence of inngest.createFunction(
  // Then parse the three arguments by tracking brace depth
  const marker = "inngest.createFunction(";
  let searchFrom = 0;

  while (true) {
    const callStart = result.indexOf(marker, searchFrom);
    if (callStart === -1) break;

    const argsStart = callStart + marker.length;

    // Parse argument 1: the config object
    // Find the opening { accounting for leading whitespace/newlines
    const arg1Open = findNextChar(result, argsStart, "{");
    if (arg1Open === -1) { searchFrom = callStart + 1; continue; }

    const arg1Close = matchingBrace(result, arg1Open);
    if (arg1Close === -1) { searchFrom = callStart + 1; continue; }

    // After arg1Close there should be a comma, then the trigger object
    const afterArg1 = result.slice(arg1Close + 1).match(/^(\s*,\s*)/);
    if (!afterArg1) { searchFrom = callStart + 1; continue; }

    const triggerStart = arg1Close + 1 + afterArg1[1].length;

    // Arg 2 must start with { event: or { cron:
    const triggerChar = result[triggerStart];
    if (triggerChar !== "{") { searchFrom = callStart + 1; continue; }

    const triggerClose = matchingBrace(result, triggerStart);
    if (triggerClose === -1) { searchFrom = callStart + 1; continue; }

    const triggerRaw = result.slice(triggerStart, triggerClose + 1);

    // Verify this is indeed a trigger object (event or cron)
    if (!/\{\s*(event|cron)\s*:/.test(triggerRaw)) {
      searchFrom = callStart + 1;
      continue;
    }

    // After triggerClose, there must be a comma then the handler
    const afterTrigger = result.slice(triggerClose + 1).match(/^(\s*,\s*)/);
    if (!afterTrigger) { searchFrom = callStart + 1; continue; }

    // --- Build replacement ---
    // The trigger value: { event: "foo" } → strip outer braces, extract key:value
    const triggerInner = triggerRaw.slice(1, -1).trim(); // e.g. event: "audit.run"

    // Find the indentation used inside the config object
    const configContent = result.slice(arg1Open + 1, arg1Close);
    // Detect indent from last line before closing brace
    const lastLineMatch = configContent.match(/\n([ \t]*)$/);
    const closeIndent = lastLineMatch ? lastLineMatch[1] : "    ";
    const innerIndent = closeIndent + "    ";

    // Build trigger line to insert before the closing brace
    const triggerLine = `\n${closeIndent}    trigger: ${triggerRaw},`;

    // Check if trigger: already present (already migrated)
    if (configContent.includes("trigger:")) {
      searchFrom = arg1Close + 1;
      continue;
    }

    // Build the new config: insert `trigger: ...` before the closing `}`
    const newConfig =
      result.slice(arg1Open, arg1Close) +
      triggerLine +
      "\n" + closeIndent +
      "}";

    // Remove the old trigger argument (including surrounding comma + whitespace)
    const triggerSegment = afterArg1[1] + triggerRaw;

    // Stitch together:
    //   [before arg1Open] + newConfig + [comma+whitespace to handler] + [handler onward]
    const handlerOffset = triggerClose + 1 + afterTrigger[1].length;
    const before = result.slice(0, arg1Open);
    const handlerAndAfter = result.slice(handlerOffset);

    result = before + newConfig + ",\n" + closeIndent + handlerAndAfter;
    totalFixed++;

    // Continue from just after the new config block
    searchFrom = before.length + newConfig.length + 2;
  }

  return { result, totalFixed };
}

/** Find next occurrence of char starting at pos, skipping whitespace */
function findNextChar(src, pos, char) {
  for (let i = pos; i < src.length; i++) {
    if (src[i] === char) return i;
    if (!/[\s]/.test(src[i])) return -1; // non-whitespace non-target = not found
  }
  return -1;
}

/** Return index of closing } matching the { at openPos */
function matchingBrace(src, openPos) {
  let depth = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (let i = openPos; i < src.length; i++) {
    const ch = src[i];
    const prev = i > 0 ? src[i - 1] : "";

    if (inSingle) {
      if (ch === "'" && prev !== "\\") inSingle = false;
      continue;
    }
    if (inDouble) {
      if (ch === '"' && prev !== "\\") inDouble = false;
      continue;
    }
    if (inTemplate) {
      if (ch === "`" && prev !== "\\") inTemplate = false;
      continue;
    }

    if (ch === "'") { inSingle = true; continue; }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === "`") { inTemplate = true; continue; }

    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// ── Run ───────────────────────────────────────────────────────────────────────

let grandTotal = 0;
const results = [];

for (const rel of FILES) {
  const abs = path.join(ROOT, rel);
  let src;
  try {
    src = readFileSync(abs, "utf8");
  } catch {
    results.push(`  SKIP (not found): ${rel}`);
    continue;
  }

  const { result, totalFixed } = migrateSource(src, rel);
  if (totalFixed > 0) {
    writeFileSync(abs, result, "utf8");
    grandTotal += totalFixed;
    results.push(`  ✓ ${totalFixed} fixed — ${rel}`);
  } else {
    results.push(`  — 0 changes  — ${rel}`);
  }
}

console.log("\nInngest v3 → v4 Migration");
console.log("=".repeat(50));
results.forEach((r) => console.log(r));
console.log("=".repeat(50));
console.log(`Total functions migrated: ${grandTotal}`);
