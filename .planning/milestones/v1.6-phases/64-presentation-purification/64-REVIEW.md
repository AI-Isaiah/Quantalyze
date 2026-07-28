---
phase: 64-presentation-purification
reviewed: 2026-07-03T00:00:00Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/app/(dashboard)/allocations/components/KpiStrip.tsx
  - src/app/(dashboard)/allocations/components/KpiStrip.test.tsx
  - src/app/(dashboard)/allocations/components/KpiStrip.scenario.test.tsx
  - src/app/(dashboard)/allocations/components/KpiStrip.warmup.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/app/scenario-share/[token]/share-resolve.ts
  - src/app/scenario-share/[token]/share-resolve.test.ts
  - src/app/scenario-share/[token]/page.tsx
  - src/app/scenario-share/[token]/page.test.tsx
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: fixed
---

# Phase 64: Code Review Report

**Reviewed:** 2026-07-03
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Phase 64 is a small, surgical presentation change and it lands cleanly on the
correctness and security axes. I verified all six mandated focus areas
adversarially and found no BLOCKER-class defect. The only findings are stale
AUM references left in KpiStrip comments/docstrings after the dead-chain removal
— the code and imports themselves are fully purged, but three comments still
describe a cell that no longer exists.

Verification of the load-bearing invariants:

1. **PRESENT-02 / scenarioAum chain intact.** The `ScenarioComposer.tsx` diff is
   a single-line deletion (`aum={scenarioAum}` off the KpiStrip mount). The
   `scenarioAum` `useMemo` (:2731), the `scenarioAum<=0` commit-refusal guard
   (:2825/:2838), the `scenarioAum <= 0` disclosure (:3634), and the
   `ScenarioCommitDrawer` consumer (`scenarioAum={scenarioAum}` :4294) are all
   untouched. `ScenarioCommitDrawer` is unconditionally rendered (not behind a
   `{cond && ...}`), so the value chain to the commit boundary is preserved.

2. **Discriminator re-point stays falsifiable.** The legacy-v1 reset oracle now
   reads `vi.mocked(ScenarioCommitDrawer).mock.calls.at(-1)?.[0].scenarioAum`
   (drawer is mocked at test:127 and unconditionally rendered, so the mock fires
   on every render). It observes the **same** `scenarioAum` memo the KpiStrip
   `aum` prop used to carry — same oracle value (100_000 with BTC restored vs
   40k under the stale-adopt bug). Not weakened.

3. **`isMixed` cannot leak private data.** Computed server-side as
   `(draft.memberKeyIds ?? []).length > 0` — a pure boolean off already-decoded
   JSONB, no new RPC/SQL/query. Only destructured/consumed on the `kind:"ok"`
   branch; honest-absence and RPC-error branches return before it is read. The
   `strategies.length === 0` book-only guard (:224) guarantees the
   addedStrategies-non-empty half by construction. Pre-v4 (`memberKeyIds`
   undefined) → `?? []` → false → no caption. Confirmed by
   share-resolve.test.ts:643 and page.test.tsx:319.

4. **Verbatim copy.** `computed from this scenario&apos;s catalog strategies
   only` renders to the locked string; the `&apos;` entity resolves to `'`.
   Placed after `methodologyLine` inside `<header>`, `text-muted`, no `role`,
   testid `scenario-mixed-caption`. page.test.tsx:302-312 pins the entity-tolerant
   copy, the exact register class, and the absence of `role=`.

5. **No accessibility regression.** Strip: `@lg:grid-cols-4` with
   `role="group" aria-label="Portfolio KPIs"` preserved; 4 cells, container-query
   host intact. Share caption is static muted prose (no `role`, correct token) —
   no axe impact.

6. **No test-intent erosion.** The 37 mount cleanups only drop the removed `aum`
   prop. The shape test is *strengthened* (now counts `group.children` directly
   and asserts label order off each cell's label div, rather than the prior
   permissive `getAllByText`). Retired tests (WR-02 pair, M-0085 `$NaN`, f9 AUM
   warmup exemption) are replaced with negative pins proving no AUM cell and no
   `$`-formatted value render. `liveBaselineMetrics.aum` fixtures (test:443/:4932)
   are correctly retained — they feed `scenarioAum`, not KpiStrip props.

## Warnings

### WR-01: Top-of-file KpiStrip docstring still declares the removed AUM cell as the strip's shape

**File:** `src/app/(dashboard)/allocations/components/KpiStrip.tsx:10`
**Issue:** The header docstring reads
`Shape (left → right): AUM / YTD TWR / Sharpe / Max DD 12m / Avg |ρ|.` This is
now actively false — PRESENT-01 removed the AUM cell and the strip is 4-cell
return-form (`YTD TWR / Sharpe / Max DD 12m / Avg |ρ|`). Phase 64 mandated a
*complete* dead-chain removal; a future maintainer reading the module's primary
contract docstring will be told the strip leads with AUM. This is the most
misleading of the residual references because it purports to state the
component's canonical shape.
**Fix:**
```ts
 * Shape (left → right): YTD TWR / Sharpe / Max DD 12m / Avg |ρ|.
```
(Also drop the incidental `formatCurrency` mention on :22 — that import was
removed, so the "`formatCurrency` already renders `—`" clause no longer applies
to this component.)

## Info

### IN-01: Stale inline comment references AUM in the cell-map callback

**File:** `src/app/(dashboard)/allocations/components/KpiStrip.tsx:436-437`
**Issue:** The comment `Resolve scenario primary + delta for this cell when the
gate is open AND the cell has a metricKey (AUM has none → falls back to the live
path).` references the removed AUM cell. Every surviving cell now has a non-null
`metricKey`, so the `metricKey`-null fallback path it describes is unreachable
(the guards are kept only defensively, as documented at :121).
**Fix:** Reword to drop the AUM example, e.g. `... when the gate is open AND the
cell has a metricKey (kept as a defensive guard; every current cell has one).`

### IN-02: Comment reflow references retain "AUM" as prose landmarks

**File:** `src/app/(dashboard)/allocations/components/KpiStrip.tsx:121,295-296,326-327`
**Issue:** Several comments narrate the removal in AUM terms (`removed the only
metricKey:null cell, AUM`, `removed the AUM cell`, `the AUM warm-up exemption
param is gone`). These are historically accurate change-notes rather than false
claims, so they are low-priority — but they keep "AUM" grep-live in a module
that no longer renders it. Optional cleanup for a fully AUM-free presentation
layer; harmless if retained as provenance.
**Fix:** Optionally trim to the behavior statement without the AUM callout once
the change note is no longer needed for review context.

---

_Reviewed: 2026-07-03_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
