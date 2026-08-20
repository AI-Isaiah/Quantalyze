---
phase: 129-flip-derived-curve-flip-retry-on-the-hardened-worker
verified: 2026-07-19T21:49:22Z
status: passed
score: 4/4 must-haves verified (3 automated-VERIFIED + FLIP-01 correctly-dispositioned human_needed-OPEN)
overrides_applied: 0
re_verification:
  previous_status: none
  note: "Initial verification"
human_verification:
  - test: "FLIP-01 — production backfill enqueue on the dedicated worker"
    expected: "Worker healthz never goes stale past the restart threshold throughout the full backfill (the v1.11 wedge disproven live); queue drains; allocator_equity_derived repopulates"
    why_human: "Founder LIVE prod op requiring Railway two-service cutover + prod SQL; GATED on E2GT-01 (also human_needed-OPEN). Per the phase design this is DEFERRED and honestly recorded human_needed-OPEN — NOT a defect. Delivered execution path = docs/runbooks/flipretry-derived-equity-go-live.md Steps 0-5 + Step 8 abort. Explicitly gates Phase 130 GOLIVE."
---

# Phase 129: FLIP — derived-curve retry on the hardened worker — Verification Report

**Phase Goal:** The v1.11-rolled-back derived-allocator-equity flip is re-attempted SAFELY — the production backfill enqueue runs on the Phase-125 hardened dedicated worker AFTER Phase-127 E2 validation, completes without wedging, and is trivially rollbackable.

**Verified:** 2026-07-19T21:49:22Z
**Status:** passed
**Re-verification:** No — initial verification

This is a VERIFICATION/AUDIT phase. A ZERO-edit outcome is the EXPECTED correct result — the FLIP groundwork was built and tested in Phases 123/125/127 (v1.11/v1.12). The phase's deliverable is (a) live-evidence verification of the FLIP-02 groundwork, (b) a display-gate-intact proof, and (c) an HONEST disposition of the FLIP-01 founder live op. All three are met, verified independently below (SUMMARY claims re-run in this verifier's own process, not trusted).

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Enqueue is idempotent / safe to re-run — a re-run bails when pending api_key derive jobs exist; Rule-12 fail-louds; 23505 race aborts atomically (FLIP-02) | ✓ VERIFIED | `.venv/bin/python -m pytest tests/test_phase35_backfill_enqueue.py -q` → **10 passed, 0 skipped** (re-run in this verifier's process). Tests are substantive AND match the script impl (both read): pre-check bail (`phase35_backfill_enqueue.py` L53-76, `.eq("kind","derive_broker_dailies").eq("status","pending").not_.is_("api_key_id","null")`, bails w/ "skipping to avoid duplicates"); count-None RAISE (L64-69) pinned by `test_none_pending_count_raises_not_skips_guard` (`pytest.raises(RuntimeError, match="count came back None")`); data-None RAISE (L91-96) pinned by `test_api_keys_none_data_raises`; malformed skip + rc!=0 (L112-131, L180) pinned by `test_malformed_rows_skipped_valid_rows_enqueued` (2/5, rc!=0) + `test_all_rows_malformed_no_insert`; single atomic bulk INSERT + narrow-catch 23505 → 0 enqueued rc!=0 (L139-170) pinned by `test_duplicate_race_aborts_atomically_zero_enqueued`. |
| 2 | Rollback is documented AND executable per the runbook — delete flip jobs + empty allocator_equity_derived + unschedule the cron, reachable via an abort path from every live step (FLIP-02) | ✓ VERIFIED | `docs/runbooks/flipretry-derived-equity-go-live.md` Step 8 (L175-192, read): `DELETE FROM compute_jobs WHERE kind IN ('derive_broker_dailies','derive_allocator_equity') AND status IN ('pending','running')` (correctly scoped to the 2 flip kinds × pending/running); `DELETE FROM allocator_equity_derived`; `SELECT cron.unschedule('derive-allocator-key-dailies')`; + `WORKER_CLAIM_ROLE=all` restore note. Grep gates green: allocator_equity_derived×1, cron.unschedule×1, compute_jobs×2. Abort paths present at Step 0 (global "Abort at any step → Step 8", L39) + Steps 1/2/3/4/5 each carry an explicit abort line (L62/71/91/129/144). |
| 3 | Post-flip, derived curves reach users ONLY through the Phase-127 trustworthy gate — an untrustworthy/absent/malformed/empty curve leaves the legacy basis rendering (data-driven, no flag) | ✓ VERIFIED | `npx vitest run src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts --no-file-parallelism` → **2 files / 116 tests passed** (re-run in this verifier's process, no flake). `extractTrustworthyDerivedCurve` (`src/lib/queries.ts` L2455-2484, read) still enforces `is_trustworthy !== true → null` (L2460), strict `^\d{4}-\d{2}-\d{2}$` date (L2472), finite `equity_usd` (L2473), empty-curve → null degrade to legacy (L2484). Flip site (L2591-2592, read) derives `equityCurveSource` solely from `derivedCurve !== null ? "derived" : "legacy"` — untrustworthy/absent/malformed/empty renders legacy byte-unchanged. |
| 4 | FLIP-01 (the live prod backfill enqueue, healthz-fresh-throughout) is either founder-evidenced OR explicitly recorded human_needed-OPEN — NEVER silently claimed done | ✓ VERIFIED (honest disposition) | `.planning/REQUIREMENTS.md` L50 FLIP-01 = `[ ]` (open) annotated "human_needed-OPEN … DEFERRED — founder LIVE op … GATED on E2GT-01 (still human_needed-OPEN) … NEVER claimed done without healthz-fresh-throughout + queue-drained + allocator_equity_derived-repopulating live evidence … gates Phase 130 GOLIVE." E2GT-01 confirmed still open (REQUIREMENTS L40 `[ ]`). STATE.md L107/L117 records the same. NOT simulated, NOT CI-derived, NOT partial-credited. |

**Score:** 4/4 truths verified (Truths 1-3 automated-VERIFIED; Truth 4 = the honest disposition, itself verified against REQUIREMENTS + STATE).

### Roadmap Success-Criteria Mapping

| SC | Criterion | Maps to | Status |
|----|-----------|---------|--------|
| 1 | FLIP-01 prod enqueue completes without wedging (founder-run op) | Truth 4 | Correctly dispositioned human_needed-OPEN (founder live op, gated on E2GT-01) — see Human Verification |
| 2 | Enqueue idempotent / safe to re-run (FLIP-02) | Truth 1 | ✓ VERIFIED |
| 3 | Rollback documented AND executable (FLIP-02) | Truth 2 | ✓ VERIFIED |
| 4 | Derived curves reach users only via the trustworthy gate | Truth 3 | ✓ VERIFIED |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/scripts/phase35_backfill_enqueue.py` | Idempotent enqueue (pre-check bail + atomic bulk INSERT + 23505 rollback + Rule-12 fail-louds) | ✓ VERIFIED | Read in full — all behaviors present & load-bearing; contains "skipping to avoid duplicates". Unmodified this phase. |
| `analytics-service/tests/test_phase35_backfill_enqueue.py` | Idempotency + fail-loud suite | ✓ VERIFIED | 10 substantive tests, all passing; non-vacuous asserts pin script behavior. Contains `test_pending_jobs_present_skips_enqueue`. Unmodified. |
| `docs/runbooks/flipretry-derived-equity-go-live.md` | Executable FLIP runbook + Step-8 ROLLBACK | ✓ VERIFIED | Step 8 rollback complete & correctly scoped; abort paths at every step; contains `cron.unschedule('derive-allocator-key-dailies')`. Unmodified. |
| `supabase/tests/test_claim_kind_filter.sql` | Fan-out double-invoke idempotency gate | ✓ VERIFIED (read) | Part 3 (L182-218) double-invokes `enqueue_derive_broker_dailies_for_allocator_keys()`, asserts exactly 1 in-flight per key ("FLIPRETRY-04 OK"). SQL gates run against DB projects, not local CI. |
| `supabase/tests/test_derive_allocator_keys_fanout.sql` | Fan-out eligibility + in-flight dedup | ✓ VERIFIED (read) | Proc-exists (L53), double-invoke dedup (L83/L109), session advisory lock noted (L25). |
| `src/lib/queries.ts` | Trustworthy gate + equityCurveSource flip | ✓ VERIFIED | Gate intact L2455-2484; flip site L2591-2592. Unmodified. |
| `.planning/phases/129-.../129-01-SUMMARY.md` | Per-item audit verdict + FLIP-01 disposition | ✓ VERIFIED | Present, complete, and its claims independently confirmed. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| `phase35_backfill_enqueue.py` | compute_jobs pending pre-check | `count='exact'` select + `not_.is_("api_key_id","null")` | ✓ WIRED | L54-58; pinned by `test_precheck_scopes_to_api_key_derive_jobs`. |
| runbook Step 8 | `allocator_equity_derived` | rollback DELETE (TS flip renders legacy on empty) | ✓ WIRED | L186; TS-side legacy-on-empty proven by `extractTrustworthyDerivedCurve` L2484. |
| `extractTrustworthyDerivedCurve` | equityCurveSource flip site (~L2591) | `derivedCurve !== null ? "derived" : "legacy"` | ✓ WIRED | L2581 (call) → L2591-2592 (source derivation) → L2658 (returned). |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Enqueue idempotency + fail-loud + race suite | `.venv/bin/python -m pytest tests/test_phase35_backfill_enqueue.py -q` | 10 passed in 1.18s | ✓ PASS |
| Display-gate fixtures (criterion 4) | `npx vitest run src/lib/queries.test.ts src/lib/queries.my-allocation.test.ts --no-file-parallelism` | 2 files / 116 tests passed | ✓ PASS |
| Runbook rollback SQL ops present | `grep -c` (3 gates) | allocator_equity_derived=1, cron.unschedule=1, compute_jobs=2 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| FLIP-02 | 129-01 | Idempotent enqueue + documented/executable rollback | ✓ SATISFIED | REQUIREMENTS L51 `[x]`; Truths 1-2; 10 pytest + runbook grep gates green |
| FLIP-01 | 129-01 | Live prod backfill enqueue without wedging | ? NEEDS HUMAN (correctly recorded) | REQUIREMENTS L50 `[ ]` human_needed-OPEN; founder live op gated on E2GT-01; gates Phase 130 |

### Anti-Patterns Found

None. Debt-marker scan (TBD/FIXME/XXX/HACK/PLACEHOLDER/"not yet implemented"/"coming soon") on the three load-bearing files returned clean. `git status` clean — zero source edits (the expected ponytail outcome; NOT flagged as a defect for a verification phase).

### Human Verification Required

**1. FLIP-01 — production backfill enqueue on the dedicated worker (founder LIVE op)**

- **Test:** Execute `docs/runbooks/flipretry-derived-equity-go-live.md` Steps 0-5 in order (cutover → pilot → E2GT-01 two-part gate → full backfill), Step 8 abort at any failure.
- **Expected:** The dedicated backfill worker drains the queue while the prod worker's healthz NEVER goes stale past the restart threshold throughout the entire backfill (the exact v1.11 failure mode, disproven live); `allocator_equity_derived` repopulates.
- **Why human:** Founder-provisioned prod access (Railway two-service cutover + prod SQL); GATED on E2GT-01 (itself human_needed-OPEN). This is the CORRECT, expected disposition per the phase design — not a gap. It is already recorded human_needed-OPEN in REQUIREMENTS + STATE and explicitly gates Phase 130 GOLIVE.

### Gaps Summary

No gaps. This verification phase achieved its goal: the FLIP-02 groundwork is confirmed idempotent + fail-loud + atomically race-safe with live pytest evidence and a correctly-scoped executable Step-8 rollback; the Phase-127 display gate is intact on-branch (116 vitest pass, gate + flip site read-confirmed load-bearing); and FLIP-01 is HONESTLY dispositioned as human_needed-OPEN — never simulated, CI-claimed, or partial-credited. Zero manufactured work; zero source edits, matching the audit-then-fill (ponytail) discipline. The single human item (FLIP-01) is a founder live op by design and correctly gates Phase 130 rather than this phase.

---

_Verified: 2026-07-19T21:49:22Z_
_Verifier: Claude (gsd-verifier)_
