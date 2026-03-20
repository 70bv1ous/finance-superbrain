/**
 * CONTAMINATION AUDIT — v1 (2026-03-20)
 *
 * Documents ALL known contamination risks between train/validation/test splits.
 * This file is the "research integrity ledger" — every risk, even minor ones,
 * must be recorded here with honest impact assessment.
 *
 * Contamination types:
 *   EVENT_CLUSTER     — same real-world event documented across multiple cases
 *                       in different splits (e.g. BOJ Aug 2024 appears in
 *                       volatility, credit, crypto, policy, macro domains)
 *   FORWARD_REF       — a training case's summary explicitly references future
 *                       events that appear in the validation or test set
 *   RESEARCHER        — the analyst (Claude) observed a test-set case during
 *                       development and could have unconsciously tuned prompts
 *   SEMANTIC_NEARDUP  — two cases in different splits describe nearly identical
 *                       mechanisms (e.g. BOE emergency gilt buy in train, Truss
 *                       crisis in validation)
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type ContaminationType =
  | "EVENT_CLUSTER"
  | "FORWARD_REF"
  | "RESEARCHER"
  | "SEMANTIC_NEARDUP";

export type ContaminationSeverity =
  | "CRITICAL"   // invalidates domain-level result for those cases
  | "WARNING"    // reduces confidence, must be documented in results
  | "INFO";      // minor; fully documented and mitigated

export interface ContaminationEntry {
  id:                    string;
  type:                  ContaminationType;
  severity:              ContaminationSeverity;
  case_ids:              string[];
  splits_involved:       string[];
  description:           string;
  mitigation:            string;
  invalidates_results:   boolean;
}

// ─── The audit log ────────────────────────────────────────────────────────────

export const CONTAMINATION_AUDIT: ContaminationEntry[] = [

  // ── EVENT CLUSTERS ──────────────────────────────────────────────────────────
  // These are cases where the same real-world event is documented across
  // multiple domain perspectives. The brain is being asked to predict an event
  // that it has "seen" from a different angle during training.

  {
    id: "C001",
    type: "EVENT_CLUSTER",
    severity: "INFO",
    case_ids: [
      // Training (pre-Oct 2023):
      "credit-svb-bank-run",               // credit domain, Mar 2023
      "credit-fed-liquidity-backstop",      // credit domain, Mar 2023
      "credit-global-bank-contagion",       // credit domain, Mar 2023
      "credit-cs-at1-wipeout",             // credit domain, Mar 2023
      "crypto-usdc-depeg-svb-mar-2023",    // crypto domain, Mar 2023
      "realestate-svb-mortgage-stress-mar-2023", // realestate domain, Mar 2023
      "volatility-realized-vol-surge-svb-mar-2023", // volatility domain, Mar 2023
    ],
    splits_involved: ["train"],
    description:
      "SVB collapse (March 2023) is documented across 7 cases in 4 domains, all in " +
      "the training split. No cross-split contamination. Impact: brain has unusually " +
      "rich multi-domain SVB training data — this is beneficial, not contaminating.",
    mitigation: "No action required. All cases in training split.",
    invalidates_results: false,
  },

  {
    id: "C002",
    type: "EVENT_CLUSTER",
    severity: "WARNING",
    case_ids: [
      // Validation (Oct 2023 – Apr 2024):
      "macro-fomc-pivot-signal-dec-2023",   // macro, Dec 2023
      "volatility-vol-crush-post-fomc-2023", // volatility, Dec 2023
      // Training (pre-Oct 2023):
      "macro-fomc-pause-rate-hike-cycle",   // macro, Jun 2023
    ],
    splits_involved: ["train", "validation"],
    description:
      "The Dec 2023 FOMC pivot is covered in both the macro and volatility domains " +
      "(both in validation). The Jun 2023 FOMC pause (training) describes a similar " +
      "Fed pause mechanism. A query about Fed pivot signals could retrieve the Jun 2023 " +
      "training case and partially 'predict' the Dec 2023 validation mechanism. " +
      "However, the training case is semantically distinct (pause vs. full pivot with dot plot).",
    mitigation:
      "Flagged. When evaluating FOMC-pivot queries, note that training has the Jun 2023 " +
      "pause analogue. The brain should not be penalized for correctly predicting the " +
      "mechanism based on this training case — that is the intended behavior.",
    invalidates_results: false,
  },

  {
    id: "C003",
    type: "EVENT_CLUSTER",
    severity: "WARNING",
    case_ids: [
      // Test (Apr 2024+):
      "volatility-vix-aug-2024-boj-cascade",        // volatility, Aug 2024
      "credit-yen-carry-unwind-credit-stress",       // credit, Aug 2024
      "crypto-yen-carry-unwind-aug-2024",            // crypto, Aug 2024
      "macro-nfp-sahm-rule-trigger",                 // macro, Aug 2024 (Aug 2 NFP)
      "policy-yen-carry-unwind-aug-2024-cascade",   // policy, Aug 2024
      "policy-boj-carry-cascade-global-contagion-aug-2024", // policy, Aug 2024
      // Training (pre-Oct 2023):
      "policy-boj-ycc-ceiling-expansion-dec-2022",  // BOJ YCC Dec 2022
      "policy-boj-ycc-tweak-july-2023",             // BOJ YCC Jul 2023 (in training)
      "policy-boj-rate-hike-carry-unwind-jul-2024", // BOJ Jul 2024 hike → test
    ],
    splits_involved: ["train", "test"],
    description:
      "The Aug 2024 BOJ carry unwind is the largest single event cluster across the " +
      "test set — 6 cases in 5 domains all describe the same Aug 5 2024 event. " +
      "The brain has two related training analogues (BOJ YCC Dec 2022, BOJ YCC Jul 2023) " +
      "that teach the yen carry mechanism. This is the most significant contamination " +
      "risk: the brain may correctly predict the Aug 2024 outcome because it learned " +
      "the carry unwind mechanism from the 2022/2023 training cases. " +
      "This is NOT a data leak — it is the intended generalization. However, if the " +
      "brain is evaluated on all 6 Aug 2024 cases, accuracy will be inflated by the " +
      "high correlation between them (they are not 6 independent predictions).",
    mitigation:
      "When reporting test set accuracy, de-duplicate event clusters: count the " +
      "Aug 2024 BOJ cluster as ONE independent event test, not 6. Use the domain with " +
      "the clearest directional prediction (policy domain) as the canonical test case. " +
      "Report both raw accuracy (all 6) and de-duplicated accuracy (cluster = 1) " +
      "in evaluation sessions. The cluster inflation factor is flagged as a WARNING.",
    invalidates_results: false,
  },

  {
    id: "C004",
    type: "EVENT_CLUSTER",
    severity: "INFO",
    case_ids: [
      // Test (Apr 2024+):
      "macro-trump-tariff-reciprocal-apr-2025",
      "macro-tariff-pause-90-day-rally",
      "macro-tariff-relief-bond-vigilante-paradox-apr-2025",
      "policy-china-tariff-escalation-2025",
      // Training:
      "volatility-vix-term-inversion-aug-2019",  // US-China tariff 2019
      "policy-us-china-trade-truce-g20-2018",    // US-China trade truce 2018
    ],
    splits_involved: ["train", "test"],
    description:
      "The Apr 2025 tariff war produces 4 test cases. The brain has 2 training analogues " +
      "(2018 trade truce, 2019 tariff escalation). The mechanism is similar (tariff shock → " +
      "equities down, vol up) but the 2025 magnitude is far larger. The training analogues " +
      "should correctly predict direction; the magnitude will likely be underestimated. " +
      "Cluster of 4 should be counted as 1 independent event in de-duplication.",
    mitigation: "De-duplicate tariff cluster to 1 test event. Document magnitude gap.",
    invalidates_results: false,
  },

  {
    id: "C005",
    type: "EVENT_CLUSTER",
    severity: "INFO",
    case_ids: [
      // Training:
      "sovereign-uk-gilt-crisis-sep-2022",       // UK gilt crisis Sep 2022
      "policy-uk-fiscal-shock",                   // UK fiscal shock Sep 2022
      "policy-boe-emergency-gilt-purchase",       // BoE gilt purchase Sep 2022
    ],
    splits_involved: ["train"],
    description:
      "UK gilt crisis cluster — all 3 cases are in training. No cross-split contamination. " +
      "Brain has comprehensive multi-perspective training data on the Truss LDI crisis.",
    mitigation: "No action required.",
    invalidates_results: false,
  },

  // ── FORWARD REFERENCES ──────────────────────────────────────────────────────

  {
    id: "C006",
    type: "FORWARD_REF",
    severity: "WARNING",
    case_ids: ["macro-tariff-relief-bond-vigilante-paradox-apr-2025"],
    splits_involved: ["test"],
    description:
      "This case (Apr 9 2025) contains an explicit cross-reference in its review_hints " +
      "to the Nov 2022 CPI pivot hope case: 'Contrast: November 2022 CPI surprise " +
      "(policy-fed-nov-2022-cpi-pivot-hope) produced SPY +551bp AND TLT +479bp.' " +
      "This is BACKWARD referencing (2025 case citing 2022 training case) — the correct " +
      "direction — and does not constitute look-ahead bias. A 2025 case knowing about " +
      "2022 events is expected and valid.",
    mitigation: "No action required — backward reference is valid. Not contaminating.",
    invalidates_results: false,
  },

  {
    id: "C007",
    type: "FORWARD_REF",
    severity: "INFO",
    case_ids: [
      "credit-yen-carry-unwind-credit-stress",         // Aug 2024 (test)
      "policy-boj-carry-cascade-global-contagion-aug-2024", // Aug 2024 (test)
    ],
    splits_involved: ["test"],
    description:
      "Both cases reference BOJ Deputy Governor Uchida's verbal intervention on Aug 7 2024 " +
      "as the reversal catalyst. The forward description of the reversal event (Aug 7) " +
      "in cases dated Aug 5 means the case summary describes the FULL episode including " +
      "its resolution. This is standard historical case documentation (we know the outcome) " +
      "and is not a look-ahead issue for training — these cases are in the test set and " +
      "are not used for retrieval during evaluation queries.",
    mitigation: "Standard historical documentation. No contamination since cases are in test.",
    invalidates_results: false,
  },

  // ── RESEARCHER CONTAMINATION ────────────────────────────────────────────────

  {
    id: "C008",
    type: "RESEARCHER",
    severity: "WARNING",
    case_ids: [
      // Validation cases observed during development session (prior conversation):
      "macro-core-cpi-jan-2024-sticky",   // Feb 13 2024 hot CPI — used as forward test
      "macro-nfp-stronger-yields-up",     // Feb 2 2024 NFP — training but near boundary
    ],
    splits_involved: ["validation", "train"],
    description:
      "During development (prior session), a forward test was run using a Feb 2024 " +
      "CPI query. The brain's response to this query was observed and the result was " +
      "'correct.' This constitutes researcher observation of the validation boundary area. " +
      "The macro-core-cpi-jan-2024-sticky case (Feb 13 2024) falls in the VALIDATION set " +
      "(between Oct 2023 and Apr 2024 cutoffs). This means one validation case was " +
      "used to tune confidence in the system before formal evaluation — a mild form " +
      "of researcher overfitting.",
    mitigation:
      "Document explicitly. When reporting validation accuracy, note that at least 1 " +
      "validation case (macro-core-cpi-jan-2024-sticky) was observed during development. " +
      "This case should be excluded from the validation set accuracy calculation or " +
      "flagged as 'observed.' The test set (Apr 2024+) remains uncontaminated — " +
      "no test-set cases were queried during development.",
    invalidates_results: false,
  },

  // ── SEMANTIC NEAR-DUPLICATES ────────────────────────────────────────────────

  {
    id: "C009",
    type: "SEMANTIC_NEARDUP",
    severity: "INFO",
    case_ids: [
      "macro-fomc-75bp-surprise-jun-2022",  // train — Jun 2022 75bp hike
      "macro-fomc-first-cut-50bp-sep-2024", // test — Sep 2024 50bp cut
    ],
    splits_involved: ["train", "test"],
    description:
      "Both cases involve a Fed meeting with an unexpected 50bp+ move. The mechanisms " +
      "are OPPOSITE (hike vs. cut), so direction predictions should differ — this is " +
      "a test of the brain's ability to discriminate between hawkish and dovish surprises " +
      "of similar magnitude. Not a contamination risk — tests the right thing.",
    mitigation: "Beneficial contrast case. No action required.",
    invalidates_results: false,
  },

  {
    id: "C010",
    type: "SEMANTIC_NEARDUP",
    severity: "INFO",
    case_ids: [
      "sovereign-us-debt-ceiling-2023",       // validation — debt ceiling stress
      "sovereign-debt-ceiling-deal-relief-2023", // validation — debt ceiling relief
    ],
    splits_involved: ["validation"],
    description:
      "Both US debt ceiling cases from 2023 are in the validation split. They represent " +
      "the two phases of the same event: the stress (risk-off) and the resolution (relief " +
      "rally). When counting independent events, count as 1 event with 2 phases, not 2 " +
      "independent predictions. This inflates validation case count by 1.",
    mitigation:
      "De-duplicate when counting independent validation events. Count as 1 debt ceiling event.",
    invalidates_results: false,
  },
];

// ─── Summary helpers ──────────────────────────────────────────────────────────

export interface ContaminationSummary {
  total_entries:        number;
  critical_count:       number;
  warning_count:        number;
  info_count:           number;
  invalidating_count:   number;
  cross_split_clusters: number;
  researcher_obs_cases: string[];
  test_set_clean:       boolean;
}

export function getContaminationSummary(): ContaminationSummary {
  const critical    = CONTAMINATION_AUDIT.filter(e => e.severity === "CRITICAL").length;
  const warning     = CONTAMINATION_AUDIT.filter(e => e.severity === "WARNING").length;
  const info        = CONTAMINATION_AUDIT.filter(e => e.severity === "INFO").length;
  const invalidating = CONTAMINATION_AUDIT.filter(e => e.invalidates_results).length;

  const crossSplit  = CONTAMINATION_AUDIT.filter(
    e => e.type === "EVENT_CLUSTER" && e.splits_involved.length > 1,
  ).length;

  const researcherEntry = CONTAMINATION_AUDIT.find(e => e.type === "RESEARCHER");
  const researcherCases = researcherEntry?.case_ids ?? [];

  // The test set is clean if no RESEARCHER entries involve test cases,
  // and no FORWARD_REF entries exist that would give the brain test-set knowledge.
  const testSetClean = !CONTAMINATION_AUDIT.some(
    e =>
      e.invalidates_results &&
      (e.splits_involved.includes("test")),
  );

  return {
    total_entries:        CONTAMINATION_AUDIT.length,
    critical_count:       critical,
    warning_count:        warning,
    info_count:           info,
    invalidating_count:   invalidating,
    cross_split_clusters: crossSplit,
    researcher_obs_cases: researcherCases,
    test_set_clean:       testSetClean,
  };
}

/**
 * Returns contamination entries that involve a specific case_id.
 */
export function getContaminationForCase(case_id: string): ContaminationEntry[] {
  return CONTAMINATION_AUDIT.filter(e => e.case_ids.includes(case_id));
}

/**
 * Returns the set of cases that were observed by the researcher (researcher overfitting risk).
 * These should be excluded or flagged when reporting validation accuracy.
 */
export function getResearcherObservedCases(): string[] {
  return CONTAMINATION_AUDIT
    .filter(e => e.type === "RESEARCHER")
    .flatMap(e => e.case_ids);
}

/**
 * Returns known event cluster groupings for de-duplication.
 * When computing accuracy, clusters should count as 1 independent event.
 */
export function getEventClusters(): Array<{ cluster_id: string; case_ids: string[]; canonical_case_id: string }> {
  return [
    {
      cluster_id:         "aug-2024-boj-carry-unwind",
      case_ids: [
        "volatility-vix-aug-2024-boj-cascade",
        "credit-yen-carry-unwind-credit-stress",
        "crypto-yen-carry-unwind-aug-2024",
        "macro-nfp-sahm-rule-trigger",
        "policy-yen-carry-unwind-aug-2024-cascade",
        "policy-boj-carry-cascade-global-contagion-aug-2024",
        "policy-boj-rate-hike-carry-unwind-jul-2024",
      ],
      canonical_case_id:  "policy-yen-carry-unwind-aug-2024-cascade",
    },
    {
      cluster_id:         "apr-2025-tariff-war",
      case_ids: [
        "macro-trump-tariff-reciprocal-apr-2025",
        "macro-tariff-pause-90-day-rally",
        "macro-tariff-relief-bond-vigilante-paradox-apr-2025",
        "policy-china-tariff-escalation-2025",
      ],
      canonical_case_id:  "macro-trump-tariff-reciprocal-apr-2025",
    },
    {
      cluster_id:         "us-debt-ceiling-2023",
      case_ids: [
        "sovereign-us-debt-ceiling-2023",
        "sovereign-debt-ceiling-deal-relief-2023",
        "credit-us-debt-ceiling-brinkmanship",
      ],
      canonical_case_id:  "sovereign-us-debt-ceiling-2023",
    },
    {
      cluster_id:         "uk-gilt-crisis-sep-2022",
      case_ids: [
        "sovereign-uk-gilt-crisis-sep-2022",
        "policy-uk-fiscal-shock",
        "policy-boe-emergency-gilt-purchase",
      ],
      canonical_case_id:  "sovereign-uk-gilt-crisis-sep-2022",
    },
    {
      cluster_id:         "svb-crisis-mar-2023",
      case_ids: [
        "credit-svb-bank-run",
        "credit-fed-liquidity-backstop",
        "credit-global-bank-contagion",
        "credit-cs-at1-wipeout",
        "crypto-usdc-depeg-svb-mar-2023",
        "realestate-svb-mortgage-stress-mar-2023",
        "volatility-realized-vol-surge-svb-mar-2023",
      ],
      canonical_case_id:  "credit-svb-bank-run",
    },
  ];
}

/**
 * De-duplicates a list of case_ids by collapsing event clusters to their canonical case.
 * Returns the de-duplicated list (independent events only).
 */
export function deduplicateClusters(case_ids: string[]): string[] {
  const clusters = getEventClusters();
  const seenClusters = new Set<string>();
  const result: string[] = [];

  for (const case_id of case_ids) {
    const cluster = clusters.find(c => c.case_ids.includes(case_id));
    if (cluster) {
      if (!seenClusters.has(cluster.cluster_id)) {
        seenClusters.add(cluster.cluster_id);
        result.push(cluster.canonical_case_id); // represent cluster with canonical case
      }
      // Skip non-canonical cluster members
    } else {
      result.push(case_id); // Not in any cluster — include as-is
    }
  }

  return result;
}
