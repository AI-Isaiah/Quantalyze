---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 02
subsystem: routing
tags: [next-config, redirects, route-contract, e2e, playwright]
requires: []
provides:
  - four permanent redirects() rules to /factsheet/<id> (D-03), origin carried as from/cat (D-01)
  - route-contract manifest rows for the four routes as class exception with redirectFrom
  - 196-KNIP-BASELINE.txt pre-phase reading (read by plan 14, extended by plan 21)
affects: [196-03, 196-14, 196-15, 196-17, 196-18, 196-21]
tech-stack:
  added: []
  patterns: [config-level 308 before the proxy, DB-free redirect with the destination deciding visibility]
key-files:
  created:
    - src/__tests__/strategy-route-redirects.test.ts
    - .planning/phases/196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it/196-KNIP-BASELINE.txt
  modified:
    - next.config.ts
    - src/lib/routing/route-contract-manifest.ts
    - e2e/route-redirects.spec.ts
    - e2e/mt5-badge.spec.ts
    - e2e/sfox-badge.spec.ts
    - e2e/composite-onboarding.spec.ts
    - e2e/sync-analytics-flow.spec.ts
    - e2e/axe-app-wide.spec.ts
    - .github/workflows/ci.yml
    - src/__tests__/e2e-seeded-hydration-guard.test.ts
    - src/__tests__/contracts/spec-disabling.invariant.test.ts
  deleted:
    - e2e/strategy-v2-axe.spec.ts
    - e2e/strategy-v2-chart-parity.spec.ts
    - e2e/strategy-v2-keyboard.spec.ts
    - e2e/strategy-v2-partial-data.spec.ts
decisions:
  - "Redirects live in next.config.ts redirects() (runs before the proxy), not in the proxy; PUBLIC_ROUTES untouched"
  - "The composite not-published absence check signs out first, because the factsheet owner lane shows an owner their own draft"
metrics:
  duration: "~25 min"
  completed: 2026-11-09
status: complete
actuals:
  tokens: 14400
  tasks: 2
  commits: 2
plan_head_before: 49566dbc00a314300b862d8b1d4b44120c4ed3d7
plan_head_after: d12ded09c280241a23b0100d93322fb80d1f3333
---

# Phase 196 Plan 02: Retire the four strategy detail routes into 308s to the factsheet Summary

`/strategy/:id`, `/strategy/:id/v2`, `/browse/:slug/:strategyId` and `/discovery/:slug/:strategyId` are now DB-free, unconditional config-level 308s to `/factsheet/<id>`; the browse and discovery ones carry `from` and `cat`, and the request's own query passes through. The manifest moved in lockstep, and every e2e spec that visited a retired route now exercises the factsheet.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | `fe8592fde` | four redirects() rules, four manifest rows, unit test, e2e first-hop canary, pre-phase knip reading |
| 2 | `d12ded09c` | e2e specs retargeted, four strategy-v2 specs deleted, ci.yml list, two pins that followed the deletion |

## Verification

- `npx vitest run src/__tests__/strategy-route-redirects.test.ts src/__tests__/legacy-host-redirect.test.ts src/__tests__/check-route-contract.test.ts`: 3 files, 34 tests passed.
- `npm run check:route-contract`: `OK — 52 page routes, all declared in the manifest.`
- `npx playwright test --list e2e/route-redirects.spec.ts`: 13 tests, 4 under "Phase 196 ONESTRATEGYPAGE (D-03)".
- `npx playwright test --list` over the five retargeted specs: 62 tests, 0 `Error:`.
- `npx vitest run src/__tests__/contracts`: 11 files, 374 tests passed. Wider set (`src/__tests__`, 193 files): the only two reds were the two described under Deviations, both fixed; one other red, `verify-plan-anchors --pending`, is not caused by this plan (see Issues).
- `npx tsc --noEmit`: clean. ESLint on the changed e2e and test files: clean.

### Grep gates (HEAD base `49566dbc0` vs after)

| Gate | HEAD | After |
|------|------|-------|
| `source: "/discovery/:slug/:strategyId"` in next.config.ts | 0 | 1 |
| `source: "/browse/:slug/:strategyId"` | 0 | 1 |
| `source: "/strategy/:id/v2"` | 0 | 1 |
| `source: "/strategy/:id"` | 0 | 1 |
| `redirectFrom` rows in the manifest (each of the four) | 0 | 1 each |
| `NEVER MOVE` in the manifest | 4 | 3 (the `/strategy/:id` row's phrase went) |
| `"/strategy"` in src/proxy.ts | unchanged | unchanged (PUBLIC_ROUTES untouched) |
| `## pre-phase` in 196-KNIP-BASELINE.txt | file absent | 1 |
| `/strategy/${` in mt5-badge, sfox-badge, composite-onboarding, axe-app-wide (and sync-analytics-flow) | >0 | 0 each |
| `strategy-v2-` in ci.yml | 6 | 2 (four list lines gone; the two left are lineage comments) |
| `e2e/strategy-v2-*.spec.ts` on disk | 4 | 0 |

### Neuter / RED evidence (Task 1)

Backed up `next.config.ts` with `cp -p`, deleted the `/discovery/:slug/:strategyId` rule, ran both gates:

- `strategy-route-redirects.test.ts`: RED, 3 failed / 11 passed, naming `/discovery/:slug/:strategyId` (`redirects() must carry exactly one "/discovery/:slug/:strategyId" rule: expected [] to have a length of 1`, the live-rule check, and the origin-carrying check).
- `npm run check:route-contract`: RED, `MISSING-REDIRECT: route /discovery/:slug/:strategyId declares redirectFrom /discovery/:slug/:strategyId but next.config.ts redirects() has no matching source`.

Restored with `cp -p`; `cmp` exited 0; unit test 14/14 and `check:route-contract` OK again.

### Destination-query interpolation (flagged assumption A4)

The e2e canary needs a running server and is read from CI (not run here). The mechanism was measured locally with Next's own `getPathMatch` and `prepareDestination` for the discovery rule and request `/discovery/crypto-sma/x?share=1`: the destination path resolves to `/factsheet/x` and the destination query to `{ share: '1', from: 'discovery', cat: 'crypto-sma' }`. So the three keys the canary asserts are produced by Next's own code path. The live 308 status and header are NOT measured here.

### sfox anti-mask guard (ci.yml "Guard -- sfox-badge anti-mask assertions present"), re-run locally against the edited spec

| Anchor | Count | Minimum |
|--------|-------|---------|
| `anon: a logged-out visitor sees the api_verified badge` | 1 | 1 |
| `admin: an elevated session reads the sfox strategy` | 1 | 1 |
| `results.violations).toEqual([])` | 1 | 1 |
| `data-trust-tier="api_verified"` | 3 | 1 |
| `expect(apiVerifiedBadge(page).first()).toBeVisible` | 4 | 4 |
| unconditional skip/fixme/only | none | none |

mt5-badge (no CI guard of its own) also keeps 4 badge-visibility assertions.

### Pre-phase knip reading

`npx knip --include files,exports --reporter compact` at the phase base, before any edit, exit 1 (findings present, as at HEAD): 45 unused-file entries (25 outside `.planning/`, 20 archived-milestone scripts omitted from the file) and 70 unused-export lines. Recorded under `## pre-phase` in `196-KNIP-BASELINE.txt` as repo-relative paths and export names only. Plan 21 owns the file's final content.

## What each e2e spec became

| Spec | Change | Why |
|------|--------|-----|
| `route-redirects.spec.ts` | new Phase 196 describe: discovery (with `?share=1`) asserts 308, `/factsheet/x`, `from=discovery`, `cat=crypto-sma`, `share=1`, no `/login`; browse asserts `from=browse`, `cat`; `/strategy/x` and `/strategy/x/v2` assert 308 to `/factsheet/x` | first-hop canary, chain not followed |
| `mt5-badge.spec.ts`, `sfox-badge.spec.ts` | owner, admin, anon legs go to `/factsheet/<id>`; the allocator leg still opens `/browse/crypto-sma/<id>`, asserts it lands on `/factsheet/<id>`, then asserts the same `api_verified` badge | the factsheet masthead renders `TrustTierLabel` (`data-trust-tier="api_verified"`, `FactsheetView.tsx:1292`), so the badge surface is not lost |
| `composite-onboarding.spec.ts` | control and absence legs target `/factsheet/<id>`; both run after `page.context().clearCookies()`; status-code note rewritten | see Deviations 1 |
| `sync-analytics-flow.spec.ts` | `goToAnalyticsPage` goes to `/factsheet/<id>?from=discovery&cat=<slug>`; tab/accordion tests with no factsheet counterpart replaced by tests on the sections the factsheet really has; the anonymous login-bounce test now asserts the old URL reaches `/factsheet/...` and not `/login` | see Deviations 2 |
| `axe-app-wide.spec.ts` | authed `/strategy/[id]/v2` row retargeted to `/factsheet/<id>`, same strict all-impact gate, readiness anchor `#factsheet-main` | D-03 |
| four `strategy-v2-*` specs | deleted, plus their four ci.yml seeded-list lines | see below |

**Why the four strategy-v2 specs go in this plan and not with the shell in plan 14 (wave 6):** each drives `/strategy/<id>/v2` in a browser, and Task 1's 308 sends that URL to the factsheet from this plan on, so they can no longer reach `StrategyV2Shell` and would only go red against the redirect for waves 2 to 5. Nothing is lost: the shell renders nowhere a browser can reach, D-06 drops its two panels, and the shell's own unit and visual tests (`src/components/strategy-v2/*.test.tsx`, `tests/visual/strategy-v2-*`) keep covering the component until plan 14 deletes it. Two of the four (`keyboard`, `chart-parity`) were already unconditional skips (listed in the spec-disabling exemption ledger), so the deletion removes no running coverage from CI for those two.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] composite-onboarding absence check would have asserted the wrong thing signed in**
- **Found during:** Task 2
- **Issue:** the logged-in allocator OWNS the failed (draft) composite. The old `/strategy/[id]` lookup was owner-agnostic, but the factsheet owner lane deliberately shows an owner their own unpublished strategy (ROUTE-02), so "the not-found page is shown" is false for the owner and the test would go red (or pass for the wrong reason).
- **Fix:** both the published control and the failed-composite absence check now run signed out (`page.context().clearCookies()`), which is what "publicly discoverable" means. The `Page not found` heading assertion is kept: `/factsheet/[id]` has no segment-level `not-found.tsx` (the factsheet not-found sits under `v2/`), so root `not-found.tsx` renders. The HTTP status of that response is not asserted and was not measured.
- **Files:** `e2e/composite-onboarding.spec.ts`; **Commit:** `d12ded09c`

**2. [Rule 1 - Bug] sync-analytics-flow carried assertions about UI the factsheet does not have, plus a login-bounce test the redirect makes false**
- **Found during:** Task 2
- **Issue:** the env-gated "Analytics display" describe asserted tabs "Overview/Returns/Risk", an accordion "Main Metrics" and "Risk of Ruin", and `svg.recharts-surface`; none exist on the factsheet. The un-gated test `analytics detail page redirects unauthenticated users to login` would now fail in CI, because `/discovery/crypto-sma/some-strategy-id` 308s to `/factsheet/some-strategy-id` before the proxy (the exact #512 shape for this URL).
- **Fix:** the metric tests keep their intent against factsheet labels read from source (`CAGR`, `Sharpe`, `Max Drawdown`, `Ann. Volatility`, `Sortino`, `Calmar`, sections `#factsheet-perf`, `#factsheet-dist`, `#factsheet-heatmaps`, `Monthly Returns`); the tab tests and the "factsheet link" test (the page IS the factsheet now) are replaced by a test that the old discovery URL lands on the factsheet with `from=discovery` and `cat`; the anon test asserts `/factsheet/some-strategy-id` and not `/login`. NOT measured: the env-gated factsheet assertions cannot run without `PLAYWRIGHT_TEST_STRATEGY_ID` and a seeded database, so their selectors are source-derived. The "Back to Discovery" label is left to the viewer-bar plan (the back link does not exist yet).
- **Files:** `e2e/sync-analytics-flow.spec.ts`; **Commit:** `d12ded09c`

**3. [Rule 3 - Blocking] two pins in files outside `files_modified` followed the spec deletion**
- **Found during:** Task 2 full `src/__tests__` run
- **Issue:** `src/__tests__/e2e-seeded-hydration-guard.test.ts` pins the seeded list at exactly 27 distinct specs (now 23), and `src/__tests__/contracts/spec-disabling.invariant.test.ts` carried exemption entries (pinned length 3) for the two deleted skipped specs.
- **Fix:** `SEEDED_SPEC_COUNT` 27 to 23 with a dated lineage line; exemption ledger 3 to 1 (two entries removed, pin changed to 1, dated note). The ledger's scan of every remaining file is unchanged.
- **Files:** the two test files above; **Commit:** `d12ded09c`

**4. [Rule 2 - stale comment] ci.yml comment said "do NOT remove" the dead chart-parity spec**
- Added a dated note above it saying the four specs are deleted and the paragraph is lineage; the two remaining `strategy-v2-` mentions in ci.yml are those lineage comments.

## Issues / not caused by this plan

- `src/__tests__/verify-plan-anchors.test.ts` "`--pending` ... exits 0 on the real tree" is red in this worktree. The verifier reports only `[context-ref-missing]` rows: sibling plans reference `196-0N-SUMMARY.md` files that do not exist yet because the wave is still running. No row concerns this plan's edits. It should clear as the wave's SUMMARYs land; it is not an e2e or routing defect.
- `e2e/strategy-detail-tabs.spec.ts` (five-tab PerformanceReport that no route renders, not in any CI e2e list) left untouched, recorded as stale per the plan (surgical).
- NOT measured (no PROD or live-server access in this plan): the live 308 status and Location header, the browser-cached-308 behaviour, and the seeded e2e runs. Read them from the CI run bound to the head SHA.

## Threat Flags

None. No new endpoint, auth path or schema; the redirects are DB-free and unconditional (T-196-03, asserted by the unit test: no `has` or `missing`), `cat=<slug>` is a destination string only (T-196-04; `parseOrigin` validation belongs to plan 03).

## Known Stubs

None.

## Self-Check: PASSED

- Created files present: `src/__tests__/strategy-route-redirects.test.ts`, `196-KNIP-BASELINE.txt`, this SUMMARY.
- Commits present on the branch: `fe8592fde`, `d12ded09c`.
- Four deleted specs absent from disk and from ci.yml.
- STATE.md and ROADMAP.md not modified.
