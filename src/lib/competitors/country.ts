// =============================================================================
// Competitor detection engine — country code resolver
// Maps free-text location strings to ISO 3166-1 alpha-2 Google country codes.
// =============================================================================

/** Lowercase location keyword → ISO country code */
const LOCATION_TO_COUNTRY: Record<string, string> = {
    // Africa
    "uganda": "ug", "kampala": "ug",
    "kenya": "ke", "nairobi": "ke",
    "tanzania": "tz", "dar es salaam": "tz",
    "nigeria": "ng", "lagos": "ng", "abuja": "ng",
    "ghana": "gh", "accra": "gh",
    "ethiopia": "et", "addis ababa": "et",
    "south africa": "za", "johannesburg": "za", "cape town": "za",
    "egypt": "eg", "cairo": "eg",
    "morocco": "ma", "casablanca": "ma",
    "rwanda": "rw", "kigali": "rw",
    "senegal": "sn", "dakar": "sn",
    "zimbabwe": "zw", "harare": "zw",
    "zambia": "zm", "lusaka": "zm",
    "botswana": "bw", "gaborone": "bw",
    // Europe
    "united kingdom": "gb", "uk": "gb", "england": "gb",
    "london": "gb", "manchester": "gb", "birmingham": "gb",
    "germany": "de", "berlin": "de", "munich": "de",
    "france": "fr", "paris": "fr",
    "netherlands": "nl", "amsterdam": "nl",
    "spain": "es", "madrid": "es", "barcelona": "es",
    "italy": "it", "rome": "it", "milan": "it",
    "sweden": "se", "stockholm": "se",
    "norway": "no", "oslo": "no",
    "denmark": "dk", "copenhagen": "dk",
    "finland": "fi", "helsinki": "fi",
    "poland": "pl", "warsaw": "pl",
    "portugal": "pt", "lisbon": "pt",
    // North America
    "united states": "us", "usa": "us", "us": "us",
    "new york": "us", "los angeles": "us", "chicago": "us",
    "san francisco": "us", "seattle": "us", "austin": "us",
    "canada": "ca", "toronto": "ca", "vancouver": "ca",
    "mexico": "mx", "mexico city": "mx",
    // Asia Pacific
    "india": "in", "mumbai": "in", "delhi": "in", "bangalore": "in",
    "australia": "au", "sydney": "au", "melbourne": "au",
    "new zealand": "nz", "auckland": "nz",
    "singapore": "sg",
    "malaysia": "my", "kuala lumpur": "my",
    "philippines": "ph", "manila": "ph",
    "indonesia": "id", "jakarta": "id",
    "thailand": "th", "bangkok": "th",
    "vietnam": "vn", "hanoi": "vn", "ho chi minh": "vn",
    "japan": "jp", "tokyo": "jp",
    "south korea": "kr", "seoul": "kr",
    "china": "cn", "beijing": "cn", "shanghai": "cn",
    "pakistan": "pk", "karachi": "pk",
    "bangladesh": "bd", "dhaka": "bd",
    "sri lanka": "lk", "colombo": "lk",
    // Middle East
    "uae": "ae", "dubai": "ae", "abu dhabi": "ae",
    "saudi arabia": "sa", "riyadh": "sa",
    "qatar": "qa", "doha": "qa",
    "israel": "il", "tel aviv": "il",
    "turkey": "tr", "istanbul": "tr",
    // Latin America
    "brazil": "br", "sao paulo": "br", "rio": "br",
    "argentina": "ar", "buenos aires": "ar",
    "colombia": "co", "bogota": "co",
    "chile": "cl", "santiago": "cl",
    "peru": "pe", "lima": "pe",
};

/**
 * Resolves a free-text location string to a Google country code.
 * Uses longest-match-first to handle "south africa" before "africa".
 *
 * @param location  e.g. "Kampala, Uganda" | "London, UK" | "San Francisco, CA"
 * @returns         ISO 3166-1 alpha-2 code, defaults to "us"
 */
export function resolveCountryCode(location: string): string {
    if (!location) return "us";

    const lower   = location.toLowerCase();
    const entries = Object.entries(LOCATION_TO_COUNTRY).sort(
        (a, b) => b[0].length - a[0].length // longest match first
    );

    for (const [keyword, code] of entries) {
        if (lower.includes(keyword)) return code;
    }

    return "us";
}
