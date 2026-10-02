---
phase: 120-sfox-equity-reconstruction-backbone
reviewed: 2026-07-19T00:00:00Z
depth: deep
files_reviewed: 8
files_reviewed_list:
  - analytics-service/services/broker_dailies.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/ingestion/sfox.py
  - analytics-service/services/sfox_read.py
  - analytics-service/scripts/sfox_ground_truth.py
  - analytics-service/services/closed_sets.py
  - analytics-service/routers/process_key.py
  - analytics-service/routers/internal.py
  - analytics-service/routers/portfolio.py
findings:
  critical: 1
  warning: 3
  info: 1
  total: 5
status: fixed
---

# Phase 120: Code Review Report

**Reviewed:** 2026-07-19
**Depth:** deep (cross-file: worker dispatch → broker_dailies → nav_twr → sfox_read)
**Files Reviewed:** 8 (+ `services/nav_twr.py` traced read-only as the shared TWR primitive)
**Status:** issues_found

## Summary

The money-math of the sFOX reconstruction is, in the common-case, economically correct: `combine_sfox_balance_history` feeds the existing `chain_linked_twr` with the flow in the numerator (`r_t = (NAV_t − NAV_{t−1} − F_t)/NAV_{t−1}`), the `_FLOW_SIGN` map places deposits/credits positive and withdraws/charges negative, buy/sell are excluded as internal rotations, same-day flows net, and missing interior NAV days propagate as honest NaN rather than a fabricated 0.0. The `:2645` `_NATIVE_RETURNS_VENUES` clobber-guard is byte-identical for deribit and every ccxt venue (verified: `!= "deribit"` → `not in {"deribit","sfox"}` differs only for `sfox`), and `flow_coverage_terminus_day("sfox", …)` correctly returns `None` (no retention cap) so no downstream truncation mis-fires. `aclose_exchange` routes `SfoxClient` correctly. `CRYPTO_VENUES` widening to include `sfox` (√365) is correct for spot crypto and cannot regress existing consumers (sfox has no historical rows). The composite exclusion (`_COMPOSITE_DEGRADE_VENUES − {sfox}`) is sound: a sfox member falls to the `venue != "deribit"` permanent "unsupported member" refusal, never a ccxt-reconstruct crash.

**However, there is one BLOCKER**: the sFOX combine bypasses the `_union_flow_days` mechanism that every other flow-aware path relies on, and its resulting `NavReconstructionError` is **uncaught** in the sfox worker branch — a realistic onboarding account (a deposit/withdraw dated after the last end-of-day balance snapshot, e.g. "connect right after funding") triggers an infinite transient retry with no terminal stamp.

## Critical Issues

### CR-01: sFOX combine bypasses `_union_flow_days`; the resulting `NavReconstructionError` is uncaught → legit accounts fail-loop forever with no terminal stamp

**File:** `analytics-service/services/broker_dailies.py:290-315` (combine) and `analytics-service/services/job_worker.py:2761` (uncaught call site)

**Issue:**
`combine_sfox_balance_history` reindexes the NAV series to the calendar range `[first_bh_day, last_bh_day]` only (`pd.date_range(nav.index.min(), nav.index.max())`, broker_dailies.py:283-287), then calls `chain_linked_twr` **directly**. It does **not** union the flow days into the NAV index the way `nav_twr.reconstruct_nav_and_twr` does via `_union_flow_days` (HIGH-1). Inside `chain_linked_twr`, `_align_flows` (nav_twr.py:311-316) **raises `NavReconstructionError`** for any flow dated on a day not present in the NAV index:

```
orphans = flows_by_day.index.difference(index)
if len(orphans) > 0:
    raise NavReconstructionError("nav_twr flow(s) dated outside the return window: …")
```

This is reachable with ordinary data because the two crawls are independent time domains:
- `/v1/account/balance/history` is an **end-of-day** snapshot series; today's EOD point does not exist yet, so `nav.index.max()` is typically **yesterday**. The crawl's own tolerance permits `latest_bh` up to `now − 2 days` (`_SFOX_RECENT_EDGE_TOLERANCE_MS`, sfox_read.py).
- `/v1/account/transactions` returns real-time flows. A **deposit/withdraw/credit/charge dated today (or in the last 48h)** — the classic "user funds the account, then connects/resyncs" flow — lands on a day **after** `nav.index.max()` → orphan → `NavReconstructionError`.
- The symmetric case also fires: the account's **first funding deposit** dated a day before the first EOD balance snapshot appears → orphan before `nav.index.min()`.

The call at `job_worker.py:2761` is **not** wrapped in a `try` that catches `NavReconstructionError`. The sfox branch only catches `asyncio.TimeoutError`, `SfoxCrawlTruncatedError` (crawls, lines 2649-2708) and `SfoxFlowValuationError` (parse, lines 2710-2734). The `combine_realized_and_funding` `NavReconstructionError` handler at `job_worker.py:2934` sits **inside** `if venue not in _NATIVE_RETURNS_VENUES:` and is therefore **skipped for sfox**. The enclosing outer try (`job_worker.py:2110`) catches **only** `ccxt.RateLimitExceeded` (line 2885).

Net effect: for a legitimate account with a boundary-adjacent flow, the `NavReconstructionError` escapes `run_derive_broker_dailies_job` entirely → the generic dispatcher classifies it as transient `unknown` and **retries forever** (the exact T-74-02 / T-80-10 DoS the deribit and ccxt branches explicitly guard against at 2589/2872/2934), with **no `_stamp_strategy_analytics_failed`** call → the wizard spins on `computing` indefinitely, and the account can **never be ingested**. (No wrong *displayed* return is produced — it fails loud — but a whole class of valid accounts is permanently un-onboardable, plus the retry-DoS.)

**Fix:** union the flow days into the NAV index before calling `chain_linked_twr`, mirroring `reconstruct_nav_and_twr` — a flow after the last NAV day then lands on a reindexed NaN-NAV day and produces an honest NaN return (deposit never double-counted, no crash), and a pre-inception flow lands on a leading NaN day (benign). In `combine_sfox_balance_history`, after building `full_idx`, extend it to cover the flow index:

```python
full_idx = pd.date_range(nav.index.min(), nav.index.max(), freq="D").as_unit("us")
if flows_by_day is not None and not flows_by_day.empty:
    full_idx = full_idx.union(flows_by_day.index)  # a boundary flow gets a (NaN) NAV day, never an orphan raise
nav = nav.reindex(full_idx)
```

Additionally (defense-in-depth, matching every sibling combine site), wrap the `job_worker.py:2761` combine in `try/except NavReconstructionError` that disposes **permanent** with a scrubbed `_stamp_strategy_analytics_failed`, so a genuinely structural flow (schema drift) reaches a terminal gate instead of the generic retry-forever classifier.

## Warnings

### WR-01: Day-0 inception flow yields a spurious/incorrect anchor-day return; the "0.0 anchor" docstring claim is false

**File:** `analytics-service/services/broker_dailies.py:238-247` (A3 convention) → `analytics-service/services/nav_twr.py:408-432`

**Issue:** The A3 convention sets `prev0 = first_observed usd_value` and the docstring asserts "day-0 emits a 0.0 anchor return (no spurious first-day move)". That holds **only when there is no flow on day 0**. `combine_sfox_balance_history` does nothing to zero or exclude a day-0 flow, and flows come from an independent transactions crawl. If a deposit/withdraw is dated on the same UTC day as the first balance-history observation (a realistic funding deposit), then at `t=0` in `chain_linked_twr`, `prev = prev0 = first_observed` and `cur = nav_vals[0] = first_observed`, so `returns[0] = (first_observed − first_observed − F_0)/first_observed = −F_0/first_observed` — a **non-zero, economically wrong** anchor-day return (it re-subtracts a deposit already embedded in `first_observed`, since there is no genuine prior-day NAV). For a large funding deposit the `flow_dominated_guard` fires and day-0 becomes NaN instead (benign); for a partial same-day flow it emits a spurious signed return on the anchor day.

**Fix:** Force `F_0 = 0` for the day-0 anchor (the inception capital already reflects any day-0 flow), or drop the day-0 index entry after combine so the anchor never carries a computed return. Correct the docstring to state the 0.0-anchor claim is conditional on no day-0 flow.

### WR-02: `crawl_sfox_transactions` cursor advance has an unguarded `KeyError` on `id` → escapes as raw `KeyError` (transient retry-forever)

**File:** `analytics-service/services/sfox_read.py:215`

**Issue:** `after = str(page[-1]["id"])` assumes every transaction row carries an `id`. Balance-history rows are defended (`_row_timestamp_ms` wraps missing/garbage timestamps in `SfoxCrawlTruncatedError`), but a schema-drifted transactions page missing `id` raises a bare `KeyError`, which is neither `SfoxCrawlTruncatedError` nor any typed error the worker branch handles → it escapes to the generic dispatcher as transient `unknown` and retries forever (same DoS class as CR-01, lower likelihood).

**Fix:** Guard the cursor read and raise `SfoxCrawlTruncatedError` (or `SfoxFlowValuationError`) on a missing/unusable `id`, so it disposes permanent with a terminal stamp rather than looping.

### WR-03: Ground-truth `check_parity` false-positive `ParityDivergenceError` for a zero-cashflow account under the cash-only `account_balance` interpretation

**File:** `analytics-service/scripts/sfox_ground_truth.py:361-439`

**Issue:** For an account with **no** deposit/withdraw events (`len(event_days) == 0`), if `account_balance` is a cash-only running balance (the unresolved A2 interpretation), it stays constant while `usd_value` moves with MTM → `resid = Δusd_value − Δaccount_balance` is material on every market day → `diverged = True`. But `cash_only_signature` requires `len(event_days) > 0` (line 363), so it is `False`, and the code raises `ParityDivergenceError` at line 430 (`diverged and not cash_only_signature`). The two `account_balance` interpretations are genuinely indistinguishable with zero events, so this fails loud on a possibly-clean account. It is a founder-gated diagnostic (fails safe, exit 1, not the production display path), but it would block the `api_verified` stamp for a legitimate no-flow account.

**Fix:** When `len(event_days) == 0`, treat the total-MTM-vs-cash-only ambiguity as `requires_founder_decision` (surface both residual sets) rather than auto-raising, consistent with the A2 handling for the event-bearing case.

## Info

### IN-01: `_sfox_rows_to_usd_value_series` "last observation wins" relies on unsorted-row iteration order

**File:** `analytics-service/services/job_worker.py` (`_sfox_rows_to_usd_value_series`, `by_day[day] = value`) and the mirror `scripts/sfox_ground_truth.py:_rows_to_usd_value_series`

**Issue:** Both builders pick the end-of-day equity by "last row in list-iteration order wins" rather than by max timestamp within the day. This is correct only if pages are time-ascending within a UTC day. It is consistent between the two implementations (so parity is not affected), but a non-ascending page would silently pick a non-latest intraday point.

**Fix:** Key end-of-day by `max(timestamp)` within the day (as the transactions oracle already does with `latest_ts`) so the choice is order-independent.

---

## Red-team money-path findings + dispositions (2026-07-19, fixer pass)

Fresh-context red-team pass over the sFOX money path (branch
`gsd/v1.12-sfox-verified-integration`). Guiding principle: FAIL LOUD / NO INVENTED
DATA — it is always correct to raise/gate rather than display a possibly-wrong
number. Each fix landed atomically with a regression test that fails without it.

### F1 — CRITICAL crash: sfox onboard/resync routed to the fill path → NotImplementedError — FIXED
`services/ingestion/long_fetch.py` had `is_ledger_backed = source == "deribit"`, so
strategy-mode onboard/resync fell into the fill branch and called
`SfoxAdapter.fetch_raw` (which raises `NotImplementedError` BY DESIGN) → every sfox
onboard/resync crashed in production, and the tail enqueued `sync_trades` instead of
`derive_broker_dailies`. Widened to `_LEDGER_BACKED_SOURCES = {"deribit","sfox"}` so
sfox routes to the broker-dailies ONE-path like deribit. Commit: `fix(120): F1 …`.
Regression: `test_long_fetch_sfox_routes_ledger_path_never_calls_fetch_raw`.

### F2/F6 — fabricated 0.0 return days for unobserved NAV — FIXED
`combine_sfox_balance_history` unioned out-of-span flow days into the NAV index then
ran `gap_fill_daily_returns` (reindex `fill_value=0.0`). The union added only the
single flow day (not the calendar days between it and the NAV span), so gap_fill
FABRICATED 0.0 returns on those days and pulled the series start onto the flow day —
fabricating pre-inception/post-terminus flat equity and shifting the displayed
inception earlier. sFOX NAV is a SAMPLED series (unlike deribit's complete ledger),
so an unobserved day is UNKNOWN, never flat. Fix: keep the union only on the
chain-link index (CR-01 no-orphan-raise intact) then restrict the emitted series
back to the OBSERVED NAV span — interior missing days stay honest NaN gaps that
`derive_basis_series` drops into `gap_spans`; out-of-span boundary flow days fall
away; interior holes surfaced via meta `nav_coverage_gap_days` +
`complete_with_warnings`. Commit: `fix(120): F2/F6 …`. Regressions: pre-inception
flow fabricates no flat days / no inception shift; interior missing day breaks
honestly with meta reflecting the gap; CR-01 boundary tests refined to the stronger
no-fabrication contract.

### F3 — fee mis-classification + P115 oracle self-reference — FIXED
(a) `_FLOW_SIGN` mapped `charge`→−1.0 and `credit`→+1.0 as external flows. That is
UNVERIFIED and money-unsafe: if a `charge` is a FEE, treating it as an external
outflow F backs it OUT of the TWR numerator and OVERSTATES performance. Per the
deribit `correction` precedent, only deposit/withdraw (flows) and buy/sell
(rotations) are definitively classified; every other type now fails loud
(`SfoxFlowValuationError`, terminal) pending real-account evidence. (b)
`sfox_ground_truth` imported `_FLOW_SIGN`/`_ROTATION_ACTIONS` from `sfox_read`,
making the P115 oracle self-referential. The oracle now owns an INDEPENDENT
`_ORACLE_FLOW_SIGN` map and raises on unclassified types on its own. Commit:
`fix(120): F3 …`. Regressions: unclassified type raises in the read path AND
independently in the oracle; oracle does not import the impl's classification.
⚠ EVIDENCE-GATED: real sFOX accounts with `charge`/`credit` transactions now FAIL
to ingest until the founder supplies evidence on their economic meaning (fee vs
flow). This is the intended no-invented-data outcome — see "Still needs evidence".

### F4 — parity gate did not validate the reconstruction — FIXED
`check_parity` computed `returns_ut = combine_sfox_balance_history(...)` then
DISCARDED it, comparing raw `Δusd_value − Δaccount_balance` where the flow terms
CANCEL — so a combine bug sailed through. Added a reconstruction-vs-oracle net:
compare `returns_ut` against the independent transactions-only oracle returns
day-by-day; when the two raw streams reconcile as the same total-MTM NAV, the two
reconstructed return series MUST agree, so a material per-day gap is a combine bug →
fail loud. Cash-only/ambiguous stays founder-flagged. Oracle stays
transactions-only/independent (P115). Commit: `fix(120): F4 …`. Regression: a
simulated combine bug (ignoring flows → deposit booked as ~+50%) now fails the gate
while the raw streams still reconcile; clean fixture shows ~0 reconstruction
residual (no false positive).

### F7 — non-finite NAV accepted silently — FIXED
`_sfox_rows_to_usd_value_series` did `float(row["usd_value"])`, which accepts
`nan`/`inf`, so a poisoned NAV point slipped through despite the docstring promising
to fail loud. Added a `math.isfinite` gate mirroring the ground-truth
`_coerce_finite`: a non-finite usd_value now raises `SfoxFlowValuationError`
(terminal), never coerced to 0.0. Commit: `fix(120): F7 …`. Regression:
`nan`/`inf`/`-inf` (str + float) all fail loud.

### F5 / F8 — OUT OF SCOPE (documented separately)
F5 and F8 were explicitly excluded from this fixer pass as evidence/architecture-
gated; they remain tracked separately and are NOT addressed here.

### Still needs real-account evidence (flagged, NOT guessed)
- **sFOX `charge` / `credit` (and any non-deposit/withdraw/buy/sell type)**: the
  economic meaning (fee vs external flow vs rebate vs rotation) cannot be told from
  a transaction row alone. F3 makes these FAIL LOUD (the correct no-invented-data
  outcome), but it means any real sFOX account carrying such a transaction cannot be
  ingested until the founder confirms the economics — mirrors the deferred deribit
  `correction` decision. A `_FLOW_SIGN` entry can be added ONLY once evidenced.
- **A2 (`account_balance` = cash-only vs total-MTM)** and **A3 (inception
  convention)** remain founder-decided in the ground-truth run, unchanged by this
  pass.

Full analytics suite GREEN after all five fixes (3974 passed, 96 skipped).

---

_Reviewed: 2026-07-19_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
_Money-path fixer pass (F1/F2/F6/F3/F4/F7): 2026-07-19 — Claude (gsd-code-fixer)_
