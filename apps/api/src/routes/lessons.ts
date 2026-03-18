import type { FastifyInstance } from "fastify";
import { listLessonsResponseSchema } from "@finance-superbrain/schemas";

import { searchLessons } from "../lib/lessonSearch.js";
import type { AppServices } from "../lib/services.js";

export const registerLessonRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.get("/v1/lessons", async () =>
    listLessonsResponseSchema.parse({
      lessons: await services.repository.listLessons(),
    }));

  server.get("/v1/lessons/search", async (request, reply) => {
    const query = String((request.query as { q?: string }).q ?? "").trim();

    if (!query) {
      return reply.status(400).send({
        error: "invalid_request",
        message: "Query parameter q is required.",
      });
    }

    return searchLessons(services.repository, query);
  });
};
