import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import {
  assignDecisionBriefRequestSchema,
  createDecisionBriefRequestSchema,
  createDecisionCheckpointRequestSchema,
  decisionBriefDetailResponseSchema,
  decisionBriefSchema,
  listDecisionBriefsResponseSchema,
  updateDecisionBriefStatusRequestSchema,
  workspaceDecisionDeskResponseSchema,
} from "@finance-superbrain/schemas";

import type { AppServices } from "../lib/services.js";
import { requireWorkspaceSession } from "../lib/workspaceAuth.js";

const OPEN_DECISION_STATUSES = ["draft", "proposed", "active", "watching"] as const;
const ACTIVE_DECISION_STATUSES = ["active", "watching"] as const;
const PROPOSED_DECISION_STATUSES = ["draft", "proposed"] as const;

const toIssuePayload = (issues: { path: PropertyKey[]; message: string }[]) =>
  issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

export const registerDecisionRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.get("/v1/decision-briefs", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const briefs = await services.repository.listDecisionBriefs({
      workspace_id: session.workspace.id,
      limit: 32,
    });

    return reply.status(200).send(listDecisionBriefsResponseSchema.parse({
      briefs,
    }));
  });

  server.get("/v1/decision-briefs/:decisionBriefId", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const decisionBriefId = (request.params as { decisionBriefId: string }).decisionBriefId;
    const brief = await services.repository.getDecisionBrief(decisionBriefId);

    if (!brief || brief.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Decision brief not found.",
      });
    }

    const checkpoints = await services.repository.listDecisionCheckpoints({
      decision_brief_id: brief.id,
      limit: 64,
    });

    return reply.status(200).send(decisionBriefDetailResponseSchema.parse({
      brief,
      checkpoints,
    }));
  });

  server.post("/v1/decision-briefs", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = createDecisionBriefRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: toIssuePayload(parsed.error.issues),
      });
    }

    const investigation = await services.repository.getSharedInvestigation(parsed.data.investigation_id);

    if (!investigation || investigation.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Investigation not found.",
      });
    }

    if (!investigation.prediction_ids.includes(parsed.data.lead_prediction_id)) {
      return reply.status(400).send({
        error: "invalid_request",
        message: "Lead prediction must belong to the selected investigation.",
      });
    }

    const existingOpen = await services.repository.listDecisionBriefs({
      workspace_id: session.workspace.id,
      investigation_id: investigation.id,
      statuses: [...OPEN_DECISION_STATUSES],
      limit: 1,
    });

    if (existingOpen.length > 0) {
      return reply.status(409).send({
        error: "decision_brief_exists",
        message: "Only one open decision brief is allowed per investigation.",
      });
    }

    const now = new Date().toISOString();
    const brief = await services.repository.saveDecisionBrief({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      investigation_id: investigation.id,
      lead_prediction_id: parsed.data.lead_prediction_id,
      title: parsed.data.title,
      summary: parsed.data.summary,
      thesis: parsed.data.thesis,
      scenario: parsed.data.scenario,
      confidence_label: parsed.data.confidence_label,
      key_assets: parsed.data.key_assets,
      triggers: parsed.data.triggers,
      invalidations: parsed.data.invalidations,
      status: parsed.data.status,
      owner_user_id: session.user.id,
      assignee_user_id: parsed.data.assignee_user_id ?? null,
      last_actor_user_id: session.user.id,
      next_review_due_at: parsed.data.next_review_due_at ?? null,
      closed_at: parsed.data.status === "closed" ? now : null,
      updated_at: now,
      created_at: now,
    });

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: "decision_brief_created",
      investigation_id: brief.investigation_id,
      studio_run_id: null,
      prediction_id: brief.lead_prediction_id,
      detail: `Decision brief ${brief.title} was created.`,
      metadata: {
        decision_brief_id: brief.id,
        status: brief.status,
      },
      created_at: now,
    });

    return reply.status(201).send(decisionBriefSchema.parse(brief));
  });

  server.post("/v1/decision-briefs/:decisionBriefId/assign", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = assignDecisionBriefRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: toIssuePayload(parsed.error.issues),
      });
    }

    const updated = await services.repository.assignDecisionBrief({
      decision_brief_id: (request.params as { decisionBriefId: string }).decisionBriefId,
      assignee_user_id: parsed.data.assignee_user_id,
      last_actor_user_id: session.user.id,
      updated_at: new Date().toISOString(),
    });

    if (!updated || updated.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Decision brief not found.",
      });
    }

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: "decision_brief_assigned",
      investigation_id: updated.investigation_id,
      studio_run_id: null,
      prediction_id: updated.lead_prediction_id,
      detail: updated.assignee_user_id
        ? `Decision brief ${updated.title} was assigned.`
        : `Decision brief ${updated.title} was unassigned.`,
      metadata: {
        decision_brief_id: updated.id,
        assignee_user_id: updated.assignee_user_id,
      },
      created_at: updated.updated_at,
    });

    return reply.status(200).send(decisionBriefSchema.parse(updated));
  });

  server.post("/v1/decision-briefs/:decisionBriefId/status", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = updateDecisionBriefStatusRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: toIssuePayload(parsed.error.issues),
      });
    }

    const decisionBriefId = (request.params as { decisionBriefId: string }).decisionBriefId;
    const current = await services.repository.getDecisionBrief(decisionBriefId);

    if (!current || current.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Decision brief not found.",
      });
    }

    const now = new Date().toISOString();
    const status = parsed.data.status;
    const updated = await services.repository.updateDecisionBriefStatus({
      decision_brief_id: decisionBriefId,
      status,
      last_actor_user_id: session.user.id,
      updated_at: now,
      next_review_due_at:
        parsed.data.next_review_due_at === undefined ? current.next_review_due_at : parsed.data.next_review_due_at,
      closed_at: status === "closed" ? now : null,
    });

    if (!updated) {
      return reply.status(404).send({
        error: "not_found",
        message: "Decision brief not found.",
      });
    }

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: status === "closed" ? "decision_brief_closed" : "decision_brief_status_changed",
      investigation_id: updated.investigation_id,
      studio_run_id: null,
      prediction_id: updated.lead_prediction_id,
      detail:
        status === "closed"
          ? `Decision brief ${updated.title} was closed.`
          : `Decision brief ${updated.title} moved to ${updated.status}.`,
      metadata: {
        decision_brief_id: updated.id,
        status: updated.status,
        previous_status: current.status,
      },
      created_at: now,
    });

    return reply.status(200).send(decisionBriefSchema.parse(updated));
  });

  server.post("/v1/decision-briefs/:decisionBriefId/checkpoints", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = createDecisionCheckpointRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: toIssuePayload(parsed.error.issues),
      });
    }

    const decisionBriefId = (request.params as { decisionBriefId: string }).decisionBriefId;
    const current = await services.repository.getDecisionBrief(decisionBriefId);

    if (!current || current.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Decision brief not found.",
      });
    }

    if (current.status === "closed") {
      return reply.status(409).send({
        error: "decision_brief_closed",
        message: "Closed decision briefs cannot accept new checkpoints.",
      });
    }

    const now = new Date().toISOString();
    await services.repository.saveDecisionCheckpoint({
      id: randomUUID(),
      decision_brief_id: current.id,
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      summary: parsed.data.summary,
      thesis_state: parsed.data.thesis_state,
      action: parsed.data.action,
      created_at: now,
    });

    const nextStatus =
      parsed.data.action === "move_to_watching"
        ? "watching"
        : parsed.data.action === "close"
          ? "closed"
          : "active";

    const updated = await services.repository.updateDecisionBriefStatus({
      decision_brief_id: current.id,
      status: nextStatus,
      last_actor_user_id: session.user.id,
      updated_at: now,
      next_review_due_at:
        nextStatus === "closed"
          ? null
          : parsed.data.next_review_due_at === undefined
            ? current.next_review_due_at
            : parsed.data.next_review_due_at,
      closed_at: nextStatus === "closed" ? now : null,
    });

    if (!updated) {
      return reply.status(404).send({
        error: "not_found",
        message: "Decision brief not found.",
      });
    }

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: "decision_checkpoint_saved",
      investigation_id: updated.investigation_id,
      studio_run_id: null,
      prediction_id: updated.lead_prediction_id,
      detail: `Checkpoint saved for decision brief ${updated.title}.`,
      metadata: {
        decision_brief_id: updated.id,
        thesis_state: parsed.data.thesis_state,
        action: parsed.data.action,
        next_review_due_at: updated.next_review_due_at,
      },
      created_at: now,
    });

    if (nextStatus === "closed") {
      await services.repository.saveWorkspaceActivity({
        id: randomUUID(),
        workspace_id: session.workspace.id,
        actor_user_id: session.user.id,
        kind: "decision_brief_closed",
        investigation_id: updated.investigation_id,
        studio_run_id: null,
        prediction_id: updated.lead_prediction_id,
        detail: `Decision brief ${updated.title} was closed.`,
        metadata: {
          decision_brief_id: updated.id,
          source: "checkpoint",
        },
        created_at: now,
      });
    } else if (current.status !== updated.status) {
      await services.repository.saveWorkspaceActivity({
        id: randomUUID(),
        workspace_id: session.workspace.id,
        actor_user_id: session.user.id,
        kind: "decision_brief_status_changed",
        investigation_id: updated.investigation_id,
        studio_run_id: null,
        prediction_id: updated.lead_prediction_id,
        detail: `Decision brief ${updated.title} moved to ${updated.status}.`,
        metadata: {
          decision_brief_id: updated.id,
          previous_status: current.status,
          status: updated.status,
          source: "checkpoint",
        },
        created_at: now,
      });
    }

    const checkpoints = await services.repository.listDecisionCheckpoints({
      decision_brief_id: updated.id,
      limit: 64,
    });

    return reply.status(201).send(decisionBriefDetailResponseSchema.parse({
      brief: updated,
      checkpoints,
    }));
  });

  server.get("/v1/workspace/decision-desk", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const asOf = new Date().toISOString();
    const [activePool, proposedBriefs, recentlyClosedBriefs] = await Promise.all([
      services.repository.listDecisionBriefs({
        workspace_id: session.workspace.id,
        statuses: [...ACTIVE_DECISION_STATUSES],
        limit: 64,
      }),
      services.repository.listDecisionBriefs({
        workspace_id: session.workspace.id,
        statuses: [...PROPOSED_DECISION_STATUSES],
        limit: 12,
      }),
      services.repository.listDecisionBriefs({
        workspace_id: session.workspace.id,
        statuses: ["closed"],
        limit: 12,
      }),
    ]);

    const dueBriefs = activePool
      .filter((brief) => brief.next_review_due_at !== null && brief.next_review_due_at <= asOf)
      .slice(0, 12);

    return reply.status(200).send(workspaceDecisionDeskResponseSchema.parse({
      active_briefs: activePool.slice(0, 12),
      proposed_briefs: proposedBriefs,
      due_briefs: dueBriefs,
      recently_closed_briefs: recentlyClosedBriefs,
    }));
  });
};
