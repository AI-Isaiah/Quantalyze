# Roadmap: Quantalyze

## Milestones

- ✅ **v0.14.0.0 Sprint 8: Bridge V2** — Phases 1–5 (shipped 2026-04-19) → [archive](milestones/v0.14.0.0-ROADMAP.md)
- ✅ **v0.15.0.0 Sprint 9: Demo-to-Production** — Phases 06–10 + 09.1 (shipped 2026-04-27) → [archive](milestones/v0.15.0.0-ROADMAP.md)
- ✅ **v0.16.0.0 Phase 11: Onboarding & Security Readiness** — Phase 11 (shipped 2026-04-27) → [archive](milestones/v0.16.0.0-MILESTONE-AUDIT.md)
- ✅ **v0.17.0.0 Sprint 12: KPI Parity and Discovery v2** — Phases 12–14b (shipped 2026-04-29) → [archive](milestones/v0.17.0.0-ROADMAP.md)

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

<details>
<summary>✅ v0.15.0.0 Sprint 9: Demo-to-Production (Phases 06–10 + 09.1) — SHIPPED 2026-04-27</summary>

- [x] Phase 06: Allocator API Ingestion (4/4 plans) — completed 2026-04-21
- [x] Phase 07: Demo-Mode Purge (6/6 plans) — completed 2026-04-20
- [x] Phase 08: Connection Management and Notes (5/5 plans) — completed 2026-04-21
- [x] Phase 09: Bridge Live Against Real Holdings (4/4 plans) — completed 2026-04-21
- [x] Phase 09.1: Allocator Dashboard UI refresh (11/11 plans) — completed 2026-04-24
- [x] Phase 10: Scenario Builder and What-If (8/8 plans) — completed 2026-04-26

See `milestones/v0.15.0.0-ROADMAP.md` for full phase details, success criteria, and decisions. Audit: `milestones/v0.15.0.0-MILESTONE-AUDIT.md` (PASSED, 27/27 requirements). Integration: `milestones/v0.15.0.0-INTEGRATION-CHECK.md` (6/6 wiring PASS, 0 findings).

</details>

<details>
<summary>✅ v0.16.0.0 Phase 11: Onboarding & Security Readiness — SHIPPED 2026-04-27</summary>

- [x] Phase 11: Onboarding and Security Readiness (7/7 plans) — completed 2026-04-26

See `milestones/v0.16.0.0-MILESTONE-AUDIT.md` for full phase details, success criteria, and decisions (audit: PASSED, 6/6 ONBOARD-XX requirements).

</details>

<details>
<summary>✅ v0.17.0.0 Sprint 12: KPI Parity and Discovery v2 (Phases 12–14b) — SHIPPED 2026-04-29</summary>

- [x] Phase 12: Backend Metric Contracts (10/10 plans) — completed 2026-04-28
- [x] Phase 13: Discovery v2 Polish (4/4 plans) — completed 2026-04-29
- [x] Phase 14a: Single-Strategy v2 — Eager Panels + Identity (6/6 plans) — completed 2026-04-29
- [x] Phase 14b: Single-Strategy v2 — Lazy Panels + Trade & Exposure (8/8 plans) — completed 2026-04-29

See `milestones/v0.17.0.0-ROADMAP.md` for full phase details, success criteria, and decisions. Audit: `milestones/v0.17.0.0-MILESTONE-AUDIT.md` (`tech_debt`, 52/53 REQs, 4 accepted deferred items). Requirements: `milestones/v0.17.0.0-REQUIREMENTS.md`.

</details>

## Structural decision: 6-phase roadmap (Option B)

**Chosen:** Option B — split LIVE (Phase 09) and SCENARIO (Phase 10) into separate phases.

**Rationale:** SCENARIO is a net-new product surface (tabbed `/allocations`, client-side projection engine, commit-to-Bridge flow) with 9 REQs that materially exceed what a shared phase with LIVE (5 REQs) could absorb — a combined 14-REQ phase would be roughly 2× the average phase size in this milestone (INGEST 9, PURGE 7, MANAGE 6, ONBOARD 6). Splitting lets each phase run its own `/gsd-discuss-phase` → `/gsd-plan-phase` → ship cycle with its own PR under `branching_strategy: none`, and lets LIVE (Bridge wire-up, smaller and well-scoped) ship independently so SCENARIO can build on a proven live-holdings Bridge instead of a paper one.

**Trade-off accepted:** 6 phases instead of 5 means one additional discuss/plan cycle — but each phase is now a clean discrete unit of work rather than a grab-bag.

## Structural decision: 4-phase wave structure for v0.17.0.0 (Option B-prime, post cross-AI review)

**Chosen:** Phase 12 ‖ Phase 13 (parallel Wave 1) → Phase 14a (Wave 2 eager) → Phase 14b (Wave 3 lazy).

**Rationale (original 3-phase):** Phase 12 (METRICS backend, Python analytics-service) and Phase 13 (DISCO Discovery v2, TypeScript discovery surface) touch zero overlapping files — independent code surfaces, independent test cohorts. Running them in parallel compresses the estimate by 2 phase cycles. Phase 14 strictly depends on Phase 12 (UI consumes the new JSONB keys), so it ships in Wave 2.

**Rationale for Phase 14 split into 14a + 14b (cross-AI review 2026-04-26):** The original Phase 14 carried 30 REQs in one phase. Both reviewers (fresh Claude subagent + Grok-4-1-fast-reasoning) flagged this as too dense for a single GSD plan-phase cycle, with the lazy panels (4–7) being a natural cleavage point — they share the same mount infrastructure (IntersectionObserver scaffold) but are independent of the eager half (panels 1–3). Splitting unlocks: (a) early visible win on eager panels + identity baseline (Phase 14a, 12 REQs), (b) Trade Mix `is_maker` audit close-out moves to 14b where it doesn't block the visual baseline shipping, (c) automated parity diff tools can be built once and reused — Phase 14a uses qstats fixture parity (scalar-level), Phase 14b uses Playwright pixel-diff (chart-level), (d) axe-core CI on the full route runs against the complete 7-panel mount in 14b after both eager and lazy bodies are present.

**Per-phase REQ load (post-split):** Phase 12 owns 17 REQs (METRICS-01..17, +METRICS-16/17 promoted from optional to hard deliverable), Phase 13 owns 5 REQs (DISCO-01..05), Phase 14a owns 12 REQs (KPI-01..05 + KPI-22 + KPI-23a + DESIGN-01..03 + A11Y-01 + CLEANUP-01), Phase 14b owns 19 REQs (KPI-06..21 + KPI-23b + A11Y-02 + A11Y-03).

**Trade-off accepted:** 4 phases instead of 3 means one additional discuss/plan cycle — but each phase is a clean discrete unit, the split unlocks earlier visible delivery on eager panels, and the lazy bodies in 14b can ship without re-litigating the visual baseline. Net session estimate moves from 6.5 to 8.0 sessions (Phase 14: 2.0 → 3.5).

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
| 09.1. Allocator Dashboard UI refresh | v0.15.0.0 | 11/11 | Complete | 2026-04-24 |
| 10. Scenario Builder and What-If | v0.15.0.0 | 8/8 | Complete | 2026-04-26 |
| 11. Onboarding and Security Readiness | v0.16.0.0 | 7/7 | Complete | 2026-04-26 |
| 12. Backend Metric Contracts | v0.17.0.0 | 10/10 | Complete | 2026-04-28 |
| 13. Discovery v2 Polish | v0.17.0.0 | 4/4 | Complete | 2026-04-29 |
| 14a. Single-Strategy v2 — Eager Panels + Identity | v0.17.0.0 | 6/6 | Complete | 2026-04-29 |
| 14b. Single-Strategy v2 — Lazy Panels + Trade & Exposure | v0.17.0.0 | 8/8 | Complete | 2026-04-29 |
