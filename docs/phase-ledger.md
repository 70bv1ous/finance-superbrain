# Phase Ledger

This is the canonical project phase ledger for Finance Superbrain. It is intentionally concise: each phase should state what shipped, how it is validated, current status, and the main remaining risk.

## Phase 1: Intelligence Core

- Goal: turn finance events into predictions, score outcomes, and store lessons.
- Evidence: `PHASE1_INTELLIGENCE_CORE_SPEC.md`, `apps/api/sql/001_phase1_intelligence_core.sql`, event/prediction/outcome/postmortem/lesson API tests.
- Validation: `npm --workspace @finance-superbrain/api run test:unit`, app-route learning-loop tests.
- Status: implemented.
- Risk: model quality still depends on corpus depth, calibration, and source quality.

## Phase 2: Research Copilot

- Goal: make event and market-memory analysis useful for day-to-day research.
- Evidence: chat service, analogue search, lesson search, library explorer, dashboard and Studio surfaces.
- Validation: API unit tests, `apps/web` tests, Studio and Library smoke coverage.
- Status: implemented as local product workflow.
- Risk: retrieval quality needs ongoing benchmark and analyst-quality evaluation.

## Phase 3: Live Operations

- Goal: support live monitoring, transcript/feed intake, operation jobs, and dashboards.
- Evidence: feed/transcript ingestion, live transcript sessions, operation worker loop, `/ops`, operational metrics.
- Validation: operation execution tests, transcript stream tests, API app-route operations slices.
- Status: implemented.
- Risk: production runtime health depends on hosted database, worker supervision, and dependency governance.

## Phase 4: Commercial Product Foundation

- Goal: package the platform into a durable app architecture with API/web split, auth, and workspace surfaces.
- Evidence: Fastify API, Next.js web app, workspace auth, Docker runtime, CI/deploy handoff.
- Validation: `npm run build`, `npm run verify`, auth/workspace tests.
- Status: implemented as product foundation.
- Risk: money-adjacent workflows require stricter review, permissions, audit trails, and legal/compliance review before broad use.

## Phase 5: Evaluation And Benchmark Memory

- Goal: make model and analyst quality measurable through replay, calibration, historical libraries, and promotion gates.
- Evidence: historical library ingestion, benchmark replay, walk-forward replay, calibration snapshots, promotion analytics.
- Validation: API benchmark/evolution tests and replay scripts.
- Status: implemented.
- Risk: benchmark pack coverage and dated historical depth must keep expanding.

## Phase 6: Team Workspace

- Goal: prove shared workspace collaboration is healthy enough for continued buildout.
- Evidence: workspace members, shared investigations, recent activity, workspace state.
- Validation: README Phase 6 acceptance path, smoke e2e, workspace app-route tests.
- Status: implemented.
- Risk: team workflow needs permission depth before real external deployment.

## Phase 7: Decision Workflow

- Goal: move research into decision briefs with ownership, cadence, checkpoints, and closure.
- Evidence: decision routes, decision desk, decision detail pages, decision checkpoints.
- Validation: README Phase 7 acceptance path, decision flow e2e, workspace decision tests.
- Status: implemented.
- Risk: decision review must stay explicit before memory influences portfolio action.

## Phase 8: Portfolio Candidate Flow

- Goal: promote decision briefs into portfolio candidates with posture, assignment, and follow-through state.
- Evidence: portfolio routes, portfolio desk, portfolio candidate detail pages, posture updates.
- Validation: portfolio candidate e2e and app-route tests.
- Status: implemented.
- Risk: any future transaction workflow must be separated from research memory and require stronger controls.

## Phase 9: Portfolio Review Sessions

- Goal: create recurring portfolio reviews, session items, rebalance proposals, and finalization evidence.
- Evidence: portfolio review routes and pages, rebalance proposal state, exported portfolio review context.
- Validation: portfolio review e2e and API tests.
- Status: implemented.
- Risk: review recommendations must remain human-reviewed until execution controls exist.

## Phase 10: Operational Hardening

- Goal: make backend operations observable, durable, and recoverable.
- Evidence: operation queue, worker-service supervision, incidents, integration probes, governance snapshots, `/health`, `/ready`, `/ops`.
- Validation: operational report tests, worker supervision tests, `npm run ops:drain-operation-jobs`.
- Status: implemented locally.
- Risk: hosted `/health` still needs production connectivity and timeout hardening.

## Phase 11: Guided Intelligence Proof

- Goal: provide a guided proof path for investors, pilots, and internal demos.
- Evidence: guided demo schema, public shell, workspace proof flow, seeded prompts.
- Validation: smoke e2e and hosted-like demo proof.
- Status: implemented.
- Risk: demo mode must stay clearly separated from production data and auth posture.

## Phase 12: Obsidian Memory Bridge

- Goal: export Finance Superbrain memory into Obsidian and selectively import human-authored memory back as retrieval lessons.
- Evidence: Obsidian export/import scripts, safety constraints, generated vault folders, Human Inbox import.
- Validation: `obsidianExport.test.ts`, `obsidianImport.test.ts`, demo proof export.
- Status: implemented and extended with Connections and Project notes.
- Risk: broad import, bidirectional sync, and watchers remain intentionally out of scope until review controls are stronger.

## Phase 13: Demo-Ready Pilot Gate

- Goal: prove local end-to-end readiness for walkthroughs.
- Evidence: `npm run demo:phase13:acceptance`, deterministic seed, hosted-like startup, smoke e2e, Obsidian export.
- Validation: README Phase 13 acceptance path.
- Status: locally healthy based on prior validation.
- Risk: local demo confidence must not be mistaken for hosted production health.

## Phase 14: Public Pilot Deployment

- Goal: deploy public web on Vercel and hosted API on Railway for a public pilot preview.
- Evidence: Vercel web URL, Railway API handoff docs, `demo:public-pilot:smoke`.
- Validation: `npm run demo:public-pilot:smoke`.
- Status: hosted public pilot smoke passed after splitting lightweight `/health` liveness from detailed operational health.
- Risk: hosted readiness still depends on Railway runtime, Postgres connectivity, migrations, and deterministic seed state staying aligned.

## Current Priority

- Prioritize Obsidian memory, progress visibility, connection review, and backend/frontend hardening.
- Defer Phase 14 production health until the local memory and project ledger workflow is reliable.
- Keep PostgreSQL as source of truth and Obsidian as readable local memory.
