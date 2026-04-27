import { expect, test } from "@playwright/test"

import {
  APP_URL,
  SHARED_ADMIN_EMAIL,
  SHARED_ADMIN_PASSWORD,
  authenticateBrowserSession,
  createStudioInvestigation,
  createUniqueTitle,
  ensureAdminUserExists,
  getPageHeading,
} from "./helpers"

test.describe("phase 9 portfolio review session flow", () => {
  test("creates a review session, saves a rebalance proposal, and finalizes the review", async ({ page }) => {
    test.slow()

    const investigationTitle = createUniqueTitle("Phase 9 portfolio review")

    await ensureAdminUserExists(page, {
      email: SHARED_ADMIN_EMAIL,
      password: SHARED_ADMIN_PASSWORD,
      displayName: "Portfolio Review Admin",
    })

    await authenticateBrowserSession(page, {
      email: SHARED_ADMIN_EMAIL,
      password: SHARED_ADMIN_PASSWORD,
    })

    const { predictionId } = await createStudioInvestigation(page, {
      title: investigationTitle,
    })

    await page.goto(`${APP_URL}/predictions/${predictionId}`)
    await expect(getPageHeading(page, "Prediction detail")).toBeVisible()
    await page.getByRole("button", { name: "Create decision brief" }).click()
    await expect(page).toHaveURL(/\/decisions\/.+$/)
    await page.getByRole("button", { name: "Create portfolio candidate" }).click()
    await expect(page.getByText("Portfolio candidate created.")).toBeVisible()

    await page.goto(`${APP_URL}/portfolio/reviews`)
    await expect(getPageHeading(page, "Portfolio reviews")).toBeVisible()
    await page.getByRole("button", { name: "Start portfolio review" }).click()

    await expect(getPageHeading(page, "Portfolio review session")).toBeVisible()
    await expect(page.getByText(investigationTitle, { exact: true }).first()).toBeVisible()
    await page.getByLabel("Rationale").first().fill("This thesis still matters, but the current overlap argues for a trim until breadth confirms again.")
    await page.getByRole("button", { name: "Save proposal" }).first().click()
    await expect(page.getByText("Portfolio rebalance proposal saved.")).toBeVisible()

    await page.getByRole("button", { name: "Finalize review" }).click()
    await expect(page.getByText("Portfolio review session finalized.")).toBeVisible()

    await page.goto(`${APP_URL}/settings`)
    await expect(getPageHeading(page, "Settings")).toBeVisible()
    await expect(page.getByText(/portfolio review session .* was finalized\./i)).toBeVisible()
    await expect(page.getByRole("link", { name: "Portfolio review" }).first()).toBeVisible()
  })
})
