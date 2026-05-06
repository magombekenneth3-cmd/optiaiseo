import { logger, formatError } from "@/lib/logger";

export interface AutocompleteSuggestion {
    keyword: string;
}

const FETCH_TIMEOUT_MS = 5000;

export async function fetchGoogleAutocomplete(query: string): Promise<AutocompleteSuggestion[]> {
    if (!query) return [];

    try {
        const url = `https://suggestqueries.google.com/complete/search?client=firefox&q=${encodeURIComponent(query)}`;
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        let res: Response;
        try {
            res = await fetch(url, {
                signal: controller.signal,
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
                },
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!res.ok) {
            logger.error("[autocomplete] Fetch failed", { query, status: res.status });
            return [];
        }

        const data = await res.json();
        const suggestions: string[] = data[1] || [];
        return suggestions.map((keyword) => ({ keyword }));
    } catch (err: unknown) {
        logger.error("[autocomplete] Error fetching suggestions", { query, error: formatError(err) });
        return [];
    }
}

export async function fetchKeywordIdeas(seed: string): Promise<AutocompleteSuggestion[]> {
    if (!seed) return [];

    const baseResults = await fetchGoogleAutocomplete(seed);

    const questionVariations = [
        `how to ${seed}`,
        `how does ${seed}`,
        `why ${seed}`,
        `what is ${seed}`,
        `what are ${seed}`,
        `when should ${seed}`,
        `can I ${seed}`,
        `do I need ${seed}`,
        `is it possible to ${seed}`,
        `best way to ${seed}`,
        `how much does ${seed}`,
        `${seed} for beginners`,
        `${seed} step by step`,
    ];

    const commercialVariations = [
        `best ${seed}`,
        `${seed} vs`,
        `${seed} alternatives`,
        `${seed} tools`,
        `${seed} software`,
        `cheap ${seed}`,
        `affordable ${seed}`,
        `${seed} for small business`,
        `${seed} pricing`,
    ];

    const painPointVariations = [
        `${seed} problems`,
        `${seed} without`,
        `is ${seed} worth it`,
        `${seed} reddit`,
        `${seed} forum`,
        `${seed} tips`,
        `${seed} mistakes`,
        `${seed} help`,
    ];

    const alphabetVariations = "abcdefghijklm".split("").map((letter) => `${seed} ${letter}`);

    const allVariations = [
        ...questionVariations,
        ...commercialVariations,
        ...painPointVariations,
        ...alphabetVariations,
    ];

    const batchSize = 10;
    const variationResults: AutocompleteSuggestion[] = [];

    for (let i = 0; i < allVariations.length; i += batchSize) {
        const batch = allVariations.slice(i, i + batchSize);
        const batchResults = await Promise.all(batch.map((v) => fetchGoogleAutocomplete(v)));
        variationResults.push(...batchResults.flat());
        if (i + batchSize < allVariations.length) {
            await new Promise((r) => setTimeout(r, 200));
        }
    }

    const allKeywords = new Set<string>();
    const seedParts = seed.toLowerCase().split(" ");

    [...baseResults, ...variationResults].forEach((item) => {
        const lower = item.keyword.toLowerCase().trim();
        if (lower.length > 3 && seedParts.some((part) => part.length > 2 && lower.includes(part))) {
            allKeywords.add(lower);
        }
    });

    return Array.from(allKeywords).map((keyword) => ({ keyword }));
}