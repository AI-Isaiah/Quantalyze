---
phase: 184-walletoffset-the-first-mark-offset-on-wallet-base-venues-is
plan: 01
subsystem: analytics-service
tags: [probe, okx, bills-archive, nav-marks, read-only, offset]

requires:
  - phase: 167.2.1.1.1 NAVMTM
    provides: api_key_nav_marks, read_key_marks, placed_flow_instants, the wallet-base decision D-27
provides:
  - the read-only first-mark offset probe with the OKX venue reader complete
  - okx_bill(pnl=, fee=) test helper, additive and default-off
affects: [184-02, 184-03, 184-04, 184-05]

actuals:
  tokens: 18000
  tasks: 2
  commits: 4
plan_head_before: d86f8608e8ac4242b9bac862a3703ade983bff54
plan_head_after: aaf6640d039e718d1a5d731b4cbe25a935ea5865

tech-stack:
  added: []
  patterns:
    - "whitelist emitter as the only path to stdout, closed vocabularies, field-absent never 0"
    - "one exception-mapping place (failure_token) turning a reader failure into a closed token"

key-files:
  created:
    - analytics-service/scripts/walletoffset_probe.py
    - analytics-service/tests/test_walletoffset_probe.py
  modified:
    - analytics-service/tests/_okx_bills.py

key-decisions:
  - "The window is rebuilt from marked_at itself (B = UTC midnight of the read day, R = marked_at), never from the mark_day label; membership uses placed_flow_instants for flows and an inclusive in_window for bills."
  - "okx_window_terms reads pnl and fee with a default of 0 when the key is absent, like the chain's own bill.get('pnl', 0), so it accepts raw okx_bill dicts as well as the walk's parsed bills."

requirements-completed: [SC-1, SC-3]

coverage:
  - id: D1
    description: "One marked OKX key travels from its stored mark through the archive walk, the chain's terms, the flow term and the arithmetic to one whitelisted record and a summary record"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "tests/test_walletoffset_probe.py#test_tracer_one_okx_key_first_mark_offset_end_to_end"
        status: pass
    human_judgment: false
  - id: D2
    description: "Window edges, offset arithmetic against hand-computed literals, OKX sums, walk refusal tokens, flow term"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "tests/test_walletoffset_probe.py -k 'window or offset or okx or flows' (55 passed)"
        status: pass
    human_judgment: false
  - id: D3
    description: "No published number changes: only the new script, its test file and an additive test-helper edit changed"
    requirement: SC-3
    verification:
      - kind: other
        ref: "SCOPE_OK gate over analytics-service, supabase, src; full analytics-service pytest 14133 passed"
        status: pass
    human_judgment: false

duration: ~45min
completed: 2026-11-01
status: complete
---

# Phase 184 Plan 01: First-mark offset probe (OKX reader) Summary

**Read-only `walletoffset_probe` that rebuilds an OKX key's [UTC midnight of the read day, marked_at] window from the bills archive with the chain's own pnl + fee and funding terms, adds the chain's own flows placed by the applier's rule, and prints the P&L part, flow part and sum as sig3 ratios of NAV and wallet through one whitelisted emitter.**

## Performance

- **Duration:** about 45 min (approximate; the start instant was not recorded to the second)
- **Completed:** 2026-11-01
- **Tasks:** 2 (a tracer and an edge-coverage task)
- **Files:** 3 (2 new, 1 additive edit)

## Accomplishments

- `python -m scripts.walletoffset_probe` reads every OKX, Bybit, Binance and sFOX key, finds each key's first stored mark through `read_key_marks`, and for an OKX key prints one record: `pnl_trading_ratio`, `pnl_funding_ratio`, `pnl_ratio`, `flow_ratio`, `offset_ratio`, `offset_over_wallet_ratio`, window counts, `partial`, `shares_account`, then one summary record. Source choice (RESEARCH A1): "fills and trade history" is read as the OKX bills archive, the quantity the chain itself books.
- The OKX walk copies `walk_okx_bills_archive`'s structure (no begin, end, instType or ccy; `after`-paged; stops on a bill older than B). An empty page before that bill is `reach_unproven`, a stalled cursor is `malformed`, the page ceiling is `page_ceiling`, the per-key call ceiling (a counted GET-only view) is `call_ceiling`; none of them prints a partial sum or a 0.
- `failure_token` is the one place a reader exception becomes a closed `(reason, class)`; `Unmeasurable` refuses a reason outside the vocabulary.
- A key with no mark prints `no_mark`; a marked key on a venue with no reader prints `reader_not_built`; neither is decrypted.
- `tests/_okx_bills.py`: `okx_bill(..., pnl=, fee=)`, additive and default-off (ADDITIVE_OK).

## Task Commits

1. **Task 1 RED:** `6f59c7f14` test(184-01): add failing tracer test for the first-mark offset probe (also carries the `_okx_bills.py` helper edit)
2. **Task 1 GREEN:** `2cbb2f421` feat(184-01): read-only first-mark offset probe with the OKX bills reader
3. **Task 2:** `be2e52025` test(184-01): cover the window edges, offset arithmetic, OKX reader and flow term
4. **Refactor:** `aaf6640d0` refactor(184-01): build the key record by dict merge (no behaviour change; see Deviations)

## RED evidence and mutations

**Tracer RED reason (before implementation):** `ModuleNotFoundError: No module named 'scripts.walletoffset_probe'` at collection of `tests/test_walletoffset_probe.py` (the module did not exist). This is the plan's own prescribed RED reason; by the format-based classifier it is a collection/import fault rather than an assertion failure, and is recorded as such. After the module landed, the tracer passed on its first run.

**Task 2 note:** the tests of Task 2 were green on arrival because Task 1's implementation already followed the full spec (the plan puts the whole reader, sums, flow term and `failure_token` in Task 1's action). Their ability to fail is shown by the two mutations below, not by a RED-then-GREEN pair.

mutation W1: RED `tests/test_walletoffset_probe.py::test_window_read_edge_is_inside` and `::test_okx_bills_at_the_window_edges_count_and_one_ms_outside_do_not` (`in_window` upper edge made exclusive); restored (cmp identical); GREEN (11 passed under `-k window`)

mutation W2: RED `tests/test_walletoffset_probe.py::test_okx_a_type_8_usdt_bill_adds_its_pnl_to_funding_only` and `::test_okx_a_type_8_btc_bill_is_counted_and_summed_nowhere` (funding branch removed so type 8 folds into trading); restored (cmp identical); GREEN (55 passed)

Both mutations were made on a byte-backed-up copy (`cp -p`, backup in a scratch dir outside the repo) and restored with `cp -p`, confirmed by `cmp`. No `git checkout`, `git restore` or `git stash` was used.

## Verification results

- Tracer: `pytest tests/test_walletoffset_probe.py -k tracer` passes.
- `pytest tests/test_walletoffset_probe.py`: 55 passed (`-k "window or offset or okx or flows"` collects 55, floor was 20).
- Two walker consumer files: 167 passed. ADDITIVE_OK printed. SCOPE_OK printed.
- Nine-file `_okx_bills.py` consumer run: 615 passed in about 36 s (baseline 615).
- Full suite, from `analytics-service/`: `.venv/bin/pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` gave **14133 passed, 102 skipped, 1171 warnings in 108.39s**, coverage 94.66% (gate 80%). The 102 skips are existing skips elsewhere in the suite; this plan's tests skip nothing. The suite ran concurrently with the final refactor commit; the 55 probe tests were re-run after it and pass.
- CI mypy line, verbatim from `analytics-service/` with the venv's mypy: `Success: no issues found in 131 source files`. Separately `mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/walletoffset_probe.py`: `Success: no issues found in 1 source file`. No ruff, flake8 or black runs on analytics-service in CI or the Makefile (RESEARCH), so none was run.

## Decisions Made

- First mark = `read_key_marks(...)[0]` (smallest `mark_day`); proven by a test with a later mark of a different NAV.
- Labels `k1..kN` follow `created_at` order with no `is_active` filter; a test with the table rows in the wrong order proves each key reads its own mark.
- `read_delay_hours` and `first_mark_day` are printed even when the venue read fails, because the database holds them.

## Deviations from Plan

**1. [Rule 2 - Missing critical] `run()` prints `no_mark` and `reader_not_built` records in this plan**
- **Found during:** Task 1 (run layer)
- **Issue:** the plan says plan 184-02 makes every key that cannot be read print its refusal token, but a `run()` without any branch for a key with no mark, or a marked key on a venue with no reader, would crash or silently skip the key, which the "never invent data, fail loud" rule forbids and which would make the summary counts wrong.
- **Fix:** two minimal branches in `run()` (neither decrypts), each with its own test. Plan 184-02 still owns the other refusals (`key_not_eligible`, retention and recency, the timeout and venue-error arms of `failure_token`).
- **Files modified:** `analytics-service/scripts/walletoffset_probe.py`, `analytics-service/tests/test_walletoffset_probe.py`
- **Commits:** `2cbb2f421`, `be2e52025`

**2. [Rule 1 - Latent conflict with plan 184-02's pins] dict `update` call replaced by a merge**
- **Found during:** final source scan after Task 2
- **Issue:** `_key_record` used `record.update(...)`; plan 184-02 pins that the probe source holds no `.update(` call, which would have fired on a dict method.
- **Fix:** build the record by `{**defaults, ..., **values}`. No behaviour change; 55 probe tests re-run green, both mypy runs clean.
- **Commit:** `aaf6640d0`

**3. [Note] Task 2 tests green on arrival** (see RED evidence above). Not a code deviation.

**Total deviations:** 2 auto-fixed (1 Rule 2, 1 Rule 1). **Impact:** none on scope; no file outside the three planned ones changed.

## Known Stubs

None. `closed_pnl_rows_in_window`, `income_rows_in_window` and `unified_edge_rows_in_window` print `field-absent` for OKX by design (the Bybit and Binance readers are plan 184-03's); that is the declared "not measured" word, not a placeholder.

## Threat Flags

None. No new endpoint, auth path or schema; the script is read-only and outside `services/`.

## Issues Encountered

None.

## Next Phase Readiness

Plan 184-02 can add the key-level refusals before decrypt, the timeout and venue-error arms of `failure_token` (it currently re-raises any exception it does not name), the read-only source pins with their controls, and the planted-needle redaction test. Plan 184-03 adds the Bybit and Binance readers. Founder decisions needed: none from this plan.

## Self-Check: PASSED

- `analytics-service/scripts/walletoffset_probe.py`, `analytics-service/tests/test_walletoffset_probe.py`, `analytics-service/tests/_okx_bills.py`: found.
- Commits `6f59c7f14`, `2cbb2f421`, `be2e52025`, `aaf6640d0`: ancestors of HEAD.
- Acceptance criteria re-run: tracer passes with 0.00075, 6.0, 1, "measured"; ADDITIVE_OK; 167 consumer tests; 55 tests collected for the `-k` filter; `mutation W1:` and `mutation W2:` lines present.
