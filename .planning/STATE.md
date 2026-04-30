---
gsd_state_version: 1.0
milestone: v1.0.0
milestone_name: "API-Key Rewrite — Diagnose → Fix → Unify → Ship to LPs"
status: defining_requirements
stopped_at: Milestone v1.0.0 started 2026-04-30. PROJECT.md updated, STATE.md reset, requirements/roadmap pending.
last_updated: "2026-04-30T19:45:00.000Z"
last_activity: 2026-04-30 — Milestone v1.0.0 started (/gsd-new-milestone "Moving to v1")
progress:
  total_phases: 0
  completed_phases: 0
  total_plans: 0
  completed_plans: 0
  percent: 0
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-30 at v1.0.0 milestone start)

**Core value:** Allocators act on Bridge recommendations and see whether those suggestions actually worked.
**Current focus:** Defining v1.0.0 requirements + roadmap (API-Key Rewrite — the version Quantalyze can credibly put in front of LPs and managers)
**Last milestone:** v0.17.0.0 Sprint 12 — KPI Parity and Discovery v2 (shipped 2026-04-29). v0.17.1.x cleanup landed at v0.17.1.31 on 2026-04-30, all 5 carryover items closed (METRICS-15, KPI-17 4-bucket, DISCO-05 migration push, v1→v2 cutover, 9 Playwright specs in CI).

## Current Position

Phase: Not started (defining requirements)
Plan: —
Status: Defining requirements
Last activity: 2026-04-30 — Milestone v1.0.0 started

## Milestone Summary (v1.0.0)

**Plan source:** `~/.gstack/projects/AI-Isaiah-Quantalyze/helios-mammut-main-design-20260429-225031.md` (1495 lines). Cross-AI dual-voice review across CEO + Design + Eng phases (Claude subagents + Grok 4.2 multi-agent via `/v1/messages` Anthropic-compat). 11 User Challenges resolved 2026-04-30 (10 accepted, 1 modified, 0 rejected). 6/6 CEO + 7/7 Design dimensions originally CONFIRMED-AGAINST plan; restructure addresses all critical findings. APPROVED at Phase 4 Final Approval Gate. Verbatim restructure section runs lines 1209-1438 of the plan file.

**Headline:** v1.0.0 = the version the founder shows LPs and managers. Fix recurring API-key wizard failure at the root, unify three divergent code paths into one observable backbone, unblock 10 quant teams in pipeline, establish dogfood loop with founder's own LP report.

**Net session estimate:** ~17 CC days (range 17-22). If Day-2 decision gate skips Phase 2: ~10 CC days total.

**Coverage (preliminary, before requirements step finalizes):** ~40-50 REQs across categories CSV / OBSERV / DESIGN / FIX / BACKBONE / LP / FINGERPRINT.

**Wave structure (proposed; roadmapper will confirm):**

- Wave 1 (sequential gate): Phase 15 (CSV unblock) → 10/10 teams have working onboarding path within 48h
- Wave 2 (sequential): Phase 16 (Diagnostic spike + observability) → Day-2 decision gate (commit Phase 19 or skip)
- Wave 3 (sequential): Phase 17 (Design contract in DESIGN.md) → must lock trust-tier badges + error envelope + broker selector + mobile fallback before Phase 19 backend work
- Wave 4 (sequential): Phase 18 (Root-cause fix + founder LP skeleton) — exits with all 10 teams reaching `validated`
- Wave 5 (conditional, sequential): Phase 19 (Unified backbone) — only runs if Day-2 gate committed Phase 2

| Phase | Goal | Days | Depends on | Complexity |
|-------|------|------|------------|------------|
| 15. CSV Unblock | Extend PR #22's CSV path so all 10 teams have a working onboarding path within 48h. `csv_uploaded` trust-tier placeholder. Per-team status tracking via `strategy_verifications` rows reaching `validated`. | 1-2 | Nothing | Low |
| 16. Diagnostic Spike + Observability | correlation_id end-to-end (Next → FastAPI → Supabase → Resend). Sentry wiring (`error.tsx` + `global-error.tsx` + `sentry-sdk[fastapi]`). `/api/debug-key-flow` SSE/poll endpoint. Deterministic local-repro harness (VCR fixtures + `scripts/repro-key-flow.sh`). PostHog mobile audit. Migrations 084/085/086 trigger audit. **restore-e2e-fixtures pre-PR** (api-key-flow.spec.ts + observability.ts wiped by PR #90). | 3-4 | Phase 15 | Medium |
| **Day-2 decision gate** | Founder reviews `/api/debug-key-flow` output. Decides: COMMIT Phase 19 unification, OR apply 1-line fix and skip Phase 19 (closes milestone at ~10 CC days). | 4 | Phase 16 | — |
| 17. Design Contract | DESIGN.md additions: trust-tier badges (api_verified / csv_uploaded / self_reported), error envelope render wireframe, broker selector 2×3 card grid, CSV escape-hatch full-width card, mobile-readable wizard fallback (conditional on Phase 16 mobile audit), a11y minimums (4.5:1 contrast, ARIA live, keyboard nav), 9-state matrix per surface, `wizardErrors.ts` source-of-truth declaration. | 5-7 | Phase 16 | Medium |
| 18. Root-Cause Fix + Founder LP | Fix whatever Phase 16 surfaced (regression test per fix). PII redaction utility (`src/lib/redact.ts` + `analytics-service/services/redact.py`). Founder LP report cron (reuses existing factsheet PDF endpoints). | 8-10 | Phase 17 | Medium |
| 19. Unified Backbone *(conditional on Day-2 gate)* | FastAPI `POST /process-key` + adapter pattern (OKX/Binance/Bybit/CSV — NO MT5/IBKR per UC-B). `strategy_verifications` schema state-machine. VIEW-shim migration. Thin Next.js adapters (`/api/keys/sync` subsumed as `flow_type='resync'`). Feature flag + cron-based rollback monitor (Sentry events API + Vercel REST API, 0.5%/15-min threshold). `wizard_session_id` idempotency key. perp-correctness via `reconstruct_positions()`. JSONB fingerprint column + `compute_similarity()` SQL function (pgvector deferred to v2 per UC-C). | 11-17 | Phase 18 + Day-2 commit | High |

**Phase numbering:** continues from Phase 14b (no `--reset-phase-numbers`). Old phase dirs (12, 13, 14a, 14b) already archived to `.planning/milestones/v0.17.0.0-phases/`.

**Plan-as-drafted vs codebase reality reconciliations** (defer to codebase reality — ratified during research/requirements phase):

- Plan says "two divergent code paths"; audit found THREE (verify-strategy + validate-and-encrypt + keys/sync) plus finalize-wizard. Phase 19 unifies all four.
- Plan says inject correlation_id in `src/proxy.ts`; audit found `proxy.ts` is auth-only with zero outbound fetches. Correct seam is `src/lib/analytics-client.ts:66`.
- Plan says Sentry wiring greenfield in Phase 0; audit found framework-level Sentry already wired in `src/instrumentation.ts` + `onRequestError`. Phase 16 narrows to (a) wire `error.tsx` + `global-error.tsx`, (b) add `sentry-sdk[fastapi]` to `analytics-service/requirements.txt`.
- Plan says `WizardClient.tsx` lives in `src/components/wizard/`; actual path is `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx`.
- Plan says migration 084 + 085 trigger audit; audit found 086 (`compute_jobs_priority`) is in the same surface and must be audited too.
- Plan recommends pgvector + HNSW for fingerprints; UC-C accepted defer to v2 — JSONB column + `compute_similarity(a, b)` SQL function ships in v1.

**Cross-phase risk themes (from autoplan dual-voice review, must not regress during execution):**

- **Theme 1: PLAN IS DEVELOPER-FIRST, NOT USER-FIRST** — flagged by all 4 voices across CEO + Design phases. Mitigation: Phase 17 Design Contract before Phase 19 backend rewrite.
- **Theme 2: SCOPE EXPANSION IS UNDER-SIZED** — original 25-day estimate dishonest given MT5/IBKR + perps + fingerprint scaffold. Mitigation: UC-B drops MT5/IBKR; UC-C drops pgvector; honest 17-22 days.
- **Theme 3: FINGERPRINT MOAT UNVALIDATED + STATISTICALLY MEANINGLESS AT N=10** — Mitigation: UC-C JSONB placeholder; pgvector deferred until N≥1000.
- **Theme 4: AI VOICES RATIFYING AI VOICES** — premises P1'-P7 generated by 3 Grok personas + ratified by autoplan reviewers; no real customer (10 teams or Metaworld) was asked which onboarding path they'd use. Mitigation: This-week action item — founder-interview pass with 1-2 of the 10 teams + Metaworld before committing Phase 19.
- **Theme 5: RECURRENCE PATTERN IS A TOOLING FAILURE** — 5 fix attempts in 19 days isn't observability gap, it's absence of deterministic local-repro harness. Mitigation: E-8 — Phase 16 ships VCR-style HTTP fixtures + `scripts/repro-key-flow.sh`.

## Deferred Items

### Carried forward to v1.0.0 (re-evaluated; non-blocking for v1)

| Category | Item | Status |
|----------|------|--------|
| analytics | Stress testing engine | Deferred past v1 |
| analytics | Monthly performance commentary (deterministic, no LLM) | Deferred past v1 |
| analytics | Drawdown story card | Deferred past v1 |
| analytics | Advanced portfolio optimizer (risk parity + explicit constraints) | Deferred past v1 |
| peer | Peer benchmarking foundation | Sprint 13+ (gated on 5+ connected allocators) |
| benchmark | Multi-benchmark correlation matrix (ETH/SOL ingestion) | Sprint 13+ (UC#6 descope from v0.17) |
| team | Manager Workspace, Inbox, Threads, Mandate, Activity log | Reconsidered post-v1.0 (formerly v0.18.0.0 candidate; v1 picked API-key rewrite over manager workspace breadth) |
| moat | Match-flag UX, FoF-specific landing surface, pgvector + HNSW migration | v2 design doc (opens after v1.0 stability window passes) |
| broker | MT5 + IBKR API adapters | v2 (CSV-bridged in v1 per UC-B) |
| concerns | `compute_jobs` RLS wide-open (USING true) | Sprint 2 deferral, still open — flag for Phase 16 security audit |
| concerns | Wizard-draft cleanup cron | Resolved 2026-04-29 via PR #88 (cleanup-wizard-drafts route handler tests) |
| concerns | Dual cron path (Railway + shim routes) | Vercel Pro upgrade lifted 2-cron limit; decision deferred |
| concerns | Phase 01 VALIDATION.md retroactive scaffold (Nyquist backfill) | Non-blocking |
| follow-up | Sprint 8 follow-ups (Voice-D8 dashboard-reset trigger, Phase 02 rate-limit decision) | Live-feedback decisions |

### v1.0.0 phase-internal gates (proposed; roadmapper will confirm)

| Gate | Phase | Resolution |
|------|-------|------------|
| Vault-from-Railway pre-flight (Day 0.5) | Phase 16 | Read known KEK row from Supabase Vault and decrypt test ciphertext. If access denied: skip ahead to Phase 18 with "fix Vault access" as first task. Highest-probability root cause per Skeptic voice. |
| 10/10 teams onboarded via CSV by Day 2 | Phase 15 | Per-team `strategy_verifications.status='validated'` row check. If any team blocked by CSV format/upload bug, Phase 16 adds CSV-side observability sweep before progressing. |
| Day-2 decision gate (Day 4) | Phase 16 → Phase 19 | Founder reviews `/api/debug-key-flow` output. If root cause is single config fix, skip Phase 19 (close milestone at ~10 CC days). Document decision in plan. |
| Phase 17 Design Contract complete (no TBD cells in 9-state matrix) | Phase 17 → Phase 19 | Hard gate — Phase 19 cannot start while any per-surface state is "TBD" in DESIGN.md additions. |
| restore-e2e-fixtures PR merged | Phase 16 prep | UC-E modified — let PR #90 merge but pin a `restore-e2e-fixtures` PR FIRST putting back api-key-flow.spec.ts + seed scripts + observability.ts before any Phase 16 instrumentation work. |

## Decisions

### v1.0.0 milestone planning (2026-04-30)

- v1.0.0 = "the version I show LPs and managers" (founder direct quote, 2026-04-30). Headline: API-Key Rewrite. Manager Workspace IA (formerly v0.18.0.0 candidate) deferred — re-evaluate post-v1 once paid pilots validate FoF/manager demand.
- Plan source: `~/.gstack/projects/AI-Isaiah-Quantalyze/helios-mammut-main-design-20260429-225031.md` — 1495-line design doc with autoplan dual-voice review. Treated as research input; gsd workflow re-derives REQ-IDs and phase boundaries.
- Phase numbering continues from Phase 14b (no `--reset-phase-numbers`): v1.0.0 starts at Phase 15. Old phase dirs already archived to `.planning/milestones/v0.17.0.0-phases/`.
- Research enabled: 4 parallel researchers (STACK / FEATURES / ARCHITECTURE / PITFALLS) ran before requirements gathering, cross-referencing the autoplan doc and codebase audit findings.
- v0.17.1.x cleanup line closed at v0.17.1.31 (2026-04-30) — all 5 carryover items shipped before v1.0 setup began (per user instruction "I will now fix [carryover] only then we continue here"). Carryover work: METRICS-15 path-extraction (PR #91 + #104), KPI-17 4-bucket Trade Mix saga (PRs #95/96/98/99/102), DISCO-05 migration 091 push, v1→v2 strategy page cutover via flag deletion (PR #92), 9 Playwright specs CI wiring (PRs #107/108).
- Bonus v0.17.1.x cleanup landed alongside carryover (not on original list, valuable): WCAG 2 AA color contrast fixes (PR #103), unified app-namespaced localStorage purge registry, ARIA-label fixes, parallelized seed-test-project upserts, 4 npm audit advisories closed, accent color #16A34A→#15803D sweep across 4 files, atomic dual-write RPC for kill-switch cutover (migration 088).
- 11 User Challenges from autoplan accepted: UC-A (CSV-first Phase -1), UC-B (drop MT5/IBKR API adapters; CSV-bridge), UC-C (defer pgvector to v2), UC-D (Phase 0.5 Design Contract before Phase 2), UC-E modified (let PR #90 merge but pin restore-e2e-fixtures FIRST), UC-F (founder LP skeleton in Phase 1 exit), UC-G subsumed by UC-D (trust-tier in DESIGN.md), UC-H (PostHog mobile audit), UC-I (Phase 0 spike + Day-2 decision gate), UC-J (4-hour competitive teardown), UC-K (cron-based rollback monitor).
- Out of scope for v1: match-flag UX, FoF landing surface, pgvector+HNSW migration, MT5+IBKR API adapters, pricing experiment, IC-handoff PDF (Eltican Positron Dashboard reference template), branded LP design — all deferred to v2 design doc, opened only after Phase 19 stability window (7 days at 100% flag, zero error-envelope regressions) passes.
- Cross-AI review consensus: 6/6 CEO + 7/7 Design dimensions originally CONFIRMED-AGAINST plan as written; restructure addresses all critical findings. APPROVED at Phase 4 Final Approval Gate.

## Accumulated Context

### Roadmap Evolution

- Phase 09.1 inserted after Phase 9 (2026-04-24): Allocator Dashboard UI refresh — implement designer-provided Allocator Dashboard.html reference (URGENT). Reason: designer shipped a full UI refresh bundle and the work must land before Phase 10 Scenario Builder adds a tab to `/allocations`, so the new Scenario tab builds on the updated dashboard instead of being retrofitted later.
- Phase 11 (v0.15.0.0) re-versioned as v0.16.0.0 (2026-04-26): Onboarding + Security Readiness work continues on `main` as its own minor-version release rather than completing v0.15.0.0 directly. v0.15.x absorbed dashboard-parity iteration (PR3 — `#77`, PR4 — `#80`) and Scenario Builder polish (`#78`, `#79`). v0.17.0.0 (next milestone) starts fresh on KPI parity and Discovery v2 ahead of the team-workspace milestone v0.18.0.0.
- v0.17.0.0 roadmap drafted 2026-04-26: 3 phases (12, 13, 14) covering 50 REQs across 6 categories. Wave structure compresses 6.5-session estimate to 2 phase cycles via Phase 12 ‖ Phase 13 parallel execution.
- v0.17.0.0 roadmap revised 2026-04-26 post cross-AI review: 4 phases (12, 13, 14a, 14b) covering 53 REQs across 7 categories (KPI now split via KPI-23a/b, METRICS-16/17 added). 6 convergent fixes from review applied: Phase 14 split, is_maker audit rescoped to 3 exchanges, METRICS-16 (priority enum migration 086) + METRICS-17 (sibling table migration 087) promoted to hard deliverables, automated parity checks (qstats fixture + Playwright pixel-diff), conditional migration 088 organizations.is_public for DISCO-03 privacy gate. Net session estimate moves from 6.5 to 8.0 sessions.
- v1.0.0 (this milestone) re-prioritized over v0.18.0.0 Manager Workspace IA on 2026-04-30: founder's #1 operational pain is API-key wizard recurrence + 10 blocked teams + own-fund LP report. Manager Workspace breadth deferred until reliability + dogfood loop are proven.
- v1.0.0 plan = autoplan-restructured "API-Key Rewrite" with 5 phases (15-19) and conditional Day-2 decision gate. Phase 19 (Unified Backbone) only runs if Phase 16 diagnostic finds the root cause requires architectural rewrite vs single-config-fix.

### Cross-AI dual-voice review conventions (from v0.17.0.0 onward)

- Cross-AI review is now standard practice for milestone plans. v0.17.0.0 used Grok-4-1-fast-reasoning + fresh Claude subagent. v1.0.0 used Grok 4.2 multi-agent (`grok-4.20-multi-agent-0309` via `/v1/messages` Anthropic-compat) across 3 personas (Architecture / Product / Skeptic) + Claude subagents on CEO + Design + Eng phases.
- Dual-voice review consensus surfaces concerns where BOTH models independently agree the plan should change. These become "User Challenges" presented at the final approval gate for explicit user decision rather than auto-applied.
- v0.17.0.0 had 8 User Challenges resolved 2026-04-26; v1.0.0 had 11 User Challenges resolved 2026-04-30 (10 accepted, 1 modified).
- 6/6 CEO + 7/7 Design dimensions originally CONFIRMED-AGAINST v1.0.0 plan signals genuine architectural concerns rather than superficial nits. Restructure section in plan file addresses all critical findings.

## Session Continuity

Last session: 2026-04-30T19:45:00.000Z
Stopped at: Milestone v1.0.0 metadata setup complete (PROJECT.md updated, STATE.md reset). Next: cleanup leftover phase dirs (`gsd-sdk query phases.clear --confirm` to clear active dirs 12/13/14a/14b — already mirrored to `.planning/milestones/v0.17.0.0-phases/`), commit, then run 4 parallel researchers (gsd-project-researcher × Stack/Features/Architecture/Pitfalls) with the autoplan plan as research input, then synthesizer, then requirements step (REQ-IDs across CSV/OBSERV/DESIGN/FIX/BACKBONE/LP/FINGERPRINT categories), then roadmap step.

**Planned milestone:** v1.0.0 — API-Key Rewrite — Diagnose → Fix → Unify → Ship to LPs — 2026-04-30T19:45:00.000Z

**Planned Phase:** 15 (CSV Unblock) — first phase after requirements/roadmap finalize
