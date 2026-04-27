import { expect, test } from "@playwright/test";

import {
  getPageHeading,
  gotoApp,
  SHARED_ADMIN_EMAIL,
  SHARED_ADMIN_PASSWORD,
} from "./helpers";

test.describe("team workspace alpha auth @smoke", () => {
  test("protects routes, preserves next, and restores sessions across reloads", async ({ page }) => {
    test.slow();

    const adminEmail = SHARED_ADMIN_EMAIL;
    const adminPassword = SHARED_ADMIN_PASSWORD;

    await gotoApp(page, "/");
    await expect(getPageHeading(page, "Market intelligence that keeps learning after every decision.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open workspace" }).first()).toBeVisible();

    await gotoApp(page, "/workspace");
    await expect(page).toHaveURL(/\/login\?next=%2Fworkspace/);
    await expect(getPageHeading(page, "Team workspace alpha")).toBeVisible();

    await gotoApp(page, "/studio");
    await expect(page).toHaveURL(/\/login\?next=%2Fstudio/);
    await expect(getPageHeading(page, "Team workspace alpha")).toBeVisible();
    await expect(page.getByText("Checking workspace bootstrap state...")).not.toBeVisible();
    await expect(page.getByText("No workspace users exist yet.")).toBeVisible();

    await page.getByLabel("Display name").fill("Auth Admin");
    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill(adminPassword);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/studio$/);
    await expect(getPageHeading(page, "Studio")).toBeVisible();

    await gotoApp(page, "/studio");
    await expect(page).toHaveURL(/\/studio$/);
    await expect(getPageHeading(page, "Studio")).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(/\/studio$/);
    await expect(getPageHeading(page, "Studio")).toBeVisible();

    await gotoApp(page, "/settings");
    await expect(getPageHeading(page, "Settings")).toBeVisible();
    await page.reload();
    await expect(getPageHeading(page, "Settings")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(getPageHeading(page, "Market intelligence that keeps learning after every decision.")).toBeVisible();

    await gotoApp(page, "/accuracy");
    await expect(page).toHaveURL(/\/login\?next=%2Faccuracy/);

    await page.getByLabel("Email").fill(adminEmail);
    await page.getByLabel("Password").fill(adminPassword);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/accuracy$/);
    await expect(getPageHeading(page, "Accuracy")).toBeVisible();

    await gotoApp(page, "/settings");
    await expect(getPageHeading(page, "Settings")).toBeVisible();
    await expect(page.getByText("login").first()).toBeVisible();
    await expect(page.getByText("logout").first()).toBeVisible();
  });
});
