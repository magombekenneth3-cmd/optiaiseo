/**
 * Canonical URL and Hostname helpers for OptiAISEO.
 * 
 * Production canonical hostname: https://optiaiseo.online
 * Prevents localhost, preview, or www hostname leakage into canonical tags,
 * structured data, and Open Graph metadata.
 */

export const CANONICAL_SITE_URL = "https://optiaiseo.online";

/**
 * Returns a canonical URL for a given path.
 * The root path "/" returns "https://optiaiseo.online/".
 * Subpaths return "https://optiaiseo.online/path" without trailing slashes.
 */
export function getCanonicalUrl(path: string = "/"): string {
  if (!path || path === "/") {
    return `${CANONICAL_SITE_URL}/`;
  }
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${CANONICAL_SITE_URL}${cleanPath.replace(/\/$/, "")}`;
}
