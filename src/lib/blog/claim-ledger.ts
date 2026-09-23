import type { EvidencePacket, SourceEvidence } from "./contracts";

export type ClaimVerificationStatus = "supported" | "weak" | "unsupported" | "blocked";
export type ClaimAction = "KEEP" | "REWRITE" | "REMOVE" | "BLOCK";

export interface ClaimRecord {
    id: string;
    text: string;
    type: "statistic" | "fact" | "quote" | "comparison" | "experience";
    sourceIds: string[];
    sourceAuthority: number;
    freshnessStatus: "fresh" | "stale" | "unknown";
    freshnessWindowDays: number;
    verificationStatus: ClaimVerificationStatus;
    action: ClaimAction;
    confidence: number;
}

export function freshnessWindowDays(claim: string, type: ClaimRecord["type"]): number {
    const text = claim.toLowerCase();
    if (
        /pricing|price|cost|plan|subscription|version|release|algorithm|google|openai|anthropic|ai model|software|tool|feature|policy|regulation|law/.test(text)
    ) return 180;
    if (type === "statistic") return 365;
    return 730;
}

function freshness(source: SourceEvidence | undefined, windowDays: number): {
    status: ClaimRecord["freshnessStatus"];
    ageDays: number | null;
} {
    if (!source?.publishedAt) return { status: "unknown", ageDays: null };
    const published = Date.parse(source.publishedAt);
    if (!Number.isFinite(published)) return { status: "unknown", ageDays: null };
    const ageDays = Math.max(0, (Date.now() - published) / 86_400_000);
    return {
        status: ageDays <= windowDays ? "fresh" : "stale",
        ageDays,
    };
}

function matches(issue: string, claim: string): boolean {
    const a = issue.toLowerCase().replace(/\s+/g, " ").trim();
    const b = claim.toLowerCase().replace(/\s+/g, " ").trim();
    return a.includes(b.slice(0, Math.min(180, b.length))) || b.includes(a.slice(0, Math.min(180, a.length)));
}

export function buildClaimLedger(packet: EvidencePacket): ClaimRecord[] {
    const sourceById = new Map(packet.sources.map(source => [source.id, source]));
    return packet.claims.map((claim, index) => {
        const sources = claim.sourceIds
            .map(id => sourceById.get(id))
            .filter((source): source is SourceEvidence => Boolean(source));
        const windowDays = freshnessWindowDays(claim.text, claim.type);
        const freshnessStates = sources.map(source => freshness(source, windowDays).status);
        const sourceAuthority = sources.length > 0
            ? Math.max(...sources.map(source => source.confidence))
            : 0;
        const hasFabrication = packet.fabricatedClaims.some(issue => matches(issue, claim.text));
        const hasUnsupported = packet.unsupportedClaims.some(issue => matches(issue, claim.text))
            || packet.unsourcedStatistics.some(issue => matches(issue, claim.text))
            || packet.unverifiedCaseStudies.some(issue => matches(issue, claim.text));
        const stale = freshnessStates.some(status => status === "stale");
        const unknownFreshness = sources.length > 0 && freshnessStates.every(status => status === "unknown");

        let verificationStatus: ClaimVerificationStatus = "unsupported";
        let action: ClaimAction = "REMOVE";
        let confidence = 0;

        if (hasFabrication) {
            verificationStatus = "blocked";
            action = "BLOCK";
            confidence = 0;
        } else if (sources.length === 0 || hasUnsupported) {
            verificationStatus = "unsupported";
            action = claim.type === "experience" ? "REWRITE" : "REMOVE";
            confidence = 0;
        } else if (sourceAuthority >= 0.78 && !stale) {
            verificationStatus = "supported";
            action = "KEEP";
            confidence = sourceAuthority * (unknownFreshness ? 0.92 : 1);
        } else {
            verificationStatus = "weak";
            action = "REWRITE";
            confidence = Math.max(0.35, sourceAuthority * (stale ? 0.65 : 0.82));
        }

        return {
            id: `claim-${index + 1}`,
            text: claim.text,
            type: claim.type,
            sourceIds: claim.sourceIds,
            sourceAuthority,
            freshnessStatus: sources.length === 0
                ? "unknown"
                : stale
                    ? "stale"
                    : freshnessStates.some(status => status === "fresh")
                        ? "fresh"
                        : "unknown",
            freshnessWindowDays: windowDays,
            verificationStatus,
            action,
            confidence: Number(confidence.toFixed(3)),
        };
    });
}

export function summarizeClaimLedger(ledger: ClaimRecord[]) {
    return {
        total: ledger.length,
        supported: ledger.filter(claim => claim.verificationStatus === "supported").length,
        weak: ledger.filter(claim => claim.verificationStatus === "weak").length,
        unsupported: ledger.filter(claim => claim.verificationStatus === "unsupported").length,
        blocked: ledger.filter(claim => claim.verificationStatus === "blocked").length,
    };
}
