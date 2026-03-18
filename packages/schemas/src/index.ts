import { z } from "zod";

export const sourceTypeSchema = z.enum([
  "headline",
  "transcript",
  "speech",
  "earnings",
  "filing",
  "user_note",
]);

export const entitySchema = z.object({
  type: z.enum(["person", "country", "organization", "theme"]),
  value: z.string().min(1),
});

export const parseEventRequestSchema = z.object({
  source_type: sourceTypeSchema,
  title: z.string().min(1).max(240).optional(),
  speaker: z.string().min(1).max(120).optional(),
  publisher: z.string().min(1).max(120).optional(),
  raw_uri: z.url().max(2000).optional(),
  occurred_at: z.iso.datetime().optional(),
  raw_text: z.string().min(20).max(20000),
});

export const parsedEventSchema = z.object({
  event_class: z.enum([
    "policy_speech",
    "live_commentary",
    "earnings_commentary",
    "macro_commentary",
    "market_commentary",
  ]),
  summary: z.string().min(1),
  sentiment: z.enum(["risk_on", "risk_off", "neutral"]),
  urgency_score: z.number().min(0).max(1),
  novelty_score: z.number().min(0).max(1),
  entities: z.array(entitySchema),
  themes: z.array(z.string().min(1)),
  candidate_assets: z.array(z.string().min(1)),
  why_it_matters: z.array(z.string().min(1)),
});

export const predictionHorizonSchema = z.enum(["1h", "1d", "5d"]);

export const generatedPredictionAssetSchema = z.object({
  ticker: z.string().min(1),
  expected_direction: z.enum(["up", "down", "mixed"]),
  expected_magnitude_bp: z.number().int(),
  conviction: z.number().min(0).max(1),
});

export const generatedPredictionSchema = z.object({
  horizon: predictionHorizonSchema,
  thesis: z.string().min(1),
  confidence: z.number().min(0).max(1),
  assets: z.array(generatedPredictionAssetSchema),
  evidence: z.array(z.string().min(1)),
  invalidations: z.array(z.string().min(1)),
  assumptions: z.array(z.string().min(1)),
});

export const generatePredictionRequestSchema = z.object({
  event: parsedEventSchema,
  horizons: z.array(predictionHorizonSchema).min(1).max(3).default(["1d"]),
  model_version: z.string().min(1).max(80).optional(),
});

export const generatePredictionResponseSchema = z.object({
  predictions: z.array(generatedPredictionSchema),
});

export const createSourceRequestSchema = parseEventRequestSchema;

export const storedSourceSchema = createSourceRequestSchema.extend({
  id: z.string().uuid(),
  created_at: z.iso.datetime(),
});

export const storedEventSchema = parsedEventSchema.extend({
  id: z.string().uuid(),
  source_id: z.string().uuid(),
  created_at: z.iso.datetime(),
});

export const createStoredPredictionsRequestSchema = z.object({
  horizons: z.array(predictionHorizonSchema).min(1).max(3).default(["1d"]),
  model_version: z.string().min(1).max(80).default("impact-engine-v0"),
});

export const modelStatusSchema = z.enum(["active", "experimental", "archived"]);
export const modelFeatureValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const createModelVersionRequestSchema = z.object({
  model_version: z.string().min(1).max(80),
  family: z.string().min(1).max(80),
  label: z.string().min(1).max(120).optional(),
  description: z.string().min(1).max(1000).optional(),
  owner: z.string().min(1).max(120).optional(),
  prompt_profile: z.string().min(1).max(120).optional(),
  status: modelStatusSchema.default("experimental"),
  feature_flags: z.record(z.string(), modelFeatureValueSchema).default({}),
});

export const storedModelVersionSchema = createModelVersionRequestSchema.extend({
  created_at: z.iso.datetime(),
});

export const listModelVersionsResponseSchema = z.object({
  models: z.array(storedModelVersionSchema),
});

export const predictionStatusSchema = z.enum(["pending", "scored", "reviewed"]);

export const storedPredictionSchema = generatedPredictionSchema.extend({
  id: z.string().uuid(),
  event_id: z.string().uuid(),
  model_version: z.string().min(1),
  status: predictionStatusSchema,
  created_at: z.iso.datetime(),
});

export const storedPredictionsResponseSchema = z.object({
  predictions: z.array(storedPredictionSchema),
});

export const realizedMoveSchema = z.object({
  ticker: z.string().min(1),
  realized_direction: z.enum(["up", "down", "mixed"]),
  realized_magnitude_bp: z.number().int(),
});

export const scorePredictionRequestSchema = z.object({
  measured_at: z.iso.datetime().optional(),
  realized_moves: z.array(realizedMoveSchema).min(1),
  timing_alignment: z.number().min(0).max(1).default(0.75),
  dominant_catalyst: z.string().min(1).max(240).optional(),
});

export const predictionOutcomeSchema = z.object({
  id: z.string().uuid(),
  prediction_id: z.string().uuid(),
  horizon: predictionHorizonSchema,
  measured_at: z.iso.datetime(),
  outcome_payload: z.object({
    realized_moves: z.array(realizedMoveSchema),
    timing_alignment: z.number().min(0).max(1),
    dominant_catalyst: z.string().optional(),
    predicted_asset_count: z.number().int().min(0).optional(),
    matched_asset_count: z.number().int().min(0).optional(),
    coverage_ratio: z.number().min(0).max(1).optional(),
  }),
  direction_score: z.number().min(0).max(1),
  magnitude_score: z.number().min(0).max(1),
  timing_score: z.number().min(0).max(1),
  calibration_score: z.number().min(0).max(1),
  total_score: z.number().min(0).max(1),
  created_at: z.iso.datetime(),
});

export const failureTagSchema = z.enum([
  "wrong_direction",
  "wrong_magnitude",
  "wrong_timing",
  "overconfidence",
  "underconfidence",
  "insufficient_signal",
  "weak_asset_mapping",
  "mixed_signal_environment",
  "competing_catalyst",
]);

export const postmortemSchema = z.object({
  id: z.string().uuid(),
  prediction_id: z.string().uuid(),
  verdict: z.enum(["correct", "partially_correct", "wrong"]),
  failure_tags: z.array(failureTagSchema),
  critique: z.string().min(1),
  lesson_summary: z.string().min(1),
  created_at: z.iso.datetime(),
});

export const lessonSchema = z.object({
  id: z.string().uuid(),
  prediction_id: z.string().uuid(),
  lesson_type: z.enum(["mistake", "reinforcement"]),
  lesson_summary: z.string().min(1),
  metadata: z.record(z.string(), z.string()),
  created_at: z.iso.datetime(),
});

export const predictionDetailSchema = z.object({
  prediction: storedPredictionSchema,
  outcome: predictionOutcomeSchema.nullable(),
  postmortem: postmortemSchema.nullable(),
});

export const postmortemResponseSchema = z.object({
  postmortem: postmortemSchema,
  lesson: lessonSchema,
});

export const listLessonsResponseSchema = z.object({
  lessons: z.array(lessonSchema),
});

export const autoScoreRequestSchema = z.object({
  as_of: z.iso.datetime().optional(),
  create_postmortems: z.boolean().default(true),
});

export const autoScoreItemSchema = z.object({
  prediction_id: z.string().uuid(),
  outcome: predictionOutcomeSchema,
  postmortem: postmortemSchema.nullable(),
  lesson: lessonSchema.nullable(),
});

export const autoScoreErrorSchema = z.object({
  prediction_id: z.string().uuid(),
  message: z.string().min(1),
});

export const autoScoreResponseSchema = z.object({
  processed: z.number().int().min(0),
  items: z.array(autoScoreItemSchema),
  errors: z.array(autoScoreErrorSchema),
});

export const analogMatchSchema = z.object({
  event_id: z.string().uuid(),
  prediction_id: z.string().uuid(),
  similarity: z.number().min(0).max(1),
  horizon: predictionHorizonSchema,
  event_summary: z.string().min(1),
  sentiment: z.enum(["risk_on", "risk_off", "neutral"]),
  themes: z.array(z.string().min(1)),
  total_score: z.number().min(0).max(1).nullable(),
  verdict: z.enum(["correct", "partially_correct", "wrong"]).nullable(),
  lesson_summary: z.string().nullable(),
  lesson_type: z.enum(["mistake", "reinforcement"]).nullable(),
});

export const eventAnalogsResponseSchema = z.object({
  event_id: z.string().uuid(),
  analogs: z.array(analogMatchSchema),
});

export const calibrationBucketSchema = z.object({
  bucket: z.string().min(1),
  count: z.number().int().min(0),
  average_confidence: z.number().min(0).max(1),
  realized_accuracy: z.number().min(0).max(1),
  average_total_score: z.number().min(0).max(1),
  calibration_gap: z.number().min(-1).max(1),
});

export const horizonCalibrationSchema = z.object({
  horizon: predictionHorizonSchema,
  sample_count: z.number().int().min(0),
  buckets: z.array(calibrationBucketSchema),
});

export const calibrationReportSchema = z.object({
  sample_count: z.number().int().min(0),
  average_total_score: z.number().min(0).max(1),
  horizons: z.array(horizonCalibrationSchema),
});

export const calibrationSnapshotRequestSchema = z.object({
  as_of: z.iso.datetime().optional(),
});

export const calibrationSnapshotSchema = z.object({
  id: z.string().uuid(),
  as_of: z.iso.datetime(),
  sample_count: z.number().int().min(0),
  average_total_score: z.number().min(0).max(1),
  report: calibrationReportSchema,
  created_at: z.iso.datetime(),
});

export const calibrationHistoryResponseSchema = z.object({
  snapshots: z.array(calibrationSnapshotSchema),
});

export const modelVersionHorizonMetricSchema = z.object({
  horizon: predictionHorizonSchema,
  sample_count: z.number().int().min(0),
  average_total_score: z.number().min(0).max(1),
  direction_accuracy: z.number().min(0).max(1),
  calibration_gap: z.number().min(-1).max(1),
});

export const modelVersionMetricSchema = z.object({
  model_version: z.string().min(1),
  registry: storedModelVersionSchema.nullable(),
  sample_count: z.number().int().min(0),
  reviewed_count: z.number().int().min(0),
  average_confidence: z.number().min(0).max(1),
  average_total_score: z.number().min(0).max(1),
  direction_accuracy: z.number().min(0).max(1),
  correct_rate: z.number().min(0).max(1),
  partial_rate: z.number().min(0).max(1),
  wrong_rate: z.number().min(0).max(1),
  calibration_gap: z.number().min(-1).max(1),
  latest_prediction_at: z.iso.datetime().nullable(),
  horizons: z.array(modelVersionHorizonMetricSchema),
});

export const modelComparisonReportSchema = z.object({
  generated_at: z.iso.datetime(),
  versions: z.array(modelVersionMetricSchema),
  leaders: z.object({
    by_average_total_score: z.string().nullable(),
    by_direction_accuracy: z.string().nullable(),
    by_calibration_alignment: z.string().nullable(),
  }),
});

export const selfAuditRequestSchema = z.object({
  as_of: z.iso.datetime().optional(),
  create_postmortems: z.boolean().default(true),
  capture_snapshot: z.boolean().default(true),
});

export const selfAuditResponseSchema = z.object({
  auto_score: autoScoreResponseSchema,
  calibration_snapshot: calibrationSnapshotSchema.nullable(),
  model_comparison: modelComparisonReportSchema,
});

export const lessonSearchResultSchema = z.object({
  lesson_id: z.string().uuid(),
  prediction_id: z.string().uuid(),
  event_id: z.string().uuid(),
  score: z.number().min(0).max(1),
  lesson_type: z.enum(["mistake", "reinforcement"]),
  lesson_summary: z.string().min(1),
  event_summary: z.string().min(1),
  themes: z.array(z.string().min(1)),
  horizon: predictionHorizonSchema,
  verdict: z.enum(["correct", "partially_correct", "wrong"]).nullable(),
  total_score: z.number().min(0).max(1).nullable(),
  created_at: z.iso.datetime(),
});

export const lessonSearchResponseSchema = z.object({
  query: z.string().min(1),
  results: z.array(lessonSearchResultSchema),
});

export const dashboardThemeStatSchema = z.object({
  theme: z.string().min(1),
  count: z.number().int().min(0),
});

export const dashboardActivityItemSchema = z.object({
  prediction_id: z.string().uuid(),
  event_id: z.string().uuid(),
  source_id: z.string().uuid(),
  source_title: z.string().min(1),
  event_summary: z.string().min(1),
  themes: z.array(z.string().min(1)),
  sentiment: z.enum(["risk_on", "risk_off", "neutral"]),
  horizon: predictionHorizonSchema,
  status: predictionStatusSchema,
  confidence: z.number().min(0).max(1),
  total_score: z.number().min(0).max(1).nullable(),
  verdict: z.enum(["correct", "partially_correct", "wrong"]).nullable(),
  lesson_summary: z.string().nullable(),
  created_at: z.iso.datetime(),
});

export const dashboardLiveStreamSchema = z.object({
  provider: z.enum(["generic", "deepgram", "assemblyai"]),
  external_stream_key: z.string().min(1),
  session_id: z.string().uuid(),
  title: z.string().min(1),
  speaker: z.string().nullable(),
  session_status: z.enum(["active", "closed"]),
  updated_at: z.iso.datetime(),
  chunk_count: z.number().int().min(0),
  last_theme: z.string().nullable(),
  buffered_chars: z.number().int().min(0),
  buffered_fragments: z.number().int().min(0),
});

export const systemOperationNameSchema = z.enum([
  "auto_score",
  "calibration_snapshot",
  "benchmark_snapshot",
  "walk_forward_snapshot",
  "integration_probe_snapshot",
  "integration_governance_refresh",
  "feed_pull",
  "transcript_pull",
  "high_confidence_seed",
  "benchmark_trust_refresh",
  "self_audit",
  "evolution_cycle",
  "promotion_cycle",
  "molt_cycle",
  "scheduled_evolution",
  "cpi_intelligence",
  "fomc_intelligence",
  "nfp_intelligence",
]);

export const operationRunStatusSchema = z.enum(["success", "failed", "partial"]);
export const operationRunTriggerSchema = z.enum(["api", "schedule", "script", "internal"]);
export const operationRunValueSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
export const jsonValueSchema: z.ZodType<
  string | number | boolean | null | Record<string, unknown> | unknown[]
> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)]),
);

export const operationRunRecordSchema = z.object({
  id: z.string().uuid(),
  operation_name: systemOperationNameSchema,
  status: operationRunStatusSchema,
  triggered_by: operationRunTriggerSchema,
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime(),
  duration_ms: z.number().int().min(0),
  metadata: z.record(z.string(), operationRunValueSchema),
  summary: z.record(z.string(), operationRunValueSchema),
  error_message: z.string().nullable(),
  created_at: z.iso.datetime(),
});

export const systemOperationHealthSchema = z.object({
  operation_name: systemOperationNameSchema,
  total_runs: z.number().int().min(0),
  success_count: z.number().int().min(0),
  failed_count: z.number().int().min(0),
  partial_count: z.number().int().min(0),
  latest_status: operationRunStatusSchema.nullable(),
  latest_triggered_by: operationRunTriggerSchema.nullable(),
  latest_started_at: z.iso.datetime().nullable(),
  latest_finished_at: z.iso.datetime().nullable(),
  average_duration_ms: z.number().int().min(0).nullable(),
  latest_error_message: z.string().nullable(),
});

export const operationRunHistoryResponseSchema = z.object({
  runs: z.array(operationRunRecordSchema),
});

export const systemOperationReportSchema = z.object({
  generated_at: z.iso.datetime(),
  counts: z.object({
    total: z.number().int().min(0),
    success: z.number().int().min(0),
    failed: z.number().int().min(0),
    partial: z.number().int().min(0),
  }),
  latest_failure: operationRunRecordSchema.nullable(),
  latest_runs: z.array(operationRunRecordSchema),
  operations: z.array(systemOperationHealthSchema),
});

export const operationLeaseRecordSchema = z.object({
  operation_name: systemOperationNameSchema,
  scope_key: z.string().min(1).max(240),
  owner: z.string().min(1).max(240),
  acquired_at: z.iso.datetime(),
  expires_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const operationLeaseListResponseSchema = z.object({
  leases: z.array(operationLeaseRecordSchema),
});

export const operationJobStatusSchema = z.enum(["pending", "running", "completed", "failed"]);

export const operationJobRecordSchema = z.object({
  id: z.string().uuid(),
  operation_name: systemOperationNameSchema,
  status: operationJobStatusSchema,
  triggered_by: operationRunTriggerSchema,
  payload: z.record(z.string(), jsonValueSchema),
  idempotency_key: z.string().min(1).max(120).nullable(),
  max_attempts: z.number().int().min(1).max(10),
  attempt_count: z.number().int().min(0),
  available_at: z.iso.datetime(),
  lease_owner: z.string().min(1).max(240).nullable(),
  lease_expires_at: z.iso.datetime().nullable(),
  started_at: z.iso.datetime().nullable(),
  finished_at: z.iso.datetime().nullable(),
  result_summary: z.record(z.string(), operationRunValueSchema),
  error_message: z.string().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const operationJobEnqueueRequestSchema = z.object({
  operation_name: systemOperationNameSchema,
  payload: z.record(z.string(), jsonValueSchema).default({}),
  idempotency_key: z.string().min(1).max(120).optional(),
  max_attempts: z.number().int().min(1).max(10).default(1),
  available_at: z.iso.datetime().optional(),
});

export const operationJobListResponseSchema = z.object({
  jobs: z.array(operationJobRecordSchema),
});

export const operationQueueReportSchema = z.object({
  generated_at: z.iso.datetime(),
  counts: z.object({
    pending: z.number().int().min(0),
    running: z.number().int().min(0),
    completed: z.number().int().min(0),
    failed: z.number().int().min(0),
    retry_scheduled: z.number().int().min(0),
    stale_running: z.number().int().min(0),
  }),
  oldest_pending_at: z.iso.datetime().nullable(),
  oldest_pending_age_ms: z.number().int().min(0).nullable(),
  longest_running_age_ms: z.number().int().min(0).nullable(),
  active_leases: z.number().int().min(0),
  latest_jobs: z.array(operationJobRecordSchema),
  leases: z.array(operationLeaseRecordSchema),
});

export const operationQueueAlertSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  signal: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
  recommendation: z.string().min(1),
});

export const operationQueueAlertReportSchema = z.object({
  generated_at: z.iso.datetime(),
  counts: z.object({
    low: z.number().int().min(0),
    medium: z.number().int().min(0),
    high: z.number().int().min(0),
  }),
  alerts: z.array(operationQueueAlertSchema),
});

export const systemOperationalIncidentSeveritySchema = z.enum(["low", "medium", "high"]);

export const systemOperationalIncidentSourceSchema = z.enum([
  "queue",
  "worker",
  "worker_service",
  "integration",
]);

export const systemOperationalIncidentSchema = z.object({
  severity: systemOperationalIncidentSeveritySchema,
  source: systemOperationalIncidentSourceSchema,
  signal: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
  recommendation: z.string().min(1),
});

export const systemOperationalIncidentReportSchema = z.object({
  generated_at: z.iso.datetime(),
  counts: z.object({
    low: z.number().int().min(0),
    medium: z.number().int().min(0),
    high: z.number().int().min(0),
  }),
  incidents: z.array(systemOperationalIncidentSchema),
});

export const systemIntegrationSchema = z.enum(["feed", "transcript"]);
export const systemIntegrationSeveritySchema = z.enum(["healthy", "degraded", "critical"]);

export const systemIntegrationHealthSchema = z.object({
  integration: systemIntegrationSchema,
  operation_name: z.enum(["feed_pull", "transcript_pull"]),
  severity: systemIntegrationSeveritySchema,
  total_jobs: z.number().int().min(0),
  pending_jobs: z.number().int().min(0),
  running_jobs: z.number().int().min(0),
  completed_jobs: z.number().int().min(0),
  failed_jobs: z.number().int().min(0),
  retry_scheduled_jobs: z.number().int().min(0),
  stale_running_jobs: z.number().int().min(0),
  retryable_failures: z.number().int().min(0),
  non_retryable_failures: z.number().int().min(0),
  stale_recovered_jobs: z.number().int().min(0),
  latest_job_at: z.iso.datetime().nullable(),
  latest_failure_at: z.iso.datetime().nullable(),
  latest_status: operationJobStatusSchema.nullable(),
  latest_attempt_count: z.number().int().min(0).nullable(),
  latest_error_message: z.string().nullable(),
  latest_status_code: z.number().int().nullable(),
});

export const systemIntegrationIncidentSchema = z.object({
  id: z.string().uuid(),
  integration: systemIntegrationSchema,
  operation_name: z.enum(["feed_pull", "transcript_pull"]),
  status: operationJobStatusSchema,
  retryable: z.boolean().nullable(),
  status_code: z.number().int().nullable(),
  attempt_count: z.number().int().min(0),
  updated_at: z.iso.datetime(),
  error_message: z.string().nullable(),
});

export const systemIntegrationAlertSchema = z.object({
  integration: systemIntegrationSchema,
  severity: systemIntegrationSeveritySchema,
  signal: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
  recommendation: z.string().min(1),
});

export const systemIntegrationReportSchema = z.object({
  generated_at: z.iso.datetime(),
  counts: z.object({
    healthy: z.number().int().min(0),
    degraded: z.number().int().min(0),
    critical: z.number().int().min(0),
  }),
  integrations: z.array(systemIntegrationHealthSchema),
  alerts: z.array(systemIntegrationAlertSchema),
  recent_incidents: z.array(systemIntegrationIncidentSchema),
});

export const systemIntegrationTrendBucketSchema = z.object({
  bucket_started_at: z.iso.datetime(),
  bucket_finished_at: z.iso.datetime(),
  completed: z.number().int().min(0),
  failed: z.number().int().min(0),
  retry_scheduled: z.number().int().min(0),
  non_retryable_failures: z.number().int().min(0),
  stale_recovered: z.number().int().min(0),
});

export const systemIntegrationTrendSliceSchema = z.object({
  integration: systemIntegrationSchema,
  operation_name: z.enum(["feed_pull", "transcript_pull"]),
  counts: z.object({
    completed: z.number().int().min(0),
    failed: z.number().int().min(0),
    retry_scheduled: z.number().int().min(0),
    non_retryable_failures: z.number().int().min(0),
    stale_recovered: z.number().int().min(0),
  }),
  trend_signal: z.enum(["quiet", "stable", "worsening", "recovering"]),
  latest_incident_at: z.iso.datetime().nullable(),
  buckets: z.array(systemIntegrationTrendBucketSchema),
});

export const systemIntegrationTrendReportSchema = z.object({
  generated_at: z.iso.datetime(),
  window_hours: z.number().int().min(1),
  bucket_hours: z.number().int().min(1),
  slices: z.array(systemIntegrationTrendSliceSchema),
  alerts: z.array(systemIntegrationAlertSchema),
  recent_incidents: z.array(systemIntegrationIncidentSchema),
});

export const systemIntegrationProbeStatusSchema = z.enum(["ready", "degraded", "unknown"]);

export const systemIntegrationProbeTargetSchema = z.object({
  integration: systemIntegrationSchema,
  url: z.url(),
  status: systemIntegrationProbeStatusSchema,
  latency_ms: z.number().int().min(0).nullable(),
  status_code: z.number().int().nullable(),
  content_type: z.string().nullable(),
  detail: z.string().nullable(),
  checked_at: z.iso.datetime(),
});

export const systemIntegrationProbeSummarySchema = z.object({
  integration: systemIntegrationSchema,
  configured_targets: z.number().int().min(0),
  ready_targets: z.number().int().min(0),
  degraded_targets: z.number().int().min(0),
  unknown_targets: z.number().int().min(0),
  highest_status: systemIntegrationProbeStatusSchema,
});

export const systemIntegrationProbeReportSchema = z.object({
  generated_at: z.iso.datetime(),
  timeout_ms: z.number().int().min(1),
  configured_target_count: z.number().int().min(0),
  ready_target_count: z.number().int().min(0),
  degraded_target_count: z.number().int().min(0),
  unknown_target_count: z.number().int().min(0),
  summaries: z.array(systemIntegrationProbeSummarySchema),
  alerts: z.array(systemIntegrationAlertSchema),
  targets: z.array(systemIntegrationProbeTargetSchema),
});

export const integrationProbeSnapshotRequestSchema = z.object({
  integrations: z.array(systemIntegrationSchema).min(1).max(2).default(["feed", "transcript"]),
  timeout_ms: z.number().int().min(250).max(30_000).optional(),
});

export const integrationGovernanceRefreshRequestSchema = z.object({
  integrations: z.array(systemIntegrationSchema).min(1).max(2).default(["feed", "transcript"]),
  freshness_ms: z.number().int().min(1_000).max(60 * 60 * 1000).optional(),
  timeout_ms: z.number().int().min(250).max(30_000).optional(),
});

export const systemIntegrationProbeStateSchema = z.object({
  integration: systemIntegrationSchema,
  timeout_ms: z.number().int().min(1),
  configured_targets: z.number().int().min(0),
  ready_targets: z.number().int().min(0),
  degraded_targets: z.number().int().min(0),
  unknown_targets: z.number().int().min(0),
  highest_status: systemIntegrationProbeStatusSchema,
  targets: z.array(systemIntegrationProbeTargetSchema),
  checked_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const systemIntegrationGovernanceActionSchema = z.enum([
  "allow",
  "throttle",
  "suppress",
]);

export const systemIntegrationGovernanceStateSchema = z.object({
  integration: systemIntegrationSchema,
  operation_name: z.enum(["feed_pull", "transcript_pull"]),
  action: systemIntegrationGovernanceActionSchema,
  highest_probe_status: systemIntegrationProbeStatusSchema,
  configured_targets: z.number().int().min(0),
  ready_targets: z.number().int().min(0),
  degraded_targets: z.number().int().min(0),
  unknown_targets: z.number().int().min(0),
  recent_retry_scheduled: z.number().int().min(0),
  recent_non_retryable_failures: z.number().int().min(0),
  recent_stale_recovered: z.number().int().min(0),
  recent_trend_signal: z.enum(["quiet", "stable", "worsening", "recovering"]),
  degraded_since: z.iso.datetime().nullable(),
  outage_since: z.iso.datetime().nullable(),
  hold_until: z.iso.datetime().nullable(),
  retry_delay_seconds: z.number().int().min(1).nullable(),
  reason: z.string().min(1),
  detail: z.string().min(1),
  checked_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const systemIntegrationGovernanceReportSchema = z.object({
  generated_at: z.iso.datetime(),
  freshness_ms: z.number().int().min(1),
  states: z.array(systemIntegrationGovernanceStateSchema),
  alerts: z.array(systemIntegrationAlertSchema),
});

export const operationWorkerLifecycleStateSchema = z.enum([
  "starting",
  "running",
  "stopping",
  "stopped",
]);

export const operationWorkerRecordSchema = z.object({
  worker_id: z.string().min(1).max(240),
  lifecycle_state: operationWorkerLifecycleStateSchema,
  supported_operations: z.array(systemOperationNameSchema),
  poll_interval_ms: z.number().int().min(0).nullable(),
  idle_backoff_ms: z.number().int().min(0).nullable(),
  started_at: z.iso.datetime(),
  last_heartbeat_at: z.iso.datetime(),
  last_cycle_started_at: z.iso.datetime().nullable(),
  last_cycle_finished_at: z.iso.datetime().nullable(),
  last_cycle_processed: z.number().int().min(0).nullable(),
  last_cycle_completed: z.number().int().min(0).nullable(),
  last_cycle_failed: z.number().int().min(0).nullable(),
  last_cycle_retried: z.number().int().min(0).nullable(),
  last_cycle_abandoned: z.number().int().min(0).nullable(),
  total_cycles: z.number().int().min(0),
  total_processed: z.number().int().min(0),
  total_completed: z.number().int().min(0),
  total_failed: z.number().int().min(0),
  total_retried: z.number().int().min(0),
  total_abandoned: z.number().int().min(0),
  last_error_message: z.string().nullable(),
  stopped_at: z.iso.datetime().nullable(),
  updated_at: z.iso.datetime(),
});

export const operationWorkerEventTypeSchema = z.enum(["started", "cycle", "stopped"]);

export const operationWorkerEventRecordSchema = z.object({
  id: z.string().uuid(),
  worker_id: z.string().min(1).max(240),
  event_type: operationWorkerEventTypeSchema,
  occurred_at: z.iso.datetime(),
  lifecycle_state: operationWorkerLifecycleStateSchema.nullable(),
  cycle_processed: z.number().int().min(0).nullable(),
  cycle_completed: z.number().int().min(0).nullable(),
  cycle_failed: z.number().int().min(0).nullable(),
  cycle_retried: z.number().int().min(0).nullable(),
  cycle_abandoned: z.number().int().min(0).nullable(),
  error_message: z.string().nullable(),
  metadata: z.record(z.string(), operationRunValueSchema),
  created_at: z.iso.datetime(),
});

export const operationWorkerServiceLifecycleStateSchema = z.enum([
  "starting",
  "running",
  "backing_off",
  "stopping",
  "stopped",
  "failed",
]);

export const operationWorkerServiceRecordSchema = z.object({
  service_id: z.string().min(1).max(240),
  worker_id: z.string().min(1).max(240),
  lifecycle_state: operationWorkerServiceLifecycleStateSchema,
  supported_operations: z.array(systemOperationNameSchema),
  supervisor_pid: z.number().int().min(1).nullable(),
  supervisor_host: z.string().min(1).max(240).nullable(),
  supervisor_instance_id: z.string().min(1).max(120).nullable(),
  invocation_mode: z.string().min(1).max(240).nullable(),
  supervisor_backoff_ms: z.number().int().min(0),
  success_window_ms: z.number().int().min(0),
  heartbeat_interval_ms: z.number().int().min(1),
  max_restarts: z.number().int().min(1),
  restart_count: z.number().int().min(0),
  restart_streak: z.number().int().min(0),
  current_restart_backoff_ms: z.number().int().min(0).nullable(),
  started_at: z.iso.datetime(),
  last_heartbeat_at: z.iso.datetime(),
  last_loop_started_at: z.iso.datetime().nullable(),
  last_loop_finished_at: z.iso.datetime().nullable(),
  last_loop_runtime_ms: z.number().int().min(0).nullable(),
  last_exit_code: z.number().int().nullable(),
  last_exit_signal: z.string().nullable(),
  last_error_message: z.string().nullable(),
  stopped_at: z.iso.datetime().nullable(),
  updated_at: z.iso.datetime(),
});

export const operationWorkerServiceEventTypeSchema = z.enum([
  "started",
  "ownership_conflict",
  "loop_exit",
  "stopped",
  "failed",
]);

export const operationWorkerServiceEventRecordSchema = z.object({
  id: z.string().uuid(),
  service_id: z.string().min(1).max(240),
  worker_id: z.string().min(1).max(240),
  event_type: operationWorkerServiceEventTypeSchema,
  occurred_at: z.iso.datetime(),
  lifecycle_state: operationWorkerServiceLifecycleStateSchema.nullable(),
  scheduled_restart: z.boolean().nullable(),
  restart_count: z.number().int().min(0).nullable(),
  restart_streak: z.number().int().min(0).nullable(),
  loop_runtime_ms: z.number().int().min(0).nullable(),
  exit_code: z.number().int().nullable(),
  exit_signal: z.string().nullable(),
  error_message: z.string().nullable(),
  metadata: z.record(z.string(), operationRunValueSchema),
  created_at: z.iso.datetime(),
});

export const systemWorkerStatusSchema = z.enum(["active", "stale", "stopped"]);

export const systemWorkerHealthSchema = operationWorkerRecordSchema.extend({
  status: systemWorkerStatusSchema,
  stale_after_ms: z.number().int().min(0),
  heartbeat_age_ms: z.number().int().min(0),
});

export const systemWorkerServiceStatusSchema = z.enum([
  "active",
  "backing_off",
  "stale",
  "stopped",
  "failed",
]);

export const systemWorkerServiceHealthSchema = operationWorkerServiceRecordSchema.extend({
  status: systemWorkerServiceStatusSchema,
  stale_after_ms: z.number().int().min(0),
  heartbeat_age_ms: z.number().int().min(0),
  restart_due_at: z.iso.datetime().nullable(),
  remaining_restart_backoff_ms: z.number().int().min(0).nullable(),
});

export const systemWorkerReportSchema = z.object({
  generated_at: z.iso.datetime(),
  counts: z.object({
    total: z.number().int().min(0),
    active: z.number().int().min(0),
    stale: z.number().int().min(0),
    stopped: z.number().int().min(0),
  }),
  workers: z.array(systemWorkerHealthSchema),
});

export const systemWorkerServiceReportSchema = z.object({
  generated_at: z.iso.datetime(),
  counts: z.object({
    total: z.number().int().min(0),
    active: z.number().int().min(0),
    backing_off: z.number().int().min(0),
    stale: z.number().int().min(0),
    stopped: z.number().int().min(0),
    failed: z.number().int().min(0),
  }),
  services: z.array(systemWorkerServiceHealthSchema),
});

export const systemWorkerServiceTrendBucketSchema = z.object({
  bucket_started_at: z.iso.datetime(),
  bucket_finished_at: z.iso.datetime(),
  started: z.number().int().min(0),
  ownership_conflicts: z.number().int().min(0),
  loop_exits: z.number().int().min(0),
  scheduled_restarts: z.number().int().min(0),
  stopped: z.number().int().min(0),
  failed: z.number().int().min(0),
});

export const systemWorkerServiceTrendAlertSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  signal: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
  recommendation: z.string().min(1),
});

export const systemWorkerServiceTrendReportSchema = z.object({
  generated_at: z.iso.datetime(),
  window_hours: z.number().int().min(1),
  bucket_hours: z.number().int().min(1),
  counts: z.object({
    started: z.number().int().min(0),
    ownership_conflicts: z.number().int().min(0),
    loop_exits: z.number().int().min(0),
    scheduled_restarts: z.number().int().min(0),
    stopped: z.number().int().min(0),
    failed: z.number().int().min(0),
  }),
  buckets: z.array(systemWorkerServiceTrendBucketSchema),
  recent_events: z.array(operationWorkerServiceEventRecordSchema),
  alerts: z.array(systemWorkerServiceTrendAlertSchema),
});

export const systemWorkerTrendBucketSchema = z.object({
  bucket_started_at: z.iso.datetime(),
  bucket_finished_at: z.iso.datetime(),
  started: z.number().int().min(0),
  stopped: z.number().int().min(0),
  error_stops: z.number().int().min(0),
  cycles: z.number().int().min(0),
  processed: z.number().int().min(0),
  completed: z.number().int().min(0),
  failed: z.number().int().min(0),
  retried: z.number().int().min(0),
  abandoned: z.number().int().min(0),
});

export const systemWorkerTrendAlertSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  signal: z.string().min(1),
  title: z.string().min(1),
  detail: z.string().min(1),
  recommendation: z.string().min(1),
});

export const systemWorkerTrendReportSchema = z.object({
  generated_at: z.iso.datetime(),
  window_hours: z.number().int().min(1),
  bucket_hours: z.number().int().min(1),
  counts: z.object({
    started: z.number().int().min(0),
    stopped: z.number().int().min(0),
    error_stops: z.number().int().min(0),
    cycles: z.number().int().min(0),
    processed: z.number().int().min(0),
    completed: z.number().int().min(0),
    failed: z.number().int().min(0),
    retried: z.number().int().min(0),
    abandoned: z.number().int().min(0),
  }),
  buckets: z.array(systemWorkerTrendBucketSchema),
  recent_events: z.array(operationWorkerEventRecordSchema),
  alerts: z.array(systemWorkerTrendAlertSchema),
});

export const readinessDependencyStatusSchema = z.object({
  name: z.string().min(1),
  status: z.enum(["ready", "degraded", "unknown"]),
  latency_ms: z.number().int().min(0).nullable(),
  detail: z.string().min(1).nullable(),
});

export const readinessResponseSchema = z.object({
  ok: z.boolean(),
  service: z.string().min(1),
  checked_at: z.iso.datetime(),
  dependencies: z.array(readinessDependencyStatusSchema),
});

export const dashboardSummarySchema = z.object({
  totals: z.object({
    predictions: z.number().int().min(0),
    pending: z.number().int().min(0),
    scored: z.number().int().min(0),
    reviewed: z.number().int().min(0),
    lessons: z.number().int().min(0),
  }),
  live_streams: z.object({
    active_bindings: z.number().int().min(0),
    recent_bindings: z.array(dashboardLiveStreamSchema),
  }),
  top_themes: z.array(dashboardThemeStatSchema),
  recent_activity: z.array(dashboardActivityItemSchema),
});

export const dashboardSourcePreviewSchema = z.object({
  id: z.string().uuid(),
  source_type: sourceTypeSchema,
  title: z.string().min(1),
  speaker: z.string().nullable(),
  occurred_at: z.string().nullable(),
  raw_text_excerpt: z.string().min(1),
});

export const dashboardEventPreviewSchema = z.object({
  id: z.string().uuid(),
  summary: z.string().min(1),
  themes: z.array(z.string().min(1)),
  sentiment: z.enum(["risk_on", "risk_off", "neutral"]),
  urgency_score: z.number().min(0).max(1),
  novelty_score: z.number().min(0).max(1),
});

export const dashboardPredictionPreviewSchema = z.object({
  id: z.string().uuid(),
  horizon: predictionHorizonSchema,
  status: predictionStatusSchema,
  confidence: z.number().min(0).max(1),
  thesis: z.string().min(1),
  assets: z.array(generatedPredictionAssetSchema),
  evidence: z.array(z.string().min(1)),
  invalidations: z.array(z.string().min(1)),
  created_at: z.iso.datetime(),
});

export const dashboardOutcomePreviewSchema = z.object({
  measured_at: z.iso.datetime(),
  total_score: z.number().min(0).max(1),
  direction_score: z.number().min(0).max(1),
  magnitude_score: z.number().min(0).max(1),
  timing_score: z.number().min(0).max(1),
  calibration_score: z.number().min(0).max(1),
});

export const dashboardLessonPreviewSchema = z.object({
  lesson_type: z.enum(["mistake", "reinforcement"]),
  verdict: z.enum(["correct", "partially_correct", "wrong"]).nullable(),
  lesson_summary: z.string().min(1),
  critique: z.string().nullable(),
});

export const dashboardCalibrationPreviewSchema = z.object({
  confidence_bucket: z.string().min(1),
  confidence: z.number().min(0).max(1),
  realized_accuracy: z.number().min(0).max(1).nullable(),
  calibration_gap: z.number().min(-1).max(1).nullable(),
  signal: z.enum(["overconfident", "underconfident", "aligned", "insufficient_data"]),
});

export const dashboardPipelineItemSchema = z.object({
  source: dashboardSourcePreviewSchema,
  event: dashboardEventPreviewSchema,
  analogs: z.array(analogMatchSchema),
  prediction: dashboardPredictionPreviewSchema,
  outcome: dashboardOutcomePreviewSchema.nullable(),
  lesson: dashboardLessonPreviewSchema.nullable(),
  calibration: dashboardCalibrationPreviewSchema,
});

export const dashboardPipelineResponseSchema = z.object({
  items: z.array(dashboardPipelineItemSchema),
});

export const historicalCaseSurpriseTypeSchema = z.enum([
  "positive",
  "negative",
  "mixed",
  "none",
]);

export const historicalCaseQualitySchema = z.enum([
  "draft",
  "reviewed",
  "high_confidence",
]);

export const historicalCaseLabelSourceSchema = z.enum([
  "manual",
  "inferred",
  "hybrid",
]);

export const historicalCaseLabelSchema = z.object({
  event_family: z.string().min(1).max(80).nullable(),
  tags: z.array(z.string().min(1).max(80)),
  regimes: z.array(z.string().min(1).max(80)),
  regions: z.array(z.string().min(1).max(80)),
  sectors: z.array(z.string().min(1).max(80)),
  primary_themes: z.array(z.string().min(1).max(80)),
  primary_assets: z.array(z.string().min(1).max(40)),
  competing_catalysts: z.array(z.string().min(1).max(120)),
  surprise_type: historicalCaseSurpriseTypeSchema,
  case_quality: historicalCaseQualitySchema,
  label_source: historicalCaseLabelSourceSchema,
  notes: z.string().max(1000).nullable(),
});

export const historicalCaseReviewMetadataSchema = z.object({
  review_hints: z.array(z.string().min(1).max(240)).max(12),
  reviewer: z.string().min(1).max(120).nullable(),
  review_notes: z.string().max(2000).nullable(),
  reviewed_at: z.iso.datetime().nullable(),
  adjudicated_at: z.iso.datetime().nullable(),
});

export const historicalCaseLabelInputSchema = z.object({
  event_family: z.string().min(1).max(80).nullable().optional(),
  tags: z.array(z.string().min(1).max(80)).optional(),
  regimes: z.array(z.string().min(1).max(80)).optional(),
  regions: z.array(z.string().min(1).max(80)).optional(),
  sectors: z.array(z.string().min(1).max(80)).optional(),
  primary_themes: z.array(z.string().min(1).max(80)).optional(),
  primary_assets: z.array(z.string().min(1).max(40)).optional(),
  competing_catalysts: z.array(z.string().min(1).max(120)).optional(),
  surprise_type: historicalCaseSurpriseTypeSchema.optional(),
  case_quality: historicalCaseQualitySchema.optional(),
  notes: z.string().max(1000).nullable().optional(),
});

export const historicalIngestItemSchema = z.object({
  source: createSourceRequestSchema,
  horizon: predictionHorizonSchema,
  realized_moves: z.array(realizedMoveSchema).min(1),
  timing_alignment: z.number().min(0).max(1),
  dominant_catalyst: z.string().min(1).max(240).default("historical-backfill"),
  model_version: z.string().min(1).max(80).default("historical-backfill-v1"),
});

export const historicalIngestRequestSchema = z.object({
  items: z.array(historicalIngestItemSchema).min(1),
});

export const historicalIngestResultSchema = z.object({
  source_id: z.string().uuid(),
  event_id: z.string().uuid(),
  prediction_id: z.string().uuid(),
  verdict: z.enum(["correct", "partially_correct", "wrong"]),
  total_score: z.number().min(0).max(1),
});

export const historicalIngestResponseSchema = z.object({
  ingested: z.number().int().min(0),
  results: z.array(historicalIngestResultSchema),
});

export const historicalCaseLibraryItemSchema = z.object({
  case_id: z.string().min(1).max(120),
  case_pack: z.string().min(1).max(120),
  source: createSourceRequestSchema,
  horizon: predictionHorizonSchema,
  realized_moves: z.array(realizedMoveSchema).min(1),
  timing_alignment: z.number().min(0).max(1),
  dominant_catalyst: z.string().min(1).max(240),
  parsed_event: parsedEventSchema,
  labels: historicalCaseLabelSchema,
  review: historicalCaseReviewMetadataSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const historicalCaseLibraryDraftSchema = z.object({
  case_id: z.string().min(1).max(120).optional(),
  case_pack: z.string().min(1).max(120).default("custom"),
  source: createSourceRequestSchema,
  horizon: predictionHorizonSchema,
  realized_moves: z.array(realizedMoveSchema).min(1),
  timing_alignment: z.number().min(0).max(1),
  dominant_catalyst: z.string().min(1).max(240).default("historical-library"),
  labels: historicalCaseLabelInputSchema.optional(),
  review_hints: z.array(z.string().min(1).max(240)).max(12).optional(),
  model_version: z.string().min(1).max(80).optional(),
});

export const historicalCaseLibraryIngestionModeSchema = z.enum([
  "merge",
  "manual_only",
  "inferred_only",
]);

export const historicalCaseLibraryIngestionRequestSchema = z.object({
  items: z.array(historicalCaseLibraryDraftSchema).min(1).max(500),
  store_library: z.boolean().default(true),
  ingest_reviewed_memory: z.boolean().default(true),
  fallback_model_version: z.string().min(1).max(80).default("historical-library-v1"),
  labeling_mode: historicalCaseLibraryIngestionModeSchema.default("merge"),
});

export const historicalCaseLibraryIngestionResultSchema = z.object({
  case_id: z.string().min(1).max(120),
  case_pack: z.string().min(1).max(120),
  case_quality: historicalCaseQualitySchema,
  label_source: historicalCaseLabelSourceSchema,
  themes: z.array(z.string().min(1).max(80)),
  primary_assets: z.array(z.string().min(1).max(40)),
  stored_in_library: z.boolean(),
  reviewed_prediction_id: z.string().uuid().nullable(),
  verdict: z.enum(["correct", "partially_correct", "wrong"]).nullable(),
  total_score: z.number().min(0).max(1).nullable(),
});

export const historicalCaseLibraryIngestionResponseSchema = z.object({
  ingested_cases: z.number().int().min(0),
  stored_library_items: z.number().int().min(0),
  reviewed_ingests: z.number().int().min(0),
  results: z.array(historicalCaseLibraryIngestionResultSchema),
});

export const historicalCaseLibraryListResponseSchema = z.object({
  items: z.array(historicalCaseLibraryItemSchema),
});

export const historicalCaseLibraryReviewRequestSchema = z.object({
  case_pack: z.string().min(1).max(120).optional(),
  labels: historicalCaseLabelInputSchema.optional(),
  case_quality: historicalCaseQualitySchema.optional(),
  reviewer: z.string().min(1).max(120).optional(),
  review_notes: z.string().max(2000).nullable().optional(),
  review_hints: z.array(z.string().min(1).max(240)).max(12).optional(),
  labeling_mode: historicalCaseLibraryIngestionModeSchema.default("merge"),
  ingest_reviewed_memory: z.boolean().default(false),
  model_version: z.string().min(1).max(80).default("historical-library-review-v1"),
});

export const historicalCaseLibraryReviewResponseSchema = z.object({
  item: historicalCaseLibraryItemSchema,
  reviewed_prediction_id: z.string().uuid().nullable(),
  verdict: z.enum(["correct", "partially_correct", "wrong"]).nullable(),
  total_score: z.number().min(0).max(1).nullable(),
});

export const historicalCaseConfidenceRecommendationSchema = z.enum([
  "promote",
  "watch",
  "needs_more_review",
]);

export const historicalHighConfidenceCandidateSchema = z.object({
  case_id: z.string().min(1).max(120),
  case_pack: z.string().min(1).max(120),
  title: z.string().min(1).max(240),
  current_quality: historicalCaseQualitySchema,
  candidate_score: z.number().min(0).max(1),
  recommendation: historicalCaseConfidenceRecommendationSchema,
  strengths: z.array(z.string().min(1).max(240)).max(12),
  blockers: z.array(z.string().min(1).max(240)).max(12),
  reviewer: z.string().min(1).max(120).nullable(),
  reviewed_at: z.iso.datetime().nullable(),
  label_source: historicalCaseLabelSourceSchema,
  regimes: z.array(z.string().min(1).max(80)).max(20),
  primary_themes: z.array(z.string().min(1).max(80)).max(20),
  primary_assets: z.array(z.string().min(1).max(40)).max(20),
});

export const historicalHighConfidenceCandidateReportSchema = z.object({
  generated_at: z.iso.datetime(),
  total_reviewed_cases: z.number().int().min(0),
  eligible_candidate_count: z.number().int().min(0),
  promotable_count: z.number().int().min(0),
  candidates: z.array(historicalHighConfidenceCandidateSchema),
});

export const historicalHighConfidencePromotionRequestSchema = z.object({
  reviewer: z.string().min(1).max(120).optional(),
  review_notes: z.string().max(2000).nullable().optional(),
  review_hints: z.array(z.string().min(1).max(240)).max(12).optional(),
  labels: historicalCaseLabelInputSchema.optional(),
  labeling_mode: historicalCaseLibraryIngestionModeSchema.default("merge"),
  ingest_reviewed_memory: z.boolean().default(false),
  model_version: z
    .string()
    .min(1)
    .max(80)
    .default("historical-library-high-confidence-v1"),
  min_candidate_score: z.number().min(0).max(1).default(0.75),
});

export const historicalHighConfidencePromotionResponseSchema =
  historicalCaseLibraryReviewResponseSchema.extend({
    candidate: historicalHighConfidenceCandidateSchema,
  });

export const historicalHighConfidenceSeedRequestSchema = z.object({
  benchmark_pack_id: z.string().min(1).max(120).default("core_benchmark_v1"),
  reviewer: z.string().min(1).max(120).default("core-corpus-seed"),
  case_pack_filters: z.array(z.string().min(1).max(120)).min(1).max(20).optional(),
  prioritize_gap_regimes: z.boolean().default(true),
  prioritize_walk_forward_regimes: z.boolean().default(true),
  target_regimes: z.array(z.string().min(1).max(80)).min(1).max(20).optional(),
  limit: z.number().int().min(1).max(100).default(12),
  min_candidate_score: z.number().min(0).max(1).default(0.8),
  dry_run: z.boolean().default(false),
  ingest_reviewed_memory: z.boolean().default(false),
  model_version: z
    .string()
    .min(1)
    .max(80)
    .default("historical-library-high-confidence-v1"),
});

export const historicalHighConfidenceSeedItemSchema = z.object({
  case_id: z.string().min(1).max(120),
  case_pack: z.string().min(1).max(120),
  title: z.string().min(1).max(240),
  action: z.enum(["promoted", "skipped"]),
  reason: z.string().min(1).max(240),
  candidate: historicalHighConfidenceCandidateSchema,
  final_case_quality: historicalCaseQualitySchema,
});

export const historicalHighConfidenceSeedResponseSchema = z.object({
  generated_at: z.iso.datetime(),
  reviewer: z.string().min(1).max(120),
  dry_run: z.boolean(),
  scanned_reviewed_cases: z.number().int().min(0),
  candidate_count: z.number().int().min(0),
  promoted_count: z.number().int().min(0),
  skipped_count: z.number().int().min(0),
  min_candidate_score: z.number().min(0).max(1),
  case_pack_filters: z.array(z.string().min(1).max(120)),
  prioritized_regimes: z.array(z.string().min(1).max(80)),
  promoted_regimes: z.array(z.lazy(() => historicalLibraryCoverageBucketSchema)),
  items: z.array(historicalHighConfidenceSeedItemSchema),
});

export const historicalLibraryCoverageBucketSchema = z.object({
  name: z.string().min(1).max(120),
  count: z.number().int().min(0),
});

export const historicalLibraryCoveragePackSchema = z.object({
  case_pack: z.string().min(1).max(120),
  count: z.number().int().min(0),
  draft_count: z.number().int().min(0),
  reviewed_count: z.number().int().min(0),
  high_confidence_count: z.number().int().min(0),
  last_updated_at: z.iso.datetime().nullable(),
});

export const historicalLibraryCoverageReviewQueueSchema = z.object({
  assigned_cases: z.number().int().min(0),
  unassigned_cases: z.number().int().min(0),
  adjudicated_cases: z.number().int().min(0),
});

export const historicalLibraryCoverageResponseSchema = z.object({
  generated_at: z.iso.datetime(),
  total_cases: z.number().int().min(0),
  needs_review_count: z.number().int().min(0),
  reviewed_cases: z.number().int().min(0),
  high_confidence_cases: z.number().int().min(0),
  unique_case_packs: z.number().int().min(0),
  unique_event_families: z.number().int().min(0),
  unique_regimes: z.number().int().min(0),
  unique_regions: z.number().int().min(0),
  unique_themes: z.number().int().min(0),
  review_queue: historicalLibraryCoverageReviewQueueSchema,
  by_case_pack: z.array(historicalLibraryCoveragePackSchema),
  by_case_quality: z.array(historicalLibraryCoverageBucketSchema),
  by_event_family: z.array(historicalLibraryCoverageBucketSchema),
  by_regime: z.array(historicalLibraryCoverageBucketSchema),
  by_source_type: z.array(historicalLibraryCoverageBucketSchema),
  by_region: z.array(historicalLibraryCoverageBucketSchema),
  by_theme: z.array(historicalLibraryCoverageBucketSchema),
  by_horizon: z.array(historicalLibraryCoverageBucketSchema),
});

export const historicalLibraryGapSeveritySchema = z.enum(["low", "medium", "high"]);

export const historicalLibraryGapAlertSchema = z.object({
  category: z.enum([
    "library_depth",
    "pack_coverage",
    "regime_coverage",
    "review_backlog",
    "review_assignment",
    "high_confidence_gap",
    "source_type_diversity",
  ]),
  severity: historicalLibraryGapSeveritySchema,
  target: z.string().min(1).max(120),
  title: z.string().min(1).max(160),
  rationale: z.string().min(1).max(500),
  recommendation: z.string().min(1).max(500),
});

export const historicalLibraryGapReportSchema = z.object({
  generated_at: z.iso.datetime(),
  alert_count: z.number().int().min(0),
  counts: z.object({
    high: z.number().int().min(0),
    medium: z.number().int().min(0),
    low: z.number().int().min(0),
  }),
  alerts: z.array(historicalLibraryGapAlertSchema),
});

export const macroHistoricalEventTypeSchema = z.enum([
  "cpi",
  "nfp",
  "fomc",
  "fed_speech",
]);

export const macroHistoricalSignalBiasSchema = z.enum([
  "hotter",
  "cooler",
  "stronger",
  "softer",
  "dovish",
  "hawkish",
  "mixed",
  "neutral",
]);

export const macroHistoricalCaseInputSchema = z.object({
  case_id: z.string().min(1).max(120).optional(),
  case_pack: z.string().min(1).max(120).default("macro_calendar_v1"),
  event_type: macroHistoricalEventTypeSchema,
  signal_bias: macroHistoricalSignalBiasSchema.default("neutral"),
  title: z.string().min(1).max(240).optional(),
  summary: z.string().min(12).max(4000),
  occurred_at: z.iso.datetime().optional(),
  speaker: z.string().min(1).max(120).optional(),
  publisher: z.string().min(1).max(120).optional(),
  realized_moves: z.array(realizedMoveSchema).min(1),
  timing_alignment: z.number().min(0).max(1),
  dominant_catalyst: z.string().min(1).max(240).optional(),
  labels: historicalCaseLabelInputSchema.optional(),
  review_hints: z.array(z.string().min(1).max(240)).max(12).optional(),
  model_version: z.string().min(1).max(80).optional(),
});

export const macroHistoricalIngestionRequestSchema = z.object({
  items: z.array(macroHistoricalCaseInputSchema).min(1).max(200),
  store_library: z.boolean().default(true),
  ingest_reviewed_memory: z.boolean().default(false),
  fallback_model_version: z.string().min(1).max(80).default("macro-loader-v1"),
  labeling_mode: historicalCaseLibraryIngestionModeSchema.default("merge"),
});

export const earningsHistoricalEventTypeSchema = z.enum([
  "earnings_beat",
  "earnings_miss",
  "guidance_raise",
  "guidance_cut",
  "ai_capex_upside",
  "margin_pressure",
  "consumer_weakness",
  "cloud_slowdown",
  "management_tone_shift",
]);

export const earningsHistoricalSignalBiasSchema = z.enum([
  "positive",
  "negative",
  "mixed",
  "neutral",
]);

export const earningsHistoricalCaseInputSchema = z.object({
  case_id: z.string().min(1).max(120).optional(),
  case_pack: z.string().min(1).max(120).default("earnings_v1"),
  event_type: earningsHistoricalEventTypeSchema,
  signal_bias: earningsHistoricalSignalBiasSchema.default("neutral"),
  company: z.string().min(1).max(120),
  ticker: z.string().min(1).max(24),
  sector: z.string().min(1).max(80).optional(),
  peers: z.array(z.string().min(1).max(24)).max(8).optional(),
  title: z.string().min(1).max(240).optional(),
  summary: z.string().min(12).max(4000),
  occurred_at: z.iso.datetime().optional(),
  speaker: z.string().min(1).max(120).optional(),
  publisher: z.string().min(1).max(120).optional(),
  realized_moves: z.array(realizedMoveSchema).min(1),
  timing_alignment: z.number().min(0).max(1),
  dominant_catalyst: z.string().min(1).max(240).optional(),
  labels: historicalCaseLabelInputSchema.optional(),
  review_hints: z.array(z.string().min(1).max(240)).max(12).optional(),
  model_version: z.string().min(1).max(80).optional(),
});

export const earningsHistoricalIngestionRequestSchema = z.object({
  items: z.array(earningsHistoricalCaseInputSchema).min(1).max(200),
  store_library: z.boolean().default(true),
  ingest_reviewed_memory: z.boolean().default(false),
  fallback_model_version: z.string().min(1).max(80).default("earnings-loader-v1"),
  labeling_mode: historicalCaseLibraryIngestionModeSchema.default("merge"),
});

export const policyHistoricalEventTypeSchema = z.enum([
  "trade_escalation",
  "trade_relief",
  "stimulus_support",
  "fx_intervention",
  "capital_controls",
  "sovereign_credit",
  "fiscal_shock",
  "regulatory_crackdown",
  "sanctions",
  "geopolitical_deescalation",
]);

export const policyHistoricalSignalBiasSchema = z.enum([
  "positive",
  "negative",
  "mixed",
  "neutral",
  "supportive",
  "restrictive",
]);

export const policyHistoricalCaseInputSchema = z.object({
  case_id: z.string().min(1).max(120).optional(),
  case_pack: z.string().min(1).max(120).default("policy_fx_v1"),
  event_type: policyHistoricalEventTypeSchema,
  signal_bias: policyHistoricalSignalBiasSchema.default("neutral"),
  country: z.string().min(1).max(120),
  region: z.string().min(1).max(120).optional(),
  currency_pair: z.string().min(1).max(24).optional(),
  focus_assets: z.array(z.string().min(1).max(40)).max(8).optional(),
  title: z.string().min(1).max(240).optional(),
  summary: z.string().min(12).max(4000),
  occurred_at: z.iso.datetime().optional(),
  speaker: z.string().min(1).max(120).optional(),
  publisher: z.string().min(1).max(120).optional(),
  realized_moves: z.array(realizedMoveSchema).min(1),
  timing_alignment: z.number().min(0).max(1),
  dominant_catalyst: z.string().min(1).max(240).optional(),
  labels: historicalCaseLabelInputSchema.optional(),
  review_hints: z.array(z.string().min(1).max(240)).max(12).optional(),
  model_version: z.string().min(1).max(80).optional(),
});

export const policyHistoricalIngestionRequestSchema = z.object({
  items: z.array(policyHistoricalCaseInputSchema).min(1).max(200),
  store_library: z.boolean().default(true),
  ingest_reviewed_memory: z.boolean().default(false),
  fallback_model_version: z.string().min(1).max(80).default("policy-loader-v1"),
  labeling_mode: historicalCaseLibraryIngestionModeSchema.default("merge"),
});

export const energyHistoricalEventTypeSchema = z.enum([
  "opec_cut",
  "opec_raise",
  "supply_disruption",
  "inventory_draw",
  "inventory_build",
  "gas_spike",
  "demand_shock",
]);

export const energyHistoricalSignalBiasSchema = z.enum([
  "bullish",
  "bearish",
  "mixed",
  "neutral",
]);

export const energyHistoricalMarketSchema = z.enum([
  "crude_oil",
  "natural_gas",
  "refined_products",
  "broad_energy",
]);

export const energyHistoricalCaseInputSchema = z.object({
  case_id: z.string().min(1).max(120).optional(),
  case_pack: z.string().min(1).max(120).default("energy_v1"),
  event_type: energyHistoricalEventTypeSchema,
  signal_bias: energyHistoricalSignalBiasSchema.default("neutral"),
  market: energyHistoricalMarketSchema.default("crude_oil"),
  region: z.string().min(1).max(120).optional(),
  producer: z.string().min(1).max(120).optional(),
  focus_assets: z.array(z.string().min(1).max(40)).max(8).optional(),
  title: z.string().min(1).max(240).optional(),
  summary: z.string().min(12).max(4000),
  occurred_at: z.iso.datetime().optional(),
  speaker: z.string().min(1).max(120).optional(),
  publisher: z.string().min(1).max(120).optional(),
  realized_moves: z.array(realizedMoveSchema).min(1),
  timing_alignment: z.number().min(0).max(1),
  dominant_catalyst: z.string().min(1).max(240).optional(),
  labels: historicalCaseLabelInputSchema.optional(),
  review_hints: z.array(z.string().min(1).max(240)).max(12).optional(),
  model_version: z.string().min(1).max(80).optional(),
});

export const energyHistoricalIngestionRequestSchema = z.object({
  items: z.array(energyHistoricalCaseInputSchema).min(1).max(200),
  store_library: z.boolean().default(true),
  ingest_reviewed_memory: z.boolean().default(false),
  fallback_model_version: z.string().min(1).max(80).default("energy-loader-v1"),
  labeling_mode: historicalCaseLibraryIngestionModeSchema.default("merge"),
});

export const creditHistoricalEventTypeSchema = z.enum([
  "bank_run",
  "deposit_flight",
  "liquidity_backstop",
  "credit_spread_widening",
  "default_shock",
  "banking_contagion",
  "downgrade_wave",
]);

export const creditHistoricalSignalBiasSchema = z.enum([
  "negative",
  "supportive",
  "mixed",
  "neutral",
]);

export const creditHistoricalCaseInputSchema = z.object({
  case_id: z.string().min(1).max(120).optional(),
  case_pack: z.string().min(1).max(120).default("credit_v1"),
  event_type: creditHistoricalEventTypeSchema,
  signal_bias: creditHistoricalSignalBiasSchema.default("neutral"),
  institution: z.string().min(1).max(120).optional(),
  region: z.string().min(1).max(120).optional(),
  focus_assets: z.array(z.string().min(1).max(40)).max(8).optional(),
  title: z.string().min(1).max(240).optional(),
  summary: z.string().min(12).max(4000),
  occurred_at: z.iso.datetime().optional(),
  speaker: z.string().min(1).max(120).optional(),
  publisher: z.string().min(1).max(120).optional(),
  realized_moves: z.array(realizedMoveSchema).min(1),
  timing_alignment: z.number().min(0).max(1),
  dominant_catalyst: z.string().min(1).max(240).optional(),
  labels: historicalCaseLabelInputSchema.optional(),
  review_hints: z.array(z.string().min(1).max(240)).max(12).optional(),
  model_version: z.string().min(1).max(80).optional(),
});

export const creditHistoricalIngestionRequestSchema = z.object({
  items: z.array(creditHistoricalCaseInputSchema).min(1).max(200),
  store_library: z.boolean().default(true),
  ingest_reviewed_memory: z.boolean().default(false),
  fallback_model_version: z.string().min(1).max(80).default("credit-loader-v1"),
  labeling_mode: historicalCaseLibraryIngestionModeSchema.default("merge"),
});

export const coreHistoricalCorpusDomainSchema = z.enum([
  "backfill",
  "macro",
  "earnings",
  "policy_fx",
  "energy",
  "credit_banking",
]);

export const coreHistoricalCorpusDomainResultSchema = z.object({
  domain: coreHistoricalCorpusDomainSchema,
  case_pack: z.string().min(1).max(120),
  selected_cases: z.number().int().min(0),
});

export const coreHistoricalCorpusIngestionRequestSchema = z
  .object({
    include_backfill: z.boolean().default(true),
    backfill_case_pack: z.string().min(1).max(120).default("macro_plus_v1"),
    include_macro: z.boolean().default(true),
    macro_case_pack: z.string().min(1).max(120).default("macro_calendar_v1"),
    include_earnings: z.boolean().default(true),
    earnings_case_pack: z.string().min(1).max(120).default("earnings_v1"),
    include_policy_fx: z.boolean().default(true),
    policy_case_pack: z.string().min(1).max(120).default("policy_fx_v1"),
    include_energy: z.boolean().default(true),
    energy_case_pack: z.string().min(1).max(120).default("energy_v1"),
    include_credit_banking: z.boolean().default(true),
    credit_case_pack: z.string().min(1).max(120).default("credit_v1"),
    store_library: z.boolean().default(true),
    ingest_reviewed_memory: z.boolean().default(true),
    fallback_model_version: z.string().min(1).max(80).default("core-corpus-loader-v1"),
    labeling_mode: historicalCaseLibraryIngestionModeSchema.default("merge"),
  })
  .refine(
    (value) =>
      value.include_backfill ||
      value.include_macro ||
      value.include_earnings ||
      value.include_policy_fx ||
      value.include_energy ||
      value.include_credit_banking,
    {
      message: "Select at least one historical domain to import.",
      path: ["include_backfill"],
    },
  );

export const coreHistoricalCorpusIngestionResponseSchema =
  historicalCaseLibraryIngestionResponseSchema.extend({
    domain_breakdown: z.array(coreHistoricalCorpusDomainResultSchema),
  });

export const historicalReplayCaseSchema = historicalIngestItemSchema.extend({
  case_id: z.string().min(1).max(120),
  case_pack: z.string().min(1).max(120).default("default"),
  tags: z.array(z.string().min(1).max(80)).default([]),
});

export const historicalCaseLibraryReplayRequestSchema = z.object({
  model_versions: z.array(z.string().min(1).max(80)).min(1).max(20),
  case_pack: z.string().min(1).max(120).optional(),
  case_ids: z.array(z.string().min(1).max(120)).max(500).optional(),
  allowed_case_qualities: z
    .array(historicalCaseQualitySchema)
    .min(1)
    .max(3)
    .default(["reviewed", "high_confidence"]),
  limit: z.number().int().min(1).max(500).default(200),
});

export const benchmarkPackDomainSchema = z.enum([
  "macro",
  "earnings",
  "policy_fx",
  "energy",
  "credit_banking",
]);

export const benchmarkPackQuotaSchema = z.object({
  domain: benchmarkPackDomainSchema,
  minimum_cases: z.number().int().min(1).max(200),
});

export const benchmarkPackDefinitionSchema = z.object({
  pack_id: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  target_case_count: z.number().int().min(1).max(500),
  allowed_case_qualities: z.array(historicalCaseQualitySchema).min(1).max(3),
  quotas: z.array(benchmarkPackQuotaSchema).min(1).max(20),
});

export const benchmarkPackListResponseSchema = z.object({
  packs: z.array(benchmarkPackDefinitionSchema),
});

export const benchmarkPackComposeRequestSchema = z.object({
  model_versions: z.array(z.string().min(1).max(80)).min(1).max(20),
  benchmark_pack_id: z.string().min(1).max(120).default("core_benchmark_v1"),
  case_ids: z.array(z.string().min(1).max(120)).max(500).optional(),
  case_pack_filters: z.array(z.string().min(1).max(120)).min(1).max(40).optional(),
  allowed_case_qualities: z
    .array(historicalCaseQualitySchema)
    .min(1)
    .max(3)
    .default(["reviewed", "high_confidence"]),
  target_case_count: z.number().int().min(1).max(500).optional(),
  quotas: z.array(benchmarkPackQuotaSchema).min(1).max(20).optional(),
  strict_quotas: z.boolean().default(true),
});

export const historicalReplayRequestSchema = z.object({
  model_versions: z.array(z.string().min(1).max(80)).min(1).max(20),
  cases: z.array(historicalReplayCaseSchema).min(1).max(500),
});

export const benchmarkPackDomainCountSchema = z.object({
  domain: benchmarkPackDomainSchema,
  minimum_cases: z.number().int().min(1),
  selected_cases: z.number().int().min(0),
});

export const benchmarkPackSelectedCaseSchema = z.object({
  case_id: z.string().min(1).max(120),
  source_case_pack: z.string().min(1).max(120),
  domain: benchmarkPackDomainSchema,
  case_quality: historicalCaseQualitySchema,
});

export const benchmarkPackCompositionSchema = z.object({
  pack_id: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  target_case_count: z.number().int().min(1).max(500),
  strict_quotas: z.boolean(),
  quotas_met: z.boolean(),
  allowed_case_qualities: z.array(historicalCaseQualitySchema).min(1).max(3),
  domain_counts: z.array(benchmarkPackDomainCountSchema),
  missing_domains: z.array(benchmarkPackDomainCountSchema),
  selected_case_count: z.number().int().min(0),
  selected_case_ids: z.array(z.string().min(1).max(120)),
  selected_cases: z.array(benchmarkPackSelectedCaseSchema),
  replay_request: historicalReplayRequestSchema,
});

export const benchmarkReplaySnapshotRequestSchema = z.object({
  as_of: z.iso.datetime().optional(),
  benchmark_pack_id: z.string().min(1).max(120).default("core_benchmark_v1"),
  model_versions: z.array(z.string().min(1).max(80)).min(1).max(50).optional(),
  case_pack_filters: z.array(z.string().min(1).max(120)).min(1).max(40).optional(),
  allowed_case_qualities: z
    .array(historicalCaseQualitySchema)
    .min(1)
    .max(3)
    .default(["reviewed", "high_confidence"]),
  strict_quotas: z.boolean().default(true),
});

export const historicalReplayCaseResultSchema = z.object({
  case_id: z.string().min(1),
  case_pack: z.string().min(1),
  model_version: z.string().min(1),
  horizon: predictionHorizonSchema,
  source_type: sourceTypeSchema,
  themes: z.array(z.string().min(1)),
  tags: z.array(z.string().min(1)),
  confidence: z.number().min(0).max(1),
  total_score: z.number().min(0).max(1),
  direction_score: z.number().min(0).max(1),
  magnitude_score: z.number().min(0).max(1),
  timing_score: z.number().min(0).max(1),
  calibration_score: z.number().min(0).max(1),
  verdict: z.enum(["correct", "partially_correct", "wrong"]),
  failure_tags: z.array(failureTagSchema),
});

export const historicalReplayThemeMetricSchema = z.object({
  key: z.string().min(1),
  sample_count: z.number().int().min(0),
  average_total_score: z.number().min(0).max(1),
  direction_accuracy: z.number().min(0).max(1),
});

export const historicalReplayModelMetricSchema = z.object({
  model_version: z.string().min(1),
  case_count: z.number().int().min(0),
  average_confidence: z.number().min(0).max(1),
  average_total_score: z.number().min(0).max(1),
  direction_accuracy: z.number().min(0).max(1),
  average_calibration_score: z.number().min(0).max(1).optional(),
  calibration_gap: z.number().min(-1).max(1),
  correct_rate: z.number().min(0).max(1),
  partial_rate: z.number().min(0).max(1),
  wrong_rate: z.number().min(0).max(1),
  by_theme: z.array(historicalReplayThemeMetricSchema),
  by_source_type: z.array(historicalReplayThemeMetricSchema),
  by_horizon: z.array(historicalReplayThemeMetricSchema),
});

export const historicalReplayResponseSchema = z.object({
  generated_at: z.iso.datetime(),
  case_pack: z.string().min(1),
  case_count: z.number().int().min(0),
  models: z.array(historicalReplayModelMetricSchema),
  leaders: z.object({
    by_average_total_score: z.string().nullable(),
    by_direction_accuracy: z.string().nullable(),
    by_calibration_alignment: z.string().nullable(),
  }),
  cases: z.array(historicalReplayCaseResultSchema),
});

export const walkForwardTrainingModeSchema = z.enum(["expanding"]);

export const walkForwardReplayRequestSchema = z.object({
  model_versions: z.array(z.string().min(1).max(80)).min(1).max(20),
  benchmark_pack_id: z.string().min(1).max(120).default("core_benchmark_v1"),
  case_pack_filters: z.array(z.string().min(1).max(120)).min(1).max(40).optional(),
  allowed_case_qualities: z
    .array(historicalCaseQualitySchema)
    .min(1)
    .max(3)
    .default(["reviewed", "high_confidence"]),
  min_train_cases: z.number().int().min(1).max(400).default(10),
  test_window_size: z.number().int().min(1).max(100).default(5),
  step_size: z.number().int().min(1).max(100).optional(),
  training_mode: walkForwardTrainingModeSchema.default("expanding"),
  seed_training_memory: z.boolean().default(true),
  training_memory_model_version: z
    .string()
    .min(1)
    .max(80)
    .default("walk-forward-memory-v1"),
});

export const walkForwardDomainCountSchema = z.object({
  domain: benchmarkPackDomainSchema,
  case_count: z.number().int().min(0),
});

export const walkForwardWindowSchema = z.object({
  window_index: z.number().int().min(1),
  train_case_count: z.number().int().min(0),
  test_case_count: z.number().int().min(0),
  seeded_training_memory_count: z.number().int().min(0),
  train_start_at: z.iso.datetime(),
  train_end_at: z.iso.datetime(),
  test_start_at: z.iso.datetime(),
  test_end_at: z.iso.datetime(),
  test_case_ids: z.array(z.string().min(1).max(120)),
  test_domain_counts: z.array(walkForwardDomainCountSchema),
  report: historicalReplayResponseSchema,
});

export const walkForwardReplayResponseSchema = z.object({
  generated_at: z.iso.datetime(),
  benchmark_pack_id: z.string().min(1).max(120),
  training_mode: walkForwardTrainingModeSchema,
  min_train_cases: z.number().int().min(1),
  test_window_size: z.number().int().min(1),
  step_size: z.number().int().min(1),
  eligible_case_count: z.number().int().min(0),
  eligible_regime_count: z.number().int().min(0),
  eligible_high_confidence_case_count: z.number().int().min(0),
  undated_case_count: z.number().int().min(0),
  first_eligible_occurred_at: z.iso.datetime().nullable(),
  last_eligible_occurred_at: z.iso.datetime().nullable(),
  window_count: z.number().int().min(0),
  models: z.array(historicalReplayModelMetricSchema),
  regimes: z
    .array(
      historicalReplayModelMetricSchema.pick({
        model_version: true,
        case_count: true,
        average_confidence: true,
        average_total_score: true,
        direction_accuracy: true,
        calibration_gap: true,
        wrong_rate: true,
      }).extend({
        regime: z.string().min(1),
      }),
    )
    .default([]),
  leaders: historicalReplayResponseSchema.shape.leaders,
  windows: z.array(walkForwardWindowSchema),
  warnings: z.array(z.string().min(1).max(240)),
});

export const walkForwardReplaySnapshotRequestSchema = z.object({
  as_of: z.iso.datetime().optional(),
  model_versions: z.array(z.string().min(1).max(80)).min(1).max(30).optional(),
  benchmark_pack_id: z.string().min(1).max(120).default("core_benchmark_v1"),
  case_pack_filters: z.array(z.string().min(1).max(120)).min(1).max(40).optional(),
  allowed_case_qualities: z
    .array(historicalCaseQualitySchema)
    .min(1)
    .max(3)
    .default(["reviewed", "high_confidence"]),
  training_mode: walkForwardTrainingModeSchema.default("expanding"),
  min_train_cases: z.number().int().min(1).max(400).default(10),
  test_window_size: z.number().int().min(1).max(100).default(5),
  step_size: z.number().int().min(1).max(100).optional(),
  seed_training_memory: z.boolean().default(true),
  training_memory_model_version: z
    .string()
    .min(1)
    .max(80)
    .default("walk-forward-memory-v1"),
});

export const walkForwardReplaySnapshotModelSchema =
  historicalReplayModelMetricSchema.extend({
    family: z.string().min(1),
    status: modelStatusSchema.nullable(),
  });

export const walkForwardReplaySnapshotFamilySchema = z.object({
  family: z.string().min(1),
  model_version: z.string().min(1),
  status: modelStatusSchema.nullable(),
  case_count: z.number().int().min(0),
  average_confidence: z.number().min(0).max(1),
  average_total_score: z.number().min(0).max(1),
  direction_accuracy: z.number().min(0).max(1),
  calibration_gap: z.number().min(-1).max(1),
  wrong_rate: z.number().min(0).max(1),
});

export const walkForwardReplaySnapshotRegimeSchema = z.object({
  regime: z.string().min(1),
  family: z.string().min(1),
  model_version: z.string().min(1),
  status: modelStatusSchema.nullable(),
  case_count: z.number().int().min(0),
  average_confidence: z.number().min(0).max(1),
  average_total_score: z.number().min(0).max(1),
  direction_accuracy: z.number().min(0).max(1),
  calibration_gap: z.number().min(-1).max(1),
  wrong_rate: z.number().min(0).max(1),
});

export const walkForwardReplaySnapshotReportSchema = z.object({
  benchmark_pack_id: z.string().min(1).max(120),
  training_mode: walkForwardTrainingModeSchema,
  min_train_cases: z.number().int().min(1),
  test_window_size: z.number().int().min(1),
  step_size: z.number().int().min(1),
  eligible_case_count: z.number().int().min(0),
  undated_case_count: z.number().int().min(0),
  first_eligible_occurred_at: z.iso.datetime().nullable(),
  last_eligible_occurred_at: z.iso.datetime().nullable(),
  window_count: z.number().int().min(0),
  model_count: z.number().int().min(0),
  family_count: z.number().int().min(0),
  leaders: historicalReplayResponseSchema.shape.leaders,
  warnings: z.array(z.string().min(1).max(240)),
  models: z.array(walkForwardReplaySnapshotModelSchema),
  families: z.array(walkForwardReplaySnapshotFamilySchema),
  regimes: z.array(walkForwardReplaySnapshotRegimeSchema).default([]),
});

export const walkForwardReplaySnapshotSchema = z.object({
  id: z.string().uuid(),
  as_of: z.iso.datetime(),
  benchmark_pack_id: z.string().min(1).max(120),
  eligible_case_count: z.number().int().min(0),
  window_count: z.number().int().min(0),
  family_count: z.number().int().min(0),
  report: walkForwardReplaySnapshotReportSchema,
  created_at: z.iso.datetime(),
});

export const walkForwardReplaySnapshotHistoryResponseSchema = z.object({
  snapshots: z.array(walkForwardReplaySnapshotSchema),
});

export const benchmarkReplaySnapshotModelSchema = historicalReplayModelMetricSchema.extend({
  family: z.string().min(1),
  status: modelStatusSchema.nullable(),
});

export const benchmarkReplaySnapshotFamilySchema = z.object({
  family: z.string().min(1),
  model_version: z.string().min(1),
  status: modelStatusSchema.nullable(),
  case_count: z.number().int().min(0),
  average_confidence: z.number().min(0).max(1),
  average_total_score: z.number().min(0).max(1),
  direction_accuracy: z.number().min(0).max(1),
  calibration_gap: z.number().min(-1).max(1),
  wrong_rate: z.number().min(0).max(1),
});

export const benchmarkReplaySnapshotReportSchema = z.object({
  pack_id: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  selected_case_count: z.number().int().min(0),
  quotas_met: z.boolean(),
  domain_counts: z.array(benchmarkPackDomainCountSchema),
  selected_case_ids: z.array(z.string().min(1).max(120)),
  model_count: z.number().int().min(0),
  family_count: z.number().int().min(0),
  leaders: z.object({
    by_average_total_score: z.string().nullable(),
    by_direction_accuracy: z.string().nullable(),
    by_calibration_alignment: z.string().nullable(),
  }),
  models: z.array(benchmarkReplaySnapshotModelSchema),
  families: z.array(benchmarkReplaySnapshotFamilySchema),
});

export const benchmarkReplaySnapshotSchema = z.object({
  id: z.string().uuid(),
  as_of: z.iso.datetime(),
  benchmark_pack_id: z.string().min(1).max(120),
  selected_case_count: z.number().int().min(0),
  family_count: z.number().int().min(0),
  report: benchmarkReplaySnapshotReportSchema,
  created_at: z.iso.datetime(),
});

export const benchmarkReplaySnapshotHistoryResponseSchema = z.object({
  snapshots: z.array(benchmarkReplaySnapshotSchema),
});

export const benchmarkTrustRefreshRequestSchema = z.object({
  benchmark_pack_id: z.string().min(1).max(120).default("core_benchmark_v1"),
  reviewer: z.string().min(1).max(120).default("core-corpus-seed"),
  case_pack_filters: z.array(z.string().min(1).max(120)).min(1).max(20).optional(),
  prioritize_gap_regimes: z.boolean().default(true),
  prioritize_walk_forward_regimes: z.boolean().default(true),
  target_regimes: z.array(z.string().min(1).max(80)).min(1).max(20).optional(),
  seed_limit: z.number().int().min(1).max(100).default(12),
  min_candidate_score: z.number().min(0).max(1).default(0.8),
  dry_run: z.boolean().default(false),
  ingest_reviewed_memory: z.boolean().default(false),
  model_version: z
    .string()
    .min(1)
    .max(80)
    .default("historical-library-high-confidence-v1"),
  strict_quotas: z.boolean().default(false),
  case_pack_filters_for_benchmark: z
    .array(z.string().min(1).max(120))
    .min(1)
    .max(20)
    .optional(),
});

export const benchmarkTrustRefreshSummarySchema = z.object({
  high_confidence_cases: z.number().int().min(0),
  reviewed_cases: z.number().int().min(0),
  needs_review_count: z.number().int().min(0),
  selected_case_count: z.number().int().min(0),
  quotas_met: z.boolean(),
  warning_count: z.number().int().min(0),
  high_warning_count: z.number().int().min(0),
});

export const benchmarkTrustRefreshDeltaSchema = z.object({
  high_confidence_cases: z.number().int(),
  warning_count: z.number().int(),
  high_warning_count: z.number().int(),
  selected_case_count: z.number().int(),
});

export const benchmarkTrustRefreshResponseSchema = z.object({
  generated_at: z.iso.datetime(),
  benchmark_pack_id: z.string().min(1).max(120),
  seed: historicalHighConfidenceSeedResponseSchema,
  before: benchmarkTrustRefreshSummarySchema,
  after: benchmarkTrustRefreshSummarySchema,
  delta: benchmarkTrustRefreshDeltaSchema,
  benchmark_snapshot: benchmarkReplaySnapshotSchema.nullable(),
});

export const benchmarkTrustRefreshRecordSchema = z.object({
  id: z.string().uuid(),
  generated_at: z.iso.datetime(),
  benchmark_pack_id: z.string().min(1).max(120),
  seed: historicalHighConfidenceSeedResponseSchema,
  before: benchmarkTrustRefreshSummarySchema,
  after: benchmarkTrustRefreshSummarySchema,
  delta: benchmarkTrustRefreshDeltaSchema,
  benchmark_snapshot_id: z.string().uuid().nullable(),
  benchmark_snapshot_case_count: z.number().int().min(0).nullable(),
  benchmark_snapshot_family_count: z.number().int().min(0).nullable(),
  created_at: z.iso.datetime(),
});

export const benchmarkTrustRefreshHistoryResponseSchema = z.object({
  refreshes: z.array(benchmarkTrustRefreshRecordSchema),
});

export const walkForwardTrendPointSchema = z.object({
  as_of: z.iso.datetime(),
  model_version: z.string().min(1),
  average_total_score: z.number().min(0).max(1),
  direction_accuracy: z.number().min(0).max(1),
  wrong_rate: z.number().min(0).max(1),
  calibration_gap: z.number().min(-1).max(1),
  case_count: z.number().int().min(0),
  window_count: z.number().int().min(0),
});

export const walkForwardFamilyTrendSchema = z.object({
  family: z.string().min(1),
  benchmark_pack_id: z.string().min(1).max(120),
  latest_model_version: z.string().min(1).nullable(),
  sample_count: z.number().int().min(0),
  current_average_total_score: z.number().min(0).max(1).nullable(),
  score_delta: z.number().min(-1).max(1).nullable(),
  current_direction_accuracy: z.number().min(0).max(1).nullable(),
  direction_accuracy_delta: z.number().min(-1).max(1).nullable(),
  current_wrong_rate: z.number().min(0).max(1).nullable(),
  wrong_rate_delta: z.number().min(-1).max(1).nullable(),
  current_calibration_gap: z.number().min(-1).max(1).nullable(),
  calibration_gap_delta: z.number().min(-1).max(1).nullable(),
  trend_signal: z.enum(["emerging", "improving", "stable", "regressing"]),
  snapshots: z.array(walkForwardTrendPointSchema),
});

export const walkForwardTrendReportSchema = z.object({
  generated_at: z.iso.datetime(),
  benchmark_pack_id: z.string().min(1).max(120),
  sample_count: z.number().int().min(0),
  families: z.array(walkForwardFamilyTrendSchema),
  leaders: z.object({
    by_score_improvement: z.string().nullable(),
    by_direction_improvement: z.string().nullable(),
    by_wrong_rate_reduction: z.string().nullable(),
    by_calibration_improvement: z.string().nullable(),
  }),
});

export const walkForwardRegimeTrendPointSchema = z.object({
  as_of: z.iso.datetime(),
  model_version: z.string().min(1),
  average_total_score: z.number().min(0).max(1),
  direction_accuracy: z.number().min(0).max(1),
  wrong_rate: z.number().min(0).max(1),
  calibration_gap: z.number().min(-1).max(1),
  case_count: z.number().int().min(0),
});

export const walkForwardRegimeTrendSliceSchema = z.object({
  regime: z.string().min(1),
  family: z.string().min(1),
  benchmark_pack_id: z.string().min(1).max(120),
  latest_model_version: z.string().min(1).nullable(),
  sample_count: z.number().int().min(0),
  current_average_total_score: z.number().min(0).max(1).nullable(),
  score_delta: z.number().min(-1).max(1).nullable(),
  current_direction_accuracy: z.number().min(0).max(1).nullable(),
  direction_accuracy_delta: z.number().min(-1).max(1).nullable(),
  current_wrong_rate: z.number().min(0).max(1).nullable(),
  wrong_rate_delta: z.number().min(-1).max(1).nullable(),
  current_calibration_gap: z.number().min(-1).max(1).nullable(),
  calibration_gap_delta: z.number().min(-1).max(1).nullable(),
  trend_signal: z.enum(["emerging", "improving", "stable", "regressing"]),
  snapshots: z.array(walkForwardRegimeTrendPointSchema),
});

export const walkForwardRegimeTrendReportSchema = z.object({
  generated_at: z.iso.datetime(),
  benchmark_pack_id: z.string().min(1).max(120),
  sample_count: z.number().int().min(0),
  regime_count: z.number().int().min(0),
  slices: z.array(walkForwardRegimeTrendSliceSchema),
  leaders: z.object({
    by_score_improvement: z.string().nullable(),
    by_direction_improvement: z.string().nullable(),
    by_wrong_rate_reduction: z.string().nullable(),
    by_calibration_improvement: z.string().nullable(),
  }),
});

export const walkForwardRegressionAlertSchema = z.object({
  family: z.string().min(1),
  benchmark_pack_id: z.string().min(1).max(120),
  model_version: z.string().min(1).nullable(),
  severity: z.enum(["low", "medium", "high"]),
  regression_streak: z.number().int().min(1),
  latest_snapshot_at: z.iso.datetime(),
  score_delta: z.number().min(-1).max(1),
  direction_accuracy_delta: z.number().min(-1).max(1),
  wrong_rate_delta: z.number().min(-1).max(1),
  calibration_gap_delta: z.number().min(-1).max(1),
  signals: z.array(z.string().min(1)),
  recommended_action: z.string().min(1),
});

export const walkForwardRegressionReportSchema = z.object({
  generated_at: z.iso.datetime(),
  benchmark_pack_id: z.string().min(1).max(120),
  counts: z.object({
    high: z.number().int().min(0),
    medium: z.number().int().min(0),
    low: z.number().int().min(0),
  }),
  alerts: z.array(walkForwardRegressionAlertSchema),
});

export const walkForwardRegimeRegressionAlertSchema = z.object({
  family: z.string().min(1),
  regime: z.string().min(1),
  benchmark_pack_id: z.string().min(1).max(120),
  model_version: z.string().min(1).nullable(),
  severity: z.enum(["low", "medium", "high"]),
  regression_streak: z.number().int().min(1),
  latest_snapshot_at: z.iso.datetime(),
  score_delta: z.number().min(-1).max(1),
  direction_accuracy_delta: z.number().min(-1).max(1),
  wrong_rate_delta: z.number().min(-1).max(1),
  calibration_gap_delta: z.number().min(-1).max(1),
  signals: z.array(z.string().min(1)),
  recommended_action: z.string().min(1),
});

export const walkForwardRegimeRegressionReportSchema = z.object({
  generated_at: z.iso.datetime(),
  benchmark_pack_id: z.string().min(1).max(120),
  regime_count: z.number().int().min(0),
  counts: z.object({
    high: z.number().int().min(0),
    medium: z.number().int().min(0),
    low: z.number().int().min(0),
  }),
  alerts: z.array(walkForwardRegimeRegressionAlertSchema),
});

export const benchmarkTrendPointSchema = z.object({
  as_of: z.iso.datetime(),
  model_version: z.string().min(1),
  average_total_score: z.number().min(0).max(1),
  direction_accuracy: z.number().min(0).max(1),
  wrong_rate: z.number().min(0).max(1),
  calibration_gap: z.number().min(-1).max(1),
  case_count: z.number().int().min(0),
});

export const benchmarkFamilyTrendSchema = z.object({
  family: z.string().min(1),
  benchmark_pack_id: z.string().min(1).max(120),
  latest_model_version: z.string().min(1).nullable(),
  sample_count: z.number().int().min(0),
  current_average_total_score: z.number().min(0).max(1).nullable(),
  score_delta: z.number().min(-1).max(1).nullable(),
  current_direction_accuracy: z.number().min(0).max(1).nullable(),
  direction_accuracy_delta: z.number().min(-1).max(1).nullable(),
  current_wrong_rate: z.number().min(0).max(1).nullable(),
  wrong_rate_delta: z.number().min(-1).max(1).nullable(),
  current_calibration_gap: z.number().min(-1).max(1).nullable(),
  calibration_gap_delta: z.number().min(-1).max(1).nullable(),
  trend_signal: z.enum(["emerging", "improving", "stable", "regressing"]),
  snapshots: z.array(benchmarkTrendPointSchema),
});

export const benchmarkTrendReportSchema = z.object({
  generated_at: z.iso.datetime(),
  benchmark_pack_id: z.string().min(1).max(120),
  sample_count: z.number().int().min(0),
  families: z.array(benchmarkFamilyTrendSchema),
  leaders: z.object({
    by_score_improvement: z.string().nullable(),
    by_direction_improvement: z.string().nullable(),
    by_wrong_rate_reduction: z.string().nullable(),
    by_calibration_improvement: z.string().nullable(),
  }),
});

export const benchmarkRegressionAlertSchema = z.object({
  family: z.string().min(1),
  benchmark_pack_id: z.string().min(1).max(120),
  model_version: z.string().min(1).nullable(),
  severity: z.enum(["low", "medium", "high"]),
  regression_streak: z.number().int().min(1),
  latest_snapshot_at: z.iso.datetime(),
  score_delta: z.number().min(-1).max(1),
  direction_accuracy_delta: z.number().min(-1).max(1),
  wrong_rate_delta: z.number().min(-1).max(1),
  calibration_gap_delta: z.number().min(-1).max(1),
  signals: z.array(z.string().min(1)),
  recommended_action: z.string().min(1),
});

export const benchmarkRegressionReportSchema = z.object({
  generated_at: z.iso.datetime(),
  benchmark_pack_id: z.string().min(1).max(120),
  counts: z.object({
    high: z.number().int().min(0),
    medium: z.number().int().min(0),
    low: z.number().int().min(0),
  }),
  alerts: z.array(benchmarkRegressionAlertSchema),
});

export const benchmarkWeeklyRollupSchema = z.object({
  week_key: z.string().min(1).max(40),
  week_start_at: z.iso.datetime(),
  week_end_at: z.iso.datetime(),
  latest_model_version: z.string().min(1),
  snapshot_count: z.number().int().min(1),
  average_total_score: z.number().min(0).max(1),
  direction_accuracy: z.number().min(0).max(1),
  wrong_rate: z.number().min(0).max(1),
  calibration_gap: z.number().min(-1).max(1),
  week_signal: z.enum(["improving", "stable", "regressing", "emerging"]),
});

export const benchmarkFamilyStabilitySchema = z.object({
  family: z.string().min(1),
  benchmark_pack_id: z.string().min(1).max(120),
  latest_model_version: z.string().min(1).nullable(),
  week_count: z.number().int().min(0),
  stability_score: z.number().min(0).max(1),
  resilience_score: z.number().min(0).max(1),
  average_weekly_total_score: z.number().min(0).max(1).nullable(),
  average_weekly_direction_accuracy: z.number().min(0).max(1).nullable(),
  average_weekly_wrong_rate: z.number().min(0).max(1).nullable(),
  average_abs_calibration_gap: z.number().min(0).max(1).nullable(),
  score_volatility: z.number().min(0).max(1).nullable(),
  direction_volatility: z.number().min(0).max(1).nullable(),
  wrong_rate_volatility: z.number().min(0).max(1).nullable(),
  calibration_volatility: z.number().min(0).max(1).nullable(),
  regression_weeks: z.number().int().min(0),
  stable_weeks: z.number().int().min(0),
  improving_weeks: z.number().int().min(0),
  current_signal: z.enum(["emerging", "durable", "watch", "fragile"]),
  weekly_rollups: z.array(benchmarkWeeklyRollupSchema),
});

export const benchmarkStabilityReportSchema = z.object({
  generated_at: z.iso.datetime(),
  benchmark_pack_id: z.string().min(1).max(120),
  sample_count: z.number().int().min(0),
  week_count: z.number().int().min(0),
  families: z.array(benchmarkFamilyStabilitySchema),
  leaders: z.object({
    by_stability_score: z.string().nullable(),
    by_resilience: z.string().nullable(),
    by_lowest_volatility: z.string().nullable(),
  }),
});

export const dashboardBenchmarkSnapshotLeaderSchema = z.object({
  family: z.string().min(1),
  model_version: z.string().min(1),
  average_total_score: z.number().min(0).max(1),
  direction_accuracy: z.number().min(0).max(1),
  wrong_rate: z.number().min(0).max(1),
  calibration_gap: z.number().min(-1).max(1),
});

export const dashboardBenchmarkSnapshotSchema = z.object({
  id: z.string().uuid(),
  as_of: z.iso.datetime(),
  benchmark_pack_id: z.string().min(1).max(120),
  selected_case_count: z.number().int().min(0),
  family_count: z.number().int().min(0),
  leaders: z.object({
    by_average_total_score: z.string().nullable(),
    by_direction_accuracy: z.string().nullable(),
    by_calibration_alignment: z.string().nullable(),
  }),
  top_families: z.array(dashboardBenchmarkSnapshotLeaderSchema),
});

export const dashboardBenchmarkPackHealthSchema = z.object({
  pack_id: z.string().min(1).max(120),
  label: z.string().min(1).max(120),
  description: z.string().min(1).max(1000),
  target_case_count: z.number().int().min(1).max(500),
  selected_case_count: z.number().int().min(0),
  quotas_met: z.boolean(),
  allowed_case_qualities: z.array(historicalCaseQualitySchema).min(1).max(3),
  domain_counts: z.array(benchmarkPackDomainCountSchema),
  missing_domains: z.array(benchmarkPackDomainCountSchema),
});

export const dashboardBenchmarkWarningSchema = z.object({
  severity: z.enum(["low", "medium", "high"]),
  title: z.string().min(1).max(160),
  detail: z.string().min(1).max(500),
  recommendation: z.string().min(1).max(500),
});

export const dashboardBenchmarkFamilyComparisonSchema = z.object({
  family: z.string().min(1),
  latest_model_version: z.string().min(1).nullable(),
  current_average_total_score: z.number().min(0).max(1).nullable(),
  score_delta: z.number().min(-1).max(1).nullable(),
  current_direction_accuracy: z.number().min(0).max(1).nullable(),
  direction_accuracy_delta: z.number().min(-1).max(1).nullable(),
  current_wrong_rate: z.number().min(0).max(1).nullable(),
  wrong_rate_delta: z.number().min(-1).max(1).nullable(),
  current_calibration_gap: z.number().min(-1).max(1).nullable(),
  calibration_gap_delta: z.number().min(-1).max(1).nullable(),
  trend_signal: z.enum(["emerging", "improving", "stable", "regressing"]),
  regression_severity: z.enum(["low", "medium", "high"]).nullable(),
  regression_streak: z.number().int().min(0),
  baseline_score_delta: z.number().min(-1).max(1).nullable(),
  baseline_direction_accuracy_delta: z.number().min(-1).max(1).nullable(),
  baseline_wrong_rate_delta: z.number().min(-1).max(1).nullable(),
  baseline_calibration_gap_delta: z.number().min(-1).max(1).nullable(),
  growth_alert_severity: z.enum(["low", "medium", "high"]).nullable(),
  growth_alert_status: z
    .enum(["open", "acknowledged", "snoozed", "handled", "resolved"])
    .nullable(),
  alert_signals: z.array(z.string().min(1)),
});

export const dashboardBenchmarkCoverageSummarySchema = z.object({
  total_cases: z.number().int().min(0),
  reviewed_cases: z.number().int().min(0),
  high_confidence_cases: z.number().int().min(0),
  needs_review_count: z.number().int().min(0),
});

export const dashboardBenchmarkWalkForwardPromotionSchema = z.object({
  candidate_model_version: z.string().min(1),
  baseline_model_version: z.string().min(1),
  created_at: z.iso.datetime(),
  promotion_passed: z.boolean(),
  walk_forward_passed: z.boolean(),
  benchmark_pack_id: z.string().min(1).max(120),
  case_pack: z.string().min(1),
  window_count: z.number().int().min(0),
  eligible_case_count: z.number().int().min(0),
  eligible_regime_count: z.number().int().min(0),
  eligible_high_confidence_case_count: z.number().int().min(0),
  depth_requirements_met: z.boolean(),
  deltas: z.object({
    average_total_score: z.number().min(-1).max(1),
    direction_accuracy: z.number().min(-1).max(1),
    wrong_rate: z.number().min(-1).max(1),
    calibration_alignment: z.number().min(-1).max(1),
  }),
  reasons: z.array(z.string().min(1)),
});

export const dashboardBenchmarkResponseSchema = z.object({
  generated_at: z.iso.datetime(),
  benchmark_pack_id: z.string().min(1).max(120),
  latest_snapshot: dashboardBenchmarkSnapshotSchema.nullable(),
  recent_snapshots: z.array(dashboardBenchmarkSnapshotSchema),
  latest_walk_forward_snapshot: walkForwardReplaySnapshotSchema.nullable(),
  recent_walk_forward_snapshots: z.array(walkForwardReplaySnapshotSchema),
  latest_trust_refresh: benchmarkTrustRefreshRecordSchema.nullable(),
  recent_trust_refreshes: z.array(benchmarkTrustRefreshRecordSchema),
  pack_health: dashboardBenchmarkPackHealthSchema,
  coverage_summary: dashboardBenchmarkCoverageSummarySchema,
  family_comparisons: z.array(dashboardBenchmarkFamilyComparisonSchema),
  walk_forward_regime_slices: z.array(walkForwardRegimeTrendSliceSchema),
  recent_walk_forward_promotions: z.array(dashboardBenchmarkWalkForwardPromotionSchema),
  regressions: z.array(benchmarkRegressionAlertSchema),
  walk_forward_regressions: z.array(walkForwardRegressionAlertSchema),
  walk_forward_regime_regressions: z.array(walkForwardRegimeRegressionAlertSchema),
  benchmark_stability: benchmarkStabilityReportSchema,
  growth_alerts: z.array(z.lazy(() => growthPressureAlertSchema)),
  warnings: z.array(dashboardBenchmarkWarningSchema),
});

export const dashboardOperationalResponseSchema = z.object({
  generated_at: z.iso.datetime(),
  operations: systemOperationReportSchema,
  queue: operationQueueReportSchema,
  queue_alerts: operationQueueAlertReportSchema,
  incidents: systemOperationalIncidentReportSchema,
  workers: systemWorkerReportSchema,
  worker_services: systemWorkerServiceReportSchema,
  worker_service_trends: systemWorkerServiceTrendReportSchema,
  worker_trends: systemWorkerTrendReportSchema,
  integrations: systemIntegrationReportSchema,
  integration_probes: systemIntegrationProbeReportSchema,
  integration_governance: systemIntegrationGovernanceReportSchema,
  integration_trends: systemIntegrationTrendReportSchema,
});

export const historicalReplaySliceDiagnosticSchema = z.object({
  key: z.string().min(1),
  sample_count: z.number().int().min(0),
  average_total_score: z.number().min(0).max(1),
  direction_accuracy: z.number().min(0).max(1),
  average_confidence: z.number().min(0).max(1),
  wrong_rate: z.number().min(0).max(1),
  dominant_failure_tags: z.array(failureTagSchema),
});

export const historicalReplayFailureTagStatSchema = z.object({
  tag: failureTagSchema,
  count: z.number().int().min(0),
  rate: z.number().min(0).max(1),
});

export const historicalReplayMissSchema = z.object({
  case_id: z.string().min(1),
  confidence: z.number().min(0).max(1),
  total_score: z.number().min(0).max(1),
  themes: z.array(z.string().min(1)),
  tags: z.array(z.string().min(1)),
  failure_tags: z.array(failureTagSchema),
});

export const historicalReplayTuningRecommendationSchema = z.object({
  confidence_bias: z.number().min(-0.2).max(0.2),
  confidence_cap: z.number().min(0.35).max(0.95).nullable(),
  magnitude_multiplier: z.number().min(0.5).max(1.5),
  conviction_bias: z.number().min(-0.2).max(0.2),
  focus_themes: z.array(z.string().min(1)),
  preferred_assets: z.array(z.string().min(1)),
  caution_themes: z.array(z.string().min(1)),
  rationale: z.array(z.string().min(1)),
  feature_flags_patch: z.record(z.string(), modelFeatureValueSchema),
});

export const historicalReplayModelDiagnosticsSchema = z.object({
  model_version: z.string().min(1),
  profile: z.enum([
    "baseline",
    "macro_dovish_sensitive",
    "policy_shock_sensitive",
    "contrarian_regime_aware",
  ]),
  average_total_score: z.number().min(0).max(1),
  direction_accuracy: z.number().min(0).max(1),
  calibration_gap: z.number().min(-1).max(1),
  wrong_rate: z.number().min(0).max(1),
  weakest_themes: z.array(historicalReplaySliceDiagnosticSchema),
  weakest_tags: z.array(historicalReplaySliceDiagnosticSchema),
  weakest_source_types: z.array(historicalReplaySliceDiagnosticSchema),
  weakest_horizons: z.array(historicalReplaySliceDiagnosticSchema),
  frequent_failure_tags: z.array(historicalReplayFailureTagStatSchema),
  high_confidence_misses: z.array(historicalReplayMissSchema),
  recommended_tuning: historicalReplayTuningRecommendationSchema,
});

export const historicalReplayDiagnosticsResponseSchema = z.object({
  generated_at: z.iso.datetime(),
  case_pack: z.string().min(1),
  case_count: z.number().int().min(0),
  leaders: historicalReplayResponseSchema.shape.leaders,
  models: z.array(historicalReplayModelDiagnosticsSchema),
});

export const replayPatternPriorMatchSchema = z.object({
  pattern_key: z.string().min(1),
  category: z.string().min(1),
  label: z.string().min(1),
  scope: z.enum(["family", "global"]),
  sample_count: z.number().int().min(0),
  pass_rate: z.number().min(0).max(1),
  trend_signal: z.enum(["improving", "flat", "declining", "insufficient_data"]),
  average_total_score_delta: z.number().min(-1).max(1),
  average_direction_accuracy_delta: z.number().min(-1).max(1),
  average_wrong_rate_delta: z.number().min(-1).max(1),
  average_calibration_alignment_delta: z.number().min(-1).max(1),
});

export const replayPatternPriorSetSchema = z.object({
  family: z.string().min(1),
  source_scope: z.enum(["family", "global", "mixed"]),
  promotion_sample_count: z.number().int().min(0),
  selected_patterns: z.array(replayPatternPriorMatchSchema),
  feature_flags_patch: z.record(z.string(), modelFeatureValueSchema),
  rationale: z.array(z.string().min(1)),
});

export const applyReplayTuningRequestSchema = z.object({
  cases: z.array(historicalReplayCaseSchema).min(1).max(500),
  target_model_version: z.string().min(1).max(80).optional(),
  label_suffix: z.string().min(1).max(80).default("Replay tuned"),
  status: modelStatusSchema.default("experimental"),
  use_pattern_priors: z.boolean().default(true),
});

export const applyReplayTuningResponseSchema = z.object({
  source_model_version: z.string().min(1),
  saved_model: storedModelVersionSchema,
  diagnostics: historicalReplayModelDiagnosticsSchema,
  applied_pattern_priors: replayPatternPriorSetSchema.nullable(),
});

export const replayPromotionThresholdsSchema = z.object({
  min_average_total_score_delta: z.number().min(-1).max(1).default(0.01),
  min_direction_accuracy_delta: z.number().min(-1).max(1).default(0),
  max_wrong_rate_delta: z.number().min(-1).max(1).default(0),
  min_calibration_alignment_delta: z.number().min(-1).max(1).default(0),
});

export const walkForwardDepthRequirementsSchema = z.object({
  min_window_count: z.number().int().min(1).max(100).default(3),
  min_eligible_case_count: z.number().int().min(1).max(1000).default(15),
  min_regime_count: z.number().int().min(1).max(100).default(4),
  min_high_confidence_case_count: z.number().int().min(0).max(1000).default(2),
});

export const walkForwardPromotionConfigSchema = z.object({
  enabled: z.boolean().default(false),
  benchmark_pack_id: z.string().min(1).max(120).optional(),
  case_pack_filters: z.array(z.string().min(1).max(120)).min(1).max(40).optional(),
  allowed_case_qualities: z
    .array(historicalCaseQualitySchema)
    .min(1)
    .max(3)
    .default(["reviewed", "high_confidence"]),
  min_train_cases: z.number().int().min(1).max(400).default(10),
  test_window_size: z.number().int().min(1).max(100).default(5),
  step_size: z.number().int().min(1).max(100).optional(),
  seed_training_memory: z.boolean().default(true),
  training_memory_model_version: z
    .string()
    .min(1)
    .max(80)
    .default("walk-forward-memory-v1"),
  depth_requirements: walkForwardDepthRequirementsSchema.default({
    min_window_count: 3,
    min_eligible_case_count: 15,
    min_regime_count: 4,
    min_high_confidence_case_count: 2,
  }),
  thresholds: replayPromotionThresholdsSchema.default({
    min_average_total_score_delta: 0,
    min_direction_accuracy_delta: 0,
    max_wrong_rate_delta: 0,
    min_calibration_alignment_delta: 0,
  }),
});

export const replayPromotionRequestSchema = z.object({
  baseline_model_version: z.string().min(1).max(80),
  cases: z.array(historicalReplayCaseSchema).min(1).max(500).optional(),
  benchmark_pack_id: z.string().min(1).max(120).optional(),
  benchmark_case_pack_filters: z
    .array(z.string().min(1).max(120))
    .min(1)
    .max(40)
    .optional(),
  benchmark_allowed_case_qualities: z
    .array(historicalCaseQualitySchema)
    .min(1)
    .max(3)
    .default(["reviewed", "high_confidence"]),
  benchmark_strict_quotas: z.boolean().default(true),
  thresholds: replayPromotionThresholdsSchema.default({
    min_average_total_score_delta: 0.01,
    min_direction_accuracy_delta: 0,
    max_wrong_rate_delta: 0,
    min_calibration_alignment_delta: 0,
  }),
  promote_on_pass: z.boolean().default(true),
  promoted_status: modelStatusSchema.default("active"),
  walk_forward: walkForwardPromotionConfigSchema.optional(),
}).superRefine((value, ctx) => {
  const hasCases = Boolean(value.cases?.length);
  const hasBenchmarkPack = Boolean(value.benchmark_pack_id);

  if (!hasCases && !hasBenchmarkPack) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["cases"],
      message: "Provide replay cases or a benchmark_pack_id.",
    });
  }

  if (hasCases && hasBenchmarkPack) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["benchmark_pack_id"],
      message: "Use either replay cases or a benchmark_pack_id, not both.",
    });
  }
});

export const walkForwardPromotionDecisionSchema = z.object({
  benchmark_pack_id: z.string().min(1).max(120),
  window_count: z.number().int().min(0),
  eligible_case_count: z.number().int().min(0),
  eligible_regime_count: z.number().int().min(0),
  eligible_high_confidence_case_count: z.number().int().min(0),
  depth_requirements_met: z.boolean(),
  passed: z.boolean(),
  reasons: z.array(z.string().min(1)),
  deltas: z.object({
    average_total_score: z.number().min(-1).max(1),
    direction_accuracy: z.number().min(-1).max(1),
    wrong_rate: z.number().min(-1).max(1),
    calibration_alignment: z.number().min(-1).max(1),
  }),
  depth_requirements: walkForwardDepthRequirementsSchema,
  thresholds: replayPromotionThresholdsSchema,
  baseline: historicalReplayModelMetricSchema,
  candidate: historicalReplayModelMetricSchema,
});

export const replayPromotionDecisionSchema = z.object({
  candidate_model_version: z.string().min(1),
  baseline_model_version: z.string().min(1),
  case_pack: z.string().min(1),
  case_count: z.number().int().min(0),
  passed: z.boolean(),
  reasons: z.array(z.string().min(1)),
  deltas: z.object({
    average_total_score: z.number().min(-1).max(1),
    direction_accuracy: z.number().min(-1).max(1),
    wrong_rate: z.number().min(-1).max(1),
    calibration_alignment: z.number().min(-1).max(1),
  }),
  thresholds: replayPromotionThresholdsSchema,
  baseline: historicalReplayModelMetricSchema,
  candidate: historicalReplayModelMetricSchema,
  walk_forward: walkForwardPromotionDecisionSchema.nullable(),
  saved_model: storedModelVersionSchema.nullable(),
});

export const storedPromotionEvaluationSchema = replayPromotionDecisionSchema.extend({
  id: z.string().uuid(),
  created_at: z.iso.datetime(),
});

export const promotionHistoryResponseSchema = z.object({
  evaluations: z.array(storedPromotionEvaluationSchema),
});

export const promotionTrendSignalSchema = z.enum([
  "improving",
  "flat",
  "declining",
  "insufficient_data",
]);

export const promotionFamilyMetricSchema = z.object({
  family: z.string().min(1),
  active_model_version: z.string().nullable(),
  latest_candidate_model_version: z.string().nullable(),
  latest_decision_at: z.iso.datetime().nullable(),
  evaluated_count: z.number().int().min(0),
  passed_count: z.number().int().min(0),
  failed_count: z.number().int().min(0),
  pass_rate: z.number().min(0).max(1),
  recent_window_size: z.number().int().min(1),
  recent_pass_rate: z.number().min(0).max(1),
  prior_pass_rate: z.number().min(0).max(1).nullable(),
  trend_delta: z.number().min(-1).max(1).nullable(),
  trend_signal: promotionTrendSignalSchema,
  average_total_score_delta: z.number().min(-1).max(1),
  average_direction_accuracy_delta: z.number().min(-1).max(1),
  average_wrong_rate_delta: z.number().min(-1).max(1),
  average_calibration_alignment_delta: z.number().min(-1).max(1),
});

export const promotionAnalyticsResponseSchema = z.object({
  generated_at: z.iso.datetime(),
  sample_count: z.number().int().min(0),
  families: z.array(promotionFamilyMetricSchema),
  leaders: z.object({
    by_pass_rate: z.string().nullable(),
    by_trend_improvement: z.string().nullable(),
    by_calibration_alignment: z.string().nullable(),
    by_wrong_rate_reduction: z.string().nullable(),
  }),
});

export const promotionPatternMetricSchema = z.object({
  pattern_key: z.string().min(1),
  category: z.string().min(1),
  label: z.string().min(1),
  sample_count: z.number().int().min(0),
  passed_count: z.number().int().min(0),
  failed_count: z.number().int().min(0),
  pass_rate: z.number().min(0).max(1),
  recent_window_size: z.number().int().min(1),
  recent_pass_rate: z.number().min(0).max(1),
  prior_pass_rate: z.number().min(0).max(1).nullable(),
  trend_delta: z.number().min(-1).max(1).nullable(),
  trend_signal: promotionTrendSignalSchema,
  average_total_score_delta: z.number().min(-1).max(1),
  average_direction_accuracy_delta: z.number().min(-1).max(1),
  average_wrong_rate_delta: z.number().min(-1).max(1),
  average_calibration_alignment_delta: z.number().min(-1).max(1),
  families: z.array(z.string().min(1)),
});

export const promotionPatternAnalyticsResponseSchema = z.object({
  generated_at: z.iso.datetime(),
  sample_count: z.number().int().min(0),
  patterns: z.array(promotionPatternMetricSchema),
  leaders: z.object({
    by_pass_rate: z.string().nullable(),
    by_trend_improvement: z.string().nullable(),
    by_calibration_alignment: z.string().nullable(),
    by_wrong_rate_reduction: z.string().nullable(),
  }),
});

export const promotionCycleCandidateSchema = z.object({
  candidate_model_version: z.string().min(1),
  baseline_model_version: z.string().min(1),
  family: z.string().min(1),
  status: modelStatusSchema,
  created_at: z.iso.datetime(),
});

export const promotionCycleRequestSchema = z.object({
  case_pack: z.string().min(1).max(80).default("macro_plus_v1"),
  benchmark_pack_id: z.string().min(1).max(120).optional(),
  benchmark_case_pack_filters: z
    .array(z.string().min(1).max(120))
    .min(1)
    .max(40)
    .optional(),
  benchmark_allowed_case_qualities: z
    .array(historicalCaseQualitySchema)
    .min(1)
    .max(3)
    .default(["reviewed", "high_confidence"]),
  benchmark_strict_quotas: z.boolean().default(true),
  thresholds: replayPromotionThresholdsSchema.default({
    min_average_total_score_delta: 0.01,
    min_direction_accuracy_delta: 0,
    max_wrong_rate_delta: 0,
    min_calibration_alignment_delta: 0,
  }),
  walk_forward: walkForwardPromotionConfigSchema.optional(),
  promote_on_pass: z.boolean().default(true),
  promoted_status: modelStatusSchema.default("active"),
  max_candidates: z.number().int().min(1).max(50).default(10),
});

export const promotionCycleResponseSchema = z.object({
  case_pack: z.string().min(1),
  benchmark_pack_id: z.string().min(1).max(120).nullable().default(null),
  processed: z.number().int().min(0),
  passed: z.number().int().min(0),
  failed: z.number().int().min(0),
  candidates: z.array(promotionCycleCandidateSchema),
  evaluations: z.array(storedPromotionEvaluationSchema),
});

export const moltCycleRequestSchema = z.object({
  case_pack: z.string().min(1).max(80).default("macro_plus_v1"),
  benchmark_pack_id: z.string().min(1).max(120).default("core_benchmark_v1"),
  apply_stability_bias: z.boolean().default(true),
  thresholds: replayPromotionThresholdsSchema.default({
    min_average_total_score_delta: 0.01,
    min_direction_accuracy_delta: 0,
    max_wrong_rate_delta: 0,
    min_calibration_alignment_delta: 0,
  }),
  walk_forward: walkForwardPromotionConfigSchema.optional(),
  promote_on_pass: z.boolean().default(true),
  promoted_status: modelStatusSchema.default("active"),
  max_families: z.number().int().min(1).max(50).default(10),
  min_family_pass_rate: z.number().min(0).max(1).default(0.65),
  score_floor: z.number().min(0).max(1).default(0.68),
  max_abs_calibration_gap: z.number().min(0).max(1).default(0.12),
  trigger_on_declining_trend: z.boolean().default(true),
  require_pattern_priors: z.boolean().default(true),
  label_suffix: z.string().min(1).max(80).default("Molted"),
});

export const moltCycleStabilityAdjustmentSchema = z.object({
  benchmark_pack_id: z.string().min(1).max(120),
  signal: z.enum(["emerging", "durable", "watch", "fragile"]).nullable(),
  stability_score: z.number().min(0).max(1).nullable(),
  resilience_score: z.number().min(0).max(1).nullable(),
  trigger_bias: z.enum(["accelerated", "neutral", "guarded"]),
  promotion_bias: z.enum(["stricter", "neutral"]),
  effective_trigger_thresholds: z.object({
    min_family_pass_rate: z.number().min(0).max(1),
    score_floor: z.number().min(0).max(1),
    max_abs_calibration_gap: z.number().min(0).max(1),
    trigger_on_declining_trend: z.boolean(),
  }),
  effective_promotion_thresholds: replayPromotionThresholdsSchema,
  rationale: z.array(z.string().min(1)),
});

export const moltCycleItemSchema = z.object({
  family: z.string().min(1),
  baseline_model_version: z.string().min(1),
  target_model_version: z.string().min(1).nullable(),
  trigger_reasons: z.array(z.string().min(1)),
  status: z.enum(["generated", "hardened", "held", "skipped"]),
  skip_reason: z.string().nullable(),
  stability_adjustment: moltCycleStabilityAdjustmentSchema.nullable(),
  applied_pattern_priors: replayPatternPriorSetSchema.nullable(),
  saved_model: storedModelVersionSchema.nullable(),
  promotion_evaluation: storedPromotionEvaluationSchema.nullable(),
});

export const moltCycleResponseSchema = z.object({
  case_pack: z.string().min(1),
  benchmark_pack_id: z.string().min(1).max(120).nullable(),
  stability_applied: z.boolean(),
  considered: z.number().int().min(0),
  triggered: z.number().int().min(0),
  generated: z.number().int().min(0),
  hardened: z.number().int().min(0),
  held: z.number().int().min(0),
  skipped: z.number().int().min(0),
  items: z.array(moltCycleItemSchema),
});

export const modelLineageOriginSchema = z.enum(["root", "replay_tuned", "molted"]);
export const modelLineageShellStateSchema = z.enum([
  "root",
  "active",
  "hardened",
  "soft",
  "held",
]);

export const modelLineageNodeSchema = z.object({
  family: z.string().min(1),
  model_version: z.string().min(1),
  label: z.string().min(1).nullable(),
  parent_model_version: z.string().min(1).nullable(),
  generation: z.number().int().min(0),
  origin_type: modelLineageOriginSchema,
  shell_state: modelLineageShellStateSchema,
  registry_status: modelStatusSchema,
  created_at: z.iso.datetime(),
  reviewed_count: z.number().int().min(0),
  average_total_score: z.number().min(0).max(1).nullable(),
  direction_accuracy: z.number().min(0).max(1).nullable(),
  calibration_gap: z.number().min(-1).max(1).nullable(),
  trigger_reasons: z.array(z.string().min(1)),
  prior_patterns: z.array(z.string().min(1)),
  promotion_passed: z.boolean().nullable(),
  promotion_reasons: z.array(z.string().min(1)),
  promotion_case_pack: z.string().min(1).nullable(),
});

export const modelLineageFamilySchema = z.object({
  family: z.string().min(1),
  root_model_version: z.string().min(1).nullable(),
  active_model_version: z.string().min(1).nullable(),
  latest_model_version: z.string().min(1).nullable(),
  generation_depth: z.number().int().min(0),
  total_shells: z.number().int().min(0),
  hardened_shells: z.number().int().min(0),
  lineage: z.array(modelLineageNodeSchema),
});

export const modelLineageReportSchema = z.object({
  generated_at: z.iso.datetime(),
  families: z.array(modelLineageFamilySchema),
  recent_molts: z.array(modelLineageNodeSchema),
});

export const lineageSnapshotRequestSchema = z.object({
  as_of: z.iso.datetime().optional(),
});

export const lineageSnapshotSchema = z.object({
  id: z.string().uuid(),
  as_of: z.iso.datetime(),
  family_count: z.number().int().min(0),
  total_shells: z.number().int().min(0),
  hardened_shells: z.number().int().min(0),
  report: modelLineageReportSchema,
  created_at: z.iso.datetime(),
});

export const lineageHistoryResponseSchema = z.object({
  snapshots: z.array(lineageSnapshotSchema),
});

export const evolutionCycleRequestSchema = z.object({
  as_of: z.iso.datetime().optional(),
  create_postmortems: z.boolean().default(true),
  capture_calibration_snapshot: z.boolean().default(true),
  capture_benchmark_snapshot: z.boolean().default(true),
  capture_walk_forward_snapshot: z.boolean().default(true),
  benchmark_pack_id: z.string().min(1).max(120).default("core_benchmark_v1"),
  walk_forward_snapshot: walkForwardReplaySnapshotRequestSchema.optional(),
  run_molt_cycle: z.boolean().default(true),
  capture_lineage_snapshot: z.boolean().default(true),
  molt_cycle: moltCycleRequestSchema.optional(),
});

export const evolutionScheduleRunSummarySchema = z.object({
    ran_self_audit: z.boolean(),
    ran_benchmark_trust_refresh: z.boolean().default(false),
    captured_benchmark_snapshot: z.boolean(),
    captured_walk_forward_snapshot: z.boolean().default(false),
    ran_molt_cycle: z.boolean(),
    captured_lineage_snapshot: z.boolean(),
    processed_predictions: z.number().int().min(0),
    seeded_high_confidence_cases: z.number().int().min(0).default(0),
    benchmark_trust_warning_delta: z.number().int().default(0),
    benchmark_snapshot_case_count: z.number().int().min(0).default(0),
    benchmark_snapshot_family_count: z.number().int().min(0).default(0),
    walk_forward_window_count: z.number().int().min(0).default(0),
    walk_forward_snapshot_family_count: z.number().int().min(0).default(0),
    hardened_shells: z.number().int().min(0),
  held_shells: z.number().int().min(0),
  lineage_family_count: z.number().int().min(0),
  open_growth_alerts: z.number().int().min(0).default(0),
  planned_growth_actions: z.number().int().min(0).default(0),
  executed_growth_actions: z.number().int().min(0).default(0),
});

export const evolutionScheduleConfigSchema = z.object({
    id: z.string().min(1).default("default"),
    enabled: z.boolean().default(true),
    create_postmortems: z.boolean().default(true),
    capture_calibration_snapshot: z.boolean().default(true),
    capture_benchmark_snapshot: z.boolean().default(true),
    capture_walk_forward_snapshot: z.boolean().default(true),
    benchmark_pack_id: z.string().min(1).max(120).default("core_benchmark_v1"),
    run_benchmark_trust_refresh: z.boolean().default(true),
    run_molt_cycle: z.boolean().default(true),
    capture_lineage_snapshot: z.boolean().default(true),
    self_audit_interval_hours: z.number().int().min(1).max(24 * 30).default(24),
    benchmark_snapshot_interval_hours: z.number().int().min(1).max(24 * 30).default(24),
    walk_forward_snapshot_interval_hours: z.number().int().min(1).max(24 * 90).default(24 * 7),
    benchmark_trust_refresh_interval_hours: z.number().int().min(1).max(24 * 90).default(24 * 7),
    molt_interval_hours: z.number().int().min(1).max(24 * 90).default(24 * 7),
    lineage_snapshot_interval_hours: z.number().int().min(1).max(24 * 30).default(24),
    walk_forward_defaults: walkForwardReplaySnapshotRequestSchema.default({
      benchmark_pack_id: "core_benchmark_v1",
      allowed_case_qualities: ["reviewed", "high_confidence"],
      training_mode: "expanding",
      min_train_cases: 10,
      test_window_size: 5,
      seed_training_memory: true,
      training_memory_model_version: "walk-forward-memory-v1",
    }),
    trust_refresh_defaults: benchmarkTrustRefreshRequestSchema.default({
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
    }),
    molt_cycle_defaults: moltCycleRequestSchema.default({
      case_pack: "macro_plus_v1",
      benchmark_pack_id: "core_benchmark_v1",
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
  }),
    next_self_audit_at: z.iso.datetime().nullable(),
    next_benchmark_snapshot_at: z.iso.datetime().nullable(),
    next_walk_forward_snapshot_at: z.iso.datetime().nullable(),
    next_benchmark_trust_refresh_at: z.iso.datetime().nullable(),
    next_molt_at: z.iso.datetime().nullable(),
    next_lineage_snapshot_at: z.iso.datetime().nullable(),
    last_run_at: z.iso.datetime().nullable(),
  last_result: evolutionScheduleRunSummarySchema.nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const evolutionScheduleUpdateRequestSchema = z.object({
    id: z.string().min(1).default("default"),
    enabled: z.boolean().default(true),
    create_postmortems: z.boolean().default(true),
    capture_calibration_snapshot: z.boolean().default(true),
    capture_benchmark_snapshot: z.boolean().default(true),
    capture_walk_forward_snapshot: z.boolean().default(true),
    benchmark_pack_id: z.string().min(1).max(120).default("core_benchmark_v1"),
    run_benchmark_trust_refresh: z.boolean().default(true),
    run_molt_cycle: z.boolean().default(true),
    capture_lineage_snapshot: z.boolean().default(true),
    self_audit_interval_hours: z.number().int().min(1).max(24 * 30).default(24),
    benchmark_snapshot_interval_hours: z.number().int().min(1).max(24 * 30).default(24),
    walk_forward_snapshot_interval_hours: z.number().int().min(1).max(24 * 90).default(24 * 7),
    benchmark_trust_refresh_interval_hours: z.number().int().min(1).max(24 * 90).default(24 * 7),
    molt_interval_hours: z.number().int().min(1).max(24 * 90).default(24 * 7),
    lineage_snapshot_interval_hours: z.number().int().min(1).max(24 * 30).default(24),
    walk_forward_defaults: walkForwardReplaySnapshotRequestSchema.default({
      benchmark_pack_id: "core_benchmark_v1",
      allowed_case_qualities: ["reviewed", "high_confidence"],
      training_mode: "expanding",
      min_train_cases: 10,
      test_window_size: 5,
      seed_training_memory: true,
      training_memory_model_version: "walk-forward-memory-v1",
    }),
    trust_refresh_defaults: benchmarkTrustRefreshRequestSchema.default({
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
    }),
    molt_cycle_defaults: moltCycleRequestSchema.default({
      case_pack: "macro_plus_v1",
      benchmark_pack_id: "core_benchmark_v1",
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
  }),
});

export const evolutionScheduleRunResponseSchema = z.object({
  ran: z.boolean(),
  due: z.object({
    self_audit: z.boolean(),
    benchmark_snapshot: z.boolean(),
    walk_forward_snapshot: z.boolean(),
    benchmark_trust_refresh: z.boolean(),
    molt_cycle: z.boolean(),
    lineage_snapshot: z.boolean(),
  }),
  reason: z.string().nullable(),
  schedule: evolutionScheduleConfigSchema,
  trust_refresh: benchmarkTrustRefreshResponseSchema.nullable(),
  result: z.lazy(() => evolutionCycleResponseSchema).nullable(),
});

export const evolutionTrendPointSchema = z.object({
  as_of: z.iso.datetime(),
  generation_depth: z.number().int().min(0),
  total_shells: z.number().int().min(0),
  hardened_shells: z.number().int().min(0),
  active_model_version: z.string().min(1).nullable(),
  average_total_score: z.number().min(0).max(1).nullable(),
  calibration_gap: z.number().min(-1).max(1).nullable(),
});

export const evolutionFamilyTrendSchema = z.object({
  family: z.string().min(1),
  active_model_version: z.string().min(1).nullable(),
  generation_depth: z.number().int().min(0),
  generation_depth_delta: z.number().int(),
  total_shells: z.number().int().min(0),
  shell_delta: z.number().int(),
  hardened_shells: z.number().int().min(0),
  hardened_delta: z.number().int(),
  current_average_total_score: z.number().min(0).max(1).nullable(),
  score_delta: z.number().min(-1).max(1).nullable(),
  current_calibration_gap: z.number().min(-1).max(1).nullable(),
  calibration_gap_delta: z.number().min(-1).max(1).nullable(),
  recent_pass_rate: z.number().min(0).max(1).nullable(),
  prior_pass_rate: z.number().min(0).max(1).nullable(),
  pass_rate_delta: z.number().min(-1).max(1).nullable(),
  trend_signal: z.enum(["improving", "stable", "pressured", "emerging"]),
  snapshots: z.array(evolutionTrendPointSchema),
});

export const evolutionTrendReportSchema = z.object({
  generated_at: z.iso.datetime(),
  sample_count: z.number().int().min(0),
  families: z.array(evolutionFamilyTrendSchema),
  leaders: z.object({
    by_generation_growth: z.string().nullable(),
    by_hardening_growth: z.string().nullable(),
    by_score_improvement: z.string().nullable(),
  }),
});

export const growthPressureSeveritySchema = z.enum(["low", "medium", "high"]);
export const growthPressureAlertStatusSchema = z.enum([
  "open",
  "acknowledged",
  "snoozed",
  "handled",
  "resolved",
]);
export const growthPressureActionTypeSchema = z.enum([
  "notify",
  "run_replay_diagnostics",
  "generate_candidate_shell",
  "schedule_molt_review",
]);
export const growthPressureActionStatusSchema = z.enum([
  "pending",
  "approved",
  "blocked",
  "executed",
  "skipped",
]);

export const growthPressurePolicyThresholdsSchema = z.object({
  low_pass_rate: z.number().min(0).max(1).default(0.6),
  medium_pass_rate: z.number().min(0).max(1).default(0.52),
  high_pass_rate: z.number().min(0).max(1).default(0.45),
  low_average_total_score: z.number().min(0).max(1).default(0.65),
  medium_average_total_score: z.number().min(0).max(1).default(0.6),
  high_average_total_score: z.number().min(0).max(1).default(0.55),
  medium_abs_calibration_gap: z.number().min(0).max(1).default(0.1),
  high_abs_calibration_gap: z.number().min(0).max(1).default(0.14),
  pass_rate_delta_decline: z.number().min(-1).max(0).default(-0.15),
});

export const growthPressurePolicyPersistenceSchema = z.object({
  medium_persistent_cycles: z.number().int().min(1).max(30).default(2),
  high_persistent_cycles: z.number().int().min(1).max(30).default(2),
  candidate_generation_cycles: z.number().int().min(1).max(30).default(3),
});

export const growthPressurePolicyActionsSchema = z.object({
  diagnostics_case_pack: z.string().min(1).max(80).default("macro_plus_v1"),
  auto_queue_diagnostics: z.boolean().default(true),
  auto_schedule_molt_review: z.boolean().default(true),
  require_operator_approval_for_candidate_generation: z.boolean().default(true),
});

export const growthPressurePolicySchema = z.object({
  family: z.string().min(1),
  enabled: z.boolean().default(true),
  thresholds: growthPressurePolicyThresholdsSchema,
  persistence: growthPressurePolicyPersistenceSchema,
  actions: growthPressurePolicyActionsSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const growthPressurePolicyUpsertRequestSchema = z.object({
  family: z.string().min(1),
  enabled: z.boolean().default(true),
  thresholds: growthPressurePolicyThresholdsSchema.partial().default({}),
  persistence: growthPressurePolicyPersistenceSchema.partial().default({}),
  actions: growthPressurePolicyActionsSchema.partial().default({}),
});

export const growthPressureAlertSchema = z.object({
  id: z.string().uuid().nullable(),
  family: z.string().min(1),
  policy_family: z.string().min(1),
  severity: growthPressureSeveritySchema,
  status: growthPressureAlertStatusSchema,
  active_model_version: z.string().min(1).nullable(),
  generation_depth: z.number().int().min(0),
  pass_rate: z.number().min(0).max(1).nullable(),
  average_total_score: z.number().min(0).max(1).nullable(),
  calibration_gap: z.number().min(-1).max(1).nullable(),
  trend_signal: z.enum(["improving", "stable", "pressured", "emerging"]),
  persistence_count: z.number().int().min(1),
  first_triggered_at: z.iso.datetime().nullable(),
  last_triggered_at: z.iso.datetime().nullable(),
  snoozed_until: z.iso.datetime().nullable(),
  acknowledged_at: z.iso.datetime().nullable(),
  handled_at: z.iso.datetime().nullable(),
  resolved_at: z.iso.datetime().nullable(),
  planned_action: growthPressureActionTypeSchema.nullable(),
  plan_status: growthPressureActionStatusSchema.nullable(),
  signals: z.array(z.string().min(1)),
  recommended_action: z.string().min(1),
});

export const storedGrowthPressureAlertSchema = growthPressureAlertSchema.extend({
  id: z.string().uuid(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const growthPressureAlertReportSchema = z.object({
  generated_at: z.iso.datetime(),
  counts: z.object({
    high: z.number().int().min(0),
    medium: z.number().int().min(0),
    low: z.number().int().min(0),
  }),
  alerts: z.array(growthPressureAlertSchema),
});

export const growthPressureAlertHistoryResponseSchema = z.object({
  alerts: z.array(storedGrowthPressureAlertSchema),
});

export const growthPressureActionPlanSchema = z.object({
  id: z.string().uuid(),
  alert_id: z.string().uuid(),
  family: z.string().min(1),
  active_model_version: z.string().min(1).nullable(),
  action_type: growthPressureActionTypeSchema,
  status: growthPressureActionStatusSchema,
  requires_operator_approval: z.boolean(),
  rationale: z.string().min(1),
  payload: z.record(z.string(), z.any()),
  result: z.record(z.string(), z.any()).nullable(),
  candidate_model_version: z.string().min(1).nullable(),
  operator_note: z.string().min(1).max(500).nullable(),
  approved_at: z.iso.datetime().nullable(),
  blocked_at: z.iso.datetime().nullable(),
  executed_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const growthPressureActionPlanListResponseSchema = z.object({
  actions: z.array(growthPressureActionPlanSchema),
});

export const growthPressurePolicyListResponseSchema = z.object({
  policies: z.array(growthPressurePolicySchema),
});

export const growthPressureAlertAcknowledgeRequestSchema = z.object({
  operator_note: z.string().min(1).max(500).optional(),
});

export const growthPressureAlertSnoozeRequestSchema = z.object({
  duration_hours: z.number().int().min(1).max(24 * 30).default(24),
  operator_note: z.string().min(1).max(500).optional(),
});

export const growthPressureAlertHandleRequestSchema = z.object({
  operator_note: z.string().min(1).max(500).optional(),
});

export const growthPressureActionDecisionRequestSchema = z.object({
  operator_note: z.string().min(1).max(500).optional(),
});

export const growthPressureMonitoringResultSchema = z.object({
  as_of: z.iso.datetime(),
  alerts: z.array(growthPressureAlertSchema),
  resolved_alert_ids: z.array(z.string().uuid()),
  action_plans: z.array(growthPressureActionPlanSchema),
  counts: z.object({
    open: z.number().int().min(0),
    acknowledged: z.number().int().min(0),
    snoozed: z.number().int().min(0),
    handled: z.number().int().min(0),
    resolved: z.number().int().min(0),
    plans_created: z.number().int().min(0),
    plans_pending: z.number().int().min(0),
    plans_executed: z.number().int().min(0),
    plans_blocked: z.number().int().min(0),
    plans_skipped: z.number().int().min(0),
  }),
});

export const evolutionCycleResponseSchema = z.object({
  self_audit: selfAuditResponseSchema,
  benchmark_snapshot: benchmarkReplaySnapshotSchema.nullable(),
  walk_forward_snapshot: walkForwardReplaySnapshotSchema.nullable(),
  molt_cycle: moltCycleResponseSchema.nullable(),
  lineage_snapshot: lineageSnapshotSchema.nullable(),
  growth_pressure: growthPressureMonitoringResultSchema,
});

export const feedPullSourceSchema = z.object({
  url: z.url(),
  publisher: z.string().min(1).max(120).optional(),
  source_type: sourceTypeSchema.default("headline"),
  speaker: z.string().min(1).max(120).optional(),
  max_items: z.number().int().min(1).max(25).default(5),
});

export const feedPullRequestSchema = z.object({
  feeds: z.array(feedPullSourceSchema).min(1).max(10),
  parse_events: z.boolean().default(true),
});

export const feedPullResultSchema = z.object({
  status: z.enum(["ingested", "duplicate"]),
  feed_url: z.url(),
  source_id: z.string().uuid(),
  event_id: z.string().uuid().nullable(),
  title: z.string().min(1),
  publisher: z.string().nullable(),
  raw_uri: z.url().nullable(),
  occurred_at: z.iso.datetime().nullable(),
});

export const feedPullResponseSchema = z.object({
  ingested_sources: z.number().int().min(0),
  ingested_events: z.number().int().min(0),
  duplicate_sources: z.number().int().min(0),
  results: z.array(feedPullResultSchema),
});

export const transcriptSourceTypeSchema = z.enum(["transcript", "speech", "earnings", "filing"]);

export const transcriptPullTargetSchema = z.object({
  url: z.url(),
  source_type: transcriptSourceTypeSchema.default("transcript"),
  title: z.string().min(1).max(240).optional(),
  speaker: z.string().min(1).max(120).optional(),
  publisher: z.string().min(1).max(120).optional(),
  max_chars: z.number().int().min(500).max(20000).default(12000),
});

export const transcriptPullRequestSchema = z.object({
  items: z.array(transcriptPullTargetSchema).min(1).max(10),
  parse_events: z.boolean().default(true),
});

export const transcriptPullResultSchema = z.object({
  status: z.enum(["ingested", "duplicate"]),
  source_id: z.string().uuid(),
  event_id: z.string().uuid().nullable(),
  title: z.string().min(1),
  publisher: z.string().nullable(),
  speaker: z.string().nullable(),
  raw_uri: z.url().nullable(),
  occurred_at: z.iso.datetime().nullable(),
  extracted_chars: z.number().int().min(0),
});

export const transcriptPullResponseSchema = z.object({
  ingested_sources: z.number().int().min(0),
  ingested_events: z.number().int().min(0),
  duplicate_sources: z.number().int().min(0),
  results: z.array(transcriptPullResultSchema),
});

export const transcriptSessionStatusSchema = z.enum(["active", "closed"]);

export const createTranscriptSessionRequestSchema = z.object({
  source_type: transcriptSourceTypeSchema.default("transcript"),
  title: z.string().min(1).max(240).optional(),
  speaker: z.string().min(1).max(120).optional(),
  publisher: z.string().min(1).max(120).optional(),
  raw_uri: z.url().max(2000).optional(),
  model_version: z.string().min(1).max(80).default("impact-engine-v0"),
  horizons: z.array(predictionHorizonSchema).min(1).max(3).default(["1d"]),
  rolling_window_chars: z.number().int().min(1000).max(20000).default(8000),
});

export const storedTranscriptSessionSchema = createTranscriptSessionRequestSchema.extend({
  id: z.string().uuid(),
  status: transcriptSessionStatusSchema,
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const createTranscriptChunkRequestSchema = z.object({
  text: z.string().min(1).max(10000),
  occurred_at: z.iso.datetime().optional(),
});

export const storedTranscriptChunkSchema = createTranscriptChunkRequestSchema.extend({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  sequence: z.number().int().min(1),
  created_at: z.iso.datetime(),
});

export const transcriptSessionHighlightSchema = z.object({
  text: z.string().min(1),
  rationale: z.string().min(1),
  score: z.number().min(0).max(1),
});

export const transcriptSessionAnalysisSchema = z.object({
  id: z.string().uuid(),
  session_id: z.string().uuid(),
  chunk_count: z.number().int().min(0),
  rolling_text_chars: z.number().int().min(0),
  parsed_event: parsedEventSchema,
  analogs: z.array(analogMatchSchema),
  predictions: z.array(generatedPredictionSchema),
  highlights: z.array(transcriptSessionHighlightSchema),
  created_at: z.iso.datetime(),
});

export const transcriptSessionDetailSchema = z.object({
  session: storedTranscriptSessionSchema,
  chunk_count: z.number().int().min(0),
  latest_analysis: transcriptSessionAnalysisSchema.nullable(),
});

export const liveTranscriptProviderSchema = z.enum(["generic", "deepgram", "assemblyai"]);

export const transcriptStreamBindingSchema = z.object({
  id: z.string().uuid(),
  provider: liveTranscriptProviderSchema,
  external_stream_key: z.string().min(1).max(240),
  session_id: z.string().uuid(),
  metadata: z.record(z.string(), z.string()),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const transcriptStreamBufferSchema = z.object({
  id: z.string().uuid(),
  provider: liveTranscriptProviderSchema,
  external_stream_key: z.string().min(1).max(240),
  session_id: z.string().uuid(),
  pending_text: z.string(),
  fragment_count: z.number().int().min(0),
  first_occurred_at: z.iso.datetime().nullable(),
  last_occurred_at: z.iso.datetime().nullable(),
  created_at: z.iso.datetime(),
  updated_at: z.iso.datetime(),
});

export const liveTranscriptWebhookBindingStatusSchema = z.enum(["direct", "created", "reused"]);
export const liveTranscriptWebhookEventStatusSchema = z.enum([
  "appended",
  "buffered",
  "ignored_partial",
  "ignored_empty",
  "closed",
]);

export const liveTranscriptWebhookResponseSchema = z.object({
  provider: liveTranscriptProviderSchema,
  session_id: z.string().uuid(),
  session_status: transcriptSessionStatusSchema,
  binding_status: liveTranscriptWebhookBindingStatusSchema,
  event_status: liveTranscriptWebhookEventStatusSchema,
  chunk_appended: z.boolean(),
  buffered_chars: z.number().int().min(0),
  buffered_fragments: z.number().int().min(0),
  latest_analysis: transcriptSessionAnalysisSchema.nullable(),
});

export type ParseEventRequest = z.infer<typeof parseEventRequestSchema>;
export type ParsedEvent = z.infer<typeof parsedEventSchema>;
export type ParsedEventEntity = z.infer<typeof entitySchema>;
export type GeneratePredictionRequest = z.infer<typeof generatePredictionRequestSchema>;
export type GeneratedPrediction = z.infer<typeof generatedPredictionSchema>;
export type GeneratedPredictionAsset = z.infer<typeof generatedPredictionAssetSchema>;
export type CreateSourceRequest = z.infer<typeof createSourceRequestSchema>;
export type StoredSource = z.infer<typeof storedSourceSchema>;
export type StoredEvent = z.infer<typeof storedEventSchema>;
export type CreateStoredPredictionsRequest = z.infer<typeof createStoredPredictionsRequestSchema>;
export type StoredPrediction = z.infer<typeof storedPredictionSchema>;
export type CreateModelVersionRequest = z.infer<typeof createModelVersionRequestSchema>;
export type StoredModelVersion = z.infer<typeof storedModelVersionSchema>;
export type CreateTranscriptSessionRequest = z.infer<typeof createTranscriptSessionRequestSchema>;
export type StoredTranscriptSession = z.infer<typeof storedTranscriptSessionSchema>;
export type CreateTranscriptChunkRequest = z.infer<typeof createTranscriptChunkRequestSchema>;
export type StoredTranscriptChunk = z.infer<typeof storedTranscriptChunkSchema>;
export type TranscriptSessionAnalysis = z.infer<typeof transcriptSessionAnalysisSchema>;
export type LiveTranscriptProvider = z.infer<typeof liveTranscriptProviderSchema>;
export type TranscriptStreamBinding = z.infer<typeof transcriptStreamBindingSchema>;
export type TranscriptStreamBuffer = z.infer<typeof transcriptStreamBufferSchema>;
export type LiveTranscriptWebhookResponse = z.infer<typeof liveTranscriptWebhookResponseSchema>;
export type RealizedMove = z.infer<typeof realizedMoveSchema>;
export type ScorePredictionRequest = z.infer<typeof scorePredictionRequestSchema>;
export type PredictionOutcome = z.infer<typeof predictionOutcomeSchema>;
export type Postmortem = z.infer<typeof postmortemSchema>;
export type Lesson = z.infer<typeof lessonSchema>;
export type AutoScoreRequest = z.infer<typeof autoScoreRequestSchema>;
export type AutoScoreResponse = z.infer<typeof autoScoreResponseSchema>;
export type AnalogMatch = z.infer<typeof analogMatchSchema>;
export type CalibrationReport = z.infer<typeof calibrationReportSchema>;
export type CalibrationSnapshot = z.infer<typeof calibrationSnapshotSchema>;
export type ModelComparisonReport = z.infer<typeof modelComparisonReportSchema>;
export type SelfAuditResponse = z.infer<typeof selfAuditResponseSchema>;
export type LessonSearchResponse = z.infer<typeof lessonSearchResponseSchema>;
export type DashboardSummary = z.infer<typeof dashboardSummarySchema>;
export type DashboardPipelineResponse = z.infer<typeof dashboardPipelineResponseSchema>;
export type SystemOperationName = z.infer<typeof systemOperationNameSchema>;
export type OperationRunStatus = z.infer<typeof operationRunStatusSchema>;
export type OperationRunTrigger = z.infer<typeof operationRunTriggerSchema>;
export type JsonValue = z.infer<typeof jsonValueSchema>;
export type OperationRunRecord = z.infer<typeof operationRunRecordSchema>;
export type SystemOperationHealth = z.infer<typeof systemOperationHealthSchema>;
export type OperationRunHistoryResponse = z.infer<typeof operationRunHistoryResponseSchema>;
export type SystemOperationReport = z.infer<typeof systemOperationReportSchema>;
export type OperationLeaseRecord = z.infer<typeof operationLeaseRecordSchema>;
export type OperationLeaseListResponse = z.infer<typeof operationLeaseListResponseSchema>;
export type OperationJobStatus = z.infer<typeof operationJobStatusSchema>;
export type OperationJobRecord = z.infer<typeof operationJobRecordSchema>;
export type OperationJobEnqueueRequest = z.infer<typeof operationJobEnqueueRequestSchema>;
export type OperationJobListResponse = z.infer<typeof operationJobListResponseSchema>;
export type OperationQueueReport = z.infer<typeof operationQueueReportSchema>;
export type OperationQueueAlert = z.infer<typeof operationQueueAlertSchema>;
export type OperationQueueAlertReport = z.infer<typeof operationQueueAlertReportSchema>;
export type SystemOperationalIncidentSeverity = z.infer<typeof systemOperationalIncidentSeveritySchema>;
export type SystemOperationalIncidentSource = z.infer<typeof systemOperationalIncidentSourceSchema>;
export type SystemOperationalIncident = z.infer<typeof systemOperationalIncidentSchema>;
export type SystemOperationalIncidentReport = z.infer<typeof systemOperationalIncidentReportSchema>;
export type SystemIntegration = z.infer<typeof systemIntegrationSchema>;
export type SystemIntegrationSeverity = z.infer<typeof systemIntegrationSeveritySchema>;
export type SystemIntegrationHealth = z.infer<typeof systemIntegrationHealthSchema>;
export type SystemIntegrationIncident = z.infer<typeof systemIntegrationIncidentSchema>;
export type SystemIntegrationAlert = z.infer<typeof systemIntegrationAlertSchema>;
export type SystemIntegrationReport = z.infer<typeof systemIntegrationReportSchema>;
export type SystemIntegrationTrendBucket = z.infer<typeof systemIntegrationTrendBucketSchema>;
export type SystemIntegrationTrendSlice = z.infer<typeof systemIntegrationTrendSliceSchema>;
export type SystemIntegrationTrendReport = z.infer<typeof systemIntegrationTrendReportSchema>;
export type SystemIntegrationProbeStatus = z.infer<typeof systemIntegrationProbeStatusSchema>;
export type SystemIntegrationProbeTarget = z.infer<typeof systemIntegrationProbeTargetSchema>;
export type SystemIntegrationProbeSummary = z.infer<typeof systemIntegrationProbeSummarySchema>;
export type SystemIntegrationProbeReport = z.infer<typeof systemIntegrationProbeReportSchema>;
export type IntegrationProbeSnapshotRequest = z.infer<typeof integrationProbeSnapshotRequestSchema>;
export type IntegrationGovernanceRefreshRequest = z.infer<
  typeof integrationGovernanceRefreshRequestSchema
>;
export type SystemIntegrationProbeState = z.infer<typeof systemIntegrationProbeStateSchema>;
export type SystemIntegrationGovernanceAction = z.infer<typeof systemIntegrationGovernanceActionSchema>;
export type SystemIntegrationGovernanceState = z.infer<typeof systemIntegrationGovernanceStateSchema>;
export type SystemIntegrationGovernanceReport = z.infer<typeof systemIntegrationGovernanceReportSchema>;
export type OperationWorkerLifecycleState = z.infer<typeof operationWorkerLifecycleStateSchema>;
export type OperationWorkerRecord = z.infer<typeof operationWorkerRecordSchema>;
export type OperationWorkerEventType = z.infer<typeof operationWorkerEventTypeSchema>;
export type OperationWorkerEventRecord = z.infer<typeof operationWorkerEventRecordSchema>;
export type OperationWorkerServiceLifecycleState = z.infer<typeof operationWorkerServiceLifecycleStateSchema>;
export type OperationWorkerServiceRecord = z.infer<typeof operationWorkerServiceRecordSchema>;
export type OperationWorkerServiceEventType = z.infer<typeof operationWorkerServiceEventTypeSchema>;
export type OperationWorkerServiceEventRecord = z.infer<typeof operationWorkerServiceEventRecordSchema>;
export type SystemWorkerStatus = z.infer<typeof systemWorkerStatusSchema>;
export type SystemWorkerHealth = z.infer<typeof systemWorkerHealthSchema>;
export type SystemWorkerServiceStatus = z.infer<typeof systemWorkerServiceStatusSchema>;
export type SystemWorkerServiceHealth = z.infer<typeof systemWorkerServiceHealthSchema>;
export type SystemWorkerReport = z.infer<typeof systemWorkerReportSchema>;
export type SystemWorkerServiceReport = z.infer<typeof systemWorkerServiceReportSchema>;
export type SystemWorkerServiceTrendBucket = z.infer<typeof systemWorkerServiceTrendBucketSchema>;
export type SystemWorkerServiceTrendAlert = z.infer<typeof systemWorkerServiceTrendAlertSchema>;
export type SystemWorkerServiceTrendReport = z.infer<typeof systemWorkerServiceTrendReportSchema>;
export type SystemWorkerTrendBucket = z.infer<typeof systemWorkerTrendBucketSchema>;
export type SystemWorkerTrendAlert = z.infer<typeof systemWorkerTrendAlertSchema>;
export type SystemWorkerTrendReport = z.infer<typeof systemWorkerTrendReportSchema>;
export type ReadinessDependencyStatus = z.infer<typeof readinessDependencyStatusSchema>;
export type ReadinessResponse = z.infer<typeof readinessResponseSchema>;
export type HistoricalIngestRequest = z.infer<typeof historicalIngestRequestSchema>;
export type HistoricalCaseLabel = z.infer<typeof historicalCaseLabelSchema>;
export type HistoricalCaseLabelInput = z.infer<typeof historicalCaseLabelInputSchema>;
export type HistoricalCaseReviewMetadata = z.infer<typeof historicalCaseReviewMetadataSchema>;
export type HistoricalCaseLibraryItem = z.infer<typeof historicalCaseLibraryItemSchema>;
export type HistoricalCaseLibraryDraft = z.infer<typeof historicalCaseLibraryDraftSchema>;
export type HistoricalCaseLibraryIngestionRequest = z.infer<typeof historicalCaseLibraryIngestionRequestSchema>;
export type HistoricalCaseLibraryIngestionResponse = z.infer<typeof historicalCaseLibraryIngestionResponseSchema>;
export type HistoricalCaseLibraryReviewRequest = z.infer<typeof historicalCaseLibraryReviewRequestSchema>;
export type HistoricalCaseLibraryReviewResponse = z.infer<typeof historicalCaseLibraryReviewResponseSchema>;
export type HistoricalCaseConfidenceRecommendation = z.infer<typeof historicalCaseConfidenceRecommendationSchema>;
export type HistoricalHighConfidenceCandidate = z.infer<typeof historicalHighConfidenceCandidateSchema>;
export type HistoricalHighConfidenceCandidateReport = z.infer<typeof historicalHighConfidenceCandidateReportSchema>;
export type HistoricalHighConfidencePromotionRequest = z.infer<typeof historicalHighConfidencePromotionRequestSchema>;
export type HistoricalHighConfidencePromotionResponse = z.infer<typeof historicalHighConfidencePromotionResponseSchema>;
export type HistoricalHighConfidenceSeedRequest = z.infer<typeof historicalHighConfidenceSeedRequestSchema>;
export type HistoricalHighConfidenceSeedItem = z.infer<typeof historicalHighConfidenceSeedItemSchema>;
export type HistoricalHighConfidenceSeedResponse = z.infer<typeof historicalHighConfidenceSeedResponseSchema>;
export type BenchmarkTrustRefreshRequest = z.infer<typeof benchmarkTrustRefreshRequestSchema>;
export type BenchmarkTrustRefreshSummary = z.infer<typeof benchmarkTrustRefreshSummarySchema>;
export type BenchmarkTrustRefreshDelta = z.infer<typeof benchmarkTrustRefreshDeltaSchema>;
export type BenchmarkTrustRefreshResponse = z.infer<typeof benchmarkTrustRefreshResponseSchema>;
export type BenchmarkTrustRefreshRecord = z.infer<typeof benchmarkTrustRefreshRecordSchema>;
export type BenchmarkTrustRefreshHistoryResponse = z.infer<typeof benchmarkTrustRefreshHistoryResponseSchema>;
export type HistoricalLibraryCoverageResponse = z.infer<typeof historicalLibraryCoverageResponseSchema>;
export type HistoricalLibraryGapReport = z.infer<typeof historicalLibraryGapReportSchema>;
export type MacroHistoricalCaseInput = z.infer<typeof macroHistoricalCaseInputSchema>;
export type MacroHistoricalIngestionRequest = z.infer<typeof macroHistoricalIngestionRequestSchema>;
export type EarningsHistoricalCaseInput = z.infer<typeof earningsHistoricalCaseInputSchema>;
export type EarningsHistoricalIngestionRequest = z.infer<typeof earningsHistoricalIngestionRequestSchema>;
export type PolicyHistoricalCaseInput = z.infer<typeof policyHistoricalCaseInputSchema>;
export type PolicyHistoricalIngestionRequest = z.infer<typeof policyHistoricalIngestionRequestSchema>;
export type EnergyHistoricalCaseInput = z.infer<typeof energyHistoricalCaseInputSchema>;
export type EnergyHistoricalIngestionRequest = z.infer<typeof energyHistoricalIngestionRequestSchema>;
export type CreditHistoricalCaseInput = z.infer<typeof creditHistoricalCaseInputSchema>;
export type CreditHistoricalIngestionRequest = z.infer<typeof creditHistoricalIngestionRequestSchema>;
export type CoreHistoricalCorpusIngestionRequest = z.infer<typeof coreHistoricalCorpusIngestionRequestSchema>;
export type CoreHistoricalCorpusIngestionResponse = z.infer<typeof coreHistoricalCorpusIngestionResponseSchema>;
export type HistoricalCaseLibraryReplayRequest = z.infer<typeof historicalCaseLibraryReplayRequestSchema>;
export type BenchmarkPackDomain = z.infer<typeof benchmarkPackDomainSchema>;
export type BenchmarkPackQuota = z.infer<typeof benchmarkPackQuotaSchema>;
export type BenchmarkPackDefinition = z.infer<typeof benchmarkPackDefinitionSchema>;
export type BenchmarkPackListResponse = z.infer<typeof benchmarkPackListResponseSchema>;
export type BenchmarkPackComposeRequest = z.infer<typeof benchmarkPackComposeRequestSchema>;
export type BenchmarkPackComposition = z.infer<typeof benchmarkPackCompositionSchema>;
export type BenchmarkReplaySnapshotRequest = z.infer<typeof benchmarkReplaySnapshotRequestSchema>;
export type BenchmarkReplaySnapshot = z.infer<typeof benchmarkReplaySnapshotSchema>;
export type BenchmarkReplaySnapshotHistoryResponse = z.infer<typeof benchmarkReplaySnapshotHistoryResponseSchema>;
export type BenchmarkTrendReport = z.infer<typeof benchmarkTrendReportSchema>;
export type BenchmarkRegressionReport = z.infer<typeof benchmarkRegressionReportSchema>;
export type BenchmarkStabilityReport = z.infer<typeof benchmarkStabilityReportSchema>;
export type DashboardBenchmarkResponse = z.infer<typeof dashboardBenchmarkResponseSchema>;
export type DashboardOperationalResponse = z.infer<typeof dashboardOperationalResponseSchema>;
export type HistoricalReplayRequest = z.infer<typeof historicalReplayRequestSchema>;
export type HistoricalReplayResponse = z.infer<typeof historicalReplayResponseSchema>;
export type WalkForwardTrainingMode = z.infer<typeof walkForwardTrainingModeSchema>;
export type WalkForwardReplayRequest = z.infer<typeof walkForwardReplayRequestSchema>;
export type WalkForwardDomainCount = z.infer<typeof walkForwardDomainCountSchema>;
export type WalkForwardWindow = z.infer<typeof walkForwardWindowSchema>;
export type WalkForwardReplayResponse = z.infer<typeof walkForwardReplayResponseSchema>;
export type WalkForwardReplaySnapshotRequest = z.infer<typeof walkForwardReplaySnapshotRequestSchema>;
export type WalkForwardReplaySnapshot = z.infer<typeof walkForwardReplaySnapshotSchema>;
export type WalkForwardReplaySnapshotHistoryResponse = z.infer<typeof walkForwardReplaySnapshotHistoryResponseSchema>;
export type WalkForwardTrendReport = z.infer<typeof walkForwardTrendReportSchema>;
export type WalkForwardRegimeTrendReport = z.infer<typeof walkForwardRegimeTrendReportSchema>;
export type WalkForwardRegressionReport = z.infer<typeof walkForwardRegressionReportSchema>;
export type WalkForwardRegimeRegressionReport = z.infer<typeof walkForwardRegimeRegressionReportSchema>;
export type HistoricalReplayDiagnosticsResponse = z.infer<typeof historicalReplayDiagnosticsResponseSchema>;
export type ApplyReplayTuningRequest = z.infer<typeof applyReplayTuningRequestSchema>;
export type ApplyReplayTuningResponse = z.infer<typeof applyReplayTuningResponseSchema>;
export type ReplayPromotionRequest = z.infer<typeof replayPromotionRequestSchema>;
export type ReplayPromotionDecision = z.infer<typeof replayPromotionDecisionSchema>;
export type StoredPromotionEvaluation = z.infer<typeof storedPromotionEvaluationSchema>;
export type PromotionCycleRequest = z.infer<typeof promotionCycleRequestSchema>;
export type PromotionCycleResponse = z.infer<typeof promotionCycleResponseSchema>;
export type MoltCycleRequest = z.infer<typeof moltCycleRequestSchema>;
export type MoltCycleResponse = z.infer<typeof moltCycleResponseSchema>;
export type ModelLineageReport = z.infer<typeof modelLineageReportSchema>;
export type LineageSnapshot = z.infer<typeof lineageSnapshotSchema>;
export type EvolutionCycleRequest = z.infer<typeof evolutionCycleRequestSchema>;
export type EvolutionCycleResponse = z.infer<typeof evolutionCycleResponseSchema>;
export type EvolutionScheduleConfig = z.infer<typeof evolutionScheduleConfigSchema>;
export type EvolutionScheduleUpdateRequest = z.infer<typeof evolutionScheduleUpdateRequestSchema>;
export type EvolutionScheduleRunResponse = z.infer<typeof evolutionScheduleRunResponseSchema>;
export type EvolutionTrendReport = z.infer<typeof evolutionTrendReportSchema>;
export type GrowthPressureAlertReport = z.infer<typeof growthPressureAlertReportSchema>;
export type GrowthPressurePolicy = z.infer<typeof growthPressurePolicySchema>;
export type GrowthPressurePolicyUpsertRequest = z.infer<typeof growthPressurePolicyUpsertRequestSchema>;
export type StoredGrowthPressureAlert = z.infer<typeof storedGrowthPressureAlertSchema>;
export type GrowthPressureActionPlan = z.infer<typeof growthPressureActionPlanSchema>;
export type GrowthPressureMonitoringResult = z.infer<typeof growthPressureMonitoringResultSchema>;
export type PromotionAnalyticsResponse = z.infer<typeof promotionAnalyticsResponseSchema>;
export type PromotionPatternAnalyticsResponse = z.infer<typeof promotionPatternAnalyticsResponseSchema>;
export type ReplayPatternPriorSet = z.infer<typeof replayPatternPriorSetSchema>;
export type FeedPullRequest = z.infer<typeof feedPullRequestSchema>;
export type TranscriptPullRequest = z.infer<typeof transcriptPullRequestSchema>;
