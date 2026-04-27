import type { DecisionBrief, DecisionCheckpoint, WorkspaceActivity } from "@finance-superbrain/schemas"

type DecisionClosureSummary = {
  label: string
  detail: string
  closedAt: string | null
}

function pickLatestCheckpoint(
  checkpoints: DecisionCheckpoint[] | undefined,
): DecisionCheckpoint | null {
  if (!checkpoints?.length) {
    return null
  }

  return checkpoints.reduce<DecisionCheckpoint | null>((latest, checkpoint) => {
    if (!latest) {
      return checkpoint
    }

    return Date.parse(checkpoint.created_at) > Date.parse(latest.created_at) ? checkpoint : latest
  }, null)
}

function pickLatestCheckpointActivity(
  activity: WorkspaceActivity[],
  decisionBriefId: string,
): WorkspaceActivity | null {
  return activity.reduce<WorkspaceActivity | null>((latest, event) => {
    if (event.kind !== "decision_checkpoint_saved") {
      return latest
    }

    if (event.metadata.decision_brief_id !== decisionBriefId) {
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
      return "Closed operating outcome"
  }
}

export function getDecisionClosureSummary({
  brief,
  activity,
  checkpoints,
}: {
  brief: DecisionBrief
  activity: WorkspaceActivity[]
  checkpoints?: DecisionCheckpoint[]
}): DecisionClosureSummary | null {
  if (brief.status !== "closed") {
    return null
  }

  const latestCheckpoint = pickLatestCheckpoint(checkpoints)
  const latestCheckpointActivity = pickLatestCheckpointActivity(activity, brief.id)
  const thesisState =
    latestCheckpoint?.thesis_state ??
    (typeof latestCheckpointActivity?.metadata.thesis_state === "string"
      ? latestCheckpointActivity.metadata.thesis_state
      : null)
  const summary =
    latestCheckpoint?.summary ??
    (typeof latestCheckpointActivity?.detail === "string"
      ? latestCheckpointActivity.detail
      : null)

  return {
    label: buildClosureLabel(thesisState),
    detail:
      summary ??
      "This brief has been closed and should now be treated as retrospective operating evidence rather than live work.",
    closedAt: brief.closed_at,
  }
}
