Critical bugs
4
UX warnings
7
Minor issues
5
Files reviewed
14
Contents
SSE error handler silently re-triggers duplicate audits
OAuth loading state never resets on failure
Raw error.message exposed in ErrorBoundary
ReAuditNudge swallows fetch failures entirely
Inngest internal term leaked to end users
aria-invalid on wrong field during password mismatch
Email gate unlock has no success state
Toaster theme hardcoded dark regardless of user preference
Broken /auth/signin redirect in action-errors
ScoreDropAlert CTA hidden when auditId is null
"Slow down!" copy is condescending for a rate limit
Dead _newAuditId state in AuditButton
Hardcoded "$9" pricing copy in UpgradeGate
Contact page email links have no mobile fallback
No infinite-stream timeout on free SEO checker
_currentTier prop accepted but never used in UpgradeGate
Critical bugs
4 findings
Critical
SSE onerror silently allows duplicate audit submission
src/app/free/seo-checker/page.tsx
When the EventSource fires onerror, phase transitions to 'error' and the form re-renders with the original URL intact and the submit button active. Because auditId is a local let inside handleSubmit and the phase-check for the audit POST only happens pre-stream, a re-submit creates a brand-new audit in the backend — the original audit from the previous run is still processing in Inngest but is now orphaned. This wastes server credits, contributes to hitting the IP rate-limit of 3/day, and the user gets results from the second audit, not the first.

Additionally, EventSource retries automatically — the browser reconnects on drop within a few seconds. Triggering onerror → setPhase('error') on the first transient blip completely kills the stream before the browser's built-in retry can save it.
// Current — fires on first hiccup
es.onerror = () => {
  es.close();
  setPhase((prev) => {
    if (prev === 'streaming') {
      setErrorMsg('Connection lost…');
      return 'error';  // ← exposes form, enabling re-submit
    }
    return prev;
  });
};
Fix: Add a reconnect counter. Only transition to error after N consecutive onerror events (e.g. 3). Persist auditId in state so re-renders continue polling the same job, not a new one. Alternatively switch to polling instead of SSE to avoid this entirely.
Critical
OAuth loading spinner freezes permanently on failure
src/components/auth/SignupForm.tsx
handleOAuth calls setLoading(provider) then await signIn(...). There is no try/catch and no finally { setLoading(null) }. If signIn throws — network timeout, auth provider down — the spinner runs indefinitely. Both the Google and GitHub buttons remain disabled via disabled={loading !== null}, and the form inputs are also blocked. The user is locked out of the entire signup form with no visible error and no way to recover other than a hard page refresh.
const handleOAuth = async (provider: string) => {
    setLoading(provider);
    await signIn(provider, { callbackUrl: "/dashboard" });
    // ← no try/catch, no setLoading(null) on failure
};
Fix: Wrap in try/catch/finally. In the finally block call setLoading(null). In the catch block set an error message like "Could not connect to Google — please try again." Surface it via the existing error state.
Critical
Raw JavaScript error.message rendered to users in ErrorBoundary
src/components/dashboard/ErrorBoundary.tsx
The fallback UI renders error.message in a monospace block: {error.message}. JavaScript error messages regularly contain internal detail — database connection strings, Prisma query errors like "Unique constraint failed on the fields: (`email`)", API endpoint URLs with secret path segments, or auth token fragments. This is both a security leak and terrible UX — users see programmer-speak they cannot act on.
{error?.message && (
  <p className="text-[11px] font-mono text-red-400/70 ...">
    {error.message}  {/* ← leaks internal error detail */}
  </p>
)}
Fix: Remove the error.message display entirely from the user-facing fallback. Log it to your observability stack (already done via logger.error). Show a reference code (e.g. error ID) if you want to help support correlate reports. Never render raw exception messages to end users.
Critical
ReAuditNudge swallows audit start failures with no user feedback
src/components/dashboard/ReAuditNudge.tsx
The runAudit() function catches errors but only calls setLoading(false). If the POST to /api/audits/run fails — 401, 429, 500, network timeout — the button simply stops spinning and returns to its idle state. The user clicked "Run Audit Now", saw a spinner, and now sees the same button as before. No toast, no inline message, no indication that the audit was never queued. They may click repeatedly, each time silently failing, thinking the UI is broken.
async function runAudit() {
    setLoading(true);
    try {
        await fetch("/api/audits/run", { ... });
        router.push("/dashboard/audits");
    } catch {
        setLoading(false);  // ← silent failure, no error shown
    }
}
Fix: After setLoading(false), call toast.error("Failed to start audit — please try again.") or set a local error state. Also check the response status code — fetch does not throw on 4xx/5xx, so the current try/catch only catches network errors, not server-side failures.
UX warnings
7 findings
Warning
Internal infrastructure term "Inngest dashboard" shown to end users
src/components/dashboard/JobPoller.tsx
The timeout fallback renders: "Job timed out. Please retry or check the Inngest dashboard." No customer knows what Inngest is. This exposes your internal task queue vendor to users and implies they have access to a dashboard they don't. It also signals the product is not production-hardened.
Fix: Change to: "This is taking longer than expected. Please try again or contact support if the issue persists." Optionally include a support link. Keep internal tool names in logs only.
Warning
aria-invalid set on email field during unrelated errors
src/components/auth/SignupForm.tsx
The email input has aria-invalid={!!error} — meaning it's marked invalid for any error in the form, including "Passwords do not match." Screen readers will announce the email field as invalid when the actual problem is the confirm password field. There is also no aria-invalid on the password or confirm fields at all.
Fix: Track field-level errors separately (e.g. fieldErrors.email, fieldErrors.confirm). Set aria-invalid only on the specific field that has a problem. Move the "Passwords do not match" error rendering adjacent to the confirm field rather than as a global banner.
Warning
Email gate unlock has no success confirmation state
src/app/free/results/[auditId]/FreeResultClient.tsx
After a user submits their email to unlock the full report, the only feedback is the button text changing from "Unlock Full Report" to "Sending…" while unlocking is true. If the API call fails — network error, 422, 500 — the emailError state shows a small inline text-xs message at the bottom of the form. There is no distinct success state. The user has no confirmation their email was received or when to expect the emailed report.
Fix: On success, replace the unlock form with a clear confirmation: "Report sent! Check your inbox at {email}." Add a toast. On failure, surface the emailError more prominently with an icon so it is not missed. Check the response status before calling setUnlocked(true).
Warning
Toaster theme hardcoded to dark regardless of user preference
src/app/ClientLayout.tsx
<Toaster theme="dark" /> is hardcoded. The app supports a light/dark toggle stored in localStorage (also managed in ClientLayout). On light theme, dark toasts with background: "#18181b" look jarring and disconnected from the UI. The toast is a critical feedback channel — it must match the active theme.
Fix: Pass the active theme state: <Toaster theme={theme as "dark" | "light"} />. Also remove the hardcoded background/color in toastOptions.style — with richColors={true} sonner handles semantic color mapping automatically and adapts to theme.
Warning
Broken redirect path in unauthorized error handler
src/lib/ui/action-errors.tsx
The unauthorized error case links to /auth/signin. However, the actual NextAuth sign-in route configured in this project (per src/app/api/auth/[...nextauth]/route.ts) is at /api/auth/signin — the standard NextAuth path. The /auth/signin path will 404. Users who see a "Session expired" toast and click "Sign in →" land on a 404 page.
Fix: Change the href to /login (the custom login page already exists in the project) or /api/auth/signin. Audit all hardcoded auth paths across the codebase to ensure consistency.
Warning
ScoreDropAlert provides no recovery action when auditId is null
src/components/dashboard/ScoreDropAlert.tsx
When auditId is null the "Fix now →" CTA is hidden, but the alert still fully renders: the red banner, the warning icon, "Your SEO score dropped X points", and the top cause. The user receives a high-urgency alert with no actionable path forward. This creates anxiety without resolution — possibly worse than showing nothing.
Fix: When auditId is null, fall back to linking to /dashboard/audits with copy "Run a new audit →". Never show a problem-framing alert without at least one next action.
Warning
"Slow down!" toast copy is condescending for rate limits
src/lib/ui/action-errors.tsx
The rate_limit error case shows a heading of "Slow down!" The user almost certainly did not knowingly spam the action — they clicked a button that triggered a background operation that internally hit a limit. Blaming user behaviour for a system constraint is poor microcopy that damages trust.
Fix: Change heading to "You've reached a usage limit" or just "Limit reached". The body message from the server already explains what the limit is — let that carry the information without a scolding headline.
Minor issues
5 findings
Minor
Dead state: _newAuditId stored but never rendered
src/app/dashboard/audits/AuditButton.tsx
const [_newAuditId, setNewAuditId] = useState<string | null>(null) — the underscore prefix signals "intentionally unused", yet state is written on each successful audit. This is dead weight in the component and a maintenance hazard. If a future developer removes it without understanding the intent, nothing breaks — confirming it serves no purpose.
Fix: Remove the state entirely, or actually use it — e.g. show a persistent banner "Your audit is running" with a direct link to the new report until the user navigates away.
Minor
Hardcoded "$9" pricing copy inside UpgradeGate component
src/components/dashboard/UpgradeGate.tsx
The credits copy reads: "Buy 50 more for $9, or upgrade your plan". Pricing is hardcoded in the component. If the price changes, this requires a code change and deployment rather than a CMS or config update. It will also be wrong for non-USD users.
Fix: Pull pricing copy from a centralised config or pass as a prop. At minimum extract to a constant at the file top so it is one place to update.
Minor
Contact email links have no fallback for unconfigured mail clients
src/app/contact/page.tsx
Both contact cards use bare href="mailto:..." links. On mobile browsers and many modern desktop setups where no native mail app is configured, clicking these opens a dead-end OS dialog or simply does nothing. There is no copy-to-clipboard fallback.
Fix: Add a small "Copy" icon button next to each email address that copies it to the clipboard, with a brief "Copied!" confirmation. This is a one-liner with the Clipboard API and covers the large share of users who don't use native mail clients.
Minor
No timeout on indefinitely-running streaming phase
src/app/free/seo-checker/page.tsx
If the Inngest job hangs and never emits DONE or FAILED, the SSE stream stays open and the user is stuck on the progress screen indefinitely — a spinning ring at whatever percentage was last emitted. There is no client-side maximum duration after which the UI gives up and explains what happened.
Fix: Add a useEffect timeout (e.g. 90 seconds). On expiry, close the EventSource and show an error: "This is taking longer than expected. Your report may still be processing — try refreshing in a minute." Store the auditId so the user can navigate directly to the result if it does complete.
Minor
_currentTier prop accepted but ignored in UpgradeGate
src/components/dashboard/UpgradeGate.tsx
The component receives currentTier: _currentTier but the underscore rename signals it is intentionally unused. The component's copy and CTA are identical for FREE and AGENCY users hitting the same gate. A Pro user who has already paid should get different messaging (e.g. "contact us about Enterprise") vs a FREE user hitting their first limit.
Fix: Use the tier to conditionally branch copy. At minimum, distinguish free users (push upgrade) from paid users (push top-tier or support). Remove the underscore rename and actually reference the value.