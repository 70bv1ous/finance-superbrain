import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import {
  listSharedStudioRunsResponseSchema,
  serverStudioDraftSchema,
  sharedStudioRunSchema,
} from "@finance-superbrain/schemas";

import type { AppServices } from "../lib/services.js";
import { requireWorkspaceSession } from "../lib/workspaceAuth.js";

export const registerStudioWorkspaceRoutes = async (
  server: FastifyInstance,
  services: AppServices,
) => {
  server.get("/v1/studio/draft", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const draft = await services.repository.getServerStudioDraft({
      workspace_id: session.workspace.id,
      owner_user_id: session.user.id,
    });

    return reply.status(200).send(draft);
  });

  server.post("/v1/studio/draft", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = serverStudioDraftSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const draft = await services.repository.saveServerStudioDraft({
      ...parsed.data,
      owner_user_id: session.user.id,
    });

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: "studio_draft_saved",
      investigation_id: draft.id,
      studio_run_id: null,
      prediction_id: null,
      detail: `Studio draft ${draft.id} was saved.`,
      metadata: {},
      created_at: new Date().toISOString(),
    });

    return reply.status(201).send(serverStudioDraftSchema.parse(draft));
  });

  server.delete("/v1/studio/draft", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    await services.repository.deleteServerStudioDraft({
      workspace_id: session.workspace.id,
      owner_user_id: session.user.id,
    });

    return reply.status(204).send();
  });

  server.get("/v1/studio/runs", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const runs = await services.repository.listSharedStudioRuns({
      workspace_id: session.workspace.id,
      limit: 24,
    });

    return reply.status(200).send(listSharedStudioRunsResponseSchema.parse({
      runs,
    }));
  });

  server.get("/v1/studio/runs/:runId", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const runId = (request.params as { runId: string }).runId;
    const run = await services.repository.getSharedStudioRun(runId);

    if (!run || run.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Studio run not found.",
      });
    }

    return reply.status(200).send(sharedStudioRunSchema.parse(run));
  });

  server.post("/v1/studio/runs", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = sharedStudioRunSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const run = await services.repository.saveSharedStudioRun({
      ...parsed.data,
      workspace_id: session.workspace.id,
      owner_user_id: parsed.data.owner_user_id || session.user.id,
      last_actor_user_id: session.user.id,
    });

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: "studio_run_saved",
      investigation_id: run.id,
      studio_run_id: run.id,
      prediction_id: run.prediction_ids[0] ?? null,
      detail: `Studio run ${run.title} was saved.`,
      metadata: {
        stage: run.stage,
      },
      created_at: new Date().toISOString(),
    });

    return reply.status(201).send(sharedStudioRunSchema.parse(run));
  });
};
