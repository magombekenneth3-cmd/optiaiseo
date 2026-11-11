"use client";
import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard, Users, DollarSign, FileText, Cpu,
  Activity, TrendingUp, Menu, X, LogOut,
} from "lucide-react";

const NAV_ITEMS = [
  { href: "/admin/overview", label: "Overview", icon: LayoutDashboard },
  { href: "/admin/users", label: "Users", icon: Users },
  { href: "/admin/revenue", label: "Revenue", icon: DollarSign },
  { href: "/admin/blogs", label: "Blogs", icon: FileText },
  { href: "/admin/platforms", label: "Platforms", icon: Cpu },
  { href: "/admin/usage", label: "Usage", icon: Activity },
  { href: "/admin/growth", label: "Growth", icon: TrendingUp },
];

export function AdminMobileMenu() {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        aria-label="Open navigation menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex">
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <nav className="relative w-64 h-full admin-sidebar border-r border-white/10 flex flex-col overflow-y-auto">
            <div className="h-14 flex items-center justify-between px-4 border-b border-white/10 shrink-0">
              <span className="text-white font-bold text-sm">Navigation</span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10"
                aria-label="Close menu"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="flex-1 py-4 px-3 space-y-1">
              {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
                const active = pathname === href || pathname.startsWith(href + "/");
                return (
                  <Link
                    key={href}
                    href={href}
                    onClick={() => setOpen(false)}
                    className={`admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                      active ? "admin-nav-active" : "admin-nav-inactive"
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    {label}
                  </Link>
                );
              })}
            </div>
            <div className="p-3 border-t border-white/10">
              <Link
                href="/dashboard"
                className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/5 transition-all"
              >
                <LogOut className="w-4 h-4 shrink-0" />
                Back to Dashboard
              </Link>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}

