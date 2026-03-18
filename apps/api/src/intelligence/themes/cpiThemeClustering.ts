import type { CpiSurpriseDirection } from "../events/cpiEvent.js";
import type { FedStance, MacroRegime, VolatilityRegime } from "../context/marketContext.js";
import type { CpiMemoryCase } from "../memory/memoryCaseBuilder.js";
import type { CpiMemoryCaseStore } from "../memory/cpiMemoryCaseStore.js";
import { resolveSurpriseBand } from "../analogs/cpiAnalogRetrieval.js";
import type { SurpriseBand } from "../analogs/cpiAnalogRetrieval.js";

// ─── Theme Key ────────────────────────────────────────────────────────────────

/**
 * The five finance-relevant dimensions that define a CPI theme.
 *
 * These are the same dimensions used in analog retrieval but here they form
 * a discrete grouping key rather than a continuous similarity score.
 *
 * Dimension rationale:
 *  - surprise_direction: primary driver of market directionality
 *  - surprise_band: determines magnitude of the move, not just direction
 *  - fed_policy_stance: determines whether the surprise has policy headroom
 *  - macro_regime: determines whether risk appetite amplifies or dampens the move
 *  - volatility_regime: determines whether convexity effects dominate
 */
export type CpiThemeKey = {
  surprise_direction: CpiSurpriseDirection;
  surprise_band: SurpriseBand;
  fed_policy_stance: FedStance;
  macro_regime: MacroRegime;
  volatility_regime: VolatilityRegime;
};

// ─── Cluster ──────────────────────────────────────────────────────────────────

export type CpiThemeCluster = {
  /** Deterministic dot-delimited composite of all key dimensions */
  cluster_id: string;
  key: CpiThemeKey;
  cases: CpiMemoryCase[];
  size: number;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const buildClusterId = (key: CpiThemeKey): string =>
  [
    key.surprise_direction,
    key.surprise_band,
    key.fed_policy_stance,
    key.macro_regime,
    key.volatility_regime,
  ].join(".");

const resolveThemeKey = (c: CpiMemoryCase): CpiThemeKey => ({
  surprise_direction: c.cpi_event.surprise_direction,
  surprise_band: resolveSurpriseBand(c.cpi_event.surprise_bp),
  fed_policy_stance: c.context.fed_policy_stance,
  macro_regime: c.context.macro_regime,
  volatility_regime: c.context.volatility_regime,
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Group all stored CPI memory cases into structural theme clusters.
 *
 * Each cluster is a set of cases that share identical values across all five
 * finance-relevant dimensions. Cases that would cluster together describe the
 * same macro regime pattern — they are the system's closest natural analogs.
 *
 * Clusters are returned sorted largest-first so that the most data-rich
 * patterns are prominent.
 *
 * With one case per cluster the summaries note "insufficient_data".
 * The value grows as the store accumulates 3+ cases per cluster.
 */
export const clusterCpiMemoryCases = async (
  store: CpiMemoryCaseStore,
): Promise<CpiThemeCluster[]> => {
  const allCases = await store.list();

  const map = new Map<string, { key: CpiThemeKey; cases: CpiMemoryCase[] }>();

  for (const c of allCases) {
    const key = resolveThemeKey(c);
    const id = buildClusterId(key);

    if (!map.has(id)) {
      map.set(id, { key, cases: [] });
    }

    map.get(id)!.cases.push(c);
  }

  return [...map.entries()]
    .map(([cluster_id, { key, cases }]) => ({
      cluster_id,
      key,
      cases,
      size: cases.length,
    }))
    .sort((a, b) => b.size - a.size);
};

/**
 * Derive the theme key for a single CPI memory case without accessing the store.
 * Useful for predicting which cluster a newly-formed case would fall into.
 */
export const resolveThemeKeyForCase = resolveThemeKey;

/**
 * Return the deterministic cluster ID for a given theme key.
 * Consistent with the IDs produced by `clusterCpiMemoryCases`.
 */
export const buildCpiClusterId = buildClusterId;
