import { describe, expect, it } from "vitest"

import type { Lesson } from "@/lib/chatApi"
import { getLinkedObsidianLessons, getObsidianLessonTitle, isObsidianImportedLesson } from "@/lib/obsidianLinkedMemory"

function lesson(id: string, metadata: Record<string, string>, createdAt: string): Lesson {
  return {
    id,
    prediction_id: `prediction-${id}`,
    lesson_type: "reinforcement",
    lesson_summary: `Summary ${id}`,
    metadata,
    created_at: createdAt,
  }
}

describe("obsidian linked memory", () => {
  it("detects both legacy and selective Human Inbox imports", () => {
    expect(isObsidianImportedLesson(lesson("a", { imported_from: "obsidian" }, "2026-01-01T00:00:00.000Z"))).toBe(true)
    expect(isObsidianImportedLesson(lesson("b", { import_mode: "selective_human_inbox" }, "2026-01-01T00:00:00.000Z"))).toBe(true)
    expect(isObsidianImportedLesson(lesson("c", {}, "2026-01-01T00:00:00.000Z"))).toBe(false)
  })

  it("returns linked imported lessons sorted newest first", () => {
    const linkedNew = lesson(
      "new",
      { imported_from: "obsidian", decision_brief_id: "decision-1" },
      "2026-01-03T00:00:00.000Z",
    )
    const linkedOld = lesson(
      "old",
      { import_mode: "selective_human_inbox", portfolio_candidate_id: "portfolio-1" },
      "2026-01-01T00:00:00.000Z",
    )
    const unlinked = lesson(
      "unlinked",
      { imported_from: "obsidian", decision_brief_id: "decision-2" },
      "2026-01-04T00:00:00.000Z",
    )
    const systemLesson = lesson("system", { decision_brief_id: "decision-1" }, "2026-01-05T00:00:00.000Z")

    expect(
      getLinkedObsidianLessons([linkedOld, systemLesson, unlinked, linkedNew], {
        decisionBriefId: "decision-1",
        portfolioCandidateId: "portfolio-1",
      }).map((entry) => entry.id),
    ).toEqual(["new", "old"])
  })

  it("uses the Obsidian title when one was imported", () => {
    expect(getObsidianLessonTitle(lesson("a", { obsidian_title: "CPI desk note" }, "2026-01-01T00:00:00.000Z"))).toBe(
      "CPI desk note",
    )
    expect(getObsidianLessonTitle(lesson("b", {}, "2026-01-01T00:00:00.000Z"))).toBe("Summary b")
  })
})
