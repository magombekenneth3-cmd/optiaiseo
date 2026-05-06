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
  const [isPending, startTransition] = useTransition();

  const handleClick = () => {
    if (state === "loading" || isPending) return;
    setState("loading");
    startTransition(async () => {
      try {
        const result = await onClick();
        setState(result.success ? "success" : "error");
        setTimeout(() => setState("idle"), 2500);
      } catch {
        setState("error");
        setTimeout(() => setState("idle"), 2500);
      }
    });
  };

  const base =
    "inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all duration-150 active:scale-[0.97] disabled:opacity-50 cursor-pointer";

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
    <button
      onClick={handleClick}
      disabled={state === "loading" || isPending}
      className={cn(base, variants[variant], stateStyles[state], className)}
    >
      {state === "loading" && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
      {state === "success" && <Check className="w-3.5 h-3.5" />}
      {state === "error" && <AlertCircle className="w-3.5 h-3.5" />}
      {state === "loading"
        ? loadingLabel
        : state === "success"
        ? successLabel
        : state === "error"
        ? "Try again"
        : children}
    </button>
  );
}
