import { transcriptPullResponseSchema, type TranscriptPullRequest } from "@finance-superbrain/schemas";

import {
  ExternalIntegrationError,
  isRetryableHttpStatus,
  parseRetryAfterSeconds,
} from "./integrationErrors.js";
import { parseFinanceEvent } from "./parseFinanceEvent.js";
import type { AppServices } from "./services.js";

type FetchLike = typeof fetch;

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const decodeEntities = (value: string) =>
  value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith("#x")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    return ENTITY_MAP[entity] ?? match;
  });

const stripTags = (value: string) =>
  decodeEntities(
    value
      .replace(/<!\[CDATA\[|\]\]>/g, "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|section|article|main|h[1-6]|tr)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim(),
  );

const extractMeta = (html: string, predicate: (name: string) => boolean) => {
  for (const match of html.matchAll(/<meta\b[^>]*(?:name|property)=["']([^"']+)["'][^>]*content=["']([^"']+)["'][^>]*>/gi)) {
    const key = (match[1] ?? "").toLowerCase();

    if (predicate(key)) {
      return decodeEntities(match[2] ?? "").trim();
    }
  }

  return null;
};

const extractTitle = (html: string) =>
  extractMeta(html, (key) => key === "og:title" || key === "twitter:title") ??
  /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1]?.trim() ??
  null;

const extractPublisher = (html: string) =>
  extractMeta(html, (key) => key === "og:site_name" || key === "application-name") ??
  extractMeta(html, (key) => key === "author" || key === "article:author") ??
  null;

const extractOccurredAt = (html: string) =>
  extractMeta(html, (key) =>
    ["article:published_time", "og:published_time", "pubdate", "timestamp"].includes(key),
  ) ??
  /<time\b[^>]*datetime=["']([^"']+)["'][^>]*>/i.exec(html)?.[1] ??
  null;

const normalizeIsoDate = (value: string | null) => {
  if (!value) {
    return null;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const selectPrimaryHtmlBlock = (html: string) =>
  /<article\b[^>]*>([\s\S]*?)<\/article>/i.exec(html)?.[1] ??
  /<main\b[^>]*>([\s\S]*?)<\/main>/i.exec(html)?.[1] ??
  /<body\b[^>]*>([\s\S]*?)<\/body>/i.exec(html)?.[1] ??
  html;

const cleanHtml = (html: string) =>
  html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(header|footer|nav|aside)\b[^>]*>[\s\S]*?<\/\1>/gi, " ");

const clampText = (value: string, maxChars: number) => {
  const trimmed = value.trim();
  return trimmed.length <= maxChars ? trimmed : `${trimmed.slice(0, maxChars - 3).trim()}...`;
};

const buildTranscriptText = (title: string | null, body: string, maxChars: number) => {
  const combined = [title, body].filter(Boolean).join("\n\n").trim();
  return clampText(combined.length >= 20 ? combined : `${combined}\n\nTranscript excerpt unavailable.`, maxChars);
};

const fetchDocumentText = async (url: string, fetchImpl: FetchLike) => {
  let response: Response;

  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "text/html, text/plain;q=0.9, application/xhtml+xml;q=0.8, */*;q=0.1",
      },
    });
  } catch (error) {
    throw new ExternalIntegrationError({
      message: `Failed to fetch transcript ${url}: ${error instanceof Error ? error.message : "Unknown network error"}`,
      integration: "transcript",
      url,
      retryable: true,
    });
  }

  if (!response.ok) {
    throw new ExternalIntegrationError({
      message: `Failed to fetch transcript ${url}: ${response.status} ${response.statusText}`,
      integration: "transcript",
      url,
      retryable: isRetryableHttpStatus(response.status),
      status_code: response.status,
      retry_after_seconds: parseRetryAfterSeconds(response.headers.get("retry-after")),
    });
  }

  const contentType = response.headers.get("content-type") ?? "";
  const body = await response.text();

  return {
    contentType: contentType.toLowerCase(),
    body,
  };
};

const extractTranscriptDocument = (
  payload: { contentType: string; body: string },
  maxChars: number,
) => {
  if (!payload.contentType.includes("html") && !/<html|<body|<article|<main/i.test(payload.body)) {
    const plainText = clampText(payload.body.replace(/\r/g, "").trim(), maxChars);

    return {
      title: null,
      publisher: null,
      occurred_at: null,
      raw_text: plainText,
    };
  }

  const html = cleanHtml(payload.body);
  const primaryBlock = selectPrimaryHtmlBlock(html);
  const title = extractTitle(html);
  const publisher = extractPublisher(html);
  const occurredAt = normalizeIsoDate(extractOccurredAt(html));
  const rawText = buildTranscriptText(title, stripTags(primaryBlock), maxChars);

  return {
    title: title ? stripTags(title) : null,
    publisher,
    occurred_at: occurredAt,
    raw_text: rawText,
  };
};

export const ingestTranscriptBatch = async (
  services: AppServices,
  request: TranscriptPullRequest,
  fetchImpl: FetchLike = fetch,
) => {
  const results: Array<{
    status: "ingested" | "duplicate";
    source_id: string;
    event_id: string | null;
    title: string;
    publisher: string | null;
    speaker: string | null;
    raw_uri: string | null;
    occurred_at: string | null;
    extracted_chars: number;
  }> = [];

  for (const item of request.items) {
    const existing = await services.repository.getSourceByRawUri(item.url);

    if (existing) {
      results.push({
        status: "duplicate",
        source_id: existing.id,
        event_id: null,
        title: existing.title ?? item.title ?? item.url,
        publisher: existing.publisher ?? item.publisher ?? null,
        speaker: existing.speaker ?? item.speaker ?? null,
        raw_uri: existing.raw_uri ?? item.url,
        occurred_at: existing.occurred_at ?? null,
        extracted_chars: existing.raw_text.length,
      });
      continue;
    }

    const fetched = await fetchDocumentText(item.url, fetchImpl);
    const extracted = extractTranscriptDocument(fetched, item.max_chars);
    const source = await services.repository.createSource({
      source_type: item.source_type,
      title: item.title ?? extracted.title ?? new URL(item.url).hostname,
      speaker: item.speaker,
      publisher: item.publisher ?? extracted.publisher ?? undefined,
      raw_uri: item.url,
      occurred_at: extracted.occurred_at ?? undefined,
      raw_text: extracted.raw_text,
    });

    let eventId: string | null = null;

    if (request.parse_events) {
      const event = await services.repository.createEvent(source.id, parseFinanceEvent(source));
      eventId = event.id;
    }

    results.push({
      status: "ingested",
      source_id: source.id,
      event_id: eventId,
      title: source.title ?? item.title ?? item.url,
      publisher: source.publisher ?? extracted.publisher ?? null,
      speaker: source.speaker ?? item.speaker ?? null,
      raw_uri: source.raw_uri ?? item.url,
      occurred_at: source.occurred_at ?? extracted.occurred_at ?? null,
      extracted_chars: source.raw_text.length,
    });
  }

  return transcriptPullResponseSchema.parse({
    ingested_sources: results.filter((item) => item.status === "ingested").length,
    ingested_events: results.filter((item) => item.event_id !== null).length,
    duplicate_sources: results.filter((item) => item.status === "duplicate").length,
    results,
  });
};
