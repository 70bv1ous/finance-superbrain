import type { RealizedMove, StoredEvent, StoredPrediction } from "@finance-superbrain/schemas";

import type { MarketDataProvider, MarketOutcomeSnapshot } from "./marketDataProvider.types.js";

type YahooChartResponse = {
  chart?: {
    result?: Array<{
      indicators?: {
        quote?: Array<{
          close?: Array<number | null>;
        }>;
      };
    }>;
    error?: {
      description?: string;
    };
  };
};

const YAHOO_SYMBOL_MAP: Record<string, string> = {
  "USD/CNH": "CNH=X",
  DXY: "DX-Y.NYB",
};

const HORIZON_TO_INTERVAL: Record<StoredPrediction["horizon"], string> = {
  "1h": "5m",
  "1d": "1h",
  "5d": "1d",
};

const mapTickerToYahoo = (ticker: string) => YAHOO_SYMBOL_MAP[ticker] ?? ticker;

const determineDirection = (magnitudeBp: number): RealizedMove["realized_direction"] => {
  if (magnitudeBp > 8) return "up";
  if (magnitudeBp < -8) return "down";
  return "mixed";
};

const getFirstAndLastClose = (closeSeries: Array<number | null>) => {
  const cleaned = closeSeries.filter((value): value is number => typeof value === "number");

  if (cleaned.length < 2) {
    return null;
  }

  return {
    start: cleaned[0],
    end: cleaned[cleaned.length - 1],
  };
};

export class YahooMarketDataProvider implements MarketDataProvider {
  async getRealizedOutcome(input: {
    prediction: StoredPrediction;
    event: StoredEvent;
    asOf: string;
  }): Promise<MarketOutcomeSnapshot> {
    const realizedMoves: RealizedMove[] = [];

    for (const asset of input.prediction.assets) {
      const period1 = Math.floor(new Date(input.prediction.created_at).getTime() / 1000) - 300;
      const period2 = Math.floor(new Date(input.asOf).getTime() / 1000) + 300;
      const interval = HORIZON_TO_INTERVAL[input.prediction.horizon];
      const symbol = encodeURIComponent(mapTickerToYahoo(asset.ticker));
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?period1=${period1}&period2=${period2}&interval=${interval}&includePrePost=false&events=div%2Csplits`;

      const response = await fetch(url, {
        headers: {
          "User-Agent": "finance-superbrain/0.1",
        },
      });

      if (!response.ok) {
        throw new Error(`Yahoo request failed for ${asset.ticker} with status ${response.status}.`);
      }

      const payload = (await response.json()) as YahooChartResponse;
      const series = payload.chart?.result?.[0]?.indicators?.quote?.[0]?.close;

      if (!series) {
        const description = payload.chart?.error?.description ?? "No close series returned.";
        throw new Error(`Yahoo response for ${asset.ticker} was incomplete: ${description}`);
      }

      const closeWindow = getFirstAndLastClose(series);

      if (!closeWindow) {
        throw new Error(`Not enough market data points for ${asset.ticker}.`);
      }

      const magnitudeBp = Math.trunc(((closeWindow.end - closeWindow.start) / closeWindow.start) * 10000);

      realizedMoves.push({
        ticker: asset.ticker,
        realized_direction: determineDirection(magnitudeBp),
        realized_magnitude_bp: magnitudeBp,
      });
    }

    return {
      realized_moves: realizedMoves,
      timing_alignment: realizedMoves.length ? 0.78 : 0.4,
      dominant_catalyst: `market-data:${input.event.event_class}`,
    };
  }
}
