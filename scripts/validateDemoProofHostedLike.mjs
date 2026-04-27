import { spawn } from "node:child_process";
import { access, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const projectRoot = process.cwd();
const webPort = Number(process.env.DEMO_PROOF_WEB_PORT || 3400);
const apiPort = Number(process.env.DEMO_PROOF_API_PORT || 3401);
const webUrl = `http://127.0.0.1:${webPort}`;
const apiUrl = `http://127.0.0.1:${apiPort}`;

function buildShellCommand(args) {
  return `npm ${args.join(" ")}`;
}

async function runNpm(args, env) {
  await new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", buildShellCommand(args)], {
            cwd: projectRoot,
            env,
            stdio: "inherit",
          })
        : spawn("npm", args, {
            cwd: projectRoot,
            env,
            stdio: "inherit",
          });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve(undefined);
        return;
      }

      reject(new Error(`Command failed with exit code ${code ?? "unknown"}: npm ${args.join(" ")}`));
    });
  });
}

function startServer(name, command, args, env) {
  const child =
    process.platform === "win32" && command === "npm"
      ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", buildShellCommand(args)], {
          cwd: projectRoot,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        })
      : spawn(command, args, {
          cwd: projectRoot,
          env,
          stdio: ["ignore", "pipe", "pipe"],
        });
  let output = "";

  child.stdout?.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk) => {
    output += chunk.toString();
  });

  return {
    name,
    child,
    getOutput: () => output,
  };
}

async function stopServer(server) {
  if (!server?.child || server.child.killed) {
    return;
  }

  if (process.platform === "win32") {
    await new Promise((resolve) => {
      const killer = spawn("taskkill", ["/pid", String(server.child.pid), "/t", "/f"], {
        stdio: "ignore",
      });
      killer.on("exit", () => resolve(undefined));
      killer.on("error", () => resolve(undefined));
    });
    return;
  }

  server.child.kill("SIGTERM");
  await new Promise((resolve) => {
    server.child.once("exit", () => resolve(undefined));
    setTimeout(() => {
      if (!server.child.killed) {
        server.child.kill("SIGKILL");
      }
      resolve(undefined);
    }, 5_000);
  });
}

async function waitFor(check, label, timeoutMs = 60_000, intervalMs = 1_000) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const result = await check();

      if (result) {
        return result;
      }
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(`Timed out waiting for ${label}.`);
}

async function fetchText(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();

  return { response, text };
}

function extractSessionCookie(setCookieHeaders) {
  for (const header of setCookieHeaders) {
    const match = /finance_superbrain_session=([^;]+)/.exec(header);

    if (match) {
      return decodeURIComponent(match[1]);
    }
  }

  return null;
}

async function countMarkdownFiles(rootDir) {
  let count = 0;
  const queue = [rootDir];

  while (queue.length) {
    const current = queue.pop();
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }

      if (entry.isFile() && fullPath.endsWith(".md")) {
        count += 1;
      }
    }
  }

  return count;
}

async function main() {
  const demoDbDir = await mkdtemp(path.join(os.tmpdir(), "finance-superbrain-demo-proof-db-"));
  const vaultDir = await mkdtemp(path.join(os.tmpdir(), "finance-superbrain-demo-proof-vault-"));
  const exportRoot = "Finance Superbrain";
  const exportRootPath = path.join(vaultDir, exportRoot);
  const demoEnv = {
    ...process.env,
    REPOSITORY_BACKEND: "pglite",
    PGLITE_DATA_DIR: demoDbDir,
    MARKET_DATA_BACKEND: "mock",
    CHAT_MODEL_BACKEND: "mock",
    AUTH_COOKIE_SECURE: "false",
    HOST: "127.0.0.1",
    PORT: String(apiPort),
    API_URL: apiUrl,
    INTERNAL_API_URL: apiUrl,
    NEXT_PUBLIC_API_URL: apiUrl,
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE || "true",
    NEXT_PUBLIC_DEMO_ADMIN_EMAIL:
      process.env.NEXT_PUBLIC_DEMO_ADMIN_EMAIL || "lead.operator@finance-superbrain.local",
    NEXT_PUBLIC_DEMO_ADMIN_PASSWORD:
      process.env.NEXT_PUBLIC_DEMO_ADMIN_PASSWORD || "workspace-admin-password",
    NEXT_PUBLIC_DEMO_ANALYST_EMAIL:
      process.env.NEXT_PUBLIC_DEMO_ANALYST_EMAIL || "macro.analyst@finance-superbrain.local",
    NEXT_PUBLIC_DEMO_ANALYST_PASSWORD:
      process.env.NEXT_PUBLIC_DEMO_ANALYST_PASSWORD || "workspace-analyst-password",
    OBSIDIAN_VAULT_PATH: vaultDir,
    OBSIDIAN_EXPORT_ROOT: exportRoot,
    FINANCE_SUPERBRAIN_APP_URL: webUrl,
  };

  let apiServer = null;
  let webServer = null;

  try {
    console.log("Building monorepo...");
    await runNpm(["run", "build"], demoEnv);

    console.log("Seeding deterministic demo workspace...");
    await runNpm(["run", "seed:demo-proof"], demoEnv);

    console.log("Validating Obsidian dry-run...");
    await runNpm(["run", "ops:obsidian-export", "--", "--dry-run"], demoEnv);

    console.log("Writing real Obsidian export...");
    await runNpm(["run", "ops:obsidian-export"], demoEnv);

    await access(exportRootPath);
    const noteCount = await countMarkdownFiles(exportRootPath);

    if (noteCount < 6) {
      throw new Error(`Expected managed Obsidian notes, but only found ${noteCount}.`);
    }

    console.log("Starting hosted-like API runtime...");
    apiServer = startServer("api", process.execPath, ["apps/api/dist/index.js"], demoEnv);
    await waitFor(async () => {
      const response = await fetch(`${apiUrl}/health`);
      return response.ok;
    }, "API health");
    await waitFor(async () => {
      const response = await fetch(`${apiUrl}/ready`);
      return response.ok;
    }, "API readiness");

    console.log("Starting hosted-like web runtime...");
    webServer = startServer(
      "web",
      "npm",
      ["--workspace", "@finance-superbrain/web", "run", "start", "--", "--hostname", "127.0.0.1", "--port", String(webPort)],
      demoEnv,
    );

    await waitFor(async () => {
      const { response, text } = await fetchText(`${webUrl}/`);
      return response.ok && text.includes("Finance Superbrain");
    }, "public shell");
    await waitFor(async () => {
      const { response } = await fetchText(`${webUrl}/login`);
      return response.ok;
    }, "login shell");

    const bootstrapResponse = await fetch(`${apiUrl}/v1/auth/bootstrap`);
    const bootstrap = await bootstrapResponse.json();

    if (!bootstrapResponse.ok || bootstrap.bootstrap_required !== false) {
      throw new Error("Hosted-like validation expected a seeded workspace with bootstrap disabled.");
    }

    const loginResponse = await fetch(`${apiUrl}/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: demoEnv.NEXT_PUBLIC_DEMO_ADMIN_EMAIL,
        password: demoEnv.NEXT_PUBLIC_DEMO_ADMIN_PASSWORD,
      }),
    });

    if (!loginResponse.ok) {
      throw new Error(`Hosted-like login failed with status ${loginResponse.status}.`);
    }

    const sessionCookie = extractSessionCookie(loginResponse.headers.getSetCookie?.() ?? []);

    if (!sessionCookie) {
      throw new Error("Hosted-like validation could not extract the auth session cookie.");
    }

    const workspaceStateResponse = await fetch(`${apiUrl}/v1/workspace/state`, {
      headers: {
        Cookie: `finance_superbrain_session=${encodeURIComponent(sessionCookie)}`,
      },
    });

    if (!workspaceStateResponse.ok) {
      throw new Error(`Failed to load seeded workspace state: ${workspaceStateResponse.status}.`);
    }

    const workspaceState = await workspaceStateResponse.json();

    if (!workspaceState.session?.authenticated) {
      throw new Error("Expected the hosted-like validation session to be authenticated.");
    }

    if ((workspaceState.investigations?.length ?? 0) < 1) {
      throw new Error("Expected at least one seeded investigation in hosted-like validation.");
    }

    if ((workspaceState.decision_briefs?.length ?? 0) < 1) {
      throw new Error("Expected at least one seeded decision brief in hosted-like validation.");
    }

    if ((workspaceState.portfolio_candidates?.length ?? 0) < 1) {
      throw new Error("Expected at least one seeded portfolio candidate in hosted-like validation.");
    }

    console.log("");
    console.log("Hosted-like demo proof validation passed.");
    console.log(`API: ${apiUrl}`);
    console.log(`Web: ${webUrl}`);
    console.log(`Obsidian export root: ${exportRootPath}`);
    console.log(`Managed markdown notes: ${noteCount}`);
  } catch (error) {
    console.error("");
    console.error("Hosted-like demo proof validation failed.");

    if (apiServer) {
      console.error("--- API output ---");
      console.error(apiServer.getOutput());
    }

    if (webServer) {
      console.error("--- Web output ---");
      console.error(webServer.getOutput());
    }

    throw error;
  } finally {
    await stopServer(webServer);
    await stopServer(apiServer);
    await rm(demoDbDir, { recursive: true, force: true }).catch(() => undefined);
    await rm(vaultDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
