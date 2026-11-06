---
phase: 179-okxbillschain-the-okx-bills-chain-closes-for-a4-or-the-break
plan: 04
subsystem: analytics-service (OKX bills oracle, chain diagnostic)
tags: [okx, bills-archive, chain_break, close-precision, data-integrity, D-06]

requires:
  - phase: 179-okxbillschain
    provides: plan 03's reading of a4 (chain_arm close, 0 interior breaks, close residual below 1e-12) and the founder's fix choice (D-06)
provides:
  - "The bills oracle proves a currency's chain when its newest bal and today's cashBal agree at the bills' printed precision or within 1e-12 relative; interior links stay exact; a4's reading shape now yields a measured opening through the oracle and an agreed anchor through the forced path"
  - "The chain diagnostic classifies the close with the oracle's own close_agrees, so the next probe reading (plan 179-05) names the arm the oracle fired"
affects: [179-05, 173-rebuildgates]

actuals:
  tokens: 6314
  tasks: 3
  commits: 3
plan_head_before: 571847fa1685b03bdc1b0c899d55067ea1bfb714
plan_head_after: f4750c74d484ca99ac35564b044e7f4350230073

tech-stack:
  added: []
  patterns:
    - "One close predicate (close_agrees) shared by the verdict and the diagnostic"
    - "Precision read from the Decimal exponent of each walked bal as the venue printed it; the chain's most places governs"

key-files:
  created:
    - analytics-service/tests/test_okx_close_precision.py
  modified:
    - analytics-service/services/okx_opening_balance.py
    - analytics-service/services/okx_bills_chain.py

key-decisions:
  - "The close rule is the planner's fail-closed reading of D-06: equal, or within half a unit (inclusive) of the most decimal places any walked bal of that currency prints (only when that is at least one place), or within 1e-12 of the larger balance (inclusive, by multiplication). cashBal's own places never govern."
  - "No new reason token (the six stay), OPENING_TOLERANCE_REL stays 0.05, and the opening is still the oldest bill's bal minus balChg: the cash value never enters it."
  - "ChainReport gained close_places so close_race applies the oracle's close rule to the post-walk read; cash_moved stays an exact comparison."

requirements-completed: [SC-2]

coverage:
  - id: D1
    description: "a4's close shape (every interior link exact, close residual far below 1e-12 relative) proves the opening through the oracle and anchors through the forced path"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_close_precision.py#test_a4s_close_below_one_part_in_a_trillion_proves_the_opening"
        status: pass
      - kind: e2e
        ref: "analytics-service/tests/test_okx_close_precision.py#test_a_forced_okx_rebuild_anchors_when_the_close_agrees_at_okx_precision"
        status: pass
    human_judgment: false
  - id: D2
    description: "A close beyond both bounds still refuses chain_break by name on the forced path (fail closed)"
    requirement: SC-2
    verification:
      - kind: e2e
        ref: "analytics-service/tests/test_okx_close_precision.py#test_a_close_beyond_okx_precision_still_refuses_chain_break_on_the_forced_path"
        status: pass
    human_judgment: false
  - id: D3
    description: "Every edge of the close rule (precision arm, relative arm, ties, trailing zeros, exponent notation, integer prints, chain-most places, cash places never govern) and the exact interior arm"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_close_precision.py#test_the_close_rule_at_its_edges"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_close_precision.py#test_an_interior_residual_of_the_allowed_size_still_breaks_the_chain"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_close_precision.py#test_decimal_places_are_counted_from_the_printed_bal"
        status: pass
    human_judgment: false
  - id: D4
    description: "The decided values are pinned: CLOSE_RESIDUAL_REL_BOUND 1e-12, OPENING_TOLERANCE_REL 0.05, the six reason tokens"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_close_precision.py#test_the_close_bound_and_the_reason_set_are_the_decided_values"
        status: pass
    human_judgment: false
  - id: D5
    description: "The diagnostic classifies the close as the oracle does; an interior-only break reads interior, never both; a post-walk read that agrees at OKX precision counts as a race match"
    requirement: SC-2
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_okx_close_precision.py#test_the_diagnostic_classifies_the_close_exactly_as_the_oracle"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_close_precision.py#test_an_interior_break_beside_a_close_inside_the_allowance_reads_interior_not_both"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_okx_close_precision.py#test_a_close_cleared_at_okx_precision_by_the_post_walk_read_counts_in_matches_after"
        status: pass
    human_judgment: false

duration: about 40min
completed: 2026-10-28
status: complete
---

# Phase 179 Plan 04: Close fix at OKX precision Summary

**The bills oracle now proves a currency's chain when its newest `bal` and today's `cashBal` agree at the bills' own printed decimal places or within 1e-12 relative (D-06), with every interior link still exact, so a4's stable-USDT reading shape measures an opening instead of reading `chain_break`, and the chain diagnostic shares the same close predicate.**

## Performance

- **Duration:** about 40 min
- **Completed:** 2026-10-28
- **Tasks:** 3 of 3
- **Files:** 1 created, 2 modified (the plan's `files_modified`); `scripts/` and the five existing test files the plan names are byte-identical to `plan_head_before`

## Accomplishments

- Task 1 (tracer): `CLOSE_RESIDUAL_REL_BOUND`, `bal_places` and `close_agrees` in `services/okx_opening_balance.py`; `per_ccy_opening`'s close arm goes through `close_agrees(newest bal, cash, bal_places(currency's walked bills))`, its interior comparison is untouched. a4's shape reads `none` with the test's own 60000 opening through the oracle and `agreed` through `_fetch_and_price_window`; a 1e-7 residual still refuses `chain_break`.
- Task 2: 27 parametrized pins for the precision source (8 print shapes), the close rule at its edges (16 worlds), the exact interior arm (2 worlds) and the decided values. Eleven mutations (M1 to M11) each turn a named pin RED.
- Task 3: `analyse_chain` and `close_race` classify the close with `obal.close_agrees`; `ChainReport.close_places` carries each currency's governing places. Existing chain, record and probe tests pass unchanged.

## Task 1 RED reason

Seen on the unmodified oracle, before any implementation (the world reproduces a4's shape):

- `test_a4s_close_below_one_part_in_a_trillion_proves_the_opening`: `assert 'chain_break' == 'none'` (`OkxOpeningReading(opening_usd=None, unavailable_reason='chain_break', bills_read=2, ...)`).
- `test_a_forced_okx_rebuild_anchors_when_the_close_agrees_at_okx_precision`: `services.equity_reconstruction.ForcedRebuildRefusedError: forced rebuild refused (anchor_skipped_implausible)`, with the log line `OKX opening check unavailable (chain_break)`.
- `test_a_close_beyond_okx_precision_still_refuses_chain_break_on_the_forced_path` passed before and after, as specified.

## Task 3 RED reason

Seen on the unmodified `services/okx_bills_chain.py`, before the diagnostic change (9 failed, 39 passed):

- `test_the_diagnostic_classifies_the_close_exactly_as_the_oracle`: `assert ('USDT' in frozenset({'USDT'})) is False` on 7 worlds (`precision-arm-only`, `precision-arm-tie`, `relative-arm-only-cash-coarser`, `relative-arm-exact-bound`, `trailing-zeros-inside`, `exponent-notation-inside`, `a4-shape`).
- `test_an_interior_break_beside_a_close_inside_the_allowance_reads_interior_not_both`: `assert 'both' == 'interior'`.
- `test_a_close_cleared_at_okx_precision_by_the_post_walk_read_counts_in_matches_after`: `assert 0 == 1` (`matches_after`).

## Mutation record

Each mutation: byte backup of the file outside the repo, neuter, run `tests/test_okx_close_precision.py`, copy the backup back, `cmp` identical, run again green (30 passed after M1 to M11, 48 passed after M12 and M13). The backup directory was removed afterwards and confirmed absent.

- mutation M1: RED test_a4s_close_below_one_part_in_a_trillion_proves_the_opening and test_a_forced_okx_rebuild_anchors_when_the_close_agrees_at_okx_precision (close_agrees made exact equality only); restored (cmp identical); GREEN
- mutation M2: RED test_decimal_places_are_counted_from_the_printed_bal[trailing-zeros-count] and test_the_close_rule_at_its_edges[trailing-zeros-count] (bal_places counts after normalize(); also sixteen-places, the-chains-most-governs, precision-arm-just-over); restored (cmp identical); GREEN
- mutation M3: RED test_the_close_rule_at_its_edges[cash-places-never-govern] (precision arm uses cash's places; also precision-arm-only, precision-arm-tie, trailing-zeros-inside, exponent-notation-inside); restored (cmp identical); GREEN
- mutation M4: RED test_the_close_rule_at_its_edges[relative-arm-only-cash-coarser] and test_the_close_rule_at_its_edges[relative-arm-exact-bound] (relative arm removed); restored (cmp identical); GREEN
- mutation M5: RED test_the_close_rule_at_its_edges[precision-arm-only] (precision arm removed; also precision-arm-tie, trailing-zeros-inside, exponent-notation-inside); restored (cmp identical); GREEN
- mutation M6: RED test_an_interior_residual_of_the_allowed_size_still_breaks_the_chain[interior-below-relative-bound] and test_an_interior_residual_of_the_allowed_size_still_breaks_the_chain[interior-below-half-a-print-unit] (interior link also passes through close_agrees); restored (cmp identical); GREEN
- mutation M7: RED test_decimal_places_are_counted_from_the_printed_bal[positive-exponent-prints-zero] (bal_places stops clamping a non-negative exponent to 0); restored (cmp identical); GREEN
- mutation M8: RED test_the_close_rule_at_its_edges[integer-print-no-allowance] (no-decimal-place guard removed; also positive-exponent-no-allowance); restored (cmp identical); GREEN
- mutation M9: RED test_the_close_rule_at_its_edges[stripped-print-chain-governs] (bal_places reads the newest bill only); restored (cmp identical); GREEN
- mutation M10: RED test_the_close_rule_at_its_edges[relative-arm-exact-bound] (relative bound made exclusive); restored (cmp identical); GREEN
- mutation M11: RED test_the_close_rule_at_its_edges[precision-arm-tie] (half-unit bound made exclusive); restored (cmp identical); GREEN
- mutation M12: RED test_the_diagnostic_classifies_the_close_exactly_as_the_oracle (7 worlds) and test_an_interior_break_beside_a_close_inside_the_allowance_reads_interior_not_both (analyse_chain's close back on exact inequality); restored (cmp identical); GREEN
- mutation M13: RED test_a_close_cleared_at_okx_precision_by_the_post_walk_read_counts_in_matches_after (close_race back on exact equality); restored (cmp identical); GREEN

## Verification

- TRACER_OK, PINS_OK and DIAG_AGREES_OK printed.
- CI's mypy line from `analytics-service/`: `Success: no issues found in 130 source files`.
- The seven related test files (close precision, opening balance, anchor rule, bills chain, chain record, allocator history probe, force rebuild): 505 passed, 1 warning.
- Full analytics suite run once from `analytics-service/` with coverage (`--cov=services --cov=routers --cov=main_worker --cov-fail-under=80`, serial because `pytest-xdist` is not installed in this local environment): 13793 passed, 102 skipped, 1 failed, total coverage 94.57% (threshold 80% reached). The one failure, `tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`, is `ModuleNotFoundError: No module named 'xdist'`: it needs the plugin CI installs and is unrelated to this plan (it touches no changed module).

## Deviations from Plan

None - plan executed exactly as written. Notes that are not deviations:

- The macOS `sed -i` needs an empty suffix argument; one cleanup of unused imports in the new test file failed once and was re-run correctly. No file content was affected.
- Task 2's pins passed on first run, as the plan expected, and each was proven able to fail by a mutation. Mutations M2, M3 and M5 also turned several neighbouring worlds RED beyond the one the plan named; that is stricter than required, not looser.

## Auth gates

None.

## Known Stubs

None.

## Threat Flags

None. The change tightens nothing in network surface; it adds a bounded allowance inside an existing comparison, with the threat register's mitigations (T-179-17 to T-179-20) covered by the pins and mutations above.

## Self-Check: PASSED

- Files: `analytics-service/tests/test_okx_close_precision.py`, `analytics-service/services/okx_opening_balance.py` and `analytics-service/services/okx_bills_chain.py` exist; `scripts/` and the five existing test files are byte-identical to `plan_head_before` (empty `git diff --stat`).
- Commits ce4139f28, 82400fa0e and f4750c74d are ancestors of HEAD.
- The byte-backup directory is absent.
