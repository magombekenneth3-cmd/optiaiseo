/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect } from "react";
import { useAgentSession } from "@/components/agents-ui/agent-session-provider";
import { useAgentStore, type ChartPayload } from "@/store/agent-store";


export function useAgentDataChannel() {

    const session = useAgentSession();
    const room = session.room;
    const { dispatch } = useAgentStore();

    useEffect(() => {
        if (!room) return;

        const handler = (payload: Uint8Array) => {
            try {
                const msg = JSON.parse(new TextDecoder().decode(payload));

                switch (msg.event) {
                    case "tool_start":
                        if (typeof msg.tool === "string") {
                            dispatch({ type: "TOOL_START", tool: msg.tool });
                        }
                        break;

                    case "tool_log":
                        if (typeof msg.message === "string") {
                            dispatch({ type: "TOOL_LOG", message: msg.message });
                        }
                        break;

                    case "set_domain":
                        if (typeof msg.domain === "string") {
                            dispatch({ type: "SET_DOMAIN", domain: msg.domain });
                        }
                        break;

                    case "set_chart":
                        if (msg.chart && typeof msg.chart.type === "string") {
                            dispatch({ type: "SET_CHART", chart: msg.chart as ChartPayload });
                        }
                        break;

                    default:
                        break;
                }
            } catch {
                // non-JSON or malformed message — ignore silently
            }
        };

         
        (room as any).on("dataReceived", handler);
        return () => { (room as any).off("dataReceived", handler); };
    }, [room, dispatch]);
}