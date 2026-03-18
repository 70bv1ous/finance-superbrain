import type {
  CreateTranscriptSessionRequest,
  TranscriptSessionAnalysis,
} from "@finance-superbrain/schemas";

type FetchLike = typeof fetch;

type StreamFormat = "ndjson" | "sse" | "plain";

type StreamChunk = {
  text: string;
  occurred_at?: string;
};

type ApiError = {
  error?: string;
  message?: string;
};

export type TranscriptStreamIngestResult = {
  session_id: string;
  processed_stream_messages: number;
  append_calls: number;
  latest_analysis: TranscriptSessionAnalysis | null;
};

export type TranscriptStreamIngestOptions = {
  api_base_url: string;
  stream_url: string;
  stream_format?: StreamFormat;
  session_id?: string;
  create_session?: CreateTranscriptSessionRequest;
  close_on_end?: boolean;
  min_chunk_chars?: number;
  fetch_impl?: FetchLike;
  on_chunk_processed?: (payload: {
    session_id: string;
    chunk: StreamChunk;
    analysis: TranscriptSessionAnalysis;
  }) => void | Promise<void>;
};

const textDecoder = new TextDecoder();

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const joinUrl = (base: string, path: string) => `${trimTrailingSlash(base)}${path}`;

const parseMaybeJson = (input: string) => {
  try {
    return JSON.parse(input) as unknown;
  } catch {
    return null;
  }
};

const normalizeChunk = (payload: unknown): StreamChunk | null => {
  if (typeof payload === "string") {
    const text = payload.trim();
    return text ? { text } : null;
  }

  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const text = typeof record.text === "string" ? record.text.trim() : "";

    if (!text) {
      return null;
    }

    return {
      text,
      occurred_at: typeof record.occurred_at === "string" ? record.occurred_at : undefined,
    };
  }

  return null;
};

const parseNdjsonLine = (line: string) => normalizeChunk(parseMaybeJson(line) ?? line);

const parsePlainLine = (line: string) => normalizeChunk(line);

const parseSseEvent = (block: string) => {
  const dataLines = block
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim());

  if (!dataLines.length) {
    return null;
  }

  const payload = dataLines.join("\n");
  return normalizeChunk(parseMaybeJson(payload) ?? payload);
};

const parseBuffer = (
  format: StreamFormat,
  buffer: string,
): { chunks: StreamChunk[]; remainder: string } => {
  if (format === "sse") {
    const normalized = buffer.replace(/\r\n/g, "\n");
    const parts = normalized.split("\n\n");
    const remainder = parts.pop() ?? "";
    const chunks = parts
      .map((part) => parseSseEvent(part))
      .filter((item): item is StreamChunk => item !== null);

    return { chunks, remainder };
  }

  const lines = buffer.split(/\r?\n/);
  const remainder = lines.pop() ?? "";
  const parser = format === "ndjson" ? parseNdjsonLine : parsePlainLine;
  const chunks = lines
    .map((line) => parser(line))
    .filter((item): item is StreamChunk => item !== null);

  return { chunks, remainder };
};

const flushRemainder = (format: StreamFormat, buffer: string) => {
  if (!buffer.trim()) {
    return [];
  }

  if (format === "sse") {
    const parsed = parseSseEvent(buffer);
    return parsed ? [parsed] : [];
  }

  const parser = format === "ndjson" ? parseNdjsonLine : parsePlainLine;
  const parsed = parser(buffer);
  return parsed ? [parsed] : [];
};

const readStreamChunks = async function* (
  response: Response,
  format: StreamFormat,
): AsyncGenerator<StreamChunk> {
  if (!response.body) {
    throw new Error("Transcript stream response has no body.");
  }

  const reader = response.body.getReader();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();

    if (done) {
      break;
    }

    buffer += textDecoder.decode(value, { stream: true });
    const parsed = parseBuffer(format, buffer);
    buffer = parsed.remainder;

    for (const chunk of parsed.chunks) {
      yield chunk;
    }
  }

  buffer += textDecoder.decode();

  for (const chunk of flushRemainder(format, buffer)) {
    yield chunk;
  }
};

const ensureSession = async (
  options: TranscriptStreamIngestOptions,
  fetchImpl: FetchLike,
) => {
  if (options.session_id) {
    return options.session_id;
  }

  if (!options.create_session) {
    throw new Error("Provide either session_id or create_session for transcript stream ingest.");
  }

  const response = await fetchImpl(joinUrl(options.api_base_url, "/v1/transcript-sessions"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify(options.create_session),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiError | null;
    throw new Error(
      payload?.message ?? `Failed to create transcript session: ${response.status} ${response.statusText}`,
    );
  }

  const payload = (await response.json()) as { id: string };
  return payload.id;
};

const appendChunk = async (
  apiBaseUrl: string,
  sessionId: string,
  chunk: StreamChunk,
  fetchImpl: FetchLike,
) => {
  const response = await fetchImpl(
    joinUrl(apiBaseUrl, `/v1/transcript-sessions/${sessionId}/chunks`),
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(chunk),
    },
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiError | null;
    throw new Error(
      payload?.message ?? `Failed to append transcript chunk: ${response.status} ${response.statusText}`,
    );
  }

  return (await response.json()) as TranscriptSessionAnalysis;
};

const closeSession = async (apiBaseUrl: string, sessionId: string, fetchImpl: FetchLike) => {
  const response = await fetchImpl(
    joinUrl(apiBaseUrl, `/v1/transcript-sessions/${sessionId}/close`),
    {
      method: "POST",
    },
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as ApiError | null;
    throw new Error(
      payload?.message ?? `Failed to close transcript session: ${response.status} ${response.statusText}`,
    );
  }
};

export const runTranscriptStreamIngest = async (
  options: TranscriptStreamIngestOptions,
): Promise<TranscriptStreamIngestResult> => {
  const fetchImpl = options.fetch_impl ?? fetch;
  const streamFormat = options.stream_format ?? "ndjson";
  const minChunkChars = options.min_chunk_chars ?? 80;
  const sessionId = await ensureSession(options, fetchImpl);
  const streamResponse = await fetchImpl(options.stream_url, {
    headers: {
      Accept:
        streamFormat === "sse"
          ? "text/event-stream"
          : streamFormat === "ndjson"
            ? "application/x-ndjson, application/jsonl, application/json"
            : "text/plain",
    },
  });

  if (!streamResponse.ok) {
    throw new Error(
      `Failed to open transcript stream ${options.stream_url}: ${streamResponse.status} ${streamResponse.statusText}`,
    );
  }

  let processedChunks = 0;
  let appendCalls = 0;
  let latestAnalysis: TranscriptSessionAnalysis | null = null;
  let pendingText = "";
  let pendingOccurredAt: string | undefined;

  const flushPending = async () => {
    const text = pendingText.trim();

    if (!text) {
      pendingText = "";
      pendingOccurredAt = undefined;
      return;
    }

    const chunk: StreamChunk = {
      text,
      occurred_at: pendingOccurredAt,
    };
    latestAnalysis = await appendChunk(options.api_base_url, sessionId, chunk, fetchImpl);
    appendCalls += 1;
    pendingText = "";
    pendingOccurredAt = undefined;

    await options.on_chunk_processed?.({
      session_id: sessionId,
      chunk,
      analysis: latestAnalysis,
    });
  };

  for await (const chunk of readStreamChunks(streamResponse, streamFormat)) {
    processedChunks += 1;
    pendingText = pendingText ? `${pendingText}\n${chunk.text}` : chunk.text;
    pendingOccurredAt = chunk.occurred_at ?? pendingOccurredAt;

    const shouldFlush =
      pendingText.length >= minChunkChars || /[.!?]\s*$/.test(pendingText.trim());

    if (shouldFlush) {
      await flushPending();
    }
  }

  await flushPending();

  if (options.close_on_end) {
    await closeSession(options.api_base_url, sessionId, fetchImpl);
  }

  return {
    session_id: sessionId,
    processed_stream_messages: processedChunks,
    append_calls: appendCalls,
    latest_analysis: latestAnalysis,
  };
};
