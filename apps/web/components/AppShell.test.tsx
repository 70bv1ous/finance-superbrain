import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("next/navigation", () => ({
  usePathname: () => "/studio",
  useRouter: () => ({
    replace: vi.fn(),
  }),
}))

vi.mock("@/components/WorkspaceProvider", () => ({
  useWorkspace: () => ({
    authenticated: true,
    hydrated: true,
    logout: vi.fn(),
    studioDraft: {
      form: {
        title: "Fed draft",
      },
    },
    user: {
      id: "user-1",
      display_name: "Lead operator",
    },
    investigationTrails: [
      {
        id: "trail-draft",
        title: "Draft trail",
        eventId: "event-1",
        predictionIds: [],
        updatedAt: "2026-04-01T01:00:00.000Z",
        steps: [
          {
            id: "studio_run:event-1",
            kind: "studio_run",
            status: "drafting",
            href: "/studio?run=event-1",
            title: "Draft saved",
            detail: "Draft still in progress.",
            updatedAt: "2026-04-01T01:00:00.000Z",
          },
        ],
      },
      {
        id: "trail-review",
        title: "Review trail",
        eventId: "event-2",
        predictionIds: ["prediction-2"],
        updatedAt: "2026-04-01T02:00:00.000Z",
        steps: [
          {
            id: "review_focus:prediction-2",
            kind: "review_focus",
            status: "under_review",
            href: "/accuracy?focus=prediction-2",
            title: "Review focus",
            detail: "Notes still needed.",
            updatedAt: "2026-04-01T02:00:00.000Z",
          },
        ],
      },
      {
        id: "trail-reviewed",
        title: "Reviewed trail",
        eventId: "event-3",
        predictionIds: ["prediction-3"],
        updatedAt: "2026-04-01T03:00:00.000Z",
        steps: [
          {
            id: "library_lookup:prediction-3",
            kind: "library_lookup",
            status: "reviewed",
            href: "/library?trail=trail-reviewed",
            title: "Library follow-up",
            detail: "Ready for retrieval.",
            updatedAt: "2026-04-01T03:00:00.000Z",
          },
        ],
      },
    ],
  }),
}))

vi.mock("@/components/MarketTickerBar", () => ({
  MarketTickerBar: () => <div>ticker-strip</div>,
}))

vi.mock("@/components/EventsStrip", () => ({
  EventsStrip: () => <div>events-strip</div>,
}))

import { AppShell } from "@/components/AppShell"

describe("AppShell", () => {
  it("renders nav, workspace pulse, and shared chrome", () => {
    const html = renderToStaticMarkup(
      <AppShell title="Studio" subtitle="Operator workflow">
        <div>studio-content</div>
      </AppShell>,
    )

    expect(html).toContain("Studio")
    expect(html).toContain("Command center")
    expect(html).toContain("Platform live")
    expect(html).toContain("Draft in progress")
    expect(html).toContain("1 active investigation")
    expect(html).toContain("1 awaiting review")
    expect(html).toContain("1 retrieval-ready")
    expect(html).toContain("ticker-strip")
    expect(html).toContain("events-strip")
    expect(html).toContain("studio-content")
  })
})
