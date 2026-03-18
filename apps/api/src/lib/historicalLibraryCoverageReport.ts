import { historicalLibraryCoverageResponseSchema } from "@finance-superbrain/schemas";
import type { HistoricalCaseLibraryItem } from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

type NamedCount = {
  name: string;
  count: number;
};

type PackCoverage = {
  case_pack: string;
  count: number;
  draft_count: number;
  reviewed_count: number;
  high_confidence_count: number;
  last_updated_at: string | null;
};

const incrementCount = (map: Map<string, number>, name: string, amount = 1) => {
  map.set(name, (map.get(name) ?? 0) + amount);
};

const incrementUniqueCounts = (
  map: Map<string, number>,
  values: Iterable<string>,
  fallback?: string,
) => {
  const unique = new Set(
    [...values]
      .map((value) => value.trim())
      .filter(Boolean),
  );

  if (!unique.size && fallback) {
    unique.add(fallback);
  }

  for (const value of unique) {
    incrementCount(map, value);
  }
};

const sortNamedCounts = (map: Map<string, number>, top: number): NamedCount[] =>
  [...map.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, Math.max(1, top))
    .map(([name, count]) => ({
      name,
      count,
    }));

const sortPackCoverage = (map: Map<string, PackCoverage>, top: number) =>
  [...map.values()]
    .sort((left, right) => right.count - left.count || left.case_pack.localeCompare(right.case_pack))
    .slice(0, Math.max(1, top));

const toThemeValues = (item: HistoricalCaseLibraryItem) =>
  new Set([...item.labels.primary_themes, ...item.parsed_event.themes]);

export const buildHistoricalLibraryCoverageReport = async (
  repository: Repository,
  options: {
    top?: number;
  } = {},
) => {
  const top = Number.isFinite(options.top) ? Math.max(3, Math.min(20, options.top ?? 8)) : 8;
  const totalCases = await repository.countHistoricalCaseLibraryItems();
  const items = totalCases
    ? await repository.listHistoricalCaseLibraryItems({ limit: totalCases })
    : [];

  const casePacks = new Map<string, PackCoverage>();
  const eventFamilies = new Map<string, number>();
  const regimes = new Map<string, number>();
  const sourceTypes = new Map<string, number>();
  const regions = new Map<string, number>();
  const themes = new Map<string, number>();
  const horizons = new Map<string, number>();
  const qualityCounts = new Map<HistoricalCaseLibraryItem["labels"]["case_quality"], number>([
    ["draft", 0],
    ["reviewed", 0],
    ["high_confidence", 0],
  ]);

  let assignedCases = 0;
  let unassignedCases = 0;
  let adjudicatedCases = 0;

  for (const item of items) {
    const existingPack = casePacks.get(item.case_pack) ?? {
      case_pack: item.case_pack,
      count: 0,
      draft_count: 0,
      reviewed_count: 0,
      high_confidence_count: 0,
      last_updated_at: null,
    };

    existingPack.count += 1;
    existingPack.last_updated_at =
      !existingPack.last_updated_at || existingPack.last_updated_at < item.updated_at
        ? item.updated_at
        : existingPack.last_updated_at;

    if (item.labels.case_quality === "draft") {
      existingPack.draft_count += 1;
    } else if (item.labels.case_quality === "reviewed") {
      existingPack.reviewed_count += 1;
    } else {
      existingPack.high_confidence_count += 1;
    }

    casePacks.set(item.case_pack, existingPack);
    qualityCounts.set(item.labels.case_quality, (qualityCounts.get(item.labels.case_quality) ?? 0) + 1);

    incrementCount(horizons, item.horizon);
    incrementCount(sourceTypes, item.source.source_type);
    incrementUniqueCounts(eventFamilies, [item.labels.event_family ?? "unclassified"]);
    incrementUniqueCounts(regimes, item.labels.regimes, "unclassified_regime");
    incrementUniqueCounts(regions, item.labels.regions, "unassigned_region");
    incrementUniqueCounts(themes, toThemeValues(item), "unclassified_theme");

    if (item.review.adjudicated_at) {
      adjudicatedCases += 1;
    }

    if (item.labels.case_quality === "draft") {
      if (item.review.reviewer) {
        assignedCases += 1;
      } else {
        unassignedCases += 1;
      }
    }
  }

  return historicalLibraryCoverageResponseSchema.parse({
    generated_at: new Date().toISOString(),
    total_cases: totalCases,
    needs_review_count: qualityCounts.get("draft") ?? 0,
    reviewed_cases: qualityCounts.get("reviewed") ?? 0,
    high_confidence_cases: qualityCounts.get("high_confidence") ?? 0,
    unique_case_packs: casePacks.size,
    unique_event_families: eventFamilies.size,
    unique_regimes: regimes.size,
    unique_regions: regions.size,
    unique_themes: themes.size,
    review_queue: {
      assigned_cases: assignedCases,
      unassigned_cases: unassignedCases,
      adjudicated_cases: adjudicatedCases,
    },
    by_case_pack: sortPackCoverage(casePacks, top),
    by_case_quality: [
      { name: "draft", count: qualityCounts.get("draft") ?? 0 },
      { name: "reviewed", count: qualityCounts.get("reviewed") ?? 0 },
      { name: "high_confidence", count: qualityCounts.get("high_confidence") ?? 0 },
    ],
    by_event_family: sortNamedCounts(eventFamilies, top),
    by_regime: sortNamedCounts(regimes, top),
    by_source_type: sortNamedCounts(sourceTypes, top),
    by_region: sortNamedCounts(regions, top),
    by_theme: sortNamedCounts(themes, top),
    by_horizon: sortNamedCounts(horizons, top),
  });
};
