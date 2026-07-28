---
phase: 77-upnl-basis-reconciliation
plan: 01
subsystem: analytics
tags: [nav-twr, twr, upnl, materiality-flag, data-quality, realized-basis, python, pandas]

# Dependency graph
requires:
  - phase: 73-nav-twr-core
    provides: reconstruct_nav_and_twr backward roll, NavTWRMeta, _build_nav_meta, DUST_NAV_FLOOR, the open_unrealized_usd terminal seam (:507-509)
  - phase: 76-venue-flows-reconciliation
    provides: NavTWRMeta DQ-flag channel (flow_coverage_incomplete), reconcile_flow_residual, _BROKER_WARN_FLAGS bridge pattern
provides:
  - UNREALIZED_MATERIALITY_RATIO = 0.05 module const (Q5; warning-only, Phase-78 tuned)
  - unrealized_pnl_in_anchor flag on NavTWRMeta + _build_nav_meta (complete_with_warnings channel)
  - materiality computation in reconstruct_nav_and_twr (|open_unrealized_usd|/anchor > 5% on a non-dust anchor)
  - realized-basis-intraday / MTM-at-endpoint invariant documented in the core docstring (Q3 verdict)
  - source-scan invariant test — no per-day uPnL array is ever constructed
affects: [77-02-exchange-upnl-reads, 77-03-derive-path-wiring, 78-golden-parity]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Materiality DQ flag: a BOOL riding the existing complete_with_warnings channel, guarded against a dust base, no key when immaterial (SC-4 byte/status-identical default)"
    - "Executable invariant via source-scan test: encode a research verdict (no fabricated marks) as a forbidden-substring scan of the module source"

key-files:
  created: []
  modified:
    - analytics-service/services/nav_twr.py
    - analytics-service/tests/test_nav_twr.py

key-decisions:
  - "UNREALIZED_MATERIALITY_RATIO = 0.05 with a STRICT > comparator (exactly-5% is NOT material) so > -> >= reddens the boundary"
  - "Dust guard (anchor > DUST_NAV_FLOOR) is load-bearing: the ratio is meaningless and divide-by-tiny explodes into a false positive on a dust base"
  - "Flag carries a BOOL only — the raw USD wedge is never logged/emitted (T-77-02 account-size leak)"
  - "Per-day uPnL true-up NOT implemented — historical open-position marks are not retrievable on read-only keys (Q3, HIGH-confidence negative); invariant documented + source-scanned"

patterns-established:
  - "Materiality flag with a dust/heuristic guard on the denominator, mutation-honest in both directions"
  - "Docstring invariant + source-scan test pair that fails if a future edit fabricates per-day marks"

requirements-completed: []  # FLOW-04 spans 77-01/02/03; NOT complete until 77-03 wires a real per-venue uPnL value

# Metrics
duration: 30min
completed: 2026-07-06
---

# Phase 77 Plan 01: Core uPnL Materiality Flag Summary

**`unrealized_pnl_in_anchor` materiality flag (fires when |open_unrealized_usd|/anchor > 5% on a non-dust base) plus the realized-basis-intraday / MTM-at-endpoint invariant documented and source-scanned in nav_twr.py — the load-bearing core change for FLOW-04.**

## Performance

- **Duration:** ~30 min
- **Tasks:** 2 (TDD RED → GREEN)
- **Files modified:** 2

## Accomplishments
- Added `UNREALIZED_MATERIALITY_RATIO = 0.05` and `unrealized_pnl_in_anchor` on `NavTWRMeta` + `_build_nav_meta`, riding the existing `complete_with_warnings` channel (no parallel status system).
- Raised the flag in `reconstruct_nav_and_twr` when the terminal uPnL wedge is material relative to a non-dust anchor; no key when immaterial so the SC-4 zero-wedge default stays byte/status-identical (`complete`).
- Documented the Q3 realized-basis-intraday / MTM-at-endpoint invariant verbatim in the core docstring; encoded it as a source-scan test that no per-day uPnL array is ever constructed.
- Proved the wedge is a pure terminal shift (byte-identity to a pre-reduced anchor, no step discontinuity) and that a non-zero wedge does not spuriously breach `reconcile_flow_residual`.

## Task Commits

1. **Task 1: RED — materiality/wedge-equivalence/no-step/no-fabricated-marks tests** - `5623ea64` (test)
2. **Task 2: GREEN — materiality flag + realized-basis invariant docstring** - `473ed503` (feat)

_`.planning/` is gitignored (local-only); no docs metadata commit — code commits are the record._

## Files Created/Modified
- `analytics-service/services/nav_twr.py` - `UNREALIZED_MATERIALITY_RATIO` const; `unrealized_pnl_in_anchor` on `NavTWRMeta` + `_build_nav_meta`; materiality computation + Q3 invariant docstring in `reconstruct_nav_and_twr`.
- `analytics-service/tests/test_nav_twr.py` - 6 mutation-honest tests: wedge byte-identity equivalence, no-step-discontinuity, materiality boundary (both signs, exactly-at-5%), dust-anchor suppression, no-historical-mark source-scan, reconcile non-breach guard.

## Decisions Made
- **Strict `>` comparator** — exactly-5% is NOT material; makes `>` → `>=` mutation-honest.
- **Dust guard on the denominator** — `anchor > DUST_NAV_FLOOR` before evaluating the ratio; a dust NAV is already DQ-01-flagged and the ratio is meaningless/explosive on a tiny base.
- **BOOL-only flag** — no raw USD wedge in any meta/log/raise (T-77-02).
- **FLOW-04 left UNMARKED** — the flag exists but nothing supplies a real per-venue uPnL yet (77-02 reads, 77-03 wires); marking the requirement complete now would be dishonest (Rule 12 fail-loud).

## Deviations from Plan

None - plan executed exactly as written.

One minor in-task correction (not a deviation): the docstring invariant phrases were initially line-wrapped, which split `not retrievable on read-only keys` across a newline and reddened the source-scan assertion. Reworded so the asserted phrases sit contiguously on one line each. Behavior/intent unchanged.

## Issues Encountered
None beyond the docstring line-wrap correction above (caught immediately by the source-scan test in GREEN).

## Verification Evidence
- `pytest tests/test_nav_twr.py` — 36 passed (30 baseline + 6 new).
- Full analytics suite — **3098 passed, 92 skipped** (CI-3.12 venv); baseline 3092 stays green, all P73–76 pins GREEN.
- `mypy --strict services/nav_twr.py` — clean. `ruff check` — clean.
- Mutation honesty proven: `>` → `<` reddens the materiality boundary (3 tests); injecting the wedge into `nav.iloc[-1]` post-roll reddens the equivalence + no-step tests (2 tests). File restored after each mutation.

## Known Stubs
None. FLOW-04's per-venue uPnL read is intentionally deferred to 77-02 (the `open_unrealized_usd` param remains a 0.0 default until wired); this is planned phasing, not a stub — the core behavior (flag + invariant) is fully wired and tested.

## Next Phase Readiness
- 77-02 (exchange.py companion open-uPnL reads: OKX `upl`, Deribit `session_upl`; Bybit/Binance wedge 0) can now supply a real `open_unrealized_usd`; the flag + invariant it feeds are in place.
- 77-03 threads the wedge through the derive path and lifts `unrealized_pnl_in_anchor` through the DQ bridge (mirror the `flow_coverage_incomplete` lift + `_BROKER_WARN_FLAGS`).
- No blockers.

## Self-Check: PASSED
- Commit `5623ea64` (test RED) — FOUND
- Commit `473ed503` (feat GREEN) — FOUND
- `analytics-service/services/nav_twr.py` — FOUND (11 flag/const references)
- `analytics-service/tests/test_nav_twr.py` — FOUND
- `.planning/phases/77-upnl-basis-reconciliation/77-01-SUMMARY.md` — FOUND

---
*Phase: 77-upnl-basis-reconciliation*
*Completed: 2026-07-06*
