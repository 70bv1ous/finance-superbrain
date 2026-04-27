import type { PredictionRow } from "@/lib/chatApi"
import type { StoredChatSession } from "@/lib/chatSessionStore"
import type { SavedStudioRun, StudioDraftRecord, WorkspaceRecentItem } from "@/components/WorkspaceProvider"
import { getTrailNextStep, getTrailStatus, type InvestigationTrail } from "@/lib/investigationTrail"

export type WorkspaceResumeAction = {
  id: string
  kind: "investigation_trail" | "review" | "studio_draft" | "studio_run" | "chat_thread"
  title: string
  description: string
  href: string
  label: string
  tone: "amber" | "emerald" | "cyan" | "blue"
}

type BuildWorkspaceResumeActionsInput = {
  latestSession: StoredChatSession | null
  studioDraft: StudioDraftRecord | null
  latestStudioRun: SavedStudioRun | null
  recentPredictions: PredictionRow[]
  investigationTrails: InvestigationTrail[]
}

function buildTrailAction(trails: InvestigationTrail[]): WorkspaceResumeAction | null {
  const prioritizedTrail =
    trails.find((trail) => getTrailStatus(trail) === "ready_for_review" || getTrailStatus(trail) === "under_review") ??
    trails.find((trail) => getTrailStatus(trail) === "drafting") ??
    null

  if (!prioritizedTrail) {
    return null
  }

  const status = getTrailStatus(prioritizedTrail)

  return {
    id: `trail:${prioritizedTrail.id}`,
    kind: "investigation_trail",
    title: prioritizedTrail.title,
    description: getTrailNextStep(prioritizedTrail),
    href: prioritizedTrail.steps[0]?.href ?? "/",
    label: status === "drafting" ? "Resume trail" : "Continue trail",
    tone: status === "drafting" ? "cyan" : status === "reviewed" ? "emerald" : "amber",
  }
}

export function buildWorkspaceResumeActions({
  latestSession,
  studioDraft,
  latestStudioRun,
  recentPredictions,
  investigationTrails,
}: BuildWorkspaceResumeActionsInput): WorkspaceResumeAction[] {
  const unresolvedPrediction = recentPredictions.find((prediction) => !prediction.outcome) ?? null
  const actions: WorkspaceResumeAction[] = []
  const trailAction = buildTrailAction(investigationTrails)

  if (trailAction) {
    actions.push(trailAction)
  }

  if (unresolvedPrediction) {
    actions.push({
      id: `review:${unresolvedPrediction.id}`,
      kind: "review",
      title: "Review the next unresolved prediction",
      description: `${unresolvedPrediction.event_type.replace(/_/g, " ")} | ${unresolvedPrediction.confidence_level} confidence`,
      href: `/accuracy?focus=${unresolvedPrediction.id}`,
      label: "Review now",
      tone: "amber",
    })
  }

  if (studioDraft) {
    actions.push({
      id: "studio-draft:active",
      kind: "studio_draft",
      title: studioDraft.form.title.trim() || "Resume the current Studio draft",
      description: studioDraft.preview?.summary ?? "Draft capture is saved locally and ready to continue.",
      href: "/studio",
      label: "Open draft",
      tone: "cyan",
    })
  }

  if (latestStudioRun) {
    actions.push({
      id: `studio-run:${latestStudioRun.id}`,
      kind: "studio_run",
      title: latestStudioRun.title,
      description: latestStudioRun.eventSummary,
      href: `/studio?run=${latestStudioRun.id}`,
      label: "Resume run",
      tone: "emerald",
    })
  }

  if (latestSession) {
    actions.push({
      id: `chat-thread:${latestSession.id}`,
      kind: "chat_thread",
      title: latestSession.title,
      description: `${latestSession.messages.length} saved message${latestSession.messages.length === 1 ? "" : "s"} in browser continuity.`,
      href: `/workspace?thread=${latestSession.id}`,
      label: "Resume thread",
      tone: "blue",
    })
  }

  const seenHrefs = new Set<string>()

  return actions.filter((action) => {
    if (seenHrefs.has(action.href)) {
      return false
    }

    seenHrefs.add(action.href)
    return true
  })
}

export function getRecentContextItems(items: WorkspaceRecentItem[], limit = 4) {
  return items.slice(0, limit)
}
