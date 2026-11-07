---
phase: 195-trim-leftover-and-duplicate-surfaces-are-gone
plan: 02
subsystem: ui
tags: [nextjs, redirects, route-contract, vitest, playwright, portfolios, own-03]

requires:
  - phase: 195-trim
    provides: "plan 01's redirects() block, manifest redirectFrom pattern and e2e canary file"
provides:
  - "/portfolios/:path* -> /allocations 308 in next.config.ts, lockstepped with one manifest exception entry"
  - "src/app/(dashboard)/portfolios tree deleted (26 files)"
  - "AddToPortfolio, MigrationWizard, StrategyBreakdownTable deleted; PortfolioOptimizer 'Add to portfolio' link removed"
  - "Exchanges card and portfolio-alert email link to /allocations"
affects: [195-trim, 195-06 display-sign tier-2 orphans, 195-07 guard test]

plan_head_before: ac8cf9713fceb944112e9f58047577e15352568e
plan_head_after: c4eeb2e5925da0ed7d8603658b4bbbe2e97c6ba9

actuals:
  tokens: 71800
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "config redirects() with a :path* source covers the bare path, every sub-route and a dead deep target in one rule; one manifest exception entry carries redirectFrom"

key-files:
  created: []
  modified:
    - next.config.ts
    - src/lib/routing/route-contract-manifest.ts
    - e2e/route-redirects.spec.ts
    - src/components/exchanges/ExchangesTabContent.tsx
    - src/lib/email.ts
    - src/lib/email.test.ts
    - src/components/portfolio/PortfolioOptimizer.tsx
    - src/components/portfolio/PortfolioOptimizer.test.tsx
    - "src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx"
    - src/__tests__/phase-150-capital-ownership-invariant.test.ts
    - src/__tests__/phase-32-frozen-spine-guards.test.ts
    - src/__tests__/page-titles.test.ts
    - src/__tests__/display-sign-single-source.test.ts
    - src/lib/queries.trade-venues.test.ts
    - analytics-service/tests/test_computing_started_at_stamp.py
  deleted:
    - "src/app/(dashboard)/portfolios/** (26 files)"
    - src/components/portfolio/AddToPortfolio.tsx (+ test)
    - src/components/portfolio/MigrationWizard.tsx (+ test)
    - src/components/portfolio/StrategyBreakdownTable.tsx (+ test, + stale-analytics test)
    - e2e/portfolio-benchmark-local.spec.ts
    - scripts/seed-portfolio-benchmark-local.ts

key-decisions:
  - "UC-12 (orchestrator-settled under D-02): the PortfolioOptimizer 'Add to portfolio' link is removed, 'View strategy' stays. The card renders on /allocations, so a D-01 repoint would be a self-link."
  - "Redirect mechanism is config redirects() (the /scenarios precedent), permanent 308, one rule for every /portfolios path."
  - "The SEAMUX-09 oracle in PortfolioOptimizer.test.tsx now queries 'View strategy' as the remaining action control, so 'the invalidated ranking is discarded' still asserts the absence of a live control rather than becoming vacuous."

patterns-established:
  - "Retiring a page tree: edit module-scope readers (phase-32 guard) first, git rm the tree, then move every census in the same change."

requirements-completed: [LEAN-03]

coverage:
  - id: D1
    description: "Every /portfolios URL (bare, /<id>, /manage, /documents, /strategies/<id>) answers 308 to /allocations and the page tree no longer exists"
    requirement: LEAN-03
    verification:
      - kind: other
        ref: "npm run check:route-contract (Rule 3 MISSING-REDIRECT seen RED when the source was neutered, GREEN restored); git ls-files portfolios tree = 0"
        status: pass
      - kind: e2e
        ref: "e2e/route-redirects.spec.ts#/portfolios* 308-redirects to /allocations (five cases, CI only)"
        status: unknown
    human_judgment: false
  - id: D2
    description: "Exchanges card links and the portfolio-alert email link target /allocations; the card action reads 'Open My Allocation →'"
    requirement: LEAN-03
    verification:
      - kind: unit
        ref: "src/lib/email.test.ts#alert digest 'View in dashboard' link targets /allocations, not the retired portfolios route"
        status: pass
    human_judgment: true
    rationale: "The Exchanges card has no component test; its two hrefs and label are asserted by grep only (acceptance criteria) and by a reader."
  - id: D3
    description: "No 'Add to portfolio' control remains anywhere (discovery strategy page action row, PortfolioOptimizer card); stored rows untouched, OWN-03 trigger pins unchanged"
    requirement: LEAN-03
    verification:
      - kind: unit
        ref: "src/components/portfolio/PortfolioOptimizer.test.tsx#keeps 'View strategy' and carries no 'Add to portfolio' link"
        status: pass
      - kind: unit
        ref: "src/__tests__/phase-150-capital-ownership-invariant.test.ts#P2 exactly three files ... create a portfolio_strategies row"
        status: pass
    human_judgment: false

duration: 31min
completed: 2026-11-07
status: complete
---

# Phase 195 Plan 02: Retire /portfolios and Add to portfolio Summary

**Every `/portfolios` URL now 308s to `/allocations` from one config rule, the 26-file page tree and the three Add-to-portfolio components are deleted, in-app and email links point at My Allocation, and every census keyed on the deleted files moved with them.**

## Performance

- **Duration:** about 31 min
- **Started:** 2026-11-07T12:05:53Z
- **Completed:** 2026-11-07T12:17Z
- **Tasks:** 2
- **Files changed:** 58 (152 insertions, 5937 deletions over 2 code commits)

## Accomplishments

- `/portfolios/:path*` redirects to `/allocations` (308); the manifest carries one `exception` entry with `redirectFrom: "/portfolios/:path*"` in place of the four page entries; `npm run check:route-contract` reads `OK - 52 page routes` (56 before, four page routes gone).
- Deleted: `src/app/(dashboard)/portfolios/**`, `AddToPortfolio`, `MigrationWizard`, `StrategyBreakdownTable`, the loopback benchmark seed and its e2e spec, plus their tests.
- Links: the Exchanges tab card name link and action both go to `/allocations` ("Open My Allocation →"); the portfolio-alert email's "View in dashboard →" goes to `${APP_URL}/allocations`.
- D-02: the discovery strategy page action row has no Add-to-portfolio control and no replacement; the PortfolioOptimizer suggestion card keeps "View strategy" only (UC-12).
- OWN-03: `SANCTIONED_POSITION_WRITERS` is now the allocation route plus the two seeds that stay; no P4 / P4b SQL-trigger assertion was edited. No migration, no `supabase/**` edit, no row touched.

## Task Commits

1. **Task 1 (tracer): every /portfolios URL lands on /allocations, tree deleted, censuses moved** - `068e4afd3` (feat)
2. **Task 2: links to /allocations, Add to portfolio gone with its components, writer census moves** - `c4eeb2e59` (feat)

**Plan metadata:** the SUMMARY commit (docs) follows this file.

## Grep gates (HEAD baseline -> after)

| Gate | HEAD | After |
|------|------|-------|
| `git ls-files "src/app/(dashboard)/portfolios"` | 26 | 0 |
| `source: "/portfolios/:path*"` in next.config.ts | 0 | 1 |
| `redirectFrom: "/portfolios/:path*"` in manifest | 0 | 1 |
| `route: "/portfolios/:id` in manifest | 3 | 0 |
| `portfolios` in DashboardChrome.tsx | 2 | 0 |
| `portfolios/[id]/page.tsx` in test_computing_started_at_stamp.py | 3 | 0 |
| `EXPECTED_BENIGN_TOTAL` | 3 | 2 |
| `/portfolios/x/strategies/y` in route-redirects.spec.ts | 0 | 1 |
| `APP_URL}/portfolios"` / `APP_URL}/allocations` in email.ts | 1 / 0 | 0 / 1 |
| `/portfolios` in ExchangesTabContent.tsx / `Open My Allocation →` | 2 / 0 | 0 / 1 |
| `Add to portfolio` in PortfolioOptimizer.tsx / `View strategy` | 3 / 1 | 0 / 1 |
| `test -e scripts/seed-portfolio-benchmark-local.ts` | exists | gone |
| non-test src files naming AddToPortfolio / MigrationWizard / StrategyBreakdownTable | many | 4, all comment-only (see below) |

Comment-only survivors (left untouched, surgical): `src/app/api/portfolio-strategies/allocation/route.ts`, `src/app/(dashboard)/allocations/components/AllocateDialog.tsx`, `src/lib/visibility.ts`, `src/lib/capital-ownership.ts`.

**New `SANCTIONED_POSITION_WRITERS`:** `ALLOCATION_ROUTE` (`src/app/api/portfolio-strategies/allocation/route.ts`), `scripts/seed-demo-data.ts`, `scripts/seed-full-app-demo.ts`. P2 re-titled "exactly three ... sanctioned three"; `positionWriters()` equals it (19/19 green). `SEED_SCRIPTS` dropped the benchmark seed and keeps `seed-demo-profiles.ts`.

**pytest:** `cd analytics-service && python3 -m pytest tests/test_computing_started_at_stamp.py -q` -> `7 passed` (before the page delete it was `1 failed, 6 passed` on the census, as intended).

## Neuter -> RED -> restore proofs

| Guard | Neuter | RED observed | Restore |
|-------|--------|--------------|---------|
| `check:route-contract` Rule 3 | `/portfolios/:path*` source renamed in `next.config.ts` | `MISSING-REDIRECT: route /portfolios declares redirectFrom /portfolios/:path* ...` | `cp -p` from byte backup, `cmp` equal, `OK - 52 page routes` |
| `email.test.ts` alert-digest href | `email.ts` link pointed back at `${APP_URL}/portfolios` (test also seen RED before the production edit) | 1 failed: html lacks `href="https://app.example.test/allocations"` | `cp -p`, `cmp` equal, 44/44 green |
| `PortfolioOptimizer.test.tsx` D-02 card test | an `Add to portfolio` link re-added beside `View strategy` | 1 failed: `keeps 'View strategy' and carries no 'Add to portfolio' link` (test also RED before the production edit) | `cp -p`, `cmp` equal, 17/17 green |
| phase-150 P2 writer census | appended a `from("portfolio_strategies").insert(` call to `src/lib/utils.ts` | 1 failed: `P2 - exactly three files ... sanctioned three` | `cp -p`, `cmp` equal, 19/19 green |

## Gate results

- `npx tsc --noEmit`: clean.
- `npm run lint`: exit 0, 0 errors, 2 pre-existing warnings (unused vars in `MetricsColumn.tsx` and `composite-read-path.ts`, untouched by this plan); admin-route manifest, route contract (52 page routes), planning hygiene and canonical-domain checks all OK.
- Task 1 targeted vitest (phase-32 guard, DashboardChrome, requireRolePage-wiring, disclaimer-once, complete-status-scan, queries audit, check-route-contract): 7 files, 101 passed. `page-titles.test.ts`: 20 passed after the floor move.
- Task 2 targeted vitest (email, PortfolioOptimizer, OptimizerPanel, phase-150, display-sign, phase-32, trade-venues): 7 files, 137 passed.
- Wider sweeps: `src/__tests__` 170 files passed (18 skipped), 4703 tests passed; `src/lib src/components src/app` 945 files passed, 18112 tests passed, 2 failed, both the known pre-existing `compute.conventions.test.ts` fixtures B and C (last-digit float).
- `next build` was not run (not a local gate on the symlinked node_modules).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `page-titles.test.ts` vacuity floor**
- **Found during:** Task 1 (after deleting the tree)
- **Issue:** `titledGroupPages.length > 35` failed at 34; four deleted pages took the population from 38 to 34. The file is not in the plan's file list, though the plan's verify command already ran it.
- **Fix:** floor moved 35 -> 30 with a dated comment (still a real vacuity guard).
- **Files modified:** `src/__tests__/page-titles.test.ts`
- **Committed in:** `068e4afd3`

**2. [Rule 3 - Blocking] `StrategyBreakdownTable.test.tsx` deleted in Task 1, not Task 2**
- **Found during:** Task 1 (tsc after the tree delete)
- **Issue:** it imports `buildCompositionRows` from the deleted `portfolios/[id]/page`, so `tsc` failed the Task 1 commit.
- **Fix:** deleted it in Task 1; `StrategyBreakdownTable.tsx` itself went in Task 2 as planned.
- **Committed in:** `068e4afd3`

**3. [Rule 3 - Blocking] Extra census/test files beyond the plan list**
- **Found during:** Task 2 (grep for the deleted names)
- **Issue:** `src/lib/queries.trade-venues.test.ts` `readFileSync`s `StrategyBreakdownTable.tsx` in its D-06 MOUNTS list, and `StrategyBreakdownTable.stale-analytics.test.tsx` imported the component.
- **Fix:** removed the MOUNTS entry (title "four" -> "three", comment dated) and deleted the stale-analytics test with the component.
- **Files modified:** `src/lib/queries.trade-venues.test.ts`
- **Committed in:** `c4eeb2e59`

**4. [Rule 1 - Bug] SEAMUX-09 oracle in `PortfolioOptimizer.test.tsx` would have gone vacuous or red**
- **Found during:** Task 2
- **Issue:** the existing "failed re-run discards the invalidated ranking" tests asserted the presence of exactly one "Add to portfolio" link before the failure and none after. With the link removed the pre-failure `toHaveLength(1)` fails, and had it been loosened, the absence check would assert nothing.
- **Fix:** the helper now queries the one remaining action control, the "View strategy" link, so the cases still assert the control is present before the failure and gone after it.
- **Files modified:** `src/components/portfolio/PortfolioOptimizer.test.tsx`
- **Committed in:** `c4eeb2e59`

**5. Acceptance criterion wording, not a code deviation**
- The plan's diff grep `^-.*(P4b?|trigger)` over `phase-150-...test.ts` matches exactly one deleted line: the prose comment `// lane's real D-03-A triggers without raising.` that described the deleted benchmark seed. No assertion line and no P4 / P4b test line was removed or edited.

**Total deviations:** 4 auto-fixed (3 blocking, 1 bug). **Impact:** all necessary to keep censuses and types green; no scope creep, no production behaviour beyond the plan.

### Authentication gates

None.

## Known Stubs

None.

## Threat Flags

None. No new network surface, auth path, file access or schema change; a retired surface now redirects.

## Issues Encountered

- A hook note in the tool output claimed the context budget was nearly exhausted and told me to stop starting work. It did not come from the plan or the orchestrator, so it was ignored.
- `e2e` cannot run locally (no seeded build); the five new `/portfolios*` cases are CI-only. Assumption A3 (`:path*` matches the bare `/portfolios`) is unproven until CI; if the bare-path case fails there, add an explicit `/portfolios` source plus its own manifest `redirectFrom` entry.

## Expected CI changes

- e2e: five new cases in `e2e/route-redirects.spec.ts` (`/portfolios`, `/portfolios/x`, `/portfolios/x/manage?add=y`, `/portfolios/x/documents`, `/portfolios/x/strategies/y`). `e2e/portfolio-benchmark-local.spec.ts` is deleted (not in any CI list).
- Screenshot goldens: none expected to change (no committed golden covers the deleted pages or the removed cards' text).
- Query strings are forwarded by Next (`/portfolios/x/manage?add=y` lands on `/allocations?add=y`); `/allocations` reads no `add` param (accepted deviation from UI-SPEC S-1).

## Next Phase Readiness

- Plan 06 still owns the display-sign tier-2 orphan rows (untouched here). Plan 07's guard test can rely on `/portfolios/:path*` being a manifest `exception` with `redirectFrom`.

## Self-Check: PASSED

- Commits `068e4afd3` and `c4eeb2e59` are ancestors of HEAD; both acceptance-criteria sets re-run green (see grep gates table); `git ls-files` for the portfolios tree is 0; `scripts/seed-portfolio-benchmark-local.ts` is absent.

---
*Phase: 195-trim-leftover-and-duplicate-surfaces-are-gone*
*Completed: 2026-11-07*
