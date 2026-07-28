---
phase: 68-boundary-wiring-key-validation
verified: 2026-07-04T21:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
requirements_verified: [DRB-02, DRB-03]
---

# Phase 68: Boundary Wiring & Key Validation — Verification Report

**Phase Goal:** Deribit is accepted at every KEY-SAVING boundary in lockstep (TS + pydantic + SQL CHECK + parity test, ONE PR), and only correctly-scoped read-only keys get through with honest errors.
**Verified:** 2026-07-04
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | "deribit" accepted at every key-saving boundary in ONE PR, parity-proven | ✓ VERIFIED | TS + 3 pydantic Literals + 4 SQL CHECKs + both-direction parity test all green (see below) |
| 2 | Any write scope (`:read_write`) rejected with an honest error naming the scope | ✓ VERIFIED | `detect_deribit_permissions` key_permissions.py:351-361 emits `"key has write scope '<tok>' — create a read-only key"`; surfaced as `TRADE_SCOPE` in exchange.py:968-975; test `test_write_scope_rejected_naming_the_token` green |
| 3 | Missing `account:read`/`trade:read` rejected naming the missing scope, before fetch_balance | ✓ VERIFIED | Precheck at exchange.py:959 returns at :975 BEFORE fetch_balance at :980; `MISSING_SCOPE` names scope; guard `test_missing_account_read_named_and_bypasses_fetch_balance` asserts `fetch_balance_calls == 0` |
| 4 | A compliant read-only (passphrase-less LTP) key passes and can be saved | ✓ VERIFIED | `test_compliant_key_valid_read_only_probes_once`: passphrase-less fake exchange → `valid`, `read_only is True`, `fetch_balance_calls == 1`; boundary admits deribit end-to-end |

**Score:** 4/4 truths verified

### Criterion 1 — Boundary lockstep (DRB-02) detail

| Boundary | Evidence | Status |
|----------|----------|--------|
| TS `SUPPORTED_EXCHANGES` + display map | closed-sets.ts:39 `["binance","okx","bybit","deribit"]`; EXCHANGE_DISPLAY:48-53 `deribit:"Deribit"`; `isSupportedExchange` checks 4-value set | ✓ |
| pydantic `VerifyStrategyRequest.exchange` | schemas.py:210 `Literal[...,"deribit"]` | ✓ |
| pydantic `Broker` | debug_key_flow.py:61 `Literal[...,"deribit"]` | ✓ |
| pydantic `Source` | adapter.py:28 `Literal[..., "csv", "deribit"]` | ✓ |
| 4 SQL CHECKs (ONE migration) | 20260704200446: api_keys, compute_jobs (nullable form preserved), strategies.source (9-value), strategy_verifications.source — each DROP/re-ADD + self-verify DO-block | ✓ |
| Parity test — CONTAIN direction | vitest set-equality `{onlyInSql:[], onlyInTs:[]}` (check-zod-db-check-parity.test.ts:414-421) across api_keys/strategy_verifications; pytest `get_args` set-equality on VerifyStrategyRequest.exchange (test_boundary_literals_parity.py:78) | ✓ |
| Parity test — EXCLUDE direction | funding_fees decoupled to FUNDING_EXCHANGES + `rejects:["deribit"]`; position_snapshots `rejects:["deribit"]`; pytest exclusion pins on SUPPORTED_SOURCES, process_key flow sets, `_FUNDING_BUCKET_HOURS`, funding CHECK migration text | ✓ |

### Load-Bearing Exclusion Invariants (phase's hardest invariant)

| Surface | Expected | Evidence | Status |
|---------|----------|----------|--------|
| `_FUNDING_BUCKET_HOURS` | 3-value, no deribit | funding_fetch.py:216-220 `{binance,okx,bybit}` | ✓ HOLDS |
| `SUPPORTED_SOURCES` | no deribit | ingestion/__init__.py:93 `("okx","binance","bybit","csv")` | ✓ HOLDS |
| `funding_fees_exchange_check` | stays 3-value | no `deribit` in funding migrations (grep) | ✓ HOLDS |
| `position_snapshots_exchange_check` | stays 3-value | no `deribit` in position migrations (grep); migration 20260704200446 deliberately does NOT touch it | ✓ HOLDS |
| UI chip surfaces stay 3-exchange | `EXCHANGES`/`UI_EXCHANGE_CODES` 3-value | closed-sets.ts:64-84 decoupled 3-value consts; EXCHANGES derives from UI_EXCHANGE_CODES:97 | ✓ HOLDS |

**Note on roadmap SC1 literal wording:** The roadmap SC1 lists "`_FUNDING_BUCKET_HOURS` entry" as a boundary to widen. The 68-CONTEXT.md locked decision (BYB-02 red-team finding, PR #577) explicitly supersedes that pre-BYB-02 wording — Deribit funding is continuous, so a floor-bucket entry would collapse distinct events. Funding surfaces are intentionally EXCLUDED this phase and the exclusion is parity-pinned with Phase-70 flip comments. This is a documented, governing deviation (Rule 7 — newer, evidence-backed pattern), confirmed by the verification prompt. Not a gap.

### UI Leak Fix (code-review H1, commit a1b9ac2e)

| Item | Evidence | Status |
|------|----------|--------|
| RequestIntroButton repointed | RequestIntroButton.tsx:9,24 imports `UI_EXCHANGE_CODES`; EXCHANGE_OPTIONS maps over it | ✓ PRESENT |
| Source-guard test added | closed-sets.test.ts:58-74 pins RequestIntroButton + VerificationForm to never import SUPPORTED_EXCHANGES; proven-fail on old import | ✓ PRESENT |
| No OTHER UI leak | Non-test src refs to SUPPORTED_EXCHANGES/exchangeEnum are all boundaries (verify-strategy route, debug-key-flow route, queries.ts membership Set, analytics-schemas, types.ts). Chip components PreferencesPanel/StrategyForm use the 3-value `EXCHANGES` display set, not SUPPORTED_EXCHANGES | ✓ CLEAN |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Vitest parity + closed-set pins | `vitest run check-zod-db-check-parity closed-sets` | 34 passed | ✓ PASS |
| Pytest scope-validation + boundary parity | `pytest test_deribit_scope_validation test_boundary_literals_parity test_funding_match_key_sql_parity` | 28 passed | ✓ PASS |
| Precheck-before-fetch_balance ordering | code read exchange.py:959→975→980 | precheck returns before fetch_balance | ✓ PASS |

### Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| DRB-02 | Deribit accepted at every boundary + parity test (same PR) | ✓ SATISFIED | Criterion 1 boundaries all widened + both-direction parity test green |
| DRB-03 | Key validation reads named scopes; reject unless read-only with account:read+trade:read; honest error | ✓ SATISFIED | detect_deribit_permissions + exchange.py wiring + 16 scope tests green |

Note: REQUIREMENTS.md ledger still shows DRB-03 as `[ ]`/"Pending" (lines 19, 85) — a documentation-lag artifact. The CODE delivers DRB-03 (wiring proven, all tests green). Informational only; not a code gap.

### Anti-Patterns Found

None. No unreferenced TBD/FIXME/XXX in modified files. Fail-CLOSED on probe exceptions with credential redaction (key_permissions.py:337-346). No stubs.

### Human Verification Required

None for this phase. The live Deribit scope-string format (67-03) is externally blocked on the founder key and explicitly deferred to Phase 72 acceptance (documented carry-forward A1, suffix-tolerant matching in the interim) — not a gap for Phase 68. No user-facing UI ships this phase (wizard is Phase 69).

### Gaps Summary

No gaps. All 4 success criteria verified against shipped code with file:line evidence. Both requirements (DRB-02, DRB-03) delivered. The hardest invariant — the funding/positions/ingestion exclusions staying 3-exchange while the key-save boundary widens to 4 — holds and is structurally pinned by both-runtime parity tests whose exclusion mutations were shown to bite. The one code-review-caught UI leak (RequestIntroButton) is fixed and guarded.

---

_Verified: 2026-07-04T21:00:00Z_
_Verifier: Claude (gsd-verifier)_
