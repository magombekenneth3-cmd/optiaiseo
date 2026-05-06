import { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem } from "../types"
import { fetchHtml } from "../utils/fetch-html"
import { parse } from "node-html-parser"

async function fetchGtmContainerGA4Ids(gtmId: string): Promise<string[]> {
    try {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 8000)
        const res = await fetch(`https://www.googletagmanager.com/gtm.js?id=${gtmId}`, {
            signal: controller.signal,
        })
        clearTimeout(timeout)
        if (!res.ok) return []
        const text = await res.text()
        const matches = text.match(/G-[A-Z0-9]{4,12}/g)
        return matches ? [...new Set(matches)] : []
    } catch {
        return []
    }
}

const TRACKING_CHECKS: Array<{
    id: string
    label: string
    signals: string[]
    roiImpact: number
    aiVisibilityImpact: number
}> = [
        {
            id: "meta-pixel",
            label: "Meta (Facebook) Pixel",
            signals: ["connect.facebook.net/en_US/fbevents.js", "fbq("],
            roiImpact: 35,
            aiVisibilityImpact: 15,
        },
        {
            id: "tiktok-pixel",
            label: "TikTok Pixel",
            signals: ["analytics.tiktok.com", "ttq.", "TiktokAnalyticsObject"],
            roiImpact: 25,
            aiVisibilityImpact: 10,
        },
        {
            id: "linkedin-insight",
            label: "LinkedIn Insight Tag",
            signals: ["snap.licdn.com", "linkedin.com/li/track", "_linkedin_data_partner_id"],
            roiImpact: 25,
            aiVisibilityImpact: 10,
        },
        {
            id: "hotjar",
            label: "Hotjar",
            signals: ["static.hotjar.com", "hjid:", "hj("],
            roiImpact: 20,
            aiVisibilityImpact: 5,
        },
        {
            id: "ms-clarity",
            label: "Microsoft Clarity",
            signals: ["clarity.ms/tag", "clarity(", "clr.microsoft.com"],
            roiImpact: 20,
            aiVisibilityImpact: 5,
        },
        {
            id: "intercom",
            label: "Intercom",
            signals: ["widget.intercom.io", "Intercom("],
            roiImpact: 15,
            aiVisibilityImpact: 5,
        },
    ]

function joinIds(ids: string[]): string {
    return ids.join(", ")
}

export const BasicsAnalyticsModule: AuditModule = {
    id: "basics-analytics",
    label: "SEO Basics & Analytics Setup",

    run: async (context: AuditModuleContext): Promise<AuditCategoryResult> => {
        if (!context.html) {
            return {
                id: BasicsAnalyticsModule.id,
                label: BasicsAnalyticsModule.label,
                items: [],
                score: 0,
                passed: 0,
                failed: 1,
                warnings: 0,
            }
        }

        const html = context.html
        const root = parse(html)
        const items: ChecklistItem[] = []

        const allScripts = root.querySelectorAll("script")
        const allSrc = allScripts.map((s) => s.getAttribute("src") ?? "")
        const inlineScriptText = allScripts.map((s) => s.textContent ?? "").join("\n")
        const headHtml = root.querySelector("head")?.toString() ?? ""
        const bodyHtml = root.querySelector("body")?.toString() ?? ""
        const headElement = root.querySelector("head")

        const uniqueGtmIds = [...new Set([...html.matchAll(/GTM-[A-Z0-9]{4,10}/g)].map((m) => m[0]))]
        const hasGtm = uniqueGtmIds.length > 0

        const gtmScriptCount =
            allSrc.filter((s) => s.includes("googletagmanager.com/gtm.js")).length +
            root.querySelectorAll('link[rel="preload"][href*="googletagmanager.com/gtm.js"]').length

        const gtmLoadedMultipleTimes = uniqueGtmIds.length > 1 || gtmScriptCount > 1
        const gtmInHead =
            headHtml.includes("googletagmanager.com/gtm.js") ||
            headHtml.includes("GTM-") ||
            root.querySelectorAll('link[rel="preload"][href*="gtm.js"]').length > 0
        const hasGtmNoscript = bodyHtml.includes("googletagmanager.com/ns.html")
        const dataLayerBeforeGtm =
            inlineScriptText.includes("dataLayer") &&
            inlineScriptText.indexOf("dataLayer") < inlineScriptText.indexOf("googletagmanager.com/gtm.js")

        if (gtmLoadedMultipleTimes) {
            items.push({
                id: "gtm-duplicate",
                label: "Google Tag Manager — Duplicate Load (CRITICAL)",
                status: "Fail",
                finding: `GTM is loaded ${uniqueGtmIds.length > 1 ? `with ${uniqueGtmIds.length} different container IDs` : "multiple times"}. Every tag fires twice, corrupting analytics data. IDs found: ${joinIds(uniqueGtmIds)}.`,
                recommendation: {
                    text: "Remove the duplicate GTM snippet. Only one GTM container should be present per page.",
                    priority: "High",
                },
                roiImpact: 100,
                aiVisibilityImpact: 90,
                details: { gtmIds: joinIds(uniqueGtmIds), loadCount: uniqueGtmIds.length },
            })
        } else if (hasGtm) {
            const gtmWarnings: string[] = []
            if (!gtmInHead) gtmWarnings.push("GTM script is not in <head>")
            if (!hasGtmNoscript) gtmWarnings.push("noscript <iframe> fallback missing from <body>")
            if (!dataLayerBeforeGtm) gtmWarnings.push("dataLayer is not initialised before GTM loads")

            items.push({
                id: "gtm-setup",
                label: "Google Tag Manager",
                status: gtmWarnings.length > 0 ? "Warning" : "Pass",
                finding:
                    gtmWarnings.length > 0
                        ? `GTM detected (${uniqueGtmIds[0]}) but has configuration issues: ${gtmWarnings.join("; ")}.`
                        : `GTM detected (${uniqueGtmIds[0]}), loaded in <head> ✓, noscript fallback present ✓, dataLayer initialised first ✓.`,
                recommendation:
                    gtmWarnings.length > 0
                        ? {
                            text: gtmWarnings
                                .map((w) => {
                                    if (w.includes("not in <head>")) return "Move the GTM <script> snippet to the very top of <head>."
                                    if (w.includes("noscript")) return "Add the GTM <noscript> <iframe> immediately after the opening <body> tag."
                                    if (w.includes("dataLayer")) return "Initialise window.dataLayer = window.dataLayer || [] before the GTM snippet."
                                    return w
                                })
                                .join(" "),
                            priority: "Medium",
                        }
                        : undefined,
                roiImpact: 90,
                aiVisibilityImpact: 70,
                details: {
                    gtmId: uniqueGtmIds[0],
                    inHead: gtmInHead,
                    noscriptFallback: hasGtmNoscript,
                    dataLayerFirst: dataLayerBeforeGtm,
                },
            })
        } else {
            items.push({
                id: "gtm-setup",
                label: "Google Tag Manager",
                status: "Warning",
                finding: "Google Tag Manager not detected.",
                recommendation: {
                    text: "Consider adding GTM to manage analytics and marketing tags without requiring code deployments.",
                    priority: "Low",
                },
                roiImpact: 90,
                aiVisibilityImpact: 70,
            })
        }

        const uniqueGa4Ids = [...new Set([...html.matchAll(/G-[A-Z0-9]{4,12}/g)].map((m) => m[0]))]
        const uniqueUaIds = [...new Set([...html.matchAll(/UA-\d{4,12}-\d{1,4}/g)].map((m) => m[0]))]

        const hasGa4Direct =
            allSrc.some((s) => s.includes("googletagmanager.com/gtag/js")) ||
            inlineScriptText.includes("gtag('config'") ||
            inlineScriptText.includes('gtag("config"') ||
            root.querySelectorAll('link[rel="preload"][href*="gtag/js"]').length > 0

        const gtmContainerGA4Map: Record<string, string[]> = {}
        if (hasGtm) {
            await Promise.all(
                uniqueGtmIds.map(async (gtmId) => {
                    gtmContainerGA4Map[gtmId] = await fetchGtmContainerGA4Ids(gtmId)
                })
            )
        }

        const allGtmGA4Ids = [...new Set(Object.values(gtmContainerGA4Map).flat())]
        const hasGa4ViaGtm = allGtmGA4Ids.length > 0
        const doubleFireIds = uniqueGa4Ids.filter((id) => allGtmGA4Ids.includes(id))
        const isDoubleTracking = hasGa4Direct && doubleFireIds.length > 0
        const noAnalytics = !hasGa4Direct && !hasGa4ViaGtm && !hasGtm && uniqueUaIds.length === 0
        const gtmWithoutGA4 = hasGtm && !hasGa4ViaGtm && !hasGa4Direct

        if (uniqueUaIds.length > 0) {
            items.push({
                id: "google-analytics-ua",
                label: "Google Analytics — Legacy UA (Deprecated)",
                status: "Fail",
                finding: `Universal Analytics ID detected: ${joinIds(uniqueUaIds)}. UA was sunset July 2023 and no longer processes data.`,
                recommendation: {
                    text: "Migrate to GA4 immediately. Create a GA4 property at analytics.google.com and configure it via GTM or the gtag.js snippet.",
                    priority: "High",
                },
                roiImpact: 100,
                aiVisibilityImpact: 80,
                details: { uaIds: joinIds(uniqueUaIds) },
            })
        }

        if (isDoubleTracking) {
            items.push({
                id: "google-analytics-double",
                label: "Google Analytics — Double Tracking (CRITICAL)",
                status: "Fail",
                finding: `GA4 (${joinIds(doubleFireIds)}) is fired both directly via gtag.js AND via GTM (${joinIds(uniqueGtmIds)}). Every pageview and event is counted twice.`,
                recommendation: {
                    text: "Remove the direct gtag.js snippet from your HTML. Load GA4 exclusively through the GTM GA4 Configuration tag.",
                    priority: "High",
                },
                roiImpact: 100,
                aiVisibilityImpact: 85,
                details: { ga4Ids: joinIds(doubleFireIds), gtmIds: joinIds(uniqueGtmIds) },
            })
        } else if (noAnalytics) {
            items.push({
                id: "google-analytics-ga4",
                label: "Google Analytics 4",
                status: "Fail",
                finding: "No analytics detected. No GA4 snippet, no GTM, and no UA tracking code found.",
                recommendation: {
                    text: "Install GTM and configure a GA4 Configuration tag, or add the gtag.js snippet directly to <head>.",
                    priority: "High",
                },
                roiImpact: 100,
                aiVisibilityImpact: 85,
            })
        } else if (gtmWithoutGA4) {
            items.push({
                id: "google-analytics-ga4",
                label: "Google Analytics 4",
                status: "Fail",
                finding: `GTM (${joinIds(uniqueGtmIds)}) is installed but no GA4 tag is configured inside the container.`,
                recommendation: {
                    text: "In GTM, go to Tags → New → GA4 Configuration, enter your G-XXXXXXXXXX measurement ID, set trigger to All Pages, and publish.",
                    priority: "High",
                },
                roiImpact: 100,
                aiVisibilityImpact: 85,
                details: { gtmIds: joinIds(uniqueGtmIds) },
            })
        } else if (hasGa4ViaGtm && !hasGa4Direct) {
            items.push({
                id: "google-analytics-ga4",
                label: "Google Analytics 4",
                status: "Pass",
                finding: `GA4 (${joinIds(allGtmGA4Ids)}) confirmed inside GTM container (${joinIds(uniqueGtmIds)}). Correct setup — single tracking source via GTM.`,
                roiImpact: 90,
                aiVisibilityImpact: 80,
                details: { ga4Ids: joinIds(allGtmGA4Ids), loadMethod: "gtm", gtmIds: joinIds(uniqueGtmIds) },
            })
        } else if (hasGa4Direct && !hasGa4ViaGtm) {
            items.push({
                id: "google-analytics-ga4",
                label: "Google Analytics 4",
                status: "Pass",
                finding: hasGtm
                    ? `GA4 (${joinIds(uniqueGa4Ids)}) detected via direct gtag.js. GTM (${joinIds(uniqueGtmIds)}) is present but contains no GA4 tag — no double firing.`
                    : `GA4 (${joinIds(uniqueGa4Ids)}) detected via direct gtag.js snippet. No GTM present — single tracking source.`,
                roiImpact: 90,
                aiVisibilityImpact: 80,
                details: {
                    ga4Ids: joinIds(uniqueGa4Ids),
                    loadMethod: "direct",
                    ...(hasGtm && { gtmIds: joinIds(uniqueGtmIds), gtmHasGA4: false }),
                },
            })
        } else if (uniqueUaIds.length > 0 && !hasGa4Direct && !hasGa4ViaGtm) {
            items.push({
                id: "google-analytics-ga4",
                label: "Google Analytics 4",
                status: "Fail",
                finding: "Only a legacy UA ID was found. No GA4 tracking is active.",
                recommendation: {
                    text: "Create a GA4 property and install the G-XXXXXXXXXX measurement ID via GTM or the gtag.js snippet.",
                    priority: "High",
                },
                roiImpact: 90,
                aiVisibilityImpact: 80,
                details: { uaIds: joinIds(uniqueUaIds) },
            })
        }

        const hasGscMeta = html.includes("google-site-verification")
        items.push({
            id: "gsc-verification",
            label: "Google Search Console",
            status: hasGscMeta ? "Pass" : "Info",
            finding: hasGscMeta
                ? "GSC verification meta tag detected."
                : "GSC verification meta tag not found. If verified via DNS TXT record or HTML file upload, your site may still be verified.",
            recommendation: hasGscMeta
                ? undefined
                : {
                    text: "Verify your site in Google Search Console to unlock crawl reports, index coverage, and search performance data.",
                    priority: "Medium",
                },
            roiImpact: 100,
            aiVisibilityImpact: 100,
        })

        for (const tc of TRACKING_CHECKS) {
            const found = tc.signals.some((sig) => html.includes(sig))
            items.push({
                id: tc.id,
                label: tc.label,
                status: found ? "Pass" : "Info",
                finding: found ? `${tc.label} detected.` : `${tc.label} not detected (optional).`,
                recommendation: found
                    ? undefined
                    : {
                        text: `Consider installing ${tc.label} for additional behaviour analytics and retargeting, if applicable to your marketing setup.`,
                        priority: "Low",
                    },
                roiImpact: tc.roiImpact,
                aiVisibilityImpact: tc.aiVisibilityImpact,
            })
        }

        const blockingTrackers = (headElement?.querySelectorAll("script[src]") ?? []).filter((s) => {
            const src = s.getAttribute("src") ?? ""
            return (
                !s.hasAttribute("async") &&
                !s.hasAttribute("defer") &&
                ["googletagmanager", "google-analytics", "facebook.net", "tiktok", "hotjar", "clarity"].some((t) =>
                    src.includes(t)
                )
            )
        })

        items.push({
            id: "tracking-render-blocking",
            label: "Tracking Scripts — Render Blocking",
            status: blockingTrackers.length === 0 ? "Pass" : "Warning",
            finding:
                blockingTrackers.length === 0
                    ? "All detected tracking scripts in <head> use async or defer."
                    : `${blockingTrackers.length} tracking script(s) in <head> are missing async or defer, delaying First Contentful Paint.`,
            recommendation:
                blockingTrackers.length > 0
                    ? {
                        text: "Add the async or defer attribute to all third-party tracking scripts loaded in <head>.",
                        priority: "Medium",
                    }
                    : undefined,
            roiImpact: 70,
            aiVisibilityImpact: 40,
            details:
                blockingTrackers.length > 0
                    ? { blockingScripts: blockingTrackers.map((s) => s.getAttribute("src") ?? "").join(", ") }
                    : undefined,
        })

        const analyzable = items.filter((i) => i.status !== "Skipped" && i.status !== "Info")
        const passed = analyzable.filter((i) => i.status === "Pass").length
        const failed = analyzable.filter((i) => i.status === "Fail").length
        const warnings = analyzable.filter((i) => i.status === "Warning").length
        const score = analyzable.length > 0
            ? Math.round(((passed + warnings * 0.5) / analyzable.length) * 100)
            : 0

        return {
            id: BasicsAnalyticsModule.id,
            label: BasicsAnalyticsModule.label,
            items,
            score,
            passed,
            failed,
            warnings,
        }
    },
}