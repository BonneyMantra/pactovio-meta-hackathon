# Contributing

## Setup

Requirements: Node 22 or newer (CI uses 24) and npm. Wrangler is a dev dependency, so there is nothing to install globally.

```bash
npm ci
npm run check        # repository guards, then tsc --noEmit, then vitest: exactly what CI runs
```

The suite needs no secrets and no network. Model, connector and payment calls are answered by recorded wire-format payloads. D1, R2 and KV are local (Miniflare), and every migration in `apps/api/migrations` is applied to a fresh database for each suite.

## Run the API locally

```bash
cd apps/api
cp /dev/null .env.local            # gitignored; add META_API_KEY=… (and COMPOSIO_API_KEY, RESEND_API_KEY to use those features)
npm run db:migrate:local           # applies migrations to the local D1 behind the DB binding
PORT=8788 npm run dev              # dev.sh builds .dev.vars from .env.local, then runs wrangler dev
curl localhost:8788/api/health
```

The front end is static (`apps/front/public`). `_worker.js` forwards `/api/*` to the Worker over a service binding.

To run the proposal pipeline live on the Meta models against local storage, use `apps/api/scripts/proposal-live.ts`. It costs about $0.15–$0.50 per run, with a $5 cap. See the header of the script for usage.

## Scripts

| Command | What it does |
|---|---|
| `npm run check` | Guards, typecheck and tests |
| `npm test` | Vitest, all workspaces |
| `npm run typecheck` | `tsc --noEmit` over apps and packages |
| `npm run guards` | `scripts/ci-guards.sh` |
| `npm run dev:api` | Local Worker on :8787 |
| `npm run db:migrate:local` | Apply D1 migrations locally |

## Conventions

- **Models.** Call models only through `packages/models`. Ask for a role (`reason`, `agent`, `fast` or `vision`), not a model id. Never use a `*-contributor` model; the lane parser refuses them. See [docs/MODELS.md](docs/MODELS.md).
- **Numbers in code.** Prices, totals, scores and verdicts are computed in code, never by a model. See [ADR 0003](docs/adr/0003-rubric-scored-in-code.md).
- **Validation and errors.** Use zod at every boundary. API errors are `{ error, code? }` and never contain a stack trace or database text.
- **Tenancy.** Every query binds the session's `workspace_id`. A foreign id returns 404. Add a tenant-isolation test with any new route.
- **Style.**
  - Files stay under 300 lines.
  - No `console.log` in production code.
  - Use realistic data in fixtures.
- **Secrets.** Never commit secrets. Local secrets go in `apps/api/.env.local`, which is gitignored, and CI fails on tracked env files.
- **Commits.** Make small commits, staging explicit paths. CI must be green on `main`.

## Decisions

Record a significant design decision as an ADR in `docs/adr/`, numbered in order. Give its context, the decision, the consequences and what was rejected.
