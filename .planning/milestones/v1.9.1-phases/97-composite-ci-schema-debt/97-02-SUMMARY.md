---
phase: 97-composite-ci-schema-debt
plan: 02
subsystem: ci-schema-snapshots
tags: [ci, sql-function-snapshot, migration-drift, ship-blocking]
requires:
  - "supabase/migrations/** (Phase 95/96 branch-only migrations)"
  - "scripts/dump-sql-functions.ts (hermetic text-replay writer)"
provides:
  - "supabase/schema/functions/set_compute_job_progress.sql (new hermetic snapshot)"
  - "supabase/schema/functions/cleanup_abandoned_wizard_drafts.sql (new hermetic snapshot)"
  - "supabase/schema/functions/set_wizard_composite_members.sql (refreshed snapshot)"
  - "sql-function-snapshot CI gate GREEN for the milestone->main ship PR"
affects:
  - ".github/workflows/sql-function-snapshot.yml (hermetic gate — now passes)"
tech-stack:
  added: []
  patterns:
    - "@generated snapshots written ONLY by npm run schema:functions; never hand-edited"
    - "bounded-diff gate: regen scope asserted to exactly the owed files before commit"
key-files:
  created:
    - supabase/schema/functions/set_compute_job_progress.sql
    - supabase/schema/functions/cleanup_abandoned_wizard_drafts.sql
  modified:
    - supabase/schema/functions/set_wizard_composite_members.sql
decisions:
  - "Verify-and-drop the roadmap-named snapshots (enforce_strategy_keys_owner_coherence, sync_strategy_analytics_status) — already landed with v1.9 #607; roadmap named the wrong files"
  - "No VERSION/package.json/CHANGELOG bump — that is a ship-time concern, not this plan's scope"
metrics:
  duration: "~7 min"
  completed: 2026-07-12
  tasks: 2
  files_changed: 3
requirements: [CI-02]
---

# Phase 97 Plan 02: SQL-Function Snapshot Regen (CI-02.2) Summary

Regenerated exactly the 3 owed `@generated` SQL-function snapshots so the hermetic `sql-function-snapshot` CI gate goes green on the ship-blocking milestone→main PR, and recorded fresh cited verify-and-drop evidence for every CI-02.2 sub-item Phases 88–96 already closed.

## Tasks Completed

| Task | Name | Result | Commit |
|------|------|--------|--------|
| 1 | Verify-and-drop evidence for already-closed sub-items | 4/4 checks reproduced; zero code changes | (evidence only) |
| 2 | Regenerate the 3 owed snapshots — bounded-diff gated | 3 files, bound held, check FAIL→PASS | `b71b0d98` |

## Verified-and-dropped (roadmap criterion 4)

All four items below were checked against the current branch this execution and reproduced. They are **dropped, not re-done** — the roadmap named the wrong snapshots and the audit-instrumentation work already shipped.

**1. `enforce_strategy_keys_owner_coherence` + `sync_strategy_analytics_status` snapshots already exist** (landed with v1.9 #607, commit `044bee50`):
```
$ ls -la supabase/schema/functions/enforce_strategy_keys_owner_coherence.sql \
          supabase/schema/functions/sync_strategy_analytics_status.sql
-rw-r--r--  1 helios-mammut  staff  2255 Jul 12 06:35  .../enforce_strategy_keys_owner_coherence.sql
-rw-r--r--  1 helios-mammut  staff  6037 Jul 12 06:35  .../sync_strategy_analytics_status.sql
```
→ DROP. These were never owed by this branch.

**2. Audit-coverage / audit-fanout tests already green** (research measured 28 passed, 1 skipped — reproduced exactly):
```
$ npx vitest run src/__tests__/audit-coverage.test.ts src/__tests__/audit-fanout-integration.test.ts
 Test Files  2 passed (2)
      Tests  28 passed | 1 skipped (29)
```
→ DROP the "instrument for audit-coverage" + "green in CI" sub-items.

**3. `stitch_composite` enqueue audit call already instrumented** in the finalize-wizard route:
```
$ grep -n "logAuditEventAsUser" src/app/api/strategies/finalize-wizard/route.ts
14:import { logAuditEventAsUser } from "@/lib/audit";
923:            logAuditEventAsUser(admin, user.id, {
```
→ DROP the instrumentation sub-item (call present at `route.ts:923`, adjacent to the compute-job queue arm).

**4. `strategy_keys` table mock already present** in the fanout integration test:
```
$ grep -n "strategy_keys" src/__tests__/audit-fanout-integration.test.ts | head -5
811:          if (table === "strategy_keys") {
813:            // strategy is single-key/CSV (100 trades, no strategy_keys members),
```
→ DROP (mock at `audit-fanout-integration.test.ts:811`).

No check regressed; every dropped item is present and passing on the current branch.

## The regen (Task 2)

**Preflight** — clean tree under `supabase/schema/functions/`:
```
$ git status --porcelain supabase/schema/functions/
(empty)
```

**Before** — `schema:functions:check` FAILED (exit 1) with exactly the 3 owed files:
```
SQL function snapshot is stale (3 file(s)) ...
  missing:  supabase/schema/functions/cleanup_abandoned_wizard_drafts.sql
  missing:  supabase/schema/functions/set_compute_job_progress.sql
  stale:    supabase/schema/functions/set_wizard_composite_members.sql
$ npm run schema:functions:check ; echo $?   → exit 1
```

**Regen** — `npm run schema:functions` (the only sanctioned writer; wrote 101 files, 3 net changes).

**Bounded-diff gate — HELD** (exactly the 3 owed, nothing else):
```
$ git status --porcelain supabase/schema/functions/
 M supabase/schema/functions/set_wizard_composite_members.sql
?? supabase/schema/functions/cleanup_abandoned_wizard_drafts.sql
?? supabase/schema/functions/set_compute_job_progress.sql
```
The stale file's diff correctly re-bases onto migration `20260712120000_wizard_composite_members_invalidate_analytics.sql` (source-migration header swapped from `20260710180000_wizard_composite.sql`; adds `v_existing_sig`/`v_incoming_sig` signature-capture body — RT-FINDING-1). Each generated body contains its own function name + a single `@generated` marker. Zero hand edits.

**After** — `schema:functions:check` PASSES (exit 0). Committed exactly 3 files:
```
$ git log --stat -1
b71b0d98 chore(97-02): regen 3 owed SQL-fn snapshots for Phase 95/96 drift
 .../functions/cleanup_abandoned_wizard_drafts.sql  | 51 +++++++++++++++++++++
 .../schema/functions/set_compute_job_progress.sql  | 33 ++++++++++++++
 .../functions/set_wizard_composite_members.sql     | 53 ++++++++++++++++++++--
 3 files changed, 133 insertions(+), 4 deletions(-)
$ npm run schema:functions:check ; echo $?   → exit 0
$ git status --porcelain supabase/schema/functions/   → (empty)
```
No accidental deletions in the commit (`git diff --diff-filter=D HEAD~1 HEAD` → none).

## Deviations from Plan

None — plan executed exactly as written. No VERSION/package.json/CHANGELOG bump (ship-time concern, per plan). No hand edits to `@generated` files. Scope held to the 3 owed snapshots by the bounded-diff gate.

## Known Stubs

None.

## Self-Check: PASSED

- `supabase/schema/functions/set_compute_job_progress.sql` — FOUND (committed in `b71b0d98`)
- `supabase/schema/functions/cleanup_abandoned_wizard_drafts.sql` — FOUND (committed in `b71b0d98`)
- `supabase/schema/functions/set_wizard_composite_members.sql` — FOUND (modified in `b71b0d98`)
- Commit `b71b0d98` — FOUND in git log
- `npm run schema:functions:check` — exit 0 (GREEN)
