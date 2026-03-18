import type { Lesson, Postmortem, StoredPrediction } from "@finance-superbrain/schemas";

export const buildLessonMemoryText = (input: {
  prediction: StoredPrediction;
  postmortem: Postmortem;
  lesson: Lesson;
}) =>
  [
    input.lesson.lesson_summary,
    input.postmortem.critique,
    input.prediction.thesis,
    input.prediction.evidence.join(" "),
    input.prediction.invalidations.join(" "),
    input.prediction.assumptions.join(" "),
    input.prediction.assets
      .map((asset) => `${asset.ticker} ${asset.expected_direction} ${asset.expected_magnitude_bp}`)
      .join(" "),
    input.lesson.lesson_type,
    input.postmortem.verdict,
  ].join(" ");
