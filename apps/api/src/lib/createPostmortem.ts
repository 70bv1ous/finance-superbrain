import { randomUUID } from "node:crypto";

import type {
  Lesson,
  Postmortem,
  PredictionOutcome,
  StoredPrediction,
} from "@finance-superbrain/schemas";

const buildFailureTags = (
  prediction: StoredPrediction,
  outcome: PredictionOutcome,
): Postmortem["failure_tags"] => {
  const tags: Postmortem["failure_tags"] = [];

  if (outcome.direction_score < 0.45) {
    tags.push("wrong_direction");
  }

  if (outcome.magnitude_score < 0.45) {
    tags.push("wrong_magnitude");
  }

  if (outcome.timing_score < 0.5) {
    tags.push("wrong_timing");
  }

  if (outcome.calibration_score < 0.6) {
    tags.push(prediction.confidence >= 0.65 ? "overconfidence" : "underconfidence");
  }

  if (!outcome.outcome_payload.realized_moves.length) {
    tags.push("insufficient_signal");
  }

  if (
    outcome.outcome_payload.coverage_ratio !== undefined &&
    outcome.outcome_payload.coverage_ratio > 0 &&
    outcome.outcome_payload.coverage_ratio < 0.5
  ) {
    tags.push("weak_asset_mapping");
  }

  if (
    prediction.assets.filter((asset) => asset.expected_direction === "mixed").length >=
      Math.max(2, Math.ceil(prediction.assets.length / 2)) &&
    outcome.total_score < 0.65
  ) {
    tags.push("mixed_signal_environment");
  }

  if (outcome.outcome_payload.dominant_catalyst && outcome.total_score < 0.55) {
    tags.push("competing_catalyst");
  }

  return tags;
};

const buildVerdict = (outcome: PredictionOutcome): Postmortem["verdict"] => {
  if (outcome.total_score >= 0.75) {
    return "correct";
  }

  if (outcome.total_score >= 0.5) {
    return "partially_correct";
  }

  return "wrong";
};

const buildCritique = (
  prediction: StoredPrediction,
  outcome: PredictionOutcome,
  failureTags: Postmortem["failure_tags"],
) => {
  if (!failureTags.length) {
    return `The ${prediction.horizon} thesis held up well. Direction, magnitude, and confidence were aligned closely enough with the realized move to reinforce this setup.`;
  }

  const components: string[] = [];

  if (failureTags.includes("wrong_direction")) {
    components.push("The predicted direction did not line up with the realized move.");
  }

  if (failureTags.includes("wrong_magnitude")) {
    components.push("The expected magnitude was mis-sized versus the realized reaction.");
  }

  if (failureTags.includes("wrong_timing")) {
    components.push("The move may have been right in spirit but mis-timed inside the selected horizon.");
  }

  if (failureTags.includes("overconfidence")) {
    components.push("Confidence was too high for the quality of the realized outcome.");
  }

  if (failureTags.includes("underconfidence")) {
    components.push("The system was too cautious relative to how well the market matched the thesis.");
  }

  if (failureTags.includes("weak_asset_mapping")) {
    components.push("The selected assets did not cover enough of the realized market reaction.");
  }

  if (failureTags.includes("mixed_signal_environment")) {
    components.push("Cross-currents were stronger than the thesis architecture handled cleanly.");
  }

  if (failureTags.includes("competing_catalyst")) {
    components.push("A competing catalyst appears to have dominated the tape during the forecast window.");
  }

  return components.join(" ");
};

const buildLessonSummary = (
  failureTags: Postmortem["failure_tags"],
  prediction: StoredPrediction,
) => {
  if (!failureTags.length) {
    return `Reinforce this ${prediction.horizon} setup template and use it as a stronger analog for similar future events.`;
  }

  if (failureTags.includes("competing_catalyst")) {
    return `Track overlapping catalysts more aggressively before surfacing a directional thesis for similar events.`;
  }

  if (failureTags.includes("weak_asset_mapping")) {
    return `Improve asset mapping so similar events cover the instruments that actually absorb the move.`;
  }

  if (failureTags.includes("mixed_signal_environment")) {
    return `Treat similar cross-current setups as mixed earlier unless stronger confirmation resolves the regime conflict.`;
  }

  if (failureTags.includes("wrong_direction")) {
    return `Re-check causal mapping between event themes and asset direction before promoting this thesis type again.`;
  }

  if (failureTags.includes("wrong_timing")) {
    return `Time-discount similar signals when stronger overlapping catalysts are likely inside the forecast window.`;
  }

  if (failureTags.includes("wrong_magnitude")) {
    return `Tighten magnitude sizing by comparing this setup to closer historical analogs instead of broad theme matches.`;
  }

  if (failureTags.includes("overconfidence")) {
    return `Cap confidence for similar setups until realized hit rate improves.`;
  }

  return `Store this case as a cautionary example and retrieve it before similar predictions are surfaced.`;
};

export const createPostmortem = (
  prediction: StoredPrediction,
  outcome: PredictionOutcome,
): { postmortem: Postmortem; lesson: Lesson } => {
  const failureTags = buildFailureTags(prediction, outcome);
  const verdict = buildVerdict(outcome);
  const lessonSummary = buildLessonSummary(failureTags, prediction);

  const postmortem: Postmortem = {
    id: randomUUID(),
    prediction_id: prediction.id,
    verdict,
    failure_tags: failureTags,
    critique: buildCritique(prediction, outcome, failureTags),
    lesson_summary: lessonSummary,
    created_at: new Date().toISOString(),
  };

  const lesson: Lesson = {
    id: randomUUID(),
    prediction_id: prediction.id,
    lesson_type: verdict === "correct" ? "reinforcement" : "mistake",
    lesson_summary: lessonSummary,
    metadata: {
      horizon: prediction.horizon,
      verdict,
      total_score: String(outcome.total_score),
    },
    created_at: new Date().toISOString(),
  };

  return { postmortem, lesson };
};
