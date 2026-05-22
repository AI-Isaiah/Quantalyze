---
gsd_state_version: 1.0
milestone: v1.0.0
milestone_name: API-Key Rewrite
status: executing
stopped_at: context exhaustion at 76% (2026-05-07)
last_updated: "2026-05-22T09:46:36.234Z"
last_activity: 2026-05-22 -- Phase 19.1 execution started
progress:
  total_phases: 6
  completed_phases: 4
  total_plans: 46
  completed_plans: 35
  percent: 76
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-04-30 at v1.0.0 milestone start)

**Core value:** Allocators act on Bridge recommendations and see whether those suggestions actually worked.
**Current focus:** Phase 19.1 — csv-analytics-factsheet-pipeline-prior-work-on-feat-csv-anal
**Last milestone:** v0.17.0.0 Sprint 12 — KPI Parity and Discovery v2 (shipped 2026-04-29). v0.17.1.x cleanup landed at v0.17.1.31 on 2026-04-30, all 5 carryover items closed.

## Current Position

Phase: 19.1 (csv-analytics-factsheet-pipeline-prior-work-on-feat-csv-anal) — EXECUTING
Plan: 1 of 10
Status: Executing Phase 19.1
Last activity: 2026-05-22 -- Phase 19.1 execution started

Progress: [██░░░░░░░░] 20% (1 of 5 phases complete; Phase 15 shipped local on v1.0.0-api-key-rewrite-15-16, awaiting milestone ship)

## Phase 16 prep gate status (2026-05-01)

| # | Gate | Artifact | Status |
|---|------|----------|--------|
| 1 | restore-e2e-fixtures PR merged FIRST | PR #111 (commit 8fb4159), merged into main 2026-05-01T06:25:59Z | ✓ closed |
| 2 | DISCO-05 migration drift Path A/B/C decision | `.planning/phase-16/migration-drift-resolution.md` (Path C) + TODOS.md ratification | ✓ closed |
| 3 | Day-0.5 Vault-from-Railway pre-flight | `.planning/phase-16/vault-from-railway-preflight.md` (PASS — architecture is Railway env-var, not Vault) | ✓ closed |

**Phase 18 fallback NOT triggered** (gate 3 explicitly says "skip ahead to Phase 18 with 'fix Vault access' as first task" if pre-flight fails — pre-flight passed).

**Plan terminology correction:** the milestone plan refers to "Vault" in several places (Phase 18 redact mirror context, Skeptic-voice root-cause table). The codebase has never used Supabase Vault — KEK is a Railway env-var. Future Phase 16/17/18/19 plans should rephrase any "Vault" reference to "KEK env-var" or "Railway secret". Convergence document: `.planning/phase-16/vault-from-railway-preflight.md`.

## Milestone Summary (v1.0.0)

**Plan source:** `~/.gstack/projects/AI-Isaiah-Quantalyze/helios-mammut-main-design-20260429-225031.md` (1495 lines). Cross-AI dual-voice review across CEO + Design + Eng phases. 11 User Challenges resolved 2026-04-30 (10 accepted, 1 modified). APPROVED at Phase 4 Final Approval Gate.

**Headline:** v1.0.0 = the version the founder shows LPs and managers. Fix recurring API-key wizard failure at the root, unify divergent code paths into one observable backbone, unblock 10 quant teams in pipeline, establish dogfood loop with founder's own LP report.

**Net session estimate:** ~17 CC days (range 17-22). If Day-2 decision gate skips Phase 19: ~10 CC days total.

**Coverage:** 39 v1 REQs across 7 categories (3 CSV + 12 OBSERV + 5 DESIGN + 4 FIX + 3 LP + 10 BACKBONE + 2 FINGERPRINT). 39/39 mapped to phases (no orphans).

**Wave structure (sequential — real dependencies enforce ordering):**

- **Wave 1** — Phase 15 alone (CSV unblock; operationally urgent; PR #22 path promoted to first-class)
- **Wave 2** — Phase 16 alone (must wait for Phase 15 `csv_uploaded` placeholder + restore-e2e-fixtures pre-PR + DISCO-05 migration drift resolution + Day-0.5 Vault-from-Railway pre-flight)
- **Wave 3** — Phase 17 alone (depends on Phase 16 PostHog mobile audit count + correlation_id seam stable; envelope shape produced by Phase 16 is the surface the wireframe describes)
- **Wave 4** — Phase 18 alone (depends on Phase 16 root cause surfaced via Day-2 decision document + Phase 17 `wizardErrors.ts` source-of-truth declaration)
- **Wave 5** — Phase 19 alone, *conditional* (depends on Phase 18 verified-working foundation + Day-2 gate = COMMIT)

| Phase | Goal (one line) | CC Days | Depends on | Complexity |
|-------|-----------------|---------|------------|------------|
| 15. CSV Unblock | All 10 onboarding teams have working CSV path within 48h; `csv_uploaded` trust-tier placeholder. | 1-2 | Theme 4 ≥3 team replies | LOW |
| 16. Diagnostic Spike + Observability | correlation_id end-to-end + Sentry both halves + `/api/debug-key-flow` SSE + VCR cassettes + trigger audit + Resend tag round-trip + restore-e2e-fixtures + PostHog mobile audit. | 3-4 | Phase 15 + restore-e2e-fixtures + drift resolution + Vault pre-flight | MEDIUM-HIGH |
| **Day-2 decision gate** | Founder reviews `/api/debug-key-flow` output. SKIP / COMMIT / HOLD with falsifiable criteria. | Day 4 | Phase 16 | — |
| 17. Design Contract | DESIGN.md trust-tier + error envelope + broker selector + CSV escape-hatch + mobile fallback + a11y + 9-state matrix. Trust-tier tokens as code regex-asserted against DESIGN.md. | 5-7 | Phase 16 audit | MEDIUM |
| 18. Root-Cause Fix + Founder LP | Fix Phase 16 surfaced bug (regression test that fails without fix) + Python `redact.py` mirror + founder LP report cron + dogfood-loop commitment. | 8-10 | Phase 16 root cause + Phase 17 | MEDIUM |
| 19. Unified Backbone *(conditional)* | `POST /process-key` + adapter Protocol + state machine + 4-PR VIEW-shim + flag + flag-monitor cron + perp correctness + JSONB fingerprint + idempotency. | 11-17 | Phase 18 + Day-2 = COMMIT | HIGH |

**Phase numbering:** continues from Phase 14b (no `--reset-phase-numbers`). Old phase dirs (12, 13, 14a, 14b) already archived to `.planning/milestones/v0.17.0.0-phases/`.

**Plan-as-drafted vs codebase reality reconciliations** (research-ratified — see ARCHITECTURE.md anti-patterns):

- Plan said "two divergent code paths"; audit found THREE (verify-strategy + validate-and-encrypt + keys/sync) plus finalize-wizard. Phase 19 unifies all four (4th orphan path = `/api/keys/sync`).
- Plan said inject correlation_id in `src/proxy.ts`; audit found `proxy.ts` is auth-only with zero outbound fetches. Correct seam is `src/lib/analytics-client.ts:66`.
- Plan said Sentry wiring greenfield in Phase 0; framework-level Sentry already wired in `src/instrumentation.ts`. Phase 16 narrows to `error.tsx` + `global-error.tsx` + `sentry-sdk[fastapi]==2.58.0` in analytics-service.
- Plan said new `src/lib/redact.ts`; audit found `src/lib/admin/pii-scrub.ts` already exists with tested denylist. Phase 18 ships ONLY the Python mirror.
- Plan recommended pgvector + HNSW; UC-C accepted defer to v2 — JSONB column + `compute_similarity()` SQL function ships in v1.

**Cross-phase risk themes (must not regress during execution):**

- **Theme 1**: PLAN IS DEVELOPER-FIRST, NOT USER-FIRST — Mitigation: Phase 17 hard exit gate before Phase 19 backend rewrite.
- **Theme 2**: SCOPE EXPANSION UNDER-SIZED — Mitigation: UC-B drops MT5/IBKR; UC-C drops pgvector; honest 17-22 days; Phase 19 conditional.
- **Theme 3**: FINGERPRINT MOAT UNVALIDATED + STATISTICALLY MEANINGLESS AT N=10 — Mitigation: UC-C JSONB placeholder; pgvector deferred until N≥1000.
- **Theme 4**: AI VOICES RATIFYING AI VOICES — Mitigation: Phase 15 entry blocker (≥3 written replies); Phase 18 entry gate (≥1 Metaworld verbal-in-writing); Phase 19 exit interview (1-2 teams demo).
- **Theme 5**: RECURRENCE PATTERN IS A TOOLING FAILURE — Mitigation: Phase 16 ships `vcrpy==8.1.1` cassettes + `scripts/repro-key-flow.sh`; runs daily during Phase 19 stability window.
- **Theme 6**: MIGRATION DRIFT + 4TH ORPHAN PATH — Mitigation: Phase 16 prerequisite drift resolution; Phase 19 route-inventory + migration-plan entry gates.

## Phase-Internal Gates (operational blockers — NOT requirements; encoded as phase entry/exit conditions)

| Gate | Phase | Resolution |
|------|-------|------------|
| Theme 4 founder pings 10 teams (≥3 reply threshold) | Phase 15 entry | Founder emails 10 teams BEFORE execution starts. <3 ships anyway but logs gap to `.planning/phase-15/customer-signal-gap.md`. |
| `restore-e2e-fixtures` PR merged FIRST (UC-E modified) | Phase 16 prep | Bit-for-bit pre-PR-#90 restore of `e2e/api-key-flow.spec.ts` (-242 LOC) + `scripts/seed-full-app-demo.ts` (-1721 LOC) + `src/lib/observability.ts` (-28 LOC). Plan-checker rejects Phase 16 Day 1 commit without file presence check on all three. |
| Migration drift resolution | Phase 16 prep | Path A/B/C decision in TODOS.md from v0.17 carryover (DISCO-05 push pending). Resolved BEFORE any v1 migration files (093-097) land. Convergence documented in `.planning/phase-16/migration-drift-resolution.md`. |
| Day-0.5 Vault-from-Railway pre-flight | Phase 16 prep | Read known KEK row from Supabase Vault and decrypt test ciphertext. If access denied: skip ahead to Phase 18 with "fix Vault access" as first task (highest-probability root cause per Skeptic voice). |
| 10/10 teams onboarded via CSV by Day 2 | Phase 15 exit | Per-team `strategy_verifications.status='validated'` row check. Below ≥3-of-10 reply threshold logs gap to `.planning/phase-15/customer-signal-gap.md` and ships anyway. |
| Day-2 decision gate (Day 4) | Phase 16 → Phase 19 | Founder reviews `/api/debug-key-flow` output with 2-hour minimum deliberation floor. Decision document `.planning/phase-16/day-2-decision.md` lands BEFORE any Phase 18/19 code, MUST contain (a) candidate root causes ranked by evidence weight, (b) regression test snippet for chosen fix, (c) explicit refutation of each Phase 19 task NOT needed if SKIP path chosen, (d) `correlation_id` evidence chain. SKIP if single chain → ONE bug + regression test + no other unexplained failure mode; COMMIT if 2+ root causes OR ≥3 files OR no clean unit test possible; HOLD (24h) if surfaced cause unfamiliar. |
| Phase 17 zero-TBD gate (DESIGN.md 9-state matrix) | Phase 17 → Phase 19 | Hard gate. `gsd-sdk validate phase-17-exit` greps `.planning/phase-17/*` and DESIGN.md additions for `TBD | TODO | TKTK`; FAILS if any remain in 9-state matrix, trust-tier table, broker selector spec, or error envelope wireframe. Plan-checker rejects Phase 19 entry without DESIGN.md grep showing zero TBDs. |
| Theme 4 ≥1 Metaworld verbal-in-writing | Phase 18 entry | Text logged in `.planning/phase-18/metaworld-commitment.md` before Phase 18 starts. Without commitment, log gap and reduce Phase 19 scope to "internal infrastructure only" (no marketplace credibility claim). |
| Phase 19 route inventory | Phase 19 entry | `.planning/phase-19/route-inventory.md` greps every Next.js route exporting non-GET handlers touching `api_keys | strategies | strategy_analytics | verification_requests | strategy_verifications | compute_jobs`. Every row maps to a `flow_type` OR carries explicit "out of scope, rationale: …" (Pitfall 1 mitigation). |
| Phase 19 migration plan | Phase 19 entry | Migration numbers 093-097 reserved upfront in `.planning/phase-19/migration-plan.md` (093 strategy_verifications + status enum; 094 VIEW shim with `INSTEAD OF` triggers; 095 wait period; 096 fingerprint JSONB + `compute_similarity()`; 097 wizard_session_id idempotency UNIQUE INDEX + `process_key_long` registry insert). Plan-checker rejects Phase 19 entry without document. |
| Phase 16 migration slot | Phase 16 Plan 5 | Migration `098_resend_message_correlation.sql` is reserved for Phase 16 Plan 5 (Resend tag round-trip fallback table). Lands AFTER the Phase 19 reserved 093-097 block. Do not reuse 098 from any other phase. Documented 2026-05-01 after Plan 5 originally targeted 095 (collision with Phase 19 wait-period reservation). |
| Phase 19 4-PR VIEW-shim sequence | Phase 19 exit | Plan-checker rejects exit if any single PR combines adjacent steps (a) repoint `verify-strategy/route.ts:115` → `strategy_verifications` + flag flip + (c) verify zero writes ≥24h + 7 calendar days at 100% rollout + (d) rename + `INSTEAD OF` triggers + 90-day legacy retention. |
| Phase 19 customer-feedback document | Phase 19 exit | `.planning/phase-19/customer-feedback.md` captures verbatim feedback from 1-2 of the 10 teams running a real key submission via the unified flow (NOT a screenshot demo). |

## Deferred Items

### Carried forward to v1.0.0 (re-evaluated; non-blocking for v1)

| Category | Item | Status |
|----------|------|--------|
| analytics | Stress testing engine | Deferred past v1 |
| analytics | Monthly performance commentary (deterministic, no LLM) | Deferred past v1 |
| analytics | Drawdown story card | Deferred past v1 |
| analytics | Advanced portfolio optimizer | Deferred past v1 |
| peer | Peer benchmarking foundation | Sprint 13+ (gated on 5+ connected allocators) |
| benchmark | Multi-benchmark correlation matrix (ETH/SOL ingestion) | Sprint 13+ |
| team | Manager Workspace, Inbox, Threads, Mandate, Activity log | Reconsidered post-v1.0 |
| moat | Match-flag UX, FoF-specific landing surface, pgvector + HNSW migration | v2 design doc (opens after v1.0 stability window passes) |
| broker | MT5 + IBKR API adapters | v2 (CSV-bridged in v1 per UC-B) |
| concerns | `compute_jobs` RLS wide-open (`USING (true)`) | Flag for Phase 16 security audit |
| concerns | Wizard-draft cleanup cron | Resolved 2026-04-29 via PR #88 |
| concerns | Dual cron path (Railway + shim routes) | Vercel Pro lifted 2-cron limit; deferred |
| concerns | Phase 01 VALIDATION.md retroactive scaffold | Non-blocking |

## Decisions

### v1.0.0 milestone planning (2026-04-30)

- v1.0.0 = "the version I show LPs and managers" (founder direct quote, 2026-04-30). Headline: API-Key Rewrite. Manager Workspace IA deferred — re-evaluate post-v1 once paid pilots validate FoF/manager demand.
- Plan source: `~/.gstack/projects/AI-Isaiah-Quantalyze/helios-mammut-main-design-20260429-225031.md` — 1495-line autoplan with cross-AI dual-voice review. Treated as research input; gsd workflow re-derived REQ-IDs and phase boundaries.
- Phase numbering continues from Phase 14b (no `--reset-phase-numbers`): v1.0.0 starts at Phase 15. Old phase dirs already archived.
- Research enabled: 4 parallel researchers (STACK / FEATURES / ARCHITECTURE / PITFALLS) ran before requirements gathering.
- v0.17.1.x cleanup line closed at v0.17.1.31 (2026-04-30) — all 5 carryover items shipped before v1.0 setup began.
- 11 User Challenges from autoplan accepted: UC-A (CSV-first Phase 15), UC-B (drop MT5/IBKR API adapters), UC-C (defer pgvector to v2), UC-D (Phase 17 Design Contract before Phase 19), UC-E modified (let PR #90 merge but pin restore-e2e-fixtures FIRST), UC-F (founder LP skeleton in Phase 18), UC-G subsumed by UC-D, UC-H (PostHog mobile audit), UC-I (Phase 16 spike + Day-2 decision gate), UC-J (4-hour competitive teardown), UC-K (cron-based rollback monitor).
- Out of scope for v1: match-flag UX, FoF landing surface, pgvector+HNSW migration, MT5+IBKR API adapters, pricing experiment, IC-handoff PDF (Eltican Positron Dashboard reference template), branded LP design — deferred to v2 design doc, opened only after Phase 19 stability window passes.
- Roadmap created 2026-04-30: 5 phases (15-19), conditional Phase 19 gated on Day-2 decision, 39/39 REQs mapped, wave structure ratified, 11 phase-internal gates encoded.

## Accumulated Context

### Roadmap Evolution

- v1.0.0 (this milestone) re-prioritized over v0.18.0.0 Manager Workspace IA on 2026-04-30: founder's #1 operational pain is API-key wizard recurrence + 10 blocked teams + own-fund LP report. Manager Workspace breadth deferred until reliability + dogfood loop are proven.
- v1.0.0 plan = autoplan-restructured "API-Key Rewrite" with 5 phases (15-19) and conditional Day-2 decision gate. Phase 19 only runs if Phase 16 diagnostic finds the root cause requires architectural rewrite vs single-config fix.
- Roadmap (2026-04-30) ratified 5-phase structure with explicit wave dependencies + 11 phase-internal gates. Conditional Phase 19 modeled in `.planning/ROADMAP.md` "Conditional Execution Logic" diagram.
- 2026-05-06 — Phase 18 plan-phase records that BACKBONE-06 (open-perp correctness) + BACKBONE-07 (TWR ≠ YTD reconciliation) push from Phase 18 to Phase 19 per `.planning/phases/18-root-cause-fix-founder-lp-skeleton/18-CONTEXT.md` L22-23. Rationale: Phase 19's `IngestionAdapter.reconstruct_positions` + equity-curve refactor absorbs the same call sites; Phase 18 already heavy with FIX-04 redact mirror + LP cron + 10-team verification. Day-2 doc Section 5's "IN (Phase 18)" rows are now superseded — see `.planning/phase-16/day-2-decision.md` Section 5 REVISED header AND inline row supersede annotations (Adversarial revision 2026-05-06: W6).
- Phase 19.1 inserted after Phase 19: CSV → analytics → factsheet pipeline (prior work on feat/csv-analytics-pipeline-2026-05-21 may be discarded) (URGENT)

### Cross-AI dual-voice review conventions (from v0.17.0.0 onward)

- Cross-AI review is now standard practice for milestone plans. v1.0.0 used Grok 4.2 multi-agent (`grok-4.20-multi-agent-0309` via `/v1/messages` Anthropic-compat) across 3 personas (Architecture / Product / Skeptic) + Claude subagents on CEO + Design + Eng phases.
- Dual-voice review consensus surfaces concerns where BOTH models independently agree the plan should change. These become "User Challenges" presented at the final approval gate for explicit user decision rather than auto-applied.
- v1.0.0 had 11 User Challenges resolved 2026-04-30 (10 accepted, 1 modified).
- 6/6 CEO + 7/7 Design dimensions originally CONFIRMED-AGAINST v1.0.0 plan signals genuine architectural concerns rather than superficial nits. Restructure section in plan file addresses all critical findings.

## Session Continuity

Last session: 2026-05-07T18:55:59.984Z
Stopped at: context exhaustion at 76% (2026-05-07)

**Active milestone:** v1.0.0 — API-Key Rewrite — Diagnose → Fix → Unify → Ship to LPs — 2026-04-30

**Next phase:** Phase 15 (CSV Unblock) — Wave 1 entry condition: Theme 4 founder pings 10 teams, ≥3 reply threshold (≥3 unlocks; <3 ships anyway with logged gap).

**Planned Phase:** 16 (Diagnostic Spike + Observability) — 10 plans — 2026-05-01T08:29:28.242Z
