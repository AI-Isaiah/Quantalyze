---
phase: 62
slug: explicit-draft-series-membership-schema-v4
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-03
---

# Phase 62 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) + psql SQL tests (supabase/tests) |
| **Config file** | vitest.config.ts |
| **Quick run command** | `npx vitest run <touched test files> --no-file-parallelism` |
| **Full suite command** | `npm test` (sharded in CI with --coverage; ratchet 82/80/74/72) |
| **Estimated runtime** | quick ~30-90s per file · full ~8-10 min local |
| **Type gate** | `npx tsc --noEmit` |
| **Lint gate** | `npm run lint` (react-hooks errors not caught by tsc/vitest) |

---

## Sampling Rate

- **After every task commit:** Run the touched test files via `npx vitest run ... --no-file-parallelism`
- **After every plan wave:** Run full `npm test` + `npx tsc --noEmit`
- **Before `/gsd:verify-work`:** Full suite must be green + coverage above ratchet
- **Max feedback latency:** ~120 seconds (quick loop)

---

## Per-Task Verification Map

*(Populated/refined by the planner — canonical rows land in each PLAN.md `<automated>` fields.)*

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 62-01-* | 01 | 1 | MEMBER-01 | — | v2 AND v3 drafts decode ok (never reset) at version 4 | unit (RED-first) | `npx vitest run src/app/\(dashboard\)/allocations/lib/scenario-state.test.ts --no-file-parallelism` | ✅ | ⬜ pending |
| 62-02-* | 02 | 2 | MEMBER-02 | — | blank draft column never merges live book | unit | `npx vitest run src/app/\(dashboard\)/allocations/lib/scenario-compare.test.ts --no-file-parallelism` | ✅ | ⬜ pending |
| 62-03-* | 03 | 2 | MEMBER-03 | T-62-01 | mint/resolve/compare share ONE book-only predicate; no over-return in share payload | unit + SQL | `npx vitest run src/app/scenario-share/[token]/share-resolve.test.ts --no-file-parallelism` | ✅ | ⬜ pending |
| 62-04-* | 04 | 2 | MEMBER-04 | — | ineligible member drop is disclosed, never silent | component | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" --no-file-parallelism` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements — vitest + fixtures + the
P61 regression suites already exist; no new framework or scaffolding needed.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Save→reopen membership round-trip on authed prod | MEMBER-01..04 (spot) | Prod data + auth | Deferred to Phase 65 canary (GUARD-04) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
