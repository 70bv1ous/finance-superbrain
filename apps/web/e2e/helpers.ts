import { expect, type Page } from "@playwright/test";

export type WorkspaceUserInput = {
  email: string;
  password: string;
  displayName?: string;
};

export const APP_URL = process.env["PLAYWRIGHT_APP_URL"] ?? "http://localhost:3200";
export const API_URL = process.env["PLAYWRIGHT_API_URL"] ?? "http://localhost:3101";
export const SHARED_ADMIN_EMAIL = "lead.operator@finance-superbrain.local";
export const SHARED_ADMIN_PASSWORD = "workspace-admin-password";

const randomSuffix = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function createUniqueEmail(prefix: string) {
  return `${prefix}.${randomSuffix()}@finance-superbrain.local`;
}

export function createUniqueTitle(prefix: string) {
  return `${prefix} ${randomSuffix()}`;
}

export function getPageHeading(page: Page, name: string) {
  return page.locator("h1").filter({ hasText: new RegExp(`^${escapeRegExp(name)}$`) });
}

export async function gotoApp(page: Page, path: string) {
  await page.goto(`${APP_URL}${path}`);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function submitLogin(page: Page, input: WorkspaceUserInput) {
  if (input.displayName) {
    const bootstrapNotice = page.getByText("No workspace users exist yet.");

    if (await bootstrapNotice.isVisible().catch(() => false)) {
      const displayNameField = page.getByLabel("Display name");
      await expect(displayNameField).toBeVisible();
      await displayNameField.fill(input.displayName);
    }
  }

  await page.getByLabel("Email").fill(input.email);
  await page.getByLabel("Password").fill(input.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function ensureAuthenticated(page: Page, input: WorkspaceUserInput, targetPath = "/workspace") {
  await page.goto(targetPath);

  if (/\/login/.test(page.url())) {
    await expect(getPageHeading(page, "Team workspace alpha")).toBeVisible();
    await expect(page.getByText("Checking workspace bootstrap state...")).not.toBeVisible();
    await submitLogin(page, input);
  }

  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

export async function ensureAdminUserExists(page: Page, input: WorkspaceUserInput) {
  const bootstrapResponse = await page.request.get(`${API_URL}/v1/auth/bootstrap`);
  expect(bootstrapResponse.ok()).toBeTruthy();
  const bootstrap = (await bootstrapResponse.json()) as { bootstrap_required: boolean };

  if (!bootstrap.bootstrap_required) {
    return;
  }

  const createResponse = await page.request.post(`${API_URL}/v1/admin/users`, {
    data: {
      email: input.email,
      password: input.password,
      display_name: input.displayName ?? "Lead Operator",
      role: "admin",
    },
  });

  expect(createResponse.ok()).toBeTruthy();
}

export async function authenticateBrowserSession(page: Page, input: WorkspaceUserInput) {
  const response = await page.request.post(`${API_URL}/v1/auth/login`, {
    data: {
      email: input.email,
      password: input.password,
    },
  });

  expect(response.ok()).toBeTruthy();

  const setCookie = response.headers()["set-cookie"] ?? "";
  const match = /finance_superbrain_session=([^;]+)/.exec(setCookie);

  expect(match).not.toBeNull();

  await page.context().addCookies([
    {
      name: "finance_superbrain_session",
      value: decodeURIComponent(match![1]),
      url: API_URL,
      httpOnly: true,
      sameSite: "Lax",
    },
    {
      name: "finance_superbrain_session",
      value: decodeURIComponent(match![1]),
      url: APP_URL,
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

export async function createWorkspaceMember(
  page: Page,
  input: WorkspaceUserInput & { role?: "admin" | "member" },
) {
  await page.goto("/settings");
  await expect(getPageHeading(page, "Settings")).toBeVisible();
  await page.getByLabel("Display name").fill(input.displayName ?? "Workspace Member");
  await page.getByLabel("Email").fill(input.email);
  await page.getByLabel("Temporary password").fill(input.password);
  await page.getByLabel("Role").selectOption(input.role ?? "member");
  await page.getByRole("button", { name: "Create member" }).click();
  await expect(page.getByText("Workspace member created.")).toBeVisible();
  await expect(page.getByText(input.email)).toBeVisible();
}

export async function createStudioInvestigation(page: Page, input: {
  title: string;
  publisher?: string;
  rawText?: string;
}) {
  await page.goto("/studio");
  await expect(getPageHeading(page, "Studio")).toBeVisible();
  await page.getByLabel("Title").fill(input.title);
  await page.getByLabel("Publisher").fill(input.publisher ?? "Internal alpha desk");
  await page
    .getByLabel("Raw text")
    .fill(
      input.rawText ??
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

  return {
    predictionId: predictionHref.split("/predictions/")[1],
  };
}

export async function getWorkspaceStateSnapshot(page: Page) {
  return await page.evaluate(async ({ apiUrl }) => {
    const response = await fetch(`${apiUrl}/v1/workspace/state`, {
      credentials: "include",
    });

    if (!response.ok) {
      throw new Error(`Failed to load workspace state: ${response.status}`);
    }

    return await response.json();
  }, { apiUrl: API_URL }) as {
    user: {
      id: string;
    } | null;
    investigations: Array<{
      id: string;
      prediction_ids: string[];
      assignee_user_id?: string | null;
    }>;
    decision_briefs: Array<{
      id: string;
      investigation_id: string;
      lead_prediction_id: string;
      status: "draft" | "proposed" | "active" | "watching" | "closed";
    }>;
  };
}

export async function getInvestigationIdForPrediction(page: Page, predictionId: string) {
  const state = await getWorkspaceStateSnapshot(page);
  const match = state.investigations.find((trail) => trail.prediction_ids.includes(predictionId));

  expect(match).toBeTruthy();

  return match!.id;
}

export async function saveStructuredOutcome(page: Page, predictionId: string) {
  await page.evaluate(async ({ apiUrl, predictionId }) => {
    const detailResponse = await fetch(`${apiUrl}/v1/predictions/${predictionId}`, {
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

    const scoreResponse = await fetch(`${apiUrl}/v1/predictions/${predictionId}/score`, {
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

    const postmortemResponse = await fetch(`${apiUrl}/v1/predictions/${predictionId}/postmortem`, {
      method: "POST",
      credentials: "include",
    });

    if (!postmortemResponse.ok) {
      throw new Error(`Failed to create postmortem: ${postmortemResponse.status}`);
    }
  }, { apiUrl: API_URL, predictionId });
}
