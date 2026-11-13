---
phase: "199"
slug: "managerhome-each-role-lands-on-its-own-page-and-a-manager-has"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-09"
---

# Phase 199 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Seeded from 199-RESEARCH.md "Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (jsdom + node projects); Playwright for e2e |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `npx vitest run <file>` (after `npm ci`) |
| **Full suite command** | `npm run test && npm run typecheck && npm run lint` |
| **Estimated runtime** | ~600 seconds full; under 30 seconds per quick run |

---

## Sampling Rate

- **After every task commit:** the task's own `npx vitest run <files>` plus `npm run typecheck`
- **After every plan wave:** `npm run test && npm run lint` (route contract included)
- **Before `/gsd-verify-work`:** full suite green plus the CI e2e lists
- **Max feedback latency:** 30 seconds per task

---

## Per-Task Verification Map

Filled by the planner per task; the requirement-level map below is the floor every plan must cover.

### Requirement → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ROUTE-01 | `roleHomeFor` truth table: unapproved → `/pending-approval`, admin → `/admin`, manager → `/strategies`, allocator and `both` → `/allocations`, unknown role → `/pending-approval`; `safeRedirectPath` accepts `/compare`, rejects `//evil`, `https://…`, `/\evil`, `/A` | unit | `npx vitest run src/lib/routing/role-home.test.ts` | ❌ Wave 0 |
| ROUTE-01 | `/home` page: no user → `/`; profile error throws; each role redirects to its home; admin via `isAdminUser` fallback | unit (mocked client) | `npx vitest run src/app/home/page.test.tsx` | ❌ Wave 0 |
| ROUTE-01 | proxy: signed-in `/login`, `/signup`, `/forgot-password` bounce to `/home`; `?redirect=/x` wins; anon `/home` passes; signed-in `/home` not redirected | unit | `npx vitest run src/proxy.test.ts` | ✅ (edit) |
| ROUTE-01 | `LoginForm` pushes the sanitized `redirectTo`, else `/home`; login page sanitizes `redirect`/`next` and the `code` branch | component | `npx vitest run src/components/auth/LoginForm.test.tsx "src/app/(auth)/login/page.test.tsx"` | ❌ Wave 0 |
| ROUTE-01 | every "home" site reads `ROLE_HOME_ROUTE`/`roleHomeFor`; a new hard-coded `/discovery/crypto-sma` outside the navigation allowlist fails | structural | `npx vitest run src/__tests__/role-home-call-sites.test.ts` | ❌ Wave 0 |
| ROUTE-01 | admin guards and `/home` cannot loop (same admin predicate) | unit | `npx vitest run src/lib/routing/role-home.test.ts` | ❌ Wave 0 |
| ROUTE-01 | pending-approval and marketing header use the role home | unit | `npx vitest run "src/app/(auth)/pending-approval/page.test.tsx" src/components/marketing/MarketingHeaderActions.test.tsx` | ✅ (edit) |
| ROUTE-01 | real sign-in lands per role; deep link wins | e2e (seeded) | `npx playwright test e2e/role-home.spec.ts` (CI `e2e-seeded`) | ❌ Wave 0 |
| LEAN-01 | `/my-strategies?x=1` → 308 to `/strategies?x=1`, never `/login` | e2e (unseeded) + config unit | `npx playwright test e2e/route-redirects.spec.ts` and `npm run check:route-contract` | ✅ (edit) |
| LEAN-01 | index admits allocator, manager, both; `new/**` and `[id]/**` stay `manager`; every non-index page under `strategies/` sits under a guarded layout | structural | `npx vitest run "src/app/(dashboard)/requireRolePage-wiring.test.tsx" src/__tests__/strategies-guard-coverage.test.ts` | ✅ edit / ❌ Wave 0 |
| LEAN-01 | one `href="/strategies"` per role on desktop and drawer; no `/my-strategies` link anywhere in nav | component | `npx vitest run src/components/layout/Sidebar.test.tsx src/components/layout/MobileNav.test.tsx` | ✅ (edit) |
| LEAN-01 | merged page per role: allocator sees placeholders, ownership tag, mark/rename, Simulate, no Edit/share/intros; manager the inverse; both the union; allocator wizard draft is a row; empty vs failed read | component (mocked client) | `npx vitest run "src/app/(dashboard)/strategies/page.merged.test.tsx"` | ❌ Wave 0 |
| LEAN-01 | Phase 149 parity contract on the merged files | structural | `npx vitest run src/__tests__/phase-149-my-strategies-parity.test.ts` | ✅ (edit) |
| LEAN-01 | public table mounts byte-identical; owner-list pins per role | component golden | `npx vitest run src/components/strategy/StrategyTable.default-mounts.test.tsx` | ✅ (edit) |
| ROUTE-11 | `strategyHealthOf` order and every word incl. `—` cases, key-status-unreadable demotion, future/unknown series end, uses `SERIES_STALE_DAYS` boundary (7 days → Healthy, 8 → Stale) | unit | `npx vitest run src/lib/strategy-health.test.ts` | ❌ Wave 0 |
| ROUTE-11 | Health column renders the server word with its tone; placeholder `—` | component | `npx vitest run src/components/strategy/StrategyTable.health.test.tsx` | ❌ Wave 0 |
| ROUTE-11 | legend has an entry for every strategy status, ownership tag, pipeline chip, key pill and Health word; legend operator text matches the ladder | component | `npx vitest run "src/app/(dashboard)/strategies/StrategiesLegend.test.tsx"` | ❌ Wave 0 |
| ROUTE-11 | registry: every `degrade` entry's rendered sample names its key or day AND carries its vocabulary action; `whole_history` allowlist count-pinned; `recipient` never names a key; dead key names only itself | unit | `npx vitest run src/lib/degrade-warnings.test.ts` | ❌ Wave 0 |
| ROUTE-11 | scan: unregistered warning in a scanned surface fails; orphan registry entry fails | structural | `npx vitest run src/__tests__/degrade-warning-scan.test.ts` | ❌ Wave 0 |
| ROUTE-11 | reflow at 320px and axe per role on `/strategies` | e2e (seeded) | `npx playwright test e2e/reflow-sweep-authed.spec.ts e2e/axe-app-wide.spec.ts` (CI) | ✅ (edit) |

Rule 9 evidence each new gate must carry in its SUMMARY: back up the source with `cp -p`, neuter (e.g. delete the key slot from `DepartedHistoryNote`'s template; re-add the `/discovery/crypto-sma` literal to `LoginForm`; drop `requireRolePage` from `new/layout.tsx`; remove `/home` from `isAuthBounceExempt`), run the test, see RED naming the cause, restore from the backup, `cmp` exits 0, GREEN.


*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Rule 9: each new gate is shown RED against a neutered source restored from a `cp -p` byte backup, then GREEN (see 199-RESEARCH.md).

---

## Wave 0 Requirements

- [ ] `npm ci` in the worktree (no `node_modules` today).
- [ ] `src/lib/routing/role-home.test.ts`
- [ ] `src/app/home/page.test.tsx`
- [ ] `src/components/auth/LoginForm.test.tsx` (none exists today; check with `ls src/components/auth/`), login page test
- [ ] `src/__tests__/role-home-call-sites.test.ts`
- [ ] `src/__tests__/strategies-guard-coverage.test.ts`
- [ ] `src/app/(dashboard)/strategies/page.merged.test.tsx`
- [ ] `src/lib/strategy-health.test.ts`, `StrategyTable.health.test.tsx`, `StrategiesLegend.test.tsx`
- [ ] `src/lib/degrade-warnings.test.ts`, `src/__tests__/degrade-warning-scan.test.ts`
- [ ] `e2e/role-home.spec.ts` + its `ci.yml` seeded-list entry

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Seeded per-role sign-in landing and reflow/axe on `/strategies` | ROUTE-01, ROUTE-11 | seeded e2e runs only in CI | read the CI `e2e-seeded` run bound to the head SHA |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
