---
phase: 74
slug: funnel-wiring-both-callers
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-05
---

# Phase 74 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Full architecture in `74-RESEARCH.md` ("## Validation Architecture").

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | pytest 7.x (analytics-service) |
| **Config file** | `analytics-service/pytest.ini` / `pyproject.toml` |
| **Quick run command** | `cd analytics-service && $PY312 -m pytest tests/test_transforms*.py tests/test_nav_twr.py -q` |
| **Full suite command** | `cd analytics-service && $PY312 -m pytest -q` |
| **Interpreter** | `$PY312` = `/private/tmp/claude-501/-Users-helios-mammut-claude-projects-quantalyze/fcce1bd5-15ef-4e42-adb9-85cfc9ad484c/scratchpad/venv312/bin/python` (local 3.14 SIGSEGVs on pandas — MANDATORY) |
| **Estimated runtime** | ~50s full suite |

---

## Sampling Rate

- **After every task commit:** run the quick command.
- **After the wiring diff + before verification:** run the FULL suite (blast-radius phase — every venue flows through `transforms.py`).

---

## Critical Validation Requirements (must appear as plan must_haves)

1. **Byte-identity, daily_pnl branch (SC-4 already exists):** flow-less /
   `estimated_start > 0` accounts unchanged through the new delegated path at the
   `analytics_runner.py:1309` and `broker_dailies.py:130` call sites.
2. **NEW byte-identity, individual-trades branch:** `portfolio.py:2260` /
   `transforms.py:178-212` real-fills path is byte-identical (rtol 1e-12) to the
   pre-refactor output on flow-less input — the extract-aggregate helper feeding
   `reconstruct_nav_and_twr` must reproduce today's numbers exactly.
3. **Fallback-deletion revert-proof:** a test that FAILS if either silent
   fallback (`transforms.py:154` daily_pnl `estimated_start<=0 -> account_balance`
   OR `:199`-region individual-trades zero-to-initial swap) is reintroduced.
4. **Status wiring:** guard-flagged accounts flip to `complete_with_warnings`;
   no-guard flow-less accounts stay `complete` (status-identical). Guard keys
   lift to top-level DQF + promotion predicate.
5. **NavReconstructionError permanent-catch:** structural failure yields a
   legitimate permanent `failed` at both callsites (mirroring `LedgerValuationError`),
   NOT a spurious retry-forever `unknown` classification.
6. **NaN-tolerance dependency (LOW-confidence, Wave 0 verify):** confirm the
   `csv_daily_returns` upsert `float(val)` path (`job_worker.py:2068/2078`) and
   `compute_all_metrics` tolerate the core's guarded-day NaN before wiring.

---

## Wave 0 (pre-flight, before the wiring diff)

- Verify NaN-tolerance of downstream upsert + metrics (requirement 6) — this is
  the one open dependency flagged LOW-confidence in research.
- Snapshot current outputs of all four call sites on representative flow-less
  fixtures to anchor the byte-identity pins.
