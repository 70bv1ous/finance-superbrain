import type { PredictionRow } from "@/lib/chatApi"
import type { StoredChatSession } from "@/lib/chatSessionStore"
import type { SavedStudioRun, StudioDraftRecord, WorkspaceRecentItem } from "@/components/WorkspaceProvider"

export type InvestigationItem = {
  id: string
  lane: "needs_review" | "drafting" | "studio_run" | "analysis_thread" | "recent_context"
  title: string
  summary: string
  href: string
  actionLabel: string
  nextStep: string
  updatedAt: string
  priority: number
}

type BuildInvestigationDeskInput = {
  latestSession: StoredChatSession | null
  studioDraft: StudioDraftRecord | null
  studioRuns: SavedStudioRun[]
  recentPredictions: PredictionRow[]
  recentItems: WorkspaceRecentItem[]
}

function stageSummary(run: SavedStudioRun) {
  if (run.predictions.length > 0) {
    return {
      summary: `${run.predictions.length} stored prediction${run.predictions.length === 1 ? "" : "s"} and ${run.analogs.length} analog${run.analogs.length === 1 ? "" : "s"} are ready for review.`,
      nextStep: "Open the run, inspect the analogs, and send the lead prediction into review.",
    }
  }

  return {
    summary: "Stored event is durable, but predictions still need to be generated for review.",
    nextStep: "Resume the run and generate predictions from the stored event.",
  }
}

function recentContextNextStep(item: WorkspaceRecentItem) {
  switch (item.kind) {
    case "prediction":
      return "Re-open the linked prediction or review context and decide whether it needs scoring or lesson follow-up."
    case "studio_run":
      return "Resume the saved Studio workflow and continue the event-to-review loop."
    default:
      return "Continue the in-progress Studio draft and turn it into a durable event."
  }
}

function uniqueById(items: InvestigationItem[]) {
  const seen = new Set<string>()

  return items.filter((item) => {
    if (seen.has(item.id)) {
      return false
    }

    seen.add(item.id)
    return true
  })
}

export function buildInvestigationDesk({
  latestSession,
  studioDraft,
  studioRuns,
  recentPredictions,
  recentItems,
}: BuildInvestigationDeskInput) {
  const investigations: InvestigationItem[] = []
  const unresolvedPrediction = recentPredictions.find((prediction) => !prediction.outcome) ?? null

  if (unresolvedPrediction) {
    investigations.push({
      id: `review:${unresolvedPrediction.id}`,
      lane: "needs_review",
      title: unresolvedPrediction.query,
      summary: `${unresolvedPrediction.event_type.replace(/_/g, " ")} | ${unresolvedPrediction.confidence_level} confidence still needs a verdict.`,
      href: `/accuracy?focus=${unresolvedPrediction.id}`,
      actionLabel: "Review verdict",
      nextStep: "Mark the outcome, then capture notes if the scored call needs postmortem context.",
      updatedAt: unresolvedPrediction.created_at,
      priority: 500,
    })
  }

  if (studioDraft) {
    investigations.push({
      id: "studio-draft:active",
      lane: "drafting",
      title: studioDraft.form.title.trim() || "Untitled Studio draft",
      summary: studioDraft.preview?.summary ?? "A partially captured event is saved locally and can be resumed instantly.",
      href: "/studio",
      actionLabel: "Resume draft",
      nextStep: studioDraft.preview
        ? "Store the draft as a durable event, then generate predictions."
        : "Finish the raw capture and parse a preview before storing the event.",
      updatedAt: studioDraft.updatedAt,
      priority: 420,
    })
  }

  for (const run of studioRuns.slice(0, 4)) {
    const stage = stageSummary(run)

    investigations.push({
      id: `studio-run:${run.id}`,
      lane: "studio_run",
      title: run.title,
      summary: stage.summary,
      href: `/studio?run=${run.id}`,
      actionLabel: "Resume run",
      nextStep: stage.nextStep,
      updatedAt: run.updatedAt,
      priority: 360,
    })
  }

  if (latestSession) {
    investigations.push({
      id: `chat-thread:${latestSession.id}`,
      lane: "analysis_thread",
      title: latestSession.title,
      summary: `${latestSession.messages.length} saved message${latestSession.messages.length === 1 ? "" : "s"} in the latest browser thread.`,
      href: `/workspace?thread=${latestSession.id}`,
      actionLabel: "Open thread",
      nextStep: "Continue the live analysis thread or use it to seed the next Studio workflow.",
      updatedAt: latestSession.updatedAt,
      priority: 280,
    })
  }

  for (const item of recentItems.slice(0, 6)) {
    investigations.push({
      id: `recent:${item.id}`,
      lane: "recent_context",
      title: item.title,
      summary: item.description,
      href: item.href,
      actionLabel: "Open context",
      nextStep: recentContextNextStep(item),
      updatedAt: item.updatedAt,
      priority: 120,
    })
  }

  return uniqueById(investigations).sort((left, right) => {
    if (left.priority !== right.priority) {
      return right.priority - left.priority
    }

    return Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
  })
}
