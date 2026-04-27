import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"

import { RouteEmptyState, RouteErrorState, RouteLoadingState, RouteNoticeState } from "@/components/RouteState"

describe("RouteState", () => {
  it("renders the loading state copy", () => {
    const html = renderToStaticMarkup(
      <RouteLoadingState title="Loading workspace" description="Rebuilding your operator context." />,
    )

    expect(html).toContain("loading")
    expect(html).toContain("Loading workspace")
    expect(html).toContain("Rebuilding your operator context.")
  })

  it("renders action links for empty and error states", () => {
    const emptyHtml = renderToStaticMarkup(
      <RouteEmptyState
        title="No saved work"
        description="Create a Studio run to see continuity here."
        actionHref="/studio"
        actionLabel="Open Studio"
      />,
    )
    const errorHtml = renderToStaticMarkup(
      <RouteErrorState
        title="Prediction failed"
        description="Try reloading the stored prediction detail."
        actionHref="/accuracy"
        actionLabel="Back to accuracy"
      />,
    )

    expect(emptyHtml).toContain("Open Studio")
    expect(emptyHtml).toContain("Create a Studio run to see continuity here.")
    expect(errorHtml).toContain("Back to accuracy")
    expect(errorHtml).toContain("Prediction failed")
  })

  it("renders notice state styling copy without an action", () => {
    const html = renderToStaticMarkup(
      <RouteNoticeState title="Saved successfully" description="The review notes are now part of the investigation trail." />,
    )

    expect(html).toContain("notice")
    expect(html).toContain("Saved successfully")
    expect(html).toContain("The review notes are now part of the investigation trail.")
  })
})
