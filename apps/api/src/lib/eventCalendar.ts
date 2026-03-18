/**
 * Economic Event Calendar (#4 — Pre-event Briefing Scheduler).
 *
 * Returns upcoming macro events in the next N days so the brain can generate
 * pre-event briefings automatically.  Dates are computed algorithmically for
 * recurring events (CPI, FOMC, NFP) so no external API is needed.
 */

export type MacroEvent = {
  name:       string;
  event_type: "cpi" | "fomc" | "nfp" | "earnings" | "energy" | "credit" | "policy_fx" | "general";
  date:       Date;
  description: string;
};

/** First Friday of the month = NFP release day */
function firstFridayOfMonth(year: number, month: number): Date {
  const d = new Date(year, month, 1);
  const day = d.getDay(); // 0=Sun … 6=Sat
  const daysUntilFriday = (5 - day + 7) % 7;
  return new Date(year, month, 1 + daysUntilFriday);
}

/** Second or third Wednesday — FOMC meets 8x/year, roughly every 6 weeks */
function nthWednesdayOfMonth(year: number, month: number, n: number): Date {
  const d = new Date(year, month, 1);
  const day = d.getDay();
  const daysUntilWed = (3 - day + 7) % 7;
  return new Date(year, month, 1 + daysUntilWed + (n - 1) * 7);
}

/** CPI is released roughly the 2nd Wednesday of each month */
function cpiReleaseDayOfMonth(year: number, month: number): Date {
  return nthWednesdayOfMonth(year, month, 2);
}

/**
 * Returns all macro events in the next `daysAhead` calendar days.
 */
export function getUpcomingEvents(daysAhead = 14): MacroEvent[] {
  const now   = new Date();
  const limit = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const events: MacroEvent[] = [];

  // Generate events for this month and next month to cover the window
  for (let offset = 0; offset <= 1; offset++) {
    const year  = now.getMonth() + offset > 11 ? now.getFullYear() + 1 : now.getFullYear();
    const month = (now.getMonth() + offset) % 12;

    // NFP — first Friday of month
    const nfp = firstFridayOfMonth(year, month);
    events.push({
      name:        "Non-Farm Payrolls (NFP)",
      event_type:  "nfp",
      date:        nfp,
      description: "US monthly jobs report — strongest single market mover. Watch for: headline vs consensus, unemployment rate, avg hourly earnings (inflation proxy).",
    });

    // CPI — ~2nd Wednesday of month
    const cpi = cpiReleaseDayOfMonth(year, month);
    events.push({
      name:        "CPI Inflation Report",
      event_type:  "cpi",
      date:        cpi,
      description: "US Consumer Price Index — primary Fed inflation gauge. Market moves hinge on YoY core CPI vs consensus. Hot print → yields spike, equities sell.",
    });

    // FOMC — roughly every 6 weeks; approximate with every other month 3rd Wednesday
    if (month % 2 === 0) {
      const fomc = nthWednesdayOfMonth(year, month, 3);
      events.push({
        name:        "FOMC Rate Decision",
        event_type:  "fomc",
        date:        fomc,
        description: "Federal Reserve rate decision + dot plot + Powell press conference. Biggest scheduled macro event. Look for: rate path, balance sheet, forward guidance language.",
      });
    }

    // EIA Crude Inventory — every Wednesday
    for (let d = 1; d <= 28; d++) {
      const date = new Date(year, month, d);
      if (date.getDay() === 3 && date >= now && date <= limit) {
        events.push({
          name:        "EIA Weekly Crude Inventory",
          event_type:  "energy",
          date,
          description: "EIA weekly petroleum status report. Build vs draw vs consensus drives intraday CL=F ±30–80bp. Context: demand signals, refinery utilisation.",
        });
        break; // only include the next one
      }
    }
  }

  // Filter to window and sort
  return events
    .filter(e => e.date >= now && e.date <= limit)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
}

/**
 * Returns a compact string describing upcoming events — injected into briefing prompts.
 */
export function formatUpcomingEvents(events: MacroEvent[]): string {
  if (events.length === 0) return "No major scheduled macro events in the next 14 days.";

  const lines = events.map(e => {
    const daysAway = Math.ceil((e.date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    const label    = daysAway === 0 ? "TODAY" : daysAway === 1 ? "TOMORROW" : `in ${daysAway}d`;
    return `  [${label}] ${e.name} — ${e.description}`;
  });

  return ["UPCOMING MACRO EVENTS (next 14 days):", ...lines].join("\n");
}
