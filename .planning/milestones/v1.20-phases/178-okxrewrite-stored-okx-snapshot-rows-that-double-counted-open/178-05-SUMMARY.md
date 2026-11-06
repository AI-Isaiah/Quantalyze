---
phase: 178-okxrewrite-stored-okx-snapshot-rows-that-double-counted-open
plan: 05
subsystem: runbook
tags: [runbook, crosswalk, okx, dead-key, b-prime-1, b-prime-5, probe-labels]
status: complete

requires:
  - phase: 178-01
    provides: "the exchange-account decision order and the audit key account_non_working_accounts_excluded"
  - phase: 178-02
    provides: "P7 and the shared user_key .. exchange_account block in okx-nonworking-keys.sql"
provides:
  - "crosswalk: one read-only form mapping probe labels to census labels with the probe record's own counts as a fingerprint"
  - "B'1 group rule matching the deployed rebuild; P7-based venue and window predictions"
  - "P1 third check, P4 per-target ordering reading (D-02), audit column, B'5 rules 5 and 6"
affects: [178-03]

actuals:
  tokens: 4100
  tasks: 2
  commits: 2
plan_head_before: d058390520719abe5b1c1c23360dc65cdddf6038
plan_head_after: 9b276a14bf37ef1425ac7bf134f723339176cf17

tech-stack:
  added: []
  patterns:
    - "a shared CTE block is byte-pinned between a census file and a runbook form so two readings come from one grouping"

key-files:
  created: []
  modified:
    - docs/runbooks/marksource-okx-history-correction.md
    - src/__tests__/marksource-okx-census-sql.test.ts

key-decisions:
  - "The crosswalk's probe label counts owners with an ACTIVE okx or bybit key (is_active, the probe's own filter), ordered by earliest such key then user_id; an owner whose only OKX key is inactive has a census label and probe label none"
  - "The existing 2026-10-27 'Where this stands' paragraph is kept verbatim as lineage: a probe unit test pins one of its sentences"

requirements-completed: [D-02, D-05, D-06, SC-2]
---

# Phase 178 Plan 05: crosswalk form, B'1 group rule and the B'5 dead-account count check

**The operator runbook now maps probe labels to census labels with a form that was executed on a throwaway cluster, predicts outcomes by the rule the deployed rebuild follows (a dead exchange account is skipped and counted), requires each target's own ordering reading (D-02), and STOPs when the audit's dead-account count differs from P7's.**

## Accomplishments

- `crosswalk` form (after `inflight`, with a short subsection): one `WITH RECURSIVE` statement, marker first, the census `okx_account` CTE and the `user_key` .. `exchange_account` block of `okx-nonworking-keys.sql` byte for byte, then `probe_account`, `predicted` and `snapshot_count`. One row per census label: `census_label`, `probe_label` (or `none`), `probe_accounts_total`, `active_okx_keys`, `active_bybit_keys`, `predicted_okx_members`, `predicted_bybit_members`, `predicted_other_members`, `predicted_zero_contribution_members`, `predicted_non_working_accounts_excluded`, `predicted_window_days`, `snapshot_days`. The subsection states the two-way proof (statement and fingerprint) and the same-UTC-day check of `probe_accounts_total` against the probe summary's `accounts`.
- B'1: the two stale bullets are replaced by the two verbatim group-rule and venue bullets; the predicted window reads P7's `predicted_window_days`; labels ruled `not recomputed (D-06)` are left out of `MS_LABELS` from B'3a on.
- P1: third `git grep` for `account_non_working_accounts_excluded` on each deployed SHA. P4: the OKX-ORDER closure note and the D-02 per-target reading, with `recorded, not recomputed (no ordering reading)` for a target whose OKX members read no trade.
- `audit` form selects `account_non_working_accounts_excluded` right after `account_key_count`; B'5 rule 5 compares it with P7's `dead_exchange_accounts` and `window_days` with P7's `predicted_window_days`; rule 6 STOPs on NULL.
- "Where this stands": a 2026-10-28 section above the 2026-10-27 paragraph, which is marked `(2026-10-27, kept as lineage)` and otherwise unchanged.
- Vitest file: 126 tests (was 118 after plan 02): `crosswalk` added to `EXPECTED_FORMS` and `FORMS_WITH_ACCOUNT_CTE`, a shared-block byte-equality test, and a three-test describe for B'1, audit/B'5 and P1/P4/rule 6/status.

## RED proof

Task 1, Step 1, pins edited first, before any runbook edit (`npx vitest run src/__tests__/marksource-okx-census-sql.test.ts`): `Tests  6 failed | 117 passed (123)`.

```
× holds exactly the pinned forms                                   AssertionError: expected [ Array(7) ] to deeply equal [ 'audit', 'crosswalk', …(6) ]
× read form crosswalk writes nothing and carries no comment        TypeError: Cannot read properties of undefined (reading 'includes')
× form crosswalk ends in one top-level SELECT whose first column is marker_is_prod   TypeError: Cannot read properties of undefined (reading 'match')
× form crosswalk carries the census files' okx_account CTE byte for byte             TypeError: Cannot read properties of undefined (reading 'includes')
× the crosswalk form carries okx-nonworking-keys.sql's key-group block byte for byte (Phase 178 D-02, D-06)
    AssertionError: crosswalk: its predicted counts must come from P7's own grouping, so the user_key .. exchange_account block must equal okx-nonworking-keys.sql byte for byte: expected false to be true
× renders crosswalk with no placeholder left                       AssertionError: form: no form named crosswalk
```

The byte-equality test's vacuity guard (the slice holds `reach AS (`, `group_member AS (` and ends in `),`) passed first, so the failure is the form's absence and not a broken slice.

Task 1, Step 4, byte-equality pin shown to bite after the form existed: one character of the `crosswalk` form's copy of `exchange_account` changed (`THEN 'zero'` to `THEN 'zerx'`, from a byte backup made with `cp -p`), `-t "key-group block byte for byte"`:

```
× the crosswalk form carries okx-nonworking-keys.sql's key-group block byte for byte (Phase 178 D-02, D-06)
AssertionError: crosswalk: its predicted counts must come from P7's own grouping, ... byte for byte: expected false to be true
Tests  1 failed | 122 skipped (123)
```

Restored with `cp -p` from the backup; `cmp` exit 0; the full file back to 123 passed.

Task 2, Step 1, pins edited first, before any runbook edit (`-t "follow the deployed selection"`): `Tests  3 failed | 123 skipped (126)`.

```
× B'1 states the group rule and predicts the venue refusal from P7, with neither stale bullet
  AssertionError: B'1 must say "is skipped and counted, never refused on its own": the deployed rebuild skips and counts a dead exchange account (D-05): expected false to be true
× the audit form selects account_non_working_accounts_excluded and B'5 rule 5 compares it with P7's dead_exchange_accounts
  AssertionError: the audit form must select account_non_working_accounts_excluded: B'5 compares it with P7: expected false to be true
× P1 checks the D-05 fix, P4 requires each target's own ordering reading, rule 6 stops on a NULL count (D-02, D-05, D-06)
  AssertionError: P1 must check the deployed SHA carries the D-05 fix: expected false to be true
```

The B'1 test stops at its first missing required phrase, so its two stale-bullet assertions were not reached in that run. They were shown live separately: at the base text, `grep -acF` of the two forbidden literals in the runbook printed `2` (both present), and after the edit the plan's verify `grep -aqF` negations hold.

## Local execution

`crosswalk-lane: gate exit 0; neutered gate exit 3`. Run on a throwaway local PostgreSQL through the pg-lane (`--apply` fixture, `--gate` gate); nothing touched TEST or PROD. The form was rendered by the runbook's own `form.mjs` (extracted from the runbook as `writeRenderer` does), wrapped as `CREATE TEMP TABLE xw AS ...`, and checked by a gate of 38 (census label, column, expected value) triples plus a row count of 5. The fixture held stand-in `api_keys` and `allocator_equity_snapshots` with only the columns the form names and six owners created in order: a Bybit-only owner; census `a1` (working OKX, revoked unmarked Bybit, 10 snapshot days); `a2` (revoked OKX, working Bybit); `a3` (working OKX, revoked sfox, working Deribit); `a4` (one inactive OKX key); `a5` (working OKX, working MT5). Proven: census `a1` to `a5` map to probe `a2`, `a3`, `a4`, `none`, `a5`; `probe_accounts_total` 5 on every row; `marker_is_prod` 0; the predicted counts and windows listed in the plan.

Neutered gate (one expectation flipped, `a1` `predicted_non_working_accounts_excluded` 1 to 0): exit 3, `label a1 column predicted_non_working_accounts_excluded: expected 0, got 1`. One mutation of the statement itself (a dead exchange account classed `crawled`) was also caught, exit 3: `label a1 column predicted_bybit_members: expected 0, got 1`. Scratch directory deleted after Task 1's commit and confirmed gone; Task 2's verify checked it.

## Gates

- `npx vitest run src/__tests__/marksource-okx-census-sql.test.ts`: 126 passed.
- `npm run -s check:planning-hygiene`: exit 0.
- Task verifies: `CROSSWALK_OK` and `B1_B5_OK`; `account_non_working_accounts_excluded` appears 5 times in the runbook (threshold 3).
- `pytest tests/test_allocator_history_probe.py -k runbook_names_the_code_derived` from `analytics-service/`: 1 passed. That test reads the runbook's P4 entry and the "Until the probe's summary `okx_order_gate` reads `ok`, pre-flight P4 is a write STOP" sentence, both of which this plan edited around; it is why the 2026-10-27 paragraph stays verbatim.
- PROHIBITION holds: no census file, and none of the `enqueue`, `newjob`, `inflight`, `pollafter`, `rebuildfn` or `marker` forms changed; no write word, `--`, uuid, home path or planning-directory path in any form; no SQL against TEST or PROD; no fixture or gate committed. `STATE.md` and `ROADMAP.md` untouched.

## Deviations from Plan

None that change behaviour. Notes on form:

- The plan asked for two tests in Task 2; a third was added (P1 third check, P4 D-02 reading and zero-trades label, rule 5's `predicted_window_days`, rule 6's NULL STOP, the lineage mark) so those edits are pinned too, and it was seen RED with the other two.
- The "predicted-window" sentence in B'1 and the "labels ruled not recomputed" sentence are list bullets, matching the list they sit in.
- `SEQUENTIAL=true` was applied to the commit guard (linked phase worktree on `feat/178-okxrewrite`); the project root pin was run before the first write and before each commit.
- Commits carry no attribution trailer, per the project rule.

## Known Stubs

None.

## Threat Flags

None. The new form is read-only, guarded by the existing form rules, and prints labels and counts.

## Self-Check: PASSED

- Files: `docs/runbooks/marksource-okx-history-correction.md` and `src/__tests__/marksource-okx-census-sql.test.ts` FOUND and in `git diff` from the recorded base.
- Commits: `c8063e9ee` (crosswalk) and `9b276a14b` (B'1 / B'5) are ancestors of HEAD; `git rev-list --count` from the recorded base reports 2.
- Scratch directory absent.
