---
phase: 72-ltp-onboarding-acceptance
verified: 2026-07-05T12:08:49Z
status: human_needed
score: 4/4 code sub-goals verified
overrides_applied: 0
human_verification:
  - test: "LIVE 3-key Deribit onboarding canary — onboard LTP056/068/016 via the prod wizard (quantalyze.xyz) using DERIBIT_CLIENT_ID/SECRET_1..3 from Railway"
    expected: "Each key produces a verified factsheet whose realized/funding/inverse-P&L reconciles (ledger completeness clean, funding→settlement reconcile, inverse-P&L signs correct). Wizard reaches 'Your verified factsheet is ready' with a days-of-returns line."
    why_human: "Requires real Railway secrets pasted into the prod wizard against the live Deribit API + broker-dailies ledger crawl — cannot be exercised programmatically from the diff. This is the milestone's SC-1 completion step, explicitly out of this code diff."
  - test: "Post-onboarding key rotation (SC-4)"
    expected: "The 3 read-only Deribit keys are rotated per analytics-service/docs/deribit-key-rotation.md after the canary passes."
    why_human: "Operational credential-rotation action against the founder's Deribit account; not verifiable in-repo."
notes_warning:
  - "Test C (test_broker_dailies.py P72 stamp tests) could not be executed in this local env: the .venv is Python 3.14 which SIGSEGVs on the scipy/native import path inside run_derive_broker_dailies_job. A PRE-EXISTING non-P72 deribit test in the same file (test_deribit_material_equity_zero_rows_fails_loud) segfaults identically — confirming an environment artifact, not a Test C defect. CI is pinned to Python 3.12 (.github/workflows/ci.yml) where these run. Test A + Test B (python) and all 63 vitest tests passed locally."
---

# Phase 72: LTP Onboarding & Acceptance Verification — Verification Report

**Phase Goal (code kernel):** Wire Deribit strategy onboarding end-to-end so the wizard
produces a verified factsheet via the broker-dailies txn-log ledger path (not the fill-based
`process_key` metrics that raise by design for Deribit), WITHOUT regressing existing
fill-based (perp) onboarding.
**Verified:** 2026-07-05T12:08:49Z
**Status:** human_needed (all 4 code sub-goals VERIFIED; live 3-key canary + key rotation are runtime acceptance steps, not in this diff)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (the 4 code sub-goals)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `/process-key` ACCEPTS `source="deribit"` for `onboard`+`resync`, still REJECTS it for `teaser`/`internal_report`/`csv` | ✓ VERIFIED | `process_key.py:139,141` add `"deribit"` to the `onboard` + `resync` sets ONLY; `teaser`/`internal_report`/`csv` sets unchanged (still `{okx,binance,bybit}` / `{csv}`). H-11 field_validator raises for non-whitelisted cells. Test A passed. |
| 2 | `run_process_key_long_job` for deribit skips `fetch_raw`/`compute_metrics`/`fingerprint`/`reconstruct_positions`, still reaches `published`, and enqueues `derive_broker_dailies` at the tail | ✓ VERIFIED | `long_fetch.py:246 is_ledger_backed = source == "deribit"`; fill steps guarded at `:372-398` (metrics), `:423-446` (fingerprint), `:457-462` (reconstruct); tail swap at `:499 tail_kind = "derive_broker_dailies" if is_ledger_backed else "sync_trades"`, enqueued at `:511`. `published` transition preserved (`:466-474`). Test B passed (AssertionError side-effects prove fill methods never called). |
| 3 | A deribit ledger permanent-FAIL stamps `strategy_analytics.computation_status='failed'` | ✓ VERIFIED | `job_worker.py:1866-1876 _stamp_deribit_analytics_failed` (strategy-mode only, `on_conflict="strategy_id"`, `data_quality_flags={"csv_source":True}`); called before the FAILED return at the ledger-incomplete branch (`:1902`) and the material-equity-empty branch (`:1926`). Test C code correct by inspection (see WARNING re local 3.14 segfault). |
| 4 | Venue-aware `isLedgerBacked` gate lets a KEYED ledger-backed (deribit) 0-trade strategy pass on `csv_daily_returns`, while a KEYED fill-based (perp) 0-trade strategy still returns INSUFFICIENT_TRADES (critical no-regression) | ✓ VERIFIED | `strategyGate.ts:140-143 isDailyReturnsSourced = tradeCount===0 && csvRowCount>0 && (!apiKeyId || isLedgerBacked===true)`; `isLedgerBackedExchange` (`:70-74`). NO_DATA_SOURCE guard (`:113`) unchanged (`!apiKeyId`). Mirrored at admin route (`route.ts:227-231`) and wired into wizard (`SyncPreviewStep.tsx:436-439,469`). All 3 call sites + regression guards pass (see below). |

**Score:** 4/4 code sub-goals VERIFIED

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/routers/process_key.py` | deribit admitted to onboard+resync only | ✓ VERIFIED | `:139,141`; H-11 comment updated `:122-128` |
| `analytics-service/services/ingestion/long_fetch.py` | ledger routing, skip fills, derive_broker_dailies tail | ✓ VERIFIED | `:246`, `:372-398`, `:423-462`, `:499-524` |
| `analytics-service/services/job_worker.py` | fail-loud strategy_analytics=failed stamp | ✓ VERIFIED | `:1866-1876`, `:1902`, `:1926` |
| `src/lib/strategyGate.ts` | venue-aware isLedgerBacked gate + isLedgerBackedExchange | ✓ VERIFIED | `:59-74`, `:140-143` |
| `src/app/api/admin/strategy-review/route.ts` | mirror predicate in first-pass gate + TOCTOU re-check | ✓ VERIFIED | `:132-146` (first-pass key lookup + gate), `:224-231` (re-check `!approveApiKeyId || isLedgerBacked`) |
| `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx` | csv_daily_returns count query + isLedgerBacked into gate + copy gated on tradeCount | ✓ VERIFIED | `:392,428-437` (count query), `:465,469` (gate input), `:620-640` (days-of-returns copy) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| long_fetch (deribit) | derive_broker_dailies | `enqueue_compute_job` with `p_kind=tail_kind` | ✓ WIRED | `long_fetch.py:511`; Test B asserts `p_kind=="derive_broker_dailies"` + `p_strategy_id` |
| derive_broker_dailies FAIL | strategy_analytics.failed | `_stamp_deribit_analytics_failed` upsert before FAILED return | ✓ WIRED | `job_worker.py:1902,1926` |
| SyncPreviewStep | checkStrategyGate | `isLedgerBacked: isLedgerBackedExchange(keyRow?.exchange)` + `csvRowCount` | ✓ WIRED | `SyncPreviewStep.tsx:465,469`; csv count query in terminal Promise.all `:428-437` |
| admin route re-check | isDailyReturnsSourced | `!approveApiKeyId || isLedgerBacked` (venue term) | ✓ WIRED | `route.ts:227-231`; `approveApiKeyId`/`isLedgerBacked` resolved first-pass `:139-146`, reused in re-check |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Test A: deribit accepted onboard+resync, rejected teaser/internal_report/csv, H-11 intact | `pytest test_process_key.py::test_p72_deribit_admitted_to_onboard_and_resync_only` | 1 passed | ✓ PASS |
| Test B: deribit enqueues derive_broker_dailies, skips fills, reaches published | `pytest test_long_fetch.py::...deribit_enqueues_derive_broker_dailies_and_skips_fills` | 1 passed | ✓ PASS |
| Test C: deribit ledger-fail + material-equity-empty stamp strategy_analytics=failed | `pytest test_broker_dailies.py::...strategy_mode...stamps_failed` (×2) | SIGSEGV under local Python 3.14 (env artifact; pre-existing non-P72 test segfaults identically; CI pinned 3.12) | ? SKIP (env) |
| Tests D+E+F + SubmitStep snapshot: strategyGate venue gate, wizard ledger path, admin route re-check | `vitest run strategyGate.test.ts route.test.ts SyncPreviewStep.render.test.tsx SubmitStep.test.tsx` | 4 files / 63 tests passed | ✓ PASS |

### Revert-proofness analysis (per phase instruction)

- **Test A** — constructs `_ProcessKeyBody(flow_type="onboard"/"resync", source="deribit")` (must NOT raise) and asserts `ValidationError match="H-11"` for teaser/internal_report/csv. Reverting the whitelist edit flips the onboard/resync constructions to raise → test fails. Also asserts okx-on-csv still rejected (no cell widened). Genuinely revert-proof.
- **Test B** — installs `AssertionError` side-effects on `fetch_raw`/`compute_metrics`/`compute_fingerprint`/`reconstruct_positions`; reverting the ledger guard calls them → AssertionError. Asserts `p_kind=="derive_broker_dailies"`; reverting the tail swap yields `sync_trades` → assertion fails. Asserts `published` reached. Genuinely revert-proof.
- **Test C** — asserts a `strategy_analytics` upsert with `computation_status=="failed"`, `data_quality_flags=={"csv_source":True}`, `on_conflict=="strategy_id"` AND that NO `csv_daily_returns` is upserted (no partial track record). Removing the stamp → `stamps` empty → assertion fails. Correct by inspection; execution blocked only by the local 3.14 segfault (CI-covered).
- **Test D (strategyGate)** — the Finding-1 guard "keyed FILL-based (perp) with 0 trades + funding series must NOT publish → INSUFFICIENT_TRADES" (`isLedgerBacked` omitted → false, apiKeyId set, csvRowCount 30). Reverting the venue term to the plan's naive `tradeCount===0 && csvRowCount>0` would route this perp to the CSV branch and PASS → assertion fails. The deribit PASS case fails if the whole change is reverted. Guards both directions. Genuinely revert-proof.
- **Test F (admin route)** — mirror of D at the TOCTOU re-check: deribit key → 200; deribit below floor → 409 CSV-threshold; **perp okx 0-trades+30-csv → 409 trade-count** (Finding-1 guard). Reverting the venue term diverts the perp to the CSV branch → 200, failing the "→ 409 trade count" assertion. The mock supplies `api_keys.exchange` and mocks `isLedgerBackedExchange` faithfully, so the ledger-vs-perp branch is exercised honestly.
- **Test E (SyncPreviewStep render)** — keyed deribit, 0 trades, 30 csv rows, complete analytics reaches the "Your verified factsheet is ready" heading + "30 days of returns detected" (asserts "0 trades detected" is NOT present). Removing the csv_daily_returns count query from the terminal Promise.all → csvRowCount 0 → gate false-fails INSUFFICIENT_TRADES → never reaches passed → test fails. Genuinely revert-proof.

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| SC-1 (LTP056/068/016 as 3 verified strategies) | Founder-gated live canary | ? NEEDS HUMAN | Code path delivered (sub-goals 1-4); live onboarding is the runtime acceptance step (human_verification) |
| SC-2 (acceptance gates: completeness/funding/inverse-P&L) | deribit_acceptance.py harness | ? NEEDS HUMAN (runtime) | Harness is a CONTEXT deliverable; reconciliation runs against live onboarded strategies — out of this code diff's 4-sub-goal kernel |
| SC-3 (secrets via env/Keychain, repo scan clean) | No tracked credential | ✓ SATISFIED (this diff) | Debt/secret scan of all 6 modified source files clean; no credential added; CONTEXT documents residual pre-existing entropy FPs out of scope |
| SC-4 (key-rotation recommendation) | deribit-key-rotation.md + rotation action | ? NEEDS HUMAN | Doc is a CONTEXT deliverable; the rotation action is operational (human_verification) |

Note: SC-1/2/4 are milestone-acceptance criteria the CONTEXT explicitly gates on the live
canary + founder action; they are NOT part of this diff's code kernel (the 4 sub-goals), which
is fully VERIFIED. The verification scope for this phase's diff is the onboarding code path.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (all 6 modified source files) | — | TBD/FIXME/XXX/HACK/placeholder scan of added lines | ℹ️ Info | NONE found. The only `NotImplementedError` references are documentation of Deribit's by-design fill-metrics raise; the `FOLLOW-UP` note in long_fetch is a pre-existing reference to QUEUED-PATH-COMPLETION-PLAN.md. Fingerprint deferral is an accepted, plan-documented risk (P72 risk 4), not silent debt. |

### Human Verification Required

**1. Live 3-key Deribit onboarding canary (SC-1 / milestone completion)**
- **Test:** Onboard LTP056, LTP068, LTP016 via the prod wizard (quantalyze.xyz) using the read-only keys in Railway env `DERIBIT_CLIENT_ID/SECRET_1..3`.
- **Expected:** Each key advances through validate → encrypt → process-key (onboard) → ledger crawl → verified factsheet; wizard shows "Your verified factsheet is ready" + a days-of-returns line; `deribit_acceptance.py` reports gates green (date-range coverage, ledger completeness clean, funding→settlement reconcile, inverse-P&L signs correct).
- **Why human:** Requires real Railway secrets against the live Deribit API + broker-dailies ledger crawl; cannot be exercised from the diff. Explicitly out of this code diff per the phase brief.

**2. Post-onboarding key rotation (SC-4)**
- **Test:** After the canary passes, rotate the 3 read-only Deribit keys per `analytics-service/docs/deribit-key-rotation.md`.
- **Expected:** Keys rotated; runbook steps followed.
- **Why human:** Operational credential-rotation action; not verifiable in-repo.

### Gaps Summary

No code gaps. All 4 code sub-goals are substantively implemented, wired across every call
site, and covered by revert-proof tests. Locally: Test A + Test B (python) and all 63 vitest
tests (Tests D/E/F + the SubmitStep snapshot update) pass. Test C (python) is correct by
inspection but could not be executed locally — the `.venv` is Python 3.14, which SIGSEGVs on
the scipy/native import path exercised inside `run_derive_broker_dailies_job`; a pre-existing
non-P72 deribit test in the same file segfaults identically, confirming an environment
artifact, and CI is pinned to Python 3.12 where the suite runs. This is a WARNING, not a
blocker.

Status is **human_needed** (not passed) because the milestone's live acceptance — the 3-key
canary re-run and the SC-4 key rotation — are runtime steps that this diff intentionally does
not contain. The CODE that delivers the Deribit onboarding path is fully verified; the live
canary is the remaining gate before v1.7 is truly complete.

---

_Verified: 2026-07-05T12:08:49Z_
_Verifier: Claude (gsd-verifier)_
