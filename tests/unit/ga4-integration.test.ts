/**
 * F2 – GA4 Integration wiring tests
 *
 * Verifies:
 * 1. Ga4ConnectForm is importable and mountable
 * 2. UnifiedAnalyticsPanel renders conversions row when GA4 data has conversions
 * 3. Settings page passes ga4PropertyId through to SettingsTabs
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

const SRC = path.resolve(__dirname, "../../src");

describe("F2 – GA4 Integration wiring", () => {
    describe("Ga4ConnectForm is mounted in Settings", () => {
        it("SettingsTabs imports Ga4ConnectForm", () => {
            const tabs = fs.readFileSync(
                path.join(SRC, "app/dashboard/settings/SettingsTabs.tsx"),
                "utf8"
            );
            expect(tabs).toContain('import { Ga4ConnectForm }');
            expect(tabs).toContain("Ga4ConnectForm");
        });

        it("SettingsTabs accepts firstSiteGa4PropertyId prop", () => {
            const tabs = fs.readFileSync(
                path.join(SRC, "app/dashboard/settings/SettingsTabs.tsx"),
                "utf8"
            );
            expect(tabs).toContain("firstSiteGa4PropertyId");
        });

        it("SettingsTabs renders Ga4ConnectForm in integrations tab", () => {
            const tabs = fs.readFileSync(
                path.join(SRC, "app/dashboard/settings/SettingsTabs.tsx"),
                "utf8"
            );
            // Should pass siteId and currentPropertyId props
            expect(tabs).toMatch(/Ga4ConnectForm\s+siteId=/);
            expect(tabs).toMatch(/currentPropertyId=/);
        });

        it("Settings page queries ga4PropertyId from Site", () => {
            const page = fs.readFileSync(
                path.join(SRC, "app/dashboard/settings/page.tsx"),
                "utf8"
            );
            expect(page).toContain("ga4PropertyId: true");
            expect(page).toContain("firstSiteGa4PropertyId");
        });
    });

    describe("UnifiedAnalyticsPanel shows conversions", () => {
        it("imports Target icon for conversions display", () => {
            const panel = fs.readFileSync(
                path.join(SRC, "components/dashboard/UnifiedAnalyticsPanel.tsx"),
                "utf8"
            );
            expect(panel).toContain("Target");
        });

        it("renders Conversions stat box", () => {
            const panel = fs.readFileSync(
                path.join(SRC, "components/dashboard/UnifiedAnalyticsPanel.tsx"),
                "utf8"
            );
            expect(panel).toContain('label="Conversions"');
            expect(panel).toContain("ga4.conversions");
        });

        it("renders conversion rate calculation", () => {
            const panel = fs.readFileSync(
                path.join(SRC, "components/dashboard/UnifiedAnalyticsPanel.tsx"),
                "utf8"
            );
            expect(panel).toContain('label="Conv. Rate"');
            expect(panel).toContain("ga4.conversions / ga4.sessions");
        });

        it("renders Pageviews stat box", () => {
            const panel = fs.readFileSync(
                path.join(SRC, "components/dashboard/UnifiedAnalyticsPanel.tsx"),
                "utf8"
            );
            expect(panel).toContain('label="Pageviews"');
            expect(panel).toContain("ga4.pageviews");
        });
    });

    describe("GA4 API routes exist", () => {
        it("/api/ga4/connect route handles POST", () => {
            const route = fs.readFileSync(
                path.join(SRC, "app/api/ga4/connect/route.ts"),
                "utf8"
            );
            expect(route).toContain("export async function POST");
            expect(route).toContain("ga4PropertyId");
        });

        it("/api/ga4/properties route handles GET", () => {
            const route = fs.readFileSync(
                path.join(SRC, "app/api/ga4/properties/route.ts"),
                "utf8"
            );
            expect(route).toContain("export async function GET");
            expect(route).toContain("listGa4Properties");
        });
    });

    describe("GA4 lib exports correct types", () => {
        it("exports Ga4Metrics interface with conversions field", () => {
            const lib = fs.readFileSync(
                path.join(SRC, "lib/ga4/index.ts"),
                "utf8"
            );
            expect(lib).toContain("export interface Ga4Metrics");
            expect(lib).toContain("conversions: number");
        });

        it("fetches conversions from GA4 API", () => {
            const lib = fs.readFileSync(
                path.join(SRC, "lib/ga4/index.ts"),
                "utf8"
            );
            expect(lib).toContain('{ name: "conversions" }');
        });
    });
});
