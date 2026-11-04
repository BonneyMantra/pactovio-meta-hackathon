# Models: lanes, effort, guards and cost

Every model call in Pactovio goes to the Meta Model API (`https://api.meta.ai/v1`). This page explains how a call picks its model, how spend is bounded, and what happens when a model is not served. All paths are relative to the repository root.

## Five Meta models, one client package

| Model | Id | Client | Called through |
|---|---|---|---|
| Muse Spark 1.3 | `muse-spark-1.3` | `packages/models/src/chat.ts`, `json.ts`, `tool-loop.ts` | chat completions, strict `json_schema` output, tool calls, Responses `web_search` |
| Muse Wonder 1.0 | `muse-wonder-1.0` | `packages/models/src/wonder.ts` | the same chat and tool-calling endpoint; only the model id changes |
| SAM 3.1 | `sam-3.1` | `packages/models/src/sam.ts` | `POST /responses`, streamed, one text concept and one image per call |
| Muse Image 1.0 | `muse-image-1.0` | `packages/models/src/image.ts` | `/images/generations` and `/images/edits` |
| Muse Voice Transcribe 1.0 | `muse-voice-transcribe-1.0` | `packages/models/src/voice.ts` | `/asr/transcribe`, multipart WAV, at most 600 s and 32 MB |

Nothing else is imported. `apps/api/test/meta-only.test.ts` scans every source file under `apps/api/src`, `apps/front/public` and `packages/*/src`, and fails if any of them calls a non-Meta search vendor.

## Lanes: a role, not a model id, in the code

Code asks for a **role**. Configuration maps that role to a model:

```
LANE_<ROLE> = <provider>:<model>[@<reasoning_effort>]
```

| Role | Production lane (`apps/api/wrangler.toml:15-18`) | Used for |
|---|---|---|
| `reason` | `meta:muse-spark-1.3@high` | Native read of the RFQ pack with page citations (`packages/proposal/src/read.ts`), bill-of-materials narrative (`bom.ts`) |
| `agent` | `meta:muse-spark-1.3@medium` | Chat tool loop (`packages/agent/src/loop.ts`), eligibility, solution selection, architecture, compliance (`packages/proposal/src/*`), prospects `web_search` (`apps/api/src/lib/prospects.ts`) |
| `fast` | `meta:muse-spark-1.3@minimal` | Inbound mail classification (`packages/connectors/src/classify.ts`), tender capability profile (`apps/api/src/lib/opportunity-profile.ts`) |
| `vision` | `meta:muse-spark-1.3@medium` | Naming SAM 3.1 boxes on a floor plan (`packages/proposal/src/place.ts`) |

Some calls override the effort for one call while keeping the role's provider:

- **Reading each past proposal PDF.** Uses `muse-spark-1.3@low` (`packages/brain/src/extract.ts:5`). Transcribing a typed document does not need deep reasoning, and the brain reads 45 of them.
- **Deep read of each tender.** Uses the agent lane at `@low` (`apps/api/src/lib/opportunity-assess.ts`).

`resolveLane` (`packages/models/src/providers.ts:80`) applies this precedence: an explicit per-call override, then `LANE_<ROLE>`, then the legacy `MODEL_<ROLE>`, then `DEFAULT_LANES` (`providers.ts:38-43`). A lane string without an effort inherits the role's default effort. `parseLane` and `formatLane` round-trip, and the test suite checks that (`packages/models/test/providers.test.ts`).

Every model call writes a step record: purpose, `provider:model`, tokens in, out and cached, milliseconds, and cost (`packages/models/src/types.ts:5-15`). Proposal runs store these per stage in `proposal_steps`. Other runs store them in `run_steps`. The interface labels the model that actually answered from this record.

## Reasoning-effort headroom

Muse Spark counts reasoning tokens inside `max_tokens`. A 3,000-token cap at `high` effort can spend the whole allowance on thinking and return `content: null`. `withReasoningHeadroom` (`providers.ts:113-118`) adds a fixed allowance per effort before the request is sent:

| Effort | minimal | low | medium | high | xhigh | max |
|---|---|---|---|---|---|---|
| Added tokens | 400 | 1,200 | 3,000 | 8,000 | 16,000 | 24,000 |

Only providers that accept `reasoning_effort` receive the field and the headroom (`laneParams`, `providers.ts:121`).

## Contributor-mode models are refused in code

Meta may train on prompts sent to `*-contributor` models. Pactovio handles companies' commercial documents, so the lane parser rejects any lane string that contains `contributor`, and it does so before a request is ever built:

```ts
// packages/models/src/providers.ts:35-36
const LaneString = z.string().trim().min(1).max(200)
  .refine((s) => !/contributor/i.test(s), 'Contributor-mode models are not allowed: Meta may train on those prompts');
```

The refusal applies to environment lanes, legacy `MODEL_*` values and per-call overrides alike (`providers.test.ts`). Contributor ids are also absent from the price table (`packages/models/src/prices.ts`). The CI guard (`scripts/ci-guards.sh`) also fails the build if `wrangler.toml` names one.

## Structured output with one corrective retry

`chatJSON` (`packages/models/src/json.ts:27`) derives a draft-7 JSON Schema from the zod schema. It sends that schema as `response_format: json_schema` with `strict: true` and validates the reply with zod. On failure it makes exactly one retry that feeds the validation errors back to the model. A second failure throws `JsonValidationError`. It never returns half-parsed data.

## Muse Wonder orchestration, Spark fallback

`wonderLoop` (`packages/models/src/wonder.ts:27-42`) runs a tool loop on `meta:muse-wonder-1.0@medium`. It falls back in three ways:

- If Wonder errors or fails twice in a row, the same loop and the same tools run again on `meta:muse-spark-1.3@medium`. The result carries `wonderFailed: true`, so the run is labelled truthfully.
- A budget refusal (HTTP 402) is re-thrown. It is never retried on another model, because it would be refused again.
- If both loops fail, `orchestrate.ts` runs the stages in canonical order in code. Every stage is idempotent, so the sweep only fills gaps (`packages/proposal/src/orchestrate.ts:55-65`).

Production record: all 13 completed proposal runs in the production database were orchestrated by `meta:muse-wonder-1.0`. None needed the Spark fallback (read-only query, 5 Nov 2026; see [EVALS.md](EVALS.md)).

## When a model id is withdrawn

`isModelUnavailable` (`packages/models/src/availability.ts`) matches a 404 or a "does not exist" error. When it fires:

- **Chat agent.** It drops to `meta:muse-spark-1.2@low` (`packages/agent/src/loop.ts:153-162`).
- **Vision calls.** They try `meta:muse-spark-1.2@medium` (`packages/engine/src/vision.ts:7`).

## Budget: a hard daily cap and a kill switch

The cap and the kill switch live inside the client's `fetch`, not around individual call sites. Any call the app can make is metered: chat, JSON, streaming agent turns, retries and fallbacks, from routes, Workflows, crons and webhooks. Every client is built that way (`packages/models/src/client.ts:27`, `budget.ts:83`).

1. **Kill switch.** It applies when `MODELS_DISABLED=1` in `wrangler.toml`, or when the KV key `config:models_disabled` is `1`. The KV key flips without a deploy. Calls are refused with HTTP 402 `models_off` (`budget.ts:30-33`).
2. **Reserve the worst case first.** The estimate is the whole prompt as uncached input plus the full `max_tokens` output, at list price (`estimateUsd`, `budget.ts:59`). One atomic D1 upsert adds it to today's total only if the total stays under the cap (`budget.ts:42-49`). Two concurrent requests cannot both slip past the cap.
3. **Settle to actual usage.** The `usage` block from the response is priced at list price, and the reservation is corrected up or down. A failed request is refunded. For streams, usage is read from the final SSE chunk on a tee of the body (`budget.ts:94-98`).
4. **Per-unit models.** SAM 3.1, Muse Image and Voice Transcribe go through `metered()` (`packages/models/src/meta-http.ts:27`): the same kill switch, a reservation at the unit price, and a refund on failure.

The production cap is `MODEL_DAILY_CAP_USD = "20"` (`wrangler.toml:23`). The day resets at 00:00 UTC, which is 08:00 MYT. When the cap is reached, the user sees "Daily limit reached. Try again after 08:00 MYT." The app does not substitute a cheaper model or a made-up answer. Unknown model ids are charged at Muse Wonder's price, the highest known (`prices.ts:21`), so a misconfigured lane can only overcount.

Concurrency is also bounded: six live calls and four bulk calls at a time per isolate (`packages/models/src/limiter.ts`).

## Swap-ready providers: architecture, not running

The provider registry (`providers.ts:21-26`) knows four OpenAI-compatible providers:

| Provider | Base URL | Key env | `reasoning_effort` |
|---|---|---|---|
| `meta` | `https://api.meta.ai/v1` | `META_API_KEY` | yes |
| `fireworks` | `https://api.fireworks.ai/inference/v1` | `FIREWORKS_API_KEY` | no |
| `baseten` | `BASETEN_BASE_URL` | `BASETEN_API_KEY` | no |
| `modal` | `MODAL_BASE_URL` | `MODAL_API_KEY` | no |

Moving a role to an open-weights model on a customer's own endpoint is a single line in `wrangler.toml`, for example `LANE_FAST = "modal:<model>"`. Vendor-only request fields are stripped by `portableExtra`.

Honestly stated: **every production lane is `meta:muse-spark-1.3`**, and nothing runs on Fireworks, Baseten or Modal. The CI guard fails if a production lane in `wrangler.toml` leaves the Meta provider.

## List prices used for metering

Standard mode, from `packages/models/src/prices.ts`, `sam.ts`, `image.ts` and `voice.ts`:

| Model | Price |
|---|---|
| Muse Spark 1.3 | $1.25 in, $0.15 cached, $4.25 out per 1M tokens |
| Muse Wonder 1.0 | $4.00 in, $0.20 cached, $20.00 out per 1M tokens |
| SAM 3.1 | $0.0025 per image |
| Muse Image 1.0 | $0.01 per image |
| Muse Voice Transcribe 1.0 | $0.18 per hour of audio |

The measured cost per stage of a real proposal run is in [EVALS.md](EVALS.md#measured-in-production).
