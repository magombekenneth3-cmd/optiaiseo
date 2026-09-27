import {
  LayoutDashboard, Globe, Lightbulb, TrendingUp, TrendingDown,
  MonitorSmartphone, ClipboardList, FileText, Mic, Calendar, Zap, Shield,
  Users, Link2, BarChart3, History, Target, FlaskConical, Activity,
  Bot, Highlighter, Crosshair,
} from "lucide-react";

export interface NavItem {
  name: string;
  href: string;
  icon: React.ElementType;
  /** True when the page actually filters its data by the resolved siteId. */
  context: boolean;
}

// ─── Task-oriented navigation groups ──────────────────────────────────────────
// Single source of truth for both SidebarNav and SiteContextBar so the two
// surfaces never disagree about which routes are site-scoped.

export const MISSION_CONTROL_ITEMS: NavItem[] = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard, context: false },
  { name: "Opportunities", href: "/dashboard/recommendations", icon: Lightbulb, context: false },
];

export const IMPROVE_ITEMS: NavItem[] = [
  { name: "Content", href: "/dashboard/blogs", icon: FileText, context: false },
  { name: "SEO Audits", href: "/dashboard/audits", icon: ClipboardList, context: true },
  { name: "AI Search", href: "/dashboard/aeo", icon: MonitorSmartphone, context: true },
];

// "Site Health" -> content-decay (traffic/content-health signal) and
// "Operations" -> /dashboard/operations both live where their actual
// backend destinations match the label. Operations is NOT duplicated here
// AND under Automate — it lives only in Automate (see below).
export const MONITOR_ITEMS: NavItem[] = [
  { name: "Rankings", href: "/dashboard/keywords", icon: TrendingUp, context: true },
  { name: "Content Health", href: "/dashboard/content-decay", icon: TrendingDown, context: true },
];

export const AUTOMATE_ITEMS: NavItem[] = [
  { name: "Autopilot", href: "/dashboard/autopilot", icon: Bot, context: true },
  { name: "Operations", href: "/dashboard/operations", icon: Activity, context: true },
];

export const MORE_ITEMS: NavItem[] = [
  { name: "My Sites", href: "/dashboard/sites", icon: Globe, context: false },
  { name: "Content Planner", href: "/dashboard/planner", icon: Calendar, context: true },
  { name: "Content Editor", href: "/dashboard/editor", icon: Highlighter, context: false },
  { name: "Competitors", href: "/dashboard/competitors", icon: Crosshair, context: true },
  { name: "SERP Gap", href: "/dashboard/serp-gap", icon: BarChart3, context: true },
  { name: "Backlinks", href: "/dashboard/backlinks", icon: Link2, context: true },
  { name: "AEO Proofs", href: "/dashboard/aeo/proofs", icon: History, context: true },
  { name: "Auto Indexer", href: "/dashboard/indexing", icon: Zap, context: false },
  { name: "Auto-Heal Log", href: "/dashboard/healing", icon: Shield, context: true },
  { name: "Experiments", href: "/dashboard/experiments", icon: FlaskConical, context: true },
  { name: "Campaigns", href: "/dashboard/campaign", icon: Target, context: true },
  { name: "Programmatic SEO", href: "/dashboard/pseo", icon: Zap, context: false },
  { name: "Talk to Aria", href: "/dashboard/voice", icon: Mic, context: false },
  { name: "Content Refresh", href: "/dashboard/refresh", icon: TrendingDown, context: true },
  { name: "Team", href: "/dashboard/team", icon: Users, context: false },
];

export const ALL_NAV_ITEMS: NavItem[] = [
  ...MISSION_CONTROL_ITEMS,
  ...IMPROVE_ITEMS,
  ...MONITOR_ITEMS,
  ...AUTOMATE_ITEMS,
  ...MORE_ITEMS,
];

/** Routes whose pages actually filter their data by the resolved siteId. */
export const SITE_SCOPED_ROUTES: string[] = ALL_NAV_ITEMS.filter((item) => item.context).map(
  (item) => item.href
);

/** Routes with no meaningful site concept at all — never show site context UI. */
export const GLOBAL_ROUTES = [
  "/dashboard/sites",
  "/dashboard/billing",
  "/dashboard/settings",
  "/dashboard/referral",
  "/dashboard/team",
  "/api-docs",
];

export function extractSiteId(pathname: string): string | null {
  const match = pathname.match(/\/dashboard\/sites\/([^/]+)/);
  const id = match?.[1];
  return id && id !== "new" ? id : null;
}

export function isRouteInList(pathname: string, routes: string[]): boolean {
  return routes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}
