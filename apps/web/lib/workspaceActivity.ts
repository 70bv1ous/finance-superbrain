import type { WorkspaceActivity } from "@finance-superbrain/schemas"

export function formatWorkspaceActivityKind(kind: string) {
  return kind.replace(/_/g, " ")
}

export function isDecisionActivity(event: WorkspaceActivity) {
  return String(event.kind).startsWith("decision_")
}

export function isPortfolioActivity(event: WorkspaceActivity) {
  return String(event.kind).startsWith("portfolio_")
}

export function getWorkspaceActivityDecisionBriefId(event: WorkspaceActivity) {
  return typeof event.metadata?.decision_brief_id === "string" ? event.metadata.decision_brief_id : null
}

export function getWorkspaceActivityPortfolioCandidateId(event: WorkspaceActivity) {
  return typeof event.metadata?.portfolio_candidate_id === "string" ? event.metadata.portfolio_candidate_id : null
}

export function getWorkspaceActivityReviewSessionId(event: WorkspaceActivity) {
  return typeof event.metadata?.review_session_id === "string" ? event.metadata.review_session_id : null
}

export function getWorkspaceActivityReferences(event: WorkspaceActivity) {
  const decisionBriefId = getWorkspaceActivityDecisionBriefId(event)
  const portfolioCandidateId = getWorkspaceActivityPortfolioCandidateId(event)
  const reviewSessionId = getWorkspaceActivityReviewSessionId(event)

  return [
    event.investigation_id ? { label: "Investigation", href: "/investigations" } : null,
    event.prediction_id ? { label: "Prediction", href: `/predictions/${event.prediction_id}` } : null,
    decisionBriefId ? { label: "Decision brief", href: `/decisions/${decisionBriefId}` } : null,
    portfolioCandidateId ? { label: "Portfolio candidate", href: `/portfolio/${portfolioCandidateId}` } : null,
    reviewSessionId ? { label: "Portfolio review", href: `/portfolio/reviews/${reviewSessionId}` } : null,
    event.studio_run_id ? { label: "Studio run", href: `/studio?run=${event.studio_run_id}` } : null,
  ].filter(Boolean) as Array<{ label: string; href: string }>
}
