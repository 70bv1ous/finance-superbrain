import type { GeneratedPrediction } from "@finance-superbrain/schemas";

import type { FomcPredictionResult } from "../prediction/fomcPrediction.js";
import type { FomcAnalogMatch } from "./fomcAnalogRetrieval.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FomcEnrichedPrediction = GeneratedPrediction & {
  analog_count: number;
  analog_boost: number;
};

export type FomcEnrichedPredictionResult = Omit<FomcPredictionResult, "predictions"> & {
  predictions: FomcEnrichedPrediction[];
  analogs: FomcAnalogMatch[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const round = (v: number) => Number(v.toFixed(2));
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Compute a net confidence delta from the FOMC analog set.
 * Logic mirrors CPI: reinforcements push confidence up, mistakes push down,
 * scaled by average similarity.  Maximum swing is ±0.10.
 */
const computeAnalogBoost = (analogs: FomcAnalogMatch[]): number => {
  if (!analogs.length) return 0;

  const reinforcements = analogs.filter((a) => a.verdict === "correct").length;
  const mistakes = analogs.filter((a) => a.verdict === "wrong").length;
  const avgSimilarity =
    analogs.reduce((sum, a) => sum + a.similarity, 0) / analogs.length;

  const netSignal = (reinforcements - mistakes) / analogs.length;
  return round(clamp(netSignal * avgSimilarity * 0.12, -0.10, 0.10));
};

const buildAnalogEvidenceLine = (analogs: FomcAnalogMatch[]): string => {
  const correct = analogs.filter((a) => a.verdict === "correct").length;
  const wrong = analogs.filter((a) => a.verdict === "wrong").length;
  const partial = analogs.filter((a) => a.verdict === "partially_correct").length;
  const top = analogs[0]!;

  return (
    `${analogs.length} FOMC analog(s): ${correct} correct, ${partial} partial, ` +
    `${wrong} wrong. Top match: ${top.period} (similarity ${top.similarity}).`
  );
};

const buildCautionLine = (analogs: FomcAnalogMatch[]): string | null => {
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
 * Enrich an FomcPredictionResult with signals from retrieved FOMC analogs.
 * Mirrors `enrichCpiPredictionWithAnalogs` exactly.
 * All confidence values stay within [0.35, 0.95].
 */
export const enrichFomcPredictionWithAnalogs = (
  result: FomcPredictionResult,
  analogs: FomcAnalogMatch[],
): FomcEnrichedPredictionResult => {
  const boost = computeAnalogBoost(analogs);
  const evidenceLine = analogs.length ? buildAnalogEvidenceLine(analogs) : null;
  const cautionLine = analogs.length ? buildCautionLine(analogs) : null;

  const enrichedPredictions: FomcEnrichedPrediction[] = result.predictions.map(
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
