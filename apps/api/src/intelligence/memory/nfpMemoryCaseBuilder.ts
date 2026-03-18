import { randomUUID } from "node:crypto";

import type { Lesson, Postmortem, StoredPrediction } from "@finance-superbrain/schemas";

import { createPostmortem } from "../../lib/createPostmortem.js";
import type { MarketContextSnapshot } from "../context/marketContext.js";
import type { NfpEvent } from "../events/nfpEvent.js";
import type { NfpPredictionResult } from "../prediction/nfpPrediction.js";
import type { NfpOutcomeResult, NfpTrackedOutcome } from "../outcome/nfpOutcomeTracker.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type NfpMemoryCase = {
  id: string;
  event_family: "nfp";
  period: string;
  created_at: string;
  nfp_event: NfpEvent;
  context: MarketContextSnapshot;
  prediction_result: NfpPredictionResult;
  tracked_outcomes: NfpTrackedOutcome[];
  postmortems: Postmortem[];
  lessons: Lesson[];
  verdict: Postmortem["verdict"];
  lesson_summary: string;
};

export type NfpMemoryCaseInput = {
  prediction_result: NfpPredictionResult;
  outcome_result: NfpOutcomeResult;
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const toStoredPrediction = (
  tracked: NfpTrackedOutcome,
  model_version: string,
): StoredPrediction => ({
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
  nfpEvent: NfpEvent,
): string => {
  const verdict = resolveOverallVerdict(postmortems);
  const direction = nfpEvent.surprise_direction;
  const surpriseK = Math.abs(nfpEvent.jobs_surprise_k);

  const dirLabel =
    direction === "strong"
      ? "Strong NFP beat"
      : direction === "weak"
        ? "Weak NFP miss"
        : "Inline NFP report";

  if (verdict === "correct") {
    return (
      `${dirLabel} (${surpriseK}k jobs surprise) prediction held: ` +
      `reinforce this setup as a reliable template for similar employment reports.`
    );
  }

  if (verdict === "wrong") {
    return (
      `${dirLabel} prediction failed. ` +
      `Re-examine employment-to-market transmission and asset selection before promoting this thesis type again.`
    );
  }

  return (
    `Mixed result for ${direction} NFP report. ` +
    `Some assets tracked correctly; review timing and cross-asset sensitivity for similar employment releases.`
  );
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const buildNfpMemoryCase = (input: NfpMemoryCaseInput): NfpMemoryCase => {
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
  const lesson_summary = buildOverallLessonSummary(postmortems, prediction_result.nfp_event);

  return {
    id: randomUUID(),
    event_family: "nfp",
    period: prediction_result.nfp_event.period,
    created_at: new Date().toISOString(),
    nfp_event: prediction_result.nfp_event,
    context: prediction_result.context,
    prediction_result,
    tracked_outcomes: outcome_result.tracked,
    postmortems,
    lessons,
    verdict,
    lesson_summary,
  };
};
