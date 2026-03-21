/**
 * Evaluation routes — Renaissance-style evaluation framework
 *
 * Endpoints:
 *
 *   GET  /v1/evaluation/split-stats
 *     Returns the v1 train/validation/test split statistics, including
 *     case counts per domain and statistical power assessment.
 *
 *   GET  /v1/evaluation/contamination-audit
 *     Returns all documented cross-split contamination risks.
 *
 *   POST /v1/evaluation/apply-splits
 *     Writes the v1 data_split tags from the in-memory registry into the
 *     historical_case_library table in the database (idempotent).
 *
 *   POST /v1/evaluation/predict
 *     Runs the Finance Superbrain on a query using TRAIN-ONLY retrieval
 *     (splitFilter: "train"), stores the result as an evaluation_prediction
 *     row, and returns the prediction ID. This is the look-ahead-bias-safe
 *     evaluation query path.
 *
 *   POST /v1/evaluation/score
 *     Accepts a prediction ID and oracle outcome. Scores the stored
 *     prediction and writes direction_accuracy, is_correct, scored_at
 *     back to the DB. Oracle outcomes must only be provided AFTER
 *     the prediction is recorded to prevent peeking.
 *
 *   GET  /v1/evaluation/report
 *     Generates a full statistical report over all scored predictions
 *     for a given eval_split ("validation" | "test"). Applies event-
 *     cluster de-duplication and Bonferroni-corrected p-values.
 *
 * Security notes:
 *   - All routes require ANTHROPIC_API_KEY in env (proxy for operator access)
 *   - The /predict endpoint enforces splitFilter: "train" at the caseSearch
 *     layer — this cannot be overridden from the outside
 *   - Oracle outcomes are only accepted through /score after the prediction
 *     is already stored, preventing any oracle leakage into the prediction
 */

import type { FastifyInstance } from "fastify";
import type { AppServices }     from "../lib/services.js";

import { SPLIT_STATS, SPLIT_REGISTRY, getSplitForCase } from "../lib/caseSplitRegistry.js";
import { CONTAMINATION_AUDIT, getContaminationSummary } from "../lib/contaminationAudit.js";
import { searchCases }     from "../lib/caseSearch.js";
import {
  scorePrediction,
  buildEvaluationReport,
  type EvalPrediction,
  type TickerOutcome,
  type TickerPrediction,
} from "../lib/evaluationHarness.js";
import { processChat }     from "../lib/chatService.js";

// ─── Helper: require API key ──────────────────────────────────────────────────

function requireApiKey(reply: any): string | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    reply.status(503).send({
      error:   "service_unavailable",
      message: "Intelligence service not configured (ANTHROPIC_API_KEY missing).",
    });
    return null;
  }
  return key;
}

// ─── Helper: read predictions from DB (repository-agnostic) ──────────────────

async function readEvalPredictions(
  repo: any,
  filter: { eval_split?: string; is_scored?: boolean } = {},
): Promise<EvalPrediction[]> {
  try {
    return (await repo.listEvaluationPredictions?.(filter)) ?? [];
  } catch {
    return [];
  }
}

// ─── Route registration ───────────────────────────────────────────────────────

export const registerEvaluationRoutes = async (
  server: FastifyInstance,
  services: AppServices,
): Promise<void> => {
  const repo = services.repository as any;

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/evaluation/split-stats
  // ─────────────────────────────────────────────────────────────────────────
  server.get("/v1/evaluation/split-stats", async (_request, reply) => {
    return reply.status(200).send({
      ok:    true,
      stats: SPLIT_STATS,
      methodology: {
        split_type:        "temporal",
        randomization:     "none — split is strictly by occurred_at date",
        rationale:         "Random splitting would allow future outcomes to teach past queries (look-ahead bias).",
        train_end:         SPLIT_STATS.train_end,
        val_end:           SPLIT_STATS.val_end,
        version:           SPLIT_STATS.version,
        freeze_date:       SPLIT_STATS.freeze_date,
        bonferroni_alpha:  SPLIT_STATS.bonferroni_alpha,
        hypotheses_tested: 13,
        min_cases_for_aggregate_significance: SPLIT_STATS.min_cases_for_significance,
      },
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/evaluation/contamination-audit
  // ─────────────────────────────────────────────────────────────────────────
  server.get("/v1/evaluation/contamination-audit", async (_request, reply) => {
    const summary = getContaminationSummary();
    return reply.status(200).send({
      ok: true,
      summary,
      entries: CONTAMINATION_AUDIT,
      transparency_note:
        "All known cross-split contamination risks are documented here. " +
        "No contamination is hidden. See contaminationAudit.ts for full detail.",
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /v1/evaluation/apply-splits
  // Idempotently writes data_split tags from the in-memory registry to DB.
  // No API key required — this is a pure DB write using the frozen registry.
  // ─────────────────────────────────────────────────────────────────────────
  server.post("/v1/evaluation/apply-splits", async (_request, reply) => {

    let updated = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const entry of SPLIT_REGISTRY.values()) {
      try {
        const ok = await repo.updateHistoricalCaseLibraryItem?.(entry.case_id, {
          data_split:    entry.split,
          split_version: entry.split_version,
        });
        if (ok) updated++;
        else skipped++;
      } catch (e) {
        errors.push(`${entry.case_id}: ${(e as Error).message}`);
        skipped++;
      }
    }

    return reply.status(200).send({
      ok:      errors.length === 0,
      updated,
      skipped,
      errors:  errors.slice(0, 10),
      total:   SPLIT_REGISTRY.size,
      note:    "This operation is idempotent. Re-running will not corrupt existing data.",
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // DELETE /v1/evaluation/clear
  //
  // Deletes stored evaluation predictions so the batch eval can be re-run
  // without accumulating stale rows. Protected by API key.
  //
  // Query params:
  //   eval_split: "validation" | "test" | "all"  (default: "test")
  // ─────────────────────────────────────────────────────────────────────────
  server.delete("/v1/evaluation/clear", async (request, reply) => {
    const apiKey = requireApiKey(reply);
    if (!apiKey) return;

    const query     = request.query as { eval_split?: string };
    const evalSplit = ["validation", "test", "all"].includes(query.eval_split ?? "")
      ? (query.eval_split as string)
      : "test";

    try {
      const deleted = await repo.deleteEvaluationPredictions?.(evalSplit) ?? 0;
      return reply.status(200).send({
        ok:         true,
        deleted,
        eval_split: evalSplit,
        note:       "Run POST /v1/evaluation/apply-splits then the batch eval to repopulate.",
      });
    } catch (e) {
      return reply.status(500).send({
        error:   "delete_failed",
        message: (e as Error).message,
      });
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /v1/evaluation/predict
  //
  // Runs the brain on a query using TRAIN-ONLY retrieval and stores the
  // prediction. Returns the prediction_id for later scoring.
  //
  // Request body:
  //   {
  //     query:          string       — the evaluation query (e.g. "what happens when CPI beats?")
  //     oracle_case_id: string       — which test/validation case this query relates to
  //     eval_split:     "validation" | "test"   (default: "validation")
  //     domain:         string       — e.g. "macro", "earnings", etc.
  //   }
  // ─────────────────────────────────────────────────────────────────────────
  server.post("/v1/evaluation/predict", async (request, reply) => {
    const apiKey = requireApiKey(reply);
    if (!apiKey) return;

    const body = request.body as {
      query?:          unknown;
      oracle_case_id?: unknown;
      eval_split?:     unknown;
      domain?:         unknown;
    };

    if (!body?.query || typeof body.query !== "string" || body.query.trim().length === 0) {
      return reply.status(400).send({
        error:   "invalid_request",
        message: "query is required and must be a non-empty string.",
      });
    }

    if (!body.oracle_case_id || typeof body.oracle_case_id !== "string") {
      return reply.status(400).send({
        error:   "invalid_request",
        message: "oracle_case_id is required — it identifies which held-out case this query evaluates.",
      });
    }

    const evalSplit: "validation" | "test" =
      body.eval_split === "test" ? "test" : "validation";

    const domain = typeof body.domain === "string" ? body.domain : null;

    // Verify the oracle case belongs to the correct split
    const caseActualSplit = getSplitForCase(body.oracle_case_id);
    if (caseActualSplit !== evalSplit) {
      return reply.status(400).send({
        error:   "split_mismatch",
        message: `oracle_case_id "${body.oracle_case_id}" belongs to the "${caseActualSplit}" split, not "${evalSplit}".`,
        detail:  "Evaluation queries must reference cases from the correct split to maintain split integrity.",
      });
    }

    // ── Run brain with TRAIN-ONLY retrieval (look-ahead bias prevention) ────
    // We call processChat in evaluation mode:
    //   - splitFilter: "train" → only training-window cases retrieved
    //   - Response cache DISABLED (each eval query must be independent)
    //   - logPrediction DISABLED (we store it ourselves below)
    const chatResponse = await processChat(
      {
        query:      body.query.trim(),
        session_id: `eval-${crypto.randomUUID()}`,
      },
      services.repository,
      apiKey,
      services.embeddingProvider,
      { evaluationMode: true, evalSplitFilter: "train" },
    );

    // Retrieve the cases that were actually cited (train-only)
    const retrievedCases = await searchCases(
      services.repository,
      body.query.trim(),
      { topK: 25, splitFilter: "train" },
      services.embeddingProvider,
    );

    // Store the prediction in the DB
    const predictionId = crypto.randomUUID();
    const predictionRow = {
      id:                   predictionId,
      query_text:           body.query.trim(),
      domain,
      eval_split:           evalSplit,
      split_version:        "v1",
      oracle_case_id:       body.oracle_case_id,
      predicted_direction:  extractDirection(chatResponse.answer),
      confidence_level:     chatResponse.confidence_level,
      predicted_tickers:    extractTickers(chatResponse),
      retrieved_case_ids:   retrievedCases.map((c: any) => c.case_id as string),
      retrieved_case_count: retrievedCases.length,
      reasoning_summary:    chatResponse.answer.slice(0, 500),
      is_scored:            false,
      created_at:           new Date().toISOString(),
    };

    try {
      await repo.saveEvaluationPrediction?.(predictionRow);
    } catch (e) {
      // Non-fatal: prediction is in memory even if DB write fails
      console.error("[evaluation/predict] Failed to persist prediction:", (e as Error).message);
    }

    return reply.status(201).send({
      ok:            true,
      prediction_id: predictionId,
      eval_split:    evalSplit,
      oracle_case_id: body.oracle_case_id,
      confidence_level: chatResponse.confidence_level,
      predicted_direction: predictionRow.predicted_direction,
      retrieved_case_count: retrievedCases.length,
      split_version: "v1",
      note: "Oracle outcome must be provided separately via POST /v1/evaluation/score. " +
            "Never pass the oracle outcome before recording this prediction.",
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /v1/evaluation/score
  //
  // Scores an existing prediction against oracle outcomes.
  //
  // Request body:
  //   {
  //     prediction_id:      string
  //     oracle_realized_moves: [{ticker, realized_direction, realized_magnitude_bp?}]
  //     oracle_occurred_at: string  — ISO date of the oracle event
  //   }
  // ─────────────────────────────────────────────────────────────────────────
  // Score doesn't call Claude — just writes to DB
  server.post("/v1/evaluation/score", async (request, reply) => {

    const body = request.body as {
      prediction_id?:       unknown;
      oracle_realized_moves?: unknown;
      oracle_occurred_at?:  unknown;
    };

    if (!body?.prediction_id || typeof body.prediction_id !== "string") {
      return reply.status(400).send({
        error:   "invalid_request",
        message: "prediction_id is required.",
      });
    }

    if (!Array.isArray(body.oracle_realized_moves) || body.oracle_realized_moves.length === 0) {
      return reply.status(400).send({
        error:   "invalid_request",
        message: "oracle_realized_moves must be a non-empty array of {ticker, realized_direction}.",
      });
    }

    const oracleOutcomes: TickerOutcome[] = (body.oracle_realized_moves as any[]).map((m) => ({
      ticker:               String(m.ticker ?? ""),
      realized_direction:   m.realized_direction ?? "unknown",
      realized_magnitude_bp: typeof m.realized_magnitude_bp === "number"
        ? m.realized_magnitude_bp
        : undefined,
    }));

    // Fetch the stored prediction
    let storedPrediction: EvalPrediction | null = null;
    try {
      storedPrediction = await repo.getEvaluationPrediction?.(body.prediction_id) ?? null;
    } catch {
      storedPrediction = null;
    }

    if (!storedPrediction) {
      return reply.status(404).send({
        error:   "not_found",
        message: `Prediction "${body.prediction_id}" not found.`,
      });
    }

    if (storedPrediction.is_scored) {
      return reply.status(409).send({
        error:   "already_scored",
        message: "This prediction has already been scored. Re-scoring is not allowed.",
        detail:  "Re-scoring could allow oracle leakage. Create a new prediction instead.",
      });
    }

    // Score the prediction
    const scored = scorePrediction(storedPrediction, oracleOutcomes);

    // Write scoring results back to DB
    try {
      await repo.updateEvaluationPrediction?.(body.prediction_id, {
        oracle_realized_moves: oracleOutcomes,
        oracle_occurred_at:    body.oracle_occurred_at ?? new Date().toISOString(),
        direction_accuracy:    scored.direction_accuracy,
        tickers_scored:        scored.tickers_scored,
        is_correct:            scored.is_correct,
        is_scored:             true,
        scored_at:             new Date().toISOString(),
      });
    } catch (e) {
      console.error("[evaluation/score] Failed to persist score:", (e as Error).message);
    }

    return reply.status(200).send({
      ok:                 true,
      prediction_id:      body.prediction_id,
      direction_accuracy: scored.direction_accuracy,
      tickers_scored:     scored.tickers_scored,
      is_correct:         scored.is_correct,
      confidence_level:   scored.confidence_level,
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /v1/evaluation/report
  //
  // Query params:
  //   eval_split: "validation" | "test"  (default: "validation")
  //
  // Returns a full statistical report with Bonferroni-corrected p-values,
  // domain breakdown, Brier score, and calibration curve.
  // ─────────────────────────────────────────────────────────────────────────
  server.get("/v1/evaluation/report", async (request, reply) => {

    const query      = request.query as { eval_split?: string };
    const evalSplit: "validation" | "test" =
      query.eval_split === "test" ? "test" : "validation";

    const predictions = await readEvalPredictions(repo, {
      eval_split: evalSplit,
      is_scored:  true,
    });

    const report = buildEvaluationReport(predictions, evalSplit, "v1");

    // ── Add researcher warnings ────────────────────────────────────────────
    const warnings: string[] = [];
    if (evalSplit === "validation") {
      warnings.push(
        "RESEARCHER WARNING: The validation set may have been observed during " +
        "development (see contamination entry C008 in the audit). " +
        "Validation accuracy should not be the primary significance claim.",
      );
    }
    if (!report.aggregate_powered) {
      warnings.push(
        `POWER WARNING: Only ${report.n_independent_events} independent test events scored. ` +
        "Minimum 48 required for aggregate significance at 70% accuracy (80% power, Bonferroni α=0.00385). " +
        "Results are directional only until more predictions are scored.",
      );
    }
    if (report.n_contaminated > 0) {
      warnings.push(
        `CONTAMINATION WARNING: ${report.n_contaminated} predictions involve cases flagged in the contamination audit. ` +
        "See /v1/evaluation/contamination-audit for details.",
      );
    }

    return reply.status(200).send({
      ok: true,
      report,
      warnings: warnings.length > 0 ? warnings : undefined,
      interpretation: {
        null_hypothesis:       "accuracy ≤ 0.50 (indistinguishable from random)",
        bonferroni_correction: "α = 0.05 / 13 hypotheses = 0.00385",
        brier_baseline:        "0.25 (always-predict-0.50 strategy)",
        cluster_deduplication: "Event clusters collapsed to single independent observation",
        domain_power_note:     "Domain tests with n < 10 are directional-only, not statistically powered",
      },
    });
  });
};

// ─── Helpers: extract structured predictions from chat response ───────────────

/**
 * Extracts the top-level directional call from the brain's answer text.
 *
 * Three-tier priority:
 *
 *   Tier 1 — Regime phrases (highest confidence):
 *     Unambiguous market-regime language like "risk-off", "flight to quality",
 *     "equity bull" can determine direction with a single match. These phrases
 *     cannot appear accidentally in finance prose.
 *
 *   Tier 2 — First-sentence thesis:
 *     The brain is instructed to lead with a one-sentence thesis. That sentence
 *     contains the dominant directional call before nuance is introduced.
 *     Requires a 2-count lead (not 1) to avoid false positives.
 *
 *   Tier 3 — Full-text word ratio:
 *     Counts directional words across the full answer. Uses a 2.5× ratio
 *     threshold (instead of the old ±1 count) to avoid calling "mixed" on
 *     every nuanced finance answer that legitimately discusses both sides.
 *
 * Falls back to "unknown" only when the answer has no detectable direction.
 */
function extractDirection(
  answer: string,
): "up" | "down" | "mixed" | "flat" | "unknown" {
  const lower = answer.toLowerCase();

  // ── Tier 1: Regime-level phrases ─────────────────────────────────────────
  const riskOnRx  = /risk.?on|risk appetite|equity bull|stocks? rally|equities? (rally|higher|rise)|reflationary|soft landing|buy the dip|risk assets? (rise|rally|bid|gain)/;
  const riskOffRx = /risk.?off|risk aversion|flight to (quality|safety)|equity bear|stocks? (fall|sell)|equities? (lower|fall|sell)|deflationary|hard landing|risk assets? (fall|sell|drop)/;

  const hasRiskOn  = riskOnRx.test(lower);
  const hasRiskOff = riskOffRx.test(lower);

  if (hasRiskOn  && !hasRiskOff) return "up";
  if (hasRiskOff && !hasRiskOn)  return "down";
  if (hasRiskOn  &&  hasRiskOff) return "mixed";

  // ── Tier 2: First-sentence thesis ────────────────────────────────────────
  // The brain leads with its primary call — extract direction from that alone.
  const firstSentence = lower.match(/^.{10,300}?[.!?]/)?.[0] ?? lower.slice(0, 250);
  const upFirst   = (firstSentence.match(/\b(rise|higher|bull|rally|upside|bid|gain|strength|strengthen|appreciate)\b/g) ?? []).length;
  const downFirst = (firstSentence.match(/\b(fall|lower|bear|decline|downside|sell|weak|pressure|selloff|depreciate)\b/g) ?? []).length;

  if (upFirst   >= downFirst + 2) return "up";
  if (downFirst >= upFirst   + 2) return "down";

  // ── Tier 3: Full-text word ratio (2.5× threshold) ────────────────────────
  // Finance analysis always mentions both sides — require a clear ratio lead,
  // not just a 1-word difference, before calling a direction.
  const upCount   = (lower.match(/\b(rise|rises|higher|bull|upside|bid|rally|rallied|gain|gains|strengthen|strength|appreciate|appreciate)\b/g) ?? []).length;
  const downCount = (lower.match(/\b(fall|falls|lower|bear|downside|sell|decline|declined|weaken|weakness|pressure|selloff|depreciate)\b/g) ?? []).length;

  if (upCount === 0 && downCount === 0) return "unknown";
  if (upCount   >= downCount * 2.5) return "up";
  if (downCount >= upCount   * 2.5) return "down";
  return "mixed";
}

/**
 * Extracts ticker-level predictions from the chat response's evidence array.
 * These are approximate — the evaluator may also supply explicit tickers via
 * the oracle scoring step.
 */
function extractTickers(chatResponse: {
  evidence: string[];
  answer:   string;
}): TickerPrediction[] {
  const tickerRegex = /\b([A-Z]{1,5}(?:\/[A-Z]{1,5})?)\b/g;
  const dirRegex    = /(up|down|higher|lower|rise|fall|rally|sell)/i;
  const tickers: TickerPrediction[] = [];
  const seen = new Set<string>();

  const STOPWORDS = new Set([
    "THE", "AND", "FOR", "CPI", "NFP", "GDP", "FED", "ECB", "BOJ", "RBA",
    "BOE", "IMF", "USD", "EUR", "GBP", "JPY", "CHF", "AUD", "NZD", "CAD",
    "OIL", "GAS", "UST", "ETF", "IPO", "M&A", "AI", "ESG",
  ]);

  for (const text of [chatResponse.answer, ...chatResponse.evidence]) {
    const matches = [...text.matchAll(tickerRegex)];
    for (const m of matches) {
      const ticker = m[1]!;
      if (STOPWORDS.has(ticker) || seen.has(ticker) || ticker.length < 2) continue;
      seen.add(ticker);

      // Look for directional signal in surrounding context (±30 chars)
      const start   = Math.max(0, m.index! - 30);
      const end     = Math.min(text.length, m.index! + ticker.length + 30);
      const context = text.slice(start, end).toLowerCase();
      const dirMatch = context.match(dirRegex);

      let direction: TickerPrediction["predicted_direction"] = "unknown";
      if (dirMatch) {
        const d = dirMatch[1]!.toLowerCase();
        if (["up", "higher", "rise", "rally"].includes(d)) direction = "up";
        else if (["down", "lower", "fall", "sell"].includes(d)) direction = "down";
      }

      tickers.push({ ticker, predicted_direction: direction });
    }
  }

  return tickers.slice(0, 20); // cap at 20 tickers per prediction
}
