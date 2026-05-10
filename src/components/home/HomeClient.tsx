"use client";

import { useState, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";

const DashboardMockup = dynamic(
  () => import("@/components/home/DashboardMockup").then((m) => ({ default: m.DashboardMockup })),
  { ssr: false, loading: () => <div className="w-full h-72 rounded-xl bg-card animate-pulse" aria-hidden="true" /> }
);
const TrafficGrowth3D = dynamic(
  () => import("@/components/home/TrafficGrowth3D").then((m) => ({ default: m.TrafficGrowth3D })),
  { ssr: false, loading: () => <div className="w-full h-48 rounded-xl bg-card animate-pulse" aria-hidden="true" /> }
);
const FloatContainer = dynamic(
  () => import("@/components/home/FloatingMiniatures").then((m) => ({ default: m.FloatContainer })),
  { ssr: false }
);
const IsoServerMiniature = dynamic(
  () => import("@/components/home/FloatingMiniatures").then((m) => ({ default: m.IsoServerMiniature })),
  { ssr: false }
);
const IsoDatabaseMiniature = dynamic(
  () => import("@/components/home/FloatingMiniatures").then((m) => ({ default: m.IsoDatabaseMiniature })),
  { ssr: false }
);
import {
  Activity,
  GitPullRequest,
  FileEdit,
  TrendingUp,
  Check,
  ChevronDown,
  ShieldCheck,
  Zap,
  Mic,
  Bot,
  Eye,
  Menu,
  X,
  ArrowRight,
  Sparkles,
} from "lucide-react";

interface FaqItem {
  name: string;
  acceptedAnswer: { text: string };
}

interface HomeClientProps {
  faqItems: FaqItem[];
  stats: { siteCount: number; weeklySignups: number; auditCount: number; blogCount: number };
}

const INTEGRATIONS = [
  { name: "Google Gemini", abbr: "Gemini" },
  { name: "GitHub", abbr: "GitHub" },
  { name: "Google Search Console", abbr: "GSC" },
  { name: "LiveKit", abbr: "LiveKit" },
  { name: "Stripe", abbr: "Stripe" },
  { name: "Next.js", abbr: "Next.js" },
  { name: "OpenAI", abbr: "OpenAI" },
  { name: "Anthropic", abbr: "Claude" },
  { name: "Perplexity", abbr: "Perplx" },
];

const FEATURES = [
  {
    icon: Mic,
    title: "Fix in 60 seconds",
    desc: "Tell Aria what's broken. She reads the audit, writes the code, opens a GitHub PR — while you're still talking.",
    badge: "Unique to OptiAISEO",
    badgeColor: "bg-emerald-500/10 text-emerald-400 border-emerald-500/25",
  },
  {
    icon: GitPullRequest,
    title: "Zero manual fixes",
    desc: "Missing schema, broken meta tags, Core Web Vital failures — all patched by pull request. Your engineer just clicks merge.",
    badge: "Autonomous",
    badgeColor: "bg-blue-500/10 text-blue-400 border-blue-500/25",
  },
  {
    icon: Bot,
    title: "Know your AI rank",
    desc: "See exactly how often ChatGPT, Claude, Perplexity, and Google AI cite your brand — and who's beating you.",
    badge: "AI Search",
    badgeColor: "bg-purple-500/10 text-purple-400 border-purple-500/25",
  },
  {
    icon: FileEdit,
    title: "Content AI engines quote",
    desc: "Entity-dense posts with built-in schema. Written to be cited by AI, not just ranked by Google.",
    badge: "Content",
    badgeColor: "bg-amber-500/10 text-amber-400 border-amber-500/25",
  },
];

const STEPS = [
  {
    step: "1",
    title: "Connect",
    desc: "Add your domain and optionally link your GitHub repo. Takes under 2 minutes.",
  },
  {
    step: "2",
    title: "Verify",
    desc: "Complete your site setup. OptiAISEO verifies your domain, connects Google Search Console, and queues your first full crawl.",
  },
  {
    step: "3",
    title: "Fix",
    desc: "Review auto-generated GitHub PRs or let Aria walk you through each fix by voice.",
  },
  {
    step: "4",
    title: "Dominate",
    desc: "Watch your GSoV and organic rankings climb as content and fixes compound over time.",
  },
];

const PLANS = [
  {
    name: "Free",
    price: { monthly: "$0", annual: "$0" },
    desc: "Connect your site and explore the full platform. No credit card needed.",
    features: [
      "5 audits per month",
      "1 website",
      "3 AI blog posts per month",
      "Google Search Console integration",
      "Basic AI visibility check",
      "50 credits / month",
    ],
    cta: "Start for free",
    ctaHref: "/signup",
    highlight: false,
    badge: null,
  },
  {
    name: "Starter",
    price: { monthly: "$19", annual: "$15" },
    desc: "For solo creators and small sites ready to grow in AI search.",
    features: [
      "150 credits / month",
      "3 websites",
      "15 audits / month",
      "30 AI blog posts / month",
      "Ubersuggest keyword data",
      "On-page optimisation",
      "Rank tracking",
      "Competitor tracking (2 per site)",
    ],
    cta: "Start Starter trial",
    ctaHref: "/signup?plan=starter",
    highlight: false,
    badge: "New",
  },
  {
    name: "Pro",
    price: { monthly: "$49", annual: "$39" },
    desc: "Full automation for growing teams who want to win in AI search.",
    features: [
      "500 credits / month",
      "10 websites",
      "30 audits / month",
      "Unlimited AI blog posts",
      "GitHub auto-fix PRs",
      "GSoV tracking across 4 AI engines",
      "Competitor gap analysis",
      "Aria voice agent",
    ],
    cta: "Start Pro trial — connect your site free",
    ctaHref: "/signup?plan=pro",
    highlight: true,
    badge: "Most popular",
  },
  {
    name: "Agency",
    price: { monthly: "$149", annual: "$119" },
    desc: "For agencies managing multiple clients at scale.",
    features: [
      "2,000 credits / month",
      "Unlimited websites",
      "300 audits / month",
      "Unlimited AI blog posts",
      "All Pro features",
      "White-label PDF exports",
      "Priority support",
    ],
    cta: "Start Agency trial",
    ctaHref: "/signup?plan=agency",
    highlight: false,
    badge: "Agencies",
  },
];

export default function HomeClient({ faqItems, stats }: HomeClientProps) {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [isScrolled, setIsScrolled] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const [billingAnnual, setBillingAnnual] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [solutionsOpen, setSolutionsOpen] = useState(false);
  const solutionsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      router.replace("/dashboard");
    }
  }, [status, session, router]);

  const getPrice = (plan: (typeof PLANS)[0]) =>
    billingAnnual ? plan.price.annual : plan.price.monthly;

  useEffect(() => {
    const onScroll = () => {
      setIsScrolled(window.scrollY > 20);
      const doc = document.documentElement;
      const progress = (window.scrollY / (doc.scrollHeight - doc.clientHeight)) * 100;
      setScrollProgress(Math.min(100, progress));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!mobileNavOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileNavOpen]);

  useEffect(() => {
    if (!solutionsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setSolutionsOpen(false);
    };
    const onMouse = (e: MouseEvent) => {
      if (solutionsRef.current && !solutionsRef.current.contains(e.target as Node)) {
        setSolutionsOpen(false);
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onMouse);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onMouse);
    };
  }, [solutionsOpen]);

  return (
    <div className="relative min-h-screen overflow-hidden bg-background">

      {/* ── Navigation ─────────────────────────────────────────────────────── */}
      <nav
        aria-label="Main navigation"
        className={`fixed top-0 w-full z-50 transition-all duration-300 ${isScrolled
          ? "bg-background/95 backdrop-blur-sm border-b border-brand/20"
          : "bg-transparent border-transparent py-2"
          }`}
      >
        <div className="relative max-w-7xl mx-auto px-6 h-16 flex items-center justify-between overflow-hidden">
          <Link
            href="/"
            aria-label="OptiAISEO home"
            className="flex items-center gap-2.5"
          >
            <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shrink-0">
              <span className="font-black text-background text-[11px] tracking-tight">
                AI
              </span>
            </div>
            <div className="flex flex-col leading-none">
              <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
              <span className="text-[10px] font-semibold text-brand tracking-wider uppercase leading-none">
                AEO & AI SEO Platform
              </span>
            </div>
          </Link>

          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-muted-foreground">
            <Link href="/aria" className="hover:text-foreground transition-colors flex items-center gap-1.5 font-semibold text-emerald-500">
              <Mic className="w-3.5 h-3.5" /> Aria Copilot
            </Link>
            {/* Solutions dropdown */}
            <div className="relative" ref={solutionsRef}>
              <button
                onClick={() => setSolutionsOpen(o => !o)}
                aria-expanded={solutionsOpen}
                aria-controls="solutions-dropdown"
                className="hover:text-foreground transition-colors flex items-center gap-1"
              >
                Solutions <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${solutionsOpen ? "rotate-180" : ""}`} />
              </button>
              {solutionsOpen && (
                <div
                  id="solutions-dropdown"
                  role="menu"
                  className="absolute top-full left-0 mt-2 w-52 bg-card border border-border rounded-xl shadow-xl p-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                >
                  {[
                    { href: "/for-agencies", label: "For Agencies" },
                    { href: "/for-saas", label: "For SaaS Companies" },
                    { href: "/for-content", label: "For Content Teams" },
                    { href: "/for-ecommerce", label: "For E-commerce" },
                  ].map(({ href, label }) => (
                    <Link
                      key={href}
                      href={href}
                      role="menuitem"
                      onClick={() => setSolutionsOpen(false)}
                      className="flex items-center px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              )}
            </div>
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#how-it-works" className="hover:text-foreground transition-colors">How it works</a>
            <Link href="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
            <Link
              href="/free/seo-checker"
              className="hover:text-foreground transition-colors flex items-center gap-1 text-brand font-semibold"
            >
              <Zap className="w-3.5 h-3.5" /> Free Checker
            </Link>
            <Link href="/about" className="hover:text-foreground transition-colors">About</Link>
          </div>

          <div className="hidden md:flex items-center gap-4">
            <Link
              href="/login"
              className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Log in
            </Link>
            <Link
              href="/signup"
              className="text-sm font-semibold bg-foreground text-background px-5 py-2 rounded-full hover:opacity-90 transition-all active:scale-95"
            >
              Get started free
            </Link>
          </div>

          <button
            className="md:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            onClick={() => setMobileNavOpen(true)}
            aria-label="Open navigation menu"
          >
            <Menu className="w-5 h-5" />
          </button>
          {/* Read-progress bar */}
          {isScrolled && (
            <div
              className="absolute bottom-0 left-0 h-[1.5px] transition-all duration-75"
              style={{ width: `${scrollProgress}%`, background: "var(--brand)" }}
            />
          )}
        </div>
      </nav>

      {/* ── Mobile drawer ──────────────────────────────────────────────────── */}
      {mobileNavOpen && (
        <>
          <div
            className="fixed inset-0 z-40 bg-background/80 backdrop-blur-sm md:hidden"
            onClick={() => setMobileNavOpen(false)}
            aria-hidden="true"
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            className="fixed inset-y-0 right-0 z-50 w-72 bg-background border-l border-border flex flex-col md:hidden shadow-2xl"
          >
            <div className="flex items-center justify-between px-5 h-16 border-b border-border shrink-0">
              <span className="font-bold text-sm tracking-tight">Menu</span>
              <button
                onClick={() => setMobileNavOpen(false)}
                className="p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                aria-label="Close navigation menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <nav
              className="flex-1 flex flex-col gap-1 px-4 py-6"
              aria-label="Mobile navigation"
            >
              {[
                { href: "/aria", label: "Aria Copilot" },
                { href: "/for-agencies", label: "For Agencies" },
                { href: "/for-saas", label: "For SaaS" },
                { href: "/for-content", label: "For Content Teams" },
                { href: "/for-ecommerce", label: "For E-commerce" },
                { href: "#features", label: "Features" },
                { href: "#how-it-works", label: "How it works" },
                { href: "/pricing", label: "Pricing" },
                { href: "#faq", label: "FAQ" },
                { href: "/free/seo-checker", label: "Free SEO Checker" },
                { href: "/about", label: "About" },
                { href: "/contact", label: "Contact" },
              ].map(({ href, label }) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => {
                    setMobileNavOpen(false);
                    if (href.startsWith("#")) {
                      const id = href.slice(1);
                      setTimeout(() => {
                        document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });
                      }, 50);
                    }
                  }}
                  className="flex items-center px-3 py-3 rounded-lg text-base font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  {label}
                </a>
              ))}
            </nav>
            <div className="p-4 border-t border-border flex flex-col gap-3">
              <Link
                href="/login"
                onClick={() => setMobileNavOpen(false)}
                className="w-full text-center py-2.5 rounded-xl border border-border text-sm font-medium text-foreground hover:bg-accent transition-colors"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                onClick={() => setMobileNavOpen(false)}
                className="w-full text-center py-2.5 rounded-xl bg-foreground text-background text-sm font-bold hover:opacity-90 transition-all"
              >
                Get started — free
              </Link>
            </div>
          </div>
        </>
      )}

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      {/* Decorative floating ISO miniatures — positioned outside main flow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute top-[22%] left-[4%] opacity-30 hidden lg:block">
          <FloatContainer delay={0} yOffset={12} duration={5}>
            <IsoServerMiniature />
          </FloatContainer>
        </div>
        <div className="absolute top-[30%] right-[4%] opacity-25 hidden lg:block">
          <FloatContainer delay={1.5} yOffset={10} duration={6}>
            <IsoDatabaseMiniature />
          </FloatContainer>
        </div>
        <div className="absolute top-[55%] left-[7%] opacity-15 hidden xl:block">
          <FloatContainer delay={2.5} yOffset={8} duration={7}>
            <IsoServerMiniature />
          </FloatContainer>
        </div>
      </div>
      <main
        id="main-content"
        className="relative z-10 max-w-7xl mx-auto px-6 pt-40 pb-20 flex flex-col items-center justify-center text-center min-h-screen"
      >
        <div className="relative flex items-center justify-center w-16 h-16 mb-8 mx-auto fade-in-up">
          <div className="w-16 h-16 rounded-2xl bg-foreground flex items-center justify-center">
            <Sparkles className="w-8 h-8 text-background" />
          </div>
        </div>

        <div className="fade-in-up fade-in-up-1 inline-flex items-center gap-2 px-3 py-1 rounded-full border border-border bg-card mb-8">
          <span
            className="flex h-2 w-2 rounded-full bg-brand animate-breathe"
            aria-hidden="true"
          />
          <span className="text-xs font-medium text-muted-foreground">
            Now tracking AI citations across ChatGPT, Claude, Perplexity &amp;
            Google AI Mode
          </span>
        </div>

        <h1 className="fade-in-up fade-in-up-2 max-w-3xl text-5xl md:text-7xl font-black tracking-tighter leading-[1.05] mb-6">
          Your competitors are cited by ChatGPT.
          <span className="block text-brand">You&apos;re not. Let&apos;s fix that.</span>
        </h1>

        <p
          id="aiseo-definition"
          className="fade-in-up fade-in-up-3 max-w-xl text-lg md:text-xl text-muted-foreground mb-10 leading-relaxed"
        >
          OptiAISEO audits your site, writes the fix, publishes it — then proves
          it worked. Traditional SEO tools stop at the report.{" "}
          <span className="text-foreground font-semibold">We close the loop.</span>
        </p>

        <div className="fade-in-up fade-in-up-4 flex flex-col sm:flex-row items-center gap-4 w-full justify-center">
          <div className="flex flex-col items-center gap-1.5 w-full sm:w-auto">
            <Link
              href="/signup"
              className="w-full sm:w-auto px-8 py-4 rounded-full bg-foreground text-background font-bold text-lg hover:opacity-90 transition-all active:scale-95 inline-flex items-center justify-center gap-2"
            >
              <Zap className="w-5 h-5" />
              Start free — no card needed
            </Link>
            <span className="text-xs text-muted-foreground">
              Connect your site · 7-day Pro trial included
            </span>
          </div>
          <Link
            href="/aria"
            className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors inline-flex items-center gap-1.5 underline underline-offset-2"
          >
            <Mic className="w-4 h-4 text-brand" />
            Watch Aria Demo
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        {/* Micro-trust badges */}
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 mt-4 fade-in-up fade-in-up-4">
          {["No card needed", "7-day Pro trial", "Cancel anytime", "SSL encrypted"].map((t) => (
            <span key={t} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "var(--brand)" }} />
              {t}
            </span>
          ))}
        </div>

        <div className="mt-20 w-full max-w-7xl mx-auto flex flex-col lg:flex-row gap-12 relative perspective-1000">
          <div className="flex-1 relative transform-gpu transition-all duration-700 ease-out lg:hover:-translate-y-2 border border-border rounded-2xl shadow-xl p-2 bg-card group">
            <DashboardMockup />
          </div>
          <div className="flex-1 relative transform-gpu transition-all duration-700 ease-out lg:hover:-translate-y-2 border border-border rounded-2xl shadow-xl p-8 bg-card flex flex-col justify-center items-center group">
            <div className="text-center mb-8 z-10 relative">
              <h2 className="text-2xl font-bold mb-2 tracking-tight">
                Compound your AI presence
              </h2>
              <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                Every fix, every blog post, every schema update compounds — your
                GSoV and organic traffic grow together over time.
              </p>
            </div>
            <div className="w-full flex items-center justify-center relative z-0 pb-2">
              <TrafficGrowth3D />
            </div>
          </div>
        </div>
      </main>

      {/* ── Audit → Fix → Prove loop ──────────────────────────────────────── */}
      <section
        aria-labelledby="loop-heading"
        className="relative py-20 border-t border-border bg-muted/20"
      >
        <div className="max-w-5xl mx-auto px-6 text-center">
          <p className="text-xs font-bold uppercase tracking-widest text-brand mb-3">How OptiAISEO works</p>
          <h2
            id="loop-heading"
            className="text-3xl md:text-4xl font-black tracking-tight mb-4"
          >
            The only SEO tool that closes the loop.
          </h2>
          <p className="text-muted-foreground max-w-xl mx-auto mb-14 text-base">
            Every other tool gives you a report and stops. OptiAISEO audits,
            fixes, publishes, and proves — automatically, every week.
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
            <div
              className="hidden md:block absolute top-8 left-[16.5%] right-[16.5%] h-px bg-border"
              aria-hidden="true"
            />
            {[
              {
                step: "01", label: "AUDIT",
                title: "We find everything broken",
                desc: "Full technical audit, AEO scoring across ChatGPT, Claude, Perplexity and Google AI, GSC decay detection, competitor gaps — every week, automatically.",
                color: "text-blue-400", bg: "bg-blue-500/10 border-blue-500/20",
              },
              {
                step: "02", label: "FIX",
                title: "We write and publish the fix",
                desc: "AI-generated blog posts, schema markup, meta rewrites, internal links — pushed live to WordPress, Ghost, or GitHub as a PR. No agency. No ticket queue.",
                color: "text-brand", bg: "bg-brand/10 border-brand/20",
              },
              {
                step: "03", label: "PROVE",
                title: "We show it worked",
                desc: "Before/after rankings. AEO score deltas. Self-healing outcomes with traffic impact logged. Not a report. An actual result you can show your boss.",
                color: "text-violet-400", bg: "bg-violet-500/10 border-violet-500/20",
              },
            ].map(({ step, label, title, desc, color, bg }) => (
              <div
                key={step}
                className="relative card-surface rounded-2xl p-8 flex flex-col items-center text-center"
              >
                <div className={`w-14 h-14 rounded-full border-2 ${bg} flex items-center justify-center mb-5 relative z-10 bg-background`}>
                  <span className={`text-lg font-black ${color}`}>{step}</span>
                </div>
                <span className={`text-[10px] font-black tracking-widest uppercase ${color} mb-2`}>{label}</span>
                <h3 className="text-base font-bold mb-3">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
          <p className="mt-10 text-sm text-muted-foreground">
            Ahrefs shows you what&apos;s broken. Semrush shows you what&apos;s broken.{" "}
            <span className="text-foreground font-semibold">OptiAISEO fixes it and proves it worked.</span>
          </p>
        </div>
      </section>

      {/* ── Integration trust strip ────────────────────────────────────────── */}
      <section
        aria-label="Powered by"
        className="py-12 border-t border-b border-border bg-card overflow-hidden"
      >
        <p className="text-center text-xs font-bold uppercase tracking-widest text-muted-foreground mb-8">
          Powered by
        </p>
        <div className="flex items-center justify-center flex-wrap gap-x-10 gap-y-4 max-w-4xl mx-auto px-6">
          {INTEGRATIONS.map(({ name, abbr }) => (
            <span
              key={name}
              title={name}
              className="text-sm font-semibold text-muted-foreground/60 hover:text-muted-foreground transition-colors tracking-wide"
            >
              {abbr}
            </span>
          ))}
        </div>
      </section>

      {/* ── Social proof ────────────────────────────────────────────────────── */}
      <section
        aria-labelledby="social-proof-heading"
        className="relative py-20 border-t border-border"
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-20">
            {[
              {
                value: stats.siteCount > 100 ? `${stats.siteCount.toLocaleString()}+` : "100+",
                label: "sites connected",
              },
              {
                value: stats.auditCount > 1000 ? `${(stats.auditCount / 1000).toFixed(0)}k+` : stats.auditCount > 0 ? `${stats.auditCount}+` : "1,000+",
                label: "audits completed",
              },
              {
                value: stats.blogCount > 100 ? `${stats.blogCount}+` : stats.blogCount > 0 ? `${stats.blogCount}+` : "500+",
                label: "posts published",
              },
              { value: "< 2 min", label: "to first audit" },
            ].map(({ value, label }) => (
              <div key={label} className="text-center">
                <p className="text-3xl md:text-4xl font-black tracking-tight text-foreground mb-1">{value}</p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>

          <div className="text-center mb-12">
            <h2
              id="social-proof-heading"
              className="text-2xl md:text-4xl font-bold tracking-tight mb-3"
            >
              Trusted by SEO teams & indie founders
            </h2>
            <p className="text-muted-foreground max-w-xl mx-auto">What early users say after connecting their first site.</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              {
                quote: "The GitHub auto-fix PR blew my mind. I asked Aria to fix my missing schema and had a pull request open in under 60 seconds. No other tool does this.",
                name: "Marcus T.",
                role: "Founder, SaaS startup",
                initials: "MT",
                accent: "bg-emerald-500",
              },
              {
                quote: "I switched from Semrush after realising it had zero AI engine tracking. OptiAISEO showed me I had a GSoV of 0% — and exactly how to fix it. Game changer.",
                name: "Priya S.",
                role: "Head of Growth, Fintech",
                initials: "PS",
                accent: "bg-sky-500",
              },
              {
                quote: "I connected my site, ran my first audit in under two minutes, and had a full list of actionable fixes before I'd finished my coffee. The voice agent feels like having a senior SEO on call.",
                name: "Jordan R.",
                role: "Freelance SEO Consultant",
                initials: "JR",
                accent: "bg-violet-500",
              },
            ].map(({ quote, name, role, initials, accent }) => (
              <figure
                key={name}
                className="card-surface rounded-2xl p-8 flex flex-col justify-between hover:-translate-y-1 transition-transform duration-300"
              >
                {/* Stars */}
                <div className="flex gap-0.5 mb-4" aria-label="5 out of 5 stars">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <svg key={i} className="w-3.5 h-3.5 fill-current" style={{ color: "#fbbf24" }} viewBox="0 0 20 20">
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
                <blockquote className="text-sm text-muted-foreground leading-relaxed mb-6 flex-1">
                  &ldquo;{quote}&rdquo;
                </blockquote>
                <figcaption className="flex items-center gap-3">
                  <div
                    className={`w-10 h-10 rounded-full ${accent} flex items-center justify-center shrink-0`}
                    aria-hidden="true"
                  >
                    <span className="text-xs font-black text-white">{initials}</span>
                  </div>
                  <div>
                    <p className="text-sm font-semibold flex items-center gap-1.5">
                      {name}
                      <span className="text-xs font-medium" style={{ color: "var(--brand)" }}>· verified</span>
                    </p>
                    <p className="text-xs text-muted-foreground">{role}</p>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>

          <div className="mt-12 flex flex-wrap items-center justify-center gap-3 text-sm text-muted-foreground">
            <span>See how we compare:</span>
            {[
              { href: "/vs/semrush", label: "OptiAISEO vs Semrush" },
              { href: "/vs/ahrefs", label: "OptiAISEO vs Ahrefs" },
              { href: "/vs/surfer-seo", label: "OptiAISEO vs Surfer SEO" },
              { href: "/vs/moz", label: "OptiAISEO vs Moz" },
              { href: "/vs/clearscope", label: "OptiAISEO vs Clearscope" },
              { href: "/vs/mangools", label: "OptiAISEO vs Mangools" },
            ].map(({ href, label }, i, arr) => (
              <span key={href} className="flex items-center gap-3">
                <Link href={href} className="text-brand hover:underline font-semibold">{label}</Link>
                {i < arr.length - 1 && <span aria-hidden="true">·</span>}
              </span>
            ))}
            <Link href="/vs" className="text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1 text-xs">
              See all →
            </Link>
          </div>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/case-studies"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            >
              Read real customer results — AI SEO case studies →
            </Link>
            <span aria-hidden="true" className="text-border hidden sm:inline">·</span>
            <Link
              href="/leaderboard"
              className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors underline underline-offset-2"
            >
              See the AI SEO Leaderboard →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Aria showcase ─────────────────────────────────────────────────── */}
      <section
        id="aria"
        aria-labelledby="aria-heading"
        className="relative py-24 border-t border-zinc-800/40 bg-zinc-950 text-white overflow-hidden"
      >
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 0%, rgba(16,185,129,0.12) 0%, transparent 70%)",
          }}
        />

        <div className="relative max-w-7xl mx-auto px-6">
          <div className="flex flex-col lg:flex-row items-center gap-16">
            <div className="flex-shrink-0 flex flex-col items-center gap-6">
              <div className="w-40 h-40 rounded-full border border-brand/30 flex items-center justify-center relative">
                <div className="w-28 h-28 rounded-full border border-brand/20 flex items-center justify-center">
                  <div className="w-20 h-20 rounded-full bg-brand/10 border border-brand/30 flex items-center justify-center">
                    <Mic className="w-8 h-8 text-brand" />
                  </div>
                </div>
                <span
                  className="absolute inset-0 rounded-full border border-brand/20 animate-ping opacity-30"
                  aria-hidden="true"
                />
              </div>
              <div className="text-center">
                <p className="font-bold text-lg tracking-tight">Aria</p>
                <p className="text-xs text-white/55 mt-0.5">
                  Powered by Gemini 2.5 Flash · LiveKit WebRTC
                </p>
              </div>
            </div>

            <div className="flex-1 text-center lg:text-left">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-brand/20 bg-brand/10 mb-6">
                <span className="text-xs font-semibold text-brand uppercase tracking-wider">
                  No other SEO tool has this
                </span>
              </div>
              <h2
                id="aria-heading"
                className="text-3xl md:text-5xl font-black tracking-tight mb-6 leading-tight"
              >
                Meet Aria — your AI SEO strategist.
                <span className="block text-brand">Talk to her.</span>
              </h2>
              <p className="text-lg text-white/70 mb-8 max-w-xl leading-relaxed">
                Aria is a real-time voice agent with sub-second response, full
                barge-in support, and the ability to{" "}
                <em>take action</em> — not just answer questions.
              </p>

              <ul className="space-y-3 mb-10 text-left max-w-lg mx-auto lg:mx-0">
                {[
                  { icon: Activity, text: "\"Aria, audit my homepage and tell me the top 3 issues.\"" },
                  { icon: Eye, text: "\"Aria, look at my design and critique the conversion rate.\"" },
                  { icon: GitPullRequest, text: "\"Aria, open a GitHub PR to fix the missing schema.\"" },
                  { icon: TrendingUp, text: "\"Aria, what keywords am I losing to my competitors?\"" },
                ].map(({ icon: Icon, text }, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg bg-brand/10 border border-brand/20 flex items-center justify-center shrink-0 mt-0.5">
                      <Icon className="w-3.5 h-3.5 text-brand" />
                    </div>
                    <span className="text-sm text-white/65 italic">{text}</span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap items-center gap-4 lg:justify-start justify-center">
                <Link
                  href="/aria"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-brand text-white font-bold text-base hover:opacity-95 hover:shadow-lg hover:shadow-brand/30 transition-all active:scale-95"
                >
                  <Mic className="w-4 h-4" />
                  See Aria in action
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/signup"
                  className="inline-flex items-center justify-center gap-2 px-7 py-3.5 rounded-full bg-white/10 border border-white/30 text-white font-bold text-base hover:bg-white/20 hover:border-white/50 transition-all active:scale-95"
                >
                  Start free trial
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Features ──────────────────────────────────────────────────────── */}
      <section
        id="features"
        aria-labelledby="features-heading"
        className="relative py-24 border-t border-border"
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2
              id="features-heading"
              className="text-3xl md:text-5xl font-bold tracking-tight mb-4"
            >
              Everything AI search demands.{" "}
              <span className="text-brand">Automated.</span>
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Traditional SEO tools tell you what&apos;s wrong. OptiAISEO fixes it,
              publishes content, and tracks your visibility in AI answers —
              without manual work.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {FEATURES.map((feature) => (
              <div
                key={feature.title}
                className="relative p-6 rounded-2xl border border-border bg-card hover:border-brand/30 hover:bg-brand/5 transition-all duration-200 group flex flex-col"
              >
                <div className="w-10 h-10 rounded-xl bg-brand/10 group-hover:bg-brand/20 flex items-center justify-center mb-4 transition-colors shrink-0">
                  <feature.icon className="w-5 h-5 text-brand" />
                </div>
                <span
                  className={`self-start text-[10px] font-bold px-2 py-0.5 rounded-full border mb-3 ${feature.badgeColor}`}
                >
                  {feature.badge}
                </span>
                <h3 className="text-lg font-bold mb-2">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed flex-1">
                  {feature.desc}
                </p>
              </div>
            ))}
          </div>

          <div className="mt-8 grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              "Technical SEO audits (after setup)",
              "Competitor keyword gaps",
              "Content planner",
              "Auto indexing",
              "Content decay alerts",
              "Internal link optimizer",
              "Knowledge graph feed",
              "AEO rank tracker",
            ].map((item) => (
              <div
                key={item}
                className="flex items-center gap-2.5 px-4 py-3 rounded-xl border border-border bg-card/50"
              >
                <Check className="w-4 h-4 text-brand shrink-0" />
                <span className="text-sm text-muted-foreground">{item}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ──────────────────────────────────────────────────── */}
      <section
        id="how-it-works"
        aria-labelledby="how-it-works-heading"
        className="relative py-24 border-t border-border bg-muted/30"
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2
              id="how-it-works-heading"
              className="text-3xl md:text-5xl font-bold tracking-tight mb-4"
            >
              From zero to ranked in four steps
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Works for SEO teams and developers alike. GitHub is optional — not required.
            </p>
          </div>

          <div className="relative">
            <div
              className="hidden md:block absolute top-8 left-0 w-full h-px bg-border"
              aria-hidden="true"
            />
            <ol className="grid grid-cols-1 md:grid-cols-4 gap-12 text-center relative z-10 list-none">
              {STEPS.map((item) => (
                <li key={item.step} className="flex flex-col items-center">
                  <div
                    className="w-16 h-16 rounded-full bg-card border-4 border-background ring-1 ring-border flex items-center justify-center text-xl font-bold mb-6"
                    aria-label={`Step ${item.step}`}
                  >
                    {item.step}
                  </div>
                  <h3 className="text-xl font-bold mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground">{item.desc}</p>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      {/* ── Pricing ───────────────────────────────────────────────────────── */}
      <section
        id="pricing"
        aria-labelledby="pricing-heading"
        className="relative py-24 border-t border-border"
      >
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2
              id="pricing-heading"
              className="text-3xl md:text-5xl font-bold tracking-tight mb-4"
            >
              Simple, transparent pricing
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Start free. Upgrade only when you need more automation.
            </p>

            <div className="flex items-center justify-center gap-3 mt-6">
              <span
                className={`text-sm font-medium transition-colors ${!billingAnnual ? "text-foreground" : "text-muted-foreground"
                  }`}
              >
                Monthly
              </span>
              <button
                role="switch"
                aria-checked={billingAnnual}
                aria-label="Toggle annual billing"
                onClick={() => setBillingAnnual((v) => !v)}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring ${billingAnnual ? "bg-brand" : "bg-muted"
                  }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${billingAnnual ? "translate-x-6" : "translate-x-1"
                    }`}
                />
              </button>
              <span
                className={`text-sm font-medium flex items-center gap-2 transition-colors ${billingAnnual ? "text-foreground" : "text-muted-foreground"
                  }`}
              >
                Annual
                <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-brand/10 text-brand border border-brand/20">
                  Save 20%
                </span>
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 max-w-6xl mx-auto">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`card-surface p-6 flex flex-col relative overflow-hidden hover:-translate-y-1 transition-transform duration-300 ${plan.highlight
                  ? "ring-2 ring-foreground/20"
                  : "ring-1 ring-border"
                  }`}
              >
                {plan.badge && (
                  <div
                    className={`absolute top-0 right-0 px-3 py-1 text-xs font-bold rounded-bl-lg ${plan.highlight
                      ? "bg-foreground text-background"
                      : "bg-card text-muted-foreground border-l border-b border-border"
                      }`}
                  >
                    {plan.badge.toUpperCase()}
                  </div>
                )}
                <h3 className="text-2xl font-bold mb-2">{plan.name}</h3>
                <p className="text-muted-foreground text-sm mb-6">{plan.desc}</p>
                <div className="flex items-baseline gap-2 mb-1">
                  <span className="text-5xl font-bold">{getPrice(plan)}</span>
                  <span className="text-muted-foreground text-sm">/mo</span>
                </div>
                {billingAnnual && plan.name !== "Free" && (
                  <p className="text-xs text-brand font-medium mb-6">
                    Billed annually — 2 months free
                  </p>
                )}
                {(!billingAnnual || plan.name === "Free") && (
                  <div className="mb-6" />
                )}
                <ul
                  className="flex-1 space-y-3 mb-8"
                  aria-label={`${plan.name} plan features`}
                >
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-center gap-3">
                      <Check className="w-4 h-4 text-brand shrink-0" />
                      <span className="text-sm">{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={billingAnnual
                    ? (plan.ctaHref.includes('?') ? `${plan.ctaHref}&billing=annual` : `${plan.ctaHref}?billing=annual`)
                    : plan.ctaHref
                  }
                  className={`w-full py-3 rounded-xl font-semibold transition-all block text-center text-sm ${plan.highlight
                    ? "bg-foreground text-background hover:opacity-90"
                    : "bg-muted border border-border text-foreground hover:bg-accent hover:border-border/80"
                    }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>

          <p className="text-center text-sm text-muted-foreground mt-6">
            No credit card required · Cancel anytime · Your data is always yours
          </p>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
            {[
              "No credit card to start",
              "Cancel anytime",
              "7-day Pro trial on all paid plans",
              "Data stays yours",
            ].map((item) => (
              <span key={item} className="flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-brand" />
                {item}
              </span>
            ))}
          </div>

          {/* Trust / transparency contextual links */}
          <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            <Link href="/security" className="hover:text-foreground transition-colors flex items-center gap-1 underline underline-offset-2">
              <ShieldCheck className="w-3.5 h-3.5" /> Security &amp; data trust
            </Link>
            <span aria-hidden="true">·</span>
            <Link href="/methodology" className="hover:text-foreground transition-colors underline underline-offset-2">
              How we measure AEO
            </Link>
            <span aria-hidden="true">·</span>
            <Link href="/changelog" className="hover:text-foreground transition-colors underline underline-offset-2">
              What&apos;s new in OptiAISEO
            </Link>
          </div>
        </div>
      </section>

      {/* ── FAQ ───────────────────────────────────────────────────────────── */}
      <section
        id="faq"
        aria-labelledby="faq-heading"
        className="relative py-24 border-t border-border bg-muted/30"
      >
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2
              id="faq-heading"
              className="text-3xl md:text-5xl font-bold tracking-tight mb-4"
            >
              Frequently asked questions
            </h2>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
              Everything you need to know about OptiAISEO.
            </p>
          </div>

          <div className="space-y-3">
            {faqItems.map((item, idx) => (
              <div key={idx} className="card-surface rounded-xl overflow-hidden">
                <button
                  className="w-full flex items-center justify-between p-6 text-left font-semibold text-base hover:bg-accent transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => setOpenFaqIndex(openFaqIndex === idx ? null : idx)}
                  aria-expanded={openFaqIndex === idx}
                  aria-controls={`faq-panel-${idx}`}
                >
                  {item.name}
                  <ChevronDown
                    className={`w-5 h-5 text-muted-foreground transition-transform duration-300 shrink-0 ml-4 ${openFaqIndex === idx ? "rotate-180" : ""
                      }`}
                  />
                </button>
                <div
                  id={`faq-panel-${idx}`}
                  role="region"
                  aria-label={item.name}
                  className={`grid transition-all duration-300 ease-in-out ${openFaqIndex === idx
                    ? "grid-rows-[1fr] opacity-100"
                    : "grid-rows-[0fr] opacity-0"
                    }`}
                >
                  <div className="overflow-hidden">
                    <p className="p-6 pt-0 text-muted-foreground leading-relaxed pr-8 text-sm">
                      {item.acceptedAnswer.text}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Pre-footer CTA ────────────────────────────────────────────────── */}
      <section className="relative py-24 border-t border-zinc-800/40 bg-zinc-950 text-white overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background:
              "radial-gradient(ellipse 50% 60% at 50% 100%, rgba(16,185,129,0.10) 0%, transparent 70%)",
          }}
        />
        <div className="max-w-4xl mx-auto px-6 text-center relative z-10">
          <h2 className="text-4xl md:text-5xl font-black tracking-tight mb-5">
            Still on the fence?
          </h2>
          <p className="text-lg text-white/70 mb-6 max-w-xl mx-auto">
            No developer needed. Works on WordPress, Ghost, Webflow, or any CMS.
            Your first audit runs in under 2 minutes.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm text-white/60 mb-10">
            {["No code required", "Works on any CMS", "Cancel anytime", "Data exported any time"].map((item) => (
              <span key={item} className="flex items-center gap-1.5">
                <Check className="w-3.5 h-3.5 text-brand" />
                {item}
              </span>
            ))}
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/signup"
              className="w-full sm:w-auto px-8 py-4 rounded-full bg-brand text-white font-bold text-lg hover:opacity-90 transition-all active:scale-95 flex items-center justify-center gap-2"
            >
              <Zap className="w-5 h-5" />
              Get started free
            </Link>
            <span className="text-sm text-white/55 flex items-center gap-1.5">
              <ShieldCheck className="w-4 h-4" />
              No credit card · Cancel anytime
            </span>
          </div>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <footer className="border-t border-border py-12 bg-background">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex flex-col md:flex-row items-center justify-between gap-6 mb-8">
            <div className="flex flex-col items-start gap-2">
              <div className="flex items-center gap-2.5">
                <div
                  className="w-6 h-6 rounded bg-foreground flex items-center justify-center"
                  aria-hidden="true"
                >
                  <span className="font-black text-background text-[9px] tracking-tight">
                    AI
                  </span>
                </div>
                <span className="font-medium text-sm tracking-tight text-muted-foreground">
                  OptiAISEO &copy; {new Date().getFullYear()}
                </span>
              </div>
              <p className="text-xs text-muted-foreground/50 hidden md:block">
                AI Search Visibility &amp; Answer Engine Optimization Platform
              </p>
            </div>

            <nav aria-label="Social media links" className="flex items-center gap-5">
              <a href="https://twitter.com/aiseoseo" target="_blank" rel="noreferrer me noopener" className="text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent" aria-label="OptiAISEO on X (Twitter)">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-4.714-6.231-5.401 6.231H2.742l7.735-8.857L1.254 2.25H8.08l4.261 5.635L18.244 2.25zm-1.161 17.52h1.833L7.084 4.126H5.117L17.083 19.77z" /></svg>
              </a>
              <a href="https://linkedin.com/company/aiseoseo" target="_blank" rel="noreferrer me noopener" className="text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent" aria-label="OptiAISEO on LinkedIn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" /></svg>
              </a>
              <a href="https://instagram.com/aiseoseo" target="_blank" rel="noreferrer me noopener" className="text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent" aria-label="OptiAISEO on Instagram">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z" /></svg>
              </a>
              <a href="https://facebook.com/aiseoseo" target="_blank" rel="noreferrer me noopener" className="text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent" aria-label="OptiAISEO on Facebook">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" /></svg>
              </a>
              <a href="https://youtube.com/@aiseoseo" target="_blank" rel="noreferrer me noopener" className="text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent" aria-label="OptiAISEO on YouTube">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" /></svg>
              </a>
              <a href="https://github.com/kenneth256" target="_blank" rel="noreferrer me noopener" className="text-muted-foreground hover:text-foreground transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent" aria-label="OptiAISEO on GitHub">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" /></svg>
              </a>
            </nav>
          </div>

          <div className="border-t border-border pt-8">
            {/* Footer link columns */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6 mb-8 text-xs">
              {/* Product */}
              <div>
                <p className="font-semibold text-foreground mb-3 uppercase tracking-widest text-[10px]">Product</p>
                <nav aria-label="Product pages" className="flex flex-col gap-2 text-muted-foreground">
                  <Link href="/aria" className="hover:text-foreground transition-colors">Aria Voice Copilot</Link>
                  <Link href="/pricing" className="hover:text-foreground transition-colors">Pricing</Link>
                  <Link href="/changelog" className="hover:text-foreground transition-colors">Changelog</Link>
                  <Link href="/methodology" className="hover:text-foreground transition-colors">AEO Methodology</Link>
                  <Link href="/case-studies" className="hover:text-foreground transition-colors">Case Studies</Link>
                </nav>
              </div>
              {/* Solutions */}
              <div>
                <p className="font-semibold text-foreground mb-3 uppercase tracking-widest text-[10px]">Solutions</p>
                <nav aria-label="Solution pages" className="flex flex-col gap-2 text-muted-foreground">
                  <Link href="/for-agencies" className="hover:text-foreground transition-colors">For Agencies</Link>
                  <Link href="/for-saas" className="hover:text-foreground transition-colors">For SaaS</Link>
                  <Link href="/for-content" className="hover:text-foreground transition-colors">For Content Teams</Link>
                  <Link href="/for-ecommerce" className="hover:text-foreground transition-colors">For E-commerce</Link>
                </nav>
              </div>
              {/* Free Tools */}
              <div>
                <p className="font-semibold text-foreground mb-3 uppercase tracking-widest text-[10px]">Free Tools</p>
                <nav aria-label="Free tools" className="flex flex-col gap-2 text-muted-foreground">
                  <Link href="/free/seo-checker" className="hover:text-foreground transition-colors">Free SEO Checker</Link>
                  <Link href="/free/gso-checker" className="hover:text-foreground transition-colors">Free AI Checker</Link>
                  <Link href="/free/reddit-seo" className="hover:text-foreground transition-colors">Reddit SEO Finder</Link>
                  <Link href="/blog" className="hover:text-foreground transition-colors">SEO Blog</Link>
                </nav>
              </div>
              {/* Compare */}
              <div>
                <p className="font-semibold text-foreground mb-3 uppercase tracking-widest text-[10px]">Compare</p>
                <nav aria-label="Comparison pages" className="flex flex-col gap-2 text-muted-foreground">
                  <Link href="/vs" className="hover:text-foreground transition-colors">All Comparisons</Link>
                  <Link href="/vs/semrush" className="hover:text-foreground transition-colors">vs Semrush</Link>
                  <Link href="/vs/ahrefs" className="hover:text-foreground transition-colors">vs Ahrefs</Link>
                  <Link href="/vs/surfer-seo" className="hover:text-foreground transition-colors">vs Surfer SEO</Link>
                  <Link href="/vs/moz" className="hover:text-foreground transition-colors">vs Moz</Link>
                  <Link href="/vs/clearscope" className="hover:text-foreground transition-colors">vs Clearscope</Link>
                  <Link href="/vs/mangools" className="hover:text-foreground transition-colors">vs Mangools</Link>
                </nav>
              </div>
              {/* Leaderboard */}
              <div>
                <p className="font-semibold text-foreground mb-3 uppercase tracking-widest text-[10px]">Leaderboard</p>
                <nav aria-label="AI SEO Leaderboard" className="flex flex-col gap-2 text-muted-foreground">
                  <Link href="/leaderboard" className="hover:text-foreground transition-colors">All Niches</Link>
                  <Link href="/leaderboard/saas" className="hover:text-foreground transition-colors">SaaS</Link>
                  <Link href="/leaderboard/ecommerce" className="hover:text-foreground transition-colors">Ecommerce</Link>
                  <Link href="/leaderboard/agency" className="hover:text-foreground transition-colors">Agency</Link>
                  <Link href="/leaderboard/blog" className="hover:text-foreground transition-colors">Blog</Link>
                  <Link href="/leaderboard/local" className="hover:text-foreground transition-colors">Local</Link>
                  <Link href="/leaderboard/other" className="hover:text-foreground transition-colors">Other</Link>
                </nav>
              </div>
              {/* Company */}
              <div>
                <p className="font-semibold text-foreground mb-3 uppercase tracking-widest text-[10px]">Company</p>
                <nav aria-label="Company pages" className="flex flex-col gap-2 text-muted-foreground">
                  <Link href="/about" className="hover:text-foreground transition-colors">About</Link>
                  <Link href="/contact" className="hover:text-foreground transition-colors">Contact</Link>
                  <Link href="/security" className="hover:text-foreground transition-colors">Security</Link>
                  <Link href="/terms" className="hover:text-foreground transition-colors">Terms</Link>
                  <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
                </nav>
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t border-border pt-6">
              <p className="text-xs text-muted-foreground/50 text-center sm:text-left">
                AI Search Visibility &amp; Answer Engine Optimization Platform
              </p>
              {/* ScamAdviser trust widget — official embed */}
              <a
                href="https://scamadviser.com/check-website/optiaiseo.online"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Check OptiAISEO on ScamAdviser — Verified Trusted Site"
                className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  <polyline points="9 12 11 14 15 10" />
                </svg>
                Verified on ScamAdviser
              </a>
              <p className="text-xs text-muted-foreground/40 text-center sm:text-right">
                © {new Date().getFullYear()} OptiAISEO. All rights reserved.
              </p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}