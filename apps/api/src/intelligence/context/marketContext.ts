export type VolatilityRegime = "low" | "normal" | "elevated" | "high";
export type MacroRegime = "risk_on" | "risk_off" | "transitional" | "uncertain";
export type LiquiditySensitivity = "low" | "normal" | "high";
export type FedStance = "dovish" | "neutral" | "hawkish";

export type MarketContextSnapshot = {
  captured_at: string;
  volatility_regime: VolatilityRegime;
  macro_regime: MacroRegime;
  liquidity_sensitivity: LiquiditySensitivity;
  fed_policy_stance: FedStance;
  notes: string[];
};

export type MarketContextInput = Partial<Omit<MarketContextSnapshot, "captured_at" | "notes">> & {
  captured_at?: string;
  notes?: string[];
};

export const buildMarketContextSnapshot = (
  input: MarketContextInput = {},
): MarketContextSnapshot => ({
  captured_at: input.captured_at ?? new Date().toISOString(),
  volatility_regime: input.volatility_regime ?? "normal",
  macro_regime: input.macro_regime ?? "uncertain",
  liquidity_sensitivity: input.liquidity_sensitivity ?? "normal",
  fed_policy_stance: input.fed_policy_stance ?? "neutral",
  notes: input.notes ?? [],
});
