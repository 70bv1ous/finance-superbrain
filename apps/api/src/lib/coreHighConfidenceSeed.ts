import { historicalHighConfidenceSeedResponseSchema } from "@finance-superbrain/schemas";
import type {
  HistoricalCaseLibraryItem,
  HistoricalHighConfidenceCandidate,
  HistoricalHighConfidenceSeedItem,
  HistoricalHighConfidenceSeedRequest,
  HistoricalHighConfidenceSeedResponse,
} from "@finance-superbrain/schemas";

import { DEFAULT_CORE_HISTORICAL_CASE_PACKS } from "./coreHistoricalCorpus.js";
import { buildHistoricalLibraryGapReport } from "./historicalLibraryGapReport.js";
import { buildWalkForwardRegimeRegressionReport } from "./walkForwardRegimeRegressionReport.js";
import {
  assessHistoricalCaseHighConfidenceCandidate,
  promoteHistoricalCaseToHighConfidence,
} from "./historicalCaseConfidence.js";
import type { AppServices } from "./services.js";

const CORE_PACKS = [...DEFAULT_CORE_HISTORICAL_CASE_PACKS];

const unique = (values: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

const includesAny = (values: string[], needles: string[]) =>
  needles.some((needle) => values.includes(needle));

const severityRank: Record<"high" | "medium" | "low", number> = {
  high: 0,
  medium: 1,
  low: 2,
};

const countNamed = (values: string[]) => {
  const counts = new Map<string, number>();

  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .map(([name, count]) => ({
      name,
      count,
    }));
};

const inferSeedCompetingCatalysts = (item: HistoricalCaseLibraryItem) => {
  if (item.labels.competing_catalysts.length) {
    return item.labels.competing_catalysts;
  }

  const themes = item.labels.primary_themes;
  const eventFamily = item.labels.event_family ?? "";

  if (
    item.source.source_type === "earnings" ||
    item.labels.regimes.includes("earnings") ||
    includesAny(themes, ["earnings_guidance", "consumer_demand", "cloud_enterprise"])
  ) {
    return ["peer sympathy move", "sector positioning"];
  }

  if (
    includesAny(themes, ["inflation", "rates", "central_bank"]) ||
    includesAny(item.labels.regimes, ["macro_rates"])
  ) {
    return ["positioning unwind", "broader duration repricing"];
  }

  if (
    includesAny(themes, ["trade_policy", "china_risk", "fx_policy"]) ||
    includesAny(item.labels.regimes, ["policy_shock"])
  ) {
    return ["broader risk sentiment", "cross-asset positioning"];
  }

  if (includesAny(themes, ["energy", "energy_supply"])) {
    return ["demand expectations shift", "inventory positioning"];
  }

  if (
    includesAny(themes, ["banking_stress", "credit_stress", "default_risk"]) ||
    includesAny(item.labels.regimes, ["financial_stress"]) ||
    eventFamily.includes("bank")
  ) {
    return ["safe-haven duration bid", "policy backstop expectations"];
  }

  return ["cross-asset positioning", "broader risk sentiment"];
};

const buildSeedReviewHints = (item: HistoricalCaseLibraryItem) => {
  const hints: string[] = [];

  if (
    includesAny(item.labels.primary_themes, ["inflation", "rates", "central_bank"]) ||
    includesAny(item.labels.regimes, ["macro_rates"])
  ) {
    hints.push("Cross-check rates, dollar, and long-duration equity reaction for consistency.");
  } else if (
    item.source.source_type === "earnings" ||
    includesAny(item.labels.regimes, ["earnings"])
  ) {
    hints.push("Confirm the move was driven by guidance or tone, not only the headline print.");
  } else if (includesAny(item.labels.primary_themes, ["trade_policy", "china_risk", "fx_policy"])) {
    hints.push("Check whether policy language or broader risk appetite dominated the move.");
  } else if (includesAny(item.labels.primary_themes, ["energy", "energy_supply"])) {
    hints.push("Verify the move aligned with both commodity pricing and energy equities.");
  } else if (includesAny(item.labels.primary_themes, ["banking_stress", "credit_stress"])) {
    hints.push("Confirm stress was visible in both bank proxies and safe-haven assets.");
  }

  hints.push("Confirm the dominant catalyst still outweighs the listed competing catalysts.");
  hints.push("Verify the realized move is visible across the primary assets, not just one ticker.");
  hints.push("Use timing alignment to focus on the first-order market reaction rather than later noise.");

  return unique([...(item.review.review_hints ?? []), ...hints]).slice(0, 6);
};

const resolvePriorityRegimes = async (
  services: AppServices,
  request: HistoricalHighConfidenceSeedRequest,
) => {
  if (request.target_regimes?.length) {
    return unique(request.target_regimes);
  }

  const prioritizedRegimes: string[] = [];

  if (request.prioritize_gap_regimes) {
    const gapReport = await buildHistoricalLibraryGapReport(services.repository);

    prioritizedRegimes.push(
      ...gapReport.alerts
        .filter((alert) => alert.category === "regime_coverage")
        .sort(
          (left, right) =>
            severityRank[left.severity] - severityRank[right.severity] ||
            left.target.localeCompare(right.target),
        )
        .map((alert) => alert.target),
    );
  }

  if (request.prioritize_walk_forward_regimes) {
    const timedRegimeReport = await buildWalkForwardRegimeRegressionReport(services.repository, {
      benchmark_pack_id: request.benchmark_pack_id,
    });

    prioritizedRegimes.push(
      ...timedRegimeReport.alerts
        .sort(
          (left, right) =>
            severityRank[left.severity] - severityRank[right.severity] ||
            right.regression_streak - left.regression_streak ||
            left.regime.localeCompare(right.regime),
        )
        .map((alert) => alert.regime),
    );
  }

  return unique(prioritizedRegimes);
};

const buildSeedLabelNotes = (item: HistoricalCaseLibraryItem) =>
  item.labels.notes ??
  `Core corpus confidence seed: ${item.labels.event_family ?? "market_event"} with primary themes ${item.labels.primary_themes.join(
    ", ",
  ) || "none"} and primary assets ${item.labels.primary_assets.join(", ") || "none"}.`;

const buildSeedReviewNotes = (
  item: HistoricalCaseLibraryItem,
  competingCatalysts: string[],
) => {
  if (item.review.review_notes) {
    return item.review.review_notes;
  }

  return [
    `Core corpus confidence seed review for ${item.source.title ?? item.case_id}.`,
    `Primary event family: ${item.labels.event_family ?? "unknown"}.`,
    `Primary themes: ${item.labels.primary_themes.join(", ") || "none"}.`,
    `Primary assets: ${item.labels.primary_assets.join(", ") || "none"}.`,
    `Dominant catalyst: ${item.dominant_catalyst}.`,
    `Competing catalysts considered: ${competingCatalysts.join(", ")}.`,
    `Timing alignment was ${item.timing_alignment.toFixed(2)}, which supports a clean first-order reaction for replay trust.`,
  ].join(" ");
};

const buildSeedCandidate = (
  item: HistoricalCaseLibraryItem,
  reviewer: string,
) => {
  const competingCatalysts = inferSeedCompetingCatalysts(item);
  const seededItem: HistoricalCaseLibraryItem = {
    ...item,
    labels: {
      ...item.labels,
      competing_catalysts: competingCatalysts,
      notes: buildSeedLabelNotes(item),
    },
    review: {
      ...item.review,
      reviewer: item.review.reviewer ?? reviewer,
      review_notes: buildSeedReviewNotes(item, competingCatalysts),
      review_hints: buildSeedReviewHints(item),
    },
  };

  return {
    seededItem,
    candidate: assessHistoricalCaseHighConfidenceCandidate(seededItem),
  };
};

const rankSeedEntries = (
  entries: Array<{
    item: HistoricalCaseLibraryItem;
    candidate: HistoricalHighConfidenceCandidate;
    seededItem: HistoricalCaseLibraryItem;
    matchedPriorityRegimes: string[];
  }>,
  prioritizedRegimes: string[],
  limit: number,
) => {
  const sorted = [...entries].sort((left, right) => {
    if (right.matchedPriorityRegimes.length !== left.matchedPriorityRegimes.length) {
      return right.matchedPriorityRegimes.length - left.matchedPriorityRegimes.length;
    }

    if (right.candidate.candidate_score !== left.candidate.candidate_score) {
      return right.candidate.candidate_score - left.candidate.candidate_score;
    }

    return left.item.case_id.localeCompare(right.item.case_id);
  });
  const selected: typeof sorted = [];
  const used = new Set<string>();

  for (const regime of prioritizedRegimes) {
    const match = sorted.find(
      (entry) =>
        !used.has(entry.item.case_id) &&
        entry.matchedPriorityRegimes.includes(regime) &&
        entry.candidate.recommendation === "promote",
    );

    if (!match) {
      continue;
    }

    selected.push(match);
    used.add(match.item.case_id);

    if (selected.length >= limit) {
      return selected;
    }
  }

  for (const entry of sorted) {
    if (used.has(entry.item.case_id)) {
      continue;
    }

    selected.push(entry);
    used.add(entry.item.case_id);

    if (selected.length >= limit) {
      break;
    }
  }

  return selected;
};

const toSeedItem = (
  item: HistoricalCaseLibraryItem,
  action: HistoricalHighConfidenceSeedItem["action"],
  reason: string,
  candidate: HistoricalHighConfidenceCandidate,
  finalCaseQuality: HistoricalHighConfidenceSeedItem["final_case_quality"],
): HistoricalHighConfidenceSeedItem => ({
  case_id: item.case_id,
  case_pack: item.case_pack,
  title: item.source.title ?? item.case_id,
  action,
  reason,
  candidate,
  final_case_quality: finalCaseQuality,
});

export const runCoreHighConfidenceSeed = async (
  services: AppServices,
  request: HistoricalHighConfidenceSeedRequest,
): Promise<HistoricalHighConfidenceSeedResponse> => {
  const casePackFilters =
    request.case_pack_filters?.length ? request.case_pack_filters : CORE_PACKS;
  const prioritizedRegimes = await resolvePriorityRegimes(services, request);
  const reviewedItems = (
    await services.repository.listHistoricalCaseLibraryItems({
      limit: 500,
      case_qualities: ["reviewed", "high_confidence"],
    })
  ).filter(
    (item) =>
      item.labels.case_quality === "reviewed" && casePackFilters.includes(item.case_pack),
  );

  const scored = reviewedItems
    .map((item) => ({
      item,
      ...buildSeedCandidate(item, request.reviewer),
      matchedPriorityRegimes: item.labels.regimes.filter((regime) =>
        prioritizedRegimes.includes(regime),
      ),
    }))
    .filter((entry) => entry.item.labels.case_quality === "reviewed");
  const selected = rankSeedEntries(scored, prioritizedRegimes, request.limit);

  const items: HistoricalHighConfidenceSeedItem[] = [];

  for (const entry of selected) {
    const regimeContext = entry.matchedPriorityRegimes.length
      ? ` Priority regimes: ${entry.matchedPriorityRegimes.join(", ")}.`
      : "";

    if (
      entry.candidate.recommendation !== "promote" ||
      entry.candidate.candidate_score < request.min_candidate_score
    ) {
      items.push(
        toSeedItem(
          entry.item,
          "skipped",
          entry.candidate.blockers[0] ??
            `Candidate does not yet meet the promotion threshold.${regimeContext}`.trim(),
          entry.candidate,
          entry.item.labels.case_quality,
        ),
      );
      continue;
    }

    if (request.dry_run) {
      items.push(
        toSeedItem(
          entry.item,
          "skipped",
          `Dry run only: candidate is ready for promotion.${regimeContext}`.trim(),
          entry.candidate,
          entry.item.labels.case_quality,
        ),
      );
      continue;
    }

    const promotion = await promoteHistoricalCaseToHighConfidence(services, entry.item.case_id, {
      reviewer: request.reviewer,
      review_notes: entry.seededItem.review.review_notes,
      review_hints: entry.seededItem.review.review_hints,
      labels: {
        competing_catalysts: entry.seededItem.labels.competing_catalysts,
        notes: entry.seededItem.labels.notes,
      },
      labeling_mode: "merge",
      ingest_reviewed_memory: request.ingest_reviewed_memory,
      model_version: request.model_version,
      min_candidate_score: request.min_candidate_score,
    });

    items.push(
      toSeedItem(
        promotion.item,
        "promoted",
        `Promoted into the high-confidence evidence tier.${regimeContext}`.trim(),
        promotion.candidate,
        promotion.item.labels.case_quality,
      ),
    );
  }

  return historicalHighConfidenceSeedResponseSchema.parse({
    generated_at: new Date().toISOString(),
    reviewer: request.reviewer,
    dry_run: request.dry_run,
    scanned_reviewed_cases: reviewedItems.length,
    candidate_count: selected.length,
    promoted_count: items.filter((item) => item.action === "promoted").length,
    skipped_count: items.filter((item) => item.action === "skipped").length,
    min_candidate_score: request.min_candidate_score,
    case_pack_filters: casePackFilters,
    prioritized_regimes: prioritizedRegimes,
    promoted_regimes: countNamed(
      items
        .filter((item) => item.action === "promoted")
        .flatMap((item) => item.candidate.regimes),
    ),
    items,
  });
};
