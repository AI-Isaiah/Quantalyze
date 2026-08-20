---
phase: 136-mt5recon-equity-reconstruction
verified: 2026-07-23T20:10:39Z
status: passed
score: 6/6 buildable must-haves verified
overrides_applied: 0
re_verification:
  previous_status: null
  note: "Initial verification"
deferred:
  - truth: "Exact classification of the ambiguous DEAL_TYPE middle (CHARGE/INTEREST/CANCELED/DIVIDEND/TAX) and the A2 server-time offset / A3 fold rule"
    addressed_in: "Phase 136 wave-3 (136-05 checkpoint) after the Phase 134/139 live spike"
    evidence: "136-05-PLAN.md is a checkpoint:human-verify (autonomous:false); buildable path fail-loud-raises Mt5DealClassificationError on those types (SAFE by construction) — verified in tests/test_mt5_deal_reconstruction.py::test_ambiguous_or_unknown_types_fail_loud"
  - truth: "Reconstructed equity reconciles to a REAL live broker account_info().equity"
    addressed_in: "Phase 139 (MT5GOLIVE real-broker soak) / Phase 134 live spike"
    evidence: "136-CONTEXT.md <deferred>: 'Live-broker reconciliation against a real account → Phase-134 human_needed spike / Phase 139.' Phase 139 exists in ROADMAP. The offline parity gate against the Phase-134 contract double IS built + tested (test_reconstruction_reconciles_to_equity with $2-drift teeth)."
human_verification:
  - test: "Capture real DEAL_TYPE values present in a live/demo MT5 deal ledger; decide each ambiguous type's economic classification (cost vs external-flow vs excluded) and add to services/mt5_deals.py allow-list with a hand-derived oracle per added type."
    expected: "Each admitted type reconstructs correctly; until then they correctly fail loud (no silent mis-fold)."
    why_human: "Broker-specific economic meaning of CHARGE/INTEREST/CANCELED/DIVIDEND/TAX cannot be settled without observing real deal rows (the 136-05 checkpoint / Phase 134 spike)."
  - test: "Run the mt5 derive branch against a REAL broker gateway and confirm reconstructed terminal NAV reconciles to live account_info().equity within max($1, 1e-6·|terminal|); confirm A2 server-time UTC offset is correct."
    expected: "Parity holds on live data; a material uPnL wedge flags complete_with_warnings; missing history renders coverage-masked."
    why_human: "Requires a live RPyC MT5 terminal + real broker account (Phase 139 go-live scope, not the offline Phase-134 contract double)."
---

# Phase 136: MT5RECON — Equity reconstruction → backbone → api_verified Verification Report

**Phase Goal:** A connected MT5 account becomes an honest `api_verified` daily-return series through the ONE backbone — deal ledger classified correctly, √252 traditional annualization, reconciled to live account equity.
**Verified:** 2026-07-23T20:10:39Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

The **buildable** goal (everything code+test against the Phase-134 `Mt5Client` offline contract) is fully achieved. All six load-bearing truths were verified against the actual codebase by RUNNING the tests and GREPping the guards — not by trusting SUMMARY claims. The two items that require a live broker (the ambiguous DEAL_TYPE middle and real-account reconciliation) are explicitly deferred to the Phase 136 wave-3 `136-05` checkpoint and Phase 139 go-live; they are NOT gaps — the buildable path fail-loud-raises on those types, which is SAFE and correct.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `combine_mt5_deal_ledger` folds realized profit/swap/commission/fee + `DEAL_TYPE_BALANCE` flows against the equity anchor → ONE backbone; deposit day is NOT a return spike (300/100_400, not +10.26%); unclassifiable/CORRECTION DEAL_TYPE fails loud | ✓ VERIFIED | `broker_dailies.py:394` `def combine_mt5_deal_ledger` exists beside deribit/sfox siblings, delegates to `combine_realized_and_funding`→`chain_linked_twr`. `test_deposit_day_is_not_a_return_spike` asserts `vals[2]==300/100_400` AND `!= spike(0.1026)`. `test_unknown_deal_type_kills_the_whole_combine` + `test_correction_type_raises` green. classify_deal is an allow-list ({0,1,7-11} trading; {2,3,6} flow) raising `Mt5DealClassificationError` on all else. |
| 2 | `api_verified` EXPLICITLY proven: mt5 onboard + resync yields `trust_tier='api_verified'` via process_key.py:866 + transition | ✓ VERIFIED | `process_key.py:866` `trust_tier = "csv_uploaded" if body.source=="csv" else "api_verified"`. `test_process_key_mt5_onboard_draft_carries_trust_tier_api_verified` and `..._resync_...` assert `drafts[0]["trust_tier"]=="api_verified"` + status draft/flow_type resync. Both green (5 mt5 process_key tests pass). |
| 3 | √252 TRADITIONAL: `isCryptoExchange('mt5')===false`; `asset_class='traditional'`; mutation test RED if mt5 annualizes √365; mt5 absent from Python CRYPTO_VENUES + TS CRYPTO_EXCHANGES | ✓ VERIFIED | `closed-sets.ts:253` `CRYPTO_EXCHANGES=[binance,okx,bybit,deribit,sfox]` (mt5 excluded); `isCryptoExchange` tests that subset. Python runtime: `CRYPTO_VENUES={binance,bybit,deribit,okx,sfox}`, `'mt5' in CRYPTO_VENUES == False`. `test_annualizes_252_not_365` runs real `compute_all_metrics(periods=252)`, asserts vol==std×√252 AND √365 is a different literal. `test_mt5_not_in_python_crypto_registry` green. 119 TS tests pass. |
| 4 | Reconciliation-to-equity parity gate hand-derived (within max($1,1e-6·|terminal|)), RED on injected drift; uPnL-wedge DQ flag; missing-history → coverage-masked absence | ✓ VERIFIED | `test_reconstruction_reconciles_to_equity` uses `terminal_equity=110_500`, `tol=max(1.0,1e-6·|terminal|)`, forward NAV roll from hand-derived initial, with a $2-drift NEGATIVE CONTROL (`abs(drifted-terminal)>tol`). Branch applies deribit uPnL-wedge condition (`|open_unrealized|/equity>0.05` → `meta["unrealized_pnl_in_anchor"]=True`). `test_upnl_wedge_flags` + `test_missing_window_masked` green. |
| 5 | Fail-loud end-to-end (None≠(); no fill-based MetricsSnapshot — mt5 in `_LEDGER_BACKED_SOURCES`, compute_metrics/fetch_raw stay NotImplementedError) | ✓ VERIFIED | `long_fetch.py:62 _LEDGER_BACKED_SOURCES={deribit,sfox,mt5}`; `job_worker.py:273 _NATIVE_RETURNS_VENUES` includes mt5. `mt5_client.py` account_info/history_deals_get None→typed raise (`:230`,`:242`), `()`→honest empty. `ingestion/mt5.py:214/233` fetch_raw+compute_metrics raise `NotImplementedError` with PERMANENT by-design wording (not "until Phase 136"). Derive branch reads `login→account_info→history_deals_get` inside `wait_for(to_thread())`, classifies TimeoutError→transient, Mt5ClientError→auth/wrong_server permanent+stamp else transient. |
| 6 | ORACLE DISCIPLINE: money oracles are hand-derived literals, NOT regenerated from the SUT | ✓ VERIFIED | `_CANONICAL_RETURNS=[0.0040, 0.0, 300/100_400, -200/110_700]` written as literals; vol oracle derived via INDEPENDENT `np.std(ddof=1)×√252`, never read back from combine/compute. Reconciliation oracle is a forward roll from hand initial (100_000) + hand flows, with negative control. Arithmetic shown in test comments (NAV chain 100_000/100_400/100_400/110_700/110_500). |

**Score:** 6/6 buildable truths verified

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Ambiguous DEAL_TYPE middle (CHARGE/INTEREST/CANCELED/DIVIDEND/TAX) + A2 offset + A3 fold rule | Phase 136 wave-3 (136-05 checkpoint) post live spike | 136-05 is checkpoint:human-verify; buildable path fail-loud-raises on those types (SAFE) — `test_ambiguous_or_unknown_types_fail_loud` green |
| 2 | Live-broker equity reconciliation on a REAL account | Phase 139 (MT5GOLIVE) / Phase 134 live spike | 136-CONTEXT `<deferred>`; offline parity gate against the Phase-134 double IS built + RED on drift |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/services/mt5_deals.py` | Pure fail-loud DEAL_TYPE classifier + UTC-day seam + cash-effect coercion | ✓ VERIFIED | `classify_deal`, `Mt5DealClassificationError`, `deal_utc_day`, `deal_cash_effect`, disjoint frozensets w/ import-time assert. Pure/IO-free. |
| `analytics-service/services/broker_dailies.py` | `combine_mt5_deal_ledger` third sibling | ✓ VERIFIED | Line 394; imports from `services.mt5_deals`; delegates to shared TWR engine (no bespoke r_t loop). |
| `analytics-service/services/job_worker.py` | `venue=='mt5'` derive branch + Mt5Session factory + close routing + `_NATIVE_RETURNS_VENUES` | ✓ VERIFIED | `elif venue == "mt5":` at line 3255; gate-first, bounded read, combine, floor, wedge, shared downstream vars set exactly as sfox. |
| `analytics-service/services/ingestion/long_fetch.py` | mt5 in `_LEDGER_BACKED_SOURCES` | ✓ VERIFIED | Line 62 + routing at line 276. |
| `analytics-service/routers/process_key.py` | mt5 onboard/resync behind fail-closed gate + api_verified stamp | ✓ VERIFIED | Stamp at line 866; MT5-F2 fail-closed gate + H-11 whitelist tested. |
| `analytics-service/tests/test_mt5_deal_reconstruction.py` | Hand-derived economic oracles | ✓ VERIFIED | 47 tests, all green; literals hand-derived. |
| `analytics-service/tests/test_mt5_derive_branch.py` | Offline job-level tests incl. reconciliation gate | ✓ VERIFIED | 8 tests, all green; drives whole job via `_connect` double. |
| `analytics-service/tests/test_process_key.py` | mt5 onboard+resync → api_verified | ✓ VERIFIED | 5 mt5 tests green. |
| `src/lib/closed-sets.ts` | CRYPTO_EXCHANGES subset excluding mt5 | ✓ VERIFIED | Line 253; `isCryptoExchange('mt5')===false`. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| job_worker mt5 branch | `combine_mt5_deal_ledger` | the ONE combine call | ✓ WIRED | `returns, meta = combine_mt5_deal_ledger(...)` in the branch; `test_mt5_routes_one_backbone` asserts hand literals at the JOB level (wiring, not just helper). |
| long_fetch | derive_broker_dailies tail | `_LEDGER_BACKED_SOURCES` membership | ✓ WIRED | `test_long_fetch_tail_wiring` proves source 'mt5' → tail_kind derive (never sync_trades). |
| process_key | `mt5_enabled_server` | fail-closed wire gate | ✓ WIRED | `test_mt5_source_fails_closed_when_server_flag_off` (MT5-F2) green. |
| create-with-key / finalize-wizard | `isCryptoExchange` | venue-aware asset_class stamp | ✓ WIRED | Both routes stamp `isCryptoExchange(exchange) ? 'crypto' : 'traditional'`; wiring tests redden on a neutered call site. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Deal-recon + derive-branch oracles | `pytest tests/test_mt5_deal_reconstruction.py tests/test_mt5_derive_branch.py -q` | 55 passed | ✓ PASS |
| api_verified at mt5 seam | `pytest tests/test_process_key.py -k mt5` | 5 passed | ✓ PASS |
| TS √252 narrowing + venue-aware stamps | `vitest run closed-sets + create-with-key + finalize-wizard` | 119 passed | ✓ PASS |
| Registry membership | `python3 -c "'mt5' in CRYPTO_VENUES"` | False | ✓ PASS |
| _LEDGER_BACKED / _NATIVE_RETURNS | grep | both include mt5 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| MT5RECON-01 | 136-01, 136-03 | Deal-ledger reconstruction → backbone → api_verified, fail-loud None≠() | ✓ SATISFIED | combine + classifier + worker branch + api_verified tests all green |
| MT5RECON-02 | 136-01, 136-02 | Traditional √252 annualization; mt5 excluded from crypto registries | ✓ SATISFIED | TS CRYPTO_EXCHANGES + Python CRYPTO_VENUES exclude mt5; mutation test green. NOTE: REQUIREMENTS.md checkbox still shows `[ ] ⏳ Pending` (line 29/66) — a documentation lag; the code + tests fully satisfy it. |
| MT5RECON-03 | 136-03 | Reconciliation parity gate + uPnL-wedge DQ flag + coverage-masked absence | ✓ SATISFIED | Parity gate w/ $2-drift teeth, wedge flag, missing-window masking all green |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX debt markers in any modified/created file | — | Clean |
| ingestion/mt5.py | 214/233 | `raise NotImplementedError` in fetch_raw/compute_metrics | ℹ️ Info | INTENTIONAL fail-loud by-design (permanent), not a stub — prevents the BYB-02 fill-based corruption class. Correct. |

### Human Verification Required (live spike / Phase 139 — NOT gaps)

1. **Ambiguous DEAL_TYPE middle** — Capture real DEAL_TYPE values from a live/demo ledger; classify each and extend `services/mt5_deals.py` allow-list with a hand-derived oracle per type. Until then they correctly fail loud (136-05 checkpoint). *Why human:* broker-specific economic meaning requires real data.
2. **Live-broker equity reconciliation + A2 offset** — Run the derive branch against a real RPyC gateway; confirm terminal NAV parity to live `account_info().equity` and the correct server-time UTC offset. *Why human:* requires a live MT5 terminal + real account (Phase 139 scope).

### Gaps Summary

No gaps. Every buildable must-have resolves to VERIFIED with running-test and code evidence:
- The money-math core (`combine_mt5_deal_ledger` + `classify_deal`) is present, pure, fail-loud, and pinned by 47 hand-derived economic oracles that RUN green — the deposit-day-is-not-a-spike literal (300/100_400) and the CORRECTION/unknown-type fail-loud both proven.
- `api_verified` is EXPLICITLY earned at the mt5 seam for onboard AND resync (not merely inherited), proven by two process_key tests that inspect the actual draft insert payload.
- √252 traditional annualization is enforced on BOTH the TS side (`CRYPTO_EXCHANGES` excludes mt5, `isCryptoExchange('mt5')===false`) and the Python side (`CRYPTO_VENUES` excludes mt5 at runtime), with a mutation guard that reddens on a √365 clock flip.
- The reconciliation parity gate carries teeth (a $2 injected drift reddens), the uPnL-wedge promotes to complete_with_warnings, and missing history renders coverage-masked — never a fabricated flat account.
- Fail-loud None≠() discipline holds end-to-end; the fill path stays a permanent NotImplementedError tripwire; mt5 rides the ledger-backed tail.
- Oracle discipline is honored: literals are hand-derived with shown arithmetic, never regenerated from the SUT.

The 136-05 DEAL_TYPE-middle checkpoint and live-broker reconciliation are correctly deferred to the live spike (136-05 wave-3 / Phase 134 spike / Phase 139 go-live). The buildable path's fail-loud-on-ambiguous-type behavior is the SAFE and correct posture in the interim.

---

_Verified: 2026-07-23T20:10:39Z_
_Verifier: Claude (gsd-verifier)_
