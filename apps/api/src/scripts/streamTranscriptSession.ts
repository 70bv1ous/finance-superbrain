import { runTranscriptStreamIngest } from "../lib/transcriptStreamIngest.js";

const streamUrl = process.env.TRANSCRIPT_STREAM_URL;

if (!streamUrl) {
  throw new Error("Set TRANSCRIPT_STREAM_URL to an NDJSON, SSE, or plain-text transcript stream URL.");
}

const result = await runTranscriptStreamIngest({
  api_base_url: process.env.API_BASE_URL ?? "http://127.0.0.1:3001",
  stream_url: streamUrl,
  stream_format:
    (process.env.TRANSCRIPT_STREAM_FORMAT as "ndjson" | "sse" | "plain" | undefined) ?? "ndjson",
  session_id: process.env.TRANSCRIPT_STREAM_SESSION_ID,
  create_session: process.env.TRANSCRIPT_STREAM_SESSION_ID
    ? undefined
    : {
        source_type:
          (process.env.TRANSCRIPT_STREAM_SOURCE_TYPE as
            | "transcript"
            | "speech"
            | "earnings"
            | "filing"
            | undefined) ?? "transcript",
        title: process.env.TRANSCRIPT_STREAM_TITLE,
        speaker: process.env.TRANSCRIPT_STREAM_SPEAKER,
        publisher: process.env.TRANSCRIPT_STREAM_PUBLISHER,
        raw_uri: process.env.TRANSCRIPT_STREAM_SOURCE_URI,
        model_version: process.env.TRANSCRIPT_STREAM_MODEL_VERSION ?? "impact-engine-v0",
        horizons: (process.env.TRANSCRIPT_STREAM_HORIZONS ?? "1d")
          .split(",")
          .map((value) => value.trim())
          .filter(Boolean) as Array<"1h" | "1d" | "5d">,
        rolling_window_chars: Number(process.env.TRANSCRIPT_STREAM_WINDOW_CHARS ?? 8000),
      },
  close_on_end: process.env.TRANSCRIPT_STREAM_CLOSE_ON_END === "true",
  min_chunk_chars: Number(process.env.TRANSCRIPT_STREAM_MIN_CHARS ?? 80),
  on_chunk_processed: ({ analysis }) => {
    const topPrediction = analysis.predictions[0];
    const topHighlight = analysis.highlights[0];

    console.log(
      JSON.stringify(
        {
          chunk_count: analysis.chunk_count,
          sentiment: analysis.parsed_event.sentiment,
          top_theme: analysis.parsed_event.themes[0] ?? null,
          top_prediction: topPrediction
            ? {
                horizon: topPrediction.horizon,
                confidence: topPrediction.confidence,
                thesis: topPrediction.thesis,
              }
            : null,
          top_highlight: topHighlight?.text ?? null,
        },
        null,
        2,
      ),
    );
  },
});

const latestAnalysis = result.latest_analysis;
const finalConfidence =
  latestAnalysis && latestAnalysis.predictions.length > 0
    ? latestAnalysis.predictions[0].confidence
    : null;

console.log(
  JSON.stringify(
    {
      session_id: result.session_id,
      processed_stream_messages: result.processed_stream_messages,
      append_calls: result.append_calls,
      final_confidence: finalConfidence,
    },
    null,
    2,
  ),
);
