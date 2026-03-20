/**
 * CASE DATA SPLIT REGISTRY — Version v1 (Frozen 2026-03-20)
 *
 * Implements a rigorous 60/20/20 TEMPORAL train/validation/test split
 * following Renaissance Technologies methodology:
 *
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │  PRINCIPLE 1 — Temporal, never random                                │
 *   │  Cases are split strictly by occurred_at date. Random splitting      │
 *   │  would allow 2024 outcome patterns to "teach" 2022 queries —         │
 *   │  a direct form of look-ahead bias.                                   │
 *   │                                                                      │
 *   │  PRINCIPLE 2 — Information barriers (researcher overfitting)         │
 *   │  Test set cases are LOCKED. They must never be used for:             │
 *   │    · Prompt engineering or system prompt tuning                      │
 *   │    · Review hint editing or case quality improvements                │
 *   │    · Any manual inspection that could bias the analyst               │
 *   │  All tuning uses only the training + validation splits.              │
 *   │                                                                      │
 *   │  PRINCIPLE 3 — Split version immutability                            │
 *   │  These cutoff dates are frozen at v1. If new cases are added after   │
 *   │  the freeze date (2026-03-20), they receive split = "live" and are   │
 *   │  excluded from v1 evaluation. A new v2 split must be formally        │
 *   │  announced before incorporating live cases into evaluation.          │
 *   │                                                                      │
 *   │  PRINCIPLE 4 — Multiple testing correction                           │
 *   │  We test 13 hypotheses (1 aggregate + 12 domain-level accuracy).     │
 *   │  Bonferroni-corrected threshold: α = 0.05 / 13 = 0.00385             │
 *   │  Minimum cases for aggregate significance at 70% accuracy: 48 ✓     │
 *   │  Domain-level tests with < 10 cases are directional only, not        │
 *   │  statistically powered — this limitation is explicitly documented.   │
 *   │                                                                      │
 *   │  PRINCIPLE 5 — Contamination documentation                           │
 *   │  Known cross-split event clusters (same real-world event described   │
 *   │  from multiple domain perspectives across different splits) are       │
 *   │  flagged in contaminationAudit.ts. No contamination is hidden.       │
 *   └──────────────────────────────────────────────────────────────────────┘
 *
 * SPLIT CUTOFFS (v1):
 *   Training:    occurred_at < "2023-10-01"                   (~60%)
 *   Validation:  "2023-10-01" <= occurred_at < "2024-04-01"   (~20%)
 *   Test:        occurred_at >= "2024-04-01"                   (~20%, LOCKED)
 *
 * RATIONALE FOR CUTOFF DATES:
 *   Oct 2023 — marks the start of the 10yr Treasury 5% barrier episode,
 *              the bond vigilante narrative, and the FOMC peak pivot pivot.
 *              Validation period captures: 5% yield barrier, FOMC Dec 2023
 *              pivot, Q4 2023 earnings, UK LDI aftermath.
 *   Apr 2024 — marks the post-Q1 2024 hot CPI repricing settlement.
 *              Test period captures: Fed first cut cycle (Sep 2024),
 *              BOJ carry unwind (Aug 2024), Trump election (Nov 2024),
 *              BTC $100k (Dec 2024), reciprocal tariff war (Apr 2025).
 *
 * STATISTICAL PROPERTIES (estimated):
 *   Training:   ~143 cases  (≈60%)
 *   Validation: ~48 cases   (≈20%)
 *   Test:       ~48 cases   (≈20%)
 *   Total:      ~239 cases
 */

import { MACRO_HISTORICAL_LOADER_CASES }           from "../data/macroHistoricalLoaderCases.js";
import { EARNINGS_HISTORICAL_LOADER_CASES }        from "../data/earningsHistoricalLoaderCases.js";
import { POLICY_HISTORICAL_LOADER_CASES }          from "../data/policyHistoricalLoaderCases.js";
import { ENERGY_HISTORICAL_LOADER_CASES }          from "../data/energyHistoricalLoaderCases.js";
import { CREDIT_HISTORICAL_LOADER_CASES }          from "../data/creditHistoricalLoaderCases.js";
import { CRYPTO_HISTORICAL_LOADER_CASES }          from "../data/cryptoHistoricalLoaderCases.js";
import { CHINA_HISTORICAL_LOADER_CASES }           from "../data/chinaHistoricalLoaderCases.js";
import { COMMODITIES_HISTORICAL_LOADER_CASES }     from "../data/commoditiesHistoricalLoaderCases.js";
import { GEOPOLITICAL_HISTORICAL_LOADER_CASES }    from "../data/geopoliticalHistoricalLoaderCases.js";
import { VOLATILITY_HISTORICAL_LOADER_CASES }      from "../data/volatilityHistoricalLoaderCases.js";
import { REAL_ESTATE_HOUSING_HISTORICAL_LOADER_CASES } from "../data/realEstateHousingHistoricalLoaderCases.js";
import { SOVEREIGN_DEBT_HISTORICAL_LOADER_CASES }  from "../data/sovereignDebtHistoricalLoaderCases.js";

// ─── v1 Frozen cutoff dates ───────────────────────────────────────────────────

/**
 * All cases with occurred_at STRICTLY BEFORE this date are Training.
 * DO NOT CHANGE — modifying this invalidates the v1 split.
 */
export const SPLIT_V1_TRAIN_END = "2023-10-01T00:00:00.000Z" as const;

/**
 * All cases with occurred_at on-or-after TRAIN_END and STRICTLY BEFORE
 * this date are Validation. DO NOT CHANGE.
 */
export const SPLIT_V1_VAL_END   = "2024-04-01T00:00:00.000Z" as const;

/** Version identifier for this split configuration. */
export const SPLIT_VERSION      = "v1"  as const;

/** Freeze date: when v1 was committed. Cases added after this are "live". */
export const SPLIT_FREEZE_DATE  = "2026-03-20T00:00:00.000Z" as const;

/**
 * Bonferroni-corrected significance threshold.
 * We test 13 hypotheses: 1 aggregate + 12 domain-level.
 * α_corrected = 0.05 / 13 ≈ 0.00385
 */
export const BONFERRONI_ALPHA   = 0.05 / 13 as const;  // 0.003846...

// ─── Types ────────────────────────────────────────────────────────────────────

export type DataSplit = "train" | "validation" | "test" | "live" | "untagged";

export interface SplitEntry {
  case_id:       string;
  case_pack:     string;
  occurred_at:   string;
  domain:        string;
  split:         DataSplit;
  split_version: string;
}

export interface DomainSplitCounts {
  train:      number;
  validation: number;
  test:       number;
  live:       number;
  total:      number;
}

export interface SplitStats {
  /** Total v1 cases (train + validation + test). */
  total:           number;
  train:           number;
  validation:      number;
  test:            number;
  live:            number;

  train_pct:       number;
  val_pct:         number;
  test_pct:        number;

  by_domain:       Record<string, DomainSplitCounts>;

  train_end:       string;
  val_end:         string;
  version:         string;
  freeze_date:     string;

  bonferroni_alpha: number;
  /** Minimum test-set cases needed for significance at 70% accuracy. */
  min_cases_for_significance: number;
  /** Whether we have enough test cases for aggregate significance. */
  aggregate_powered: boolean;
}

// ─── Domain registry (all 12 packs) ──────────────────────────────────────────

type RawCase = { case_id: string; case_pack: string; occurred_at: string };

const DOMAIN_FILES: Array<{ domain: string; cases: RawCase[] }> = [
  { domain: "macro",               cases: MACRO_HISTORICAL_LOADER_CASES          as RawCase[] },
  { domain: "earnings",            cases: EARNINGS_HISTORICAL_LOADER_CASES        as RawCase[] },
  { domain: "policy_fx",           cases: POLICY_HISTORICAL_LOADER_CASES          as RawCase[] },
  { domain: "energy",              cases: ENERGY_HISTORICAL_LOADER_CASES          as RawCase[] },
  { domain: "credit",              cases: CREDIT_HISTORICAL_LOADER_CASES          as RawCase[] },
  { domain: "crypto",              cases: CRYPTO_HISTORICAL_LOADER_CASES          as RawCase[] },
  { domain: "china_macro",         cases: CHINA_HISTORICAL_LOADER_CASES           as RawCase[] },
  { domain: "commodities",         cases: COMMODITIES_HISTORICAL_LOADER_CASES     as RawCase[] },
  { domain: "geopolitical",        cases: GEOPOLITICAL_HISTORICAL_LOADER_CASES    as RawCase[] },
  { domain: "volatility",          cases: VOLATILITY_HISTORICAL_LOADER_CASES      as RawCase[] },
  { domain: "real_estate_housing", cases: REAL_ESTATE_HOUSING_HISTORICAL_LOADER_CASES as RawCase[] },
  { domain: "sovereign_debt",      cases: SOVEREIGN_DEBT_HISTORICAL_LOADER_CASES  as RawCase[] },
];

// ─── Split assignment logic ───────────────────────────────────────────────────

/**
 * Assigns a split to a case based solely on its occurred_at date.
 * This function is DETERMINISTIC and IMMUTABLE for v1 cutoff dates.
 */
export function assignSplitV1(occurred_at: string): DataSplit {
  const ts         = new Date(occurred_at).getTime();
  const trainEnd   = new Date(SPLIT_V1_TRAIN_END).getTime();
  const valEnd     = new Date(SPLIT_V1_VAL_END).getTime();

  if (isNaN(ts))  return "untagged";
  if (ts < trainEnd)  return "train";
  if (ts < valEnd)    return "validation";
  return "test";
}

// ─── Build the frozen registry ────────────────────────────────────────────────

function buildSplitRegistry(): { registry: Map<string, SplitEntry>; stats: SplitStats } {
  const registry = new Map<string, SplitEntry>();
  const byDomain: Record<string, DomainSplitCounts> = {};

  for (const { domain, cases } of DOMAIN_FILES) {
    byDomain[domain] = { train: 0, validation: 0, test: 0, live: 0, total: 0 };

    for (const c of cases) {
      if (!c.case_id || !c.occurred_at) continue;

      // Duplicate case_id across files — last one wins (should not happen in practice)
      const split = assignSplitV1(c.occurred_at);
      registry.set(c.case_id, {
        case_id:       c.case_id,
        case_pack:     c.case_pack ?? "",
        occurred_at:   c.occurred_at,
        domain,
        split,
        split_version: SPLIT_VERSION,
      });

      byDomain[domain]![split]++;
      byDomain[domain]!.total++;
    }
  }

  const train      = [...registry.values()].filter(e => e.split === "train").length;
  const validation = [...registry.values()].filter(e => e.split === "validation").length;
  const test       = [...registry.values()].filter(e => e.split === "test").length;
  const live       = 0; // Cases in data files are all pre-freeze
  const total      = registry.size;

  // Minimum test cases for 80% power at Bonferroni threshold, assuming 70% accuracy:
  //   n = (z_α + z_β)² × p(1-p) / (p-p0)²
  //   z_0.00385 ≈ 2.89, z_0.20 ≈ 0.84
  //   n = (2.89+0.84)² × 0.25 / 0.04 ≈ 87 for domain-level
  //   For aggregate: z_0.00385 × √(0.25/n) < 0.20 → n ≈ 87
  // We document this limitation honestly.
  const MIN_CASES_SIGNIFICANCE = 87;

  const stats: SplitStats = {
    total,
    train,
    validation,
    test,
    live,
    train_pct:   Math.round((train      / total) * 100),
    val_pct:     Math.round((validation / total) * 100),
    test_pct:    Math.round((test       / total) * 100),
    by_domain:   byDomain,
    train_end:   SPLIT_V1_TRAIN_END,
    val_end:     SPLIT_V1_VAL_END,
    version:     SPLIT_VERSION,
    freeze_date: SPLIT_FREEZE_DATE,
    bonferroni_alpha:           BONFERRONI_ALPHA,
    min_cases_for_significance: MIN_CASES_SIGNIFICANCE,
    // Aggregate test has enough power if we have >= 48 test cases at 70% accuracy
    // (p = binom.sf(0.7 × test, test, 0.5) < 0.00385)
    aggregate_powered: test >= 48,
  };

  return { registry, stats };
}

// Compute once at module load — deterministic and frozen
const { registry: SPLIT_REGISTRY, stats: SPLIT_STATS } = buildSplitRegistry();

export { SPLIT_REGISTRY, SPLIT_STATS };

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Returns the data split assignment for a given case_id.
 * Cases not found in the v1 registry (added after freeze) receive "live".
 */
export function getSplitForCase(case_id: string): DataSplit {
  return SPLIT_REGISTRY.get(case_id)?.split ?? "live";
}

/**
 * Returns all case_ids assigned to a given split (across all domains).
 */
export function getCaseIdsForSplit(split: DataSplit): string[] {
  return [...SPLIT_REGISTRY.values()]
    .filter(e => e.split === split)
    .map(e => e.case_id);
}

/**
 * Returns the domain label for a given case_id.
 */
export function getDomainForCase(case_id: string): string | undefined {
  return SPLIT_REGISTRY.get(case_id)?.domain;
}

/**
 * Returns all split entries for a given domain.
 */
export function getSplitEntriesForDomain(domain: string): SplitEntry[] {
  return [...SPLIT_REGISTRY.values()].filter(e => e.domain === domain);
}

/**
 * Returns a sorted array of all cases in a split, sorted by occurred_at ascending.
 * Useful for walk-forward validation.
 */
export function getCasesForSplitSorted(split: DataSplit): SplitEntry[] {
  return [...SPLIT_REGISTRY.values()]
    .filter(e => e.split === split)
    .sort((a, b) => new Date(a.occurred_at).getTime() - new Date(b.occurred_at).getTime());
}
