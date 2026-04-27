import { expect, test } from "@playwright/test"

import {
  authenticateBrowserSession,
  createStudioInvestigation,
  createUniqueTitle,
  ensureAdminUserExists,
  getPageHeading,
  SHARED_ADMIN_EMAIL,
  SHARED_ADMIN_PASSWORD,
} from "./helpers"

function toDateTimeLocalValue(date: Date) {
  const offset = date.getTimezoneOffset()
  const local = new Date(date.getTime() - offset * 60_000)

  return local.toISOString().slice(0, 16)
}

test.describe("phase 7 decision boundary and cadence", () => {
  test("keeps promotion-ready research distinct from live decision work and recovers cadence gaps", async ({ page }) => {
    test.slow()

    const investigationTitle = createUniqueTitle("Phase 7 promotion-ready research")

    await ensureAdminUserExists(page, {
      email: SHARED_ADMIN_EMAIL,
      password: SHARED_ADMIN_PASSWORD,
      displayName: "Decision Admin",
    })

    await authenticateBrowserSession(page, {
      email: SHARED_ADMIN_EMAIL,
      password: SHARED_ADMIN_PASSWORD,
    })

    const { predictionId } = await createStudioInvestigation(page, {
      title: investigationTitle,
    })

    await page.goto("/investigations")
    await expect(getPageHeading(page, "Investigations")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Promotion-ready research" })).toBeVisible()
    await expect(page.getByText(investigationTitle, { exact: true }).first()).toBeVisible()
    await expect(page.getByText("Promotion-ready research. A lead prediction exists", { exact: false }).first()).toBeVisible()
    await expect(page.getByRole("link", { name: "Promote from prediction" }).first()).toBeVisible()

    await page.goto(`/predictions/${predictionId}`)
    await expect(getPageHeading(page, "Prediction detail")).toBeVisible()
    await expect(page.getByRole("button", { name: "Create decision brief" })).toBeEnabled()
    await page.getByRole("button", { name: "Create decision brief" }).click()

    await expect(page).toHaveURL(/\/decisions\/.+$/)
    await expect(getPageHeading(page, "Decision brief")).toBeVisible()
    const decisionBriefId = page.url().split("/decisions/")[1]
    expect(decisionBriefId).toBeTruthy()

    await page.getByRole("button", { name: "Mark active" }).click()
    await expect(page.getByText("Decision brief moved to active.")).toBeVisible()

    await page.goto("/decisions")
    await expect(getPageHeading(page, "Decision desk")).toBeVisible()
    await expect(page.getByText("Missing review dates", { exact: true })).toBeVisible()
    await expect(page.locator(`a[href="/decisions/${decisionBriefId}"]`).first()).toBeVisible()

    await page.goto(`/decisions/${decisionBriefId}`)
    await expect(getPageHeading(page, "Decision brief")).toBeVisible()
    const dueTomorrow = new Date()
    dueTomorrow.setDate(dueTomorrow.getDate() + 1)
    await page.getByLabel("Next review due").first().fill(toDateTimeLocalValue(dueTomorrow))
    await page.getByRole("button", { name: "Save review cadence" }).click()
    await expect(page.getByText("Next review cadence saved.")).toBeVisible()

    await page.goto("/decisions")
    await expect(getPageHeading(page, "Decision desk")).toBeVisible()
    await expect(page.getByText("Due within 48 hours", { exact: true })).toBeVisible()
    await expect(page.getByText(investigationTitle, { exact: true }).first()).toBeVisible()

    await page.goto("/investigations")
    await expect(getPageHeading(page, "Investigations")).toBeVisible()
    await expect(page.getByRole("heading", { name: "Decision-backed investigations" })).toBeVisible()
    await expect(page.getByText(investigationTitle, { exact: true }).first()).toBeVisible()
    await expect(page.getByRole("link", { name: "Open brief" }).first()).toBeVisible()

    await page.goto("/settings")
    await expect(getPageHeading(page, "Settings")).toBeVisible()
    await expect(page.locator(`a[href="/decisions/${decisionBriefId}"]`).first()).toBeVisible()
    await expect(page.locator(`a[href="/predictions/${predictionId}"]`).first()).toBeVisible()
  })
})
