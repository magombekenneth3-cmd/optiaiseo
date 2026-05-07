import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import SiteFooter from "@/components/marketing/SiteFooter";
import { sanitizeHtml } from "@/lib/sanitize-html";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { token } = await params;
  const proof = await prisma.aeoProof.findFirst({
    where: { shareToken: token, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: { cited: true, query: true, site: { select: { domain: true } } },
  });

  if (!proof) {
    return { title: "Proof not found — OptiAISEO" };
  }

  const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://optiaiseo.online").replace(/\/$/, "");
  const status = proof.cited ? "cited" : "not cited";
  const title = `${proof.site.domain} was ${status} by an AI engine — Proof by OptiAISEO`;

  return {
    title,
    description: `View the AI-generated response for "${proof.query}" and whether ${proof.site.domain} was cited.`,
    openGraph: {
      title,
      description: `Real AI response captured by OptiAISEO for the query: "${proof.query}"`,
      url: `${siteUrl}/proof/${token}`,
      images: [{ url: "/og-image.png", width: 1200, height: 630 }],
    },
  };
}

export default async function ProofPage({ params }: Props) {
  const { token } = await params;

  const proof = await prisma.aeoProof.findFirst({
    where: { shareToken: token, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    select: {
      query: true,
      responseText: true,
      cited: true,
      createdAt: true,
      site: { select: { domain: true } },
    },
  });

  if (!proof) notFound();

  // SECURITY: sanitize AI response text first to strip any injected HTML,
  // then apply the domain highlight. Order matters — sanitize raw DB content
  // before inserting <mark> tags so the mark tags survive the sanitizer.
  const safeResponse = sanitizeHtml(proof.responseText ?? "");
  const highlightedResponse = proof.cited
    ? safeResponse.replace(
        new RegExp(`(${proof.site.domain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"),
        '<mark class="highlight">$1</mark>'
      )
    : safeResponse;

  const capturedDate = new Date(proof.createdAt).toLocaleDateString("en-GB", {
    day: "numeric", month: "long", year: "numeric",
  });

  return (
    <>
      <MarketingNav />

      <main className="max-w-2xl mx-auto px-4 py-12">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm text-muted-foreground mb-8">
          <Link href="/" className="hover:text-foreground transition-colors">OptiAISEO</Link>
          <span>/</span>
          <span className="text-foreground">AEO Proof</span>
        </nav>

        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border mb-6 ${
          proof.cited
            ? "bg-emerald-500/10 border-emerald-500/25"
            : "bg-red-500/10 border-red-500/25"
        }`}>
          <span className={`text-2xl ${proof.cited ? "text-emerald-400" : "text-red-400"}`}>
            {proof.cited ? "✓" : "✗"}
          </span>
          <div>
            <p className={`font-bold text-sm ${proof.cited ? "text-emerald-400" : "text-red-400"}`}>
              {proof.cited ? `${proof.site.domain} was cited` : `${proof.site.domain} was not cited`}
            </p>
            <p className="text-xs text-muted-foreground">Captured {capturedDate}</p>
          </div>
        </div>

        <div className="card-surface rounded-2xl p-5 mb-4">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Query asked</p>
          <p className="text-base font-semibold text-foreground">{proof.query}</p>
        </div>

        <div className="card-surface rounded-2xl p-5 mb-8">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">AI response</p>
          <div
            className="text-sm text-muted-foreground leading-relaxed proof-response"
            dangerouslySetInnerHTML={{ __html: highlightedResponse }}
          />
        </div>

        <div className="border border-border rounded-xl p-5 flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex-1">
            <p className="text-sm font-bold text-foreground">Track your own AI citations</p>
            <p className="text-xs text-muted-foreground mt-0.5">See when ChatGPT, Perplexity, and Google AI mention your brand.</p>
          </div>
          <Link
            href="/signup"
            className="shrink-0 px-5 py-2.5 rounded-full bg-foreground text-background text-sm font-bold hover:opacity-90 transition-all"
          >
            Try free →
          </Link>
        </div>
      </main>

      <style>{`.proof-response mark.highlight{background:rgba(16,185,129,0.2);color:#10b981;border-radius:3px;padding:0 2px}`}</style>

      <SiteFooter />
    </>
  );
}
