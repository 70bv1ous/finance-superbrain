import { afterEach, describe, expect, it } from "vitest";
import type { InjectOptions, InjectPayload, Response as LightMyRequestResponse } from "light-my-request";
import type { IncomingHttpHeaders, OutgoingHttpHeaders } from "node:http";

import { buildApp } from "../app.js";
import { InMemoryRepository } from "./InMemoryRepository.js";
import { MockMarketDataProvider } from "./MockMarketDataProvider.js";
import { runTranscriptStreamIngest } from "./transcriptStreamIngest.js";

let repository: InMemoryRepository | null = null;

const createResponseHeaders = (values: IncomingHttpHeaders | OutgoingHttpHeaders) => {
  const headers = new Headers();

  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string") {
      headers.set(key, value);
    }
  }

  return headers;
};

afterEach(async () => {
  await repository?.reset();
  repository = null;
});

describe("transcript stream ingest", () => {
  it("reads ndjson transcript updates and drives the live session endpoints", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });
    const apiBaseUrl = "http://finance-superbrain.local";
    const streamUrl = "https://stream.example.com/live.ndjson";

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url === streamUrl) {
        return new Response(
          [
            JSON.stringify({
              text: "Jerome Powell said the Fed is prepared to consider rate cuts if inflation continues to cool.",
            }),
            JSON.stringify({
              text: "He added that bond yields and the dollar may react as markets reprice the path of easing.",
            }),
          ].join("\n"),
          {
            status: 200,
            headers: {
              "content-type": "application/x-ndjson",
            },
          },
        );
      }

      if (url.startsWith(apiBaseUrl)) {
        const payloadText =
          typeof init?.body === "string"
            ? init.body
            : init?.body instanceof Uint8Array
              ? new TextDecoder().decode(init.body)
              : null;
        const payload = payloadText ? (JSON.parse(payloadText) as InjectPayload) : undefined;
        const injectOptions: InjectOptions = {
          method: (init?.method?.toString().toUpperCase() ?? "GET") as "GET" | "POST",
          url: new URL(url).pathname,
          payload,
        };
        const response: LightMyRequestResponse = await app.inject(injectOptions);

        return new Response(response.body, {
          status: response.statusCode,
          headers: createResponseHeaders(response.headers),
        });
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    try {
      await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/batch",
        payload: {
          items: [
            {
              source: {
                source_type: "speech",
                title: "Fed turns dovish",
                speaker: "Jerome Powell",
                raw_text:
                  "Jerome Powell said the Fed is prepared to consider rate cuts if inflation continues to cool and labor conditions weaken.",
              },
              horizon: "1d",
              model_version: "macro-live-v0",
              realized_moves: [
                { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 42 },
                { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 69 },
              ],
              timing_alignment: 0.8,
            },
          ],
        },
      });

      const result = await runTranscriptStreamIngest({
        api_base_url: apiBaseUrl,
        stream_url: streamUrl,
        stream_format: "ndjson",
        min_chunk_chars: 20,
        close_on_end: true,
        create_session: {
          source_type: "speech",
          title: "Live Powell stream",
          speaker: "Jerome Powell",
          publisher: "Macro Wire",
          model_version: "macro-live-v1",
          horizons: ["1h", "1d"],
          rolling_window_chars: 3000,
        },
        fetch_impl: fetchImpl,
      });

      expect(result.processed_stream_messages).toBe(2);
      expect(result.append_calls).toBe(2);
      const latestAnalysis = result.latest_analysis;

      expect(latestAnalysis).not.toBeNull();
      expect(latestAnalysis?.predictions.length).toBe(2);

      const sessionDetail = await app.inject({
        method: "GET",
        url: `/v1/transcript-sessions/${result.session_id}`,
      });

      expect(sessionDetail.statusCode).toBe(200);
      expect(sessionDetail.json().session.status).toBe("closed");
      expect(sessionDetail.json().chunk_count).toBe(2);
      expect(sessionDetail.json().latest_analysis.analogs.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });
});
