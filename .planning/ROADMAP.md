# Roadmap: Quantalyze

## Milestones

- ✅ **v0.14.0.0 Sprint 8: Bridge V2** — Phases 1–5 (shipped 2026-04-19) → [archive](milestones/v0.14.0.0-ROADMAP.md)
- ✅ **v0.15.0.0 Sprint 9: Demo-to-Production** — Phases 06–10 + 09.1 (shipped 2026-04-27) → [archive](milestones/v0.15.0.0-ROADMAP.md)
- ✅ **v0.16.0.0 Phase 11: Onboarding & Security Readiness** — Phase 11 (shipped 2026-04-27) → [archive](milestones/v0.16.0.0-MILESTONE-AUDIT.md)
- ✅ **v0.17.0.0 Sprint 12: KPI Parity and Discovery v2** — Phases 12–14b (shipped 2026-04-29) → [archive](milestones/v0.17.0.0-ROADMAP.md)
- 🚧 **v1.0.0 API-Key Rewrite** — Phases 15–19 (started 2026-04-30) — Diagnose → Fix → Unify → Ship to LPs

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

### 🚧 v1.0.0 API-Key Rewrite (In Progress)

**Milestone Goal:** Ship the version Quantalyze can credibly put in front of LPs and managers. Fix the recurring API-key wizard failure at the root, unify three divergent code paths into one observable backbone, unblock the 10 quant teams in pipeline (CSV-bridged immediately + API-fixed by Day 10), and establish a working dogfood loop with the founder's own LP report.

**Plan source:** `~/.gstack/projects/AI-Isaiah-Quantalyze/helios-mammut-main-design-20260429-225031.md` (1495-line autoplan; 11 User Challenges resolved 2026-04-30 — 10 accepted, 1 modified). 6/6 CEO + 7/7 Design dimensions originally CONFIRMED-AGAINST plan; restructure addresses all critical findings. APPROVED at Phase 4 Final Approval Gate.

**Net session estimate:** ~17 CC days (range 17-22). If the Day-2 decision gate (after Phase 16) chooses SKIP: ~10 CC days total — Phase 19 does not run and the milestone closes after Phase 18.

**Granularity:** standard (5 phases). Phase numbering continues from Phase 14b — no `--reset-phase-numbers`.

**Coverage:** 39/39 v1.0.0 requirements mapped to phases (no orphans).

#### Phase Summary

- [ ] **Phase 15: CSV Unblock** — Promote PR #22's CSV path to first-class so all 10 onboarding teams have a working ingestion route within 48h; ships `csv_uploaded` trust-tier placeholder + per-team `strategy_verifications` status visibility.
- [x] **Phase 16: Diagnostic Spike + Observability** — Wire correlation_id end-to-end (Next.js → FastAPI → Supabase → Resend), add Sentry on both halves of the stack, ship `/api/debug-key-flow` SSE endpoint + VCR-replay harness, audit migration triggers + PostHog mobile starts; closes with the Day-2 decision gate. (completed 2026-05-01)
- [x] **Phase 17: Design Contract** — Lock DESIGN.md additions (trust-tier badges, error envelope wireframe, broker selector grid, CSV escape-hatch card, mobile fallback, a11y minimums, 9-state matrix) BEFORE backend rewrite; trust-tier tokens land as typed code constants regex-asserted against DESIGN.md. (completed 2026-05-01)
- [ ] **Phase 18: Root-Cause Fix + Founder LP Skeleton** — Fix whatever Phase 16 surfaced with a regression test that fails without the fix; ship Python `redact.py` mirror of existing `pii-scrub.ts`; cron-emit a monthly LP report PDF reusing the existing factsheet endpoint; close the dogfood loop in writing.
- [ ] **Phase 19: Unified Backbone** *(conditional on Day-2 gate = COMMIT)* — Replace 5 divergent entry routes with one `POST /process-key` FastAPI RPC + adapter Protocol (OKX / Binance / Bybit / CSV — no MT5 / IBKR per UC-B); ship `strategy_verifications` state machine, 4-PR VIEW-shim migration sequence, feature flag + cron-based rollback monitor, perp correctness, JSONB fingerprint, idempotency.

#### Wave Structure (sequential — real dependencies enforce ordering)

| Wave | Phase | Hard Prerequisite | Why Sequential |
|------|-------|-------------------|----------------|
| 1 | 15 | Theme 4 founder pings 10 teams (≥3 reply threshold) | Customer urgency decoupled from architectural correctness; CSV is the unblock primitive while diagnosis runs |
| 2 | 16 | Phase 15 ships `csv_uploaded` placeholder + `restore-e2e-fixtures` PR merged FIRST + DISCO-05 migration drift resolved | Diagnostic harness needs `csv_uploaded` row in `strategy_verifications` to probe; PR #90 wiped fixtures Phase 16 must replay against; can't add 093+ migrations on a drifted remote |
| 3 | 17 | Phase 16 PostHog mobile audit count + Phase 16 correlation_id seam stable | Mobile fallback (DESIGN-04) is conditional on the audit; design contract references the envelope shape that Phase 16 produces |
| 4 | 18 | Phase 16 root cause surfaced + Phase 17 `wizardErrors.ts` source-of-truth declaration | Can't fix what Phase 16 hasn't yet identified; PII redaction (FIX-04) ships AFTER Phase 16 created new PII surface (`/api/debug-key-flow`) |
| 5 | 19 *(conditional)* | Phase 18 verified-working foundation + Day-2 gate = COMMIT + Theme 4 ≥1 Metaworld verbal-in-writing commitment + zero TBD cells in DESIGN.md 9-state matrix + Phase 19 route inventory + migrations 093-097 reserved upfront | Unification builds on a fix that holds; founder-interview pass is the one entry condition engineering can't enforce; design contract drift is the strongest pre-Phase-19 risk per Theme 1 |

#### Phase Details

### Phase 15: CSV Unblock
**Goal**: Extend PR #22's CSV path so all 10 onboarding teams have a working ingestion route within 48h, decoupling customer urgency from the architectural diagnosis that Phase 16 will run.
**Depends on**: Nothing (entry phase).
**Entry gate**: Theme 4 founder-interview pass — founder emails all 10 teams BEFORE execution starts; ≥3 written replies confirming "yes, CSV bridge works" OR "no, I need API only" unlocks Phase 15. < 3 replies still ships (CSV is unblock primitive) but logs gap to `.planning/phase-15/customer-signal-gap.md`.
**Requirements**: CSV-01, CSV-02, CSV-03
**Success Criteria** (what must be TRUE):
  1. User uploads daily-returns / NAV / trades CSV via first-class `flow_type='csv'` adapter (replaces PR #22 partner-pilot side-branch as canonical entry path)
  2. Uploaded CSV passes `pandera` row-schema validation (max 10MB, monotonic dates, NAV non-zero, daily return > -100% impossible, daily Sharpe > 10 sentinel suspicious, USD-or-blank currency) — `_check_trading_window` rule DROPPED 2026-04-30 cross-AI revision (crypto markets trade 24/7)
  3. Strategies onboarded via CSV display `csv_uploaded` trust-tier placeholder text on factsheet + marketplace tile (badge component polish lives in Phase 17; CSV-03 ships only the data-model wiring)
  4. Per-team onboarding status surfaces via the new `/admin/csv-status` admin page (locked 2026-04-30 cross-AI revision; ships in plan 15-07) — admin-gated, 6-column table joined to auth.users.email + strategies.name. Replaces prior "queryable rows only" scope.
**Plans**: 7 plans (cross-AI revision 2026-04-30 added 15-07 admin status page)
- [ ] 15-01-PLAN.md — Migration 093 (strategy_verifications table + RLS + finalize_csv_strategy RPC + apply to test Supabase)
- [ ] 15-02-PLAN.md — Python csv_validator (3 pandera schemas + 6 CSV-02 rules; trading_window dropped) + FastAPI csv router (validate-only; finalize endpoint removed) + requirements pin + inline _redact_preview helper
- [ ] 15-03-PLAN.md — TrustTierLabel component + Strategy.trust_tier projection + StrategyHeader/StrategyGrid wiring
- [ ] 15-04-PLAN.md — CSV wizard step components (CsvValidationEnvelope, CsvUploadStep, CsvPreviewStep, CsvSubmitStep)
- [ ] 15-05-PLAN.md — WizardStepKey union + WizardLocalState (source + strategyName) + analytics-client multipart helper (throws on missing ANALYTICS_SERVICE_URL) + Next.js proxy routes (csv-validate + csv-finalize accepts user-typed strategy_name; STRATEGY_NAMES NOT imported) + WizardClient ?source=csv branching with strategyName state
- [ ] 15-06-PLAN.md — Integration tests (RPC + route + RLS + 3 SQLSTATE 22023 guards distinguished by message content) + Playwright E2E happy path (auth.users SELECT-by-email user-id resolution + cleanup) with TrustTierLabel + user-typed name assertions
- [ ] 15-07-PLAN.md — Admin /admin/csv-status server-component page (founder per-team status surface; admin-gated; DESIGN.md compliant single-table render)
**Complexity**: LOW (operational unblock; PR #22 path already exists; 1 new Python dep `python-multipart==0.0.27`).
**UI hint**: yes
**Exit gate**: 10/10 teams reach `strategy_verifications.status='validated'` via CSV path (≥3-of-10 reply threshold from entry gate is informational; ship anyway). Per-team status logged in TODOS.md.

### Phase 16: Diagnostic Spike + Observability
**Goal**: Make observability load-bearing across Next.js → FastAPI → Supabase → Resend before any code is fixed; ship the deterministic local-repro harness that closes Theme 5 ("recurrence is tooling failure"); produce the Day-2 decision document that determines whether Phase 19 runs.
**Depends on**: Phase 15 (csv_uploaded trust-tier placeholder must exist on `strategy_verifications` so the diagnostic probe can exercise the CSV path); `restore-e2e-fixtures` PR merged FIRST (UC-E modified — bit-for-bit pre-PR-#90 restore of `e2e/api-key-flow.spec.ts` (-242 LOC) + `scripts/seed-full-app-demo.ts` (-1721 LOC) + `src/lib/observability.ts` (-28 LOC)); DISCO-05 migration drift resolution complete (Path A/B/C decision in TODOS.md); Day-0.5 Vault-from-Railway pre-flight script (read known KEK row from Supabase Vault and decrypt test ciphertext — if access denied, skip ahead to Phase 18 with "fix Vault access" as first task).
**Entry gate**: All four prep items above complete. Plan-checker rejects Phase 16 Day 1 commit without file presence check on `e2e/api-key-flow.spec.ts` + `scripts/seed-full-app-demo.ts` + `src/lib/observability.ts`. Migration drift convergence documented in `.planning/phase-16/migration-drift-resolution.md`.
**Requirements**: OBSERV-01, OBSERV-02, OBSERV-03, OBSERV-04, OBSERV-05, OBSERV-06, OBSERV-07, OBSERV-08, OBSERV-09, OBSERV-10, OBSERV-11, OBSERV-12
**Success Criteria** (what must be TRUE):
  1. A single `correlation_id` UUID generated by a wizard click is queryable in five-of-five layers — Next.js Sentry events with `correlation_id` tag, Python Sentry events with `correlation_id` tag, Supabase audit log row, Resend webhook payload (tags-first or `(correlation_id, resend_message_id)` mapping fallback per Pitfall 17), `compute_jobs.metadata->>'correlation_id'`
  2. Every wizard error path renders the structured envelope `{ok, code, human_message, debug_context, correlation_id, recoverable}` with copy-diagnostics `<details>` accordion — no "Something went wrong" generic anywhere
  3. Founder runs `scripts/repro-key-flow.sh` against checked-in `vcrpy==8.1.1` cassettes (OKX / Binance / Bybit happy + failure paths) and reproduces Path 1 + Path 2 + sync deterministically with no network access
  4. Admin-gated `/api/debug-key-flow` SSE endpoint runs Path 1 + Path 2 + sync sequentially against test credentials, never persists submitted credentials, audit-logs every invocation, and streams structured diagnostic JSON to caller
  5. Migration 084 / 085 / 086 trigger paths audited under unified-pipeline RLS context (service-role from Railway → `auth.uid()` returns NULL); integration tests assert each `stamp_first_*` RPC fires correctly via `NEW.user_id` not `auth.uid()`; PostHog `wizard_start` mobile-device count documented in TODOS.md (gates DESIGN-04)
**Plans**: 10 plans (Wave 1: 1, 2, 4, 9, 10 parallel; Wave 2: 3, 5, 6 parallel — depends on Wave 1; Wave 3: 7, 8 parallel — depends on Waves 1+2). Note: CONTEXT.md ratified a 2-wave structure but file-modified overlaps on analytics-service/main.py + requirements.txt force a 3-wave execution order — same total parallelism, just sequential between waves.
- [x] 16-01-PLAN.md — OBSERV-12 Vitest fixture-presence regression test (Wave 1) — completed 2026-05-01
- [x] 16-02-PLAN.md — correlation_id seam at analytics-client.ts:66 + structlog 25.5.0 + CorrelationMiddleware (Wave 1) — completed 2026-05-01
- [x] 16-03-PLAN.md — Sentry boundaries: error.tsx + global-error.tsx + sentry-sdk[fastapi]==2.58.0 with PII before_send (Wave 2; depends 16-02) — completed 2026-05-01
- [x] 16-04-PLAN.md — Trigger/RLS audit (migrations 084/085/086) via pytest+psycopg under service-role (Wave 1) — completed 2026-05-01
- [x] 16-05-PLAN.md — Resend tag round-trip + resend_message_correlation mapping table migration 098 + webhook receiver (Wave 2; depends 16-02) — completed 2026-05-01 (Task 5 `supabase db push` applied via Supabase MCP to qmnijlgmdhviwzwfyzlc; RLS contract verified live: anon=0 rows, service_role=full access)
- [x] 16-06-PLAN.md — WizardErrorEnvelope component + envelope builder + 3 wizard step rewires (Wave 2; depends 16-02) — completed 2026-05-01
- [~] 16-07-PLAN.md — /api/debug-key-flow SSE endpoint + FastAPI internal router + audit-union extension (Wave 3; depends 16-02, 16-03, 16-06) — Tasks 1–4 shipped 2026-05-01 (13 vitest + 7 pytest = 20 tests green); Task 5 founder Railway env-staging (DEBUG_KEY_FLOW_* + INTERNAL_API_TOKEN parity + smoke test) pending human action
- [~] 16-08-PLAN.md — vcrpy 8.1.1 cassettes (12 files) + scripts/repro-key-flow.sh + README troubleshooting edit (Wave 3; depends 16-03, 16-05, 16-06) — Tasks 1, 2, 4 shipped 2026-05-01 (vcrpy pin + 3-layer PII filter + 12-case scaffolding + repro harness + README); Task 3 founder cassette recording (12 YAMLs against test broker creds) pending human action
- [x] 16-09-PLAN.md — PostHog wizard_start mobile audit (gates DESIGN-04 in Phase 17) (Wave 1) — completed 2026-05-01
- [x] 16-10-PLAN.md — Day-2 decision document scaffold (template only; founder fills at gate) (Wave 1) — completed 2026-05-01
**Complexity**: MEDIUM-HIGH (six concurrent workstreams: correlation_id seam @ `analytics-client.ts:66` + Sentry framework→boundary wiring + SSE endpoint + VCR cassettes + trigger audit + Resend tag round-trip verification + restore-e2e-fixtures pre-PR + PostHog mobile audit).
**UI hint**: yes
**Exit gate** *(Day-2 decision gate, Day 4)*: Founder reviews `/api/debug-key-flow` output with a 2-hour minimum deliberation floor. Decision document `.planning/phase-16/day-2-decision.md` lands BEFORE any Phase 18/19 code, and MUST contain (a) candidate root causes ranked by evidence weight, (b) regression test snippet for chosen fix, (c) explicit refutation of each Phase 19 task NOT needed if SKIP path chosen, (d) `correlation_id` evidence chain. Falsifiable criteria — SKIP if single `correlation_id` chain points to ONE config or ONE single-LOC bug AND fix has regression test that fails without it AND no other failure mode unexplained; COMMIT if 2+ root causes OR fix touches ≥3 files in divergent paths OR no clean unit test possible; HOLD (24h) if surfaced cause is unfamiliar.

### Phase 17: Design Contract
**Goal**: Lock DESIGN.md additions (trust-tier badges, error envelope wireframe, broker selector grid, CSV escape-hatch card, mobile fallback, a11y minimums, 9-state matrix) BEFORE Phase 19 backend rewrite — prevents implementer-improvised UI from violating identity per Theme 1 (developer-first execution risk).
**Depends on**: Phase 16 (PostHog mobile-start count gates DESIGN-04 conditional mobile fallback; error envelope shape produced by Phase 16 instrumentation is the surface the wireframe describes; `wizardErrors.ts` declared source-of-truth for `human_message` builds on Phase 16 envelope contract).
**Requirements**: DESIGN-01, DESIGN-02, DESIGN-03, DESIGN-04, DESIGN-05
**Success Criteria** (what must be TRUE):
  1. DESIGN.md gains trust-tier badge variants (`api_verified` filled accent #1B6B5A pill / `csv_uploaded` neutral #4A5568 outline pill / `self_reported` warning amber #B45309 outline pill) AND `src/lib/design-tokens/trust-tier.ts` typed constants exist AND `tests/design/trust-tier-tokens.test.ts` regex-asserts DESIGN.md ↔ token file consistency
  2. DESIGN.md gains error envelope render wireframe (title=`human_message` 16px DM Sans semibold #1A1A2E, CTA derived from `recoverable` boolean, collapsed `<details>` with code + correlation_id Geist Mono 12px, copy-diagnostics ghost button with `QUANTALYZE_DIAG` payload format)
  3. DESIGN.md gains broker selector 2×3 card grid (white surface, 1px #E2E8F0 border, 8px radius) with per-source field schema enumerated AND CSV escape-hatch full-width card BELOW grid titled "Don't have an API key? Upload CSV instead"
  4. DESIGN.md gains 9-state matrix per surface (loading / empty / error / partial / success / retry-in-flight / stale / optimistic / offline) with ZERO TBD cells; a11y minimums published (4.5:1 contrast on trust badges, ARIA live regions on state changes, keyboard-nav stepper, focus management); `wizardErrors.ts` declared source-of-truth (envelope's `human_message` = existing `title`; `debug_context` carries existing `fix[]` array)
  5. Mobile-readable wizard fallback specification lands IF Phase 16 OBSERV-11 mobile-start count > 0; if count = 0, ship 640px gate as today
**Plans**: 6 plans (Wave 1: 17-01, 17-02, 17-03, 17-04 parallel; Wave 2: 17-05, 17-06 parallel — depend on Wave 1 token file + ErrorEnvelope component + DESIGN.md additions)
- [x] 17-01-PLAN.md — Trust-tier design tokens (src/lib/design-tokens/trust-tier.ts) + DESIGN.md ↔ tokens consistency Vitest test (DESIGN-01 code-side)
- [x] 17-02-PLAN.md — DESIGN.md additions (5 sub-sections + 5 Decisions Log rows) + REQUIREMENTS.md DESIGN-01 hex correction #D97706 → #B45309 (DESIGN-01..05 doc-side)
- [x] 17-03-PLAN.md — wizardErrors.ts CSV absorption (17 new error codes + 3 heading-const exports + CSV_RULE_LABELS + 2 helper fns) + 4 CSV step file refactors; zero hoist markers remain (DESIGN-05 source-of-truth)
- [x] 17-04-PLAN.md — ErrorEnvelope rebrand to src/components/error/ErrorEnvelope.tsx + 1-line shim at old wizard path + newline-delimited QUANTALYZE_DIAG copy-diagnostics + pii-scrub pass + always-collapsed details + Retry-above-details + aria-labels (DESIGN-02)
- [x] 17-05-PLAN.md — TrustTierLabel internals upgrade to outline pill from TRUST_TIER_TOKENS; call signature unchanged (DESIGN-01 component-side)
- [x] 17-06-PLAN.md — Vitest wizard-contrast test (16 fg/bg pairs + 3 border slots) + axe-core CI extension (e2e/wizard-axe.spec.ts + e2e/admin-csv-status-axe.spec.ts) using shared buildAxe factory (DESIGN-05 a11y test scaffolding)
**Complexity**: MEDIUM (design contract is the gated exit before Phase 19; trust-tier tokens land as code regex-asserted against DESIGN.md; per-source field schemas for OKX / Binance / Bybit / CSV).
**UI hint**: yes
**Exit gate** *(hard gate before Phase 19)*: `gsd-sdk validate phase-17-exit` greps `.planning/phase-17/*` and DESIGN.md additions for `TBD | TODO | TKTK` and FAILS if any remain in 9-state matrix, trust-tier table, broker selector spec, or error envelope wireframe. Plan-checker rejects Phase 19 entry without DESIGN.md grep showing zero TBDs.

### Phase 18: Root-Cause Fix + Founder LP Skeleton
**Goal**: Fix the actual bug Phase 16 surfaced with a regression test that fails without the fix; ship the Python `redact.py` mirror of the existing `pii-scrub.ts` (NOT a parallel `src/lib/redact.ts`); ship the founder LP report cron reusing the existing factsheet PDF endpoint to establish the dogfood loop that prevented the prior 5-patch recurrence pattern from sticking.
**Depends on**: Phase 16 root cause surfaced (Phase 18 cannot start until Day-2 decision document lands — fix scope is unknown until then); Phase 17 design contract complete (Phase 18 wires `pii-scrub.ts` at TypeScript error-handler boundaries that must use the locked envelope shape).
**Entry gate**: Theme 4 ≥1 verbal-in-writing Metaworld commitment (text logged in `.planning/phase-18/metaworld-commitment.md`) before Phase 18 starts. Without commitment, log gap and reduce Phase 19 scope to "internal infrastructure only" (no marketplace credibility claim). **SATISFIED 2026-05-06.**
**Requirements**: FIX-01, FIX-02, FIX-03, FIX-04, LP-01, LP-02, LP-03
**Success Criteria** (what must be TRUE):
  1. Founder's own OKX test key passes the wizard end-to-end in production-equivalent environment — `strategies` row at `status='active'`, `encrypted_key` decrypts cleanly via Vault to the exact original tuple, regression test for the surfaced root cause fails without the fix
  2. All 10 onboarding teams' keys flow through end-to-end: `strategy_verifications.status='published'` for OKX/Binance/Bybit teams via API path; `status='validated'` (or higher) for MT5/IBKR teams via CSV path from Phase 15; per-team status tracked in TODOS.md
  3. PII redaction utility — `analytics-service/services/redact.py` mirrors existing `pii-scrub.ts` denylist (8 keys: `apikey | apisecret | secret | signature | passphrase | authorization | x-mbx-apikey | ok-access-sign`) with case-insensitive regex, recursive walker, JWT-shape detector, account-id truncator; shared 20-bad / 5-good fixture corpus across TS + Python; grep over Supabase log table after a test run shows zero PII
  4. Founder LP report cron emits monthly PDF via existing `/api/factsheet/[id]/pdf` endpoint reused as-is (no branded design dependency); Sentry capture with cron-failure tag + correlation_id surfaces alert on failure; silent failure prohibited
  5. Phase 18 exit interview captures founder verbal-in-writing commitment to send the unedited cron PDF to a real LP within 14 days of milestone close (text logged in `.planning/phase-18/dogfood-commitment.md`)
**Plans**: 4 plans (Wave 1: 18-01 — traceability + smoke template + 10-team tracker, no code; Wave 2: 18-02 + 18-03 parallel — redact.py + LP cron, independent code paths; Wave 3: 18-04 — doc updates depending on Wave 2 outcomes)
- [ ] 18-01-PLAN.md — Phase 18 traceability (PR #116 + Bug #1 + Bybit quirks record-only) + founder OKX smoke evidence template + 10-team onboarding tracker (FIX-01 + FIX-02 + FIX-03)
- [ ] 18-02-PLAN.md — `analytics-service/services/redact.py` Python mirror of `pii-scrub.ts` + 3 wire-up boundaries (Sentry before_send, structlog processor, audit-log writer) + shared 20-bad / 5-good fixture corpus + Vitest TS↔Python denylist parity test (FIX-04)
- [ ] 18-03-PLAN.md — Founder LP cron at `/api/cron/founder-lp-report` (`0 9 1 * *`) reusing existing factsheet PDF endpoint + Resend send with PDF attachment + dual-alert (Sentry + Resend) failure path per Pitfall 7 + vercel.json registration + .env.example documentation (LP-01 + LP-02)
- [ ] 18-04-PLAN.md — Dogfood-commitment.md stub (LP-03; founder fills at /ship time) + REQUIREMENTS/ROADMAP/STATE doc-sync pushing BACKBONE-06/-07 from Phase 18 to Phase 19 + Day-2 doc Section 5 REVISED header (LP-03 + cross-cutting docs)
**Complexity**: MEDIUM (root-cause fix already shipped in-flight via PR #116 + commits a48a92e/1960f54; scope is now traceability + redact.py mirror + LP cron + doc-sync; BACKBONE-06/-07 push to Phase 19 per CONTEXT.md L22-23).
**Exit gate**: All 10 teams reach `published` (API teams) or `validated` (CSV teams). Founder LP commitment text in writing. PII grep over Supabase log table returns zero credential-shaped strings.

### Phase 19: Unified Backbone *(conditional on Day-2 gate = COMMIT)*
**Goal**: Replace 5 divergent entry routes with one observable, idempotent, flag-gated `POST /process-key` FastAPI RPC backed by an `IngestionAdapter` Protocol; migrate `verification_requests` → `strategy_verifications` via 4-PR VIEW-shim sequence; ship feature flag + cron-based rollback monitor; fix open-perp correctness + TWR ≠ YTD at the equity-curve layer; ship JSONB fingerprint placeholder + `compute_similarity()` SQL function (pgvector deferred to v2 per UC-C).
**Depends on**: Phase 18 (verified-working foundation — must build on a fix that holds, not on a new theory); Day-2 decision gate = COMMIT (`.planning/phase-16/day-2-decision.md` references specific `correlation_id` chain and explicit refutation of SKIP path); Phase 17 hard exit gate (zero TBDs in DESIGN.md 9-state matrix); Theme 4 ≥1 Metaworld verbal-in-writing commitment from Phase 18 entry; route inventory + migration plan documents from entry gate below.
**Entry gate**:
  - `.planning/phase-19/route-inventory.md` greps every Next.js route exporting non-GET handlers touching `api_keys | strategies | strategy_analytics | verification_requests | strategy_verifications | compute_jobs`. Every row maps to a `flow_type` in `KeySubmissionRequest` OR carries explicit "out of scope, rationale: …" (Pitfall 1 — 4th orphan path mitigation).
  - `.planning/phase-19/migration-plan.md` reserves migration numbers 093-097 upfront (093 strategy_verifications + status enum; 094 VIEW shim with `INSTEAD OF` triggers; 095 wait period; 096 fingerprint JSONB + `compute_similarity()`; 097 wizard_session_id idempotency UNIQUE INDEX + `process_key_long` registry insert). Plan-checker rejects Phase 19 entry without both documents.
**Requirements**: BACKBONE-01, BACKBONE-02, BACKBONE-03, BACKBONE-04, BACKBONE-05, BACKBONE-06, BACKBONE-07, BACKBONE-08, BACKBONE-09, BACKBONE-10, FINGERPRINT-01, FINGERPRINT-02
**Success Criteria** (what must be TRUE):
  1. `POST /process-key` accepts `KeySubmissionRequest{flow_type ∈ {teaser, onboard, internal_report, csv, resync}, source ∈ {okx, binance, bybit, csv}, context: dict}`; returns `VerificationResult` with `metrics_snapshot`, `fingerprint`, `encrypted_credentials`, `status`, `trust_tier`, `errors[]`; all 5 entry routes (`verify-strategy`, `keys/validate-and-encrypt`, `strategies/finalize-wizard`, `keys/sync` as `flow_type='resync'`, `factsheet/[id]/pdf`) become thin Next.js adapters delegating to `/process-key`
  2. CSV upload produces same downstream artifacts as API path — same `metrics_snapshot` shape, same `fingerprint` shape; differs only in `trust_tier` (`csv_uploaded` vs `api_verified`); `IngestionAdapter` Protocol with explicit per-method error envelope contract, separate flow paths for CSV (file-format validation) vs API (broker-credential validation)
  3. Open perpetual positions valued at mark-price with funding-rate accumulation via `reconstruct_positions()` wiring existing `position_reconstruction.py` + `positions.py` + funding-fees primitives; TWR ≠ YTD when strategy has multi-period history (golden-file fixture asserts known-position equity matches manual computation); Sharpe matches an independently-computed quantstats reference within ±0.05 per source
  4. VIEW-shim migration sequence ships as exactly 4 sequential PRs (plan-checker rejects exit if any single PR combines adjacent steps): (a) repoint `verify-strategy/route.ts:115` UPDATE to `strategy_verifications` BEFORE rename, (b) flip `process_key_unified_backbone` flag, (c) verify zero writes to old table over ≥24h via logs + 7 calendar days at 100% rollout, (d) rename old to `verification_requests_legacy` + `CREATE VIEW verification_requests AS SELECT ... FROM strategy_verifications` with `INSTEAD OF` triggers (read-only enforcement); legacy retained read-only 90 days
  5. `wizard_session_id` UNIQUE INDEX prevents wizard-double-submit duplicates; long-fetch flows dispatch via existing PR #53 worker dyno on Railway (`compute_jobs.kind='process_key_long'`, `priority='normal'`) avoiding Vercel 300s timeout; `/api/cron/flag-monitor` cron polls Sentry events API + Vercel REST API every 15 min and flips feature flag if error-envelope rate > 0.5% in 15-min window; drain semantics — `compute_jobs.metadata->'unified_backbone_at_claim'` locked at job-claim time so flag flip mid-execution doesn't split-brain in-flight jobs
  6. `strategies.fingerprint JSONB` column added (versioned shape with per-component arrays preserving identity for future weighting); partial index `WHERE fingerprint IS NOT NULL`; `compute_similarity(a JSONB, b JSONB) RETURNS NUMERIC` SQL function (`IMMUTABLE PARALLEL SAFE`, plain plpgsql cosine, returns 0.0 on shape mismatch never errors); pgvector explicitly deferred to v2 per UC-C
  7. Open-perp position valuation correctness (BACKBONE-06) + TWR ≠ YTD reconciliation at the equity-curve layer (BACKBONE-07) ship as part of Phase 19 — pushed from Phase 18 (per `.planning/phases/18-root-cause-fix-founder-lp-skeleton/18-CONTEXT.md` L22-23) because they pair naturally with `IngestionAdapter.reconstruct_positions` and the equity-curve unification.
**Plans**: TBD
**Complexity**: HIGH (full unified backbone; +1-2 days for perp correctness per E-9; conditional execution; 4-PR VIEW-shim sequence enforced; idempotency + drain semantics + flag-monitor cron; 10 BACKBONE REQs + 2 FINGERPRINT REQs are 6 distinct architectural workstreams).
**UI hint**: yes
**Exit gate**: 7-day stability window at 100% feature flag rollout with zero error-envelope regressions; manual rollback via `vercel env rm` validated; Phase 19 customer-feedback document `.planning/phase-19/customer-feedback.md` captures verbatim feedback from 1-2 of the 10 teams running a real key submission via the unified flow.

#### Conditional Execution Logic

```
                Phase 16 ── Day-2 decision gate (Day 4) ──┐
                                                         │
                ├── SKIP ─────────────────────────────────┘
                │   (1-line config fix; Phase 18 fix-only;
                │    milestone closes after Phase 18 at ~10 CC days;
                │    Phase 19 entry gate rejects without explicit COMMIT)
                │
                └── COMMIT ───────────────────────────────┐
                    (root cause requires architectural    │
                     change; ≥3 files; or no clean unit   │
                     test possible)                       │
                                                         │
                Phase 17 (Design Contract — runs always) │
                                                         │
                Phase 18 (Root-cause fix — runs always)  │
                                                         │
                Phase 19 (Unified Backbone — runs only ──┘
                          if COMMIT path chosen above)
```

**HOLD path (24h re-evaluation)**: invoked if surfaced root cause is unfamiliar OR founder cannot construct a regression test OR founder is fatigued. Phase 17 + Phase 18 design + redaction work continues during HOLD; Phase 19 entry deferred until HOLD lifts to COMMIT or SKIP.

#### Cross-Phase Risk Themes (must not regress during execution)

| Theme | Risk | Phase Mitigation |
|-------|------|------------------|
| Theme 1 | Plan is developer-first, not user-first | Phase 17 hard exit gate; trust-tier tokens as typed code constants regex-asserted against DESIGN.md |
| Theme 2 | Scope expansion under-sized (MT5/IBKR + perps + pgvector in 17 days) | UC-B drops MT5/IBKR; UC-C drops pgvector; honest 17-22 day estimate; Phase 19 conditional |
| Theme 3 | Fingerprint moat unvalidated + statistically meaningless at N=10 | UC-C JSONB placeholder + `compute_similarity()` SQL function in v1; pgvector deferred until N≥1000 |
| Theme 4 | AI voices ratifying AI voices — no real customer asked which onboarding path they'd use | Phase 15 entry blocker (≥3 written team replies); Phase 18 entry gate (≥1 Metaworld verbal-in-writing); Phase 19 exit interview with 1-2 teams |
| Theme 5 | Recurrence pattern is a tooling failure (5 patches in 19 days = no deterministic local-repro) | Phase 16 ships `vcrpy==8.1.1` cassettes + `scripts/repro-key-flow.sh`; runs daily during Phase 19 stability window |
| Theme 6 | Migration drift + 4th orphan path | Phase 16 prerequisite drift resolution; Phase 19 route-inventory + migration-plan entry gates |

#### Reuse-Not-Recreate Flags (research consensus — must NOT show up as new files in plan tasks)

- `src/lib/redact.ts` — DO NOT CREATE; `src/lib/admin/pii-scrub.ts` already exists with tested denylist + JWT detector + recursive walker. FIX-04 ships ONLY the Python `redact.py` mirror.
- `src/instrumentation.ts` Sentry framework hook — already wired; OBSERV-04 narrows to `error.tsx` + `global-error.tsx` only.
- correlation_id seam = `src/lib/analytics-client.ts:66`, NOT `src/proxy.ts` (proxy is auth-only with zero outbound fetches per autoplan E-1 correction).
- `src/lib/wizardErrors.ts` is the 360-LOC source-of-truth for `human_message`; envelope's `human_message` = existing `title`; `debug_context` carries existing `fix[]` array. DESIGN-05 declares this contract.
- `analytics-service/services/exchange.py` (629 LOC) is UNCHANGED; adapters wrap, don't rewrite.
- `equity_reconstruction.py` + `position_reconstruction.py` + `funding_fetch.py` perp primitives already 70% built; BACKBONE-09 wires them through `reconstruct_positions()`.

## Progress

**Execution Order:**
Phases execute in numeric order: 15 → 16 → [Day-2 gate] → 17 → 18 → 19 (conditional). Old phase numbering 12 / 13 / 14a / 14b already archived to `.planning/milestones/v0.17.0.0-phases/`.

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
| 15. CSV Unblock | v1.0.0 | 0/6 | Not started | - |
| 16. Diagnostic Spike + Observability | v1.0.0 | 9/10 | Complete    | 2026-05-01 |
| 17. Design Contract | v1.0.0 | 6/6 | Complete    | 2026-05-01 |
| 18. Root-Cause Fix + Founder LP Skeleton | v1.0.0 | 0/4 | Not started | - |
| 19. Unified Backbone (conditional) | v1.0.0 | 0/TBD | Not started | - |
