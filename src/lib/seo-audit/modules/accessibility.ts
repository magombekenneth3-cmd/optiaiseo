import { AuditModule, AuditModuleContext, AuditCategoryResult, ChecklistItem } from "../types"
import { parse } from "node-html-parser"
import { fetchHtml } from "../utils/fetch-html"

export const AccessibilityModule: AuditModule = {
    id: "accessibility",
    label: "Accessibility Signals",

    run: async (context: AuditModuleContext): Promise<AuditCategoryResult> => {
        if (!context.html) {
            return {
                id: AccessibilityModule.id,
                label: AccessibilityModule.label,
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

        const langAttr = root.querySelector("html")?.getAttribute("lang") ?? ""
        const validLang = /^[a-z]{2,3}(-[A-Z]{2,4})?$/.test(langAttr)

        items.push({
            id: "a11y-lang",
            label: "Language Attribute",
            status: validLang ? "Pass" : langAttr ? "Warning" : "Fail",
            finding: validLang
                ? `<html lang="${langAttr}"> is correctly set.`
                : langAttr
                    ? `<html lang="${langAttr}"> has an unusual format (expected BCP-47 like "en" or "en-US").`
                    : 'No lang attribute on <html>. Screen readers and Google use this to determine page language.',
            recommendation: !validLang
                ? {
                    text: 'Add lang attribute to <html> tag with BCP-47 language code (e.g., lang="en" or lang="en-US").',
                    priority: langAttr ? "Low" : "High",
                }
                : undefined,
            roiImpact: 50,
            aiVisibilityImpact: 65,
            details: langAttr ? { lang: langAttr, valid: validLang } : undefined,
        })

        const skipLinks = root.querySelectorAll("a[href]").filter((a) => {
            const href = a.getAttribute("href") ?? ""
            const text = a.textContent.toLowerCase()
            return href.startsWith("#") && (text.includes("skip") || text.includes("main") || text.includes("content"))
        })

        items.push({
            id: "a11y-skip-nav",
            label: "Skip Navigation Link",
            status: skipLinks.length > 0 ? "Pass" : "Warning",
            finding:
                skipLinks.length > 0
                    ? `Skip navigation link detected (e.g. "${skipLinks[0].textContent.trim()}").`
                    : "No skip navigation link found. Keyboard users must tab through all header links to reach content.",
            recommendation:
                skipLinks.length === 0
                    ? {
                        text: 'Add a "Skip to main content" link as the first focusable element. Hidden by default, visible on focus.',
                        priority: "Low",
                    }
                    : undefined,
            roiImpact: 20,
            aiVisibilityImpact: 30,
        })

        const buttons = root.querySelectorAll("button")
        const unlabelledButtons = buttons.filter(
            (btn) =>
                !btn.textContent.trim() &&
                !btn.hasAttribute("aria-label") &&
                !btn.hasAttribute("aria-labelledby") &&
                !btn.hasAttribute("title")
        )

        items.push({
            id: "a11y-button-labels",
            label: "Button ARIA Labels",
            status: unlabelledButtons.length === 0 ? "Pass" : "Warning",
            finding:
                unlabelledButtons.length === 0
                    ? "All detected buttons have accessible labels."
                    : `${unlabelledButtons.length} button(s) have no visible text, aria-label, or aria-labelledby — screen reader users get no context.`,
            recommendation:
                unlabelledButtons.length > 0
                    ? {
                        text: "Add aria-label to all icon-only buttons (e.g., hamburger menus, close buttons, search triggers).",
                        priority: "Medium",
                    }
                    : undefined,
            roiImpact: 25,
            aiVisibilityImpact: 35,
            details: { total: buttons.length, unlabelled: unlabelledButtons.length },
        })

        const inputs = root.querySelectorAll(
            'input:not([type="hidden"]):not([type="submit"]):not([type="button"])'
        )
        let unlabelledInputs = 0

        for (const input of Array.from(inputs)) {
            const id = input.getAttribute("id") ?? ""
            const hasAriaLabel = input.hasAttribute("aria-label")
            const hasAriaLabelledby = input.hasAttribute("aria-labelledby")
            const hasLabel = id ? !!root.querySelector(`label[for="${id}"]`) : false

            if (!hasLabel && !hasAriaLabel && !hasAriaLabelledby) {
                unlabelledInputs++
            }
        }

        items.push({
            id: "a11y-form-labels",
            label: "Form Input Labels",
            status: unlabelledInputs === 0 ? "Pass" : "Warning",
            finding:
                inputs.length === 0
                    ? "No form inputs detected on this page."
                    : unlabelledInputs === 0
                        ? `All ${inputs.length} form input(s) have accessible labels.`
                        : `${unlabelledInputs} of ${inputs.length} input(s) lack labels (no <label for>, aria-label, or aria-labelledby). Placeholder text alone is not sufficient.`,
            recommendation:
                unlabelledInputs > 0
                    ? {
                        text: "Associate each <input> with a <label for> or aria-label. Never rely solely on placeholder text.",
                        priority: "Medium",
                    }
                    : undefined,
            roiImpact: 25,
            aiVisibilityImpact: 40,
            details: { totalInputs: inputs.length, unlabelled: unlabelledInputs },
        })

        const allImages = root.querySelectorAll("img")
        const imgsNoAlt = allImages.filter((img) => img.getAttribute("alt") == null)
        const longAltImages = allImages.filter((img) => (img.getAttribute("alt")?.length ?? 0) > 125)

        items.push({
            id: "a11y-image-alt",
            label: "Image Alt Text Quality",
            status:
                imgsNoAlt.length === 0 && longAltImages.length === 0
                    ? "Pass"
                    : imgsNoAlt.length > 0
                        ? "Fail"
                        : "Warning",
            finding: [
                imgsNoAlt.length > 0 ? `${imgsNoAlt.length} image(s) missing alt attribute.` : null,
                longAltImages.length > 0
                    ? `${longAltImages.length} image(s) have alt text >125 chars (keep it concise).`
                    : null,
                imgsNoAlt.length === 0 && longAltImages.length === 0
                    ? `All ${allImages.length} images have appropriate alt text.`
                    : null,
            ]
                .filter(Boolean)
                .join(" "),
            recommendation:
                imgsNoAlt.length > 0 || longAltImages.length > 0
                    ? {
                        text: 'Add descriptive alt text under 125 chars. Decorative images should use alt="".',
                        priority: imgsNoAlt.length > 0 ? "Medium" : "Low",
                    }
                    : undefined,
            roiImpact: 45,
            aiVisibilityImpact: 40,
            details: { total: allImages.length, missingAlt: imgsNoAlt.length, tooLongAlt: longAltImages.length },
        })

        const h1Count = root.querySelectorAll("h1").length

        items.push({
            id: "a11y-heading-structure",
            label: "Page Heading Structure",
            status: h1Count === 1 ? "Pass" : "Warning",
            finding:
                h1Count === 1
                    ? "Exactly one H1 found — correct document structure for both SEO and screen readers."
                    : h1Count === 0
                        ? "No H1 found — screen readers navigate pages by headings and cannot identify the main topic."
                        : `${h1Count} H1s found — only one H1 should exist per page.`,
            recommendation:
                h1Count !== 1
                    ? {
                        text:
                            h1Count === 0
                                ? "Add a single H1 that clearly describes the page topic."
                                : "Consolidate to a single H1. Use H2–H6 for subsections.",
                        priority: "Medium",
                    }
                    : undefined,
            roiImpact: 55,
            aiVisibilityImpact: 60,
            details: { h1Count },
        })

        const hasOutlineNone =
            html.includes("outline:none") ||
            html.includes("outline: none") ||
            html.includes("outline:0") ||
            html.includes("outline: 0")
        const hasFocusVisible = html.includes(":focus-visible") || html.includes(":focus")

        items.push({
            id: "a11y-focus-styles",
            label: "Keyboard Focus Styles",
            status: hasOutlineNone && !hasFocusVisible ? "Warning" : "Pass",
            finding:
                hasOutlineNone && !hasFocusVisible
                    ? "outline:none or outline:0 detected without :focus-visible override. Keyboard users cannot see which element is focused."
                    : "Focus styles appear to be maintained.",
            recommendation:
                hasOutlineNone && !hasFocusVisible
                    ? {
                        text: "Never remove outline globally without a :focus-visible alternative. Add custom focus styles using outline and outline-offset on :focus-visible.",
                        priority: "Low",
                    }
                    : undefined,
            roiImpact: 15,
            aiVisibilityImpact: 20,
        })

        const iframes = root.querySelectorAll("iframe")
        const untitledIframes = iframes.filter((iframe) => !iframe.getAttribute("title"))

        items.push({
            id: "iframe-titles",
            label: "Iframe Titles",
            status: untitledIframes.length === 0 ? "Pass" : "Fail",
            finding:
                iframes.length === 0
                    ? "No iframes found."
                    : untitledIframes.length === 0
                        ? `All ${iframes.length} iframes have a title attribute.`
                        : `${untitledIframes.length} of ${iframes.length} iframes lack a title attribute.`,
            recommendation:
                untitledIframes.length > 0
                    ? {
                        text: 'Add a descriptive title to every <iframe> (e.g., title="YouTube video player").',
                        priority: "Medium",
                    }
                    : undefined,
            roiImpact: 10,
            aiVisibilityImpact: 20,
            details: { totalIframes: iframes.length, missingTitles: untitledIframes.length },
        })

        let positiveTabindexCount = 0
        for (const el of Array.from(root.querySelectorAll("*"))) {
            const tabindex = parseInt(el.getAttribute("tabindex") ?? "", 10)
            if (!isNaN(tabindex) && tabindex > 0) positiveTabindexCount++
        }

        items.push({
            id: "tabindex-abuse",
            label: "Logical Keyboard Flow (Tabindex)",
            status: positiveTabindexCount === 0 ? "Pass" : "Warning",
            finding:
                positiveTabindexCount === 0
                    ? "No elements found with tabindex > 0. Keyboard navigation follows logical DOM order."
                    : `Found ${positiveTabindexCount} element(s) with tabindex > 0. This disrupts logical keyboard navigation.`,
            recommendation:
                positiveTabindexCount > 0
                    ? {
                        text: 'Avoid tabindex values greater than 0. Use tabindex="0" or tabindex="-1" only.',
                        priority: "High",
                    }
                    : undefined,
            roiImpact: 20,
            aiVisibilityImpact: 10,
            details: { positiveTabindexCount },
        })

        const isBodyHidden = root.querySelector("body")?.getAttribute("aria-hidden") === "true"
        const isMainHidden = root.querySelector("main")?.getAttribute("aria-hidden") === "true"

        items.push({
            id: "aria-hidden-body",
            label: "Global ARIA Hidden State",
            status: !isBodyHidden && !isMainHidden ? "Pass" : "Fail",
            finding:
                !isBodyHidden && !isMainHidden
                    ? "Main content areas are accessible to screen readers."
                    : `CRITICAL: Found aria-hidden="true" on ${isBodyHidden ? "<body>" : "<main>"}.`,
            recommendation:
                isBodyHidden || isMainHidden
                    ? {
                        text: "Remove aria-hidden from <body> or <main> immediately. This hides all content from screen readers.",
                        priority: "High",
                    }
                    : undefined,
            roiImpact: 90,
            aiVisibilityImpact: 40,
        })

        const analyzable = items.filter((i) => i.status !== "Skipped" && i.status !== "Info")
        const passed = analyzable.filter((i) => i.status === "Pass").length
        const failed = analyzable.filter((i) => i.status === "Fail").length
        const warnings = analyzable.filter((i) => i.status === "Warning").length
        const score = analyzable.length > 0
            ? Math.round(((passed + warnings * 0.5) / analyzable.length) * 100)
            : 0

        return {
            id: AccessibilityModule.id,
            label: AccessibilityModule.label,
            items,
            score,
            passed,
            failed,
            warnings,
        }
    },
}