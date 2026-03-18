import type {
  BenchmarkRegressionReport,
  BenchmarkReplaySnapshotHistoryResponse,
  BenchmarkStabilityReport,
  EvolutionScheduleConfig,
  GrowthPressureAlertReport,
  HistoricalLibraryCoverageResponse,
  HistoricalLibraryGapReport,
  ModelComparisonReport,
  ModelLineageReport,
} from "@finance-superbrain/schemas";

import { resolveEvolutionScheduleConfig } from "./evolutionSchedule.js";
import { buildBenchmarkRegressionReport } from "./benchmarkRegressionReport.js";
import { buildBenchmarkStabilityReport } from "./benchmarkStabilityReport.js";
import { buildGrowthPressureAlertReport } from "./growthPressureAlerts.js";
import { buildHistoricalLibraryCoverageReport } from "./historicalLibraryCoverageReport.js";
import { buildHistoricalLibraryGapReport } from "./historicalLibraryGapReport.js";
import { buildModelComparisonReport } from "./modelComparisonReport.js";
import { buildModelLineageReport } from "./modelLineageReport.js";
import type { Repository } from "./repository.types.js";

export type ClaudeReviewPacketOptions = {
  benchmark_pack_id?: string;
  review_focus?: string[];
  review_questions?: string[];
  git_context?: {
    branch: string | null;
    status_lines: string[];
    changed_files: string[];
  };
};

export type ClaudeReviewPacketSnapshot = {
  benchmark_pack_id: string;
  coverage: HistoricalLibraryCoverageResponse;
  gaps: HistoricalLibraryGapReport;
  model_comparison: ModelComparisonReport;
  stability: BenchmarkStabilityReport;
  regressions: BenchmarkRegressionReport;
  growth_alerts: GrowthPressureAlertReport;
  lineage: ModelLineageReport;
  schedule: EvolutionScheduleConfig;
  benchmark_history: BenchmarkReplaySnapshotHistoryResponse;
};

const DEFAULT_FOCUS = [
  "architecture risks in the finance superbrain core",
  "benchmark and evolution logic that could create false confidence",
  "highest-value next move to improve edge safely",
];

const DEFAULT_QUESTIONS = [
  "Where is the current architecture still too heuristic or brittle?",
  "Which failure modes in benchmarking, molting, or promotion are most dangerous right now?",
  "What design changes would most improve robustness before we scale the corpus further?",
];

const section = (title: string, lines: string[]) =>
  [`## ${title}`, ...lines, ""].join("\n");

const bulletLines = (items: string[], emptyLine: string) =>
  items.length ? items.map((item) => `- ${item}`) : [`- ${emptyLine}`];

const limit = (items: string[], count: number) => items.slice(0, count);

const resolvePromptInputs = (options: ClaudeReviewPacketOptions = {}) => ({
  benchmarkPackId: options.benchmark_pack_id ?? "core_benchmark_v1",
  reviewFocus: options.review_focus?.length ? options.review_focus : DEFAULT_FOCUS,
  reviewQuestions:
    options.review_questions?.length ? options.review_questions : DEFAULT_QUESTIONS,
  gitContext: options.git_context ?? {
    branch: null,
    status_lines: [],
    changed_files: [],
  },
});

export const renderClaudeReviewPacket = (
  snapshot: ClaudeReviewPacketSnapshot,
  options: ClaudeReviewPacketOptions = {},
) => {
  const { benchmarkPackId, reviewFocus, reviewQuestions, gitContext } =
    resolvePromptInputs(options);
  const latestSnapshot =
    snapshot.benchmark_history.snapshots
      .filter((item) => item.benchmark_pack_id === benchmarkPackId)
      .sort((left, right) => right.as_of.localeCompare(left.as_of))[0] ?? null;
  const topStableFamilies = limit(
    snapshot.stability.families.map(
      (family) =>
        `${family.family}: signal ${family.current_signal}, stability ${family.stability_score}, resilience ${family.resilience_score}`,
    ),
    4,
  );
  const topRegressions = limit(
    snapshot.regressions.alerts.map(
      (alert) =>
        `${alert.family}: ${alert.severity} regression, streak ${alert.regression_streak}, score delta ${alert.score_delta}, wrong-rate delta ${alert.wrong_rate_delta}`,
    ),
    4,
  );
  const topGrowthAlerts = limit(
    snapshot.growth_alerts.alerts.map(
      (alert) =>
        `${alert.family}: ${alert.severity} pressure, persistence ${alert.persistence_count}, planned action ${alert.planned_action ?? "none"}`,
    ),
    4,
  );
  const topGapAlerts = limit(
    snapshot.gaps.alerts.map((alert) => `${alert.title}: ${alert.rationale}`),
    4,
  );
  const activeFamilies = snapshot.lineage.families.filter(
    (family) => family.active_model_version !== null,
  );
  const topModels = limit(
    snapshot.model_comparison.versions.map(
      (model) =>
        `${model.model_version}: avg score ${model.average_total_score}, direction ${model.direction_accuracy}, calibration gap ${model.calibration_gap}`,
    ),
    4,
  );
  const intelligenceLoop = [
    "Source intake accepts manual notes, historical library imports, feeds, transcripts, and live webhook/session chunks.",
    "The parser converts raw finance text into a structured event with themes, regions, candidate assets, and source classification.",
    "Prediction generation applies the current model family/profile, analog retrieval, and confidence shaping to produce market-impact theses.",
    "Realized outcomes are scored later, then post-mortems and lessons are written back into memory with calibration signals.",
    "Stored lessons, analogs, benchmark history, and calibration summaries are reused when future predictions and reviews are generated.",
  ];
  const evolutionLoop = [
    `Mixed benchmark snapshots run against ${benchmarkPackId} so each family is graded on the same cross-domain finance pack.`,
    "Weekly stability and regression reports turn repeated benchmark weakness into measurable growth pressure instead of one-off noise.",
    "Growth-pressure policies can trigger diagnostics automatically and prepare candidate shells, but shell generation remains governed.",
    "Replay tuning, promotion gates, and stability-aware hardening decide whether a soft shell survives into an active shell.",
    "Lineage snapshots and the evolution schedule preserve ancestry, cadence, and whether each family is actually compounding edge over time.",
  ];
  const knownWeaknesses = [
    "Event parsing and prediction shaping are still partly heuristic and profile-biased rather than fully learned from a large supervised corpus.",
    snapshot.gaps.alerts[0]
      ? `Benchmark trust still depends on corpus depth and review quality. Current top gap: ${snapshot.gaps.alerts[0].title} (${snapshot.gaps.alerts[0].rationale}).`
      : "Benchmark trust still depends on corpus depth and review quality even when no major gap alert is currently open.",
    latestSnapshot
      ? `Benchmark history exists, but long-horizon validation is still shallow: the latest checkpoint used ${latestSnapshot.selected_case_count} selected cases.`
      : "Benchmark history is still thin for this pack, so conclusions about durability should be treated cautiously.",
    "Walk-forward validation and live production-grade performance checks are not implemented yet, so replay success is not the same as live robustness.",
    "Local repository access can be flaky in pglite mode, so the Claude packet generator may rely on live API fallback and a fresh running server.",
    "The current UI is still an operator console. The polished user-facing finance assistant, personalization layer, and full voice product are not built yet.",
  ];
  const promptBlock = [
    "You are acting as the independent reviewer for a finance AI system called Finance Superbrain.",
    `Review the packet below with focus on: ${reviewFocus.join("; ")}.`,
    "Return findings first, ordered by severity.",
    "Prioritize bugs, architecture risks, unsafe evaluation logic, hidden regressions, weak assumptions, and missing tests.",
    "After findings, answer the explicit review questions briefly.",
  ].join(" ");

  return [
    "# Claude Review Packet",
    "",
    `Generated at: ${new Date().toISOString()}`,
    `Benchmark pack: ${benchmarkPackId}`,
    "",
    section("Mission", [
      "This packet is meant to hand the current Finance Superbrain state to Claude for independent review.",
      "Codex remains the primary builder and integrator. Claude is being used as the second-brain reviewer and architectural challenger.",
    ]),
    section("Current System State", [
      `- Historical library: ${snapshot.coverage.total_cases} cases (${snapshot.coverage.reviewed_cases} reviewed, ${snapshot.coverage.high_confidence_cases} high confidence, ${snapshot.coverage.needs_review_count} draft)`,
      `- Model leaderboard leaders: score ${snapshot.model_comparison.leaders.by_average_total_score ?? "-"}, direction ${snapshot.model_comparison.leaders.by_direction_accuracy ?? "-"}, calibration ${snapshot.model_comparison.leaders.by_calibration_alignment ?? "-"}`,
      `- Lineage: ${snapshot.lineage.families.length} family/families, ${activeFamilies.length} active family/families, ${snapshot.lineage.recent_molts.length} recent molt node(s)`,
      latestSnapshot
        ? `- Latest benchmark snapshot: ${latestSnapshot.as_of}, ${latestSnapshot.family_count} family/families, ${latestSnapshot.selected_case_count} selected case(s)`
        : "- Latest benchmark snapshot: none yet for this benchmark pack",
      `- Evolution schedule: enabled ${snapshot.schedule.enabled}, benchmark pack ${snapshot.schedule.benchmark_pack_id}, next molt ${snapshot.schedule.next_molt_at ?? "-"}`,
    ]),
    section("Current Intelligence Loop", bulletLines(intelligenceLoop, "No intelligence-loop summary is available.")),
    section("Current Evolution Loop", bulletLines(evolutionLoop, "No evolution-loop summary is available.")),
    section("Benchmark Stability", bulletLines(topStableFamilies, "No benchmark stability families yet.")),
    section("Regressions", bulletLines(topRegressions, "No benchmark regressions are active.")),
    section("Growth Pressure", bulletLines(topGrowthAlerts, "No active growth-pressure alerts are open.")),
    section("Library Gaps", bulletLines(topGapAlerts, "No major historical-library gaps are currently flagged.")),
    section("Top Models", bulletLines(topModels, "No model comparison records exist yet.")),
    section(
      "Known Heuristics / Known Weaknesses",
      bulletLines(knownWeaknesses, "No explicit heuristics or weaknesses were recorded."),
    ),
    section("Git Context", [
      `- Branch: ${gitContext.branch ?? "unknown"}`,
      ...bulletLines(
        limit(gitContext.status_lines, 12),
        "No uncommitted git status lines were captured.",
      ),
    ]),
    section(
      "Changed Files To Inspect First",
      bulletLines(
        limit(gitContext.changed_files, 12),
        "No changed files were captured from git status.",
      ),
    ),
    section("Review Questions", bulletLines(reviewQuestions, "No explicit review questions supplied.")),
    "## Prompt To Paste Into Claude",
    "",
    "```text",
    promptBlock,
    "",
    "Use the packet below as the primary review context.",
    "```",
    "",
  ].join("\n");
};

export const buildClaudeReviewPacketSnapshot = async (
  repository: Repository,
  options: ClaudeReviewPacketOptions = {},
): Promise<ClaudeReviewPacketSnapshot> => {
  const benchmarkPackId = options.benchmark_pack_id ?? "core_benchmark_v1";
  const [
    coverage,
    gaps,
    modelComparison,
    stability,
    regressions,
    growthAlerts,
    lineage,
    schedule,
    snapshots,
  ] = await Promise.all([
    buildHistoricalLibraryCoverageReport(repository, { top: 6 }),
    buildHistoricalLibraryGapReport(repository),
    buildModelComparisonReport(repository),
    buildBenchmarkStabilityReport(repository, { benchmark_pack_id: benchmarkPackId, limit: 24 }),
    buildBenchmarkRegressionReport(repository, { benchmark_pack_id: benchmarkPackId, limit: 12 }),
    buildGrowthPressureAlertReport(repository, { benchmark_pack_id: benchmarkPackId }),
    buildModelLineageReport(repository),
    resolveEvolutionScheduleConfig(repository),
    repository.listBenchmarkReplaySnapshots(12),
  ]);

  return {
    benchmark_pack_id: benchmarkPackId,
    coverage,
    gaps,
    model_comparison: modelComparison,
    stability,
    regressions,
    growth_alerts: growthAlerts,
    lineage,
    schedule,
    benchmark_history: {
      snapshots,
    },
  };
};

export const buildClaudeReviewPacket = async (
  repository: Repository,
  options: ClaudeReviewPacketOptions = {},
) =>
  renderClaudeReviewPacket(
    await buildClaudeReviewPacketSnapshot(repository, options),
    options,
  );
