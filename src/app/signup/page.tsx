import { Metadata } from "next";
import Link from "next/link";
import { SignupForm } from "@/components/auth/SignupForm";
import { Gift, Bot, FileText, BarChart3, Search } from "lucide-react";

export const metadata: Metadata = {
    title: "Sign Up — Start Free | OptiAISEO",
    description: "Start your 7-day Pro trial — full access, no credit card required. AI-powered SEO audits, AEO visibility tracking, and blog generation.",
    robots: { index: false, follow: false },
    alternates: { canonical: '/signup' },
};

const freePerks = [
    { icon: Gift, text: "7-day full Pro trial — no credit card required" },
    { icon: Bot, text: "AEO visibility tracking (ChatGPT, Gemini, Perplexity)" },
    { icon: FileText, text: "AI-powered blog posts — SEO-optimised in minutes" },
    { icon: BarChart3, text: "Google Search Console integration" },
    { icon: Search, text: "5 audits per month included free" },
];

export default function SignupPage() {
    return (
        <div className="min-h-screen bg-background flex flex-col lg:flex-row">
            {/* ── Left: Value Panel ─────────────────────────────────────────── */}
            <div className="hidden lg:flex lg:w-[420px] xl:w-[460px] shrink-0 flex-col justify-center px-12 py-16 border-r border-border bg-card" aria-hidden="true">
                {/* Logo */}
                <Link href="/" aria-label="Go to home" className="flex items-center gap-2.5 mb-12 group">
                    <div className="w-10 h-10 rounded-xl bg-brand flex items-center justify-center shadow-md group-hover:opacity-90 transition-opacity">
                        <span className="font-black text-white tracking-tighter text-xs">Opti</span>
                    </div>
                    <div className="flex flex-col leading-none">
                        <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
                        <span className="text-[10px] font-semibold text-brand tracking-wider uppercase">SEO Platform</span>
                    </div>
                </Link>

                <h2 className="text-2xl font-black tracking-tight mb-2">Everything you get — free.</h2>
                <p className="text-sm text-muted-foreground mb-8 leading-relaxed">
                    No credit card required. Start in seconds and upgrade when you&apos;re ready.
                </p>

                <ul className="space-y-4 mb-10">
                    {freePerks.map(({ icon: Icon, text }) => (
                        <li key={text} className="flex items-center gap-3">
                            <span className="w-8 h-8 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0">
                                <Icon className="w-4 h-4 text-brand" />
                            </span>
                            <span className="text-sm font-medium text-foreground">{text}</span>
                        </li>
                    ))}
                </ul>

                {/* Trust badges */}
                <div className="flex flex-wrap gap-3 mt-auto">
                    {["Cancel anytime", "No credit card", "SOC-2 ready"].map(badge => (
                        <span
                            key={badge}
                            className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border bg-background text-muted-foreground"
                        >
                            ✓ {badge}
                        </span>
                    ))}
                </div>
            </div>

            {/* ── Right: Form Panel ─────────────────────────────────────────── */}
            <div className="flex-1 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
                <div className="sm:mx-auto sm:w-full sm:max-w-md">
                    {/* Mobile-only logo */}
                    <div className="flex justify-center mb-6 lg:hidden">
                        <Link href="/" aria-label="Go to home" className="flex items-center gap-2.5 group">
                            <div className="w-12 h-12 rounded-2xl bg-brand flex items-center justify-center shadow-lg group-hover:opacity-90 transition-opacity">
                                <span className="font-black text-white tracking-tighter text-sm">Opti</span>
                            </div>
                        </Link>
                    </div>

                    {/* Conversion-first headline */}
                    <h1 className="mt-2 text-center text-3xl font-extrabold tracking-tight">
                        Start your 7-day Pro trial — free
                    </h1>
                    <p className="mt-2 text-center text-sm text-muted-foreground">
                        Full access. No credit card. Cancel anytime.
                    </p>

                    {/* Social proof */}
                    <p className="mt-3 text-center text-xs text-muted-foreground">
                        Joined by 2,000+ SEO teams and agencies
                    </p>

                    {/* Mobile perks — shown inline below heading on small screens */}
                    <ul className="lg:hidden mt-4 flex flex-wrap justify-center gap-2">
                        {freePerks.map(({ icon: Icon, text }) => (
                            <li key={text} className="text-xs font-medium px-2.5 py-1 rounded-full bg-card border border-border text-muted-foreground flex items-center gap-1">
                                <Icon className="w-3 h-3" /> {text}
                            </li>
                        ))}
                    </ul>

                    {/* Mobile trust badges */}
                    <div className="lg:hidden flex flex-wrap justify-center gap-2 mt-4">
                        {["Cancel anytime", "No credit card", "SOC-2 ready"].map(badge => (
                            <span key={badge} className="text-xs font-semibold px-3 py-1.5 rounded-full border border-border bg-card text-muted-foreground">
                                ✓ {badge}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-md px-4 sm:px-0">
                    <div className="card-surface py-10 px-6 sm:rounded-2xl sm:px-10">
                        <SignupForm />

                        <div className="mt-8 flex items-center justify-center">
                            <div className="text-sm">
                                <span className="text-muted-foreground">Already have an account? </span>
                                <Link href="/login" className="font-medium text-brand hover:opacity-80 transition-opacity">
                                    Sign in
                                </Link>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
