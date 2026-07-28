---
phase: 93-composite-data-path-correctness
plan: 04
subsystem: analytics-composite-reconstruction
tags: [HARD-05, ccxt, reconstruction, option-a, combine_realized_and_funding, flow-terminus, composite, byte-consistency]

# Dependency graph
requires:
  - phase: 93-composite-data-path-correctness
    plan: 03
    provides: "the degraded_members DQ channel + complete_with_warnings promotion + drop-stale heal this plan attaches the reconstruction ATTEMPT to (additive reason code, no frontend churn)"
provides:
  - "_reconstruct_ccxt_member — a per-member sibling to _reconstruct_deribit that reconstructs a Bybit/OKX/Binance composite member HONESTLY through the SAME derive-path primitives the single-key broker path uses (combine_realized_and_funding + ccxt_rows_to_dated_flows + FLOW-04 noise guard + MUST-2 upnl_unreadable + DQ-02 evidence-gated flow-coverage terminus), one venue-generic branch (only the funding-fetch dispatch differs per venue)"
  - "try-reconstruct-then-degrade routing in run_stitch_composite_job: a reconstructable ccxt member joins the stitch (guard flags union by the EXISTING per-member meta loop); a structural failure degrades via 93-03's channel with the additive reason 'reconstruction_failed'; 429/geo stay TRANSIENT (whole-job retry, never a member degrade)"
  - "byte-consistency pin (rtol 1e-12): the reconstructed member series equals a direct-primitive reference on the same fixtures — no fork of the derive MATH"
affects: [composite-factsheet, wizard-sync-preview, job_worker, composite-read-path]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Per-member reuse of the derive-path primitives (NOT a fork): _reconstruct_ccxt_member composes the exact combine_realized_and_funding + terminus calls run_derive_broker_dailies_job uses; the derive orchestrator is untouched (SC-4 git-diff-empty gate)"
    - "Function-local imports of the derive primitives added inside the helper (Plan-checker Note 2 — they are imported function-locally in run_derive_broker_dailies_job, NOT in run_stitch_composite_job's scope)"
    - "try-reconstruct-then-degrade: except (NavReconstructionError, *_PERMANENT_LEDGER_ERRORS) -> degrade reason 'reconstruction_failed'; except ccxt.RateLimitExceeded -> _stamp_429 + TRANSIENT; is_geo_blocked -> TRANSIENT; finally aclose (no double-close)"
    - "Offline test pattern (92-02 Layer-3): mock ONLY the I/O fetch primitives at their SOURCE modules; the valuation/combine/terminus MATH runs REAL; within-retention member windows keep the DQ-02 terminus a no-op so the byte-consistency reference is combine+clip exactly"

key-files:
  created: []
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/tests/test_stitch_composite_job.py

key-decisions:
  - "Option A (honest reconstruction) removes 'only Deribit composites work' as a limitation, layered on 93-03's degrade channel as the fallback. Reason codes are additive: a supported ccxt venue now either RECONSTRUCTS (joins the stitch) or degrades with 'reconstruction_failed' — the old unconditional 'venue_reconstruction_unavailable' is now dead for supported venues (an unknown venue stays PERMANENT structural fail, never a degrade)."
  - "The derive orchestrator (run_derive_broker_dailies_job) is DELIBERATELY not refactored (SC-4). The helper composes the same IMPORTED primitives rather than extracting a shared orchestrator — the primitives carry the MATH, so no fork of math exists (research Pitfall 3 satisfied at the primitive layer). The git-diff-empty acceptance gate on that function passes (both diff hunks live inside run_stitch_composite_job; the only mentions of the derive fn in the diff are docstring references)."
  - "A reconstructed ccxt member appends its signal (venue=bybit, has_option_activity=False) so mark_to_market_available returns (False, mtm_basis_unavailable_for_venue) — the composite is correctly cash-only. A DEGRADED ccxt member is continue'd before its signal is appended, so member_signals stays Deribit-only and MTM can still admit the perp-only remainder (Plan-checker Note 1, unchanged)."
  - "The 4 Plan 93-03 ccxt degrade tests are a legitimate contract update (not a parity break): they encoded the pre-93-04 unconditional-degrade behavior this plan deliberately changes to try-reconstruct-then-degrade. Updated to assert reason 'reconstruction_failed' with the fetch layer mocked to raise structurally. The all-Deribit / single-key parity tests are byte-unchanged."

requirements-completed: [HARD-05]

# Metrics
duration: ~55min
completed: 2026-07-11
---

# Phase 93 Plan 04: Honest ccxt member reconstruction (HARD-05 Option A) Summary

**A Bybit/OKX/Binance composite member now RECONSTRUCTS honestly through the SAME primitives the single-key derive path uses — `combine_realized_and_funding` + `ccxt_rows_to_dated_flows` + the FLOW-04 noise guard + the MUST-2 `unrealized_pnl_unreadable` stamp + the DQ-02 evidence-gated flow-coverage terminus — via a new `_reconstruct_ccxt_member` sibling to `_reconstruct_deribit` (one venue-generic branch; only the funding-fetch dispatch differs per venue). The routing is try-reconstruct-then-degrade: a reconstructable member joins the stitch and its guard flags union into `merged_flags` by the existing per-member meta loop; a member whose reconstruction fails structurally falls back to Plan 93-03's degrade channel with the additive reason `reconstruction_failed`; a 429 / geo-block stays TRANSIENT (whole-job retry, never a member degrade). The reconstructed series is byte-consistent (rtol 1e-12) with a direct-primitive reference — no fork of the derive math. The shared derive orchestrator (`run_derive_broker_dailies_job`) is byte-identical (SC-4). NO migration. Closes HARD-05 offline; the live Railway ccxt canary is the NON-BLOCKING user corroboration gate.**

## Task 1 — `_reconstruct_ccxt_member` + try-reconstruct-then-degrade routing (commit `360bceb2`)

- Added `async def _reconstruct_ccxt_member(ctx, venue) -> tuple[pd.Series, bool, dict]` inside `run_stitch_composite_job`, composing the derive block's calls VERBATIM in order: equity/wedge read (`fetch_account_equity_and_upnl_usd`) → full-history trades (`fetch_all_trades`, module global) → per-venue funding dispatch (`fetch_funding_{binance,okx,bybit}`, label = `strategy_id`, rows consumed in-memory only, never upserted) → SHARED retention-bounded transfers (`flow_retention_floor` + `fetch_ccxt_transfers`) → `_resolve_ccxt_flow_price_index` (module-level) → `ccxt_rows_to_dated_flows` → FLOW-04 noise guard (balance_error / equity None / `abs(equity) <= DUST_NAV_FLOOR` → wedge 0.0) → `combine_realized_and_funding(...)` → MUST-2 `unrealized_pnl_unreadable` on a trustworthy anchor → the CRITICAL-1 evidence-gated terminus (`flow_coverage_terminus_day` → `negative_nav_guard_pre_terminus` + `flow_coverage_gap_evidence` gate → `apply_flow_coverage_terminus` → `meta["flow_coverage_incomplete"]`). Returns `(returns, False, dict(meta))`.
- **Function-local imports (Plan-checker Note 2):** grepped each primitive first; the derive primitives (`combine_realized_and_funding`, the five `services.nav_twr` terminus helpers + `DUST_NAV_FLOOR`, `fetch_account_equity_and_upnl_usd`, `fetch_ccxt_transfers`, `ccxt_rows_to_dated_flows`, `fetch_funding_*`) are imported function-locally inside `run_derive_broker_dailies_job`, NOT in the stitch scope — added them inside the helper. `fetch_all_trades` is a job_worker module global and `_resolve_ccxt_flow_price_index` is module-level (referenced directly). `NavReconstructionError` is already imported function-locally at the top of `run_stitch_composite_job`.
- **Routing:** the `venue in _COMPOSITE_DEGRADE_VENUES` arm now `try: returns, has_opt, member_meta = await _reconstruct_ccxt_member(ctx, venue)`:
  - `except (NavReconstructionError, *_PERMANENT_LEDGER_ERRORS)` (structural) → append `{seq, venue, reason:"reconstruction_failed"}` + `venues.append(venue)` + `continue`. Never `_stamp_failed`, never a whole-job PERMANENT. Leak discipline: the scrubbed exception text is DROPPED — the record stays the closed `{seq, venue, reason}` set with a fixed literal reason.
  - `except ccxt.RateLimitExceeded` → `_stamp_429` + TRANSIENT DispatchResult (mirror the deribit arm).
  - geo-block (`is_geo_blocked`) → TRANSIENT DispatchResult (mirror the deribit arm).
  - `finally: await aclose_exchange(ctx.exchange)` — closes on EVERY path (success, degrade-continue, transient-return); no double-close (the old degrade arm's explicit `aclose` was removed in favor of the finally).
  - On success: `clipped.append((seq, clip_to_window(...)))`, `signals.append(MemberBasisSignal(seq, venue, has_option_activity=False))`, `venues.append(venue)`, `metas.append(member_meta)`, `continue` — the downstream clip/stitch/coverage_mask/member-guard loop is venue-agnostic and UNCHANGED.
- **SC-4 non-refactor:** `run_derive_broker_dailies_job` is NOT modified — the helper composes the same imported primitives. Verified by the git-diff-empty gate (below).

## Task 2 — offline proofs: mixed-venue stitch, byte-consistency, degrade, transient, guard-union (commit `9ccecf16`)

Five new offline tests (mock ONLY the I/O fetch primitives at their SOURCE modules — `services.exchange`, `services.job_worker.fetch_all_trades`, `services.funding_fetch`, `services.ccxt_flow_fetch`, `services.job_worker._resolve_ccxt_flow_price_index`; the valuation/combine/terminus MATH runs REAL). New harness helpers: `_ccxt_realized`, `_ccxt_funding`, `_ccxt_fetch_patches`.

1. `test_ccxt_member_reconstructs_and_joins_stitch` — a Deribit+Bybit composite where the Bybit member reconstructs: no `degraded_members`, seq-2 `per_key` `n_days > 0`, csv carries 2026-06 rows.
2. `test_ccxt_reconstructed_series_byte_consistent_with_primitives` — the seq-2 persisted rows equal, at **rtol 1e-12**, a reference built by calling `combine_realized_and_funding` directly on the same inputs then `clip_to_window` (terminus is a no-op for the within-retention window — see below). A forked/divergent orchestration goes RED.
3. `test_ccxt_structural_failure_degrades_stitch_is_deribit_only` — `ccxt_rows_to_dated_flows` raises `NavReconstructionError` → `complete_with_warnings`, `degraded_members == [{seq:2, venue:"bybit", reason:"reconstruction_failed"}]`, stitched csv = Deribit-only.
4. `test_ccxt_rate_limit_is_transient_not_a_degrade` — the equity fetch raises `ccxt.RateLimitExceeded` → whole-job TRANSIENT, `_stamp_429` awaited once, no degrade persisted.
5. `test_ccxt_member_guard_flag_unions_into_merged_flags` — a healthy anchor with an unreadable wedge (`upnl_unreadable=True`) → the helper's MUST-2 stamp fires `unrealized_pnl_unreadable` (a NAV_TWR_GUARD_KEYS member) → it unions into `merged_flags` and status is `complete_with_warnings`; the member reconstructed (no degrade).

Also updated the 4 Plan 93-03 ccxt degrade tests to the new try-reconstruct-then-degrade contract (see Deviations).

**Terminus no-op rationale (byte-consistency):** the ccxt member fixtures use RECENT (within-retention) dates (`2026-06`). With `now` ≈ 2026-07-11 and Bybit's 365-day retention floor ≈ 2025-07-11, `first_return_day (2026-06-01) > floor` → `flow_coverage_terminus_day` returns None → the terminus is a no-op regardless of flows. So the byte-consistency reference (`combine + clip`) is exact.

## RED → GREEN evidence (TDD)

Genuine RED captured by backing up the implementation, reverting `services/job_worker.py` to HEAD (keeping the test changes), and running the ccxt tests:

```
7 failed, 1 passed, 34 deselected   # pre-Task-1 code (unconditional degrade)
FAILED test_ccxt_member_reconstructs_and_joins_stitch
FAILED test_ccxt_reconstructed_series_byte_consistent_with_primitives
FAILED test_ccxt_structural_failure_degrades_stitch_is_deribit_only
FAILED test_ccxt_rate_limit_is_transient_not_a_degrade
FAILED test_ccxt_member_guard_flag_unions_into_merged_flags
FAILED test_ccxt_member_degrades_not_permanent_fail          # updated: reason flip
FAILED test_mtm_runs_on_deribit_remainder_with_degraded_ccxt_member  # updated: reason flip
```
(The 1 pass is `test_all_ccxt_composite_permanent_no_member_reconstructed` — old code degrades → the zero-reconstructed floor still fails PERMANENT.) After restoring the implementation: `42 passed` on the full stitch file.

## Acceptance evidence

| Check | Command | Result |
|-------|---------|--------|
| helper wired (definition + routing call) | `grep -v '^\s*#' services/job_worker.py \| grep -c "_reconstruct_ccxt_member"` | 2 (>= 2) |
| derive path byte-identical (SC-4) | `git diff -U0 services/job_worker.py \| grep '^@@'` | both hunks inside `run_stitch_composite_job` (3113+, 3316+); the 2 derive-fn mentions are docstring refs only |
| mypy | `mypy services/job_worker.py` | Success, 0 issues |
| stitch file (5 new + 37 pre-existing) | `pytest tests/test_stitch_composite_job.py -q` | 42 passed |
| parity set + broker_dailies | `pytest test_composite_headline_parity + test_golden_parity + test_metrics_parity + test_broker_dailies -q` | 86 passed |
| full analytics suite | `.venv/bin/python -m pytest -q` | 3599 passed, 92 skipped, 0 failed |
| no migration | `git status --porcelain supabase/migrations/` | empty |

## Deviations from Plan

### 1. [Rule 1 — contract update] 4 Plan 93-03 ccxt degrade tests migrated to try-reconstruct-then-degrade

- **Found during:** Task 2 (blast-radius run).
- **Issue:** the 93-03 tests (`test_ccxt_member_degrades_not_permanent_fail`, `test_all_ccxt_composite_permanent_no_member_reconstructed`, `test_degraded_member_leak_discipline_closed_keys_no_magnitude`, `test_mtm_runs_on_deribit_remainder_with_degraded_ccxt_member`) encoded the pre-93-04 UNCONDITIONAL degrade behavior — a ccxt member always degraded with reason `venue_reconstruction_unavailable`, with the fetch layer never invoked. Under this plan those members ATTEMPT reconstruction first, so with an un-mocked AsyncMock exchange the behavior is undefined.
- **Fix:** mocked the ccxt fetch layer to raise structurally (`flows_raise=NavReconstructionError(...)`) so the members still exercise the degrade channel, and updated the reason assertions `venue_reconstruction_unavailable` → `reconstruction_failed`. Their structural intent (no PERMANENT for a supported ccxt venue; per_key n_days 0; closed-key leak discipline; MTM admits the Deribit remainder) is preserved.
- **Files:** `analytics-service/tests/test_stitch_composite_job.py`. **Commit:** `9ccecf16`.

Not scope creep — the pins encoded the pre-HARD-05-Option-A contract this plan deliberately supersedes. The all-Deribit `test_degraded_members_drop_stale_on_all_deribit_restitch` (seed data only) and `test_unknown_venue_member_still_permanent_fail` are byte-unchanged; the parity set + single-key derive tests are byte-identical.

## Non-blocking live gate

Per the plan verification, the full Railway ccxt canary with real Bybit/OKX/Binance read-only keys (mirrors SC-3 piece 3 / the Zavara Deribit acceptance) is the user's corroboration gate and is **documented as NON-BLOCKING** — the offline fixtures + the rtol-1e-12 byte-consistency pin close the requirement. NOT run here (no live keys in the executor context). This is the accepted closure basis: honest offline reconstruction proven byte-consistent with the derive semantics, NOT a live-attested ccxt onboarding. Do not claim live attestation.

## Deferred follow-up

**Derive/stitch orchestration consolidation.** `_reconstruct_ccxt_member` intentionally MIRRORS the `run_derive_broker_dailies_job` ccxt block (composing the same imported primitives) rather than extracting a shared orchestrator (SC-4 kept the derive path byte-identical this phase). A future refactor could factor the shared crawl→value→combine→terminus sequence into one helper both paths call — deferred to avoid touching the byte-identical derive path under this phase's parity gate.

## Threat surface scan

No new network endpoints, auth paths, or file access. The reconstruction reuses the EXISTING authenticated ccxt adapters + `_allocator_key_preflight` (worker-only decrypt, T-86-09 untouched) and the EXISTING persist surfaces (csv_daily_returns, strategy_analytics jsonb — no new columns). The degrade record stays the closed `{seq, venue, reason}` set with `reason` the fixed literal `reconstruction_failed` — no exception text / USD / NAV interpolated (T-93-04-01, pinned by the leak-discipline test). Structural errors degrade (job completes); 429/geo stay typed transient with the `_stamp_429` circuit breaker (T-93-04-03 — the retried-forever class cannot occur). Byte-consistency pin guards series divergence (T-93-04-02). No new packages (T-93-04-SC not triggered). No threat flags.

## Known Stubs

None. The reconstruction is fully wired end-to-end (fetch primitives → combine/terminus → clip → stitch → csv/headline; guard flags → merged_flags; structural failure → degrade channel → both render surfaces via 93-03). Frontend needs no change — the reason codes are additive by design (93-03 renders any degrade entry, reason dropped at the render boundary).

## Self-Check: PASSED

- `analytics-service/services/job_worker.py` — FOUND (`_reconstruct_ccxt_member` helper + try-reconstruct-then-degrade routing; derive fn byte-identical).
- `analytics-service/tests/test_stitch_composite_job.py` — FOUND (5 new tests + 4 updated 93-03 tests + harness helpers).
- Commit `9ccecf16` (Task 2, test) — FOUND.
- Commit `360bceb2` (Task 1, feat) — FOUND.
</content>
</invoke>
