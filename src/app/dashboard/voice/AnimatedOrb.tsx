/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";
import { useRef, useEffect, useState } from "react";

type OrbState = "idle" | "listening" | "thinking" | "speaking" | string;

interface AnimatedOrbProps {
  state?: OrbState;
  size?: "sm" | "md" | "lg";
}

export function AnimatedOrb({ state = "idle", size = "lg" }: AnimatedOrbProps) {
  const waveformRef = useRef<HTMLCanvasElement>(null);
  const [waveformActive, setWaveformActive] = useState(false);
  useEffect(() => {
    let audioCtx: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let dataArray: Uint8Array | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let animationId: number;
    async function setupWaveform() {
      if (
        (state === "listening" || state === "speaking") &&
        waveformRef.current
      ) {
        setWaveformActive(true);
        audioCtx = new (window.AudioContext ||
           
          (window as any).webkitAudioContext)();
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: true,
        });
        analyser = audioCtx.createAnalyser();
        source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 64;
        const bufferLength = analyser.frequencyBinCount;
        dataArray = new Uint8Array(bufferLength);
        const canvas = waveformRef.current;
        const ctx = canvas.getContext("2d");
        function draw() {
           
          if (!ctx || !analyser || !dataArray) return;
          analyser.getByteTimeDomainData(dataArray as any);
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.strokeStyle = "#34d399";
          ctx.lineWidth = 2;
          ctx.beginPath();
          const sliceWidth = canvas.width / bufferLength;
          let x = 0;
          for (let i = 0; i < bufferLength; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * canvas.height) / 2;
            if (i === 0) {
              ctx.moveTo(x, y);
            } else {
              ctx.lineTo(x, y);
            }
            x += sliceWidth;
          }
          ctx.lineTo(canvas.width, canvas.height / 2);
          ctx.stroke();
          animationId = requestAnimationFrame(draw);
        }
        draw();
      }
    }
    setupWaveform();
    return () => {
      setWaveformActive(false);
      if (audioCtx) audioCtx.close();
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [state]);
  const sizeMap = {
    sm: {
      orb: "w-20 h-20",
      inner: "w-10 h-10",
      ring1: "w-28 h-28",
      ring2: "w-36 h-36",
      ring3: "w-44 h-44",
    },
    md: {
      orb: "w-28 h-28",
      inner: "w-14 h-14",
      ring1: "w-36 h-36",
      ring2: "w-44 h-44",
      ring3: "w-52 h-52",
    },
    lg: {
      orb: "w-36 h-36",
      inner: "w-18 h-18",
      ring1: "w-48 h-48",
      ring2: "w-60 h-60",
      ring3: "w-72 h-72",
    },
  };

  const s = sizeMap[size];

  // Color and animation vary by state
  const coreGradient =
    state === "speaking"
      ? "from-emerald-400 via-teal-500 to-blue-500"
      : state === "thinking"
        ? "from-indigo-400 via-violet-500 to-purple-600"
        : state === "listening"
          ? "from-indigo-500 via-blue-500 to-cyan-400"
          : "from-indigo-600 via-indigo-500 to-emerald-500"; // idle

  const glowColor =
    state === "speaking"
      ? "bg-emerald-500/30"
      : state === "thinking"
        ? "bg-violet-500/30"
        : state === "listening"
          ? "bg-blue-500/25"
          : "bg-indigo-500/20";

  const ringOpacity =
    state === "idle"
      ? "opacity-[0.12]"
      : state === "listening"
        ? "opacity-[0.20]"
        : state === "thinking"
          ? "opacity-[0.15]"
          : "opacity-[0.25]";

  const coreAnimation =
    state === "speaking"
      ? "animate-pulse"
      : state === "thinking"
        ? "animate-pulse"
        : state === "listening"
          ? ""
          : "";
  return (
    <div
      className="relative flex items-center justify-center"
      style={{
        perspective: 800,
        WebkitPerspective: 800,
      }}
      aria-live="polite"
      aria-label={`Voice orb state: ${state}`}
      tabIndex={0}
    >
      {/* Outermost glow burst */}
      <div
        className={`absolute rounded-full ${s.ring3} ${glowColor} blur-3xl transition-all duration-700 ${state !== "idle" ? "scale-110" : "scale-100"}`}
      />

      {/* Ring 2 — slow pulse */}
      <div
        className={`absolute rounded-full border ${state === "speaking" ? "border-emerald-500/30" : "border-indigo-500/20"} ${s.ring2} ${ringOpacity} transition-all duration-500`}
        style={{
          animation:
            state !== "idle"
              ? "orbRing2 3s ease-in-out infinite"
              : "orbRing2Idle 6s ease-in-out infinite",
        }}
      />

      {/* Ring 1 — faster pulse */}
      <div
        className={`absolute rounded-full border ${state === "speaking" ? "border-emerald-400/40" : "border-indigo-400/30"} ${s.ring1} transition-all duration-500`}
        style={{
          animation:
            state !== "idle"
              ? "orbRing1 2s ease-in-out infinite"
              : "orbRing1Idle 4s ease-in-out infinite",
        }}
      />

      {/* Main orb body with waveform overlay */}
      <div
        className={`relative ${s.orb} rounded-full bg-gradient-to-br ${coreGradient} flex items-center justify-center shadow-2xl transition-all duration-500 cursor-pointer ${coreAnimation} premium-glass`}
        style={{
          boxShadow:
            state === "speaking"
              ? "0 8px 60px 0 rgba(16,185,129,0.45), 0 1.5px 24px 0 rgba(16,185,129,0.18), 0 0 0 8px rgba(255,255,255,0.08)"
              : state === "thinking"
                ? "0 8px 60px 0 rgba(99,102,241,0.55), 0 1.5px 24px 0 rgba(139,92,246,0.22), 0 0 0 8px rgba(255,255,255,0.07)"
                : state === "listening"
                  ? "0 8px 60px 0 rgba(99,102,241,0.38), 0 1.5px 24px 0 rgba(59,130,246,0.18), 0 0 0 8px rgba(255,255,255,0.06)"
                  : "0 4px 40px 0 rgba(99,102,241,0.28), 0 1px 12px 0 rgba(16,185,129,0.12), 0 0 0 6px rgba(255,255,255,0.05)",
          backdropFilter: "blur(18px) saturate(1.2)",
          WebkitBackdropFilter: "blur(18px) saturate(1.2)",
          border: "1.5px solid rgba(255,255,255,0.18)",
          transform: "rotateY(-8deg) rotateX(6deg)",
        }}
        aria-label={`Voice orb state: ${state}`}
        tabIndex={0}
      >
        {/* Real-time waveform visualization overlay */}
        {(state === "listening" || state === "speaking") && waveformActive && (
          <canvas
            ref={waveformRef}
            width={120}
            height={32}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-none"
            style={{ opacity: 0.85 }}
            aria-label="Voice waveform"
          />
        )}
        {/* Inner shine */}
        <div className="absolute top-3 left-3 w-1/3 h-1/3 rounded-full bg-white/30 blur-md" />

        {/* State dots — speaking indicator */}
        {state === "speaking" && (
          <div className="flex items-end gap-[3px] h-5">
            {[0.4, 0.8, 1.2, 0.9, 0.6].map((delay, i) => (
              <div
                key={i}
                className="w-[3px] bg-white/90 rounded-full"
                style={{
                  height: `${[12, 20, 28, 22, 14][i]}px`,
                  animation: "voiceBar 0.8s ease-in-out infinite",
                  animationDelay: `${delay * 0.2}s`,
                }}
              />
            ))}
          </div>
        )}

        {/* Thinking spinner */}
        {state === "thinking" && (
          <div className="w-8 h-8 rounded-full border-2 border-white/30 border-t-white animate-spin" />
        )}

        {/* Listening — 3 animated dots */}
        {state === "listening" && (
          <div className="flex items-center gap-1.5">
            {[0, 0.2, 0.4].map((d, i) => (
              <div
                key={i}
                className="w-2.5 h-2.5 rounded-full bg-white/80"
                style={{
                  animation: `orbDot 1.2s ease-in-out infinite`,
                  animationDelay: `${d}s`,
                }}
              />
            ))}
          </div>
        )}

        {/* Idle — sparkle icon */}
        {(state === "idle" ||
          !["speaking", "thinking", "listening"].includes(state)) && (
          <svg
            className="w-10 h-10 text-white/80"
            viewBox="0 0 24 24"
            fill="currentColor"
          >
            <path d="M12 2L13.09 8.26L20 9L13.09 9.74L12 16L10.91 9.74L4 9L10.91 8.26L12 2Z" />
            <path
              d="M19 14L19.6 16.4L22 17L19.6 17.6L19 20L18.4 17.6L16 17L18.4 16.4L19 14Z"
              opacity="0.6"
            />
            <path
              d="M5 4L5.4 5.6L7 6L5.4 6.4L5 8L4.6 6.4L3 6L4.6 5.6L5 4Z"
              opacity="0.4"
            />
          </svg>
        )}
      </div>

      {/* CSS keyframe overrides and premium glassmorphism */}
      <style>{`
                .premium-glass {
                    background: rgba(34, 40, 49, 0.45) !important;
                    border-radius: 50% !important;
                    border: 1.5px solid rgba(255,255,255,0.18) !important;
                    box-shadow: 0 8px 32px 0 rgba(31, 38, 135, 0.18);
                }
                @keyframes orbRing1 {
                    0%, 100% { transform: scale(1); opacity: 0.35; }
                    50% { transform: scale(1.08); opacity: 0.6; }
                }
                @keyframes orbRing1Idle {
                    0%, 100% { transform: scale(1); opacity: 0.2; }
                    50% { transform: scale(1.04); opacity: 0.35; }
                }
                @keyframes orbRing2 {
                    0%, 100% { transform: scale(1); opacity: 0.2; }
                    50% { transform: scale(1.12); opacity: 0.4; }
                }
                @keyframes orbRing2Idle {
                    0%, 100% { transform: scale(1); opacity: 0.08; }
                    50% { transform: scale(1.06); opacity: 0.18; }
                }
                @keyframes orbDot {
                    0%, 100% { transform: translateY(0); opacity: 0.5; }
                    50% { transform: translateY(-6px); opacity: 1; }
                }
                @keyframes voiceBar {
                    0%, 100% { transform: scaleY(0.4); opacity: 0.6; }
                    50% { transform: scaleY(1); opacity: 1; }
                }
            `}</style>
    </div>
  );
}
