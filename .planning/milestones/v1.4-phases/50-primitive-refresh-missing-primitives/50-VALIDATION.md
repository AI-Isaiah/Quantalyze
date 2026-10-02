---
phase: 50
slug: primitive-refresh-missing-primitives
status: finalized
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-29
finalized: 2026-06-29
---

# Phase 50 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Per-task map populated by the planner from 50-RESEARCH.md §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS unit/component, jsdom) + Playwright (axe e2e) + ESLint (design-lint) |
| **Config file** | `vitest.config.ts` · `playwright.config.ts` · `eslint.config.mjs` |
| **Quick run command** | `npx vitest run <touched test file>` |
| **Full suite command** | `npm run test:coverage && npm run lint` (+ `npx playwright test <axe spec>` for a11y) |
| **Estimated runtime** | ~90-180 seconds (unit) · axe e2e separate |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run <touched test file>`
- **After every plan wave:** Run `npm run test:coverage && npm run lint`
- **Before `/gsd:verify-work`:** Full suite green + `e2e/discovery-axe.spec.ts` + `e2e/admin-compute-jobs-axe.spec.ts` (seeded) green
- **Max feedback latency:** ~180 seconds (unit); axe e2e on demand

---

## Per-Task Verification Map

> Each requirement maps to an automated assertion. Anchored to the 6 phase requirements:
> UI-01, UI-02, UI-03, UI-04, STATE-03, STATE-04.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 01-T1 | 50-01 | 1 | UI-04 | T-50-SC | Supply-chain: blocking human legitimacy gate before install | checkpoint | (human-verify; blocks Task 2 — never auto-approvable) | n/a | ⬜ pending |
| 01-T2 | 50-01 | 1 | UI-02/UI-04 | T-50-SC/T-50-01 | Exact-pin + no postinstall | unit/script | `node -e "require('./package.json').dependencies['@radix-ui/react-tabs']==='1.1.15'"` | package.json | ⬜ pending |
| 01-T3 | 50-01 | 1 | UI-01/UI-02 | — | N/A | unit (RED) | `npx vitest run src/components/ui/{Tabs,Table,Field}.test.tsx` (RED pre-impl) | NEW ×5 | ⬜ pending |
| 02-T1 | 50-02 | 2 | UI-01 | T-50-02/T-50-03 | No XSS sink; AA keyboard focus preserved | unit | `npx vitest run src/components/ui/Button.test.tsx src/components/ui/Modal.test.tsx` | NEW (Wave 0) | ⬜ pending |
| 02-T2 | 50-02 | 2 | UI-01/UI-04 | T-50-02 | Select stays native; no Radix | unit/grep | `npx vitest run src/components/ui/` + `grep -c '<select' src/components/ui/Select.tsx` | existing suite | ⬜ pending |
| 02-T3 | 50-02 | 2 | UI-01 | — | N/A | unit/grep | `npx vitest run src/components/ui/` + `grep -c text-caption Badge.tsx` + Card unchanged | existing suite | ⬜ pending |
| 03-T1 | 50-03 | 2 | UI-02/UI-04 | T-50-SC/T-50-04 | Radix only on Tabs; no innerHTML | unit | `npx vitest run src/components/ui/Tabs.test.tsx` | NEW (Wave 0) | ⬜ pending |
| 03-T2 | 50-03 | 2 | UI-02 | T-50-04 | th scope; named landmark; no innerHTML | unit | `npx vitest run src/components/ui/Table.test.tsx` | NEW (Wave 0) | ⬜ pending |
| 03-T3 | 50-03 | 2 | UI-02 | T-50-04/V5 | aria-describedby+aria-invalid; no innerHTML; no in-primitive validation | unit | `npx vitest run src/components/ui/Field.test.tsx` | NEW (Wave 0) | ⬜ pending |
| 04-T1 | 50-04 | 2 | STATE-04 | T-50-06 | No motion library; reduced-motion fallback | unit | `npx vitest run src/lib/view-transition.test.ts` | NEW | ⬜ pending |
| 04-T2 | 50-04 | 2 | STATE-04 | T-50-05 | CSP unchanged; reduced-motion extends not bypasses | grep/unit | `grep -E 'view-transition-(old\|new)' src/app/globals.css` + `npx vitest run src/components/ui/` | existing suite | ⬜ pending |
| 05-T1 | 50-05 | 3 | UI-02/UI-03 | T-50-04 | No innerHTML in tab content | unit | `npx vitest run src/components/admin/AdminTabs.test.tsx` | EDIT (port) | ⬜ pending |
| 05-T2 | 50-05 | 3 | UI-02/UI-03 | T-50-07/T-50-08 | URL param coerced; allocatorOnly gate preserved | unit | `npx vitest run src/components/auth/ProfileTabs.test.tsx` | EDIT (port, getByRole tab) | ⬜ pending |
| 05-T3 | 50-05 | 3 | UI-02/UI-03 | T-50-04 | External panel aria wiring preserved | unit | `npx vitest run src/components/strategy/WatchlistTabs.test.tsx src/components/strategy/StrategyTable.test.tsx` | EDIT (port) | ⬜ pending |
| 06-T1 | 50-06 | 3 | STATE-03 | T-50-04 | Sticky opaque; no innerHTML | unit | `npx vitest run src/components/strategy/StrategyTable.test.tsx` | EDIT (extend) | ⬜ pending |
| 06-T2 | 50-06 | 3 | STATE-03/STATE-04 | T-50-09/T-50-05 | Honest collapsed values (no fabricated 0/—); table-scoped density; CSP ok | unit | `npx vitest run src/components/strategy/StrategyTable.test.tsx` | EDIT (extend) | ⬜ pending |
| 06-T3 | 50-06 | 3 | STATE-03 | T-50-09 | discovery axe green; honest-null asserted | unit + axe-e2e | `npx vitest run src/components/strategy/StrategyTable.test.tsx && npm run lint` + (CI) `e2e/discovery-axe.spec.ts` | EDIT + existing spec | ⬜ pending |
| 07-T1 | 50-07 | 3 | UI-03/UI-02 | T-50-10/T-50-11/T-50-04 | Admin gate + claim-token gate preserved; no innerHTML; no inline hex | unit/lint | `npx vitest run src/components/admin/ComputeJobsTable.test.tsx && npm run lint` | EDIT | ⬜ pending |
| 07-T2 | 50-07 | 3 | UI-03 | — | Behavior-identical port | unit | `npx vitest run src/components/admin/ComputeJobsTable.test.tsx` | EDIT (port) | ⬜ pending |
| 07-T3 | 50-07 | 3 | UI-03 | T-50-10 | Admin-gated axe spec; zero violations | axe-e2e | (CI seeded) `npx playwright test e2e/admin-compute-jobs-axe.spec.ts` | NEW + ci.yml | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements (Plan 50-01)

> All MISSING references from 50-RESEARCH.md §Wave 0 Gaps are created in Plan 50-01:

- [ ] Install + legitimacy-gate `@radix-ui/react-tabs@1.1.15` (research tagged slopcheck `[ASSUMED]`; cleared by the blocking human checkpoint 01-T1, exact-pinned in 01-T2).
- [ ] New-primitive RED test contracts authored before GREEN: `Tabs.test.tsx` / `Table.test.tsx` / `Field.test.tsx` (01-T3).
- [ ] Core-primitive lock tests where none exist today: `Button.test.tsx` (token classes + focus-visible) + `Modal.test.tsx` (title tier + close focus-visible) to pin the `focus:`→`focus-visible:` edit and hold the BP-03 ratchet (82/80/74/72) (01-T3).
- [ ] Ported tests are EDITS in their owning waves (not Wave 0): `ProfileTabs.test.tsx` (getByRole button→tab, Pitfall 2) and `WatchlistTabs.test.tsx` (preserve id/aria-controls, Pitfall 1) in Plan 50-05; `StrategyTable.test.tsx` extended in Plan 50-06; `ComputeJobsTable.test.tsx` ported in Plan 50-07.

*Existing infrastructure (vitest, Playwright axe specs incl. `discovery-axe.spec.ts` + `admin-csv-status-axe.spec.ts` analog, eslint-plugin-quantalyze design-lint) covers the rest — no framework install needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Keyboard-tab focus-visible sweep on Button + Tabs (ring on keyboard, not on mouse click) | UI-01 / UI-02 | axe cannot detect a missing keyboard ring (Pitfall 4) | Tab through a page with Buttons + the consolidated Tabs; confirm the accent ring appears on keyboard focus and not on mouse click; confirm the AA focus indicator (≥3:1) is present. |
| 400% zoom + ultra-wide render of the reshaped dense table (no clip/overlap/h-scroll-trap) | STATE-03 / TYPE | Real-zoom + real-viewport rendering is browser-runtime | Open /discovery, zoom 400% and resize to 2560px; confirm sticky header/first-col hold, the collapse is reachable, Compact does not clip, no content is lost. |
| View-Transition cross-fade feels restrained + honors reduced-motion | STATE-04 | Motion perception is human judgment | Toggle tabs + density with motion on, then with macOS `prefers-reduced-motion: reduce`; confirm the instant-swap fallback and no decorative motion. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or a Wave 0 dependency (the lone checkpoint 01-T1 is a blocking human legitimacy gate, by protocol; every other task carries an automated command).
- [x] Sampling continuity: no 3 consecutive tasks without an automated verify (every implementation task has a `npx vitest run` / grep / lint command).
- [x] Wave 0 covers all MISSING references (the 3 new-primitive specs + 2 core lock specs from §Wave 0 Gaps).
- [x] No watch-mode flags (all `vitest run`, never `vitest --watch`).
- [x] Feedback latency < 180s (unit suite; axe e2e is on-demand / CI-seeded).
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** finalized 2026-06-29 — per-task map populated, Wave-0 coverage confirmed, nyquist_compliant flipped true.
