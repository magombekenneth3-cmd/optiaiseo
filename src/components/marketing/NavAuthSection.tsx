"use client";

import Link from "next/link";
import { useSession } from "next-auth/react";

interface Props {
  ctaText?: string;
  ctaHref?: string;
  ctaClassName?: string;
}

function getInitials(name?: string | null, email?: string | null): string {
  if (name) {
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  if (email) return email[0].toUpperCase();
  return "?";
}

export function NavAuthSection({
  ctaText = "Try free →",
  ctaHref = "/signup",
  ctaClassName = "text-sm font-semibold bg-foreground text-background px-4 py-2 rounded-full hover:opacity-90 transition-all",
}: Props) {
  const { data: session, status } = useSession();

  if (status === "loading") {
    return <div className="h-8 w-20 rounded-full bg-muted/40 animate-pulse" />;
  }

  if (status === "authenticated" && session?.user) {
    const initials = getInitials(session.user.name, session.user.email);
    return (
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard"
          className="flex items-center gap-2.5 group"
          aria-label="Go to dashboard"
        >
          <span className="w-8 h-8 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-xs font-bold text-emerald-400 group-hover:bg-emerald-500/30 transition-colors">
            {initials}
          </span>
          <span className="text-sm font-medium text-muted-foreground group-hover:text-foreground transition-colors hidden sm:block">
            Dashboard
          </span>
        </Link>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-3">
      <Link
        href="/login"
        className="text-sm font-medium text-muted-foreground hover:text-foreground transition-colors hidden sm:block"
      >
        Log in
      </Link>
      <Link href={ctaHref} className={ctaClassName}>
        {ctaText}
      </Link>
    </div>
  );
}
