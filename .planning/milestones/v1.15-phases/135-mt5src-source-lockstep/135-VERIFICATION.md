---
phase: 135-mt5src-source-lockstep
verified: 2026-07-23T18:05:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
---

# Phase 135: MT5SRC — Source lockstep + read-only validate/encrypt + key routes + constraint migration — Verification Report

**Phase Goal:** `mt5` is accepted at every key chokepoint end-to-end — a user's three MT5 credentials validate read-only, encrypt, and persist — with the database admitting `'mt5'` everywhere exchange values are constrained.
**Verified:** 2026-07-23T18:05:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth (SC) | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `'mt5'` registered in lockstep across `Source` Literal + `SUPPORTED_SOURCES` + `_FACTORIES` (mirroring `sfox`), parity tests green (MT5SRC-01) | ✓ VERIFIED | `adapter.py:59` Source Literal includes `"mt5"`; `ingestion/__init__.py:117` SUPPORTED_SOURCES tuple includes `"mt5"`; `_FACTORIES["mt5"]=_make_mt5_adapter` (`:189`). 62 python parity/unit tests pass. |
| 2 | Worker `validate`/`is_mt5` branch proves auth+read via login+`account_info()`, structural read-only (no `order_*` surface) + `order_check` investor-vs-master reject; master REJECTED w/ targeted copy, never persisted; bad creds → `KEY_AUTH_FAILED`; `order_send` never called (MT5SRC-02) | ✓ VERIFIED | `routers/exchange.py:317` intercepts mt5 BEFORE ccxt; `_validate_mt5_key` probes login+account_info+order_check only. `grep -c order_send routers/exchange.py` = **0**. Mt5Client exposes only login/account_info/history_deals_get/order_check/close — no trade method. Three failure paths: auth→AUTH_FAILED, wrong_server→MT5_WRONG_SERVER, master→MT5_MASTER_PASSWORD (400, never persisted). test_mt5_validate.py green. |
| 3 | Three MT5 credential fields (login/investor pw/broker server) map to `{api_key, api_secret, passphrase}` slots, documented loudly at one chokepoint; broker server required & wrong-server distinguishable from bad password (MT5SRC-02) | ✓ VERIFIED | LOUD slot-map comment block at the encrypt chokepoint `routers/exchange.py:365-381`; adapter + branch both read login→api_key, investor pw→api_secret, server→passphrase. Empty server → `MT5_WRONG_SERVER_DETAIL` (distinct from AUTH_FAILED). |
| 4 | All 3 Next.js key routes accept `mt5`; RED-guarded migration admits `'mt5'` at EXACTLY 4 CHECKs (invalid still rejected), TEST-applied+verified (MT5SRC-03) | ✓ VERIFIED | Migration `20260723172032` has exactly 4 real `ADD CONSTRAINT` (api_keys, compute_jobs w/ `IS NULL OR` preserved, strategies_source, strategy_verifications_source), each self-verifying `'mt5'`. SQL RED-guard `test_mt5_exchange_boundary.sql` asserts admit-mt5/reject-bogus/NULL per constraint. TS SUPPORTED_EXCHANGES/EXCHANGE_DISPLAY/STRATEGY_SOURCES widened. 3 routes accept mt5 (validate-and-encrypt via isMt5+isMt5EnabledServer; create-with-key + add-key via isSupportedExchange) and 400 invalid. TEST-apply DONE per orchestrator (not re-applied). |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `analytics-service/services/ingestion/mt5.py` | Mt5Adapter (validate impl; metrics/fetch_raw raise) | ✓ VERIFIED | 224 lines; `validate` implemented; `compute_metrics`/`fetch_raw` RAISE NotImplementedError (fail-loud, documented BYB-02 rationale). |
| `analytics-service/services/mt5_validation.py` | shared seam: probe builder + is_trade_capable + classify | ✓ VERIFIED | 106 lines; `mt5_probe_request`, `is_trade_capable`, `classify_mt5_login_error` present. |
| `analytics-service/services/closed_sets.py` | 3 MT5 detail strings + mt5_enabled_server() | ✓ VERIFIED | `MT5_DISABLED/MASTER_PASSWORD/WRONG_SERVER_DETAIL` + `mt5_enabled_server()` fail-closed. |
| `analytics-service/routers/exchange.py` | `_validate_mt5_key` + is_mt5 intercept + slot comment | ✓ VERIFIED | Intercept gated on `mt5_enabled_server()`; slot comment at chokepoint. |
| `supabase/migrations/20260723172032_...sql` | 4-constraint widen w/ self-verify DO blocks | ✓ VERIFIED | Exactly 4 constraints; nullable form preserved on compute_jobs; forward-dated. |
| `supabase/tests/test_mt5_exchange_boundary.sql` | RED guard admit/reject/NULL per constraint | ✓ VERIFIED | 9.5KB; per-constraint admit-mt5 + reject-bogus + NULL-preserved arms. |
| `src/lib/closed-sets.ts` | SUPPORTED_EXCHANGES + EXCHANGE_DISPLAY widened; isMt5EnabledServer | ✓ VERIFIED | `mt5` in SUPPORTED_EXCHANGES (`:39`), EXCHANGE_DISPLAY (`:54`); `isMt5EnabledServer()` (`:151`). |
| `src/lib/strategy-sources.ts` | STRATEGY_SOURCES widened | ✓ VERIFIED | `"mt5"` in STRATEGY_SOURCES (`:29`). |
| `src/lib/wizardErrors.ts` | 2 distinguishable codes + matcher branches | ✓ VERIFIED | `KEY_MT5_MASTER_PASSWORD`/`KEY_MT5_WRONG_SERVER` union types, copy entries, substring matchers (`:927/:930`). |

### Key Link Verification

| From | To | Via | Status |
| --- | --- | --- | --- |
| ingestion/__init__.py | ingestion/mt5.py | `_FACTORIES["mt5"]=_make_mt5_adapter` lazy import | ✓ WIRED |
| ingestion/mt5.py | mt5_validation.py | `from services.mt5_validation import classify_mt5_login_error, is_trade_capable, mt5_probe_request` | ✓ WIRED |
| routers/exchange.py | closed_sets.py | `mt5_enabled_server` gate + 3 MT5_*_DETAIL | ✓ WIRED |
| validate-and-encrypt/route.ts | closed-sets.ts | `isMt5EnabledServer` import + gate | ✓ WIRED |
| closed-sets.ts / strategy-sources.ts | newest migration | set-equality parity tests (onlyInSql/onlyInTs empty) | ✓ WIRED (64 parity tests pass) |
| wizardErrors.ts | closed_sets.py detail strings | substring pins "master password"/"broker server" | ✓ WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Python lockstep/validate/parity suites | `python3 -m pytest tests/test_ingestion_mt5.py tests/test_mt5_validate.py tests/test_boundary_literals_parity.py` | 62 passed | ✓ PASS |
| TS typecheck | `npx tsc --noEmit` | exit 0 | ✓ PASS |
| Route + wizardErrors + parity vitest | `npx vitest run` (5 files) | 201 passed (137 + 64) | ✓ PASS |
| No trade surface | `grep -c order_send routers/exchange.py` | 0 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
| --- | --- | --- | --- |
| MT5SRC-01 | 135-01 | ✓ SATISFIED | Source Literal + SUPPORTED_SOURCES + _FACTORIES lockstep; parity tests green. |
| MT5SRC-02 | 135-01/03/04 | ✓ SATISFIED | is_mt5 read-only validate branch, order_check-only probe, master-reject, 3 distinguishable codes, slot-map chokepoint. |
| MT5SRC-03 | 135-02/04 | ✓ SATISFIED | 4-constraint migration + SQL RED guard (TEST-applied), 3 routes accept mt5 / reject invalid, TS enum lockstep. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| --- | --- | --- | --- | --- |
| src/app/api/keys/validate-and-encrypt/route.ts | 132 | `TODO(phase-19+)` | ℹ️ Info | Pre-existing, references phased follow-up work; not a blocker (TODO, not TBD/FIXME/XXX). |
| src/lib/wizardErrors.ts | 473 | comment referencing `phase-17 hoist` TODOs | ℹ️ Info | Descriptive comment about pre-existing markers; not a new debt marker. |

No `TBD`/`FIXME`/`XXX` markers introduced. The `NotImplementedError` raises in `mt5.py` (compute_metrics/fetch_raw) are INTENTIONAL fail-loud tripwires (documented BYB-02 corruption-class rationale), owned by Phase 136 — not stubs.

### Human Verification Required

None. Live-broker validation against a real MT5 terminal is explicitly OUT of Phase 135 scope (Phase-134 human_needed spike / Phase-139 go-live). Phase 135 validates against the Phase-134 `Mt5Client` contract via offline transport doubles, and every must-have is provable by automated test + grep + the TEST-applied migration. No PLAN `<human-check>` blocks were deferred.

### Gaps Summary

No gaps. All four ROADMAP success criteria verify against the codebase: the Python source lockstep (Literal + registry + factory) with a green 62-test suite; the gated `is_mt5` read-only validate branch with zero `order_send` occurrences and three distinguishable failure paths; the exactly-4-constraint widening migration with its SQL RED-guard test (TEST-applied by the orchestrator); and the TS enum lockstep + 3 accepting key routes + 2 distinguishable wizard error codes, with `tsc` clean and 201 vitest tests green. Out-of-scope items (live broker, `create-with-key` asset_class hardcode → Phase 136) are correctly excluded.

---

_Verified: 2026-07-23T18:05:00Z_
_Verifier: Claude (gsd-verifier)_
