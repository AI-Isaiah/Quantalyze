---
phase: "213"
slug: "keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-14"
---

# Phase 213 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `213-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (node + jsdom projects), `@testing-library/react` |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run <touched test files>` |
| **Full suite command** | `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test` |
| **Estimated runtime** | quick ~30 s; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** run the test file(s) the task touched.
- **After every plan wave:** run the invariant/census group (`src/lib/wizardErrors.*`, seam invariants, `src/__tests__/phase-149-my-strategies-parity.test.ts`, contracts/census tests) plus the touched component suites.
- **Before `/gsd-verify-work`:** full suite green, coverage ratchet intact.
- **Max feedback latency:** 60 seconds per task.

---

## Per-Task Verification Map

Filled by the planner per task; each success criterion maps as follows.

| SC | Behavior | Test Type | Automated Command | File Exists | Status |
|----|----------|-----------|-------------------|-------------|--------|
| SC-1a | unknown incoming key + stored key, no draft on screen → no session id restored; CSV literal null still restores; composite draft on screen still restores | unit + component | `npx vitest run src/lib/wizard/localStorage.test.ts src/lib/wizard/derive-resume-overrides-arity.contract.test.ts "src/app/(dashboard)/allocations/components/ContributionWizardOverlay.sessionid-fence.test.tsx"` | ✅ (new cases W0) | ⬜ pending |
| SC-1b | every route-owned arm returning an existing draft answers `deduped: true`; first connect does not | route + component | `npx vitest run src/app/api/strategies/create-with-key/route.test.ts "src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx"` | ✅ | ⬜ pending |
| SC-2 | placeholder rows for every role incl. revoked/inactive orphans; Disconnect-only confirm calls the RPC; row kept; reconnect not refused as `KEY_ORPHANED`; copy names the control | page + component + route + unit | `npx vitest run "src/app/(dashboard)/strategies/page.merged.test.tsx" src/lib/queries.my-strategies.test.ts src/lib/wizardErrors.test.ts src/lib/wizardErrors.invariant.test.ts "src/app/(dashboard)/strategies/StrategiesLegend.test.tsx"` + new disconnect component test | partial (new W0) | ⬜ pending |
| SC-3 | no MT5 composite card, `enterMulti` refuses MT5; add-key (flag on and off) and set-members refuse `mt5` with the named code | component + route + invariant | `npx vitest run "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx" src/app/api/strategies/composite/add-key/route.test.ts src/app/api/strategies/composite/set-members/route.test.ts src/lib/wizardErrors.invariant.test.ts` | ✅ (rewrite) | ⬜ pending |
| SC-4 | basis-dependent figures read pending while any leg's probe is open or retrying; failed probe is terminal; no figure on the interim basis; save/commit/share persist none | component | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx"` | ✅ (new cases) | ⬜ pending |
| SC-5 | no migration | check | `git diff --stat origin/main -- supabase/migrations` empty | n/a | ⬜ pending |
| SC-6 | each fix goes RED when reverted | neuter protocol | per `213-RESEARCH.md` § "How each must be shown able to fail" | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm ci` in the worktree (no `node_modules` at research time).
- [ ] New test cases named in the map above (localStorage pins, F6 route case, disconnect component test, add-key/set-members refusal cases, composer held-probe / retry-after-failure / failed-probe cases).
- [ ] Enumerate the factsheet preview's basis-dependent slots before the (d) plan's tasks are written.
- [ ] Check whether `KEY_ORPHANED` is in `PRESELECT_REACHABLE` before editing its copy.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Reconnect after Disconnect against the real partial unique index | SC-2 | DB-layer proof is the existing SQL arm 6b in `supabase/tests/test_api_keys_venue_identity_uniq.sql`, run by CI `sql-tests` on its private local stack | Confirm `sql-tests` green on the PR head SHA |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
