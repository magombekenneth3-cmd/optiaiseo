import type { Metadata, Viewport } from "next";
import { Inter, Montserrat } from "next/font/google";
import Script from "next/script";
import { headers } from "next/headers";
import ClientLayout from "./ClientLayout";
import { validateEnv } from "@/lib/env";

try {
  validateEnv();
} catch (e) {
  console.error("[Layout] validateEnv() threw — check Railway environment variables:", e);
}

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
  preload: true,
});

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
  weight: ["600", "700", "800", "900"],
  preload: false,
});

const FALLBACK_ORIGIN = "https://optiaiseo.online";
function getSiteOrigin(): URL {
  const raw = process.env.NEXT_PUBLIC_SITE_URL || "";
  try {
    return new URL(raw);
  } catch {
    return new URL(FALLBACK_ORIGIN);
  }
}
const SITE_ORIGIN = getSiteOrigin();
const SITE_DESC = "Free AI SEO audit tool — scan your website for technical issues, get instant fixes, and rank higher on Google. Automates SEO audits, schema fixes, and AI-optimised content.";

export const metadata: Metadata = {
  metadataBase: SITE_ORIGIN,
  title: {
    default: "Free AI SEO Audit Tool & Website SEO Checker | OptiAISEO",
    template: "%s | OptiAISEO",
  },
  description: SITE_DESC,
  keywords: [
    // High-volume, high-intent
    "SEO audit tool",
    "free SEO checker",
    "website SEO analysis",
    "SEO audit free",
    "technical SEO audit",
    "website rank checker",
    "SEO tool",
    "AI SEO tool",
    // Mid-tail
    "automated SEO audit",
    "SEO site audit",
    "on-page SEO checker",
    "free website audit",
    "SEO score checker",
    "page speed SEO",
    "schema markup checker",
    // Brand + differentiator
    "OptiAISEO",
    "AI SEO platform",
    "answer engine optimization",
    "rank in ChatGPT",
    "AEO tool",
  ],
  verification: {
    google: "gtmmekBMWygaQST6rDKl6Zj4wWCQbpPXos4zw_Hhkyg",
  },
  openGraph: {
    type: "website",
    siteName: "OptiAISEO",
    title: "Free AI SEO Audit Tool & Website SEO Checker | OptiAISEO",
    description: SITE_DESC,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "OptiAISEO — Free AI SEO Audit Tool" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Free AI SEO Audit Tool & Website SEO Checker | OptiAISEO",
    description: SITE_DESC,
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/logo.svg",    type: "image/svg+xml" },
      { url: "/favicon.png", type: "image/png", sizes: "any" },
      { url: "/icon-192.png", type: "image/png", sizes: "192x192" },
      { url: "/icon-512.png", type: "image/png", sizes: "512x512" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
    other: [
      { rel: "mask-icon", url: "/safari-pinned-tab.svg", color: "#10b981" },
    ],
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const fontVars = `${inter.variable} ${montserrat.variable}`;

  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "OptiAISEO",
    url: "https://optiaiseo.online",
    logo: {
      "@type": "ImageObject",
      url: "https://optiaiseo.online/logo.svg",
      width: 200,
      height: 60,
    },
    description: "AI-powered SEO audit and automation platform. Scan your website, fix technical issues, and rank higher on Google.",
    sameAs: [
      "https://twitter.com/optiaiseo",
      "https://www.linkedin.com/company/optiaiseo",
    ],
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "customer support",
      url: "https://optiaiseo.online/contact",
    },
  };

  const websiteSchema = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "OptiAISEO",
    url: "https://optiaiseo.online",
    description: "Free AI SEO audit tool — scan your website for technical issues, get instant fixes, and rank higher on Google.",
    potentialAction: {
      "@type": "SearchAction",
      target: {
        "@type": "EntryPoint",
        urlTemplate: "https://optiaiseo.online/free/seo-checker?url={search_term_string}",
      },
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <link rel="manifest" href="/manifest.json" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="OptiAISEO" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        {/* ── Entity schema: Organization + WebSite ─────────────────────────── */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(organizationSchema) }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteSchema) }}
        />
      </head>
      <body className={`antialiased ${fontVars}`} suppressHydrationWarning>
        <ClientLayout fontVars={fontVars}>{children}</ClientLayout>
        <Script id="theme-init" strategy="afterInteractive" nonce={nonce}>
          {`try{var t=localStorage.getItem('theme');if(t&&t!=='dark'){document.documentElement.className=t;}}catch(_){}`}
        </Script>
        <Script
          src="https://www.googletagmanager.com/gtag/js?id=G-9LL1YRV8XM"
          strategy="afterInteractive"
          nonce={nonce}
        />
        <Script id="ga4-init" strategy="afterInteractive" nonce={nonce}>
          {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','G-9LL1YRV8XM');`}
        </Script>
      </body>
    </html>
  );
}