---
phase: "188"
slug: "tinybase-a-day-measured-against-a-near-empty-account-does-no"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-03"
---

# Phase 188 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Source: `188-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (asyncio auto, xdist in CI) for Python; vitest for TS |
| **Config file** | `analytics-service/pytest.ini`; `vitest.config.ts` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_tiny_base.py tests/test_allocator_equity_dropped_day_pnl.py tests/test_allocator_equity_dropped_day_returns.py tests/test_nav_marks_apply.py tests/test_nav_twr.py -q` |
| **Full suite command** | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` |
| **Type gate** | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| **Estimated runtime** | ~10 seconds quick; several minutes full |

---

## Sampling Rate

- **After every task commit:** Run the quick run command
- **After every plan wave:** Run the full suite command and the mypy line; vitest for touched TS files
- **Before `/gsd-verify-work`:** Full suite must be green and the SC-4 PROD reading recorded
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

Filled by the planner per task; see each PLAN.md `<verify>` block. Requirement anchors are SC-1..SC-5 (ROADMAP `### Phase 188`); the phase has no REQ-IDs.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 188-01-T1 (tracer) | 01 | 1 | SC-2, SC-3, SC-5 | T-188-01, T-188-02 | tiny day absent, P&L in key_inputs, book sits the key out; marks-only and unusable-S-1 series judged (T-LM) | integration (real derive + real compose) + unit | `pytest tests/test_tiny_base_roundtrip.py tests/test_tiny_base_marks.py` | ❌ W0 (created RED first) | ⬜ pending |
| 188-01-T2 | 01 | 1 | SC-2 | T-188-03 | static-text refusals | unit | `pytest tests/test_tiny_base.py` + full suite + mypy | ❌ W0 | ⬜ pending |
| 188-02-T1 | 02 | 2 | SC-2, SC-5 | T-188-05, T-188-07 | NaN never 0.0 on four venues | unit (real combiners) | `pytest tests/test_tiny_base_realized.py tests/test_tiny_base_venues.py tests/test_nav_twr.py` | ❌ W0 | ⬜ pending |
| 188-02-T2 | 02 | 2 | SC-2, SC-3, SC-5 | T-188-06 | exact oracle agrees with the writer | unit (exact Fraction oracle) | `pytest tests/test_allocator_equity_dropped_day_pnl.py tests/test_tiny_base_book.py` + full suite | extend + ❌ W0 | ⬜ pending |
| 188-03-T1 | 03 | 2 | SC-2, SC-5 | T-188-18 | gap days of a withheld mark left out, key sits out of the whole period (T-GAP) | unit + integration (two-key compose) | `pytest tests/test_tiny_base_marks.py` | extend (plan 01's module) | ⬜ pending |
| 188-03-T2 | 03 | 2 | SC-2 | T-188-04 | pre-start roll stops, never refuses (T-OQ4, KL-3) | unit | `pytest tests/test_tiny_base_marks.py` + full suite + mypy | extend | ⬜ pending |
| 188-04-T1 | 04 | 3 | SC-2 | T-188-19 | a quiet day on a near-empty account is named, index unchanged | unit | `pytest tests/test_tiny_base_quiet_days.py` | ❌ W0 | ⬜ pending |
| 188-04-T2 | 04 | 3 | SC-2, SC-5 | T-188-19, T-188-20 | quiet tiny day NaN on three NAV combiners; unnamed days byte-identical | unit (real combiners) | `pytest tests/test_tiny_base_quiet_days.py` + full suite + mypy | extend | ⬜ pending |
| 188-05-T1 | 05 | 4 | SC-2, SC-5 | T-188-08, T-188-10 | no amount in flags; every venue's tiny P&L stored once | integration | `pytest tests/test_tiny_base_derive_flags.py` | ❌ W0 | ⬜ pending |
| 188-05-T2 | 05 | 4 | SC-2 | T-188-09 | malformed list dropped, no value logged; DataQualityFlags declared | integration (real runner) | `pytest tests/test_tiny_base_runner.py` + full suite + mypy | ❌ W0 | ⬜ pending |
| 188-06-T1 | 06 | 5 | SC-2 | T-188-11 | literal pin both languages | unit (vitest) | `npx vitest run src/__tests__/tiny-base-literal-pin.test.ts` | ❌ W0 | ⬜ pending |
| 188-06-T2 | 06 | 5 | SC-2, SC-5 | T-188-21 | malformed list gives no days; valid list distinct and ascending | unit (vitest) | `npx vitest run src/lib/tiny-base-flag.test.ts` | ❌ W0 | ⬜ pending |
| 188-07-T1 | 07 | 6 | SC-2 | — | strict `=== true` | unit (vitest) | `npx vitest run src/lib/factsheet/headline-basis.test.ts` | extend | ⬜ pending |
| 188-07-T2 | 07 | 6 | SC-2, SC-5 | T-188-12, T-188-13 | the note counts and names the days (D-06); malformed list shows no note; days and threshold only, no amount | component (vitest) | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetView.tiny-base.test.tsx"` | ❌ W0 | ⬜ pending |
| 188-08-T1 | 08 | 7 | SC-2, SC-5 | T-188-14, T-188-15 | owner RLS read, fail closed | unit (vitest) | `npx vitest run src/lib/queries.my-allocation.test.ts` | extend | ⬜ pending |
| 188-08-T2 | 08 | 7 | SC-2 | T-188-15 | a validated day list only, present when non-empty | unit + component (vitest) | `npx vitest run src/lib/factsheet/allocator-portfolio-payload.test.ts "src/app/(dashboard)/allocations/AllocationDashboardV2.tiny-base.test.tsx"` | ❌ W0 | ⬜ pending |
| 188-09-T1 (tracer) | 09 | 8 | SC-2, SC-3, SC-5 | T-188-22, T-188-23 | a named day sits out the blend and weight sum; absent list byte-identical; no new query | unit + integration (vitest, real engine + SSR read) | `npx vitest run src/lib/scenario.tiny-base.test.ts src/lib/queries.my-allocation.test.ts` | ❌ W0 + extend | ⬜ pending |
| 188-09-T2 | 09 | 8 | SC-2, SC-5 | T-188-22, T-188-23 | live-book compare column equals the SSR baseline; saved per-key drafts read the same days | unit + component (vitest) | `npx vitest run "src/app/(dashboard)/allocations/lib/scenario-tiny-base.test.ts" "src/app/(dashboard)/allocations/components/ScenarioComparePanel.test.tsx"` | ❌ W0 + extend | ⬜ pending |
| 188-10-T1 | 10 | 9 | SC-2, SC-3, SC-5 | T-188-25 | composer KPIs match the oracle; the tab feeds the compare panel the same lists | component (vitest) | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"` | extend | ⬜ pending |
| 188-10-T2 | 10 | 9 | SC-2, SC-5 | T-188-25 | diversification on the engine's correlation day set; absent list byte-identical | unit (vitest) | `npx vitest run src/lib/diversification.tiny-base.test.ts src/lib/diversification.test.ts` | ❌ W0 | ⬜ pending |
| 188-11-T1..T3 | 11 | 10 | SC-4 | T-188-16, T-188-17 | read-only, marker first, no ids in SUMMARY | manual PROD reading (orchestrator) | see 188-11-PLAN.md | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_tiny_base.py` — rule definition (SC-2)
- [ ] `analytics-service/tests/test_tiny_base_venues.py` — every-venue and SC-5 arms
- [ ] `analytics-service/tests/test_tiny_base_quiet_days.py` — a quiet day on a near-empty account (D-03 for every day, SC-5)
- [ ] A key-C-shaped fixture shared by apply, compose and runner tests (SC-3)
- [ ] `npm ci` in the worktree if any TS task is planned

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Neuter-and-restore: the new tests go RED with the rule disabled | SC-3 | gate integrity proof | neuter the helper, run the tests, see RED, restore from a byte backup (never git checkout/restore/stash) |
| Post-deploy PROD reading of every changed day across all books | SC-4 | needs the deployed nightly derive | `188-RESEARCH.md` `## SC-4 reading design`; marker query first |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
