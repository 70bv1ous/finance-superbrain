/**
 * Risk constraints, constraint checking, and drawdown guards.
 *
 * This module is the enforcement layer between trade generation and execution.
 * It applies four independent constraints:
 *
 *   1. Per-asset position limit   — caps notional exposure per ticker
 *   2. Total portfolio exposure   — caps sum of all open notionals
 *   3. Event-family exposure      — caps aggregate for one macro event type
 *   4. Drawdown limit             — blocks all new trades when equity loss
 *                                   exceeds the configured threshold
 *
 * All functions are pure (no I/O, no side effects). Deterministic.
 */

import type { Portfolio, TradeDirection, EventFamily } from "./portfolio.js";
import { computeAssetExposure, computeTotalExposure } from "./portfolio.js";

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * Hard risk limits for a portfolio simulation run.
 * All monetary values are in the same currency as the portfolio's cash field.
 */
export type RiskConstraints = {
  /**
   * Maximum notional allocated to a single asset ticker.
   * Example: 50_000 → no more than $50k in SPY.
   */
  max_position_per_asset: number;
  /**
   * Maximum aggregate notional across all open positions.
   * Example: 200_000 → total book cannot exceed $200k gross.
   */
  max_total_exposure: number;
  /**
   * Maximum aggregate notional for one event family (CPI, FOMC, or NFP).
   * Prevents over-concentration in a single macro catalyst.
   * Example: 100_000 → CPI trades cannot exceed $100k combined.
   */
  max_event_family_exposure: number;
  /**
   * Maximum tolerated loss as a fraction of starting cash.
   * When portfolio equity falls below (1 - drawdown_limit) × starting_cash,
   * all further trade execution is blocked.
   * Example: 0.10 → block when equity drops more than 10%.
   */
  drawdown_limit: number;
};

export type RiskFlagSeverity = "info" | "warning" | "block";

/**
 * A risk flag is raised when a constraint is triggered during trade checking.
 *
 *   info     — noted but no action taken (e.g. no exposure to report)
 *   warning  — trade allowed but size was reduced
 *   block    — trade was fully blocked
 */
export type RiskFlag = {
  type:
    | "per_asset_limit"
    | "total_exposure_limit"
    | "event_family_limit"
    | "drawdown_limit"
    | "zero_size"
    | "mixed_direction_skipped";
  asset?: string;
  event_family?: EventFamily;
  message: string;
  severity: RiskFlagSeverity;
  /** Requested notional before constraint was applied. */
  requested_notional?: number;
  /** Allowed notional after constraint was applied. */
  allowed_notional?: number;
};

/**
 * Result of checking a single trade signal against all risk constraints.
 */
export type RiskCheckResult = {
  /** Whether the trade is allowed (false = fully blocked). */
  allowed: boolean;
  /** Final adjusted size after applying all active constraints. Capped at 2dp. */
  adjusted_size: number;
  /** All flags raised during the check (may include reductions that still allowed). */
  flags: RiskFlag[];
};

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * Conservative defaults for a $1M paper portfolio.
 */
export const createRiskConstraints = (
  overrides?: Partial<RiskConstraints>,
): RiskConstraints => ({
  max_position_per_asset: 50_000,
  max_total_exposure: 200_000,
  max_event_family_exposure: 100_000,
  drawdown_limit: 0.10,
  ...overrides,
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

const round2 = (v: number): number => Number(v.toFixed(2));

// ─── Core constraint check ────────────────────────────────────────────────────

/**
 * Check a proposed trade against all active risk constraints.
 *
 * Constraints are applied in priority order:
 *   1. Drawdown limit  (blocks everything)
 *   2. Per-asset limit (caps notional for this asset)
 *   3. Total exposure  (caps portfolio gross)
 *   4. Event family    (caps macro-catalyst concentration)
 *
 * Each constraint may reduce `adjusted_size` but will not increase it.
 * If the final size reaches zero, `allowed` is set to false.
 *
 * @param asset            Ticker being traded.
 * @param direction        "long" or "short".
 * @param requestedSize    Units requested by the sizing function.
 * @param entryPrice       Simulated price per unit.
 * @param portfolio        Current portfolio state.
 * @param constraints      Active risk limits.
 * @param eventFamily      Macro event family for this trade.
 * @param familyExposure   Current notional already allocated to this family.
 * @param startingCash     Initial portfolio cash (for drawdown reference).
 */
export const checkRiskConstraints = (
  asset: string,
  _direction: TradeDirection,
  requestedSize: number,
  entryPrice: number,
  portfolio: Portfolio,
  constraints: RiskConstraints,
  eventFamily: EventFamily,
  familyExposure: number,
  startingCash: number,
): RiskCheckResult => {
  const flags: RiskFlag[] = [];
  let size = requestedSize;

  // ── 1. Drawdown guard ──────────────────────────────────────────────────────

  const maxAllowedEquity = startingCash * (1 - constraints.drawdown_limit);
  if (portfolio.total_equity < maxAllowedEquity) {
    flags.push({
      type: "drawdown_limit",
      message:
        `Portfolio equity ${portfolio.total_equity.toFixed(0)} is below drawdown limit.` +
        ` All new trades blocked.`,
      severity: "block",
    });
    return { allowed: false, adjusted_size: 0, flags };
  }

  // ── 2. Per-asset limit ─────────────────────────────────────────────────────

  const existingAssetNotional = computeAssetExposure(portfolio, asset);
  const assetCapacity = constraints.max_position_per_asset - existingAssetNotional;

  if (assetCapacity <= 0) {
    flags.push({
      type: "per_asset_limit",
      asset,
      message: `Asset ${asset} is already at max position limit (${constraints.max_position_per_asset}).`,
      severity: "block",
      requested_notional: round2(size * entryPrice),
      allowed_notional: 0,
    });
    return { allowed: false, adjusted_size: 0, flags };
  }

  const maxSizeForAsset = assetCapacity / entryPrice;
  if (size > maxSizeForAsset) {
    flags.push({
      type: "per_asset_limit",
      asset,
      message:
        `${asset} position reduced: requested ${round2(size * entryPrice)},` +
        ` allowed ${round2(assetCapacity)} (per-asset limit).`,
      severity: "warning",
      requested_notional: round2(size * entryPrice),
      allowed_notional: round2(assetCapacity),
    });
    size = maxSizeForAsset;
  }

  // ── 3. Total portfolio exposure ────────────────────────────────────────────

  const currentTotalNotional = computeTotalExposure(portfolio);
  const totalCapacity = constraints.max_total_exposure - currentTotalNotional;

  if (totalCapacity <= 0) {
    flags.push({
      type: "total_exposure_limit",
      asset,
      message: `Total exposure limit reached (${constraints.max_total_exposure}). Trade blocked.`,
      severity: "block",
      requested_notional: round2(size * entryPrice),
      allowed_notional: 0,
    });
    return { allowed: false, adjusted_size: 0, flags };
  }

  const maxSizeForTotal = totalCapacity / entryPrice;
  if (size > maxSizeForTotal) {
    flags.push({
      type: "total_exposure_limit",
      asset,
      message:
        `${asset} reduced by total-exposure limit: requested ${round2(size * entryPrice)},` +
        ` allowed ${round2(totalCapacity)}.`,
      severity: "warning",
      requested_notional: round2(size * entryPrice),
      allowed_notional: round2(totalCapacity),
    });
    size = maxSizeForTotal;
  }

  // ── 4. Event-family exposure ───────────────────────────────────────────────

  const familyCapacity = constraints.max_event_family_exposure - familyExposure;

  if (familyCapacity <= 0) {
    flags.push({
      type: "event_family_limit",
      asset,
      event_family: eventFamily,
      message:
        `${eventFamily.toUpperCase()} family exposure limit reached` +
        ` (${constraints.max_event_family_exposure}). Trade blocked.`,
      severity: "block",
      requested_notional: round2(size * entryPrice),
      allowed_notional: 0,
    });
    return { allowed: false, adjusted_size: 0, flags };
  }

  const maxSizeForFamily = familyCapacity / entryPrice;
  if (size > maxSizeForFamily) {
    flags.push({
      type: "event_family_limit",
      asset,
      event_family: eventFamily,
      message:
        `${asset} reduced by ${eventFamily.toUpperCase()} family limit:` +
        ` requested ${round2(size * entryPrice)}, allowed ${round2(familyCapacity)}.`,
      severity: "warning",
      requested_notional: round2(size * entryPrice),
      allowed_notional: round2(familyCapacity),
    });
    size = maxSizeForFamily;
  }

  // ── Final size check ───────────────────────────────────────────────────────

  const finalSize = round2(size);

  if (finalSize <= 0) {
    flags.push({
      type: "zero_size",
      asset,
      message: `Trade in ${asset} resulted in zero size after constraints. Blocked.`,
      severity: "block",
    });
    return { allowed: false, adjusted_size: 0, flags };
  }

  return { allowed: true, adjusted_size: finalSize, flags };
};
