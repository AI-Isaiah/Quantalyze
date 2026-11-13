---
phase: "196"
slug: "onestrategypage"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-08"
---

# Phase 196 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Seeded from
> `196-RESEARCH.md` § Validation Architecture; the per-task map is filled when plans exist.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom default project, node project for `NODE_ENV_TEST_FILES`); Playwright for e2e |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `npx vitest run "src/app/factsheet" "src/app/factsheet-share" src/__tests__/check-route-contract.test.ts src/__tests__/trim-removed-surfaces.test.tsx && npm run check:route-contract` |
| **Full suite command** | `npm run lint && npm test` |
| **Estimated runtime** | ~120 seconds quick; full suite several minutes |

---

## Sampling Rate

- **After every task commit:** quick run command plus the task's own new test file
- **After every plan wave:** `npm run lint && npm test`
- **Before `/gsd-verify-work`:** full suite green and the e2e redirect canary (`e2e/route-redirects.spec.ts`) green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 196-01-T1 | 01 | 1 | LEAN-05 | T-196-01 | census output carries no id | unit + self-test | `npx vitest run scripts/factsheet-census/count.test.tsx && npx tsx scripts/factsheet-census/run.ts --self-test` | ❌ W0 | ⬜ |
| 196-01-T2 | 01 | 1 | LEAN-05 | T-196-01 | `196-CENSUS.md` id-free | file + grep | `grep -a -E -c "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}" 196-CENSUS.md` returns 0 | ❌ W0 | ⬜ |
| 196-02-T1 | 02 | 1 | LEAN-02, ROUTE-02 | T-196-03, T-196-05 | redirects DB-free, unconditional, never `/login`; pre-phase knip reading | unit + e2e | `npx vitest run src/__tests__/strategy-route-redirects.test.ts && npm run check:route-contract` | ❌ W0 | ⬜ |
| 196-02-T2 | 02 | 1 | LEAN-02 | — | badge anti-mask guard still bites; v2-shell specs leave with the redirect that makes them unreachable | e2e list | `npx playwright test --list e2e/mt5-badge.spec.ts e2e/sfox-badge.spec.ts && npx vitest run src/__tests__/contracts` | ✅ | ⬜ |
| 196-03-T1 | 03 | 1 | ROUTE-04 | T-196-06 | back link from a closed map | unit | `npx vitest run src/lib/factsheet/origin.test.ts src/components/factsheet/BackLink.test.tsx` | ❌ W0 | ⬜ |
| 196-03-T2 | 03 | 1 | ROUTE-04 | T-196-06, T-196-07 | no open redirect, no off-site history | unit | same as T1 | ❌ W0 | ⬜ |
| 196-04-T1 | 04 | 1 | ROUTE-04 | — | busy state announced | unit | `npx vitest run src/components/strategy/RequestIntroButton.test.tsx` | ❌ W0 | ⬜ |
| 196-04-T2 | 04 | 1 | ROUTE-04 | T-196-08 | one request per click burst | unit | same as T1 | ❌ W0 | ⬜ |
| 196-05-T1 | 05 | 2 | ROUTE-04 | T-196-10, T-196-14 | viewer after lane decision, never in cache; role plus approval fails closed | integration + unit | `npx vitest run "src/app/factsheet/[id]/v2/page" src/lib/factsheet/viewer.test.ts` | ❌ W0 | ⬜ |
| 196-05-T2 | 05 | 2 | ROUTE-04, ROUTE-02 | T-196-11, T-196-13 | per-viewer actions, never Sign up with a session | integration | `npx vitest run "src/app/factsheet/[id]/v2/page" src/components/ui && npx tsc --noEmit` | ❌ W0 | ⬜ |
| 196-06-T1 | 06 | 2 | ROUTE-04 | T-196-15 | table and grid links carry origin | unit | `npx vitest run src/components/strategy` | ✅ | ⬜ |
| 196-06-T2 | 06 | 2 | ROUTE-04 | T-196-15 | owner-side mounts carry origin | unit | `npx vitest run "src/app/(dashboard)/strategies" "src/app/(dashboard)/my-strategies"` | ✅ | ⬜ |
| 196-06-T3 | 06 | 2 | ROUTE-04 | — | e2e rows found by id prefix | e2e list | `npx playwright test --list e2e/discovery-watchlist.spec.ts e2e/layout-narrow.spec.ts` | ✅ | ⬜ |
| 196-07-T1 | 07 | 3 | LEAN-02 | T-196-16 | no retired-route href | guard | `npx vitest run src/__tests__/one-strategy-page-links.test.ts` | ❌ W0 | ⬜ |
| 196-07-T2 | 07 | 3 | ROUTE-04, LEAN-02 | T-196-16 | one builder, redirect origins parse | guard | `npx vitest run src/__tests__/one-strategy-page-links.test.ts` | ❌ W0 | ⬜ |
| 196-08-T1 | 08 | 3 | ROUTE-02 | T-196-18, T-196-19 | browse header session-aware | unit | `npx vitest run src/app/browse` | ❌ W0 | ⬜ |
| 196-08-T2 | 08 | 3 | ROUTE-02 | — | browse prompts hide with a session | unit | same as T1 | ✅ extend | ⬜ |
| 196-09-T1 | 09 | 2 | LEAN-05 | T-196-20 | Main metrics groups, part=all byte-identical | unit | `npx vitest run "src/app/factsheet/[id]/v2/MetricsColumn"` | ❌ W0 | ⬜ |
| 196-09-T2 | 09 | 2 | LEAN-05 | T-196-20 | zero repeated labels across parts | unit | same as T1 | ❌ W0 | ⬜ |
| 196-09-T3 | 09 | 2 | LEAN-05 | — | notes classified; neuter evidence | unit | `npx vitest run "src/app/factsheet/[id]/v2/MetricsColumn.parts.test.tsx"` | ❌ W0 | ⬜ |
| 196-10-T1 | 10 | 3 | LEAN-05 | — | opening view, deferred Advanced mount | unit | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody"` | ❌ W0 | ⬜ |
| 196-10-T2 | 10 | 3 | LEAN-05, LEAN-02 | T-196-22, T-196-23, T-196-24 | storage, reset-view, print, Print view link | unit | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.advanced.test.tsx"` | ❌ W0 | ⬜ |
| 196-10-T3 | 10 | 3 | LEAN-05 | — | moved tests keep every assertion | unit + e2e list | `npx vitest run "src/app/factsheet/[id]/v2"` | ✅ | ⬜ |
| 196-11-T1 | 11 | 4 | LEAN-05 | — | one chart hint, a11y parity | unit | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody"` | ❌ W0 | ⬜ |
| 196-11-T2 | 11 | 4 | LEAN-05 | T-196-26 | one warning, empty sections hidden | unit | same as T1 | ❌ W0 | ⬜ |
| 196-11-T3 | 11 | 4 | LEAN-05 | T-196-25 | KPI comparator line, census after-targets | unit | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.census.test.tsx"` | ❌ W0 | ⬜ |
| 196-12-T1 | 12 | 3 | ROUTE-04 | T-196-27 | visitor header on the token route | unit | `npx vitest run "src/app/factsheet-share/[token]/page.test.tsx"` | ✅ extend | ⬜ |
| 196-12-T2 | 12 | 3 | ROUTE-02, ROUTE-04 | T-196-27, T-196-28, T-196-29, T-196-30 | session wins, chrome only, no cache reach | unit + static | `npx vitest run "src/app/factsheet-share"` | ✅ extend | ⬜ |
| 196-13-T1 | 13 | 4 | LEAN-02 | T-196-33, T-196-34, T-196-35, T-196-39 | print view, attestation gate kept, ranks and contact block kept | unit | `npx vitest run "src/app/factsheet/[id]/tearsheet/page.test.tsx"` | ✅ rewrite | ⬜ |
| 196-13-T2 | 13 | 4 | LEAN-02 | — | rank-gate arms kept on the print view; every HEAD tearsheet item has a verified home | unit | `npx vitest run "src/app/factsheet/[id]/tearsheet" src/__tests__/figure-parity-pages.test.tsx` | ✅ | ⬜ |
| 196-13-T3 | 13 | 4 | LEAN-02 | T-196-31, T-196-32 | full LP report or 503 | unit | `npx vitest run "src/app/api/factsheet"` | ✅ extend | ⬜ |
| 196-14-T1 | 14 | 6 | LEAN-02 | T-196-46 | shell and its two D-06 panels deleted, loss described for plan 21 | tsc + unit | `npx tsc --noEmit && npx vitest run src/components tests/visual src/__tests__/display-sign-single-source.test.ts` | ✅ | ⬜ |
| 196-14-T2 | 14 | 6 | LEAN-02 | T-196-46 | shell-only components gone, live ones kept, scan rows in step | tsc + unit | `npx tsc --noEmit && npx vitest run src/components tests src/__tests__/display-sign-single-source.test.ts "src/app/factsheet/[id]/v2"` | ✅ | ⬜ |
| 196-14-T3 | 14 | 6 | LEAN-02 | T-196-46, T-196-47 | library orphans and shell-reader exports gone; knip diff fully dispositioned | tsc + unit + knip diff | `npx tsc --noEmit && npx vitest run src/lib/queries src/lib/factsheet src/lib/complete-status-scan.test.ts src/hooks src/components && npx knip --include files,exports --reporter compact` | ✅ | ⬜ |
| 196-15-T1 | 15 | 2 | LEAN-02 | T-196-38 | discovery detail tree gone, its tests moved in the same task | unit + tsc | `npx vitest run src/__tests__/phase-147-series-resolution-guards.test.ts src/components/layout/DashboardChrome.test.tsx && npx tsc --noEmit && npm run check:route-contract` | ✅ | ⬜ |
| 196-16-T1 | 16 | 5 | LEAN-02 | T-196-40 | ranks inside Advanced, per request, never cached | integration | `npx vitest run "src/app/factsheet/[id]/v2/page.peer-ranks.test.tsx"` | ❌ W0 | ⬜ |
| 196-16-T2 | 16 | 5 | LEAN-02, LEAN-05 | T-196-41 | rank gate on the factsheet mount; no repeated metric | unit | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.peer-ranks.test.tsx" src/lib/factsheet/peer-ranks.test.ts` | ❌ W0 | ⬜ |
| 196-16-T3 | 16 | 5 | LEAN-02 | — | declared benchmark row; every HEAD tearsheet item's home pinned | unit | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.tearsheet-homes.test.tsx"` | ❌ W0 | ⬜ |
| 196-17-T1 | 17 | 2 | LEAN-02, ROUTE-02 | T-196-43 | browse detail tree gone, its tests moved | unit + tsc | `npx vitest run src/__tests__/trim-removed-surfaces.test.tsx src/app/browse && npx tsc --noEmit && npm run check:route-contract` | ✅ | ⬜ |
| 196-18-T1 | 18 | 2 | LEAN-02 | T-196-44 | `/strategy/[id]/v2` tree gone, URL still routes | tsc + contract | `npx tsc --noEmit && npm run check:route-contract && npx vitest run src/__tests__/strategy-route-redirects.test.ts src/__tests__/check-route-contract.test.ts` | ✅ | ⬜ |
| 196-18-T2 | 18 | 2 | LEAN-02, ROUTE-02 | T-196-44 | `/strategy/[id]` tree gone, status census in step | unit + contract | `npx vitest run src/lib/complete-status-scan.test.ts src/__tests__/check-route-contract.test.ts && npx tsc --noEmit && npm run check:route-contract` | ✅ | ⬜ |
| 196-19-T1 | 19 | 3 | ROUTE-04 | — | one main landmark beside the chrome; axe and reflow rows | unit + e2e list | `npx vitest run "src/app/factsheet/[id]/v2" && npx tsc --noEmit && npx playwright test --list e2e/axe-app-wide.spec.ts e2e/reflow-sweep-authed.spec.ts` | ✅ extend | ⬜ |
| 196-19-T2 | 19 | 3 | LEAN-02 | T-196-12 | published-only indexing | unit | `npx vitest run "src/app/factsheet/[id]/v2/page.metadata.test.tsx"` | ✅ extend | ⬜ |
| 196-20-T1 | 20 | 2 | ROUTE-04 | T-196-45 | holdings link carries from=allocations, back link names My allocation | unit | `npx vitest run "src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx"` | ✅ extend | ⬜ |
| 196-20-T2 | 20 | 2 | ROUTE-04 | T-196-45 | watchlist, composer and optimizer links carry origin | unit | `npx vitest run "src/app/(dashboard)/allocations/components" "src/app/(dashboard)/allocations/widgets" src/components/portfolio && npx tsc --noEmit` | ✅ | ⬜ |
| 196-21-T1 | 21 | 7 | LEAN-02 | T-196-36 | end-of-phase knip reading; every new entry dispositioned | knip diff | `npx knip --include files,exports --reporter compact` | ✅ | ⬜ |
| 196-21-T2 | 21 | 7 | LEAN-05, LEAN-02 | T-196-36, T-196-37 | census After id-free; D-06 booked | unit + grep | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.census.test.tsx"` | ❌ W0 | ⬜ |
| 196-21-T3 | 21 | 7 | all four | T-196-37 | full gates; ship notes list no tearsheet item as dropped | full suite | `npm test && npm run lint && npx tsc --noEmit && npm run check:route-contract` | ✅ | ⬜ |

Requirement → test map (from research):

| Req | Behavior | Command | Exists |
|-----|----------|---------|--------|
| LEAN-02 | Four `redirects()` rules, 308, origin carried | `npx vitest run src/__tests__/strategy-route-redirects.test.ts` | ❌ W0 |
| LEAN-02 | Manifest lockstep | `npm run check:route-contract` | ✅ |
| LEAN-02 | First hop 308, `Location` carries origin + query, never `/login` | `npx playwright test e2e/route-redirects.spec.ts` | ✅ extend |
| LEAN-02 | No in-app href to a retired route; factsheet links carry `from` | `npx vitest run src/__tests__/one-strategy-page-links.test.ts` | ❌ W0 |
| LEAN-02 | Tearsheet renders the opening view; attestation gate kept; ranks and contact block kept | `npx vitest run "src/app/factsheet/[id]/tearsheet"` | ✅ rewrite |
| LEAN-02 | Tearsheet ranks also live inside Advanced on the factsheet, same gate | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.peer-ranks.test.tsx"` | ❌ W0 |
| LEAN-02 | Every HEAD tearsheet item has a factsheet home | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.tearsheet-homes.test.tsx"` | ❌ W0 |
| ROUTE-02 | `/browse` layout, root and `[slug]` show no sign-up prompt with a session | `npx vitest run src/app/browse` | ✅ extend |
| ROUTE-02 | Owner opens own unpublished; anonymous after still 404; no cache bleed | `npx vitest run "src/app/factsheet/[id]/v2/page.owner-lane.test.tsx" "src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx"` | ✅ |
| ROUTE-04 | Viewer matrix (visitor / allocator / owner / manager) | `npx vitest run "src/app/factsheet/[id]/v2/page.viewer-chrome.test.tsx"` | ❌ W0 |
| ROUTE-04 | Back link closed set, never off-site | `npx vitest run src/lib/factsheet/origin.test.ts` | ❌ W0 |
| ROUTE-04 | Share route header + sign-up line, AUM stripped | `npx vitest run "src/app/factsheet-share/[token]"` | ✅ extend |
| LEAN-05 | Opening view + Advanced disclosure behaviour | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.advanced.test.tsx"` | ❌ W0 |
| LEAN-05 | Zero repeated metrics, one hint, ≤1 small-sample warning, no "— on request" | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.census.test.tsx"` | ❌ W0 |
| SC-5 | Before/after census on three named strategies, print + share | committed census script → `196-CENSUS.md` | ❌ W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Every new gate carries neuter → RED → restore evidence (restore from a byte backup, never git checkout on uncommitted work).

---

## Wave 0 Requirements

- [ ] `npm ci` in the worktree
- [ ] `196-CENSUS.md` "before" counts, measured before any layout change merges
- [ ] `src/__tests__/strategy-route-redirects.test.ts`
- [ ] `src/__tests__/one-strategy-page-links.test.ts`
- [ ] `src/lib/factsheet/origin.test.ts`
- [ ] `src/app/factsheet/[id]/v2/page.viewer-chrome.test.tsx`
- [ ] `src/app/factsheet/[id]/v2/FactsheetBody.advanced.test.tsx`, `FactsheetBody.census.test.tsx`
- [ ] `src/app/factsheet/[id]/v2/page.peer-ranks.test.tsx`, `FactsheetBody.peer-ranks.test.tsx`, `FactsheetBody.tearsheet-homes.test.tsx`, `src/lib/factsheet/peer-ranks.test.ts`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Header wrap and long labels at 320px / 1440px | ROUTE-04 | visual backstop (UI-SPEC UI Considerations) | load `/factsheet/[id]` signed in and anonymous at both widths; no horizontal scroll, labels wrap, 44px targets |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
