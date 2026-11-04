---
phase: 190-factsheetqueued
plan: 02
subsystem: wizard-finalize
tags: [finalize-wizard, compute_jobs, strategy_analytics, rerun-decision, after, sentry]

requires:
  - phase: 190-factsheetqueued plan 01
    provides: SC-1 count (4 of 4 finalize-sourced sync_trades jobs landed after a finished computation) and the CREATE-WITH-KEY verdict (it enqueues nothing)
provides:
  - decideFinalizeRerun, the server-derived rule for whether the wizard's finalize queues an analytics re-run
  - both legacy finalize arms (single-key contribution and composite) consult it inside after()
  - IN_FLIGHT_JOB_STATUSES exported from compute-state.ts
affects: [190-03, 190-08]

actuals:
  tokens: 30000
  tasks: 2
  commits: 2
plan_head_before: ae62935d13ef102646cc715251a24e45d97dd759
plan_head_after: 61f25612908d9cb334e8506a87aa483d5edaec47

tech-stack:
  added: []
  patterns:
    - "re-run decision read from DB rows inside after(); every uncertain branch queues the run"

key-files:
  created:
    - src/lib/finalize-rerun.ts
    - src/lib/finalize-rerun.test.ts
  modified:
    - src/lib/compute-state.ts
    - src/app/api/strategies/finalize-wizard/route.ts
    - src/app/api/strategies/finalize-wizard/route.test.ts

key-decisions:
  - "A terminal-success skip requires the result to be provably current for its inputs (orchestrator course correction, security review MEDIUM): computed_at must not be older than the linked key's created_at or the newest composite member's created_at. A missing stamp queues."
  - "Reason inputs_changed added to the decision union; failedRead gains api_keys and strategy_keys."
  - "An analytics read that answers null without an error means no row (never computed) and queues as no_terminal_success; only the compute_jobs read treats null-without-error as read_failed."

requirements-completed: [SC-2]

completed: 2026-11-03
status: complete
---

# Phase 190 Plan 02: Finalize queues a re-run only when one is needed Summary

**Finishing the wizard now queues `sync_trades` (single key) or `stitch_composite` (composite) only when the strategy has no provably current terminal-success analytics, no live chain job in flight, or when finalize moved `asset_class`; every read failure queues the run.**

## What changed

- `src/lib/finalize-rerun.ts` (new): `decideFinalizeRerun(admin, strategyId, { assetClassChanged, composite, apiKeyId, nowMs })` returning `FinalizeRerunDecision`. Order: asset_class changed (queue, no read) then analytics read (terminal success AND inputs not newer than `computed_at` skips) then live-job read (a job `computeJobDeadReason` calls dead does not count) then queue. It never throws.
- `src/lib/compute-state.ts`: `IN_FLIGHT_JOB_STATUSES` exported, nothing else touched.
- `route.ts`: the draft read selects `asset_class`; `assetClassChanged` is true only when this finalize wrote a value different from the draft's; `runLegacyFinalize` takes it as a required argument at both call sites; the composite branch decides AFTER the fail-closed `compositeMemberCount` and BEFORE the rpc, the refresh-marker retraction and the `sync.start` audit; the single-key side effect decides after the `api_key_id` check. A `read_failed` decision is logged and captured at warning level with `side_effect: rerun_decision_read` and a `read` tag, then the run is queued. A skip logs `no re-run queued for <id>: <reason>`. The `@audit-skip` pragma stayed within its 8-line window (`audit-coverage.test.ts` green).
- The unified (manager single-key) arm, `postProcessKey` and `notify_founder_new_strategy` / `api_keys_last_sync_at_touch` are untouched. No request-body field was added (a route test posts `skip_rerun` and `already_computed` and shows them ignored).

## Course correction applied (orchestrator, security review MEDIUM)

The first commit skipped on any terminal success. The review pointed out that analytics can exist while an input changed after them (new key link, a member added since the last stitch), which would drop a needed run. Fixed in the second commit with timestamps that already exist (no migration): `strategy_analytics.computed_at` against `api_keys.created_at` of the linked key (single key) or the maximum `strategy_keys.created_at` (composite). Missing or unparseable stamp, empty member list, absent key row: queue (`inputs_changed`). Read error or throw: queue as `read_failed` naming `api_keys` or `strategy_keys`. Minimal change, no new abstraction.

Known limit (documented in the file JSDoc): a REMOVED member or a re-link to an older key leaves no timestamp, so the stored result stands. A `derive_broker_dailies` hop keyed by `api_key_id` is invisible to the jobs read, which errs toward queueing.

## Verification

- `npx vitest run src/lib/finalize-rerun.test.ts src/app/api/strategies/finalize-wizard/route.test.ts src/lib/compute-state.test.ts src/__tests__/audit-coverage.test.ts`: 4 files, 303 tests passed (finalize-rerun.test.ts has 26 cases).
- `npm run typecheck`: clean. `npx eslint` on the five touched files: clean. `npm run lint`: 0 errors, 2 pre-existing warnings in files this plan did not touch (`MetricsColumn.tsx`, `composite-read-path.ts`); planning-hygiene checks OK.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK. `grep -c enqueue_compute_job src/app/api/strategies/create-with-key/route.ts` prints 0. `decideFinalizeRerun(admin` appears 2 times in route.ts; `rerun_decision_read` 2 times.

### Can-fail proofs (byte backups in the scratchpad, restored with `cp`, confirmed with `cmp`, no output)

1. Neutered both `if (!decision.enqueue)` sites in `route.ts` so the enqueue runs whatever the decision says: three tests went RED, including `SC-2 RED: a contribution finalize over a computed strategy queues no sync_trades re-run` (Received: an `enqueue_compute_job` call with `p_kind: "sync_trades"`), the composite skip test and the live in-flight job test. The SC-2 test was also RED on the original code before the helper existed. `cmp` printed nothing; green again.
2. Neutered the currency check in `finalize-rerun.ts` (the pre-correction "any terminal success skips" rule): 7 tests went RED (5 unit, 2 route). `cmp` printed nothing; green again.

## Deviations from Plan

**1. [Course correction, orchestrator] Input-currency check added to the skip rule** (see above). Not in the plan text; recorded in key-decisions.

**2. [Interpretation] Null analytics read.** The plan's truth line says a "null result without an error on either decision read" is captured as `read_failed`, while its behavior block and action text say a missing analytics row is `no_terminal_success`. Followed the action text: `maybeSingle` returns null for "no row", the ordinary never-computed case, so only the compute_jobs read treats null-without-error as a failed read.

**3. [Rule 3] Test harness.** `logAuditEventAsUser` is now recorded by a pass-through `vi.mock("@/lib/audit")` in route.test.ts so a skipped composite run can be shown to write no `sync.start`; behaviour of existing cases is unchanged (the real function still runs).

## Known Stubs

None.

## Threat Flags

None. The decision reads only `strategy_analytics`, `compute_jobs`, `api_keys.created_at` and `strategy_keys.created_at` for the finalized strategy's own ids with the service-role client, as the surrounding after() code already does.

## Self-Check: PASSED

Files exist (`src/lib/finalize-rerun.ts`, `src/lib/finalize-rerun.test.ts`); commits `8e8ec2786` and `61f256129` are ancestors of HEAD on `feat/190-p02`.
