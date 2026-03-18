import { walkForwardReplayResponseSchema } from "@finance-superbrain/schemas";
import type {
  BenchmarkPackDomain,
  CreateModelVersionRequest,
  HistoricalReplayResponse,
  HistoricalCaseLibraryItem,
  WalkForwardReplayRequest,
  WalkForwardReplayResponse,
} from "@finance-superbrain/schemas";

import {
  inferBenchmarkDomain,
  listBenchmarkPackDefinitions,
} from "./benchmarkPackComposer.js";
import { InMemoryRepository } from "./InMemoryRepository.js";
import { ingestHistoricalCases } from "./historicalIngest.js";
import {
  runHistoricalReplayBenchmark,
  summarizeHistoricalReplayResults,
} from "./historicalReplay.js";
import { LocalEmbeddingProvider } from "./LocalEmbeddingProvider.js";
import { MockMarketDataProvider } from "./MockMarketDataProvider.js";
import type { Repository } from "./repository.types.js";

type EligibleHistoricalCase = {
  item: HistoricalCaseLibraryItem;
  domain: BenchmarkPackDomain;
  occurred_at: string;
};

type RegimeAccumulator = {
  regime: string;
  model_version: string;
  case_count: number;
  confidenceSum: number;
  totalScoreSum: number;
  directionSum: number;
  wrong: number;
};

const unique = (values: Array<string | null | undefined>) =>
  Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

const round = (value: number) => Number(value.toFixed(2));

const average = (sum: number, count: number) => (count ? sum / count : 0);

const matchesRequestedCasePack = (
  itemCasePack: string,
  requestedCasePacks?: string[],
) => {
  if (!requestedCasePacks?.length) {
    return true;
  }

  return requestedCasePacks.some((requestedCasePack) => {
    if (requestedCasePack === "macro_plus_v1") {
      return itemCasePack === "macro_plus_v1" || itemCasePack === "macro_v1";
    }

    return itemCasePack === requestedCasePack;
  });
};

const toReplayTags = (item: HistoricalCaseLibraryItem, domain: BenchmarkPackDomain) =>
  unique([
    ...item.labels.tags,
    ...item.labels.regimes,
    ...item.labels.regions,
    ...item.labels.sectors,
    ...item.labels.primary_themes,
    `domain:${domain}`,
    `source_pack:${item.case_pack}`,
  ]);

const sortChronological = (left: EligibleHistoricalCase, right: EligibleHistoricalCase) =>
  left.occurred_at.localeCompare(right.occurred_at) ||
  left.item.case_id.localeCompare(right.item.case_id);

const domainCounts = (items: EligibleHistoricalCase[]) => {
  const counts = new Map<BenchmarkPackDomain, number>();

  for (const item of items) {
    counts.set(item.domain, (counts.get(item.domain) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([domain, case_count]) => ({
      domain,
      case_count,
    }))
    .sort((left, right) => right.case_count - left.case_count || left.domain.localeCompare(right.domain));
};

const toRegimeMetrics = (
  caseResults: HistoricalReplayResponse["cases"],
  eligibleRegimes: Set<string>,
) => {
  const accumulators = new Map<string, RegimeAccumulator>();

  for (const result of caseResults) {
    const resultRegimes = unique(
      result.tags.filter((tag) => eligibleRegimes.has(tag)),
    );

    for (const regime of resultRegimes) {
      const key = `${result.model_version}::${regime}`;
      const existing = accumulators.get(key) ?? {
        regime,
        model_version: result.model_version,
        case_count: 0,
        confidenceSum: 0,
        totalScoreSum: 0,
        directionSum: 0,
        wrong: 0,
      };

      existing.case_count += 1;
      existing.confidenceSum += result.confidence;
      existing.totalScoreSum += result.total_score;
      existing.directionSum += result.direction_score;
      if (result.verdict === "wrong") {
        existing.wrong += 1;
      }

      accumulators.set(key, existing);
    }
  }

  return [...accumulators.values()]
    .map((accumulator) => ({
      regime: accumulator.regime,
      model_version: accumulator.model_version,
      case_count: accumulator.case_count,
      average_confidence: round(
        average(accumulator.confidenceSum, accumulator.case_count),
      ),
      average_total_score: round(
        average(accumulator.totalScoreSum, accumulator.case_count),
      ),
      direction_accuracy: round(
        average(accumulator.directionSum, accumulator.case_count),
      ),
      calibration_gap: round(
        average(accumulator.confidenceSum, accumulator.case_count) -
          average(accumulator.directionSum, accumulator.case_count),
      ),
      wrong_rate: round(average(accumulator.wrong, accumulator.case_count)),
    }))
    .sort((left, right) => {
      if (left.regime !== right.regime) {
        return left.regime.localeCompare(right.regime);
      }

      if (right.average_total_score !== left.average_total_score) {
        return right.average_total_score - left.average_total_score;
      }

      return left.model_version.localeCompare(right.model_version);
    });
};

const toTrainingIngestItems = (
  items: EligibleHistoricalCase[],
  trainingMemoryModelVersion: string,
) =>
  items.map(({ item }) => ({
    source: item.source,
    horizon: item.horizon,
    realized_moves: item.realized_moves,
    timing_alignment: item.timing_alignment,
    dominant_catalyst: item.dominant_catalyst,
    model_version: trainingMemoryModelVersion,
  }));

const toReplayCases = (
  items: EligibleHistoricalCase[],
  benchmarkPackId: string,
) =>
  items.map(({ item, domain }) => ({
    case_id: item.case_id,
    case_pack: `walk_forward:${benchmarkPackId}`,
    source: item.source,
    horizon: item.horizon,
    realized_moves: item.realized_moves,
    timing_alignment: item.timing_alignment,
    dominant_catalyst: item.dominant_catalyst,
    model_version: "walk-forward-library",
    tags: toReplayTags(item, domain),
  }));

const copyModelVersionIfPresent = async (
  sourceRepository: Repository,
  targetRepository: InMemoryRepository,
  modelVersion: string,
) => {
  const stored = await sourceRepository.getModelVersion(modelVersion);

  if (!stored) {
    return;
  }

  const input: CreateModelVersionRequest = {
    model_version: stored.model_version,
    family: stored.family,
    label: stored.label,
    description: stored.description,
    owner: stored.owner,
    prompt_profile: stored.prompt_profile,
    status: stored.status,
    feature_flags: stored.feature_flags,
  };

  await targetRepository.saveModelVersion(input);
};

const buildEligibleHistoricalPool = async (
  repository: Repository,
  request: WalkForwardReplayRequest,
) => {
  const benchmarkPack = listBenchmarkPackDefinitions().packs.find(
    (pack) => pack.pack_id === request.benchmark_pack_id,
  );

  if (!benchmarkPack) {
    throw new Error(`Unknown benchmark pack: ${request.benchmark_pack_id}`);
  }

  const allowedDomains = new Set(benchmarkPack.quotas.map((quota) => quota.domain));
  const totalItems = await repository.countHistoricalCaseLibraryItems({
    case_qualities: request.allowed_case_qualities,
  });
  const items = totalItems
    ? await repository.listHistoricalCaseLibraryItems({
        limit: Math.max(totalItems, 1),
        case_qualities: request.allowed_case_qualities,
      })
    : [];

  let undatedCaseCount = 0;
  let skippedDomainCount = 0;
  const eligible: EligibleHistoricalCase[] = [];
  const eligibleRegimes = new Set<string>();
  let eligibleHighConfidenceCaseCount = 0;

  for (const item of items) {
    if (!matchesRequestedCasePack(item.case_pack, request.case_pack_filters)) {
      continue;
    }

    const domain = inferBenchmarkDomain(item);

    if (!domain || !allowedDomains.has(domain)) {
      skippedDomainCount += 1;
      continue;
    }

    const occurredAt = item.source.occurred_at?.trim() || null;

    if (!occurredAt) {
      undatedCaseCount += 1;
      continue;
    }

    eligible.push({
      item,
      domain,
      occurred_at: occurredAt,
    });

    for (const regime of item.labels.regimes) {
      if (regime.trim()) {
        eligibleRegimes.add(regime.trim());
      }
    }

    if (item.labels.case_quality === "high_confidence") {
      eligibleHighConfidenceCaseCount += 1;
    }
  }

  return {
    eligible: eligible.sort(sortChronological),
    eligibleRegimes,
    eligibleRegimeCount: eligibleRegimes.size,
    eligibleHighConfidenceCaseCount,
    undatedCaseCount,
    skippedDomainCount,
  };
};

export const runWalkForwardReplay = async (
  repository: Repository,
  request: WalkForwardReplayRequest,
): Promise<WalkForwardReplayResponse> => {
  const {
    eligible,
    eligibleRegimes,
    eligibleRegimeCount,
    eligibleHighConfidenceCaseCount,
    undatedCaseCount,
    skippedDomainCount,
  } =
    await buildEligibleHistoricalPool(repository, request);
  const stepSize = request.step_size ?? request.test_window_size;

  if (eligible.length < request.min_train_cases + request.test_window_size) {
    throw new Error(
      `Insufficient dated cases for walk-forward validation. Found ${eligible.length} eligible case(s) but need at least ${request.min_train_cases + request.test_window_size}.`,
    );
  }

  const windows: WalkForwardReplayResponse["windows"] = [];
  const aggregatedCaseResults: WalkForwardReplayResponse["windows"][number]["report"]["cases"] = [];

  for (
    let testStartIndex = request.min_train_cases;
    testStartIndex + request.test_window_size <= eligible.length;
    testStartIndex += stepSize
  ) {
    const trainingItems = eligible.slice(0, testStartIndex);
    const testItems = eligible.slice(
      testStartIndex,
      testStartIndex + request.test_window_size,
    );

    if (!testItems.length) {
      continue;
    }

    const tempRepository = new InMemoryRepository();
    const embeddingProvider = new LocalEmbeddingProvider();
    const marketDataProvider = new MockMarketDataProvider();

    try {
      for (const modelVersion of request.model_versions) {
        await copyModelVersionIfPresent(repository, tempRepository, modelVersion);
      }

      if (request.seed_training_memory && trainingItems.length) {
        await ingestHistoricalCases(
          {
            repository: tempRepository,
            embeddingProvider,
            marketDataProvider,
          },
          {
            items: toTrainingIngestItems(
              trainingItems,
              request.training_memory_model_version,
            ),
          },
        );
      }

      const report = await runHistoricalReplayBenchmark(tempRepository, {
        model_versions: request.model_versions,
        cases: toReplayCases(testItems, request.benchmark_pack_id),
      });

      aggregatedCaseResults.push(...report.cases);
      windows.push({
        window_index: windows.length + 1,
        train_case_count: trainingItems.length,
        test_case_count: testItems.length,
        seeded_training_memory_count:
          request.seed_training_memory ? trainingItems.length : 0,
        train_start_at: trainingItems[0]!.occurred_at,
        train_end_at: trainingItems[trainingItems.length - 1]!.occurred_at,
        test_start_at: testItems[0]!.occurred_at,
        test_end_at: testItems[testItems.length - 1]!.occurred_at,
        test_case_ids: testItems.map(({ item }) => item.case_id),
        test_domain_counts: domainCounts(testItems),
        report,
      });
    } finally {
      // The temporary walk-forward services are purely in-memory/local and do not hold
      // external resources, so there is nothing to tear down here.
    }
  }

  if (!windows.length) {
    throw new Error(
      "Walk-forward validation could not form any windows from the eligible dated case pool.",
    );
  }

  const aggregate = summarizeHistoricalReplayResults(
    aggregatedCaseResults,
    `walk_forward:${request.benchmark_pack_id}`,
    windows.reduce((sum, window) => sum + window.test_case_count, 0),
  );
  const regimeMetrics = toRegimeMetrics(aggregatedCaseResults, eligibleRegimes);
  const warnings: string[] = [];

  if (undatedCaseCount > 0) {
    warnings.push(
      `Skipped ${undatedCaseCount} historical case(s) without occurred_at timestamps.`,
    );
  }

  if (skippedDomainCount > 0) {
    warnings.push(
      `Skipped ${skippedDomainCount} historical case(s) that did not map cleanly into the selected benchmark domains.`,
    );
  }

  if (!request.seed_training_memory) {
    warnings.push(
      "Training memory seeding was disabled, so analog calibration did not get prior-case memory inside each fold.",
    );
  }

  return walkForwardReplayResponseSchema.parse({
    generated_at: new Date().toISOString(),
    benchmark_pack_id: request.benchmark_pack_id,
    training_mode: request.training_mode,
    min_train_cases: request.min_train_cases,
    test_window_size: request.test_window_size,
    step_size: stepSize,
    eligible_case_count: eligible.length,
    eligible_regime_count: eligibleRegimeCount,
    eligible_high_confidence_case_count: eligibleHighConfidenceCaseCount,
    undated_case_count: undatedCaseCount,
    first_eligible_occurred_at: eligible[0]?.occurred_at ?? null,
    last_eligible_occurred_at: eligible[eligible.length - 1]?.occurred_at ?? null,
    window_count: windows.length,
    models: aggregate.models,
    regimes: regimeMetrics,
    leaders: aggregate.leaders,
    windows,
    warnings,
  });
};
