---
phase: 70-trades-ingestion-dailies-risky
plan: 03
subsystem: analytics
tags: [deribit, txn-log, ledger, rate-limit, subaccount-auth, completeness-gate, python, tdd]

# Dependency graph
requires:
  - phase: 70-01
    provides: LOCKED Deribit ingestion design (txn-log ledger; count=250 + continuation→null; 1 req/s + 10028 backoff; exchange_token subaccount auth; D-02 re-anchored on ledger completeness)
  - phase: 70-02
    provides: services/deribit_txn.py — txn_rows_to_daily_records (funding-inclusive single-sum daily records), classify_instrument, txn_cashflow_to_usd
provides:
  - "services/deribit_ingest.py — Deribit ledger I/O: paginate_txn_log (count=250, continuation→null, ~1 req/s pace + exponential 10028 backoff, LedgerTruncatedError fail-loud), enumerate_scopes, resolve_scope_auth/mint_subaccount_token (exchange_token subject_id), enumerate_currencies (account-driven), fetch_deribit_ledger_daily_records (scope×currency producer, concatenated sign-encoded records), assert_ledger_complete (re-anchored D-02 gate), CompletenessReport, LedgerTruncatedError/ScopeAuthError/LedgerCompletenessError"
  - "Revert-proof CI fixtures: continuation-to-null paginator, injected-clock pace/backoff, truncation-fail-loud, cross-scope opposite-sign netting (+70 not 130), completeness-gate fail-loud, scope-auth resolution, -32602-skip-still-incomplete"
affects: [70-05, 70-06]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Injected-clock (sleep-spy) rate-limit pacing + exponential backoff — unit-testable without real time"
    - "Fail-loud paginator: 10028 budget exhaustion RAISES rather than returning partial pages"
    - "Two-pass producer: pass 1 enumerates OWED coverage (expected), pass 2 crawls — a dropped crawl leaves expected pairs uncovered so the completeness gate catches it"
    - "Completeness gate anchored on ledger coverage (continuation→null), NOT fill-count reconciliation"

key-files:
  created:
    - analytics-service/services/deribit_ingest.py
    - analytics-service/tests/test_deribit_ingest.py
  modified: []

key-decisions:
  - "Subaccount auth via public/exchange_token (param subject_id) minting an access_token merged into request params; subaccount_id is refused (-32602) on the read-only LTP keys. A scope whose token cannot be minted raises ScopeAuthError (no silent skip)."
  - "Cross-scope aggregation CONCATENATES each scope's sign-encoded daily_pnl records into one flat list — never abs-sums price. trades_to_daily_returns_with_status decodes side→sign and bucket-sums per UTC day, so opposite-sign same-day scopes net correctly (+100 and −30 → +70, not 130)."
  - "CompletenessReport carries expected (scope→currencies) separately from entries (crawled). assert_ledger_complete raises if any expected pair lacks a reached_end=True entry — a truncated crawl, a -32602 currency skip, and a dropped scope all fail the gate (D-14)."
  - "assert_ledger_complete takes ONLY the report — no fill-count total. Wave-0 BLOCKING_FINDING: 18,778/21,014/61,248 reconcile to no API surface, so completeness (not reconciliation) is the honesty anchor."
  - "Money math (coin→USD index_price multiply) is DELIBERATELY absent from this module — it stays in deribit_txn (70-02). This module only performs I/O and feeds rows through txn_rows_to_daily_records."

patterns-established:
  - "Pattern: sleep-spy asserts pace AND increasing exponential backoff waits with zero real time"
  - "Pattern: revert-proof completeness gate — dropping the sub crawl leaves expected pairs uncovered, turning the gate red"

requirements-completed: [DRB-04, DRB-07]

# Metrics
duration: ~40min
completed: 2026-07-05
---

# Phase 70 Plan 03: Deribit txn-log cash-delta ledger backbone Summary

**The authoritative Deribit daily-return source: a rate-limit-safe, truncation-fail-loud `private/get_transaction_log` crawl (count=250, continuation→null, ~1 req/s + 10028 backoff) across every scope × currency, per-scope subaccount auth via `exchange_token`, and the re-anchored D-02 honesty gate that fails loud on any incomplete crawl — a silently-partial ledger cannot render as a complete track record.**

## Performance
- **Duration:** ~40 min
- **Tasks:** 2 (both TDD: RED → GREEN)
- **Files:** 2 created (`deribit_ingest.py` 438 lines, `test_deribit_ingest.py` 463 lines)
- **Tests:** 20 targeted (19 pass locally; 1 cross-scope test imports pandas → deferred to CI Py3.12, see Issues)

## Accomplishments
- `paginate_txn_log(exchange, scope_label, currency, start_ms, end_ms, scope_auth, *, sleep, max_retries, pace_seconds)`: raw `private_get_get_transaction_log` with `count=250`, follows `continuation` to null, accumulates rows once. Paces ~1 req/s (injected `sleep` between pages) and exponential-backs-off on `10028` (wait = base·2^(n−1)); budget exhaustion RAISES `LedgerTruncatedError` naming scope + currency + last continuation — partial pages are NEVER returned. Non-10028 errors propagate for the producer to classify. Every ccxt error scrubbed via `scrub_freeform_string`.
- `enumerate_scopes` (get_subaccounts, ids kept as STRINGS, main-first) + `resolve_scope_auth`/`mint_subaccount_token`: main scope signs with its own key; a subaccount scope mints a read token via `public_get_exchange_token({"subject_id": ...})` merged as an `access_token` request param. An unresolvable scope raises `ScopeAuthError` (no silent skip — a dropped scope is a silent under-fetch, T-70-08).
- `enumerate_currencies`: from the account's held balances (nonzero equity/balance) with a `public_get_get_currencies` fallback — never a hard-coded currency literal.
- `fetch_deribit_ledger_daily_records(exchange, since_ms=None) -> (list[dict], CompletenessReport)`: two-pass — pass 1 resolves auth + enumerates OWED coverage per scope; pass 2 crawls every (scope, currency), feeds rows through `txn_rows_to_daily_records` (70-02), and CONCATENATES the sign-encoded records into one flat list. Truncation and `-32602` skips record `reached_end=False`; unexpected errors re-raise.
- `assert_ledger_complete(report)`: raises `LedgerCompletenessError` if any expected scope × currency lacks a `reached_end=True` entry. The re-anchored D-02 gate — completeness, not fill-count reconciliation.

## Key signatures for 70-05 / 70-06
```python
async def fetch_deribit_ledger_daily_records(
    exchange, since_ms: int | None = None, *, sleep=asyncio.sleep,
) -> tuple[list[dict], CompletenessReport]

def assert_ledger_complete(report: CompletenessReport) -> None  # raises LedgerCompletenessError

async def resolve_scope_auth(exchange, scope: Scope) -> dict[str, Any]  # 70-06 reuses this
```
70-05 wires `fetch_deribit_ledger_daily_records` + `assert_ledger_complete` into the ONE derive-broker-dailies path; the D-02 gate anchors on ledger completeness (continuation→null across all scopes × currencies), NOT reconciliation to 18,778/21,014/61,248.

## Deviations from Plan
None — plan executed exactly as written. Two test-strengthening choices beyond the behavior prose (not plan deviations): the backoff test raises `10028` twice (not once) to assert strictly-increasing exponential waits; added `test_producer_reraises_unexpected_error` to pin that a non-10028/non-(-32602) error fails loud rather than being swallowed as a skip.

## Issues Encountered
- Local Python is 3.14 (`.venv`); per CLAUDE.md the pandas-importing suite segfaults on 3.14 (SIGSEGV / exit 139), confirmed reproducible even standalone with a minimal `trades_to_daily_returns_with_status` call. The 19 network-free/pandas-free tests pass locally; `test_cross_scope_opposite_sign_nets_signed` (imports `services.transforms` → pandas) is deferred to CI Py3.12 (the full-suite authority per CLAUDE.md). The netting logic is proven by construction: `fetch_deribit_ledger_daily_records` concatenates (never merges), yielding two records for the opposite-sign day, which `groupby("date")["daily_pnl"].sum()` nets to +70.
- `mypy services/deribit_ingest.py` passes clean.

## Threat Coverage (from plan threat_model)
- **T-70-06 (silent partial ledger):** continuation→null + `LedgerTruncatedError` on budget exhaustion + `assert_ledger_complete` fail-loud — mitigated, revert-proof.
- **T-70-07 (DoS / rate limit):** ~1 req/s pace + exponential 10028 backoff (injected-clock unit test) — mitigated.
- **T-70-08 (silent scope drop):** `resolve_scope_auth` fails loud (`ScopeAuthError`) on unresolvable auth — mitigated.
- **T-70-09 (info disclosure):** `scrub_freeform_string` on every ccxt error path — mitigated.
- **T-70-SC (package installs):** zero new packages — accepted.

---
*Phase: 70-trades-ingestion-dailies-risky*
*Completed: 2026-07-05*

## Self-Check: PASSED
All created files exist on disk; all four task commits (26a071a3, 1ee53324, 0ce8e94c, bb95f00a) present in git history. 19/20 targeted tests pass locally + mypy clean; the 20th (pandas-importing cross-scope netting) deferred to CI Py3.12 per the documented Py3.14 segfault constraint.
