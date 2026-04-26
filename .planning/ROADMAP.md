# Roadmap: Quantalyze

## Milestones

- ✅ **v0.14.0.0 Sprint 8: Bridge V2** — Phases 1–5 (shipped 2026-04-19) → [archive](milestones/v0.14.0.0-ROADMAP.md)
- 🚧 **v0.15.0.0 Sprint 9: Demo-to-Production** — Phases 06–11 (in progress, started 2026-04-19)

## Phases

<details>
<summary>✅ v0.14.0.0 Sprint 8: Bridge V2 (Phases 1–5) — SHIPPED 2026-04-19</summary>

- [x] Phase 1: Outcome Tracker (4/4 plans) — completed 2026-04-18
- [x] Phase 2: Mandate Profile Builder (2/2 plans) — completed 2026-04-18
- [x] Phase 3: Mandate-Aware Scoring Engine (2/2 plans) — completed 2026-04-18
- [x] Phase 4: Feedback Loop (1/1 plan) — completed 2026-04-19
- [x] Phase 5: Outcomes Dashboard (1/1 plan) — completed 2026-04-19

See `milestones/v0.14.0.0-ROADMAP.md` for full phase details, success criteria, and decisions.

</details>

### 🚧 v0.15.0.0 Sprint 9: Demo-to-Production (Phases 06–11)

**Milestone goal:** Every surface an allocator touches works end-to-end with real data. A brand-new institutional LP can sign up, connect a read-only exchange API key, see Performance populate, and use a Scenario tab to run what-if analyses that commit through the Bridge outcome-recording flow. No seed fallback anywhere.

**Success gate (single E2E):** fresh signup → connect API key → Performance tab populates → open Scenario tab → toggle a holding off → add a Bridge-recommended strategy → commit scenario → outcome recorded — within 10 minutes.

- [x] **Phase 06: Allocator API Ingestion** — new `allocator_holdings` table, `poll_allocator_positions` compute-job kind, real CCXT worker path, sync orchestration (completed 2026-04-21)
- [x] **Phase 07: Demo-Mode Purge** — rewire dashboard off seed UUIDs, tabbed `/allocations` (Performance + Scenario), single Connect Exchange CTA empty state, stop new-user seeding
- [x] **Phase 08: Connection Management and Notes** — `/connections` list/resync/revoke/delete, multi-scope `user_notes` surface (portfolio / holding / bridge_outcome / strategy)
- [x] **Phase 09: Bridge Live Against Real Holdings** — `match_engine` reads from `allocator_holdings`, live Bridge summary strip on Performance, outcome recording wired against real rows (completed 2026-04-21)
- [ ] **Phase 10: Scenario Builder and What-If** — Scenario tab on `/allocations`, toggle/add/browse composition, projected KPI deltas vs live baseline, commit-through-Bridge flow
- [ ] **Phase 11: Onboarding and Security Readiness** — Connect Exchange nudge, mandate quick-set, `/security` audit, full state matrix, PostHog onboarding funnel, Playwright E2E in CI

## Phase Details

### Phase 06: Allocator API Ingestion
**Goal:** A brand-new allocator can add a read-only exchange API key and, within one sync cycle, have real holdings written to the database via an idempotent, RLS-safe, owner-scoped worker path.
**Depends on:** Nothing (foundation — blocks 07, 08, 09, 10).
**Requirements:** INGEST-01, INGEST-02, INGEST-03, INGEST-04, INGEST-05, INGEST-06, INGEST-07, INGEST-08, INGEST-09
**Success Criteria** (what must be TRUE):
  1. An allocator who adds a read-only exchange API key sees real holdings populate in the database within one sync cycle (first-run is a full snapshot).
  2. Clicking "Sync now" on the exchange manager triggers a real poll (no longer a no-op) and re-syncs run daily on cron for every active allocator API key.
  3. When a key is revoked, rate-limited, or the exchange is down, the allocator sees a surfaced error state with a human-readable reason — the sync does not silently succeed.
  4. Allocator A cannot read allocator B's holdings via any direct SELECT, and a regression test proves it.
  5. Re-running a sync on the same day produces identical holdings rows (idempotent upsert on venue/symbol/asof).
**Plans:** 4/4 plans complete

Plans:
- [x] 06-01-PLAN.md — Migration 066 + schema push + audit taxonomy sync + query-layer column projection
- [x] 06-02-PLAN.md — FastAPI worker: Deribit + allocator_positions.py + job_worker.py extension + pytest
- [x] 06-03-PLAN.md — POST /api/allocator/holdings/sync route + RLS regression Vitest
- [x] 06-04-PLAN.md — AllocatorExchangeManager UI: 7-state pill + Sync now button + first-run sync + 5s polling
**Complexity:** High — new schema, new compute-job kind, CHECK-constraint extension, CCXT worker integration, RLS + self-verifying DO block.

### Phase 07: Demo-Mode Purge
**Goal:** The authenticated `/allocations` dashboard derives every number it shows from real allocator holdings and Bridge tables — zero seed fallback — and the page is tabbed so Performance (daily monitoring) and Scenario (what-if) are first-class surfaces.
**Depends on:** Phase 06 (requires `allocator_holdings` to read from).
**Requirements:** PURGE-01, PURGE-02, PURGE-03, PURGE-04, PURGE-05, PURGE-06, PURGE-07
**Success Criteria** (what must be TRUE):
  1. A brand-new allocator with zero holdings sees a real empty state on `/allocations` with a single "Connect Exchange" CTA — no ghost widgets, no seed numbers.
  2. After Phase 06 ingestion completes, the Performance tab's KPI strip, equity curve, drawdown chart, and "What We Noticed" card all populate from real allocator data.
  3. `/allocations` is tabbed with Performance default and Scenario secondary; tab state survives a full page reload and back/forward navigation.
  4. No authenticated code path still branches on `ALLOCATOR_ACTIVE` or seed UUIDs — the seed surface exists only for marketing `/demo` routes and unit-test fixtures.
  5. New-user signup no longer populates a seed portfolio; the first `/allocations` visit always shows the real empty state.
**Plans:** 6 plans

**Wave structure (post VOICES-ACCEPTED gB2 revision):**
- Wave 1: 07-01 (migration + RLS + schema push, incl. `history_depth_months` column per f9, key-scoped `refresh_allocator_equity_daily` per f1) **‖** 07-06 (seed-integrity audit + OnboardingWizard noseed + migration co-occurrence scan per f4) — parallel
- Wave 2: 07-02 (FastAPI worker, per-key handlers per f1, `history_depth_months` recording per f9, env-gated live + integration tests per f5)
- Wave 3: 07-03 (query rewire + `equitySnapshotsToDailyPoints` adapter per f7 + KpiStrip venue-specific warm-up per f9 + EquityCurve/DrawdownChart parallel-prop per f7)
- Wave 4: 07-04 (tabs + `activeTab` derived each render per f3 + widget-gating for 18 strategy-composite widgets per f2)
- Wave 5: 07-05 (EmptyState + stale overlay + D-09 Notices card)

Plans:
- [x] 07-01-PLAN.md — Migration 070 allocator_equity_snapshots (incl. history_depth_months) + token_price_history + 3-tier RLS + 2 new job-kinds (both key-scoped per VOICES f1) + refresh-equity cron (key fan-out) + request_allocator_holdings_sync extension + schema push ✓ (applied live, TDD RLS gate GREEN)
- [x] 07-02-PLAN.md — FastAPI worker equity_reconstruction.py (per-key handlers per VOICES f1) + ccxt fetch (trades/deposits/withdrawals/OHLCV) + CoinGecko fallback + history_depth_months recording (f9) + env-gated live + integration tests (f5) ✓ (9/9 TDD Red gate GREEN; both env-gated suites committed skipped)
- [x] 07-03-PLAN.md — getMyAllocationDashboard Phase 07 payload rewire (9 new fields) + equitySnapshotsToDailyPoints adapter (f7) + KpiStrip warm-up rendering w/ venue-specific copy (f9) + formatPercent(null) verification-only (f8) ✓ (100 tests GREEN across 6 files; !portfolio branch rewritten to return full Phase 07 shape; PURGE-02 + PURGE-03)
- [x] 07-04-PLAN.md — /allocations tabbed (Performance + Scenario stub; activeTab derived each render per f3) + Suspense wrap + URL ?tab param + widget-gating for 18 strategy-composite widgets (f2) + equityDailyPoints forwarded to EquityCurve/Drawdown (f7) (PURGE-07) ✓ (AllocationsTabs + ScenarioStub + STRATEGY_COMPOSITE_WIDGETS gate landed; 11 new tests GREEN; allocations cohort 17 files / 159 tests)
- [x] 07-05-PLAN.md — EmptyState component (Connect Exchange CTA → /profile?tab=exchanges) + zero/stale insights behaviour + chart stale overlay (PURGE-04 / D-07..D-11) ✓ (EmptyState two-branch + zero+idle short-circuit + zero+syncing InfoBanner + data+stale WarningBanner+chart overlay+KPI `—` protective triple + D-09 Notices card; 4/4 TDD GREEN; allocations cohort 18 files / 163 tests; PURGE-04)
- [x] 07-06-PLAN.md — seed-integrity.test.ts import-graph scan + migration co-occurrence audit (f4) + OnboardingWizard noseed regression (wave=1 per VOICES gB2) (PURGE-01 / PURGE-05 / PURGE-06) ✓ (7 seed-integrity tests + 5 OnboardingWizard tests GREEN; zero production code changed)
**UI hint**: yes
**Complexity:** Medium — mostly rewiring queries, but touches many call sites and introduces a tabbed layout on the central dashboard page.

### Phase 08: Connection Management and Notes
**Goal:** Allocators have a production-grade settings surface for their connections (list / resync / revoke / delete) and a multi-scope notes capability that works across portfolio, holdings, bridge outcomes, and strategies.
**Depends on:** Phase 06 (connections need real keys + holdings to manage).
**Requirements:** MANAGE-01, MANAGE-02, MANAGE-03, MANAGE-04, MANAGE-05, MANAGE-06
**Success Criteria** (what must be TRUE):
  1. An allocator can visit `/connections`, see every connected API key with venue / last-sync / status, and perform resync, revoke, and delete actions per key.
  2. Revoking an API key stops future syncs and marks historical holdings as stale in the UI while retaining them for audit continuity; deleting a key cascades future syncs but preserves historical rows.
  3. An allocator can attach a markdown note to their portfolio, to any individual holding, to any Bridge outcome row, or to any strategy — and the note auto-saves on blur.
  4. Every note write is audit-logged via `log_audit_event` and enforced by owner-RLS (other allocators cannot read or modify).
  5. Portfolio-scope notes appear pinned on `/allocations`; holding-scope notes appear inline on the holdings row; outcome-scope notes appear on the outcomes timeline.
**Plans:** 5/5 plans complete

**Wave structure:**
- Wave 1: 08-01 (migration 071 + /api/notes rewrite + ADR-0023 sync + RLS regression test + schema push) ‖ 08-02 (Disconnect rename + cascade-optional modal + HoldingsTable with revoked-key strikethrough + amber chip + localStorage toggle) — parallel, zero file overlap
- Wave 2: 08-03 (NoteRender + useNoteAutoSave + NoteSaveStatus shared components + NotesWidget upgrade in place + LAYOUT_VERSION bump)
- Wave 3: 08-04 (HoldingNoteRow inline expandable + OutcomesWidget "Your note" section + StrategyNoteCard on /strategy/[id] + full-suite sign-off)
- Wave 4: 08-05 (VERIFICATION gap closure — lazy GET on mount in HoldingNoteRow mirroring BridgeOutcomeNoteSection; regression test for holding-note read-back) — sequential after 08-04

Plans:
- [x] 08-01-PLAN.md — Migration 071 user_notes multi-scope + /api/notes rewrite (per-scope ownership + zod) + ADR-0023 four-kind taxonomy sync + live-DB RLS regression + markdown deps pin — requirements MANAGE-04, MANAGE-06 — **COMPLETE 2026-04-21** (migration 071 live · DO-NOTICE verified · 59/59 Plan 01 tests green · typecheck + lint clean · react-markdown@10.1.0 + rehype-sanitize@6.0.0 + remark-gfm@4.0.1 exact-pinned · atomic D-23 commit ae25a79)
- [x] 08-02-PLAN.md — Disconnect rename + cascade-optional modal + HoldingsTable with revoked-key UI + allocations.showRevokedHoldings toggle — requirements MANAGE-01, MANAGE-02, MANAGE-03 — **COMPLETE 2026-04-21** (45/45 Plan 02 tests green · 245/245 allocations+exchanges surface green · typecheck + lint clean · 4 commits 21892b3/871505a/1a63317/3ac6a94 · UI-SPEC §1+§2 copy locked · D-04 historical-inclusion invariant verified T12 · D-05 default-ON verified T8)
- [x] 08-03-PLAN.md — Shared notes primitives (NoteRender + useNoteAutoSave + NoteSaveStatus + sanitize-schema + prose-note CSS) + NotesWidget upgrade + LAYOUT_VERSION 2→3 + default layout notes-1 tile — requirements MANAGE-04, MANAGE-05, MANAGE-06 — **COMPLETE 2026-04-21** (21/21 notes-primitives tests + 11/11 meta.test.tsx + 204/204 combined run green · typecheck + lint clean · 4 commits 6566f77 RED + 966d731/f993708/0d8b512 GREEN per TDD cadence · S2 unmount-flush contract pinned via JSDoc + test · MANAGE-05 completed)
- [x] 08-04-PLAN.md — Per-scope UI surfaces: HoldingNoteRow inline expandable + OutcomesWidget Your-note section + StrategyNoteCard on /strategy/[id] + full Phase 08 verification — requirements MANAGE-05 — **COMPLETE 2026-04-21** (43/43 targeted Plan 04 tests + 1535/1535 full vitest suite across 155 files green · typecheck + lint clean · 6 commits 676efb0/98dd60d/e9586ff/24b61cc/cb40739/f72754a strict TDD RED→GREEN per task · MANAGE-05 continuation complete · Phase 08 ready for /gsd-secure-phase 08)
- [x] 08-05-PLAN.md — GAP CLOSURE: lazy GET on mount in HoldingNoteRow (mirrors BridgeOutcomeNoteSection pattern — cancelled flag + useEffect + 404-as-empty) + regression test asserting saved holding-note content re-appears after sub-row re-open — requirements MANAGE-05 (holding-scope read-back, closes VERIFICATION gaps[0] / IN-04) — **COMPLETE 2026-04-21** (15/15 HoldingNoteRow tests green · 1539/1539 full vitest suite across 158 files green · typecheck + lint clean · 3 commits 2eb38f9 RED / 278c819 GREEN / 09c737c SUMMARY per TDD cadence · option (a) shipped · option (b) server-side prefetch deferred to Phase 11+ · icon-state follow-up deferred · VERIFICATION gaps[0] CLOSED)
**UI hint**: yes
**Complexity:** Medium — `user_notes` multi-scope reshape + markdown render introduction + 4-surface autosave pattern mirrored from Phase 02 mandate.

### Phase 09: Bridge Live Against Real Holdings
**Goal:** The Bridge (`match_engine.py` v2.0.0) runs against real allocator holdings from `allocator_holdings` and surfaces live recommendations for underperformers and mandate breaches on the Performance tab, with outcome recording correctly wired to real holding rows.
**Depends on:** Phase 07 (dashboard reads real data); Phase 06 transitively (needs `allocator_holdings` rows).
**Requirements:** LIVE-01, LIVE-02, LIVE-03, LIVE-04, LIVE-05
**Success Criteria** (what must be TRUE):
  1. After an allocator's holdings sync in, `score_candidates(allocator_id)` reads from `allocator_holdings`, applies mandate constraints, and returns ranked replacement candidates via scoring v2.0.0.
  2. The Performance tab shows a compact Bridge summary strip ("N holdings flagged — Review in Scenario") whenever any holding underperforms or breaches a mandate constraint (max_weight, correlation ceiling, or style exclusion); clicking opens the Scenario tab.
  3. An allocator can deep-dive any flagged holding via `/compare?ids=<held>,<candidate>` from the Scenario tab and return without losing tab state.
  4. Inline `AllocatedForm` / `RejectedForm` / outcome banner (shipped in Sprint 8) function correctly when the underlying row is from `allocator_holdings` — no seed-table dependency.
  5. Recording an outcome on a real holding flows through the daily delta cron and produces real 30/90/180-day realized deltas.
**Plans:** 4/4 plans complete

**Wave structure:**
- Wave 1: 09-01 (migration 072 + migration 073 + ADR-0023 sync + live-DB XOR & cron regressions — atomic D-23-style commit; schema foundation + `[BLOCKING] supabase db push`)
- Wave 2: 09-02 (engine input-layer rewire — `_load_allocator_context` reads `allocator_holdings` + reconstructs per-symbol returns from `allocator_equity_snapshots.breakdown` + synthesizes pseudo-strategies + `ENGINE_VERSION` bump to v2.1.0 + pytest golden) ‖ 09-03 (UI: InsightStrip flagged line + `ScenarioFlaggedHoldingsList.tsx` + `holding-outcome-adapter.ts` + payload extension + Vitest RTL) — parallel after 09-01
- Wave 3: 09-04 (`/compare` parser extension + holding-rendering branch + access-gate Vitest live-DB)

Plans:
- [x] 09-01-PLAN.md — Migration 072 (match_decisions.original_holding_ref + XOR CHECK + partial index + DROP NOT NULL) + Migration 073 (compute_bridge_outcome_deltas holding branch) + Migration 074 (match_decisions symmetric UNIQUE widening) + ADR-0023 sync + supabase db push + live-DB XOR & cron regressions (LIVE-04, LIVE-05)
- [x] 09-02-PLAN.md — `_load_allocator_context` rewire + reconstruct_symbol_returns helper + pseudo-strategy synthesis (D-01) + warm-up gate + FLAG_COMPOSITE_THRESHOLD = 50 + ENGINE_VERSION v2.1.0 bump + pytest golden (LIVE-01)
- [x] 09-03-PLAN.md — holding-outcome-adapter.ts + InsightStrip "Bridge flagged N holding(s) — Review in Scenario →" + ScenarioFlaggedHoldingsList (BannerSubRow state machine) + ScenarioStub body branch + getMyAllocationDashboard payload extension + AllocationDashboard thread-through + Vitest RTL (LIVE-02, LIVE-04)
- [x] 09-04-PLAN.md — /compare parser extension + holding-compare-adapter.ts (parseHoldingCompareId + fetchHoldingCompareItem) + HoldingFactsheet.tsx + CompareTable discriminated-union branch + Vitest RTL mixed-items render + live-DB RLS access-gate regression (LIVE-03)
**Complexity:** Medium — primarily input-layer wiring (scoring engine is already v2.0.0); risk concentrated in the holdings→candidates adapter and ensuring Bridge V2 components work against a new row shape.

### Phase 09.1: Allocator Dashboard UI refresh — implement designer-provided Allocator Dashboard.html reference (INSERTED)

**Goal:** Land the designer-provided Allocator Dashboard vision on `/allocations` (new 4-col snap-grid, 6-tab structure, restyled KpiStrip + SVG EquityChart + HoldingsTable with 3-tab row-expand, Bridge hero widget + 2-stage drawer, widget picker covering all 50+ widgets) behind an `allocations.ui_v2` feature flag — so Phase 10 Scenario Builder builds on top of the refreshed shell instead of the legacy one.
**Requirements**: TBD (decisions D-01..D-20 from 09.1-CONTEXT.md drive the work; no REQ-IDs were pre-minted)
**Depends on:** Phase 9
**Plans:** 11/11 plans complete

Plans:
- [x] 09.1-01-PLAN.md — Feature flag (allocations.ui_v2) + V2 shell scaffold + "+ Allocation" button routing (D-17 / D-20)
- [x] 09.1-02-PLAN.md — AllocationsTabs 2 → 6 tabs (Overview/Holdings/Outcomes/Mandate/Risk/Scenario) + 4 tab-body stubs (D-05 / D-06)
- [x] 09.1-03-PLAN.md — LAYOUT_VERSION 3 → 4 + TileConfig {k, w} shape + useDashboardConfigV2 (D-02 / D-03)
- [x] 09.1-04-PLAN.md — holdings-adapter.ts pure transform (holdingsSummary × flaggedHoldings × matchDecisions × strategies) (D-18)
- [x] 09.1-05-PLAN.md — 4-col CSS-grid WidgetGrid + WidgetChrome + SizeStepper + WidgetPicker; full AllocationDashboardV2 body (D-01 / D-04 / D-08)
- [x] 09.1-06-PLAN.md — KpiStrip 5-cell rewrite (AUM / YTD TWR / Sharpe / Max DD 12m / Avg ρ) with Phase 07 warmup preserved (D-09)
- [x] 09.1-07-PLAN.md — SVG EquityChart + CustomRangePicker + f7 parallel-prop preserved; intraday deferred (D-10)
- [x] 09.1-08-PLAN.md — HoldingsTable + HoldingDetail 3-tab row-expand (Metrics / Record outcome / Notes) + OutcomeForm (D-11 / D-12 / D-13)
- [x] 09.1-09-PLAN.md — BridgeWidget hero + BridgeDrawer 2-stage slide-over; fix app.jsx:131 no-breaches restore (D-14 / D-15 / D-16)
- [x] 09.1-10-PLAN.md — OutcomesWidget restyle + Mandate/Risk/Scenario tab bodies (D-06 / D-07)
- [x] 09.1-11-PLAN.md — Tweaks panel (QA-mode gated, postMessage stripped) + sidebar flagged-count badge (D-19)

### Phase 10: Scenario Builder and What-If
**Goal:** Allocators can open the Scenario tab on `/allocations`, compose a draft portfolio (toggle current holdings off, add Bridge-recommended or browse-selected strategies), see projected KPI / equity-curve / drawdown deltas vs the live baseline, and commit — with each diff routed through the existing Bridge outcome-recording flow.
**Depends on:** Phase 07 (tabbed `/allocations`); Phase 09 (Bridge recommendations to surface in the scenario); Phase 08 (notes surface for outcome-scope notes).
**Requirements:** SCENARIO-01, SCENARIO-02, SCENARIO-03, SCENARIO-04, SCENARIO-05, SCENARIO-06, SCENARIO-07, SCENARIO-08, SCENARIO-09
**Success Criteria** (what must be TRUE):
  1. Opening the Scenario tab initializes a draft composition from the allocator's current live holdings — distinct from the live portfolio, with every holding enabled by default.
  2. An allocator can toggle any current holding on/off in the scenario and add any Bridge-recommended or browse-selected verified strategy — the live portfolio remains untouched throughout.
  3. The scenario composition computes and displays projected KPIs (AUM, TWR, CAGR, Sharpe, Sortino, Max DD, Vol, Score) plus equity curve and drawdown, with delta badges shown against the live baseline (e.g. "+0.3 Sharpe · −4% Max DD").
  4. Clicking "Commit scenario" routes each diff through the existing Bridge outcome-recording flow — `RejectedForm` for removals, intro flow + `AllocatedForm` for additions — and every committed decision appears in the outcomes timeline.
  5. Scenario state persists across reload via localStorage (no DB persistence); "Reset scenario" discards the draft and reinitializes from current live holdings.
**Plans:** 8 plans

**Wave structure:**
- Wave 1: 10-01 (scenario-state + scenario-adapter + holding-outcome-adapter voluntary kinds — pure TS modules) ‖ 10-02 (migration 080 match_decisions kind enum + ADR-0023 sync + schema push + voluntary_add cron deferral) ‖ 10-03 (queries.ts holdingReturnsByScopeRef payload extension + GET /api/strategies/browse route) — parallel, zero file overlap
- Wave 2: 10-04 (KpiStrip mode='scenario' + EquityChart scenarioSeries + DrawdownChart scenarioDailyPoints — additive prop extensions)
- Wave 3: 10-05 (StrategyBrowseDrawer + BridgeDrawer 'Add to scenario' CTA + mandate-fit.ts client-side approximation)
- Wave 4: 10-06a (useScenarioState hook + ScenarioFooter sticky bar — per-allocator scoped localStorage persistence + diff-count summary)
- Wave 5: 10-06b (ScenarioComposer body assembly with B4-pinned adapter signature + AllocationsTabs v2-flag branch wiring)
- Wave 6: 10-07 (POST /api/allocator/scenario/commit + ScenarioCommitDrawer + composer wire-in + live-DB RLS regression — closes SCENARIO-07)

Plans:
- [x] 10-01-PLAN.md — scenario-state.ts (draft + per-allocator scoped localStorage + fingerprint) + scenario-adapter.ts (holdings + addedStrategies → StrategyForBuilder[] via lookup-map signature) + holding-outcome-adapter.ts voluntary kind synthetic shapes
- [x] 10-02-PLAN.md — Migration 080 match_decisions kind enum + 4 per-kind CHECK constraints + ADR-0023 sync + [BLOCKING] schema push + voluntary_add cron-coverage deferral in CONTEXT.md ## Deferred Ideas
- [x] 10-03-PLAN.md — getMyAllocationDashboard payload extension (holdingReturnsByScopeRef) + GET /api/strategies/browse route + reconstruction helper unit tests
- [ ] 10-04-PLAN.md — KpiStrip mode='scenario' delta pills + EquityChart scenarioSeries overlay + DrawdownChart scenarioDailyPoints overlay + 3-state visibility toggles (additive extensions)
- [ ] 10-05-PLAN.md — StrategyBrowseDrawer 620px slide-over (search + filters + mandate-fit pill) + BridgeDrawer 'Add to scenario' CTA + mandate-fit.ts client-side approximation
- [ ] 10-06a-PLAN.md — useScenarioState hook (per-allocator scoped storage key, auth-change clear) + ScenarioFooter sticky bar (diff count + delta summary + Reset/Commit)
- [ ] 10-06b-PLAN.md — ScenarioComposer body assembly (KpiStrip + charts + composition list + Bridge inline + Browse drawer + footer + reset modal + fingerprint banner) + AllocationsTabs v2-flag branch wiring (ScenarioComposer | ScenarioStub)
- [ ] 10-07-PLAN.md — POST /api/allocator/scenario/commit (discriminated zod + per-kind ownership gates + admin client + audit) + ScenarioCommitDrawer 720px grouped sections + composer wire-in + live-DB RLS regression
**UI hint**: yes
**Complexity:** High — new tab surface, client-side projection engine reusing the PURGE-02 returns_series + price-oracle pipeline, diff-routing through existing Bridge components, localStorage resume semantics.

### Phase 11: Onboarding and Security Readiness
**Goal:** A real LP's first 10 minutes are friction-free and credible, every allocator-facing widget renders correctly in all five states (loading / empty / partial / error / success), and the end-to-end acceptance test runs in CI.
**Depends on:** Phase 10 (E2E covers the full signup → API key → Performance → Scenario → commit → outcome flow).
**Requirements:** ONBOARD-01, ONBOARD-02, ONBOARD-03, ONBOARD-04, ONBOARD-05, ONBOARD-06
**Success Criteria** (what must be TRUE):
  1. A brand-new allocator's first authenticated `/allocations` visit proactively nudges the Connect Exchange flow (dismissable but re-surfaced until the first key connects) and pre-populates a mandate quick-set with sensible defaults.
  2. The `/security` page surfaces SOC-2 status, key-encryption details, IP allowlisting option, audit-log export link, and a withdrawal-permission warning on every API-key add step — reflecting existing truth, not new attestations.
  3. Every allocator-facing widget renders correctly in loading, empty, partial, error, and success states — no ghost-town screens.
  4. PostHog records the onboarding funnel events `signup` → `first_api_key_added` → `first_sync_success` → `first_bridge_surfaced` → `first_outcome_recorded` for every new allocator cohort.
  5. The full Playwright E2E (signup → API key add → Performance populated → Scenario toggle+add → commit → outcome recorded) runs green in CI on every PR.
  6. **Cron consolidation (added 2026-04-26 after Vercel Pro upgrade):** Railway analytics-service workers + any shim cron routes are migrated to Vercel-native crons. Pro tier removes the prior 2-cron limit that forced the dual-path architecture (Railway + shim). Deferred-items "Dual cron path" entry resolves on completion.
**Plans:** 4 plans

Plans:
- [ ] 06-01-PLAN.md — Migration 066 + schema push + audit taxonomy sync + query-layer column projection
- [ ] 06-02-PLAN.md — FastAPI worker: Deribit + allocator_positions.py + job_worker.py extension + pytest
- [ ] 06-03-PLAN.md — POST /api/allocator/holdings/sync route + RLS regression Vitest
- [ ] 06-04-PLAN.md — AllocatorExchangeManager UI: 7-state pill + Sync now button + first-run sync + 5s polling
**UI hint**: yes
**Complexity:** Medium — polish work is fragmented across widgets; CI wire-up for Playwright is a known-unknown (4 of 21 specs currently run).

## Structural decision: 6-phase roadmap (Option B)

**Chosen:** Option B — split LIVE (Phase 09) and SCENARIO (Phase 10) into separate phases.

**Rationale:** SCENARIO is a net-new product surface (tabbed `/allocations`, client-side projection engine, commit-to-Bridge flow) with 9 REQs that materially exceed what a shared phase with LIVE (5 REQs) could absorb — a combined 14-REQ phase would be roughly 2× the average phase size in this milestone (INGEST 9, PURGE 7, MANAGE 6, ONBOARD 6). Splitting lets each phase run its own `/gsd-discuss-phase` → `/gsd-plan-phase` → ship cycle with its own PR under `branching_strategy: none`, and lets LIVE (Bridge wire-up, smaller and well-scoped) ship independently so SCENARIO can build on a proven live-holdings Bridge instead of a paper one.

**Trade-off accepted:** 6 phases instead of 5 means one additional discuss/plan cycle — but each phase is now a clean discrete unit of work rather than a grab-bag.

## Progress

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Outcome Tracker | v0.14.0.0 | 4/4 | Complete | 2026-04-18 |
| 2. Mandate Profile Builder | v0.14.0.0 | 2/2 | Complete | 2026-04-18 |
| 3. Mandate-Aware Scoring Engine | v0.14.0.0 | 2/2 | Complete | 2026-04-18 |
| 4. Feedback Loop | v0.14.0.0 | 1/1 | Complete | 2026-04-19 |
| 5. Outcomes Dashboard | v0.14.0.0 | 1/1 | Complete | 2026-04-19 |
| 06. Allocator API Ingestion | v0.15.0.0 | 4/4 | Complete    | 2026-04-21 |
| 07. Demo-Mode Purge | v0.15.0.0 | 6/6 | Complete | 2026-04-20 |
| 08. Connection Management and Notes | v0.15.0.0 | 5/5 | Complete    | 2026-04-21 |
| 09. Bridge Live Against Real Holdings | v0.15.0.0 | 4/4 | Complete    | 2026-04-21 |
| 10. Scenario Builder and What-If | v0.15.0.0 | 0/? | Not started | — |
| 11. Onboarding and Security Readiness | v0.15.0.0 | 0/? | Not started | — |
