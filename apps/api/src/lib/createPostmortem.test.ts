import { describe, expect, it } from "vitest";

import { createPostmortem } from "./createPostmortem.js";

describe("createPostmortem", () => {
  it("classifies weak coverage, mixed-signal, and competing-catalyst failures", () => {
    const { postmortem, lesson } = createPostmortem(
      {
        id: "c2d4baf4-468b-4724-91c6-57d5b85176ab",
        event_id: "f2d4baf4-468b-4724-91c6-57d5b85176ac",
        model_version: "impact-engine-v0",
        horizon: "1d",
        thesis: "Conflicting signals may create a choppy reaction.",
        confidence: 0.74,
        assets: [
          {
            ticker: "SPY",
            expected_direction: "mixed",
            expected_magnitude_bp: 30,
            conviction: 0.52,
          },
          {
            ticker: "QQQ",
            expected_direction: "mixed",
            expected_magnitude_bp: 28,
            conviction: 0.5,
          },
          {
            ticker: "TLT",
            expected_direction: "up",
            expected_magnitude_bp: 45,
            conviction: 0.58,
          },
        ],
        evidence: [],
        invalidations: [],
        assumptions: [],
        status: "scored",
        created_at: "2031-01-01T00:00:00.000Z",
      },
      {
        id: "a2d4baf4-468b-4724-91c6-57d5b85176ad",
        prediction_id: "c2d4baf4-468b-4724-91c6-57d5b85176ab",
        horizon: "1d",
        measured_at: "2031-01-02T00:00:00.000Z",
        outcome_payload: {
          realized_moves: [
            {
              ticker: "TLT",
              realized_direction: "down",
              realized_magnitude_bp: -20,
            },
          ],
          timing_alignment: 0.42,
          dominant_catalyst: "A surprise CPI release dominated the session.",
          predicted_asset_count: 3,
          matched_asset_count: 1,
          coverage_ratio: 0.33,
        },
        direction_score: 0.2,
        magnitude_score: 0.35,
        timing_score: 0.42,
        calibration_score: 0.46,
        total_score: 0.31,
        created_at: "2031-01-02T00:00:00.000Z",
      },
    );

    expect(postmortem.failure_tags).toEqual(
      expect.arrayContaining([
        "weak_asset_mapping",
        "mixed_signal_environment",
        "competing_catalyst",
      ]),
    );
    expect(postmortem.critique).toContain("selected assets");
    expect(postmortem.critique).toContain("competing catalyst");
    expect(lesson.lesson_summary).toContain("Track overlapping catalysts");
  });
});
