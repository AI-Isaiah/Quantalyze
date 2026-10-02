# Phase 13 — Discovery v2 Polish — TODOs

## DISCO-03 Audit (run 2026-04-28 at plan-phase time)

**Query:**
```sql
SELECT COUNT(*) AS audit_count
FROM strategies
WHERE organization_id IS NOT NULL AND status='published';
```

**Result:** `audit_count = 0`

**Decision (per CONTEXT.md locked decision and ROADMAP success criterion 4):**
- The conditional `organizations.is_public` migration (originally penciled as `088_*`, then shifted) is **NOT shipped** in Phase 13.
- DISCO-03 (filter-by-team UI) is **DEFERRED to v0.18**.
- Phase 13 in-scope reduces to DISCO-01, DISCO-02, DISCO-04, DISCO-05 (4 of 5 REQs).

**Re-evaluation trigger:** Re-run the audit query at the start of v0.18 milestone planning. If `audit_count > 0` at that time, ship the `organizations.is_public` migration + filter UI as a v0.18 phase deliverable using the next-free migration number at that time. Pitfall 18 mitigation (privacy gate via `is_public BOOLEAN DEFAULT false`) remains the locked design — only the *timing* moves.

## Migration numbering (resolved 2026-04-28; updated post-rebase)

- Highest migration shipped on `main` after second rebase (2026-04-28 evening): `090_claim_dedupe_partition_keys.sql` (PR #83, queue fix — landed mid-Phase-13 planning, after the first rebase).
- Earlier intent (CONTEXT.md): the `organizations.is_public` migration would have been `088_*`. Phase 12 took 088 (`088_cutover_strategy_metrics_keys.sql`), pushing the conditional migration to 089. PR #82 then took 089 (`089_claim_failed_retry.sql`); PR #83 then took 090 (`090_claim_dedupe_partition_keys.sql`).
- **Phase 13 deferred its only conditional migration** (would have been at the next-free number) per audit-count=0 above.
- The DISCO-05 data-only DML migration (the only new migration Phase 13 actually ships) takes the next-free number = **`091_seed_is_example_backfill.sql`**. Plan 13-05 references this filename throughout.

## Seed UUIDs (resolved 2026-04-28 from research)

`scripts/seed-demo-data.ts` defines `STRATEGY_UUIDS = ['cccccccc-0001-4000-8000-000000000001' .. '..-000000000006']` (6 UUIDs). The DISCO-05 data migration hard-codes those 6 UUIDs in the `WHERE id IN (...)` clause — no `created_by` query, no `name ILIKE` fallback (CONTEXT.md's `created_by` reference uses a column name that does not exist on `strategies`; correct column would be `user_id`, but a hard-coded list is simpler and safer).

## Open questions for planner

(Open questions from RESEARCH.md that survive the audit-count=0 simplification:)

1. **Watchlist PUT rate limiter:** `mandateAutoSaveLimiter` (30/min) recommended over `userActionLimiter` (5/min) — star toggling can legitimately exceed 5/min during browsing.
2. **Optimistic UI primitive:** `useTransition` + local mirror (codebase consistency with `AllocatorExchangeManager.tsx`) over React 19 `useOptimistic` (not yet adopted in-tree).
3. **Logout route URL** for the cross-account Playwright spec — needs verification by planner (likely user-menu sign-out button, not a `/logout` page).
4. **Playwright cross-account spec** — RESOLVED 2026-04-28 (post-rebase plan-checker pass): `grep -rn "E2E_USER" e2e/ playwright.config.ts` returns zero hits — those env vars are NOT wired. Plan 13-02 Task 3 already encodes the correct fallback path: seed two test users via `seedTestAllocator()` from `e2e/helpers/seed-test-project.ts:60`. That fallback is now the **active** path; do not block on env-var wiring.

## DISCO-03 closed (deferred)

Audit returned 0; no further action in Phase 13 for DISCO-03.

## DISCO-05 backfill (Plan 13-05) — pre-push audit 2026-04-28

- Migration: `supabase/migrations/091_seed_is_example_backfill.sql` (committed `7976ea3`)
- Push outcome: **NOT APPLIED — operator gate raised**
- Pre-push audit count: **0** (`SELECT COUNT(*) FROM strategies WHERE id IN (<8 seed UUIDs>) AND is_example=true`)
- Pre-push seed-UUID presence: **0 of 8** (`SELECT COUNT(*) FROM strategies WHERE id IN (<8 seed UUIDs>)` — no is_example filter)

### Why push was not run in this session

`supabase db push --linked --dry-run` reports two distinct integrity issues that the executor cannot resolve without an explicit operator decision (Rule 4 — architectural change):

1. **Local-side drift (11 unapplied migrations):** local migrations `078, 079, 083, 084, 085, 086, 087, 088, 089, 090, 091` are not present in the remote `schema_migrations` table. Pushing 091 would attempt to apply all 11 in one batch — none of the others are in Plan 13-05 scope, and several (e.g., 086/087 priority queue + analytics-series) carry their own deploy concerns that belong to Phases 11/12 owners.

2. **Remote-side drift (8 timestamp-format migrations):** the remote table has 8 entries the local tree has never seen — `20260424012820, 20260424031238, 20260426193121, 20260428120836, 20260428120919, 20260428142831, 20260428155809, 20260428190907`. The CLI refuses to push until these are either pulled into local (`supabase db pull`) or marked reverted (`supabase migration repair --status reverted <timestamps...>`). Both options mutate state outside Plan 13-05 scope.

3. **Mechanical no-op:** even if push succeeded, the audit count would remain `0` because **no seed UUIDs exist in production** (`seed_uuid_count = 0`). The seeder has not been run against the remote DB. Migration 091 is correct, idempotent, and reusable — but it has nothing to backfill until a future `supabase db reset` + reseed cycle.

### What the operator should do

Pick one path (in priority order):

**Path A — defer Plan 13-05 push to a coordinated migration sweep.** Track 091 alongside 078/079/083–090 in a single deploy ticket; resolve the 8 timestamp-drift entries via `supabase migration repair` after auditing what they were; then run `supabase db push` once for the full batch. This is the safest option and matches the actual deploy cadence (Phase 12 + 13 are still a chain that hasn't fully reached production).

**Path B — push only 091, surgically.** Run `supabase db push --include-all` with explicit migration-repair statements for the 8 timestamp entries (only safe if the operator can verify each one corresponds to an out-of-band hotfix that should be marked applied). Mechanically a no-op against current production data (seed_uuid_count=0).

**Path C — accept the no-op state.** Plan 13-05's e2e contract (Task 3) is exercised against a fresh seed run (`npm run seed` or test harness), not against production. The migration's value is locked in the file and will apply automatically on the next `supabase db reset`. Mark Plan 13-05 done; defer remote application to the same sweep that ships 078–090.

### What runs after the push (whenever it happens)

```sql
-- Verification query (option A: supabase db query --linked)
SELECT COUNT(*) AS audit_count
FROM strategies
WHERE id IN (
  'cccccccc-0001-4000-8000-000000000001',
  'cccccccc-0001-4000-8000-000000000002',
  'cccccccc-0001-4000-8000-000000000003',
  'cccccccc-0001-4000-8000-000000000004',
  'cccccccc-0001-4000-8000-000000000005',
  'cccccccc-0001-4000-8000-000000000006',
  'cccccccc-0001-4000-8000-000000000007',
  'cccccccc-0001-4000-8000-000000000008'
)
AND is_example = true;
```

Pass criterion: `audit_count = 8` if production has been reseeded; `audit_count = 0` if production has not been reseeded yet (still acceptable — migration is a no-op against an empty seed set, the file is correct).

Re-record this section with `applied — count=N` once a push happens.
