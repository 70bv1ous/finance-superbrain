import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import { loginRequestSchema } from "@finance-superbrain/schemas";

import type { AppServices } from "../lib/services.js";
import {
  clearLoginRateLimit,
  getLoginRateLimitState,
  recordFailedLoginAttempt,
} from "../lib/loginRateLimit.js";
import {
  clearSessionCookie,
  createSessionToken,
  getSessionTtlMs,
  hashSessionToken,
  requireWorkspaceSession,
  resolveWorkspaceSession,
  setSessionCookie,
  verifyPassword,
} from "../lib/workspaceAuth.js";

export const registerAuthRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.get("/v1/auth/bootstrap", async (_request, reply) => {
    const userCount = await services.repository.countWorkspaceUsers();

    return reply.status(200).send({
      bootstrap_required: userCount === 0,
    });
  });

  server.get("/v1/auth/session", async (request, reply) => {
    const session = await resolveWorkspaceSession(request, services);
    return reply.status(200).send(session);
  });

  server.post("/v1/auth/login", async (request, reply) => {
    const parsed = loginRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: parsed.error.issues.map((issue: { path: PropertyKey[]; message: string }) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    }

    const loginKey = `${request.ip}:${parsed.data.email.trim().toLowerCase()}`;
    const loginRateLimit = getLoginRateLimitState(loginKey);

    if (!loginRateLimit.allowed) {
      return reply.status(429).send({
        error: "rate_limited",
        message: "Too many failed sign-in attempts. Please wait before retrying.",
        retry_after_seconds: loginRateLimit.retry_after_seconds,
      });
    }

    const user = await services.repository.getWorkspaceUserByEmail(parsed.data.email);

    if (!user || !user.active) {
      const blocked = recordFailedLoginAttempt(loginKey);
      return reply.status(401).send({
        error: "invalid_credentials",
        message: "Invalid email or password.",
        retry_after_seconds: blocked.retry_after_seconds || undefined,
      });
    }

    const passwordValid = await verifyPassword(parsed.data.password, user.password_hash);

    if (!passwordValid) {
      const blocked = recordFailedLoginAttempt(loginKey);
      return reply.status(401).send({
        error: "invalid_credentials",
        message: "Invalid email or password.",
        retry_after_seconds: blocked.retry_after_seconds || undefined,
      });
    }

    const workspace = await services.repository.getOrCreateDefaultWorkspace();
    const membership = await services.repository.getWorkspaceMembership({
      workspace_id: workspace.id,
      user_id: user.id,
    });

    if (!membership) {
      return reply.status(403).send({
        error: "membership_missing",
        message: "Workspace membership is missing for this user.",
      });
    }

    clearLoginRateLimit(loginKey);
    const token = createSessionToken();
    const expiresAt = new Date(Date.now() + getSessionTtlMs()).toISOString();
    const session = await services.repository.createUserSession({
      user_id: user.id,
      workspace_id: workspace.id,
      token_hash: hashSessionToken(token),
      expires_at: expiresAt,
      last_seen_at: new Date().toISOString(),
    });

    setSessionCookie(reply, token, expiresAt);
    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: workspace.id,
      actor_user_id: user.id,
      kind: "login",
      investigation_id: null,
      studio_run_id: null,
      prediction_id: null,
      detail: `${user.display_name} signed in.`,
      metadata: {},
      created_at: new Date().toISOString(),
    });

    return reply.status(200).send({
      authenticated: true,
      user: await services.repository.getWorkspaceUserById(user.id),
      workspace,
      membership,
      session,
    });
  });

  server.post("/v1/auth/logout", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      clearSessionCookie(reply);
      return;
    }

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: "logout",
      investigation_id: null,
      studio_run_id: null,
      prediction_id: null,
      detail: `${session.user.display_name} signed out.`,
      metadata: {},
      created_at: new Date().toISOString(),
    });
    await services.repository.revokeUserSession(session.session.id);
    clearSessionCookie(reply);

    return reply.status(200).send({ ok: true });
  });
};
