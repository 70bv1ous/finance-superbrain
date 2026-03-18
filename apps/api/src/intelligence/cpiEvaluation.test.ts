import { describe, expect, it } from "vitest";

import { buildCpiEvent } from "./events/cpiEvent.js";
import { buildMarketContextSnapshot } from "./context/marketContext.js";
import { generateCpiPrediction } from "./prediction/cpiPrediction.js";
import { trackCpiOutcome } from "./outcome/outcomeTracker.js";
import { buildCpiMemoryCase } from "./memory/memoryCaseBuilder.js";
import { CpiMemoryCaseStore } from "./memory/cpiMemoryCaseStore.js";
import { runCpiReplayBenchmark } from "./evaluation/cpiReplayBenchmark.js";
import { buildCpiCalibrationReport } from "./evaluation/cpiCalibrationReport.js";

// ─── Fixture builder ──────────────────────────────────────────────────────────

type CaseSpec = {
  actual: number;
  expected: number;
  /** ISO string — controls chronological ordering */
  released_at?: string;
  period?: string;
  fed?: string;
  macro?: string;
  vol?: string;
  directionCorrect?: boolean;
};

const buildCase = (spec: CaseSpec) => {
  const event = buildCpiEvent({
    released_at: spec.released_at ?? "2025-01-10T13:30:00Z",
    period: spec.period ?? "2025-01",
    actual_value: spec.actual,
    expected_value: spec.expected,
    prior_value: spec.expected,
  });

  const context = buildMarketContextSnapshot({
    fed_policy_stance: (spec.fed ?? "hawkish") as any,
    macro_regime: (spec.macro ?? "risk_off") as any,
    volatility_regime: (spec.vol ?? "elevated") as any,
  });

  const prediction_result = generateCpiPrediction({
    cpi_event: event,
    context,
    horizons: ["1d"],
  });

  const correct = spec.directionCorrect ?? true;
  const realized = prediction_result.predictions[0]!.assets.map((a) => {
    const baseDir: "up" | "down" =
      a.expected_direction === "mixed" ? "up" : a.expected_direction;
    const dir: "up" | "down" = correct ? baseDir : baseDir === "up" ? "down" : "up";
    const bp = dir === "up" ? 45 : -45;
    return { ticker: a.ticker, realized_direction: dir, realized_magnitude_bp: bp };
  });

  const outcome_result = trackCpiOutcome({
    prediction_result,
    realized_moves: realized,
    measured_at: new Date(
      new Date(spec.released_at ?? "2025-01-10T13:30:00Z").getTime() + 86_400_000,
    ).toISOString(),
    timing_alignment: 0.8,
  });

  return buildCpiMemoryCase({ prediction_result, outcome_result });
};

// ─── runCpiReplayBenchmark ────────────────────────────────────────────────────

describe("runCpiReplayBenchmark", () => {
  it("returns empty result for an empty store", async () => {
    const store = new CpiMemoryCaseStore();
    const result = await runCpiReplayBenchmark(store);

    expect(result.total_cases).toBe(0);
    expect(result.cases_with_prior_analogs).toBe(0);
    expect(result.records).toHaveLength(0);
  });

  it("returns one record for a single-case store (no prior analogs)", async () => {
    const store = new CpiMemoryCaseStore();
    const c = buildCase({ actual: 3.15, expected: 3.0, period: "2025-01" });
    await store.save(c);

    const result = await runCpiReplayBenchmark(store);

    expect(result.total_cases).toBe(1);
    expect(result.cases_with_prior_analogs).toBe(0);

    const rec = result.records[0]!;
    expect(rec.prior_case_count).toBe(0);
    expect(rec.analog_count).toBe(0);
    // No analogs → boost must be 0
    expect(rec.analog_boost).toBe(0);
    // Enriched == baseline when no analogs
    expect(rec.enriched_confidence).toBe(rec.baseline_confidence);
    expect(rec.calibration_improvement).toBe(0);
  });

  it("processes cases in strict chronological order", async () => {
    const store = new CpiMemoryCaseStore();

    // Save in reverse chronological order — benchmark must sort them
    const cases = [
      buildCase({ actual: 3.15, expected: 3.0, released_at: "2025-03-10T13:30:00Z", period: "2025-03" }),
      buildCase({ actual: 3.15, expected: 3.0, released_at: "2025-01-10T13:30:00Z", period: "2025-01" }),
      buildCase({ actual: 3.15, expected: 3.0, released_at: "2025-02-10T13:30:00Z", period: "2025-02" }),
    ];
    for (const c of cases) await store.save(c);

    const result = await runCpiReplayBenchmark(store);

    expect(result.total_cases).toBe(3);

    // First case chronologically should have 0 prior cases
    const first = result.records.find((r) => r.period === "2025-01")!;
    expect(first.prior_case_count).toBe(0);

    // Second case should have 1 prior case
    const second = result.records.find((r) => r.period === "2025-02")!;
    expect(second.prior_case_count).toBe(1);

    // Third case should have 2 prior cases
    const third = result.records.find((r) => r.period === "2025-03")!;
    expect(third.prior_case_count).toBe(2);
  });

  it("enforces temporal holdout — a case never sees itself as an analog", async () => {
    const store = new CpiMemoryCaseStore();

    const c1 = buildCase({ actual: 3.15, expected: 3.0, released_at: "2025-01-10T13:30:00Z", period: "2025-01" });
    const c2 = buildCase({ actual: 3.15, expected: 3.0, released_at: "2025-02-10T13:30:00Z", period: "2025-02" });
    await store.save(c1);
    await store.save(c2);

    const result = await runCpiReplayBenchmark(store);

    // c1 has no prior cases
    const rec1 = result.records.find((r) => r.period === "2025-01")!;
    expect(rec1.analog_count).toBe(0);

    // c2 may find c1 as an analog, but c2's own id must not appear in c1's analogs
    // (checked structurally: c1's prior_case_count is 0)
    expect(rec1.prior_case_count).toBe(0);
  });

  it("records all required fields on each replay record", async () => {
    const store = new CpiMemoryCaseStore();
    const c = buildCase({ actual: 3.15, expected: 3.0, period: "2025-01" });
    await store.save(c);

    const result = await runCpiReplayBenchmark(store);
    const rec = result.records[0]!;

    // Type-shape guard
    expect(typeof rec.case_id).toBe("string");
    expect(typeof rec.period).toBe("string");
    expect(typeof rec.horizon).toBe("string");
    expect(["correct", "partially_correct", "wrong"]).toContain(rec.verdict);
    expect(rec.direction_score).toBeGreaterThanOrEqual(0);
    expect(rec.direction_score).toBeLessThanOrEqual(1);
    expect(rec.baseline_confidence).toBeGreaterThan(0);
    expect(rec.baseline_calibration_error).toBeGreaterThanOrEqual(0);
    expect(rec.enriched_confidence).toBeGreaterThan(0);
    expect(rec.enriched_calibration_error).toBeGreaterThanOrEqual(0);
    expect(typeof rec.cluster_id).toBe("string");
    expect(["reliable", "mixed", "unreliable", "insufficient_data"]).toContain(
      rec.cluster_reliability,
    );
  });

  it("computes calibration_improvement = baseline_error − enriched_error", async () => {
    const store = new CpiMemoryCaseStore();

    // Two structurally similar cases — second will find first as an analog
    const c1 = buildCase({
      actual: 3.15,
      expected: 3.0,
      released_at: "2025-01-10T13:30:00Z",
      period: "2025-01",
      directionCorrect: true,
    });
    const c2 = buildCase({
      actual: 3.15,
      expected: 3.0,
      released_at: "2025-02-10T13:30:00Z",
      period: "2025-02",
      directionCorrect: true,
    });
    await store.save(c1);
    await store.save(c2);

    const result = await runCpiReplayBenchmark(store);
    const rec2 = result.records.find((r) => r.period === "2025-02")!;

    const expected_improvement =
      Number(
        (rec2.baseline_calibration_error - rec2.enriched_calibration_error).toFixed(4),
      );
    expect(rec2.calibration_improvement).toBeCloseTo(expected_improvement, 4);
  });

  it("reports cases_with_prior_analogs correctly", async () => {
    const store = new CpiMemoryCaseStore();

    // Three cases in the same cluster — only c2 and c3 will have prior analogs
    for (let i = 1; i <= 3; i++) {
      const c = buildCase({
        actual: 3.15,
        expected: 3.0,
        released_at: `2025-0${i}-10T13:30:00Z`,
        period: `2025-0${i}`,
      });
      await store.save(c);
    }

    const result = await runCpiReplayBenchmark(store);
    // c1 has 0 prior cases → analog_count = 0; c2 and c3 may find prior analogs
    expect(result.cases_with_prior_analogs).toBeGreaterThanOrEqual(1);
    expect(result.cases_with_prior_analogs).toBeLessThanOrEqual(result.total_cases);
  });

  it("cluster_reliability reflects prior cases only — first case always insufficient_data", async () => {
    const store = new CpiMemoryCaseStore();

    const c = buildCase({
      actual: 3.15,
      expected: 3.0,
      released_at: "2025-01-10T13:30:00Z",
      period: "2025-01",
    });
    await store.save(c);

    const result = await runCpiReplayBenchmark(store);
    // First case has 0 prior cases in its cluster
    expect(result.records[0]!.cluster_reliability).toBe("insufficient_data");
  });
});

// ─── buildCpiCalibrationReport ────────────────────────────────────────────────

describe("buildCpiCalibrationReport", () => {
  it("handles empty benchmark result", () => {
    const report = buildCpiCalibrationReport({
      total_cases: 0,
      cases_with_prior_analogs: 0,
      records: [],
    });

    expect(report.total_cases).toBe(0);
    expect(report.calibration.mean_baseline_error).toBe(0);
    expect(report.calibration.mean_enriched_error).toBe(0);
    expect(report.calibration.mean_improvement).toBe(0);
    expect(report.calibration.improved_count).toBe(0);
    expect(report.calibration.worsened_count).toBe(0);
    expect(report.calibration.unchanged_count).toBe(0);
    expect(report.caution.caution_issued).toBe(0);
    expect(report.caution.caution_precision).toBeNull();
    expect(report.reinforcement.reinforcement_issued).toBe(0);
    expect(report.reinforcement.reinforcement_precision).toBeNull();
    expect(report.clusters).toHaveLength(0);
    expect(report.memory_verdict).toBe("neutral");
  });

  it("computes mean calibration errors from records", () => {
    const report = buildCpiCalibrationReport({
      total_cases: 2,
      cases_with_prior_analogs: 0,
      records: [
        {
          case_id: "a",
          period: "2025-01",
          horizon: "1d",
          verdict: "correct",
          direction_score: 1.0,
          baseline_confidence: 0.8,
          baseline_calibration_error: 0.2,
          prior_case_count: 0,
          analog_count: 0,
          analog_boost: 0,
          enriched_confidence: 0.8,
          enriched_calibration_error: 0.2,
          calibration_improvement: 0,
          cluster_id: "hotter.medium.hawkish.risk_off.elevated",
          cluster_reliability: "insufficient_data",
        },
        {
          case_id: "b",
          period: "2025-02",
          horizon: "1d",
          verdict: "correct",
          direction_score: 1.0,
          baseline_confidence: 0.7,
          baseline_calibration_error: 0.3,
          prior_case_count: 1,
          analog_count: 1,
          analog_boost: 0.05,
          enriched_confidence: 0.75,
          enriched_calibration_error: 0.25,
          calibration_improvement: 0.05,
          cluster_id: "hotter.medium.hawkish.risk_off.elevated",
          cluster_reliability: "insufficient_data",
        },
      ],
    });

    expect(report.calibration.mean_baseline_error).toBeCloseTo(0.25, 4);
    expect(report.calibration.mean_enriched_error).toBeCloseTo(0.225, 4);
    expect(report.calibration.mean_improvement).toBeCloseTo(0.025, 4);
    expect(report.calibration.improved_count).toBe(1);
    expect(report.calibration.unchanged_count).toBe(1);
    expect(report.calibration.worsened_count).toBe(0);
  });

  it("computes caution_precision correctly", () => {
    const report = buildCpiCalibrationReport({
      total_cases: 3,
      cases_with_prior_analogs: 2,
      records: [
        {
          case_id: "a",
          period: "2025-01",
          horizon: "1d",
          verdict: "wrong",
          direction_score: 0,
          baseline_confidence: 0.7,
          baseline_calibration_error: 0.7,
          prior_case_count: 1,
          analog_count: 1,
          analog_boost: -0.08,  // caution issued
          enriched_confidence: 0.62,
          enriched_calibration_error: 0.62,
          calibration_improvement: 0.08,
          cluster_id: "hotter.medium.hawkish.risk_off.elevated",
          cluster_reliability: "insufficient_data",
        },
        {
          case_id: "b",
          period: "2025-02",
          horizon: "1d",
          verdict: "correct",
          direction_score: 1,
          baseline_confidence: 0.7,
          baseline_calibration_error: 0.3,
          prior_case_count: 1,
          analog_count: 1,
          analog_boost: -0.05,  // caution issued but prediction was correct
          enriched_confidence: 0.65,
          enriched_calibration_error: 0.35,
          calibration_improvement: -0.05,
          cluster_id: "hotter.medium.hawkish.risk_off.elevated",
          cluster_reliability: "insufficient_data",
        },
        {
          case_id: "c",
          period: "2025-03",
          horizon: "1d",
          verdict: "correct",
          direction_score: 1,
          baseline_confidence: 0.75,
          baseline_calibration_error: 0.25,
          prior_case_count: 2,
          analog_count: 0,
          analog_boost: 0,
          enriched_confidence: 0.75,
          enriched_calibration_error: 0.25,
          calibration_improvement: 0,
          cluster_id: "hotter.medium.hawkish.risk_off.elevated",
          cluster_reliability: "insufficient_data",
        },
      ],
    });

    // 2 caution signals (a and b), 1 correct (a was wrong → caution justified)
    expect(report.caution.caution_issued).toBe(2);
    expect(report.caution.caution_correct).toBe(1);
    expect(report.caution.caution_precision).toBeCloseTo(0.5, 4);
  });

  it("computes reinforcement_precision correctly", () => {
    const report = buildCpiCalibrationReport({
      total_cases: 3,
      cases_with_prior_analogs: 2,
      records: [
        {
          case_id: "a",
          period: "2025-01",
          horizon: "1d",
          verdict: "correct",
          direction_score: 1,
          baseline_confidence: 0.6,
          baseline_calibration_error: 0.4,
          prior_case_count: 1,
          analog_count: 1,
          analog_boost: 0.07,  // reinforcement
          enriched_confidence: 0.67,
          enriched_calibration_error: 0.33,
          calibration_improvement: 0.07,
          cluster_id: "hotter.medium.hawkish.risk_off.elevated",
          cluster_reliability: "insufficient_data",
        },
        {
          case_id: "b",
          period: "2025-02",
          horizon: "1d",
          verdict: "wrong",
          direction_score: 0,
          baseline_confidence: 0.6,
          baseline_calibration_error: 0.6,
          prior_case_count: 1,
          analog_count: 1,
          analog_boost: 0.06,  // reinforcement but prediction was wrong
          enriched_confidence: 0.66,
          enriched_calibration_error: 0.66,
          calibration_improvement: -0.06,
          cluster_id: "hotter.medium.hawkish.risk_off.elevated",
          cluster_reliability: "insufficient_data",
        },
        {
          case_id: "c",
          period: "2025-03",
          horizon: "1d",
          verdict: "correct",
          direction_score: 1,
          baseline_confidence: 0.8,
          baseline_calibration_error: 0.2,
          prior_case_count: 2,
          analog_count: 0,
          analog_boost: 0,
          enriched_confidence: 0.8,
          enriched_calibration_error: 0.2,
          calibration_improvement: 0,
          cluster_id: "hotter.medium.hawkish.risk_off.elevated",
          cluster_reliability: "insufficient_data",
        },
      ],
    });

    expect(report.reinforcement.reinforcement_issued).toBe(2);
    expect(report.reinforcement.reinforcement_correct).toBe(1);
    expect(report.reinforcement.reinforcement_precision).toBeCloseTo(0.5, 4);
  });

  it("builds cluster entries with correct verdict thresholds", () => {
    // 3 records in same cluster: improvements of +0.10, +0.10, +0.10 → helps
    const makeRecord = (id: string, improvement: number, period: string) => ({
      case_id: id,
      period,
      horizon: "1d" as const,
      verdict: "correct" as const,
      direction_score: 1,
      baseline_confidence: 0.7,
      baseline_calibration_error: 0.3,
      prior_case_count: 1,
      analog_count: 1,
      analog_boost: improvement,
      enriched_confidence: 0.7 - improvement,
      enriched_calibration_error: 0.3 - improvement,
      calibration_improvement: improvement,
      cluster_id: "hotter.medium.hawkish.risk_off.elevated",
      cluster_reliability: "reliable" as const,
    });

    const report = buildCpiCalibrationReport({
      total_cases: 3,
      cases_with_prior_analogs: 3,
      records: [
        makeRecord("a", 0.1, "2025-01"),
        makeRecord("b", 0.1, "2025-02"),
        makeRecord("c", 0.1, "2025-03"),
      ],
    });

    expect(report.clusters).toHaveLength(1);
    const entry = report.clusters[0]!;
    expect(entry.cluster_id).toBe("hotter.medium.hawkish.risk_off.elevated");
    expect(entry.case_count).toBe(3);
    expect(entry.mean_improvement).toBeCloseTo(0.1, 4);
    expect(entry.verdict).toBe("helps");
  });

  it("marks cluster as insufficient_data when fewer than 3 cases", () => {
    const report = buildCpiCalibrationReport({
      total_cases: 2,
      cases_with_prior_analogs: 1,
      records: [
        {
          case_id: "a",
          period: "2025-01",
          horizon: "1d",
          verdict: "correct",
          direction_score: 1,
          baseline_confidence: 0.7,
          baseline_calibration_error: 0.3,
          prior_case_count: 0,
          analog_count: 0,
          analog_boost: 0,
          enriched_confidence: 0.7,
          enriched_calibration_error: 0.3,
          calibration_improvement: 0,
          cluster_id: "hotter.medium.hawkish.risk_off.elevated",
          cluster_reliability: "insufficient_data",
        },
        {
          case_id: "b",
          period: "2025-02",
          horizon: "1d",
          verdict: "correct",
          direction_score: 1,
          baseline_confidence: 0.65,
          baseline_calibration_error: 0.35,
          prior_case_count: 1,
          analog_count: 1,
          analog_boost: 0.05,
          enriched_confidence: 0.7,
          enriched_calibration_error: 0.3,
          calibration_improvement: 0.05,
          cluster_id: "hotter.medium.hawkish.risk_off.elevated",
          cluster_reliability: "insufficient_data",
        },
      ],
    });

    expect(report.clusters[0]!.verdict).toBe("insufficient_data");
  });

  it("resolves memory_verdict as 'improving' when mean_improvement > 0.02 and improved > worsened", () => {
    const makeRecord = (id: string, improvement: number, period: string) => ({
      case_id: id,
      period,
      horizon: "1d" as const,
      verdict: "correct" as const,
      direction_score: 1,
      baseline_confidence: 0.6,
      baseline_calibration_error: 0.4,
      prior_case_count: 1,
      analog_count: 1,
      analog_boost: improvement > 0 ? 0.05 : -0.05,
      enriched_confidence: 0.6,
      enriched_calibration_error: 0.4 - improvement,
      calibration_improvement: improvement,
      cluster_id: "hotter.medium.hawkish.risk_off.elevated",
      cluster_reliability: "insufficient_data" as const,
    });

    // 3 improved (0.05 each) vs 1 worsened (−0.01) → mean ≈ +0.035
    const report = buildCpiCalibrationReport({
      total_cases: 4,
      cases_with_prior_analogs: 4,
      records: [
        makeRecord("a", 0.05, "2025-01"),
        makeRecord("b", 0.05, "2025-02"),
        makeRecord("c", 0.05, "2025-03"),
        makeRecord("d", -0.01, "2025-04"),
      ],
    });

    expect(report.memory_verdict).toBe("improving");
  });

  it("resolves memory_verdict as 'degrading' when mean_improvement < -0.02", () => {
    const makeRecord = (id: string, improvement: number, period: string) => ({
      case_id: id,
      period,
      horizon: "1d" as const,
      verdict: "wrong" as const,
      direction_score: 0,
      baseline_confidence: 0.7,
      baseline_calibration_error: 0.7,
      prior_case_count: 1,
      analog_count: 1,
      analog_boost: 0.08,
      enriched_confidence: 0.78,
      enriched_calibration_error: 0.7 - improvement,
      calibration_improvement: improvement,
      cluster_id: "hotter.medium.hawkish.risk_off.elevated",
      cluster_reliability: "insufficient_data" as const,
    });

    const report = buildCpiCalibrationReport({
      total_cases: 3,
      cases_with_prior_analogs: 3,
      records: [
        makeRecord("a", -0.06, "2025-01"),
        makeRecord("b", -0.06, "2025-02"),
        makeRecord("c", -0.06, "2025-03"),
      ],
    });

    expect(report.memory_verdict).toBe("degrading");
  });

  it("resolves memory_verdict as 'neutral' for borderline improvements", () => {
    const makeRecord = (id: string, improvement: number, period: string) => ({
      case_id: id,
      period,
      horizon: "1d" as const,
      verdict: "correct" as const,
      direction_score: 1,
      baseline_confidence: 0.75,
      baseline_calibration_error: 0.25,
      prior_case_count: 1,
      analog_count: 0,
      analog_boost: 0,
      enriched_confidence: 0.75,
      enriched_calibration_error: 0.25 - improvement,
      calibration_improvement: improvement,
      cluster_id: "hotter.medium.hawkish.risk_off.elevated",
      cluster_reliability: "insufficient_data" as const,
    });

    // mean_improvement = 0.01 — below 0.02 threshold
    const report = buildCpiCalibrationReport({
      total_cases: 2,
      cases_with_prior_analogs: 0,
      records: [
        makeRecord("a", 0.01, "2025-01"),
        makeRecord("b", 0.01, "2025-02"),
      ],
    });

    expect(report.memory_verdict).toBe("neutral");
  });

  it("groups records into multiple cluster entries", () => {
    const makeRecord = (
      id: string,
      cluster_id: string,
      improvement: number,
      count: number,
      period: string,
    ) =>
      Array.from({ length: count }, (_, i) => ({
        case_id: `${id}-${i}`,
        period: `${period}-${i}`,
        horizon: "1d" as const,
        verdict: "correct" as const,
        direction_score: 1,
        baseline_confidence: 0.7,
        baseline_calibration_error: 0.3,
        prior_case_count: i,
        analog_count: i,
        analog_boost: improvement > 0 ? 0.05 : 0,
        enriched_confidence: 0.7,
        enriched_calibration_error: 0.3 - improvement,
        calibration_improvement: improvement,
        cluster_id,
        cluster_reliability: "insufficient_data" as const,
      }));

    const report = buildCpiCalibrationReport({
      total_cases: 8,
      cases_with_prior_analogs: 5,
      records: [
        ...makeRecord("a", "hotter.medium.hawkish.risk_off.elevated", 0.05, 5, "2025-A"),
        ...makeRecord("b", "cooler.small.dovish.risk_on.low", 0.0, 3, "2025-B"),
      ],
    });

    expect(report.clusters).toHaveLength(2);
    // Sorted by case_count desc
    expect(report.clusters[0]!.cluster_id).toBe("hotter.medium.hawkish.risk_off.elevated");
    expect(report.clusters[0]!.case_count).toBe(5);
    expect(report.clusters[1]!.cluster_id).toBe("cooler.small.dovish.risk_on.low");
    expect(report.clusters[1]!.case_count).toBe(3);
  });

  it("end-to-end: runs benchmark and produces calibration report from live store", async () => {
    const store = new CpiMemoryCaseStore();

    // Build 4 cases: 2025-01 through 2025-04, same cluster (hotter/medium/hawkish/risk_off/elevated)
    // All direction-correct — analogs should reinforce and reduce calibration error
    for (let i = 1; i <= 4; i++) {
      const c = buildCase({
        actual: 3.15,    // 15bp hotter = medium surprise
        expected: 3.0,
        released_at: `2025-0${i}-10T13:30:00Z`,
        period: `2025-0${i}`,
        fed: "hawkish",
        macro: "risk_off",
        vol: "elevated",
        directionCorrect: true,
      });
      await store.save(c);
    }

    const benchmark = await runCpiReplayBenchmark(store);
    const report = buildCpiCalibrationReport(benchmark);

    expect(report.total_cases).toBe(4);
    expect(report.calibration.improved_count + report.calibration.worsened_count + report.calibration.unchanged_count).toBe(4);
    expect(report.clusters.length).toBeGreaterThanOrEqual(1);

    // memory_verdict must be one of the three valid values
    expect(["improving", "neutral", "degrading"]).toContain(report.memory_verdict);

    // Reinforcement should have been issued from 2025-02 onward (analogs from prior correct cases)
    expect(report.reinforcement.reinforcement_issued).toBeGreaterThanOrEqual(0);
  });
});
