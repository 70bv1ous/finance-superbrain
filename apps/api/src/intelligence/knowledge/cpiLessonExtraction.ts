import type { Postmortem } from "@finance-superbrain/schemas";

import type { CpiMemoryCase } from "../memory/memoryCaseBuilder.js";
import type { CpiMemoryCaseStore } from "../memory/cpiMemoryCaseStore.js";
import { resolveThemeKeyForCase, buildCpiClusterId } from "../themes/cpiThemeClustering.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type FailureTag = Postmortem["failure_tags"][number];

/**
 * A lesson summary text that appeared in two or more distinct CPI memory cases.
 *
 * When a lesson repeats across cases it transitions from an isolated observation
 * into a structural pattern worth promoting into reusable knowledge.
 */
export type CpiRecurringLesson = {
  /** The repeated lesson text (from Lesson.lesson_summary) */
  lesson_summary: string;
  /** How many distinct cases contributed this lesson */
  occurrence_count: number;
  /** IDs of contributing cases */
  case_ids: string[];
  /**
   * Macro-theme clusters the contributing cases belong to.
   * Deduplicated — one cluster may appear across many contributing cases.
   */
  cluster_ids: string[];
  /**
   * Whether the lesson originated from successful predictions, failed ones,
   * or a mixture of both.
   */
  lesson_type: "reinforcement" | "mistake" | "mixed";
  /** ISO datetime of the earliest contributing case (chronological anchor) */
  first_seen: string;
  /** ISO datetime of the most recent contributing case */
  last_seen: string;
};

/**
 * How frequently a specific failure tag appears across all wrong and
 * partially-correct cases.
 *
 * Note: `case_count` counts unique cases (a case is counted once per tag,
 * regardless of how many of its postmortems carry that tag). This avoids
 * inflation from multi-asset predictions.
 */
export type CpiFailureTagFrequency = {
  tag: FailureTag;
  /** Unique cases where at least one postmortem carried this tag */
  case_count: number;
  /** Raw occurrence count across all postmortems (may exceed case_count) */
  occurrence_count: number;
  /**
   * case_count ÷ total wrong+partial cases.
   * Higher → this failure mode is a dominant structural weakness.
   */
  frequency_rate: number;
  /** IDs of contributing cases (for downstream traceability) */
  contributing_case_ids: string[];
};

/**
 * Whether the system shows a systematic tendency to over- or under-state
 * confidence in its CPI predictions.
 *
 * Overconfidence: prediction confidence ≥ 0.65 but calibration_score < 0.60.
 * Underconfidence: prediction confidence < 0.65 but calibration_score < 0.60
 *   (from `createPostmortem` logic: the tag is set based on which side of the
 *   confidence threshold the prediction lands on when the outcome is weak).
 */
export type CpiConfidenceBias = {
  direction: "overconfident" | "underconfident" | "balanced";
  overconfidence_cases: number;
  underconfidence_cases: number;
  total_cases_analyzed: number;
  /**
   * (overconfidence_cases + underconfidence_cases) ÷ total_cases_analyzed.
   * Higher → more of the prediction history carries calibration issues.
   */
  bias_rate: number;
};

/**
 * Full extraction output from a CPI memory case store.
 *
 * This is the raw analysis artifact.  The knowledge summary layer
 * (`cpiKnowledgeSummary.ts`) promotes entries from this structure into
 * structured reusable knowledge.
 */
export type CpiExtractedLessons = {
  total_cases_analyzed: number;
  /** Lessons seen in ≥ 2 distinct cases, sorted by occurrence_count descending */
  recurring_lessons: CpiRecurringLesson[];
  /**
   * Failure tag frequencies from wrong and partially_correct postmortems.
   * Sorted by case_count descending.
   */
  failure_tag_frequencies: CpiFailureTagFrequency[];
  confidence_bias: CpiConfidenceBias;
  /**
   * All distinct lesson summaries from correct cases (reinforcement lessons),
   * deduplicated by text.
   */
  reinforcement_summaries: string[];
  /**
   * All distinct lesson summaries from wrong / partially-correct cases
   * (mistake lessons), deduplicated by text.
   */
  mistake_summaries: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const round4 = (v: number) => Number(v.toFixed(4));

const clusterIdForCase = (c: CpiMemoryCase): string =>
  buildCpiClusterId(resolveThemeKeyForCase(c));

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract recurring lesson patterns and failure signals from a CPI memory
 * case store.
 *
 * Three orthogonal analysis dimensions:
 *
 *   1. **Lesson text frequency** — groups all per-lesson `lesson_summary`
 *      strings across every case and identifies texts that recur in ≥ 2
 *      distinct cases.  Recurring texts represent structural patterns that
 *      have been observed more than once.
 *
 *   2. **Failure tag frequency** — scans postmortems from wrong and
 *      partially-correct cases and counts how often each structural failure
 *      tag (wrong_direction, overconfidence, etc.) appears across unique
 *      cases.  This surface failure patterns that may be hidden behind
 *      higher-priority lesson texts.
 *
 *   3. **Confidence bias** — counts cases where postmortems carry the
 *      "overconfidence" or "underconfidence" failure tag, revealing systematic
 *      calibration tendencies across the full prediction history.
 *
 * This function does **not** require a benchmark replay — it works entirely
 * from stored memory cases and runs in O(n) time on the case count.
 */
export const extractCpiLessons = async (
  store: CpiMemoryCaseStore,
): Promise<CpiExtractedLessons> => {
  const allCases = await store.list();

  const empty: CpiExtractedLessons = {
    total_cases_analyzed: 0,
    recurring_lessons: [],
    failure_tag_frequencies: [],
    confidence_bias: {
      direction: "balanced",
      overconfidence_cases: 0,
      underconfidence_cases: 0,
      total_cases_analyzed: 0,
      bias_rate: 0,
    },
    reinforcement_summaries: [],
    mistake_summaries: [],
  };

  if (allCases.length === 0) return empty;

  // ── 1. Lesson text frequency ───────────────────────────────────────────────

  type LessonAcc = {
    caseIds: Set<string>;
    lessonTypes: Set<"reinforcement" | "mistake">;
    clusterIds: Set<string>;
    dates: string[];
  };

  const lessonMap = new Map<string, LessonAcc>();
  const reinforcementSummaries = new Set<string>();
  const mistakeSummaries = new Set<string>();

  for (const c of allCases) {
    const clusterId = clusterIdForCase(c);

    for (const lesson of c.lessons) {
      const key = lesson.lesson_summary.trim();
      if (!key) continue;

      if (!lessonMap.has(key)) {
        lessonMap.set(key, {
          caseIds: new Set(),
          lessonTypes: new Set(),
          clusterIds: new Set(),
          dates: [],
        });
      }

      const acc = lessonMap.get(key)!;

      // Count each case once per lesson text
      if (!acc.caseIds.has(c.id)) {
        acc.caseIds.add(c.id);
        acc.clusterIds.add(clusterId);
        acc.dates.push(c.created_at);
      }

      acc.lessonTypes.add(lesson.lesson_type);

      if (lesson.lesson_type === "reinforcement") {
        reinforcementSummaries.add(key);
      } else {
        mistakeSummaries.add(key);
      }
    }
  }

  const recurringLessons: CpiRecurringLesson[] = [];

  for (const [summary, acc] of lessonMap) {
    if (acc.caseIds.size < 2) continue;

    const types = acc.lessonTypes;
    const lesson_type: CpiRecurringLesson["lesson_type"] =
      types.has("reinforcement") && types.has("mistake")
        ? "mixed"
        : types.has("reinforcement")
          ? "reinforcement"
          : "mistake";

    const sortedDates = [...acc.dates].sort();

    recurringLessons.push({
      lesson_summary: summary,
      occurrence_count: acc.caseIds.size,
      case_ids: [...acc.caseIds],
      cluster_ids: [...acc.clusterIds],
      lesson_type,
      first_seen: sortedDates[0]!,
      last_seen: sortedDates[sortedDates.length - 1]!,
    });
  }

  recurringLessons.sort((a, b) => b.occurrence_count - a.occurrence_count);

  // ── 2. Failure tag frequency ───────────────────────────────────────────────

  const wrongOrPartial = allCases.filter(
    (c) => c.verdict === "wrong" || c.verdict === "partially_correct",
  );

  type TagAcc = { caseIds: Set<string>; occurrences: number };
  const tagMap = new Map<FailureTag, TagAcc>();

  for (const c of wrongOrPartial) {
    const seenForCase = new Set<FailureTag>();

    for (const pm of c.postmortems) {
      for (const tag of pm.failure_tags) {
        if (!tagMap.has(tag)) {
          tagMap.set(tag, { caseIds: new Set(), occurrences: 0 });
        }
        tagMap.get(tag)!.occurrences++;
        seenForCase.add(tag);
      }
    }

    for (const tag of seenForCase) {
      tagMap.get(tag)!.caseIds.add(c.id);
    }
  }

  const totalWrongOrPartial = wrongOrPartial.length;
  const failureTagFrequencies: CpiFailureTagFrequency[] = [];

  for (const [tag, acc] of tagMap) {
    failureTagFrequencies.push({
      tag,
      case_count: acc.caseIds.size,
      occurrence_count: acc.occurrences,
      frequency_rate:
        totalWrongOrPartial > 0
          ? round4(acc.caseIds.size / totalWrongOrPartial)
          : 0,
      contributing_case_ids: [...acc.caseIds],
    });
  }

  failureTagFrequencies.sort((a, b) => b.case_count - a.case_count);

  // ── 3. Confidence bias ─────────────────────────────────────────────────────

  let overconfidenceCases = 0;
  let underconfidenceCases = 0;

  for (const c of allCases) {
    const hasOver = c.postmortems.some((pm) =>
      pm.failure_tags.includes("overconfidence"),
    );
    const hasUnder = c.postmortems.some((pm) =>
      pm.failure_tags.includes("underconfidence"),
    );

    if (hasOver) overconfidenceCases++;
    if (hasUnder) underconfidenceCases++;
  }

  const biasedCases = overconfidenceCases + underconfidenceCases;
  const biasRate =
    allCases.length > 0 ? round4(biasedCases / allCases.length) : 0;

  const biasDirection: CpiConfidenceBias["direction"] =
    overconfidenceCases > underconfidenceCases
      ? "overconfident"
      : underconfidenceCases > overconfidenceCases
        ? "underconfident"
        : "balanced";

  return {
    total_cases_analyzed: allCases.length,
    recurring_lessons: recurringLessons,
    failure_tag_frequencies: failureTagFrequencies,
    confidence_bias: {
      direction: biasDirection,
      overconfidence_cases: overconfidenceCases,
      underconfidence_cases: underconfidenceCases,
      total_cases_analyzed: allCases.length,
      bias_rate: biasRate,
    },
    reinforcement_summaries: [...reinforcementSummaries],
    mistake_summaries: [...mistakeSummaries],
  };
};
