---
phase: 199-managerhome-each-role-lands-on-its-own-page-and-a-manager-has
plan: 11
subsystem: ui
tags: [nav, sidebar, factsheet-origin, legacy-redirect-prep, golden-fixture, vitest]
requires:
  - phase: 199-10
    provides: "/strategies ranks every role's rows, so the one list can take the allocator's old entry"
  - phase: 199-09
    provides: "StrategiesSection origin prop (R-04), the emitter this plan folds"
provides:
  - "Sidebar and mobile drawer carry exactly one Strategies item (/strategies) per role; none links /my-strategies"
  - "FACTSHEET_ORIGINS has no my-strategies key; parseOrigin maps a legacy from=my-strategies to the strategies origin and never emits it"
  - "No production file links /my-strategies: HoldingsTable, the old page's section origin prop and both wizard steps now point at /strategies"
affects: [199-13, 199-12]
actuals:
  tokens: 44000
  tasks: 2
  commits: 2
plan_head_before: f973e5aef2821af459e06a73f0845495634f6553
plan_head_after: 9c78c707ef4f841c42317dc92718080bb9f0605a
status: complete
tech-stack:
  added: []
  patterns:
    - "Legacy URL values are READ through a closed own-property map and never emitted (FactsheetOriginKey excludes them)"
key-files:
  created: []
  modified:
    - src/components/layout/Sidebar.tsx
    - src/components/layout/Sidebar.test.tsx
    - src/components/layout/DashboardChrome.tsx
    - src/components/layout/DashboardChrome.test.tsx
    - src/lib/factsheet/origin.ts
    - src/lib/factsheet/origin.test.ts
    - "src/app/(dashboard)/allocations/components/HoldingsTable.tsx"
    - "src/app/(dashboard)/allocations/components/HoldingsTable.strategy-rows.test.tsx"
    - "src/app/(dashboard)/allocations/components/ContributionWizardOverlay.preselect.test.tsx"
    - "src/app/(dashboard)/my-strategies/page.tsx"
    - "src/app/(dashboard)/strategies/StrategiesSection.test.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/CsvSubmitStep.test.tsx"
    - "src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.own04-link.test.tsx"
    - src/components/strategy/StrategyTable.default-mounts.test.tsx
    - src/components/strategy/__fixtures__/strategy-table-owner-list-mounts.json
decisions:
  - "role=both gets its single Strategies entry from the allocator branch; the manager branch pushes only when the allocator workspace is not shown"
  - "The Strategies label keeps the bare text 'Strategies' for the allocator (the plan's per-role list), replacing 'My Strategies'"
metrics:
  tasks: 2
  commits: 2
---

# Phase 199 Plan 11: One Strategies nav entry, every old link on /strategies Summary

One Strategies entry per role in the rail and the drawer, and no production file, back-link origin or test golden still names `/my-strategies`, cleared while the old page still renders so every commit stays green ahead of plan 13's 308.

## What was built

**Task 1 (tracer), commit 176fd744d.** `buildNavSections` now pushes `Strategies` (`/strategies`, BarChartIcon) in the allocator branch where `My Strategies` stood (order: My allocation, Recommendations, Compare, Strategies, Add a Strategy) and in the manager branch only when `!showsAllocatorWorkspace`, so manager shows one, allocator one, `both` one, and an admin-only account none. `buildPrimaryMobileNav` was not touched (OQ-5: allocator-only bottom bar unchanged, manager and both keep Strategies; `MobileNav.test.tsx` passes unchanged). `isWide` lost the `my-strategies` alternative; `/strategies` stays fluid through its exact-match arm. Sidebar tests: the three my-strategies tests became a per-role matrix over both variants (`desktop` and `drawer`, same builder), plus link-not-button, allocator order and a `both` label check; five existing tests that asserted "no Strategies for an allocator" were updated to the new fact. DashboardChrome test: the `/my-strategies` widening row and its `/my-strategiesx` boundary row were removed, the no-px-cap row retargeted to `/strategies`, and the `my-strategies` SCANNED_TREES entry dropped (the sweep still walks every remaining tree).

**Task 2, commit 9c78c707e.** `FACTSHEET_ORIGINS` drops the key; a private `LEGACY_ORIGIN_KEYS` map (own-property lookup, same prototype-chain care as `isOriginKey`) lets `parseOrigin` read an old `from=my-strategies` as `{ key: "strategies" }` (Back to Strategies, `/strategies`) while `buildFactsheetHref` cannot emit it. Emitters moved to the strategies key: the old page's `StrategiesSection origin` prop (R-04), `SyncPreviewStep`, `CsvSubmitStep`; `HoldingsTable`'s link now has `href="/strategies"`. Tests moved with them (CSV echo href, both SyncPreviewStep href constants and the case title, the default-mounts owner mount, the owner-list golden).

## Verification

Commands run in the worktree, all from `plan_head_before` `f973e5aef` forward:

- `node scripts/verify-plan-anchors.mjs <plan>`: OK, 5 claims, no stale.
- Task 1: `npx vitest run src/components/layout/Sidebar.test.tsx src/components/layout/MobileNav.test.tsx src/components/layout/DashboardChrome.test.tsx src/__tests__/phase-32-frozen-spine-guards.test.ts`: 4 files, 137 passed. RED seen first (10 Sidebar failures) before the Sidebar change.
- Task 2: the plan's first `<automated>` vitest command, plus `ContributionWizardOverlay.preselect.test.tsx` and `src/app/(dashboard)/my-strategies`: 55 files, 1093 passed. RED seen first (3 origin.test failures) before the origin.ts change.
- Plan gate greps: `key: "my-strategies"` in src prints nothing; `from=my-strategies` in src prints only `origin.test.ts`'s legacy parse arm (title); production files with a double-quoted `/my-strategies` literal outside the route-contract manifest: 0 (HEAD was 2, 3 after rebase); old page carries `origin={{ key: "strategies" }}` once and the old key 0 times; `from=strategies` count in the default-mounts golden: 5.
- `npx tsc --noEmit -p .`: no output (clean), after the fold surfaced exactly the six emitters/tests listed above as type errors.
- Lint, run as its parts: `npx eslint --no-cache` on all touched `.ts`/`.tsx` files: clean; `tsx scripts/check-admin-route-manifest.ts`, `check-route-contract.ts`, `check-planning-hygiene.ts`, `check-canonical-domain.ts`: all exit 0. **Not run:** `npm run lint`'s full-tree `eslint --cache src/` (the shared node_modules cache symlink forbids it per the brief); touched files were linted scoped instead.
- Adjacent suites run for collateral: `src/__tests__/phase-149-my-strategies-parity.test.ts`, `phase-150-capital-ownership-invariant.test.ts`, `dashboard-disclaimer-once`, `trim-removed-surfaces`, `role-home-call-sites`, `one-strategy-page-links`, `src/lib/constants.test.ts`, `compare/loading.test.tsx`, `src/components/factsheet`, `src/app/factsheet`: all pass (129 files, 1768 tests in the factsheet sweep).
- Left to CI: nothing in `supabase/`, `analytics-service/` or SQL was touched, so no SQL gate, mypy or local-stack lane is affected. The full-tree eslint and the e2e lanes were not run locally. Known pre-existing failure `src/lib/factsheet/compute.conventions.test.ts` (2 frozen-snapshot cases) was not touched and not run.

gc-199-11-neuter: Sidebar.tsx on a byte copy, manager branch guard changed to `if (showsManagerWorkspace) {` so `both` pushes twice: 5 Sidebar tests went RED (both desktop and drawer `both` rows, the `both` label row, and the two older role=both rows); restored from the copy, `cmp` identical, 75/75 GREEN.

gc-199-11-neuter: origin.ts on a byte copy, `const from = isLegacyOriginKey(raw) ? LEGACY_ORIGIN_KEYS[raw] : raw;` replaced by `const from = raw;`: the legacy parse arm and the never-emitted arm went RED (2 failures); restored from the copy, `cmp` identical, 57/57 GREEN.

gc-199-11-gates: vitest=green tsc=clean lint=clean (lint = scoped eslint on touched files plus the four non-eslint lint scripts; the full-tree eslint step was not run, see above)

## Deviations from Plan

**1. [Rule 3 - Blocking] The default-mounts golden had already moved; the 5-href edit became a 9-href edit on the owner-list fixture.** Plan 10 (4c7928a12) had already changed `strategy-table-default-mounts.json`'s five owner-row hrefs to `?from=strategies` and renamed its entry `strategiesOwner`, so that file held 0 old values at start (the plan's baseline of 5 was stale). The remaining old hrefs lived in plan 07's `strategy-table-owner-list-mounts.json` (9: three mounts times three rows), pinned by the same test file's second block. I edited that fixture by hand (anchored on `href="/factsheet/<id>`, exactly 9 occurrences, asserted before writing), changed the block's `common.origin` to the strategies key, and added the dated NEXT SURGICAL EDIT paragraph naming Phase 199 plan 11 and the 9 occurrences (not the 5 the plan said). I also reworded the Phase 196 and Phase 199 plan 10 paragraphs' old-key mentions so the src-wide gate is exact. The default-mounts JSON did not change in this plan. Commit 9c78c707e.

**2. [Rule 3 - Blocking] Two more test files named the old key (the plan's own read_first re-measure instruction).** `StrategiesSection.test.tsx` (added by 199-09; its second arm now forwards `allocations` instead of the folded key, still proving the prop is forwarded and the prefs scope comes from it) and `ContributionWizardOverlay.preselect.test.tsx` (origin prop moved to `strategies`). Both would fail `tsc` and the src-wide gate otherwise. Commit 9c78c707e.

**3. Plan-ledger setup.** The `gsd-plan-head-before-199-11` ledger was written after the first commit rather than before it; its value is the verified fork point `f973e5aef` (`HEAD~1` of the first commit), so `commits: 2` is exact.

No auth gates, no checkpoints, no package installs.

## Known Stubs

None. (Scanned the modified source files: no hardcoded empties flowing to UI, no placeholder text added.)

## Threat Flags

None. `parseOrigin`'s only new input handling is the closed legacy map; T-199-16 is mitigated as planned: membership is own-property only (`__proto__`, `constructor`, `toString` and near-miss values `my-strategies `, `MY-STRATEGIES`, `my-strategies/x`, `my_strategies` all parse to no origin, pinned in `origin.test.ts`), hrefs still come from `FACTSHEET_ORIGINS`, and 196's adversarial arms stay green.

## Self-Check: PASSED

- Commits 176fd744d and 9c78c707e are on `worktree-agent-199-11` (`git merge-base --is-ancestor` checked).
- All 17 modified files exist; no untracked files remain in the worktree; backups removed from the scratchpad.
