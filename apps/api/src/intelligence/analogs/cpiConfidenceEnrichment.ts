import type { GeneratedPrediction } from "@finance-superbrain/schemas";

import type { CpiPredictionResult } from "../prediction/cpiPrediction.js";
import type { CpiAnalogMatch } from "./cpiAnalogRetrieval.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * A GeneratedPrediction extended with analog-derived metadata.
 */
export type CpiEnrichedPrediction = GeneratedPrediction & {
  /** How many CPI memory cases influenced this prediction */
  analog_count: number;
  /**
   * Net confidence delta applied by analog calibration.
   * Positive → analogs reinforce the prediction.
   * Negative → analogs warn against it.
   * Zero   → no analogs or mixed signal.
   */
  analog_boost: number;
};

/**
 * A CpiPredictionResult where every prediction has been enriched with
 * analog signals and the full analog set is attached for traceability.
 */
export type CpiEnrichedPredictionResult = Omit<CpiPredictionResult, "predictions"> & {
  predictions: CpiEnrichedPrediction[];
  analogs: CpiAnalogMatch[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const round = (v: number) => Number(v.toFixed(2));
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Compute a net confidence delta from the analog set.
 *
 * Logic:
 *  - Reinforcements (correct verdicts) push confidence up.
 *  - Mistakes (wrong verdicts) push it down.
 *  - Effect is scaled by average similarity so high-similarity analogs matter more.
 *  - Maximum possible swing is ±0.10 to stay narrow and CPI-specific.
 */
const computeAnalogBoost = (analogs: CpiAnalogMatch[]): number => {
  if (!analogs.length) return 0;

  const reinforcements = analogs.filter((a) => a.verdict === "correct").length;
  const mistakes = analogs.filter((a) => a.verdict === "wrong").length;
  const avgSimilarity =
    analogs.reduce((sum, a) => sum + a.similarity, 0) / analogs.length;

  // net signal: +1 per reinforcement, -1 per mistake, normalised by count
  const netSignal = (reinforcements - mistakes) / analogs.length;

  return round(clamp(netSignal * avgSimilarity * 0.12, -0.10, 0.10));
};

/** One-line evidence note summarising the analog set. */
const buildAnalogEvidenceLine = (analogs: CpiAnalogMatch[]): string => {
  const correct = analogs.filter((a) => a.verdict === "correct").length;
  const wrong = analogs.filter((a) => a.verdict === "wrong").length;
  const partial = analogs.filter((a) => a.verdict === "partially_correct").length;

  const top = analogs[0]!;

  return (
    `${analogs.length} CPI analog(s): ${correct} correct, ${partial} partial, ` +
    `${wrong} wrong. Top match: ${top.period} (similarity ${top.similarity}).`
  );
};

/** Cautionary invalidation from the most similar wrong analog, if any. */
const buildCautionLine = (analogs: CpiAnalogMatch[]): string | null => {
  const topWrong = analogs.find((a) => a.verdict === "wrong");
  return topWrong
    ? `Analog caution (${topWrong.period}): ${topWrong.lesson_summary}`
    : null;
};

const appendBounded = (lines: string[], line: string, max: number): string[] => {
  if (lines.includes(line)) return lines.slice(0, max);
  if (lines.length < max) return [...lines, line];
  return [...lines.slice(0, max - 1), line];
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Enrich a CpiPredictionResult with signals from retrieved CPI analogs.
 *
 * For each prediction:
 *  1. Compute a net confidence boost / penalty from the analog verdicts.
 *  2. Append an analog evidence line to the prediction's `evidence` array.
 *  3. If any wrong analog exists, prepend a caution note to `invalidations`.
 *  4. Attach `analog_count` and `analog_boost` as metadata fields.
 *
 * The original `CpiPredictionResult` is never mutated.
 * All confidence values stay within [0.35, 0.95].
 */
export const enrichCpiPredictionWithAnalogs = (
  result: CpiPredictionResult,
  analogs: CpiAnalogMatch[],
): CpiEnrichedPredictionResult => {
  const boost = computeAnalogBoost(analogs);
  const evidenceLine = analogs.length ? buildAnalogEvidenceLine(analogs) : null;
  const cautionLine = analogs.length ? buildCautionLine(analogs) : null;

  const enrichedPredictions: CpiEnrichedPrediction[] = result.predictions.map(
    (pred: GeneratedPrediction) => {
      const newConfidence = analogs.length
        ? round(clamp(pred.confidence + boost, 0.35, 0.95))
        : pred.confidence;

      const evidence = evidenceLine
        ? appendBounded([...pred.evidence], evidenceLine, 5)
        : [...pred.evidence];

      const invalidations = cautionLine
        ? appendBounded([...pred.invalidations], cautionLine, 4)
        : [...pred.invalidations];

      return {
        ...pred,
        confidence: newConfidence,
        evidence,
        invalidations,
        analog_count: analogs.length,
        analog_boost: analogs.length ? boost : 0,
      };
    },
  );

  return {
    ...result,
    predictions: enrichedPredictions,
    analogs,
  };
};
