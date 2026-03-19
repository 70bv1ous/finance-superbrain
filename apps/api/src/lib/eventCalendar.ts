/**
 * Economic Event Calendar (#4 — Pre-event Briefing Scheduler).
 *
 * Returns upcoming macro events in the next N days so the brain can generate
 * pre-event briefings automatically.
 *
 * FOMC dates are hardcoded for 2025–2026 (official Fed schedule).
 * NFP, CPI, GDP, PCE use algorithmic computation.
 * Default window expanded to 30 days for better coverage.
 */

export type MacroEvent = {
  name:        string;
  event_type:  "cpi" | "fomc" | "nfp" | "earnings" | "energy" | "credit" | "policy_fx" | "general";
  date:        Date;
  description: string;
  importance:  "high" | "medium" | "low";
};

// ─── Hardcoded FOMC dates (official Fed schedule) ─────────────────────────────
// Decision day = second day of the 2-day meeting (Wednesday)

const FOMC_DATES: Date[] = [
  // 2025
  new Date(2025,  0, 29), // Jan 28–29
  new Date(2025,  2, 19), // Mar 18–19
  new Date(2025,  4,  7), // May  6–7
  new Date(2025,  5, 18), // Jun 17–18
  new Date(2025,  6, 30), // Jul 29–30
  new Date(2025,  8, 17), // Sep 16–17
  new Date(2025,  9, 29), // Oct 28–29
  new Date(2025, 11, 10), // Dec  9–10
  // 2026
  new Date(2026,  0, 28), // Jan 27–28
  new Date(2026,  2, 18), // Mar 17–18
  new Date(2026,  3, 29), // Apr 28–29
  new Date(2026,  5, 17), // Jun 16–17
  new Date(2026,  6, 29), // Jul 28–29
  new Date(2026,  8, 16), // Sep 15–16
  new Date(2026,  9, 28), // Oct 27–28
  new Date(2026, 11,  9), // Dec  8–9
];

// ─── Hardcoded Jackson Hole dates ─────────────────────────────────────────────

const JACKSON_HOLE_DATES: Date[] = [
  new Date(2025, 7, 21), // Aug 21–23, 2025 — keynote day
  new Date(2026, 7, 20), // Aug 20–22, 2026 — keynote day (estimated)
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** First Friday of the month = NFP release day */
function firstFridayOfMonth(year: number, month: number): Date {
  const d   = new Date(year, month, 1);
  const dow = d.getDay();
  return new Date(year, month, 1 + ((5 - dow + 7) % 7));
}

/** Nth weekday (0=Sun … 6=Sat) of month */
function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const d   = new Date(year, month, 1);
  const dow = d.getDay();
  return new Date(year, month, 1 + ((weekday - dow + 7) % 7) + (n - 1) * 7);
}

/** CPI: BLS releases on 2nd or 3rd Wednesday, typically 8:30am ET around the 10th–15th.
 *  Heuristic: 2nd Wednesday is a reliable approximation. */
function cpiReleaseDate(year: number, month: number): Date {
  return nthWeekdayOfMonth(year, month, 3, 2); // 2nd Wednesday
}

/** GDP advance estimate: BLS releases ~4 weeks after quarter end.
 *  Q1 → late April, Q2 → late July, Q3 → late October, Q4 → late January */
function gdpAdvanceEstimateDates(year: number): Date[] {
  return [
    new Date(year,  0, 30), // Q4 prior year advance ~Jan 30
    new Date(year,  3, 29), // Q1 advance ~Apr 29
    new Date(year,  6, 30), // Q2 advance ~Jul 30
    new Date(year,  9, 29), // Q3 advance ~Oct 29
  ];
}

/** PCE: BEA releases last Friday of each month (or last business Friday).
 *  Heuristic: 4th Friday of the month. */
function pcaReleaseDate(year: number, month: number): Date {
  return nthWeekdayOfMonth(year, month, 5, 4); // 4th Friday
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * Returns all macro events in the next `daysAhead` calendar days, sorted by date.
 */
export function getUpcomingEvents(daysAhead = 30): MacroEvent[] {
  const now   = new Date();
  const limit = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const events: MacroEvent[] = [];

  const inWindow = (d: Date) => d >= now && d <= limit;

  // ── FOMC (hardcoded) ────────────────────────────────────────────────────────
  for (const date of FOMC_DATES) {
    if (inWindow(date)) {
      events.push({
        name:        "FOMC Rate Decision",
        event_type:  "fomc",
        date,
        description: "Federal Reserve rate decision + dot plot (quarterly) + Powell press conference. Biggest scheduled macro event. Watch: rate path, balance sheet guidance, forward guidance language shifts.",
        importance:  "high",
      });
    }
  }

  // ── Jackson Hole ────────────────────────────────────────────────────────────
  for (const date of JACKSON_HOLE_DATES) {
    if (inWindow(date)) {
      events.push({
        name:        "Jackson Hole Symposium (Fed keynote)",
        event_type:  "fomc",
        date,
        description: "Kansas City Fed annual symposium. Fed Chair keynote is one of the most market-moving speeches of the year. Has historically signalled major policy pivots (Bernanke QE, Powell 2022 hawkish pivot).",
        importance:  "high",
      });
    }
  }

  // ── NFP, CPI, PCE, GDP — cover current month + next 2 months ───────────────
  for (let offset = 0; offset <= 2; offset++) {
    const baseDate = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const year  = baseDate.getFullYear();
    const month = baseDate.getMonth();

    // NFP — first Friday of month
    const nfp = firstFridayOfMonth(year, month);
    if (inWindow(nfp)) {
      events.push({
        name:        "Non-Farm Payrolls (NFP)",
        event_type:  "nfp",
        date:        nfp,
        description: "US monthly jobs report — strongest single market mover. Watch: headline vs consensus, unemployment rate (Sahm Rule trigger at +0.5% from 12m low), avg hourly earnings (inflation proxy). Miss → TLT bid, DXY offered. Beat → yields spike.",
        importance:  "high",
      });
    }

    // CPI — ~2nd Wednesday of month
    const cpi = cpiReleaseDate(year, month);
    if (inWindow(cpi)) {
      events.push({
        name:        "CPI Inflation Report",
        event_type:  "cpi",
        date:        cpi,
        description: "US Consumer Price Index — primary Fed inflation gauge. Market moves hinge on YoY core CPI vs consensus. Hot print (+0.3%+ MoM core) → yields spike, equities sell, DXY bid. Cool print → risk rally, rate cut repricing.",
        importance:  "high",
      });
    }

    // PCE — 4th Friday of month (core PCE = Fed's preferred inflation gauge)
    const pce = pcaReleaseDate(year, month);
    if (inWindow(pce)) {
      events.push({
        name:        "PCE Inflation (Core PCE)",
        event_type:  "cpi",
        date:        pce,
        description: "Personal Consumption Expenditures — the Fed's preferred inflation measure. Core PCE target is 2%. Hot reading reinforces hawkish hold; cool reading accelerates cut timeline. Usually lower volatility than CPI but higher signal value to Fed.",
        importance:  "medium",
      });
    }

    // EIA Crude Inventory — every Wednesday, just take the next one per month
    for (let d = 1; d <= 28; d++) {
      const date = new Date(year, month, d);
      if (date.getDay() === 3 && inWindow(date)) {
        events.push({
          name:        "EIA Weekly Crude Inventory",
          event_type:  "energy",
          date,
          description: "EIA weekly petroleum status report. Build vs draw vs consensus drives intraday CL=F ±30–80bp. Context: demand signals, refinery utilisation, SPR activity.",
          importance:  "low",
        });
        break; // only next one per month
      }
    }
  }

  // ── GDP advance estimates ──────────────────────────────────────────────────
  const years = [...new Set([now.getFullYear(), now.getFullYear() + 1])];
  for (const yr of years) {
    for (const date of gdpAdvanceEstimateDates(yr)) {
      if (inWindow(date)) {
        events.push({
          name:        "GDP Advance Estimate",
          event_type:  "general",
          date,
          description: "BEA advance GDP estimate — first look at quarterly economic growth. Two consecutive negative quarters = technical recession. Surprise contraction → credit stress, risk-off. Strong beat → reflation trade. Revised significantly in subsequent estimates.",
          importance:  "medium",
        });
      }
    }
  }

  return events
    .filter(e => inWindow(e.date))
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

// ─── Formatter ────────────────────────────────────────────────────────────────

export function formatUpcomingEvents(events: MacroEvent[]): string {
  if (events.length === 0) return "No major scheduled macro events in the next 30 days.";

  const lines = events.map(e => {
    const daysAway = Math.ceil((e.date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const when     = daysAway === 0 ? "TODAY" : daysAway === 1 ? "TOMORROW" : `in ${daysAway}d`;
    const flag     = e.importance === "high" ? "🔴" : e.importance === "medium" ? "🟡" : "⚪";
    return `  ${flag} [${when}] ${e.name} — ${e.description.slice(0, 120)}`;
  });

  return ["UPCOMING MACRO EVENTS (next 30 days):", ...lines].join("\n");
}
