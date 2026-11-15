"use client";
import { useState, useTransition } from "react";
import { Loader2, Check, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type State = "idle" | "loading" | "success" | "error";

interface ActionButtonProps {
  onClick: () => Promise<{ success: boolean; error?: string }>;
  children: React.ReactNode;
  className?: string;
  successLabel?: string;
  loadingLabel?: string;
  variant?: "primary" | "secondary" | "ghost";
}

export function ActionButton({
  onClick,
  children,
  className,
  successLabel = "Done",
  loadingLabel = "Working...",
  variant = "secondary",
}: ActionButtonProps) {
  const [state, setState] = useState<State>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isBusy = state === "loading" || isPending;

  const handleClick = () => {
    if (isBusy) return;
    setErrorMessage(null);
    setState("loading");
    startTransition(async () => {
      try {
        const result = await onClick();
        if (result.success) {
          setState("success");
          setTimeout(() => setState("idle"), 2500);
        } else {
          setState("error");
          setErrorMessage(result.error ?? "Action failed. Try again.");
          setTimeout(() => setState("idle"), 4000);
        }
      } catch (err) {
        setState("error");
        setErrorMessage(err instanceof Error ? err.message : "Action failed. Try again.");
        setTimeout(() => setState("idle"), 4000);
      }
    });
  };

  const base =
    "inline-flex items-center gap-2 min-h-9 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 active:scale-[0.97] aria-disabled:opacity-60 aria-disabled:cursor-not-allowed cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground";

  const variants: Record<string, string> = {
    primary: "bg-foreground text-background hover:opacity-90",
    secondary: "border border-border bg-background hover:bg-muted",
    ghost: "hover:bg-muted",
  };

  const stateStyles: Record<State, string> = {
    idle: "",
    loading: "opacity-80 cursor-wait",
    success: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
    error: "border-red-500/40 bg-red-500/10 text-red-500",
  };

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={handleClick}
        aria-disabled={isBusy}
        aria-busy={isBusy}
        className={cn(base, variants[variant], stateStyles[state], className)}
      >
        {state === "loading" && <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />}
        {state === "success" && <Check className="w-3.5 h-3.5" aria-hidden="true" />}
        {state === "error" && <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />}
        {state === "loading"
          ? loadingLabel
          : state === "success"
          ? successLabel
          : state === "error"
          ? "Try again"
          : children}
      </button>
      {errorMessage && (
        <p role="alert" className="text-xs text-red-500">
          {errorMessage}
        </p>
      )}
    </div>
  );
}
