# Phase 74: Funnel Wiring — Both Callers - Context

**Gathered:** 2026-07-05
**Status:** Ready for planning
**Mode:** Autonomous smart-discuss (grey areas auto-decided; rationale below)

<domain>
## Phase Boundary

Route both — and ONLY two — callers of the bug function
`transforms.trades_to_daily_returns_with_status` through the shared pure core
`services.nav_twr.reconstruct_nav_and_twr` (built in Phase 73). Delete the silent
fallback on BOTH branches. Prove the shared, high-blast-radius path is
behavior-preserving on flow-less input BEFORE any adapter (Phase 75+) touches
production data.

This phase does NOT add flows or uPnL. `external_flows` stays empty and
`open_unrealized_usd` stays `0.0` (Phase 77's job). The ONLY intended behavior
change is that `estimated_start <= 0` accounts now FLAG (`complete_with_warnings`,
guarded-day NaN) instead of silently substituting today's balance as the base —
the honest divergence the milestone exists to deliver.
</domain>

<decisions>
## Implementation Decisions

### Locked (from PROJECT.md / STATE.md / roadmap)
- Realized-basis only this phase. `open_unrealized_usd=0.0`, `external_flows=None`.
- 252 universal annualization for daily `r_t` unchanged; TWR-05 CAGR split (Phase 73) already landed.
- Phase 78 golden-parity is the HARD GATE before the shared path flips in
  production. This phase must leave flow-less accounts byte-identical.

### Grey areas — auto-decided (Claude's discretion, documented)
1. **The silent fallback branches to delete:** `estimated_start <= 0 -> account_balance`
   substitution (transforms.py ~L154-159) and the forbidden
   `prev_equity.replace(0, initial_capital)` (~L175). Both deleted — the core's
   fail-loud guards replace them. Planner must grep-prove exactly these are the
   fallback sites and nothing else re-introduces them.
2. **Caller set — CORRECTED by 74-RESEARCH.md (the "only two" premise was wrong).**
   The shared function has FOUR production call sites across TWO branches:
   - Direct `_with_status` (TWR-04): `analytics_runner.py:1309`,
     `broker_dailies.py:130` (→ `job_worker.py:2010` live + `scripts/bybit_reconcile.py:660`).
   - Via the `trades_to_daily_returns` wrapper (TWR-03): `process_key.py:896`
     (heuristic, `account_balance=None`) and `portfolio.py:2260` (the
     individual-trades branch `transforms.py:178-212`, which phase 73's SC-4 pin
     never covered).
   **Decision:** DELEGATE the transforms body to the core so all four go honest
   with ONE diff (close the whole class, not point-fixes) — deleting the silent
   fallback on BOTH branches (`transforms.py:154` daily_pnl AND `:199`
   individual-trades). This needs a NEW extract-aggregate helper (the core does
   no notional/fee aggregation, which the individual-trades branch requires) and
   a NEW individual-trades byte-identity pin (the daily_pnl SC-4 pin already
   exists at module level). Phase 78 parity MUST cover BOTH branches.
3. **estimated_start<=0 accounts previously showing fabricated returns:** now flag
   + emit guarded-day NaN. Accept the divergence. Verify downstream consumers
   render NaN/flagged honestly (blank/flagged factsheet, never a fabricated
   magnitude). This is the intended, in-thesis change.
4. **Status wiring:** `computation_status_hint` from nav_twr
   (`complete` / `complete_with_warnings`) must wire into
   `strategy_analytics.computation_status` and its consumers. Preserve existing
   status semantics for the `complete` (flow-less, healthy) path.
5. **Fail-loud propagation:** `NavReconstructionError` (permanent/structural)
   must NOT be swallowed as a retryable network error by the worker's over-catch.
   Watch the pre-existing mig-038 `sync_strategy_analytics_status`
   "any failed_final→failed" retry-poisoning interaction (STATE blocker) — do not
   worsen it; flag if this phase touches that surface.

### Behavior-preservation proof (the phase's success bar)
- Caller-level parity pin: for flow-less / `estimated_start > 0` accounts, the new
  path's returns Series is byte-identical (rtol 1e-12) to the old path — at BOTH
  call sites. (nav_twr already has the module-level SC-4 pin
  `test_zero_flow_byte_identical`; this phase adds the wiring-level pin.)
- Shadow/dual-compute until the parity pin is green.
</decisions>

<code_context>
## Existing Code Insights

- Bug function: `analytics-service/services/transforms.py:70`
  `trades_to_daily_returns_with_status`; internal wrapper
  `trades_to_daily_returns` at :64.
- Caller: `analytics-service/services/analytics_runner.py:1309`
  (`returns, returns_meta = trades_to_daily_returns_with_status(...)`), with the
  `ReturnsComputationMeta` consumed near :1695.
- Core to route through: `services.nav_twr.reconstruct_nav_and_twr(daily_pnl,
  anchor_nav, *, external_flows=None, open_unrealized_usd=0.0)` →
  `(returns, NavTWRMeta)`; `NavReconstructionError` for structural failures.
- Plan-phase research must map: the full status-consumer set (~8) reading
  `computation_status`, and confirm the exact caller/fallback grep facts above.
</code_context>

<specifics>
## Specific Ideas

- Prefer delegating the old function's body to the core over a parallel
  reimplementation — one honest path, delete the fallback, keep the public
  signature the callers use (or update both callers) — whichever is the smaller,
  more behavior-preserving diff.
- Regression tests must be mutation-honest (fail if the fallback deletion is
  reverted, and fail if the byte-identity is broken).
</specifics>

<deferred>
## Deferred Ideas

- Dated external flows (Deribit Phase 75; ccxt venues Phase 76).
- uPnL basis reconciliation (Phase 77).
- Short-window CAGR DQ flag (tracked in TODOS.md; Phase 78 gate).
- Golden old-vs-new parity panel + P72 acceptance canary (Phase 78).
</deferred>
