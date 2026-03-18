import { describe, expect, it } from "vitest";

import { InMemoryRepository } from "./InMemoryRepository.js";

describe("InMemoryRepository learning record listing", () => {
  it("returns recent learning records in descending creation order and honors limit", async () => {
    const repository = new InMemoryRepository();

    const sourceA = await repository.createSource({
      source_type: "headline",
      title: "Earlier event",
      raw_text: "Earlier event text that is long enough to satisfy schema constraints.",
    });
    const eventA = await repository.createEvent(sourceA.id, {
      event_class: "market_commentary",
      summary: "Earlier event summary",
      sentiment: "neutral",
      urgency_score: 0.4,
      novelty_score: 0.4,
      entities: [],
      themes: ["macro"],
      candidate_assets: ["SPY"],
      why_it_matters: ["Earlier context"],
    });
    await repository.createPrediction(eventA.id, {
      horizon: "1d",
      thesis: "Earlier thesis",
      confidence: 0.55,
      assets: [
        {
          ticker: "SPY",
          expected_direction: "up",
          expected_magnitude_bp: 20,
          conviction: 0.55,
        },
      ],
      evidence: ["Earlier evidence"],
      invalidations: ["Earlier invalidation"],
      assumptions: ["Earlier assumption"],
      model_version: "test-model-v1",
    });

    const sourceB = await repository.createSource({
      source_type: "headline",
      title: "Later event",
      raw_text: "Later event text that is also long enough to satisfy schema constraints.",
    });
    const eventB = await repository.createEvent(sourceB.id, {
      event_class: "market_commentary",
      summary: "Later event summary",
      sentiment: "risk_on",
      urgency_score: 0.5,
      novelty_score: 0.5,
      entities: [],
      themes: ["rates"],
      candidate_assets: ["QQQ"],
      why_it_matters: ["Later context"],
    });
    const laterPrediction = await repository.createPrediction(eventB.id, {
      horizon: "1d",
      thesis: "Later thesis",
      confidence: 0.65,
      assets: [
        {
          ticker: "QQQ",
          expected_direction: "up",
          expected_magnitude_bp: 35,
          conviction: 0.65,
        },
      ],
      evidence: ["Later evidence"],
      invalidations: ["Later invalidation"],
      assumptions: ["Later assumption"],
      model_version: "test-model-v1",
    });

    const limited = await repository.listLearningRecords({ limit: 1 });
    const full = await repository.listLearningRecords();

    expect(limited).toHaveLength(1);
    expect(limited[0]?.prediction.id).toBe(laterPrediction.id);
    expect(full).toHaveLength(2);
    expect(full[0]?.prediction.id).toBe(laterPrediction.id);
  });
});
