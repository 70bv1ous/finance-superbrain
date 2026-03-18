import { ingestTranscriptBatch } from "../lib/transcriptIngestion.js";
import { buildServices } from "../lib/services.js";

const transcriptUrls = (process.env.TRANSCRIPT_URLS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

if (!transcriptUrls.length) {
  throw new Error("Set TRANSCRIPT_URLS to one or more comma-separated document URLs.");
}

const services = buildServices();

try {
  const result = await ingestTranscriptBatch(services, {
    items: transcriptUrls.map((url) => ({
      url,
      source_type: (process.env.TRANSCRIPT_SOURCE_TYPE as
        | "transcript"
        | "speech"
        | "earnings"
        | "filing"
        | undefined) ?? "transcript",
      publisher: process.env.TRANSCRIPT_PUBLISHER,
      speaker: process.env.TRANSCRIPT_SPEAKER,
      max_chars: Number(process.env.TRANSCRIPT_MAX_CHARS ?? 12000),
    })),
    parse_events: process.env.TRANSCRIPT_PARSE_EVENTS !== "false",
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
