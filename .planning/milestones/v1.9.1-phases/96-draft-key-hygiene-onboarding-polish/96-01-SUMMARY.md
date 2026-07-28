---
phase: 96-draft-key-hygiene-onboarding-polish
plan: 01
subsystem: database
tags: [postgres, sql-tests, plpgsql, api_keys, wizard-drafts, gdpr, race-condition, cleanup-cron]

# Dependency graph
requires:
  - phase: 94-wizard-resumability
    provides: "wizard draft resumability that forces the 7d (not 24h) cleanup window"
  - phase: 87-published-composite-guard
    provides: "enforce_api_keys_published_composite_integrity BEFORE DELETE guard + sanitize exemption"
provides:
  - "OQ3 gate verdict: every draft→pending_review promotion is a committed guarded UPDATE (no delete+insert) — CLEAN-01 EPQ race proof precondition holds"
  - "RED CLEAN-01 race test (supabase/tests/test_cleanup_wizard_drafts_race.sql)"
  - "RED CLEAN-02 sweep test (supabase/tests/test_cleanup_orphaned_api_keys_sweep.sql)"
affects: [96-02-cleanup-rpc-migration, cleanup-wizard-drafts-cron]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Offline-first SQL safety net authored RED before the migration exists (repro-gate); 96-02 turns it green"
    - "Structural prosrc pins + behavioral seeded-id-only asserts in one BEGIN/ROLLBACK file"

key-files:
  created:
    - supabase/tests/test_cleanup_wizard_drafts_race.sql
    - supabase/tests/test_cleanup_orphaned_api_keys_sweep.sql
  modified: []

key-decisions:
  - "OQ3 PASSES: the only strategies.status='pending_review' writes in the whole codebase are the finalize_wizard_strategy RPC's guarded UPDATE; no delete+insert promotion exists on any path"
  - "Sweep call asserted via table state (Case A/F keys GONE) rather than an unspecified swept_keys return column — avoids coupling to a not-yet-locked RPC return shape"
  - "sanitize_user structural GUC pin is a tolerant NOTICE (test-DB re-sync drift); the MANDATORY sanitize proof is behavioral (Warning-3)"

patterns-established:
  - "T-96-01: pin finalize's FOR UPDATE + <> 'draft' guard in the race test so a future finalize rewrite that breaks OQ3 reddens the safety net"

requirements-completed: [CLEAN-01, CLEAN-02]

# Metrics
duration: 30min
completed: 2026-07-12
---

# Phase 96 Plan 01: Draft/Key-Hygiene Safety Net + OQ3 Gate Summary

**OQ3 gate PASSES (every draft→pending_review promotion is a committed guarded UPDATE, no delete+insert), plus two RED offline-first SQL safety tests for the CLEAN-01 cleanup race and the CLEAN-02 api_key sweep, authored before the destructive migration exists.**

## Performance

- **Duration:** ~30 min
- **Completed:** 2026-07-12
- **Tasks:** 3 (Task 1 read-only gate; Tasks 2-3 each a committed test file)
- **Files created:** 2

## Accomplishments

- **OQ3 GATING VERIFY — PASS.** Exhaustively traced every draft→pending_review promotion path; all are committed guarded UPDATEs. No delete+insert exists. The CLEAN-01 EvalPlanQual race proof (VALIDATION decision 2) is valid; the phase proceeds.
- **CLEAN-01 RED race test** — both orderings + structural pins + 7d window + M-0255 spare.
- **CLEAN-02 RED sweep test** — 5 safety cases + pre-cascade capture + MANDATORY behavioral sanitize-unaffected.

## OQ3 Verification Evidence (Task 1 — the gate)

**Verdict: PASS — no promotion path is delete+insert. Every `strategies.status='pending_review'` write is a guarded UPDATE.**

Promotion write-site inventory (cited file:line, each confirmed a committed guarded UPDATE, never delete+insert):

1. **Classic finalize RPC — `finalize_wizard_strategy`** (`supabase/migrations/20260521185008_wizard_finalize_inserts_verification.sql`):
   - `:79-83` — `SELECT status, source, user_id, api_key_id INTO … FROM strategies WHERE id = p_strategy_id FOR UPDATE` (row lock present).
   - `:85-88` — `IF v_current_status IS NULL THEN RAISE … ERRCODE='no_data_found'` (P0002 not-found / GATE_DRAFT_GONE fail-loud).
   - `:102-106` — `IF v_current_status <> 'draft' THEN RAISE` (draft guard).
   - `:108-121` — `UPDATE strategies SET … status = 'pending_review' WHERE id = p_strategy_id`. The only INSERT in the body (`:142-156`) targets `strategy_verifications`, NOT `strategies`. **Guarded UPDATE confirmed.**

2. **Composite finalize** — the unified backbone arm REJECTS composites (`src/app/api/strategies/finalize-wizard/route.ts:1105-1126`, `COMPOSITE_UNSUPPORTED_UNIFIED` 409), so composite finalize always flows through the legacy path (`route.ts:713-714`) → the SAME `finalize_wizard_strategy` RPC (guarded UPDATE). The `stitch_composite` queue (`analytics-service/services/job_worker.py:2880 run_stitch_composite_job`) is analytics-only and never writes `strategies.status`. **No delete+insert.**

3. **Unified single-key onboard arm** — `route.ts:1128 postProcessKey({flow_type:'onboard'})` → `analytics-service/routers/process_key.py`. This arm inserts a `strategy_verifications` draft row (`process_key.py:712-728`) and enqueues `process_key_long`; it does NOT itself write `strategies.status`. The `status:"pending_review"` at `process_key.py:693` and `route.ts:995/1170/1182` are JSON **response** fields (response-shape translation), not DB writes. No analytics `strategies` write sets `status` (all `strategies` writes in analytics are `SELECT` or `fingerprint` UPDATEs — `process_key.py:974`, `long_fetch.py:435`). **No delete+insert.**

4. **`finalize_csv_strategy`** (`20260501055202_strategy_verifications.sql:238-250`) INSERTs a **fresh** CSV strategies row (`source='csv'`, `status='pending_review'`); it is not a promotion of an existing wizard draft and deletes no prior row. **No delete+insert.**

Exhaustive negative evidence:
- `grep -rn "pending_review" supabase/migrations/*.sql` (writes only): the ONLY `UPDATE strategies SET … status='pending_review'` sites are the four successive `finalize_wizard_strategy` CREATE OR REPLACE defs (`20260411103316:281`, `20260513084844:292`, `20260515114310:390`, `20260521185008:120`). All guarded UPDATEs.
- The only `DELETE FROM strategies` occurrences in the whole tree are inside SQL comments (`20260411103316:62`), never executed code.

**STOP condition NOT triggered.** Proceeded to Tasks 2-3.

Task 1 automated verify: `grep -c "FOR UPDATE"` ≥ 1 and `UPDATE strategies … pending_review` present in `20260521185008` — both hold.

## Task Commits

1. **Task 1: OQ3 gating verify** — read-only, no commit (evidence recorded above).
2. **Task 2: CLEAN-01 race test** — `afdb19cc` (test)
3. **Task 3: CLEAN-02 sweep test** — `5e5529c8` (test)

**Plan metadata:** committed with this SUMMARY (docs).

## Files Created

- `supabase/tests/test_cleanup_wizard_drafts_race.sql` — CLEAN-01: structural pins (`cleanup_abandoned_wizard_drafts` scope: `wizard`/`draft`/`review_note`/7d, no sanitize GUC, search_path, service_role-only EXECUTE; finalize `FOR UPDATE` + `<> 'draft'`), plus behavioral finalize-first (spared as pending_review), cron-first (swept + cascade, finalize fails loud P0002), and window pins (8d+review_note spared, 1d spared).
- `supabase/tests/test_cleanup_orphaned_api_keys_sweep.sql` — CLEAN-02: structural pins (sweep body has `NOT EXISTS` on strategies + strategy_keys + allocator_holdings; no `sanitize_in_progress`; does not reuse composite-blind `delete_api_key_if_unreferenced`; published-composite guard sanitize exemption intact), plus behavioral 5 safety cases + pre-cascade capture (one sweep call) + MANDATORY behavioral `sanitize_user` still deletes api_keys.

## Confirmed-RED reason (both files)

`cleanup_abandoned_wizard_drafts` does not exist yet (`grep -rln` across `supabase/`, `src/`, `analytics-service/` → none; it lands in migration `20260713120000` in 96-02). Each file's Part 1 first assertion is `IF v_src IS NULL THEN RAISE EXCEPTION 'CLEAN-0X: cleanup_abandoned_wizard_drafts() missing — apply migration 20260713120000 …'`. Under `psql -v ON_ERROR_STOP=1` this aborts the run at Part 1 — the intended repro-gate. Whole-file grep confirms both match the plan's runtime verify regex `cleanup_abandoned_wizard_drafts.*missing` (case-insensitive). This is a genuine missing-RPC RED, not a harness error: the structural query returns zero rows → `v_src` stays NULL → the assertion fires before any seed runs.

**Runtime gate note:** `psql` is not installed on this executor and neither `TEST_SUPABASE_DB_URL` nor `DATABASE_URL` is set locally, so the tests could not be executed here. CI's `sql-tests` lane (`.github/workflows/ci.yml`, `psql "$TEST_SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f`) is the runtime gate; the files are written to spec and the RED is structurally guaranteed as described. Local static verify performed: meta-command preflight `grep -cE '^\\' …` → 0 for both; BEGIN/ROLLBACK balanced (1/1); `DO $$`/`END $$` balanced (4/4 race, 3/3 sweep).

## Sanitize behavioral case (Warning-3)

`test_cleanup_orphaned_api_keys_sweep.sql` Part 3 is a MANDATORY behavioral proof (not a structural fallback): it seeds a throwaway user + orphan `api_key`, runs `PERFORM public.sanitize_user(v_user)`, and asserts the `api_key` is DELETED — proving GDPR account deletion still removes keys and the CLEAN-02 sweep machinery adds no blocking guard. Paired with the structural pins that the sweep body does NOT set `sanitize_in_progress` (Part 1 (d)) and that `enforce_api_keys_published_composite_integrity` keeps its sanitize exemption (Part 1 (e)).

## Decisions Made

- **Sweep invoked via `PERFORM`, outcomes asserted via table state.** The RPC's return shape is authored in 96-02; asserting Case A/F keys are GONE is the robust observable proof of a sweep without coupling to an unspecified `swept_keys` column.
- **`sanitize_user` structural GUC pin is a tolerant NOTICE.** The shared test project can lag prod on the sanitize re-sync (documented precedent in `test_sanitize_user_hardening.sql`); the hard proof is the behavioral Part 3. All CLEAN-02-owned behavior is asserted hard.

## Deviations from Plan

None affecting scope — plan executed as written. Two spec-permitted judgment calls exercised (both offered by the plan text): (1) the plan's "prefer the real finalize call" was taken in the cron-first ordering (auth emulated via `set_config('request.jwt.claims', …)` + `SET LOCAL ROLE authenticated`), not the structural fallback; (2) the swept-count assertion is expressed as table-state (Case A/F GONE) rather than an unspecified return column, and the `sanitize_user` structural GUC pin is tolerant per the established model precedent — both documented above.

## Issues Encountered

None. `psql`/DB URL unavailable locally was expected for an offline-first plan; CI's `sql-tests` lane is the runtime gate.

## User Setup Required

None.

## Next Phase Readiness

- OQ3 gate cleared — 96-02 may ship the single SECURITY DEFINER `cleanup_abandoned_wizard_drafts` RPC (migration `20260713120000`) that: (a) single-atomic `DELETE … WHERE source='wizard' AND status='draft' AND created_at < now()-interval '7 days' AND review_note IS NULL RETURNING`, capturing member ids BEFORE the strategy_keys cascade; (b) sweeps only candidate keys with `NOT EXISTS` on strategies + strategy_keys + allocator_holdings; (c) never sets `sanitize_in_progress`. Both RED tests turn GREEN when it lands.
- Post-land: route the migration through migration-reviewer + rls-policy-auditor (VALIDATION sign-off).

## Self-Check: PASSED

- `supabase/tests/test_cleanup_wizard_drafts_race.sql` — FOUND
- `supabase/tests/test_cleanup_orphaned_api_keys_sweep.sql` — FOUND
- Commit `afdb19cc` (Task 2) — FOUND
- Commit `5e5529c8` (Task 3) — FOUND

---
*Phase: 96-draft-key-hygiene-onboarding-polish*
*Completed: 2026-07-12*
