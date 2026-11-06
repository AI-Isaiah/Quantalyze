---
phase: 168-drboptions-a-deribit-options-account-can-be-ingested-end-to
plan: 02
subsystem: analytics-service (Deribit ingestion classifier)
tags: [deribit, options, assignment, ledger, mark_to_market, smoothed_mtm, python]

requires:
  - phase: 168-01
    provides: "`assignment` in CASH_BEARING_TYPES, _OPTION_EXPIRY_TYPES / _OPTION_BOOK_EVENT_TYPES at the six literal sites, assert_assignment_uncontested, the windowed-crawl backstop"
provides:
  - "one test per option-book site (six in the classifier, one in the acceptance script), each seen RED under a revert of that site alone"
  - "mark_to_market end to end (build_deribit_native_ledger + combine_native_ledger) and smoothed_mtm end to end with an assignment"
  - "check_perp_only_eligibility counts option rows by _OPTION_BOOK_EVENT_TYPES"
  - "_SIBLING_TYPES + assignment; _SHAPE_FIELDS + commission, position"
  - "every prose description of the option book names assignment or _OPTION_BOOK_EVENT_TYPES; dated CORRECTED note on the 2026-09-12 block"
affects: [168-03, deribit ingestion, stitch_composite, derive_broker_dailies]

actuals:
  tokens: 12599
  tasks: 2
  commits: 5
plan_head_before: d448599c5c37885d7fefd3e548f3520df1e5973d

tech-stack:
  added: []
  patterns:
    - "Per-site pin: each reader of a shared vocabulary constant gets its own test, proven by reverting that one site to the old literal"
    - "Calibration half in a pass test: the same fixture minus the row under test must breach, so the pass is not vacuous"

key-files:
  created: []
  modified:
    - analytics-service/tests/test_deribit_assignment.py
    - analytics-service/tests/test_deribit_acceptance.py
    - analytics-service/tests/test_deribit_unclassified_evidence.py
    - analytics-service/tests/test_smoothed_mtm_core.py
    - analytics-service/tests/test_deribit_txn.py
    - analytics-service/scripts/deribit_acceptance.py
    - analytics-service/services/deribit_txn.py
    - analytics-service/services/deribit_ingest.py
    - analytics-service/docs/deribit-ingestion-design.md

key-decisions:
  - "`assignment` is appended LAST to _SIBLING_TYPES, so the existing delivery/settlement/trade census rendering order is unchanged"
  - "_SHAPE_FIELDS gains only commission and position (a fee and a signed size, no identifier); the whitelist renderer is unchanged"
  - "The Phase-82 section comment in tests/test_deribit_txn.py that describes PRE-FIX code as summing option trade/delivery premium is kept verbatim as lineage"

patterns-established:
  - "One test per vocabulary-reading site, each named test_site<N>_*"

requirements-completed: [DERIBIT-ASSIGNMENT-UNCLASSIFIED]

coverage:
  - id: D1
    description: "Each of the six classifier option-book sites treats assignment like delivery, and reverting any one site to the old trade/delivery pair turns a named test red"
    requirement: DERIBIT-ASSIGNMENT-UNCLASSIFIED
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_deribit_assignment.py (test_site1_* .. test_site6_*, 12 cases)"
        status: pass
    human_judgment: false
  - id: D2
    description: "An assignment inside mark_to_market coverage contributes minus its commission end to end through build_deribit_native_ledger; the balance identity closes and combine_native_ledger returns"
    requirement: DERIBIT-ASSIGNMENT-UNCLASSIFIED
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_deribit_assignment.py#test_site5_mtm_e2e_assignment_through_the_native_ledger"
        status: pass
    human_judgment: false
  - id: D3
    description: "A short put opened by a trade and closed by an assignment ingests under smoothed_mtm with the per-day map hand-computed (book zeroed on the assignment day)"
    requirement: DERIBIT-ASSIGNMENT-UNCLASSIFIED
    verification:
      - kind: integration
        ref: "analytics-service/tests/test_deribit_assignment.py#test_smoothed_e2e_short_put_assigned_ingests_flat"
        status: pass
    human_judgment: false
  - id: D4
    description: "The acceptance script's byte-identity eligibility check treats a key whose only option-book event is an assignment as ineligible"
    requirement: DERIBIT-ASSIGNMENT-UNCLASSIFIED
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_deribit_acceptance.py#test_site7_acceptance_eligibility_counts_a_lone_assignment"
        status: pass
    human_judgment: false
  - id: D5
    description: "The unknown-type refusal reports a same-instrument assignment sibling and the row's commission and position"
    requirement: DERIBIT-ASSIGNMENT-UNCLASSIFIED
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_deribit_unclassified_evidence.py#test_the_census_reports_a_same_instrument_assignment"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_deribit_unclassified_evidence.py#test_the_shape_reports_commission_and_position"
        status: pass
    human_judgment: false
  - id: D6
    description: "Code comments, test prose and the design doc describe the option book as trade, delivery and assignment"
    requirement: DERIBIT-ASSIGNMENT-UNCLASSIFIED
    verification:
      - kind: other
        ref: "grep 'trade/delivery' over deribit_txn.py, deribit_ingest.py, test_smoothed_mtm_core.py, test_deribit_txn.py | grep -vc assignment → 0; design doc grep -F pair | grep -vc assignment → 0"
        status: pass
    human_judgment: false

duration: 21min
completed: 2026-09-26
status: complete
---

# Phase 168 Plan 02: per-site assignment pins, acceptance eligibility, refusal evidence and prose Summary

**Every place that reads the Deribit option book now has its own test proving `assignment` is treated like `delivery`: six classifier sites and the acceptance script's eligibility check. Reverting any one site to the old `trade`/`delivery` pair turns a named test red. Mark-to-market and smoothed-MTM each run end to end with an assignment. The unknown-type refusal now reports an assignment sibling and the row's commission and position. Every prose description of the option book names assignment.**

## Performance

- **Duration:** about 21 min
- **Started:** 2026-09-26T10:32:36Z
- **Completed:** 2026-09-26T10:53:17Z
- **Tasks:** 2 (both TDD)
- **Files modified:** 9

## Accomplishments

- **Per-site pins (D-07, D-04, D-05).** `tests/test_deribit_assignment.py` gains `test_site1_*` through `test_site6_*`:
  - `_pre_coverage_option_days` flags an assignment day that falls before coverage.
  - `_option_activity_after_coverage` marks the currency of a trailing assignment.
  - `_assert_smoothed_summary_cross_check` includes the assignment. Its calibration half shows that the same summary without the assignment breaches.
  - `replay_option_positions` replays a -1 opening trade and then an assignment as positions -1 then 0. A missing, None or blank position refuses.
  - Under mark_to_market, an assignment inside coverage contributes minus its commission, and one outside coverage contributes its full change. A missing commission refuses.
  - The non-derivative guard refuses an assignment that names a non-blank spot pair or an unclassifiable instrument. The message names the row by type and id only, and does not contain `_ASSIGNMENT_UNNAMED_PHRASE`.
- **Mark-to-market end to end.** `test_site5_mtm_e2e_assignment_through_the_native_ledger` runs a covered BTC account through the real `build_deribit_native_ledger`. The assignment is a copy of `_btc_option_trade` with its type set to assignment. That day's native P&L is minus its commission, the balance identity closes, and `combine_native_ledger` returns a Series. The summary rows share the option instrument, which also proves the D-02 guard contests only `delivery` and `settlement`.
- **Smoothed-MTM end to end.** `test_smoothed_e2e_short_put_assigned_ingests_flat` asserts the hand-computed day map. The book is marked on each held day and is zero from the assignment day on. The sum equals the cash sum.
- **Seventh literal site.** `scripts/deribit_acceptance.py` `check_perp_only_eligibility` now counts option rows by membership in `_OPTION_BOOK_EVENT_TYPES`. Its docstring and both detail strings name assignment, and the passing detail keeps its `0 option` prefix. `test_site7_acceptance_eligibility_counts_a_lone_assignment` is new. The existing count-detail assertion now uses the new wording.
- **Refusal evidence.** `_SIBLING_TYPES` appends `assignment`, and `_SHAPE_FIELDS` adds `commission` and `position`. A dated `CORRECTED 2026-09-26 (Phase 168)` note sits above `_SHAPE_FIELDS`. The 2026-09-12 block stays as lineage.
- **Prose sweep.** The following now name assignment, or `_OPTION_BOOK_EVENT_TYPES` / `_OPTION_EXPIRY_TYPES`, and say that an expiry event is fee-only inside mark_to_market coverage:
  - in `deribit_txn.py`: the module docstring, the note above `_NATIVE_OPTIONS_SUMMARY_TYPES`, the cash_settlement basis comment, four docstrings, and the option comments in `txn_rows_to_native_daily`;
  - the WR-05 comment in `deribit_ingest.py`;
  - test prose in `test_smoothed_mtm_core.py` and `test_deribit_txn.py`;
  - in the design doc: the INCLUDE list, with the census licence, D-02 and D-03, and a note that `exercise` and `expiry` stay refused; plus every basis paragraph.

## Task Commits

1. **Task 1: each of the seven option-book sites treats assignment like delivery, and each is seen failing on its own**
   - RED: `245a95666` (test)
   - GREEN: `20ccfc784` (feat, the site-7 swap)
2. **Task 2: refusal evidence reports assignment siblings and fee/size fields; every prose description names assignment**
   - RED: `3615d55e2` (test)
   - GREEN: `6064fe15e` (feat)
   - Prose: `23b470cf9` (docs, no behaviour change)

**Plan metadata:** this SUMMARY's docs commit.

## Files Created/Modified

- `analytics-service/tests/test_deribit_assignment.py`: 15 new cases (the site tests, both missing-field matrices, and the two end-to-end tests) plus a module-docstring bullet.
- `analytics-service/tests/test_deribit_acceptance.py`: the new SITE7 test, the count-detail assertion on the new wording, and the info-item-2 docstring fix ("no option trade/delivery/assignment").
- `analytics-service/tests/test_deribit_unclassified_evidence.py`: SIBLING-REPORTS-ASSIGNMENT and SHAPE-REPORTS-FEE-AND-POSITION.
- `analytics-service/scripts/deribit_acceptance.py`: the eligibility check reads `_OPTION_BOOK_EVENT_TYPES`.
- `analytics-service/services/deribit_txn.py`: the `_SIBLING_TYPES`/`_SHAPE_FIELDS` decisions, the CORRECTED note, and prose.
- `analytics-service/services/deribit_ingest.py`: the WR-05 comment (prose only).
- `analytics-service/docs/deribit-ingestion-design.md`: the type allow-list and the basis paragraphs.
- `analytics-service/tests/test_smoothed_mtm_core.py` and `analytics-service/tests/test_deribit_txn.py`: prose only, with no assertion change.

## Acceptance evidence (commands and actual output)

Task 1:
- `grep -ciE 'site1|site2|site3|site4|site5|site6|smoothed_e2e|mtm_e2e' tests/test_deribit_assignment.py` gives **20**, against a requirement of at least 8. Info item 3 asks for a count that docstrings and comments cannot inflate. Counting only definitions, `grep -cE '^(async )?def test_.*(site[1-6]|smoothed_e2e|mtm_e2e)'` gives **10**.
- `grep -ci 'site7\|acceptance_eligibility' tests/test_deribit_acceptance.py` gives **2** (at least 1 required). Counting only definitions gives **1**.
- `grep -c '("trade", "delivery")' scripts/deribit_acceptance.py` gives **0**. `grep -c '_OPTION_BOOK_EVENT_TYPES' scripts/deribit_acceptance.py` gives **4** (at least 2 required: the import, the use and two docstring mentions).
- The slash-joined pair appears on 3 lines of the script, the docstring line and the two detail strings. I read each one, and each names assignment.

Task 2:
- `grep 'trade/delivery' services/deribit_txn.py services/deribit_ingest.py tests/test_smoothed_mtm_core.py tests/test_deribit_txn.py | grep -vc assignment` gives **0**.
- That grep cannot see the backtick spellings (the doubled-backtick and single-backtick forms of the pair). Searching for those in the same four files and dropping lines that name assignment gives **2** hits:
  - (a) `replay_option_positions`'s docstring. The pair wraps across two lines there, and the next line names `assignment`.
  - (b) The Phase-82 section comment in `tests/test_deribit_txn.py`. It describes the PRE-FIX code, and I kept it as lineage (see Decisions).
- `grep -n 'CORRECTED 2026-09-26 (Phase 168)' services/deribit_txn.py` finds 1 line (the note above `_SHAPE_FIELDS`).
- `grep -c 'assignment' docs/deribit-ingestion-design.md` gives **11** (at least 3 required), and the INCLUDE list names `assignment`. `grep -F` for the backtick-quoted pair in that file, piped to `grep -vc assignment`, gives **0**. Before the edit, 5 lines matched the pair; all 5 now name assignment.

Plan-level verification (info item 1, guarded):
- I ran `B=$(git merge-base HEAD origin/main); test -n "$B" || { echo "merge-base FAILED"; exit 1; }; git diff --stat "$B..HEAD" -- supabase/`. The merge base is `096671f2d9e6cc828f82984bc9d0644bce1d6b10` (not empty), and the diff output is **empty**, so there is no migration.

## Test runs

Every run used pytest from `analytics-service/`, with the four TEST env vars unset and the main checkout's venv.
- Task 1 verify set, before any edit (test_deribit_assignment, test_deribit_txn, test_smoothed_mtm_core, test_mtm_single_key, test_deribit_ingest, test_deribit_acceptance): **457 passed**.
- The same set after Task 1: **473 passed**, which is 457 plus the 16 new cases.
- The Task 1 set plus test_deribit_unclassified_evidence, after the prose sweep: **481 passed**.
- Full analytics-service suite (the Task 2 verify): **6384 passed, 90 skipped, exit 0** (139.38 s). That is plan 01's 6366 plus the 18 new cases. I did not itemise the 90 skips. None are in the touched files, which ran with 0 skips.
- mypy strict (`--config-file=pyproject.toml`) on `services/deribit_txn.py services/deribit_ingest.py scripts/deribit_acceptance.py`: **Success: no issues found in 3 source files**.
- ruff: **not run**. As in plan 01, it is not installed in the venv and not configured, so no linter checks line width. For the prose-swept files (`deribit_txn.py`, `deribit_ingest.py`, the design doc, `test_smoothed_mtm_core.py`, `test_deribit_txn.py`) and for `scripts/deribit_acceptance.py`, `test_deribit_acceptance.py` and `test_deribit_unclassified_evidence.py`, the set of over-88-column lines is the same as before the plan. `test_deribit_assignment.py` has **one** new over-88-column line (the `_NON_DERIVATIVE_WORDING` constant, a single string literal kept whole so it matches the guard's wording exactly). The file had 3 such lines before and has 4 now.
- Per-file counts for the touched test files: `test_deribit_assignment.py` 41, `test_deribit_acceptance.py` 28, `test_deribit_unclassified_evidence.py` 8, `test_smoothed_mtm_core.py` 38, `test_deribit_txn.py` 192, all passed.
- Deletion check over the whole plan range (`git diff --diff-filter=D --name-only d448599c5..HEAD`): **empty**.
- check-planning-hygiene: **OK** after every `git add` (7136 tracked files scanned).

## Neuter → RED → restore runs (D-05)

Each run took a byte backup in the per-agent scratch directory and reverted ONE site. It then ran the file and restored with `cp`. Each restore was verified by `cmp` (all printed `CMP-OK`) and by a grep of the restored line. The grep checked that `_OPTION_BOOK_EVENT_TYPES` still appears on 7 lines, that the `row_type in _OPTION_EXPIRY_TYPES` guard is present once, and that the non-comment pair literal count is 0. The file then re-ran GREEN. I ran the neuters on a clean tree, after the Task 1 GREEN commit.

| # | Site reverted to the old pair (only) | Observed RED | Restore |
|---|---|---|---|
| 1 | `_pre_coverage_option_days` | `test_site1_pre_coverage_flags_an_assignment_day` | CMP-OK; 41 passed |
| 2 | `_option_activity_after_coverage` | `test_site2_trailing_assignment_marks_its_currency` | CMP-OK; 41 passed |
| 3 | `_assert_smoothed_summary_cross_check` | `test_site3_cross_check_includes_the_assignment` | CMP-OK; 41 passed |
| 4 | `replay_option_positions` | `test_site4_replay_zeroes_the_assigned_short`, `test_site4_missing_position_refuses[absent/blank/none]`, **`test_smoothed_e2e_short_put_assigned_ingests_flat`** (5 failed). SMOOTHED-E2E failed on the smoothed_mtm **book-channel breach**: the replay kept the short open, and the book no longer matched the flat anchor. | CMP-OK; 41 passed |
| 5 | The mark_to_market option arm in `txn_rows_to_native_daily` | `test_site5_mtm_inside_coverage_contributes_minus_commission`, `test_site5_missing_commission_refuses[absent/blank/none]`, **`test_site5_mtm_e2e_assignment_through_the_native_ledger`**, and also both `test_site6_*` cases (7 failed). SITE5-MTM-E2E failed on the **balance-identity breach**, which is the double count. SITE6 also went red because the non-derivative guard is nested inside this arm. | CMP-OK; 41 passed |
| 6 | The non-derivative guard (`row_type in _OPTION_EXPIRY_TYPES` reverted to `row_type == "delivery"`) | `test_site6_spot_named_assignment_refuses[spot]`, `[unknown]` | CMP-OK; 41 passed |
| 7 | `scripts/deribit_acceptance.py` `check_perp_only_eligibility` (script backed up separately) | `test_site7_acceptance_eligibility_counts_a_lone_assignment` (passed=True: the lone assignment was not counted) | CMP-OK; grep of the restored `elif` gives 1; 28 passed |
| 8 | `assignment` removed from `_SIBLING_TYPES` | `test_the_census_reports_a_same_instrument_assignment` | CMP-OK; grep gives 1; 8 passed |
| 9 | `commission` and `position` removed from `_SHAPE_FIELDS` | `test_the_shape_reports_commission_and_position` | CMP-OK; grep gives 2; 8 passed |

## TDD Gate Compliance

- **Task 1:** RED `245a95666` `test(168-02): …` came before GREEN `20ccfc784` `feat(168-02): …`.
  - The RED run was pytest on `tests/test_deribit_acceptance.py`, with exit **1** (28 tests: 26 passed, 2 failed).
  - The target test was `test_site7_acceptance_eligibility_counts_a_lone_assignment`. It failed on `assert not chk.passed` (actual `passed=True`).
  - The second failure was the existing count-detail assertion, which I updated on purpose to the new wording.
  - `gsd-tools check tdd-red-evidence` returned **RED_EVIDENCE_OK / target_test_failed**. As in plan 01, the verb reads TAP. I transcoded the TAP mechanically from that run's JUnit XML.
- **Task 1, expected greens:** SITE1 to SITE6, the missing-field tests and both end-to-end tests pin behaviour plan 01 already shipped. They were green on first run by design, as the plan states. Neuters 1 to 6 above show each one can fail.
- **Task 2:** RED `3615d55e2` came before GREEN `6064fe15e`. The RED run was pytest on `tests/test_deribit_unclassified_evidence.py`, with exit **1** (8 tests: 6 passed, 2 failed). Both targets, `test_the_census_reports_a_same_instrument_assignment` and `test_the_shape_reports_commission_and_position`, failed on their own assertions. `check tdd-red-evidence` returned **RED_EVIDENCE_OK / target_test_failed** for each.
- There was no REFACTOR commit. The prose-only commit `23b470cf9` is `docs`.

## Decisions Made

- **Where `assignment` sits in `_SIBLING_TYPES`.** It is appended last, so the rendered census reads `delivery=… settlement=… trade=… assignment=…` and the existing order is unchanged. No test or consumer asserts the full census string. I checked with a grep over the tests and for any other reader of the renderer.
- **Which fields `_SHAPE_FIELDS` gains.** Only `commission` and `position`. `test_identifiers_are_REDACTED_by_whitelist` is unchanged and green.
- **One lineage comment kept.** The Phase-82 section comment in `tests/test_deribit_txn.py` describes the pre-fix code's behaviour ("sums option trade/delivery premium change as P&L"). It is a historical statement about old code, not a description of today's option book, so I did not rewrite it. The plan's acceptance grep (the `trade/delivery` form) does not match it. It is reported here so the omission is visible.
- **Assignment dict in SITE5-MTM-E2E.** It was built as `dict(_btc_option_trade(13, …), type="assignment")`, as the plan says. The opening trade is on a different day (07-12), so the "assignment day equals minus its commission" assertion covers a single row.

## Deviations from Plan

**1. [Rule 3 - Harness mismatch, disclosed] The checkout is a linked git worktree on `feat/168-deribitassign`**
- This is the same situation as plan 01. The generic worktree guards (the `agent-*` branch allow-list, and IS_WORKTREE skipping STATE/ROADMAP) do not fit this sequential dispatch.
- The orchestrator's `<project_root_pin>` ran before the first edit and before every commit, and passed each time. `git.base-branch --is-protected` returned `false` for the branch.
- I edited STATE.md and ROADMAP.md by hand, as directed, with byte backups taken first. `state.json` and `milestone.lock` were `cmp`-verified as untouched and left unstaged.

**2. [Rule 1 - Style] I amended the Task 1 GREEN commit once, before any later commit**
- The first docstring edit left a line over the 88-column width the rest of the file keeps. I re-wrapped it and amended my own unpushed commit (`20ccfc784` is the amended hash).
- No behaviour changed. The earlier hash exists only in the local reflog.

**Total deviations:** 2 (1 disclosed harness mismatch, 1 style amend). **Impact:** none on scope.

## Issues Encountered

- There were no failures on unmodified code, so plan 01's six-site swap had no defect.
- Out of scope, not fixed, recorded only: `docs/deribit-ingestion-design.md` already carried, before this plan, a live strategy identifier and a strategy name in its Phase-82 options paragraph. This plan did not add, copy or move them. The public-repo rule makes this worth a separate scrub; the tracked-file hygiene check passes, because it looks for home paths and usernames only.

## Requirement status

`DERIBIT-ASSIGNMENT-UNCLASSIFIED` is declared by plans 01, 02 and 03 and does not appear in `.planning/REQUIREMENTS.md`. Plan 03 has no SUMMARY yet, so the shared-ID gate keeps it from being marked complete here. The `requirements-completed` frontmatter copies the plan's field verbatim.

## Known Stubs

None.

## User Setup Required

None.

## Next Phase Readiness

Plan 03 is next. It is the founder-owned post-deploy checkpoint (D-06, D-08): retry the Deribit options strategy that failed on 2026-09-23, then report the job's terminal status, the return-point count, and the class of any refusal, by type only. No agent reads Deribit.

## Self-Check: PASSED

- There are no created files. All 9 modified files exist on disk.
- Commits `245a95666`, `20ccfc784`, `3615d55e2`, `6064fe15e` and `23b470cf9` are present in `git log`. The count measured from the plan ledger is `git rev-list --count d448599c5..HEAD` = **5** before this docs commit.

---
*Phase: 168-drboptions-a-deribit-options-account-can-be-ingested-end-to*
*Completed: 2026-09-26*
