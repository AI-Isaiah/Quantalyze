---
phase: 176-legacyretire
review: PR 2, round 1
reviewed: 2026-11-01T15:07:37Z
reviewed_at_sha: 8f30f6db7a0d2a4295700c49246e80d5a951cf2d
diff: "git diff b80057dab..HEAD -- . ':!.planning'"
depth: deep
files_reviewed: 59
files_reviewed_list:
  - analytics-service/services/equity_reconstruction.py
  - analytics-service/services/job_worker.py
  - analytics-service/scripts/allocator_history_probe.py (deleted)
  - analytics-service/scripts/e2_allocator_ground_truth.py (deleted)
  - supabase/migrations/20261103120000_request_allocator_holdings_sync_no_reconstruct.sql
  - supabase/migrations/down/20261103120000-rollback.sql
  - supabase/schema/functions/request_allocator_holdings_sync.sql
  - supabase/tests/test_api_keys_history_reconstruct_marker.sql
  - src/app/api/allocator/holdings/sync/route.ts
  - scripts/mutation-floors.mjs
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/marksource-okx-census-sql.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - docs/runbooks/flipretry-derived-equity-go-live.md
  - docs/runbooks/ledger-refresh-go-live.md
  - docs/runbooks/marksource-legacy-chain-move-go-live.md
  - docs/runbooks/marksource-okx-census/README.md
  - docs/runbooks/marksource-okx-history-correction.md
  - docs/runbooks/navmtm-chain-move-go-live.md
  - TODOS.md
  - analytics-service/tests/ (38 files: 14 deleted, 24 pruned or edited, 1 new)
findings:
  critical: 0
  high: 0
  medium: 1
  low: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 176: PR 2 Code Review Report (round 1)

**Reviewed:** 2026-11-01T15:07:37Z
**Depth:** deep (cross-module AST import tracing)
**Files Reviewed:** 59
**Status:** issues_found

## Summary

PR 2 removes the legacy engine. Its core claims hold up when measured directly:

- **No deleted symbol is reachable.** I ran an AST walk over every `.py` under `analytics-service/`, including tests and scripts. It checked every `from services.equity_reconstruction import X`, every `er.X` attribute on a module alias, every `"services.equity_reconstruction.X"` patch string, and every `setattr(er, "X")` / `patch.object(er, "X")`. It found 0 references to a name the module no longer defines. The only string-name hits are `tests/test_equity_reconstruction.py:539,544`, two dead `raising=False` setattrs. No `importlib` or dynamic `getattr` reaches the module. `git grep` over `.github/`, `package.json`, `scripts/` and `src/` finds no live reference to the two deleted scripts or the deleted job bodies. The only hits are comments and lineage prose.
- **The survivors are unchanged.** All 64 surviving top-level definitions in `equity_reconstruction.py`, the 10 keep-list helpers among them, have source segments byte-identical to `b80057dab`, compared with `ast.get_source_segment`. Only the import block changed. `mypy` (strict config) is clean on `equity_reconstruction.py` and `job_worker.py`.
- **The no-op stub works.** `dispatch` routes both kinds to `run_retired_allocator_equity_job` (`job_worker.py:15911-15934`, `:15990-15993`), which returns `DONE`. The worker's normal mark-done path then terminalizes the row. Nothing stays pending, and an in-flight unique index never stays held.
- **The migration and rollback are correct.** I extracted the function bodies and diffed them. The new body equals the newest prior definer (`20261014120000`, section 5) minus exactly the two declarations, the gate comment, the probe, the marker read and the guarded enqueue. The rollback body is IDENTICAL to the `20261014120000` body, and the rollback's function COMMENT is byte-equal to it. ACL, `SECURITY DEFINER` and the `search_path` pin are re-issued. The generated `supabase/schema/functions/request_allocator_holdings_sync.sql` matches the new body.
- **The test deletions are legitimate.** For every surviving symbol I compared which test functions referenced it at base and at HEAD. Every removed test that touched a surviving symbol (`_fetch_current_equity`, `_api_key_already_reconstructed`, `_fanout_would_still_retry`, `_cache_coingecko_prices`) was driving a deleted body. The live refusal arms of `read_marked_equity_usd` → `_fetch_current_equity(refuse_unread_positions=True)` stay covered by `test_nav_marks_l4_read.py:433-439,830,1069` and `test_nav_marks_bybit_uta.py:208`.
- **Targeted runs:**
  - Eight pytest files: retired-kinds, equity_reconstruction, the three cap files, curve builder, upnl_venues, nav_marks_l4_read. 118 passed.
  - Full pytest collect: 13,221 collected, 0 errors.
  - Four changed vitest files: 398 passed.

The one MEDIUM is user-facing. PR 2 takes away the only path that ever cleared the capped-history note. The rest are stale prose and two dead survivors.

## Warnings

### MD-01 (MEDIUM, user-facing): the "history could not be rebuilt" note becomes permanent and false for every already-capped key

**File:** `supabase/migrations/20261103120000_request_allocator_holdings_sync_no_reconstruct.sql:71-138` together with `src/lib/queries.ts:4746-4762` and `src/app/(dashboard)/allocations/AllocationDashboardV2.tsx:196-197,362-372`

**Issue:** `historyReconstructFailed` is true for a key with `history_reconstructed_at IS NULL` and `history_reconstruct_attempts >= 5` (`queries.ts:4754-4755`). It renders "The history of at least one connected account could not be rebuilt after repeated attempts. The curve shows what was recorded."

Before PR 2 the note could clear itself. The user RPC never checks the cap, so a capped key's next holdings sync enqueued a fresh reconstruct (old body: marker NULL and nothing in flight ⇒ enqueue). A successful run then stamped the marker.

PR 2 removes that enqueue (migration) and makes the handler a no-op (plan 08). Plan 12 unschedules the fan-out. So no code path can stamp the marker or reset the counter any more. The note is now permanent for every key capped at deploy time, and its premise is false: since PR 1 the curve is the derived series, not "what was recorded" by a rebuild.

`TODOS.md` books the TS note as inert under `176-RECONSTRUCT-CAP-MARKER-INERT`, but with **no owner** ("unowned. Trigger: the next phase that touches `api_keys`…"). So nothing schedules its removal.

**Failure scenario:** an allocator whose OKX key hit the cap in October opens the Overview after PR 2 deploys. They see the "could not be rebuilt" note above a correct, derived curve, and pressing sync no longer clears it, as it could before.

Count unmeasured: the number of such keys on PROD was not read. Read-only form:

```sql
SELECT count(*) FROM api_keys
 WHERE history_reconstructed_at IS NULL AND history_reconstruct_attempts >= 5
   AND is_active AND disconnected_at IS NULL;
```

**Fix (smallest):** stop rendering the note. Pass `historyReconstructFailed={false}`, or delete the `{historyReconstructFailed && !isRebuilding && …}` arm at `AllocationDashboardV2.tsx:196-198`. Delete `readReconstructInFlightKeyIds` / `historyReconstructCappedKeyIds` in the same change, or leave them for the booked sweep. If the founder prefers to keep the component until the sweep, at least give `176-RECONSTRUCT-CAP-MARKER-INERT` an owner and a date, because a user-facing false statement should not sit "unowned".

## Low

### LW-01 (LOW): "without a database call" is not true for a real reconstruct job

**File:**
- `analytics-service/tests/test_legacy_allocator_jobs_retired.py:48-73`
- `analytics-service/services/job_worker.py:16057-16073`
- `supabase/migrations/down/20261103120000-rollback.sql:13-17`

**Issue:** The two retirement tests dispatch a job with no `api_key_id`, so the cap hook short-circuits at `job_worker.py:15768-15771` and `get_supabase` is never called. Every real `reconstruct_allocator_history` row carries an `api_key_id`. For those, the hook reads `api_keys` after the stub returns DONE. When the key is capped and unmarked, it also raises a Sentry event tagged `history_reconstruct_outcome=capped`.

**Scenario:** the old RPC body, still live until the migration applies, enqueues a reconstruct for a capped key. The new worker finishes it as a no-op, and Sentry receives a "capped" event for a retired job. The noise is one-off and bounded, but the test docstring and the rollback header ("finishes the job DONE without a database call") overstate it.

**Fix:** add an `api_key_id` to one of the two test jobs and assert the hook's single `api_keys` read (or patch `_capture_history_reconstruct_capped` and assert it ran). Reword the two docstrings to say the stub itself makes no call.

### LW-02 (LOW): stale prose naming deleted code

**Files:**
- `analytics-service/services/job_worker.py:15924-15925`: "The old crawl and refresh code is deleted by a later plan of the phase". Plan 11 has already deleted it.
- `analytics-service/services/job_worker.py:15996-15997`: "Lazy import mirrors the equity_reconstruction pattern above". That pattern no longer exists above.
- `analytics-service/services/equity_reconstruction.py:399-407`: the docstring of the still-live `ForcedRebuildRefusedError` (raised by `_fetch_current_equity`, caught by `read_marked_equity_usd`) names the deleted `run_reconstruct_allocator_history_job`, `FORCED_REBUILD_REFUSAL_REASONS` and `_forced_refusal_result`.
- `analytics-service/services/price_rule.py:33,65-67`: says `PRICE_GAP_MAX_DAYS` is "coupled by an equality test" to `equity_reconstruction.CARRY_AGE_CAP_DAYS`. Both the constant and the test (`test_price_gap_max_days_coupled_to_carry_cap`) are deleted. No test now pins `PRICE_GAP_MAX_DAYS` (`git grep PRICE_GAP_MAX_DAYS -- analytics-service/tests` returns 0 hits). Its only users, `close_on_or_before` and `gap_holds_the_day`, are orphans already booked in TODOS.
- `analytics-service/services/broker_dailies.py:974`: names `run_reconstruct_allocator_history_job` as a caller.

**Fix:** re-word each to the post-176 truth. `ForcedRebuildRefusedError` is not on the keep-list, so editing its docstring breaks no pin.

### LW-03 (LOW): two dead survivors the fixpoint missed

**File:** `analytics-service/services/equity_reconstruction.py:50` (`RAW_PAYLOAD_CAP_BYTES`), `:86-91` (`_map_exception_to_sync_status`)

**Issue:** Neither has a reference anywhere: not in the module, not in production code, not in a test. `job_worker.py:12687` imports `_map_exception_to_sync_status` from `services.allocator_positions`, and `allocator_positions.py:130` defines its own `RAW_PAYLOAD_CAP_BYTES`. The plan 11 fixpoint matched by bare name, so a same-named symbol in another module made these read as live. D-08 says "delete the old engine in full", and these are copies left from it.

**Fix:** delete both, or add them to the TODOS orphan list. Also note in the SUMMARY that the fixpoint conflates same-named symbols across modules, so a future reader does not trust its "dead" set as complete.

### LW-04 (LOW): deletion residue in a test file

**File:** `analytics-service/tests/test_equity_reconstruction.py:538-544,560-565`

**Issue:** `_install_fake_preflight` still patches `er._allocator_key_preflight` and `er.get_supabase` with `raising=False`. The module no longer has either name, so both setattrs silently patch nothing. Lines 560-565 are an orphaned comment block ("# Day 2: SYMX still held …") left from a deleted test.

**Fix:** drop the two `raising=False` lines and the orphan comment.

## Info

### IN-01: the no-op kinds keep 30-minute and 3-minute timeouts

`job_worker.py:907-908` and `main_worker.py:355` keep timeouts and a stall override for kinds whose handler is instant. They are harmless and already listed in `176-RECONSTRUCT-CAP-MARKER-INERT`.

### IN-02: cap-noise ordering depends on plan 12 running before the deploy

While `refresh-allocator-equity` stays scheduled, each run enqueues a reconstruct for every owed key and adds one to `history_reconstruct_attempts` (`20261021120000…sql:362,408`). With the stub stamping nothing, each owed key would reach the cap in at most 5 daily runs, and then the hook would fire one Sentry event and the fan-out a daily `history_reconstruct_capped` `cron_runs` error row. Plan 12 unschedules the cron before PR 2's final CI run, so this does not happen if that order holds. Keep it: do not merge PR 2 before the unschedule is read back as 0 jobs.

---

_Reviewed: 2026-11-01T15:07:37Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_


## Fix round 1

**Fixed:** 2026-11-01. Scope (founder 2026-10-17): minimal fix only, MEDIUM and above, no LOW or INFO, no new abstractions or defensive checks.

| Finding | Status | Commit |
|---|---|---|
| HIGH (migration review): no VAC-04 prod-body-ack on `20261103120000` | fixed | `45788940d` |
| MD-01 / silent-failure 1 (false, permanent "could not be rebuilt" note; cap hook fires for the retired kind) | fixed | `ba365fe53` (note), `f084c2508` (TODOS wording), `a41f13652` (hook) |
| silent-failure 2 (`force_rebuild` row reported DONE) | fixed | `a41f13652` |
| silent-failure 3 (no dispatch test with a capped, unmarked `api_key_id`) | fixed | `a41f13652` |

- **HIGH.** Added a VAC-04 ACKNOWLEDGEMENT block at the top of the migration, `prod-body-ack: 1f3190144ca0...6edb7f`. Measured with `scripts/sql-body-normalize.mjs --diff-bodies` against `origin/main:supabase/schema/baseline.sql`: the 20261014120000 migration reads MATCH at that hash, and the PR migration reads DRIFT with the same `live` hash (the intended overwrite). Plan 09's SUMMARY sentence that no ack was needed is corrected with a dated note and kept as lineage.
- **MD-01.** The note's render arm, its `HistoryReconstructFailedNote` component and the prop default were deleted from `AllocationDashboardV2.tsx`. The payload field `historyReconstructFailed` and its query tests are left in place, inert, for the booked sweep (`176-RECONSTRUCT-CAP-MARKER-INERT`); TODOS names the component as already removed. `dispatch` no longer runs `_capture_history_reconstruct_capped` for the reconstruct kind; the function stays (the orphan sweep still calls it).
- **silent-failure 2.** `run_retired_allocator_equity_job` logs a WARNING and returns FAILED with `error_kind="permanent"` when `metadata.force_rebuild` is truthy. A plain queued row still ends DONE.
- **Tests (RED before, GREEN after).** `AllocationDashboardV2.history-reconstruct-failed.test.tsx` (the flagged ready curve renders no note: RED on the old component, 3 passed after). `test_history_reconstruct_cap_event.py` was rewritten to the real-dispatch case with a capped, unmarked `api_key_id`, both a queued and a forced row (RED: one `capture_message` call; GREEN after). `test_legacy_allocator_jobs_retired.py::test_a_force_rebuild_job_fails_permanent_and_warns_instead_of_reporting_done` (RED: outcome DONE; GREEN after).
- **Gates.** Full pytest from `analytics-service/` with `.venv`: 13117 passed, 97 skipped. mypy (CI line verbatim): no issues in 131 files. `npm run typecheck` and `npm run lint`: clean. Vitest: drift-check-scripts, mutation-runner-floors, the two history-reconstruct twin tests, `queries.test.ts`, `queries.my-allocation.test.ts` and the allocations directory: 163 files, 4139 tests passed. `lint-sql-gates`: 0 findings. `lint-migration-data-dependence`: 0 NEW. `lint-app-guc`: 0 findings. `baseline-content-drift` still reports its 4 expected rows (cleared by the post-apply baseline re-dump, not here).
- **Not done, by scope.** LW-01 to LW-04 and IN-01, IN-02 (the IN-02 ordering rule still stands: do not merge PR 2 before the plan 12 unschedule reads back as 0 jobs). `report_orphaned_capped_reconstructs` (the orphan sweep) can still raise the capped event for a reconstruct job that an hourly pg_cron sweep terminalized as orphaned; no such job can be created by the stub (it finishes instantly), so it was left alone.
