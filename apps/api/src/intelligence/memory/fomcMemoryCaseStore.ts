import type { FomcMemoryCase } from "./fomcMemoryCaseBuilder.js";
import type { FomcSurpriseDirection } from "../events/fomcEvent.js";
import type { MacroRegime, VolatilityRegime } from "../context/marketContext.js";
import { BaseMemoryCaseStore } from "./baseMemoryCaseStore.js";

// ─── Filter / Query Options ───────────────────────────────────────────────────

export type FomcMemoryCaseFilter = {
  surprise_direction?: FomcSurpriseDirection;
  decision_type?: "hike" | "cut" | "hold";
  macro_regime?: MacroRegime;
  volatility_regime?: VolatilityRegime;
  limit?: number;
};

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * Lightweight in-process store for FomcMemoryCase records.
 *
 * Shared infrastructure (persist, load, save, reset, get, size) lives in
 * BaseMemoryCaseStore. This class adds FOMC-specific `list()` filtering.
 */
export class FomcMemoryCaseStore extends BaseMemoryCaseStore<FomcMemoryCase> {
  // ── Read ───────────────────────────────────────────────────────────────────

  async list(filter?: FomcMemoryCaseFilter): Promise<FomcMemoryCase[]> {
    let results = [...this.casesMap.values()];

    if (filter?.surprise_direction !== undefined) {
      results = results.filter(
        (c) => c.fomc_event.surprise_direction === filter.surprise_direction,
      );
    }

    if (filter?.decision_type !== undefined) {
      results = results.filter(
        (c) => c.fomc_event.decision_type === filter.decision_type,
      );
    }

    if (filter?.macro_regime !== undefined) {
      results = results.filter(
        (c) => c.context.macro_regime === filter.macro_regime,
      );
    }

    if (filter?.volatility_regime !== undefined) {
      results = results.filter(
        (c) => c.context.volatility_regime === filter.volatility_regime,
      );
    }

    // Newest-first
    results.sort((a, b) => b.created_at.localeCompare(a.created_at));

    return filter?.limit ? results.slice(0, filter.limit) : results;
  }
}
