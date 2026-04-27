import { expect, test } from "@playwright/test";

import {
  APP_URL,
  authenticateBrowserSession,
  SHARED_ADMIN_EMAIL,
  SHARED_ADMIN_PASSWORD,
  createStudioInvestigation,
  createUniqueEmail,
  createUniqueTitle,
  createWorkspaceMember,
  ensureAdminUserExists,
  getInvestigationIdForPrediction,
  getPageHeading,
} from "./helpers";

function toDateTimeLocalValue(date: Date) {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);

  return local.toISOString().slice(0, 16);
}

test.describe("phase 7 decision brief flow @smoke", () => {
  test("promotes a studio prediction into a shared brief and keeps that context visible across desks", async ({
    browser,
    page,
  }) => {
    test.slow();

    const memberEmail = createUniqueEmail("decision.member");
    const memberPassword = "workspace-member-password";
    const investigationTitle = createUniqueTitle("Phase 7 decision brief");

    await ensureAdminUserExists(page, {
      email: SHARED_ADMIN_EMAIL,
      password: SHARED_ADMIN_PASSWORD,
      displayName: "Decision Admin",
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
      displayName: "Decision Member",
      role: "member",
    });

    const { predictionId } = await createStudioInvestigation(page, {
      title: investigationTitle,
    });
    const investigationId = await getInvestigationIdForPrediction(page, predictionId);

    await expect(page.getByRole("button", { name: "Create decision brief" })).toBeEnabled();
    await page.getByRole("button", { name: "Create decision brief" }).click();
    await expect(page).toHaveURL(/\/decisions\/.+$/);
    await expect(getPageHeading(page, "Decision brief")).toBeVisible();
    await expect(page.getByText(/Track the current thesis, ownership, checkpoints, and closure path/)).toBeVisible();

    const briefUrl = page.url();
    const decisionBriefId = briefUrl.split("/decisions/")[1];
    expect(decisionBriefId).toBeTruthy();

    await page.getByRole("button", { name: "Mark active" }).click();
    await expect(page.getByRole("button", { name: "Move to watching" })).toBeVisible();

    const overdueReviewInput = new Date();
    overdueReviewInput.setDate(overdueReviewInput.getDate() - 1);
    await page.getByLabel("Next review due").first().fill(toDateTimeLocalValue(overdueReviewInput));
    await page.getByRole("button", { name: "Save review cadence" }).click();
    await expect(page.getByText("Next review cadence saved.")).toBeVisible();

    await page.getByPlaceholder("Summarize what changed, whether the thesis still holds, and what the team should do next.").fill(
      "Checkpoint confirms the thesis is still intact and should stay live while the team watches for confirmation signals.",
    );
    await page.getByLabel("Action").selectOption("keep_active");
    await page.getByRole("button", { name: "Save checkpoint" }).click();
    await expect(page.getByText("Checkpoint saved.")).toBeVisible();
    await expect(page.getByText("Checkpoint confirms the thesis is still intact", { exact: false }).first()).toBeVisible();

    await page.goto("/workspace");
    await expect(getPageHeading(page, "Command center")).toBeVisible();
    await expect(page.getByText("Due follow-up")).toBeVisible();
    await expect(page.locator(`a[href="/decisions/${decisionBriefId}"]`).first()).toBeVisible();

    const memberContext = await browser.newContext();
    const memberPage = await memberContext.newPage();

    await authenticateBrowserSession(memberPage, {
      email: memberEmail,
      password: memberPassword,
    });

    await memberPage.goto(`${APP_URL}/decisions`);
    await expect(getPageHeading(memberPage, "Decision desk")).toBeVisible();
    await expect(memberPage.locator(`a[href="/decisions/${decisionBriefId}"]`).first()).toBeVisible();
    await memberPage.getByRole("button", { name: "Assign to me" }).first().click();
    await expect(memberPage.getByRole("button", { name: "Unassign" }).first()).toBeVisible();

    await memberPage.goto(`${APP_URL}/investigations`);
    await expect(getPageHeading(memberPage, "Investigations")).toBeVisible();
    await expect(memberPage.getByText(investigationTitle, { exact: true }).first()).toBeVisible();
    await expect(memberPage.getByRole("link", { name: "Open brief" }).first()).toBeVisible();

    await memberPage.goto(`${APP_URL}/predictions/${predictionId}`);
    await expect(getPageHeading(memberPage, "Prediction detail")).toBeVisible();
    await expect(memberPage.getByText("Shared decision brief")).toBeVisible();
    await expect(memberPage.getByRole("link", { name: "Open decision brief" })).toBeVisible();

    await memberPage.goto(`${APP_URL}/accuracy`);
    await expect(getPageHeading(memberPage, "Accuracy")).toBeVisible();
    await expect(memberPage.getByText("Decision brief linked").first()).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "Open brief" }).first()).toBeVisible();

    await memberPage.goto(`${APP_URL}/library?trail=${investigationId}`);
    await expect(getPageHeading(memberPage, "Library")).toBeVisible();
    await expect(memberPage.getByText("Decision follow-through")).toBeVisible();
    await expect(memberPage.getByRole("link", { name: "Open brief" }).first()).toBeVisible();

    await memberPage.goto(`${APP_URL}/evaluation?trail=${investigationId}`);
    await expect(getPageHeading(memberPage, "Evaluation")).toBeVisible();
    await expect(memberPage.getByText("Decision follow-through")).toBeVisible();
    await expect(memberPage.getByRole("link", { name: "Open brief" }).first()).toBeVisible();

    await memberPage.goto(`${APP_URL}/settings`);
    await expect(getPageHeading(memberPage, "Settings")).toBeVisible();
    await expect(memberPage.getByText("decision brief created").first()).toBeVisible();
    await expect(memberPage.getByText("decision brief assigned").first()).toBeVisible();
    await expect(memberPage.getByText("decision brief status changed").first()).toBeVisible();
    await expect(memberPage.getByText("decision checkpoint saved").first()).toBeVisible();

    await memberPage.goto(`${APP_URL}/decisions/${decisionBriefId}`);
    await expect(getPageHeading(memberPage, "Decision brief")).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "Unassign" })).toBeVisible();
    await memberPage.getByRole("button", { name: "Move to watching" }).click();
    await expect(memberPage.getByText("Decision brief moved to watching.", { exact: true })).toBeVisible();

    await memberPage.goto(`${APP_URL}/decisions`);
    await expect(getPageHeading(memberPage, "Decision desk")).toBeVisible();
    await expect(memberPage.getByRole("heading", { name: "Watching briefs" })).toBeVisible();
    await expect(memberPage.locator(`a[href="/decisions/${decisionBriefId}"]`).first()).toBeVisible();

    await memberPage.goto(`${APP_URL}/decisions/${decisionBriefId}`);
    await expect(getPageHeading(memberPage, "Decision brief")).toBeVisible();
    await memberPage.getByRole("button", { name: "Close brief" }).click();
    await expect(memberPage.getByText("Decision brief closed.")).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "Reopen as watching" })).toBeVisible();
    await expect(memberPage.getByRole("link", { name: "Open retrieval desk" })).toBeVisible();

    await memberPage.goto(`${APP_URL}/workspace`);
    await expect(getPageHeading(memberPage, "Command center")).toBeVisible();
    await expect(memberPage.getByText("Closed operating outcomes")).toBeVisible();
    await expect(memberPage.getByText(investigationTitle, { exact: true }).first()).toBeVisible();

    await memberPage.goto(`${APP_URL}/library`);
    await expect(getPageHeading(memberPage, "Library")).toBeVisible();
    await expect(memberPage.getByText("CLOSED OPERATING OUTCOMES", { exact: true })).toBeVisible();

    await memberPage.goto(`${APP_URL}/decisions/${decisionBriefId}`);
    await expect(getPageHeading(memberPage, "Decision brief")).toBeVisible();
    await memberPage.getByRole("button", { name: "Reopen as watching" }).click();
    await expect(memberPage.getByText("Decision brief moved to watching.", { exact: true })).toBeVisible();
    await expect(memberPage.getByRole("button", { name: "Close brief" })).toBeVisible();

    await memberPage.goto(`${APP_URL}/settings`);
    await expect(getPageHeading(memberPage, "Settings")).toBeVisible();
    await expect(memberPage.getByText("decision brief closed").first()).toBeVisible();

    await memberContext.close();
  });
});
