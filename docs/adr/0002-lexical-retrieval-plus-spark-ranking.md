# 0002 · Lexical retrieval, Spark reads and ranks

Status: accepted · 2026-11-04

## Context

Three places need "find the relevant few among many":

- Catalogue SKUs for an RFQ: 67 products.
- Past proposals similar to a new bid: 45 here, up to 300 read.
- Public tenders worth a deep read: thousands per scan.

The Meta Model API offers no embedding model. Muse Spark has a 1,048,576-token window and reads PDFs natively.

## Decision

- **Narrow cheaply and transparently in code, then let Spark read the shortlist in full.**
- **Catalogue and past proposals.** These use an idf-weighted term overlap, `lexicalScores` (`packages/quote/src/lexical.ts`). The catalogue shortlist takes up to 6 per query and caps at 45 SKUs (`packages/proposal/src/select.ts`). The top 5 past proposals by title, sector, client, summary and solution type are kept.
- **Tenders.** Recall uses CPV prefixes and whole-word capability terms in 10 languages, from a Spark-built capability profile. The order is a heuristic: recall × 3 + place × 4. The top 12 are then deep-read by Spark (`apps/api/src/lib/opportunity-search.ts`, `opportunity-assess.ts`).
- **Validated selection.** Spark selects from the shortlist. Code drops any SKU or ref that is not in the workspace's data.

## Consequences

- No vector store, no embedding cost and no index to keep in sync. Retrieval is deterministic and unit-testable.
- Matching is on wording, not meaning: a synonym the profile lacks can miss. The tender profile mitigates this with terms in several languages and CPV classes. The README lists the limit under "Cut or not done".
- Spark sees whole documents, never chunks, so citations point to a real document and page.

## Rejected

- **A third-party embedding API.** It would break the Meta-only stack, which `apps/api/test/meta-only.test.ts` enforces for search. It would also add a data processor for customers' commercial documents.
- **Sending the whole catalogue and all past proposals on every call.** That is possible within the window, but cost and latency grow with every company's data.
