import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { createWorkspaceUserRequestSchema, workspaceUserSchema } from "@finance-superbrain/schemas";

import { hashPassword, requireWorkspaceSession } from "../lib/workspaceAuth.js";
import type { AppServices } from "../lib/services.js";

export const registerAdminRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.post("/v1/admin/users", async (request, reply) => {
    const parsed = createWorkspaceUserRequestSchema.safeParse(request.body ?? {});
    let actorUserId: string | null = null;

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const userCount = await services.repository.countWorkspaceUsers();

    if (userCount > 0) {
      const session = await requireWorkspaceSession(request, reply, services);

      if (!session) {
        return;
      }

      if (session.membership.role !== "admin") {
        return reply.status(403).send({
          error: "forbidden",
          message: "Only workspace admins can create users.",
        });
      }

      actorUserId = session.user.id;
    }

    const existing = await services.repository.getWorkspaceUserByEmail(parsed.data.email);

    if (existing) {
      return reply.status(409).send({
        error: "duplicate_user",
        message: "A workspace user with that email already exists.",
      });
    }

    const workspace = await services.repository.getOrCreateDefaultWorkspace();
    const password_hash = await hashPassword(parsed.data.password);
    const user = await services.repository.createWorkspaceUser({
      email: parsed.data.email,
      display_name: parsed.data.display_name,
      role: userCount === 0 ? "admin" : parsed.data.role,
      password_hash,
      workspace_id: workspace.id,
      active: true,
    });

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: workspace.id,
      actor_user_id: actorUserId ?? user.id,
      kind: "user_created",
      investigation_id: null,
      studio_run_id: null,
      prediction_id: null,
      detail: `${user.display_name} was added to the workspace.`,
      metadata: {
        email: user.email,
      },
      created_at: new Date().toISOString(),
    });

    return reply.status(201).send(workspaceUserSchema.parse(user));
  });
};
