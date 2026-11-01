---
phase: 184-walletoffset-the-first-mark-offset-on-wallet-base-venues-is
plan: 03
subsystem: analytics-service
tags: [probe, bybit, binance, sfox, closed-pnl, futures-income, parity, fingerprint, read-only]

requires:
  - phase: 184-01
    provides: the probe with the OKX reader, failure_token, Unmeasurable, the whitelist emitter, the fakes
  - phase: 184-02
    provides: pre-decrypt refusals, retention and recency tables, the read-only pins and the redaction proof
provides:
  - the Bybit reader (closed P&L ex-funding by the chain's own formula, SETTLEMENT funding, the Unified-edge count, the flow term)
  - the Binance reader (one futures-income read for the window, the chain's split, the flow term)
  - sFOX recorded as reader_not_built with its reason (no realized-P&L chain)
  - deploy_fingerprint(), the line plan 184-04 compares against the worker's own print
affects: [184-04, 184-05]

actuals:
  tokens: 17300
  tasks: 3
  commits: 5
plan_head_before: ad0480b9c89bfd541e3ac714d8f74a0e3b698a43
plan_head_after: 17ba483fb9c69d338d330e4154cab009b08602fb

tech-stack:
  added: []
  patterns:
    - "a venue reader takes (client, supabase, mark, read_at, label); only a venue whose chain books a realized P&L is registered"
    - "a formula copied out of an inline chain loop ships with a parity test that drives the real chain function"
    - "a deploy fingerprint built from the live constants, never a literal"

key-files:
  created: []
  modified:
    - analytics-service/scripts/walletoffset_probe.py
    - analytics-service/tests/test_walletoffset_probe.py

key-decisions:
  - "sFOX stays out of the venue registry: combine_sfox_balance_history chain-links the venue's own daily usd_value series and books no realized P&L, so the window offset has no chain definition there. A marked sFOX key prints reader_not_built with no decrypt; plan 184-05 puts the definition to the founder (RESEARCH A7 is missing information, not a difficulty judgement)."
  - "The Bybit closed-pnl read stops where fetch_daily_pnl stops (empty page, or a cursor that is empty or repeated); a repeated cursor therefore ends the read rather than refusing it. The probe measures the chain's quantity, and the chain stops there."
  - "The Binance chain sums REALIZED_PNL and COMMISSION income whatever the asset; the probe sums stablecoin assets only and counts the rest in non_stable_rows (partial), per CONTEXT 'never invent data'. A row with no asset is treated as non-stable."
  - "The key label is threaded to every reader (signature gained a label argument, OKX included, unused there) so fetch_funding_bybit logs the label k3 and never an id."

requirements-completed: [SC-1, SC-3]

coverage:
  - id: D1
    description: "A marked Bybit key's first-mark offset is measured end to end with the chain's own closed-pnl formula, SETTLEMENT funding, the Unified-edge diagnostic and the flow term"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "tests/test_walletoffset_probe.py#test_bybit_first_mark_offset_end_to_end"
        status: pass
      - kind: unit
        ref: "tests/test_walletoffset_probe.py#test_bybit_parity_with_fetch_daily_pnl"
        status: pass
    human_judgment: false
  - id: D2
    description: "A marked Binance key is measured from one futures-income read; a 1000-row reply is page_ceiling, never a partial sum"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "tests/test_walletoffset_probe.py#test_binance_first_mark_offset_end_to_end"
        status: pass
      - kind: unit
        ref: "tests/test_walletoffset_probe.py#test_binance_a_reply_of_the_one_thousand_row_maximum_is_page_ceiling_never_a_partial_sum"
        status: pass
    human_judgment: false
  - id: D3
    description: "A marked sFOX key refuses by name before any decrypt; the summary states each venue; the fingerprint line is pinned"
    requirement: SC-1
    verification:
      - kind: unit
        ref: "tests/test_walletoffset_probe.py -k 'sfox or summary or fingerprint' (10 passed)"
        status: pass
    human_judgment: false
  - id: D4
    description: "No published number changes: the phase's code diff touches only the script, its test file and tests/_okx_bills.py; the full suite and CI's mypy line are green"
    requirement: SC-3
    verification:
      - kind: other
        ref: "SCOPE_OK gate; CI mypy line; full analytics-service pytest 14249 passed, 102 skipped"
        status: pass
    human_judgment: false

duration: ~17min
completed: 2026-11-01
status: complete
---

# Phase 184 Plan 03: Bybit and Binance readers, sFOX refusal, deploy fingerprint Summary

**The probe now measures a marked Bybit key (closed P&L by the chain's own side rule, proven equal to `fetch_daily_pnl` on one row set, plus SETTLEMENT funding, the Unified-edge count and the shared flow term) and a marked Binance key (one futures-income read with the chain's split), refuses a marked sFOX key by name because its chain books no realized P&L, and prints a fingerprint line the worker run can check.**

deploy-fingerprint: walletoffset 0 1 27 30 14 binance,bybit,okx

Plan 184-04 recomputes it at the deployed commit with `cd analytics-service && .venv/bin/python -c 'import scripts.walletoffset_probe as w; print(w.deploy_fingerprint())'` and compares it with what the worker prints for `python -c 'import scripts.walletoffset_probe as w; print(w.deploy_fingerprint())'`. Fields: exit codes 0 and 1, the sizes 27 (KEY_RECORD_KEYS), 30 (SUMMARY_RECORD_KEYS) and 14 (UNMEASURABLE_REASONS) exactly as plans 184-01 and 184-02 shipped them (no deviation in the vocabulary sizes), then the sorted venues that have a reader.

## Performance

- **Duration:** about 17 min (2026-11-01T14:34Z to 14:51Z)
- **Tasks:** 3 (two TDD feature tasks and the mutation task)
- **Files modified:** 2 (the script and its test file)

## Accomplishments

- **Bybit.** `bybit_closed_pnl_rows` reads ONE closed-pnl window [B, R] (`category` linear, `limit` "100", string times, always inside 7 days), pages by `nextPageCursor` with the chain's stop rule, raises `page_ceiling` at 50 pages with a cursor still pending, `malformed` on an unreadable reply or an unparsable `createdTime`, dedupes on `(symbol, createdTime)` and drops rows outside [B, R] even when the venue serves them. `bybit_closed_pnl_terms` is the chain's row formula verbatim. `_measure_bybit` wraps the client in `BudgetedExchange` for every `private_get_` call, takes `fetch_funding_bybit` rows in [B, R] (stablecoin currencies summed, others counted in `non_stable_rows`, partial), counts `fetch_bybit_unified_flows` rows in [B, R] as `unified_edge_rows_in_window` (a diagnostic, summed nowhere) and adds the shared flow term. A failed SETTLEMENT or Unified read prints `read_failed` with its class.
- **Hand-worked end-to-end world.** NAV 10000, open P&L 1000: trading 10.8 - 5.5 = 5.3, funding -0.3 + 0.1 = -0.2 (the BTC row excluded), ratios 0.00053, -0.00002, 0.00051, 0.00051, over the wallet 0.000567, read delay 5.5 h, closed rows 2, funding rows 3, non-stable 1, Unified edge rows 2.
- **Parity.** `test_bybit_parity_with_fetch_daily_pnl` drives the real `services.exchange.fetch_daily_pnl` on a fake exchange and the probe's `bybit_closed_pnl_terms` on the same four rows (both sides, non-zero fees, four symbols) and compares the day total within 1e-9 relative, plus the hand literal 12.8.
- **Binance.** `binance_income_terms` and `_measure_binance`: one `fapiPrivate_get_income` call with `startTime` B, `endTime` R, `limit` 1000; REALIZED_PNL and COMMISSION as trading, FUNDING_FEE as funding, every other type counted only; a reply of 1000 rows is `page_ceiling`; a non-list reply, a non-object row, an unparsable `time` or a summed row whose `income` is not finite is `malformed`. End-to-end literals 0.0024, -0.0002, 0.0022 with `income_rows_in_window` 5, partial true.
- **sFOX.** Not in the registry; the docstring says why. `test_sfox_marked_key_is_reader_not_built_before_any_decrypt` asserts `reader_not_built`, no decrypt and no client.
- **Summary across venues.** A mixed world (two OKX keys, one Bybit, one marked sFOX, no Binance) gives keys_marked 4, keys_measured 3, keys_unmeasurable 1, `okx_state` measured, `bybit_state` measured, `binance_state` no_keys, `sfox_state` unmeasured, `okx_max_abs_pnl_ratio` 0.0015 (the larger key), exit 1; a venue whose only key has no mark is `no_marked_keys`; a venue with one measured and one failed key is `partly_measured`.
- **Fingerprint.** `deploy_fingerprint()` built from the live constants; one test pins the literal, one proves it follows the constants (a registered sFOX reader and a 15th reason each change it).

## Task Commits

1. **Task 1 RED:** `1a001c79f` test(184-03): add failing tests for the Bybit reader and the closed-pnl parity proof (also retargets the plan-01 no-reader test)
2. **Task 1 GREEN:** `ba374be7f` feat(184-03): read a marked Bybit key's first-mark offset with the chain's own closed-pnl formula
3. **Task 2 RED:** `6ba7bd054` test(184-03): add failing tests for the Binance reader, the mixed-venue summary and the deploy fingerprint
4. **Task 2 GREEN:** `5432b0209` feat(184-03): read a marked Binance key from futures income and fingerprint the deployed probe
5. **Task 3:** `17ba483fb` test(184-03): pin that a flow after the read is never valued, so an unpriced one cannot fail the window

## RED evidence

**Task 1 RED (before the Bybit reader):** all 39 tests selected by `-k bybit` failed, each on the planned behavior: a marked Bybit key printed `reader_not_built` instead of a measured record (exit 1 where the test expects `EXIT_OK`, `reader_not_built` where it expects `read_failed` or `malformed`), and `wp.bybit_closed_pnl_terms`, `wp.BYBIT_CLOSED_PNL_PAGE_CEILING` did not exist (AttributeError). The two other changed tests (the retargeted sFOX protection) passed before and after.

**Task 2 RED (before the Binance reader and the fingerprint):** 23 of the 30 tests selected by `-k "binance or sfox or summary or fingerprint"` failed (every Binance test on `reader_not_built` or a missing `wp.binance_income_terms`, both fingerprint tests on `AttributeError: deploy_fingerprint`). 7 passed on arrival: the sFOX refusals and the summary tests, because the summary arithmetic is generic and sFOX already had no reader; their ability to fail is shown by the mutations below and by plan 184-02's.

`gsd_run check tdd-red-evidence` does not support pytest's report format, as in plans 184-01 and 184-02; the semantic assessment above is the RED record.

## Mutations (gates shown able to fail)

Each mutation was made on a byte-backed-up copy (`cp -p` into a `mktemp -d` scratch directory outside the repo), restored with `cp -p`, confirmed with `cmp`, and the tests re-run GREEN. No `git checkout`, `git restore` or `git stash` was used.

mutation B1: RED tests/test_walletoffset_probe.py::test_bybit_parity_with_fetch_daily_pnl (the two arms of the side rule in bybit_closed_pnl_terms swapped); restored (cmp identical); GREEN
mutation B2: RED tests/test_walletoffset_probe.py::test_bybit_first_mark_offset_end_to_end plus five more bybit tests incl. test_bybit_parity_with_fetch_daily_pnl (the openFee term dropped from the row formula); restored (cmp identical); GREEN
mutation B3: RED tests/test_walletoffset_probe.py::test_binance_first_mark_offset_end_to_end plus three more binance tests (FUNDING_FEE income summed as trading); restored (cmp identical); GREEN
mutation B4: RED tests/test_walletoffset_probe.py::test_flows_rows_one_second_outside_the_window_add_nothing (placed_flow_instants skipped AND the in-window prefilter removed together); restored (cmp identical); GREEN

B4 needed two layers removed. As the plan anticipated, skipping `placed_flow_instants` alone stayed GREEN (mutation B4a: 9 flow tests passed), and so did dropping only the prefilter's upper edge (mutation B4b: 9 passed), because the prefilter and the placement rule each enforce [B, R] on their own. That redundancy is deliberate, but it left the prefilter's purpose (an unpriced non-stable flow made after R must not fail valuation) unpinned. Task 3 therefore added `test_flows_an_unpriced_non_stable_deposit_after_the_read_cannot_fail_the_window` and:

mutation B4d: RED tests/test_walletoffset_probe.py::test_flows_an_unpriced_non_stable_deposit_after_the_read_cannot_fail_the_window (the prefilter's upper edge dropped); restored (cmp identical); GREEN

The deployed-probe fingerprint check:

mutation F1: RED tests/test_walletoffset_probe.py::test_deploy_fingerprint_names_the_shipped_shape and ::test_deploy_fingerprint_follows_the_live_constants_it_names (the venue list truncated to two entries, so the command printed `... binance,bybit`); restored (cmp identical); GREEN

The SUMMARY_OK gate was also shown able to fail: run against a scratch copy of this file whose fingerprint line was changed, it printed no SUMMARY_OK line.

## Verification results

- New test file, `analytics-service/`: `pytest tests/test_walletoffset_probe.py` gives 171 passed (105 from plans 01 and 02, 66 new here).
- **Full suite**, `analytics-service/`, `.venv/bin/pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`: **14249 passed, 102 skipped, 1171 warnings in 210.15s (0:03:30)**, `Required test coverage of 80% reached. Total coverage: 94.66%`. 14249 is 14183 from plan 184-02 plus the 66 tests of this plan; the 102 skips are existing skips elsewhere, this plan's tests skip nothing; 0 failed.
- **CI mypy line**, verbatim from `analytics-service/` with the venv's mypy (`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): `Success: no issues found in 131 source files`. Separately `mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/walletoffset_probe.py`: `Success: no issues found in 1 source file`.
- SCOPE_OK printed: the phase's diff under `analytics-service/`, `supabase/` and `src/` is the script, its test file and `tests/_okx_bills.py` only.
- The fingerprint command prints exactly `walletoffset 0 1 27 30 14 binance,bybit,okx`.

## Decisions Made

See `key-decisions` above.

## Deviations from Plan

**1. [Note] The retargeted plan-01 test.** Plan 02 flagged that `test_okx_a_marked_key_on_a_venue_without_a_reader_is_never_decrypted` used a Bybit key and would stop being true once Bybit has a reader. It was retargeted to an sFOX key (same assertions: `reader_not_built`, no decrypt, no client, `sfox_state` unmeasured) and renamed `test_sfox_marked_key_is_reader_not_built_before_any_decrypt`, the name this plan prescribes, so the protection was kept rather than deleted. It sits beside plan 02's `test_unmeasurable_sfox_key_has_no_reader_and_is_never_decrypted`, which is a near-duplicate left untouched (surgical scope).

**2. [Note] Reader signature gained a `label` argument.** The plan says the key's label is passed to `fetch_funding_bybit`, but the readers received no label. `_read_one_key` and every reader (`_measure_okx` included, where it is unused) now take it; no test called them directly. Commits `ba374be7f`.

**3. [Note] B4 is a two-layer mutation.** See the mutation section; the plan allowed mutating the prefilter's upper edge instead, but that stays GREEN too, so the RED line is the combined mutation and a new test (`...cannot_fail_the_window`, commit `17ba483fb`) now pins the prefilter on its own. Not a code deviation.

**4. [Note] Tests 7 of 30 green on arrival in Task 2** (see RED evidence).

**Total deviations:** 0 auto-fixed, 4 notes. **Impact:** none on scope.

## Known Stubs

None. The `bills_in_window`, `transfer_bills_in_window`, `spot_bills_in_window` and `other_inst_bills_in_window` fields print `field-absent` for Bybit and Binance, `closed_pnl_rows_in_window` and `unified_edge_rows_in_window` for every venue but Bybit, and `income_rows_in_window` for every venue but Binance; that is the declared "not measured" word, not a placeholder.

## Threat Flags

None. No new endpoint, auth path or schema; the script stays read-only and outside `services/`. T-184-07 (every Bybit GET through the counted view, the one Binance income GET by exact name, the plan-02 source pins), T-184-08 (page_ceiling, malformed, read_failed; never a partial sum or 0), T-184-09 (parity test plus mutations B1 to B4), T-184-10 (the unchanged whitelist emitter; a planted venue message is asserted absent for the Bybit and Binance read failures) and T-184-11 (the pinned fingerprint, mutation F1) are mitigated.

## Issues Encountered

None blocking. Two things a reviewer should see:

- **A repeated closed-pnl cursor ends the Bybit read without a token.** That is the chain's own rule (`next_cursor == cursor`), so the probe's quantity equals what the chain books, but it cannot tell a venue that echoes the last cursor from one that is stuck. With a window under a day the closed-pnl reply is far below one 100-row page, so the case should not arise; if the founder wants the stricter reading it is a one-line change to `malformed`.
- **The Bybit SETTLEMENT read walks from B to the present**, not to R, because `fetch_funding_bybit` takes no end bound. The rows after R are filtered out, and the walk is a handful of 7-day windows under the per-key call ceiling of 600.

## User Setup Required

None.

## Next Phase Readiness

Ready for review and ship of plans 184-01 to 184-03 as one code PR; plan 184-04 runs only after Railway deploys that merge and must compare the worker's fingerprint line with `deploy-fingerprint:` above. Founder decisions needed from this plan: how the sFOX offset should be defined (its chain books no realized P&L), to be asked in plan 184-05 only if a marked sFOX key exists at run time.

## Self-Check: PASSED

- `analytics-service/scripts/walletoffset_probe.py` and `analytics-service/tests/test_walletoffset_probe.py`: found.
- Commits `1a001c79f`, `ba374be7f`, `6ba7bd054`, `5432b0209`, `17ba483fb`: ancestors of HEAD; `test(184-03)` precedes `feat(184-03)` for both feature tasks.
- `deploy-fingerprint:` line equals the module's own output; `mutation B1:` to `mutation B4:` lines present and end `restored (cmp identical); GREEN`; CHANGELOG, VERSION, package.json, STATE.md and ROADMAP.md untouched.
