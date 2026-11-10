---
phase: "204"
slug: "introauth-the-intro-path-s-database-side-authorization-match"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-10"
---

# Phase 204 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from
> `204-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | SQL gate files run by psql on the pg-lane (local, no Docker); mutation runner; vitest for the ratchet tests |
| **Config file** | gate: `RED-UNDER-SETUP` inside the gate file; vitest: `vitest.config.ts` |
| **Quick run command** | `bash scripts/pg-lane/run.sh --workdir <scratch> --apply <setup list> --gate supabase/tests/test_contact_requests_insert_intro_authz.sql` |
| **Full suite command** | `node scripts/mutation-runner/run.mjs --file supabase/tests/test_contact_requests_insert_intro_authz.sql` and `npx vitest run src/__tests__/mutation-runner-floors.test.ts src/__tests__/gate-family-meta.test.ts src/__tests__/mutation-annotation-parser.test.ts src/__tests__/lint-sql-gates.test.ts` |
| **Estimated runtime** | lane run ~seconds; single-file mutation run ~1-2 min |

The real-dump run (`sql-tests` on the local-stack lane) needs Docker and runs in CI only.

---

## Sampling Rate

- **After every task commit:** lane run of the gate plus `node scripts/mutation-runner/run.mjs --parse-only`
- **After every plan wave:** single-file mutation run, the ratchet vitest files, `node scripts/lint-sql-gates.mjs`
- **Before `/gsd-verify-work`:** CI `sql-tests`, `sql-mutation`, `sql-gate-lint`, `frontend` green; migration-reviewer and rls-policy-auditor clean
- **Max feedback latency:** ~120 seconds locally

---

## Per-Decision Verification Map

| Decision | Secure behavior | Test type | Automated command | File exists |
|----------|-----------------|-----------|-------------------|-------------|
| D-01/D-02 | approved, attested allocator (and role `both`, admin with an allocator role) admitted; unapproved, half-approved `both`, manager, unattested, wrong-owner and anon callers refused | SQL gate arms, each twin proven RED | single-file mutation run | ❌ W0 |
| D-03 | caller reads its own rows; no policy recursion | the positive arm (a recursion or visibility failure raises) | lane gate run | ❌ W0 |
| D-04 | no PUBLIC/anon/authenticated EXECUTE on the 6-arg function; service_role keeps it | SQL gate ACL arms + twins | single-file mutation run | ❌ W0 |
| D-05 | admin path unchanged | service_role EXECUTE arm; existing `match-decisions-schema.test.ts` (live-DB gated) | `npx vitest run src/__tests__/match-decisions-schema.test.ts` | ✅ |
| D-06 | migration DO blocks read the catalogue only | repo data-dependence linter + grep of DO regions + clean apply on the lane | `node scripts/lint-migration-data-dependence.mjs --self-test && node scripts/lint-migration-data-dependence.mjs` (0 NEW) | ❌ W0 |
| D-07 | every arm bites; floors and censuses exact | mutation runner + ratchet vitest | vitest files above | ✅ |
| D-08 | public-repo wording | grep of new tracked text; `git show --stat HEAD` after each commit | manual review step | n/a |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `supabase/tests/test_contact_requests_insert_intro_authz.sql` (new gate)
- [ ] pg-lane stand-in fixture for the intro-authz gate (`scripts/pg-lane/fixtures/`)
- [ ] the new migration (timestamp after `20261110120000`) and its `down/` rollback
- [ ] every census row named in `204-RESEARCH.md`

---

## Manual-Only Verifications

| Behavior | Why manual | Instructions |
|----------|------------|--------------|
| D-08 wording | judgment on prose | grep new files/commit messages for live-state phrasing; confirm `git show --stat HEAD` lists no `held/` path |
| Real-dump gate run | needs Docker (local-stack lane) | read CI `sql-tests` on the PR head SHA |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
