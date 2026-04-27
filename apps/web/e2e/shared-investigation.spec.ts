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
  getWorkspaceStateSnapshot,
  getPageHeading,
} from "./helpers";

test.describe("shared investigation propagation @smoke", () => {
  test("shares investigations across teammates and propagates assignment changes", async ({ browser, page }) => {
    test.slow();

    const memberEmail = createUniqueEmail("shared.member");
    const memberPassword = "workspace-member-password";
    const investigationTitle = createUniqueTitle("Phase 6 shared investigation");

    await ensureAdminUserExists(page, {
      email: SHARED_ADMIN_EMAIL,
      password: SHARED_ADMIN_PASSWORD,
      displayName: "Shared Admin",
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
      displayName: "Shared Member",
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
    await memberPage.goto(`${APP_URL}/workspace`);
    await expect(memberPage.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect
      .poll(async () => {
        const state = await getWorkspaceStateSnapshot(memberPage);
        return state.investigations.some((trail) => trail.id === investigationId);
      })
      .toBeTruthy();
    await memberPage.goto(`${APP_URL}/investigations`);
    await expect(getPageHeading(memberPage, "Investigations")).toBeVisible();
    await memberPage.getByPlaceholder("Search by title, step, event, or prediction id...").fill(predictionId);
    await memberPage.getByRole("button", { name: "Assign to me" }).first().click();
    await expect(memberPage.getByRole("button", { name: "Unassign" }).first()).toBeVisible();
    await expect
      .poll(async () => {
        const state = await getWorkspaceStateSnapshot(memberPage);
        return state.investigations.find((trail) => trail.id === investigationId)?.assignee_user_id ?? null;
      })
      .not.toBeNull();

    await memberPage.goto(`${APP_URL}/accuracy?focus=${predictionId}`);
    await expect(getPageHeading(memberPage, "Accuracy")).toBeVisible();
    await expect(memberPage.getByText("assigned to me")).toBeVisible();

    await memberPage.goto(`${APP_URL}/investigations`);
    await memberPage.getByPlaceholder("Search by title, step, event, or prediction id...").fill(predictionId);
    await memberPage.getByRole("button", { name: "Unassign" }).first().click();
    await expect(memberPage.getByRole("button", { name: "Assign to me" }).first()).toBeVisible();
    await expect
      .poll(async () => {
        const state = await getWorkspaceStateSnapshot(memberPage);
        return state.investigations.find((trail) => trail.id === investigationId)?.assignee_user_id ?? null;
      })
      .toBeNull();

    await memberPage.goto(`${APP_URL}/evaluation?trail=${investigationId}`);
    await expect(getPageHeading(memberPage, "Evaluation")).toBeVisible();

    await memberPage.goto(`${APP_URL}/settings`);
    await expect(memberPage.getByText("investigation assigned").first()).toBeVisible();

    await memberContext.close();
  });
});
