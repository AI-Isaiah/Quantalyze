# Phase 74: Funnel Wiring — Both Callers - Research

**Researched:** 2026-07-05
**Domain:** Python analytics-service — refactor/wiring of a high-blast-radius money-path function through a shared pure core; fail-loud error propagation; computation_status contract
**Confidence:** HIGH (all claims are file:line-verified against the working tree; no external packages introduced)

## Summary

Phase 74 routes the daily-return computation through the Phase-73 pure core
`nav_twr.reconstruct_nav_and_twr` and deletes the two silent-fallback classes
(`estimated_start <= 0 → account_balance` and `prev_equity.replace(0, …)`) that
fabricate a base and present a wrong denominator as canonical. The core is
already proven byte-identical to the honest `daily_pnl` path (Phase 73 SC-4);
this phase adds the *wiring-level* parity pins at the call sites and lets the
`estimated_start <= 0` account flag+NaN instead of fabricate.

**Two findings materially change the phase shape versus the CONTEXT framing:**

1. **The fallback lives at FOUR source sites, not two, and reaches FOUR
   production call sites, not two.** `transforms.trades_to_daily_returns_with_status`
   has two internal branches (a `daily_pnl` branch and an `individual-trades`
   branch), each with its own `estimated_start<=0` substitution and its own
   `replace(0)`. TWR-03 confirms both branches are in-scope (`transforms.py:154`
   AND `:199`). The function is reached by 2 direct `_with_status` callers
   (`analytics_runner.py:1309`, `broker_dailies.py:130`) **plus** 2 callers of the
   thin `trades_to_daily_returns` wrapper (`process_key.py:896`,
   `portfolio.py:2260`). "Both — and only two" is true only for the TWR-04
   `_with_status` callers; the wrapper adds two transitive production paths that
   the parity pin must cover.

2. **The core does NOT cover the individual-trades branch.** `reconstruct_nav_and_twr`
   consumes an already-aggregated `daily_pnl` Series + an `anchor_nav`. The
   `individual-trades` branch in transforms (`:178-212`) does notional/fee
   aggregation the core never performs, and the Phase-73 SC-4 pin only covered
   the `daily_pnl` branch. `portfolio.py:2260` (verify_strategy) feeds **real
   fills** into that uncovered branch. The planner must extract the daily-PnL
   aggregation from *both* transforms branches, feed the resulting Series to the
   core, and add a NEW byte-identity pin for the individual-trades branch.

**Primary recommendation:** Delegate the *body* of
`transforms.trades_to_daily_returns_with_status` to the core (Architecture A
below) rather than editing the two `_with_status` call sites in place. Keeping
the public `(trades, account_balance, balance_error) -> (Series, meta)` signature
means all four call sites (2 direct + 2 via wrapper) route through the core with
one diff, TWR-03's "both branches" is satisfied structurally, and the existing
`ReturnsComputationMeta` consumer contract is preserved. Preserve the
heuristic-capital sub-branch (it already flags honestly); delete only the
`estimated_start<=0` substitution and the `replace(0)` swap on both branches.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Daily-PnL aggregation from raw records (groupby, sign, fees) | analytics-service `transforms.py` | — | Format-specific (daily_pnl vs individual-trades) parsing stays at the adapter boundary; the core is format-agnostic |
| NAV reconstruction + chain-linked TWR + fail-loud denominator guards | analytics-service `nav_twr.py` (Phase 73 core) | — | Single honest math path; already SC-4-pinned |
| `computation_status` promotion (`complete` / `complete_with_warnings`) | analytics-service `analytics_runner.py:1751-1788` | `job_worker.py` (broker path) | The runner owns the strategy_analytics upsert; only it gates the 8 frontend consumers |
| `computation_status` UI bridge from compute_jobs aggregate | Postgres `sync_strategy_analytics_status` (mig-038) | — | Overwrites the runner's status post-dispatch; **Phase 74 must not modify it** |
| Structural-failure classification (permanent vs transient) | analytics-service `job_worker.classify_exception` + typed callsite catches | — | `NavReconstructionError` must land permanent, mirroring `LedgerValuationError` |
| Factsheet rendering / status gating | Next.js frontend (8 consumers) | — | Read-only consumers of `computation_status === "complete"` |

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TWR-03 | Delete the silent `estimated_start ≤ 0 → account_balance` fallback at `transforms.py:154` **and** `:199` (both branches) unconditionally; replace with fail-loud DQ guards; regression-tested on both branches. | Both fallback sites mapped below (daily_pnl `:154-159`+`:175`; individual-trades `:196-199`+`:211`). Core's `_guard_denominator` (`nav_twr.py:233-256`) is the fail-loud replacement. Divergence-pin fixture pattern already exists (`test_nav_twr.py`, `2000/1500`). |
| TWR-04 | Route both callers (`broker_dailies.py:130`, `analytics_runner.py:1309`) through the core with `external_flows` + `open_unrealized_usd`; zero-flow input reproduces today's output byte-for-byte before any adapter touches prod data. TWR-05 annualization delta is separately gated — do not conflate. | Core `reconstruct_nav_and_twr(daily_pnl, anchor_nav, *, external_flows=None, open_unrealized_usd=0.0)` verified (`nav_twr.py:293-319`). SC-4 byte-identity already holds for the daily_pnl branch; wiring pins + individual-trades pin specified below. |
</phase_requirements>

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Realized-basis only this phase. `open_unrealized_usd=0.0`, `external_flows=None`.
- 252 universal annualization for daily `r_t` unchanged; TWR-05 CAGR split (Phase 73) already landed.
- Phase 78 golden-parity is the HARD GATE before the shared path flips in production. This phase must leave flow-less accounts byte-identical.

### Claude's Discretion
1. **Silent fallback branches to delete:** `estimated_start <= 0 -> account_balance` (transforms.py ~L154-159) and `prev_equity.replace(0, initial_capital)` (~L175). Both deleted — core fail-loud guards replace them. Planner must grep-prove exactly these are the fallback sites and nothing else re-introduces them.
2. **Exactly two callers:** recon shows `transforms.trades_to_daily_returns` (wrapper) and `analytics_runner.py:~1309`. Planner MUST grep-prove the caller set; a third caller is a planning defect to surface, not silently absorb. **[SEE FINDING 1 — the caller set is larger than two; documented below.]**
3. **estimated_start<=0 accounts:** now flag + emit guarded-day NaN. Accept the divergence. Verify downstream consumers render NaN/flagged honestly (never a fabricated magnitude). Intended, in-thesis change.
4. **Status wiring:** `computation_status_hint` (`complete` / `complete_with_warnings`) must wire into `strategy_analytics.computation_status` and its consumers. Preserve existing status semantics for the `complete` (flow-less, healthy) path.
5. **Fail-loud propagation:** `NavReconstructionError` (permanent/structural) must NOT be swallowed as retryable network error by the worker's over-catch. Watch the mig-038 `sync_strategy_analytics_status` "any failed_final→failed" retry-poisoning interaction (STATE blocker) — do not worsen it; flag if this phase touches that surface.

### Behavior-preservation proof (success bar)
- Caller-level parity pin: for flow-less / `estimated_start > 0` accounts, the new path's returns Series is byte-identical (rtol 1e-12) to old — at BOTH call sites. nav_twr already has the module-level SC-4 pin; this phase adds the wiring-level pin.
- Shadow/dual-compute until the parity pin is green.

### Deferred Ideas (OUT OF SCOPE)
- Dated external flows (Deribit Phase 75; ccxt venues Phase 76).
- uPnL basis reconciliation (Phase 77).
- Short-window CAGR DQ flag (TODOS.md; Phase 78 gate).
- Golden old-vs-new parity panel + P72 acceptance canary (Phase 78).
</user_constraints>

## Standard Stack

No new packages. Phase is a pure in-repo refactor.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pandas | pinned in `analytics-service/requirements.txt` | Series/groupby aggregation | Already the transforms + core substrate |
| numpy | pinned | backward NAV roll, non-finite guard | Already the core substrate |
| pytest + pytest-cov | pinned | regression + byte-identity pins | `--cov-fail-under=80` gate already enforced |

**Do not add packages.** Verify the venv (below) rather than installing.

## Package Legitimacy Audit

Not applicable — this phase installs no external packages. All code is in-repo
(`services/nav_twr.py`, `services/transforms.py`, `services/broker_dailies.py`,
`services/analytics_runner.py`, `services/job_worker.py`, `routers/portfolio.py`,
`routers/process_key.py`). No `## Package Legitimacy Audit` gate needed.

## Architecture Patterns

### System Architecture Diagram (data flow, current → target)

```
                         raw records (per venue / per format)
                                     │
        ┌────────────────────────────┼─────────────────────────────┐
        │ CSV upload / trades table  │ broker API key (Bybit/       │ unified adapter /
        │ (order_type='daily_pnl' or │ Binance/OKX/Deribit)         │ verify_strategy (real fills)
        │  individual trades)        │ realized + FUNDING           │
        ▼                            ▼                              ▼
  analytics_runner:1309        broker_dailies.combine_        process_key:896 (wrapper) /
  (_with_status direct)        realized_and_funding:130       portfolio:2260 (wrapper)
        │                            │ (_with_status direct)         │  → trades_to_daily_returns
        │                            │  called by                    │     → _with_status
        │                            │  job_worker:2010,             │
        │                            │  bybit_reconcile:660          │
        └──────────────┬─────────────┴───────────────┬───────────────┘
                       ▼                              ▼
        transforms.trades_to_daily_returns_with_status  (THE shared function)
          ├─ daily_pnl branch (:120-176)      ← estimated_start<=0 sub @:154-159, replace(0) @:175
          └─ individual-trades branch (:178-212) ← estimated_start<=0 sub @:196-199, replace(0) @:211
                       │
        TARGET: aggregate to daily_pnl Series here, then delegate ↓
                       ▼
        nav_twr.reconstruct_nav_and_twr(daily_pnl, anchor_nav,
                    external_flows=None, open_unrealized_usd=0.0)
          → backward NAV roll → chain-linked TWR → fail-loud guards (_guard_denominator)
          → (returns Series, NavTWRMeta{used_heuristic_capital, balance_error,
                                        computation_status_hint, +guard flags})
                       │
        ┌──────────────┴───────────────┐
        ▼                              ▼
  analytics_runner:1704-1788     job_worker:2010+ (broker path)
  DQF + computation_status       DQF + status stamp
        │                              │
        ▼                              ▼
  strategy_analytics.computation_status  ←── OVERWRITTEN post-dispatch by
        │                                    sync_strategy_analytics_status (mig-038)
        ▼
  8 frontend consumers gate `computation_status === "complete"`
```

### Pattern 1: Delegate the function body to the core (recommended — Architecture A)
**What:** Keep `trades_to_daily_returns_with_status(trades, account_balance, balance_error)`'s
signature. Inside, do the format detection + daily-PnL aggregation (existing
`groupby` logic), compute `anchor_nav`, then call `reconstruct_nav_and_twr`,
map `NavTWRMeta → ReturnsComputationMeta`, and return. Delete the equity-curve /
`estimated_start<=0` / `replace(0)` blocks on both branches.

**Anchor mapping (verified byte-identity algebra):** transforms computes
`initial_capital = account_balance - total_pnl` then `equity = initial_capital +
daily_pnl.cumsum()`, `prev_equity = equity.shift(1).fillna(initial_capital)`,
`returns = daily_pnl / prev_equity` (`transforms.py:149-176`). The core sets
`terminal_nav = anchor_nav` (F=0, uPnL=0), rolls `NAV_{t-1}=NAV_t-pnl_t`
(`nav_twr.py:179-180`), and computes `r_t = pnl_t / NAV_{t-1}` with day-0 prev =
`NAV_0 - pnl_0 = initial_capital` (`nav_twr.py:218-228`). These are algebraically
identical when `estimated_start>0`, so **`anchor_nav = account_balance`** for the
real-anchor sub-branch. This is exactly what Phase 73's SC-4 pin proves for the
daily_pnl branch.

**Heuristic sub-branch (account_balance None / < dust):** preserve the
`used_heuristic_capital` derivation (`transforms.py:160-169` / `:200-208`). To
route it through the core, pass `anchor_nav = initial_capital + total_pnl`
(synthetic terminal) so the core reconstructs the same synthetic `initial_capital`
and reproduces today's heuristic returns byte-for-byte, while still gaining the
fail-loud guards for the pathological cumsum-to-zero case that `replace(0)` used
to paper over. Alternative: keep the heuristic equity-curve math and only route
the real-anchor sub-branch through the core — **smaller diff but leaves `replace(0)`
alive on the heuristic path**, which TWR-03 forbids. Prefer the synthetic-anchor
route so `replace(0)` is deleted everywhere.

**When to use:** This is the primary recommendation. One diff covers all four call sites.

### Pattern 2: Extract-aggregate helper for the individual-trades branch
**What:** The core cannot ingest individual trades. Factor the notional/fee
`groupby` (`transforms.py:180-188`) into a helper returning a `daily_pnl` Series
(named `pnl`), then feed it to the core exactly like the daily_pnl branch. This
is the ONLY way to bring `portfolio.py:2260` (real fills) onto the honest path
and satisfy TWR-03's `:199` requirement.

### Anti-Patterns to Avoid
- **Editing the two `_with_status` call sites in place while leaving transforms' body intact.** This duplicates aggregation, leaves the wrapper callers (process_key/portfolio) on the old fallback, and violates TWR-03's "both branches, unconditionally."
- **Deleting the heuristic-capital branch.** It is NOT the target fallback; it already flags `complete_with_warnings` and is depended on by `process_key.py:896` (always `account_balance=None`) and every CSV upload. Deleting it would break the landing-page verification card.
- **Reading `computation_status_hint` directly in the runner as the status source.** The runner deliberately does NOT (`analytics_runner.py:1779-1785`); it gates on specific DQF flags so the 8 frontend consumers stay coherent. Wire the new guard flags into the *promotion predicate*, not by swapping to the raw hint.
- **Letting `NavReconstructionError` reach `classify_exception` unhandled.** As a bare `ValueError` it falls through to the catch-all `unknown` bucket → indefinite retry on a permanent data fault (same failure mode called out at `job_worker.py:1869-1871`). Catch it at the callsite like `LedgerValuationError`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fail-loud NAV denominator guard | new clamp/floor/`if base<=0` logic in transforms | `nav_twr._guard_denominator` (`:233-256`) | Already source-scan-enforced against `replace(0)`/`clip`/`max(floor)`; re-inventing re-introduces the banned class |
| Backward NAV reconstruction | manual cumsum/shift equity curve | `nav_twr.reconstruct_nav` (`:154-182`) | Pinned to a numpy oracle + mutation test in Phase 73 |
| Permanent-vs-transient error type | bare `ValueError`/`raise` | `nav_twr.NavReconstructionError` (`:78-83`, a `ValueError` subclass mirroring `LedgerValuationError`) | Lets the worker classify structural failures permanent, not retryable |
| Status hint derivation | new string logic | `NavTWRMeta.computation_status_hint` (`nav_twr.py:268-290`) | Reuses the transforms `_build_meta` convention exactly |

**Key insight:** Phase 73 built the honest primitives and pinned them; Phase 74's
job is *wiring and deletion*, not new math. Every guard/roll/error-type already
exists — hand-rolling any of them re-opens the bug class the milestone kills.

## Runtime State Inventory

This is a code-refactor phase (no rename/migration), but it changes a **stored,
computed value contract** and one **status enum surface**, so the analogous
audit applies:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `csv_daily_returns` (strategy_id/api_key_id, date, daily_return) written from the returns Series (`job_worker.py:2062-2093`) and the `strategy_analytics` metrics row. For `estimated_start<=0` accounts, stored `daily_return` values CHANGE (fabricated → NaN-broken/flagged). | Data is re-derived on next sync/compute; no manual migration. Verify NaN rows serialize honestly (see Pitfall 3) — a `float('nan')` in `float(val)` at `:2068`/`:2078` will raise or write `NaN`. **Must be handled.** |
| Live service config | None. No external service embeds this value. | None — verified: only Postgres tables consume it. |
| OS-registered state | None. | None — pure worker/route code. |
| Secrets/env vars | `BROKER_DAILIES_VIA_FUNDING` kill-switch (`job_worker.py:177-178`) gates whether the broker path runs at all. Phase 74 does not change it, but the parity pin must run with it ON (the live path). | None (flag unchanged). |
| Build artifacts | None. | None. |

**Status-enum surface:** `estimated_start<=0` accounts move from `computation_status='complete'`
(with fabricated metrics) to `'complete_with_warnings'` (with NaN/flagged metrics),
which the 8 frontend consumers gate on. This is the intended divergence (CONTEXT
grey-area #3) — verify honest rendering, do not treat the consumer blanking as a regression.

## Common Pitfalls

### Pitfall 1: The "two callers" undercount (blast radius)
**What goes wrong:** Planning only touches `analytics_runner:1309` + `broker_dailies:130`, leaves the wrapper path (`process_key:896`, `portfolio:2260`) on the old fallback → TWR-03 half-done, which the requirement explicitly calls "the same bug."
**Why it happens:** CONTEXT grey-area #2 asserts "exactly two"; TWR-04 names two; the wrapper is a transitive third/fourth reached through `trades_to_daily_returns`.
**How to avoid:** Delegate the transforms *body* (Pattern 1) so all four are covered by construction. Grep-prove the full set (command below) and pin all four input shapes.
**Warning signs:** A plan task that edits call sites rather than the function body.

### Pitfall 2: Individual-trades branch not covered by the core / SC-4
**What goes wrong:** `portfolio.py:2260` feeds real fills → transforms `:178-212` branch. The core does no notional/fee aggregation and Phase 73's SC-4 pin only covered the daily_pnl branch. Routing fills through the core without the extract-aggregate helper (Pattern 2) either crashes or silently diverges.
**How to avoid:** Add the aggregation helper + a NEW individual-trades byte-identity pin. Cross-check against `test_accuracy.py` fixtures (`trades_to_daily_returns` with known balance, `:167-315`).
**Warning signs:** Only one new parity test; no fixture with `order_type` absent / raw buy-sell rows.

### Pitfall 3: NaN daily_return breaks downstream serialization / metrics
**What goes wrong:** For `estimated_start<=0` accounts the core emits NaN on the days where reconstructed `NAV_{t-1} <= 0` (`_guard_denominator` `:250`). `len(returns)` still counts NaN entries so the `len(returns) < 2` guards (`analytics_runner:1313`, `job_worker:2013`) do NOT trip — but `float(val)` in the `csv_daily_returns` upsert (`job_worker:2068`/`:2078`) and `compute_all_metrics`/`compute_period_returns` may propagate or reject NaN.
**How to avoid:** Verify `compute_all_metrics` + the upsert path tolerate leading/interior NaN (drop vs propagate). Decide policy: skip NaN rows on upsert OR persist as flagged-null. Add a fixture asserting an `estimated_start<=0` account renders honest NaN/flag end-to-end, never a magnitude.
**Warning signs:** A green unit test but no end-to-end assertion on the NaN account.

### Pitfall 4: `NavReconstructionError` misclassified as transient
**What goes wrong:** With `external_flows=None`, the only NavReconstructionError trigger is a non-finite/non-numeric `anchor_nav` or `daily_pnl` (`_coerce_float` `:86-108`). As a bare `ValueError` it escapes to `classify_exception` (`job_worker:312+`) and lands in the catch-all `unknown` bucket → retried indefinitely on a permanent fault.
**How to avoid:** Add a typed callsite catch mirroring `LedgerValuationError` (`job_worker:1916-1935`) at BOTH the broker path (around `:2010`) and the analytics_runner path (around `:1309`/outer `:1896`), stamping a terminal `failed` with a scrubbed message and `error_kind="permanent"`.
**Warning signs:** No test asserting a malformed-input compute stamps `failed` permanent (not retried).

### Pitfall 5: Status-promotion predicate not extended for guard flags
**What goes wrong:** New guard flags (`dust_nav_guard`, `negative_nav_guard`, `flow_dominated_guard`) are added to DQF but the promotion predicate at `analytics_runner:1775-1788` still only checks `used_heuristic_capital`/`balance_error`, so a guard-only run stays `complete` and the factsheet renders the (now-NaN) account as canonical-complete.
**How to avoid:** Extend the `consumer_specific_flags` predicate to include the guard keys (they SHOULD promote to `complete_with_warnings`). Keep the `complete` (no-guard, flow-less) path untouched so byte-identical accounts keep `complete` (CONTEXT grey-area #4).
**Warning signs:** A guard fires but `computation_status` stays `complete` in an integration test.

### Pitfall 6: mig-038 status overwrite (do not worsen)
**What goes wrong:** `sync_strategy_analytics_status` (mig `20260412094454`) recomputes `computation_status` from the compute_jobs aggregate AFTER dispatch: any non-terminal→`computing`, any `failed_final`→`failed`, all `done`→`complete`, no rows→no-op. It can overwrite the runner's `complete_with_warnings`. The STATE blocker is that a `failed_final` row poisons retry-after-failure.
**How to avoid:** **Phase 74 must NOT modify `sync_strategy_analytics_status`.** Its only obligation: ensure `NavReconstructionError` produces a *legitimate* permanent `failed` (Pitfall 4) rather than a spurious one, and that guard-flagged SUCCESS does not create a `failed_final` compute_job (guards are warnings, the job still `done`). Flag in the plan that this surface is read-only for this phase.
**Warning signs:** Any migration file in the plan; any change to `error_kind` mapping for guard flags.

## Code Examples

### Verified core entry (what to wire to)
```python
# Source: analytics-service/services/nav_twr.py:293-319
def reconstruct_nav_and_twr(
    daily_pnl: pd.Series,
    anchor_nav: float,
    *,
    external_flows: Sequence[Any] | None = None,
    open_unrealized_usd: float = 0.0,
) -> tuple[pd.Series, NavTWRMeta]:
    # terminal_nav = anchor_nav - open_unrealized_usd (realized basis)
    # With external_flows empty + open_unrealized_usd == 0.0 the returned
    # Series is byte-identical to the honest transforms daily_pnl path for
    # an estimated_start > 0 account (SC-4).
```

### The exact fallback sites to delete (TWR-03)
```python
# Source: analytics-service/services/transforms.py
# daily_pnl branch:
#   :153  estimated_start = account_balance - total_pnl
#   :154-159  if estimated_start > 0: initial_capital = estimated_start
#             else: initial_capital = account_balance      # <-- DELETE (substitution)
#   :175  prev_equity = prev_equity.replace(0, initial_capital)  # <-- DELETE (zero swap)
# individual-trades branch:
#   :198  estimated_start = account_balance - total_pnl
#   :199  initial_capital = estimated_start if estimated_start > 0 else account_balance  # <-- DELETE
#   :211  prev_equity = prev_equity.replace(0, initial_capital)  # <-- DELETE
```

### Status promotion predicate to extend (Q4)
```python
# Source: analytics-service/services/analytics_runner.py:1775-1788
consumer_specific_flags = (
    (top_level_flags or {}).get("used_heuristic_capital")
    or (top_level_flags or {}).get("balance_error")
    # Phase 74: add guard keys so a broken NAV denominator promotes status:
    # or (top_level_flags or {}).get("negative_nav_guard")
    # or (top_level_flags or {}).get("dust_nav_guard")
    # or (top_level_flags or {}).get("flow_dominated_guard")
)
computation_status_value = (
    "complete_with_warnings" if consumer_specific_flags else "complete"
)
```

### Fail-loud typed catch to mirror (Q5)
```python
# Source: analytics-service/services/job_worker.py:1916-1935 (LedgerValuationError)
except LedgerValuationError as exc:
    scrubbed = str(scrub_freeform_string(str(exc)))
    await _stamp_deribit_analytics_failed(...)
    return DispatchResult(outcome=DispatchOutcome.FAILED,
                          error_message=..., error_kind="permanent")
# Phase 74: add an equivalent `except NavReconstructionError` around the
# combine_realized_and_funding call (:2010) and the analytics_runner path.
```

## Q1 — Exact caller set (grep-proven)

**Direct `_with_status` callers (the TWR-04 "two"):**
- `analytics-service/services/analytics_runner.py:1309` — `returns, returns_meta = trades_to_daily_returns_with_status(trades, account_balance=account_balance, balance_error=False)`. `trades` come from the `trades` table excluding fills (`:1167-1176`) — can be `daily_pnl` OR individual-trades format.
- `analytics-service/services/broker_dailies.py:130` — inside `combine_realized_and_funding`; always `order_type='daily_pnl'` (realized + funding records). Itself called by:
  - `analytics-service/services/job_worker.py:2010` (live `derive_broker_dailies` path, gated by `BROKER_DAILIES_VIA_FUNDING`)
  - `analytics-service/scripts/bybit_reconcile.py:660` (reconciliation harness — reusable as a real-account parity oracle)

**Wrapper (`trades_to_daily_returns`) callers — transitive, in TWR-03 scope:**
- `analytics-service/routers/process_key.py:896` — `account_balance=None` always → heuristic branch; landing-page verification card enrichment.
- `analytics-service/routers/portfolio.py:2260` — `verify_strategy`; feeds **real fills** with a real `account_balance` → **individual-trades branch (`:178-212`), NOT covered by SC-4.**

**Finding:** the phase-name assertion "both — and only two" is accurate ONLY for
the `_with_status` direct callers named in TWR-04. Counting the shared function's
total production reach, there are **four** call sites across two branches. TWR-03
(`transforms.py:154` AND `:199`) confirms both branches are in-scope. Recommended
architecture (delegate the body) makes all four honest with one diff.

**Grep to reproduce (planner acceptance):**
```bash
cd analytics-service
grep -rn "trades_to_daily_returns_with_status\|trades_to_daily_returns\b" \
  --include="*.py" services/ routers/ | grep -v "test_" | grep -v "def \|import \|#"
```

## Q3 — Input shapes per caller / anchor availability

| Caller | Input format | `account_balance` available? | Anchor for core | Branch hit |
|--------|-------------|------------------------------|-----------------|-----------|
| `analytics_runner:1309` | `trades` rows (daily_pnl or individual) | Yes — `api_keys.account_balance_usdt` DB column (may be None/corrupt → DQF) | `account_balance` (real) or synthetic (heuristic) | either |
| `broker_dailies:130` (job_worker) | realized + funding, all `order_type='daily_pnl'` | Yes — `equity` (total NAV incl. uPnL), passed as `account_balance` (`job_worker:2011`) | `equity` | daily_pnl |
| `process_key:896` | unified-adapter trade dicts | No — always `None` → heuristic | synthetic (`initial_capital+total_pnl`) | daily_pnl or individual |
| `portfolio:2260` | real fills from `fetch_all_trades` | Yes — `fetch_usdt_balance` | `account_balance` | **individual-trades** |

**Anchor semantics vs core need:** `anchor_nav` today = current account equity
(`account_balance`); the core treats `terminal_nav = anchor_nav - open_unrealized_usd`
(realized-basis terminal). With `open_unrealized_usd=0.0` (this phase) the core's
terminal == today's `account_balance`, matching transforms' anchor-to-today exactly.
Note the broker path passes `equity` (which *includes* uPnL) as the anchor
(`job_worker:2011`, `broker_dailies:24`) — reconciling that uPnL wedge is explicitly
Phase 77, deferred. For Phase 74 every caller can supply an anchor; no caller needs
a new value.

## Q4 — computation_status wiring, end-to-end

**Producer chain:**
`transforms._build_meta` (`:226-259`) → `computation_status_hint = complete_with_warnings`
iff `used_heuristic_capital OR balance_error`. `NavTWRMeta._build_nav_meta`
(`nav_twr.py:268-290`) additionally sets the hint to `complete_with_warnings` when
any of `dust_nav_guard`/`negative_nav_guard`/`flow_dominated_guard` fired (inherited
keys always False for the core).

**Consumer (the ONLY status-setting caller):** `analytics_runner:1704-1788`.
It does NOT read `computation_status_hint` (deliberate — comment `:1779-1785`).
It (a) lifts `used_heuristic_capital`/`balance_error` into top-level DQF (`:1704-1713`),
then (b) promotes `computation_status` to `complete_with_warnings` ONLY if one of
those two DQF flags is set (`:1775-1788`). The broker path (`job_worker`) writes
`csv_daily_returns` + enqueues CSV analytics, which re-enters this same runner —
so the runner is the single status chokepoint.

**How the guard flags wire in (recommendation):**
1. In the runner's DQF lift (`:1704-1713`), add the three guard keys from
   `returns_meta` to `top_level_flags` (same shape as `used_heuristic_capital`).
2. Extend the promotion predicate (`:1775-1778`) to include the three guard keys
   so a broken-denominator run promotes to `complete_with_warnings`.
3. Leave the `complete` path untouched: a flow-less, `estimated_start>0`, no-guard
   account has zero guard flags → stays `complete` → byte-identical + status-identical
   (satisfies CONTEXT grey-area #4 and the SC-4 invariant).

**8 downstream consumers of `computation_status === "complete"`** (verified list,
`analytics_runner:1760-1767`):
1. `src/app/api/factsheet/[id]/pdf/route.ts:90`
2. `src/app/api/factsheet/[id]/tearsheet.pdf/route.ts:61`
3. `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:113`
4. `src/app/strategy/[id]/page.tsx:134`
5. `src/app/(dashboard)/portfolios/[id]/page.tsx:484`
6. `src/components/strategy/PerformanceReport.tsx:50`
7. `src/components/strategy/SyncProgress.tsx:139`
8. `src/lib/queries.ts:509`

These gate exact-string `=== "complete"`. An `estimated_start<=0` account flipping
to `complete_with_warnings` will be treated by these as NOT-complete (blank/flagged
factsheet, no PDF, hidden metric grid). Per CONTEXT grey-area #3 this is the
**intended** honest divergence — never a fabricated magnitude. The planner should
verify (not change) that these render honestly; migrating them to accept both
states is an explicitly deferred separate PR (`transforms.py:247-249`).

**mig-038 interaction:** `sync_strategy_analytics_status` overwrites
`computation_status` from the compute_jobs aggregate post-dispatch (any
`failed_final`→`failed`). Phase 74 **does not touch this surface** and must not.
Its only obligation is Pitfall 4/6: a guard-flagged SUCCESS keeps the compute_job
`done` (guards are warnings, not failures) so the bridge maps it to `complete`
then the runner's `complete_with_warnings` write is the authoritative one for that
strategy_analytics row; and a genuine `NavReconstructionError` produces a legitimate
`failed_final` (permanent), not a spurious retry-poisoning one. Flag explicitly:
no change to migrations, no change to `error_kind` mapping beyond the typed catch.

## Q5 — NavReconstructionError propagation

- **Type:** `NavReconstructionError(ValueError)` (`nav_twr.py:78-83`), mirrors
  `LedgerValuationError` (`deribit_txn.py:52`).
- **Triggers in this phase (flows=None):** non-numeric/non-finite `anchor_nav`,
  `daily_pnl`, or `open_unrealized_usd` via `_coerce_float` (`:86-108`). The three
  denominator guards do NOT raise — they flag + NaN (`_guard_denominator:233-256`).
- **Current catch topology:** the broker path catches `LedgerValuationError`
  distinctly at `job_worker:1916` (→ permanent, stamped) but
  `combine_realized_and_funding` (`:2010`) is OUTSIDE that try (it follows the
  deribit-ledger try/except). `analytics_runner:1309` sits inside the big outer
  `except Exception as e:` (`:1896`) which wraps to HTTPException(500) →
  `classify_exception` maps 5xx to `unknown` → **retried** (`job_worker:379-380`,
  and the documented over-catch hazard at `:1869-1871`).
- **Required:** add a typed `except NavReconstructionError` at BOTH the broker path
  (around `:2010`) and the analytics_runner path (before the generic `except`),
  stamping a terminal `failed` with a scrubbed message and `error_kind="permanent"`,
  mirroring `:1916-1935`. Regression-test that a malformed-input compute fails
  permanent (not retried).

## Q6 — Behavior-preservation strategy

**Existing anchors to build on:**
- Module SC-4 pin `test_zero_flow_byte_identical` in `tests/test_nav_twr.py`
  (daily_pnl branch, `estimated_start>0`, rtol 1e-12) + the divergence fixture
  (`2000/1500` fabricated vs core NaN) proving the deletion actually happened.
- `tests/test_transforms.py` (wrapper + `_with_status` behavior, incl. the legacy
  heuristic contract `:240-247`), `tests/test_accuracy.py` (`trades_to_daily_returns`
  with known balance, `:167-315`), `tests/test_broker_dailies.py`,
  `tests/test_derive_broker_dailies_dualmode.py`, `tests/test_csv_analytics_runner.py`.
- `scripts/bybit_reconcile.py` — real-account harness comparing
  `combine_realized_and_funding` output vs stored `csv_daily_returns`; reuse as an
  end-to-end parity oracle.

**New wiring-level pins to add (Phase 74):**
1. **daily_pnl call-site pin** — flow-less `estimated_start>0` fixture through
   `trades_to_daily_returns_with_status`: new returns == old returns, rtol 1e-12.
2. **individual-trades call-site pin** — real-fills fixture (no `order_type`):
   new returns == old returns, rtol 1e-12 (covers `portfolio:2260`; NOT covered
   by SC-4 — this is net-new).
3. **broker path pin** — realized+funding records through
   `combine_realized_and_funding`: byte-identical + gap-fill preserved.
4. **mutation-honest divergence pins** — an `estimated_start<=0` fixture must
   assert (a) OLD path fabricates a magnitude (e.g. `2000/1500`), (b) NEW path
   emits NaN + `negative_nav_guard` + `complete_with_warnings`. Test FAILS if the
   fallback deletion is reverted AND FAILS if byte-identity on the healthy path breaks.
5. **status pin** — guard flag → DQF → `complete_with_warnings`; no-guard →
   `complete` unchanged.

**Shadow/dual-compute:** during implementation, compute both old and new Series
and assert equality in the pin before removing the old code, so the parity pin is
green *before* the fallback source is deleted.

## Q7 — Blast radius (Pitfall #12): every venue flows through this function

| Ingestion path | Entry | Venues | transforms branch |
|----------------|-------|--------|-------------------|
| CSV upload / stored trades | `analytics_runner:1309` | any (CSV) | daily_pnl or individual |
| Broker API key realized+funding | `job_worker:2010` → `broker_dailies:130` | Bybit, Binance, OKX, Deribit | daily_pnl |
| Deribit ledger dailies | `job_worker:1887` → `combine_realized_and_funding:130` | Deribit | daily_pnl |
| Unified adapter verification card | `process_key:896` (wrapper) | any | daily_pnl or individual |
| verify_strategy real fills | `portfolio:2260` (wrapper) | any (ccxt fills) | **individual-trades** |

The parity pin set MUST exercise BOTH input formats (daily_pnl records AND raw
buy/sell fills) so all five paths are covered; the individual-trades format is the
one Phase 73 did NOT pin.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Silent `estimated_start<=0 → account_balance` substitution + `replace(0)` fabricate a base | Fail-loud NAV denominator guards (flag + NaN, never substitute) | Phase 73 core landed (2026-07-05); Phase 74 wires it | `estimated_start<=0` accounts flip from fabricated-complete to honest NaN/`complete_with_warnings` |
| Anchor-to-today only (no flows) | Same for Phase 74 (`external_flows=None`); dated flows Phase 75/76 | Phase 74 realized-basis pass | No behavior change for flow-less accounts (byte-identical) |

**Deprecated/outdated after this phase:**
- The four fallback sites (`transforms.py:154-159`, `:175`, `:196-199`, `:211`) — deleted.
- The transforms equity-curve block is superseded by the core's backward roll (aggregation stays).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `compute_all_metrics`/`compute_period_returns` tolerate leading/interior NaN daily_return rows | Pitfall 3 | If they reject/propagate NaN, `estimated_start<=0` accounts error instead of rendering honest-flagged — plan MUST verify NaN handling before flipping the path. NOT yet verified in this session. |
| A2 | The synthetic anchor `initial_capital + total_pnl` for the heuristic sub-branch reproduces today's heuristic returns byte-for-byte | Pattern 1 | If the algebra diverges for the heuristic path, the heuristic parity pin fails — verify with a `account_balance=None` fixture during planning. |
| A3 | A guard-flagged SUCCESS keeps its compute_job `done` (not `failed_final`), so mig-038 does not overwrite `complete_with_warnings` to `failed` | Q4/Pitfall 6 | If a guard is mis-wired to a failed job, mig-038 poisons status — verify the dispatch outcome for guard-only runs. |
| A4 | `bybit_reconcile.py` can run against a real key as a parity oracle in CI/local | Q6 | If it needs live creds unavailable in CI, it stays a local-only oracle; the unit-level pins remain the CI gate. |

## Open Questions

1. **NaN serialization policy for `csv_daily_returns`.**
   - What we know: core emits NaN for broken days; upsert does `float(val)` (`job_worker:2068`/`:2078`).
   - What's unclear: skip-row vs persist-null vs the whole account failing.
   - Recommendation: decide explicitly in the plan; add an end-to-end NaN-account fixture. (Ties to A1.)
2. **Do the 8 consumers need a same-phase courtesy change?**
   - What we know: they gate `=== "complete"`; deferred migration acknowledged (`transforms.py:247-249`).
   - Recommendation: keep deferred per CONTEXT; Phase 74 only verifies honest rendering, does not migrate them.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python (pandas-safe) venv | running analytics pytest | ✓ | 3.12 (CI-pinned) | none — local 3.14 SIGSEGVs on pandas |
| pytest / pytest-cov | parity + regression pins | ✓ | requirements-pinned | — |
| Live exchange keys | `bybit_reconcile.py` real-account oracle | ✗ (CI) | — | unit-level parity pins are the CI gate |

**Venv (MANDATORY for running analytics tests — local Python 3.14 SIGSEGVs on pandas):**
```
/private/tmp/claude-501/-Users-helios-mammut-claude-projects-quantalyze/fcce1bd5-15ef-4e42-adb9-85cfc9ad484c/scratchpad/venv312/bin/python
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest + pytest-cov (`--cov-fail-under=80` gate) |
| Config file | `analytics-service/` pytest config (repo convention; `--cov-fail-under=80` per CLAUDE.md) |
| Quick run command | `<venv312>/python -m pytest analytics-service/tests/test_nav_twr.py analytics-service/tests/test_transforms.py -x -q` |
| Full suite command | `<venv312>/python -m pytest analytics-service/tests -q` (3028+ tests; run in CI-3.12 venv) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TWR-03 | Fallback deleted on daily_pnl branch; `estimated_start<=0` → NaN+`negative_nav_guard` | unit (mutation-honest) | `pytest tests/test_transforms.py -k fallback_deleted_daily_pnl -x` | ❌ Wave 0 |
| TWR-03 | Fallback deleted on individual-trades branch (`:199`/`:211`) | unit (mutation-honest) | `pytest tests/test_transforms.py -k fallback_deleted_individual -x` | ❌ Wave 0 |
| TWR-03 | Source-scan: no `estimated_start.*account_balance` / `.replace(0` left in transforms | static | `pytest tests/test_transforms.py -k no_forbidden_fallback -x` | ❌ Wave 0 |
| TWR-04 | daily_pnl call-site byte-identity (flow-less, `estimated_start>0`, rtol 1e-12) | unit (parity pin) | `pytest tests/test_transforms.py -k byte_identical_daily_pnl -x` | ❌ Wave 0 |
| TWR-04 | individual-trades call-site byte-identity (real fills) | unit (parity pin) | `pytest tests/test_transforms.py -k byte_identical_individual -x` | ❌ Wave 0 |
| TWR-04 | broker path byte-identity through `combine_realized_and_funding` | unit (parity pin) | `pytest tests/test_broker_dailies.py -k byte_identical -x` | ⚠️ file exists, test new |
| Q4 | guard flag → DQF → `complete_with_warnings`; no-guard → `complete` unchanged | integration | `pytest tests/test_analytics_runner.py -k status_guard_promotion -x` | ⚠️ file exists, test new |
| Q5 | `NavReconstructionError` → terminal `failed`/permanent, not retried | unit | `pytest tests/test_analytics_runner.py -k nav_error_permanent -x` and `tests/test_derive_broker_dailies_dualmode.py -k nav_error_permanent` | ⚠️ files exist, tests new |
| Pitfall 3 | `estimated_start<=0` account renders honest NaN/flag end-to-end (no magnitude, no crash) | integration | `pytest tests/test_csv_analytics_runner.py -k nan_account_honest -x` | ⚠️ file exists, test new |

### Sampling Rate
- **Per task commit:** `pytest tests/test_nav_twr.py tests/test_transforms.py tests/test_broker_dailies.py -x -q` (in venv312)
- **Per wave merge:** `pytest tests/test_transforms.py tests/test_broker_dailies.py tests/test_analytics_runner.py tests/test_csv_analytics_runner.py tests/test_derive_broker_dailies_dualmode.py tests/test_accuracy.py -q`
- **Phase gate:** full `pytest analytics-service/tests -q` green in the CI-3.12 venv before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] Parity + mutation-honest pins in `tests/test_transforms.py` (daily_pnl + individual-trades byte-identity, fallback-deletion mutation, source-scan) — covers TWR-03/TWR-04.
- [ ] Broker-path byte-identity in `tests/test_broker_dailies.py`.
- [ ] Status-promotion + `NavReconstructionError`-permanent tests in `tests/test_analytics_runner.py` and `tests/test_derive_broker_dailies_dualmode.py` — covers Q4/Q5.
- [ ] End-to-end NaN-account honesty in `tests/test_csv_analytics_runner.py` — covers Pitfall 3/A1.
- [ ] No framework install needed (pytest present; use venv312).

## Security Domain

> `security_enforcement` not set to false in config → included. This is an internal analytics refactor with no new network/auth/schema surface.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | worker service-role only; no new auth path |
| V3 Session Management | no | — |
| V4 Access Control | no | no new PostgREST-exposed column/route |
| V5 Input Validation | yes | `_coerce_float` fail-loud on untrusted pnl/anchor (`nav_twr.py:86-108`) |
| V6 Cryptography | no | — |
| V7 Error Handling / Logging | yes | scrub freeform error strings before stamping (`scrub_freeform_string`), never log raw NAV/USD (T-73-02) |

### Known Threat Patterns for analytics-service
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed exchange amount → silent NaN presented as valid metric | Tampering / Information disclosure | `_coerce_float` → `NavReconstructionError` fail-loud; no silent substitution |
| Structural failure misclassified transient → infinite retry | Denial of Service | typed permanent catch mirroring `LedgerValuationError` (Q5) |
| Account-size / USD leak in logs or error rows | Information disclosure | scrub error strings; core logs no raw NAV/flow USD (T-73-02) |

## Sources

### Primary (HIGH confidence — working-tree file:line)
- `analytics-service/services/transforms.py:6-259` — fallback sites, `_build_meta`, `ReturnsComputationMeta`
- `analytics-service/services/nav_twr.py:64-319` — core entry, guards, `NavTWRMeta`, `NavReconstructionError`
- `analytics-service/services/analytics_runner.py:1160-1188,1290-1324,1680-1799` — caller + status promotion + 8-consumer list
- `analytics-service/services/broker_dailies.py:1-135` — `combine_realized_and_funding` caller
- `analytics-service/services/job_worker.py:173-178,312-391,1828-2107` — broker path, `classify_exception`, `LedgerValuationError` pattern, kill-switch
- `analytics-service/routers/process_key.py:880-928` and `routers/portfolio.py:2248-2280` — wrapper callers
- `supabase/migrations/20260412094454_sync_strategy_analytics_status.sql` — mig-038 status bridge
- `.planning/REQUIREMENTS.md:23-24,73-74` — TWR-03/TWR-04 text; `.planning/phases/73-*/73-01-SUMMARY.md` — SC-4 pin + readiness

### Secondary (MEDIUM)
- `.planning/phases/74-*/74-CONTEXT.md` — auto-decided grey areas
- `analytics-service/scripts/bybit_reconcile.py:540-660` — real-account parity oracle

### Tertiary (LOW / needs validation)
- A1 NaN-handling downstream (`compute_all_metrics`/`compute_period_returns`) — not traced this session; plan MUST verify.

## Metadata

**Confidence breakdown:**
- Caller set / fallback sites (Q1, Q2): HIGH — grep + file:line confirmed, cross-checked against TWR-03 text.
- Status wiring (Q4): HIGH — producer/consumer/8-consumer list all file:line verified.
- Error propagation (Q5): HIGH for the pattern; MEDIUM on the exact analytics_runner catch placement (outer `except` at :1896 confirmed; typed-catch insertion point is a plan decision).
- NaN downstream handling (Pitfall 3 / A1): LOW — flagged as the one unverified dependency.

**Research date:** 2026-07-05
**Valid until:** 2026-08-05 (stable internal code; re-verify if transforms/nav_twr/job_worker change)
