import { ingestFeedBatch } from "../lib/feedIngestion.js";
import { buildServices } from "../lib/services.js";

const feedUrls = (process.env.FEED_URLS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (!feedUrls.length) {
  throw new Error("Set FEED_URLS to one or more comma-separated RSS/Atom feed URLs.");
}

const services = buildServices();

try {
  const result = await ingestFeedBatch(services, {
    feeds: feedUrls.map((url) => ({
      url,
      max_items: Number(process.env.FEED_MAX_ITEMS ?? 5),
      source_type: "headline",
    })),
    parse_events: process.env.FEED_PARSE_EVENTS !== "false",
  });

  console.log(
    JSON.stringify(
      {
        ingested_sources: result.ingested_sources,
        ingested_events: result.ingested_events,
        duplicate_sources: result.duplicate_sources,
      },
      null,
      2,
    ),
  );
} finally {
  await services.marketDataProvider.close?.();
  await services.embeddingProvider.close?.();
  await services.repository.close?.();
}
