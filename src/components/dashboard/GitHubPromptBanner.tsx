"use client";

import { useState, useEffect } from "react";
import { Github, X, GitPullRequest } from "lucide-react";
import Link from "next/link";

interface Props {
  siteId: string;
  githubConnected: boolean;
}

/**
 * Contextual banner prompting users to connect a GitHub repo
 * for auto-fix PR functionality. Dismissible with localStorage persistence.
 */
export function GitHubPromptBanner({ siteId, githubConnected }: Props) {
  const storageKey = `github-prompt-dismissed-${siteId}`;
  const [dismissed, setDismissed] = useState(true); // default hidden to avoid flash

  useEffect(() => {
    setDismissed(localStorage.getItem(storageKey) === "true");
  }, [storageKey]);

  if (githubConnected || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(storageKey, "true");
    setDismissed(true);
  };

  return (
    <div className="relative flex items-start gap-4 p-4 rounded-xl border border-purple-500/20 bg-purple-500/5 fade-in-up">
      <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center shrink-0">
        <Github className="w-5 h-5 text-purple-400" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="text-sm font-semibold text-foreground mb-1 flex items-center gap-2">
          <GitPullRequest className="w-3.5 h-3.5 text-purple-400" />
          Enable Auto-Fix Pull Requests
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed max-w-lg">
          Connect a GitHub repository to automatically generate pull requests for SEO
          fixes — meta tags, structured data, heading hierarchy, and more. Fixes go
          through code review, never straight to production.
        </p>
        <Link
          href={`/dashboard/sites/${siteId}/settings#github`}
          className="inline-flex items-center gap-1.5 mt-3 px-3.5 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold transition-colors"
        >
          <Github className="w-3.5 h-3.5" />
          Connect GitHub
        </Link>
      </div>
      <button
        onClick={handleDismiss}
        className="absolute top-3 right-3 p-1 rounded-md hover:bg-white/5 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Dismiss"
      >
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}
