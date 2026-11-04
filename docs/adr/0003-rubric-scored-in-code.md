# 0003 · Models read and judge; code computes every number

Status: accepted · 2026-11-04

## Context

A bid is a commercial commitment. A model that invents a price, a total, a certification or a win probability causes real harm. Language models are good at reading and judging. They are not reliable at arithmetic or at keeping to a scoring rule.

## Decision

Model output is structured input to code. It is never the final number.

| Decision | Model contributes | Code computes |
|---|---|---|
| Bill of materials (`packages/proposal/src/bom.ts`, `money.ts`) | Narrative, budgetary external items, work packages | Quantities × sites, catalogue unit prices, totals, GST (18% in India, else 0), AMC and warranty. Discount clamped to 0–15% |
| Go/no-go (`packages/proposal/src/gonogo.ts`) | Requirement verdicts | Confidence = 0.2 + 0.4·coverage + 0.35·win rate (from ≥ 3 decided similar bids) − penalties for deviations and a near deadline. Thresholds give go, conditional or no-go |
| Tender fit (`apps/api/src/lib/opportunity-rubric.ts`) | Requirements with claimed SKUs, similar past bids, five eligibility checks, deciding factor, risk | SKUs and refs verified against the workspace. Weighted 40 / 25 / 20 / 15. Capped at 35 below 30% coverage. Verdict thresholds |
| Company Brain stats (`packages/brain/src/stats.ts`) | Field extraction from each PDF | Win rate, medians, value bands, mixes and top products |
| Claims (`packages/proposal/src/claims.ts`) | none | Strikes sentences whose figures, names, standards or dates have no evidence |

## Consequences

- Each score can be explained as a formula. The tender view shows the breakdown, and the tests pin the thresholds (`apps/api/test/opportunity-rubric.test.ts`, `proposals.test.ts`).
- A model upgrade can change judgements but cannot break arithmetic.
- The rubric weights are product decisions. They live in code, not in a prompt.

## Rejected

- **Asking the model for a 0–100 fit score.** It is not reproducible or explainable, and it drifts between model versions.
