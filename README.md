# Finance Superbrain

This repository is now a full monorepo for the AI financial self-learning platform, not a static single-page site.

Primary workspaces:

- `apps/api`: Fastify API, operations runtime, worker-service supervision, historical loaders, and passive monitoring surfaces
- `apps/web`: authenticated team workspace and decision operating desk built on the shared backend read models
- `packages/schemas`: shared runtime and product schemas

## Fast start

1. Install dependencies with `npm install`
2. Validate the repository with `npm run verify`
3. Start the full local workspace with `npm run dev`
4. If you only want one surface, you can still use `npm run dev:api` or `npm run dev:web`
5. Open:
   - `http://localhost:3001/health`
   - `http://localhost:3001/ready`
   - `http://localhost:3001/ops`
   - `http://localhost:3000/`

## VS Code + Codex workflow

This repository is prepared for a local Codex-in-VS-Code workflow using GPT-5.5.

One-time setup:

1. Install the recommended VS Code extension when prompted: `OpenAI.chatgpt`
2. Confirm the Codex CLI works with `codex --version`
3. Open this repository in VS Code

Recommended usage:

- Use `Terminal > Run Task > Codex: GPT-5.5 workspace agent` for normal implementation work.
- Use `Terminal > Run Task > Codex: GPT-5.5 review/read-only` for audits and planning where the agent should not edit files.
- Use `Terminal > Run Task > Claude Code: reviewer/planner` when you want a separate Claude review/planning perspective.
- Use `Terminal > Run Task > Claude Code: review current diff` when you want Claude to inspect the current repo changes without implementing.
- Use `Terminal > Run Task > Finance Superbrain: dev API` and `Finance Superbrain: dev web` to launch the local product.
- Use `Terminal > Run Task > Finance Superbrain: verify` before committing meaningful changes.

Keep one coding agent actively editing the repo at a time. Codex GPT-5.5 should be the default builder; Claude Code should be treated as a reviewer unless you intentionally hand implementation over to it.

## Production-style Docker runtime

The repository is prepared to run the production API and supervised worker-service under Docker using the built `dist` entrypoints:

- `db`: Postgres
- `migrate`: one-shot schema migration
- `api`: `node apps/api/dist/index.js`
- `worker-service`: `node apps/api/dist/scripts/runOperationWorkerService.js`

Build and start the stack with:

```bash
docker compose up --build
```

The worker container uses the repository-backed supervisor check for health:

- `node apps/api/dist/scripts/checkOperationWorkerService.js --mode=liveness --service-id=worker-service-main`

Use `docker compose down` to stop the stack. Add `-v` only if you intentionally want to remove the Postgres volume too.

## Validation commands

- `npm run lint`
- `npm run build`
- `npm test`
- `npm run ops:drain-operation-jobs`
- `npm run verify`
- `npm run test:e2e:smoke`
- `npm run test:e2e`

### Test tiers

The API integration surface is intentionally split into smaller deterministic chunks so everyday validation does not depend on one very large `app.test.ts` process.

- `npm --workspace @finance-superbrain/api run test:unit`: API intelligence, library, and script-level tests
- `npm --workspace @finance-superbrain/api run test:app`: all API app-route integration tests, split by route/workflow group
- `npm --workspace @finance-superbrain/api run test:app:workspace`: fastest workspace/auth/decision/portfolio app-route confidence
- `npm --workspace @finance-superbrain/api run test:app:full`: legacy single-file app integration sweep for deep manual debugging

Use `npm test` for the normal repository gate. Use `npm run test:e2e:smoke` after UI or routing changes, and reserve `test:app:full` for targeted investigation because the legacy app monolith is intentionally slower.

## Curated investor demo runbook

This is the canonical local demo path for the current public shell, guided workspace proof, and Obsidian second-brain export.

Recommended local environment for repeatable proof:

- `REPOSITORY_BACKEND=pglite`
- `PGLITE_DATA_DIR` pointed at a local non-synced path
- `MARKET_DATA_BACKEND=mock`
- `CHAT_MODEL_BACKEND=mock`
- `AUTH_COOKIE_SECURE=false`

Windows note:

- prefer a non-OneDrive path for `PGLITE_DATA_DIR`
- a safe example is `%LOCALAPPDATA%\\finance-superbrain\\demo-proof`

Important for local PGlite:

- seed before starting the API
- PGlite is easiest when the seed script and API do not hit the same data directory at the same time

Trusted local sequence:

1. Install dependencies with `npm install`
2. Seed the deterministic demo workspace with `npm run demo:proof:seed:local`
3. Start the full local workspace with `npm run dev`
4. If you only want one surface, you can still use `npm run dev:api` or `npm run dev:web`
5. Open [http://localhost:3000](http://localhost:3000)
6. Sign in with:
   - `lead.operator@finance-superbrain.local` / `workspace-admin-password`
   - or `macro.analyst@finance-superbrain.local` / `workspace-analyst-password`
7. Walk the guided proof in this order:
   - public shell `/`
   - workspace home `/workspace`
   - guided evidence desk `/workspace#intelligence-proof`
   - seeded decision brief `/decisions/demo-decision-cpi-discipline`
   - seeded portfolio candidate `/portfolio/demo-portfolio-cpi-discipline`
   - library memory `/library?focus=demo-investigation-cpi-discipline`
   - settings audit `/settings`

Guided prompt order:

1. `Hot CPI cross-asset reaction`
2. `Tariff escalation into China risk`
3. `Trim versus move to watching`

Pre-demo confidence checks:

- `npm run test:e2e:smoke`
- `npm run demo:proof:hosted-like`
- `npm run demo:proof:acceptance` when you want the smoke browser pass plus hosted-like validation in one command
- `npm run demo:phase13:acceptance` when you want the full Phase 13 demo-ready gate: unit/app tests, smoke browser proof, hosted-like startup, seeded data, and Obsidian export

Hosted-preview notes:

- enable `NEXT_PUBLIC_DEMO_MODE=true` when you want the login page to expose deterministic demo quick-fill accounts
- optionally set `NEXT_PUBLIC_DEMO_CONTACT_URL` if the public shell should send investors or partners to a real demo-request destination
- keep the preview data deterministic by seeding the workspace with the same `lead.operator` and `macro.analyst` accounts used by `seed:demo-proof`
- when the web app and API are on different domains, set `AUTH_COOKIE_SAME_SITE=none`, `AUTH_COOKIE_SECURE=true`, and `AUTH_ALLOWED_ORIGINS` to a comma-separated list of allowed web origins such as your Vercel preview and production URLs

Operator pre-demo checklist:

1. Run `npm run demo:proof:seed:local`
2. Start the API and web app
3. Confirm login works with the seeded lead-operator account
4. Walk the guided proof path from `/` -> `/workspace` -> `/workspace#intelligence-proof`
5. Open the seeded decision brief, portfolio candidate, Library, and Settings audit views
6. Run `npm run demo:proof:acceptance` before an important walkthrough

### Phase 13 demo-ready pilot gate

Phase 13 is the stabilization gate for investor and pilot walkthroughs. Use it when the question is: "Are we ready to show this end to end?"

Run:

```bash
npm run demo:phase13:acceptance
```

This validates:

- API and web test suites
- public shell and protected workspace smoke flow
- deterministic demo seed behavior
- hosted-like API and web startup
- login against seeded demo accounts
- generated Obsidian second-brain export

Manual walkthrough after the command passes:

1. Open `/` and confirm the public narrative is clear.
2. Open `/workspace` and confirm protected-route login is clean.
3. Run the guided evidence-desk prompt flow.
4. Open the seeded decision brief and portfolio candidate.
5. Open Library, Evaluation, and Settings to confirm continuity and audit proof.
6. Export to a real Obsidian vault when you want to show the visible second brain.

## Phase 14 public pilot deployment

The public web shell is intended to run on Vercel, while the API runs as a hosted backend service. Use this checklist when turning the local demo-ready baseline into a public pilot preview.

Current public web URL:

- `https://finance-superbrain-web.vercel.app`

Current hosted API URL:

- `https://sincere-smile-production-9c3f.up.railway.app`

Restore or create the hosted API first:

1. Deploy the API runtime with the existing Docker/build entrypoint.
2. Run database migrations against hosted Postgres with `npm run db:migrate`.
3. Seed deterministic demo proof data with `npm run seed:demo-proof`.
4. Confirm the API returns healthy responses for `/health`, `/ready`, and `/v1/auth/bootstrap`.

Deployment handoff:

- Railway is currently connected to the repository through its GitHub integration.
- GitHub Actions validates the monorepo; Railway performs the API deploy.
- If an emergency manual deploy is needed from an authenticated workstation, run `railway up --service sincere-smile --detach --message "public pilot manual deploy"`.

Required hosted API environment:

- `REPOSITORY_BACKEND=postgres`
- `DATABASE_URL=<hosted postgres url>`
- `MARKET_DATA_BACKEND=mock`
- `CHAT_MODEL_BACKEND=mock`
- `AUTH_COOKIE_SAME_SITE=none`
- `AUTH_COOKIE_SECURE=true`
- `AUTH_ALLOWED_ORIGINS=https://finance-superbrain-web.vercel.app`
- `HOST=0.0.0.0`
- `PORT=3001`

Update Vercel after the API URL is known:

1. Set `NEXT_PUBLIC_API_URL` in the Vercel project environment to the hosted API base URL.
2. Redeploy production with `vercel deploy --prod --archive=tgz`.
3. Keep `NEXT_PUBLIC_DEMO_MODE=true` only for guided demo/pilot previews where exposing quick-fill accounts is intentional.

Validate the hosted pilot:

```bash
PUBLIC_PILOT_API_URL=https://sincere-smile-production-9c3f.up.railway.app npm run demo:public-pilot:smoke
```

The smoke check verifies:

- public shell returns `200`
- login page returns `200`
- API health and readiness are healthy
- workspace bootstrap responds
- seeded demo login succeeds
- hosted auth cookie includes `SameSite=None` and `Secure`
- authenticated workspace state contains seeded investigation, decision, and portfolio data

Known boundary:

- Obsidian remains local-first. The hosted website does not write to an Obsidian vault; use the local `npm run ops:obsidian-export` flow when showing the visible second brain.

## Real Obsidian demo flow

Use a real vault when you want to show the second-brain proof, not only the dry-run summary.

Required environment variables:

- `OBSIDIAN_VAULT_PATH`: absolute path to an existing Obsidian vault
- `OBSIDIAN_EXPORT_ROOT`: optional, defaults to `Finance Superbrain`
- `FINANCE_SUPERBRAIN_APP_URL`: recommended for route links, for example `http://localhost:3000`

Real-vault acceptance sequence:

1. Run `npm run demo:proof:seed:local`
2. Start the API and web app
3. Walk the guided demo or inspect the seeded decision and portfolio objects
4. Run `npm run ops:obsidian-export`
5. Open the generated `Finance Superbrain` subtree inside the vault
6. Confirm:
   - investigation notes exist
   - decision brief notes exist
   - portfolio candidate notes exist
   - lesson notes exist
   - index notes exist
   - wikilinks resolve inside the vault
   - app links open the expected workspace routes
7. Rerun `npm run ops:obsidian-export` and confirm the managed files update deterministically

This bridge remains one-way export only. Finance Superbrain stays the source of truth, while Obsidian acts as the human-readable memory layer.

## Obsidian memory bridge

Phase 12 adds a local-first, one-way Obsidian export so Finance Superbrain can publish a generated knowledge graph into a real vault without making Obsidian the source of truth.

See [docs/obsidian-memory-roadmap.md](docs/obsidian-memory-roadmap.md) for the current connector build order, safety rules, and connection-finder plan.
See [docs/phase-ledger.md](docs/phase-ledger.md) for the canonical phase ledger that is mirrored into the Obsidian `Project/Phase Ledger.md` export.

Required environment variables:

- `OBSIDIAN_VAULT_PATH`: absolute path to an existing Obsidian vault directory
- `OBSIDIAN_EXPORT_ROOT`: optional generated subtree name, defaults to `Finance Superbrain`
- `FINANCE_SUPERBRAIN_APP_URL`: optional app base URL used for links back into the workspace, for example `http://localhost:3000`

Recommended local wrapper:

```bash
npm run ops:obsidian-local:export
npm run ops:obsidian-local:export -- --dry-run
npm run ops:obsidian-local:import
npm run ops:obsidian-local:import -- --apply
npm run ops:obsidian-local:sync
```

The local wrapper detects the default vault, sets `FINANCE_SUPERBRAIN_APP_URL=http://localhost:3000`, uses a durable PGlite repository at the OS temp path, and runs migrations before import/export. Override any default by setting `OBSIDIAN_VAULT_PATH`, `FINANCE_SUPERBRAIN_APP_URL`, `REPOSITORY_BACKEND`, or `PGLITE_DATA_DIR` before running it.

Run the exporter with:

```bash
npm run ops:obsidian-export
```

Dry-run without writing files:

```bash
npm run ops:obsidian-export -- --dry-run
```

The exporter creates or refreshes only the generated subtree:

- `Finance Superbrain/Investigations/`
- `Finance Superbrain/Decisions/`
- `Finance Superbrain/Portfolio/`
- `Finance Superbrain/Lessons/`
- `Finance Superbrain/Activity/`
- `Finance Superbrain/Connections/`
- `Finance Superbrain/Project/`
- `Finance Superbrain/Indexes/`

Important rules:

- this is one-way export only
- Finance Superbrain remains the canonical source of truth
- generated notes are marked with `managed_by: finance_superbrain`
- only files inside `OBSIDIAN_VAULT_PATH/<OBSIDIAN_EXPORT_ROOT>` are touched
- user-authored notes outside that subtree are never modified
- `Project/` notes expose the phase ledger, build log, risk register, validation history, and data inventory so progress is visible in the vault
- `Project/Work Session.md` mirrors the latest automatic git/work-session snapshot when sync state exists

Current non-goals:

- no broad vault import
- no bidirectional sync

Automatic project sync:

```bash
npm run ops:obsidian-sync
npm run ops:obsidian-watch
```

The sync command records the current git snapshot into `.finance-superbrain/obsidian-sync-state.json` and refreshes `Project/Work Session.md`. The watch mode keeps that note current while you work.

Obsidian plugin workflow:

```bash
npm run obsidian:plugin:build
npm run obsidian:plugin:install
```

The plugin source lives in `apps/obsidian-plugin/` and writes a generated status note at `Finance Superbrain/Project/Obsidian Plugin Sync.md`. It triggers the same local sync surface and refreshes the human-inbox review snapshot inside Obsidian.

## Selective Obsidian memory import

The first import path is intentionally conservative. It reads only a dedicated human inbox inside your vault, dry-runs by default, and only imports notes that are explicitly marked for Finance Superbrain.

Default inbox:

- `OBSIDIAN_VAULT_PATH/<OBSIDIAN_IMPORT_INBOX>`
- default `OBSIDIAN_IMPORT_INBOX`: `Finance Superbrain/Human Inbox`

Eligible notes must include frontmatter like:

```markdown
---
fs_import: true
title: Rates breadth reminder
lesson_type: reinforcement
themes: [rates, breadth]
assets: [TLT, DXY]
tags: [human-memory, demo]
---

# Rates breadth reminder

When yields reprice higher after inflation, do not upgrade cyclicals until breadth confirms that tighter conditions are not spreading.
```

Dry-run first:

```bash
npm run ops:obsidian-import
```

Apply only after reviewing the dry-run output:

```bash
npm run ops:obsidian-import -- --apply
```

Safety rules:

- only notes under `OBSIDIAN_IMPORT_INBOX` are scanned
- generated Finance Superbrain export notes are skipped
- notes without `fs_import: true` are skipped
- duplicate imports are prevented with a content hash
- apply mode creates retrieval memory only
- apply mode does not create investigations, decisions, portfolio candidates, assignments, or status changes

How imported memory is represented:

- each imported note becomes a clearly labeled `obsidian_human_import` retrieval lesson
- when no linked prediction is provided, the importer creates a synthetic `user_note` source, neutral event, reviewed prediction, and lesson wrapper so existing retrieval/search paths can use the memory
- provenance is stored on the lesson metadata, including the Obsidian path and content hash

Likely next expansion path after this phase:

- review UI for import candidates before apply is now implemented in the Library
- richer links back to decision briefs, portfolio candidates, and investigations are now exported and surfaced in notes
- optionally enrich chat retrieval from imported human notes more visibly
- only later consider watchers, plugins, or bidirectional sync

## Phase 6 team-alpha acceptance

Use this sequence when you want to prove the shared workspace is healthy enough to keep building on.

1. Run `npm run build`
2. Run `npm test`
3. Run `npm run ops:drain-operation-jobs`
4. Run `npm run test:e2e:smoke` for fast browser confidence
5. Run `npm run demo:proof:hosted-like` for build-startup-seed-export proof against a temporary hosted-like environment
6. Run `npm run test:e2e` when you want the fuller local/manual browser pass
7. Run `docker compose up --build -d` and verify:
   - `http://localhost:3001/health`
   - `http://localhost:3001/ready`
   - `node apps/api/dist/scripts/checkOperationWorkerService.js --mode=liveness --service-id=worker-service-main`

The PR CI workflow runs the smoke browser pass. The nightly/manual runtime-acceptance workflow is reserved for the slower Docker-runtime proof.

## Phase 7 decision-workflow acceptance

Use this sequence when you want to prove the intelligence-to-decision loop is healthy enough to keep building on.

1. Run `npm run verify`
2. Run `npm run test:e2e:smoke`
3. In the product, validate the shared decision loop:
   - log in as an internal workspace user
   - create a Studio investigation
   - generate predictions
   - promote the lead prediction into a decision brief
   - assign the brief
   - set a review cadence
   - save a checkpoint
   - move the brief through active, watching, and closed states
4. Confirm the resulting decision state appears consistently on:
   - `/`
   - `/decisions`
   - `/decisions/[decisionBriefId]`
   - `/investigations`
   - `/library`
   - `/evaluation`
   - `/settings`

Phase 7 is considered healthy when the team can move smoothly from research into a shared brief, maintain the brief with cadence and checkpoints, and then use closed outcomes as retrieval and evaluation evidence.

## Intelligence core scaffold

The project now also contains the first backend scaffold for the finance intelligence engine:

- `apps/api`: Fastify API service
- `packages/schemas`: shared request and response schemas
- `apps/api/sql/001_phase1_intelligence_core.sql`: initial Phase 1 database schema
- pluggable persistence with in-memory mode for tests/dev and Postgres mode for durable storage
- pluggable market-data backends with mock mode for tests/dev and Yahoo mode for automatic scoring
- model registry support for strategy/version metadata
- RSS/Atom feed ingestion for external finance event intake
- transcript/document URL ingestion for long-form earnings and policy text

### Run the API

1. Install dependencies with `npm install`
2. Start the API with `npm run dev:api`
3. Open `http://localhost:3001/health`
4. Open `http://localhost:3001/ready` for dependency readiness

### Docker runtime

The repository is now prepared to run the production API and supervised worker-service under Docker using the existing built entrypoints.

1. Build and start the stack with `docker compose up --build`
2. Open `http://localhost:3001/health`
3. Open `http://localhost:3001/ops`

The compose stack starts:

- `db`: Postgres
- `migrate`: one-shot schema migration
- `api`: `node apps/api/dist/index.js`
- `worker-service`: `node apps/api/dist/scripts/runOperationWorkerService.js`

The worker container uses the repository-backed supervisor check for health:

- `node apps/api/dist/scripts/checkOperationWorkerService.js --mode=liveness --service-id=worker-service-main`

If you need to stop and remove the stack, run `docker compose down`. Add `-v` if you also want to remove the Postgres volume.

The health route now reflects execution telemetry too. If the latest major backend job failed, `/health` reports that failure instead of only returning a static success payload, and it now includes queued-job and active-lease counts. It also exposes `worker_monitoring`, `worker_service_monitoring`, `integration_monitoring`, `integration_governance_monitoring`, and `incident_monitoring`, so you can see whether the queue boundary is healthy, whether supervisor churn is building, and whether feed/transcript dependencies are actively being throttled or suppressed. The readiness route performs lightweight dependency probes against the repository and embedding provider and returns `503` if either one is degraded.

### Docker operations runbook

Use these checks to validate the production-style Docker stack after `docker compose up --build -d`.

Startup and health:

1. Run `docker compose ps` and confirm `db`, `api`, and `worker-service` are healthy and `migrate` exited successfully.
2. Open `http://localhost:3001/health` and confirm `ok: true`.
3. Open `http://localhost:3001/ready` and confirm dependency readiness is healthy.
4. Open `http://localhost:3001/ops` for the operator view.
5. Optionally inspect `GET /v1/metrics/system/worker-services` to confirm an active supervised worker-service boundary is present.

Worker restart drill:

1. Run `docker compose restart worker-service`.
2. Run `docker compose ps` and confirm `worker-service` returns to `healthy`.
3. Re-check `http://localhost:3001/health`.
4. Inspect `GET /v1/metrics/system/worker-services` and confirm a fresh `supervisor_instance_id` / `started_at` is visible after the restart.

Persistence drill:

1. Queue a background job, for example with `POST /v1/operations/jobs`.
2. Record the returned `job_id`.
3. Run `docker compose down`.
4. Run `docker compose up -d`.
5. Re-check `GET /v1/operations/jobs/:jobId` and confirm the completed job is still present after restart.

Logs:

- `docker compose logs -f api`
- `docker compose logs -f worker-service`
- `docker compose logs -f db`

Stop commands:

- `docker compose down` stops the stack and keeps the Postgres volume.
- `docker compose down -v` removes the Postgres volume and should only be used when you intentionally want to destroy durable state.

### Environment

Copy values from `.env.example` into your shell or local environment before starting the API.

Important flags:

- `REPOSITORY_BACKEND=memory` for local prototype mode
- `REPOSITORY_BACKEND=pglite` for durable local storage with no external database install
- `REPOSITORY_BACKEND=postgres` for durable storage
- `MARKET_DATA_BACKEND=mock` for deterministic development
- `MARKET_DATA_BACKEND=yahoo` for automatic market outcome pulls
- `EMBEDDING_BACKEND=local` for persistent semantic memory vectors
- `PGLITE_DATA_DIR=.pglite/finance-superbrain` for the local persistent database path
- `DATABASE_URL=...` when using Postgres
- `OPERATION_WORKER_ID=...` to name a queue worker
- `OPERATION_WORKER_SERVICE_ID=...` to give the supervised worker service a stable deployment identity
- `OPERATION_WORKER_SERVICE_HOST=...` to override the hostname recorded for worker-service ownership checks when deployment environments need an explicit supervisor host label
- `MAX_OPERATION_JOBS=25` to cap each worker drain pass
- `OPERATION_WORKER_OPERATIONS=auto_score,benchmark_snapshot` to limit a worker to selected job types
- `OPERATION_RETRY_DELAY_SECONDS=60` to control queued retry backoff
- `OPERATION_HEARTBEAT_INTERVAL_MS=...` to force shorter lease heartbeats for very long jobs
- `OPERATION_WORKER_POLL_INTERVAL_MS=2000` to control the steady worker loop cadence
- `OPERATION_WORKER_IDLE_BACKOFF_MS=5000` to slow the worker loop when the queue is empty
- `OPERATION_WORKER_SERVICE_BACKOFF_MS=5000` to control how long the worker supervisor waits before restarting a crashed worker loop
- `OPERATION_WORKER_SERVICE_MAX_BACKOFF_MS=60000` to cap adaptive supervisor restart backoff when crash loops keep repeating
- `OPERATION_WORKER_SERVICE_SUCCESS_WINDOW_MS=60000` to reset restart streaks after a worker loop stays healthy for long enough
- `OPERATION_WORKER_SERVICE_HEARTBEAT_INTERVAL_MS=...` to force a tighter heartbeat cadence for the worker supervisor itself
- `OPERATION_WORKER_SERVICE_MAX_RESTARTS=10` to stop the supervisor after too many consecutive worker crashes
- `OPERATION_WORKER_SERVICE_STATUS_MODE=liveness` to choose whether the repository-backed worker-service supervisor check defaults to `liveness` or `readiness`
- `FEED_HEALTH_PROBE_URLS=...` to actively probe feed providers during readiness and ops checks
- `TRANSCRIPT_HEALTH_PROBE_URLS=...` to actively probe transcript providers during readiness and ops checks
- `INTEGRATION_PROBE_TIMEOUT_MS=5000` to control the timeout used by active feed/transcript dependency probes
- `INTEGRATION_PROBE_SNAPSHOT_BACKGROUND_ENABLED=true` to let the worker loop keep stored probe snapshots fresh in the background
- `INTEGRATION_PROBE_SNAPSHOT_BACKGROUND_INTERVAL_MS=60000` to control how often the worker loop checks whether probe snapshots need a queued refresh
- `INTEGRATION_GOVERNANCE_ENABLED=true` to let active feed/transcript probes drive queue backpressure decisions
- `INTEGRATION_GOVERNANCE_BACKGROUND_ENABLED=true` to let the worker loop keep stored governance snapshots fresh in the background without relying on dashboard or health traffic
- `INTEGRATION_GOVERNANCE_BACKGROUND_INTERVAL_MS=60000` to control how often the worker loop checks whether persisted governance state needs a queued refresh
- `INTEGRATION_GOVERNANCE_FRESHNESS_MS=300000` to control how long persisted provider-governance state is treated as fresh
- `INTEGRATION_GOVERNANCE_DEGRADED_DELAY_SECONDS=120` to slow queued pulls when probes show only partial provider degradation
- `INTEGRATION_GOVERNANCE_OUTAGE_DELAY_SECONDS=300` to delay or suppress queued pulls when probes show a full provider outage
- `INTEGRATION_GOVERNANCE_THROTTLE_HOLD_SECONDS=180` to keep partial-degradation backpressure active long enough to avoid probe flapping
- `INTEGRATION_GOVERNANCE_SUPPRESSION_HOLD_SECONDS=600` to keep persistent-outage suppression active through a sustained hold window
- `INTEGRATION_GOVERNANCE_PERSISTENT_OUTAGE_SECONDS=300` to escalate long-lived outages into suppression even before retries pile up
- `QUEUE_DEFAULT_SCHEDULED_EVOLUTION=true` to enqueue scheduled evolution runs by default
- `QUEUE_DEFAULT_BENCHMARK_TRUST_REFRESH=true` to enqueue benchmark trust refresh runs by default
- `QUEUE_DEFAULT_FEED_PULL=true` to enqueue feed pulls by default
- `QUEUE_DEFAULT_TRANSCRIPT_PULL=true` to enqueue transcript pulls by default
- `AUTH_SESSION_TTL_HOURS=168` to control internal workspace session lifetime
- `AUTH_COOKIE_SECURE=false` for local non-HTTPS development, or `true` behind TLS
- `AUTH_LOGIN_MAX_ATTEMPTS=5` to cap failed sign-in attempts per email/IP window
- `AUTH_LOGIN_WINDOW_MINUTES=15` to define the failed-login counting window
- `AUTH_LOGIN_BLOCK_MINUTES=15` to define how long sign-in is throttled after repeated failures

### Local durable mode with PGlite

This is the easiest way to make the memory cloud survive restarts on a machine that does not already have Postgres running.

1. Set `REPOSITORY_BACKEND=pglite`
2. Optionally set `PGLITE_DATA_DIR` or use the safer seeded-demo wrapper `npm run demo:proof:seed:local`
3. Run `npm run db:migrate` if you want an explicit initialization step, or let the first API/script run auto-create the schema
4. Seed reviewed memory with `npm run backfill:historical` or `npm run seed:demo`
5. Start the API with `npm run dev:api`
6. Open `http://localhost:3001/ops`

The same persistent local database will be reused by the API, backfill scripts, and auto-score worker as long as they point to the same `PGLITE_DATA_DIR`.

Important: `PGlite` is single-user for a given data directory. Run the API, seed jobs, and worker scripts sequentially against the same `PGLITE_DATA_DIR` instead of trying to hit that local store from multiple processes at once.

### Postgres setup

1. Create a Postgres database such as `finance_superbrain`
2. Set `DATABASE_URL`
3. Set `REPOSITORY_BACKEND=postgres`
4. Run `npm run db:migrate`
5. Optionally seed reviewed historical memory with `npm run backfill:historical`
6. Optionally seed the smaller demo set with `npm run seed:demo`
6. Start the API with `npm run dev:api`

### First endpoint

`POST /v1/events/parse`

Example request body:

```json
{
  "source_type": "transcript",
  "title": "BBC live interview",
  "speaker": "Donald Trump",
  "raw_text": "Donald Trump said tariffs on China could rise and that the yuan has been weakening, which may pressure Chinese tech stocks."
}
```

### Baseline prediction endpoint

`POST /v1/predictions/generate`

Example request body:

```json
{
  "event": {
    "event_class": "policy_speech",
    "summary": "Donald Trump focused on trade policy and china risk with a risk_off market tilt.",
    "sentiment": "risk_off",
    "urgency_score": 0.73,
    "novelty_score": 0.35,
    "entities": [
      { "type": "person", "value": "Donald Trump" },
      { "type": "country", "value": "China" },
      { "type": "organization", "value": "BBC" },
      { "type": "theme", "value": "trade_policy" },
      { "type": "theme", "value": "china_risk" }
    ],
    "themes": ["trade_policy", "china_risk"],
    "candidate_assets": ["KWEB", "FXI", "BABA", "USD/CNH"],
    "why_it_matters": [
      "Trade-policy escalation tends to raise risk premiums for China-linked equities and FX."
    ]
  },
  "horizons": ["1d", "5d"]
}
```

### Learning loop endpoints

- `POST /v1/sources`
- `POST /v1/sources/:sourceId/parse`
- `POST /v1/events/:eventId/predictions`
- `GET /v1/events/:eventId/analogs`
- `POST /v1/predictions/:predictionId/score`
- `POST /v1/predictions/:predictionId/postmortem`
- `POST /v1/operations/auto-score`
- `POST /v1/operations/jobs`
- `GET /v1/operations/jobs`
- `GET /v1/operations/jobs/:jobId`
- `POST /v1/operations/benchmark-snapshot`
- `POST /v1/operations/walk-forward-snapshot`
- `POST /v1/operations/calibration-snapshot`
- `POST /v1/operations/evolution-cycle`
- `GET /v1/operations/evolution-schedule`
- `POST /v1/operations/evolution-schedule`
- `POST /v1/operations/evolution-schedule/run`
- `GET /v1/operations/evolution/alert-policies`
- `POST /v1/operations/evolution/alert-policies`
- `POST /v1/operations/evolution/alerts/:alertId/acknowledge`
- `POST /v1/operations/evolution/alerts/:alertId/snooze`
- `POST /v1/operations/evolution/alerts/:alertId/handle`
- `POST /v1/operations/evolution/actions/:actionId/approve`
- `POST /v1/operations/evolution/actions/:actionId/block`
- `POST /v1/operations/molt-cycle`
- `POST /v1/operations/promotion-cycle`
- `POST /v1/operations/self-audit`
- `GET /v1/metrics/system/operations`
- `GET /v1/metrics/system/queue`
- `GET /v1/metrics/system/queue-alerts`
- `GET /v1/metrics/system/incidents`
- `GET /v1/metrics/system/workers`
- `GET /v1/metrics/system/worker-services`
- `GET /v1/metrics/system/worker-service-trends`
- `GET /v1/metrics/system/integration-probes`
- `GET /v1/metrics/system/integration-governance`
- `GET /v1/metrics/system/worker-trends`
- `GET /v1/metrics/system/integration-trends`
- `GET /v1/metrics/system/leases`
- `POST /v1/ingestion/historical/batch`
- `POST /v1/ingestion/historical/library`
- `POST /v1/ingestion/historical/core-corpus`
- `POST /v1/ingestion/historical/macro-calendar`
- `POST /v1/ingestion/historical/earnings`
- `POST /v1/ingestion/historical/energy`
- `POST /v1/ingestion/historical/credit-banking`
- `POST /v1/ingestion/historical/policy-fx`
- `GET /v1/ingestion/historical/library`
- `GET /v1/ingestion/historical/library/:caseId`
- `POST /v1/ingestion/historical/library/:caseId/review`
- `POST /v1/ingestion/feeds/pull`
- `POST /v1/ingestion/transcripts/pull`
- `POST /v1/ingestion/live/webhooks/:provider`
- `POST /v1/transcript-sessions`
- `GET /v1/transcript-sessions/:sessionId`
- `GET /v1/transcript-sessions/:sessionId/analysis`
- `POST /v1/transcript-sessions/:sessionId/chunks`
- `POST /v1/transcript-sessions/:sessionId/close`
- `POST /v1/models`
- `GET /v1/models`
- `GET /v1/models/:modelVersion`
- `POST /v1/models/:modelVersion/tune-from-replay`
- `POST /v1/models/:modelVersion/promotion-gate`
- `GET /v1/dashboard/benchmarks`
- `GET /v1/dashboard/operations`
- `GET /v1/dashboard/pipeline`
- `GET /v1/dashboard/summary`
- `GET /v1/predictions/:predictionId`
- `GET /v1/lessons`
- `GET /v1/lessons/search?q=...`
- `GET /v1/metrics/calibration`
- `GET /v1/metrics/calibration/history`
- `GET /v1/metrics/benchmarks/history`
- `GET /v1/metrics/walk-forward/history`
- `GET /v1/metrics/walk-forward/trends`
- `GET /v1/metrics/walk-forward/regimes`
- `GET /v1/metrics/walk-forward/regressions`
- `GET /v1/metrics/walk-forward/regime-regressions`
- `GET /v1/metrics/benchmarks/stability`
- `GET /v1/metrics/benchmarks/trends`
- `GET /v1/metrics/benchmarks/regressions`
- `GET /v1/metrics/lineage`
- `GET /v1/metrics/lineage/history`
- `GET /v1/metrics/evolution/trends`
- `GET /v1/metrics/evolution/alerts`
- `GET /v1/metrics/evolution/alerts/history`
- `GET /v1/metrics/evolution/actions`
- `GET /v1/metrics/historical-library`
- `GET /v1/metrics/historical-library/gaps`
- `GET /v1/metrics/models`
- `GET /v1/metrics/promotions`
- `GET /v1/metrics/promotions/analytics`
- `GET /v1/metrics/promotions/patterns`
- `GET /v1/metrics/replay/benchmark-packs`
- `POST /v1/metrics/replay`
- `POST /v1/metrics/replay/benchmark-packs/compose`
- `POST /v1/metrics/replay/benchmark-packs/run`
- `POST /v1/metrics/replay/library`
- `POST /v1/metrics/replay/diagnostics`
- `POST /v1/metrics/replay/walk-forward`
- `GET /ops`

### Automatic scoring

You can run automatic scoring in two ways:

- through HTTP: `POST /v1/operations/auto-score`
- through the worker script: `npm run ops:auto-score`

Example body:

```json
{
  "as_of": "2026-03-14T00:00:00.000Z",
  "create_postmortems": true
}
```

This will:

1. find matured pending predictions
2. fetch realized market moves from the configured market-data backend
3. score the prediction
4. generate a post-mortem
5. store a lesson

### Historical analogs

The engine now supports historical analog retrieval for stored events.

`GET /v1/events/:eventId/analogs`

This returns the most similar reviewed historical cases based on:

- theme overlap
- entity overlap
- sentiment match
- event-class match

Those analogs are also used internally to calibrate future predictions. When similar reviewed cases exist, prediction evidence will include an `Analog calibration` line and confidence can adjust up or down based on prior realized scores and lessons.

### Lesson search

`GET /v1/lessons/search?q=china%20tariffs`

This searches stored lessons across:

- lesson summaries
- post-mortem critiques
- event summaries
- event themes

It is the first retrieval surface for the bot's learned memory, so operators can search previous mistakes or reinforcements before changing prompts, risk settings, or trust levels.

The search now uses a lightweight semantic retrieval layer built from:

- lesson summaries
- post-mortem critiques
- event summaries and themes
- prediction theses and evidence

That makes it more concept-aware than exact keyword matching alone.

When reviewed lessons are stored through the API, auto-score worker, or historical backfill flow, the system now persists a lesson embedding alongside the lesson record so later searches can reuse the semantic memory instead of recomputing everything from raw text each time.

### Calibration metrics

`GET /v1/metrics/calibration`

This gives a confidence-versus-outcome view across horizons. It is the first explicit self-evaluation surface for the bot and helps answer:

- are high-confidence predictions actually earning that confidence?
- where is the model overconfident?
- which horizons are behaving best?

### Calibration history

The engine can now persist calibration checkpoints over time instead of only showing the live report.

- `POST /v1/operations/calibration-snapshot`
- `GET /v1/metrics/calibration/history?limit=10`
- `npm run ops:snapshot-calibration`

This gives the bot a durable self-audit trail, so operators can see whether confidence quality is improving, degrading, or drifting by period instead of only looking at the latest state.

### Model version comparison

`GET /v1/metrics/models`

This compares stored model versions across:

- realized total score
- direction accuracy
- calibration gap
- verdict mix
- horizon-level performance

It is the first leaderboard for answering the most important internal question: which engine version is actually compounding edge, and which one is only sounding smarter?

### Historical replay benchmark

`POST /v1/metrics/replay`

This runs multiple `model_version` values against the same reviewed historical case pack and returns:

- case-level replay outcomes
- model-level aggregate scores
- theme buckets
- source-type buckets
- horizon buckets
- leaders by score, direction accuracy, and calibration alignment

It is the first true offline benchmark surface for deciding whether a new model version is actually better.

You can also run the benchmark from the terminal with:

- `npm run ops:replay-benchmark`

Environment variables:

- `REPLAY_MODEL_VERSIONS=impact-engine-v0,macro-live-v1`
- `REPLAY_CASE_PACK=macro_v1`

This uses the curated historical replay pack in [historicalBackfillCases.ts](C:\Users\rayan\OneDrive\Documents\Playground\trade-journal-site\apps\api\src\data\historicalBackfillCases.ts) and compares each listed model version across the same 12 reviewed finance cases.

Available case packs:

- `macro_v1`: 12 reviewed baseline cases
- `macro_plus_v1`: 20 reviewed cases for tougher promotion checks

### Historical library replay

`POST /v1/metrics/replay/library`

This route builds a replay benchmark directly from the durable historical case library instead of the hardcoded curated pack.

By default it only uses cases with `case_quality` of `reviewed` or `high_confidence`, so draft cases do not leak into the stronger benchmark and promotion paths.

Example request body:

```json
{
  "model_versions": ["impact-engine-v0", "macro-live-v1"],
  "case_pack": "macro_plus_v1",
  "limit": 200
}
```

You can also run it from the terminal with:

- `npm run ops:replay-library`

Environment variables:

- `REPLAY_MODEL_VERSIONS=impact-engine-v0,macro-live-v1`
- `REPLAY_LIBRARY_CASE_PACK=macro_plus_v1`
- `REPLAY_LIBRARY_CASE_IDS=`
- `REPLAY_LIBRARY_LIMIT=200`

This is the bridge from stored historical memory to repeatable benchmark evidence.

### Mixed benchmark packs

- `GET /v1/metrics/replay/benchmark-packs`
- `POST /v1/metrics/replay/benchmark-packs/compose`
- `POST /v1/metrics/replay/benchmark-packs/run`
- `npm run ops:replay-benchmark-pack`

This layer composes a real cross-domain benchmark corpus from the reviewed historical library instead of replaying only a narrow pack. It balances macro, earnings, policy/FX, energy, and credit/banking memory before replay or promotion gates use it.

Built-in packs:

- `core_benchmark_lite_v1`: 1 reviewed case per major domain
- `core_benchmark_v1`: 4 reviewed cases per major domain

Example request body:

```json
{
  "model_versions": ["impact-engine-v0", "contrarian-regime-v1"],
  "benchmark_pack_id": "core_benchmark_v1"
}
```

If `strict_quotas` remains enabled and the library is still thin in one or more domains, the compose/run route returns `409 benchmark_pack_incomplete` with the missing-domain breakdown.

Environment variables:

- `REPLAY_MODEL_VERSIONS=impact-engine-v0,contrarian-regime-v1`
- `REPLAY_BENCHMARK_PACK_ID=core_benchmark_v1`
- `REPLAY_BENCHMARK_CASE_PACK_FILTERS=macro_calendar_v1,earnings_v1`
- `REPLAY_BENCHMARK_STRICT=true`

### Benchmark history and regression tracking

- `POST /v1/operations/benchmark-snapshot`
- `GET /v1/metrics/benchmarks/history`
- `GET /v1/metrics/benchmarks/stability`
- `GET /v1/metrics/benchmarks/trends`
- `GET /v1/metrics/benchmarks/regressions`

### Operation monitoring

- `GET /health`
- `GET /ready`
- `GET /v1/metrics/system/operations`

Major backend jobs now store durable execution runs with:

- operation name
- trigger source (`api`, `schedule`, `script`, or `internal`)
- success / partial / failed status
- duration
- compact summaries
- latest error message

This gives the ops desk a real execution-history layer instead of relying only on benchmark and learning metrics.
Direct scripts now record themselves as `script` when they run against the local repository, and scripts that go through the live API preserve that same trigger classification through the `x-operation-trigger` header.

### Queued operations and execution leases

Phase 4 now includes a durable worker boundary for long-running operations.

- `POST /v1/operations/jobs` enqueues a durable backend job
- `idempotency_key` safely de-duplicates repeated enqueue requests
- inline operation routes now take execution leases, so overlapping runs return `409 operation_locked` instead of racing
- queued jobs and inline leases now renew themselves while work is still running, instead of relying only on a fixed TTL
- stale running jobs that have already exhausted their attempts are now auto-abandoned as `failed` instead of staying stuck in `running`
- `GET /v1/metrics/system/queue` shows pending/running/completed/failed jobs plus retry backlog, stale-running counts, and queue age signals
- `GET /v1/metrics/system/queue-alerts` summarizes backlog pressure, retries, failures, stale-running incidents, and worker-availability problems into operator-facing alerts
- `GET /v1/metrics/system/incidents` consolidates queue, worker, supervisor, and integration incidents into a single actionable incident feed
- `GET /v1/metrics/system/integrations` summarizes feed/transcript dependency health, retry pressure, permanent failures, and recent integration incidents
- `GET /v1/metrics/system/workers` shows registered queue workers, heartbeat age, lifecycle state, and last-cycle throughput
- `GET /v1/metrics/system/worker-services` shows the supervised worker-service boundary itself, including restart streaks, backoff state, and latest loop exits
- `GET /v1/metrics/system/worker-service-trends` shows durable supervisor-boundary history so restart churn, duplicate-supervisor ownership conflicts, failed supervisors, and service-level loop exits are visible over time
- `GET /v1/metrics/system/worker-trends` shows durable worker start/cycle/stop history, restart churn, error stops, and stale-job recovery over a rolling time window
- `GET /v1/metrics/system/integration-probes` now returns the stored probe snapshot by default; add `?refresh=true` when you explicitly want a live provider probe capture
- `GET /v1/metrics/system/integration-governance` shows the enforced queue-control state for feed/transcript providers, including when queued pulls are being throttled or suppressed
- `GET /v1/metrics/system/integration-trends` shows retry buildup, permanent failures, and stale recoveries for feed/transcript integrations over time
- `GET /v1/metrics/system/leases` shows the active operation scopes currently held
- `npm run ops:drain-operation-jobs` drains the queue through the worker path
- `npm run ops:worker-loop` runs a dedicated polling worker loop for the queue
- `npm run ops:worker-service` runs a supervised worker service that restarts the loop after crashes with adaptive bounded backoff, prefers a direct worker-loop runtime invocation before falling back to package-script indirection, refuses to overwrite a fresh active service boundary that is already owned by another supervisor, respects durable restart backoff that was already recorded by an earlier supervisor instance, and persists a unique supervisor instance id so runtime ownership stays precise across restarts
- `npm run ops:worker-service-status` performs a repository-backed supervisor check for the worker-service boundary; use `--mode=liveness` to pass while the supervisor is alive but backing off, `--mode=readiness` to require an active draining boundary, and set `OPERATION_WORKER_SERVICE_ID` or `OPERATION_WORKER_ID` so the check targets a single service deterministically under a real process supervisor

The worker loop now persists its own heartbeat and cycle metrics, so `/health`, `/ops`, and the worker metrics route can tell the difference between:

- an active queue worker
- a stale worker that stopped heartbeating
- and a stopped worker that shut down cleanly

Worker supervision now also stores durable start, cycle, and stop events, and the supervised worker service stores its own runtime state, including supervisor host, supervisor pid, supervisor instance id, invocation mode, and the current adaptive restart backoff, so operators can see whether the worker boundary is merely unhealthy right now, restarting in backoff, fighting another supervisor for ownership, or has been unstable across a recent time window.

The worker loop now also owns probe snapshot freshness and governance freshness in the background. When configured feed/transcript probe snapshots are missing or stale, it enqueues a durable `integration_probe_snapshot` job. When persisted governance state is missing, stale, or holding an expired provider action, it enqueues a durable `integration_governance_refresh` job. That keeps `/health`, `/ops`, and dashboard reads on passive persisted snapshots instead of making routine monitoring traffic perform live network probes or write-through governance refreshes.

`/health` now treats high-severity consolidated incidents as unhealthy, so the API cannot report `ok: true` while the worker-service boundary or another operational layer is actively signaling serious instability.

`GET /v1/dashboard/operations` now provides the repository-backed operational snapshot that powers the `/ops` system panels, including queue state, incidents, worker and worker-service trends, integration trends, active probe results, and the current integration-governance control state, so the operator desk no longer has to fan out across separate queue, worker, worker-service, and integration endpoints just to render the core runtime state. The dashboard now respects governance freshness windows instead of forcing a write-through governance refresh on every load.

The integration metrics route adds the same style of visibility for external dependencies:

- feed pulls and transcript pulls now carry retryability and upstream status-code context into queue history
- retryable integration failures use adaptive backoff, respecting `Retry-After` when providers supply it
- configured feed/transcript provider URLs can now be actively probed through readiness and `/ops` so upstream outages are visible before queue failures accumulate
- stored probe snapshots now have a dedicated worker-owned refresh path, so `/health`, `/ops`, and dashboard reads can stay on persisted read models while `?refresh=true` remains the deliberate live-probe path
- stored governance snapshots now follow the same model, so `GET /v1/metrics/system/integration-governance` is passive by default while `?refresh=true` remains the explicit active refresh path
- active probe degradation now escalates into operator-facing incidents inside the operational snapshot instead of remaining an isolated health panel
- active probe and trend pressure now also drive persisted integration-governance state, so queued pulls can be throttled or temporarily suppressed before the queue turns into a retry storm
- queued feed/transcript hot paths now reuse fresh persisted governance state instead of forcing a fresh probe on every enqueue or claim, but they stop trusting cached state as soon as the current hold window expires
- non-retryable failures are surfaced as explicit operator incidents instead of quietly recycling through the queue

The heaviest route entrypoints can now choose how they execute:

- `?execution=inline` runs inside the request
- `?execution=queued` enqueues a durable job and returns `202`
- `?execution=auto` follows the queue-default environment flags above

That execution switch is currently supported by:

- `POST /v1/operations/evolution-schedule/run`
- `POST /v1/operations/benchmark-trust-refresh`
- `POST /v1/ingestion/feeds/pull`
- `POST /v1/ingestion/transcripts/pull`

Example queued job:

```json
{
  "operation_name": "benchmark_trust_refresh",
  "payload": {
    "benchmark_pack_id": "core_benchmark_v1",
    "reviewer": "queue-worker",
    "seed_limit": 8
  },
  "idempotency_key": "trust-refresh-core-v1"
}
```
- `npm run ops:snapshot-benchmark`
- `npm run ops:benchmark-stability`
- `npm run ops:benchmark-trends`
- `npm run ops:benchmark-regressions`

This is the report-card layer for the mixed benchmark packs. It stores durable replay checkpoints, shows how each family moves over time, and raises regression alerts when the current shell falls behind the family's stronger prior benchmark baseline.

Regression alerts now also track consecutive checkpoint streaks, so the system can tell the difference between a one-off soft patch and a family that keeps slipping on the core benchmark.

The stability report adds weekly rollups and family durability scores, so you can see which families are steady across time instead of only checking the latest checkpoint.

Example snapshot request body:

```json
{
  "benchmark_pack_id": "core_benchmark_v1",
  "allowed_case_qualities": ["reviewed", "high_confidence"],
  "strict_quotas": false
}
```

Useful queries:

- `GET /v1/metrics/benchmarks/history?benchmark_pack_id=core_benchmark_v1&limit=10`
- `GET /v1/metrics/benchmarks/stability?benchmark_pack_id=core_benchmark_v1`
- `GET /v1/metrics/benchmarks/trends?benchmark_pack_id=core_benchmark_v1`
- `GET /v1/metrics/benchmarks/regressions?benchmark_pack_id=core_benchmark_v1`

This is the layer that turns the benchmark pack from a one-off exam into stored report cards, trend lines, and regression warnings.

### Replay diagnostics

`POST /v1/metrics/replay/diagnostics`

This builds the next layer on top of the replay benchmark. For each model version it now returns:

- weakest themes
- weakest tags
- weakest source types

### Walk-forward replay

`POST /v1/metrics/replay/walk-forward`

This runs time-ordered validation from the durable historical library instead of mixing all cases together at once. Each fold:

- seeds memory from older cases only
- evaluates the next unseen window
- aggregates model quality across windows

The current implementation uses expanding windows and requires dated historical cases with `source.occurred_at`.

Walk-forward responses now also report:

- eligible regime breadth
- eligible high-confidence case count
- timed regime slices per model, so you can inspect performance inside specific market states like `fx_intervention` or `banking_stress`
- timed warnings when the dated pool is too thin or uneven

You can also run it from the terminal with:

- `npm run ops:walk-forward`

Timed checkpoints can also be stored durably through:

- `POST /v1/operations/walk-forward-snapshot`
- `GET /v1/metrics/walk-forward/history`
- `GET /v1/metrics/walk-forward/trends`
- `GET /v1/metrics/walk-forward/regimes`
- `GET /v1/metrics/walk-forward/regressions`
- `GET /v1/metrics/walk-forward/regime-regressions`

The new regime-regression view isolates where a family is slipping inside specific market states, such as `fx_intervention` or `banking_stress`, instead of only showing one aggregate timed score.

Environment variables:

- `WALK_FORWARD_MODEL_VERSIONS=impact-engine-v0,macro-live-v1`
- `WALK_FORWARD_BENCHMARK_PACK_ID=core_benchmark_v1`
- `WALK_FORWARD_CASE_PACK_FILTERS=macro_calendar_v1,earnings_v1,policy_fx_v1`
- `WALK_FORWARD_MIN_TRAIN_CASES=10`
- `WALK_FORWARD_TEST_WINDOW_SIZE=5`
- `WALK_FORWARD_STEP_SIZE=5`
- `WALK_FORWARD_SEED_TRAINING_MEMORY=true`
- weakest horizons
- frequent failure tags
- high-confidence misses
- a recommended tuning patch for model feature flags

You can also run it from the terminal with:

- `npm run ops:replay-diagnostics`

Environment variables:

- `REPLAY_MODEL_VERSIONS=impact-engine-v0,macro-live-v1`
- `REPLAY_CASE_PACK=macro_v1`

This is the main diagnostics surface for finding where a model profile is brittle and what to tune next.

### Replay tuning application

`POST /v1/models/:modelVersion/tune-from-replay`

This route turns a replay diagnostics result into a saved model-registry variant. It will:

1. run replay diagnostics for the source model against the supplied reviewed cases
2. reuse the strongest successful promotion patterns as tuning priors when history exists
3. build a tuning patch from the weakest slices and failure-tag profile
4. save a new or updated model version with merged `feature_flags`

Example request body:

```json
{
  "cases": [],
  "target_model_version": "macro-live-v1-replay-tuned",
  "label_suffix": "Replay tuned",
  "status": "experimental"
}
```

You can also generate a tuned model variant from the terminal with:

- `npm run ops:tune-from-replay`

Environment variables:

- `REPLAY_TUNE_MODEL_VERSION=macro-live-v1`
- `REPLAY_TUNE_TARGET_MODEL_VERSION=macro-live-v1-replay-tuned`
- `REPLAY_TUNE_LABEL_SUFFIX=Replay tuned`
- `REPLAY_TUNE_STATUS=experimental`
- `REPLAY_TUNE_USE_PATTERN_PRIORS=true`
- `REPLAY_CASE_PACK=macro_v1`

The tuning response now includes `applied_pattern_priors`, and saved models retain replay-prior metadata like `replay_prior_patterns`, `replay_prior_scope`, and `replay_prior_family`.

This is the first closed-loop path for applying evidence-backed profile tuning instead of only reading diagnostics.

### Replay promotion gate

`POST /v1/models/:modelVersion/promotion-gate`

This route compares a candidate model against a baseline model on the same replay pack and only promotes the candidate when it clears your thresholds for:

- average total score lift
- direction accuracy delta
- wrong-rate delta
- calibration alignment improvement

You can also supply an optional `walk_forward` block on the same route. When enabled, the gate runs a second timed validation from the dated historical library and only passes if the candidate survives both the static replay comparison and the walk-forward time-ordered comparison.

That `walk_forward` block can now enforce depth requirements too, so a shell can fail timed promotion even when the raw deltas look fine if the dated evidence is still too shallow. The gate supports:

- minimum walk-forward window count
- minimum eligible dated-case count
- minimum eligible regime count
- minimum eligible high-confidence case count

The default timed-promotion bar is now stricter than before:

- at least `3` timed windows
- at least `15` eligible dated cases
- at least `4` distinct regimes
- at least `2` eligible high-confidence cases

Example request body:

```json
{
  "baseline_model_version": "impact-engine-v0",
  "cases": [],
  "thresholds": {
    "min_average_total_score_delta": 0.01,
    "min_direction_accuracy_delta": 0,
    "max_wrong_rate_delta": 0,
    "min_calibration_alignment_delta": 0
  },
  "promote_on_pass": true,
  "promoted_status": "active"
}
```

You can also run it from the terminal with:

- `npm run ops:replay-promotion-gate`

Environment variables:

- `REPLAY_PROMOTION_CANDIDATE=contrarian-regime-v1`
- `REPLAY_PROMOTION_BASELINE=impact-engine-v0`
- `REPLAY_CASE_PACK=macro_plus_v1`
- `REPLAY_PROMOTION_MIN_SCORE_DELTA=0.01`
- `REPLAY_PROMOTION_MIN_DIRECTION_DELTA=0`
- `REPLAY_PROMOTION_MAX_WRONG_RATE_DELTA=0`
- `REPLAY_PROMOTION_MIN_CALIBRATION_DELTA=0`
- `REPLAY_PROMOTION_APPLY=true`
- `REPLAY_PROMOTION_STATUS=active`

This is the first promotion discipline layer for the superbrain. It stops us from graduating models because they sound better and forces them to earn promotion on replay evidence.

### Promotion history

`GET /v1/metrics/promotions?limit=10`

Promotion-gate decisions are now stored durably, so the system keeps a full audit trail of:

- candidate and baseline versions
- pass or fail decision
- delta metrics
- thresholds used
- optional walk-forward evidence
- saved model snapshot after the decision

This turns model promotion into a measurable history instead of a one-off manual action.

### Promotion analytics

`GET /v1/metrics/promotions/analytics`

This rolls the promotion history up into family-level operating signals:

- pass rate by model family
- recent pass rate versus the prior window
- trend signal: `improving`, `flat`, `declining`, or `insufficient_data`
- average score, direction, wrong-rate, and calibration deltas
- leaders by pass rate, trend improvement, calibration alignment, and wrong-rate reduction

You can also run it from the terminal with:

- `npm run ops:promotion-analytics`

This is the leaderboard layer for the promotion system. It tells us which strategy families are actually compounding edge over time.

### Tuning-pattern analytics

`GET /v1/metrics/promotions/patterns`

This report ranks which replay-tuning patterns are most associated with successful promotions. It aggregates promotion history into pattern-level signals such as:

- strategy profile
- confidence bias direction
- confidence cap tightness
- conviction bias direction
- magnitude multiplier regime
- focus themes
- caution themes
- preferred assets

For each pattern it reports:

- pass rate
- recent versus prior trend
- average replay score delta
- average direction delta
- average wrong-rate delta
- average calibration-alignment delta
- families using that pattern

You can also run it from the terminal with:

- `npm run ops:promotion-patterns`

This is the first layer that tells us not just which family is winning, but which kinds of replay adjustments are most worth repeating.

### Automatic promotion cycle

- `POST /v1/operations/promotion-cycle`
- `npm run ops:promotion-cycle`

This is the automated no-manual-touch promotion path. It will:

1. discover experimental candidates in the model registry
2. find the active baseline for each family, or use `replay_tuned_from` when present
3. run replay promotion gates on the chosen historical case pack or mixed benchmark pack
4. promote only the candidates that clear the thresholds
5. store promotion history for every decision

If you send `benchmark_pack_id`, the cycle uses the multi-domain historical-library benchmark instead of the older curated static pack flow.

Example request body:

```json
{
  "case_pack": "macro_plus_v1",
  "thresholds": {
    "min_average_total_score_delta": 0.01,
    "min_direction_accuracy_delta": 0,
    "max_wrong_rate_delta": 0,
    "min_calibration_alignment_delta": 0
  },
  "promote_on_pass": true,
  "promoted_status": "active",
  "max_candidates": 10
}
```

### Governed molt cycle

- `POST /v1/operations/molt-cycle`
- `npm run ops:molt-cycle`

This is the self-molting loop for model families. It will:

1. inspect active model families for growth pressure
2. trigger when promotion history is weakening or current performance/calibration has drifted
3. spawn a replay-tuned experimental shell from the current active shell
4. reuse successful promotion-pattern priors when available
5. promotion-gate the new shell and only harden it when replay evidence is good enough

The generated model stores metadata like `molt_from`, `molt_trigger_reasons`, `molt_cycle_status`, and `molt_last_decision` so the shell-change history stays auditable.

If `benchmark_pack_id` is supplied, the cycle also reads weekly benchmark stability before deciding how aggressively to molt each family:

- `fragile` families get accelerated shell-growth triggers
- `durable` families keep more trust in the current shell, so replacement shells need stronger replay evidence before they harden

Each molt item now returns a `stability_adjustment` block with the family signal, effective trigger thresholds, effective promotion thresholds, and the rationale used for that bias.

Example request body:

```json
{
  "case_pack": "macro_plus_v1",
  "benchmark_pack_id": "core_benchmark_v1",
  "apply_stability_bias": true,
  "min_family_pass_rate": 0.75,
  "score_floor": 0.68,
  "max_abs_calibration_gap": 0.12,
  "require_pattern_priors": true,
  "thresholds": {
    "min_average_total_score_delta": 0.01,
    "min_direction_accuracy_delta": 0,
    "max_wrong_rate_delta": 0,
    "min_calibration_alignment_delta": 0
  }
}
```

### Model lineage

- `GET /v1/metrics/lineage`
- `npm run ops:lineage-report`

This report turns shell changes into a tracked family tree. It shows:

1. root shell for each family
2. active shell and latest shell
3. generation depth across replay-tuned and molted descendants
4. recent molt history
5. inherited prior patterns, trigger reasons, and hardening decisions

That gives the finance superbrain a real evolutionary chain instead of a flat registry of model versions.

### Lineage snapshot history

- `GET /v1/metrics/lineage/history`
- `npm run ops:snapshot-lineage`

This captures the lineage state at a point in time so you can track evolution over weeks, not just inspect the latest shell tree.

Each snapshot stores:

1. family count
2. total shells across families
3. hardened shells across families
4. the full lineage report at that timestamp

### Evolution cycle

- `POST /v1/operations/evolution-cycle`
- `npm run ops:evolution-cycle`

This is the schedule-ready orchestration path. It bundles:

1. self-audit and optional calibration snapshot
2. optional mixed-benchmark snapshot capture
3. optional governed molt cycle
4. lineage snapshot capture

When the molt step runs, it now passes the selected `benchmark_pack_id` into the shell-growth loop so weekly benchmark stability can bias molting automatically during scheduled evolution too.

Example request body:

```json
{
  "benchmark_pack_id": "core_benchmark_v1",
  "capture_benchmark_snapshot": true,
  "capture_calibration_snapshot": true,
  "run_molt_cycle": true,
  "capture_lineage_snapshot": true,
  "molt_cycle": {
    "apply_stability_bias": true
  }
}
```

That makes the system ready for recurring evolution runs without wiring several separate ops calls together by hand.

Environment variables:

- `REPLAY_CASE_PACK=macro_plus_v1`
- `EVOLUTION_BENCHMARK_PACK_ID=core_benchmark_v1`
- `EVOLUTION_BENCHMARK_INTERVAL_HOURS=24`
- `EVOLUTION_CAPTURE_BENCHMARK_SNAPSHOT=true`
- `REPLAY_PROMOTION_MIN_SCORE_DELTA=0.01`
- `REPLAY_PROMOTION_MIN_DIRECTION_DELTA=0`
- `REPLAY_PROMOTION_MAX_WRONG_RATE_DELTA=0`
- `REPLAY_PROMOTION_MIN_CALIBRATION_DELTA=0`
- `REPLAY_PROMOTION_APPLY=true`
- `REPLAY_PROMOTION_STATUS=active`
- `REPLAY_PROMOTION_MAX_CANDIDATES=10`

This is the first automated model-promotion loop in the project.

### Evolution schedule

- `GET /v1/operations/evolution-schedule`
- `POST /v1/operations/evolution-schedule`
- `POST /v1/operations/evolution-schedule/run`
- `npm run ops:evolution-schedule`
- `npm run ops:run-scheduled-evolution`

This is the recurring-habit layer for the superbrain. It stores a durable schedule config for:

1. self-audit cadence
2. benchmark snapshot cadence
3. walk-forward snapshot cadence
4. benchmark trust-refresh cadence
5. governed molt cadence
6. lineage snapshot cadence
6. default high-confidence seeding behavior used during scheduled trust refresh
7. default replay thresholds used during scheduled molts
8. whether scheduled molts should apply benchmark-stability bias

Example update request body:

```json
{
  "enabled": true,
  "self_audit_interval_hours": 24,
  "benchmark_pack_id": "core_benchmark_v1",
  "benchmark_snapshot_interval_hours": 24,
  "run_benchmark_trust_refresh": true,
  "benchmark_trust_refresh_interval_hours": 168,
  "molt_interval_hours": 168,
  "lineage_snapshot_interval_hours": 24,
  "capture_benchmark_snapshot": true,
  "run_molt_cycle": true,
  "capture_lineage_snapshot": true,
  "trust_refresh_defaults": {
    "benchmark_pack_id": "core_benchmark_v1",
    "reviewer": "core-corpus-seed",
    "seed_limit": 8,
    "min_candidate_score": 0.8,
    "dry_run": false,
    "ingest_reviewed_memory": false,
    "model_version": "historical-library-high-confidence-v1",
    "strict_quotas": false
  },
  "molt_cycle_defaults": {
    "case_pack": "macro_plus_v1",
    "benchmark_pack_id": "core_benchmark_v1",
    "apply_stability_bias": true,
    "max_families": 10,
    "min_family_pass_rate": 0.65,
    "score_floor": 0.68,
    "max_abs_calibration_gap": 0.12
  }
}
```

When `POST /v1/operations/evolution-schedule/run` is called, the engine checks what is due and runs only that work. If benchmark trust refresh is due, it seeds stronger `high_confidence` cases from the reviewed corpus first, captures the fresh benchmark snapshot from that upgraded memory, and then runs the rest of the due evolution work. This lets the system evolve on cadence instead of only through manual operator decisions.

If walk-forward snapshots are enabled on the schedule, the same cadence now captures a saved time-ordered checkpoint too. That means timed validation can build its own history, trend lines, and regression pressure instead of only existing as an on-demand promotion check.

Environment variables:

- `EVOLUTION_SCHEDULE_ENABLED=true`
- `EVOLUTION_SELF_AUDIT_INTERVAL_HOURS=24`
- `EVOLUTION_BENCHMARK_PACK_ID=core_benchmark_v1`
- `EVOLUTION_BENCHMARK_INTERVAL_HOURS=24`
- `EVOLUTION_CAPTURE_BENCHMARK_SNAPSHOT=true`
- `EVOLUTION_RUN_BENCHMARK_TRUST_REFRESH=true`
- `EVOLUTION_BENCHMARK_TRUST_REFRESH_INTERVAL_HOURS=168`
- `EVOLUTION_TRUST_REFRESH_BENCHMARK_PACK_ID=` optional override, otherwise the schedule benchmark pack is reused
- `EVOLUTION_TRUST_REFRESH_REVIEWER=core-corpus-seed`
- `EVOLUTION_TRUST_REFRESH_SEED_LIMIT=8`
- `EVOLUTION_TRUST_REFRESH_MIN_SCORE=0.8`
- `EVOLUTION_TRUST_REFRESH_DRY_RUN=false`
- `EVOLUTION_TRUST_REFRESH_INGEST_REVIEWED_MEMORY=false`
- `EVOLUTION_TRUST_REFRESH_MODEL_VERSION=historical-library-high-confidence-v1`
- `EVOLUTION_TRUST_REFRESH_STRICT_QUOTAS=false`
- `EVOLUTION_MOLT_INTERVAL_HOURS=168`
- `EVOLUTION_LINEAGE_INTERVAL_HOURS=24`
- `EVOLUTION_CAPTURE_CALIBRATION_SNAPSHOT=true`
- `EVOLUTION_RUN_MOLT_CYCLE=true`
- `EVOLUTION_CAPTURE_LINEAGE_SNAPSHOT=true`
- `MOLT_BENCHMARK_PACK_ID=` optional override, otherwise the schedule benchmark pack is reused
- `SELF_AUDIT_CREATE_POSTMORTEMS=true`

Important: in `memory` mode each CLI run starts fresh, so schedule state will not persist across separate processes. Use `pglite` or `postgres` when you want the recurring evolution memory to survive restarts.

When using `pglite` on Windows, the most reliable operator flow is to keep one API process running and point the ops scripts at it instead of reopening the same store in separate CLI processes. You can opt into that mode with:

- `OPS_USE_API=true`
- `API_BASE_URL=http://127.0.0.1:3001`

That lets commands like `npm run ops:evolution-schedule`, `npm run ops:run-scheduled-evolution`, `npm run ops:import-core-corpus`, and `npm run ops:benchmark-trust-refresh` talk to the live API over HTTP, which avoids the `pglite` single-writer/reopen problems we see in multi-process local workflows.
Those API-backed script runs also keep their `script` trigger classification in the durable operation history instead of appearing as generic manual API traffic.

### Claude review handoff

- `npm run ops:claude-review-packet`
- [CLAUDE_REVIEW_WORKFLOW.md](C:\Users\rayan\OneDrive\Documents\Playground\trade-journal-site\CLAUDE_REVIEW_WORKFLOW.md)

This generates a Markdown review handoff for Claude at:

- [CLAUDE_REVIEW_PACKET.md](C:\Users\rayan\OneDrive\Documents\Playground\trade-journal-site\CLAUDE_REVIEW_PACKET.md)

The packet summarizes:

1. benchmark stability and regressions
2. growth-pressure state
3. historical library coverage and gaps
4. model leaders and lineage state
5. current git context
6. a ready-to-paste review prompt

Useful environment variables:

- `CLAUDE_REVIEW_BENCHMARK_PACK_ID=core_benchmark_v1`
- `CLAUDE_REVIEW_FOCUS=molt logic|benchmark safety|historical corpus quality`
- `CLAUDE_REVIEW_QUESTIONS=Where are we brittle?|What should we build next?`
- `CLAUDE_REVIEW_BASE_URL=http://localhost:3001`
- `CLAUDE_REVIEW_SOURCE=api`
- `CLAUDE_REVIEW_OUTPUT=CLAUDE_REVIEW_PACKET.md`

### Family evolution trends

- `GET /v1/metrics/evolution/trends`

This report turns lineage snapshots and promotion history into family-level trend signals. For each family it now shows:

1. generation depth and recent change
2. total shells and hardened-shell growth
3. active-shell score and calibration movement
4. recent versus prior promotion pass rate
5. trend signal: `emerging`, `stable`, `improving`, or `pressured`

This is the report that answers whether a family is actually getting smarter over time, or just getting more complex.

### Growth-pressure alerts

- `GET /v1/metrics/evolution/alerts`

This report converts family trend drift into operator-readable pressure alerts. It raises low, medium, or high urgency when a family shows signals like:

1. falling promotion pass rate
2. weak active-shell score
3. stretched calibration gap
4. pressured lineage trend
5. no hardened descendant shells yet
6. regression on the selected mixed benchmark pack

Each alert includes a recommended action so the next molt can be triggered from evidence instead of intuition.

If you want the alert report to line up with a specific mixed benchmark pack, pass:

- `GET /v1/metrics/evolution/alerts?benchmark_pack_id=core_benchmark_v1`

### Alert history and operator actions

- `GET /v1/metrics/evolution/alerts/history`
- `GET /v1/metrics/evolution/actions`
- `POST /v1/operations/evolution/alerts/:alertId/acknowledge`
- `POST /v1/operations/evolution/alerts/:alertId/snooze`
- `POST /v1/operations/evolution/alerts/:alertId/handle`
- `POST /v1/operations/evolution/actions/:actionId/approve`
- `POST /v1/operations/evolution/actions/:actionId/block`

Growth pressure is now durable, not just a live report. The backend keeps:

1. family-level alert episodes with persistence count
2. status history such as `open`, `acknowledged`, `snoozed`, `handled`, and `resolved`
3. governed response plans such as `notify`, `run_replay_diagnostics`, `schedule_molt_review`, and `generate_candidate_shell`

Important safeguard:

- alert-driven actions never auto-promote a shell
- candidate-shell generation creates an `experimental` model only
- replay gates still decide whether a shell hardens into active use

The `/ops` desk now exposes this as:

1. active pressured families
2. alert timeline
3. pending actions
4. acknowledge, snooze, handle, approve, and block controls

### Growth-pressure policies

- `GET /v1/operations/evolution/alert-policies`
- `POST /v1/operations/evolution/alert-policies`

Policies let each model family define how much weakness it can tolerate before the evolution loop escalates. A policy can tune:

1. pass-rate thresholds for low, medium, and high pressure
2. active-shell score thresholds
3. calibration-gap thresholds
4. how many cycles pressure must persist before diagnostics or candidate generation
5. whether candidate-shell generation requires operator approval

Example policy request body:

```json
{
  "family": "policy-shock",
  "persistence": {
    "medium_persistent_cycles": 1,
    "high_persistent_cycles": 1,
    "candidate_generation_cycles": 2
  },
  "actions": {
    "diagnostics_case_pack": "macro_plus_v1",
    "auto_queue_diagnostics": true,
    "auto_schedule_molt_review": true,
    "require_operator_approval_for_candidate_generation": true
  }
}
```

This is the governed-response layer that turns “the family looks weak” into “here is the policy, here is the pressure history, and here is the next safe action.”

### Model registry

Model versions can now be registered as first-class strategy objects instead of living only as free-text strings on predictions.

- `POST /v1/models`
- `GET /v1/models`
- `GET /v1/models/:modelVersion`

Each model record can store:

- family
- label
- description
- owner
- prompt profile
- lifecycle status
- feature flags

The model leaderboard will enrich version metrics with that registry metadata when it exists.

The prediction engine now supports profile-aware strategy variants. You can steer a registered model into a specific reasoning style with `feature_flags.strategy_profile` or `prompt_profile`:

- `baseline`
- `macro_dovish_sensitive`
- `policy_shock_sensitive`
- `contrarian_regime_aware`

If no explicit profile is registered, the engine will infer one from the `model_version` and registry metadata.

### External feed ingestion

`POST /v1/ingestion/feeds/pull`

This pulls RSS or Atom feed items into the finance memory cloud, stores them as sources with their original URLs, and can immediately parse them into events.

Example request body:

```json
{
  "feeds": [
    {
      "url": "https://example.com/feed.xml",
      "publisher": "Macro Wire",
      "max_items": 5,
      "source_type": "headline"
    }
  ],
  "parse_events": true
}
```

The ingestion layer will skip duplicate items when the same `raw_uri` has already been stored.

You can also run a script-based pull with:

- `npm run ops:pull-feeds`

Environment variables:

- `FEED_URLS` as comma-separated RSS/Atom URLs
- `FEED_MAX_ITEMS`
- `FEED_PARSE_EVENTS`

### Transcript and document ingestion

`POST /v1/ingestion/transcripts/pull`

This pulls long-form HTML or plain-text documents into the finance memory cloud, stores them as `transcript`, `speech`, `earnings`, or `filing` sources, and can immediately parse them into events.

Example request body:

```json
{
  "items": [
    {
      "url": "https://example.com/powell-transcript",
      "source_type": "speech",
      "speaker": "Jerome Powell",
      "publisher": "Macro Wire",
      "max_chars": 12000
    }
  ],
  "parse_events": true
}
```

Use this for:

- policy speech transcripts
- earnings-call transcripts
- long-form macro commentary pages
- filings or prepared remarks pages

The loader stores the original `raw_uri`, extracts the main readable text from the document, and skips duplicates when the same document URL is pulled again.

You can also run a script-based pull with:

- `npm run ops:pull-transcripts`

Environment variables:

- `TRANSCRIPT_URLS`
- `TRANSCRIPT_SOURCE_TYPE`
- `TRANSCRIPT_PUBLISHER`
- `TRANSCRIPT_SPEAKER`
- `TRANSCRIPT_MAX_CHARS`
- `TRANSCRIPT_PARSE_EVENTS`

### Live transcript sessions

This is the first live-analysis surface for speeches, interviews, and earnings calls while they are still happening.

Flow:

1. `POST /v1/transcript-sessions`
2. `POST /v1/transcript-sessions/:sessionId/chunks`
3. `GET /v1/transcript-sessions/:sessionId/analysis`
4. `POST /v1/transcript-sessions/:sessionId/close`

Each chunk append will:

- keep a rolling transcript window
- re-parse the active market event
- retrieve historical analogs
- regenerate calibrated predictions
- extract key live highlights

Example create request:

```json
{
  "source_type": "speech",
  "title": "Live Powell remarks",
  "speaker": "Jerome Powell",
  "publisher": "Macro Wire",
  "raw_uri": "https://example.com/live-powell-session",
  "model_version": "macro-live-v1",
  "horizons": ["1h", "1d"],
  "rolling_window_chars": 3000
}
```

Example chunk append:

```json
{
  "text": "Jerome Powell said the Fed is prepared to consider rate cuts if inflation continues to cool."
}
```

This is the best current backend path toward eventually handling:

- live TV/podcast/news transcript streams
- earnings-call monitoring
- ongoing policy speech analysis
- later voice-call integrations

### Live provider webhooks

`POST /v1/ingestion/live/webhooks/:provider`

This is the first direct adapter layer for external live transcription providers. Instead of running a custom fetch loop every time, providers can now push transcript events straight into the finance bot and let the backend:

1. create or reuse a live transcript session
2. bind an external stream key to that session durably
3. ignore low-signal partials when needed
4. append final transcript chunks into the rolling market-analysis loop
5. optionally close the session when the upstream stream ends

Supported providers right now:

- `generic`
- `deepgram`
- `assemblyai`

The binding memory is persistent, so repeated webhook calls with the same provider and external stream key will keep flowing into the same transcript session.

Verification options:

- `generic`: set `LIVE_INGEST_WEBHOOK_SECRET` and send `x-finance-superbrain-secret: <your-secret>`
- `deepgram`: set `DEEPGRAM_CALLBACK_TOKENS` and send a matching `dg-token` header
- `assemblyai`: set `ASSEMBLYAI_WEBHOOK_HEADER_NAME` and `ASSEMBLYAI_WEBHOOK_HEADER_VALUE`, then send that header/value pair

If provider-specific verification is not configured, the route falls back to `LIVE_INGEST_WEBHOOK_SECRET` when present.

Buffered delivery controls:

- `LIVE_INGEST_BUFFER_MIN_CHARS`
- `LIVE_INGEST_BUFFER_MAX_FRAGMENTS`
- `LIVE_INGEST_BUFFER_MAX_AGE_MS`

Final transcript fragments are now buffered per provider stream and only flushed into the reasoning engine when they become large enough, old enough, numerous enough, or the upstream stream closes. That keeps the live analysis loop calmer and avoids flooding it with tiny final fragments.

Example generic webhook body:

```json
{
  "stream_key": "powell-live-001",
  "source_type": "speech",
  "title": "Live Powell remarks",
  "speaker": "Jerome Powell",
  "publisher": "Macro Wire",
  "model_version": "macro-live-webhook-v1",
  "horizons": ["1h", "1d"],
  "text": "Jerome Powell said the Fed is prepared to consider rate cuts if inflation continues to cool.",
  "is_final": true
}
```

Example Deepgram-style body:

```json
{
  "type": "Results",
  "is_final": true,
  "metadata": {
    "request_id": "deepgram-trump-001",
    "title": "Trump BBC live hit",
    "speaker": "Donald Trump",
    "publisher": "BBC Business"
  },
  "channel": {
    "alternatives": [
      {
        "transcript": "Donald Trump said tariffs on China could rise further."
      }
    ]
  }
}
```

This route is the current best bridge between outside STT/news systems and the internal transcript-session analysis engine.

### Streaming transcript worker

`npm run ops:stream-transcript`

This worker consumes a continuous transcript feed and drives the live transcript session API automatically.

Use it when you already have a stream source such as:

- NDJSON transcript updates from a speech-to-text service
- server-sent events from a live newsroom or transcription pipeline
- newline-delimited plain text from a custom capture service

The worker will:

1. create or reuse a transcript session
2. read the incoming stream incrementally
3. buffer transcript fragments into meaningful chunks
4. append those chunks to `/v1/transcript-sessions/:sessionId/chunks`
5. optionally close the session when the stream ends

Supported formats:

- `ndjson`
- `sse`
- `plain`

Environment variables:

- `API_BASE_URL`
- `TRANSCRIPT_STREAM_URL`
- `TRANSCRIPT_STREAM_FORMAT`
- `TRANSCRIPT_STREAM_SESSION_ID`
- `TRANSCRIPT_STREAM_SOURCE_TYPE`
- `TRANSCRIPT_STREAM_TITLE`
- `TRANSCRIPT_STREAM_SPEAKER`
- `TRANSCRIPT_STREAM_PUBLISHER`
- `TRANSCRIPT_STREAM_SOURCE_URI`
- `TRANSCRIPT_STREAM_MODEL_VERSION`
- `TRANSCRIPT_STREAM_HORIZONS`
- `TRANSCRIPT_STREAM_WINDOW_CHARS`
- `TRANSCRIPT_STREAM_MIN_CHARS`
- `TRANSCRIPT_STREAM_CLOSE_ON_END`

If `TRANSCRIPT_STREAM_SESSION_ID` is not set, the worker will create a new live session from the `TRANSCRIPT_STREAM_*` metadata before the stream starts.

### Self-audit cycle

You can now run the main review loop as one operation:

- `POST /v1/operations/self-audit`
- `npm run ops:self-audit`

That cycle:

1. auto-scores matured predictions
2. writes post-mortems and lessons
3. captures a calibration snapshot
4. returns the current model-version leaderboard

### Operator dashboard

`GET /ops`

This is a lightweight internal dashboard for the intelligence engine. It pulls together:

- pipeline totals
- active live stream bindings
- buffered live fragment state
- a full source -> event -> analogs -> prediction -> outcome -> lesson -> calibration chain
- recent activity
- top themes
- mixed benchmark mission control
- benchmark family comparisons and regression alerts
- coverage-aware benchmark trust warnings
- live calibration plus saved calibration history
- model-version leaderboard
- lesson search

### Benchmark dashboard JSON

`GET /v1/dashboard/benchmarks`

This is the benchmark-focused JSON layer behind the `/ops` mission-control panels. It combines:

- latest and recent mixed-benchmark replay checkpoints
- latest and recent saved walk-forward checkpoints
- benchmark pack health and domain quota coverage
- family-by-family checkpoint deltas and stronger-prior baseline deltas
- recent walk-forward promotion checks
- walk-forward regression alerts
- benchmark-driven growth alerts
- coverage-aware benchmark trust warnings

Useful query:

- `GET /v1/dashboard/benchmarks?benchmark_pack_id=core_benchmark_v1`

### Intelligence pipeline JSON

`GET /v1/dashboard/pipeline`

This is the structured API behind the operator page. It returns recent cases with:

- source preview
- parsed event
- matched analogs
- prediction thesis and assets
- scored outcome
- stored lesson
- calibration signal

### Demo seed data

`npm run seed:demo`

This seeds a small reviewed finance memory set covering:

- China tariff risk
- China stimulus support
- dovish Fed commentary
- hot inflation shock

Use this with `REPOSITORY_BACKEND=postgres` if you want the seeded memory to persist and show up in the operator dashboard after the script exits.

### Historical backfill

`npm run backfill:historical`

This now loads a broader reviewed backfill pack through the historical case library pipeline, so each case is:

- stored durably in the historical case library
- labeled with merged manual and inferred metadata
- optionally ingested into reviewed memory for analogs, lessons, and calibration

The pack covers:

- China tariff risk
- China stimulus support
- dovish and soft-growth rate-cut cases
- hot and cooling inflation shocks
- OPEC and energy cases
- defense-spending cases
- semiconductor restriction and relief cases
- replay evaluation packs `macro_v1` and `macro_plus_v1`

This is the fastest way to make the memory cloud dense enough for analog retrieval, calibration, and the operator desk to become meaningful.

### Historical case library

The historical case library is the durable training-ground layer for the superbrain.

- `POST /v1/ingestion/historical/library`
- `GET /v1/ingestion/historical/library`
- `npm run ops:import-historical-library`

Each library case stores:

- the raw source payload
- parsed event structure
- realized moves and timing alignment
- merged manual and inferred labels
- review metadata such as reviewer, review notes, and adjudication timestamps
- review hints for operators before adjudication
- durable case-pack membership for later benchmarking

Fresh library imports now default to `draft` quality unless:

- you explicitly set `labels.case_quality`
- or you ingest the case straight into reviewed memory, which promotes it to `reviewed`

Example ingestion body:

```json
{
  "items": [
    {
      "case_id": "library-chip-crackdown",
      "case_pack": "policy_lab",
      "source": {
        "source_type": "headline",
        "title": "Chip export restrictions tighten",
        "raw_text": "New export control language on advanced AI chips raised concern for semiconductor demand and supply-chain access."
      },
      "horizon": "1d",
      "realized_moves": [
        { "ticker": "NVDA", "realized_direction": "down", "realized_magnitude_bp": -128 }
      ],
      "timing_alignment": 0.78,
      "dominant_catalyst": "export-controls",
      "labels": {
        "tags": ["manual_case", "semis"],
        "regions": ["global"]
      }
    }
  ],
  "store_library": true,
  "ingest_reviewed_memory": true,
  "fallback_model_version": "historical-library-v1",
  "labeling_mode": "merge"
}
```

Labeling modes:

- `merge`: combine your manual labels with inferred labels from the parser
- `manual_only`: trust only operator-provided labels
- `inferred_only`: use the parser-derived labels only

This is the main path for turning curated historical finance cases into durable training and replay assets.

### Core historical corpus import

The project now has a consolidated importer for the reviewed multi-domain corpus that powers the mixed benchmark packs.

- `POST /v1/ingestion/historical/core-corpus`
- `npm run ops:import-core-corpus`

By default it imports:

- the broader `macro_plus_v1` reviewed backfill pack
- `macro_calendar_v1`
- `earnings_v1`
- `policy_fx_v1`
- `energy_v1`
- `credit_v1`

That gives the superbrain a denser reviewed memory base in one step instead of requiring six separate import commands.

Example request body:

```json
{
  "store_library": true,
  "ingest_reviewed_memory": true,
  "fallback_model_version": "core-corpus-loader-v1"
}
```

Useful environment variables for the CLI:

- `CORE_CORPUS_INCLUDE_BACKFILL=true`
- `CORE_CORPUS_BACKFILL_CASE_PACK=macro_plus_v1`
- `CORE_CORPUS_INCLUDE_MACRO=true`
- `CORE_CORPUS_MACRO_CASE_PACK=macro_calendar_v1`
- `CORE_CORPUS_INCLUDE_EARNINGS=true`
- `CORE_CORPUS_EARNINGS_CASE_PACK=earnings_v1`
- `CORE_CORPUS_INCLUDE_POLICY_FX=true`
- `CORE_CORPUS_POLICY_CASE_PACK=policy_fx_v1`
- `CORE_CORPUS_INCLUDE_ENERGY=true`
- `CORE_CORPUS_ENERGY_CASE_PACK=energy_v1`
- `CORE_CORPUS_INCLUDE_CREDIT=true`
- `CORE_CORPUS_CREDIT_CASE_PACK=credit_v1`
- `CORE_CORPUS_STORE=true`
- `CORE_CORPUS_INGEST_REVIEWED_MEMORY=true`
- `CORE_CORPUS_FALLBACK_MODEL_VERSION=core-corpus-loader-v1`
- `CORE_CORPUS_LABELING_MODE=merge`

This is the fastest way to give the mixed benchmark history, regression tracking, and scheduled evolution loop a materially richer reviewed finance memory.

### Historical library coverage

The historical library now has a dedicated coverage report so operators can see whether the superbrain's memory is broad enough and trustworthy enough before leaning on replay or promotion.

- `GET /v1/metrics/historical-library`
- `npm run ops:historical-library-coverage`

The report summarizes:

- total stored library cases
- draft vs reviewed vs high-confidence balance
- review-queue burden, including assigned vs unassigned drafts
- density by case pack, event family, regime, source type, region, theme, and horizon

Example request:

```text
GET /v1/metrics/historical-library?top=6
```

Useful env variable for the CLI:

- `HISTORICAL_LIBRARY_COVERAGE_TOP=8`

### Historical library gap alerts

The library also now has a gap report that translates coverage into action by flagging thin domains, thin regimes, review bottlenecks, weak source diversity, and missing high-confidence memory.

- `GET /v1/metrics/historical-library/gaps`
- `npm run ops:historical-library-gaps`

This report is meant to answer:

- which finance domains are still underrepresented
- which market regimes are still too thin for trustworthy timed validation
- whether the review queue is blocking trusted memory growth
- whether the library has enough source-format diversity to generalize well
- what should be imported or adjudicated next

The gap report now includes regime-specific warnings too, so it can tell you not just which domains are thin, but which market states are still underrepresented.

Examples:

- `rate_hiking`
- `rate_cutting`
- `china_stimulus`
- `tariff_escalation`
- `energy_shock`
- `banking_stress`
- `ai_momentum`
- `earnings_reset`

### Regime-aware high-confidence seeding

The high-confidence seeding flow now prioritizes the regimes the gap report says are still thin, and it can now also follow walk-forward regime weakness from a chosen benchmark pack.

- `POST /v1/operations/historical-library/seed-high-confidence`
- `POST /v1/operations/benchmark-trust-refresh`
- `npm run ops:seed-high-confidence`
- `npm run ops:benchmark-trust-refresh`

New request fields:

- `benchmark_pack_id`
- `prioritize_gap_regimes`
- `prioritize_walk_forward_regimes`
- `target_regimes`

New response fields:

- `prioritized_regimes`
- `promoted_regimes`

So the memory-hardening loop can now answer:

- which weak regimes it targeted
- which regimes actually received new high-confidence cases
- whether trust refresh is broadening the strongest memory tier or only deepening what was already strong

### Macro calendar historical loader

The first source-specific historical loader is now live for high-value US macro cases:

- `POST /v1/ingestion/historical/macro-calendar`
- `npm run ops:import-macro-library`

Supported preset types:

- `cpi`
- `nfp`
- `fomc`
- `fed_speech`

Each preset automatically supplies:

- a finance-specific source template
- default tags, regimes, regions, and primary assets
- review hints for operators
- a structured case family for later replay and tuning

Example request body:

```json
{
  "items": [
    {
      "case_id": "macro-loader-cpi-hotter",
      "case_pack": "macro_loader_lab",
      "event_type": "cpi",
      "signal_bias": "hotter",
      "summary": "Core CPI stayed sticky enough to push yields higher and pressure long-duration growth into the close.",
      "realized_moves": [
        { "ticker": "TLT", "realized_direction": "down", "realized_magnitude_bp": -58 },
        { "ticker": "QQQ", "realized_direction": "down", "realized_magnitude_bp": -81 },
        { "ticker": "DXY", "realized_direction": "up", "realized_magnitude_bp": 31 }
      ],
      "timing_alignment": 0.83
    }
  ],
  "store_library": true,
  "ingest_reviewed_memory": false,
  "fallback_model_version": "macro-loader-v1",
  "labeling_mode": "merge"
}
```

Signal-bias values include:

- `hotter`
- `cooler`
- `stronger`
- `softer`
- `dovish`
- `hawkish`
- `mixed`
- `neutral`

This loader is the first domain-aware path for scaling historical memory without hand-formatting every macro case.

### Earnings historical loader

The second source-specific loader is now live for earnings and call-transcript style cases:

- `POST /v1/ingestion/historical/earnings`
- `npm run ops:import-earnings-library`

Supported preset types:

- `earnings_beat`
- `earnings_miss`
- `guidance_raise`
- `guidance_cut`
- `ai_capex_upside`
- `margin_pressure`
- `consumer_weakness`
- `cloud_slowdown`
- `management_tone_shift`

Each earnings preset automatically adds:

- company and ticker aware tags
- peer and sector-aware default assets
- forward-guidance oriented review hints
- a structured event family for replay and tuning

Example request body:

```json
{
  "items": [
    {
      "case_id": "earnings-loader-guidance-cut",
      "case_pack": "earnings_loader_lab",
      "event_type": "guidance_cut",
      "signal_bias": "negative",
      "company": "Nike",
      "ticker": "NKE",
      "sector": "consumer_discretionary",
      "peers": ["XLY", "LULU"],
      "summary": "Management cut the forward outlook and pointed to weaker traffic, more promotions, and a softer consumer setup than expected.",
      "realized_moves": [
        { "ticker": "NKE", "realized_direction": "down", "realized_magnitude_bp": -118 },
        { "ticker": "XLY", "realized_direction": "down", "realized_magnitude_bp": -31 },
        { "ticker": "XRT", "realized_direction": "down", "realized_magnitude_bp": -46 }
      ],
      "timing_alignment": 0.76
    }
  ],
  "store_library": true,
  "ingest_reviewed_memory": false,
  "fallback_model_version": "earnings-loader-v1",
  "labeling_mode": "merge"
}
```

This is the next major memory domain after macro. It gives the superbrain structured company-specific history, not just regime history.

### Energy / commodity shock historical loader

The fourth source-specific loader is now live for OPEC, oil, gas, and broader energy-complex shock cases:

- `POST /v1/ingestion/historical/energy`
- `npm run ops:import-energy-library`

Supported preset types:

- `opec_cut`
- `opec_raise`
- `supply_disruption`
- `inventory_draw`
- `inventory_build`
- `gas_spike`
- `demand_shock`

Each energy preset automatically adds:

- commodity-specific default assets like crude, gas, and energy ETFs
- supply-vs-demand aware event families
- review hints for inflation spillover, cyclicals, and cross-asset confirmation
- structured tags and regimes for replay and tuning

Example request body:

```json
{
  "items": [
    {
      "case_id": "energy-loader-opec-cut",
      "case_pack": "energy_loader_lab",
      "event_type": "opec_cut",
      "signal_bias": "bullish",
      "market": "crude_oil",
      "region": "middle_east",
      "producer": "OPEC+",
      "focus_assets": ["XLE"],
      "summary": "OPEC+ signaled a surprise output cut that tightened prompt crude balances and lifted inflation-sensitive energy assets.",
      "realized_moves": [
        { "ticker": "CL=F", "realized_direction": "up", "realized_magnitude_bp": 141 },
        { "ticker": "XLE", "realized_direction": "up", "realized_magnitude_bp": 58 },
        { "ticker": "USO", "realized_direction": "up", "realized_magnitude_bp": 122 }
      ],
      "timing_alignment": 0.84
    }
  ],
  "store_library": true,
  "ingest_reviewed_memory": false,
  "fallback_model_version": "energy-loader-v1",
  "labeling_mode": "merge"
}
```

This adds a distinct cross-asset memory regime to the superbrain: commodity and energy shocks that can spill into inflation, cyclicals, and macro risk sentiment.

### Credit / banking stress historical loader

The fifth source-specific loader is now live for banking stress, funding shocks, spread widening, and credit contagion cases:

- `POST /v1/ingestion/historical/credit-banking`
- `npm run ops:import-credit-library`

Supported preset types:

- `bank_run`
- `deposit_flight`
- `liquidity_backstop`
- `credit_spread_widening`
- `default_shock`
- `banking_contagion`
- `downgrade_wave`

Each credit preset automatically adds:

- bank and credit-aware default assets like `KRE`, `XLF`, `HYG`, `LQD`, and `TLT`
- structured event families for financial-stress and credit-cycle replay
- review hints around contagion, policy response, and spread confirmation
- a dedicated memory domain for crisis-style finance cases

Example request body:

```json
{
  "items": [
    {
      "case_id": "credit-loader-spread-widening",
      "case_pack": "credit_loader_lab",
      "event_type": "credit_spread_widening",
      "signal_bias": "negative",
      "institution": "US high-yield market",
      "region": "united_states",
      "focus_assets": ["HYG"],
      "summary": "High-yield spreads widened sharply on funding concerns, weighing on lower-quality credit and financial risk appetite.",
      "realized_moves": [
        { "ticker": "HYG", "realized_direction": "down", "realized_magnitude_bp": -79 },
        { "ticker": "LQD", "realized_direction": "down", "realized_magnitude_bp": -31 },
        { "ticker": "XLF", "realized_direction": "down", "realized_magnitude_bp": -26 }
      ],
      "timing_alignment": 0.8
    }
  ],
  "store_library": true,
  "ingest_reviewed_memory": false,
  "fallback_model_version": "credit-loader-v1",
  "labeling_mode": "merge"
}
```

This gives the superbrain a dedicated crisis-memory domain for bank runs, funding stress, and credit contagion instead of forcing those cases into generic macro or policy buckets.

### Policy / FX / sovereign historical loader

The third source-specific loader is now live for sovereign policy shocks, FX interventions, and cross-border policy events:

- `POST /v1/ingestion/historical/policy-fx`
- `npm run ops:import-policy-library`

Supported preset types:

- `trade_escalation`
- `trade_relief`
- `stimulus_support`
- `fx_intervention`
- `capital_controls`
- `sovereign_credit`
- `fiscal_shock`
- `regulatory_crackdown`
- `sanctions`
- `geopolitical_deescalation`

This loader is general on purpose. It is not a China-only branch. It covers:

- China policy and yuan cases
- Japan FX intervention
- sovereign and fiscal shocks like the UK gilt-style scenario
- sanctions and regulatory events
- broader cross-border policy relief or escalation

Example request body:

```json
{
  "items": [
    {
      "case_id": "policy-loader-yen-intervention",
      "case_pack": "policy_loader_lab",
      "event_type": "fx_intervention",
      "signal_bias": "supportive",
      "country": "Japan",
      "region": "asia",
      "currency_pair": "USD/JPY",
      "focus_assets": ["EWJ"],
      "summary": "Officials intervened to support the yen after disorderly depreciation, pulling USD/JPY lower and changing the path for Japan-sensitive risk assets.",
      "realized_moves": [
        { "ticker": "USD/JPY", "realized_direction": "down", "realized_magnitude_bp": -143 },
        { "ticker": "EWJ", "realized_direction": "down", "realized_magnitude_bp": -34 },
        { "ticker": "DXY", "realized_direction": "down", "realized_magnitude_bp": -18 }
      ],
      "timing_alignment": 0.77
    }
  ],
  "store_library": true,
  "ingest_reviewed_memory": false,
  "fallback_model_version": "policy-loader-v1",
  "labeling_mode": "merge"
}
```

This gives the superbrain a general cross-border policy memory family that sits between macro regime events and company-specific earnings events.

### Historical case review and adjudication

The library now has a review workflow for turning raw stored cases into trusted replay assets.

- `GET /v1/ingestion/historical/library?needs_review=true`
- `GET /v1/ingestion/historical/library/:caseId`
- `POST /v1/ingestion/historical/library/:caseId/review`

This lets you:

- pull a review queue of draft cases
- edit labels and competing catalysts
- change the case pack after adjudication
- record reviewer identity and notes
- raise or lower case quality between `draft`, `reviewed`, and `high_confidence`
- optionally ingest the adjudicated case into reviewed memory

Example review body:

```json
{
  "case_pack": "macro_reviewed_lab",
  "case_quality": "high_confidence",
  "reviewer": "macro-ops",
  "review_notes": "Confirmed the dovish signal and clean follow-through in bonds and growth.",
  "labels": {
    "competing_catalysts": ["labor-softness", "bond-rally"],
    "tags": ["manual_reviewed", "fed"]
  },
  "ingest_reviewed_memory": true,
  "model_version": "historical-library-review-v1"
}
```

This is the quality-control layer that keeps the superbrain from learning equally from clean cases and noisy ones.

### High-confidence case promotion

- `GET /v1/metrics/historical-library/high-confidence-candidates`
- `POST /v1/ingestion/historical/library/:caseId/promote-high-confidence`
- `POST /v1/operations/historical-library/seed-high-confidence`
- `npm run ops:seed-high-confidence`

This adds a guarded graduation path into the strongest benchmark trust tier. Instead of manually guessing which reviewed cases deserve `high_confidence`, the system now scores each reviewed case on evidence completeness and review quality.

The candidate report looks at things like:

- reviewer presence
- review-note depth
- manual or hybrid label support
- competing catalyst coverage
- realized move breadth
- timing alignment

Promotion is blocked when a case is still too thin, and the API returns the candidate score plus explicit blockers so the operator knows what still needs work.

This is important because mixed benchmarks and trust warnings now have a real path for increasing the strongest evidence tier, instead of only telling us that `high_confidence` memory is missing.

The batch seed operation is the fastest way to create the first strong `high_confidence` layer from the reviewed core corpus. It:

- scans reviewed cases from the core historical packs
- adds deterministic review notes and hints based on the case structure
- fills in competing catalysts when they were missing from the curated seed case
- promotes only the candidates that still clear the configured score threshold

Useful environment variables for the CLI:

- `HIGH_CONFIDENCE_REVIEWER`
- `HIGH_CONFIDENCE_CASE_PACKS`
- `HIGH_CONFIDENCE_LIMIT`
- `HIGH_CONFIDENCE_MIN_SCORE`
- `HIGH_CONFIDENCE_DRY_RUN`
- `HIGH_CONFIDENCE_INGEST_REVIEWED_MEMORY`
- `HIGH_CONFIDENCE_MODEL_VERSION`

### Historical ingest API

`POST /v1/ingestion/historical/batch`

This route ingests reviewed historical cases directly through the API. It is useful when you want to load curated event/outcome datasets from a script, notebook, or later from external finance data pipelines.

The newer historical library route is the better long-term path when you also want durable case metadata and replayable labeled memory.

### Current backend state

- tests and local development run in-memory by default
- durable local storage is now available through the PGlite repository
- durable storage is available through the Postgres repository
- automatic market scoring is available through the mock backend now
- Yahoo-based market pulls are implemented for a first real data path
