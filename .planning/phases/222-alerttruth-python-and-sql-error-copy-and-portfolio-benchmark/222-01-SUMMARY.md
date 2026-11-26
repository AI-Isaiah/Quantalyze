---
phase: 222-alerttruth-python-and-sql-error-copy-and-portfolio-benchmark
plan: 01
subsystem: database
tags: [postgres, migration, computation_error_copy, csv-finalize, vitest, mutation-runner]
requires: []
provides:
  - "computation_error_copy permanent, transient, unknown and ELSE arms name the contact form; orphaned byte-identical"
  - "csv-finalize ENQUEUE_LOST_RACE_USER_COPY in byte parity with the SQL ELSE arm, proved by a test that reads the generated snapshot"
  - "snapshot-wide pin: every arm contains no legacy support pointer, the four channel arms contain `contact form`"
affects: [222-ERRC-01, ship PR for phase 222]
status: complete
actuals:
  tokens: 40000
  tasks: 3
  commits: 3
plan_head_before: 94f1fc0b3a748c5b715e1235bb55789e879283cd
plan_head_after: e32862947f754198265389220b36a0d612c0d2aa
tech-stack:
  added: []
  patterns:
    - "oracle parsed from the @generated function snapshot at module scope (throws on a parse miss)"
    - "newest migration frame: no explicit transaction statements, SET LOCAL lock_timeout, catalogue-only DO $verify$ with single-literal RAISE format strings"
key-files:
  created:
    - supabase/migrations/20261125212222_computation_error_copy_contact_form.sql
    - supabase/migrations/down/20261125212222-rollback.sql
  modified:
    - supabase/schema/functions/computation_error_copy.sql
    - supabase/tests/test_sync_status_curated_sentence_survives.sql
    - supabase/tests/test_sync_status_marked_refresh_protected.sql
    - src/app/api/strategies/csv-finalize/route.test.ts
    - src/app/api/strategies/csv-finalize/route.ts
    - "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.composite.render.test.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.render.test.tsx"
key-decisions:
  - "transient and unknown arms are DERIVED by mechanical substitution of the locked phrase (RESEARCH A1, UI-SPEC U2)"
  - "the parity gate test_compute_jobs_error_kind_copy_parity.sql is untouched and does not load the new migration (its RED-UNDER-M arms mutate the old file)"
requirements-completed: [ERRC-01]
---

# Phase 222 Plan 01: computation_error_copy names the contact form Summary

One re-basing migration moves the four channel-offering `computation_error_copy` arms from the legacy support pointer to the contact form (orphaned byte-identical), and csv-finalize's lost-race copy is back in byte parity with the SQL ELSE arm through a test that parses the generated snapshot.

## What was done

| Task | Commit | Result |
| ---- | ------ | ------ |
| 1 (tracer) migration, rollback, snapshot, csv-finalize oracle | cf16dd920 | oracle parsed from the snapshot, RED then GREEN; migration linted and snapshotted |
| 2 both SQL gates + lane + mutation lane | 6043467d3 | literals and RED-UNDER-SETUP moved; gates pass on the live lane and the pg-lane, every arm bites |
| 3 snapshot-wide pin + fixtures that quote the SQL | e32862947 | pin RED on a neutered snapshot, then GREEN; fixtures and route.ts comment refreshed |

Nothing was pushed, no PR opened, no remote database touched (`supabase db push`, `--linked`, `--project-ref`, `--db-url` never used).

## PROOF-01 records (verbatim)

### Task 1 — csv-finalize parity, RED on pre-fix code

Oracle replaced by the snapshot-parsing IIFE, snapshot still carrying the legacy ELSE arm:

```
 ❯ |node| src/app/api/strategies/csv-finalize/route.test.ts (21 tests | 1 failed) 37ms
   ❯ [WR-07] csv-finalize: a lost enqueue race tells the OWNER something true (5)
     × a 40001 lost race → the owner reads curated copy: no operator jargon, no SQL text, no promise of an automatic retry 7ms
AssertionError: expected 'Analytics could not complete for this…' to be 'Analytics could not complete for this…' // Object.is equality

Expected: "Analytics could not complete for this strategy. Retry the sync, or contact support if this persists."
Received: "Analytics could not complete for this strategy. Retry the sync, or use the contact form if this persists."
 ❯ src/app/api/strategies/csv-finalize/route.test.ts:912:18
 Test Files  1 failed (1)
      Tests  1 failed | 20 passed (21)
```

GREEN after the migration and `npm run schema:functions`:

```
 Test Files  1 passed (1)
      Tests  21 passed (21)
```

Other Task 1 verifies: `npm run schema:functions:check` -> "SQL function snapshot is current (142 functions)."; `lint-migration-data-dependence`: "corpus 337 migration(s), 419 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW."; `raise-exception-concat-grammar.test.ts`: 2 passed.

### Lane boot — replay line

`bash scripts/local-stack/run.sh up` (private loopback lane; handoff asserted loopback with `--assert-local-handoff`):

```
baseline-replay: 1 migration(s) newer than the dump: 20261125212222_computation_error_copy_contact_form.sql
...
psql:.../20261125212222_computation_error_copy_contact_form.sql:205: NOTICE:  Migration 20261125212222: computation_error_copy names the contact form in every channel-offering arm; orphaned is unchanged; the ACL is service_role only.
[local-stack] replayed 20261125212222_computation_error_copy_contact_form.sql (ledger row written)
[local-stack] replay complete: 1 migration(s) applied on top of the dump
[local-stack] up complete
```

(The replay also printed `WARNING: SET LOCAL can only be used in transaction blocks` at line 71, because psql replays outside the CLI's per-migration transaction wrap. Same as every migration in the newest frame; harmless.) The self-verify block ran and passed inside the apply.

The three gates run with psql against the lane DB, all clean:
- `test_sync_status_curated_sentence_survives.sql`: `ALL 7 ARMS EXECUTED (S1, C1, O1, D1, P1, PC1, R1)`
- `test_sync_status_marked_refresh_protected.sql`: `ALL 35 ARMS EXECUTED (A, B, C, ...)`
- `test_compute_jobs_error_kind_copy_parity.sql` (untouched): `Part 1 OK`, `Part 2 OK`, `Part 3 OK`, `ALL PARTS OK.`

### Task 2 — mutation runner, GREEN with the new migration in RED-UNDER-SETUP

```
curated:  arms: 8/8/0 | biting: 8 | lane-invocations: 8 | No defects in the narrowed scope. | exit=2
marked:   arms: 1/1/0 | biting: 1 | lane-invocations: 1 | No defects in the narrowed scope. | exit=2
```

### Task 2 — baseline-red, new migration deleted from RED-UNDER-SETUP (pre-fix body on the pg-lane)

Curated gate:

```
arms: 0/8/0   (executed/annotated/waived)
biting: 0
❌ 1 defect(s):
      pristine corpus did not go GREEN (exit 3); first failure: C1
cmp: restored byte-identical (curated_sentence_survives)
```

Marked gate (runner output):

```
arms: 0/1/0   (executed/annotated/waived)
biting: 0
❌ 1 defect(s):
      pristine corpus did not go GREEN (exit 3); first failure: none
cmp: restored byte-identical (marked_refresh_protected)
```

DEVIATION on the marked gate's expected name: the plan expected "first failure: A". The runner prints `none` here, because its diagnostic reader (`identityRe()` on the baseline leg, a plain-text needle by its own comment) does not recognise this gate's `ARM A FAILED:` raise format. The gate DID go red on the pre-fix body, which is the claim PROOF-01 needs, and I recorded which arm directly: I applied the rollback file to the LOCAL lane database (loopback, throwaway) and ran the gate with psql:

```
psql:supabase/tests/test_sync_status_marked_refresh_protected.sql:1498: ERROR:  ARM A FAILED: computation_error is Analytics could not complete for this strategy, and retrying alone will not resolve it. Contact support if you need this strategy computed. — a protected refresh failure must stay VISIBLE (the curated sentence for a permanent failure), not silent and not raw.
```

Re-applying the migration to the lane then gave `ALL 35 ARMS EXECUTED (A, B, C, ...)`. This also exercised the rollback file end to end (its precondition, body, ACL pair and verify block ran clean). Both gate files were restored from byte backups in the scratchpad with `cp` and a silent `cmp`; the runner was re-run to GREEN afterwards:

```
curated: arms: 8/8/0, biting: 8, lane-invocations: 8, No defects in the narrowed scope.
marked:  arms: 1/1/0, biting: 1, lane-invocations: 1, No defects in the narrowed scope.
```

### Census (Task 2 step 8)

`mutation-runner-floors`, `lint-sql-gates`, `mutation-annotation-parser`, `gate-family-meta` tests: 4 files, 336 tests passed. `node scripts/mutation-runner/run.mjs --parse-only`: "No static defects." **No census value moved** (a setup entry adds no arm and no file). `check-baseline-currency.mjs --replay-set` names the new migration (count 1). Parity gate diff against the base: unchanged.

### Task 3 — snapshot-wide pin, RED on a neutered snapshot

Neuter: `Use the contact form if you need this strategy computed.` replaced by `Contact support if you need this strategy computed.` in the permanent arm of `supabase/schema/functions/computation_error_copy.sql` (backup in the scratchpad):

```
 ❯ |node| src/app/api/strategies/csv-finalize/route.test.ts (36 tests | 2 failed) 41ms
   ❯ every computation_error_copy arm names the contact form (15)
     × the permanent arm never carries the legacy support pointer 5ms
     × the permanent arm names the contact form 2ms
AssertionError: arm permanent carries the legacy support pointer: expected 'Analytics could not complete for this…' not to match /contact support/i
AssertionError: arm permanent does not contain the lowercase substring "contact form": expected 'Analytics could not complete for this…' to contain 'contact form'
 Test Files  1 failed (1)
      Tests  2 failed | 34 passed (36)
cmp: restored byte-identical
```

The ELSE parity case stayed green in that run (only the two permanent-arm cases failed). GREEN after `cp` back:

```
 Test Files  1 passed (1)
      Tests  36 passed (36)
```

Fixture/render runs: route.test.ts + SyncPreviewStep.composite.render + SyncPreviewStep.render: 3 files, 147 tests passed.

## Plan-level verification

- `npm run lint`: 0 errors (4 warnings, none in touched files); the planning-hygiene rules all OK.
- `node scripts/lint-sql-gates.mjs --self-test`: "7 rules, red+green each."; corpus run: "0 finding(s), 0 measure-fail(s), 0 allowlist error(s)."
- `node scripts/baseline-content-drift-check.mjs`: findings 1, exactly the expected row:
  `DRIFT computation_error_copy/1 snapshot=905e9d0f... chain=68556485... differing-lines=8`
  (expected until the automated post-apply re-dump of `supabase/schema/baseline.sql`; no allowlist row added; no other function named).
- Full `npx vitest run`: not clean, see "Full suite" below (flakes under load plus factsheet/RiskTabPanel failures outside this plan's files).

## Full suite

One full `npx vitest run` in this worktree (while the sibling executor was also running tests, so the machine was loaded): `Test Files 9 failed | 1255 passed | 20 skipped (1284)`, `Tests 16 failed | 27361 passed | 306 skipped`. NOT clean, and reported as such. Triage by re-running the failing files:

- Passed on isolated re-run (load flakes, timeouts of 5 s and up to 85 s per file): `csv-finalize-after-failloud.test.ts`, `local-stack-lane-wiring.test.ts` (74 tests), `mutation-runner-floors.test.ts` (133 tests). The last two are the census/lane files this plan could have moved; both are green (207 tests passed).
- Still failing on isolated re-run, all in files that import nothing this plan changed (the only changed paths are the migration, rollback, snapshot, two SQL gates, csv-finalize route/test and two SyncPreviewStep tests):
  - `src/lib/factsheet/compute.conventions.test.ts` fixture B and C: frozen snapshot mismatch (factsheet math).
  - `src/app/(dashboard)/allocations/RiskTabPanel.book-series.test.tsx`: `[data-testid="var-expected-shortfall"]` not found.
  - Timeouts only, under load: `check-planning-hygiene.test.ts` "zero violations at HEAD" (5 s test timeout; the same scan passes inside `npm run lint`), `return-stats.single-source.test.ts` (5 s timeout), `ci-apt-bounded.contract.test.ts` R4 (55 s spawn timeout), `scripts/factsheet-census/count.test.tsx` (13 s).
- I did NOT re-run the failing files at the base commit (no clean checkout available without touching the other worktrees), so "pre-existing" is an inference from no shared imports, not a measurement. The ship step's CI run is the arbiter. None of these is in the plan's required set (raise-exception-concat-grammar, critical-regressions, drift-check-scripts, local-stack-lane-wiring, mutation-annotation-parser and mutation-runner-floors all passed).

## Deviations from Plan

1. **[Rule 3 - runner diagnostic] Marked gate baseline-red names `none`, not `A`.** Explained above. The red itself is real and the arm was shown directly on the lane. Not a gate defect, no code change.
2. **Pin parses via a hoisted module-scope read.** `COPY_SNAPSHOT_PATH`/`COPY_SNAPSHOT_SQL` are hoisted above the oracle so the ELSE oracle and the new arm pin share ONE read, as the plan's "reuses the same module-scope snapshot read" asks. Behaviour of the ELSE oracle is unchanged.

No auto-fixed bugs. No census value moved. No waiver added.

## Authentication gates

None.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema change: one function body re-based with an unchanged signature and ACL; the self-verify asserts the ACL (service_role EXECUTE yes, anon and authenticated no) and each arm literal (T-222-01, T-222-02, T-222-03 mitigated as planned; T-222-04: no ids, refs or paths in the new tracked text).

## Ship notes carried forward (for the ship step, not this plan)

- Re-pick the migration stamp from origin/main immediately before the single CI run; it must sort after 225 PR-3's `20261126120000_api_keys_venue_server_index.sql` and any later tip. A re-stamp moves together: the migration filename, the rollback filename and header, the snapshot's `-- source migration:` line (regenerate), both RED-UNDER-SETUP entries, the RAISE/NOTICE texts in the self-verify, and the gate prose naming the file (`computation_error_copy_contact_form` is named in the curated gate's header prose and c_perm comment).
- migration-reviewer and rls-policy-auditor must be clean at MEDIUM+ before merge. Flag the one divergence: the migration follows the newest frame (no explicit transaction statements), not the BEGIN/COMMIT shape of 20260826120000.
- TODOS.md: delete `[212-CONTACT-SUPPORT-SURVIVORS]` and name it in the CHANGELOG; book `first_hop_enqueue_sweep.c_named_state_copy` (point at `supabase/tests/test_first_hop_enqueue_sweep.sql` `c_sentence` and `docs/runbooks/compute-queue.md`), plus `get_user_compute_jobs.user_message` and the `prevent_profile_role_change` RAISE.
- CHANGELOG known limit: existing PROD `strategy_analytics.computation_error` rows keep the old sentences until their next failure or recompute; no backfill.
- After merge: read-only PROD catalogue check (marker query first, MCP) confirms the new arms; the baseline re-dump PR clears the expected DRIFT row.

## Self-Check: PASSED

- FOUND: supabase/migrations/20261125212222_computation_error_copy_contact_form.sql
- FOUND: supabase/migrations/down/20261125212222-rollback.sql
- FOUND commits: cf16dd920, 6043467d3, e32862947 (all ancestors of HEAD)
