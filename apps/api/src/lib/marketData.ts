/**
 * Live market data snapshot (#5 — Real-time Market Data).
 *
 * Pulls current prices from Yahoo Finance (free, no key required) for the
 * key tickers the brain needs to contextualise trader queries in real time.
 * Fails silently — if the market is closed or the request times out the
 * brain simply runs without live data.
 *
 * Cloud IP fix: Yahoo Finance requires a crumb token for equity tickers when
 * requests originate from datacenter IPs. We fetch the crumb once per process
 * and cache it for 6 hours to avoid repeated auth round-trips.
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

const BROWSER_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

type TickerSnapshot = {
  symbol: string;
  label:  string;
  price:  number;
  change_pct: number;
  direction: "up" | "down" | "flat";
};

type CrumbSession = { crumb: string; cookie: string; fetchedAt: number };
let crumbSession: CrumbSession | null = null;

/**
 * Fetches a Yahoo Finance crumb + session cookie.
 * Required for equity/ETF tickers when called from cloud datacenter IPs.
 * Result is cached in-process for 6 hours.
 */
async function getYahooCrumb(): Promise<CrumbSession | null> {
  const SIX_HOURS = 6 * 60 * 60 * 1000;
  if (crumbSession && Date.now() - crumbSession.fetchedAt < SIX_HOURS) {
    return crumbSession;
  }

  try {
    // Step 1: get a session cookie from Yahoo's consent endpoint
    const cookieRes = await fetch("https://fc.yahoo.com", {
      signal: AbortSignal.timeout(5000),
      headers: { "User-Agent": BROWSER_UA },
    });
    const rawCookie = cookieRes.headers.get("set-cookie") ?? "";
    // Extract A3 cookie (Yahoo's main session cookie)
    const cookieMatch = rawCookie.match(/A3=[^;,]+/);
    const cookie = cookieMatch ? cookieMatch[0] : rawCookie.split(";")[0] ?? "";

    if (!cookie) return null;

    // Step 2: use that cookie to fetch the crumb
    const crumbRes = await fetch("https://query2.finance.yahoo.com/v1/test/getcrumb", {
      signal: AbortSignal.timeout(5000),
      headers: {
        "User-Agent": BROWSER_UA,
        "Cookie": cookie,
      },
    });

    const crumb = (await crumbRes.text()).trim();
    // Crumbs are short alphanumeric strings — reject anything that looks like an error page
    if (!crumb || crumb.length > 30 || crumb.includes("<") || crumb.includes("{")) {
      return null;
    }

    crumbSession = { crumb, cookie, fetchedAt: Date.now() };
    return crumbSession;
  } catch {
    return null;
  }
}

async function fetchYahooQuote(
  symbol: string,
  session: CrumbSession | null,
): Promise<{ price: number; change_pct: number } | null> {
  try {
    // Build URL — add crumb if we have a session
    const base = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
    const url  = session ? `${base}&crumb=${encodeURIComponent(session.crumb)}` : base;

    const headers: Record<string, string> = { "User-Agent": BROWSER_UA };
    if (session?.cookie) headers["Cookie"] = session.cookie;

    const res = await fetch(url, {
      signal: AbortSignal.timeout(5000),
      headers,
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
  // Fetch crumb once, share across all ticker requests
  const session = await getYahooCrumb();

  const results = await Promise.allSettled(
    CORE_TICKERS.map(async ({ symbol, label }) => {
      const quote = await fetchYahooQuote(symbol, session);
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
