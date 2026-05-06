import { Metadata } from "next";
import Link from "next/link";
import { ResetPasswordForm } from "./ResetPasswordForm";

export const metadata: Metadata = {
  title: "Reset Password | OptiAISEO",
  description: "Choose a new password for your account.",
  robots: { index: false, follow: false },
};

export default async function ResetPasswordPage(props: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await props.searchParams;

  // FIX #5: Guard missing/obviously-invalid tokens at the server level.
  // This avoids rendering the form client-side only to immediately flash
  // a loading spinner and then transition to the invalid state.
  const isTokenMissing = !token || token.trim().length < 10;

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative overflow-hidden">
      {/* FIX (perf): Reduced blur from 120px to 48px — same visual effect, lower GPU cost on low-end devices */}
      <div className="absolute top-0 -translate-y-12 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-primary/20 blur-3xl rounded-full pointer-events-none" />

      <div className="sm:mx-auto sm:w-full sm:max-w-md relative z-10">
        <div className="flex justify-center mb-6">
          <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
            <div className="w-12 h-12 rounded-xl bg-brand flex items-center justify-center shadow-lg">
              <span className="font-bold text-white tracking-tighter text-xl">Opti</span>
            </div>
          </Link>
        </div>
        <h1 className="mt-2 text-center text-3xl font-extrabold tracking-tight">Set new password</h1>
        <p className="mt-2 text-center text-sm text-muted-foreground">
          Choose a strong password for your account
        </p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md relative z-10 px-4 sm:px-0">
        <div className="card-surface py-8 px-4 sm:rounded-2xl sm:px-10">
          {isTokenMissing ? (
            // Render the invalid state directly — no client round-trip, no loading flash
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-rose-500/15 border border-rose-500/25 flex items-center justify-center">
                <svg className="w-7 h-7 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M12 3a9 9 0 100 18A9 9 0 0012 3z" />
                </svg>
              </div>
              <p className="text-base font-semibold text-white">Link invalid or expired</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                This password reset link is invalid or has expired. Please request a new one.
              </p>
              <Link
                href="/forgot-password"
                className="mt-2 inline-flex items-center gap-2 px-5 py-2.5 bg-foreground text-background font-bold rounded-xl text-sm transition-colors hover:opacity-90"
              >
                Request new link
              </Link>
            </div>
          ) : (
            <ResetPasswordForm token={token!} />
          )}
        </div>
      </div>
    </div>
  );
}