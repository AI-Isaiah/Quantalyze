---
phase: 168-drboptions-a-deribit-options-account-can-be-ingested-end-to
plan: 01
subsystem: analytics-service (Deribit ingestion classifier)
tags: [deribit, options, assignment, ledger, classification, python]

requires:
  - phase: PR #783 (unknown-type evidence channel)
    provides: describe_unclassified_row, the whitelist renderer and same-instrument sibling census the new guard appends
provides:
  - "`assignment` in CASH_BEARING_TYPES, licensed only for the census shape"
  - "_OPTION_EXPIRY_TYPES / _OPTION_BOOK_EVENT_TYPES read by all six former trade/delivery literal sites"
  - "assert_assignment_uncontested, called in both twins at the correction-gate position"
  - "windowed-crawl assignment backstop in _crawl_deribit_ledger"
  - "docs/evidence/drb-assignment-census-2026-09.json (counts only)"
affects: [168-02, 168-03, deribit ingestion, stitch_composite, derive_broker_dailies]

actuals:
  tokens: 9246
  tasks: 2
  commits: 3
plan_head_before: 22bbfcf30ddbdc61b6702c44773ebadcaaff11a8

tech-stack:
  added: []
  patterns:
    - "Refusal phrases as module constants that the tests import (presence and absence checks cannot drift onto a string nothing emits)"
    - "Option book vocabulary as one frozenset pair with an import-time subset assert against the cash-bearing set"

key-files:
  created:
    - analytics-service/docs/evidence/drb-assignment-census-2026-09.json
    - analytics-service/tests/test_deribit_assignment.py
  modified:
    - analytics-service/services/deribit_txn.py
    - analytics-service/services/deribit_ingest.py
    - analytics-service/tests/test_deribit_unclassified_evidence.py
    - analytics-service/tests/test_deribit_txn.py

key-decisions:
  - "The co-occurrence guard fires on every assignment regardless of change (a size rule would be a magnitude rule, forbidden by D-01)"
  - "The guard's self-skip is by identity, not equality, so equal-but-distinct rows still contest each other"
  - "The discriminator-absence assertion is placed FIRST in each re-pointed refusal test, so the fixture-pointed-back neuter fails on that assertion and not on an earlier type-name check"

patterns-established:
  - "Import-time invariant: _OPTION_BOOK_EVENT_TYPES <= CASH_BEARING_TYPES"

requirements-completed: [DERIBIT-ASSIGNMENT-UNCLASSIFIED]

coverage:
  - id: D1
    description: "A census-shape Deribit options ledger (opening trade + assignment, no same-instrument delivery/settlement) ingests end to end; the assignment cash is summed once on both twins and the balance identity closes"
    requirement: DERIBIT-ASSIGNMENT-UNCLASSIFIED
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_deribit_assignment.py#test_census_shape_ingests_end_to_end_through_the_native_ledger"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_deribit_assignment.py#test_census_shape_is_summed_once_on_both_twins_and_the_identity_closes"
        status: pass
    human_judgment: false
  - id: D2
    description: "The unobserved shapes refuse on both twins: same-instrument delivery or settlement, unnamed instrument (absent/None/blank), zero-change beside a delivery, either row order; a delivery on another instrument does not contest"
    requirement: DERIBIT-ASSIGNMENT-UNCLASSIFIED
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_deribit_assignment.py (guard matrix, 20 parametrised cases)"
        status: pass
    human_judgment: false
  - id: D3
    description: "A since_ms-windowed crawl holding an assignment refuses before the settlement-index fetch and before the USD twin"
    requirement: DERIBIT-ASSIGNMENT-UNCLASSIFIED
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_deribit_assignment.py#test_windowed_refuses_an_assignment"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_deribit_assignment.py#test_windowed_refuses_before_the_usd_twin"
        status: pass
    human_judgment: false
  - id: D4
    description: "Counts-only evidence file with no identifying key or instrument-shaped string; the unknown-type evidence tests still test the unknown-type channel"
    requirement: DERIBIT-ASSIGNMENT-UNCLASSIFIED
    verification:
      - kind: unit
        ref: "analytics-service/tests/test_deribit_assignment.py#test_census_evidence_file_carries_counts_and_nothing_identifying"
        status: pass
      - kind: unit
        ref: "analytics-service/tests/test_deribit_unclassified_evidence.py (3 re-pointed tests)"
        status: pass
    human_judgment: false
  - id: D5
    description: "A real Deribit options account ingests end to end in production"
    requirement: DERIBIT-ASSIGNMENT-UNCLASSIFIED
    verification: []
    human_judgment: true
    rationale: "Founder-owned post-deploy observation (D-06/D-08, plan 03); no agent reads Deribit"

duration: 17min
completed: 2026-09-26
status: complete
---

# Phase 168 Plan 01: Deribit `assignment` classification Summary

**Deribit `assignment` is now cash-bearing on both twins, but only in the shape the 2026-09-23 census measured (no same-instrument `delivery` or `settlement`). A shared guard refuses every other shape. All six option-book literal sites now read one vocabulary constant, changed in the same commit as the set edit. A windowed crawl refuses an assignment before the USD twin sees it.**

## Performance

- **Duration:** about 17 min
- **Started:** 2026-09-26T10:07:22Z
- **Completed:** 2026-09-26T10:24:41Z
- **Tasks:** 2 (Task 1 tracer, Task 2 TDD)
- **Files modified:** 6 (2 created, 4 modified)

## Accomplishments

- `assignment` joins `CASH_BEARING_TYPES`. Its column-table line cites the D-03 evidence file, marks the delivery-relabel reading as an ASSUMPTION, cites no magnitude, and says that under mark_to_market inside summary coverage it contributes only −commission.
- `_OPTION_EXPIRY_TYPES` (delivery, assignment) and `_OPTION_BOOK_EVENT_TYPES` (trade plus the expiry types) carry an import-time assert: `_OPTION_BOOK_EVENT_TYPES <= CASH_BEARING_TYPES`. All six former literal sites read these sets now: `_pre_coverage_option_days`, `_option_activity_after_coverage`, `_assert_smoothed_summary_cross_check`, `replay_option_positions`, the `txn_rows_to_native_daily` option arm, and that arm's non-derivative guard. The guard's message now carries the row's type. For `delivery` the message is byte-identical to before.
- `assert_assignment_uncontested(row, rows)` sits beside `assert_correction_classifiable`. It is called as `if row_type == "assignment"` at the correction-gate position in both twins. It refuses on a same-instrument delivery or settlement, using `_ASSIGNMENT_CONTESTED_PHRASE`, and on an absent, None or blank instrument, using `_ASSIGNMENT_UNNAMED_PHRASE`. It fires on any change and appends `describe_unclassified_row`.
- `_crawl_deribit_ledger` refuses with "assignment classification requires a full-history crawl (since_ms=None)" when `since_ms` is set and a batch holds an assignment. The check runs after `paginate_txn_log` and before `if ccy_upper in indexable:`, so no index fetch happens and the USD twin never sees the batch.
- `analytics-service/docs/evidence/drb-assignment-census-2026-09.json` records counts and categories only.
- `test_deribit_unclassified_evidence.py` now tests a still-unknown type (`UNKNOWN_ROW`, with its own synthetic change). Each refusal test first asserts that the imported discriminator phrase is absent.

## Task Commits

1. **Task 1 (tracer): the census shape ingests end to end, and the co-occurring shape refuses, on both twins.** Commit `f76054830` (feat). The set edit, the six-site swap and the guard landed in ONE commit.
2. **Task 2 (TDD): guard edges plus the windowed-crawl backstop.**
   - RED: `672069e3f` (test)
   - GREEN: `deeba4194` (feat)

**Plan metadata:** this SUMMARY's docs commit.

## Files Created/Modified

- `analytics-service/docs/evidence/drb-assignment-census-2026-09.json`: the D-03 census record (counts only).
- `analytics-service/services/deribit_txn.py`: the classification, the vocabulary constants, the guard, and the two twin calls.
- `analytics-service/services/deribit_ingest.py`: the windowed-crawl backstop in `_crawl_deribit_ledger`.
- `analytics-service/tests/test_deribit_assignment.py`: the end-to-end census test, both twins with the identity, the guard matrix, the evidence-file test, the vocabulary invariant and the backstop tests (26 cases).
- `analytics-service/tests/test_deribit_unclassified_evidence.py`: the three tests re-pointed to `UNKNOWN_ROW`, the discriminator-absence asserts, and the docstring updated.
- `analytics-service/tests/test_deribit_txn.py`: `test_type_sets_pinned_to_evidence` now includes `assignment`, and `exercise` and `expiry` are pinned in neither set.

## Acceptance evidence (commands and actual output)

Task 1:
- `grep -v '^\s*#' services/deribit_txn.py | grep -c '("trade", "delivery")'` gives **0**. `grep -cE 'row_type == "(trade|delivery)"' services/deribit_txn.py` gives **0**.
- Guard call sites: the naive grep (`grep -v '^def ' | grep -v '^\s*#' | grep -c 'assert_assignment_uncontested('`) gives **2**. A docstring-aware `ast.walk` over `services/deribit_txn.py`, counting `ast.Call` nodes whose `func` is `Name('assert_assignment_uncontested')`, also gives **2**.
- `_ASSIGNMENT_CONTESTED_PHRASE` appears **3** times in `test_deribit_unclassified_evidence.py` and **2** in `test_deribit_assignment.py`. Each phrase's literal text appears exactly **1** time in `deribit_txn.py`: its constant definition, with messages interpolating it.
- The evidence file parses as JSON (`python3 -m json.tool` OK). `grep -cE '[0-9]{1,2}[A-Z]{3}[0-9]{2}'` on it gives **0**. Test (4) passes.
- Same-commit invariant: `git log -S'"assignment"' -- services/deribit_txn.py` lists only `f76054830`. `git show f76054830 -- services/deribit_txn.py` contains **5** `^\+.*in _OPTION_BOOK_EVENT_TYPES` lines and **1** `^\+.*in _OPTION_EXPIRY_TYPES` line. It also contains `-` lines removing all four tuples, the `row_type == "trade" or row_type == "delivery"` arm test, and the `row_type == "delivery"` guard equality.
- The three re-pointed test bodies use `UNKNOWN_ROW`, and both refusal tests assert `_ASSIGNMENT_CONTESTED_PHRASE not in msg` (read back after the edit).

Task 2:
- `grep -ciE 'settlement_contests|other_instrument|empty_instrument|empty_batch|zero_change|order_independent|windowed_refuses' tests/test_deribit_assignment.py` gives **9**.
- `grep -c '_ASSIGNMENT_UNNAMED_PHRASE' tests/test_deribit_assignment.py` gives **2**. The only EMPTY-INSTRUMENT `pytest.raises` carries `match=re.escape(_ASSIGNMENT_UNNAMED_PHRASE)`, and it is parametrised across 3 cases × 2 twins.
- `grep -c 'assignment classification requires a full-history crawl' services/deribit_ingest.py` gives **1**.
- Placement in `deribit_ingest.py` is `paginate_txn_log(` at 1194, then the backstop literal at 1231, then `if ccy_upper in indexable:` at 1247. The order is correct.

Plan-level verification:
- No migration: `B=$(git merge-base HEAD origin/main); test -n "$B" || { echo "merge-base FAILED"; exit 1; }; git diff --stat "$B..HEAD" -- supabase/`. The merge base is `096671f2d9e6cc828f82984bc9d0644bce1d6b10` (non-empty) and the diff output is **empty**.
- The expiry-shaped grep on the evidence file gives **0**, and the file holds no float (test (4)).

## Test runs

All runs used pytest from `analytics-service/`, with the four TEST env vars unset and the main checkout's venv.
- Baseline before any edit, over test_deribit_unclassified_evidence, test_deribit_txn, test_deribit_ingest, test_smoothed_mtm_core, test_stitch_composite_job and test_job_worker_deribit: **478 passed**.
- Task 1 verify, over test_deribit_assignment, test_deribit_unclassified_evidence, test_deribit_txn, test_deribit_ingest and test_smoothed_mtm_core: **377 passed**.
- Task 2 verify (the 7-file set): **504 passed**, which is 478 + 26 new.
- Full analytics-service suite: **6366 passed, 90 skipped, exit 0** (185.95 s). I did not itemise the 90 skips. None of them are in the touched files, which ran with 0 skips.
- mypy (`--config-file=pyproject.toml`, strict) on `services/deribit_txn.py services/deribit_ingest.py`: **Success: no issues found in 2 source files**.
- ruff: **not run**. ruff is not installed in the analytics-service venv, and neither the repo nor `analytics-service/pyproject.toml` configures it (CI's Python gate is mypy strict).

## Neuter → RED → restore runs (D-05)

Each run took a scratchpad byte backup first and restored with `cp`. Every restore was verified by `cmp` (all returned `CMP-OK`) and by a grep of the restored line, and the file then re-ran GREEN.

| # | Neuter | Observed RED | Restore |
|---|---|---|---|
| 1a | Remove `assignment` from `CASH_BEARING_TYPES` only | Collection error: the import-time `_OPTION_BOOK_EVENT_TYPES <= CASH_BEARING_TYPES` assert fired. The invariant itself bites. | cmp OK; 6 passed |
| 1b | Remove `assignment` from `CASH_BEARING_TYPES` AND `_OPTION_EXPIRY_TYPES`, so the import passes | tests (1) end-to-end and (2) both-twins FAILED with the unknown-type refusal (whose census reads `delivery=0 settlement=0 trade=1`) | cmp OK; `"assignment",` grep 1; 6 passed |
| 2 | Remove the guard call from the USD twin only | test (3) `[usd_twin]` FAILED: DID NOT RAISE (silent double count); `[native_twin]` passed | cmp OK; call-line grep 2; 6 passed |
| 3 | Remove the guard call from the native twin only | test (3) `[native_twin]` FAILED: DID NOT RAISE; `[usd_twin]` passed | cmp OK; call-line grep 2; 6 passed |
| 4 | Point `UNKNOWN_ROW` back at `type="assignment"`, same-instrument delivery kept | `test_refusal_carries_the_shape_and_the_sibling_census` and `test_the_native_sibling_refusal_carries_it_too` FAILED on `assert _ASSIGNMENT_CONTESTED_PHRASE not in msg`. The zero-change test also FAILED (a classified zero-change assignment emits a day record). | cmp OK; `UNKNOWN_ROW` grep shows `mystery_new_type`; 6 passed |
| 5 | Delete the backstop (`if False and any(`) | WINDOWED-REFUSES and WINDOWED-REFUSES-BEFORE-USD-TWIN FAILED (DID NOT RAISE) | cmp OK; condition grep 1; 26 passed |
| 6 | Contesting set becomes `{"delivery"}` only | SETTLEMENT-CONTESTS FAILED on both twins | cmp OK; 26 passed |
| 7 | Guard returns early on zero change | ZERO-CHANGE-STILL-GUARDED FAILED on both twins | cmp OK; the neuter line grep gives 0; 26 passed |
| 8 | The unnamed-instrument branch returns None | EMPTY-INSTRUMENT FAILED on all 6 cases. USD twin: DID NOT RAISE. Native twin: "Regex pattern did not match", where the actual message was the option arm's non-derivative refusal ("Deribit assignment row id=2 names an unclassifiable or spot instrument…"). This proves the `match=` is load-bearing. | cmp OK; 26 passed |
| 9 | The sibling predicate ignores `instrument_name` | OTHER-INSTRUMENT-OK FAILED | cmp OK; predicate grep 1; 26 passed |
| 10 | The guard scans only rows before the current row | ORDER-INDEPENDENT `[assignment_first]` FAILED on both twins; `[delivery_first]` passed. Tests (3), SETTLEMENT and ZERO-CHANGE also FAILED, because their assignment comes first. | cmp OK; loop-head grep 1; 26 passed |

## TDD Gate Compliance (Task 2)

- RED commit `672069e3f` `test(168-01): …` precedes GREEN commit `deeba4194` `feat(168-01): …`.
- RED evidence: the command was pytest on `tests/test_deribit_assignment.py`, with exit code 1 (26 tests, 24 passed, 2 failed). The target tests `test_windowed_refuses_an_assignment` and `test_windowed_refuses_before_the_usd_twin` both failed with `DID NOT RAISE LedgerValuationError`. The expected result was the full-history refusal on a windowed crawl holding an assignment. `gsd-tools check tdd-red-evidence` returned **RED_EVIDENCE_OK / target_test_failed** for each target. Note that the verb parses TAP. I transcoded the TAP lines mechanically from that same run's pytest JUnit XML (one `ok`/`not ok` line per testcase plus `# tests/# pass/# fail`); they were not hand-written.
- The 24 guard-edge tests in the RED run were already GREEN. That is by design: Task 1 shipped the guard, and each edge was proven able to fail by neuters 6–10 above, not by an unexpected green.
- No REFACTOR commit was needed.

## Tracer feedback gate (Task 1)

There was no `gate="blocking-human"`, the verify is `<automated>` only, and `human_verify_mode` is the default `end-of-phase`. After the Task 1 commit I re-ran the verify: 377 passed, then the 26-test file with the 6 Task-1 tests green. Tracer verified end to end, then expanded.

## Decisions Made

- **The guard fires on every assignment, regardless of change.** The plan's must_haves decided this over RESEARCH's recommendation to fire only on a nonzero change. ZERO-CHANGE-STILL-GUARDED pins it.
- **The self-skip is by identity.** `_run_options_ledger` copies the list but shares the dict objects, so `other is row` works across the crawl. Two equal but distinct rows still contest each other.
- **Neuter 1 was run in two forms.** The plan's one-line neuter trips the new import-time assert before any test runs. That is real evidence the invariant bites, but it does not exercise tests (1) and (2). So the neuter was repeated with `_OPTION_EXPIRY_TYPES` edited too, which made both tests go RED on their own assertions.
- `_SIBLING_TYPES`, `_SHAPE_FIELDS`, the stale 2026-09-12 comment, the docstrings that name "trade/delivery", and `docs/deribit-ingestion-design.md` were deliberately left alone. Plan 02 Task 2 owns all of them.

## Deviations from Plan

**1. [Rule 1 - Test correctness] The discriminator-absence assert moved to the top of each re-pointed refusal test**
- **Found during:** Task 1, neuter 4.
- **Issue:** With the assertion placed last, pointing the fixture back at `assignment` failed on the earlier `assert UNKNOWN_ROW["type"] in msg`, not on the absence assertion. The plan requires the absence assertion itself to be seen RED.
- **Fix:** Moved `assert _ASSIGNMENT_CONTESTED_PHRASE not in msg` to the first assertion in both refusal tests. The neuter now edits the `UNKNOWN_ROW` definition itself, and both tests fail on the absence line.
- **Files modified:** `analytics-service/tests/test_deribit_unclassified_evidence.py`
- **Committed in:** `f76054830`

**2. [Rule 3 - Harness mismatch, disclosed] The checkout is a linked git worktree on `feat/168-deribitassign`**
- The generic worktree guards (the `agent-*` branch allow-list, and IS_WORKTREE skipping the STATE/ROADMAP updates) do not fit this sequential dispatch. The orchestrator's `<project_root_pin>` ran before every write and every commit and passed each time. The branch was asserted as not protected. STATE.md and ROADMAP.md were updated by hand, as the orchestrator directed.

**Total deviations:** 2 (1 test-correctness fix, 1 disclosed harness mismatch). **Impact:** none on scope.

## Issues Encountered

None blocking. `.planning/STATE.md` carried the orchestrator's uncommitted edits (current_phase 168, EXECUTING). They are kept, and they ride along in this plan's docs commit together with the plan-01 progress edits. `.planning/state.json` and `.planning/milestone.lock` were `cmp`-verified untouched and left unstaged.

## Requirement status

`DERIBIT-ASSIGNMENT-UNCLASSIFIED` is declared by plans 01, 02 and 03 and does not appear in `.planning/REQUIREMENTS.md`. Under the shared-ID gate it is NOT marked complete here. The `requirements-completed` frontmatter copies the plan's field verbatim.

## Known limits (backstop truths, accepted in must_haves)

- A crawl that races an expiry could see the assignment before a sibling that is written later. The next recompute sees both rows and refuses loudly.
- The native twin's all-scope batch can refuse as a false positive when two subaccounts hold the same instrument. This is loud and never silent. The guard is not keyed on `user_id`.

## User Setup Required

None.

## Next Phase Readiness

Plan 02 is next. It adds the per-site pins for every option-book reader, the seventh literal in `scripts/deribit_acceptance.py`, `_SIBLING_TYPES`/`_SHAPE_FIELDS`, and the prose sweep. Plan 03 is the founder's post-deploy retry.

## Self-Check: PASSED

- The two created files exist on disk: the evidence file and `tests/test_deribit_assignment.py`.
- Commits `f76054830`, `672069e3f` and `deeba4194` are present in `git log`.

---
*Phase: 168-drboptions-a-deribit-options-account-can-be-ingested-end-to*
*Completed: 2026-09-26*
