---
phase: "252"
slug: "deribitoptions"
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-25"
---

# Phase 252 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: `252-RESEARCH.md` `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS); pytest + mypy strict (Python, wave 2 only) |
| **Config file** | `vitest.config.ts`; `analytics-service/pyproject.toml` |
| **Quick run command** | `npx vitest run src/lib/factsheet/headline-basis.test.ts src/lib/factsheet/headline-verdict.parity.test.ts` |
| **Full suite command** | `npm run typecheck && npm run lint && npm test`; `cd analytics-service && pytest` |
| **Estimated runtime** | quick ~20 s; full several minutes |

---

## Sampling Rate

- **After every task commit:** the quick run command plus the touched test file
- **After every plan wave:** `npm run typecheck && npm run lint && npx vitest run src/lib src/__tests__`, plus CI mypy strict for any Python touch
- **Before `/gsd-verify-work`:** full suite must be green
- **Max feedback latency:** 60 seconds for the quick command

---

## Per-Task Verification Map

Filled by the planner per task (see each PLAN.md `<verify>`). The criteria map:

| Criterion | Test Type | Automated Command | File Exists |
|-----------|-----------|-------------------|-------------|
| SC-2/SC-3 evidence-shaped row withheld with the named cause on page and card | unit/parity | `npx vitest run src/lib/factsheet/headline-verdict.parity.test.ts` | extend |
| SC-2 wallet-shape RED on pre-fix code, GREEN after | unit | same file | W0 |
| SC-3 every seam agrees for the same flags | unit census | `npx vitest run src/__tests__/options-cash-wallet-withhold.census.test.ts` | W0 |
| Negatives: other `mtm_gated_reason` values, chain-broken alone, MT5 shape | unit, table-driven | `npx vitest run src/lib/factsheet/headline-basis.test.ts` | extend |
| Cross-language literal equals `MTM_REASON_OPTIONS` | vitest file read | census test | W0 |
| SC-5 / 155.2: MT5-shaped row byte-identical verdict and shape | unit | headline-basis test | W0 |
| Wave 2 probe self-test on a stubbed exchange | pytest | `cd analytics-service && pytest tests/test_deribit_options_smoothed_probe.py` | W0 |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/__tests__/options-cash-wallet-withhold.census.test.ts`
- [ ] new cases in `src/lib/factsheet/headline-basis.test.ts` and `src/lib/factsheet/headline-verdict.parity.test.ts`
- [ ] `analytics-service/tests/test_deribit_options_smoothed_probe.py` (wave 2)
- [ ] `npm ci` in the worktree

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Withheld-reason wording and muted tone on factsheet, share card, Compare, Discovery | SC-3 | user-facing copy (Claude's discretion, founder sees it) | founder visual check after deploy |
| Evidence composite shows the withheld headline on PROD | SC-3 | needs the deployed build | open the owner factsheet after deploy |
| Wave 2 measurement run | ruling (measure first) | needs the keys' credentials in the worker | founder-gated run of the probe |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 60s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
