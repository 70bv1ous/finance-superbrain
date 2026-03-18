/**
 * Exit logic — fixed holding periods, slippage modelling, and
 * multi-horizon blended exits (Phase 7B.1).
 *
 * Phase 7B provided a single holding-period per event family.
 * The weakness: a single fixed exit horizon distorts P&L attribution —
 * macro moves often overshoot at entry and partially retrace by EOD.
 *
 * Phase 7B.1 adds parallel exit horizons:
 *  - fast   (30 min)  — captures initial shock, higher slippage
 *  - medium (varies)  — captures the primary move, baseline slippage
 *  - slow   (EOD)     — accounts for partial mean-reversion, patient fill
 *
 * A deterministic weighted blend produces the canonical blended P&L
 * for attribution.  All Phase 7B callers remain unchanged.
 *
 * Design constraints:
 *  - No advanced execution modelling (no market impact, no bid/ask spread
 *    simulation, no partial fills).
 *  - All functions are pure and deterministic.
 *  - Used by the attribution layer to compute exit prices and net P&L.
 *    Not a replacement for Phase 7A's computeTradePnL — that remains
 *    the canonical gross P&L figure.  This layer adds slippage on top.
 */

// ─── Holding periods ──────────────────────────────────────────────────────────

/**
 * Default simulated holding period in minutes, per event family.
 *
 * Rationale:
 *  CPI   (60 min)  — initial reaction settles within 1h for most assets.
 *  FOMC  (120 min) — Fed decisions require more time to digest.
 *  NFP   (30 min)  — labour data tends to be quickly priced in.
 */
export const DEFAULT_HOLDING_PERIODS: Record<string, number> = {
  cpi: 60,
  fomc: 120,
  nfp: 30,
} as const;

/** Fallback holding period for unknown event families. */
export const FALLBACK_HOLDING_PERIOD_MINUTES = 60;

/**
 * Resolve the holding period for an event family.
 *
 * @param eventFamily  "cpi" | "fomc" | "nfp" (or any string key).
 * @param override     Optional caller-supplied override in minutes.
 */
export const resolveHoldingPeriod = (
  eventFamily: string,
  override?: number,
): number => {
  if (override !== undefined && override > 0) return override;
  return DEFAULT_HOLDING_PERIODS[eventFamily] ?? FALLBACK_HOLDING_PERIOD_MINUTES;
};

// ─── Slippage ─────────────────────────────────────────────────────────────────

/**
 * Default round-trip slippage in basis points.
 *
 * 3 bps total = ~1.5 bps per leg.  Conservative for liquid macro ETFs
 * (SPY, TLT, GLD, UUP) in normal market conditions.
 */
export const DEFAULT_SLIPPAGE_BPS = 3.0;

/**
 * Compute the dollar cost of slippage for a given notional.
 *
 * slippageCost = size × entryPrice × slippageBps / 10_000
 *
 * This represents the total round-trip cost deducted from gross P&L.
 * Rounded to 2 decimal places.
 */
export const computeSlippageCost = (
  executedSize: number,
  entryPrice: number,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
): number => {
  const cost = executedSize * entryPrice * slippageBps / 10_000;
  return Number(cost.toFixed(2));
};

// ─── Exit price ───────────────────────────────────────────────────────────────

/**
 * Compute the simulated exit price after a predicted move plus slippage.
 *
 * For a LONG position:
 *   idealExit = entryPrice × (1 + magnitudeBp / 10_000)
 *   actualExit = idealExit × (1 − slippageBps / 10_000)    ← adverse fill
 *
 * For a SHORT position:
 *   idealExit = entryPrice × (1 − magnitudeBp / 10_000)
 *   actualExit = idealExit × (1 + slippageBps / 10_000)    ← adverse fill
 *
 * Slippage is always adverse (reduces net P&L), which is the
 * conservative assumption.
 *
 * @param entryPrice   Simulated entry price.
 * @param direction    "long" | "short".
 * @param magnitudeBp  Absolute predicted move in basis points (positive).
 * @param slippageBps  Per-side slippage in basis points.
 */
export const computeExitPrice = (
  entryPrice: number,
  direction: "long" | "short",
  magnitudeBp: number,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
): number => {
  const absMag = Math.abs(magnitudeBp);
  const slipFrac = slippageBps / 10_000;

  if (direction === "long") {
    const ideal = entryPrice * (1 + absMag / 10_000);
    return Number((ideal * (1 - slipFrac)).toFixed(4));
  } else {
    const ideal = entryPrice * (1 - absMag / 10_000);
    return Number((ideal * (1 + slipFrac)).toFixed(4));
  }
};

// ─── Net P&L ──────────────────────────────────────────────────────────────────

/**
 * Compute net P&L for a simulated trade including slippage.
 *
 * long  P&L = size × (exitPrice − entryPrice)
 * short P&L = size × (entryPrice − exitPrice)
 *
 * Both directions produce positive P&L when the prediction is correct
 * and the magnitude exceeds slippage.  P&L can be slightly negative if
 * slippage exceeds the predicted move (extremely small magnitude_bp).
 *
 * Rounded to 2 decimal places.
 */
export const computeNetPnL = (
  executedSize: number,
  entryPrice: number,
  direction: "long" | "short",
  magnitudeBp: number,
  slippageBps = DEFAULT_SLIPPAGE_BPS,
): number => {
  const exitPrice = computeExitPrice(entryPrice, direction, magnitudeBp, slippageBps);
  const raw = direction === "long"
    ? executedSize * (exitPrice - entryPrice)
    : executedSize * (entryPrice - exitPrice);
  return Number(raw.toFixed(2));
};

// ─── Multi-horizon exit (Phase 7B.1) ─────────────────────────────────────────

/**
 * Sentinel constant for "end of trading day" — used as the slow horizon.
 * 480 minutes = 8 hours from market open, a reasonable EOD proxy for
 * macro events (CPI, FOMC, NFP all release during regular hours).
 */
export const EOD_MINUTES = 480;

/** The three exit horizons tracked per trade. */
export type HorizonName = "fast" | "medium" | "slow";

/**
 * Per-horizon magnitude scale and slippage.
 *
 * magnitudeScale:
 *  - fast   (1.00) — trades the initial shock at full predicted magnitude.
 *  - medium (1.00) — baseline, captures the primary move.
 *  - slow   (0.85) — partial mean-reversion by EOD reduces net realised move.
 *
 * slippageBps (round-trip):
 *  - fast   (4.0 bps) — less patient fill, wider spread on urgent order.
 *  - medium (3.0 bps) — baseline (same as Phase 7B single-horizon).
 *  - slow   (2.0 bps) — patient fill, can work the order more cheaply.
 */
export type HorizonParams = {
  magnitudeScale: number;
  slippageBps: number;
};

export const HORIZON_PARAMS: Record<HorizonName, HorizonParams> = {
  fast:   { magnitudeScale: 1.00, slippageBps: 4.0 },
  medium: { magnitudeScale: 1.00, slippageBps: 3.0 },
  slow:   { magnitudeScale: 0.85, slippageBps: 2.0 },
};

/**
 * Holding period (in minutes) for each horizon, per event family.
 *
 *  CPI:  fast=30  medium=120  slow=480(EOD)
 *  FOMC: fast=30  medium=240  slow=480(EOD)
 *  NFP:  fast=30  medium=180  slow=480(EOD)
 */
export const MULTI_HORIZON_PERIODS: Record<string, Record<HorizonName, number>> = {
  cpi:  { fast: 30, medium: 120, slow: EOD_MINUTES },
  fomc: { fast: 30, medium: 240, slow: EOD_MINUTES },
  nfp:  { fast: 30, medium: 180, slow: EOD_MINUTES },
};

/** Fallback used for unknown event families. */
export const FALLBACK_MULTI_HORIZON: Record<HorizonName, number> = {
  fast: 30, medium: 120, slow: EOD_MINUTES,
};

/**
 * Resolve the three holding periods for a given event family.
 * Returns FALLBACK_MULTI_HORIZON for any unrecognised family.
 */
export const resolveHorizonPeriods = (
  eventFamily: string,
): Record<HorizonName, number> =>
  MULTI_HORIZON_PERIODS[eventFamily] ?? FALLBACK_MULTI_HORIZON;

/** Blend weight triplet for the three exit horizons. */
export type BlendWeights = {
  fast: number;
  medium: number;
  slow: number;
};

/**
 * Default blend weights for the three horizons.
 * fast + medium + slow = 1.0.
 */
export const DEFAULT_BLEND_WEIGHTS: BlendWeights = {
  fast: 0.30,
  medium: 0.40,
  slow: 0.30,
};

/** P&L result for a single exit horizon. */
export type HorizonPnL = {
  /** Horizon label. */
  horizonName: HorizonName;
  /** Simulated holding period in minutes for this horizon. */
  holdingPeriodMinutes: number;
  /** Simulated exit price (includes horizon-specific slippage). */
  exitPrice: number;
  /** Net P&L for this horizon after slippage. */
  pnl: number;
  /** Return as percentage of notional. */
  returnPct: number;
};

/**
 * Blended result across all three horizons.
 *
 * `blendedPnl` is the canonical P&L to use in attribution records when
 * multi-horizon exit is enabled.
 */
export type BlendedExitResult = {
  /** Individual horizon results (always ordered: fast, medium, slow). */
  horizons: [HorizonPnL, HorizonPnL, HorizonPnL];
  /** Weighted average P&L across horizons. */
  blendedPnl: number;
  /** Weighted average return percentage across horizons. */
  blendedReturnPct: number;
  /** Blend weights applied (fast + medium + slow = 1.0). */
  weights: BlendWeights;
  /** Explanation of the blend calculation. */
  reason: string[];
};

/**
 * Compute the P&L for a single named exit horizon.
 *
 * The predicted magnitude is scaled by the horizon's `magnitudeScale`
 * before computing the exit price, to account for the expected amount
 * of the initial move that persists to that horizon.
 *
 * @param executedSize   Number of units traded.
 * @param entryPrice     Simulated entry price.
 * @param direction      "long" | "short".
 * @param magnitudeBp    Absolute predicted move in basis points.
 * @param horizonName    Which horizon to compute ("fast"|"medium"|"slow").
 * @param eventFamily    Used to look up the holding period.
 */
export const computeHorizonPnL = (
  executedSize: number,
  entryPrice: number,
  direction: "long" | "short",
  magnitudeBp: number,
  horizonName: HorizonName,
  eventFamily: string,
): HorizonPnL => {
  const periods = resolveHorizonPeriods(eventFamily);
  const holdingPeriodMinutes = periods[horizonName];
  const params = HORIZON_PARAMS[horizonName];

  // Scale the magnitude for this horizon (e.g. slow horizon = 85% remains)
  const scaledMagnitude = Math.abs(magnitudeBp) * params.magnitudeScale;

  const exitPrice = computeExitPrice(
    entryPrice,
    direction,
    scaledMagnitude,
    params.slippageBps,
  );

  const rawPnl = direction === "long"
    ? executedSize * (exitPrice - entryPrice)
    : executedSize * (entryPrice - exitPrice);

  const pnl = Number(rawPnl.toFixed(2));
  const notional = executedSize * entryPrice;
  const returnPct = notional > 0
    ? Number(((pnl / notional) * 100).toFixed(4))
    : 0;

  return {
    horizonName,
    holdingPeriodMinutes,
    exitPrice,
    pnl,
    returnPct,
  };
};

/**
 * Compute a blended exit result across all three horizons (fast/medium/slow).
 *
 * Produces a `BlendedExitResult` whose `blendedPnl` is the weighted average
 * P&L across all three simulated holding periods.  Use `blendedPnl` and
 * `blendedReturnPct` as the canonical performance figures in attribution
 * records — they are more robust than any single-horizon result.
 *
 * @param executedSize   Number of units traded.
 * @param entryPrice     Simulated entry price.
 * @param direction      "long" | "short".
 * @param magnitudeBp    Absolute predicted move in basis points (sign ignored).
 * @param eventFamily    Used to look up per-family holding periods.
 * @param weights        Optional custom blend weights. Must sum to 1.0.
 */
export const computeBlendedExit = (
  executedSize: number,
  entryPrice: number,
  direction: "long" | "short",
  magnitudeBp: number,
  eventFamily: string,
  weights: BlendWeights = DEFAULT_BLEND_WEIGHTS,
): BlendedExitResult => {
  const horizonNames: HorizonName[] = ["fast", "medium", "slow"];

  const horizons = horizonNames.map((name) =>
    computeHorizonPnL(executedSize, entryPrice, direction, magnitudeBp, name, eventFamily),
  ) as [HorizonPnL, HorizonPnL, HorizonPnL];

  const [fast, medium, slow] = horizons;

  const blendedPnl = Number((
    weights.fast   * fast.pnl +
    weights.medium * medium.pnl +
    weights.slow   * slow.pnl
  ).toFixed(2));

  const blendedReturnPct = Number((
    weights.fast   * fast.returnPct +
    weights.medium * medium.returnPct +
    weights.slow   * slow.returnPct
  ).toFixed(4));

  const periods = resolveHorizonPeriods(eventFamily);

  const reason = [
    `blended_exit: ${weights.fast}×fast(${fast.pnl}) + ${weights.medium}×medium(${medium.pnl}) + ${weights.slow}×slow(${slow.pnl}) = ${blendedPnl}`,
    `periods[${eventFamily}]: fast=${periods.fast}min, medium=${periods.medium}min, slow=${periods.slow}min`,
    `magnitude_scales: fast=${HORIZON_PARAMS.fast.magnitudeScale}, medium=${HORIZON_PARAMS.medium.magnitudeScale}, slow=${HORIZON_PARAMS.slow.magnitudeScale}`,
    `slippage_bps: fast=${HORIZON_PARAMS.fast.slippageBps}, medium=${HORIZON_PARAMS.medium.slippageBps}, slow=${HORIZON_PARAMS.slow.slippageBps}`,
  ];

  return {
    horizons,
    blendedPnl,
    blendedReturnPct,
    weights,
    reason,
  };
};
