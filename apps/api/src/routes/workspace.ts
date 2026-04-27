import type { FastifyInstance } from "fastify";
import {
  workspaceActivityResponseSchema,
  workspaceRecentItemSchema,
  workspaceStateResponseSchema,
  listWorkspaceMembersResponseSchema,
} from "@finance-superbrain/schemas";

import type { AppServices } from "../lib/services.js";
import { requireWorkspaceSession } from "../lib/workspaceAuth.js";

export const registerWorkspaceRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.get("/v1/workspace/state", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const [draft, studioRuns, investigations, decisionBriefs, portfolioCandidates, recentItems, activity] = await Promise.all([
      services.repository.getServerStudioDraft({
        workspace_id: session.workspace.id,
        owner_user_id: session.user.id,
      }),
      services.repository.listSharedStudioRuns({
        workspace_id: session.workspace.id,
        limit: 12,
      }),
      services.repository.listSharedInvestigations({
        workspace_id: session.workspace.id,
        limit: 12,
      }),
      services.repository.listDecisionBriefs({
        workspace_id: session.workspace.id,
        limit: 16,
      }),
      services.repository.listPortfolioCandidates({
        workspace_id: session.workspace.id,
        limit: 16,
      }),
      services.repository.listWorkspaceRecentItems({
        workspace_id: session.workspace.id,
        limit: 16,
      }),
      services.repository.listWorkspaceActivity({
        workspace_id: session.workspace.id,
        limit: 64,
      }),
    ]);

    return reply.status(200).send(workspaceStateResponseSchema.parse({
      session,
      draft,
      studio_runs: studioRuns,
      investigations,
      decision_briefs: decisionBriefs,
      portfolio_candidates: portfolioCandidates,
      recent_items: recentItems,
      activity,
    }));
  });

  server.get("/v1/workspace/members", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const members = await services.repository.listWorkspaceMembers(session.workspace.id);

    return reply.status(200).send(listWorkspaceMembersResponseSchema.parse({
      workspace: session.workspace,
      members,
    }));
  });

  server.get("/v1/workspace/activity", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const events = await services.repository.listWorkspaceActivity({
      workspace_id: session.workspace.id,
      limit: 128,
    });

    return reply.status(200).send(workspaceActivityResponseSchema.parse({
      events,
    }));
  });

  server.post("/v1/workspace/recent-items", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = workspaceRecentItemSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const item = await services.repository.saveWorkspaceRecentItem({
      ...parsed.data,
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
    });

    return reply.status(201).send(item);
  });
};
