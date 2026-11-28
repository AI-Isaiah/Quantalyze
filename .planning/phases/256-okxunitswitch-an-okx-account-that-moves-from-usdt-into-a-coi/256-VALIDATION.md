---
phase: "256"
slug: "okxunitswitch"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-27"
---

# Phase 256 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `256-RESEARCH.md` § Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest + pytest-asyncio (from `analytics-service/` only), mypy strict (`make typecheck`), vitest |
| **Config file** | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml`, `vitest.config.ts` |
| **Quick run command** | `cd analytics-service && python3 -m pytest tests/test_unit_switch.py tests/test_okxtrades_ccy.py -x -q` |
| **Full suite command** | `cd analytics-service && python3 -m pytest && make typecheck`; `npm test` and `npm run typecheck` for TS |
| **Estimated runtime** | ~30 seconds quick; several minutes full |

---

## Sampling Rate

- **After every task commit:** the task's own test file, plus `make typecheck` for analytics changes
- **After every plan wave:** `python3 -m pytest` from `analytics-service/`; vitest for touched TS
- **Before `/gsd-verify-work`:** full suites green and the SC-5 PROD read
- **Max feedback latency:** 60 seconds

---

## Per-Task Verification Map

Filled by the planner per task. Requirement column uses the ROADMAP success criteria SC-1..SC-7.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 256-01-01..03 | 01 | 1 | SC-1, SC-2 | T-256-01, T-256-03 | closed refusal set; no date literal; one unit per day | unit | `cd analytics-service && python3 -m pytest tests/test_unit_switch.py -x -q` | ❌ W0 | ⬜ pending |
| 256-02-01..02 | 02 | 1 | SC-2, SC-7 | T-256-04..06 | object CHECK; no RLS change; lint-clean | sql | `node scripts/lint-migration-data-dependence.mjs` + SQL test on the local lane | ❌ W0 | ⬜ pending |
| 256-03-01..03 | 03 | 2 | SC-4 | T-256-07..09 | regex-gated ccy; default refuses; AST call-site pin | unit | `cd analytics-service && python3 -m pytest tests/test_okx_unit_switch_fetch.py tests/test_okxtrades_ccy.py -x -q` | ❌ W0 | ⬜ pending |
| 256-04-01..03 | 04 | 2 | SC-2, SC-3 | T-256-10..12 | headline all USD; conversion oracle; unpriced day named | unit | `cd analytics-service && python3 -m pytest tests/test_unit_switch_series.py -x -q` | ❌ W0 | ⬜ pending |
| 256-05-01..03 | 05 | 2 | SC-3 | T-256-13..15 | labels from parsed JSONB only | component | `npx vitest run src/lib/factsheet/unit-segments.test.ts` | ❌ W0 | ⬜ pending |
| 256-06-01..03 | 06 | 3 | SC-1, SC-2, SC-3, SC-5 | T-256-16..19 | no mixed-unit series stored; refusals named | integration | `cd analytics-service && python3 -m pytest tests/test_okx_unit_switch_derive.py -x -q` | ❌ W0 | ⬜ pending |
| 256-07-01..03 | 07 | 3 | SC-3 | T-256-20..22 | no joining path; leverage held at 1x | component | `npx vitest run "src/app/factsheet/[id]/v2/TimeSeriesChart.unit-switch.test.tsx"` | ❌ W0 | ⬜ pending |
| 256-08-01..03 | 08 | 3 | SC-3 | T-256-23..25 | three closed list scalars; OG cache key varies | component | `npx vitest run src/lib/unit-switch-readers.test.ts` | ❌ W0 | ⬜ pending |
| 256-09-01..03 | 09 | 4 | SC-2, SC-3, SC-5 | T-256-26..28 | coin days priced at own close; no native_unit | integration | `cd analytics-service && python3 -m pytest tests/test_okx_unit_switch_key_mode.py tests/test_okx_unit_switch_readers.py -x -q` | ❌ W0 | ⬜ pending |
| 256-10-01..03 | 10 | 5 | SC-5, SC-6, SC-7 | T-256-29..30 | no ids in tracked text; marker query first | grep / manual | `grep -c "2026-11-14 and 2026-11-20" .planning/ROADMAP.md` | n/a | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/test_unit_switch.py` — SC-1 fixtures (a)-(g)
- [ ] `analytics-service/tests/test_okx_unit_switch_fetch.py` — SC-4 both ways
- [ ] `analytics-service/tests/test_okx_unit_switch_derive.py` — SC-2, per-segment engine, marks per segment
- [ ] `src/lib/factsheet/unit-segments.test.ts` plus extensions to the census reader tests
- [ ] `npm ci` in the worktree

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| 7 nightly derives end `done`, 3 strategies unfreeze | SC-5 | production state after deploy | Marker query first; read the derive jobs' status and `read_refusal_kept_figures` after the deploy and again after the next nightly; no ids in tracked text |
| PROOF-01 per gate | SC-7 | procedure evidence | `cp` byte backup, neuter, RED with the named arm, `cp` back, `cmp` silent, GREEN; paste verbatim in the plan SUMMARY |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
