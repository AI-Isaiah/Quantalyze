---
phase: 119-sfox-read-adapter-key-validation
plan: 04
subsystem: api
tags: [sfox, read-adapter, aiohttp, fail-loud, read-only, ingestion-boundary]

# Dependency graph
requires:
  - phase: 118
    provides: "SfoxClient — read-only Bearer aiohttp adapter (get_balances/get_trades/get_transactions/get_balance_history), SfoxApiError with status semantics"
  - phase: 119-02
    provides: "the worker is_sfox validate branch that owns its SfoxClient lifecycle (the caller-owns-session pattern mirrored here)"
provides:
  - "services/sfox_read.py::read_sfox_account(client) — the SFOX-02 read pull: balances + trades + transactions in one call, single-page, read-only asserted at the ingestion boundary, fail-loud on any leg"
affects: [phase-120-reconstruction, sfox-ingestion, api_verified]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ingestion-boundary read-only assertion: isinstance(SfoxClient) guard refuses a write-capable object BEFORE any read (structural, not a probed-scope claim)"
    - "source-level write-surface grep gate (docstring + comment lines stripped via ast before scanning executable code) — mirrors 118's hasattr write-surface gate at the module-source level"

key-files:
  created:
    - analytics-service/services/sfox_read.py
    - analytics-service/tests/test_sfox_read.py
  modified: []

key-decisions:
  - "Read pull is THIN: composes only SfoxClient's three GET read methods, single-page (no cursor passed — crawl orchestration + asyncio.wait_for bounds are phase 120, FLIPRETRY-01). No daily-return reconstruction, no normalization, no DB writes, no ingestion _FACTORIES/SUPPORTED_SOURCES registration."
  - "Read-only enforced STRUCTURALLY at the ingestion boundary (A1): isinstance(SfoxClient) guard + module docstring stating GET-only; never a probed read-only-scope claim (sFOX exposes no per-key scope endpoint)."
  - "Caller owns the client session lifecycle — read_sfox_account never calls aclose (mirrors 119-02's validate branch)."
  - "Q3 LOCKED: the live prod-account read leg is founder-gated; recorded human_needed (no un-pinned prod sFOX key in-session). The mocked suite carries the phase — a live read was NOT faked."

patterns-established:
  - "Independent-oracle unit test (P115): each leg asserted against a distinct hand-authored fixture payload, never the module's own transform of it; a leg swap (balances<->trades) is caught."
  - "Per-leg fail-loud: parametrized SfoxApiError injection on each of the three legs proves the exception propagates untouched and NO partial dict is returned."

requirements-completed: [SFOX-02]

# Metrics
duration: ~15min
completed: 2026-07-18
---

# Phase 119 Plan 04: sFOX Read Pull Summary

**`read_sfox_account` reads an sFOX account's balances + trades + transactions in one call composed solely of `SfoxClient`'s GET reads — read-only asserted at the ingestion boundary, fail-loud on any leg, single-page (crawl deferred to phase 120).**

## Performance

- **Duration:** ~15 min
- **Tasks:** 1 of 2 executed autonomously; Task 2 (founder live-read) recorded human_needed per Q3
- **Files created:** 2

## Accomplishments
- `services/sfox_read.py::read_sfox_account(client)` — the SFOX-02 read pull: awaits `get_balances()` + `get_trades()` + `get_transactions()` (single-page, no cursor) and returns `{"balances", "trades", "transactions"}`.
- Read-only asserted at the ingestion boundary (T-119-12): a non-`SfoxClient` object is refused with `TypeError` before any read — a future ccxt-exchange (with `create_order`/`withdraw`) cannot be smuggled through this boundary. The structural GET-only adapter (118 WR-03) is the other half.
- Fail-loud (T-119-13 / no invented data): any leg's `SfoxApiError` propagates untouched with no partial/fabricated dict; an empty account returns honest empties; the caller owns the session lifecycle (no in-function `aclose`).
- 12 mocked unit tests (TDD RED→GREEN), independent-oracle style (P115): 3-leg compose against distinct fixtures, single-page/no-cursor, honest-empty, per-leg fail-loud (parametrized over all three legs), non-`SfoxClient` refusal (parametrized), and a source-level write-surface grep gate that strips the docstring + comments before scanning executable code.

## Task Commits

1. **Task 1: read_sfox_account — 3-leg read pull, read-only asserted, fail-loud** — `b94a4e1d` (feat)

_TDD: RED verified (test collection ImportError on the missing module) before GREEN; committed atomically as one feat since the plan task is a single logical feature and the repo pre-commit hooks run the suite (a test-only commit would red the hook)._

## Files Created/Modified
- `analytics-service/services/sfox_read.py` — `read_sfox_account(client: SfoxClient) -> dict`; isinstance boundary guard + thin 3-leg compose; read-only/fail-loud/scope documented in the module docstring.
- `analytics-service/tests/test_sfox_read.py` — 12 mocked contract tests (real `SfoxClient` with AsyncMock'd read methods so the isinstance boundary passes and the returned bytes are the fixtures verbatim).

## Verification
- `pytest tests/test_sfox_read.py -q` → **12 passed**.
- `pytest tests/test_sfox_*.py -q` (composed sfox surface: client + validate + read) → **62 passed, 2 skipped**.
- Full analytics-service suite → **3867 passed, 95 skipped** (pre-existing warnings only; no new failures).
- Write-surface grep gate: executable code references only `get_balances`/`get_trades`/`get_transactions`; zero order/withdraw/transfer/POST tokens outside prose.

## Scope Boundary (phase 120 kept OUT)
No crawl orchestration was built — reads are single-page, cursors surfaced by `SfoxClient` are NOT passed or looped. No daily-return / equity / `api_verified` reconstruction, no normalization, no DB writes, and NO ingestion `_FACTORIES` / `SUPPORTED_SOURCES` registration. These are all phase 120 (SFOX-05).

## Human-Needed (Task 2 — Q3 LOCKED live prod read)

The **live prod-account read leg is recorded `human_needed`** — no un-pinned prod sFOX key exists in-session, and an IP-whitelisted key additionally requires the phase-121 static egress. This is NOT a pass and was NOT faked; the mocked suite carries the phase. Founder runbook to close the leg:

1. Mint/locate a **READ-ONLY** prod sFOX key (NOT IP-whitelisted, or wait for phase 121's static egress — an IP-pinned key 401s from the wrong egress).
2. From `analytics-service/`, run a one-off: `SfoxClient(api_key=<key>)` → `read_sfox_account(client)` → confirm real balances/trades/transactions return. **Empty lists are a VALID honest result for an empty account**; an exception is a failure to investigate.
3. Confirm no write endpoint was hit — structural (the adapter has no write surface); the sFOX dashboard shows no orders placed.

Close at `/gsd:verify-work` as either `live-read-verified` (founder-confirmed) or explicitly `human_needed` — a skip is never a pass.

## Deviations from Plan
None — plan executed exactly as written.

## Self-Check: PASSED
- FOUND: analytics-service/services/sfox_read.py
- FOUND: analytics-service/tests/test_sfox_read.py
- FOUND commit: b94a4e1d
