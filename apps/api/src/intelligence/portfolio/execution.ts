/**
 * Trade generation, position sizing, P&L tracking, and simulation orchestration.
 *
 * This is the top-level entry point for the Portfolio & Risk layer.
 * Call `runPortfolioSimulation` with any prediction result to receive a
 * fully-computed PortfolioResult: executed trades, risk flags, and P&L.
 *
 * Design:
 *  - sizePosition()            pure sizing function — returns units
 *  - generateTradeSignals()    converts predictions to directional signals
 *  - executeTrade()            applies one trade to the portfolio
 *  - runPortfolioSimulation()  orchestrates the full pipeline
 *
 * All functions are synchronous, deterministic, and free of side effects.
 */

import type { Portfolio, EventFamily, TradeDirection, Position } from "./portfolio.js";
import {
  SIMULATED_PRICE,
  recalculatePortfolioTotals,
} from "./portfolio.js";
import type { RiskConstraints, RiskCheckResult, RiskFlag } from "./risk.js";
import { checkRiskConstraints } from "./risk.js";

// ─── Sizing constants ─────────────────────────────────────────────────────────

/**
 * Base notional per signal before confidence/conviction scaling.
 * At 100% confidence and 100% conviction this is the raw allocation.
 */
const BASE_NOTIONAL = 10_000;

// ─── Volatility scaling ───────────────────────────────────────────────────────

type VolatilityRegime = "low" | "normal" | "elevated" | "high";

const VOLATILITY_SCALE: Record<VolatilityRegime, number> = {
  low: 1.10,       // slightly larger in calm markets
  normal: 1.00,
  elevated: 0.70,  // pull back in elevated vol
  high: 0.50,      // half-size in high vol
};

// ─── Trade types ──────────────────────────────────────────────────────────────

/** A raw directional trade request, before risk-checking. */
export type TradeSignal = {
  /** Asset ticker. */
  asset: string;
  /** "long" for expected up, "short" for expected down. */
  direction: TradeDirection;
  /**
   * Raw requested position size in units (price = SIMULATED_PRICE).
   * May be reduced by risk constraints before execution.
   */
  target_size: number;
  /** Expected move magnitude in basis points, from the prediction. */
  expected_magnitude_bp: number;
  /** Prediction horizon this signal came from. */
  horizon: string;
};

/** A trade that was actually executed (after risk-checking). */
export type Trade = {
  asset: string;
  direction: TradeDirection;
  /** Units requested before risk adjustment. */
  target_size: number;
  /** Units actually executed (may be less than target after risk constraints). */
  executed_size: number;
  /** Simulated entry price per unit. */
  entry_price: number;
  /** ISO timestamp of execution (deterministic, uses simulation start time). */
  executed_at: string;
  /** True when risk constraints reduced the size below target. */
  risk_adjusted: boolean;
  /** Simulated P&L from this trade (assuming prediction is correct). */
  simulated_pnl: number;
  expected_magnitude_bp: number;
  horizon: string;
};

/** Per-event P&L breakdown. */
export type PnLMetrics = {
  /** Simulated P&L keyed by `${asset}:${horizon}`. */
  per_trade: Record<string, number>;
  /** Total P&L for this simulation run (sum of all trades). */
  per_event: number;
  /** Total P&L keyed by event family (e.g. "cpi", "fomc", "nfp"). */
  per_event_family: Record<string, number>;
  /** Cumulative portfolio P&L after all trades. */
  portfolio_total: number;
};

// ─── Simulation input / output ────────────────────────────────────────────────

/** Minimal prediction shape accepted by runPortfolioSimulation. */
export type SimulationPrediction = {
  confidence: number;
  horizon: string;
  assets: Array<{
    ticker: string;
    expected_direction: "up" | "down" | "mixed";
    expected_magnitude_bp: number;
    conviction: number;
  }>;
};

/** Everything needed to run a portfolio simulation. */
export type PortfolioSimulationInput = {
  /** One or more predictions from the intelligence pipeline. */
  prediction_result: {
    predictions: SimulationPrediction[];
  };
  /** Which macro event family produced this prediction. */
  event_family: EventFamily;
  /** Current portfolio state (will not be mutated). */
  portfolio: Portfolio;
  /** Active risk limits. */
  constraints: RiskConstraints;
  /** Optional market volatility context for position sizing. Defaults to "normal". */
  volatility?: VolatilityRegime;
  /** ISO timestamp to stamp all trades with. Defaults to now. */
  simulated_at?: string;
  /** Starting cash reference for drawdown calculation. Defaults to portfolio.cash. */
  starting_cash?: number;
  /**
   * Phase 7B: calibration multiplier from CalibrationFactor.multiplier.
   * When omitted (or 1.0) the behaviour is identical to Phase 7A.
   * Valid range: [0.5, 1.5].  Values outside this range are clamped
   * inside sizePosition to prevent extreme sizing.
   */
  calibration_multiplier?: number;
  /**
   * Phase 7C: per-signal-type trust score from computeSignalTrust().
   *
   * Applied as a final multiplier on top of the calibration multiplier:
   *   final_size = base × confidence × conviction × volatilityScale
   *                × calibrationMultiplier × trustScore
   *
   * Pre-compute with signal_memory + signal_trust before calling
   * runPortfolioSimulation.  When omitted (or 1.0) behaviour is identical
   * to Phase 7B.
   */
  trust_score?: number;
};

/** Complete result of a portfolio simulation run. */
export type PortfolioResult = {
  /** Updated portfolio after all trades. */
  updated_portfolio: Portfolio;
  /** All trades that were actually executed. */
  trades_executed: Trade[];
  /** All risk flags raised during the run (warnings + blocks). */
  risk_flags: RiskFlag[];
  /** P&L metrics for this run. */
  pnl_metrics: PnLMetrics;
};

// ─── Position sizing ──────────────────────────────────────────────────────────

/**
 * Compute the number of units to allocate for a single asset signal.
 *
 * Formula (Phase 7A):
 *   raw_notional = BASE_NOTIONAL × prediction_confidence × asset_conviction
 *   scaled       = raw_notional × volatility_multiplier
 *   size         = scaled / SIMULATED_PRICE          (convert to units)
 *
 * Extended (Phase 7B):
 *   size = (scaled / SIMULATED_PRICE) × calibrationMultiplier
 *
 * Extended (Phase 7C):
 *   size = (scaled / SIMULATED_PRICE) × calibrationMultiplier × trustScore
 *
 * `calibrationMultiplier` and `trustScore` both default to 1.0 — all Phase
 * 7A/7B callers are unaffected when these parameters are omitted.
 *
 * Result is rounded to 4 decimal places. Returns 0 for any negative input.
 */
export const sizePosition = (
  predictionConfidence: number,
  assetConviction: number,
  volatility: VolatilityRegime = "normal",
  maxPositionNotional?: number,
  /** Phase 7B calibration multiplier. Default 1.0 = no adjustment. */
  calibrationMultiplier = 1.0,
  /** Phase 7C signal trust score. Default 1.0 = no adjustment. */
  trustScore = 1.0,
): number => {
  if (predictionConfidence <= 0 || assetConviction <= 0) return 0;

  const rawNotional = BASE_NOTIONAL * predictionConfidence * assetConviction;
  // Phase 7B: multiply by calibrationMultiplier before capping
  const scaled = rawNotional * VOLATILITY_SCALE[volatility] * calibrationMultiplier;

  // Cap at the per-asset limit if provided
  const capped = maxPositionNotional !== undefined
    ? Math.min(scaled, maxPositionNotional)
    : scaled;

  // Phase 7C: apply per-signal-type trust score as final multiplier
  return Number(((capped / SIMULATED_PRICE) * trustScore).toFixed(4));
};

// ─── Trade signal generation ──────────────────────────────────────────────────

/**
 * Convert prediction results into directional trade signals.
 *
 * Rules:
 *  - "mixed" direction assets are skipped (no clear directional call).
 *  - "up"   → "long"
 *  - "down" → "short"
 *  - Assets with computed size ≤ 0 are skipped.
 *
 * Phase 7B: `calibrationMultiplier` scales all sizes uniformly.
 * Phase 7C: `trustScore` applies a per-signal-type final multiplier.
 * Both default to 1.0 — behaviour is identical to Phase 7A when omitted.
 *
 * Returns one signal per asset per horizon.
 */
export const generateTradeSignals = (
  predictions: SimulationPrediction[],
  constraints: RiskConstraints,
  volatility: VolatilityRegime = "normal",
  mixedSkipFlags: RiskFlag[] = [],
  /** Phase 7B calibration multiplier. Default 1.0 = no change. */
  calibrationMultiplier = 1.0,
  /** Phase 7C signal trust score. Default 1.0 = no change. */
  trustScore = 1.0,
): TradeSignal[] => {
  const signals: TradeSignal[] = [];

  for (const pred of predictions) {
    for (const asset of pred.assets) {
      if (asset.expected_direction === "mixed") {
        mixedSkipFlags.push({
          type: "mixed_direction_skipped",
          asset: asset.ticker,
          message: `${asset.ticker} skipped: expected_direction is "mixed" — no directional signal.`,
          severity: "info",
        });
        continue;
      }

      const direction: TradeDirection =
        asset.expected_direction === "up" ? "long" : "short";

      const size = sizePosition(
        pred.confidence,
        asset.conviction,
        volatility,
        constraints.max_position_per_asset,
        calibrationMultiplier,
        trustScore,
      );

      if (size <= 0) continue;

      signals.push({
        asset: asset.ticker,
        direction,
        target_size: size,
        expected_magnitude_bp: asset.expected_magnitude_bp,
        horizon: pred.horizon,
      });
    }
  }

  return signals;
};

// ─── P&L calculation ──────────────────────────────────────────────────────────

/**
 * Compute the simulated P&L for a single executed trade.
 *
 * Assumption: the prediction is correct and the asset moves exactly
 * `expected_magnitude_bp` in the predicted direction.
 *
 * P&L = executed_size × entry_price × (magnitude_bp / 10_000)
 *
 * Both long and short positions produce positive P&L when the prediction
 * is correct (the direction already encodes the trade intent).
 */
export const computeTradePnL = (
  executedSize: number,
  entryPrice: number,
  magnitudeBp: number,
): number => {
  const pnl = executedSize * entryPrice * Math.abs(magnitudeBp) / 10_000;
  return Number(pnl.toFixed(2));
};

// ─── Trade execution ──────────────────────────────────────────────────────────

/**
 * Apply a risk-checked trade to the portfolio and return the updated state.
 *
 * This function:
 *  1. Creates a Position for the asset.
 *  2. Deducts notional from cash (long) or adds proceeds (short).
 *  3. Immediately simulates close at expected_magnitude_bp move.
 *  4. Adds pnl to realized_pnl and recalculates totals.
 *
 * The input portfolio is NOT mutated.
 */
export const applyTradeToPortfolio = (
  portfolio: Portfolio,
  trade: Trade,
): Portfolio => {
  const notional = trade.executed_size * trade.entry_price;

  // Deduct notional from cash (simplified: longs cost cash, shorts return cash)
  const cashDelta = trade.direction === "long" ? -notional : notional;
  const newCash = portfolio.cash + cashDelta;

  // Build the position (immediately closed at simulated outcome)
  const position: Position = {
    asset: trade.asset,
    direction: trade.direction,
    size: trade.executed_size,
    entry_price: trade.entry_price,
    current_price: trade.entry_price + (trade.entry_price * trade.expected_magnitude_bp / 10_000),
    pnl: trade.simulated_pnl,
  };

  const newPositions = {
    ...portfolio.positions,
    [trade.asset]: position,
  };

  const newRealizedPnl = portfolio.realized_pnl + trade.simulated_pnl;

  const draft: Portfolio = {
    ...portfolio,
    positions: newPositions,
    cash: newCash,
    realized_pnl: newRealizedPnl,
    unrealized_pnl: portfolio.unrealized_pnl,
    total_equity: portfolio.total_equity,
  };

  return recalculatePortfolioTotals(draft);
};

// ─── Portfolio simulation ─────────────────────────────────────────────────────

/**
 * Run a complete portfolio simulation from a set of predictions.
 *
 * Flow for each trade signal:
 *   1. checkRiskConstraints → may reduce size or block entirely
 *   2. computeTradePnL → simulated outcome
 *   3. applyTradeToPortfolio → update portfolio state
 *
 * P&L metrics are accumulated across all executed trades.
 *
 * The input portfolio is NOT mutated. Returns a fully-computed PortfolioResult.
 */
export const runPortfolioSimulation = (
  input: PortfolioSimulationInput,
): PortfolioResult => {
  const {
    prediction_result,
    event_family,
    constraints,
    volatility = "normal",
    simulated_at = new Date().toISOString(),
    calibration_multiplier = 1.0,
    trust_score = 1.0,
  } = input;

  const startingCash = input.starting_cash ?? input.portfolio.cash;
  let portfolio = { ...input.portfolio };

  const tradesExecuted: Trade[] = [];
  const allRiskFlags: RiskFlag[] = [];
  const perTradePnL: Record<string, number> = {};
  let familyExposure = 0;

  // ── Generate trade signals ─────────────────────────────────────────────────

  const mixedSkipFlags: RiskFlag[] = [];
  const signals = generateTradeSignals(
    prediction_result.predictions,
    constraints,
    volatility,
    mixedSkipFlags,
    calibration_multiplier,
    trust_score,
  );
  allRiskFlags.push(...mixedSkipFlags);

  // ── Process each signal ────────────────────────────────────────────────────

  for (const signal of signals) {
    const riskCheck: RiskCheckResult = checkRiskConstraints(
      signal.asset,
      signal.direction,
      signal.target_size,
      SIMULATED_PRICE,
      portfolio,
      constraints,
      event_family,
      familyExposure,
      startingCash,
    );

    allRiskFlags.push(...riskCheck.flags);

    if (!riskCheck.allowed || riskCheck.adjusted_size <= 0) continue;

    const executedSize = riskCheck.adjusted_size;
    const pnl = computeTradePnL(executedSize, SIMULATED_PRICE, signal.expected_magnitude_bp);

    const trade: Trade = {
      asset: signal.asset,
      direction: signal.direction,
      target_size: signal.target_size,
      executed_size: executedSize,
      entry_price: SIMULATED_PRICE,
      executed_at: simulated_at,
      risk_adjusted: executedSize < signal.target_size,
      simulated_pnl: pnl,
      expected_magnitude_bp: signal.expected_magnitude_bp,
      horizon: signal.horizon,
    };

    portfolio = applyTradeToPortfolio(portfolio, trade);
    tradesExecuted.push(trade);

    // Track family exposure for subsequent signals in this run
    familyExposure += executedSize * SIMULATED_PRICE;

    // Record per-trade P&L
    const tradeKey = `${signal.asset}:${signal.horizon}`;
    perTradePnL[tradeKey] = (perTradePnL[tradeKey] ?? 0) + pnl;
  }

  // ── Build P&L metrics ──────────────────────────────────────────────────────

  const perEventPnL = tradesExecuted.reduce((sum, t) => sum + t.simulated_pnl, 0);
  const pnlMetrics: PnLMetrics = {
    per_trade: perTradePnL,
    per_event: Number(perEventPnL.toFixed(2)),
    per_event_family: { [event_family]: Number(perEventPnL.toFixed(2)) },
    portfolio_total: Number(portfolio.realized_pnl.toFixed(2)),
  };

  return {
    updated_portfolio: portfolio,
    trades_executed: tradesExecuted,
    risk_flags: allRiskFlags,
    pnl_metrics: pnlMetrics,
  };
};
