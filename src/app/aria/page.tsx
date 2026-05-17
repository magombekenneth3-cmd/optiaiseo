import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Mic, GitPullRequest, Zap, Code, LayoutDashboard } from "lucide-react";
import { AriaDemoInterface } from "@/components/home/AriaDemoInterface";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");

export const metadata: Metadata = {
  title: "Manage SEO by Voice — Meet Aria | OptiAISEO",
  description: "Meet Aria — your AI voice SEO agent. Manage keyword tracking, content, and site fixes hands-free. The future of SEO is a conversation.",
  alternates: { canonical: `${SITE_URL}/aria` },
  openGraph: {
    title: "Manage SEO by Voice — Meet Aria | OptiAISEO",
    description: "Meet Aria — your AI voice SEO agent. Manage keyword tracking, content, and site fixes hands-free. The future of SEO is a conversation.",
    url: `${SITE_URL}/aria`,
    type: "website",
    images: [{ url: "/og-image.png", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Manage SEO by Voice — Meet Aria | OptiAISEO",
    description: "Meet Aria — your AI voice SEO agent. Manage keyword tracking, content, and site fixes hands-free. The future of SEO is a conversation.",
    images: ["/og-image.png"],
  },
};

const ariaSchema = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Aria — AI Voice SEO Agent",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description: "Aria is a real-time voice AI agent for SEO. She reads audit results, explains issues in plain language, opens GitHub PRs to fix them, and critiques live site UX — all by voice with sub-second latency. Powered by Gemini 2.5 Flash and LiveKit WebRTC.",
  url: `${SITE_URL}/aria`,
  featureList: [
    "Sub-second voice latency via Gemini 2.5 Live API",
    "Full barge-in support — interrupt mid-sentence",
    "Visual Playwright critiques of live site UX",
    "GitHub auto-fix Pull Requests by voice command",
    "Audit walkthrough and issue explanation",
    "Keyword and competitor analysis by voice",
  ],
  offers: {
    "@type": "Offer",
    price: "0",
    priceCurrency: "USD",
    description: "Free trial included with all OptiAISEO plans",
    url: `${SITE_URL}/signup`,
  },
  provider: {
    "@type": "Organization",
    name: "OptiAISEO",
    url: SITE_URL,
  },
};

const ariaPageSchema = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  name: "Manage SEO by Voice — Meet Aria | OptiAISEO",
  url: `${SITE_URL}/aria`,
  description: "Meet Aria — your AI voice SEO agent. Manage keyword tracking, content, and site fixes hands-free. The future of SEO is a conversation.",
  speakable: {
    "@type": "SpeakableSpecification",
    cssSelector: ["h1", "main p"],
  },
  breadcrumb: {
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Aria", item: `${SITE_URL}/aria` },
    ],
  },
};

export default function AriaLandingPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col font-sans">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ariaSchema) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ariaPageSchema) }} />
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-background/80 backdrop-blur-xl border-b border-border">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <ArrowLeft className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors" />
            <span className="text-sm font-semibold text-muted-foreground group-hover:text-foreground">Back to OptiAISEO</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground">Log in</Link>
            <Link href="/signup" className="text-sm font-semibold bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-full transition-colors flex items-center gap-2">
              <Mic className="w-3.5 h-3.5" /> Start using Aria free
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex-1 pt-32 pb-24 relative overflow-hidden">
        {/* Background Gradients */}
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] bg-emerald-500/10 blur-[120px] rounded-full pointer-events-none" />
        <div className="absolute top-[20%] right-[-10%] w-[50%] h-[50%] bg-indigo-500/10 blur-[120px] rounded-full pointer-events-none" />

        <div className="max-w-7xl mx-auto px-6 grid lg:grid-cols-2 gap-16 items-center">
          
          {/* Left: Copy */}
          <div className="flex flex-col z-10">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 font-semibold text-xs mb-6 w-fit">
              <SparklesIcon className="w-3.5 h-3.5" /> Powered by Gemini 2.5 Flash
            </div>
            
            <h1 className="text-5xl lg:text-7xl font-black tracking-tight mb-6 leading-[1.05]">
              Meet Aria — Your AI SEO Agent,{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-emerald-500 to-emerald-300">Activated by Voice</span>.
            </h1>
            
            <p className="text-lg text-muted-foreground max-w-lg mb-10 leading-relaxed">
              Aria isn't just a chatbot. She's a voice-native SEO copilot with sub-second latency. Ask her to walk through your audit results, and she'll read every issue, explain it in plain language, and open a GitHub auto-fix PR while you're still talking.
            </p>

            <div className="flex flex-wrap items-center gap-4 mb-16">
              <Link href="/signup" className="flex items-center justify-center gap-2 bg-foreground text-background font-semibold px-8 py-3.5 rounded-xl hover:opacity-90 transition-opacity whitespace-nowrap">
                Start Free Trial
              </Link>
              <Link href="#how-it-works" className="flex items-center justify-center gap-2 border border-border bg-card text-foreground font-semibold px-8 py-3.5 rounded-xl hover:bg-muted transition-colors whitespace-nowrap">
                Watch Demo
              </Link>
            </div>

            {/* Feature row */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-6">
              <Feature 
                icon={Zap} 
                title="Sub-Second Latency" 
                desc="Powered by Gemini 2.5 Live API. No more 'Thinking...' dots." 
              />
              <Feature 
                icon={LayoutDashboard} 
                title="Barge-In Support" 
                desc="Interrupt her mid-sentence to steer the audit." 
              />
              <Feature 
                icon={Code} 
                title="Visual Playwright Critiques" 
                desc="Aria screenshots your live site and critiques visual UX, layout, and accessibility — in real time." 
              />
              <Feature 
                icon={GitPullRequest} 
                title="GitHub Auto-PRs" 
                desc="She writes the implementation code and opens the Pull Request." 
              />
            </div>
          </div>

          {/* Right: Interactive Mockup */}
          <div className="relative z-10" id="how-it-works">
            <AriaDemoInterface />
          </div>

        </div>
      </main>
    </div>
  );
}

function Feature({ icon: Icon, title, desc }: { icon: any, title: string, desc: string }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
        <Icon className="w-4 h-4" />
      </div>
      <h3 className="text-sm font-bold text-foreground mt-1">{title}</h3>
      <p className="text-xs text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function SparklesIcon(props: any) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
    </svg>
  );
}
