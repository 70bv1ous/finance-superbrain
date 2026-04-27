import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it, vi } from "vitest"

vi.mock("@/components/CorrectionModal", () => ({
  CorrectionModal: () => <div>correction-modal</div>,
}))

import { BrainMessage } from "@/components/BrainMessage"

describe("BrainMessage", () => {
  it("renders the full guided proof structure when available", () => {
    const html = renderToStaticMarkup(
      <BrainMessage
        question="How should the desk frame a hot CPI print?"
        sessionId="session-1"
        response={{
          answer: "The clean first read is duration down, dollar up, and broad equities under pressure until the market can judge whether the inflation surprise is sticky.",
          event_type: "cpi",
          confidence_level: "medium",
          evidence: [
            "Inflation surprises usually reprice the expected Fed path before anything else.",
            "The closest analogue cluster showed the first move in rates and the dollar before equities settled.",
          ],
          limits: [
            "If positioning was already leaning hawkish, the initial duration move can be smaller than the headline suggests.",
          ],
          risks: [
            "A same-day policy headline could overwhelm the clean inflation transmission path.",
          ],
          affected_assets: [
            {
              ticker: "TLT",
              direction: "down",
              rationale: "Higher policy expectations pressure duration first.",
            },
            {
              ticker: "DXY",
              direction: "up",
              rationale: "The dollar usually benefits when the market pushes cuts further out.",
            },
          ],
          analogue_support_summary: "3 analogues matched with the strongest support in inflation-driven rates shocks.",
          memory_support_summary: "1 human Obsidian memory note available; latest imported note: Human Inbox/CPI desk note.md.",
          analogues_referenced: 3,
          session_id: "session-1",
          cached: false,
        }}
      />,
    )

    expect(html).toContain("Bottom line")
    expect(html).toContain("Affected assets")
    expect(html).toContain("Evidence")
    expect(html).toContain("Explicit limits")
    expect(html).toContain("Risk factors")
    expect(html).toContain("Analogue support")
    expect(html).toContain("Human memory support")
    expect(html).toContain("Human Inbox/CPI desk note.md")
    expect(html).toContain("TLT")
    expect(html).toContain("DXY")
    expect(html).toContain("Finance Superbrain")
  })
})
