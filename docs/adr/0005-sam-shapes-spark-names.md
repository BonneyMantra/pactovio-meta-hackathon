# 0005 · SAM 3.1 finds shapes, Spark names them, code places devices

Status: accepted · 2026-11-04

## Context

Placing devices on the buyer's floor plan needs the positions of real objects: ATMs, doors, the safe. On CAD line drawings, SAM 3.1 returned no matches for semantic prompts such as "ATM", "door" or "safe". It does segment shapes and colours reliably.

## Decision

1. Query SAM 3.1 with 10 shape and colour concepts in parallel, such as "dark blue rectangle" and "red circle" (`packages/proposal/src/floorplan.ts`). Each call costs $0.0025.
2. Merge the boxes in code. Keep areas from 0.0002 to 0.5, remove duplicates at IoU > 0.7, keep at most 64, and give them stable ids A1…An (`packages/proposal/src/place.ts`).
3. Muse Spark vision sees the image, the numbered boxes and the device kit. It names each box and assigns SKUs to anchors, producing 8–16 placements.
4. Code places each device box beside its anchor, drops unknown SKUs and labels the source: `sam-3.1`, or `spark-vision` if there was no anchor.

## Consequences

- On the hero bank RFP, production runs place 14–16 devices anchored to SAM boxes ([EVALS.md](../EVALS.md#measured-in-production)).
- A SAM failure stores the floor plan as skipped and does not fail the bid. It is not retried, because SAM is billed per call.
- On ATM bids the concept visual also runs SAM, with 6 natural-language concepts, on the generated lobby image, where semantic prompts work.

## Rejected

- **Spark vision alone, with free coordinates.** The coordinates drift and are not grounded in a detected object.
- **Semantic SAM prompts on line drawings.** They return no matches.
