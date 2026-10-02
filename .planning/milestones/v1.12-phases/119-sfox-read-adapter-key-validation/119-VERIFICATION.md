---
phase: 119-sfox-read-adapter-key-validation
verified: 2026-07-18T19:24:07Z
status: human_needed
score: 3/3 must-haves code-verified
overrides_applied: 0
human_verification:
  - test: "Live prod sFOX read (SFOX-02 Task 2, Q3 LOCKED)"
    expected: "SfoxClient(api_key=<READ-ONLY prod key>) → read_sfox_account(client) returns real balances/trades/transactions (empty lists are a VALID honest result for an empty account); an exception is a failure to investigate. sFOX dashboard shows zero orders placed."
    why_human: "No un-pinned prod sFOX key in-session; an IP-whitelisted key additionally requires the phase-121 static egress. The milestone thesis is that a LIVE API read is ground truth (anti-CSV-fabrication) — it must NOT be faked. The mocked suite carries the phase; the live leg is founder-gated per RESEARCH A4/Q3."
  - test: "Prod DB migration auto-apply watch on merge"
    expected: "Merging supabase/migrations/20260718182056_sfox_exchange_boundary_checks.sql to main AUTO-applies to PROD (khslejtfbuezsmvmtsdn). The 4 self-verifying DO blocks RAISE on any missing value, so a silent no-op is impossible — but the founder should watch the migration run succeed and confirm pg_get_constraintdef on the 4 constraints contains 'sfox'."
    why_human: "This verifier has no Supabase MCP tool access to query prod/test DB state directly; the migration file is structurally self-verifying at apply, but the founder owns watching the prod auto-apply run per the supabase-migrations ops runbook."
---

# Phase 119: SFOX Read Adapter + Key Validation + DB Constraint-Widen Verification Report

**Phase Goal:** A user can connect an sFOX API key end-to-end — the read adapter pulls the account, every validation/encryption chokepoint accepts `sfox`, and the DB admits `'sfox'` everywhere an exchange value is constrained.
**Verified:** 2026-07-18T19:24:07Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

All three success criteria are **code-complete and verified**. The phase is held `human_needed` (not `passed`) solely because two items are correctly founder-gated: the live prod sFOX read (the milestone's anti-fabrication ground-truth leg, which must not be faked) and the prod DB migration auto-apply watch. No must-have failed. No gaps.

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | **SFOX-04** — DB admits `'sfox'` at exactly the 4 key-save CHECKs in lockstep with TS + pydantic allowlists; ingestion `Source` Literal deliberately NOT widened | VERIFIED | Migration widens `api_keys.exchange`, `compute_jobs.exchange` (nullable `IS NULL OR` form preserved + guarded), `strategies.source`, `strategy_verifications.source`; each has a self-verifying DO block. SKIP set (funding_fees/position_snapshots/verification_requests VIEW) appears only in comments (0 executable hits). TS `SUPPORTED_EXCHANGES`/`EXCHANGE_DISPLAY.sfox="sFOX"`/`STRATEGY_SOURCES` + `schemas.py VerifyStrategyRequest.exchange` + `debug_key_flow.Broker` all admit sfox. `services/ingestion/adapter.py::Source` correctly EXCLUDES sfox with an explanatory Phase-119 comment (factory is 120). Parity test `test_boundary_literals_parity.py` green. |
| 2 | **SFOX-03** — worker `validate_key` branches for sfox via SfoxClient (never ccxt); api_secret carve-out sfox-only at all 3 routes; invalid key fails CLOSED → KEY_AUTH_FAILED; ccxt validation NOT weakened | VERIFIED | `routers/exchange.py:88` intercepts `req.exchange == "sfox"` BEFORE `create_exchange` (line 92); `_validate_sfox_key` has **0** `create_exchange`/`EXCHANGE_CLASSES` references, uses `SfoxClient.get_balances()`. 401/403 → `HTTPException(400, AUTH_FAILED_DETAIL)` (hoisted module constant shared with the ccxt arm at `services/exchange.py:26/1020`) → TS `classifyKeyValidationError` → KEY_AUTH_FAILED, zero TS edits. All non-auth (status 0/429/5xx) fail closed → 500, `aclose()` in finally. `read_only=True` asserted STRUCTURALLY (no fabricated scope triple). Carve-out keyed on `exchange === "sfox"` (validate-and-encrypt) / `exchange.toLowerCase() === "sfox"` (create-with-key, composite) ONLY. |
| 3 | **SFOX-02** — read pull of balances+trades+txns via SfoxClient (single-page), read-only asserted, fail-loud | VERIFIED (code); live leg human_needed | `services/sfox_read.py::read_sfox_account` composes exactly `get_balances`/`get_trades`/`get_transactions` (single-page, no cursor), `isinstance(SfoxClient)` boundary guard refuses write-capable objects before any read, fail-loud (SfoxApiError propagates untouched, no partial dict), caller owns session. 12 mocked tests pass. Live prod-read leg correctly `human_needed` (Q3 LOCKED) — this is the expected state, NOT a gap. |

**Score:** 3/3 truths code-verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `supabase/migrations/20260718182056_sfox_exchange_boundary_checks.sql` | Widen 4 CHECKs for sfox, self-verify DO blocks | VERIFIED | Newest migration (sorts after 20260717233529); 4 DROP/ADD CONSTRAINT + 4 DO blocks; compute_jobs nullable form + `IS NULL` guard preserved; forward-only |
| `supabase/tests/test_sfox_exchange_boundary.sql` | RED guard: admit sfox / reject bogus / NULL | VERIFIED | 4 parts; admit `'sfox'`, reject `notanexchange`/`notasource` via check_violation, compute_jobs NULL admitted; gen_random_uuid seeds cleaned up |
| `analytics-service/routers/exchange.py` | sfox validate branch before ccxt | VERIFIED | `_validate_sfox_key` helper + interceptor; no ccxt routing |
| `analytics-service/services/exchange.py` | AUTH_FAILED_DETAIL hoisted constant | VERIFIED | Module-level constant (line 26), referenced by ccxt arm (line 1020) |
| `analytics-service/services/sfox_read.py` | Thin 3-leg read pull, read-only + fail-loud | VERIFIED | isinstance guard + 3 GET compose; caller owns session |
| `src/app/api/keys/validate-and-encrypt/route.ts` | sfox api_secret carve-out (presence gate) | VERIFIED | `isSfox = exchange === "sfox"`; absent secret → `""` through shared chokepoint |
| `src/app/api/strategies/create-with-key/route.ts` | sfox carve-out (length gate) | VERIFIED | `isSfox = exchange.toLowerCase() === "sfox"`; `apiSecretNormalized`; 512 DoS bound kept |
| `src/app/api/strategies/composite/add-key/route.ts` | sfox carve-out (length gate) | VERIFIED | Structural mirror of create-with-key; same carve-out |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| validate_key router | SfoxClient | `if req.exchange=="sfox"` before create_exchange | WIRED | Branch intercepts pre-ccxt; helper uses SfoxClient only |
| sfox 401/403 | KEY_AUTH_FAILED (TS) | AUTH_FAILED_DETAIL shared constant → classifyKeyValidationError | WIRED | Byte-identical string; zero TS classifier edits; regression test pins Deribit invalid_credentials → KEY_AUTH_FAILED |
| 3 key routes | validateKey/encryptKey chokepoint | `apiSecretNormalized: ""` | WIRED | Tests assert `("sfox", token, "", undefined)` in all 3 routes |
| routes | create_wizard_strategy / add_wizard_composite_key RPC | `p_exchange: "sfox"` | WIRED | Test asserts `p_exchange==="sfox"`; DB CHECK admits per SFOX-04 |
| migration | TS/pydantic allowlists | parity contract test | WIRED | test_boundary_literals_parity green; TestSfoxMigrationWidensEveryKeyBoundaryCheck asserts the new migration file |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| sfox validate/read/parity suites | `pytest test_sfox_validate.py test_sfox_read.py test_boundary_literals_parity.py -q` | 37 passed | ✓ PASS |
| Full analytics-service suite (119-01 reds resolved) | `pytest -q` | 3867 passed, 95 skipped, 0 failures | ✓ PASS |
| 3 key-route carve-out + fence tests | `vitest run --no-file-parallelism <3 route.test.ts>` | 71 passed | ✓ PASS |
| sfox branch avoids create_exchange/EXCHANGE_CLASSES | grep `_validate_sfox_key` body | 0 references | ✓ PASS |
| ccxt fence pins binance/okx/bybit/deribit reject 7-char/empty/absent secret both routes | grep + read | `it.each(["binance","okx","bybit","deribit"])` × (7-char + empty) + validate-and-encrypt binance/deribit absent/empty | ✓ PASS |

### Security Fence (carve-out safety — CRITICAL)

The api_secret relaxation is proven **sfox-only** in both directions:
- **sfox admits** absent/null/empty secret → all normalize to `""` through the same trim/validate/encrypt funnel (asserted `("sfox", token, "", undefined)`).
- **ccxt unchanged**: binance/okx/bybit/deribit still reject 7-char, empty-string, AND absent secrets byte-identically (`"api_secret is required"` / `"Missing required fields"`), `validateKey` never called.
- **DoS bound retained**: a >512-char sfox secret still rejected.
- **api_key presence universal**: sfox with no api_key rejected (carve-out relaxes ONLY api_secret).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| SFOX-04 | 119-01 | DB + TS + pydantic boundary widen for sfox | SATISFIED | Truth 1 |
| SFOX-03 | 119-02, 119-03 | Non-ccxt validate branch + api_secret carve-out | SATISFIED | Truth 2 |
| SFOX-02 | 119-04 | sfox read pull (read-only, fail-loud) | SATISFIED (code); live leg human_needed | Truth 3 |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | No TBD/FIXME/XXX/HACK/PLACEHOLDER in any modified file | — | Clean. (Pre-existing `TODO(phase-19+)` / `DEPRECATED` comments in validate-and-encrypt/route.ts relate to the dormant unified handler from Phase 19, not introduced by Phase 119.) |

### Human Verification Required

1. **Live prod sFOX read (SFOX-02 Task 2, Q3 LOCKED)** — Mint/locate a READ-ONLY prod sFOX key (not IP-whitelisted, or wait for phase-121 static egress), run `SfoxClient(api_key=<key>)` → `read_sfox_account(client)`, confirm real balances/trades/transactions return (empty lists are a valid honest result for an empty account). Confirm no write endpoint hit (structural + sFOX dashboard shows no orders). This is the milestone's anti-fabrication ground-truth leg — a skip is never a pass.

2. **Prod DB migration auto-apply watch** — On merge to main, `20260718182056_sfox_exchange_boundary_checks.sql` auto-applies to prod. The 4 self-verifying DO blocks make a silent no-op impossible, but the founder should watch the run succeed and confirm `pg_get_constraintdef` on the 4 constraints contains `'sfox'`.

### Gaps Summary

None. All three success criteria (SFOX-02/03/04) are code-complete, tested, and wired. The security carve-out is proven safe both directions across all 3 routes and all 4 ccxt exchanges. The full analytics-service suite (3867 passed) confirms the 119-01 ingestion Source-Literal reds were correctly resolved (deferred-items.md option b: sfox held OUT of the ingestion `Source` Literal until the phase-120 factory). The two open items are correctly founder-gated by design (live ground-truth read + prod migration watch) — neither is a gap.

**Verifier note (DB state):** This verifier has no Supabase MCP tool access, so the claim that the migration was MCP-applied to the TEST project (qmnijlgmdhviwzwfyzlc) with the RED SQL test passing there could not be independently queried. The migration is structurally self-verifying at apply (DO blocks RAISE on any missing value) and the RED SQL test is well-formed. The prod auto-apply is captured as human-watch item #2.

---

_Verified: 2026-07-18T19:24:07Z_
_Verifier: Claude (gsd-verifier)_
