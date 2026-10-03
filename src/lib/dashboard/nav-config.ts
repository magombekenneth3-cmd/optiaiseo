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

// ─── 4-Hub Navigation Architecture ────────────────────────────────────────────
// Single source of truth for SidebarNav, MobileBottomNav, and SiteContextBar.

/** Hub 1: Overview & Command Center */
export const OVERVIEW_ITEMS: NavItem[] = [
  { name: "Overview", href: "/dashboard", icon: LayoutDashboard, context: false },
  { name: "Opportunities", href: "/dashboard/recommendations", icon: Lightbulb, context: false },
];

/** Hub 2: Intelligence & Audits */
export const INTELLIGENCE_ITEMS: NavItem[] = [
  { name: "AI Search", href: "/dashboard/aeo", icon: MonitorSmartphone, context: true },
  { name: "SEO Audits", href: "/dashboard/audits", icon: ClipboardList, context: true },
  { name: "Rankings", href: "/dashboard/keywords", icon: TrendingUp, context: true },
  { name: "SERP Gaps", href: "/dashboard/serp-gap", icon: BarChart3, context: true },
  { name: "Competitors", href: "/dashboard/competitors", icon: Crosshair, context: true },
  { name: "Backlinks", href: "/dashboard/backlinks", icon: Link2, context: true },
];

/** Hub 3: Content Studio */
export const CONTENT_STUDIO_ITEMS: NavItem[] = [
  { name: "Articles", href: "/dashboard/blogs", icon: FileText, context: false },
  { name: "Content Editor", href: "/dashboard/editor", icon: Highlighter, context: false },
  { name: "Content Planner", href: "/dashboard/planner", icon: Calendar, context: true },
  { name: "Content Health", href: "/dashboard/content-decay", icon: TrendingDown, context: true },
  { name: "Programmatic SEO", href: "/dashboard/pseo", icon: Zap, context: false },
];

/** Hub 4: Autopilot & Operations */
export const AUTOPILOT_ITEMS: NavItem[] = [
  { name: "Autopilot", href: "/dashboard/autopilot", icon: Bot, context: true },
  { name: "Auto Indexer", href: "/dashboard/indexing", icon: Zap, context: false },
  { name: "Auto-Heal Log", href: "/dashboard/healing", icon: Shield, context: true },
  { name: "Operations", href: "/dashboard/operations", icon: Activity, context: true },
  { name: "Campaigns", href: "/dashboard/campaign", icon: Target, context: true },
];

/** Secondary utilities & experimental tools */
export const MORE_ITEMS: NavItem[] = [
  { name: "AEO Proofs", href: "/dashboard/aeo/proofs", icon: History, context: true },
  { name: "Content Refresh", href: "/dashboard/refresh", icon: TrendingDown, context: true },
  { name: "Experiments", href: "/dashboard/experiments", icon: FlaskConical, context: true },
  { name: "Talk to Aria", href: "/dashboard/voice", icon: Mic, context: false },
];

/** Workspace configuration items */
export const WORKSPACE_ITEMS: NavItem[] = [
  { name: "My Sites", href: "/dashboard/sites", icon: Globe, context: false },
  { name: "Team", href: "/dashboard/team", icon: Users, context: false },
];

// Legacy backward-compatibility aliases
export const MISSION_CONTROL_ITEMS = OVERVIEW_ITEMS;
export const IMPROVE_ITEMS: NavItem[] = INTELLIGENCE_ITEMS;
export const MONITOR_ITEMS = CONTENT_STUDIO_ITEMS;
export const AUTOMATE_ITEMS = AUTOPILOT_ITEMS;

export const ALL_NAV_ITEMS: NavItem[] = [
  ...OVERVIEW_ITEMS,
  ...INTELLIGENCE_ITEMS,
  ...CONTENT_STUDIO_ITEMS,
  ...AUTOPILOT_ITEMS,
  ...MORE_ITEMS,
  ...WORKSPACE_ITEMS,
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
