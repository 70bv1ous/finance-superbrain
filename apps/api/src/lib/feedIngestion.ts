import {
  feedPullResponseSchema,
  type FeedPullRequest,
  type StoredSource,
} from "@finance-superbrain/schemas";

import {
  ExternalIntegrationError,
  isRetryableHttpStatus,
  parseRetryAfterSeconds,
} from "./integrationErrors.js";
import { parseFinanceEvent } from "./parseFinanceEvent.js";
import type { AppServices } from "./services.js";

type FeedEntry = {
  title: string;
  raw_uri: string | null;
  publisher: string | null;
  occurred_at: string | null;
  raw_text: string;
};

type FetchLike = typeof fetch;

const XML_ENTITY_MAP: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

const decodeXmlEntities = (value: string) =>
  value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity.startsWith("#x")) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    if (entity.startsWith("#")) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }

    return XML_ENTITY_MAP[entity] ?? match;
  });

const stripCdata = (value: string) => value.replace(/^<!\[CDATA\[|\]\]>$/g, "");

const stripTags = (value: string) =>
  decodeXmlEntities(stripCdata(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

const extractFirstTag = (xml: string, tag: string) => {
  const match = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i").exec(xml);
  return match ? stripTags(match[1]) : null;
};

const extractAllBlocks = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "gi"))].map(
    (match) => match[0],
  );

const extractAtomLink = (xml: string) => {
  const alternate =
    /<link\b[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(xml)?.[1] ?? null;
  const firstLink = /<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i.exec(xml)?.[1] ?? null;
  return alternate ?? firstLink;
};

const normalizeIsoDate = (input: string | null) => {
  if (!input) {
    return null;
  }

  const parsed = new Date(input);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

const buildRawText = (parts: Array<string | null>) => {
  const joined = parts.filter((part): part is string => Boolean(part)).join(". ").trim();
  return joined.length >= 20 ? joined : `${joined} Market-moving finance headline.`.trim();
};

export const parseFeedXml = (xml: string, fallbackPublisher?: string | null): FeedEntry[] => {
  const rssItems = extractAllBlocks(xml, "item");

  if (rssItems.length) {
    return rssItems.map((item) => {
      const title = extractFirstTag(item, "title") ?? "Untitled feed item";
      const description =
        extractFirstTag(item, "description") ??
        extractFirstTag(item, "content:encoded") ??
        extractFirstTag(item, "content");
      const publisher =
        extractFirstTag(item, "source") ??
        extractFirstTag(xml, "title") ??
        fallbackPublisher ??
        null;

      return {
        title,
        raw_uri: extractFirstTag(item, "link"),
        publisher,
        occurred_at: normalizeIsoDate(extractFirstTag(item, "pubDate")),
        raw_text: buildRawText([title, description]),
      };
    });
  }

  const atomEntries = extractAllBlocks(xml, "entry");

  return atomEntries.map((entry) => {
    const title = extractFirstTag(entry, "title") ?? "Untitled feed entry";
    const summary =
      extractFirstTag(entry, "summary") ??
      extractFirstTag(entry, "content") ??
      extractFirstTag(entry, "subtitle");
    const publisher =
      extractFirstTag(entry, "name") ??
      extractFirstTag(xml, "title") ??
      fallbackPublisher ??
      null;

    return {
      title,
      raw_uri: extractAtomLink(entry),
      publisher,
      occurred_at: normalizeIsoDate(
        extractFirstTag(entry, "updated") ?? extractFirstTag(entry, "published"),
      ),
      raw_text: buildRawText([title, summary]),
    };
  });
};

const fetchFeedText = async (url: string, fetchImpl: FetchLike) => {
  let response: Response;

  try {
    response = await fetchImpl(url, {
      headers: {
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.1",
      },
    });
  } catch (error) {
    throw new ExternalIntegrationError({
      message: `Failed to fetch feed ${url}: ${error instanceof Error ? error.message : "Unknown network error"}`,
      integration: "feed",
      url,
      retryable: true,
    });
  }

  if (!response.ok) {
    throw new ExternalIntegrationError({
      message: `Failed to fetch feed ${url}: ${response.status} ${response.statusText}`,
      integration: "feed",
      url,
      retryable: isRetryableHttpStatus(response.status),
      status_code: response.status,
      retry_after_seconds: parseRetryAfterSeconds(response.headers.get("retry-after")),
    });
  }

  return response.text();
};

const resolveExistingSource = async (
  services: AppServices,
  rawUri: string | null,
): Promise<StoredSource | null> => {
  if (!rawUri) {
    return null;
  }

  return services.repository.getSourceByRawUri(rawUri);
};

export const ingestFeedBatch = async (
  services: AppServices,
  request: FeedPullRequest,
  fetchImpl: FetchLike = fetch,
) => {
  const results: Array<{
    status: "ingested" | "duplicate";
    feed_url: string;
    source_id: string;
    event_id: string | null;
    title: string;
    publisher: string | null;
    raw_uri: string | null;
    occurred_at: string | null;
  }> = [];

  for (const feed of request.feeds) {
    const xml = await fetchFeedText(feed.url, fetchImpl);
    const entries = parseFeedXml(xml, feed.publisher ?? null).slice(0, feed.max_items);

    for (const entry of entries) {
      const existing = await resolveExistingSource(services, entry.raw_uri);

      if (existing) {
        results.push({
          status: "duplicate",
          feed_url: feed.url,
          source_id: existing.id,
          event_id: null,
          title: existing.title ?? entry.title,
          publisher: existing.publisher ?? entry.publisher,
          raw_uri: existing.raw_uri ?? entry.raw_uri,
          occurred_at: existing.occurred_at ?? entry.occurred_at,
        });
        continue;
      }

      const source = await services.repository.createSource({
        source_type: feed.source_type,
        title: entry.title,
        publisher: feed.publisher ?? entry.publisher ?? undefined,
        speaker: feed.speaker,
        raw_uri: entry.raw_uri ?? undefined,
        occurred_at: entry.occurred_at ?? undefined,
        raw_text: entry.raw_text,
      });

      let eventId: string | null = null;

      if (request.parse_events) {
        const event = await services.repository.createEvent(source.id, parseFinanceEvent(source));
        eventId = event.id;
      }

      results.push({
        status: "ingested",
        feed_url: feed.url,
        source_id: source.id,
        event_id: eventId,
        title: source.title ?? entry.title,
        publisher: source.publisher ?? entry.publisher,
        raw_uri: source.raw_uri ?? entry.raw_uri,
        occurred_at: source.occurred_at ?? entry.occurred_at,
      });
    }
  }

  return feedPullResponseSchema.parse({
    ingested_sources: results.filter((item) => item.status === "ingested").length,
    ingested_events: results.filter((item) => item.event_id !== null).length,
    duplicate_sources: results.filter((item) => item.status === "duplicate").length,
    results,
  });
};
