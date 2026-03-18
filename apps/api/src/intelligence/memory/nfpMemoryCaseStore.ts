import type { NfpMemoryCase } from "./nfpMemoryCaseBuilder.js";
import type { NfpSurpriseDirection, NfpJobsSurpriseBand } from "../events/nfpEvent.js";
import type { MacroRegime, VolatilityRegime } from "../context/marketContext.js";
import { BaseMemoryCaseStore } from "./baseMemoryCaseStore.js";

// ─── Filter / Query Options ───────────────────────────────────────────────────

export type NfpMemoryCaseFilter = {
  surprise_direction?: NfpSurpriseDirection;
  jobs_surprise_band?: NfpJobsSurpriseBand;
  macro_regime?: MacroRegime;
  volatility_regime?: VolatilityRegime;
  limit?: number;
};

// ─── Store ────────────────────────────────────────────────────────────────────

/**
 * Lightweight in-process store for NfpMemoryCase records.
 *
 * Shared infrastructure (persist, load, save, reset, get, size) lives in
 * BaseMemoryCaseStore. This class adds NFP-specific `list()` filtering.
 */
export class NfpMemoryCaseStore extends BaseMemoryCaseStore<NfpMemoryCase> {
  // ── Read ───────────────────────────────────────────────────────────────────

  async list(filter?: NfpMemoryCaseFilter): Promise<NfpMemoryCase[]> {
    let results = [...this.casesMap.values()];

    if (filter?.surprise_direction !== undefined) {
      results = results.filter(
        (c) => c.nfp_event.surprise_direction === filter.surprise_direction,
      );
    }

    if (filter?.jobs_surprise_band !== undefined) {
      results = results.filter(
        (c) => c.nfp_event.jobs_surprise_band === filter.jobs_surprise_band,
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
