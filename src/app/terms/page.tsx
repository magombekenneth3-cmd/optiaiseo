import { Metadata } from "next";
import Link from "next/link";
import { NavAuthSection } from "@/components/marketing/NavAuthSection";

export const metadata: Metadata = {
    title: "Terms of Service | OptiAISEO",
    description: "Read the Terms of Service for OptiAISEO.",
};

const TERMS_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Terms of Service | OptiAISEO",
  "url": "https://optiaiseo.online/terms",
  "description": "Terms of Service for OptiAISEO - the rules governing use of our platform.",
  "publisher": {
    "@type": "Organization",
    "name": "OptiAISEO",
    "url": "https://optiaiseo.online",
    "logo": {
      "@type": "ImageObject",
      "url": "https://optiaiseo.online/logo.png"
    }
  }
};

export default function TermsPage() {
    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(TERMS_SCHEMA) }} />
            {/* Background */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/10 blur-[120px] rounded-full pointer-events-none" />

            {/* Nav */}
            <nav className="border-b border-white/5">
                <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                        <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center">
                            <span className="font-bold text-white text-[10px] tracking-tighter">Opti</span>
                        </div>
                        <span className="font-semibold tracking-tight">OptiAISEO</span>
                    </Link>
                    <NavAuthSection ctaText="Sign up free" ctaHref="/signup" ctaClassName="text-sm font-semibold bg-foreground text-background px-4 py-2 rounded-full hover:opacity-90 transition-all" />
                </div>
            </nav>

            {/* Content */}
            <main className="max-w-4xl mx-auto px-6 py-16 relative z-10">
                <div className="mb-10">
                    <h1 className="text-4xl font-bold tracking-tight mb-3">Terms of Service</h1>
                    <p className="text-muted-foreground text-sm">Last updated: March 2026</p>
                </div>

                <div className="space-y-10 text-[15px] leading-relaxed text-zinc-300">
                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">1. Acceptance of Terms</h2>
                        <p>By accessing or using OptiAISEO (&quot;the Service&quot;), you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use the Service.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">2. Description of Service</h2>
                        <p>OptiAISEO provides automated SEO auditing, AI-powered blog content generation, keyword rank tracking, and GitHub-backed code fix automation. The Service is provided &quot;as is&quot; and may be updated at any time.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">3. User Accounts</h2>
                        <p>You are responsible for maintaining the confidentiality of your account credentials. You agree to notify us immediately of any unauthorized use of your account. We reserve the right to terminate accounts that violate these Terms.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">4. Acceptable Use</h2>
                        <p>You agree not to use the Service to:</p>
                        <ul className="mt-3 space-y-2 list-disc list-inside text-zinc-400">
                            <li>Violate any applicable law or regulation</li>
                            <li>Infringe on the intellectual property rights of others</li>
                            <li>Distribute malware or engage in malicious activity</li>
                            <li>Scrape or data-mine the Service beyond normal usage</li>
                            <li>Attempt to gain unauthorized access to any part of the Service</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">5. Billing & Subscriptions</h2>
                        <p>Paid subscriptions are billed monthly or annually as selected. You may cancel at any time from the billing portal. Refunds are issued at our discretion. We reserve the right to change pricing with 30 days&apos; notice.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">6. Intellectual Property</h2>
                        <p>You retain ownership of your own content. AI-generated content is provided for your use and you are responsible for its final form and publication. We own all rights to the platform, code, and underlying technology.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">7. Limitation of Liability</h2>
                        <p>To the maximum extent permitted by law, OptiAISEO shall not be liable for any indirect, incidental, special, or consequential damages arising from use of the Service. Our total liability shall not exceed the amount you paid in the last 12 months.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">8. Changes to Terms</h2>
                        <p>We may update these Terms at any time. Continued use of the Service after changes constitutes acceptance of the new Terms. We will notify active users of material changes via email.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">9. Contact</h2>
                        <p>For questions about these Terms, please contact us through the platform or reach out via our official support channels.</p>
                    </section>
                </div>

                <div className="mt-16 pt-8 border-t border-white/5 flex items-center justify-between text-sm text-muted-foreground">
                    <Link href="/" className="hover:text-foreground transition-colors">← Back to Home</Link>
                    <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy →</Link>
                </div>
            </main>
        </div>
    );
}
