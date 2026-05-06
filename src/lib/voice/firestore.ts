import { logger } from "@/lib/logger";
 
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sessionMemoryStore = new Map<string, any[]>();
  

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function saveSession(userId: string, transcript: any[]) {
     
    try {
        sessionMemoryStore.set(userId, transcript);
     
    } catch (e: unknown) {
        logger.error("[SessionStore] Failed to save session:", { error: (e as Error)?.message || String(e) });
    }
}

export async function getSession(userId: string) {
     
    try {
        const transcript = sessionMemoryStore.get(userId);
        return transcript ? { transcript } : null;
     
    } catch (e: unknown) {
        logger.error("[SessionStore] Failed to get session:", { error: (e as Error)?.message || String(e) });
        return null;
    }
}
