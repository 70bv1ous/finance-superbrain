# Public Pilot Runbook

This runbook is the operator path for the hosted Finance Superbrain pilot.

## Current Hosted Targets

- Web: `https://finance-superbrain-web.vercel.app`
- API: `https://sincere-smile-production-9c3f.up.railway.app`

## When To Run The Smoke

Run the hosted smoke check:

- after a push that deploys to Railway or Vercel
- before a pilot or investor walkthrough
- after changing Railway, Vercel, auth, CORS, cookie, seed, or database settings
- after restoring or reseeding the hosted Postgres database

## Commands

Use the hosted default wrapper:

```bash
npm run demo:public-pilot:smoke:hosted
```

The ops alias runs the same check:

```bash
npm run ops:public-pilot:smoke
```

Override either target when testing a preview:

```bash
PUBLIC_PILOT_WEB_URL=https://finance-superbrain-web.vercel.app PUBLIC_PILOT_API_URL=https://example-api.up.railway.app npm run demo:public-pilot:smoke:hosted
```

## What Passing Means

The smoke verifies:

- public web shell returns `200`
- login page returns `200` and includes API bootstrap metadata
- API `/health` returns healthy liveness
- API `/ready` returns healthy dependency readiness
- `/v1/auth/bootstrap` responds from the hosted web origin
- seeded demo account login works
- hosted auth cookie includes `SameSite=None` and `Secure`
- authenticated workspace state contains seeded investigation, decision, and portfolio data

## Failure Guide

- `public shell` fails: Vercel deployment, domain, or production build is broken.
- `login page` fails: Vercel build or `NEXT_PUBLIC_API_URL` is likely wrong or missing.
- `api health` fails: Railway API process, container start, or routing is down.
- `api readiness` fails: hosted dependency readiness is broken, usually Postgres, migrations, or runtime env.
- `workspace bootstrap` fails: CORS, allowed origins, or API route startup is broken.
- `seeded account login` fails: auth env, hosted cookie settings, CORS, or deterministic seed state is wrong.
- `authenticated workspace state` fails: login worked, but seeded workspace data is missing or incomplete.

## Recovery Order

1. Check Railway deploy status and API logs.
2. Confirm Railway env includes `REPOSITORY_BACKEND=postgres`, `DATABASE_URL`, `AUTH_COOKIE_SAME_SITE=none`, `AUTH_COOKIE_SECURE=true`, and `AUTH_ALLOWED_ORIGINS=https://finance-superbrain-web.vercel.app`.
3. Confirm Vercel env includes `NEXT_PUBLIC_API_URL` pointing to the current hosted API URL.
4. Run hosted database migrations.
5. Seed deterministic demo proof data only when it is safe to refresh the hosted pilot workspace.
6. Rerun `npm run demo:public-pilot:smoke:hosted`.

## Boundaries

- Obsidian remains local-first. The hosted app does not write to the vault.
- Use `npm run ops:obsidian-local:export` when showing the visible second brain.
- `/health` is lightweight liveness. Use `/health?detail=operations` or `/ready` when diagnosing dependencies and runtime operations.
