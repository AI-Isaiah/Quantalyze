---
gsd_state_version: 1.0
milestone: v1.3
milestone_name: Mobile & Adaptive UI
status: executing
stopped_at: Phase 46 UI-SPEC approved
last_updated: "2026-06-27T17:26:23.443Z"
last_activity: 2026-06-27
progress:
  total_phases: 5
  completed_phases: 2
  total_plans: 11
  completed_plans: 9
  percent: 82
---

# Project State

## Project Reference

See: `.planning/PROJECT.md` (reconstructed 2026-06-21 at v1.1.0 milestone start)

**Core value:** Allocators act on Bridge recommendations and see whether those suggestions actually worked — and can model the impact of composition changes before they make them.
**Current focus:** Phase 46 — surface-by-surface-reflow
**Last milestone:** v1.2.2 scenario-tab-factsheet-parity (Phases 39–43, shipped + tagged 2026-06-26).

## Current Position

Phase: 46 (surface-by-surface-reflow) — EXECUTING
Plan: 3 of 4
Status: Ready to execute
Last activity: 2026-06-27

## Milestone Roadmap (v1.3 Mobile & Adaptive UI)

Phases continue from v1.2.2's Phase 43 (no reset). A RETROFIT / gap-closing
milestone — the hard primitives (mobile nav shell, a gold-standard
responsive+touch SVG chart, an SSR-safe breakpoint hook) already exist. Build
order is dependency-ordered and regression-first: build the shared primitives +
the bespoke verification gates FIRST so every later surface is continuously
checked at 320px / 400% zoom; complete the nav shell so surfaces are tested
inside real mobile chrome; do the zero-frozen-boundary-risk CSS surface reflow;
then charts last (SVG before the most-complex Recharts/EquityChart family)
because that is the only category where the frozen math boundary is nearby. All
additive presentation over the FROZEN `scenario.ts` / `compute.ts` engine; no
migration. See `.planning/ROADMAP.md` § `## v1.3 — Mobile & Adaptive UI` for full
phase detail + success criteria.

| Phase | Goal (one line) | Requirements | Depends on |
|-------|-----------------|--------------|------------|
| 44. Foundation Primitives & Verification Gates | Shared primitives (`useBreakpoint` / `ResponsiveTable` / `ResponsiveChartFrame`) + bespoke CI gates (320px reflow / 44px target-size / zoom-meta) built FIRST | A11Y-02 (1) | — (first) |
| 45. Navigation Shell Completion | Role-aware mobile bottom nav + scrollable tab strip + hardened drawer focus-trap + app-wide skip-link | NAV-01..03 (3) | 44 |
| 46. Surface-by-Surface Reflow (CSS-first) | Every authed + public route reflows at 320px / 400%; tables reshape (never drop columns); wizard de-blocked; honest 9-state | TABLE-01, WIZARD-01, REFLOW-01..03 (5) | 45 |
| 47. Hand-Rolled SVG Charts | 16 SVG charts touch-inspectable + legible at 320px + portrait-tuned; frozen math byte-identical | CHART-01a, CHART-02, CHART-03 (3) | 46 |
| 48. Recharts + EquityChart + Final Verification | Recharts/EquityChart touch parity (NOT rewritten); combined gate matrix + mobile perf budget app-wide; real-device authed sign-off | CHART-01b, A11Y-01, A11Y-03 (3) | 47 |

**Coverage:** 14 v1 requirements mapped to exactly one phase (CHART-01 split into CHART-01a/SVG + CHART-01b/Recharts by chart family; 16 REQ-IDs, no orphans, no duplicates).

**Key risk gates carried from research (encode at plan-phase time, not requirements):**

- **axe is necessary but insufficient** — axe can't test Reflow (1.4.10), Resize Text (1.4.4), Target Size (2.5.8), or focus-trap correctness (the four things v1.3 is most about). The bespoke gates sit BESIDE app-wide axe, built in Phase 44, run app-wide in Phase 48.
- **Frozen-math byte-identity is the highest-cost regression** (Phase 47/48) — SCENARIO-05 + BODY-02 + `compute.ts` parity + chart-parity snapshots stay green; charts read precomputed payload values, never recompute. A red guard is information, never an obstacle to weaken (equal in weight to prior milestones' IMPACT-02 / BODY-02 gates).
- **No table drops a material column** (Phase 46) — reshape (scroll / stack / labeled-summary), never `hidden md:table-cell` on a material metric/status; an all-columns-present guard on the highest-stakes tables.
- **FLOW-01 wiring** — every new e2e gate (reflow / target-size / zoom-meta / mobile-keyboard / mobile-axe / perf-budget) must be wired into BOTH the `HAS_SEED_ENV` seed-guard AND `ci.yml`, or it never runs (burned twice).
- **Coverage ratchet held** (every phase) — lines 82 / stmts 80 / fns 74 / branches 72; new viewport conditionals need branch coverage; never lower a threshold or blanket-update a snapshot to go green.
- **Real-device authed sign-off** (Phase 48) — headless can't hydrate authed pages; final acceptance is a human on a real phone across the authed surfaces.

---
## Accumulated Context — v1.0.0 (carried forward as project memory)

## Phase 15 Closure (2026-05-28)

Phase 15 (CSV Unblock) marked **roadmap-complete** via `/gsd-autonomous --only 15`. All 7 plans (15-01…15-07) executed; `15-VERIFICATION.md` re-verified 10/10 must-haves still wired in current main (commit `6228e855`). Status promoted **human_needed → passed**. The 5 human-needed live-validation items were resolved earlier via **PR #327 (v0.24.9.35, prod-deployed 2026-05-27)** which shipped two bug fixes the live verification surfaced:

- **CSV wizard `strategyName` debounced-autosave** — `WizardClient.tsx:72,340` debounce window now wraps the autosave to localStorage so back-nav rehydrates the typed name.
- **/admin/csv-status singular published-gated factsheet link** — `admin/csv-status/page.tsx:144` `status==='published' ?` gate prevents 404s for non-published rows.

No re-plan/re-execute was run — the work was already complete on disk; only the ROADMAP Phase plans checkboxes + Phase heading needed ticking, VERIFICATION.md status flip, and STATE.md update.

> **Note (out of scope this pass):** the "Current Position" block below still says Phase 19.1 EXECUTING; disk shows 19.1 complete. Only Phase 15 was reconciled here per the user's `--only 15` scope.

## Phase 18 Closure (2026-05-27)

Phase 18 (Root-Cause Fix + Founder LP Skeleton) marked **roadmap-complete** via `/gsd-autonomous --only 18`. All 4 plans (18-01…18-04) executed; `18-VERIFICATION.md` records **7/7 must-haves verified** (2026-05-06). Code shipped in-flight via PR #116 + commits `a48a92e`/`1960f54`. No re-plan/re-execute was run — the work was already complete on disk; only the ROADMAP Phase Summary checkbox needed ticking.

Three items remain in `human_needed` status — **deferred to /ship-time founder action, NOT code work**:

- **FIX-02** — founder runs own OKX key through wizard + fills `.planning/phase-18/founder-okx-smoke.md`
- **FIX-03** — ≥3 of 10 onboarding teams reach `strategy_verifications.status='published'`
- **LP-03** — founder writes verbatim dogfood commitment in `.planning/phase-18/dogfood-commitment.md` (currently `PENDING`)

`scripts/verify-phase18-artifacts.ts` gates the /ship pre-flight on these three.

> **Note (out of scope this pass):** the "Current Position" block above is stale (predates today; says 19.1 EXECUTING while disk shows 19.1 complete). Only Phase 18 was reconciled here per the user's `--only 18` scope. A full ROADMAP↔disk↔STATE reconciliation for phases 15/19/19.1 was not performed.

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
- [Phase ?]: Phase 20: MT5 fixtures DENSE calendar-daily at live periods=252; KPI oracles from real quantstats@252 pipeline
- [Phase ?]: Phase 20: T10/T11/T13 scoped as ingestion pins; deal classification + DST correctness deferred to manual T14 (EA-side MQL5)
- [Phase ?]: Phase 20: MT5 EA DEAL_TYPE_CORRECTION default=COST (configurable via CorrectionIsFlow input); every CORRECTION deal logged to audit sidecar for T14 broker confirmation (H6)
- [Phase ?]: Phase 20: EA doc comments avoid forbidden-token names verbatim so the 20-03 raw-source read-only CI grep (which scans comments) stays clean — no comment-stripping needed
- [Phase ?]: Phase 20: T14/T15 (demo-account numeric reconcile + restart-state) are HUMAN-PENDING — they have no CI harness and gate the first live KPI, not phase CI completion
- [Phase ?]: Phase 20 T16: MT5 EA read-only invariant CI-enforced via pure-grep denylist over tools/mt5/**/*.{mq5,mqh} (low-level + CTrade method surface); comment-evasion accepted residual, T14 reconcile is runtime backstop.
- [Phase ?]: Phase 21-01: surfaced Scenario tab via single VISIBLE_TAB_KEYS edit (already a wired TabKey; render loop + keyboard nav both derive from it)
- [Phase ?]: Phase 21-01: Strategy Sandbox sidebar link gated on isAllocator ONLY (not showsAllocatorWorkspace); admin-only sees nothing; server gate at scenarios/page.tsx untouched
- [Phase ?]: Phase 21-02: CORR-04 satisfied by show-all heatmap removal of pickTopTenByAvgCorr (not a top-10 disclosure); aria-label names the true strategy count
- [Phase ?]: Phase 21-02: shortest history = fewest daily_returns points (window length); first-seen tiebreak; empty->null, single->lone name
- [Phase ?]: Phase 21-02: ids.length<2 is the load-bearing CORR-02 gate (engine returns a non-null 1x1 matrix for 1 strategy); empty-state routing checks overlappingDays<10 first
- [Phase ?]: Phase 21-03: own-book composer mounts CorrelationHeatmap with de-aliased labels; Avg |ρ| single-sourced from scenarioMetrics.avg_pairwise_correlation
- [Phase ?]: Phase 21-03: IMPACT-02 no-peer-ranking guard keys on a render-only data-testid (not queryByText, which only matched a title= attr) + a positive-control isolation render; mutation-verified falsifiable both directions
- [Phase ?]: Phase 21-04: example-universe Sandbox brought to honesty parity — new header row with Example universe (SURF-03) + persistent PROJECTED (IMPACT-01) neutral-outline pills, coverage caveat (metrics.n + shortestHistoryName(strategies)), Avg |ρ| relabel; parent PageHeader + frozen engine untouched
- [Phase ?]: Phase 21-04: ScenarioBuilder takes the already-collapsed strategies prop (no internal de-alias) so shortestHistoryName(strategies) is the faithful caveat call; Avg |ρ| appears twice by design (MetricCard label + single-sourced heatmap caption), tests assert getAllByText length >= 1
- [Phase ?]: Phase 21-04: IMPACT-02 Sandbox neuter guard keys on the render-only data-testid percentile-rank-badge (added in 21-03) + isolated positive control; mutation-verified falsifiable (wiring the badge into ScenarioBuilder made the ABSENT assertion fail), reverted
- [Phase ?]: Phase 22-01: HONEST-01 method label rendered VERBATIM 'Historical realized' (realized stats over the overlap window); 'bootstrap' NOT claimed (that is Phase 27)
- [Phase ?]: Phase 22-01: methodology line folded into the one existing caveat <p> (no second line, no token/DOM change); N inline in DM Sans (not Geist Mono), matching the shipped Phase-21 line; sandbox anchored ^Projected regex updated same-task
- [Phase ?]: Phase 22-02: HONEST-02 single source = src/lib/sample-floor.ts (SAMPLE_FLOOR_OVERLAPPING_DAYS=60, named distinctively NOT MIN_* to dodge min-history grep collision); evaluateSampleFloor guard-first (null/NaN/Infinity/negative -> no-usable-n FIRST never passes), then below-floor, else ok; per-call floor override honored
- [Phase ?]: Phase 22-02: SampleFloorEmptyState COPIES the CorrelationHeatmap shell verbatim (does not import/modify it; different statistic-specific threshold, shared visual shell); imports copy builders+heading from @/lib/sample-floor; not role=alert, no red/warning; 0/1-strategy is a call-site strategyCount prop (gate cannot see count) taking precedence; pinned in CONTRACT_GUARDS + REGISTRY.md, EXPECTED_RULES untouched; NOT wired into live composer/sandbox projection (deferred to 26/27)
- [Phase ?]: Phase 23-01: scenarios.name carries no uniqueness constraint (same-titled variants; UNIQUE = 23505 timebomb)
- [Phase ?]: Phase 23-01: no set_updated_at trigger fn (dump-sql-functions snapshot gate); UPDATE route touches updated_at=now()
- [Phase ?]: Phase 23-01: scenarios_owner FOR ALL RLS (USING+WITH CHECK allocator_id=auth.uid()); RLS test asserts cross-tenant content by row id, negative write = ROW_COUNT 0 not 42501
- [Phase ?]: Phase 23-01: scenarios block hand-patched into database.types.ts (no gen types); expectTypeOf-pinned; [#14] tripwire (migration 115 notify_*) preserved
- [Phase ?]: Phase 23-03: ScenarioCompareTable Max Drawdown uses higherIsBetter=true (tested CompareTable flag); signed max_drawdown means least-severe=highest, so UI-SPEC false would crown the worst drawdown (winner inversion). Rule 1 fix, test-pinned.
- [Phase ?]: Phase 23-03: live-book compare column via synthetic all-on equity-weight draft through computeMetricsForDraft (same engine path), NOT payload.liveBaselineMetrics; per-column methodologyLine stamp in tfoot, not a shared-window header.
- [Phase ?]: Phase 23-02: scenario CRUD via single-row supabase.from('scenarios') under RLS (no RPC); allocator_id always from withAllocatorAuth never the body (test-proven); [id] handlers await ctx.params + isUuid()-validate before delegating to withAllocatorAuth-wrapped inner (withAuth does not forward ctx); non-owned id -> 0 rows -> 404 not 403; PUT touches updated_at=now() in payload (no trigger fn)
- [Phase ?]: Phase 23-04: hydrateFromSaved routes through setValue (not removeStored) so the fingerprint-mismatch banner derives automatically with no loadedFromDb bypass; localStorage key never wiped on reopen (Pitfall 2/6)
- [Phase ?]: Phase 23-04: Open decodes row.draft through scenarioDraftCodec (never a bare cast); reset=honest 'older format' notice + NO hydrate (never a silent empty composer), readonly=hydrate+block edits, ok=hydrate+adopt id
- [Phase ?]: Phase 23-04: loadedScenarioId tracked in composer state; handleReset wraps scenario.reset() across all reset paths; Save/Save-as-new POST, Update PUTs; Open driven via onRegisterOpen seam for the future saved-scenarios list
- [Phase ?]: Phase 23-05: SavedScenariosList + ScenarioComparePanel wired on the Scenario tab via a ScenarioTabContent sub-component (V2 path only); GET list returns draft (Rule 3); onScenarioSaved composer seam (Rule 2) refetches the list; compare columns decode via codec trichotomy (reset/degenerate -> em-dash, never 0)
- [Phase ?]: Phase 24-02: GET /api/benchmark/btc returns BTC DAILY RETURNS [{date,value}] (pct-change of close_price, first row dropped, asc) as PUBLIC-cacheable shared market data (Cache-Control: public s-maxage=3600 SWR) — deliberate contrast with allocator no-store; read-error OR <2 rows degrade to 200 [] (honest empty, never 500); no params, BTC hard-coded, no tenant data, no migration/Python (Railway no-op)
- [Phase ?]: Plan 24-03: wired the BTC overlay onto EquityChart.benchmark (SVG widget) fed a cumulative-wealth curve via computeStrategyCurve (24-RESEARCH Pitfall 3)
- [Phase 24]: Plan 24-03: extracted ScenarioBenchmarkSection so the honesty invariants are unit-testable without mounting the 1900-line composer
- [Phase ?]: Phase 25-01: share read path is hash-in-Node — get_shared_scenario(p_token_hash TEXT) takes a precomputed sha256 hex; no pgcrypto digest (Plan 25-02 owns the single digest site). search_path=public,pg_temp; body-shape self-assert proves no api_keys/portfolios + revoke gate + published filter.
- [Phase 25]: Phase 25-02: scenario-share-token.ts is the single sha256 digest source-of-truth — mintShareToken() = randomBytes(32)->base64url raw (43 chars, URL-only) + hashShareToken(raw) sha256 hex (the only thing at rest, == get_shared_scenario p_token_hash). random+stored-hash (revocable per SHARE-03), NO env secret (distinct from demo-pdf-token HMAC); Node crypto only, no installs. 6 TDD unit tests pin entropy/format/determinism + known sha256 vectors so an algorithm change vs the RPC fails CI loudly. SHARE-01 complete.
- [Phase 25]: 25-03: validate share scenario_id via isUuid (UUID_RE), not zod v4 .uuid() which enforces RFC-4122 variant bits and rejects valid Postgres ids
- [Phase 25]: 25-03: generate stores only token_hash; raw token returned once in the URL; Copy link re-generates (list never holds the raw token)
- [Phase 25]: 25-03: scenario.share/scenario.share.revoke audit actions (TS+Python parity); scenario_shares registered as a GDPR direct user-owned table
- [Phase 25]: 25-04 recipient page renders an inline return-form KPI strip, NOT KpiStrip (KpiStrip leaks USD/AUM)
- [Phase 25]: 25-04 DI-23-01 closed: share-resolve branches on codec outcome, only ok computes, never reads .value on non-ok, neutral holdings-free default
- [Phase 25]: 25-04 public page revoke immediacy via force-dynamic + no-store; RPC revoked_at IS NULL is the gate; resolve to revoke to 404 page-tested (SHARE-03)
- [Phase 25]: 25-04 toWealth imported from EquityChart module (its real export), not @/lib/scenario (stale JSDoc)
- [Phase ?]: 26-01: WRAP computeVaR/computeExpectedShortfall + computeScenarioBenchmark behind a null-on-degenerate envelope (never fork); reuse computeScenarioBenchmark for beta to inherit the constant-BTC relative-scale guard
- [Phase ?]: 26-01: track two distinct overlap-Ns (varN scenario overlap, betaN BTC inner-join overlap); VaR computed on the already-leveraged series with no leverage multiplier
- [Phase ?]: 26-02: StressVarSection is props-only over computeScenarioStress; only local state is the shock-preset useState — em-dash on null, monochrome losses, imported floor SoT
- [Phase ?]: 26-02: two-N disclosure — single VaR/CVaR caption when varN===betaN; a distinct methodologyLine(betaN) caption only when the Ns differ
- [Phase ?]: 26-02: mounted in the own-book ScenarioComposer ONLY (sibling Card after ScenarioBenchmarkSection); ScenarioBuilder untouched
- [Phase ?]: 44-01: useBreakpoint inverse-query SSR desktop-first
- [Phase ?]: 44-01: ResponsiveTable kept as Server Component (no client hooks); scroll affordance only, no table restyle
- [Phase ?]: 44-02: ResponsiveChartFrame uses explicit block-w-full concat (not cn) to preserve verbatim class order + byte-identity
- [Phase ?]: 44-02: TimeSeriesChart adopts ResponsiveChartFrame byte-identically; parity guarded by structural unit test (not the dead e2e parity spec)
- [Phase ?]: P44-03: zoom-meta gate as a Vitest source-scan test (zero ci.yml edit / zero seed gate); root layout viewport export zoom-permissive (no maximumScale/userScalable) per WCAG 1.4.4
- [Phase ?]: 44-04: reflow gate measures documentElement.clientWidth (not innerWidth) with <=1px slop per SC#1
- [Phase ?]: 44-04: target-size gate scoped to /security LegalFooter min-h-[44px] legal-nav links (44px bar un-weakened; app-wide rollout deferred to phases 46/48)
- [Phase ?]: 44-04: phase-44 reflow/target-size gates are UNSEEDED, wired into ci.yml unseeded list (FLOW-01 place 1), not the seed-gated MA-8 list
- [Phase ?]: 45-02: Applied scroll classes to the existing role=tablist element itself (no new role-bearing wrapper) to preserve JOURNEY-03 aria-required-children.
- [Phase ?]: 45-02: active-tab scrollIntoView keyed on activeTab effect with prefers-reduced-motion behavior:auto; no edge-fade overlay (DESIGN.md).
- [Phase ?]: 46-02: ScenarioCompareTable + CorrelationMatrix migrated onto ResponsiveTable (inner overflow-auto div only; outer correlation-matrix wrapper + inline hex kept verbatim); admin ComputeJobsTable scroll-wrap only; 2 falsifiable all-columns guards proven RED-on-drop

## Accumulated Context

### Roadmap Evolution

- v1.0.0 (this milestone) re-prioritized over v0.18.0.0 Manager Workspace IA on 2026-04-30: founder's #1 operational pain is API-key wizard recurrence + 10 blocked teams + own-fund LP report. Manager Workspace breadth deferred until reliability + dogfood loop are proven.
- v1.0.0 plan = autoplan-restructured "API-Key Rewrite" with 5 phases (15-19) and conditional Day-2 decision gate. Phase 19 only runs if Phase 16 diagnostic finds the root cause requires architectural rewrite vs single-config fix.
- Roadmap (2026-04-30) ratified 5-phase structure with explicit wave dependencies + 11 phase-internal gates. Conditional Phase 19 modeled in `.planning/ROADMAP.md` "Conditional Execution Logic" diagram.
- 2026-05-06 — Phase 18 plan-phase records that BACKBONE-06 (open-perp correctness) + BACKBONE-07 (TWR ≠ YTD reconciliation) push from Phase 18 to Phase 19 per `.planning/phases/18-root-cause-fix-founder-lp-skeleton/18-CONTEXT.md` L22-23. Rationale: Phase 19's `IngestionAdapter.reconstruct_positions` + equity-curve refactor absorbs the same call sites; Phase 18 already heavy with FIX-04 redact mirror + LP cron + 10-team verification. Day-2 doc Section 5's "IN (Phase 18)" rows are now superseded — see `.planning/phase-16/day-2-decision.md` Section 5 REVISED header AND inline row supersede annotations (Adversarial revision 2026-05-06: W6).
- Phase 19.1 inserted after Phase 19: CSV → analytics → factsheet pipeline (prior work on feat/csv-analytics-pipeline-2026-05-21 may be discarded) (URGENT)
- 2026-06-14 — Phase 20 added: MT5 EA daily-returns ingestion (Approach A). Spec = autoplan Phase 3 Eng test plan, preserved at `.planning/phases/20-mt5-ea-daily-returns-ingestion-approach-a/TEST-PLAN.md`: MQL5 EA (Wine, no CI harness) emits `date,daily_return` CSV → pin output contract with checked-in golden fixtures (T1–T13), test ingestion/KPI in the Python suite, gate first live KPIs on a one-time manual demo-account reconcile (T14/T15) + read-only EA static check (T16). Must-pass before any KPI is page-visible: T2 (deposit-day), T5 (gap), T14 (manual reconcile). Note: roadmap had been dormant since Phase 19.1 (May 28) while the project shipped v0.24.x via gstack/audit flows — Phase 20 re-engages GSD phase tracking. Not planned yet (run `/gsd:plan-phase 20`).
- 2026-06-27 — v1.3 Mobile & Adaptive UI roadmap created (Phases 44–48, continuing from 43; no reset). A retrofit/gap-closing milestone — the hard primitives already exist; the work is wiring them across ~40 surfaces + closing concrete reflow gaps + standing up the bespoke a11y gates axe can't cover. Research (4 files) converged on the 5-phase dependency order; CHART-01 split into CHART-01a (SVG/Phase 47) + CHART-01b (Recharts+EquityChart/Phase 48) by chart family so each REQ-ID owns one phase. 14 v1 requirements, 0 orphans.

### Cross-AI dual-voice review conventions (from v0.17.0.0 onward)

- Cross-AI review is now standard practice for milestone plans. v1.0.0 used Grok 4.2 multi-agent (`grok-4.20-multi-agent-0309` via `/v1/messages` Anthropic-compat) across 3 personas (Architecture / Product / Skeptic) + Claude subagents on CEO + Design + Eng phases.
- Dual-voice review consensus surfaces concerns where BOTH models independently agree the plan should change. These become "User Challenges" presented at the final approval gate for explicit user decision rather than auto-applied.
- v1.0.0 had 11 User Challenges resolved 2026-04-30 (10 accepted, 1 modified).
- 6/6 CEO + 7/7 Design dimensions originally CONFIRMED-AGAINST v1.0.0 plan signals genuine architectural concerns rather than superficial nits. Restructure section in plan file addresses all critical findings.

## Session Continuity

Last session: 2026-06-27T17:26:14.575Z
Stopped at: Phase 46 UI-SPEC approved

**Active milestone:** v1.3 — Mobile & Adaptive UI — every surface fluidly responsive (resolution / mobile / zoom) with UI best practices as the bar — started 2026-06-27

**Next phase:** Phase 44 (Foundation Primitives & Verification Gates) — build the shared primitives + the bespoke CI gates FIRST so phases 45–48 are continuously verified at 320px / 400% zoom.

## Deferred Items

Items acknowledged and deferred at v1.0.0 milestone close on 2026-06-20. Full
checklist in `.planning/MILESTONE-v1.0.0-FOUNDER-ACTIONS.md`.

| Category | Item | Why deferred |
|----------|------|--------------|
| verification | Phase 18 FIX-03 — ≥3 onboarding teams reach published | No onboarding teams onboarded yet (needs real clients) |
| verification | Phase 19 #2 — ≥1 real customer-feedback entry | Needs real client submission (logged gap, Theme 4 ship-anyway) |
| verification | Phase 20 T14/T15 — MT5 demo-account reconcile | Needs founder on an MT5 demo terminal (no CI harness) |
| verification | Phase 18 FIX-02 — founder OKX wizard smoke run | Founder live run; LP-03 dogfood commitment text pending |
| verification | Phase 19 #3 — Sentry events probe (real token) | Needs live SENTRY_AUTH_TOKEN |
| verification | Phase 19 #5 — Vercel INTERNAL_API_TOKEN parity | Needs `vercel env pull` against prod secrets |
| uat | Phase 16 — SSE smoke / Day-2 fill | Superseded: diagnostic served its purpose (bug fixed P18, backbone shipped P19/PR-D) |
| ops | RESEND_API_KEY in Vercel prod | Founder must set before 2026-07-01 (monthly LP-report cron) |

Resolved at close (post-PR-D): Phase 19 PR-B→PR-D 168h gate, 7-day stability, and quantstats probe all VERIFIED; Phase 16 correlation_id 5th layer + cassettes superseded by Phase 18 + cassette-refresh.

## Operator Next Steps

- Plan the first v1.3 phase with `/gsd:plan-phase 44`
