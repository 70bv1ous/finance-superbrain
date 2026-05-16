import type { Lesson } from "@/lib/chatApi"

export type LinkedMemoryTarget = {
  investigationId?: string | null
  decisionBriefId?: string | null
  portfolioCandidateId?: string | null
}

export function isObsidianImportedLesson(lesson: Lesson) {
  return lesson.metadata.imported_from === "obsidian" || lesson.metadata.import_mode === "selective_human_inbox"
}

export function getLinkedObsidianLessons(lessons: Lesson[], target: LinkedMemoryTarget) {
  const matchesTarget = (lesson: Lesson) =>
    Boolean(
      (target.investigationId && lesson.metadata.investigation_id === target.investigationId) ||
        (target.decisionBriefId && lesson.metadata.decision_brief_id === target.decisionBriefId) ||
        (target.portfolioCandidateId && lesson.metadata.portfolio_candidate_id === target.portfolioCandidateId),
    )

  return lessons
    .filter((lesson) => isObsidianImportedLesson(lesson) && matchesTarget(lesson))
    .sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
}

export function getObsidianLessonTitle(lesson: Lesson) {
  return lesson.metadata.obsidian_title?.trim() || lesson.lesson_summary
}
