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
  OperationJobRecord,
  OperationLeaseRecord,
  OperationWorkerRecord,
    OperationWorkerEventRecord,
  OperationWorkerServiceEventRecord,
    OperationWorkerServiceRecord,
  LiveTranscriptProvider,
  OperationRunRecord,
  OperationRunStatus,
  OperationRunTrigger,
  SystemIntegration,
  SystemIntegrationProbeState,
  SystemIntegrationGovernanceState,
  SystemOperationName,
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

export type PredictionStatus = StoredPrediction["status"];

export type PendingPredictionRecord = {
  prediction: StoredPrediction;
  event: StoredEvent;
};

export type PredictionLearningRecord = {
  event: StoredEvent;
  prediction: StoredPrediction;
  outcome: PredictionOutcome | null;
  postmortem: Postmortem | null;
  lesson: Lesson | null;
  lesson_embedding: number[] | null;
};

export type LearningRecordListOptions = {
  limit?: number;
};

export type OperationQueueSummary = {
  counts: {
    pending: number;
    running: number;
    completed: number;
    failed: number;
    retry_scheduled: number;
    stale_running: number;
  };
  oldest_pending_at: string | null;
  longest_running_started_at: string | null;
};

export type OperationIntegrationQueueSummary = {
  operation_name: "feed_pull" | "transcript_pull";
  counts: {
    total: number;
    pending: number;
    running: number;
    completed: number;
    failed: number;
    retry_scheduled: number;
    stale_running: number;
    retryable_failures: number;
    non_retryable_failures: number;
    stale_recovered: number;
  };
  latest_job_at: string | null;
  latest_failure_at: string | null;
};

export type OperationWorkerEventSummaryBucket = {
  bucket_started_at: string;
  bucket_finished_at: string;
  started: number;
  stopped: number;
  error_stops: number;
  cycles: number;
  processed: number;
  completed: number;
  failed: number;
  retried: number;
  abandoned: number;
};

export type OperationWorkerServiceEventSummaryBucket = {
  bucket_started_at: string;
  bucket_finished_at: string;
  started: number;
  ownership_conflicts: number;
  loop_exits: number;
  scheduled_restarts: number;
  stopped: number;
  failed: number;
};

export type OperationIntegrationTrendSummaryBucket = {
  operation_name: "feed_pull" | "transcript_pull";
  bucket_started_at: string;
  bucket_finished_at: string;
  completed: number;
  failed: number;
  retry_scheduled: number;
  non_retryable_failures: number;
  stale_recovered: number;
};

export type BenchmarkSnapshotListOptions = {
  limit?: number;
  benchmark_pack_id?: string;
};

export type PromotionEvaluationListOptions = {
  limit?: number;
  benchmark_pack_id?: string;
  has_walk_forward?: boolean;
};

export interface Repository {
  createSource(input: CreateSourceRequest): Promise<StoredSource>;
  getSource(id: string): Promise<StoredSource | null>;
  getSourceByRawUri(rawUri: string): Promise<StoredSource | null>;
  createEvent(
    sourceId: string,
    event: Omit<StoredEvent, "id" | "source_id" | "created_at">,
  ): Promise<StoredEvent>;
  getEvent(id: string): Promise<StoredEvent | null>;
  createPrediction(
    eventId: string,
    prediction: Omit<StoredPrediction, "id" | "event_id" | "status" | "created_at">,
  ): Promise<StoredPrediction>;
  getPrediction(id: string): Promise<StoredPrediction | null>;
  updatePredictionStatus(id: string, status: PredictionStatus): Promise<StoredPrediction | null>;
  listPendingPredictionsReadyForScoring(asOf: string): Promise<PendingPredictionRecord[]>;
  listLearningRecords(options?: LearningRecordListOptions): Promise<PredictionLearningRecord[]>;
  saveOutcome(outcome: PredictionOutcome): Promise<PredictionOutcome>;
  getOutcomeByPredictionId(predictionId: string): Promise<PredictionOutcome | null>;
  savePostmortem(postmortem: Postmortem): Promise<Postmortem>;
  getPostmortemByPredictionId(predictionId: string): Promise<Postmortem | null>;
  saveLesson(lesson: Lesson, embedding?: number[] | null): Promise<Lesson>;
  listLessons(): Promise<Lesson[]>;
  saveModelVersion(input: CreateModelVersionRequest): Promise<StoredModelVersion>;
  getModelVersion(modelVersion: string): Promise<StoredModelVersion | null>;
  listModelVersions(): Promise<StoredModelVersion[]>;
  createTranscriptSession(input: CreateTranscriptSessionRequest): Promise<StoredTranscriptSession>;
  getTranscriptSession(id: string): Promise<StoredTranscriptSession | null>;
  getTranscriptStreamBinding(
    provider: LiveTranscriptProvider,
    externalStreamKey: string,
  ): Promise<TranscriptStreamBinding | null>;
  upsertTranscriptStreamBinding(input: {
    provider: LiveTranscriptProvider;
    external_stream_key: string;
    session_id: string;
    metadata?: Record<string, string>;
  }): Promise<TranscriptStreamBinding>;
  listTranscriptStreamBindings(limit?: number): Promise<TranscriptStreamBinding[]>;
  getTranscriptStreamBuffer(
    provider: LiveTranscriptProvider,
    externalStreamKey: string,
  ): Promise<TranscriptStreamBuffer | null>;
  upsertTranscriptStreamBuffer(input: {
    provider: LiveTranscriptProvider;
    external_stream_key: string;
    session_id: string;
    pending_text: string;
    fragment_count: number;
    first_occurred_at?: string | null;
    last_occurred_at?: string | null;
  }): Promise<TranscriptStreamBuffer>;
  clearTranscriptStreamBuffer(
    provider: LiveTranscriptProvider,
    externalStreamKey: string,
  ): Promise<void>;
  updateTranscriptSessionStatus(
    id: string,
    status: StoredTranscriptSession["status"],
  ): Promise<StoredTranscriptSession | null>;
  appendTranscriptSessionChunk(
    sessionId: string,
    input: CreateTranscriptChunkRequest,
  ): Promise<StoredTranscriptChunk>;
  listTranscriptSessionChunks(sessionId: string): Promise<StoredTranscriptChunk[]>;
  saveTranscriptSessionAnalysis(
    analysis: TranscriptSessionAnalysis,
  ): Promise<TranscriptSessionAnalysis>;
  getLatestTranscriptSessionAnalysis(
    sessionId: string,
  ): Promise<TranscriptSessionAnalysis | null>;
  saveCalibrationSnapshot(snapshot: CalibrationSnapshot): Promise<CalibrationSnapshot>;
  listCalibrationSnapshots(limit?: number): Promise<CalibrationSnapshot[]>;
  saveBenchmarkReplaySnapshot(snapshot: BenchmarkReplaySnapshot): Promise<BenchmarkReplaySnapshot>;
  listBenchmarkReplaySnapshots(
    options?: number | BenchmarkSnapshotListOptions,
  ): Promise<BenchmarkReplaySnapshot[]>;
  saveWalkForwardReplaySnapshot(
    snapshot: WalkForwardReplaySnapshot,
  ): Promise<WalkForwardReplaySnapshot>;
  listWalkForwardReplaySnapshots(
    options?: number | BenchmarkSnapshotListOptions,
  ): Promise<WalkForwardReplaySnapshot[]>;
  saveBenchmarkTrustRefresh(
    refresh: BenchmarkTrustRefreshRecord,
  ): Promise<BenchmarkTrustRefreshRecord>;
  listBenchmarkTrustRefreshes(
    options?: number | BenchmarkSnapshotListOptions,
  ): Promise<BenchmarkTrustRefreshRecord[]>;
  saveOperationRun(
    run: Omit<OperationRunRecord, "id" | "created_at">,
  ): Promise<OperationRunRecord>;
  listOperationRuns(options?: {
    limit?: number;
    operation_names?: SystemOperationName[];
    statuses?: OperationRunStatus[];
    triggered_by?: OperationRunTrigger[];
  }): Promise<OperationRunRecord[]>;
  acquireOperationLease(input: {
    operation_name: SystemOperationName;
    scope_key: string;
    owner: string;
    acquired_at: string;
    expires_at: string;
  }): Promise<OperationLeaseRecord | null>;
  renewOperationLease(input: {
    operation_name: SystemOperationName;
    scope_key: string;
    owner: string;
    renewed_at: string;
    expires_at: string;
  }): Promise<OperationLeaseRecord | null>;
  releaseOperationLease(input: {
    operation_name: SystemOperationName;
    scope_key: string;
    owner: string;
  }): Promise<boolean>;
  listOperationLeases(options?: {
    limit?: number;
    active_only?: boolean;
    as_of?: string;
    operation_names?: SystemOperationName[];
  }): Promise<OperationLeaseRecord[]>;
  enqueueOperationJob(input: {
    operation_name: SystemOperationName;
    triggered_by: OperationRunTrigger;
    payload: Record<string, JsonValue>;
    idempotency_key?: string | null;
    max_attempts: number;
    available_at: string;
  }): Promise<OperationJobRecord>;
  getOperationJob(id: string): Promise<OperationJobRecord | null>;
  listOperationJobs(options?: {
    limit?: number;
    operation_names?: SystemOperationName[];
    statuses?: OperationJobRecord["status"][];
    updated_after?: string;
    updated_before?: string;
  }): Promise<OperationJobRecord[]>;
  getLatestOperationJobsByOperation(options: {
    operation_names: SystemOperationName[];
  }): Promise<OperationJobRecord[]>;
  upsertOperationWorker(input: {
    worker_id: string;
    lifecycle_state: OperationWorkerRecord["lifecycle_state"];
    supported_operations?: SystemOperationName[];
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
  }): Promise<OperationWorkerRecord>;
  listOperationWorkers(options?: {
    limit?: number;
  }): Promise<OperationWorkerRecord[]>;
  upsertOperationWorkerService(input: {
    service_id: string;
    worker_id: string;
    lifecycle_state: OperationWorkerServiceRecord["lifecycle_state"];
    supported_operations?: SystemOperationName[];
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
  }): Promise<OperationWorkerServiceRecord>;
  getOperationWorkerService(serviceId: string): Promise<OperationWorkerServiceRecord | null>;
  listOperationWorkerServices(options?: {
    limit?: number;
  }): Promise<OperationWorkerServiceRecord[]>;
  saveOperationWorkerServiceEvent(
    input: Omit<OperationWorkerServiceEventRecord, "id" | "created_at">,
  ): Promise<OperationWorkerServiceEventRecord>;
  listOperationWorkerServiceEvents(options?: {
    limit?: number;
    service_id?: string;
    worker_id?: string;
    event_types?: OperationWorkerServiceEventRecord["event_type"][];
    occurred_after?: string;
    occurred_before?: string;
  }): Promise<OperationWorkerServiceEventRecord[]>;
  getOperationWorkerServiceEventSummary(options: {
    window_started_at: string;
    as_of: string;
    bucket_hours: number;
  }): Promise<OperationWorkerServiceEventSummaryBucket[]>;
  saveOperationWorkerEvent(input: Omit<OperationWorkerEventRecord, "id" | "created_at">): Promise<OperationWorkerEventRecord>;
  listOperationWorkerEvents(options?: {
    limit?: number;
    worker_id?: string;
    event_types?: OperationWorkerEventRecord["event_type"][];
    occurred_after?: string;
    occurred_before?: string;
  }): Promise<OperationWorkerEventRecord[]>;
  getOperationWorkerEventSummary(options: {
    window_started_at: string;
    as_of: string;
    bucket_hours: number;
  }): Promise<OperationWorkerEventSummaryBucket[]>;
  getOperationIntegrationTrendSummary(options: {
    window_started_at: string;
    as_of: string;
    bucket_hours: number;
    operation_names?: OperationIntegrationQueueSummary["operation_name"][];
  }): Promise<OperationIntegrationTrendSummaryBucket[]>;
  getOperationQueueSummary(options?: {
    as_of?: string;
  }): Promise<OperationQueueSummary>;
  getOperationIntegrationQueueSummary(options?: {
    as_of?: string;
  }): Promise<OperationIntegrationQueueSummary[]>;
  abandonStaleOperationJobs(input: {
    as_of: string;
    supported_operations?: SystemOperationName[];
    limit?: number;
    error_message?: string;
  }): Promise<OperationJobRecord[]>;
  claimNextOperationJob(input: {
    worker_id: string;
    as_of: string;
    lease_expires_at: string;
    supported_operations?: SystemOperationName[];
  }): Promise<OperationJobRecord | null>;
  heartbeatOperationJob(input: {
    id: string;
    worker_id: string;
    heartbeat_at: string;
    lease_expires_at: string;
  }): Promise<OperationJobRecord | null>;
  completeOperationJob(input: {
    id: string;
    worker_id: string;
    finished_at: string;
    result_summary: Record<string, string | number | boolean | null>;
  }): Promise<OperationJobRecord | null>;
  failOperationJob(input: {
    id: string;
    worker_id: string;
    finished_at: string;
    error_message: string;
    retry_at?: string | null;
    result_summary?: Record<string, string | number | boolean | null>;
  }): Promise<OperationJobRecord | null>;
  deferOperationJob(input: {
    id: string;
    worker_id: string;
    deferred_at: string;
    available_at: string;
    error_message: string;
    result_summary?: Record<string, string | number | boolean | null>;
  }): Promise<OperationJobRecord | null>;
  getEvolutionScheduleConfig(id?: string): Promise<EvolutionScheduleConfig | null>;
  saveEvolutionScheduleConfig(config: EvolutionScheduleConfig): Promise<EvolutionScheduleConfig>;
  saveSystemIntegrationGovernanceState(
    state: SystemIntegrationGovernanceState,
  ): Promise<SystemIntegrationGovernanceState>;
  listSystemIntegrationGovernanceStates(options?: {
    integrations?: SystemIntegration[];
  }): Promise<SystemIntegrationGovernanceState[]>;
  saveSystemIntegrationProbeState(
    state: SystemIntegrationProbeState,
  ): Promise<SystemIntegrationProbeState>;
  listSystemIntegrationProbeStates(options?: {
    integrations?: SystemIntegration[];
  }): Promise<SystemIntegrationProbeState[]>;
  getGrowthPressurePolicy(family: string): Promise<GrowthPressurePolicy | null>;
  listGrowthPressurePolicies(): Promise<GrowthPressurePolicy[]>;
  saveGrowthPressurePolicy(policy: GrowthPressurePolicy): Promise<GrowthPressurePolicy>;
  getGrowthPressureAlert(id: string): Promise<StoredGrowthPressureAlert | null>;
  listGrowthPressureAlerts(options?: {
    limit?: number;
    family?: string;
    statuses?: StoredGrowthPressureAlert["status"][];
  }): Promise<StoredGrowthPressureAlert[]>;
  saveGrowthPressureAlert(alert: StoredGrowthPressureAlert): Promise<StoredGrowthPressureAlert>;
  getGrowthPressureActionPlan(id: string): Promise<GrowthPressureActionPlan | null>;
  listGrowthPressureActionPlans(options?: {
    limit?: number;
    family?: string;
    statuses?: GrowthPressureActionPlan["status"][];
  }): Promise<GrowthPressureActionPlan[]>;
  saveGrowthPressureActionPlan(plan: GrowthPressureActionPlan): Promise<GrowthPressureActionPlan>;
  getHistoricalCaseLibraryItem(caseId: string): Promise<HistoricalCaseLibraryItem | null>;
  countHistoricalCaseLibraryItems(options?: {
    case_pack?: string;
    case_ids?: string[];
    case_qualities?: HistoricalCaseLibraryItem["labels"]["case_quality"][];
    reviewer?: string;
  }): Promise<number>;
  listHistoricalCaseLibraryItems(options?: {
    limit?: number;
    case_pack?: string;
    case_ids?: string[];
    case_qualities?: HistoricalCaseLibraryItem["labels"]["case_quality"][];
    reviewer?: string;
  }): Promise<HistoricalCaseLibraryItem[]>;
  saveHistoricalCaseLibraryItem(item: HistoricalCaseLibraryItem): Promise<HistoricalCaseLibraryItem>;
  saveLineageSnapshot(snapshot: LineageSnapshot): Promise<LineageSnapshot>;
  listLineageSnapshots(limit?: number): Promise<LineageSnapshot[]>;
  savePromotionEvaluation(
    evaluation: Omit<StoredPromotionEvaluation, "id" | "created_at">,
  ): Promise<StoredPromotionEvaluation>;
  listPromotionEvaluations(
    options?: number | PromotionEvaluationListOptions,
  ): Promise<StoredPromotionEvaluation[]>;
  reset?(): Promise<void>;
  close?(): Promise<void>;
}
