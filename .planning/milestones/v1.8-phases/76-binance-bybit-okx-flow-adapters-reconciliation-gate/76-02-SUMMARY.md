---
phase: 76-binance-bybit-okx-flow-adapters-reconciliation-gate
plan: 02
subsystem: analytics
tags: [ccxt, external-flows, event-time-valuation, twr, deposits, withdrawals, own-transfer, fail-loud]

# Dependency graph
requires:
  - phase: 75-deribit-flow-adapter
    provides: "ExternalFlow contract (FLOW-01) + NavReconstructionError + _row_utc_day shared day-key; the deribit_dated_external_flows_usd pure producer precedent this mirrors"
  - phase: 76-01
    provides: "fetch_ccxt_transfers — the shared ccxt transfer-fetch path whose rows this pure adapter values"
provides:
  - "services/ccxt_flows.py — pure ccxt_rows_to_dated_flows(rows, *, venue, price_index) -> sorted list[ExternalFlow]: per-venue own-transfer exclusion + event-time coin→USD valuation (fail-loud, stablecoins→1.0)"
  - "Canonical PriceIndex key alias tuple[str,str] = (utc_day_iso 'YYYY-MM-DD', UPPERCASE ccy) — the exact key shape 76-04's index builder must emit (W4)"
affects: [76-04 ccxt wire, 76-03 reconciliation gate, FLOW-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Pure/I-O split mirroring deribit_txn: the flow VALUATION math is stdlib-only and takes an injected price_index; the 76-04 wiring supplies the resolved index (no ccxt/network/pandas in the math)"
    - "Event-time coin→USD fail-loud: a non-stable flow is valued at its same-UTC-day close or the whole reconstruction raises NavReconstructionError — never 1.0/current/drop"
    - "Per-venue own-transfer exclusion as data, not a copy-paste: Binance unified `internal is False`, Bybit raw `info.withdrawType=='0'` (ccxt internal is None), OKX structural keep-all"

key-files:
  created:
    - analytics-service/services/ccxt_flows.py
    - analytics-service/tests/test_ccxt_flows.py
  modified: []

key-decisions:
  - "Sign trusted from the ccxt `type` (deposit +, withdrawal −); `amount` supplies magnitude only and is never re-signed from direction (FLOW-01 contract discipline)"
  - "Reused nav_twr.NavReconstructionError (not a fresh subclass) so the worker's typed catch treats a structural flow failure as permanent, not retryable — accepts the transitive pandas/numpy import via nav_twr, matching the plan's explicit interface"
  - "Own-transfer filter is per-venue and structural: Bybit reads raw info.withdrawType because ccxt leaves `internal=None`; OKX keeps all None-internal rows (its history endpoints are structurally external)"

patterns-established:
  - "Pure ccxt flow adapter: ccxt_rows_to_dated_flows is the venue-agnostic valuer the 76-04 else-branch imports, mirroring how deribit_ingest feeds the pure deribit producer"

requirements-completed: []  # FLOW-03 still PARTIAL — 76-04 wires this pure valuer into the ccxt else-branch to complete it

# Metrics
duration: ~30min
completed: 2026-07-06
---

# Phase 76 Plan 02: Pure ccxt Event-Time Flow Adapter Summary

**`ccxt_rows_to_dated_flows` — the stdlib-only ccxt analog of Deribit's dated-flow producer: per-venue own-transfer exclusion (Binance unified `internal`, Bybit raw `withdrawType`, OKX structural) + event-time coin→USD valuation at the same-UTC-day close, failing loud (NavReconstructionError) rather than ever valuing a non-stable flow at 1.0 / a current price / dropping it.**

## Performance
- **Duration:** ~30 min
- **Completed:** 2026-07-06
- **Tasks:** 2 (one RED→GREEN TDD pair)
- **Files modified:** 2 (both created)

## Accomplishments
- `services/ccxt_flows.py` values every ccxt deposit/withdrawal at EVENT-TIME USD and emits the shared `ExternalFlow(utc_day_iso, usd_signed)` — the same-day close for non-stables (from the injected `price_index`), 1.0 for stablecoins, fail-loud when a non-stable has no same-day price. This is the silent-corruption gate the whole v1.8 milestone exists to close, applied to the ccxt venues.
- Per-venue own-transfer exclusion proven mutation-honest for all three venues: Binance drops `internal is True`, Bybit reads raw `info.withdrawType=='0'` (because ccxt sets `internal=None` for Bybit), OKX keeps its structurally-external None-internal rows.
- Canonical `PriceIndex` key `tuple[str, str] = (utc_day_iso 'YYYY-MM-DD', UPPERCASE ccy)` declared as a type alias and documented in the module so 76-04's index builder rides the EXACT key shape — a date-object or lowercase-code key would silently KeyError → spurious NavReconstructionError (plan-checker Warning 4 closed).
- Schema-drift discipline mirrored from the Deribit producer: absent / null / blank `amount` fails loud (a coalesced 0.0 would silently drop real capital and mis-anchor the TWR base); a numeric 0.0 is a no-op that needs no price.

## Task Commits
1. **Task 1 (RED): failing mutation-honest proofs** — `90c11b39` (test)
2. **Task 2 (GREEN): pure ccxt flow adapter** — `23ee40cf` (feat)

**Plan metadata:** (docs commit — this SUMMARY + STATE + ROADMAP)

## Files Created/Modified
- `analytics-service/services/ccxt_flows.py` — NEW pure module: `ccxt_rows_to_dated_flows(rows, *, venue, price_index)`, the `_is_external` per-venue own-transfer predicate, the `PriceIndex` canonical-key alias, and the `_MISSING` schema-drift sentinel. Imports ONLY the pure shared contract (`ExternalFlow`, `_row_utc_day`, `STABLECOINS`, `NavReconstructionError`).
- `analytics-service/tests/test_ccxt_flows.py` — NEW: 17 tests — per-venue own-transfer fixtures (Binance/Bybit/OKX), event-time same-day valuation with distinct per-day BTC constants (42000/45000/41000), stablecoin=1.0 against an empty index, no-same-day-price fail-loud, sign, same-day collapse, missing/null/blank amount fail-loud, 0.0 no-op, unknown venue/type fail-loud, and a purity source-scan.

## Decisions Made
- **Sign source = ccxt `type`, single-trusted:** deposit → +, withdrawal → −; `amount` is magnitude only, never re-derived from direction after signing (matches the FLOW-01 "trusted verbatim" rule). An unsignable `type` fails loud rather than guessing a capital flow's direction.
- **Reuse `nav_twr.NavReconstructionError`:** the plan mandates the core's error type so `job_worker.py`'s typed catch treats a structural flow failure as permanent (not a retryable network blip). This transitively imports pandas/numpy via `nav_twr`, which is accepted — the purity requirement is that this module's OWN source does no ccxt/network/pandas MATH, verified by a source-scan test (the transitive import is a typing/contract dependency, exactly as the plan's `<interfaces>` prescribes).
- **Bybit filter reads raw `info.withdrawType`:** ccxt's `parse_transaction` leaves `internal=None` for Bybit, so a Binance-style `internal is False` copy would drop everything; deposits are on-chain by nature (kept), withdrawals kept iff `withdrawType=='0'`.

## Deviations from Plan
None — plan executed exactly as written. The plan suggested "one commit pair per behavior cluster (own-transfer filter; event-time valuation)"; both clusters were delivered in a single honest RED→GREEN pair because a filter test's assertion (a surviving row becomes an `ExternalFlow` F_t) structurally requires the valuation path, making the two clusters inseparable for a mutation-honest proof. The `type: tdd` gate (a `test(...)` commit before a `feat(...)` commit) is satisfied.

## Issues Encountered
None.

## TDD Gate Compliance
- RED gate: `90c11b39` `test(76-02): ...` — verified failing (ModuleNotFoundError: services.ccxt_flows) before implementation.
- GREEN gate: `23ee40cf` `feat(76-02): ...` — 17/17 GREEN.
- No REFACTOR commit needed.

## Mutation-Honesty Verification (proven RED on revert, then restored GREEN)
- Neuter the Binance own-transfer filter (keep all) → `test_binance_own_transfer_excluded_only_deposit_survives` RED (own-transfer leaks, 1000 → 6000).
- Value non-stable at 1.0 → `test_non_stable_valued_at_same_utc_day_close` + `..._uses_the_days_own_close_per_day` RED.
- Substitute the most-recent (cross-day) close → `..._uses_the_days_own_close_per_day` RED.

## Threat Flags
None — no new security surface. T-76-02-VAL (fabricated return) mitigated by same-day-close-or-fail-loud; T-76-02-FILT (inflated flows) mitigated by the raw-`withdrawType` Bybit filter; T-76-02-MISS (dropped capital) mitigated by the absent/null/blank amount fail-loud guard; no package installs (T-76-02-SC).

## Known Stubs
None. `ccxt_flows.py` is a complete pure valuer; the `price_index` is injected by design (76-04 supplies the I/O resolver), which is the intended pure/I-O split, not a stub.

## Verification
- `tests/test_ccxt_flows.py` — 17 passed. Every mutation proof verified RED under its mutation, restored GREEN.
- Full analytics suite in the CI-3.12 venv: **3058 passed / 92 skipped** (3041 baseline from 76-01 + 17 new).
- `mypy --strict services/ccxt_flows.py` — clean.
- Purity source-scan test passes: no ccxt/pandas/numpy/os/sys/requests/httpx/socket/subprocess/open in the module source; only the four whitelisted contract imports.

## Canonical Key (for 76-04)
`price_index` MUST be keyed `tuple[str, str] = (utc_day_iso, currency_upper)`:
- `utc_day_iso` — the 'YYYY-MM-DD' string from the shared `_row_utc_day` helper (NOT a `datetime.date` / `datetime`).
- `currency_upper` — the UPPERCASE ccxt currency code.
Any other key shape silently misses every lookup → spurious `NavReconstructionError`.

## Next Phase Readiness
- `ccxt_rows_to_dated_flows` is ready for 76-04 to import into the ccxt else-branch (fetch via `fetch_ccxt_transfers` → build the same-UTC-day close `price_index` → this pure valuer → the flow-aware TWR core). FLOW-03 remains PARTIAL until that wire lands.
- 76-03 (DQ-02 reconciliation gate) is independent (pure in `nav_twr.py`) and untouched here.

## Self-Check: PASSED
- `analytics-service/services/ccxt_flows.py` — FOUND
- `analytics-service/tests/test_ccxt_flows.py` — FOUND
- Commits `90c11b39`, `23ee40cf` — FOUND

---
*Phase: 76-binance-bybit-okx-flow-adapters-reconciliation-gate*
*Completed: 2026-07-06*
