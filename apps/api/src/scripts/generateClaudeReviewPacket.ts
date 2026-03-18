import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildClaudeReviewPacketSnapshot,
  renderClaudeReviewPacket,
  type ClaudeReviewPacketSnapshot,
} from "../lib/claudeReviewPacket.js";
import { buildServices } from "../lib/services.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, "..", "..", "..", "..");

const parsePipeList = (value: string | undefined) =>
  (value ?? "")
    .split("|")
    .map((item) => item.trim())
    .filter(Boolean);

const runGit = (args: string[]) => {
  try {
    return execFileSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
};

const outputPath = (() => {
  const configured = process.env.CLAUDE_REVIEW_OUTPUT?.trim();
  return configured ? resolve(repoRoot, configured) : resolve(repoRoot, "CLAUDE_REVIEW_PACKET.md");
})();

const buildApiSnapshot = async (
  baseUrl: string,
  benchmarkPackId: string,
): Promise<ClaudeReviewPacketSnapshot> => {
  const now = new Date().toISOString();
  const fetchJson = async <T>(path: string, fallback: T): Promise<T> => {
    try {
      const response = await fetch(`${baseUrl}${path}`);

      if (!response.ok) {
        return fallback;
      }

      return (await response.json()) as T;
    } catch {
      return fallback;
    }
  };

  const [
    coverage,
    gaps,
    modelComparison,
    stability,
    regressions,
    growthAlerts,
    lineage,
    schedule,
    benchmarkHistory,
  ] = await Promise.all([
    fetchJson("/v1/metrics/historical-library?top=6", {
      generated_at: now,
      total_cases: 0,
      needs_review_count: 0,
      reviewed_cases: 0,
      high_confidence_cases: 0,
      assigned_review_count: 0,
      unassigned_review_count: 0,
      adjudicated_cases: 0,
      case_packs: [],
      event_families: [],
      source_types: [],
      regions: [],
      themes: [],
      horizons: [],
    }),
    fetchJson("/v1/metrics/historical-library/gaps", {
      generated_at: now,
      total_cases: 0,
      quality_counts: {
        draft: 0,
        reviewed: 0,
        high_confidence: 0,
      },
      alerts: [],
    }),
    fetchJson("/v1/metrics/models", {
      generated_at: now,
      versions: [],
      leaders: {
        by_average_total_score: null,
        by_direction_accuracy: null,
        by_calibration_alignment: null,
      },
    }),
    fetchJson(`/v1/metrics/benchmarks/stability?benchmark_pack_id=${encodeURIComponent(benchmarkPackId)}`, {
      generated_at: now,
      benchmark_pack_id: benchmarkPackId,
      sample_count: 0,
      week_count: 0,
      families: [],
      leaders: {
        by_stability_score: null,
        by_resilience: null,
        by_lowest_volatility: null,
      },
    }),
    fetchJson(`/v1/metrics/benchmarks/regressions?benchmark_pack_id=${encodeURIComponent(benchmarkPackId)}`, {
      generated_at: now,
      benchmark_pack_id: benchmarkPackId,
      counts: {
        high: 0,
        medium: 0,
        low: 0,
      },
      alerts: [],
    }),
    fetchJson(`/v1/metrics/evolution/alerts?benchmark_pack_id=${encodeURIComponent(benchmarkPackId)}`, {
      generated_at: now,
      counts: {
        high: 0,
        medium: 0,
        low: 0,
      },
      alerts: [],
    }),
    fetchJson("/v1/metrics/lineage", {
      generated_at: now,
      families: [],
      recent_molts: [],
    }),
    fetchJson("/v1/operations/evolution-schedule", {
      id: "default",
      enabled: false,
      create_postmortems: true,
      capture_calibration_snapshot: true,
      capture_benchmark_snapshot: true,
      benchmark_pack_id: benchmarkPackId,
      run_molt_cycle: true,
      capture_lineage_snapshot: true,
      self_audit_interval_hours: 24,
      benchmark_snapshot_interval_hours: 24,
      molt_interval_hours: 168,
      lineage_snapshot_interval_hours: 24,
      molt_cycle_defaults: {
        case_pack: "macro_plus_v1",
        benchmark_pack_id: benchmarkPackId,
        apply_stability_bias: true,
        thresholds: {
          min_average_total_score_delta: 0.01,
          min_direction_accuracy_delta: 0,
          max_wrong_rate_delta: 0,
          min_calibration_alignment_delta: 0,
        },
        promote_on_pass: true,
        promoted_status: "active",
        max_families: 10,
        min_family_pass_rate: 0.65,
        score_floor: 0.68,
        max_abs_calibration_gap: 0.12,
        trigger_on_declining_trend: true,
        require_pattern_priors: true,
        label_suffix: "Molted",
      },
      next_self_audit_at: null,
      next_benchmark_snapshot_at: null,
      next_molt_at: null,
      next_lineage_snapshot_at: null,
      last_run_at: null,
      last_result: null,
      created_at: now,
      updated_at: now,
    }),
    fetchJson(`/v1/metrics/benchmarks/history?benchmark_pack_id=${encodeURIComponent(benchmarkPackId)}&limit=12`, {
      snapshots: [],
    }),
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
    benchmark_history: benchmarkHistory,
  } as unknown as ClaudeReviewPacketSnapshot;
};

const main = async () => {
  const benchmarkPackId = process.env.CLAUDE_REVIEW_BENCHMARK_PACK_ID?.trim() || "core_benchmark_v1";
  const reviewFocus = parsePipeList(process.env.CLAUDE_REVIEW_FOCUS);
  const reviewQuestions = parsePipeList(process.env.CLAUDE_REVIEW_QUESTIONS);
  const preferredSource = process.env.CLAUDE_REVIEW_SOURCE?.trim() || "auto";
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"]) || null;
  const statusLines = runGit(["status", "--short"])
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const changedFiles = statusLines.map((line) => line.replace(/^[A-Z? ]+\s+/, "").trim());
  const gitContext = {
    branch,
    status_lines: statusLines,
    changed_files: changedFiles,
  };
  const apiBaseUrl = process.env.CLAUDE_REVIEW_BASE_URL?.trim() || "http://localhost:3001";
  const services = buildServices();

  try {
    let snapshotSource: "repository" | "api" = "repository";
    let snapshot;

    if (preferredSource === "api") {
      snapshotSource = "api";
      snapshot = await buildApiSnapshot(apiBaseUrl, benchmarkPackId);
    } else if (preferredSource === "repository") {
      snapshot = await buildClaudeReviewPacketSnapshot(services.repository, {
        benchmark_pack_id: benchmarkPackId,
        review_focus: reviewFocus,
        review_questions: reviewQuestions,
        git_context: gitContext,
      });
    } else {
      try {
        snapshot = await buildClaudeReviewPacketSnapshot(services.repository, {
          benchmark_pack_id: benchmarkPackId,
          review_focus: reviewFocus,
          review_questions: reviewQuestions,
          git_context: gitContext,
        });
      } catch {
        snapshotSource = "api";
        snapshot = await buildApiSnapshot(apiBaseUrl, benchmarkPackId);
      }
    }

    const packet = renderClaudeReviewPacket(snapshot, {
      benchmark_pack_id: benchmarkPackId,
      review_focus: reviewFocus,
      review_questions: reviewQuestions,
      git_context: gitContext,
    });

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, packet, "utf8");

    console.log(
      JSON.stringify(
        {
          output_path: outputPath,
          benchmark_pack_id: benchmarkPackId,
          source: snapshotSource,
          api_base_url: snapshotSource === "api" ? apiBaseUrl : null,
          branch,
          changed_file_count: changedFiles.length,
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await services.repository.close?.();
    } catch {}
    try {
      await services.marketDataProvider.close?.();
    } catch {}
    try {
      await services.embeddingProvider.close?.();
    } catch {}
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
