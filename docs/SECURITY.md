# Security

Pactovio holds companies' commercial documents: catalogues with prices, past proposals and buyer RFQs. These are the boundaries in the code that keep those documents private. To report a vulnerability, open a private security advisory on the GitHub repository rather than a public issue.

## Tenant isolation

- **A workspace comes only from the session.** `customerAuth` (`apps/api/src/lib/customer-session.ts`) resolves the session cookie to one workspace. It joins `customer_sessions` → `workspace_members` → `workspaces`. Handlers receive `auth.workspaceId` from the typed router (`apps/api/src/lib/router.ts`). No route takes a workspace id from the request.
- **Every query binds `workspace_id`.**
  - A foreign id returns 404, not 403, so ids cannot be enumerated (`packages/proposal/src/store.ts`).
  - Brain progress events are selected by run *and* workspace (`apps/api/src/routes/brain.ts`).
  - R2 assets are served only after ownership is checked, and only if the name matches `^[\w.-]{1,80}$`.
- **Forged headers are overwritten.** The WebSocket forward into the agent's Durable Object sets `x-pv-workspace` and `x-pv-session` from the verified session. Any value the client sent is replaced (`apps/api/src/routes/agent.ts:50-51`).
- **Connected accounts are per workspace.** Composio accounts belong to the user `pactovio-workspace-{id}`. An account that another workspace connected is never shared (`packages/connectors/src/accounts.ts`).
- **Proved by tests.** More than 30 named tests cover reads, writes, exports, R2, MCP, API keys, agent tools, catalogue matching and autopilot. They are listed in [EVALS.md](EVALS.md#tenant-isolation).

## Sign-in and sessions

- **Email code** (`apps/api/src/routes/customer-auth.ts`, `apps/api/src/lib/customer-security.ts`):
  - Six digits, valid for 10 minutes, single use.
  - At most five attempts, counted atomically.
  - Stored as HMAC-SHA256 keyed with `AUTH_SECRET`, which must be at least 32 characters.
  - Resend is blocked for 60 s.
  - Rate limits per hashed IP and per email.
- **Session** (`customer-session.ts`):
  - The `pv_customer` cookie is `HttpOnly`, `Secure` and `SameSite=Lax`, for 30 days.
  - The database stores only `sha256(token)`.
  - A new sign-in revokes the previous session.
- **Same-origin writes.** Every non-GET request and the whole auth router must carry an `Origin` in `PUBLIC_ORIGIN` or `EXTRA_ORIGINS`. `sec-fetch-site: cross-site` is rejected (`customer-security.ts`).
- **API keys** (`apps/api/src/routes/apikeys.ts`, `apps/api/src/lib/auth.ts`):
  - Format `pk_` plus 20 random bytes.
  - Only the SHA-256 hash and an 11-character prefix are stored. The key is shown once.
  - At most 10 keys per workspace. Revoking a key checks the workspace.

## OAuth callback verifier (Composio)

Production refuses to connect a customer account unless `COMPOSIO_CALLBACK_VERIFIER_ENABLED` is `true` (`apps/api/wrangler.toml`, `packages/connectors/src/accounts.ts`). The callback (`/api/connectors/verifier`, completed in `apps/api/src/lib/integration-connections.ts`) must pass every check:

1. A `state` of 32 random bytes is stored only as a hash. It expires after 10 minutes and works once. It is bound to the session, workspace, origin and a pending connection.
2. The HttpOnly cookie must match the state. `apps/api/src/lib/oauth-dispatch.ts` sends the callback to the right flow by cookie.
3. `completeAuth` must return the expected connected-account id and toolkit.
4. The account must be `ACTIVE` and owned by `pactovio-workspace-{id}`.
5. Consuming the state and activating the account happen in one D1 batch. Any failure redirects to `status=failed`.

## Webhooks

- **Composio** (`packages/connectors/src/signature.ts`, `webhook.ts`):
  - HMAC-SHA256 over `{id}.{timestamp}.{rawBody}`.
  - Timestamps more than 300 s old are rejected.
  - The comparison is constant time and rotated signatures are accepted.
  - A missing secret returns 503. A bad signature returns 401.
  - Deliveries are deduplicated per webhook id for 24 hours and per message for 7 days.
- **Dodo Payments** (`apps/api/src/routes/inbound-dodo.ts`): Standard Webhooks verification, idempotent on `webhook-id`. Billing is in test mode.

## Untrusted input

- **Validation.** Route params, query strings and bodies are parsed with zod, and body size is capped (`apps/api/src/lib/router.ts`, `route-auth.ts`).
- **Errors.** Errors return `{ error, code }`. An unhandled error becomes a generic 500 `internal` with no stack trace and no database text.
- **Email.** The classifier prompt states that the email is untrusted (`packages/connectors/src/classify.ts`). Autopilot can create drafts only, because the Gmail action catalogue has no send action (`packages/connectors/src/catalog.ts`).
- **Fetching public URLs.** Product images and company sites are fetched through an SSRF guard, `fetchPublic` (`apps/api/src/lib/site-guard.ts`). Images must be PNG, JPEG or WebP up to 5 MB (`apps/api/src/lib/brain-catalogue.ts`). The guard is covered by `apps/api/test/site-guard.test.ts`.
- **Rendered proposals.** The HTML has a CSP of `default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'`. It has no scripts, its text is escaped, and it is sent with `no-store` (`packages/proposal/src/html.ts`).

## Model-specific safeguards

- **No contributor models.** Meta may train on prompts sent to `*-contributor` models, so any lane naming one is rejected at parse time (`packages/models/src/providers.ts:35-36`). The CI guard also checks `wrangler.toml`. See [MODELS.md](MODELS.md#contributor-mode-models-are-refused-in-code).
- **Spend.** A hard daily cap ($20 in production) and a kill switch that needs no deploy (`packages/models/src/budget.ts`). Budget refusals are never retried on another model.
- **Grounding.**
  - Generated proposals pass a claim check in code. Unsupported sentences are struck and listed (`packages/proposal/src/claims.ts`).
  - Prospects are kept only when their source URL came from the search itself (`apps/api/src/lib/prospects.ts`).
  - Tender scores drop any SKU or past proposal that is not in the workspace's own data (`apps/api/src/lib/opportunity-rubric.ts`).

## Secrets

- `wrangler.toml` `[vars]` holds only non-secret configuration: lanes, origins, the cap, the kill switch and the verifier flag.
- Secrets are Worker secrets, declared by name in `packages/contracts/src/env.ts`: `AUTH_SECRET`, `META_API_KEY`, `COMPOSIO_API_KEY`, `COMPOSIO_WEBHOOK_SECRET`, `RESEND_API_KEY`, `DODO_PAYMENTS_API_KEY`, `DODO_WEBHOOK_SECRET`, `WEBHOOK_SIGNING_SECRET`, plus the unused open-weights provider keys.
- Locally, `apps/api/dev.sh` builds `.dev.vars` from a gitignored `.env.local`. Cloudflare deploy credentials are kept out of the Worker.
- CI uses no secrets. `scripts/ci-guards.sh` fails the build if a `.env` or `.dev.vars` file is tracked, or if a token-shaped string (GitHub, OpenAI-style, AWS) appears in any tracked file.
