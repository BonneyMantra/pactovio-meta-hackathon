# Pactovio

The pre-sales engine for technical B2B suppliers. Three doors in, one engine, outputs a bid team can use:

- Doors: public tenders found by a nightly scan, inbound RFPs and RFQs (upload, paste, mailbox), design requests from customers.
- Engine: read the whole pack, extract every requirement, decide bid or no-bid per lot, match requirements to the company's evidence, draft answers and a priced quote, check every claim, ask a person to approve.
- Outputs: the buyer's own response form filled in (DOCX), a requirement matrix with sources, per-lot verdicts, a priced quote (DOCX and XLSX), events to the team's tools, and a 24x7 agent you can chat with or reach over MCP.

Built for the Meta Global AI Developer Hackathon 2026. Hosted target: https://pactovio.pages.dev (landing, /pricing) and https://pactovio.pages.dev/app. Customer access in this version uses email-code signup/login, a private company workspace, resumable onboarding, customer evidence uploads and catalogue prices. Rollout requires the additive customer migration and configured email/Composio services; see [customer setup and API contract](apps/api/CUSTOMER-AUTH.md). Billing remains Dodo Payments test mode. Existing sample-company data is retained internally and is not available through customer sessions.

**The product interface** (`apps/front/public`, plain HTML, CSS and ES modules on the live API, no build step):

| Screen | What it shows (all live data) |
|---|---|
| Today | Counts that open filtered views, top tender matches with fit, newest intakes with the fast model's one-line reason, approvals waiting, recent runs with tokens and cost |
| Inbox | Every intake by door (RFQ, RFP, design request, tender, ignored) with confidence; paste-in composer |
| Tenders → detail | Per-lot verdict with reasons citing document and page, every gate, the requirement matrix (filters, search, page citations), drafted answers with struck claims, the buyer's own form filled and downloadable, the run's steps with model, tokens and cost, buyer intel |
| Quotes | Design requests matched against datasheets (MET / PARTIAL / GAP with citations) and quote documents with DOCX export |
| Agent | The 24x7 agent: streaming chat over WebSocket, tool calls, citations, approve / decline cards, proactive inbox |
| Connections | 15 connectors by category with live status and a live event stream |
| Evidence, Catalogue, Company settings, Billing & usage, How it works, Pricing, Help | Upload and index company documents; enter product prices; resume/edit company setup; plans, test checkout and usage limits |

## How it works

```
 scan (cron 06:00 MYT)  upload / paste / mailbox  design request
        \                     |                      /
         v                    v                     v
   Cloudflare Worker  pactovio-api  (Hono + zod OpenAPI, /api /v1 /mcp /webhooks /ics)
        |                |                  |                |
   Workflows         Durable Object      Queues           D1 + R2 + KV
   PackRun / Scan /  AgentHub (chat,     pactovio-events  tenders, matrix,
   Intake            alarms, SSE)        webhook + app    verdicts, evidence,
                                         fan-out          ledger | pack files | cache
        |
        v
   Meta Model API (Muse Spark 1.3 lanes)                  Tavily (buyer intel)
   Swap-ready: Fireworks / Baseten / Modal (OpenAI-compatible)
```

| Piece | What it does |
|---|---|
| `apps/api` | One Worker `pactovio-api`. Routes, Workflows (`PackRunWorkflow`, `ScanWorkflow`, `IntakeWorkflow`), `AgentHub` Durable Object (SQLite, WebSocket hibernation, alarms), queue consumer, cron `0 22 * * *` UTC. `workers_dev` is off. |
| `apps/front` | Cloudflare Pages project `pactovio`: `_worker.js` sends `/api /v1 /mcp /webhooks /ics /dev` to the Worker over a service binding and everything else to the static site: landing, `/pricing`, `/privacy`, `/terms` and the product app at `/app`. |
| `packages/engine` | Pack run pipeline, gates in code, evidence matching, verdicts, drafting, claim check, form fill, buyer intel, caps, replay. |
| `packages/sources`, `packages/pack` | TED v3, UK Find a Tender, eTenders (anonymous pack download), unzip and text extraction for PDF, DOCX, XLSX; form detection. |
| `packages/quote` | Design request parsing, catalogue match, pricing and tax rules, quote export. |
| `packages/agent` | Streaming tool loop, 17 tools, confirmation gating (state-changing tools return a pending card, a person confirms). Same tools over MCP. |
| `packages/connectors` | 15 connectors through Composio, live email intake. See Connectors. |
| `packages/billing` | Dodo test-mode checkout, webhook, credit ledger, caps, real `/limits`. |

### Which Meta model does what (Meta Model API by default)

Each role is a lane, `LANE_<ROLE>=<provider>:<model>[@reasoning_effort]`, set in `apps/api/wrangler.toml`. Providers: `meta` (default), `fireworks`, `baseten`, `modal`. Moving a role to another OpenAI-compatible provider is a config change. `*-contributor` models are rejected in code (Meta may train on those prompts). Defined in `packages/models/src/providers.ts`.

| Lane | Default | Used for |
|---|---|---|
| `reason` | `meta:muse-spark-1.3@high` | Whole-pack read, requirement extraction (section by section), per-lot verdict reasoning. The pack text goes first in every prompt of a run so later calls hit the prompt cache. |
| `agent` | `meta:muse-spark-1.3@medium` | Agent tool loop (chat and MCP), evidence scans. If the model is not served the agent falls back to `meta:muse-spark-1.2@low`. |
| `fast` | `meta:muse-spark-1.3@minimal` | Nightly notice triage, answer drafting, email classification, buyer-intel summaries. |
| `vision` | `meta:muse-spark-1.3@medium` | Drawings, scanned pages and evidence images (sent as `image_url` parts); falls back to `meta:muse-spark-1.2`. |
| TODO | Muse Wonder | Being added; role to be documented when it lands. |
| TODO | SAM 3.1 | Being added; role to be documented when it lands. |
| TODO | Muse Image | Being added; role to be documented when it lands. |
| TODO | Muse Voice Transcribe | Being added; role to be documented when it lands. |

Retrieval over the evidence library does not call a model: Meta has no embedding model, so chunks are ranked by an idf-weighted lexical score (`packages/engine/src/lexical.ts`) and Kestrel datasheet lines by `packages/quote/src/lexical.ts`. Drafted-answer claim checks are code too (`claimCheckSync` in the engine): every concrete value must appear in the answer's evidence or the sentence is struck.

### Swap-ready open-weights lanes

Every lane is OpenAI-compatible, so moving a role to open weights is a config change, not a code change: set `LANE_<ROLE>` to `fireworks:<model>`, `baseten:<model>` (with `BASETEN_BASE_URL`) or `modal:<model>` (with `MODAL_BASE_URL`), plus that provider's API key secret. Nothing in the repo ships pointed at those providers; Meta is the only default.

Muse Spark counts reasoning tokens inside `max_tokens`, so `chat()` adds headroom per effort level. Every step records `model` as `<provider>:<model>`.

Structured output is JSON Schema from zod, validated, one retry with the validation error. Every model call is a row in `run_steps` (model, purpose, input, output and cached tokens, ms, cost). Costs use the published Meta Standard-mode list prices (Muse Spark $1.25 in / $0.15 cached / $4.25 out per 1M tokens).

### Decisions are mostly code, not model

Gates (turnover, insurance cover, certifications, references) are checked in code against the company profile as of the submission deadline. Requirement status (MET, PARTIAL, GAP, NEEDS_EVIDENCE) comes from lexical match-strength thresholds and explicit rules. Per-lot BID, NO_BID or CONDITIONAL is decided by code; the model only writes the reasoning. Every sentence of a drafted answer is split into claims (certifications, SLAs, headcounts, client names, money, dates) and each is checked against the evidence in code; unsupported ones are struck and tagged.

On the real Teagasc pack (public tender, 3 lots, EUR 5.95M) the sample company's insurance cover (EUR 6.0M) is below the EUR 6.5M the pack requires, so all three lots come out CONDITIONAL rather than BID. That is the intended behaviour, not a bug.

## Customer access and limits

Sign in or create an account with a six-digit email code. New customers receive an empty, private workspace and complete company setup before entering the app. Company details are saved between visits; evidence, products, requests, quotes, agent threads and connected accounts belong to that workspace. Customer cookies are opaque, hashed server-side, HttpOnly, Secure and revocable. Legacy anonymous sample cookies do not authenticate customer APIs.

Per customer browser session: 2 fresh pack reads, 3 Tavily buyer refreshes and 10 agent messages a minute. Globally: one fresh pack run in flight, Tavily 25/day and 150/month, and a hard **$0.25/day model spend cap** with a kill switch. Budget exhaustion is an error, not a fabricated answer. New customer workspaces have no recorded replays. Scheduled scans exclude retained samples and customers whose setup is incomplete. `GET /api/limits` returns the current counters and budget.

Each customer connects their own tools through Composio. The project callback verifier must be configured before production customer connections are enabled; credentials and shared demo accounts are never adopted into customer workspaces. See [configuration, migration and verification](apps/api/CUSTOMER-AUTH.md).

Catalogue entry currently supports 26 currencies with two decimal minor units; unsupported currency formats are rejected. Customers supply their own prices and datasheets. Quotes without configured tax rules exclude tax and require supplier confirmation of applicable taxes and commercial terms.

## Connectors

15 connectors through Composio managed auth, two per category: Gmail and Outlook, Slack and Microsoft Teams, HubSpot and Salesforce, Google Drive and Dropbox, Google Calendar and Outlook Calendar, Jira and Asana, DocuSign, QuickBooks and Xero. Each does one real job (mail trigger to classified intake with reply drafted never sent, chat posts with approve and decline links, a deal per bid, uploads of filled forms and quotes, calendar events for deadlines, a task per matrix gap, a quote sent for signature, an estimate from an approved quote).

**Live-tested on 30 Oct 2026 against real connected test accounts** (`npx tsx scripts/connector-e2e.ts all --api https://pactovio.pages.dev`): 9 checks passed across 8 connectors, 0 failed. Each check performs the real action, reads the object back through Composio, then cleans up.

| Connector | Live check | Result |
|---|---|---|
| Gmail | create draft, read back, delete | PASS |
| Gmail real-time intake | email arrives, Composio trigger hits `/webhooks/composio`, the fast lane classifies it, intake created | PASS (classified `design`, 24 s end to end) |
| Slack | post message, read back, delete | PASS |
| Salesforce | create opportunity, read back, delete | PASS |
| Google Drive | upload file, read back, delete | PASS |
| Dropbox | upload file, read back, delete | PASS |
| Google Calendar | create event, read back, delete | PASS |
| Jira | create task, read back, delete | PASS |
| Asana | create task, read back, delete | PASS |

Event rules also fired on their own in production on 30 Oct, with no one clicking: a finished pack read opened gap tasks in Jira and Asana (`run.completed` → `create_gap_tasks`); a drafted quote was uploaded to Google Drive and Dropbox (`quote.ready` → `upload_artifacts`) and the agent posted "Quote ready" plus both lot verdicts to the team's Slack channel. A no-bid verdict correctly pushed nothing to the CRM (`sync_bid` only runs for Bid or Bid with conditions).

Built and fixture-tested but **not live-tested**: HubSpot (test account not finished in time), Outlook and Outlook Calendar (Microsoft account creation was refused for the test persona), Microsoft Teams (needs a Microsoft 365 work account), QuickBooks (Intuit sandbox signup was refused), DocuSign and Xero (need our own OAuth apps). Pactovio uses its own Composio project, so its webhook subscription and connected accounts are isolated from any other product.

## Agent

The 24x7 agent is the `AgentHub` Durable Object: a streaming tool loop on the `agent` lane (Muse Spark 1.3), proactive messages from events (new match, run finished, approval requested), a morning digest on a Durable Object alarm, WebSocket and SSE delivery. State-changing tools never execute directly: they return a pending card and a person approves in chat or from a signed link. The same tools are served over MCP at `/mcp` (streamable HTTP, API key).


## Billing (Dodo Payments, test mode only)

Plans: Scout (free, 3 credits), Team (USD 149 a month, 150 credits), Business (USD 449 a month, 600 credits), credit pack (100 credits, USD 40). A pack read costs 1, 2 or 4 credits by page count, a design match 1, a buyer refresh 1. Checkout returns a Dodo test checkout URL; the webhook is verified with Standard Webhooks signatures and is idempotent. No real payment is possible. Sample workspaces are shared by judges and never charged. Usage is also sent to a Dodo meter, but no metered product is attached, so the credit ledger is the billing.

## Timeline

Development of Pactovio began on 30 Oct 2026, inside the hackathon window (26 Oct – 4 Nov 2026).

## What is not in this repository

The private, licensed UI kit source that the front end was designed with is not included. Only the compiled front end ships in `apps/front/public` (plain HTML, CSS and ES modules); it runs as is, but the original kit source and its licensed assets are not part of this repo.

## Run it locally

```bash
npm install
cd apps/api
# put META_API_KEY (and optionally TAVILY_API_KEY) in .env.local, gitignored; dev.sh turns it into .dev.vars
npx tsx scripts/seed-packs.ts --state .wrangler/state     # migrates, seeds the sample companies, extracts the real packs
npx tsx scripts/seed-samples.ts --apply --local           # company evidence and the Kestrel catalogue
PORT=8788 npm run dev                                     # http://localhost:8788/api/health
cd ../.. && npm test && npm run typecheck
```

The real tender packs are public documents from eTenders, TED and Find a Tender. They are not committed; `fixtures/packs/SOURCES.md` lists each source. Deploy: `wrangler deploy` for the Worker, `wrangler pages deploy public --project-name pactovio` from `apps/front`, then `npm run seed:packs:remote` and the remote seed scripts in `apps/api/package.json`.

## Cut or not done

- Connectors: 8 of 15 live-tested, 9 checks (see Connectors); HubSpot, Outlook, Outlook Calendar, Teams, QuickBooks, DocuSign and Xero are fixture-tested only.
- Scanned PDFs without a text layer are rejected on evidence upload (upload PNG or JPG); PDF image pages are not rendered to PNG for the vision step.
- Form fill covers table rows keyed by reference number; free-form content controls are untouched.
- Retrieval is lexical (idf-weighted term overlap), so it matches wording, not meaning; the status thresholds in `packages/engine/src/matrix-rules.ts` are not yet re-calibrated on a large library.
- Paid customer billing is not enabled: Dodo checkout remains test mode. Production customer rollout needs verified email delivery, the customer migration and the Composio callback verifier.

## Sample data

Harbour Digital Ltd (Cork) and Kestrel Sensing Ltd (Galway) are fictional and labelled "Sample company". Tenders and their documents are real public notices.

MIT licensed.
