import { Metadata } from "next";
import { Shield, Lock, Database, Trash2, Globe, FileCheck, AlertTriangle, CheckCircle } from "lucide-react";
import Link from "next/link";

export const metadata: Metadata = {
    title: "Security & Data Privacy | OptiAISEO",
    description: "How OptiAISEO protects your data: encryption at rest and in transit, no AI training on your data, GDPR compliance, data retention policies, and our SOC 2 roadmap.",
};

const SECURITY_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Security and Data Privacy | OptiAISEO",
  "url": "https://www.optiaiseo.online/security",
  "description": "How OptiAISEO protects your data: encryption, GDPR compliance, and our SOC 2 roadmap.",
  "publisher": {
    "@type": "Organization",
    "name": "OptiAISEO",
    "url": "https://www.optiaiseo.online",
    "logo": {
      "@type": "ImageObject",
      "url": "https://www.optiaiseo.online/logo.png"
    }
  }
};

export default function SecurityPage() {
    return (
        <div className="min-h-screen bg-background">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(SECURITY_SCHEMA) }} />
            {/* Hero */}
            <section className="py-20 px-4 text-center">
                <div className="max-w-3xl mx-auto">
                    <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-6">
                        <Shield className="w-8 h-8 text-emerald-400" />
                    </div>
                    <h1 className="text-4xl font-black text-foreground mb-4">Security & Data Trust</h1>
                    <p className="text-lg text-muted-foreground">
                        Enterprise and agency clients need to know their data is safe before adding client sites. Here&apos;s exactly how we protect it.
                    </p>
                </div>
            </section>

            <div className="max-w-4xl mx-auto px-4 pb-20 space-y-6">
                {/* Top trust badges */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    {[
                        { icon: Lock,      label: "TLS 1.3", sub: "All data in transit" },
                        { icon: Database,  label: "AES-256", sub: "Data at rest" },
                        { icon: Globe,     label: "GDPR Ready", sub: "EU data residency option" },
                        { icon: FileCheck, label: "SOC 2", sub: "In progress, 2026" },
                    ].map(b => {
                        const Icon = b.icon;
                        return (
                            <div key={b.label} className="card-elevated p-4 text-center">
                                <Icon className="w-5 h-5 text-emerald-400 mx-auto mb-2" />
                                <div className="text-sm font-bold text-foreground">{b.label}</div>
                                <div className="text-xs text-muted-foreground">{b.sub}</div>
                            </div>
                        );
                    })}
                </div>

                {/* Encryption */}
                <section className="card-elevated p-6 space-y-4">
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Lock className="w-5 h-5 text-brand" /> Encryption</h2>
                    <div className="space-y-3 text-sm text-foreground/80">
                        <div className="flex items-start gap-3"><CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /><span><strong>Data in transit:</strong> All connections between your browser, our servers, and third-party APIs use TLS 1.3. We enforce HSTS and reject older TLS versions.</span></div>
                        <div className="flex items-start gap-3"><CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /><span><strong>Data at rest:</strong> The PostgreSQL database is encrypted at rest using AES-256. Cloud Storage buckets (logos, assets) are encrypted using Google-managed encryption keys.</span></div>
                        <div className="flex items-start gap-3"><CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /><span><strong>Passwords:</strong> User passwords are hashed with bcrypt (cost factor 12). We never store plaintext credentials.</span></div>
                        <div className="flex items-start gap-3"><CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" /><span><strong>API keys:</strong> GSC tokens and third-party API credentials are stored encrypted in environment variables, never in the database.</span></div>
                    </div>
                </section>

                {/* AI Training */}
                <section className="card-elevated p-6 border border-emerald-500/20 bg-emerald-500/5">
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Shield className="w-5 h-5 text-emerald-400" /> Your Data Is Never Used to Train AI Models</h2>
                    <p className="text-sm text-foreground/80 mt-3 leading-relaxed">
                        <strong>Explicit statement:</strong> Audit results, keyword data, site content, AEO reports, and any data you or your clients input into OptiAISEO is never used to train, fine-tune, or evaluate any AI or machine learning model — ours or any third party&apos;s.
                    </p>
                    <p className="text-sm text-foreground/80 mt-3 leading-relaxed">
                        AI inference calls we make to Google Gemini, Anthropic Claude, and OpenAI are made using paid API plans that exclude training data rights per their respective API terms of service. We do not use free tiers for production inference.
                    </p>
                </section>

                {/* Data Retention */}
                <section className="card-elevated p-6 space-y-4">
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Database className="w-5 h-5 text-brand" /> Data Retention Policy</h2>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead>
                                <tr className="border-b border-border">
                                    <th className="text-left py-2 text-muted-foreground font-semibold">Data Type</th>
                                    <th className="text-left py-2 text-muted-foreground font-semibold">Retention Period</th>
                                </tr>
                            </thead>
                            <tbody className="text-foreground/80 divide-y divide-border">
                                {[
                                    { type: "Audit results (issue lists, scores)", period: "24 months" },
                                    { type: "Metric snapshots (historical trends)", period: "36 months" },
                                    { type: "Generated blog content", period: "Until manually deleted" },
                                    { type: "AEO reports", period: "12 months" },
                                    { type: "Voice session transcripts", period: "90 days" },
                                    { type: "Activity logs / access logs", period: "90 days" },
                                    { type: "Billing records", period: "7 years (legal requirement)" },
                                ].map(r => (
                                    <tr key={r.type}>
                                        <td className="py-2.5">{r.type}</td>
                                        <td className="py-2.5 font-medium">{r.period}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </section>

                {/* Account Deletion */}
                <section className="card-elevated p-6 space-y-3">
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Trash2 className="w-5 h-5 text-brand" /> Account & Data Deletion</h2>
                    <p className="text-sm text-foreground/80">When you close your account:</p>
                    <ul className="space-y-2 text-sm text-foreground/80">
                        {[
                            "All site data, audit results, keyword history, and AEO reports are deleted within 30 days",
                            "Generated blog content is permanently deleted immediately",
                            "GitHub integration tokens are revoked within 24 hours",
                            "GSC OAuth tokens are revoked and removed from our systems immediately",
                            "Billing records are retained for 7 years to meet legal requirements",
                            "Anonymised, aggregated benchmark statistics (no PII) may be retained indefinitely",
                        ].map((point, i) => (
                            <li key={i} className="flex gap-2.5"><CheckCircle className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />{point}</li>
                        ))}
                    </ul>
                    <p className="text-sm text-muted-foreground">To delete your account, go to <Link href="/dashboard/settings" className="text-brand underline">Dashboard → Settings → Delete Account</Link>.</p>
                </section>

                {/* GDPR */}
                <section className="card-elevated p-6 space-y-3">
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><Globe className="w-5 h-5 text-brand" /> GDPR & Data Residency</h2>
                    <div className="space-y-3 text-sm text-foreground/80">
                        <div><strong>Data controller:</strong> OptiAISEO Ltd (or its operating entity) is the data controller for all personal data processed through the platform.</div>
                        <div><strong>Primary region:</strong> Data is processed and stored in <strong>us-central1 (Iowa, USA)</strong> by default on Google Cloud.</div>
                        <div><strong>EU data residency:</strong> Agency plan customers can request EU-region processing (europe-west1 — Belgium). Contact support to activate.</div>
                        <div><strong>GDPR rights:</strong> EU users have the right to access, rectify, export, and delete their data. Submit requests to <a href="mailto:privacy@optiaiseo.online" className="text-brand underline">privacy@optiaiseo.online</a>.</div>
                        <div><strong>Sub-processors:</strong> Google Cloud (infrastructure), Google AI (inference), Anthropic (inference), OpenAI (inference), Stripe (billing), Resend (email). Full list available on request.</div>
                    </div>
                </section>

                {/* SOC 2 Roadmap */}
                <section className="card-elevated p-6 space-y-3">
                    <h2 className="text-lg font-bold text-foreground flex items-center gap-2"><FileCheck className="w-5 h-5 text-brand" /> SOC 2 Roadmap</h2>
                    <p className="text-sm text-foreground/80 leading-relaxed">
                        We are actively working toward SOC 2 Type I certification, expected <strong>Q3 2026</strong>, with Type II audit readiness by <strong>Q1 2027</strong>.
                    </p>
                    <div className="space-y-2">
                        {[
                            { done: true,  item: "Access control policy implemented (role-based, MFA enforced for admin)" },
                            { done: true,  item: "Encryption at rest and in transit verified" },
                            { done: true,  item: "Audit logging for all data access events" },
                            { done: false, item: "Vendor risk assessment program (Q2 2026)" },
                            { done: false, item: "Penetration test by third-party auditor (Q2 2026)" },
                            { done: false, item: "SOC 2 Type I audit (Q3 2026)" },
                        ].map((step, i) => (
                            <div key={i} className="flex items-center gap-3 text-sm">
                                {step.done
                                    ? <CheckCircle className="w-4 h-4 text-emerald-400 shrink-0" />
                                    : <div className="w-4 h-4 rounded-full border-2 border-muted-foreground shrink-0" />
                                }
                                <span className={step.done ? "text-foreground/80" : "text-muted-foreground"}>{step.item}</span>
                            </div>
                        ))}
                    </div>
                </section>

                {/* Credentials warning */}
                <div className="flex items-start gap-3 p-5 bg-amber-500/10 border border-amber-500/20 rounded-xl">
                    <AlertTriangle className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                    <div className="text-sm text-foreground/80">
                        <strong className="text-amber-300">Note for agency clients:</strong> We strongly recommend rotating all third-party integration credentials (GSC, Ahrefs, Stripe) before onboarding client data. Contact support for a security onboarding checklist.
                    </div>
                </div>

                {/* Contact */}
                <div className="text-center card-elevated p-8">
                    <h2 className="text-lg font-bold mb-2">Have a security question?</h2>
                    <p className="text-sm text-muted-foreground mb-4">Our team responds to security inquiries within 1 business day.</p>
                    <a href="mailto:security@optiaiseo.online" className="inline-flex items-center gap-2 px-5 py-2.5 bg-brand text-background rounded-xl font-semibold text-sm hover:opacity-90 transition-opacity">
                        Contact Security Team
                    </a>
                </div>
            </div>
        </div>
    );
}
