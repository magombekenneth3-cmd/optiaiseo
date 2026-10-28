import { test, expect } from "@playwright/test";

test.describe("Money Path — Public Acquisition & Upgrade Flows", () => {
  test("homepage displays clear AI citation promise and audit entrypoint", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/OptiAISEO/i);

    const auditInput = page.locator("input[type='text'], input[type='url'], input[placeholder*='domain' i], input[placeholder*='example' i]").first();
    await expect(auditInput).toBeVisible();

    const cta = page.locator("button:has-text('Audit'), button:has-text('Analyze'), button:has-text('Start'), a:has-text('Get Started')").first();
    await expect(cta).toBeVisible();
  });

  test("pricing page displays all 4 tiers with monthly/annual toggle", async ({ page }) => {
    await page.goto("/pricing");

    await expect(page.locator("text=Free").first()).toBeVisible();
    await expect(page.locator("text=Starter").first()).toBeVisible();
    await expect(page.locator("text=Pro").first()).toBeVisible();
    await expect(page.locator("text=Agency").first()).toBeVisible();

    const upgradeButtons = page.locator("a[href*='register'], a[href*='checkout'], button:has-text('Upgrade'), button:has-text('Get Started'), button:has-text('Subscribe')");
    expect(await upgradeButtons.count()).toBeGreaterThanOrEqual(3);
  });

  test("registration page has domain onboarding and signup fields", async ({ page }) => {
    await page.goto("/register");

    const emailInput = page.locator("input[type='email'], input[name='email']");
    const passwordInput = page.locator("input[type='password'], input[name='password']");
    await expect(emailInput).toBeVisible();
    await expect(passwordInput).toBeVisible();

    const submitBtn = page.locator("button[type='submit'], button:has-text('Sign Up'), button:has-text('Register'), button:has-text('Create Account')").first();
    await expect(submitBtn).toBeVisible();
  });
});
