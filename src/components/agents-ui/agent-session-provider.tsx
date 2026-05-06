'use client';

import { createContext, useContext } from 'react';
import { LiveKitRoom, type UseSessionReturn } from '@livekit/components-react';

const SessionCtx = createContext<UseSessionReturn | null>(null);

export function useAgentSession(): UseSessionReturn {
  const ctx = useContext(SessionCtx);
  if (!ctx) throw new Error('useAgentSession must be used inside <AgentSessionProvider>');
  return ctx;
}

export function useMaybeAgentSession(): UseSessionReturn | null {
  return useContext(SessionCtx);
}

/**
 * Props for the AgentSessionProvider component.
 */
export interface AgentSessionProviderProps {
  /**
   * The session object returned by `useSession()`.
   * Injected into React context so all child hooks can read it:
   * useAgent(), useSessionMessages(), useSessionContext(), useConnectionState()
   */
  session: UseSessionReturn;
  children: React.ReactNode;
}

/**
 * Provides the LiveKit session into React context.
 *
 * @example
 * ```tsx
 * const session = useSession(tokenSource);
 * useEffect(() => { session.start(); return () => session.end(); }, []);
 *
 * return (
 *   <AgentSessionProvider session={session}>
 *     <RoomAudioRenderer />
 *     <AgentControlBar />
 *   </AgentSessionProvider>
 * );
 * ```
 */
export function AgentSessionProvider({ session, children }: AgentSessionProviderProps) {
  // LiveKitRoom provides RoomContext, LKFeatureContext, and internal track context.
  // We avoid `SessionProvider` because it's not actually exported from the main bundle in 2.9.20.
  // The hooks in our UI like `useChat` will fall back to reading from `RoomContext` if
  // `SessionContext` is missing, per LiveKit v2's fallback behavior.
  return (
    <LiveKitRoom room={session.room} audio={true} serverUrl={undefined} token={undefined}>
      <SessionCtx.Provider value={session}>
        {children}
      </SessionCtx.Provider>
    </LiveKitRoom>
  );
}