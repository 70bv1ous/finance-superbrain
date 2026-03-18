import type { CpiMemoryCase } from "./memoryCaseBuilder.js";
import type { CpiSurpriseDirection } from "../events/cpiEvent.js";
import type { FedStance, MacroRegime, VolatilityRegime } from "../context/marketContext.js";
import { BaseMemoryCaseStore } from "./baseMemoryCaseStore.js";

// ─── Filter / Query Options ───────────────────────────────────────────────────

export type CpiMemoryCaseFilter = {
  surprise_direction?: CpiSurpriseDirection;
  fed_policy_stance?: FedStance;
  macro_regime?: MacroRegime;
  volatility_regime?: VolatilityRegime;
  limit?: number;
};

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * Lightweight in-process store for CpiMemoryCase records.
 *
 * Operates in two modes:
 *  - **pure in-memory** (no persistPath): ephemeral, used in tests and scripts
 *  - **file-backed** (persistPath set): writes the full case list as JSON after
 *    every save, reload on next `load()` call. No Phase 4 infrastructure touched.
 *
 * Shared infrastructure (persist, load, save, reset, get, size) lives in
 * BaseMemoryCaseStore. This class adds CPI-specific `list()` filtering.
 */
export class CpiMemoryCaseStore extends BaseMemoryCaseStore<CpiMemoryCase> {
  // ── Read ───────────────────────────────────────────────────────────────────

  async list(filter?: CpiMemoryCaseFilter): Promise<CpiMemoryCase[]> {
    let results = [...this.casesMap.values()];

    if (filter?.surprise_direction !== undefined) {
      results = results.filter(
        (c) => c.cpi_event.surprise_direction === filter.surprise_direction,
      );
    }

    if (filter?.fed_policy_stance !== undefined) {
      results = results.filter(
        (c) => c.context.fed_policy_stance === filter.fed_policy_stance,
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
