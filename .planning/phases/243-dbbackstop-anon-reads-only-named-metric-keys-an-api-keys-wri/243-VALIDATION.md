---
phase: "243"
slug: "dbbackstop"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-26"
---

# Phase 243 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `243-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS); psql-driven SQL gates under `supabase/tests`; mutation runner `scripts/mutation-runner` |
| **Config file** | `vitest.config.ts`, `vitest.livedb.config.ts`, `scripts/mutation-floors.mjs` |
| **Quick run command** | `npx vitest run src/lib/factsheet/` (plus the one gate file touched) |
| **Full suite command** | `npm run test`, `node scripts/lint-sql-gates.mjs --self-test`, `node scripts/mutation-runner/run.mjs` on touched files, the local-stack corpus |
| **Estimated runtime** | ~600 seconds full; ~30 seconds quick |

---

## Sampling Rate

- **After every task commit:** the quick command, plus the gate file touched
- **After every plan wave:** the full suite on the touched surfaces
- **Before `/gsd-verify-work`:** the full suite must be green, and the DBACC-03 TEST measurement must be recorded
- **Max feedback latency:** 600 seconds

---

## Per-Task Verification Map

Filled in by the planner from the PLAN files. The requirement-to-gate map below is binding.

| Requirement | Behavior | Test Type | Automated Command / Gate |
|-------------|----------|-----------|--------------------------|
| DBACC-01 (a) | The select carries exactly the pinned alias set; a bare `metrics_json_by_basis` fails; the OG route uses the same projection | unit | new projection test plus the tightened regex in `fetch-and-build-payload.test.ts` |
| DBACC-01 (a) | Rebuild parity, including the all-null edge | unit | same |
| DBACC-01 (b) | anon cannot read the column; every other column stays readable; no table-level SELECT for anon | SQL gate + mutation | new `supabase/tests` grant gate with RED-UNDER twins |
| DBACC-01 (b) | Real readers as a signed-out visitor | live-DB vitest | extend `src/lib/anon-strategies-live-probe.test.ts` |
| DBACC-02 (i) | `user_id` cannot change for any role | SQL gate + mutation | new immutability gate |
| DBACC-02 (ii) | A direct service_role insert is refused; a writer RPC insert succeeds; function-set pin | SQL gate + mutation | invert arm (2) of `test_api_keys_insert_not_client_writable.sql`, plus a new catalogue arm |
| DBACC-02 | Route and seeds use the RPC | unit | `validate-and-encrypt/route.test.ts`, `audit-coverage.test.ts` |
| DBACC-03 | PostgREST honours the role timeout and releases the lock | recorded TEST measurement | verbatim in the plan SUMMARY |
| DBACC-03 | Role ceilings are present and not above the pin | SQL gate + mutation (pg-lane) | new role-timeout gate |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] A new anon-grant gate for `strategy_analytics` (DBACC-01 b)
- [ ] A new role-timeout gate, plus a lane check that `ALTER ROLE` applies for the migration role (DBACC-03)
- [ ] A new `api_keys` user_id immutability gate and fence arms (DBACC-02)
- [ ] A projection helper and its test (DBACC-01 a)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| PostgREST applies the impersonated role's statement_timeout and releases the lock | DBACC-03 | Requires writes and REST calls against shared TEST; not CI-safe | `243-RESEARCH.md` § TEST measurement procedure |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 600s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
