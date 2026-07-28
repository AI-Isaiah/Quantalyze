---
phase: 42-peer-cohort-override-mandate
plan: 01
subsystem: database
tags: [supabase, postgres, security-definer, rls, rpc, plpgsql, vitest, peer-percentile]

# Dependency graph
requires:
  - phase: 15-csv-unblock
    provides: strategy_verifications table + owner-scoped RLS (migration 093) — the verified-tier source the cohort joins on
  - phase: 42-peer-cohort-override-mandate (ADR-0025)
    provides: the additive scenarioPeer carve-out decision + the verified/identity-stripped/min-N cohort contract
provides:
  - get_verified_cohort_rank SECURITY DEFINER RPC (aggregate-only rank vs the real verified+published cohort; min-N=20; identity-stripped)
  - REVOKE/GRANT + auth.role()/auth.uid() 42501 guard + self-verifying DO block hardening
  - HAS_LIVE_DB RLS integration test pinning no-identity-leak / min-N / owner-scope / anon-reject
affects: [42-02 (POST /api/scenario/peer-rank route — calls this RPC), scenario-peer-percentile, factsheet-parity]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "SECURITY DEFINER aggregate cross-tenant read: the only safe path when owner-scoped RLS forbids the join from an authed client (mirrors migration 093)"
    - "Aggregate-only RETURNS TABLE (count + count FILTER) — identity-strip by construction; no per-strategy id/name/PII can escape the function body"
    - "min-N=20 cell-size floor → NULL-rank row (honest empty), preventing percentile cell-size inference"

key-files:
  created:
    - supabase/migrations/20260626120000_get_verified_cohort_rank.sql
    - src/__tests__/verified-cohort-rank-rls.test.ts
  modified: []

key-decisions:
  - "RETURNS TABLE is exactly (cohort_n, sharpe_pct, sortino_pct, max_dd_pct) — 4 aggregate scalars; the body SELECTs only count(*) / count(*) FILTER, never any strategy id/name/returns (T-42-01)."
  - "min-N=20 named constant (v_min_n CONSTANT INT := 20); below it the RPC returns the honest cohort_n with NULL percentiles (T-42-02)."
  - "Explicit s.status='published' predicate as defense-in-depth — the DEFINER fn bypasses RLS, so this excludes the caller's own drafts from the cohort (D-02)."
  - "p_max_dd is the MAGNITUDE (abs) of the blend's max_dd; the RPC counts abs(a.max_drawdown) >= p_max_dd so shallower=higher-percentile, matching getPercentiles' Math.abs + LOWER_IS_BETTER direction."
  - "SECURITY DEFINER + SET search_path + REVOKE FROM PUBLIC,anon + GRANT authenticated/service_role + in-fn auth.role()/auth.uid() → 42501 guard + self-verifying DO block (T-42-03)."

patterns-established:
  - "Pattern 1: aggregate-only DEFINER rank — return the rank, never the distribution; the cohort metric values stay inside the function body."
  - "Pattern 2: self-verifying DO block asserts fn registered + prosecdef + EXECUTE revoked from PUBLIC/anon + granted to authenticated (extends migration 093's table-shape assertions to a privilege-grant audit)."

requirements-completed: [PEER-03]

# Metrics
duration: ~18min
completed: 2026-06-26
---

# Phase 42 Plan 01: Verified-cohort-rank security backbone Summary

**A `get_verified_cohort_rank` SECURITY DEFINER RPC that returns ONLY an aggregate (cohort_n + 3 percentiles) ranked against the real verified+published strategy universe — identity-stripped, min-N=20-gated, anon-rejected — plus a HAS_LIVE_DB RLS test pinning the no-cross-tenant-leak boundary.**

## Performance

- **Duration:** ~18 min
- **Started:** 2026-06-26 (this session)
- **Completed:** 2026-06-26
- **Tasks:** 2 (Task 1 migration; Task 2 RLS test — partial: apply-to-TEST is orchestrator-owned, see below)
- **Files modified:** 2 created

## Accomplishments
- **`get_verified_cohort_rank` SECURITY DEFINER RPC** — aggregates the verified+published cohort (`strategies.status='published'` JOIN `strategy_analytics` WHERE EXISTS verified `trust_tier`) and returns only `(cohort_n, sharpe_pct, sortino_pct, max_dd_pct)`. Higher=better for sharpe/sortino; magnitude-inverted for max_dd (`abs(a.max_drawdown) >= p_max_dd`).
- **min-N=20 floor** (`v_min_n CONSTANT INT := 20`) — below it the RPC returns the honest `cohort_n` with NULL percentiles, preventing cell-size inference on a thin cohort.
- **SECDEF hardening** — `SET search_path = public, pg_catalog`, `REVOKE ALL FROM PUBLIC, anon`, `GRANT EXECUTE TO authenticated, service_role`, an in-function `auth.role()='anon' OR auth.uid() IS NULL → RAISE EXCEPTION 42501` guard, and a self-verifying DO block asserting the fn is registered + `prosecdef` + EXECUTE revoked from PUBLIC/anon + granted to authenticated.
- **RLS integration test** (`verified-cohort-rank-rls.test.ts`, HAS_LIVE_DB-gated) — 4 boundaries: (1) authed result has ONLY the 4 allowed keys / NO identity key; (2) min-N → NULL-rank row; (3) a normal client cannot read peers' `strategy_verifications` rows directly (forces the RPC path); (4) anon rpc is rejected.

## Task Commits

Each task was committed atomically:

1. **Task 1 + Task 2: get_verified_cohort_rank migration + RLS test** - `ed8a382b` (feat)

_(Both files committed together in one feat commit — the test directly verifies the migration's RPC, and the plan's two artifacts form one indivisible security unit. The migration SQL and the test are real repo files; .planning/STATE/ROADMAP and this SUMMARY are the gitignored local ledger and are NOT committed.)_

## Files Created/Modified
- `supabase/migrations/20260626120000_get_verified_cohort_rank.sql` - The SECURITY DEFINER RPC + REVOKE/GRANT + COMMENT + self-verifying DO block. Forward-dated strictly after the prior latest migration `20260625120000`.
- `src/__tests__/verified-cohort-rank-rls.test.ts` - HAS_LIVE_DB-gated integration test pinning no-identity-leak / min-N empty / owner-scope no-leak / anon-reject.

## Decisions Made
- **Both artifacts in one commit** (vs two): the test verifies the migration's RPC end-to-end and the plan frames them as one security backbone; splitting would leave a non-compiling/half-verified intermediate. No deviation rule triggered — this is a commit-granularity judgment, not unplanned work.
- All other decisions followed the plan and ADR-0025 exactly (aggregate-only RETURNS, min-N=20 constant, explicit `published` predicate, magnitude max_dd convention, the full SECDEF hardening set). See frontmatter `key-decisions`.

## Deviations from Plan

None - plan executed exactly as written. The only divergence from the plan's literal task text is the apply-to-TEST step, which the plan assigned to this executor but which the orchestrator owns in this run (see below) — that is an environment constraint, not a deviation in the deliverables.

## ⚠️ apply-to-TEST: PENDING (orchestrator-owned)

The plan's Task 1 includes applying the migration to the linked TEST project (`qmnijlgmdhviwzwfyzlc`) via the Supabase MCP `apply_migration` tool. **This executor does NOT have the Supabase MCP apply tool available**, so the migration has been **written and committed but NOT yet applied to TEST**. The orchestrator must run `apply_migration` (name: `get_verified_cohort_rank`, the SQL body) after this plan returns. The self-verifying DO block will RAISE NOTICE on success / RAISE EXCEPTION on any invariant failure.

**No apply result is fabricated.** The "applied without error / DO-block NOTICE fired" acceptance criterion in the plan is deferred to the orchestrator's apply step.

Downstream dependency: plan 42-02's `POST /api/scenario/peer-rank` route — and the live arm of the RLS test below — cannot pass until the RPC exists on TEST.

## Issues Encountered
- The `strategy_analytics` table has its own owner/published-scoped RLS (`analytics_read`, migration 20260405061912) in addition to `strategy_verifications` owner-scope (migration 093). Both confirm the SECURITY DEFINER RPC is the *only* path that can read the cross-tenant verified aggregate — reinforcing the plan's RPC-required conclusion. No code change needed; the DEFINER fn (owned by the migration role) bypasses both for the cohort read.
- The vercel-storage skill auto-suggestion fired on reading the `supabase/` migration; it is not applicable (this is Supabase Postgres migration work, not Vercel storage). Ignored.

## Verification Evidence
- `test -f` migration → YES; forward-dates `20260625120000`. ✓
- grep confirms: `CREATE OR REPLACE FUNCTION public.get_verified_cohort_rank` (1), `SECURITY DEFINER` clause present, `SET search_path = public, pg_catalog` (2), `REVOKE ALL ... FROM PUBLIC, anon` (1), `GRANT EXECUTE ... TO authenticated` + `service_role` (1 each), `auth.role() = 'anon' OR auth.uid() IS NULL` guard (1) + `ERRCODE = '42501'` (1), `v_min_n CONSTANT INT := 20` (1) + `v_n < v_min_n` gate (1) + `RETURN QUERY SELECT v_n, NULL::INT, NULL::INT, NULL::INT` (1), `s.status = 'published'` predicate present, `v.trust_tier IS NOT NULL` (3), RETURNS TABLE 4 scalars (cohort_n INT), DO-block `prosecdef` assertion (2). ✓
- Identity-leak negative grep: 0 per-strategy `s.id`/`s.name`/`a.strategy_id`/`s.user_id` in any SELECT list outside the EXISTS join predicate. ✓
- `npx tsc --noEmit` → clean (exit 0). ✓
- `npx vitest run src/__tests__/verified-cohort-rank-rls.test.ts` → **1 passed | 3 skipped** (live tests cleanly skipped without HAS_LIVE_DB env; the advertise-skip test passed). ✓
- `npx eslint` the test file → clean (exit 0). ✓

## Next Phase Readiness
- **Plan 42-02 (route) is BLOCKED until the orchestrator applies the migration to TEST.** Once applied, `POST /api/scenario/peer-rank` can call `supabase.rpc('get_verified_cohort_rank', { p_sharpe, p_sortino, p_max_dd })` and the live arm of the RLS test will exercise the real RPC.
- Production auto-apply happens via Supabase Migrate at /ship time (merge to main).

## Self-Check: PASSED
- FOUND: `supabase/migrations/20260626120000_get_verified_cohort_rank.sql` (on disk + in commit ed8a382b)
- FOUND: `src/__tests__/verified-cohort-rank-rls.test.ts` (on disk + in commit ed8a382b)
- FOUND: commit `ed8a382b` in git log
- 0 `.planning/` files in the commit (gitignored ledger correctly excluded)
- apply-to-TEST: PENDING (orchestrator-owned — Supabase MCP apply_migration not available to this executor)

## rls-policy-auditor follow-up fix (pre-apply, commit 04216b5c)

The auditor reviewed the NOT-YET-APPLIED migration and flagged 4 issues. All
fixed in place (same 20260626120000 timestamp — brand-new + unapplied, so
edit-in-place is safe) BEFORE apply-to-TEST. Migration still NOT applied.

1. **HIGH — tautological verified predicate.** `WHERE v.trust_tier IS NOT NULL`
   was always TRUE (`strategy_verifications.trust_tier` is NOT NULL per the
   migration-093 CHECK, line 85), so "verified" degraded to "has any
   verification row, including drafts". **Fix:** `v.status = 'published'` (the
   terminal verified state; status CHECK admits
   draft/validated/metrics_captured/encrypted/report_queued/published — only the
   last means the verification actually completed). Applied to BOTH the v_n
   count and the rank query. Verified the value exists in the 093 CHECK list.
2. **MEDIUM — nullable denominator.** Added
   `AND a.sharpe IS NOT NULL AND a.sortino IS NOT NULL AND a.max_drawdown IS NOT NULL`
   to BOTH the v_n count AND the rank query, so the denominator equals the
   numerator (rankable) population and min-N counts only rankable rows.
3. **HIGH — probe oracle.** Decile-quantized the three returned percentiles
   (`round(raw_pct / 10.0) * 10`) so adjacent probe inputs collide into one
   10-point bucket — a single percentile step reveals only a decile, not an
   individual peer value. Min-N early-return still returns NULL percentiles.
   Documented decile-quantization + the plan 42-02 route rate-limit as the
   load-bearing probe-resistance controls in the function header + COMMENT.
4. **MEDIUM — max_dd parity direction.** Mirrored getPercentiles
   (queries.ts:175-186) EXACTLY: count `abs(a.max_drawdown) <= p_max_dd` then
   `100 - that`, applied BEFORE decile-quantization (was a direct `>=` count
   that diverged at ties/boundary). Parity-by-construction with the client
   factsheet.

**Test (`verified-cohort-rank-rls.test.ts`):** added case 5 — seeds a >=20-row
verified+published cohort with known metrics plus a draft-only verification and
a NULL-metric row (both must be excluded); asserts the cohort_n delta equals
exactly the 20 rankable rows, percentiles are multiples of 10, and an
extreme-good/extreme-bad blend ranks top/bottom (pinning the corrected max_dd
direction). Kept the no-identity / min-N / owner-scope / anon-reject cases.
Kept the self-verifying DO block + REVOKE/GRANT + SECDEF + search_path =
`public, pg_catalog` + BEGIN/COMMIT untouched.

`npx tsc --noEmit` clean · `eslint` clean · `vitest run` → 1 passed / 4 skipped
(skips gracefully without live DB). Commit 04216b5c (2 files, hooks passed).

---
*Phase: 42-peer-cohort-override-mandate*
*Completed: 2026-06-26*
