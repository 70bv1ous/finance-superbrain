import { randomUUID } from "node:crypto";

import type { FastifyInstance } from "fastify";
import {
  assignPortfolioCandidateRequestSchema,
  createPortfolioCandidateRequestSchema,
  createPortfolioCheckpointRequestSchema,
  type PortfolioCandidate,
  type PortfolioCheckpoint,
  listPortfolioCandidatesResponseSchema,
  portfolioCandidatePostureUpdateRequestSchema,
  portfolioCandidateDetailResponseSchema,
  portfolioCandidateSchema,
  updatePortfolioCandidateStatusRequestSchema,
  workspacePortfolioDeskResponseSchema,
} from "@finance-superbrain/schemas";

import type { AppServices } from "../lib/services.js";
import { requireWorkspaceSession } from "../lib/workspaceAuth.js";

const OPEN_PORTFOLIO_STATUSES = ["candidate", "active", "watching", "trimmed"] as const;
const ACTIVE_PORTFOLIO_STATUSES = ["active", "watching", "trimmed"] as const;
const DUE_SOON_WINDOW_MS = 1000 * 60 * 60 * 48;
const STALE_FOLLOW_THROUGH_MS = 1000 * 60 * 60 * 24 * 7;

const toIssuePayload = (issues: { path: PropertyKey[]; message: string }[]) =>
  issues.map((issue) => ({
    path: issue.path.join("."),
    message: issue.message,
  }));

function isLivePortfolioCandidate(candidate: PortfolioCandidate) {
  return candidate.status === "active" || candidate.status === "watching" || candidate.status === "trimmed";
}

function getLatestCheckpointTimestamp(
  latestCheckpointByCandidateId: Map<string, PortfolioCheckpoint>,
  candidate: PortfolioCandidate,
) {
  const latestCheckpoint = latestCheckpointByCandidateId.get(candidate.id);
  return Date.parse(latestCheckpoint?.created_at ?? candidate.updated_at);
}

function isReviewDueSoon(candidate: PortfolioCandidate, asOfTimestamp: number) {
  if (!isLivePortfolioCandidate(candidate) || !candidate.next_review_due_at) {
    return false;
  }

  const dueAt = Date.parse(candidate.next_review_due_at);
  return dueAt > asOfTimestamp && dueAt <= asOfTimestamp + DUE_SOON_WINDOW_MS;
}

function isStaleWatchingCandidate(
  candidate: PortfolioCandidate,
  asOfTimestamp: number,
  latestCheckpointByCandidateId: Map<string, PortfolioCheckpoint>,
) {
  return (
    candidate.status === "watching" &&
    getLatestCheckpointTimestamp(latestCheckpointByCandidateId, candidate) <= asOfTimestamp - STALE_FOLLOW_THROUGH_MS
  );
}

function isTrimmedPendingFollowupCandidate(
  candidate: PortfolioCandidate,
  asOfTimestamp: number,
  latestCheckpointByCandidateId: Map<string, PortfolioCheckpoint>,
) {
  if (candidate.status !== "trimmed") {
    return false;
  }

  if (!candidate.next_review_due_at) {
    return true;
  }

  return getLatestCheckpointTimestamp(latestCheckpointByCandidateId, candidate) <= asOfTimestamp - STALE_FOLLOW_THROUGH_MS;
}

function sortCountEntries<T extends { count: number }>(
  entries: T[],
  getLabel: (entry: T) => string,
) {
  return entries.sort((left, right) => {
    if (right.count !== left.count) {
      return right.count - left.count;
    }

    return getLabel(left).localeCompare(getLabel(right));
  });
}

function buildPortfolioDeskSummary(
  candidates: PortfolioCandidate[],
  userId: string,
  asOf: string,
  latestCheckpointByCandidateId: Map<string, PortfolioCheckpoint> = new Map(),
) {
  const liveCandidates = candidates.filter(isLivePortfolioCandidate);
  const openCandidates = candidates.filter((candidate) => candidate.status !== "closed");
  const asOfTimestamp = Date.parse(asOf);

  const themeCounts = new Map<string, number>();
  const assetCounts = new Map<string, number>();
  const convictionCounts = new Map<string, number>();

  for (const candidate of liveCandidates) {
    const themes = new Set([candidate.primary_theme, ...candidate.secondary_themes].filter(Boolean));

    for (const theme of themes) {
      themeCounts.set(theme, (themeCounts.get(theme) ?? 0) + 1);
    }

    for (const asset of new Set(candidate.related_assets)) {
      assetCounts.set(asset, (assetCounts.get(asset) ?? 0) + 1);
    }

    convictionCounts.set(candidate.conviction_label, (convictionCounts.get(candidate.conviction_label) ?? 0) + 1);
  }

  return {
    counts: {
      total: candidates.length,
      candidate: candidates.filter((candidate) => candidate.status === "candidate").length,
      active: candidates.filter((candidate) => candidate.status === "active").length,
      watching: candidates.filter((candidate) => candidate.status === "watching").length,
      trimmed: candidates.filter((candidate) => candidate.status === "trimmed").length,
      closed: candidates.filter((candidate) => candidate.status === "closed").length,
      due_review: liveCandidates.filter(
        (candidate) => candidate.next_review_due_at !== null && candidate.next_review_due_at <= asOf,
      ).length,
      due_soon: liveCandidates.filter((candidate) => isReviewDueSoon(candidate, asOfTimestamp)).length,
      missing_cadence: liveCandidates.filter((candidate) => candidate.next_review_due_at === null).length,
      stale_watching: liveCandidates.filter((candidate) =>
        isStaleWatchingCandidate(candidate, asOfTimestamp, latestCheckpointByCandidateId),
      ).length,
      trimmed_pending_followup: liveCandidates.filter((candidate) =>
        isTrimmedPendingFollowupCandidate(candidate, asOfTimestamp, latestCheckpointByCandidateId),
      ).length,
      assigned_to_me: openCandidates.filter((candidate) => candidate.assignee_user_id === userId).length,
      unassigned_live: liveCandidates.filter((candidate) => candidate.assignee_user_id === null).length,
    },
    exposure_by_theme: sortCountEntries(
      Array.from(themeCounts.entries()).map(([theme, count]) => ({ theme, count })),
      (entry) => entry.theme,
    ),
    exposure_by_asset: sortCountEntries(
      Array.from(assetCounts.entries()).map(([asset, count]) => ({ asset, count })),
      (entry) => entry.asset,
    ),
    conviction_by_label: sortCountEntries(
      Array.from(convictionCounts.entries()).map(([conviction_label, count]) => ({ conviction_label, count })),
      (entry) => entry.conviction_label,
    ),
  };
}

export const registerPortfolioRoutes = async (server: FastifyInstance, services: AppServices) => {
  server.get("/v1/portfolio", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const candidates = await services.repository.listPortfolioCandidates({
      workspace_id: session.workspace.id,
      limit: 32,
    });

    return reply.status(200).send(listPortfolioCandidatesResponseSchema.parse({
      candidates,
    }));
  });

  server.get("/v1/portfolio/:portfolioCandidateId", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const portfolioCandidateId = (request.params as { portfolioCandidateId: string }).portfolioCandidateId;
    const candidate = await services.repository.getPortfolioCandidate(portfolioCandidateId);

    if (!candidate || candidate.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Portfolio candidate not found.",
      });
    }

    const checkpoints = await services.repository.listPortfolioCheckpoints({
      portfolio_candidate_id: candidate.id,
      limit: 64,
    });

    return reply.status(200).send(portfolioCandidateDetailResponseSchema.parse({
      candidate,
      checkpoints,
    }));
  });

  server.post("/v1/portfolio", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = createPortfolioCandidateRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: toIssuePayload(parsed.error.issues),
      });
    }

    const brief = await services.repository.getDecisionBrief(parsed.data.decision_brief_id);

    if (!brief || brief.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Decision brief not found.",
      });
    }

    if (brief.status === "closed") {
      return reply.status(409).send({
        error: "decision_brief_closed",
        message: "Closed decision briefs cannot be promoted into portfolio candidates.",
      });
    }

    const existingOpen = await services.repository.listPortfolioCandidates({
      workspace_id: session.workspace.id,
      decision_brief_id: brief.id,
      statuses: [...OPEN_PORTFOLIO_STATUSES],
      limit: 1,
    });

    if (existingOpen.length > 0) {
      return reply.status(409).send({
        error: "portfolio_candidate_exists",
        message: "Only one open portfolio candidate is allowed per decision brief.",
      });
    }

    const now = new Date().toISOString();
    const candidate = await services.repository.savePortfolioCandidate({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      decision_brief_id: brief.id,
      investigation_id: brief.investigation_id,
      lead_prediction_id: brief.lead_prediction_id,
      title: brief.title,
      summary: brief.summary,
      status: parsed.data.status,
      priority: parsed.data.priority,
      sizing_label: parsed.data.sizing_label,
      risk_budget_label: parsed.data.risk_budget_label,
      conviction_label: parsed.data.conviction_label,
      primary_theme: parsed.data.primary_theme,
      secondary_themes: parsed.data.secondary_themes,
      related_assets: parsed.data.related_assets,
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
      kind: "portfolio_candidate_created",
      investigation_id: candidate.investigation_id,
      studio_run_id: null,
      prediction_id: candidate.lead_prediction_id,
      detail: `Portfolio candidate ${candidate.title} was created.`,
      metadata: {
        portfolio_candidate_id: candidate.id,
        decision_brief_id: candidate.decision_brief_id,
        status: candidate.status,
      },
      created_at: now,
    });

    return reply.status(201).send(portfolioCandidateSchema.parse(candidate));
  });

  server.post("/v1/portfolio/:portfolioCandidateId/assign", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = assignPortfolioCandidateRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: toIssuePayload(parsed.error.issues),
      });
    }

    const updated = await services.repository.assignPortfolioCandidate({
      portfolio_candidate_id: (request.params as { portfolioCandidateId: string }).portfolioCandidateId,
      assignee_user_id: parsed.data.assignee_user_id,
      last_actor_user_id: session.user.id,
      updated_at: new Date().toISOString(),
    });

    if (!updated || updated.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Portfolio candidate not found.",
      });
    }

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: "portfolio_candidate_assigned",
      investigation_id: updated.investigation_id,
      studio_run_id: null,
      prediction_id: updated.lead_prediction_id,
      detail: updated.assignee_user_id
        ? `Portfolio candidate ${updated.title} was assigned.`
        : `Portfolio candidate ${updated.title} was unassigned.`,
      metadata: {
        portfolio_candidate_id: updated.id,
        decision_brief_id: updated.decision_brief_id,
        assignee_user_id: updated.assignee_user_id,
      },
      created_at: updated.updated_at,
    });

    return reply.status(200).send(portfolioCandidateSchema.parse(updated));
  });

  server.post("/v1/portfolio/:portfolioCandidateId/posture", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = portfolioCandidatePostureUpdateRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: toIssuePayload(parsed.error.issues),
      });
    }

    const portfolioCandidateId = (request.params as { portfolioCandidateId: string }).portfolioCandidateId;
    const current = await services.repository.getPortfolioCandidate(portfolioCandidateId);

    if (!current || current.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Portfolio candidate not found.",
      });
    }

    const now = new Date().toISOString();
    const updated = await services.repository.updatePortfolioCandidatePosture({
      portfolio_candidate_id: portfolioCandidateId,
      priority: parsed.data.priority,
      sizing_label: parsed.data.sizing_label,
      risk_budget_label: parsed.data.risk_budget_label,
      conviction_label: parsed.data.conviction_label,
      primary_theme: parsed.data.primary_theme,
      secondary_themes: parsed.data.secondary_themes,
      related_assets: parsed.data.related_assets,
      next_review_due_at:
        parsed.data.next_review_due_at === undefined ? current.next_review_due_at : parsed.data.next_review_due_at,
      last_actor_user_id: session.user.id,
      updated_at: now,
    });

    if (!updated) {
      return reply.status(404).send({
        error: "not_found",
        message: "Portfolio candidate not found.",
      });
    }

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: "portfolio_candidate_posture_updated",
      investigation_id: updated.investigation_id,
      studio_run_id: null,
      prediction_id: updated.lead_prediction_id,
      detail: `Portfolio posture updated for ${updated.title}.`,
      metadata: {
        portfolio_candidate_id: updated.id,
        decision_brief_id: updated.decision_brief_id,
        priority: updated.priority,
        sizing_label: updated.sizing_label,
        risk_budget_label: updated.risk_budget_label,
        conviction_label: updated.conviction_label,
        primary_theme: updated.primary_theme,
        secondary_themes: updated.secondary_themes,
        related_assets: updated.related_assets,
        next_review_due_at: updated.next_review_due_at,
      },
      created_at: now,
    });

    return reply.status(200).send(portfolioCandidateSchema.parse(updated));
  });

  server.post("/v1/portfolio/:portfolioCandidateId/status", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = updatePortfolioCandidateStatusRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: toIssuePayload(parsed.error.issues),
      });
    }

    const portfolioCandidateId = (request.params as { portfolioCandidateId: string }).portfolioCandidateId;
    const current = await services.repository.getPortfolioCandidate(portfolioCandidateId);

    if (!current || current.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Portfolio candidate not found.",
      });
    }

    const now = new Date().toISOString();
    const status = parsed.data.status;
    const updated = await services.repository.updatePortfolioCandidateStatus({
      portfolio_candidate_id: portfolioCandidateId,
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
        message: "Portfolio candidate not found.",
      });
    }

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: status === "closed" ? "portfolio_candidate_closed" : "portfolio_candidate_status_changed",
      investigation_id: updated.investigation_id,
      studio_run_id: null,
      prediction_id: updated.lead_prediction_id,
      detail:
        status === "closed"
          ? `Portfolio candidate ${updated.title} was closed.`
          : `Portfolio candidate ${updated.title} moved to ${updated.status}.`,
      metadata: {
        portfolio_candidate_id: updated.id,
        decision_brief_id: updated.decision_brief_id,
        status: updated.status,
        previous_status: current.status,
      },
      created_at: now,
    });

    return reply.status(200).send(portfolioCandidateSchema.parse(updated));
  });

  server.post("/v1/portfolio/:portfolioCandidateId/checkpoints", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const parsed = createPortfolioCheckpointRequestSchema.safeParse(request.body ?? {});

    if (!parsed.success) {
      return reply.status(400).send({
        error: "invalid_request",
        issues: toIssuePayload(parsed.error.issues),
      });
    }

    const portfolioCandidateId = (request.params as { portfolioCandidateId: string }).portfolioCandidateId;
    const current = await services.repository.getPortfolioCandidate(portfolioCandidateId);

    if (!current || current.workspace_id !== session.workspace.id) {
      return reply.status(404).send({
        error: "not_found",
        message: "Portfolio candidate not found.",
      });
    }

    if (current.status === "closed") {
      return reply.status(409).send({
        error: "portfolio_candidate_closed",
        message: "Closed portfolio candidates cannot accept new checkpoints.",
      });
    }

    const now = new Date().toISOString();
    await services.repository.savePortfolioCheckpoint({
      id: randomUUID(),
      portfolio_candidate_id: current.id,
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
        : parsed.data.action === "trim"
          ? "trimmed"
          : parsed.data.action === "close"
            ? "closed"
            : "active";

    const updated = await services.repository.updatePortfolioCandidateStatus({
      portfolio_candidate_id: current.id,
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
        message: "Portfolio candidate not found.",
      });
    }

    await services.repository.saveWorkspaceActivity({
      id: randomUUID(),
      workspace_id: session.workspace.id,
      actor_user_id: session.user.id,
      kind: "portfolio_checkpoint_saved",
      investigation_id: updated.investigation_id,
      studio_run_id: null,
      prediction_id: updated.lead_prediction_id,
      detail: `Checkpoint saved for portfolio candidate ${updated.title}.`,
      metadata: {
        portfolio_candidate_id: updated.id,
        decision_brief_id: updated.decision_brief_id,
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
        kind: "portfolio_candidate_closed",
        investigation_id: updated.investigation_id,
        studio_run_id: null,
        prediction_id: updated.lead_prediction_id,
        detail: `Portfolio candidate ${updated.title} was closed.`,
        metadata: {
          portfolio_candidate_id: updated.id,
          decision_brief_id: updated.decision_brief_id,
          source: "checkpoint",
        },
        created_at: now,
      });
    } else if (current.status !== updated.status) {
      await services.repository.saveWorkspaceActivity({
        id: randomUUID(),
        workspace_id: session.workspace.id,
        actor_user_id: session.user.id,
        kind: "portfolio_candidate_status_changed",
        investigation_id: updated.investigation_id,
        studio_run_id: null,
        prediction_id: updated.lead_prediction_id,
        detail: `Portfolio candidate ${updated.title} moved to ${updated.status}.`,
        metadata: {
          portfolio_candidate_id: updated.id,
          decision_brief_id: updated.decision_brief_id,
          previous_status: current.status,
          status: updated.status,
          source: "checkpoint",
        },
        created_at: now,
      });
    }

    const checkpoints = await services.repository.listPortfolioCheckpoints({
      portfolio_candidate_id: updated.id,
      limit: 64,
    });

    return reply.status(201).send(portfolioCandidateDetailResponseSchema.parse({
      candidate: updated,
      checkpoints,
    }));
  });

  server.get("/v1/workspace/portfolio-desk", async (request, reply) => {
    const session = await requireWorkspaceSession(request, reply, services);

    if (!session) {
      return;
    }

    const asOf = new Date().toISOString();
    const [allCandidates, activePool, candidateBriefs, recentlyClosedCandidates] = await Promise.all([
      services.repository.listPortfolioCandidates({
        workspace_id: session.workspace.id,
        limit: 256,
      }),
      services.repository.listPortfolioCandidates({
        workspace_id: session.workspace.id,
        statuses: [...ACTIVE_PORTFOLIO_STATUSES],
        limit: 64,
      }),
      services.repository.listPortfolioCandidates({
        workspace_id: session.workspace.id,
        statuses: ["candidate"],
        limit: 12,
      }),
      services.repository.listPortfolioCandidates({
        workspace_id: session.workspace.id,
        statuses: ["closed"],
        limit: 12,
      }),
    ]);
    const latestCheckpointEntries = await Promise.all(
      activePool.map(async (candidate) => {
        const [latestCheckpoint] = await services.repository.listPortfolioCheckpoints({
          portfolio_candidate_id: candidate.id,
          limit: 1,
        });

        return [candidate.id, latestCheckpoint ?? null] as const;
      }),
    );
    const latestCheckpointByCandidateId = new Map<string, PortfolioCheckpoint>(
      latestCheckpointEntries.flatMap(([candidateId, latestCheckpoint]) =>
        latestCheckpoint ? [[candidateId, latestCheckpoint] as const] : [],
      ),
    );

    const dueReviewCandidates = activePool
      .filter((candidate) => candidate.next_review_due_at !== null && candidate.next_review_due_at <= asOf)
      .slice(0, 12);

    return reply.status(200).send(workspacePortfolioDeskResponseSchema.parse({
      candidate_briefs: candidateBriefs,
      active_candidates: activePool.slice(0, 12),
      due_review_candidates: dueReviewCandidates,
      recently_closed_candidates: recentlyClosedCandidates,
      summary: buildPortfolioDeskSummary(allCandidates, session.user.id, asOf, latestCheckpointByCandidateId),
    }));
  });
};
