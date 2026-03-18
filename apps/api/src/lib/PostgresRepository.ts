import { randomUUID } from "node:crypto";

import { Pool } from "pg";
import {
  storedEventSchema,
  storedPredictionSchema,
  storedSourceSchema,
} from "@finance-superbrain/schemas";
import type {
  BenchmarkReplaySnapshot,
  BenchmarkTrustRefreshRecord,
  CalibrationSnapshot,
  CreateTranscriptChunkRequest,
  CreateTranscriptSessionRequest,
  CreateModelVersionRequest,
  CreateSourceRequest,
  EvolutionScheduleConfig,
  GrowthPressureActionPlan,
  GrowthPressurePolicy,
  HistoricalCaseLibraryItem,
  JsonValue,
  LineageSnapshot,
  Lesson,
  LiveTranscriptProvider,
  OperationJobRecord,
  OperationLeaseRecord,
  SystemIntegrationProbeState,
  SystemIntegrationGovernanceState,
  OperationWorkerEventRecord,
  OperationWorkerRecord,
  OperationWorkerServiceEventRecord,
  OperationWorkerServiceRecord,
  OperationRunRecord,
  Postmortem,
  PredictionOutcome,
  StoredGrowthPressureAlert,
  StoredModelVersion,
  StoredEvent,
  StoredPrediction,
  StoredPromotionEvaluation,
  StoredSource,
  StoredTranscriptChunk,
  StoredTranscriptSession,
  TranscriptStreamBinding,
  TranscriptStreamBuffer,
  TranscriptSessionAnalysis,
  WalkForwardReplaySnapshot,
} from "@finance-superbrain/schemas";

import type {
  OperationIntegrationTrendSummaryBucket,
  OperationIntegrationQueueSummary,
  OperationWorkerEventSummaryBucket,
  OperationWorkerServiceEventSummaryBucket,
  PendingPredictionRecord,
  PredictionLearningRecord,
  Repository,
} from "./repository.types.js";
import { normalizeEmbedding } from "./LocalEmbeddingProvider.js";

type DbRow = Record<string, unknown>;

const toNumber = (value: unknown) => Number(value);

const parseJsonArray = <T>(value: unknown, fallback: T[]): T[] => {
  if (Array.isArray(value)) {
    return value as T[];
  }

  if (typeof value === "string") {
    return JSON.parse(value) as T[];
  }

  return fallback;
};

const parseJsonObject = <T extends object>(value: unknown, fallback: T): T => {
  if (value && typeof value === "object") {
    return value as T;
  }

  if (typeof value === "string") {
    return JSON.parse(value) as T;
  }

  return fallback;
};

const toNullableIsoString = (value: unknown) =>
  value === null || value === undefined ? null : new Date(String(value)).toISOString();

const mapSourceRow = (row: DbRow): StoredSource =>
  storedSourceSchema.parse({
    id: row.id,
    source_type: row.source_type,
    title: row.title ?? undefined,
    speaker: row.speaker ?? undefined,
    publisher: row.publisher ?? undefined,
    raw_uri: row.raw_uri ?? undefined,
    occurred_at: row.occurred_at ? new Date(String(row.occurred_at)).toISOString() : undefined,
    raw_text: row.raw_text,
    created_at: new Date(String(row.received_at)).toISOString(),
  });

const mapEventRow = (row: DbRow): StoredEvent => {
  const extracted = parseJsonObject(row.extracted, {
    entities: [],
    themes: [],
    candidate_assets: [],
    why_it_matters: [],
  });

  return storedEventSchema.parse({
    id: row.id,
    source_id: row.source_id,
    event_class: row.event_class,
    summary: row.summary,
    sentiment: row.sentiment,
    urgency_score: toNumber(row.urgency_score),
    novelty_score: toNumber(row.novelty_score),
    entities: parseJsonArray(extracted.entities, []),
    themes: parseJsonArray(extracted.themes, []),
    candidate_assets: parseJsonArray(extracted.candidate_assets, []),
    why_it_matters: parseJsonArray(extracted.why_it_matters, []),
    created_at: new Date(String(row.created_at)).toISOString(),
  });
};

const mapPredictionRow = (row: DbRow, assetRows: DbRow[]): StoredPrediction =>
  storedPredictionSchema.parse({
    id: row.id,
    event_id: row.event_id,
    model_version: row.model_version,
    horizon: row.horizon,
    status: row.status,
    thesis: row.thesis,
    confidence: toNumber(row.confidence),
    evidence: parseJsonArray(row.evidence, []),
    invalidations: parseJsonArray(row.invalidations, []),
    assumptions: parseJsonArray(row.assumptions, []),
    assets: assetRows
      .sort((left, right) => Number(left.rank_order) - Number(right.rank_order))
      .map((assetRow) => ({
        ticker: String(assetRow.ticker),
        expected_direction: assetRow.expected_direction as StoredPrediction["assets"][number]["expected_direction"],
        expected_magnitude_bp: Number(assetRow.expected_magnitude_bp),
        conviction: toNumber(assetRow.conviction),
      })),
    created_at: new Date(String(row.created_at)).toISOString(),
  });

const mapOutcomeRow = (row: DbRow): PredictionOutcome => {
  const payload = parseJsonObject(row.outcome_payload, {
    realized_moves: [],
    timing_alignment: 0.75,
    dominant_catalyst: undefined,
  });

  return {
    id: String(row.id),
    prediction_id: String(row.prediction_id),
    horizon: row.horizon as PredictionOutcome["horizon"],
    measured_at: new Date(String(row.measured_at)).toISOString(),
    outcome_payload: {
      realized_moves: parseJsonArray(payload.realized_moves, []),
      timing_alignment: toNumber(payload.timing_alignment),
      dominant_catalyst:
        typeof payload.dominant_catalyst === "string" ? payload.dominant_catalyst : undefined,
    },
    direction_score: toNumber(row.direction_score),
    magnitude_score: toNumber(row.magnitude_score),
    timing_score: toNumber(row.timing_score),
    calibration_score: toNumber(row.calibration_score),
    total_score: toNumber(row.total_score),
    created_at: new Date(String(row.created_at)).toISOString(),
  };
};

const mapPostmortemRow = (row: DbRow): Postmortem => ({
  id: String(row.id),
  prediction_id: String(row.prediction_id),
  verdict: row.verdict as Postmortem["verdict"],
  failure_tags: parseJsonArray(row.failure_tags, []),
  critique: String(row.critique),
  lesson_summary: String(row.lesson_summary),
  created_at: new Date(String(row.created_at)).toISOString(),
});

const mapLessonRow = (row: DbRow): Lesson => ({
  id: String(row.id),
  prediction_id: String(row.prediction_id),
  lesson_type: row.lesson_type as Lesson["lesson_type"],
  lesson_summary: String(row.lesson_summary),
  metadata: parseJsonObject(row.metadata, {}),
  created_at: new Date(String(row.created_at)).toISOString(),
});

const mapHistoricalCaseLibraryRow = (row: DbRow): HistoricalCaseLibraryItem => ({
  case_id: String(row.case_id),
  case_pack: String(row.case_pack),
  source: parseJsonObject(row.source, {
    source_type: "headline",
    raw_text: "",
  }) as HistoricalCaseLibraryItem["source"],
  horizon: row.horizon as HistoricalCaseLibraryItem["horizon"],
  realized_moves: parseJsonArray(row.realized_moves, []),
  timing_alignment: toNumber(row.timing_alignment),
  dominant_catalyst: String(row.dominant_catalyst),
  parsed_event: parseJsonObject(row.parsed_event, {
    event_class: "market_commentary",
    summary: "",
    sentiment: "neutral",
    urgency_score: 0,
    novelty_score: 0,
    entities: [],
    themes: [],
    candidate_assets: [],
    why_it_matters: [],
  }) as HistoricalCaseLibraryItem["parsed_event"],
  labels: parseJsonObject(row.labels, {
    event_family: null,
    tags: [],
    regimes: [],
    regions: [],
    sectors: [],
    primary_themes: [],
    primary_assets: [],
    competing_catalysts: [],
    surprise_type: "none",
    case_quality: "reviewed",
    label_source: "hybrid",
    notes: null,
  }) as HistoricalCaseLibraryItem["labels"],
  review: parseJsonObject(row.review, {
    review_hints: [],
    reviewer: null,
    review_notes: null,
    reviewed_at: null,
    adjudicated_at: null,
  }) as HistoricalCaseLibraryItem["review"],
  created_at: new Date(String(row.created_at)).toISOString(),
  updated_at: new Date(String(row.updated_at)).toISOString(),
});

const mapCalibrationSnapshotRow = (row: DbRow): CalibrationSnapshot => ({
  id: String(row.id),
  as_of: new Date(String(row.as_of)).toISOString(),
  sample_count: Number(row.sample_count),
  average_total_score: toNumber(row.average_total_score),
  report: parseJsonObject(row.report, {
    sample_count: 0,
    average_total_score: 0,
    horizons: [],
  }) as CalibrationSnapshot["report"],
  created_at: new Date(String(row.created_at)).toISOString(),
});

const mapLineageSnapshotRow = (row: DbRow): LineageSnapshot => ({
  id: String(row.id),
  as_of: new Date(String(row.as_of)).toISOString(),
  family_count: Number(row.family_count),
  total_shells: Number(row.total_shells),
  hardened_shells: Number(row.hardened_shells),
  report: parseJsonObject(row.report, {
    generated_at: new Date().toISOString(),
    families: [],
    recent_molts: [],
  }) as LineageSnapshot["report"],
  created_at: new Date(String(row.created_at)).toISOString(),
});

const mapBenchmarkReplaySnapshotRow = (row: DbRow): BenchmarkReplaySnapshot => ({
  id: String(row.id),
  as_of: new Date(String(row.as_of)).toISOString(),
  benchmark_pack_id: String(row.benchmark_pack_id),
  selected_case_count: Number(row.selected_case_count),
  family_count: Number(row.family_count),
  report: parseJsonObject(row.report, {
    pack_id: String(row.benchmark_pack_id),
    label: String(row.benchmark_pack_id),
    description: "",
    selected_case_count: Number(row.selected_case_count),
    quotas_met: false,
    domain_counts: [],
    selected_case_ids: [],
    model_count: 0,
    family_count: Number(row.family_count),
    leaders: {
      by_average_total_score: null,
      by_direction_accuracy: null,
      by_calibration_alignment: null,
    },
    models: [],
    families: [],
  }) as BenchmarkReplaySnapshot["report"],
  created_at: new Date(String(row.created_at)).toISOString(),
});

const mapWalkForwardReplaySnapshotRow = (row: DbRow): WalkForwardReplaySnapshot => ({
  id: String(row.id),
  as_of: new Date(String(row.as_of)).toISOString(),
  benchmark_pack_id: String(row.benchmark_pack_id),
  eligible_case_count: Number(row.eligible_case_count),
  window_count: Number(row.window_count),
  family_count: Number(row.family_count),
  report: parseJsonObject(row.report, {
    benchmark_pack_id: String(row.benchmark_pack_id),
    training_mode: "expanding",
    min_train_cases: 0,
    test_window_size: 0,
    step_size: 0,
    eligible_case_count: Number(row.eligible_case_count),
    undated_case_count: 0,
    first_eligible_occurred_at: null,
    last_eligible_occurred_at: null,
    window_count: Number(row.window_count),
    model_count: 0,
    family_count: Number(row.family_count),
    leaders: {
      by_average_total_score: null,
      by_direction_accuracy: null,
      by_calibration_alignment: null,
    },
    warnings: [],
    models: [],
    families: [],
    regimes: [],
  }) as WalkForwardReplaySnapshot["report"],
  created_at: new Date(String(row.created_at)).toISOString(),
});

const mapBenchmarkTrustRefreshRow = (row: DbRow): BenchmarkTrustRefreshRecord => ({
  id: String(row.id),
  generated_at: new Date(String(row.generated_at)).toISOString(),
  benchmark_pack_id: String(row.benchmark_pack_id),
  seed: parseJsonObject(row.seed, {
    generated_at: new Date().toISOString(),
    reviewer: "core-corpus-seed",
    dry_run: false,
    scanned_reviewed_cases: 0,
    candidate_count: 0,
    promoted_count: 0,
    skipped_count: 0,
    min_candidate_score: 0.8,
    case_pack_filters: [],
    prioritized_regimes: [],
    promoted_regimes: [],
    items: [],
  }) as BenchmarkTrustRefreshRecord["seed"],
  before: parseJsonObject(row.before_summary, {
    high_confidence_cases: 0,
    reviewed_cases: 0,
    needs_review_count: 0,
    selected_case_count: 0,
    quotas_met: false,
    warning_count: 0,
    high_warning_count: 0,
  }) as BenchmarkTrustRefreshRecord["before"],
  after: parseJsonObject(row.after_summary, {
    high_confidence_cases: 0,
    reviewed_cases: 0,
    needs_review_count: 0,
    selected_case_count: 0,
    quotas_met: false,
    warning_count: 0,
    high_warning_count: 0,
  }) as BenchmarkTrustRefreshRecord["after"],
  delta: parseJsonObject(row.delta, {
    high_confidence_cases: 0,
    warning_count: 0,
    high_warning_count: 0,
    selected_case_count: 0,
  }) as BenchmarkTrustRefreshRecord["delta"],
  benchmark_snapshot_id:
    typeof row.benchmark_snapshot_id === "string" ? row.benchmark_snapshot_id : null,
  benchmark_snapshot_case_count:
    row.benchmark_snapshot_case_count === null || row.benchmark_snapshot_case_count === undefined
      ? null
      : Number(row.benchmark_snapshot_case_count),
  benchmark_snapshot_family_count:
    row.benchmark_snapshot_family_count === null || row.benchmark_snapshot_family_count === undefined
      ? null
      : Number(row.benchmark_snapshot_family_count),
  created_at: new Date(String(row.created_at)).toISOString(),
});

const mapOperationRunRow = (row: DbRow): OperationRunRecord => ({
  id: String(row.id),
  operation_name: row.operation_name as OperationRunRecord["operation_name"],
  status: row.status as OperationRunRecord["status"],
  triggered_by: row.triggered_by as OperationRunRecord["triggered_by"],
  started_at: new Date(String(row.started_at)).toISOString(),
  finished_at: new Date(String(row.finished_at)).toISOString(),
  duration_ms: Number(row.duration_ms),
  metadata: parseJsonObject(row.metadata, {}),
  summary: parseJsonObject(row.summary, {}),
  error_message: typeof row.error_message === "string" ? row.error_message : null,
  created_at: new Date(String(row.created_at)).toISOString(),
});

const mapOperationLeaseRow = (row: DbRow): OperationLeaseRecord => ({
  operation_name: row.operation_name as OperationLeaseRecord["operation_name"],
  scope_key: String(row.scope_key),
  owner: String(row.owner),
  acquired_at: new Date(String(row.acquired_at)).toISOString(),
  expires_at: new Date(String(row.expires_at)).toISOString(),
  updated_at: new Date(String(row.updated_at)).toISOString(),
});

const mapOperationJobRow = (row: DbRow): OperationJobRecord => ({
  id: String(row.id),
  operation_name: row.operation_name as OperationJobRecord["operation_name"],
  status: row.status as OperationJobRecord["status"],
  triggered_by: row.triggered_by as OperationJobRecord["triggered_by"],
  payload: parseJsonObject(row.payload, {}),
  idempotency_key: typeof row.idempotency_key === "string" ? row.idempotency_key : null,
  max_attempts: Number(row.max_attempts),
  attempt_count: Number(row.attempt_count),
  available_at: new Date(String(row.available_at)).toISOString(),
  lease_owner: typeof row.lease_owner === "string" ? row.lease_owner : null,
  lease_expires_at: row.lease_expires_at ? new Date(String(row.lease_expires_at)).toISOString() : null,
  started_at: row.started_at ? new Date(String(row.started_at)).toISOString() : null,
  finished_at: row.finished_at ? new Date(String(row.finished_at)).toISOString() : null,
  result_summary: parseJsonObject(row.result_summary, {}),
  error_message: typeof row.error_message === "string" ? row.error_message : null,
  created_at: new Date(String(row.created_at)).toISOString(),
  updated_at: new Date(String(row.updated_at)).toISOString(),
});

const mapOperationWorkerRow = (row: DbRow): OperationWorkerRecord => ({
  worker_id: String(row.worker_id),
  lifecycle_state: row.lifecycle_state as OperationWorkerRecord["lifecycle_state"],
  supported_operations: parseJsonArray(row.supported_operations, []),
  poll_interval_ms:
    row.poll_interval_ms === null || row.poll_interval_ms === undefined
      ? null
      : Number(row.poll_interval_ms),
  idle_backoff_ms:
    row.idle_backoff_ms === null || row.idle_backoff_ms === undefined
      ? null
      : Number(row.idle_backoff_ms),
  started_at: new Date(String(row.started_at)).toISOString(),
  last_heartbeat_at: new Date(String(row.last_heartbeat_at)).toISOString(),
  last_cycle_started_at: toNullableIsoString(row.last_cycle_started_at),
  last_cycle_finished_at: toNullableIsoString(row.last_cycle_finished_at),
  last_cycle_processed:
    row.last_cycle_processed === null || row.last_cycle_processed === undefined
      ? null
      : Number(row.last_cycle_processed),
  last_cycle_completed:
    row.last_cycle_completed === null || row.last_cycle_completed === undefined
      ? null
      : Number(row.last_cycle_completed),
  last_cycle_failed:
    row.last_cycle_failed === null || row.last_cycle_failed === undefined
      ? null
      : Number(row.last_cycle_failed),
  last_cycle_retried:
    row.last_cycle_retried === null || row.last_cycle_retried === undefined
      ? null
      : Number(row.last_cycle_retried),
  last_cycle_abandoned:
    row.last_cycle_abandoned === null || row.last_cycle_abandoned === undefined
      ? null
      : Number(row.last_cycle_abandoned),
  total_cycles: Number(row.total_cycles ?? 0),
  total_processed: Number(row.total_processed ?? 0),
  total_completed: Number(row.total_completed ?? 0),
  total_failed: Number(row.total_failed ?? 0),
  total_retried: Number(row.total_retried ?? 0),
  total_abandoned: Number(row.total_abandoned ?? 0),
  last_error_message: typeof row.last_error_message === "string" ? row.last_error_message : null,
  stopped_at: toNullableIsoString(row.stopped_at),
  updated_at: new Date(String(row.updated_at)).toISOString(),
});

const mapOperationWorkerServiceRow = (row: DbRow): OperationWorkerServiceRecord => ({
  service_id: String(row.service_id),
  worker_id: String(row.worker_id),
  lifecycle_state: row.lifecycle_state as OperationWorkerServiceRecord["lifecycle_state"],
  supported_operations: parseJsonArray(row.supported_operations, []),
  supervisor_pid:
    row.supervisor_pid === null || row.supervisor_pid === undefined
      ? null
      : Number(row.supervisor_pid),
  supervisor_host:
    row.supervisor_host === null || row.supervisor_host === undefined
      ? null
      : String(row.supervisor_host),
  supervisor_instance_id:
    row.supervisor_instance_id === null || row.supervisor_instance_id === undefined
      ? null
      : String(row.supervisor_instance_id),
  invocation_mode:
    row.invocation_mode === null || row.invocation_mode === undefined
      ? null
      : String(row.invocation_mode),
  supervisor_backoff_ms: Number(row.supervisor_backoff_ms),
  success_window_ms: Number(row.success_window_ms),
  heartbeat_interval_ms: Number(row.heartbeat_interval_ms),
  max_restarts: Number(row.max_restarts),
  restart_count: Number(row.restart_count),
  restart_streak: Number(row.restart_streak),
  current_restart_backoff_ms:
    row.current_restart_backoff_ms === null || row.current_restart_backoff_ms === undefined
      ? null
      : Number(row.current_restart_backoff_ms),
  started_at: new Date(String(row.started_at)).toISOString(),
  last_heartbeat_at: new Date(String(row.last_heartbeat_at)).toISOString(),
  last_loop_started_at: toNullableIsoString(row.last_loop_started_at),
  last_loop_finished_at: toNullableIsoString(row.last_loop_finished_at),
  last_loop_runtime_ms:
    row.last_loop_runtime_ms === null || row.last_loop_runtime_ms === undefined
      ? null
      : Number(row.last_loop_runtime_ms),
  last_exit_code:
    row.last_exit_code === null || row.last_exit_code === undefined
      ? null
      : Number(row.last_exit_code),
  last_exit_signal:
    row.last_exit_signal === null || row.last_exit_signal === undefined
      ? null
      : String(row.last_exit_signal),
  last_error_message:
    row.last_error_message === null || row.last_error_message === undefined
      ? null
      : String(row.last_error_message),
  stopped_at: toNullableIsoString(row.stopped_at),
  updated_at: new Date(String(row.updated_at)).toISOString(),
});

const mapOperationWorkerEventRow = (row: DbRow): OperationWorkerEventRecord => ({
  id: String(row.id),
  worker_id: String(row.worker_id),
  event_type: row.event_type as OperationWorkerEventRecord["event_type"],
  occurred_at: new Date(String(row.occurred_at)).toISOString(),
  lifecycle_state:
    row.lifecycle_state === null || row.lifecycle_state === undefined
      ? null
      : (row.lifecycle_state as OperationWorkerEventRecord["lifecycle_state"]),
  cycle_processed:
    row.cycle_processed === null || row.cycle_processed === undefined
      ? null
      : Number(row.cycle_processed),
  cycle_completed:
    row.cycle_completed === null || row.cycle_completed === undefined
      ? null
      : Number(row.cycle_completed),
  cycle_failed:
    row.cycle_failed === null || row.cycle_failed === undefined
      ? null
      : Number(row.cycle_failed),
  cycle_retried:
    row.cycle_retried === null || row.cycle_retried === undefined
      ? null
      : Number(row.cycle_retried),
  cycle_abandoned:
    row.cycle_abandoned === null || row.cycle_abandoned === undefined
      ? null
      : Number(row.cycle_abandoned),
  error_message:
    row.error_message === null || row.error_message === undefined ? null : String(row.error_message),
  metadata: parseJsonObject(row.metadata, {}),
  created_at: new Date(String(row.created_at)).toISOString(),
});

const mapOperationWorkerServiceEventRow = (row: DbRow): OperationWorkerServiceEventRecord => ({
  id: String(row.id),
  service_id: String(row.service_id),
  worker_id: String(row.worker_id),
  event_type: row.event_type as OperationWorkerServiceEventRecord["event_type"],
  occurred_at: new Date(String(row.occurred_at)).toISOString(),
  lifecycle_state:
    row.lifecycle_state === null || row.lifecycle_state === undefined
      ? null
      : (row.lifecycle_state as OperationWorkerServiceEventRecord["lifecycle_state"]),
  scheduled_restart:
    row.scheduled_restart === null || row.scheduled_restart === undefined
      ? null
      : Boolean(row.scheduled_restart),
  restart_count:
    row.restart_count === null || row.restart_count === undefined
      ? null
      : Number(row.restart_count),
  restart_streak:
    row.restart_streak === null || row.restart_streak === undefined
      ? null
      : Number(row.restart_streak),
  loop_runtime_ms:
    row.loop_runtime_ms === null || row.loop_runtime_ms === undefined
      ? null
      : Number(row.loop_runtime_ms),
  exit_code:
    row.exit_code === null || row.exit_code === undefined ? null : Number(row.exit_code),
  exit_signal:
    row.exit_signal === null || row.exit_signal === undefined ? null : String(row.exit_signal),
  error_message:
    row.error_message === null || row.error_message === undefined
      ? null
      : String(row.error_message),
  metadata: parseJsonObject(row.metadata, {}),
  created_at: new Date(String(row.created_at)).toISOString(),
});

const mapSystemIntegrationGovernanceStateRow = (
  row: DbRow,
): SystemIntegrationGovernanceState => ({
  integration: row.integration as SystemIntegrationGovernanceState["integration"],
  operation_name: row.operation_name as SystemIntegrationGovernanceState["operation_name"],
  action: row.action as SystemIntegrationGovernanceState["action"],
  highest_probe_status:
    row.highest_probe_status as SystemIntegrationGovernanceState["highest_probe_status"],
  configured_targets: Number(row.configured_targets ?? 0),
  ready_targets: Number(row.ready_targets ?? 0),
  degraded_targets: Number(row.degraded_targets ?? 0),
  unknown_targets: Number(row.unknown_targets ?? 0),
  recent_retry_scheduled: Number(row.recent_retry_scheduled ?? 0),
  recent_non_retryable_failures: Number(row.recent_non_retryable_failures ?? 0),
  recent_stale_recovered: Number(row.recent_stale_recovered ?? 0),
  recent_trend_signal:
    row.recent_trend_signal as SystemIntegrationGovernanceState["recent_trend_signal"],
  degraded_since:
    row.degraded_since === null || row.degraded_since === undefined
      ? null
      : new Date(String(row.degraded_since)).toISOString(),
  outage_since:
    row.outage_since === null || row.outage_since === undefined
      ? null
      : new Date(String(row.outage_since)).toISOString(),
  hold_until:
    row.hold_until === null || row.hold_until === undefined
      ? null
      : new Date(String(row.hold_until)).toISOString(),
  retry_delay_seconds:
    row.retry_delay_seconds === null || row.retry_delay_seconds === undefined
      ? null
      : Number(row.retry_delay_seconds),
  reason: String(row.reason ?? ""),
  detail: String(row.detail ?? ""),
  checked_at: new Date(String(row.checked_at)).toISOString(),
  updated_at: new Date(String(row.updated_at)).toISOString(),
});

const mapSystemIntegrationProbeStateRow = (
  row: DbRow,
): SystemIntegrationProbeState => ({
  integration: row.integration as SystemIntegrationProbeState["integration"],
  timeout_ms: Number(row.timeout_ms ?? 0),
  configured_targets: Number(row.configured_targets ?? 0),
  ready_targets: Number(row.ready_targets ?? 0),
  degraded_targets: Number(row.degraded_targets ?? 0),
  unknown_targets: Number(row.unknown_targets ?? 0),
  highest_status: row.highest_status as SystemIntegrationProbeState["highest_status"],
  targets: parseJsonArray(row.targets, []) as SystemIntegrationProbeState["targets"],
  checked_at: new Date(String(row.checked_at)).toISOString(),
  updated_at: new Date(String(row.updated_at)).toISOString(),
});

const mapEvolutionScheduleConfigRow = (row: DbRow): EvolutionScheduleConfig => ({
  id: String(row.id),
  enabled: Boolean(row.enabled),
  create_postmortems: Boolean(row.create_postmortems),
  capture_calibration_snapshot: Boolean(row.capture_calibration_snapshot),
  capture_benchmark_snapshot: Boolean(row.capture_benchmark_snapshot),
  capture_walk_forward_snapshot: Boolean(row.capture_walk_forward_snapshot ?? true),
  benchmark_pack_id: String(row.benchmark_pack_id ?? "core_benchmark_v1"),
  run_benchmark_trust_refresh: Boolean(row.run_benchmark_trust_refresh ?? true),
  run_molt_cycle: Boolean(row.run_molt_cycle),
  capture_lineage_snapshot: Boolean(row.capture_lineage_snapshot),
  self_audit_interval_hours: Number(row.self_audit_interval_hours),
  benchmark_snapshot_interval_hours: Number(row.benchmark_snapshot_interval_hours ?? 24),
  walk_forward_snapshot_interval_hours: Number(
    row.walk_forward_snapshot_interval_hours ?? 24 * 7,
  ),
  benchmark_trust_refresh_interval_hours: Number(
    row.benchmark_trust_refresh_interval_hours ?? 24 * 7,
  ),
  molt_interval_hours: Number(row.molt_interval_hours),
  lineage_snapshot_interval_hours: Number(row.lineage_snapshot_interval_hours),
  walk_forward_defaults: parseJsonObject(row.walk_forward_defaults, {
    benchmark_pack_id: "core_benchmark_v1",
    allowed_case_qualities: ["reviewed", "high_confidence"],
    training_mode: "expanding",
    min_train_cases: 10,
    test_window_size: 5,
    seed_training_memory: true,
    training_memory_model_version: "walk-forward-memory-v1",
  }) as EvolutionScheduleConfig["walk_forward_defaults"],
  trust_refresh_defaults: parseJsonObject(row.trust_refresh_defaults, {
    benchmark_pack_id: "core_benchmark_v1",
    reviewer: "core-corpus-seed",
    prioritize_gap_regimes: true,
    prioritize_walk_forward_regimes: true,
    seed_limit: 10,
    min_candidate_score: 0.8,
    dry_run: false,
    ingest_reviewed_memory: false,
    model_version: "historical-library-high-confidence-v1",
    strict_quotas: false,
  }) as EvolutionScheduleConfig["trust_refresh_defaults"],
  molt_cycle_defaults: parseJsonObject(row.molt_cycle_defaults, {
    case_pack: "macro_plus_v1",
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
  }) as EvolutionScheduleConfig["molt_cycle_defaults"],
  next_self_audit_at: row.next_self_audit_at
    ? new Date(String(row.next_self_audit_at)).toISOString()
    : null,
  next_benchmark_snapshot_at: row.next_benchmark_snapshot_at
    ? new Date(String(row.next_benchmark_snapshot_at)).toISOString()
    : null,
  next_walk_forward_snapshot_at: row.next_walk_forward_snapshot_at
    ? new Date(String(row.next_walk_forward_snapshot_at)).toISOString()
    : null,
  next_benchmark_trust_refresh_at: row.next_benchmark_trust_refresh_at
    ? new Date(String(row.next_benchmark_trust_refresh_at)).toISOString()
    : null,
  next_molt_at: row.next_molt_at ? new Date(String(row.next_molt_at)).toISOString() : null,
  next_lineage_snapshot_at: row.next_lineage_snapshot_at
    ? new Date(String(row.next_lineage_snapshot_at)).toISOString()
    : null,
  last_run_at: row.last_run_at ? new Date(String(row.last_run_at)).toISOString() : null,
  last_result: row.last_result
      ? parseJsonObject(row.last_result, {
        ran_self_audit: false,
        ran_benchmark_trust_refresh: false,
        captured_benchmark_snapshot: false,
        captured_walk_forward_snapshot: false,
        ran_molt_cycle: false,
        captured_lineage_snapshot: false,
        processed_predictions: 0,
        seeded_high_confidence_cases: 0,
        benchmark_trust_warning_delta: 0,
        benchmark_snapshot_case_count: 0,
        benchmark_snapshot_family_count: 0,
        walk_forward_window_count: 0,
        walk_forward_snapshot_family_count: 0,
        hardened_shells: 0,
        held_shells: 0,
        lineage_family_count: 0,
        open_growth_alerts: 0,
        planned_growth_actions: 0,
        executed_growth_actions: 0,
      })
    : null,
  created_at: new Date(String(row.created_at)).toISOString(),
  updated_at: new Date(String(row.updated_at)).toISOString(),
});

const mapGrowthPressurePolicyRow = (row: DbRow): GrowthPressurePolicy => ({
  family: String(row.family),
  enabled: Boolean(row.enabled),
  thresholds: parseJsonObject(row.thresholds, {
    low_pass_rate: 0.6,
    medium_pass_rate: 0.52,
    high_pass_rate: 0.45,
    low_average_total_score: 0.65,
    medium_average_total_score: 0.6,
    high_average_total_score: 0.55,
    medium_abs_calibration_gap: 0.1,
    high_abs_calibration_gap: 0.14,
    pass_rate_delta_decline: -0.15,
  }) as GrowthPressurePolicy["thresholds"],
  persistence: parseJsonObject(row.persistence, {
    medium_persistent_cycles: 2,
    high_persistent_cycles: 2,
    candidate_generation_cycles: 3,
  }) as GrowthPressurePolicy["persistence"],
  actions: parseJsonObject(row.actions, {
    diagnostics_case_pack: "macro_plus_v1",
    auto_queue_diagnostics: true,
    auto_schedule_molt_review: true,
    require_operator_approval_for_candidate_generation: true,
  }) as GrowthPressurePolicy["actions"],
  created_at: new Date(String(row.created_at)).toISOString(),
  updated_at: new Date(String(row.updated_at)).toISOString(),
});

const mapGrowthPressureAlertRow = (row: DbRow): StoredGrowthPressureAlert => ({
  id: String(row.id),
  family: String(row.family),
  policy_family: String(row.policy_family),
  severity: row.severity as StoredGrowthPressureAlert["severity"],
  status: row.status as StoredGrowthPressureAlert["status"],
  active_model_version:
    typeof row.active_model_version === "string" ? row.active_model_version : null,
  generation_depth: Number(row.generation_depth),
  pass_rate: row.pass_rate === null ? null : toNumber(row.pass_rate),
  average_total_score:
    row.average_total_score === null ? null : toNumber(row.average_total_score),
  calibration_gap: row.calibration_gap === null ? null : toNumber(row.calibration_gap),
  trend_signal: row.trend_signal as StoredGrowthPressureAlert["trend_signal"],
  persistence_count: Number(row.persistence_count),
  first_triggered_at: new Date(String(row.first_triggered_at)).toISOString(),
  last_triggered_at: new Date(String(row.last_triggered_at)).toISOString(),
  snoozed_until: row.snoozed_until ? new Date(String(row.snoozed_until)).toISOString() : null,
  acknowledged_at: row.acknowledged_at
    ? new Date(String(row.acknowledged_at)).toISOString()
    : null,
  handled_at: row.handled_at ? new Date(String(row.handled_at)).toISOString() : null,
  resolved_at: row.resolved_at ? new Date(String(row.resolved_at)).toISOString() : null,
  planned_action:
    typeof row.last_planned_action === "string"
      ? (row.last_planned_action as StoredGrowthPressureAlert["planned_action"])
      : null,
  plan_status:
    typeof row.last_plan_status === "string"
      ? (row.last_plan_status as StoredGrowthPressureAlert["plan_status"])
      : null,
  signals: parseJsonArray(row.signals, []),
  recommended_action: String(row.recommended_action),
  created_at: new Date(String(row.created_at)).toISOString(),
  updated_at: new Date(String(row.updated_at)).toISOString(),
});

const mapGrowthPressureActionPlanRow = (row: DbRow): GrowthPressureActionPlan => ({
  id: String(row.id),
  alert_id: String(row.alert_id),
  family: String(row.family),
  active_model_version:
    typeof row.active_model_version === "string" ? row.active_model_version : null,
  action_type: row.action_type as GrowthPressureActionPlan["action_type"],
  status: row.status as GrowthPressureActionPlan["status"],
  requires_operator_approval: Boolean(row.requires_operator_approval),
  rationale: String(row.rationale),
  payload: parseJsonObject(row.payload, {}),
  result: row.result ? parseJsonObject(row.result, {}) : null,
  candidate_model_version:
    typeof row.candidate_model_version === "string" ? row.candidate_model_version : null,
  operator_note: typeof row.operator_note === "string" ? row.operator_note : null,
  approved_at: row.approved_at ? new Date(String(row.approved_at)).toISOString() : null,
  blocked_at: row.blocked_at ? new Date(String(row.blocked_at)).toISOString() : null,
  executed_at: row.executed_at ? new Date(String(row.executed_at)).toISOString() : null,
  created_at: new Date(String(row.created_at)).toISOString(),
  updated_at: new Date(String(row.updated_at)).toISOString(),
});

const mapModelVersionRow = (row: DbRow): StoredModelVersion => ({
  model_version: String(row.model_version),
  family: String(row.family),
  label: typeof row.label === "string" ? row.label : undefined,
  description: typeof row.description === "string" ? row.description : undefined,
  owner: typeof row.owner === "string" ? row.owner : undefined,
  prompt_profile: typeof row.prompt_profile === "string" ? row.prompt_profile : undefined,
  status: row.status as StoredModelVersion["status"],
  feature_flags: parseJsonObject(row.feature_flags, {}),
  created_at: new Date(String(row.created_at)).toISOString(),
});

const mapPromotionEvaluationRow = (row: DbRow): StoredPromotionEvaluation => ({
  id: String(row.id),
  candidate_model_version: String(row.candidate_model_version),
  baseline_model_version: String(row.baseline_model_version),
  case_pack: String(row.case_pack),
  case_count: Number(row.case_count),
  passed: Boolean(row.passed),
  reasons: parseJsonArray(row.reasons, []),
  deltas: parseJsonObject(row.deltas, {
    average_total_score: 0,
    direction_accuracy: 0,
    wrong_rate: 0,
    calibration_alignment: 0,
  }),
  thresholds: parseJsonObject(row.thresholds, {
    min_average_total_score_delta: 0.01,
    min_direction_accuracy_delta: 0,
    max_wrong_rate_delta: 0,
    min_calibration_alignment_delta: 0,
  }),
  baseline: parseJsonObject(row.baseline, {
    model_version: "",
    case_count: 0,
    average_confidence: 0,
    average_total_score: 0,
    direction_accuracy: 0,
    calibration_gap: 0,
    correct_rate: 0,
    partial_rate: 0,
    wrong_rate: 0,
    by_theme: [],
    by_source_type: [],
    by_horizon: [],
  }) as StoredPromotionEvaluation["baseline"],
  candidate: parseJsonObject(row.candidate, {
    model_version: "",
    case_count: 0,
    average_confidence: 0,
    average_total_score: 0,
    direction_accuracy: 0,
    calibration_gap: 0,
    correct_rate: 0,
    partial_rate: 0,
    wrong_rate: 0,
    by_theme: [],
    by_source_type: [],
    by_horizon: [],
  }) as StoredPromotionEvaluation["candidate"],
  walk_forward: row.walk_forward
    ? (parseJsonObject(row.walk_forward, {
        benchmark_pack_id: "",
        window_count: 0,
        eligible_case_count: 0,
        eligible_regime_count: 0,
        eligible_high_confidence_case_count: 0,
        depth_requirements_met: false,
        passed: false,
        reasons: [],
        deltas: {
          average_total_score: 0,
          direction_accuracy: 0,
          wrong_rate: 0,
          calibration_alignment: 0,
        },
        depth_requirements: {
          min_window_count: 2,
          min_eligible_case_count: 12,
          min_regime_count: 3,
          min_high_confidence_case_count: 0,
        },
        thresholds: {
          min_average_total_score_delta: 0,
          min_direction_accuracy_delta: 0,
          max_wrong_rate_delta: 0,
          min_calibration_alignment_delta: 0,
        },
        baseline: {
          model_version: "",
          case_count: 0,
          average_confidence: 0,
          average_total_score: 0,
          direction_accuracy: 0,
          calibration_gap: 0,
          correct_rate: 0,
          partial_rate: 0,
          wrong_rate: 0,
          by_theme: [],
          by_source_type: [],
          by_horizon: [],
        },
        candidate: {
          model_version: "",
          case_count: 0,
          average_confidence: 0,
          average_total_score: 0,
          direction_accuracy: 0,
          calibration_gap: 0,
          correct_rate: 0,
          partial_rate: 0,
          wrong_rate: 0,
          by_theme: [],
          by_source_type: [],
          by_horizon: [],
        },
      }) as StoredPromotionEvaluation["walk_forward"])
    : null,
  saved_model: row.saved_model
    ? (parseJsonObject(row.saved_model, {
        model_version: "",
        family: "",
        status: "experimental",
        feature_flags: {},
        created_at: new Date().toISOString(),
      }) as StoredPromotionEvaluation["saved_model"])
    : null,
  created_at: new Date(String(row.created_at)).toISOString(),
});

const mapTranscriptSessionRow = (row: DbRow): StoredTranscriptSession => ({
  id: String(row.id),
  source_type: row.source_type as StoredTranscriptSession["source_type"],
  title: typeof row.title === "string" ? row.title : undefined,
  speaker: typeof row.speaker === "string" ? row.speaker : undefined,
  publisher: typeof row.publisher === "string" ? row.publisher : undefined,
  raw_uri: typeof row.raw_uri === "string" ? row.raw_uri : undefined,
  model_version: String(row.model_version),
  horizons: parseJsonArray(row.horizons, []),
  rolling_window_chars: Number(row.rolling_window_chars),
  status: row.status as StoredTranscriptSession["status"],
  created_at: new Date(String(row.created_at)).toISOString(),
  updated_at: new Date(String(row.updated_at)).toISOString(),
});

const mapTranscriptChunkRow = (row: DbRow): StoredTranscriptChunk => ({
  id: String(row.id),
  session_id: String(row.session_id),
  sequence: Number(row.sequence),
  text: String(row.text),
  occurred_at: row.occurred_at ? new Date(String(row.occurred_at)).toISOString() : undefined,
  created_at: new Date(String(row.created_at)).toISOString(),
});

const mapTranscriptSessionAnalysisRow = (row: DbRow): TranscriptSessionAnalysis => ({
  id: String(row.id),
  session_id: String(row.session_id),
  chunk_count: Number(row.chunk_count),
  rolling_text_chars: Number(row.rolling_text_chars),
  parsed_event: parseJsonObject(row.parsed_event, {
    event_class: "live_commentary",
    summary: "",
    sentiment: "neutral",
    urgency_score: 0,
    novelty_score: 0,
    entities: [],
    themes: [],
    candidate_assets: [],
    why_it_matters: [],
  }) as TranscriptSessionAnalysis["parsed_event"],
  analogs: parseJsonArray(row.analogs, []),
  predictions: parseJsonArray(row.predictions, []),
  highlights: parseJsonArray(row.highlights, []),
  created_at: new Date(String(row.created_at)).toISOString(),
});

const mapTranscriptStreamBindingRow = (row: DbRow): TranscriptStreamBinding => ({
  id: String(row.id),
  provider: row.provider as TranscriptStreamBinding["provider"],
  external_stream_key: String(row.external_stream_key),
  session_id: String(row.session_id),
  metadata: parseJsonObject(row.metadata, {}),
  created_at: new Date(String(row.created_at)).toISOString(),
  updated_at: new Date(String(row.updated_at)).toISOString(),
});

const mapTranscriptStreamBufferRow = (row: DbRow): TranscriptStreamBuffer => ({
  id: String(row.id),
  provider: row.provider as TranscriptStreamBuffer["provider"],
  external_stream_key: String(row.external_stream_key),
  session_id: String(row.session_id),
  pending_text: String(row.pending_text ?? ""),
  fragment_count: Number(row.fragment_count ?? 0),
  first_occurred_at: row.first_occurred_at ? new Date(String(row.first_occurred_at)).toISOString() : null,
  last_occurred_at: row.last_occurred_at ? new Date(String(row.last_occurred_at)).toISOString() : null,
  created_at: new Date(String(row.created_at)).toISOString(),
  updated_at: new Date(String(row.updated_at)).toISOString(),
});

export class PostgresRepository implements Repository {
  constructor(private readonly pool: Pool) {}

  async createSource(input: CreateSourceRequest): Promise<StoredSource> {
    const id = randomUUID();
    const query = await this.pool.query(
      `insert into sources (
         id, source_type, title, speaker, publisher, occurred_at, raw_uri, raw_text, metadata
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, '{}'::jsonb)
       returning id, source_type, title, speaker, publisher, raw_uri, occurred_at, raw_text, received_at`,
      [
        id,
        input.source_type,
        input.title ?? null,
        input.speaker ?? null,
        input.publisher ?? null,
        input.occurred_at ?? null,
        input.raw_uri ?? null,
        input.raw_text,
      ],
    );

    return mapSourceRow(query.rows[0]);
  }

  async getSource(id: string): Promise<StoredSource | null> {
    const query = await this.pool.query(
      `select id, source_type, title, speaker, publisher, raw_uri, occurred_at, raw_text, received_at
       from sources
       where id = $1`,
      [id],
    );

    return query.rowCount ? mapSourceRow(query.rows[0]) : null;
  }

  async getSourceByRawUri(rawUri: string): Promise<StoredSource | null> {
    const query = await this.pool.query(
      `select id, source_type, title, speaker, publisher, raw_uri, occurred_at, raw_text, received_at
       from sources
       where raw_uri = $1
       order by received_at desc
       limit 1`,
      [rawUri],
    );

    return query.rowCount ? mapSourceRow(query.rows[0]) : null;
  }

  async createEvent(
    sourceId: string,
    event: Omit<StoredEvent, "id" | "source_id" | "created_at">,
  ): Promise<StoredEvent> {
    const id = randomUUID();
    const query = await this.pool.query(
      `insert into events (
         id, source_id, event_class, summary, sentiment, urgency_score, novelty_score, regime_snapshot, extracted
       ) values ($1, $2, $3, $4, $5, $6, $7, '{}'::jsonb, $8::jsonb)
       returning id, source_id, event_class, summary, sentiment, urgency_score, novelty_score, extracted, created_at`,
      [
        id,
        sourceId,
        event.event_class,
        event.summary,
        event.sentiment,
        event.urgency_score,
        event.novelty_score,
        JSON.stringify({
          entities: event.entities,
          themes: event.themes,
          candidate_assets: event.candidate_assets,
          why_it_matters: event.why_it_matters,
        }),
      ],
    );

    return mapEventRow(query.rows[0]);
  }

  async getEvent(id: string): Promise<StoredEvent | null> {
    const query = await this.pool.query(
      `select id, source_id, event_class, summary, sentiment, urgency_score, novelty_score, extracted, created_at
       from events
       where id = $1`,
      [id],
    );

    return query.rowCount ? mapEventRow(query.rows[0]) : null;
  }

  async createPrediction(
    eventId: string,
    prediction: Omit<StoredPrediction, "id" | "event_id" | "status" | "created_at">,
  ): Promise<StoredPrediction> {
    const id = randomUUID();
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      const predictionQuery = await client.query(
        `insert into predictions (
           id, event_id, model_version, horizon, status, thesis, confidence, evidence, invalidations, assumptions
         ) values ($1, $2, $3, $4, 'pending', $5, $6, $7::jsonb, $8::jsonb, $9::jsonb)
         returning id, event_id, model_version, horizon, status, thesis, confidence, evidence, invalidations, assumptions, created_at`,
        [
          id,
          eventId,
          prediction.model_version,
          prediction.horizon,
          prediction.thesis,
          prediction.confidence,
          JSON.stringify(prediction.evidence),
          JSON.stringify(prediction.invalidations),
          JSON.stringify(prediction.assumptions),
        ],
      );

      for (const [index, asset] of prediction.assets.entries()) {
        await client.query(
          `insert into prediction_assets (
             id, prediction_id, ticker, expected_direction, expected_magnitude_bp, expected_volatility_change, rank_order, conviction
           ) values ($1, $2, $3, $4, $5, null, $6, $7)`,
          [
            randomUUID(),
            id,
            asset.ticker,
            asset.expected_direction,
            asset.expected_magnitude_bp,
            index,
            asset.conviction,
          ],
        );
      }

      await client.query("commit");

      const assetsQuery = await this.pool.query(
        `select ticker, expected_direction, expected_magnitude_bp, rank_order, conviction
         from prediction_assets
         where prediction_id = $1`,
        [id],
      );

      return mapPredictionRow(predictionQuery.rows[0], assetsQuery.rows);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async getPrediction(id: string): Promise<StoredPrediction | null> {
    const predictionQuery = await this.pool.query(
      `select id, event_id, model_version, horizon, status, thesis, confidence, evidence, invalidations, assumptions, created_at
       from predictions
       where id = $1`,
      [id],
    );

    if (!predictionQuery.rowCount) {
      return null;
    }

    const assetsQuery = await this.pool.query(
      `select ticker, expected_direction, expected_magnitude_bp, rank_order, conviction
       from prediction_assets
       where prediction_id = $1`,
      [id],
    );

    return mapPredictionRow(predictionQuery.rows[0], assetsQuery.rows);
  }

  async updatePredictionStatus(id: string, status: StoredPrediction["status"]) {
    const query = await this.pool.query(
      `update predictions
       set status = $2
       where id = $1
       returning id, event_id, model_version, horizon, status, thesis, confidence, evidence, invalidations, assumptions, created_at`,
      [id, status],
    );

    if (!query.rowCount) {
      return null;
    }

    const assetsQuery = await this.pool.query(
      `select ticker, expected_direction, expected_magnitude_bp, rank_order, conviction
       from prediction_assets
       where prediction_id = $1`,
      [id],
    );

    return mapPredictionRow(query.rows[0], assetsQuery.rows);
  }

  async listPendingPredictionsReadyForScoring(asOf: string): Promise<PendingPredictionRecord[]> {
    const query = await this.pool.query(
      `select p.id
       from predictions p
       where p.status = 'pending'
         and p.created_at +
           case p.horizon
             when '1h' then interval '1 hour'
             when '1d' then interval '1 day'
             when '5d' then interval '5 days'
             else interval '100 years'
           end <= $1::timestamptz`,
      [asOf],
    );

    const records: PendingPredictionRecord[] = [];

    for (const row of query.rows) {
      const prediction = await this.getPrediction(String(row.id));
      if (!prediction) {
        continue;
      }

      const event = await this.getEvent(prediction.event_id);
      if (!event) {
        continue;
      }

      records.push({ prediction, event });
    }

    return records;
  }

  async listLearningRecords(options: { limit?: number } = {}): Promise<PredictionLearningRecord[]> {
    const params: unknown[] = [];
    const normalizedLimit =
      options.limit === undefined ? null : Math.max(1, Math.floor(options.limit));
    const limitClause =
      normalizedLimit === null ? "" : (() => {
        params.push(normalizedLimit);
        return ` limit $${params.length}`;
      })();
    const predictionQuery = await this.pool.query(
      `select *
       from predictions
       order by created_at desc${limitClause}`,
      params,
    );
    const predictionRows = predictionQuery.rows as DbRow[];

    if (!predictionRows.length) {
      return [];
    }

    const predictionIds = predictionRows.map((row) => String(row.id));
    const eventIds = [...new Set(predictionRows.map((row) => String(row.event_id)))];
    const [assetQuery, eventQuery, outcomeQuery, postmortemQuery, lessonQuery] = await Promise.all([
      this.pool.query(
        `select *
         from prediction_assets
         where prediction_id = any($1)`,
        [predictionIds],
      ),
      this.pool.query(
        `select *
         from events
         where id = any($1)`,
        [eventIds],
      ),
      this.pool.query(
        `select *
         from prediction_outcomes
         where prediction_id = any($1)
         order by measured_at desc, created_at desc`,
        [predictionIds],
      ),
      this.pool.query(
        `select *
         from postmortems
         where prediction_id = any($1)
         order by created_at desc`,
        [predictionIds],
      ),
      this.pool.query(
        `select distinct on (prediction_id)
            id,
            prediction_id,
            lesson_type,
            lesson_summary,
            metadata,
            embedding,
            created_at
         from lessons
         where prediction_id = any($1)
         order by prediction_id, created_at desc`,
        [predictionIds],
      ),
    ]);

    const assetRowsByPredictionId = new Map<string, DbRow[]>();
    for (const row of assetQuery.rows as DbRow[]) {
      const predictionId = String(row.prediction_id);
      const existing = assetRowsByPredictionId.get(predictionId);
      if (existing) {
        existing.push(row);
      } else {
        assetRowsByPredictionId.set(predictionId, [row]);
      }
    }

    const eventById = new Map(
      (eventQuery.rows as DbRow[]).map((row) => {
        const event = mapEventRow(row);
        return [event.id, event] as const;
      }),
    );
    const outcomeByPredictionId = new Map<string, PredictionOutcome>();
    for (const row of outcomeQuery.rows as DbRow[]) {
      const predictionId = String(row.prediction_id);
      if (!outcomeByPredictionId.has(predictionId)) {
        outcomeByPredictionId.set(predictionId, mapOutcomeRow(row));
      }
    }
    const postmortemByPredictionId = new Map<string, Postmortem>();
    for (const row of postmortemQuery.rows as DbRow[]) {
      const predictionId = String(row.prediction_id);
      if (!postmortemByPredictionId.has(predictionId)) {
        postmortemByPredictionId.set(predictionId, mapPostmortemRow(row));
      }
    }
    const lessonByPredictionId = new Map<string, Lesson>();
    const lessonEmbeddingByPredictionId = new Map<string, number[] | null>();
    for (const row of lessonQuery.rows as DbRow[]) {
      const predictionId = String(row.prediction_id);
      if (!lessonByPredictionId.has(predictionId)) {
        lessonByPredictionId.set(predictionId, mapLessonRow(row));
        lessonEmbeddingByPredictionId.set(
          predictionId,
          normalizeEmbedding(row.embedding),
        );
      }
    }

    const records: PredictionLearningRecord[] = [];
    for (const row of predictionRows) {
      const prediction = mapPredictionRow(
        row,
        assetRowsByPredictionId.get(String(row.id)) ?? [],
      );
      const event = eventById.get(prediction.event_id);
      if (!event) {
        continue;
      }

      records.push({
        event,
        prediction,
        outcome: outcomeByPredictionId.get(prediction.id) ?? null,
        postmortem: postmortemByPredictionId.get(prediction.id) ?? null,
        lesson: lessonByPredictionId.get(prediction.id) ?? null,
        lesson_embedding: lessonEmbeddingByPredictionId.get(prediction.id) ?? null,
      });
    }

    return records;
  }

  async saveOutcome(outcome: PredictionOutcome) {
    await this.pool.query(
      `insert into prediction_outcomes (
         id, prediction_id, horizon, measured_at, outcome_payload, direction_score, magnitude_score, timing_score, calibration_score, total_score
       ) values ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10)`,
      [
        outcome.id,
        outcome.prediction_id,
        outcome.horizon,
        outcome.measured_at,
        JSON.stringify(outcome.outcome_payload),
        outcome.direction_score,
        outcome.magnitude_score,
        outcome.timing_score,
        outcome.calibration_score,
        outcome.total_score,
      ],
    );

    return outcome;
  }

  async getOutcomeByPredictionId(predictionId: string): Promise<PredictionOutcome | null> {
    const query = await this.pool.query(
      `select *
       from prediction_outcomes
       where prediction_id = $1
       order by created_at desc
       limit 1`,
      [predictionId],
    );

    return query.rowCount ? mapOutcomeRow(query.rows[0]) : null;
  }

  async savePostmortem(postmortem: Postmortem) {
    await this.pool.query(
      `insert into postmortems (
         id, prediction_id, verdict, failure_tags, critique, lesson_summary
       ) values ($1, $2, $3, $4::jsonb, $5, $6)`,
      [
        postmortem.id,
        postmortem.prediction_id,
        postmortem.verdict,
        JSON.stringify(postmortem.failure_tags),
        postmortem.critique,
        postmortem.lesson_summary,
      ],
    );

    return postmortem;
  }

  async getPostmortemByPredictionId(predictionId: string): Promise<Postmortem | null> {
    const query = await this.pool.query(
      `select *
       from postmortems
       where prediction_id = $1
       order by created_at desc
       limit 1`,
      [predictionId],
    );

    return query.rowCount ? mapPostmortemRow(query.rows[0]) : null;
  }

  async saveLesson(lesson: Lesson, embedding?: number[] | null) {
    await this.pool.query(
      `insert into lessons (
         id, prediction_id, lesson_type, lesson_summary, embedding, metadata
       ) values ($1, $2, $3, $4, null, $5::jsonb)`,
      [
        lesson.id,
        lesson.prediction_id,
        lesson.lesson_type,
        lesson.lesson_summary,
        JSON.stringify(lesson.metadata),
      ],
    );

    if (embedding?.length) {
      await this.pool.query(
        `update lessons
         set embedding = $2::jsonb
         where id = $1`,
        [lesson.id, JSON.stringify(embedding)],
      );
    }

    return lesson;
  }

  async getHistoricalCaseLibraryItem(caseId: string) {
    const query = await this.pool.query(
      `select case_id, case_pack, source, horizon, realized_moves, timing_alignment,
         dominant_catalyst, parsed_event, labels, review, created_at, updated_at
       from historical_case_library
       where case_id = $1
       limit 1`,
      [caseId],
    );

    return query.rowCount ? mapHistoricalCaseLibraryRow(query.rows[0]) : null;
  }

  async countHistoricalCaseLibraryItems(options: {
    case_pack?: string;
    case_ids?: string[];
    case_qualities?: HistoricalCaseLibraryItem["labels"]["case_quality"][];
    reviewer?: string;
  } = {}) {
    const params: unknown[] = [];
    const where: string[] = [];

    if (options.case_pack) {
      params.push(options.case_pack);
      where.push(`case_pack = $${params.length}`);
    }

    if (options.case_ids?.length) {
      params.push(options.case_ids);
      where.push(`case_id = any($${params.length})`);
    }

    if (options.case_qualities?.length) {
      params.push(options.case_qualities);
      where.push(`labels ->> 'case_quality' = any($${params.length})`);
    }

    if (options.reviewer) {
      params.push(options.reviewer);
      where.push(`coalesce(review ->> 'reviewer', '') = $${params.length}`);
    }

    const query = await this.pool.query(
      `select count(*)::int as total
       from historical_case_library
       ${where.length ? `where ${where.join(" and ")}` : ""}`,
      params,
    );

    return Number(query.rows[0]?.total ?? 0);
  }

  async listHistoricalCaseLibraryItems(options: {
    limit?: number;
    case_pack?: string;
    case_ids?: string[];
    case_qualities?: HistoricalCaseLibraryItem["labels"]["case_quality"][];
    reviewer?: string;
  } = {}) {
    const params: unknown[] = [];
    const where: string[] = [];

    if (options.case_pack) {
      params.push(options.case_pack);
      where.push(`case_pack = $${params.length}`);
    }

    if (options.case_ids?.length) {
      params.push(options.case_ids);
      where.push(`case_id = any($${params.length})`);
    }

    if (options.case_qualities?.length) {
      params.push(options.case_qualities);
      where.push(`labels ->> 'case_quality' = any($${params.length})`);
    }

    if (options.reviewer) {
      params.push(options.reviewer);
      where.push(`coalesce(review ->> 'reviewer', '') = $${params.length}`);
    }

    params.push(options.limit ?? 200);
    const query = await this.pool.query(
      `select case_id, case_pack, source, horizon, realized_moves, timing_alignment,
         dominant_catalyst, parsed_event, labels, review, created_at, updated_at
       from historical_case_library
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by updated_at desc
       limit $${params.length}`,
      params,
    );

    return query.rows.map(mapHistoricalCaseLibraryRow);
  }

  async saveHistoricalCaseLibraryItem(item: HistoricalCaseLibraryItem) {
    const query = await this.pool.query(
      `insert into historical_case_library (
         case_id, case_pack, source, horizon, realized_moves, timing_alignment,
         dominant_catalyst, parsed_event, labels, review
       ) values (
         $1, $2, $3::jsonb, $4, $5::jsonb, $6,
         $7, $8::jsonb, $9::jsonb, $10::jsonb
       )
       on conflict (case_id) do update
       set case_pack = excluded.case_pack,
           source = excluded.source,
           horizon = excluded.horizon,
           realized_moves = excluded.realized_moves,
           timing_alignment = excluded.timing_alignment,
           dominant_catalyst = excluded.dominant_catalyst,
           parsed_event = excluded.parsed_event,
           labels = excluded.labels,
           review = excluded.review,
           updated_at = now()
       returning case_id, case_pack, source, horizon, realized_moves, timing_alignment,
         dominant_catalyst, parsed_event, labels, review, created_at, updated_at`,
      [
        item.case_id,
        item.case_pack,
        JSON.stringify(item.source),
        item.horizon,
        JSON.stringify(item.realized_moves),
        item.timing_alignment,
        item.dominant_catalyst,
        JSON.stringify(item.parsed_event),
        JSON.stringify(item.labels),
        JSON.stringify(item.review),
      ],
    );

    return mapHistoricalCaseLibraryRow(query.rows[0]);
  }

  async listLessons(): Promise<Lesson[]> {
    const query = await this.pool.query(
      `select id, prediction_id, lesson_type, lesson_summary, metadata, created_at
       from lessons
       order by created_at desc`,
    );

    return query.rows.map(mapLessonRow);
  }

  async saveModelVersion(input: CreateModelVersionRequest) {
    const query = await this.pool.query(
      `insert into model_registry (
         model_version, family, label, description, owner, prompt_profile, status, feature_flags
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       on conflict (model_version) do update
       set family = excluded.family,
           label = excluded.label,
           description = excluded.description,
           owner = excluded.owner,
           prompt_profile = excluded.prompt_profile,
           status = excluded.status,
           feature_flags = excluded.feature_flags
       returning model_version, family, label, description, owner, prompt_profile, status, feature_flags, created_at`,
      [
        input.model_version,
        input.family,
        input.label ?? null,
        input.description ?? null,
        input.owner ?? null,
        input.prompt_profile ?? null,
        input.status,
        JSON.stringify(input.feature_flags),
      ],
    );

    return mapModelVersionRow(query.rows[0]);
  }

  async getModelVersion(modelVersion: string): Promise<StoredModelVersion | null> {
    const query = await this.pool.query(
      `select model_version, family, label, description, owner, prompt_profile, status, feature_flags, created_at
       from model_registry
       where model_version = $1`,
      [modelVersion],
    );

    return query.rowCount ? mapModelVersionRow(query.rows[0]) : null;
  }

  async listModelVersions(): Promise<StoredModelVersion[]> {
    const query = await this.pool.query(
      `select model_version, family, label, description, owner, prompt_profile, status, feature_flags, created_at
       from model_registry
       order by created_at desc`,
    );

    return query.rows.map(mapModelVersionRow);
  }

  async createTranscriptSession(input: CreateTranscriptSessionRequest) {
    const id = randomUUID();
    const query = await this.pool.query(
      `insert into transcript_sessions (
         id, source_type, title, speaker, publisher, raw_uri, model_version, horizons, rolling_window_chars, status
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, 'active')
       returning id, source_type, title, speaker, publisher, raw_uri, model_version, horizons, rolling_window_chars, status, created_at, updated_at`,
      [
        id,
        input.source_type,
        input.title ?? null,
        input.speaker ?? null,
        input.publisher ?? null,
        input.raw_uri ?? null,
        input.model_version,
        JSON.stringify(input.horizons),
        input.rolling_window_chars,
      ],
    );

    return mapTranscriptSessionRow(query.rows[0]);
  }

  async getTranscriptSession(id: string): Promise<StoredTranscriptSession | null> {
    const query = await this.pool.query(
      `select id, source_type, title, speaker, publisher, raw_uri, model_version, horizons, rolling_window_chars, status, created_at, updated_at
       from transcript_sessions
       where id = $1`,
      [id],
    );

    return query.rowCount ? mapTranscriptSessionRow(query.rows[0]) : null;
  }

  async getTranscriptStreamBinding(
    provider: LiveTranscriptProvider,
    externalStreamKey: string,
  ): Promise<TranscriptStreamBinding | null> {
    const query = await this.pool.query(
      `select id, provider, external_stream_key, session_id, metadata, created_at, updated_at
       from transcript_stream_bindings
       where provider = $1 and external_stream_key = $2
       limit 1`,
      [provider, externalStreamKey],
    );

    return query.rowCount ? mapTranscriptStreamBindingRow(query.rows[0]) : null;
  }

  async upsertTranscriptStreamBinding(input: {
    provider: LiveTranscriptProvider;
    external_stream_key: string;
    session_id: string;
    metadata?: Record<string, string>;
  }): Promise<TranscriptStreamBinding> {
    const query = await this.pool.query(
      `insert into transcript_stream_bindings (
         id, provider, external_stream_key, session_id, metadata
       ) values ($1, $2, $3, $4, $5::jsonb)
       on conflict (provider, external_stream_key) do update
       set session_id = excluded.session_id,
           metadata = excluded.metadata,
           updated_at = now()
       returning id, provider, external_stream_key, session_id, metadata, created_at, updated_at`,
      [
        randomUUID(),
        input.provider,
        input.external_stream_key,
        input.session_id,
        JSON.stringify(input.metadata ?? {}),
      ],
    );

    return mapTranscriptStreamBindingRow(query.rows[0]);
  }

  async listTranscriptStreamBindings(limit = 20): Promise<TranscriptStreamBinding[]> {
    const query = await this.pool.query(
      `select id, provider, external_stream_key, session_id, metadata, created_at, updated_at
       from transcript_stream_bindings
       order by updated_at desc
       limit $1`,
      [limit],
    );

    return query.rows.map(mapTranscriptStreamBindingRow);
  }

  async getTranscriptStreamBuffer(
    provider: LiveTranscriptProvider,
    externalStreamKey: string,
  ): Promise<TranscriptStreamBuffer | null> {
    const query = await this.pool.query(
      `select id, provider, external_stream_key, session_id, pending_text, fragment_count, first_occurred_at, last_occurred_at, created_at, updated_at
       from transcript_stream_buffers
       where provider = $1 and external_stream_key = $2
       limit 1`,
      [provider, externalStreamKey],
    );

    return query.rowCount ? mapTranscriptStreamBufferRow(query.rows[0]) : null;
  }

  async upsertTranscriptStreamBuffer(input: {
    provider: LiveTranscriptProvider;
    external_stream_key: string;
    session_id: string;
    pending_text: string;
    fragment_count: number;
    first_occurred_at?: string | null;
    last_occurred_at?: string | null;
  }): Promise<TranscriptStreamBuffer> {
    const query = await this.pool.query(
      `insert into transcript_stream_buffers (
         id, provider, external_stream_key, session_id, pending_text, fragment_count, first_occurred_at, last_occurred_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (provider, external_stream_key) do update
       set session_id = excluded.session_id,
           pending_text = excluded.pending_text,
           fragment_count = excluded.fragment_count,
           first_occurred_at = excluded.first_occurred_at,
           last_occurred_at = excluded.last_occurred_at,
           updated_at = now()
       returning id, provider, external_stream_key, session_id, pending_text, fragment_count, first_occurred_at, last_occurred_at, created_at, updated_at`,
      [
        randomUUID(),
        input.provider,
        input.external_stream_key,
        input.session_id,
        input.pending_text,
        input.fragment_count,
        input.first_occurred_at ?? null,
        input.last_occurred_at ?? null,
      ],
    );

    return mapTranscriptStreamBufferRow(query.rows[0]);
  }

  async clearTranscriptStreamBuffer(
    provider: LiveTranscriptProvider,
    externalStreamKey: string,
  ): Promise<void> {
    await this.pool.query(
      `delete from transcript_stream_buffers
       where provider = $1 and external_stream_key = $2`,
      [provider, externalStreamKey],
    );
  }

  async updateTranscriptSessionStatus(
    id: string,
    status: StoredTranscriptSession["status"],
  ): Promise<StoredTranscriptSession | null> {
    const query = await this.pool.query(
      `update transcript_sessions
       set status = $2,
           updated_at = now()
       where id = $1
       returning id, source_type, title, speaker, publisher, raw_uri, model_version, horizons, rolling_window_chars, status, created_at, updated_at`,
      [id, status],
    );

    return query.rowCount ? mapTranscriptSessionRow(query.rows[0]) : null;
  }

  async appendTranscriptSessionChunk(
    sessionId: string,
    input: CreateTranscriptChunkRequest,
  ): Promise<StoredTranscriptChunk> {
    const id = randomUUID();
    const client = await this.pool.connect();

    try {
      await client.query("begin");
      const sequenceQuery = await client.query(
        `select coalesce(max(sequence), 0) + 1 as next_sequence
         from transcript_chunks
         where session_id = $1`,
        [sessionId],
      );
      const sequence = Number(sequenceQuery.rows[0]?.next_sequence ?? 1);
      const insertQuery = await client.query(
        `insert into transcript_chunks (
           id, session_id, sequence, occurred_at, text
         ) values ($1, $2, $3, $4, $5)
         returning id, session_id, sequence, occurred_at, text, created_at`,
        [id, sessionId, sequence, input.occurred_at ?? null, input.text],
      );
      await client.query(
        `update transcript_sessions
         set updated_at = now()
         where id = $1`,
        [sessionId],
      );
      await client.query("commit");

      return mapTranscriptChunkRow(insertQuery.rows[0]);
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  }

  async listTranscriptSessionChunks(sessionId: string): Promise<StoredTranscriptChunk[]> {
    const query = await this.pool.query(
      `select id, session_id, sequence, occurred_at, text, created_at
       from transcript_chunks
       where session_id = $1
       order by sequence asc`,
      [sessionId],
    );

    return query.rows.map(mapTranscriptChunkRow);
  }

  async saveTranscriptSessionAnalysis(analysis: TranscriptSessionAnalysis) {
    await this.pool.query(
      `insert into transcript_session_analyses (
         id, session_id, chunk_count, rolling_text_chars, parsed_event, analogs, predictions, highlights
       ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)`,
      [
        analysis.id,
        analysis.session_id,
        analysis.chunk_count,
        analysis.rolling_text_chars,
        JSON.stringify(analysis.parsed_event),
        JSON.stringify(analysis.analogs),
        JSON.stringify(analysis.predictions),
        JSON.stringify(analysis.highlights),
      ],
    );

    await this.pool.query(
      `update transcript_sessions
       set updated_at = now()
       where id = $1`,
      [analysis.session_id],
    );

    return analysis;
  }

  async getLatestTranscriptSessionAnalysis(
    sessionId: string,
  ): Promise<TranscriptSessionAnalysis | null> {
    const query = await this.pool.query(
      `select id, session_id, chunk_count, rolling_text_chars, parsed_event, analogs, predictions, highlights, created_at
       from transcript_session_analyses
       where session_id = $1
       order by created_at desc
       limit 1`,
      [sessionId],
    );

    return query.rowCount ? mapTranscriptSessionAnalysisRow(query.rows[0]) : null;
  }

  async saveCalibrationSnapshot(snapshot: CalibrationSnapshot) {
    await this.pool.query(
      `insert into calibration_snapshots (
         id, as_of, sample_count, average_total_score, report
       ) values ($1, $2, $3, $4, $5::jsonb)`,
      [
        snapshot.id,
        snapshot.as_of,
        snapshot.sample_count,
        snapshot.average_total_score,
        JSON.stringify(snapshot.report),
      ],
    );

    return snapshot;
  }

  async listCalibrationSnapshots(limit = 20): Promise<CalibrationSnapshot[]> {
    const query = await this.pool.query(
      `select id, as_of, sample_count, average_total_score, report, created_at
       from calibration_snapshots
       order by as_of desc
       limit $1`,
      [limit],
    );

    return query.rows.map(mapCalibrationSnapshotRow);
  }

  async saveBenchmarkReplaySnapshot(snapshot: BenchmarkReplaySnapshot) {
    await this.pool.query(
      `insert into benchmark_replay_snapshots (
         id, as_of, benchmark_pack_id, selected_case_count, family_count, report
       ) values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        snapshot.id,
        snapshot.as_of,
        snapshot.benchmark_pack_id,
        snapshot.selected_case_count,
        snapshot.family_count,
        JSON.stringify(snapshot.report),
      ],
    );

    return snapshot;
  }

  async listBenchmarkReplaySnapshots(
    options: number | { limit?: number; benchmark_pack_id?: string } = 20,
  ): Promise<BenchmarkReplaySnapshot[]> {
    const limit = typeof options === "number" ? options : (options.limit ?? 20);
    const benchmarkPackId = typeof options === "number" ? undefined : options.benchmark_pack_id;
    const params: unknown[] = [];
    const where: string[] = [];

    if (benchmarkPackId) {
      params.push(benchmarkPackId);
      where.push(`benchmark_pack_id = $${params.length}`);
    }

    params.push(limit);
    const query = await this.pool.query(
      `select id, as_of, benchmark_pack_id, selected_case_count, family_count, report, created_at
       from benchmark_replay_snapshots
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by as_of desc
       limit $${params.length}`,
      params,
    );

    return query.rows.map(mapBenchmarkReplaySnapshotRow);
  }

  async saveWalkForwardReplaySnapshot(
    snapshot: WalkForwardReplaySnapshot,
  ): Promise<WalkForwardReplaySnapshot> {
    await this.pool.query(
      `insert into walk_forward_replay_snapshots (
         id, as_of, benchmark_pack_id, eligible_case_count, window_count, family_count, report
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
      [
        snapshot.id,
        snapshot.as_of,
        snapshot.benchmark_pack_id,
        snapshot.eligible_case_count,
        snapshot.window_count,
        snapshot.family_count,
        JSON.stringify(snapshot.report),
      ],
    );

    return snapshot;
  }

  async listWalkForwardReplaySnapshots(
    options: number | { limit?: number; benchmark_pack_id?: string } = 20,
  ): Promise<WalkForwardReplaySnapshot[]> {
    const limit = typeof options === "number" ? options : (options.limit ?? 20);
    const benchmarkPackId = typeof options === "number" ? undefined : options.benchmark_pack_id;
    const params: unknown[] = [];
    const where: string[] = [];

    if (benchmarkPackId) {
      params.push(benchmarkPackId);
      where.push(`benchmark_pack_id = $${params.length}`);
    }

    params.push(limit);
    const query = await this.pool.query(
      `select id, as_of, benchmark_pack_id, eligible_case_count, window_count, family_count, report, created_at
       from walk_forward_replay_snapshots
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by as_of desc
       limit $${params.length}`,
      params,
    );

    return query.rows.map(mapWalkForwardReplaySnapshotRow);
  }

  async saveBenchmarkTrustRefresh(
    refresh: BenchmarkTrustRefreshRecord,
  ): Promise<BenchmarkTrustRefreshRecord> {
    await this.pool.query(
      `insert into benchmark_trust_refreshes (
         id, generated_at, benchmark_pack_id, seed, before_summary, after_summary, delta,
         benchmark_snapshot_id, benchmark_snapshot_case_count, benchmark_snapshot_family_count
       ) values ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10)`,
      [
        refresh.id,
        refresh.generated_at,
        refresh.benchmark_pack_id,
        JSON.stringify(refresh.seed),
        JSON.stringify(refresh.before),
        JSON.stringify(refresh.after),
        JSON.stringify(refresh.delta),
        refresh.benchmark_snapshot_id,
        refresh.benchmark_snapshot_case_count,
        refresh.benchmark_snapshot_family_count,
      ],
    );

    return refresh;
  }

  async listBenchmarkTrustRefreshes(
    options: number | { limit?: number; benchmark_pack_id?: string } = 20,
  ): Promise<BenchmarkTrustRefreshRecord[]> {
    const limit = typeof options === "number" ? options : (options.limit ?? 20);
    const benchmarkPackId = typeof options === "number" ? undefined : options.benchmark_pack_id;
    const params: unknown[] = [];
    const where: string[] = [];

    if (benchmarkPackId) {
      params.push(benchmarkPackId);
      where.push(`benchmark_pack_id = $${params.length}`);
    }

    params.push(limit);
    const query = await this.pool.query(
      `select id, generated_at, benchmark_pack_id, seed, before_summary, after_summary, delta,
          benchmark_snapshot_id, benchmark_snapshot_case_count, benchmark_snapshot_family_count,
          created_at
       from benchmark_trust_refreshes
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by generated_at desc
       limit $${params.length}`,
      params,
    );

    return query.rows.map(mapBenchmarkTrustRefreshRow);
  }

  async saveOperationRun(run: Omit<OperationRunRecord, "id" | "created_at">) {
    const query = await this.pool.query(
      `insert into operation_runs (
         id, operation_name, status, triggered_by, started_at, finished_at, duration_ms,
         metadata, summary, error_message
       ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
       returning id, operation_name, status, triggered_by, started_at, finished_at, duration_ms,
         metadata, summary, error_message, created_at`,
      [
        randomUUID(),
        run.operation_name,
        run.status,
        run.triggered_by,
        run.started_at,
        run.finished_at,
        run.duration_ms,
        JSON.stringify(run.metadata),
        JSON.stringify(run.summary),
        run.error_message,
      ],
    );

    return mapOperationRunRow(query.rows[0]);
  }

  async listOperationRuns(options: {
    limit?: number;
    operation_names?: OperationRunRecord["operation_name"][];
    statuses?: OperationRunRecord["status"][];
    triggered_by?: OperationRunRecord["triggered_by"][];
  } = {}) {
    const params: unknown[] = [];
    const where: string[] = [];

    if (options.operation_names?.length) {
      params.push(options.operation_names);
      where.push(`operation_name = any($${params.length})`);
    }

    if (options.statuses?.length) {
      params.push(options.statuses);
      where.push(`status = any($${params.length})`);
    }

    if (options.triggered_by?.length) {
      params.push(options.triggered_by);
      where.push(`triggered_by = any($${params.length})`);
    }

    params.push(options.limit ?? 20);
    const query = await this.pool.query(
       `select id, operation_name, status, triggered_by, started_at, finished_at, duration_ms,
          metadata, summary, error_message, created_at
        from operation_runs
        ${where.length ? `where ${where.join(" and ")}` : ""}
       order by finished_at desc, started_at desc, created_at desc
        limit $${params.length}`,
       params,
     );

    return query.rows.map(mapOperationRunRow);
  }

  async acquireOperationLease(input: {
    operation_name: OperationLeaseRecord["operation_name"];
    scope_key: string;
    owner: string;
    acquired_at: string;
    expires_at: string;
  }) {
    const query = await this.pool.query(
      `insert into operation_leases (
         operation_name, scope_key, owner, acquired_at, expires_at, updated_at
       ) values ($1, $2, $3, $4, $5, $4)
       on conflict (operation_name, scope_key) do update
       set owner = excluded.owner,
           acquired_at = excluded.acquired_at,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at
       where operation_leases.expires_at <= excluded.acquired_at
          or operation_leases.owner = excluded.owner
       returning operation_name, scope_key, owner, acquired_at, expires_at, updated_at`,
      [
        input.operation_name,
        input.scope_key,
        input.owner,
        input.acquired_at,
        input.expires_at,
      ],
    );

    return query.rowCount ? mapOperationLeaseRow(query.rows[0]) : null;
  }

  async renewOperationLease(input: {
    operation_name: OperationLeaseRecord["operation_name"];
    scope_key: string;
    owner: string;
    renewed_at: string;
    expires_at: string;
  }) {
    const query = await this.pool.query(
      `update operation_leases
       set expires_at = $4,
           updated_at = $5
       where operation_name = $1
         and scope_key = $2
         and owner = $3
       returning operation_name, scope_key, owner, acquired_at, expires_at, updated_at`,
      [
        input.operation_name,
        input.scope_key,
        input.owner,
        input.expires_at,
        input.renewed_at,
      ],
    );

    return query.rowCount ? mapOperationLeaseRow(query.rows[0]) : null;
  }

  async releaseOperationLease(input: {
    operation_name: OperationLeaseRecord["operation_name"];
    scope_key: string;
    owner: string;
  }) {
    const query = await this.pool.query(
      `delete from operation_leases
       where operation_name = $1 and scope_key = $2 and owner = $3
       returning operation_name`,
      [input.operation_name, input.scope_key, input.owner],
    );

    return Boolean(query.rowCount);
  }

  async listOperationLeases(options: {
    limit?: number;
    active_only?: boolean;
    as_of?: string;
    operation_names?: OperationLeaseRecord["operation_name"][];
  } = {}) {
    const params: unknown[] = [];
    const where: string[] = [];

    if (options.operation_names?.length) {
      params.push(options.operation_names);
      where.push(`operation_name = any($${params.length})`);
    }

    if (options.active_only !== false) {
      params.push(options.as_of ?? new Date().toISOString());
      where.push(`expires_at > $${params.length}`);
    }

    params.push(options.limit ?? 20);
    const query = await this.pool.query(
      `select operation_name, scope_key, owner, acquired_at, expires_at, updated_at
       from operation_leases
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by updated_at desc
       limit $${params.length}`,
      params,
    );

    return query.rows.map(mapOperationLeaseRow);
  }

  async enqueueOperationJob(input: {
    operation_name: OperationJobRecord["operation_name"];
    triggered_by: OperationJobRecord["triggered_by"];
    payload: Record<string, JsonValue>;
    idempotency_key?: string | null;
    max_attempts: number;
    available_at: string;
  }) {
    const query = await this.pool.query(
      `insert into operation_jobs (
         id, operation_name, status, triggered_by, payload, idempotency_key,
         max_attempts, attempt_count, available_at, result_summary
       ) values ($1, $2, 'pending', $3, $4::jsonb, $5, $6, 0, $7, '{}'::jsonb)
       on conflict (idempotency_key) do update
       set updated_at = operation_jobs.updated_at
       returning id, operation_name, status, triggered_by, payload, idempotency_key,
         max_attempts, attempt_count, available_at, lease_owner, lease_expires_at,
         started_at, finished_at, result_summary, error_message, created_at, updated_at`,
      [
        randomUUID(),
        input.operation_name,
        input.triggered_by,
        JSON.stringify(input.payload),
        input.idempotency_key ?? null,
        input.max_attempts,
        input.available_at,
      ],
    );

    return mapOperationJobRow(query.rows[0]);
  }

  async getOperationJob(id: string) {
    const query = await this.pool.query(
      `select id, operation_name, status, triggered_by, payload, idempotency_key,
          max_attempts, attempt_count, available_at, lease_owner, lease_expires_at,
          started_at, finished_at, result_summary, error_message, created_at, updated_at
       from operation_jobs
       where id = $1
       limit 1`,
      [id],
    );

    return query.rowCount ? mapOperationJobRow(query.rows[0]) : null;
  }

  async listOperationJobs(options: {
    limit?: number;
    operation_names?: OperationJobRecord["operation_name"][];
    statuses?: OperationJobRecord["status"][];
    updated_after?: string;
    updated_before?: string;
  } = {}) {
    const params: unknown[] = [];
    const where: string[] = [];

    if (options.operation_names?.length) {
      params.push(options.operation_names);
      where.push(`operation_name = any($${params.length})`);
    }

    if (options.statuses?.length) {
      params.push(options.statuses);
      where.push(`status = any($${params.length})`);
    }

    if (options.updated_after) {
      params.push(options.updated_after);
      where.push(`updated_at >= $${params.length}`);
    }

    if (options.updated_before) {
      params.push(options.updated_before);
      where.push(`updated_at <= $${params.length}`);
    }

    params.push(options.limit ?? 20);
    const query = await this.pool.query(
      `select id, operation_name, status, triggered_by, payload, idempotency_key,
          max_attempts, attempt_count, available_at, lease_owner, lease_expires_at,
          started_at, finished_at, result_summary, error_message, created_at, updated_at
       from operation_jobs
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by updated_at desc, created_at desc
       limit $${params.length}`,
      params,
    );

    return query.rows.map(mapOperationJobRow);
  }

  async getLatestOperationJobsByOperation(options: {
    operation_names: OperationJobRecord["operation_name"][];
  }) {
    const operationNames = options.operation_names.filter(Boolean);

    if (operationNames.length === 0) {
      return [];
    }

    const query = await this.pool.query(
      `select distinct on (operation_name)
         id, operation_name, status, triggered_by, payload, idempotency_key,
         max_attempts, attempt_count, available_at, lease_owner, lease_expires_at,
         started_at, finished_at, result_summary, error_message, created_at, updated_at
       from operation_jobs
       where operation_name = any($1)
       order by operation_name asc, updated_at desc, created_at desc`,
      [operationNames],
    );

    const latestByOperation = new Map(
      query.rows.map((row) => {
        const record = mapOperationJobRow(row);
        return [record.operation_name, record] as const;
      }),
    );

    return operationNames
      .map((operationName) => latestByOperation.get(operationName))
      .filter((job): job is OperationJobRecord => job !== undefined);
  }

  async upsertOperationWorker(input: {
    worker_id: string;
    lifecycle_state: OperationWorkerRecord["lifecycle_state"];
    supported_operations?: OperationWorkerRecord["supported_operations"];
    poll_interval_ms?: number | null;
    idle_backoff_ms?: number | null;
    started_at?: string;
    heartbeat_at: string;
    last_cycle_started_at?: string | null;
    last_cycle_finished_at?: string | null;
    last_cycle_processed?: number | null;
    last_cycle_completed?: number | null;
    last_cycle_failed?: number | null;
    last_cycle_retried?: number | null;
    last_cycle_abandoned?: number | null;
    last_error_message?: string | null;
    stopped_at?: string | null;
  }) {
    const startedAt = input.started_at ?? input.heartbeat_at;
    const query = await this.pool.query(
      `insert into operation_workers (
         worker_id, lifecycle_state, supported_operations, poll_interval_ms, idle_backoff_ms,
         started_at, last_heartbeat_at, last_cycle_started_at, last_cycle_finished_at,
         last_cycle_processed, last_cycle_completed, last_cycle_failed, last_cycle_retried,
         last_cycle_abandoned, total_cycles, total_processed, total_completed, total_failed,
         total_retried, total_abandoned, last_error_message, stopped_at, updated_at
       ) values (
         $1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9,
         $10, $11, $12, $13, $14,
         case when $9::timestamptz is null then 0 else 1 end,
         coalesce($10, 0), coalesce($11, 0), coalesce($12, 0), coalesce($13, 0), coalesce($14, 0),
         $15, $16, $7
       )
       on conflict (worker_id) do update
       set lifecycle_state = excluded.lifecycle_state,
           supported_operations = excluded.supported_operations,
           poll_interval_ms = excluded.poll_interval_ms,
           idle_backoff_ms = excluded.idle_backoff_ms,
           started_at = operation_workers.started_at,
           last_heartbeat_at = excluded.last_heartbeat_at,
           last_cycle_started_at = coalesce(excluded.last_cycle_started_at, operation_workers.last_cycle_started_at),
           last_cycle_finished_at = coalesce(excluded.last_cycle_finished_at, operation_workers.last_cycle_finished_at),
           last_cycle_processed = coalesce(excluded.last_cycle_processed, operation_workers.last_cycle_processed),
           last_cycle_completed = coalesce(excluded.last_cycle_completed, operation_workers.last_cycle_completed),
           last_cycle_failed = coalesce(excluded.last_cycle_failed, operation_workers.last_cycle_failed),
           last_cycle_retried = coalesce(excluded.last_cycle_retried, operation_workers.last_cycle_retried),
           last_cycle_abandoned = coalesce(excluded.last_cycle_abandoned, operation_workers.last_cycle_abandoned),
           total_cycles = operation_workers.total_cycles + case
             when excluded.last_cycle_finished_at is not null
               and excluded.last_cycle_finished_at is distinct from operation_workers.last_cycle_finished_at
             then 1 else 0 end,
           total_processed = operation_workers.total_processed + case
             when excluded.last_cycle_finished_at is not null
               and excluded.last_cycle_finished_at is distinct from operation_workers.last_cycle_finished_at
             then coalesce(excluded.last_cycle_processed, 0) else 0 end,
           total_completed = operation_workers.total_completed + case
             when excluded.last_cycle_finished_at is not null
               and excluded.last_cycle_finished_at is distinct from operation_workers.last_cycle_finished_at
             then coalesce(excluded.last_cycle_completed, 0) else 0 end,
           total_failed = operation_workers.total_failed + case
             when excluded.last_cycle_finished_at is not null
               and excluded.last_cycle_finished_at is distinct from operation_workers.last_cycle_finished_at
             then coalesce(excluded.last_cycle_failed, 0) else 0 end,
           total_retried = operation_workers.total_retried + case
             when excluded.last_cycle_finished_at is not null
               and excluded.last_cycle_finished_at is distinct from operation_workers.last_cycle_finished_at
             then coalesce(excluded.last_cycle_retried, 0) else 0 end,
           total_abandoned = operation_workers.total_abandoned + case
             when excluded.last_cycle_finished_at is not null
               and excluded.last_cycle_finished_at is distinct from operation_workers.last_cycle_finished_at
             then coalesce(excluded.last_cycle_abandoned, 0) else 0 end,
          last_error_message = excluded.last_error_message,
          stopped_at = excluded.stopped_at,
          updated_at = excluded.updated_at
       returning worker_id, lifecycle_state, supported_operations, poll_interval_ms, idle_backoff_ms,
         started_at, last_heartbeat_at, last_cycle_started_at, last_cycle_finished_at,
         last_cycle_processed, last_cycle_completed, last_cycle_failed, last_cycle_retried,
         last_cycle_abandoned, total_cycles, total_processed, total_completed, total_failed,
         total_retried, total_abandoned, last_error_message, stopped_at, updated_at`,
      [
        input.worker_id,
        input.lifecycle_state,
        JSON.stringify(input.supported_operations ?? []),
        input.poll_interval_ms ?? null,
        input.idle_backoff_ms ?? null,
        startedAt,
        input.heartbeat_at,
        input.last_cycle_started_at ?? null,
        input.last_cycle_finished_at ?? null,
        input.last_cycle_processed ?? null,
        input.last_cycle_completed ?? null,
        input.last_cycle_failed ?? null,
        input.last_cycle_retried ?? null,
        input.last_cycle_abandoned ?? null,
        input.last_error_message ?? null,
        input.stopped_at ?? null,
      ],
    );

    return mapOperationWorkerRow(query.rows[0] ?? {});
  }

  async listOperationWorkers(options: { limit?: number } = {}) {
    const query = await this.pool.query(
      `select worker_id, lifecycle_state, supported_operations, poll_interval_ms, idle_backoff_ms,
         started_at, last_heartbeat_at, last_cycle_started_at, last_cycle_finished_at,
         last_cycle_processed, last_cycle_completed, last_cycle_failed, last_cycle_retried,
         last_cycle_abandoned, total_cycles, total_processed, total_completed, total_failed,
         total_retried, total_abandoned, last_error_message, stopped_at, updated_at
       from operation_workers
       order by updated_at desc, worker_id asc
       limit $1`,
      [options.limit ?? 20],
    );

    return query.rows.map(mapOperationWorkerRow);
  }

  async upsertOperationWorkerService(input: {
    service_id: string;
    worker_id: string;
    lifecycle_state: OperationWorkerServiceRecord["lifecycle_state"];
    supported_operations?: OperationWorkerServiceRecord["supported_operations"];
    supervisor_pid?: number | null;
    supervisor_host?: string | null;
    supervisor_instance_id?: string | null;
    invocation_mode?: string | null;
    supervisor_backoff_ms: number;
    success_window_ms: number;
    heartbeat_interval_ms: number;
    max_restarts: number;
    restart_count?: number;
    restart_streak?: number;
    current_restart_backoff_ms?: number | null;
    started_at?: string;
    heartbeat_at: string;
    last_loop_started_at?: string | null;
    last_loop_finished_at?: string | null;
    last_loop_runtime_ms?: number | null;
    last_exit_code?: number | null;
    last_exit_signal?: string | null;
    last_error_message?: string | null;
    stopped_at?: string | null;
  }) {
    const query = await this.pool.query(
      `insert into operation_worker_services (
         service_id, worker_id, lifecycle_state, supported_operations, supervisor_pid,
         supervisor_host, supervisor_instance_id, invocation_mode, supervisor_backoff_ms, success_window_ms,
         heartbeat_interval_ms, max_restarts, restart_count, restart_streak, current_restart_backoff_ms, started_at,
         last_heartbeat_at, last_loop_started_at, last_loop_finished_at, last_loop_runtime_ms,
         last_exit_code, last_exit_signal, last_error_message, stopped_at
       ) values (
         $1, $2, $3, $4::jsonb, $5,
         $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15,
         $16, $17, $18, $19,
         $20, $21, $22, $23, $24
       )
       on conflict (service_id) do update set
         worker_id = excluded.worker_id,
         lifecycle_state = excluded.lifecycle_state,
         supported_operations = excluded.supported_operations,
         supervisor_pid = excluded.supervisor_pid,
         supervisor_host = excluded.supervisor_host,
         supervisor_instance_id = excluded.supervisor_instance_id,
         invocation_mode = excluded.invocation_mode,
         supervisor_backoff_ms = excluded.supervisor_backoff_ms,
         success_window_ms = excluded.success_window_ms,
         heartbeat_interval_ms = excluded.heartbeat_interval_ms,
         max_restarts = excluded.max_restarts,
         restart_count = excluded.restart_count,
         restart_streak = excluded.restart_streak,
         current_restart_backoff_ms = excluded.current_restart_backoff_ms,
         started_at = excluded.started_at,
         last_heartbeat_at = excluded.last_heartbeat_at,
         last_loop_started_at = excluded.last_loop_started_at,
         last_loop_finished_at = excluded.last_loop_finished_at,
         last_loop_runtime_ms = excluded.last_loop_runtime_ms,
         last_exit_code = excluded.last_exit_code,
         last_exit_signal = excluded.last_exit_signal,
         last_error_message = excluded.last_error_message,
         stopped_at = excluded.stopped_at,
         updated_at = now()
       returning service_id, worker_id, lifecycle_state, supported_operations, supervisor_pid,
         supervisor_host, supervisor_instance_id, invocation_mode, supervisor_backoff_ms, success_window_ms,
         heartbeat_interval_ms, max_restarts, restart_count, restart_streak, current_restart_backoff_ms, started_at,
         last_heartbeat_at, last_loop_started_at, last_loop_finished_at, last_loop_runtime_ms,
         last_exit_code, last_exit_signal, last_error_message, stopped_at, updated_at`,
      [
        input.service_id,
        input.worker_id,
        input.lifecycle_state,
        JSON.stringify(input.supported_operations ?? []),
        input.supervisor_pid ?? null,
        input.supervisor_host ?? null,
        input.supervisor_instance_id ?? null,
        input.invocation_mode ?? null,
        input.supervisor_backoff_ms,
        input.success_window_ms,
        input.heartbeat_interval_ms,
        input.max_restarts,
        input.restart_count ?? 0,
        input.restart_streak ?? 0,
        input.current_restart_backoff_ms ?? null,
        input.started_at ?? input.heartbeat_at,
        input.heartbeat_at,
        input.last_loop_started_at ?? null,
        input.last_loop_finished_at ?? null,
        input.last_loop_runtime_ms ?? null,
        input.last_exit_code ?? null,
        input.last_exit_signal ?? null,
        input.last_error_message ?? null,
        input.stopped_at ?? null,
      ],
    );

    return mapOperationWorkerServiceRow(query.rows[0] ?? {});
  }

  async listOperationWorkerServices(options: { limit?: number } = {}) {
    const query = await this.pool.query(
      `select service_id, worker_id, lifecycle_state, supported_operations, supervisor_pid,
         supervisor_host, supervisor_instance_id, invocation_mode, supervisor_backoff_ms, success_window_ms,
         heartbeat_interval_ms, max_restarts, restart_count, restart_streak, current_restart_backoff_ms, started_at,
         last_heartbeat_at, last_loop_started_at, last_loop_finished_at, last_loop_runtime_ms,
         last_exit_code, last_exit_signal, last_error_message, stopped_at, updated_at
       from operation_worker_services
       order by updated_at desc, service_id asc
       limit $1`,
      [options.limit ?? 20],
    );

    return query.rows.map(mapOperationWorkerServiceRow);
  }

  async getOperationWorkerService(serviceId: string) {
    const query = await this.pool.query(
      `select service_id, worker_id, lifecycle_state, supported_operations, supervisor_pid,
         supervisor_host, supervisor_instance_id, invocation_mode, supervisor_backoff_ms, success_window_ms,
         heartbeat_interval_ms, max_restarts, restart_count, restart_streak, current_restart_backoff_ms, started_at,
         last_heartbeat_at, last_loop_started_at, last_loop_finished_at, last_loop_runtime_ms,
         last_exit_code, last_exit_signal, last_error_message, stopped_at, updated_at
       from operation_worker_services
       where service_id = $1
       limit 1`,
      [serviceId],
    );

    return query.rows[0] ? mapOperationWorkerServiceRow(query.rows[0]) : null;
  }

  async saveOperationWorkerServiceEvent(
    input: Omit<OperationWorkerServiceEventRecord, "id" | "created_at">,
  ) {
    const id = randomUUID();
    const query = await this.pool.query(
      `insert into operation_worker_service_events (
         id, service_id, worker_id, event_type, occurred_at, lifecycle_state,
         scheduled_restart, restart_count, restart_streak, loop_runtime_ms,
         exit_code, exit_signal, error_message, metadata
       ) values (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10,
         $11, $12, $13, $14::jsonb
       )
       returning id, service_id, worker_id, event_type, occurred_at, lifecycle_state,
         scheduled_restart, restart_count, restart_streak, loop_runtime_ms,
         exit_code, exit_signal, error_message, metadata, created_at`,
      [
        id,
        input.service_id,
        input.worker_id,
        input.event_type,
        input.occurred_at,
        input.lifecycle_state,
        input.scheduled_restart,
        input.restart_count,
        input.restart_streak,
        input.loop_runtime_ms,
        input.exit_code,
        input.exit_signal,
        input.error_message,
        JSON.stringify(input.metadata),
      ],
    );

    return mapOperationWorkerServiceEventRow(query.rows[0] ?? {});
  }

  async listOperationWorkerServiceEvents(
    options: {
      limit?: number;
      service_id?: string;
      worker_id?: string;
      event_types?: OperationWorkerServiceEventRecord["event_type"][];
      occurred_after?: string;
      occurred_before?: string;
    } = {},
  ) {
    const params: unknown[] = [];
    const filters: string[] = [];

    if (options.service_id) {
      params.push(options.service_id);
      filters.push(`service_id = $${params.length}`);
    }

    if (options.worker_id) {
      params.push(options.worker_id);
      filters.push(`worker_id = $${params.length}`);
    }

    if (options.event_types?.length) {
      params.push(options.event_types);
      filters.push(`event_type = any($${params.length})`);
    }

    if (options.occurred_after) {
      params.push(options.occurred_after);
      filters.push(`occurred_at >= $${params.length}`);
    }

    if (options.occurred_before) {
      params.push(options.occurred_before);
      filters.push(`occurred_at <= $${params.length}`);
    }

    params.push(options.limit ?? 50);
    const whereSql = filters.length ? `where ${filters.join(" and ")}` : "";
    const query = await this.pool.query(
      `select id, service_id, worker_id, event_type, occurred_at, lifecycle_state,
         scheduled_restart, restart_count, restart_streak, loop_runtime_ms,
         exit_code, exit_signal, error_message, metadata, created_at
       from operation_worker_service_events
       ${whereSql}
       order by occurred_at desc, created_at desc
       limit $${params.length}`,
      params,
    );

    return query.rows.map(mapOperationWorkerServiceEventRow);
  }

  async getOperationWorkerServiceEventSummary(options: {
    window_started_at: string;
    as_of: string;
    bucket_hours: number;
  }) {
    const bucketSeconds = Math.max(1, options.bucket_hours) * 60 * 60;
    const query = await this.pool.query(
      `select
         floor((extract(epoch from occurred_at) - extract(epoch from $1::timestamptz)) / $3)::int as bucket_index,
         count(*) filter (where event_type = 'started')::int as started_count,
         count(*) filter (where event_type = 'ownership_conflict')::int as ownership_conflict_count,
         count(*) filter (where event_type = 'loop_exit')::int as loop_exit_count,
         count(*) filter (where event_type = 'loop_exit' and scheduled_restart = true)::int as scheduled_restart_count,
         count(*) filter (where event_type = 'stopped')::int as stopped_count,
         count(*) filter (where event_type = 'failed')::int as failed_count
       from operation_worker_service_events
       where occurred_at >= $1
         and occurred_at <= $2
       group by bucket_index
       order by bucket_index asc`,
      [options.window_started_at, options.as_of, bucketSeconds],
    );
    const bucketMs = bucketSeconds * 1000;
    const windowStartMs = new Date(options.window_started_at).getTime();

    return query.rows.map((row) => {
      const bucketIndex = Number(row.bucket_index ?? 0);

      return {
        bucket_started_at: new Date(windowStartMs + bucketIndex * bucketMs).toISOString(),
        bucket_finished_at: new Date(windowStartMs + (bucketIndex + 1) * bucketMs).toISOString(),
        started: Number(row.started_count ?? 0),
        ownership_conflicts: Number(row.ownership_conflict_count ?? 0),
        loop_exits: Number(row.loop_exit_count ?? 0),
        scheduled_restarts: Number(row.scheduled_restart_count ?? 0),
        stopped: Number(row.stopped_count ?? 0),
        failed: Number(row.failed_count ?? 0),
      } satisfies OperationWorkerServiceEventSummaryBucket;
    });
  }

  async saveOperationWorkerEvent(
    input: Omit<OperationWorkerEventRecord, "id" | "created_at">,
  ) {
    const id = randomUUID();
    const query = await this.pool.query(
      `insert into operation_worker_events (
         id, worker_id, event_type, occurred_at, lifecycle_state,
         cycle_processed, cycle_completed, cycle_failed, cycle_retried, cycle_abandoned,
         error_message, metadata
       ) values (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9, $10,
         $11, $12::jsonb
       )
       returning id, worker_id, event_type, occurred_at, lifecycle_state,
         cycle_processed, cycle_completed, cycle_failed, cycle_retried, cycle_abandoned,
         error_message, metadata, created_at`,
      [
        id,
        input.worker_id,
        input.event_type,
        input.occurred_at,
        input.lifecycle_state,
        input.cycle_processed,
        input.cycle_completed,
        input.cycle_failed,
        input.cycle_retried,
        input.cycle_abandoned,
        input.error_message,
        JSON.stringify(input.metadata),
      ],
    );

    return mapOperationWorkerEventRow(query.rows[0] ?? {});
  }

  async listOperationWorkerEvents(
    options: {
      limit?: number;
      worker_id?: string;
      event_types?: OperationWorkerEventRecord["event_type"][];
      occurred_after?: string;
      occurred_before?: string;
    } = {},
  ) {
    const params: unknown[] = [];
    const whereClauses: string[] = [];

    if (options.worker_id) {
      params.push(options.worker_id);
      whereClauses.push(`worker_id = $${params.length}`);
    }

    if (options.event_types?.length) {
      params.push(options.event_types);
      whereClauses.push(`event_type = any($${params.length})`);
    }

    if (options.occurred_after) {
      params.push(options.occurred_after);
      whereClauses.push(`occurred_at >= $${params.length}`);
    }

    if (options.occurred_before) {
      params.push(options.occurred_before);
      whereClauses.push(`occurred_at <= $${params.length}`);
    }

    params.push(options.limit ?? 50);
    const whereSql = whereClauses.length ? `where ${whereClauses.join(" and ")}` : "";
    const query = await this.pool.query(
      `select id, worker_id, event_type, occurred_at, lifecycle_state,
         cycle_processed, cycle_completed, cycle_failed, cycle_retried, cycle_abandoned,
         error_message, metadata, created_at
       from operation_worker_events
       ${whereSql}
       order by occurred_at desc, created_at desc
       limit $${params.length}`,
      params,
    );

    return query.rows.map(mapOperationWorkerEventRow);
  }

  async getOperationWorkerEventSummary(options: {
    window_started_at: string;
    as_of: string;
    bucket_hours: number;
  }) {
    const bucketSeconds = Math.max(1, options.bucket_hours) * 60 * 60;
    const query = await this.pool.query(
      `select
         floor((extract(epoch from occurred_at) - extract(epoch from $1::timestamptz)) / $3)::int as bucket_index,
         count(*) filter (where event_type = 'started')::int as started_count,
         count(*) filter (where event_type = 'stopped')::int as stopped_count,
         count(*) filter (where event_type = 'stopped' and error_message is not null)::int as error_stop_count,
         count(*) filter (where event_type = 'cycle')::int as cycle_count,
         coalesce(sum(case when event_type = 'cycle' then cycle_processed else 0 end), 0)::int as processed_count,
         coalesce(sum(case when event_type = 'cycle' then cycle_completed else 0 end), 0)::int as completed_count,
         coalesce(sum(case when event_type = 'cycle' then cycle_failed else 0 end), 0)::int as failed_count,
         coalesce(sum(case when event_type = 'cycle' then cycle_retried else 0 end), 0)::int as retried_count,
         coalesce(sum(case when event_type = 'cycle' then cycle_abandoned else 0 end), 0)::int as abandoned_count
       from operation_worker_events
       where occurred_at >= $1
         and occurred_at <= $2
       group by bucket_index
       order by bucket_index asc`,
      [options.window_started_at, options.as_of, bucketSeconds],
    );
    const bucketMs = bucketSeconds * 1000;
    const windowStartMs = new Date(options.window_started_at).getTime();

    return query.rows.map((row) => {
      const bucketIndex = Number(row.bucket_index ?? 0);

      return {
        bucket_started_at: new Date(windowStartMs + bucketIndex * bucketMs).toISOString(),
        bucket_finished_at: new Date(windowStartMs + (bucketIndex + 1) * bucketMs).toISOString(),
        started: Number(row.started_count ?? 0),
        stopped: Number(row.stopped_count ?? 0),
        error_stops: Number(row.error_stop_count ?? 0),
        cycles: Number(row.cycle_count ?? 0),
        processed: Number(row.processed_count ?? 0),
        completed: Number(row.completed_count ?? 0),
        failed: Number(row.failed_count ?? 0),
        retried: Number(row.retried_count ?? 0),
        abandoned: Number(row.abandoned_count ?? 0),
      } satisfies OperationWorkerEventSummaryBucket;
    });
  }

  async getOperationIntegrationTrendSummary(options: {
    window_started_at: string;
    as_of: string;
    bucket_hours: number;
    operation_names?: OperationIntegrationQueueSummary["operation_name"][];
  }) {
    const bucketSeconds = Math.max(1, options.bucket_hours) * 60 * 60;
    const operationNames = options.operation_names?.length
      ? options.operation_names
      : ["feed_pull", "transcript_pull"];
    const query = await this.pool.query(
      `select
         operation_name,
         floor((extract(epoch from updated_at) - extract(epoch from $1::timestamptz)) / $3)::int as bucket_index,
         count(*) filter (where status = 'completed')::int as completed_count,
         count(*) filter (where status = 'failed')::int as failed_count,
         count(*) filter (where status = 'pending' and attempt_count > 0)::int as retry_scheduled_count,
         count(*) filter (
           where status = 'failed'
             and result_summary->>'retryable' = 'false'
         )::int as non_retryable_failure_count,
         count(*) filter (
           where status = 'failed'
             and error_message is not null
             and error_message like '%lease expired%'
         )::int as stale_recovered_count
       from operation_jobs
       where operation_name = any($4)
         and updated_at >= $1
         and updated_at <= $2
       group by operation_name, bucket_index
       order by bucket_index asc, operation_name asc`,
      [options.window_started_at, options.as_of, bucketSeconds, operationNames],
    );
    const bucketMs = bucketSeconds * 1000;
    const windowStartMs = new Date(options.window_started_at).getTime();

    return query.rows.map((row) => {
      const bucketIndex = Number(row.bucket_index ?? 0);

      return {
        operation_name: row.operation_name as OperationIntegrationQueueSummary["operation_name"],
        bucket_started_at: new Date(windowStartMs + bucketIndex * bucketMs).toISOString(),
        bucket_finished_at: new Date(windowStartMs + (bucketIndex + 1) * bucketMs).toISOString(),
        completed: Number(row.completed_count ?? 0),
        failed: Number(row.failed_count ?? 0),
        retry_scheduled: Number(row.retry_scheduled_count ?? 0),
        non_retryable_failures: Number(row.non_retryable_failure_count ?? 0),
        stale_recovered: Number(row.stale_recovered_count ?? 0),
      } satisfies OperationIntegrationTrendSummaryBucket;
    });
  }

  async getOperationQueueSummary(options: { as_of?: string } = {}) {
    const asOf = options.as_of ?? new Date().toISOString();
    const query = await this.pool.query(
      `select
         count(*) filter (where status = 'pending')::int as pending_count,
         count(*) filter (where status = 'running')::int as running_count,
         count(*) filter (where status = 'completed')::int as completed_count,
         count(*) filter (where status = 'failed')::int as failed_count,
         count(*) filter (where status = 'pending' and attempt_count > 0)::int as retry_scheduled_count,
         count(*) filter (
           where status = 'running'
             and lease_expires_at is not null
             and lease_expires_at <= $1
         )::int as stale_running_count,
         min(case when status = 'pending' then available_at end) as oldest_pending_at,
         min(case when status = 'running' then started_at end) as longest_running_started_at
       from operation_jobs`,
      [asOf],
    );

    const row = query.rows[0] ?? {};

    return {
      counts: {
        pending: Number(row.pending_count ?? 0),
        running: Number(row.running_count ?? 0),
        completed: Number(row.completed_count ?? 0),
        failed: Number(row.failed_count ?? 0),
        retry_scheduled: Number(row.retry_scheduled_count ?? 0),
        stale_running: Number(row.stale_running_count ?? 0),
      },
      oldest_pending_at: toNullableIsoString(row.oldest_pending_at),
      longest_running_started_at: toNullableIsoString(row.longest_running_started_at),
    };
  }

  async getOperationIntegrationQueueSummary(options: { as_of?: string } = {}) {
    const asOf = options.as_of ?? new Date().toISOString();
    const query = await this.pool.query(
      `select
         operation_name,
         count(*)::int as total_count,
         count(*) filter (where status = 'pending')::int as pending_count,
         count(*) filter (where status = 'running')::int as running_count,
         count(*) filter (where status = 'completed')::int as completed_count,
         count(*) filter (where status = 'failed')::int as failed_count,
         count(*) filter (where status = 'pending' and attempt_count > 0)::int as retry_scheduled_count,
         count(*) filter (
           where status = 'running'
             and lease_expires_at is not null
             and lease_expires_at <= $1
         )::int as stale_running_count,
         count(*) filter (
           where error_message is not null
             and coalesce((result_summary ->> 'retryable')::boolean, false)
         )::int as retryable_failure_count,
         count(*) filter (
           where error_message is not null
             and not coalesce((result_summary ->> 'retryable')::boolean, false)
         )::int as non_retryable_failure_count,
         count(*) filter (
           where status = 'failed'
             and error_message like 'Operation job lease expired%'
         )::int as stale_recovered_count,
         max(updated_at) as latest_job_at,
         max(case when error_message is not null then updated_at end) as latest_failure_at
       from operation_jobs
       where operation_name = any($2)
       group by operation_name`,
      [asOf, ["feed_pull", "transcript_pull"]],
    );

    return query.rows.map((row) => ({
      operation_name: row.operation_name as OperationIntegrationQueueSummary["operation_name"],
      counts: {
        total: Number(row.total_count ?? 0),
        pending: Number(row.pending_count ?? 0),
        running: Number(row.running_count ?? 0),
        completed: Number(row.completed_count ?? 0),
        failed: Number(row.failed_count ?? 0),
        retry_scheduled: Number(row.retry_scheduled_count ?? 0),
        stale_running: Number(row.stale_running_count ?? 0),
        retryable_failures: Number(row.retryable_failure_count ?? 0),
        non_retryable_failures: Number(row.non_retryable_failure_count ?? 0),
        stale_recovered: Number(row.stale_recovered_count ?? 0),
      },
      latest_job_at: toNullableIsoString(row.latest_job_at),
      latest_failure_at: toNullableIsoString(row.latest_failure_at),
    }));
  }

  async abandonStaleOperationJobs(input: {
    as_of: string;
    supported_operations?: OperationJobRecord["operation_name"][];
    limit?: number;
    error_message?: string;
  }) {
    const params: unknown[] = [
      input.as_of,
      input.error_message ?? "Operation job lease expired after exhausting retry attempts.",
    ];
    let supportedClause = "";

    if (input.supported_operations?.length) {
      params.push(input.supported_operations);
      supportedClause = `and operation_name = any($${params.length})`;
    }

    params.push(input.limit ?? 100);
    const query = await this.pool.query(
      `with stale_jobs as (
         select id
         from operation_jobs
         where status = 'running'
           and lease_expires_at is not null
           and lease_expires_at <= $1
           and attempt_count >= max_attempts
           ${supportedClause}
         order by lease_expires_at asc, created_at asc
         limit $${params.length}
       )
       update operation_jobs
       set status = 'failed',
           finished_at = $1,
           updated_at = $1,
           lease_owner = null,
           lease_expires_at = null,
           error_message = $2
       where id in (select id from stale_jobs)
       returning id, operation_name, status, triggered_by, payload, idempotency_key,
         max_attempts, attempt_count, available_at, lease_owner, lease_expires_at,
         started_at, finished_at, result_summary, error_message, created_at, updated_at`,
      params,
    );

    return query.rows.map(mapOperationJobRow);
  }

  async claimNextOperationJob(input: {
    worker_id: string;
    as_of: string;
    lease_expires_at: string;
    supported_operations?: OperationJobRecord["operation_name"][];
  }) {
    const params: unknown[] = [input.as_of];
    let supportedClause = "";

    if (input.supported_operations?.length) {
      params.push(input.supported_operations);
      supportedClause = `and operation_name = any($${params.length})`;
    }

    params.push(input.worker_id, input.lease_expires_at);
    const query = await this.pool.query(
      `with next_job as (
         select id
         from operation_jobs
         where available_at <= $1
           ${supportedClause}
           and (
             status = 'pending'
             or (
               status = 'running'
               and lease_expires_at is not null
               and lease_expires_at <= $1
               and attempt_count < max_attempts
             )
           )
         order by available_at asc, created_at asc
         limit 1
         for update skip locked
       )
       update operation_jobs
       set status = 'running',
           attempt_count = operation_jobs.attempt_count + 1,
           lease_owner = $${params.length - 1},
           lease_expires_at = $${params.length},
           started_at = $1,
           updated_at = $1,
           error_message = null
       where id in (select id from next_job)
       returning id, operation_name, status, triggered_by, payload, idempotency_key,
         max_attempts, attempt_count, available_at, lease_owner, lease_expires_at,
         started_at, finished_at, result_summary, error_message, created_at, updated_at`,
      params,
    );

    return query.rowCount ? mapOperationJobRow(query.rows[0]) : null;
  }

  async heartbeatOperationJob(input: {
    id: string;
    worker_id: string;
    heartbeat_at: string;
    lease_expires_at: string;
  }) {
    const query = await this.pool.query(
      `update operation_jobs
       set lease_expires_at = $3,
           updated_at = $4
       where id = $1 and lease_owner = $2 and status = 'running'
       returning id, operation_name, status, triggered_by, payload, idempotency_key,
         max_attempts, attempt_count, available_at, lease_owner, lease_expires_at,
         started_at, finished_at, result_summary, error_message, created_at, updated_at`,
      [input.id, input.worker_id, input.lease_expires_at, input.heartbeat_at],
    );

    return query.rowCount ? mapOperationJobRow(query.rows[0]) : null;
  }

  async completeOperationJob(input: {
    id: string;
    worker_id: string;
    finished_at: string;
    result_summary: Record<string, string | number | boolean | null>;
  }) {
    const query = await this.pool.query(
      `update operation_jobs
       set status = 'completed',
           lease_owner = null,
           lease_expires_at = null,
           finished_at = $3,
           updated_at = $3,
           result_summary = $4::jsonb,
           error_message = null
       where id = $1 and lease_owner = $2 and status = 'running'
       returning id, operation_name, status, triggered_by, payload, idempotency_key,
         max_attempts, attempt_count, available_at, lease_owner, lease_expires_at,
         started_at, finished_at, result_summary, error_message, created_at, updated_at`,
      [input.id, input.worker_id, input.finished_at, JSON.stringify(input.result_summary)],
    );

    return query.rowCount ? mapOperationJobRow(query.rows[0]) : null;
  }

  async failOperationJob(input: {
    id: string;
    worker_id: string;
    finished_at: string;
    error_message: string;
    retry_at?: string | null;
    result_summary?: Record<string, string | number | boolean | null>;
  }) {
    const query = await this.pool.query(
      `update operation_jobs
       set status = case
             when $4 is not null and attempt_count < max_attempts then 'pending'
             else 'failed'
           end,
           available_at = case
             when $4 is not null and attempt_count < max_attempts then $4
             else available_at
           end,
           lease_owner = null,
           lease_expires_at = null,
           finished_at = case
             when $4 is not null and attempt_count < max_attempts then null
             else $3
           end,
           updated_at = $3,
           result_summary = $6::jsonb,
           error_message = $5
       where id = $1 and lease_owner = $2 and status = 'running'
       returning id, operation_name, status, triggered_by, payload, idempotency_key,
         max_attempts, attempt_count, available_at, lease_owner, lease_expires_at,
         started_at, finished_at, result_summary, error_message, created_at, updated_at`,
      [
        input.id,
        input.worker_id,
        input.finished_at,
        input.retry_at ?? null,
        input.error_message,
        JSON.stringify(input.result_summary ?? {}),
      ],
    );

    return query.rowCount ? mapOperationJobRow(query.rows[0]) : null;
  }

  async deferOperationJob(input: {
    id: string;
    worker_id: string;
    deferred_at: string;
    available_at: string;
    error_message: string;
    result_summary?: Record<string, string | number | boolean | null>;
  }) {
    const query = await this.pool.query(
      `update operation_jobs
       set status = 'pending',
           attempt_count = greatest(0, attempt_count - 1),
           available_at = $4,
           lease_owner = null,
           lease_expires_at = null,
           started_at = null,
           finished_at = null,
           updated_at = $3,
           result_summary = $6::jsonb,
           error_message = $5
       where id = $1 and lease_owner = $2 and status = 'running'
       returning id, operation_name, status, triggered_by, payload, idempotency_key,
         max_attempts, attempt_count, available_at, lease_owner, lease_expires_at,
         started_at, finished_at, result_summary, error_message, created_at, updated_at`,
      [
        input.id,
        input.worker_id,
        input.deferred_at,
        input.available_at,
        input.error_message,
        JSON.stringify(input.result_summary ?? {}),
      ],
    );

    return query.rowCount ? mapOperationJobRow(query.rows[0]) : null;
  }

  async saveSystemIntegrationGovernanceState(state: SystemIntegrationGovernanceState) {
    const query = await this.pool.query(
      `insert into system_integration_governance_states (
         integration, operation_name, action, highest_probe_status, configured_targets,
         ready_targets, degraded_targets, unknown_targets, recent_retry_scheduled,
         recent_non_retryable_failures, recent_stale_recovered, recent_trend_signal,
         degraded_since, outage_since, hold_until, retry_delay_seconds, reason, detail, checked_at
       ) values (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9,
         $10, $11, $12,
         $13, $14, $15, $16, $17, $18, $19
       )
       on conflict (integration) do update
       set operation_name = excluded.operation_name,
           action = excluded.action,
           highest_probe_status = excluded.highest_probe_status,
           configured_targets = excluded.configured_targets,
           ready_targets = excluded.ready_targets,
           degraded_targets = excluded.degraded_targets,
           unknown_targets = excluded.unknown_targets,
           recent_retry_scheduled = excluded.recent_retry_scheduled,
           recent_non_retryable_failures = excluded.recent_non_retryable_failures,
           recent_stale_recovered = excluded.recent_stale_recovered,
           recent_trend_signal = excluded.recent_trend_signal,
           degraded_since = excluded.degraded_since,
           outage_since = excluded.outage_since,
           hold_until = excluded.hold_until,
           retry_delay_seconds = excluded.retry_delay_seconds,
           reason = excluded.reason,
           detail = excluded.detail,
           checked_at = excluded.checked_at,
           updated_at = now()
       returning integration, operation_name, action, highest_probe_status, configured_targets,
         ready_targets, degraded_targets, unknown_targets, recent_retry_scheduled,
         recent_non_retryable_failures, recent_stale_recovered, recent_trend_signal,
         degraded_since, outage_since, hold_until, retry_delay_seconds, reason, detail, checked_at, updated_at`,
      [
        state.integration,
        state.operation_name,
        state.action,
        state.highest_probe_status,
        state.configured_targets,
        state.ready_targets,
        state.degraded_targets,
        state.unknown_targets,
        state.recent_retry_scheduled,
        state.recent_non_retryable_failures,
        state.recent_stale_recovered,
        state.recent_trend_signal,
        state.degraded_since,
        state.outage_since,
        state.hold_until,
        state.retry_delay_seconds,
        state.reason,
        state.detail,
        state.checked_at,
      ],
    );

    return mapSystemIntegrationGovernanceStateRow(query.rows[0]);
  }

  async listSystemIntegrationGovernanceStates(options?: {
    integrations?: SystemIntegrationGovernanceState["integration"][];
  }) {
    const integrations = options?.integrations ?? [];
    const query = await this.pool.query(
      `select integration, operation_name, action, highest_probe_status, configured_targets,
              ready_targets, degraded_targets, unknown_targets, recent_retry_scheduled,
              recent_non_retryable_failures, recent_stale_recovered, recent_trend_signal,
              degraded_since, outage_since, hold_until, retry_delay_seconds, reason, detail, checked_at, updated_at
       from system_integration_governance_states
       where $1::text[] is null or integration = any($1::text[])
       order by integration asc`,
      [integrations.length ? integrations : null],
    );

    return query.rows.map(mapSystemIntegrationGovernanceStateRow);
  }

  async saveSystemIntegrationProbeState(state: SystemIntegrationProbeState) {
    const query = await this.pool.query(
      `insert into system_integration_probe_states (
         integration, timeout_ms, configured_targets, ready_targets, degraded_targets,
         unknown_targets, highest_status, targets, checked_at
       ) values (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $9
       )
       on conflict (integration) do update
       set timeout_ms = excluded.timeout_ms,
           configured_targets = excluded.configured_targets,
           ready_targets = excluded.ready_targets,
           degraded_targets = excluded.degraded_targets,
           unknown_targets = excluded.unknown_targets,
           highest_status = excluded.highest_status,
           targets = excluded.targets,
           checked_at = excluded.checked_at,
           updated_at = now()
       returning integration, timeout_ms, configured_targets, ready_targets, degraded_targets,
         unknown_targets, highest_status, targets, checked_at, updated_at`,
      [
        state.integration,
        state.timeout_ms,
        state.configured_targets,
        state.ready_targets,
        state.degraded_targets,
        state.unknown_targets,
        state.highest_status,
        JSON.stringify(state.targets),
        state.checked_at,
      ],
    );

    return mapSystemIntegrationProbeStateRow(query.rows[0]);
  }

  async listSystemIntegrationProbeStates(options?: {
    integrations?: SystemIntegrationProbeState["integration"][];
  }) {
    const integrations = options?.integrations ?? [];
    const query = await this.pool.query(
      `select integration, timeout_ms, configured_targets, ready_targets, degraded_targets,
              unknown_targets, highest_status, targets, checked_at, updated_at
       from system_integration_probe_states
       where $1::text[] is null or integration = any($1::text[])
       order by integration asc`,
      [integrations.length ? integrations : null],
    );

    return query.rows.map(mapSystemIntegrationProbeStateRow);
  }

  async getEvolutionScheduleConfig(id = "default"): Promise<EvolutionScheduleConfig | null> {
    const query = await this.pool.query(
      `select id, enabled, create_postmortems, capture_calibration_snapshot,
          capture_benchmark_snapshot, capture_walk_forward_snapshot, benchmark_pack_id, run_benchmark_trust_refresh,
          run_molt_cycle,
          capture_lineage_snapshot, self_audit_interval_hours,
          benchmark_snapshot_interval_hours, walk_forward_snapshot_interval_hours, benchmark_trust_refresh_interval_hours,
          molt_interval_hours, lineage_snapshot_interval_hours, walk_forward_defaults, trust_refresh_defaults,
          molt_cycle_defaults, next_self_audit_at, next_benchmark_snapshot_at,
          next_walk_forward_snapshot_at, next_benchmark_trust_refresh_at, next_molt_at, next_lineage_snapshot_at,
          last_run_at, last_result, created_at, updated_at
       from evolution_schedule_configs
       where id = $1`,
      [id],
    );

    return query.rowCount ? mapEvolutionScheduleConfigRow(query.rows[0]) : null;
  }

  async saveEvolutionScheduleConfig(config: EvolutionScheduleConfig) {
    const query = await this.pool.query(
      `insert into evolution_schedule_configs (
         id, enabled, create_postmortems, capture_calibration_snapshot,
         capture_benchmark_snapshot, capture_walk_forward_snapshot, benchmark_pack_id, run_benchmark_trust_refresh,
         run_molt_cycle,
         capture_lineage_snapshot, self_audit_interval_hours,
         benchmark_snapshot_interval_hours, walk_forward_snapshot_interval_hours, benchmark_trust_refresh_interval_hours,
         molt_interval_hours, lineage_snapshot_interval_hours, walk_forward_defaults, trust_refresh_defaults,
         molt_cycle_defaults, next_self_audit_at, next_benchmark_snapshot_at,
         next_walk_forward_snapshot_at, next_benchmark_trust_refresh_at, next_molt_at, next_lineage_snapshot_at,
         last_run_at, last_result
         ) values (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17::jsonb, $18::jsonb, $19::jsonb, $20, $21, $22, $23, $24, $25, $26, $27::jsonb
         )
       on conflict (id) do update
       set enabled = excluded.enabled,
           create_postmortems = excluded.create_postmortems,
           capture_calibration_snapshot = excluded.capture_calibration_snapshot,
           capture_benchmark_snapshot = excluded.capture_benchmark_snapshot,
           capture_walk_forward_snapshot = excluded.capture_walk_forward_snapshot,
           benchmark_pack_id = excluded.benchmark_pack_id,
           run_benchmark_trust_refresh = excluded.run_benchmark_trust_refresh,
           run_molt_cycle = excluded.run_molt_cycle,
           capture_lineage_snapshot = excluded.capture_lineage_snapshot,
           self_audit_interval_hours = excluded.self_audit_interval_hours,
           benchmark_snapshot_interval_hours = excluded.benchmark_snapshot_interval_hours,
           walk_forward_snapshot_interval_hours = excluded.walk_forward_snapshot_interval_hours,
           benchmark_trust_refresh_interval_hours = excluded.benchmark_trust_refresh_interval_hours,
           molt_interval_hours = excluded.molt_interval_hours,
           lineage_snapshot_interval_hours = excluded.lineage_snapshot_interval_hours,
           walk_forward_defaults = excluded.walk_forward_defaults,
           trust_refresh_defaults = excluded.trust_refresh_defaults,
           molt_cycle_defaults = excluded.molt_cycle_defaults,
           next_self_audit_at = excluded.next_self_audit_at,
           next_benchmark_snapshot_at = excluded.next_benchmark_snapshot_at,
           next_walk_forward_snapshot_at = excluded.next_walk_forward_snapshot_at,
           next_benchmark_trust_refresh_at = excluded.next_benchmark_trust_refresh_at,
           next_molt_at = excluded.next_molt_at,
           next_lineage_snapshot_at = excluded.next_lineage_snapshot_at,
           last_run_at = excluded.last_run_at,
           last_result = excluded.last_result,
           updated_at = now()
       returning id, enabled, create_postmortems, capture_calibration_snapshot,
         capture_benchmark_snapshot, capture_walk_forward_snapshot, benchmark_pack_id, run_benchmark_trust_refresh,
         run_molt_cycle,
         capture_lineage_snapshot, self_audit_interval_hours,
         benchmark_snapshot_interval_hours, walk_forward_snapshot_interval_hours, benchmark_trust_refresh_interval_hours,
         molt_interval_hours, lineage_snapshot_interval_hours, walk_forward_defaults, trust_refresh_defaults,
         molt_cycle_defaults, next_self_audit_at, next_benchmark_snapshot_at,
         next_walk_forward_snapshot_at, next_benchmark_trust_refresh_at, next_molt_at, next_lineage_snapshot_at,
         last_run_at, last_result, created_at, updated_at`,
        [
          config.id,
          config.enabled,
          config.create_postmortems,
          config.capture_calibration_snapshot,
          config.capture_benchmark_snapshot,
          config.capture_walk_forward_snapshot,
          config.benchmark_pack_id,
          config.run_benchmark_trust_refresh,
          config.run_molt_cycle,
          config.capture_lineage_snapshot,
          config.self_audit_interval_hours,
          config.benchmark_snapshot_interval_hours,
          config.walk_forward_snapshot_interval_hours,
          config.benchmark_trust_refresh_interval_hours,
          config.molt_interval_hours,
          config.lineage_snapshot_interval_hours,
          JSON.stringify(config.walk_forward_defaults),
          JSON.stringify(config.trust_refresh_defaults),
          JSON.stringify(config.molt_cycle_defaults),
          config.next_self_audit_at,
          config.next_benchmark_snapshot_at,
          config.next_walk_forward_snapshot_at,
          config.next_benchmark_trust_refresh_at,
          config.next_molt_at,
          config.next_lineage_snapshot_at,
          config.last_run_at,
          config.last_result ? JSON.stringify(config.last_result) : null,
        ],
    );

    return mapEvolutionScheduleConfigRow(query.rows[0]);
  }

  async getGrowthPressurePolicy(family: string) {
    const query = await this.pool.query(
      `select family, enabled, thresholds, persistence, actions, created_at, updated_at
       from growth_pressure_policies
       where family = $1
       limit 1`,
      [family],
    );

    return query.rowCount ? mapGrowthPressurePolicyRow(query.rows[0]) : null;
  }

  async listGrowthPressurePolicies(): Promise<GrowthPressurePolicy[]> {
    const query = await this.pool.query(
      `select family, enabled, thresholds, persistence, actions, created_at, updated_at
       from growth_pressure_policies
       order by family asc`,
    );

    return query.rows.map(mapGrowthPressurePolicyRow);
  }

  async saveGrowthPressurePolicy(policy: GrowthPressurePolicy) {
    const query = await this.pool.query(
      `insert into growth_pressure_policies (
         family, enabled, thresholds, persistence, actions
       ) values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
       on conflict (family) do update
       set enabled = excluded.enabled,
           thresholds = excluded.thresholds,
           persistence = excluded.persistence,
           actions = excluded.actions,
           updated_at = now()
       returning family, enabled, thresholds, persistence, actions, created_at, updated_at`,
      [
        policy.family,
        policy.enabled,
        JSON.stringify(policy.thresholds),
        JSON.stringify(policy.persistence),
        JSON.stringify(policy.actions),
      ],
    );

    return mapGrowthPressurePolicyRow(query.rows[0]);
  }

  async getGrowthPressureAlert(id: string) {
    const query = await this.pool.query(
      `select id, family, policy_family, active_model_version, severity, status, generation_depth,
         pass_rate, average_total_score, calibration_gap, trend_signal, signals, recommended_action,
         persistence_count, first_triggered_at, last_triggered_at, acknowledged_at, snoozed_until,
         handled_at, resolved_at, last_planned_action, last_plan_status, created_at, updated_at
       from growth_pressure_alerts
       where id = $1
       limit 1`,
      [id],
    );

    return query.rowCount ? mapGrowthPressureAlertRow(query.rows[0]) : null;
  }

  async listGrowthPressureAlerts(options: {
    limit?: number;
    family?: string;
    statuses?: StoredGrowthPressureAlert["status"][];
  } = {}) {
    const params: unknown[] = [];
    const where: string[] = [];

    if (options.family) {
      params.push(options.family);
      where.push(`family = $${params.length}`);
    }

    if (options.statuses?.length) {
      params.push(options.statuses);
      where.push(`status = any($${params.length})`);
    }

    params.push(options.limit ?? 20);
    const query = await this.pool.query(
      `select id, family, policy_family, active_model_version, severity, status, generation_depth,
         pass_rate, average_total_score, calibration_gap, trend_signal, signals, recommended_action,
         persistence_count, first_triggered_at, last_triggered_at, acknowledged_at, snoozed_until,
         handled_at, resolved_at, last_planned_action, last_plan_status, created_at, updated_at
       from growth_pressure_alerts
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by updated_at desc
       limit $${params.length}`,
      params,
    );

    return query.rows.map(mapGrowthPressureAlertRow);
  }

  async saveGrowthPressureAlert(alert: StoredGrowthPressureAlert) {
    const query = await this.pool.query(
      `insert into growth_pressure_alerts (
         id, family, policy_family, active_model_version, severity, status, generation_depth,
         pass_rate, average_total_score, calibration_gap, trend_signal, signals, recommended_action,
         persistence_count, first_triggered_at, last_triggered_at, acknowledged_at, snoozed_until,
         handled_at, resolved_at, last_planned_action, last_plan_status
       ) values (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12::jsonb, $13,
         $14, $15, $16, $17, $18,
         $19, $20, $21, $22
       )
       on conflict (id) do update
       set family = excluded.family,
           policy_family = excluded.policy_family,
           active_model_version = excluded.active_model_version,
           severity = excluded.severity,
           status = excluded.status,
           generation_depth = excluded.generation_depth,
           pass_rate = excluded.pass_rate,
           average_total_score = excluded.average_total_score,
           calibration_gap = excluded.calibration_gap,
           trend_signal = excluded.trend_signal,
           signals = excluded.signals,
           recommended_action = excluded.recommended_action,
           persistence_count = excluded.persistence_count,
           first_triggered_at = excluded.first_triggered_at,
           last_triggered_at = excluded.last_triggered_at,
           acknowledged_at = excluded.acknowledged_at,
           snoozed_until = excluded.snoozed_until,
           handled_at = excluded.handled_at,
           resolved_at = excluded.resolved_at,
           last_planned_action = excluded.last_planned_action,
           last_plan_status = excluded.last_plan_status,
           updated_at = now()
       returning id, family, policy_family, active_model_version, severity, status, generation_depth,
         pass_rate, average_total_score, calibration_gap, trend_signal, signals, recommended_action,
         persistence_count, first_triggered_at, last_triggered_at, acknowledged_at, snoozed_until,
         handled_at, resolved_at, last_planned_action, last_plan_status, created_at, updated_at`,
      [
        alert.id,
        alert.family,
        alert.policy_family,
        alert.active_model_version,
        alert.severity,
        alert.status,
        alert.generation_depth,
        alert.pass_rate,
        alert.average_total_score,
        alert.calibration_gap,
        alert.trend_signal,
        JSON.stringify(alert.signals),
        alert.recommended_action,
        alert.persistence_count,
        alert.first_triggered_at,
        alert.last_triggered_at,
        alert.acknowledged_at,
        alert.snoozed_until,
        alert.handled_at,
        alert.resolved_at,
        alert.planned_action,
        alert.plan_status,
      ],
    );

    return mapGrowthPressureAlertRow(query.rows[0]);
  }

  async getGrowthPressureActionPlan(id: string) {
    const query = await this.pool.query(
      `select id, alert_id, family, active_model_version, action_type, status,
         requires_operator_approval, rationale, payload, result, candidate_model_version,
         operator_note, approved_at, blocked_at, executed_at, created_at, updated_at
       from growth_pressure_action_plans
       where id = $1
       limit 1`,
      [id],
    );

    return query.rowCount ? mapGrowthPressureActionPlanRow(query.rows[0]) : null;
  }

  async listGrowthPressureActionPlans(options: {
    limit?: number;
    family?: string;
    statuses?: GrowthPressureActionPlan["status"][];
  } = {}) {
    const params: unknown[] = [];
    const where: string[] = [];

    if (options.family) {
      params.push(options.family);
      where.push(`family = $${params.length}`);
    }

    if (options.statuses?.length) {
      params.push(options.statuses);
      where.push(`status = any($${params.length})`);
    }

    params.push(options.limit ?? 20);
    const query = await this.pool.query(
      `select id, alert_id, family, active_model_version, action_type, status,
         requires_operator_approval, rationale, payload, result, candidate_model_version,
         operator_note, approved_at, blocked_at, executed_at, created_at, updated_at
       from growth_pressure_action_plans
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by updated_at desc
       limit $${params.length}`,
      params,
    );

    return query.rows.map(mapGrowthPressureActionPlanRow);
  }

  async saveGrowthPressureActionPlan(plan: GrowthPressureActionPlan) {
    const query = await this.pool.query(
      `insert into growth_pressure_action_plans (
         id, alert_id, family, active_model_version, action_type, status,
         requires_operator_approval, rationale, payload, result, candidate_model_version,
         operator_note, approved_at, blocked_at, executed_at
       ) values (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9::jsonb, $10::jsonb, $11,
         $12, $13, $14, $15
       )
       on conflict (id) do update
       set alert_id = excluded.alert_id,
           family = excluded.family,
           active_model_version = excluded.active_model_version,
           action_type = excluded.action_type,
           status = excluded.status,
           requires_operator_approval = excluded.requires_operator_approval,
           rationale = excluded.rationale,
           payload = excluded.payload,
           result = excluded.result,
           candidate_model_version = excluded.candidate_model_version,
           operator_note = excluded.operator_note,
           approved_at = excluded.approved_at,
           blocked_at = excluded.blocked_at,
           executed_at = excluded.executed_at,
           updated_at = now()
       returning id, alert_id, family, active_model_version, action_type, status,
         requires_operator_approval, rationale, payload, result, candidate_model_version,
         operator_note, approved_at, blocked_at, executed_at, created_at, updated_at`,
      [
        plan.id,
        plan.alert_id,
        plan.family,
        plan.active_model_version,
        plan.action_type,
        plan.status,
        plan.requires_operator_approval,
        plan.rationale,
        JSON.stringify(plan.payload),
        plan.result ? JSON.stringify(plan.result) : null,
        plan.candidate_model_version,
        plan.operator_note,
        plan.approved_at,
        plan.blocked_at,
        plan.executed_at,
      ],
    );

    return mapGrowthPressureActionPlanRow(query.rows[0]);
  }

  async saveLineageSnapshot(snapshot: LineageSnapshot) {
    await this.pool.query(
      `insert into lineage_snapshots (
         id, as_of, family_count, total_shells, hardened_shells, report
       ) values ($1, $2, $3, $4, $5, $6::jsonb)`,
      [
        snapshot.id,
        snapshot.as_of,
        snapshot.family_count,
        snapshot.total_shells,
        snapshot.hardened_shells,
        JSON.stringify(snapshot.report),
      ],
    );

    return snapshot;
  }

  async listLineageSnapshots(limit = 20): Promise<LineageSnapshot[]> {
    const query = await this.pool.query(
      `select id, as_of, family_count, total_shells, hardened_shells, report, created_at
       from lineage_snapshots
       order by as_of desc
       limit $1`,
      [limit],
    );

    return query.rows.map(mapLineageSnapshotRow);
  }

  async savePromotionEvaluation(
    evaluation: Omit<StoredPromotionEvaluation, "id" | "created_at">,
  ) {
    const query = await this.pool.query(
      `insert into promotion_evaluations (
         id, candidate_model_version, baseline_model_version, case_pack, case_count,
         passed, reasons, deltas, thresholds, baseline, candidate, walk_forward, saved_model
       ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb)
       returning id, candidate_model_version, baseline_model_version, case_pack, case_count,
         passed, reasons, deltas, thresholds, baseline, candidate, walk_forward, saved_model, created_at`,
      [
        randomUUID(),
        evaluation.candidate_model_version,
        evaluation.baseline_model_version,
        evaluation.case_pack,
        evaluation.case_count,
        evaluation.passed,
        JSON.stringify(evaluation.reasons),
        JSON.stringify(evaluation.deltas),
        JSON.stringify(evaluation.thresholds),
        JSON.stringify(evaluation.baseline),
        JSON.stringify(evaluation.candidate),
        evaluation.walk_forward ? JSON.stringify(evaluation.walk_forward) : null,
        evaluation.saved_model ? JSON.stringify(evaluation.saved_model) : null,
      ],
    );

    return mapPromotionEvaluationRow(query.rows[0]);
  }

  async listPromotionEvaluations(
    options:
      | number
      | { limit?: number; benchmark_pack_id?: string; has_walk_forward?: boolean } = 20,
  ): Promise<StoredPromotionEvaluation[]> {
    const limit = typeof options === "number" ? options : (options.limit ?? 20);
    const benchmarkPackId = typeof options === "number" ? undefined : options.benchmark_pack_id;
    const hasWalkForward = typeof options === "number" ? undefined : options.has_walk_forward;
    const params: unknown[] = [];
    const where: string[] = [];

    if (benchmarkPackId) {
      params.push(benchmarkPackId);
      where.push(`walk_forward ->> 'benchmark_pack_id' = $${params.length}`);
    }

    if (hasWalkForward !== undefined) {
      where.push(hasWalkForward ? "walk_forward is not null" : "walk_forward is null");
    }

    params.push(limit);
    const query = await this.pool.query(
      `select id, candidate_model_version, baseline_model_version, case_pack, case_count,
         passed, reasons, deltas, thresholds, baseline, candidate, walk_forward, saved_model, created_at
       from promotion_evaluations
       ${where.length ? `where ${where.join(" and ")}` : ""}
       order by created_at desc
       limit $${params.length}`,
      params,
    );

    return query.rows.map(mapPromotionEvaluationRow);
  }

  async close() {
    await this.pool.end();
  }
}

export const createPostgresRepository = (databaseUrl: string) =>
  new PostgresRepository(
    new Pool({
      connectionString: databaseUrl,
    }),
  );
