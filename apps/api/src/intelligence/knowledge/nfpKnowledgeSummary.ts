import { randomUUID } from "node:crypto";

import type { Postmortem } from "@finance-superbrain/schemas";

import type { NfpMemoryCase } from "../memory/nfpMemoryCaseBuilder.js";
import type { NfpMemoryCaseStore } from "../memory/nfpMemoryCaseStore.js";
import { resolveThemeKeyForCase, buildNfpClusterId } from "../themes/nfpThemeClustering.js";
import { extractNfpLessons } from "./nfpLessonExtraction.js";
import type { NfpRecurringLesson } from "./nfpLessonExtraction.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type FailureTag = Postmortem["failure_tags"][number];

export type NfpKnowledgeType =
  | "reinforcement_pattern"
  | "failure_mode"
  | "confidence_bias";

export type NfpKnowledgeEntry = {
  id: string;
  knowledge_type: NfpKnowledgeType;
  summary: string;
  source_lesson_summaries: string[];
  evidence_count: number;
  cluster_ids: string[];
  first_seen: string;
  last_seen: string;
};

export type NfpKnowledgeBase = {
  generated_at: string;
  total_source_cases: number;
  entries: NfpKnowledgeEntry[];
  reinforcement_entries: NfpKnowledgeEntry[];
  failure_entries: NfpKnowledgeEntry[];
  bias_entries: NfpKnowledgeEntry[];
  coverage_note: string;
};

// ─── Failure tag descriptions ─────────────────────────────────────────────────

const FAILURE_TAG_DESCRIPTIONS: Record<FailureTag, string> = {
  wrong_direction:
    "Recurring direction error: asset direction calls inconsistent with NFP surprise dynamics.",
  wrong_magnitude:
    "Recurring magnitude error: move size estimates poorly calibrated to actual employment-driven reaction.",
  wrong_timing:
    "Recurring timing error: prediction window misaligned with actual post-NFP reaction onset.",
  overconfidence:
    "Systematic overconfidence: confidence levels too high relative to realized accuracy on employment data.",
  underconfidence:
    "Systematic underconfidence: confidence levels too low relative to how well the employment thesis performed.",
  insufficient_signal:
    "Insufficient signal: NFP release characteristics too ambiguous to anchor high-confidence directional theses.",
  weak_asset_mapping:
    "Weak asset mapping: selected assets absorb a limited share of the employment-driven market move.",
  mixed_signal_environment:
    "Mixed signal environment: conflicting payrolls sub-components (jobs vs unemployment vs earnings) degrade headline signal reliability.",
  competing_catalyst:
    "Competing catalyst: concurrent market events override NFP impact within the forecast window.",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const clusterIdForCase = (c: NfpMemoryCase): string =>
  buildNfpClusterId(resolveThemeKeyForCase(c));

const datesFromCases = (cases: NfpMemoryCase[]): { first: string; last: string } => {
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
 * Consolidate all stored NFP memory cases into a structured knowledge base.
 * Three-pass approach mirrors `buildFomcKnowledgeBase` exactly.
 */
export const buildNfpKnowledgeBase = async (
  store: NfpMemoryCaseStore,
): Promise<NfpKnowledgeBase> => {
  const extracted = await extractNfpLessons(store);
  const allCases = await store.list();
  const caseById = new Map(allCases.map((c) => [c.id, c]));

  const entries: NfpKnowledgeEntry[] = [];

  // ── Pass 1: Recurring lesson promotion ────────────────────────────────────

  for (const lesson of extracted.recurring_lessons) {
    const knowledge_type: NfpKnowledgeType =
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
      .filter((c): c is NfpMemoryCase => c !== undefined);

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
