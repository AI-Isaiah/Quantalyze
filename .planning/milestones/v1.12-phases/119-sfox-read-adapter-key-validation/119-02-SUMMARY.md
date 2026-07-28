---
phase: 119-sfox-read-adapter-key-validation
plan: 02
subsystem: api
tags: [sfox, key-validation, ccxt, bearer-token, fastapi, pytest, tdd]

# Dependency graph
requires:
  - phase: 118-sfox-read-adapter
    provides: SfoxClient read-only adapter (get_balances, SfoxApiError status semantics, bounded aclose)
  - phase: 119-01
    provides: DB exchange-value boundary widened to admit 'sfox' + TS/pydantic lockstep allowlists
provides:
  - Non-ccxt is_sfox branch in worker validate_key that proves auth+read via SfoxClient.get_balances()
  - Honest structural read_only=True shape (no fabricated scope probe)
  - 401/403 -> exact AUTH_FAILED_DETAIL string -> KEY_AUTH_FAILED with zero TS edits
  - Fail-closed mapping for all non-auth failures (status==0/429/5xx)
  - AUTH_FAILED_DETAIL hoisted to a single module-level constant in services/exchange.py
affects: [phase-120-sfox-reconstruction, phase-122-sfox-wizard-ui, key-connect]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-ccxt exchange validation: branch BEFORE create_exchange, validate via a dedicated adapter, never route through EXCHANGE_CLASSES"
    - "Cross-language error-string contract pinned via a single hoisted constant + a byte-identity test"

key-files:
  created:
    - analytics-service/tests/test_sfox_validate.py
  modified:
    - analytics-service/routers/exchange.py
    - analytics-service/services/exchange.py

key-decisions:
  - "Hoisted the AUTH_FAILED string to services.exchange.AUTH_FAILED_DETAIL (single source) rather than duplicating the literal in the router"
  - "is_sfox branch lives in a small _validate_sfox_key helper for readability; intercepts BEFORE create_exchange"
  - "read_only=True is asserted STRUCTURALLY (A1) — never a probed {read,trade,withdraw} triple (sFOX has no scope endpoint)"

patterns-established:
  - "Additive exchange branch: ccxt path stays byte-for-byte unchanged; a binance regression test pins branch placement"
  - "Fail-closed non-auth mapping: transport/shape/429/5xx -> 500, detail never contains 'authentication failed'"

requirements-completed: [SFOX-03]

# Metrics
duration: ~35min
completed: 2026-07-18
---

# Phase 119 Plan 02: Non-ccxt sFOX validate branch Summary

**The worker `validate_key` path now accepts `exchange=='sfox'` via the Phase-118 SfoxClient (auth+read proof through `get_balances()`), returning an honest structural `read_only=True`, mapping 401/403 to the exact existing AUTH_FAILED string for zero-edit TS KEY_AUTH_FAILED classification, and failing closed on every other error — with the ccxt path untouched.**

## Performance

- **Duration:** ~35 min
- **Started:** 2026-07-18
- **Completed:** 2026-07-18
- **Tasks:** 2
- **Files modified:** 3 (2 modified, 1 created)

## Accomplishments
- `_validate_sfox_key` helper + `if req.exchange == "sfox"` interceptor added to `routers/exchange.py::validate_key`, BEFORE `create_exchange` — sFOX never touches the ccxt `EXCHANGE_CLASSES` path.
- Auth proof = a single `SfoxClient.get_balances()` (GET /v1/user/balance); success returns `{"valid": True, "read_only": True}` with `read_only` asserted structurally (adapter has no write surface; no scope endpoint exists — A1, no invented data).
- 401/403 → `HTTPException(400, AUTH_FAILED_DETAIL)`; the string was hoisted to a single module-level constant in `services/exchange.py` so the ccxt arm and the sfox branch share one source and the TS classifier needs no edit.
- All non-auth failures (status==0 transport/shape, 429, 5xx) fail CLOSED → 500, never `valid:true`, never mislabelled as auth; `client.aclose()` awaited on every path via `finally`.
- Empty `api_secret` accepted (single Bearer token, Q1 worker contract); `encrypt_credentials` empty-secret round-trip proven (no encrypt branch needed).
- 12-case TDD unit suite (`test_sfox_validate.py`); ccxt (binance) regression test pins the unchanged path.

## Task Commits

Each task was committed atomically:

1. **Task 1: is_sfox branch — auth+read proof, fail-closed, honest shape** - `67d93833` (feat) — TDD: test written RED first (9 fail), then implemented GREEN (10 pass).
2. **Task 2: composed-state regression — empty-secret encrypt round-trip + AUTH-string pin** - `2ea70e58` (test)

_Plan metadata (SUMMARY/STATE/ROADMAP) is gitignored (`.planning/**`) — not committed._

## Files Created/Modified
- `analytics-service/routers/exchange.py` - Added `SfoxClient/SfoxApiError/SFOX_PROD_BASE_URL` import, the `AUTH_FAILED_DETAIL` import, the `_validate_sfox_key` helper, and the `is_sfox` interceptor before `create_exchange`.
- `analytics-service/services/exchange.py` - Hoisted the AUTH-failure detail into the module-level `AUTH_FAILED_DETAIL` constant; the ccxt AUTH_FAILED arm now references it.
- `analytics-service/tests/test_sfox_validate.py` - New 12-case suite: success/bearer-ctor/empty-secret/401/403/status0/429/5xx/aclose-on-failure/ccxt-regression + encrypt round-trip + AUTH-constant cross-language pin.

## Decisions Made
- Hoisted `AUTH_FAILED_DETAIL` to a single constant (plan gave discretion; single-source chosen over duplicate-with-pin) and added a byte-identity test guarding the cross-language KEY_AUTH_FAILED contract.
- Branch implemented as a small `_validate_sfox_key` helper (plan discretion).
- `encrypt_key` left untouched (verified empty-secret tolerant) — confirmed by the round-trip test, matching RESEARCH.

## Deviations from Plan
None - plan executed exactly as written. (The AUTH-string hoist and the helper-vs-inline choice were both explicitly Claude's discretion in the plan.)

## Issues Encountered

**Pre-existing full-suite failures from 119-01 (out of scope, NOT introduced by this plan):**
- `tests/test_ingestion_protocol.py::test_literal_types` and `tests/test_ingestion_deribit.py::test_source_literal_and_registry_agree` fail because commit `ca59a0ba` (119-01) added `'sfox'` to the ingestion `Source` Literal (`services/ingestion/adapter.py:28`) without updating the `SUPPORTED_SOURCES`/`_FACTORIES` registry or the two tests' expected sets.
- These files are entirely outside 119-02's scope (`routers/exchange.py`, `services/exchange.py`, `tests/test_sfox_validate.py` — none import the ingestion adapter). 119-02 introduces **zero** new failures.
- Logged to `deferred-items.md` for the 119-01 / phase-120 owner. RESEARCH item #11/#96 flagged the Source-Literal-vs-registry asymmetry but called it "safe"; the existing agreement tests show it is not test-clean and needs a 119-01 follow-up (update the two test fixtures, or defer the Source-Literal sfox add to 120 alongside the factory).

## Verification
- `pytest tests/test_sfox_validate.py -q` → **12 passed**.
- `pytest tests/ -q -k "sfox or validate or exchange or encrypt"` → **376 passed, 7 skipped**.
- `grep -n "sfox" routers/exchange.py` → branch appears ONLY in `validate_key` (via `_validate_sfox_key`), not in `encrypt_key` or `fetch_trades`.
- ccxt path confirmed unchanged: binance regression test green; `services/exchange.py` change is a pure constant-hoist (318 validate/exchange tests green).
- Full suite: 3853 passed, 95 skipped, **2 pre-existing failures from 119-01** (documented above, out of scope).

## User Setup Required
None - no external service configuration required. (A live prod sFOX read is founder-gated on phase-121 egress per RESEARCH A4; the committed unit suite carries the phase.)

## Next Phase Readiness
- The single worker validation surface all 3 Vercel key routes delegate to now admits sfox. Combined with 119-01's allowlist widen, a sFOX Bearer token can flow through validate.
- **Blocker to clear before merge (119 phase gate):** resolve the 2 pre-existing 119-01 ingestion Source-Literal test failures — the full analytics-service suite must not be left red.
- Phase 120 owns the reconstruction adapter + `SUPPORTED_SOURCES`/`_FACTORIES` sfox registration + the `api_verified` stamp.

## Self-Check: PASSED

- All created/modified files present on disk (test_sfox_validate.py, routers/exchange.py, services/exchange.py, 119-02-SUMMARY.md).
- Both task commits present in git history (67d93833, 2ea70e58).

---
*Phase: 119-sfox-read-adapter-key-validation*
*Completed: 2026-07-18*
