---
phase: 95-stitch-progress-transparency
verified: 2026-07-12T03:10:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
advisory_non_blocking:
  - test: "Live 3-key composite stitch in the browser — per-key panel renders Successful/In process/Waiting/Degraded with correct key identity"
    expected: "Panel appears during the stitch; copy reads 'Trades are being downloaded…/processed…'; no debug strategy_id block"
    why_human: "Live client React hydration + a real worker stitch; headless cannot hydrate authed wizard state (reference_browse_no_hydrate_authed)"
  - test: "Real worker restart/OOM mid-stitch (or a >12-min-stale heartbeat) surfaces the amber interrupted banner + working Retry CTA"
    expected: "Interrupted banner within the 15-min patience window; Retry re-POSTs /api/keys/sync idempotently; polling continues"
    why_human: "Requires inducing a real mid-run worker interruption against live infra — not reproducible offline"
---

# Phase 95: Stitch Progress Transparency — Verification Report

**Phase Goal:** A user watching the stitch sees honest, per-key, user-facing progress — and an interrupted stitch surfaces as recoverable instead of an indefinite hang.
**Verified:** 2026-07-12
**Status:** PASSED (4/4 success criteria observably true in code + backed by green tests)
**Re-verification:** No — initial verification
**Branch:** gsd/v1.9.1-composite-onboarding-hardening

## Goal Achievement — Success Criteria

| # | Success Criterion | Status | Evidence |
| --- | --- | --- | --- |
| PROG-01 | User-facing in-progress copy; internal `"Stitching composite…"` gone from user surface | ✓ VERIFIED | `SyncPreviewStep.tsx:1575-1577` phase-aware copy ("Trades are being processed…" / "downloaded…"); `grep -c "Stitching composite"` = **0** |
| PROG-02 | Worker writes per-member progress → route surfaces → wizard renders; debug block gone | ✓ VERIFIED | Full chain traced (write→RPC→route→fetch→render); debug `expandLog`/`strategy_id=` = **0** |
| PROG-03 | Mid-stitch restart/OOM visible + recoverable within patience; stall distinct, never indefinite hang | ✓ VERIFIED | `stalled` off JOB heartbeat (route:195-200); 12-min threshold < 15-min patience; interrupted banner + idempotent retry CTA |
| UX-03/#46 | Both surfaces poll through ONE `useStrategySyncPoller`; duplicated loop removed, no behavior change | ✓ VERIFIED | Hook drives both; 5 zero-edit pins green byte-untouched; neither surface has its own analytics poll loop |

**Score:** 4/4 verified.

## PROG-02 Full-Chain Trace (hardest-first — the "wired not just built" check)

| Boundary | Evidence | Status |
| --- | --- | --- |
| Worker WRITE | `job_worker.py:3354` `_write_member_progress` closure; boundary writes at `:3390` (all-waiting), `:3397` (in_process), `:3468/3486` (degraded), `:3531/3606` (successful) | ✓ FLOWING |
| Cash-pass-only scoping (SC-4) | `_reconstruct_all(cash_pnl_basis, report_progress=True)` at `:3612`; MTM call `:3795` is default `False` — counter never restarts | ✓ VERIFIED |
| RPC (fenced merge) | `set_compute_job_progress` (mig `20260712130000`): `COALESCE(metadata,'{}') \|\| jsonb_build_object('member_progress',…,'member_progress_at',now())`; fence `claim_token IS NOT DISTINCT FROM … AND claim_token IS NOT NULL AND status='running'`; `REVOKE … FROM PUBLIC,anon,authenticated; GRANT service_role` | ✓ VERIFIED |
| Route SURFACE | `route.ts:136-139` calls `get_user_compute_jobs`; `:159-167` picks latest `stitch_composite` by created_at; `:179-187` field-by-field projection | ✓ VERIFIED |
| Wizard FETCH | `SyncPreviewStep.tsx:607` `fetch(/api/strategies/${strategyId}/sync-progress)` piggybacked inside the hook `onStatus` tick, composite-only, fail-open | ✓ WIRED |
| Wizard RENDER | `:1587-1625` `<ul data-testid="wizard-member-progress">` renders `member-progress-{seq}` rows with `Key {seq}` identity + status chip | ✓ FLOWING |

The route is **not** an orphan — the wizard fetches it every poll tick and renders `memberProgress`. Confirmed end-to-end.

## Adversarial Checks (from the verification brief)

| Concern | Finding | Status |
| --- | --- | --- |
| Secretless end-to-end | Worker builds entries field-by-field (`:3436-3437`, never a `key_row` spread); RPC merges only `member_progress`/`member_progress_at`; route projects a fixed 4-field whitelist (`route.ts:179-187`) and never spreads the RPC row/metadata. Route test serializes the 200 body and asserts absence of all 5 ciphertext columns + `correlation_id`/`source`/`metadata` (`route.test.ts:238-262`). Worker Test 5 recursively walks payloads for ciphertext keys. | ✓ No ciphertext can reach the browser |
| Stall keys off JOB, not `strategy_analytics` | `heartbeat = metadata.member_progress_at ?? claimed_at` (`route.ts:195-196`); `grep strategy_analytics route.ts` = **CLEAN**. Route test RT-1 structural pin asserts `fromCalls` never contains `"strategy_analytics"` (`route.test.ts:179/189` + pin). An RT-1 pending-after-complete row cannot be seen. | ✓ VERIFIED (pinned) |
| Hook extraction preserved behavior | 5 pre-existing pins pass **byte-untouched** across the phase (`git diff ada310ff^ HEAD` empty for the 4 frozen test files). Wizard kickoff/WIZ-05 (`:347-492`), heavy terminal arms (onTerminal closure), `heavyFetchErrors` escalation (component ref), R2-5 repoll, and the 95-04 piggyback all stayed in the wizard; hook owns only scheduling + read + counters. | ✓ VERIFIED |
| SC-4 byte-identity | 4 parity suites green (`test_stitch_composite_job.py`, `test_golden_parity.py`, `test_metrics_parity.py`, `test_composite_headline_parity.py`) = **103 passed**; the 3 pure-parity files have zero edits. | ✓ VERIFIED |
| 12-min threshold inside 15-min patience | `STALL_THRESHOLD_MS = 720_000` (12 min); `RETRY_THRESHOLD_MS = 900_000` (15 min). A genuine stall surfaces at 12 min, before the 15-min give-up. A healthy run with a slow (>12-min) single member CAN false-positive, but low-harm: retry re-POST is a no-op via `compute_jobs_one_inflight_per_kind_strategy` (T-95-09, documented/accepted). | ✓ VERIFIED (accepted tradeoff) |
| Full suite green — limiter classification | The 95-05-flagged gap (sync-progress route unclassified) was closed by commit `f5967276`: `limiter-ordering.test.ts:142` now lists `strategies/[id]/sync-progress/route.ts`; suite green. | ✓ CLOSED |

## Required Artifacts

| Artifact | Status | Details |
| --- | --- | --- |
| `SyncProgress.poll.test.tsx` | ✓ VERIFIED | 272 lines, characterization pins green |
| `migrations/20260712130000_set_compute_job_progress.sql` | ✓ VERIFIED | Fenced SECURITY DEFINER RPC, latest migration (no collision), service-role-only |
| `tests/test_set_compute_job_progress.sql` | ✓ VERIFIED | ROLLBACK-hygienic, uuid-scoped, `has_function_privilege` privilege gate + key-survival asserts |
| `job_worker.py` (`_reconstruct_all`) | ✓ VERIFIED | Fail-open, cash-pass-only, secretless boundary writes |
| `src/lib/sync-progress.ts` | ✓ VERIFIED | Contract + `STALL_THRESHOLD_MS=720_000` + `coerceMemberProgressStatus` |
| `sync-progress/route.ts` | ✓ VERIFIED | Secretless owner-scoped projection; stall off JOB |
| `sync-progress/route.test.ts` | ✓ VERIFIED | 534 lines; owner/non-owner/secretless/RT-1/stall pins |
| `SyncPreviewStep.progress.render.test.tsx` | ✓ VERIFIED | 414 lines, 10 tests: panel/copy/interrupted/debug-gone |
| `useStrategySyncPoller.ts` | ✓ VERIFIED | 284 lines; both schedule modes; no surface-specific knowledge |

## Behavioral Spot-Checks (tests executed by the verifier)

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| FE suites (SyncProgress pins, route, limiter-ordering, wizard steps) | `npx vitest run …` | 17 files / **196 passed** | ✓ PASS |
| SC-4 parity + member progress | `pytest … 4 parity files` | **103 passed** | ✓ PASS |
| Member-progress group (write/secretless/fail-open/pass-scope) | `pytest -k member_progress` | **6 passed** | ✓ PASS |
| Type check | `npx tsc --noEmit` | exit 0 | ✓ PASS |

## Anti-Patterns Found

None. `grep TBD/FIXME/XXX` across all 7 phase-modified source files = clean. No stubs — panel/copy/interrupted state all wired to live route/poll data (`syncProgress` is null only on the by-design single-key path).

## Requirements Coverage

| Requirement | Description | Status | Evidence |
| --- | --- | --- | --- |
| PROG-01 | User-facing copy, `"Stitching composite…"` gone | ✓ SATISFIED | Copy gate = 0; phase-aware strings |
| PROG-02 | Per-member write → route → render; debug gone | ✓ SATISFIED | Full chain traced + tests green |
| PROG-03 | Interrupted stitch visible + recoverable in patience window | ✓ SATISFIED | JOB-heartbeat stall, 12<15 min, retry CTA |
| UX-03 (#46) | One shared `useStrategySyncPoller`; no behavior change | ✓ SATISFIED | 5 zero-edit pins green |

## Live Corroboration — NON-BLOCKING (advisory)

Per the plans' own live-corroboration notes (95-04 verification §, and MEMORY: live-GUI onboarding is a user gate), the following require human/live eyes and are **NON-BLOCKING** to this verdict — every automated must-have is already VERIFIED with green tests:

1. **Live 3-key composite stitch (browser QA)** — confirm the per-key panel + phase-aware copy land in the hydrated wizard (headless cannot hydrate authed client React).
2. **Real worker restart/OOM interruption** — confirm the amber interrupted banner + working Retry CTA surface on a genuine mid-run interruption within the 15-min window.

These are dogfooding corroboration of behavior already proven correct by unit/render/route tests; they do not gate goal achievement in code.

## Gaps Summary

None. All four success criteria are observably true in the codebase and backed by green offline tests. The one phase-level gap flagged during execution (limiter-ordering classification for the new route) was closed by commit `f5967276`. The PROG-02 chain is fully wired (route is consumed, not orphaned); the secretless boundary holds at all three layers; the stall flag derives exclusively from the job heartbeat (RT-1 safe); SC-4 byte-identity is preserved; and the #46 hook extraction is behavior-preserving by the zero-edit green-pin method.

---

_Verified: 2026-07-12T03:10:00Z_
_Verifier: Claude (gsd-verifier)_
