import { EmbedWidget } from "@/components/embed/EmbedWidget";

// Accepts query params: key, brand, color, logo
// White-label is resolved server-side from user.subscriptionTier

type SearchParams = Promise<{
    key?: string;
    brand?: string;
    color?: string;
    logo?: string;
}>;

export default async function EmbedAuditPage({
    searchParams,
}: {
    searchParams: SearchParams;
}) {
    const { key, brand, color: colorParam, logo } = await searchParams;
    const apiKey    = key        ?? "";
    const brandName = brand      ?? "SEO";
    const color     = colorParam ?? "6366f1";
    const logoUrl   = logo       ?? "";

    // Server-side white-label check
    let whiteLabel = false;
    if (apiKey) {
        const { prisma } = await import("@/lib/prisma");
        const owner = await prisma.user.findFirst({
            where: { whiteLabel: { path: ["embedKey"], equals: apiKey } },
            select: { subscriptionTier: true },
        });
        whiteLabel = owner?.subscriptionTier === "AGENCY";
    }

    return (
        <html lang="en">
            <head>
                <meta charSet="utf-8" />
                <meta name="viewport" content="width=device-width, initial-scale=1" />
                <title>{brandName} SEO Analyser</title>
                <meta name="robots" content="noindex,nofollow" />
            </head>
            <body style={{ margin: 0, padding: 0, background: "#fff" }}>
                <EmbedWidget
                    apiKey={apiKey}
                    brandName={brandName}
                    accentColor={`#${color}`}
                    logoUrl={logoUrl}
                    whiteLabel={whiteLabel}
                />
            </body>
        </html>
    );
}
