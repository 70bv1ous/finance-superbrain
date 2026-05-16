import type { Lesson } from "@/lib/chatApi"
import { getObsidianLessonTitle } from "@/lib/obsidianLinkedMemory"

function formatDate(value: string) {
  return new Date(value).toLocaleDateString()
}

export function LinkedObsidianMemoryPanel({
  lessons,
  emptyDescription,
}: {
  lessons: Lesson[]
  emptyDescription: string
}) {
  return (
    <div className="space-y-3">
      {lessons.length ? (
        lessons.slice(0, 5).map((lesson) => {
          const sourcePath = lesson.metadata.obsidian_relative_path ?? "Obsidian Human Inbox note"
          const assets = lesson.metadata.assets?.split(",").map((asset) => asset.trim()).filter(Boolean) ?? []
          const themes = lesson.metadata.themes?.split(",").map((theme) => theme.trim()).filter(Boolean) ?? []

          return (
            <div key={lesson.id} className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs uppercase tracking-[0.24em] text-emerald-200">Obsidian human memory</p>
                  <p className="mt-2 text-sm font-medium text-white">{getObsidianLessonTitle(lesson)}</p>
                </div>
                <span className="text-[11px] uppercase tracking-[0.24em] text-emerald-100/70">
                  {formatDate(lesson.created_at)}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-emerald-50/85">{lesson.lesson_summary}</p>
              <p className="mt-3 text-xs text-emerald-100/70">{sourcePath}</p>
              {assets.length || themes.length ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {[...assets, ...themes].slice(0, 8).map((tag) => (
                    <span
                      key={`${lesson.id}:${tag}`}
                      className="rounded-full border border-emerald-400/20 bg-zinc-950/40 px-2.5 py-1 text-[11px] text-emerald-50/80"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          )
        })
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <p className="text-sm leading-6 text-zinc-400">{emptyDescription}</p>
        </div>
      )}
    </div>
  )
}
