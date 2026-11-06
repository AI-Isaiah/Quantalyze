---
phase: 173-rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are
fixed_at: 2026-10-28T10:55:51Z
review_path: .planning/phases/173-rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are/173-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 173: Code Review Fix Report

**Fixed at:** 2026-10-28T10:55:51Z
**Source review:** 173-REVIEW.md (WR-01..WR-04) and 173-SFH.md (SFH-1, SFH-2)
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (WR-02 and SFH-1 are the same defect, one commit)
- Fixed: 6
- Skipped: 0

Verification ran in the isolated worktree on branch `feat/173-rebuildgates`, with the main checkout interpreter. Every
mutation was applied to a file with a byte backup (`cp -p` then `cmp`), run, and restored from that backup; no
`git checkout`, `restore` or `stash` was used on uncommitted work.

## Fixed Issues

### WR-02 = SFH-1: no code-derived Bybit roll-up (vacuous `bybit-transfers: ok`)

**Files modified:** `analytics-service/scripts/allocator_history_probe.py`, `analytics-service/tests/test_allocator_history_probe.py`, `.planning/phases/173-rebuildgates-okx-trade-ordering-and-bybit-transfer-depth-are/173-03-PLAN.md`
**Commit:** f473dc8d1
**Applied fix:** `summarize` now carries `bybit_accounts_applicable` (accounts whose gate is not `not-applicable`) and
`bybit_transfers_gate` (`ok` only when at least one account is applicable and every applicable account reads `ok`, else
`unmeasured`); both are in `SUMMARY_RECORD_KEYS` and `_SUMMARY_VALIDATORS`. Plan 03 Task 1 now copies `bybit-transfers:`
from that token (`unmeasured (no applicable label)` when none applies), `sc2-met: yes` also needs a6 `selection` ok and
`bybit_members >= 1`, the close rule for `BYBIT-TRANSFER-DEPTH-UNMEASURED` reads the summary token, and the GATES_OK verify
checks the summary carries `bybit_accounts_applicable` and that the `bybit-transfers:` token equals the summary's
`bybit_transfers_gate`. `verify-plan-anchors.mjs` reports no stale claims; `verify.plan-structure` is valid.
**Test:** `test_the_summary_bybit_gate_is_ok_only_with_an_applicable_account_and_all_applicable_ok` (9 parametrised
cases, including zero and not-applicable-only accounts), the end-to-end summary dict in
`test_run_end_to_end_prints_one_record_per_account_and_a_summary`, and two emitter-refusal cases.
**Mutation:** dropped the `applicable and` guard so the empty list reads `ok`: RED (4 failed: the three zero-applicable
cases and the end-to-end summary); restored, 112 passed.

### WR-01: the ordering reading did not prove the page holds the newest fills

**Files modified:** `analytics-service/scripts/allocator_history_probe.py`, `analytics-service/tests/test_allocator_history_probe.py`
**Commit:** b1772495a
**Applied fix:** `_pass_newest_ms` returns the forced pass's newest fill for an instrument type (max `_Call.newest_ts`);
a descending raw page is a reading only when its first `ts` reaches it, otherwise `field-absent` (no reading, gate stays
`unmeasured`). Existing fixtures now answer with a page that starts at the stub pass's newest fill (`_newest_page`).
**Test:** `test_a_descending_raw_page_that_does_not_reach_the_newest_fill_is_no_reading` (a page starting exactly at the
newest fill is accepted; one millisecond older is not).
**Mutation:** replaced the reach check with `if False`: RED (1 failed); restored, 113 passed. Re-run after the SFH-2
restructure against the new code: RED (2 failed); restored.

### SFH-2: `okx_order_gate=ok` rested on one instrument type per member

**Files modified:** `analytics-service/scripts/allocator_history_probe.py`, `analytics-service/tests/test_allocator_history_probe.py`
**Commit:** 6c393d241
**Applied fix:** `_busiest_inst_type` is replaced by `_row_inst_types` (every type the forced-pass snapshot read rows on).
`_okx_order_reading` reads each type, and the member keeps ONE reading: `True` only when every type answers newest first
and reaches its newest fill, `False` when any type answers oldest first, otherwise no reading. A read that raises is
swallowed by class (the first class is recorded); a `False` from another type still stands. The snapshot-before-diagnostic
rule is unchanged, so `readings <= members_with_trades` holds. Module docstring item 4 and the function docstring updated.
**Test:** `test_the_members_reading_is_true_only_when_every_inst_type_it_read_answers_newest_first` (six cases: both good,
the non-busiest type violates, one stale, one unreadable, one raises, one raises beside a violation), and
`test_one_raw_order_read_per_inst_type_the_forced_pass_read_and_one_reading_per_member` (renamed, now expects SPOT and SWAP
raw calls and one reading).
**Mutation:** read only the busiest type (`types[-1:]`): RED (4 failed); `any` True instead of `all` True: RED (1 failed);
`False` ignored: RED (3 failed). Each restored from the byte backup, 114 passed after.

### WR-03: no success-arm test pinned the ordering read to the pre-diagnostic snapshot

**Files modified:** `analytics-service/tests/test_allocator_history_probe.py`
**Commit:** a07a96ac1
**Applied fix:** test-only. `_anchoring_reader` gained `advisory_inst_type`; the new test runs the `anchor_opening_agreed`
arm with forced `swap` pages (few rows) and advisory `futures` pages (more rows), a descending page at the newest fill, and
asserts the raw read's instType set is `["SWAP"]`, `okx_order_readings == 1`, `trade_calls == 2`, `anchor_diagnostic == "run"`.
**Test:** `test_the_agreed_anchors_ordering_read_uses_the_forced_pass_instrument_type`.
**Mutation:** moved the success-arm ordering read after the diagnostic and handed it the live `recorder.calls`: RED
(1 failed); restored, 115 passed.

### WR-04: runbook P4 stated a different opening condition than the code-derived gate

**Files modified:** `docs/runbooks/marksource-okx-history-correction.md`, `analytics-service/tests/test_allocator_history_probe.py`
**Commit:** 03a097fbe
**Applied fix:** both sentences now say the entry closes, and a rebuild runs, only when the probe's summary
`okx_order_gate` reads `ok`; full-page stops are named as reading `violated`; the `measured` token is gone.
**Test:** `test_the_runbook_names_the_code_derived_okx_gate_token_as_its_only_opening_condition` (both conditions present,
no `measured` wording, full-page stops named, every named token is in `_OKX_ORDER_GATES`). The existing vitest guard
`src/__tests__/marksource-okx-census-sql.test.ts` also passes (108 tests); `node_modules` was linked from the main
checkout for it and removed afterwards.
**Mutation:** restored the pre-fix runbook text (byte backup of the fixed file first): RED (1 failed); restored with `cmp`
clean, 116 passed.

## Skipped Issues

None.

## Final gates (run from `analytics-service/`, main checkout interpreter, in the worktree)

- `pytest tests/test_allocator_history_probe.py tests/test_trade_pages.py tests/test_bybit_two_year_window.py -q`: 166 passed. The static source pins in the probe test file (no write verbs, no deny-key field names) are inside that run.
- `mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/allocator_history_probe.py`: no issues in 1 source file.
- CI's mypy line verbatim (`services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`): no issues in 127 source files.
- `./node_modules/.bin/vitest run src/__tests__/marksource-okx-census-sql.test.ts` (worktree root): 108 passed.

Verification ran in the isolated worktree `quantalyze-173` (not the main checkout), using the main checkout's Python
interpreter; the numbers are reproducible from the branch.

---

# Round 2

**Source review:** 173-REVIEW-2.md (WR-01..WR-03) and the ROUND 2 section of 173-SFH.md (R2-SFH-1..R2-SFH-3)
**Iteration:** 2
**Summary:** findings in scope 6, fixed 6, skipped 0.

Verification ran in the isolated worktree `quantalyze-173` on branch `feat/173-rebuildgates` with the main checkout
interpreter. Every mutation was applied to a file with a byte backup (`cp -p`), run, and restored from that backup
(`cmp` clean); no `git checkout`, `restore` or `stash` on uncommitted work. The numbers are reproducible from the branch.

### R2 WR-01: a type that cannot say voided the member's reading

**Commit:** d07645a63
**Files:** `analytics-service/scripts/allocator_history_probe.py`, `analytics-service/tests/test_allocator_history_probe.py`
**Applied fix:** `_row_inst_types` selects a type only when its forced pass read at least two DISTINCT timestamps. A
SPOT type whose fills share one millisecond owes no reading; a selected type that answers `field-absent` still voids the
member (fail shut).
**Test:** `test_an_inst_type_that_cannot_show_an_order_owes_the_member_no_reading` (newest-first multi-page SWAP plus a
SPOT pass of three fills in one millisecond: one raw call, SWAP only, `okx_order_readings == 1`, gate `ok`).
**Mutation:** dropped the `max(stamps) > min(stamps)` clause: RED (1 failed); restored, 118 passed.

### R2 WR-02: the reach check was not pinned per instrument type

**Commit:** 1b505c2f5 (test-only)
**Files:** `analytics-service/tests/test_allocator_history_probe.py`
**Test:** `test_each_inst_types_page_must_reach_that_types_own_newest_fill` (SPOT newest fill 10^9 ms older than SWAP's;
four answer combinations including the swapped roles, readings 0/1 and gate `unmeasured`/`ok`).
**Mutation:** `_pass_newest_ms` returning the OLDEST of the types' newest fills (the reviewer's mutant): RED (1 failed);
the type-blind MAX mutant (all types' calls): RED (1 failed); restored, 118 passed.

### R2 WR-03: the runbook's opening paragraph still stated the old condition

**Commit:** a62ae56a4
**Files:** `docs/runbooks/marksource-okx-history-correction.md`, `analytics-service/tests/test_allocator_history_probe.py`
**Applied fix:** "Where this stands" now says "Until the probe's summary `okx_order_gate` reads `ok`, pre-flight P4 is a
write STOP". The runbook pin test now also asserts over the WHOLE runbook text: no "reads measured", no "measured with 0
violations", and the new sentence present. The P4-slice assertions stay.
**Test:** `test_the_runbook_names_the_code_derived_okx_gate_token_as_its_only_opening_condition`.
**Mutation:** restored the pre-fix opening sentence: RED (1 failed); restored with `cmp` clean, 118 passed.
`./node_modules/.bin/vitest run src/__tests__/marksource-okx-census-sql.test.ts`: 108 passed (node_modules linked from
the main checkout, removed afterwards).

### R2-SFH-1: summary `bybit_transfers_gate: ok` beside a Bybit account that was never read

**Commit:** b9fcbd2ef
**Files:** `analytics-service/scripts/allocator_history_probe.py`, `analytics-service/tests/test_allocator_history_probe.py`
**Applied fix:** the summary reads `ok` only when additionally no account record has `selection != "ok"`.
**Test:** new parametrised case (`selection_refused`) on
`test_the_summary_bybit_gate_is_ok_only_with_an_applicable_account_and_all_applicable_ok`: a selection-refused account
beside one applicable `ok` account reads `unmeasured`.
**Mutation:** removed the `selection` clause: RED (1 failed, the new case); restored, 119 passed.

### R2-SFH-2 and R2-SFH-3: GATES_OK compared only the Bybit token, and demanded Bybit lines when none applied

**Commit:** 8abb41d9b
**Files:** `173-03-PLAN.md` (Task 1 verify and its `fails_when`)
**Applied fix:** the verify now compares `okx-order:` with the summary's `okx_order_gate` and `readings=` with the
summary's `okx_order_readings` (same `sed` and `grep -F` pattern as `bybit_transfers_gate`; the keys are sorted in the
emitted line, so the readings match is anchored on the following `"okx_order_violations"` key). The
`bybit-transfers-kinds:` and `bybit-transfers-evidence:` greps are required only when the summary's
`bybit_accounts_applicable` is not 0.
**Dry run** (synthetic SUMMARY files built from `emit_record` output, in the untracked scratchpad; the extracted chain
run with only the summary path replaced):
- matching, one applicable account: `GATES_OK`
- `okx-order: violated` against summary `ok`: no output (fails); `readings=2` against summary 1: no output (fails)
- zero applicable accounts, `unmeasured (no applicable label)`, no kinds or evidence lines: `GATES_OK`
- one applicable account but no kinds or evidence lines: no output (fails); `unmeasured (a1)` against summary `ok`: fails
- the pre-edit chain accepted both OKX mismatches and rejected the zero-applicable branch, so the dry run discriminates.
`node scripts/verify-plan-anchors.mjs` reports no stale claims; `verify.plan-structure` is valid.

## Round 2 final gates

Run from `analytics-service/` with the main checkout interpreter, in the worktree.

- `pytest tests/test_allocator_history_probe.py tests/test_trade_pages.py tests/test_bybit_two_year_window.py -q`: 169 passed.
- `mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/allocator_history_probe.py`: no issues in 1 source file.
- CI's mypy line verbatim: no issues in 127 source files.
- vitest `src/__tests__/marksource-okx-census-sql.test.ts` (worktree root): 108 passed.


## Round 3 (final)

**Source review:** 173-REVIEW-3.md (WR-01..WR-03), 173-SFH.md ROUND 3 (R3-SFH-1, R3-SFH-2) and founder decision D-05 in
173-CONTEXT.md ("Count readable, list refused (Recommended)"). Findings in scope: 5 (WR-01 = R3-SFH-1, WR-02 = R3-SFH-2
for the GATES_OK chain), all fixed.

### R3 WR-01 + R3-SFH-1: the summary Bybit gate over-shut on a selection refusal (D-05)

**Commits:** 41a4ef24d (probe and tests), 8800f14a2 (plan 03)
**Files:** `analytics-service/scripts/allocator_history_probe.py`, `analytics-service/tests/test_allocator_history_probe.py`,
`173-03-PLAN.md`
**Applied fix:** `summarize` drops the `selection` clause: `bybit_transfers_gate` reads `ok` when the applicable list is
non-empty and every applicable account reads `ok`; a selection-refused account is `not-applicable`, neither shuts nor
opens it. Plan 03 step 8 adds exactly one `bybit-transfers-unread: <labels refused at selection, or none>` line;
`(no applicable label)` is accepted only beside `"bybit_accounts_applicable":0,` (and is required there); the SC-2
must_have, the ledger-honesty must_have, the BYBIT-TRANSFER-DEPTH TODO close rule, the verification prose and the
acceptance criteria use the D-05 wording.
**Test:** the parametrised summary test replaces the over-broad case with `(not-applicable, ok)` -> `ok`, PROD's shape
(four selection-refused plus one applicable `ok`) -> `ok`, refused accounts alone -> `unmeasured` (zero applicable), and a
refusal beside an `unmeasured` applicable account -> `unmeasured`.
**Mutation:** restored the `selection` clause: RED (2 failed, the two new `ok` cases); restored from `cmp`-clean byte
backup, 122 passed.

### R3 WR-02 + R3-SFH-2: GATES_OK did not compare each kinds line and accepted duplicate lines

**Commit:** 8800f14a2
**Files:** `173-03-PLAN.md` (Task 1 verify, `fails_when`, acceptance criteria)
**Applied fix:** the chain now requires exactly one summary record, `okx-order:`, `okx-order-reading:`, `bybit-transfers:`
and `bybit-transfers-unread:` line; one kinds line and one evidence line per applicable label (counts equal the
summary's `bybit_accounts_applicable`), no duplicated kinds label; for EACH kinds line, `gate=`, `deposits=` and
`withdrawals=` must equal that label's single account record (`bybit_transfers_gate`, `deposits_older_365d`,
`withdrawals_older_365d`); the labels in the `bybit-transfers: unmeasured (...)` parenthesis must equal the labels whose
kinds line reads `gate=unmeasured`; `bybit-transfers-unread:` must equal the account records whose `selection` is not
`ok` (labels and count).
**Dry run** (synthetic SUMMARYs built from `emit_record` and `summarize` output, in the untracked scratchpad, the chain
extracted from the plan with only the summary path replaced): GATES_OK for PROD's shape with a6 `ok`, PROD's shape with a6
`unmeasured`, zero applicable, and one `ok` plus one `unmeasured` applicable label. No GATES_OK for: kinds `gate=ok`
against an `unmeasured` record; mismatching `deposits=` and `withdrawals=`; a missing kinds line; a duplicated kinds,
`okx-order:`, `bybit-transfers:` or summary line; `(no applicable label)` with one applicable; a parenthesis naming an `ok`
label; an `unread` line that omits a refused label, says `none`, or is absent; an `okx-order:` token mismatch. The round-2
chain accepted the kinds mismatches and the duplicated lines on the same files, so the dry run discriminates.
`node scripts/verify-plan-anchors.mjs` reports no stale claims; `verify.plan-structure` is valid.

### R3 WR-03: `_row_inst_types` skipped multi-page and stamp-less types

**Commit:** 35d92107c
**Files:** `analytics-service/scripts/allocator_history_probe.py`, `analytics-service/tests/test_allocator_history_probe.py`
**Applied fix:** a type is skipped only when its forced pass read a single distinct timestamp AND fewer rows than the OKX
page size; every other type with at least two rows is read, and a stamp-less one fails shut through the existing
`newest is None` branch of the reach check. The module docstring item 4 and `_okx_order_reading`'s docstring describe the
rule that ships.
**Test:** `test_a_multi_page_inst_type_with_no_usable_timestamps_still_voids_the_members_reading`: SWAP newest first beside
a 140-row SPOT pass over two calls, once with no timestamps and once at one millisecond; SPOT is read and readings read 0
with gate `unmeasured`. The round-2 single-millisecond short SPOT case still reads `ok`.
**Mutation:** restored the round-2 rule (distinct timestamps only, no page-size bound): RED (the new test only); restored
from a `cmp`-clean byte backup, 123 passed.

## Round 3 final gates

Run from `analytics-service/` with the main checkout interpreter, in the worktree.

- `pytest tests/test_allocator_history_probe.py tests/test_trade_pages.py tests/test_bybit_two_year_window.py -q`: 173 passed.
- `mypy --strict --follow-imports=silent --config-file=pyproject.toml scripts/allocator_history_probe.py`: no issues in 1 source file.
- CI's mypy line verbatim: no issues in 127 source files.

---

_Fixed: 2026-10-28T10:55:51Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
