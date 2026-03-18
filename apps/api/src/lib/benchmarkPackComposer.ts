import {
  benchmarkPackCompositionSchema,
  benchmarkPackListResponseSchema,
  historicalReplayRequestSchema,
} from "@finance-superbrain/schemas";
import type {
  BenchmarkPackComposeRequest,
  BenchmarkPackComposition,
  BenchmarkPackDefinition,
  BenchmarkPackDomain,
  HistoricalCaseLibraryItem,
} from "@finance-superbrain/schemas";

import type { Repository } from "./repository.types.js";

const unique = (values: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

const BENCHMARK_PACKS = benchmarkPackListResponseSchema.parse({
  packs: [
    {
      pack_id: "core_benchmark_lite_v1",
      label: "Core benchmark lite v1",
      description:
        "A 5-case smoke pack with one trusted case from each major finance domain.",
      target_case_count: 5,
      allowed_case_qualities: ["reviewed", "high_confidence"],
      quotas: [
        { domain: "macro", minimum_cases: 1 },
        { domain: "earnings", minimum_cases: 1 },
        { domain: "policy_fx", minimum_cases: 1 },
        { domain: "energy", minimum_cases: 1 },
        { domain: "credit_banking", minimum_cases: 1 },
      ],
    },
    {
      pack_id: "core_benchmark_v1",
      label: "Core benchmark v1",
      description:
        "A balanced 20-case core benchmark with reviewed cross-domain finance history.",
      target_case_count: 20,
      allowed_case_qualities: ["reviewed", "high_confidence"],
      quotas: [
        { domain: "macro", minimum_cases: 4 },
        { domain: "earnings", minimum_cases: 4 },
        { domain: "policy_fx", minimum_cases: 4 },
        { domain: "energy", minimum_cases: 4 },
        { domain: "credit_banking", minimum_cases: 4 },
      ],
    },
  ],
}).packs;

const QUALITY_RANK: Record<HistoricalCaseLibraryItem["labels"]["case_quality"], number> = {
  draft: 0,
  reviewed: 1,
  high_confidence: 2,
};

const DOMAIN_EVENT_FAMILIES: Record<BenchmarkPackDomain, Set<string>> = {
  macro: new Set(["cpi_release", "nfp_release", "fomc_decision", "fed_speech"]),
  earnings: new Set([
    "earnings_beat",
    "earnings_miss",
    "guidance_raise",
    "guidance_cut",
    "ai_capex_upside",
    "margin_pressure",
    "consumer_weakness",
    "cloud_slowdown",
    "management_tone_shift",
  ]),
  policy_fx: new Set([
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
  ]),
  energy: new Set([
    "opec_cut",
    "opec_raise",
    "energy_supply_disruption",
    "energy_inventory_draw",
    "energy_inventory_build",
    "natural_gas_spike",
    "energy_demand_shock",
  ]),
  credit_banking: new Set([
    "bank_run",
    "deposit_flight",
    "liquidity_backstop",
    "credit_spread_widening",
    "default_shock",
    "banking_contagion",
    "downgrade_wave",
  ]),
};

const valueSet = (item: HistoricalCaseLibraryItem) =>
  new Set(
    [
      item.labels.event_family,
      ...item.labels.tags,
      ...item.labels.regimes,
      ...item.labels.regions,
      ...item.labels.sectors,
      ...item.labels.primary_themes,
    ]
      .map((value) => value?.toLowerCase().trim())
      .filter((value): value is string => Boolean(value)),
  );

export const inferBenchmarkDomain = (
  item: HistoricalCaseLibraryItem,
): BenchmarkPackDomain | null => {
  const eventFamily = item.labels.event_family?.toLowerCase().trim() ?? "";

  for (const [domain, families] of Object.entries(DOMAIN_EVENT_FAMILIES) as Array<
    [BenchmarkPackDomain, Set<string>]
  >) {
    if (families.has(eventFamily)) {
      return domain;
    }
  }

  const values = valueSet(item);

  if (
    item.source.source_type === "earnings" ||
    values.has("earnings") ||
    values.has("earnings_guidance")
  ) {
    return "earnings";
  }

  if (
    values.has("banking_stress") ||
    values.has("credit_stress") ||
    values.has("default_risk") ||
    values.has("liquidity")
  ) {
    return "credit_banking";
  }

  if (
    values.has("energy") ||
    values.has("energy_supply") ||
    values.has("commodities") ||
    values.has("crude_oil") ||
    values.has("natural_gas")
  ) {
    return "energy";
  }

  if (
    values.has("trade_policy") ||
    values.has("fx_policy") ||
    values.has("sovereign_risk") ||
    values.has("sanctions_policy") ||
    values.has("china_risk") ||
    values.has("policy_shock")
  ) {
    return "policy_fx";
  }

  if (
    values.has("macro_rates") ||
    values.has("rates") ||
    values.has("inflation") ||
    values.has("central_bank") ||
    values.has("labor")
  ) {
    return "macro";
  }

  return null;
};

const sortLibraryItems = (left: HistoricalCaseLibraryItem, right: HistoricalCaseLibraryItem) => {
  const qualityDelta =
    QUALITY_RANK[right.labels.case_quality] - QUALITY_RANK[left.labels.case_quality];

  if (qualityDelta !== 0) {
    return qualityDelta;
  }

  const leftTimestamp =
    left.review.adjudicated_at ?? left.review.reviewed_at ?? left.updated_at ?? left.created_at;
  const rightTimestamp =
    right.review.adjudicated_at ?? right.review.reviewed_at ?? right.updated_at ?? right.created_at;
  const timeDelta = rightTimestamp.localeCompare(leftTimestamp);

  if (timeDelta !== 0) {
    return timeDelta;
  }

  return left.case_id.localeCompare(right.case_id);
};

const getBenchmarkPackDefinition = (packId: string) => {
  const found = BENCHMARK_PACKS.find((item) => item.pack_id === packId);

  if (!found) {
    throw new Error(`Unknown benchmark pack: ${packId}`);
  }

  return found;
};

const resolveBenchmarkPack = (request: BenchmarkPackComposeRequest): BenchmarkPackDefinition => {
  const base = getBenchmarkPackDefinition(request.benchmark_pack_id);

  return {
    ...base,
    target_case_count: request.target_case_count ?? base.target_case_count,
    allowed_case_qualities:
      request.allowed_case_qualities.length > 0
        ? request.allowed_case_qualities
        : base.allowed_case_qualities,
    quotas: request.quotas?.length ? request.quotas : base.quotas,
  };
};

const toReplayTags = (
  item: HistoricalCaseLibraryItem,
  domain: BenchmarkPackDomain,
  benchmarkPackId: string,
) =>
  unique([
    ...item.labels.tags,
    ...item.labels.regimes,
    ...item.labels.regions,
    ...item.labels.sectors,
    ...item.labels.primary_themes,
    `benchmark_pack:${benchmarkPackId}`,
    `domain:${domain}`,
    `source_pack:${item.case_pack}`,
  ]);

type SelectedCase = {
  item: HistoricalCaseLibraryItem;
  domain: BenchmarkPackDomain;
};

const selectDomainCases = (
  pool: Map<BenchmarkPackDomain, HistoricalCaseLibraryItem[]>,
  definition: BenchmarkPackDefinition,
) => {
  const selected: SelectedCase[] = [];
  const selectedIds = new Set<string>();

  for (const quota of definition.quotas) {
    const candidates = pool.get(quota.domain) ?? [];

    for (const item of candidates) {
      if (selectedIds.has(item.case_id)) {
        continue;
      }

      const domainCount = selected.filter((entry) => entry.domain === quota.domain).length;

      if (domainCount >= quota.minimum_cases) {
        break;
      }

      selected.push({ item, domain: quota.domain });
      selectedIds.add(item.case_id);
    }
  }

  const orderedRemainders = definition.quotas.flatMap((quota) =>
    (pool.get(quota.domain) ?? [])
      .filter((item) => !selectedIds.has(item.case_id))
      .map((item) => ({ item, domain: quota.domain })),
  );

  for (const entry of orderedRemainders) {
    if (selected.length >= definition.target_case_count) {
      break;
    }

    selected.push(entry);
    selectedIds.add(entry.item.case_id);
  }

  return selected;
};

const buildDomainCounts = (definition: BenchmarkPackDefinition, selected: SelectedCase[]) =>
  definition.quotas.map((quota) => ({
    domain: quota.domain,
    minimum_cases: quota.minimum_cases,
    selected_cases: selected.filter((item) => item.domain === quota.domain).length,
  }));

export const listBenchmarkPackDefinitions = () =>
  benchmarkPackListResponseSchema.parse({
    packs: BENCHMARK_PACKS,
  });

export const composeHistoricalBenchmarkPack = async (
  repository: Repository,
  request: BenchmarkPackComposeRequest,
): Promise<BenchmarkPackComposition> => {
  const definition = resolveBenchmarkPack(request);
  const requestedCasePacks = request.case_pack_filters?.length
    ? new Set(request.case_pack_filters)
    : null;
  const items = (await repository.listHistoricalCaseLibraryItems({
    limit: Math.max(200, Math.min(500, definition.target_case_count * 20)),
    case_ids: request.case_ids,
    case_qualities: definition.allowed_case_qualities,
    case_pack: request.case_pack_filters?.length === 1 ? request.case_pack_filters[0] : undefined,
  }))
    .filter((item) => (requestedCasePacks ? requestedCasePacks.has(item.case_pack) : true))
    .sort(sortLibraryItems);

  if (!items.length) {
    throw new Error("No historical library cases matched the requested benchmark filters.");
  }

  const domainPool = new Map<BenchmarkPackDomain, HistoricalCaseLibraryItem[]>();

  for (const quota of definition.quotas) {
    domainPool.set(quota.domain, []);
  }

  for (const item of items) {
    const domain = inferBenchmarkDomain(item);

    if (!domain || !domainPool.has(domain)) {
      continue;
    }

    domainPool.get(domain)?.push(item);
  }

  const selected = selectDomainCases(domainPool, definition);

  if (!selected.length) {
    throw new Error("The benchmark composer could not find any matching domain cases.");
  }

  const domainCounts = buildDomainCounts(definition, selected);
  const missingDomains = domainCounts.filter((item) => item.selected_cases < item.minimum_cases);
  const replayRequest = historicalReplayRequestSchema.parse({
    model_versions: request.model_versions,
    cases: selected.map(({ item, domain }) => ({
      case_id: item.case_id,
      case_pack: definition.pack_id,
      source: item.source,
      horizon: item.horizon,
      realized_moves: item.realized_moves,
      timing_alignment: item.timing_alignment,
      dominant_catalyst: item.dominant_catalyst,
      model_version: "historical-library-benchmark",
      tags: toReplayTags(item, domain, definition.pack_id),
    })),
  });

  return benchmarkPackCompositionSchema.parse({
    pack_id: definition.pack_id,
    label: definition.label,
    description: definition.description,
    target_case_count: definition.target_case_count,
    strict_quotas: request.strict_quotas,
    quotas_met: missingDomains.length === 0,
    allowed_case_qualities: definition.allowed_case_qualities,
    domain_counts: domainCounts,
    missing_domains: missingDomains,
    selected_case_count: selected.length,
    selected_case_ids: selected.map(({ item }) => item.case_id),
    selected_cases: selected.map(({ item, domain }) => ({
      case_id: item.case_id,
      source_case_pack: item.case_pack,
      domain,
      case_quality: item.labels.case_quality,
    })),
    replay_request: replayRequest,
  });
};
