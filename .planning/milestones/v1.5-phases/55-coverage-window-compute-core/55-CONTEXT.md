# Phase 55: Coverage-Window Compute Core - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — all product decisions pre-locked by ADR-001 + REQUIREMENTS kickoff; user accepted all 4 residual implementation-approach recommendations.

<domain>
## Phase Boundary

Rewrite the FROZEN `src/lib/scenario.ts` `computeScenario` engine to blend over an
explicit **coverage window** with a **constant, honest divisor**: a strategy is a
blend member iff `enabled AND its data span ⊇ the window`, so an ended strategy
contributes nothing and no longer divides the mean (kills the tail dilution). The
engine output exposes the divisor (`member_count`, effective `[winStart,winEnd]`,
`N`) so consumers read it rather than infer it. Every downstream consumer (~12) is
re-verified on the shorter window, and the SCENARIO-05 zero-diff + phase-{29,30,31,
32,52} frozen-spine guards are re-baselined **as a reviewed act**.

**In scope (BLEND-01…07, PARITY-02, PARITY-03):** the compute engine, the shared
coverage-window helper, the from-scratch numpy verification artifact, the consumer
re-verify + stale-comment cleanup, and the guard re-baseline.

**Out of scope (later phases):** UI window control / auto-toggle state machine
(Phase 57), coverage legibility UI (Phase 58), persistence/schema bump (Phase 59),
golden/e2e re-bake (Phase 60 — never in the same commit that changes the math),
authed QA canary (Phase 61). Factsheet parity **assertion** is Phase 56 (this phase
must not break it, but the single-source guard lands in 56). `computeCompositeCurve`
(My-Allocation overlay) keeps union behavior — not a scenario-tab consumer.

</domain>

<decisions>
## Implementation Decisions

### Product decisions (LOCKED at kickoff — ADR-001 + REQUIREMENTS)
- **REPLACE the convention, not an additive mode.** No second code path; the
  tail-dilution "all-started / no-end-bound / 0-fill tail / divisor = every started
  strategy" convention is removed (ADR Option A chosen; Options B ragged per-date
  divisor and C additive-aligned-mode rejected).
- **Membership = `enabled AND coverageSpan ⊇ [winStart,winEnd]`.** Divisor counts
  members only and is **constant** across the window (window-fixed membership).
- **Interior mid-window gaps stay 0-filled** (documented deliberate simplification;
  keeps the divisor constant; interior gaps rare for daily series). No interior-gap
  density floor this milestone (BLEND-F2 deferred to v2).
- **Weighted (non-equal) blends renormalize** surviving members' weights to sum-to-1
  after a coverage drop; typed `weights` stay the source of truth (ephemeral renorm).
- **Zero-member window → honest empty-state** — no divide-by-zero, no fabricated
  zeros (`no-invented-data` preserved).
- **`window?: { start; end }` is a new OPTIONAL field on `ScenarioState`** — additive,
  positional signature of `computeScenario(strategies, state, dateMapCache)`
  UNCHANGED (mirrors the R4 `leverage?` precedent).
- **ABSENT `window` → UNION behavior (byte-compat); PRESENT `window` → coverage-window
  membership.** (LOAD-BEARING, resolved from 55-RESEARCH Open-Q1 + REQUIREMENTS
  out-of-scope note.) `computeScenario` is called in THREE contexts and only the
  scenario tab is a coverage-window consumer: `queries.ts:2208` and `:2356` compute
  the allocator's **own live book** (no window UI) and MUST keep union behavior —
  changing them would silently alter the live drawer's displayed metrics (unrequested
  scope creep). So the engine keeps its current union math when `window` is absent
  (every own-book caller + `computeCompositeCurve` stay byte-identical), and the
  **scenario tab ALWAYS passes an explicit `window`** derived via `defaultWindowFor()`
  (intersection). This is the additive-optional `leverage?` precedent applied exactly:
  absent = old behavior. It also means the `scenario.test.ts` "never shrinks to the
  overlap" pin (:351-369) STAYS GREEN — intersection behavior is a NEW additive test,
  not a re-baseline. "REPLACE not additive" (REQUIREMENTS) governs the *scenario-tab
  blend convention*, not every `computeScenario` caller.
- **`coverageSpan` derived INSIDE the engine** from the returns maps — never plumbed
  through the adapter, never from the `"2022-01-01"` sentinel.
- **Window is a compute INPUT applied inside the engine**, never a factsheet chart
  view-clamp (else KPI strip / stress / benchmark / MC de-sync from the factsheet).
- LOCKED invariants that must stay green: `no-invented-data`, **252-day annualization**
  product-wide, factsheet **parity-by-construction**, WCAG-AA floor, no share-link
  leak.

### Residual engineering choices (user accepted all 2026-07-01)
- **Q1 — Shared helper location:** new pure module `src/lib/scenario-window.ts`
  exporting `coverageSpanOf()`, `defaultWindowFor()` (intersection = latest-start …
  earliest-end), and `intersectionOf()`. Zero new deps (reuse `dateday.ts` + the
  already-sorted return series). Composer, share-resolve, and compare all import
  this ONE helper so the window is derived identically everywhere (PERSIST-02
  precondition). Mirrors the existing separate `scenario-benchmark.ts` /
  `scenario-compare.ts` libs.
- **Q2 — Engine output shape:** extend `ComputedMetrics` **additively** with
  `member_count: number` and `member_ids: string[]`; reuse the existing
  `effective_start` / `effective_end` for the effective `[winStart,winEnd]` and the
  existing `n` for `N` (trading days). Additive + optional-friendly, mirroring the
  `leverage` / `portfolio_daily_returns` additive precedent; external
  `ComputedMetrics` construction sites (`liveBaselineToComputedMetrics`,
  `NULL_METRICS`) read new fields with defaults and need no edit.
- **Q3 — BLEND-07 verification artifact:** a committed markdown artifact (the
  6-strategy dataset numbers — total/CAGR/Sharpe/MaxDD/n — plus the from-scratch
  numpy script that produced them) **plus** a vitest test asserting `computeScenario`
  matches to floating-point precision over the max-overlap window, with
  `divisor == live-member count`. Durable record + CI-enforced. Recorded BEFORE any
  golden re-bake (which is Phase 60).
- **Q4 — Frozen-spine guard re-baseline:** re-baseline IN THE SAME phase-55 commit,
  each change annotated `// v1.5 coverage-window re-baseline (ADR-001)`, with the
  edits enumerated in the phase SUMMARY. **Never** a blind `--update-snapshots`.
  **Mechanics (clarified by 55-RESEARCH):** the `phase-{29,30,31,32,52}` guards are
  git-DELTA guards — each asserts `src/lib/scenario.ts` is NOT in the changed-file set
  vs a per-phase baseline SHA (they fire the moment `scenario.ts` is touched, by
  design). Re-baselining = editing the frozen-`scenario.ts` assertion in each guard
  (annotated), and for phase-52 removing `scenario.ts` from the `FROZEN_ISLANDS` array
  (~:155) while leaving the other ~10 islands frozen. The LAYOUT-02/FLOW route
  assertions inside phases 31/32 stay UNCHANGED (no composer/route edits this phase).
  Under the union-when-absent design, the one movable numeric pin
  (`scenario.test.ts:351-369`) STAYS GREEN; new intersection behavior lands as
  additive tests. Confirm against 55-RESEARCH's exact guard inventory before editing.

### Claude's Discretion
- Exact internal factoring of `computeScenario` (helper decomposition, variable
  naming) so long as the positional signature and the additive output contract hold.
- Exact factoring of the coverage-window blend path INSIDE `computeScenario` (the
  present-`window` branch). The scenario tab derives the window via `defaultWindowFor()`
  (intersection of selected+enabled spans) and passes it in explicitly — NOT the
  `"2022-01-01"` sentinel and NOT computed from the union. (The absent-`window` union
  path is fixed above, not discretionary.)
- Unit-test decomposition beyond the mandated cases (ended-tail no-dilution;
  divisor == member count; single-member window; internal-gap 0-fill;
  empty-intersection empty-state; weighted renorm-after-drop).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/scenario.ts` (586 lines) — the sole blend engine. `ScenarioState`
  (`selected`, `weights`, `startDates`, optional `leverage`) at :64; `ComputedMetrics`
  at :85 (has `effective_start`/`effective_end`, `n`, `portfolio_daily_returns?`,
  `equity_curve`); `computeScenario(strategies, state, dateMapCache)` at :149;
  `buildDateMapCache` at :137. Two degenerate early-returns already exist
  (activeIds==0 at :157; n<10 at :210) — the zero-member empty-state extends this.
- `src/lib/dateday.ts` — date helpers (reuse for span/intersection math; no new deps).
- The R4 `leverage?` field (:82) is the exact precedent for adding `window?`
  additively without breaking the positional signature or existing pins.

### Current convention (the defect, to REPLACE)
- Date axis = **union** of every active strategy's dates ≥ its own include-from
  (`allDateSet`, :199-208).
- `strategyStart` uses `startDates[id] ?? start_date ?? "2022-01-01"` sentinel (:195).
- Per-day: a strategy counts in `activeWeightSum` iff `commonDates[i] >= from`
  (:246) — but an **ended** strategy stays counted (its dates ≥ from) while
  `map.get(d) ?? 0` yields 0 after its end → **it divides the mean toward zero**
  (:251-254). This is the tail dilution to kill.

### Consumers to re-verify on the shorter window (PARITY-02, ~12)
`scenario-adapter.ts`, `scenario-montecarlo.ts`, `StressVarSection.tsx`,
`ScenarioBenchmarkSection.tsx` + `scenario-benchmark.ts`, `ScenarioCompareTable.tsx`
+ `scenario-compare.ts`, `KpiStrip.tsx`, `MonteCarloSection.tsx`,
`ScenarioComposer.tsx`, `scenario-share/[token]/share-resolve.ts`. The latent
**union-window** assumptions + stale "zero-filled tail" header comments in
`scenario-benchmark.ts` / `scenario-compare.ts` / `ScenarioCompareTable.tsx` must be
cleared. Each consumer reads the engine's output series (no bespoke blend math) — but
sample-floors must stay honest on the shorter window.

### Frozen-spine guards to re-baseline (PARITY-03)
`src/__tests__/phase-{29,30,31,32,52}-frozen-spine-guards.test.ts` +
`src/lib/scenario-sample-ratios.test.ts` + contracts registry. SCENARIO-05 zero-diff
pin. Re-baseline in-commit, annotated, enumerated in SUMMARY (per Q4).

### Established Patterns
- Additive-optional field convention with a doc-comment explaining byte-compat
  (see `leverage?` and `portfolio_daily_returns?`).
- Cumulative-RETURN vs wealth-form convention (NEW-C18-09): `computeScenario` is the
  only producer of return-form `equity_curve` / `portfolio_daily_returns`; consumers
  needing wealth convert via `toWealth()`. Do NOT regress this.
- Golden-fixture test convention already used across the repo (BLEND-07 artifact fits).

### Integration Points
- `scenario-adapter.ts` builds `StrategyForBuilder[]` + `ScenarioState` from server
  data — coverage spans are derived inside the engine, NOT added to the adapter.
- Client `/allocations` scenario tab runs `computeScenario` client-side.

</code_context>

<specifics>
## Specific Ideas

- **BLEND-07 golden dataset:** the 6-strategy blend (mm / neon1 / pokeokx / uc244 +
  OKX + Bybit). Under the new convention, the blend over the **max-overlap window of
  the selected set** must match a fresh from-scratch numpy computation to fp
  precision, with `divisor == live-member count`. This artifact is the gate that
  proves the new math is correct BEFORE Phase 60 re-bakes the goldens — the #1
  defense against a re-bake masking a regression (highest-risk pitfall per PITFALLS).
- Prior empirical baseline (OLD convention, for contrast in the artifact): equal
  weight all 6 → total +586.86%, CAGR 51.82%, Sharpe 2.43, MaxDD −15.15%, n=1163.
  The NEW window-bounded numbers will differ and that difference is the whole point —
  document both.
- Factsheet parity: this phase must not break the `compute.ts`-on-`computeScenario`-
  series contract; the single-source-of-truth **assertion** guard is Phase 56.

</specifics>

<deferred>
## Deferred Ideas

- **BLEND-F1** (v2): correlation matrix over mutually-present days instead of
  0-filled-union vectors. The correlation matrix in this phase stays on the existing
  basis unless a consumer re-verify surfaces a concrete correctness break.
- **BLEND-F2** (v2): interior-gap density floor ("too sparse to be honest"). Interior
  gaps stay 0-filled with no threshold this milestone.
- **VENUE-F1** (v2): cross-venue calendar normalization / per-asset annualization.
  252 stays the universal basis.
- UI, persistence, and golden re-bake — later phases (57 / 59 / 60), out of scope here.

</deferred>
