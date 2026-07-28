---
phase: 75-deribit-dated-flow-adapter-risky
plan: 01
subsystem: testing
tags: [python, deribit, external-flows, namedtuple, twr, fixtures, pytest]

# Dependency graph
requires:
  - phase: 73-nav-twr-core
    provides: "reconstruct_nav_and_twr(external_flows=...) core that unpacks (day, usd) positionally via _flows_to_daily_usd"
  - phase: 74-funnel-wiring
    provides: "both callers thread external_flows through the core (NavTWRMeta guard keys)"
provides:
  - "services/external_flows.py — the ONE venue-agnostic ExternalFlow(utc_day_iso, usd_signed) contract (pure, no I/O); drop-in for the core's positional unpack; Phase 76 ccxt adapters import it verbatim"
  - "validate_flow_shape() — optional shape-only validator (non-finite usd / empty day rejected; T-75-01)"
  - "tests/fixtures/deribit_flow_fixtures.py — 5 LTP068-shaped synthetic Deribit txn-log scenario builders + per-day BTC index constants, consumed by Waves 2/3/4"
affects: [75-02, 75-03, 75-04, phase-76-ccxt-flow-adapters]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Venue-agnostic dated-flow contract as a 2-field NamedTuple that unpacks positionally to match the core's (day_raw, usd_raw = flow)"
    - "In-process synthetic txn-log stub fixtures (NOT vcrpy) as parametrizable builders, mirroring the existing Deribit test style"
    - "Distinct per-day settlement-index constants so a cross-time index substitution is detectable by downstream mutation-honest proofs"

key-files:
  created:
    - analytics-service/services/external_flows.py
    - analytics-service/tests/test_external_flows.py
    - analytics-service/tests/fixtures/deribit_flow_fixtures.py
    - analytics-service/tests/test_deribit_flow_fixtures.py
  modified: []

key-decisions:
  - "ExternalFlow is a NamedTuple (not a dataclass) so it IS a real 2-tuple — the core's `day_raw, usd_raw = flow` consumes it with zero adaptation"
  - "validate_flow_shape() is SHAPE-only (finite usd, non-empty day) and returns the flow unchanged; the core keeps ownership of the authoritative _coerce_float / _row_utc_day fail-loud business logic (no duplication)"
  - "external_flows.py imports stdlib `math` + typing.NamedTuple ONLY — no ccxt/pandas/numpy/os/requests/httpx and no services.* coupling, verified by a source-scan test"
  - "Fixtures are in-process synthetic stubs (75-RESEARCH.md Q6 VCR-vs-stub resolution), not vcrpy cassettes; LTP068 rows do not exist in-repo so all 5 scenarios are hand-built from the deribit_txn.py row schema"
  - "Per-day BTC index constants are DISTINCT (42000 / 45000 / 41000) so the 75-02 event-time proof reddens on a different-day index substitution; scenario 3 carries NO index (fail-loud precondition), scenario 5's index is supplied by the C1 fetch downstream"

patterns-established:
  - "One flow shape consumed by the core regardless of venue (FLOW-01) — interface-first ordering: downstream waves receive the contract + fixtures rather than exploring for them"

requirements-completed: [FLOW-01]

# Metrics
duration: 40min
completed: 2026-07-06
---

# Phase 75 Plan 01: ExternalFlow Contract + LTP068-Shaped Deribit Flow Fixtures Summary

**The ONE venue-agnostic `ExternalFlow(utc_day_iso, usd_signed)` NamedTuple contract (pure, positionally-unpackable, drop-in for the honest core) plus the 5 shared LTP068-shaped synthetic Deribit txn-log flow-scenario builders every downstream Phase-75 wave consumes.**

## Performance

- **Duration:** ~40 min
- **Started:** 2026-07-06T00:48Z (after Phase 74 close)
- **Completed:** 2026-07-06T01:26Z
- **Tasks:** 2
- **Files created:** 4 (0 modified)

## Accomplishments
- `services/external_flows.py` — the FLOW-01 contract: an `ExternalFlow` NamedTuple that unpacks positionally as `(utc_day_iso, usd_signed)`, exactly matching the core's `day_raw, usd_raw = flow` (nav_twr.py:124). Pure/I-O-free; Phase 76 ccxt adapters import it verbatim.
- `validate_flow_shape()` — optional shape-only validation (non-finite `usd_signed` / empty `utc_day_iso` rejected, T-75-01) that returns the flow unchanged so it can be inlined.
- `tests/fixtures/deribit_flow_fixtures.py` — 5 parametrizable, pure builders returning synthetic Deribit txn-log rows for the exact Wave-0 scenarios (linear USDC deposit; inverse BTC withdrawal WITH own same-day index; inverse BTC withdrawal WITHOUT index → C1 fail-loud; dominating withdrawal → flow_dominated_guard; pure-flow no-trade day → r_t==0), with distinct per-day BTC index constants exported for the event-time proof.
- Two self-tests (23 cases) pinning the contract's positional unpack + purity and the fixtures' scenario identity + sign/index conventions.

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): failing FLOW-01 contract test** - `5ec12270` (test)
2. **Task 1 (GREEN): ExternalFlow contract** - `66ddf031` (feat)
3. **Task 2: 5 LTP068-shaped flow fixtures + self-test** - `fb52ec83` (test)

**Plan metadata:** (this SUMMARY + STATE/ROADMAP) — see final docs commit.

## Files Created/Modified
- `analytics-service/services/external_flows.py` - FLOW-01 `ExternalFlow` NamedTuple contract + `validate_flow_shape()` (pure, stdlib+typing only)
- `analytics-service/tests/test_external_flows.py` - positional-unpack drop-in test, named-field access, shape-validator rejections, purity source-scan
- `analytics-service/tests/fixtures/deribit_flow_fixtures.py` - 5 synthetic txn-log scenario builders + per-day BTC index constants (`BTC_INDEX_2026_03_14/16/17`, `REFERENCE_PRIOR_NAV_USD`)
- `analytics-service/tests/test_deribit_flow_fixtures.py` - shape self-test (schema validity, scenario 1 linear/deposit>0, scenarios 2-5 inverse BTC/withdrawal<0, scenario 2 own-index / scenario 3 no-index, dominating vs sub-NAV magnitudes, distinct index constants)

## Decisions Made
- **NamedTuple over dataclass** — an `ExternalFlow` IS a real 2-tuple, so the core consumes it with zero adaptation and it stays trivially importable by Phase 76.
- **Shape-only validator** — `validate_flow_shape()` rejects only the two silently-corrupting shapes (non-finite USD, empty day) and returns the flow unchanged; the core retains the authoritative fail-loud coercion/dating (no business-logic duplication, per plan).
- **In-process synthetic stubs, not vcrpy** — resolved the CONTEXT "VCR fixtures" wording against the actual Deribit test infra (75-RESEARCH.md Q6); no LTP068 rows exist in-repo, so all 5 scenarios are hand-built from the row schema.
- **Distinct per-day index constants** — so the downstream event-time proof (75-02) reddens on a cross-time index substitution; scenario 3 deliberately carries no index (C1 fail-loud), scenario 5's index arrives via the extended C1 fetch.

## Deviations from Plan

None - plan executed exactly as written. The optional shape validator (`validate_flow_shape`) permitted by FLOW-01 was included; the `tests/fixtures/` namespace package resolved `tests.fixtures.deribit_flow_fixtures` without needing a new `__init__.py` (verified by a green import), so none was added.

## Issues Encountered
None.

## Verification
- `pytest tests/test_external_flows.py tests/test_deribit_flow_fixtures.py -q` → **23 passed** (CI-3.12 venv).
- Source-scan: `grep -nE '^(import|from) ' services/external_flows.py | grep -Ev '(typing|__future__)'` → only `import math` (stdlib; no ccxt/pandas/os/requests/httpx). Contract is pure.
- Wave-merge sampling suite (`test_deribit_txn` + `test_deribit_ingest` + `test_nav_twr` + `test_derive_broker_dailies_dualmode` + both new) → **144 passed**.
- **Full analytics suite: 3000 passed, 92 skipped** in the CI-3.12 venv (baseline 2971/92; +29 new parametrized cases). No new warnings attributable to the new modules.

## Known Stubs
The 5 fixture builders are intentional SYNTHETIC test scaffold (no real LTP068 rows exist in-repo per 75-RESEARCH.md A2/A3). They are consumed by Waves 2/3/4 — not production stubs. No production stubs introduced (this plan adds a pure contract module + test-only fixtures; no data-source wiring).

## TDD Gate Compliance
Task 1 followed RED → GREEN: `test(75-01)` (`5ec12270`, failing import) then `feat(75-01)` (`66ddf031`, green). Task 2 is fixture scaffold committed as `test(75-01)` (`fb52ec83`). No REFACTOR commit needed (contract minimal, green first pass).

## Next Phase Readiness
- **75-02 (RISKY valuation + Finding C1)** can now import `ExternalFlow` and all 5 fixtures. The event-time proof anchors on the exported per-day index constants; the fail-loud proof uses `inverse_flow_day_without_index_rows` (no supplemental index → `LedgerValuationError`); the C1 index-fetch extension is validated against that same quiet-day scenario; the flow-neutral / dominating SC4 proofs use `pure_flow_no_trade_rows` (sub-NAV, r_t==0) and `dominating_withdrawal_rows` (flow_dominated_guard).
- No blockers. Contract + fixtures are the Wave-0 foundation; no valuation logic or F1 deletion in this plan (Waves 2/3).

---
*Phase: 75-deribit-dated-flow-adapter-risky*
*Completed: 2026-07-06*

## Self-Check: PASSED
All 4 created files present; all 3 task commits (5ec12270, 66ddf031, fb52ec83) in git log.
