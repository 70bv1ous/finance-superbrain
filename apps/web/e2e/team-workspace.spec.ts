import { expect, test, type Page } from "@playwright/test";

const adminEmail = "lead.operator@finance-superbrain.local";
const adminPassword = "workspace-admin-password";
const memberEmail = "review.operator@finance-superbrain.local";
const memberPassword = "workspace-member-password";
const investigationTitle = "Phase 6 team workspace event";
const sharedReviewNote =
  "Shared teammate review: track second-order spillover into rates and cyclicals before closing the loop.";

async function login(
  page: Page,
  input: {
    email: string;
    password: string;
    displayName?: string;
  },
) {
  if (input.displayName) {
    const displayNameField = page.getByLabel("Display name");

    if (await displayNameField.count()) {
      await displayNameField.fill(input.displayName);
    }
  }

  await page.getByLabel("Email").fill(input.email);
  await page.getByLabel("Password").fill(input.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

async function saveStructuredOutcome(page: Page, predictionId: string) {
  await page.evaluate(async ({ predictionId }: { predictionId: string }) => {
    const detailResponse = await fetch(`http://localhost:3001/v1/predictions/${predictionId}`, {
      credentials: "include",
    });

    if (!detailResponse.ok) {
      throw new Error(`Failed to load prediction detail for scoring: ${detailResponse.status}`);
    }

    const detail = await detailResponse.json();
    const leadAsset = detail.prediction.assets[0];

    if (!leadAsset) {
      throw new Error("Prediction had no assets to score.");
    }

    const scoreResponse = await fetch(`http://localhost:3001/v1/predictions/${predictionId}/score`, {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        realized_moves: [
          {
            ticker: leadAsset.ticker,
            realized_direction: leadAsset.expected_direction,
            realized_magnitude_bp: leadAsset.expected_magnitude_bp,
          },
        ],
        timing_alignment: 0.84,
      }),
    });

    if (!scoreResponse.ok) {
      throw new Error(`Failed to score prediction: ${scoreResponse.status}`);
    }

    const postmortemResponse = await fetch(`http://localhost:3001/v1/predictions/${predictionId}/postmortem`, {
      method: "POST",
      credentials: "include",
    });

    if (!postmortemResponse.ok) {
      throw new Error(`Failed to create postmortem: ${postmortemResponse.status}`);
    }
  }, { predictionId });
}

function getPageHeading(page: Page, name: string) {
  return page.locator("h1").filter({ hasText: new RegExp(`^${name}$`) });
}

test.describe("team workspace alpha", () => {
  test("bootstraps, shares, assigns, reviews, and retrieves a team investigation", async ({ page }) => {
    test.slow();

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/login\?next=%2Fsettings/);
    await expect(getPageHeading(page, "Team workspace alpha")).toBeVisible();
    await expect(page.getByText("Checking workspace bootstrap state...")).not.toBeVisible();
    await expect(page.getByText("No workspace users exist yet.")).toBeVisible();

    await login(page, {
      email: adminEmail,
      password: adminPassword,
      displayName: "Lead Operator",
    });

    await expect(page).toHaveURL(/\/settings$/);
    await expect(getPageHeading(page, "Settings")).toBeVisible();
    await page.reload();
    await expect(getPageHeading(page, "Settings")).toBeVisible();

    await page.getByLabel("Display name").fill("Review Operator");
    await page.getByLabel("Email").fill(memberEmail);
    await page.getByLabel("Temporary password").fill(memberPassword);
    await page.getByLabel("Role").selectOption("member");
    await page.getByRole("button", { name: "Create member" }).click();
    await expect(page.getByText("Workspace member created.")).toBeVisible();
    await expect(page.getByText(memberEmail)).toBeVisible();

    await page.goto("/studio");
    await expect(getPageHeading(page, "Studio")).toBeVisible();
    await page.getByLabel("Title").fill(investigationTitle);
    await page.getByLabel("Publisher").fill("Internal alpha desk");
    await page
      .getByLabel("Raw text")
      .fill(
        "The central bank signaled a larger liquidity injection, softened near-term policy language, and boosted cyclical risk appetite across rates and equities.",
      );

    await page.getByRole("button", { name: "Parse preview" }).click();
    await expect(page.getByText("Preview parsed successfully.")).toBeVisible();

    await page.getByRole("button", { name: "Store source and event" }).click();
    await expect(page.getByText("Source stored and event created.")).toBeVisible();

    await page.getByRole("button", { name: "Generate predictions and analogs" }).click();
    await expect(page.getByText("Predictions generated.")).toBeVisible({ timeout: 30_000 });

    const predictionHref =
      (await page.getByRole("link", { name: "Open detail" }).first().getAttribute("href")) ?? "";
    expect(predictionHref).toContain("/predictions/");
    const predictionId = predictionHref.split("/predictions/")[1];

    await page.getByRole("link", { name: "Open detail" }).first().click();
    await expect(page).toHaveURL(new RegExp(`/predictions/${predictionId}$`));
    await expect(getPageHeading(page, "Prediction detail")).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login/);

    await login(page, {
      email: memberEmail,
      password: memberPassword,
    });

    await expect(page).toHaveURL(/\/workspace$/);
    await expect(page.getByText(investigationTitle, { exact: true }).first()).toBeVisible();

    await page.goto("/investigations");
    await expect(getPageHeading(page, "Investigations")).toBeVisible();
    await expect(page.getByText(investigationTitle, { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Assign to me" }).first().click();
    await expect(page.getByRole("button", { name: "Unassign" }).first()).toBeVisible();

    await page.goto("/accuracy");
    await expect(getPageHeading(page, "Accuracy")).toBeVisible();
    await expect(page.getByText("Shared review queue")).toBeVisible();
    await expect(page.getByText(investigationTitle, { exact: true }).first()).toBeVisible();
    await expect(page.getByText("assigned to me")).toBeVisible();

    await page.goto(`/predictions/${predictionId}`);
    await expect(page.getByText("Shared review notes")).toBeVisible();
    await page
      .locator("textarea")
      .filter({ hasText: "" })
      .first()
      .fill(sharedReviewNote);
    await page.getByRole("button", { name: "Save note" }).click();
    await expect(page.locator("textarea")).toContainText(sharedReviewNote);

    await saveStructuredOutcome(page, predictionId);
    await page.reload();
    await expect(page.getByText("Postmortem")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("retrieval-ready")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Library" })).toBeVisible();

    await page.goto("/library");
    await expect(getPageHeading(page, "Library")).toBeVisible();
    await expect(page.getByText("COMPLETED INVESTIGATIONS", { exact: true })).toBeVisible();
    await expect(page.getByText(investigationTitle, { exact: true }).first()).toBeVisible();

    await page.goto("/settings");
    await expect(page.getByText("Workspace activity")).toBeVisible();
    await expect(page.getByText("review note saved")).toBeVisible();
    await expect(page.getByText("investigation assigned")).toBeVisible();
  });
});
