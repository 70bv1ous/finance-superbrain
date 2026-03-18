import type { StoredEvent, StoredPrediction } from "@finance-superbrain/schemas";

import type { MarketDataProvider, MarketOutcomeSnapshot } from "./marketDataProvider.types.js";

const HORIZON_MAGNITUDE_MULTIPLIER: Record<StoredPrediction["horizon"], number> = {
  "1h": 0.85,
  "1d": 0.92,
  "5d": 1.05,
};

export class MockMarketDataProvider implements MarketDataProvider {
  async getRealizedOutcome(input: {
    prediction: StoredPrediction;
    event: StoredEvent;
    asOf: string;
  }): Promise<MarketOutcomeSnapshot> {
    const multiplier = HORIZON_MAGNITUDE_MULTIPLIER[input.prediction.horizon];

    return {
      realized_moves: input.prediction.assets.map((asset, index) => {
        const drift = index === 0 ? 1 : 0.96;
        const signedMagnitude = Math.trunc(asset.expected_magnitude_bp * multiplier * drift);

        return {
          ticker: asset.ticker,
          realized_direction:
            signedMagnitude > 8 ? "up" : signedMagnitude < -8 ? "down" : "mixed",
          realized_magnitude_bp: signedMagnitude,
        };
      }),
      timing_alignment: 0.82,
      dominant_catalyst: `mock-feed:${input.event.event_class}`,
    };
  }
}
