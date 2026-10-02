---
phase: 99-exposure-allocation-widgets
plan: 04
subsystem: allocations-dashboard
tags: [exposure, wiring, rsc, auth-boundary, error-propagation, additive]
requires:
  - "@/lib/portfolio-exposure (getLatestExposureSnapshot/getNetExposureSeries/getAllocationSeries)"
  - "widgets/positions/ExposureByClass, widgets/positions/NetExposureChart, widgets/allocation/AllocationOverTime (Plans 01-03)"
provides:
  - "ExposureSectionData type + EMPTY_EXPOSURE fixture (lib/exposure-props.ts)"
  - "Live Exposure section on the Holdings tab (PI-01/02/03)"
affects:
  - "src/app/(dashboard)/allocations/page.tsx"
  - "src/app/(dashboard)/allocations/AllocationsTabs.tsx"
  - "src/app/(dashboard)/allocations/HoldingsTabPanel.tsx"
tech-stack:
  added: []
  patterns:
    - "Promise.all in RSC for the 4 owner-scoped reads (payload + 3 exposure)"
    - "distinct serializable prop threaded through {...props} spread (not folded into polled payload)"
    - "read errors propagate to route error.tsx (no error-swallowing wrapper)"
key-files:
  created:
    - "src/app/(dashboard)/allocations/lib/exposure-props.ts"
    - "src/app/(dashboard)/allocations/HoldingsTabPanel.exposure.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/page.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.tsx"
    - "src/app/(dashboard)/allocations/HoldingsTabPanel.tsx"
    - "src/app/(dashboard)/allocations/HoldingsTabPanel.test.tsx"
    - "src/app/(dashboard)/allocations/HoldingsTabPanel.spot-derivative-split.test.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.test.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.onboarding.test.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.scenario-composer.test.tsx"
    - "src/app/(dashboard)/allocations/AllocationsTabs.scenario-state-preservation.test.tsx"
decisions:
  - "Added exposure={EMPTY_EXPOSURE} to shared test fixtures (STUB_PROPS/STUB_PAYLOAD/basePayload) rather than to every one of ~40 render call sites — the {...spread} forwards it; zero assertion changes, so the additive-section proof holds."
requirements: [PI-01, PI-02, PI-03]
metrics:
  duration: ~15m
  completed: 2026-07-12
  tasks_completed: 2
  tasks_total: 3
---

# Phase 99 Plan 04: Exposure Section Wiring Summary

Mounted the three Phase-99 widgets (ExposureByClass / NetExposureChart / AllocationOverTime) into the allocator Holdings tab: `page.tsx` reads all three via one `Promise.all` on the `auth.getUser()`-derived `user.id`, passes them as a distinct `exposure` prop through `AllocationsTabs` into `HoldingsTabPanel`, which renders a new "Exposure" section between Strategies and Exchange Positions. Read errors propagate to `error.tsx`; every pre-existing allocations test stays green with only the additive `EMPTY_EXPOSURE` fixture.

## What shipped

- **`lib/exposure-props.ts`** — `ExposureSectionData` (snapshot + netSeries + allocationSeries) and the shared `EMPTY_EXPOSURE` honest-empty fixture. Type-only re-exports, no `"use client"`.
- **`page.tsx`** — one `Promise.all([getMyAllocationDashboard, getLatestExposureSnapshot, getNetExposureSeries, getAllocationSeries])` all on `user.id`. `const exposure = { snapshot, netSeries, allocationSeries }` passed as `<AllocationsTabs {...payload} exposure={exposure} />`. No error-swallowing wrapper (reads throw to `error.tsx`). The onboarding-funnel `createAdminClient` block is byte-identical.
- **`AllocationsTabs.tsx`** — signature widened to `MyAllocationDashboardPayload & { exposure: ExposureSectionData }`; the existing `{...props}` spread forwards `exposure` to `HoldingsTabPanel`.
- **`HoldingsTabPanel.tsx`** — DIRECT imports of the three widgets (NOT the B7b-locked `widgets/index.ts` barrel). New `<section aria-label="Exposure">` with the "Exposure" heading (Exchange-Positions heading idiom) and a `grid-cols-1 lg:grid-cols-2` layout: ExposureByClass, NetExposureChart, and a `lg:col-span-2` AllocationOverTime — inserted between the Strategies table and the Exchange Positions section. Everything else byte-identical.
- **Six pre-existing test files** — added `exposure={EMPTY_EXPOSURE}` via the shared fixtures only.
- **`HoldingsTabPanel.exposure.test.tsx`** — 7 tests: placement/order, honest-empty trio (+ no svg), populated render (titles + as-of stamps), >1000-row-backed volume shape, and a 3-test trust-boundary source lock (no `createAdminClient`/`allocator_holdings` in the widget/chart-gaps surface; portfolio-exposure imports type-only; page.tsx names no table).

## Acceptance-criteria evidence

- Auth-id gate: `grep -c "getLatestExposureSnapshot(user.id)" page.tsx` = 1 (same for the other two); all three inside one `Promise.all`.
- Distinct-prop gate: `grep -c exposure src/lib/queries.ts` = 3, unchanged (queries.ts not modified) — reads NOT folded into the polled payload.
- Error propagation: `grep -cE "try|catch" page.tsx` = 0.
- No new secret surface: `grep -c allocator_holdings page.tsx` = 0; funnel `createAdminClient` block byte-identical.
- Barrel untouched: `widgets/index.ts` not in the diff.
- Additive: all 110 allocations test files / 1436 tests pass with only the added fixture prop (zero assertion changes).

## Verification

- `npx tsc --noEmit` — clean.
- `npx vitest run "src/app/(dashboard)/allocations" --no-file-parallelism` — 110 files / 1436 tests pass (includes the new 7-test file).
- `npx vitest run tests/visual/chart-accessibility-layer.test.ts tests/visual/recharts-touchtooltip-usage.test.ts` — 4 pass.
- `npm run lint` — 0 errors (1 pre-existing warning in untouched `EquityChart.tsx`, out of scope).
- `npm run build` — clean.

## Deviations from Plan

None — plan executed as written. (Fixture prop added at the shared-fixture level rather than per render call; this is the intended additive change, not a deviation from behavior.)

## Deferred human-verify checkpoints (Task 3 — OPEN, blocking gate)

These are HONEST open items — NOT fabricated as passed. Task 3 is a `checkpoint:human-verify gate="blocking"`; the automated preconditions (full allocations + widget suites, lint, tsc, `npm run build`) are all green, but the two live/visual sign-offs require a human and are handed to the orchestrator/ship:

1. **LIVE >1000-row large-allocator render (Phase-98 pagination carry-forward).** The `.range()`-paginated read is mock-proven at the render level (the 520pt×6-venue volume test), but the >1000-row LIVE database render is unverified. Steps: seed a >1000-row allocator on the TEST project (qmnijlgmdhviwzwfyzlc, `alloc@quantalyze.test`) — e.g. 6 venues × 4 symbols × 60 days ≈ 1440 rows — run locally against test, log in, open My Allocation → Holdings, and confirm PI-02/PI-03 series span the FULL seeded date range (a silently truncated read would end early with no gap marker). Never seed prod.
2. **Proportional hatched gap-band geometry design-review sign-off.** The proportional hatched gap BAND is a documented geometric adaptation of the factsheet's zero-width seam (calendar-linear axis vs index axis). Requires explicit acceptance or a `/design-review` route.

Resume signal: `approved` (optionally `approved, band adaptation accepted`) or a description of issues.

## Self-Check: PASSED

- `lib/exposure-props.ts` — FOUND
- `HoldingsTabPanel.exposure.test.tsx` — FOUND
- Commit 5ea3f09f (Task 1) — FOUND
- Commit ea22c251 (Task 2) — FOUND
