---
status: passed
verified_at_sha: 9397f1045cdaf28d7155d022b06796866ab911b7
drift_subjects:
  - analytics-service/services/job_worker.py
  - analytics-service/services/account_identity.py
  - analytics-service/services/allocator_equity_derive.py
  - analytics-service/tests/test_derive_allocator_equity_job.py
  - analytics-service/tests/test_holder_matrix_parity.py
  - analytics-service/tests/test_account_identity_stamper.py
  - analytics-service/tests/fixtures/derive_refusal_rows.json
  - analytics-service/tests/fixtures/shared_account_resolution.json
  - src/lib/queries.ts
  - src/lib/account-share-note.ts
  - scripts/accounttruth-census.mjs
---

# Phase 183: DUPCOUNT Verification Report

**Phase Goal:** A book whose marked duplicate key is already counted once by the derive's account-group resolution draws its equity curve instead of refusing it. A real double count, with two counted keys reading one account, still refuses.
**Verified:** 2026-11-02, at `9397f1045cdaf28d7155d022b06796866ab911b7` (branch `feat/183-dupcount`)
**Status:** passed
**Re-verification:** No, initial verification

## Success Criteria (ROADMAP contract)

| SC | Verdict | Evidence |
|----|---------|----------|
| SC-1: a marked duplicate whose account the group resolution counts once no longer refuses; two counted keys on one account still refuse | VERIFIED | `job_worker.py` `run_derive_allocator_equity_job`: the `duplicate_keys` list and its `ACCOUNT_DUPLICATE` branch are deleted; the gate is `if collisions:` with `ACCOUNT_IDENTITY_COLLISION` only. The group loop (`account_groups`, `excluded_shared`, `counted_ids`) is untouched and counts each marked pair once (a group with no working member still keeps one key). Collisions are still computed over `counted_rows` plus anchored departed keys through `account_identity_tokens`. Mutation M1 (collision gate neutered to `if False and collisions`): 6 tests RED (`test_two_keys_same_venue_without_marker_collide`, `test_duplicate_with_revoked_holder_is_a_collision`, `test_duplicate_with_disconnected_holder_is_a_collision`, `test_identity_collision_persists_its_refusal_reason`, and the two Sentry/WARNING collision parametrisations). Mutation M2 (old marked-duplicate refusal reinstated): 8 tests RED, including `test_duplicate_with_working_holder_is_counted_once_and_drawn`, the PROD-shaped Deribit+MT5 book test and 3 `test_holder_matrix_parity` cells. File restored byte-identical (`cmp`). |
| SC-2: writer and reader apply the same rule (`job_worker.py` and `countsAsDuplicate` in `queries.ts`) | VERIFIED | `countsAsDuplicate` is deleted and the key-list `duplicate_account` arm is gone from `equityHistoryReadiness`; `grep` finds no remaining `countsAsDuplicate`, `duplicate_keys` or `ACCOUNT_DUPLICATE` in `services/`, `routers/`, `src/`, `scripts/`. The reader keeps the stored-token path: `untrustworthyRebuildReason` still maps `account_duplicate` (stale pre-183 row) and `account_identity_collision` to `duplicate_account` (`queries.ts:4558`). Both runtimes assert one table, `shared_account_resolution.json` (`test_holder_matrix_parity.py` and `holder-matrix-parity.test.ts`). The census twin (`accounttruth-census.mjs`) drops `duplicate.blocking` and the key-list arm, and its real-PG test passes (54 tests). Reader mutation (key-list duplicate arm reinstated): 29 tests RED across `queries.test.ts`, `queries.my-allocation.test.ts`, `holder-matrix-parity.test.ts`. Restored (`cmp`). |
| SC-3: tests go RED on the current refusal | VERIFIED | Each plan's RED commit precedes its fix commit (`d84ff6f06` before `2ae46a58b`, `2bc2e8e49` before `59f3632ef`, `84355a868` before `69afde601`, `434a533fc` before `5ccbd6c20`, `14207595b` before `8b105ca12`). I re-ran the equivalent by reinstating the refusal (M2 above) and got RED on the draw path; I neutered the collision branch (M1) and got RED on D-01's "still refuses" half, so both gates can fail. |
| SC-4: after deploy, a PROD reading shows 0 `account_duplicate` rows, the book has a trustworthy curve, QUANTALYZE-2H stops recurring | VERIFIED on the recorded reading (not re-read by me) | `183-04-SUMMARY.md` records `sc4-met: yes`: deploy of the merge bound to Railway `/health` sha `6e01c254` (a descendant of the merge) and the Vercel production deploy, both before the 2026-11-02 01:31Z derive; `account-duplicate-rows: 0`; `dupcount-population: owners=1 ... trustworthy_v2=1 refused=0 counted_once_flag=1 derived_after_deploy=1 identity_pending=0`; census `d` 7/7 version 2 trustworthy, `e` 7/7 ready; QUANTALYZE-2H has no event since the deploy. The marker query was run first and named PRODUCTION; every statement was a SELECT. My session had no PROD `execute_sql` tool, so I did not repeat the reading; I judged the SUMMARY's reading specific, internally consistent and consistent with the code (the retired gate cannot write the token) rather than a bare claim. The records edits in `9397f1045` (ROADMAP Phase 166.5.1 SUPERSEDED note, Phase 183 CORRECTED note, runbook notes) are present. |

## Additional must-haves checked

| Must-have | Verdict | Evidence |
|-----------|---------|----------|
| D-01 vocabulary: `account_duplicate` retired from `DeriveRefusal` and pinned as legacy | VERIFIED | `allocator_equity_derive.py` has no `ACCOUNT_DUPLICATE`; `derive_refusal_rows.json` carries it under `legacy_refusals` (line 193); `test_derive_refusal_rows.py` and `derive-refusal-rows.test.ts` consume it; stored-row tokens still read through `queries.test.ts:1727`. |
| D-02 share note says "We count that account once." with no remedy | VERIFIED | `account-share-note.ts` returns `... We count that account once.`; `AccountShareNoteAction` and the `action` parameter are removed; both cards (`AllocatorExchangeManager.tsx`, `ApiKeyManager.tsx`) updated; their tests pass. Working-holder / absent-holder / WR-02 silence conditions are kept. |
| D-03, D-04 non-change | VERIFIED | The diff against `origin/main` touches nothing under `src/app/`; `duplicate_shared_account_counted_once` is read by no non-test file in `src/`; `AllocationDashboardV2.rebuilding.test.tsx` passes. |
| D-05 recompose inside the running job when a marker changed | VERIFIED | Step 5a in `job_worker.py` re-reads the keys' `(id, holder, kind)` tuples just before the curve save, redoes once with `_markers_rechecked=True`, and on a second change returns `FAILED/transient` with no curve saved (round-3 fix `a0f166c54`). Mutation: the 5a block disabled makes `test_a_marker_that_lands_mid_compose_is_recomposed_before_the_curve_is_saved` and `test_a_marker_that_lands_during_the_redo_ends_transient_without_a_curve` RED. Restored (`cmp`). `account_identity._write_marker_and_audit` also enqueues the owner's recompose after a new marker (WR-01), logged at ERROR on failure. |

## Behavioral and gate evidence

| Check | Result |
|-------|--------|
| `pytest` (from `analytics-service/`): `test_account_identity_stamper`, `test_derive_allocator_equity_job`, `test_derive_refusal_rows`, `test_holder_matrix_parity` | 362 passed |
| `pytest tests/test_job_worker*.py` | 184 passed, 1 skipped |
| `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (CI line) | Success, no issues in 131 files |
| `vitest` on queries (3 files), holder-matrix-parity, derive-refusal-rows, account-share-note, `src/components/exchanges`, `ApiKeyManager`, `AllocationDashboardV2.rebuilding` | 13 files, 911 passed |
| `vitest src/__tests__/accounttruth-census.test.ts` | 54 passed |
| Working tree after the mutation probes | clean (`git status --short` empty; backups `cmp`-identical) |

## Requirements coverage

ROADMAP lists `Requirements: TBD`; the PLANs name phase-local ids (SC-1..SC-4, D-02). None exist in `REQUIREMENTS.md`, so there is nothing to cross-reference and nothing orphaned. Each id maps to the SC rows above.

## Anti-patterns

No `TBD`/`FIXME`/`XXX` debt markers were found in the diff's non-planning files by the debt-marker scan I ran over the changed source (none flagged; the new comments cite phase and review ids). No stubs: the changes remove a refusal and add real code paths with tests that fail when neutered.

## Review state

`183-REVIEW.md` ran three rounds. WR-01 (a stale double-counted curve until the next compose), WR-R3-01 (second marker during the redo) and WR-R3-02 (re-read position pin) were fixed and RED-proven (fix rounds 1 to 3). WR-02 (runbook and C5 VERIFY item gating on the deleted census bucket) is closed by the dated notes in `9397f1045`. Left open on purpose, recorded in the review: a marker that commits after the final re-read and before the upsert still stores the double count until the next derive (bounded, about a day); IN-R3-01 to IN-R3-03 are INFO. The WR-R2-01 known-limit line is still owed to the CHANGELOG at ship. The round-3 fix was not followed by a fourth review round; I read its code and the tests that pin it and found no defect.

## Sentry

`183-04-SUMMARY.md` ends with `sentry-resolve-list: QUANTALYZE-2H, QUANTALYZE-23` because its Sentry MCP was read-only. Noted per the orchestrator: both issues were marked resolved in Sentry on 2026-11-02 by the orchestrator, with the founder's authorization. The SUMMARY itself is unedited.

## Human verification

None required. SC-4 is a PROD reading the orchestrator already took; the only caveat is that I did not independently repeat it.

## Gaps

None.

---

_Verified: 2026-11-02_
_Verifier: Claude (gsd-verifier)_
