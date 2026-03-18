/**
 * Live market data snapshot (#5 — Real-time Market Data).
 *
 * Primary source: Stooq.com — free CSV API, no auth, no IP restrictions,
 * works reliably from cloud/datacenter IPs.
 *
 * Fallback (VIX, 10yr yield): Yahoo Finance v8 chart API — FX and volatility
 * tickers route through a different Yahoo backend that doesn't require crumbs.
 *
 * Fails silently — if the market is closed or a request times out the
 * brain simply runs without that ticker's live data.
 */

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

type TickerSnapshot = {
  symbol:     string;
  label:      string;
  price:      number;
  change_pct: number;
  direction:  "up" | "down" | "flat";
};

// ── Stooq: works from any IP, no auth ─────────────────────────────────────
// Stooq CSV format: Symbol,Date,Time,Open,High,Low,Close,Volume
const STOOQ_TICKERS: Array<{ symbol: string; stooq: string; label: string }> = [
  { symbol: "SPY",      stooq: "spy.us",  label: "S&P 500 ETF"   },
  { symbol: "QQQ",      stooq: "qqq.us",  label: "Nasdaq ETF"     },
  { symbol: "TLT",      stooq: "tlt.us",  label: "20yr Treasury"  },
  { symbol: "GLD",      stooq: "gld.us",  label: "Gold ETF"       },
  { symbol: "CL=F",     stooq: "cl.f",    label: "Crude Oil"      },
  { symbol: "EURUSD=X", stooq: "eurusd",  label: "EUR/USD"        },
  { symbol: "DX-Y.NYB", stooq: "dx.f",    label: "DXY Dollar Idx" },
];

// ── Yahoo Finance: only used for tickers Stooq doesn't support ────────────
const YAHOO_FALLBACK_TICKERS: Array<{ symbol: string; label: string }> = [
  { symbol: "^VIX", label: "VIX"        },
  { symbol: "^TNX", label: "10yr Yield" },
];

async function fetchStooqQuote(
  stooqSymbol: string,
): Promise<{ price: number; change_pct: number } | null> {
  try {
    const url = `https://stooq.com/q/l/?s=${encodeURIComponent(stooqSymbol)}&f=sd2t2ohlcv&h&e=csv`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": BROWSER_UA },
    });
    if (!res.ok) return null;

    const text = await res.text();
    const lines = text.trim().split("\n");
    if (lines.length < 2) return null;

    // columns: Symbol,Date,Time,Open,High,Low,Close,Volume
    const cols = lines[1].split(",");
    const close = parseFloat(cols[6] ?? "");
    const open  = parseFloat(cols[3] ?? "");
    if (isNaN(close) || close <= 0) return null;

    const change_pct = open > 0 ? ((close - open) / open) * 100 : 0;
    return { price: close, change_pct };
  } catch {
    return null;
  }
}

async function fetchYahooQuote(
  symbol: string,
): Promise<{ price: number; change_pct: number } | null> {
  try {
    const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": BROWSER_UA },
    });
    if (!res.ok) return null;

    const data = await res.json() as any;
    const meta = data?.chart?.result?.[0]?.meta;
    if (!meta?.regularMarketPrice) return null;

    const price      = meta.regularMarketPrice as number;
    const prev       = (meta.chartPreviousClose ?? meta.previousClose ?? price) as number;
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
  const toSnapshot = (
    symbol: string,
    label: string,
    q: { price: number; change_pct: number } | null,
  ): TickerSnapshot | null => {
    if (!q) return null;
    return {
      symbol,
      label,
      price:      q.price,
      change_pct: q.change_pct,
      direction:  q.change_pct > 0.05 ? "up" : q.change_pct < -0.05 ? "down" : "flat",
    };
  };

  const [stooqResults, yahooResults] = await Promise.all([
    // Stooq batch
    Promise.allSettled(
      STOOQ_TICKERS.map(async ({ symbol, stooq, label }) =>
        toSnapshot(symbol, label, await fetchStooqQuote(stooq)),
      ),
    ),
    // Yahoo fallback batch
    Promise.allSettled(
      YAHOO_FALLBACK_TICKERS.map(async ({ symbol, label }) =>
        toSnapshot(symbol, label, await fetchYahooQuote(symbol)),
      ),
    ),
  ]);

  return [...stooqResults, ...yahooResults]
    .filter(
      (r): r is PromiseFulfilledResult<TickerSnapshot> =>
        r.status === "fulfilled" && r.value !== null,
    )
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
