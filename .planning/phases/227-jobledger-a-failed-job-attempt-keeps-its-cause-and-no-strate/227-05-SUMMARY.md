---
phase: 227-jobledger-a-failed-job-attempt-keeps-its-cause-and-no-strate
plan: 05
subsystem: database
tags: [postgres, pg_cron, sql-gate, mutation-twin, runbook, heal-01]

requires:
  - phase: 146.2
    provides: reconcile_dropped_enqueue_sweep and its readmit ceiling (the direct-INSERT precedent and the marker shape)
  - phase: 164.6.8
    provides: ops_staleness_check (owner-only EXECUTE and the owner rolsuper-or-rolbypassrls self-verify shape) and the go-live runbook model
provides:
  - table public.first_hop_enqueue_retries (once-only observation ledger, RLS on, no policy, service_role SELECT only)
  - SECDEF public.first_hop_enqueue_sweep() RETURNS jsonb (owner-only EXECUTE, catalogue-only self-verify)
  - SQL lane gate H1 to H14b (21 arms, each with a biting RED-UNDER-M twin)
  - docs/runbooks/jobledger-go-live.md (marker-guarded hourly registration, verbatim cron.job evidence read, manifest re-capture, rollback)
affects: [227-10 census pins and NAME_SET_RATCHET, 227-11 ship records item 7, phase-agent go-live after merge]

actuals:
  tokens: 30780
  tasks: 3
  commits: 3
plan_head_before: 0bb1b4293909e4a12315e5039528ba704695348c
plan_head_after: 03a179034d6cb90801cd3ba438b3e322146427c0

tech-stack:
  added: []
  patterns:
    - "one candidate predicate shared by clear, observe and re-enqueue as a single data-modifying CTE statement"
    - "grace anchored on the sweep's own first observation instead of a finalize-time column"
    - "layered RED-UNDER-M twins that also neuter the migration's own self-verify clause"

key-files:
  created:
    - supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql
    - supabase/migrations/down/20261124120400-rollback.sql
    - supabase/tests/test_first_hop_enqueue_sweep.sql
    - supabase/schema/functions/first_hop_enqueue_sweep.sql
    - docs/runbooks/jobledger-go-live.md
  modified: []

key-decisions:
  - "DEC-05-A to DEC-05-G implemented as planned: registration is a runbook step, never a migration; grace anchored on first observation; data-absence plus job-absence predicate; direct INSERT; named state is computation_status failed plus one fixed sentence; private strategies only; minute 55."
  - "The sweep's work is one statement for clear, observe and re-enqueue (data-modifying CTEs sharing one candidate CTE), so the predicate is written once and cannot drift between the three uses."
  - "The named state additionally requires at least one failed_final job (strengthening of the plan's 'no job in another status'): a strategy whose retry job vanished is not shown 'the retry did not complete', which nobody measured."

patterns-established:
  - "Pattern: an arm that is sensitive to two guards gets reordered or split so each twin's first failure names its own arm (H1b split from H1, H6b before H2, H10a before H7)."

requirements-completed: [HEAL-01]

coverage:
  - id: D1
    description: "A finalized single-key contribution strategy whose first sync_trades enqueue dropped is observed and, after more than 90 minutes, re-enqueued exactly once with metadata source first-hop-sweep."
    requirement: "HEAL-01"
    verification:
      - kind: integration
        ref: "node scripts/mutation-runner/run.mjs --file supabase/tests/test_first_hop_enqueue_sweep.sql (arms H1, H1b, H6, H6b)"
        status: pass
    human_judgment: false
  - id: D2
    description: "A healthy new strategy is never caught: draft, pending_review, archived, no key, deactivated or disconnected key, any job by strategy or key, trades, daily returns, strategy_keys member, non-pending analytics row."
    requirement: "HEAL-01"
    verification:
      - kind: integration
        ref: "node scripts/mutation-runner/run.mjs --file supabase/tests/test_first_hop_enqueue_sweep.sql (arms H7 to H13d)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The named failed state (fixed sentence, NULL markers) appears only after the retry also ended failed_final with an absent or pending analytics row, and never overwrites a bridge-written failed row."
    requirement: "HEAL-01"
    verification:
      - kind: integration
        ref: "node scripts/mutation-runner/run.mjs --file supabase/tests/test_first_hop_enqueue_sweep.sql (arms H2 to H5)"
        status: pass
    human_judgment: false
  - id: D4
    description: "The hourly registration on PROD (job first_hop_enqueue_sweep at 55 * * * *) after merge, with the verbatim cron.job evidence read and the manifest re-capture."
    requirement: "HEAL-01"
    verification: []
    human_judgment: true
    rationale: "A live PROD write guarded by the marker query; it is the phase agent's go-live step after merge (D-02/D-10), so HEAL-01 is lane-proven with PROD registration pending until the runbook's Step 1b output is pasted."

duration: 75min
completed: 2026-11-23
status: complete
---

# Phase 227 Plan 05: First-hop enqueue sweep Summary

**A SECDEF `first_hop_enqueue_sweep()` plus a once-only ledger table: a private strategy whose first `sync_trades` enqueue dropped is observed, re-enqueued once after more than 90 minutes, and shown a fixed failed sentence only if that retry also fails; a runbook (not a migration) registers it hourly at minute 55.**

## Performance

- **Duration:** about 75 min
- **Started:** 2026-11-23T18:20Z (approx.)
- **Completed:** 2026-11-23T19:33Z
- **Tasks:** 3 (1 tracer, 1 tdd auto, 1 auto)
- **Files created:** 5 (no existing file modified)

## Accomplishments

- Migration `20261124120400_first_hop_enqueue_sweep.sql`: table `first_hop_enqueue_retries` (PK = strategy_id with cascade, `first_seen_at`, `reenqueued_at`, `reenqueued_job_id` without a foreign key, `named_state_at`, two named CHECKs), the sweep function, owner-only EXECUTE, and a catalogue-only self-verify (table RLS/zero policies/ACL/CHECKs/cascade, function SECDEF/search_path/owner exempt from RLS/grantee set, and eight body-clause anchors over the comment-stripped body).
- The sweep is one statement for clear, observe and re-enqueue sharing a single `cand` CTE, then a second statement for the named state. Limits: 100 observed, 25 re-enqueued, 25 named per tick.
- Gate `supabase/tests/test_first_hop_enqueue_sweep.sql`: 21 arms (H1, H1b, H6b, H2, H3, H4, H5, H6, H10a, H7, H8, H9, H10b, H11, H12, H13a to H13d, H14, H14b), every one with a RED-UNDER prose line and a RED-UNDER-M twin, all biting.
- Rollback `down/20261124120400-rollback.sql`: refuses while a cron job still names the function, drops the function, revokes and renames the table aside (not dropped), catalogue-only pre- and post-conditions. Tested on the lane: renamed table present, function gone.
- Runbook `docs/runbooks/jobledger-go-live.md`: P0 marker query, P1 catalogue read, P2 slot occupancy (minute 55 re-read from the manifest), P3 candidate count, guarded Step 1 registration, Step 1b verbatim `cron.job` evidence read (HEAL-01's delivery evidence), Step 2 manifest re-capture, first tick, rollback. States the merge-to-registration window in the required words and names plan 09's reader and plan 04's detector as worker-driven.

## Task Commits

1. **Task 1 (tracer): table, sweep (observe and re-enqueue), arm H1** - `f8dc5383f` (feat)
2. **Task 2: named state, look-alikes, once-only, self-verify, rollback, PROOF-01** - `6464e35d3` (feat)
3. **Task 3: go-live runbook** - `03a179034` (docs)

## PROOF-01 transcripts (verbatim)

All run in this worktree on the throwaway pg-lane (`scripts/pg-lane/run.sh` through the mutation runner); no Docker, no shared TEST or PROD.

**Full gate, pristine, diagnostic mode (exit 2, 21 of 21 biting):**

```
  baseline  supabase/tests/test_first_hop_enqueue_sweep.sql — exit 0 (4.7s)
  arm H1                       exit   3  RED (identity ok)  (3.7s)
  arm H1b                      exit   3  RED (identity ok)  (3.0s)
  arm H6b                      exit   3  RED (identity ok)  (3.0s)
  arm H2                       exit   3  RED (identity ok)  (4.1s)
  arm H3                       exit   3  RED (identity ok)  (3.8s)
  arm H4                       exit   3  RED (identity ok)  (4.6s)
  arm H5                       exit   3  RED (identity ok)  (4.8s)
  arm H6                       exit   3  RED (identity ok)  (3.6s)
  arm H10a                     exit   3  RED (identity ok)  (3.7s)
  arm H7                       exit   3  RED (identity ok)  (3.5s)
  arm H8                       exit   3  RED (identity ok)  (3.1s)
  arm H9                       exit   3  RED (identity ok)  (3.2s)
  arm H10b                     exit   3  RED (identity ok)  (3.1s)
  arm H11                      exit   3  RED (identity ok)  (4.2s)
  arm H12                      exit   3  RED (identity ok)  (2.7s)
  arm H13a                     exit   3  RED (identity ok)  (2.6s)
  arm H13b                     exit   3  RED (identity ok)  (2.5s)
  arm H13c                     exit   3  RED (identity ok)  (2.5s)
  arm H13d                     exit   3  RED (identity ok)  (2.5s)
  arm H14                      exit   3  RED (identity ok)  (2.5s)
  arm H14b                     exit   3  RED (identity ok)  (2.6s)
  restore   supabase/tests/test_first_hop_enqueue_sweep.sql — exit 0 (2.5s)
arms: 21/21/0   (executed/annotated/waived)
biting: 21   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)
No defects in the narrowed scope.
```

**Disconnected-key arm, by hand (cp backup, delete the conjunct, RED, cp back, cmp, GREEN):**

```
$ cp supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql <scratch>/mig.bak
--- mutated: delete 'AND ak.disconnected_at IS NULL' (and the self-verify clause that would abort the apply)
175d174
<                 AND ak.disconnected_at IS NULL
524c523
<   IF position('disconnected_at IS NULL' IN v_body) = 0 THEN
---
>   IF FALSE THEN
--- gate run on mutated copy (runner):
  baseline  supabase/tests/test_first_hop_enqueue_sweep.sql — exit 3 (2.8s)
      pristine corpus did not go GREEN (exit 3); first failure: H12
--- direct lane run on mutated copy:
psql:supabase/tests/test_first_hop_enqueue_sweep.sql:810: ERROR:  P0001: TEST FAILED (H12): a strategy whose key is disconnected was observed (1 observation row(s), 0 sweep job(s), expected 0 and 0).
$ cp <scratch>/mig.bak supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql
cmp exit=0
--- gate run after byte restore:
exit=2
  baseline  supabase/tests/test_first_hop_enqueue_sweep.sql — exit 0 (3.0s)
  restore   supabase/tests/test_first_hop_enqueue_sweep.sql — exit 0 (4.2s)
arms: 21/21/0   (executed/annotated/waived)
biting: 21
No defects in the narrowed scope.
```

The self-verify clause is neutered in the same mutation because deleting the conjunct alone aborts the apply at the migration's own anchor, so no arm could be the first failure (the same layering the arm's committed twin carries).

**Linters and checks run:**

- `node scripts/verify-plan-anchors.mjs <plan>`: `OK: 1 plan file(s), no stale claims.`
- `node scripts/lint-migration-data-dependence.mjs`: `corpus 327 migration(s), 409 anonymous block(s); 83 refusal(s), 83 allowlisted, 0 NEW.`
- `node scripts/lint-sql-gates.mjs`: `scanned 113 file(s); 0 finding(s), 0 measure-fail(s), 0 allowlist error(s).`
- `node scripts/lint-app-guc.mjs`: `findings 0`.
- `npx vitest run` on `outagealert-migration-schedules-nothing`, `critical-regressions`, `lint-migration-data-dependence`, `prod-prober-wiring`, `gdpr-export-schema`: all pass.
- Runbook verify greps: all four non-zero, final negated grep for home paths and emails clean.

**Substitution recorded:** the plan's verify commands already use the pg-lane (`mutation-runner --file`), so nothing was substituted. No `scripts/local-stack/run.sh up` proof was possible here (Docker unavailable); the migration was not applied against a local Supabase stack, only on the pg-lane's stand-in schema. Plan 10 owns the local-stack/CI proof.

## Decisions Made

See `key-decisions` above. Beyond the planned DEC-05-A to G:

- The "write the predicate once" instruction is met with a single data-modifying-CTE statement (clear, observe, re-enqueue, stamp) so the candidate CTE is textually unique.
- Named-state admission also requires an existing `failed_final` job (see Deviations).

## Deviations from Plan

### Auto-fixed / judgement calls

**1. [Rule 2 - Missing critical] Named state requires at least one failed_final job**
- **Found during:** Task 2, designing statement 4.
- **Issue:** the plan's test (a) "no compute_jobs row whose status is not failed_final" is also true for a strategy with NO job row (retry pruned or removed), which would write "the automatic retry did not complete" for a retry nobody saw fail.
- **Fix:** added `EXISTS (... status = 'failed_final')` alongside the NOT EXISTS. Arm H6 (retry removed, never a named state from it) and H5 (queued/running) exercise both sides.
- **Files:** `supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql`
- **Commit:** `6464e35d3`

**2. [Rule 3 - Gate hygiene] Arm count 21, not 14, and a non-listed arm order**
- **Found during:** Task 2 first full mutation run.
- **Issue:** the plan names H1 to H14, but (a) the grace needs its own twin and H1's pre-grace asserts would fire first under it, so it is split out as H1b; (b) the data-absence conjuncts and the two job legs are separate guards, so H13 became H13a to H13d and H10 became H10a and H10b so each twin has an arm of its own; (c) the clear's `reenqueued_at IS NULL` restriction and the re-enqueue's are separate guards (H6b and H6); (d) the table ACL is split from the function ACL (H14b). Under some twins a positive arm fires first (H6b's twin deletes the stamped row so H2 fails; H10a's twin makes H7's strategy a candidate), so H6b runs right after H1b and H10a before H7, and H6b no longer asks H6's second-job question. Each such order and split is recorded in the gate's header.
- **Result:** `arms: 21/21/0`, `biting: 21`.
- **Files:** `supabase/tests/test_first_hop_enqueue_sweep.sql`
- **Commit:** `6464e35d3`

**3. [Rule 3 - Lane stand-ins] Setup list carries the sync-status chain through 20260906120000 and the allocator-target migrations**
- **Found during:** Task 2 first lane run.
- **Issue:** the named state writes the two provenance columns (`computation_error_source`, `computation_error_job_id`), which exist only after `20260906120000`; planting a key-scoped job needs `20260717233529`'s widened target CHECK. The reconcile gate's list has neither.
- **Fix:** `RED-UNDER-SETUP` is the ops-staleness prefix (fixtures 07, 11, 15, 20, 21, 24), fixture 27, the compute_jobs chain, the allocator target migrations, the sync-status chain through the provenance migration, and the migration under test last. No fixture file was added or edited.
- **Commit:** `6464e35d3`

### Not done on purpose (owned elsewhere)

- **`scripts/dump-sql-functions.ts` `NAME_SET_RATCHET` row not added.** `npx tsx scripts/dump-sql-functions.ts --check` currently reports `snapshot-only: first_hop_enqueue_sweep` because `supabase/schema/baseline.sql` predates the function. The plan said not to edit census pins and plan 10 explicitly owns this row (it names `first_hop_enqueue_sweep` among five functions). The snapshot file itself is regenerated and committed. Until plan 10 lands the row, `schema:functions:check` is red for this one name.
- **No census pin touched** (mutation floors, `FILES_FLOOR`, `ARMS_FLOOR`, `WAIVED_CEILING`). The new file adds 21 arms to the annotated corpus; plan 10 re-measures the floors.

**Total deviations:** 3 judgement calls recorded, 0 architectural. **Impact:** strengthening only; no scope change.

## Known Stubs

None. No placeholder, empty-value or TODO text was added to any file.

## Threat Flags

None. The only new surface is the owner-only SECDEF function and the RLS-on, no-policy ledger table, both already in the plan's threat register (T-227-14 to T-227-17). Mitigation evidence: T-227-14 by H14 and the self-verify grantee check; T-227-15 by the fixed sentence constant and H4; T-227-16 by H6 and H6b; T-227-17 by H11, H12 and the PROOF-01 transcript above.

## Issues Encountered

- **The runbook step that registers the job was not run.** Per the dispatch note and D-02/D-10 nothing was registered on PROD and no PROD read or write was made. HEAL-01 is lane-proven with PROD registration pending; it is not recorded as delivered. The delivery evidence is the runbook's Step 1b output, P0 marker result and Step 2 manifest diff line, pasted into the Phase 227 verification report by whoever runs the go-live.
- Hygiene: `npx tsx scripts/check-planning-hygiene.ts` prints OK for the rules it covers.

## Next Phase Readiness

- Plan 10 must add the `NAME_SET_RATCHET` row for `first_hop_enqueue_sweep` (and its siblings) and re-measure the mutation floors for the 21 new arms; its `RED-UNDER-SETUP` list and the file are final.
- Plan 11's ship records item 7: record HEAL-01 as lane-proven with PROD registration pending until the runbook's Step 1b read is pasted.
- After merge the phase agent runs `docs/runbooks/jobledger-go-live.md` (P0 to Step 2) and re-captures the manifest in the same session.

## Self-Check: PASSED

- FOUND: `supabase/migrations/20261124120400_first_hop_enqueue_sweep.sql`
- FOUND: `supabase/migrations/down/20261124120400-rollback.sql`
- FOUND: `supabase/tests/test_first_hop_enqueue_sweep.sql`
- FOUND: `supabase/schema/functions/first_hop_enqueue_sweep.sql`
- FOUND: `docs/runbooks/jobledger-go-live.md`
- FOUND commits (ancestors of HEAD): `f8dc5383f`, `6464e35d3`, `03a179034`
