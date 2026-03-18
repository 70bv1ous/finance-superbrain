import {
  historicalCaseLibraryIngestionResponseSchema,
  historicalCaseLibraryListResponseSchema,
  historicalCaseLibraryReviewResponseSchema,
  historicalReplayRequestSchema,
} from "@finance-superbrain/schemas";
import type {
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryIngestionRequest,
  HistoricalCaseLibraryItem,
  HistoricalCaseLibraryReviewRequest,
  HistoricalCaseLibraryReplayRequest,
} from "@finance-superbrain/schemas";

import { buildHistoricalCaseLabels, normalizeHistoricalCaseId } from "./historicalCaseLabeling.js";
import { ingestHistoricalCases } from "./historicalIngest.js";
import { parseFinanceEvent } from "./parseFinanceEvent.js";
import type { Repository } from "./repository.types.js";
import type { AppServices } from "./services.js";

const toReplayTags = (item: HistoricalCaseLibraryItem) =>
  Array.from(
    new Set([
      ...item.labels.tags,
      ...item.labels.regimes,
      ...item.labels.regions,
      ...item.labels.sectors,
      ...item.labels.primary_themes,
    ]),
  );

const matchesReplayCasePack = (itemCasePack: string, requestedCasePack?: string) => {
  if (!requestedCasePack) {
    return true;
  }

  if (requestedCasePack === "macro_plus_v1") {
    return itemCasePack === "macro_v1" || itemCasePack === "macro_plus_v1";
  }

  return itemCasePack === requestedCasePack;
};

const toLabelInput = (
  labels: HistoricalCaseLibraryItem["labels"],
): HistoricalCaseLabelInput => ({
  event_family: labels.event_family,
  tags: labels.tags,
  regimes: labels.regimes,
  regions: labels.regions,
  sectors: labels.sectors,
  primary_themes: labels.primary_themes,
  primary_assets: labels.primary_assets,
  competing_catalysts: labels.competing_catalysts,
  surprise_type: labels.surprise_type,
  case_quality: labels.case_quality,
  notes: labels.notes,
});

const mergeLabelInput = (
  base: HistoricalCaseLabelInput,
  override?: HistoricalCaseLabelInput,
): HistoricalCaseLabelInput => ({
  event_family: override?.event_family === undefined ? base.event_family : override.event_family,
  tags: override?.tags ?? base.tags,
  regimes: override?.regimes ?? base.regimes,
  regions: override?.regions ?? base.regions,
  sectors: override?.sectors ?? base.sectors,
  primary_themes: override?.primary_themes ?? base.primary_themes,
  primary_assets: override?.primary_assets ?? base.primary_assets,
  competing_catalysts: override?.competing_catalysts ?? base.competing_catalysts,
  surprise_type: override?.surprise_type ?? base.surprise_type,
  case_quality: override?.case_quality ?? base.case_quality,
  notes: override?.notes === undefined ? base.notes : override.notes,
});

const needsReviewPromotion = (
  request: HistoricalCaseLibraryIngestionRequest,
  labels: HistoricalCaseLibraryItem["labels"],
  item: HistoricalCaseLibraryIngestionRequest["items"][number],
) =>
  request.ingest_reviewed_memory &&
  labels.case_quality === "draft" &&
  item.labels?.case_quality === undefined;

export const ingestHistoricalCaseLibrary = async (
  services: AppServices,
  request: HistoricalCaseLibraryIngestionRequest,
) => {
  const results: Array<{
    case_id: string;
    case_pack: string;
    case_quality: HistoricalCaseLibraryItem["labels"]["case_quality"];
    label_source: HistoricalCaseLibraryItem["labels"]["label_source"];
    themes: string[];
    primary_assets: string[];
    stored_in_library: boolean;
    reviewed_prediction_id: string | null;
    verdict: "correct" | "partially_correct" | "wrong" | null;
    total_score: number | null;
  }> = [];

  for (const [index, item] of request.items.entries()) {
    const parsedEvent = parseFinanceEvent(item.source);
    let labels = buildHistoricalCaseLabels(item, parsedEvent, request.labeling_mode);

    if (needsReviewPromotion(request, labels, item)) {
      labels = {
        ...labels,
        case_quality: "reviewed",
      };
    }

    const now = new Date().toISOString();
    const libraryItem: HistoricalCaseLibraryItem = {
      case_id: normalizeHistoricalCaseId(item, index),
      case_pack: item.case_pack,
      source: item.source,
      horizon: item.horizon,
      realized_moves: item.realized_moves,
      timing_alignment: item.timing_alignment,
      dominant_catalyst: item.dominant_catalyst,
      parsed_event: parsedEvent,
      labels,
      review: {
        review_hints: item.review_hints ?? [],
        reviewer: null,
        review_notes: null,
        reviewed_at: labels.case_quality === "draft" ? null : now,
        adjudicated_at: labels.case_quality === "draft" ? null : now,
      },
      created_at: now,
      updated_at: now,
    };

    const storedLibraryItem = request.store_library
      ? await services.repository.saveHistoricalCaseLibraryItem(libraryItem)
      : null;
    const reviewedResult = request.ingest_reviewed_memory
      ? (
          await ingestHistoricalCases(services, {
            items: [
              {
                source: item.source,
                horizon: item.horizon,
                realized_moves: item.realized_moves,
                timing_alignment: item.timing_alignment,
                dominant_catalyst: item.dominant_catalyst,
                model_version: item.model_version ?? request.fallback_model_version,
              },
            ],
          })
        ).results[0] ?? null
      : null;

    results.push({
      case_id: libraryItem.case_id,
      case_pack: libraryItem.case_pack,
      case_quality: labels.case_quality,
      label_source: labels.label_source,
      themes: labels.primary_themes,
      primary_assets: labels.primary_assets,
      stored_in_library: Boolean(storedLibraryItem),
      reviewed_prediction_id: reviewedResult?.prediction_id ?? null,
      verdict: reviewedResult?.verdict ?? null,
      total_score: reviewedResult?.total_score ?? null,
    });
  }

  return historicalCaseLibraryIngestionResponseSchema.parse({
    ingested_cases: results.length,
    stored_library_items: results.filter((item) => item.stored_in_library).length,
    reviewed_ingests: results.filter((item) => item.reviewed_prediction_id !== null).length,
    results,
  });
};

export const listHistoricalCaseLibrary = async (
  repository: Repository,
  options: {
    limit?: number;
    case_pack?: string;
    case_ids?: string[];
    case_qualities?: HistoricalCaseLibraryItem["labels"]["case_quality"][];
    reviewer?: string;
  } = {},
) =>
  historicalCaseLibraryListResponseSchema.parse({
    items: await repository.listHistoricalCaseLibraryItems(options),
  });

export const reviewHistoricalCaseLibraryItem = async (
  services: AppServices,
  caseId: string,
  request: HistoricalCaseLibraryReviewRequest,
) => {
  const existing = await services.repository.getHistoricalCaseLibraryItem(caseId);

  if (!existing) {
    throw new Error(`Historical library case not found: ${caseId}`);
  }

  const nextManualLabels = mergeLabelInput(toLabelInput(existing.labels), request.labels);

  if (request.case_quality) {
    nextManualLabels.case_quality = request.case_quality;
  }

  const draft = {
    case_id: existing.case_id,
    case_pack: request.case_pack ?? existing.case_pack,
    source: existing.source,
    horizon: existing.horizon,
    realized_moves: existing.realized_moves,
    timing_alignment: existing.timing_alignment,
    dominant_catalyst: existing.dominant_catalyst,
    labels: nextManualLabels,
  };
  const now = new Date().toISOString();
  const labels = buildHistoricalCaseLabels(draft, existing.parsed_event, request.labeling_mode);
  const finalLabels = request.case_quality
    ? {
        ...labels,
        case_quality: request.case_quality,
      }
    : labels;
  const updatedItem: HistoricalCaseLibraryItem = {
    ...existing,
    case_pack: draft.case_pack,
    labels: finalLabels,
    review: {
      review_hints: request.review_hints ?? existing.review.review_hints,
      reviewer: request.reviewer ?? existing.review.reviewer,
      review_notes:
        request.review_notes === undefined ? existing.review.review_notes : request.review_notes,
      reviewed_at: now,
      adjudicated_at:
        finalLabels.case_quality === "draft" ? null : existing.review.adjudicated_at ?? now,
    },
    updated_at: now,
  };

  const saved = await services.repository.saveHistoricalCaseLibraryItem(updatedItem);
  const reviewedResult =
    request.ingest_reviewed_memory && finalLabels.case_quality !== "draft"
      ? (
          await ingestHistoricalCases(services, {
            items: [
              {
                source: saved.source,
                horizon: saved.horizon,
                realized_moves: saved.realized_moves,
                timing_alignment: saved.timing_alignment,
                dominant_catalyst: saved.dominant_catalyst,
                model_version: request.model_version,
              },
            ],
          })
        ).results[0] ?? null
      : null;

  return historicalCaseLibraryReviewResponseSchema.parse({
    item: saved,
    reviewed_prediction_id: reviewedResult?.prediction_id ?? null,
    verdict: reviewedResult?.verdict ?? null,
    total_score: reviewedResult?.total_score ?? null,
  });
};

export const buildHistoricalReplayRequestFromLibrary = async (
  repository: Repository,
  request: HistoricalCaseLibraryReplayRequest,
) => {
  const items = (
    await repository.listHistoricalCaseLibraryItems({
      limit: request.limit,
      case_pack: request.case_pack === "macro_plus_v1" ? undefined : request.case_pack,
      case_ids: request.case_ids,
      case_qualities: request.allowed_case_qualities,
    })
  ).filter((item) => matchesReplayCasePack(item.case_pack, request.case_pack));

  if (!items.length) {
    throw new Error("No historical library cases matched the supplied filters.");
  }

  return historicalReplayRequestSchema.parse({
    model_versions: request.model_versions,
    cases: items.map((item) => ({
      case_id: item.case_id,
      case_pack: item.case_pack,
      source: item.source,
      horizon: item.horizon,
      realized_moves: item.realized_moves,
      timing_alignment: item.timing_alignment,
      dominant_catalyst: item.dominant_catalyst,
      model_version: "historical-library-baseline",
      tags: toReplayTags(item),
    })),
  });
};
