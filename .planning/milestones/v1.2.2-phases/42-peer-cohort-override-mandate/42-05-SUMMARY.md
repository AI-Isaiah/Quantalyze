---
phase: 42-peer-cohort-override-mandate
plan: 05
subsystem: scenario-composer / factsheet-v2
tags: [PEER-04, PEER-05, mandate-chips, own-book-delta, sample-basis, frozen-spine]
requires:
  - scenarioMode seam (MetricsColumn, Phase 40)
  - buildScenarioFactsheetPayload csv carve-out plumbing (Phase 39 / 42-03)
  - scenarioMetrics engine output (computeScenario, FROZEN SCENARIO-05)
  - baselineEquityDailyPoints own-book equity levels (queries.ts)
provides:
  - sampleBasisRatios standalone helper (sample/252 Sharpe/Sortino/maxDD replica)
  - ScenarioMandatePayload + OwnBookDeltaPayload csv-arm carve-out types
  - ConstituentMandatePanel (per-constituent read-only mandate chips)
  - OwnBookDeltaPanel (signed sample-basis blend-vs-book delta)
affects:
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx (§III Style + §V Terms gated mounts)
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx (two useMemos + 2 props)
tech-stack:
  added: []
  patterns:
    - parity-by-construction golden test pinning a standalone replica to a FROZEN engine
    - additive csv-only carve-out fields (conditional spread → byte-identical call sites)
    - scenarioMode-gated + self-null-guarded panels (non-scenario route byte-identical)
    - WCAG non-color-only signed deltas (sign carried in text via +/U+2212)
key-files:
  created:
    - src/lib/sample-basis-ratios.ts
    - src/lib/scenario-sample-ratios.test.ts
    - src/app/factsheet/[id]/v2/MandatePanels.scenario.test.tsx
    - src/app/factsheet/[id]/v2/BatchDPanels.ownbook.test.tsx
  modified:
    - src/lib/factsheet/types.ts
    - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
    - src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx
    - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
    - src/app/factsheet/[id]/v2/MandatePanels.tsx
    - src/app/factsheet/[id]/v2/BatchDPanels.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
decisions:
  - "scenario.ts is FROZEN (SCENARIO-05) — wrote a STANDALONE sampleBasisRatios replica + PARITY golden test instead of extracting from the engine (the plan-as-written said extract; the critical override forbade it). scenario.ts stays zero-diff; the 4 frozen-spine guards stay green."
  - "Own-book daily returns derived from baselineEquityDailyPoints (absolute-USD equity LEVELS → value[i]/value[i-1]−1) via sampleBasisRatios, NOT liveBaselineMetrics (a different/population basis) — basis-consistent with the blend (T-42-15)."
  - "Max DD delta color: positive delta (blend shallower) → positive token. The UI-SPEC 'inversion' is relative to the naive 'positive change in a loss field is bad' reading; on signed (negative) drawdown deltas, positive IS favorable, so the code maps positive→positive for both ratio and maxdd kinds."
  - "Leverage chip alone is NOT 'metadata' — a constituent with empty strategy_types AND markets is treated as honest-empty ('no mandate metadata') even though it always has a ≥1.0× leverage."
metrics:
  duration: ~25min
  tasks: 3
  files_created: 4
  files_modified: 7
  completed: 2026-06-26
---

# Phase 42 Plan 05: Per-Constituent Mandate + Own-Book Delta Summary

Per-constituent mandate chips (PEER-04) and a signed blend-vs-live-book head-to-head
delta (PEER-05) on the scenario factsheet — both computed on a STANDALONE sample/252
ratio replica that is pinned parity-by-construction to the FROZEN scenario engine,
so `scenario.ts` stays zero-diff and the v1.2 frozen-spine guards remain green.

## What was built

### Task 1 — `sampleBasisRatios` replica + the two csv carve-out fields (commit 7b726de4)
- **`src/lib/sample-basis-ratios.ts`** — `sampleBasisRatios(dailyReturns: number[]):
  { sharpe: number|null; sortino: number|null; max_drawdown: number|null }`. A standalone
  replica of the frozen engine's sample(ddof=1)×√252 Sharpe + downside-RMS/n×√252 Sortino
  (rf=0) + peak-to-trough max-drawdown math, rounded to the engine's payload contract
  (sharpe/sortino toFixed(3), max_drawdown toFixed(5)). Degenerate guard (<2 finite obs or
  any non-finite → all-null); no-down-day → null Sortino (audit G8.E.6 / P343).
- **`src/lib/scenario-sample-ratios.test.ts`** — hand-derived sample/252 reference +
  the **PARITY pin**: for a single-strategy blend whose portfolio daily returns equal the
  fixture verbatim, `computeScenario`'s rounded sharpe/sortino/max_drawdown EQUAL
  `sampleBasisRatios(...)`. A drift in EITHER the engine OR the replica fails the pin.
- **`types.ts`** — additive csv-only `ScenarioMandatePayload`
  (`{ constituents: { name; strategy_types: string[]; markets: string[]; leverage: number }[] }`)
  and `OwnBookDeltaPayload` (`{ sharpe: number|null; sortino: number|null; max_dd: number|null;
  book_n: number }`). Blend-only — never on the api arm / FactsheetCommon.
- Builder + `ScenarioFactsheetChart` thread both props (conditional spread → omitted when
  absent → existing call sites byte-identical).
- **Composer** computes `scenarioMandate` (per-constituent from `deAliased.strategies` +
  `deAliased.state.leverage[id] ?? 1.0`) and `scenarioOwnBookDelta` (blend − own-book
  sample-basis ratios; own-book returns derived from `baselineEquityDailyPoints` LEVELS;
  `undefined` when no live book) and passes both to the chart.

### Task 2 — `ConstituentMandatePanel` (commit 512b8447)
- Reads the csv-only `scenarioMandate` (ingestSource narrow); per-constituent name +
  `strategy_types` / `markets` / `leverage` chips using the verbatim UI-SPEC neutral-outline
  span classes; a **local static `Chip`** — NOT the interactive `MandateChipGroup`
  (role=checkbox is wrong a11y for display). Per-constituent honest-empty
  "no mandate metadata" (types+markets both absent); whole-panel honest-empty copy with the
  "Mandate" title still rendered; no fabricated aggregate. Mounted in §V Terms before
  `TermsPanel`, scenarioMode-gated + self-null-guarded.

### Task 3 — `OwnBookDeltaPanel` (commit 4b8ad51c)
- Reads the csv-only `scenarioOwnBookDelta`; "vs Your Book" with 3 signed rows
  (Sharpe/Sortino/Max DD). The sign is ALWAYS in text (`+` / U+2212 minus) — never
  color-only — plus `--color-positive`/`--color-negative`. Max DD on signed (negative)
  drawdown deltas: positive delta = blend shallower = favorable = positive token, in pp.
  Basis note "Delta = blend minus your live book · sample/252 basis · {N} book observations".
  Null single-ratio → "—"; silently absent without a live book; non-scenario → null. Mounted
  in §III Style after `PeerPercentilePanel`, scenarioMode-gated + self-null-guarded.

## Payload field shapes (recorded per <output>)

```ts
ScenarioMandatePayload = {
  constituents: Array<{ name: string; strategy_types: string[]; markets: string[]; leverage: number }>;
};
OwnBookDeltaPayload = {
  sharpe: number | null;   // blend_sharpe − book_sharpe (sample/252)
  sortino: number | null;  // blend_sortino − book_sortino
  max_dd: number | null;   // blend_max_dd − book_max_dd (positive = shallower = better)
  book_n: number;          // own-book observation count (basis note)
};
sampleBasisRatios(dailyReturns: number[]): { sharpe: number|null; sortino: number|null; max_drawdown: number|null };
```

**Own-book daily-returns derivation:** `baselineEquityDailyPoints` is `{ date, value }` where
`value` is the absolute-USD equity LEVEL (`value_usd` via `equitySnapshotsToDailyPoints`). The
composer derives returns inline as `value[i]/value[i−1] − 1` (guarding `prev > 0` + finite),
then runs `sampleBasisRatios` on that array — the SAME basis as the blend's `scenarioMetrics`.

## Critical override honored

The plan-as-written said to extract `sampleBasisRatios` FROM `scenario.ts:346-388`. The
`<critical_override>` forbade modifying `scenario.ts` (FROZEN SCENARIO-05; the
phase-29..32-frozen-spine guards assert it is zero-diff vs the merge-base baseline `e5e4f3d2`).
Resolution: a standalone replica + a parity golden test. **`git diff <merge-base> HEAD --
src/lib/scenario.ts` is EMPTY; all 4 frozen-spine guards pass (20 tests).**

## Deviations from Plan

**1. [Critical override — not extraction] Standalone replica instead of `scenario.ts` extraction.**
- The plan frontmatter/action said "extract `sampleBasisRatios` FROM scenario.ts:346-388 …
  Refactor computeScenario to call it". The critical override forbade touching `scenario.ts`.
- Built `src/lib/sample-basis-ratios.ts` as a self-contained replica + a parity test pinning
  it to `computeScenario`. `scenario.ts` is untouched (zero-diff verified).
- Files: src/lib/sample-basis-ratios.ts, src/lib/scenario-sample-ratios.test.ts. Commit 7b726de4.

No other deviations — Rules 1-3 did not fire (no bugs, missing-functionality, or blockers).
No auth gates.

## Threat surface

No new server surface — `scenarioOwnBookDelta` is derived entirely client-side from
`props.payload` (own-tenant via owner-RLS), no fetch. T-42-15 (basis honesty) mitigated:
both legs use `sampleBasisRatios` on daily returns; the panel discloses the basis. T-42-16
(own-tenant data) accepted as designed. No threat flags.

## Known Stubs

None. Both panels render real per-constituent and own-book data when present, and honestly
render an empty state (or are silently absent) when data is genuinely unavailable.

## Verification
- `npx vitest run src/lib/scenario-sample-ratios.test.ts "…/MandatePanels.scenario.test.tsx"
  "…/BatchDPanels.ownbook.test.tsx"` → 15 passed.
- Full relevant suites (factsheet v2 + allocations + factsheet lib + frozen-spine + basis) →
  1359 passed across 119 files.
- `npm run test:coverage --no-file-parallelism` → 557 files / 6758 tests passed (288 skipped);
  ratchet gate held (lines 84.52 / statements 82.41 / functions 78.15 / branches 74.87).
- `npm run typecheck` clean; `eslint` on all touched files clean.
- `git diff <merge-base origin/main HEAD> HEAD -- src/lib/scenario.ts` EMPTY; 4 frozen-spine
  guards green (20 tests).

## Self-Check: PASSED
- Files: all 4 created files FOUND.
- Commits: 7b726de4, 512b8447, 4b8ad51c all present in git log.
- scenario.ts ZERO-DIFF confirmed; frozen-spine guards green.

## Code-review follow-up (42-REVIEW.md WR-01/WR-02/IN-01/IN-02) — commit f427fd5c

The deep code review found no BLOCKER; the two WARNINGs and two trivial INFO
doc-drifts were fixed surgically (source/test only; scenario.ts untouched).

- **WR-02 (honesty — primary):** the own-book delta compares the blend leg
  (`scenarioMetrics`, the constituents' overlap window) against the book leg
  (`sampleBasisRatios(bookReturns)`, the allocator's full live-book history) on
  the SAME sample/252 FORMULA but generally over DIFFERENT calendar windows. The
  prior basis note disclosed only `book_n`. Chose the disclosure approach (cheaper,
  no data realignment, per the prompt): added `blend_n` to `OwnBookDeltaPayload`,
  populated it from `scenarioMetrics.n` in the composer memo (deps keyed on `n`
  too), and reworded the note to "over each series' own window
  ({blend_n} obs blend · {book_n} obs book)" so the window mismatch is explicit.
  The `BatchDPanels.ownbook.test.tsx` render contract now asserts the dual-count
  disclosure (blend_n != book_n in the fixture).
- **WR-01 (robustness):** debounced the peer-rank fetch effect (350ms,
  `PEER_RANK_DEBOUNCE_MS`) so a burst of blend edits coalesces into one
  `POST /api/scenario/peer-rank`, capping egress and preserving the
  `scenarioPeerLimiter` probe-resistance budget. Upgraded the `cancelled`
  boolean to an `AbortController` so a superseded in-flight request is aborted
  (no stale overwrite, and the limiter token is freed rather than burned). The
  n>=252 + finite gate (`buildScenarioPeerRankRequest`) and the metric-tuple
  deps are unchanged — no refetch loop.
- **IN-01:** `sample-basis-ratios.ts` docstring now references the real parity
  test `scenario-sample-ratios.test.ts` (the named `sample-basis-ratios.test.ts`
  never existed).
- **IN-02:** the peer-rank route comment claiming `MIN_COHORT_N` is "never
  branched on" was corrected — line ~203 belt-and-suspenders re-checks
  `cohort_n < MIN_COHORT_N`; the comment now describes that.

Verification: `tsc --noEmit` clean; eslint clean; targeted suites green
(1249 tests across 104 files); full `test:coverage` green (557 files, 6758
tests, thresholds met — lines 84.49 / stmts 82.39 / fns 78.08 / branches 74.83);
scenario.ts ZERO-DIFF vs origin/main; frozen-spine guards green (20 tests).
