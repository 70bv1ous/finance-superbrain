import {
  createTranscriptSessionRequestSchema,
  liveTranscriptWebhookResponseSchema,
  type CreateTranscriptChunkRequest,
  type CreateTranscriptSessionRequest,
  type LiveTranscriptProvider,
  type LiveTranscriptWebhookResponse,
  type StoredTranscriptSession,
} from "@finance-superbrain/schemas";

import { appendChunkAndAnalyze } from "./liveTranscriptSessions.js";
import type { AppServices } from "./services.js";

type NormalizedLiveWebhook = {
  provider: LiveTranscriptProvider;
  session_id?: string;
  external_stream_key?: string;
  create_session?: CreateTranscriptSessionRequest;
  chunk: CreateTranscriptChunkRequest | null;
  is_final: boolean;
  close_session: boolean;
  binding_metadata: Record<string, string>;
};

const HORIZONS = new Set<CreateTranscriptSessionRequest["horizons"][number]>(["1h", "1d", "5d"]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const asString = (value: unknown) => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
};

const asBoolean = (value: unknown) => {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value === "true") {
      return true;
    }

    if (value === "false") {
      return false;
    }
  }

  return undefined;
};

const asNumber = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
};

const asStringRecord = (value: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(value)
      .map(([key, entryValue]) => [key, asString(entryValue)])
      .filter((entry): entry is [string, string] => Boolean(entry[1])),
  );

const getNested = (value: unknown, path: Array<string | number>): unknown => {
  let current = value;

  for (const key of path) {
    if (typeof key === "number") {
      if (!Array.isArray(current) || key >= current.length) {
        return undefined;
      }

      current = current[key];
      continue;
    }

    if (!isRecord(current) || !(key in current)) {
      return undefined;
    }

    current = current[key];
  }

  return current;
};

const normalizeIsoDate = (value: unknown) => {
  const candidate = asString(value);

  if (!candidate) {
    return undefined;
  }

  const parsed = new Date(candidate);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
};

const parseSourceType = (value: unknown): CreateTranscriptSessionRequest["source_type"] => {
  const candidate = asString(value);

  if (candidate === "speech" || candidate === "earnings" || candidate === "filing") {
    return candidate;
  }

  return "transcript";
};

const parseHorizons = (value: unknown): CreateTranscriptSessionRequest["horizons"] | undefined => {
  const candidates = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  const horizons = candidates
    .flatMap((entry) => {
      const candidate = asString(entry);

      if (!candidate || !HORIZONS.has(candidate as CreateTranscriptSessionRequest["horizons"][number])) {
        return [];
      }

      return [candidate as CreateTranscriptSessionRequest["horizons"][number]];
    });

  return horizons.length ? horizons : undefined;
};

const parseRollingWindowChars = (value: unknown) => {
  const parsed = asNumber(value);

  if (!parsed) {
    return undefined;
  }

  return Math.max(1000, Math.min(20000, Math.round(parsed)));
};

const buildSessionSeed = (
  provider: LiveTranscriptProvider,
  record: Record<string, unknown>,
  defaults: {
    source_type: CreateTranscriptSessionRequest["source_type"];
    title: string;
    publisher: string;
  },
) =>
  createTranscriptSessionRequestSchema.parse({
    source_type: parseSourceType(record.source_type ?? getNested(record, ["metadata", "source_type"])),
    title:
      asString(record.title) ??
      asString(getNested(record, ["metadata", "title"])) ??
      defaults.title,
    speaker:
      asString(record.speaker) ?? asString(getNested(record, ["metadata", "speaker"])) ?? undefined,
    publisher:
      asString(record.publisher) ??
      asString(getNested(record, ["metadata", "publisher"])) ??
      defaults.publisher,
    raw_uri:
      asString(record.raw_uri) ??
      asString(record.source_uri) ??
      asString(getNested(record, ["metadata", "raw_uri"])) ??
      asString(getNested(record, ["metadata", "source_uri"])) ??
      undefined,
    model_version:
      asString(record.model_version) ??
      asString(getNested(record, ["metadata", "model_version"])) ??
      `${provider}-live-v1`,
    horizons: parseHorizons(record.horizons ?? getNested(record, ["metadata", "horizons"])) ?? ["1d"],
    rolling_window_chars:
      parseRollingWindowChars(
        record.rolling_window_chars ?? getNested(record, ["metadata", "rolling_window_chars"]),
      ) ?? 8000,
  });

const normalizeGenericWebhook = (payload: unknown): NormalizedLiveWebhook => {
  if (!isRecord(payload)) {
    throw new Error("Generic live webhook payload must be a JSON object.");
  }

  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  const sessionId = asString(payload.session_id);
  const externalStreamKey =
    asString(payload.stream_key) ??
    asString(payload.stream_id) ??
    asString(payload.conversation_id) ??
    asString(metadata.stream_key) ??
    asString(metadata.stream_id);
  const text =
    asString(payload.text) ?? asString(payload.transcript) ?? asString(payload.chunk) ?? "";
  const occurredAt = normalizeIsoDate(payload.occurred_at);
  const partialFlag = asBoolean(payload.partial);
  const isFinal =
    asBoolean(payload.is_final) ??
    asBoolean(payload.final) ??
    (partialFlag === undefined ? true : !partialFlag);
  const closeSession =
    asBoolean(payload.close_session) ?? asBoolean(payload.end_of_stream) ?? false;

  if (!sessionId && !externalStreamKey) {
    throw new Error("Generic live webhook requires session_id or stream_key.");
  }

  return {
    provider: "generic",
    session_id: sessionId,
    external_stream_key: externalStreamKey,
    create_session: sessionId
      ? undefined
      : buildSessionSeed("generic", payload, {
          source_type: "transcript",
          title: `Live stream ${externalStreamKey ?? "session"}`,
          publisher: "Generic live provider",
        }),
    chunk: text ? { text, occurred_at: occurredAt } : null,
    is_final: isFinal,
    close_session: closeSession,
    binding_metadata: {
      ...asStringRecord(metadata),
      provider_event: asString(payload.event_type) ?? "generic",
    },
  };
};

const normalizeDeepgramWebhook = (payload: unknown): NormalizedLiveWebhook => {
  if (!isRecord(payload)) {
    throw new Error("Deepgram live webhook payload must be a JSON object.");
  }

  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  const externalStreamKey =
    asString(metadata.request_id) ??
    asString(metadata.transaction_key) ??
    asString(metadata.stream_key) ??
    asString(payload.request_id) ??
    asString(payload.stream_key);
  const text = asString(getNested(payload, ["channel", "alternatives", 0, "transcript"])) ?? "";
  const isFinal = asBoolean(payload.is_final) ?? asBoolean(payload.speech_final) ?? false;
  const closeSession =
    asBoolean(payload.close_session) ??
    (asString(payload.type) === "UtteranceEnd" && !text);

  if (!externalStreamKey) {
    throw new Error("Deepgram live webhook requires a request_id, transaction_key, or stream_key.");
  }

  return {
    provider: "deepgram",
    external_stream_key: externalStreamKey,
    create_session: buildSessionSeed("deepgram", payload, {
      source_type: "speech",
      title: `Deepgram live stream ${externalStreamKey}`,
      publisher: "Deepgram",
    }),
    chunk: text ? { text, occurred_at: normalizeIsoDate(payload.created_at ?? payload.start) } : null,
    is_final: isFinal,
    close_session: closeSession,
    binding_metadata: {
      ...asStringRecord(metadata),
      provider_event: asString(payload.type) ?? "Results",
    },
  };
};

const normalizeAssemblyAiWebhook = (payload: unknown): NormalizedLiveWebhook => {
  if (!isRecord(payload)) {
    throw new Error("AssemblyAI live webhook payload must be a JSON object.");
  }

  const metadata = isRecord(payload.metadata) ? payload.metadata : {};
  const externalStreamKey =
    asString(payload.session_id) ??
    asString(payload.realtime_session_id) ??
    asString(metadata.stream_key) ??
    asString(metadata.session_id);
  const messageType = asString(payload.message_type) ?? asString(payload.type) ?? "FinalTranscript";
  const text = asString(payload.text) ?? asString(payload.transcript) ?? "";
  const isFinal =
    messageType === "FinalTranscript"
      ? true
      : messageType === "PartialTranscript"
        ? false
        : asBoolean(payload.is_final) ?? true;
  const closeSession =
    asBoolean(payload.close_session) ?? messageType === "SessionTerminated";

  if (!externalStreamKey) {
    throw new Error("AssemblyAI live webhook requires session_id or realtime_session_id.");
  }

  return {
    provider: "assemblyai",
    external_stream_key: externalStreamKey,
    create_session: buildSessionSeed("assemblyai", payload, {
      source_type: "transcript",
      title: `AssemblyAI live stream ${externalStreamKey}`,
      publisher: "AssemblyAI",
    }),
    chunk: text ? { text, occurred_at: normalizeIsoDate(payload.created_at ?? payload.audio_start) } : null,
    is_final: isFinal,
    close_session: closeSession,
    binding_metadata: {
      ...asStringRecord(metadata),
      provider_event: messageType,
    },
  };
};

const normalizeLiveWebhook = (
  provider: LiveTranscriptProvider,
  payload: unknown,
): NormalizedLiveWebhook => {
  if (provider === "deepgram") {
    return normalizeDeepgramWebhook(payload);
  }

  if (provider === "assemblyai") {
    return normalizeAssemblyAiWebhook(payload);
  }

  return normalizeGenericWebhook(payload);
};

const resolveBoundSession = async (
  services: AppServices,
  normalized: NormalizedLiveWebhook,
): Promise<{
  session: StoredTranscriptSession;
  binding_status: LiveTranscriptWebhookResponse["binding_status"];
}> => {
  if (normalized.session_id) {
    const session = await services.repository.getTranscriptSession(normalized.session_id);

    if (!session) {
      throw new Error("Transcript session not found for provided session_id.");
    }

    return {
      session,
      binding_status: "direct",
    };
  }

  const streamKey = normalized.external_stream_key;

  if (!streamKey) {
    throw new Error("A live transcript webhook stream key is required.");
  }

  const existingBinding = await services.repository.getTranscriptStreamBinding(
    normalized.provider,
    streamKey,
  );

  if (existingBinding) {
    const session = await services.repository.getTranscriptSession(existingBinding.session_id);

    if (session) {
      await services.repository.upsertTranscriptStreamBinding({
        provider: normalized.provider,
        external_stream_key: streamKey,
        session_id: session.id,
        metadata: normalized.binding_metadata,
      });

      return {
        session,
        binding_status: "reused",
      };
    }
  }

  if (!normalized.create_session) {
    throw new Error("A new live transcript session could not be created from this webhook payload.");
  }

  const session = await services.repository.createTranscriptSession(normalized.create_session);
  await services.repository.upsertTranscriptStreamBinding({
    provider: normalized.provider,
    external_stream_key: streamKey,
    session_id: session.id,
    metadata: normalized.binding_metadata,
  });

  return {
    session,
    binding_status: "created",
  };
};

const getBufferControlSettings = () => ({
  min_chars: Math.max(40, Number(process.env.LIVE_INGEST_BUFFER_MIN_CHARS ?? 120)),
  max_fragments: Math.max(1, Number(process.env.LIVE_INGEST_BUFFER_MAX_FRAGMENTS ?? 3)),
  max_age_ms: Math.max(0, Number(process.env.LIVE_INGEST_BUFFER_MAX_AGE_MS ?? 15000)),
});

const resolveBufferKey = (normalized: NormalizedLiveWebhook, sessionId: string) =>
  normalized.external_stream_key ?? `session:${sessionId}`;

const mergeBufferedText = (existingText: string, nextText: string) =>
  existingText.trim() ? `${existingText.trim()}\n${nextText.trim()}` : nextText.trim();

const shouldFlushBuffer = (
  pendingText: string,
  fragmentCount: number,
  bufferCreatedAt: string,
  closeSession: boolean,
) => {
  const controls = getBufferControlSettings();
  const ageMs = Date.now() - new Date(bufferCreatedAt).getTime();
  const punctuationReady =
    /[.!?]\s*$/.test(pendingText.trim()) &&
    pendingText.trim().length >= Math.max(60, Math.floor(controls.min_chars / 2));

  return (
    closeSession ||
    pendingText.length >= controls.min_chars ||
    fragmentCount >= controls.max_fragments ||
    ageMs >= controls.max_age_ms ||
    punctuationReady
  );
};

export const ingestLiveTranscriptWebhook = async (
  services: AppServices,
  provider: LiveTranscriptProvider,
  payload: unknown,
): Promise<LiveTranscriptWebhookResponse> => {
  const normalized = normalizeLiveWebhook(provider, payload);
  const resolved = await resolveBoundSession(services, normalized);
  let session = resolved.session;
  let latestAnalysis = await services.repository.getLatestTranscriptSessionAnalysis(session.id);
  let eventStatus: LiveTranscriptWebhookResponse["event_status"] = "ignored_empty";
  let chunkAppended = false;
  const bufferKey = resolveBufferKey(normalized, session.id);
  let buffer = await services.repository.getTranscriptStreamBuffer(provider, bufferKey);

  if (session.status === "closed") {
    eventStatus = "closed";
  } else if (!normalized.chunk || !normalized.chunk.text.trim()) {
    if (normalized.close_session && buffer?.pending_text.trim()) {
      latestAnalysis = await appendChunkAndAnalyze(services.repository, session, {
        text: buffer.pending_text,
        occurred_at: buffer.last_occurred_at ?? buffer.first_occurred_at ?? undefined,
      });
      await services.repository.clearTranscriptStreamBuffer(provider, bufferKey);
      buffer = null;
      chunkAppended = true;
      eventStatus = "appended";
    } else {
      eventStatus = normalized.close_session ? "closed" : "ignored_empty";
    }
  } else if (!normalized.is_final) {
    eventStatus = "ignored_partial";
  } else {
    buffer = await services.repository.upsertTranscriptStreamBuffer({
      provider,
      external_stream_key: bufferKey,
      session_id: session.id,
      pending_text: mergeBufferedText(buffer?.pending_text ?? "", normalized.chunk.text),
      fragment_count: (buffer?.fragment_count ?? 0) + 1,
      first_occurred_at:
        buffer?.first_occurred_at ?? normalized.chunk.occurred_at ?? null,
      last_occurred_at:
        normalized.chunk.occurred_at ?? buffer?.last_occurred_at ?? null,
    });

    if (shouldFlushBuffer(
      buffer.pending_text,
      buffer.fragment_count,
      buffer.created_at,
      normalized.close_session,
    )) {
      latestAnalysis = await appendChunkAndAnalyze(services.repository, session, {
        text: buffer.pending_text,
        occurred_at: buffer.last_occurred_at ?? buffer.first_occurred_at ?? undefined,
      });
      await services.repository.clearTranscriptStreamBuffer(provider, bufferKey);
      buffer = null;
      chunkAppended = true;
      eventStatus = "appended";
    } else {
      eventStatus = "buffered";
    }
  }

  if (normalized.close_session && session.status !== "closed") {
    session =
      (await services.repository.updateTranscriptSessionStatus(session.id, "closed")) ?? session;
  }

  return liveTranscriptWebhookResponseSchema.parse({
    provider,
    session_id: session.id,
    session_status: session.status,
    binding_status: resolved.binding_status,
    event_status: session.status === "closed" && eventStatus !== "appended" ? "closed" : eventStatus,
    chunk_appended: chunkAppended,
    buffered_chars: buffer?.pending_text.length ?? 0,
    buffered_fragments: buffer?.fragment_count ?? 0,
    latest_analysis: latestAnalysis,
  });
};
