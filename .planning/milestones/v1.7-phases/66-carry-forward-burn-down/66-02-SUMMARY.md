---
phase: 66-carry-forward-burn-down
plan: 02
subsystem: database
tags: [scenarios, memberKeyIds, jsonb, sweep, sql-fixture, auth-users, prod-cleanup, red-team]

# Dependency graph
requires:
  - phase: 62-65 (v1.6 series-space purification)
    provides: schema_version >= 4 scenarios drafts with memberKeyIds membership key; genuine-v4 invariant (blank save persists [], book save persists ids)
provides:
  - "Detection-first, idempotent F-4 memberKeyIds re-stamp sweep (scripts/sweeps/f4-memberkeyids-restamp.sql)"
  - "CI-discovered PL/pgSQL fixture proving the discriminator + re-derive transform (supabase/tests/test_scenario_downgrade_sweep.sql)"
  - "Prod evidence: zero downgraded v4 rows existed (CF-03 closed by honest 0-row detection)"
  - "Prod cleanup: 8 phase10-rpc-*@test.local auth.users residue rows deleted with cascade (CF-05 residue closed)"
affects: [scenario share-caption honesty, prod auth.users hygiene, carry-forward burn-down]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Detection-first one-off sweep: SANITY (A1 check) → DETECT (discriminator) → RESTAMP (idempotent UPDATE); 0-row detection is a valid, evidence-recorded closure"
    - "CI fixture copies the EXACT discriminator WHERE + jsonb_set transform the sweep runs (proof-of-transform independent of prod state)"
    - "SELECT-before-DELETE with exact-pattern match (never hand-typed ids) for prod auth.users residue removal"

key-files:
  created:
    - scripts/sweeps/f4-memberkeyids-restamp.sql
    - supabase/tests/test_scenario_downgrade_sweep.sql
  modified: []

key-decisions:
  - "CF-03: F-4 closed by honest 0-row detection — prod scenarios table is entirely empty (v4 schema shipped 2026-07-04, no allocator saves yet), so the deploy-skew window produced no downgraded rows. RESTAMP never executed."
  - "CF-05: resolved the docs' 6-vs-2 count dispute — actual residue was 8 rows (4 a/b pairs from 4 test runs, all 2026-04-26). SELECT is the resolver, no hard-coded count."
  - "No cron, no migration (locked decision D): the deploy window is past; a one-off supervised sweep + CI fixture is the closure."

patterns-established:
  - "Sweep script and its CI fixture share verbatim SQL (discriminator + jsonb_set) so CI proves the exact statements that would run against prod"
  - "Prod data mutations gated by same-session SELECT-before-mutate with before/after evidence recorded in the SUMMARY"

requirements-completed: [CF-03, CF-05]

# Metrics
duration: ~15min
completed: 2026-07-04
---

# Phase 66 Plan 02: F-4 memberKeyIds Re-Stamp Sweep + phase10-rpc Residue Cleanup Summary

**Detection-first F-4 sweep + CI fixture proving the discriminator/re-derive transform, closing CF-03 by honest 0-row prod detection, and deleting 8 phase10-rpc-*@test.local auth.users residue rows (CF-05) with cascade.**

## Performance

- **Duration:** ~15 min
- **Completed:** 2026-07-04
- **Tasks:** 3 (Task 1 built + committed by prior executor; Tasks 2-3 executed via Supabase MCP from the main session)
- **Files created:** 2

## Accomplishments

- Built and committed the detection-first, idempotent F-4 memberKeyIds re-stamp sweep (`scripts/sweeps/f4-memberkeyids-restamp.sql`): SANITY (A1 check) → DETECT (locked discriminator) → RESTAMP (idempotent `jsonb_set` UPDATE), mirroring the runtime reopen re-derive (eligible predicate `queries.ts:2338-2346`, gate `queries.ts:2302-2311`, `deriveMembershipFromGate` `scenario-state.ts:670-675`).
- Built and committed the CI-discovered PL/pgSQL fixture (`supabase/tests/test_scenario_downgrade_sweep.sql`) copying the EXACT discriminator + `jsonb_set` transform — proves the discriminator flags only downgraded rows, gate-true stamps sorted eligible ids (revoked/disconnected excluded), gate-false stamps `[]`, genuine-v4 (incl. blank-save `[]`) + pre-v4 rows untouched, and idempotency.
- CF-03 closed honestly: prod carries zero downgraded v4 rows (0 rows total in scenarios — the deploy-skew window produced nothing to fix). RESTAMP never executed.
- CF-05 residue closed: 8 phase10-rpc residue rows deleted from prod auth.users; cascade cleaned 8 profiles + 2 synthetic api_keys; after-SELECT returns 0.

## Task Commits

1. **Task 1: Write the F-4 sweep SQL artifact + CI fixture (CF-03)** — `c13495f5` (feat) — committed by the prior executor
2. **Task 2: Execute the F-4 sweep against prod via Supabase MCP (CF-03)** — checkpoint:human-action, executed from the main session (no code commit — detection-first, 0-row closure, no mutation)
3. **Task 3: SELECT-verify then DELETE the phase10-rpc auth.users residue (CF-05)** — checkpoint:human-action, executed from the main session (prod data operation only, no code commit)

_Note: Tasks 2-3 are prod-side MCP operations; their artifacts are the evidence trails embedded below, not git commits._

## Files Created/Modified

- `scripts/sweeps/f4-memberkeyids-restamp.sql` — One-off detection-first sweep: SANITY SELECT (A1 check), DETECT discriminator SELECT, idempotent RESTAMP UPDATE. Discriminator `schema_version >= 4 AND NOT (draft ? 'memberKeyIds')`; RESTAMP `jsonb_set(draft, '{memberKeyIds}', <gate-derived>)`.
- `supabase/tests/test_scenario_downgrade_sweep.sql` — Plain PL/pgSQL `DO $$` fixture (no pgTAP, no meta-commands), auto-discovered by ci.yml sql-tests, proving the discriminator + `jsonb_set` transform against seeded downgraded/genuine/blank-save/pre-v4 shapes; self-cleans seeded rows.

## Prod Evidence (embedded verbatim)

### Task 2 — F-4 sweep (CF-03), executed 2026-07-04 via Supabase MCP

**Step 0 — FIXTURE-ON-TEST GATE (TEST project qmnijlgmdhviwzwfyzlc): PASSED.**
The full committed fixture supabase/tests/test_scenario_downgrade_sweep.sql was executed verbatim; the DO block completed with no RAISE EXCEPTION (all assertions passed: discriminator flags exactly the 2 downgraded rows; gate-true row stamped with sorted eligible ids only — revoked/disconnected excluded; gate-false row stamped []; genuine-v4 blank-save + populated + pre-v4 rows byte-identical; second run idempotent no-op; post-condition 0). Seeded rows self-cleaned.

**Prod (khslejtfbuezsmvmtsdn):**
- SANITY (SELECT id, allocator_id, schema_version, (draft ? 'memberKeyIds'), updated_at FROM scenarios WHERE schema_version >= 4 ... LIMIT 25): **[] — zero rows** (no v4 rows exist in prod).
- DETECT (WHERE schema_version >= 4 AND NOT (draft ? 'memberKeyIds')): **[] — 0 downgraded rows**.
- RESTAMP: **NOT executed** — detection-first closure with no mutation, per plan's sanctioned 0-row path.
- POST-CONDITION: `total_scenarios=0, v4_rows=0, remaining_downgraded_rows=0, asof=2026-07-04 07:38:24.665578+00`.
- Context: prod scenarios table is entirely empty (0 rows total) — v4 schema shipped 2026-07-04 (v1.6), no allocator saves yet, so the deploy-skew window produced no downgraded rows.

### Task 3 — phase10-rpc auth.users residue DELETE (CF-05), executed 2026-07-04 via Supabase MCP

**BEFORE SELECT — 8 rows (resolves the docs' 6-vs-2 count dispute: actual count was 8):**

| id | email | created_at |
|---|---|---|
| 60f2e6c9-8c93-48c2-8680-648d3d1ecd71 | phase10-rpc-b-1777186777594@test.local | 2026-04-26 06:59:44 |
| 90a388b1-0af5-4a0f-bda1-bb88cba8b481 | phase10-rpc-a-1777196697098@test.local | 2026-04-26 09:45:00 |
| 3cf1b8d3-4b22-45c0-af73-acef2e8fe3a1 | phase10-rpc-a-1777186777594@test.local | 2026-04-26 06:59:41 |
| f277f878-b58e-4bc5-af39-081848789bb5 | phase10-rpc-b-1777196697098@test.local | 2026-04-26 09:45:04 |
| a841791f-7cc4-4ee1-8f10-fc98097b5490 | phase10-rpc-a-1777201566144@test.local | 2026-04-26 11:06:09 |
| f1ba8191-7dff-4bc0-9664-659e971bdf35 | phase10-rpc-b-1777201566144@test.local | 2026-04-26 11:06:13 |
| 13cf7e77-f002-4c2c-8848-3080865faa57 | phase10-rpc-a-1777186936941@test.local | 2026-04-26 07:02:20 |
| 486cdef1-68e5-4ac4-8214-0a96dcbd9db5 | phase10-rpc-b-1777186936941@test.local | 2026-04-26 07:02:23 |

(4 a/b pairs from 4 test runs, all 2026-04-26 — pure test residue.)

**Dependent-data check:** profiles=8 (trigger-created), api_keys=2, scenarios=0. The 2 api_keys inspected individually before delete: sentinel ids 00000000-0000-0000-0000-000000001095/1096, labels "Phase10 RPC test (synthetic)" / "Phase10 RPC test B (synthetic)", is_active=false, sync_status=idle, 0 csv_daily_returns rows each — unmistakably synthetic.

**DELETE:** `DELETE FROM auth.users WHERE email LIKE 'phase10-rpc-%@test.local';` (same pattern, no hand-typed ids).

**AFTER:** `remaining_phase10_rpc_residue=0, remaining_profiles=0, remaining_api_keys=0, asof=2026-07-04 07:39:36.647236+00` — cascade cleaned everything.

## Decisions Made

- **CF-03 closed by 0-row detection (not mutation):** prod scenarios is entirely empty (v4 shipped same day, no saves), so no downgraded rows existed. Per plan's sanctioned 0-row path, RESTAMP was never run — an honest, evidence-recorded closure.
- **CF-05 count resolved to 8:** the docs disputed 6-vs-2; the SELECT-before-DELETE resolver returned 8 (4 a/b pairs, all 2026-04-26). No hard-coded count was assumed.
- **No cron/migration (locked decision D):** the mixed-version deploy window is past; a one-off supervised sweep + CI fixture is the correct closure, not a persistent pathway.

## Deviations from Plan

None - plan executed exactly as written. Both prod checkpoints followed the detection-first / SELECT-before-mutate contracts; the 0-row F-4 result and the 8-row CF-05 result were both anticipated as valid outcomes by the plan.

## Issues Encountered

None. The 6-vs-2 documentation count dispute for CF-05 was resolved empirically (actual: 8) by the SELECT-before-DELETE step, exactly as the plan intended.

## Known Stubs

None.

## Threat Flags

None — no new security surface introduced. Both prod operations were supervised, pre-committed statements executed via service-role MCP with before/after evidence (T-66-02 and T-66-03 mitigations applied: fixture-proven transform, discriminator-gated UPDATE never run on 0 rows, exact-pattern DELETE with dependent-data check).

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- CF-03 and CF-05 closed; carry-forward debt further burned down.
- CI sql-tests will re-prove the F-4 transform on every subsequent run against the persistent test project (fixture is auto-discovered).
- Remaining Phase 66 carry-forwards (CF-01/02 landed in 66-01; CF-04/CF-06 per roadmap) proceed independently.

## Self-Check: PASSED

- FOUND: `.planning/phases/66-carry-forward-burn-down/66-02-SUMMARY.md`
- FOUND: `scripts/sweeps/f4-memberkeyids-restamp.sql`
- FOUND: `supabase/tests/test_scenario_downgrade_sweep.sql`
- FOUND: commit `c13495f5` (Task 1)

---
*Phase: 66-carry-forward-burn-down*
*Completed: 2026-07-04*
