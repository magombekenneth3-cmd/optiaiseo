
const SERPER_KEY = () =>
    process.env.SERPER_API_KEY || process.env.SERPAPI_KEY || "";

interface PlagiarismMatch {
    phrase: string;
    matchedUrl: string;
    matchedTitle: string;
}

export interface PlagiarismResult {
    isPlagiarised: boolean;
    originalityScore: number;
    matches: PlagiarismMatch[];
    checkedPhrases: number;
    recommendation?: string;
}

function extractTestPhrases(text: string, maxPhrases = 6): string[] {
    const clean = text
        .replace(/<[^>]*>/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    const sentences = clean
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => {
            const words = s.split(/\s+/).length;
            return words >= 12 && words <= 28;
        });

    if (!sentences.length) return [];

    const selected: string[] = [];
    const step = Math.max(1, Math.floor(sentences.length / maxPhrases));

    for (let i = 0; i < maxPhrases && selected.length < maxPhrases; i++) {
        const idx = Math.min(i * step, sentences.length - 1);
        const phrase = sentences[idx];
        if (phrase && !selected.includes(phrase)) selected.push(phrase);
    }

    return selected;
}

async function fetchSerper(phrase: string, key: string) {
    const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
            "X-API-KEY": key,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            q: `"${phrase}"`,
            num: 5,
        }),
        signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return (data.organic || []) as Array<{ link: string; title: string }>;
}

export async function checkPlagiarism(
    content: string,
    ownDomain: string
): Promise<PlagiarismResult> {
    const key = SERPER_KEY();
    if (!key) {
        return {
            isPlagiarised: false,
            originalityScore: 100,
            matches: [],
            checkedPhrases: 0,
            recommendation: "Missing SERPER API key.",
        };
    }

    const phrases = extractTestPhrases(content);
    if (!phrases.length) {
        return {
            isPlagiarised: false,
            originalityScore: 100,
            matches: [],
            checkedPhrases: 0,
        };
    }

    const matches: PlagiarismMatch[] = [];

    const responses = await Promise.allSettled(
        phrases.map(async phrase => {
            const organic = await fetchSerper(phrase, key);
            return { phrase, organic: organic || [] };
        })
    );

    for (const r of responses) {
        if (r.status !== "fulfilled") continue;

        const { phrase, organic } = r.value;

        const hit = organic.find(o => o.link && !o.link.includes(ownDomain));

        if (hit) {
            matches.push({
                phrase,
                matchedUrl: hit.link,
                matchedTitle: hit.title,
            });
        }
    }

    const uniqueMatches = new Set(matches.map(m => m.phrase)).size;
    const total = phrases.length;

    const originalityScore = total
        ? Math.max(0, Math.round(((total - uniqueMatches) / total) * 100))
        : 100;

    const isPlagiarised = uniqueMatches > 0;

    return {
        isPlagiarised,
        originalityScore,
        matches,
        checkedPhrases: total,
        recommendation: isPlagiarised
            ? "Potential duplicate content detected. Rewrite matched sections for originality."
            : undefined,
    };
}