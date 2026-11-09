---
phase: "197"
slug: "screen-discovery-reads-plainly-and-a-shortlist-can-be-compared"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-08"
---

# Phase 197 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Seeded from `197-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 5 + Testing Library (jsdom); Playwright for e2e |
| **Config file** | `vitest.config.ts` (coverage thresholds are a ratchet; read them there) |
| **Quick run command** | `npx vitest run src/components/strategy/StrategyTable src/components/strategy/StrategyGrid "src/app/(dashboard)/compare" "src/app/(dashboard)/discovery/[slug]/page.test.tsx" src/lib/discovery src/lib/freshness.test.ts` |
| **Full suite command** | `npm test && npm run typecheck && npm run lint` |
| **Estimated runtime** | ~60 seconds quick; several minutes full |

---

## Sampling Rate

- **After every task commit:** the quick run command for the files that task touched
- **After every plan wave:** the full suite command
- **Before `/gsd-verify-work`:** full suite green, plus the seeded e2e job (`e2e/layout-narrow.spec.ts` updated) green and bound to the head SHA
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

Filled by the planner per task; the requirement-level map is:

| Requirement | Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|----------|-----------|-------------------|-------------|--------|
| CLAR-02 (SC-3) | Stale best-Sharpe row renders below every current row, no `#1`, no `Pnn`, `Data from` chip; RED at HEAD | component | `npx vitest run src/components/strategy/StrategyTable.stale-series.test.tsx` | ❌ W0 | ⬜ pending |
| CLAR-02 | 7 / 10 day boundary by asset class; unreadable date → unknown | unit | `npx vitest run src/lib/freshness.test.ts` | ✅ extend | ⬜ pending |
| CLAR-01 | Header label + qualifier, accessible names, tooltips, Track cell, unsigned volatility | component | `npx vitest run src/components/strategy/StrategyTable.headers.test.tsx src/components/strategy/StrategyTable.test.tsx` | ❌ W0 / ✅ update | ⬜ pending |
| CLAR-01 | Grid footer reads the same label map | component | `npx vitest run src/components/strategy/StrategyGrid.test.tsx` | ✅ extend | ⬜ pending |
| ROUTE-05 | Selection, cap of 4, sticky bar, `/compare?ids=` href; absent on `/browse` and owner mounts | component | `npx vitest run src/components/strategy/StrategyTable.selection.test.tsx` | ❌ W0 | ⬜ pending |
| ROUTE-05 | `/compare` states, no "not available yet", Remove, Add strategy combobox | page + component | `npx vitest run "src/app/(dashboard)/compare"` | ✅ update / ❌ W0 | ⬜ pending |
| CLAR-05 (D-01, D-02) | Partner grouping, published-only, no identifiers; admin-only prop, fail closed | unit + page | `npx vitest run src/lib/discovery/shared-account-partners.test.ts "src/app/(dashboard)/discovery/[slug]/page.test.tsx"` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Per-task map (filled by the planner, 2026-11-08)

TABLE SUITE = `npx vitest run src/components/strategy src/__tests__/phase-149-my-strategies-parity.test.ts src/__tests__/phase-150-capital-ownership-invariant.test.ts src/__tests__/trim-removed-surfaces.test.tsx src/__tests__/display-sign-single-source.test.ts src/__tests__/figure-parity-pages.test.tsx src/__tests__/phase-52-container-tabular-nums.test.tsx "src/app/(dashboard)/strategies/page.table.test.tsx" "src/app/(dashboard)/my-strategies/page.test.tsx" src/app/browse/page.test.tsx`

| Plan / Task | Wave | Requirement | Automated command | Can it fail? (how it was seen red) | Status |
|-------------|------|-------------|-------------------|------------------------------------|--------|
| 01 / T1 (tracer) | 1 | CLAR-01 | `npx vitest run src/lib/figure-gate.test.ts src/components/strategy/StrategyTable.headers.test.tsx` | new Track cases (29/30/364/365, unknown last) | ⬜ |
| 01 / T2 | 1 | CLAR-01 | `npx vitest run src/components/strategy/StrategyTable.headers.test.tsx src/components/strategy/StrategyGrid.test.tsx` | the signed `+33.77%` expectation in `StrategyTable.test.tsx` flips | ⬜ |
| 01 / T3 | 1 | CLAR-01 | `npx vitest run` on the eight component test files in plan 01 Task 3 plus `StrategyTable.headers.test.tsx` and `StrategyGrid.test.tsx` | header locators, unsigned `+33.77%` and `+18.55%` expectations | ⬜ |
| 01 / T4 | 1 | CLAR-01 | TABLE SUITE; `npx tsc --noEmit && npm run lint`; figure-gate census if present | byte-pin fixture diff, parity-by-value, `e2e/layout-narrow.spec.ts` header locators | ⬜ |
| 02 / T1 (tracer) | 1 | CLAR-05 | `npx vitest run src/lib/discovery/shared-account-partners.test.ts` | non-admin case asserts no admin client | ⬜ |
| 02 / T2 | 1 | CLAR-05 | same + `npx tsc --noEmit && npm run lint` | neuter: remove `withPublishedOnly`, unpublished-partner case RED, restore by `cp`, `cmp` | ⬜ |
| 03 / T1 (tracer) | 2 | CLAR-02 | `npx vitest run src/components/strategy/StrategyTable.stale-series.test.tsx src/lib/freshness.test.ts` | SC-3: RED against the pre-change source, output recorded | ⬜ |
| 03 / T2 | 2 | CLAR-02 | `npx vitest run src/components/strategy/StrategyTable.stale-series.test.tsx "src/app/(dashboard)/discovery/[slug]/page.test.tsx" src/components/strategy/StrategyGrid.test.tsx` | neuter: `listSeriesVerdict` forced current, RED, restore by `cp`, `cmp`; the browse-prop-set case (no `nowMs`) goes RED under the same neuter | ⬜ |
| 03 / T3 | 2 | CLAR-02 | TABLE SUITE + freshness + discovery page test; typecheck + lint | owner byte-pin string must not move | ⬜ |
| 04 / T1 (tracer) | 2 | ROUTE-05 | `npx vitest run src/lib/compare-href.test.ts "src/app/(dashboard)/compare/CompareAddStrategy.test.tsx"` | privacy filter cases | ⬜ |
| 04 / T2 | 2 | ROUTE-05 | `npx vitest run "src/app/(dashboard)/compare" src/components/strategy/CompareTable.test.tsx` | removed-copy grep (baseline 5 lines) | ⬜ |
| 04 / T3 | 2 | ROUTE-05 | `npx vitest run "src/app/(dashboard)/compare/CompareAddStrategy.test.tsx"`; typecheck + lint | failure + retry case | ⬜ |
| 05 / T1 (tracer) | 3 | ROUTE-05 | `npx vitest run src/components/strategy/StrategyTable.selection.test.tsx "src/app/(dashboard)/discovery/[slug]/page.test.tsx"` | exact href in tick order | ⬜ |
| 05 / T2 | 3 | ROUTE-05 | `npx vitest run src/components/strategy/StrategyTable.selection.test.tsx src/components/strategy/StrategyGrid.test.tsx src/components/strategy/StrategyTable.default-mounts.test.tsx` | byte pin must not move (opt-in gate) | ⬜ |
| 05 / T3 | 3 | ROUTE-05 | phase-149 pin; typecheck + lint; `npx playwright test --list e2e/layout-narrow.spec.ts` | seeded e2e re-verified on the PR run | ⬜ |
| 06 / T1 (tracer) | 4 | CLAR-05 | `npx vitest run src/components/strategy/StrategyTable.shared-account.test.tsx "src/app/(dashboard)/discovery/[slug]/page.test.tsx"` | null-reader case asserts the prop key is absent | ⬜ |
| 06 / T2 | 4 | CLAR-05 | `npx vitest run src/components/strategy "src/app/(dashboard)/discovery/[slug]/page.test.tsx" src/__tests__/phase-149-my-strategies-parity.test.ts src/lib/discovery/shared-account-partners.test.ts` | browse-page absence pin | ⬜ |
| 06 / T3 | 4 | all | `npm test && npm run typecheck && npm run lint` | phase-closing full suite | ⬜ |

---

## Wave 0 Requirements

- [ ] `src/components/strategy/StrategyTable.stale-series.test.tsx` — SC-3 RED-first (CLAR-02)
- [ ] `src/components/strategy/StrategyTable.headers.test.tsx` — headers, Track, unsigned vol, partner line
- [ ] `src/components/strategy/StrategyTable.selection.test.tsx` — ROUTE-05
- [ ] `src/app/(dashboard)/compare/CompareAddStrategy.test.tsx` — ROUTE-05 search
- [ ] `src/app/(dashboard)/discovery/[slug]/page.test.tsx` — admin gate and payload absence
- [ ] `src/lib/discovery/shared-account-partners.test.ts` — CLAR-05 grouping and published-only fence
- [ ] Fixture freshness: current `series_end` under a frozen clock for published-only control rows in existing StrategyTable tests
- [ ] `npm ci` in the phase worktree (no `node_modules` there at research time)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Header qualifiers wrap only at ` · `, at most three lines, pinned Strategy header aligned (375px and 1280px) | CLAR-01 | Visual layout (UI-SPEC backstop) | Open `/discovery/<slug>` at both widths and inspect headers |
| Bar chips truncate at 256px; phone bar shows count + two buttons on one line | ROUTE-05 | Visual layout (UI-SPEC backstop) | Select 4 long-named strategies at 1280px and 375px |
| Pinned stack with the select column at `@3xl` while scrolling horizontally | ROUTE-05 | Visual layout (UI-SPEC backstop) | Scroll the table horizontally at a wide viewport |
| Keyboard path checkbox → bar → `/compare` search | ROUTE-05 | Focus visibility (UI-SPEC backstop) | Keyboard-only walk per UI-SPEC UI Considerations |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
