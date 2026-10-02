---
phase: 41-constituent-correlation-diversification
plan: 02
subsystem: allocations-scenario-composer
tags: [diversification, correlation, heatmap, choueifaty, pcr, enb, clustering, collapsible-section, ui]
requires:
  - "src/lib/diversification.ts (Plan 41-01: computeDiversification, alignConstituentReturns, DiversificationResult)"
  - "src/components/portfolio/CorrelationHeatmap.tsx (REUSED unchanged — props + reason-routed empties)"
  - "src/components/ui/CollapsibleSection.tsx (native <details> shell; storageKey OMITTED)"
  - "src/components/ui/EmptyStateCard.tsx (honest 0/1-constituent empty)"
  - "src/lib/scenario.ts (FROZEN engine: correlation_matrix, n, portfolio_daily_returns — read-only)"
provides:
  - "The allocator-facing Diversification view (CORR-01..06) in the own-book scenario composer: cluster-reordered heatmap + ρ≥0.85 too-similar badge + DR/ENB headline + descending PCR list, with honest empties"
affects:
  - "Phase 41 wave 3+ (toggle fold / guards / Phase-40 UI-review carry-forwards → Phase 43)"
tech-stack:
  added: []
  patterns:
    - "Enhance-in-place: wrap an existing mount in a factsheet-shaped CollapsibleSection rather than relocating data through a new prop"
    - "Cluster reorder as an upstream PRE-PASS: rebuild the matrix Record in clusterOrderIds insertion order before a renderer with no custom-order prop"
    - "storageKey OMITTED on a /allocations CollapsibleSection to avoid the Phase-38 RT2 cross-tab-bleed class (ephemeral open/closed)"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"
decisions:
  - "0/1-constituent routes to the SECTION-level 'add a second strategy' EmptyStateCard BEFORE the heatmap's own reason-routing (CORR-03); re-pointed the prior <2-strategy heatmap-empty test to this new behavior"
  - "Kept the existing <Card className='mt-6'> outer wrapper for surface consistency with sibling sections; the CollapsibleSection lives inside it"
  - "PCR bar width clamped to ≥0 (Math.max(0, pcr*100)) so a signed negative-hedge PCR renders a 0-width bar while the signed % text stays honest"
  - "Used the `text-warning` Tailwind token (mapped from --color-warning #B45309 via @theme inline) for the badge text; literal bg-[#FEF3C7]/border-[#FDE68A] for the chip fill/border per UI-SPEC"
metrics:
  duration: ~30m
  completed: 2026-06-26
  tasks: 2
  files: 2
  tests: 8 (added/re-pointed)
---

# Phase 41 Plan 02: Diversification CollapsibleSection Summary

The allocator-facing constituent-diversification view (CORR-01..06) wired into the own-book scenario composer: the existing `CorrelationHeatmap` at `ScenarioComposer.tsx` is wrapped in a NEW factsheet-shaped "Diversification" `CollapsibleSection` and surrounded by the new elements — a ρ≥0.85 "too similar" amber badge, the Choueifaty Diversification Ratio + risk-based Effective-Number-of-Bets headline (formula `ENB = 1 / Σ PCRᵢ²` disclosed), and the descending per-constituent percent-contribution-to-risk list — all driven by a new `diversification` memo consuming the Plan 41-01 lib, with the matrix cluster-reordered (CORR-06) upstream before the UNCHANGED heatmap.

## What Was Built

**Task 1 — the `diversification` + `reorderedMatrix` memos (ScenarioComposer.tsx):**

- Imported `{ computeDiversification, alignConstituentReturns } from "@/lib/diversification"` (none on the static-guard denylist).
- `diversification` memo (keyed on `[deAliased, scenarioMetrics]`): calls `alignConstituentReturns(deAliased.strategies, deAliased.state)` to reconstruct the aligned per-constituent returns the FROZEN engine discards; normalizes the active weights to sum→1 over `aligned.ids` (mirroring the engine's per-day renormalization, with a zero/negative-total guard → all-zero weights → the lib's PCR guard nulls the result → honest empty); maps `portfolio_daily_returns` values; passes the engine's read-only `correlation_matrix` + `n`; returns `computeDiversification(input)`.
- `reorderedMatrix` memo (keyed on `[correlation_matrix, clusterOrderIds]`): rebuilds the `Record<id, Record<id, number>>` in `clusterOrderIds` insertion order, copying cells from the engine matrix; passes the raw matrix through unchanged when it is null or `< 2` ids (so the heatmap's reason-routed empty fires).

**Task 2 — the Diversification CollapsibleSection (ScenarioComposer.tsx):**

Replaced the old `<Card className="mt-6">…Pairwise correlation…<CorrelationHeatmap/></Card>` block with `<Card className="mt-6"><CollapsibleSection id="factsheet-diversification" title="Diversification" subtitle="Correlation does not shift with per-strategy leverage" defaultOpen>`:

- **0/1-constituent** (`clusterOrderIds.length < 2`) → ONLY an `EmptyStateCard` ("Add a second strategy to see diversification").
- **Otherwise**, children stack (`gap-10` inherited):
  1. **Too-similar badge** (CORR-02) — amber chip rendered ONLY when `tooSimilarPairs.length > 0`, with correct pair/pairs pluralization; `text-warning`, no red, no icon. Absent when zero (absence is the signal).
  2. **Cluster-reordered heatmap** (CORR-01/06) — `<CorrelationHeatmap correlationMatrix={reorderedMatrix} …/>`, plus the one-line palette legend rendered only alongside a non-null engine matrix. Inherited: reason-routed empties, missing-cell "—", single-sourced Avg|ρ|.
  3. **DR + ENB headline** — hidden entirely when both are null; each value renders only when non-null; the disclosed `ENB = 1 / Σ PCRᵢ²` caption + the singular/plural interpretation line.
  4. **PCR list** (CORR-05) — `<ul role="list">` of `role="listitem"` rows sorted descending by PCR, de-aliased names, accent-teal decorative `aria-hidden` bar (width clamped ≥0), signed % text carrying the accessible value.

`storageKey` OMITTED; no `role="region"` added.

**Tests (ScenarioComposer.test.tsx):** a new `mockThreeStrategies` scaffold (BTC≈ETH correlated ρ≥0.85, SOL the orthogonal outlier) drives the REAL engine matrix + REAL diversification lib (unmocked, matching the existing CORR-01 pattern). Added: CORR-02 DR/Effective-Bets headline + disclosed formula + live-N interpretation; CORR-02 too-similar badge present (one pair, amber, not red); CORR-02 badge absent below threshold; CORR-05 PCR list (3 `listitem`s, de-aliased, descending); CORR-06 heatmap axis labels cluster-adjacent (|BTC−ETH| === 1); CORR-03 single-constituent empty (no headline/PCR); CORR-03 n<10 short-overlap routes to the heatmap empty (no headline/PCR, no "add a second strategy"). Re-pointed the prior `<2-strategy` empty test to the new section-level "add a second strategy" routing.

## How It Works

- The composer never recomputes ρ — the matrix is the engine's read-only `correlation_matrix`; the lib's consistency pin (Plan 41-01) guarantees the DR/ENB/PCR are built on the same sample-cov window the displayed grid uses.
- The cluster reorder is a pure upstream pre-pass because `CorrelationHeatmap` renders axis/cell order from `Object.keys(matrix)` and has no custom-order prop. Reordering the matrix Record (insertion order) is the frozen-safe, heatmap-unchanged path.
- The honesty surface is the displayed numbers: the headline/PCR hide when the lib returns null (never "0.00"/"NaN"); the zero-sum-weight blend (W5) flows to all-null via the weight-sum guard + the lib's PCR `portVar > 1e-15` guard.

## Deviations from Plan

**1. [Rule 1 - Test correctness] Re-pointed the prior `<2-strategy` heatmap-empty test to the new section-level empty**
- **Found during:** Task 2 first targeted run.
- **Issue:** The existing `CORR-02 — with <2 active strategies … renders the honest empty state` test asserted the heatmap's own "Not enough strategies to correlate" copy for the 0-constituent default case. With the enhance-in-place wrapper, the 0/1-constituent case is now routed at the SECTION level to the "Add a second strategy to see diversification" `EmptyStateCard` BEFORE the heatmap ever mounts — exactly the plan's CORR-03 behavior. The old assertion encoded the pre-wrap routing.
- **Fix:** Re-pointed the test to assert the new section-level `EmptyStateCard` copy (still asserting no degenerate `figure`). The heatmap's strategy-count empty remains exercised via the n<10 short-overlap path. This is the plan's explicitly-anticipated re-point ("Re-point/keep the existing CORR-01 de-aliased-labels test green against the new section"; CORR-03 routing supersedes the prior heatmap-empty for 0/1-constituent).
- **Files modified:** src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
- **Commit:** fccb03a9

**2. [Note — not a deviation] UI-SPEC frontmatter vs PLAN placement & storageKey**
- The 41-UI-SPEC.md frontmatter and its CollapsibleSection table (line 109) reference the ORIGINAL "in ScenarioFactsheetChart" placement and list a `storageKey="composer-collapse:diversification"`. Both are superseded by the 41-CONTEXT.md REFINED enhance-in-place decision and the PLAN's locked constraint #2 (OMIT storageKey to avoid the Phase-38 RT2 cross-tab-bleed class). Followed the PLAN/CONTEXT, as instructed. No code/test impact beyond honoring the PLAN.

## Verification

- `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" --no-file-parallelism` → 96/96 green (new CORR-01..06 render/wiring tests + the static guard T-30-05 + H-0133 isolator + all prior composer pins).
- `npx vitest run "src/app/(dashboard)/allocations/" --no-file-parallelism` → 1151/1151 green (92 files).
- `npx vitest run src/components/portfolio/CorrelationHeatmap.test.tsx --no-file-parallelism` → 20/20 green (heatmap UNCHANGED, CI contrast sweep + empty routing intact).
- `npm run test:coverage` → 6697 passed / 284 skipped; all thresholds met (statements 82.23 ≥ 80, branches 74.7 ≥ 72, functions 77.96 ≥ 74, lines 84.38 ≥ 82).
- `npx tsc --noEmit` clean; `npx eslint` on both files clean.
- Static guard: `grep -v '^\s*//' ScenarioComposer.tsx | grep -c FactsheetBody` === 0; no `storageKey` on the new `factsheet-diversification` section (the 3 grep matches are: a comment, and the pre-existing `composer-collapse:controls` section).
- `git diff --name-only` (this commit): ONLY `ScenarioComposer.tsx` + `ScenarioComposer.test.tsx` — `CorrelationHeatmap.tsx`, `scenario.ts`, `ScenarioFactsheetChart.tsx` confirmed untouched.

## Known Stubs

None — every element is wired to the live `diversification` result; honest empties are intentional and plan-specified (CORR-03), not stubs.

## Threat Flags

None — the new code is a presentational panel over data the composer already holds + the Plan-01 lib's derived numbers. No network, no auth, no DB, no storage write (storageKey OMITTED). All STRIDE register dispositions (T-41-02-01..SC) are mitigated as designed: numbers hide on null (no NaN/0.00), no cross-tab bleed (no storageKey), heatmap unchanged, no forbidden api-only path, no packages installed.

## Self-Check: PASSED

- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — FOUND (modified)
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` — FOUND (modified)
- Commit `fccb03a9` — FOUND in git log
- Source/test only committed; no `.planning/` / STATE / ROADMAP staged (verified `git show --name-only HEAD`)
- `CorrelationHeatmap.tsx`, `scenario.ts`, `ScenarioFactsheetChart.tsx` — untouched (verified via `git diff --name-only`)

---

## Code-Review Follow-up (41-REVIEW.md — commit 4bcedb12)

Fixed CR-01 (critical) + WR-01..04 + IN-01..02 from the deep review.

### CR-01 / WR-01 — DR & PCR levered-basis fix (root cause, Rule 6)

The shipped DR mixed an UN-levered numerator (Σ ŵᵢσᵢ, σᵢ from raw returns) with
a LEVERED denominator (σ_p from the engine's per-strategy-levered
`portfolio_daily_returns`). Result: DR **halved under uniform 2× leverage**
(1.662551 → 0.831275) — below the Choueifaty ≥1 long-only bound, impossible for
a true DR, and contradicting the panel subtitle's leverage-invariance claim.
`percentContributionToRisk` had the identical defect (un-levered Σ + un-levered
weights), so under non-uniform leverage it named the WRONG dominant risk driver
and ENB was wrong. The prior 41-01 executor had REWRITTEN the plan's invariance
test to bless the bug (Rule 9 violation).

Fix: compute DR/PCR on the LEVERED basis `xᵢ = Lᵢ·rᵢ` (new `applyLeverage`
helper) with NORMALIZED UN-levered weights ŵᵢ, threading
`deAliased.state.leverage` from the composer into `computeDiversification`. The
correlation matrix path is untouched — leverage is a pure scale transform
(corr(Lᵢrᵢ,Lⱼrⱼ)=corr(rᵢ,rⱼ)), so ρ stays leverage-invariant and the consistency
pin still holds. An all-1 leverage map is byte-identical to a correct un-levered
computation.

**Invariance proof:** DR @ L=1 = 1.662551; DR @ uniform L=2 (buggy) = 0.831275;
DR @ uniform L=2 (fixed) = 1.662551 (invariant, ≥1). PCR and ENB are likewise
invariant under uniform L and correctly re-sort under non-uniform L.

### Tests (Rule 9 — restored intent)

- RESTORED the leverage-INVARIANCE pin (DR/PCR/ENB unchanged under uniform 2×L;
  DR≥1 at L≠1) — the test the prior executor wrongly inverted.
- ADDED a NON-uniform leverage PCR test (lever C 3× → C's PCR rises, list
  re-sorts to name C the dominant driver; signed sum still → 1).
- ADDED DR≥1 at non-uniform leverage (Choueifaty bound).
- ADDED the **WR-04** STAGGERED-inception consistency pin: rebuilt ρ ≡ engine
  `correlation_matrix` to 3dp on a blend with B starting mid-window (the riskiest
  re-alignment path, previously unverified against the engine).

### Panel (ScenarioComposer)

- **WR-02:** PCR bar width clamped to [0,100]% + `overflow-hidden` track (a hedge
  forcing another leg's PCR > 100% can no longer bleed out of the track).
- **WR-03:** negative-PCR (hedge) legs render a positive-token "risk-reducing"
  tag + a teal mini-bar (scaled by |PCR|) instead of an empty 0-width bar.
- **IN-01:** ENB < 1 surfaces a "below 1 — a hedge offsets risk" disclosure
  (the lib's promised "DISCLOSED on the panel" contract, previously unmet).

### IN-02

`DEFAULT_INCLUDE_FROM` hoisted to `scenario.ts` (single source of truth) and
imported by `diversification.ts`, so the engine's fallback date can never
silently diverge from the lib's re-alignment.

### Files

- `src/lib/diversification.ts` — `applyLeverage`, levered DR/PCR basis, leverage
  on `DiversificationInput`, imported `DEFAULT_INCLUDE_FROM`.
- `src/lib/diversification.test.ts` — restored invariance pin + non-uniform +
  DR≥1 + WR-04 staggered pin.
- `src/lib/scenario.ts` — export `DEFAULT_INCLUDE_FROM`.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — thread
  leverage; WR-02/WR-03/IN-01 panel changes.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` —
  WR-02/WR-03/IN-01 hedge-blend tests.

### Verification

- `npx vitest run src/lib/diversification.test.ts` — 32 passed.
- `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` — 100 passed.
- `npm run test:coverage` — 6704 passed / 284 skipped / 0 failed; thresholds met
  (statements 82.24 / branches 74.73 / functions 77.97 / lines 84.39).
- `tsc --noEmit` clean; eslint clean on all five files.
- Commit `4bcedb12` (source/test only; no `.planning` staged; hooks enabled).
