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
