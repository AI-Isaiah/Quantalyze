---
phase: 5
slug: outcomes-dashboard
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-04-19
revised: 2026-04-19 (Outside Voices integration — Voice-C2/C3/D1/D2/D3/D4/D5/D6/D8/D9/D10/D11/D12)
verified: 2026-04-19
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Hydrated from `05-RESEARCH.md §Validation Architecture` + `VOICES-ACCEPTED.md` (11 accepted findings).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.1.2 + React Testing Library 16.3.2 + jsdom (TypeScript) + pytest 8+ (Python parity — Voice-D2) |
| **Config file** | `vitest.config.ts` (repo root) |
| **Quick run command** | `npx vitest run src/app/\(dashboard\)/allocations/widgets/outcomes/outcomes.test.tsx src/lib/outcomes-kpi.test.ts src/lib/bridge-outcome-label.test.ts src/lib/queries.my-allocation.test.ts src/app/api/bridge/outcome/\[id\]/curves/route.test.ts` |
| **Full suite command** | `npm test` |
| **Python parity (Voice-D2, optional)** | `cd analytics-service && HAS_PY_ENV=1 python -m pytest tests/test_outcomes_kpi_parity.py -v` |
| **Live-DB tests (Voice-D3 + D11, optional)** | `HAS_LIVE_DB=1 SUPABASE_SERVICE_ROLE_KEY=... npx vitest run src/__tests__/match-decisions-schema.test.ts src/__tests__/outcomes-join-rls.test.ts` |
| **Estimated runtime** | ~12 s full suite; quick run < 5 s; Python parity < 3 s; live-DB tests 5-15 s depending on network |
| **Typecheck + lint gates** | `npm run typecheck && npm run lint` both exit 0 |
| **Coverage gate** | No TypeScript coverage threshold enforced (intentional per `.planning/codebase/TESTING.md:487`). Targeted invariants via fixture parity + barrel smoke + live-DB join resolution + ownership-gate regression serve this role. |

---

## Sampling Rate

- **After every task commit:** Run quick command (< 5 s).
- **After every plan wave:** Run full suite (`npm test`) + `npm run typecheck` + `npm run lint`.
- **Before `/gsd-verify-work`:** Full suite must be green; typecheck + lint exit 0; migration 064 applied (W1-02); migration 065 applied (W3-02); Voice-D3 RESTRICT case green; Voice-D11 live-DB nested-join test green (if HAS_LIVE_DB); Voice-D2 Python parity test green (if HAS_PY_ENV); Voice-D9 human visual review confirmed (W3-03).
- **Max feedback latency:** 15 seconds between save and red/green verdict (quick run).

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|-------------|--------|
| 5-01-W0-01 | 05-01 | 0 | DASHBOARD-01..06 + Voice-D1/D4/D5/D6/D9/D11 | Failing scaffolds created (incl. outcomes-join-rls + regression TC outcomes-05 + Voice-D9 className-prefixed cases + Voice-D5 truncation cases + Voice-D6 zero-delta case) | unit + live-DB scaffolds | `npx vitest run src/app/\(dashboard\)/allocations/widgets/outcomes/outcomes.test.tsx src/lib/outcomes-kpi.test.ts src/app/api/bridge/outcome/\[id\]/curves/route.test.ts src/__tests__/match-decisions-schema.test.ts src/__tests__/outcomes-join-rls.test.ts src/lib/bridge-outcome-label.test.ts src/lib/queries.my-allocation.test.ts` (RED expected) | ❌ W0 | ⬜ pending |
| 5-01-W0-02 | 05-01 | 0 | D-20a-b (Voice-C3 + D3) | Migration 064 (NULL, ON DELETE RESTRICT) + migration 065 (NOT NULL follow-up guarded by DO block) files written | migration file grep | `grep -c "ON DELETE RESTRICT" supabase/migrations/064_*.sql && grep -c "SET NOT NULL" supabase/migrations/065_*.sql` | ❌ W0 | ⬜ pending |
| 5-01-W0-03 | 05-01 | 0 | D-16 + Voice-D10 | `bridgeOutcomeCurvesLimiter` exported from `src/lib/ratelimit.ts` (60/60s) | typecheck + grep | `grep -c "bridgeOutcomeCurvesLimiter" src/lib/ratelimit.ts && npm run typecheck` | ❌ W0 | ⬜ pending |
| 5-01-W1-01 | 05-01 | 1 | D-20c (Voice-C2 reorder) | Human-decision checkpoint precedes migration apply; Option C halts before DDL | n/a (checkpoint:decision) | n/a — human resume-signal | n/a | ⬜ pending |
| 5-01-W1-02 | 05-01 | 1 | D-20a (Voice-C3) | Migration 064 applied via supabase db push or MCP; Case 4 (Voice-D3 RESTRICT) passes | migration apply + schema grep | `supabase db push && HAS_LIVE_DB=1 npx vitest run src/__tests__/match-decisions-schema.test.ts` | ❌ W0 | ⬜ pending |
| 5-01-W1-03 | 05-01 | 1 | D-20b | `POST /api/admin/match/send-intro` accepts + forwards original_strategy_id | route-handler + grep | `grep -c "p_original_strategy_id" src/app/api/admin/match/send-intro/route.ts && npm run typecheck` | ✅ existing (extended) | ⬜ pending |
| 5-01-W1-04 | 05-01 | 1 | D-20c | SendIntroPanel POSTs original_strategy_id per W1-01 decision | typecheck + grep | `grep -c "original_strategy_id" src/components/admin/SendIntroPanel.tsx && npm run typecheck` | ✅ existing (extended) | ⬜ pending |
| 5-01-W1-05 | 05-01 | 1 | D-11/D-12 revised/D-21 (Voice-D2) | `computeOutcomeKPIs` output equals golden fixture (avgRealizedDelta 0.00333 via most-mature) | unit + golden | `npx vitest run src/lib/outcomes-kpi.test.ts` | ❌ W0 | ⬜ pending |
| 5-01-W1-06 | 05-01 | 1 | D-02 revised (Voice-D6) | `deriveOutcomeStatusPill` returns 4-variant tuples INCLUDING zero-delta -> allocated-loss | unit | `npx vitest run src/lib/bridge-outcome-label.test.ts -t "deriveOutcomeStatusPill"` | ✅ existing (extended) | ⬜ pending |
| 5-01-W1-07 | 05-01 | 1 | D-15 amended (Voice-D4 + D5) | Fan-out returns `outcomes` with nested embed + `.limit(200)` + `.eq("allocator_id", userId)` regression-asserted | unit | `npx vitest run src/lib/queries.my-allocation.test.ts -t "outcomes"` | ✅ existing (extended) | ⬜ pending |
| 5-01-W1-08 | 05-01 | 1 | D-16 (Voice-D10) | Curves route: 401 unauth, 404 cross-allocator, 200 rebased to 100 at allocated_at, windowed ≤ 180d, 429 w/ Retry-After, `bridgeOutcomeCurvesLimiter` called (not userActionLimiter), TC7 match_decision_id=null handled | route-handler + auth | `npx vitest run src/app/api/bridge/outcome/\[id\]/curves/route.test.ts` | ❌ W0 | ⬜ pending |
| 5-01-W1-09 | 05-01 | 1 | Voice-D8 | LAYOUT_VERSION bump impact documented (localStorage-based; zero measurable server impact; no banner) | docs file exists | `test -f .planning/phases/05-outcomes-dashboard/05-01-LAYOUT-BUMP-NOTES.md` | ❌ W1 | ⬜ pending |
| 5-01-W2-01 | 05-01 | 2 | DASHBOARD-01..06 + Voice-D1/D5/D9 | Single-file OutcomesWidget.tsx with inline KpiStrip / TimelineTable / TimelineRow / ExpandedPanel / Sparkline; truncation footer when count=200; className-prefixed typography tests green | component | `npx vitest run src/app/\(dashboard\)/allocations/widgets/outcomes/outcomes.test.tsx && ls src/app/\(dashboard\)/allocations/widgets/outcomes/ \| wc -l` (expect 2: widget + test) | ❌ W0 | ⬜ pending |
| 5-01-W2-02 | 05-01 | 2 | DASHBOARD-01 + D-17/D-18/D-19 | Widget registers in `WIDGET_REGISTRY` + `WIDGET_COMPONENTS` barrel + `outcomes` category + LAYOUT_VERSION bump 1→2 | unit (barrel smoke) | `npx vitest run src/app/\(dashboard\)/allocations/widgets/outcomes/outcomes.test.tsx -t "Barrel export" && grep -c "LAYOUT_VERSION = 2" src/app/\(dashboard\)/allocations/lib/dashboard-defaults.ts` | ❌ W0 | ⬜ pending |
| 5-01-W3-01 | 05-01 | 3 | D-20d | ROADMAP.md READ-ONLY struck + references migrations 064 + 065 | docs grep | `grep -c "READ-ONLY" .planning/ROADMAP.md` returns 0 | n/a | ⬜ pending |
| 5-01-W3-02 | 05-01 | 3 | D-20a (Voice-C3) | Migration 065 applied; `is_nullable='NO'` confirmed; zero NULL rows pre-check passed | migration apply + schema grep | `supabase db push && HAS_LIVE_DB=1 npx vitest run src/__tests__/match-decisions-schema.test.ts` | ❌ W0 | ⬜ pending |
| 5-01-W3-03 | 05-01 | 3 | UI-SPEC typography (Voice-D9) | Human DevTools review confirms Geist Mono on KPI values + DM Sans on labels/body + tabular-nums aligned | manual (human resume-signal) | n/a — human "confirmed" note | n/a | ⬜ pending |
| 5-01-W3-04 | 05-01 | 3 | DASHBOARD-01..06 + all Voice findings | Phase gate: npm test + typecheck + lint + grep greps + HAS_LIVE_DB + HAS_PY_ENV parity all green | meta | `npm test && npm run typecheck && npm run lint` + optional HAS_LIVE_DB + HAS_PY_ENV | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/app/(dashboard)/allocations/widgets/outcomes/outcomes.test.tsx` — RED scaffolds for OutcomesWidget (loading/empty/error/populated) + inline KpiStrip (typography className-presence, Voice-D9-prefixed) + TimelineTable/Row (sort order, 4-state pill incl. zero-delta allocated-loss per Voice-D6 via deriveOutcomeStatusPill, strategy links, em-dash) + ExpandedPanel (lazy fetch + cache + pending-pill) + barrel smoke + Voice-D5 truncation footer (`length===200`).
- [ ] `src/lib/outcomes-kpi.ts` + `src/lib/outcomes-kpi.test.ts` — pure `computeOutcomeKPIs(outcomes)` + 8 cases including golden-fixture parity (avgRealizedDelta=0.00333 via most-mature delta — Voice-D2 math).
- [ ] `tests/fixtures/outcomes-kpi-parity.json` — shared golden fixture; includes `expected`, `phase4_success_values`, `phase4_mature_survivors`.
- [ ] `src/lib/bridge-outcome-label.test.ts` — **extended** file with 8 cases for new `deriveOutcomeStatusPill` helper (4 allocated variants INCLUDING Voice-D6 zero-delta=allocated-loss + 4 rejected reason labels).
- [ ] `src/app/api/bridge/outcome/[id]/curves/route.ts` + `route.test.ts` — lazy curves endpoint + 7 cases (auth, not-found, id-missing, happy-path rebase, windowing, rate-limit with `bridgeOutcomeCurvesLimiter` assertion per Voice-D10, match_decision_id=null).
- [ ] `src/lib/queries.my-allocation.test.ts` — **extended** file with 5 cases for new outcomes fan-out INCLUDING Voice-D4 TC outcomes-05 (`.eq("allocator_id", userId)` regression gate) + `.limit(200)` sub-assertion (Voice-D5).
- [ ] `src/__tests__/match-decisions-schema.test.ts` — schema smoke. Case 4 (Voice-D3 `delete_rule='RESTRICT'` assertion) + cases 1-3 (existence, index, 6-arg RPC, old 5-arg dropped). HAS_LIVE_DB-gated. Mirrors Phase 1 `bridge-outcomes-rls.test.ts` precedent.
- [ ] `src/__tests__/outcomes-join-rls.test.ts` — **NEW per Voice-D11**. HAS_LIVE_DB-gated. Seeds 2 allocators + outcomes + match_decisions; asserts cross-allocator isolation + nested `payload.match_decision.original_strategy.name` resolution.
- [ ] `analytics-service/tests/test_outcomes_kpi_parity.py` — **NEW per Voice-D2 option a**. Python pytest; HAS_PY_ENV-gated. Imports `feedback_engine._success_value`; asserts per-row values match fixture's `phase4_success_values`; asserts `phase4_mature_survivors` set matches filter-level logic.

**No framework install needed** — Vitest + RTL + pytest already installed; all deps are in place.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Widget visible by default for pre-existing allocators on next page load | DASHBOARD-01 + D-18 + Voice-D8 | LAYOUT_VERSION bump resets localStorage-persisted layout; no server query can enumerate affected users | Log in as `quantalyze-test`-keychain demo allocator; load `/allocations`; confirm `outcomes-timeline` widget appears without drag-drop; open DevTools → Application → Local Storage, confirm `quantalyze-dashboard-config` has `layoutVersion: 2`. |
| Sparkline visual fidelity on desktop 1440×900 | DASHBOARD-04 | Pixel-level stroke width + motion timing are visual, not grep-verifiable | Open Chrome DevTools, load outcomes widget with 2+ rows, expand a row, confirm two `<Line>` series render, replacement line in `#1B6B5A`, original in `#94A3B8`; sparkline height ~32–40 px. |
| Rendered typography (Voice-D9 — task W3-03) | DASHBOARD-02/03 className spec vs actual fonts | className assertions prove class attachment, not rendered typography | Follow W3-03 `<how-to-verify>` step-by-step. Expected sign-off: "confirmed — Geist Mono on KPI values, DM Sans on labels/body, tabular-nums aligned." |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify commands or Wave 0 dependencies declared
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all new-file MISSING references in the map above (incl. Voice-D2 Python harness + Voice-D11 live-DB nested-join test)
- [ ] Golden fixture `tests/fixtures/outcomes-kpi-parity.json` committed + referenced by both TS tests (outcomes-kpi.test.ts) AND Python test (test_outcomes_kpi_parity.py) per Voice-D2 option a
- [ ] No watch-mode flags in CI commands
- [ ] Feedback latency < 15 s (quick), < 60 s (full + typecheck + lint)
- [ ] Migration 064 applied + reconciled (W1-02) before W1-03..W1-08 begin
- [ ] Migration 065 applied + reconciled (W3-02) before W3-04 phase gate
- [ ] Voice-D3 RESTRICT case (Case 4 in match-decisions-schema.test.ts) passes under HAS_LIVE_DB=1
- [ ] Voice-D11 outcomes-join-rls.test.ts passes under HAS_LIVE_DB=1 (or advertises skip)
- [ ] Voice-D9 human visual typography review confirmed at W3-03
- [ ] `nyquist_compliant: true` set in frontmatter once Wave 0 scaffolds are written and verified RED

**Approval:** pending
