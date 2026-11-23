---
phase: "216"
slug: "csvstatus-a-malformed-csv-upload-answers-422-with-recoverabl"
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: true
created: "2026-11-18"
---

# Phase 216 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Reconstructed from artifacts (State B): research was skipped, so no VALIDATION.md was seeded at plan time; the plan's own `<verification>` section carried the map.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest (analytics-service), vitest (TS invariant) |
| **Config file** | `analytics-service/pyproject.toml`, `vitest.config.ts` |
| **Quick run command** | `cd analytics-service && python3 -m pytest -p no:cacheprovider -q tests/test_process_key_scope_rejection_statuses.py tests/test_process_key.py` |
| **Full suite command** | `cd analytics-service && python3 -m pytest -p no:cacheprovider -q` and `npm test` |
| **Estimated runtime** | ~7 seconds (quick) |

---

## Sampling Rate

- **After every task commit:** Run the quick run command
- **After every plan wave:** Run the full suite command
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 216-01-01 | 01 | 1 | 216-GOAL (CSV verdict → 422, recoverable false) | T-216-01 | `pandera_errors` projected, raw cell withheld | unit | `pytest tests/test_process_key_scope_rejection_statuses.py::test_csv_validator_verdict_answers_422_not_recoverable tests/test_process_key.py::test_sync_pipeline_rejection_also_forwards_the_breakdown` | ✅ | ✅ green |
| 216-01-02 | 01 | 1 | 216-GOAL (CSV_UPSTREAM_FAIL and non-csv sources stay 424; 403 arms unchanged) | T-216-02 | non-csv source cannot reach the 422 arm | unit | `pytest tests/test_process_key_scope_rejection_statuses.py` (`test_retryable_verdicts_stay_424_recoverable`, `test_permanent_codes_answer_403_not_recoverable`, `test_validation_unexpected_fallback_answers_403_not_recoverable`, `test_permanent_set_is_exactly_the_five_pinned_codes`, `test_validate_only_invalid_answers_200_ok_false`) | ✅ | ✅ green |
| 216-01-02b | 01 | 1 | draft transition recorded before the 422 return (review M-1) | T-216-03 | verdict persisted on the verification row | unit | `pytest tests/test_process_key_scope_rejection_statuses.py::test_csv_validator_verdict_answers_422_not_recoverable` | ✅ | ✅ green |
| 216-01-03 | 01 | 1 | stale status comments corrected; TS scanner census | — | N/A | invariant | `npx vitest run src/lib/seam-venue-vocabulary.invariant.test.ts` | ✅ | ✅ green (executor run) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

Can-fail evidence: four neuters (status, `recoverable`, the `CSV_UPSTREAM_FAIL` clause, the source clause) each turned the named cases RED (216-01-SUMMARY); the M-1 draft-transition neuter turned 8 rows RED (216-REVIEW). Every restore was from a byte backup checked with `cmp`.

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

---

## Manual-Only Verifications

All phase behaviors have automated verification. No live wizard surface reaches this gate at HEAD (216-CONTEXT, "Measured at HEAD"), so there is no UI behaviour to check by hand.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-11-18
