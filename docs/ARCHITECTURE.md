# Architecture

Pactovio runs on Cloudflare. It has one Worker for the API, the agent and the Workflows, and one Pages site for the front end. All inference runs on five Meta models through one client package. This page follows data through each workflow. Model configuration is covered in [MODELS.md](MODELS.md), the security boundaries in [SECURITY.md](SECURITY.md), and decision records in [adr/](adr/).

## System

```mermaid
flowchart LR
  subgraph Front[Pages · apps/front]
    UI[Static app /app<br/>ES modules]
    PW[_worker.js<br/>service binding]
  end
  subgraph Worker[Worker pactovio-meta-api · apps/api]
    R[Hono + zod routes<br/>/api /mcp /webhooks]
    DO[AgentHub Durable Object<br/>chat, tools, approvals]
    WF[Workflows<br/>BrainLearn · ProposalRun · Intake · Scan · PackRun]
    CR[Cron<br/>every minute · 22:00 UTC]
  end
  subgraph Data[Cloudflare data]
    D1[(D1<br/>records, run steps, spend counter)]
    R2[(R2<br/>RFQ packs, PDFs, assets)]
    KV[(KV<br/>cache, kill switch, dedupe)]
  end
  subgraph Meta[Meta Model API · packages/models]
    SP[Muse Spark 1.3]
    WO[Muse Wonder 1.0]
    SAM[SAM 3.1]
    IMG[Muse Image 1.0]
    VO[Muse Voice Transcribe]
  end
  CX[Composio<br/>HubSpot · Drive · Gmail]
  UI --> PW --> R
  R --> DO & WF
  CR --> WF
  R & DO & WF --> D1 & R2 & KV
  R & DO & WF -->|budgetedFetch: kill switch + daily cap| Meta
  WF --> CX
```

| Piece | Code | Notes |
|---|---|---|
| Routes | `apps/api/src/routes/*.ts` (35 files) | Typed router: zod parses params, query and body, and errors return `{ error, code }` (`apps/api/src/lib/router.ts`) |
| Workflows | `apps/api/src/workflows/{brain,proposal-run,intake,scan,pack-run}.ts` | Durable steps with retries. A step that already finished is skipped on resume |
| Agent | `packages/agent/src`, Durable Object `AgentHub` | Chat tool loop on the `agent` lane. State-changing tools ask for approval first. The same tools are exposed over MCP (`apps/api/src/routes/mcp.ts`) |
| Model client | `packages/models/src` | Lanes, reasoning headroom, strict JSON, tool loop, Wonder, SAM, Image, Voice, spend cap |
| Domain packages | `packages/brain`, `packages/proposal`, `packages/connectors`, `packages/quote`, `packages/engine` | Pure TypeScript with D1, R2 and fetch injected, so the tests run them in Node against SQLite |
| Schema | `apps/api/migrations/*.sql` | D1 migrations, applied in order |

## 1. Company Brain: learning how the company wins

```mermaid
sequenceDiagram
  autonumber
  participant U as Onboarding
  participant API as /api/brain
  participant WF as BrainLearnWorkflow
  participant CX as Composio (Drive, HubSpot)
  participant SP as Muse Spark 1.3
  participant DB as D1 + R2
  U->>API: POST /hubspot/sync
  API->>CX: hubspot.list_products
  API->>DB: upsert catalogue (idempotent on workspace + SKU)
  U->>API: POST /drive/learn {folder}
  API->>WF: create run (409 if one is already running)
  WF->>CX: list_files (≤ 60 PDFs)
  loop one child Workflow per PDF, 2 retries, 6 min
    WF->>CX: download_file
    WF->>SP: native PDF file part → strict ExtractionSchema
    WF->>DB: brain_documents.proposal_json + brain_events(file_done)
  end
  WF->>CX: hubspot list_deals → won / lost / open by proposal ref
  WF->>SP: derive voice rules + phrases (each must cite ≥ 2 real refs)
  WF->>DB: company_brain {style, stats computed in code}
```

- **Extraction** (`packages/brain/src/extract.ts`, `schema.ts`). Each past proposal goes to Muse Spark as a native PDF `file` part: no OCR, chunking or embeddings. The reply is validated against a zod schema covering ref, client, solution type, scope of supply, custom engineering, commercials, compliance and outcome.
- **Outcomes** (`packages/brain/src/outcomes.ts`). A HubSpot deal name starts with the proposal ref. The deal stage overrides the outcome printed in the PDF, and the record keeps `outcome_source`.
- **Style** (`packages/brain/src/style.ts`). The model proposes voice rules and recurring phrases. `groundDraft` keeps only those cited by at least two real learned refs, and the run fails if fewer than three of each survive. Payment terms, warranty, AMC, validity and discount pattern are computed in code.
- **Stats** (`packages/brain/src/stats.ts`). These are computed only from the extracted data, never by a model: win rate, value bands, median value, mix by solution type, sector and region, top products and engineering days.
- **Progress** streams to the learning view from `brain_events` (`GET /api/brain/progress?after=seq`).

## 2. RFQ → proposal: Muse Wonder runs the bid

Entry points:

- Chat or upload: `POST /api/proposals`, with 8 files of 15 MB each and 30 runs per hour per workspace.
- Gmail autopilot: `apps/api/src/lib/autopilot-wiring.ts`.
- A tender's "Prepare bid": `apps/api/src/lib/opportunity-detail.ts`.

All three call `startProposal` (`packages/proposal/src/start.ts`). That function stores the files in R2 and starts `ProposalRunWorkflow`, which has one durable step, 1 retry and a 30-minute timeout (`apps/api/src/workflows/proposal-run.ts`).

```mermaid
flowchart TD
  S[runProposal<br/>load files, catalogue, Company Brain] --> W{Muse Wonder 1.0<br/>tool loop, ≤ 16 steps}
  W -- errors or fails twice --> F[Same tools on Muse Spark 1.3 @medium<br/>labelled as fallback]
  W & F --> T
  subgraph T[Nine idempotent tools · packages/proposal/src/orchestrate.ts]
    direction LR
    t1[read_rfq<br/>Spark @high, native PDF,<br/>doc + page per requirement] --> t2[check_eligibility<br/>Spark] --> t3[select_solution<br/>lexical shortlist → Spark picks SKUs] --> t4[compose_bom<br/>prices, GST, AMC in code]
    t4 --> t5[design_architecture] & t6[place_on_floor_plan<br/>SAM 3.1 + Spark vision] & t7[compliance_matrix] & t8[concept_visual<br/>Muse Image]
    t5 & t6 & t7 & t8 --> t9[claim_check<br/>code, no model]
  end
  T --> X[Code sweep: run any stage the agent skipped]
  X --> A[assemble + go/no-go in code<br/>Proposal.parse]
  A --> H[HTML document · print to PDF<br/>review, edit, approve]
```

What the model decides and what code decides (detail and line references in [adr/0003](adr/0003-rubric-scored-in-code.md)):

| Stage | Model | Code |
|---|---|---|
| `read_rfq` (`read.ts`) | Reads PDFs and images natively. Writes requirements with doc, page and clause | Caps at 60 requirements. Picks the floor-plan file |
| `check_eligibility` (`eligibility.ts`) | Gives met, to confirm or gap per eligibility row, using company facts | Selects which rows count as eligibility. Rows the model skipped default to "to confirm" |
| `select_solution` (`select.ts`) | Picks SKUs, scope and quantities from a shortlist | Builds the lexical shortlist (≤ 45 SKUs). Drops SKUs and past refs that are not real |
| `compose_bom` (`bom.ts`) | Writes the narrative, budgetary external items and work packages | Sets quantities × sites, catalogue unit prices, totals, GST, AMC and warranty. Clamps the discount to 0–15% |
| `design_architecture` (`design.ts`) | Writes nodes, links and the zone map | Drops dangling links and zones whose SKU is not in the supply |
| `compliance_matrix` (`compliance.ts`) | Judges the non-eligibility rows | Reuses the eligibility verdicts. Rows the model skipped become "partial" |
| `claim_check` (`claims.ts`) | none | Strikes any sentence whose figure, name, standard or date has no evidence |
| go/no-go (`gonogo.ts`) | none | Weighs coverage, win rate on similar past bids, deviations and deadline |

Every stage writes a `proposal_steps` row with its models, tokens, cost, milliseconds and summary. `GET /api/proposals/:id/events` streams those rows to the browser as server-sent events while the run is going (`apps/api/src/routes/proposal-events.ts`, protocol in [API-STREAM.md](API-STREAM.md)). The proposal screen refreshes when a step lands and falls back to polling on any stream error. A public page draws one finished run from the same rows: https://pactovio-meta.pages.dev/trace. It also saves the whole run state, so a Workflow retry resumes after the last finished stage (`packages/proposal/src/ctx.ts`).

### SAM 3.1 placement pipeline

SAM 3.1 on CAD line drawings does not respond to semantic prompts such as "ATM". The pipeline therefore splits the work: SAM finds shapes, Spark says what each shape is, and code places devices.

```mermaid
flowchart LR
  P[Floor-plan image<br/>from the RFQ pack] --> C[10 shape + colour concepts<br/>'dark blue rectangle', 'red circle'…]
  C -->|10 parallel SAM 3.1 calls<br/>$0.0025 each| B[Boxes normalised 0..1]
  B --> M[mergeCandidates<br/>area 0.0002–0.5, IoU dedupe > 0.7,<br/>≤ 64, ids A1..An]
  M --> V[Muse Spark vision<br/>names each box, assigns kit SKUs<br/>to anchors, 8–16 placements]
  V --> Q[placeRelative in code<br/>device box beside its anchor,<br/>unknown SKUs dropped]
  Q --> O[floorplan.placements<br/>source: sam-3.1 or spark-vision]
```

The code is in `packages/proposal/src/floorplan.ts`, `place.ts` and `packages/models/src/sam.ts`. For ATM bids the concept visual (`visual.ts`) also runs SAM, using 6 natural-language concepts on the generated lobby image. That image is always captioned "Concept visual — generated, not a product photo". The caption is a literal in the schema.

## 3. Gmail autopilot

```mermaid
flowchart LR
  CR[Cron every minute] --> PL[pollAutopilot<br/>≤ 20 workspaces, Gmail list_new]
  WH[Composio webhook<br/>HMAC verified] --> DD
  PL --> DD{Seen? KV cx:msg + ledger}
  DD -- new --> IN[IntakeWorkflow<br/>fetch → classify → route → autopilot → announce → draft]
  IN --> CL[Spark @minimal, temp 0<br/>rfq · rfp · design_request · tender_notice · marketing · other]
  CL -- marketing / other --> IG[ignored]
  CL -- RFQ, confidence ≥ 0.7 --> RUN[startProposal source=autopilot]
  CL -- low confidence --> NR[needs review]
  RUN --> IB[Inbox: Proposal ready]
  IN --> DR[Gmail create_draft only<br/>never sent]
```

- Polling covers 72 hours back, never earlier than the moment autopilot was switched on (`apps/api/src/lib/autopilot-poll.ts`, `autopilot-store.ts`).
- Idempotency comes from three things together: a KV key per message, a ledger query, and `INSERT OR IGNORE` on `apm_{intake}`.
- The classifier prompt treats email as untrusted (`packages/connectors/src/classify.ts`).
- The Gmail action catalogue has `create_draft` and no send action (`packages/connectors/src/catalog.ts`).

## 4. Tenders: deep, explainable fit

```mermaid
flowchart LR
  CP[Capability profile<br/>Spark @minimal from catalogue + brain<br/>CPV prefixes, terms in 10 languages] --> RC[Recall in code<br/>CPV prefix or whole-word term hits]
  RC --> RK[Heuristic order<br/>recall × 3 + place × 4]
  RK --> DR[Deep read, top 12<br/>Spark agent @low on live notice text]
  DR --> SC[scoreRubric in code<br/>verify SKUs + refs, weight, cap, verdict]
  SC --> UI[Score breakdown, SKU coverage,<br/>cited past bids, eligibility, top risk]
  UI --> PB[Prepare bid → startProposal]
```

The model reads the notice and returns requirements with the SKUs it believes cover them, up to three similar past proposals, five eligibility checks, the deciding factor and the top risk. Code scores the result (`apps/api/src/lib/opportunity-rubric.ts`):

- Capability 40, track record 25, eligibility 20, commercial 15.
- Every cited SKU and past ref is checked against the workspace's own catalogue and brain, and invented ones are dropped.
- A "full coverage" claim with no real SKU is downgraded.
- The total is capped at 35 when coverage is below 30%.
- **Bid** needs overall ≥ 70, at most one risk and coverage ≥ 60%. **Bid with conditions** needs overall ≥ 50 and coverage ≥ 40%. Anything else is **Pass**.

## 5. Prospects

`apps/api/src/lib/prospects.ts` calls the Responses API with `tools: [{ type: 'web_search' }]` on the agent lane. A prospect is kept only if its `source_url` is one of the URLs the search actually returned. The others are counted as `dropped_without_source`. Outreach is stored as a draft and never sent.

## Cross-cutting

- **Spend.** All model traffic passes `budgetedFetch` or `metered`: kill switch, atomic reservation, then settlement ([MODELS.md](MODELS.md#budget-a-hard-daily-cap-and-a-kill-switch)).
- **Tenancy.** Every query binds the session's `workspace_id`. A foreign id returns 404 ([SECURITY.md](SECURITY.md)).
- **Telemetry.** `proposal_steps`, `run_steps` and `brain_events` record every model call with its model, tokens, cost and latency. The interface labels the model that ran from these rows.
