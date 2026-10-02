---
phase: 123-flipretry-derived-equity
plan: 03
subsystem: ground-truth-gate
tags: [ground-truth, e2, runbook, founder-ops, healthz, flipretry]
requires:
  - "123-01 wait_for crawl bounds"
  - "123-02 kind-filtered claim RPC + WORKER_CLAIM_ROLE"
provides:
  - "CI-pinned E2 anchor PASS/FAIL verdict fixtures (hand-derived, P115-independent)"
  - "CI-pinned derived<->legacy display flip at the derivePhase07Fields wiring level"
  - "docs/runbooks/flipretry-derived-equity-go-live.md (go-live sequence + verbatim v1.11 rollback)"
affects:
  - "the founder go-live path for the derived-allocator-equity FLIP"
tech-stack:
  added: []
  patterns:
    - "economic-invariant oracle: expectations hand-derived, never the module's own formula (P115)"
    - "founder live-ops gated behind a human_needed checkpoint, never faked"
key-files:
  created:
    - docs/runbooks/flipretry-derived-equity-go-live.md
  modified:
    - analytics-service/tests/test_e2_ground_truth_harness.py
    - src/lib/queries.test.ts
decisions:
  - "The runtime display gate stays the persisted is_trustworthy flag; the LIVE E2 run is a founder-gated PRE-flight, not a per-request live read or a new persisted column (RESEARCH A2 minimal staged gate)"
  - "The cron reschedule is a founder LIVE SQL op, NOT a repo migration — a committed reschedule migration would auto-apply to PROD at merge and, on a silently-skipped worker deploy, re-wedge the v1.11 incident verbatim"
  - "Task 3 (founder ops: deploy/cutover/pilot/live-E2/enqueue/cron) recorded human_needed-open; the committed CI harness + fixtures carry the phase until the founder runs it"
metrics:
  duration: ~40m
  completed: 2026-07-19
---

# Phase 123 Plan 03: E2 Ground-Truth Gate Fixtures + Go-Live Runbook + Founder Checkpoint Summary

FLIPRETRY-03 + the FLIPRETRY-04 ops leg: the ground-truth gate is now CI-pinned in both directions with an independent (P115) oracle, the go-live/rollback runbook sequences the founder ops so no unvalidated curve can ever show and the prod worker can never re-wedge, and the live legs are gated behind a human_needed founder checkpoint that was NOT faked.

## What Was Built

### Task 1 — E2-gate fixture pair (commit be474b9d, test-only)

**pytest — `analytics-service/tests/test_e2_ground_truth_harness.py`** (5 pass, +3 new):
- `test_e2_gate_pass_fixture_within_band_is_a_clean_reconcile` — derived 10000 / live 10150 / tol 2% → hand-derived +1.5% drift, in-band → `within_same_day_tolerance` True (the E2 exit-0 condition).
- `test_e2_gate_fail_on_drift_beyond_band_is_not_a_clean_reconcile` — derived 10000 / live 10500 → hand-derived +5% → `drift_within_tol` False while `trustworthy` True (the two signals surface separately); `within_same_day_tolerance` False. **This was the gap** — the pre-123 suite had no over-tolerance case.
- `test_e2_gate_fail_on_blocking_degradation_even_at_zero_drift` — zero drift but `trustworthy=False` → `within_same_day_tolerance` False (a blocking degradation can't be outvoted by a clean anchor; neuter-proof against dropping the `trustworthy` conjunct).
- **P115 independence proven by grep:** the only analytics import is the subject `compute_anchor_consistency`; every expectation is a literal hand-computed number. No import of `allocator_equity_compose`/`allocator_equity_derive` and no callback into the compose/derive formula as the oracle.
- The pre-existing degradation-within-tolerance test and the non-positive fail-loud guard are untouched (not duplicated).

**vitest — `src/lib/queries.test.ts`** (43 pass, +2 new, new describe block):
- `derivePhase07Fields — is_trustworthy → equityCurveSource flip (FLIPRETRY-03)`: a BYTE-IDENTICAL dense derived curve differing ONLY in `is_trustworthy` flips the ONE producer site — `true` → `equityCurveSource "derived"`, curve mapped directly, `derivedCurveComputedAt` set; `false` → `"legacy"`, snapshot fallback, `derivedCurveComputedAt` null.
- Tests the WIRING through `derivePhase07Fields` (the call-site-invokes-it rule), complementing the already-present integration-level flip tests in `queries.my-allocation.test.ts` (recorded, not duplicated). Deleting the `is_trustworthy !== true` guard in `extractTrustworthyDerivedCurve` would fail the FAIL case — neuter-proof.

### Task 2 — go-live + rollback runbook (commit ef8c53a3)

`docs/runbooks/flipretry-derived-equity-go-live.md` (146 lines). Ordered founder sequence, each step with a verify + an abort path back to rollback:
0. Preconditions (plans merged, migration object verified, prod worker at merge commit).
1. Deploy the dedicated backfill worker (`WORKER_CLAIM_ROLE=backfill`, `SUPABASE_SERVICE_KEY`).
2. Cut the prod worker to `interactive` — **stated in bold that the backfill worker becomes PROD-CRITICAL for deribit/sfox onboarding** from this step.
3. Pilot enqueue on one heavy key with the A1 bound check (`BROKER_CRAWL_TIMEOUT_S`/`SFOX_CRAWL_TIMEOUT_S`, raise BEFORE full enqueue if a healthy heavy crawl exceeds it) + prod healthz watch (the FLIPRETRY-04 live proof).
4. LIVE E2 gate — `exit 0` REQUIRED, **exit 3 SKIP is NOT a pass**, tolerance never widened to pass.
5. Full enqueue (idempotency pinned: advisory lock + per-(key,UTC-date) key + one-inflight index).
6. Cron reschedule LAST — documented as a founder LIVE SQL op (exact `cron.schedule('derive-allocator-key-dailies','30 5 * * *', ...)`) with the wedge-recreation rationale for why it is NOT a migration.
7. (Step 8 in doc) Verbatim v1.11 ROLLBACK — delete jobs + `DELETE FROM allocator_equity_derived` + `cron.unschedule` — reachable from any step. Plus the sFOX F5 fold appendix.

Grep gate PASS (`cron.unschedule`, `DELETE FROM allocator_equity_derived`, `WORKER_CLAIM_ROLE`, `exit 3` all present).

## Task 3 — Founder checkpoint (human_needed — OPEN, not faked)

`checkpoint:human-action`, gate="blocking". The remaining legs have NO CLI path from this repo session: minting/setting the read-only `E2_GROUND_TRUTH_*` key, creating the second Railway service, flipping prod env, running the live E2 against a real exchange account, and executing prod SQL for the enqueue + cron. Per 123-CONTEXT these are FOUNDER-gated and were NOT executed, simulated, or faked.

**To resume:** follow `docs/runbooks/flipretry-derived-equity-go-live.md` steps 1–7. Hard gates: prod healthz 200/fresh throughout the pilot + full backfill; `e2_allocator_ground_truth.py` exit 0 (exit 3 = SKIP ≠ pass); cron scheduled only after both; spot-check one allocator shows `equityCurveSource: "derived"` only for a backfilled trustworthy key. Any gate fails → runbook rollback (step 8). Reply "flip-live" with the E2 exit code + a healthz observation, or describe the failed gate.

The committed CI harness + fixtures (Task 1) and the runbook (Task 2) carry the phase until the founder runs it — this checkpoint stays OPEN and is recorded human_needed, never as passed.

## Deviations from Plan

None — plan executed as written. The plan's `files_modified` named `src/lib/queries.test.ts` for the wiring fixture; the pre-existing integration flip lives in `queries.my-allocation.test.ts`, so the new focused `derivePhase07Fields`-level test was added to `queries.test.ts` (as the plan artifact specified) and the integration coverage was recorded (not duplicated), per Task 1's "add only the fixtures that do not already exist".

## Verification

- `cd analytics-service && .venv/bin/python -m pytest tests/test_e2_ground_truth_harness.py -q` → **5 passed**.
- `npx vitest run src/lib/queries.test.ts --no-file-parallelism` → **43 passed**.
- Runbook grep gate → **PASS** (146 lines).

## FLIPRETRY-03 / -04 status

- **FLIPRETRY-03:** ground-truth gate CI-pinned with an independent (P115) oracle in both directions (anchor drift/degradation → E2 verdict; `is_trustworthy` → derived/legacy display). The LIVE E2 leg is founder-executed per the staged gate — no derived curve shows before E2 passes. **Committed gate done; live leg human_needed-open.**
- **FLIPRETRY-04:** healthz-fresh-during-backfill is proven live in the runbook's pilot/full-enqueue steps; enqueue idempotency is documented (and SQL-gated in 123-02); rollback documented verbatim and executable. **Documented + pinned; the live healthz proof is founder-executed.**

## Self-Check: PASSED

All created files present (runbook, both test files, SUMMARY); both commits (be474b9d, ef8c53a3) in git log.
