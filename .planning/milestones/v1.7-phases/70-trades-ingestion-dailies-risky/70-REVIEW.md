---
phase: 70-trades-ingestion-dailies-risky
reviewed: 2026-07-05T00:00:00Z
depth: deep
files_reviewed: 6
files_reviewed_list:
  - analytics-service/services/deribit_txn.py
  - analytics-service/services/deribit_ingest.py
  - analytics-service/services/ingestion/deribit.py
  - analytics-service/services/ingestion/__init__.py
  - analytics-service/services/ingestion/adapter.py
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 70: Code Review Report

**Reviewed:** 2026-07-05
**Depth:** deep (cross-file, money-path traced against the LOCKED design)
**Files Reviewed:** 6 service files + wiring (tests read for intent, not reported)
**Status:** issues_found

## Summary

This is the milestone's RISKY real-fund P&L track. The code faithfully implements
most of the LOCKED design (`docs/deribit-ingestion-design.md`): txn-log ledger as
the single realized-return source, funding settlement-bundled with EMPTY
`funding_rows`, inverse coin→USD at the row's OWN event-time `index_price` with
the ledger sign trusted verbatim, the id-cursor trades axis kept ADVISORY, and a
fail-loud `compute_metrics` guard on the adapter. Signatures at every module
boundary line up (`create_exchange`, `validate_key_permissions`, `_make_fill_dict`,
`_normalize_trade`, `combine_realized_and_funding`) and the daily-record shape
matches the exchange-agnostic bybit tail.

The concerns are concentrated in the ONE place the phase exists to protect — the
D-02 completeness/honesty gate and the realized-cash composition:

- **BL-01** the D-02 gate has a silent blind spot: its "owed coverage" oracle is
  built from the *same* best-effort enumeration it is meant to police, and both
  enumerators swallow exceptions and degrade to empty. A scope/currency that
  fails to enumerate is absent from BOTH `expected` and the crawl, so the gate
  passes on a silently-partial ledger — the exact T-70-08 corruption class the
  code comments claim is mitigated.
- **WR-01** only `cashflow` is summed; if per-trade commissions live on the
  zero-cashflow `trade` rows (A3), fees are dropped and the track record inflates.

No hardcoded secrets, injection, or debug artifacts. Money-math primitives in
`deribit_txn.py` are pure and revert-proof-tested.

## Critical Issues

### CR-01: D-02 completeness gate is blind to enumeration failure (silent scope/currency drop)

**File:** `analytics-service/services/deribit_ingest.py:128-157, 200-236, 368-417, 478-500`
**Issue:**
`assert_ledger_complete` only verifies that every `(scope, currency)` in
`report.expected` reached `continuation=null`. But `expected` is populated in the
same pass from `enumerate_scopes` and `enumerate_currencies`, and BOTH degrade
silently:

- `enumerate_scopes` wraps `get_subaccounts` in `except Exception: return scopes`
  (main-only). A transient failure (rate limit / network / -32602) drops every
  subaccount from `expected`. The Wave-0 evidence is count=2 subaccounts per LTP
  key, so a dropped subaccount silently omits a real sleeve of the track record.
- `enumerate_currencies` returns `[]` when *both* `get_account_summaries` and the
  `get_currencies` fallback throw — a scope then owes zero coverage.

In both cases the dropped scope/currency never enters `expected`, so the gate
finds "nothing missing" and passes. The result is a silently-partial ledger
rendered as a COMPLETE track record — precisely the corruption `LedgerCompletenessError`
was written to prevent, and directly contradicting the docstring/summary claim
that "a dropped scope … all leave the gate failing" (T-70-08) and the
`enumerate_scopes` comment "a subaccount we cannot see is handled by the
completeness gate … not silently."

Because the gate's coverage oracle and the crawler share a fallible source, the
gate cannot detect under-enumeration — it can only detect a *crawl* that failed a
scope it already knew about.

**Fix:** Make enumeration fail loud, or verify coverage against an
enumeration-independent floor. Concretely:
```python
async def enumerate_scopes(exchange: Any) -> list[Scope]:
    scopes = [Scope(label="main", subaccount_id=None, is_main=True)]
    try:
        resp = await exchange.private_get_get_subaccounts({"with_portfolio": "false"})
    except Exception as exc:  # do NOT degrade silently — subaccount drop is data loss
        raise ScopeAuthError(
            f"get_subaccounts failed; cannot prove scope coverage: "
            f"{scrub_freeform_string(str(exc))}"
        ) from None
    ...
```
and in `enumerate_currencies`, raise (rather than `return []`) when the account
summary read fails AND the public fallback is empty, so a scope that owes unknown
coverage cannot silently owe nothing. At minimum, record enumeration failures as
`reached_end=False` entries in the report so the gate trips.

## Warnings

### WR-01: Only `cashflow` is summed — per-trade fees/commissions may be dropped

**File:** `analytics-service/services/deribit_txn.py:74-98, 249-275`
**Issue:**
`txn_cashflow_to_usd` and `txn_rows_to_daily_records` read exclusively
`row["cashflow"]`. Wave-0 A3 established that `type=trade` rows carry ZERO
`cashflow` (realized PnL crystallizes at settlement). Deribit books the per-fill
maker/taker **commission** on the trade row (`commission` field), and the design
doc itself (line 17) says the ledger records "trade cash + **fees**". If those
commissions are NOT folded into the later `settlement` cashflow, summing only
settlement/delivery `cashflow` omits all trading fees → the daily-return series
(and the track record) is overstated. The design's field note is "`cashflow`/`change`",
and `change` (balance delta, fee-inclusive) is never consulted.
**Fix:** Before trusting live returns, cross-check on one real account that
`Σ settlement.cashflow` already nets trading commissions (i.e. that
`Σ change == Σ cashflow` over a settled window, or that `Σ commission` is
reflected in settlement cashflow). If fees are on the zero-cashflow trade rows,
add `row.get("commission")` into the per-row USD delta (converted at the same
event-time index for inverse). Encode the answer in a fixture test so a regression
can't silently drop fees.

### WR-02: Inverse `delivery`/option rows lacking `index_price` hard-fail the entire job

**File:** `analytics-service/services/deribit_txn.py:74-98`; propagation via `deribit_ingest.py:413` → `job_worker.py:1868`
**Issue:**
`txn_cashflow_to_usd` raises `ValueError` for any inverse row with a nonzero
cashflow but no `index_price`. Wave-0 A1 confirmed `index_price` presence ONLY on
`type=settlement` rows (218/218). `delivery` rows (options/futures expiry) are in
`CASH_BEARING_TYPES` and are coin-settled for BTC/ETH inverse instruments, but
their `index_price` presence is UNVERIFIED. If a real delivery row omits
`index_price`, the ValueError propagates through `txn_rows_to_daily_records` →
`fetch_deribit_ledger_daily_records` → out of the deribit branch's narrow
`except (LedgerCompletenessError, LedgerTruncatedError)` → past the outer
`except ccxt.RateLimitExceeded` → the whole derive job throws. Fail-loud (no
silent corruption), but it hard-blocks ingestion for any account holding
delivered inverse contracts.
**Fix:** Confirm delivery rows carry `index_price` against a live account with
expired inverse options; if they may not, decide the fallback deliberately
(e.g. the settlement `index_price` at the same timestamp, or `delivery_price`
from the row) rather than an unconditional raise. Add a delivery-row fixture.

### WR-03: `ScopeAuthError` / unexpected producer errors are thrown, not returned FAILED-permanent

**File:** `analytics-service/services/job_worker.py:1840-1875`
**Issue:**
The deribit branch's inner `try` catches only `(LedgerCompletenessError,
LedgerTruncatedError)`. `fetch_deribit_ledger_daily_records` can also raise
`ScopeAuthError` (unresolvable subaccount token) and re-raises any
non-10028/non-(-32602) ccxt error. These escape the branch and the outer
`try` (which catches only `ccxt.RateLimitExceeded`), so they propagate as raw
exceptions. A `ScopeAuthError` is a PERMANENT key-scope problem but will be thrown
into the dispatcher as an unclassified error — risking transient-style retry
churn instead of a clean `DispatchResult(FAILED, error_kind="permanent")`.
**Fix:** Widen the branch's `except` to include `ScopeAuthError` (and, if
desired, a catch-all that scrubs and returns FAILED-permanent) so scope-auth
failures terminate the job deterministically like the completeness/truncation
paths already do.

## Info

### IN-01: `paginate_trades_id_cursor` full-page test uses post-filter length

**File:** `analytics-service/services/deribit_ingest.py:604-619`
**Issue:** `page_full = page_len == count` is computed after filtering non-Mapping
entries out of `raw_trades`. A page that is genuinely full but contains any
malformed (non-Mapping) entry yields `page_len < count` → the paginator stops
early and can drop later pages. Unlikely against the real API, but it is a silent
truncation path on the SECONDARY (advisory) axis.
**Fix:** Base `page_full` on `len(raw_trades) == count` (raw page size), keeping
the Mapping filter only for row construction.

### IN-02: `DEFAULT_START_MS` comment is internally inconsistent

**File:** `analytics-service/services/deribit_ingest.py:88-89`
**Issue:** The constant is documented "2015-01-01 UTC … full Deribit history"
while the adjacent parenthetical says "txn-log spans 2023→2026". Harmless
(2015 is a safe lower bound) but the two comments read as contradictory.
**Fix:** Note that 2015 is a deliberate lower bound predating any activity, not a
claim that data exists back to 2015.

---

_Reviewed: 2026-07-05_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
