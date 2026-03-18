import { randomUUID } from "node:crypto";

import type { Postmortem } from "@finance-superbrain/schemas";

import type { CpiMemoryCase } from "../memory/memoryCaseBuilder.js";
import type { CpiMemoryCaseStore } from "../memory/cpiMemoryCaseStore.js";
import { resolveThemeKeyForCase, buildCpiClusterId } from "../themes/cpiThemeClustering.js";
import {
  extractCpiLessons,
} from "./cpiLessonExtraction.js";
import type { CpiRecurringLesson, CpiExtractedLessons } from "./cpiLessonExtraction.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type FailureTag = Postmortem["failure_tags"][number];

export type CpiKnowledgeType =
  | "reinforcement_pattern"
  | "failure_mode"
  | "confidence_bias";

/**
 * A promoted, reusable knowledge artifact derived from multiple CPI memory
 * cases.
 *
 * A `CpiKnowledgeEntry` is not an isolated case observation — it represents a
 * pattern that has been observed enough times to warrant structural treatment.
 * It is suitable for:
 *   - Explaining why a live prediction is cautious or reinforced
 *   - Feeding back into reliability enrichment as a domain prior
 *   - Surfacing in dashboards as an "intelligence insight"
 */
export type CpiKnowledgeEntry = {
  id: string;
  knowledge_type: CpiKnowledgeType;
  /**
   * Concise, reusable statement of the knowledge.
   *
   * For reinforcement patterns: actionable confirmation ("Reinforce this setup…")
   * For failure modes: structural caution ("Recurring direction error…")
   * For confidence bias: calibration directive ("Cap confidence for similar setups…")
   */
  summary: string;
  /** The raw lesson_summary texts from contributing cases */
  source_lesson_summaries: string[];
  /** Number of distinct cases that provide evidence for this entry */
  evidence_count: number;
  /** Macro-theme cluster IDs the contributing cases belong to */
  cluster_ids: string[];
  /** ISO datetime of the earliest contributing case */
  first_seen: string;
  /** ISO datetime of the most recent contributing case */
  last_seen: string;
};

/**
 * The full knowledge consolidation artifact built from all stored CPI memory
 * cases.
 *
 * Entries are partitioned by type for easy downstream consumption:
 *   - `reinforcement_entries`: patterns the system should actively replicate
 *   - `failure_entries`: patterns the system should treat with caution
 *   - `bias_entries`: calibration directives for the confidence layer
 *
 * The `coverage_note` provides a one-line human-readable summary suitable for
 * logging and dashboards.
 */
export type CpiKnowledgeBase = {
  generated_at: string;
  total_source_cases: number;
  entries: CpiKnowledgeEntry[];
  reinforcement_entries: CpiKnowledgeEntry[];
  failure_entries: CpiKnowledgeEntry[];
  bias_entries: CpiKnowledgeEntry[];
  coverage_note: string;
};

// ─── Failure tag descriptions ─────────────────────────────────────────────────

/**
 * Human-readable structural descriptions for each failure tag.
 *
 * These are used for tag-based knowledge entries (when a tag recurs across
 * multiple cases but may not be surfaced by the lesson text, because a
 * higher-priority tag "won" in `buildLessonSummary`).
 */
const FAILURE_TAG_DESCRIPTIONS: Record<FailureTag, string> = {
  wrong_direction:
    "Recurring direction error: asset direction calls inconsistent with CPI surprise dynamics.",
  wrong_magnitude:
    "Recurring magnitude error: move size estimates poorly calibrated to actual market reaction.",
  wrong_timing:
    "Recurring timing error: prediction window misaligned with actual reaction onset.",
  overconfidence:
    "Systematic overconfidence: confidence levels too high relative to realized accuracy.",
  underconfidence:
    "Systematic underconfidence: confidence levels too low relative to how well the thesis performed.",
  insufficient_signal:
    "Insufficient signal: CPI event characteristics too weak to anchor high-confidence directional theses.",
  weak_asset_mapping:
    "Weak asset mapping: selected assets absorb a limited share of the CPI-driven market move.",
  mixed_signal_environment:
    "Mixed signal environment: conflicting macro regimes degrade the predictive value of CPI surprise alone.",
  competing_catalyst:
    "Competing catalyst: concurrent market events override CPI impact within the forecast window.",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const clusterIdForCase = (c: CpiMemoryCase): string =>
  buildCpiClusterId(resolveThemeKeyForCase(c));

const datesFromCases = (cases: CpiMemoryCase[]): { first: string; last: string } => {
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
  if (reinforcementCount > 0) {
    parts.push(
      `${reinforcementCount} reinforcement pattern${reinforcementCount === 1 ? "" : "s"}`,
    );
  }
  if (failureCount > 0) {
    parts.push(`${failureCount} failure mode${failureCount === 1 ? "" : "s"}`);
  }
  if (biasCount > 0) {
    parts.push(`${biasCount} confidence bias note${biasCount === 1 ? "" : "s"}`);
  }

  return (
    `Knowledge base built from ${totalCases} case${totalCases === 1 ? "" : "s"}: ` +
    parts.join(", ") +
    "."
  );
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Consolidate all stored CPI memory cases into a structured knowledge base.
 *
 * This is the top-level Phase 5F function.  It operates in three passes:
 *
 * **Pass 1 — Recurring lesson promotion**
 * Every Lesson.lesson_summary text that appears in ≥ 2 distinct cases is
 * promoted into a `CpiKnowledgeEntry`:
 *   - If the lesson came from correct-verdict cases → `reinforcement_pattern`
 *   - If from wrong/partial-verdict cases → `failure_mode`
 *   - If from both → `failure_mode` (cautious default for mixed signals)
 *
 * **Pass 2 — Recurring failure tag promotion**
 * Postmortem failure tags that appear in ≥ 2 distinct wrong/partial cases are
 * promoted into `failure_mode` entries with structural descriptions.
 * Confidence tags (`overconfidence` / `underconfidence`) are excluded here —
 * they are handled in Pass 3.
 * Tags already fully represented by a recurring lesson entry are de-duplicated.
 *
 * **Pass 3 — Confidence bias promotion**
 * If ≥ 2 cases carry `overconfidence` or `underconfidence` tags, a
 * `confidence_bias` entry is promoted describing the calibration tendency.
 *
 * This function does **not** require a benchmark replay — it runs in O(n)
 * on the number of stored cases.
 *
 * @example
 * ```ts
 * const store = new CpiMemoryCaseStore();
 * // ... populate store with memory cases ...
 * const kb = await buildCpiKnowledgeBase(store);
 *
 * console.log(kb.coverage_note);
 * // → "Knowledge base built from 8 cases: 1 reinforcement pattern, 2 failure modes."
 *
 * for (const entry of kb.failure_entries) {
 *   console.log(`[${entry.knowledge_type}] ${entry.summary} (${entry.evidence_count} cases)`);
 * }
 * ```
 */
export const buildCpiKnowledgeBase = async (
  store: CpiMemoryCaseStore,
): Promise<CpiKnowledgeBase> => {
  const extracted = await extractCpiLessons(store);
  const allCases = await store.list();
  const caseById = new Map(allCases.map((c) => [c.id, c]));

  const entries: CpiKnowledgeEntry[] = [];

  // ── Pass 1: Recurring lesson promotion ────────────────────────────────────

  for (const lesson of extracted.recurring_lessons) {
    // Mixed lesson_type (appeared in both correct and wrong cases) → failure_mode
    // because the lesson cannot be safely used as a reinforcement signal.
    const knowledge_type: CpiKnowledgeType =
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

  // Track which lesson summaries are already represented to avoid redundancy.
  // A tag is considered "already covered" if a lesson-based entry exists whose
  // source_lesson_summaries contain the expected lesson text for that tag.
  const coveredLessonTexts = new Set(entries.flatMap((e) => e.source_lesson_summaries));

  // Tags handled in Pass 3 — skip here.
  const biasTagsHandledSeparately = new Set<FailureTag>([
    "overconfidence",
    "underconfidence",
  ]);

  for (const tf of extracted.failure_tag_frequencies) {
    if (tf.case_count < 2) continue;
    if (biasTagsHandledSeparately.has(tf.tag)) continue;

    const description = FAILURE_TAG_DESCRIPTIONS[tf.tag];

    // Skip if the same structural insight is already covered by a promoted
    // lesson entry.  This prevents duplicate signals for the same root cause
    // when the lesson text already encodes the fix.
    if (coveredLessonTexts.has(description)) continue;

    // Resolve cluster context from contributing cases
    const contributingCases = tf.contributing_case_ids
      .map((id) => caseById.get(id))
      .filter((c): c is CpiMemoryCase => c !== undefined);

    const cluster_ids = [
      ...new Set(contributingCases.map(clusterIdForCase)),
    ];

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

  const reinforcement_entries = entries.filter(
    (e) => e.knowledge_type === "reinforcement_pattern",
  );
  const failure_entries = entries.filter(
    (e) => e.knowledge_type === "failure_mode",
  );
  const bias_entries = entries.filter(
    (e) => e.knowledge_type === "confidence_bias",
  );

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
