# Phase 48 — Deferred Items (out-of-scope discoveries)

These were discovered during execution but are NOT caused by the current plan's
changes. Per the SCOPE BOUNDARY rule, they are logged here and NOT fixed.

## 48-02 execution (2026-06-28)

### TS2322 in `src/components/charts/TouchTooltip.test.tsx:90` (pre-existing, from 48-01)

- **Discovered during:** 48-02 Task 3 final `npx tsc --noEmit` sweep.
- **Origin:** commit `f3dc7858` (plan 48-01 / Wave 0). The file is byte-identical
  between the last 48-01 commit (`7dc038a0`) and the end of 48-02 — plan 48-02
  never touched it.
- **Error:**
  ```
  src/components/charts/TouchTooltip.test.tsx(90,9): error TS2322:
  Type '(v: number) => [string, string]' is not assignable to type
  'Formatter<ValueType, NameType> & (...)'.
    Types of parameters 'v' and 'value' are incompatible.
      Type 'ValueType | undefined' is not assignable to type 'number'.
  ```
  The test's `formatter={(v: number) => ...}` is narrower than Recharts'
  `Formatter<ValueType, NameType>` (whose `value` is `ValueType | undefined`).
- **Why not fixed here:** Out of scope — it is in a 48-01 file, not in any of the
  20 files this plan modified (all 20 are tsc-clean). Vitest transpiles via
  esbuild (type-stripping, not type-checking), so all 82 tests pass regardless;
  this is a compile-time typing nit, not a runtime defect.
- **Suggested fix (for 48-01 follow-up or 48-03):** widen the test's formatter
  signature to `(v: ValueType | undefined) => ...` (or `(v) => [String(v), "label"]`)
  to match Recharts' `Formatter` type, OR cast at the call site. One-line change.
- **Blast radius if a CI `tsc` gate exists:** would fail typecheck. The blocking
  CI gate per CLAUDE.md is `frontend-coverage` (vitest --coverage), which is
  green; confirm whether a separate `tsc` job gates branch protection before
  landing the phase.

## 48-03 execution (2026-06-28) — re-confirmation

- The TS2322 in `TouchTooltip.test.tsx:90` above was **re-confirmed pre-existing**
  during 48-03 (`git stash` of only the 48-03 EquityChart files → `npx tsc --noEmit`
  still reports the same one error at HEAD `48c83b87`). It is in a 48-02-owned file,
  NOT in either of the two files 48-03 modifies (`EquityChart.tsx`,
  `EquityChart.touch.test.tsx`), both of which typecheck clean. Left to its owning
  plan (48-02 follow-up) per the SCOPE BOUNDARY rule — NOT fixed in 48-03.
