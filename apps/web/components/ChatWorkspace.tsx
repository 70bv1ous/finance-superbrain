"use client"

import {
  GUIDED_DEMO_MANIFEST,
  GUIDED_DEMO_PROMPTS,
  GUIDED_DEMO_PROMPT_ORDER,
  GUIDED_DEMO_PROMPT_CATEGORIES,
  type GuidedDemoPrompt,
  type GuidedDemoPromptCategory,
} from "@finance-superbrain/schemas"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { Suspense, useEffect, useMemo, useRef, useState } from "react"

import { BrainMessage } from "@/components/BrainMessage"
import {
  loadStoredChatSessions,
  saveStoredChatSessions,
  type StoredChatSession,
  type StoredThreadMessage,
} from "@/lib/chatSessionStore"
import { sendChatMessage, type ChatMessage, type ChatResponse } from "@/lib/chatApi"

const GUIDED_PROMPT_GROUPS = Object.entries(GUIDED_DEMO_PROMPT_CATEGORIES).map(([category, meta]) => ({
  category: category as GuidedDemoPromptCategory,
  ...meta,
  prompts: GUIDED_DEMO_PROMPTS.filter((prompt) => prompt.category === category),
}))

const GUIDED_MANIFEST_PROMPT_STEPS = GUIDED_DEMO_MANIFEST.filter(
  (step) => step.kind === "prompt" && step.prompt_id,
)
const GUIDED_MANIFEST_ROUTE_STEPS = GUIDED_DEMO_MANIFEST.filter((step) => step.kind === "route")
const GUIDED_PROMPT_ORDER_INDEX = new Map(GUIDED_DEMO_PROMPT_ORDER.map((promptId, index) => [promptId, index]))

type ThreadMessage = ChatMessage & {
  question?: string
}

function hydrateMessage(message: StoredThreadMessage): ThreadMessage {
  return {
    ...message,
    timestamp: new Date(message.timestamp),
  }
}

function serializeMessage(message: ThreadMessage): StoredThreadMessage {
  return {
    ...message,
    timestamp: message.timestamp.toISOString(),
  }
}

function deriveTitle(messages: ThreadMessage[]) {
  const firstUserMessage = messages.find((message) => message.role === "user")?.content.trim()

  if (!firstUserMessage) {
    return "Untitled thread"
  }

  return firstUserMessage.length > 64 ? `${firstUserMessage.slice(0, 61)}...` : firstUserMessage
}

function formatSessionTimestamp(value: string) {
  const date = new Date(value)
  const diff = Date.now() - date.getTime()
  const minutes = Math.floor(diff / 60000)

  if (minutes < 1) {
    return "Just now"
  }

  if (minutes < 60) {
    return `${minutes}m ago`
  }

  const hours = Math.floor(minutes / 60)

  if (hours < 24) {
    return `${hours}h ago`
  }

  const days = Math.floor(hours / 24)

  if (days < 7) {
    return `${days}d ago`
  }

  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" })
}

function upsertSession(
  sessions: StoredChatSession[],
  nextSession: StoredChatSession,
) {
  return [nextSession, ...sessions.filter((session) => session.id !== nextSession.id)].sort(
    (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
  )
}

function ProofPillar({
  title,
  detail,
}: {
  title: string
  detail: string
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
      <p className="text-xs uppercase tracking-[0.24em] text-zinc-500">{title}</p>
      <p className="mt-3 text-sm leading-6 text-zinc-300">{detail}</p>
    </div>
  )
}

function GuidedPromptButton({
  prompt,
  disabled,
  onSelect,
}: {
  prompt: GuidedDemoPrompt
  disabled: boolean
  onSelect: (prompt: string) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(prompt.prompt)}
      disabled={disabled}
      className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-4 text-left transition-colors hover:border-emerald-400/30 hover:bg-emerald-400/10 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <p className="text-sm font-semibold text-white">{prompt.label}</p>
      <p className="mt-2 text-sm leading-6 text-zinc-400">{prompt.proof_goal}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Launch guided proof</p>
        {GUIDED_PROMPT_ORDER_INDEX.has(prompt.id) ? (
          <span className="rounded-full border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.24em] text-emerald-200/80">
            Step {Number(GUIDED_PROMPT_ORDER_INDEX.get(prompt.id)) + 1}
          </span>
        ) : null}
      </div>
    </button>
  )
}

function DemoRunbook({
  loading,
}: {
  loading: boolean
}) {
  return (
    <div className="rounded-[24px] border border-emerald-500/20 bg-emerald-500/10 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-200/80">Curated investor walkthrough</p>
          <h3 className="mt-2 font-display text-2xl font-semibold text-white">One repeatable proof path from answer quality to operating continuity.</h3>
        </div>
        <div className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-emerald-50/80">
          10-15 minute flow
        </div>
      </div>

      <div className="mt-5 grid gap-3 xl:grid-cols-2">
        {GUIDED_MANIFEST_PROMPT_STEPS.map((step) => (
          <div key={step.id} className="rounded-2xl border border-white/10 bg-black/10 p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{step.title}</p>
                <p className="mt-2 text-sm leading-6 text-emerald-50/85">{step.proof_purpose}</p>
              </div>
              <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-100/80">
                Prompt
              </span>
            </div>
            {step.handoff ? (
              <p className="mt-3 text-[11px] uppercase tracking-[0.24em] text-emerald-100/70">
                Next route: {step.handoff.label}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {GUIDED_MANIFEST_ROUTE_STEPS.slice(0, 3).map((step) => (
          <Link
            key={step.id}
            href={step.route.href}
            className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-emerald-50 transition-colors hover:border-white/20 hover:text-white"
          >
            {step.route.label}
          </Link>
        ))}
        {loading ? (
          <span className="rounded-full border border-white/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-emerald-50/70">
            Running prompt...
          </span>
        ) : null}
      </div>
    </div>
  )
}

function PromptBank({
  loading,
  onSelect,
}: {
  loading: boolean
  onSelect: (prompt: string) => void
}) {
  return (
    <div className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Guided demo prompt bank</p>
          <h3 className="mt-2 font-display text-2xl font-semibold text-white">Repeatable intelligence proof, one click away.</h3>
        </div>
        <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-zinc-400">
          {GUIDED_DEMO_PROMPTS.length} curated prompts
        </div>
      </div>

      <div className="mt-5">
        <DemoRunbook loading={loading} />
      </div>

      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        {GUIDED_PROMPT_GROUPS.map((group) => (
          <div key={group.category} className="rounded-[22px] border border-white/10 bg-black/10 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-white">{group.label}</p>
                <p className="mt-2 text-sm leading-6 text-zinc-400">{group.description}</p>
              </div>
              <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                {group.prompts.length}
              </span>
            </div>

            <div className="mt-4 space-y-3">
              {group.prompts.map((prompt) => (
                <GuidedPromptButton
                  key={prompt.id}
                  prompt={prompt}
                  disabled={loading}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ChatWorkspaceContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [sessions, setSessions] = useState<StoredChatSession[]>([])
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null)
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [draftTitle, setDraftTitle] = useState("")
  const [isHydrated, setIsHydrated] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const storedSessions = loadStoredChatSessions()
    const requestedThreadId = searchParams.get("thread")
    const restoredThread = requestedThreadId
      ? storedSessions.find((session) => session.id === requestedThreadId) ?? null
      : null

    setSessions(storedSessions)
    setActiveThreadId(restoredThread?.id ?? storedSessions[0]?.id ?? null)
    setIsHydrated(true)
  }, [searchParams])

  useEffect(() => {
    if (!isHydrated) {
      return
    }

    saveStoredChatSessions(sessions)
  }, [isHydrated, sessions])

  useEffect(() => {
    if (!isHydrated) {
      return
    }

    const requestedThreadId = searchParams.get("thread")

    if (!requestedThreadId) {
      return
    }

    if (!sessions.some((session) => session.id === requestedThreadId)) {
      router.replace("/workspace", { scroll: false })
      return
    }

    if (activeThreadId !== requestedThreadId) {
      setActiveThreadId(requestedThreadId)
      setError(null)
    }
  }, [activeThreadId, isHydrated, router, searchParams, sessions])

  const activeSession = sessions.find((session) => session.id === activeThreadId) ?? null
  const messages = useMemo(
    () => (activeSession ? activeSession.messages.map(hydrateMessage) : []),
    [activeSession],
  )
  const sessionId = activeSession?.sessionId

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading])

  const beginNewThread = () => {
    if (loading) {
      return
    }

    setActiveThreadId(null)
    setEditingThreadId(null)
    setDraftTitle("")
    setInput("")
    setError(null)
    router.replace("/workspace", { scroll: false })
  }

  const submit = async (query: string) => {
    const trimmed = query.trim()

    if (!trimmed || loading) {
      return
    }

    const now = new Date()
    const threadId = activeThreadId ?? crypto.randomUUID()
    const createdAt = activeSession?.createdAt ?? now.toISOString()
    const userMsg: ThreadMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: trimmed,
      timestamp: now,
    }
    const nextMessages = [...messages, userMsg]

    setError(null)
    setInput("")
    setLoading(true)
    setActiveThreadId(threadId)
    router.replace(`/workspace?thread=${threadId}`, { scroll: false })
    setSessions((currentSessions) =>
      upsertSession(currentSessions, {
        id: threadId,
        sessionId,
        title: deriveTitle(nextMessages),
        createdAt,
        updatedAt: now.toISOString(),
        messages: nextMessages.map(serializeMessage),
      }),
    )

    try {
      const response: ChatResponse = await sendChatMessage(trimmed, sessionId)
      const responseAt = new Date()
      const brainMsg: ThreadMessage = {
        id: crypto.randomUUID(),
        role: "brain",
        content: response.answer,
        response,
        question: trimmed,
        timestamp: responseAt,
      }

      setSessions((currentSessions) => {
        const currentSession = currentSessions.find((session) => session.id === threadId)
        const persistedMessages = currentSession?.messages.map(hydrateMessage) ?? nextMessages
        const nextThreadMessages = [...persistedMessages, brainMsg]

        return upsertSession(currentSessions, {
          id: threadId,
          sessionId: response.session_id,
          title: deriveTitle(nextThreadMessages),
          createdAt,
          updatedAt: responseAt.toISOString(),
          messages: nextThreadMessages.map(serializeMessage),
        })
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setLoading(false)
    }
  }

  const removeSession = (threadId: string) => {
    if (loading) {
      return
    }

    setSessions((currentSessions) => {
      const remainingSessions = currentSessions.filter((session) => session.id !== threadId)

      if (activeThreadId === threadId) {
        const nextThreadId = remainingSessions[0]?.id ?? null
        setActiveThreadId(nextThreadId)
        router.replace(nextThreadId ? `/workspace?thread=${nextThreadId}` : "/workspace", { scroll: false })
      }

      return remainingSessions
    })

    if (editingThreadId === threadId) {
      setEditingThreadId(null)
      setDraftTitle("")
    }

    setError(null)
  }

  const saveRenamedSession = (threadId: string) => {
    const trimmed = draftTitle.trim()

    setSessions((currentSessions) =>
      currentSessions.map((session) =>
        session.id === threadId
          ? {
              ...session,
              title: trimmed || deriveTitle(session.messages.map(hydrateMessage)),
            }
          : session,
      ),
    )
    setEditingThreadId(null)
    setDraftTitle("")
  }

  return (
    <section
      id="intelligence-proof"
      className="overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950/75 shadow-[0_28px_70px_rgba(0,0,0,0.35)] backdrop-blur"
    >
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
        <div>
          <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-300/80">Guided intelligence proof</p>
          <h2 className="font-display text-lg font-semibold text-white">Evidence desk</h2>
          <p className="mt-1 text-sm text-zinc-500">
            Strong answers should show a bottom line, affected assets, evidence basis, explicit limits, and invalidation risk.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {sessions.length > 0 ? (
            <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
              {sessions.length} saved thread{sessions.length !== 1 ? "s" : ""}
            </span>
          ) : null}
          <button
            type="button"
            onClick={beginNewThread}
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-zinc-400 transition-colors hover:border-white/20 hover:text-zinc-100"
          >
            New thread
          </button>
        </div>
      </div>

      <div className="grid min-h-[560px] gap-0 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="border-b border-white/10 bg-zinc-950/80 px-4 py-5 lg:border-b-0 lg:border-r">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Session continuity</p>
              <h3 className="mt-2 text-sm font-medium text-white">Saved threads</h3>
            </div>
          </div>

          <div className="mt-4 space-y-2.5">
            {!isHydrated ? (
              <p className="text-sm text-zinc-500">Loading saved threads...</p>
            ) : sessions.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-zinc-500">
                New threads are saved in your browser automatically after the first question.
              </div>
            ) : (
              sessions.map((session) => {
                const isActive = session.id === activeThreadId
                const isEditing = session.id === editingThreadId

                return (
                  <div
                    key={session.id}
                    className={[
                      "rounded-2xl border p-3 transition-colors",
                      isActive
                        ? "border-emerald-400/35 bg-emerald-400/10"
                        : "border-white/10 bg-white/5 hover:border-white/20",
                    ].join(" ")}
                  >
                    {isEditing ? (
                      <form
                        onSubmit={(event) => {
                          event.preventDefault()
                          saveRenamedSession(session.id)
                        }}
                      >
                        <input
                          autoFocus
                          value={draftTitle}
                          onChange={(event) => setDraftTitle(event.target.value)}
                          onBlur={() => saveRenamedSession(session.id)}
                          className="w-full rounded-xl border border-white/10 bg-zinc-950/80 px-3 py-2 text-sm text-white focus:border-emerald-500/50 focus:outline-none"
                        />
                      </form>
                    ) : (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          setActiveThreadId(session.id)
                          setError(null)
                          router.replace(`/workspace?thread=${session.id}`, { scroll: false })
                        }}
                        className="w-full text-left"
                      >
                        <p className="line-clamp-2 text-sm font-medium text-white">{session.title}</p>
                        <p className="mt-2 text-xs text-zinc-500">
                          {session.messages.length} message{session.messages.length !== 1 ? "s" : ""} | {formatSessionTimestamp(session.updatedAt)}
                        </p>
                      </button>
                    )}

                    <div className="mt-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => {
                          setEditingThreadId(session.id)
                          setDraftTitle(session.title)
                        }}
                        className="rounded-full border border-white/10 px-2 py-1 transition-colors hover:border-white/20 hover:text-zinc-200 disabled:opacity-50"
                      >
                        Rename
                      </button>
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => removeSession(session.id)}
                        className="rounded-full border border-white/10 px-2 py-1 transition-colors hover:border-red-400/30 hover:text-red-200 disabled:opacity-50"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </aside>

        <div className="px-5 py-5">
          <div className="grid gap-6">
            <div className="grid gap-3 lg:grid-cols-4">
              <ProofPillar
                title="Bottom line"
                detail="Lead with the cleanest defensible market view instead of an open-ended brainstorm."
              />
              <ProofPillar
                title="Affected assets"
                detail="Make the cross-asset transmission visible with directional views and short rationales."
              />
              <ProofPillar
                title="Evidence basis"
                detail="Tie the answer back to live context, retrieval support, and known finance transmission paths."
              />
              <ProofPillar
                title="Explicit limits"
                detail="Show where confidence should stay constrained rather than pretending the system always knows."
              />
            </div>

            <PromptBank loading={loading} onSelect={(prompt) => void submit(prompt)} />
          </div>

          {messages.length === 0 ? (
            <div className="mt-6 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
              <div className="rounded-[24px] border border-white/10 bg-white/5 p-6">
                <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Operator notes</p>
                <h3 className="mt-3 font-display text-3xl font-semibold text-white">
                  Use the guided bank to prove finance reasoning, not just to generate polished prose.
                </h3>
                <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-400">
                  The prompt bank is designed for guided walkthroughs: macro, policy, earnings, and portfolio
                  follow-through questions that show whether the system can map evidence into a disciplined market view.
                </p>
                <div className="mt-6 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-emerald-200/80">Grounded</p>
                    <p className="mt-2 text-sm text-emerald-50">Run retrieval-backed prompts that must surface evidence, asset views, and invalidations.</p>
                  </div>
                  <div className="rounded-2xl border border-cyan-400/20 bg-cyan-400/10 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">Repeatable</p>
                    <p className="mt-2 text-sm text-cyan-50">Every guided prompt is shared with the eval path so demo quality can be tested, not just narrated.</p>
                  </div>
                  <div className="rounded-2xl border border-amber-400/20 bg-amber-400/10 p-4">
                    <p className="text-xs uppercase tracking-[0.24em] text-amber-200/80">Honest</p>
                    <p className="mt-2 text-sm text-amber-50">If support is thin, the desk should narrow the answer and say exactly where confidence runs out.</p>
                  </div>
                </div>
              </div>

              <div className="rounded-[24px] border border-white/10 bg-zinc-900/75 p-5">
                <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">What a strong answer shows</p>
                <div className="mt-4 space-y-3">
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-semibold text-white">Cross-asset map</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      Identify which assets should absorb the information first and why.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-semibold text-white">Evidence before confidence</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      Confidence should come from retrieval support and finance logic, not from smoother prose.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-semibold text-white">Clear limits and invalidations</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      The system should say what could overpower the thesis or keep the answer constrained.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <p className="text-sm font-semibold text-white">Continuity</p>
                    <p className="mt-2 text-sm leading-6 text-zinc-400">
                      Threads stay saved in your browser so guided demo runs can be resumed without rebuilding context.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-6 space-y-6">
              {messages.map((msg) => (
                <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "user" ? (
                    <div className="max-w-2xl rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 shadow-sm">
                      {msg.content}
                    </div>
                  ) : msg.response ? (
                    <BrainMessage response={msg.response} question={msg.question} sessionId={sessionId} />
                  ) : null}
                </div>
              ))}

              {loading ? (
                <div className="flex justify-start">
                  <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-zinc-900/90 px-4 py-3">
                    <div className="flex gap-1">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: "0ms" }} />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: "150ms" }} />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-zinc-500" style={{ animationDelay: "300ms" }} />
                    </div>
                    <span className="text-sm text-zinc-500">Analyzing event path...</span>
                  </div>
                </div>
              ) : null}

              <div ref={bottomRef} />
            </div>
          )}

          {error ? (
            <div className="mt-5 rounded-2xl border border-red-900/50 bg-red-950/40 px-4 py-3 text-sm text-red-200">
              {error}
            </div>
          ) : null}

          <div className="mt-5 border-t border-white/10 pt-4">
            <form
              onSubmit={(event) => {
                event.preventDefault()
                void submit(input)
              }}
              className="flex flex-col gap-3 md:flex-row"
            >
              <input
                value={input}
              onChange={(event) => setInput(event.target.value)}
                placeholder="Ask about macro, policy, earnings, portfolio follow-through, or launch a guided proof prompt above..."
                disabled={loading}
                className="flex-1 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-500/50 focus:outline-none disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={loading || !input.trim()}
                className="rounded-2xl bg-emerald-500 px-5 py-3 text-sm font-medium text-black transition-colors hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-600"
              >
                {loading ? "Running..." : "Run intelligence proof"}
              </button>
            </form>
            <p className="mt-2 text-xs text-zinc-600">
              Powered by the shared intelligence layer, retrieval support, supervised workers, and passive monitoring surface.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export function ChatWorkspace() {
  return (
    <Suspense
      fallback={
        <section className="overflow-hidden rounded-[28px] border border-white/10 bg-zinc-950/75 shadow-[0_28px_70px_rgba(0,0,0,0.35)] backdrop-blur">
          <div className="px-5 py-6 text-sm text-zinc-500">Loading saved chat workspace...</div>
        </section>
      }
    >
      <ChatWorkspaceContent />
    </Suspense>
  )
}
