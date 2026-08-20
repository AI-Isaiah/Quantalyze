---
phase: 132-smoothed-mtm-worker-persistence
fixed_at: 2026-07-22T00:00:00Z
review_path: .planning/phases/132-smoothed-mtm-worker-persistence/132-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
re_review:
  reviewer: gsd-code-reviewer
  re_reviewed_at: 2026-07-22T00:00:00Z
  fix_range: 60800ee9..a1d03d59
  HIGH-01: RESOLVED
  HIGH-02: RESOLVED
  MED-01:  RESOLVED
  LOW-01:  DEFERRED
  LOW-02:  RESOLVED
  LOW-03:  RESOLVED
  new_findings: 0
  regressions: 0
  verdict: PASS
---

# Phase 132: Code Review Fix Report

**Fixed at:** 2026-07-22
**Source review:** 132-REVIEW.md (verdict PASS-with-fixes: 2 HIGH, 1 MEDIUM, 3 LOW)
**Iteration:** 1
**Branch:** `feat/phase-83-smoothed-mtm` (60800ee9 → a1d03d59, 5 atomic commits)

**Summary:**
- Findings in scope: 5 (HIGH-01, HIGH-02, MED-01, LOW-02, LOW-03)
- Fixed: 5 — every fix TEST-FIRST (RED proven before GREEN, except LOW-02 which is
  itself an oracle-tightening)
- Skipped: 0
- Explicitly deferred (per reviewer + founder directive, NOT counted in scope):
  LOW-01 (smoothed degrade-REASON channel) → Phase 133. HIGH-02's heal does NOT
  depend on it (the by-basis omission + heal-delete are reason-channel-free).

## Fixed Issues

### HIGH-01: Smoothed third pass unbudgeted inside the 15-min derive envelope

**Files modified:** `analytics-service/services/job_worker.py`, `analytics-service/tests/test_mtm_single_key.py`
**Commit:** e6d3758e
**Applied fix:** Mirrored the MTM second pass's FIX-2 machinery EXACTLY (per directive):
the smoothed crawl is bounded to `_MTM_SECOND_PASS_BUDGET_FRACTION` (0.7) × remaining
derive budget computed from `TIMEOUT_PER_KIND["derive_broker_dailies"]` and
`_derive_start`; below the `_MTM_SECOND_PASS_MIN_SECONDS` (60s) floor the pass REFUSES
to start; a bounded-crawl `asyncio.TimeoutError` is caught by a NEW smoothed-local arm.
Both dispositions DEGRADE (smoothed absent from by-basis; cash + MTM ship DONE) — never
the outer transient arm → 3 retries → failed_final. Structural fail-loud (holed-marks
`LedgerValuationError`) unchanged. (a) timeout now attributed to the smoothed pass
(its own log line; never the "cash-pass crawl" message); (b) the outer-arm comment
(":2472 … only ever fires for the cash pass") and the init-block "FAIL-LOUD, a started
pass finishes or fails the whole job" comment corrected — the latter was already false
pre-review (the scalar ValueError degrade existed).
**Tests (RED→GREEN):** `test_smoothed_third_pass_timeout_degrades_not_failed_final`
(RED: outcome was FAILED/transient blaming the cash pass) and
`test_smoothed_third_pass_insufficient_budget_skips_cash_ships` (RED: the smoothed
crawl STARTED on an exhausted budget — 2 ledger calls instead of 1).

### HIGH-02: Stale smoothed series survives a scalar-degrade (Pitfall-5)

**Files modified:** `analytics-service/services/job_worker.py`, `analytics-service/tests/test_mtm_single_key.py`
**Commit:** 99d28c86
**Applied fix:** The single-key smoothed series persist guard changed from
`smoothed_attempted and smoothed_metrics_json is not None` to `smoothed_attempted`
alone; result is the computed `_smoothed_basis_result` on success, `None`
(heal-DELETE via `persist_basis_series(..., basis="smoothed_mtm", result=None)`) on
every attempted-but-degraded path (scalar compute-reject, and the new HIGH-01 budget
refusal / timeout) — mirroring the MTM heal matrix at the same seam.
`smoothed_attempted` is only ever True on option-activity keys → SC-4's
no-smoothed-RPC-on-a-no-option-key is untouched (re-pinned green:
`test_perp_only_skips_smoothed_pass_sc4`). The false "a started-but-failed smoothed
pass fails the WHOLE job upstream" comment replaced; the options→perp-only
reconfiguration stale case remains deferred with the Phase-133
gate-series-read-on-scalar requirement documented in the comment.
**Tests (RED→GREEN):** new `test_smoothed_scalar_degrade_heals_series_row`
(smoothed-only scalar reject → exactly one smoothed persist with result=None, MTM
ships); `test_single_key_derive_helper_valueerror_degrades_and_heals` updated from
pinning the no-heal (2 persists) to pinning THREE heals
{mark_to_market, cash_settlement, smoothed_mtm}.

### MED-01: Composite missing the pre_mark_retention caveat (disclosure asymmetry)

**Files modified:** `analytics-service/services/job_worker.py`, `analytics-service/tests/test_stitch_composite_job.py`
**Commit:** 92c8456a
**Applied fix:** `_reconstruct_deribit` now stamps
`pre_mark_retention_option_dailies` (the `"{ccy}:{day}"` bucket list — same shape as
the single-key stamp) into the returned member meta, gated on
`basis == PNL_BASIS_SMOOTHED_MTM` (only the smoothed pass fetches marks; cash-pass
metas stay byte-identical). The smoothed-pass metas are now KEPT
(`smoothed_member_metas`, empty when the pass doesn't run — SC-4) and a NARROW union
lifts ONLY that one registered flag into `member_warn_flags` → the
`complete_with_warnings` promotion. All other smoothed-pass guard flags remain
discarded (cash-pass metas authoritative, mirroring the MTM Finding-9 discard).
**Test (RED→GREEN):** `test_composite_pre_mark_retention_stamps_complete_with_warnings`
— the bucket rides ONLY the smoothed-basis report (basis-discriminating build mock,
production-faithful), asserts caveat flag + status promotion + that a smoothed-only
`twr_chain_broken` does NOT cross over.

### LOW-02: Harness combine-doubling weakened the pass-arity StopIteration oracle

**Files modified:** `analytics-service/tests/test_stitch_composite_job.py`
**Commit:** 4c7e9aed
**Applied fix (test-only, per the review's own recommendation):**
`test_options_composite_persists_smoothed_while_mtm_gated` now captures the ACTIVE
harness combine mock and asserts the EXACT fan-out arity (2 members × cash+smoothed
= 4 combines, MTM gated off). The concrete hole: that caller sizes `combine_returns`
for both passes (4 entries) and the harness doubles to 8, leaving 4 spare entries
that would silently absorb a duplicate smoothed fan-out (doubled live crawls, same
persisted output). The exact-count assertion reddens on a duplicate fan-out (6) OR a
silently-skipped pass (2), regardless of spare entries. No RED phase exists for an
oracle-tightening against correct code; load-bearing-ness is arithmetic (any arity
change ≠ 4 fails).

### LOW-03: Third on-loop pandas combine on the single-key route (WEDGE-01 class)

**Files modified:** `analytics-service/services/job_worker.py`, `analytics-service/tests/test_mtm_single_key.py`
**Commit:** a1d03d59
**Applied fix:** The single-key smoothed pass's `combine_native_ledger` (it was NOT
already off-loop — confirmed by the RED thread-identity test) now runs via
`asyncio.to_thread`, mirroring the composite arm's WEDGE-01 offload. The cash/MTM
combines are byte-frozen pre-existing on-loop code — deliberately untouched, flagged
in the comment for the WEDGE-01 follow-up sweep.
**Test (RED→GREEN):** `test_smoothed_combine_runs_off_event_loop` — thread-identity
pin on the THIRD combine only (deliberately does not pin cash/MTM either way, so a
future sweep offloading them cannot redden it).

## Deferred (per directive — not a skip)

### LOW-01: No smoothed degrade-reason channel
**Reason:** Reviewer assigns it to Phase 133 (131-03); the founder directive confirms.
HIGH-01/HIGH-02 were implemented reason-channel-free (log + by-basis omission +
heal-delete), so nothing here depends on it. Carry into Phase 133: (1) the reason
channel, (2) the HARD requirement that the series read is gated on the by-basis
scalar key (covers the deferred options→perp-only reconfiguration stale case).

## Gates (all green, run in an isolated worktree then fast-forwarded)

- `pytest tests/ -q`: **4208 passed** (baseline 4203 + 5 new tests), 96 skipped,
  the SAME 3 pre-existing OKX `test_equity_reconstruction.py` failures — ZERO new.
- `mypy --strict --follow-imports=silent services/ routers/ models/`: **Success, 0
  issues (84 files)**.
- **MTM gate byte-unchanged:** `git diff 60800ee9..HEAD -- stitch_composite.py` =
  0 lines; the composite `mtm_ok, mtm_reason = mark_to_market_available(...)`
  decision line intact.
- **Cash/MTM byte-identity:** all 59 deleted lines in the `job_worker.py` diff are
  inside the Phase-132 smoothed code/comments (grep for
  mtm_returns/mtm_gated_reason/mtm_attempted/_mtm_*/MTM_REASON/cash identifiers over
  the deletions = 0 hits); every fix is smoothed-gated; SC-4 pins green
  (`test_sc4_cash_parity_mtm_on_vs_off`, `test_perp_only_skips_smoothed_pass_sc4`,
  `test_perp_only_composite_persists_no_smoothed_artifacts`).
- No pre-existing non-132 test modified; only 132-authored tests touched/added.
- `.planning/` not committed (local-only, per policy).

---

_Fixed: 2026-07-22_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

---
---

# RE-REVIEW (gsd-code-reviewer, independent verification)

**Re-reviewed:** 2026-07-22 · **Range:** `git diff 60800ee9..a1d03d59 -- analytics-service/` · **Depth:** deep
**Files in range:** job_worker.py + test_mtm_single_key.py + test_stitch_composite_job.py. `stitch_composite.py` / `basis_series.py` / `nav_twr.py` byte-untouched in this range.

I re-derived every claim below from the source diff and a fresh suite run — not from the fixer's commit messages.

**Independent gate results:**
- **Suite: 345 passed** across the 9 touched test files at HEAD == a1d03d59 (was 340 pre-fix; +5 new fix tests). ZERO new failures in-scope.
- **mypy --strict** on the 4 changed services: **0 issues**.
- **MTM gate byte-unchanged:** `stitch_composite.py` diff in range = **0 lines**.
- **Cash/MTM byte-identity:** every non-comment deleted `job_worker.py` line in range is smoothed-gated (`_smoothed_*`, the `smoothed_attempted` persist guard, or the `_reconstruct_deribit` return rewritten by MED-01). `grep` of deleted lines for `mtm_returns|mtm_metrics|mtm_attempted|mtm_gated|cash_metrics|cash_returns|cash_settlement` → **0 hits**.

**Per-finding verdict:**

- **HIGH-01 — RESOLVED.** `job_worker.py:2665-2740`. Same FIX-2 derivation as MTM (`_MTM_SECOND_PASS_BUDGET_FRACTION` 0.7 × remaining from `_derive_start`/`TIMEOUT_PER_KIND`, `_MTM_SECOND_PASS_MIN_SECONDS` 60s floor), local `except asyncio.TimeoutError` degrade attributed to the smoothed pass, structural `LedgerValuationError` still fail-loud. Outer-arm comment corrected and accurate. Both new tests genuinely exercise the budget path: the timeout test asserts DONE + by-basis `{mark_to_market}` + `mtm_gated_reason` ABSENT (no mis-attribution); the insufficient-budget test patches the budget to 1.0s → exactly 1 ledger call, by-basis `None`. Each reddens if the budget check/local arm is removed.
- **HIGH-02 — RESOLVED.** `job_worker.py:4098-4122`. Guard is now `smoothed_attempted` alone → attempted-but-degraded (scalar reject + the two new HIGH-01 degrades) heal-DELETEs the stale `smoothed_mtm_daily_returns` row; Pitfall-5 closed. `smoothed_attempted` is option-key-only ⇒ SC-4 intact. The `test_single_key_derive_helper_valueerror_degrades_and_heals` edit (2→3 heals, all `result=None`, basis set gains `smoothed_mtm`) is a strengthening that corrects a test which had pinned the bug as correct — verified against the MTM→smoothed→cash seam order. New `test_smoothed_scalar_degrade_heals_series_row` proves the smoothed-only degrade heals while MTM ships.
- **MED-01 — RESOLVED.** Basis-gated stamp in `_reconstruct_deribit` (:4597) + narrow single-flag union (:5716). Composite now reaches disclosure parity with single-key; the test proves the flag lands on persisted `data_quality_flags`, promotes to `complete_with_warnings`, and that a smoothed-only `twr_chain_broken` does NOT cross over.
- **LOW-02 — RESOLVED.** Exact `call_count == 4` arity oracle restored (reddens on 6 duplicate or 2 skipped fan-out regardless of spare doubled harness entries).
- **LOW-03 — RESOLVED.** Smoothed combine now `await asyncio.to_thread(...)`; thread-identity test pins the THIRD combine off-loop and deliberately leaves cash/MTM unpinned. Cash/MTM combines byte-frozen.
- **LOW-01 — DEFERRED (correctly).** Reason channel goes to Phase 133; verified HIGH-01/02 signal purely via by-basis omission + log + `smoothed_attempted` heal — no reason string read/written, so no hidden dependency.

**New findings:** none. **Regressions:** none (only the 3 pre-existing OKX `test_equity_reconstruction.py` reds remain, out of scope).

## RE-REVIEW VERDICT: **PASS — Phase 132 done.**
All 2 HIGH + 1 MED genuinely resolved at the economics/ops level (not merely green tests); 2 LOW resolved; 1 LOW correctly deferred with its Phase-133 dependency documented. The byte-frozen cash / MTM / MTM-gate surface is provably untouched.

---

_Re-reviewed: 2026-07-22 · Reviewer: Claude (gsd-code-reviewer) · Suite: 345 passed @ a1d03d59 · mypy --strict: clean_
