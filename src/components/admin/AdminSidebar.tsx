"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  DollarSign,
  FileText,
  Cpu,
  Activity,
  TrendingUp,
  Shield,
  LogOut,
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

export function AdminSidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-60 hidden md:flex flex-col sticky top-0 h-screen admin-sidebar border-r border-white/10 shrink-0">
      {/* Logo */}
      <div className="h-16 flex items-center px-5 border-b border-white/10 shrink-0">
        <Link href="/admin/overview" className="flex items-center gap-2.5 group">
          <div className="w-8 h-8 rounded-lg admin-logo-badge flex items-center justify-center shrink-0 shadow-lg">
            <Shield className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col leading-none">
            <span className="font-bold text-sm tracking-tight text-white">
              Admin Panel
            </span>
            <span className="text-[9px] font-semibold tracking-widest uppercase admin-badge-text">
              OptiAISEO
            </span>
          </div>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || pathname.startsWith(href + "/");
          return (
            <Link
              key={href}
              href={href}
              className={`admin-nav-item flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 ${
                active ? "admin-nav-active" : "admin-nav-inactive"
              }`}
            >
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-white/10">
        <Link
          href="/dashboard"
          className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:text-white/80 hover:bg-white/5 transition-all duration-200"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          Back to Dashboard
        </Link>
      </div>
    </aside>
  );
}
