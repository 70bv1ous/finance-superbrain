import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import {
  createPortfolioReviewSessionRequestSchema,
  listPortfolioReviewSessionsResponseSchema,
  portfolioReviewSessionDetailResponseSchema,
  portfolioReviewSessionSchema,
  savePortfolioRebalanceProposalRequestSchema,
  updatePortfolioReviewSessionRequestSchema,
  updatePortfolioReviewSessionStatusRequestSchema,
  type PortfolioCandidate,
  type PortfolioRebalanceProposal,
  type PortfolioReviewSession,
} from "@finance-superbrain/schemas";

import type { AppServices } from "../lib/services.js";
import { requireWorkspaceSession } from "../lib/workspaceAuth.js";

const OPEN_PORTFOLIO_STATUSES = ["candidate", "active", "watching", "trimmed"] as const;

const toIssuePayload = (issues: { path: PropertyKey[]; message: string }[]) =>
  issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

function buildDefaultReviewTitle(now: string) {
  return `Portfolio review ${now.slice(0, 10)}`;
}

function buildDefaultReviewSummary() {
  return "Review the live portfolio set, capture rebalance proposals, and preserve the rationale behind each portfolio-wide decision.";
}

function buildSessionCounts(
  proposals: PortfolioRebalanceProposal[],
  itemCount: number,
) {
  const approvedCount = proposals.filter((proposal) => proposal.status === "approved").length;
  const unresolvedCount =
    itemCount -
    new Set(
      proposals
        .filter((proposal) => proposal.status === "approved" || proposal.status === "rejected")
        .map((proposal) => proposal.portfolio_candidate_id),
    ).size;

  return {
    proposal_count: proposals.length,
    approved_count: approvedCount,
    unresolved_count: Math.max(0, unresolvedCount),
  };
}

async function loadSessionOr404(
  services: AppServices,
  reviewSessionId: string,
  workspaceId: string,
  reply: { status: (code: number) => { send: (payload: unknown) => unknown } },
) {
  const session = await services.repository.getPortfolioReviewSession(reviewSessionId);

  if (!session || session.workspace_id !== workspaceId) {
    reply.status(404).send({
      error: "not_found",
      message: "Portfolio review session not found.",
    });
    return null;
  }

  return session;
}

export const registerPortfolioReviewRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.get("/v1/portfolio/reviews", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const reviewSessions = await services.repository.listPortfolioReviewSessions({
      workspace_id: session.workspace.id,
      limit: 24,
    });

    const sessions = await Promise.all(
      reviewSessions.map(async (reviewSession) => {
        const [items, proposals] = await Promise.all([
          services.repository.listPortfolioReviewSessionItems({
            review_session_id: reviewSession.id,
          }),
          services.repository.listPortfolioRebalanceProposals({
            review_session_id: reviewSession.id,
          }),
        ]);

        return {
          session: reviewSession,
          item_count: items.length,
          ...buildSessionCounts(proposals, items.length),
        };
      }),
    );

    return reply.status(200).send(listPortfolioReviewSessionsResponseSchema.parse({
      sessions,
    }));
  });

  server.post("/v1/portfolio/reviews", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = createPortfolioReviewSessionRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: toIssuePayload(parsed.error.issues),
      });
    }

    const allOpenCandidates = await services.repository.listPortfolioCandidates({
      workspace_id: session.workspace.id,
      statuses: [...OPEN_PORTFOLIO_STATUSES],
      limit: 128,
    });

    const candidates =
      parsed.data.portfolio_candidate_ids?.length
        ? allOpenCandidates.filter((candidate) => parsed.data.portfolio_candidate_ids?.includes(candidate.id))
        : allOpenCandidates;

    if (!candidates.length) {
      return reply.status(409).send({
        error: "no_portfolio_candidates",
        message: "No open portfolio candidates are available to seed a review session.",
      });
    }

    const now = new Date().toISOString();
    const reviewSession = await services.repository.savePortfolioReviewSession({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      title: parsed.data.title?.trim() || buildDefaultReviewTitle(now),
      summary: parsed.data.summary?.trim() || buildDefaultReviewSummary(),
      status: "draft",
      owner_user_id: session.user.id,
      last_actor_user_id: session.user.id,
      opened_at: now,
      finalized_at: null,
      created_at: now,
      updated_at: now,
    });

    const items = await Promise.all(
      candidates.map((candidate) =>
        services.repository.savePortfolioReviewSessionItem({
          id: randomUUID(),
          review_session_id: reviewSession.id,
          portfolio_candidate_id: candidate.id,
          snapshot_status: candidate.status,
          snapshot_priority: candidate.priority,
          snapshot_primary_theme: candidate.primary_theme,
          snapshot_assignee_user_id: candidate.assignee_user_id,
          snapshot_next_review_due_at: candidate.next_review_due_at,
          created_at: now,
        }),
      ),
    );

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: "portfolio_review_session_created",
      investigation_id: null,
      studio_run_id: null,
      prediction_id: null,
      detail: `Portfolio review session ${reviewSession.title} was created.`,
      metadata: {
        review_session_id: reviewSession.id,
        item_count: items.length,
      },
      created_at: now,
    });

    return reply.status(201).send(portfolioReviewSessionDetailResponseSchema.parse({
      session: reviewSession,
      items,
      proposals: [],
    }));
  });

  server.get("/v1/portfolio/reviews/:reviewSessionId", async (request, reply) => {
    const workspaceSession = await requireWorkspaceSession(request, reply, services);

    if (!workspaceSession) {
      return;
    }

    const reviewSessionId = (request.params as { reviewSessionId: string }).reviewSessionId;
    const reviewSession = await loadSessionOr404(services, reviewSessionId, workspaceSession.workspace.id, reply);

    if (!reviewSession) {
      return;
    }

    const [items, proposals] = await Promise.all([
      services.repository.listPortfolioReviewSessionItems({
        review_session_id: reviewSession.id,
      }),
      services.repository.listPortfolioRebalanceProposals({
        review_session_id: reviewSession.id,
      }),
    ]);

    return reply.status(200).send(portfolioReviewSessionDetailResponseSchema.parse({
      session: reviewSession,
      items,
      proposals,
    }));
  });

  server.post("/v1/portfolio/reviews/:reviewSessionId", async (request, reply) => {
    const workspaceSession = await requireWorkspaceSession(request, reply, services);

    if (!workspaceSession) {
      return;
    }

    const parsed = updatePortfolioReviewSessionRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: toIssuePayload(parsed.error.issues),
      });
    }

    const reviewSessionId = (request.params as { reviewSessionId: string }).reviewSessionId;
    const current = await loadSessionOr404(services, reviewSessionId, workspaceSession.workspace.id, reply);

    if (!current) {
      return;
    }

    if (current.status === "finalized") {
      return reply.status(409).send({
        error: "review_session_finalized",
        message: "Finalized review sessions cannot be edited.",
      });
    }

    const now = new Date().toISOString();
    const updated = await services.repository.savePortfolioReviewSession({
      ...current,
      title: parsed.data.title?.trim() || current.title,
      summary: parsed.data.summary?.trim() || current.summary,
      last_actor_user_id: workspaceSession.user.id,
      updated_at: now,
    });

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: workspaceSession.workspace.id,
      actor_user_id: workspaceSession.user.id,
      kind: "portfolio_review_session_updated",
      investigation_id: null,
      studio_run_id: null,
      prediction_id: null,
      detail: `Portfolio review session ${updated.title} was updated.`,
      metadata: {
        review_session_id: updated.id,
        status: updated.status,
      },
      created_at: now,
    });

    return reply.status(200).send(portfolioReviewSessionSchema.parse(updated));
  });

  server.post("/v1/portfolio/reviews/:reviewSessionId/status", async (request, reply) => {
    const workspaceSession = await requireWorkspaceSession(request, reply, services);

    if (!workspaceSession) {
      return;
    }

    const parsed = updatePortfolioReviewSessionStatusRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: toIssuePayload(parsed.error.issues),
      });
    }

    const reviewSessionId = (request.params as { reviewSessionId: string }).reviewSessionId;
    const current = await loadSessionOr404(services, reviewSessionId, workspaceSession.workspace.id, reply);

    if (!current) {
      return;
    }

    if (current.status === "finalized" && parsed.data.status !== "finalized") {
      return reply.status(409).send({
        error: "review_session_finalized",
        message: "Finalized review sessions cannot be reopened.",
      });
    }

    const now = new Date().toISOString();
    const updated = await services.repository.savePortfolioReviewSession({
      ...current,
      status: parsed.data.status,
      summary: parsed.data.summary?.trim() || current.summary,
      last_actor_user_id: workspaceSession.user.id,
      finalized_at: parsed.data.status === "finalized" ? now : null,
      updated_at: now,
    });

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: workspaceSession.workspace.id,
      actor_user_id: workspaceSession.user.id,
      kind:
        parsed.data.status === "finalized"
          ? "portfolio_review_session_finalized"
          : "portfolio_review_session_updated",
      investigation_id: null,
      studio_run_id: null,
      prediction_id: null,
      detail:
        parsed.data.status === "finalized"
          ? `Portfolio review session ${updated.title} was finalized.`
          : `Portfolio review session ${updated.title} moved to ${updated.status}.`,
      metadata: {
        review_session_id: updated.id,
        status: updated.status,
        previous_status: current.status,
      },
      created_at: now,
    });

    return reply.status(200).send(portfolioReviewSessionSchema.parse(updated));
  });

  server.post("/v1/portfolio/reviews/:reviewSessionId/proposals", async (request, reply) => {
    const workspaceSession = await requireWorkspaceSession(request, reply, services);

    if (!workspaceSession) {
      return;
    }

    const parsed = savePortfolioRebalanceProposalRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: toIssuePayload(parsed.error.issues),
      });
    }

    const reviewSessionId = (request.params as { reviewSessionId: string }).reviewSessionId;
    const reviewSession = await loadSessionOr404(services, reviewSessionId, workspaceSession.workspace.id, reply);

    if (!reviewSession) {
      return;
    }

    if (reviewSession.status === "finalized") {
      return reply.status(409).send({
        error: "review_session_finalized",
        message: "Finalized review sessions cannot accept new proposals.",
      });
    }

    const [items, candidate] = await Promise.all([
      services.repository.listPortfolioReviewSessionItems({
        review_session_id: reviewSession.id,
      }),
      services.repository.getPortfolioCandidate(parsed.data.portfolio_candidate_id),
    ]);

    if (!candidate || candidate.workspace_id !== workspaceSession.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Portfolio candidate not found.",
      });
    }

    if (!items.find((item) => item.portfolio_candidate_id === candidate.id)) {
      return reply.status(409).send({
        error: "candidate_not_in_review_session",
        message: "This portfolio candidate is not part of the review session snapshot.",
      });
    }

    const existing = parsed.data.proposal_id
      ? (
          await services.repository.listPortfolioRebalanceProposals({
            review_session_id: reviewSession.id,
          })
        ).find((proposal) => proposal.id === parsed.data.proposal_id) ?? null
      : null;

    const now = new Date().toISOString();
    const proposal = await services.repository.savePortfolioRebalanceProposal({
      id: existing?.id ?? randomUUID(),
      review_session_id: reviewSession.id,
      portfolio_candidate_id: candidate.id,
      actor_user_id: workspaceSession.user.id,
      action: parsed.data.action,
      status: parsed.data.status,
      rationale: parsed.data.rationale.trim(),
      dependency_note: parsed.data.dependency_note?.trim() || null,
      next_review_expectation: parsed.data.next_review_expectation?.trim() || null,
      decided_at:
        parsed.data.status === "approved" || parsed.data.status === "deferred" || parsed.data.status === "rejected"
          ? now
          : null,
      created_at: existing?.created_at ?? now,
      updated_at: now,
    });

    await services.repository.savePortfolioReviewSession({
      ...reviewSession,
      status: reviewSession.status === "draft" ? "in_review" : reviewSession.status,
      last_actor_user_id: workspaceSession.user.id,
      updated_at: now,
    });

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: workspaceSession.workspace.id,
      actor_user_id: workspaceSession.user.id,
      kind:
        proposal.status === "approved" || proposal.status === "deferred" || proposal.status === "rejected"
          ? "portfolio_rebalance_proposal_decided"
          : "portfolio_rebalance_proposal_saved",
      investigation_id: candidate.investigation_id,
      studio_run_id: null,
      prediction_id: candidate.lead_prediction_id,
      detail:
        proposal.status === "approved" || proposal.status === "deferred" || proposal.status === "rejected"
          ? `Portfolio rebalance proposal for ${candidate.title} was marked ${proposal.status}.`
          : `Portfolio rebalance proposal saved for ${candidate.title}.`,
      metadata: {
        review_session_id: reviewSession.id,
        portfolio_candidate_id: candidate.id,
        action: proposal.action,
        status: proposal.status,
      },
      created_at: now,
    });

    return reply.status(201).send(proposal);
  });
};
