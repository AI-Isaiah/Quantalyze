# Phase 67: Deribit Live Harness & Exchange Ground-Truth - Pattern Map

**Mapped:** 2026-07-04
**Files analyzed:** 5 (2 scripts, 1 answers doc + evidence dir, 2 test files) + conditional Bybit fix site
**Analogs found:** 5 / 5 (all new files have strong in-repo analogs)

> This is an evidence/runtime-ops phase, not a feature phase. Every mechanism the two scripts need already exists as a reusable seam — the correctness risk is in *reusing the exact production fetchers* (so the reconciliation exercises the #563 code paths), not in writing new code. All paths below are under `analytics-service/`.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `scripts/deribit_ground_truth.py` | script (one-off harness) | file-I/O (fetch → sanitized JSON stdout) | `scripts/probe_exchange_egress.py` | role-match (one-off `railway ssh` probe; different exchange/auth) |
| `scripts/bybit_reconcile.py` | script (one-off harness) | batch/transform (fetch + DB read → diff) | `services/job_worker.py::run_reconcile_strategy_job` (2171) + `run_derive_broker_dailies_job` (1716) | exact (orchestration shape) — but as a standalone script, structure from `probe_exchange_egress.py` |
| `docs/deribit-ground-truth.md` + `docs/evidence/*.json` | doc / evidence artifact | — (tracked output) | (none — new tracked `docs/` dir; distinct from gitignored `.planning/`) | no analog (see below) |
| `tests/test_deribit_ground_truth.py` | test (unit, pure logic) | — | `tests/test_reconciliation.py` | role-match (pure-fn unit tests over fixture dicts) |
| `tests/test_bybit_reconcile.py` | test (unit, pure logic) | — | `tests/test_reconciliation.py` + `tests/test_broker_dailies.py` | role-match |
| (conditional) Bybit fix site in `services/exchange.py` or `services/funding_fetch.py` | service fix | CRUD/transform | existing code at fix site (only if BYB-01 surfaces a real discrepancy) | n/a until found |

## Shared Reuse Map (the "Don't Hand-Roll" seams)

Both scripts are compositions over these existing functions. **Do not reimplement any of them.**

| Need | Reuse (file:line) | Signature / call shape |
|------|-------------------|------------------------|
| Create Deribit/Bybit ccxt client | `services/exchange.py:792` `create_exchange` | `create_exchange(name, api_key, api_secret, passphrase=None)` — HMAC for Deribit, Bybit `fetchCurrencies` disabled for read-only keys |
| Close ccxt client (avoid "Unclosed connector") | `services/exchange.py:830` `aclose_exchange` | `await aclose_exchange(ex)` in a `finally` |
| Decrypt founder's stored Bybit key | `services/encryption.py:92` `decrypt_credentials` + `:14` `get_kek` | `decrypt_credentials(key_row, get_kek()) -> (api_key, api_secret, passphrase|None)`; fails loud (`InvalidToken`) on NULL cols |
| Bybit fills fetch + cursor pagination (the #563 surface) | `services/exchange.py:2251` `_fetch_raw_trades_bybit` (via `:1737` `fetch_raw_trades`) | `PAGE_CAP=100`, stuck-cursor guard, `sync_truncated_bybit` DQ flag |
| Realized daily-pnl records (funding-excluded) | `services/exchange.py:2519` `fetch_all_trades` | `fetch_all_trades(ex, symbol=None, since_ms=None)` |
| Bybit funding rows | `services/funding_fetch.py:602` `fetch_funding_bybit` | `fetch_funding_bybit(ex, strategy_id, since_ms)`; 7-day window walk, linear+inverse fan-out, `MAX_PAGES=200` |
| Account equity (dailies anchor) | `services/exchange.py:2668` `fetch_account_equity_usd` | `fetch_account_equity_usd(ex, "bybit") -> (equity, balance_error)` |
| Fills set-equality diff (two-stage) | `services/reconciliation.py:216` `diff_strategy_fills` | see Pattern Assignment below |
| Dailies recompute (anchored, gap-filled) | `services/broker_dailies.py:119` `combine_realized_and_funding` | `combine_realized_and_funding(realized, funding, account_balance, balance_error=False) -> (pd.Series, meta)` |
| Geo-block body markers | `services/geo_block.py:34` `_GEO_BLOCK_MARKERS` / `:55` `is_geo_blocked` | add Deribit marker to the tuple *only if a real block body is observed* |
| Secret scrubbing before persist | `services/redact.py:186` `scrub_freeform_string` / `:174` `truncate_account_id` | scrub every logged exception (ccxt embeds `&signature=<HMAC>` in error URLs); `truncate_account_id` → `***<last4>` for ids |

---

## Pattern Assignments

### `scripts/deribit_ground_truth.py` (script, DRB-01 harness)

**Analog:** `scripts/probe_exchange_egress.py` (module docstring + WHY/USAGE/RUNBOOK header, `main() -> int` exit-code contract, `python -m scripts.X` idiom, `__future__` import, `if __name__ == "__main__": sys.exit(main())`).

**Module-header + entrypoint pattern** (`probe_exchange_egress.py` lines 1-52, 86-114):
```python
"""<WHY this script exists> ... USAGE:  railway ssh "cd /app && python -m scripts.deribit_ground_truth" ..."""
from __future__ import annotations
import json, sys
# ...
def main() -> int:
    # ... print structured findings; return non-zero on fail-loud condition
    ...
if __name__ == "__main__":
    sys.exit(main())
```
Note the analog is stdlib-only; this script differs — it needs the async ccxt client (`import ccxt.async_support`, `asyncio.run(main())`) and the `services.*` seams. Keep the docstring RUNBOOK + exit-code discipline; swap the body to authed async fetch.

**Read-only scope gate** (fail-loud BEFORE any fetch — RESEARCH Code Examples, verified ccxt 4.5.59):
```python
ex = create_exchange("deribit", client_id, client_secret)   # services/exchange.py:792
try:
    auth = await ex.public_get_auth({
        "grant_type": "client_credentials",
        "client_id": client_id, "client_secret": client_secret,
    })
    scope = auth["result"]["scope"]   # e.g. "account:read trade:read wallet:read ..."
    if any(tok.endswith(":read_write") or tok.endswith(":read_trade") for tok in scope.split()):
        raise SystemExit("FAIL-LOUD: Deribit key is not read-only: " + scope)
finally:
    await aclose_exchange(ex)         # services/exchange.py:830
```
(`get_account_summary` does NOT carry scopes — RESEARCH Pitfall 3. Scope MUST come from `public_get_auth`.)

**Per-currency enumeration + txn-log capture** (RESEARCH Code Examples — raw `private_get_*`, verified present in 4.5.59):
```python
for ccy in settlement_ccys:                      # enumerate from account, don't hard-code
    trades = await ex.private_get_get_user_trades_by_currency_and_time({...})  # follow has_more
    txnlog = await ex.private_get_get_transaction_log({"currency": ccy, ...})  # follow continuation
    # capture WHITELISTED fields verbatim: type, amount, balance, equity, cashflow,
    #   instrument_name, side, position, timestamp  (MASK username/user_id)
```
Record the **distinct set of `type` values + counts + a per-type sample row** — that resolves THE phase question (funding netted vs separate rows). Record per-currency trade counts (Phase 70 verifies against 18,778 / 21,014 / 61,248).

**Geo-block marker capture** — reuse `services/geo_block.py:34` `_GEO_BLOCK_MARKERS` for the substring set; the analog's inline `_is_geo_blocked` (probe lines 79-83, `status == 451` OR marker substring) shows the check shape. If no block occurs from Amsterdam egress (expected), record "no block observed — marker deferred; classifier is fail-safe" (RESEARCH Open Q3). Do NOT fabricate a marker.

**Sanitization before stdout/commit** — `services/redact.py:186` `scrub_freeform_string(str(exc))` on every logged exception (ccxt embeds `&signature=`); `truncate_account_id` for account/subaccount ids; never print `access_token`/secret.

---

### `scripts/bybit_reconcile.py` (script, BYB-01 reconciliation)

**Analog:** `services/job_worker.py:2171` `run_reconcile_strategy_job` (fills half) + `services/job_worker.py:1716` `run_derive_broker_dailies_job` (dailies half). Mirror the *call shape* but: standalone script (header/exit-code from `probe_exchange_egress.py`), a FIXED wide window (not 24h), and NO writes to `reconciliation_reports` / `strategy_analytics` (read-only evidence — RESEARCH anti-pattern).

**Fills half — decrypt → fetch fresh → diff** (mirror `run_reconcile_strategy_job` lines 2193-2214; RESEARCH Code Examples):
```python
api_key, api_secret, passphrase = decrypt_credentials(bybit_key_row, get_kek())  # encryption.py:92,14
ex = create_exchange("bybit", api_key, api_secret, passphrase)
try:
    exchange_fills = await fetch_raw_trades(ex, strategy_id, supabase, since_ms=window_start_ms)  # exchange.py:1737
finally:
    await aclose_exchange(ex)

# db_fills: SELECT exchange, exchange_fill_id, symbol, side, price, quantity, timestamp
#   FROM trades WHERE strategy_id=? AND is_fill=true AND timestamp >= window_start
report = diff_strategy_fills(                       # reconciliation.py:216
    strategy_id=strategy_id, date_range=(start, end),
    exchange_fills=exchange_fills, db_fills=db_fills,
)
# report.status / report.discrepancies — id_drift is INFORMATIONAL (Bybit rotates order ids)
```

**`diff_strategy_fills` two-stage contract** (`reconciliation.py:216-296`): Stage 1 PRIMARY exact match on `(exchange, exchange_fill_id)` — DB indexed by that tuple, matched rows removed from both sets, price/qty disagreement on an id-match surfaces as `mismatch_quantity`/`mismatch_price`; Stage 2 SECONDARY tuple match (`_tuple_matches`) emitting `id_drift` vs true discrepancy. Feed it fresh ccxt fills + DB `trades` rows; native-id column is `trades.exchange_fill_id` = Bybit `execId`.

**Dailies half — recompute vs stored within 1e-9** (mirror `run_derive_broker_dailies_job`; RESEARCH Pattern 2):
```python
equity, balance_error = await fetch_account_equity_usd(ex, "bybit")          # exchange.py:2668
realized = await fetch_all_trades(ex, since_ms=None)                         # exchange.py:2519 (funding-excluded)
funding  = await fetch_funding_bybit(ex, api_key_id, None)                   # funding_fetch.py:602
returns, meta = combine_realized_and_funding(realized, funding,             # broker_dailies.py:119
                                             account_balance=equity, balance_error=balance_error)
# Compare returns[date] vs stored csv_daily_returns.daily_return for this api_key_id,
#   over the OVERLAPPING historical tail; assert abs(delta) < 1e-9 per date.
```
**Caveat** (RESEARCH Pattern 2): anchor is `current_equity - total_pnl` (anchor-to-today); the most-recent day may legitimately move between runs. Reconcile on dates present in BOTH; prefer comparing realized+funding daily *deltas* over absolute reconstructed equity.

**Funding reconciliation** — by `match_key` bucket set or per-day funding sum, NOT native id (Bybit rotates transaction ids — RESEARCH Pitfall 4; see `funding_fetch.py:233` `_build_match_key`, `:197` `_FUNDING_BUCKET_HOURS`). Fills reconcile by `execId`; funding by bucket.

**#563 discipline** (RESEARCH Pitfall 5): record fills count deltas **even if zero**. A delta is only a BYB-01 bug if it changes reconciled P&L/dailies beyond `1e-9` OR drops funding rows. Clean reconciliation IS the evidence — do not manufacture a fix.

---

### `tests/test_deribit_ground_truth.py` + `tests/test_bybit_reconcile.py` (unit, pure logic)

**Analog:** `tests/test_reconciliation.py` (pure-function tests over constructed fill dicts, no mocking) and `tests/test_broker_dailies.py`.

**Structure pattern** (`tests/test_reconciliation.py` lines 1-55):
```python
"""Tests for <module>. Pure-function coverage — I/O-free, no mocking needed.
Regression gates: <WHY each case matters, tied to a finding>."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
import pytest
from services.reconciliation import diff_strategy_fills, ReconciliationReport

STRATEGY_ID = "0000...0001"
NOW = datetime(2026, 4, 16, 12, 0, 0, tzinfo=timezone.utc)
WINDOW = (NOW - timedelta(hours=24), NOW)

def _fill(fill_id="f1", exchange="bybit", ...) -> dict:
    """Matches the shape produced by exchange._normalize_fill."""
    return {"exchange": exchange, "exchange_fill_id": fill_id, ...}
```
Note the docstring encodes WHY each regression gate matters (Rule 9). Test targets per RESEARCH Test Map: scope gate rejects write scope; txn-log `type` summary aggregation over a fixture; evidence-JSON masking (no secrets / masked ids); fills-diff clean-set → status clean; dailies-within-1e-9 on a fixture. Drive them with a trimmed, masked real response captured from the live run.

**Framework:** pytest + pytest-asyncio (`asyncio_mode=auto`); `testpaths=tests`, `pythonpath=.` (`pytest.ini`). Quick run: `cd analytics-service && .venv/bin/python -m pytest tests/test_reconciliation.py tests/test_broker_dailies.py -x -q`. Coverage gate `--cov-fail-under=80`.

---

## Shared Patterns

### Credential decryption (fail-loud)
**Source:** `services/encryption.py:92` `decrypt_credentials` + `:14` `get_kek`
**Apply to:** `bybit_reconcile.py`
Envelope KEK→DEK Fernet. Raises `InvalidToken` (mapped `permanent`) naming the key id on NULL columns — never hand-roll Fernet.

### Secret scrubbing / masking before any persist or log
**Source:** `services/redact.py:186` `scrub_freeform_string`, `:174` `truncate_account_id`
**Apply to:** both scripts (evidence write + exception logging)
ccxt embeds `&signature=<HMAC>` in error URLs — `scrub_freeform_string(str(exc))` every logged exception. Mask account/subaccount ids + `username`/`email`; strip tokens. If a redacted evidence fixture trips gitleaks, allowlist that file same-batch (Gitleaks-redaction-fixtures memory).

### ccxt client lifecycle
**Source:** `services/exchange.py:792` `create_exchange` / `:830` `aclose_exchange`
**Apply to:** both scripts
Always `await aclose_exchange(ex)` in a `finally` (avoids "Unclosed connector" noise). Bybit read-only keys: `create_exchange` already disables `fetchCurrencies` (403-avoidance).

### Geo-block classifier
**Source:** `services/geo_block.py:34` `_GEO_BLOCK_MARKERS` / `:55` `is_geo_blocked`
**Apply to:** `deribit_ground_truth.py` (marker capture only)
Signature-based (not status-based). Add a Deribit marker to the tuple ONLY if a real block body is observed from the worker egress — otherwise defer (classifier is the fail-safe).

## No Analog Found

| File | Role | Reason |
|------|------|--------|
| `docs/deribit-ground-truth.md` + `docs/evidence/*.json` | doc / evidence artifact | `analytics-service/docs/` does not exist yet — the phase creates it (TRACKED). No prior tracked runtime-evidence doc exists; it is distinct from the gitignored `.planning/` ledger. Planner: structure = the 3 mandated answers (funding-netting shape, inverse/linear/options mix, block-body marker) each WITH a raw sanitized JSON excerpt proving it, per RESEARCH. Verify the new dir is NOT gitignored. |
| (conditional) Bybit fix + regression test | service fix | Only materializes if BYB-01 surfaces a real discrepancy (>1e-9 P&L/dailies delta OR dropped funding rows). Fix at the found site; regression test must fail without the fix (write-tests-immediately). |

## Key Patterns Identified

- **Composition over construction:** both scripts orchestrate existing production seams over a fixed/wide window; correctness comes from reusing the exact fetchers (`_fetch_raw_trades_bybit`, `fetch_funding_bybit`, `diff_strategy_fills`, `combine_realized_and_funding`), not new code.
- **One-off `railway ssh` script idiom:** `python -m scripts.X`, stdlib/async entrypoint, `main()` exit-code contract, WHY/USAGE/RUNBOOK docstring — modeled on `probe_exchange_egress.py`. These are orchestrator `checkpoint:human-action` runs (executor subagents have no railway auth / no Supabase MCP).
- **Fail-loud gates before side effects:** Deribit read-only scope gate via `public_get_auth` scope BEFORE any fetch; `decrypt_credentials` fails loud (naming the key id) on malformed rows.
- **Distinct reconciliation keys per row type:** fills by native `execId`; funding by `match_key` bucket (ids rotate); dailies by `(date, daily_return)` within 1e-9 — never one blanket set-equality.
- **Read-only evidence:** no writes to `reconciliation_reports` / `strategy_analytics` / prod tables; recompute in-memory; sanitize before committing tracked evidence.

## Metadata

**Analog search scope:** `analytics-service/scripts/`, `analytics-service/services/`, `analytics-service/tests/`
**Files scanned/read:** `scripts/probe_exchange_egress.py`, `services/geo_block.py`, `services/reconciliation.py`, `services/encryption.py`, `services/broker_dailies.py`, `services/exchange.py` (targeted), `services/funding_fetch.py` (targeted), `services/redact.py`, `services/job_worker.py` (targeted), `tests/test_reconciliation.py`
**Pattern extraction date:** 2026-07-04
</content>
</invoke>
