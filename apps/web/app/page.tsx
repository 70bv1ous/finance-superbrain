"use client"

import { useState, useRef, useEffect } from "react"
import Link from "next/link"
import { sendChatMessage, type ChatMessage, type ChatResponse } from "@/lib/chatApi"
import { BrainMessage } from "@/components/BrainMessage"
import { MarketTickerBar } from "@/components/MarketTickerBar"
import { EventsStrip } from "@/components/EventsStrip"

const SUGGESTED = [
  "CPI printed 0.4% vs 0.3% expected. What happens to equities and bonds?",
  "Fed holds rates but signals two cuts in 2025. Market reaction?",
  "NFP comes in at 280k vs 200k expected. Dollar and yields?",
]

export default function ChatPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState("")
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string | undefined>()
  const [error, setError] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages, loading])

  const submit = async (query: string) => {
    if (!query.trim() || loading) return
    setError(null)

    const userMsg: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: query.trim(),
      timestamp: new Date(),
    }
    setMessages(prev => [...prev, userMsg])
    setInput("")
    setLoading(true)

    try {
      const response: ChatResponse = await sendChatMessage(query.trim(), sessionId)
      if (!sessionId) setSessionId(response.session_id)

      const brainMsg: ChatMessage = {
        id: crypto.randomUUID(),
        role: "brain",
        content: response.answer,
        response,
        timestamp: new Date(),
      }
      setMessages(prev => [...prev, brainMsg])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4 flex items-center gap-3 shrink-0 z-10">
        <div className="w-8 h-8 rounded-full bg-emerald-500 flex items-center justify-center text-black text-sm font-bold">FS</div>
        <div>
          <h1 className="text-zinc-100 font-semibold text-sm">Finance Superbrain</h1>
          <p className="text-zinc-500 text-xs">Institutional-grade market intelligence · Beta</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Link href="/accuracy" className="text-zinc-500 hover:text-zinc-300 text-xs transition-colors">📊 Accuracy</Link>
          <span className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
          <span className="text-zinc-500 text-xs">Live</span>
        </div>
      </header>

      {/* Live market ticker */}
      <MarketTickerBar />

      {/* Upcoming macro events */}
      <EventsStrip />

      {/* Messages */}
      <main className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-8 text-center">
            <div>
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
                <span className="text-emerald-400 text-2xl font-bold">FS</span>
              </div>
              <h2 className="text-zinc-100 text-xl font-semibold mb-2">Finance Superbrain</h2>
              <p className="text-zinc-500 text-sm max-w-md">
                Ask me about macro events, market reactions, CPI prints, Fed decisions, or jobs data.
                I analyse like a senior institutional analyst.
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-lg">
              <p className="text-zinc-600 text-xs font-medium tracking-widest text-left">SUGGESTED QUESTIONS</p>
              {SUGGESTED.map((s, i) => (
                <button
                  key={i}
                  onClick={() => submit(s)}
                  className="text-left px-4 py-3 rounded-xl bg-zinc-900 border border-zinc-800 text-zinc-300 text-sm hover:border-zinc-600 hover:text-zinc-100 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "user" ? (
              <div className="max-w-xl bg-zinc-800 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 text-sm">
                {msg.content}
              </div>
            ) : msg.response ? (
              <BrainMessage response={msg.response} />
            ) : null}
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="flex items-center gap-3 bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3">
              <div className="w-7 h-7 rounded-full bg-emerald-500 flex items-center justify-center text-black text-xs font-bold shrink-0">FS</div>
              <div className="flex gap-1">
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="w-2 h-2 bg-zinc-500 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </div>
              <span className="text-zinc-500 text-sm">Analysing...</span>
            </div>
          </div>
        )}

        {error && (
          <div className="flex justify-center">
            <p className="text-red-400 text-sm bg-red-950 border border-red-900 rounded-xl px-4 py-2">{error}</p>
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      {/* Input */}
      <footer className="border-t border-zinc-800 px-6 py-4 shrink-0">
        <form
          onSubmit={e => { e.preventDefault(); submit(input) }}
          className="flex gap-3 max-w-4xl mx-auto"
        >
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Ask about CPI, Fed decisions, NFP, or any macro event..."
            disabled={loading}
            className="flex-1 bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-emerald-600 disabled:opacity-50 transition-colors"
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-5 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-800 disabled:text-zinc-600 text-white text-sm font-medium rounded-xl transition-colors"
          >
            {loading ? "..." : "Ask"}
          </button>
        </form>
        <p className="text-center text-zinc-700 text-xs mt-2">Beta · CPI · FOMC · NFP · Powered by Finance Superbrain Intelligence Layer</p>
      </footer>
    </div>
  )
}
