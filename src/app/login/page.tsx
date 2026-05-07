import { Metadata } from 'next';
import Link from 'next/link';
import { LoginButtons } from '@/components/auth/LoginButtons';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { redirect } from 'next/navigation';

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: 'Log In to OptiAISEO | Access Your SEO Dashboard',
    description: 'Sign in to your OptiAISEO account. AI SEO platform trusted by agencies worldwide.',
    robots: { index: false, follow: false },
    alternates: { canonical: 'https://optiaiseo.online/login' },
    openGraph: {
        title: 'Log In to OptiAISEO | Access Your SEO Dashboard',
        description: 'Sign in to your OptiAISEO account. AI SEO platform trusted by agencies worldwide.',
        url: 'https://optiaiseo.online/login',
        siteName: 'OptiAISEO',
        type: 'website',
        images: [{ url: '/og-image.png', width: 1200, height: 630, alt: 'OptiAISEO — AI SEO Dashboard' }],
    },
    twitter: {
        card: 'summary_large_image',
        title: 'Log In to OptiAISEO | Access Your SEO Dashboard',
        description: 'Sign in to your OptiAISEO account. AI SEO platform trusted by agencies worldwide.',
        images: ['/og-image.png'],
    },
};


const ERROR_MESSAGES: Record<string, string> = {
    OAuthCallback: "Sign-in failed. Please try again or use a different method.",
    OAuthSignin: "Could not start the sign-in process. Please try again.",
    OAuthAccountNotLinked: "This email is already linked to another sign-in method. Please use the original method.",
    Callback: "Authentication error during callback. Please try again.",
    AccessDenied: "Access denied. You do not have permission to sign in.",
    Verification: "The sign-in link is invalid or has expired. Please request a new one.",
    Configuration: "There is a server configuration issue. Please contact support.",
    Default: "An unexpected error occurred during sign-in. Please try again.",
};

const REF_MESSAGES: Record<string, string> = {
    "trial-reminder": "Your 7-day Pro trial is still active.",
    "audit-ready": "Your SEO audit results are ready.",
    "trial-expiring": "Your Pro trial ends soon — sign in to upgrade.",
};

export default async function LoginPage(props: { searchParams: Promise<{ error?: string; ref?: string }> }) {
    const searchParams = await props.searchParams;
    const rawError = searchParams.error;
    const ref = searchParams.ref ?? "";
    const session = await getServerSession(authOptions);

    if (session) {
        redirect("/dashboard");
    }

    const friendlyError = rawError
        ? (ERROR_MESSAGES[rawError] ?? ERROR_MESSAGES.Default)
        : null;

    const refMessage = ref ? (REF_MESSAGES[ref] ?? null) : null;

    return (
        <div className="min-h-screen bg-background flex flex-col justify-center py-12 sm:px-6 lg:px-8">
            {/* Organization + WebPage schema — helps Google's Safe Browsing classify this as a legitimate login page */}
            <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{
                    __html: JSON.stringify({
                        "@context": "https://schema.org",
                        "@type": "WebPage",
                        "name": "Log In — OptiAISEO",
                        "url": "https://optiaiseo.online/login",
                        "isPartOf": {
                            "@type": "WebSite",
                            "name": "OptiAISEO",
                            "url": "https://optiaiseo.online"
                        },
                        "publisher": {
                            "@type": "Organization",
                            "name": "OptiAISEO",
                            "url": "https://optiaiseo.online",
                            "logo": "https://optiaiseo.online/og-image.png"
                        }
                    })
                }}
            />

            {/* Error Message from URL */}
            {friendlyError && (
                <div className="fixed top-8 left-1/2 -translate-x-1/2 z-50 w-full max-w-md px-4">
                    <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm px-4 py-3 rounded-xl shadow-lg flex items-center justify-between gap-3">
                        <div className="flex items-center gap-2">
                            <span className="text-lg" aria-hidden="true">⚠</span>
                            <span className="font-medium">{friendlyError}</span>
                        </div>
                        <Link href="/login" replace className="text-xs hover:underline opacity-60 shrink-0">
                            Dismiss
                        </Link>
                    </div>
                </div>
            )}

            <div className="flex flex-col lg:flex-row items-stretch min-h-screen lg:min-h-0">

                {/* Left trust panel — desktop only (hidden on mobile via CSS, aria-hidden prevents it being read as hidden text by crawlers) */}
                <div
                    className="hidden lg:flex lg:w-[420px] shrink-0 flex-col justify-center px-14 py-16 border-r border-border bg-card gap-10"
                    aria-hidden="true"
                >
                    <Link href="/" aria-label="Go to home" className="flex items-center gap-2.5">
                        <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-md">
                            <span className="font-black text-white tracking-tighter text-xs">Opti</span>
                        </div>
                        <div className="flex flex-col leading-none">
                            <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
                            <span className="text-[10px] font-semibold text-brand tracking-wider uppercase">AEO &amp; AI SEO</span>
                        </div>
                    </Link>

                    <div>
                        <h2 className="text-2xl font-black tracking-tight mb-2">The AI SEO platform that fixes itself.</h2>
                        <p className="text-sm text-muted-foreground leading-relaxed">Track your brand in ChatGPT, Claude &amp; Perplexity. Auto-fix issues via GitHub PRs. Publish AI-optimised content — all from one dashboard.</p>
                    </div>

                    <ul className="space-y-4">
                        {[
                            { emoji: "🎙️", title: "Voice agent — Aria", desc: "Manage your whole SEO strategy by voice" },
                            { emoji: "🤖", title: "AI Visibility (GSoV)", desc: "Track citations across 4 AI engines daily" },
                            { emoji: "⚡", title: "Auto-fix GitHub PRs", desc: "Code fixes shipped while you sleep" },
                        ].map(({ emoji, title, desc }) => (
                            <li key={title} className="flex items-start gap-3">
                                <span className="text-xl shrink-0 mt-0.5" aria-hidden="true">{emoji}</span>
                                <div>
                                    <p className="text-sm font-semibold">{title}</p>
                                    <p className="text-xs text-muted-foreground">{desc}</p>
                                </div>
                            </li>
                        ))}
                    </ul>

                    <figure className="card-surface rounded-xl p-5 border-l-2 border-brand">
                        <blockquote className="text-sm text-muted-foreground italic leading-relaxed mb-3">
                            &ldquo;I had a GitHub PR fixing my schema in under 60 seconds. No other tool does this.&rdquo;
                        </blockquote>
                        <figcaption className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center shrink-0">
                                <span className="text-[10px] font-black text-white">MT</span>
                            </div>
                            <div>
                                <p className="text-xs font-semibold">Marcus T.</p>
                                <p className="text-[10px] text-muted-foreground">Founder, SaaS startup</p>
                            </div>
                        </figcaption>
                    </figure>
                </div>

                {/* ── Right: form column ─────────────────────────────────────── */}
                <div className="flex-1 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                    <div className="sm:mx-auto sm:w-full sm:max-w-md">
                        <div className="flex justify-center mb-6 lg:hidden">
                            <Link href="/" aria-label="Go to home" className="flex items-center gap-2.5 group">
                                <div className="w-12 h-12 rounded-xl bg-brand flex items-center justify-center shadow-lg group-hover:opacity-90 transition-opacity">
                                    <span className="font-black text-white tracking-tighter text-sm">Opti</span>
                                </div>
                                <div className="flex flex-col leading-none">
                                    <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
                                    <span className="text-[10px] font-semibold text-brand tracking-wider uppercase">SEO Platform</span>
                                </div>
                            </Link>
                        </div>
                        <h1 className="mt-2 text-center text-3xl font-extrabold tracking-tight">
                            Welcome back
                        </h1>
                        <p className="mt-2 text-center text-sm text-muted-foreground">
                            Sign in to your account to continue
                        </p>
                        {refMessage && (
                            <p className="mt-2 text-center text-xs font-medium text-brand bg-brand/10 border border-brand/20 rounded-lg px-4 py-2 mx-auto max-w-xs">
                                {refMessage}
                            </p>
                        )}
                    </div>

                    <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
                        <div className="card-surface py-10 px-6 sm:rounded-2xl sm:px-10">
                            {/* Signup link at the TOP — visible before the form */}
                            <div className="mb-6 text-center">
                                <span className="text-sm text-muted-foreground">New to OptiAISEO? </span>
                                <Link href="/signup" className="text-sm font-semibold text-brand hover:opacity-80 transition-opacity">
                                    Sign up free →
                                </Link>
                            </div>

                            <LoginButtons />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
