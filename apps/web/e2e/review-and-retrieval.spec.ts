import { expect, test } from "@playwright/test";

import {
  APP_URL,
  authenticateBrowserSession,
  SHARED_ADMIN_EMAIL,
  SHARED_ADMIN_PASSWORD,
  ensureAdminUserExists,
  createStudioInvestigation,
  createUniqueEmail,
  createUniqueTitle,
  createWorkspaceMember,
  getInvestigationIdForPrediction,
  getPageHeading,
  saveStructuredOutcome,
} from "./helpers";

test.describe("review and retrieval lifecycle @smoke", () => {
  test("persists shared review notes and surfaces retrieval-ready investigations", async ({ browser, page }) => {
    test.slow();

    const memberEmail = createUniqueEmail("review.member");
    const memberPassword = "workspace-member-password";
    const investigationTitle = createUniqueTitle("Phase 6 review retrieval");
    const sharedReviewNote =
      "Shared teammate review: watch the policy spillover into cyclicals and rates before closing the loop.";

    await ensureAdminUserExists(page, {
      email: SHARED_ADMIN_EMAIL,
      password: SHARED_ADMIN_PASSWORD,
      displayName: "Review Admin",
    });

    await authenticateBrowserSession(page, {
      email: SHARED_ADMIN_EMAIL,
      password: SHARED_ADMIN_PASSWORD,
    });
    await page.goto("/settings");
    await expect(getPageHeading(page, "Settings")).toBeVisible();

    await createWorkspaceMember(page, {
      email: memberEmail,
      password: memberPassword,
      displayName: "Review Member",
      role: "member",
    });

    const { predictionId } = await createStudioInvestigation(page, {
      title: investigationTitle,
    });
    const investigationId = await getInvestigationIdForPrediction(page, predictionId);

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();

    await authenticateBrowserSession(memberPage, {
      email: memberEmail,
      password: memberPassword,
    });
    await memberPage.goto(`${APP_URL}/investigations`);
    await expect(getPageHeading(memberPage, "Investigations")).toBeVisible();

    await memberPage.getByRole("button", { name: "Assign to me" }).first().click();
    await expect(memberPage.getByRole("button", { name: "Unassign" }).first()).toBeVisible();

    await memberPage.goto(`${APP_URL}/predictions/${predictionId}`);
    await expect(getPageHeading(memberPage, "Prediction detail")).toBeVisible();
    await expect(memberPage.getByText("Shared review notes")).toBeVisible();
    await memberPage.locator("textarea").first().fill(sharedReviewNote);
    await memberPage.getByRole("button", { name: "Save note" }).click();
    await expect(memberPage.locator("textarea")).toContainText(sharedReviewNote);

    await memberPage.reload();
    await expect(memberPage.locator("textarea")).toContainText(sharedReviewNote);

    await saveStructuredOutcome(memberPage, predictionId);
    await memberPage.reload();
    await expect(memberPage.getByText("Postmortem", { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(memberPage.getByText("retrieval-ready")).toBeVisible();

    await memberPage.goto(`${APP_URL}/library?trail=${investigationId}`);
    await expect(getPageHeading(memberPage, "Library")).toBeVisible();
    await expect(memberPage.getByText("Decision follow-through")).toBeVisible();

    await memberPage.goto(`${APP_URL}/settings`);
    await expect(memberPage.getByText("review note saved")).toBeVisible();
    await expect(memberPage.getByText("investigation assigned")).toBeVisible();

    await memberContext.close();
  });
});
