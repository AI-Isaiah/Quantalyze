---
phase: "235"
slug: "holdingstruth"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: "2026-11-26"
---

# Phase 235 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Source: 235-RESEARCH.md `## Validation Architecture`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (TS) and pytest (analytics-service) |
| **Config file** | `vitest.config.ts`, `analytics-service/pyproject.toml` |
| **Quick run command** | `npx vitest run <one file>`; `cd analytics-service && .venv/bin/python -m pytest tests/<file>.py -q` |
| **Full suite command** | CI only (heavy; parallel phases share the host). Per wave: the census set in RESEARCH plus `npm run typecheck` and, for analytics, mypy strict |
| **Estimated runtime** | ~60 seconds per wave set |

---

## Sampling Rate

- **After every task commit:** the single test file(s) the task edits
- **After every plan wave:** census set + `npm run typecheck` (+ mypy strict for HOLD-02)
- **Before `/gsd-verify-work`:** CI full suite green bound to the head SHA
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

Filled by the planner per task (`<automated>` blocks). Requirement-level map: 235-RESEARCH.md `### Phase Requirements to Test Map`.

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `analytics-service/tests/fixtures/native_unpriced_account_day_cases.json` — shared HOLD-02 case table
- [ ] `src/lib/native-unpriced-account-day.parity.test.ts` and `analytics-service/tests/test_match_native_unpriced_account_day.py` — HOLD-02 replays
- [ ] `src/lib/queries.my-allocation.test.ts` — marker-only failure injection key (HOLD-04)
- [ ] Two render-test files for the HOLD-04 note mounts (T5/T6/T9)

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
