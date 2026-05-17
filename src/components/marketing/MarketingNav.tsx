"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronDown, Menu, X } from "lucide-react";
import { NavAuthSection } from "./NavAuthSection";

interface DropdownItem {
  href: string;
  label: string;
}

interface NavLink {
  href: string;
  label: string;
  dropdown?: DropdownItem[];
}

const NAV_LINKS: NavLink[] = [
  {
    href: "/features",
    label: "Solutions",
    dropdown: [
      { href: "/for-agencies", label: "For Agencies" },
      { href: "/for-saas", label: "For SaaS Companies" },
      { href: "/for-content", label: "For Content Teams" },
      { href: "/for-ecommerce", label: "For E-commerce" },
      { href: "/aio", label: "AIO / AI SEO" },
    ],
  },
  { href: "/free/seo-checker", label: "Free Tools" },
  { href: "/vs", label: "Compare" },
  { href: "/pricing", label: "Pricing" },
  { href: "/guide", label: "Guides" },
  { href: "/blog", label: "Blog" },
];

function DropdownNavItem({ label, items }: { label: string; items: DropdownItem[] }) {
  const [open, setOpen] = useState(false);

  return (
    <div
      className="relative"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <button
        aria-expanded={open}
        aria-haspopup="true"
        className="flex items-center gap-1 px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground rounded-lg hover:bg-accent transition-colors"
      >
        {label}
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-52 bg-popover border border-border rounded-xl shadow-xl py-1.5 z-50 animate-in fade-in slide-in-from-top-2 duration-150">
          {items.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className="block px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg mx-1 transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

function MobileDropdown({ label, items, onNavigate }: { label: string; items: DropdownItem[]; onNavigate: () => void }) {
  const [open, setOpen] = useState(false);

  return (
    <div>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-foreground hover:bg-accent rounded-lg transition-colors"
      >
        {label}
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="pl-4 pb-1">
          {items.map(item => (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className="block px-4 py-2.5 text-sm text-muted-foreground hover:text-foreground rounded-lg transition-colors"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export function MarketingNav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <nav
      aria-label="Main navigation"
      className="w-full border-b border-border bg-background/95 backdrop-blur-sm sticky top-0 z-50"
    >
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between gap-6">
        <Link href="/" aria-label="OptiAISEO home" className="flex items-center gap-2.5 shrink-0">
          <div className="w-8 h-8 rounded-lg bg-foreground flex items-center justify-center shrink-0">
            <span className="font-black text-background text-[11px] tracking-tight">AI</span>
          </div>
          <span className="font-bold text-sm tracking-tight">OptiAISEO</span>
        </Link>

        <div className="hidden md:flex items-center gap-1 flex-1">
          {NAV_LINKS.map(link =>
            link.dropdown ? (
              <DropdownNavItem key={link.href} label={link.label} items={link.dropdown} />
            ) : (
              <Link
                key={link.href}
                href={link.href}
                aria-current={pathname === link.href ? "page" : undefined}
                className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                  pathname === link.href
                    ? "text-foreground font-semibold bg-accent"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                }`}
              >
                {link.label}
              </Link>
            )
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0">
          <NavAuthSection />
          <Link
            href="/signup"
            className="hidden sm:inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-sm font-semibold text-white transition-all hover:brightness-110"
            style={{ background: "var(--brand)", boxShadow: "0 4px 14px rgba(16,185,129,0.25)" }}
          >
            Start free →
          </Link>
          <button
            onClick={() => setMobileOpen(o => !o)}
            className="md:hidden p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {mobileOpen && (
        <div className="md:hidden border-t border-border bg-background animate-in slide-in-from-top-2 duration-200">
          <div className="max-w-7xl mx-auto px-4 py-3 flex flex-col gap-0.5">
            {NAV_LINKS.map(link =>
              link.dropdown ? (
                <MobileDropdown
                  key={link.href}
                  label={link.label}
                  items={link.dropdown}
                  onNavigate={() => setMobileOpen(false)}
                />
              ) : (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileOpen(false)}
                  className={`px-4 py-3 text-sm rounded-lg transition-colors ${
                    pathname === link.href
                      ? "text-foreground font-semibold bg-accent"
                      : "text-foreground hover:bg-accent"
                  }`}
                >
                  {link.label}
                </Link>
              )
            )}
            <div className="mt-2 pt-3 border-t border-border">
              <Link
                href="/signup"
                onClick={() => setMobileOpen(false)}
                className="flex items-center justify-center px-4 py-3 rounded-xl text-sm font-semibold text-white"
                style={{ background: "var(--brand)" }}
              >
                Start free →
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
