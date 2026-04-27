import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import {
  assignSharedInvestigationRequestSchema,
  listSharedInvestigationsResponseSchema,
  sharedInvestigationSchema,
} from "@finance-superbrain/schemas";

import type { AppServices } from "../lib/services.js";
import { requireWorkspaceSession } from "../lib/workspaceAuth.js";

export const registerInvestigationRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.get("/v1/investigations", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const investigations = await services.repository.listSharedInvestigations({
      workspace_id: session.workspace.id,
      limit: 32,
    });

    return reply.status(200).send(listSharedInvestigationsResponseSchema.parse({
      investigations,
    }));
  });

  server.get("/v1/investigations/:investigationId", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const investigationId = (request.params as { investigationId: string }).investigationId;
    const investigation = await services.repository.getSharedInvestigation(investigationId);

    if (!investigation || investigation.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Investigation not found.",
      });
    }

    return reply.status(200).send(sharedInvestigationSchema.parse(investigation));
  });

  server.post("/v1/investigations/sync", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = sharedInvestigationSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const existing = await services.repository.getSharedInvestigation(parsed.data.id);
    const { steps: nextSteps, ...investigationInput } = parsed.data;
    const saved = await services.repository.saveSharedInvestigation({
      ...investigationInput,
      workspace_id: session.workspace.id,
      owner_user_id: investigationInput.owner_user_id || session.user.id,
      assignee_user_id: investigationInput.assignee_user_id,
      last_actor_user_id: session.user.id,
    });
    const steps = await services.repository.replaceSharedInvestigationSteps({
      investigation_id: saved.id,
      steps: nextSteps,
    });
    const investigation = {
      ...saved,
      steps,
    };

    const wasCreated = !existing;
    const hadStatusChange = existing?.status !== investigation.status;
    const hadPredictionChange =
      JSON.stringify(existing?.prediction_ids ?? []) !== JSON.stringify(investigation.prediction_ids);

    if (wasCreated || hadStatusChange || hadPredictionChange) {
      await services.repository.saveWorkspaceActivity({
        id: randomUUID(),
        workspace_id: session.workspace.id,
        actor_user_id: session.user.id,
        kind: "investigation_updated",
        investigation_id: investigation.id,
        studio_run_id:
          parsed.data.steps.find((step) => step.kind === "studio_run")?.id.replace(/^studio_run:/, "") ?? null,
        prediction_id: investigation.prediction_ids[0] ?? null,
        detail: wasCreated
          ? `Investigation ${investigation.title} was created.`
          : `Investigation ${investigation.title} advanced to ${investigation.status}.`,
        metadata: {
          status: investigation.status,
          source: wasCreated ? "created" : "sync",
        },
        created_at: new Date().toISOString(),
      });
    }

    return reply.status(201).send(sharedInvestigationSchema.parse(investigation));
  });

  server.post("/v1/investigations/:investigationId/assign", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = assignSharedInvestigationRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const investigationId = (request.params as { investigationId: string }).investigationId;
    const updated = await services.repository.assignSharedInvestigation({
      investigation_id: investigationId,
      assignee_user_id: parsed.data.assignee_user_id,
      last_actor_user_id: session.user.id,
      updated_at: new Date().toISOString(),
    });

    if (!updated || updated.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Investigation not found.",
      });
    }

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: "investigation_assigned",
      investigation_id: updated.id,
      studio_run_id: null,
      prediction_id: updated.prediction_ids[0] ?? null,
      detail: updated.assignee_user_id
        ? `Investigation ${updated.title} was assigned.`
        : `Investigation ${updated.title} was unassigned.`,
      metadata: updated.assignee_user_id ? { assignee_user_id: updated.assignee_user_id } : {},
      created_at: new Date().toISOString(),
    });

    return reply.status(200).send(sharedInvestigationSchema.parse(updated));
  });

  server.post("/v1/investigations/:investigationId/reopen", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const investigationId = (request.params as { investigationId: string }).investigationId;
    const current = await services.repository.getSharedInvestigation(investigationId);

    if (!current || current.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Investigation not found.",
      });
    }

    const nextStatus = current.prediction_ids.length ? "ready_for_review" : "drafting";
    const { steps: existingSteps, ...investigationInput } = current;
    const saved = await services.repository.saveSharedInvestigation({
      ...investigationInput,
      status: nextStatus,
      last_actor_user_id: session.user.id,
      updated_at: new Date().toISOString(),
    });
    const investigation = {
      ...saved,
      steps: existingSteps,
    };

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: "investigation_reopened",
      investigation_id: investigation.id,
      studio_run_id: null,
      prediction_id: investigation.prediction_ids[0] ?? null,
      detail: `Investigation ${investigation.title} was reopened.`,
      metadata: {
        status: investigation.status,
      },
      created_at: new Date().toISOString(),
    });

    return reply.status(200).send(sharedInvestigationSchema.parse(investigation));
  });
};
