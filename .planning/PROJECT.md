# Quantalyze

> Reconstructed 2026-06-21 at the v1.1.0 milestone start. The prior PROJECT.md
> was lost during the v1.0.0 archival (STATE.md still pointed at it). Validated
> requirements below are inferred from MILESTONES.md + the live codebase.

## What This Is

Quantalyze is a platform that connects capital **allocators** with quant
**strategy managers**. Allocators get a mandate-aware "Bridge" recommendation
engine that matches strategies to their book, can act on those recommendations,
track whether they actually worked, and inspect every strategy through
institutional-grade factsheets. Strategy managers onboard track records via
broker API keys (OKX/Bybit), CSV upload, or a read-only MT5 Expert Advisor, and
get the same factsheet surface. There is also an admin role.

## Core Value

Allocators act on Bridge recommendations and see whether those suggestions
actually worked — and can model the impact of composition changes before they
make them.

## Current Milestone: v1.17 MT5 — usable end-to-end, not merely ingested (started 2026-08-04)

**Goal:** MT5 *works* in the founder's sense rather than the wizard's — it ingests (done), it projects
in a scenario, and its factsheet is viewable by the allocator who uploaded it.

**Founder verbatim (2026-08-04, minutes after MT5-05 was discharged on PROD):**
> *"The goal is that MT5 works. And at the moment, maybe it ingests the data, but I cannot use it in
> the scenario, and I can still not produce a factsheet."*

**Target features (REQ groups — see `.planning/REQUIREMENTS.md`):**
- **SCEN — the series actually reaches the engine.** `strategy_analytics.daily_returns` has **no
  production writer at all** (PROD: 0 of 27 real strategies populated vs 15/15 demo seeds), and the
  scenario's data route reads only that column. Affected strategies contribute nothing and the
  composer renders zeros with no error. Plus the composer's own legibility: ownership marker,
  clickable rows, labelled numbers, duplicate browse entries.
- **OWN / NAV — an allocator can see and reach their own strategy.** The owner factsheet 404s today
  (⛔ its acceptance test is adversarial: after an owner views their draft, an anon request for the
  same id must STILL 404 — that route is publicly cached), and there is no "my strategies" nav entry,
  so the allocator side is write-only.
- **AUM — a book you can reach and a size you can set.** The holdings sync crashes on every non-ccxt
  venue (a raw `AttributeError` sits in a user-visible column on PROD), an all-or-nothing per-key gate
  hides a live book behind a forced blank slate, AUM is derived-only with no input anywhere, and the
  refusal copy names a control that was deliberately never built.
- **WIZ — the wizard stops costing submits.** Inline field errors, a resume path for allocators,
  credential dedup, no stale screens, and MT5 selectable as its own venue.
- **MT5-VERIFY — the numbers are true.** Server-UTC offset measured live, rendered performance checked
  against an external oracle, on a live funded account on a real trading day.

⭐ **Defining constraint: almost NONE of this is an MT5 defect.** MT5 is the first venue to traverse
the whole path from a cold start, so it is exposing pre-existing holes in the surfaces AFTER
ingestion. SCEN-01 affects every real strategy at every venue; OWN-02 blocks every unpublished
strategy; AUM-05 will hit sFOX the day its flag flips. **A fix scoped to `exchange === 'mt5'` is the
wrong fix for nearly all of it.**

**Scope decisions (founder 2026-08-04):** v1.16 **PARKED at 68%, not shipped** — 13/19 phases,
119/127 plans, with Phases 143–146 outstanding; to be reopened after v1.17 delivers. Research SKIPPED
(zero new external features; every requirement is a defect already root-caused with PROD evidence and
file:line citations). Phase numbering continues from **147**.

## ⏸️ PARKED Milestone: v1.16 Production Resilience & Reliability (planning, started 2026-07-25)

⛔ **PARKED 2026-08-04 at 68% — NOT shipped, NOT complete.** Outstanding: Phase 143 (dropped-enqueue
sweep), 144 (WR-02 orphaned-running DELETE→terminal UPDATE — carries the live TEST-DELETE/PROD-reset
founder call), 145 (csv-finalize atomicity), 146 (RATE audit). Resume at Phase 143. All 29 phase
directories were deliberately PRESERVED (the workflow's `phases.clear` was skipped by founder call) so
this milestone resumes without reconstruction.

**Goal:** Give the live money-bearing plumbing failure handling — so a hung Railway request, a silently-dropped compute-job enqueue, or a mid-job worker crash can't strand a real investor factsheet on a spinner that never resolves. This is hardening of existing seams (Deribit, MT5, and sFOX/Nautilus now carry real accounts), not new external features. The biggest live-surface risk is no longer correctness math (mostly latent/flag-gated) — it's that the plumbing has no failure handling.

**Target features (REQ groups — see `.planning/REQUIREMENTS.md`):**
- **SEAM — Vercel→Railway resilience** (top item): `analytics-client.ts` gets a bounded fetch timeout + retry-with-backoff (idempotent reads only) + circuit breaker, so a hung Railway request fails fast with a clean error instead of holding a Vercel lambda open until the platform kills it and cascade-500s `keys/sync`, `verify-strategy`, `admin/match/*`. Live keys sync through this seam.
- **JOB — Job-state integrity** (no forever-spinners): detect strategy-with-data-but-no-compute-job (`after()` enqueue drop → stuck "computing"); make csv-finalize transactional / orphan-cleaned; worker-crash `computing`-row janitor (also removes the recurring shared-test-DB fence flake — two birds). The worker orphaned-`running` DELETE-vs-reset founder call (TEST DELETE / PROD reset, same migration) resolves here.
- **RATE — Rate limiting** on the currently-unlimited authed routes that hit the Python service (`verify-strategy`, `keys/{sync,validate,encrypt}`, `admin/match/recompute`, `admin/partner-import`, `trades/upload`, `intro`) → arbitrary quota-burn / DoS surface now that real keys exist.

**Scope decisions (founder 2026-07-25):** CRON (match-engine cron health check + founder-LP/email idempotency) DEFERRED to a follow-up milestone. Runner-up "Money-Path Correctness Unification" (backbone-bypass parity + latent quantstats/blend/short-window-CAGR bugs) deferred — mostly latent/edge-case, less urgent than the live plumbing gaps. **Research:** first (founder chose). Phase numbering continues from **140**.

## ✅ Shipped Milestone (FOUNDATION, flag-OFF): v1.12 sFOX Verified Integration — Phases 118–123, shipped 2026-07-19, tag `v1.12` @ `92be47af` (v0.46.0.0, PR #623)

**Delivered (dormant):** the foundation for live sFOX verified integration — a non-ccxt `SfoxClient`/`SfoxAdapter` reconstructing daily equity through the ONE backbone with the `api_verified` stamp; `sfox` accepted at every key chokepoint (read-only STRUCTURAL, honest `KEY_AUTH_FAILED`) + a prod-applied constraint-widening migration; flag-gated add-key UI + badge + read-only setup guide; and worker-hardening groundwork (`asyncio.wait_for`-bounded crawls, prod-applied kind-filtered claim RPC, E2 anchor/flip fixtures, go-live runbook, Fly egress-proxy artifacts). **All flag-OFF** (`NEXT_PUBLIC_SFOX_ENABLED`/`SFOX_ENABLED` empty) — zero prod impact, nothing reads live. **Closed as Foundation:** go-live is founder-gated ops (Fly deploy + IP-whitelist, FLIP cutover, live E2) + a real factsheet e2e defect + an evidence-gated deribit phase — all **re-homed to v1.13**, enumerated, not silently accepted. Full detail: `MILESTONES.md` + `milestones/v1.12-*`.

**Original goal:** Add a LIVE sFOX exchange adapter that reads the actual account (`api_verified` ground truth — defeating CSV fabrication), backed by a Fly.io static-IP egress so IP-whitelisted sFOX keys work; and burn down the two backbone follow-ups parked at v1.11 close.

**Why (founder, load-bearing):** CSV track records are `self_reported` — a submitter can fabricate the numbers. A live API read of the real sFOX account is `api_verified` ground truth they can't fake. That trust distinction (the Phase-111 provenance tiers) IS the point of the big adapter over the trivial CSV path. sFOX is NOT in ccxt → a custom non-ccxt adapter is required. sFOX keys can be IP-whitelisted → the Fly static-IP egress is load-bearing, not optional.

**Target features (REQ groups — see `.planning/REQUIREMENTS.md`):**
- **SFOX (5-phase core)** — (1) research + non-ccxt `SfoxClient` adapter contract (the real unknown: *can we reconstruct daily equity from what sFOX exposes?*), green sandbox smoke test; (2) read adapter (balance/trades/txns, read-only enforced) + worker `validate_key`/`encrypt_key` + all 3 Vercel key routes accept `sfox` + a DB constraint-widening migration admitting `'sfox'` across the ≥5 hardcoded exchange CHECKs; (3) equity reconstruction → daily returns → unified backbone with `api_verified` stamp + ground-truth parity check; (4) **Fly.io static-IP egress** ($2/mo dedicated v4 proxy in `ams`, tinyproxy CONNECT-443, worker aiohttp/ccxt proxy wiring — VERIFY egress IP == dedicated v4 before whitelisting); (5) add-key UI exchange picker + onboarding + e2e (all roles), assert the `api_verified` badge renders.
- **FLIPRETRY** — retry the v1.11-rolled-back derived-allocator-equity FLIP with its ROOT-CAUSE fix: a hard `asyncio.wait_for` timeout on each derive's exchange crawl + batched/off-hours backfill on its OWN worker (never the sequential prod worker's event loop) + re-`cron.schedule('derive-allocator-key-dailies', ...)`, THEN `E2_GROUND_TRUTH_*` anchor-consistency validation. Flip is data-driven (no flag): `queries.ts` `extractTrustworthyDerivedCurve` → `equityCurveSource`.
- **DERIBITFIX** — classify the unhandled deribit `correction` txn-log type (a `LedgerValuationError` fail-loud that currently blocks ingesting any deribit account with a `correction` entry). Fix needs EVIDENCE of what deribit `correction` means, not a guess.

**Governing principles:** live API read = `api_verified` ground truth ([[project_sfox_verified_integration_milestone]]); dailies-canonical backbone ([[feedback_dailies_canonical_unified_derive]]) — sFOX balances/trades → daily returns → the ONE backbone; fail-loud, no invented data. flyctl is NOT installed locally → founder runs `fly deploy` + provisions/whitelists the IP; I generate Dockerfile + fly.toml + tinyproxy.conf.

**Scope decisions (2026-07-18):** milestone-level ecosystem research SKIPPED (4 mature exchange adapters already exist; sFOX-specific research lives in Phase-1 RESEARCH.md). Phase numbering continues from Phase 118 (no reset). Static-IP provisioning + IP-whitelisting are founder-run ops gates, not code blockers.

## ✅ Shipped Milestone: v1.10 Demo-Hero Portfolio Intelligence + Options MTM + Backbone Unification (Phases 98–108, shipped 2026-07-15, tag `v1.10` @ `32494ba2`)

**Delivered:** the allocator dashboard became the demo-hero surface (Exposure/Net-Exposure/Allocation widgets + optimizer sleeve + Notes + folded KPI panel, PI-01..07); the options `cash_settlement ↔ mark_to_market` toggle now swaps the daily SERIES so the whole factsheet follows (MTM-01..04); every derive path unified onto the one dailies-canonical backbone with the legacy trades-based chain deleted (BB-01..03); and leverage + the scenario-planner both re-derive off that backbone with ~990 LOC of frontend re-scale / second-Sharpe disclosure deleted (LEV-BB, SCEN-BB). Full detail: `MILESTONES.md` + `milestones/v1.10-*`.

**Original goal:** Make the allocator dashboard the 10/10 demo-hero surface for the next
cap-intro / pilot-allocator meeting (the project north-star), and give
options-trading strategies an honest working mark-to-market view on the
factsheet. v1.9/v1.9.1 shipped + hardened multi-key composites; v1.10 turns the
dashboard from placeholders into the demo, and finally builds the twice-deferred
options MTM smoothing.

**Target scope (REQ groups — see `.planning/REQUIREMENTS.md`):**
- **PI** — Portfolio Intelligence (M-A, demo-hero): position/weight-history data foundation + cross-process recompute UNIQUE INDEX (PI-07); Exposure-by-Asset-Class / Net-Exposure-Over-Time / Allocation-Over-Time widgets (PI-01/02/03); optimizer sleeve replaces the hardcoded 10% + favorites UX (PI-05); Notes widget (PI-04); `PortfolioKPIRow` shared-panel fold (PI-06).
- **MTM** — Options mark-to-market on the factsheet (NEW): enable the `cash_settlement ↔ mark_to_market` toggle for options-trading strategies via the deferred Phase-83 daily-option smoothing (MTM-01), compose with the composite stitch + coverage mask (MTM-02), Zavara corroboration + full byte-identity regression (MTM-03).

**Split decision (2026-07-12):** the infra/pipeline tail — **M-E Pipeline Cutover & Correctness** + **M-C CI/Test-Infra Ratchet** (incl. the v1.9.1-deferred `-n auto` fence parallelization) — is deferred to **v1.11** so v1.10 stays demo-focused and shippable. **M-B cron/notification reliability** also stays deferred (next-up). All captured in `.planning/FUTURE-MILESTONES.md`. Phase numbering continues from v1.9.1 (Phase 98+).

**Research dependency:** MTM-01 daily-option mark methodology is research-heavy (twice-deferred) — the Phase-101 researcher must surface the smoothing approach + its honest-gating boundary before planning; MTM must keep `cash_settlement` byte-identical (SC-4). PI widgets are blocked on data plumbing (Phase 98), not UI.

## Requirements

### Validated

<!-- Shipped and confirmed in the codebase. Inferred from MILESTONES.md. -->

- ✓ Bridge recommendation engine + mandate-aware scoring + outcome feedback loop — v0.14.0.0
- ✓ Outcome tracking: allocators record what they did, system computes realized 30/90/180-day deltas — v0.14.0.0
- ✓ Full qstats-parity factsheets (7-panel) on Discovery + Single-Strategy — v0.17.0.0
- ✓ Discovery v2 (watchlist, per-user customize, sparklines) — v0.17.0.0
- ✓ Strategy-level correlation matrix on the Risk tab — v0.17.x
- ✓ Unified ingestion backbone (`POST /process-key`) — API-key, CSV, and MT5-EA paths behind one adapter Protocol — v1.0.0
- ✓ Founder-LP monthly factsheet report cron — v1.0.0
- ✓ Scenario **draft engine**: compose a what-if portfolio (toggle holdings, reweight, add strategies), live KPI / equity / drawdown projection vs the live book, per-strategy leverage what-if, single-transaction commit to the `bridge_outcomes` audit trail — v1.0.0 + PR #493 (R4 leverage, H-0133 weight plumbing)
- ✓ **Scenario Analysis (v1.1.0, Phases 21–28)**: surfacing + correlation heatmap + "PROJECTED — hypothetical" framing; per-stat method/overlap-N/horizon disclosure + shared sample-floor gate; save/reopen/list/rename/delete + compare named scenarios (DB + RLS + `schema_version`); benchmark overlay (TE/IR/alpha-beta); revocable read-only share links (leak-scoped SECURITY DEFINER); β-propagated stress + VaR/CVaR; block-bootstrap Monte-Carlo confidence bands (first Web Worker); min-vol/max-Sharpe weight optimizer (Python, write-to-draft-only, TS↔Py parity) — v0.25.0.0 → v0.28.0.2
- ✓ **Allocator Cohesion (v1.2, Phases 29–33)**: the three fractured allocator surfaces (Strategy Sandbox `/scenarios`, legacy Portfolios pages, own-book Scenario composer) collapsed into ONE factsheet-grade composer on the live blended book — entry-mode (blank-slate or seed-from-book) + merged verified+example Browse catalog + scoped RLS lazy-returns route so an added strategy moves the projection (29); factsheet-grade graphs on the blend (equity/drawdown + returns distribution + rolling Sharpe/vol/Sortino, each disclosing method/overlap-N/horizon, peer/percentile panels structurally suppressed) (30); collapsible composition controls so graphs lead, hide-not-unmount preserving edits (31); `/scenarios` retired to a 307 redirect, ScenarioBuilder deleted, nav consolidated to one allocator entry, dead add-strategy link fixed — no DDL (32); Bridge→composer continuity + DESIGN.md focus rings + a live WCAG-AA composer axe gate (33). Additive client-TS/TSX over the FROZEN `scenario.ts` engine — v0.29.0.0 → v0.30.0.1 (tag `v1.2` @ 11775460)
- ✓ **scenario-tab-hardening (v1.2.1, Phases 34–38)**: unified every exchange API key's stats through the ONE CSV → `compute_all_metrics` path so Overview, Scenario, and factsheets read the same honest source, and finished the composer's convergence onto the factsheet — explicit `periods_per_year=252` at the call site + `equity_reconstruction` converged to 252 (no ×1.20 mismatch) (34); `csv_daily_returns` dual-axis (`api_key_id`) per-key dailies foundation + allocator-key-scoped realized+funding derive job + backfill + per-key owner RLS (35); Overview equity/KPIs repointed onto a per-key blend through the frozen `computeScenario` engine (all-or-nothing gate, snapshot fallback, HOLDINGS untouched) (36); honest per-`api_key` include/exclude toggle that re-blends the curve + KPIs from the remaining per-key series (37); composer scenario equity + drawdown reuse the REAL factsheet `TimeSeriesChart` + `MasterBrush` under an additive `persist={false}` provider at 1440 width + blank-slate scenario overlay (38). Additive client-TS/TSX + Python over the FROZEN `scenario.ts` engine; one storage migration (Phase 35) — v0.30.1.0 → v0.33.0.0 (tag `v1.2.1` @ `e5e4f3d2`)

- ✓ **scenario-tab-factsheet-parity (v1.2.2, Phases 39–43)**: the /allocations Scenario composer renders the REAL factsheet on a hypothetical blend, computed client-side (`compute.ts`) with parity by construction — `buildScenarioFactsheetPayload` extended minimal→complete (full scalar + panel metrics, degenerate-safe) (39); the real `FactsheetBody` mounted under the scenario `FactsheetProvider(persist=false)` behind an additive byte-identical `scenarioMode` flag, api-only panels absent on the csv blend (40); a constituent correlation / diversification matrix (ρ≥0.85 too-similar flag, percent-contribution-to-risk, cluster reorder) (41); an honest AGGREGATE peer rank for the blend via an additive `scenarioPeer` carve-out (deliberate, audited override of the no-peer-rank-a-hypothetical invariant — never an `ingestSource` flip), per-constituent mandate chips, own-book delta (42); compose toggles folded into the factsheet layout behind four permanent guards — byte-identity / axe a11y / coverage / no-state-bleed (43). Additive over the FROZEN `scenario.ts` engine; no migration — v0.34.0.0 → v0.34.0.3 (tag `v1.2.2` @ `43e57dd0`)

- ✓ **Mobile & Adaptive UI (v1.3, Phases 44–48)**: the whole app is usable, touch-inspectable, and WCAG-AA accessible on a phone (320px → 400% zoom) with the desktop render byte-identical — SSR-safe `useBreakpoint` + `ResponsiveTable`/`ResponsiveChartFrame` primitives and bespoke CI gates for the WCAG checks axe can't do (320px reflow, 400% zoom, 44px target-size, mobile keyboard/focus) (44); role-aware mobile bottom nav single-sourced from Sidebar + inert-background drawer + app-shell skip-link + CSS-first scrollable tab strip (45); every data table usable at 320px with no dropped columns (ResponsiveTable + all-columns guards) + wizard de-blocked below 640px + parametrized reflow sweeps across public/authed/degenerate routes (46); 16 hand-rolled SVG charts touch-inspectable via shared `useTapPin` + 320px legibility + portrait tuning, frozen math byte-identical (47); all 18 Recharts charts via breakpoint-gated `TouchTooltip` + the 2277-LOC `EquityChart` touch path (additive `useTapPin`, desktop byte-identical) + app-wide axe route×viewport matrix + `@lhci/cli` mobile perf budget, FLOW-01 dual-wired (48). Presentation-layer only over the FROZEN `scenario.ts` engine; no migration — v0.35.0.0 → v0.35.0.3 (tag `v1.3` @ `37b12c8c`)
- ✓ **Frontend Excellence (v1.4, Phases 49–54)**: app-wide UI/UX overhaul to best-in-class rendering across the full resolution range with the math engine frozen — a state-of-the-art design system + fluid `--text-*`/`--space-*` token spine in a plain `@theme` block + clamp/raw-hex/raw-px lint guards (49); refreshed primitives + new Table/Tabs/Dialog/Select/Field/Breadcrumb (`radix-ui@1.6.0` scoped to non-native widgets only) + reusable loading/error/empty state primitives (50); a `(marketing)` URL-invisible route-group shell + IA restructure + route-contract guard + `PUBLIC_ROUTES` sync (51); per-surface application to the allocator journey (`@container` reshape, fluid-fill to ~1920px, honest route states; composer stays a frozen client island, BODY-02) (52) and to the wizard/security/admin/public surfaces behind a per-surface DESIGN.md-conformance gate (53); app-wide verification — 2560px ultra-wide axe/reflow row, hermetic authed/mobile axe re-enable, lhci 0.60→0.65, a runtime no-clip guard, tolerance-based Playwright goldens, and `no-raw-font-px` flipped to error repo-wide (54). Presentation-layer only over the FROZEN `scenario.ts`/`compute.ts`/`FactsheetBody`; desktop byte-identity LIFTED; one new prod dep (`radix-ui@1.6.0`) — v0.35.0.6 → v0.35.0.12 (tag `v1.4` @ `4c4ca537`)
- ✓ **Scenario Coverage-Window Blend (v1.5, Phases 55–61)**: the frozen `scenario.ts` blend convention DELIBERATELY rewritten to coverage-window membership — member iff `enabled AND span ⊇ window`, divisor counts members only, weighted blends renormalize, ended strategies no longer dilute the tail toward zero; explicit `state.window` + pure `scenario-window.ts` helpers + `member_count`/`effective window`/`N` exposed on `ComputedMetrics`, pinned to an independent numpy re-derivation to fp precision (55); factsheet parity-by-construction re-proven with a two-layer guard (56); window control with intersection default, dual presets, widen→auto-drop / narrow→auto-restore within the selected subset, guided empty-intersection fix (57); coverage legibility — honest blend header, three-state row chips, mini-gantt timeline, include-cost affordance, one-time default-change note (58); windows persisted across save/share/compare (schema v2→v3 non-destructive codec, share threads the owner's window verbatim through the SECDEF RPC, compare per-column windows) (59); safety-net re-bake honestly re-scoped to a proven no-op + the restored e2e net caught 3 latent bugs (60); authed prod canary verified the whole chain live and DISCOVERED the inert-added-strategies + empty-book-draft bugs (P61-BUG-1/2), fixed tests-first via `mergeAddedIntoPerKeySet` + compare engine-set mirroring + honest book-only share 409 (61). SCENARIO-05 re-baselined as a reviewed act; no-invented-data held — v0.35.0.26 → v0.35.0.31 (tag `v1.5` @ `f8b502e7`)
- ✓ **sFOX Verified Integration FOUNDATION (v1.12, Phases 118–123, flag-OFF)**: the dormant foundation for a live `api_verified` sFOX exchange — a non-ccxt `SfoxClient` (Bearer, 4 read endpoints, proxy seam) + `SfoxAdapter` reconstructing daily equity from the balance-history series through the ONE `derive_basis_series` backbone with the Phase-111 `api_verified` provenance stamp (SFOX-01/05); `sfox` accepted at the worker validate/encrypt path + all 3 Vercel key routes with an empty-secret Q1 carve-out, read-only asserted STRUCTURALLY, honest `KEY_AUTH_FAILED`, plus a prod-applied constraint-widening migration admitting `'sfox'` across the ≥5 exchange CHECKs (SFOX-02/03/04); flag-gated add-key UI (`NEXT_PUBLIC_SFOX_ENABLED`, OFF = byte-identical) + `api_verified` badge + read-only setup guide (SFOX-08/09); and worker-hardening groundwork — `asyncio.wait_for`-bounded derive crawls + a prod-applied kind-filtered claim RPC + E2 anchor/flip fixtures + Fly egress-proxy artifacts (FLIPRETRY-01/02, SFOX-07 groundwork). Shipped **dormant** (no user can connect, nothing reads live). Per-phase opus verifier + code-review + Fable red team; P115 economic-oracle discipline. **Go-live re-homed to v1.13** (Fly IP-bind, factsheet e2e, E2 ground-truth, FLIP cutover, deribit `correction`) — v0.46.0.0 (tag `v1.12` @ `92be47af`, PR #623)
- ✓ **Scenario Composer v2 (v1.11, Phases 109–117 + 110.1/115.1)**: every scenario source normalized to ONE daily-series constituent under a coherent manager/allocator role model, with the dailies-canonical backbone tail finished on the allocator surface — role/nav/API guards derive from one predicate (`is_admin` ops-overlay only), dropping the `|| isAdmin` 403 cluster (ROLE); allocator private-by-default strategy contribution via a reusable `ContributionWizardOverlay` with an owner-only `status='private'` finalize path RLS-audited against catalog-wide leak (CONTRIB); the "Data Sources" section deleted so api-key/CSV/catalog/composite each render as ONE badged constituent row, blend parity proven = interpretation A to 1e-9 (CONSTIT); per-key weight + leverage rows on the engine-unit basis (`wᵢ·Lᵢ·rᵢ`) + a max-DD→leverage back-solver, all over the FROZEN `scenario.ts` (WEIGHTS); the 2nd Sharpe/vol/TWR stack deleted behind a golden gate + allocator equity reconstruction onto the backbone (BACKBONE E1/E2, derived path dormant in prod pending two founder-gated ops); context-aware +Allocation/+Strategy (ADDALLOC); tooltip-portal / focus-ring / KPI-value fixes (UIFIX). Per-phase opus verifier + code-review + Fable red team; SC-3 byte-frozen throughout — v0.44.x → v0.45.0.0 (tag `v1.11` @ `a42f4bcf`, PRs #620 + #622)
- ✓ **Demo-Hero Portfolio Intelligence + Options MTM + Backbone Unification (v1.10, Phases 98–108)**: allocator-dashboard demo-hero surface — Exposure-by-Class / Net-Exposure / Allocation-over-Time widgets on an owner-scoped secretless read layer, optimizer sleeve replacing the hardcoded 10% favorites, Notes storage, shared-`KpiPanel` fold, and a real-PG partial-UNIQUE cross-process fence (PI-01..07); the `cash_settlement ↔ mark_to_market` factsheet toggle swaps the daily return SERIES so all charts follow (single-key + composite) with a per-basis coverage mask + honest gating, cash byte-identical (MTM-01..04); the dailies-canonical backbone finished — `services/basis_series.py::derive_basis_series` the ONE shared route, composite + onboarding routed onto it, the trades-based legacy analytics chain + all 4 dark re-entry points deleted, `USE_COMPUTE_JOBS_QUEUE` mandatory (BB-01..03); leverage as an `r→L·r` dailies transform + the scenario-planner both re-derive off the backbone, ~990 LOC frontend re-scale / second-Sharpe disclosure deleted (LEV-BB, SCEN-BB). Full close pipeline every phase (opus review + opus verifier + Fable red team). Full suite 8161+ green — v0.42.0.0 → v0.43.0.0 (tag `v1.10` @ `32494ba2`)

### Active

<!-- v1.8 Flow-Aware Time-Weighted Returns — Phases 73+. See ## Current Milestone above + .planning/REQUIREMENTS.md. -->

- **v1.8 Flow-Aware Time-Weighted Returns (Phases 73+)** — daily-NAV backward reconstruction + chain-linked TWR replacing anchor-to-today, dated external-flow valuation per exchange, fail-loud DQ guards, golden parity. Requirements in `.planning/REQUIREMENTS.md`.
- **v1.7 Deribit Exchange Coverage & Carry-Forward Burn-Down (Phases 66–72)** — ⏳ OPEN. Phases 66–71 shipped; Deribit full parity + valuation engine live and verified (key #1 clean). Phase 72 LTP acceptance verification is BLOCKED on v1.8 (anchor bug inflates flow-heavy returns) and carried forward as a v1.8 requirement. Closes once v1.8 lands + P72 canary re-runs green.

### Deferred (tracked tech debt)

- [ ] Real-device authed sign-off (VERIFY-05 / 54-VERIFICATION.md) — partially discharged across milestones via live authed prod canaries (real Chromium, 0 console errors on /allocations + /discovery); full multi-device manual walkthrough on authed surfaces (no reflow/clip/a11y regression + the RT-W2 admin width caps) remains the user's gate. Headless can't hydrate authed pages.
- [ ] Live golden-PNG bake (VERIFY-01/04) — the tolerance-based Playwright `toHaveScreenshot()` goldens land green-by-skip (WR-02 guard) until a deliberate per-chart re-baseline in a seeded CI run; never blind `--update-snapshots`.
- [x] ~~Ratchet `lighthouse-mobile` up from 0.60~~ — done in v1.4 (VERIFY-03, 0.60→0.65).
- [x] ~~Re-enable authed/mobile axe rows against a hermetic seeded DB~~ — done in v1.4 (VERIFY-02, seeded MA-8, teardown-by-id).

### Out of Scope

<!-- Explicit boundaries with reasoning. -->

- Full Overview-factsheet recompute on a hypothetical blend — false-precision risk (`ingestSource:"api"` unlocks peer/allocator panels on a what-if). Revisit only if an allocator asks twice.
- Consolidating the 3 correlation surfaces (Risk-tab matrix vs reusable heatmap vs `/scenarios`) — code-motion, defer until a feature forces convergence on the WCAG-audited palette.
- "Decision-memo generator" vision — strong future direction, not this milestone.
- Scenario export (PDF/CSV) — defer until save/load proves the workflow.

## Last Shipped Milestone: v1.6 Scenario Series-Space Purification (✅ shipped 2026-07-04, tag `v1.6` @ `f78f036b`)

**Goal:** The scenario tab operates purely in series space — explicit per-key draft membership
(`memberKeyIds`, schema v4, non-destructive upgrades), holdings-snapshot fallback engine deleted
(ONE `buildAddedOnlySet` feeds composer/compare/share, source-scan guard against reintroduction),
KPI strip return-form only, mixed-share honesty caption with zero member-UUID leakage. Phases 62–65
in a single PR #572 (v0.36.0.0); audit PASSED 16/16 reqs · 4/4 phases · 6/6 seams; live canary
GUARD-04 clean, 0 bugs. Frozen engine zero-diff the whole milestone.

**Notable:** a pre-landing Fable red team caught F-1 CRITICAL (blank-session Update silently wiping
book membership) that 6 specialists missed; fixed at the root and verified live at the persisted
layer. Full per-phase detail: `.planning/MILESTONES.md` + `milestones/v1.6-*`.

## Context

- **Pre-revenue, no clients yet** — destructive ops and short soak gates are acceptable; strategies are re-uploadable. Decisions are made autonomously rather than gated on customer impact.
- The scenario math is **client-side TypeScript** (`src/lib/scenario.ts` + `compute.ts`, frozen by SCENARIO-05 / BODY-02 regression pins). The client-TS-vs-Python split is settled (v1.1.0): heavy compute stays client-side except the one Python optimizer endpoint (Ledoit-Wolf + SLSQP); Monte-Carlo runs in a client Web Worker.
- The design system was refreshed to a state-of-the-art aesthetic in v1.4 (DESIGN.md is the SoT), with a fluid `--text-*`/`--space-*` token spine in a plain `@theme` block, `radix-ui@1.6.0` scoped to non-native widgets, and `no-raw-font-px`/`no-raw-hex`/`clamp-without-rem` lint guards enforcing conformance.
- App ships continuously on Vercel (frontend) + Railway (Python analytics); Supabase migrations auto-apply on merge.

## Constraints

- **Tech stack**: Next.js 16 App Router (NOT vanilla Next — read `node_modules/next/dist/docs/` before writing route/cache code), React client components, TypeScript; FastAPI/Python analytics-service on Railway; Supabase Postgres + Auth + RLS.
- **No-invented-data invariant**: degenerate inputs (0/1 active strategy, <10 overlapping days, non-finite returns) render honest empty states — never fabricated zeros, garbage numbers, or false precision.
- **Design**: DESIGN.md governs all visual decisions (palette, typography, spacing). Read it before any UI.
- **Convention**: 252-day annualization is product-wide; the scenario engine already honors it. Do not introduce a second convention.
- **Privacy**: scenario sharing touches RLS — a shared scenario must not leak the allocator's book or another tenant's data.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Reuse the existing scenario engine, never rebuild | `computeScenario` + toggle state + factsheet panels already do the hard part | ✓ Good (R4/H-0133 shipped on it) |
| Leverage v1 = caveat-only (no borrow/funding cost) | `L·r` is scale-invariant → Sharpe/correlation unchanged; honest label beats fake precision | ✓ Good (shipped #493) |
| Scenario Impact view = delta-only, no FactsheetBody | `ingestSource:"api"` peer-ranks a hypothetical blend → no-invented-data violation | ✓ Shipped (v1.1.0; IMPACT-02 guard) |
| Heavy scenario compute location (client TS vs Python) | Monte-carlo + optimizer are heavier than the current client engine | ✓ Resolved (v1.1.0: MC in client Web Worker; optimizer the one Python endpoint) |
| v1.2: unify Portfolios + Scenario tab + Sandbox into ONE composer | Three fractured surfaces + a dead `/portfolios` add-strategy link broke the workflow end-to-end | ✓ Shipped (v1.2; unified composer, `/scenarios` retired) |
| v1.2: "factsheet parity" = graphs only, peer panels stay suppressed | Honesty invariant locked — you cannot peer-rank a hypothetical blend | ✓ Shipped (v1.2; GRAPH-04 + IMPACT-02 guard) |
| v1.2.1: 252 stays the universal annualization basis (not crypto-365) | Displayed/ranking metrics must stay apples-to-apples; `periods_per_year` param makes a future per-asset divergence a one-line call-site change | ✓ Shipped (v1.2.1; ANNUAL-02/03/04/05 redefined, mutation-verified 365-rescale proof) |
| v1.2.1: per-key axis on existing `csv_daily_returns` (not a new table) | Resolves the `strategy_id NOT NULL FK→strategies` blocker without inventing synthetic strategy rows | ✓ Shipped (v1.2.1; dual-axis strategy XOR `api_key_id` + per-key owner RLS) |
| v1.2.1: composer factsheet parity = chart reuse, not a fork | Mounting the REAL `TimeSeriesChart`/`MasterBrush` under `persist={false}` keeps the factsheet byte-identical while the composer gets full interaction parity | ✓ Shipped (v1.2.1; Overview untouched, scope-bounded) |
| v1.2.2: reuse the factsheet wholesale, never rebuild | Feed the blend into the REAL `FactsheetBody` via one adapter + an additive `scenarioMode` flag; minimizes new code and guarantees parity by construction | ✓ Shipped (v1.2.2; factsheet byte-identical, BODY-02 gate) |
| v1.2.2: peer-rank override = aggregate-only `scenarioPeer` carve-out | An honest blend-vs-verified-universe rank is valuable, but per-constituent ranking or an `ingestSource` flip would re-invent data; a separate aggregate path stays inside no-invented-data | ✓ Shipped (v1.2.2; PEER-01, audit-c20 pin replaced) |
| v1.2.2: untrack live `.planning` ROADMAP/REQUIREMENTS/STATE | They were force-tracked at a frozen v1.1.0 snapshot, so branch ops kept reverting them and clobbering each milestone close; `.planning` is gitignored by design | ✓ Fixed (PR #530, 2026-06-27) |
| v1.4: presentation-layer milestone — lift desktop byte-identity, keep the math frozen | The visual layer needed to change to fix scaling/clipping/hierarchy, but `scenario.ts`/`compute.ts`/`FactsheetBody` must stay byte-identical | ✓ Shipped (v1.4; SCENARIO-05/BODY-02 green, frozen-spine + git-delta guards) |
| v1.4: fluid type = pure CSS `clamp()` in a plain `@theme` block (not `@theme inline`) | `@theme inline` flattens the variable chain; plain `@theme` keeps the token indirection so surfaces inherit no-clip scaling. Zero new deps for type/container/motion | ✓ Shipped (v1.4; clamp-without-rem F94 guard) |
| v1.4: one new prod dep (`radix-ui@1.6.0`), scoped to non-native widgets only | Native `<dialog>`/`<select>` stay native; Radix only where there's no native HTML equivalent (Tabs etc.) | ✓ Shipped (v1.4; Table/Field are semantic HTML, Tabs the lone Radix primitive) |
| v1.4: `no-raw-font-px` flipped to error repo-wide, frozen-chart islands off-glob exempted | App-wide token conformance without touching the byte-frozen chart SVGs (which carry intentional raw px) | ✓ Shipped (v1.4; 233 sites/60 files migrated byte-identically) |
| v1.4: visual regression = tolerance-based Playwright goldens, never blind `--update-snapshots` | Blind snapshot updates mask real regressions; deliberate per-chart re-baseline + tolerances + masked dynamic regions instead | ⚠ Partial (v1.4; harness landed, live PNG bake deferred-to-CI via WR-02 green-by-skip) |
| v1.5: REPLACE the blend convention with coverage-window membership (not additive) | An ended strategy dividing the blend toward zero is a bad convention, not a bug; two conventions in one engine would be worse | ✓ Shipped (v1.5; BLEND-01..07, numpy-pinned) |
| v1.5: first deliberate rewrite of the FROZEN `scenario.ts` since v1.2 — spine guards re-baselined as a reviewed act, never deleted | Frozen-by-default stays the rule; changes go through independent re-derivation (BLEND-07) + parity re-verify + staged re-bake, never a silent drift | ✓ Shipped (v1.5; frozen again post-#565, zero-diff through #570) |
| v1.5: persist the coverage window in the draft (schema v2→v3, non-destructive upgrade branch) | A VIEW-derived default that isn't persisted diverges cross-surface (RT-1 class); saved/shared/compared must recompute at the OWNER's window | ✓ Shipped (v1.5; PERSIST-01..03, `upgraded_v2_windowless`) |
| v1.5: derive the intersection default via ONE shared helper chain everywhere | Same inputs through different derivations = silently divergent membership between composer, share, and compare | ✓ Shipped (v1.5; integration-checker verified 3/3 sites) |
| v1.5: merge added units into the per-key engine set at ONE point, normalizing USD→shares there only | The two adapter paths disagreeing by construction caused P61-BUG-1/2; a merge helper keeps the keys-only blend byte-identical (engine is scale-invariant per selected set) | ✓ Shipped (#570; both call sites verified) |
| v1.5: book-only shares fail honest at MINT (409), live-book privacy boundary kept | The public page must never resolve owner book series; a dead em-dash share page reads as broken — refuse early with the reason instead | ✓ Shipped (#570; already-minted links render honest-absence) |
| **v1.8: SPLIT the annualization basis — RETURN/CAGR on 365 (calendar), RISK/Sharpe on 252** | Founder-corrected 2026-07-05 (my initial "252 universal" was wrong). quantstats 0.0.81 `cagr` computes `years = len(returns)/periods` then `(1+total)^(1/years)−1`; a 24/7 crypto series has a return every calendar day, so `periods=252` makes a 365-day record read as 1.45 years and mis-annualizes the return. **CAGR (and Calmar = CAGR/\|maxDD\|) must annualize on the true calendar clock → 365** (best implemented as true elapsed-calendar-days, frequency-proof). **Sharpe/volatility/Sortino/rolling_\* stay 252** — that √252 risk-comparability convention is what ANNUAL-02 actually protects, and it is preserved. This **supersedes ANNUAL-02 for the return metric only**; it changes displayed CAGR/Calmar for every crypto factsheet, so it rides the Phase 78 golden-parity gate. | ▶ Decided 2026-07-05 (v1.8; founder domain call — return vs risk are orthogonal clocks). Requirement TWR-05. |
| **v1.8: uPnL basis — realized-basis intra-window NAV + fail-loud DQ flag when the anchor's uPnL wedge is material** | The anchor is mark-to-market (incl. open uPnL) but daily `pnl_t` is realized-only, so a backward roll drifts by the running uPnL wedge. Default: reconstruct on a realized-basis terminal NAV, re-add uPnL only to the reported *current* NAV, and raise `unrealized_pnl_in_anchor` (`complete_with_warnings`) when material. A per-day uPnL true-up is pursued ONLY if Phase 5 confirms historical open-position marks are retrievable on read-only keys per venue (MEDIUM confidence). Never silently absorb the wedge. | ▶ Decided 2026-07-05 (v1.8 pre-gate; Phase-5 availability check may upgrade to per-day true-up) |
| **v1.10: dailies are canonical — every metric/chart/panel derives from the daily return SERIES through the ONE backbone (`derive_basis_series`)** | Scalars-first bred divergence (the Phase-101 √252 class, cash-vs-MTM chart drift); making the daily series the single source of truth and deriving scalars as a cache from it kills the whole class. Realized by routing composite + onboarding onto the shared route, deleting the trades-based legacy chain + all 4 dark re-entry points, and making `USE_COMPUTE_JOBS_QUEUE` mandatory. | ✓ Shipped (v1.10 BB-01..03; grep-gates 0, prod-verified) |
| **v1.10: leverage evolves from caveat-only re-scale to an `r→L·r` dailies transform that re-derives the WHOLE factsheet** | The v1 caveat-only frontend re-scale (`useLeveragedMetrics`) was a bypass of the backbone; making leverage a dailies preparation transform makes β→L·β / α→L·α fall out honestly and the charts+rail follow, deleting ~780 LOC of disclosure. Still excludes borrow/funding cost (labeled what-if), L=1 by-reference byte-identity. Supersedes the v1 "caveat-only" decision. | ✓ Shipped (v1.10 LEV-BB; scenario-planner followed via SCEN-BB) |
| **v1.12: a live sFOX API read is `api_verified` ground truth; the custom non-ccxt adapter earns its cost over the CSV path** | CSV track records are `self_reported` — fabricatable. A live read of the real account is ground truth a submitter can't fake (the Phase-111 provenance tier). sFOX is NOT in ccxt, so a bespoke `SfoxClient` is required; read-only is asserted STRUCTURALLY (no write surface, no scope endpoint), never a probed permission triple. | ✓ Shipped dormant (v1.12 SFOX-01/05; flag-OFF, go-live → v1.13) |
| **v1.12: close as FOUNDATION (flag-OFF) with go-live re-homed, rather than block or fake completion** | v1.12 is code-complete but its acceptance is founder-gated ops (Fly deploy + IP-whitelist, FLIP cutover, live E2) + a real e2e defect + an evidence-gated deribit phase — none landable this session. Shipping the foundation dormant + re-homing the enumerated go-live spine to v1.13 keeps prod safe and the ledger honest. | ✓ Foundation close (v1.12; `close_type: foundation`, re-home table in the audit doc + v1.13 seed) |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

## Current State

**v1.15 MetaTrader 5 shipped + LIVE 2026-07-25** (tag `v1.15`, v0.49.4.0) — MT5
elevated to a live `api_verified` account sync, flags flipped on quantalyze.xyz
(Vantage acct soaked, factsheet proven). v1.13 Infra + v1.14 Smoothed-MTM also
shipped since the last PROJECT.md milestone rewrite; the authoritative shipped
history is `MILESTONES.md` + `milestones/` (this document's older shipped-milestone
sections below jump v1.12 → v1.10 and were not backfilled).

**Now starting v1.16 Production Resilience & Reliability** (planning, Phases 140+).
Having gone live with real money-bearing integrations (Deribit, MT5, sFOX/Nautilus
next), the top live-surface risk is that the plumbing has no failure handling: the
Vercel→Railway analytics seam has no timeout/retry/circuit-breaker; a dropped
`after()` enqueue or a worker crash strands a strategy on a "computing" spinner
forever; and the authed routes hitting Python are unrate-limited. Scope = **SEAM +
JOB + RATE** (CRON deferred, founder 2026-07-25). Research-first. **Next:** define
requirements → roadmap.

<details>
<summary>Stale pre-v1.9 close context (retained; authoritative history is MILESTONES.md + milestones/)</summary>

**Active milestone: v1.7 Deribit Exchange Coverage & Carry-Forward Burn-Down** (started 2026-07-04;
Phases 66+; see ## Current Milestone above). Prior close context below.

**v1.6 Scenario Series-Space Purification closed 2026-07-04** (tag `v1.6` @
`f78f036b`, app version v0.36.0.0, single PR #572; audit PASSED 16/16 reqs · 4/4 phases · 6/6
integration seams; live canary GUARD-04 clean, 0 bugs). The scenario tab now operates purely in
series space: saved drafts persist explicit per-key membership (`memberKeyIds`, schema v4,
non-destructive upgrades), ONE `buildAddedOnlySet` engine feeds composer/compare/share (the
holdings-snapshot builder + scenario-dealias machinery are deleted with a source-scan guard against
reintroduction), the KPI strip is return-form only (commit weight×AUM boundary intact), and public
mixed shares carry the honesty caption with zero member-UUID leakage. The frozen engine stayed
zero-diff the whole milestone (vs `e5e83247`). A pre-landing Fable red team caught F-1 (blank-session
Update silently wiping book membership); fixed at the root, verified live at the persisted layer.
Archived at `milestones/v1.6-ROADMAP.md` / `v1.6-REQUIREMENTS.md` / `v1.6-MILESTONE-AUDIT.md` /
`v1.6-phases/`.

**Deferred at close (tracked in TODOS.md, git-tracked):** P1 dead `holdingReturnsByScopeRef` SSR
pipeline removal (planning-locked KEEP through v1.6); P2 dead share-mint `isBookOnlyDraft` disjunct
(red-team F-3); P3 >64-key save-cap misleading error (F-5); P3 deploy-skew membership
strip/downgrade window (F-4). Planning-ledger only: `holdingsSummary` SSR removal; 6 `phase10-rpc-*`
residue auth.users rows; D3 persist source-toggles; friendly gantt key labels (P61 B1);
compare-panel payload-cast type-safety (AllocationsTabs.tsx:964). Standing human checkpoints carried
from v1.4/v1.5: real-device authed sign-off; deliberate golden-PNG re-baseline.

**Next:** v1.7 requirements → roadmap (in progress). Phase numbering continues from Phase 66 (no
reset). The v1.6 deferred list above is now IN SCOPE for v1.7 (carry-forward burn-down).

**Baseline (locked):** the frozen engine (`src/lib/scenario.ts` + `scenario-window.ts`, coverage-window
model, zero-diff again post-v1.5) + save/compare/share/stress/Monte-Carlo/optimizer (v1.1.0) + the
unified composer (v1.2) + the per-key honest source (v1.2.1) + the real-factsheet-on-the-blend
(v1.2.2) + the mobile/adaptive layer (v1.3) + the evolved design system & fluid token spine (v1.4) +
honest coverage-window membership with durable windows (v1.5) — reuse, never rebuild. The
no-invented-data invariant stays LOCKED; the no-peer-rank invariant has its one audited AGGREGATE
override (`scenarioPeer`, never `ingestSource`). `compute.ts`/`FactsheetBody` parity (BODY-02) and
the WCAG-AA floor stay green.

</details>

---
*Last updated: 2026-07-25 — v1.16 Production Resilience & Reliability milestone opened (scope: SEAM + JOB + RATE; CRON deferred; runner-up Money-Path Correctness Unification deferred). Current Milestone + Current State rewritten for v1.16; phase numbering continues from 140. NOTE: this document's older shipped-milestone sections still jump v1.12 → v1.10 and the `### Active` (v1.7/v1.8) / `## Last Shipped Milestone: v1.6` sections remain stale from the pre-v1.9 ledger-reconciliation gap — full shipped history (v1.13/v1.14/v1.15 included) is authoritative in `MILESTONES.md` + `milestones/`.*
