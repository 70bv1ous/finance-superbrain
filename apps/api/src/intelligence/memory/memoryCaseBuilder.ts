import { randomUUID } from "node:crypto";

import type { Lesson, Postmortem, StoredPrediction } from "@finance-superbrain/schemas";

import { createPostmortem } from "../../lib/createPostmortem.js";
import type { MarketContextSnapshot } from "../context/marketContext.js";
import type { CpiEvent } from "../events/cpiEvent.js";
import type { CpiPredictionResult } from "../prediction/cpiPrediction.js";
import type { CpiOutcomeResult, TrackedOutcome } from "../outcome/outcomeTracker.js";

export type CpiMemoryCase = {
  id: string;
  event_family: "cpi";
  period: string;
  created_at: string;
  cpi_event: CpiEvent;
  context: MarketContextSnapshot;
  prediction_result: CpiPredictionResult;
  tracked_outcomes: TrackedOutcome[];
  postmortems: Postmortem[];
  lessons: Lesson[];
  verdict: Postmortem["verdict"];
  lesson_summary: string;
};

export type CpiMemoryCaseInput = {
  prediction_result: CpiPredictionResult;
  outcome_result: CpiOutcomeResult;
};

const toStoredPrediction = (tracked: TrackedOutcome, model_version: string): StoredPrediction => ({
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
  cpiEvent: CpiEvent,
): string => {
  const verdict = resolveOverallVerdict(postmortems);
  const direction = cpiEvent.surprise_direction;
  const surpriseBp = Math.abs(cpiEvent.surprise_bp);

  if (verdict === "correct") {
    return (
      `${direction === "inline" ? "Inline" : direction === "hotter" ? "Hotter-than-expected" : "Cooler-than-expected"} ` +
      `CPI (${surpriseBp}bp surprise) prediction held: reinforce this setup as a reliable template for similar CPI releases.`
    );
  }

  if (verdict === "wrong") {
    return (
      `${direction === "hotter" ? "Hotter" : direction === "cooler" ? "Cooler" : "Inline"} CPI prediction failed. ` +
      `Re-examine inflation theme mapping and asset selection before promoting this thesis type again.`
    );
  }

  return (
    `Mixed result for ${direction} CPI. Some assets tracked correctly; review timing and magnitude sizing for similar surprises.`
  );
};

export const buildCpiMemoryCase = (input: CpiMemoryCaseInput): CpiMemoryCase => {
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
  const lesson_summary = buildOverallLessonSummary(postmortems, prediction_result.cpi_event);

  return {
    id: randomUUID(),
    event_family: "cpi",
    period: prediction_result.cpi_event.period,
    created_at: new Date().toISOString(),
    cpi_event: prediction_result.cpi_event,
    context: prediction_result.context,
    prediction_result,
    tracked_outcomes: outcome_result.tracked,
    postmortems,
    lessons,
    verdict,
    lesson_summary,
  };
};
