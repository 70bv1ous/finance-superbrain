import { GUIDED_DEMO_MANIFEST } from "@finance-superbrain/schemas"
import Link from "next/link"

import { getDemoContactHref } from "@/lib/demoConfig"

const capabilityCards = [
  {
    eyebrow: "Studio investigations",
    title: "Turn messy market inputs into structured events and live hypotheses.",
    detail:
      "Capture raw text, parse finance-native events, generate predictions, and keep the investigation durable across reloads and handoffs.",
    href: "/studio",
  },
  {
    eyebrow: "Shared decisions",
    title: "Promote research into explicit briefs with checkpoints and owners.",
    detail:
      "Decision briefs make ownership, cadence, status, and rationale visible so the team can operate from shared truth instead of browser-local notes.",
    href: "/decisions",
  },
  {
    eyebrow: "Portfolio follow-through",
    title: "Carry live theses through posture, review sessions, trims, and closure.",
    detail:
      "Portfolio candidates, checkpoints, and review sessions keep rebalance logic connected to the original research and decision history.",
    href: "/portfolio",
  },
  {
    eyebrow: "Review and retrieval",
    title: "Score outcomes, save postmortems, and reuse what the system has learned.",
    detail:
      "Shared review notes, retrieval-ready investigations, and lesson memory turn every call into future context instead of lost effort.",
    href: "/library",
  },
]

const loopSteps = [
  {
    label: "Ingest",
    detail: "News, transcripts, macro releases, filings, and operator notes enter a single event workflow.",
  },
  {
    label: "Structure",
    detail: "The platform normalizes inputs into tagged finance events with themes, entities, and urgency.",
  },
  {
    label: "Reason",
    detail: "Predictions, analogs, confidence, and invalidations are generated around explicit market impact paths.",
  },
  {
    label: "Decide",
    detail: "Research can be promoted into shared briefs and portfolio candidates with clear ownership and cadence.",
  },
  {
    label: "Review",
    detail: "The team scores outcomes, records notes, and captures checkpoints across decisions and portfolio follow-through.",
  },
  {
    label: "Learn",
    detail: "Closed loops become retrievable memory for the next investigation instead of disappearing into chat history.",
  },
]

const proofRows = [
  {
    title: "Shared workspace truth",
    detail: "Server-backed sessions, investigations, Studio continuity, and audit activity give the internal alpha a durable operating core.",
  },
  {
    title: "Decision discipline",
    detail: "Briefs, cadence, checkpoints, and closure move the platform from analysis to accountable decision-making.",
  },
  {
    title: "Portfolio operations",
    detail: "Candidates, posture, review sessions, rebalance proposals, and closure create an explicit follow-through layer on top of research.",
  },
]

const proofStandards = [
  {
    title: "Bottom line first",
    detail: "A strong answer starts with the clearest defensible read-through instead of hiding the view in a wall of prose.",
  },
  {
    title: "Asset map made explicit",
    detail: "The system should show which assets are affected, in what direction, and why that transmission path makes sense.",
  },
  {
    title: "Evidence before confidence",
    detail: "Claims should be supported by retrieval context, market structure, and known finance transmission logic.",
  },
  {
    title: "Limits and invalidations",
    detail: "When support is thin, the answer should narrow itself and state what could overpower the thesis.",
  },
]

const investorWalkthroughSteps = GUIDED_DEMO_MANIFEST.slice(0, 5)

const galleryCards = [
  {
    title: "Command center",
    subtitle: "A live operating overview for shared investigations, decisions, portfolio pressure, and platform health.",
    chips: ["Shared activity", "Decision queue", "Portfolio pressure"],
  },
  {
    title: "Studio",
    subtitle: "Raw event capture, parsing, prediction generation, and analog retrieval in one continuous workflow.",
    chips: ["Event extraction", "Prediction generation", "Analogs"],
  },
  {
    title: "Decision desk",
    subtitle: "Brief ownership, cadence, checkpoints, and closure all stay visible to the whole team.",
    chips: ["Ownership", "Cadence", "Checkpoints"],
  },
  {
    title: "Portfolio desk",
    subtitle: "Follow-through turns promoted theses into active, watching, trimmed, or closed portfolio work.",
    chips: ["Posture", "Review sessions", "Rebalance flow"],
  },
]

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-300/80">{children}</p>
}

export function PublicShell() {
  const demoContactHref = getDemoContactHref()

  return (
    <main className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,_rgba(52,211,153,0.18),_transparent_20%),radial-gradient(circle_at_80%_20%,_rgba(34,211,238,0.12),_transparent_24%),linear-gradient(180deg,_#050816_0%,_#0b1220_42%,_#111827_100%)] text-zinc-100">
      <div className="relative">
        <div className="absolute inset-x-0 top-0 h-[720px] bg-[linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(180deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:88px_88px] opacity-[0.16]" />
        <div className="absolute left-[-120px] top-24 h-80 w-80 rounded-full bg-emerald-400/10 blur-3xl" />
        <div className="absolute right-[-80px] top-28 h-72 w-72 rounded-full bg-cyan-400/10 blur-3xl" />

        <header className="relative z-10 mx-auto max-w-7xl px-6 pt-6">
          <div className="rounded-[28px] border border-white/10 bg-zinc-950/55 px-5 py-4 shadow-[0_28px_80px_rgba(0,0,0,0.28)] backdrop-blur">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-emerald-400/30 bg-emerald-400/15 text-sm font-semibold tracking-[0.28em] text-emerald-200">
                  FS
                </div>
                <div>
                  <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-300/80">Finance Superbrain</p>
                  <p className="mt-1 text-sm text-zinc-400">Intelligence platform for market research, decisions, and learning loops.</p>
                </div>
              </div>

              <nav className="flex flex-wrap items-center gap-2">
                <Link
                  href="#platform"
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                >
                  Explore platform
                </Link>
                <Link
                  href="#guided-proof"
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                >
                  Guided proof
                </Link>
                <Link
                  href="#trust"
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                >
                  Trust
                </Link>
                <Link
                  href="#contact"
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                >
                  Contact
                </Link>
                <Link
                  href="/workspace"
                  className="rounded-full border border-emerald-400/30 bg-emerald-400 px-3 py-1.5 text-xs font-semibold text-emerald-950 transition-colors hover:bg-emerald-300"
                >
                  Open workspace
                </Link>
              </nav>
            </div>
          </div>
        </header>

        <section className="relative z-10 mx-auto grid max-w-7xl gap-10 px-6 pb-20 pt-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)] lg:items-center">
          <div>
            <SectionLabel>Investor-facing product shell</SectionLabel>
            <h1 className="mt-5 max-w-4xl font-display text-5xl font-semibold leading-[1.02] text-white md:text-6xl">
              Market intelligence that keeps learning after every decision.
            </h1>
            <p className="mt-6 max-w-3xl text-lg leading-8 text-zinc-300">
              Finance Superbrain is not a generic chatbot and not just another dashboard. It is a shared
              intelligence platform that turns raw market inputs into structured investigations, explicit
              decisions, portfolio follow-through, and reusable operating memory.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="#platform"
                className="rounded-full bg-emerald-400 px-5 py-3 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-300"
              >
                Explore platform
              </Link>
              <Link
                href="/workspace"
                className="rounded-full border border-white/10 bg-white/5 px-5 py-3 text-sm font-medium text-zinc-100 transition-colors hover:border-white/20 hover:text-white"
              >
                Open workspace
              </Link>
            </div>

            <div className="mt-5 flex flex-wrap gap-3 text-sm text-zinc-400">
              <Link href="#guided-proof" className="underline decoration-emerald-400/45 underline-offset-4 transition-colors hover:text-white">
                See how a strong answer proves itself
              </Link>
              <Link href="/workspace#intelligence-proof" className="underline decoration-cyan-400/45 underline-offset-4 transition-colors hover:text-white">
                Launch the guided evidence desk
              </Link>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              <div className="rounded-[24px] border border-emerald-500/20 bg-emerald-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-emerald-200/80">Shared truth</p>
                <p className="mt-3 text-sm text-emerald-50">Server-backed sessions, investigations, and activity history anchor team continuity.</p>
              </div>
              <div className="rounded-[24px] border border-cyan-500/20 bg-cyan-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-cyan-200/80">Explicit decisions</p>
                <p className="mt-3 text-sm text-cyan-50">Research becomes briefs, checkpoints, posture, and review sessions instead of disappearing into notes.</p>
              </div>
              <div className="rounded-[24px] border border-amber-500/20 bg-amber-500/10 p-4">
                <p className="text-xs uppercase tracking-[0.24em] text-amber-200/80">Learning loops</p>
                <p className="mt-3 text-sm text-amber-50">Review notes, retrieval, and postmortems turn finished work into better future context.</p>
              </div>
            </div>
          </div>

          <div className="relative">
            <div className="absolute inset-0 rounded-[32px] bg-[linear-gradient(145deg,rgba(16,185,129,0.18),rgba(6,182,212,0.08),rgba(15,23,42,0.18))] blur-2xl" />
            <div className="relative overflow-hidden rounded-[32px] border border-white/10 bg-zinc-950/70 p-5 shadow-[0_30px_100px_rgba(0,0,0,0.35)] backdrop-blur">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-4">
                <div>
                  <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Platform loop</p>
                  <p className="mt-1 font-display text-xl font-semibold text-white">Research to operating memory</p>
                </div>
                <span className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-emerald-200">
                  Internal alpha
                </span>
              </div>

              <div className="mt-5 space-y-3">
                {loopSteps.map((step, index) => (
                  <div key={step.label} className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start gap-4">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-zinc-950/80 text-sm font-semibold text-zinc-200">
                        {index + 1}
                      </div>
                      <div>
                        <p className="text-sm font-semibold text-white">{step.label}</p>
                        <p className="mt-2 text-sm leading-6 text-zinc-400">{step.detail}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>

      <section id="platform" className="mx-auto max-w-7xl px-6 py-18">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start">
          <div>
            <SectionLabel>Product thesis</SectionLabel>
            <h2 className="mt-4 font-display text-4xl font-semibold text-white">From disconnected research to accountable operating intelligence.</h2>
            <p className="mt-5 text-base leading-8 text-zinc-300">
              Generic finance chatbots answer questions and forget the consequences. Traditional dashboards show states
              but do not preserve why a team believed something, who owned it, or what was learned after the fact.
              Finance Superbrain connects those missing layers into one operating system.
            </p>
            <div className="mt-6 space-y-3">
              {proofRows.map((row) => (
                <div key={row.title} className="rounded-[24px] border border-white/10 bg-zinc-950/60 p-4">
                  <p className="text-sm font-semibold text-white">{row.title}</p>
                  <p className="mt-2 text-sm leading-6 text-zinc-400">{row.detail}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {capabilityCards.map((card) => (
              <div key={card.title} className="rounded-[28px] border border-white/10 bg-zinc-950/65 p-5 shadow-[0_18px_60px_rgba(0,0,0,0.22)]">
                <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">{card.eyebrow}</p>
                <h3 className="mt-3 font-display text-2xl font-semibold text-white">{card.title}</h3>
                <p className="mt-4 text-sm leading-7 text-zinc-400">{card.detail}</p>
                <div className="mt-5">
                  <Link
                    href={card.href}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                  >
                    Open surface
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="guided-proof" className="mx-auto max-w-7xl px-6 py-18">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start">
          <div>
            <SectionLabel>Guided proof flow</SectionLabel>
            <h2 className="mt-4 font-display text-4xl font-semibold text-white">What a strong answer should show in the workspace.</h2>
            <p className="mt-5 text-base leading-8 text-zinc-300">
              The chat surface is being shaped as an evidence desk, not as a generic assistant box. During a guided
              walkthrough, the product should make groundedness visible: a bottom line, cross-asset impact, evidence,
              explicit uncertainty, and clear risk factors when the thesis could break.
            </p>
            <div className="mt-6 rounded-[28px] border border-emerald-400/20 bg-emerald-400/10 p-5">
              <p className="text-[11px] uppercase tracking-[0.32em] text-emerald-200/80">How the system reasons</p>
              <p className="mt-3 text-sm leading-7 text-emerald-50">
                Guided prompts are curated around macro, policy, earnings, and portfolio follow-through so an operator
                can demonstrate repeatable intelligence behavior instead of relying on improvisation.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href="/workspace#intelligence-proof"
                  className="rounded-full bg-emerald-400 px-4 py-2 text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-300"
                >
                  Open guided workspace proof
                </Link>
                <Link
                  href="/workspace"
                  className="rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-medium text-zinc-100 transition-colors hover:border-white/20 hover:text-white"
                >
                  Open workspace home
                </Link>
              </div>
            </div>

            <div className="mt-6 rounded-[28px] border border-white/10 bg-zinc-950/65 p-5">
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Canonical walkthrough order</p>
              <div className="mt-4 space-y-3">
                {investorWalkthroughSteps.map((step, index) => (
                  <div key={step.id} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-semibold text-white">
                          {index + 1}. {step.title}
                        </p>
                        <p className="mt-2 text-sm leading-7 text-zinc-400">{step.proof_purpose}</p>
                      </div>
                      <span className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.24em] text-zinc-500">
                        {step.kind}
                      </span>
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link
                        href={step.route.href}
                        className="rounded-full border border-emerald-400/25 bg-emerald-400/10 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-emerald-100 transition-colors hover:border-emerald-300/40 hover:text-emerald-50"
                      >
                        {step.route.label}
                      </Link>
                      {step.handoff ? (
                        <Link
                          href={step.handoff.href}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] uppercase tracking-[0.24em] text-zinc-300 transition-colors hover:border-white/20 hover:text-white"
                        >
                          {step.handoff.label}
                        </Link>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {proofStandards.map((item) => (
              <div key={item.title} className="rounded-[28px] border border-white/10 bg-zinc-950/65 p-5">
                <p className="text-sm font-semibold text-white">{item.title}</p>
                <p className="mt-3 text-sm leading-7 text-zinc-400">{item.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-6 py-18">
        <div className="rounded-[36px] border border-white/10 bg-[linear-gradient(160deg,rgba(9,14,29,0.9),rgba(17,24,39,0.9),rgba(5,16,31,0.92))] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.3)]">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <SectionLabel>Product gallery</SectionLabel>
              <h2 className="mt-4 font-display text-4xl font-semibold text-white">A curated view of the operating surface.</h2>
            </div>
            <p className="max-w-2xl text-sm leading-7 text-zinc-400">
              These are the real workflow layers already present inside the internal alpha: command center,
              investigations, decision continuity, portfolio follow-through, and retrieval-backed review.
            </p>
          </div>

          <div className="mt-8 grid gap-4 xl:grid-cols-2">
            {galleryCards.map((card, index) => (
              <div key={card.title} className="overflow-hidden rounded-[30px] border border-white/10 bg-zinc-950/75">
                <div className="border-b border-white/10 px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Surface {index + 1}</p>
                      <h3 className="mt-2 font-display text-2xl font-semibold text-white">{card.title}</h3>
                    </div>
                    <div className="flex gap-1.5">
                      <span className="h-2.5 w-2.5 rounded-full bg-rose-300/70" />
                      <span className="h-2.5 w-2.5 rounded-full bg-amber-300/70" />
                      <span className="h-2.5 w-2.5 rounded-full bg-emerald-300/70" />
                    </div>
                  </div>
                  <p className="mt-3 text-sm leading-7 text-zinc-400">{card.subtitle}</p>
                </div>

                <div className="grid gap-3 px-5 py-5 sm:grid-cols-3">
                  {card.chips.map((chip) => (
                    <div key={chip} className="rounded-2xl border border-white/10 bg-white/5 px-3 py-4 text-center text-sm text-zinc-300">
                      {chip}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="trust" className="mx-auto max-w-7xl px-6 py-18">
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <div>
            <SectionLabel>Trust and credibility</SectionLabel>
            <h2 className="mt-4 font-display text-4xl font-semibold text-white">Built honestly as an internal alpha with real workflow foundations.</h2>
            <p className="mt-5 text-base leading-8 text-zinc-300">
              The platform already has shared auth, durable investigations, decision checkpoints, portfolio review
              sessions, review-note persistence, retrieval-backed memory, and audit activity. What this public shell
              does is make that internal truth legible. It does not pretend the system is a finished production
              network, and it does not rely on inflated claims.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-[28px] border border-white/10 bg-zinc-950/65 p-5">
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">What exists now</p>
              <ul className="mt-4 space-y-3 text-sm leading-7 text-zinc-300">
                <li>Shared workspace identity and durable session-backed continuity</li>
                <li>Studio event capture, prediction generation, and investigation persistence</li>
                <li>Decision briefs, checkpoints, audit trails, and retrieval-ready review loops</li>
              </ul>
            </div>
            <div className="rounded-[28px] border border-white/10 bg-zinc-950/65 p-5">
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Why it matters</p>
              <ul className="mt-4 space-y-3 text-sm leading-7 text-zinc-300">
                <li>Research is converted into explicit operating objects instead of disposable chat output</li>
                <li>Portfolio follow-through stays tied to the original thesis and review history</li>
                <li>Lessons and closures remain reusable as future intelligence context</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section id="contact" className="mx-auto max-w-7xl px-6 pb-24 pt-10">
        <div className="rounded-[36px] border border-emerald-400/20 bg-[linear-gradient(140deg,rgba(16,185,129,0.16),rgba(6,182,212,0.08),rgba(10,14,24,0.92))] p-8 shadow-[0_30px_100px_rgba(0,0,0,0.35)]">
          <SectionLabel>Final CTA</SectionLabel>
          <div className="mt-4 grid gap-8 lg:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)] lg:items-center">
            <div>
              <h2 className="font-display text-4xl font-semibold text-white">Explore the platform, or request a closer walkthrough.</h2>
              <p className="mt-5 max-w-3xl text-base leading-8 text-zinc-300">
                Finance Superbrain is being shaped as an intelligence platform for shared market research, decision
                discipline, and operating memory. The current alpha is best understood through the workspace itself and
                through a focused product walkthrough.
              </p>
            </div>

            <div className="rounded-[28px] border border-white/10 bg-zinc-950/65 p-5">
              <p className="text-[11px] uppercase tracking-[0.32em] text-zinc-500">Next steps</p>
              <div className="mt-4 space-y-3">
                <Link
                  href="/workspace"
                  className="block rounded-2xl bg-emerald-400 px-4 py-3 text-center text-sm font-semibold text-emerald-950 transition-colors hover:bg-emerald-300"
                >
                  Open workspace
                </Link>
                <Link
                  href="/login"
                  className="block rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm font-medium text-zinc-100 transition-colors hover:border-white/20 hover:text-white"
                >
                  Workspace access
                </Link>
                {demoContactHref ? (
                  <Link
                    href={demoContactHref}
                    className="block rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm font-medium text-zinc-100 transition-colors hover:border-white/20 hover:text-white"
                  >
                    Partner / investor walkthrough
                  </Link>
                ) : (
                  <Link
                    href="/workspace#intelligence-proof"
                    className="block rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm font-medium text-zinc-100 transition-colors hover:border-white/20 hover:text-white"
                  >
                    Open guided proof path
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
