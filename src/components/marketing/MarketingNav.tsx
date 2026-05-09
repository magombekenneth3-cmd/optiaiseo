"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavAuthSection } from "./NavAuthSection";

interface MarketingNavProps {
  theme?: "light" | "dark";
}

const NAV_LINKS = [
  { href: "/pricing", label: "Pricing" },
  { href: "/guide", label: "Guides" },
  { href: "/blog", label: "Blog" },
];

export function MarketingNav({ theme = "dark" }: MarketingNavProps) {
  const pathname = usePathname();
  void theme;

  return (
    <nav
      aria-label="Main navigation"
      className="w-full border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50"
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link href="/" aria-label="OptiAISEO home" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shrink-0">
            <span className="font-black text-background text-[11px] tracking-tight">AI</span>
          </div>
          <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
        </Link>

        <div className="hidden sm:flex items-center gap-1">
          {NAV_LINKS.map(({ href, label }) => (
            <Link
              key={href}
              href={href}
              aria-current={pathname === href ? "page" : undefined}
              className="px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors"
            >
              {label}
            </Link>
          ))}
        </div>

        <NavAuthSection />
      </div>
    </nav>
  );
}
