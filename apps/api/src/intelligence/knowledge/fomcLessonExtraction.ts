import type { Postmortem } from "@finance-superbrain/schemas";

import type { FomcMemoryCase } from "../memory/fomcMemoryCaseBuilder.js";
import type { FomcMemoryCaseStore } from "../memory/fomcMemoryCaseStore.js";
import { resolveThemeKeyForCase, buildFomcClusterId } from "../themes/fomcThemeClustering.js";

// ─── Types ────────────────────────────────────────────────────────────────────

type FailureTag = Postmortem["failure_tags"][number];

export type FomcRecurringLesson = {
  lesson_summary: string;
  occurrence_count: number;
  case_ids: string[];
  cluster_ids: string[];
  lesson_type: "reinforcement" | "mistake" | "mixed";
  first_seen: string;
  last_seen: string;
};

export type FomcFailureTagFrequency = {
  tag: FailureTag;
  case_count: number;
  occurrence_count: number;
  frequency_rate: number;
  contributing_case_ids: string[];
};

export type FomcConfidenceBias = {
  direction: "overconfident" | "underconfident" | "balanced";
  overconfidence_cases: number;
  underconfidence_cases: number;
  total_cases_analyzed: number;
  bias_rate: number;
};

export type FomcExtractedLessons = {
  total_cases_analyzed: number;
  recurring_lessons: FomcRecurringLesson[];
  failure_tag_frequencies: FomcFailureTagFrequency[];
  confidence_bias: FomcConfidenceBias;
  reinforcement_summaries: string[];
  mistake_summaries: string[];
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const round4 = (v: number) => Number(v.toFixed(4));

const clusterIdForCase = (c: FomcMemoryCase): string =>
  buildFomcClusterId(resolveThemeKeyForCase(c));

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract recurring lesson patterns and failure signals from an FOMC memory
 * case store.  Mirrors `extractCpiLessons` exactly.
 */
export const extractFomcLessons = async (
  store: FomcMemoryCaseStore,
): Promise<FomcExtractedLessons> => {
  const allCases = await store.list();

  const empty: FomcExtractedLessons = {
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

  const recurringLessons: FomcRecurringLesson[] = [];

  for (const [summary, acc] of lessonMap) {
    if (acc.caseIds.size < 2) continue;

    const types = acc.lessonTypes;
    const lesson_type: FomcRecurringLesson["lesson_type"] =
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
  const failureTagFrequencies: FomcFailureTagFrequency[] = [];

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
  const biasRate = allCases.length > 0 ? round4(biasedCases / allCases.length) : 0;

  const biasDirection: FomcConfidenceBias["direction"] =
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
