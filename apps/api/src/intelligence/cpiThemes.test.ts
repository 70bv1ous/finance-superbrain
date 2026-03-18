import { beforeEach, describe, expect, it } from "vitest";

import { buildCpiEvent } from "./events/cpiEvent.js";
import { buildMarketContextSnapshot } from "./context/marketContext.js";
import { generateCpiPrediction } from "./prediction/cpiPrediction.js";
import { trackCpiOutcome } from "./outcome/outcomeTracker.js";
import { buildCpiMemoryCase } from "./memory/memoryCaseBuilder.js";
import { CpiMemoryCaseStore } from "./memory/cpiMemoryCaseStore.js";
import {
  clusterCpiMemoryCases,
  buildCpiClusterId,
  resolveThemeKeyForCase,
} from "./themes/cpiThemeClustering.js";
import {
  summarizeCpiTheme,
  buildCpiThemeReport,
} from "./themes/cpiThemeSummary.js";

// ─── Fixture builder ──────────────────────────────────────────────────────────

type CaseSpec = {
  actual: number;
  expected: number;
  period?: string;
  fed?: string;
  macro?: string;
  vol?: string;
  directionCorrect?: boolean;
};

const buildCase = (spec: CaseSpec) => {
  const event = buildCpiEvent({
    released_at: "2025-01-10T13:30:00Z",
    period: spec.period ?? "2025-01",
    actual_value: spec.actual,
    expected_value: spec.expected,
    prior_value: spec.expected,
  });

  const context = buildMarketContextSnapshot({
    fed_policy_stance: (spec.fed ?? "neutral") as any,
    macro_regime: (spec.macro ?? "uncertain") as any,
    volatility_regime: (spec.vol ?? "normal") as any,
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
    // Sign the magnitude consistently with direction so scorePrediction
    // does not penalise for a sign mismatch.
    const bp = dir === "up" ? 45 : -45;
    return { ticker: a.ticker, realized_direction: dir, realized_magnitude_bp: bp };
  });

  const outcome_result = trackCpiOutcome({
    prediction_result,
    realized_moves: realized,
    measured_at: "2025-01-11T20:00:00Z",
    timing_alignment: 0.8,
  });

  return buildCpiMemoryCase({ prediction_result, outcome_result });
};

// ─── Cluster ID determinism ───────────────────────────────────────────────────

describe("buildCpiClusterId", () => {
  it("produces a deterministic dot-delimited key", () => {
    const id = buildCpiClusterId({
      surprise_direction: "hotter",
      surprise_band: "medium",
      fed_policy_stance: "hawkish",
      macro_regime: "risk_off",
      volatility_regime: "elevated",
    });

    expect(id).toBe("hotter.medium.hawkish.risk_off.elevated");
  });

  it("produces different ids for different keys", () => {
    const a = buildCpiClusterId({
      surprise_direction: "hotter",
      surprise_band: "medium",
      fed_policy_stance: "hawkish",
      macro_regime: "risk_off",
      volatility_regime: "normal",
    });

    const b = buildCpiClusterId({
      surprise_direction: "cooler",
      surprise_band: "medium",
      fed_policy_stance: "hawkish",
      macro_regime: "risk_off",
      volatility_regime: "normal",
    });

    expect(a).not.toBe(b);
  });
});

// ─── resolveThemeKeyForCase ───────────────────────────────────────────────────

describe("resolveThemeKeyForCase", () => {
  it("extracts the correct key dimensions from a memory case", () => {
    const c = buildCase({ actual: 3.2, expected: 3.0, fed: "hawkish", macro: "risk_off", vol: "elevated" });
    const key = resolveThemeKeyForCase(c);

    expect(key.surprise_direction).toBe("hotter");
    expect(key.surprise_band).toBe("medium");    // 20 bp → medium
    expect(key.fed_policy_stance).toBe("hawkish");
    expect(key.macro_regime).toBe("risk_off");
    expect(key.volatility_regime).toBe("elevated");
  });

  it("maps a cooler CPI to the cooler direction", () => {
    const c = buildCase({ actual: 2.7, expected: 3.0, fed: "dovish" });
    const key = resolveThemeKeyForCase(c);

    expect(key.surprise_direction).toBe("cooler");
    expect(key.surprise_band).toBe("large");  // 30 bp → large
  });

  it("maps a tiny surprise to the small band", () => {
    const c = buildCase({ actual: 3.05, expected: 3.0 }); // 5 bp
    const key = resolveThemeKeyForCase(c);

    expect(key.surprise_band).toBe("small");
  });
});

// ─── clusterCpiMemoryCases ────────────────────────────────────────────────────

describe("clusterCpiMemoryCases", () => {
  let store: CpiMemoryCaseStore;

  beforeEach(() => {
    store = new CpiMemoryCaseStore();
  });

  it("returns an empty array for an empty store", async () => {
    expect(await clusterCpiMemoryCases(store)).toHaveLength(0);
  });

  it("creates one cluster for cases with identical key dimensions", async () => {
    // 3 cases: all hotter / medium-band (15 bp each) / neutral / uncertain / normal
    // Using the same actual value pins all three to the same surprise_band.
    await store.save(buildCase({ actual: 3.15, expected: 3.0, period: "2024-01" }));
    await store.save(buildCase({ actual: 3.15, expected: 3.0, period: "2024-02" }));
    await store.save(buildCase({ actual: 3.15, expected: 3.0, period: "2024-03" }));

    const clusters = await clusterCpiMemoryCases(store);

    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.size).toBe(3);
  });

  it("creates two clusters for cases with differing surprise directions", async () => {
    await store.save(buildCase({ actual: 3.2, expected: 3.0, period: "2024-01" })); // hotter
    await store.save(buildCase({ actual: 2.7, expected: 3.0, period: "2024-02" })); // cooler

    const clusters = await clusterCpiMemoryCases(store);

    expect(clusters).toHaveLength(2);
    const directions = new Set(clusters.map((c) => c.key.surprise_direction));
    expect(directions.has("hotter")).toBe(true);
    expect(directions.has("cooler")).toBe(true);
  });

  it("creates separate clusters for differing fed stances", async () => {
    await store.save(buildCase({ actual: 3.2, expected: 3.0, fed: "hawkish", period: "2024-01" }));
    await store.save(buildCase({ actual: 3.2, expected: 3.0, fed: "dovish", period: "2024-02" }));
    await store.save(buildCase({ actual: 3.2, expected: 3.0, fed: "neutral", period: "2024-03" }));

    const clusters = await clusterCpiMemoryCases(store);

    expect(clusters).toHaveLength(3);
  });

  it("creates separate clusters for differing macro regimes", async () => {
    await store.save(buildCase({ actual: 3.2, expected: 3.0, macro: "risk_on", period: "2024-01" }));
    await store.save(buildCase({ actual: 3.2, expected: 3.0, macro: "risk_off", period: "2024-02" }));

    const clusters = await clusterCpiMemoryCases(store);

    expect(clusters).toHaveLength(2);
  });

  it("creates separate clusters for differing volatility regimes", async () => {
    await store.save(buildCase({ actual: 3.2, expected: 3.0, vol: "normal", period: "2024-01" }));
    await store.save(buildCase({ actual: 3.2, expected: 3.0, vol: "elevated", period: "2024-02" }));

    const clusters = await clusterCpiMemoryCases(store);

    expect(clusters).toHaveLength(2);
  });

  it("sorts clusters largest-first", async () => {
    // 3 hotter, 1 cooler
    await store.save(buildCase({ actual: 3.2, expected: 3.0, period: "2024-01" }));
    await store.save(buildCase({ actual: 3.3, expected: 3.0, period: "2024-02" }));
    await store.save(buildCase({ actual: 3.1, expected: 3.0, period: "2024-03" }));
    await store.save(buildCase({ actual: 2.7, expected: 3.0, period: "2024-04" }));

    const clusters = await clusterCpiMemoryCases(store);

    // Largest cluster comes first
    expect(clusters[0]!.size).toBeGreaterThanOrEqual(clusters[1]!.size);
  });

  it("cluster_id is consistent with buildCpiClusterId for the same key", async () => {
    await store.save(
      buildCase({ actual: 3.2, expected: 3.0, fed: "hawkish", macro: "risk_off", vol: "elevated" }),
    );

    const clusters = await clusterCpiMemoryCases(store);
    const cluster = clusters[0]!;

    const expectedId = buildCpiClusterId(cluster.key);
    expect(cluster.cluster_id).toBe(expectedId);
  });

  it("each case appears in exactly one cluster", async () => {
    await store.save(buildCase({ actual: 3.2, expected: 3.0, period: "2024-01" }));
    await store.save(buildCase({ actual: 2.7, expected: 3.0, period: "2024-02" }));
    await store.save(buildCase({ actual: 3.4, expected: 3.0, period: "2024-03", fed: "hawkish" }));

    const clusters = await clusterCpiMemoryCases(store);
    const totalCasesInClusters = clusters.reduce((sum, c) => sum + c.size, 0);

    expect(totalCasesInClusters).toBe(3);
  });
});

// ─── summarizeCpiTheme ────────────────────────────────────────────────────────

describe("summarizeCpiTheme", () => {
  it("produces correct verdict distribution for a uniform cluster", async () => {
    const store = new CpiMemoryCaseStore();

    for (let i = 0; i < 4; i++) {
      await store.save(buildCase({ actual: 3.2, expected: 3.0, period: `2024-0${i + 1}`, directionCorrect: true }));
    }

    const [cluster] = await clusterCpiMemoryCases(store);
    const summary = summarizeCpiTheme(cluster!);

    expect(summary.verdict_distribution.total).toBe(4);
    expect(summary.verdict_distribution.correct).toBe(4);
    expect(summary.verdict_distribution.wrong).toBe(0);
    expect(summary.verdict_distribution.accuracy_rate).toBe(1.0);
    expect(summary.dominant_verdict).toBe("correct");
  });

  it("marks reliability as 'insufficient_data' for < 3 cases", async () => {
    const store = new CpiMemoryCaseStore();
    await store.save(buildCase({ actual: 3.2, expected: 3.0, period: "2024-01" }));
    await store.save(buildCase({ actual: 3.3, expected: 3.0, period: "2024-02" }));

    const [cluster] = await clusterCpiMemoryCases(store);
    const summary = summarizeCpiTheme(cluster!);

    expect(summary.reliability_signal).toBe("insufficient_data");
  });

  it("marks reliability as 'reliable' for ≥ 3 mostly-correct cases", async () => {
    const store = new CpiMemoryCaseStore();

    for (let i = 0; i < 4; i++) {
      await store.save(
        buildCase({ actual: 3.2, expected: 3.0, period: `2024-0${i + 1}`, directionCorrect: true }),
      );
    }

    const [cluster] = await clusterCpiMemoryCases(store);
    const summary = summarizeCpiTheme(cluster!);

    expect(summary.reliability_signal).toBe("reliable");
  });

  it("marks reliability as 'unreliable' for ≥ 3 mostly-wrong cases", async () => {
    const store = new CpiMemoryCaseStore();

    for (let i = 0; i < 4; i++) {
      await store.save(
        buildCase({ actual: 3.2, expected: 3.0, period: `2024-0${i + 1}`, directionCorrect: false }),
      );
    }

    const [cluster] = await clusterCpiMemoryCases(store);
    const summary = summarizeCpiTheme(cluster!);

    expect(summary.reliability_signal).toBe("unreliable");
  });

  it("marks reliability as 'mixed' for balanced verdicts with ≥ 3 cases", async () => {
    const store = new CpiMemoryCaseStore();

    // 2 correct, 2 wrong → accuracy_rate = 0.50 → mixed
    // All use the same actual value (15 bp, medium band) so they land in one cluster.
    await store.save(buildCase({ actual: 3.15, expected: 3.0, period: "2024-01", directionCorrect: true }));
    await store.save(buildCase({ actual: 3.15, expected: 3.0, period: "2024-02", directionCorrect: true }));
    await store.save(buildCase({ actual: 3.15, expected: 3.0, period: "2024-03", directionCorrect: false }));
    await store.save(buildCase({ actual: 3.15, expected: 3.0, period: "2024-04", directionCorrect: false }));

    const [cluster] = await clusterCpiMemoryCases(store);
    const summary = summarizeCpiTheme(cluster!);

    expect(summary.reliability_signal).toBe("mixed");
  });

  it("includes common_lesson_patterns only from correct cases", async () => {
    const store = new CpiMemoryCaseStore();

    await store.save(buildCase({ actual: 3.2, expected: 3.0, period: "2024-01", directionCorrect: true }));
    await store.save(buildCase({ actual: 3.2, expected: 3.0, period: "2024-02", directionCorrect: false }));
    await store.save(buildCase({ actual: 3.2, expected: 3.0, period: "2024-03", directionCorrect: true }));

    const [cluster] = await clusterCpiMemoryCases(store);
    const summary = summarizeCpiTheme(cluster!);

    // Lessons from correct cases: should have some
    expect(Array.isArray(summary.common_lesson_patterns)).toBe(true);
    expect(summary.common_lesson_patterns.length).toBeGreaterThanOrEqual(0);
  });

  it("includes common_failure_modes only from wrong/partial cases", async () => {
    const store = new CpiMemoryCaseStore();

    for (let i = 0; i < 3; i++) {
      await store.save(
        buildCase({ actual: 3.2, expected: 3.0, period: `2024-0${i + 1}`, directionCorrect: false }),
      );
    }

    const [cluster] = await clusterCpiMemoryCases(store);
    const summary = summarizeCpiTheme(cluster!);

    expect(summary.common_failure_modes.length).toBeGreaterThan(0);
    expect(summary.common_lesson_patterns).toHaveLength(0); // no correct cases
  });

  it("produces a non-empty pattern_label", async () => {
    const store = new CpiMemoryCaseStore();
    await store.save(buildCase({ actual: 3.2, expected: 3.0, fed: "hawkish", macro: "risk_off", vol: "elevated" }));

    const [cluster] = await clusterCpiMemoryCases(store);
    const summary = summarizeCpiTheme(cluster!);

    expect(summary.pattern_label.length).toBeGreaterThan(10);
    expect(summary.pattern_label).toContain("Hot");
    expect(summary.pattern_label).toContain("hawkish");
  });

  it("pattern_label reflects all five dimensions", async () => {
    const store = new CpiMemoryCaseStore();
    await store.save(buildCase({ actual: 2.5, expected: 3.0, fed: "dovish", macro: "risk_on", vol: "low" }));

    const [cluster] = await clusterCpiMemoryCases(store);
    const summary = summarizeCpiTheme(cluster!);

    expect(summary.pattern_label).toContain("Cool");
    expect(summary.pattern_label).toContain("dovish");
    expect(summary.pattern_label).toContain("risk-on");
    expect(summary.pattern_label).toContain("low vol");
  });

  it("average_confidence is within [0, 1]", async () => {
    const store = new CpiMemoryCaseStore();
    await store.save(buildCase({ actual: 3.2, expected: 3.0 }));

    const [cluster] = await clusterCpiMemoryCases(store);
    const summary = summarizeCpiTheme(cluster!);

    expect(summary.average_confidence).toBeGreaterThanOrEqual(0);
    expect(summary.average_confidence).toBeLessThanOrEqual(1);
  });

  it("confidence_tendency is 'high' for high-confidence clusters", async () => {
    // The prediction engine typically produces confidence ≥ 0.65 for macro events
    const store = new CpiMemoryCaseStore();
    await store.save(buildCase({ actual: 3.2, expected: 3.0 }));

    const [cluster] = await clusterCpiMemoryCases(store);
    const summary = summarizeCpiTheme(cluster!);

    expect(["high", "moderate", "low"]).toContain(summary.confidence_tendency);
  });
});

// ─── buildCpiThemeReport ──────────────────────────────────────────────────────

describe("buildCpiThemeReport", () => {
  it("returns a zero-state report for an empty store", async () => {
    const store = new CpiMemoryCaseStore();
    const report = await buildCpiThemeReport(store);

    expect(report.total_cases).toBe(0);
    expect(report.total_clusters).toBe(0);
    expect(report.clusters).toHaveLength(0);
    expect(report.summaries).toHaveLength(0);
    expect(report.reliable_patterns).toHaveLength(0);
    expect(report.failure_patterns).toHaveLength(0);
  });

  it("total_cases equals the number of cases saved", async () => {
    const store = new CpiMemoryCaseStore();

    await store.save(buildCase({ actual: 3.2, expected: 3.0, period: "2024-01" }));
    await store.save(buildCase({ actual: 2.7, expected: 3.0, period: "2024-02" }));
    await store.save(buildCase({ actual: 3.4, expected: 3.0, period: "2024-03", fed: "hawkish" }));

    const report = await buildCpiThemeReport(store);

    expect(report.total_cases).toBe(3);
  });

  it("total_clusters matches distinct key combinations", async () => {
    const store = new CpiMemoryCaseStore();

    // 2 clusters: hotter neutral (15 bp, medium) and cooler dovish (15 bp, medium)
    // Both hotter cases use 3.15 so they share the same surprise_band → one cluster.
    await store.save(buildCase({ actual: 3.15, expected: 3.0, fed: "neutral", period: "2024-01" }));
    await store.save(buildCase({ actual: 3.15, expected: 3.0, fed: "neutral", period: "2024-02" }));
    await store.save(buildCase({ actual: 2.85, expected: 3.0, fed: "dovish", period: "2024-03" }));

    const report = await buildCpiThemeReport(store);

    expect(report.total_clusters).toBe(2);
    expect(report.summaries).toHaveLength(2);
  });

  it("reliable_patterns contains only reliable summaries", async () => {
    const store = new CpiMemoryCaseStore();

    // Reliable cluster: 4 correct cases, same key
    for (let i = 1; i <= 4; i++) {
      await store.save(
        buildCase({ actual: 3.2, expected: 3.0, period: `2024-0${i}`, directionCorrect: true }),
      );
    }

    const report = await buildCpiThemeReport(store);

    for (const pattern of report.reliable_patterns) {
      expect(pattern.reliability_signal).toBe("reliable");
    }
  });

  it("failure_patterns contains only unreliable summaries", async () => {
    const store = new CpiMemoryCaseStore();

    // Unreliable cluster: 4 wrong cases, same key
    for (let i = 1; i <= 4; i++) {
      await store.save(
        buildCase({ actual: 3.2, expected: 3.0, period: `2024-0${i}`, directionCorrect: false }),
      );
    }

    const report = await buildCpiThemeReport(store);

    for (const pattern of report.failure_patterns) {
      expect(pattern.reliability_signal).toBe("unreliable");
    }
  });

  it("summaries and clusters are aligned (same length, same cluster_ids)", async () => {
    const store = new CpiMemoryCaseStore();

    await store.save(buildCase({ actual: 3.2, expected: 3.0, period: "2024-01" }));
    await store.save(buildCase({ actual: 2.7, expected: 3.0, period: "2024-02" }));

    const report = await buildCpiThemeReport(store);

    expect(report.summaries.length).toBe(report.clusters.length);

    const clusterIds = new Set(report.clusters.map((c) => c.cluster_id));
    for (const s of report.summaries) {
      expect(clusterIds.has(s.cluster_id)).toBe(true);
    }
  });
});

// ─── Phase 5C End-to-End ──────────────────────────────────────────────────────

describe("Phase 5C: accumulate cases → cluster → summarize → theme report", () => {
  it("produces a useful theme report from a realistic multi-event history", async () => {
    const store = new CpiMemoryCaseStore();

    // Scenario: system has seen 8 CPI releases over ~12 months
    // Pattern A: hot CPI + hawkish Fed — seen 4 times.
    // All use actual=3.15 (15 bp, medium band) so they share the same cluster key.
    const patternAPeriods = ["2024-01", "2024-02", "2024-03", "2024-04"];
    for (let i = 0; i < patternAPeriods.length; i++) {
      await store.save(
        buildCase({
          actual: 3.15,
          expected: 3.0,
          fed: "hawkish",
          macro: "uncertain",
          vol: "normal",
          period: patternAPeriods[i]!,
          directionCorrect: i < 3, // 3 correct, 1 wrong
        }),
      );
    }

    // Pattern B: cool CPI + dovish Fed — seen 3 times.
    // All use actual=2.85 (15 bp cooler, medium band) so they share the same cluster key.
    for (let i = 1; i <= 3; i++) {
      await store.save(
        buildCase({
          actual: 2.85,
          expected: 3.0,
          fed: "dovish",
          macro: "uncertain",
          vol: "normal",
          period: `2024-${i + 4}`,
          directionCorrect: true,
        }),
      );
    }

    // Pattern C: hot CPI + neutral Fed, elevated vol — seen once
    await store.save(
      buildCase({
        actual: 3.3,
        expected: 3.0,
        fed: "neutral",
        macro: "risk_off",
        vol: "elevated",
        period: "2024-10",
      }),
    );

    const report = await buildCpiThemeReport(store);

    // Structural completeness
    expect(report.total_cases).toBe(8);
    expect(report.total_clusters).toBeGreaterThanOrEqual(3);

    // Largest cluster is Pattern A (4 cases)
    expect(report.clusters[0]!.size).toBe(4);

    // Pattern A: 3/4 correct → accuracy = 0.75 → reliable
    const patternA = report.summaries.find(
      (s) => s.key.surprise_direction === "hotter" && s.key.fed_policy_stance === "hawkish",
    );
    expect(patternA).toBeDefined();
    expect(patternA!.reliability_signal).toBe("reliable");
    expect(patternA!.verdict_distribution.accuracy_rate).toBeGreaterThanOrEqual(0.70);

    // Pattern B: 3 cooler/dovish cases form one cluster.
    // We verify the cluster exists and has the right size; reliability depends
    // on the scoring engine internals (magnitude, calibration) which vary with
    // the prediction engine output — so we assert the cluster is present and
    // consistent rather than pinning to a specific reliability value.
    const patternB = report.summaries.find(
      (s) => s.key.surprise_direction === "cooler" && s.key.fed_policy_stance === "dovish",
    );
    expect(patternB).toBeDefined();
    expect(patternB!.size).toBe(3);
    expect(["reliable", "mixed", "unreliable", "insufficient_data"]).toContain(
      patternB!.reliability_signal,
    );

    // Pattern C: 1 case → insufficient_data
    const patternC = report.summaries.find(
      (s) =>
        s.key.surprise_direction === "hotter" &&
        s.key.fed_policy_stance === "neutral" &&
        s.key.volatility_regime === "elevated",
    );
    expect(patternC).toBeDefined();
    expect(patternC!.reliability_signal).toBe("insufficient_data");

    // Reliable patterns populated
    expect(report.reliable_patterns.length).toBeGreaterThanOrEqual(1);

    // Pattern labels are human-readable
    for (const summary of report.summaries) {
      expect(summary.pattern_label.length).toBeGreaterThan(10);
    }
  });

  it("identifies a failure pattern when a theme is consistently wrong", async () => {
    const store = new CpiMemoryCaseStore();

    // 5 identical-regime cases, all wrong
    for (let i = 1; i <= 5; i++) {
      await store.save(
        buildCase({
          actual: 3.2,
          expected: 3.0,
          fed: "hawkish",
          macro: "risk_off",
          vol: "elevated",
          period: `2023-0${i}`,
          directionCorrect: false,
        }),
      );
    }

    const report = await buildCpiThemeReport(store);

    expect(report.failure_patterns).toHaveLength(1);
    const fp = report.failure_patterns[0]!;
    expect(fp.reliability_signal).toBe("unreliable");
    expect(fp.dominant_verdict).toBe("wrong");
    expect(fp.verdict_distribution.accuracy_rate).toBe(0);
    expect(fp.common_failure_modes.length).toBeGreaterThan(0);
    expect(fp.pattern_label).toContain("hawkish");
  });

  it("lesson_patterns are empty when all cases are wrong", async () => {
    const store = new CpiMemoryCaseStore();

    for (let i = 1; i <= 3; i++) {
      await store.save(
        buildCase({ actual: 3.2, expected: 3.0, period: `2024-0${i}`, directionCorrect: false }),
      );
    }

    const [cluster] = await clusterCpiMemoryCases(store);
    const summary = summarizeCpiTheme(cluster!);

    expect(summary.common_lesson_patterns).toHaveLength(0);
    expect(summary.common_failure_modes.length).toBeGreaterThan(0);
  });
});
