import {
  historicalHighConfidenceCandidateReportSchema,
  historicalHighConfidencePromotionResponseSchema,
} from "@finance-superbrain/schemas";
import type {
  HistoricalCaseLabelInput,
  HistoricalCaseLibraryItem,
  HistoricalHighConfidenceCandidate,
  HistoricalHighConfidenceCandidateReport,
  HistoricalHighConfidencePromotionRequest,
} from "@finance-superbrain/schemas";

import { reviewHistoricalCaseLibraryItem } from "./historicalCaseLibrary.js";
import type { Repository } from "./repository.types.js";
import type { AppServices } from "./services.js";

const round = (value: number) => Number(value.toFixed(2));

const hasUsefulText = (value: string | null | undefined, minimumLength = 24) =>
  typeof value === "string" && value.trim().length >= minimumLength;

const hasMeaningfulArray = (value: string[] | null | undefined, minimumLength = 1) =>
  Array.isArray(value) && value.filter(Boolean).length >= minimumLength;

const sortCandidateScore = (
  left: HistoricalHighConfidenceCandidate,
  right: HistoricalHighConfidenceCandidate,
) => {
  if (right.candidate_score !== left.candidate_score) {
    return right.candidate_score - left.candidate_score;
  }

  return left.case_id.localeCompare(right.case_id);
};

const addStrength = (strengths: string[], text: string) => {
  if (!strengths.includes(text) && strengths.length < 12) {
    strengths.push(text);
  }
};

const mergeLabelOverrides = (
  labels: HistoricalCaseLibraryItem["labels"],
  override?: HistoricalCaseLabelInput,
): HistoricalCaseLibraryItem["labels"] => ({
  ...labels,
  event_family: override?.event_family === undefined ? labels.event_family : override.event_family,
  tags: override?.tags ?? labels.tags,
  regimes: override?.regimes ?? labels.regimes,
  regions: override?.regions ?? labels.regions,
  sectors: override?.sectors ?? labels.sectors,
  primary_themes: override?.primary_themes ?? labels.primary_themes,
  primary_assets: override?.primary_assets ?? labels.primary_assets,
  competing_catalysts: override?.competing_catalysts ?? labels.competing_catalysts,
  surprise_type:
    override?.surprise_type === undefined ? labels.surprise_type : override.surprise_type,
  case_quality: override?.case_quality ?? labels.case_quality,
  notes: override?.notes === undefined ? labels.notes : override.notes,
});

const addBlocker = (blockers: string[], text: string) => {
  if (!blockers.includes(text) && blockers.length < 12) {
    blockers.push(text);
  }
};

const addScore = (
  current: number,
  delta: number,
  strengths: string[],
  blockers: string[],
  options: {
    passText: string;
    failText?: string;
    condition: boolean;
  },
) => {
  if (options.condition) {
    addStrength(strengths, options.passText);
    return current + delta;
  }

  if (options.failText) {
    addBlocker(blockers, options.failText);
  }

  return current;
};

export const assessHistoricalCaseHighConfidenceCandidate = (
  item: HistoricalCaseLibraryItem,
): HistoricalHighConfidenceCandidate => {
  const strengths: string[] = [];
  const blockers: string[] = [];
  let score = 0;

  score = addScore(score, 0.08, strengths, blockers, {
    condition: item.labels.case_quality !== "draft",
    passText: "Case has already cleared draft review.",
    failText: "Case is still draft and has not passed review.",
  });
  score = addScore(score, 0.1, strengths, blockers, {
    condition: Boolean(item.review.reviewer),
    passText: "A reviewer is recorded on the case.",
    failText: "No reviewer is recorded yet.",
  });
  score = addScore(score, 0.16, strengths, blockers, {
    condition: hasUsefulText(item.review.review_notes, 60),
    passText: "Review notes document the adjudication in useful detail.",
    failText: "Review notes are too thin for high-confidence promotion.",
  });
  score = addScore(score, 0.06, strengths, blockers, {
    condition: hasMeaningfulArray(item.review.review_hints),
    passText: "Review hints capture operator checks for the case.",
  });
  score = addScore(score, 0.08, strengths, blockers, {
    condition: item.labels.label_source !== "inferred",
    passText: "Labels have manual or hybrid review support.",
    failText: "Labels are still inferred-only.",
  });
  score = addScore(score, 0.05, strengths, blockers, {
    condition: Boolean(item.labels.event_family),
    passText: "The event family is explicitly labeled.",
  });
  score = addScore(score, 0.05, strengths, blockers, {
    condition: hasMeaningfulArray(item.labels.primary_themes),
    passText: "Primary themes are explicitly captured.",
  });
  score = addScore(score, 0.06, strengths, blockers, {
    condition: hasMeaningfulArray(item.labels.primary_assets),
    passText: "Primary assets are documented.",
  });
  score = addScore(score, 0.12, strengths, blockers, {
    condition: hasMeaningfulArray(item.labels.competing_catalysts),
    passText: "Competing catalysts are documented.",
    failText: "Competing catalysts are not documented yet.",
  });
  score = addScore(score, 0.04, strengths, blockers, {
    condition: hasUsefulText(item.labels.notes, 24),
    passText: "Label notes add context to the case.",
  });
  score = addScore(score, 0.08, strengths, blockers, {
    condition: item.realized_moves.length >= 2,
    passText: "Multiple realized asset moves support the case outcome.",
    failText: "Only one realized move is attached to the case.",
  });
  score = addScore(score, 0.07, strengths, blockers, {
    condition: hasUsefulText(item.dominant_catalyst, 8),
    passText: "A dominant catalyst is clearly named.",
  });

  if (item.timing_alignment >= 0.8) {
    score += 0.15;
    addStrength(strengths, "Timing alignment is strong.");
  } else if (item.timing_alignment >= 0.7) {
    score += 0.1;
    addStrength(strengths, "Timing alignment is acceptable.");
  } else {
    addBlocker(blockers, "Timing alignment is too weak for high-confidence promotion.");
  }

  const roundedScore = round(Math.min(1, score));
  const criticalBlockers = blockers.filter((blocker) =>
    [
      "No reviewer is recorded yet.",
      "Review notes are too thin for high-confidence promotion.",
      "Labels are still inferred-only.",
      "Competing catalysts are not documented yet.",
      "Timing alignment is too weak for high-confidence promotion.",
      "Only one realized move is attached to the case.",
      "Case is still draft and has not passed review.",
    ].includes(blocker),
  );

  const recommendation =
    item.labels.case_quality === "high_confidence"
      ? "promote"
      : item.labels.case_quality === "draft"
        ? "needs_more_review"
        : roundedScore >= 0.75 && criticalBlockers.length === 0
          ? "promote"
          : roundedScore >= 0.58
            ? "watch"
            : "needs_more_review";

  return {
    case_id: item.case_id,
    case_pack: item.case_pack,
    title: item.source.title ?? item.case_id,
    current_quality: item.labels.case_quality,
    candidate_score: roundedScore,
    recommendation,
    strengths,
    blockers,
    reviewer: item.review.reviewer,
    reviewed_at: item.review.reviewed_at,
    label_source: item.labels.label_source,
    regimes: item.labels.regimes,
    primary_themes: item.labels.primary_themes,
    primary_assets: item.labels.primary_assets,
  };
};

const withPromotionOverrides = (
  item: HistoricalCaseLibraryItem,
  request: HistoricalHighConfidencePromotionRequest,
): HistoricalCaseLibraryItem => ({
  ...item,
  labels: mergeLabelOverrides(item.labels, request.labels),
  review: {
    ...item.review,
    reviewer: request.reviewer ?? item.review.reviewer,
    review_notes:
      request.review_notes === undefined ? item.review.review_notes : request.review_notes,
    review_hints: request.review_hints ?? item.review.review_hints,
  },
});

export const buildHistoricalHighConfidenceCandidateReport = async (
  repository: Repository,
  options: {
    limit?: number;
  } = {},
): Promise<HistoricalHighConfidenceCandidateReport> => {
  const scanLimit = Math.max(options.limit ?? 12, 200);
  const items = await repository.listHistoricalCaseLibraryItems({
    limit: scanLimit,
    case_qualities: ["reviewed", "high_confidence"],
  });
  const candidates = items
    .filter((item) => item.labels.case_quality === "reviewed")
    .map(assessHistoricalCaseHighConfidenceCandidate)
    .sort(sortCandidateScore);

  return historicalHighConfidenceCandidateReportSchema.parse({
    generated_at: new Date().toISOString(),
    total_reviewed_cases: items.filter((item) => item.labels.case_quality === "reviewed").length,
    eligible_candidate_count: candidates.length,
    promotable_count: candidates.filter((item) => item.recommendation === "promote").length,
    candidates: candidates.slice(0, options.limit ?? 12),
  });
};

export class HistoricalHighConfidencePromotionError extends Error {
  candidate: HistoricalHighConfidenceCandidate;

  constructor(message: string, candidate: HistoricalHighConfidenceCandidate) {
    super(message);
    this.name = "HistoricalHighConfidencePromotionError";
    this.candidate = candidate;
  }
}

export const promoteHistoricalCaseToHighConfidence = async (
  services: AppServices,
  caseId: string,
  request: HistoricalHighConfidencePromotionRequest,
) => {
  const existing = await services.repository.getHistoricalCaseLibraryItem(caseId);

  if (!existing) {
    throw new Error(`Historical library case not found: ${caseId}`);
  }

  if (existing.labels.case_quality === "draft") {
    throw new HistoricalHighConfidencePromotionError(
      "Draft cases must complete review before they can be promoted to high confidence.",
      assessHistoricalCaseHighConfidenceCandidate(existing),
    );
  }

  const candidate = assessHistoricalCaseHighConfidenceCandidate(
    withPromotionOverrides(existing, request),
  );

  if (
    existing.labels.case_quality !== "high_confidence" &&
    (candidate.recommendation !== "promote" ||
      candidate.candidate_score < request.min_candidate_score)
  ) {
    throw new HistoricalHighConfidencePromotionError(
      "The case does not yet meet the promotion threshold for high confidence.",
      candidate,
    );
  }

  const reviewResult = await reviewHistoricalCaseLibraryItem(services, caseId, {
    case_quality: "high_confidence",
    labels: request.labels,
    reviewer: request.reviewer ?? existing.review.reviewer ?? undefined,
    review_notes:
      request.review_notes === undefined ? existing.review.review_notes : request.review_notes,
    review_hints: request.review_hints ?? existing.review.review_hints,
    labeling_mode: request.labeling_mode,
    ingest_reviewed_memory: request.ingest_reviewed_memory,
    model_version: request.model_version,
  });

  return historicalHighConfidencePromotionResponseSchema.parse({
    ...reviewResult,
    candidate: assessHistoricalCaseHighConfidenceCandidate(reviewResult.item),
  });
};
