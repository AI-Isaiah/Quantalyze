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
- Migration `089_organizations_is_public.sql` is **NOT shipped** in Phase 13.
- DISCO-03 (filter-by-team UI) is **DEFERRED to v0.18**.
- Phase 13 in-scope reduces to DISCO-01, DISCO-02, DISCO-04, DISCO-05 (4 of 5 REQs).

**Re-evaluation trigger:** Re-run the audit query at the start of v0.18 milestone planning. If `audit_count > 0` at that time, ship migration 089 + filter UI as a v0.18 phase deliverable. Pitfall 18 mitigation (privacy gate via `is_public BOOLEAN DEFAULT false`) remains the locked design — only the *timing* moves.

## Migration numbering (resolved 2026-04-28)

- Highest migration shipped on `main` (post-PR-#81): `088_cutover_strategy_metrics_keys.sql` (Phase 12 WR-04).
- Phase 13 deferred its only conditional migration (089) per audit-count=0 above.
- No new migration files in Phase 13 except a possible data-only DML migration for DISCO-05 (`is_example=true` seed backfill) — sequence number assigned at plan-phase time relative to migration board state.

## Seed UUIDs (resolved 2026-04-28 from research)

`scripts/seed-demo-data.ts` defines `STRATEGY_UUIDS = ['cccccccc-0001-4000-8000-000000000001' .. '..-000000000006']` (6 UUIDs). The DISCO-05 data migration hard-codes those 6 UUIDs in the `WHERE id IN (...)` clause — no `created_by` query, no `name ILIKE` fallback (CONTEXT.md's `created_by` reference uses a column name that does not exist on `strategies`; correct column would be `user_id`, but a hard-coded list is simpler and safer).

## Open questions for planner

(Open questions from RESEARCH.md that survive the audit-count=0 simplification:)

1. **Watchlist PUT rate limiter:** `mandateAutoSaveLimiter` (30/min) recommended over `userActionLimiter` (5/min) — star toggling can legitimately exceed 5/min during browsing.
2. **Optimistic UI primitive:** `useTransition` + local mirror (codebase consistency with `AllocatorExchangeManager.tsx`) over React 19 `useOptimistic` (not yet adopted in-tree).
3. **Logout route URL** for the cross-account Playwright spec — needs verification by planner (likely user-menu sign-out button, not a `/logout` page).
4. **Playwright cross-account spec** — confirm test-user env vars (`E2E_USER_A_EMAIL` / `_PASSWORD` / `E2E_USER_B_EMAIL` / `_PASSWORD` or similar) are wired into Playwright CI; if not, descope DISCO-02 cross-account spec to manual UAT.

## DISCO-03 closed (deferred)

Audit returned 0; no further action in Phase 13 for DISCO-03.
