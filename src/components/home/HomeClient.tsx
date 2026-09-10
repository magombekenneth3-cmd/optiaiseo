"use client";

import { useEffect, useRef, useState } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  BarChart3,
  Bot,
  Check,
  ChevronDown,
  CircleCheck,
  FileText,
  Gauge,
  GitPullRequest,
  Globe2,
  Menu,
  Mic,
  ScanSearch,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  TrendingUp,
  UploadCloud,
  WandSparkles,
  X,
  Zap,
} from "lucide-react";

interface FaqItem {
  name: string;
  acceptedAnswer: {
    text: string;
  };
}

interface HomeClientProps {
  faqItems: FaqItem[];
  stats: {
    siteCount: number;
    weeklySignups: number;
    auditCount: number;
    blogCount: number;
  };
}

const PLANS = [
  {
    name: "Free",
    price: { monthly: "$0", annual: "$0" },
    desc: "Connect your site and see how visible your brand is in AI search.",
    features: [
      "1 website",
      "5 audits per month",
      "Basic AI visibility check",
      "3 AI blog posts per month",
      "Google Search Console integration",
      "50 credits / month",
    ],
    cta: "Start free",
    ctaHref: "/signup",
    highlight: false,
    badge: null,
  },
  {
    name: "Starter",
    price: { monthly: "$19", annual: "$15" },
    desc: "For creators and small sites building consistent search visibility.",
    features: [
      "3 websites",
      "15 audits / month",
      "150 credits / month",
      "30 AI blog posts / month",
      "On-page optimisation",
      "Rank tracking",
      "Competitor tracking",
    ],
    cta: "Start Starter trial",
    ctaHref: "/signup?plan=starter",
    highlight: false,
    badge: "New",
  },
  {
    name: "Pro",
    price: { monthly: "$49", annual: "$39" },
    desc: "For growing teams that want AI visibility, automation, and measurable outcomes.",
    features: [
      "10 websites",
      "500 credits / month",
      "30 audits / month",
      "Unlimited AI blog posts",
      "GitHub auto-fix PRs",
      "AI visibility across 4 engines",
      "Competitor gap analysis",
      "Aria voice agent",
    ],
    cta: "Start Pro trial",
    ctaHref: "/signup?plan=pro",
    highlight: true,
    badge: "Most popular",
  },
  {
    name: "Agency",
    price: { monthly: "$149", annual: "$119" },
    desc: "For agencies managing multiple clients and websites at scale.",
    features: [
      "Unlimited websites",
      "2,000 credits / month",
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

const WORKFLOW = [
  {
    step: "01",
    title: "Find the gaps",
    desc: "Discover where AI search engines are missing, ignoring, or under-citing your brand.",
    icon: Search,
  },
  {
    step: "02",
    title: "Fix the content",
    desc: "Generate the pages, schema, entity signals, and technical fixes needed to close the gaps.",
    icon: FileText,
  },
  {
    step: "03",
    title: "Publish",
    desc: "Push approved changes to your CMS or ship them through GitHub pull requests.",
    icon: UploadCloud,
  },
  {
    step: "04",
    title: "Measure",
    desc: "Track whether ChatGPT, Claude, Perplexity, and Google AI start citing you more often.",
    icon: BarChart3,
  },
];

const CAPABILITIES = [
  {
    icon: ScanSearch,
    eyebrow: "AI visibility",
    title: "Know where AI finds you",
    desc: "Track citations, mentions, and visibility across major answer engines from one dashboard.",
  },
  {
    icon: Target,
    eyebrow: "Opportunities",
    title: "See exactly what you're missing",
    desc: "Find high-value prompts, topics, pages, and entities where competitors are winning citations.",
  },
  {
    icon: WandSparkles,
    eyebrow: "Automatic fixes",
    title: "Turn insight into action",
    desc: "Generate schema, content, metadata, internal links, and GitHub fixes without a manual ticket queue.",
  },
  {
    icon: Gauge,
    eyebrow: "Measurement",
    title: "Prove the change worked",
    desc: "Compare before and after visibility so every optimization has a measurable outcome.",
  },
];

const ENGINE_ROWS = [
  { name: "ChatGPT", short: "GPT", score: 81, delta: "+28%" },
  { name: "Perplexity", short: "P", score: 67, delta: "+18%" },
  { name: "Claude", short: "C", score: 61, delta: "+22%" },
  { name: "Google AI", short: "G", score: 54, delta: "+19%" },
];

const COMPETITOR_ROWS = [
  { name: "ChatGPT", yourBrand: 14, competitorA: 38, competitorB: 27 },
  { name: "Perplexity", yourBrand: 9, competitorA: 31, competitorB: 22 },
  { name: "Claude", yourBrand: 11, competitorA: 26, competitorB: 19 },
  { name: "Google AI", yourBrand: 7, competitorA: 29, competitorB: 18 },
];

function BrandMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`flex shrink-0 items-center justify-center rounded-lg bg-white text-black ${compact ? "h-7 w-7" : "h-8 w-8"
          }`}
      >
        <span className="text-[10px] font-black tracking-tight">AI</span>
      </div>
      <div className="leading-none">
        <div className="text-sm font-bold tracking-tight text-white">OptiAISEO</div>
        {!compact && (
          <div className="mt-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-emerald-400">
            AI SEO Platform
          </div>
        )}
      </div>
    </div>
  );
}

function VisibilityDashboard() {
  return (
    <div className="relative mx-auto w-full max-w-[670px]">
      <div className="absolute -inset-8 rounded-[40px] bg-emerald-400/10 blur-3xl" aria-hidden="true" />

      <div className="relative overflow-hidden rounded-[22px] border border-emerald-400/35 bg-[#0a1014] p-2 shadow-[0_35px_90px_rgba(0,0,0,0.45)]">
        <div className="grid min-h-[470px] grid-cols-[118px_1fr] overflow-hidden rounded-[17px] border border-white/5 bg-[#0c1318]">
          <aside className="hidden border-r border-white/5 bg-[#0a1014] p-3 sm:block">
            <div className="mb-5 flex items-center gap-2 px-1">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-white text-[8px] font-black text-black">
                AI
              </div>
              <span className="text-[11px] font-bold text-white">OptiAISEO</span>
            </div>

            <div className="space-y-1">
              {["Overview", "Competitors", "Opportunities", "Content", "Publishing", "Reports", "Settings"].map(
                (item, index) => (
                  <div
                    key={item}
                    className={`rounded-md px-2 py-2 text-[9px] ${index === 0
                      ? "bg-emerald-400/15 font-semibold text-emerald-200"
                      : "text-white/45"
                      }`}
                  >
                    {item}
                  </div>
                ),
              )}
            </div>
          </aside>

          <div className="min-w-0 p-3 sm:p-4">
            <div className="rounded-xl border border-white/5 bg-[#101a20] p-4">
              <div className="text-[10px] font-semibold text-white/55">AI Visibility Score</div>
              <div className="mt-2 flex items-end justify-between gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-4xl font-black tracking-tight text-white">42</span>
                  <ArrowRight className="h-5 w-5 text-white/25" />
                  <span className="text-4xl font-black tracking-tight text-emerald-400">78</span>
                  <span className="mb-1 text-xs font-bold text-emerald-400">+36</span>
                </div>
                <svg className="hidden h-16 w-32 sm:block" viewBox="0 0 140 60" aria-hidden="true">
                  <polyline
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="text-emerald-400"
                    points="0,48 18,45 36,47 52,39 69,34 84,24 99,21 114,10 126,9 140,3"
                  />
                </svg>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
              {ENGINE_ROWS.map((engine) => (
                <div key={engine.name} className="rounded-xl border border-white/5 bg-[#101a20] p-3">
                  <div className="flex items-center gap-2">
                    <div className="flex h-5 w-5 items-center justify-center rounded-full bg-white/5 text-[8px] font-black text-white/60">
                      {engine.short}
                    </div>
                    <span className="truncate text-[9px] text-white/55">{engine.name}</span>
                  </div>
                  <div className="mt-3 text-2xl font-bold text-white">{engine.score}%</div>
                  <div className="mt-1 text-[8px] font-semibold text-emerald-400">{engine.delta}</div>
                </div>
              ))}
            </div>

            <div className="mt-3 flex items-center justify-between rounded-xl border border-emerald-400/10 bg-emerald-400/10 p-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-300 text-black">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <div className="truncate text-xs font-semibold text-white">17 citation opportunities found</div>
                  <div className="mt-1 truncate text-[8px] text-white/40">
                    Your brand is missing from 17 relevant AI queries.
                  </div>
                </div>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-emerald-300" />
            </div>

            <div className="mt-3 rounded-xl border border-white/5 bg-[#101a20] p-3">
              <div className="mb-3 text-[10px] font-semibold text-white/65">Recent activity</div>
              <div className="space-y-3">
                {[
                  ["Published 3 optimized pages", "2h ago"],
                  ["Updated structured data", "4h ago"],
                  ["New citation detected (ChatGPT)", "6h ago"],
                ].map(([label, time]) => (
                  <div key={label} className="flex items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <CircleCheck className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                      <span className="truncate text-[9px] text-white/55">{label}</span>
                    </div>
                    <span className="shrink-0 text-[8px] text-white/30">{time}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="mt-2 text-right text-[8px] text-white/25">Example dashboard</div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ComparisonTable() {
  return (
    <div className="overflow-hidden rounded-2xl border border-white/10 bg-[#101a20]">
      <div className="border-b border-white/8 px-5 py-4 text-sm font-semibold text-white">
        AI citations comparison
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[560px] p-4">
          <div className="grid grid-cols-[1.2fr_repeat(3,1fr)] gap-1 px-3 pb-2 text-[10px] font-semibold text-white/45">
            <span />
            <span className="text-center text-emerald-300">Your Brand</span>
            <span className="text-center">Competitor A</span>
            <span className="text-center">Competitor B</span>
          </div>

          {COMPETITOR_ROWS.map((row) => (
            <div
              key={row.name}
              className="grid grid-cols-[1.2fr_repeat(3,1fr)] items-center gap-1 border-t border-white/5 px-3 py-3"
            >
              <div className="text-xs font-medium text-white/70">{row.name}</div>
              <div className="rounded-md bg-emerald-400/10 py-2 text-center text-xs font-bold text-emerald-300">
                {row.yourBrand}
              </div>
              <div className="py-2 text-center text-xs font-semibold text-white/60">{row.competitorA}</div>
              <div className="py-2 text-center text-xs font-semibold text-white/60">{row.competitorB}</div>
            </div>
          ))}

          <div className="mt-2 grid grid-cols-[1.2fr_repeat(3,1fr)] items-center gap-1 rounded-lg bg-white/[0.035] px-3 py-3">
            <div className="text-xs font-semibold text-white">AI Visibility Score</div>
            <div className="rounded-md bg-emerald-400/20 py-2 text-center text-sm font-black text-emerald-300">34</div>
            <div className="py-2 text-center text-sm font-black text-emerald-300">78</div>
            <div className="py-2 text-center text-sm font-black text-white/70">61</div>
          </div>
        </div>
      </div>

      <div className="px-5 pb-4 text-right text-[10px] text-white/30">Example comparison data</div>
    </div>
  );
}

function ResultPreview() {
  return (
    <div className="rounded-2xl border border-black/10 bg-white p-5 shadow-[0_20px_60px_rgba(15,23,42,0.08)]">
      <div className="flex items-center gap-2 border-b border-black/5 pb-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-black text-[9px] font-black text-white">
          AI
        </div>
        <span className="text-xs font-semibold text-zinc-900">AI answer preview</span>
      </div>

      <div className="mt-5 rounded-full bg-zinc-100 px-4 py-2 text-[10px] text-zinc-600">
        Best project management tools for remote teams
      </div>

      <p className="mt-5 text-[10px] leading-5 text-zinc-500">
        Here are some of the top project management tools for remote teams:
      </p>

      <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50/60 p-4">
        <div className="flex items-start gap-3">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-[8px] font-black text-white">
            1
          </div>
          <div>
            <div className="text-xs font-bold text-zinc-900">Your brand</div>
            <div className="mt-1 text-[10px] text-zinc-500">
              Strong entity coverage, clear supporting content, and structured data.
            </div>
            <div className="mt-2 flex items-center gap-1 text-[9px] font-semibold text-emerald-600">
              <CircleCheck className="h-3 w-3" />
              Cited from your website
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 space-y-2">
        {["Competitor A", "Competitor B"].map((name, index) => (
          <div key={name} className="flex items-center gap-3 px-3 py-2 text-[10px] text-zinc-400">
            <div className="flex h-5 w-5 items-center justify-center rounded-full bg-zinc-100 text-[8px]">
              {index + 2}
            </div>
            {name}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function HomeClient({ faqItems, stats }: HomeClientProps) {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [isScrolled, setIsScrolled] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [solutionsOpen, setSolutionsOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null);
  const [billingAnnual, setBillingAnnual] = useState(false);
  const [website, setWebsite] = useState("");

  const solutionsRef = useRef<HTMLDivElement>(null);
  const resourcesRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      router.replace("/dashboard");
    }
  }, [status, session, router]);

  useEffect(() => {
    const onScroll = () => setIsScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    document.body.style.overflow = mobileNavOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [mobileNavOpen]);

  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;

      if (solutionsRef.current && !solutionsRef.current.contains(target)) {
        setSolutionsOpen(false);
      }

      if (resourcesRef.current && !resourcesRef.current.contains(target)) {
        setResourcesOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMobileNavOpen(false);
        setSolutionsOpen(false);
        setResourcesOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const getPrice = (plan: (typeof PLANS)[number]) =>
    billingAnnual ? plan.price.annual : plan.price.monthly;

  const visibilityHref = website.trim()
    ? `/free/gso-checker?url=${encodeURIComponent(website.trim())}`
    : "/free/gso-checker";

  const metricItems = [
    {
      value: stats.siteCount > 0 ? `${stats.siteCount.toLocaleString()}+` : "100+",
      label: "Sites connected",
      icon: Globe2,
    },
    {
      value:
        stats.auditCount > 1000
          ? `${Math.round(stats.auditCount / 1000)}k+`
          : stats.auditCount > 0
            ? `${stats.auditCount.toLocaleString()}+`
            : "1,000+",
      label: "Audits completed",
      icon: ScanSearch,
    },
    {
      value: stats.blogCount > 0 ? `${stats.blogCount.toLocaleString()}+` : "500+",
      label: "Pages & posts created",
      icon: FileText,
    },
    {
      value: stats.weeklySignups > 0 ? `${stats.weeklySignups.toLocaleString()}+` : "Growing",
      label: "New users this week",
      icon: TrendingUp,
    },
  ];

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f7f9f8] text-zinc-950">
      {/* Navigation */}
      <header
        className={`fixed inset-x-0 top-0 z-50 transition-all duration-300 ${isScrolled
          ? "border-b border-white/8 bg-[#071013]/90 shadow-lg shadow-black/10 backdrop-blur-xl"
          : "bg-[#071013]"
          }`}
      >
        <div className="mx-auto flex h-[72px] max-w-7xl items-center justify-between px-5 sm:px-6">
          <Link href="/" aria-label="OptiAISEO home">
            <BrandMark />
          </Link>

          <nav className="hidden items-center gap-7 text-[13px] font-medium text-white/70 lg:flex">
            <div ref={solutionsRef} className="relative">
              <button
                type="button"
                onClick={() => setSolutionsOpen((open) => !open)}
                className="inline-flex items-center gap-1.5 transition-colors hover:text-white"
                aria-expanded={solutionsOpen}
              >
                Solutions
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${solutionsOpen ? "rotate-180" : ""}`} />
              </button>

              {solutionsOpen && (
                <div className="absolute left-0 top-full mt-3 w-56 rounded-xl border border-white/10 bg-[#0d171b] p-2 shadow-2xl">
                  {[
                    ["/for-agencies", "For Agencies"],
                    ["/for-saas", "For SaaS Companies"],
                    ["/for-content", "For Content Teams"],
                    ["/for-ecommerce", "For E-commerce"],
                  ].map(([href, label]) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setSolutionsOpen(false)}
                      className="block rounded-lg px-3 py-2.5 text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white"
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <a href="#how-it-works" className="transition-colors hover:text-white">
              How it works
            </a>

            <a href="#features" className="transition-colors hover:text-white">
              Features
            </a>

            <a href="#pricing" className="transition-colors hover:text-white">
              Pricing
            </a>

            <div ref={resourcesRef} className="relative">
              <button
                type="button"
                onClick={() => setResourcesOpen((open) => !open)}
                className="inline-flex items-center gap-1.5 transition-colors hover:text-white"
                aria-expanded={resourcesOpen}
              >
                Resources
                <ChevronDown className={`h-3.5 w-3.5 transition-transform ${resourcesOpen ? "rotate-180" : ""}`} />
              </button>

              {resourcesOpen && (
                <div className="absolute left-0 top-full mt-3 w-56 rounded-xl border border-white/10 bg-[#0d171b] p-2 shadow-2xl">
                  {[
                    ["/blog", "SEO & AI Search Blog"],
                    ["/case-studies", "Case Studies"],
                    ["/methodology", "AEO Methodology"],
                    ["/leaderboard", "AI SEO Leaderboard"],
                    ["/vs", "Comparisons"],
                  ].map(([href, label]) => (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setResourcesOpen(false)}
                      className="block rounded-lg px-3 py-2.5 text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white"
                    >
                      {label}
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <Link
              href="/aria"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/20 bg-emerald-400/5 px-3 py-1.5 font-semibold text-emerald-300 transition hover:bg-emerald-400/10"
            >
              <Mic className="h-3.5 w-3.5" />
              Aria AI Copilot
              <span className="rounded-full bg-emerald-300 px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wide text-black">
                New
              </span>
            </Link>
          </nav>

          <div className="hidden items-center gap-5 lg:flex">
            <Link href="/login" className="text-sm font-medium text-white/65 transition-colors hover:text-white">
              Log in
            </Link>
            <Link
              href="/signup"
              className="rounded-full bg-emerald-300 px-5 py-2.5 text-sm font-bold text-black transition hover:bg-emerald-200"
            >
              Get started free
            </Link>
          </div>

          <button
            type="button"
            onClick={() => setMobileNavOpen(true)}
            className="rounded-lg p-2 text-white/70 transition hover:bg-white/5 hover:text-white lg:hidden"
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Mobile navigation */}
      {mobileNavOpen && (
        <>
          <button
            type="button"
            aria-label="Close navigation overlay"
            className="fixed inset-0 z-50 bg-black/65 backdrop-blur-sm lg:hidden"
            onClick={() => setMobileNavOpen(false)}
          />
          <div className="fixed inset-y-0 right-0 z-[60] flex w-[86%] max-w-sm flex-col border-l border-white/10 bg-[#081115] p-5 text-white shadow-2xl lg:hidden">
            <div className="flex items-center justify-between border-b border-white/10 pb-5">
              <BrandMark />
              <button
                type="button"
                onClick={() => setMobileNavOpen(false)}
                className="rounded-lg p-2 text-white/65 hover:bg-white/5 hover:text-white"
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex flex-1 flex-col gap-1 overflow-y-auto py-6 text-sm">
              {[
                ["/free/gso-checker", "Check AI visibility"],
                ["#how-it-works", "How it works"],
                ["#features", "Features"],
                ["#pricing", "Pricing"],
                ["/aria", "Aria AI Copilot"],
                ["/for-agencies", "For Agencies"],
                ["/for-saas", "For SaaS Companies"],
                ["/blog", "Resources"],
                ["/case-studies", "Case Studies"],
              ].map(([href, label]) => (
                <a
                  key={href}
                  href={href}
                  onClick={() => setMobileNavOpen(false)}
                  className="rounded-xl px-3 py-3 font-medium text-white/70 transition hover:bg-white/5 hover:text-white"
                >
                  {label}
                </a>
              ))}
            </nav>

            <div className="space-y-3 border-t border-white/10 pt-5">
              <Link
                href="/login"
                onClick={() => setMobileNavOpen(false)}
                className="block w-full rounded-xl border border-white/10 py-3 text-center text-sm font-semibold text-white"
              >
                Log in
              </Link>
              <Link
                href="/signup"
                onClick={() => setMobileNavOpen(false)}
                className="block w-full rounded-xl bg-emerald-300 py-3 text-center text-sm font-bold text-black"
              >
                Get started free
              </Link>
            </div>
          </div>
        </>
      )}

      <main>
        {/* Hero */}
        <section className="relative overflow-hidden bg-[#071013] pt-[72px] text-white">
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
            <div className="absolute left-[38%] top-20 h-[520px] w-[520px] rounded-full bg-emerald-500/[0.08] blur-[110px]" />
            <div className="absolute -right-48 top-40 h-[640px] w-[640px] rounded-full border border-emerald-400/[0.08]" />
            <div className="absolute -right-24 top-64 h-[420px] w-[420px] rounded-full border border-emerald-400/[0.07]" />
            <div className="absolute bottom-[-180px] left-[36%] h-[420px] w-[420px] rounded-full bg-emerald-400/[0.05] blur-[100px]" />
          </div>

          <div className="relative mx-auto grid min-h-[690px] max-w-7xl items-center gap-12 px-5 py-16 sm:px-6 md:py-20 lg:grid-cols-[0.87fr_1.13fr] lg:gap-16 lg:py-24">
            <div className="max-w-xl">
              <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/10 px-3 py-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-300 shadow-[0_0_18px_rgba(110,231,183,0.9)]" />
                <span className="text-[11px] font-semibold text-emerald-200">
                  LIVE · AI citation tracking across ChatGPT, Claude, Perplexity & Google AI
                </span>
              </div>

              <h1 className="max-w-[650px] text-[52px] font-black leading-[0.96] tracking-[-0.055em] sm:text-6xl md:text-7xl">
                Get your brand
                <span className="block text-emerald-300">cited by AI.</span>
              </h1>

              <p className="mt-7 max-w-[590px] text-base leading-7 text-white/62 sm:text-lg">
                OptiAISEO finds why ChatGPT, Claude, Perplexity and Google AI are not citing you — then helps fix
                your site, publish the changes, and measure the results.
              </p>

              <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center">
                <Link
                  href="/free/gso-checker"
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-emerald-300 px-7 text-sm font-black text-black transition hover:bg-emerald-200 active:scale-[0.98]"
                >
                  Check my AI visibility
                  <ArrowRight className="h-4 w-4" />
                </Link>

                <Link
                  href="/aria"
                  className="inline-flex min-h-12 items-center justify-center gap-3 rounded-full px-2 text-sm font-semibold text-white/70 transition hover:text-white sm:justify-start"
                >
                  <span className="flex h-10 w-10 items-center justify-center rounded-full border border-white/10 bg-white/5">
                    <Mic className="h-4 w-4" />
                  </span>
                  Watch Aria in action · 60 sec
                </Link>
              </div>

              <div className="mt-4 text-xs text-white/35">Free · No credit card required</div>
            </div>

            <VisibilityDashboard />
          </div>
        </section>

        {/* Live stats */}
        <section className="border-b border-zinc-200 bg-white">
          <div className="mx-auto grid max-w-7xl grid-cols-2 px-5 sm:px-6 md:grid-cols-4">
            {metricItems.map(({ value, label, icon: Icon }, index) => (
              <div
                key={label}
                className={`flex items-center gap-3 py-7 md:px-6 ${index !== metricItems.length - 1 ? "md:border-r md:border-zinc-200" : ""
                  }`}
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-50">
                  <Icon className="h-4 w-4 text-emerald-600" />
                </div>
                <div>
                  <div className="text-xl font-black tracking-tight text-zinc-950 sm:text-2xl">{value}</div>
                  <div className="mt-1 text-[11px] leading-4 text-zinc-500">{label}</div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* How it works */}
        <section id="how-it-works" className="bg-[#fbfcfb] py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-6">
            <div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:items-start">
              <div className="max-w-lg">
                <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
                  <Sparkles className="h-3 w-3" />
                  How it works
                </div>

                <h2 className="text-4xl font-black leading-[1.02] tracking-[-0.045em] sm:text-5xl">
                  From invisible to <span className="text-emerald-500">cited.</span>
                </h2>

                <p className="mt-5 max-w-md text-base leading-7 text-zinc-600">
                  Find the gaps, fix the content, publish what matters, and measure whether AI engines start citing
                  your brand.
                </p>

                <Link
                  href="/methodology"
                  className="mt-7 inline-flex items-center gap-2 rounded-full border border-zinc-300 px-5 py-2.5 text-sm font-bold text-zinc-900 transition hover:border-zinc-900"
                >
                  Learn how we measure
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="relative">
                <div className="absolute left-[12%] right-[12%] top-7 hidden h-px bg-zinc-200 md:block" />
                <div className="grid gap-8 md:grid-cols-4">
                  {WORKFLOW.map(({ step, title, desc, icon: Icon }) => (
                    <div key={step} className="relative">
                      <div className="relative z-10 flex h-14 w-14 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50">
                        <Icon className="h-5 w-5 text-emerald-600" />
                      </div>
                      <div className="mt-4 text-xs font-black text-zinc-500">{step}</div>
                      <h3 className="mt-2 text-base font-black tracking-tight text-zinc-950">{title}</h3>
                      <p className="mt-2 text-xs leading-5 text-zinc-500">{desc}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Competitor comparison */}
        <section className="relative overflow-hidden bg-[#081115] py-20 text-white sm:py-24">
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
            <div className="absolute right-[-120px] top-[-120px] h-[450px] w-[450px] rounded-full bg-emerald-400/[0.06] blur-[80px]" />
          </div>

          <div className="relative mx-auto grid max-w-7xl gap-12 px-5 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div className="max-w-lg">
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-300">
                <Target className="h-3 w-3" />
                See the difference
              </div>

              <h2 className="text-4xl font-black leading-[1.04] tracking-[-0.045em] sm:text-5xl">
                Your competitors are already <span className="text-emerald-300">getting cited.</span>
              </h2>

              <p className="mt-5 text-base leading-7 text-white/60">
                See where they are winning, which AI engines mention them, and what your site needs to close the gap.
              </p>

              <Link
                href="/free/gso-checker"
                className="mt-7 inline-flex items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-black transition hover:bg-emerald-100"
              >
                Compare your brand
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>

            <ComparisonTable />
          </div>
        </section>

        {/* Results */}
        <section className="bg-white py-20 sm:py-24">
          <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-6 lg:grid-cols-2 lg:items-center">
            <ResultPreview />

            <div className="max-w-xl lg:pl-10">
              <div className="mb-4 inline-flex rounded-full bg-emerald-100 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-700">
                Real outcomes
              </div>

              <h2 className="text-4xl font-black leading-[1.02] tracking-[-0.045em] sm:text-5xl">
                Get more visibility.
                <br />
                Drive more revenue.
              </h2>

              <p className="mt-5 text-base leading-7 text-zinc-600">
                More citations create more chances to be discovered, evaluated, and trusted before a buyer ever
                reaches your website.
              </p>

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {[
                  "AI visibility reports",
                  "Competitor insights",
                  "Automatic fixes",
                  "Before / after measurement",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2 text-sm font-semibold text-zinc-700">
                    <CircleCheck className="h-4 w-4 text-emerald-500" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Capabilities */}
        <section id="features" className="border-y border-zinc-200 bg-[#f6f8f7] py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <div className="mb-4 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-600">
                Built for AI search
              </div>
              <h2 className="text-4xl font-black tracking-[-0.045em] sm:text-5xl">
                Everything you need to earn more AI citations.
              </h2>
              <p className="mt-5 text-base leading-7 text-zinc-600">
                Move from reporting to execution with one workflow for discovery, optimization, publishing, and
                measurement.
              </p>
            </div>

            <div className="mt-12 grid gap-5 md:grid-cols-2 xl:grid-cols-4">
              {CAPABILITIES.map(({ icon: Icon, eyebrow, title, desc }) => (
                <article
                  key={title}
                  className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-[0_16px_45px_rgba(15,23,42,0.04)] transition hover:-translate-y-1 hover:border-emerald-300"
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50">
                    <Icon className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div className="mt-5 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-600">
                    {eyebrow}
                  </div>
                  <h3 className="mt-2 text-lg font-black tracking-tight text-zinc-950">{title}</h3>
                  <p className="mt-3 text-sm leading-6 text-zinc-500">{desc}</p>
                </article>
              ))}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                "Technical SEO audits",
                "Competitor keyword gaps",
                "Content planner",
                "Auto indexing",
                "Content decay alerts",
                "Internal link optimizer",
                "Knowledge graph feed",
                "AEO rank tracking",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-3">
                  <Check className="h-4 w-4 text-emerald-500" />
                  <span className="text-xs font-semibold text-zinc-600">{item}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Aria */}
        <section className="relative overflow-hidden bg-[#071013] py-20 text-white sm:py-24">
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
            <div className="absolute left-[-160px] top-[-160px] h-[460px] w-[460px] rounded-full bg-emerald-400/[0.08] blur-[90px]" />
          </div>

          <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-5 sm:px-6 lg:grid-cols-[0.72fr_1.28fr]">
            <div className="flex justify-center">
              <div className="relative flex h-64 w-64 items-center justify-center">
                <div className="absolute inset-0 rounded-full border border-emerald-300/15" />
                <div className="absolute inset-7 rounded-full border border-emerald-300/15" />
                <div className="absolute inset-14 rounded-full border border-emerald-300/15" />
                <div className="absolute inset-0 rounded-full bg-emerald-400/[0.04] blur-xl" />
                <div className="relative flex h-24 w-24 items-center justify-center rounded-full border border-emerald-300/30 bg-emerald-300/10 shadow-[0_0_60px_rgba(52,211,153,0.15)]">
                  <Mic className="h-9 w-9 text-emerald-300" />
                </div>
              </div>
            </div>

            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-emerald-400/15 bg-emerald-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-300">
                <Bot className="h-3 w-3" />
                Aria AI Copilot
              </div>

              <h2 className="text-4xl font-black leading-[1.03] tracking-[-0.045em] sm:text-5xl">
                Tell Aria what you want fixed.
                <span className="block text-emerald-300">She can take action.</span>
              </h2>

              <p className="mt-5 max-w-2xl text-base leading-7 text-white/60">
                Ask questions by voice, review audit findings, create fixes, and open GitHub pull requests without
                digging through dashboards.
              </p>

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                {[
                  [Activity, '"Audit my homepage and show the top issues."'],
                  [ScanSearch, '"Why are competitors cited more often?"'],
                  [GitPullRequest, '"Open a PR to fix the missing schema."'],
                  [TrendingUp, '"Which pages are losing visibility?"'],
                ].map(([Icon, text], index) => {
                  const TypedIcon = Icon as typeof Activity;
                  return (
                    <div key={index} className="flex gap-3 rounded-xl border border-white/8 bg-white/[0.035] p-4">
                      <TypedIcon className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                      <span className="text-sm leading-5 text-white/55">{text as string}</span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link
                  href="/aria"
                  className="inline-flex items-center gap-2 rounded-full bg-emerald-300 px-6 py-3 text-sm font-black text-black transition hover:bg-emerald-200"
                >
                  <Mic className="h-4 w-4" />
                  See Aria in action
                  <ArrowRight className="h-4 w-4" />
                </Link>

                <Link
                  href="/signup"
                  className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-bold text-white transition hover:bg-white/10"
                >
                  Start free trial
                </Link>
              </div>
            </div>
          </div>
        </section>

        {/* Integrations */}
        <section className="border-b border-zinc-200 bg-white py-14">
          <div className="mx-auto max-w-7xl px-5 text-center sm:px-6">
            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">
              AI engines we monitor
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm font-bold text-zinc-500 sm:text-base">
              {["ChatGPT", "Claude", "Perplexity", "Google AI"].map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>

            <div className="mx-auto my-8 h-px max-w-3xl bg-zinc-100" />

            <div className="text-[10px] font-black uppercase tracking-[0.16em] text-zinc-400">
              Works with your publishing stack
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-10 gap-y-4 text-sm font-semibold text-zinc-400">
              {["Google Search Console", "GitHub", "WordPress", "Ghost"].map((name) => (
                <span key={name}>{name}</span>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="bg-[#f7f9f8] py-20 sm:py-24">
          <div className="mx-auto max-w-7xl px-5 sm:px-6">
            <div className="mx-auto max-w-2xl text-center">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-600">Pricing</div>
              <h2 className="mt-3 text-4xl font-black tracking-[-0.045em] sm:text-5xl">
                Simple, transparent pricing.
              </h2>
              <p className="mt-4 text-base text-zinc-600">Start free. Upgrade when you need more automation.</p>

              <div className="mt-7 inline-flex items-center rounded-full border border-zinc-200 bg-white p-1 shadow-sm">
                <button
                  type="button"
                  onClick={() => setBillingAnnual(false)}
                  className={`rounded-full px-4 py-2 text-xs font-bold transition ${!billingAnnual ? "bg-zinc-950 text-white" : "text-zinc-500"
                    }`}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setBillingAnnual(true)}
                  className={`rounded-full px-4 py-2 text-xs font-bold transition ${billingAnnual ? "bg-zinc-950 text-white" : "text-zinc-500"
                    }`}
                >
                  Annual · Save 20%
                </button>
              </div>
            </div>

            <div className="mx-auto mt-12 grid max-w-6xl gap-5 md:grid-cols-2 xl:grid-cols-4">
              {PLANS.map((plan) => (
                <article
                  key={plan.name}
                  className={`relative flex flex-col overflow-hidden rounded-2xl bg-white p-6 ${plan.highlight
                    ? "border-2 border-emerald-400 shadow-[0_22px_70px_rgba(16,185,129,0.12)]"
                    : "border border-zinc-200"
                    }`}
                >
                  {plan.badge && (
                    <div
                      className={`absolute right-4 top-4 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.1em] ${plan.highlight
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-zinc-100 text-zinc-500"
                        }`}
                    >
                      {plan.badge}
                    </div>
                  )}

                  <h3 className="text-xl font-black tracking-tight">{plan.name}</h3>
                  <p className="mt-3 min-h-[56px] text-sm leading-5 text-zinc-500">{plan.desc}</p>

                  <div className="mt-6 flex items-end gap-2">
                    <span className="text-4xl font-black tracking-tight">{getPrice(plan)}</span>
                    <span className="mb-1 text-sm text-zinc-400">/mo</span>
                  </div>

                  {billingAnnual && plan.name !== "Free" ? (
                    <div className="mt-1 text-[10px] font-semibold text-emerald-600">Billed annually</div>
                  ) : (
                    <div className="mt-1 h-[15px]" />
                  )}

                  <ul className="mt-6 flex-1 space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-2 text-sm text-zinc-600">
                        <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  <Link
                    href={
                      billingAnnual
                        ? plan.ctaHref.includes("?")
                          ? `${plan.ctaHref}&billing=annual`
                          : `${plan.ctaHref}?billing=annual`
                        : plan.ctaHref
                    }
                    className={`mt-8 block rounded-xl py-3 text-center text-sm font-black transition ${plan.highlight
                      ? "bg-emerald-300 text-black hover:bg-emerald-200"
                      : "border border-zinc-200 bg-zinc-50 text-zinc-950 hover:bg-zinc-100"
                      }`}
                  >
                    {plan.cta}
                  </Link>
                </article>
              ))}
            </div>

            <div className="mt-8 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs font-medium text-zinc-500">
              {["No card required to start", "Cancel anytime", "Your data stays yours"].map((item) => (
                <span key={item} className="inline-flex items-center gap-1.5">
                  <ShieldCheck className="h-4 w-4 text-emerald-500" />
                  {item}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-t border-zinc-200 bg-white py-20 sm:py-24">
          <div className="mx-auto max-w-4xl px-5 sm:px-6">
            <div className="text-center">
              <div className="text-[10px] font-black uppercase tracking-[0.16em] text-emerald-600">FAQ</div>
              <h2 className="mt-3 text-4xl font-black tracking-[-0.045em] sm:text-5xl">
                Frequently asked questions.
              </h2>
            </div>

            <div className="mt-10 space-y-3">
              {faqItems.map((item, index) => {
                const open = openFaqIndex === index;

                return (
                  <div key={`${item.name}-${index}`} className="overflow-hidden rounded-2xl border border-zinc-200">
                    <button
                      type="button"
                      className="flex w-full items-center justify-between gap-4 px-5 py-5 text-left text-sm font-bold text-zinc-950 sm:px-6"
                      onClick={() => setOpenFaqIndex(open ? null : index)}
                      aria-expanded={open}
                      aria-controls={`faq-${index}`}
                    >
                      <span>{item.name}</span>
                      <ChevronDown
                        className={`h-5 w-5 shrink-0 text-zinc-400 transition-transform ${open ? "rotate-180" : ""}`}
                      />
                    </button>

                    <div
                      id={`faq-${index}`}
                      className={`grid transition-all duration-300 ${open ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
                        }`}
                    >
                      <div className="overflow-hidden">
                        <p className="px-5 pb-5 text-sm leading-6 text-zinc-500 sm:px-6">{item.acceptedAnswer.text}</p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="relative overflow-hidden bg-[#05231d] py-16 text-white sm:py-20">
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
            <div className="absolute left-[-100px] top-[-240px] h-[550px] w-[550px] rounded-full border border-emerald-300/10" />
            <div className="absolute right-[-160px] bottom-[-300px] h-[650px] w-[650px] rounded-full border border-emerald-300/10" />
          </div>

          <div className="relative mx-auto grid max-w-7xl gap-10 px-5 sm:px-6 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-emerald-300/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.12em] text-emerald-300">
                <Zap className="h-3 w-3" />
                Get started today
              </div>

              <h2 className="text-3xl font-black tracking-[-0.04em] sm:text-4xl">What&apos;s your AI visibility score?</h2>
              <p className="mt-3 text-sm text-white/55">
                Enter your website and get a free AI search visibility report.
              </p>

              <div className="mt-6 flex max-w-xl flex-col gap-3 rounded-2xl bg-white p-2 sm:flex-row">
                <input
                  type="url"
                  value={website}
                  onChange={(event) => setWebsite(event.target.value)}
                  placeholder="https://yourwebsite.com"
                  className="min-h-11 flex-1 rounded-xl px-4 text-sm text-zinc-900 outline-none placeholder:text-zinc-400"
                  aria-label="Website URL"
                />
                <Link
                  href={visibilityHref}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-emerald-300 px-5 text-sm font-black text-black transition hover:bg-emerald-200"
                >
                  Check my visibility
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </div>

              <div className="mt-3 text-[11px] text-white/35">Free · No credit card required</div>
            </div>

            <div className="rounded-2xl border border-emerald-300/15 bg-black/15 p-6 backdrop-blur-sm">
              <div className="text-xs font-bold text-white">Takes less than 30 seconds</div>
              <div className="mt-5 space-y-3">
                {[
                  "Your AI visibility score",
                  "Where you're being cited",
                  "Top citation opportunities",
                  "Personalized recommendations",
                ].map((item) => (
                  <div key={item} className="flex items-center gap-2 text-sm text-white/60">
                    <Check className="h-4 w-4 text-emerald-300" />
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="bg-[#071013] py-12 text-white">
        <div className="mx-auto max-w-7xl px-5 sm:px-6">
          <div className="grid gap-10 border-b border-white/8 pb-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
            <div>
              <BrandMark />
              <p className="mt-4 max-w-xs text-xs leading-5 text-white/40">
                AI search visibility, answer engine optimization, automated fixes, and measurable results.
              </p>
            </div>

            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-white/35">Product</div>
              <div className="mt-4 flex flex-col gap-2 text-xs text-white/50">
                <Link href="/aria" className="hover:text-white">Aria Copilot</Link>
                <Link href="/pricing" className="hover:text-white">Pricing</Link>
                <Link href="/case-studies" className="hover:text-white">Case Studies</Link>
                <Link href="/methodology" className="hover:text-white">Methodology</Link>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-white/35">Solutions</div>
              <div className="mt-4 flex flex-col gap-2 text-xs text-white/50">
                <Link href="/for-agencies" className="hover:text-white">For Agencies</Link>
                <Link href="/for-saas" className="hover:text-white">For SaaS</Link>
                <Link href="/for-content" className="hover:text-white">For Content Teams</Link>
                <Link href="/for-ecommerce" className="hover:text-white">For E-commerce</Link>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-white/35">Resources</div>
              <div className="mt-4 flex flex-col gap-2 text-xs text-white/50">
                <Link href="/blog" className="hover:text-white">Blog</Link>
                <Link href="/leaderboard" className="hover:text-white">AI SEO Leaderboard</Link>
                <Link href="/vs" className="hover:text-white">Comparisons</Link>
                <Link href="/free/gso-checker" className="hover:text-white">Free AI Checker</Link>
              </div>
            </div>

            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.14em] text-white/35">Company</div>
              <div className="mt-4 flex flex-col gap-2 text-xs text-white/50">
                <Link href="/about" className="hover:text-white">About</Link>
                <Link href="/contact" className="hover:text-white">Contact</Link>
                <Link href="/security" className="hover:text-white">Security</Link>
                <Link href="/privacy" className="hover:text-white">Privacy</Link>
                <Link href="/terms" className="hover:text-white">Terms</Link>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-3 pt-6 text-[11px] text-white/30 sm:flex-row sm:items-center sm:justify-between">
            <span>© {new Date().getFullYear()} OptiAISEO. All rights reserved.</span>
            <span>AI Search Visibility & Answer Engine Optimization Platform</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
