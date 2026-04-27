import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import {
  InvestigationTrailActions,
  InvestigationTrailStatusSummary,
  InvestigationTrailSteps,
  InvestigationTrailSummary,
} from "@/components/InvestigationTrailView"
import type { InvestigationTrail } from "@/lib/investigationTrail"

const baseTrail: InvestigationTrail = {
  id: "trail-1",
  title: "Fed hold investigation",
  eventId: "event-1",
  predictionIds: ["prediction-1"],
  updatedAt: "2026-04-01T05:00:00.000Z",
  steps: [
    {
      id: "review_focus:prediction-1",
      kind: "review_focus",
      status: "under_review",
      href: "/accuracy?focus=prediction-1",
      title: "Prediction entered the review desk",
      detail: "Operator is working verdict and notes.",
      updatedAt: "2026-04-01T05:00:00.000Z",
    },
    {
      id: "prediction_detail:prediction-1",
      kind: "prediction_detail",
      status: "ready_for_review",
      href: "/predictions/prediction-1",
      title: "Prediction detail reopened",
      detail: "Stored thesis and scorecard were inspected.",
      updatedAt: "2026-04-01T04:00:00.000Z",
    },
  ],
}

describe("InvestigationTrailView", () => {
  it("renders the shared summary with a primary action", () => {
    const html = renderToStaticMarkup(
      <InvestigationTrailSummary
        trail={baseTrail}
        label="Focused investigation"
        summary="Investigation is actively under review."
      />,
    )

    expect(html).toContain("Focused investigation")
    expect(html).toContain("Fed hold investigation")
    expect(html).toContain("Continue review")
    expect(html).toContain("Investigation is actively under review.")
  })

  it("renders shared trail actions without duplicating the primary action", () => {
    const html = renderToStaticMarkup(<InvestigationTrailActions trail={baseTrail} />)

    expect(html).toContain("Resume Studio")
    expect(html).toContain("Open Evaluation")
    expect(html).not.toContain("Continue review")
  })

  it("renders trail steps and status summary for the operator trail UI", () => {
    const html = renderToStaticMarkup(
      <div>
        <InvestigationTrailStatusSummary trail={baseTrail} summary="Shared investigation state." />
        <InvestigationTrailSteps steps={baseTrail.steps} limit={2} />
      </div>,
    )

    expect(html).toContain("under review")
    expect(html).toContain("Shared investigation state.")
    expect(html).toContain("Prediction entered the review desk")
    expect(html).toContain("Prediction detail reopened")
  })
})
