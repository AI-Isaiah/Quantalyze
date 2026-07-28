---
phase: 64
plan: 01
subsystem: allocations / scenario-tab presentation
tags: [PRESENT-01, PRESENT-02, kpi-strip, purification, no-invented-data]
requires:
  - Phase 63 series-space engines (composer computes scenarioMetrics/scenarioAum)
provides:
  - 4-cell return-form KpiStrip (no AUM cell, no `aum` prop on KpiStripProps)
  - "@lg:grid-cols-4" reflow (1-up / 2-up @sm / 4-up @lg)
affects:
  - src/app/(dashboard)/allocations/components/KpiStrip.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx (mount line only)
tech-stack:
  added: []
  patterns:
    - "Purification: dead required-API deleted entirely (aum prop), not optionalized"
    - "Reviewed-act test-mount trims + discriminator re-point (GUARD-02 discipline)"
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/components/KpiStrip.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/(dashboard)/allocations/components/KpiStrip.test.tsx
    - src/app/(dashboard)/allocations/components/KpiStrip.scenario.test.tsx
    - src/app/(dashboard)/allocations/components/KpiStrip.warmup.test.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
decisions:
  - "AUM `aum` prop DELETED ENTIRELY from KpiStripProps (orchestrator option a: purification phase; sole production mount verified) rather than made optional."
  - "PRESENT-02 lock realized at BLOCK level (commit-modal test bodies byte-unchanged) not whole-file zero-diff — the legacy-v1-draft :769-798 discriminator required a reviewed re-point."
  - "Legacy-v1-draft reset discriminator re-pointed off the removed KpiStrip.aum onto the SAME scenarioAum value at its surviving commit-boundary consumer (ScenarioCommitDrawer) — oracle value 100_000 unchanged (BTC restored)."
metrics:
  duration: ~11 min
  tasks: 3
  commits: 2
  files_modified: 6
  completed: 2026-07-03
---

# Phase 64 Plan 01: Presentation Purification — AUM out of the scenario KPI strip Summary

The scenario tab's KPI strip is now **return-form only** — 4 cells (YTD TWR ·
Sharpe · Max DD 12m · Avg |ρ|) reflowing 1-up / 2-up @sm / 4-up @lg — with the
AUM cell and its entire dead `aum` prop chain deleted, while `scenarioAum` and
its commit-diff-modal sizing consumers stay byte-for-byte untouched.

## What shipped

- **KpiStrip.tsx (516 lines, was 556):** deleted the AUM `cells[]` entry and the
  full dead chain it fed — the `aum` prop (removed from `KpiStripProps`, not
  optionalized), `aumValue`, `KpiStripAnalytics.total_aum`, `resolveSub`'s
  `isAum` warm-up-exemption param, the `aum` keys in `KPI_DIRECTION` /
  `KPI_NOISE_FLOOR`, both `key === "aum"` formatter branches
  (`formatSignedDelta` / `formatLiveValue`), the now-unused `formatCurrency`
  import, and the `label === "AUM" ? null : primaryRaw` render-loop ternary.
  Grid token `@lg:grid-cols-5` → `@lg:grid-cols-4`; the separate `@container`
  host (count 5, unchanged) and every cell's `font-mono … tabular-nums`
  (count 5, unchanged) preserved byte-for-byte (Phase-52 invariants).
- **ScenarioComposer.tsx:** single-line change — `aum={scenarioAum}` removed
  from the sole production `<KpiStrip>` mount (~:3533). `scenarioAum` count
  11 → 10 (only the strip ref gone); its `useMemo` computation, the
  `scenarioAum <= 0` disclosure, and the `ScenarioCommitDrawer scenarioAum=`
  commit-boundary consumer are byte-unchanged. `git diff` = exactly one hunk.
- **Tests:** all 37 surviving `aum={...}` mount props stripped across the three
  KpiStrip suites (reviewed dead-prop removals); shape tests re-pointed to the
  4-cell contract; the ScenarioComposer legacy-v1-draft discriminator re-pointed
  (details below).

## Tasks & commits

| Task | Name | Commit |
| ---- | ---- | ------ |
| 1 | RED — re-point KpiStrip shape tests to the 4-cell return-form contract | `629777eb` |
| 2 | GREEN — remove AUM cell, delete `aum` prop, `@lg:grid-cols-4`, clean all mounts | `710a6902` |
| 3 | PRESENT-02 block-level guard + golden/e2e sweep + GUARD-03 | (verification-only, no commit) |

## TDD gate compliance

- **RED (`629777eb`):** exactly 4 failures against the unmodified 5-cell
  component — the exactly-4-cells anchor + the live-mode no-AUM/no-dollar
  negative pin + the stale-count (5→4) re-point + the scenario-mode no-AUM
  negative pin. No other new failures (25 passed). RED ran PRE-deletion, so all
  mounts still passed `aum={...}` and tsc stayed green.
- **GREEN (`710a6902`):** 5 suites (KpiStrip ×3 + ScenarioComposer + .save) →
  213 passed; `tsc --noEmit` 0 errors; eslint 0 errors on all 6 touched files.

## Reviewed acts (each carries an inline `Phase 64 / PRESENT-01` rationale)

- **KpiStrip.test.tsx:** describe/file-header → 4-cell; "exactly 5 cells" test
  rewritten to count `group.children === 4` + ordered labels (the RED anchor);
  added a live-mode no-AUM/no-dollar negative pin; stale-count `5 → 4`;
  font-mono value test `≥5 → ≥4` and dropped `"$1.0M"` from the value list;
  RETIRED "M-0085 AUM $NaN → $NaN leak" and "AUM is exempt from warmup helper"
  (both premised on the now-gone AUM cell). The Sharpe/Avg|ρ| (formatNumber) and
  YTD/Max DD (formatPercent) NaN tests kept.
- **KpiStrip.scenario.test.tsx:** RETIRED the WR-02 pair (AUM projected-sum
  disclosure, live + scenario) → replaced with a scenario-mode no-AUM/no-dollar
  negative pin.
- **KpiStrip.warmup.test.tsx:** 7 `aum={...}` mounts removed; all warm-up
  assertions are `≥1`/`getByText` (no exact cell-count), so none needed
  re-computation after the cell removal.
- **ScenarioComposer.test.tsx (the ONLY edit — 2 hunks, both inside the
  :769-798 legacy-v1-draft test):** the reset discriminator, previously
  `expect(vi.mocked(KpiStrip).mock.calls.at(-1)?.[0]?.aum).toBe(100_000)`,
  re-pointed to read the SAME `scenarioAum` value off its surviving
  commit-boundary consumer:
  `expect(vi.mocked(ScenarioCommitDrawer).mock.calls.at(-1)?.[0]?.scenarioAum).toBe(100_000)`.
  Oracle value (100_000 = full 60+30+10k book, BTC restored) unchanged — the
  established mock-props pattern already used at :2456/:2491/:2529. Not a
  weakening: it observes the identical reset behavior (legacy v1 draft with BTC
  toggled off is dropped → fresh default includes BTC → full-portfolio AUM).

## Dead-chain deletions actually performed (each grep-gated, fail-loud)

| Item | Result |
| ---- | ------ |
| `label: "AUM"` cell object | deleted (grep exit 1) |
| `label === "AUM"` render ternary | deleted (grep exit 1) |
| `aum` prop on KpiStripProps | deleted entirely |
| `aumValue` local | deleted |
| `KpiStripAnalytics.total_aum` | deleted (sole reader was `aumValue`) |
| `resolveSub` `isAum` param | deleted; callers simplified to `(raw, defaultSub)` |
| `KPI_DIRECTION.aum` / `KPI_NOISE_FLOOR.aum` | deleted (no cell keyed metricKey "aum") |
| `formatSignedDelta` / `formatLiveValue` `key === "aum"` branches | deleted |
| `formatCurrency` import | deleted (last use was the AUM cell) |

Grep gates after GREEN: `grep -nw 'aum'` → none; `aumValue|total_aum|isAum` →
none; `@lg:grid-cols-4` = 1, `@lg:grid-cols-5` → none; `@container` = 5,
`tabular-nums` = 5 (both unchanged); test files `aum={` → 0/0/0.

## PRESENT-02 hunk-range audit (T-64-02 mitigation)

64-01's own change to ScenarioComposer.test.tsx (isolated vs the RED commit
`629777eb`, since the composer test was untouched before Task 2) is exactly
**two hunks**, both inside the legacy-v1-draft test:

```
@@ -763,8 +763,10 @@   (discriminator comment)
@@ -792,9 +794,13 @@   (the re-pointed assertion)
```

Both fall in old-file lines **763–801**. The commit-modal blocks — T_C_P1933
(:2016), NEW-C18-07 (:2740), NEW-C18-05 (:2775), IMP-3 (:2962), H-0133 (:3063) —
have **zero overlapping hunks**. All five pass verbatim (run by name:
`T_C_P1933` 1 pass; `NEW-C18-07|NEW-C18-05|IMP-3|H-0133` 5 pass incl. the
H-0133 regression twin). Note: the full `git diff` vs `merge-base origin/main`
(`e5e83247`) is contaminated by the unlanded Phases 62/63 test rebases on this
branch, so the meaningful per-plan audit is taken against the RED commit.

## Golden / e2e sweep (documented, not assumed)

- `grep -rn 'AUM' e2e/` (minus Binary) → **EMPTY**
- `grep -rln 'grid-cols-5' e2e/ src --include='*.test.*' --include='*.spec.ts'`
  → **EMPTY**

No golden/e2e snapshot pins the AUM KPI or the 5-col grid → **no re-bake needed.**

## Guard suites

- ScenarioComposer + `phase-52-container-tabular-nums` (KpiStrip ∈
  CONTAINER_MIGRATED) + `phase-63-series-space-guards`: 3 files / 200 passed.
- **GUARD-03:** `git diff` vs merge-base on `src/lib/scenario.ts` +
  `src/lib/scenario-window.ts` → empty (`GUARD-03-OK`).

## Deviations from Plan

None — plan executed exactly as written. The only judgement call already
sanctioned by the plan/critical-notes was the choice of re-point observable for
the :769-798 discriminator; `ScenarioCommitDrawer.scenarioAum` was chosen over a
DOM weight-row observable because holdings rows render read-only regardless of
the toggle, so only the AUM value faithfully distinguishes "BTC restored" from
"BTC stuck-excluded" — the same oracle, not a weakened one.

## Known Stubs

None. Nothing replaces the removed AUM slot (no-invented-data, per UI-SPEC
Contract A). Degenerate all-excluded → null KPIs → em-dash convention unchanged.

## Land-step note (NOT in these commits)

VERSION + package.json bump lands with the whole phase at /ship (all Phase-64
plans land together).

## Self-Check: PASSED

- FOUND: src/app/(dashboard)/allocations/components/KpiStrip.tsx
- FOUND: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
- FOUND commit: `629777eb` (RED)
- FOUND commit: `710a6902` (GREEN)
</content>
</invoke>
