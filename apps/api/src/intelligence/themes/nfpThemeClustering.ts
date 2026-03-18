import type { NfpSurpriseDirection, NfpJobsSurpriseBand, NfpUnemploymentDirection } from "../events/nfpEvent.js";
import type { MacroRegime, VolatilityRegime } from "../context/marketContext.js";
import type { NfpMemoryCase } from "../memory/nfpMemoryCaseBuilder.js";
import type { NfpMemoryCaseStore } from "../memory/nfpMemoryCaseStore.js";

// ─── Theme Key ────────────────────────────────────────────────────────────────

/**
 * The five dimensions that define an NFP theme cluster.
 *
 *   surprise_direction    — strong / weak / inline (primary jobs signal)
 *   jobs_surprise_band    — large_beat / beat / inline / miss / large_miss (magnitude)
 *   unemployment_direction — better / worse / unchanged (labour breadth signal)
 *   macro_regime          — market backdrop at release time
 *   volatility_regime     — convexity / tail-risk conditions
 *
 * Note: `fed_policy_stance` from context is not used as a dimension because
 * NFP data directly informs the Fed's policy stance — including it would
 * introduce feedback circularity.  The unemployment direction captures the
 * qualitative policy signal beyond the headline jobs number.
 */
export type NfpThemeKey = {
  surprise_direction: NfpSurpriseDirection;
  jobs_surprise_band: NfpJobsSurpriseBand;
  unemployment_direction: NfpUnemploymentDirection;
  macro_regime: MacroRegime;
  volatility_regime: VolatilityRegime;
};

// ─── Cluster ──────────────────────────────────────────────────────────────────

export type NfpThemeCluster = {
  cluster_id: string;
  key: NfpThemeKey;
  cases: NfpMemoryCase[];
  size: number;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const buildClusterId = (key: NfpThemeKey): string =>
  [
    key.surprise_direction,
    key.jobs_surprise_band,
    key.unemployment_direction,
    key.macro_regime,
    key.volatility_regime,
  ].join(".");

const resolveThemeKey = (c: NfpMemoryCase): NfpThemeKey => ({
  surprise_direction: c.nfp_event.surprise_direction,
  jobs_surprise_band: c.nfp_event.jobs_surprise_band,
  unemployment_direction: c.nfp_event.unemployment_direction,
  macro_regime: c.context.macro_regime,
  volatility_regime: c.context.volatility_regime,
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Group all stored NFP memory cases into structural theme clusters.
 * Returns clusters sorted largest-first.
 */
export const clusterNfpMemoryCases = async (
  store: NfpMemoryCaseStore,
): Promise<NfpThemeCluster[]> => {
  const allCases = await store.list();
  const map = new Map<string, { key: NfpThemeKey; cases: NfpMemoryCase[] }>();

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

export const resolveThemeKeyForCase = resolveThemeKey;

export const buildNfpClusterId = buildClusterId;
