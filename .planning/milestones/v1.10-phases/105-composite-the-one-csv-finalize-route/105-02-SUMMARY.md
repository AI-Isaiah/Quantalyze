---
phase: 105-composite-the-one-csv-finalize-route
plan: 02
subsystem: factsheet-read-path
tags: [MED-1, D3, D6, series-store-fold, read-gate, composite]
requires:
  - shouldReadSingleKeyMtmSeries (Phase 103, the MTM twin mirrored)
provides:
  - shouldReadCashSettlementSeries (MED-1 read-side status-gate predicate — D3)
  - 105-FOLD-DECISION.md (locked D6 fold contract for Phase 106)
affects:
  - Phase 106 cash reader (contractually routes through the predicate family)
  - Phase 106 series-store fold migration (executes the sketch in the decision doc)
tech-stack:
  added: []
  patterns:
    - "predicate colocation at the DONE-gate (cash twin mirrors the MTM predicate exactly)"
    - "exported-but-uncalled contract predicate (guarantee lands before its 106 caller)"
key-files:
  created:
    - .planning/phases/105-composite-the-one-csv-finalize-route/105-FOLD-DECISION.md
  modified:
    - src/lib/factsheet/composite-read-path.ts
    - src/lib/factsheet/composite-read-path.test.ts
decisions:
  - "D6 LOCKED: tall daily_returns + basis column survives (JSONB blob rejected — cannot serve allocator/date/per-key/RLS/trigger axes); fold MTM+cash kinds in; executed in 106, NOT 105"
  - "MED-1 fixed by a single read-side status-gate predicate (choke point covering ALL terminal-failure arms) over N-arm heal-deletes"
metrics:
  duration: ~10m
  completed: 2026-07-14
---

# Phase 105 Plan 02: MED-1 Read-Gate + Series-Store Fold Decision Summary

The MED-1 read-side status-gate predicate `shouldReadCashSettlementSeries` (D3 primary
fix — the single choke point that refuses a stale `cash_settlement` series row from any
terminal-failure arm) plus the locked D6 series-store fold decision doc (`105-FOLD-DECISION.md`).
Predicate is exported, fully truth-tabled, and has zero production callers by design (Phase 106
is its first caller); the fold doc is decide-only — no DDL, no reader repoints.

## Tasks Completed

| Task | Name | Commit | Files |
| ---- | ---- | ------ | ----- |
| 1 | `shouldReadCashSettlementSeries` — MED-1 read-side status-gate | `60b80cc6` | composite-read-path.ts, composite-read-path.test.ts |
| 2 | `105-FOLD-DECISION.md` — lock the D6 series-store fold (decide-only) | (unstaged — gitignored `.planning/`) | 105-FOLD-DECISION.md |

## Task 1 — the predicate (D3)

Added `export function shouldReadCashSettlementSeries(metricsJsonByBasis, computationStatus)`
directly below `shouldReadSingleKeyMtmSeries` (composite-read-path.ts), copying its exact shape
with `cash_settlement` in place of `mark_to_market`. Returns true ONLY when
`computation_status ∈ {complete, complete_with_warnings}` AND `metrics_json_by_basis` carries a
non-null non-array `cash_settlement` object. JSDoc states: (1) MED-1 single choke point refusing
a stale row from ANY terminal-failure arm (`job_worker.py:2790-2821`, `_stamp_deribit_analytics_failed`,
`BROKER_DAILIES_VIA_FUNDING=false` rollback orphan LOW-3); (2) the 106 cash reader MUST route
through the predicate family (cites `105-FOLD-DECISION.md`); (3) no caller in 105 by design
(+ LOW-4: the INERT-read grep tripwire is NOT the guarantee, the status-gate is).

### Truth-table test result + neuter target

Truth-table tests mirror the `shouldReadSingleKeyMtmSeries` suite — every behavior case asserted:
- DONE + cash object → true (both `complete` and `complete_with_warnings`)
- not-terminal-success → false (`failed`, `computing`, `pending`, `null`, `undefined`, `0`, `""`, `complete_x`)
- no cash object → false (`{}`, wrong key, `null`, array-wrapped, scalar, top-level array, `"garbage"`)

**Result:** 48/48 passed (45 pre-existing green unmodified + 3 new cash blocks). Confirmed RED
first (`shouldReadCashSettlementSeries is not a function`, 3 failing) before GREEN.
**Neuter target (named in the test JSDoc):** drop the DONE gate (return the object check alone)
→ RED on the failed/computing-status cases.

## Task 2 — the fold decision doc (D6)

`105-FOLD-DECISION.md` (92 lines, ≤120 budget) with all 5 required sections: (1) Decision LOCKED
(tall `daily_returns` + `basis` column survives; JSONB blob rejected); (2) reader inventory
(66 files, re-grepped 2026-07-14 — 13 frontend src non-test / 14 src test / 7 backend non-test /
18 backend test / 8 migrations / 3 functions / 3 SQL tests / 2 GDPR axes); (3) migration shape
sketch (prose only, executed in 106); (4) the 4 locked caveats (a: MED-1 read-gate mandatory;
b: GDPR-completeness bonus; c: strict-atomicity SECDEF rides 106 only; d: benchmark/densify
convention travel); (5) non-goals of 105 (no DDL / repoint / flag flip).

### `^CREATE|^ALTER == 0` confirmation

`grep -c "^CREATE\|^ALTER" 105-FOLD-DECISION.md` == **0** — no runnable DDL; migration described
in prose/sketch only. Contains `shouldReadCashSettlementSeries` (D3 caveat, 2×) and the `basis`
column decision. **Not staged** (`.planning/` is gitignored — `git check-ignore` confirms).

## Verification

- `npx vitest run src/lib/factsheet/composite-read-path.test.ts --no-file-parallelism` → **48 passed**
- `npx tsc --noEmit` → **clean (exit 0)**
- grep gates: `grep -c shouldReadCashSettlementSeries composite-read-path.ts` == **2** (def + family ref);
  `grep -rl shouldReadCashSettlementSeries src/app/ | wc -l` == **0** (no production caller)
- Task 1 commit deletion check: none.

## Deviations from Plan

None — plan executed exactly as written.

Note: two pre-existing modified Python test files (`test_basis_series.py`,
`test_derive_broker_dailies_dualmode.py`) were present in the working tree at start and are
OUT OF SCOPE for this TS-only plan — left untouched and NOT staged (only the two explicit TS
paths were staged for the Task 1 commit).

## Known Stubs

None. `shouldReadCashSettlementSeries` is intentionally uncalled in Phase 105 — this is the D3
deliverable (the guarantee exists before its first caller in Phase 106), documented in its JSDoc
and in `105-FOLD-DECISION.md §4(a)`, not a stub.

## Self-Check: PASSED

- FOUND: src/lib/factsheet/composite-read-path.ts (`shouldReadCashSettlementSeries` present)
- FOUND: src/lib/factsheet/composite-read-path.test.ts (truth-table block present)
- FOUND: .planning/phases/105-composite-the-one-csv-finalize-route/105-FOLD-DECISION.md
- FOUND: commit 60b80cc6 (feat 105-02)
