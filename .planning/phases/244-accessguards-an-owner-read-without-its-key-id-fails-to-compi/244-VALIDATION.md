---
phase: "244"
slug: "accessguards"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: "2026-11-26"
---

# Phase 244 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `tsc --noEmit` (type gate, CI job `frontend-typecheck`), vitest 5.0.5 (gates, censuses, wiring pins), Playwright 1.64.1 (`e2e-seeded`, run locally on the local-stack lane) |
| **Config file** | `tsconfig.json`, `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `npx vitest run src/__tests__/audit-coverage.test.ts src/__tests__/e2e-seeded-hydration-guard.test.ts src/__tests__/manager-keys-e2e-wiring.test.ts` |
| **Full suite command** | `npm run typecheck && npx vitest run` |
| **Estimated runtime** | quick ~10 s; `tsc --noEmit --incremental false` ~100 s; one lane spec run ~2 min after a ~3-5 min lane boot and build |

---

## Sampling Rate

- **After every task commit:** the task's own `<automated>` commands (each plan task names them), plus the quick run command when a census or gate file changed
- **After every plan wave:** `npx tsc --noEmit --incremental false` and the touched-surface vitest sweep named in the plan (plan 01 task 2, plan 02 task 3, plan 04 task 2)
- **Before `/gsd-verify-work`:** `npm run typecheck`, full `npx vitest run`, `npm run lint`, and plan 03's recorded lane runs
- **Max feedback latency:** 120 seconds for every non-lane task (tsc is the slowest); the two lane tasks of plan 03 are bounded by the lane boot and build

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 244-01-01 | 01 | 1 | DBACC-04 | T-244-01 | A key-free row cannot be assigned to the owner type `Strategy`; the tearsheet reader returns `PublicStrategy` | type-level | `npx tsc --noEmit --incremental false` (0 `error TS`) and `npx vitest run src/__tests__/api-key-id-compile-guard.test.ts` | ❌ W0 (task creates it) | ⬜ pending |
| 244-01-02 | 01 | 1 | DBACC-04 | T-244-01 | The category reader returns `PublicRankedStrategyRow[]`; the shared list components accept both row kinds without a cast | type-level + vitest sweep | `npx tsc --noEmit --incremental false`; the plan's touched-surface `npx vitest run ...` sweep | ✅ (after 01-01) | ⬜ pending |
| 244-01-03 | 01 | 1 | DBACC-04 | T-244-01 | PROOF-01: field optional again gives TS2578 on ARM-1 first; `cp` + `cmp` restore; green | neuter record | `cmp "$SCRATCH/244/types.ts.bak" src/lib/types.ts` and `npx tsc --noEmit --incremental false` | ✅ | ⬜ pending |
| 244-02-01 | 02 | 1 | DBACC-05 | T-244-03 | Site 1 discharged by the moved roll-up pragma; allowlist 6 -> 5 | vitest gate | `npx vitest run src/__tests__/audit-coverage.test.ts` | ✅ | ⬜ pending |
| 244-02-02 | 02 | 1 | DBACC-05 | T-244-03, T-244-04 | Sites 2-6 carry dated founder-exemption pragmas; allowlist a typed empty array at length 0; gate still reds a new site | vitest gate | `npx vitest run src/__tests__/audit-coverage.test.ts` | ✅ | ⬜ pending |
| 244-02-03 | 02 | 1 | DBACC-05 | T-244-03 | PROOF-01 N1 (exemption pragma removed) and N2 (site 1 block moved out) each red by name; byte restore; the 34 route-reading tests green | neuter record + vitest sweep | `cmp` on both backups; the plan's 34-file `xargs npx vitest run` sweep | ✅ | ⬜ pending |
| 244-03-01 | 03 | 1 | DBACC-06 | T-244-06, T-244-07 | The spec runs as-is, then after spec-local repairs passes 4/4 on the lane with nothing skipped or flaky; no silent anon-key skip; anonymous PUT asserts the proxy's 307 | Playwright (local-stack lane) | `CI=true npx playwright test e2e/discovery-watchlist.spec.ts --timeout 60000 --retries 0 --reporter=list` | ✅ (edit) | ⬜ pending |
| 244-03-02 | 03 | 1 | DBACC-06 | T-244-06, T-244-07, T-244-08, T-244-09 | PROOF-01: neutered `users see own favorites` reds "RLS LEAK on migration 024 policy"; snapshot `cmp`; neutered `PUBLIC_ROUTES` (rebuilt) reds the 307 arm; `cp` + `cmp`; final CI-parity 4/4; lane torn down | Playwright (lane) + cmp | `cmp` of the policy snapshots and the proxy backup; `bash scripts/local-stack/run.sh --assert-teardown` | ✅ | ⬜ pending |
| 244-04-01 | 04 | 2 | DBACC-06 | T-244-10 | The spec is in the gating `e2e-seeded` list, not the advisory one; census 27; bound to the hydration guard | vitest census | `npx vitest run src/__tests__/e2e-seeded-hydration-guard.test.ts src/__tests__/manager-keys-e2e-wiring.test.ts` | ✅ | ⬜ pending |
| 244-04-02 | 04 | 2 | DBACC-06 | T-244-10, T-244-11 | Wiring pin reds on list removal, advisory placement, the anon-key skip, extra skips and lost anchors (W1-W3 seen red, byte-restored) | vitest wiring pin | `npx vitest run src/__tests__/discovery-watchlist-e2e-wiring.test.ts` and the ci.yml-reader sweep | ❌ W0 (task creates it) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/api-key-id-compile-guard.test.ts` — DBACC-04 type-level guard (created by plan 01 task 1, the tracer)
- [ ] `src/__tests__/discovery-watchlist-e2e-wiring.test.ts` — DBACC-06 wiring pin (created by plan 04 task 2)
- [ ] The as-is lane run of `e2e/discovery-watchlist.spec.ts` before any edit (plan 03 task 1, the tracer)

Framework install: none (no new package; Playwright chromium is cached).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| The four `discovery-watchlist` tests ran in CI (passed, none skipped) | DBACC-06 | Needs the phase PR's CI run; the spec's kept `HAS_SEED_ENV` skip is invisible to any source pin, so only the `e2e-seeded` log on the head SHA proves it executed | At ship, before merge: find the `e2e-seeded` job of the PR head SHA's CI run and `gh run view --job <id> --log \| grep -a discovery-watchlist`; quote the four passed lines and confirm no skipped line |

Everything else is automated (tsc, vitest, and the locally run Playwright lane commands in plan 03).

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120 s for every non-lane task
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending (planner filled the map 2026-11-27; validate-phase sets `status: validated`)
