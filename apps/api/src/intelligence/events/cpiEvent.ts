import { randomUUID } from "node:crypto";

import type { ParsedEvent } from "@finance-superbrain/schemas";

import { parseFinanceEvent } from "../../lib/parseFinanceEvent.js";

export type CpiRelease = {
  released_at: string;
  period: string;
  actual_value: number;
  expected_value: number;
  prior_value?: number;
};

export type CpiSurpriseDirection = "hotter" | "cooler" | "inline";

export type CpiEvent = {
  id: string;
  released_at: string;
  period: string;
  actual_value: number;
  expected_value: number;
  prior_value: number | null;
  surprise_magnitude: number;
  surprise_direction: CpiSurpriseDirection;
  surprise_bp: number;
  parsed_event: ParsedEvent;
};

const INLINE_THRESHOLD = 0.05;

const resolveSurpriseDirection = (surprise: number): CpiSurpriseDirection => {
  if (surprise > INLINE_THRESHOLD) return "hotter";
  if (surprise < -INLINE_THRESHOLD) return "cooler";
  return "inline";
};

const buildCpiRawText = (
  release: CpiRelease,
  direction: CpiSurpriseDirection,
): string => {
  if (direction === "hotter") {
    // Deliberately avoids "rate cut", "easing", or other positive words that
    // would dilute the risk_off signal. Inflation theme + multiple negative words
    // produce a clean risk_off sentiment for the prediction engine.
    return (
      `CPI release for ${release.period}. Inflation came in above expectations at ` +
      `${release.actual_value}%, beating the ${release.expected_value}% forecast. ` +
      `Sticky prices add uncertainty to the outlook. Inflation pressure across core ` +
      `components could restrict policy flexibility and weaken growth expectations.`
    );
  }

  if (direction === "cooler") {
    // Uses positive words (rate cuts, boost, stimulus, support) to reliably
    // produce a risk_on sentiment for the prediction engine.
    return (
      `CPI release for ${release.period}. Inflation eased to ${release.actual_value}%, ` +
      `below the ${release.expected_value}% forecast. The cooler reading may boost growth ` +
      `equities. Rate cuts are now more likely, with stimulus support growing. ` +
      `Strong disinflation progress is in support of rate cuts.`
    );
  }

  return (
    `CPI release for ${release.period}. CPI came in line with expectations at ` +
    `${release.actual_value}%, matching the ${release.expected_value}% forecast. ` +
    `Inflation remains stable with no significant surprise for markets.`
  );
};

export const buildCpiEvent = (release: CpiRelease): CpiEvent => {
  const surprise = Number((release.actual_value - release.expected_value).toFixed(4));
  const direction = resolveSurpriseDirection(surprise);
  const rawText = buildCpiRawText(release, direction);

  const parsed_event = parseFinanceEvent({
    source_type: "headline",
    title: `CPI Release ${release.period}`,
    raw_text: rawText,
  });

  return {
    id: randomUUID(),
    released_at: release.released_at,
    period: release.period,
    actual_value: release.actual_value,
    expected_value: release.expected_value,
    prior_value: release.prior_value ?? null,
    surprise_magnitude: surprise,
    surprise_direction: direction,
    surprise_bp: Math.round(surprise * 100),
    parsed_event,
  };
};
