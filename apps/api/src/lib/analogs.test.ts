import { describe, expect, it } from "vitest";

import { generateCalibratedPredictionSet } from "./analogs.js";
import { createPostmortem } from "./createPostmortem.js";
import { generatePredictionSet } from "./generatePrediction.js";
import { InMemoryRepository } from "./InMemoryRepository.js";
import { parseFinanceEvent } from "./parseFinanceEvent.js";
import { scorePrediction } from "./scorePrediction.js";

const createStoredEvent = async (
  repository: InMemoryRepository,
  rawText: string,
  title: string,
) => {
  const source = await repository.createSource({
    source_type: "headline",
    title,
    raw_text: rawText,
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

  return event;
};

const createStoredPrediction = async (
  repository: InMemoryRepository,
  event: Awaited<ReturnType<typeof createStoredEvent>>,
) => {
  const [generatedPrediction] = generatePredictionSet({
    event,
    horizons: ["1d"],
  });

  return repository.createPrediction(event.id, {
    ...generatedPrediction,
    model_version: "impact-engine-v0",
  });
};

describe("generateCalibratedPredictionSet", () => {
  it("prefers reviewed analogs over unreviewed lookalikes for calibration", async () => {
    const repository = new InMemoryRepository();

    const reviewedEvent = await createStoredEvent(
      repository,
      "China tariff threats rose again and the yuan weakened, putting pressure on Chinese technology stocks.",
      "Reviewed China tariff case",
    );
    const reviewedPrediction = await createStoredPrediction(repository, reviewedEvent);
    const reviewedOutcome = scorePrediction(reviewedPrediction, {
      realized_moves: [
        { ticker: "KWEB", realized_direction: "down", realized_magnitude_bp: -185 },
        { ticker: "USD/CNH", realized_direction: "up", realized_magnitude_bp: 32 },
      ],
      timing_alignment: 0.84,
    });
    const reviewedPostmortem = createPostmortem(reviewedPrediction, reviewedOutcome);

    await repository.saveOutcome(reviewedOutcome);
    await repository.savePostmortem(reviewedPostmortem.postmortem);
    await repository.saveLesson(reviewedPostmortem.lesson);
    await repository.updatePredictionStatus(reviewedPrediction.id, "reviewed");

    const pendingEvent = await createStoredEvent(
      repository,
      "China tariff threats rose again and the yuan weakened, putting pressure on Chinese technology stocks right away.",
      "Pending China tariff case",
    );
    await createStoredPrediction(repository, pendingEvent);

    const targetEvent = parseFinanceEvent({
      source_type: "headline",
      title: "Fresh China tariff concern",
      raw_text:
        "Fresh tariff threats against China and renewed yuan weakness are weighing on Chinese technology stocks.",
    });

    const calibrated = await generateCalibratedPredictionSet(repository, {
      event: targetEvent,
      horizons: ["1d"],
    });

    expect(calibrated.analogs[0]?.total_score).not.toBeNull();
    expect(
      calibrated.predictions[0]?.evidence.some((line) =>
        line.includes("1 scored analog(s) and 1 reviewed analog(s)"),
      ),
    ).toBe(true);
  });

  it("does not fake average analog evidence when only pending analogs exist", async () => {
    const repository = new InMemoryRepository();

    const pendingEvent = await createStoredEvent(
      repository,
      "Officials hinted at more policy support for China, which could help sentiment across technology shares.",
      "Pending China stimulus case",
    );
    await createStoredPrediction(repository, pendingEvent);

    const targetEvent = parseFinanceEvent({
      source_type: "headline",
      title: "China support headline",
      raw_text:
        "Officials hinted at more support measures for China, but realized market outcomes are not yet available.",
    });

    const calibrated = await generateCalibratedPredictionSet(repository, {
      event: targetEvent,
      horizons: ["1d"],
    });

    expect(
      calibrated.predictions[0]?.evidence.some((line) =>
        line.includes("none are reviewed enough yet"),
      ),
    ).toBe(true);
  });
});
