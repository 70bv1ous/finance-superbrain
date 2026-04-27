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
    setMoves((prev) => [...prev, { ticker: "", direction: "up", magnitude_bp: 0 }])

  const removeRow = (index: number) =>
    setMoves((prev) => prev.filter((_, rowIndex) => rowIndex !== index))

  const updateMove = (index: number, field: keyof CorrectionMove, value: string | number) =>
    setMoves((prev) =>
      prev.map((move, rowIndex) => (rowIndex === index ? { ...move, [field]: value } : move)),
    )

  const handleSubmit = async () => {
    setError(null)

    const validMoves = moves.filter((move) => move.ticker.trim().length > 0 && move.magnitude_bp > 0)

    if (validMoves.length === 0) {
      setError("Add at least one ticker with a non-zero magnitude.")
      return
    }

    if (notes.trim().length < 10) {
      setError("Please describe what actually happened in at least 10 characters.")
      return
    }

    setLoading(true)

    try {
      const result = await submitCorrection({
        session_id: sessionId,
        question,
        brain_answer: brainAnswer,
        actual_moves: validMoves.map((move) => ({
          ...move,
          ticker: move.ticker.toUpperCase().trim(),
          magnitude_bp: Number(move.magnitude_bp),
        })),
        occurred_at: occurredAt,
        notes: notes.trim(),
      })

      onSuccess(result.case_id)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4 shrink-0">
          <div>
            <h2 className="text-base font-semibold text-zinc-100">Correct the brain</h2>
            <p className="mt-0.5 text-xs text-zinc-500">
              Tell it what actually happened and it will learn immediately.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none text-zinc-500 transition-colors hover:text-zinc-300"
          >
            x
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
          <div>
            <p className="mb-1 text-xs font-medium text-zinc-500">Original question</p>
            <p className="rounded-lg border border-zinc-700 bg-zinc-800/50 px-3 py-2 text-sm leading-relaxed text-zinc-300">
              {question}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              What actually happened <span className="text-red-400">*</span>
            </label>
            <textarea
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Describe the actual market outcome and where the model reasoning broke."
              rows={4}
              className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-emerald-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-400">
              When did this occur <span className="text-red-400">*</span>
            </label>
            <input
              type="date"
              value={occurredAt}
              onChange={(event) => setOccurredAt(event.target.value)}
              className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 transition-colors focus:border-emerald-600 focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-medium text-zinc-400">
              Actual realized moves <span className="text-red-400">*</span>
            </label>
            <div className="space-y-2">
              {moves.map((move, index) => (
                <div key={index} className="flex items-center gap-2">
                  <input
                    value={move.ticker}
                    onChange={(event) => updateMove(index, "ticker", event.target.value)}
                    placeholder="Ticker"
                    maxLength={10}
                    className="w-24 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm uppercase text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-emerald-600 focus:outline-none"
                  />
                  <select
                    value={move.direction}
                    onChange={(event) => updateMove(index, "direction", event.target.value)}
                    className="rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 transition-colors focus:border-emerald-600 focus:outline-none"
                  >
                    <option value="up">UP</option>
                    <option value="down">DOWN</option>
                    <option value="flat">FLAT</option>
                  </select>
                  <div className="flex flex-1 items-center gap-1">
                    <input
                      type="number"
                      value={move.magnitude_bp || ""}
                      onChange={(event) => updateMove(index, "magnitude_bp", Number(event.target.value))}
                      placeholder="magnitude"
                      min={0}
                      max={10000}
                      className="flex-1 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 transition-colors focus:border-emerald-600 focus:outline-none"
                    />
                    <span className="whitespace-nowrap text-xs text-zinc-500">
                      bp ({((move.magnitude_bp ?? 0) / 100).toFixed(1)}%)
                    </span>
                  </div>
                  {moves.length > 1 ? (
                    <button
                      onClick={() => removeRow(index)}
                      className="shrink-0 text-sm text-zinc-600 transition-colors hover:text-red-400"
                    >
                      x
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
            {moves.length < 8 ? (
              <button
                onClick={addRow}
                className="mt-2 text-xs text-zinc-500 transition-colors hover:text-emerald-400"
              >
                + Add another ticker
              </button>
            ) : null}
          </div>

          {error ? (
            <p className="rounded-lg border border-red-900/50 bg-red-950/50 px-3 py-2 text-sm text-red-400">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex items-center justify-between border-t border-zinc-800 px-6 py-4 shrink-0">
          <p className="text-xs text-zinc-600">The brain learns from this immediately and no restart is needed.</p>
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 text-sm text-zinc-400 transition-colors hover:text-zinc-200 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading}
              className="flex items-center gap-2 rounded-xl bg-red-700 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:bg-zinc-700 disabled:text-zinc-500"
            >
              {loading ? (
                <>
                  <span className="h-3 w-3 rounded-full border border-white/30 border-t-white animate-spin" />
                  Teaching brain...
                </>
              ) : (
                "Submit correction"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
