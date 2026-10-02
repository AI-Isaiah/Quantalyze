---
phase: 13
plan: 02
subsystem: discovery
tags:
  - customize
  - localStorage
  - per-user-prefs
  - drawer
  - cross-account-isolation
  - DISCO-02
  - DISCO-05
dependency_graph:
  requires:
    - 13-01 (Wave 1 — StrategyTable userId + initialWatchedSet plumbing,
      StrategyFilters leadingSlot prop)
  provides:
    - useDiscoveryPrefs hook (per-user-keyed Customize prefs)
    - CustomizeDrawer component (right-edge slide-out)
    - DEFAULTS constant (DISCO-05 default lock — hide_examples=true)
    - Cross-account-isolation Playwright spec
  affects:
    - StrategyTable.tsx (now owns CustomizeDrawer state + hydration)
    - StrategyFilters.tsx (cog button replaces text "Customize" Button;
      legacy CustomizeModal + DEFAULT_CUSTOMIZE removed)
tech-stack:
  added: []
  patterns:
    - "Hydration-then-persist gate (mirrors TweaksContext.tsx:55-99)"
    - "Per-user-keyed localStorage shape: discovery_view_preferences:{uid}:{slug}"
    - "Bespoke right-edge slide-out drawer (no Modal primitive — UI-SPEC mandate)"
    - "WCAG 2.5.3 Label-in-Name (visible text === aria-label on primary CTA)"
key-files:
  created:
    - src/lib/discovery-prefs.ts
    - src/lib/discovery-prefs.test.ts
    - src/components/strategy/CustomizeDrawer.tsx
    - src/components/strategy/CustomizeDrawer.test.tsx
    - e2e/discovery-prefs-isolation.spec.ts
  modified:
    - src/components/strategy/StrategyFilters.tsx
    - src/components/strategy/StrategyTable.tsx
decisions:
  - "DEFAULT_CUSTOMIZE + CustomizeSettings removed entirely (zero non-test
    importers — verified via grep)"
  - "useDiscoveryPrefs signature is `(uid: string | undefined, slug: string)` —
    hook handles undefined-uid case structurally (Task 1 case 12 lock); no
    retroactive Task 2 rewrite required from Task 3"
  - "E2E spec authored with test.skip when neither E2E_USER_A_EMAIL nor
    TEST_SUPABASE_URL is wired (TODOS.md Q4 RESOLVED 2026-04-28 path)"
metrics:
  start: "2026-04-28T22:10:09Z"
  completed: "2026-04-28T22:22:34Z"
  duration_minutes: 12
  tasks_completed: 4
  files_created: 5
  files_modified: 2
  unit_tests_added: 27
  unit_tests_total_after: 2356
  unit_tests_total_before: 2329
  e2e_specs_added: 1
---

# Phase 13 Plan 02: DISCO-02 Customize Prefs Drawer Summary

Per-user-keyed Customize prefs (Default view / Default sort / Hide examples) now persist in `localStorage["discovery_view_preferences:{auth.uid}:{slug}"]` via the new `useDiscoveryPrefs` hook, edited through a bespoke right-edge slide-out drawer that replaces the legacy centered Modal.

## What shipped

| Artifact | Status | Path |
|----------|--------|------|
| `useDiscoveryPrefs(uid, slug)` hook + `DEFAULTS` + `keyFor` + `safeRead` | new | `src/lib/discovery-prefs.ts` |
| `<CustomizeDrawer>` right-edge slide-out (role=dialog, ESC/backdrop close) | new | `src/components/strategy/CustomizeDrawer.tsx` |
| Vitest unit suite — hook (12 cases) | new | `src/lib/discovery-prefs.test.ts` |
| Vitest unit suite — drawer (15 cases) | new | `src/components/strategy/CustomizeDrawer.test.tsx` |
| Playwright cross-account isolation spec (test.skip when env missing) | new | `e2e/discovery-prefs-isolation.spec.ts` |
| Cog button replaces "Customize" text Button; legacy CustomizeModal + DEFAULT_CUSTOMIZE removed | modified | `src/components/strategy/StrategyFilters.tsx` |
| `useDiscoveryPrefs` + `<CustomizeDrawer>` wired into the table | modified | `src/components/strategy/StrategyTable.tsx` |

## Threat model — dispositions

| Threat ID | Disposition | Where mitigated |
|-----------|-------------|-----------------|
| T-13-02-01 (cross-account leak) | mitigate | `keyFor(uid, slug)` constructs the localStorage key from `auth.uid` only — structurally cannot read another uid's entry. Playwright spec `e2e/discovery-prefs-isolation.spec.ts` proves login-as-A → login-as-B leaves zero A-keys readable from B (when env wiring permits). |
| T-13-02-02 (tampering via DevTools) | mitigate | `safeRead` applies `{...DEFAULTS, ...parsed, sort: {...DEFAULTS.sort, ...(parsed.sort ?? {})}}` — extra/unknown fields are ignored at the merge layer (`src/lib/discovery-prefs.ts:64-71`). |
| T-13-02-03 (uid in server logs) | accept | uid never enters URL or server logs from this feature — localStorage-only. |
| T-13-02-04 (quota exhaustion) | accept | Single ~120-byte JSON entry; try/catch around `setItem` swallows Safari/quota errors (`src/lib/discovery-prefs.ts:104-110`). |

## Test results

| Suite | Result |
|-------|--------|
| Vitest full suite (`npm test`) | **2356 passed** | 148 skipped (2504 total). Wave 1 baseline (2329) preserved; +27 from new tests. |
| Vitest discovery-prefs.test.ts | **12/12 GREEN** |
| Vitest CustomizeDrawer.test.tsx | **15/15 GREEN** |
| `npm run build` | **exit 0** |
| Playwright spec listing (`npx playwright test --list -g "discovery prefs isolation"`) | **1 test in 1 file** |
| Playwright spec execution | **skipped** — `test.skip` is active because neither `E2E_USER_A_EMAIL` nor `TEST_SUPABASE_URL` is wired in this environment (TODOS.md Q4 — seed-helper fallback path). Spec authored and listed; ready to run when env wiring lands. |

## Acceptance criteria — Task 1 (Wave 0 RED)

| AC | Result |
|----|--------|
| `discovery-prefs.test.ts` test count >= 11 | **12** ✓ |
| `CustomizeDrawer.test.tsx` test count >= 15 | **15** ✓ |
| `e2e/discovery-prefs-isolation.spec.ts` exists | **yes** ✓ |
| `Save preferences` mentions in drawer test >= 2 | **11** ✓ |
| `Reset to defaults | Close customize panel | Saved per device` >= 3 | **11** ✓ |
| `discovery_view_preferences:` key-shape contract >= 1 | **8** ✓ |
| `hide_examples.*true` (DISCO-05 lock) >= 1 | **7** ✓ |
| `test.skip | process.env.E2E_USER_A_EMAIL` safeguard >= 1 | **4** ✓ |
| Tests in RED state (source files don't exist) | confirmed via run-and-fail then converted to GREEN in Task 2 ✓ |

## Acceptance criteria — Task 2 (Wave 1 GREEN)

| AC | Result |
|----|--------|
| `useDiscoveryPrefs` exported | **1** ✓ |
| `discovery_view_preferences:` literal in source | **3** ✓ |
| `hide_examples: true` (DISCO-05) | **1** ✓ |
| Persistence gate `if (!hydrated) return` | **1** ✓ |
| SSR guard `typeof window === "undefined"` | **2** ✓ |
| `CustomizeDrawer` exported | **1** ✓ |
| `Save preferences` (visible + aria-label) >= 2 | **3** ✓ |
| `Reset to defaults` >= 1 | **2** ✓ |
| `Close customize panel` >= 1 | **2** ✓ |
| `aria-modal="true"` / `role="dialog"` >= 2 | **3** ✓ |
| `Saved per device` | **2** (1 visible + 1 in JSDoc — visible-text contract met) ✓ |
| `Hide example strategies` | **1** ✓ |
| `Default view` / `Default sort` >= 2 | **7** ✓ |
| ESC key listener | **1** ✓ |
| Dirty-detection `JSON.stringify(draft) !== JSON.stringify(persisted)` >= 1 | **2** ✓ |
| Drawer does NOT use `<Modal>` primitive (negative) | confirmed (no actual import or render) ✓ |
| `npm test -- discovery-prefs CustomizeDrawer` exit 0 | ✓ |
| `npm run build` exit 0 | ✓ |

## Acceptance criteria — Task 3 (StrategyFilters cog + StrategyTable wiring)

| AC | Result |
|----|--------|
| `hideExamples: true` (or DEFAULT_CUSTOMIZE removed) | **DEFAULT_CUSTOMIZE removed entirely** (zero non-test importers) ✓ |
| `Customize discovery view` aria-label | **1** ✓ |
| `aria-haspopup="dialog"` | **1** ✓ |
| `function CustomizeModal` / `<CustomizeModal` removed (negative) | confirmed ✓ |
| `<Modal title="Customize` removed (negative) | confirmed ✓ |
| `useDiscoveryPrefs / CustomizeDrawer / onOpenCustomize` in StrategyTable >= 3 | **7** ✓ |
| `text-[11px] font-semibold` chip >= 1 | **1** ✓ |
| `text-[10px] font-bold` legacy chip absent (negative) | confirmed ✓ |
| Hook accepts `string | undefined` >= 1 | **2** ✓ |
| `test.skip` / `--grep` safeguard in e2e spec >= 1 | **2** ✓ |
| `npm test` exits 0 | ✓ |
| `npm run build` exits 0 | ✓ |
| `npx playwright test --list -g "discovery prefs isolation"` lists 1 test | ✓ |

## Acceptance criteria — Task 4 (visual smoke)

`autonomous: true` per the user's executor directive overrides the plan's `human-verify` gate. The drawer's behavior is fully covered by the 15 Vitest cases (ESC/backdrop/close-X close paths, dirty-detection, Reset-without-close, copywriting contract, ARIA attributes, scroll-lock, dialog labelling). No Claude-side action is required — the visual smoke is deferred to the user's standard `/qa` pass.

## Deviations from plan

### Auto-fixed issues

**1. [Rule 3 — Blocker] Localstorage mock pattern adjustment in `discovery-prefs.test.ts`**

- **Found during:** Task 2 — first run of the new tests.
- **Issue:** Initial test draft used `vi.spyOn(window.localStorage, ...)`, which fails under this project's vitest+jsdom configuration (the `--localstorage-file` warning printed by every test process indicates jsdom's localStorage is provisioned via a non-standard pathway that doesn't expose `getItem` as a property descriptor for `vi.spyOn`).
- **Fix:** Replaced the `vi.spyOn` pattern with the project's idiomatic Map-backed mock + `vi.stubGlobal("localStorage", ...)` + `Object.defineProperty(window, "localStorage", ...)` pattern (matches `src/app/(dashboard)/allocations/lib/scenario-state.localStorage.test.ts`).
- **Files modified:** `src/lib/discovery-prefs.test.ts`
- **Commit:** `48ce8ec` (rolled into Task 2 GREEN commit since the test file itself is RED-then-GREEN within the TDD cycle, and the mock pattern is purely test-infrastructure not a behavioral change).

### Auth gates encountered

None.

### Out-of-scope discoveries

**1. Pre-existing TS2578 in `src/app/api/watchlist/[strategyId]/route.test.ts:128`** — unused `@ts-expect-error` directive in a Plan 13-01 test file. Pre-existed on commit `48ce8ec` (verified via `git stash`). Logged to `.planning/phases/13-discovery-v2-polish/deferred-items.md`. `npm test` and `npm run build` are unaffected; only a strict `tsc --noEmit` flags it.

## DEFAULT_CUSTOMIZE disposition

**Removed entirely.** Pre-deletion grep:

```
$ grep -rn "DEFAULT_CUSTOMIZE\|CustomizeSettings" src/
src/components/strategy/StrategyFilters.tsx
```

Only the source file itself referenced these symbols — zero non-test importers. The new source of truth is `DEFAULTS` in `src/lib/discovery-prefs.ts`, which fixes the legacy DISCO-05 bug (`hideExamples: false` → `hide_examples: true`).

## E2E cross-account spec status

**Spec authored, currently `test.skip` due to env wiring.** Per TODOS.md Q4 (RESOLVED 2026-04-28 post-rebase):

- `E2E_USER_A_EMAIL` / `E2E_USER_A_PASSWORD` / `E2E_USER_B_EMAIL` / `E2E_USER_B_PASSWORD` — NOT wired.
- `TEST_SUPABASE_URL` / `TEST_SUPABASE_SERVICE_ROLE_KEY` — NOT wired in this execution environment.

The spec auto-skips with a documented message. When either env-wiring lands (the seed-helper fallback `seedTestAllocator()` only requires `TEST_SUPABASE_*`), the spec will run automatically. **Threat-model T-13-02-01 verification is therefore deferred until env wiring lands** — the structural mitigation (per-uid key shape) is in place, the unit tests prove the contract, but the live cross-account proof awaits CI env vars.

## Open follow-ups for Plan 13-03

- The `Sparkline` color rule (DESIGN.md DIFF-05) is computed at the call site in `StrategyTable.tsx`. Plan 13-03 will wire the sign-driven color (`#1B6B5A` / `#DC2626` / `#94A3B8`) at the Sparkline call site for `sparkline_returns`. The drawdown sparkline at `StrategyTable.tsx:413-417` already passes `color="var(--color-negative)"` and is OUT of the DIFF-05 sign-driven rule per UI-SPEC.
- `StrategyTable.tsx` has gained surface area across Plans 13-01 and 13-02; Plan 13-03 should treat it as the same write target rather than spawning a new component.

## Self-Check: PASSED

Created files (verified via `[ -f path ]`):

- `src/lib/discovery-prefs.ts` — FOUND
- `src/lib/discovery-prefs.test.ts` — FOUND
- `src/components/strategy/CustomizeDrawer.tsx` — FOUND
- `src/components/strategy/CustomizeDrawer.test.tsx` — FOUND
- `e2e/discovery-prefs-isolation.spec.ts` — FOUND

Commits (verified via `git log`):

- `5089502` — Task 1 (Wave 0 RED tests) — FOUND
- `48ce8ec` — Task 2 (GREEN — hook + drawer) — FOUND
- `2cb7430` — Task 3 (StrategyFilters cog + StrategyTable hydration) — FOUND

Branch: `feature/v0.17-sprint-13` (unchanged).
Working tree: clean.
