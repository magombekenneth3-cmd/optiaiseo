import { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
    title: "Privacy Policy | OptiAISEO",
    description: "Read the Privacy Policy for OptiAISEO.",
};

const PRIVACY_SCHEMA = {
  "@context": "https://schema.org",
  "@type": "WebPage",
  "name": "Privacy Policy | OptiAISEO",
  "url": "https://www.optiaiseo.online/privacy",
  "description": "Privacy Policy for OptiAISEO - how we collect, use, and protect your data.",
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

export default function PrivacyPage() {
    return (
        <div className="min-h-screen bg-background text-foreground selection:bg-primary/30">
            <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(PRIVACY_SCHEMA) }} />
            {/* Background */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-accent/10 blur-[120px] rounded-full pointer-events-none" />

            {/* Nav */}
            <nav className="border-b border-white/5">
                <div className="max-w-4xl mx-auto px-6 h-16 flex items-center justify-between">
                    <Link href="/" className="flex items-center gap-2 hover:opacity-80 transition-opacity">
                        <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center">
                            <span className="font-bold text-white text-[10px] tracking-tighter">Opti</span>
                        </div>
                        <span className="font-semibold tracking-tight">OptiAISEO</span>
                    </Link>
                    <Link href="/login" className="text-sm text-muted-foreground hover:text-foreground transition-colors">
                        Sign In
                    </Link>
                </div>
            </nav>

            {/* Content */}
            <main className="max-w-4xl mx-auto px-6 py-16 relative z-10">
                <div className="mb-10">
                    <h1 className="text-4xl font-bold tracking-tight mb-3">Privacy Policy</h1>
                    <p className="text-muted-foreground text-sm">Last updated: March 2026</p>
                </div>

                <div className="space-y-10 text-[15px] leading-relaxed text-zinc-300">
                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">1. Information We Collect</h2>
                        <p>We collect information you provide directly (name, email, password), information from OAuth providers (Google, GitHub) when you sign in, and technical data about your usage of the Service (audit results, keywords, blog content).</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">2. How We Use Your Information</h2>
                        <ul className="space-y-2 list-disc list-inside text-zinc-400">
                            <li>To provide and improve the Service</li>
                            <li>To send transactional emails (audit reports, blog drafts, billing)</li>
                            <li>To analyze aggregate usage patterns for product improvements</li>
                            <li>To process payments via Stripe (we do not store card details)</li>
                        </ul>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">3. Google Search Console Data</h2>
                        <p>If you connect Google Search Console, we access your keyword and traffic data in read-only mode. This data is stored securely and used only to provide keyword ranking features within your account. We never share or sell your GSC data.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">4. GitHub Integration</h2>
                        <p>If you connect a GitHub repository, we use your OAuth token to create Pull Requests with SEO fix code. We request only the minimum necessary permissions. Your token is stored encrypted and never shared.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">5. Data Sharing</h2>
                        <p>We do not sell your personal data. We share data only with trusted third-party service providers (Stripe for billing, Resend for email, Google APIs) as necessary to operate the Service, and only under appropriate data processing agreements.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">6. Data Security</h2>
                        <p>We use industry-standard security measures including encryption at rest and in transit (TLS/HTTPS), secure token storage, and bcrypt password hashing. We conduct regular security reviews and respond to vulnerabilities promptly.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">7. Data Retention & Deletion</h2>
                        <p>We retain your data as long as your account is active. You may request account deletion at any time through account settings or by contacting support. Upon deletion, your personal data is removed within 30 days.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">8. Cookies</h2>
                        <p>We use session cookies for authentication and prefer-based cookies for UI preferences. We do not use advertising or tracking cookies. You can disable cookies in your browser, but some features may not work correctly.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">9. Your Rights</h2>
                        <p>Depending on your location, you may have rights to access, correct, or delete your personal data, object to processing, or request data portability. Contact us to exercise these rights.</p>
                    </section>

                    <section>
                        <h2 className="text-xl font-semibold text-white mb-3">10. Contact</h2>
                        <p>For privacy-related requests or questions, contact us through the platform or via our official support channels. We respond to all requests within 30 days.</p>
                    </section>
                </div>

                <div className="mt-16 pt-8 border-t border-white/5 flex items-center justify-between text-sm text-muted-foreground">
                    <Link href="/" className="hover:text-foreground transition-colors">← Back to Home</Link>
                    <Link href="/terms" className="hover:text-foreground transition-colors">Terms of Service →</Link>
                </div>
            </main>
        </div>
    );
}
