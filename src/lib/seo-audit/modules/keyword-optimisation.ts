// =============================================================================
// DEPRECATED — Fix 2.4: Merged into KeywordsModule (keywords.ts)
//
// All checks from this module have been absorbed into keywords.ts:
//   kw-in-title          → keyword-in-title
//   kw-in-h1             → keyword-in-h1
//   kw-in-url            → keyword-in-url
//   kw-in-meta-description → keyword-in-meta-description
//   kw-in-first-paragraph → keyword-in-first-100-words
//   kw-in-subheadings    → keyword-in-subheadings (new in keywords.ts)
//   kw-density           → keyword-density (informational)
//   kw-semantic-coverage → lsi-semantic-variety
//
// This file is retained as a re-export for any direct importers.
// DO NOT add new checks here — add them to keywords.ts.
// =============================================================================

import { KeywordsModule } from './keywords';
export { KeywordsModule as KeywordOptimisationModule };
