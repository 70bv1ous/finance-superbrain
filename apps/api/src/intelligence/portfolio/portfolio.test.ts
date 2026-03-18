import { describe, it, expect, beforeEach } from "vitest";

import {
  createPortfolio,
  computeTotalExposure,
  computeAssetExposure,
  recalculatePortfolioTotals,
  SIMULATED_PRICE,
  DEFAULT_STARTING_CASH,
} from "./portfolio.js";
import type { Portfolio } from "./portfolio.js";

import {
  createRiskConstraints,
  checkRiskConstraints,
} from "./risk.js";
import type { RiskConstraints } from "./risk.js";

import {
  sizePosition,
  generateTradeSignals,
  computeTradePnL,
  applyTradeToPortfolio,
  runPortfolioSimulation,
} from "./execution.js";
import type {
  Trade,
  SimulationPrediction,
  PortfolioSimulationInput,
} from "./execution.js";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const buildPrediction = (
  overrides?: Partial<{
    confidence: number;
    horizon: string;
    ticker: string;
    direction: "up" | "down" | "mixed";
    magnitude_bp: number;
    conviction: number;
  }>,
): SimulationPrediction => ({
  confidence: overrides?.confidence ?? 0.75,
  horizon: overrides?.horizon ?? "1d",
  assets: [
    {
      ticker: overrides?.ticker ?? "SPY",
      expected_direction: overrides?.direction ?? "up",
      expected_magnitude_bp: overrides?.magnitude_bp ?? 50,
      conviction: overrides?.conviction ?? 0.80,
    },
  ],
});

const buildTrade = (overrides?: Partial<Trade>): Trade => ({
  asset: "SPY",
  direction: "long",
  target_size: 10,
  executed_size: 10,
  entry_price: SIMULATED_PRICE,
  executed_at: "2026-03-18T00:00:00Z",
  risk_adjusted: false,
  simulated_pnl: 50,
  expected_magnitude_bp: 50,
  horizon: "1d",
  ...overrides,
});

// ─── createPortfolio ──────────────────────────────────────────────────────────

describe("createPortfolio", () => {
  it("creates a portfolio with default starting cash", () => {
    const p = createPortfolio();
    expect(p.cash).toBe(DEFAULT_STARTING_CASH);
    expect(p.total_equity).toBe(DEFAULT_STARTING_CASH);
    expect(p.realized_pnl).toBe(0);
    expect(p.unrealized_pnl).toBe(0);
    expect(p.positions).toEqual({});
  });

  it("accepts a custom starting cash", () => {
    const p = createPortfolio(500_000);
    expect(p.cash).toBe(500_000);
    expect(p.total_equity).toBe(500_000);
  });
});

// ─── computeTotalExposure ─────────────────────────────────────────────────────

describe("computeTotalExposure", () => {
  it("returns 0 for an empty portfolio", () => {
    expect(computeTotalExposure(createPortfolio())).toBe(0);
  });

  it("sums notional across all positions", () => {
    const p: Portfolio = {
      ...createPortfolio(),
      positions: {
        SPY: { asset: "SPY", direction: "long", size: 10, entry_price: 100, current_price: 100, pnl: 0 },
        TLT: { asset: "TLT", direction: "short", size: 5, entry_price: 100, current_price: 100, pnl: 0 },
      },
    };
    expect(computeTotalExposure(p)).toBe(1500); // (10 + 5) × 100
  });
});

// ─── computeAssetExposure ─────────────────────────────────────────────────────

describe("computeAssetExposure", () => {
  it("returns 0 for an asset not in the portfolio", () => {
    expect(computeAssetExposure(createPortfolio(), "SPY")).toBe(0);
  });

  it("returns notional for an existing position", () => {
    const p: Portfolio = {
      ...createPortfolio(),
      positions: {
        SPY: { asset: "SPY", direction: "long", size: 20, entry_price: 100, current_price: 100, pnl: 0 },
      },
    };
    expect(computeAssetExposure(p, "SPY")).toBe(2000);
    expect(computeAssetExposure(p, "TLT")).toBe(0);
  });
});

// ─── recalculatePortfolioTotals ───────────────────────────────────────────────

describe("recalculatePortfolioTotals", () => {
  it("computes unrealized_pnl and total_equity from positions", () => {
    const p: Portfolio = {
      ...createPortfolio(100_000),
      positions: {
        SPY: { asset: "SPY", direction: "long", size: 10, entry_price: 100, current_price: 100, pnl: 200 },
        TLT: { asset: "TLT", direction: "short", size: 5, entry_price: 100, current_price: 100, pnl: -50 },
      },
    };
    const result = recalculatePortfolioTotals(p);
    expect(result.unrealized_pnl).toBe(150);       // 200 + (-50)
    expect(result.total_equity).toBe(100_150);     // 100_000 + 150
  });

  it("does not mutate the input portfolio", () => {
    const p = createPortfolio();
    const result = recalculatePortfolioTotals(p);
    expect(result).not.toBe(p);
    expect(p.total_equity).toBe(DEFAULT_STARTING_CASH);
  });
});

// ─── createRiskConstraints ────────────────────────────────────────────────────

describe("createRiskConstraints", () => {
  it("returns sensible defaults", () => {
    const rc = createRiskConstraints();
    expect(rc.max_position_per_asset).toBe(50_000);
    expect(rc.max_total_exposure).toBe(200_000);
    expect(rc.max_event_family_exposure).toBe(100_000);
    expect(rc.drawdown_limit).toBe(0.10);
  });

  it("merges overrides", () => {
    const rc = createRiskConstraints({ max_position_per_asset: 5_000 });
    expect(rc.max_position_per_asset).toBe(5_000);
    expect(rc.max_total_exposure).toBe(200_000); // unchanged
  });
});

// ─── checkRiskConstraints ─────────────────────────────────────────────────────

describe("checkRiskConstraints", () => {
  let portfolio: Portfolio;
  let constraints: RiskConstraints;

  beforeEach(() => {
    portfolio = createPortfolio(1_000_000);
    constraints = createRiskConstraints();
  });

  it("allows a normal trade with no flags", () => {
    const result = checkRiskConstraints(
      "SPY", "long", 10, SIMULATED_PRICE,
      portfolio, constraints, "cpi", 0, 1_000_000,
    );
    expect(result.allowed).toBe(true);
    expect(result.adjusted_size).toBe(10);
    expect(result.flags).toHaveLength(0);
  });

  it("blocks trade when drawdown limit is breached", () => {
    const lostPortfolio: Portfolio = {
      ...portfolio,
      total_equity: 850_000, // 15% loss on a $1M portfolio
    };
    const result = checkRiskConstraints(
      "SPY", "long", 10, SIMULATED_PRICE,
      lostPortfolio, constraints, "cpi", 0, 1_000_000,
    );
    expect(result.allowed).toBe(false);
    expect(result.flags.some(f => f.type === "drawdown_limit")).toBe(true);
    expect(result.flags.find(f => f.type === "drawdown_limit")!.severity).toBe("block");
  });

  it("reduces size when per-asset limit would be exceeded", () => {
    const tightConstraints = createRiskConstraints({
      max_position_per_asset: 500,  // only $500 per asset
    });
    // Request 20 units @ $100 = $2000 notional, limit is $500 → max 5 units
    const result = checkRiskConstraints(
      "SPY", "long", 20, SIMULATED_PRICE,
      portfolio, tightConstraints, "cpi", 0, 1_000_000,
    );
    expect(result.allowed).toBe(true);
    expect(result.adjusted_size).toBeLessThanOrEqual(5);
    expect(result.flags.some(f => f.type === "per_asset_limit" && f.severity === "warning")).toBe(true);
  });

  it("blocks when per-asset position is already full", () => {
    const fullPortfolio: Portfolio = {
      ...portfolio,
      positions: {
        SPY: { asset: "SPY", direction: "long", size: 500, entry_price: 100, current_price: 100, pnl: 0 },
      },
    };
    // 500 units × $100 = $50k = max_position_per_asset
    const result = checkRiskConstraints(
      "SPY", "long", 10, SIMULATED_PRICE,
      fullPortfolio, constraints, "cpi", 0, 1_000_000,
    );
    expect(result.allowed).toBe(false);
    expect(result.flags.some(f => f.type === "per_asset_limit")).toBe(true);
  });

  it("reduces size when total exposure limit would be exceeded", () => {
    const tightConstraints = createRiskConstraints({
      max_total_exposure: 500, // only $500 total
    });
    const result = checkRiskConstraints(
      "SPY", "long", 20, SIMULATED_PRICE,
      portfolio, tightConstraints, "cpi", 0, 1_000_000,
    );
    expect(result.allowed).toBe(true);
    expect(result.adjusted_size).toBeLessThanOrEqual(5);
    expect(result.flags.some(f => f.type === "total_exposure_limit" && f.severity === "warning")).toBe(true);
  });

  it("blocks when total exposure is already at limit", () => {
    const saturatedPortfolio: Portfolio = {
      ...portfolio,
      positions: {
        TLT: { asset: "TLT", direction: "long", size: 2000, entry_price: 100, current_price: 100, pnl: 0 },
      },
    };
    const result = checkRiskConstraints(
      "SPY", "long", 10, SIMULATED_PRICE,
      saturatedPortfolio, constraints, "cpi", 0, 1_000_000,
    );
    expect(result.allowed).toBe(false);
    expect(result.flags.some(f => f.type === "total_exposure_limit")).toBe(true);
  });

  it("reduces size when event-family exposure limit would be exceeded", () => {
    // familyExposure already at 95_000, limit is 100_000
    const result = checkRiskConstraints(
      "SPY", "long", 100, SIMULATED_PRICE,
      portfolio, constraints, "cpi", 95_000, 1_000_000,
    );
    expect(result.allowed).toBe(true);
    expect(result.adjusted_size).toBeLessThanOrEqual(50); // only $5000 capacity left = 50 units
    expect(result.flags.some(f => f.type === "event_family_limit" && f.severity === "warning")).toBe(true);
  });

  it("blocks when event-family exposure is at limit", () => {
    const result = checkRiskConstraints(
      "SPY", "long", 10, SIMULATED_PRICE,
      portfolio, constraints, "fomc", 100_000, 1_000_000,
    );
    expect(result.allowed).toBe(false);
    expect(result.flags.some(f => f.type === "event_family_limit" && f.severity === "block")).toBe(true);
  });

  it("includes event_family in the flag when family limit fires", () => {
    const result = checkRiskConstraints(
      "SPY", "long", 10, SIMULATED_PRICE,
      portfolio, constraints, "nfp", 100_000, 1_000_000,
    );
    const familyFlag = result.flags.find(f => f.type === "event_family_limit");
    expect(familyFlag?.event_family).toBe("nfp");
  });
});

// ─── sizePosition ─────────────────────────────────────────────────────────────

describe("sizePosition", () => {
  it("returns a positive size for valid inputs", () => {
    expect(sizePosition(0.75, 0.80)).toBeGreaterThan(0);
  });

  it("scales with confidence", () => {
    const low = sizePosition(0.40, 0.80);
    const high = sizePosition(0.90, 0.80);
    expect(high).toBeGreaterThan(low);
  });

  it("scales with conviction", () => {
    const low = sizePosition(0.75, 0.40);
    const high = sizePosition(0.75, 0.90);
    expect(high).toBeGreaterThan(low);
  });

  it("reduces size in elevated volatility", () => {
    const normal = sizePosition(0.75, 0.80, "normal");
    const elevated = sizePosition(0.75, 0.80, "elevated");
    expect(elevated).toBeLessThan(normal);
  });

  it("reduces size more in high volatility than elevated", () => {
    const elevated = sizePosition(0.75, 0.80, "elevated");
    const high = sizePosition(0.75, 0.80, "high");
    expect(high).toBeLessThan(elevated);
  });

  it("slightly increases size in low volatility", () => {
    const normal = sizePosition(0.75, 0.80, "normal");
    const low = sizePosition(0.75, 0.80, "low");
    expect(low).toBeGreaterThan(normal);
  });

  it("returns 0 for zero confidence", () => {
    expect(sizePosition(0, 0.80)).toBe(0);
  });

  it("returns 0 for zero conviction", () => {
    expect(sizePosition(0.75, 0)).toBe(0);
  });

  it("respects max position notional cap", () => {
    const uncapped = sizePosition(1.0, 1.0, "normal");
    const capped = sizePosition(1.0, 1.0, "normal", 100);
    expect(capped).toBeLessThanOrEqual(1.0); // 100 / 100 = 1 unit max
    expect(capped).toBeLessThan(uncapped);
  });
});

// ─── generateTradeSignals ─────────────────────────────────────────────────────

describe("generateTradeSignals", () => {
  const constraints = createRiskConstraints();

  it("generates a long signal for expected_direction up", () => {
    const pred = buildPrediction({ direction: "up" });
    const signals = generateTradeSignals([pred], constraints);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.direction).toBe("long");
    expect(signals[0]!.asset).toBe("SPY");
  });

  it("generates a short signal for expected_direction down", () => {
    const pred = buildPrediction({ direction: "down" });
    const signals = generateTradeSignals([pred], constraints);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.direction).toBe("short");
  });

  it("skips mixed direction assets", () => {
    const pred = buildPrediction({ direction: "mixed" });
    const mixedFlags: any[] = [];
    const signals = generateTradeSignals([pred], constraints, "normal", mixedFlags);
    expect(signals).toHaveLength(0);
    expect(mixedFlags.some(f => f.type === "mixed_direction_skipped")).toBe(true);
  });

  it("produces one signal per asset per prediction", () => {
    const pred: SimulationPrediction = {
      confidence: 0.75,
      horizon: "1d",
      assets: [
        { ticker: "SPY", expected_direction: "up", expected_magnitude_bp: 50, conviction: 0.80 },
        { ticker: "TLT", expected_direction: "down", expected_magnitude_bp: 40, conviction: 0.70 },
        { ticker: "DXY", expected_direction: "up", expected_magnitude_bp: 30, conviction: 0.60 },
      ],
    };
    const signals = generateTradeSignals([pred], constraints);
    expect(signals).toHaveLength(3);
    const assets = signals.map(s => s.asset);
    expect(assets).toContain("SPY");
    expect(assets).toContain("TLT");
    expect(assets).toContain("DXY");
  });

  it("attaches expected_magnitude_bp and horizon to each signal", () => {
    const pred = buildPrediction({ horizon: "5d", magnitude_bp: 120 });
    const signals = generateTradeSignals([pred], constraints);
    expect(signals[0]!.expected_magnitude_bp).toBe(120);
    expect(signals[0]!.horizon).toBe("5d");
  });
});

// ─── computeTradePnL ─────────────────────────────────────────────────────────

describe("computeTradePnL", () => {
  it("produces positive P&L for a correct long trade", () => {
    // 10 units × $100 × 50bp / 10_000 = $5
    expect(computeTradePnL(10, 100, 50)).toBe(5);
  });

  it("produces positive P&L for a correct short trade (same formula)", () => {
    expect(computeTradePnL(10, 100, -50)).toBe(5); // abs(magnitude)
  });

  it("scales linearly with size", () => {
    const small = computeTradePnL(5, 100, 50);
    const large = computeTradePnL(20, 100, 50);
    expect(large).toBe(small * 4);
  });

  it("returns 0 for zero size", () => {
    expect(computeTradePnL(0, 100, 50)).toBe(0);
  });

  it("rounds to 2 decimal places", () => {
    const pnl = computeTradePnL(1, 100, 33);
    expect(pnl.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});

// ─── applyTradeToPortfolio ────────────────────────────────────────────────────

describe("applyTradeToPortfolio", () => {
  it("adds a position to the portfolio", () => {
    const portfolio = createPortfolio();
    const trade = buildTrade({ asset: "SPY", executed_size: 10, simulated_pnl: 50 });
    const updated = applyTradeToPortfolio(portfolio, trade);

    expect(updated.positions["SPY"]).toBeDefined();
    expect(updated.positions["SPY"]!.size).toBe(10);
    expect(updated.positions["SPY"]!.direction).toBe("long");
  });

  it("reduces cash for a long trade", () => {
    const portfolio = createPortfolio();
    const trade = buildTrade({ direction: "long", executed_size: 10, entry_price: 100 });
    const updated = applyTradeToPortfolio(portfolio, trade);
    expect(updated.cash).toBe(DEFAULT_STARTING_CASH - 1000); // 10 × 100
  });

  it("increases cash for a short trade", () => {
    const portfolio = createPortfolio();
    const trade = buildTrade({ direction: "short", executed_size: 10, entry_price: 100 });
    const updated = applyTradeToPortfolio(portfolio, trade);
    expect(updated.cash).toBe(DEFAULT_STARTING_CASH + 1000);
  });

  it("accumulates realized P&L across trades", () => {
    let portfolio = createPortfolio();
    portfolio = applyTradeToPortfolio(portfolio, buildTrade({ asset: "SPY", simulated_pnl: 100 }));
    portfolio = applyTradeToPortfolio(portfolio, buildTrade({ asset: "TLT", simulated_pnl: 50 }));
    expect(portfolio.realized_pnl).toBe(150);
  });

  it("does not mutate the input portfolio", () => {
    const portfolio = createPortfolio();
    applyTradeToPortfolio(portfolio, buildTrade());
    expect(portfolio.realized_pnl).toBe(0);
    expect(portfolio.positions).toEqual({});
  });

  it("recalculates total_equity after trade", () => {
    const portfolio = createPortfolio(100_000);
    const trade = buildTrade({
      direction: "long",
      executed_size: 10,
      entry_price: 100,
      simulated_pnl: 50,
    });
    const updated = applyTradeToPortfolio(portfolio, trade);
    // total_equity = cash + unrealized_pnl
    // cash = 100_000 - 1000 = 99_000; unrealized_pnl = 50 (position pnl)
    expect(updated.total_equity).toBe(99_050);
  });
});

// ─── runPortfolioSimulation ───────────────────────────────────────────────────

describe("runPortfolioSimulation", () => {
  const buildInput = (
    predictions: SimulationPrediction[] = [buildPrediction()],
    overrides?: Partial<PortfolioSimulationInput>,
  ): PortfolioSimulationInput => ({
    prediction_result: { predictions },
    event_family: "cpi",
    portfolio: createPortfolio(),
    constraints: createRiskConstraints(),
    simulated_at: "2026-03-18T00:00:00Z",
    ...overrides,
  });

  it("returns a PortfolioResult with all required fields", () => {
    const result = runPortfolioSimulation(buildInput());
    expect(result).toHaveProperty("updated_portfolio");
    expect(result).toHaveProperty("trades_executed");
    expect(result).toHaveProperty("risk_flags");
    expect(result).toHaveProperty("pnl_metrics");
  });

  it("executes trades for valid directional predictions", () => {
    const result = runPortfolioSimulation(buildInput());
    expect(result.trades_executed.length).toBeGreaterThan(0);
    expect(result.trades_executed[0]!.asset).toBe("SPY");
    expect(result.trades_executed[0]!.direction).toBe("long");
  });

  it("records per-trade P&L in metrics", () => {
    const result = runPortfolioSimulation(buildInput());
    expect(Object.keys(result.pnl_metrics.per_trade).length).toBeGreaterThan(0);
    expect(result.pnl_metrics.per_event).toBeGreaterThanOrEqual(0);
  });

  it("P&L is positive when all predictions are directionally correct", () => {
    const pred = buildPrediction({ direction: "up", magnitude_bp: 100, conviction: 0.9 });
    const result = runPortfolioSimulation(buildInput([pred]));
    expect(result.pnl_metrics.per_event).toBeGreaterThan(0);
    expect(result.updated_portfolio.realized_pnl).toBeGreaterThan(0);
  });

  it("skips mixed-direction assets and adds info flags", () => {
    const pred = buildPrediction({ direction: "mixed" });
    const result = runPortfolioSimulation(buildInput([pred]));
    expect(result.trades_executed).toHaveLength(0);
    expect(result.risk_flags.some(f => f.type === "mixed_direction_skipped")).toBe(true);
  });

  it("handles multiple predictions (multi-horizon)", () => {
    const predictions: SimulationPrediction[] = [
      buildPrediction({ horizon: "1d", ticker: "SPY" }),
      buildPrediction({ horizon: "5d", ticker: "TLT", direction: "down" }),
    ];
    const result = runPortfolioSimulation(buildInput(predictions));
    expect(result.trades_executed.length).toBeGreaterThanOrEqual(2);
    const assets = result.trades_executed.map(t => t.asset);
    expect(assets).toContain("SPY");
    expect(assets).toContain("TLT");
  });

  it("applies drawdown block and produces no trades", () => {
    const lostPortfolio = createPortfolio();
    // Manually set equity below drawdown threshold (10% loss on $1M)
    const degradedPortfolio = {
      ...lostPortfolio,
      total_equity: 800_000,  // 20% loss — over the 10% limit
    };
    const result = runPortfolioSimulation(buildInput([buildPrediction()], {
      portfolio: degradedPortfolio,
      starting_cash: 1_000_000,
    }));
    expect(result.trades_executed).toHaveLength(0);
    expect(result.risk_flags.some(f => f.type === "drawdown_limit")).toBe(true);
  });

  it("respects volatility regime — elevated vol produces smaller trades", () => {
    const normalResult = runPortfolioSimulation(buildInput([buildPrediction()], { volatility: "normal" }));
    const elevatedResult = runPortfolioSimulation(buildInput([buildPrediction()], { volatility: "elevated" }));

    const normalSize = normalResult.trades_executed[0]?.executed_size ?? 0;
    const elevatedSize = elevatedResult.trades_executed[0]?.executed_size ?? 0;
    expect(elevatedSize).toBeLessThan(normalSize);
  });

  it("accumulates per_event_family P&L under the correct key", () => {
    const result = runPortfolioSimulation(buildInput([buildPrediction()], {
      event_family: "fomc",
    }));
    expect(result.pnl_metrics.per_event_family["fomc"]).toBeDefined();
    expect(result.pnl_metrics.per_event_family["fomc"]).toBeGreaterThanOrEqual(0);
  });

  it("does not mutate the input portfolio", () => {
    const originalPortfolio = createPortfolio();
    const originalCash = originalPortfolio.cash;
    runPortfolioSimulation(buildInput([buildPrediction()], { portfolio: originalPortfolio }));
    expect(originalPortfolio.cash).toBe(originalCash);
    expect(originalPortfolio.positions).toEqual({});
  });

  it("marks risk_adjusted true when trade was reduced", () => {
    // sizePosition caps at max_position_per_asset, so use max_total_exposure to force
    // a reduction inside checkRiskConstraints (target > adjusted).
    const tightInput = buildInput([buildPrediction({ conviction: 1.0, confidence: 1.0 })], {
      constraints: createRiskConstraints({
        max_position_per_asset: 50_000, // high enough that sizePosition doesn't pre-cap
        max_total_exposure: 100,        // only $100 total → reduces 100-unit signal to 1
      }),
    });
    const result = runPortfolioSimulation(tightInput);
    const trade = result.trades_executed[0];
    if (trade) {
      expect(trade.executed_size).toBeLessThan(trade.target_size);
      expect(trade.risk_adjusted).toBe(true);
    }
  });

  it("produces zero trades when max_event_family_exposure is 0", () => {
    const result = runPortfolioSimulation(buildInput([buildPrediction()], {
      constraints: createRiskConstraints({ max_event_family_exposure: 0 }),
    }));
    expect(result.trades_executed).toHaveLength(0);
    expect(result.risk_flags.some(f => f.type === "event_family_limit")).toBe(true);
  });

  it("portfolio_total in pnl_metrics equals updated portfolio realized_pnl", () => {
    const result = runPortfolioSimulation(buildInput());
    expect(result.pnl_metrics.portfolio_total).toBeCloseTo(
      result.updated_portfolio.realized_pnl,
      2,
    );
  });
});

// ─── End-to-end: multi-asset CPI simulation ───────────────────────────────────

describe("End-to-end: multi-asset CPI simulation", () => {
  it("processes a realistic CPI prediction with 4 assets", () => {
    const prediction: SimulationPrediction = {
      confidence: 0.72,
      horizon: "1d",
      assets: [
        { ticker: "SPY",  expected_direction: "down",  expected_magnitude_bp: 80,  conviction: 0.75 },
        { ticker: "TLT",  expected_direction: "down",  expected_magnitude_bp: 60,  conviction: 0.70 },
        { ticker: "UUP",  expected_direction: "up",    expected_magnitude_bp: 40,  conviction: 0.65 },
        { ticker: "GLD",  expected_direction: "mixed", expected_magnitude_bp: 20,  conviction: 0.50 },
      ],
    };

    const result = runPortfolioSimulation({
      prediction_result: { predictions: [prediction] },
      event_family: "cpi",
      portfolio: createPortfolio(),
      constraints: createRiskConstraints(),
      volatility: "elevated",
      simulated_at: "2026-03-18T13:30:00Z",
    });

    // Should produce 3 trades (GLD is mixed → skipped)
    expect(result.trades_executed).toHaveLength(3);
    expect(result.trades_executed.every(t => t.entry_price === SIMULATED_PRICE)).toBe(true);

    // GLD skip flag should exist
    expect(result.risk_flags.some(f => f.type === "mixed_direction_skipped" && f.asset === "GLD")).toBe(true);

    // SPY and TLT should be short
    const spyTrade = result.trades_executed.find(t => t.asset === "SPY");
    const tltTrade = result.trades_executed.find(t => t.asset === "TLT");
    expect(spyTrade?.direction).toBe("short");
    expect(tltTrade?.direction).toBe("short");

    // UUP should be long
    const uupTrade = result.trades_executed.find(t => t.asset === "UUP");
    expect(uupTrade?.direction).toBe("long");

    // All trades should have positive P&L (assuming prediction correct)
    result.trades_executed.forEach(t => {
      expect(t.simulated_pnl).toBeGreaterThan(0);
    });

    // Portfolio should reflect P&L
    expect(result.updated_portfolio.realized_pnl).toBeGreaterThan(0);
    expect(result.pnl_metrics.per_event_family["cpi"]).toBeGreaterThan(0);
  });
});
