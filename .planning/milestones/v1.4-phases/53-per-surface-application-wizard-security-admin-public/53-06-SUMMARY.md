---
phase: 53-per-surface-application-wizard-security-admin-public
plan: 06
subsystem: layout-shell + lint-config
tags: [fluid-fill, DashboardChrome, eslint-ratchet, no-raw-font-px, APPLY-04, BP-02]
requires:
  - "Plan 53-04 (components/portfolio + portfolios page tree migrated to fluid --text-* — 0 raw px)"
  - "Plan 53-05 (admin page tree + components/admin tables migrated to fluid --text-* — 0 raw px)"
  - "Plan 53-02 (strategies/new wizard already in the eslint error block)"
  - "Phase 49 fluid --text-* spine (text-micro tier)"
provides:
  - "admin + /portfolios (+ sub-paths) fluid-fill to max-w-[1920px] via the ONE DashboardChrome.isWide allow-list edit"
  - "admin + portfolios no-raw-font-px globs at eslint error (4 glob trees) — locked clean against regression"
  - "EmptyStateCard shared primitive migrated to text-micro (components/ui home stays clean)"
affects:
  - "src/components/layout/DashboardChrome.tsx (isWide allow-list)"
  - "src/components/layout/DashboardChrome.test.tsx (widened-route assertions)"
  - "eslint.config.mjs (error ratchet block)"
  - "src/components/ui/EmptyStateCard.tsx (single text-[11px] -> text-micro)"
tech-stack:
  added: []
  patterns:
    - "isWide regex allow-list selects max-w-[1920px] vs max-w-7xl on the content container (data/table surfaces only)"
    - "per-surface no-raw-font-px error ratchet (strangler) — flip a glob to error ONLY after it greps clean; repo-wide stays warn"
    - "injection-probe verification that an eslint ratchet glob is genuinely error-level (not silently warn)"
key-files:
  created: []
  modified:
    - "src/components/layout/DashboardChrome.tsx"
    - "src/components/layout/DashboardChrome.test.tsx"
    - "eslint.config.mjs"
    - "src/components/ui/EmptyStateCard.tsx"
decisions:
  - "EmptyStateCard shared-primitive boundary resolved via OPTION (a) — migrate the single text-[11px] site to text-micro and keep components/ui clean — chosen over option (b) glob-exclusion because it is a single clean site (same text-[10/11px]->micro mapping Plans 04/05 used), the only raw text-[Npx] in the file, and the primitive renders into both flipped surfaces (CorrelationHeatmap on portfolios + admin degenerate states); leaving it would be a latent shared-primitive inconsistency at the boundary"
  - "not-widened negative test case retargeted off /portfolios (now widened) onto /strategies — a genuine still-narrow form surface (the new-strategy wizard lives under it); the /discoveryx regex-boundary test kept green"
  - "the four glob trees flipped are admin/** + components/admin/** + portfolios/** + components/portfolio/** (components globs included because that is where Plans 04/05 actually migrated the px debt); repo-wide flip deliberately NOT done (Phase 54 BP-03)"
metrics:
  duration_min: 6
  completed: "2026-06-29"
  tasks: 2
  files: 4
  commits: 2
---

# Phase 53 Plan 06: Fluid-Fill Wiring (admin + /portfolios) + Admin/Portfolios eslint Ratchet Summary

The single consolidated wiring change for the two remaining data surfaces: raised admin + /portfolios to
fluid-fill ~1920px via the ONE `DashboardChrome.isWide` allow-list edit (the only mechanism that actually
fluid-fills past 1280 — a page-level `max-w-[1920px]` is otherwise clamped by the shell's `max-w-7xl`), and
ratcheted the admin + portfolios `no-raw-font-px` globs to `error` now that Plans 04/05 migrated their type.
Both `DashboardChrome` and `eslint.config.mjs` are owned by exactly this one plan (no same-wave conflict).

## What Was Built

### Task 1 — Fluid-fill admin + /portfolios via DashboardChrome.isWide (commit 9bb27632)

TDD RED -> GREEN on an existing well-tested component:

- **RED:** flipped `DashboardChrome.test.tsx` — `/portfolios` (and a new `/portfolios/abc/manage`) + `/admin`
  (and a new `/admin/compute-jobs`) now assert `max-w-[1920px]`; the not-widened negative case was retargeted
  off `/portfolios` onto a still-narrow `/strategies` (form surface). Confirmed exactly 4 new assertions failed
  against current source (16 prior still green).
- **GREEN:** added `admin|portfolios` to the `isWide` regex at `DashboardChrome.tsx:72`
  (`/^\/(allocations|compare|discovery|admin|portfolios)(\/|$)/`). The existing ternary at `:166-170` then takes
  `max-w-[1920px]` for those paths. Updated the `:64-71` comment (it previously stated the Phase-53 surfaces
  keep `max-w-7xl`).
- **Carve-out untouched (T-53-15):** the `isFullBleed` admin match-detail regex `/^\/admin\/match\/[^/]+\/?$/`
  (`:61-62`) takes a DIFFERENT branch (no centered container) — left byte-unchanged; acceptance grep confirms.

Result: 20/20 DashboardChrome tests green. Prose/form surfaces (wizard under `/strategies`, `/security`,
marketing, auth) stay narrow at `max-w-7xl`; the `/discoveryx` regex-boundary test stays green.

### Task 2 — Ratchet admin + portfolios no-raw-font-px globs to error (commit 29393c89)

- **EmptyStateCard boundary (option a):** migrated the single `text-[11px]` at
  `src/components/ui/EmptyStateCard.tsx:27` to `text-micro` (the defined fluid tier at `globals.css:143`,
  `clamp(0.625rem ... 0.6875rem)`) — the same `text-[10/11px]->micro` mapping Plans 04/05 used. It is the only
  raw `text-[Npx]` in the file, so `components/ui` stays clean. Rationale: the primitive renders into BOTH
  flipped surfaces (CorrelationHeatmap on /portfolios + admin degenerate states), so migrating removes the
  shared-primitive debt at the boundary rather than excluding it.
- **eslint error ratchet:** added the four grep-clean glob trees to the existing `error` block's `files:` array:
  `src/app/(dashboard)/admin/**`, `src/components/admin/**`, `src/app/(dashboard)/portfolios/**`,
  `src/components/portfolio/**`. Repo-wide `no-raw-font-px` stays `warn` (`eslint.config.mjs:82`); the repo-wide
  flip is explicitly deferred to Phase 54 BP-03 (T-53-16 — no premature whole-repo flip that would red-CI on
  orphan files).
- **Injection-probe verification:** temporarily injected `text-[13px]` into `components/admin/ComputeJobsTable.tsx`
  and confirmed eslint reported a real ERROR (1 problem, 1 error) — proving the ratchet is genuinely error-level
  on the new globs, not silently warn. File byte-restored and re-verified clean.

Result: `npm run lint` = 0 errors (263 repo-wide warns, all OUTSIDE this plan's scope), route-contract guard
(56 page routes) + admin-route-manifest (20 admin routes) green.

## Deviations from Plan

None — plan executed exactly as written. Both must-have decision points (EmptyStateCard boundary; not-widened
negative-case retarget) were resolved within the options the plan offered and are recorded under `decisions`.

## Authentication Gates

None.

## Known Stubs

None — both changes are layout-measure + lint-config edits with no data flow, no placeholder values.

## Threat Flags

None. No new endpoints, auth paths, input, or schema. The two threat-register mitigations were honored:
- **T-53-15** (Tampering — isFullBleed carve-out): the `isFullBleed` regex is byte-unchanged (acceptance gate),
  preserving the match-detail page's distinct branch.
- **T-53-16** (config integrity — eslint scope): globs flipped to `error` only after grep-clean + probe-verified;
  repo-wide stays `warn`.

## Verification Results

- `npx vitest run src/components/layout/DashboardChrome.test.tsx` — **20/20 green** (admin + /portfolios + their
  sub-paths widened; /strategies holds the narrow assertion; /discoveryx regex-boundary green).
- `grep -RnE "text-\[[0-9]+px\]"` over the four globs (excl comments) — **0**.
- `npm run lint` — **0 errors**, 263 repo-wide warns (all outside the flipped globs); route-contract +
  admin-route-manifest guards **OK**.
- Injection probe — `text-[13px]` in an admin file produced **1 eslint error** (ratchet is live), restored clean.
- `npx tsc --noEmit` — no errors in any touched file (DashboardChrome.tsx/.test.tsx, EmptyStateCard.tsx).
- `isFullBleed` carve-out regex — byte-unchanged (grep-confirmed at `:61`).
- EmptyStateCard consumers (CorrelationHeatmap + SampleFloorEmptyState) — **27/27 green** after the text-micro swap.

## TDD Gate Compliance

Task 1 (`tdd="true"`) followed RED -> GREEN with both committed together (the test + source co-commit is the
coverage-gate convention; the component is pre-existing and edited deliberately): the flipped widened-route
assertions were confirmed RED (4 failures) against current source before the `isWide` regex edit turned them
GREEN. Task 2 (`type="auto"`) is a lint-config + single-className change, guarded by the EmptyStateCard consumer
suite (27 tests) which stayed green.

## Commits

- `9bb27632` feat(53-06): fluid-fill admin + /portfolios via DashboardChrome.isWide (APPLY-04)
- `29393c89` feat(53-06): ratchet admin + portfolios no-raw-font-px globs to error (BP-02)

> Note: `.planning/**` is gitignored (the live ledger was untracked via PR #530 — local-only by
> design). This SUMMARY is written to disk; the two code commits above are the git deliverable.

## Self-Check: PASSED

- `53-06-SUMMARY.md` present on disk.
- Both task commits (`9bb27632`, `29393c89`) present in git history.
- `DashboardChrome.tsx` isWide carries `admin|portfolios`; `EmptyStateCard.tsx` carries `text-micro`;
  `eslint.config.mjs` carries the `components/portfolio/**` glob (+ the other three).
