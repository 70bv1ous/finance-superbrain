/**
 * EVALUATION HARNESS — Renaissance-style statistical scoring engine
 *
 * Responsibilities:
 *   1. Score individual evaluation predictions against oracle outcomes
 *      (direction accuracy per ticker, overall accuracy for a prediction)
 *   2. Aggregate scored predictions into a statistical report:
 *      - Overall accuracy + confidence-stratified accuracy
 *      - Brier score (calibration metric)
 *      - Bonferroni-corrected binomial p-value against random-chance baseline
 *      - Domain breakdown with per-domain p-values
 *   3. Apply event-cluster de-duplication (via contaminationAudit.ts) so
 *      that one real-world event cannot inflate accuracy by being scored
 *      multiple times from different domain perspectives
 *
 * Statistical methodology:
 *   H₀: accuracy ≤ 0.50 (indistinguishable from coin flip)
 *   H₁: accuracy > 0.50
 *   Test: one-tailed binomial exact test
 *   Threshold: Bonferroni-corrected α = 0.05 / 13 = 0.00385
 *     (13 hypotheses: 1 aggregate + 12 domain-level)
 *
 * Brier score:
 *   B = (1/n) Σ (confidence_p − outcome)²
 *   where confidence_p maps "high"→0.85, "medium"→0.65, "low"→0.50
 *   and outcome is 1 for correct, 0 for incorrect.
 *   Random baseline: 0.25 (confidence always 0.50).
 *   Perfect: 0.0.
 */

import { BONFERRONI_ALPHA } from "./caseSplitRegistry.js";
import {
  deduplicateClusters,
  getContaminationForCase,
} from "./contaminationAudit.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/** A single ticker prediction with its oracle outcome. */
export interface TickerPrediction {
  ticker: string;
  predicted_direction: "up" | "down" | "mixed" | "flat" | "unknown";
  magnitude_bp_est?: number;
}

/** Oracle ground-truth for a single ticker. */
export interface TickerOutcome {
  ticker: string;
  realized_direction: "up" | "down" | "mixed" | "flat" | "unknown";
  realized_magnitude_bp?: number;
}

/**
 * A stored evaluation prediction — matches the DB schema for
 * evaluation_predictions. We work with a subset of the columns here.
 */
export interface EvalPrediction {
  id: string;
  oracle_case_id: string | null;
  domain: string | null;
  eval_split: "validation" | "test";
  confidence_level: "high" | "medium" | "low";
  /** Top-level directional call from the brain's answer text. Used as fallback scorer. */
  predicted_direction?: "up" | "down" | "mixed" | "flat" | "unknown";
  predicted_tickers: TickerPrediction[];
  oracle_realized_moves: TickerOutcome[] | null;
  direction_accuracy: number | null;
  is_correct: boolean | null;
  is_scored: boolean;
  /** ISO timestamp of when the prediction was created. Used to keep latest on re-runs. */
  created_at?: string;
}

export interface ScoredPrediction extends EvalPrediction {
  direction_accuracy: number;
  tickers_scored: number;
  is_correct: boolean;
}

export interface DomainReport {
  domain: string;
  n: number;
  n_correct: number;
  accuracy: number;
  /** One-tailed binomial p-value (H₀: p ≤ 0.5). */
  p_value: number;
  /** TRUE if p_value < BONFERRONI_ALPHA (0.00385). */
  is_significant: boolean;
  /** Domain tests with n < 10 are directional-only (explicitly underpowered). */
  is_powered: boolean;
}

export interface EvaluationReport {
  eval_split:            "validation" | "test";
  split_version:         string;

  // ── Counts ────────────────────────────────────────────────────────────────
  n_predictions:         number;
  n_scored:              number;
  /** After cluster de-duplication: number of independent events. */
  n_independent_events:  number;
  n_contaminated:        number;

  // ── Primary metrics (on independent events) ───────────────────────────────
  overall_accuracy:      number;
  high_conf_accuracy:    number | null;
  medium_conf_accuracy:  number | null;
  low_conf_accuracy:     number | null;

  // ── Calibration ───────────────────────────────────────────────────────────
  /** Brier score over independent events. Lower = better. 0.25 = random. */
  brier_score:           number;

  // ── Statistical significance ──────────────────────────────────────────────
  aggregate_p_value:     number;
  bonferroni_threshold:  number;
  is_statistically_significant: boolean;
  /** FALSE if n_independent_events < 48 (underpowered at 70% acc, 80% power). */
  aggregate_powered:     boolean;

  // ── Domain breakdown ──────────────────────────────────────────────────────
  domain_breakdown:      DomainReport[];

  // ── Calibration curve ─────────────────────────────────────────────────────
  /** [{bin, n, accuracy}] for confidence bins: high/medium/low */
  calibration_curve:     Array<{ bin: string; n: number; accuracy: number }>;

  created_at:            string;
}

// ─── Confidence → probability mapping ────────────────────────────────────────

const CONFIDENCE_PROB: Record<"high" | "medium" | "low", number> = {
  high:   0.85,
  medium: 0.65,
  low:    0.50,
};

// ─── Aggregate direction derivation ──────────────────────────────────────────

/**
 * Derives a single aggregate direction from a set of oracle ticker outcomes.
 * Used as a fallback when per-ticker matching produces zero scored tickers.
 *
 * Rules:
 *   - Ignore "unknown" and "flat" outcomes
 *   - If >60% of remaining outcomes are "up" → "up"
 *   - If >60% are "down" → "down"
 *   - Otherwise → "mixed"
 */
export function deriveAggregateDirection(
  outcomes: TickerOutcome[],
): "up" | "down" | "mixed" | "unknown" {
  const dirs = outcomes
    .map((o) => o.realized_direction)
    .filter((d): d is "up" | "down" | "mixed" => d !== "unknown" && d !== "flat");

  if (dirs.length === 0) return "unknown";

  const ups   = dirs.filter((d) => d === "up").length;
  const downs = dirs.filter((d) => d === "down").length;

  if (ups + downs === 0) return "mixed";
  if (ups / dirs.length > 0.6)   return "up";
  if (downs / dirs.length > 0.6) return "down";
  return "mixed";
}

// ─── Direction match logic ────────────────────────────────────────────────────

/**
 * Returns TRUE if a predicted direction matches the oracle realized direction.
 * Strict equality — used for per-ticker matching only.
 */
export function directionMatches(
  predicted: TickerPrediction["predicted_direction"],
  oracle:    TickerOutcome["realized_direction"],
): boolean {
  if (predicted === "unknown") return false;
  return predicted === oracle;
}

/**
 * Scores a predicted direction against an aggregate oracle direction.
 *
 * Returns a value in [0, 1]:
 *   1.0  — exact directional match (up/up, down/down, mixed/mixed)
 *   0.5  — partial credit: one side is "mixed" and the other is directional
 *           (brain said "up", oracle was "mixed", or vice versa — the brain
 *            identified the dominant direction but the oracle had conflicting moves)
 *   0.0  — directional conflict (up vs down, or either side is "unknown")
 *
 * Rationale for 0.5 on mixed:
 *   Many real events produce mixed asset reactions (e.g. gold up, equities down).
 *   A prediction of "up" against a mixed oracle is not wrong about the dominant
 *   direction — it just failed to call the counter-move. Penalising it as zero
 *   is too harsh; treating it as correct is too lenient. 0.5 is the right middle.
 */
export function aggregateDirectionScore(
  predicted: "up" | "down" | "mixed" | "flat" | "unknown",
  oracle:    "up" | "down" | "mixed" | "unknown",
): number {
  if (predicted === "unknown" || oracle === "unknown") return 0.0;
  if (predicted === oracle) return 1.0;
  if (predicted === "mixed" || oracle === "mixed")     return 0.5;
  // directional conflict: up vs down or down vs up
  return 0.0;
}

// ─── Score a single prediction ────────────────────────────────────────────────

/**
 * Scores a single EvalPrediction against its oracle outcome.
 *
 * Scoring strategy (in priority order):
 *
 *   1. AGGREGATE DIRECTION (primary):
 *      If the prediction has a known predicted_direction and the oracle outcomes
 *      have a derivable aggregate direction, score at the aggregate level using
 *      aggregateDirectionScore(). This is the primary accuracy metric because:
 *        - It is robust to ticker naming differences between brain and oracle
 *        - It correctly handles "mixed" predictions with partial credit
 *        - It measures the thing that actually matters: did the brain get the
 *          overall market direction right?
 *
 *   2. PER-TICKER MATCHING (fallback):
 *      When predicted_direction is "unknown" (brain gave no directional call),
 *      attempt per-ticker matching. If named tickers overlap with oracle tickers,
 *      use their direction accuracy as the score.
 *
 *   3. ZERO (no signal):
 *      If neither method can produce a score (unknown direction, no ticker matches),
 *      the prediction scores 0 — it provided no useful directional information.
 *
 * is_correct is defined as direction_accuracy >= 0.5.
 *
 * @returns ScoredPrediction with direction_accuracy, tickers_scored, is_correct filled in.
 */
export function scorePrediction(
  prediction: EvalPrediction,
  oracleOutcomes: TickerOutcome[],
): ScoredPrediction {

  const predDir     = prediction.predicted_direction;
  const oracleAgg   = deriveAggregateDirection(oracleOutcomes);

  // ── Path 1: Aggregate direction scoring (primary) ──────────────────────────
  if (predDir && predDir !== "unknown" && oracleAgg !== "unknown") {
    const direction_accuracy = aggregateDirectionScore(predDir, oracleAgg);
    return {
      ...prediction,
      oracle_realized_moves: oracleOutcomes,
      direction_accuracy,
      tickers_scored:        1, // 1 aggregate event scored
      is_correct:            direction_accuracy >= 0.5,
      is_scored:             true,
    };
  }

  // ── Path 2: Per-ticker matching (fallback when direction is unknown) ────────
  const oracleMap = new Map<string, TickerOutcome["realized_direction"]>(
    oracleOutcomes.map((o) => [o.ticker.toUpperCase(), o.realized_direction]),
  );

  let matched = 0;
  let correct = 0;

  for (const tp of (prediction.predicted_tickers ?? [])) {
    const oracle = oracleMap.get(tp.ticker.toUpperCase());
    if (oracle === undefined) continue;
    matched++;
    if (directionMatches(tp.predicted_direction, oracle)) correct++;
  }

  if (matched > 0) {
    const direction_accuracy = correct / matched;
    return {
      ...prediction,
      oracle_realized_moves: oracleOutcomes,
      direction_accuracy,
      tickers_scored: matched,
      is_correct:     direction_accuracy >= 0.5,
      is_scored:      true,
    };
  }

  // ── Path 3: No scorable signal ─────────────────────────────────────────────
  return {
    ...prediction,
    oracle_realized_moves: oracleOutcomes,
    direction_accuracy:    0,
    tickers_scored:        0,
    is_correct:            false,
    is_scored:             true,
  };
}

// ─── Binomial p-value (exact, one-tailed) ────────────────────────────────────

/**
 * Computes the exact one-tailed binomial p-value:
 *   P(X >= k | n, p₀ = 0.50)
 *
 * This tests H₀: accuracy ≤ 0.50 against H₁: accuracy > 0.50.
 *
 * Uses the exact binomial sum rather than a normal approximation because
 * domain-level n can be small (4–8 cases).
 *
 * For n > ~150 and large k this can be slow due to bigint-style iteration,
 * but our evaluation sets are at most ~48 cases, so this is fine.
 */
export function binomialPValue(k: number, n: number, p0 = 0.5): number {
  if (n <= 0) return 1.0;
  if (k <= 0) return 1.0;

  // P(X >= k | n, p0) = sum_{x=k}^{n} C(n,x) * p0^x * (1-p0)^(n-x)
  // For p0 = 0.5: P(X >= k | n, 0.5) = sum_{x=k}^{n} C(n,x) / 2^n
  let pValue = 0;
  const log2n = n * Math.log(2); // log(2^n)

  for (let x = k; x <= n; x++) {
    pValue += Math.exp(logBinom(n, x) - log2n);
  }

  return Math.min(pValue, 1.0);
}

/** log(C(n, k)) — log of binomial coefficient, numerically stable. */
function logBinom(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  if (k === 0 || k === n) return 0;
  // Use log-gamma via Stirling / sum of logs
  let result = 0;
  for (let i = 0; i < Math.min(k, n - k); i++) {
    result += Math.log(n - i) - Math.log(i + 1);
  }
  return result;
}

// ─── Brier score ──────────────────────────────────────────────────────────────

/**
 * Computes the Brier score over a set of scored predictions.
 *
 * B = (1/n) Σ (p_forecast − o_outcome)²
 *
 * where p_forecast = CONFIDENCE_PROB[confidence_level]
 * and   o_outcome  = 1 if is_correct else 0
 *
 * Baseline (always predict 0.50): B = 0.25
 * Perfect forecast: B = 0.0
 */
export function computeBrierScore(predictions: ScoredPrediction[]): number {
  if (predictions.length === 0) return 0.25;

  const sum = predictions.reduce((acc, p) => {
    const forecast = CONFIDENCE_PROB[p.confidence_level];
    const outcome  = p.is_correct ? 1 : 0;
    return acc + (forecast - outcome) ** 2;
  }, 0);

  return sum / predictions.length;
}

// ─── De-duplication by oracle case (re-run safety) ───────────────────────────

/**
 * When the batch evaluation is re-run, multiple predictions are stored for the
 * same oracle_case_id (each with a new UUID). This function collapses them to
 * a single prediction per oracle case — keeping the most recently created one.
 *
 * This makes the eval report idempotent across re-runs: re-running the batch
 * eval simply overwrites the previous results for each case, rather than
 * counting the same event multiple times and inflating the sample size.
 *
 * Predictions without an oracle_case_id (ad-hoc predictions) are kept as-is.
 */
export function deduplicateByOracleCase(
  predictions: ScoredPrediction[],
): ScoredPrediction[] {
  const byCase = new Map<string, ScoredPrediction>();

  for (const p of predictions) {
    if (!p.oracle_case_id) continue; // no oracle key — handled separately
    const existing = byCase.get(p.oracle_case_id);
    if (!existing) {
      byCase.set(p.oracle_case_id, p);
    } else {
      // Keep the most recently created prediction (latest re-run wins)
      const newDate      = p.created_at ?? "";
      const existingDate = existing.created_at ?? "";
      if (newDate > existingDate) byCase.set(p.oracle_case_id, p);
    }
  }

  // Keep ad-hoc predictions (no oracle_case_id) as-is
  const adHoc = predictions.filter((p) => !p.oracle_case_id);

  return [...byCase.values(), ...adHoc];
}

// ─── De-duplication by event cluster ─────────────────────────────────────────

/**
 * Applies event-cluster de-duplication to a list of scored predictions.
 *
 * When multiple predictions reference cases from the same real-world event
 * cluster (e.g. Aug 2024 BOJ carry unwind appeared in 6 test cases), we
 * collapse them to a single representative prediction to avoid inflating
 * accuracy. The canonical case ID is used as the representative.
 *
 * For non-clustered predictions, they are included as-is.
 *
 * @returns { deduplicated, removed_count }
 */
export function deduplicatePredictions(
  predictions: ScoredPrediction[],
): { deduplicated: ScoredPrediction[]; removed_count: number } {
  const caseIds = predictions
    .map((p) => p.oracle_case_id)
    .filter((id): id is string => id !== null);

  // deduplicateClusters returns the canonical (representative) case_id for each
  // cluster — one per event cluster — as a flat string[]. Non-clustered IDs pass
  // through unchanged. Any caseId NOT in the returned list is a duplicate that
  // should be collapsed.
  const canonicalIds  = deduplicateClusters(caseIds);
  const canonicalSet  = new Set(canonicalIds);
  const removed_count = predictions.length - canonicalSet.size;

  const deduplicated = predictions.filter(
    (p) => !p.oracle_case_id || canonicalSet.has(p.oracle_case_id),
  );

  return {
    deduplicated,
    removed_count: Math.max(0, removed_count),
  };
}

// ─── Aggregate report ─────────────────────────────────────────────────────────

/**
 * Builds a full statistical evaluation report from a list of scored predictions.
 *
 * Steps:
 *   1. Filter to only scored predictions
 *   2. Apply cluster de-duplication for independent-event accuracy
 *   3. Compute overall accuracy + confidence-stratified accuracy
 *   4. Compute Brier score (calibration)
 *   5. Compute aggregate Bonferroni-corrected binomial p-value
 *   6. Compute per-domain breakdown with per-domain p-values
 *   7. Flag contaminated predictions
 *
 * @param evalSplit   Which split these predictions are for ("validation"|"test")
 * @param splitVersion  Always "v1" for the frozen split
 */
export function buildEvaluationReport(
  allPredictions: EvalPrediction[],
  evalSplit: "validation" | "test",
  splitVersion: string = "v1",
): EvaluationReport {

  const scored = allPredictions.filter(
    (p): p is ScoredPrediction => p.is_scored && p.direction_accuracy !== null,
  ) as ScoredPrediction[];

  // ── Deduplicate by oracle_case_id (keep latest per case across re-runs) ───
  // This makes the report idempotent: re-running the batch eval replaces
  // previous scores for each case rather than double-counting them.
  const latestPerCase = deduplicateByOracleCase(scored);

  // ── Count contaminated predictions ────────────────────────────────────────
  const n_contaminated = latestPerCase.filter((p) => {
    if (!p.oracle_case_id) return false;
    const c = getContaminationForCase(p.oracle_case_id);
    return c.length > 0;
  }).length;

  // ── De-duplicate event clusters ────────────────────────────────────────────
  // Input is latestPerCase (already deduplicated by oracle_case_id), so cluster
  // dedup collapses cases that represent the SAME real-world event (e.g. BOJ
  // carry unwind documented across 6 domain perspectives).
  const { deduplicated, removed_count } = deduplicatePredictions(latestPerCase);
  const n = deduplicated.length;

  // ── Overall accuracy ──────────────────────────────────────────────────────
  const n_correct        = deduplicated.filter((p) => p.is_correct).length;
  const overall_accuracy = n > 0 ? n_correct / n : 0;

  // ── Confidence-stratified accuracy ────────────────────────────────────────
  const byConf = (conf: "high" | "medium" | "low") => {
    const group = deduplicated.filter((p) => p.confidence_level === conf);
    if (group.length === 0) return null;
    return group.filter((p) => p.is_correct).length / group.length;
  };

  const high_conf_accuracy   = byConf("high");
  const medium_conf_accuracy = byConf("medium");
  const low_conf_accuracy    = byConf("low");

  // ── Brier score ───────────────────────────────────────────────────────────
  const brier_score = computeBrierScore(deduplicated);

  // ── Aggregate p-value ─────────────────────────────────────────────────────
  const aggregate_p_value = binomialPValue(n_correct, n, 0.5);
  const is_statistically_significant = aggregate_p_value < BONFERRONI_ALPHA;
  const aggregate_powered = n >= 48;

  // ── Domain breakdown ──────────────────────────────────────────────────────
  const domainMap = new Map<string, ScoredPrediction[]>();
  for (const p of deduplicated) {
    const domain = p.domain ?? "unknown";
    if (!domainMap.has(domain)) domainMap.set(domain, []);
    domainMap.get(domain)!.push(p);
  }

  const domain_breakdown: DomainReport[] = [...domainMap.entries()].map(
    ([domain, preds]) => {
      const dn        = preds.length;
      const dn_correct = preds.filter((p) => p.is_correct).length;
      const accuracy  = dn > 0 ? dn_correct / dn : 0;
      const p_value   = binomialPValue(dn_correct, dn, 0.5);

      return {
        domain,
        n:              dn,
        n_correct:      dn_correct,
        accuracy,
        p_value,
        is_significant: p_value < BONFERRONI_ALPHA,
        // Domain tests with < 10 cases are directional-only — explicitly underpowered
        is_powered:     dn >= 10,
      };
    },
  ).sort((a, b) => b.n - a.n);

  // ── Calibration curve ─────────────────────────────────────────────────────
  const calibration_curve: EvaluationReport["calibration_curve"] = [
    { bin: "high",   ...calibrationBin(deduplicated, "high")   },
    { bin: "medium", ...calibrationBin(deduplicated, "medium") },
    { bin: "low",    ...calibrationBin(deduplicated, "low")    },
  ];

  return {
    eval_split:            evalSplit,
    split_version:         splitVersion,

    n_predictions:         allPredictions.length,
    n_scored:              latestPerCase.length,
    n_independent_events:  n,
    n_contaminated,

    overall_accuracy,
    high_conf_accuracy,
    medium_conf_accuracy,
    low_conf_accuracy,

    brier_score,

    aggregate_p_value,
    bonferroni_threshold:  BONFERRONI_ALPHA,
    is_statistically_significant,
    aggregate_powered,

    domain_breakdown,
    calibration_curve,

    created_at: new Date().toISOString(),
  };
}

// ─── Calibration bin helper ───────────────────────────────────────────────────

function calibrationBin(
  predictions: ScoredPrediction[],
  bin: "high" | "medium" | "low",
): { n: number; accuracy: number } {
  const group = predictions.filter((p) => p.confidence_level === bin);
  if (group.length === 0) return { n: 0, accuracy: 0 };
  return {
    n:        group.length,
    accuracy: group.filter((p) => p.is_correct).length / group.length,
  };
}

// ─── Walk-forward summary ─────────────────────────────────────────────────────

/**
 * Returns accuracy over time bucketed by occurred_at quarter.
 * Useful for detecting performance drift across the test window.
 *
 * @param predictions  Scored predictions with oracle_occurred_at filled in
 */
export function walkForwardAccuracy(
  predictions: ScoredPrediction[],
  oracleDates: Map<string, string>, // prediction.id → occurred_at ISO string
): Array<{ quarter: string; n: number; accuracy: number }> {
  const buckets = new Map<string, { n: number; correct: number }>();

  for (const p of predictions) {
    const dateStr = oracleDates.get(p.id);
    if (!dateStr) continue;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) continue;
    const quarter = `${d.getUTCFullYear()}-Q${Math.ceil((d.getUTCMonth() + 1) / 3)}`;
    const b = buckets.get(quarter) ?? { n: 0, correct: 0 };
    b.n++;
    if (p.is_correct) b.correct++;
    buckets.set(quarter, b);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([quarter, { n, correct }]) => ({
      quarter,
      n,
      accuracy: n > 0 ? correct / n : 0,
    }));
}
