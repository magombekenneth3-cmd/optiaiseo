'use client';

import { createContext, useContext } from 'react';
import { RoomContext, type UseSessionReturn } from '@livekit/components-react';


const SessionCtx = createContext<UseSessionReturn | null>(null);

/**
 * Read the session injected by AgentSessionProvider.
 * Drop-in replacement for useSessionContext() from @livekit/components-react
 * when SessionContext is not publicly exported by the package version in use.
 */
export function useAgentSession(): UseSessionReturn {
    const ctx = useContext(SessionCtx);
    if (!ctx) throw new Error('useAgentSession must be used inside <AgentSessionProvider>');
    return ctx;
}

/**
 * Safe version — returns null outside a provider instead of throwing.
 */
export function useMaybeAgentSession(): UseSessionReturn | null {
    return useContext(SessionCtx);
}

// ─── Props ─────────────────────────────────────────────────────────────────────
export interface AgentSessionProviderProps {
    /**
     * The session object returned by useSession(tokenSource).
     * Provides both RoomContext (for livekit hooks) and SessionCtx
     * (for useAgent, useSessionMessages, useAgentSession).
     */
    session: UseSessionReturn;
    children: React.ReactNode;
}

/**
 * Provides the LiveKit session into React context.
 *
 * - Injects RoomContext so existing livekit hooks work (RoomAudioRenderer,
 *   useTrackToggle, useMaybeRoomContext, StartAudio, etc.)
 * - Injects SessionCtx so useAgentSession() / useAgent(session) work.
 */
export function AgentSessionProvider({ session, children }: AgentSessionProviderProps) {
    return (
        // RoomContext.Provider is exported from @livekit/components-react ✅
        // session.room is the underlying livekit-client Room instance
        <RoomContext.Provider value={session.room ?? null}>
            <SessionCtx.Provider value={session}>
                {children}
            </SessionCtx.Provider>
        </RoomContext.Provider>
    );
}