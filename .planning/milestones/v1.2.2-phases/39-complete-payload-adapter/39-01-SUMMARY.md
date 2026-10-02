---
phase: 39-complete-payload-adapter
plan: 01
subsystem: factsheet
tags: [refactor, extraction, dry, parity-source, quantiles]
requires:
  - "src/lib/factsheet/build-payload.ts (source of the module-local quantileSummary)"
  - "src/lib/factsheet/types.ts (QuantilePayload shape)"
provides:
  - "src/lib/factsheet/quantiles.ts — exported quantileSummary(rets): QuantilePayload, the single parity source for the QuantilePayload field"
affects:
  - "src/lib/factsheet/build-payload.ts (now imports quantileSummary instead of a local copy)"
  - "Plan 39-02 scenario adapter (will import the same shared quantileSummary)"
tech-stack:
  added: []
  patterns:
    - "Byte-identity code-move: extract a non-exported helper verbatim into a shared module, export it, repoint the original via named import — zero algorithm change."
key-files:
  created:
    - "src/lib/factsheet/quantiles.ts"
    - "src/lib/factsheet/quantiles.test.ts"
  modified:
    - "src/lib/factsheet/build-payload.ts"
decisions:
  - "Extracted quantileSummary to src/lib/factsheet/quantiles.ts (D-3 locked decision: ONE parity source for the quantiles payload field, DRY) rather than re-implementing the body in the Plan-02 adapter."
  - "Removed the now-unused QuantilePayload symbol from build-payload.ts's type import (the local function was its only consumer there) — surgical, Rule 3."
metrics:
  duration: ~3m
  completed: 2026-06-26
  tasks: 1
  files: 3
---

# Phase 39 Plan 01: Extract quantileSummary to shared factsheet module Summary

Moved the non-exported module-local `quantileSummary` verbatim out of `build-payload.ts` into a new exported `src/lib/factsheet/quantiles.ts`, repointing `build-payload.ts` to a named import — a pure, byte-identity code-move so the Plan-02 scenario adapter can consume the same single parity source instead of duplicating the linear-interpolation math.

## What Was Built

- **`src/lib/factsheet/quantiles.ts`** (new): exports `quantileSummary(rets: number[]): QuantilePayload`. The body is the verbatim algorithm previously at `build-payload.ts:305–331` (empty → all-zeros; `n===1` → every quantile = `sorted[0]`; otherwise linear-interpolated percentile `idx = p*(n-1)`, floor/ceil/frac blend). `import type { QuantilePayload } from "./types"` added at the top. No re-derivation.
- **`src/lib/factsheet/build-payload.ts`** (modified): deleted the local `function quantileSummary` (lines 305–331); added `import { quantileSummary } from "./quantiles";`; removed the now-unused `QuantilePayload` symbol from the `./types` type import. The call site (`const quantiles = quantileSummary(stratRet);`) and every other line are untouched — behavior byte-identical.
- **`src/lib/factsheet/quantiles.test.ts`** (new): pins empty (`[]` → all-zeros), single-element (`[0.05]` → every percentile `0.05`), a hand-computed 5-number summary (`[0,1,2,3,4]` → p50/mean 2, p05 0.2, p95 3.8, min 0, max 4), and an order-independence / non-mutation guard.

## Task-by-Task

| Task | Name | Type | Commit | Files |
| ---- | ---- | ---- | ------ | ----- |
| 1 | Extract quantileSummary to a shared module + repoint build-payload | auto (tdd) | `5e1cb303` | `quantiles.ts`, `quantiles.test.ts`, `build-payload.ts` |

TDD cycle: RED — wrote `quantiles.test.ts`, ran it, confirmed it failed (`./quantiles` unresolvable). GREEN — created `quantiles.ts` with the verbatim body; tests pass. Repoint — deleted the local copy in `build-payload.ts`, added the import, dropped the unused type symbol; full factsheet suite stayed green. Both gates landed in one atomic commit because the plan defines this as a single code-move task (the test imports the new module; the repoint depends on the new module — they cannot land separately and still typecheck/run).

## Verification

- `npx vitest run src/lib/factsheet/quantiles.test.ts` — 4 tests green.
- `npx vitest run src/lib/factsheet/` (full factsheet dir, incl. every `build-payload.ts` consumer: `audit-c20.test.ts`, `allocator-portfolio-payload.test.ts`) — **12 files / 115 tests green**. Confirms `build-payload.ts` output is byte-identical to before the extraction.
- `npx tsc --noEmit` — exit 0, no output.
- `npx eslint src/lib/factsheet/quantiles.ts src/lib/factsheet/quantiles.test.ts src/lib/factsheet/build-payload.ts` — exit 0, 0 errors.

Acceptance-criteria greps:
- `grep -n "export function quantileSummary" quantiles.ts` → 1 match.
- `grep -c "function quantileSummary" build-payload.ts` → 0.
- `grep -n 'import { quantileSummary } from "./quantiles"' build-payload.ts` → 1 match.

## Deviations from Plan

None — plan executed exactly as written. The plan anticipated possibly needing to drop the unused `QuantilePayload` import "only if eslint flags it"; the type symbol's only consumer in `build-payload.ts` was the moved function, so I removed it as a surgical part of the move (eslint/tsc both confirm it is now unused there). This is the plan's own contingency, not a deviation.

Note: the plan/success-criteria referenced a `build-payload.test.ts` file, which does not exist in the repo. `build-payload.ts` is instead exercised by `audit-c20.test.ts` and `allocator-portfolio-payload.test.ts` (both import it). Running the full `src/lib/factsheet/` test directory covers those suites and proves byte-identical behavior — the intent of the criterion is satisfied.

## Threat Surface

No new surface. Pure in-process TypeScript code-move; no network, auth, DB, user input, or RSC boundary (matches the plan's threat model — T-39-01-01 mitigated by the verbatim move + the existing `quantiles` pins + the new median pin failing loudly on any math change). No package installs (T-39-SC n/a).

## Self-Check: PASSED

- FOUND: src/lib/factsheet/quantiles.ts
- FOUND: src/lib/factsheet/quantiles.test.ts
- FOUND: src/lib/factsheet/build-payload.ts (modified)
- FOUND commit: 5e1cb303
