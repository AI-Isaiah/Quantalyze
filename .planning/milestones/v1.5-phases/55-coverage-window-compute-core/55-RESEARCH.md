# Phase 55: Coverage-Window Compute Core - Research

**Researched:** 2026-07-01
**Domain:** Client-side quant blend engine rewrite (`src/lib/scenario.ts` `computeScenario`) — coverage-window membership + constant honest divisor
**Confidence:** HIGH (grounded in the ADR, the milestone research SUMMARY/PITFALLS, and every named file read at HEAD — not generic advice)

## Summary

Phase 55 is a precision rewrite of ONE frozen pure function (`computeScenario`, `src/lib/scenario.ts:149-465`) plus a new sibling helper module, a from-scratch numpy verification artifact, a consumer re-verify sweep, and a deliberate re-baseline of five git-delta frozen-spine guards. It is not a feature build — the product decisions are all locked by ADR-001 and CONTEXT.md; this research answers **how to execute** them, with a file:line-precise blast-radius map.

The single most important structural finding: the **five frozen-spine guards are git-DELTA guards, not value-snapshot guards.** Each asserts `src/lib/scenario.ts` (and for phases 30/31, `scenario.test.ts`; for phase 52, also `compute.ts` + 10 islands) does **not appear in the changed-files set** vs a per-phase baseline SHA. They fail the moment `scenario.ts` is touched — by design. "Re-baselining" them is therefore NOT editing an expected number: it is either (a) moving the frozen-file assertion to permit `scenario.ts` under the v1.5 milestone, or (b) advancing the baseline SHA so the delta is empty on a fresh branch — and the mechanical choice must be decided in-plan (see Frozen-Spine Guards section). The actual *numeric* pin that moves lives in `scenario.test.ts`, specifically the "never shrinks the scenario window to the overlap" test (`scenario.test.ts:351-369`), which asserts the exact UNION behavior being replaced (`n===60`, `effective_start===dates[0]`) and must be re-baselined to the intersection semantics (`n===20`).

The second critical finding: the engine is called in **three distinct contexts**, and only ONE is a scenario-tab consumer. `queries.ts:2208` (`liveBaselineMetricsFromHoldings`) and `queries.ts:2356` (per-key own-book) call `computeScenario` to compute the **allocator's own live book** — an own-book blend, not a scenario projection. `computeCompositeCurve` (`scenario.ts:551`) is the My-Allocation overlay. CONTEXT explicitly keeps `computeCompositeCurve` on union behavior via the optional `window`. The planner MUST decide (and I flag as an Open Question) whether the two `queries.ts` own-book call sites also keep union — they almost certainly should, because widening/narrowing a coverage window is a *scenario* interaction the own-book baseline has no UI for, and silently defaulting the own-book blend to the intersection would change the live drawer metrics the whole allocator dashboard rests on. The additive-optional `window?` field makes this a no-op preservation: any caller that omits `window` keeps the old union axis IF the default-when-absent is union — but CONTEXT locks the *scenario-tab* default to intersection. The clean resolution: the engine's behavior-when-`window`-absent stays UNION (byte-compat for every non-scenario caller), and the scenario tab always passes an explicit `window` (derived via `defaultWindowFor()`). This preserves the maximum number of pins and isolates the new behavior to the exact surface that opts in.

**Primary recommendation:** Add `window?: {start; end}` to `ScenarioState` (mirroring `leverage?`), derive coverage spans INSIDE the engine from the returns maps, and gate the new membership/divisor path on `state.window` being present — absent `window` runs the byte-identical union path. Write the new `src/lib/scenario-window.ts` helper first, unit-test membership boundary cells and the empty-member guard, record the from-scratch numpy 6-strategy match (BLEND-07) BEFORE any golden bake, then re-baseline the frozen-spine guards + the one `scenario.test.ts` union pin as an annotated, reviewed act.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (Product — LOCKED at kickoff, ADR-001 + REQUIREMENTS)
- **REPLACE the convention, not an additive mode.** No second code path for the scenario tab; the tail-dilution "all-started / no-end-bound / 0-fill tail / divisor = every started strategy" convention is removed for the scenario surface (ADR Option A; Options B ragged per-date divisor and C additive-aligned-mode rejected).
- **Membership = `enabled AND coverageSpan ⊇ [winStart, winEnd]`.** Divisor counts members only and is **constant** across the window (window-fixed membership).
- **Interior mid-window gaps stay 0-filled** (documented deliberate simplification; keeps the divisor constant; interior gaps rare for daily series). No interior-gap density floor this milestone (BLEND-F2 deferred to v2).
- **Weighted (non-equal) blends renormalize** surviving members' weights to sum-to-1 after a coverage drop; typed `weights` stay the source of truth (ephemeral renorm).
- **Zero-member window → honest empty-state** — no divide-by-zero, no fabricated zeros (`no-invented-data` preserved).
- **`window?: { start; end }` is a new OPTIONAL field on `ScenarioState`** — additive, positional signature of `computeScenario(strategies, state, dateMapCache)` UNCHANGED (mirrors the R4 `leverage?` precedent). A state without `window` stays byte-compatible where the union == the derived default.
- **`coverageSpan` derived INSIDE the engine** from the returns maps — never plumbed through the adapter, never from the `"2022-01-01"` sentinel.
- **Window is a compute INPUT applied inside the engine**, never a factsheet chart view-clamp (else KPI strip / stress / benchmark / MC de-sync from the factsheet).
- LOCKED invariants that must stay green: `no-invented-data`, **252-day annualization** product-wide, factsheet **parity-by-construction**, WCAG-AA floor, no share-link leak.

### Residual engineering choices (user accepted all 2026-07-01)
- **Q1 — Shared helper location:** new pure module `src/lib/scenario-window.ts` exporting `coverageSpanOf()`, `defaultWindowFor()` (intersection = latest-start … earliest-end), and `intersectionOf()`. Zero new deps (reuse `dateday.ts` + the already-sorted return series). Composer, share-resolve, and compare all import this ONE helper (PERSIST-02 precondition). Mirrors the existing separate `scenario-benchmark.ts` / `scenario-compare.ts` libs.
- **Q2 — Engine output shape:** extend `ComputedMetrics` **additively** with `member_count: number` and `member_ids: string[]`; reuse existing `effective_start` / `effective_end` for the effective `[winStart,winEnd]` and existing `n` for `N`. External construction sites (`liveBaselineToComputedMetrics`, `NULL_METRICS`) read new fields with defaults and need no edit.
- **Q3 — BLEND-07 verification artifact:** a committed markdown artifact (6-strategy dataset numbers + from-scratch numpy script) PLUS a vitest test asserting `computeScenario` matches to fp precision over the max-overlap window, with `divisor == live-member count`. Recorded BEFORE any golden re-bake (Phase 60).
- **Q4 — Frozen-spine guard re-baseline:** update each expected snapshot IN THE SAME phase-55 commit that changes the math, each changed expectation annotated `// v1.5 coverage-window re-baseline (ADR-001)`, old→new numbers enumerated in the phase SUMMARY. **Never** a blind `--update-snapshots`. The guard stays live, now asserting the NEW coverage-window series. Applies to `phase-{29,30,31,32,52}-frozen-spine-guards.test.ts` + the SCENARIO-05 zero-diff pin.

### Claude's Discretion
- Exact internal factoring of `computeScenario` (helper decomposition, variable naming) so long as the positional signature and the additive output contract hold.
- Whether the default window (when `state.window` is absent) is computed inline or via `defaultWindowFor()` — but for the SCENARIO SURFACE it MUST be the intersection, derived from coverage spans, not the `"2022-01-01"` sentinel or the union.
- Unit-test decomposition beyond the mandated cases (ended-tail no-dilution; divisor == member count; single-member window; internal-gap 0-fill; empty-intersection empty-state; weighted renorm-after-drop).

### Deferred Ideas (OUT OF SCOPE — later phases)
- UI window control / auto-toggle state machine (Phase 57); coverage legibility UI (Phase 58); persistence/schema bump (Phase 59); golden/e2e re-bake (Phase 60 — never in the same commit that changes the math); authed QA canary (Phase 61).
- Factsheet parity **assertion** guard is Phase 56 (this phase must not break it).
- `computeCompositeCurve` (My-Allocation overlay) keeps union behavior — not a scenario-tab consumer.
- BLEND-F1 (correlation over mutually-present days), BLEND-F2 (interior-gap density floor), VENUE-F1 (cross-venue calendar normalization) — all v2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BLEND-01 | `computeScenario` blends over explicit `[winStart,winEnd]` (new optional `ScenarioState.window`), replacing the implied-union axis | Add `window?` mirroring `leverage?` (`scenario.ts:82`); scenario surface passes explicit window via `defaultWindowFor()`; absent→union preserves non-scenario callers. See Architecture Patterns §Window param. |
| BLEND-02 | Member iff `enabled AND coverageSpan ⊇ window`; divisor counts members only — ended strategy no longer dilutes | Inclusive containment `spanFirst <= winStart && spanLast >= winEnd`; coverage from returns Map. See Pitfall 1 (boundary), Pitfall 2 (coverage vs metadata). |
| BLEND-03 | Interior mid-window gaps stay 0-filled → constant divisor | 0-fill ONLY for members, ONLY interior `[winStart,winEnd]` dates. See Pitfall 3. |
| BLEND-04 | Weighted blends renormalize surviving weights to sum-1 after a coverage drop | Renormalize a DERIVED copy over the member set; preserve typed weights. Existing `normWeight` (`scenario.ts:181`) renorms over active set — extend to member set. See Pitfall 7. |
| BLEND-05 | Zero-member window → honest empty-state (no ÷0, no fabricated zeros) | Top-of-function member-count-0 guard modeled on `activeIds.length===0` early-return (`scenario.ts:157-174`). See Pitfall 4. |
| BLEND-06 | Engine output exposes `member_count`, effective `[winStart,winEnd]`, `N` | Additive `member_count`/`member_ids`; reuse `effective_start`/`effective_end`/`n` (Q2). |
| BLEND-07 | Blend matches from-scratch numpy to fp precision over max-overlap window, before any golden re-bake | Committed markdown artifact + vitest gate; 6-strategy dataset. See §BLEND-07 Verification Harness. |
| PARITY-02 | stress/VaR, benchmark, MC, compare, KPI strip correct on the coverage-window series; stale union comments cleared | 12-consumer blast-radius map with file:line; stale comments in benchmark/compare/compare-table. See §Consumer Blast Radius. |
| PARITY-03 | SCENARIO-05 zero-diff + `phase-{29,30,31,32,52}` guards re-baselined as reviewed act; no-invented-data/252/WCAG stay green | Git-delta guard mechanics + the one `scenario.test.ts` numeric pin that moves. See §Frozen-Spine Guards. |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Coverage-span derivation (first/last date WITH data) | Client compute (`scenario-window.ts`) | — | Pure function of the already-sorted returns Map; no server, no adapter plumbing (locked: derive inside engine) |
| Window membership + constant divisor blend | Client compute (`scenario.ts` `computeScenario`) | — | The sole blend engine; runs client-side on `/allocations` scenario tab |
| Default-window (intersection) derivation | Client compute (`scenario-window.ts` `defaultWindowFor`) | UI state (Phase 57) | One shared helper so composer/share-resolve/compare derive identically (PERSIST-02 precondition) |
| From-scratch numpy verification | Dev/CI (committed artifact + vitest) | Python (numpy script, run-once) | Independent re-derivation is the gate BEFORE any golden bake |
| Frozen-spine guard re-baseline | Dev/CI (vitest git-delta guards) | — | Guards are pure git/file inspection; re-baseline is a git/test-file edit, no runtime |
| Consumer re-verify (benchmark/stress/MC/compare/KPI) | Client compute libs + components | — | Each reads engine output series; math unchanged, series shorter |

## Standard Stack

### Core (all present, zero new deps — VERIFIED against repo at HEAD)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `vitest` | ^4.1.2 | Test runner (`npm test` = `vitest run`) | `[VERIFIED: package.json:13,70]` The project's sole TS test framework; all pins are vitest |
| `@vitest/coverage-v8` | ^4.1.9 | Coverage gate (lines 82 / stmts 80 / fns 74 / br 72) | `[VERIFIED: package.json:62 + CLAUDE.md]` Blocking CI gate |
| `dateday.ts` (internal) | — | ISO-day math; lexicographic `YYYY-MM-DD` compare | `[VERIFIED: src/lib/dateday.ts]` The repo's single date module; `sortByDayAscending`, `diffDays`, `parseIsoDay` available; interval math is string comparison |
| `portfolio-math-utils.ts` (internal) | — | `DailyPoint`, ascending-sort guarantee | `[VERIFIED: scenario.ts:46]` `DailyPoint` re-exported from scenario.ts |
| numpy (Python, dev-only) | (analytics-service venv) | BLEND-07 from-scratch re-derivation | `[VERIFIED: analytics-service/tests/ has numpy golden-fixture precedent]` |

### Supporting (internal helpers to write, NOT install)
| Symbol | New file | Purpose |
|--------|----------|---------|
| `coverageSpanOf(dailyReturns) → {first,last} \| null` | `src/lib/scenario-window.ts` | First/last date WITH data from the returns array; ~5 LOC |
| `defaultWindowFor(spans) → {start,end} \| null` | `src/lib/scenario-window.ts` | `max(firsts) / min(lasts)` over selected+enabled spans; null on empty intersection |
| `intersectionOf(spans) → {start,end} \| null` | `src/lib/scenario-window.ts` | Generic intersection primitive `defaultWindowFor` delegates to |
| `covers(span, window) → boolean` | `src/lib/scenario-window.ts` (or inline in engine) | Inclusive containment `span.first <= win.start && span.last >= win.end` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Gating new behavior on `state.window` presence (union when absent) | Make intersection the unconditional default | Would change every non-scenario caller (`queries.ts` own-book, `computeCompositeCurve`, per-key baseline) — breaks live-drawer metrics + many pins. Rejected. |
| `date-fns`/`dayjs` for interval math | — | Duplicates `dateday.ts`; adds bundle weight to the composer island; contradicts the repo's single-date-module convention. Rejected (zero-new-deps locked). |

**Installation:** None. Zero new runtime or dev dependencies.

**Version verification:** `npm test` → `vitest run` `[VERIFIED: package.json:13]`. No package installs in this phase.

## Package Legitimacy Audit

> Not applicable — this phase installs **zero external packages** (locked: zero new deps). All new code is internal pure-TS. No registry lookup, no slopcheck needed. The only "external" tool is numpy in the already-provisioned `analytics-service` Python venv (used run-once to produce the BLEND-07 artifact; not a new project dependency).

## Consumer Blast Radius (PARITY-02)

Every consumer of `computeScenario` / `ComputedMetrics`, classified. **Category A** = reads output series only, no math change, needs re-verify on shorter window. **Category B** = has a latent union-window assumption or stale comment that must be cleared. **Category C** = NOT a scenario-tab consumer — must be verified to KEEP union behavior (window absent).

| # | File:line | Consumer | Reads | Category | Action |
|---|-----------|----------|-------|----------|--------|
| 1 | `scenario-factsheet-payload.ts` (`portfolio_daily_returns`) | Factsheet payload | `portfolio_daily_returns` | A | Re-verify parity-by-construction; Phase 56 asserts. Inherits shorter series for free IF single-source. Confirm no re-derive. |
| 2 | `scenario-benchmark.ts:8-15` | BTC benchmark inner-join | `portfolio_daily_returns` | **B** | **Stale comment**: says "scenario engine's own date axis is a zero-filled UNION". Now member-intersection. Inner-join still correct (intersection ∩ smaller); FIX the comment. Re-verify `betaN` sample-floor on shorter window. |
| 3 | `scenario-stress.ts:41-44,111,124` | Stress/VaR | `portfolio_daily_returns`, benchmark | A | `varN = portfolioDaily.length` (line 111) is now the shorter window; `betaN = bench.n` (124) shifts. Both gate on `evaluateSampleFloor(n, SAMPLE_FLOOR_OVERLAPPING_DAYS=60)`. A formerly-shown metric may now honestly show em-dash on a short intersection — verify that's honest, not a regression. |
| 4 | `scenario-montecarlo.ts:13-16` | Monte-Carlo bands | `portfolio_daily_returns` | A | Block-bootstraps the series; shorter window = fewer bootstrap days. Gated on `evaluateSampleFloor` + block length. Verify block-length ≤ window n; honest "insufficient history" not narrow-but-fabricated bands. |
| 5 | `scenario-compare.ts:27-29,152` | Compare engine | `ComputedMetrics` | **B** | **Stale comment**: "Heterogeneous windows … does not force a common window (Phase 24)". Each compared draft now defaults to its own intersection — comparability worsens. FIX comment; PERSIST-03 (Phase 59) owns per-window compare. This phase: clear the comment, verify `computeMetricsForDraft` passes/derives a window (Phase 59 wires the persisted one). |
| 6 | `ScenarioCompareTable.tsx:19-20` | Compare table UI | `ComputedMetrics` | **B** | **Stale comment**: "NO single shared-window header (Phase 24)". FIX / update to reflect coverage-window reality. |
| 7 | `KpiStrip.tsx:101,405` | KPI strip | `ComputedMetrics` (sharpe/cagr/etc.) | A | Reads null-suppressed metrics; shorter window → different (honest) numbers. No math. Re-verify null-render. Also a candidate consumer of new `member_count` (Phase 57/58). |
| 8 | `MonteCarloSection.tsx:60` | MC section | `portfolio_daily_returns.length===n` invariant | A | Comments the ok-path length invariant; verify it holds post-rewrite (length===n over member window). |
| 9 | `ScenarioBenchmarkSection.tsx:134` | Benchmark section | `portfolio_daily_returns` | A | Passes `portfolioDaily` to `computeScenarioBenchmark`; shorter series. No math. |
| 10 | `StressVarSection.tsx:135-139` | Stress section | `portfolio_daily_returns`, btcDaily | A | Passes shorter series to `computeScenarioStress`. No math. |
| 11 | `ScenarioComposer.tsx:1533` | Composer (the scenario tab) | full `ComputedMetrics` | A→**owns window** | This is where `computeScenario(deAliased.strategies, deAliased.state, dateMapCache)` runs client-side. Phase 57 threads `state.window` here; THIS phase just makes the engine accept it. Empty-state at `:1161,2053,2650` (`EmptyStateCard`) is the template for the zero-member render. |
| 12 | `share-resolve.ts:177,183,185` | Shared-scenario recompute | runs `computeScenario` server-side | **B/C** | Rebuilds `startDates` from `daily[0]?.date ?? "2022-01-01"` (line 177), no window param today. Phase 59 (PERSIST-02) wires the persisted/derived window via the SAME `defaultWindowFor()`. THIS phase: no change required (window absent → union, byte-compat), but the shared helper it will import must exist. |
| — | `diversification.ts`, `scenario-blend-panels.ts` | Blend panels / correlation | `portfolio_daily_returns`, correlation_matrix | A | Read the series/matrix; correlation over 0-filled interior gaps is the accepted BLEND-F1 simplification (verify a gappy member doesn't fabricate diversification; Pitfall 17). |
| — | `ScenarioComparePanel.tsx`, `scenario-peer-request.ts`, `CorrelationHeatmap.tsx` | Compare/peer/heatmap | `effective_start`/`effective_end`, `ComputedMetrics` | A | `effective_start/end` semantics drift from union-bounds to member-window bounds (Pitfall 16) — grep-confirm each wants the *window* meaning (they do). |

### Category C — NOT scenario-tab consumers (MUST keep union behavior)
| File:line | Consumer | Why it must NOT get the intersection default |
|-----------|----------|----------------------------------------------|
| `queries.ts:2208` | `liveBaselineMetricsFromHoldings` — the allocator's OWN live book | Own-book blend has no window UI; defaulting to intersection would silently change the live-drawer AUM/Sharpe/DD the whole dashboard rests on. Window ABSENT → union. **This is the strongest reason the engine must keep union when `window` is undefined.** |
| `queries.ts:2356` | per-key own-book baseline | Same — own-book, no scenario window. |
| `scenario.ts:551` (`computeCompositeCurve`) | My-Allocation overlay | Explicitly locked out of scope (CONTEXT); keeps union via optional field. |
| `sample-basis-ratios.ts` replica | Standalone Sharpe/Sortino/DD replica | Parity-pinned to the frozen engine via `scenario-sample-ratios.test.ts` — see Frozen-Spine section (single-strategy, stays green). |

**Key insight for the planner:** the additive-optional `window?` field is doing double duty — it is BOTH the new scenario capability AND the byte-compat shield for every Category-C own-book caller. The engine's behavior-when-`window`-absent must remain the union path so `queries.ts` own-book, `computeCompositeCurve`, and `share-resolve` (until Phase 59) are untouched.

## Architecture Patterns

### System Architecture Diagram (data flow, not files)

```
                          ┌─────────────────────────────────────────┐
  scenario tab UI  ─────► │  state.window PRESENT (explicit)         │
  (Phase 57 wires) │      │  = defaultWindowFor(selected+enabled)    │
                   │      └──────────────────┬──────────────────────┘
                   │                         │
  own-book callers │      ┌──────────────────▼──────────────────────┐
  (queries.ts,     ├────► │           computeScenario                │
   composite,      │      │  ┌────────────────────────────────────┐  │
   share-resolve)  │      │  │ window ABSENT? ──► UNION path       │  │  ← byte-compat
   window ABSENT   │      │  │  (existing all-started/0-fill-tail) │  │    (Category C)
                   │      │  └────────────────────────────────────┘  │
                   │      │  ┌────────────────────────────────────┐  │
                   │      │  │ window PRESENT? ──► COVERAGE path   │  │  ← new (scenario)
                   │      │  │  1. coverageSpanOf each strategy    │  │
                   │      │  │  2. member = enabled && covers(win) │  │
                   │      │  │  3. member_count === 0 ► empty-state│  │  ← BLEND-05 guard
                   │      │  │  4. axis = dates in [winStart,winEnd]│ │
                   │      │  │  5. per-day Σ w·L·(r ?? 0) / Σw      │  │  ← constant divisor
                   │      │  │     over MEMBERS only (renorm)      │  │  ← BLEND-04
                   │      │  └────────────────────────────────────┘  │
                   │      └──────────────────┬──────────────────────┘
                   │                         │ ComputedMetrics (+ member_count, member_ids)
                   │      ┌──────────────────▼──────────────────────┐
                   │      │  12 consumers read output series:        │
                   │      │  factsheet · benchmark · stress · MC ·   │
                   │      │  compare · KPI strip · diversification   │
                   │      │  (all Category A: same math, shorter n)  │
                   │      └─────────────────────────────────────────┘
```

### Recommended module structure
```
src/lib/
├── scenario.ts              # computeScenario — add window path; keep union path for absent window
├── scenario-window.ts       # NEW: coverageSpanOf, defaultWindowFor, intersectionOf, covers
├── scenario-window.test.ts  # NEW: helper unit tests (boundary cells, empty intersection)
└── scenario.test.ts         # existing pins + new coverage-window cases; ONE union pin re-baselined
.planning/phases/55-.../
└── BLEND-07-verification.md  # NEW: 6-strategy numbers + numpy script (committed artifact)
```

### Pattern 1: Additive-optional field (the `leverage?` precedent — copy it exactly)
**What:** Add `window?: { start: string; end: string }` to `ScenarioState`, documented with a byte-compat doc-comment identical in spirit to the `leverage?` comment.
**When to use:** This is the mandated approach (CONTEXT locks it).
**Example (the precedent to mirror):**
```typescript
// Source: src/lib/scenario.ts:68-82 (the leverage? doc-comment)
  /**
   * R4 — optional per-strategy leverage multiplier ...
   * Additive + optional: a state without `leverage` is byte-identical to the
   * pre-R4 behaviour, so every `scenario.test.ts` pin holds unchanged.
   */
  leverage?: Record<string, number>;
```
The `window?` field gets the same treatment — but its byte-compat claim is *conditional*: a state without `window` is byte-identical ONLY on the union path, which is why absent-`window` must run the union code.

### Pattern 2: Top-of-function degenerate guard (the empty-state template)
**What:** The zero-member guard for BLEND-05 extends the existing `activeIds.length === 0` early-return.
**Example (the template to extend):**
```typescript
// Source: src/lib/scenario.ts:157-174 (existing zero-selected early-return)
  if (activeIds.length === 0) {
    return {
      n: 0, twr: null, /* ...all null... */
      equity_curve: [], effective_start: null, effective_end: null,
      portfolio_daily_returns: [],
    };
  }
```
The new guard computes members = `activeStrategies.filter(s => covers(coverageSpanOf(s), window))`; if `members.length === 0`, return this same empty-state shape (plus `member_count: 0, member_ids: []`). This runs BEFORE the day loop — never reach `activeWeightSum > 0 ? r/… : 0` (`scenario.ts:254`) with an empty member set (that branch fabricates a flat-zero curve — Pitfall 4).

### Pattern 3: Renormalize a DERIVED copy over members (weights source-of-truth)
**What:** The existing `normWeight` (`scenario.ts:181-182`) divides by `totalWeight` over the active set. Extend to divide by the weight mass of the MEMBER set only, preserving typed `state.weights`.
**Example (existing renorm to adapt):**
```typescript
// Source: src/lib/scenario.ts:177-182
  const totalWeight = activeStrategies.reduce((s, x) => s + (state.weights[x.id] ?? 0), 0);
  const normWeight = (id: string) =>
    totalWeight > 0 ? (state.weights[id] ?? 0) / totalWeight : 0;
```
New: compute `memberWeight` over `members` (not `activeStrategies`); never overwrite `state.weights`. On narrow-back a re-entering member gets its typed weight, then re-renormalizes (Pitfall 7).

### Anti-Patterns to Avoid
- **0-fill outside the member window** (`?? 0` on a non-member or outside `[winStart,winEnd]`) — reintroduces the exact tail dilution this phase kills. Build the per-strategy vector ONLY over the member window (Pitfall 3).
- **Coverage span from `start_date` / `"2022-01-01"` sentinel** — must come from the returns Map only (Pitfall 2). Grep-guard the sentinel absent from the coverage path.
- **Making intersection the unconditional default** — breaks every Category-C own-book caller. Gate on `state.window` presence.
- **Density test instead of coverage test** — coverage = span endpoints bracket the window; do NOT drop members with interior gaps (Pitfall 2).
- **Blind `--update-snapshots`** — banned; verify numpy first (Pitfall 8).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ISO-day interval / containment math | A `Date`-object comparison | Lexicographic `YYYY-MM-DD` string compare (`dateday.ts` convention) | `d.date >= from` already works throughout `scenario.ts`; `Date` objects reintroduce the UTC/local off-by-one `dateday.ts` exists to kill |
| Sample/252 Sharpe-Sortino-DD reference | A new metric implementation for BLEND-07 | numpy from-scratch (dev-only) + the metric FORMULAS already in `scenario.ts:331-378` | The formulas are pinned; BLEND-07 verifies the *series* is right, not re-derives the metric math |
| Weight renormalization | A fresh sum-to-1 pass in the adapter | The engine's own `r / activeWeightSum` renorm (extended to members) | Adapter renorm double-normalizes (`scenario-adapter.ts:211-216` explicitly warns against it) |
| Degenerate/empty guard | New null-handling | The existing early-return shape (`scenario.ts:157-174`) | Consumers already read `?? []` / null; reuse the exact shape |

**Key insight:** every primitive this phase needs already exists in the codebase — the work is *restructuring the axis and divisor*, not adding capability. The new `scenario-window.ts` is ~20 LOC of pure functions.

## Frozen-Spine Guards — mechanics + mechanical re-baseline (PARITY-03)

**Critical clarification the planner needs:** these are **git-DELTA guards**, not value-snapshot guards. Each reads `git diff --name-only <baseline-sha> HEAD` + `git ls-files --others` and asserts a frozen path is NOT in the changed set. They fail the instant `scenario.ts` is edited on a branch off their baseline — that IS the expected behavior this phase must handle.

| Guard file | What it pins (re: scenario) | Fires when scenario.ts changes? | Mechanical re-baseline |
|------------|------------------------------|--------------------------------|------------------------|
| `phase-29-frozen-spine-guards.test.ts:172-181` | `src/lib/scenario.ts` zero-diff vs base `a759022c` | **YES** (`.not.toContain("src/lib/scenario.ts")`) | Guard is scoped to the v1.2 phase-29 delta. Options: (a) advance its `FALLBACK_BASE_SHA` + rely on `merge-base origin/main` so the v1.5 branch's delta excludes it — but `merge-base` is HEAD-relative so it WILL still see scenario.ts. (b) **Convert the frozen-`scenario.ts` assertion to acknowledge the v1.5 deliberate edit** — the cleanest: change the assertion to permit `scenario.ts` (annotated `// v1.5 coverage-window re-baseline (ADR-001)`) while keeping the migration + RLS assertions live. Decide in-plan; option (b) matches "keep the guard live, re-baseline as reviewed act". |
| `phase-30-frozen-spine-guards.test.ts:149-170` | `scenario.ts` AND `scenario.test.ts` zero-diff vs `03d0699c` | **YES** (both) | Same as 29 — both scenario.ts and scenario.test.ts now legitimately change. Re-baseline both assertions with the annotation. |
| `phase-31-frozen-spine-guards.test.ts:174-195` | `scenario.ts` + `scenario.test.ts` zero-diff vs `94f36e4e` (PLUS the LAYOUT-02 hide-don't-unmount grep, UNCHANGED) | **YES** (frozen-engine assertions only) | Re-baseline the 2 frozen-engine assertions; **leave the LAYOUT-02 CompositionList wrap/no-conditional-mount assertions UNCHANGED** (Phase 55 doesn't touch the composer JSX). |
| `phase-32-frozen-spine-guards.test.ts:237-247` | `scenario.ts` zero-diff vs `b8a0337b` (PLUS FLOW-01/02/03 route assertions, UNCHANGED) | **YES** (frozen-engine assertion only) | Re-baseline the frozen-engine assertion; leave all FLOW route/redirect/delete assertions UNCHANGED. |
| `phase-52-frozen-spine-guards.test.ts:184-198` | 11 frozen islands incl. `scenario.ts` (line 155) — loops one assertion per island | **YES** for `scenario.ts` only | Remove/annotate `src/lib/scenario.ts` from the `FROZEN_ISLANDS` array (line 155) `// v1.5 coverage-window re-baseline (ADR-001)`; **the other 10 islands (compute.ts, factsheet-context, useBreakpoint, MC worker, EquityChart, TouchTooltip, useTapPin, 3 factsheet SVGs) STAY FROZEN** — Phase 55 must not touch them. This is a surgical one-line array edit. |

**Guards that stay UNCHANGED (do NOT touch):**
- `contracts-registry.test.ts` — registry-integrity guard; pins no scenario values. `scenario.ts` is not in `CONTRACT_GUARDS`. Stays green. (It DOES pin `sample-floor.test.ts` and `factsheet-context.codec.test.ts` existence — unaffected.)
- The LAYOUT-02 / FLOW-01…03 / route assertions inside phase-31/32 guards — Phase 55 touches no composer JSX, no routes.
- `phase-52` islands other than `scenario.ts`.

### The ONE numeric pin that moves: `scenario.test.ts:351-369`
```typescript
// Source: src/lib/scenario.test.ts:351-369 — "never 'shrinks' … to the overlap"
  it("never 'shrinks' the scenario window to the overlap when a late-inception strategy joins", () => {
    // ... stratB joins on day 40 ...
    expect(metrics.n).toBe(60);              // ← UNION behavior (the defect)
    expect(metrics.effective_start).toBe(dates[0]);
    expect(metrics.effective_end).toBe(dates[59]);
  });
```
This test **asserts the exact union-tail-dilution convention being replaced.** Its fate depends on whether the *default state* (no `window`) still runs union:
- If absent-`window` keeps union (recommended), this test STAYS GREEN AS-IS (it uses `defaultState`, no window). **The intersection behavior is a NEW test**, not a re-baseline of this one.
- The re-baseline work is therefore ADDITIVE: new coverage-window cases assert `n===20` / intersection **with an explicit `window`**, while the union pin above documents the preserved legacy path.

**Caveat for the planner:** if the plan instead makes intersection the unconditional default, THIS pin must be re-baselined to `n===20`, `effective_start===dates[40]` — but that cascades into Category-C breakage. The recommended design keeps this pin green and adds new intersection pins alongside it. Enumerate the old→new in SUMMARY regardless (Q4), even if "unchanged — union path preserved".

### `scenario-sample-ratios.test.ts` — single-strategy parity (stays green)
`scenario-sample-ratios.test.ts:94-117` runs `computeScenario` on a SINGLE-strategy scenario (weight 1, no window). Under any design, a single strategy over its own full range is unchanged (its coverage span == its data == the window). This test stays green — but VERIFY it, because it constructs `ScenarioState` without `window` and depends on the absent-window path.

## Runtime State Inventory

> This is a code-only compute rewrite — no stored data keys, no service config, no OS state. Included for completeness per the refactor-phase checklist.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | **None** — `computeScenario` is a pure client-side function; no database stores its output as a key/collection. Shared scenarios store a `ScenarioDraft` blob (Phase 59 adds the window field), but Phase 55 changes no persisted shape. | None this phase |
| Live service config | **None** — no external service embeds the blend convention. Shared links recompute-on-open (behavior changes at Phase 59, not here). | None this phase |
| OS-registered state | **None** — no scheduled task, pm2, or cron references the engine. | None this phase |
| Secrets/env vars | **None** — no env var names the convention. | None this phase |
| Build artifacts | **None** — pure TS, no compiled artifact carries the old convention. The Phase 60 golden PNGs / e2e baselines DO encode the old numbers, but re-baking them is explicitly Phase 60, NOT this phase (never in the math-change commit). | None this phase (Phase 60 owns goldens) |

**Nothing found in 4 of 5 categories — verified by grep across `src/`, `supabase/`, and config.** The single "artifact" (golden PNGs) is deliberately deferred to Phase 60.

## BLEND-07 Verification Harness

**Structure (Q3-locked):** a committed markdown artifact + a vitest gate.

1. **The dataset:** the 6-strategy blend — `mm / neon1 / pokeokx / uc244 + OKX + Bybit`. Prior OLD-convention empirical baseline (for contrast in the artifact): equal weight all 6 → total +586.86%, CAGR 51.82%, Sharpe 2.43, MaxDD −15.15%, n=1163 `[CITED: ADR-001:21 + CONTEXT specifics]`. The NEW window-bounded numbers WILL differ — that difference is the point; document both.
2. **Where the golden data lives / how to source it:** the 6-strategy series are real production strategies. The ADR verification session (2026-07-01) already computed the old numbers. For the artifact, the from-scratch numpy script needs the raw `date,daily_return` series per strategy. **Open question for the planner:** these can be sourced from (a) a committed fixture JSON of the 6 series (preferred — deterministic, no prod dependency, mirrors `analytics-service/tests/fixtures/` golden pattern), or (b) an authed prod pull (non-deterministic, avoid). Recommend committing a fixture of the 6 series' overlap window into the phase dir alongside `BLEND-07-verification.md`.
3. **The numpy script (from-scratch, dev-only):** loads the 6 series, computes the intersection window (`max(firsts), min(lasts)`), keeps only members that cover it (all 6 by construction of the max-overlap window, OR the subset that does), 0-fills interior gaps over the window, blends equal-weight (`Σ r / N`), then computes twr = ∏(1+r)−1, CAGR = (1+twr)^(252/n)−1, vol = std(ddof=1)·√252, Sharpe = mean·252/vol, MaxDD = min(equity/cummax−1). Record total/CAGR/Sharpe/MaxDD/n.
4. **The vitest gate:** load the same fixture, run `computeScenario` with an explicit `window = defaultWindowFor(...)`, assert `metrics.twr/cagr/sharpe/max_drawdown` match the numpy numbers AND `metrics.member_count === <live member count>`.
5. **"Floating-point precision" concretely:** match to the engine's own payload rounding (twr/cagr/vol/maxDD `.toFixed(5)`, sharpe/sortino `.toFixed(3)` per `scenario.ts:451-456`) — i.e. assert equality on the ROUNDED engine output vs the numpy value rounded to the same decimals, OR `toBeCloseTo` at 5 decimals for the raw comparison. The ADR's "matched to fp precision" (`ADR:21`) means the numpy and TS series agree before rounding to within ~1e-10; the committed artifact records the rounded payload numbers.
6. **Ordering (non-negotiable):** this artifact + gate are GREEN before Phase 60 bakes any golden. It is the #1 defense against a re-bake masking a regression (Pitfall 8, the milestone's highest risk).

## Sample-Floor Honesty on the Shorter Window (BLEND-05 adjacent)

Enumerate every sample-floor so the plan verifies each behaves honestly on the shorter intersection:

| Floor | Value | Location | Behavior on shorter window |
|-------|-------|----------|----------------------------|
| Engine `n < 10` early-return | 10 | `scenario.ts:210` | A window shorter than 10 trading days → null metrics + empty series. Honest. Must survive the coverage rewrite (interior guard preserved). |
| Overlapping-days floor | `SAMPLE_FLOOR_OVERLAPPING_DAYS = 60` | `sample-floor.ts:37` (single source, pinned by `sample-floor.test.ts`) | Benchmark render gates on `evaluateSampleFloor(betaN, 60)`; stress on `evaluateSampleFloor(varN/betaN, 60)`. Shorter window may drop below 60 → honest em-dash. Verify NOT a regression. |
| Stress `varN` | = `portfolioDaily.length` | `scenario-stress.ts:111` | Now the member-window length (shorter). |
| Stress `betaN` | = `bench.n` (BTC ∩ portfolio) | `scenario-stress.ts:124` | Shifts with the shorter portfolio window. |
| MC block-bootstrap floor | `evaluateSampleFloor` + block length | `scenario-montecarlo.ts:63` | Shorter series = fewer bootstrap days; guard block-length ≤ n; honest "insufficient history" not fabricated bands. |
| Correlation matrix (per pair) | `T > 1` | `scenario.ts:420` | Sample covariance needs T>1; a 1-member window has no pairs (`corrCount===0 → avg null`, `scenario.ts:431`). N=1 window: verify correlation panel degrades honestly. |

**Do NOT change any floor value** (they are pinned single-sources). The work is *verifying the floors gate honestly on the new, typically-shorter, window* — a metric that used to clear 60 and now shows em-dash is CORRECT, not a regression.

## Common Pitfalls

*(Full detail in `.planning/research/PITFALLS.md` — 17 pitfalls, 10 tagged 🔴 SILENT-WRONG. The five that live in THIS phase, condensed:)*

### Pitfall 1: Inclusive-boundary off-by-one on membership 🔴
**What goes wrong:** `<` vs `<=` on `winStart`/`winEnd` silently drops or admits the wrong strategy. Window is CLOSED `[winStart,winEnd]`; member iff `span.first <= winStart && span.last >= winEnd`.
**How to avoid:** Document the closed-window invariant in the `computeScenario` header (same way the file pins its 5 behaviors, `scenario.ts:15-44`). Unit-test 4 boundary cells: data starts/ends one day before / exactly on / one day after each bound. Assert `dates[0]===winStart`, `dates[n-1]===winEnd` for a member-only window.

### Pitfall 2: Coverage from fabricated metadata / `"2022-01-01"` leak 🔴
**What goes wrong:** Coverage computed from `start_date` or the `"2022-01-01"` sentinel (which predates every real dataset, `scenario.ts:195`, `scenario-adapter.ts:258`, `share-resolve.ts:177`) mislabels a ragged-head strategy as a member.
**How to avoid:** Compute `coverageSpanOf` EXCLUSIVELY from the returns Map (`[firstDateWithData, lastDateWithData]`). Grep-guard the sentinel absent from the coverage path (like the frozen-spine guards' grep pattern).

### Pitfall 3: 0-fill leaking outside the member window 🔴
**What goes wrong:** `?? 0` on a non-member or outside the window re-introduces the tail dilution.
**How to avoid:** Build the per-strategy vector ONLY over the member window; members bracket the window by definition, so an absent day is a true interior gap, not a tail. Test: member with one missing mid-window day stays a member, divisor unchanged, that day contributes 0.

### Pitfall 4: Empty-intersection ÷0 / fabricated flat-zero curve 🔴
**What goes wrong:** `activeWeightSum > 0 ? r/… : 0` (`scenario.ts:254`) emits a plausible flat 0% curve for a zero-member window instead of an empty state.
**How to avoid:** member-count-0 guard at the TOP (before the day loop), returning the empty-state shape + `member_count: 0`. Never reach the day loop with an empty member set. Single-member window computes honestly but Phase 57 owns the "1 strategy, not a blend" label.

### Pitfall 8: Golden re-bake masks a regression 🔴 (prevention lives HERE)
**What goes wrong:** Blind `--update-snapshots` in Phase 60 canonizes a Phase-55 math bug.
**How to avoid (this phase's job):** BLEND-07 numpy match recorded + green, unit tests green, frozen-spine re-baselined-not-deleted, BEFORE Phase 60. The independent number is the gate.

## Code Examples

### The current union/tail-dilution axis (what to REPLACE for the window path)
```typescript
// Source: src/lib/scenario.ts:199-255 — the defect
  const allDateSet = new Set<string>();
  for (const s of activeStrategies) {
    const from = strategyStart.get(s.id)!;
    for (const d of s.daily_returns) {
      if (d.date >= from) allDateSet.add(d.date);   // UNION, no end bound
    }
  }
  // ...
  for (let i = 0; i < n; i++) {
    for (const s of activeStrategies) {
      const from = strategyStart.get(s.id)!;
      if (commonDates[i] < from) continue;           // ENDED strategy still counts
      r += w * lev(s.id) * strategyReturns[s.id][i]; // (map.get(d) ?? 0) → 0 after end
      activeWeightSum += w;                           // ← dilutes the mean
    }
    portDaily[i] = activeWeightSum > 0 ? r / activeWeightSum : 0;  // fabricated 0
  }
```
For the window path: axis = dates in `[winStart,winEnd]`; loop over MEMBERS only; `activeWeightSum` = constant member weight mass; member-count-0 guarded above.

### The metrics block (UNCHANGED — do not touch the formulas)
```typescript
// Source: src/lib/scenario.ts:331-361 — 252-annualization pins (locked invariant)
  const twr = cumulative[n - 1] - 1;
  const years = n / 252;                              // 252-day basis (product-wide)
  const cagr = years > 0 ? Math.pow(1 + twr, 1 / years) - 1 : null;
  const variance = portDaily.reduce(...) / (n - 1);   // SAMPLE std (ddof=1)
  const volatility = volDaily * Math.sqrt(252);
  const sharpe = volatility > 0 ? (meanR * 252) / volatility : null;
```
Only the SERIES feeding this block changes; the block itself is frozen (parity-by-construction depends on it).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Union date axis + 0-fill tail + divisor = every started strategy | Coverage-window membership + constant divisor = member count | v1.5 Phase 55 (this) | Scenario blend is an honest mean of co-live strategies; ended members drop from divisor |
| Frozen `scenario.ts` (v1.2–v1.4, SCENARIO-05) | Deliberately edited under v1.5 with re-baselined guards | v1.5 Phase 55 | The ONE milestone that touches the frozen engine |

**Industry convention this matches** `[CITED: research SUMMARY]`: PortfolioVisualizer (auto-constrain to earliest common inception), quantstats/pyfolio (inner-join on common date index + dropna), GIPS composites (intersection-based alignment with disclosure). The differentiator is making the window an *interactive* control (Phases 57–58), not a silent clamp.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Absent-`window` should keep the UNION path (byte-compat for Category-C own-book callers) | Consumer Blast Radius §C | If the plan instead makes intersection the unconditional default, `queries.ts:2208/2356` own-book metrics silently change (live-drawer AUM/Sharpe/DD) and the `scenario.test.ts:351` union pin must be re-baselined to `n===20`. This is the single most important design decision — flagged as Open Question 1. |
| A2 | The 6-strategy BLEND-07 series should be committed as a deterministic fixture (not pulled from prod at test time) | BLEND-07 Harness | If pulled live, the gate is non-deterministic and can't run in CI hermetically. Recommend fixture; confirm in plan. |
| A3 | Re-baselining the phase-29/30 frozen-spine guards means editing the frozen-`scenario.ts` ASSERTION (option b), not advancing the baseline SHA | Frozen-Spine Guards | If the plan advances SHAs instead, `merge-base origin/main HEAD` still sees scenario.ts (HEAD-relative), so the assertion edit is the real fix. Low risk — both paths documented. |
| A4 | `member_ids: string[]` is worth adding alongside `member_count` (Q2 says both) | Standard Stack | Q2 explicitly locks both fields; no risk — additive. |
| A5 | The single-strategy `scenario-sample-ratios.test.ts` parity pin stays green under any design | Frozen-Spine Guards | A single strategy over its own range is window-invariant; verified by reading the test. Low risk. |

**If A1 is confirmed wrong** (product wants intersection everywhere), the blast radius grows to include the own-book live drawer — escalate before planning.

## Open Questions

1. **Absent-`window` default: union or intersection?** (The load-bearing decision.)
   - What we know: CONTEXT locks the *scenario-tab* default to intersection; `computeCompositeCurve` keeps union; `queries.ts` own-book callers have no window UI.
   - What's unclear: whether the ENGINE's behavior-when-`window`-absent is union (isolating new behavior to explicit-window callers) or intersection (requiring every own-book caller to opt out).
   - Recommendation: **absent-`window` = union path** (byte-compat shield). Scenario tab always passes an explicit `window` via `defaultWindowFor()`. Keeps the most pins green and does not touch the live drawer. Confirm in discuss/plan.

2. **BLEND-07 golden-data provenance** — commit a 6-series fixture (recommended, deterministic) vs authed prod pull (avoid). See A2.

3. **Frozen-spine re-baseline mechanism** — edit the frozen-`scenario.ts` assertion in each guard (recommended) vs advance baseline SHAs. See A3. Both keep the guard live; the assertion edit is cleaner and matches "reviewed act".

4. **`share-resolve.ts` this phase vs Phase 59** — confirm Phase 55 leaves share-resolve untouched (window absent → union, byte-compat) and Phase 59 (PERSIST-02) wires the shared `defaultWindowFor()`. The shared helper must EXIST after Phase 55 so Phase 59 can import it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| vitest | All unit tests + guards | ✓ | ^4.1.2 `[VERIFIED: package.json]` | — |
| numpy (analytics-service venv) | BLEND-07 from-scratch script (run-once, dev) | ✓ | analytics-service Python venv `[VERIFIED: numpy golden-fixture precedent in analytics-service/tests/]` | Pure-Python reference (slower, still valid) |
| git | Frozen-spine delta guards | ✓ | (repo) | None needed |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None material.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.2 `[VERIFIED: package.json:70]` |
| Config file | `vitest.config.ts` (coverage thresholds pinned there) |
| Quick run command | `npx vitest run src/lib/scenario.test.ts src/lib/scenario-window.test.ts` |
| Full suite command | `npm test` (`vitest run`) |
| Coverage gate | `npm run test:coverage` — lines 82 / stmts 80 / fns 74 / br 72 (blocking CI) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BLEND-01 | Engine accepts `state.window`, blends over it | unit | `npx vitest run src/lib/scenario.test.ts -t "window"` | ❌ Wave 0 (new cases) |
| BLEND-02 | Member iff covers window; ended strategy excluded; 4 boundary cells | unit | `npx vitest run src/lib/scenario-window.test.ts` | ❌ Wave 0 (new file) |
| BLEND-03 | Interior gap 0-filled, member + divisor unchanged | unit | `npx vitest run src/lib/scenario.test.ts -t "interior gap"` | ❌ Wave 0 |
| BLEND-04 | Weighted renorm over surviving members; narrow-back restores typed weight | unit | `npx vitest run src/lib/scenario.test.ts -t "renorm"` | ❌ Wave 0 |
| BLEND-05 | Zero-member window → empty-state, no ÷0 | unit | `npx vitest run src/lib/scenario.test.ts -t "empty"` | ❌ Wave 0 |
| BLEND-06 | `member_count`/`member_ids`/effective window/N in output | unit | `npx vitest run src/lib/scenario.test.ts -t "member_count"` | ❌ Wave 0 |
| BLEND-07 | Blend == numpy over max-overlap; divisor == member count | unit (golden) | `npx vitest run src/lib/scenario-blend07.test.ts` | ❌ Wave 0 (new file + fixture + artifact) |
| PARITY-02 | Consumers correct on shorter window; stale comments cleared | existing suites + grep | `npm test` (benchmark/stress/MC/compare suites) | ✅ existing (re-run) |
| PARITY-03 | Frozen-spine guards re-baselined; no-invented-data/252/WCAG green | guard suites | `npx vitest run src/__tests__/phase-{29,30,31,32,52}-frozen-spine-guards.test.ts` | ✅ existing (re-baseline in-place) |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/scenario.test.ts src/lib/scenario-window.test.ts`
- **Per wave merge:** `npm test` (full suite — includes all 12 consumers + 5 guards)
- **Phase gate:** full suite + `npm run test:coverage` green before `/gsd:verify-work`; BLEND-07 numpy artifact committed and its gate green BEFORE any Phase 60 activity.

### Wave 0 Gaps
- [ ] `src/lib/scenario-window.ts` + `src/lib/scenario-window.test.ts` — new helper + boundary-cell tests (BLEND-02)
- [ ] New coverage-window cases in `src/lib/scenario.test.ts` — ended-tail no-dilution, divisor==member count, single-member, interior-gap 0-fill, empty-intersection, weighted renorm-after-drop, narrow-back typed-weight restore (BLEND-01…06)
- [ ] `src/lib/scenario-blend07.test.ts` + a committed 6-series fixture + `BLEND-07-verification.md` artifact (BLEND-07)
- [ ] Frozen-spine guard re-baselines (edit frozen-`scenario.ts` assertions in phases 29/30/31/32, remove scenario.ts from phase-52 `FROZEN_ISLANDS`), each annotated `// v1.5 coverage-window re-baseline (ADR-001)`
- Framework: already installed — no install task.

## Security Domain

> `security_enforcement` is absent in config.json (= enabled). This phase is a pure client-side compute-math rewrite with NO auth, session, access-control, input-boundary, or crypto surface. ASVS applicability is therefore minimal; the one relevant control is the `no-invented-data` / leak invariants, covered below.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface touched |
| V3 Session Management | no | No session surface |
| V4 Access Control | no | (Share-link leak-scoping is Phase 59 `get_shared_scenario` RPC — untouched here) |
| V5 Input Validation | partial | Engine already defends non-finite/negative leverage + catastrophic-day (`scenario.ts:302-329`); the new coverage path must preserve these guards and never fabricate data (`no-invented-data`) |
| V6 Cryptography | no | None |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Fabricated flat-zero curve read as real performance (empty-member window) | Information disclosure (misleading) | member-count-0 empty-state guard (BLEND-05) — never a zeroed curve |
| Tail-dilution understating a blend (the defect) | (data honesty) | Coverage-window membership — the whole phase |
| Share-link recompute drift / cross-tenant leak | Information disclosure | Out of scope here; Phase 59 (PERSIST-02). Phase 55 leaves `share-resolve` on the byte-compat union path (window absent) |

## Sources

### Primary (HIGH confidence — read in full at HEAD)
- `src/lib/scenario.ts` — the engine to rewrite; union/0-fill/divisor at :199-255, metrics :331-378, degenerate gates :157-174/:210/:312, output shape :85-129, `leverage?` precedent :68-82
- `src/lib/scenario.test.ts` — the value pins; the union "never shrinks to overlap" pin :351-369, leverage/degenerate/portfolio_daily_returns cases
- `src/__tests__/phase-{29,30,31,32,52}-frozen-spine-guards.test.ts` — git-delta guard mechanics; frozen `scenario.ts` assertions; phase-52 `FROZEN_ISLANDS` :155
- `src/lib/scenario-sample-ratios.test.ts` — single-strategy parity pin :94-152
- `src/__tests__/contracts/contracts-registry.test.ts` — registry-integrity guard (unaffected)
- `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts:8-15` — the "zero-filled UNION" stale comment
- `src/app/(dashboard)/allocations/lib/scenario-compare.ts:27-29` + `ScenarioCompareTable.tsx:19-20` — heterogeneous-window stale comments
- `src/app/(dashboard)/allocations/lib/scenario-stress.ts:41-44,111,124` — varN/betaN two-N distinction + sample-floor
- `src/app/(dashboard)/allocations/lib/scenario-montecarlo.ts:13-63` — block-bootstrap + floor
- `src/app/scenario-share/[token]/share-resolve.ts:150-196` — recompute-on-open, `"2022-01-01"` fallback, no window param today
- `src/lib/queries.ts:2200-2360` — the Category-C own-book `computeScenario` call sites
- `src/lib/scenario-adapter.ts:195-262` — RAW-weight (no double-renorm) convention
- `src/lib/dateday.ts` + `src/lib/sample-floor.ts:37` — interval math + the 60-day single-source floor
- `.planning/SCENARIO-COVERAGE-WINDOW-ADR.md` — the design, target algorithm :85-101, options, consequences
- `.planning/phases/55-.../55-CONTEXT.md` — locked decisions + accepted Q1–Q4 approaches
- `.planning/research/SUMMARY.md` + `PITFALLS.md` — 17 pitfalls, the golden-re-bake-masks-regression risk

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` + `.planning/STATE.md` — requirement IDs, accumulated context, invariants

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new deps confirmed against repo; vitest/dateday/numpy all present
- Consumer blast radius: HIGH — every consumer grepped + read at file:line; Category-C own-book callers surfaced (a real risk the milestone research under-emphasized)
- Frozen-spine guards: HIGH — read all 5; confirmed they are git-DELTA (not value-snapshot) guards; the ONE numeric pin (`scenario.test.ts:351`) identified precisely
- BLEND-07 harness: MEDIUM-HIGH — structure clear; golden-data provenance (fixture vs prod pull) is the one open detail
- Pitfalls: HIGH — grounded in the actual code + the milestone PITFALLS research

**Research date:** 2026-07-01
**Valid until:** 2026-07-31 (stable — internal codebase, no fast-moving external deps)
