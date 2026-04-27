import type { PortfolioCandidate, PortfolioCheckpoint, WorkspaceActivity } from "@finance-superbrain/schemas"

type PortfolioClosureSummary = {
  label: string
  detail: string
  closedAt: string | null
  closedFrom: string | null
}

type PortfolioPostureSummary = {
  priority: string
  sizing: string
  conviction: string
  primaryTheme: string
}

function pickLatestPortfolioCandidate(
  current: PortfolioCandidate | undefined,
  nextCandidate: PortfolioCandidate,
) {
  if (!current) {
    return nextCandidate
  }

  return Date.parse(nextCandidate.updated_at) > Date.parse(current.updated_at) ? nextCandidate : current
}

function pickLatestCheckpoint(
  checkpoints: PortfolioCheckpoint[] | undefined,
): PortfolioCheckpoint | null {
  if (!checkpoints?.length) {
    return null
  }

  return checkpoints.reduce<PortfolioCheckpoint | null>((latest, checkpoint) => {
    if (!latest) {
      return checkpoint
    }

    return Date.parse(checkpoint.created_at) > Date.parse(latest.created_at) ? checkpoint : latest
  }, null)
}

function pickLatestCheckpointActivity(
  activity: WorkspaceActivity[],
  portfolioCandidateId: string,
): WorkspaceActivity | null {
  return activity.reduce<WorkspaceActivity | null>((latest, event) => {
    if (event.kind !== "portfolio_checkpoint_saved") {
      return latest
    }

    if (event.metadata.portfolio_candidate_id !== portfolioCandidateId) {
      return latest
    }

    if (!latest) {
      return event
    }

    return Date.parse(event.created_at) > Date.parse(latest.created_at) ? event : latest
  }, null)
}

function buildClosureLabel(thesisState: string | null) {
  switch (thesisState) {
    case "resolved":
      return "Closed as resolved"
    case "invalidated":
      return "Closed as invalidated"
    case "weakened":
      return "Closed after thesis weakened"
    case "intact":
      return "Closed with thesis intact"
    default:
      return "Closed portfolio outcome"
  }
}

function formatClosedFrom(previousStatus: unknown) {
  if (previousStatus === "active") {
    return "Closed from active"
  }

  if (previousStatus === "watching") {
    return "Closed from watching"
  }

  if (previousStatus === "trimmed") {
    return "Closed from trimmed"
  }

  return null
}

export function buildLatestPortfolioCandidateByDecisionBriefId(candidates: PortfolioCandidate[]) {
  const map = new Map<string, PortfolioCandidate>()

  for (const candidate of candidates) {
    map.set(
      candidate.decision_brief_id,
      pickLatestPortfolioCandidate(map.get(candidate.decision_brief_id), candidate),
    )
  }

  return map
}

export function getPortfolioCandidateContextCopy(
  status: PortfolioCandidate["status"] | null | undefined,
) {
  switch (status) {
    case "closed":
      return "This work already feeds a closed portfolio outcome and should be read as retrospective portfolio evidence."
    case "trimmed":
      return "This work belongs to a trimmed portfolio candidate and should be treated as reduced-but-still-live exposure."
    case "watching":
      return "This work is attached to a watching portfolio candidate and can help decide whether the thesis should stay on watch or return to active exposure."
    case "active":
      return "This work is already tied to an active portfolio candidate and should reinforce the live exposure posture."
    case "candidate":
      return "This work has already been promoted into the portfolio layer but is still waiting for full live posture."
    default:
      return "This work has not been promoted into the portfolio layer yet."
  }
}

export function getPortfolioClosureSummary({
  candidate,
  activity,
  checkpoints,
}: {
  candidate: PortfolioCandidate
  activity: WorkspaceActivity[]
  checkpoints?: PortfolioCheckpoint[]
}): PortfolioClosureSummary | null {
  if (candidate.status !== "closed") {
    return null
  }

  const latestCheckpoint = pickLatestCheckpoint(checkpoints)
  const latestCheckpointActivity = pickLatestCheckpointActivity(activity, candidate.id)
  const thesisState =
    latestCheckpoint?.thesis_state ??
    (typeof latestCheckpointActivity?.metadata.thesis_state === "string"
      ? latestCheckpointActivity.metadata.thesis_state
      : null)
  const summary =
    latestCheckpoint?.summary ??
    (typeof latestCheckpointActivity?.detail === "string" ? latestCheckpointActivity.detail : null)
  const latestCloseActivity = activity.reduce<WorkspaceActivity | null>((latest, event) => {
    if (event.kind !== "portfolio_candidate_closed") {
      return latest
    }

    if (event.metadata.portfolio_candidate_id !== candidate.id) {
      return latest
    }

    if (!latest) {
      return event
    }

    return Date.parse(event.created_at) > Date.parse(latest.created_at) ? event : latest
  }, null)

  return {
    label: buildClosureLabel(thesisState),
    detail:
      summary ??
      "This portfolio candidate has been closed and should now be treated as retrospective portfolio evidence rather than live exposure.",
    closedAt: candidate.closed_at,
    closedFrom: formatClosedFrom(latestCloseActivity?.metadata.previous_status ?? null),
  }
}

export function getPortfolioPostureSummary(candidate: PortfolioCandidate): PortfolioPostureSummary {
  return {
    priority: candidate.priority,
    sizing: candidate.sizing_label,
    conviction: candidate.conviction_label,
    primaryTheme: candidate.primary_theme,
  }
}
