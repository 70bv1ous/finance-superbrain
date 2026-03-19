"use client"

import { useState } from "react"
import type { ChatResponse } from "@/lib/chatApi"
import { ConfidenceBadge } from "./ConfidenceBadge"
import { EventTypeBadge } from "./EventTypeBadge"
import { CorrectionModal } from "./CorrectionModal"

type Props = {
  response: ChatResponse
  question?: string
  sessionId?: string
}

export function BrainMessage({ response, question, sessionId }: Props) {
  const [showModal, setShowModal]   = useState(false)
  const [learned, setLearned]       = useState(false)
  const [learnedCaseId, setLearnedCaseId] = useState<string | null>(null)

  const handleSuccess = (caseId: string) => {
    setLearned(true)
    setLearnedCaseId(caseId)
    setShowModal(false)
  }

  return (
    <>
      <div className="flex flex-col gap-3 max-w-3xl">
        {/* Header badges */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center text-black text-xs font-bold shrink-0">FS</div>
          <span className="text-zinc-400 text-sm font-medium">Finance Superbrain</span>
          <EventTypeBadge type={response.event_type} />
          <ConfidenceBadge level={response.confidence_level} />
        </div>

        {/* Main analysis */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4 text-zinc-100 text-sm leading-relaxed">
          {response.answer}
        </div>

        {/* Evidence */}
        {response.evidence.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-blue-400 text-xs font-bold tracking-widest mb-2">EVIDENCE</p>
            <ul className="space-y-1.5">
              {response.evidence.map((point, i) => (
                <li key={i} className="flex gap-2 text-sm text-zinc-300">
                  <span className="text-blue-500 font-bold shrink-0">{i + 1}.</span>
                  <span>{point}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Risks */}
        {response.risks.length > 0 && (
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-4">
            <p className="text-red-400 text-xs font-bold tracking-widest mb-2">RISK FACTORS</p>
            <ul className="space-y-1.5">
              {response.risks.map((risk, i) => (
                <li key={i} className="flex gap-2 text-sm text-zinc-300">
                  <span className="text-red-500 font-bold shrink-0">⚠</span>
                  <span>{risk}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Footer row: analogue count + feedback button */}
        <div className="flex items-center justify-between">
          {response.analogues_referenced > 0 ? (
            <p className="text-zinc-600 text-xs">
              {response.analogues_referenced} historical analogue{response.analogues_referenced !== 1 ? "s" : ""} referenced
            </p>
          ) : (
            <span />
          )}

          {/* Feedback — learned state or correction button */}
          {learned ? (
            <div className="flex items-center gap-1.5 text-emerald-500 text-xs">
              <span className="w-3 h-3 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-[9px]">✓</span>
              Brain learned · {learnedCaseId}
            </div>
          ) : (
            <button
              onClick={() => setShowModal(true)}
              className="text-zinc-600 hover:text-red-400 text-xs transition-colors flex items-center gap-1"
              title="Tell the brain what actually happened so it can learn"
            >
              <span className="text-[10px]">✕</span>
              Brain got this wrong
            </button>
          )}
        </div>
      </div>

      {/* Correction modal */}
      {showModal && (
        <CorrectionModal
          question={question ?? "Market question"}
          brainAnswer={response.answer}
          sessionId={sessionId}
          onClose={() => setShowModal(false)}
          onSuccess={handleSuccess}
        />
      )}
    </>
  )
}
