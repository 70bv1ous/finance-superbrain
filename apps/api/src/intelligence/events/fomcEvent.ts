import { randomUUID } from "node:crypto";

import type { ParsedEvent } from "@finance-superbrain/schemas";

import { parseFinanceEvent } from "../../lib/parseFinanceEvent.js";

// ─── Input type ───────────────────────────────────────────────────────────────

export type FomcDecision = {
  released_at: string;
  /** Meeting period, e.g. "2026-03" */
  period: string;
  /** Actual target rate set by the Fed (%) */
  actual_rate: number;
  /** Market consensus expectation for the target rate (%) */
  expected_rate: number;
  /** Previous target rate before this decision (%) */
  prior_rate?: number;
  /** What was decided: rate increase, decrease, or no change */
  decision_type: "hike" | "cut" | "hold";
  /**
   * Qualitative tone of the statement and press conference.
   * Captures guidance-level information beyond the rate decision itself.
   */
  guidance_tone: "hawkish" | "dovish" | "neutral";
};

// ─── Event types ──────────────────────────────────────────────────────────────

/**
 * Combined surprise direction for an FOMC decision.
 *
 *   hawkish  — rate was higher than expected, OR rate matched expectation but
 *              guidance signaled further tightening (hawkish tone).
 *   dovish   — rate was lower than expected, OR rate matched expectation but
 *              guidance signaled easing (dovish tone).
 *   inline   — rate as expected AND neutral guidance.
 */
export type FomcSurpriseDirection = "hawkish" | "dovish" | "inline";

export type FomcEvent = {
  id: string;
  released_at: string;
  period: string;
  actual_rate: number;
  expected_rate: number;
  prior_rate: number | null;
  decision_type: "hike" | "cut" | "hold";
  guidance_tone: "hawkish" | "dovish" | "neutral";
  /** Rate surprise in basis points: (actual − expected) × 100 */
  rate_surprise_bp: number;
  /** Combined surprise direction (rate + guidance) */
  surprise_direction: FomcSurpriseDirection;
  /**
   * Signed numeric magnitude of the rate surprise (actual − expected in %).
   * Used for band classification in analog retrieval.
   */
  surprise_magnitude: number;
  /**
   * Absolute basis-point magnitude of the rate surprise.
   * Mirrors `surprise_bp` on `CpiEvent` so analog band helpers are
   * structurally compatible.
   */
  surprise_bp: number;
  parsed_event: ParsedEvent;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * A rate surprise greater than 5 bp (in absolute terms) is treated as a
 * meaningful deviation from consensus.  Inside the threshold the guidance tone
 * governs the direction.
 */
const RATE_THRESHOLD_BP = 5;

const resolveSurpriseDirection = (
  rateSurpriseBp: number,
  guidanceTone: FomcDecision["guidance_tone"],
): FomcSurpriseDirection => {
  if (rateSurpriseBp > RATE_THRESHOLD_BP) return "hawkish";
  if (rateSurpriseBp < -RATE_THRESHOLD_BP) return "dovish";

  // Rate as expected — guidance tone settles the direction.
  if (guidanceTone === "hawkish") return "hawkish";
  if (guidanceTone === "dovish") return "dovish";
  return "inline";
};

/**
 * Build the raw text that the prediction engine will parse.
 *
 * Hawkish: uses "restrict", "uncertainty", "pressure" to anchor a risk_off
 * sentiment signal in the prediction engine.
 * Dovish: uses "rate cuts", "support", "boost", "stimulus" to anchor risk_on.
 * Inline: neutral framing with no strong directional language.
 */
const buildFomcRawText = (
  decision: FomcDecision,
  direction: FomcSurpriseDirection,
): string => {
  const action =
    decision.decision_type === "hike"
      ? `hiked to ${decision.actual_rate}%`
      : decision.decision_type === "cut"
        ? `cut to ${decision.actual_rate}%`
        : `held at ${decision.actual_rate}%`;

  if (direction === "hawkish") {
    return (
      `FOMC decision for ${decision.period}. The Federal Reserve ${action}, ` +
      `against expectations of ${decision.expected_rate}%. ` +
      `Guidance tone was hawkish, signaling concern about inflation persistence. ` +
      `Tighter financial conditions and restricted policy flexibility weigh on growth expectations. ` +
      `Uncertainty over the rate path may restrict risk appetite and weigh on equities.`
    );
  }

  if (direction === "dovish") {
    return (
      `FOMC decision for ${decision.period}. The Federal Reserve ${action}, ` +
      `against expectations of ${decision.expected_rate}%. ` +
      `Dovish guidance signals rate cuts are now more likely, boosting growth expectations. ` +
      `Rate cuts ahead; stimulus support growing and financial conditions easing. ` +
      `Easier monetary policy may boost equities and support risk-on flows.`
    );
  }

  return (
    `FOMC decision for ${decision.period}. The Federal Reserve ${action}, ` +
    `in line with the ${decision.expected_rate}% consensus. ` +
    `Guidance was neutral with no significant policy shift signaled. ` +
    `Markets remain stable with no major surprise to the rate outlook.`
  );
};

// ─── Public API ───────────────────────────────────────────────────────────────

export const buildFomcEvent = (decision: FomcDecision): FomcEvent => {
  const rate_surprise_bp = Math.round((decision.actual_rate - decision.expected_rate) * 100);
  const surprise_magnitude = Number((decision.actual_rate - decision.expected_rate).toFixed(4));
  const direction = resolveSurpriseDirection(rate_surprise_bp, decision.guidance_tone);
  const rawText = buildFomcRawText(decision, direction);

  const parsed_event = parseFinanceEvent({
    source_type: "headline",
    title: `FOMC Decision ${decision.period}`,
    raw_text: rawText,
  });

  return {
    id: randomUUID(),
    released_at: decision.released_at,
    period: decision.period,
    actual_rate: decision.actual_rate,
    expected_rate: decision.expected_rate,
    prior_rate: decision.prior_rate ?? null,
    decision_type: decision.decision_type,
    guidance_tone: decision.guidance_tone,
    rate_surprise_bp,
    surprise_direction: direction,
    surprise_magnitude,
    surprise_bp: rate_surprise_bp,
    parsed_event,
  };
};
