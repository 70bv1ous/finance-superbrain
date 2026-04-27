import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuthSessionResponse } from "@finance-superbrain/schemas";

import type { AppServices } from "./services.js";

const scrypt = promisify(scryptCallback);

export const WORKSPACE_SESSION_COOKIE = "finance_superbrain_session";

export type AuthenticatedWorkspaceSession = AuthSessionResponse & {
  authenticated: true;
  user: NonNullable<AuthSessionResponse["user"]>;
  workspace: NonNullable<AuthSessionResponse["workspace"]>;
  membership: NonNullable<AuthSessionResponse["membership"]>;
  session: NonNullable<AuthSessionResponse["session"]>;
};

const sessionTtlHours = Number(process.env.AUTH_SESSION_TTL_HOURS ?? 168);

export const getSessionTtlMs = () => sessionTtlHours * 60 * 60 * 1000;
const resolveCookieSameSite = () => {
  const sameSite = (process.env.AUTH_COOKIE_SAME_SITE ?? "lax").trim().toLowerCase();

  if (sameSite === "none") {
    return "None";
  }

  if (sameSite === "strict") {
    return "Strict";
  }

  return "Lax";
};

const resolveCookieSecure = () => {
  const sameSite = resolveCookieSameSite();
  return process.env.AUTH_COOKIE_SECURE === "true" || process.env.NODE_ENV === "production" || sameSite === "None";
};

export const createSessionToken = () => randomBytes(32).toString("hex");

export const hashSessionToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

export const hashPassword = async (password: string) => {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
};

export const verifyPassword = async (password: string, storedHash: string) => {
  const [algorithm, salt, expected] = storedHash.split("$");

  if (algorithm !== "scrypt" || !salt || !expected) {
    return false;
  }

  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expectedBuffer = Buffer.from(expected, "hex");

  if (expectedBuffer.length !== derived.length) {
    return false;
  }

  return timingSafeEqual(derived, expectedBuffer);
};

const parseCookieHeader = (value: string | undefined) => {
  if (!value) {
    return new Map<string, string>();
  }

  return new Map(
    value
      .split(";")
      .map((part) => part.trim())
      .map((part) => {
        const separator = part.indexOf("=");
        return separator === -1 ? [part, ""] : [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
};

export const setSessionCookie = (reply: FastifyReply, token: string, expiresAt: string) => {
  const secure = resolveCookieSecure();
  const sameSite = resolveCookieSameSite();
  const maxAgeSeconds = Math.max(0, Math.floor((Date.parse(expiresAt) - Date.now()) / 1000));
  const parts = [
    `${WORKSPACE_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite}`,
    `Max-Age=${maxAgeSeconds}`,
  ];

  if (secure) {
    parts.push("Secure");
  }

  reply.header("Set-Cookie", parts.join("; "));
};

export const clearSessionCookie = (reply: FastifyReply) => {
  const secure = resolveCookieSecure();
  const sameSite = resolveCookieSameSite();
  const parts = [
    `${WORKSPACE_SESSION_COOKIE}=`,
    "Path=/",
    "HttpOnly",
    `SameSite=${sameSite}`,
    "Max-Age=0",
  ];

  if (secure) {
    parts.push("Secure");
  }

  reply.header("Set-Cookie", parts.join("; "));
};

export const resolveWorkspaceSession = async (
  request: FastifyRequest,
  services: AppServices,
): Promise<AuthSessionResponse> => {
  const cookieValue = parseCookieHeader(request.headers.cookie).get(WORKSPACE_SESSION_COOKIE);

  if (!cookieValue) {
    return {
      authenticated: false,
      user: null,
      workspace: null,
      membership: null,
      session: null,
    };
  }

  const session = await services.repository.getUserSessionByTokenHash(hashSessionToken(cookieValue));

  if (!session || Date.parse(session.expires_at) <= Date.now()) {
    if (session) {
      await services.repository.revokeUserSession(session.id);
    }

    return {
      authenticated: false,
      user: null,
      workspace: null,
      membership: null,
      session: null,
    };
  }

  const [user, workspace, membership] = await Promise.all([
    services.repository.getWorkspaceUserById(session.user_id),
    services.repository.getOrCreateDefaultWorkspace(),
    services.repository.getWorkspaceMembership({
      workspace_id: session.workspace_id,
      user_id: session.user_id,
    }),
  ]);

  if (!user || !membership || !user.active) {
    await services.repository.revokeUserSession(session.id);
    return {
      authenticated: false,
      user: null,
      workspace: null,
      membership: null,
      session: null,
    };
  }

  const refreshedSession = await services.repository.touchUserSession(session.id, new Date().toISOString());

  return {
    authenticated: true,
    user,
    workspace,
    membership,
    session: refreshedSession ?? session,
  };
};

export const requireWorkspaceSession = async (
  request: FastifyRequest,
  reply: FastifyReply,
  services: AppServices,
): Promise<AuthenticatedWorkspaceSession | null> => {
  const session = await resolveWorkspaceSession(request, services);

  if (!session.authenticated || !session.user || !session.workspace || !session.membership || !session.session) {
    await reply.status(401).send({
      error: "unauthorized",
      message: "Sign in to access the workspace.",
    });
    return null;
  }

  return session as AuthenticatedWorkspaceSession;
};
