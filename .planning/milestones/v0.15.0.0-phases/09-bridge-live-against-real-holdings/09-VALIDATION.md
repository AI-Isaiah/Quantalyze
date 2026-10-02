---
phase: 09
slug: bridge-live-against-real-holdings
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-21
revised: 2026-04-21
revision_note: Updated per VOICES-ACCEPTED findings — new tasks added for finding f2 (POST endpoint), finding f4 (widened UNIQUE collision), finding f5 (holding_flags tests + FLAG_COMPOSITE_THRESHOLD parity), finding f6 (charset validation), finding g3 (NOTICE-grep), finding g4 (HoldingFactsheet render)
---

# Phase 09 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from
> `09-RESEARCH.md §Validation Architecture` + VOICES-ACCEPTED findings. Every LIVE-xx
> requirement is mapped to one or more concrete test files; Wave 0 gaps are itemized
> below. New rows post-revision are flagged with a "[rev]" marker.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 (client/RLS) + pytest (backend analytics-service) |
| **Config file** | `vitest.config.ts` + `analytics-service/pytest.ini` |
| **Quick run command** | `npx vitest run <path>` or `pytest analytics-service/tests/<file>::<test> -x` |
| **Full suite command** | `npm test && cd analytics-service && pytest` |
| **Estimated runtime** | ~90 seconds full suite (current baseline); +~30s projected with Phase 09 additions (revised: +10s for new findings-driven tests) |

---

## Sampling Rate

- **After every task commit:** Run the scoped `npx vitest run <touched-path>` or `pytest analytics-service/tests/<touched-file> -x` for that task.
- **After every plan wave:** Run `npm test && cd analytics-service && pytest` — both suites green before moving to the next wave.
- **Before `/gsd-verify-work`:** Full suite green + `supabase db push 2>&1 | tee /tmp/supabase-push-09-01.log` applies migrations 072 + 073 against the live DB with all DO-block NOTICES greppable via `grep -q 'phase09:...' /tmp/supabase-push-09-01.log` (finding g3).
- **Max feedback latency:** scoped runs ≤ 20s; full suite ≤ 120s.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 09-01-01 | 01 | 1 | LIVE-04 | ASVS V4 (RLS) + T-09-01 + T-09-01.b | XOR CHECK forbids both/neither; widened bridge_outcomes UNIQUE collision regression (finding f4); RLS on `original_holding_ref` matches `original_strategy_id` | Vitest live-DB | `npx vitest run src/__tests__/match-decisions-xor-rls.test.ts` | ❌ W0 | ⬜ pending |
| 09-01-02 | 01 | 1 | LIVE-05 | T-09-01-f3 | holding-branch cron populates `delta_30d` from `allocator_equity_snapshots.breakdown` | Vitest live-DB | `npx vitest run src/__tests__/bridge-outcome-cron-holding.test.ts` | ❌ W0 | ⬜ pending |
| 09-01-03 | 01 | 1 | LIVE-05 | T-09-01-f3 | strategy-branch cron still populates deltas (regression — post-finding-f3 LEFT JOIN retains legacy rows) | Vitest live-DB | `npx vitest run src/__tests__/bridge-outcome-cron.test.ts` | ✅ extend | ⬜ pending |
| 09-01-04 [rev] | 01 | 1 | LIVE-05 | T-09-01-f3 | legacy `bridge_outcomes` row with `match_decision_id=NULL, kind='allocated'` still processed by LEFT-JOIN strategy branch (finding f3 fixture) | Vitest live-DB | `npx vitest run src/__tests__/bridge-outcome-cron-holding.test.ts -t legacy` | ❌ W0 (subset of 09-01-02 file) | ⬜ pending |
| 09-01-05 [rev] | 01 | 1 | LIVE-04 | T-09-01.b | widened bridge_outcomes UNIQUE (finding f4) — two holdings same strategy BOTH succeed; same triple-key collision 23505; strategy-only pair preservation | Vitest live-DB | `npx vitest run src/__tests__/match-decisions-xor-rls.test.ts -t widened` | ❌ W0 (subset of 09-01-01 file) | ⬜ pending |
| 09-01-06 [rev] | 01 | 1 | — | T-09-01 (finding g3) | `supabase db push` stdout captured to `/tmp/supabase-push-09-01.log`; four `phase09:...` NOTICES greppable | shell | `grep -q 'phase09: match_decisions.original_holding_ref XOR CHECK deployed ✓' /tmp/supabase-push-09-01.log && grep -q 'phase09: compute_bridge_outcome_deltas holding branch deployed ✓' /tmp/supabase-push-09-01.log && grep -q 'phase09: bridge_outcomes UNIQUE index widened for holding-ref siblings ✓' /tmp/supabase-push-09-01.log && grep -q 'phase09: match_batches.holding_flags JSONB column deployed ✓' /tmp/supabase-push-09-01.log` | ❌ W0 | ⬜ pending |
| 09-02-01 | 02 | 2 | LIVE-01 | T-09-02 | holdings-only allocator passes through `_load_allocator_context()` + `score_candidates()` without error (finding f1: plain `def`, no await) | pytest | `pytest analytics-service/tests/test_match_integration_phase09.py::test_load_allocator_context_holdings_only` | ❌ W0 | ⬜ pending |
| 09-02-02 | 02 | 2 | LIVE-01 | — | mixed portfolio (strategies + holdings) weights sum to 1.0 (finding f1: plain `def`) | pytest | `pytest analytics-service/tests/test_match_integration_phase09.py::test_mixed_portfolio_weights_sum_to_one` | ❌ W0 | ⬜ pending |
| 09-02-03 | 02 | 2 | LIVE-01 | — | per-symbol returns reconstruction math golden (known breakdown → known returns series) | pytest | `pytest analytics-service/tests/test_equity_reconstruction_phase09.py` | ❌ W0 | ⬜ pending |
| 09-02-04 | 02 | 2 | LIVE-01 | — | `ENGINE_VERSION == 'v2.1.0'` after bump | pytest | `pytest analytics-service/tests/test_match_engine.py::test_engine_version_phase09_bump` | ✅ extend | ⬜ pending |
| 09-02-05 | 02 | 2 | LIVE-01 | — | warm-up gate: holding with < 30d per-symbol history excluded from flags (not compared, not flagged) | pytest | `pytest analytics-service/tests/test_match_integration_phase09.py::test_warmup_gate_under_30d` | ❌ W0 | ⬜ pending |
| 09-02-06 [rev] | 02 | 2 | LIVE-01 | — | `FLAG_COMPOSITE_THRESHOLD == 50` (engine-side half of finding f5 parity — SSR-side test at 09-03-05) | pytest | `pytest analytics-service/tests/test_match_integration_phase09.py::test_flag_composite_threshold_equals_50` | ❌ W0 | ⬜ pending |
| 09-02-07 [rev] | 02 | 2 | LIVE-01 + LIVE-02 | — | finding f5: `compute_holding_flags` max_weight breach detection | pytest | `pytest analytics-service/tests/test_holding_flags_phase09.py::test_holding_flags_max_weight` | ❌ W0 | ⬜ pending |
| 09-02-08 [rev] | 02 | 2 | LIVE-01 + LIVE-02 | — | finding f5: `compute_holding_flags` correlation_ceiling breach detection via `_compute_corr_with_portfolio` | pytest | `pytest analytics-service/tests/test_holding_flags_phase09.py::test_holding_flags_correlation_ceiling` | ❌ W0 | ⬜ pending |
| 09-02-09 [rev] | 02 | 2 | LIVE-02 | — | finding f5: candidate-exists gate (D-04 + D-06) — breach + no-candidate-above-50 → flagged=False | pytest | `pytest analytics-service/tests/test_holding_flags_phase09.py::test_holding_flags_candidate_exists_gate` | ❌ W0 | ⬜ pending |
| 09-02-10 [rev] | 02 | 2 | LIVE-01 | — | finding f5: warmup-gate defense-in-depth — holding absent from portfolio_returns not emitted in flags | pytest | `pytest analytics-service/tests/test_holding_flags_phase09.py::test_holding_flags_warmup_gate` | ❌ W0 | ⬜ pending |
| 09-02-11 [rev] | 02 | 2 | LIVE-01 | T-09-02-HOLDING-FLAGS | `_score_one_allocator` writes `holding_flags` list into `match_batches.holding_flags` JSONB (finding f5 persistence) | pytest + grep | `grep -c '"holding_flags"' analytics-service/routers/match.py` returns ≥1 | ❌ W0 (source-code assertion) | ⬜ pending |
| 09-03-01 | 03 | 2 | LIVE-02 | — | InsightStrip renders "Bridge flagged N holding(s) — Review in Scenario →" when `flagged_count > 0`; hidden when 0 | Vitest RTL | `npx vitest run src/components/portfolio/InsightStrip.test.tsx` | ✅ extend | ⬜ pending |
| 09-03-02 | 03 | 2 | LIVE-02 | — | link routes to `/allocations?tab=scenario` | Vitest RTL | same file as 09-03-01 | ✅ extend | ⬜ pending |
| 09-03-03 | 03 | 2 | LIVE-04 | ASVS V5 | `holding-outcome-adapter.ts` maps (flaggedHolding, topCandidate, matchDecision) → correct Bridge V2 props; eligible_for_outcome computed from `original_holding_ref` | Vitest unit | `npx vitest run src/app/(dashboard)/allocations/lib/holding-outcome-adapter.test.ts` | ❌ W0 | ⬜ pending |
| 09-03-04 | 03 | 2 | LIVE-04 | — | ScenarioFlaggedHoldingsList inline form click path: banner → form appears → submit → OutcomeRecordedRow replaces | Vitest RTL | `npx vitest run src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.test.tsx` | ❌ W0 | ⬜ pending |
| 09-03-05 [rev] | 03 | 2 | LIVE-02 | — | SSR-side `FLAG_COMPOSITE_THRESHOLD === 50` AND numeric parity with Python-side constant (finding f5 — reads `analytics-service/routers/match.py` at test time) | Vitest unit | `npx vitest run src/app/(dashboard)/allocations/lib/holding-outcome-adapter.test.ts -t parity` | ❌ W0 (subset of 09-03-03 file) | ⬜ pending |
| 09-03-06 [rev] | 03 | 2 | LIVE-04 | T-09-03.b | finding f2 click-path: no decision yet → click "Allocated" POSTs to `/api/match/decisions/holding` BEFORE AllocatedForm mounts; on 2xx form mounts; on 4xx toast | Vitest RTL | `npx vitest run src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.test.tsx -t "finding f2"` | ❌ W0 (subset of 09-03-04 file) | ⬜ pending |
| 09-03-07 [rev] | 03 | 2 | LIVE-04 | T-09-03.b | finding f2: /api/match/decisions/holding POST — zod 400, ownership 403, strategy 404, happy path 201 + match.decision_record audit | Vitest unit | `npx vitest run src/app/api/match/decisions/holding/route.test.ts` | ❌ W0 | ⬜ pending |
| 09-03-08 [rev] | 03 | 2 | LIVE-04 | T-09-03.b | finding f2: live-DB — Allocator B cannot POST with Allocator A's holding_ref → 403 Unauthorized; no match_decisions row created | Vitest live-DB | `npx vitest run src/__tests__/match-decisions-holding-endpoint-rls.test.ts` | ❌ W0 | ⬜ pending |
| 09-03-09 [rev] | 03 | 2 | LIVE-02 | — | finding f5: `getMyAllocationDashboard` reads from `match_batches.holding_flags` JSONB (NOT derives from match_candidates — grep proof) | grep | `grep -c "holding_flags" src/lib/queries.ts` ≥ 2 AND `grep -c "match_candidates.*score\\|gte.*score.*50" src/lib/queries.ts` == 0 | ❌ W0 (source-code assertion) | ⬜ pending |
| 09-04-01 | 04 | 3 | LIVE-03 | — | `/compare?ids=holding:{venue}:{symbol}:{type},<strategy-uuid>` renders both sides | Vitest RTL | `npx vitest run src/app/\(dashboard\)/compare/page.test.tsx` | ❌ W0 | ⬜ pending |
| 09-04-02 | 04 | 3 | LIVE-03 | ASVS V4 + T-09-04 | unauthorized holding (different allocator) returns 403 / "not available" — no existence leak | Vitest live-DB RLS | `npx vitest run src/__tests__/compare-holding-rls.test.ts` | ❌ W0 | ⬜ pending |
| 09-04-03 | 04 | 3 | LIVE-03 | — | strategy-only comparison path unchanged (regression) | Vitest RTL | same file as 09-04-01 | ❌ W0 | ⬜ pending |
| 09-04-04 [rev] | 04 | 3 | LIVE-03 | T-09-04-INJ | finding f6: `parseHoldingCompareId` rejects any holding_ref whose venue/symbol/holding_type contains chars outside `/^[A-Za-z0-9_-]+$/` (5 rejection cases: `/`, `;`, space, quote, empty parts) | Vitest unit | `npx vitest run src/app/\(dashboard\)/compare/lib/holding-compare-adapter.test.ts -t charset` | ❌ W0 | ⬜ pending |
| 09-04-05 [rev] | 04 | 3 | LIVE-03 | — | finding g4: HoldingFactsheet.tsx renders "Holding" badge + ticker + venue + holding_type + 4 metrics + em-dash for nulls + `data-testid="holding-factsheet"` | Vitest RTL | `npx vitest run src/components/strategy/HoldingFactsheet.test.tsx` | ❌ W0 | ⬜ pending |
| 09-04-06 [rev] | 04 | 3 | LIVE-03 | — | finding g4: `/compare?ids=holding:*,<uuid>` side-by-side — HoldingFactsheet + StrategyFactsheet both present (and strategy-only path renders zero HoldingFactsheets) | Vitest RTL | `npx vitest run src/app/\(dashboard\)/compare/page.test.tsx -t "finding g4"` | ❌ W0 (subset of 09-04-01 file) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*[rev] = added post-revision per VOICES-ACCEPTED findings*

---

## Wave 0 Requirements

### Original (pre-revision)
- [ ] `src/__tests__/match-decisions-xor-rls.test.ts` — XOR CHECK both/neither + RLS policy surface for `original_holding_ref` (LIVE-04)
- [ ] `src/__tests__/bridge-outcome-cron-holding.test.ts` — holding-branch cron regression (LIVE-05)
- [ ] `analytics-service/tests/test_match_integration_phase09.py` — holdings-only + mixed portfolio + warm-up gate (LIVE-01) — plain `def` per finding f1
- [ ] `analytics-service/tests/test_equity_reconstruction_phase09.py` — per-symbol returns reconstruction golden fixture (LIVE-01)
- [ ] `src/app/(dashboard)/allocations/lib/holding-outcome-adapter.test.ts` — adapter prop unit + FLAG_COMPOSITE_THRESHOLD parity (LIVE-04 + finding f5)
- [ ] `src/app/(dashboard)/allocations/ScenarioFlaggedHoldingsList.test.tsx` — end-to-end click path (LIVE-04)
- [ ] `src/app/(dashboard)/compare/lib/holding-compare-adapter.test.ts` — parser unit incl. finding-f6 charset rejection (LIVE-03)
- [ ] `src/app/(dashboard)/compare/page.test.tsx` — holding-side parser + render branch (LIVE-03) + finding-g4 side-by-side render
- [ ] `src/__tests__/compare-holding-rls.test.ts` — /compare access gate across allocators (LIVE-03)
- [ ] Extend `src/components/portfolio/InsightStrip.test.tsx` — flagged-count line visibility + route (LIVE-02)
- [ ] Extend `analytics-service/tests/test_match_engine.py` — `ENGINE_VERSION == 'v2.1.0'` assertion (LIVE-01)

### Added post-revision per VOICES-ACCEPTED
- [ ] `analytics-service/tests/test_holding_flags_phase09.py` — finding f5 four-case coverage: max_weight, correlation_ceiling, candidate_exists_gate, warmup_gate (LIVE-01 + LIVE-02)
- [ ] `src/app/(dashboard)/allocations/lib/flag-threshold.ts` — SSR constant `FLAG_COMPOSITE_THRESHOLD = 50` (finding f5 — imported + parity-tested in holding-outcome-adapter.test.ts)
- [ ] `src/app/api/match/decisions/holding/route.ts` + `route.test.ts` — finding f2 endpoint (withAuth + zod + ownership + match.decision_record audit) (LIVE-04 + T-09-03.b)
- [ ] `src/__tests__/match-decisions-holding-endpoint-rls.test.ts` — finding f2 live-DB cross-allocator 403 + owner 201 (LIVE-04 + T-09-03.b)
- [ ] `src/components/strategy/HoldingFactsheet.tsx` + `HoldingFactsheet.test.tsx` — finding g4 first-class render branch
- [ ] `src/components/strategy/CompareTable.tsx` — extended to branch `item.kind === 'holding'` per finding g4
- [ ] `/tmp/supabase-push-09-01.log` capture + 4 greppable NOTICE strings (finding g3)
- [ ] Migration 072 widened bridge_outcomes UNIQUE via denormalized column + trigger (finding f4) — collision regression tests added to `src/__tests__/match-decisions-xor-rls.test.ts` (file already in Wave 0)
- [ ] Migration 073 LEFT-JOIN strategy branch + legacy-null fixture (finding f3) — new fixture added to `src/__tests__/bridge-outcome-cron-holding.test.ts` (file already in Wave 0)

**Framework install:** None — Vitest 4.1.2 + pytest already in place.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Institutional copy review on InsightStrip line ("Bridge flagged N holding(s) — Review in Scenario →") | LIVE-02 | Subjective tone per DESIGN.md / PROJECT.md guardrails | Eyeball the rendered line on the Performance tab with real fixture data; confirm DM Sans sizing, 1px border integration, no promotional language |
| Scenario tab inline Bridge V2 form visual coherence with existing Phase 05 OutcomeRecordedRow | LIVE-04 | Requires live-DB demo allocator + rendered comparison against /allocations?tab=scenario | Run `npm run dev`, log in as demo allocator (Keychain creds), trigger a holding flag, expand inline form, submit — verify OutcomeRecordedRow replaces row-level CTA matching Phase 05 look |
| `/compare?ids=holding:*,strategy-uuid` typography + layout parity with strategy-vs-strategy comparison | LIVE-03 | Visual/aesthetic — automated test covers render correctness, not polish | Browser-test both variants side-by-side; confirm HoldingFactsheet "Holding" header badge integrates with existing factsheet card styling (finding g4) |
| Scenario-tab click-path toast on 4xx from /api/match/decisions/holding | LIVE-04 / finding f2 | Toast UX + error-copy tone | Log in as demo allocator, trigger flagged-holding row expand, intentionally send malformed POST (e.g. via devtools), verify institutional-tone error copy |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (listed above, post-revision count: 19 new/extended files)
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s (full), < 20s (scoped)
- [ ] Post-revision findings coverage: f1 (sync def), f2 (POST endpoint + T-09-03.b live-DB), f3 (LEFT JOIN legacy-null fixture), f4 (widened UNIQUE collision), f5 (holding_flags 4 tests + FLAG_COMPOSITE_THRESHOLD parity), f6 (charset validation), g2 (depends_on), g3 (NOTICE grep), g4 (HoldingFactsheet render)
- [ ] `nyquist_compliant: true` set in frontmatter after planner confirms every task points at a row in the Per-Task Verification Map

**Approval:** pending
</content>
</invoke>
</invoke>