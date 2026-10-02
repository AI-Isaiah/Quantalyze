---
phase: 104-unified-queued-path-persists-process-key-long
verified: 2026-07-14T00:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
re_verification:
  # backfill of the formal verifier step — phase was executed + Fable-red-teamed
  # (NO BLOCKERS) but had no VERIFICATION.md. This is the initial formal verify.
  note: "Initial formal verification (backfill). No prior VERIFICATION.md existed."
deferred:
  # NOT gaps — DARK/latent this phase, explicitly recorded as Phase-105 pre-reqs
  # in ROADMAP.md §104-CARRY. Do not block Phase 104 on these.
  - truth: "MED-1: pre-seam terminal-failure arms can leave a stale cash_settlement (and mtm) series row outliving an authoritative-NULL scalar write"
    addressed_in: "Phase 105"
    evidence: "ROADMAP §104-CARRY MED-1 — mitigated today by read-side status-gating (row is dark, zero readers); 105 must status-gate the cash reader OR heal both series rows at those terminal arms"
  - truth: "MED-2: the cash conventions echo resolves denominator_config only in the deribit arm (job_worker.py:2162, default None at :2051); a ccxt strategy with a non-null override would echo geometric/calendar while legacy scalars use the override venue-agnostically"
    addressed_in: "Phase 105"
    evidence: "ROADMAP §104-CARRY MED-2 — zero prod rows today (returns_denominator_config is Zavara/Deribit-only) AND the echo is unread this phase (dark); 105 must resolve the cash echo venue-agnostically as analytics_runner.py does"
  - truth: "LOW-2/3/4: composite stitch derive omits benchmark_symbol; BROKER_DAILIES_VIA_FUNDING rollback orphans dark rows; INERT-read grep tripwire could miss a reader via imported constant"
    addressed_in: "Phase 105"
    evidence: "ROADMAP §104-CARRY LOW-2/3/4 — all dark/latent, no prod behavior change this phase"
---

# Phase 104: Cash daily series onto the backbone — Verification Report

**Phase Goal:** BB-01 — at the single-key broker-derive seam (where Phase-103's MTM rides `derive_basis_series`), add an additive DARK persist of the cash daily-return SERIES as a new `strategy_analytics_series` kind `cash_settlement` + the benchmark-identity conventions echo. SERIES-ONLY: authoritative cash SCALARS stay on the legacy path. No prod behavior change (dark/inert write, zero readers).
**Verified:** 2026-07-14
**Status:** passed
**Re-verification:** No — initial formal verification (backfill; phase was executed + Fable-red-teamed with NO BLOCKERS).

## Goal Achievement

### Observable Truths (the 5 ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
| - | ----- | ------ | -------- |
| 1 | Cash daily SERIES persisted via shared `derive_basis_series`/`persist_basis_series` (`cash_settlement` in `_KIND_BY_BASIS`) at the broker-derive seam; series round-trips + coverage mask exists | ✓ VERIFIED | `basis_series.py:74` `KIND_CASH_SETTLEMENT="cash_settlement"`, `:77-80` `_KIND_BY_BASIS` gains the entry. Persist seam `job_worker.py:3200-3220` (`derive_basis_series(returns, None, …, benchmark_symbol="BTC")` → `persist_basis_series(basis="cash_settlement")`), placed AFTER the MTM persist (`:3155`) and BEFORE enqueue (`:3223`). Round-trip proven: `test_cash_basis_series_sc4.py::test_cash_series_roundtrip_and_gap_mask` — `assert_series_equal(check_exact=True)`, guard day absent from both series rows and `csv_daily_returns` (identical date sets, bit-equal values), `gap_spans` covers the guard day. 44/44 tests green. |
| 2 | SERIES-ONLY boundary held — authoritative cash SCALARS unchanged (legacy path); no `cash_settlement` in `metrics_json_by_basis`; no scalar column rewritten | ✓ VERIFIED | `grep -v '^\s*#' analytics_runner.py \| grep -c derive_basis_series` = 0 and `basis_series` = 0 (the authoritative cash scalar path is untouched). `analytics_runner.py` has an EMPTY diffstat across the phase commits. `test_analytics_runner_series_only_boundary` asserts zero non-comment refs. Dual-run asserts `_CASH_KIND not in by_basis` in the `strategy_analytics` prestamp (`metrics_json_by_basis` never gains a `cash_settlement` key). |
| 3 | SC-4: existing single-key + composite CASH factsheets byte-identical (dark write, scalars untouched); dual-run proof real + falsifiable | ✓ VERIFIED | `test_sc4_cash_series_dual_run_byte_identity`: Run A (as-shipped) vs Run B (cash persist no-opped) — asserts equality of `csv_upserts`, `csv_deletes`, `prestamp` (incl. `metrics_json_by_basis`), and non-cash RPC calls; asserts the ONLY delta is the `cash_settlement` p_kinds entry (present in A, absent in B). Falsifiable, not tautological. Full-suite golden sweep green at 92.50% cov (104-02-SUMMARY; nine cash-pin + 103-02 cash-golden tests unmodified). |
| 4 | INERT to prod — no read path consumes the new row this phase | ✓ VERIFIED | `grep -rn cash_settlement src/ --include=*.ts{,x}` paired with `kind`/`strategy_analytics_series` = NONE. `test_no_reader_consumes_cash_settlement_series_row` walks `src/**` + `analytics-service/services|routers/**` (excluding the two write-seam files), asserts zero offenders AND `assert scanned` (guards against a vacuous path-resolution pass). No `USE_COMPUTE_JOBS_QUEUE` gating on the write; path selection/outputs unchanged. |
| 5 | No new valuation math; benchmark identity carried in `conventions` for 105's scalar route | ✓ VERIFIED | `metrics.py` + `analytics_runner.py` EMPTY diffstat (compute_all_metrics untouched); phase production diff confined to `basis_series.py` + `job_worker.py`. Benchmark identity: `basis_series.py:186-187` adds `conventions["benchmark"]=benchmark_symbol` (additive, None-default omits it); BOTH call sites pass `benchmark_symbol="BTC"` uniformly (MTM `job_worker.py:3015`, cash `:3206`) — an identity STRING, `benchmark_rets=None` (no fetch). `test_cash_conventions_traditional_clock_and_unconditional_benchmark` asserts `benchmark=="BTC"` unconditionally + `periods_per_year==252` (kills hardcoded-365). |

**Score:** 5/5 truths verified

### Deferred Items

Latent/dark this phase, explicitly recorded as Phase-105 pre-reqs in ROADMAP §104-CARRY. Not actionable gaps for Phase 104.

| # | Item | Addressed In | Evidence |
| - | ---- | ------------ | -------- |
| 1 | MED-1 stale-row heal at pre-seam terminal-failure arms | Phase 105 | Read-side status-gating mitigates today; row is dark. Confirmed the heal arm exists (`job_worker.py:3208-3211` `except ValueError → result=None` → `persist_basis_series` DELETE) for the derive-reject case; the terminal-failure-arm case is the 105 pre-req. |
| 2 | MED-2 venue-agnostic conventions echo | Phase 105 | Verified real: `denominator_config` defaults `None` at `job_worker.py:2051`, re-resolves ONLY in the `if venue=="deribit"` arm (`:2162`), so a ccxt strategy with an override echoes geometric/calendar. Latent — zero prod rows (config Zavara/Deribit-only) AND echo unread this phase. |
| 3 | LOW-2/3/4 (composite benchmark_symbol omission, rollback orphans, grep-tripwire limits) | Phase 105 | All dark/latent, no prod behavior change this phase. |

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `analytics-service/services/basis_series.py` | `KIND_CASH_SETTLEMENT` + `_KIND_BY_BASIS['cash_settlement']` + optional `benchmark_symbol` echo; `_PAYLOAD_SCHEMA_VERSION` unbumped | ✓ VERIFIED | `:74`, `:77-80`, `:131`/`:186-187`; `_PAYLOAD_SCHEMA_VERSION=1` unchanged (`:84`, `:246`). WIRED — imported+called by `job_worker.py:2961-2964`. |
| `analytics-service/services/job_worker.py` | additive dark cash-series persist at the seam; MTM site carries `benchmark_symbol="BTC"` | ✓ VERIFIED | Cash block `:3157-3220`; single non-comment `basis="cash_settlement"` (count=1). Key-mode early-return preserved (`:2938`). WIRED. |
| `analytics-service/tests/test_basis_series.py` | cash kind mapping + round-trip + heal + benchmark-echo | ✓ VERIFIED | Extended (+120 lines); green. |
| `analytics-service/tests/test_derive_broker_dailies_dualmode.py` | seam persist-fires / heal / key-mode-absent / identity-independent-of-fetch | ✓ VERIFIED | +219 lines; `TestCashSettlementSeriesPersist` present; green. |
| `analytics-service/tests/test_cash_basis_series_sc4.py` | SC-4 dual-run + round-trip + convention fixtures + boundary guards | ✓ VERIFIED | 470 lines (min_lines 120); 7 tests green. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `job_worker.py` | `basis_series.py` | `derive_basis_series(returns, None, …) → persist_basis_series(basis="cash_settlement")` | ✓ WIRED | `:3200-3220`; import `:2961-2964`. |
| `basis_series.py` | `upsert_strategy_analytics_series_batch` RPC | `persist_basis_series` p_kinds payload | ✓ WIRED | `:252-255` (`result` present → RPC); `:235-243` (`result=None` → DELETE heal). |

### Data-Flow Trace (Level 4)

Not applicable in the rendering sense — this is a DARK write with zero readers by design (SC-4). The upstream `returns` variable is the dense post-terminus daily-return series (same source as the `csv_daily_returns` rows at `:2842`), so `_drop_nonfinite` inside the helper reproduces those rows exactly — proven by the round-trip test rather than a live query.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Phase test files pass | `pytest tests/test_cash_basis_series_sc4.py tests/test_derive_broker_dailies_dualmode.py tests/test_basis_series.py -q` | 44 passed | ✓ PASS |
| SC-2 boundary grep | `grep -v '^\s*#' analytics_runner.py \| grep -c derive_basis_series` | 0 | ✓ PASS |
| Single persist seam | `grep -v '^\s*#' job_worker.py \| grep -c 'basis="cash_settlement"'` | 1 | ✓ PASS |
| SC-5 no-new-math | `git diff --stat de74c31e..HEAD -- metrics.py analytics_runner.py` | empty | ✓ PASS |
| SC-4 inert reader scan | `grep -rn cash_settlement src/ … \| grep kind` | NONE | ✓ PASS |

### Probe Execution

No project probes declared for this phase (worker/persist seam, no `scripts/*/tests/probe-*.sh`). Executor-runnable pytest is the phase's declared proof and was run above.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| BB-01 | 104-01, 104-02 | Cash daily series onto the backbone (additive dark persist at the single-key broker-derive seam) | ✓ SATISFIED | All 5 SCs verified above; `[BB-01]` deliverable per ROADMAP §Phase 104. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | No TBD/FIXME/XXX in `basis_series.py` or `job_worker.py` (modified prod files) | — | none |

The `except ValueError → _cash_basis_result = None` heal arm (`:3208-3211`) is intentional Pitfall-5 discipline (documented "effectively unreachable given the <2-day early exit"), not a stub — it wires to the `persist_basis_series` DELETE heal path and is covered by a heal test. The unrelated audit-taxonomy drift (deferred-items.md #1) was fixed in `33e4cd12` (chore #100), explicitly excluded from the phase diff — not a Phase-104 concern.

### Human Verification Required

None. This is a DARK/INERT persist seam with zero readers and no frontend surface (ROADMAP UI hint: no). There is no user-visible behavior to human-test this phase; a live-DB confirmation that a real `cash_settlement` row lands after a real broker derive is deferred by design to Phase 105 (when the reader lands) — the seam is proven by falsifiable executor-runnable unit tests (round-trip identity, dual-run byte-identity, coverage mask), all green.

### Gaps Summary

No gaps. All 5 ROADMAP Success Criteria are achieved in the shipped code and proven by falsifiable tests that I ran green (44/44 in the phase test files). The SERIES-ONLY boundary (SC-2), byte-identity (SC-3), inert-read (SC-4), and no-new-math (SC-5) are corroborated by independent grep/diffstat checks outside the test suite. The two Fable-flagged MED items and three LOW items are correctly DARK/latent this phase and recorded as Phase-105 pre-reqs in ROADMAP §104-CARRY — they do not violate any Phase-104 criterion (the new row is unread and carries zero prod rows for the divergent case). MED-2 was independently confirmed real (`denominator_config` resolves only in the deribit arm) but is non-blocking here.

---

_Verified: 2026-07-14_
_Verifier: Claude (gsd-verifier)_
