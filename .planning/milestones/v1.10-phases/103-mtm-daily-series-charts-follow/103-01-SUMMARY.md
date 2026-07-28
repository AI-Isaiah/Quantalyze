---
phase: 103-mtm-daily-series-charts-follow
plan: 01
subsystem: analytics
tags: [python, pandas, mtm, dailies-canonical, basis-series, anti-divergence, strategy_analytics_series]

# Dependency graph
requires:
  - phase: 101-102
    provides: single-key + composite MTM scalar compute (metrics_json_by_basis.mark_to_market); the discarded mtm_returns / stitched-MTM series this plan learns to persist
provides:
  - services/basis_series.py::derive_basis_series — the DURABLE shared dailies-canonical derive (series → scalars + sparse rows + gap_spans + conventions echo)
  - services/basis_series.py::persist_basis_series — authoritative upsert + stale-row heal into strategy_analytics_series kind mtm_daily_returns
  - 103-PROBE-OQ1.md — OQ1 sparsity verdict (single-key POSSIBLE/guard-dependent; composite by construction)
  - anti-divergence round-trip guard (neuter-confirmed catches the Phase-101 √252 class)
affects: [103-02 (wires both MTM derive sites to the helper), 103-03/103-04 (frontend per-basis bundle + charts), 104-106 (backbone adopts the helper for cash)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Dailies-canonical derive: scalars are a CACHE computed from the sparse persisted form re-densified via gap_fill — round-trip true by construction"
    - "Per-basis coverage mask DERIVED from the sparse series (absent-day runs), never a second persisted source of truth"
    - "New strategy_analytics_series kind = INSERT a row, no DDL; basis→kind map is the cash join point"

key-files:
  created:
    - analytics-service/services/basis_series.py
    - analytics-service/tests/test_basis_series.py
    - .planning/phases/103-mtm-daily-series-charts-follow/103-PROBE-OQ1.md
  modified: []

key-decisions:
  - "NO DDL this phase: kind is unconstrained TEXT by design; factsheet reads via service-role admin like csv_daily_returns; a kind CHECK/COMMENT would trigger reviewer + rls-auditor + test-project catch-up for zero safety gain → NO test-project catch-up needed"
  - "Scalars derive from _drop_nonfinite → gap_fill (NaN interior guard days → absent → 0.0 on recompute); this deliberately may shift the MTM scalar vs the Phase-101/102 inline compute that fed NaN through — the LOCKED dailies-canonical intent"
  - "OQ1: single-key MTM interior sparsity is POSSIBLE but guard-dependent + basis-distinct; composite exists by construction (inter-member gaps + member NaN)"

patterns-established:
  - "derive_basis_series is basis-agnostic (periods_per_year/cumulative_method/day_basis + sibling_kinds passthrough) so Phases 104-106 route cash through it with no signature change"
  - "Anti-divergence guard = a straight round-trip through ONE function using its own conventions echo"

requirements-completed: [MTM-04]

# Metrics
duration: ~40min
completed: 2026-07-12
---

# Phase 103 Plan 01: Shared dailies-canonical derive (basis_series) Summary

**`services/basis_series.py`: the DURABLE shared route that turns an already-computed daily-return series into the sparse honest persisted form + a scalar cache derived FROM that form (round-trip true by construction, killing the Phase-101 √252 divergence class) + a per-basis coverage mask, plus authoritative upsert/heal into `strategy_analytics_series` kind `mtm_daily_returns` — with NO DDL and NO new valuation math.**

## Performance

- **Duration:** ~40 min
- **Tasks:** 3 (Task 1 probe, Task 2 derive TDD, Task 3 persist TDD)
- **Files created:** 3 (1 source, 1 test, 1 probe); 1 local deferred-items log
- **New module coverage:** 100% (38/38 statements); mypy --strict clean

## Accomplishments
- **OQ1 resolved from source** (`103-PROBE-OQ1.md`): single-key MTM interior sparsity is **POSSIBLE** (via DQ-01 denominator guards + pnl-dominated + pre-terminus NaN in `nav_twr.py`; `reconstruct_native_nav_and_twr` returns the raw NaN-carrying series; `gap_fill` preserves NaN VALUES) and **basis-distinct** (MTM NAV ≠ cash NAV → different guarded days), but **data-dependent** (only when a guard fires — otherwise span-level). Composite MTM interior sparsity **exists by construction** (inter-member window gaps + surviving member NaN; cited fixture `test_stitch_composite_job.py:1745-1747`).
- **`derive_basis_series`** — composition-only over `_drop_nonfinite` + `gap_fill_daily_returns` + `compute_all_metrics` + `_consecutive_spans`; emits `BasisSeriesResult{metrics_json, sibling_kinds, series_rows, gap_spans, conventions}`. Scalars computed from the sparse persisted form re-densified → the anti-divergence round-trip holds by construction.
- **Anti-divergence round-trip guard** (`test_basis_series_roundtrip`) — **neuter-confirmed**: hardcoding `periods_per_year=252` (ignoring the √365 arg while echoing it) reddens volatility/sortino exactly as the Phase-101 √252-vs-√365 class would; the cash-shaped √252 fixture round-trips identically (backbone can adopt the guard for cash unchanged).
- **`persist_basis_series`** — upserts via the existing service-role-only `upsert_strategy_analytics_series_batch` RPC with the exact `{mtm_daily_returns: {schema, basis, rows, gap_spans, conventions}}` payload; `result=None` heals by deleting the `(strategy_id, kind)` row (Pitfall 5); unknown basis raises. **Neuter-confirmed** (dropping the kind filter / mutating the schema reddens the persist tests).

## Task Commits

1. **Task 1: OQ1 sparsity probe** — no commit (`103-PROBE-OQ1.md` is a gitignored `.planning/` doc; content is this SUMMARY's OQ1 verdict)
2. **Task 2 (TDD): derive_basis_series**
   - `05eca5df` (test) — failing round-trip + gap-span + sparse-emission guards
   - `250e5d21` (feat) — the shared dailies-canonical derive
3. **Task 3 (TDD): persist_basis_series**
   - `c631c165` (test) — failing persist/heal guards (stub supabase)
   - `404b7cc1` (feat) — authoritative upsert + stale-row heal, no DDL
   - `d77d8f6f` (style) — drop unused `math` import

## Files Created/Modified
- `analytics-service/services/basis_series.py` — the shared derive + persist/heal module (durable; Phases 104-106 extend for cash)
- `analytics-service/tests/test_basis_series.py` — round-trip anti-divergence guard (MTM + cash-shaped), gap-span derivation, NaN semantics, persist/heal
- `.planning/.../103-PROBE-OQ1.md` — OQ1 verdict + file:line evidence + mask-claim consequence

## Decisions Made
- **No-DDL persistence home** (delegated, FINAL): the new kind ships as pure INSERT-a-row; the factsheet reads via the service-role admin client like `csv_daily_returns`. **Consequence: no test-project MCP catch-up needed this phase.**
- **NaN→(absent, 0.0-on-recompute) scalar semantics**: the helper `_drop_nonfinite`s before `gap_fill`, so interior guard NaN becomes an absent row and a gap_span, and re-densifies to 0.0 for the scalar. Per the OQ1 probe this NaN case is **reachable** (single-key when a guard fires; composite always) — so the shift vs the Phase-101/102 inline compute (which fed NaN through, and under `cumulative_method="simple"` could raise a bare ValueError on an interior chain-break) is real and intentional. Flagged for 103-02/103-04 SUMMARY.

## Deviations from Plan

None affecting scope. One process note: `derive_basis_series` (Task 2) and `persist_basis_series` (Task 3) live in the same module; to preserve clean per-task RED→GREEN commits, persist was split out of the file for the Task 2 GREEN commit and re-added under Task 3's RED→GREEN. No functional change.

**Total deviations:** 0 auto-fixes (Rules 1-3 not triggered). Plan executed as written.

## Issues Encountered
- **Pre-existing, out-of-scope suite failure** (NOT caused by this plan): `tests/test_audit.py::...test_action_literal_matches_ts_union` — `user_note.dashboard.update` exists in TS `src/lib/audit.ts` but not Python `services/audit.py`. A cross-runtime audit-taxonomy drift; none of the 103-01 commits touch audit files and Wave 1 must not touch `src/`. Logged to `deferred-items.md` (D-103-01), left unfixed per SCOPE BOUNDARY. Full non-e2e suite otherwise green: **3656 passed, 93 skipped, 1 failed (unrelated)**.

## Flags for Wave 2/3
- **103-02 (wiring):** call `derive_basis_series` at the single-key site (`job_worker.py:~2983`, replacing the inline `compute_all_metrics`) AND the composite site (`~:4249`, replacing `_metrics_result_for(clipped_mtm)`); wrap the sync `persist_basis_series` in the existing `db_execute`/thread pattern; route a **degrade/gated** derive to `persist_basis_series(..., result=None)` so a stale series never outlives an authoritative-NULL scalar write.
- **103-04 (charts/mask claims):** single-key MTM coverage is **span-level in the common (clean-book) case**, with interior marks ONLY where a DQ-01 guard fired — caption honestly; composite always carries full interior + span marks. Do not promise interior single-key marks unconditionally (LOCKED: no new math).
- **Scalar-shift note:** the persisted MTM scalar may differ slightly from the Phase-101/102 value on books with interior guard NaN — expected under the dailies-canonical principle; surface if the live Zavara re-derive backfill shows a delta.

## Next Phase Readiness
- Shared helper + guard + probe complete; 100% module coverage; mypy strict clean. 103-02 can wire both derive sites with no signature churn.

## Self-Check: PASSED

- Files verified on disk: `services/basis_series.py`, `tests/test_basis_series.py`, `103-PROBE-OQ1.md`, `103-01-SUMMARY.md` — all FOUND.
- Commits verified in git log: `05eca5df`, `250e5d21`, `c631c165`, `404b7cc1`, `d77d8f6f` — all present.
- Working tree clean (`.planning/` artifacts correctly gitignored/local, never staged).

---
*Phase: 103-mtm-daily-series-charts-follow*
*Completed: 2026-07-12*
