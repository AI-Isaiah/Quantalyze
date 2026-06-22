# Requirements: Quantalyze — v1.1.0 Scenario Analysis

**Defined:** 2026-06-21
**Core Value:** Allocators act on Bridge recommendations and see whether those suggestions actually worked — and can model the impact of composition changes before they make them.

## v1 Requirements

Requirements for the v1.1.0 milestone. Each maps to a roadmap phase.

### Surfacing (R1 + design-doc success-criterion #1)

- [x] **SURF-01**: Allocator can reach the own-book Scenario tab from the visible dashboard tablist (not only via `?tab=scenario`)
- [x] **SURF-02**: Allocator — and only allocators, not managers/admins — can reach the example-universe Strategy Sandbox from the sidebar
- [x] **SURF-03**: The Strategy Sandbox is labeled "Strategy Sandbox" with an "Example universe" badge so it is never confused with the own-book Scenario tab

### Correlation (R2)

- [x] **CORR-01**: Allocator sees a pairwise correlation heatmap of the scenario's strategies (≥2 active rows), labeled by de-aliased strategy name
- [x] **CORR-02**: A single-holding or <10-overlapping-day scenario renders an honest empty state — never a 1×1 grid or a fabricated number
- [x] **CORR-03**: Average pairwise correlation is shown once, labeled "Avg |ρ|", reconciled with the KPI strip's label
- [x] **CORR-04**: With >10 strategies, the heatmap shows ALL strategies in a scrollable container (no truncation, no "top-10" disclosure), and the figure's aria-label names the true strategy count — reconciled 2026-06-21 per the LOCKED Phase 21 CONTEXT decision (show-all supersedes the original "discloses it shows the 10 most-correlated")

### Projection honesty (R3)

- [x] **IMPACT-01**: The scenario projection is persistently framed "PROJECTED — hypothetical, not your live book" with coverage caveats (N overlapping days, shortest history)
- [x] **IMPACT-02**: The projection never peer-ranks or shows allocator/peer-percentile panels on a hypothetical blend (no `ingestSource:"api"` builder) — locked by a neuter-check regression test

### Methodology honesty (cross-cutting; research-driven differentiator)

- [x] **HONEST-01**: Every projected stat surfaces its method + overlapping-N + horizon (e.g. "Historical bootstrap · 412 overlapping days · not a forecast")
- [x] **HONEST-02**: A shared minimum-sample gate (tunable floor, conservative default for distributional/tail outputs) renders an honest empty state below the floor — reused by Stress and Monte-Carlo

### Persistence & comparison (new #1, #6)

- [x] **PERSIST-01**: Allocator can save a named scenario to the database (JSONB draft = refs + weights + leverage + added strategies + `schema_version`; never raw return series)
- [x] **PERSIST-02**: Allocator can reopen a saved scenario, rehydrating the draft into the composer
- [x] **PERSIST-03**: Allocator can list, rename, and delete their saved scenarios
- [x] **PERSIST-04**: Allocator can compare 2+ saved scenarios (and the live book) side-by-side, ranked by Sharpe / return improvement

### Sharing (new #2)

- [ ] **SHARE-01**: Allocator can generate a read-only share link for a saved scenario
- [x] **SHARE-02**: A recipient can view a shared scenario read-only without exposing the allocator's live book, holdings, or any other tenant's data (snapshot, token-scoped read path)
- [x] **SHARE-03**: Allocator can revoke a share link

### Benchmark comparison (new #7)

- [x] **BENCH-01**: The scenario projection surfaces performance vs a benchmark (reusing `benchmark_prices` / `benchmark.py`), including tracking error / information ratio / alpha-beta over the overlap window

### Stress testing (new #3)

- [ ] **STRESS-01**: Allocator can apply a parameterized market shock (e.g. "BTC −30%") propagated through each strategy's data-derived β to the shocked factor, and see the projected impact
- [ ] **STRESS-02**: Allocator sees a downside risk measure — historical VaR + CVaR/Expected Shortfall — with method, window, and confidence level disclosed

### Forward uncertainty (new #4)

- [ ] **SIM-01**: Allocator sees forward confidence bands / a return distribution via a block bootstrap (joint across strategies), with band width honest to sample size and no Normal-tail assumption; below the HONEST-02 floor it renders an empty state

### Optimizer (new #5)

- [ ] **OPT-01**: Allocator can request suggested weights for an objective (min-vol default; max-Sharpe gated + caveated) via the Python analytics-service, long-only, with Ledoit-Wolf covariance shrinkage; suggested weights write to the draft only (never auto-commit)
- [ ] **OPT-02**: Optimizer output discloses its in-sample caveat and the overlap window it was fit on (overfit guard); TS↔Python convention parity is pinned by a golden-fixture test

## v2 Requirements

Deferred to a future release. Tracked, not in this roadmap.

### Scenario depth

- **SCEN-V2-01**: Full Overview-factsheet recompute on a scenario (only if an allocator asks twice; carries false-precision risk)
- **SCEN-V2-02**: Decision-memo generator (narrative summary of a scenario change)
- **SCEN-V2-03**: Scenario export (PDF / CSV)
- **SCEN-V2-04**: Rolling correlation / benchmark-correlation series
- **SCEN-V2-05**: Stationary-bootstrap (arch) or Python MC escalation — only if the numpy/TS block bootstrap proves insufficient by test

## Out of Scope

Explicitly excluded.

| Feature | Reason |
|---------|--------|
| Factor stress on rates/spreads/macro | Quantalyze has only daily return series — no instrument factors; inventing betas to unobserved factors violates no-invented-data. Only β to *observable* factors (e.g. BTC) derived from the actual returns is allowed (STRESS-01). |
| Consolidating the 3 correlation surfaces (Risk-tab matrix / reusable heatmap / `/scenarios`) | Code-motion with parallel-agent collision risk; defer until a feature forces convergence |
| Heavy optimizer solvers (cvxpy / PyPortfolioOpt) | scipy SLSQP covers min-vol/max-Sharpe long-only for ≤20 strategies; native solver trees not worth the Railway image weight |
| Auto-committing optimizer weights | Suggested weights write to the draft only — the allocator decides (OPT-01) |

## Traceability

Mapped during roadmap creation (gsd-roadmapper, 2026-06-21). Phases continue from
v1.0.0's Phase 20 (no reset) — this milestone is Phases 21–28.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SURF-01 | Phase 21 | Complete |
| SURF-02 | Phase 21 | Complete |
| SURF-03 | Phase 21 | Complete |
| CORR-01 | Phase 21 | Complete |
| CORR-02 | Phase 21 | Complete |
| CORR-03 | Phase 21 | Complete |
| CORR-04 | Phase 21 | Complete |
| IMPACT-01 | Phase 21 | Complete |
| IMPACT-02 | Phase 21 | Complete |
| HONEST-01 | Phase 22 | Complete |
| HONEST-02 | Phase 22 | Complete |
| PERSIST-01 | Phase 23 | Complete |
| PERSIST-02 | Phase 23 | Complete |
| PERSIST-03 | Phase 23 | Complete |
| PERSIST-04 | Phase 23 | Complete |
| BENCH-01 | Phase 24 | Complete |
| SHARE-01 | Phase 25 | Pending |
| SHARE-02 | Phase 25 | Complete |
| SHARE-03 | Phase 25 | Complete |
| STRESS-01 | Phase 26 | Pending |
| STRESS-02 | Phase 26 | Pending |
| SIM-01 | Phase 27 | Pending |
| OPT-01 | Phase 28 | Pending |
| OPT-02 | Phase 28 | Pending |

**Coverage:**
- v1 requirements: 23 total
- Mapped to phases: 23 ✓
- Unmapped: 0

---
*Requirements defined: 2026-06-21*
*Last updated: 2026-06-21 — roadmap created (Phases 21–28), traceability populated, 23/23 mapped*
