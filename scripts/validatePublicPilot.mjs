const DEFAULT_WEB_URL = "https://finance-superbrain-web.vercel.app";
const DEFAULT_ADMIN_EMAIL = "lead.operator@finance-superbrain.local";
const DEFAULT_ADMIN_PASSWORD = "workspace-admin-password";
const EXPECTED_INVESTIGATION_ID = "demo-investigation-cpi-discipline";
const EXPECTED_DECISION_BRIEF_ID = "demo-decision-cpi-discipline";
const EXPECTED_PORTFOLIO_CANDIDATE_ID = "demo-portfolio-cpi-discipline";

function readArg(name) {
  const prefix = `--${name}=`;
  const value = process.argv.find((arg) => arg.startsWith(prefix));
  return value ? value.slice(prefix.length).trim() : "";
}

function normalizeBaseUrl(value, label) {
  const trimmed = value.trim().replace(/\/+$/, "");

  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }

  return trimmed;
}

function readConfig() {
  return {
    webUrl: normalizeBaseUrl(
      readArg("web-url") || process.env.PUBLIC_PILOT_WEB_URL || DEFAULT_WEB_URL,
      "PUBLIC_PILOT_WEB_URL",
    ),
    apiUrl: normalizeBaseUrl(
      readArg("api-url") || process.env.PUBLIC_PILOT_API_URL || process.env.NEXT_PUBLIC_API_URL || "",
      "PUBLIC_PILOT_API_URL",
    ),
    email: readArg("email") || process.env.PUBLIC_PILOT_EMAIL || process.env.NEXT_PUBLIC_DEMO_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL,
    password:
      readArg("password") ||
      process.env.PUBLIC_PILOT_PASSWORD ||
      process.env.NEXT_PUBLIC_DEMO_ADMIN_PASSWORD ||
      DEFAULT_ADMIN_PASSWORD,
  };
}

async function fetchText(url, init) {
  const response = await fetch(url, init);
  const text = await response.text();
  return { response, text };
}

async function fetchJson(url, init) {
  const { response, text } = await fetchText(url, init);
  let payload = null;

  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Expected JSON from ${url}, received: ${text.slice(0, 160)}`);
  }

  return { response, payload, text };
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getSetCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }

  const header = response.headers.get("set-cookie");
  return header ? [header] : [];
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

async function assertOk(label, check) {
  const attempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const detail = await check();
      const retryDetail = attempt > 1 ? ` after ${attempt} attempts` : "";
      console.log(`PASS ${label}${detail ? `: ${detail}` : ""}${retryDetail}`);
      return;
    } catch (error) {
      lastError = error;

      if (attempt < attempts) {
        await sleep(2_000);
      }
    }
  }

  console.error(`FAIL ${label}`);
  throw lastError;
}

function hasId(items, id) {
  return Array.isArray(items) && items.some((item) => item?.id === id);
}

function requireSeededWorkspace(payload) {
  const investigationCount = Array.isArray(payload.investigations) ? payload.investigations.length : 0;
  const decisionCount = Array.isArray(payload.decision_briefs) ? payload.decision_briefs.length : 0;
  const portfolioCount = Array.isArray(payload.portfolio_candidates) ? payload.portfolio_candidates.length : 0;

  if (investigationCount < 1 || decisionCount < 1 || portfolioCount < 1) {
    throw new Error(
      `Expected seeded workspace data, got investigations=${investigationCount}, decisions=${decisionCount}, portfolio=${portfolioCount}.`,
    );
  }

  if (!hasId(payload.investigations, EXPECTED_INVESTIGATION_ID)) {
    throw new Error(`Expected seeded investigation ${EXPECTED_INVESTIGATION_ID}.`);
  }

  if (!hasId(payload.decision_briefs, EXPECTED_DECISION_BRIEF_ID)) {
    throw new Error(`Expected seeded decision brief ${EXPECTED_DECISION_BRIEF_ID}.`);
  }

  if (!hasId(payload.portfolio_candidates, EXPECTED_PORTFOLIO_CANDIDATE_ID)) {
    throw new Error(`Expected seeded portfolio candidate ${EXPECTED_PORTFOLIO_CANDIDATE_ID}.`);
  }

  return { investigationCount, decisionCount, portfolioCount };
}

async function assertOkWithoutRetry(label, check) {
  try {
    const detail = await check();
    console.log(`PASS ${label}${detail ? `: ${detail}` : ""}`);
  } catch (error) {
    console.error(`FAIL ${label}`);
    throw error;
  }
}

async function main() {
  const config = readConfig();
  console.log("Public pilot smoke validation");
  console.log(`Web: ${config.webUrl}`);
  console.log(`API: ${config.apiUrl}`);

  await assertOk("public shell", async () => {
    const { response, text } = await fetchText(config.webUrl);

    if (!response.ok || !text.includes("Finance Superbrain")) {
      throw new Error(`Expected public shell to return Finance Superbrain, got HTTP ${response.status}.`);
    }

    return `HTTP ${response.status}`;
  });

  await assertOk("login page", async () => {
    const { response, text } = await fetchText(`${config.webUrl}/login`);

    if (!response.ok || !text.includes("finance-superbrain-api-url")) {
      throw new Error(`Expected login page to include API bootstrap metadata, got HTTP ${response.status}.`);
    }

    return `HTTP ${response.status}`;
  });

  await assertOk("api health", async () => {
    const { response, payload } = await fetchJson(`${config.apiUrl}/health`);

    if (!response.ok || payload?.ok === false) {
      throw new Error(`Expected healthy API, got HTTP ${response.status}: ${JSON.stringify(payload)}`);
    }

    return `HTTP ${response.status}`;
  });

  await assertOk("api readiness", async () => {
    const { response, payload } = await fetchJson(`${config.apiUrl}/ready`);

    if (!response.ok || payload?.ok === false) {
      throw new Error(`Expected ready API, got HTTP ${response.status}: ${JSON.stringify(payload)}`);
    }

    return `HTTP ${response.status}`;
  });

  await assertOk("workspace bootstrap", async () => {
    const { response, payload } = await fetchJson(`${config.apiUrl}/v1/auth/bootstrap`, {
      headers: {
        Origin: config.webUrl,
      },
    });

    if (!response.ok || typeof payload?.bootstrap_required !== "boolean") {
      throw new Error(`Expected bootstrap state, got HTTP ${response.status}: ${JSON.stringify(payload)}`);
    }

    return `bootstrap_required=${payload.bootstrap_required}`;
  });

  let sessionCookie = "";
  await assertOkWithoutRetry("seeded account login", async () => {
    const { response, payload } = await fetchJson(`${config.apiUrl}/v1/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: config.webUrl,
      },
      body: JSON.stringify({
        email: config.email,
        password: config.password,
      }),
    });
    const setCookieHeaders = getSetCookieHeaders(response);
    const joinedCookies = setCookieHeaders.join("; ");

    if (!response.ok || payload?.authenticated !== true) {
      throw new Error(`Expected authenticated login, got HTTP ${response.status}: ${JSON.stringify(payload)}`);
    }

    if (!joinedCookies.includes("SameSite=None") || !joinedCookies.includes("Secure")) {
      throw new Error(`Expected hosted auth cookie to include SameSite=None and Secure, got: ${joinedCookies}`);
    }

    sessionCookie = extractSessionCookie(setCookieHeaders) || "";

    if (!sessionCookie) {
      throw new Error("Login did not return finance_superbrain_session cookie.");
    }

    return payload.user?.email || config.email;
  });

  await assertOk("authenticated workspace state", async () => {
    const { response, payload } = await fetchJson(`${config.apiUrl}/v1/workspace/state`, {
      headers: {
        Cookie: `finance_superbrain_session=${encodeURIComponent(sessionCookie)}`,
        Origin: config.webUrl,
      },
    });

    if (!response.ok || payload?.session?.authenticated !== true) {
      throw new Error(`Expected authenticated workspace state, got HTTP ${response.status}: ${JSON.stringify(payload)}`);
    }

    const { investigationCount, decisionCount, portfolioCount } = requireSeededWorkspace(payload);

    return `investigations=${investigationCount}, decisions=${decisionCount}, portfolio=${portfolioCount}, seeded_ids=present`;
  });

  console.log("Public pilot smoke validation passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
