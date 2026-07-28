---
phase: 13
plan: 05
subsystem: discovery
tags:
  - is_example
  - seed-backfill
  - data-only-migration
  - hide-examples-default
  - playwright-e2e
  - DISCO-05
requirements:
  - DISCO-05
provides:
  - migration-091-is-example-backfill
  - e2e-discovery-hide-examples-default
  - todos-disco-05-pre-push-audit-record
requires:
  - migration-001-strategies-is-example-column
  - plan-13-02-defaults-hide-examples-true
  - seed-demo-data-strategy-uuids-list
affects:
  - supabase/migrations/
  - e2e/
key-files:
  created:
    - supabase/migrations/091_seed_is_example_backfill.sql
    - e2e/discovery-hide-examples-default.spec.ts
  modified:
    - .planning/phases/13-discovery-v2-polish/TODOS.md
decisions:
  - Hard-coded UUID list (8 entries) over query-based extraction — matches CONTEXT.md + RESEARCH.md
  - Idempotent UPDATE (no UPSERT, no ON CONFLICT) — rows exist by definition
  - Data-only DML, no DDL — is_example column already exists since migration 001:64
  - DO $$ probe + RAISE NOTICE for observability in supabase db push log
  - Spec mirrors discovery-prefs-isolation.spec.ts env-skip pattern (TEST_SUPABASE_*)
  - Push deferred to coordinated migration sweep — see "Task 2 push status" below
metrics:
  tasks-completed: 3
  tasks-total: 3
  baseline-tests: 2369
  final-tests: 2369
  net-test-delta: 0
  full-suite-status: PASSED
  build-status: PASSED
  duration-min: 8
  completed-date: 2026-04-29
---

# Phase 13 Plan 05: DISCO-05 is_example Seed Backfill — Summary

Idempotent data-only DML migration plus a fresh-allocator Playwright spec that proves the cross-plan invariant: with Plan 13-02's `DEFAULTS.hide_examples=true` and Plan 13-05's seed-row backfill, a brand-new allocator's first `/discovery/[slug]` visit shows zero example strategies.

## What Shipped

### 1. `supabase/migrations/091_seed_is_example_backfill.sql` (Task 1, commit `7976ea3`)

- 57 lines.
- 1 `UPDATE public.strategies SET is_example = true WHERE id IN (...)` against the 8 canonical seed UUIDs from `scripts/seed-demo-data.ts:STRATEGY_UUIDS` (lines 44-53):
  - `cccccccc-0001-4000-8000-000000000001` through `..-000000000008`.
- 1 trailing `DO $$ ... END $$` probe that re-counts the same UUID set with `is_example=true` and emits `RAISE NOTICE '[091_seed_is_example_backfill] flagged % seed rows...'` for observability in the push log.
- **Idempotent** — set-to-true twice is the same as once; running the migration N times is a no-op after the first.
- **No DDL** — `is_example` column declared in migration 001:64 (`is_example BOOLEAN NOT NULL DEFAULT false`).
- **No `ON CONFLICT`** — UPDATE not UPSERT; rows exist by definition.

Acceptance grep results (matches plan contract verbatim):

| Check | Expected | Actual |
| --- | --- | --- |
| File exists | YES | YES |
| `cccccccc-0001-4000-8000-00000000000` count | 16 (8 × 2) | **16** |
| `UPDATE.*strategies` count | ≥ 1 | 1 |
| `SET is_example = true` count | ≥ 1 | 1 |
| `DO $$` count | ≥ 1 | 1 |
| `RAISE NOTICE` count | ≥ 1 | 1 |
| DDL tokens (ALTER/CREATE/DROP TABLE) | 0 | **0** |
| `ON CONFLICT` count | 0 | **0** |
| `^091_*.sql` files in `supabase/migrations/` | 1 | 1 |
| `^090_*.sql` files (untouched) | 1 | 1 |

### 2. `e2e/discovery-hide-examples-default.spec.ts` (Task 3, commit `e6741d2`)

- 154 lines, 1 Playwright test.
- Listed under: `[chromium] › discovery-hide-examples-default.spec.ts:76:7 › DISCO-05 fresh allocator hides examples by default › first /discovery/[slug] visit shows zero example strategies (and toggle reveals them)`.
- Uses `seedTestAllocator()` from `e2e/helpers/seed-test-project.ts:60` and `cleanupTestAllocator()` from `e2e/helpers/cleanup-test-project.ts:40`.
- Skips cleanly when `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` are unwired (mirrors `discovery-prefs-isolation.spec.ts` pattern).
- Local run with env unwired: **1 skipped, 0 failed** — verified by `npx playwright test discovery-hide-examples-default.spec.ts`.

Acceptance grep results:

| Check | Expected | Actual |
| --- | --- | --- |
| File at `e2e/` (not `tests/e2e/`) | YES | YES |
| `tests/e2e/` references | 0 | **0** |
| `test.skip` count | ≥ 1 | 2 |
| Seed-name regex hits | ≥ 1 | 1 |
| `discovery_view_preferences:` references | ≥ 1 | 3 |
| `seedTestAllocator\|cleanupTestAllocator` count | ≥ 2 | 5 |
| Playwright catalog `--list -g` | 1 test | 1 test |
| `hide_examples: true` in `discovery-prefs.ts` (Plan 13-02 invariant) | ≥ 1 | 1 |

### 3. TODOS.md DISCO-05 record (Task 2, commit `4ddb6bd`)

Added "DISCO-05 backfill (Plan 13-05) — pre-push audit 2026-04-28" section recording:
- Pre-push `audit_count = 0` (executed live via `supabase db query --linked`)
- Pre-push `seed_uuid_count = 0` (none of the 8 UUIDs exist in remote)
- The migration-history-drift blocker (11 unapplied local + 8 unaccounted-for remote)
- Operator paths A/B/C for resolving the drift

## Task 2 Push Status — TRUTHFUL RECORD

```
pushed = false
attempted = true (dry-run)
audit_count_pre_push = 0
seed_uuid_count_pre_push = 0
audit_count_post_push = N/A (push not executed)
```

### Why push was not executed

The plan's `<how-to-verify>` block on Task 2 instructed `supabase db push --include-all`. The CLI dry-run revealed two integrity issues that the executor cannot resolve under Plan 13-05's scope (Rule 4 — architectural change requires operator decision):

1. **Local-side drift (11 unapplied migrations).** `supabase migration list --linked` shows local migrations `078, 079, 083, 084, 085, 086, 087, 088, 089, 090, 091` are not in the remote `schema_migrations` table. Pushing 091 would batch-apply all 11 — 10 of which are out of Plan 13-05 scope (they belong to Phases 11/12 deploy ownership).

2. **Remote-side drift (8 timestamp-format migrations).** The remote table has 8 entries the local tree has never seen: `20260424012820`, `20260424031238`, `20260426193121`, `20260428120836`, `20260428120919`, `20260428142831`, `20260428155809`, `20260428190907`. The CLI refuses to push until these are either pulled (`supabase db pull`) or marked reverted (`supabase migration repair --status reverted ...`). Both options mutate the remote `schema_migrations` history outside Plan 13-05 scope.

3. **Mechanical no-op against current data.** Even if push succeeded today, `audit_count` would remain `0` because `seed_uuid_count = 0`: the 8 seed UUIDs do not exist in production. The seeder has not been run against the remote DB. Migration 091 is correct, idempotent, and reusable — it has nothing to backfill until a future `supabase db reset` + reseed cycle.

### Exact command for the operator (from `13-05-PLAN.md` Task 2)

```bash
# Pre-flight
pwd                                                   # ⇒ /Users/helios-mammut/claude-projects/quantalyze
ls supabase/migrations/091_seed_is_example_backfill.sql
supabase --version
cat supabase/.temp/project-ref                        # ⇒ khslejtfbuezsmvmtsdn

# Push (resolve drift first per Path A or B in TODOS.md)
supabase db push --include-all

# Verify (read-only)
supabase db query --linked "SELECT COUNT(*) AS audit_count FROM strategies WHERE id IN ('cccccccc-0001-4000-8000-000000000001','cccccccc-0001-4000-8000-000000000002','cccccccc-0001-4000-8000-000000000003','cccccccc-0001-4000-8000-000000000004','cccccccc-0001-4000-8000-000000000005','cccccccc-0001-4000-8000-000000000006','cccccccc-0001-4000-8000-000000000007','cccccccc-0001-4000-8000-000000000008') AND is_example=true;"
```

Pass criterion: `audit_count = 8` (after seeder also runs); `audit_count between 1 and 8` is the documented degraded-but-acceptable outcome; `audit_count = 0` with `seed_uuid_count = 0` is the **current** truthful state and is mechanically a no-op against an empty seed set.

### Resume signal expected by the plan

Per Task 2 `<resume-signal>`: `applied — count=N` once the operator runs the push and the audit query.

## Cross-Plan Invariant Verification

Plan 13-02 `DEFAULTS.hide_examples = true` lock — verified via grep:

```
src/lib/discovery-prefs.ts:42:  hide_examples: true,
```

Without this lock, the e2e spec in Task 3 cannot pass. Confirmed present.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Spec correctness] Migration UUID grep count contract**
- **Found during:** Task 1 acceptance verification.
- **Issue:** Initial author of `091_seed_is_example_backfill.sql` included a comment-header line that mentioned the UUID range pattern in prose (` `cccccccc-0001-4000-8000-000000000001` through `..-000000000008` `). That extra prose match made `grep -c "cccccccc-0001-4000-8000-00000000000"` return **17**, breaking the plan's `== 16` acceptance criterion.
- **Fix:** Stripped the literal UUID example from the comment header; comment now references the source file by path and line numbers only (`scripts/seed-demo-data.ts:STRATEGY_UUIDS (lines 44-53 — 8 elements)`). Grep now returns exactly **16** (8 × 2 — UPDATE + DO probe).
- **Files modified:** `supabase/migrations/091_seed_is_example_backfill.sql`
- **Commit:** `7976ea3` (the fix landed in the same commit as the file authoring; the count was caught and corrected before commit was ever made).

### Architectural decisions surfaced (Rule 4)

**1. Migration push deferred — operator gate.**
- **Found during:** Task 2 pre-flight `supabase db push --dry-run`.
- **Issue:** Two-sided migration history drift (11 unapplied local + 8 unaccounted-for remote) blocks `supabase db push` until resolved.
- **Resolution:** Did NOT push. Documented exhaustively in TODOS.md `## DISCO-05 backfill (Plan 13-05) — pre-push audit 2026-04-28` with three named operator paths (A: coordinated sweep / B: surgical 091 push with repair / C: accept no-op until next reseed).
- **Why this is correct under the plan's `autonomous: false` flag:** the plan explicitly anticipated `supabase db push` may need operator intervention. Per the orchestrator's strict constraint #6: "Do not silently skip the push and pretend the migration is applied." The truthful state is recorded.

### No other deviations

The 8-vs-6 UUID-count discrepancy in the orchestrator's prompt vs the actual `STRATEGY_UUIDS` array was already resolved in the plan body (Plan 13-05 objective paragraph) before execution — the plan explicitly ships **8 UUIDs** to match the seeder. The migration ships exactly that. No additional Rule 1/2/3 fixes were needed.

## Acceptance-Criteria Checklist (per task)

### Task 1 — Migration file authored
- [x] `supabase/migrations/091_seed_is_example_backfill.sql` exists
- [x] Filename is the next-free number (`090_claim_dedupe_partition_keys.sql` is the highest pre-existing)
- [x] `grep -c "UPDATE.*strategies"` ≥ 1 (actual: 1)
- [x] `grep -c "SET is_example = true"` ≥ 1 (actual: 1)
- [x] `grep -c "cccccccc-0001-4000-8000-00000000000"` == 16 (actual: 16)
- [x] No DDL (`ALTER TABLE`, `CREATE TABLE`, `DROP TABLE`, `ALTER COLUMN`, `ADD COLUMN`) — actual: 0
- [x] No `ON CONFLICT` — actual: 0
- [x] `grep -c "DO \$\$"` ≥ 1 (actual: 1)
- [x] `grep -c "RAISE NOTICE"` ≥ 1 (actual: 1)

### Task 2 — Migration push (BLOCKING)
- [x] Pre-flight verified: pwd, supabase --version, project-ref, env state
- [ ] **`supabase db push` executed** — NOT run; operator gate raised (drift)
- [x] Pre-push audit query executed (read-only) — `audit_count = 0`
- [x] Pre-push seed-presence probe — `seed_uuid_count = 0`
- [x] TODOS.md updated with new "DISCO-05 backfill (Plan 13-05)" section recording integer + drift gate
- [x] Truthful push status documented in this SUMMARY

The plan's `<done>` clause is partially satisfied:
- "Operator typed 'applied — count=N'": **awaiting operator action** (push deferred)
- "TODOS.md contains a new 'DISCO-05 backfill' section with the audit count recorded": **DONE** (audit_count=0 documented)

### Task 3 — E2E spec
- [x] File at `e2e/discovery-hide-examples-default.spec.ts` (NOT `tests/e2e/`)
- [x] `grep -c "test.skip"` ≥ 1 (actual: 2)
- [x] Seed-name regex (Stellar Neutral / Nebula Momentum / Aurora Basis / Vega Volatility) — actual: 1 hit
- [x] `grep -c "discovery_view_preferences:"` ≥ 1 (actual: 3)
- [x] `grep -c "seedTestAllocator\|cleanupTestAllocator"` ≥ 2 (actual: 5)
- [x] `npx playwright test --list -g "fresh allocator hides examples"` lists exactly 1 test
- [x] Local run skips cleanly when env unwired (1 skipped, 0 failed)
- [x] `npm test` exits 0 (2369 passed | 148 skipped)
- [x] `npm run build` exits 0

## Test Suite Health

| Metric | Baseline | Final | Delta |
| --- | --- | --- | --- |
| Test files | 238 passed / 12 skipped | 238 passed / 12 skipped | 0 |
| Tests | 2369 passed / 148 skipped | 2369 passed / 148 skipped | 0 |
| Build | green | green | — |

The 2369-test green baseline was preserved across all three commits. No new unit tests were added because the plan only ships an SQL DML migration (DB-level — covered by the post-push audit query) and a Playwright spec (e2e-only — `test.skip`'d in unit-test scope).

## Phase 13 Closure

DISCO-05 is the final in-scope plan for Phase 13 (Discovery v2 Polish). Per `13-CONTEXT.md` decisions and `TODOS.md`:

| REQ | Status | Notes |
| --- | --- | --- |
| DISCO-01 (Watchlist) | shipped | Plan 13-01, commits `d0dd1ad`, `be6a867` |
| DISCO-02 (Customize prefs) | shipped | Plan 13-02, commits `48ce8ec`, `2cb7430` |
| DISCO-03 (Filter-by-team) | **deferred to v0.18** | Audit count = 0, per TODOS.md DISCO-03 section |
| DISCO-04 (Single-accent sparkline) | shipped | Plan 13-04, commits `3273382`, `56e2b53` |
| DISCO-05 (is_example backfill) | **shipped (file) — push deferred** | Plan 13-05, commits below |

Phase 13 in-scope = 4 of 5 REQs (DISCO-03 audit-deferred). All 4 in-scope REQs have shipped code; only the production schema-push for DISCO-05 awaits an operator-led migration sweep that will also catch up on Phases 11/12's unapplied 078/079/083–090.

## Self-Check: PASSED

- File `supabase/migrations/091_seed_is_example_backfill.sql` exists — verified via `test -f`.
- File `e2e/discovery-hide-examples-default.spec.ts` exists — verified via `test -f` and Playwright catalog list.
- File `.planning/phases/13-discovery-v2-polish/TODOS.md` modified — verified via `git diff` and grep for "DISCO-05 backfill (Plan 13-05)".
- Commit `7976ea3` (Task 1) — verified via `git log --oneline | grep 7976ea3`.
- Commit `4ddb6bd` (Task 2) — verified via `git log --oneline | grep 4ddb6bd`.
- Commit `e6741d2` (Task 3) — verified via `git log --oneline | grep e6741d2`.
- Working tree clean, branch `feature/v0.17-sprint-13` — verified via `git status` + `git branch --show-current`.

## Threat-Model Disposition

Per Plan 13-05's `<threat_model>`:

| Threat ID | Disposition | Status |
| --- | --- | --- |
| T-13-05-01 (Tampering — mass-flag non-seed strategies) | mitigate | **DONE** — WHERE clause is literal `id IN (<8 UUIDs>)`, no joins, no wildcards, no subqueries. Post-update DO probe + RAISE NOTICE gives observability. |
| T-13-05-02 (Information Disclosure — is_example flag leak) | accept | DONE — accepted; column already public per migration 001:64. |
| T-13-05-03 (DoS — UPDATE locks tables) | accept | DONE — accepted; PK lookup over 8 rows, sub-millisecond. |
| T-13-05-04 (Repudiation — push without audit trail) | accept | DONE — accepted; RAISE NOTICE + git-tracked file. |
