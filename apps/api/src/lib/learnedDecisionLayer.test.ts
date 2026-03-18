import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import { generateCalibratedPredictionSet } from "./analogs.js";
import { createPostmortem } from "./createPostmortem.js";
import { generatePredictionSet } from "./generatePrediction.js";
import { InMemoryRepository } from "./InMemoryRepository.js";
import { parseFinanceEvent } from "./parseFinanceEvent.js";
import { scorePrediction } from "./scorePrediction.js";

const createReviewedLearningRecord = async (
  repository: InMemoryRepository,
  options: {
    raw_text: string;
    title: string;
    model_version?: string;
    realized_moves: Array<{
      ticker: string;
      realized_direction: "up" | "down" | "mixed";
      realized_magnitude_bp: number;
    }>;
    timing_alignment?: number;
  },
) => {
  const source = await repository.createSource({
    source_type: "headline",
    title: options.title,
    raw_text: options.raw_text,
  });
  const event = await repository.createEvent(
    source.id,
    parseFinanceEvent({
      source_type: source.source_type,
      title: source.title,
      speaker: source.speaker,
      publisher: source.publisher,
      raw_uri: source.raw_uri,
      occurred_at: source.occurred_at,
      raw_text: source.raw_text,
    }),
  );
  const [generated] = generatePredictionSet({
    event,
    horizons: ["1d"],
  });
  const prediction = await repository.createPrediction(event.id, {
    ...generated,
    model_version: options.model_version ?? "impact-engine-v0",
  });
  const outcome = scorePrediction(prediction, {
    realized_moves: options.realized_moves,
    timing_alignment: options.timing_alignment ?? 0.82,
  });
  const review = createPostmortem(prediction, outcome);

  await repository.saveOutcome(outcome);
  await repository.savePostmortem(review.postmortem);
  await repository.saveLesson(review.lesson);
  await repository.updatePredictionStatus(prediction.id, "reviewed");

  return {
    event,
    prediction,
    outcome,
    review,
  };
};

describe("learned decision layer", () => {
  it("uses stored model tuning flags during calibrated prediction generation", async () => {
    const repository = new InMemoryRepository();

    await repository.saveModelVersion({
      model_version: "macro-tuned-v1",
      family: "macro",
      label: "Macro tuned",
      prompt_profile: "macro_dovish_sensitive",
      status: "active",
      feature_flags: {
        confidence_bias: 0.12,
        focus_themes: "rates,central_bank",
        preferred_assets: "GLD",
        magnitude_multiplier: 0.72,
      },
    });

    const event = parseFinanceEvent({
      source_type: "speech",
      title: "Powell sounds dovish",
      speaker: "Jerome Powell",
      raw_text:
        "Jerome Powell said inflation has cooled, the Fed can cut rates if needed, and bond yields plus the dollar may adjust as easing expectations build.",
    });

    const baseline = await generateCalibratedPredictionSet(repository, {
      event,
      horizons: ["1d"],
    });
    const tuned = await generateCalibratedPredictionSet(repository, {
      event,
      horizons: ["1d"],
      model_version: "macro-tuned-v1",
    });

    expect(tuned.predictions[0]?.confidence).toBeGreaterThan(
      baseline.predictions[0]?.confidence ?? 0,
    );
    expect(tuned.predictions[0]?.assets.some((asset) => asset.ticker === "GLD")).toBe(true);
  });

  it("learns asset-level direction and sizing from reviewed historical records", async () => {
    const repository = new InMemoryRepository();

    await createReviewedLearningRecord(repository, {
      title: "Reviewed tariff shock",
      raw_text:
        "Tariffs on China rose again while the yuan weakened, pressuring Chinese technology stocks and related ADRs.",
      realized_moves: [
        { ticker: "KWEB", realized_direction: "down", realized_magnitude_bp: -205 },
        { ticker: "USD/CNH", realized_direction: "up", realized_magnitude_bp: 36 },
      ],
    });

    const targetEvent = parseFinanceEvent({
      source_type: "headline",
      title: "Fresh tariff pressure",
      raw_text:
        "Fresh tariff pressure on China and additional yuan weakness are weighing on Chinese technology shares.",
    });
    const baseline = generatePredictionSet({
      event: targetEvent,
      horizons: ["1d"],
    })[0];
    const learned = await generateCalibratedPredictionSet(repository, {
      event: targetEvent,
      horizons: ["1d"],
      model_version: "impact-engine-v0",
    });
    const baselineKweb = baseline.assets.find((asset) => asset.ticker === "KWEB");
    const learnedKweb = learned.predictions[0]?.assets.find((asset) => asset.ticker === "KWEB");

    expect(learned.predictions[0]?.evidence.some((line) => line.includes("Learned signal:"))).toBe(
      true,
    );
    expect(learnedKweb?.expected_magnitude_bp).not.toBe(baselineKweb?.expected_magnitude_bp);
  });

  it("uses weak walk-forward history to temper model confidence", async () => {
    const repository = new InMemoryRepository();

    await repository.saveModelVersion({
      model_version: "macro-stressed-v1",
      family: "macro",
      label: "Macro stressed",
      prompt_profile: "macro_dovish_sensitive",
      status: "active",
      feature_flags: {},
    });

    await repository.saveWalkForwardReplaySnapshot({
      id: randomUUID(),
      as_of: "2031-01-10T00:00:00.000Z",
      benchmark_pack_id: "core_benchmark_v1",
      eligible_case_count: 24,
      window_count: 4,
      family_count: 1,
      report: {
        benchmark_pack_id: "core_benchmark_v1",
        training_mode: "expanding",
        min_train_cases: 10,
        test_window_size: 5,
        step_size: 5,
        eligible_case_count: 24,
        undated_case_count: 0,
        first_eligible_occurred_at: "2028-01-01T00:00:00.000Z",
        last_eligible_occurred_at: "2030-12-01T00:00:00.000Z",
        window_count: 4,
        model_count: 1,
        family_count: 1,
        leaders: {
          by_average_total_score: "macro-stressed-v1",
          by_direction_accuracy: "macro-stressed-v1",
          by_calibration_alignment: "macro-stressed-v1",
        },
        warnings: [],
        models: [
          {
            model_version: "macro-stressed-v1",
            family: "macro",
            status: "active",
            case_count: 20,
            average_confidence: 0.74,
            average_total_score: 0.51,
            direction_accuracy: 0.45,
            calibration_gap: 0.16,
            correct_rate: 0.2,
            partial_rate: 0.2,
            wrong_rate: 0.4,
            by_theme: [],
            by_source_type: [],
            by_horizon: [],
          },
        ],
        families: [
          {
            family: "macro",
            model_version: "macro-stressed-v1",
            status: "active",
            case_count: 20,
            average_confidence: 0.74,
            average_total_score: 0.51,
            direction_accuracy: 0.45,
            calibration_gap: 0.16,
            wrong_rate: 0.4,
          },
        ],
        regimes: [],
      },
      created_at: "2031-01-10T00:00:00.000Z",
    });

    const event = parseFinanceEvent({
      source_type: "speech",
      title: "Powell comments on rates",
      speaker: "Jerome Powell",
      raw_text:
        "Jerome Powell said the Fed is watching inflation and yields closely while markets debate the path of rate cuts.",
    });
    const baseline = generatePredictionSet(
      {
        event,
        horizons: ["1d"],
      },
      "macro_dovish_sensitive",
    )[0];
    const learned = await generateCalibratedPredictionSet(repository, {
      event,
      horizons: ["1d"],
      model_version: "macro-stressed-v1",
    });

    expect(learned.predictions[0]?.confidence).toBeLessThan(baseline.confidence);
    expect(
      learned.predictions[0]?.evidence.some((line) => line.includes("Timed validation:")),
    ).toBe(true);
  });
});
