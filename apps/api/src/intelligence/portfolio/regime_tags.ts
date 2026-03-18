/**
 * Regime tagging helpers — attribution-only (Phase 7B).
 *
 * Tags a trade or period with the macro and volatility regime that was
 * active at the time.  These tags are stored on TradeAttributionRecord
 * and can be used to filter performance summaries by regime.
 *
 * ⚠️  Regime tags are for ATTRIBUTION and ANALYSIS only in Phase 7B.
 *     They are NOT used for position sizing yet.  A future phase may
 *     build regime-aware sizing multipliers on top of these tags.
 *
 * Volatility regime tagging:
 *   Uses a VIX-like scalar (0–100).  Thresholds match common practitioner
 *   conventions:  < 15 = calm,  15–25 = normal,  25–35 = elevated,  > 35 = high.
 *
 * Macro regime tagging:
 *   Caller-supplied — the system does not auto-detect macro regime from
 *   raw data.  The intelligence pipeline (Phases 4–6) is responsible for
 *   determining the macro context and passing it in.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Broad macro regime at the time of the trade.
 *
 *  risk_on      — growth assets bid, credit spreads tight
 *  risk_off     — defensive assets bid, equity vol elevated
 *  neutral      — no clear directionality
 *  stagflation  — inflation high, growth slowing
 *  disinflation — inflation falling (CPI-specific context)
 */
export type MacroRegime =
  | "risk_on"
  | "risk_off"
  | "neutral"
  | "stagflation"
  | "disinflation";

/**
 * Volatility regime derived from a VIX-like scalar.
 * Mirrors the VolatilityRegime type in execution.ts (kept separate to
 * avoid a cross-layer import).
 */
export type VolatilityRegimeTag = "low" | "normal" | "elevated" | "high";

/** Combined regime snapshot for a single trade or period. */
export type RegimeTags = {
  macroRegime: MacroRegime;
  volatilityRegime: VolatilityRegimeTag;
};

// ─── Volatility tagging ───────────────────────────────────────────────────────

/**
 * Tag a volatility regime from a VIX-like scalar (0–100).
 *
 *  < 15   → low       (calm, suppressed vol)
 *  15–25  → normal    (typical market conditions)
 *  25–35  → elevated  (heightened uncertainty)
 *  > 35   → high      (crisis-level vol)
 */
export const tagVolatilityRegime = (vixLike: number): VolatilityRegimeTag => {
  if (vixLike < 15) return "low";
  if (vixLike <= 25) return "normal";
  if (vixLike <= 35) return "elevated";
  return "high";
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Build a RegimeTags snapshot from explicit macro and volatility inputs.
 *
 * Use this when attaching regime context to a TradeAttributionRecord.
 *
 * @param macroRegime       Caller-supplied macro regime label.
 * @param volatilityRegime  Derived from tagVolatilityRegime(vix).
 */
export const buildRegimeTags = (
  macroRegime: MacroRegime,
  volatilityRegime: VolatilityRegimeTag,
): RegimeTags => ({
  macroRegime,
  volatilityRegime,
});

// ─── Convenience: tag from raw inputs ─────────────────────────────────────────

/**
 * Build a RegimeTags snapshot directly from a VIX-like scalar.
 * Caller still supplies the macro regime (cannot be auto-detected).
 */
export const buildRegimeTagsFromVix = (
  macroRegime: MacroRegime,
  vixLike: number,
): RegimeTags => buildRegimeTags(macroRegime, tagVolatilityRegime(vixLike));
