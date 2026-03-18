import { describe, expect, it } from "vitest";

import { generatePredictionSet } from "./generatePrediction.js";
import type { PredictionStrategyContext } from "./modelStrategyProfiles.js";
import { parseFinanceEvent } from "./parseFinanceEvent.js";

describe("generatePredictionSet", () => {
  it("creates a risk-off China-linked prediction set", () => {
    const event = parseFinanceEvent({
      source_type: "transcript",
      title: "BBC live interview",
      speaker: "Donald Trump",
      raw_text:
        "Donald Trump said tariffs on China could rise, and the yuan has been weakening, which may pressure Chinese tech stocks.",
    });

    const [prediction] = generatePredictionSet({
      event,
      horizons: ["1d"],
    });

    expect(prediction.confidence).toBeGreaterThan(0.5);
    expect(prediction.assets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ ticker: "KWEB", expected_direction: "down" }),
        expect.objectContaining({ ticker: "USD/CNH", expected_direction: "up" }),
      ]),
    );
  });

  it("changes confidence and asset emphasis for a macro-sensitive profile", () => {
    const event = parseFinanceEvent({
      source_type: "speech",
      title: "Fed turns dovish",
      speaker: "Jerome Powell",
      raw_text:
        "Jerome Powell said inflation has cooled, rate cuts are possible, and yields plus the dollar may react as markets reprice the path of easing.",
    });

    const [baseline] = generatePredictionSet(
      {
        event,
        horizons: ["1d"],
      },
      "baseline",
    );
    const [macro] = generatePredictionSet(
      {
        event,
        horizons: ["1d"],
      },
      "macro_dovish_sensitive",
    );

    expect(macro.confidence).toBeGreaterThan(baseline.confidence);
    expect(macro.evidence.some((line) => line.includes("macro dovish sensitive"))).toBe(true);
    expect(macro.assets.some((asset) => asset.ticker === "TLT")).toBe(true);
    expect(macro.assets.some((asset) => asset.ticker === "DXY")).toBe(true);
  });

  it("becomes more cautious under the contrarian regime-aware profile", () => {
    const event = parseFinanceEvent({
      source_type: "headline",
      title: "China tech rebound despite tariff rhetoric",
      raw_text:
        "Tariff rhetoric toward China intensified, but investors focused on a larger domestic support package and China tech stocks rebounded instead.",
    });

    const [baseline] = generatePredictionSet(
      {
        event,
        horizons: ["1d"],
      },
      "baseline",
    );
    const [contrarian] = generatePredictionSet(
      {
        event,
        horizons: ["1d"],
      },
      "contrarian_regime_aware",
    );

    expect(contrarian.confidence).toBeLessThan(baseline.confidence);
    expect(contrarian.invalidations.some((line) => line.includes("Regime cross-currents"))).toBe(
      true,
    );
    expect(contrarian.assets.some((asset) => asset.expected_direction === "mixed")).toBe(true);
  });

  it("uses multiple reinforcing themes to strengthen a shared asset setup", () => {
    const event = parseFinanceEvent({
      source_type: "transcript",
      title: "Tariff risk rises for China tech",
      raw_text:
        "Tariffs on China may rise again and the yuan is weakening, adding pressure to Chinese tech and other China-linked assets.",
    });

    const [prediction] = generatePredictionSet({
      event,
      horizons: ["1d"],
    });

    const kwebAsset = prediction.assets.find((asset) => asset.ticker === "KWEB");

    expect(kwebAsset?.expected_direction).toBe("down");
    expect(Math.abs(kwebAsset?.expected_magnitude_bp ?? 0)).toBeGreaterThan(180);
    expect(
      prediction.evidence.some((line) => line.includes("Cross-theme agreement supports")),
    ).toBe(true);
  });

  it("shows mixed or more cautious asset setups when themes conflict", () => {
    const event = parseFinanceEvent({
      source_type: "headline",
      title: "China stimulus offsets tariff fears",
      raw_text:
        "Tariff rhetoric toward China intensified, but investors also focused on a broader stimulus package that could support China-linked growth assets.",
    });

    const [prediction] = generatePredictionSet({
      event,
      horizons: ["1d"],
    });

    const kwebAsset = prediction.assets.find((asset) => asset.ticker === "KWEB");

    expect(kwebAsset).toBeDefined();
    expect(["mixed", "down", "up"]).toContain(kwebAsset!.expected_direction);
    expect(
      prediction.evidence.some((line) => line.includes("mixed theme signals")) ||
        prediction.invalidations.some((line) => line.includes("Theme disagreement")),
    ).toBe(true);
  });

  it("keeps clear directional setups intact when contrarian tuning only adds caution themes", () => {
    const event = parseFinanceEvent({
      source_type: "headline",
      title: "Tariff pressure hits China tech",
      raw_text:
        "Tariffs on China may rise again and the yuan is weakening, adding pressure to Chinese technology shares.",
    });
    const strategy: PredictionStrategyContext = {
      model_version: "contrarian-risk-aware-v1",
      profile: "contrarian_regime_aware",
      registry: null,
      tuning: {
        confidence_bias: -0.03,
        confidence_cap: 0.84,
        magnitude_multiplier: 1,
        conviction_bias: -0.02,
        focus_themes: [],
        preferred_assets: [],
        caution_themes: ["trade_policy"],
      },
    };

    const [prediction] = generatePredictionSet(
      {
        event,
        horizons: ["1d"],
      },
      strategy,
    );

    expect(prediction.assets.find((asset) => asset.ticker === "KWEB")?.expected_direction).toBe(
      "down",
    );
    expect(prediction.assets.some((asset) => asset.expected_direction === "mixed")).toBe(false);
  });
});
