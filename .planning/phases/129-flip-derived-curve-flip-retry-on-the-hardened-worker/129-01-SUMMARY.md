---
phase: 129-flip-derived-curve-flip-retry-on-the-hardened-worker
plan: 01
subsystem: analytics-worker / allocator-equity-display
tags: [flip, backfill-enqueue, idempotency, rollback, display-gate, human_needed]
requires:
  - Phase 123 (crawl bounds + claim kind-filter + E2/flip fixtures + runbook)
  - Phase 125 (dedicated backfill worker + WORKER_CLAIM_ROLE split)
  - Phase 127 (E2GT display gate audit; E2GT-01 live run still human_needed)
provides:
  - "FLIP-02 audit verdict (idempotent enqueue + executable rollback) — SATISFIED with live pytest + runbook grep evidence"
  - "Display-gate intact proof (ROADMAP criterion 4) — existing fixtures pass on branch"
  - "FLIP-01 disposition — human_needed-OPEN, gating Phase 130 GOLIVE"
affects:
  - Phase 130 GOLIVE (blocked on FLIP-01 live evidence + E2GT-01)
tech-stack:
  added: []
  patterns:
    - "Audit-then-fill (ponytail): verify load-bearing tested code, fill ONLY a named genuine gap"
key-files:
  created: []
  modified: []
decisions:
  - "FLIP-01 DEFERRED (not simulated, not CI-claimed) — founder LIVE prod op gated on E2GT-01 (open)"
  - "Zero source edits — all 6 FLIP-02 checklist items already load-bearing + tested"
metrics:
  duration: "~10 min"
  completed: 2026-07-19
  source_commits: 0
  tasks: "2 auto (audit + regression-confirm) + 1 checkpoint (FLIP-01, deferred)"
---

# Phase 129 Plan 01: FLIP — derived-curve retry on the hardened worker Summary

**One-liner:** Verified (not rebuilt) the FLIP-02 idempotent-enqueue + executable-rollback groundwork with live pytest evidence, confirmed the Phase-127 display gate is intact on-branch, and honestly dispositioned FLIP-01 (the founder live prod backfill enqueue) as `human_needed`-OPEN — zero source edits, no manufactured work.

This is a VERIFICATION phase. Per the ponytail discipline, the expected and actual outcome of the audit tasks was ZERO code edits: the enqueue idempotency, the fail-louds, the race safety, the executable rollback, and the display gate were all built and tested in v1.11/v1.12 (Phases 123/125/127) and remain load-bearing. No genuine coverage gap was found, so no test or runbook line was added.

## Task 1 — FLIP-02 audit: enqueue idempotency + rollback executability (live evidence)

**Verdict: SATISFIED (6/6 items). Zero edits.**

Live command:
```
$ .venv/bin/python -m pytest tests/test_phase35_backfill_enqueue.py -q
..........                                                               [100%]
10 passed in 1.28s
```
(10 passed, 0 skipped — matches the acceptance criterion exactly.)

Per-item verdicts:

| # | Item | Verdict | Evidence |
|---|------|---------|----------|
| (a) | Idempotent re-run bail — pre-check pending `derive_broker_dailies` (api_key_id NOT NULL, count="exact") → returns 0 + "skipping to avoid duplicates" | **SATISFIED** | `phase35_backfill_enqueue.py` L53-76 (`.eq("kind","derive_broker_dailies").eq("status","pending").not_.is_("api_key_id","null")`, bails when `pending_count > 0`); pinned by `test_pending_jobs_present_skips_enqueue` (asserts `insert_calls==0` + the skip message) + `test_precheck_scopes_to_api_key_derive_jobs` (asserts the `not_is api_key_id null` filter). |
| (b) | Rule-12 fail-loud — `existing.count is None` RAISES; `rows.data is None` RAISES (guard never skipped blind) | **SATISFIED** | Script L64-69 (count-None RuntimeError) + L91-96 (data-None RuntimeError); pinned by `test_none_pending_count_raises_not_skips_guard` (`pytest.raises(RuntimeError, match="count came back\\s+None")`) + `test_api_keys_none_data_raises`. |
| (c) | Malformed rows skipped + non-zero exit | **SATISFIED** | Script L112-131 (defensive `.get("id")`, skip on missing/empty/non-str) + L180-181 (`if skipped … return 1`); pinned by `test_malformed_rows_skipped_valid_rows_enqueued` (2/5 enqueued, rc!=0) + `test_all_rows_malformed_no_insert` (0 insert, rc!=0). |
| (d) | Race safety — single atomic bulk INSERT aborts wholly on the (api_key_id, kind) in-flight partial unique index (23505), 0 enqueued, rc!=0 | **SATISFIED** | Script L139-170 (one `.insert(payload)`, narrow-catch 23505 → `raced=True`, atomic rollback) + L180 union check; pinned by `test_duplicate_race_aborts_atomically_zero_enqueued` (0/3, "23505" in output, rc!=0) + `test_non_race_bulk_failure_returns_nonzero`. |
| (e) | Step-5 SQL fan-out idempotency — `enqueue_derive_broker_dailies_for_allocator_keys()` advisory lock + per-(api_key_id, UTC-date) key | **SATISFIED (read-verified)** | `supabase/tests/test_claim_kind_filter.sql` Part 3 (L182-218) double-invokes the fn and asserts exactly 1 in-flight per key ("FLIPRETRY-04 OK: double fan-out is idempotent"); `test_derive_allocator_keys_fanout.sql` (L53 proc-exists, L83/L109 fan-out invokes, session advisory lock noted L25). SQL gates run against the DB projects, not local CI — verified by reading per the plan. |
| (f) | Rollback documented AND executable — Step 8 verbatim v1.11 recovery + abort path from every live step | **SATISFIED** | `docs/runbooks/flipretry-derived-equity-go-live.md` Step 8 (L175-192): DELETE compute_jobs scoped to `('derive_broker_dailies','derive_allocator_equity')` × `('pending','running')`, `DELETE FROM allocator_equity_derived`, `cron.unschedule('derive-allocator-key-dailies')`, plus the `WORKER_CLAIM_ROLE=all` restore note. Abort paths: Step 0 global "Abort at any step below → Step 8" (L39); Steps 1/2/3/4/5 each carry an explicit abort line. |

Runbook grep gates (all green):
```
grep -c "DELETE FROM allocator_equity_derived"  → 1
grep -c "cron.unschedule('derive-allocator-key-dailies')" → 1
grep -c "DELETE FROM compute_jobs" → 2
```

`git status --short` after the task: clean — no modification to `phase35_backfill_enqueue.py`, its test file, or the runbook.

## Task 2 — Display-gate intact check (ROADMAP criterion 4)

**Verdict: SATISFIED. Zero edits.**

Live command:
```
$ npx vitest run src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts --no-file-parallelism
 Test Files  2 passed (2)
      Tests  116 passed (116)
```
(No `--no-file-parallelism` flake; a deterministic failure here would have been a phase-blocking regression to surface — none occurred.)

Read-confirmation on-branch:
- `extractTrustworthyDerivedCurve` (`src/lib/queries.ts` L2455-2484) still enforces the full gate: `is_trustworthy !== true → null` (L2460), strict `^\d{4}-\d{2}-\d{2}$` date (L2472), finite `equity_usd` (L2473), and empty-curve → null (L2484, degrades an honest-empty `{curve:[], is_trustworthy:true}` to legacy).
- The flip site (L2591-2592) derives `equityCurveSource` solely from `derivedCurve !== null ? "derived" : "legacy"` — an untrustworthy/absent/malformed/empty payload renders the legacy basis byte-unchanged.

Criterion-4 evidence fixtures cited: `queries.test.ts` FLIPRETRY-03 describe block (L1155, "derivePhase07Fields — is_trustworthy → equityCurveSource flip") + the `queries.my-allocation.test.ts` Phase-115.1 display-repoint block (L123+, L2544+) carrying the legacy-fallback cases with `legacyExpectedDailyPoints()` (L2600) as the byte-unchanged reference.

`git status` shows `src/lib/queries.ts` untouched by this task.

## Task 3 — FLIP-01: founder live prod backfill enqueue (E2GT-gated)

**Disposition: DEFERRED → human_needed-OPEN. NOT simulated, NOT CI-claimed, NOT partial-credited.**

FLIP-01 is a founder LIVE op: the production backfill enqueue re-attempted on the Phase-125 dedicated worker, proving the v1.11 wedge is gone (prod healthz never stale past the restart threshold throughout the backfill). It requires founder-provisioned prod access (Railway two-service cutover + prod SQL) and is GATED on E2GT-01 (the live E2 ground-truth anchor-consistency run), which is itself still `human_needed`-OPEN from Phase 127. Per the standing autonomous-campaign decision ("keep building code, model live ops"), this op is DEFERRED rather than paused-on.

**Delivered execution path (the modeling obligation, acceptance-criterion 2):** `docs/runbooks/flipretry-derived-equity-go-live.md`, in order —
- Step 0: preconditions + topology confirm.
- Steps 1-2: cutover (backfill service up, `WORKER_CLAIM_ROLE=backfill`, CMD `python -m main_worker`; prod worker → `interactive`). *NOTE: Phase-125 WORKER-01 records this cutover human_needed-OPEN — it happens as part of this op.*
- Step 3: pilot enqueue (ONE heavy key), prod healthz stays 200/fresh.
- Step 4: E2GT-01 LIVE gate — exit 0 **AND** `anchor_consistency.within_same_day_tolerance === true`. No green, no flip. Never widen `--same-day-drift-tol`.
- Step 5: full backfill `SELECT enqueue_derive_broker_dailies_for_allocator_keys();` — FLIP-01 evidence contract = dedicated worker drains the queue while prod healthz never goes stale.
- Any abort → Step 8 ROLLBACK (verbatim v1.11 recovery; 0 user impact). Step 6 cron reschedule is WORKER-03, dead LAST, NOT required for FLIP-01.

**FLIP-01 evidence contract (what "done" requires, when the founder runs it):** healthz observations spanning the entire backfill window (never stale past the restart threshold) + the drained queue + `allocator_equity_derived` repopulating. Until then, FLIP-01 is recorded human_needed-OPEN in REQUIREMENTS + STATE, explicitly gating Phase 130 GOLIVE.

## Deviations from Plan

None — plan executed exactly as written. Both audit tasks returned all-SATISFIED verdicts with zero edits (the expected ponytail outcome); no genuine coverage gap was found, so no minimal fill was made. FLIP-01 dispositioned per the pre-decided DEFER path.

## Known Stubs

None. This phase added no code; it audited existing load-bearing, tested code.

## Requirements Disposition

- **FLIP-02** → SATISFIED (marked `[x]` in REQUIREMENTS.md) — live pytest + SQL-gate read-verify + runbook grep evidence.
- **FLIP-01** → human_needed-OPEN (stays `[ ]`, annotated) — founder LIVE op gated on E2GT-01; gates Phase 130 GOLIVE. NEVER claimed done without live healthz-fresh-throughout evidence.

## Self-Check: PASSED

- `analytics-service/scripts/phase35_backfill_enqueue.py` — FOUND (read, unmodified).
- `analytics-service/tests/test_phase35_backfill_enqueue.py` — FOUND (10 passed, 0 skipped).
- `docs/runbooks/flipretry-derived-equity-go-live.md` — FOUND (Step 8 grep gates green, unmodified).
- `supabase/tests/test_claim_kind_filter.sql` + `test_derive_allocator_keys_fanout.sql` — FOUND (fan-out idempotency gates present).
- `src/lib/queries.ts` — FOUND (gate intact L2455-2484 + L2591-2592, unmodified).
- `.planning/phases/129-.../129-01-SUMMARY.md` — this file.
- No source commit expected (commit_docs=false, zero tracked-file edits); `git status` clean.
