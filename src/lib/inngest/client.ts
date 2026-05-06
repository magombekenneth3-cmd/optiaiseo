import { Inngest } from "inngest";

// Create a client to send and receive events.
// INNGEST_BASE_URL lets us point at the local dev-server container
// (e.g. http://inngest:8288) instead of the cloud, which is required
// inside Docker Compose where host.docker.internal is not resolvable
// on Linux hosts.
export const inngest = new Inngest({
    id: "seo-tool-platform",
    ...(process.env.INNGEST_BASE_URL
        ? { baseUrl: process.env.INNGEST_BASE_URL }
        : {}),
});
