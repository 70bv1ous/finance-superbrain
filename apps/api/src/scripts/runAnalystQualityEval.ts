import { GUIDED_DEMO_PROMPTS } from "@finance-superbrain/schemas";

import { processChat } from "../lib/chatService.js";
import { buildServices } from "../lib/services.js";

const pad = (value: string, length: number) =>
  value.length >= length ? value.slice(0, length) : value + " ".repeat(length - value.length);

const yesNo = (value: boolean) => (value ? "yes" : "no");

function containsExpectedThemes(response: Awaited<ReturnType<typeof processChat>>, requiredThemes: string[]) {
  if (requiredThemes.length === 0) {
    return true;
  }

  const haystack = [response.answer, ...response.evidence, ...response.limits, ...response.risks]
    .join(" ")
    .toLowerCase();

  return requiredThemes.every((theme) => haystack.includes(theme.replace(/_/g, " ")));
}

function containsExpectedAssets(response: Awaited<ReturnType<typeof processChat>>, expectedAssets: typeof GUIDED_DEMO_PROMPTS[number]["expectation"]["expected_assets"]) {
  if (expectedAssets.length === 0) {
    return true;
  }

  return expectedAssets.every((expectedAsset) =>
    response.affected_assets.some((asset) => asset.ticker === expectedAsset.ticker),
  );
}

function containsExpectedDirections(response: Awaited<ReturnType<typeof processChat>>, expectedAssets: typeof GUIDED_DEMO_PROMPTS[number]["expectation"]["expected_assets"]) {
  const directionalChecks = expectedAssets.filter((asset) => asset.direction);

  if (directionalChecks.length === 0) {
    return true;
  }

  return directionalChecks.every((expectedAsset) =>
    response.affected_assets.some(
      (asset) => asset.ticker === expectedAsset.ticker && asset.direction === expectedAsset.direction,
    ),
  );
}

function isSpecificEnough(response: Awaited<ReturnType<typeof processChat>>) {
  const text = response.answer.toLowerCase();

  return (
    response.answer.trim().length >= 80 &&
    !text.includes("it depends entirely") &&
    !text.includes("cannot say anything useful") &&
    !text.includes("no real view")
  );
}

async function main() {
  let totalChecks = 0;
  let passedChecks = 0;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const services = buildServices();

  console.log(`\n${"=".repeat(96)}`);
  console.log("FINANCE SUPERBRAIN - GUIDED INTELLIGENCE PROOF EVAL");
  console.log(`${"=".repeat(96)}\n`);
  console.log(apiKey ? "mode: live llm\n" : "mode: mock proof fallback (no ANTHROPIC_API_KEY detected)\n");

  try {
    for (const prompt of GUIDED_DEMO_PROMPTS) {
      const response = await processChat(
        { query: prompt.prompt },
        services.repository,
        apiKey,
        services.embeddingProvider,
      );

      const themePass = containsExpectedThemes(response, prompt.expectation.required_themes);
      const assetPass = containsExpectedAssets(response, prompt.expectation.expected_assets);
      const directionPass = containsExpectedDirections(response, prompt.expectation.expected_assets);
      const evidencePass = response.evidence.length >= prompt.expectation.min_evidence_points;
      const limitsPass = !prompt.expectation.requires_limits || response.limits.length > 0;
      const risksPass = !prompt.expectation.requires_risks || response.risks.length > 0;
      const specificityPass = isSpecificEnough(response);

      const checks = [
        ["themes", themePass],
        ["assets", assetPass],
        ["directions", directionPass],
        ["evidence", evidencePass],
        ["limits", limitsPass],
        ["risks", risksPass],
        ["specificity", specificityPass],
      ] as const;

      totalChecks += checks.length;
      passedChecks += checks.filter(([, passed]) => passed).length;

      console.log(`${pad(prompt.id, 28)} ${prompt.label}`);
      console.log(`  category:   ${prompt.category}`);
      console.log(`  proof:      ${prompt.proof_goal}`);
      console.log(`  answer:     ${response.answer}`);
      console.log(`  evidence:   ${response.evidence.join(" | ") || "(none)"}`);
      console.log(`  limits:     ${response.limits.join(" | ") || "(none)"}`);
      console.log(
        `  assets:     ${response.affected_assets.map((asset) => `${asset.ticker}:${asset.direction}`).join(", ") || "(none)"}`,
      );
      console.log(
        `  checks:     ${checks.map(([label, passed]) => `${label}=${yesNo(passed)}`).join("  ")}`,
      );
      console.log("");
    }
  } finally {
    await services.marketDataProvider.close?.();
    await services.embeddingProvider.close?.();
    await services.repository.close?.();
  }

  const score = totalChecks ? passedChecks / totalChecks : 0;

  console.log(`${"-".repeat(96)}`);
  console.log(`score: ${passedChecks}/${totalChecks} checks passed (${(score * 100).toFixed(1)}%)`);
  console.log(`${"-".repeat(96)}\n`);

  process.exit(score < 0.9 ? 1 : 0);
}

void main();
