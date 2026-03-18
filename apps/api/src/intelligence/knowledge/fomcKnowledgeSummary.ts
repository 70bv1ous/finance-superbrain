import { randomUUID } from "node:crypto";

import type { Postmortem } from "@finance-superbrain/schemas";

import type { FomcMemoryCase } from "../memory/fomcMemoryCaseBuilder.js";
import type { FomcMemoryCaseStore } from "../memory/fomcMemoryCaseStore.js";
import { resolveThemeKeyForCase, buildFomcClusterId } from "../themes/fomcThemeClustering.js";
import { extractFomcLessons } from "./fomcLessonExtraction.js";
import type { FomcRecurringLesson } from "./fomcLessonExtraction.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type FailureTag = Postmortem["failure_tags"][number];

export type FomcKnowledgeType =
  | "reinforcement_pattern"
  | "failure_mode"
  | "confidence_bias";

export type FomcKnowledgeEntry = {
  id: string;
  knowledge_type: FomcKnowledgeType;
  summary: string;
  source_lesson_summaries: string[];
  evidence_count: number;
  cluster_ids: string[];
  first_seen: string;
  last_seen: string;
};

export type FomcKnowledgeBase = {
  generated_at: string;
  total_source_cases: number;
  entries: FomcKnowledgeEntry[];
  reinforcement_entries: FomcKnowledgeEntry[];
  failure_entries: FomcKnowledgeEntry[];
  bias_entries: FomcKnowledgeEntry[];
  coverage_note: string;
};

// ─── Failure tag descriptions ─────────────────────────────────────────────────

const FAILURE_TAG_DESCRIPTIONS: Record<FailureTag, string> = {
  wrong_direction:
    "Recurring direction error: asset direction calls inconsistent with FOMC surprise dynamics.",
  wrong_magnitude:
    "Recurring magnitude error: move size estimates poorly calibrated to actual market reaction.",
  wrong_timing:
    "Recurring timing error: prediction window misaligned with actual reaction onset.",
  overconfidence:
    "Systematic overconfidence: confidence levels too high relative to realized accuracy.",
  underconfidence:
    "Systematic underconfidence: confidence levels too low relative to how well the thesis performed.",
  insufficient_signal:
    "Insufficient signal: FOMC meeting characteristics too weak to anchor high-confidence directional theses.",
  weak_asset_mapping:
    "Weak asset mapping: selected assets absorb a limited share of the rate-driven market move.",
  mixed_signal_environment:
    "Mixed signal environment: conflicting macro regimes degrade the predictive value of rate surprise alone.",
  competing_catalyst:
    "Competing catalyst: concurrent market events override FOMC impact within the forecast window.",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const clusterIdForCase = (c: FomcMemoryCase): string =>
  buildFomcClusterId(resolveThemeKeyForCase(c));

const datesFromCases = (cases: FomcMemoryCase[]): { first: string; last: string } => {
  const sorted = cases.map((c) => c.created_at).sort();
  return { first: sorted[0] ?? "", last: sorted[sorted.length - 1] ?? "" };
};

const buildCoverageNote = (
  totalCases: number,
  reinforcementCount: number,
  failureCount: number,
  biasCount: number,
): string => {
  if (totalCases === 0) {
    return "No cases in store — knowledge base is empty.";
  }

  const total = reinforcementCount + failureCount + biasCount;

  if (total === 0) {
    return (
      `Knowledge base built from ${totalCases} case${totalCases === 1 ? "" : "s"} — ` +
      `insufficient repetition for any promotions (need ≥ 2 occurrences).`
    );
  }

  const parts: string[] = [];
  if (reinforcementCount > 0) parts.push(`${reinforcementCount} reinforcement pattern${reinforcementCount === 1 ? "" : "s"}`);
  if (failureCount > 0) parts.push(`${failureCount} failure mode${failureCount === 1 ? "" : "s"}`);
  if (biasCount > 0) parts.push(`${biasCount} confidence bias note${biasCount === 1 ? "" : "s"}`);

  return (
    `Knowledge base built from ${totalCases} case${totalCases === 1 ? "" : "s"}: ` +
    parts.join(", ") + "."
  );
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Consolidate all stored FOMC memory cases into a structured knowledge base.
 * Three-pass approach mirrors `buildCpiKnowledgeBase` exactly.
 */
export const buildFomcKnowledgeBase = async (
  store: FomcMemoryCaseStore,
): Promise<FomcKnowledgeBase> => {
  const extracted = await extractFomcLessons(store);
  const allCases = await store.list();
  const caseById = new Map(allCases.map((c) => [c.id, c]));

  const entries: FomcKnowledgeEntry[] = [];

  // ── Pass 1: Recurring lesson promotion ────────────────────────────────────

  for (const lesson of extracted.recurring_lessons) {
    const knowledge_type: FomcKnowledgeType =
      lesson.lesson_type === "reinforcement"
        ? "reinforcement_pattern"
        : "failure_mode";

    entries.push({
      id: randomUUID(),
      knowledge_type,
      summary: lesson.lesson_summary,
      source_lesson_summaries: [lesson.lesson_summary],
      evidence_count: lesson.occurrence_count,
      cluster_ids: lesson.cluster_ids,
      first_seen: lesson.first_seen,
      last_seen: lesson.last_seen,
    });
  }

  // ── Pass 2: Recurring failure tag promotion ────────────────────────────────

  const coveredLessonTexts = new Set(entries.flatMap((e) => e.source_lesson_summaries));
  const biasTagsHandledSeparately = new Set<FailureTag>(["overconfidence", "underconfidence"]);

  for (const tf of extracted.failure_tag_frequencies) {
    if (tf.case_count < 2) continue;
    if (biasTagsHandledSeparately.has(tf.tag)) continue;

    const description = FAILURE_TAG_DESCRIPTIONS[tf.tag];
    if (coveredLessonTexts.has(description)) continue;

    const contributingCases = tf.contributing_case_ids
      .map((id) => caseById.get(id))
      .filter((c): c is FomcMemoryCase => c !== undefined);

    const cluster_ids = [...new Set(contributingCases.map(clusterIdForCase))];
    const { first, last } = datesFromCases(contributingCases);

    entries.push({
      id: randomUUID(),
      knowledge_type: "failure_mode",
      summary: description,
      source_lesson_summaries: [],
      evidence_count: tf.case_count,
      cluster_ids,
      first_seen: first,
      last_seen: last,
    });
  }

  // ── Pass 3: Confidence bias promotion ─────────────────────────────────────

  const bias = extracted.confidence_bias;

  if (bias.overconfidence_cases >= 2 || bias.underconfidence_cases >= 2) {
    const biasSummary =
      bias.direction === "overconfident"
        ? `Systematic overconfidence across ${bias.overconfidence_cases} case${bias.overconfidence_cases === 1 ? "" : "s"}: confidence levels too high for realized accuracy. Cap confidence for similar setups until hit rate improves.`
        : bias.direction === "underconfident"
          ? `Systematic underconfidence across ${bias.underconfidence_cases} case${bias.underconfidence_cases === 1 ? "" : "s"}: confidence levels too conservative. Confidence floor may be suppressing valid signals.`
          : `Mixed confidence calibration: ${bias.overconfidence_cases} overconfident case${bias.overconfidence_cases === 1 ? "" : "s"}, ${bias.underconfidence_cases} underconfident case${bias.underconfidence_cases === 1 ? "" : "s"}. Review calibration across both directions.`;

    entries.push({
      id: randomUUID(),
      knowledge_type: "confidence_bias",
      summary: biasSummary,
      source_lesson_summaries: [],
      evidence_count: bias.overconfidence_cases + bias.underconfidence_cases,
      cluster_ids: [],
      first_seen: "",
      last_seen: "",
    });
  }

  // ── Partition and return ───────────────────────────────────────────────────

  const reinforcement_entries = entries.filter((e) => e.knowledge_type === "reinforcement_pattern");
  const failure_entries = entries.filter((e) => e.knowledge_type === "failure_mode");
  const bias_entries = entries.filter((e) => e.knowledge_type === "confidence_bias");

  return {
    generated_at: new Date().toISOString(),
    total_source_cases: extracted.total_cases_analyzed,
    entries,
    reinforcement_entries,
    failure_entries,
    bias_entries,
    coverage_note: buildCoverageNote(
      extracted.total_cases_analyzed,
      reinforcement_entries.length,
      failure_entries.length,
      bias_entries.length,
    ),
  };
};
