---
phase: 126-factsheet-connected-key-api-verified-factsheet-render-blocki
plan: 04
subsystem: database
tags: [supabase, security-definer, rls, trust-tier, rpc, nextjs-rsc, allocations, vitest]

# Dependency graph
requires:
  - phase: 126-factsheet-connected-key-api-verified-factsheet-render-blocki
    plan: 01
    provides: readPublicVerificationSignals (app-layer service-role trust_tier+status projection) + the 2 flagged allocations-subsystem class members
provides:
  - "get_published_trust_signals(uuid[]) — a SECURITY DEFINER, published-gated, column-scoped (strategy_id/trust_tier/status) DB primitive; anon+authenticated+service_role EXECUTE; the ONLY public exposure of strategy_verifications (table stays owner-locked)"
  - "readPublicVerificationSignals now reads the primitive via a NORMAL server client (no createAdminClient / service-role) — the single typed public trust-signal reader"
  - "returns route + watchlist-read repointed off their owner-only RLS strategy_verifications embeds — non-owner viewers now see the correct trust_tier"
affects: [factsheet, browse, discovery, allocations, watchlist, scenario-drawer, trust-tier]

# Tech tracking
tech-stack:
  added:
    - "public.get_published_trust_signals(uuid[]) SECURITY DEFINER SQL function (migration 135)"
  patterns:
    - "Correct-by-construction public signal: RETURNS TABLE is the column allow-list, WHERE status='published' is the gate, pinned search_path lets anon read WITHOUT RLS widening"
    - "App-layer trust boundary replaced by a DB primitive so every reader routes through one gate (no per-reader projection contract to forget)"

key-files:
  created:
    - supabase/migrations/20260719140000_get_published_trust_signals.sql
  modified:
    - src/lib/queries.ts
    - src/lib/database.types.ts
    - src/app/api/strategies/[id]/returns/route.ts
    - src/app/(dashboard)/allocations/lib/watchlist-read.ts
    - src/lib/queries.public-verification.test.ts
    - src/app/api/strategies/[id]/returns/route.test.ts
    - src/app/(dashboard)/allocations/lib/watchlist-read.test.ts

key-decisions:
  - "Replace the app-layer service-role trust_tier projection (126-01 Option B) with a DB primitive — the trust boundary moves from TypeScript (every reader must remember the contract) to a single SECURITY DEFINER function that is correct by construction."
  - "The primitive is published-gated with NO auth.uid() owner-inclusion: it exposes the PUBLIC provenance signal only. Consequence: an owner viewing their OWN unpublished strategy's tier via a repointed reader now sees null (a draft has no public provenance). Accepted — matches the published-only semantics of every public factsheet reader."
  - "queries.ts:3379 getMyAllocationDashboardData's ADMIN-client owner-book strategy_verifications embed is NOT repointed — it uses the service-role client (returns rows correctly, no non-owner gap) and reads the allocator's OWN book (portfolio-owned, may include private rows). Surfaced, not silently expanded — repointing it to the published-gate would drop tier for owner's own non-published book strategies."

patterns-established:
  - "get_published_trust_signals: batched, published-gated, column-scoped public trust-signal primitive — the sole app-code reader is readPublicVerificationSignals."

requirements-completed: [FACTSHEET-01]

# Metrics
duration: ~45min
completed: 2026-07-19
---

# Phase 126 Plan 04: Correct-by-construction public trust-signal primitive Summary

**Replaced the app-layer service-role `trust_tier` projection (126-01 Option B) with a `SECURITY DEFINER`, published-gated, column-scoped DB primitive — `get_published_trust_signals(uuid[])` (migration 135) — granted anon EXECUTE, and repointed every public trust_tier reader at it, including the two flagged allocations-subsystem members so a logged-in non-owner never sees less trust signal than an anon visitor. The `strategy_verifications` table stays owner-locked; the function's RETURNS TABLE signature is the column allow-list.**

## Performance

- **Duration:** ~45 min
- **Tasks:** migration + repoint all readers + RED-proven regression (single atomic delivery)
- **Files:** 1 created (migration), 7 modified (4 source, 3 tests)

## What shipped

### The DB primitive (migration 135 — NOT applied by the executor)
`supabase/migrations/20260719140000_get_published_trust_signals.sql`:
- `CREATE OR REPLACE FUNCTION public.get_published_trust_signals(p_strategy_ids uuid[]) RETURNS TABLE (strategy_id uuid, trust_tier text, status text)` — `LANGUAGE sql`, `SECURITY DEFINER`, `SET search_path = public, pg_temp` (pinned), `STABLE`. Body: `DISTINCT ON (sv.strategy_id)` most-recent verification (`ORDER BY sv.strategy_id, sv.created_at DESC`) joined to `strategies` `WHERE s.status = 'published' AND sv.strategy_id = ANY(p_strategy_ids)`. All source columns alias-qualified so the OUT params never shadow.
- `REVOKE ALL ... FROM PUBLIC;` then `GRANT EXECUTE ... TO anon, authenticated, service_role;` — least privilege, explicit grantees.
- **No RLS policy added to `strategy_verifications`, no grant altered** — the table stays owner-locked (migration 093 3-tier RLS). The function is the ONLY public exposure, column-scoped by its signature.
- **Self-verify DO block:** structural asserts (function exists, `prosecdef`, pinned `proconfig` search_path, anon `has_function_privilege EXECUTE`) + a **behavioral published-gate proof** — seeds one published + one non-published strategy (user_id from `public.profiles`, mirroring `finalize_csv_strategy`'s proven insert shape) inside a savepoint that is ALWAYS rolled back via a sentinel `SQLSTATE 'ZZ135'`, capturing signal counts into outer-scoped vars that survive the rollback, then asserts the published one returns 1 and the non-published one returns 0. Zero seed residue. Skips gracefully (structural asserts still enforced) if no `profiles` row exists.

**NOT MCP-applied.** The orchestrator applies to TEST (`qmnijlgmdhviwzwfyzlc`) after the rls-policy-auditor + migration-reviewer pass. Prod untouched.

### Readers repointed (one primitive, correct by construction)
- **`readPublicVerificationSignals` (queries.ts):** the `createAdminClient()` direct table read → `.rpc('get_published_trust_signals', { p_strategy_ids })` via a NORMAL server client (`createClient`). Same signature, same fail-soft (error → empty map → null tier → badge hides, page 200s). This auto-covers `getPublicStrategyDetail`, `getStrategiesByCategory`, `getStrategyDetail`, and `/factsheet/[id]/v2` (all already call the helper). No service-role client for the public signal anymore.
- **`get_published_trust_signals` typed** in `database.types.ts` Functions (`Args: { p_strategy_ids: string[] }`, `Returns: { status, strategy_id, trust_tier }[]`) so the `.rpc(...)` call typechecks against `SupabaseClient<Database>`.
- **`src/app/api/strategies/[id]/returns/route.ts`:** the probe select dropped its owner-only `strategy_verifications (...)` embed (now `id, asset_class`); trust_tier comes from `readPublicVerificationSignals([id])`. A non-owner allocator adding another manager's published strategy to the scenario drawer now gets the correct tier.
- **`src/app/(dashboard)/allocations/lib/watchlist-read.ts`:** the `user_favorites → strategies → strategy_verifications` embed dropped to `strategies!inner (name)`; trust_tier batched via `readPublicVerificationSignals(strategyIds)`. An allocator's watchlist badges for favorited (non-owner) strategies now render.

Post-repoint grep: no remaining `createClient`-based RLS-embed read of `strategy_verifications.trust_tier` for a public signal. (The one remaining `admin`-client embed at `queries.ts:3379` is the owner's-own-book dashboard read — see Deviations.)

## Regression tests (RED-proven)

- **`queries.public-verification.test.ts` (8 tests):** rewired to the RPC path. Guards: maps ONLY `trust_tier`+`status` (drops any extra columns the RPC returns); reads via `get_published_trust_signals` with `p_strategy_ids` NOT a raw table SELECT (`selectCols` stays empty); latest-per-strategy keep-first; fail-soft empty map + Sentry on error; short-circuit empty input; and the `getStrategyDetail` integration (non-owner sees `api_verified` via the RPC, keyed on the id). **RED-proven live this session:** neutering the app-layer mapping to spread the whole row (`{ ...row }`) fails the projection-leak guard (`exposes ONLY trust_tier + status`); restoring → 8/8 green.
- **`route.test.ts` (returns route, 19 tests):** R9/R9b now feed the tier through the mocked primitive; R4c asserts the probe select NO LONGER contains `strategy_verifications`; R8 (no-admin-client) still holds. 19/19 green.
- **`watchlist-read.test.ts` (8 tests):** trust_tier sourced from the mocked primitive keyed by strategy_id; the 42703-slug guard extended to also fail on any re-added `strategy_verifications` embed. 8/8 green.
- The **behavioral published-gate** ("non-published strategy returns NO signal") is proven at apply-time by the migration's self-verify DO block (real DB), the correct home for a DB-behavior assertion (the vitest suite has no live DB in CI).

## Deviations from Plan

### Auto-fixed / scoped decisions

**1. [Rule 3 - blocking] Typed the RPC in `database.types.ts`.** `.rpc("get_published_trust_signals", ...)` does not typecheck against `SupabaseClient<Database>` unless the function is in the generated `Functions` map. Added the `Args`/`Returns` entry (alphabetically before `get_user_compute_jobs`) so `tsc --noEmit` passes. Correctness requirement for the repoint to compile.

**2. [Rule 3 - blocking] Mocked `@/lib/queries` in the two allocations tests instead of importing the real helper.** The returns route now transitively imports the large `queries.ts` module graph (server-only, env). To keep the route + watchlist unit tests hermetic, both mock `readPublicVerificationSignals` (consistent with how they already isolate the DB), feeding trust signals directly and pinning that each reader routes trust_tier through the helper keyed by strategy_id.

**3. [Scope boundary - surfaced, not expanded] `queries.ts:3379` `getMyAllocationDashboardData` retains its `admin`-client `strategy_verifications (trust_tier, status, created_at)` embed.** It uses the SERVICE-ROLE client (returns rows correctly — no non-owner visibility gap, so NOT the broken class the two flagged members exhibited), reads the allocator's OWN book (`portfolio_strategies` gated by `portfolio_id`, may legitimately include the owner's private rows), and was deliberately NOT in 126-01's flagged list. Repointing it to the published-gated primitive would DROP trust_tier for an owner's own non-published book strategies — a behavior change outside this plan's two-member scope. Left as-is and surfaced here for the reviewer.

**4. [Accepted behavior note] Owner-own-unpublished tier via a repointed reader is now null.** The primitive is published-gated with no `auth.uid()` owner-inclusion (it is the PUBLIC provenance signal). In the returns route, an owner requesting THEIR OWN unpublished strategy (admitted by the `withPublishedOrOwner` probe) now gets `trust_tier: null` (a draft has no public provenance). The scenario composer warm-up-gates on `daily_returns`, not tier, so no functional regression; the badge simply doesn't show for an unpublished draft — consistent with every public factsheet reader being published-only.

## Threat Model

This is a `SECURITY DEFINER` function newly readable by `anon` — a trust boundary. Mitigations (all correctness requirements, present in migration 135):

| Threat | Mitigation | Where |
|--------|-----------|-------|
| search_path hijack (attacker plants a function in `pg_temp`/`pg_catalog` and waits for the SECDEF call to resolve to it) | `SET search_path = public, pg_temp` PINNED on the function; asserted via `proconfig` in the self-verify DO block | migration STEP 1 + STEP 3(c) |
| Over-broad EXECUTE / privilege drift | `REVOKE ALL FROM PUBLIC` then explicit `GRANT EXECUTE TO anon, authenticated, service_role` (least privilege); anon-EXECUTE asserted | migration STEP 2 + STEP 3(d) |
| Verification-internals leak (wizard_session_id / flow_type / source / metrics_snapshot / errors / correlation_id) | `RETURNS TABLE (strategy_id, trust_tier, status)` is the column allow-list — internals are structurally unreachable; app-layer mapping additionally drops anything beyond the two public fields (RED-proven) | migration STEP 1 + `queries.public-verification.test.ts` |
| Unpublished-strategy signal exposure | `WHERE s.status = 'published'` published-gate; behaviorally proven (published→1 row, non-published→0 rows) in the self-verify DO block | migration STEP 1 + STEP 3(e) |
| RLS-widening blast radius on `strategy_verifications` | NO policy added, NO grant altered — the table stays owner-locked; the function is the sole public exposure | migration (explicit non-goal) |

No new network endpoint, no new auth path, no schema change at a trust boundary beyond this one deliberately-scoped read. No secrets in the diff or this SUMMARY (`eyJ`/`sbp_`/`sk_live`/`SUPABASE_SERVICE` grep → 0).

## Verification

- `npx tsc --noEmit` → exit 0.
- `npm run lint` → 0 errors (1 pre-existing `react-hooks/exhaustive-deps` warning in an unrelated `EquityChart.tsx`; admin-route + route-contract manifest checks OK).
- `queries.public-verification.test.ts` 8/8, `route.test.ts` 19/19, `watchlist-read.test.ts` 8/8 (35 total) green; RED-proven by neutering the projection.
- Migration NOT applied — orchestrator applies to TEST post-audit.

## Self-Check: PASSED

- Migration file present on disk: `supabase/migrations/20260719140000_get_published_trust_signals.sql`.
- All 7 modified source/test files present and typecheck-clean.
- No secrets in diff or SUMMARY.
- Commit `3d40d925` present in git history (8 files changed, +469/-194, migration created; no deletions).
