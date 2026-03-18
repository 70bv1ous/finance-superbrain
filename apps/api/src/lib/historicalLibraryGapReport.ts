import { historicalLibraryGapReportSchema } from "@finance-superbrain/schemas";
import type { HistoricalCaseLibraryItem } from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

type GapSeverity = "low" | "medium" | "high";

type DomainTarget = {
  name: string;
  families: string[];
  min_cases: number;
  recommendation: string;
};

type RegimeTarget = {
  name: string;
  min_cases: number;
  recommendation: string;
};

const DOMAIN_TARGETS: DomainTarget[] = [
  {
    name: "macro",
    families: ["cpi_release", "nfp_release", "fomc_decision", "fed_speech"],
    min_cases: 4,
    recommendation: "Import more macro calendar cases so rate, inflation, and labor regimes have enough replay depth.",
  },
  {
    name: "earnings",
    families: [
      "earnings_beat",
      "earnings_miss",
      "guidance_raise",
      "guidance_cut",
      "ai_capex_upside",
      "margin_pressure",
      "consumer_weakness",
      "cloud_slowdown",
      "management_tone_shift",
    ],
    min_cases: 4,
    recommendation: "Expand the earnings transcript library so the model can separate company-specific shocks from macro regime moves.",
  },
  {
    name: "policy_fx",
    families: [
      "trade_escalation",
      "trade_relief",
      "stimulus_support",
      "fx_intervention",
      "capital_controls",
      "sovereign_credit",
      "fiscal_shock",
      "regulatory_crackdown",
      "sanctions",
      "geopolitical_deescalation",
    ],
    min_cases: 4,
    recommendation: "Increase sovereign policy and FX cases so cross-border shock reasoning has broader analog coverage.",
  },
  {
    name: "energy",
    families: [
      "opec_cut",
      "opec_raise",
      "energy_supply_disruption",
      "energy_inventory_draw",
      "energy_inventory_build",
      "natural_gas_spike",
      "energy_demand_shock",
    ],
    min_cases: 4,
    recommendation: "Add more energy and commodity shocks so inflation spillovers and cyclicals are better anchored.",
  },
  {
    name: "credit_banking",
    families: [
      "bank_run",
      "deposit_flight",
      "liquidity_backstop",
      "credit_spread_widening",
      "default_shock",
      "banking_contagion",
      "downgrade_wave",
    ],
    min_cases: 4,
    recommendation: "Grow the credit and banking stress library so funding shocks and contagion regimes have stronger memory.",
  },
];

const REGIME_TARGETS: RegimeTarget[] = [
  {
    name: "rate_hiking",
    min_cases: 2,
    recommendation: "Add more hawkish macro and policy cases so the engine can distinguish genuine higher-for-longer pressure from noisy rates headlines.",
  },
  {
    name: "rate_cutting",
    min_cases: 2,
    recommendation: "Expand dovish and softer macro cases so the engine learns how easing expectations transmit through bonds, equities, and FX.",
  },
  {
    name: "disinflation",
    min_cases: 2,
    recommendation: "Import more cooling-inflation cases so the engine can reason through duration rallies and easing paths with stronger analog support.",
  },
  {
    name: "tariff_escalation",
    min_cases: 2,
    recommendation: "Add more tariff and export-control shocks so cross-border policy risk has enough regime depth.",
  },
  {
    name: "china_stimulus",
    min_cases: 2,
    recommendation: "Increase China stimulus and support cases so the engine learns when policy relief is credible versus cosmetic.",
  },
  {
    name: "fx_intervention",
    min_cases: 2,
    recommendation: "Expand FX intervention cases so sovereign currency defense and spillover effects are better grounded.",
  },
  {
    name: "energy_shock",
    min_cases: 2,
    recommendation: "Add more supply-driven oil and gas shocks so inflation spillover and cyclicals repricing have stronger regime memory.",
  },
  {
    name: "banking_stress",
    min_cases: 2,
    recommendation: "Grow the banking-stress memory so liquidity scares and rescue episodes are not treated like one-off anomalies.",
  },
  {
    name: "ai_momentum",
    min_cases: 2,
    recommendation: "Add more AI capex and semiconductor upside cases so the engine can distinguish durable AI momentum from generic tech beta.",
  },
  {
    name: "earnings_reset",
    min_cases: 2,
    recommendation: "Import more earnings-reset cases so the engine learns how guidance cuts and tone shifts ripple through single-name and sector pricing.",
  },
  {
    name: "geopolitical_risk",
    min_cases: 2,
    recommendation: "Expand sanctions and conflict-driven cases so geopolitical repricing has enough regime depth.",
  },
];

const sortAlerts = <
  T extends { severity: GapSeverity; title: string },
>(
  alerts: T[],
) => {
  const rank: Record<GapSeverity, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  return [...alerts].sort(
    (left, right) => rank[left.severity] - rank[right.severity] || left.title.localeCompare(right.title),
  );
};

const countByDomain = (items: HistoricalCaseLibraryItem[], domain: DomainTarget) =>
  items.filter((item) => item.labels.event_family && domain.families.includes(item.labels.event_family)).length;

const countByRegime = (items: HistoricalCaseLibraryItem[], regime: RegimeTarget) =>
  items.filter((item) => item.labels.regimes.includes(regime.name)).length;

export const buildHistoricalLibraryGapReport = async (repository: Repository) => {
  const totalCases = await repository.countHistoricalCaseLibraryItems();
  const items = totalCases
    ? await repository.listHistoricalCaseLibraryItems({ limit: totalCases })
    : [];

  const qualityCounts = {
    draft: items.filter((item) => item.labels.case_quality === "draft").length,
    reviewed: items.filter((item) => item.labels.case_quality === "reviewed").length,
    high_confidence: items.filter((item) => item.labels.case_quality === "high_confidence").length,
  };
  const uniqueSourceTypes = new Set(items.map((item) => item.source.source_type)).size;
  const unassignedDrafts = items.filter(
    (item) => item.labels.case_quality === "draft" && !item.review.reviewer,
  ).length;
  const alerts: Array<{
    category:
      | "library_depth"
      | "pack_coverage"
      | "regime_coverage"
      | "review_backlog"
      | "review_assignment"
      | "high_confidence_gap"
      | "source_type_diversity";
    severity: GapSeverity;
    target: string;
    title: string;
    rationale: string;
    recommendation: string;
  }> = [];

  if (totalCases === 0) {
    alerts.push({
      category: "library_depth",
      severity: "high",
      target: "historical_library",
      title: "Historical library is still empty",
      rationale: "The superbrain has no stored historical finance cases to benchmark against or learn from durably.",
      recommendation: "Import at least one reviewed pack from macro, earnings, policy, energy, or credit before relying on replay or promotion outputs.",
    });
  } else {
    if (totalCases < 12) {
      alerts.push({
        category: "library_depth",
        severity: "high",
        target: "historical_library",
        title: "Historical memory is still shallow",
        rationale: `Only ${totalCases} library case(s) are stored, which is too thin for reliable replay comparisons across regimes.`,
        recommendation: "Keep importing reviewed packs so the library can support cross-regime analog retrieval and promotion discipline.",
      });
    } else if (totalCases < 24) {
      alerts.push({
        category: "library_depth",
        severity: "medium",
        target: "historical_library",
        title: "Historical memory needs more depth",
        rationale: `The library has ${totalCases} cases, enough to operate but still light for broad finance coverage.`,
        recommendation: "Expand into more domain packs and keep adding reviewed historical cases before trusting family-level replay results too strongly.",
      });
    }

    for (const domain of DOMAIN_TARGETS) {
      const domainCount = countByDomain(items, domain);

      if (domainCount === 0) {
        alerts.push({
          category: "pack_coverage",
          severity: totalCases >= 10 ? "high" : "medium",
          target: domain.name,
          title: `${domain.name.replaceAll("_", " ")} domain is missing`,
          rationale: `No historical cases are stored yet for the ${domain.name.replaceAll("_", " ")} domain.`,
          recommendation: domain.recommendation,
        });
      } else if (domainCount < domain.min_cases) {
        alerts.push({
          category: "pack_coverage",
          severity: "medium",
          target: domain.name,
          title: `${domain.name.replaceAll("_", " ")} domain is still thin`,
          rationale: `Only ${domainCount} case(s) are stored for ${domain.name.replaceAll("_", " ")}, below the working target of ${domain.min_cases}.`,
          recommendation: domain.recommendation,
        });
      }
    }

    for (const regime of REGIME_TARGETS) {
      const regimeCount = countByRegime(items, regime);

      if (regimeCount === 0) {
        alerts.push({
          category: "regime_coverage",
          severity: totalCases >= 12 ? "medium" : "low",
          target: regime.name,
          title: `${regime.name.replaceAll("_", " ")} regime is missing`,
          rationale: `No historical cases currently carry the ${regime.name.replaceAll("_", " ")} regime label, so timed validation is missing that part of the market map.`,
          recommendation: regime.recommendation,
        });
      } else if (regimeCount < regime.min_cases) {
        alerts.push({
          category: "regime_coverage",
          severity: "low",
          target: regime.name,
          title: `${regime.name.replaceAll("_", " ")} regime is still thin`,
          rationale: `Only ${regimeCount} case(s) are tagged ${regime.name.replaceAll("_", " ")}, below the working target of ${regime.min_cases}.`,
          recommendation: regime.recommendation,
        });
      }
    }

    if (qualityCounts.draft > qualityCounts.reviewed + qualityCounts.high_confidence) {
      alerts.push({
        category: "review_backlog",
        severity: "high",
        target: "review_queue",
        title: "Draft backlog is larger than trusted memory",
        rationale: `${qualityCounts.draft} draft cases are waiting while only ${qualityCounts.reviewed + qualityCounts.high_confidence} trusted cases are available.`,
        recommendation: "Push draft cases through adjudication so replay and promotion stay anchored to reviewed memory.",
      });
    } else if (qualityCounts.draft > 0) {
      alerts.push({
        category: "review_backlog",
        severity: "low",
        target: "review_queue",
        title: "Draft review queue is still open",
        rationale: `${qualityCounts.draft} draft case(s) still need review before they can feed the strongest replay paths.`,
        recommendation: "Review draft cases, especially ones in thin domains, to keep memory quality improving alongside library size.",
      });
    }

    if (unassignedDrafts > 0) {
      alerts.push({
        category: "review_assignment",
        severity: unassignedDrafts >= 3 ? "medium" : "low",
        target: "review_queue",
        title: "Some draft cases are unassigned",
        rationale: `${unassignedDrafts} draft case(s) have no reviewer attached, which can leave important memory gaps unattended.`,
        recommendation: "Assign reviewers to open drafts so the library can move from raw intake to trusted training material.",
      });
    }

    if (totalCases >= 6 && qualityCounts.high_confidence === 0) {
      alerts.push({
        category: "high_confidence_gap",
        severity: "medium",
        target: "high_confidence",
        title: "No high-confidence cases exist yet",
        rationale: "The library has reviewed cases, but none are marked high confidence, which weakens the strongest benchmark path.",
        recommendation: "Promote the cleanest reviewed cases to high confidence after adjudication so replay packs have a trusted core set.",
      });
    }

    if (totalCases >= 6 && uniqueSourceTypes < 3) {
      alerts.push({
        category: "source_type_diversity",
        severity: "low",
        target: "source_types",
        title: "Historical memory lacks source-type diversity",
        rationale: `Only ${uniqueSourceTypes} source type(s) are represented, which makes the library less robust across headlines, speeches, and transcripts.`,
        recommendation: "Balance the library with more speeches, transcripts, earnings, and headline cases so reasoning transfers better across source formats.",
      });
    }
  }

  const sorted = sortAlerts(alerts);

  return historicalLibraryGapReportSchema.parse({
    generated_at: new Date().toISOString(),
    alert_count: sorted.length,
    counts: {
      high: sorted.filter((alert) => alert.severity === "high").length,
      medium: sorted.filter((alert) => alert.severity === "medium").length,
      low: sorted.filter((alert) => alert.severity === "low").length,
    },
    alerts: sorted,
  });
};
