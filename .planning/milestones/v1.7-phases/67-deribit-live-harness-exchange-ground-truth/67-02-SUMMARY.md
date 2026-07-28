---
phase: 67-deribit-live-harness-exchange-ground-truth
plan: 02
subsystem: analytics-service
tags: [bybit, reconciliation, ground-truth, ccxt, funding, dailies, byb-01, secrets]
requires:
  - services/reconciliation.py::diff_strategy_fills
  - services/exchange.py::fetch_raw_trades / fetch_all_trades / fetch_account_equity_usd / create_exchange / aclose_exchange / get_and_clear_last_dq_flags
  - services/funding_fetch.py::fetch_funding_bybit / _build_match_key
  - services/broker_dailies.py::combine_realized_and_funding
  - services/encryption.py::decrypt_credentials / get_kek
  - services/db.py::get_supabase / db_execute / one / rows
  - services/redact.py::scrub_freeform_string / truncate_account_id
provides:
  - scripts/bybit_reconcile.py (BYB-01 harness: fills diff by execId + funding
    bucket diff + dailies recompute-vs-stored within 1e-9, sanitized JSON,
    verdict-encoded exit code, read-only by construction)
  - compare_dailies / funding_bucket_summary / build_report (pure-logic layer)
affects:
  - Plan 67-04 (orchestrator-only live railway ssh run) fully unblocked
  - Phase 70 (dailies/funding) — re-checks the #563 under-fetch class before
    Deribit stacks onto the shared realized+funding -> csv_daily_returns path
tech-stack:
  added: []
  patterns:
    - probe_exchange_egress.py one-off script idiom (WHY/USAGE/RUNBOOK docstring,
      argparse main() -> int exit-code contract, python -m scripts.X)
    - lazy ccxt/exchange import inside run() to keep the pure-logic layer I/O-free
    - pandas-agnostic compare_dailies (duck-typed .items()) so unit tests never
      construct a pandas object (local Py3.14 venv segfaults on pandas ops)
    - reuse services.funding_fetch._build_match_key for funding dedup (never
      reimplement bucket math; never native-id equality — Bybit rotates ids)
key-files:
  created:
    - analytics-service/scripts/bybit_reconcile.py
    - analytics-service/tests/test_bybit_reconcile.py
  modified: []
decisions:
  - compare_dailies is duck-typed to accept any .items()-able mapping (a plain
    dict in tests, the real pd.Series in production) so the pure-logic tests run
    on the local Py3.14 venv where constructing a pd.Series segfaults.
  - Funding reconcile normalizes the strategy_id label OUT on both sides
    (_relabel) so buckets reconcile on the TRUE funding identity (exchange,
    symbol, time-bucket), independent of whichever label the producer stored
    under; the axis is always services.funding_fetch._build_match_key.
  - strategy_id is REQUIRED (exit 2 usage error if the api_key row has none) —
    the fills half is fundamentally strategy_id-keyed against the trades table.
  - Read-only by construction and mechanically enforced — the script contains
    zero .insert/.update/.upsert/.delete; recompute is in-memory only.
metrics:
  duration: 26m
  completed: "2026-07-04"
  tasks: 2
  files: 2
---

# Phase 67 Plan 02: Bybit Ground-Truth Reconciliation Harness Summary

BYB-01 read-only reconciliation harness — a committed one-off
`scripts/bybit_reconcile.py` that proves Bybit ingestion correct end-to-end
against exchange truth for one live key: fresh exchange fills vs DB `trades` by
native `execId` (two-stage `diff_strategy_fills`), fresh funding vs DB
`funding_fees` by `match_key` bucket (never native id — Bybit rotates them), and
per-key realized+funding dailies recomputed via the production
`combine_realized_and_funding` vs stored `csv_daily_returns` within 1e-9 on the
overlapping historical tail. Composes the EXACT #563 production seams, is
read-only by construction, and prints a sanitized JSON verdict with a
verdict-encoded exit code. Runs later via `railway ssh` (Plan 67-04). Plus its
pure-logic unit tests.

## What Was Built

- **`scripts/bybit_reconcile.py`** (two layers in one module, `probe_exchange_egress.py` idiom):
  - *Pure-logic layer* (Task 1, TDD): `compare_dailies` (1e-9 overlap tolerance,
    pandas-agnostic via duck-typed `.items()`, only-side days excluded from the
    tolerance check but reported), `funding_bucket_summary` (reuses
    `services.funding_fetch._build_match_key` as the dedup axis; `missing_in_db`
    is the #563 dropped-funding signal; per-day sum deltas), `db_trade_to_fill`
    (trades-row -> the fill-dict shape `diff_strategy_fills` reads), `build_report`
    + `compute_verdict` (verdict in {`clean`,`id_drift_only`,`discrepancy`},
    `count_delta` RECORDED even at zero, sanitized-by-construction: `api_key_id`
    masked to `***last4`, every free-form string scrubbed via `scrub_freeform_string`).
  - *Async I/O layer* (Task 2): `run(api_key_id, window_days)` (load+validate the
    api_keys row → `decrypt_credentials`/`get_kek` fail-loud → `create_exchange`
    → fills half mirroring `run_reconcile_strategy_job` with immediate
    `get_and_clear_last_dq_flags` drain → funding bucket half → dailies half
    mirroring `run_derive_broker_dailies_job` → `build_report`) and `main()`
    (argparse required `--api-key-id`, `--window-days` default 180; exit codes
    0/1/2; scrubbed error messages; sanitized JSON to stdout). ccxt/exchange
    imported lazily inside `run()`.
- **`tests/test_bybit_reconcile.py`** — 14 pure-fn tests across 4 groups; each
  docstring encodes WHY (Rule 9): 1e-9 is the BYB-01 reconciliation definition;
  funding-by-bucket guards the Bybit id-rotation trap; a `count_delta` is
  RECORDED not auto-treated as a bug (#563 discipline); the report is
  sanitized-by-construction.

## Verification Evidence

| Check | Result |
|-------|--------|
| `pytest tests/test_bybit_reconcile.py -q` | 14 passed |
| `mypy --strict --follow-imports=silent scripts/bybit_reconcile.py` | Success: no issues |
| read-only grep gate `grep -E "\.(insert\|update\|upsert\|delete)\("` | ZERO matches (rc=1) |
| reuse-seam grep (fetch_raw_trades / combine_realized_and_funding / _build_match_key / fetch_funding_bybit / diff_strategy_fills / get_and_clear_last_dq_flags) | 26 occurrences (all seams present) |
| `python -m scripts.bybit_reconcile` (no args) | exit 2, argparse usage only (no secrets) |
| `run` is coroutine + `main.__annotations__['return'] is int` | OK |
| compare_dailies rejects 1e-6 perturbation, accepts identical, excludes only-side days | asserted (3 tests) |
| funding_bucket_summary imports `_build_match_key` (no reimplemented bucket math) | grep + test-asserted |
| build_report: `count_delta` present at zero; verdict ∈ 3-set; `&signature=`/api_key scrubbed; id masked `***last4` | asserted (5 tests) |
| script 561 LOC (min 150), test 256 LOC / 14 fns (min 80 / 4) | pass |

## Threat Model Coverage

- **T-67-06 (Info Disclosure — decrypted Bybit key):** creds decrypted via the
  existing `decrypt_credentials` only; plaintext never logged/printed/persisted;
  `api_key_id` masked via `truncate_account_id` in the report (`***6666`);
  unit-tested that the raw UUID is absent from the serialized report.
- **T-67-07 (Tampering — prod DB mutation):** zero write calls — mechanically
  enforced by the grep gate (`grep -E "\.(insert|update|upsert|delete)\("`
  returns rc=1). Recompute is in-memory only; the report is printed, never
  written to `reconciliation_reports`/`strategy_analytics`/any table.
- **T-67-08 (Info Disclosure — ccxt `&signature=<HMAC>` URLs):** every free-form
  string entering the report passes through `scrub_freeform_string` (recursive
  `_sanitize`); the argparse/usage and exception paths in `main()` scrub before
  stderr. Unit test injects `&signature=deadbeefcafe` and asserts it is scrubbed.
- **T-67-09 (Repudiation — unrecorded basis):** window, `axis_used`
  (api_key_id vs strategy_id fallback), `dq_flags` (incl. `sync_truncated_bybit`),
  and `count_delta` (even if zero) are all recorded in the report (#563 discipline).
- **T-67-10 / T-67-SC (accept):** the Bybit key is an existing prod read-only
  ingestion key; the script adds only fetch seams already in production use and
  zero new dependencies.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] `compare_dailies` cannot take a live `pd.Series` in local tests**
- **Found during:** Task 1 (RED design) — the plan specifies
  `compare_dailies(recomputed_series, ...)` over a `pd.Series`, but constructing
  any pandas object segfaults on this local Python 3.14 venv (numpy/pandas ABI
  drift, exit 139 — the STATE.md-documented blocker).
- **Fix:** `compare_dailies` is duck-typed to accept any `.items()`-able mapping.
  A `pd.Series` yields `(Timestamp, value)` pairs from `.items()` exactly like a
  `dict`; `_iso_day` normalizes both `datetime`/`Timestamp` and ISO strings to a
  UTC calendar day. Production passes the real `pd.Series` from
  `combine_realized_and_funding` unchanged; tests pass plain dicts, so the
  pure-logic tests are truly I/O-free and pandas-object-free. A dedicated test
  (`test_accepts_datetime_keys_via_items`) proves datetime-key normalization.
- **Files modified:** `scripts/bybit_reconcile.py`, `tests/test_bybit_reconcile.py`
- **Commit:** ccdddee3

**2. [Rule 2 — Missing critical guard] `strategy_id` required for the fills half**
- **Issue:** `key_row.get("strategy_id")` is `Any | None`; the fills half is
  fundamentally strategy_id-keyed (`fetch_raw_trades` + `trades` SELECT). A NULL
  strategy_id would silently reconcile fills against an empty/incorrect set.
- **Fix:** fail-loud `ReconcileUsageError` (exit 2, masked id) when the api_key
  row has no strategy_id, narrowing the type to `str` for the downstream seams.
- **Files modified:** `scripts/bybit_reconcile.py`
- **Commit:** b3396794

## Deferred Issues

**Full-suite coverage gate (Task 2 verify, `--cov-fail-under=80`) cannot run in
this local Python 3.14 venv — native pandas segfault at pytest collection.**
- Confirmed this session: `pytest --co -q` (collection ONLY) exits 139 in native
  `pandas._libs.tslibs` — the STATE.md/67-01-documented "local venv drift"
  (numpy 2.4.x vs pandas 2.2.3 pinned for numpy 2.2.4; no cp314 numpy 2.2.4 wheel),
  entirely independent of this plan's additive files.
- **Impact on this plan: none by construction.** The new script lives under
  `scripts/`, which is OUTSIDE the coverage denominator
  (`--cov=services --cov=routers --cov=main_worker`), so it adds zero coverage
  regression. The new test file passes in isolation (14). The
  `--cov-fail-under=80` gate is a blocking CI gate (per CLAUDE.md) enforced on
  the pinned CI Python where the ABI matches — it runs there. No code change can
  fix a native ABI mismatch caused by the local Python version.
- **Recommendation:** the full suite + coverage gate runs in CI (or a Python
  3.12/3.13 venv synced to `requirements.txt`) before the phase gate.

## Known Stubs

None. The script is fully wired to the production seams; the only "pending" work
is the orchestrator-only live `railway ssh` run (Plan 67-04), which cannot happen
in an executor subagent (no railway auth / Supabase MCP) and is not a stub — it
is a deliberate separate plan.

## Commits

- `b54eec7e` test(67-02): RED — failing pure-logic tests (module absent)
- `ccdddee3` feat(67-02): GREEN — pure comparison layer (compare_dailies /
  funding_bucket_summary / db_trade_to_fill / build_report)
- `b3396794` feat(67-02): async reconciliation main (read-only, verdict-encoded exit)

## Self-Check: PASSED

All 2 created files exist on disk; all 3 commit hashes present in git history.
