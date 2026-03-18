import type { FomcSurpriseDirection } from "../events/fomcEvent.js";
import type { MacroRegime, VolatilityRegime } from "../context/marketContext.js";
import type { FomcMemoryCase } from "../memory/fomcMemoryCaseBuilder.js";
import type { FomcMemoryCaseStore } from "../memory/fomcMemoryCaseStore.js";

// ─── Theme Key ────────────────────────────────────────────────────────────────

/**
 * The five dimensions that define an FOMC theme cluster.
 *
 *   surprise_direction  — hawkish / dovish / inline
 *   decision_type       — hike / cut / hold
 *   guidance_tone       — hawkish / dovish / neutral
 *   macro_regime        — market backdrop at decision time
 *   volatility_regime   — convexity / tail-risk conditions
 *
 * Note: `fed_policy_stance` from context is omitted because the FOMC
 * decision itself IS the Fed's stance signal.  `guidance_tone` captures
 * the qualitative surprise not expressed in the rate number alone.
 */
export type FomcThemeKey = {
  surprise_direction: FomcSurpriseDirection;
  decision_type: "hike" | "cut" | "hold";
  guidance_tone: "hawkish" | "dovish" | "neutral";
  macro_regime: MacroRegime;
  volatility_regime: VolatilityRegime;
};

// ─── Cluster ──────────────────────────────────────────────────────────────────

export type FomcThemeCluster = {
  cluster_id: string;
  key: FomcThemeKey;
  cases: FomcMemoryCase[];
  size: number;
};

// ─── Internal helpers ─────────────────────────────────────────────────────────

const buildClusterId = (key: FomcThemeKey): string =>
  [
    key.surprise_direction,
    key.decision_type,
    key.guidance_tone,
    key.macro_regime,
    key.volatility_regime,
  ].join(".");

const resolveThemeKey = (c: FomcMemoryCase): FomcThemeKey => ({
  surprise_direction: c.fomc_event.surprise_direction,
  decision_type: c.fomc_event.decision_type,
  guidance_tone: c.fomc_event.guidance_tone,
  macro_regime: c.context.macro_regime,
  volatility_regime: c.context.volatility_regime,
});

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Group all stored FOMC memory cases into structural theme clusters.
 * Returns clusters sorted largest-first.
 */
export const clusterFomcMemoryCases = async (
  store: FomcMemoryCaseStore,
): Promise<FomcThemeCluster[]> => {
  const allCases = await store.list();
  const map = new Map<string, { key: FomcThemeKey; cases: FomcMemoryCase[] }>();

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

export const buildFomcClusterId = buildClusterId;
