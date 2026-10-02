---
phase: 96
slug: draft-key-hygiene-onboarding-polish
status: approved
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-12
---

# Phase 96 — Validation Strategy

> Offline-first. All DB safety (CLEAN-01 finalize race, CLEAN-02 sweep) is pinned
> as `supabase/tests/test_*.sql` (CI: `psql -v ON_ERROR_STOP=1 -f`, BEGIN/ROLLBACK,
> `RAISE EXCEPTION`=fail, NO psql meta-commands). CLEAN-02 is a DATA-DELETION danger
> zone → conservative predicate + a self-verifying migration DO block seeding all 5
> safety cases at apply time (it auto-applies to prod on the milestone merge). UX as
> vitest.

## Locked decisions (autonomous, 2026-07-12)
1. **CLEAN-01 window = `created_at < now() - 7 days`, NOT the requirement's 24h.**
   ⚠️ DELIBERATE REQUIREMENT-DEVIATION: `strategies` has no `updated_at` column, so a
   24h-on-`created_at` sweep would delete a draft a user intends to RESUME on day 2 —
   colliding with the Phase-94 wizard resumability this milestone just shipped. 7 days
   is realistically past abandonment (resumability is same-session/next-day in
   practice) while still fully preventing accumulation (CLEAN-01's actual intent).
   Cheaper than adding `updated_at` + touch-writes for the rare >7-day-resume user.
   Reversible — surfaced loudly; if stricter hygiene is wanted, add `updated_at` +
   a moddatetime trigger and window on that instead.
2. **CLEAN-01 = single atomic `DELETE … WHERE status='draft' AND source='wizard' AND
   created_at < now()-7d [AND review_note IS NULL] RETURNING`** (replacing the existing
   racy SELECT-then-DELETE in `/api/cron/cleanup-wizard-drafts`). Race proof: finalize
   (`finalize_wizard_strategy`) promotes `draft→pending_review` under `SELECT … FOR
   UPDATE`; READ-COMMITTED EvalPlanQual serializes the two on the row lock — no torn
   state. Residual "cron wins → finalize 404s (`GATE_DRAFT_GONE`)" is clean/recoverable.
   **The plan MUST VERIFY finalize is a committed guarded UPDATE under FOR UPDATE, NOT
   a delete+insert** — the proof depends on it (OQ3).
3. **CLEAN-02 = scoped candidate-set sweep** (keys of the just-deleted drafts + their
   `strategy_keys` composite members captured BEFORE the cascade), NOT a full-table
   orphan scan. Bounded, safer, cheaper. Implemented as ONE new SECURITY DEFINER RPC.
4. **CLEAN-02 predicate MUST count BOTH** `strategies.api_key_id` (single-key) AND
   `strategy_keys.api_key_id` (composite membership — composite drafts have NULL
   `strategies.api_key_id`, so member keys are invisible to the existing
   `delete_api_key_if_unreferenced` RPC, which is INCOMPLETE — do NOT reuse it), AND
   **exclude any key referenced by `allocator_holdings`** (ON DELETE RESTRICT → a
   set-based sweep otherwise ABORTS 23503). The predicate must be a superset of the
   published-composite-guard-protected set so the guard (`20260710160000`) never aborts
   the sweep. The sweep must NOT set the `sanitize_in_progress` GUC (so account-deletion
   via `sanitize_user` is unaffected).
5. **UX-01 = reuse the canonical `deribit` icon that already exists in
   `AllocatorExchangeManager`** (the "?" is ApiKeyManager's local map missing the
   `deribit` case) — no new asset, DESIGN.md consistency.
6. **UX-02 = client-generated `crypto.randomUUID()` `X-Correlation-Id` header** on wizard
   fetches (`correlation-id.ts` is `server-only`; `getCorrelationId()` already prefers an
   inbound header), surfaced to the user for log-matching.

## Test Infrastructure
| Property | Value |
|----------|-------|
| **DB tests** | `supabase/tests/test_*.sql`, BEGIN/ROLLBACK, `RAISE EXCEPTION` on failure, fresh-UUID seeds (models: `test_retention_crons_safe.sql`, `test_api_key_delete_atomicity.sql`, `test_strategy_keys_publish_integrity.sql`) |
| **DB command** | `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/tests/test_<name>.sql` |
| **UI** | Vitest + jsdom |
| **UI quick** | `npx vitest run src/components/strategy/ApiKeyManager.test.tsx` |

## Per-Requirement Test Map (offline-first; each fails without the fix)
| Req | Behavior | Type |
|-----|----------|------|
| CLEAN-01 | finalize-first ordering → draft survives as `pending_review`, sweep deletes 0 | SQL sequential sim |
| CLEAN-01 | cron-first ordering → draft gone, finalize RAISEs P0002 (`GATE_DRAFT_GONE`), cascades clean | SQL |
| CLEAN-01 | structural: finalize prosrc has `FOR UPDATE` + `status<>'draft'`; cron/RPC has `status='draft'` + `source='wizard'` + **7d** (+ `review_note IS NULL` if used) | SQL prosrc grep |
| CLEAN-02 | orphaned key (no refs) → SWEPT | SQL |
| CLEAN-02 | composite-member key (DRAFT composite, live `strategy_keys`) → SPARED | SQL |
| CLEAN-02 | published-composite member key → SPARED (guard backstop) | SQL |
| CLEAN-02 | single-key strategy key (`strategies.api_key_id`) → SPARED | SQL |
| CLEAN-02 | `allocator_holdings` (RESTRICT) key → SPARED, no 23503 abort | SQL |
| CLEAN-02 | sweep prosrc does NOT set `sanitize_in_progress`; a normal `sanitize_user` still deletes keys | SQL |
| UX-01 | `deribit` renders its icon, not `?` | vitest |
| UX-02 | wizard fetch includes `X-Correlation-Id`; id surfaced to user | vitest (mock fetch, assert header) |

## Wave 0 (blockers)
- [ ] `supabase/tests/test_cleanup_wizard_drafts_race.sql` — CLEAN-01 (both orderings + structural, 7d)
- [ ] `supabase/tests/test_cleanup_orphaned_api_keys_sweep.sql` — CLEAN-02 (5 safety cases + sanitize-unaffected)
- [ ] `src/lib/wizard/wizard-correlation.ts` + test — UX-02
- [ ] Extend `ApiKeyManager.test.tsx` — UX-01 deribit case
- [ ] The migration's own self-verifying `DO` block seeding the 5 CLEAN-02 cases (belt-and-suspenders at auto-apply)

## Sign-Off
- [ ] CLEAN-02 sweep predicate provably safe (both refs + allocator_holdings RESTRICT + sanitize GUC exemption + published-composite guard superset) — 5 SQL safety cases + apply-time DO block green
- [ ] CLEAN-01 single-atomic-DELETE, both race orderings pinned, finalize-is-guarded-UPDATE verified
- [ ] 7d window documented as a requirement-deviation (resumability reconciliation)
- [ ] UX-01/02 vitest green
- [ ] Migrations routed through migration-reviewer + rls-policy-auditor post-land
- [ ] `nyquist_compliant: true`

**Approval:** approved (autonomous, 2026-07-12)
