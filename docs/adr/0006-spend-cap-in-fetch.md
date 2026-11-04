# 0006 · Spend cap and kill switch inside the model client's fetch

Status: accepted · 2026-11-04

## Context

Model calls come from routes, Durable Object chat turns, five Workflows, two crons and webhooks, with retries and fallbacks at several layers. A cap checked at call sites would miss some path.

## Decision

- **Inside fetch.** Every OpenAI-SDK client is built with `budgetedFetch` (`packages/models/src/client.ts`, `budget.ts`). Per-unit models use `metered()` (`meta-http.ts`).
- **Kill switch.** Each request first checks `MODELS_DISABLED`, or the KV key `config:models_disabled`, which flips without a deploy.
- **Reserve.** It then reserves its worst-case cost (prompt plus full `max_tokens` at list price) with one atomic D1 upsert that refuses to pass `MODEL_DAILY_CAP_USD`.
- **Settle.** The reservation is corrected to the `usage` the response reports, read from the final SSE chunk for streams. A failed request is refunded.
- **Refusal.** A refusal is HTTP 402 with code `cap_daily` or `models_off`. Callers rethrow it and never fall back to another model.

## Consequences

- No path can overspend, including fallbacks and retries. The production cap is $20 a day and resets at 08:00 MYT.
- Concurrent requests cannot both pass the cap, because the check and the add are one SQL statement.
- An unknown model id is charged at the highest known price, so a misconfiguration can only overcount.

## Rejected

- **Provider-side budget alerts.** They arrive after the money is spent.
