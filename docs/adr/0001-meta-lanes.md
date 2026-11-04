# 0001 · Models by role, through Meta lanes

Status: accepted · 2026-11-04

## Context

Pactovio makes about a dozen kinds of model call. They range from a 400-token email classification to a native read of a 40-page RFQ pack. Hard-coding a model id at each call site would make a model upgrade, an effort change or a withdrawn model a code change across many packages. Commercial documents also must never reach a model whose prompts Meta may train on.

## Decision

- **Roles, not ids.** Code asks for a role: `reason`, `agent`, `fast` or `vision`. Configuration maps each role to `<provider>:<model>[@effort]` through `LANE_<ROLE>` (`packages/models/src/providers.ts`, `apps/api/wrangler.toml:15-18`).
- **All four production lanes are Muse Spark 1.3.** They differ in effort: `high` for reading the RFQ, `medium` for the agent and vision, `minimal` for classification.
- **Specialist models through the same package.** Muse Wonder, SAM 3.1, Muse Image and Voice Transcribe have their own clients in `packages/models/src` and share the budget and error handling.
- **Contributor models refused.** The lane parser rejects any id containing `contributor` before a request is built.
- **Reasoning headroom.** It is added to `max_tokens` per effort, because Spark counts reasoning tokens inside the cap.
- **Withdrawn ids.** A 404 for a model id falls back to `muse-spark-1.2` for chat and vision.

## Consequences

- Changing a model or an effort is a one-line config change, and it is checked by `packages/models/test/providers.test.ts`.
- The registry also knows Fireworks, Baseten and Modal, so a customer could move a role to open weights on their own endpoint. This is **not running**: CI fails if a production lane leaves the `meta` provider (`scripts/ci-guards.sh`).
- Every step record carries `provider:model`, so the interface shows the model that actually answered, including a fallback.

## Rejected

- **Model ids at call sites.** Every upgrade would be a code change.
- **A gateway service.** It adds a network hop and another secret, and it would duplicate the spend cap that already lives in the client ([0006](0006-spend-cap-in-fetch.md)).
