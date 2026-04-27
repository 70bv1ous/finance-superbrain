import { expect, test } from "@playwright/test";

import {
  SHARED_ADMIN_EMAIL,
  SHARED_ADMIN_PASSWORD,
  authenticateBrowserSession,
  ensureAdminUserExists,
  getPageHeading,
  gotoApp,
} from "./helpers";

test.describe("phase 11 guided intelligence proof @smoke", () => {
  test("walks from the public shell into the guided evidence desk and renders structured proof", async ({ page }) => {
    test.slow();

    await gotoApp(page, "/");
    await expect(getPageHeading(page, "Market intelligence that keeps learning after every decision.")).toBeVisible();
    await expect(page.getByText("What a strong answer should show in the workspace.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open workspace" }).first()).toBeVisible();

    await ensureAdminUserExists(page, {
      email: SHARED_ADMIN_EMAIL,
      password: SHARED_ADMIN_PASSWORD,
      displayName: "Proof Admin",
    });

    await authenticateBrowserSession(page, {
      email: SHARED_ADMIN_EMAIL,
      password: SHARED_ADMIN_PASSWORD,
    });

    await gotoApp(page, "/workspace");

    await expect(getPageHeading(page, "Command center")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Guided intelligence proof" })).toBeVisible();
    await page.getByRole("link", { name: "Jump to evidence desk" }).click();

    await expect(page.locator("#intelligence-proof")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Evidence desk" })).toBeVisible();
    await expect(page.getByText("Repeatable intelligence proof, one click away.")).toBeVisible();

    await page.getByRole("button", { name: /Hot CPI cross-asset reaction/i }).click();

    await expect(page.getByText("Bottom line", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Affected assets", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Evidence", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Explicit limits", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Risk factors", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("Analogue support", { exact: true }).last()).toBeVisible();
    await expect(page.getByText("TLT").first()).toBeVisible();
    await expect(page.getByText("DXY").first()).toBeVisible();
  });
});
