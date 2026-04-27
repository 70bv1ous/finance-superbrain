export type InvestigationStatus = "drafting" | "ready_for_review" | "under_review" | "reviewed"

export type InvestigationTrailStep = {
  id: string
  kind: "studio_run" | "prediction_detail" | "review_focus" | "library_lookup" | "evaluation_context"
  status: InvestigationStatus
  href: string
  title: string
  detail: string
  updatedAt: string
}

export type InvestigationTrail = {
  id: string
  title: string
  eventId: string | null
  predictionIds: string[]
  status?: InvestigationStatus
  createdAt?: string
  updatedAt: string
  ownerUserId?: string
  assigneeUserId?: string | null
  lastActorUserId?: string
  steps: InvestigationTrailStep[]
}

export type InvestigationStepInput = {
  trailId?: string
  title: string
  eventId?: string | null
  predictionId?: string | null
  href: string
  detail: string
  updatedAt: string
  kind: InvestigationTrailStep["kind"]
  status: InvestigationStatus
}

export type InvestigationTrailAction = {
  href: string
  label: string
  title: string
  description: string
}

const MAX_STEPS = 8
const MAX_TRAILS = 8

function sortByUpdatedAt<T extends { updatedAt: string }>(items: T[]) {
  return [...items].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
}

function mergeTrailSteps(left: InvestigationTrail["steps"], right: InvestigationTrail["steps"]) {
  const byId = new Map<string, InvestigationTrailStep>()

  for (const step of [...(left ?? []), ...(right ?? [])]) {
    const current = byId.get(step.id)

    if (!current || Date.parse(step.updatedAt) >= Date.parse(current.updatedAt)) {
      byId.set(step.id, step)
    }
  }

  return sortByUpdatedAt([...byId.values()]).slice(0, MAX_STEPS)
}

function mergeTwoTrails(left: InvestigationTrail, right: InvestigationTrail): InvestigationTrail {
  const latest = Date.parse(left.updatedAt) >= Date.parse(right.updatedAt) ? left : right
  const older = latest === left ? right : left

  return {
    id: latest.id,
    title: latest.title || older.title,
    eventId: latest.eventId ?? older.eventId ?? null,
    predictionIds: Array.from(new Set([...(latest.predictionIds ?? []), ...(older.predictionIds ?? [])])),
    status: latest.status ?? older.status,
    createdAt: older.createdAt ?? latest.createdAt,
    updatedAt: latest.updatedAt,
    ownerUserId: latest.ownerUserId ?? older.ownerUserId,
    assigneeUserId: latest.assigneeUserId ?? older.assigneeUserId ?? null,
    lastActorUserId: latest.lastActorUserId ?? older.lastActorUserId,
    steps: mergeTrailSteps(latest.steps ?? [], older.steps ?? []),
  }
}

function findMatchingTrailIndex(trails: InvestigationTrail[], candidate: InvestigationTrail) {
  return trails.findIndex(
    (trail) =>
      trail.id === candidate.id ||
      Boolean(candidate.eventId && trail.eventId === candidate.eventId) ||
      (candidate.predictionIds ?? []).some((predictionId) => (trail.predictionIds ?? []).includes(predictionId)),
  )
}

export function upsertInvestigationTrail(
  trails: InvestigationTrail[],
  input: InvestigationStepInput,
  createId: () => string,
) {
  const existing =
    trails.find((trail) => trail.id === input.trailId) ??
    trails.find((trail) => Boolean(input.eventId && trail.eventId === input.eventId)) ??
    trails.find((trail) => Boolean(input.predictionId && (trail.predictionIds ?? []).includes(input.predictionId)))

  const stepId = input.predictionId
    ? `${input.kind}:${input.predictionId}`
    : input.eventId
      ? `${input.kind}:${input.eventId}`
      : `${input.kind}:${input.href}`

  const nextStep: InvestigationTrailStep = {
    id: stepId,
    kind: input.kind,
    status: input.status,
    href: input.href,
    title: input.title,
    detail: input.detail,
    updatedAt: input.updatedAt,
  }

  const nextTrail: InvestigationTrail = existing
    ? {
        ...existing,
        title: existing.title || input.title,
        eventId: existing.eventId ?? input.eventId ?? null,
        predictionIds: input.predictionId
          ? Array.from(new Set([...(existing.predictionIds ?? []), input.predictionId]))
          : (existing.predictionIds ?? []),
        status: input.status,
        createdAt: existing.createdAt ?? existing.steps?.at(-1)?.updatedAt ?? input.updatedAt,
        updatedAt: input.updatedAt,
        ownerUserId: existing.ownerUserId,
        assigneeUserId: existing.assigneeUserId ?? null,
        lastActorUserId: existing.lastActorUserId,
        steps: sortByUpdatedAt([
          nextStep,
          ...(existing.steps ?? []).filter((step) => step.id !== stepId),
        ]).slice(0, MAX_STEPS),
      }
    : {
        id: input.trailId ?? createId(),
        title: input.title,
        eventId: input.eventId ?? null,
        predictionIds: input.predictionId ? [input.predictionId] : [],
        status: input.status,
        createdAt: input.updatedAt,
        updatedAt: input.updatedAt,
        assigneeUserId: null,
        steps: [nextStep],
      }

  return sortByUpdatedAt([
    nextTrail,
    ...trails.filter((trail) => trail.id !== existing?.id),
  ]).slice(0, MAX_TRAILS)
}

export function getTrailStatus(trail: InvestigationTrail): InvestigationStatus {
  return trail.status ?? trail.steps?.[0]?.status ?? "drafting"
}

export function mergeInvestigationTrails(
  incoming: InvestigationTrail[],
  local: InvestigationTrail[],
) {
  const merged = [...incoming]

  for (const trail of local) {
    const index = findMatchingTrailIndex(merged, trail)

    if (index === -1) {
      merged.push(trail)
      continue
    }

    merged[index] = mergeTwoTrails(merged[index]!, trail)
  }

  return sortByUpdatedAt(merged).slice(0, MAX_TRAILS)
}

export function getTrailNextStep(trail: InvestigationTrail) {
  const status = getTrailStatus(trail)

  switch (status) {
    case "drafting":
      return "Finish capturing the event and store it as a durable Studio run."
    case "ready_for_review":
      return "Open the run or prediction detail and move the lead call into the review desk."
    case "under_review":
      return "Finish the verdict and review-note loop so the lesson becomes reusable memory."
    default:
      return "Use the completed trail for retrieval, comparison, and lesson lookup."
  }
}

function getLatestStepHref(trail: InvestigationTrail, kinds: InvestigationTrailStep["kind"][]) {
  return (trail.steps ?? []).find((step) => kinds.includes(step.kind))?.href ?? null
}

export function getTrailPrimaryAction(trail: InvestigationTrail): InvestigationTrailAction {
  const status = getTrailStatus(trail)
  const leadPredictionId = trail.predictionIds[0] ?? null

  switch (status) {
    case "drafting":
      return {
        href: getLatestStepHref(trail, ["studio_run"]) ?? `/studio?run=${trail.id}`,
        label: "Resume Studio",
        title: "Continue event capture",
        description: "Return to the saved Studio run and finish turning the draft into a reviewable prediction set.",
      }
    case "ready_for_review":
      return {
        href:
          (leadPredictionId ? `/accuracy?focus=${leadPredictionId}` : null) ??
          getLatestStepHref(trail, ["prediction_detail", "studio_run"]) ??
          "/accuracy",
        label: "Review next",
        title: "Move the lead call into review",
        description: "Take the strongest prediction from this trail into the review desk so it enters the scoring loop.",
      }
    case "under_review":
      return {
        href:
          (leadPredictionId ? `/accuracy?focus=${leadPredictionId}` : null) ??
          getLatestStepHref(trail, ["review_focus", "prediction_detail"]) ??
          "/accuracy",
        label: "Continue review",
        title: "Finish verdict and notes",
        description: "Complete the review notes or verdict so the investigation can become reusable learned memory.",
      }
    default:
      return {
        href: getLatestStepHref(trail, ["library_lookup"]) ?? `/library?trail=${trail.id}`,
        label: "Open Library",
        title: "Use the learned lesson",
        description: "Reopen the retrieval desk to compare this completed investigation against stored lessons and analog memory.",
      }
  }
}

export function getTrailRelatedActions(trail: InvestigationTrail): InvestigationTrailAction[] {
  const leadPredictionId = trail.predictionIds[0] ?? null
  const primary = getTrailPrimaryAction(trail)
  const candidates: InvestigationTrailAction[] = [
    {
      href: `/studio?run=${trail.id}`,
      label: "Resume Studio",
      title: "Reopen the originating event workflow",
      description: "Return to the source, stored event, predictions, and analog comparison set behind this investigation.",
    },
    {
      href: leadPredictionId ? `/accuracy?focus=${leadPredictionId}` : "/accuracy",
      label: "Open accuracy",
      title: "Continue in the review desk",
      description: "Work the verdict and review-note loop from the dedicated accuracy workspace.",
    },
    getTrailStatus(trail) === "reviewed"
      ? {
          href: `/library?trail=${trail.id}`,
          label: "Open Library",
          title: "Compare against learned memory",
          description: "Use the lesson explorer to retrieve related postmortems, analogs, and reusable memory.",
        }
      : {
          href: `/evaluation?trail=${trail.id}`,
          label: "Open Evaluation",
          title: "Inspect benchmark context",
          description: "Use the evaluation desk to anchor the active investigation to calibration and benchmark context.",
        },
  ]

  const deduped = candidates.filter(
    (candidate, index, all) =>
      candidate.href !== primary.href &&
      all.findIndex((other) => other.href === candidate.href) === index,
  )

  return [primary, ...deduped]
}

export function formatInvestigationStatus(status: InvestigationStatus) {
  return status.replace(/_/g, " ")
}

export function getInvestigationStatusTone(status: InvestigationStatus) {
  switch (status) {
    case "drafting":
      return "border-cyan-500/25 bg-cyan-500/10 text-cyan-100"
    case "ready_for_review":
      return "border-amber-500/25 bg-amber-500/10 text-amber-100"
    case "under_review":
      return "border-blue-500/25 bg-blue-500/10 text-blue-100"
    default:
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-100"
  }
}

export function getInvestigationStatusSummary(status: InvestigationStatus) {
  switch (status) {
    case "drafting":
      return "The investigation is still being shaped inside Studio and has not entered the review loop yet."
    case "ready_for_review":
      return "The event workflow is complete enough to score or inspect in more depth, but the operator still needs to act on it."
    case "under_review":
      return "The investigation is inside the review loop and still needs a verdict or postmortem follow-up."
    default:
      return "The end-to-end loop is complete and the investigation is ready for later retrieval and comparison."
  }
}
