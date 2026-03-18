/**
 * Live market data snapshot (#5 — Real-time Market Data).
 *
 * Pulls current prices from Yahoo Finance (free, no key required) for the
 * key tickers the brain needs to contextualise trader queries in real time.
 * Fails silently — if the market is closed or the request times out the
 * brain simply runs without live data.
 */

const CORE_TICKERS: Array<{ symbol: string; label: string }> = [
  { symbol: "SPY",      label: "S&P 500 ETF"    },
  { symbol: "QQQ",      label: "Nasdaq ETF"      },
  { symbol: "TLT",      label: "20yr Treasury"   },
  { symbol: "GLD",      label: "Gold ETF"        },
  { symbol: "^VIX",     label: "VIX"             },
  { symbol: "CL=F",     label: "Crude Oil"       },
  { symbol: "EURUSD=X", label: "EUR/USD"         },
  { symbol: "DX-Y.NYB", label: "DXY Dollar Idx"  },
  { symbol: "^TNX",     label: "10yr Yield"      },
];

type TickerSnapshot = {
  symbol: string;
  label:  string;
  price:  number;
  change_pct: number;
  direction: "up" | "down" | "flat";
};

async function fetchYahooQuote(symbol: string): Promise<{ price: number; change_pct: number } | null> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!res.ok) return null;

    const data = await res.json() as any;
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;

    const price  = meta.regularMarketPrice as number;
    const prev   = (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
    const change_pct = prev ? ((price - prev) / prev) * 100 : 0;
    return { price, change_pct };
  } catch {
    return null;
  }
}

/**
 * Fetches live market data for all core tickers concurrently.
 * Returns an array of ticker snapshots (failed fetches are silently omitted).
 */
export async function getLiveMarketSnapshot(): Promise<TickerSnapshot[]> {
  const results = await Promise.allSettled(
    CORE_TICKERS.map(async ({ symbol, label }) => {
      const quote = await fetchYahooQuote(symbol);
      if (!quote) return null;
      return {
        symbol,
        label,
        price:      quote.price,
        change_pct: quote.change_pct,
        direction:  quote.change_pct > 0.05 ? "up" : quote.change_pct < -0.05 ? "down" : "flat",
      } satisfies TickerSnapshot;
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<TickerSnapshot> => r.status === "fulfilled" && r.value !== null)
    .map(r => r.value as TickerSnapshot);
}

/**
 * Formats the live snapshot as a compact string for injection into the
 * brain's system prompt so it can anchor its analysis to today's prices.
 */
export function formatMarketSnapshot(tickers: TickerSnapshot[]): string {
  if (tickers.length === 0) return "";

  const lines = tickers.map(t => {
    const arrow = t.direction === "up" ? "▲" : t.direction === "down" ? "▼" : "—";
    const sign  = t.change_pct >= 0 ? "+" : "";
    return `  ${t.label.padEnd(16)} ${t.symbol.padEnd(10)} ${arrow} ${sign}${t.change_pct.toFixed(2)}%  (${t.price.toFixed(2)})`;
  });

  return [
    "LIVE MARKET SNAPSHOT (real-time, use this to anchor your analysis to TODAY):",
    ...lines,
  ].join("\n");
}
