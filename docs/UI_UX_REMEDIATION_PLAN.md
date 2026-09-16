# UI/UX Remediation Plan

## Scope and audit confidence

This is a code-informed product audit of the authenticated OptiAISEO experience. It covers the dashboard shell, navigation, site context, operations, recommendations, audits, content, AEO, settings, and mobile patterns. A visual QA pass in a populated, authenticated browser session is still required before pixel-level changes are approved.

## Executive diagnosis

The product has strong feature depth, helpful empty states, a reusable component base, and a clear dark visual language. Its primary usability problem is **decision overload**: users can reach more than 30 dashboard destinations, while navigation presents many of them as peers. The product should guide a user through a small daily loop—**understand → decide → act → verify**—and keep specialist tools discoverable but secondary.

## Findings and remediation order

| Priority | Finding | User impact | Fix | Acceptance criteria |
|---|---|---|---|---|
| P0 | Navigation has duplicated concepts (Dashboard and AI Visibility appear in more than one group) and more than 20 primary/secondary destinations. | New users cannot identify the next valuable action; power tools look equally urgent. | Replace the present category list with four task-based groups: Overview, Discover, Improve, Monitor. Put specialist workflows in a single “More tools” panel and retain command-palette access. | Sidebar exposes no more than 8 primary destinations; every current route remains reachable in two interactions or via Command-K. |
| P0 | The active site is implicit in parts of the product and passed through query parameters in others. | Users can misread data or act on the wrong site. | Make the selected site a persistent, page-level context with domain, environment, and last-updated time in the header. Persist it per user; show an explicit “All sites” state where aggregation is intentional. | Every site-scoped page has one visible site source of truth; switching sites updates the title and data atomically. |
| P0 | The dashboard presents many cards, metrics, alerts, banners, and assistant entry points at once. | The “what should I do now?” moment is weak. | Establish a daily command center: one primary next-best action, 3–4 outcome metrics, one attention queue, then recent activity. Collapse secondary widgets behind “View details.” | A new user can complete site connection → audit → first approved opportunity from the main dashboard without navigating more than twice. |
| P0 | Mobile’s fixed bottom nav can obscure the final content because the dashboard main area has no mobile bottom-safe padding contract. Tables also frequently rely on horizontal scrolling. | Important actions/rows can sit under navigation; dense workflows are hard on phones. | Add a global mobile content inset (`pb-24` plus safe-area), design card/list alternatives for priority tables, and use a consistent responsive table wrapper. | At 320px and 390px widths, final controls are reachable above the tab bar and the top five workflows have no mandatory horizontal-table interaction. |
| P1 | Feedback is inconsistent: some mutation workflows use blocking `alert()` while other areas use Sonner toasts; errors often lack recovery guidance. | Jarring interactions and unclear failure recovery. | Create one notification contract: toast for confirmation, inline error panel for recoverable page errors, modal only for irreversible decisions. Include “Retry,” “View details,” or “Contact support” when applicable. | No dashboard production interaction calls `alert()`; success, error, and async-pending states follow the shared pattern. |
| P1 | Typography is over-compressed: dashboard code uses very small utility text extensively, including 10–11px status and data labels. | Reduced scanability and accessibility, especially on smaller screens. | Define a dashboard type scale: 12px minimum for metadata, 14px default body, 16px minimum interactive text; reserve 10px only for nonessential chart annotations. | No essential information or interactive label is below 12px; automated visual check flags violations. |
| P1 | Status uses color heavily (green/red/amber) and scattered hand-built badges. | Color-vision and contrast risk; semantics vary across pages. | Ship `StatusBadge`, `RiskBadge`, `MetricDelta`, and `SystemState` primitives with icon/text/color tokens. | Every status is understandable in grayscale and via screen-reader text; no page invents a status color map. |
| P1 | Modal/sheet behavior is inconsistent; the mobile “More” sheet is visually a dialog but lacks dialog semantics/focus management. | Keyboard and screen-reader users can lose context. | Standardize all overlays on the shared dialog/sheet primitive with focus trap, escape dismissal, labelled heading, and restored focus. | Keyboard audit passes: open, close, escape, tab loop, and focus restoration work for mobile navigation, command palette, approvals, and destructive confirmations. |
| P1 | Page loading, empty, error, and permission states vary by feature. | Product feels unreliable when data/integrations are absent. | Introduce `PageState` recipes for loading skeleton, zero-data education, disconnected integration CTA, permission state, and retriable error. | Top 12 routes use the recipe; every error tells users what happened and the next safe action. |
| P2 | Operations is a forensic UI and now includes health data, but the action hierarchy remains list-first. | Operators must interpret status rather than being led to exceptions. | Lead with “Needs attention” (open circuit, failed mutation, approval waiting), then health cards, then the forensic timeline. Add filters as saved views: Needs review, Failed, Running, Completed. | An operator can identify the next intervention within five seconds on a populated account. |
| P2 | Dense desktop tables are replicated across audits, keywords, backlinks, experiments, indexing, and content workflows. | High scan cost and weak mobile adaptation. | Create a standard data-explorer pattern: persistent filters, column preferences, row actions, compact density toggle, mobile cards, and a clear empty state. | All data-heavy pages share sorting/filter behavior and have a usable 390px presentation. |

## Design system workstream

1. Inventory existing `components/ui` primitives and freeze ad-hoc button, badge, card, tab, modal, and toast creation.
2. Define semantic tokens for surface, border, focus, success, warning, danger, and information. Do not encode meaning directly in individual page class strings.
3. Publish layout contracts: desktop content max-widths, 8-point spacing, section rhythm, mobile safe-area inset, and responsive grid breakpoints.
4. Add Storybook or a route-local component gallery for the design primitives and test light/dark, keyboard focus, long strings, zero state, and loading state.

## 30-day delivery sequence

### Week 1 — clarity and safety

- Agree the top three user jobs: first value, daily SEO review, and safe remediation.
- Simplify navigation and make site context persistent.
- Add mobile bottom inset and standardize responsive table behavior.
- Replace blocking alerts and add the notification contract.

### Week 2 — dashboard and state quality

- Recompose the dashboard around one next-best action and an attention queue.
- Add standard loading, empty, disconnected, and error states to the highest-traffic pages.
- Normalize type scale, status components, and button hierarchy.

### Week 3 — workflows

- Redesign Operations around exceptions and saved views.
- Apply the data-explorer pattern to Audits, Keywords, and Recommendations.
- Make approvals/destructive actions explicit, reversible where possible, and auditable in the UI.

### Week 4 — validation

- Run moderated usability tests: five new users and five experienced SEO operators.
- Audit keyboard navigation, contrast, zoom at 200%, and mobile at 320px/390px/768px.
- Instrument completion funnels: connect site, run audit, review recommendation, approve action, and recover from an error.

## Measures of success

- First-value completion (site connected + audit started) increases by 20%.
- Median time from dashboard landing to a meaningful next action is below 30 seconds.
- Recommendation review-to-approval completion improves by 15% without increasing undo/rollback rate.
- Mobile task completion for audit review and recommendation approval is at least 90% of desktop completion.
- Keyboard accessibility audit has no blocking focus, modal, or contrast defects.

## Immediate implementation backlog

1. Add `DashboardPageFrame`, `PageState`, `StatusBadge`, `AsyncActionButton`, and `ResponsiveDataExplorer` primitives.
2. Add persistent active-site context and display it in the header/page title.
3. Replace `alert()` in Operations, PSEO, and Autopilot with the shared notification flow.
4. Add mobile safe-area content padding in the dashboard layout.
5. Rework the sidebar information architecture before adding new navigation items.
