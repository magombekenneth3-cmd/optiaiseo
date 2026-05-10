import { Inngest } from "inngest";

const eventKey = process.env.INNGEST_EVENT_KEY;

if (
    process.env.NODE_ENV === "production" &&
    process.env.NEXT_PHASE !== "phase-production-build" &&
    !eventKey
) {
    console.warn(
        "[Inngest] INNGEST_EVENT_KEY not set — all inngest.send() calls will be silently dropped. " +
        "Set it in Railway Variables → redeploy."
    );
}

export const inngest = new Inngest({
    id: "seo-tool-platform",
    ...(eventKey ? { eventKey } : {}),
    ...(process.env.INNGEST_BASE_URL ? { baseUrl: process.env.INNGEST_BASE_URL } : {}),
});
