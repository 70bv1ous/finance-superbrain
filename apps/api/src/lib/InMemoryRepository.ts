import { randomUUID } from "node:crypto";

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
  OperationJobRecord,
  SystemIntegration,
  SystemIntegrationProbeState,
  SystemIntegrationGovernanceState,
  OperationLeaseRecord,
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
    OperationQueueSummary,
  PendingPredictionRecord,
  PredictionLearningRecord,
  Repository,
} from "./repository.types.js";

const HORIZON_TO_MS: Record<StoredPrediction["horizon"], number> = {
  "1h": 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "5d": 5 * 24 * 60 * 60 * 1000,
};

export class InMemoryRepository implements Repository {
  private readonly sources = new Map<string, StoredSource>();
  private readonly events = new Map<string, StoredEvent>();
  private readonly predictions = new Map<string, StoredPrediction>();
  private readonly outcomes = new Map<string, PredictionOutcome>();
  private readonly postmortems = new Map<string, Postmortem>();
  private readonly lessons = new Map<string, Lesson>();
  private readonly lessonEmbeddings = new Map<string, number[]>();
  private readonly calibrationSnapshots = new Map<string, CalibrationSnapshot>();
  private readonly benchmarkReplaySnapshots = new Map<string, BenchmarkReplaySnapshot>();
  private readonly walkForwardReplaySnapshots = new Map<string, WalkForwardReplaySnapshot>();
  private readonly benchmarkTrustRefreshes = new Map<string, BenchmarkTrustRefreshRecord>();
  private readonly operationRuns = new Map<string, OperationRunRecord>();
  private readonly operationLeases = new Map<string, OperationLeaseRecord>();
  private readonly operationJobs = new Map<string, OperationJobRecord>();
  private readonly operationWorkers = new Map<string, OperationWorkerRecord>();
  private readonly operationWorkerServices = new Map<string, OperationWorkerServiceRecord>();
  private readonly operationWorkerEvents = new Map<string, OperationWorkerEventRecord>();
  private readonly operationWorkerServiceEvents = new Map<string, OperationWorkerServiceEventRecord>();
  private readonly integrationProbeStates = new Map<SystemIntegration, SystemIntegrationProbeState>();
  private readonly integrationGovernanceStates = new Map<SystemIntegration, SystemIntegrationGovernanceState>();
  private readonly evolutionScheduleConfigs = new Map<string, EvolutionScheduleConfig>();
  private readonly growthPressurePolicies = new Map<string, GrowthPressurePolicy>();
  private readonly growthPressureAlerts = new Map<string, StoredGrowthPressureAlert>();
  private readonly growthPressureActionPlans = new Map<string, GrowthPressureActionPlan>();
  private readonly historicalCaseLibrary = new Map<string, HistoricalCaseLibraryItem>();
  private readonly lineageSnapshots = new Map<string, LineageSnapshot>();
  private readonly modelVersions = new Map<string, StoredModelVersion>();
  private readonly promotionEvaluations = new Map<string, StoredPromotionEvaluation>();
  private readonly transcriptSessions = new Map<string, StoredTranscriptSession>();
  private readonly transcriptStreamBindings = new Map<string, TranscriptStreamBinding>();
  private readonly transcriptStreamBuffers = new Map<string, TranscriptStreamBuffer>();
  private readonly transcriptChunks = new Map<string, StoredTranscriptChunk[]>();
  private readonly transcriptAnalyses = new Map<string, TranscriptSessionAnalysis[]>();

  private bindingKey(provider: TranscriptStreamBinding["provider"], externalStreamKey: string) {
    return `${provider}::${externalStreamKey}`;
  }

  private operationLeaseKey(operationName: string, scopeKey: string) {
    return `${operationName}::${scopeKey}`;
  }

  async createSource(input: CreateSourceRequest): Promise<StoredSource> {
    const source = storedSourceSchema.parse({
      ...input,
      id: randomUUID(),
      created_at: new Date().toISOString(),
    });

    this.sources.set(source.id, source);
    return source;
  }

  async getSource(id: string) {
    return this.sources.get(id) ?? null;
  }

  async getSourceByRawUri(rawUri: string) {
    for (const source of this.sources.values()) {
      if (source.raw_uri === rawUri) {
        return source;
      }
    }

    return null;
  }

  async createEvent(
    sourceId: string,
    event: Omit<StoredEvent, "id" | "source_id" | "created_at">,
  ): Promise<StoredEvent> {
    const record = storedEventSchema.parse({
      ...event,
      id: randomUUID(),
      source_id: sourceId,
      created_at: new Date().toISOString(),
    });

    this.events.set(record.id, record);
    return record;
  }

  async getEvent(id: string) {
    return this.events.get(id) ?? null;
  }

  async createPrediction(
    eventId: string,
    prediction: Omit<StoredPrediction, "id" | "event_id" | "status" | "created_at">,
  ): Promise<StoredPrediction> {
    const record = storedPredictionSchema.parse({
      ...prediction,
      id: randomUUID(),
      event_id: eventId,
      status: "pending",
      created_at: new Date().toISOString(),
    });

    this.predictions.set(record.id, record);
    return record;
  }

  async getPrediction(id: string) {
    return this.predictions.get(id) ?? null;
  }

  async updatePredictionStatus(id: string, status: StoredPrediction["status"]) {
    const prediction = this.predictions.get(id);
    if (!prediction) {
      return null;
    }

    const updated = {
      ...prediction,
      status,
    };

    this.predictions.set(id, updated);
    return updated;
  }

  async listPendingPredictionsReadyForScoring(asOf: string): Promise<PendingPredictionRecord[]> {
    const asOfTimestamp = new Date(asOf).getTime();

    return [...this.predictions.values()]
      .filter((prediction) => prediction.status === "pending")
      .filter((prediction) => {
        const matureAt = new Date(prediction.created_at).getTime() + HORIZON_TO_MS[prediction.horizon];
        return matureAt <= asOfTimestamp;
      })
      .flatMap((prediction) => {
        const event = this.events.get(prediction.event_id);
        return event ? [{ prediction, event }] : [];
      });
  }

  async listLearningRecords(options: { limit?: number } = {}): Promise<PredictionLearningRecord[]> {
    const records: PredictionLearningRecord[] = [];
    const predictions = [...this.predictions.values()]
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, options.limit === undefined ? undefined : Math.max(1, options.limit));

    for (const prediction of predictions) {
      const event = this.events.get(prediction.event_id);

      if (!event) {
        continue;
      }

      const latestLesson =
        [...this.lessons.values()]
          .filter((lesson) => lesson.prediction_id === prediction.id)
          .sort((left, right) => right.created_at.localeCompare(left.created_at))[0] ?? null;

      records.push({
        event,
        prediction,
        outcome: this.outcomes.get(prediction.id) ?? null,
        postmortem: this.postmortems.get(prediction.id) ?? null,
        lesson: latestLesson,
        lesson_embedding: latestLesson ? this.lessonEmbeddings.get(latestLesson.id) ?? null : null,
      });
    }

    return records;
  }

  async saveOutcome(outcome: PredictionOutcome) {
    this.outcomes.set(outcome.prediction_id, outcome);
    return outcome;
  }

  async getOutcomeByPredictionId(predictionId: string) {
    return this.outcomes.get(predictionId) ?? null;
  }

  async savePostmortem(postmortem: Postmortem) {
    this.postmortems.set(postmortem.prediction_id, postmortem);
    return postmortem;
  }

  async getPostmortemByPredictionId(predictionId: string) {
    return this.postmortems.get(predictionId) ?? null;
  }

  async saveLesson(lesson: Lesson, embedding?: number[] | null) {
    this.lessons.set(lesson.id, lesson);
    if (embedding?.length) {
      this.lessonEmbeddings.set(lesson.id, [...embedding]);
    }
    return lesson;
  }

  async listLessons() {
    return [...this.lessons.values()].sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  async saveModelVersion(input: CreateModelVersionRequest) {
    const record: StoredModelVersion = {
      ...input,
      created_at: new Date().toISOString(),
    };

    this.modelVersions.set(record.model_version, record);
    return record;
  }

  async getModelVersion(modelVersion: string) {
    return this.modelVersions.get(modelVersion) ?? null;
  }

  async listModelVersions() {
    return [...this.modelVersions.values()].sort((left, right) =>
      right.created_at.localeCompare(left.created_at),
    );
  }

  async createTranscriptSession(input: CreateTranscriptSessionRequest) {
    const now = new Date().toISOString();
    const session: StoredTranscriptSession = {
      ...input,
      id: randomUUID(),
      status: "active",
      created_at: now,
      updated_at: now,
    };

    this.transcriptSessions.set(session.id, session);
    return session;
  }

  async getTranscriptSession(id: string) {
    return this.transcriptSessions.get(id) ?? null;
  }

  async getTranscriptStreamBinding(
    provider: TranscriptStreamBinding["provider"],
    externalStreamKey: string,
  ) {
    return this.transcriptStreamBindings.get(this.bindingKey(provider, externalStreamKey)) ?? null;
  }

  async upsertTranscriptStreamBinding(input: {
    provider: TranscriptStreamBinding["provider"];
    external_stream_key: string;
    session_id: string;
    metadata?: Record<string, string>;
  }) {
    const key = this.bindingKey(input.provider, input.external_stream_key);
    const now = new Date().toISOString();
    const existing = this.transcriptStreamBindings.get(key);
    const binding: TranscriptStreamBinding = existing
      ? {
          ...existing,
          session_id: input.session_id,
          metadata: input.metadata ?? existing.metadata,
          updated_at: now,
        }
      : {
          id: randomUUID(),
          provider: input.provider,
          external_stream_key: input.external_stream_key,
          session_id: input.session_id,
          metadata: input.metadata ?? {},
          created_at: now,
          updated_at: now,
        };

    this.transcriptStreamBindings.set(key, binding);
    return binding;
  }

  async listTranscriptStreamBindings(limit = 20) {
    return [...this.transcriptStreamBindings.values()]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, Math.max(0, limit));
  }

  async getTranscriptStreamBuffer(
    provider: TranscriptStreamBinding["provider"],
    externalStreamKey: string,
  ) {
    return this.transcriptStreamBuffers.get(this.bindingKey(provider, externalStreamKey)) ?? null;
  }

  async upsertTranscriptStreamBuffer(input: {
    provider: TranscriptStreamBinding["provider"];
    external_stream_key: string;
    session_id: string;
    pending_text: string;
    fragment_count: number;
    first_occurred_at?: string | null;
    last_occurred_at?: string | null;
  }) {
    const key = this.bindingKey(input.provider, input.external_stream_key);
    const now = new Date().toISOString();
    const existing = this.transcriptStreamBuffers.get(key);
    const buffer: TranscriptStreamBuffer = existing
      ? {
          ...existing,
          session_id: input.session_id,
          pending_text: input.pending_text,
          fragment_count: input.fragment_count,
          first_occurred_at: input.first_occurred_at ?? existing.first_occurred_at,
          last_occurred_at: input.last_occurred_at ?? existing.last_occurred_at,
          updated_at: now,
        }
      : {
          id: randomUUID(),
          provider: input.provider,
          external_stream_key: input.external_stream_key,
          session_id: input.session_id,
          pending_text: input.pending_text,
          fragment_count: input.fragment_count,
          first_occurred_at: input.first_occurred_at ?? null,
          last_occurred_at: input.last_occurred_at ?? null,
          created_at: now,
          updated_at: now,
        };

    this.transcriptStreamBuffers.set(key, buffer);
    return buffer;
  }

  async clearTranscriptStreamBuffer(
    provider: TranscriptStreamBinding["provider"],
    externalStreamKey: string,
  ) {
    this.transcriptStreamBuffers.delete(this.bindingKey(provider, externalStreamKey));
  }

  async updateTranscriptSessionStatus(id: string, status: StoredTranscriptSession["status"]) {
    const existing = this.transcriptSessions.get(id);

    if (!existing) {
      return null;
    }

    const updated: StoredTranscriptSession = {
      ...existing,
      status,
      updated_at: new Date().toISOString(),
    };

    this.transcriptSessions.set(id, updated);
    return updated;
  }

  async appendTranscriptSessionChunk(
    sessionId: string,
    input: CreateTranscriptChunkRequest,
  ): Promise<StoredTranscriptChunk> {
    const existingChunks = this.transcriptChunks.get(sessionId) ?? [];
    const chunk: StoredTranscriptChunk = {
      ...input,
      id: randomUUID(),
      session_id: sessionId,
      sequence: existingChunks.length + 1,
      created_at: new Date().toISOString(),
    };

    this.transcriptChunks.set(sessionId, [...existingChunks, chunk]);
    const session = this.transcriptSessions.get(sessionId);

    if (session) {
      this.transcriptSessions.set(sessionId, {
        ...session,
        updated_at: new Date().toISOString(),
      });
    }

    return chunk;
  }

  async listTranscriptSessionChunks(sessionId: string) {
    return [...(this.transcriptChunks.get(sessionId) ?? [])].sort(
      (left, right) => left.sequence - right.sequence,
    );
  }

  async saveTranscriptSessionAnalysis(analysis: TranscriptSessionAnalysis) {
    const existing = this.transcriptAnalyses.get(analysis.session_id) ?? [];
    this.transcriptAnalyses.set(analysis.session_id, [...existing, analysis]);

    const session = this.transcriptSessions.get(analysis.session_id);
    if (session) {
      this.transcriptSessions.set(analysis.session_id, {
        ...session,
        updated_at: new Date().toISOString(),
      });
    }

    return analysis;
  }

  async getLatestTranscriptSessionAnalysis(sessionId: string) {
    return (
      [...(this.transcriptAnalyses.get(sessionId) ?? [])].sort((left, right) =>
        right.created_at.localeCompare(left.created_at),
      )[0] ?? null
    );
  }

  async saveCalibrationSnapshot(snapshot: CalibrationSnapshot) {
    this.calibrationSnapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  async listCalibrationSnapshots(limit = 20) {
    return [...this.calibrationSnapshots.values()]
      .sort((left, right) => right.as_of.localeCompare(left.as_of))
      .slice(0, Math.max(0, limit));
  }

  async saveBenchmarkReplaySnapshot(snapshot: BenchmarkReplaySnapshot) {
    this.benchmarkReplaySnapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  async listBenchmarkReplaySnapshots(
    options: number | { limit?: number; benchmark_pack_id?: string } = 20,
  ) {
    const limit = typeof options === "number" ? options : (options.limit ?? 20);
    const benchmarkPackId = typeof options === "number" ? undefined : options.benchmark_pack_id;
    return [...this.benchmarkReplaySnapshots.values()]
      .filter((snapshot) =>
        benchmarkPackId ? snapshot.benchmark_pack_id === benchmarkPackId : true,
      )
      .sort((left, right) => right.as_of.localeCompare(left.as_of))
      .slice(0, Math.max(0, limit));
  }

  async saveWalkForwardReplaySnapshot(snapshot: WalkForwardReplaySnapshot) {
    this.walkForwardReplaySnapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  async listWalkForwardReplaySnapshots(
    options: number | { limit?: number; benchmark_pack_id?: string } = 20,
  ) {
    const limit = typeof options === "number" ? options : (options.limit ?? 20);
    const benchmarkPackId = typeof options === "number" ? undefined : options.benchmark_pack_id;
    return [...this.walkForwardReplaySnapshots.values()]
      .filter((snapshot) =>
        benchmarkPackId ? snapshot.benchmark_pack_id === benchmarkPackId : true,
      )
      .sort((left, right) => right.as_of.localeCompare(left.as_of))
      .slice(0, Math.max(0, limit));
  }

  async saveBenchmarkTrustRefresh(refresh: BenchmarkTrustRefreshRecord) {
    this.benchmarkTrustRefreshes.set(refresh.id, refresh);
    return refresh;
  }

  async listBenchmarkTrustRefreshes(
    options: number | { limit?: number; benchmark_pack_id?: string } = 20,
  ) {
    const limit = typeof options === "number" ? options : (options.limit ?? 20);
    const benchmarkPackId = typeof options === "number" ? undefined : options.benchmark_pack_id;
    return [...this.benchmarkTrustRefreshes.values()]
      .filter((refresh) =>
        benchmarkPackId ? refresh.benchmark_pack_id === benchmarkPackId : true,
      )
      .sort((left, right) => right.generated_at.localeCompare(left.generated_at))
      .slice(0, Math.max(0, limit));
  }

  async saveOperationRun(run: Omit<OperationRunRecord, "id" | "created_at">) {
    const record: OperationRunRecord = {
      ...run,
      id: randomUUID(),
      created_at: new Date().toISOString(),
    };

    this.operationRuns.set(record.id, record);
    return record;
  }

  async listOperationRuns(options: {
    limit?: number;
    operation_names?: OperationRunRecord["operation_name"][];
    statuses?: OperationRunRecord["status"][];
    triggered_by?: OperationRunRecord["triggered_by"][];
  } = {}) {
    const { limit = 20, operation_names, statuses, triggered_by } = options;
    const operationNameSet = operation_names?.length ? new Set(operation_names) : null;
    const statusSet = statuses?.length ? new Set(statuses) : null;
    const triggerSet = triggered_by?.length ? new Set(triggered_by) : null;

    return [...this.operationRuns.values()]
      .filter((run) => (operationNameSet ? operationNameSet.has(run.operation_name) : true))
      .filter((run) => (statusSet ? statusSet.has(run.status) : true))
      .filter((run) => (triggerSet ? triggerSet.has(run.triggered_by) : true))
      .sort((left, right) => {
        const finishedAtDelta = right.finished_at.localeCompare(left.finished_at);

        if (finishedAtDelta !== 0) {
          return finishedAtDelta;
        }

        const startedAtDelta = right.started_at.localeCompare(left.started_at);

        if (startedAtDelta !== 0) {
          return startedAtDelta;
        }

        return right.created_at.localeCompare(left.created_at);
      })
      .slice(0, Math.max(0, limit));
  }

  async acquireOperationLease(input: {
    operation_name: OperationLeaseRecord["operation_name"];
    scope_key: string;
    owner: string;
    acquired_at: string;
    expires_at: string;
  }) {
    const key = this.operationLeaseKey(input.operation_name, input.scope_key);
    const existing = this.operationLeases.get(key);

    if (
      existing &&
      existing.owner !== input.owner &&
      existing.expires_at.localeCompare(input.acquired_at) > 0
    ) {
      return null;
    }

    const lease: OperationLeaseRecord = {
      operation_name: input.operation_name,
      scope_key: input.scope_key,
      owner: input.owner,
      acquired_at: input.acquired_at,
      expires_at: input.expires_at,
      updated_at: input.acquired_at,
    };

    this.operationLeases.set(key, lease);
    return lease;
  }

  async renewOperationLease(input: {
    operation_name: OperationLeaseRecord["operation_name"];
    scope_key: string;
    owner: string;
    renewed_at: string;
    expires_at: string;
  }) {
    const key = this.operationLeaseKey(input.operation_name, input.scope_key);
    const existing = this.operationLeases.get(key);

    if (!existing || existing.owner !== input.owner) {
      return null;
    }

    const renewed: OperationLeaseRecord = {
      ...existing,
      expires_at: input.expires_at,
      updated_at: input.renewed_at,
    };

    this.operationLeases.set(key, renewed);
    return renewed;
  }

  async releaseOperationLease(input: {
    operation_name: OperationLeaseRecord["operation_name"];
    scope_key: string;
    owner: string;
  }) {
    const key = this.operationLeaseKey(input.operation_name, input.scope_key);
    const existing = this.operationLeases.get(key);

    if (!existing || existing.owner !== input.owner) {
      return false;
    }

    this.operationLeases.delete(key);
    return true;
  }

  async listOperationLeases(options: {
    limit?: number;
    active_only?: boolean;
    as_of?: string;
    operation_names?: OperationLeaseRecord["operation_name"][];
  } = {}) {
    const now = options.as_of ?? new Date().toISOString();
    const operationNameSet = options.operation_names?.length
      ? new Set(options.operation_names)
      : null;

    return [...this.operationLeases.values()]
      .filter((lease) => (operationNameSet ? operationNameSet.has(lease.operation_name) : true))
      .filter((lease) => (options.active_only === false ? true : lease.expires_at > now))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, Math.max(0, options.limit ?? 20));
  }

  async enqueueOperationJob(input: {
    operation_name: OperationJobRecord["operation_name"];
    triggered_by: OperationJobRecord["triggered_by"];
    payload: Record<string, JsonValue>;
    idempotency_key?: string | null;
    max_attempts: number;
    available_at: string;
  }) {
    const idempotencyKey = input.idempotency_key ?? null;

    if (idempotencyKey) {
      const existing = [...this.operationJobs.values()].find(
        (job) => job.idempotency_key === idempotencyKey,
      );

      if (existing) {
        return existing;
      }
    }

    const now = new Date().toISOString();
    const job: OperationJobRecord = {
      id: randomUUID(),
      operation_name: input.operation_name,
      status: "pending",
      triggered_by: input.triggered_by,
      payload: input.payload,
      idempotency_key: idempotencyKey,
      max_attempts: input.max_attempts,
      attempt_count: 0,
      available_at: input.available_at,
      lease_owner: null,
      lease_expires_at: null,
      started_at: null,
      finished_at: null,
      result_summary: {},
      error_message: null,
      created_at: now,
      updated_at: now,
    };

    this.operationJobs.set(job.id, job);
    return job;
  }

  async getOperationJob(id: string) {
    return this.operationJobs.get(id) ?? null;
  }

  async listOperationJobs(options: {
    limit?: number;
    operation_names?: OperationJobRecord["operation_name"][];
    statuses?: OperationJobRecord["status"][];
    updated_after?: string;
    updated_before?: string;
  } = {}) {
    const operationNameSet = options.operation_names?.length
      ? new Set(options.operation_names)
      : null;
    const statusSet = options.statuses?.length ? new Set(options.statuses) : null;

    return [...this.operationJobs.values()]
      .filter((job) => (operationNameSet ? operationNameSet.has(job.operation_name) : true))
      .filter((job) => (statusSet ? statusSet.has(job.status) : true))
      .filter((job) => (options.updated_after ? job.updated_at >= options.updated_after : true))
      .filter((job) => (options.updated_before ? job.updated_at <= options.updated_before : true))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, Math.max(0, options.limit ?? 20));
  }

  async getLatestOperationJobsByOperation(options: {
    operation_names: OperationJobRecord["operation_name"][];
  }) {
    const operationNameSet = new Set(options.operation_names);
    const latestByOperation = new Map<
      OperationJobRecord["operation_name"],
      OperationJobRecord
    >();

    for (const job of [...this.operationJobs.values()].sort((left, right) => {
      const updatedDelta = right.updated_at.localeCompare(left.updated_at);

      if (updatedDelta !== 0) {
        return updatedDelta;
      }

      return right.created_at.localeCompare(left.created_at);
    })) {
      if (!operationNameSet.has(job.operation_name)) {
        continue;
      }

      if (!latestByOperation.has(job.operation_name)) {
        latestByOperation.set(job.operation_name, job);
      }
    }

    return options.operation_names
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
    const existing = this.operationWorkers.get(input.worker_id);
    const completedCycle =
      input.last_cycle_finished_at !== undefined &&
      input.last_cycle_finished_at !== null &&
      input.last_cycle_finished_at !== existing?.last_cycle_finished_at;

    const record: OperationWorkerRecord = {
      worker_id: input.worker_id,
      lifecycle_state: input.lifecycle_state,
      supported_operations: input.supported_operations ?? existing?.supported_operations ?? [],
      poll_interval_ms: input.poll_interval_ms ?? existing?.poll_interval_ms ?? null,
      idle_backoff_ms: input.idle_backoff_ms ?? existing?.idle_backoff_ms ?? null,
      started_at: input.started_at ?? existing?.started_at ?? input.heartbeat_at,
      last_heartbeat_at: input.heartbeat_at,
      last_cycle_started_at: input.last_cycle_started_at ?? existing?.last_cycle_started_at ?? null,
      last_cycle_finished_at:
        input.last_cycle_finished_at ?? existing?.last_cycle_finished_at ?? null,
      last_cycle_processed: input.last_cycle_processed ?? existing?.last_cycle_processed ?? null,
      last_cycle_completed:
        input.last_cycle_completed ?? existing?.last_cycle_completed ?? null,
      last_cycle_failed: input.last_cycle_failed ?? existing?.last_cycle_failed ?? null,
      last_cycle_retried: input.last_cycle_retried ?? existing?.last_cycle_retried ?? null,
      last_cycle_abandoned:
        input.last_cycle_abandoned ?? existing?.last_cycle_abandoned ?? null,
      total_cycles: (existing?.total_cycles ?? 0) + (completedCycle ? 1 : 0),
      total_processed: (existing?.total_processed ?? 0) + (completedCycle ? (input.last_cycle_processed ?? 0) : 0),
      total_completed: (existing?.total_completed ?? 0) + (completedCycle ? (input.last_cycle_completed ?? 0) : 0),
      total_failed: (existing?.total_failed ?? 0) + (completedCycle ? (input.last_cycle_failed ?? 0) : 0),
      total_retried: (existing?.total_retried ?? 0) + (completedCycle ? (input.last_cycle_retried ?? 0) : 0),
      total_abandoned:
        (existing?.total_abandoned ?? 0) + (completedCycle ? (input.last_cycle_abandoned ?? 0) : 0),
      last_error_message:
        input.last_error_message === undefined
          ? existing?.last_error_message ?? null
          : input.last_error_message,
      stopped_at: input.stopped_at === undefined ? existing?.stopped_at ?? null : input.stopped_at,
      updated_at: input.heartbeat_at,
    };

    this.operationWorkers.set(record.worker_id, record);
    return record;
  }

  async listOperationWorkers(options: { limit?: number } = {}) {
    return [...this.operationWorkers.values()]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, Math.max(0, options.limit ?? 20));
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
    const existing = this.operationWorkerServices.get(input.service_id);
    const record: OperationWorkerServiceRecord = {
      service_id: input.service_id,
      worker_id: input.worker_id,
      lifecycle_state: input.lifecycle_state,
      supported_operations: input.supported_operations ?? existing?.supported_operations ?? [],
      supervisor_pid:
        input.supervisor_pid === undefined ? existing?.supervisor_pid ?? null : input.supervisor_pid,
      supervisor_host:
        input.supervisor_host === undefined
          ? existing?.supervisor_host ?? null
          : input.supervisor_host,
      supervisor_instance_id:
        input.supervisor_instance_id === undefined
          ? existing?.supervisor_instance_id ?? null
          : input.supervisor_instance_id,
      invocation_mode:
        input.invocation_mode === undefined
          ? existing?.invocation_mode ?? null
          : input.invocation_mode,
      supervisor_backoff_ms: input.supervisor_backoff_ms,
      success_window_ms: input.success_window_ms,
      heartbeat_interval_ms: input.heartbeat_interval_ms,
      max_restarts: input.max_restarts,
      restart_count: input.restart_count ?? existing?.restart_count ?? 0,
      restart_streak: input.restart_streak ?? existing?.restart_streak ?? 0,
      current_restart_backoff_ms:
        input.current_restart_backoff_ms === undefined
          ? existing?.current_restart_backoff_ms ?? null
          : input.current_restart_backoff_ms,
      started_at: input.started_at ?? existing?.started_at ?? input.heartbeat_at,
      last_heartbeat_at: input.heartbeat_at,
      last_loop_started_at:
        input.last_loop_started_at ?? existing?.last_loop_started_at ?? null,
      last_loop_finished_at:
        input.last_loop_finished_at ?? existing?.last_loop_finished_at ?? null,
      last_loop_runtime_ms:
        input.last_loop_runtime_ms ?? existing?.last_loop_runtime_ms ?? null,
      last_exit_code: input.last_exit_code ?? existing?.last_exit_code ?? null,
      last_exit_signal: input.last_exit_signal ?? existing?.last_exit_signal ?? null,
      last_error_message:
        input.last_error_message === undefined
          ? existing?.last_error_message ?? null
          : input.last_error_message,
      stopped_at: input.stopped_at === undefined ? existing?.stopped_at ?? null : input.stopped_at,
      updated_at: input.heartbeat_at,
    };

    this.operationWorkerServices.set(record.service_id, record);
    return record;
  }

  async getOperationWorkerService(serviceId: string) {
    return this.operationWorkerServices.get(serviceId) ?? null;
  }

  async listOperationWorkerServices(options: { limit?: number } = {}) {
    return [...this.operationWorkerServices.values()]
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, Math.max(0, options.limit ?? 20));
  }

  async saveOperationWorkerServiceEvent(
    input: Omit<OperationWorkerServiceEventRecord, "id" | "created_at">,
  ) {
    const record: OperationWorkerServiceEventRecord = {
      id: randomUUID(),
      service_id: input.service_id,
      worker_id: input.worker_id,
      event_type: input.event_type,
      occurred_at: input.occurred_at,
      lifecycle_state: input.lifecycle_state,
      scheduled_restart: input.scheduled_restart,
      restart_count: input.restart_count,
      restart_streak: input.restart_streak,
      loop_runtime_ms: input.loop_runtime_ms,
      exit_code: input.exit_code,
      exit_signal: input.exit_signal,
      error_message: input.error_message,
      metadata: input.metadata,
      created_at: new Date().toISOString(),
    };

    this.operationWorkerServiceEvents.set(record.id, record);
    return record;
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
    const eventTypes = options.event_types?.length ? new Set(options.event_types) : null;

    return [...this.operationWorkerServiceEvents.values()]
      .filter((event) => (options.service_id ? event.service_id === options.service_id : true))
      .filter((event) => (options.worker_id ? event.worker_id === options.worker_id : true))
      .filter((event) => (eventTypes ? eventTypes.has(event.event_type) : true))
      .filter((event) => (options.occurred_after ? event.occurred_at >= options.occurred_after : true))
      .filter((event) => (options.occurred_before ? event.occurred_at <= options.occurred_before : true))
      .sort((left, right) => {
        const byOccurredAt = right.occurred_at.localeCompare(left.occurred_at);

        if (byOccurredAt !== 0) {
          return byOccurredAt;
        }

        return right.created_at.localeCompare(left.created_at);
      })
      .slice(0, Math.max(0, options.limit ?? 50));
  }

  async getOperationWorkerServiceEventSummary(options: {
    window_started_at: string;
    as_of: string;
    bucket_hours: number;
  }) {
    const bucketMs = Math.max(1, options.bucket_hours) * 60 * 60 * 1000;
    const windowStartMs = new Date(options.window_started_at).getTime();
    const buckets = new Map<number, OperationWorkerServiceEventSummaryBucket>();

    for (const event of this.operationWorkerServiceEvents.values()) {
      if (event.occurred_at < options.window_started_at || event.occurred_at > options.as_of) {
        continue;
      }

      const bucketIndex = Math.floor(
        (new Date(event.occurred_at).getTime() - windowStartMs) / bucketMs,
      );
      const bucket =
        buckets.get(bucketIndex) ??
        {
          bucket_started_at: new Date(windowStartMs + bucketIndex * bucketMs).toISOString(),
          bucket_finished_at: new Date(windowStartMs + (bucketIndex + 1) * bucketMs).toISOString(),
          started: 0,
          ownership_conflicts: 0,
          loop_exits: 0,
          scheduled_restarts: 0,
          stopped: 0,
          failed: 0,
        };

      if (event.event_type === "started") {
        bucket.started += 1;
      } else if (event.event_type === "ownership_conflict") {
        bucket.ownership_conflicts += 1;
      } else if (event.event_type === "loop_exit") {
        bucket.loop_exits += 1;
        if (event.scheduled_restart) {
          bucket.scheduled_restarts += 1;
        }
      } else if (event.event_type === "stopped") {
        bucket.stopped += 1;
      } else if (event.event_type === "failed") {
        bucket.failed += 1;
      }

      buckets.set(bucketIndex, bucket);
    }

    return [...buckets.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, bucket]) => bucket);
  }

  async saveOperationWorkerEvent(
    input: Omit<OperationWorkerEventRecord, "id" | "created_at">,
  ) {
    const record: OperationWorkerEventRecord = {
      id: randomUUID(),
      worker_id: input.worker_id,
      event_type: input.event_type,
      occurred_at: input.occurred_at,
      lifecycle_state: input.lifecycle_state,
      cycle_processed: input.cycle_processed,
      cycle_completed: input.cycle_completed,
      cycle_failed: input.cycle_failed,
      cycle_retried: input.cycle_retried,
      cycle_abandoned: input.cycle_abandoned,
      error_message: input.error_message,
      metadata: input.metadata,
      created_at: new Date().toISOString(),
    };

    this.operationWorkerEvents.set(record.id, record);
    return record;
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
    const eventTypes = options.event_types?.length ? new Set(options.event_types) : null;

    return [...this.operationWorkerEvents.values()]
      .filter((event) => (options.worker_id ? event.worker_id === options.worker_id : true))
      .filter((event) => (eventTypes ? eventTypes.has(event.event_type) : true))
      .filter((event) => (options.occurred_after ? event.occurred_at >= options.occurred_after : true))
      .filter((event) => (options.occurred_before ? event.occurred_at <= options.occurred_before : true))
      .sort((left, right) => {
        const byOccurredAt = right.occurred_at.localeCompare(left.occurred_at);

        if (byOccurredAt !== 0) {
          return byOccurredAt;
        }

        return right.created_at.localeCompare(left.created_at);
      })
      .slice(0, Math.max(0, options.limit ?? 50));
  }

  async getOperationWorkerEventSummary(options: {
    window_started_at: string;
    as_of: string;
    bucket_hours: number;
  }) {
    const bucketMs = Math.max(1, options.bucket_hours) * 60 * 60 * 1000;
    const windowStartMs = new Date(options.window_started_at).getTime();
    const buckets = new Map<number, OperationWorkerEventSummaryBucket>();

    for (const event of this.operationWorkerEvents.values()) {
      if (event.occurred_at < options.window_started_at || event.occurred_at > options.as_of) {
        continue;
      }

      const bucketIndex = Math.floor((new Date(event.occurred_at).getTime() - windowStartMs) / bucketMs);
      const bucket =
        buckets.get(bucketIndex) ??
        {
          bucket_started_at: new Date(windowStartMs + bucketIndex * bucketMs).toISOString(),
          bucket_finished_at: new Date(windowStartMs + (bucketIndex + 1) * bucketMs).toISOString(),
          started: 0,
          stopped: 0,
          error_stops: 0,
          cycles: 0,
          processed: 0,
          completed: 0,
          failed: 0,
          retried: 0,
          abandoned: 0,
        };

      if (event.event_type === "started") {
        bucket.started += 1;
      } else if (event.event_type === "stopped") {
        bucket.stopped += 1;

        if (event.error_message) {
          bucket.error_stops += 1;
        }
      } else {
        bucket.cycles += 1;
        bucket.processed += event.cycle_processed ?? 0;
        bucket.completed += event.cycle_completed ?? 0;
        bucket.failed += event.cycle_failed ?? 0;
        bucket.retried += event.cycle_retried ?? 0;
        bucket.abandoned += event.cycle_abandoned ?? 0;
      }

      buckets.set(bucketIndex, bucket);
    }

    return [...buckets.entries()]
      .sort((left, right) => left[0] - right[0])
      .map(([, bucket]) => bucket);
  }

  async getOperationIntegrationTrendSummary(options: {
    window_started_at: string;
    as_of: string;
    bucket_hours: number;
    operation_names?: OperationIntegrationQueueSummary["operation_name"][];
  }) {
    const bucketMs = Math.max(1, options.bucket_hours) * 60 * 60 * 1000;
    const windowStartMs = new Date(options.window_started_at).getTime();
    const operationSet = options.operation_names?.length ? new Set(options.operation_names) : null;
    const buckets = new Map<string, OperationIntegrationTrendSummaryBucket>();

    for (const job of this.operationJobs.values()) {
      if (
        (job.operation_name !== "feed_pull" && job.operation_name !== "transcript_pull") ||
        (operationSet ? !operationSet.has(job.operation_name) : false) ||
        job.updated_at < options.window_started_at ||
        job.updated_at > options.as_of
      ) {
        continue;
      }

      const bucketIndex = Math.floor((new Date(job.updated_at).getTime() - windowStartMs) / bucketMs);
      const key = `${job.operation_name}:${bucketIndex}`;
      const bucket =
        buckets.get(key) ??
        {
          operation_name: job.operation_name,
          bucket_started_at: new Date(windowStartMs + bucketIndex * bucketMs).toISOString(),
          bucket_finished_at: new Date(windowStartMs + (bucketIndex + 1) * bucketMs).toISOString(),
          completed: 0,
          failed: 0,
          retry_scheduled: 0,
          non_retryable_failures: 0,
          stale_recovered: 0,
        };

      if (job.status === "completed") {
        bucket.completed += 1;
      }

      if (job.status === "failed") {
        bucket.failed += 1;
      }

      if (job.status === "pending" && job.attempt_count > 0) {
        bucket.retry_scheduled += 1;
      }

      if (job.status === "failed" && job.result_summary.retryable === false) {
        bucket.non_retryable_failures += 1;
      }

      if (
        job.status === "failed" &&
        typeof job.error_message === "string" &&
        job.error_message.includes("lease expired")
      ) {
        bucket.stale_recovered += 1;
      }

      buckets.set(key, bucket);
    }

    return [...buckets.values()].sort((left, right) => {
      const byBucket = left.bucket_started_at.localeCompare(right.bucket_started_at);

      if (byBucket !== 0) {
        return byBucket;
      }

      return left.operation_name.localeCompare(right.operation_name);
    });
  }

  async getOperationQueueSummary(options: { as_of?: string } = {}): Promise<OperationQueueSummary> {
    const asOf = options.as_of ?? new Date().toISOString();
    const jobs = [...this.operationJobs.values()];
    const pendingJobs = jobs.filter((job) => job.status === "pending");
    const runningJobs = jobs.filter((job) => job.status === "running");

    return {
      counts: {
        pending: pendingJobs.length,
        running: runningJobs.length,
        completed: jobs.filter((job) => job.status === "completed").length,
        failed: jobs.filter((job) => job.status === "failed").length,
        retry_scheduled: pendingJobs.filter((job) => job.attempt_count > 0).length,
        stale_running: runningJobs.filter(
          (job) => job.lease_expires_at !== null && job.lease_expires_at <= asOf,
        ).length,
      },
      oldest_pending_at:
        pendingJobs.sort((left, right) => left.available_at.localeCompare(right.available_at))[0]
          ?.available_at ?? null,
      longest_running_started_at:
        runningJobs
          .filter((job) => job.started_at !== null)
          .sort((left, right) => left.started_at!.localeCompare(right.started_at!))[0]
          ?.started_at ?? null,
    };
  }

  async getOperationIntegrationQueueSummary(
    options: { as_of?: string } = {},
  ): Promise<OperationIntegrationQueueSummary[]> {
    const asOf = options.as_of ?? new Date().toISOString();
    const operations: OperationIntegrationQueueSummary["operation_name"][] = [
      "feed_pull",
      "transcript_pull",
    ];
    const jobs = [...this.operationJobs.values()];

    return operations.map((operation_name) => {
      const scopedJobs = jobs.filter((job) => job.operation_name === operation_name);
      const incidentJobs = scopedJobs.filter((job) => job.error_message !== null);

      return {
        operation_name,
        counts: {
          total: scopedJobs.length,
          pending: scopedJobs.filter((job) => job.status === "pending").length,
          running: scopedJobs.filter((job) => job.status === "running").length,
          completed: scopedJobs.filter((job) => job.status === "completed").length,
          failed: scopedJobs.filter((job) => job.status === "failed").length,
          retry_scheduled: scopedJobs.filter(
            (job) => job.status === "pending" && job.attempt_count > 0,
          ).length,
          stale_running: scopedJobs.filter(
            (job) =>
              job.status === "running" &&
              job.lease_expires_at !== null &&
              job.lease_expires_at <= asOf,
          ).length,
          retryable_failures: incidentJobs.filter(
            (job) => job.result_summary.retryable === true,
          ).length,
          non_retryable_failures: incidentJobs.filter(
            (job) => job.result_summary.retryable !== true,
          ).length,
          stale_recovered: scopedJobs.filter(
            (job) =>
              job.status === "failed" &&
              typeof job.error_message === "string" &&
              job.error_message.includes("lease expired"),
          ).length,
        },
        latest_job_at:
          scopedJobs
            .slice()
            .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0]
            ?.updated_at ?? null,
        latest_failure_at:
          incidentJobs
            .slice()
            .sort((left, right) => right.updated_at.localeCompare(left.updated_at))[0]
            ?.updated_at ?? null,
      };
    });
  }

  async claimNextOperationJob(input: {
    worker_id: string;
    as_of: string;
    lease_expires_at: string;
    supported_operations?: OperationJobRecord["operation_name"][];
  }) {
    const supportedSet = input.supported_operations?.length
      ? new Set(input.supported_operations)
      : null;
    const next = [...this.operationJobs.values()]
      .filter((job) => (supportedSet ? supportedSet.has(job.operation_name) : true))
      .filter((job) => job.available_at <= input.as_of)
      .filter((job) => {
        if (job.status === "pending") {
          return true;
        }

        return job.status === "running" &&
          job.lease_expires_at !== null &&
          job.lease_expires_at <= input.as_of &&
          job.attempt_count < job.max_attempts;
      })
      .sort((left, right) => {
        const availableDelta = left.available_at.localeCompare(right.available_at);
        if (availableDelta !== 0) {
          return availableDelta;
        }

        return left.created_at.localeCompare(right.created_at);
      })[0];

    if (!next) {
      return null;
    }

    const claimed: OperationJobRecord = {
      ...next,
      status: "running",
      attempt_count: next.attempt_count + 1,
      lease_owner: input.worker_id,
      lease_expires_at: input.lease_expires_at,
      started_at: input.as_of,
      updated_at: input.as_of,
      error_message: null,
    };

    this.operationJobs.set(claimed.id, claimed);
    return claimed;
  }

  async abandonStaleOperationJobs(input: {
    as_of: string;
    supported_operations?: OperationJobRecord["operation_name"][];
    limit?: number;
    error_message?: string;
  }) {
    const supportedSet = input.supported_operations?.length
      ? new Set(input.supported_operations)
      : null;
    const errorMessage =
      input.error_message ?? "Operation job lease expired after exhausting retry attempts.";
    const staleJobs = [...this.operationJobs.values()]
      .filter((job) => (supportedSet ? supportedSet.has(job.operation_name) : true))
      .filter(
        (job) =>
          job.status === "running" &&
          job.lease_expires_at !== null &&
          job.lease_expires_at <= input.as_of &&
          job.attempt_count >= job.max_attempts,
      )
      .sort((left, right) => {
        const leaseDelta = (left.lease_expires_at ?? "").localeCompare(right.lease_expires_at ?? "");
        if (leaseDelta !== 0) {
          return leaseDelta;
        }

        return left.created_at.localeCompare(right.created_at);
      })
      .slice(0, input.limit ?? Number.MAX_SAFE_INTEGER);

    const abandoned = staleJobs.map((job) => {
      const failed: OperationJobRecord = {
        ...job,
        status: "failed",
        finished_at: input.as_of,
        updated_at: input.as_of,
        lease_owner: null,
        lease_expires_at: null,
        error_message: errorMessage,
      };

      this.operationJobs.set(failed.id, failed);
      return failed;
    });

    return abandoned;
  }

  async heartbeatOperationJob(input: {
    id: string;
    worker_id: string;
    heartbeat_at: string;
    lease_expires_at: string;
  }) {
    const existing = this.operationJobs.get(input.id);

    if (!existing || existing.lease_owner !== input.worker_id || existing.status !== "running") {
      return null;
    }

    const heartbeat: OperationJobRecord = {
      ...existing,
      lease_expires_at: input.lease_expires_at,
      updated_at: input.heartbeat_at,
    };

    this.operationJobs.set(heartbeat.id, heartbeat);
    return heartbeat;
  }

  async completeOperationJob(input: {
    id: string;
    worker_id: string;
    finished_at: string;
    result_summary: Record<string, string | number | boolean | null>;
  }) {
    const existing = this.operationJobs.get(input.id);

    if (!existing || existing.lease_owner !== input.worker_id || existing.status !== "running") {
      return null;
    }

    const completed: OperationJobRecord = {
      ...existing,
      status: "completed",
      finished_at: input.finished_at,
      updated_at: input.finished_at,
      lease_owner: null,
      lease_expires_at: null,
      result_summary: input.result_summary,
      error_message: null,
    };

    this.operationJobs.set(completed.id, completed);
    return completed;
  }

  async failOperationJob(input: {
    id: string;
    worker_id: string;
    finished_at: string;
    error_message: string;
    retry_at?: string | null;
    result_summary?: Record<string, string | number | boolean | null>;
  }) {
    const existing = this.operationJobs.get(input.id);

    if (!existing || existing.lease_owner !== input.worker_id || existing.status !== "running") {
      return null;
    }

    const shouldRetry =
      existing.attempt_count < existing.max_attempts && Boolean(input.retry_at);

    const failed: OperationJobRecord = {
      ...existing,
      status: shouldRetry ? "pending" : "failed",
      available_at: shouldRetry ? input.retry_at ?? existing.available_at : existing.available_at,
      finished_at: shouldRetry ? null : input.finished_at,
      updated_at: input.finished_at,
      lease_owner: null,
      lease_expires_at: null,
      result_summary: input.result_summary ?? existing.result_summary,
      error_message: input.error_message,
    };

    this.operationJobs.set(failed.id, failed);
    return failed;
  }

  async deferOperationJob(input: {
    id: string;
    worker_id: string;
    deferred_at: string;
    available_at: string;
    error_message: string;
    result_summary?: Record<string, string | number | boolean | null>;
  }) {
    const existing = this.operationJobs.get(input.id);

    if (!existing || existing.lease_owner !== input.worker_id || existing.status !== "running") {
      return null;
    }

    const deferred: OperationJobRecord = {
      ...existing,
      status: "pending",
      attempt_count: Math.max(0, existing.attempt_count - 1),
      available_at: input.available_at,
      lease_owner: null,
      lease_expires_at: null,
      started_at: null,
      finished_at: null,
      updated_at: input.deferred_at,
      result_summary: input.result_summary ?? existing.result_summary,
      error_message: input.error_message,
    };

    this.operationJobs.set(deferred.id, deferred);
    return deferred;
  }

  async saveSystemIntegrationGovernanceState(state: SystemIntegrationGovernanceState) {
    this.integrationGovernanceStates.set(state.integration, state);
    return state;
  }

  async listSystemIntegrationGovernanceStates(options?: {
    integrations?: SystemIntegration[];
  }) {
    const integrationSet = options?.integrations?.length ? new Set(options.integrations) : null;

    return [...this.integrationGovernanceStates.values()]
      .filter((state) => (integrationSet ? integrationSet.has(state.integration) : true))
      .sort((left, right) => left.integration.localeCompare(right.integration));
  }

  async saveSystemIntegrationProbeState(state: SystemIntegrationProbeState) {
    this.integrationProbeStates.set(state.integration, state);
    return state;
  }

  async listSystemIntegrationProbeStates(options?: {
    integrations?: SystemIntegration[];
  }) {
    const integrationSet = options?.integrations?.length ? new Set(options.integrations) : null;

    return [...this.integrationProbeStates.values()]
      .filter((state) => (integrationSet ? integrationSet.has(state.integration) : true))
      .sort((left, right) => left.integration.localeCompare(right.integration));
  }

  async getEvolutionScheduleConfig(id = "default") {
    return this.evolutionScheduleConfigs.get(id) ?? null;
  }

  async saveEvolutionScheduleConfig(config: EvolutionScheduleConfig) {
    this.evolutionScheduleConfigs.set(config.id, config);
    return config;
  }

  async getGrowthPressurePolicy(family: string) {
    return this.growthPressurePolicies.get(family) ?? null;
  }

  async listGrowthPressurePolicies() {
    return [...this.growthPressurePolicies.values()].sort((left, right) =>
      left.family.localeCompare(right.family),
    );
  }

  async saveGrowthPressurePolicy(policy: GrowthPressurePolicy) {
    this.growthPressurePolicies.set(policy.family, policy);
    return policy;
  }

  async getGrowthPressureAlert(id: string) {
    return this.growthPressureAlerts.get(id) ?? null;
  }

  async listGrowthPressureAlerts(options: {
    limit?: number;
    family?: string;
    statuses?: StoredGrowthPressureAlert["status"][];
  } = {}) {
    const { limit = 20, family, statuses } = options;

    return [...this.growthPressureAlerts.values()]
      .filter((alert) => (family ? alert.family === family : true))
      .filter((alert) => (statuses?.length ? statuses.includes(alert.status) : true))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, Math.max(0, limit));
  }

  async saveGrowthPressureAlert(alert: StoredGrowthPressureAlert) {
    this.growthPressureAlerts.set(alert.id, alert);
    return alert;
  }

  async getGrowthPressureActionPlan(id: string) {
    return this.growthPressureActionPlans.get(id) ?? null;
  }

  async listGrowthPressureActionPlans(options: {
    limit?: number;
    family?: string;
    statuses?: GrowthPressureActionPlan["status"][];
  } = {}) {
    const { limit = 20, family, statuses } = options;

    return [...this.growthPressureActionPlans.values()]
      .filter((plan) => (family ? plan.family === family : true))
      .filter((plan) => (statuses?.length ? statuses.includes(plan.status) : true))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, Math.max(0, limit));
  }

  async saveGrowthPressureActionPlan(plan: GrowthPressureActionPlan) {
    this.growthPressureActionPlans.set(plan.id, plan);
    return plan;
  }

  async getHistoricalCaseLibraryItem(caseId: string) {
    return this.historicalCaseLibrary.get(caseId) ?? null;
  }

  async countHistoricalCaseLibraryItems(options: {
    case_pack?: string;
    case_ids?: string[];
    case_qualities?: HistoricalCaseLibraryItem["labels"]["case_quality"][];
    reviewer?: string;
  } = {}) {
    const { case_pack, case_ids, case_qualities, reviewer } = options;
    const caseIdSet = case_ids?.length ? new Set(case_ids) : null;
    const caseQualitySet = case_qualities?.length ? new Set(case_qualities) : null;

    return [...this.historicalCaseLibrary.values()]
      .filter((item) => (case_pack ? item.case_pack === case_pack : true))
      .filter((item) => (caseIdSet ? caseIdSet.has(item.case_id) : true))
      .filter((item) => (caseQualitySet ? caseQualitySet.has(item.labels.case_quality) : true))
      .filter((item) => (reviewer ? item.review.reviewer === reviewer : true)).length;
  }

  async listHistoricalCaseLibraryItems(options: {
    limit?: number;
    case_pack?: string;
    case_ids?: string[];
    case_qualities?: HistoricalCaseLibraryItem["labels"]["case_quality"][];
    reviewer?: string;
  } = {}) {
    const { limit = 200, case_pack, case_ids, case_qualities, reviewer } = options;
    const caseIdSet = case_ids?.length ? new Set(case_ids) : null;
    const caseQualitySet = case_qualities?.length ? new Set(case_qualities) : null;

    return [...this.historicalCaseLibrary.values()]
      .filter((item) => (case_pack ? item.case_pack === case_pack : true))
      .filter((item) => (caseIdSet ? caseIdSet.has(item.case_id) : true))
      .filter((item) => (caseQualitySet ? caseQualitySet.has(item.labels.case_quality) : true))
      .filter((item) => (reviewer ? item.review.reviewer === reviewer : true))
      .sort((left, right) => right.updated_at.localeCompare(left.updated_at))
      .slice(0, Math.max(0, limit));
  }

  async saveHistoricalCaseLibraryItem(item: HistoricalCaseLibraryItem) {
    this.historicalCaseLibrary.set(item.case_id, item);
    return item;
  }

  async saveLineageSnapshot(snapshot: LineageSnapshot) {
    this.lineageSnapshots.set(snapshot.id, snapshot);
    return snapshot;
  }

  async listLineageSnapshots(limit = 20) {
    return [...this.lineageSnapshots.values()]
      .sort((left, right) => right.as_of.localeCompare(left.as_of))
      .slice(0, Math.max(0, limit));
  }

  async savePromotionEvaluation(
    evaluation: Omit<StoredPromotionEvaluation, "id" | "created_at">,
  ) {
    const record: StoredPromotionEvaluation = {
      ...evaluation,
      id: randomUUID(),
      created_at: new Date().toISOString(),
    };

    this.promotionEvaluations.set(record.id, record);
    return record;
  }

  async listPromotionEvaluations(
    options: number | { limit?: number; benchmark_pack_id?: string; has_walk_forward?: boolean } = 20,
  ) {
    const limit = typeof options === "number" ? options : (options.limit ?? 20);
    const benchmarkPackId = typeof options === "number" ? undefined : options.benchmark_pack_id;
    const hasWalkForward = typeof options === "number" ? undefined : options.has_walk_forward;
    return [...this.promotionEvaluations.values()]
      .filter((evaluation) =>
        benchmarkPackId
          ? evaluation.walk_forward?.benchmark_pack_id === benchmarkPackId
          : true,
      )
      .filter((evaluation) =>
        hasWalkForward === undefined ? true : hasWalkForward ? evaluation.walk_forward !== null : evaluation.walk_forward === null,
      )
      .sort((left, right) => right.created_at.localeCompare(left.created_at))
      .slice(0, Math.max(0, limit));
  }

  async reset() {
    this.sources.clear();
    this.events.clear();
    this.predictions.clear();
    this.outcomes.clear();
    this.postmortems.clear();
    this.lessons.clear();
    this.lessonEmbeddings.clear();
    this.calibrationSnapshots.clear();
    this.benchmarkReplaySnapshots.clear();
    this.walkForwardReplaySnapshots.clear();
    this.benchmarkTrustRefreshes.clear();
    this.operationRuns.clear();
    this.operationLeases.clear();
    this.operationJobs.clear();
    this.operationWorkers.clear();
    this.operationWorkerServices.clear();
    this.operationWorkerEvents.clear();
    this.operationWorkerServiceEvents.clear();
    this.evolutionScheduleConfigs.clear();
    this.growthPressurePolicies.clear();
    this.growthPressureAlerts.clear();
    this.growthPressureActionPlans.clear();
    this.historicalCaseLibrary.clear();
    this.lineageSnapshots.clear();
    this.modelVersions.clear();
    this.promotionEvaluations.clear();
    this.transcriptSessions.clear();
    this.transcriptStreamBindings.clear();
    this.transcriptStreamBuffers.clear();
    this.transcriptChunks.clear();
    this.transcriptAnalyses.clear();
  }
}
