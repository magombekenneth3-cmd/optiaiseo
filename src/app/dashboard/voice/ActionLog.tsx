"use client";

import { Zap } from "lucide-react";
import { useRef, useState } from "react";

function formatTime(date: Date) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

interface ActionLogProps {
    logs: string[];
    isProcessing: boolean;
    className?: string;
}

const PERSONAS = [
    { name: "Aria",   color: "from-emerald-500 to-blue-500",  initial: "A" },
    { name: "Fenrir", color: "from-indigo-500 to-purple-500", initial: "F" },
    { name: "Kore",   color: "from-pink-500 to-rose-500",     initial: "K" },
    { name: "Puck",   color: "from-amber-400 to-orange-500",  initial: "P" },
    { name: "Charon", color: "from-cyan-500 to-blue-400",     initial: "C" },
];

export default function ActionLog({ logs, isProcessing, className }: ActionLogProps) {
    const [persona, setPersona] = useState(PERSONAS[0]);
    const timestampsRef = useRef<Map<number, Date>>(new Map());

    logs.forEach((_, i) => {
        if (!timestampsRef.current.has(i)) {
            timestampsRef.current.set(i, new Date());
        }
    });

    if (logs.length === 0) return null;

    const assistantAvatar = (
        <div className={`w-7 h-7 rounded-full bg-gradient-to-br ${persona.color} flex items-center justify-center shadow-lg`}>
            <span className="text-white font-bold text-xs">{persona.initial}</span>
        </div>
    );
    const userAvatar = (
        <div className="w-7 h-7 rounded-full bg-gradient-to-br from-zinc-400 to-zinc-600 flex items-center justify-center shadow-lg">
            <span className="text-white font-bold text-xs">U</span>
        </div>
    );

    const playVoice = (text: string) => {
        if ("speechSynthesis" in window) {
            const utter = new window.SpeechSynthesisUtterance(text);
            utter.lang = "en-US";
            window.speechSynthesis.speak(utter);
        }
    };

    return (
        <div className={`shrink-0 rounded-2xl border border-indigo-500/15 bg-indigo-500/5 overflow-hidden ${className}`}>
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-indigo-500/10">
                <Zap className="w-3.5 h-3.5 text-indigo-400" />
                <span className="text-[11px] font-bold uppercase tracking-widest text-indigo-400">AI Actions</span>
                <select
                    className="ml-4 px-2 py-1 rounded bg-muted text-xs text-white border border-border focus:outline-none"
                    value={persona.name}
                    onChange={e => {
                        const p = PERSONAS.find(p => p.name === e.target.value);
                        if (p) setPersona(p);
                    }}
                >
                    {PERSONAS.map(p => (
                        <option key={p.name} value={p.name}>{p.name}</option>
                    ))}
                </select>
                {isProcessing && (
                    <div className="ml-auto flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-ping" />
                        <span className="text-[10px] text-indigo-500 font-medium">Running</span>
                    </div>
                )}
            </div>

            <div className="px-4 py-3 space-y-3 max-h-36 overflow-y-auto">
                {logs.map((log, i) => {
                    const isLast   = i === logs.length - 1;
                    const isActive = isLast && isProcessing;
                    const isUser   = log.startsWith("USER:");
                    const cleanLog = log.replace(/^USER:\s*/, "").replace(/^>\s*/, "").replace(/\.\.\.$/, "");
                    const time     = formatTime(timestampsRef.current.get(i) ?? new Date());
                    const status   = isActive ? "sending" : "delivered";
                    return (
                        <div
                            key={i}
                            className={`flex items-end gap-2.5 ${isUser ? "flex-row-reverse" : ""} animate-fadeIn`}
                            style={{ animationDelay: `${i * 0.05}s` }}
                        >
                            {isUser ? userAvatar : assistantAvatar}
                            <div className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
                                <div
                                    className={`rounded-2xl px-4 py-2 text-[13px] font-mono leading-relaxed shadow-md max-w-xs break-words relative ${
                                        isUser
                                            ? "bg-gradient-to-br from-zinc-800/80 to-zinc-700/80 text-foreground"
                                            : "bg-gradient-to-br from-indigo-900/80 to-indigo-700/80 text-indigo-100"
                                    } ${isActive ? "ring-2 ring-emerald-400/40" : ""}`}
                                    style={isUser ? { borderBottomRightRadius: 6 } : { borderBottomLeftRadius: 6 }}
                                >
                                    {cleanLog}
                                    <div className="flex items-center gap-2 mt-1">
                                        <span className="text-[10px] text-muted-foreground">{time}</span>
                                        <span className="text-[10px] text-muted-foreground">
                                            {status === "sending" ? "Sending..." : "Delivered"}
                                        </span>
                                        {isActive && !isUser && (
                                            <span className="inline-flex ml-1 gap-px">
                                                {[0, 1, 2].map((d) => (
                                                    <span
                                                        key={d}
                                                        className="inline-block w-0.5 h-0.5 rounded-full bg-indigo-400"
                                                        style={{
                                                            animation: "actionDot 1s ease-in-out infinite",
                                                            animationDelay: `${d * 0.2}s`,
                                                        }}
                                                    />
                                                ))}
                                            </span>
                                        )}
                                    </div>
                                </div>
                                {!isUser && (
                                    <button
                                        className="mt-1 text-xs text-emerald-400 hover:underline focus:outline-none"
                                        onClick={() => playVoice(cleanLog)}
                                    >
                                        🔊 Listen
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <style>{`
                @keyframes actionDot {
                    0%, 100% { opacity: 0.3; transform: translateY(0); }
                    50% { opacity: 1; transform: translateY(-2px); }
                }
                @keyframes fadeIn {
                    0% { opacity: 0; transform: translateY(16px) scale(0.98); }
                    100% { opacity: 1; transform: translateY(0) scale(1); }
                }
                .animate-fadeIn {
                    animation: fadeIn 0.5s both;
                }
            `}</style>
        </div>
    );
}
