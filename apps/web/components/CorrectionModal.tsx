"use client"

import { useState } from "react"
import { submitCorrection, type CorrectionMove } from "@/lib/chatApi"

type Props = {
  question: string
  brainAnswer: string
  sessionId?: string
  onClose: () => void
  onSuccess: (caseId: string) => void
}

export function CorrectionModal({ question, brainAnswer, sessionId, onClose, onSuccess }: Props) {
  const [notes, setNotes] = useState("")
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 10))
  const [moves, setMoves] = useState<CorrectionMove[]>([
    { ticker: "", direction: "up", magnitude_bp: 0 },
  ])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addRow = () =>
    setMoves(prev => [...prev, { ticker: "", direction: "up", magnitude_bp: 0 }])

  const removeRow = (i: number) =>
    setMoves(prev => prev.filter((_, idx) => idx !== i))

  const updateMove = (i: number, field: keyof CorrectionMove, value: string | number) =>
    setMoves(prev =>
      prev.map((m, idx) =>
        idx === i ? { ...m, [field]: value } : m
      )
    )

  const handleSubmit = async () => {
    setError(null)
    const validMoves = moves.filter(m => m.ticker.trim().length > 0 && m.magnitude_bp > 0)
    if (validMoves.length === 0) {
      setError("Add at least one ticker with a non-zero magnitude.")
      return
    }
    if (notes.trim().length < 10) {
      setError("Please describe what actually happened (at least 10 characters).")
      return
    }
    setLoading(true)
    try {
      const result = await submitCorrection({
        session_id:   sessionId,
        question,
        brain_answer: brainAnswer,
        actual_moves: validMoves.map(m => ({
          ...m,
          ticker:       m.ticker.toUpperCase().trim(),
          magnitude_bp: Number(m.magnitude_bp),
        })),
        occurred_at: occurredAt,
        notes:       notes.trim(),
      })
      onSuccess(result.case_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0">
          <div>
            <h2 className="text-zinc-100 font-semibold text-base">Correct the Brain</h2>
            <p className="text-zinc-500 text-xs mt-0.5">Tell it what actually happened — it will learn immediately</p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 text-xl leading-none transition-colors"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

          {/* Original question — read only */}
          <div>
            <p className="text-zinc-500 text-xs font-medium mb-1">ORIGINAL QUESTION</p>
            <p className="text-zinc-300 text-sm bg-zinc-800/50 border border-zinc-700 rounded-lg px-3 py-2 leading-relaxed">
              {question}
            </p>
          </div>

          {/* What actually happened */}
          <div>
            <label className="text-zinc-400 text-xs font-medium block mb-1">
              WHAT ACTUALLY HAPPENED <span className="text-red-400">*</span>
            </label>
            <textarea
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Describe the actual market outcome. What did the brain get wrong? E.g. 'NVDA fell 17% not 3% — the brain underestimated the magnitude of the AI moat destruction. The correct framework is...'"
              rows={4}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-emerald-600 resize-none transition-colors"
            />
          </div>

          {/* Event date */}
          <div>
            <label className="text-zinc-400 text-xs font-medium block mb-1">
              WHEN DID THIS OCCUR <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={occurredAt}
              onChange={e => setOccurredAt(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-emerald-600 transition-colors"
            />
          </div>

          {/* Actual ticker moves */}
          <div>
            <label className="text-zinc-400 text-xs font-medium block mb-2">
              ACTUAL REALIZED MOVES <span className="text-red-400">*</span>
            </label>
            <div className="space-y-2">
              {moves.map((m, i) => (
                <div key={i} className="flex gap-2 items-center">
                  <input
                    value={m.ticker}
                    onChange={e => updateMove(i, "ticker", e.target.value)}
                    placeholder="TICKER"
                    maxLength={10}
                    className="w-24 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-emerald-600 uppercase transition-colors"
                  />
                  <select
                    value={m.direction}
                    onChange={e => updateMove(i, "direction", e.target.value)}
                    className="bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm focus:outline-none focus:border-emerald-600 transition-colors"
                  >
                    <option value="up">↑ UP</option>
                    <option value="down">↓ DOWN</option>
                    <option value="flat">→ FLAT</option>
                  </select>
                  <div className="flex items-center gap-1 flex-1">
                    <input
                      type="number"
                      value={m.magnitude_bp || ""}
                      onChange={e => updateMove(i, "magnitude_bp", Number(e.target.value))}
                      placeholder="magnitude"
                      min={0}
                      max={10000}
                      className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-zinc-100 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-emerald-600 transition-colors"
                    />
                    <span className="text-zinc-500 text-xs whitespace-nowrap">bp ({((m.magnitude_bp ?? 0) / 100).toFixed(1)}%)</span>
                  </div>
                  {moves.length > 1 && (
                    <button
                      onClick={() => removeRow(i)}
                      className="text-zinc-600 hover:text-red-400 text-sm transition-colors shrink-0"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
            </div>
            {moves.length < 8 && (
              <button
                onClick={addRow}
                className="mt-2 text-zinc-500 hover:text-emerald-400 text-xs transition-colors"
              >
                + Add another ticker
              </button>
            )}
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-950/50 border border-red-900/50 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-zinc-800 shrink-0">
          <p className="text-zinc-600 text-xs">The brain learns from this immediately — no restart needed</p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-zinc-400 hover:text-zinc-200 text-sm transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="px-5 py-2 bg-red-700 hover:bg-red-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-sm font-medium rounded-xl transition-colors flex items-center gap-2"
            >
              {loading ? (
                <>
                  <span className="w-3 h-3 border border-white/30 border-t-white rounded-full animate-spin" />
                  Teaching brain...
                </>
              ) : (
                "✓ Submit Correction"
              )}
            </button>
          </div>
        </div>

      </div>
    </div>
  )
}
