"use client";

/**
 * JobPoller — mounts on pages that kick off long-running Inngest jobs.
 * Polls an API endpoint while status is PENDING/RUNNING.
 * Gap 7.4: Uses exponential backoff (5s → 30s max) and a 60-attempt cap
 * (~5 minutes) to avoid infinite polling against stuck/failed jobs.
 * Fires onComplete with the updated record when the job finishes.
 * Shows a progress bar with estimated duration.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { Loader2, CheckCircle, AlertCircle, Clock } from "lucide-react";

type JobStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "timeout";

const MAX_POLLS    = 60;          // ~5 min at starting 5s interval
const BASE_DELAY   = 5_000;       // 5s initial poll
const BACKOFF_RATE = 1.2;         // grow 20% each cycle
const MAX_DELAY    = 30_000;      // cap at 30s

interface Props {
  /** Absolute path to poll, e.g. /api/audits/abc123/status */
  pollUrl: string;
  /** Estimated job duration in seconds — used for progress bar */
  estimatedSeconds?: number;
  /** Called when status becomes COMPLETED */
  onComplete?: (data: unknown) => void;
  /** Called when status becomes FAILED */
  onError?: (error: string) => void;
  /** Label shown in the progress bar */
  label?: string;
}

export function JobPoller({
  pollUrl,
  estimatedSeconds = 60,
  onComplete,
  onError,
  label = "Processing…",
}: Props) {
  const [status, setStatus]     = useState<JobStatus>("PENDING");
  const [elapsed, setElapsed]   = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const timerRef   = useRef<ReturnType<typeof setInterval>>();
  const timeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const attempts   = useRef(0);
  const startTime  = useRef(Date.now());

  const stopTimers = useCallback(() => {
    clearInterval(timerRef.current);
    clearTimeout(timeoutRef.current);
  }, []);

  const poll = useCallback(async () => {
    if (attempts.current >= MAX_POLLS) {
      stopTimers();
      setStatus("timeout");
      onError?.("Job timed out after 5 minutes. Please retry or check logs.");
      return;
    }

    try {
      const res = await fetch(pollUrl, { credentials: "include" });
      if (!res.ok) {
        // Non-200: schedule next poll with backoff
        scheduleNext();
        return;
      }
      const data = await res.json();
      const s = data.status ?? "RUNNING";

      if (s === "COMPLETED") {
        stopTimers();
        setStatus("COMPLETED");
        onComplete?.(data);
        return;
      } else if (s === "FAILED") {
        stopTimers();
        setStatus("FAILED");
        const msg = data.error ?? "Job failed — please try again.";
        setErrorMsg(msg);
        onError?.(msg);
        return;
      }

      setStatus(s as JobStatus);
    } catch {
      // Network hiccup — keep polling
    }

    scheduleNext();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pollUrl, onComplete, onError, stopTimers]);

  function scheduleNext() {
    attempts.current += 1;
    const delay = Math.min(BASE_DELAY * Math.pow(BACKOFF_RATE, attempts.current), MAX_DELAY);
    timeoutRef.current = setTimeout(poll, delay);
  }

  useEffect(() => {
    startTime.current = Date.now();
    timerRef.current = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startTime.current) / 1000));
    }, 1_000);
    // Start first poll immediately
    poll();
    return () => stopTimers();
  }, [poll, stopTimers]);

  const progress = Math.min((elapsed / estimatedSeconds) * 100, 95);
  const done     = status === "COMPLETED";
  const failed   = status === "FAILED";
  const timedOut = status === "timeout";

  if (done) {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-400">
        <CheckCircle className="w-4 h-4 shrink-0" />
        <span className="font-medium">Done in {elapsed}s</span>
      </div>
    );
  }

  if (failed) {
    return (
      <div className="flex items-center gap-2 text-sm text-red-400">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span className="font-medium">{errorMsg}</span>
      </div>
    );
  }

  if (timedOut) {
    return (
      <div className="flex items-center gap-2 text-sm text-amber-400">
        <Clock className="w-4 h-4 shrink-0" />
        <span className="font-medium">Job timed out. Please retry or check the Inngest dashboard.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 w-full">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Loader2 className="w-3.5 h-3.5 animate-spin text-brand" />
          <span>{label}</span>
        </div>
        <span>{elapsed}s / ~{estimatedSeconds}s</span>
      </div>
      <div className="w-full h-1 rounded-full bg-muted/40 overflow-hidden">
        <div
          className="h-full rounded-full bg-brand transition-all duration-1000 ease-out"
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
