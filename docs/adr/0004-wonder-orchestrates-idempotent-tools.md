# 0004 · Muse Wonder orchestrates idempotent tools

Status: accepted · 2026-11-04

## Context

A bid takes about ten model calls across five Meta models. Some stages depend on others: the bill of materials needs the selection, which needs the requirements. Others are independent, such as the floor plan, architecture, compliance and visual. Muse Wonder is built for long-horizon agent work but is in preview. A run must finish even if Wonder is unavailable.

## Decision

- **Nine tools.** Each bid stage is a tool with an empty input: `read_rfq`, `check_eligibility`, `select_solution`, `compose_bom`, `design_architecture`, `place_on_floor_plan`, `compliance_matrix`, `concept_visual` and `claim_check` (`packages/proposal/src/orchestrate.ts`).
- **Idempotent and resumable.** A tool reads and writes the saved run state, so calling it twice is harmless and a Workflow retry resumes after the last finished stage (`packages/proposal/src/ctx.ts`).
- **Wonder drives.** `wonderLoop` runs on `meta:muse-wonder-1.0@medium` with up to 16 steps.
- **Spark fallback.** If Wonder errors or fails twice, the same loop runs on Spark `@medium` and the run is labelled as a fallback (`packages/models/src/wonder.ts`).
- **Code sweep.** After the agent, code runs any stage it skipped, in canonical order. Only the floor plan and the visual may fail without failing the run.

## Consequences

- The run cannot end half-built. The orchestrator decides order and parallelism, not completeness.
- Production record: 13 of 13 completed runs were orchestrated by Wonder, at a mean of $0.054 for Wonder's own turns ([EVALS.md](../EVALS.md#measured-in-production)).
- A budget refusal is never retried on another model.

## Rejected

- **A fixed pipeline in code only.** That works, but loses the agentic orchestration Wonder is for.
- **Letting the agent write the proposal free-form.** That loses the typed schema and the per-stage numbers in code ([0003](0003-rubric-scored-in-code.md)).
