---
phase: 186-derivegaps-the-per-key-derive-refuses-a-truncated-or-failed
plan: 10
subsystem: analytics-service (Bybit per-key derive flows)
tags: [derivegaps, derive-broker-dailies, bybit, unified-flows, d-02, sc-3, twr]
status: complete

requires:
  - phase: 186-03
    provides: "pair_onchain_with_unified (not called by the derive under replace)"
  - phase: 186-04
    provides: "g2-flow-final: replace; g2-non-uta: none-on-prod; q-composite: book"
  - phase: 186-09
    provides: "READ_INCOMPLETE_TOKENS, _record_read_incomplete, the read_incomplete:<key> marker"
provides:
  - "services/job_worker.py: the Bybit flow block reads fetch_bybit_unified_flows under the crawl bound; marker token bybit_unified_flow_error"
  - "tests/test_trade_pages.py: test_job_worker_imports_the_unified_flows_reader_once (replaces the 180 D-02 pin)"
affects: [186-11, 186-13, 186-14]

key-files:
  modified:
    - analytics-service/services/job_worker.py
    - analytics-service/services/bybit_unified_flows.py
    - analytics-service/tests/test_derive_broker_dailies_dualmode.py
    - analytics-service/tests/test_trade_pages.py
    - analytics-service/tests/test_job_worker.py
    - analytics-service/tests/test_job_worker_flipretry.py
    - analytics-service/tests/test_allocator_equity_realized_basis.py
    - analytics-service/tests/test_nav_marks_compose_roundtrip.py
    - analytics-service/tests/test_nav_marks_derive_apply.py
    - analytics-service/tests/test_nav_marks_l4_read.py
    - TODOS.md

key-decisions:
  - "D-02 (founder 2026-11-01): the Bybit derive counts money crossing the Unified wallet's edge as flows, by the source 186-04 recorded (replace): Unified rows only, the on-chain deposit and withdrawal reads are skipped for Bybit"
  - "A failed Unified read in key mode records read_incomplete:<key> with token bybit_unified_flow_error and the class name, and re-raises the same object so classify_exception is untouched"

plan_head_before: e07c025d5e7dc4437a2f9f0c428ba9a2431c5141
plan_head_after: 8e242737b1a788597b27c2e06293de1bc16f03eb
commits: 2

actuals:
  tokens: 40000
  tasks: 2
  commits: 2
---

# Phase 186 Plan 10: The Bybit derive reads Unified-edge transfers as capital flows Summary

The per-key Bybit derive now reads `fetch_bybit_unified_flows(ctx.exchange, _flow_since_ms, now_ms)` under the same `asyncio.wait_for(..., _BROKER_CRAWL_TIMEOUT_S)` as the other flow reads, and builds `_flow_rows` from the Unified rows alone, so an internally funded account shows its transfer as a flow and no P&L spike.

## Source implemented, and the non-UTA branch

- Source: `g2-flow-final: replace` (186-04: no on-chain rows on PROD, 6 Unified rows). Only `replace` exists in the code: for Bybit the on-chain `fetch_ccxt_transfers` reads are skipped (nothing else in the block consumes them) and the Unified rows are the whole flow source. Every other venue keeps its on-chain reads; the diff of the block outside the Bybit arm is whitespace only (`git diff -w`).
- `g2-non-uta: none-on-prod` branch taken: no account-type read (`/v5/user/query-api`) was added. A classic key's reader error is named by the marker below.
- `pair_onchain_with_unified` is not called by the derive (only the probe uses it); its docstring now says so.

## Marker

`READ_INCOMPLETE_TOKENS` gained `bybit_unified_flow_error` (8 names). In key mode any Unified read exception other than a rate limit (`ccxt.RateLimitExceeded` / `ccxt.DDoSProtection`, left to the outer 429 arm) or a timeout (left to the existing per-crawl-bound arm, transient) records the marker with the exception class name only, then re-raises the SAME object. `classify_exception` is untouched, so `BybitUnifiedFlowReadError` stays permanent.

## Tests (RED first, then neuter-proved)

- `TestBybitUnifiedTransfersAreFlows` (7 cases) in `test_derive_broker_dailies_dualmode.py`. Inputs: +100 P&L on each of days 1 to 5, TRANSFER_IN 5,000 on day 3, anchor 15,500.
  - Oracle (a), hand product from NAV_0 = 10,000 under the combine's end-of-day flow convention (`NAV_{t-1} = NAV_t - pnl_t - F_t`): `10,300/10,000 * 15,500/15,300 - 1` = 4.3464%. RED log: today's value 3.3333% (`15,500/15,000 - 1`).
  - Oracle (b), `apply_marks` with marks 10,000 / 10,100 / 15,200 / 15,300 / 15,400: day-3 return `100/10,100` at most 1% with the derive's flows; 50.5% with `flows_by_day={}`. RED log: 0.5050 with today's empty flows.
  - Replace rule (an on-chain deposit fixture is not read, the transfers mock is never awaited), withdrawal sign, other venues keep the on-chain reads and never read Unified.
- `TestBybitUnifiedReadFailureIsNamed` (5 cases): reader refusal and another exception are marked and propagate as the same object; rate limit not marked (429 stamp); timeout transient and not marked; token in the closed set. The existing closed-set pin test was extended by the new token.
- Neuter proofs from byte backups in `$DG_SP`, restored and `cmp`-equal: dropping the Unified rows from `_flow_rows` fails 5 of 7 tracer cases (`neuter-10-1.log`); disabling the marker write fails 2 of 5 failure cases (`neuter-10-2.log`). RED logs: `red-10-pin.log`, `red-10-1.log`, `red-10-2.log`.

## Pin, notes, harnesses

- The 180 D-02 pin is replaced: `test_job_worker_imports_the_unified_flows_reader_once` (one `job_worker.py` line names `services.bybit_unified_flows` and imports the reader; the only service modules naming the function are the reader and the worker; `broker_dailies.py` and `okx_archive_job.py` name neither).
- `bybit_unified_flows.py` docstring Scope sentence and Pairing sentence rewritten; `TODOS.md` `176-RECONSTRUCT-CAP-MARKER-INERT` carries a dated sentence with "live caller since Phase 186".
- Harness files patched with the Unified reader (found by running the full suite after Task 1; 36 failures in 8 files): `test_job_worker.py` (flow harness routes its fixture rows through the Unified reader so the bybit cases still drive rows through the valuer), `test_job_worker_flipretry.py` (the bybit hang test now hangs the Unified read, the price-index test returns `([], [])`), `test_allocator_equity_realized_basis.py`, `test_nav_marks_compose_roundtrip.py`, `test_nav_marks_derive_apply.py`, `test_nav_marks_l4_read.py` (whose `_derive` also serves `test_nav_marks_bybit_uta.py` and `test_nav_marks_refusal_record.py`). `test_derive_allocator_equity_job.py`, `test_nav_marks_writer.py` and `test_stitch_composite_job.py` stayed green and are untouched.

## Verification

- Full suite from `analytics-service/`: `.venv/bin/python -m pytest -q -n auto --dist loadgroup`: 13714 passed, 97 skipped, 0 failed.
- Plan targets (trade_pages, dualmode, job_worker, bybit_unified_flows, flipretry, realized_basis, derive_allocator_equity_job, nav_marks compose_roundtrip / derive_apply / l4_read / writer): 671 passed, 1 skipped.
- CI mypy line verbatim: `Success: no issues found in 131 source files`.
- `grep -acF 'services.bybit_unified_flows' services/job_worker.py` = 1. `classify_exception` is not in the diff.
- `npx tsx scripts/check-planning-hygiene.ts` skipped: no `node_modules` here (TODOS.md edit is one appended sentence on an existing paragraph).

## Deviations from Plan

**1. [Rule 3 - Blocking] The pin replacement landed in Task 1, not Task 2.** Importing the reader into `job_worker.py` (Task 1 step 1) makes the old pin red, so the new pin test was written first (RED, `red-10-pin.log`) and committed with Task 1 to keep that commit's pin green. Task 2's work is otherwise as planned.

**2. [Rule 3 - Blocking] Two harness files outside the frontmatter list needed no edit of their own** (`test_nav_marks_bybit_uta.py`, `test_nav_marks_refusal_record.py` went red but share `test_nav_marks_l4_read.py::_derive`, which is patched). Three listed files stayed green and were not touched, per the plan's own rule.

**3. Task 1 commit leaves 36 harness tests red** until the Task 2 commit (the plan places the harness patches in Task 2). The branch head is green.

## Known Stubs

None.

## Threat Flags

None. The read is the existing reader; no new endpoint or table. T-186-25 (double count) is held by the replace source with the "counts exactly once" test; T-186-26 by the closed token plus identifier-regex class name.

## Self-Check: PASSED

Commits `c90cff527` and `8e242737b` are ancestors of HEAD; the files above exist; no migration was added; no PROD access was made.
