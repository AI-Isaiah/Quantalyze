---
phase: 74-funnel-wiring-both-callers
plan: 02
subsystem: analytics
tags: [nav-twr, flow-aware-twr, transforms, delegation, honest-divergence, tdd]
requires:
  - services/nav_twr.py (reconstruct_nav_and_twr, NavTWRMeta, NavReconstructionError)
  - services/transforms.py (trades_to_daily_returns_with_status — both branches)
  - services/broker_dailies.py (combine_realized_and_funding)
provides:
  - Both direct callers routed through the Phase-73 honest core (daily_pnl AND
    individual-trades branches); both silent fallbacks (estimated_start<=0 ->
    account_balance substitution + prev_equity.replace(0) base swap) DELETED
  - Guard-key-carrying meta contract: trades_to_daily_returns_with_status now
    returns a NavTWRMeta carrying dust_nav_guard / negative_nav_guard /
    flow_dominated_guard onto the meta (input to 74-03's DQF lift)
  - external_flows / open_unrealized_usd kwargs threaded through both callers
    (defaults None / 0.0 — every production call site byte-identical this phase)
affects:
  - Plan 74-03 (lifts the guard keys into data_quality_flags + status promotion;
    catches NavReconstructionError permanently)
  - Plan 74-04 (job_worker broker path: NavReconstructionError catch + NaN-safe
    csv_daily_returns upsert)
tech-stack:
  added: []
  patterns:
    - "Delegate-to-core: transforms body reconstructs NAV backward from the real
      anchor (reconstruct_nav_and_twr) on BOTH branches; no forward equity curve"
    - "Anchor algebra byte-identity: real anchor_nav=account_balance; heuristic
      anchor_nav=base+total_pnl (synthetic terminal) both reproduce the old
      forward curve to rtol 1e-12 for estimated_start>0 accounts (SC-4)"
    - "Meta-merge: fold core guard flags with transforms-side heuristic/balance_error
      (heuristic OR balance_error OR any guard -> complete_with_warnings)"
    - "Mutation-honest source-scan pins ban the fabrication token class in source"
key-files:
  created: []
  modified:
    - analytics-service/services/transforms.py
    - analytics-service/services/broker_dailies.py
    - analytics-service/tests/test_transforms.py
    - analytics-service/tests/test_broker_dailies.py
    - analytics-service/tests/test_nav_twr.py
decisions:
  - "Real-anchor sub-branch passes anchor_nav=account_balance; heuristic sub-branch
    passes anchor_nav=base+total_pnl (synthetic terminal) — both byte-identical for
    estimated_start>0; the ONLY behaviour change is estimated_start<=0 now FLAGS"
  - "C-0233 fixture retuned $500k->$1.5M: the $500k+$1M-day case implied a
    physically-impossible estimated_start=-505k that the honest core now guards;
    $1.5M keeps the regression testing dust-decoupling with estimated_start>0"
  - "Two legacy tiny-base tests (test_returns_are_finite, test_fees_reduce_returns)
    anchored to realistic balances — their ~$10 net-flat synthetic bases are now
    correctly dust-guarded to NaN; their intent needs a real base"
metrics:
  tasks_completed: 3
  files_modified: 5
  tests_added: 7
  full_suite: "2966 passed, 92 skipped"
  completed: 2026-07-05
requirements: [TWR-03, TWR-04]
---

# Phase 74 Plan 02: Funnel Wiring — Both Callers Delegation Summary

The core wiring diff. `transforms.trades_to_daily_returns_with_status` — the ONE
shared function every venue and all four production call sites
(analytics_runner.py:1309, broker_dailies.py:130, process_key.py:896,
portfolio.py:2260) flow through — now delegates BOTH internal branches (daily_pnl
and individual-trades) to the Phase-73 honest core `nav_twr.reconstruct_nav_and_twr`.
The two silent fallbacks (the `estimated_start <= 0 -> account_balance`
substitution and the forbidden `prev_equity.replace(0, initial_capital)` base
swap) are DELETED on both branches. Every flow-less / `estimated_start > 0`
account is byte-identical to rtol 1e-12; the ONLY intended behaviour change is
that an `estimated_start <= 0` account now FLAGS (NaN + `negative_nav_guard` +
`complete_with_warnings`) instead of fabricating a magnitude.

## What Was Built

- **Task 1 — daily_pnl branch delegated** (`transforms.py`): kept the aggregation
  (`groupby("date")["daily_pnl"].sum()`) and the dust check; replaced the
  equity-curve block with a `reconstruct_nav_and_twr` call. Real-anchor
  sub-branch passes `anchor_nav = account_balance`; heuristic sub-branch keeps
  the `max(mean_abs_pnl*100, abs(total_pnl), 10000)` base and passes a synthetic
  terminal `base + total_pnl`. Added `_merge_status_meta` (folds core guard flags
  with heuristic/balance_error; carries the guard keys onto the returned meta).
  Deleted the `else: initial_capital = account_balance` substitution and the
  `.replace(0, ...)` swap. Lazy core import breaks the transforms<->nav_twr cycle.
- **Task 2 — individual-trades branch delegated** (`transforms.py`): added the
  `_individual_trades_daily_pnl` extract-aggregate helper (notional/fee groupby →
  per-day `pnl` Series + first-day net notional for the heuristic base), then
  delegated identically to the daily_pnl branch. Deleted the branch's own
  `estimated_start<=0 -> account_balance` substitution (:196-199) and
  `.replace(0)` swap (:211). This is the ONLY way `portfolio.py:2260` (real fills)
  reaches the honest path (TWR-03 :199). Removed the now-dead shared forward-equity
  end-return — both branches delegate and return early.
- **Task 3 — flow params threaded** (`transforms.py`, `broker_dailies.py`): added
  keyword-only `external_flows: Sequence[Any] | None = None` and
  `open_unrealized_usd: float = 0.0` to `trades_to_daily_returns_with_status`,
  passed into the core call on both branches; forwarded the same two params
  through `broker_dailies.combine_realized_and_funding`. The thin
  `trades_to_daily_returns` wrapper and all four production call sites are
  unchanged (rely on the None/0.0 defaults per the CONTEXT lock — valuation is
  Phase 75).

## The Guard-Key-Carrying Meta Contract (input to 74-03/74-04)

`trades_to_daily_returns_with_status` now returns a **`NavTWRMeta`** (not the bare
3-key `ReturnsComputationMeta`). `_merge_status_meta` builds it:

- The three base keys keep their semantics: `used_heuristic_capital` /
  `balance_error` are the transforms-side signals (the core always yields both
  `False`); `computation_status_hint` is `complete_with_warnings` iff
  **heuristic OR balance_error OR any NAV-denominator guard fired**, else
  `complete`.
- The additive DQ-01 guard keys — `dust_nav_guard`, `negative_nav_guard`,
  `flow_dominated_guard` — are carried THROUGH onto the returned meta, present
  only when they fired.

**74-03 lifts these guard keys into `data_quality_flags` and promotes
`strategy_analytics.computation_status`.** `combine_realized_and_funding` already
returns `dict(meta)`, so the guard keys survive the broker path to 74-04 too.

An `estimated_start <= 0` account (current balance < cumulative PnL, i.e. it
gained more than its whole starting capital) now reconstructs a non-positive
pre-history base; the core's `negative_nav_guard` breaks that day's chain-link
(NaN) instead of substituting today's balance. `NavReconstructionError` (raised
by the core on non-finite input or an orphan flow) is the permanent-structural
signal 74-03/74-04 must catch.

## Byte-Identity: All Four 74-01 Pins Stayed GREEN

Confirmed the revert-proof safety net held across the whole diff:

| Pin | Branch | Result |
|-----|--------|--------|
| `test_byte_identical_daily_pnl_snapshot` | daily_pnl (real anchor) | GREEN rtol 1e-12 |
| `test_byte_identical_individual_snapshot` | individual (real anchor) | GREEN rtol 1e-12 |
| `test_byte_identical_heuristic_snapshot` | heuristic (account_balance=None) | GREEN rtol 1e-12 |
| `test_byte_identical_combine_snapshot` | broker combine (default params) | GREEN rtol 1e-12 |

The anchor algebra makes this exact: for `estimated_start > 0`, backward NAV roll
`NAV_{t-1} = NAV_t - pnl_t` reconstructs day-0 base `account_balance - total_pnl`
= the old forward `initial_capital`, and `r_t = pnl_t / NAV_{t-1}` = the old
`pnl_t / prev_equity_t`, identity by identity.

## Divergence + Fallback-Deletion + Source-Scan Pins (RED -> GREEN, mutation-honest)

- `TestDailyPnlDelegationDivergence`: daily_pnl `estimated_start<=0` → NaN +
  `negative_nav_guard` + `complete_with_warnings`; fallback-deletion pin names the
  fabricated 3000/1500 the deleted branch produced; source-scan bans
  `initial_capital = account_balance`.
- `TestIndividualTradesDelegationDivergence`: individual `estimated_start<=0` →
  NaN + `negative_nav_guard`; fallback-deletion pin names the fabricated 2000/1500;
  comprehensive source-scan bans `.replace(0` AND `else account_balance` on BOTH
  branches.
- `test_external_flows_param_threads_through_combine_to_core`: an orphan flow
  (dated outside the window) passed to `combine_realized_and_funding` reaches the
  core and raises `NavReconstructionError` — proves the wire (not valuation).

Source-scan is fully clean: `grep` for the three banned token classes in
`transforms.py` code returns nothing.

## Deviations from Plan

### Auto-fixed (Rule 1 — consequences of the intended honest divergence)

**1. [Rule 1 — Test] C-0233 fixture retuned to a physically-consistent balance**
- **Found during:** Task 1 (full-suite regression).
- **Issue:** `TestDustThresholdC0233::test_real_balance_below_pnl_spike_still_takes_real_capital_path`
  used `account_balance=$500k` with a `$1M` single-day PnL → `estimated_start =
  500k - 1.005M = -505k`, a physically impossible account (it gained more than it
  ever held). The old code SILENTLY substituted the balance as the base and
  stamped `complete`; the honest core correctly flags it (`negative_nav_guard` →
  `complete_with_warnings`), so the fixture's `== "complete"` assertion broke.
- **Fix:** retuned the fixture to `$1.5M` (still below the old `$2M`
  PnL-derived threshold, so it still exercises the dust-decoupling the C-0233
  regression was written for) with a consistent `estimated_start = 495k > 0` and
  no guard. Intent (real balance below the old threshold takes the real-capital
  path) preserved.
- **Files:** `tests/test_transforms.py` · **Commit:** `9c97f205`

**2. [Rule 1 — Test] Phase-73 divergence test flipped to convergence**
- **Found during:** Task 1.
- **Issue:** `test_nav_twr.py::test_dq_guards_flag_not_substitute` explicitly
  asserted the PRE-wiring divergence — that transforms fabricated `2000/1500`
  while the core flagged. Now that transforms delegates to the core, they AGREE.
- **Fix:** updated the assertion to prove post-wiring CONVERGENCE (transforms
  returns NaN + `negative_nav_guard` + `complete_with_warnings`, matching the
  core). Reverting the delegation re-fabricates the magnitude and fails here.
- **Files:** `tests/test_nav_twr.py` · **Commit:** `9c97f205`

**3. [Rule 1 — Test] Two legacy tiny-base individual tests anchored to real balances**
- **Found during:** Task 2 (full-suite regression).
- **Issue:** `test_returns_are_finite` (sample_trades) and
  `test_fees_reduce_returns` fed the individual-trades heuristic a ~`$10`
  net-flat synthetic base (no account_balance). The honest core's `$1000` dust
  floor correctly guards a sub-dust base to NaN, so their finiteness / ordering
  assertions broke (`NaN < NaN`). These fixtures encoded the old
  fabricated-magnitude behaviour on a degenerate base.
- **Fix:** passed realistic `account_balance` ($100k / $10k) so each exercises
  its true intent (finite returns / fees-reduce-returns) on a real anchor. In
  production `portfolio.py:2260` feeds real fills whose net notional is a real
  position size, so the dust guard is a test-fixture artifact, not a prod concern.
- **Files:** `tests/test_transforms.py` · **Commit:** `eab7af41`

## Known Stubs

None. `external_flows` / `open_unrealized_usd` are intentionally wired-but-inert
this phase (defaults None / 0.0) per the CONTEXT lock; real flow sourcing and
uPnL valuation are Phases 75 / 77. The wire is proven by the param-threading pin.

## Threat Flags

None. T-74-01 (silent re-introduction of a fabricated base) is mitigated by the
source-scan + divergence pins; T-74-04 (malformed input → silent NaN) is mitigated
by the core's `_coerce_float` fail-loud reached through the delegation. No new
security surface, no package installs.

## Deferred / Out-of-scope

- **Pre-existing mypy findings (NOT this diff):** `services/metrics.py:509`
  (`abs(float|None)`) and `services/parity_diff.py:117` (`Any` return) report under
  `mypy --strict` in the local CI-3.12 venv. Both files are OUTSIDE this plan's
  diff and unchanged since Phase 73 (`f875ab63`); the CI comment records them as
  "verified 0 against the CI-pinned deps", so these are local-venv-dep-drift
  artifacts (the B-mypy drift caveat), not regressions. **My changed files
  (`transforms.py`, `broker_dailies.py`, `nav_twr.py`) pass `mypy --strict`
  clean.**

## Verification

- `pytest tests/test_transforms.py tests/test_broker_dailies.py tests/test_accuracy.py tests/test_nav_twr.py` — GREEN.
- All 4 byte-identity pins — GREEN (rtol 1e-12).
- Divergence (both branches) + fallback-deletion + source-scan + param-threading pins — GREEN, mutation-honest (each RED against the pre-refactor code, verified before implementing).
- Source-scan: no banned token class (`initial_capital = account_balance`, `.replace(0`, `else account_balance`) in `transforms.py` code.
- `mypy --strict --follow-imports=silent` on the three changed service files — clean.
- **Full analytics suite (CI-3.12 venv): 2966 passed, 92 skipped** (~35s).

## Commits

- `55e93d91` test(74-02): RED daily_pnl divergence + fallback-deletion + source-scan pins
- `9c97f205` feat(74-02): delegate daily_pnl branch to nav_twr honest core (+ C-0233 & divergence-test updates)
- `5dd636b1` test(74-02): RED individual-trades divergence + fallback-deletion + both-branch source-scan
- `eab7af41` feat(74-02): delegate individual-trades branch via extract-aggregate helper (+ legacy tiny-base tests anchored)
- `a09c656b` test(74-02): RED external_flows param-threading through combine_realized_and_funding
- `bc565ff0` feat(74-02): thread external_flows/open_unrealized_usd through both callers

## Self-Check: PASSED

All 6 commits present in git log; all 5 modified files exist; source-scan clean;
all 4 byte-identity pins GREEN; full suite 2966 passed / 92 skipped.
