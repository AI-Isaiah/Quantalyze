---
phase: 52
slug: per-surface-application-allocator-journey
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-29
---

# Phase 52 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (unit/component) + Playwright (e2e: reflow/axe/svg-parity) |
| **Config file** | `vitest.config.ts` / `playwright.config.ts` |
| **Quick run command** | `npx vitest run <changed-files>` |
| **Full suite command** | `npm run test` (vitest) + targeted `npx playwright test e2e/reflow-sweep.spec.ts e2e/svg-chart-parity.spec.ts` |
| **Estimated runtime** | ~60–120 seconds (vitest); e2e specs longer |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run` scoped to the changed surface.
- **After every plan wave:** Run the frozen-spine guards + reflow sweep + axe spec for the touched surface.
- **Before `/gsd:verify-work`:** Full vitest suite green; SCENARIO-05 + BODY-02 frozen-spine guards green; svg-chart-parity goldens green.
- **Max feedback latency:** ~120 seconds (unit); e2e gates run per wave.

---

## Per-Task Verification Map

> 19 tasks across 7 plans (52-01..52-07). "File Exists" = ✅ the test file already exists on disk today; ❌ W0 = created in Wave 0 (plan 52-01); ❌ task = the new test/spec file is created by that same task (its `<automated>` runs it green after creation). Every task has an `<automated>` verify (Nyquist-compliant); no 3 consecutive tasks lack one.

| Task ID | Plan | Wave | Requirement(s) | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists |
|---------|------|------|----------------|------------|-----------------|-----------|-------------------|-------------|
| 52-01-T1 | 52-01 | 1 | BP-01 | T-52-01 | Frozen-island zero-diff guard fails loud (Rule 12) if baseline unresolved; no island RSC-ified | unit | `npx vitest run src/__tests__/phase-52-frozen-spine-guards.test.ts` | ❌ task (creates the guard) |
| 52-01-T2 | 52-01 | 1 | APPLY-01, TYPE-03 | T-52-02, T-52-03 | 2560 reflow anchored on a visible content node so a 404/login page fails loud (no false-green) | e2e (typecheck gate) | `npx tsc --noEmit -p tsconfig.json` (scoped to `e2e/reflow-sweep-authed.spec.ts`) | ✅ (MODs existing spec) |
| 52-01-T3 | 52-01 | 1 | TYPE-04, STATE-02 | — | No-invented-data: collapsed column relocates real value into details, never a fabricated em-dash/zero | unit/component | `npx vitest run src/__tests__/phase-52-container-tabular-nums.test.tsx` | ❌ task (creates the contract) |
| 52-02-T1 | 52-02 | 2 | APPLY-01, TYPE-03, TYPE-04 | T-52-04 | Auth gate `redirect("/login")` + `getMyAllocationDashboard` preserved in page | component (tdd) | `npx vitest run "src/app/(dashboard)/allocations/components/KpiStrip.test.tsx" "src/app/(dashboard)/allocations/components/KpiStrip.warmup.test.tsx" src/__tests__/phase-52-container-tabular-nums.test.tsx` | ✅ (container contract ❌ W0/52-01) |
| 52-02-T2 | 52-02 | 2 | STATE-01, STATE-02 | T-52-05 | error.tsx digest-only, never `error.message` (ASVS V7); retry invokes `unstable_retry` | component | `npx vitest run "src/app/(dashboard)/allocations/loading.test.tsx" "src/app/(dashboard)/allocations/error.test.tsx"` | ❌ task (creates both tests) |
| 52-02-T3 | 52-02 | 2 | TYPE-02 | T-52-06, T-52-07 | `title=` exposes only already-rendered name; scenario.ts/compute.ts untouched (frozen guard) | unit (grep gate + guard) | `npx vitest run src/__tests__/phase-52-frozen-spine-guards.test.ts` | ❌ W0 (52-01 creates the guard) |
| 52-03-T1 | 52-03 | 2 | APPLY-01, TYPE-03, TYPE-04, TYPE-02 | T-52-08, T-52-10 | `withPublishedOnly` + `redirect("/login")` preserved; title exposes only the rendered name | component (tdd, RED→GREEN) | `npx vitest run "src/app/(dashboard)/compare/page.test.tsx" "src/components/strategy/CompareTable.test.tsx"` | ✅ page.test / ❌ task (creates CompareTable.test) |
| 52-03-T2 | 52-03 | 2 | STATE-01, STATE-02 | T-52-09 | compare error.tsx digest-only, never `error.message` (ASVS V7) | component | `npx vitest run "src/app/(dashboard)/compare/loading.test.tsx" "src/app/(dashboard)/compare/error.test.tsx"` | ❌ task (creates both tests) |
| 52-03-T3 | 52-03 | 2 | STATE-02, APPLY-01 | T-52-11 | Honest empty state (no fabricated zeros); frozen islands zero-diff | unit (grep gate + guard) | `npx vitest run "src/app/(dashboard)/compare/page.test.tsx" src/__tests__/phase-52-frozen-spine-guards.test.ts` | ✅ page.test / ❌ W0 guard |
| 52-04-T1 | 52-04 | 2 | APPLY-01, TYPE-03, TYPE-02, TYPE-04, STATE-02 | T-52-12, T-52-13 | Attestation gate (force-dynamic) untouched (git-diff assert); tile renders real `{s.name}`, no fabricated placeholder | component | `npx vitest run "src/components/strategy/StrategyTable.test.tsx"` | ✅ |
| 52-04-T2 | 52-04 | 2 | APPLY-01, TYPE-02 | T-52-14 | Frozen islands zero-diff; no new truncate without title | unit (grep gate + guard) | `npx vitest run src/__tests__/phase-52-frozen-spine-guards.test.ts` | ❌ W0 (52-01 guard) |
| 52-05-T1 | 52-05 | 2 | STATE-01, TYPE-03 | — | Narrow prose measure (max-w-3xl) preserved; `getPublicStrategyDetail` stays in page | component | `npx vitest run "src/app/strategy/[id]/loading.test.tsx"` | ❌ task (creates the test) |
| 52-05-T2 | 52-05 | 2 | STATE-01 | T-52-15, T-52-17 | strategy error.tsx digest-only, never `error.message` (ASVS V7); v2 child boundary untouched | component | `npx vitest run "src/app/strategy/[id]/error.test.tsx"` | ❌ task (creates the test) |
| 52-05-T3 | 52-05 | 2 | APPLY-01, TYPE-03, STATE-02 | T-52-16 | Honest not-found/degenerate branch; EquityChart/TouchTooltip/useTapPin zero-diff | unit (grep gate + guard) | `npx vitest run src/__tests__/phase-52-frozen-spine-guards.test.ts` | ❌ W0 (52-01 guard) |
| 52-06-T1 | 52-06 | 2 | TYPE-04, TYPE-02, APPLY-01 | T-52-20 | Legit KPI-label clip preserved; ~1440 measure kept; no fabricated zero on degenerate metric; frozen islands zero-diff | component (tdd) | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.degenerate.test.tsx" src/__tests__/phase-52-container-tabular-nums.test.tsx src/__tests__/phase-52-frozen-spine-guards.test.ts` | ✅ degenerate / ❌ W0 (container + guard) |
| 52-06-T2a | 52-06 | 2 | TYPE-04, APPLY-01 | T-52-18 | Presentation panels read already-computed props, no math touch; frozen islands zero-diff | component | `npx vitest run "src/app/factsheet/[id]/v2/AnalyticalPanels.test.tsx" "src/app/factsheet/[id]/v2/DistributionPanels.test.tsx" src/__tests__/phase-52-frozen-spine-guards.test.ts` | ❌ task/sub (panel tests may not exist — substitute nearest mounting test, recorded in SUMMARY; guard ❌ W0) |
| 52-06-T2b | 52-06 | 2 | TYPE-04, APPLY-01 | T-52-18, T-52-19 | error.tsx type-pass only — `unstable_retry` signature intact, never `error.message` (ASVS V7); frozen islands zero-diff | component | `npx vitest run "src/app/factsheet/[id]/v2/BatchDPanels.ownbook.test.tsx" "src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx" "src/app/factsheet/[id]/v2/ComparatorPicker.test.tsx" src/__tests__/phase-52-frozen-spine-guards.test.ts` | ✅ BatchD/ComparatorPicker / ❌ W0 guard |
| 52-06-T3 | 52-06 | 2 | BP-01 | T-52-18 | All 8 frozen islands byte-identical; SCENARIO-05/BODY-02 pins green; no `--update-snapshots` | unit/e2e (guard + parity) | `npx vitest run src/__tests__/phase-52-frozen-spine-guards.test.ts src/__tests__/phase-29-frozen-spine-guards.test.ts src/__tests__/phase-30-frozen-spine-guards.test.ts src/lib/scenario.test.ts` | ✅ 29/30/scenario / ❌ W0 (52 guard) |
| 52-07-T1 | 52-07 | 3 | APPLY-01, TYPE-02 | T-52-21, T-52-22 | Chart `off` exemption not clobbered (TimeSeriesChart/HistogramChart stay exempt); STOP+report if a missed px reds lint (Rule 12) | lint gate | `npm run lint` (exit 0) | ✅ (MODs existing eslint.config.mjs) |

*File Exists: ✅ = test file present on disk today · ❌ W0 = created in Wave 0 (plan 52-01) · ❌ task = created by that task itself (its `<automated>` runs the new file green) · ❌ task/sub = panel render test may not yet exist; acceptance permits a substituted nearest mounting test recorded in the SUMMARY.*

### Sampling-continuity check (no 3 consecutive tasks without an automated verify)

Every one of the 19 tasks carries an `<automated>` command (vitest, tsc typecheck, or `npm run lint`) — there is **no** run of 3 consecutive tasks lacking automated verification. The two verification-gate tasks (52-06-T3, the frozen-island byte-identity gate; and 52-07-T1, the lint ratchet) are themselves automated gates, not manual steps. The single manual-only verification (authed ultra-wide visual canary) is supplementary to, not a substitute for, the automated 2560 reflow row (52-01-T2). Sampling continuity: **PASS.**

---

## Wave 0 Requirements

- [ ] Extend `e2e/reflow-sweep-authed.spec.ts` (or `e2e/helpers/reflow.ts`) with a **2560px ultra-wide** viewport row across the allocator surfaces (TYPE-03). — *52-01 Task 2*
- [ ] Render tests for each new `loading.tsx` / `error.tsx` (STATE-01/02 coverage gate). — *created per surface in 52-02/03/05 (the route-file tasks)*
- [ ] Per-new-`@container` test asserting `tabular-nums` columnar alignment holds across the container breakpoint (TYPE-04). — *52-01 Task 3 (`phase-52-container-tabular-nums.test.tsx`); CompareTable behavior tests in 52-03 Task 1 (`CompareTable.test.tsx`)*
- [ ] 52-scoped frozen-spine git-delta guard (copy of the phase-30 guard with its own baseline sha) protecting the frozen islands (BP-01 / SCENARIO-05 / BODY-02). — *52-01 Task 1 (`phase-52-frozen-spine-guards.test.ts`)*

*Existing infrastructure (frozen-spine guards, svg-chart-parity goldens, axe suite, reflow sweep) covers most invariants; the above fill the ultra-wide + state-coverage + container gaps. The two `phase-52-*` test files and the new per-surface route-file tests are the Wave-0 / task-created files marked ❌ in the map above.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Authed allocator visual canary at ultra-wide (2560px) on a real authed session | APPLY-01 / TYPE-03 | Headless browse can't hydrate authed pages; CI reflow proves structure but a human visual check confirms "deliberate, not stretched" | Open /allocations, /compare, factsheet at 2560px in an authed browser; confirm no horizontal scroll/overlap and charts/tables read deliberate |

*Most phase behaviors have automated verification (reflow, axe, frozen-spine, render tests). The automated 2560 reflow row (52-01-T2) is the gating check; this canary is a supplementary "reads deliberate" human confirmation.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 120s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** validation strategy complete and Nyquist-compliant (per-task map populated, sampling continuity verified). `wave_0_complete` flips true only after Wave 0 (plan 52-01) actually executes and the three Wave-0 artifacts exist on disk green.
</content>
