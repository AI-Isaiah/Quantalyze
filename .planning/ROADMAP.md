# Roadmap: Quantalyze

## Milestones

- ✅ **v1.0.0 — API-Key Rewrite** — Phases 15–20 (shipped 2026-06-20) — [archive](milestones/v1.0.0-ROADMAP.md)
- 📋 **v1.1.0 — Scenario Analysis** — Phases 21–28 (active) — see below

## Overview

v1.1.0 turns the already-built scenario **draft engine** (R4 leverage + H-0133 weight
plumbing shipped in PR #493) into a complete, honest scenario-analysis product. The
journey: first make scenarios **visible** and frame them honestly (surfacing tabs,
correlation heatmap, "PROJECTED — hypothetical" framing); land the cross-cutting
**methodology-disclosure + minimum-sample gate** scaffolding that keeps the heavy quant
features inside the no-invented-data invariant; build the **persistence spine** (save /
load / manage / compare) that sharing and benchmark comparison read from; add **benchmark
comparison** and **read-only sharing** (the RLS-leak-guarded public path); then land the
heavy / high-false-confidence trio **last, on top of the honesty scaffolding** —
**stress/VaR**, **monte-carlo confidence bands**, and the **weight optimizer** (the single
new Python analytics-service endpoint). Everything is additive client-TS over the frozen
`computeScenario` engine except the optimizer, which carries a TS↔Python parity test +
Railway deploy.

## Phases

**Phase Numbering:**
- Integer phases (21, 22, 23…): Planned milestone work (continues from v1.0.0's Phase 20 — no reset)
- Decimal phases (e.g. 23.1): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 21: Surfacing, Correlation & Honest Projection** - Make scenarios reachable, show the correlation heatmap, and lock the "PROJECTED — hypothetical" framing (already-designed, client-only foundation) (completed 2026-06-21)
- [x] **Phase 22: Methodology-Honesty Scaffolding** - Per-stat method/overlap-N/horizon disclosure + a shared minimum-sample gate the heavy quant phases reuse (completed 2026-06-21)
- [ ] **Phase 23: Scenario Persistence & Compare** - Save / reopen / list / rename / delete named scenarios (DB + RLS + `schema_version`) and compare 2+ side-by-side (the spine)
- [ ] **Phase 24: Benchmark Comparison** - Overlay a benchmark on the scenario projection with tracking error / information ratio / alpha-beta over the aligned window
- [ ] **Phase 25: Read-Only Sharing** - Generate / revoke a read-only share link that renders a saved scenario without leaking the live book or any other tenant's data
- [ ] **Phase 26: Stress Testing & VaR** - Parameterized β-propagated market shock + a disclosed downside measure (historical VaR + CVaR / Expected Shortfall)
- [ ] **Phase 27: Forward Uncertainty (Monte-Carlo Bands)** - Block-bootstrap forward confidence bands / return distribution, honest to sample size, gated below the minimum-sample floor
- [ ] **Phase 28: Weight Optimizer** - Python analytics-service min-vol / max-Sharpe solver (Ledoit-Wolf shrinkage, long-only, write-to-draft-only) with TS↔Python parity pinned

## Phase Details

### Phase 21: Surfacing, Correlation & Honest Projection
**Goal**: Allocators can find and read the scenario surfaces, see honest pairwise correlation, and the projection is unambiguously framed as hypothetical.
**Depends on**: Nothing (first phase of this milestone; builds on the shipped draft engine)
**Requirements**: SURF-01, SURF-02, SURF-03, CORR-01, CORR-02, CORR-03, CORR-04, IMPACT-01, IMPACT-02
**Success Criteria** (what must be TRUE):
  1. An allocator reaches the own-book Scenario tab from the visible dashboard tablist (not only via `?tab=scenario`), and reaches the example-universe Strategy Sandbox from the sidebar — while a manager or admin sees no Sandbox entry.
  2. The Strategy Sandbox is visibly labeled "Strategy Sandbox" with an "Example universe" badge, so it is never confused with the own-book Scenario tab.
  3. A scenario with ≥2 active strategies shows a pairwise correlation heatmap labeled by de-aliased strategy name, with average pairwise correlation shown once as "Avg |ρ|" reconciled with the KPI strip; with >10 strategies it discloses that it shows the 10 most-correlated.
  4. A single-holding or <10-overlapping-day scenario renders an honest empty state for correlation — never a 1×1 grid or a fabricated number.
  5. The projection is persistently framed "PROJECTED — hypothetical, not your live book" with coverage caveats (N overlapping days, shortest history), and never peer-ranks or shows allocator/peer-percentile panels on the blend — locked by a neuter-check regression test.
**Plans**: 4 plans in 2 waves
  - [x] 21-01-PLAN.md — Surfacing: visible Scenario tab + allocator-only Strategy Sandbox sidebar link (SURF-01/02/03) [wave 1]
  - [x] 21-02-PLAN.md — Correlation presentational: show-all heatmap + honest empty states + Avg |ρ| relabel + shortestHistoryName helper (CORR-02/03/04) [wave 1]
  - [x] 21-03-PLAN.md — Own-book composer: heatmap mount + PROJECTED badge/caveat + R3 neuter guard (CORR-01, CORR-03, IMPACT-01/02) [wave 2]
  - [x] 21-04-PLAN.md — Strategy Sandbox: Example-universe + PROJECTED framing + Avg |ρ| relabel + neuter guard (SURF-03, CORR-03, IMPACT-01/02) [wave 2]
**UI hint**: yes

### Phase 22: Methodology-Honesty Scaffolding
**Goal**: Every projected statistic discloses how it was computed, and a single shared sample-floor gate exists for the distributional/tail features to reuse.
**Depends on**: Phase 21
**Requirements**: HONEST-01, HONEST-02
**Success Criteria** (what must be TRUE):
  1. Every projected stat surfaces its method, overlapping-N, and horizon inline (e.g. "Historical bootstrap · 412 overlapping days · not a forecast").
  2. A shared minimum-sample gate (tunable floor, conservative default for distributional/tail outputs) renders an honest empty state below the floor, and is the single gate later reused by Stress and Monte-Carlo (one source of truth, regression-pinned).
  3. A deliberately degenerate input (0/1 strategy, below-floor overlap, non-finite returns) produces the honest empty state, never a fabricated number or false-precision output.
**Plans**: 2 plans
Plans:
- [x] 22-01-PLAN.md — HONEST-01: fold the methodology line ("Historical realized · {N} overlapping days · not a forecast") into both the composer + sandbox coverage caveats
- [x] 22-02-PLAN.md — HONEST-02: build the shared sample-floor primitive (SAMPLE_FLOOR_OVERLAPPING_DAYS=60 + gate), the below-floor honest empty state, and the single-source regression pin
**UI hint**: yes

### Phase 23: Scenario Persistence & Compare
**Goal**: Allocators can durably save named scenarios, reopen them into the composer, manage the list, and compare 2+ scenarios (and the live book) side-by-side.
**Depends on**: Phase 21
**Requirements**: PERSIST-01, PERSIST-02, PERSIST-03, PERSIST-04
**Success Criteria** (what must be TRUE):
  1. An allocator saves a named scenario to the database storing the `ScenarioDraft` JSONB (refs + weights + leverage + added strategies + `schema_version`) and never the raw return series — and only sees their own scenarios (RLS-scoped).
  2. An allocator reopens a saved scenario and it rehydrates into the composer, re-resolving return series from the live payload and surfacing the existing fingerprint-mismatch banner when holdings drifted (never a silent recompute over a changed strategy set).
  3. An allocator lists, renames, and deletes their saved scenarios.
  4. An allocator compares 2+ saved scenarios (and the live book) side-by-side, ranked by Sharpe / return improvement, with each scenario's overlap window and N stamped and any degenerate scenario showing an honest em-dash rather than a fabricated 0.
**Plans**: TBD
**UI hint**: yes

### Phase 24: Benchmark Comparison
**Goal**: An allocator can see how the scenario projection performed against a benchmark over the aligned overlap window, with the standard active-return metrics.
**Depends on**: Phase 23
**Requirements**: BENCH-01
**Success Criteria** (what must be TRUE):
  1. The scenario projection overlays a benchmark series (reusing `benchmark_prices` / `benchmark.py`) aligned to the scenario's common-overlap window.
  2. The comparison surfaces tracking error, information ratio, and alpha-beta computed over that aligned window, using the product-wide 252-day annualization (no √365 / monthly path).
  3. When the benchmark series does not cover the scenario window (or is missing), an honest "benchmark comparison unavailable" empty state renders instead of a mismatched-window comparison.
**Plans**: TBD
**UI hint**: yes

### Phase 25: Read-Only Sharing
**Goal**: An allocator can share a saved scenario read-only via a revocable link, and a recipient sees the blend without any exposure of the allocator's live book or another tenant's data.
**Depends on**: Phase 23
**Requirements**: SHARE-01, SHARE-02, SHARE-03
**Success Criteria** (what must be TRUE):
  1. An allocator generates a read-only share link for a saved scenario (unguessable ≥128-bit token / `share_id`, separate from the row PK).
  2. A recipient opens the link and sees the scenario's projection and correlation read-only, resolved only for the draft-referenced strategies via a token-scoped SECURITY DEFINER read path — never `getMyAllocationDashboard`, never holdings/AUM/api_keys, never another tenant's content (proven by a test that fetches as anon and as a different tenant and asserts zero sensitive fields).
  3. An allocator revokes a share link and the public route stops resolving it immediately (the share route is dynamic / never cached).
**Plans**: TBD
**UI hint**: yes

### Phase 26: Stress Testing & VaR
**Goal**: An allocator can apply a parameterized, β-propagated market shock and see a properly disclosed downside risk measure.
**Depends on**: Phase 22
**Requirements**: STRESS-01, STRESS-02
**Success Criteria** (what must be TRUE):
  1. An allocator applies a parameterized shock (e.g. "BTC −30%") that propagates through each strategy's data-derived β to the shocked factor — a near-market-neutral strategy shows a near-zero hit, not the full shock — and sees the projected impact, with the shock's assumptions disclosed.
  2. An allocator sees a downside risk measure showing historical VaR plus CVaR / Expected Shortfall, with method, window, confidence level, and N disclosed inline — never a bare VaR number.
  3. The downside metrics scale correctly with leverage (VaR/ES/drawdown are not treated as scale-invariant), and below the Phase 22 minimum-sample floor the stress/VaR outputs render the honest empty state.
**Plans**: TBD
**UI hint**: yes

### Phase 27: Forward Uncertainty (Monte-Carlo Bands)
**Goal**: An allocator sees forward confidence bands / a return distribution whose width is honest to sample size and which never implies precision the data can't support.
**Depends on**: Phase 22
**Requirements**: SIM-01
**Success Criteria** (what must be TRUE):
  1. An allocator sees forward confidence bands / a return distribution produced by a block bootstrap resampled jointly across strategies (preserving contemporaneous correlation and autocorrelation), with no Normal-tail assumption.
  2. Band width is honest to sample size — short histories produce visibly wider bands with explicit copy — and the chart surfaces the method, path count, and overlapping-N.
  3. Below the Phase 22 minimum-sample floor the bands are not rendered — an honest empty state appears instead — and the simulation runs off the main thread without freezing the UI.
**Plans**: TBD
**UI hint**: yes

### Phase 28: Weight Optimizer
**Goal**: An allocator can request suggested weights for an objective and apply them to the draft, with the optimizer's in-sample nature disclosed and TS↔Python convention parity guaranteed.
**Depends on**: Phase 22
**Requirements**: OPT-01, OPT-02
**Success Criteria** (what must be TRUE):
  1. An allocator requests suggested weights (min-vol default; max-Sharpe gated + caveated) computed by the Python analytics-service, long-only with Ledoit-Wolf covariance shrinkage — and the suggested weights write to the editable draft only, never auto-committing.
  2. The optimizer output discloses its in-sample caveat and the overlap window it was fit on, and gates to an honest empty state when overlapping observations are insufficient relative to strategy count (degenerate input → no weights).
  3. The optimizer is deterministic (identical input → identical weights; a 1-day data extension moves weights by < a few percent) and TS↔Python convention parity (252 annualization, n-gates, null semantics) is pinned by a golden-fixture parity test.
**Plans**: TBD
**UI hint**: yes

## Progress

**Execution Order:**
Phases execute in numeric order: 21 → 22 → 23 → 24 → 25 → 26 → 27 → 28

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 21. Surfacing, Correlation & Honest Projection | 4/4 | Complete    | 2026-06-21 |
| 22. Methodology-Honesty Scaffolding | 2/2 | Complete   | 2026-06-21 |
| 23. Scenario Persistence & Compare | 0/TBD | Not started | - |
| 24. Benchmark Comparison | 0/TBD | Not started | - |
| 25. Read-Only Sharing | 0/TBD | Not started | - |
| 26. Stress Testing & VaR | 0/TBD | Not started | - |
| 27. Forward Uncertainty (Monte-Carlo Bands) | 0/TBD | Not started | - |
| 28. Weight Optimizer | 0/TBD | Not started | - |

## Coverage

✓ All 23 v1 requirements mapped to exactly one phase (no orphans, no duplicates).

| Phase | Requirements | Count |
|-------|--------------|-------|
| 21 | SURF-01, SURF-02, SURF-03, CORR-01, CORR-02, CORR-03, CORR-04, IMPACT-01, IMPACT-02 | 9 |
| 22 | HONEST-01, HONEST-02 | 2 |
| 23 | PERSIST-01, PERSIST-02, PERSIST-03, PERSIST-04 | 4 |
| 24 | BENCH-01 | 1 |
| 25 | SHARE-01, SHARE-02, SHARE-03 | 3 |
| 26 | STRESS-01, STRESS-02 | 2 |
| 27 | SIM-01 | 1 |
| 28 | OPT-01, OPT-02 | 2 |
| **Total** | | **23 / 23** |
