# Orchestrator A/B: Muse Wonder vs Muse Spark

Run 2026-11-05, live Meta Model API, one run per arm, both in parallel (`scripts/evals/orchestrator-ab.ts`; raw results in `orchestrator-ab.json`).

## Setup
- Same inputs: `RFP-KCBL-ESURV-047.pdf`, `branch-floorplan.png`, `rfq-email.txt`; 67-product Rax catalogue; local SQLite D1/R2 stand-in; daily cap $3 per arm.
- Wonder arm: product default (`meta:muse-wonder-1.0@medium` drives the nine stage tools).
- Spark arm: the script's fetch wrapper answers any `muse-wonder-1.0` request with an instant 404 (no cost), so `wonderLoop` falls back to `muse-spark-1.3` on the same tools. No product code changed.
- Every stage's own model calls (read, BoM, compliance, SAM 3.1, Muse Image) are identical in both arms; only the orchestrating agent differs.

## Result
| | Wonder | Spark |
|---|---|---|
| Orchestrator recorded | muse-wonder-1.0 | muse-spark-1.3 (wonderFailed = true, by design) |
| Total cost | $0.3830 | $0.3813 |
| Orchestrate step cost | $0.0362 | $0.0286 |
| Wall time | 8.98 min | 8.94 min |
| Tool order | read_rfq, eligibility, select, bom, design, floor plan, compliance, visual, claim_check | identical (run twice, see below) |
| Requirements (with page cite) | 35 (100%) | 39 (100%) |
| BoM lines / grand total | 20 / INR 29,015,964 | 16 / INR 18,860,058 |
| Compliance rows (complies/partial/deviation) | 35 (19/14/2) | 39 (14/24/1) |
| Floor-plan placements (SAM 3.1 share) | 14 (71%) | 3 (100%) |
| Evidence items | 85 | 91 |
| Struck claims | 0 | 2 |
| Go/no-go | conditional, 0.50 | conditional, 0.51 |

## Observations
- Orchestration itself was indistinguishable: both agents called each tool once, in the intended order, with no errors, and finished with no tools left for the sweep. Cost and wall time are within 1%.
- Spark's orchestration was slightly cheaper ($0.007 less); Wonder showed no latency or cost penalty here.
- The Spark arm walked the tool chain twice: after two 404s the tool loop swaps to the reason lane and runs, then `wonderLoop` runs the Spark agent lane again. Stages are idempotent, so the second pass cost almost nothing, but it is an artifact of how the fallback was forced.
- Output metrics differ a lot (BoM total, placements, compliance mix), but the stages producing them ran on Spark in both arms. These gaps are most likely run-to-run variance of those stages (for instance, the Wonder arm placed 14 devices, the Spark arm only 3), not an orchestration effect. This test cannot separate the two.

## Limits
- n = 1 per arm, same day, same pack; no repeated runs, so no variance estimate.
- No brain or past proposals loaded in the local fixture, so style learning and similar-won evidence are absent in both arms (`go_no_go` bases are thin).
- Spark arm is a forced fallback, not a native Spark orchestrator prompt tuning.
- Metrics are counts and shares, not human quality grading of the proposals.
