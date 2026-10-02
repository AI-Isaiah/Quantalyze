---
phase: 74-funnel-wiring-both-callers
verified: 2026-07-05T00:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
deferred:
  - truth: "Broker-path guard-flagged accounts render complete_with_warnings on the CSV analytics row"
    addressed_in: "Phase 75+"
    evidence: "ROADMAP.md marks Phase 74 COMPLETE and documents this as known architectural limitation; 74-04-SUMMARY.md decision: 'carrying the guard flag through run_csv_strategy_analytics would require touching analytics_runner.py (out of scope)'; complete_with_warnings IS produced on the run_strategy_analytics callsite (74-03)"
---

# Phase 74: Funnel Wiring — Both Callers — Verification Report

**Phase Goal:** Both branches of `transforms.trades_to_daily_returns_with_status` route through `nav_twr.reconstruct_nav_and_twr`; the silent fallback is DELETED on BOTH branches (daily_pnl `estimated_start<=0 -> account_balance` at transforms.py:154-159/:175 AND individual-trades zero-to-initial swap at :196-199/:211); every flow-less / estimated_start>0 account stays byte-identical at all four production call sites; guard-flagged accounts flip to `complete_with_warnings`; `NavReconstructionError` fails loud as permanent. Requirements TWR-03, TWR-04.
**Verified:** 2026-07-05
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Both branches (daily_pnl + individual-trades) delegate to `reconstruct_nav_and_twr` | VERIFIED | transforms.py:198 (daily_pnl branch) and :239 (individual-trades branch) both call `reconstruct_nav_and_twr`; lazy import at :115 |
| 2 | Silent fallback `estimated_start<=0 -> account_balance` DELETED on both branches | VERIFIED | `grep "initial_capital = account_balance" transforms.py` returns zero code hits (comment only); source-scan test `test_forbidden_daily_pnl_base_substitution_token_absent` (test_transforms.py:631) passes |
| 3 | Individual-trades `prev_equity.replace(0, initial_capital)` swap DELETED | VERIFIED | `grep "\.replace(0" transforms.py` returns zero code hits (comment only); source-scan test `test_forbidden_base_substitution_tokens_absent_both_branches` (test_transforms.py:708) passes |
| 4 | Flow-less / estimated_start>0 accounts produce byte-identical output (rtol=1e-12) | VERIFIED | All 4 snapshot pins GREEN: `test_byte_identical_daily_pnl_snapshot` (:426), `test_byte_identical_individual_snapshot` (:467), `test_byte_identical_heuristic_snapshot` (:512), `test_byte_identical_combine_snapshot` (test_broker_dailies.py:832) |
| 5 | Guard-flagged accounts flip to `complete_with_warnings` on the run_strategy_analytics path | VERIFIED | Guard-key lift loop at analytics_runner.py:1735-1742; promotion predicate ORs all three guard keys at :1813-1818; `test_status_guard_promotion_negative_nav_guard_lifts_and_promotes` (:2379) and `test_status_guard_promotion_dust_and_flow_guards_both_surface` (:2411) GREEN |
| 6 | `NavReconstructionError` fails loud as permanent at analytics_runner callsite | VERIFIED | Typed catch at analytics_runner.py:1937 (before generic `except Exception`); stamps `failed`; raises HTTPException(422); no `from exc` (prevents __cause__ leak); `test_nav_error_permanent_stamps_failed_and_raises_4xx` (:2497) GREEN |
| 7 | `NavReconstructionError` fails loud as permanent at job_worker broker callsite | VERIFIED | Typed catch at job_worker.py:2015; strategy-mode stamps scrubbed `failed`; returns `DispatchResult(outcome=FAILED, error_kind="permanent")`; `test_nav_error_permanent_strategy_mode_stamps_failed` (test_derive_broker_dailies_dualmode.py:318) GREEN |
| 8 | NaN-safe csv_daily_returns upsert: guarded-day NaN rows SKIPPED (never 0.0, never crash) | VERIFIED | `if pd.notna(val)` on is_key_mode branch (job_worker.py:2126) and strategy-mode branch (:2137); `test_nan_upsert_skips_guarded_days_strategy_mode` (:455) and `test_nan_upsert_skips_guarded_days_key_mode` (:483) GREEN |
| 9 | TWR-03 satisfied: fallback deleted, both branches honest | VERIFIED | REQUIREMENTS.md marks TWR-03 DONE (74-02); source-scan guards reintroduction; `test_daily_pnl_fallback_deletion_no_account_balance_substitution` (:616) and `test_individual_fallback_deletion_no_account_balance_substitution` (:692) GREEN |
| 10 | TWR-04 satisfied: both callers routed through core, byte-identity GREEN | VERIFIED | REQUIREMENTS.md marks TWR-04 DONE (74-02 + 74-03/74-04); `external_flows`/`open_unrealized_usd` params on both `trades_to_daily_returns_with_status` (transforms.py:83-90) and `combine_realized_and_funding` (broker_dailies.py:125-126); 4 byte-identity pins GREEN |

**Score:** 10/10 derived truths verified. ROADMAP formal success criteria: 4/4.

### Deferred Items

Items not yet met but explicitly accepted as architectural limitations for later phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Broker-path guard-flagged accounts stamp `complete` not `complete_with_warnings` on the csv_analytics row | Phase 75+ | `run_csv_strategy_analytics` re-reads `csv_daily_returns` (guarded days absent) without guard meta; `_mark_complete` overwrites `data_quality_flags` with `{csv_source: True}`; ROADMAP.md marks Phase 74 COMPLETE with this gap explicit; 74-04-SUMMARY decision: "complete_with_warnings IS produced on the run_strategy_analytics callsite (74-03)". Honesty guarantee IS met: no fabricated magnitude, no crash, guarded days absent from the table. |

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `services/transforms.py` | Both branches delegate to `reconstruct_nav_and_twr`; fallbacks deleted | VERIFIED | daily_pnl branch :198, individual-trades branch :239; no `initial_capital = account_balance` or `.replace(0` in code |
| `services/analytics_runner.py` | Guard-key DQF lift + promotion predicate + NavReconstructionError catch | VERIFIED | TypedDict extended (:170-172); lift loop (:1735-1742); predicate (:1813-1818); typed catch (:1937) |
| `services/job_worker.py` | NavReconstructionError permanent catch + NaN-safe upsert | VERIFIED | Typed catch at :2015; `if pd.notna(val)` at :2126 (key-mode) and :2137 (strategy-mode) |
| `services/broker_dailies.py` | `external_flows` + `open_unrealized_usd` params forwarded | VERIFIED | Signature at :125-126; forwarded at :145-146 |
| `services/nav_twr.py` | `reconstruct_nav_and_twr` + `NavReconstructionError` (Phase 73) | VERIFIED | Both present; `NavReconstructionError` imported at analytics_runner.py:60 (module-level) and job_worker.py:1829 (function-level) |
| `tests/test_transforms.py` | 4 byte-identity snapshot pins + 4 mutation-honest source-scan pins | VERIFIED | All 8 tests GREEN in full suite run |
| `tests/test_analytics_runner.py` | Guard promotion (3) + no-guard invariant (1) + permanent catch (2) | VERIFIED | All 6 targeted tests GREEN |
| `tests/test_derive_broker_dailies_dualmode.py` | NavReconstructionError broker-path (2) + narrow-catch (1) + NaN-upsert (2) | VERIFIED | All 5 targeted tests GREEN |
| `tests/test_csv_analytics_runner.py` | NaN tolerance (1) + serialization-fails-loud (1) + e2e honesty (1) | VERIFIED | All 3 targeted tests GREEN |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `transforms.py:198` | `nav_twr.reconstruct_nav_and_twr` | lazy import at :115 | WIRED | daily_pnl branch call confirmed |
| `transforms.py:239` | `nav_twr.reconstruct_nav_and_twr` | same lazy import | WIRED | individual-trades branch call confirmed |
| `analytics_runner.py:1735-1742` | `data_quality_flags` guard keys | reads `returns_meta`, writes present-and-True keys | WIRED | loop lifts negative_nav_guard / dust_nav_guard / flow_dominated_guard |
| `analytics_runner.py:1813-1818` | `computation_status = "complete_with_warnings"` | `consumer_specific_flags` OR includes guard keys | WIRED | predicate ORs all 3 guard keys; no-guard runs stay `complete` |
| `analytics_runner.py:1937` | `HTTPException(422)` permanent | `except NavReconstructionError` before generic catch | WIRED | scrubs msg; no `from exc`; narrow to typed subclass |
| `job_worker.py:2015` | `DispatchResult(outcome=FAILED, error_kind="permanent")` | `except NavReconstructionError` wrapping combine call | WIRED | strategy-mode stamps scrubbed `failed`; key-mode skips stamp |
| `job_worker.py:2126/:2137` | csv_daily_returns upsert payload | `if pd.notna(val)` filter in list-comp | WIRED | applied identically on both is_key_mode and strategy-mode branches |
| `broker_dailies.py:125-126` | `trades_to_daily_returns_with_status` | params forwarded at :145-146 | WIRED | `external_flows` and `open_unrealized_usd` pass through |

### Data-Flow Trace (Level 4)

These are analytics backend transforms; no rendering components. Data flows traced at the function level:

| Function | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `trades_to_daily_returns_with_status` | `returns`, `meta` | `reconstruct_nav_and_twr` return | Yes — chain-linked TWR, emits np.nan on guarded days | FLOWING |
| `run_strategy_analytics` guard lift | `data_quality_flags["negative_nav_guard"]` | `returns_meta` from transforms | Yes — present only when guard fires | FLOWING |
| `csv_daily_returns` upsert | `rows_payload` | `combine_realized_and_funding` output | Yes — NaN rows skipped; real return values upserted | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full analytics suite | `python -m pytest tests/ -q` (CI-3.12 venv) | 2977 passed, 92 skipped | PASS |
| Byte-identity pins (4) | `pytest tests/test_transforms.py -k "byte_identical" tests/test_broker_dailies.py -k "byte_identical" -q` | 4 passed | PASS |
| Source-scan mutation guards | `pytest tests/test_transforms.py -k "forbidden or fallback_deletion" -q` | 4 passed | PASS |
| Guard promotion + invariant | `pytest tests/test_analytics_runner.py -k "status_guard or complete_unchanged" -q` | 3 passed (promotion) + 1 passed (invariant) | PASS |
| NavReconstructionError permanent catches | `pytest tests/test_analytics_runner.py -k "nav_error_permanent" tests/test_derive_broker_dailies_dualmode.py -k "nav_error_permanent" -q` | 4 passed | PASS |
| NaN-safe upsert | `pytest tests/test_derive_broker_dailies_dualmode.py -k "nan_upsert" tests/test_csv_analytics_runner.py::TestNaNAccountHonestEndToEnd -q` | 3 passed | PASS |

### Probe Execution

No conventional probe scripts (`scripts/*/tests/probe-*.sh`) declared or discovered for this phase. PLAN and SUMMARY verification sections use pytest commands run inline. Step 7c: SKIPPED (no probes defined).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TWR-03 | 74-02 | Silent `estimated_start<=0 -> account_balance` fallback deleted unconditionally on both branches | SATISFIED | Grep finds zero code hits; source-scan tests pass; REQUIREMENTS.md marks DONE |
| TWR-04 | 74-02, 74-03, 74-04 | Both callers routed through honest core with new params; zero-flow input reproduces today's output byte-for-byte | SATISFIED | Both branches delegate at transforms.py:198/:239; params on both signatures; 4 byte-identity pins GREEN; REQUIREMENTS.md marks DONE |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `job_worker.py` | 1081 | `TODO(G12.A.6)` | Info | Pre-existing (committed 2026-05-09); references formal tracking ID G12.A.6; not introduced by Phase 74 |
| `test_analytics_runner.py` | 2177 | `TODO` with "PR-7c" reference | Info | Pre-existing; references formal tracking ID; not introduced by Phase 74 |

No unreferenced `TBD`, `FIXME`, or `XXX` markers introduced in Phase 74 modified files. Pre-existing TODOs carry formal tracking IDs — not blockers.

### Human Verification Required

None. All behaviors are deterministic, backend-only, and fully covered by automated tests. No UI, real-time behavior, or external service integration involved.

---

## Gaps Summary

No gaps. All four ROADMAP formal success criteria verified. Both transforms.py branches delegate to the honest core with silent fallbacks absent from code. All 4 byte-identity snapshot pins pass at rtol=1e-12. Guard keys lift through DataQualityFlags and promote `computation_status` to `complete_with_warnings` on the `run_strategy_analytics` path. Both `NavReconstructionError` permanent catches are wired (analytics_runner:1937 stamps `failed` + raises 422; job_worker:2015 returns permanent FAILED). NaN-safe upsert applies on both csv_daily_returns list-comp branches.

**Broker→CSV gap (Focus Item 6 verdict — ACCEPTABLE DEFERRAL, not a blocker):** The `run_csv_strategy_analytics` re-reads `csv_daily_returns` (guarded days already absent) without the guard meta; `_mark_complete` overwrites `data_quality_flags` with `{csv_source: True}`, so a broker-path account with `estimated_start<=0` renders `complete` not `complete_with_warnings` on the csv_analytics row. This is an architectural constraint, not a defect of this phase: (1) none of the 4 ROADMAP SCs require `complete_with_warnings` on the broker→CSV path specifically; (2) the honesty guarantees ARE met — no fabricated magnitude is written, no crash occurs, guarded days are absent from the table, and all factsheet KPIs are finite (proven by `test_nan_account_honest_end_to_end`); (3) `complete_with_warnings` IS produced on the `run_strategy_analytics` stored-trades path (74-03); (4) ROADMAP.md explicitly marks Phase 74 COMPLETE and documents this as a known architectural limitation for Phase 75+. TWR-03 and TWR-04 are formally satisfied.

---

_Verified: 2026-07-05_
_Verifier: Claude (gsd-verifier)_
