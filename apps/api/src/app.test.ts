import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildApp } from "./app.js";
import { buildHistoricalReplayPack } from "./data/historicalBackfillCases.js";
import { InMemoryRepository } from "./lib/InMemoryRepository.js";
import { LocalEmbeddingProvider } from "./lib/LocalEmbeddingProvider.js";
import { MockMarketDataProvider } from "./lib/MockMarketDataProvider.js";
import { drainOperationJobs } from "./lib/operationJobs.js";
import { createPGliteRepository } from "./lib/PGliteRepository.js";

let repository: InMemoryRepository | null = null;

afterEach(async () => {
  await repository?.reset();
  repository = null;
});

describe("finance superbrain API", () => {
  it("persists a full learning loop from source to lesson", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const sourceResponse = await app.inject({
        method: "POST",
        url: "/v1/sources",
        payload: {
          source_type: "transcript",
          title: "BBC live interview",
          speaker: "Donald Trump",
          raw_text:
            "Donald Trump said tariffs on China could rise and that the yuan has been weakening, which may pressure Chinese tech stocks.",
        },
      });

      expect(sourceResponse.statusCode).toBe(201);
      const source = sourceResponse.json();

      const parseResponse = await app.inject({
        method: "POST",
        url: `/v1/sources/${source.id}/parse`,
      });

      expect(parseResponse.statusCode).toBe(201);
      const event = parseResponse.json();

      const predictionResponse = await app.inject({
        method: "POST",
        url: `/v1/events/${event.id}/predictions`,
        payload: {
          horizons: ["1d"],
        },
      });

      expect(predictionResponse.statusCode).toBe(201);
      const prediction = predictionResponse.json().predictions[0];

      const outcomeResponse = await app.inject({
        method: "POST",
        url: `/v1/predictions/${prediction.id}/score`,
        payload: {
          realized_moves: [
            { ticker: "KWEB", realized_direction: "down", realized_magnitude_bp: -175 },
            { ticker: "USD/CNH", realized_direction: "up", realized_magnitude_bp: 30 },
          ],
          timing_alignment: 0.82,
        },
      });

      expect(outcomeResponse.statusCode).toBe(201);
      const outcome = outcomeResponse.json();
      expect(outcome.total_score).toBeGreaterThan(0.6);

      const postmortemResponse = await app.inject({
        method: "POST",
        url: `/v1/predictions/${prediction.id}/postmortem`,
      });

      expect(postmortemResponse.statusCode).toBe(201);
      const postmortemPayload = postmortemResponse.json();
      expect(postmortemPayload.lesson.prediction_id).toBe(prediction.id);

      const detailResponse = await app.inject({
        method: "GET",
        url: `/v1/predictions/${prediction.id}`,
      });

      expect(detailResponse.statusCode).toBe(200);
      const detail = detailResponse.json();
      expect(detail.prediction.status).toBe("reviewed");
      expect(detail.outcome.prediction_id).toBe(prediction.id);
      expect(detail.postmortem.prediction_id).toBe(prediction.id);

      const lessonsResponse = await app.inject({
        method: "GET",
        url: "/v1/lessons",
      });

      expect(lessonsResponse.statusCode).toBe(200);
      expect(lessonsResponse.json().lessons).toHaveLength(1);

      const calibrationResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/calibration",
      });

      expect(calibrationResponse.statusCode).toBe(200);
      expect(calibrationResponse.json().sample_count).toBeGreaterThan(0);

      const lessonSearchResponse = await app.inject({
        method: "GET",
        url: "/v1/lessons/search?q=weaker yuan and china tech pressure",
      });

      expect(lessonSearchResponse.statusCode).toBe(200);
      expect(lessonSearchResponse.json().results.length).toBeGreaterThan(0);

      const pipelineResponse = await app.inject({
        method: "GET",
        url: "/v1/dashboard/pipeline",
      });

      expect(pipelineResponse.statusCode).toBe(200);
      expect(pipelineResponse.json().items.length).toBeGreaterThan(0);
      expect(pipelineResponse.json().items[0].source.raw_text_excerpt.length).toBeGreaterThan(10);
      expect(pipelineResponse.json().items[0].prediction.assets.length).toBeGreaterThan(0);

      const dashboardResponse = await app.inject({
        method: "GET",
        url: "/v1/dashboard/summary",
      });

      expect(dashboardResponse.statusCode).toBe(200);
      expect(dashboardResponse.json().totals.lessons).toBe(1);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Finance Superbrain Memory Desk");
    } finally {
      await app.close();
    }
  });

  it("auto-scores matured predictions and stores lessons", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const sourceResponse = await app.inject({
        method: "POST",
        url: "/v1/sources",
        payload: {
          source_type: "headline",
          title: "China stimulus support",
          raw_text:
            "Officials signaled more stimulus support for China, boosting growth expectations and broader risk appetite.",
        },
      });

      const source = sourceResponse.json();
      const parseResponse = await app.inject({
        method: "POST",
        url: `/v1/sources/${source.id}/parse`,
      });

      const event = parseResponse.json();
      const predictionResponse = await app.inject({
        method: "POST",
        url: `/v1/events/${event.id}/predictions`,
        payload: {
          horizons: ["1d"],
        },
      });

      const prediction = predictionResponse.json().predictions[0];
      const futureAsOf = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

      const autoScoreResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/auto-score",
        payload: {
          as_of: futureAsOf,
          create_postmortems: true,
        },
      });

      expect(autoScoreResponse.statusCode).toBe(200);
      const payload = autoScoreResponse.json();
      expect(payload.processed).toBe(1);
      expect(payload.items[0].prediction_id).toBe(prediction.id);
      expect(payload.items[0].lesson).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it("retrieves similar analogs and uses them to enrich future predictions", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const firstSource = (
        await app.inject({
          method: "POST",
          url: "/v1/sources",
          payload: {
            source_type: "transcript",
            title: "Initial tariff warning",
            speaker: "Donald Trump",
            raw_text:
              "Donald Trump said tariffs on China could rise and that the yuan has been weakening, which may pressure Chinese tech stocks.",
          },
        })
      ).json();

      const firstEvent = (
        await app.inject({
          method: "POST",
          url: `/v1/sources/${firstSource.id}/parse`,
        })
      ).json();

      const firstPrediction = (
        await app.inject({
          method: "POST",
          url: `/v1/events/${firstEvent.id}/predictions`,
          payload: {
            horizons: ["1d"],
          },
        })
      ).json().predictions[0];

      await app.inject({
        method: "POST",
        url: `/v1/predictions/${firstPrediction.id}/score`,
        payload: {
          realized_moves: [
            { ticker: "KWEB", realized_direction: "down", realized_magnitude_bp: -170 },
            { ticker: "USD/CNH", realized_direction: "up", realized_magnitude_bp: 34 },
          ],
          timing_alignment: 0.83,
        },
      });

      await app.inject({
        method: "POST",
        url: `/v1/predictions/${firstPrediction.id}/postmortem`,
      });

      const secondSource = (
        await app.inject({
          method: "POST",
          url: "/v1/sources",
          payload: {
            source_type: "headline",
            title: "Another China tariff escalation",
            raw_text:
              "Fresh tariff escalation language around China and a weaker yuan renewed pressure on Chinese tech names.",
          },
        })
      ).json();

      const secondEvent = (
        await app.inject({
          method: "POST",
          url: `/v1/sources/${secondSource.id}/parse`,
        })
      ).json();

      const analogsResponse = await app.inject({
        method: "GET",
        url: `/v1/events/${secondEvent.id}/analogs`,
      });

      expect(analogsResponse.statusCode).toBe(200);
      const analogs = analogsResponse.json().analogs;
      expect(analogs.length).toBeGreaterThan(0);
      expect(analogs[0].event_id).toBe(firstEvent.id);

      const calibratedPredictionResponse = await app.inject({
        method: "POST",
        url: "/v1/predictions/generate",
        payload: {
          event: {
            event_class: secondEvent.event_class,
            summary: secondEvent.summary,
            sentiment: secondEvent.sentiment,
            urgency_score: secondEvent.urgency_score,
            novelty_score: secondEvent.novelty_score,
            entities: secondEvent.entities,
            themes: secondEvent.themes,
            candidate_assets: secondEvent.candidate_assets,
            why_it_matters: secondEvent.why_it_matters,
          },
          horizons: ["1d"],
        },
      });

      expect(calibratedPredictionResponse.statusCode).toBe(200);
      const calibratedPrediction = calibratedPredictionResponse.json().predictions[0];
      expect(
        calibratedPrediction.evidence.some((line: string) => line.includes("Analog calibration")),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("ingests historical reviewed cases through the batch route", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/batch",
        payload: {
          items: [
            {
              source: {
                source_type: "headline",
                title: "Chip export restrictions tighten",
                raw_text:
                  "New export control language on advanced AI chips raised concern for semiconductor demand and supply-chain access.",
              },
              horizon: "1d",
              realized_moves: [
                { ticker: "NVDA", realized_direction: "down", realized_magnitude_bp: -128 },
                { ticker: "SOXX", realized_direction: "down", realized_magnitude_bp: -88 },
              ],
              timing_alignment: 0.78,
            },
            {
              source: {
                source_type: "headline",
                title: "Semiconductor relief exemption",
                raw_text:
                  "Officials signaled exemptions to earlier chip restrictions, easing pressure on AI and semiconductor names.",
              },
              horizon: "1d",
              realized_moves: [
                { ticker: "NVDA", realized_direction: "up", realized_magnitude_bp: 104 },
                { ticker: "SOXX", realized_direction: "up", realized_magnitude_bp: 82 },
              ],
              timing_alignment: 0.74,
            },
          ],
        },
      });

      expect(ingestResponse.statusCode).toBe(201);
      expect(ingestResponse.json().ingested).toBe(2);

      const lessonSearchResponse = await app.inject({
        method: "GET",
        url: "/v1/lessons/search?q=chip supply chain pressure",
      });

      expect(lessonSearchResponse.statusCode).toBe(200);
      expect(lessonSearchResponse.json().results.length).toBeGreaterThan(0);

      const pipelineResponse = await app.inject({
        method: "GET",
        url: "/v1/dashboard/pipeline",
      });

      expect(pipelineResponse.statusCode).toBe(200);
      expect(pipelineResponse.json().items.length).toBe(2);
    } finally {
      await app.close();
    }
  });

  it("captures calibration snapshots and exposes history", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/batch",
        payload: {
          items: [
            {
              source: {
                source_type: "headline",
                title: "Cooling inflation eases pressure",
                raw_text:
                  "A cooler inflation print eased rate pressure and supported growth equities as yields moved lower.",
              },
              horizon: "1d",
              realized_moves: [
                { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 118 },
                { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 74 },
              ],
              timing_alignment: 0.79,
            },
          ],
        },
      });

      expect(ingestResponse.statusCode).toBe(201);

      const snapshotResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/calibration-snapshot",
        payload: {},
      });

      expect(snapshotResponse.statusCode).toBe(201);
      expect(snapshotResponse.json().sample_count).toBeGreaterThan(0);

      const historyResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/calibration/history?limit=5",
      });

      expect(historyResponse.statusCode).toBe(200);
      expect(historyResponse.json().snapshots.length).toBe(1);
      expect(historyResponse.json().snapshots[0].report.sample_count).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("compares model versions and runs the self-audit cycle", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const modelOneResponse = await app.inject({
        method: "POST",
        url: "/v1/models",
        payload: {
          model_version: "impact-engine-v1",
          family: "impact-engine",
          label: "Tariff-sensitive baseline",
          status: "active",
          feature_flags: {
            analogs: true,
            semantic_memory: true,
          },
        },
      });

      const modelTwoResponse = await app.inject({
        method: "POST",
        url: "/v1/models",
        payload: {
          model_version: "impact-engine-v2",
          family: "impact-engine",
          label: "Macro growth upgrade",
          status: "active",
          feature_flags: {
            analogs: true,
            macro_bias: true,
          },
        },
      });

      expect(modelOneResponse.statusCode).toBe(201);
      expect(modelTwoResponse.statusCode).toBe(201);

      const historicalResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/batch",
        payload: {
          items: [
            {
              source: {
                source_type: "headline",
                title: "China tariff pressure",
                raw_text:
                  "Tariff escalation talk and yuan weakness pressured China tech names and defensive dollar positioning.",
              },
              horizon: "1d",
              model_version: "impact-engine-v1",
              realized_moves: [
                { ticker: "KWEB", realized_direction: "down", realized_magnitude_bp: -145 },
                { ticker: "USD/CNH", realized_direction: "up", realized_magnitude_bp: 24 },
              ],
              timing_alignment: 0.8,
            },
            {
              source: {
                source_type: "headline",
                title: "Cooling inflation supports growth",
                raw_text:
                  "Cooling inflation eased rate pressure and supported growth equities with lower yields and weaker dollar pressure.",
              },
              horizon: "1d",
              model_version: "impact-engine-v2",
              realized_moves: [
                { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 111 },
                { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 62 },
              ],
              timing_alignment: 0.77,
            },
          ],
        },
      });

      expect(historicalResponse.statusCode).toBe(201);

      const source = (
        await app.inject({
          method: "POST",
          url: "/v1/sources",
          payload: {
            source_type: "headline",
            title: "China stimulus support",
            raw_text:
              "Officials signaled more stimulus support for China, improving growth expectations and risk appetite across equities.",
          },
        })
      ).json();

      const event = (
        await app.inject({
          method: "POST",
          url: `/v1/sources/${source.id}/parse`,
        })
      ).json();

      const predictionResponse = await app.inject({
        method: "POST",
        url: `/v1/events/${event.id}/predictions`,
        payload: {
          horizons: ["1d"],
          model_version: "impact-engine-v3",
        },
      });

      expect(predictionResponse.statusCode).toBe(201);

      const modelsResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/models",
      });

      expect(modelsResponse.statusCode).toBe(200);
      expect(modelsResponse.json().versions.length).toBeGreaterThanOrEqual(2);
      expect(modelsResponse.json().leaders.by_average_total_score).not.toBeNull();
      expect(modelsResponse.json().versions[0].registry).not.toBeNull();

      const selfAuditResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/self-audit",
        payload: {
          as_of: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
        },
      });

      expect(selfAuditResponse.statusCode).toBe(200);
      expect(selfAuditResponse.json().auto_score.processed).toBe(1);
      expect(selfAuditResponse.json().calibration_snapshot).not.toBeNull();
      expect(selfAuditResponse.json().model_comparison.versions.length).toBeGreaterThanOrEqual(3);
    } finally {
      await app.close();
    }
  });

  it("runs a historical replay benchmark across multiple model versions", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const replayResponse = await app.inject({
        method: "POST",
        url: "/v1/metrics/replay",
        payload: buildHistoricalReplayPack(["impact-engine-v0", "macro-live-v1"]),
      });

      expect(replayResponse.statusCode).toBe(200);
      expect(replayResponse.json().case_count).toBe(12);
      expect(replayResponse.json().models.length).toBe(2);
      expect(replayResponse.json().cases.length).toBe(24);
      expect(replayResponse.json().leaders.by_average_total_score).not.toBeNull();
      expect(replayResponse.json().models[0].by_theme.length).toBeGreaterThan(0);
      expect(replayResponse.json().models[0].by_source_type.length).toBeGreaterThan(0);
      expect(replayResponse.json().models[0].average_confidence).not.toBe(
        replayResponse.json().models[1].average_confidence,
      );
    } finally {
      await app.close();
    }
  });

  it("ingests labeled historical library cases and lists the durable library", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/library",
        payload: {
          items: [
            {
              case_id: "library-chip-crackdown",
              case_pack: "policy_lab",
              source: {
                source_type: "headline",
                title: "Chip export restrictions tighten",
                raw_text:
                  "New export control language on advanced AI chips raised concern for semiconductor demand and supply-chain access.",
              },
              horizon: "1d",
              realized_moves: [
                { ticker: "NVDA", realized_direction: "down", realized_magnitude_bp: -128 },
                { ticker: "SOXX", realized_direction: "down", realized_magnitude_bp: -88 },
              ],
              timing_alignment: 0.78,
              dominant_catalyst: "export-controls",
              labels: {
                tags: ["manual_case", "semis"],
                regions: ["global"],
                notes: "Curated policy shock case.",
              },
            },
          ],
          store_library: true,
          ingest_reviewed_memory: true,
          fallback_model_version: "historical-library-test-v1",
          labeling_mode: "merge",
        },
      });

      expect(ingestResponse.statusCode).toBe(201);
      expect(ingestResponse.json().ingested_cases).toBe(1);
      expect(ingestResponse.json().stored_library_items).toBe(1);
      expect(ingestResponse.json().reviewed_ingests).toBe(1);
      expect(ingestResponse.json().results[0].case_quality).toBe("reviewed");
      expect(ingestResponse.json().results[0].label_source).toBe("hybrid");
      expect(ingestResponse.json().results[0].primary_assets).toContain("NVDA");

      const listResponse = await app.inject({
        method: "GET",
        url: "/v1/ingestion/historical/library?case_pack=policy_lab&limit=10",
      });

      expect(listResponse.statusCode).toBe(200);
      expect(listResponse.json().items).toHaveLength(1);
      expect(listResponse.json().items[0].case_id).toBe("library-chip-crackdown");
      expect(listResponse.json().items[0].labels.case_quality).toBe("reviewed");
      expect(listResponse.json().items[0].labels.tags).toContain("manual_case");
      expect(listResponse.json().items[0].labels.primary_assets).toContain("NVDA");
      expect(listResponse.json().items[0].review.reviewed_at).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it("routes draft library cases through review before replaying them", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/library",
        payload: {
          items: [
            {
              case_id: "library-fed-dovish",
              case_pack: "macro_lab",
              source: {
                source_type: "speech",
                title: "Fed turns dovish",
                speaker: "Jerome Powell",
                raw_text:
                  "Jerome Powell said the Fed is prepared to consider rate cuts if inflation continues to cool and labor conditions weaken.",
              },
              horizon: "1d",
              realized_moves: [
                { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 42 },
                { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 69 },
              ],
              timing_alignment: 0.8,
              dominant_catalyst: "fed-dovish",
            },
            {
              case_id: "library-hot-inflation",
              case_pack: "macro_lab",
              source: {
                source_type: "headline",
                title: "Hot inflation surprise",
                raw_text:
                  "A hotter-than-expected inflation print renewed rate pressure, pushing yields higher and rattling growth stocks.",
              },
              horizon: "1d",
              realized_moves: [
                { ticker: "TLT", realized_direction: "down", realized_magnitude_bp: -64 },
                { ticker: "QQQ", realized_direction: "down", realized_magnitude_bp: -92 },
              ],
              timing_alignment: 0.84,
              dominant_catalyst: "inflation-shock",
            },
          ],
          store_library: true,
          ingest_reviewed_memory: false,
          fallback_model_version: "historical-library-test-v1",
        },
      });

      expect(ingestResponse.statusCode).toBe(201);
      expect(ingestResponse.json().results[0].case_quality).toBe("draft");
      expect(ingestResponse.json().results[1].case_quality).toBe("draft");

      const queueResponse = await app.inject({
        method: "GET",
        url: "/v1/ingestion/historical/library?case_pack=macro_lab&needs_review=true",
      });

      expect(queueResponse.statusCode).toBe(200);
      expect(queueResponse.json().items).toHaveLength(2);

      const draftReplayResponse = await app.inject({
        method: "POST",
        url: "/v1/metrics/replay/library",
        payload: {
          model_versions: ["impact-engine-v0", "macro-live-v1"],
          case_pack: "macro_lab",
        },
      });

      expect(draftReplayResponse.statusCode).toBe(404);

      const reviewResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/library/library-fed-dovish/review",
        payload: {
          case_pack: "macro_reviewed_lab",
          case_quality: "high_confidence",
          reviewer: "macro-ops",
          review_notes: "Confirmed Fed cut signal with clean rates response.",
          labels: {
            competing_catalysts: ["labor-softness", "bond-rally"],
            tags: ["manual_reviewed", "fed"],
          },
          ingest_reviewed_memory: true,
          model_version: "historical-review-v1",
        },
      });

      expect(reviewResponse.statusCode).toBe(200);
      expect(reviewResponse.json().item.case_pack).toBe("macro_reviewed_lab");
      expect(reviewResponse.json().item.labels.case_quality).toBe("high_confidence");
      expect(reviewResponse.json().item.labels.competing_catalysts).toContain("labor-softness");
      expect(reviewResponse.json().item.review.reviewer).toBe("macro-ops");
      expect(reviewResponse.json().reviewed_prediction_id).not.toBeNull();

      const detailResponse = await app.inject({
        method: "GET",
        url: "/v1/ingestion/historical/library/library-fed-dovish",
      });

      expect(detailResponse.statusCode).toBe(200);
      expect(detailResponse.json().review.adjudicated_at).not.toBeNull();

      const remainingQueueResponse = await app.inject({
        method: "GET",
        url: "/v1/ingestion/historical/library?case_pack=macro_lab&needs_review=true",
      });

      expect(remainingQueueResponse.statusCode).toBe(200);
      expect(remainingQueueResponse.json().items).toHaveLength(1);
      expect(remainingQueueResponse.json().items[0].case_id).toBe("library-hot-inflation");

      const replayResponse = await app.inject({
        method: "POST",
        url: "/v1/metrics/replay/library",
        payload: {
          model_versions: ["impact-engine-v0", "macro-live-v1"],
          case_pack: "macro_reviewed_lab",
        },
      });

      expect(replayResponse.statusCode).toBe(200);
      expect(replayResponse.json().case_count).toBe(1);
      expect(replayResponse.json().models).toHaveLength(2);
      expect(replayResponse.json().cases).toHaveLength(2);
      expect(replayResponse.json().leaders.by_average_total_score).not.toBeNull();
    } finally {
      await app.close();
    }
  });

  it("ingests macro calendar cases through the preset loader", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/macro-calendar",
        payload: {
          items: [
            {
              case_id: "macro-loader-cpi-hotter",
              case_pack: "macro_loader_lab",
              event_type: "cpi",
              signal_bias: "hotter",
              summary:
                "Core CPI stayed sticky enough to push yields higher and pressure long-duration growth into the close.",
              realized_moves: [
                { ticker: "TLT", realized_direction: "down", realized_magnitude_bp: -58 },
                { ticker: "QQQ", realized_direction: "down", realized_magnitude_bp: -81 },
                { ticker: "DXY", realized_direction: "up", realized_magnitude_bp: 31 },
              ],
              timing_alignment: 0.83,
            },
          ],
          store_library: true,
          ingest_reviewed_memory: false,
          fallback_model_version: "macro-loader-test-v1",
        },
      });

      expect(ingestResponse.statusCode).toBe(201);
      expect(ingestResponse.json().ingested_cases).toBe(1);
      expect(ingestResponse.json().results[0].case_quality).toBe("draft");
      expect(ingestResponse.json().results[0].themes).toContain("inflation");
      expect(ingestResponse.json().results[0].primary_assets).toContain("TLT");

      const detailResponse = await app.inject({
        method: "GET",
        url: "/v1/ingestion/historical/library/macro-loader-cpi-hotter",
      });

      expect(detailResponse.statusCode).toBe(200);
      expect(detailResponse.json().labels.tags).toContain("macro_calendar");
      expect(detailResponse.json().labels.tags).toContain("cpi");
      expect(detailResponse.json().parsed_event.themes).toContain("inflation");
      expect(detailResponse.json().review.review_hints.length).toBeGreaterThan(0);
      expect(detailResponse.json().review.reviewed_at).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("ingests earnings cases through the preset loader", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/earnings",
        payload: {
          items: [
            {
              case_id: "earnings-loader-guidance-cut",
              case_pack: "earnings_loader_lab",
              event_type: "guidance_cut",
              signal_bias: "negative",
              company: "Nike",
              ticker: "NKE",
              sector: "consumer_discretionary",
              peers: ["XLY", "LULU"],
              summary:
                "Management cut the forward outlook and pointed to weaker traffic, more promotions, and a softer consumer setup than expected.",
              realized_moves: [
                { ticker: "NKE", realized_direction: "down", realized_magnitude_bp: -118 },
                { ticker: "XLY", realized_direction: "down", realized_magnitude_bp: -31 },
                { ticker: "XRT", realized_direction: "down", realized_magnitude_bp: -46 },
              ],
              timing_alignment: 0.76,
            },
          ],
          store_library: true,
          ingest_reviewed_memory: false,
          fallback_model_version: "earnings-loader-test-v1",
        },
      });

      expect(ingestResponse.statusCode).toBe(201);
      expect(ingestResponse.json().ingested_cases).toBe(1);
      expect(ingestResponse.json().results[0].case_quality).toBe("draft");
      expect(ingestResponse.json().results[0].themes).toContain("earnings_guidance");
      expect(ingestResponse.json().results[0].primary_assets).toContain("NKE");

      const detailResponse = await app.inject({
        method: "GET",
        url: "/v1/ingestion/historical/library/earnings-loader-guidance-cut",
      });

      expect(detailResponse.statusCode).toBe(200);
      expect(detailResponse.json().source.source_type).toBe("earnings");
      expect(detailResponse.json().labels.tags).toContain("earnings_loader");
      expect(detailResponse.json().labels.tags).toContain("guidance_cut");
      expect(detailResponse.json().labels.primary_assets).toContain("NKE");
      expect(detailResponse.json().labels.primary_assets).toContain("XLY");
      expect(detailResponse.json().labels.sectors).toContain("consumer_discretionary");
      expect(detailResponse.json().review.review_hints.length).toBeGreaterThan(0);
      expect(detailResponse.json().review.reviewed_at).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("ingests policy and FX cases through the general sovereign loader", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/policy-fx",
        payload: {
          items: [
            {
              case_id: "policy-loader-yen-intervention",
              case_pack: "policy_loader_lab",
              event_type: "fx_intervention",
              signal_bias: "supportive",
              country: "Japan",
              region: "asia",
              currency_pair: "USD/JPY",
              focus_assets: ["EWJ"],
              summary:
                "Officials intervened to support the yen after disorderly depreciation, pulling USD/JPY lower and changing the path for Japan-sensitive risk assets.",
              realized_moves: [
                { ticker: "USD/JPY", realized_direction: "down", realized_magnitude_bp: -143 },
                { ticker: "EWJ", realized_direction: "down", realized_magnitude_bp: -34 },
                { ticker: "DXY", realized_direction: "down", realized_magnitude_bp: -18 },
              ],
              timing_alignment: 0.77,
            },
          ],
          store_library: true,
          ingest_reviewed_memory: false,
          fallback_model_version: "policy-loader-test-v1",
        },
      });

      expect(ingestResponse.statusCode).toBe(201);
      expect(ingestResponse.json().ingested_cases).toBe(1);
      expect(ingestResponse.json().results[0].case_quality).toBe("draft");
      expect(ingestResponse.json().results[0].themes).toContain("fx_policy");
      expect(ingestResponse.json().results[0].primary_assets).toContain("USD/JPY");

      const detailResponse = await app.inject({
        method: "GET",
        url: "/v1/ingestion/historical/library/policy-loader-yen-intervention",
      });

      expect(detailResponse.statusCode).toBe(200);
      expect(detailResponse.json().labels.tags).toContain("policy_loader");
      expect(detailResponse.json().labels.tags).toContain("fx_intervention");
      expect(detailResponse.json().labels.primary_assets).toContain("USD/JPY");
      expect(detailResponse.json().labels.primary_assets).toContain("EWJ");
      expect(detailResponse.json().parsed_event.themes).toContain("fx_policy");
      expect(detailResponse.json().review.review_hints.length).toBeGreaterThan(0);
      expect(detailResponse.json().review.reviewed_at).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("promotes strong reviewed cases into the high-confidence benchmark tier", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/library",
        payload: {
          items: [
            {
              case_id: "confidence-fed-dovish",
              case_pack: "macro_lab",
              source: {
                source_type: "speech",
                title: "Fed signals room to cut",
                speaker: "Jerome Powell",
                raw_text:
                  "Jerome Powell said the Fed could cut if inflation keeps cooling and labor conditions soften further.",
              },
              horizon: "1d",
              realized_moves: [
                { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 61 },
                { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 94 },
              ],
              timing_alignment: 0.84,
              dominant_catalyst: "fed-dovish-shift",
              labels: {
                event_family: "fed_speech",
                tags: ["macro", "fed"],
                regimes: ["macro_rates"],
                regions: ["united_states"],
                sectors: ["technology"],
                primary_themes: ["inflation", "rates"],
                primary_assets: ["TLT", "QQQ"],
                competing_catalysts: ["light positioning unwind"],
                notes: "Operator-curated macro case with cross-asset confirmation.",
                case_quality: "reviewed",
              },
              review_hints: ["Check whether the move came from guidance or positioning."],
            },
          ],
          store_library: true,
          ingest_reviewed_memory: false,
          fallback_model_version: "historical-library-test-v1",
          labeling_mode: "merge",
        },
      });

      expect(ingestResponse.statusCode).toBe(201);
      expect(ingestResponse.json().results[0].case_quality).toBe("reviewed");

      const reviewResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/library/confidence-fed-dovish/review",
        payload: {
          reviewer: "ops-desk",
          review_notes:
            "Confirmed this was primarily a dovish policy repricing and not just a growth short-covering move. Cross-asset confirmation came from Treasuries and rate-sensitive equities moving together.",
          review_hints: [
            "Cross-check Treasury response against rate futures.",
            "Confirm equity move aligned with lower terminal-rate pricing.",
          ],
          labels: {
            competing_catalysts: ["light positioning unwind", "pre-event defensive hedging"],
            notes:
              "Reviewed with cross-asset confirmation and competing catalysts documented for replay trust.",
          },
          case_quality: "reviewed",
        },
      });

      expect(reviewResponse.statusCode).toBe(200);

      const candidateReportResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/historical-library/high-confidence-candidates?limit=5",
      });

      expect(candidateReportResponse.statusCode).toBe(200);
      expect(candidateReportResponse.json().eligible_candidate_count).toBe(1);
      expect(candidateReportResponse.json().promotable_count).toBe(1);
      expect(candidateReportResponse.json().candidates[0].case_id).toBe("confidence-fed-dovish");
      expect(candidateReportResponse.json().candidates[0].recommendation).toBe("promote");

      const promoteResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/library/confidence-fed-dovish/promote-high-confidence",
        payload: {
          reviewer: "ops-desk",
          min_candidate_score: 0.75,
        },
      });

      expect(promoteResponse.statusCode).toBe(200);
      expect(promoteResponse.json().item.labels.case_quality).toBe("high_confidence");
      expect(promoteResponse.json().candidate.candidate_score).toBeGreaterThanOrEqual(0.75);
      expect(promoteResponse.json().candidate.recommendation).toBe("promote");

      const coverageResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/historical-library?top=6",
      });

      expect(coverageResponse.statusCode).toBe(200);
      expect(coverageResponse.json().high_confidence_cases).toBe(1);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("High-confidence candidates");
    } finally {
      await app.close();
    }
  });

  it("seeds a first high-confidence case set from the reviewed core corpus", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/core-corpus",
        payload: {
          include_backfill: false,
          include_macro: true,
          include_earnings: false,
          include_policy_fx: false,
          include_energy: false,
          include_credit_banking: false,
          macro_case_pack: "macro_calendar_v1",
          store_library: true,
          ingest_reviewed_memory: false,
          fallback_model_version: "core-corpus-loader-v1",
        },
      });

      expect(ingestResponse.statusCode).toBe(201);
      expect(ingestResponse.json().stored_library_items).toBeGreaterThan(0);

      const seedResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/historical-library/seed-high-confidence",
        payload: {
          reviewer: "macro-seed-ops",
          case_pack_filters: ["macro_calendar_v1"],
          limit: 3,
          min_candidate_score: 0.8,
          dry_run: false,
        },
      });

      expect(seedResponse.statusCode).toBe(200);
      expect(seedResponse.json().candidate_count).toBe(3);
      expect(seedResponse.json().promoted_count).toBeGreaterThan(0);
      expect(seedResponse.json().prioritized_regimes.length).toBeGreaterThan(0);
      expect(seedResponse.json().items[0].candidate.candidate_score).toBeGreaterThanOrEqual(0.8);
      expect(seedResponse.json().items[0].final_case_quality).toBe("high_confidence");

      const coverageResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/historical-library?top=6",
      });

      expect(coverageResponse.statusCode).toBe(200);
      expect(coverageResponse.json().high_confidence_cases).toBeGreaterThan(0);

      const candidateResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/historical-library/high-confidence-candidates?limit=6",
      });

      expect(candidateResponse.statusCode).toBe(200);
      expect(candidateResponse.json().total_reviewed_cases).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("refreshes benchmark trust by seeding high-confidence memory and capturing a fresh snapshot", async () => {
    repository = new InMemoryRepository();
    await repository.saveModelVersion({
      model_version: "macro-live-v1",
      family: "macro-live",
      label: "Macro live v1",
      status: "active",
      feature_flags: {},
    });

    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/core-corpus",
        payload: {
          include_backfill: true,
          include_macro: true,
          include_earnings: true,
          include_policy_fx: true,
          include_energy: true,
          include_credit_banking: true,
          store_library: true,
          ingest_reviewed_memory: false,
          fallback_model_version: "core-corpus-loader-v1",
        },
      });

      expect(ingestResponse.statusCode).toBe(201);

      const refreshResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/benchmark-trust-refresh",
        payload: {
          benchmark_pack_id: "core_benchmark_lite_v1",
          reviewer: "trust-refresh-ops",
          seed_limit: 5,
          min_candidate_score: 0.8,
          dry_run: false,
          strict_quotas: false,
        },
      });

      expect(refreshResponse.statusCode).toBe(200);
      expect(refreshResponse.json().seed.promoted_count).toBeGreaterThan(0);
      expect(Array.isArray(refreshResponse.json().seed.prioritized_regimes)).toBe(true);
      expect(refreshResponse.json().seed.promoted_regimes.length).toBeGreaterThan(0);
      expect(refreshResponse.json().delta.high_confidence_cases).toBeGreaterThan(0);
      expect(refreshResponse.json().benchmark_snapshot).not.toBeNull();
      expect(refreshResponse.json().benchmark_snapshot.benchmark_pack_id).toBe(
        "core_benchmark_lite_v1",
      );
      expect(refreshResponse.json().after.high_confidence_cases).toBeGreaterThan(
        refreshResponse.json().before.high_confidence_cases,
      );

      const trustHistoryResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/benchmarks/trust-history?benchmark_pack_id=core_benchmark_lite_v1&limit=5",
      });

      expect(trustHistoryResponse.statusCode).toBe(200);
      expect(trustHistoryResponse.json().refreshes).toHaveLength(1);
      expect(trustHistoryResponse.json().refreshes[0].seed.reviewer).toBe("trust-refresh-ops");
      expect(trustHistoryResponse.json().refreshes[0].benchmark_snapshot_id).not.toBeNull();

      const benchmarkDashboardResponse = await app.inject({
        method: "GET",
        url: "/v1/dashboard/benchmarks?benchmark_pack_id=core_benchmark_lite_v1",
      });

      expect(benchmarkDashboardResponse.statusCode).toBe(200);
      expect(benchmarkDashboardResponse.json().latest_trust_refresh).not.toBeNull();
      expect(benchmarkDashboardResponse.json().recent_trust_refreshes).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("reports historical library coverage across packs, trust levels, and review burden", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const macroResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/macro-calendar",
        payload: {
          items: [
            {
              case_id: "coverage-fed-watch",
              case_pack: "coverage_macro_lab",
              event_type: "fed_speech",
              signal_bias: "dovish",
              summary:
                "Fed speakers signaled patience on cuts while acknowledging softer labor demand and cooling inflation momentum.",
              realized_moves: [
                { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 64 },
                { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 71 },
              ],
              timing_alignment: 0.8,
            },
          ],
          store_library: true,
          ingest_reviewed_memory: false,
        },
      });

      expect(macroResponse.statusCode).toBe(201);

      const reviewDraftResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/library/coverage-fed-watch/review",
        payload: {
          case_quality: "draft",
          reviewer: "macro-ops",
          review_notes: "Assigned for follow-up before adjudication.",
        },
      });

      expect(reviewDraftResponse.statusCode).toBe(200);
      expect(reviewDraftResponse.json().item.review.reviewer).toBe("macro-ops");
      expect(reviewDraftResponse.json().item.review.adjudicated_at).toBeNull();

      const policyResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/policy-fx",
        payload: {
          items: [
            {
              case_id: "coverage-fiscal-shock",
              case_pack: "coverage_policy_lab",
              event_type: "fiscal_shock",
              signal_bias: "restrictive",
              country: "United Kingdom",
              region: "europe",
              focus_assets: ["GBP/USD", "EWU"],
              summary:
                "A sudden fiscal tightening package hit domestic growth expectations and pressured sterling-sensitive risk assets.",
              realized_moves: [
                { ticker: "GBP/USD", realized_direction: "down", realized_magnitude_bp: -84 },
                { ticker: "EWU", realized_direction: "down", realized_magnitude_bp: -46 },
              ],
              timing_alignment: 0.74,
            },
          ],
          store_library: true,
          ingest_reviewed_memory: false,
        },
      });

      expect(policyResponse.statusCode).toBe(201);

      const highConfidenceResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/library",
        payload: {
          items: [
            {
              case_id: "coverage-energy-cut",
              case_pack: "coverage_energy_lab",
              source: {
                source_type: "headline",
                title: "OPEC surprise cut tightens crude outlook",
                raw_text:
                  "Producers announced a surprise supply cut that tightened the crude balance and lifted energy equities alongside front-month oil.",
              },
              horizon: "1d",
              realized_moves: [
                { ticker: "CL=F", realized_direction: "up", realized_magnitude_bp: 138 },
                { ticker: "XLE", realized_direction: "up", realized_magnitude_bp: 61 },
              ],
              timing_alignment: 0.86,
              dominant_catalyst: "opec-surprise-cut",
              labels: {
                event_family: "energy_shock",
                case_quality: "high_confidence",
                tags: ["manual_case", "energy"],
                regions: ["global"],
                sectors: ["energy"],
                primary_themes: ["energy_supply"],
                primary_assets: ["CL=F", "XLE"],
              },
            },
          ],
          store_library: true,
          ingest_reviewed_memory: false,
        },
      });

      expect(highConfidenceResponse.statusCode).toBe(201);

      const coverageResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/historical-library?top=5",
      });

      expect(coverageResponse.statusCode).toBe(200);
      expect(coverageResponse.json().total_cases).toBe(3);
      expect(coverageResponse.json().needs_review_count).toBe(2);
      expect(coverageResponse.json().high_confidence_cases).toBe(1);
      expect(coverageResponse.json().review_queue.assigned_cases).toBe(1);
      expect(coverageResponse.json().review_queue.unassigned_cases).toBe(1);
      expect(coverageResponse.json().review_queue.adjudicated_cases).toBe(1);
      expect(coverageResponse.json().unique_case_packs).toBe(3);
      expect(coverageResponse.json().unique_regimes).toBeGreaterThan(0);

      const draftBucket = coverageResponse
        .json()
        .by_case_quality.find((item: { name: string }) => item.name === "draft");
      expect(draftBucket?.count).toBe(2);

      const energyPack = coverageResponse
        .json()
        .by_case_pack.find((item: { case_pack: string }) => item.case_pack === "coverage_energy_lab");
      expect(energyPack?.high_confidence_count).toBe(1);

      const sourceTypes = coverageResponse
        .json()
        .by_source_type.map((item: { name: string }) => item.name);
      expect(sourceTypes).toContain("headline");
      expect(sourceTypes).toContain("speech");
      expect(coverageResponse.json().by_regime.length).toBeGreaterThan(0);

      const gapResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/historical-library/gaps",
      });

      expect(gapResponse.statusCode).toBe(200);
      expect(gapResponse.json().alert_count).toBeGreaterThan(0);
      expect(gapResponse.json().counts.high).toBeGreaterThanOrEqual(0);
      expect(
        gapResponse
          .json()
          .alerts.some(
            (alert: { category: string; target: string }) =>
              alert.category === "pack_coverage" && alert.target === "credit_banking",
          ),
      ).toBe(true);
      expect(
        gapResponse
          .json()
          .alerts.some((alert: { category: string }) => alert.category === "review_backlog"),
      ).toBe(true);
      expect(
        gapResponse
          .json()
          .alerts.some((alert: { category: string }) => alert.category === "regime_coverage"),
      ).toBe(true);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Historical memory");
      expect(opsPageResponse.body).toContain("Memory gaps");
      expect(opsPageResponse.body).toContain("/v1/metrics/historical-library?top=6");
      expect(opsPageResponse.body).toContain("/v1/metrics/historical-library/gaps");
    } finally {
      await app.close();
    }
  });

  it("ingests energy and commodity shock cases through the energy loader", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/energy",
        payload: {
          items: [
            {
              case_id: "energy-loader-opec-cut",
              case_pack: "energy_loader_lab",
              event_type: "opec_cut",
              signal_bias: "bullish",
              market: "crude_oil",
              region: "middle_east",
              producer: "OPEC+",
              focus_assets: ["XLE"],
              summary:
                "OPEC+ signaled a surprise output cut that tightened prompt crude balances and lifted inflation-sensitive energy assets.",
              realized_moves: [
                { ticker: "CL=F", realized_direction: "up", realized_magnitude_bp: 141 },
                { ticker: "XLE", realized_direction: "up", realized_magnitude_bp: 58 },
                { ticker: "USO", realized_direction: "up", realized_magnitude_bp: 122 },
              ],
              timing_alignment: 0.84,
            },
          ],
          store_library: true,
          ingest_reviewed_memory: false,
          fallback_model_version: "energy-loader-test-v1",
        },
      });

      expect(ingestResponse.statusCode).toBe(201);
      expect(ingestResponse.json().ingested_cases).toBe(1);
      expect(ingestResponse.json().results[0].case_quality).toBe("draft");
      expect(ingestResponse.json().results[0].themes).toContain("energy");
      expect(ingestResponse.json().results[0].primary_assets).toContain("CL=F");

      const detailResponse = await app.inject({
        method: "GET",
        url: "/v1/ingestion/historical/library/energy-loader-opec-cut",
      });

      expect(detailResponse.statusCode).toBe(200);
      expect(detailResponse.json().source.source_type).toBe("headline");
      expect(detailResponse.json().labels.tags).toContain("energy_loader");
      expect(detailResponse.json().labels.tags).toContain("opec_cut");
      expect(detailResponse.json().labels.primary_assets).toContain("CL=F");
      expect(detailResponse.json().labels.primary_assets).toContain("XLE");
      expect(detailResponse.json().labels.sectors).toContain("energy");
      expect(detailResponse.json().parsed_event.themes).toContain("energy");
      expect(detailResponse.json().parsed_event.themes).toContain("energy_supply");
      expect(detailResponse.json().review.review_hints.length).toBeGreaterThan(0);
      expect(detailResponse.json().review.reviewed_at).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("ingests credit and banking stress cases through the credit loader", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/credit-banking",
        payload: {
          items: [
            {
              case_id: "credit-loader-spread-widening",
              case_pack: "credit_loader_lab",
              event_type: "credit_spread_widening",
              signal_bias: "negative",
              institution: "US high-yield market",
              region: "united_states",
              focus_assets: ["HYG"],
              summary:
                "High-yield spreads widened sharply on funding concerns, weighing on lower-quality credit and financial risk appetite.",
              realized_moves: [
                { ticker: "HYG", realized_direction: "down", realized_magnitude_bp: -79 },
                { ticker: "LQD", realized_direction: "down", realized_magnitude_bp: -31 },
                { ticker: "XLF", realized_direction: "down", realized_magnitude_bp: -26 },
              ],
              timing_alignment: 0.8,
            },
          ],
          store_library: true,
          ingest_reviewed_memory: false,
          fallback_model_version: "credit-loader-test-v1",
        },
      });

      expect(ingestResponse.statusCode).toBe(201);
      expect(ingestResponse.json().ingested_cases).toBe(1);
      expect(ingestResponse.json().results[0].case_quality).toBe("draft");
      expect(ingestResponse.json().results[0].themes).toContain("credit_stress");
      expect(ingestResponse.json().results[0].primary_assets).toContain("HYG");

      const detailResponse = await app.inject({
        method: "GET",
        url: "/v1/ingestion/historical/library/credit-loader-spread-widening",
      });

      expect(detailResponse.statusCode).toBe(200);
      expect(detailResponse.json().labels.tags).toContain("credit_loader");
      expect(detailResponse.json().labels.tags).toContain("credit_spread_widening");
      expect(detailResponse.json().labels.primary_assets).toContain("HYG");
      expect(detailResponse.json().labels.primary_assets).toContain("LQD");
      expect(detailResponse.json().labels.sectors).toContain("financials");
      expect(detailResponse.json().parsed_event.themes).toContain("credit_stress");
      expect(detailResponse.json().review.review_hints.length).toBeGreaterThan(0);
      expect(detailResponse.json().review.reviewed_at).toBeNull();
    } finally {
      await app.close();
    }
  });

  it("builds replay diagnostics and applies a tuned model variant", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const registerResponse = await app.inject({
        method: "POST",
        url: "/v1/models",
        payload: {
          model_version: "macro-live-v1",
          family: "macro-live",
          label: "Macro live v1",
          status: "active",
          feature_flags: {
            strategy_profile: "macro_dovish_sensitive",
            confidence_bias: 0.02,
          },
        },
      });

      expect(registerResponse.statusCode).toBe(201);

      const replayPack = buildHistoricalReplayPack(["macro-live-v1"]);
      const diagnosticsResponse = await app.inject({
        method: "POST",
        url: "/v1/metrics/replay/diagnostics",
        payload: replayPack,
      });

      expect(diagnosticsResponse.statusCode).toBe(200);
      expect(diagnosticsResponse.json().case_count).toBe(12);
      expect(diagnosticsResponse.json().models).toHaveLength(1);
      expect(diagnosticsResponse.json().models[0].weakest_themes.length).toBeGreaterThan(0);
      expect(diagnosticsResponse.json().models[0].frequent_failure_tags.length).toBeGreaterThan(0);
      expect(diagnosticsResponse.json().models[0].recommended_tuning.rationale.length).toBeGreaterThan(0);
      expect(
        diagnosticsResponse.json().models[0].recommended_tuning.feature_flags_patch.strategy_profile,
      ).toBe("macro_dovish_sensitive");

      const tuneResponse = await app.inject({
        method: "POST",
        url: "/v1/models/macro-live-v1/tune-from-replay",
        payload: {
          cases: replayPack.cases,
          target_model_version: "macro-live-v1-replay-tuned",
        },
      });

      expect(tuneResponse.statusCode).toBe(201);
      expect(tuneResponse.json().saved_model.model_version).toBe("macro-live-v1-replay-tuned");
      expect(tuneResponse.json().saved_model.feature_flags.replay_tuned_from).toBe(
        "macro-live-v1",
      );
      expect(tuneResponse.json().saved_model.feature_flags.replay_case_pack).toBe("macro_v1");
      expect(tuneResponse.json().diagnostics.model_version).toBe("macro-live-v1");

      const savedModelResponse = await app.inject({
        method: "GET",
        url: "/v1/models/macro-live-v1-replay-tuned",
      });

      expect(savedModelResponse.statusCode).toBe(200);
      expect(savedModelResponse.json().feature_flags.replay_profile).toBe(
        "macro_dovish_sensitive",
      );
    } finally {
      await app.close();
    }
  });

  it("reuses successful promotion patterns as priors during replay tuning", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      for (const payload of [
        {
          model_version: "macro-live-v0",
          family: "macro-live",
          label: "Macro Live v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
        {
          model_version: "macro-live-v0-replay-tuned",
          family: "macro-live",
          label: "Macro Live v0 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "contrarian_regime_aware",
            confidence_bias: -0.05,
            confidence_cap: 0.84,
            conviction_bias: -0.04,
            focus_themes: "stimulus,rates",
            caution_themes: "trade_policy,inflation",
            preferred_assets: "TLT,QQQ",
            replay_tuned_from: "macro-live-v0",
          },
        },
        {
          model_version: "macro-live-v1",
          family: "macro-live",
          label: "Macro Live v1",
          status: "experimental",
          feature_flags: {
            strategy_profile: "macro_dovish_sensitive",
            confidence_bias: 0.02,
          },
        },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/v1/models",
          payload,
        });

        expect(response.statusCode).toBe(201);
      }

      const gateResponse = await app.inject({
        method: "POST",
        url: "/v1/models/macro-live-v0-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "macro-live-v0",
          cases: buildHistoricalReplayPack(
            ["macro-live-v0", "macro-live-v0-replay-tuned"],
            "macro_plus_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: -0.05,
            min_direction_accuracy_delta: -0.05,
            max_wrong_rate_delta: -0.2,
            min_calibration_alignment_delta: 0.05,
          },
          promote_on_pass: false,
        },
      });

      expect(gateResponse.statusCode).toBe(200);
      expect(gateResponse.json().passed).toBe(true);

      const tuneResponse = await app.inject({
        method: "POST",
        url: "/v1/models/macro-live-v1/tune-from-replay",
        payload: {
          cases: buildHistoricalReplayPack(["macro-live-v1"]).cases,
          target_model_version: "macro-live-v1-replay-tuned-with-priors",
        },
      });

      expect(tuneResponse.statusCode).toBe(201);
      expect(tuneResponse.json().applied_pattern_priors.family).toBe("macro-live");
      expect(tuneResponse.json().applied_pattern_priors.source_scope).toBe("family");
      expect(
        tuneResponse
          .json()
          .applied_pattern_priors.selected_patterns.map(
            (pattern: { pattern_key: string }) => pattern.pattern_key,
          ),
      ).toContain("profile:contrarian_regime_aware");
      expect(tuneResponse.json().saved_model.feature_flags.strategy_profile).toBe(
        "contrarian_regime_aware",
      );
      expect(tuneResponse.json().saved_model.feature_flags.replay_prior_family).toBe("macro-live");
      expect(tuneResponse.json().saved_model.feature_flags.replay_prior_patterns).toContain(
        "profile:contrarian_regime_aware",
      );
    } finally {
      await app.close();
    }
  });

  it("runs a governed molt cycle that generates and hardens a stronger shell when growth is needed", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      for (const payload of [
        {
          model_version: "macro-live-v0",
          family: "macro-live",
          label: "Macro Live v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
        {
          model_version: "macro-live-v1-replay-tuned",
          family: "macro-live",
          label: "Macro Live v1 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "contrarian_regime_aware",
            confidence_bias: -0.05,
            confidence_cap: 0.84,
            conviction_bias: -0.04,
            focus_themes: "stimulus,rates",
            caution_themes: "trade_policy,inflation",
            preferred_assets: "TLT,QQQ",
            replay_tuned_from: "macro-live-v0",
          },
        },
        {
          model_version: "macro-live-v2-replay-tuned",
          family: "macro-live",
          label: "Macro Live v2 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "macro_dovish_sensitive",
            replay_tuned_from: "macro-live-v0",
          },
        },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/v1/models",
          payload,
        });

        expect(response.statusCode).toBe(201);
      }

      const priorPassResponse = await app.inject({
        method: "POST",
        url: "/v1/models/macro-live-v1-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "macro-live-v0",
          cases: buildHistoricalReplayPack(
            ["macro-live-v0", "macro-live-v1-replay-tuned"],
            "macro_plus_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: -0.1,
            min_direction_accuracy_delta: -0.1,
            max_wrong_rate_delta: 0.15,
            min_calibration_alignment_delta: -0.1,
          },
        },
      });

      const priorFailResponse = await app.inject({
        method: "POST",
        url: "/v1/models/macro-live-v2-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "macro-live-v0",
          cases: buildHistoricalReplayPack(
            ["macro-live-v0", "macro-live-v2-replay-tuned"],
            "macro_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: 0.02,
            min_direction_accuracy_delta: 0,
            max_wrong_rate_delta: -0.05,
            min_calibration_alignment_delta: 0,
          },
        },
      });

      expect(priorPassResponse.statusCode).toBe(200);
      expect(priorPassResponse.json().passed).toBe(true);
      expect(priorFailResponse.statusCode).toBe(200);
      expect(priorFailResponse.json().passed).toBe(false);

      const moltResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/molt-cycle",
        payload: {
          case_pack: "macro_plus_v1",
          min_family_pass_rate: 0.75,
          score_floor: 0,
          max_abs_calibration_gap: 1,
          thresholds: {
            min_average_total_score_delta: -0.1,
            min_direction_accuracy_delta: -0.1,
            max_wrong_rate_delta: 0.15,
            min_calibration_alignment_delta: -0.1,
          },
        },
      });

      expect(moltResponse.statusCode).toBe(200);
      expect(moltResponse.json().considered).toBe(1);
      expect(moltResponse.json().triggered).toBe(1);
      expect(moltResponse.json().generated).toBe(1);
      expect(moltResponse.json().hardened).toBe(1);
      expect(moltResponse.json().held).toBe(0);

      const item = moltResponse.json().items[0];
      expect(item.family).toBe("macro-live");
      expect(item.baseline_model_version).toBe("macro-live-v1-replay-tuned");
      expect(item.target_model_version).toBe("macro-live-v1-replay-tuned-molt-1");
      expect(item.status).toBe("hardened");
      expect(item.applied_pattern_priors.selected_patterns.map(
        (pattern: { pattern_key: string }) => pattern.pattern_key,
      )).toContain("profile:contrarian_regime_aware");
      expect(item.saved_model.status).toBe("active");
      expect(item.saved_model.feature_flags.molt_last_decision).toBe("hardened");
      expect(item.saved_model.feature_flags.replay_prior_patterns).toContain(
        "profile:contrarian_regime_aware",
      );

      const savedModelResponse = await app.inject({
        method: "GET",
        url: "/v1/models/macro-live-v1-replay-tuned-molt-1",
      });

      expect(savedModelResponse.statusCode).toBe(200);
      expect(savedModelResponse.json().feature_flags.molt_cycle_status).toBe("hardened");
    } finally {
      await app.close();
    }
  });

  it("builds model lineage and recent molt history across generations", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      for (const payload of [
        {
          model_version: "macro-live-v0",
          family: "macro-live",
          label: "Macro Live v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
        {
          model_version: "macro-live-v1-replay-tuned",
          family: "macro-live",
          label: "Macro Live v1 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "contrarian_regime_aware",
            confidence_bias: -0.05,
            confidence_cap: 0.84,
            conviction_bias: -0.04,
            focus_themes: "stimulus,rates",
            caution_themes: "trade_policy,inflation",
            preferred_assets: "TLT,QQQ",
            replay_tuned_from: "macro-live-v0",
          },
        },
        {
          model_version: "macro-live-v2-replay-tuned",
          family: "macro-live",
          label: "Macro Live v2 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "macro_dovish_sensitive",
            replay_tuned_from: "macro-live-v0",
          },
        },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/v1/models",
          payload,
        });

        expect(response.statusCode).toBe(201);
      }

      await app.inject({
        method: "POST",
        url: "/v1/models/macro-live-v1-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "macro-live-v0",
          cases: buildHistoricalReplayPack(
            ["macro-live-v0", "macro-live-v1-replay-tuned"],
            "macro_plus_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: -0.05,
            min_direction_accuracy_delta: -0.05,
            max_wrong_rate_delta: -0.2,
            min_calibration_alignment_delta: 0.05,
          },
        },
      });

      await app.inject({
        method: "POST",
        url: "/v1/models/macro-live-v2-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "macro-live-v0",
          cases: buildHistoricalReplayPack(
            ["macro-live-v0", "macro-live-v2-replay-tuned"],
            "macro_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: 0.02,
            min_direction_accuracy_delta: 0,
            max_wrong_rate_delta: -0.05,
            min_calibration_alignment_delta: 0,
          },
        },
      });

      const moltResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/molt-cycle",
        payload: {
          case_pack: "macro_plus_v1",
          min_family_pass_rate: 0.75,
          score_floor: 0,
          max_abs_calibration_gap: 1,
          thresholds: {
            min_average_total_score_delta: -0.1,
            min_direction_accuracy_delta: -0.1,
            max_wrong_rate_delta: 0.15,
            min_calibration_alignment_delta: -0.1,
          },
        },
      });

      expect(moltResponse.statusCode).toBe(200);
      expect(moltResponse.json().hardened).toBe(1);

      const lineageResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/lineage",
      });

      expect(lineageResponse.statusCode).toBe(200);
      expect(lineageResponse.json().families).toHaveLength(1);
      expect(lineageResponse.json().recent_molts).toHaveLength(1);

      const family = lineageResponse.json().families[0];
      expect(family.family).toBe("macro-live");
      expect(family.root_model_version).toBe("macro-live-v0");
      expect(family.active_model_version).toBe("macro-live-v1-replay-tuned-molt-1");
      expect(family.generation_depth).toBe(2);
      expect(family.total_shells).toBe(4);

      const rootNode = family.lineage.find(
        (node: { model_version: string }) => node.model_version === "macro-live-v0",
      );
      const tunedNode = family.lineage.find(
        (node: { model_version: string }) => node.model_version === "macro-live-v1-replay-tuned",
      );
      const heldNode = family.lineage.find(
        (node: { model_version: string }) => node.model_version === "macro-live-v2-replay-tuned",
      );
      const moltNode = family.lineage.find(
        (node: { model_version: string }) =>
          node.model_version === "macro-live-v1-replay-tuned-molt-1",
      );

      expect(rootNode.origin_type).toBe("root");
      expect(rootNode.generation).toBe(0);
      expect(tunedNode.parent_model_version).toBe("macro-live-v0");
      expect(tunedNode.origin_type).toBe("replay_tuned");
      expect(heldNode.shell_state).toBe("held");
      expect(moltNode.parent_model_version).toBe("macro-live-v1-replay-tuned");
      expect(moltNode.origin_type).toBe("molted");
      expect(moltNode.shell_state).toBe("active");
      expect(moltNode.trigger_reasons.length).toBeGreaterThan(0);
      expect(moltNode.prior_patterns).toContain("profile:contrarian_regime_aware");

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Model lineage");
    } finally {
      await app.close();
    }
  });

  it("runs an evolution cycle and stores lineage snapshot history", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const modelResponse = await app.inject({
        method: "POST",
        url: "/v1/models",
        payload: {
          model_version: "macro-live-v0",
          family: "macro-live",
          label: "Macro Live v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
      });

      expect(modelResponse.statusCode).toBe(201);

      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/batch",
        payload: {
          items: [
            {
              source: {
                source_type: "headline",
                title: "Cooling inflation helps duration",
                raw_text:
                  "A cooler inflation print eased rate pressure and supported bonds and growth equities.",
              },
              horizon: "1d",
              realized_moves: [
                { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 88 },
                { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 97 },
              ],
              timing_alignment: 0.8,
              model_version: "macro-live-v0",
            },
          ],
        },
      });

      expect(ingestResponse.statusCode).toBe(201);

      const evolutionResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-cycle",
        payload: {
          run_molt_cycle: false,
        },
      });

      expect(evolutionResponse.statusCode).toBe(200);
      expect(evolutionResponse.json().self_audit.calibration_snapshot).not.toBeNull();
      expect(evolutionResponse.json().molt_cycle).toBeNull();
      expect(evolutionResponse.json().lineage_snapshot.family_count).toBe(1);
      expect(evolutionResponse.json().lineage_snapshot.total_shells).toBe(1);

      const lineageHistoryResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/lineage/history?limit=5",
      });

      expect(lineageHistoryResponse.statusCode).toBe(200);
      expect(lineageHistoryResponse.json().snapshots).toHaveLength(1);
      expect(lineageHistoryResponse.json().snapshots[0].family_count).toBe(1);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Evolution history");
    } finally {
      await app.close();
    }
  });

  it("persists evolution schedule config and runs only due scheduled work", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const modelResponse = await app.inject({
        method: "POST",
        url: "/v1/models",
        payload: {
          model_version: "macro-live-v0",
          family: "macro-live",
          label: "Macro Live v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
      });

      expect(modelResponse.statusCode).toBe(201);

      const corpusResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/core-corpus",
        payload: {
          ingest_reviewed_memory: false,
        },
      });

      expect(corpusResponse.statusCode).toBe(201);
      expect(corpusResponse.json().stored_library_items).toBeGreaterThan(20);
      expect(corpusResponse.json().domain_breakdown).toHaveLength(6);

      const scheduleResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-schedule",
        payload: {
          run_molt_cycle: false,
          benchmark_pack_id: "core_benchmark_lite_v1",
          benchmark_snapshot_interval_hours: 24,
          self_audit_interval_hours: 24,
          lineage_snapshot_interval_hours: 24,
        },
      });

      expect(scheduleResponse.statusCode).toBe(200);
      expect(scheduleResponse.json().run_molt_cycle).toBe(false);
      expect(scheduleResponse.json().benchmark_pack_id).toBe("core_benchmark_lite_v1");

      const scheduledRunResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-schedule/run",
        payload: {
          as_of: "2030-01-01T00:00:00.000Z",
        },
      });

      expect(scheduledRunResponse.statusCode).toBe(200);
      expect(scheduledRunResponse.json().ran).toBe(true);
      expect(scheduledRunResponse.json().due.self_audit).toBe(true);
      expect(scheduledRunResponse.json().due.benchmark_snapshot).toBe(true);
      expect(scheduledRunResponse.json().due.benchmark_trust_refresh).toBe(true);
      expect(scheduledRunResponse.json().due.molt_cycle).toBe(false);
      expect(scheduledRunResponse.json().trust_refresh).not.toBeNull();
      expect(scheduledRunResponse.json().trust_refresh.benchmark_snapshot).not.toBeNull();
      expect(scheduledRunResponse.json().trust_refresh.benchmark_snapshot.benchmark_pack_id).toBe(
        "core_benchmark_lite_v1",
      );
      expect(scheduledRunResponse.json().result.lineage_snapshot.family_count).toBe(1);
      expect(scheduledRunResponse.json().schedule.last_result.ran_self_audit).toBe(true);
      expect(scheduledRunResponse.json().schedule.last_result.ran_benchmark_trust_refresh).toBe(
        true,
      );
      expect(scheduledRunResponse.json().schedule.last_result.captured_benchmark_snapshot).toBe(
        true,
      );
      expect(
        scheduledRunResponse.json().schedule.last_result.benchmark_snapshot_case_count,
      ).toBeGreaterThan(0);

      const scheduleDetailResponse = await app.inject({
        method: "GET",
        url: "/v1/operations/evolution-schedule",
      });

      expect(scheduleDetailResponse.statusCode).toBe(200);
      expect(scheduleDetailResponse.json().last_run_at).toBe("2030-01-01T00:00:00.000Z");
      expect(scheduleDetailResponse.json().next_benchmark_snapshot_at).toBe(
        "2030-01-02T00:00:00.000Z",
      );

      const lineageHistoryResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/lineage/history?limit=5",
      });

      expect(lineageHistoryResponse.statusCode).toBe(200);
      expect(lineageHistoryResponse.json().snapshots).toHaveLength(1);
    } finally {
      await app.close();
    }
  });

  it("builds family evolution trends and growth-pressure alerts", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      for (const payload of [
        {
          model_version: "policy-shock-v0",
          family: "policy-shock",
          label: "Policy Shock v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
        {
          model_version: "policy-shock-v1-replay-tuned",
          family: "policy-shock",
          label: "Policy Shock v1 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "policy_shock_sensitive",
            replay_tuned_from: "policy-shock-v0",
          },
        },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/v1/models",
          payload,
        });

        expect(response.statusCode).toBe(201);
      }

      const firstEvolutionResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-cycle",
        payload: {
          run_molt_cycle: false,
        },
      });

      expect(firstEvolutionResponse.statusCode).toBe(200);

      const failedGateResponse = await app.inject({
        method: "POST",
        url: "/v1/models/policy-shock-v1-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "policy-shock-v0",
          cases: buildHistoricalReplayPack(
            ["policy-shock-v0", "policy-shock-v1-replay-tuned"],
            "macro_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: 0.02,
            min_direction_accuracy_delta: 0,
            max_wrong_rate_delta: -0.05,
            min_calibration_alignment_delta: 0,
          },
        },
      });

      expect(failedGateResponse.statusCode).toBe(200);
      expect(failedGateResponse.json().passed).toBe(false);

      const secondEvolutionResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-cycle",
        payload: {
          run_molt_cycle: false,
        },
      });

      expect(secondEvolutionResponse.statusCode).toBe(200);

      const trendResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/evolution/trends",
      });

      expect(trendResponse.statusCode).toBe(200);
      expect(trendResponse.json().sample_count).toBeGreaterThanOrEqual(2);
      expect(trendResponse.json().families).toHaveLength(1);
      expect(trendResponse.json().families[0].family).toBe("policy-shock");
      expect(trendResponse.json().families[0].total_shells).toBe(2);
      expect(trendResponse.json().families[0].generation_depth).toBe(1);

      const alertResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/evolution/alerts",
      });

      expect(alertResponse.statusCode).toBe(200);
      expect(alertResponse.json().alerts.length).toBeGreaterThan(0);
      expect(alertResponse.json().alerts[0].family).toBe("policy-shock");
      expect(alertResponse.json().alerts[0].signals.join(" ")).toContain("recent pass rate");

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Evolution trends");
      expect(opsPageResponse.body).toContain("Growth pressure");
    } finally {
      await app.close();
    }
  });

  it("persists growth-pressure policies, alert episodes, and approval-gated candidate shells", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      for (const payload of [
        {
          model_version: "policy-shock-v0",
          family: "policy-shock",
          label: "Policy Shock v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
        {
          model_version: "policy-shock-v1-replay-tuned",
          family: "policy-shock",
          label: "Policy Shock v1 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "policy_shock_sensitive",
            replay_tuned_from: "policy-shock-v0",
          },
        },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/v1/models",
          payload,
        });

        expect(response.statusCode).toBe(201);
      }

      const policyResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution/alert-policies",
        payload: {
          family: "policy-shock",
          persistence: {
            medium_persistent_cycles: 1,
            high_persistent_cycles: 1,
            candidate_generation_cycles: 2,
          },
          actions: {
            diagnostics_case_pack: "macro_plus_v1",
            auto_queue_diagnostics: true,
            auto_schedule_molt_review: true,
            require_operator_approval_for_candidate_generation: true,
          },
        },
      });

      expect(policyResponse.statusCode).toBe(200);

      const policyListResponse = await app.inject({
        method: "GET",
        url: "/v1/operations/evolution/alert-policies",
      });

      expect(policyListResponse.statusCode).toBe(200);
      expect(policyListResponse.json().policies).toHaveLength(1);
      expect(policyListResponse.json().policies[0].family).toBe("policy-shock");

      const failedGateResponse = await app.inject({
        method: "POST",
        url: "/v1/models/policy-shock-v1-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "policy-shock-v0",
          cases: buildHistoricalReplayPack(
            ["policy-shock-v0", "policy-shock-v1-replay-tuned"],
            "macro_plus_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: 0.5,
            min_direction_accuracy_delta: 0.4,
            max_wrong_rate_delta: -0.2,
            min_calibration_alignment_delta: 0.25,
          },
        },
      });

      expect(failedGateResponse.statusCode).toBe(200);
      expect(failedGateResponse.json().passed).toBe(false);

      const firstCycleResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-cycle",
        payload: {
          as_of: "2031-01-01T00:00:00.000Z",
          run_molt_cycle: false,
        },
      });

      expect(firstCycleResponse.statusCode).toBe(200);
      expect(firstCycleResponse.json().growth_pressure.counts.open).toBe(1);
      expect(
        firstCycleResponse.json().growth_pressure.action_plans.some(
          (plan: { action_type: string; status: string }) =>
            plan.action_type === "run_replay_diagnostics" && plan.status === "executed",
        ),
      ).toBe(true);

      const secondCycleResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-cycle",
        payload: {
          as_of: "2031-01-02T00:00:00.000Z",
          run_molt_cycle: false,
        },
      });

      expect(secondCycleResponse.statusCode).toBe(200);

      const alertHistoryResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/evolution/alerts/history?family=policy-shock&limit=5",
      });

      expect(alertHistoryResponse.statusCode).toBe(200);
      expect(alertHistoryResponse.json().alerts).toHaveLength(1);
      expect(alertHistoryResponse.json().alerts[0].persistence_count).toBe(2);

      const actionHistoryResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/evolution/actions?family=policy-shock&limit=10",
      });

      expect(actionHistoryResponse.statusCode).toBe(200);
      const pendingCandidate = actionHistoryResponse
        .json()
        .actions.find(
          (action: { action_type: string; status: string }) =>
            action.action_type === "generate_candidate_shell" && action.status === "pending",
        );
      expect(pendingCandidate).toBeTruthy();

      const approveResponse = await app.inject({
        method: "POST",
        url: `/v1/operations/evolution/actions/${pendingCandidate.id}/approve`,
      });

      expect(approveResponse.statusCode).toBe(200);
      expect(approveResponse.json().status).toBe("executed");
      expect(approveResponse.json().candidate_model_version).toContain("policy-shock-v0-pressure-");

      const candidateModelResponse = await app.inject({
        method: "GET",
        url: `/v1/models/${approveResponse.json().candidate_model_version}`,
      });

      expect(candidateModelResponse.statusCode).toBe(200);
      expect(candidateModelResponse.json().status).toBe("experimental");

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Alert timeline");
      expect(opsPageResponse.body).toContain("Pending actions");
    } finally {
      await app.close();
    }
  });

  it("runs growth-pressure responses through the schedule and keeps operator controls durable", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      for (const payload of [
        {
          model_version: "macro-live-v0",
          family: "macro-live",
          label: "Macro Live v0",
          status: "active",
          feature_flags: {
            strategy_profile: "macro_dovish_sensitive",
          },
        },
        {
          model_version: "macro-live-v1-replay-tuned",
          family: "macro-live",
          label: "Macro Live v1 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "contrarian_regime_aware",
            replay_tuned_from: "macro-live-v0",
          },
        },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/v1/models",
          payload,
        });

        expect(response.statusCode).toBe(201);
      }

      const failedGateResponse = await app.inject({
        method: "POST",
        url: "/v1/models/macro-live-v1-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "macro-live-v0",
          cases: buildHistoricalReplayPack(
            ["macro-live-v0", "macro-live-v1-replay-tuned"],
            "macro_plus_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: 0.6,
            min_direction_accuracy_delta: 0.5,
            max_wrong_rate_delta: -0.25,
            min_calibration_alignment_delta: 0.3,
          },
        },
      });

      expect(failedGateResponse.statusCode).toBe(200);
      expect(failedGateResponse.json().passed).toBe(false);

      const scheduleUpdateResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-schedule",
        payload: {
          enabled: true,
          run_molt_cycle: false,
          self_audit_interval_hours: 24,
          molt_interval_hours: 168,
          lineage_snapshot_interval_hours: 24,
        },
      });

      expect(scheduleUpdateResponse.statusCode).toBe(200);

      const scheduledRunResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-schedule/run",
        payload: {
          as_of: "2032-01-01T00:00:00.000Z",
        },
      });

      expect(scheduledRunResponse.statusCode).toBe(200);
      expect(scheduledRunResponse.json().ran).toBe(true);
      expect(scheduledRunResponse.json().result.growth_pressure.counts.open).toBe(1);
      expect(scheduledRunResponse.json().schedule.last_result.open_growth_alerts).toBe(1);

      const alertHistoryResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/evolution/alerts/history?family=macro-live&limit=5",
      });

      expect(alertHistoryResponse.statusCode).toBe(200);
      expect(alertHistoryResponse.json().alerts).toHaveLength(1);
      const alertId = alertHistoryResponse.json().alerts[0].id as string;

      const acknowledgeResponse = await app.inject({
        method: "POST",
        url: `/v1/operations/evolution/alerts/${alertId}/acknowledge`,
      });

      expect(acknowledgeResponse.statusCode).toBe(200);
      expect(acknowledgeResponse.json().status).toBe("acknowledged");

      const snoozeResponse = await app.inject({
        method: "POST",
        url: `/v1/operations/evolution/alerts/${alertId}/snooze`,
        payload: {
          duration_hours: 12,
        },
      });

      expect(snoozeResponse.statusCode).toBe(200);
      expect(snoozeResponse.json().status).toBe("snoozed");
      expect(snoozeResponse.json().snoozed_until).toBeTruthy();

      const handleResponse = await app.inject({
        method: "POST",
        url: `/v1/operations/evolution/alerts/${alertId}/handle`,
      });

      expect(handleResponse.statusCode).toBe(200);
      expect(handleResponse.json().status).toBe("handled");

      const refreshedHistoryResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/evolution/alerts/history?family=macro-live&limit=5",
      });

      expect(refreshedHistoryResponse.statusCode).toBe(200);
      expect(refreshedHistoryResponse.json().alerts[0].status).toBe("handled");
    } finally {
      await app.close();
    }
  });

  it("evaluates replay promotion gates and only promotes passing model variants", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      for (const payload of [
        {
          model_version: "impact-engine-v0",
          family: "impact-engine",
          label: "Impact Engine v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
        {
          model_version: "macro-live-v1",
          family: "macro-live",
          label: "Macro Live v1",
          status: "experimental",
          feature_flags: {
            strategy_profile: "macro_dovish_sensitive",
          },
        },
        {
          model_version: "contrarian-regime-v1",
          family: "contrarian-regime",
          label: "Contrarian Regime v1",
          status: "experimental",
          feature_flags: {
            strategy_profile: "contrarian_regime_aware",
          },
        },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/v1/models",
          payload,
        });

        expect(response.statusCode).toBe(201);
      }

      const failGateResponse = await app.inject({
        method: "POST",
        url: "/v1/models/macro-live-v1/promotion-gate",
        payload: {
          baseline_model_version: "impact-engine-v0",
          cases: buildHistoricalReplayPack(["impact-engine-v0", "macro-live-v1"]).cases,
          thresholds: {
            min_average_total_score_delta: 0.02,
            min_direction_accuracy_delta: 0,
            max_wrong_rate_delta: -0.05,
            min_calibration_alignment_delta: 0,
          },
        },
      });

      expect(failGateResponse.statusCode).toBe(200);
      expect(failGateResponse.json().passed).toBe(false);
      expect(failGateResponse.json().saved_model.status).toBe("experimental");
      expect(failGateResponse.json().saved_model.feature_flags.promotion_last_decision).toBe(
        "failed",
      );

      const passGateResponse = await app.inject({
        method: "POST",
        url: "/v1/models/contrarian-regime-v1/promotion-gate",
        payload: {
          baseline_model_version: "impact-engine-v0",
          cases: buildHistoricalReplayPack(
            ["impact-engine-v0", "contrarian-regime-v1"],
            "macro_plus_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: -0.05,
            min_direction_accuracy_delta: -0.05,
            max_wrong_rate_delta: -0.2,
            min_calibration_alignment_delta: 0.05,
          },
        },
      });

      expect(passGateResponse.statusCode).toBe(200);
      expect(passGateResponse.json().case_count).toBe(20);
      expect(passGateResponse.json().passed).toBe(true);
      expect(passGateResponse.json().saved_model.status).toBe("active");
      expect(passGateResponse.json().saved_model.feature_flags.promotion_last_decision).toBe(
        "passed",
      );
      expect(passGateResponse.json().deltas.calibration_alignment).toBeGreaterThan(0);

      const promotionHistoryResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/promotions?limit=5",
      });

      expect(promotionHistoryResponse.statusCode).toBe(200);
      expect(promotionHistoryResponse.json().evaluations).toHaveLength(2);
      expect(promotionHistoryResponse.json().evaluations[0].created_at).toBeTruthy();
    } finally {
      await app.close();
    }
  });

  it("runs an automatic promotion cycle and stores ranked promotion history", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const baselineResponse = await app.inject({
        method: "POST",
        url: "/v1/models",
        payload: {
          model_version: "impact-engine-v0",
          family: "impact-engine",
          label: "Impact Engine v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
      });

      const candidateResponse = await app.inject({
        method: "POST",
        url: "/v1/models",
        payload: {
          model_version: "impact-engine-v1-replay-tuned",
          family: "impact-engine",
          label: "Impact Engine v1 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "contrarian_regime_aware",
            replay_tuned_from: "impact-engine-v0",
          },
        },
      });

      expect(baselineResponse.statusCode).toBe(201);
      expect(candidateResponse.statusCode).toBe(201);

      const cycleResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/promotion-cycle",
        payload: {
          case_pack: "macro_plus_v1",
          max_candidates: 5,
          thresholds: {
            min_average_total_score_delta: -0.05,
            min_direction_accuracy_delta: -0.05,
            max_wrong_rate_delta: -0.2,
            min_calibration_alignment_delta: 0.05,
          },
        },
      });

      expect(cycleResponse.statusCode).toBe(200);
      expect(cycleResponse.json().processed).toBe(1);
      expect(cycleResponse.json().candidates[0].candidate_model_version).toBe(
        "impact-engine-v1-replay-tuned",
      );
      expect(cycleResponse.json().evaluations[0].passed).toBe(true);
      expect(cycleResponse.json().evaluations[0].saved_model.status).toBe("active");

      const promotionHistoryResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/promotions?limit=5",
      });

      expect(promotionHistoryResponse.statusCode).toBe(200);
      expect(promotionHistoryResponse.json().evaluations[0].candidate_model_version).toBe(
        "impact-engine-v1-replay-tuned",
      );

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Promotion history");
    } finally {
      await app.close();
    }
  });

  it("builds family-level promotion analytics with pass-rate trends and leaders", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      for (const payload of [
        {
          model_version: "impact-engine-v0",
          family: "impact-engine",
          label: "Impact Engine v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
        {
          model_version: "impact-engine-v1-replay-tuned",
          family: "impact-engine",
          label: "Impact Engine v1 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "contrarian_regime_aware",
            replay_tuned_from: "impact-engine-v0",
          },
        },
        {
          model_version: "impact-engine-v2-replay-tuned",
          family: "impact-engine",
          label: "Impact Engine v2 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "macro_dovish_sensitive",
            replay_tuned_from: "impact-engine-v0",
          },
        },
        {
          model_version: "macro-live-v0",
          family: "macro-live",
          label: "Macro Live v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
        {
          model_version: "macro-live-v1-replay-tuned",
          family: "macro-live",
          label: "Macro Live v1 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "contrarian_regime_aware",
            replay_tuned_from: "macro-live-v0",
          },
        },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/v1/models",
          payload,
        });

        expect(response.statusCode).toBe(201);
      }

      const impactPassResponse = await app.inject({
        method: "POST",
        url: "/v1/models/impact-engine-v1-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "impact-engine-v0",
          cases: buildHistoricalReplayPack(
            ["impact-engine-v0", "impact-engine-v1-replay-tuned"],
            "macro_plus_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: -0.05,
            min_direction_accuracy_delta: -0.05,
            max_wrong_rate_delta: -0.2,
            min_calibration_alignment_delta: 0.05,
          },
        },
      });

      const impactFailResponse = await app.inject({
        method: "POST",
        url: "/v1/models/impact-engine-v2-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "impact-engine-v0",
          cases: buildHistoricalReplayPack(
            ["impact-engine-v0", "impact-engine-v2-replay-tuned"],
            "macro_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: 0.02,
            min_direction_accuracy_delta: 0,
            max_wrong_rate_delta: -0.05,
            min_calibration_alignment_delta: 0,
          },
        },
      });

      const macroPassResponse = await app.inject({
        method: "POST",
        url: "/v1/models/macro-live-v1-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "macro-live-v0",
          cases: buildHistoricalReplayPack(
            ["macro-live-v0", "macro-live-v1-replay-tuned"],
            "macro_plus_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: -0.05,
            min_direction_accuracy_delta: -0.05,
            max_wrong_rate_delta: -0.2,
            min_calibration_alignment_delta: 0.05,
          },
        },
      });

      expect(impactPassResponse.statusCode).toBe(200);
      expect(impactPassResponse.json().passed).toBe(true);
      expect(impactFailResponse.statusCode).toBe(200);
      expect(impactFailResponse.json().passed).toBe(false);
      expect(macroPassResponse.statusCode).toBe(200);
      expect(macroPassResponse.json().passed).toBe(true);

      const analyticsResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/promotions/analytics",
      });

      expect(analyticsResponse.statusCode).toBe(200);
      expect(analyticsResponse.json().sample_count).toBe(3);
      expect(analyticsResponse.json().families).toHaveLength(2);
      expect(analyticsResponse.json().leaders.by_pass_rate).toBe("macro-live");

      const impactFamily = analyticsResponse
        .json()
        .families.find((item: { family: string }) => item.family === "impact-engine");
      const macroFamily = analyticsResponse
        .json()
        .families.find((item: { family: string }) => item.family === "macro-live");

      expect(impactFamily.evaluated_count).toBe(2);
      expect(impactFamily.pass_rate).toBe(0.5);
      expect(impactFamily.trend_signal).toBe("declining");
      expect(impactFamily.prior_pass_rate).toBe(1);
      expect(impactFamily.recent_pass_rate).toBe(0);
      expect(macroFamily.pass_rate).toBe(1);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Promotion families");
    } finally {
      await app.close();
    }
  });

  it("ranks replay tuning patterns from promotion history", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      for (const payload of [
        {
          model_version: "impact-engine-v0",
          family: "impact-engine",
          label: "Impact Engine v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
        {
          model_version: "impact-engine-v1-replay-tuned",
          family: "impact-engine",
          label: "Impact Engine v1 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "contrarian_regime_aware",
            confidence_bias: -0.05,
            confidence_cap: 0.84,
            conviction_bias: -0.04,
            focus_themes: "stimulus,rates",
            caution_themes: "trade_policy,inflation",
            preferred_assets: "TLT,QQQ",
            replay_tuned_from: "impact-engine-v0",
          },
        },
        {
          model_version: "macro-live-v0",
          family: "macro-live",
          label: "Macro Live v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
        {
          model_version: "macro-live-v1-replay-tuned",
          family: "macro-live",
          label: "Macro Live v1 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "contrarian_regime_aware",
            confidence_bias: -0.05,
            confidence_cap: 0.84,
            conviction_bias: -0.04,
            focus_themes: "stimulus,rates",
            caution_themes: "trade_policy,inflation",
            preferred_assets: "TLT,QQQ",
            replay_tuned_from: "macro-live-v0",
          },
        },
        {
          model_version: "policy-shock-v0",
          family: "policy-shock",
          label: "Policy Shock v0",
          status: "active",
          feature_flags: {
            strategy_profile: "policy_shock_sensitive",
          },
        },
        {
          model_version: "policy-shock-v1-replay-tuned",
          family: "policy-shock",
          label: "Policy Shock v1 replay tuned",
          status: "experimental",
          feature_flags: {
            strategy_profile: "policy_shock_sensitive",
            confidence_bias: 0.04,
            magnitude_multiplier: 1.12,
            preferred_assets: "KWEB,BABA",
            replay_tuned_from: "policy-shock-v0",
          },
        },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/v1/models",
          payload,
        });

        expect(response.statusCode).toBe(201);
      }

      const firstPass = await app.inject({
        method: "POST",
        url: "/v1/models/impact-engine-v1-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "impact-engine-v0",
          cases: buildHistoricalReplayPack(
            ["impact-engine-v0", "impact-engine-v1-replay-tuned"],
            "macro_plus_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: -0.05,
            min_direction_accuracy_delta: -0.05,
            max_wrong_rate_delta: -0.2,
            min_calibration_alignment_delta: 0.05,
          },
        },
      });

      const secondPass = await app.inject({
        method: "POST",
        url: "/v1/models/macro-live-v1-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "macro-live-v0",
          cases: buildHistoricalReplayPack(
            ["macro-live-v0", "macro-live-v1-replay-tuned"],
            "macro_plus_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: -0.05,
            min_direction_accuracy_delta: -0.05,
            max_wrong_rate_delta: -0.2,
            min_calibration_alignment_delta: 0.05,
          },
        },
      });

      const failResponse = await app.inject({
        method: "POST",
        url: "/v1/models/policy-shock-v1-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "policy-shock-v0",
          cases: buildHistoricalReplayPack(
            ["policy-shock-v0", "policy-shock-v1-replay-tuned"],
            "macro_v1",
          ).cases,
          thresholds: {
            min_average_total_score_delta: 0.02,
            min_direction_accuracy_delta: 0,
            max_wrong_rate_delta: -0.05,
            min_calibration_alignment_delta: 0,
          },
        },
      });

      expect(firstPass.statusCode).toBe(200);
      expect(secondPass.statusCode).toBe(200);
      expect(failResponse.statusCode).toBe(200);

      const patternResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/promotions/patterns",
      });

      expect(patternResponse.statusCode).toBe(200);
      expect(patternResponse.json().sample_count).toBe(3);
      expect(patternResponse.json().patterns.length).toBeGreaterThan(0);
      expect(patternResponse.json().leaders.by_pass_rate).toBe(
        "profile:contrarian_regime_aware",
      );

      const profilePattern = patternResponse
        .json()
        .patterns.find(
          (item: { pattern_key: string }) => item.pattern_key === "profile:contrarian_regime_aware",
        );
      const confidencePattern = patternResponse
        .json()
        .patterns.find(
          (item: { pattern_key: string }) => item.pattern_key === "confidence_bias:negative",
        );

      expect(profilePattern.pass_rate).toBe(1);
      expect(profilePattern.families).toEqual(["impact-engine", "macro-live"]);
      expect(confidencePattern.pass_rate).toBe(1);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Tuning patterns");
    } finally {
      await app.close();
    }
  });

  it("pulls RSS feed items and skips duplicates on repeat pulls", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    const originalFetch = globalThis.fetch;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Finance Wire</title>
          <item>
            <title>China stimulus lifts risk appetite</title>
            <link>https://example.com/china-stimulus</link>
            <description>Officials signaled broader support for China growth and risk appetite improved across equities.</description>
            <pubDate>Thu, 12 Mar 2026 10:00:00 GMT</pubDate>
          </item>
          <item>
            <title>Hot inflation print rattles growth</title>
            <link>https://example.com/hot-inflation</link>
            <description>A hotter inflation print pushed yields higher and pressured growth stocks.</description>
            <pubDate>Thu, 12 Mar 2026 11:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`;

    globalThis.fetch = vi.fn(async () =>
      new Response(xml, {
        status: 200,
        headers: {
          "content-type": "application/rss+xml",
        },
      })) as typeof fetch;

    try {
      const firstPullResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/feeds/pull",
        payload: {
          feeds: [
            {
              url: "https://example.com/feed.xml",
              publisher: "Finance Wire",
              max_items: 2,
            },
          ],
          parse_events: true,
        },
      });

      expect(firstPullResponse.statusCode).toBe(201);
      expect(firstPullResponse.json().ingested_sources).toBe(2);
      expect(firstPullResponse.json().duplicate_sources).toBe(0);
      expect(firstPullResponse.json().ingested_events).toBe(2);

      const secondPullResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/feeds/pull",
        payload: {
          feeds: [
            {
              url: "https://example.com/feed.xml",
              publisher: "Finance Wire",
              max_items: 2,
            },
          ],
          parse_events: true,
        },
      });

      expect(secondPullResponse.statusCode).toBe(201);
      expect(secondPullResponse.json().ingested_sources).toBe(0);
      expect(secondPullResponse.json().duplicate_sources).toBe(2);
    } finally {
      globalThis.fetch = originalFetch;
      await app.close();
    }
  });

  it("pulls transcript documents and parses long-form policy events", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    const originalFetch = globalThis.fetch;
    const html = `<!DOCTYPE html>
      <html>
        <head>
          <title>Donald Trump BBC Interview Transcript</title>
          <meta property="og:site_name" content="BBC Business" />
          <meta property="article:published_time" content="2026-03-12T12:00:00Z" />
        </head>
        <body>
          <article>
            <h1>Donald Trump on tariffs and China</h1>
            <p>Donald Trump: Tariffs on China could rise further if trade restrictions remain in place.</p>
            <p>He said the yuan has been weakening and Chinese tech stocks may face more pressure.</p>
            <p>He added that markets should expect a harder trade-policy stance.</p>
          </article>
        </body>
      </html>`;

    globalThis.fetch = vi.fn(async () =>
      new Response(html, {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      })) as typeof fetch;

    try {
      const firstPullResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/transcripts/pull",
        payload: {
          items: [
            {
              url: "https://example.com/trump-bbc-transcript",
              source_type: "speech",
              speaker: "Donald Trump",
              publisher: "BBC Business",
              max_chars: 4000,
            },
          ],
          parse_events: true,
        },
      });

      expect(firstPullResponse.statusCode).toBe(201);
      expect(firstPullResponse.json().ingested_sources).toBe(1);
      expect(firstPullResponse.json().ingested_events).toBe(1);

      const sourceId = firstPullResponse.json().results[0].source_id as string;
      const eventId = firstPullResponse.json().results[0].event_id as string;
      const storedSource = await repository.getSource(sourceId);
      const storedEvent = await repository.getEvent(eventId);

      expect(storedSource?.source_type).toBe("speech");
      expect(storedSource?.raw_uri).toBe("https://example.com/trump-bbc-transcript");
      expect(storedEvent?.event_class).toBe("policy_speech");
      expect(storedEvent?.themes).toContain("trade_policy");

      const duplicateResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/transcripts/pull",
        payload: {
          items: [
            {
              url: "https://example.com/trump-bbc-transcript",
              source_type: "speech",
              speaker: "Donald Trump",
              publisher: "BBC Business",
              max_chars: 4000,
            },
          ],
          parse_events: true,
        },
      });

      expect(duplicateResponse.statusCode).toBe(201);
      expect(duplicateResponse.json().ingested_sources).toBe(0);
      expect(duplicateResponse.json().duplicate_sources).toBe(1);
    } finally {
      globalThis.fetch = originalFetch;
      await app.close();
    }
  });

  it("queues feed and transcript pulls through the worker boundary when requested", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    const originalFetch = globalThis.fetch;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
      <rss version="2.0">
        <channel>
          <title>Finance Wire</title>
          <item>
            <title>China stimulus lifts risk appetite</title>
            <link>https://example.com/china-stimulus</link>
            <description>Officials signaled broader support for China growth and risk appetite improved across equities.</description>
            <pubDate>Thu, 12 Mar 2026 10:00:00 GMT</pubDate>
          </item>
        </channel>
      </rss>`;
    const html = `<!DOCTYPE html>
      <html>
        <body>
          <article>
            <h1>Donald Trump on tariffs and China</h1>
            <p>Donald Trump: Tariffs on China could rise further if trade restrictions remain in place.</p>
            <p>He said the yuan has been weakening and Chinese tech stocks may face more pressure.</p>
          </article>
        </body>
      </html>`;

    globalThis.fetch = vi.fn(async (input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      if (url.includes("feed.xml")) {
        return new Response(xml, {
          status: 200,
          headers: {
            "content-type": "application/rss+xml",
          },
        });
      }

      return new Response(html, {
        status: 200,
        headers: {
          "content-type": "text/html",
        },
      });
    }) as typeof fetch;

    try {
      const feedQueueResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/feeds/pull?execution=queued",
        headers: {
          "idempotency-key": "feed-queue-test",
        },
        payload: {
          feeds: [
            {
              url: "https://example.com/feed.xml",
              publisher: "Finance Wire",
              max_items: 1,
            },
          ],
          parse_events: true,
        },
      });

      const transcriptQueueResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/transcripts/pull?execution=queued",
        headers: {
          "idempotency-key": "transcript-queue-test",
        },
        payload: {
          items: [
            {
              url: "https://example.com/trump-bbc-transcript",
              source_type: "speech",
              speaker: "Donald Trump",
              publisher: "BBC Business",
              max_chars: 4000,
            },
          ],
          parse_events: true,
        },
      });

      expect(feedQueueResponse.statusCode).toBe(202);
      expect(feedQueueResponse.json().operation_name).toBe("feed_pull");
      expect(transcriptQueueResponse.statusCode).toBe(202);
      expect(transcriptQueueResponse.json().operation_name).toBe("transcript_pull");

      const queueBeforeResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/queue?limit=10",
      });

      expect(queueBeforeResponse.statusCode).toBe(200);
      expect(queueBeforeResponse.json().counts.pending).toBe(2);

      const drainResult = await drainOperationJobs(
        {
          repository,
          marketDataProvider: new MockMarketDataProvider(),
          embeddingProvider: new LocalEmbeddingProvider(),
        },
        {
          worker_id: "ingestion-worker",
          max_jobs: 2,
          retry_delay_seconds: 30,
        },
      );

      expect(drainResult.processed).toBe(2);
      expect(drainResult.completed).toBe(2);
      expect(drainResult.retried).toBe(0);

      const jobsResponse = await app.inject({
        method: "GET",
        url: "/v1/operations/jobs?limit=10",
      });

      expect(jobsResponse.statusCode).toBe(200);
      expect(
        jobsResponse
          .json()
          .jobs.some(
            (job: Record<string, unknown>) =>
              job.operation_name === "feed_pull" && job.status === "completed",
          ),
      ).toBe(true);
      expect(
        jobsResponse
          .json()
          .jobs.some(
            (job: Record<string, unknown>) =>
              job.operation_name === "transcript_pull" && job.status === "completed",
          ),
      ).toBe(true);

      expect(await repository.getSourceByRawUri("https://example.com/china-stimulus")).not.toBeNull();
      expect(
        await repository.getSourceByRawUri("https://example.com/trump-bbc-transcript"),
      ).not.toBeNull();
    } finally {
      globalThis.fetch = originalFetch;
      await app.close();
    }
  });

  it("runs live transcript sessions with rolling analysis and close semantics", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const historicalResponse = await app.inject({
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

      expect(historicalResponse.statusCode).toBe(201);

      const sessionResponse = await app.inject({
        method: "POST",
        url: "/v1/transcript-sessions",
        payload: {
          source_type: "speech",
          title: "Live Powell remarks",
          speaker: "Jerome Powell",
          publisher: "Macro Wire",
          raw_uri: "https://example.com/live-powell",
          model_version: "macro-live-v1",
          horizons: ["1h", "1d"],
          rolling_window_chars: 3000,
        },
      });

      expect(sessionResponse.statusCode).toBe(201);
      const session = sessionResponse.json();

      const firstChunkResponse = await app.inject({
        method: "POST",
        url: `/v1/transcript-sessions/${session.id}/chunks`,
        payload: {
          text: "Jerome Powell said the Fed is prepared to consider rate cuts if inflation continues to cool.",
        },
      });

      expect(firstChunkResponse.statusCode).toBe(201);
      expect(firstChunkResponse.json().chunk_count).toBe(1);
      expect(firstChunkResponse.json().parsed_event.event_class).toBe("policy_speech");
      expect(firstChunkResponse.json().predictions.length).toBe(2);

      const secondChunkResponse = await app.inject({
        method: "POST",
        url: `/v1/transcript-sessions/${session.id}/chunks`,
        payload: {
          text: "He added that labor conditions and bond yields matter for the timing of further easing, and the dollar could react as expectations shift.",
        },
      });

      expect(secondChunkResponse.statusCode).toBe(201);
      expect(secondChunkResponse.json().chunk_count).toBe(2);
      expect(secondChunkResponse.json().analogs.length).toBeGreaterThan(0);
      expect(secondChunkResponse.json().highlights.length).toBeGreaterThan(0);

      const analysisResponse = await app.inject({
        method: "GET",
        url: `/v1/transcript-sessions/${session.id}/analysis`,
      });

      expect(analysisResponse.statusCode).toBe(200);
      expect(analysisResponse.json().session_id).toBe(session.id);

      const closeResponse = await app.inject({
        method: "POST",
        url: `/v1/transcript-sessions/${session.id}/close`,
      });

      expect(closeResponse.statusCode).toBe(200);
      expect(closeResponse.json().session.status).toBe("closed");
      expect(closeResponse.json().chunk_count).toBe(2);

      const closedAppendResponse = await app.inject({
        method: "POST",
        url: `/v1/transcript-sessions/${session.id}/chunks`,
        payload: {
          text: "This should not be accepted after close.",
        },
      });

      expect(closedAppendResponse.statusCode).toBe(409);
    } finally {
      await app.close();
    }
  });

  it("ingests provider webhooks into live transcript sessions with durable stream bindings", async () => {
    repository = new InMemoryRepository();
    const originalSecret = process.env.LIVE_INGEST_WEBHOOK_SECRET;
    const originalBufferMinChars = process.env.LIVE_INGEST_BUFFER_MIN_CHARS;
    const originalBufferMaxFragments = process.env.LIVE_INGEST_BUFFER_MAX_FRAGMENTS;
    const originalDeepgramTokens = process.env.DEEPGRAM_CALLBACK_TOKENS;
    const originalAssemblyHeaderName = process.env.ASSEMBLYAI_WEBHOOK_HEADER_NAME;
    const originalAssemblyHeaderValue = process.env.ASSEMBLYAI_WEBHOOK_HEADER_VALUE;

    process.env.LIVE_INGEST_WEBHOOK_SECRET = "superbrain-secret";
    process.env.LIVE_INGEST_BUFFER_MIN_CHARS = "220";
    process.env.LIVE_INGEST_BUFFER_MAX_FRAGMENTS = "2";
    process.env.DEEPGRAM_CALLBACK_TOKENS = "dg-live-allowed";
    process.env.ASSEMBLYAI_WEBHOOK_HEADER_NAME = "x-assembly-key";
    process.env.ASSEMBLYAI_WEBHOOK_HEADER_VALUE = "assembly-live-allowed";

    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const unauthorizedResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/live/webhooks/generic",
        payload: {
          stream_key: "powell-live-001",
          text: "Jerome Powell said the Fed could adjust policy if inflation cools.",
        },
      });

      expect(unauthorizedResponse.statusCode).toBe(401);

      const firstWebhookResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/live/webhooks/generic",
        headers: {
          "x-finance-superbrain-secret": "superbrain-secret",
        },
        payload: {
          stream_key: "powell-live-001",
          source_type: "speech",
          title: "Live Powell remarks",
          speaker: "Jerome Powell",
          publisher: "Macro Wire",
          model_version: "macro-live-webhook-v1",
          horizons: ["1h", "1d"],
          text: "Jerome Powell said the Fed is prepared to consider rate cuts if inflation continues to cool.",
          is_final: true,
        },
      });

      expect(firstWebhookResponse.statusCode).toBe(202);
      expect(firstWebhookResponse.json().binding_status).toBe("created");
      expect(firstWebhookResponse.json().event_status).toBe("buffered");
      expect(firstWebhookResponse.json().chunk_appended).toBe(false);
      expect(firstWebhookResponse.json().buffered_fragments).toBe(1);
      expect(firstWebhookResponse.json().buffered_chars).toBeGreaterThan(0);
      const powellSessionId = firstWebhookResponse.json().session_id as string;

      const partialWebhookResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/live/webhooks/generic",
        headers: {
          "x-finance-superbrain-secret": "superbrain-secret",
        },
        payload: {
          stream_key: "powell-live-001",
          text: "Markets are listening closely for yield guidance.",
          is_final: false,
        },
      });

      expect(partialWebhookResponse.statusCode).toBe(202);
      expect(partialWebhookResponse.json().binding_status).toBe("reused");
      expect(partialWebhookResponse.json().event_status).toBe("ignored_partial");
      expect(partialWebhookResponse.json().session_id).toBe(powellSessionId);

      const secondWebhookResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/live/webhooks/generic",
        headers: {
          "x-finance-superbrain-secret": "superbrain-secret",
        },
        payload: {
          stream_key: "powell-live-001",
          text: "He added that yields and the dollar could react as easing expectations shift.",
          final: true,
        },
      });

      expect(secondWebhookResponse.statusCode).toBe(201);
      expect(secondWebhookResponse.json().binding_status).toBe("reused");
      expect(secondWebhookResponse.json().event_status).toBe("appended");
      expect(secondWebhookResponse.json().session_id).toBe(powellSessionId);
      expect(secondWebhookResponse.json().latest_analysis.predictions.length).toBe(2);
      expect(secondWebhookResponse.json().buffered_fragments).toBe(0);

      const closeWebhookResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/live/webhooks/generic",
        headers: {
          "x-finance-superbrain-secret": "superbrain-secret",
        },
        payload: {
          stream_key: "powell-live-001",
          close_session: true,
        },
      });

      expect(closeWebhookResponse.statusCode).toBe(202);
      expect(closeWebhookResponse.json().event_status).toBe("closed");
      expect(closeWebhookResponse.json().session_status).toBe("closed");

      const deepgramUnauthorizedResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/live/webhooks/deepgram",
        payload: {
          type: "Results",
          is_final: true,
          metadata: {
            request_id: "deepgram-trump-001",
          },
          channel: {
            alternatives: [
              {
                transcript:
                  "Donald Trump said tariffs on China could rise further and that markets should expect a harder trade-policy stance.",
              },
            ],
          },
        },
      });

      expect(deepgramUnauthorizedResponse.statusCode).toBe(401);

      const deepgramWebhookResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/live/webhooks/deepgram",
        headers: {
          "dg-token": "dg-live-allowed",
        },
        payload: {
          type: "Results",
          is_final: true,
          metadata: {
            request_id: "deepgram-trump-001",
            title: "Trump BBC live hit",
            speaker: "Donald Trump",
            publisher: "BBC Business",
          },
          channel: {
            alternatives: [
              {
                transcript:
                  "Donald Trump said tariffs on China could rise further, that markets should expect a harder trade-policy stance, and that investors need to prepare for more volatility across global equities and currencies as the policy path toughens.",
              },
            ],
          },
        },
      });

      expect(deepgramWebhookResponse.statusCode).toBe(201);
      expect(deepgramWebhookResponse.json().binding_status).toBe("created");
      expect(deepgramWebhookResponse.json().latest_analysis.predictions.length).toBeGreaterThan(0);

      const assemblyUnauthorizedResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/live/webhooks/assemblyai",
        payload: {
          session_id: "assembly-stream-001",
          message_type: "FinalTranscript",
          text:
            "A strong jobs print could keep yields higher and pressure growth assets if markets keep repricing the path of cuts.",
        },
      });

      expect(assemblyUnauthorizedResponse.statusCode).toBe(401);

      const assemblyWebhookResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/live/webhooks/assemblyai",
        headers: {
          "x-assembly-key": "assembly-live-allowed",
        },
        payload: {
          session_id: "assembly-stream-001",
          message_type: "FinalTranscript",
          title: "Assembly macro pulse",
          speaker: "Macro Narrator",
          publisher: "AssemblyAI",
          text:
            "A strong jobs print could keep yields higher and pressure growth assets if markets keep repricing the path of cuts, while the dollar and long-duration bonds may remain especially sensitive if labor data keeps surprising to the upside.",
        },
      });

      expect(assemblyWebhookResponse.statusCode).toBe(201);
      expect(assemblyWebhookResponse.json().binding_status).toBe("created");
      expect(assemblyWebhookResponse.json().latest_analysis.predictions.length).toBeGreaterThan(0);

      const powellSessionDetail = await app.inject({
        method: "GET",
        url: `/v1/transcript-sessions/${powellSessionId}`,
      });

      expect(powellSessionDetail.statusCode).toBe(200);
      expect(powellSessionDetail.json().session.status).toBe("closed");
      expect(powellSessionDetail.json().chunk_count).toBe(1);

      const dashboardResponse = await app.inject({
        method: "GET",
        url: "/v1/dashboard/summary",
      });

      expect(dashboardResponse.statusCode).toBe(200);
      expect(dashboardResponse.json().live_streams.recent_bindings.length).toBe(3);
      expect(dashboardResponse.json().live_streams.active_bindings).toBe(2);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Live streams");
    } finally {
      process.env.LIVE_INGEST_WEBHOOK_SECRET = originalSecret;
      process.env.LIVE_INGEST_BUFFER_MIN_CHARS = originalBufferMinChars;
      process.env.LIVE_INGEST_BUFFER_MAX_FRAGMENTS = originalBufferMaxFragments;
      process.env.DEEPGRAM_CALLBACK_TOKENS = originalDeepgramTokens;
      process.env.ASSEMBLYAI_WEBHOOK_HEADER_NAME = originalAssemblyHeaderName;
      process.env.ASSEMBLYAI_WEBHOOK_HEADER_VALUE = originalAssemblyHeaderValue;
      await app.close();
    }
  });

  it(
    "persists reviewed memory across pglite restarts",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "finance-superbrain-pglite-"));

      try {
      const firstApp = await buildApp({
        repository: createPGliteRepository(dataDir),
        marketDataProvider: new MockMarketDataProvider(),
      });

      try {
        const ingestResponse = await firstApp.inject({
          method: "POST",
          url: "/v1/ingestion/historical/batch",
          payload: {
            items: [
              {
                source: {
                  source_type: "headline",
                  title: "China tech pressured by weaker yuan",
                  raw_text:
                    "Renewed tariff rhetoric and a weaker yuan pressured Chinese tech names and boosted defensive USD positioning.",
                },
                horizon: "1d",
                realized_moves: [
                  { ticker: "KWEB", realized_direction: "down", realized_magnitude_bp: -143 },
                  { ticker: "USD/CNH", realized_direction: "up", realized_magnitude_bp: 26 },
                ],
                timing_alignment: 0.81,
              },
            ],
          },
        });

        expect(ingestResponse.statusCode).toBe(201);
        expect(ingestResponse.json().ingested).toBe(1);
      } finally {
        await firstApp.close();
      }

      const secondApp = await buildApp({
        repository: createPGliteRepository(dataDir),
        marketDataProvider: new MockMarketDataProvider(),
      });

      try {
        const dashboardResponse = await secondApp.inject({
          method: "GET",
          url: "/v1/dashboard/summary",
        });

        expect(dashboardResponse.statusCode).toBe(200);
        expect(dashboardResponse.json().totals.lessons).toBe(1);
        expect(dashboardResponse.json().totals.reviewed).toBe(1);

        const lessonSearchResponse = await secondApp.inject({
          method: "GET",
          url: "/v1/lessons/search?q=weaker yuan china tech pressure",
        });

        expect(lessonSearchResponse.statusCode).toBe(200);
        expect(lessonSearchResponse.json().results.length).toBeGreaterThan(0);
      } finally {
        await secondApp.close();
      }
    } finally {
      await rm(dataDir, { recursive: true, force: true });
    }
    },
    60000,
  );

  it(
    "persists evolution schedules across pglite restarts",
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), "finance-superbrain-pglite-schedule-"));

      try {
        const firstApp = await buildApp({
          repository: createPGliteRepository(dataDir),
          marketDataProvider: new MockMarketDataProvider(),
        });

        try {
          const modelResponse = await firstApp.inject({
            method: "POST",
            url: "/v1/models",
            payload: {
              model_version: "impact-engine-v0",
              family: "core-brain",
              label: "Impact Engine v0",
              status: "active",
              feature_flags: {
                strategy_profile: "baseline",
              },
            },
          });

          expect(modelResponse.statusCode).toBe(201);

          const corpusResponse = await firstApp.inject({
            method: "POST",
            url: "/v1/ingestion/historical/core-corpus",
            payload: {
              ingest_reviewed_memory: false,
            },
          });

          expect(corpusResponse.statusCode).toBe(201);
          expect(corpusResponse.json().stored_library_items).toBeGreaterThan(20);

          const scheduleResponse = await firstApp.inject({
            method: "POST",
            url: "/v1/operations/evolution-schedule",
            payload: {
              benchmark_pack_id: "core_benchmark_lite_v1",
              run_molt_cycle: false,
              benchmark_snapshot_interval_hours: 24,
              benchmark_trust_refresh_interval_hours: 24,
              self_audit_interval_hours: 24,
              lineage_snapshot_interval_hours: 24,
            },
          });

          expect(scheduleResponse.statusCode).toBe(200);
          expect(scheduleResponse.json().next_benchmark_trust_refresh_at).toBeTruthy();
        } finally {
          await firstApp.close();
        }

        const secondApp = await buildApp({
          repository: createPGliteRepository(dataDir),
          marketDataProvider: new MockMarketDataProvider(),
        });

        try {
          const scheduleDetailResponse = await secondApp.inject({
            method: "GET",
            url: "/v1/operations/evolution-schedule",
          });

          expect(scheduleDetailResponse.statusCode).toBe(200);
          expect(scheduleDetailResponse.json().benchmark_pack_id).toBe("core_benchmark_lite_v1");
          expect(scheduleDetailResponse.json().next_benchmark_trust_refresh_at).toBeTruthy();

          const scheduledRunResponse = await secondApp.inject({
            method: "POST",
            url: "/v1/operations/evolution-schedule/run",
            payload: {
              as_of: "2030-01-01T00:00:00.000Z",
            },
          });

          expect(scheduledRunResponse.statusCode).toBe(200);
          expect(scheduledRunResponse.json().ran).toBe(true);
          expect(scheduledRunResponse.json().due.benchmark_trust_refresh).toBe(true);
          expect(scheduledRunResponse.json().trust_refresh).not.toBeNull();
          expect(
            scheduledRunResponse.json().trust_refresh.after.high_confidence_cases,
          ).toBeGreaterThan(0);
          expect(
            scheduledRunResponse.json().trust_refresh.delta.high_confidence_cases,
          ).toBeGreaterThan(0);
          expect(
            scheduledRunResponse.json().schedule.last_result.ran_benchmark_trust_refresh,
          ).toBe(true);
        } finally {
          await secondApp.close();
        }
      } finally {
        await rm(dataDir, { recursive: true, force: true });
      }
    },
    60000,
  );

  it("composes and replays a mixed benchmark pack from the trusted historical library", async () => {
    repository = new InMemoryRepository();
    await repository.saveModelVersion({
      model_version: "macro-live-v0",
      family: "macro-live",
      label: "Macro live baseline",
      status: "active",
      feature_flags: {},
    });
    await repository.saveModelVersion({
      model_version: "macro-live-v1-replay-tuned",
      family: "macro-live",
      label: "Macro live candidate",
      status: "experimental",
      feature_flags: {
        replay_tuned_from: "macro-live-v0",
      },
    });

    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const loaderRequests = [
        {
          url: "/v1/ingestion/historical/macro-calendar",
          payload: {
            items: [
              {
                case_id: "benchmark-macro-cpi-cooler",
                case_pack: "macro_calendar_test_v1",
                event_type: "cpi",
                signal_bias: "cooler",
                summary:
                  "Inflation cooled enough to lift bonds, weaken the dollar, and support long-duration equities.",
                realized_moves: [
                  { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 52 },
                  { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 71 },
                  { ticker: "DXY", realized_direction: "down", realized_magnitude_bp: -24 },
                ],
                timing_alignment: 0.81,
                labels: {
                  case_quality: "reviewed",
                },
              },
            ],
            store_library: true,
            ingest_reviewed_memory: false,
          },
        },
        {
          url: "/v1/ingestion/historical/earnings",
          payload: {
            items: [
              {
                case_id: "benchmark-earnings-ai-upside",
                case_pack: "earnings_test_v1",
                event_type: "ai_capex_upside",
                signal_bias: "positive",
                company: "NVIDIA",
                ticker: "NVDA",
                sector: "semiconductors",
                peers: ["SOXX", "SMH"],
                summary:
                  "Management highlighted stronger AI demand and better supply visibility across the next few quarters.",
                realized_moves: [
                  { ticker: "NVDA", realized_direction: "up", realized_magnitude_bp: 121 },
                  { ticker: "SOXX", realized_direction: "up", realized_magnitude_bp: 84 },
                  { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 36 },
                ],
                timing_alignment: 0.8,
                labels: {
                  case_quality: "reviewed",
                },
              },
            ],
            store_library: true,
            ingest_reviewed_memory: false,
          },
        },
        {
          url: "/v1/ingestion/historical/policy-fx",
          payload: {
            items: [
              {
                case_id: "benchmark-policy-yen-intervention",
                case_pack: "policy_fx_test_v1",
                event_type: "fx_intervention",
                signal_bias: "supportive",
                country: "Japan",
                region: "asia",
                currency_pair: "USD/JPY",
                focus_assets: ["EWJ"],
                summary:
                  "Officials intervened to support the yen after disorderly depreciation, shifting sentiment across Japan-sensitive assets.",
                realized_moves: [
                  { ticker: "USD/JPY", realized_direction: "down", realized_magnitude_bp: -133 },
                  { ticker: "EWJ", realized_direction: "down", realized_magnitude_bp: -28 },
                  { ticker: "DXY", realized_direction: "down", realized_magnitude_bp: -16 },
                ],
                timing_alignment: 0.76,
                labels: {
                  case_quality: "reviewed",
                },
              },
            ],
            store_library: true,
            ingest_reviewed_memory: false,
          },
        },
        {
          url: "/v1/ingestion/historical/energy",
          payload: {
            items: [
              {
                case_id: "benchmark-energy-opec-cut",
                case_pack: "energy_test_v1",
                event_type: "opec_cut",
                signal_bias: "bullish",
                market: "crude_oil",
                region: "middle_east",
                producer: "OPEC+",
                focus_assets: ["XLE", "XOM"],
                summary:
                  "A surprise output cut tightened crude balances, lifted oil, and supported energy equities.",
                realized_moves: [
                  { ticker: "CL=F", realized_direction: "up", realized_magnitude_bp: 137 },
                  { ticker: "XLE", realized_direction: "up", realized_magnitude_bp: 63 },
                  { ticker: "XOM", realized_direction: "up", realized_magnitude_bp: 49 },
                ],
                timing_alignment: 0.84,
                labels: {
                  case_quality: "reviewed",
                },
              },
            ],
            store_library: true,
            ingest_reviewed_memory: false,
          },
        },
        {
          url: "/v1/ingestion/historical/credit-banking",
          payload: {
            items: [
              {
                case_id: "benchmark-credit-bank-run",
                case_pack: "credit_test_v1",
                event_type: "bank_run",
                signal_bias: "negative",
                institution: "Regional banking system",
                region: "united_states",
                focus_assets: ["KRE", "XLF"],
                summary:
                  "Deposit flight and forced asset sales triggered bank-run stress and a sharp safe-haven response.",
                realized_moves: [
                  { ticker: "KRE", realized_direction: "down", realized_magnitude_bp: -158 },
                  { ticker: "XLF", realized_direction: "down", realized_magnitude_bp: -69 },
                  { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 88 },
                ],
                timing_alignment: 0.86,
                labels: {
                  case_quality: "reviewed",
                },
              },
            ],
            store_library: true,
            ingest_reviewed_memory: false,
          },
        },
      ];

      for (const requestConfig of loaderRequests) {
        const response = await app.inject({
          method: "POST",
          url: requestConfig.url,
          payload: requestConfig.payload,
        });

        expect(response.statusCode).toBe(201);
        expect(response.json().stored_library_items).toBe(1);
      }

      const packListResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/replay/benchmark-packs",
      });

      expect(packListResponse.statusCode).toBe(200);
      expect(
        packListResponse.json().packs.some((item: { pack_id: string }) => item.pack_id === "core_benchmark_lite_v1"),
      ).toBe(true);

      const composeResponse = await app.inject({
        method: "POST",
        url: "/v1/metrics/replay/benchmark-packs/compose",
        payload: {
          model_versions: ["macro-live-v0", "macro-live-v1-replay-tuned"],
          benchmark_pack_id: "core_benchmark_lite_v1",
        },
      });

      expect(composeResponse.statusCode).toBe(200);
      expect(composeResponse.json().pack_id).toBe("core_benchmark_lite_v1");
      expect(composeResponse.json().quotas_met).toBe(true);
      expect(composeResponse.json().selected_case_count).toBe(5);

      const incompleteComposeResponse = await app.inject({
        method: "POST",
        url: "/v1/metrics/replay/benchmark-packs/compose",
        payload: {
          model_versions: ["macro-live-v0", "macro-live-v1-replay-tuned"],
          benchmark_pack_id: "core_benchmark_v1",
        },
      });

      expect(incompleteComposeResponse.statusCode).toBe(409);
      expect(incompleteComposeResponse.json().composition.quotas_met).toBe(false);

      const replayResponse = await app.inject({
        method: "POST",
        url: "/v1/metrics/replay/benchmark-packs/run",
        payload: {
          model_versions: ["macro-live-v0", "macro-live-v1-replay-tuned"],
          benchmark_pack_id: "core_benchmark_lite_v1",
        },
      });

      expect(replayResponse.statusCode).toBe(200);
      expect(replayResponse.json().case_pack).toBe("core_benchmark_lite_v1");
      expect(replayResponse.json().case_count).toBe(5);

      const gateResponse = await app.inject({
        method: "POST",
        url: "/v1/models/macro-live-v1-replay-tuned/promotion-gate",
        payload: {
          baseline_model_version: "macro-live-v0",
          benchmark_pack_id: "core_benchmark_lite_v1",
          thresholds: {
            min_average_total_score_delta: -1,
            min_direction_accuracy_delta: -1,
            max_wrong_rate_delta: 1,
            min_calibration_alignment_delta: -1,
          },
          promote_on_pass: false,
        },
      });

      expect(gateResponse.statusCode).toBe(200);
      expect(gateResponse.json().case_pack).toBe("core_benchmark_lite_v1");

      const promotionCycleResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/promotion-cycle",
        payload: {
          benchmark_pack_id: "core_benchmark_lite_v1",
          max_candidates: 5,
          thresholds: {
            min_average_total_score_delta: -1,
            min_direction_accuracy_delta: -1,
            max_wrong_rate_delta: 1,
            min_calibration_alignment_delta: -1,
          },
          promote_on_pass: false,
        },
      });

      expect(promotionCycleResponse.statusCode).toBe(200);
      expect(promotionCycleResponse.json().benchmark_pack_id).toBe("core_benchmark_lite_v1");
      expect(promotionCycleResponse.json().processed).toBe(1);
    } finally {
      await app.close();
    }
  });

  it("captures benchmark history and surfaces regression alerts across snapshots", async () => {
    repository = new InMemoryRepository();
    await repository.saveModelVersion({
      model_version: "contrarian-regime-v1",
      family: "core-brain",
      label: "Core brain contrarian",
      status: "active",
      feature_flags: {},
    });

    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const ingestResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/library",
        payload: {
          items: [
            {
              case_id: "history-macro",
              case_pack: "history_macro_v1",
              source: {
                source_type: "headline",
                title: "Cooling inflation supports duration",
                raw_text: "Cooling inflation lifted bonds and long-duration equities.",
              },
              horizon: "1d",
              realized_moves: [
                { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 49 },
                { ticker: "QQQ", realized_direction: "up", realized_magnitude_bp: 67 },
              ],
              timing_alignment: 0.8,
              labels: {
                event_family: "cpi_release",
                tags: ["macro"],
                regimes: ["macro_rates"],
                regions: ["united_states"],
                sectors: ["technology"],
                primary_themes: ["inflation"],
                primary_assets: ["TLT", "QQQ"],
                case_quality: "reviewed",
              },
            },
            {
              case_id: "history-earnings",
              case_pack: "history_earnings_v1",
              source: {
                source_type: "earnings",
                title: "AI capex commentary surprises higher",
                raw_text: "Management highlighted stronger AI demand and better supply visibility.",
              },
              horizon: "1d",
              realized_moves: [
                { ticker: "NVDA", realized_direction: "up", realized_magnitude_bp: 118 },
                { ticker: "SOXX", realized_direction: "up", realized_magnitude_bp: 81 },
              ],
              timing_alignment: 0.79,
              labels: {
                event_family: "ai_capex_upside",
                tags: ["earnings"],
                regimes: ["earnings"],
                regions: ["united_states"],
                sectors: ["technology"],
                primary_themes: ["ai_and_semis"],
                primary_assets: ["NVDA", "SOXX"],
                case_quality: "reviewed",
              },
            },
            {
              case_id: "history-policy",
              case_pack: "history_policy_v1",
              source: {
                source_type: "headline",
                title: "FX intervention steadies the yen",
                raw_text: "Officials intervened in FX markets to stabilize the yen.",
              },
              horizon: "1d",
              realized_moves: [
                { ticker: "USD/JPY", realized_direction: "down", realized_magnitude_bp: -121 },
                { ticker: "EWJ", realized_direction: "down", realized_magnitude_bp: -24 },
              ],
              timing_alignment: 0.77,
              labels: {
                event_family: "fx_intervention",
                tags: ["policy_fx"],
                regimes: ["policy_shock"],
                regions: ["japan"],
                sectors: ["financials"],
                primary_themes: ["fx_policy"],
                primary_assets: ["USD/JPY", "EWJ"],
                case_quality: "reviewed",
              },
            },
            {
              case_id: "history-energy",
              case_pack: "history_energy_v1",
              source: {
                source_type: "headline",
                title: "OPEC cut lifts crude",
                raw_text: "A surprise output cut tightened crude balances and lifted energy assets.",
              },
              horizon: "1d",
              realized_moves: [
                { ticker: "CL=F", realized_direction: "up", realized_magnitude_bp: 132 },
                { ticker: "XLE", realized_direction: "up", realized_magnitude_bp: 58 },
              ],
              timing_alignment: 0.82,
              labels: {
                event_family: "opec_cut",
                tags: ["energy"],
                regimes: ["commodities"],
                regions: ["middle_east"],
                sectors: ["energy"],
                primary_themes: ["energy", "energy_supply"],
                primary_assets: ["CL=F", "XLE"],
                case_quality: "reviewed",
              },
            },
            {
              case_id: "history-credit",
              case_pack: "history_credit_v1",
              source: {
                source_type: "headline",
                title: "Bank-run stress hits regional banks",
                raw_text: "Deposit flight triggered bank-run stress and a safe-haven rally.",
              },
              horizon: "1d",
              realized_moves: [
                { ticker: "KRE", realized_direction: "down", realized_magnitude_bp: -149 },
                { ticker: "TLT", realized_direction: "up", realized_magnitude_bp: 84 },
              ],
              timing_alignment: 0.85,
              labels: {
                event_family: "bank_run",
                tags: ["credit_banking"],
                regimes: ["financial_stress"],
                regions: ["united_states"],
                sectors: ["financials"],
                primary_themes: ["banking_stress"],
                primary_assets: ["KRE", "TLT"],
                case_quality: "reviewed",
              },
            },
          ],
          store_library: true,
          ingest_reviewed_memory: false,
          fallback_model_version: "historical-library-test-v1",
        },
      });

      expect(ingestResponse.statusCode).toBe(201);
      expect(ingestResponse.json().stored_library_items).toBe(5);

      const firstSnapshotResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/benchmark-snapshot",
        payload: {
          benchmark_pack_id: "core_benchmark_lite_v1",
          as_of: "2026-01-05T00:00:00.000Z",
        },
      });

      expect(firstSnapshotResponse.statusCode).toBe(201);
      expect(firstSnapshotResponse.json().benchmark_pack_id).toBe("core_benchmark_lite_v1");
      expect(firstSnapshotResponse.json().family_count).toBe(1);

      await repository.saveModelVersion({
        model_version: "contrarian-regime-v1",
        family: "core-brain",
        label: "Core brain contrarian",
        status: "archived",
        feature_flags: {},
      });
      await repository.saveModelVersion({
        model_version: "impact-engine-v0",
        family: "core-brain",
        label: "Core brain baseline",
        status: "active",
        feature_flags: {},
      });

      const secondSnapshotResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/benchmark-snapshot",
        payload: {
          benchmark_pack_id: "core_benchmark_lite_v1",
          as_of: "2026-01-12T00:00:00.000Z",
        },
      });

      expect(secondSnapshotResponse.statusCode).toBe(201);
      expect(secondSnapshotResponse.json().report.families[0].model_version).toBe(
        "impact-engine-v0",
      );

      const thirdSnapshotResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/benchmark-snapshot",
        payload: {
          benchmark_pack_id: "core_benchmark_lite_v1",
          as_of: "2026-01-19T00:00:00.000Z",
        },
      });

      expect(thirdSnapshotResponse.statusCode).toBe(201);

      const historyResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/benchmarks/history?benchmark_pack_id=core_benchmark_lite_v1",
      });

      expect(historyResponse.statusCode).toBe(200);
      expect(historyResponse.json().snapshots).toHaveLength(3);

      const trendResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/benchmarks/trends?benchmark_pack_id=core_benchmark_lite_v1",
      });

      expect(trendResponse.statusCode).toBe(200);
      expect(trendResponse.json().sample_count).toBe(3);
      expect(trendResponse.json().families[0].family).toBe("core-brain");

      const regressionResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/benchmarks/regressions?benchmark_pack_id=core_benchmark_lite_v1",
      });

      expect(regressionResponse.statusCode).toBe(200);
      expect(regressionResponse.json().alerts.length).toBeGreaterThan(0);
      expect(regressionResponse.json().alerts[0].family).toBe("core-brain");
      expect(regressionResponse.json().alerts[0].regression_streak).toBe(2);
      expect(regressionResponse.json().alerts[0].signals.join(" ")).toContain(
        "consecutive checkpoints",
      );

      const benchmarkDashboardResponse = await app.inject({
        method: "GET",
        url: "/v1/dashboard/benchmarks?benchmark_pack_id=core_benchmark_lite_v1",
      });

      expect(benchmarkDashboardResponse.statusCode).toBe(200);
      expect(benchmarkDashboardResponse.json().latest_snapshot).not.toBeNull();
      expect(benchmarkDashboardResponse.json().family_comparisons[0].family).toBe(
        "core-brain",
      );
      expect(benchmarkDashboardResponse.json().family_comparisons[0].regression_streak).toBe(2);
      expect(benchmarkDashboardResponse.json().regressions.length).toBeGreaterThan(0);
      expect(benchmarkDashboardResponse.json().benchmark_stability.sample_count).toBe(3);
      expect(benchmarkDashboardResponse.json().benchmark_stability.week_count).toBe(3);
      expect(benchmarkDashboardResponse.json().warnings.length).toBeGreaterThan(0);

      const stabilityResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/benchmarks/stability?benchmark_pack_id=core_benchmark_lite_v1",
      });

      expect(stabilityResponse.statusCode).toBe(200);
      expect(stabilityResponse.json().sample_count).toBe(3);
      expect(stabilityResponse.json().week_count).toBe(3);
      expect(stabilityResponse.json().families[0].family).toBe("core-brain");
      expect(stabilityResponse.json().families[0].weekly_rollups).toHaveLength(3);
      expect(stabilityResponse.json().families[0].stability_score).toBeGreaterThan(0);

      const growthAlertResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/evolution/alerts?benchmark_pack_id=core_benchmark_lite_v1",
      });

      expect(growthAlertResponse.statusCode).toBe(200);
      expect(growthAlertResponse.json().alerts[0].signals.join(" ")).toContain(
        "consecutive checkpoints",
      );

      const evolutionResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-cycle",
        payload: {
          benchmark_pack_id: "core_benchmark_lite_v1",
          create_postmortems: false,
          capture_calibration_snapshot: false,
          run_molt_cycle: false,
          capture_lineage_snapshot: false,
        },
      });

      expect(evolutionResponse.statusCode).toBe(200);
      expect(evolutionResponse.json().benchmark_snapshot).not.toBeNull();
      expect(evolutionResponse.json().growth_pressure.alerts.length).toBeGreaterThan(0);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Benchmark mission control");
      expect(opsPageResponse.body).toContain("Benchmark alerts");
      expect(opsPageResponse.body).toContain("Benchmark stability");
      expect(opsPageResponse.body).toContain("Benchmark trust warnings");
      expect(opsPageResponse.body).toContain("Benchmark trust refreshes");
      } finally {
        await app.close();
      }
    });

  it("runs walk-forward replay on dated historical library cases", async () => {
    repository = new InMemoryRepository();

    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const modelResponse = await app.inject({
        method: "POST",
        url: "/v1/models",
        payload: {
          model_version: "impact-engine-v0",
          family: "core-brain",
          label: "Impact Engine v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
      });

      expect(modelResponse.statusCode).toBe(201);

      const corpusResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/core-corpus",
        payload: {
          ingest_reviewed_memory: false,
        },
      });

      expect(corpusResponse.statusCode).toBe(201);
      expect(corpusResponse.json().stored_library_items).toBe(49);

      const gapResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/historical-library/gaps",
      });

      expect(gapResponse.statusCode).toBe(200);
      expect(
        gapResponse
          .json()
          .alerts.some((alert: Record<string, unknown>) => alert.target === "fx_intervention"),
      ).toBe(false);

      const walkForwardResponse = await app.inject({
        method: "POST",
        url: "/v1/metrics/replay/walk-forward",
        payload: {
          model_versions: ["impact-engine-v0"],
          benchmark_pack_id: "core_benchmark_v1",
          case_pack_filters: ["macro_calendar_v1", "earnings_v1", "policy_fx_v1"],
          min_train_cases: 6,
          test_window_size: 3,
          step_size: 3,
        },
      });

      expect(walkForwardResponse.statusCode).toBe(200);
      expect(walkForwardResponse.json().eligible_case_count).toBe(19);
      expect(walkForwardResponse.json().eligible_regime_count).toBeGreaterThanOrEqual(3);
      expect(walkForwardResponse.json().eligible_high_confidence_case_count).toBe(0);
      expect(walkForwardResponse.json().undated_case_count).toBe(0);
      expect(walkForwardResponse.json().window_count).toBe(4);
      expect(walkForwardResponse.json().windows[0].seeded_training_memory_count).toBe(6);
      expect(
        walkForwardResponse.json().windows[0].train_end_at.localeCompare(
          walkForwardResponse.json().windows[0].test_start_at,
        ),
      ).toBeLessThan(
        0,
      );
      expect(walkForwardResponse.json().models[0].case_count).toBe(12);
      expect(
        walkForwardResponse
          .json()
          .regimes.some((item: Record<string, unknown>) => item.regime === "fx_intervention"),
      ).toBe(true);
      expect(walkForwardResponse.json().leaders.by_average_total_score).toBe("impact-engine-v0");
    } finally {
      await app.close();
    }
  });

  it("stores walk-forward promotion evidence and surfaces it in the benchmark dashboard", async () => {
    repository = new InMemoryRepository();

    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const baselineResponse = await app.inject({
        method: "POST",
        url: "/v1/models",
        payload: {
          model_version: "impact-engine-v0",
          family: "core-brain",
          label: "Impact Engine v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
      });

      const candidateResponse = await app.inject({
        method: "POST",
        url: "/v1/models",
        payload: {
          model_version: "contrarian-regime-v1",
          family: "core-brain",
          label: "Contrarian Regime v1",
          status: "experimental",
          feature_flags: {
            strategy_profile: "contrarian_regime_aware",
          },
        },
      });

      expect(baselineResponse.statusCode).toBe(201);
      expect(candidateResponse.statusCode).toBe(201);

      const corpusResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/core-corpus",
        payload: {
          ingest_reviewed_memory: false,
        },
      });

      expect(corpusResponse.statusCode).toBe(201);

      const seedResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/historical-library/seed-high-confidence",
        payload: {
          reviewer: "promotion-seed-ops",
          case_pack_filters: ["macro_calendar_v1", "earnings_v1", "policy_fx_v1"],
          prioritize_gap_regimes: false,
          limit: 6,
          min_candidate_score: 0.8,
          dry_run: false,
        },
      });

      expect(seedResponse.statusCode).toBe(200);
      expect(seedResponse.json().promoted_count).toBeGreaterThanOrEqual(2);

      const gateResponse = await app.inject({
        method: "POST",
        url: "/v1/models/contrarian-regime-v1/promotion-gate",
        payload: {
          baseline_model_version: "impact-engine-v0",
          benchmark_pack_id: "core_benchmark_lite_v1",
          benchmark_strict_quotas: false,
          thresholds: {
            min_average_total_score_delta: -1,
            min_direction_accuracy_delta: -1,
            max_wrong_rate_delta: 1,
            min_calibration_alignment_delta: -1,
          },
          promote_on_pass: false,
          walk_forward: {
            enabled: true,
            benchmark_pack_id: "core_benchmark_v1",
            case_pack_filters: ["macro_calendar_v1", "earnings_v1", "policy_fx_v1"],
            min_train_cases: 6,
            test_window_size: 3,
            step_size: 3,
            thresholds: {
              min_average_total_score_delta: -1,
              min_direction_accuracy_delta: -1,
              max_wrong_rate_delta: 1,
              min_calibration_alignment_delta: -1,
            },
          },
        },
      });

      expect(gateResponse.statusCode).toBe(200);
      expect(gateResponse.json().walk_forward).not.toBeNull();
      expect(gateResponse.json().walk_forward.passed).toBe(true);
      expect(gateResponse.json().walk_forward.window_count).toBe(4);
      expect(gateResponse.json().walk_forward.eligible_case_count).toBe(19);
      expect(gateResponse.json().walk_forward.eligible_regime_count).toBeGreaterThanOrEqual(3);
      expect(gateResponse.json().walk_forward.eligible_high_confidence_case_count).toBeGreaterThanOrEqual(2);
      expect(gateResponse.json().walk_forward.depth_requirements_met).toBe(true);

      const benchmarkDashboardResponse = await app.inject({
        method: "GET",
        url: "/v1/dashboard/benchmarks?benchmark_pack_id=core_benchmark_v1",
      });

      expect(benchmarkDashboardResponse.statusCode).toBe(200);
      expect(benchmarkDashboardResponse.json().recent_walk_forward_promotions).toHaveLength(1);
      expect(
        benchmarkDashboardResponse.json().recent_walk_forward_promotions[0]
          .candidate_model_version,
      ).toBe("contrarian-regime-v1");
      expect(
        benchmarkDashboardResponse.json().recent_walk_forward_promotions[0].window_count,
      ).toBe(4);

      const promotionHistoryResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/promotions?limit=5",
      });

      expect(promotionHistoryResponse.statusCode).toBe(200);
      expect(promotionHistoryResponse.json().evaluations[0].walk_forward).not.toBeNull();

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Walk-forward promotion checks");
    } finally {
      await app.close();
    }
  });

  it("blocks walk-forward promotion when timed evidence is too thin on high-confidence depth", async () => {
    repository = new InMemoryRepository();

    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      await app.inject({
        method: "POST",
        url: "/v1/models",
        payload: {
          model_version: "impact-engine-v0",
          family: "core-brain",
          label: "Impact Engine v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
      });

      await app.inject({
        method: "POST",
        url: "/v1/models",
        payload: {
          model_version: "contrarian-regime-v1",
          family: "core-brain",
          label: "Contrarian Regime v1",
          status: "experimental",
          feature_flags: {
            strategy_profile: "contrarian_regime_aware",
          },
        },
      });

      await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/core-corpus",
        payload: {
          ingest_reviewed_memory: false,
        },
      });

      const gateResponse = await app.inject({
        method: "POST",
        url: "/v1/models/contrarian-regime-v1/promotion-gate",
        payload: {
          baseline_model_version: "impact-engine-v0",
          benchmark_pack_id: "core_benchmark_lite_v1",
          benchmark_strict_quotas: false,
          thresholds: {
            min_average_total_score_delta: -1,
            min_direction_accuracy_delta: -1,
            max_wrong_rate_delta: 1,
            min_calibration_alignment_delta: -1,
          },
          promote_on_pass: false,
          walk_forward: {
            enabled: true,
            benchmark_pack_id: "core_benchmark_v1",
            case_pack_filters: ["macro_calendar_v1", "earnings_v1", "policy_fx_v1"],
            min_train_cases: 6,
            test_window_size: 3,
            step_size: 3,
            depth_requirements: {
              min_window_count: 2,
              min_eligible_case_count: 12,
              min_regime_count: 3,
              min_high_confidence_case_count: 1,
            },
            thresholds: {
              min_average_total_score_delta: -1,
              min_direction_accuracy_delta: -1,
              max_wrong_rate_delta: 1,
              min_calibration_alignment_delta: -1,
            },
          },
        },
      });

      expect(gateResponse.statusCode).toBe(200);
      expect(gateResponse.json().passed).toBe(false);
      expect(gateResponse.json().walk_forward.depth_requirements_met).toBe(false);
      expect(gateResponse.json().walk_forward.eligible_high_confidence_case_count).toBe(0);
      expect(gateResponse.json().walk_forward.reasons.join(" ")).toContain(
        "high-confidence case count 0 is below the required 1",
      );
    } finally {
      await app.close();
    }
  });

  it("biases shell-growth thresholds using benchmark stability during evolution", async () => {
    repository = new InMemoryRepository();
    await repository.saveModelVersion({
      model_version: "fragile-alpha-v1",
      family: "fragile-alpha",
      label: "Fragile Alpha v1",
      status: "active",
      feature_flags: {},
    });
    await repository.saveModelVersion({
      model_version: "durable-core-v1",
      family: "durable-core",
      label: "Durable Core v1",
      status: "active",
      feature_flags: {},
    });

    const replayMetric = (
      modelVersion: string,
      averageTotalScore: number,
      wrongRate: number,
      calibrationGap: number,
    ) => ({
      model_version: modelVersion,
      case_count: 12,
      average_confidence: 0.68,
      average_total_score: averageTotalScore,
      direction_accuracy: 0.67,
      calibration_gap: calibrationGap,
      correct_rate: 0.58,
      partial_rate: 0.17,
      wrong_rate: wrongRate,
      by_theme: [],
      by_source_type: [],
      by_horizon: [],
    });

    const savePromotionEvaluation = async (
      candidateModelVersion: string,
      baselineModelVersion: string,
      passed: boolean,
    ) =>
      repository!.savePromotionEvaluation({
        candidate_model_version: candidateModelVersion,
        baseline_model_version: baselineModelVersion,
        case_pack: "macro_plus_v1",
        case_count: 12,
        passed,
        reasons: [passed ? "promotion passed" : "promotion failed"],
        deltas: {
          average_total_score: passed ? 0.02 : -0.01,
          direction_accuracy: passed ? 0.01 : -0.01,
          wrong_rate: passed ? -0.02 : 0.02,
          calibration_alignment: passed ? 0.01 : -0.01,
        },
        thresholds: {
          min_average_total_score_delta: 0.01,
          min_direction_accuracy_delta: 0,
          max_wrong_rate_delta: 0,
          min_calibration_alignment_delta: 0,
        },
        baseline: replayMetric(baselineModelVersion, 0.68, 0.24, 0.08),
        candidate: replayMetric(
          candidateModelVersion,
          passed ? 0.71 : 0.66,
          passed ? 0.22 : 0.28,
          passed ? 0.06 : 0.11,
        ),
        walk_forward: null,
        saved_model: null,
      });

    await savePromotionEvaluation("fragile-alpha-v1-r1", "fragile-alpha-v1", true);
    await savePromotionEvaluation("fragile-alpha-v1-r2", "fragile-alpha-v1", true);
    await savePromotionEvaluation("fragile-alpha-v1-r3", "fragile-alpha-v1", false);
    await savePromotionEvaluation("durable-core-v1-r1", "durable-core-v1", true);
    await savePromotionEvaluation("durable-core-v1-r2", "durable-core-v1", false);

    const saveSnapshot = async (
      id: string,
      asOf: string,
      fragile: {
        score: number;
        direction: number;
        wrong: number;
        calibration: number;
      },
      durable: {
        score: number;
        direction: number;
        wrong: number;
        calibration: number;
      },
    ) =>
      repository!.saveBenchmarkReplaySnapshot({
        id,
        as_of: asOf,
        benchmark_pack_id: "core_benchmark_lite_v1",
        selected_case_count: 12,
        family_count: 2,
        report: {
          pack_id: "core_benchmark_lite_v1",
          label: "Core Benchmark Lite v1",
          description: "Synthetic weekly stability check",
          selected_case_count: 12,
          quotas_met: true,
          domain_counts: [],
          selected_case_ids: ["case-a", "case-b", "case-c"],
          model_count: 2,
          family_count: 2,
          leaders: {
            by_average_total_score: durable.score >= fragile.score ? "durable-core-v1" : "fragile-alpha-v1",
            by_direction_accuracy:
              durable.direction >= fragile.direction ? "durable-core-v1" : "fragile-alpha-v1",
            by_calibration_alignment:
              Math.abs(durable.calibration) <= Math.abs(fragile.calibration)
                ? "durable-core-v1"
                : "fragile-alpha-v1",
          },
          models: [
            {
              ...replayMetric("fragile-alpha-v1", fragile.score, fragile.wrong, fragile.calibration),
              family: "fragile-alpha",
              status: "active",
            },
            {
              ...replayMetric("durable-core-v1", durable.score, durable.wrong, durable.calibration),
              family: "durable-core",
              status: "active",
            },
          ],
          families: [
            {
              family: "fragile-alpha",
              model_version: "fragile-alpha-v1",
              status: "active",
              case_count: 12,
              average_confidence: 0.68,
              average_total_score: fragile.score,
              direction_accuracy: fragile.direction,
              calibration_gap: fragile.calibration,
              wrong_rate: fragile.wrong,
            },
            {
              family: "durable-core",
              model_version: "durable-core-v1",
              status: "active",
              case_count: 12,
              average_confidence: 0.68,
              average_total_score: durable.score,
              direction_accuracy: durable.direction,
              calibration_gap: durable.calibration,
              wrong_rate: durable.wrong,
            },
          ],
        },
        created_at: asOf,
      });

    await saveSnapshot(
      "00000000-0000-0000-0000-000000000801",
      "2026-01-05T00:00:00.000Z",
      { score: 0.78, direction: 0.74, wrong: 0.18, calibration: 0.06 },
      { score: 0.82, direction: 0.8, wrong: 0.1, calibration: 0.04 },
    );
    await saveSnapshot(
      "00000000-0000-0000-0000-000000000802",
      "2026-01-12T00:00:00.000Z",
      { score: 0.68, direction: 0.66, wrong: 0.24, calibration: 0.11 },
      { score: 0.81, direction: 0.79, wrong: 0.11, calibration: 0.04 },
    );
    await saveSnapshot(
      "00000000-0000-0000-0000-000000000803",
      "2026-01-19T00:00:00.000Z",
      { score: 0.62, direction: 0.59, wrong: 0.31, calibration: 0.17 },
      { score: 0.83, direction: 0.81, wrong: 0.09, calibration: 0.03 },
    );

    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const evolutionResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-cycle",
        payload: {
          benchmark_pack_id: "core_benchmark_lite_v1",
          create_postmortems: false,
          capture_calibration_snapshot: false,
          capture_benchmark_snapshot: false,
          capture_lineage_snapshot: false,
          molt_cycle: {
            case_pack: "macro_plus_v1",
            benchmark_pack_id: "core_benchmark_lite_v1",
            apply_stability_bias: true,
            require_pattern_priors: false,
            min_family_pass_rate: 0.65,
            score_floor: 0,
            max_abs_calibration_gap: 1,
            trigger_on_declining_trend: false,
            thresholds: {
              min_average_total_score_delta: 0.01,
              min_direction_accuracy_delta: 0,
              max_wrong_rate_delta: 0,
              min_calibration_alignment_delta: 0,
            },
          },
        },
      });

      expect(evolutionResponse.statusCode).toBe(200);
      expect(evolutionResponse.json().molt_cycle.benchmark_pack_id).toBe(
        "core_benchmark_lite_v1",
      );
      expect(evolutionResponse.json().molt_cycle.stability_applied).toBe(true);

      const fragileItem = evolutionResponse
        .json()
        .molt_cycle.items.find((item: { family: string }) => item.family === "fragile-alpha");
      const durableItem = evolutionResponse
        .json()
        .molt_cycle.items.find((item: { family: string }) => item.family === "durable-core");

      expect(fragileItem).toBeTruthy();
      expect(fragileItem.status).not.toBe("skipped");
      expect(fragileItem.stability_adjustment.signal).toBe("fragile");
      expect(fragileItem.stability_adjustment.trigger_bias).toBe("accelerated");
      expect(
        fragileItem.stability_adjustment.effective_trigger_thresholds.min_family_pass_rate,
      ).toBeGreaterThan(0.65);
      expect(fragileItem.stability_adjustment.rationale.join(" ")).toContain(
        "feel growth pressure earlier",
      );

      expect(durableItem).toBeTruthy();
      expect(durableItem.stability_adjustment.signal).toBe("durable");
      expect(durableItem.stability_adjustment.trigger_bias).toBe("guarded");
      expect(durableItem.stability_adjustment.promotion_bias).toBe("stricter");
      expect(
        durableItem.stability_adjustment.effective_promotion_thresholds
          .min_average_total_score_delta,
      ).toBeGreaterThan(0.01);
      expect(
        durableItem.stability_adjustment.effective_promotion_thresholds.max_wrong_rate_delta,
      ).toBeLessThan(0);
    } finally {
      await app.close();
    }
  });

  it("captures walk-forward snapshot history and feeds timed regressions into the benchmark desk", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const modelResponse = await app.inject({
        method: "POST",
        url: "/v1/models",
        payload: {
          model_version: "impact-engine-v0",
          family: "core-brain",
          label: "Impact Engine v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
      });

      expect(modelResponse.statusCode).toBe(201);

      const corpusResponse = await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/core-corpus",
        payload: {
          ingest_reviewed_memory: false,
        },
      });

      expect(corpusResponse.statusCode).toBe(201);

      const firstSnapshotResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/walk-forward-snapshot",
        payload: {
          benchmark_pack_id: "core_benchmark_v1",
          case_pack_filters: ["macro_calendar_v1", "earnings_v1", "policy_fx_v1"],
          min_train_cases: 6,
          test_window_size: 3,
          step_size: 3,
          as_of: "2026-01-10T00:00:00.000Z",
        },
      });

      expect(firstSnapshotResponse.statusCode).toBe(201);
      expect(firstSnapshotResponse.json().window_count).toBe(4);

      const firstSnapshot = firstSnapshotResponse.json();
      const degradedSnapshot = {
        ...firstSnapshot,
        id: "00000000-0000-4000-8000-000000000041",
        as_of: "2026-01-17T00:00:00.000Z",
        created_at: "2026-01-17T00:00:00.000Z",
        report: {
          ...firstSnapshot.report,
          families: firstSnapshot.report.families.map((family: Record<string, unknown>) => ({
            ...family,
            average_total_score: 0.4,
            direction_accuracy: 0.35,
            wrong_rate: 0.45,
            calibration_gap: 0.18,
          })),
          regimes: firstSnapshot.report.regimes.map((regime: Record<string, unknown>) => ({
            ...regime,
            average_total_score: 0.4,
            direction_accuracy: 0.35,
            wrong_rate: 0.45,
            calibration_gap: 0.18,
          })),
          models: firstSnapshot.report.models.map((model: Record<string, unknown>) => ({
            ...model,
            average_total_score: 0.4,
            direction_accuracy: 0.35,
            wrong_rate: 0.45,
            calibration_gap: 0.18,
          })),
          leaders: {
            by_average_total_score: "impact-engine-v0",
            by_direction_accuracy: "impact-engine-v0",
            by_calibration_alignment: "impact-engine-v0",
          },
        },
      };
      await repository.saveWalkForwardReplaySnapshot(degradedSnapshot);

      const historyResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/walk-forward/history?benchmark_pack_id=core_benchmark_v1",
      });

      expect(historyResponse.statusCode).toBe(200);
      expect(historyResponse.json().snapshots).toHaveLength(2);

      const trendResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/walk-forward/trends?benchmark_pack_id=core_benchmark_v1",
      });

      expect(trendResponse.statusCode).toBe(200);
      expect(trendResponse.json().sample_count).toBe(2);
      expect(trendResponse.json().families[0].family).toBe("core-brain");

      const regimeTrendResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/walk-forward/regimes?benchmark_pack_id=core_benchmark_v1",
      });

      expect(regimeTrendResponse.statusCode).toBe(200);
      expect(regimeTrendResponse.json().regime_count).toBeGreaterThan(0);
      expect(
        regimeTrendResponse
          .json()
          .slices.some((slice: Record<string, unknown>) => slice.regime === "fx_intervention"),
      ).toBe(true);

      const regressionResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/walk-forward/regressions?benchmark_pack_id=core_benchmark_v1",
      });

      expect(regressionResponse.statusCode).toBe(200);
      expect(regressionResponse.json().alerts).toHaveLength(1);
      expect(regressionResponse.json().alerts[0].family).toBe("core-brain");

      const regimeRegressionResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/walk-forward/regime-regressions?benchmark_pack_id=core_benchmark_v1",
      });

      expect(regimeRegressionResponse.statusCode).toBe(200);
      expect(regimeRegressionResponse.json().alerts.length).toBeGreaterThan(0);
      expect(
        regimeRegressionResponse
          .json()
          .alerts.some((alert: Record<string, unknown>) => alert.regime === "fx_intervention"),
      ).toBe(true);

      const alertResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/evolution/alerts?benchmark_pack_id=core_benchmark_v1",
      });

      expect(alertResponse.statusCode).toBe(200);
      expect(alertResponse.json().alerts[0].signals.join(" ")).toContain("walk-forward");
      expect(alertResponse.json().alerts[0].signals.join(" ")).toContain("fx_intervention");

      const seedResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/historical-library/seed-high-confidence",
        payload: {
          benchmark_pack_id: "core_benchmark_v1",
          dry_run: true,
          limit: 6,
        },
      });

      expect(seedResponse.statusCode).toBe(200);
      expect(seedResponse.json().prioritized_regimes).toContain("fx_intervention");

      const dashboardResponse = await app.inject({
        method: "GET",
        url: "/v1/dashboard/benchmarks?benchmark_pack_id=core_benchmark_v1",
      });

      expect(dashboardResponse.statusCode).toBe(200);
      expect(dashboardResponse.json().latest_walk_forward_snapshot).not.toBeNull();
      expect(dashboardResponse.json().walk_forward_regime_slices.length).toBeGreaterThan(0);
      expect(dashboardResponse.json().walk_forward_regressions).toHaveLength(1);
      expect(dashboardResponse.json().walk_forward_regime_regressions.length).toBeGreaterThan(0);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Latest timed checkpoint");
      expect(opsPageResponse.body).toContain("Walk-forward by regime");
      expect(opsPageResponse.body).toContain("timed regressions");
      expect(opsPageResponse.body).toContain("regime regressions");
    } finally {
      await app.close();
    }
  });

  it("runs scheduled evolution with walk-forward snapshots on cadence", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      await app.inject({
        method: "POST",
        url: "/v1/models",
        payload: {
          model_version: "impact-engine-v0",
          family: "core-brain",
          label: "Impact Engine v0",
          status: "active",
          feature_flags: {
            strategy_profile: "baseline",
          },
        },
      });

      await app.inject({
        method: "POST",
        url: "/v1/ingestion/historical/core-corpus",
        payload: {
          ingest_reviewed_memory: false,
        },
      });

      const scheduleResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-schedule",
        payload: {
          benchmark_pack_id: "core_benchmark_v1",
          run_molt_cycle: false,
          self_audit_interval_hours: 24,
          benchmark_snapshot_interval_hours: 24,
          walk_forward_snapshot_interval_hours: 24,
          benchmark_trust_refresh_interval_hours: 24,
          lineage_snapshot_interval_hours: 24,
          walk_forward_defaults: {
            benchmark_pack_id: "core_benchmark_v1",
            case_pack_filters: ["macro_calendar_v1", "earnings_v1", "policy_fx_v1"],
            min_train_cases: 6,
            test_window_size: 3,
            step_size: 3,
          },
        },
      });

      expect(scheduleResponse.statusCode).toBe(200);
      expect(scheduleResponse.json().capture_walk_forward_snapshot).toBe(true);

      const runResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-schedule/run",
        payload: {
          as_of: "2031-01-01T00:00:00.000Z",
        },
      });

      expect(runResponse.statusCode).toBe(200);
      expect(runResponse.json().ran).toBe(true);
      expect(runResponse.json().due.walk_forward_snapshot).toBe(true);
      expect(runResponse.json().result.walk_forward_snapshot).not.toBeNull();
      expect(runResponse.json().schedule.last_result.captured_walk_forward_snapshot).toBe(true);
      expect(runResponse.json().schedule.last_result.walk_forward_window_count).toBeGreaterThan(0);
      expect(runResponse.json().schedule.last_result.walk_forward_snapshot_family_count).toBe(1);
      expect(runResponse.json().schedule.next_walk_forward_snapshot_at).toBe(
        "2031-01-02T00:00:00.000Z",
      );

      const historyResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/walk-forward/history?benchmark_pack_id=core_benchmark_v1",
      });

      expect(historyResponse.statusCode).toBe(200);
      expect(historyResponse.json().snapshots.length).toBeGreaterThan(0);
    } finally {
      await app.close();
    }
  });

  it("records durable operation telemetry for successful and failed backend jobs", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const autoScoreResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/auto-score",
        headers: {
          "x-operation-trigger": "script",
        },
        payload: {
          create_postmortems: false,
        },
      });

      expect(autoScoreResponse.statusCode).toBe(200);
      expect(autoScoreResponse.json().processed).toBe(0);

      const benchmarkResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/benchmark-snapshot",
        payload: {
          benchmark_pack_id: "core_benchmark_v1",
          strict_quotas: false,
        },
      });

      expect(benchmarkResponse.statusCode).toBe(409);

      const systemResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/operations?limit=10",
      });

      expect(systemResponse.statusCode).toBe(200);
      expect(systemResponse.json().counts.total).toBe(2);
      expect(systemResponse.json().counts.success).toBe(1);
      expect(systemResponse.json().counts.failed).toBe(1);
      expect(systemResponse.json().latest_failure.operation_name).toBe("benchmark_snapshot");
      expect(
        systemResponse
          .json()
          .latest_runs.some(
            (item: Record<string, unknown>) =>
              item.operation_name === "auto_score" && item.triggered_by === "script",
          ),
      ).toBe(true);
      expect(
        systemResponse
          .json()
          .operations.some(
            (item: Record<string, unknown>) =>
              item.operation_name === "auto_score" && item.success_count === 1,
          ),
      ).toBe(true);

      const healthResponse = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json().ok).toBe(false);
      expect(healthResponse.json().operation_monitoring.latest_failure_operation).toBe(
        "benchmark_snapshot",
      );
      expect(healthResponse.json().queue_monitoring.stale_running_jobs).toBe(0);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("System operations");
      expect(opsPageResponse.body).toContain("/v1/dashboard/operations");
    } finally {
      await app.close();
    }
  });

  it("reports dependency readiness for repository and embedding services", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const readinessResponse = await app.inject({
        method: "GET",
        url: "/ready",
      });

      expect(readinessResponse.statusCode).toBe(200);
      expect(readinessResponse.json().ok).toBe(true);
      expect(
        readinessResponse
          .json()
          .dependencies.some(
            (item: Record<string, unknown>) =>
              item.name === "repository" && item.status === "ready",
          ),
      ).toBe(true);
      expect(
        readinessResponse
          .json()
          .dependencies.some(
            (item: Record<string, unknown>) =>
              item.name === "embedding_provider" && item.status === "ready",
          ),
      ).toBe(true);
      expect(
        readinessResponse
          .json()
          .dependencies.some(
            (item: Record<string, unknown>) =>
              item.name === "market_data_provider" && item.status === "unknown",
          ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("queues long-running operations and drains them through the worker boundary", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const firstJobResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/jobs",
        payload: {
          operation_name: "auto_score",
          payload: {
            create_postmortems: false,
          },
          idempotency_key: "queue-auto-score-1",
        },
      });

      expect(firstJobResponse.statusCode).toBe(202);
      expect(firstJobResponse.json().status).toBe("pending");

      const duplicateJobResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/jobs",
        payload: {
          operation_name: "auto_score",
          payload: {
            create_postmortems: false,
          },
          idempotency_key: "queue-auto-score-1",
        },
      });

      expect(duplicateJobResponse.statusCode).toBe(202);
      expect(duplicateJobResponse.json().id).toBe(firstJobResponse.json().id);

      const queuedBenchmarkResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/jobs",
        payload: {
          operation_name: "benchmark_snapshot",
          payload: {
            benchmark_pack_id: "core_benchmark_v1",
            strict_quotas: false,
          },
          max_attempts: 2,
        },
      });

      expect(queuedBenchmarkResponse.statusCode).toBe(202);

      const queueBeforeResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/queue?limit=10",
      });

      expect(queueBeforeResponse.statusCode).toBe(200);
      expect(queueBeforeResponse.json().counts.pending).toBe(2);

      const drainResult = await drainOperationJobs(
        {
          repository,
          marketDataProvider: new MockMarketDataProvider(),
          embeddingProvider: new LocalEmbeddingProvider(),
        },
        {
          worker_id: "test-worker",
          max_jobs: 2,
          retry_delay_seconds: 30,
        },
      );

      expect(drainResult.processed).toBe(2);
      expect(drainResult.completed).toBe(1);
      expect(drainResult.retried).toBe(1);

      const jobsResponse = await app.inject({
        method: "GET",
        url: "/v1/operations/jobs?limit=10",
      });

      expect(jobsResponse.statusCode).toBe(200);
      expect(
        jobsResponse
          .json()
          .jobs.some(
            (job: Record<string, unknown>) =>
              job.operation_name === "auto_score" && job.status === "completed",
          ),
      ).toBe(true);
      expect(
        jobsResponse
          .json()
          .jobs.some(
            (job: Record<string, unknown>) =>
              job.operation_name === "benchmark_snapshot" && job.status === "pending",
          ),
      ).toBe(true);

      const queueAfterResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/queue?limit=10",
      });

      expect(queueAfterResponse.statusCode).toBe(200);
      expect(queueAfterResponse.json().counts.completed).toBe(1);
      expect(queueAfterResponse.json().counts.pending).toBe(1);
      expect(queueAfterResponse.json().counts.retry_scheduled).toBe(1);
      expect(queueAfterResponse.json().counts.stale_running).toBe(0);
      expect(queueAfterResponse.json().oldest_pending_age_ms).toBeGreaterThanOrEqual(0);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("System queue");
      expect(opsPageResponse.body).toContain("/v1/dashboard/operations");
    } finally {
      await app.close();
    }
  });

  it("queues scheduled evolution and benchmark trust refresh routes when requested", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const scheduledResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-schedule/run?execution=queued",
        headers: {
          "idempotency-key": "scheduled-evolution-queued",
        },
        payload: {
          as_of: "2032-01-01T00:00:00.000Z",
        },
      });

      expect(scheduledResponse.statusCode).toBe(202);
      expect(scheduledResponse.json().operation_name).toBe("scheduled_evolution");

      const duplicateScheduledResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/evolution-schedule/run?execution=queued",
        headers: {
          "idempotency-key": "scheduled-evolution-queued",
        },
        payload: {
          as_of: "2032-01-01T00:00:00.000Z",
        },
      });

      expect(duplicateScheduledResponse.statusCode).toBe(202);
      expect(duplicateScheduledResponse.json().id).toBe(scheduledResponse.json().id);

      const trustRefreshResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/benchmark-trust-refresh?execution=queued",
        headers: {
          "idempotency-key": "trust-refresh-queued",
        },
        payload: {
          benchmark_pack_id: "core_benchmark_lite_v1",
          reviewer: "queue-ops",
          seed_limit: 4,
          min_candidate_score: 0.8,
          dry_run: false,
          strict_quotas: false,
        },
      });

      expect(trustRefreshResponse.statusCode).toBe(202);
      expect(trustRefreshResponse.json().operation_name).toBe("benchmark_trust_refresh");

      const jobsResponse = await app.inject({
        method: "GET",
        url: "/v1/operations/jobs?limit=10",
      });

      expect(jobsResponse.statusCode).toBe(200);
      expect(
        jobsResponse
          .json()
          .jobs.some(
            (job: Record<string, unknown>) =>
              job.operation_name === "scheduled_evolution" && job.status === "pending",
          ),
      ).toBe(true);
      expect(
        jobsResponse
          .json()
          .jobs.some(
            (job: Record<string, unknown>) =>
              job.operation_name === "benchmark_trust_refresh" && job.status === "pending",
          ),
      ).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("surfaces queue pressure alerts for stale, retrying, and failed jobs", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const oneMinuteAgo = new Date(now.getTime() - 60_000).toISOString();
      const tenMinutesLater = new Date(now.getTime() + 10 * 60_000).toISOString();
      const twentyMinutesLater = new Date(now.getTime() + 20 * 60_000).toISOString();

      await repository.enqueueOperationJob({
        operation_name: "auto_score",
        triggered_by: "internal",
        payload: {
          create_postmortems: false,
        },
        max_attempts: 3,
        available_at: nowIso,
      });

      const staleJob = await repository.claimNextOperationJob({
        worker_id: "worker-stale",
        as_of: nowIso,
        lease_expires_at: oneMinuteAgo,
        supported_operations: ["auto_score"],
      });

      expect(staleJob?.status).toBe("running");

      const retrySeed = await repository.enqueueOperationJob({
        operation_name: "benchmark_snapshot",
        triggered_by: "internal",
        payload: {
          benchmark_pack_id: "core_benchmark_lite_v1",
          strict_quotas: false,
        },
        max_attempts: 3,
        available_at: nowIso,
      });

      const retryJob = await repository.claimNextOperationJob({
        worker_id: "worker-retry",
        as_of: nowIso,
        lease_expires_at: tenMinutesLater,
        supported_operations: ["benchmark_snapshot"],
      });

      expect(retryJob?.id).toBe(retrySeed.id);

      await repository.failOperationJob({
        id: retrySeed.id,
        worker_id: "worker-retry",
        finished_at: nowIso,
        error_message: "temporary benchmark dependency failure",
        retry_at: twentyMinutesLater,
      });

      const failedSeed = await repository.enqueueOperationJob({
        operation_name: "benchmark_trust_refresh",
        triggered_by: "internal",
        payload: {},
        max_attempts: 1,
        available_at: nowIso,
      });

      const failedJob = await repository.claimNextOperationJob({
        worker_id: "worker-failed",
        as_of: nowIso,
        lease_expires_at: tenMinutesLater,
        supported_operations: ["benchmark_trust_refresh"],
      });

      expect(failedJob?.id).toBe(failedSeed.id);

      await repository.failOperationJob({
        id: failedSeed.id,
        worker_id: "worker-failed",
        finished_at: nowIso,
        error_message: "permanent scoring failure",
      });

      await repository.upsertOperationWorker({
        worker_id: "worker-stale",
        lifecycle_state: "running",
        supported_operations: ["auto_score"],
        poll_interval_ms: 2_000,
        idle_backoff_ms: 5_000,
        started_at: oneMinuteAgo,
        heartbeat_at: oneMinuteAgo,
        last_cycle_started_at: oneMinuteAgo,
        last_cycle_finished_at: oneMinuteAgo,
        last_cycle_processed: 1,
        last_cycle_completed: 0,
        last_cycle_failed: 1,
        last_cycle_retried: 0,
        last_cycle_abandoned: 0,
        last_error_message: "worker stalled mid-cycle",
      });

      const queueAlertResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/queue-alerts?limit=10",
      });

      expect(queueAlertResponse.statusCode).toBe(200);
      expect(queueAlertResponse.json().counts.high).toBeGreaterThan(0);
      expect(
        queueAlertResponse
          .json()
          .alerts.some((alert: Record<string, unknown>) => alert.signal === "stale_running"),
      ).toBe(true);
      expect(
        queueAlertResponse
          .json()
          .alerts.some((alert: Record<string, unknown>) => alert.signal === "retries"),
      ).toBe(true);
      expect(
        queueAlertResponse
          .json()
          .alerts.some((alert: Record<string, unknown>) => alert.signal === "failed_jobs"),
      ).toBe(true);
      expect(
        queueAlertResponse
          .json()
          .alerts.some((alert: Record<string, unknown>) => alert.signal === "stale_workers"),
      ).toBe(true);

      const healthResponse = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json().queue_monitoring.highest_alert_severity).toBe("high");
      expect(healthResponse.json().worker_monitoring.stale_workers).toBeGreaterThan(0);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Queue alerts");
      expect(opsPageResponse.body).toContain("/v1/dashboard/operations");
    } finally {
      await app.close();
    }
  });

  it("reports worker supervision metrics and surfaces them in ops", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const oneMinuteAgo = new Date(now.getTime() - 60_000).toISOString();

      await repository.upsertOperationWorker({
        worker_id: "worker-active",
        lifecycle_state: "running",
        supported_operations: ["scheduled_evolution", "benchmark_trust_refresh"],
        poll_interval_ms: 2_000,
        idle_backoff_ms: 5_000,
        started_at: nowIso,
        heartbeat_at: nowIso,
        last_cycle_started_at: nowIso,
        last_cycle_finished_at: nowIso,
        last_cycle_processed: 2,
        last_cycle_completed: 2,
        last_cycle_failed: 0,
        last_cycle_retried: 0,
        last_cycle_abandoned: 0,
        last_error_message: null,
      });

      await repository.upsertOperationWorker({
        worker_id: "worker-stale",
        lifecycle_state: "running",
        supported_operations: ["feed_pull"],
        poll_interval_ms: 2_000,
        idle_backoff_ms: 5_000,
        started_at: oneMinuteAgo,
        heartbeat_at: oneMinuteAgo,
        last_cycle_started_at: oneMinuteAgo,
        last_cycle_finished_at: oneMinuteAgo,
        last_cycle_processed: 1,
        last_cycle_completed: 0,
        last_cycle_failed: 1,
        last_cycle_retried: 1,
        last_cycle_abandoned: 0,
        last_error_message: "feed integration heartbeat lost",
      });

      const workerResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/workers?limit=10",
      });

      expect(workerResponse.statusCode).toBe(200);
      expect(workerResponse.json().counts.active).toBe(1);
      expect(workerResponse.json().counts.stale).toBe(1);
      expect(
        workerResponse
          .json()
          .workers.some(
            (worker: Record<string, unknown>) =>
              worker.worker_id === "worker-stale" && worker.status === "stale",
          ),
      ).toBe(true);

      const healthResponse = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json().worker_monitoring.registered_workers).toBe(2);
      expect(healthResponse.json().worker_monitoring.active_workers).toBe(1);
      expect(healthResponse.json().worker_monitoring.stale_workers).toBe(1);
      expect(healthResponse.json().worker_monitoring.highest_status).toBe("stale");

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Queue workers");
      expect(opsPageResponse.body).toContain("/v1/dashboard/operations");
    } finally {
      await app.close();
    }
  });

  it("reports worker service supervision metrics and surfaces them in ops", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const oneMinuteAgo = new Date(now.getTime() - 60_000).toISOString();

      await repository.upsertOperationWorkerService({
        service_id: "worker-service-active",
        worker_id: "worker-active",
        lifecycle_state: "running",
        supported_operations: ["scheduled_evolution", "benchmark_trust_refresh"],
        supervisor_backoff_ms: 5_000,
        success_window_ms: 60_000,
        heartbeat_interval_ms: 5_000,
        max_restarts: 10,
        heartbeat_at: nowIso,
        started_at: nowIso,
      });

      await repository.upsertOperationWorkerService({
        service_id: "worker-service-backoff",
        worker_id: "worker-backoff",
        lifecycle_state: "backing_off",
        supported_operations: ["feed_pull"],
        supervisor_backoff_ms: 5_000,
        success_window_ms: 60_000,
        heartbeat_interval_ms: 5_000,
        max_restarts: 10,
        restart_count: 2,
        restart_streak: 2,
        current_restart_backoff_ms: 20_000,
        heartbeat_at: nowIso,
        started_at: nowIso,
        last_loop_finished_at: nowIso,
        last_error_message: "recent worker loop exit",
      });

      await repository.upsertOperationWorkerService({
        service_id: "worker-service-stale",
        worker_id: "worker-stale",
        lifecycle_state: "running",
        supported_operations: ["transcript_pull"],
        supervisor_backoff_ms: 5_000,
        success_window_ms: 60_000,
        heartbeat_interval_ms: 5_000,
        max_restarts: 10,
        heartbeat_at: oneMinuteAgo,
        started_at: oneMinuteAgo,
      });

      const serviceResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/worker-services?limit=10",
      });

      expect(serviceResponse.statusCode).toBe(200);
      expect(serviceResponse.json().counts.active).toBe(1);
      expect(serviceResponse.json().counts.backing_off).toBe(1);
      expect(serviceResponse.json().counts.stale).toBe(1);
      expect(
        serviceResponse
          .json()
          .services.some(
            (service: Record<string, unknown>) =>
              service.service_id === "worker-service-stale" && service.status === "stale",
          ),
      ).toBe(true);

      const healthResponse = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json().worker_service_monitoring.registered_services).toBe(3);
      expect(healthResponse.json().worker_service_monitoring.active_services).toBe(1);
      expect(healthResponse.json().worker_service_monitoring.backing_off_services).toBe(1);
      expect(healthResponse.json().worker_service_monitoring.stale_services).toBe(1);
      expect(healthResponse.json().worker_service_monitoring.highest_status).toBe("stale");
      expect(healthResponse.json().worker_service_monitoring.next_restart_due_at).toBe(
        new Date(now.getTime() + 20_000).toISOString(),
      );
      expect(
        healthResponse.json().worker_service_monitoring.max_remaining_restart_backoff_ms,
      ).toBeGreaterThan(0);
      expect(
        healthResponse.json().worker_service_monitoring.max_remaining_restart_backoff_ms,
      ).toBeLessThanOrEqual(20_000);
      expect(healthResponse.json().worker_service_monitoring.backoff_unavailable_alerts).toBe(0);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Worker services");
      expect(opsPageResponse.body).toContain("/v1/dashboard/operations");
    } finally {
      await app.close();
    }
  });

  it("reports worker service runtime trends and surfaces them in ops", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000).toISOString();
      const oneMinuteAgo = new Date(now.getTime() - 60_000).toISOString();

      await repository.saveOperationWorkerServiceEvent({
        service_id: "worker-service-trend",
        worker_id: "worker-service-trend",
        event_type: "started",
        occurred_at: tenMinutesAgo,
        lifecycle_state: "running",
        scheduled_restart: null,
        restart_count: 0,
        restart_streak: 0,
        loop_runtime_ms: null,
        exit_code: null,
        exit_signal: null,
        error_message: null,
        metadata: {},
      });
      await repository.saveOperationWorkerServiceEvent({
        service_id: "worker-service-trend",
        worker_id: "worker-service-contender",
        event_type: "ownership_conflict",
        occurred_at: fiveMinutesAgo,
        lifecycle_state: "starting",
        scheduled_restart: null,
        restart_count: 0,
        restart_streak: 0,
        loop_runtime_ms: null,
        exit_code: null,
        exit_signal: null,
        error_message: "worker service worker-service-trend is already owned by host-alpha pid 111",
        metadata: {
          attempted_supervisor_host: "host-beta",
          conflicting_supervisor_host: "host-alpha",
        },
      });
      await repository.saveOperationWorkerServiceEvent({
        service_id: "worker-service-trend",
        worker_id: "worker-service-trend",
        event_type: "loop_exit",
        occurred_at: fiveMinutesAgo,
        lifecycle_state: "backing_off",
        scheduled_restart: true,
        restart_count: 1,
        restart_streak: 1,
        loop_runtime_ms: 500,
        exit_code: 1,
        exit_signal: null,
        error_message: "worker loop exited with code 1",
        metadata: {},
      });
      await repository.saveOperationWorkerServiceEvent({
        service_id: "worker-service-trend",
        worker_id: "worker-service-trend",
        event_type: "failed",
        occurred_at: oneMinuteAgo,
        lifecycle_state: "failed",
        scheduled_restart: false,
        restart_count: 1,
        restart_streak: 1,
        loop_runtime_ms: null,
        exit_code: null,
        exit_signal: null,
        error_message: "worker restart limit exceeded",
        metadata: {},
      });

      await repository.upsertOperationWorkerService({
        service_id: "worker-service-trend",
        worker_id: "worker-service-trend",
        lifecycle_state: "failed",
        supported_operations: ["scheduled_evolution"],
        supervisor_backoff_ms: 5_000,
        success_window_ms: 60_000,
        heartbeat_interval_ms: 5_000,
        max_restarts: 4,
        restart_count: 1,
        restart_streak: 1,
        heartbeat_at: oneMinuteAgo,
        started_at: tenMinutesAgo,
        last_error_message: "worker restart limit exceeded",
        stopped_at: oneMinuteAgo,
      });

      const trendResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/worker-service-trends?window_hours=24&bucket_hours=24&recent_limit=10",
      });

      expect(trendResponse.statusCode).toBe(200);
      expect(trendResponse.json().counts.started).toBe(1);
      expect(trendResponse.json().counts.ownership_conflicts).toBe(1);
      expect(trendResponse.json().counts.scheduled_restarts).toBe(1);
      expect(trendResponse.json().counts.failed).toBe(1);
      expect(
        trendResponse
          .json()
          .alerts.some((alert: Record<string, unknown>) => alert.signal === "ownership_conflicts"),
      ).toBe(true);
      expect(
        trendResponse
          .json()
          .alerts.some((alert: Record<string, unknown>) => alert.signal === "failed_boundary"),
      ).toBe(true);

      const dashboardOperationsResponse = await app.inject({
        method: "GET",
        url: "/v1/dashboard/operations",
      });

      expect(dashboardOperationsResponse.statusCode).toBe(200);
      expect(dashboardOperationsResponse.json().worker_service_trends.counts.failed).toBe(1);
      expect(dashboardOperationsResponse.json().worker_service_trends.counts.ownership_conflicts).toBe(1);

      const healthResponse = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json().worker_service_monitoring.recent_scheduled_restarts).toBe(1);
      expect(healthResponse.json().worker_service_monitoring.recent_ownership_conflicts).toBe(1);
      expect(healthResponse.json().worker_service_monitoring.recent_failures).toBe(1);
      expect(healthResponse.json().worker_service_monitoring.restart_storm_alerts).toBe(0);
      expect(healthResponse.json().worker_service_monitoring.boundary_instability_alerts).toBe(0);
      expect(healthResponse.json().worker_service_monitoring.trend_alert_count).toBeGreaterThan(0);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Worker service trends");
      expect(opsPageResponse.body).toContain("/v1/dashboard/operations");
    } finally {
      await app.close();
    }
  });

  it("reports worker runtime trends and surfaces them in ops", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const now = new Date();
      const tenMinutesAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60_000).toISOString();
      const oneMinuteAgo = new Date(now.getTime() - 60_000).toISOString();

      await repository.saveOperationWorkerEvent({
        worker_id: "worker-trend",
        event_type: "started",
        occurred_at: tenMinutesAgo,
        lifecycle_state: "running",
        cycle_processed: null,
        cycle_completed: null,
        cycle_failed: null,
        cycle_retried: null,
        cycle_abandoned: null,
        error_message: null,
        metadata: {
          heartbeat_interval_ms: 5_000,
        },
      });
      await repository.saveOperationWorkerEvent({
        worker_id: "worker-trend",
        event_type: "cycle",
        occurred_at: fiveMinutesAgo,
        lifecycle_state: "running",
        cycle_processed: 4,
        cycle_completed: 2,
        cycle_failed: 2,
        cycle_retried: 2,
        cycle_abandoned: 1,
        error_message: null,
        metadata: {},
      });
      await repository.saveOperationWorkerEvent({
        worker_id: "worker-trend",
        event_type: "stopped",
        occurred_at: oneMinuteAgo,
        lifecycle_state: "stopped",
        cycle_processed: null,
        cycle_completed: null,
        cycle_failed: null,
        cycle_retried: null,
        cycle_abandoned: null,
        error_message: "worker crashed while draining queue",
        metadata: {
          had_error: true,
        },
      });

      const workerTrendResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/worker-trends?window_hours=24&bucket_hours=24&recent_limit=10",
      });

      expect(workerTrendResponse.statusCode).toBe(200);
      expect(workerTrendResponse.json().counts.started).toBe(1);
      expect(workerTrendResponse.json().counts.error_stops).toBe(1);
      expect(workerTrendResponse.json().counts.abandoned).toBe(1);
      expect(
        workerTrendResponse
          .json()
          .alerts.some((alert: Record<string, unknown>) => alert.signal === "error_stops"),
      ).toBe(true);

      const healthResponse = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json().worker_monitoring.recent_error_stops).toBe(1);
      expect(healthResponse.json().worker_monitoring.recent_abandoned_jobs).toBe(1);
      expect(healthResponse.json().worker_monitoring.trend_alert_count).toBeGreaterThan(0);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Worker trends");
      expect(opsPageResponse.body).toContain("/v1/dashboard/operations");
    } finally {
      await app.close();
    }
  });

  it("reports external integration health, retry pressure, and permanent failures", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const twoMinutesLater = new Date(now.getTime() + 2 * 60_000).toISOString();

      const feedRetrySeed = await repository.enqueueOperationJob({
        operation_name: "feed_pull",
        triggered_by: "script",
        payload: {},
        max_attempts: 3,
        available_at: nowIso,
      });

      const feedRetryJob = await repository.claimNextOperationJob({
        worker_id: "worker-feed",
        as_of: nowIso,
        lease_expires_at: twoMinutesLater,
        supported_operations: ["feed_pull"],
      });

      expect(feedRetryJob?.id).toBe(feedRetrySeed.id);

      await repository.failOperationJob({
        id: feedRetrySeed.id,
        worker_id: "worker-feed",
        finished_at: nowIso,
        error_message: "feed provider returned 429",
        retry_at: twoMinutesLater,
        result_summary: {
          integration: "feed",
          retryable: true,
          status_code: 429,
          retry_after_seconds: 120,
          retry_delay_seconds: 120,
        },
      });

      for (const suffix of ["one", "two"]) {
        const seed = await repository.enqueueOperationJob({
          operation_name: "transcript_pull",
          triggered_by: "script",
          payload: {},
          max_attempts: 1,
          available_at: nowIso,
        });

        const claimed = await repository.claimNextOperationJob({
          worker_id: `worker-transcript-${suffix}`,
          as_of: nowIso,
          lease_expires_at: twoMinutesLater,
          supported_operations: ["transcript_pull"],
        });

        expect(claimed?.id).toBe(seed.id);

        await repository.failOperationJob({
          id: seed.id,
          worker_id: `worker-transcript-${suffix}`,
          finished_at: nowIso,
          error_message: "transcript page returned 404",
          result_summary: {
            integration: "transcript",
            retryable: false,
            status_code: 404,
          },
        });
      }

      const integrationResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/integrations?limit=10",
      });

      expect(integrationResponse.statusCode).toBe(200);
      expect(integrationResponse.json().counts.critical).toBeGreaterThan(0);
      expect(
        integrationResponse
          .json()
          .integrations.some(
            (integration: Record<string, unknown>) =>
              integration.integration === "transcript" &&
              integration.severity === "critical" &&
              integration.non_retryable_failures === 2,
          ),
      ).toBe(true);
      expect(
        integrationResponse
          .json()
          .integrations.some(
            (integration: Record<string, unknown>) =>
              integration.integration === "feed" &&
              integration.retry_scheduled_jobs === 1,
          ),
      ).toBe(true);
      expect(
        integrationResponse
          .json()
          .alerts.some(
            (alert: Record<string, unknown>) =>
              alert.integration === "transcript" && alert.signal === "non_retryable_failures",
          ),
      ).toBe(true);

      const healthResponse = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json().ok).toBe(false);
      expect(healthResponse.json().integration_monitoring.critical_integrations).toBeGreaterThan(0);
      expect(healthResponse.json().integration_monitoring.highest_severity).toBe("critical");

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Integration health");
      expect(opsPageResponse.body).toContain("/v1/dashboard/operations");
    } finally {
      await app.close();
    }
  });

  it("actively probes configured integration providers and surfaces them in readiness and ops", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });
    const originalFeedProbeUrls = process.env.FEED_HEALTH_PROBE_URLS;
    const originalTranscriptProbeUrls = process.env.TRANSCRIPT_HEALTH_PROBE_URLS;
    const originalProbeTimeout = process.env.INTEGRATION_PROBE_TIMEOUT_MS;
    const originalFetch = globalThis.fetch;

    process.env.FEED_HEALTH_PROBE_URLS = "https://example.com/feed-health.xml";
    process.env.TRANSCRIPT_HEALTH_PROBE_URLS = "https://example.com/transcript-health.html";
    process.env.INTEGRATION_PROBE_TIMEOUT_MS = "1000";
    globalThis.fetch = async (input) => {
      const url = String(input);

      if (url.includes("feed-health")) {
        return new Response("<rss><channel><title>Finance Feed</title></channel></rss>", {
          status: 200,
          headers: {
            "content-type": "application/rss+xml",
          },
        });
      }

      if (url.includes("transcript-health")) {
        return new Response("provider busy", {
          status: 503,
          statusText: "Service Unavailable",
          headers: {
            "content-type": "text/html",
          },
        });
      }

      return originalFetch(input as RequestInfo | URL);
    };

    try {
      const probeResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/integration-probes?refresh=true&timeout_ms=1000",
      });

      expect(probeResponse.statusCode).toBe(200);
      expect(probeResponse.json().configured_target_count).toBe(2);
      expect(probeResponse.json().ready_target_count).toBe(1);
      expect(probeResponse.json().degraded_target_count).toBe(1);

      const storedProbeResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/integration-probes?timeout_ms=1000",
      });

      expect(storedProbeResponse.statusCode).toBe(200);
      expect(storedProbeResponse.json().degraded_target_count).toBe(1);

      const governanceRefreshResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/integration-governance?refresh=true",
      });

      expect(governanceRefreshResponse.statusCode).toBe(200);
      expect(
        governanceRefreshResponse
          .json()
          .alerts.some(
            (alert: Record<string, unknown>) =>
              alert.integration === "transcript" && alert.signal === "governance_backpressure",
          ),
      ).toBe(true);

      const readinessResponse = await app.inject({
        method: "GET",
        url: "/ready",
      });

      expect(readinessResponse.statusCode).toBe(503);
      expect(
        readinessResponse
          .json()
          .dependencies.some(
            (dependency: Record<string, unknown>) =>
              dependency.name === "feed_provider" && dependency.status === "ready",
          ),
      ).toBe(true);
      expect(
        readinessResponse
          .json()
          .dependencies.some(
            (dependency: Record<string, unknown>) =>
              dependency.name === "transcript_provider" && dependency.status === "degraded",
          ),
      ).toBe(true);

      globalThis.fetch = async () => {
        throw new Error("passive monitoring should not trigger live provider probes");
      };

      const dashboardOperationsResponse = await app.inject({
        method: "GET",
        url: "/v1/dashboard/operations",
      });

      expect(dashboardOperationsResponse.statusCode).toBe(200);
      expect(dashboardOperationsResponse.json().integration_probes.degraded_target_count).toBe(1);
      expect(
        dashboardOperationsResponse
          .json()
          .integration_governance.states.some(
            (state: Record<string, unknown>) =>
              state.integration === "transcript" && state.action === "throttle",
          ),
      ).toBe(true);
      expect(
        dashboardOperationsResponse
          .json()
          .integration_probes.alerts.some(
            (alert: Record<string, unknown>) =>
              alert.integration === "transcript" && alert.signal === "probe_outage",
          ),
      ).toBe(true);

      const governanceResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/integration-governance",
      });

      expect(governanceResponse.statusCode).toBe(200);
      expect(
        governanceResponse
          .json()
          .alerts.some(
            (alert: Record<string, unknown>) =>
              alert.integration === "transcript" && alert.signal === "governance_backpressure",
          ),
      ).toBe(true);

      const healthResponse = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json().integration_governance_monitoring.throttled_integrations).toBe(1);
      expect(healthResponse.json().integration_probe_monitoring.degraded_targets).toBe(1);
      expect(healthResponse.json().integration_probe_monitoring.missing_snapshots).toBe(0);
      expect(healthResponse.json().integration_probe_monitoring.highest_provider_status).toBe(
        "degraded",
      );

      const incidentResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/incidents",
      });

      expect(incidentResponse.statusCode).toBe(200);
      expect(
        incidentResponse
          .json()
          .incidents.some(
            (incident: Record<string, unknown>) =>
              incident.signal === "transcript_governance_backpressure",
          ),
      ).toBe(true);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Integration probes");
      expect(opsPageResponse.body).toContain("Integration governance");
      expect(opsPageResponse.body).toContain("/v1/dashboard/operations");
    } finally {
      globalThis.fetch = originalFetch;
      if (originalFeedProbeUrls === undefined) {
        delete process.env.FEED_HEALTH_PROBE_URLS;
      } else {
        process.env.FEED_HEALTH_PROBE_URLS = originalFeedProbeUrls;
      }
      if (originalTranscriptProbeUrls === undefined) {
        delete process.env.TRANSCRIPT_HEALTH_PROBE_URLS;
      } else {
        process.env.TRANSCRIPT_HEALTH_PROBE_URLS = originalTranscriptProbeUrls;
      }
      if (originalProbeTimeout === undefined) {
        delete process.env.INTEGRATION_PROBE_TIMEOUT_MS;
      } else {
        process.env.INTEGRATION_PROBE_TIMEOUT_MS = originalProbeTimeout;
      }
      await app.close();
    }
  });

  it("reports integration trends and surfaces them in ops", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const twoMinutesLater = new Date(now.getTime() + 2 * 60_000).toISOString();

      const feedSeed = await repository.enqueueOperationJob({
        operation_name: "feed_pull",
        triggered_by: "script",
        payload: {},
        max_attempts: 3,
        available_at: nowIso,
      });

      await repository.claimNextOperationJob({
        worker_id: "worker-feed-trend",
        as_of: nowIso,
        lease_expires_at: twoMinutesLater,
        supported_operations: ["feed_pull"],
      });

      await repository.failOperationJob({
        id: feedSeed.id,
        worker_id: "worker-feed-trend",
        finished_at: nowIso,
        error_message: "feed provider returned 503",
        retry_at: twoMinutesLater,
        result_summary: {
          integration: "feed",
          retryable: true,
          status_code: 503,
          retry_delay_seconds: 120,
        },
      });

      const transcriptSeed = await repository.enqueueOperationJob({
        operation_name: "transcript_pull",
        triggered_by: "script",
        payload: {},
        max_attempts: 1,
        available_at: nowIso,
      });

      await repository.claimNextOperationJob({
        worker_id: "worker-transcript-trend",
        as_of: nowIso,
        lease_expires_at: twoMinutesLater,
        supported_operations: ["transcript_pull"],
      });

      await repository.failOperationJob({
        id: transcriptSeed.id,
        worker_id: "worker-transcript-trend",
        finished_at: nowIso,
        error_message: "transcript page returned 404",
        result_summary: {
          integration: "transcript",
          retryable: false,
          status_code: 404,
        },
      });

      const trendResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/integration-trends?window_hours=24&bucket_hours=24&recent_limit=10",
      });

      expect(trendResponse.statusCode).toBe(200);
      expect(
        trendResponse
          .json()
          .slices.some(
            (slice: Record<string, unknown>) =>
              slice.integration === "feed" &&
              (slice.counts as Record<string, unknown>).retry_scheduled === 1,
          ),
      ).toBe(true);
      expect(
        trendResponse
          .json()
          .alerts.some(
            (alert: Record<string, unknown>) =>
              alert.integration === "transcript" && alert.signal === "non_retryable_failures",
          ),
      ).toBe(true);

      const healthResponse = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json().integration_monitoring.recent_retry_scheduled).toBe(1);
      expect(healthResponse.json().integration_monitoring.recent_non_retryable_failures).toBe(1);
      expect(healthResponse.json().integration_monitoring.trend_alert_count).toBeGreaterThan(0);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Integration trends");
      expect(opsPageResponse.body).toContain("/v1/dashboard/operations");
    } finally {
      await app.close();
    }
  });

  it("exposes consolidated operational incidents and dashboard operations state", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const now = new Date();
      const nowIso = now.toISOString();
      const oneMinuteAgo = new Date(now.getTime() - 60_000).toISOString();
      const twoMinutesLater = new Date(now.getTime() + 2 * 60_000).toISOString();

      await repository.enqueueOperationJob({
        operation_name: "scheduled_evolution",
        triggered_by: "schedule",
        payload: {},
        max_attempts: 1,
        available_at: nowIso,
      });

      await repository.saveOperationWorkerEvent({
        worker_id: "worker-ops",
        event_type: "stopped",
        occurred_at: oneMinuteAgo,
        lifecycle_state: "stopped",
        cycle_processed: null,
        cycle_completed: null,
        cycle_failed: null,
        cycle_retried: null,
        cycle_abandoned: null,
        error_message: "worker crashed while draining queue",
        metadata: {
          had_error: true,
        },
      });

      await repository.upsertOperationWorkerService({
        service_id: "worker-service-ops",
        worker_id: "worker-ops",
        lifecycle_state: "failed",
        supported_operations: ["scheduled_evolution"],
        supervisor_backoff_ms: 5_000,
        success_window_ms: 60_000,
        heartbeat_interval_ms: 5_000,
        max_restarts: 4,
        restart_count: 4,
        restart_streak: 4,
        heartbeat_at: oneMinuteAgo,
        started_at: oneMinuteAgo,
        last_error_message: "restart limit exceeded",
        stopped_at: nowIso,
      });

      const integrationSeed = await repository.enqueueOperationJob({
        operation_name: "feed_pull",
        triggered_by: "script",
        payload: {},
        max_attempts: 1,
        available_at: nowIso,
      });

      await repository.claimNextOperationJob({
        worker_id: "worker-feed-ops",
        as_of: nowIso,
        lease_expires_at: twoMinutesLater,
        supported_operations: ["feed_pull"],
      });

      await repository.failOperationJob({
        id: integrationSeed.id,
        worker_id: "worker-feed-ops",
        finished_at: nowIso,
        error_message: "feed provider returned 404",
        result_summary: {
          integration: "feed",
          retryable: false,
          status_code: 404,
        },
      });

      const incidentResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/incidents?limit=20",
      });

      expect(incidentResponse.statusCode).toBe(200);
      expect(incidentResponse.json().counts.high).toBeGreaterThan(0);
      expect(
        incidentResponse
          .json()
          .incidents.some((incident: Record<string, unknown>) => incident.source === "worker_service"),
      ).toBe(true);

      const dashboardOperationsResponse = await app.inject({
        method: "GET",
        url: "/v1/dashboard/operations",
      });

      expect(dashboardOperationsResponse.statusCode).toBe(200);
      expect(dashboardOperationsResponse.json().incidents.counts.high).toBeGreaterThan(0);
      expect(dashboardOperationsResponse.json().queue_alerts.counts.high).toBeGreaterThan(0);

      const healthResponse = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(healthResponse.statusCode).toBe(200);
      expect(healthResponse.json().ok).toBe(false);
      expect(healthResponse.json().incident_monitoring.highest_severity).toBe("high");
      expect(healthResponse.json().incident_monitoring.open_incidents).toBeGreaterThan(0);

      const opsPageResponse = await app.inject({
        method: "GET",
        url: "/ops",
      });

      expect(opsPageResponse.statusCode).toBe(200);
      expect(opsPageResponse.body).toContain("Operational incidents");
      expect(opsPageResponse.body).toContain("/v1/dashboard/operations");
    } finally {
      await app.close();
    }
  });

  it("blocks overlapping inline operations when a lease is already active", async () => {
    repository = new InMemoryRepository();
    const app = await buildApp({
      repository,
      marketDataProvider: new MockMarketDataProvider(),
    });

    try {
      const acquired = await repository.acquireOperationLease({
        operation_name: "auto_score",
        scope_key: "global",
        owner: "external-holder",
        acquired_at: "2030-01-01T00:00:00.000Z",
        expires_at: "2030-01-01T01:00:00.000Z",
      });

      expect(acquired).not.toBeNull();

      const lockedResponse = await app.inject({
        method: "POST",
        url: "/v1/operations/auto-score",
        payload: {
          create_postmortems: false,
          as_of: "2030-01-01T00:30:00.000Z",
        },
      });

      expect(lockedResponse.statusCode).toBe(409);
      expect(lockedResponse.json().error).toBe("operation_locked");

      const leaseResponse = await app.inject({
        method: "GET",
        url: "/v1/metrics/system/leases?limit=5",
      });

      expect(leaseResponse.statusCode).toBe(200);
      expect(leaseResponse.json().leases[0].scope_key).toBe("global");
    } finally {
      await app.close();
    }
  });
});
