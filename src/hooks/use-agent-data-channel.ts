"use client";

import { useEffect } from "react";
import { useRoomContext } from "@livekit/components-react";
import { RoomEvent } from "livekit-client";
import { useAgentStore, type ChartPayload } from "@/store/agent-store";

export function useAgentDataChannel() {
    const room = useRoomContext();
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

                    case "set_insights":
                        if (Array.isArray(msg.insights)) {
                            dispatch({
                                type: "SET_METRICS",
                                metrics: {
                                    seoHealth: msg.seoHealth ?? null,
                                    aiVisibility: msg.aiVisibility ?? null,
                                    insights: msg.insights,
                                    recommendedActions: msg.recommendedActions ?? [],
                                },
                            });
                        }
                        break;

                    case "awaiting_user_input":
                        dispatch({ type: "AWAITING_USER_INPUT", timeoutMs: msg.timeoutMs });
                        break;

                    case "keepalive":
                        dispatch({ type: "KEEPALIVE", message: msg.message });
                        break;

                    case "site_added":
                        if (msg.domain) {
                            dispatch({ type: "TOOL_LOG", message: `Site added: ${msg.domain}` });
                            dispatch({ type: "SET_DOMAIN", domain: msg.domain });
                        }
                        break;

                    default:
                        break;
                }
            } catch {
                // non-JSON or malformed message — ignore
            }
        };

        room.on(RoomEvent.DataReceived, handler);
        return () => { room.off(RoomEvent.DataReceived, handler); };
    }, [room, dispatch]);
}
