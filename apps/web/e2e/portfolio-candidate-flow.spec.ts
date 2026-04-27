import { expect, test } from "@playwright/test";

import {
  APP_URL,
  SHARED_ADMIN_EMAIL,
  SHARED_ADMIN_PASSWORD,
  authenticateBrowserSession,
  createStudioInvestigation,
  createUniqueTitle,
  ensureAdminUserExists,
  getPageHeading,
} from "./helpers";

test.describe("phase 8 portfolio candidate flow", () => {
  test("promotes a decision brief into the portfolio operating flow and surfaces portfolio pressure on the command center", async ({
    page,
  }) => {
    test.slow();

    const investigationTitle = createUniqueTitle("Phase 8 portfolio candidate");

    await ensureAdminUserExists(page, {
      email: SHARED_ADMIN_EMAIL,
      password: SHARED_ADMIN_PASSWORD,
      displayName: "Portfolio Admin",
    });

    await authenticateBrowserSession(page, {
      email: SHARED_ADMIN_EMAIL,
      password: SHARED_ADMIN_PASSWORD,
    });

    const { predictionId } = await createStudioInvestigation(page, {
      title: investigationTitle,
    });

    await page.goto(`${APP_URL}/predictions/${predictionId}`);
    await expect(getPageHeading(page, "Prediction detail")).toBeVisible();
    await page.getByRole("button", { name: "Create decision brief" }).click();
    await expect(page).toHaveURL(/\/decisions\/.+$/);
    await expect(getPageHeading(page, "Decision brief")).toBeVisible();

    await page.getByRole("button", { name: "Create portfolio candidate" }).click();
    await expect(page.getByText("Portfolio candidate created.")).toBeVisible();

    const openPortfolioCandidateLink = page.getByRole("link", { name: "Open portfolio candidate" });
    await expect(openPortfolioCandidateLink).toBeVisible();
    const portfolioHref = await openPortfolioCandidateLink.getAttribute("href");
    expect(portfolioHref).toContain("/portfolio/");
    const portfolioCandidateId = portfolioHref?.split("/portfolio/")[1] ?? "";
    expect(portfolioCandidateId).toBeTruthy();

    await openPortfolioCandidateLink.click();
    await expect(page).toHaveURL(new RegExp(`/portfolio/${portfolioCandidateId}$`));
    await expect(getPageHeading(page, "Portfolio candidate")).toBeVisible();
    await expect(page.getByText(investigationTitle, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Checkpoint follow-through" })).toBeVisible();
    await page.getByLabel("Conviction label").fill("high-conviction plus follow-through");
    await page.getByLabel("Secondary themes").fill("industrial-breadth, post-breakout confirmation");
    await page.getByLabel("Related assets").fill("XLI, CAT, URI");
    await page.getByRole("button", { name: "Save posture" }).click();
    await expect(page.getByText("Portfolio posture updated.")).toBeVisible();
    await expect(page.getByText("high-conviction plus follow-through")).toBeVisible();

    await page.getByRole("button", { name: "Assign to me" }).click();
    await expect(page.getByText("Portfolio ownership updated.")).toBeVisible();
    await page.getByRole("button", { name: "Mark active" }).click();
    await expect(page.getByText("Portfolio status updated.")).toBeVisible();

    await page.getByRole("button", { name: "+7d" }).click();
    await page.getByLabel("Checkpoint summary").fill("Momentum remains intact, but the portfolio candidate now needs formal cadence and explicit follow-through.");
    await page.getByRole("button", { name: "Save portfolio checkpoint" }).click();
    await expect(page.getByText("Portfolio checkpoint saved.")).toBeVisible();
    await expect(page.getByText("keep active | intact", { exact: true })).toBeVisible();

    await page.goto(`${APP_URL}/portfolio`);
    await expect(getPageHeading(page, "Portfolio desk")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Exposure hygiene" })).toBeVisible();
    await expect(page.getByText("Theme concentration")).toBeVisible();
    await expect(page.getByText(investigationTitle, { exact: true }).first()).toBeVisible();

    await page.goto(`${APP_URL}/workspace`);
    await expect(getPageHeading(page, "Command center")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Portfolio pulse" })).toBeVisible();
    await expect(page.getByText(investigationTitle, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Open candidate" }).first()).toBeVisible();

    await page.goto(`${APP_URL}/portfolio/${portfolioCandidateId}`);
    await expect(getPageHeading(page, "Portfolio candidate")).toBeVisible();
    await page.getByRole("button", { name: "Move to watching" }).first().click();
    await expect(page.getByText("Portfolio status updated.")).toBeVisible();
    await page.getByRole("button", { name: "Mark trimmed" }).first().click();
    await expect(page.getByText("Portfolio status updated.")).toBeVisible();

    await page.goto(`${APP_URL}/portfolio`);
    await expect(getPageHeading(page, "Portfolio desk")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Trimmed pending follow-up" })).toBeVisible();
    await expect(page.getByText(investigationTitle, { exact: true }).first()).toBeVisible();

    await page.goto(`${APP_URL}/portfolio/${portfolioCandidateId}`);
    await expect(getPageHeading(page, "Portfolio candidate")).toBeVisible();
    await page.getByRole("button", { name: "Close" }).first().click();
    await expect(page.getByText("Portfolio status updated.")).toBeVisible();
    await expect(page.getByText("Checkpoint workflow closed")).toBeVisible();

    await page.goto(`${APP_URL}/portfolio`);
    await expect(getPageHeading(page, "Portfolio desk")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Recently closed" })).toBeVisible();

    await page.goto(`${APP_URL}/library`);
    await expect(getPageHeading(page, "Library")).toBeVisible();
    await expect(page.getByText("Closed operating outcomes")).toBeVisible();
    await expect(page.getByText(investigationTitle, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Open candidate" }).first()).toBeVisible();

    await page.goto(`${APP_URL}/evaluation`);
    await expect(getPageHeading(page, "Evaluation")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Closed operating outcomes" })).toBeVisible();
    await expect(page.getByText(investigationTitle, { exact: true }).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "Open candidate" }).first()).toBeVisible();

    await page.goto(`${APP_URL}/settings`);
    await expect(getPageHeading(page, "Settings")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Audit trail" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Portfolio candidate" }).first()).toBeVisible();
    await expect(page.getByText("portfolio candidate posture updated")).toBeVisible();
  });
});
