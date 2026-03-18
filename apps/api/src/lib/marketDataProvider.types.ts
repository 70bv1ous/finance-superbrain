import type {
  RealizedMove,
  StoredEvent,
  StoredPrediction,
} from "@finance-superbrain/schemas";

export type MarketOutcomeSnapshot = {
  realized_moves: RealizedMove[];
  timing_alignment: number;
  dominant_catalyst?: string;
};

export interface MarketDataProvider {
  getRealizedOutcome(input: {
    prediction: StoredPrediction;
    event: StoredEvent;
    asOf: string;
  }): Promise<MarketOutcomeSnapshot>;
  close?(): Promise<void>;
}
