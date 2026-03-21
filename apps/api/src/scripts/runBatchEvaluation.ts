/**
 * BATCH EVALUATION RUNNER — Renaissance-style full test-set evaluation
 *
 * Iterates over all test-split cases, runs the Finance Superbrain on each
 * with TRAIN-ONLY retrieval (look-ahead bias prevention), scores against
 * the oracle realized_moves, then prints a full statistical report.
 *
 * Usage:
 *   npx tsx src/scripts/runBatchEvaluation.ts [--split validation|test] [--dry-run]
 *
 * Options:
 *   --split validation|test   Which split to evaluate (default: test)
 *   --dry-run                 Print cases without calling the API
 *   --clear                   Delete existing predictions for the split before running (fresh start)
 *   --base-url URL            API base URL (default: http://localhost:3099)
 */

import { SPLIT_REGISTRY }                    from "../lib/caseSplitRegistry.js";
import { MACRO_HISTORICAL_LOADER_CASES }      from "../data/macroHistoricalLoaderCases.js";
import { EARNINGS_HISTORICAL_LOADER_CASES }   from "../data/earningsHistoricalLoaderCases.js";
import { POLICY_HISTORICAL_LOADER_CASES }     from "../data/policyHistoricalLoaderCases.js";
import { ENERGY_HISTORICAL_LOADER_CASES }     from "../data/energyHistoricalLoaderCases.js";
import { CREDIT_HISTORICAL_LOADER_CASES }     from "../data/creditHistoricalLoaderCases.js";
import { CRYPTO_HISTORICAL_LOADER_CASES }     from "../data/cryptoHistoricalLoaderCases.js";
import { CHINA_HISTORICAL_LOADER_CASES }      from "../data/chinaHistoricalLoaderCases.js";
import { COMMODITIES_HISTORICAL_LOADER_CASES } from "../data/commoditiesHistoricalLoaderCases.js";
import { GEOPOLITICAL_HISTORICAL_LOADER_CASES } from "../data/geopoliticalHistoricalLoaderCases.js";
import { VOLATILITY_HISTORICAL_LOADER_CASES } from "../data/volatilityHistoricalLoaderCases.js";
import { REAL_ESTATE_HOUSING_HISTORICAL_LOADER_CASES } from "../data/realEstateHousingHistoricalLoaderCases.js";
import { SOVEREIGN_DEBT_HISTORICAL_LOADER_CASES } from "../data/sovereignDebtHistoricalLoaderCases.js";

// ─── CLI args ─────────────────────────────────────────────────────────────────

const args       = process.argv.slice(2);
const splitArg   = args.includes("--split") ? args[args.indexOf("--split") + 1] : "test";
const evalSplit  = (splitArg === "validation" ? "validation" : "test") as "validation" | "test";
const dryRun     = args.includes("--dry-run");
const clearFirst = args.includes("--clear");
const baseUrlArg = args.includes("--base-url") ? args[args.indexOf("--base-url") + 1] : undefined;
const BASE_URL   = baseUrlArg ?? process.env["API_BASE_URL"] ?? "http://localhost:3099";

// ─── Build lookup map: case_id → full case data ───────────────────────────────

const ALL_CASES: Array<Record<string, any>> = [
  ...MACRO_HISTORICAL_LOADER_CASES      as any[],
  ...EARNINGS_HISTORICAL_LOADER_CASES   as any[],
  ...POLICY_HISTORICAL_LOADER_CASES     as any[],
  ...ENERGY_HISTORICAL_LOADER_CASES     as any[],
  ...CREDIT_HISTORICAL_LOADER_CASES     as any[],
  ...CRYPTO_HISTORICAL_LOADER_CASES     as any[],
  ...CHINA_HISTORICAL_LOADER_CASES      as any[],
  ...COMMODITIES_HISTORICAL_LOADER_CASES as any[],
  ...GEOPOLITICAL_HISTORICAL_LOADER_CASES as any[],
  ...VOLATILITY_HISTORICAL_LOADER_CASES as any[],
  ...REAL_ESTATE_HOUSING_HISTORICAL_LOADER_CASES as any[],
  ...SOVEREIGN_DEBT_HISTORICAL_LOADER_CASES as any[],
];

const CASE_MAP = new Map<string, Record<string, any>>(
  ALL_CASES.map((c) => [c.case_id as string, c]),
);

// ─── Get test cases from the frozen registry ──────────────────────────────────

const TARGET_CASES = [...SPLIT_REGISTRY.values()]
  .filter((e) => e.split === evalSplit)
  .sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Builds a forward-looking evaluation query from a case's metadata.
 *
 * Priority order:
 *   1. title      — e.g. "Iran launches 300+ drones at Israel — first direct attack"
 *                   This is the best source: it describes the event setup without
 *                   any outcome language. The brain must predict what happens next.
 *
 *   2. event_type + signal_bias — structured fallback that produces a standard
 *                   question format: "CPI came in hotter than expected. What happens
 *                   to markets?" Avoids any outcome contamination.
 *
 *   3. case_id slug — last resort. Converts the case_id to a readable question.
 *
 * What we deliberately do NOT use:
 *   - summary: describes outcomes in past tense ("yields moved higher because...")
 *   - dominant_catalyst: opaque slug, not useful as a natural language query
 *   - realized_moves: that IS the answer — never use this as the query
 */
function buildQuery(caseData: Record<string, any>): string {
  // 1. title field — forward-looking event description (best)
  const title = caseData["title"] as string | undefined;
  if (title?.trim()) {
    return `${title.trim()}. Given this setup, what do you expect to happen to markets?`;
  }

  // 2. event_type + signal_bias — structured natural language fallback
  const eventType  = (caseData["event_type"]  as string | undefined)?.replace(/_/g, " ");
  const signalBias = (caseData["signal_bias"] as string | undefined)?.replace(/_/g, " ");
  if (eventType && signalBias) {
    return `${eventType} just came in ${signalBias}. What do you expect to happen to markets?`;
  }
  if (eventType) {
    return `A ${eventType} event just occurred. What do you expect to happen to markets?`;
  }

  // 3. case_id slug — absolute last resort
  const slug = (caseData["case_id"] as string | undefined)?.replace(/-/g, " ") ?? "this event";
  return `What happens when ${slug}?`;
}

async function apiDelete(path: string): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`DELETE ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function apiPost(path: string, body: unknown): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`POST ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

async function apiGet(path: string): Promise<any> {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GET ${path} → ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n${"═".repeat(70)}`);
  console.log(`  FINANCE SUPERBRAIN — BATCH EVALUATION`);
  console.log(`  Split: ${evalSplit.toUpperCase()} (v1)    Cases: ${TARGET_CASES.length}`);
  console.log(`  Mode:  ${dryRun ? "DRY RUN (no API calls)" : "LIVE"}`);
  console.log(`  API:   ${BASE_URL}`);
  console.log(`${"═".repeat(70)}\n`);

  if (TARGET_CASES.length === 0) {
    console.error("No cases found for split:", evalSplit);
    process.exit(1);
  }

  // ── Optional clear: delete existing predictions before this run ────────────
  // This ensures the report reflects only this run's predictions, not a mix
  // of old and new scores. The deduplication in buildEvaluationReport also
  // handles this gracefully, but clearing is cleaner for a fresh run.
  if (clearFirst) {
    console.log(`  Clearing existing ${evalSplit} predictions...`);
    try {
      const clearRes = await apiDelete(`/v1/evaluation/clear?eval_split=${evalSplit}`);
      console.log(`  Cleared ${clearRes.deleted ?? 0} old predictions.\n`);
    } catch (e) {
      console.warn(`  Warning: could not clear old predictions: ${(e as Error).message}`);
      console.warn("  Continuing — deduplication will use the latest prediction per case.\n");
    }
  }

  // ── Dry-run: just show cases ───────────────────────────────────────────────
  if (dryRun) {
    console.log(`${"─".repeat(70)}`);
    console.log(pad("CASE ID", 45) + pad("DOMAIN", 20) + "DATE");
    console.log(`${"─".repeat(70)}`);
    for (const entry of TARGET_CASES) {
      const caseData  = CASE_MAP.get(entry.case_id);
      const dateShort = entry.occurred_at.slice(0, 10);
      console.log(
        pad(entry.case_id, 45) +
        pad(entry.domain, 20) +
        dateShort +
        (caseData ? "" : "  ⚠ NO DATA"),
      );
    }
    console.log(`\nTotal: ${TARGET_CASES.length} cases`);
    console.log("Run without --dry-run to execute evaluation.");
    return;
  }

  // ── Live run ───────────────────────────────────────────────────────────────
  const results: Array<{
    case_id:          string;
    domain:           string;
    prediction_id:    string | null;
    predicted_dir:    string;
    confidence:       string;
    is_correct:       boolean | null;
    direction_acc:    number | null;
    error:            string | null;
  }> = [];

  let passed = 0;
  let failed = 0;
  let errored = 0;

  for (let i = 0; i < TARGET_CASES.length; i++) {
    const entry    = TARGET_CASES[i]!;
    const caseData = CASE_MAP.get(entry.case_id);
    const idx      = `[${String(i + 1).padStart(2)}/${TARGET_CASES.length}]`;

    if (!caseData) {
      console.warn(`${idx} ⚠  SKIP  ${entry.case_id}  (no case data found)`);
      results.push({
        case_id: entry.case_id, domain: entry.domain,
        prediction_id: null, predicted_dir: "?", confidence: "?",
        is_correct: null, direction_acc: null,
        error: "case data not found in data files",
      });
      errored++;
      continue;
    }

    const oracleMoves = caseData["realized_moves"] as Array<{
      ticker: string;
      realized_direction: string;
    }> | undefined;

    if (!oracleMoves || oracleMoves.length === 0) {
      console.warn(`${idx} ⚠  SKIP  ${entry.case_id}  (no realized_moves)`);
      results.push({
        case_id: entry.case_id, domain: entry.domain,
        prediction_id: null, predicted_dir: "?", confidence: "?",
        is_correct: null, direction_acc: null,
        error: "no oracle realized_moves",
      });
      errored++;
      continue;
    }

    const query = buildQuery(caseData);
    process.stdout.write(`${idx} ${pad(entry.case_id, 42)}`);

    try {
      // Step 1: predict (brain sees TRAIN only)
      const predictRes = await apiPost("/v1/evaluation/predict", {
        query,
        oracle_case_id: entry.case_id,
        eval_split:     evalSplit,
        domain:         entry.domain,
      });

      if (!predictRes.ok || !predictRes.prediction_id) {
        throw new Error(`predict returned !ok: ${JSON.stringify(predictRes).slice(0, 100)}`);
      }

      const predId  = predictRes.prediction_id as string;
      const predDir = predictRes.predicted_direction as string ?? "?";
      const conf    = predictRes.confidence_level as string ?? "?";

      // Step 2: score against oracle
      const scoreRes = await apiPost("/v1/evaluation/score", {
        prediction_id:        predId,
        oracle_realized_moves: oracleMoves,
        oracle_occurred_at:   entry.occurred_at,
      });

      const isCorrect  = scoreRes.is_correct as boolean;
      const dirAcc     = scoreRes.direction_accuracy as number;

      if (isCorrect) passed++; else failed++;

      const marker = isCorrect ? "✓" : "✗";
      console.log(` ${marker}  dir=${pad(predDir, 5)}  conf=${pad(conf, 6)}  acc=${pct(dirAcc)}`);

      results.push({
        case_id: entry.case_id, domain: entry.domain,
        prediction_id: predId, predicted_dir: predDir, confidence: conf,
        is_correct: isCorrect, direction_acc: dirAcc, error: null,
      });

    } catch (err) {
      console.log(` ✗  ERROR: ${(err as Error).message.slice(0, 50)}`);
      results.push({
        case_id: entry.case_id, domain: entry.domain,
        prediction_id: null, predicted_dir: "?", confidence: "?",
        is_correct: null, direction_acc: null,
        error: (err as Error).message,
      });
      errored++;
    }

    // Small delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 300));
  }

  // ── Summary table ──────────────────────────────────────────────────────────
  console.log(`\n${"═".repeat(70)}`);
  console.log("  QUICK RESULTS");
  console.log(`${"═".repeat(70)}`);
  console.log(`  Scored:   ${passed + failed} / ${TARGET_CASES.length}`);
  console.log(`  Correct:  ${passed}`);
  console.log(`  Wrong:    ${failed}`);
  console.log(`  Errored:  ${errored}`);
  const rawAcc = (passed + failed) > 0 ? passed / (passed + failed) : 0;
  console.log(`  Accuracy: ${pct(rawAcc)}  (pre-deduplication)`);

  // ── Fetch and print the full statistical report ────────────────────────────
  console.log(`\n${"═".repeat(70)}`);
  console.log("  STATISTICAL REPORT (from API)");
  console.log(`${"═".repeat(70)}`);
  try {
    const reportRes = await apiGet(`/v1/evaluation/report?eval_split=${evalSplit}`);
    const r = reportRes.report;

    console.log(`\n  Overall accuracy (independent events): ${pct(r.overall_accuracy)}  (n=${r.n_independent_events})`);
    if (r.high_conf_accuracy   !== null) console.log(`  High confidence accuracy:  ${pct(r.high_conf_accuracy)}`);
    if (r.medium_conf_accuracy !== null) console.log(`  Medium confidence accuracy:${pct(r.medium_conf_accuracy)}`);
    if (r.low_conf_accuracy    !== null) console.log(`  Low confidence accuracy:   ${pct(r.low_conf_accuracy)}`);
    console.log(`\n  Brier score:     ${r.brier_score.toFixed(4)}  (random baseline = 0.25, perfect = 0.0)`);
    console.log(`  p-value:         ${r.aggregate_p_value.toExponential(3)}`);
    console.log(`  Bonferroni α:    ${r.bonferroni_threshold.toFixed(5)}`);
    console.log(`  Significant:     ${r.is_statistically_significant ? "YES ✓" : "NO (need more data)"}`);
    console.log(`  Powered:         ${r.aggregate_powered ? "YES" : `NO (need ${48 - r.n_independent_events} more)`}`);

    if (r.n_contaminated > 0) {
      console.log(`\n  ⚠  Contaminated predictions: ${r.n_contaminated} — see /v1/evaluation/contamination-audit`);
    }

    if (r.domain_breakdown?.length > 0) {
      console.log(`\n  DOMAIN BREAKDOWN:`);
      console.log(`  ${"─".repeat(60)}`);
      console.log(`  ${pad("DOMAIN", 22)} ${pad("N", 5)} ${pad("CORRECT", 8)} ${pad("ACC", 8)} POWERED`);
      console.log(`  ${"─".repeat(60)}`);
      for (const d of r.domain_breakdown) {
        const powered = d.is_powered ? "yes" : "no (n<10)";
        console.log(
          `  ${pad(d.domain, 22)} ${pad(String(d.n), 5)} ${pad(String(d.n_correct), 8)} ${pad(pct(d.accuracy), 8)} ${powered}`
        );
      }
    }

    if (reportRes.warnings?.length > 0) {
      console.log(`\n  WARNINGS:`);
      for (const w of reportRes.warnings) {
        console.log(`  ⚠  ${w}`);
      }
    }
  } catch (err) {
    console.error("  Could not fetch report:", (err as Error).message);
  }

  console.log(`\n${"═".repeat(70)}\n`);

  // Exit with error code if accuracy is worse than chance
  process.exit(errored > TARGET_CASES.length / 2 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
