"use client"

import {
  getGuidedDemoManifestStepByPromptText,
  getGuidedDemoPromptByText,
} from "@finance-superbrain/schemas"
import Link from "next/link"
import { useState } from "react"

import type { ChatResponse } from "@/lib/chatApi"

import { ConfidenceBadge } from "./ConfidenceBadge"
import { CorrectionModal } from "./CorrectionModal"
import { EventTypeBadge } from "./EventTypeBadge"

type Props = {
  response: ChatResponse
  question?: string
  sessionId?: string
}

function ProofSection({
  title,
  tone,
  children,
}: {
  title: string
  tone: "blue" | "amber" | "rose" | "emerald"
  children: React.ReactNode
}) {
  const toneClassName =
    tone === "blue"
      ? "border-blue-500/20 bg-blue-500/10 text-blue-100"
      : tone === "amber"
        ? "border-amber-500/20 bg-amber-500/10 text-amber-100"
        : tone === "rose"
          ? "border-rose-500/20 bg-rose-500/10 text-rose-100"
          : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"

  return (
    <div className={`rounded-2xl border p-4 ${toneClassName}`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.24em]">{title}</p>
      <div className="mt-3 text-sm leading-6 text-current">{children}</div>
    </div>
  )
}

export function BrainMessage({ response, question, sessionId }: Props) {
  const [showModal, setShowModal] = useState(false)
  const [learned, setLearned] = useState(false)
  const [learnedCaseId, setLearnedCaseId] = useState<string | null>(null)
  const guidedPrompt = getGuidedDemoPromptByText(question)
  const manifestStep = getGuidedDemoManifestStepByPromptText(question)
  const evidence = response.evidence ?? []
  const limits = response.limits ?? []
  const risks = response.risks ?? []
  const affectedAssets = response.affected_assets ?? []
  const analogueSupportSummary = response.analogue_support_summary?.trim() || null
  const memorySupportSummary = response.memory_support_summary?.trim() || null

  const handleSuccess = (caseId: string) => {
    setLearned(true)
    setLearnedCaseId(caseId)
    setShowModal(false)
  }

  return (
    <>
      <div className="flex max-w-4xl flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-xs font-bold text-black">
            FS
          </div>
          <span className="text-sm font-medium text-zinc-400">Finance Superbrain</span>
          <EventTypeBadge type={response.event_type} />
          <ConfidenceBadge level={response.confidence_level} />
          {response.cached ? (
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
              Cached
            </span>
          ) : null}
        </div>

        <div className="rounded-[24px] border border-white/10 bg-zinc-900/90 p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-zinc-500">Bottom line</p>
          <p className="mt-3 text-sm leading-7 text-zinc-100">{response.answer}</p>
        </div>

        {guidedPrompt || manifestStep ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.9fr)]">
            {guidedPrompt ? (
              <ProofSection title="What this answer proves" tone="blue">
                <p className="font-medium text-white">{guidedPrompt.proof_goal}</p>
                {manifestStep?.proof_signals?.length ? (
                  <ul className="mt-3 space-y-2">
                    {manifestStep.proof_signals.map((signal) => (
                      <li key={signal} className="flex gap-2">
                        <span className="shrink-0 font-semibold">-</span>
                        <span>{signal}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </ProofSection>
            ) : null}

            {manifestStep ? (
              <ProofSection title="Walkthrough handoff" tone="emerald">
                <p>{manifestStep.proof_purpose}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <Link
                    href={manifestStep.route.href}
                    className="rounded-full border border-white/10 bg-black/15 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-current transition-colors hover:border-white/20 hover:text-white"
                  >
                    {manifestStep.route.label}
                  </Link>
                  {manifestStep.handoff ? (
                    <Link
                      href={manifestStep.handoff.href}
                      className="rounded-full border border-white/10 bg-white/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-current transition-colors hover:border-white/20 hover:text-white"
                    >
                      {manifestStep.handoff.label}
                    </Link>
                  ) : null}
                </div>
              </ProofSection>
            ) : null}
          </div>
        ) : null}

        {memorySupportSummary ? (
          <ProofSection title="Human memory support" tone="emerald">
            <p>{memorySupportSummary}</p>
          </ProofSection>
        ) : null}

        {affectedAssets.length ? (
          <ProofSection title="Affected assets" tone="emerald">
            <div className="grid gap-3 sm:grid-cols-2">
              {affectedAssets.map((asset) => (
                <div key={`${asset.ticker}:${asset.direction}`} className="rounded-xl border border-white/10 bg-black/15 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-white">{asset.ticker}</p>
                    <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-50">
                      {asset.direction}
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-emerald-50/85">{asset.rationale}</p>
                </div>
              ))}
            </div>
          </ProofSection>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-3">
          {evidence.length ? (
            <ProofSection title="Evidence" tone="blue">
              <ul className="space-y-2">
                {evidence.map((point, index) => (
                  <li key={index} className="flex gap-2">
                    <span className="shrink-0 font-semibold">{index + 1}.</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            </ProofSection>
          ) : null}

          {limits.length ? (
            <ProofSection title="Explicit limits" tone="amber">
              <ul className="space-y-2">
                {limits.map((limit, index) => (
                  <li key={index} className="flex gap-2">
                    <span className="shrink-0 font-semibold">-</span>
                    <span>{limit}</span>
                  </li>
                ))}
              </ul>
            </ProofSection>
          ) : null}

          {risks.length ? (
            <ProofSection title="Risk factors" tone="rose">
              <ul className="space-y-2">
                {risks.map((risk, index) => (
                  <li key={index} className="flex gap-2">
                    <span className="shrink-0 font-semibold">!</span>
                    <span>{risk}</span>
                  </li>
                ))}
              </ul>
            </ProofSection>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-zinc-300 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <p className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Analogue support</p>
            <p>
              {analogueSupportSummary ??
                (response.analogues_referenced > 0
                  ? `${response.analogues_referenced} historical analogue${response.analogues_referenced !== 1 ? "s" : ""} referenced.`
                  : "No strong analogue cluster was available for this answer.")}
            </p>
          </div>

          {learned ? (
            <div className="flex items-center gap-1.5 text-xs text-emerald-400">
              <span className="flex h-4 min-w-4 items-center justify-center rounded-full border border-emerald-500/40 bg-emerald-500/20 px-1 text-[9px]">
                OK
              </span>
              Brain learned | {learnedCaseId}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="rounded-full border border-white/10 px-3 py-1.5 text-xs uppercase tracking-[0.24em] text-zinc-400 transition-colors hover:border-rose-400/30 hover:text-rose-200"
              title="Tell the brain what actually happened so it can learn"
            >
              Brain got this wrong
            </button>
          )}
        </div>
      </div>

      {showModal ? (
        <CorrectionModal
          question={question ?? "Market question"}
          brainAnswer={response.answer}
          sessionId={sessionId}
          onClose={() => setShowModal(false)}
          onSuccess={handleSuccess}
        />
      ) : null}
    </>
  )
}
