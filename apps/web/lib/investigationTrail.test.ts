import { describe, expect, it } from "vitest"

import { getTrailNextStep, getTrailPrimaryAction, getTrailRelatedActions, getTrailStatus, mergeInvestigationTrails, upsertInvestigationTrail } from "@/lib/investigationTrail"

describe("investigationTrail", () => {
  it("merges prediction and review steps into the same event trail", () => {
    const afterStudio = upsertInvestigationTrail(
      [],
      {
        title: "Fed hold and hawkish press conference",
        eventId: "event-1",
        href: "/studio?run=event-1",
        detail: "Studio run is ready for prediction review.",
        updatedAt: "2026-04-01T01:00:00.000Z",
        kind: "studio_run",
        status: "ready_for_review",
      },
      () => "trail-1",
    )

    const afterPrediction = upsertInvestigationTrail(
      afterStudio,
      {
        title: "Fed hold and hawkish press conference",
        eventId: "event-1",
        predictionId: "prediction-1",
        href: "/predictions/prediction-1",
        detail: "Lead prediction opened in detail view.",
        updatedAt: "2026-04-01T02:00:00.000Z",
        kind: "prediction_detail",
        status: "under_review",
      },
      () => "trail-2",
    )

    const afterReview = upsertInvestigationTrail(
      afterPrediction,
      {
        title: "Fed hold and hawkish press conference",
        predictionId: "prediction-1",
        href: "/accuracy?focus=prediction-1",
        detail: "Prediction moved into the review desk.",
        updatedAt: "2026-04-01T03:00:00.000Z",
        kind: "review_focus",
        status: "under_review",
      },
      () => "trail-3",
    )

    expect(afterReview).toHaveLength(1)
    expect(afterReview[0]?.predictionIds).toEqual(["prediction-1"])
    expect(afterReview[0]?.steps.map((step) => step.kind)).toEqual([
      "review_focus",
      "prediction_detail",
      "studio_run",
    ])
    expect(getTrailStatus(afterReview[0]!)).toBe("under_review")
  })

  it("creates separate trails when the work does not share an event or prediction", () => {
    const trails = upsertInvestigationTrail(
      [],
      {
        title: "CPI surprise",
        eventId: "event-1",
        href: "/studio?run=event-1",
        detail: "Stored event created.",
        updatedAt: "2026-04-01T01:00:00.000Z",
        kind: "studio_run",
        status: "drafting",
      },
      () => "trail-1",
    )

    const next = upsertInvestigationTrail(
      trails,
      {
        title: "Rates chat",
        href: "/accuracy?focus=prediction-9",
        predictionId: "prediction-9",
        detail: "Standalone review focus.",
        updatedAt: "2026-04-01T02:00:00.000Z",
        kind: "review_focus",
        status: "ready_for_review",
      },
      () => "trail-2",
    )

    expect(next).toHaveLength(2)
  })

  it("derives the next-step guidance from the latest trail status", () => {
    const trails = upsertInvestigationTrail(
      [],
      {
        title: "Completed trail",
        predictionId: "prediction-1",
        href: "/predictions/prediction-1",
        detail: "Prediction finished the learning loop.",
        updatedAt: "2026-04-01T05:00:00.000Z",
        kind: "prediction_detail",
        status: "reviewed",
      },
      () => "trail-1",
    )

    expect(getTrailNextStep(trails[0]!)).toContain("completed trail")
  })

  it("keeps library and evaluation context on the same investigation trail", () => {
    const withPrediction = upsertInvestigationTrail(
      [],
      {
        title: "Bank stress investigation",
        eventId: "event-7",
        predictionId: "prediction-7",
        href: "/predictions/prediction-7",
        detail: "Prediction detail opened.",
        updatedAt: "2026-04-01T01:00:00.000Z",
        kind: "prediction_detail",
        status: "under_review",
      },
      () => "trail-7",
    )

    const withEvaluation = upsertInvestigationTrail(
      withPrediction,
      {
        title: "Bank stress investigation",
        trailId: "trail-7",
        predictionId: "prediction-7",
        href: "/evaluation?trail=trail-7",
        detail: "Evaluation context opened.",
        updatedAt: "2026-04-01T02:00:00.000Z",
        kind: "evaluation_context",
        status: "under_review",
      },
      () => "ignored",
    )

    const withLibrary = upsertInvestigationTrail(
      withEvaluation,
      {
        title: "Bank stress investigation",
        trailId: "trail-7",
        predictionId: "prediction-7",
        href: "/library?trail=trail-7",
        detail: "Library lookup opened.",
        updatedAt: "2026-04-01T03:00:00.000Z",
        kind: "library_lookup",
        status: "reviewed",
      },
      () => "ignored",
    )

    expect(withLibrary).toHaveLength(1)
    expect(withLibrary[0]?.steps.map((step) => step.kind)).toEqual([
      "library_lookup",
      "evaluation_context",
      "prediction_detail",
    ])
  })

  it("derives a consistent primary action for each investigation state", () => {
    const drafting = upsertInvestigationTrail(
      [],
      {
        title: "Draft trail",
        eventId: "event-1",
        href: "/studio?run=event-1",
        detail: "Draft is still being captured.",
        updatedAt: "2026-04-01T01:00:00.000Z",
        kind: "studio_run",
        status: "drafting",
      },
      () => "trail-1",
    )[0]!

    const ready = upsertInvestigationTrail(
      [],
      {
        title: "Ready trail",
        eventId: "event-2",
        predictionId: "prediction-2",
        href: "/predictions/prediction-2",
        detail: "Lead prediction is ready for review.",
        updatedAt: "2026-04-01T02:00:00.000Z",
        kind: "prediction_detail",
        status: "ready_for_review",
      },
      () => "trail-2",
    )[0]!

    const reviewing = upsertInvestigationTrail(
      [],
      {
        title: "Reviewing trail",
        eventId: "event-3",
        predictionId: "prediction-3",
        href: "/accuracy?focus=prediction-3",
        detail: "Review is underway.",
        updatedAt: "2026-04-01T03:00:00.000Z",
        kind: "review_focus",
        status: "under_review",
      },
      () => "trail-3",
    )[0]!

    const reviewed = upsertInvestigationTrail(
      [],
      {
        title: "Reviewed trail",
        eventId: "event-4",
        predictionId: "prediction-4",
        href: "/library?trail=trail-4",
        detail: "Lesson retrieval is ready.",
        updatedAt: "2026-04-01T04:00:00.000Z",
        kind: "library_lookup",
        status: "reviewed",
      },
      () => "trail-4",
    )[0]!

    expect(getTrailPrimaryAction(drafting)).toMatchObject({
      href: "/studio?run=event-1",
      label: "Resume Studio",
    })
    expect(getTrailPrimaryAction(ready)).toMatchObject({
      href: "/accuracy?focus=prediction-2",
      label: "Review next",
    })
    expect(getTrailPrimaryAction(reviewing)).toMatchObject({
      href: "/accuracy?focus=prediction-3",
      label: "Continue review",
    })
    expect(getTrailPrimaryAction(reviewed)).toMatchObject({
      href: "/library?trail=trail-4",
      label: "Open Library",
    })
  })

  it("builds a deduplicated shared action rail for the investigation", () => {
    const trail = upsertInvestigationTrail(
      [],
      {
        title: "Shared action trail",
        eventId: "event-9",
        predictionId: "prediction-9",
        href: "/accuracy?focus=prediction-9",
        detail: "Review is in progress.",
        updatedAt: "2026-04-01T05:00:00.000Z",
        kind: "review_focus",
        status: "under_review",
      },
      () => "trail-9",
    )[0]!

    expect(getTrailRelatedActions(trail)).toEqual([
      expect.objectContaining({ href: "/accuracy?focus=prediction-9", label: "Continue review" }),
      expect.objectContaining({ href: "/studio?run=trail-9", label: "Resume Studio" }),
      expect.objectContaining({ href: "/evaluation?trail=trail-9", label: "Open Evaluation" }),
    ])
  })

  it("keeps the authoritative shared status even if older steps hydrate later", () => {
    const trail = upsertInvestigationTrail(
      [],
      {
        title: "Reviewed trail",
        eventId: "event-10",
        predictionId: "prediction-10",
        href: "/predictions/prediction-10",
        detail: "Prediction finished the full scoring and postmortem loop.",
        updatedAt: "2026-04-01T04:00:00.000Z",
        kind: "prediction_detail",
        status: "reviewed",
      },
      () => "trail-10",
    )[0]!

    const hydrated = {
      ...trail,
      status: "reviewed" as const,
      steps: [
        {
          id: "review_focus:prediction-10",
          kind: "review_focus" as const,
          status: "under_review" as const,
          href: "/accuracy?focus=prediction-10",
          title: "Reviewed trail",
          detail: "Older review focus step rehydrated after the reviewed status was already saved.",
          updatedAt: "2026-04-01T03:00:00.000Z",
        },
      ],
    }

    expect(getTrailStatus(hydrated)).toBe("reviewed")
    expect(getTrailPrimaryAction(hydrated)).toMatchObject({
      href: "/library?trail=trail-10",
      label: "Open Library",
    })
  })

  it("preserves newer local reviewed state when server hydration lags behind", () => {
    const serverTrail = upsertInvestigationTrail(
      [],
      {
        title: "Hydration race trail",
        eventId: "event-11",
        predictionId: "prediction-11",
        href: "/accuracy?focus=prediction-11",
        detail: "Server still thinks the review loop is active.",
        updatedAt: "2026-04-01T03:00:00.000Z",
        kind: "review_focus",
        status: "under_review",
      },
      () => "trail-11",
    )

    const localTrail = upsertInvestigationTrail(
      serverTrail,
      {
        title: "Hydration race trail",
        eventId: "event-11",
        predictionId: "prediction-11",
        href: "/predictions/prediction-11",
        detail: "Local prediction detail already recorded the completed postmortem.",
        updatedAt: "2026-04-01T04:00:00.000Z",
        kind: "prediction_detail",
        status: "reviewed",
      },
      () => "trail-11",
    )

    const merged = mergeInvestigationTrails(serverTrail, localTrail)

    expect(merged).toHaveLength(1)
    expect(getTrailStatus(merged[0]!)).toBe("reviewed")
    expect(merged[0]?.steps[0]?.status).toBe("reviewed")
  })
})
