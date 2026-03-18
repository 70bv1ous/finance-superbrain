import { randomUUID } from "node:crypto";

import type { Lesson, Postmortem, StoredPrediction } from "@finance-superbrain/schemas";

import { createPostmortem } from "../../lib/createPostmortem.js";
import type { MarketContextSnapshot } from "../context/marketContext.js";
import type { FomcEvent } from "../events/fomcEvent.js";
import type { FomcPredictionResult } from "../prediction/fomcPrediction.js";
import type { FomcOutcomeResult, FomcTrackedOutcome } from "../outcome/fomcOutcomeTracker.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type FomcMemoryCase = {
  id: string;
  event_family: "fomc";
  period: string;
  created_at: string;
  fomc_event: FomcEvent;
  context: MarketContextSnapshot;
  prediction_result: FomcPredictionResult;
  tracked_outcomes: FomcTrackedOutcome[];
  postmortems: Postmortem[];
  lessons: Lesson[];
  verdict: Postmortem["verdict"];
  lesson_summary: string;
};

export type FomcMemoryCaseInput = {
  prediction_result: FomcPredictionResult;
  outcome_result: FomcOutcomeResult;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toStoredPrediction = (tracked: FomcTrackedOutcome, model_version: string): StoredPrediction => ({
  ...tracked.prediction,
  id: tracked.outcome.prediction_id,
  event_id: randomUUID(),
  model_version,
  status: "scored" as const,
  created_at: new Date().toISOString(),
});

const resolveOverallVerdict = (postmortems: Postmortem[]): Postmortem["verdict"] => {
  const counts = { correct: 0, partially_correct: 0, wrong: 0 };

  for (const pm of postmortems) {
    counts[pm.verdict]++;
  }

  if (counts.correct >= counts.partially_correct && counts.correct >= counts.wrong) {
    return "correct";
  }

  if (counts.wrong > counts.correct) {
    return "wrong";
  }

  return "partially_correct";
};

const buildOverallLessonSummary = (
  postmortems: Postmortem[],
  fomcEvent: FomcEvent,
): string => {
  const verdict = resolveOverallVerdict(postmortems);
  const direction = fomcEvent.surprise_direction;
  const surpriseBp = Math.abs(fomcEvent.rate_surprise_bp);

  const dirLabel =
    direction === "hawkish"
      ? "Hawkish FOMC surprise"
      : direction === "dovish"
        ? "Dovish FOMC surprise"
        : "Inline FOMC decision";

  if (verdict === "correct") {
    return (
      `${dirLabel} (${surpriseBp}bp rate surprise) prediction held: ` +
      `reinforce this setup as a reliable template for similar FOMC decisions.`
    );
  }

  if (verdict === "wrong") {
    return (
      `${dirLabel} prediction failed. ` +
      `Re-examine rate-sensitivity theme mapping and asset selection before promoting this thesis type again.`
    );
  }

  return (
    `Mixed result for ${direction} FOMC decision. ` +
    `Some assets tracked correctly; review timing and magnitude sizing for similar rate decisions.`
  );
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const buildFomcMemoryCase = (input: FomcMemoryCaseInput): FomcMemoryCase => {
  const { prediction_result, outcome_result } = input;
  const { model_version } = prediction_result;

  const postmortems: Postmortem[] = [];
  const lessons: Lesson[] = [];

  for (const tracked of outcome_result.tracked) {
    const stored = toStoredPrediction(tracked, model_version);
    const { postmortem, lesson } = createPostmortem(stored, tracked.outcome);

    postmortems.push(postmortem);
    lessons.push(lesson);
  }

  const verdict = resolveOverallVerdict(postmortems);
  const lesson_summary = buildOverallLessonSummary(postmortems, prediction_result.fomc_event);

  return {
    id: randomUUID(),
    event_family: "fomc",
    period: prediction_result.fomc_event.period,
    created_at: new Date().toISOString(),
    fomc_event: prediction_result.fomc_event,
    context: prediction_result.context,
    prediction_result,
    tracked_outcomes: outcome_result.tracked,
    postmortems,
    lessons,
    verdict,
    lesson_summary,
  };
};
