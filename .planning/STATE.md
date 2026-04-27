---
gsd_state_version: 1.0
milestone: v0.17.0.0
milestone_name: "Sprint 12: KPI Parity and Discovery v2"
status: completed
last_updated: "2026-04-27T09:02:28.690Z"
last_activity: 2026-04-26 — gsd-roadmapper applied 6 convergent fixes from cross-AI review (Phase 14 split into 14a + 14b, is_maker audit rescoped to 3 exchanges, METRICS-16/17 promoted to hard deliverables, success criteria tightened with automated checks, organizations.is_public conditional gate added for DISCO-03)
progress:
  total_phases: 4
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-26 at v0.17.0.0 milestone start)

**Core value:** Allocators act on Bridge recommendations and see whether those suggestions actually worked.
**Current focus:** v0.17.0.0 Sprint 12 — KPI Parity and Discovery v2 (roadmap revised post cross-AI review, ready for phase planning)
**Concurrent on `main`:** v0.16.0.0 Phase 11 (Onboarding + Security Readiness) executing in parallel — independent surface area, not a blocker.

## Current Position

Phase: Phase 12 — Backend Metric Contracts (METRICS-01..17)
Plan: —
Status: Roadmap complete (4-phase structure post cross-AI review); awaiting `/gsd-plan-phase 12` (or `/gsd-plan-phase 13` to start Discovery v2 in parallel)
Last activity: 2026-04-26 — gsd-roadmapper applied 6 convergent fixes from cross-AI review (Phase 14 split into 14a + 14b, is_maker audit rescoped to 3 exchanges, METRICS-16/17 promoted to hard deliverables, success criteria tightened with automated checks, organizations.is_public conditional gate added for DISCO-03)

## Milestone Summary (v0.17.0.0)

**Plan source:** `~/.claude/plans/strategy-teams-kpi-parity.md` (CEO + Design + Eng + DX dual-voice review, 8 User Challenges resolved 2026-04-26) + parallel research outputs in `.planning/research/` (4 researchers + synthesis SUMMARY.md). Revised 2026-04-26 post cross-AI review (fresh Claude subagent + Grok-4-1-fast-reasoning) returning APPROVE-WITH-REVISIONS — 6 convergent fixes applied.

**Scope:** T7 (Discovery v2) + T8a (backend metric contracts) + T8b (Single-Strategy v2 UI 7-panel parity), expanded to full qstats parity per user direction "ship all panels, full quantstats" 2026-04-26.

**Net session estimate:** ~8.0 sessions (Phase 12: 4.0, Phase 13: 0.5, Phase 14a: 2.0, Phase 14b: 1.5). Bumped from 6.5 to 8.0 post-review on Phase 14 split into 14a + 14b.

**Coverage:** 53 / 53 REQs mapped (DISCO-01..05 + KPI-01..05 + KPI-22 + KPI-23a + KPI-06..21 + KPI-23b + METRICS-01..17 + DESIGN-01..03 + A11Y-01..03 + CLEANUP-01).

**Wave structure:**

- Wave 1 (parallel — independent code surfaces): Phase 12 (Python analytics-service) ‖ Phase 13 (TypeScript Discovery)
- Wave 2 (sequential — UI consumes Phase 12 JSONB keys + sibling table): Phase 14a (eager panels 1–3 + identity baseline + 7-panel scrollable shell)
- Wave 3 (sequential after 14a): Phase 14b (lazy panels 4–7 + Trade Mix close-out + axe-core CI on full route)

| Phase | Goal | REQs | Depends on | Complexity |
|-------|------|------|------------|------------|
| 12. Backend Metric Contracts | `metrics.py` ships every scalar/series the v0.17 UI needs (rolling Sortino/Vol/Greeks, daily-grid, exposure & turnover series, full trade aggregations, 10 missing qstats scalars), parity-tested cross-runtime, with throttled backfill via `compute_jobs.priority` enum (METRICS-16, migration 086) and heavy-series sibling table `strategy_analytics_series` (METRICS-17, migration 087) | 17 (METRICS-01..17) | Nothing | High |
| 13. Discovery v2 Polish | `/discovery/[slug]` reaches Quants.Space IA parity (Watchlist sub-tab, per-user Customize prefs, single-accent sparkline rule, default Hide Examples, audit-gated filter-by-team with privacy gate via conditional migration 088 `organizations.is_public`) | 5 (DISCO-01..05) | Nothing | Low |
| 14a. Single-Strategy v2 — Eager Panels + Identity | `/strategy/[id]/v2` ships 7-panel scrollable shell with eager bodies for panels 1–3 (Overview / Headline+Equity / Drawdown), placeholders for panels 4–7 (IntersectionObserver scaffold), DESIGN.md identity baseline, A11Y-01 chart-axis contrast, partial-data states for panels 1–3, `@nivo/boxplot` cleanup | 12 (KPI-01..05 + KPI-22 + KPI-23a + DESIGN-01..03 + A11Y-01 + CLEANUP-01) | Phase 12 | Medium |
| 14b. Single-Strategy v2 — Lazy Panels + Trade & Exposure | Bodies for panels 4–7 (Returns Distribution / Rolling / Trades / Exposure+Greeks), DailyHeatmap SVG/Canvas fallback, Trade Mix maker/taker close-out (audit-gated), axe-core CI on full route, full keyboard nav, automated chart-snapshot parity (Playwright pixel-diff ±2%) | 19 (KPI-06..21 + KPI-23b + A11Y-02 + A11Y-03) | Phase 12 + Phase 14a | High |

**Phase-internal audit gates** (run inside the phase, not as standalone Phase 0):

| Gate | Phase | Resolution |
|------|-------|------------|
| `is_maker` flag audit on `raw_fills` (Binance/OKX/Bybit only — Deribit excluded by design: `analytics-service/services/exchange.py:325-334` confirms `fetch_raw_trades` does not dispatch to Deribit, documented as N/A in TODOS.md before plan-phase begins) | Phase 12 | Ship METRICS-10 + KPI-17 if all THREE handlers populate; descope to v0.17.1 if any of the three lacks the flag. Document Deribit as N/A in TODOS.md before plan-phase begins. |
| `organization_id` population audit on published strategies (`SELECT COUNT(*) FROM strategies WHERE organization_id IS NOT NULL AND status='published'`) | Phase 13 | Ship DISCO-03 filter UI + conditional migration `088_organizations_is_public.sql` (privacy gate, `is_public BOOLEAN DEFAULT false`) if non-zero; defer DISCO-03 + migration 088 to v0.18 if 0 |
| METRICS-16 priority enum migration (`086_compute_jobs_priority.sql`) ships before METRICS-14 throttled backfill enqueuer | Phase 12 | Hard dependency — METRICS-14 reads METRICS-16's priority column. Migration 086 must apply first; if rollback needed, METRICS-14 reverts to existing FIFO enqueue. |
| METRICS-17 sibling-table migration (`087_strategy_analytics_series.sql`) ships before getStrategyDetail() lazy-fetch path lands | Phase 12 | Hard dependency — METRICS-15 path-extraction reads sibling table via LATERAL join for panels 4–7. Kill-switch on Phase 12 deploy: if `pg_column_size(metrics_json) > 800kB` at p99.9, emergency cutover migrates remaining heavy keys to sibling table — automated via Phase 12 deploy script. |

**Plan-as-drafted vs codebase reality reconciliations** (defer to codebase reality):

- Plan says "add `user_watchlist` table"; codebase has `user_favorites` (migration 024) — Phase 13 reuses `user_favorites`, no new table.
- Plan says "add `strategies.is_example` flag"; codebase has it shipped (migration 001:64) — Phase 13 ships data-only `UPDATE` backfill, no DDL.
- Plan says "add `strategies.organization_id` FK"; codebase has it shipped (migration 006:30) — Phase 13 wires the filter UI, gated on the population audit + conditional `088_organizations_is_public.sql` migration.
- Plan implies `strategy_analytics.daily_returns JSONB` is new; codebase has it declared at migration 001:92 (never written) — Phase 12 starts populating it (METRICS-04).
- Cross-AI review caught: Deribit excluded from `is_maker` audit by design (`fetch_raw_trades` does not dispatch to Deribit at `analytics-service/services/exchange.py:325-334`). Audit scope reduced from 4 exchanges to 3 (Binance/OKX/Bybit).
- Cross-AI review caught: `compute_jobs.priority` migration promoted from optional (Phase 12 plan-phase decision) to hard Phase 12 deliverable (METRICS-16, migration 086).
- Cross-AI review caught: `strategy_analytics_series` sibling table promoted from "v0.18 candidate" to ship proactively (METRICS-17, migration 087) to avoid emergency cutover under TOAST pressure.
- Cross-AI review caught: `organizations.is_public` privacy gate added for DISCO-03 (Pitfall 18 mitigation; conditional migration 088, only ships if `organization_id` audit returns >0 published strategies).

**Deferred to v0.18.0.0:** T0.5 (consumer audit) + T1–T6 (Manager Workspace + Inbox + Threads + Mandate + Activity log) + T9 (migration onboarding).
**Descoped per UC#6:** Multi-benchmark (ETH/SOL) correlation matrix — Sprint 13+ candidate (`benchmark.py` rejects ETH/SOL with ValueError today; needs new ingestion pipelines).

**Concurrent work on `main`:**

- v0.16.0.0 (Phase 11 — Onboarding & Security Readiness) executing on `main` in parallel — no overlap with v0.17 surface area (`/discovery/[slug]`, `/strategy/[id]`, `analytics-service/services/metrics.py`).
- v0.15.x dashboard-parity polish (PR3 #77, PR4 #80) iterating on `main`.

## Deferred Items

Items carried forward from v0.15.0.0 / v0.16.0.0 milestones:

| Category | Item | Status |
|----------|------|--------|
| in_flight | v0.16.0.0 Phase 11 (Onboarding + Security Readiness) | Executing on `main` in parallel |
| in_flight | v0.15.x dashboard-parity polish (PR3, PR4 series) | Iterating on `main` |
| analytics | Stress testing engine | Deferred past v0.17 |
| analytics | Monthly performance commentary | Deferred past v0.17 |
| analytics | Drawdown story card | Deferred past v0.17 |
| analytics | Advanced portfolio optimizer (risk parity) | Deferred past v0.17 |
| peer | Peer benchmarking foundation | Sprint 13+ |
| benchmark | Multi-benchmark correlation matrix (ETH/SOL ingestion) | Sprint 13+ (UC#6 descope) |
| team | Manager Workspace, Inbox, Threads, Mandate, Activity log | v0.18.0.0 (strategy-teams-page) |
| tech-debt | Phase 01 VALIDATION.md retroactive scaffold (Nyquist backfill) | Non-blocking |
| tech-debt | Phase 02 shared userActionLimiter throttling on rapid auto-save | Live-feedback decision |
| tech-debt | Phase 03 asymmetric liquidity direction (D-05 by-design) | Accepted |
| tech-debt | Phase 03 style_exclusions SOFT relaxation on <5-eligible universes (D-06) | Accepted |
| tech-debt | Phase 05 LAYOUT_VERSION bump localStorage-only | Voice-D8 trigger on user reports |
| concerns | compute_jobs RLS wide-open (USING true) | Sprint 2 deferral, still open |
| concerns | Wizard-draft cleanup cron missing | Sprint 2 deferral, still open |
| concerns | CI runs 4 of 21 Playwright specs | Picked up in v0.16.0.0 (Phase 11 ONBOARD-06) |
| concerns | Dual cron path (Railway + shim routes) | Vercel Pro upgrade lifted 2-cron limit; decision deferred |

**v0.17.0.0 Phase-internal gates:**

| Gate | Phase | Resolution |
|------|-------|------------|
| `is_maker` flag audit on `raw_fills` (Binance/OKX/Bybit only — Deribit excluded by design: fetch_raw_trades does not dispatch to Deribit) | Phase 12 | Ship METRICS-10 + KPI-17 if all THREE handlers populate; descope to v0.17.1 if any of the three lacks the flag. Document Deribit as N/A in TODOS.md before plan-phase begins. |
| `organization_id` population audit on published strategies | Phase 13 | Ship DISCO-03 filter UI + conditional migration `088_organizations_is_public.sql` (privacy gate, `is_public BOOLEAN DEFAULT false`) if non-zero; defer to v0.18 if 0 |
| METRICS-16 priority enum migration (`086_compute_jobs_priority.sql`) before METRICS-14 throttled backfill | Phase 12 | Hard dependency — METRICS-14 reads METRICS-16's priority column. |
| METRICS-17 sibling-table migration (`087_strategy_analytics_series.sql`) before getStrategyDetail() lazy-fetch path | Phase 12 | Hard dependency — METRICS-15 path-extraction reads sibling table via LATERAL join. Kill-switch: if `pg_column_size(metrics_json) > 800kB` at p99.9, emergency cutover automated via Phase 12 deploy script. |

## Decisions

### v0.17.0.0 Sprint 12 milestone planning (2026-04-26)

- v0.17.0.0 = Sprint 12 KPI Parity and Discovery v2 (T7 + T8a + T8b only). Team-side workspace (T0.5/T1–T6/T9 from the strategy-teams-kpi-parity plan) deferred to v0.18.0.0 to keep Sprint 12 focused on allocator-facing depth before manager-facing breadth.
- Plan-fidelity mode: input only. The dual-voice-reviewed plan (`~/.claude/plans/strategy-teams-kpi-parity.md`) is treated as research input — gsd-roadmapper / requirements step re-derives REQ-IDs and phase boundaries rather than mapping T-tasks to phases verbatim.
- Research enabled: 4 parallel researchers (STACK / FEATURES / ARCHITECTURE / PITFALLS) ran before requirements gathering, focused on Discovery v2 patterns + qstats parity gap analysis + backend metric architecture + multi-tenant pitfalls.
- UC#6 descope honored: multi-benchmark (ETH/SOL) correlation matrix dropped from v0.17 since `benchmark.py` rejects ETH/SOL with ValueError today and `benchmarks_eth`/`benchmarks_sol` ingestion pipelines do not exist.
- UC#7 override honored: 7-panel layout on Single-Strategy v2 accepted as DESIGN.md "data density > card density" rule deviation. Decision logged at milestone start; will be re-stamped in DESIGN.md decisions log when Phase 14a ships (DESIGN-03).
- T0.5 (`strategies.user_id` consumer audit) deferred to v0.18 since the actual schema rename only happens there; running it in v0.17 would produce stale grep results.
- v0.16.0.0 (Phase 11 — Onboarding & Security Readiness) executing on `main` in parallel to v0.17 planning. Not a blocker — v0.17 changes are confined to `/discovery/[slug]` + `/strategy/[id]` + `analytics-service/services/metrics.py`, no overlap with Phase 11 surface area.
- Phase 11 Plan 03 (PostHog onboarding funnel wiring) completed on main 2026-04-26 — 5 events firing end-to-end with single-fire markers + at-least-once dedup
- Phase 11 Plan 06 complete — S4a SOC-2 banner + S4c audit-log link on /security; S5 WithdrawalWarningStrip + S7 WizardIpAllowlistHint persist across all 4 wizard steps; S6 AuditLogSubsection on /profile?tab=security consuming GET /api/me/audit-log/export. S4b inline egress-IP block deferred per user direction (no static analytics-service IPs today; existing email-path body preserved). 35 new tests, 0 regressions, typecheck + lint + build green.

### Roadmap drafted (2026-04-26)

- Phase numbering continues from Phase 11 (no `--reset-phase-numbers`): v0.17.0.0 starts at Phase 12.
- 3-phase wave structure (Phase 12 ‖ Phase 13 → Phase 14): Phase 12 (Python analytics-service) and Phase 13 (TypeScript Discovery) touch zero overlapping files; ship in parallel. Phase 14 consumes Phase 12's new JSONB keys; ships in Wave 2.
- Phase 14 carried 30 REQs (60% of milestone, in original draft); kept coherent because the 7-panel single-page layout is one user-visible delivery and DESIGN.md identity must be applied uniformly across the wall — splitting into "Panels 1–3" / "Panels 4–7" would break the visual-parity contract.
- Phase-internal audit gates (not standalone Phase 0): `is_maker` audit lives in Phase 12 plan, `organization_id` audit lives in Phase 13 plan. Each phase's plan-phase step decides scope before writing code.

### Cross-AI review revisions (2026-04-26)

Cross-AI review (fresh Claude subagent + Grok-4-1-fast-reasoning) returned APPROVE-WITH-REVISIONS with 6 convergent fixes — all approved by user and applied to ROADMAP.md / REQUIREMENTS.md / STATE.md in place:

- **FIX 1 (CRITICAL):** Phase 14 (30 REQs) split into Phase 14a (12 REQs — eager panels + identity, ~2.0 sessions) + Phase 14b (19 REQs — lazy panels + Trade & Exposure, ~1.5 sessions). KPI-23 split into KPI-23a (panels 1–3 partial-data, in 14a) + KPI-23b (panels 4–7 partial-data, in 14b). A11Y-02 (axe-core CI) and A11Y-03 (keyboard nav) move to 14b — they cover both panel sets, run after 14b lands lazy bodies. Net Phase 14 expansion: 2.0 → 3.5 sessions; total milestone: 6.5 → 8.0 sessions.
- **FIX 2 (CRITICAL):** `is_maker` audit gate rescoped to 3 exchanges. Original draft said Binance/OKX/Bybit/Deribit. `analytics-service/services/exchange.py:325-334` confirms `fetch_raw_trades` only dispatches to binance/okx/bybit; Deribit returns []. KPI-17 + METRICS-10 + Phase 12 SC5 + STATE.md gates all rewritten to scope 3 exchanges with Deribit "excluded by design" documented as N/A in TODOS.md before plan-phase begins.
- **FIX 3 (HIGH):** `compute_jobs.priority` migration promoted from OPTIONAL (Phase 12 plan-phase decision) to hard Phase 12 deliverable. New REQ METRICS-16: migration `086_compute_jobs_priority.sql` adds `priority TEXT CHECK (priority IN ('low','normal','high')) NOT NULL DEFAULT 'normal'` column on `compute_jobs`; partial index on `(priority, status, scheduled_for) WHERE status = 'queued'`; ADR-0023 audit taxonomy sync if needed; throttled enqueuer in `job_worker.py` reads priority and caps backfill jobs at 5/min when both backfill and sync jobs are queued. METRICS-14 references METRICS-16 explicitly. Net-new migrations bumps from "0–1" to "2–3" (one hard: priority enum; one hard: sibling table; one optional: metrics_json_version; one conditional: organizations.is_public gated by audit).
- **FIX 4 (HIGH):** Tighten Phase 12 + Phase 14 success criteria with automated checks. Phase 12 SC3 split into SC3a (`pg_column_size(metrics_json)` p99.9 < 800kB with weekly CI probe + kill-switch), SC3b (`getStrategyDetail()` Postgres path-extraction p95 < 50ms for above-the-fold scalars), SC3c (Lazy-fetch RPC `fetch_strategy_lazy_metrics(strategy_id, panel_id)` p95 < 200ms). Phase 14a SC1 replaces human-attestation parity check with automated qstats fixture parity diff (golden_252d.json → metrics.py + qs.reports.metrics() → canonicalized JSON, sorted keys, ROUND_HALF_EVEN to 6 decimals → ε=1e-6 diff utility, CI fails on drift). Phase 14b SC1 extends to chart-snapshot parity (Playwright pixel-diff ±2% on sparkline / line-chart canvases; structural assertions verify each chart has 1 strategy series + ≤1 BTC benchmark series + correct identity tokens; visual regression baseline saved for v0.17.1 follow-ups).
- **FIX 5 (HIGH):** `strategy_analytics_series` sibling table promoted from "v0.18 candidate" / fallback to proactive Phase 12 deliverable. New REQ METRICS-17: migration `087_strategy_analytics_series.sql` creates `strategy_analytics_series (strategy_id UUID, kind TEXT, payload JSONB, computed_at TIMESTAMPTZ)` with PRIMARY KEY (strategy_id, kind), partial index on `(strategy_id, kind) WHERE payload IS NOT NULL`, FK CASCADE on strategies. RLS mirrors `strategy_analytics`. Heavy series (`daily_returns_grid`, `exposure_series`, `turnover_series`, `rolling_*_series`) write to sibling table; medium scalars stay in `metrics_json`. Path-extraction in `getStrategyDetail()` joins LATERAL on the sibling table for panels 4–7. METRICS-15 wording updated to read scalars via path-extraction + heavy series via LATERAL join. Kill-switch: if Phase 12 deploy probes `pg_column_size > 800kB` at p99.9, emergency cutover migrates remaining heavy keys from `metrics_json` to sibling table — automated via Phase 12 deploy script.
- **FIX 6 (HIGH):** `organizations.is_public` privacy gate added for DISCO-03 (Pitfall 18 mitigation). DISCO-03 wording updated: gated on Phase 13-internal audit; if `SELECT COUNT(*) FROM strategies WHERE organization_id IS NOT NULL AND status='published'` returns 0, defer UI to v0.18; if non-zero, ALSO ship migration `088_organizations_is_public.sql` (adds `is_public BOOLEAN DEFAULT false`); filter dropdown reads only orgs WHERE `is_public = true`. Default-false avoids leaking private/stealth fund names; managers opt-in via `/strategies/team` settings deferred to v0.18 (managers can be flipped to public manually via admin during v0.17 if needed).

## Accumulated Context

### Roadmap Evolution

- Phase 09.1 inserted after Phase 9 (2026-04-24): Allocator Dashboard UI refresh — implement designer-provided Allocator Dashboard.html reference (URGENT). Reason: designer shipped a full UI refresh bundle and the work must land before Phase 10 Scenario Builder adds a tab to `/allocations`, so the new Scenario tab builds on the updated dashboard instead of being retrofitted later.
- Phase 11 (v0.15.0.0) re-versioned as v0.16.0.0 (2026-04-26): Onboarding + Security Readiness work continues on `main` as its own minor-version release rather than completing v0.15.0.0 directly. v0.15.x absorbed dashboard-parity iteration (PR3 — `#77`, PR4 — `#80`) and Scenario Builder polish (`#78`, `#79`). v0.17.0.0 (this milestone) starts fresh on KPI parity and Discovery v2 ahead of the team-workspace milestone v0.18.0.0.
- v0.17.0.0 roadmap drafted 2026-04-26: 3 phases (12, 13, 14) covering 50 REQs across 6 categories. Wave structure compresses 6.5-session estimate to 2 phase cycles via Phase 12 ‖ Phase 13 parallel execution.
- v0.17.0.0 roadmap revised 2026-04-26 post cross-AI review: 4 phases (12, 13, 14a, 14b) covering 53 REQs across 7 categories (KPI now split via KPI-23a/b, METRICS-16/17 added). 6 convergent fixes from review applied: Phase 14 split, is_maker audit rescoped to 3 exchanges, METRICS-16 (priority enum migration 086) + METRICS-17 (sibling table migration 087) promoted to hard deliverables, automated parity checks (qstats fixture + Playwright pixel-diff), conditional migration 088 organizations.is_public for DISCO-03 privacy gate. Net session estimate moves from 6.5 to 8.0 sessions.

## Session Continuity

Last session: --stopped-at
Next resume target: `/gsd-plan-phase 12` (or `/gsd-plan-phase 13` to start Discovery v2 in parallel — Phase 12 is the dependency for Phase 14a → Phase 14b)

**Planned milestone:** v0.17.0.0 Sprint 12 — KPI Parity and Discovery v2 — 2026-04-26T00:00:00.000Z (revised post cross-AI review)
