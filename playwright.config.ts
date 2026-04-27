import { defineConfig, devices } from "@playwright/test";

const baseUrl = "http://localhost:3200";
const apiUrl = process.env.PLAYWRIGHT_API_URL ?? "http://localhost:3101";
const apiPort = new URL(apiUrl).port || "3101";
const reuseExistingServer = process.env.CI ? false : process.env.PLAYWRIGHT_REUSE_EXISTING_SERVER === "true";
const runCommand = (command: string) =>
  process.platform === "win32" ? `cmd /c "${command}"` : command;

export default defineConfig({
  testDir: "./apps/web/e2e",
  fullyParallel: false,
  retries: 0,
  workers: 1,
  timeout: 180_000,
  expect: {
    timeout: 20_000,
  },
  use: {
    baseURL: baseUrl,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: [
    {
      command: runCommand("npm --workspace @finance-superbrain/api run build && npm --workspace @finance-superbrain/api run start"),
      url: `${apiUrl}/health`,
      reuseExistingServer,
      timeout: 120_000,
      env: {
        ...process.env,
        REPOSITORY_BACKEND: "memory",
        MARKET_DATA_BACKEND: "mock",
        CHAT_MODEL_BACKEND: "mock",
        AUTH_COOKIE_SECURE: "false",
        HOST: "localhost",
        PORT: apiPort,
      },
    },
    {
      command: runCommand("npm --workspace @finance-superbrain/web run build && npm --workspace @finance-superbrain/web run start -- --hostname localhost --port 3200"),
      url: `${baseUrl}/login`,
      reuseExistingServer,
      timeout: 180_000,
      env: {
        ...process.env,
        NEXT_PUBLIC_API_URL: apiUrl,
      },
    },
  ],
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
      },
    },
  ],
});
