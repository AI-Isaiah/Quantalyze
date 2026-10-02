---
phase: 118-sfox-research-adapter-contract
plan: 01
subsystem: api
tags: [sfox, aiohttp, exchange-adapter, rate-limit, proxy, bearer-auth, python]

# Dependency graph
requires:
  - phase: 118-sfox-research-adapter-contract
    provides: "118-RESEARCH.md — the pinned SfoxClient contract (Bearer auth, 4 read endpoints, prod/sandbox base URLs, 1 req/10s transactions limit, explicit-proxy seam)"
provides:
  - "SfoxClient — a non-ccxt, read-only aiohttp adapter (services/sfox_client.py) with Bearer auth, both base URLs, all four documented read methods, an explicit per-request proxy seam, a per-endpoint rate gate, and a bounded idempotent aclose"
  - "SfoxApiError — a typed fail-loud error carrying HTTP status (401/403 distinguishable) with api_key-scrubbed messages"
  - "SFOX_PROD_BASE_URL / SFOX_SANDBOX_BASE_URL canonical constants for later phases to import"
  - "A pure-unit contract suite (tests/test_sfox_client.py) that runs green in CI with zero network / zero credentials"
affects: [119-key-routes-db-widen, 120-equity-reconstruction, 121-static-ip-proxy]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Non-ccxt exchange adapter sits BESIDE EXCHANGE_CLASSES, never inside it (imports nothing from exchange.py)"
    - "Single _request chokepoint owns auth, explicit proxy=, rate gate, and fail-loud parse"
    - "Explicit optional proxy ctor arg threaded per request (trust_env=False) — the phase-121 static-IP seam"
    - "Injectable clock/sleep make the strict rate gate assertable in milliseconds"
    - "Bounded idempotent aclose mirroring exchange.py::aclose_exchange discipline"

key-files:
  created:
    - analytics-service/services/sfox_client.py
    - analytics-service/tests/test_sfox_client.py
  modified: []

key-decisions:
  - "Read-only by construction: only get_balances/get_transactions/get_trades/get_balance_history exist — no order/withdraw/transfer method (grep-gated, T-118-02)"
  - "_request reads response via text() + json.loads (not resp.json()) so non-JSON 2xx bodies fail loud and the mock seam is simple"
  - "Single-page reads only — cursors (after/last_seen_id) exposed; crawl orchestration deferred to phase 120 (FLIPRETRY-01 anti-wedge)"
  - "Rate gate is per-endpoint-path (transactions 10s, default 1s), enforced in _request so no call site can bypass it"

patterns-established:
  - "Pattern: exchange adapters that are not ccxt get a standalone client + their own dispatch seam, keeping create_exchange's ccxt.Exchange return type honest"
  - "Pattern: money/credential adapters scrub response text via services.redact.scrub_freeform_string before it can reach any error/log surface"

requirements-completed: [SFOX-01]

# Metrics
duration: ~20min
completed: 2026-07-18
---

# Phase 118 Plan 01: SFOX adapter contract Summary

**Non-ccxt read-only `SfoxClient` (aiohttp, Bearer auth, prod+sandbox base URLs, four documented read endpoints, explicit per-request proxy seam, strict 1-req/10s transactions rate gate, bounded aclose) proven by a 25-test offline contract suite.**

## Performance

- **Duration:** ~20 min
- **Tasks:** 2 (both TDD: RED → GREEN)
- **Files modified:** 2 (both created)
- **Test suite:** 25 tests, green offline in <1s

## Accomplishments
- `SfoxClient` with Bearer auth (`Authorization: Bearer <key>`), prod/sandbox base-URL switch, and trailing-slash normalization
- Explicit optional `proxy` ctor arg threaded into every `session.request(..., proxy=)` call (trust_env=False) — the phase-121 static-IP seam wired-by-contract from day one
- All four documented read methods against exact endpoint paths, with `{data:[...]}` envelope unwrap for trades/balance_history and bare-array handling for balances/transactions
- Fail-loud everywhere: non-2xx → typed `SfoxApiError(status)`, non-JSON 2xx, non-list balances, and missing `data` envelope all raise; api_key scrubbed out of error messages
- Per-endpoint-path rate gate in the single `_request` chokepoint (transactions 10s, others 1s default), asserted with an injected clock so the suite stays sub-second
- Bounded, idempotent `aclose` mirroring `aclose_exchange` so a hung teardown degrades to a logged leak rather than wedging the sequential worker

## Task Commits

TDD tasks — each has a RED (test) then GREEN (feat) commit:

1. **Task 1: SfoxClient core (ctor/Bearer/proxy/get_balances/fail-loud)**
   - `cd7c88da` (test) → `6c165eda` (feat)
2. **Task 2: paginated reads (transactions/trades/balance_history) + rate gate**
   - `43f7cae8` (test) → `ee5d97a2` (feat)

_Note: `.planning/**` is gitignored/local in this repo — no metadata commit; SUMMARY/STATE/ROADMAP are written to disk only._

## Files Created/Modified
- `analytics-service/services/sfox_client.py` - Non-ccxt read-only sFOX adapter: 4 read methods, single `_request` chokepoint (auth + explicit proxy + rate gate + fail-loud parse), `SfoxApiError`, canonical base-URL constants, bounded `aclose`
- `analytics-service/tests/test_sfox_client.py` - 25 pure-unit contract tests: auth header shape, base-URL switch, proxy threading (present + None), read-only surface, wire param names, envelope unwrap, cursor plumbing, rate gate (injected clock), secret-scrubbed fail-loud errors

## Decisions Made
- Read response via `text()` + `json.loads` rather than `resp.json()`, so a non-JSON 2xx body fails loud and the AsyncMock seam needs only `.status` + `.text()`.
- Kept `get_transactions`/`get_trades`/`get_balance_history` single-page (cursors exposed, no auto-crawl) — crawl orchestration with `asyncio.wait_for` bounds is explicitly deferred to phase 120 per FLIPRETRY-01; documented in the module docstring so phase 120 doesn't misread this as a bug.
- Nothing added to `EXCHANGE_CLASSES`; `sfox_client.py` imports nothing from `exchange.py` (verified). The `is_sfox` dispatch seam is phase 119.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Test helper eagerly `json.loads`-ed non-JSON stub bodies**
- **Found during:** Task 1 (GREEN run)
- **Issue:** The `_stub_response` test helper set `resp.json = AsyncMock(return_value=json.loads(body))`, which raised at stub-construction time for the intentionally non-JSON error-body cases (401/403/`<html>`), failing three tests for the wrong reason.
- **Fix:** Dropped the unused `.json` mock from the helper; the implementation parses via `text()` + `json.loads`, so the stub only needs `.status` + `.text()`.
- **Files modified:** analytics-service/tests/test_sfox_client.py
- **Verification:** All 15 Task-1 tests green.
- **Committed in:** `6c165eda` (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug, in test harness).
**Impact on plan:** Test-harness-only fix; production adapter matches the plan exactly. No scope creep.

## Issues Encountered
- Local `python` shim is absent; the analytics-service venv interpreter is `analytics-service/.venv/bin/python`. Used it for all pytest runs. CI is unaffected.

## Threat Model Coverage
- **T-118-01 (info disclosure):** `SfoxApiError` never contains the api_key/Authorization header; response text scrubbed via `scrub_freeform_string`. Pinned by `test_error_message_scrubs_api_key`.
- **T-118-02 (tampering/EoP):** read-only surface — grep gate exits 1; `test_read_only_surface_no_write_methods` asserts no create_order/place_order/cancel_order/withdraw/transfer attribute.
- **T-118-03 (DoS):** per-endpoint rate gate (transactions 10s); single-page reads only. Pinned by `test_transactions_rate_gate_enforces_10s`.
- **T-118-04 (spoofed input):** non-JSON 2xx, non-list balances, missing `data` envelope all raise. Pinned by dedicated tests.
- **T-118-SC (supply chain):** zero new packages — `aiohttp` already vendored; mocking via stdlib `unittest.mock`.

## Known Stubs
None — the adapter is fully wired against the documented contract. Single-page reads are an intentional, documented boundary (crawl orchestration is phase 120), not a stub.

## User Setup Required
None for this plan. The founder-gated sFOX **sandbox** smoke test (SC-3, `SFOX_SANDBOX_API_KEY` against `api.staging.sfox.com`) is plan 118-02 / phase-close scope — the committed contract suite carries this plan.

## Next Phase Readiness
- Phase 119 can build the `is_sfox` ingestion-boundary dispatch seam + key-route/DB-constraint widening on top of `SfoxClient` and the exported base-URL constants.
- Phase 120 has the four read methods (primary `balance/history` `usd_value` series + independent `transactions` cashflow oracle) with threadable cursors for bounded crawls.
- Phase 121 has the explicit `proxy` seam ready to wire to a Fly.io static IP.

---
*Phase: 118-sfox-research-adapter-contract*
*Completed: 2026-07-18*

## Self-Check: PASSED
- All 2 created files present on disk.
- All 4 task commits (cd7c88da, 6c165eda, 43f7cae8, ee5d97a2) present in git history.
- Contract suite: 25 passed offline in <1s. Read-only grep gate exits 1. EXCHANGE_CLASSES untouched.
