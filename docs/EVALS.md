# Evals and tests

This page covers what is tested, how the tests run without secrets, and what has been measured on the live Meta models. Every number below comes from a test run or a read-only query of the production database, and the date is given with it.

## The suite

`npm run check` runs three steps in order: the repository guards (`scripts/ci-guards.sh`), `tsc --noEmit`, then `vitest run`. GitHub Actions runs the same steps on every push and pull request (`.github/workflows/ci.yml`) with no secrets. The suite stubs every model, connector and payment call at the `fetch` boundary.

Result on 5 Nov 2026, commit `f1a0c82`, in a clean `npm ci`:

| Metric | Value |
|---|---|
| Test files | 98 passed |
| Tests | 787 passed, 2 skipped |
| Typecheck | 0 errors |
| Wall time | about 101 s locally |

The two skipped tests need a licensed tender pack that is not in the repo: `packages/pack/test/pack.test.ts:102` and `packages/engine/test/docx.test.ts:72`.

### Where the tests are

| Area | Files | Tests |
|---|---|---|
| `apps/api`: routes, Workflows, autopilot, proposals, auth, tenancy | 52 | 407 |
| `packages/connectors`: Composio providers, webhook signatures, inbound mail, classification | 10 | 110 |
| `packages/agent`: tool loop, approval gate, caps | 3 | 58 |
| `packages/engine`: run pipeline, claims, documents | 6 | 50 |
| `packages/quote`: catalogue, lexical match, quotes | 7 | 44 |
| `packages/models`: lanes, budget, SAM and voice parsing | 4 | 30 |
| `packages/sources`: tender sources | 5 | 25 |
| `apps/front`: client helpers | 4 | 20 |
| `packages/brain`: extraction schema, outcomes, stats | 3 | 18 |
| other packages (`pack`, `contracts`, `client`, `events`) | 4 | 27 |

### How the tests run

- **Real bindings, not mocks of SQL.** API tests run every D1 migration in `apps/api/migrations` into a fresh local D1, R2 and KV from Wrangler's `getPlatformProxy` (Miniflare/workerd), with a throwaway persist directory per suite (`apps/api/test/helpers.ts`). Queries, upserts, unique keys and the atomic spend reservation therefore run as real SQL. `PACTOVIO_TEST_SQLITE=1` swaps in Node's built-in `node:sqlite` behind the same shape (`apps/api/test/local-storage.ts`).
- **Model replies are recorded shapes.** `apps/api/test/proposals-mock.ts` answers each Meta endpoint (chat, Responses for SAM, images, ASR) with fixed payloads in the real wire format. The full pipeline (`runProposal`) therefore runs end to end in a test, including the Wonder → Spark fallback and a SAM failure.

### What the tests prove

**The model layer** (`packages/models/test`):

- Lane parsing round-trips, and precedence is override > `LANE_*` > `MODEL_*` > default.
- Every `*-contributor` id is refused in env lanes and in overrides.
- Reasoning headroom is added per effort.
- The spend cap reserves atomically, refuses past the cap and refunds failures.
- The kill switch refuses every call.
- The SAM streaming output parses to normalised boxes.
- Voice input limits are enforced.

**The bid engine** (`apps/api/test/proposals.test.ts`, `proposal-*.test.ts`):

- Money adds up and GST applies only in India.
- Claims without evidence are struck.
- SAM boxes anchor devices, and unknown SKUs are dropped.
- If Wonder fails, the Spark fallback is labelled.
- A floor-plan failure does not fail the run.
- Review edits are limited to text and cannot change numbers.

**The Company Brain** (`apps/api/test/brain.test.ts`, `packages/brain/test`):

- The extraction schema is enforced.
- HubSpot deal stages override PDF outcomes by ref.
- Style rules that cite fewer than two real refs are dropped.
- Stats are computed only from the extracted data.

**Autopilot** (`apps/api/test/autopilot*.test.ts`):

- Marketing mail is ignored and RFQs start a run.
- A confident RFQ starts exactly one run, however many times it is delivered.
- Mail from before autopilot was switched on is never processed.
- Replies are drafts.

**Tender rubric** (`apps/api/test/opportunity-rubric.test.ts`, `opportunity-cited.test.ts`):

- Weights, the coverage cap and verdict thresholds work as specified.
- Invented SKUs and refs are dropped.
- Another tenant's catalogue is never matched.

**Meta-only** (`apps/api/test/meta-only.test.ts`): no source file calls a non-Meta search vendor.

### Tenant isolation

There are over 30 named tests that show one workspace cannot read, write, export or enumerate another's data. Among them:

- `customer-boundaries.test.ts`:
  - "denies foreign private IDs for reads, writes, exports and pack execution"
  - "cannot export another tenant R2 object through its own storage connection"
  - "overwrites forged internal workspace/session headers on WebSocket forwarding"
- `proposals.test.ts`: "isolates tenants: another workspace gets 404 on read, assets and print, and an empty list".
- `brain.test.ts`: "workspace B never sees workspace A's run, events or documents".
- `mcp.test.ts`: "an API key only sees its own workspace".
- `autopilot.test.ts`: "stores only grounded prospects per workspace, as drafts, and never leaks across tenants".
- `opportunity-cited.test.ts`: "never matches another tenant's catalogue".
- `packages/connectors/test/accounts.test.ts`: "an account another workspace connected itself is never shared".
- `packages/quote/test/routes.test.ts`: "a quote is not visible from the other workspace".

## Measured in production

These figures come from read-only `SELECT`s on the production D1 database (`pactovio-meta`) on 5 Nov 2026 at about 07:20 MYT. Each row in `proposal_steps` is written by the pipeline itself (`packages/proposal/src/ctx.ts`), so the costs are the metered list-price costs of real calls.

### Proposal runs

| Metric | Value |
|---|---|
| Completed runs | 13, all orchestrated by `meta:muse-wonder-1.0`. The Spark fallback was never needed |
| Failed runs | 2. Both were refused by the empty-catalogue guard before any model call, at $0 (`packages/proposal/src/run.ts`) |
| Cost per run | mean **$0.39**, range $0.16–$0.54 |
| Wall time per run | mean **7.2 min** |
| Hero RFP runs with the brain applied (Kurinji Commercial Bank, 120 ATMs + 18 branches; 7 runs) | 14–16 SAM-anchored placements, 73–96 evidence items, 0–8 struck sentences, 3 past proposals learned from, $0.41–$0.54, 7.3–9.8 min |

Per stage (mean over successful runs):

| Stage | Models that ran | Mean cost | Mean time |
|---|---|---|---|
| orchestrate (Wonder's own turns) | Muse Wonder 1.0 | $0.054 | spans the run |
| read_rfq | Muse Spark 1.3 | $0.071 | 50 s |
| select_solution | Muse Spark 1.3 | $0.051 | 80 s |
| floor_plan | SAM 3.1 + Muse Spark 1.3 | $0.055 | 46 s |
| design_architecture | Muse Spark 1.3 | $0.042 | 61 s |
| compose_bom | Muse Spark 1.3 | $0.042 | 68 s |
| concept_visual | Muse Image 1.0 (+ SAM 3.1 + Spark on ATM bids) | $0.038 | 36 s |
| compliance_matrix | Muse Spark 1.3 | $0.029 | 41 s |
| check_eligibility | Muse Spark 1.3 | $0.012 | 17 s |
| claim_check | code | $0 | 0.4 s |

### Company Brain learning

| Metric | Value |
|---|---|
| Past-proposal PDFs read natively by Muse Spark | 225 over 5 learning runs (45 per run). Status `done` for all 225; none failed |
| Cost per PDF | mean **$0.026** (`muse-spark-1.3@low`), so learning 45 proposals costs about $1.18 |

## Live scripts

| Script | What it does |
|---|---|
| `apps/api/scripts/proposal-live.ts` | Runs the full proposal pipeline on the real Meta models against a local SQLite and R2 stand-in, with a $5 cap, and prints the stage progress every 15 s. The header estimate is $0.15–$0.30. Production measurements above are higher because the brain adds past-proposal context |
| `scripts/connector-e2e.ts` | Checks the live Composio accounts and the email-intake round trip against a deployed API |
| `apps/api/scripts/gen-api-doc.ts` | Regenerates the endpoint table in [API.md](API.md) from the router |

## Not measured yet

- **Extraction accuracy of the Company Brain against the 45 ground-truth records.** The ground truth exists, but no scored comparison is in the repo yet.
- **Proposal quality against a rubric.** Placement count, evidence count and struck claims (above) are proxies, not a quality score.
- **Voice Transcribe.** It is exercised with a software test input, not a native microphone.
