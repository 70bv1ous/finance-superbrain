import Fastify from "fastify";
import cors from "@fastify/cors";

import { buildServices } from "./lib/services.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerIngestionRoutes } from "./routes/ingestion.js";
import { registerLessonRoutes } from "./routes/lessons.js";
import { registerMetricRoutes } from "./routes/metrics.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerOperationRoutes } from "./routes/operations.js";
import { registerPredictionRoutes } from "./routes/predictions.js";
import { registerSourceRoutes } from "./routes/sources.js";
import { registerTranscriptSessionRoutes } from "./routes/transcriptSessions.js";
import { registerChatRoutes }     from "./routes/chat.js";
import { registerBriefingRoutes } from "./routes/briefing.js";

export const buildApp = async (options: Parameters<typeof buildServices>[0] = {}) => {
  const server = Fastify({
    logger: false,
  });
  const services = buildServices(options);

  await server.register(cors, {
    origin: true,
  });

  await registerHealthRoutes(server, services);
  await registerDashboardRoutes(server, services);
  await registerModelRoutes(server, services);
  await registerSourceRoutes(server, services);
  await registerEventRoutes(server, services);
  await registerIngestionRoutes(server, services);
  await registerTranscriptSessionRoutes(server, services);
  await registerPredictionRoutes(server, services);
  await registerLessonRoutes(server, services);
  await registerMetricRoutes(server, services);
  await registerOperationRoutes(server, services);
  await registerChatRoutes(server, services);
  await registerBriefingRoutes(server, services);

  server.addHook("onClose", async () => {
    await services.marketDataProvider.close?.();
    await services.embeddingProvider.close?.();
    await services.repository.close?.();
  });

  return server;
};
