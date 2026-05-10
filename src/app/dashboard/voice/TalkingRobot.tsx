"use client";

import { useEffect, useRef, useState } from "react";

type RobotState = "idle" | "listening" | "thinking" | "speaking" | string;

interface TalkingRobotProps {
  state?: RobotState;
  size?: number; // px, controls the SVG viewBox scale
  className?: string;
}

/**
 * Animated talking robot that reacts to agent state:
 *  - idle      → slow breathing bob, eyes blink occasionally
 *  - listening → ears perk up, eyes widen, antenna pulses blue
 *  - thinking  → eyes spin / scan side-to-side, gear on chest turns
 *  - speaking  → mouth opens/closes with waveform bars, eyes light up green
 */
export function TalkingRobot({
  state = "idle",
  size = 200,
  className = "",
}: TalkingRobotProps) {
  // Mouth open amount 0→1 (driven by "speaking" state)
  const [mouthOpen, setMouthOpen] = useState(0);
  // Eye scan offset for "thinking"
  const [eyeScan, setEyeScan] = useState(0);
  // Blink
  const [blink, setBlink] = useState(false);
  // Body bob (breathing)
  const [bob, setBob] = useState(0);
  // Antenna pulse phase
  const [antPulse, setAntPulse] = useState(0);
  // Voice bar heights (speaking)
  const [bars, setBars] = useState([0.3, 0.5, 0.7, 0.5, 0.3]);
  // Arm rotation (derived, updated in RAF loop)
  const [armRotation, setArmRotation] = useState(0);

  const rafRef = useRef<number>(0);
  const startRef = useRef<number>(0);

  useEffect(() => {
    const _lastBlink = 0;
    let blinkTimeout: ReturnType<typeof setTimeout>;

    const scheduleBlink = () => {
      const delay = 2000 + Math.random() * 4000;
      blinkTimeout = setTimeout(() => {
        setBlink(true);
        setTimeout(() => setBlink(false), 120);
        scheduleBlink();
      }, delay);
    };
    scheduleBlink();

    const animate = (ts: number) => {
      if (!startRef.current) startRef.current = ts;
      const t = (ts - startRef.current) / 1000;

      // Gentle body bob (all states, slower when idle)
      const bobSpeed =
        state === "speaking" ? 3.5 : state === "listening" ? 2 : 0.8;
      const bobAmp = state === "speaking" ? 2.5 : 1.5;
      setBob(Math.sin(t * bobSpeed) * bobAmp);

      // Antenna pulse
      setAntPulse((t * 2) % (Math.PI * 2));

      if (state === "speaking") {
        // Animate mouth open with slight jitter
        setMouthOpen(0.45 + Math.sin(t * 9) * 0.35 + Math.sin(t * 14.3) * 0.15);
        // Voice bars
        setBars([
          0.25 + Math.abs(Math.sin(t * 7.1)) * 0.7,
          0.3 + Math.abs(Math.sin(t * 11.3)) * 0.65,
          0.4 + Math.abs(Math.sin(t * 8.7)) * 0.55,
          0.25 + Math.abs(Math.sin(t * 13.1)) * 0.7,
          0.2 + Math.abs(Math.sin(t * 9.9)) * 0.75,
        ]);
      } else {
        setMouthOpen(0);
      }

      if (state === "thinking") {
        // Eyes scan left-right
        setEyeScan(Math.sin(t * 2.5) * 5);
      } else {
        setEyeScan(0);
      }

      // Arm rotation rhythm (replace Date.now usage)
      setArmRotation(Math.sin(t * 3.333) * 5);

      rafRef.current = requestAnimationFrame(animate);
    };

    rafRef.current = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(blinkTimeout);
    };
  }, [state]);

  const isListening = state === "listening";
  const isThinking = state === "thinking";
  const isSpeaking = state === "speaking";

  const eyeColor = isSpeaking
    ? "#10b981"
    : isListening
      ? "#60a5fa"
      : isThinking
        ? "#a78bfa"
        : "#818cf8";
  const _eyeGlow = isSpeaking
    ? "rgba(16,185,129,0.6)"
    : isListening
      ? "rgba(96,165,250,0.5)"
      : isThinking
        ? "rgba(167,139,250,0.5)"
        : "rgba(129,140,248,0.3)";
  const antennaColor = isListening
    ? "#60a5fa"
    : isThinking
      ? "#a78bfa"
      : isSpeaking
        ? "#10b981"
        : "#6366f1";
  const bodyStroke = isSpeaking
    ? "#10b981"
    : isListening
      ? "#60a5fa"
      : isThinking
        ? "#a78bfa"
        : "#4f46e5";
  const screenBg = isSpeaking
    ? "#052e16"
    : isThinking
      ? "#1e1b4b"
      : isListening
        ? "#0c1a2e"
        : "#18181b";

  // Mouth shape
  const mouthY = 148;
  const mouthW = 28;
  const mouthH = Math.max(2, mouthOpen * 20);
  // Rounded rect for mouth
  const mouthRx = mouthOpen > 0.1 ? 5 : 2;

  // Ear/side panel height (grows when listening)
  const earH = isListening ? 22 : 14;

  return (
    <div
      className={`relative flex items-center justify-center select-none ${className}`}
      style={{ width: size, height: size }}
      aria-label={`Robot assistant — ${state}`}
    >
      {/* Ambient glow behind robot */}
      <div
        className="absolute rounded-full blur-3xl transition-all duration-700 pointer-events-none"
        style={{
          width: size * 0.85,
          height: size * 0.85,
          background: isSpeaking
            ? "radial-gradient(circle, rgba(16,185,129,0.18) 0%, transparent 70%)"
            : isListening
              ? "radial-gradient(circle, rgba(96,165,250,0.15) 0%, transparent 70%)"
              : isThinking
                ? "radial-gradient(circle, rgba(167,139,250,0.15) 0%, transparent 70%)"
                : "radial-gradient(circle, rgba(99,102,241,0.12) 0%, transparent 70%)",
        }}
      />

      <svg
        viewBox="0 0 160 200"
        width={size}
        height={size}
        xmlns="http://www.w3.org/2000/svg"
        style={{ transform: `translateY(${bob}px)`, transition: "filter 0.4s" }}
        overflow="visible"
      >
        <defs>
          <filter id="glow-eye">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <filter id="glow-body">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="bodyGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#27272a" />
            <stop offset="100%" stopColor="#18181b" />
          </linearGradient>
          <linearGradient id="headGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3f3f46" />
            <stop offset="100%" stopColor="#27272a" />
          </linearGradient>
          <radialGradient id="screenGrad" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor={screenBg} stopOpacity="1" />
            <stop offset="100%" stopColor="#09090b" stopOpacity="1" />
          </radialGradient>
          <clipPath id="headClip">
            <rect x="28" y="28" width="104" height="92" rx="18" />
          </clipPath>
        </defs>

        {/* ── Antenna ──────────────────────────────────────── */}
        <line
          x1="80"
          y1="28"
          x2="80"
          y2="10"
          stroke="#52525b"
          strokeWidth="3"
          strokeLinecap="round"
        />
        {/* Antenna ball */}
        <circle
          cx="80"
          cy="7"
          r="5"
          fill={antennaColor}
          opacity={0.5 + Math.sin(antPulse) * 0.5}
          filter="url(#glow-eye)"
        />
        {/* Antenna pulse ring */}
        {(isListening || isSpeaking) && (
          <circle
            cx="80"
            cy="7"
            r={5 + Math.sin(antPulse) * 4}
            fill="none"
            stroke={antennaColor}
            strokeWidth="1"
            opacity={0.4 - Math.sin(antPulse) * 0.3}
          />
        )}

        {/* ── Side ears / panels ────────────────────────── */}
        {/* Left ear */}
        <rect
          x="17"
          y={60 - (earH - 14) / 2}
          width="11"
          height={earH}
          rx="4"
          fill="#27272a"
          stroke={isListening ? "#60a5fa" : "#3f3f46"}
          strokeWidth="1.5"
          style={{ transition: "all 0.4s" }}
        />
        <rect
          x="22"
          y={64 - (earH - 14) / 2}
          width="2"
          height={earH - 8}
          rx="1"
          fill={isListening ? "#60a5fa" : "#52525b"}
          opacity="0.8"
          style={{ transition: "all 0.4s" }}
        />
        {/* Right ear */}
        <rect
          x="132"
          y={60 - (earH - 14) / 2}
          width="11"
          height={earH}
          rx="4"
          fill="#27272a"
          stroke={isListening ? "#60a5fa" : "#3f3f46"}
          strokeWidth="1.5"
          style={{ transition: "all 0.4s" }}
        />
        <rect
          x="136"
          y={64 - (earH - 14) / 2}
          width="2"
          height={earH - 8}
          rx="1"
          fill={isListening ? "#60a5fa" : "#52525b"}
          opacity="0.8"
          style={{ transition: "all 0.4s" }}
        />

        {/* ── Head ─────────────────────────────────────────── */}
        <rect
          x="28"
          y="28"
          width="104"
          height="92"
          rx="18"
          fill="url(#headGrad)"
          stroke={bodyStroke}
          strokeWidth="1.5"
          filter="url(#glow-body)"
          style={{ transition: "stroke 0.4s" }}
        />
        {/* Head highlight */}
        <rect
          x="36"
          y="32"
          width="88"
          height="20"
          rx="10"
          fill="white"
          opacity="0.04"
        />

        {/* Screen / face plate */}
        <rect
          x="36"
          y="38"
          width="88"
          height="72"
          rx="12"
          fill="url(#screenGrad)"
        />
        <rect
          x="36"
          y="38"
          width="88"
          height="72"
          rx="12"
          fill="none"
          stroke={bodyStroke}
          strokeWidth="0.8"
          opacity="0.5"
          style={{ transition: "stroke 0.4s" }}
        />
        {/* Screen scanline overlay */}
        <rect
          x="36"
          y="38"
          width="88"
          height="72"
          rx="12"
          fill="url(#scanlines)"
          opacity="0.06"
          clipPath="url(#headClip)"
        />

        {/* ── Eyes ──────────────────────────────────────────── */}
        {/* Left eye */}
        <g
          transform={`translate(${56 + eyeScan}, 72)`}
          style={{ transition: "transform 0.15s" }}
        >
          <rect
            x="-14"
            y="-13"
            width="28"
            height={blink ? 3 : 26}
            rx={blink ? 1.5 : 8}
            fill="#09090b"
            style={{ transition: "height 0.08s, y 0.08s" }}
          />
          {/* Eye iris */}
          {!blink && (
            <>
              <circle cx="0" cy="0" r="8" fill={eyeColor} opacity="0.25" />
              <circle
                cx="0"
                cy="0"
                r="5"
                fill={eyeColor}
                filter="url(#glow-eye)"
              />
              <circle cx="0" cy="0" r="2.5" fill="white" opacity="0.9" />
              {/* Pupil shine */}
              <circle cx="2" cy="-2" r="1" fill="white" opacity="0.6" />
              {/* Thinking: scan line */}
              {isThinking && (
                <rect
                  x="-12"
                  y="-1"
                  width="24"
                  height="2"
                  rx="1"
                  fill={eyeColor}
                  opacity="0.3"
                  style={{ animation: "scanH 1.2s linear infinite" }}
                />
              )}
            </>
          )}
        </g>

        {/* Right arm */}
        <rect
          x="138"
          y="140"
          width="16"
          height="40"
          rx="8"
          fill="#27272a"
          stroke="#3f3f46"
          strokeWidth="1.5"
          style={{
            transformOrigin: "146px 140px",
            transform: isSpeaking
              ? `rotate(${armRotation + 8}deg)`
              : "rotate(0deg)",
            transition: "transform 0.3s",
          }}
        />

        {/* ── Nose / center dot ─────────────────────────────── */}
        <circle
          cx="80"
          cy="93"
          r="2.5"
          fill={bodyStroke}
          opacity="0.5"
          style={{ transition: "fill 0.4s" }}
        />

        {/* ── Mouth ─────────────────────────────────────────── */}
        {isSpeaking ? (
          /* Speaking: open mouth with voice bars */
          <g>
            {/* Mouth opening */}
            <rect
              x={80 - mouthW / 2}
              y={mouthY - mouthH / 2}
              width={mouthW}
              height={Math.max(3, mouthH)}
              rx={mouthRx}
              fill="#09090b"
            />
            {/* Voice bars inside mouth */}
            {bars.map((h, i) => (
              <rect
                key={i}
                x={80 - mouthW / 2 + 3 + i * 5}
                y={mouthY - mouthH / 2 + (mouthH - mouthH * h) / 2 + 1}
                width={3}
                height={Math.max(1, mouthH * h - 2)}
                rx={1.5}
                fill={eyeColor}
                opacity="0.9"
              />
            ))}
          </g>
        ) : (
          /* Not speaking: flat/slight smile */
          <path
            d={`M ${80 - 16} ${mouthY} Q 80 ${mouthY + (isListening ? 8 : 4)} ${80 + 16} ${mouthY}`}
            fill="none"
            stroke={isListening ? "#60a5fa" : "#52525b"}
            strokeWidth="2.5"
            strokeLinecap="round"
            style={{ transition: "all 0.4s" }}
          />
        )}

        {/* ── Neck ──────────────────────────────────────────── */}
        <rect
          x="68"
          y="120"
          width="24"
          height="14"
          rx="4"
          fill="#27272a"
          stroke="#3f3f46"
          strokeWidth="1"
        />
        {/* Neck bolts */}
        <circle cx="74" cy="127" r="2" fill="#3f3f46" />
        <circle cx="86" cy="127" r="2" fill="#3f3f46" />

        {/* ── Body ──────────────────────────────────────────── */}
        <rect
          x="22"
          y="134"
          width="116"
          height="58"
          rx="14"
          fill="url(#bodyGrad)"
          stroke={bodyStroke}
          strokeWidth="1.5"
          filter="url(#glow-body)"
          style={{ transition: "stroke 0.4s" }}
        />
        {/* Body highlight */}
        <rect
          x="30"
          y="138"
          width="100"
          height="12"
          rx="6"
          fill="white"
          opacity="0.03"
        />

        {/* Chest screen */}
        <rect
          x="52"
          y="146"
          width="56"
          height="36"
          rx="8"
          fill="#09090b"
          stroke={bodyStroke}
          strokeWidth="1"
          opacity="0.8"
          style={{ transition: "stroke 0.4s" }}
        />

        {/* Chest content by state */}
        {isSpeaking && (
          /* Waveform */
          <g>
            {[0, 1, 2, 3, 4, 5, 6].map((i) => {
              const bh = bars[i % bars.length] ?? 0.5;
              return (
                <rect
                  key={i}
                  x={62 + i * 6}
                  y={164 - (14 * bh) / 2}
                  width="3"
                  height={Math.max(2, 14 * bh)}
                  rx="1.5"
                  fill="#10b981"
                />
              );
            })}
          </g>
        )}
        {isThinking && (
          /* Spinning gear-like circle */
          <g transform="translate(80, 164)">
            <circle
              cx="0"
              cy="0"
              r="12"
              fill="none"
              stroke="#a78bfa"
              strokeWidth="2"
              strokeDasharray="6 3"
              style={{ animation: "spinGear 1.5s linear infinite" }}
            />
            <circle cx="0" cy="0" r="5" fill="#a78bfa" opacity="0.5" />
            <circle cx="0" cy="0" r="2" fill="#a78bfa" />
          </g>
        )}
        {isListening && (
          /* Three ripple rings */
          <g transform="translate(80, 164)">
            {[6, 10, 14].map((r, i) => (
              <circle
                key={i}
                cx="0"
                cy="0"
                r={r}
                fill="none"
                stroke="#60a5fa"
                strokeWidth="1.5"
                opacity={0.7 - i * 0.2}
                style={{
                  animation: `ripple 1.4s ease-out ${i * 0.3}s infinite`,
                }}
              />
            ))}
            <circle cx="0" cy="0" r="3" fill="#60a5fa" />
          </g>
        )}
        {state === "idle" && (
          /* Idle: indigo pulse dot */
          <g transform="translate(80, 164)">
            <circle
              cx="0"
              cy="0"
              r="10"
              fill="none"
              stroke="#4f46e5"
              strokeWidth="1"
              opacity="0.3"
              style={{ animation: "idlePulse 2.5s ease-in-out infinite" }}
            />
            <circle cx="0" cy="0" r="4" fill="#6366f1" opacity="0.7" />
          </g>
        )}

        {/* ── Arms ──────────────────────────────────────────── */}
        {/* Left arm */}
        <rect
          x="6"
          y="140"
          width="16"
          height="40"
          rx="8"
          fill="#27272a"
          stroke="#3f3f46"
          strokeWidth="1.5"
          style={{
            transformOrigin: "14px 140px",
            transform: isSpeaking
              ? `rotate(${armRotation - 8}deg)`
              : "rotate(0deg)",
            transition: "transform 0.3s",
          }}
        />
        {/* Left hand */}
        <circle
          cx="14"
          cy="183"
          r="7"
          fill="#27272a"
          stroke="#3f3f46"
          strokeWidth="1.5"
        />

        {/* Right arm */}
        <rect
          x="138"
          y="140"
          width="16"
          height="40"
          rx="8"
          fill="#27272a"
          stroke="#3f3f46"
          strokeWidth="1.5"
          style={{
            transformOrigin: "146px 140px",
            transform: isSpeaking
              ? `rotate(${armRotation + 8}deg)`
              : "rotate(0deg)",
            transition: "transform 0.3s",
          }}
        />
        {/* Right hand */}
        <circle
          cx="146"
          cy="183"
          r="7"
          fill="#27272a"
          stroke="#3f3f46"
          strokeWidth="1.5"
        />

        {/* ── Body bolts ────────────────────────────────────── */}
        <circle cx="34" cy="143" r="3" fill="#3f3f46" />
        <circle cx="126" cy="143" r="3" fill="#3f3f46" />
        <circle cx="34" cy="182" r="3" fill="#3f3f46" />
        <circle cx="126" cy="182" r="3" fill="#3f3f46" />

        {/* ── Keyframes via style tag ────────────────────────── */}
        <style>{`
                    @keyframes spinGear {
                        from { transform: rotate(0deg); }
                        to   { transform: rotate(360deg); }
                    }
                    @keyframes ripple {
                        0%   { transform: scale(0.6); opacity: 0.8; }
                        100% { transform: scale(1.8); opacity: 0; }
                    }
                    @keyframes idlePulse {
                        0%, 100% { transform: scale(1);   opacity: 0.3; }
                        50%       { transform: scale(1.5); opacity: 0.1; }
                    }
                    @keyframes scanH {
                        0%   { transform: translateY(-8px); }
                        100% { transform: translateY(8px); }
                    }
                `}</style>
      </svg>
    </div>
  );
}
