import type { FastifyInstance } from "fastify";

import { buildDashboardBenchmark } from "../lib/dashboardBenchmark.js";
import { buildDashboardOperational } from "../lib/dashboardOperational.js";
import { buildDashboardPipeline } from "../lib/dashboardPipeline.js";
import { buildDashboardSummary } from "../lib/dashboardSummary.js";
import { buildOperatorDashboardHtml } from "../lib/operatorDashboardHtml.js";
import type { AppServices } from "../lib/services.js";

export const registerDashboardRoutes = async (
  server: FastifyInstance,
  services: AppServices,
) => {
  server.get("/v1/dashboard/summary", async () =>
    buildDashboardSummary(services.repository));

  server.get("/v1/dashboard/benchmarks", async (request) =>
    buildDashboardBenchmark(services.repository, {
      benchmark_pack_id:
        (request.query as { benchmark_pack_id?: string } | undefined)?.benchmark_pack_id,
    }));

  server.get("/v1/dashboard/operations", async () =>
    buildDashboardOperational(services.repository));

  server.get("/v1/dashboard/pipeline", async () =>
    buildDashboardPipeline(services.repository));

  server.get("/ops", async (_, reply) =>
    reply
      .type("text/html; charset=utf-8")
      .send(buildOperatorDashboardHtml()));
};
