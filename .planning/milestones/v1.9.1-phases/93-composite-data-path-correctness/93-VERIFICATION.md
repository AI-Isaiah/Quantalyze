---
phase: 93-composite-data-path-correctness
verified: 2026-07-11T21:30:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  note: initial verification
---

# Phase 93: Composite Data-Path Correctness Verification Report

**Phase Goal:** The data a composite is built from is captured, persisted, and reconstructed honestly — entered windows survive, the chart can never disagree with the headline, and non-Deribit members stop being a hard limitation.
**Verified:** 2026-07-11T21:30:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 (SC-1, HARD-02) | First member key's entered window persisted end-to-end, never "–"/Days 0; regression test fails without the fix | ✓ VERIFIED | `buildSetMembersKeys` wired (MultiKeyConnectStep.tsx def:180, call:532); route value-pins `members[0..2].window_start` (route.test.ts:186-188 → "2025-08-01"/"2025-10-01"/"2025-12-01"); windowText three-tier fallback (SyncPreviewStep.tsx:1245-1250 — declared window when per_key coverage absent). Display Test 1 RED-before documented (renders "—" pre-fix). 85 frontend tests pass. Closure on offline contract; live repro documented NON-BLOCKING (accepted). |
| 2 (SC-2, HARD-03) | Composite persists cumulative_method at stitch; chart prefers persisted over live re-derive; edit-without-restitch can't make chart disagree with headline | ✓ VERIFIED | `merged_flags["cumulative_method"] = cumulative_method` unconditional drop-stale at job_worker.py:3868 (exactly 1 persist site, comments excluded); read-path prefer-persisted-with-fallback (composite-read-path.ts:115-121, strict-literal "simple"→arithmetic / "geometric", else `attributionBasisFromConfig`). 3 cumulative_method tests pass; both drift-kill directions pinned. Older composites byte-identical via fallback. |
| 3 (SC-3, HARD-05) | Composite spanning Bybit/OKX/Binance reconstructs honestly OR degrades with visible DQ reason — never fail-loud PERMANENT | ✓ VERIFIED | PERMANENT fence GONE (`grep "Deribit-only this phase"` == 0). Three-way routing (job_worker.py:3315-3407): ccxt → try `_reconstruct_ccxt_member` (composes derive primitives verbatim, 3139-3238) then degrade `reason:"reconstruction_failed"`; 429/geo → TRANSIENT; unknown venue → PERMANENT structural fail. Zero-member floor fail-loud (3475 "No composite member could be reconstructed"). Byte-consistency rtol 1e-12 test passes (test:1087). `parseDegradedMembers` strict coercion (read-path.ts:192-203); both render surfaces wired (FactsheetView.tsx:892-903 hero caveat; SyncPreviewStep.tsx:1349-1376 amber block). 42 stitch tests pass. |
| 4 (SC-4) | Existing composites + single-key strategies byte-identical (parity pin) | ✓ VERIFIED | Parity set + broker_dailies: **86 passed**. All phase-93 diff hunks confined to `run_stitch_composite_job` (+ venue constant @2795); `run_derive_broker_dailies_job` (~1941-2560) untouched. No migration (`git status --porcelain supabase/migrations/` empty). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/job_worker.py` | cumulative_method persist + degrade/reconstruct routing + zero-member floor | ✓ VERIFIED | 1 cumulative_method site; `_reconstruct_ccxt_member` wired (2 refs); degrade/transient/permanent taxonomy real; merged_flags set/pop drop-stale (3853-3856) |
| `src/lib/factsheet/composite-read-path.ts` | prefer-persisted method + parseDegradedMembers | ✓ VERIFIED | Prefer-persisted (115-121); strict parseDegradedMembers (192-203); exposed on dataQuality.degradedMembers (146) |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | hero-strip degraded caveat | ✓ VERIFIED | Amber `<p>` gated on degradedMembers.length (892-903), plural pronoun handling |
| `SyncPreviewStep.tsx` | windowText fallback + amber degraded block | ✓ VERIFIED | Three-tier windowText (1245-1250); amber Data-quality block (1349-1376); hasDqCaveat OR-extended (1154) |
| `MultiKeyConnectStep.tsx` | exported buildSetMembersKeys | ✓ VERIFIED | Exported (180) + wired in handleContinue (532) |

### Key Link Verification

| From | To | Via | Status |
|------|-----|-----|--------|
| ccxt routing arm | `_reconstruct_ccxt_member` | try-reconstruct-then-degrade | ✓ WIRED (3328-3389) |
| `_reconstruct_ccxt_member` | combine_realized_and_funding / ccxt_rows_to_dated_flows / terminus | verbatim primitive reuse | ✓ WIRED (3139-3238) |
| worker cumulative_method decision | merged_flags persist | unconditional set | ✓ WIRED (3868) |
| read-path persisted method | buildOpts.cumulativeMethod | strict-literal + attributionBasisFromConfig fallback | ✓ WIRED (115-121) |
| degraded_members flag | both DQ render surfaces | dataQuality.degradedMembers | ✓ WIRED (FactsheetView + SyncPreviewStep) |

### Behavioral Spot-Checks (tests run in verifier process, pinned 3.12 venv)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Stitch composite full file | `.venv/bin/python -m pytest tests/test_stitch_composite_job.py -q` | 42 passed | ✓ PASS |
| cumulative_method regression | `pytest -k cumulative_method` | 3 passed | ✓ PASS |
| byte-consistency + degrade + transient + guard-union + floor | `pytest -k "byte_consistent or reconstructs_and_joins or structural_failure_degrades or rate_limit_is_transient or guard_flag_unions or no_member_reconstructed or unknown_venue"` | 7 passed | ✓ PASS |
| Parity set + broker_dailies (SC-4) | `pytest test_composite_headline_parity test_golden_parity test_metrics_parity test_broker_dailies` | 86 passed | ✓ PASS |
| Frontend HARD-02/03/05 suites | `npx vitest run` (6 files: read-path, payload, route, SyncPreview render, FactsheetView kpistrip, compositeAttribution) | 85 passed | ✓ PASS |
| Type check | `npx tsc --noEmit` | exit 0 | ✓ PASS |

_Byte-consistency assertion confirmed substantive: `persisted[day] == pytest.approx(ref_val, rel=1e-12, abs=0.0)` (test line 1087) against a direct-primitive reference series. Degrade tests assert closed key-set {seq,venue,reason} + fixed literal reason + no magnitude digits (leak discipline)._

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| HARD-02 | 93-02 | ✓ SATISFIED | Value-pinned both write-path links + display fix; regression tests present and green |
| HARD-03 | 93-01 | ✓ SATISFIED | Persist-at-stitch + prefer-persisted read; drift-kill both directions pinned |
| HARD-05 | 93-03 (degrade) + 93-04 (reconstruct) | ✓ SATISFIED | Fence removed; reconstruct-or-degrade, never PERMANENT for supported ccxt venue; zero-member floor fail-loud |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX debt markers in any phase-93 modified source file | — | Clean |

### Informational Observations (not gaps)

1. **SC-1 / REQUIREMENTS.md wording names `/api/keys/sync` as the write path**, but the verified-correct write path is the composite `set-members` route → `set_wizard_composite_members` RPC (research §HARD-02 corrected the mechanism). The SC *intent* (persistence + display honesty + regression test) is fully met via the actual write path; the path-name in the SC text is descriptively inaccurate, not an implementation gap. The plan/SUMMARY document this explicitly.
2. **Live ccxt canary (real Bybit/OKX/Binance keys) and HARD-02 live-composite repro are documented NON-BLOCKING corroboration gates** (mirrors the SC-3-piece-3 pattern in project memory). Per phase contract, their absence does not force `human_needed` — the offline contract + rtol-1e-12 byte-consistency pin + parity carry closure. These remain the user's optional live attestation; do not claim live-attested.

### Human Verification Required

None blocking. (Optional user corroboration: run the Railway ccxt canary with real read-only keys — explicitly non-blocking per phase design.)

### Gaps Summary

None. All four success criteria are observably true against the code and tests. HARD-03 persist+prefer-persisted verified with drift-kill tests; HARD-02 first-member window pinned by value on both links with the display defect fixed; HARD-05 PERMANENT fence removed with a real reconstruct-or-degrade taxonomy (byte-consistent to rtol 1e-12) and an honest fail-loud zero-member floor; SC-4 parity green (86) with the derive path byte-identical and no migration introduced.

---

_Verified: 2026-07-11T21:30:00Z_
_Verifier: Claude (gsd-verifier)_
