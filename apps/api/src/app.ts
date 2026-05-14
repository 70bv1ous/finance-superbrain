import Fastify from "fastify";
import cors from "@fastify/cors";

import { buildServices } from "./lib/services.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerAdminRoutes } from "./routes/admin.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerDecisionRoutes } from "./routes/decisions.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerIngestionRoutes } from "./routes/ingestion.js";
import { registerInvestigationRoutes } from "./routes/investigations.js";
import { registerLessonRoutes } from "./routes/lessons.js";
import { registerMetricRoutes } from "./routes/metrics.js";
import { registerMemoryRoutes } from "./routes/memory.js";
import { registerObsidianRoutes } from "./routes/obsidian.js";
import { registerModelRoutes } from "./routes/models.js";
import { registerOperationRoutes } from "./routes/operations.js";
import { registerPortfolioRoutes } from "./routes/portfolio.js";
import { registerPortfolioReviewRoutes } from "./routes/portfolioReviews.js";
import { registerPredictionRoutes } from "./routes/predictions.js";
import { registerSourceRoutes } from "./routes/sources.js";
import { registerTranscriptSessionRoutes } from "./routes/transcriptSessions.js";
import { registerChatRoutes }       from "./routes/chat.js";
import { registerBriefingRoutes }   from "./routes/briefing.js";
import { registerEvaluationRoutes } from "./routes/evaluation.js";
import { registerStudioWorkspaceRoutes } from "./routes/studioWorkspace.js";
import { registerWorkspaceRoutes } from "./routes/workspace.js";

const parseAllowedOrigins = () =>
  (process.env.AUTH_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

export const buildApp = async (options: Parameters<typeof buildServices>[0] = {}) => {
  const server = Fastify({
    logger: false,
  });
  const services = buildServices(options);
  const allowedOrigins = parseAllowedOrigins();

  await server.register(cors, {
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    credentials: true,
    methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type"],
  });

  await registerAuthRoutes(server, services);
  await registerAdminRoutes(server, services);
  await registerHealthRoutes(server, services);
  await registerDashboardRoutes(server, services);
  await registerModelRoutes(server, services);
  await registerSourceRoutes(server, services);
  await registerEventRoutes(server, services);
  await registerIngestionRoutes(server, services);
  await registerTranscriptSessionRoutes(server, services);
  await registerPredictionRoutes(server, services);
  await registerDecisionRoutes(server, services);
  await registerPortfolioRoutes(server, services);
  await registerPortfolioReviewRoutes(server, services);
  await registerLessonRoutes(server, services);
  await registerMetricRoutes(server, services);
  await registerMemoryRoutes(server, services);
  await registerObsidianRoutes(server, services);
  await registerOperationRoutes(server, services);
  await registerWorkspaceRoutes(server, services);
  await registerInvestigationRoutes(server, services);
  await registerStudioWorkspaceRoutes(server, services);
  await registerChatRoutes(server, services);
  await registerBriefingRoutes(server, services);
  await registerEvaluationRoutes(server, services);

  server.addHook("onClose", async () => {
    await services.marketDataProvider.close?.();
    await services.embeddingProvider.close?.();
    await services.repository.close?.();
  });

  return server;
};
