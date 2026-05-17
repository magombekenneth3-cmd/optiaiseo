import type { Metadata } from "next";
import Link from "next/link";
import SiteFooter from "@/components/marketing/SiteFooter";

const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");
const PAGE_URL = `${SITE_URL}/aio`;
const TITLE = "AI Optimization (AIO) — Make AI Understand Your Brand 2026";
const DESC  = "AIO ensures AI models correctly represent your brand across ChatGPT, Claude, Perplexity, and Google AI. Learn how to fix your AI brand signals.";

export const metadata: Metadata = {
  title: TITLE, description: DESC,
  alternates: { canonical: PAGE_URL },
  openGraph: { title: TITLE, description: DESC, url: PAGE_URL, type: "website", images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "AI Overview Optimization — OptiAISEO" }] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC, images: ["/og-image.png"] },
};

const schemas = [
  { "@context":"https://schema.org","@type":"BreadcrumbList", itemListElement:[{"@type":"ListItem",position:1,name:"Home",item:SITE_URL},{"@type":"ListItem",position:2,name:"AIO Guide",item:PAGE_URL}] },
  { "@context":"https://schema.org","@type":"Article", headline:TITLE,description:DESC,url:PAGE_URL, datePublished:"2024-08-01",dateModified:new Date().toISOString().split("T")[0], author:{"@type":"Organization",name:"OptiAISEO",url:SITE_URL},publisher:{"@type":"Organization",name:"OptiAISEO",url:SITE_URL}, speakable:{"@type":"SpeakableSpecification",cssSelector:["h1","#aio-definition","h2","#faq-heading"]} },
  { "@context":"https://schema.org","@type":"FAQPage", mainEntity:[
    {q:"What is AI Optimization (AIO)?",a:"AIO is the discipline of ensuring AI language models correctly understand your brand — your products, expertise, geography, and identity — so they accurately represent it in AI-generated answers."},
    {q:"Why does it matter if AI misrepresents my brand?",a:"AI models are now the first point of research for millions of users. If AI describes your brand incorrectly — wrong services, wrong location, outdated products — you lose potential customers before they ever visit your site."},
    {q:"What signals do AI models use to learn about a brand?",a:"AI models learn from your website content, structured data (Organization schema), press coverage, Wikipedia presence, social profiles, and third-party directory listings."},
    {q:"What is Organization schema and why is it important for AIO?",a:"Organization schema is a JSON-LD block on your homepage that declares your brand name, industry, services, social profiles, and contact info in machine-readable format — the primary way to teach AI what you do."},
    {q:"How do I know if AI models understand my brand correctly?",a:"Run OptiAISEO's AIO Brand Intelligence scan. It asks multiple AI models about your brand and reports what they know — including accuracy of industry, services, and geographic market."},
    {q:"What is the sameAs property in schema?",a:"The sameAs schema property links your Organization to authoritative external profiles (Wikipedia, Wikidata, social media). It helps AI systems verify your brand identity and location in the knowledge graph."},
  ].map(({q,a})=>({"@type":"Question",name:q,acceptedAnswer:{"@type":"Answer",text:a}})) },
];

const SIGNALS = [
  {icon:"🏛️",title:"Organization Schema",desc:"JSON-LD on your homepage declaring your brand name, industry, services, and sameAs profiles is the #1 AIO signal."},
  {icon:"📄",title:"Rich About Page",desc:"A detailed About page — your founding story, team expertise, mission, and service areas — teaches AI who you are."},
  {icon:"🌐",title:"NAP Consistency",desc:"Name, Address, Phone must match exactly across your site, Google Business Profile, and all directory listings."},
  {icon:"🔗",title:"sameAs Profiles",desc:"Link your Organization schema to LinkedIn, Twitter/X, Crunchbase, Wikipedia — external verification for AI models."},
  {icon:"📰",title:"Press & Citations",desc:"Third-party media coverage and high-authority citations train AI models to recognize your brand as legitimate."},
  {icon:"📝",title:"Explicit Service Pages",desc:"Dedicated pages for every service, clearly stating what it does, who it&apos;s for, and where it&apos;s available."},
];

const FAQS = [
  {q:"What is AI Optimization (AIO)?",a:"AIO is the discipline of ensuring AI language models correctly understand your brand — your products, expertise, geography, and identity — so they accurately represent it in AI-generated answers and recommendations."},
  {q:"Why does it matter if AI misrepresents my brand?",a:"AI models are the first research touchpoint for millions of users. If an AI describes your brand incorrectly — wrong services, wrong location, outdated products — you lose potential customers before they ever visit your site."},
  {q:"What signals do AI models use to learn about a brand?",a:"AI models learn from your website content, structured data (Organization schema), press coverage, Wikipedia presence, social profiles, verified Google Business Profile, and third-party directory listings."},
  {q:"What is Organization schema and why is it important for AIO?",a:"Organization schema is a JSON-LD block on your homepage that declares your brand name, industry, services, social profiles, and contact information in machine-readable format — the primary way to teach AI what your business does."},
  {q:"How do I know if AI models understand my brand correctly?",a:"Run OptiAISEO's AIO Brand Intelligence scan. It asks multiple AI models about your brand and reports what they know — including accuracy of industry description, services summary, and geographic market understanding."},
  {q:"What is the sameAs property in schema?",a:"The sameAs property links your Organization schema to authoritative external profiles (Wikipedia, Wikidata, LinkedIn, Twitter). It helps AI systems cross-reference and verify your brand identity in the knowledge graph."},
];

export default function AioPage() {
  return (
    <>
      {schemas.map((s,i)=>( <script key={i} type="application/ld+json" dangerouslySetInnerHTML={{__html:JSON.stringify(s)}} /> ))}
      <div className="min-h-screen bg-background text-foreground">
        <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
          <div className="max-w-6xl mx-auto px-6 h-14 flex items-center justify-between">
            <Link href="/" className="font-display font-bold text-lg">Opti<span className="text-[#10b981]">AI</span>SEO</Link>
            <div className="flex items-center gap-4">
              <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block">Pricing</Link>
              <Link href="/free/seo-checker" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block">Free Audit</Link>
              <Link href="/signup" className="px-4 py-1.5 text-sm font-semibold rounded-lg bg-[#10b981] text-black hover:bg-[#0ea572] transition-colors">Start Free</Link>
            </div>
          </div>
        </nav>

        <section className="relative py-20 px-6 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(16,185,129,0.1),transparent)]" />
          <div className="relative max-w-4xl mx-auto text-center">
            <nav aria-label="Breadcrumb" className="flex justify-center gap-2 text-muted-foreground text-sm mb-6">
              <Link href="/" className="hover:text-foreground transition-colors">Home</Link><span>/</span><span className="text-foreground">AIO Guide</span>
            </nav>
            <div className="inline-flex items-center gap-2 bg-[#10b981]/10 border border-[#10b981]/25 rounded-full px-4 py-1.5 text-sm font-medium text-[#10b981] mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[#10b981] animate-pulse" />Make AI Know Your Brand — 2026
            </div>
            <h1 className="text-4xl md:text-6xl font-display font-bold tracking-tight mb-6 leading-tight">
              AI Optimization<br/><span className="text-[#10b981]">(AIO)</span> — Brand Intelligence
            </h1>
            <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto leading-relaxed">
              Does AI know your brand? AIO ensures every AI model correctly understands your products, expertise, and identity — so it recommends you accurately.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link href="/signup" className="px-8 py-3 bg-[#10b981] text-black rounded-xl font-semibold hover:bg-[#0ea572] transition-colors">Check AI Brand Knowledge →</Link>
              <Link href="/free/seo-checker" className="px-8 py-3 bg-card border border-border rounded-xl font-semibold hover:bg-muted transition-colors">Free Site Audit</Link>
            </div>
          </div>
        </section>

        <section id="aio-definition" className="py-16 px-6 max-w-4xl mx-auto">
          <h2 className="text-3xl font-display font-bold mb-6">What Is AIO?</h2>
          <p className="text-lg text-muted-foreground mb-4 leading-relaxed">
            <strong className="text-foreground">AI Optimization (AIO)</strong> is the third layer of the modern AI visibility stack — after SEO (ranking) and AEO/GEO (citation). AIO focuses on <em>brand understanding</em>: ensuring AI models like ChatGPT, Claude, and Perplexity accurately know what your brand does, who it serves, and why it&apos;s credible.
          </p>
          <p className="text-lg text-muted-foreground leading-relaxed">
            Without AIO, AI systems may describe your brand with outdated, incorrect, or empty information — sending potential customers elsewhere. AIO builds the knowledge graph signals that teach AI what your brand is.
          </p>
        </section>

        <section className="py-16 px-6 bg-card/30 border-y border-border">
          <div className="max-w-5xl mx-auto">
            <h2 className="text-3xl font-display font-bold text-center mb-12">6 Core AIO Signals</h2>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {SIGNALS.map(({icon,title,desc})=>(
                <div key={title} className="bg-card border border-border rounded-xl p-6 hover:border-[#10b981]/30 transition-colors">
                  <div className="text-2xl mb-3">{icon}</div>
                  <h3 className="font-semibold text-base mb-2">{title}</h3>
                  <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="py-16 px-6 max-w-4xl mx-auto">
          <h2 className="text-3xl font-display font-bold mb-6">The AIO Brand Intelligence Scan</h2>
          <p className="text-muted-foreground mb-8 leading-relaxed">OptiAISEO&apos;s AIO scanner runs 6 benchmarks across multiple AI models to grade how well AI understands your brand. Fix any gap and re-scan to verify improvement.</p>
          <div className="grid sm:grid-cols-2 gap-4">
            {[
              {label:"Brand Recognized",desc:"Does the AI know your brand name?"},
              {label:"Industry Known",desc:"Does AI correctly identify your sector?"},
              {label:"Services Identified",desc:"Can AI describe what you sell?"},
              {label:"Geography Known",desc:"Does AI know your market / location?"},
              {label:"Legitimacy Confirmed",desc:"Does AI treat your brand as credible?"},
              {label:"Competitor Awareness",desc:"Can AI place you in a competitive landscape?"},
            ].map(({label,desc})=>(
              <div key={label} className="flex items-start gap-3 bg-card border border-border rounded-xl p-4 hover:border-[#10b981]/30 transition-colors">
                <span className="text-[#10b981] mt-0.5">✓</span>
                <div><div className="font-semibold text-sm">{label}</div><div className="text-xs text-muted-foreground mt-0.5">{desc}</div></div>
              </div>
            ))}
          </div>
        </section>

        <section className="py-16 px-6 bg-card/30 border-y border-border">
          <div className="max-w-3xl mx-auto text-center">
            <h2 className="text-3xl font-display font-bold mb-4">Find Out What AI Knows About Your Brand</h2>
            <p className="text-muted-foreground mb-8">Run a free AIO Brand Intelligence scan. See exactly what ChatGPT, Claude, and Perplexity know — and what to fix first.</p>
            <Link href="/signup" className="inline-block px-10 py-3.5 bg-[#10b981] text-black rounded-xl font-bold hover:bg-[#0ea572] transition-colors">Start Free — No Credit Card</Link>
          </div>
        </section>

        <section id="faq-heading" className="py-16 px-6 max-w-4xl mx-auto">
          <h2 className="text-3xl font-display font-bold mb-10 text-center">AIO Frequently Asked Questions</h2>
          <div className="space-y-4">
            {FAQS.map(({q,a})=>(
              <div key={q} className="bg-card border border-border rounded-xl p-6 hover:border-[#10b981]/20 transition-colors">
                <h3 className="font-semibold text-base mb-2">{q}</h3>
                <p className="text-muted-foreground text-sm leading-relaxed">{a}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="py-12 px-6 bg-card/30 border-t border-border">
          <div className="max-w-4xl mx-auto">
            <p className="text-sm text-muted-foreground font-medium mb-4">Related Optimization Disciplines</p>
            <div className="flex flex-wrap gap-2">
              {[{label:"SEO — Search Engine Optimization",href:"/seo"},{label:"GEO — Generative Engine Optimization",href:"/geo"},{label:"AEO — Answer Engine Optimization",href:"/aeo"},{label:"pSEO — Programmatic SEO",href:"/pseo"},{label:"Free SEO Audit Tool",href:"/free/seo-checker"}].map(({label,href})=>(
                <Link key={href} href={href} className="px-4 py-2 bg-card border border-border rounded-lg text-sm hover:border-[#10b981]/40 hover:text-[#10b981] transition-colors">{label}</Link>
              ))}
            </div>
          </div>
        </section>

        <SiteFooter />
      </div>
    </>
  );
}
