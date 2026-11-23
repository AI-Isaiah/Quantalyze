# Phase 215: TESTREACH - Context

**Gathered:** 2026-11-15
**Status:** Ready for planning (founder answered the one open decision on 2026-11-15)

<domain>
## Phase Boundary

CI-only phase (ROADMAP Phase 215, SC-8: no migration; Goal: "no product behaviour changes"). Every test that guards money math or an error contract runs in some CI environment, and test apps are built the way production builds them. Scope is exactly SC-1..SC-9 of the ROADMAP entry and the TODOS entries it names: "Tests that run in NO environment", the bare-`FastAPI()` entry, "Worker raises an HTTP exception", `ROSTER-DERIVE-01`, `D-161-01`, the 403-vs-422 split, and the teaser-bucket saturation alert.

</domain>

<decisions>
## Implementation Decisions

### 403-vs-422 split (SC-7 b) — founder decision 2026-11-15
- SC-7 (b), the 403-vs-422 split in `_scope_rejected` (`analytics-service/routers/process_key.py`, the `_scope_rejected = (` gate). It changes or pins a public API error contract, so it is not decided here. Measured at 3f29f1539 with the adapter mocked (teaser flow, same gate): `AUTH_FAILED` gives 403 with recoverable false; no error_code plus `read_only=False` (our `VALIDATION_UNEXPECTED` fallback) gives 403 with recoverable false; `PARSE_ERROR` and `CSV_VALIDATION_FAILED` (the `first_rule.upper()` CSV family) give 424 with recoverable true. So the TODOS premise "a malformed CSV answers 403" is stale since PYAPIFIX-02: every non-permanent code, including every CSV rule code, now takes the 424 venue-transient arm. The second gate, `services/ingestion/long_fetch.py` `_scope_rejected`, returns a worker DispatchResult, not an HTTP status, so the 403/422 question applies to the route only. `src/lib/process-key-client.ts` branches on `body.ok`, never on status, so a status change does not change TS routing, but `recoverable` reaches the wizard envelope.
- **FOUNDER DECISION 2026-11-15: Option A, "Pin today, book fix".** Phase 215 changes no behaviour. It pins every current status in the route `_scope_rejected` gate per arm: permanent codes (`AUTH_FAILED`, `PERMISSION_DENIED`, `TRADE_SCOPE`, `WITHDRAW_SCOPE`, `MISSING_SCOPE`) and our `VALIDATION_UNEXPECTED` fallback answer 403 recoverable false; every other code, including the CSV `first_rule.upper()` family and `CSV_VALIDATION_FAILED`, answers 424 recoverable true. The pin's comment names the follow-up fix (a malformed CSV should not be told a retry can succeed). The follow-up phase is booked by the coordinator with /gsd-phase in the 215 records PR after merge; Phase 215 does not book it. — **Reversibility:** costly — public `/process-key` error contract; moving it later is its own phase.

### Money-math parity (SC-1)
- Run the `HAS_PY_ENV` KPI parity cases in CI. They pass today (`HAS_PY_ENV=1 pytest tests/test_outcomes_kpi_parity.py`: 5 passed at 3f29f1539) and their fixture `tests/fixtures/outcomes-kpi-parity.json` is in the repo.

### Decided autonomously
- [Parity] Q: "How do the HAS_PY_ENV cases run in CI?" → Selected: "Remove the env skip so the cases run in the existing python job (the fixture is in-repo); no new env var" — one-line gate, trivially restorable.
- [DB-gated tests] Q: "How do TEST_SUPABASE_DB_URL-gated pytest cases run on the lane?" → Selected: "Resolve the DSN from LANE_DB_URL in the python job (conftest-level resolution); any case that cannot run on the lane is listed in a pinned roster with its reason; count skips from pytest's own skip report, not from the TODOS figure of 31" — test-harness wiring only.
- [App factory] Q: "What replaces bare FastAPI() in tests?" → Selected: "A shared test app-factory fixture that installs the same app-global exception handlers (422/429) production main.py installs, sourced from one production helper so they cannot drift; all 21 modules found by grep at 3f29f1539 move to it; any module that must stay bare is a deviation recorded in SUMMARY and surfaced, not silently exempted" — test harness plus a small extract in main.py, no runtime behaviour change.
- [Worker exception] Q: "What does the worker raise instead of HTTPException?" → Selected: "A domain exception in analytics_runner that classify_exception maps to the SAME (ErrorKind, message) each of the four raise sites in run_csv_strategy_analytics produces today (404 Strategy not found→unknown, 400 Insufficient CSV history→permanent, 422 Malformed returns_denominator_config→permanent, 500 CSV analytics computation failed→unknown); persisted error kind and text unchanged; a pin proves byte-equal classification" — internal exception type; persisted output is held constant.
- [Rosters] Q: "How are KNOWN_CREATE_WITH_KEY_CODES and KNOWN_ADD_KEY_CODES derived?" → Selected: "Derived per route from each route's emitted-code contract, kept as two separate sets (never merged, per the ConnectKeyStep docblock); the existing wizardErrors invariant guard stays" — TS-internal derivation.
- [Cassettes] Q: "Binance cassettes recorded or retired?" → Selected: "Retire the four binance cases in tests/test_repro_key_flow.py with a recorded reason (no live binance keys in CI or locally; okx and bybit cassettes keep the shape covered)" — re-adding parametrize rows is cheap once cassettes exist.
- [D-161-01] Q: "How is the first_rule.upper() CSV family made visible?" → Selected: "The derived vocabulary reads the CSV validator's rule names (upper-cased exactly as csv_adapter does) so the family is enumerated, with a test that reds when a new rule is added and not visible" — test and derivation only.
- [Teaser alert] Q: "How does anonymous teaser bucket saturation raise an alert?" → Selected: "A Sentry capture (existing sentry_sdk.capture_message idiom) when the shared anonymous bucket refuses a request, de-duplicated to at most one event per limit window; limit value (30/hour) unchanged" — observability only, no limit or response change.

### Claude's Discretion
None.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `analytics-service/tests/conftest.py` already lists `TEST_SUPABASE_DB_URL` among its DSN idioms.
- `sentry_sdk.capture_message` idiom in `routers/process_key.py`, `routers/internal.py`, `main.py`.
- `wizardErrors.invariant.test.ts` `[153.7 review W-153.7-1]` derives the classifier-reachable population and checks both rosters.

### Established Patterns
- STATUS_CONTRACT: 403 CALLER class, 424 upstream-transient, both breaker-inert.
- `classify_exception` (`services/job_worker.py`) has an explicit HTTPException arm with three buckets.

### Integration Points
- `.github/workflows/ci.yml` `python` job (local-stack lane, exports `LANE_DB_URL`).
- `run_csv_strategy_analytics` is reached only from the worker (`services/job_worker.py`).

</code_context>

<specifics>
## Specific Ideas

Every fix carries a test shown RED when reverted (SC-9). Analytics-touching changes pass CI's mypy strict.

</specifics>

<deferred>
## Deferred Ideas

- The CSV 424 recoverable:true fix: its own phase, booked by the coordinator after 215 merges (founder 2026-11-15).

</deferred>
