---
phase: 11-onboarding-and-security-readiness
plan: 01
subsystem: database
tags: [postgres, supabase, security-definer, trigger, migration, onboarding-funnel, posthog, jsonb]

# Dependency graph
requires:
  - phase: 05-portfolio-intelligence
    provides: "auth.users.raw_user_meta_data marker pattern (migration 053 increment_user_session_count)"
  - phase: 09-bridge-live-against-real-holdings
    provides: "api_keys schema + Python analytics-service worker that will call stamp_first_sync_success"
provides:
  - "Migration 084 trigger + 2 SECURITY DEFINER functions: stamp_first_api_key_added (trigger) + stamp_first_sync_success (RPC)"
  - "Idempotent first_api_key_added_at marker on auth.users.raw_user_meta_data — uniformly captures all 5 api_keys INSERT call sites without per-route emission"
  - "Symmetric stamp_first_sync_success(p_user_id) RPC for the Python worker (GRANT EXECUTE TO service_role)"
  - "Live-DB regression test (5 behavior tests + RISK-3 NULL-init defensive coverage in 2 variants)"
affects: [11-03-onboarding-funnel-reader, 11-07-onboarding-funnel-e2e, analytics-service-worker]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Postgres trigger as single-fire onboarding marker source (D-13)"
    - "JSONB COALESCE+merge defensive pattern for raw_user_meta_data NULL-initial-state (RISK-3)"
    - "DO block self-verification at migration install time (mirrors 053)"
    - "Live-DB integration test with HAS_INTROSPECTION-gated raw SQL fallback for full NULL-init coverage"

key-files:
  created:
    - "supabase/migrations/084_first_api_key_added_trigger.sql"
    - "src/__tests__/migration-084-trigger.test.ts"
  modified: []

key-decisions:
  - "Trigger fires AFTER INSERT FOR EACH ROW on api_keys (not statement-level) so the trigger function reads NEW.user_id directly — simpler than statement-level + transition tables, and matches migration 053 row-lock semantics."
  - "RPC stamp_first_sync_success uses RPC (not trigger) because the Python analytics-service worker is the canonical fire site; a trigger on allocator_holdings INSERT would fire on every row of every sync, not just on the first successful sync per user."
  - "RISK-3 NULL-init coverage split into Test 5a (full coverage via Management API raw SQL when HAS_INTROSPECTION present) + Test 5b (cleared-metadata fallback when only HAS_LIVE_DB present). Documents exactly what each tier proves in the test comments."

patterns-established:
  - "Single-fire onboarding marker via SECURITY DEFINER + auth.users.raw_user_meta_data — Plans 11-03 (reader) and 11-07 (E2E) consume this contract"
  - "Migration header comment enumerating ALL known table-level INSERT call sites — gives future maintainers a checklist to keep in sync if a new path is added"

requirements-completed: [ONBOARD-05]

# Metrics
duration: 6min
completed: 2026-04-26
---

# Phase 11 Plan 01: Migration 084 first_api_key_added trigger + stamp_first_sync_success RPC Summary

**Postgres AFTER INSERT trigger on api_keys + symmetric service-role RPC stamp idempotent onboarding markers (first_api_key_added_at, first_sync_success_at) on auth.users.raw_user_meta_data — single-fire source-of-truth for the Plan 03 onboarding-funnel reader and Python worker.**

## Performance

- **Duration:** ~6 min (executor only — Task 3 BLOCKING checkpoint awaits user verification)
- **Started:** 2026-04-26T19:16:46Z
- **Completed (worktree):** 2026-04-26T19:22:24Z
- **Tasks:** 2 of 3 complete in worktree (Task 3 = BLOCKING checkpoint, awaits human verification)
- **Files created:** 2

## Accomplishments

- Authored `supabase/migrations/084_first_api_key_added_trigger.sql` (197 lines, transactional `BEGIN`/`COMMIT`) verbatim against the migration 053 template — same SECURITY DEFINER preamble, FOR UPDATE row lock, JSONB COALESCE+merge, REVOKE FROM PUBLIC pattern.
- Both functions (`stamp_first_api_key_added` trigger fn + `stamp_first_sync_success` RPC) carry the defensive `COALESCE(raw_user_meta_data, '{}'::JSONB)` merge so a NULL-initialized column does not crash the trigger (RISK-3 hardening, additional to the inline DO verifier).
- Header comment enumerates all 5 known api_keys INSERT call sites: `create-with-key/route.ts:180`, `finalize-wizard/route.ts:170`, `AllocatorExchangeManager.tsx:485`, `ApiKeyManager.tsx:119`, `StrategyForm.tsx:105` — matches the FLAG fix in the plan brief.
- Self-verifying DO block raises EXCEPTION at install time if either function or the trigger is missing or not SECURITY DEFINER; emits 2 NOTICE messages on success (one per function/trigger pair).
- Live-DB regression test (`src/__tests__/migration-084-trigger.test.ts`, 304 lines) covers 5 behavioral assertions plus a tiered RISK-3 NULL-init defensive check: Test 5a uses Management API raw SQL to set `raw_user_meta_data = NULL` strictly, Test 5b approximates the case via `auth.admin.updateUserById` when introspection is unavailable.
- Without live env: vitest reports `1 passed | 6 skipped (7)` — clean skip-gate, no false failures, no orphan resources.

## Task Commits

Each task was committed atomically with `--no-verify` (worktree-mode requirement):

1. **Task 1: Author migration 084 with trigger + RPC + DO verifier** — `4a7e3f3` (feat)
2. **Task 2: Live-DB regression test for trigger + RPC behavior + NULL-init defensive case** — `ba522b1` (test)
3. **Task 3: BLOCKING — Apply migration 084 to production via `supabase db push`** — pending human verification (executor returned checkpoint)

_Note: Task 2 is a TDD task (`tdd="true"` in plan), but tests are gated behind `HAS_LIVE_DB`/`HAS_INTROSPECTION` — RED/GREEN cadence does not apply at the unit-test layer because the trigger is a Postgres-only artifact unobservable without a live DB round-trip. Functional GREEN is the live-DB green run after Task 3 push._

## Files Created/Modified

- `supabase/migrations/084_first_api_key_added_trigger.sql` (197 lines) — Trigger + 2 SECURITY DEFINER functions + DO verifier; transactional, idempotent on re-run via `CREATE OR REPLACE` + `DROP TRIGGER IF EXISTS`.
- `src/__tests__/migration-084-trigger.test.ts` (304 lines) — 5 behavior tests + 1 always-run advertise-skip-reason informational test; afterAll cleanup via shared `cleanupLiveDbRow` helper.

## Decisions Made

- Followed plan as specified — D-13 trigger pattern, migration 053 template, RISK-3 + FLAG fixes already folded into the plan brief and into the migration header.
- Test 5 split into 5a (full Management API raw SQL coverage) + 5b (admin-API approximation) with `it.skipIf` gating each on the relevant env vars. Both variants cite RISK-3 explicitly in their test names so the coverage layer is self-documenting in vitest output.

## Deviations from Plan

None — plan executed exactly as written. Migration 084 is byte-faithful to the migration 053 SECURITY DEFINER + JSONB COALESCE+merge template; no new patterns introduced. The header comment enumeration of api_keys INSERT call sites matches the plan's required ≥4 paths (5 cited including `finalize-wizard/route.ts:170`).

## Issues Encountered

- Initial Read of context files used the parent repo path; reissued with the worktree-local path after copying `.planning/PROJECT.md` + `.planning/STATE.md` + `.planning/config.json` + `.planning/phases/11-onboarding-and-security-readiness/` into the worktree (these were not pre-staged in the worktree by the orchestrator). No deviation — purely a context-loading procedural step.

## User Setup Required

**Task 3 BLOCKING checkpoint requires human action.** The migration must be applied to the live Supabase project before Plan 11-03 (the reader that scans for these markers) and the Python analytics-service worker (which will call `stamp_first_sync_success`) can be wired in subsequent plans.

**Verification procedure (human-driven):**

1. Run `supabase db push` in the project root.
2. Expected output:
   - `Applying migration 084_first_api_key_added_trigger.sql`
   - `NOTICE: Migration 084: stamp_first_api_key_added trigger installed and verified.`
   - `NOTICE: Migration 084: stamp_first_sync_success RPC installed and verified.`
   - Exit code 0.
3. Verify via psql/MCP:
   ```sql
   SELECT proname, prosecdef FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
   WHERE n.nspname = 'public' AND proname IN ('stamp_first_api_key_added', 'stamp_first_sync_success');
   ```
   Expected: both rows, both `prosecdef = true`.
4. If migration-history drift surfaces (cosmetic timestamp-format vs file-prefix versions, per Phase 07 + 08 precedent in STATE.md), run `supabase migration repair --status reverted <drifted-versions>` first, then retry `supabase db push --include-all`.
5. Run the live-DB test:
   ```bash
   HAS_LIVE_DB=1 npx vitest run src/__tests__/migration-084-trigger.test.ts
   ```
   Expected: 5 behavior tests green (Test 5a additionally requires `SUPABASE_ACCESS_TOKEN` + `SUPABASE_PROJECT_REF` for Management API access; Test 5b skips when 5a runs and vice versa).

The orchestrator/continuation agent is expected to:
- Append push outcome (NOTICE messages, drift-repair commands if any) to a follow-up `## Task 3 — Post-Push Outcome` section in this SUMMARY.
- Document the live-DB test result (skipped vs passing per env tier).

## Next Phase Readiness

- **Plan 11-03 (reader):** Once Task 3 is verified, Plan 11-03 can scan `auth.users.raw_user_meta_data` for `first_api_key_added_at` / `first_sync_success_at` keys and emit the corresponding PostHog onboarding-funnel events server-side.
- **Python analytics-service worker:** Once Task 3 is verified, the worker can call `stamp_first_sync_success(p_user_id)` via the service-role REST RPC after the first successful `persist_allocator_holdings` for an allocator (Plan 11-03 wires this).
- **Migration sequence:** 083 → 084 (next available number 085 onwards is free for subsequent Phase 11 plans).
- **Plan 11-07 (E2E):** Onboarding-funnel spec asserts the markers (and their derived PostHog events) fire end-to-end. Depends on the trigger + RPC being live.

## Threat Flags

None — the migration introduces no new HTTP surface, no new auth flow, no new RLS policy, and no new public API. It strengthens an existing trust boundary (auth.users.raw_user_meta_data write path) by funneling all stamps through SECURITY DEFINER functions with locked search_path and REVOKE-FROM-PUBLIC.

## Self-Check: PASSED

- File `supabase/migrations/084_first_api_key_added_trigger.sql` — FOUND
- File `src/__tests__/migration-084-trigger.test.ts` — FOUND
- Commit `4a7e3f3` (Task 1 feat) — FOUND in `git log --oneline`
- Commit `ba522b1` (Task 2 test) — FOUND in `git log --oneline`
- Acceptance grep checks for Task 1 — all PASSED (`SECURITY DEFINER` ≥ 5, `search_path` 2, `FOR UPDATE` 2, `REVOKE ALL ON FUNCTION` 2, `COALESCE...JSONB` 5, `service_role` GRANT 1, `AFTER INSERT ON api_keys` 1, both NOTICE messages present, all 4 INSERT call sites enumerated, BEGIN/COMMIT present).
- Acceptance grep checks for Task 2 — all PASSED (file exists, marker keywords ≥ 22, env-gate present 8 occurrences, cleanup present, NULL-init defensive case present).
- Vitest run without live env: `1 passed | 6 skipped (7)` — clean skip-gate.
- TypeScript check: clean (`tsc --noEmit` exits 0 with no migration-084 errors).
- ESLint: clean (no warnings on the test file).

---
*Phase: 11-onboarding-and-security-readiness*
*Plan: 01*
*Completed in worktree: 2026-04-26*
*Task 3 BLOCKING checkpoint: pending human verification of `supabase db push`*
