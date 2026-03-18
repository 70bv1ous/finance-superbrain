/**
 * Portfolio & Position types and state helpers.
 *
 * Pure data types and factory functions only — no async, no I/O, no
 * external dependencies. Deterministic and fully testable.
 *
 * Design decisions:
 *  - Positions are stored as Record<ticker, Position> for easy lookup.
 *  - Sizes are in "units" (shares/contracts). Notional = size × entry_price.
 *  - A simulated entry price of 100 is used for all assets (normalized,
 *    paper-trading convention). This keeps position sizing intuitive:
 *    size = 10 → $1,000 notional.
 *  - Portfolio total_equity = cash + unrealized_pnl.
 *    realized_pnl accumulates closed-trade profits independently so it can
 *    be inspected without affecting cash accounting.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Simulated price for all assets in paper-trading mode. */
export const SIMULATED_PRICE = 100;

/** Default starting cash for a new paper portfolio. */
export const DEFAULT_STARTING_CASH = 1_000_000;

// ─── Core types ───────────────────────────────────────────────────────────────

export type TradeDirection = "long" | "short";

export type EventFamily = "cpi" | "fomc" | "nfp";

/**
 * An open or recently-closed position in a single asset.
 *
 * `pnl` is the simulated P&L for this position, calculated at close time
 * from `expected_magnitude_bp`.  It is 0 for positions that have not yet
 * been simulated to close.
 */
export type Position = {
  /** Asset ticker (e.g. "SPY", "TLT", "DXY"). */
  asset: string;
  /** Long = bought expecting up; short = sold expecting down. */
  direction: TradeDirection;
  /** Number of units (shares/contracts). */
  size: number;
  /** Simulated entry price per unit. */
  entry_price: number;
  /** Simulated current / exit price per unit (equals entry_price before close). */
  current_price: number;
  /**
   * Simulated P&L for this position.
   * Positive when prediction is directionally correct.
   * Calculated as: size × entry_price × magnitude_bp / 10_000
   */
  pnl: number;
};

/**
 * A paper-trading portfolio snapshot.
 *
 * `positions` holds the most-recent position per asset for this simulation
 * run.  For event-based macro trading, positions are opened and closed
 * within a single `runPortfolioSimulation` call.
 */
export type Portfolio = {
  /** Most-recent simulated position per asset ticker. */
  positions: Record<string, Position>;
  /** Remaining unallocated cash (reduced by notional of open positions). */
  cash: number;
  /**
   * Portfolio total equity = cash + sum of open position notionals.
   * Updated after each trade execution.
   */
  total_equity: number;
  /** Cumulative closed-trade P&L. Increases as positions are closed. */
  realized_pnl: number;
  /**
   * Sum of `pnl` across all current positions.
   * For simulated event-based trading, this equals realized_pnl because
   * positions are immediately closed at the simulated outcome price.
   */
  unrealized_pnl: number;
};

// ─── Factory helpers ──────────────────────────────────────────────────────────

/**
 * Create a fresh paper portfolio with the given starting capital.
 */
export const createPortfolio = (
  startingCash = DEFAULT_STARTING_CASH,
): Portfolio => ({
  positions: {},
  cash: startingCash,
  total_equity: startingCash,
  realized_pnl: 0,
  unrealized_pnl: 0,
});

/**
 * Compute total notional exposure across all open positions.
 * Notional = size × entry_price for each position.
 */
export const computeTotalExposure = (portfolio: Portfolio): number =>
  Object.values(portfolio.positions).reduce(
    (sum, pos) => sum + pos.size * pos.entry_price,
    0,
  );

/**
 * Compute total notional exposure for a specific asset ticker.
 * Returns 0 when no position exists.
 */
export const computeAssetExposure = (
  portfolio: Portfolio,
  asset: string,
): number => {
  const pos = portfolio.positions[asset];
  return pos ? pos.size * pos.entry_price : 0;
};

/**
 * Recalculate and return updated portfolio totals after a set of P&L changes.
 * Does not mutate the input.
 */
export const recalculatePortfolioTotals = (portfolio: Portfolio): Portfolio => {
  const unrealized_pnl = Object.values(portfolio.positions).reduce(
    (sum, pos) => sum + pos.pnl,
    0,
  );
  const total_equity = portfolio.cash + unrealized_pnl;

  return { ...portfolio, unrealized_pnl, total_equity };
};
