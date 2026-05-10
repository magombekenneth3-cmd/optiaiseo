import Link from "next/link";
import { Check, ArrowRight, Zap } from "lucide-react";
import SiteFooter from "@/components/marketing/SiteFooter";

export interface UseCasePageProps {
  eyebrow: string;
  headline: string;
  subheadline: string;
  ctaLabel: string;
  ctaHref: string;
  proofStats: { value: string; label: string }[];
  problems: { title: string; body: string }[];
  features: { title: string; body: string }[];
  workflowTitle: string;
  workflowSteps: { day: string; desc: string }[];
  comparisonRows: { feature: string; us: string; them: string; theirLabel: string }[];
  faqs: { q: string; a: string }[];
  relatedLinks: { href: string; label: string }[];
}

export default function UseCasePage({
  eyebrow,
  headline,
  subheadline,
  ctaLabel,
  ctaHref,
  proofStats,
  problems,
  features,
  workflowTitle,
  workflowSteps,
  comparisonRows,
  faqs,
  relatedLinks,
}: UseCasePageProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <nav className="w-full border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5" aria-label="OptiAISEO home">
            <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shrink-0">
              <span className="font-black text-background text-[11px] tracking-tight">AI</span>
            </div>
            <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
          </Link>
          <div className="flex items-center gap-4">
            <Link href="/pricing" className="text-sm text-muted-foreground hover:text-foreground hidden sm:block transition-colors">Pricing</Link>
            <Link href="/login" className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors">Log in</Link>
            <Link href={ctaHref} className="text-sm font-semibold bg-foreground text-background px-4 py-2 rounded-full hover:opacity-90 transition-all">
              {ctaLabel} →
            </Link>
          </div>
        </div>
      </nav>

      <main id="main-content" className="flex-1">
        {/* Hero */}
        <section className="relative py-20 px-6 overflow-hidden">
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-10%,rgba(16,185,129,0.08),transparent)]" />
          <div className="relative max-w-5xl mx-auto text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-[color:var(--brand)]/25 bg-[color:var(--brand)]/10 mb-6">
              <span className="text-xs font-semibold text-[color:var(--brand)] uppercase tracking-wider">{eyebrow}</span>
            </div>
            <h1 className="text-4xl md:text-6xl font-black tracking-tight leading-[1.1] mb-6 whitespace-pre-line">
              {headline}
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
              {subheadline}
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href={ctaHref}
                className="px-8 py-4 rounded-full bg-foreground text-background font-bold text-base hover:opacity-90 transition-all active:scale-95 flex items-center gap-2"
              >
                <Zap className="w-4 h-4" />
                {ctaLabel}
              </Link>
              <span className="text-sm text-muted-foreground">Free forever · No credit card</span>
            </div>
          </div>
        </section>

        {/* Proof stats */}
        <section className="border-y border-border bg-card">
          <div className="max-w-4xl mx-auto px-6 py-10 grid grid-cols-3 gap-6 text-center">
            {proofStats.map(({ value, label }) => (
              <div key={label}>
                <p className="text-3xl font-black tracking-tight mb-1">{value}</p>
                <p className="text-sm text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Problems */}
        <section className="max-w-5xl mx-auto px-6 py-20">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-12">
            The problems you&apos;re dealing with right now
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {problems.map(({ title, body }, i) => (
              <div key={title} className="card-surface rounded-2xl p-8">
                <span className="text-4xl font-black text-[color:var(--brand)]/15 block mb-4">0{i + 1}</span>
                <h3 className="font-bold text-base mb-3">{title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Features */}
        <section className="border-t border-border bg-muted/20 py-20">
          <div className="max-w-5xl mx-auto px-6">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-12">
              Here&apos;s how OptiAISEO solves them
            </h2>
            <div className="grid md:grid-cols-3 gap-6">
              {features.map(({ title, body }) => (
                <div key={title} className="card-surface rounded-2xl p-8 flex flex-col">
                  <div className="w-10 h-10 rounded-xl bg-[color:var(--brand)]/10 border border-[color:var(--brand)]/20 flex items-center justify-center mb-4 shrink-0">
                    <Check className="w-5 h-5 text-[color:var(--brand)]" />
                  </div>
                  <h3 className="font-bold text-base mb-3">{title}</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed flex-1">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Workflow */}
        <section className="max-w-4xl mx-auto px-6 py-20">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-12">
            {workflowTitle}
          </h2>
          <div className="space-y-3">
            {workflowSteps.map(({ day, desc }) => (
              <div key={day} className="card-surface rounded-xl p-6 flex items-start gap-6">
                <span className="text-sm font-black text-[color:var(--brand)] uppercase tracking-widest shrink-0 w-20">{day}</span>
                <p className="text-sm text-muted-foreground leading-relaxed">{desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* Comparison */}
        <section className="border-t border-border bg-muted/20 py-20">
          <div className="max-w-4xl mx-auto px-6">
            <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-10">
              OptiAISEO vs {comparisonRows[0]?.theirLabel}
            </h2>
            <div className="overflow-x-auto rounded-2xl border border-border">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-card border-b border-border">
                    <th className="text-left px-6 py-4 font-semibold text-muted-foreground">Feature</th>
                    <th className="text-left px-6 py-4 font-bold text-[color:var(--brand)]">OptiAISEO</th>
                    <th className="text-left px-6 py-4 font-semibold text-muted-foreground">{comparisonRows[0]?.theirLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {comparisonRows.map(({ feature, us, them }, i) => (
                    <tr key={feature} className={`border-b border-border last:border-0 ${i % 2 === 0 ? "" : "bg-card/30"}`}>
                      <td className="px-6 py-4 text-muted-foreground font-medium">{feature}</td>
                      <td className="px-6 py-4 text-emerald-500 font-semibold">{us}</td>
                      <td className="px-6 py-4 text-rose-400">{them}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="max-w-3xl mx-auto px-6 py-20">
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight text-center mb-10">
            Frequently asked questions
          </h2>
          <div className="space-y-3">
            {faqs.map(({ q, a }) => (
              <details key={q} className="card-surface rounded-2xl group">
                <summary className="flex items-center justify-between px-6 py-5 cursor-pointer list-none font-semibold text-sm select-none">
                  <span>{q}</span>
                  <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0 ml-4 transition-transform duration-200 group-open:rotate-90" />
                </summary>
                <div className="px-6 pb-6 text-sm text-muted-foreground leading-relaxed border-t border-border pt-4">
                  {a}
                </div>
              </details>
            ))}
          </div>
        </section>

        {/* CTA banner */}
        <section className="bg-zinc-950 text-white py-20">
          <div className="max-w-3xl mx-auto px-6 text-center">
            <h2 className="text-3xl md:text-4xl font-black tracking-tight mb-4">
              Ready to stop reporting and start fixing?
            </h2>
            <p className="text-white/65 mb-8 max-w-xl mx-auto">
              Free forever. Connect your site in 2 minutes. Your first audit runs automatically.
            </p>
            <Link
              href={ctaHref}
              className="inline-flex items-center gap-2 px-8 py-4 rounded-full bg-[#10b981] text-white font-bold text-base hover:opacity-90 transition-all active:scale-95"
            >
              <Zap className="w-5 h-5" />
              {ctaLabel}
            </Link>
          </div>
        </section>

        {/* Related */}
        <section className="max-w-5xl mx-auto px-6 py-10 border-t border-border">
          <div className="flex flex-wrap justify-center gap-3">
            {relatedLinks.map(({ href, label }) => (
              <Link
                key={href}
                href={href}
                className="text-sm font-semibold px-4 py-2 rounded-full border border-border hover:border-[color:var(--brand)] hover:text-[color:var(--brand)] transition-colors"
              >
                {label}
              </Link>
            ))}
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
