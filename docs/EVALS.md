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

These figures come from read-only `SELECT`s on the production D1 database (`pactovio-meta`) on 5 Nov 2026 at about 07:00 MYT. Each row in `proposal_steps` is written by the pipeline itself (`packages/proposal/src/ctx.ts`), so the costs are the metered list-price costs of real calls.

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

## Eval: how accurately Muse Spark reads past proposals

**What it measures.** Each of the 45 past proposal PDFs is scored against the structured record it was rendered from. The records are at `pactovio-demo-data/rax-proposals/out/*.json`, outside this repo. What is scored is the extraction stored in production `brain_documents` by the latest completed learning run (`brn_6c31979717ecc592a8d4`, read-only snapshot, 5 Nov 2026).

**Code.** The scorer is `packages/evals/src/brain-score.ts`, with unit tests in `packages/evals/test/brain-score.test.ts`. The CLI is `scripts/evals/brain-extraction.ts`. The result is [`docs/evals/brain-extraction.json`](evals/brain-extraction.json).

| Result | Value |
|---|---|
| Documents matched | **45 / 45** |
| Overall field accuracy (macro mean, 19 fields) | **93.7%** |
| Exact on these 15 fields: ref, revision, date, validity, client, RFQ ref, title, prepared by, total value (±0.5%), warranty ×2, AMC %, engineering items, engineering person-days (±5%), compliance rows | 100% |
| Bill of materials: SKU precision / recall / F1 over 381 line items | **99.2% / 99.2% / 99.2%** |
| Quantity exact on matched SKUs | **100%** |
| Client city | 97.8% |
| Solution type (4 classes) | 84.4%. All 7 misses read `fully_custom_engineered` as `own_plus_custom_engineering` |
| Turnaround days | 55.6%. The PDFs never state it; it can only be derived from the issue date and the RFQ date |
| Client sector | 42.2%. The PDFs print no sector, so Spark infers one, often coarser (for example "Retail" where the record says "Retail chain") |
| Win or loss (reported, not in the overall) | 20%. A proposal PDF cannot know its own outcome, so Spark correctly returns `pending`. The app takes outcome from HubSpot deals (`packages/brain/src/outcomes.ts`) |

Reproduce with `npx tsx scripts/evals/brain-extraction.ts --truth <records dir> --snapshot <export.json> --out docs/evals/brain-extraction.json`.

## Eval: proposal quality, scored in code

**What it scores.** Every completed production proposal (13 of them) is checked against its own workspace data: the catalogue, the learned past proposals and their outcomes (read-only snapshot, 5 Nov 2026). Every check is deterministic.

**Code.** The scorer is `packages/evals/src/proposal-score.ts`, with tests in `packages/evals/test/proposal-score.test.ts`. The CLI is `scripts/evals/proposal-quality.ts`. The result is [`docs/evals/proposal-quality.json`](evals/proposal-quality.json).

| Check | Proposals scored | Mean (min–max) |
|---|---|---|
| **Overall** (weighted: price 0.20, arithmetic 0.20, citations, evidence, grounding, floor plan 0.15 each) | 13 | **0.96** (0.87–1.00) |
| Requirements carrying a document + page citation | 10 | **100%** |
| BoM lines priced exactly at the workspace catalogue price | 10 | **100%** |
| Arithmetic re-computed from the proposal (lines, subtotal, discount, GST, total) | 13 | **100%** |
| Compliance rows for every requirement, each with a status | 13 | **100%** |
| `learned_from` refs that exist in the learned past proposals | 10 | **100%** |
| Evidence items that resolve to a real page, SKU or past proposal | 13 | 92% (71–100%) |
| Floor-plan placements anchored to a SAM 3.1 object | 8 | 81% (69–87%) |
| Struck sentences ÷ checked claims (lower is better) | 13 | 8% (0–27%) |

A check counts as *not applicable*, and is left out of that proposal's mean, in these cases:

- A run whose RFQ was pasted text with no pages has no page citations to check.
- A workspace with no catalogue has no catalogue prices to check.
- A run with no floor-plan image has no placements to check.

**Findings we have not fixed:**

- **Totals are above the won range.** Every hero bid totals ₹2.2–3.8 crore. That is above the 90th percentile of Rax's won proposals of the same type (₹0.24–0.98 crore), most likely because 120 ATMs and 18 branches is a bigger rollout than any past win. The value is reported, not weighted, because nothing yet validates a total against bid size.
- **One run had an implausible total.** It ran before the catalogue existed and priced only budgetary external lines, at ₹171 crore. The empty-catalogue guard (`packages/proposal/src/run.ts`) now stops such runs before any model call.
- **Two pasted-text runs have weak evidence sources.** One cites the client's name as if it were a document, so 0 of its 17 evidence items resolve.

## Eval: Muse Wonder vs Muse Spark as the orchestrator

**Setup.** The same hero RFP pack and 67-product catalogue went through two live arms, run in parallel on 5 Nov 2026 with $0.76 spent in total. In the Spark arm, the script answers any `muse-wonder-1.0` request with a 404, so `wonderLoop` falls back to Spark on the same nine tools. No product code changed.

**Code.** The script is `scripts/evals/orchestrator-ab.ts`. Results are in [`docs/evals/orchestrator-ab.md`](evals/orchestrator-ab.md) and `orchestrator-ab.json`.

| | Wonder | Spark fallback |
|---|---|---|
| Total cost / wall time | $0.383 / 8.98 min | $0.381 / 8.94 min |
| Orchestrator's own cost | $0.036 | $0.029 |
| Tool order | nine tools, intended order | identical |
| Requirements with page citations | 35 (100%) | 39 (100%) |
| Floor-plan placements | 14 | 3 |

**Reading the result.**

- Orchestration was indistinguishable: both orders were the same, cost and wall time were within 1%, and neither had errors. The fallback therefore loses nothing in a Wonder outage.
- The output differences come from stages that run on Spark in both arms, and n = 1 cannot separate them from run-to-run variance.
- **Finding:** when Wonder is unavailable, the tool loop first finishes on the `reason` lane, then `wonderLoop` runs the Spark agent lane again (`packages/models/src/wonder.ts:33-41`). The stages are idempotent, so the second pass is nearly free, but the first pass should be accepted. The fix is noted and was not shipped during the code freeze.

## Live scripts

| Script | What it does |
|---|---|
| `apps/api/scripts/proposal-live.ts` | Runs the full proposal pipeline on the real Meta models against a local SQLite and R2 stand-in, with a $5 cap, and prints the stage progress every 15 s. The header estimate is $0.15–$0.30. Production measurements above are higher because the brain adds past-proposal context |
| `scripts/connector-e2e.ts` | Checks the live Composio accounts and the email-intake round trip against a deployed API |
| `apps/api/scripts/gen-api-doc.ts` | Regenerates the endpoint table in [API.md](API.md) from the router |

## Not measured yet

- **Human grading of proposal quality.** The scores above are computed checks, not an expert's judgement of the writing.
- **Variance.** Repeated runs per configuration would put error bars on cost, placements and totals.
- **Voice Transcribe.** It is exercised with a software test input, not a native microphone.
