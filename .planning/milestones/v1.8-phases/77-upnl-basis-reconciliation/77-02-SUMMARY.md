---
phase: 77-upnl-basis-reconciliation
plan: 02
subsystem: analytics
tags: [upnl, flow-aware-twr, venue-gating, okx, deribit, realized-basis, double-count-guard, python, ccxt]

# Dependency graph
requires:
  - phase: 77-upnl-basis-reconciliation
    plan: 01
    provides: unrealized_pnl_in_anchor materiality flag + open_unrealized_usd terminal seam this read now supplies a real value for
provides:
  - "fetch_okx_total_equity_and_upl_usd(exchange) -> (totalEq|None, upl) — OKX equity + companion open-uPnL from ONE private_get_account_balance response"
  - "fetch_account_equity_and_upnl_usd(exchange, venue) -> (equity, balance_error, open_unrealized_usd) — venue-gated 3-tuple dispatch (OKX real upl; Bybit/Binance structural 0.0)"
  - "fetch_deribit_account_equity_and_upnl_usd(exchange) -> (equity, balance_error, open_unrealized_usd) — Deribit equity + session_upl wedge from ONE get_account_summaries response + same index_prices"
  - "_deribit_session_upl_to_usd — pure session_upl->USD wedge conversion mirroring deribit_equity_to_usd"
affects: [77-03-derive-path-wiring]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Venue-gated companion read: the uPnL wedge is read from the SPECIFIC anchor field (OKX upl in totalEq response, Deribit session_upl in summaries), and is STRUCTURALLY 0.0 for realized-basis walletBalance venues (Bybit/Binance) so a downstream subtract can never double-count (Q2/Pitfall-2)"
    - "No-new-fetch companion: the wedge rides the existing equity response object (OKX private_get_account_balance / Deribit get_account_summaries); the 2-tuple functions delegate to the new 3-tuple so existing callers stay byte-identical"
    - "Safe non-fabricating fallback: absent/null/non-numeric/unvaluable uPnL field coerces to a 0.0 wedge, never an invented value (T-77-05)"

key-files:
  created: []
  modified:
    - analytics-service/services/exchange.py
    - analytics-service/services/deribit_ingest.py
    - analytics-service/tests/test_exchange.py
    - analytics-service/tests/test_job_worker_deribit.py

key-decisions:
  - "Deribit uPnL field = session_upl (Deribit account-summary session unrealized PnL; HIGH confidence — the documented open-uPnL component of get_account_summaries). Tagged [ASSUMED A1] in-code with an absent-field->0.0 fallback path proven by a dedicated test, so a wrong field name degrades to the conservative wedge-0.0 rather than a fabricated value."
  - "Bybit/Binance wedge is hard-coded 0.0 by construction (NOT a read field) — the anchor is realized-basis walletBalance, so any non-zero wedge there is the Pitfall-2 double-count"
  - "OKX wedge forced to 0.0 when equity is None (a failed/empty read has no trustworthy wedge)"
  - "Deribit wedge inherits the equity anchor's fail-loud disposition: an unvaluable held currency -> (None, True, 0.0), never a fabricated wedge"
  - "2-tuple functions (fetch_okx_total_equity_usd, fetch_account_equity_usd, fetch_deribit_account_equity_usd) preserved byte-identical via delegation — allocators + other callers unaffected"

patterns-established:
  - "Companion read delegation: new N+1-tuple function owns the impl+docstring; the pre-existing lower-arity function becomes a thin delegate returning its leading elements"

requirements-completed: []  # FLOW-04 spans 77-01/02/03; NOT complete until 77-03 threads the wedge through the derive path

# Metrics
duration: 35min
completed: 2026-07-06
---

# Phase 77 Plan 02: Venue-Gated Companion Open-uPnL Reads Summary

**Venue-gated companion open-uPnL reads — OKX `upl` (from the same `private_get_account_balance` response as `totalEq`) and Deribit `session_upl` (from the same `get_account_summaries` response + same `index_prices` as the equity anchor) are read as the SC-1 wedge, while Bybit/Binance return a structural 0.0 because their anchor is realized-basis `walletBalance` — so a downstream subtract can never double-count (Q2/Pitfall-2). No new fetch; safe non-fabricating fallback on absent fields.**

## Performance
- **Duration:** ~35 min
- **Tasks:** 2 (each TDD RED -> GREEN)
- **Files modified:** 4

## Accomplishments
- **OKX (exchange.py):** added `fetch_okx_total_equity_and_upl_usd` reading `data[0].upl` alongside `data[0].totalEq` from ONE response object (awaited-exactly-once asserted — no new HTTP round-trip); `_okx_upl_or_zero` coerces absent/null/non-numeric to 0.0 with the sign trusted verbatim. Added the venue dispatch `fetch_account_equity_and_upnl_usd` returning the `(equity, balance_error, open_unrealized_usd)` 3-tuple: OKX supplies the real `upl`; Bybit/Binance return a hard-coded structural 0.0.
- **Deribit (deribit_ingest.py):** added `fetch_deribit_account_equity_and_upnl_usd` summing a `session_upl` wedge from the SAME `get_account_summaries` summaries + the SAME resolved `index_prices` as the equity anchor, via `_deribit_session_upl_to_usd` (mirrors `deribit_equity_to_usd`: USD-family pass-through; non-linear ccy x `{ccy}_usd` index). Absent/null/non-numeric/unvaluable -> 0.0 wedge (A1 fallback, never fabricated); a held currency with no resolvable index inherits the anchor's `(None, True, 0.0)` fail-loud.
- **Byte-identical delegation:** the three pre-existing 2-tuple functions now delegate to the new 3-tuple functions and return their leading elements — allocators and every other caller of `fetch_account_equity_usd` / `fetch_deribit_account_equity_usd` are unaffected (their existing tests stay green).

## Task Commits
1. **Task 1: RED — OKX venue-gated companion uPnL tests** - `c8c3ea34` (test)
2. **Task 1: GREEN — OKX + venue-dispatch companion read** - `a3281136` (feat)
3. **Task 2: RED — Deribit session-uPnL companion tests** - `e2b639e8` (test)
4. **Task 2: GREEN — Deribit session-uPnL companion read** - `eed197b1` (feat)

_`.planning/` is gitignored (local-only); no docs metadata commit — code commits are the record._

## Files Created/Modified
- `analytics-service/services/exchange.py` - `_okx_upl_or_zero`; `fetch_okx_total_equity_and_upl_usd`; `fetch_account_equity_and_upnl_usd` venue dispatch; `fetch_okx_total_equity_usd` + `fetch_account_equity_usd` delegate (2-tuple intact).
- `analytics-service/services/deribit_ingest.py` - `_deribit_session_upl_to_usd`; `fetch_deribit_account_equity_and_upnl_usd`; `fetch_deribit_account_equity_usd` delegates (2-tuple intact).
- `analytics-service/tests/test_exchange.py` - 5 tests: OKX single-call companion (awaited-once), negative-sign preserved, missing/null upl -> 0.0, Bybit/Binance structural 0.0, balance-error -> (None, True, 0.0).
- `analytics-service/tests/test_job_worker_deribit.py` - 5 tests + `_FakeDeribitSummaries` stub: session_upl valued via same summaries+index, USD-family pass-through, missing/null session_upl -> 0.0 fallback, failed read -> (None, True, 0.0), unvaluable non-linear ccy inherits fail-loud.

## Decisions Made
- **Deribit field = `session_upl` (A1)** — HIGH confidence (the documented Deribit account-summary open-unrealized component). Tagged `[ASSUMED A1]` in-code; a wrong field name degrades to the conservative wedge-0.0 fallback (proven by `test_deribit_missing_session_upl_fallback_zero`), NEVER a fabricated value. See A1 Confirmation below.
- **Bybit/Binance wedge structurally 0.0** — hard-coded in the dispatch (not a read field). Their anchor is realized-basis `walletBalance` (ccxt 4.5.59 `bybit.parse_balance` / binance spot), so a non-zero wedge would double-count (Q2/Pitfall-2).
- **OKX wedge forced 0.0 when equity is None** — a failed/empty read has no trustworthy wedge.
- **2-tuple preservation via delegation** — existing callers stay byte-identical.

## A1 Confirmation (Deribit field name)
- **Field used:** `session_upl`.
- **Confidence:** HIGH. `session_upl` is the Deribit `private/get_account_summary(-ies)` session unrealized-PnL field (the open-position mark-to-market component that lives inside the marked `equity` anchor). The codebase had no existing reader of this field (grep found none), so it could not be cross-confirmed against a fixture; the choice rests on the Deribit account-summary schema.
- **Safety:** the read is guarded by an absent/null/non-numeric -> 0.0 fallback (`test_deribit_missing_session_upl_fallback_zero`). If a live LTP read at 77-03 wiring time shows the field is named differently, the wedge silently degrades to 0.0 (the flag stays clear) rather than fabricating — no correctness risk, only a missed (warning-only) materiality signal until the name is corrected.

## Deviations from Plan
None - plan executed exactly as written.

## Issues Encountered
- One mypy `--strict` fix during GREEN (Task 1): `_okx_upl_or_zero(raw_upl: object)` tripped `float(object)` incompatible-type; retyped the param `Any` (the value is untyped ccxt JSON). Not a behavior change.

## Threat Model Compliance
- **T-77-04 (Bybit/Binance wedge double-count):** mitigated — dispatch returns structural 0.0 for the walletBalance venues (`test_bybit_binance_wedge_zero`).
- **T-77-05 (malformed upl/session_upl):** mitigated — null/absent/non-numeric coerces to 0.0 (`_okx_upl_or_zero`, `_deribit_session_upl_to_usd`), never fabricated.
- **T-77-06 (balance/upl in logs):** mitigated — scrub-before-log preserved; no raw USD emitted (no new log lines carry the wedge).
- **T-77-SC (pip installs):** honored — no packages installed.

## Known Stubs
None. Bybit/Binance returning 0.0 is a deliberate structural invariant (realized-basis anchor), not a stub. FLOW-04's end-to-end wedge threading is intentionally deferred to 77-03 (the derive path); the reads themselves are fully wired and tested.

## Verification Evidence
- Task 1: `pytest test_exchange.py -k "okx_upl or upnl or wedge or zero"` — 8 passed. `mypy --strict services/exchange.py` — clean.
- Task 2: `pytest test_job_worker_deribit.py -k "session_upl or upnl or wedge or fallback"` — 5 passed. `mypy --strict services/deribit_ingest.py` — clean; `ruff check` — clean.
- Targeted files: `pytest test_exchange.py test_job_worker_deribit.py` — 173 passed. `mypy --strict` both files — clean.
- Full analytics suite — **3108 passed, 92 skipped** (CI-3.12 venv); 77-01 baseline 3098 + 10 new, all P73-76 pins GREEN.
- Pre-existing (out-of-scope) ruff findings in exchange.py logged to `deferred-items.md` (F401 :1806, E402 :2818) — untouched.

## Next Phase Readiness
- 77-03 can now call `fetch_account_equity_and_upnl_usd` (OKX/Bybit/Binance) and `fetch_deribit_account_equity_and_upnl_usd` (Deribit) to supply a real `open_unrealized_usd` into `reconstruct_nav_and_twr`'s terminal seam, and lift `unrealized_pnl_in_anchor` through the DQ bridge (mirror the `flow_coverage_incomplete` lift + `_BROKER_WARN_FLAGS`).
- If a live Deribit LTP read at wiring time contradicts `session_upl`, correct the field name in `_deribit_session_upl_to_usd` (the fallback keeps it safe until then).
- No blockers.

## Self-Check: PASSED
- Commit `c8c3ea34` (Task 1 RED) — FOUND
- Commit `a3281136` (Task 1 GREEN) — FOUND
- Commit `e2b639e8` (Task 2 RED) — FOUND
- Commit `eed197b1` (Task 2 GREEN) — FOUND
- `analytics-service/services/exchange.py` — FOUND (fetch_account_equity_and_upnl_usd, fetch_okx_total_equity_and_upl_usd, _okx_upl_or_zero)
- `analytics-service/services/deribit_ingest.py` — FOUND (fetch_deribit_account_equity_and_upnl_usd, _deribit_session_upl_to_usd)
- `.planning/phases/77-upnl-basis-reconciliation/77-02-SUMMARY.md` — FOUND

---
*Phase: 77-upnl-basis-reconciliation*
*Completed: 2026-07-06*
