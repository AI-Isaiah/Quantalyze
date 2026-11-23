---
phase: 215
slug: testreach
status: secured
verdict: SECURED
threats_total: 25
threats_closed: 25
threats_open: 0
asvs_level: 2
block_on: high
audited_head: feat/215-testreach (worktree quantalyze-215)
audited: 2026-11-16
---

# Phase 215 TESTREACH - Security Verification

Verified against code in `git diff origin/main...HEAD -- . ':!.planning'`. Config was not supplied, so ASVS L2 depth (mitigation present AND at the correct boundary) and `block_on: high` were assumed. No threat is open at any severity, so the choice does not change the verdict.

The 25 threats are T-215-01 to T-215-24 plus T-215-SC. T-215-SC is declared in all eight plans with the same text and counted once. Dispositions: 21 mitigate, 3 accept (T-215-19, T-215-24, T-215-SC), 1 transfer (T-215-16).

Executed during this audit, with `TEST_SUPABASE_DB_URL`, `LANE_DB_URL`, `CI` and the `SUPABASE_TEST_*` variables unset: the phase's guard tests plus `test_compute_job_metadata_merge_live.py` gave **118 passed, 4 skipped**. The skips are the local no-lane skips of `test_compute_job_metadata_merge_live.py`, not CI skips. No database was contacted.

## Threat Verification

| ID | Category | Sev | Disp | Status | Evidence |
|----|----------|-----|------|--------|----------|
| T-215-01 | Repudiation | medium | mitigate | CLOSED | `tests/test_outcomes_kpi_parity.py`: `HAS_PY_ENV` `pytestmark` skipif and `import os` removed in the diff, so the module runs unconditionally. |
| T-215-02 | Repudiation | low | mitigate | CLOSED | `tests/test_repro_key_flow.py`: `_require_cassette` calls `pytest.fail` (was `pytest.skip`); `_REPLAY_BROKERS = ["okx","bybit"]`; `test_every_replay_broker_has_all_four_cassettes` asserts `len(_REPLAY_BROKERS) == 2`, a hand-typed floor, and four files per broker. |
| T-215-03 | Tampering | high | mitigate | CLOSED | `tests/live_db_dsn.py`: `_require_loopback_dsn` (host and hostaddr both checked, empty host refused), `_server_addr_is_lane` (`inet_server_addr()`: loopback, private or NULL only), `_require_stock_database_comment` (refuses PROD, TEST, NULL and empty comments), `_require_lane_server`. `connect_live_db` runs those guards before returning the connection and closes it on failure. All 7 migrated modules connect only through `connect_live_db`. `test_compute_job_metadata_merge_live.py` imports the same guards and unit-tests them. No path falls back to the shared-TEST variable. See "Specific checks" below. |
| T-215-04 | Repudiation | medium | mitigate | CLOSED | `live_db_dsn.py::resolve_live_db_dsn` and `resolve_lane_postgrest` call `pytest.fail` when `CI=true` and the lane variables are unset. `tests/test_live_db_dsn.py` pins (a) CI with no DSN fails naming `LANE_DB_URL`, (f) CI never falls back, and the PostgREST pair fails under CI. `_outcome()` catches both pytest outcome exceptions so a skip-for-fail swap goes red. |
| T-215-05 | Tampering | medium | mitigate | CLOSED | `tests/conftest.py::_DB_MODULE_SENTINELS` contains `"live_db_dsn"`. `test_live_db_dsn_is_a_shared_db_sentinel` and `test_every_migrated_module_is_grouped_as_a_shared_db_module` pin it for all 7 modules. |
| T-215-06 | Info disclosure | high | mitigate | CLOSED | `src/__tests__/critical-regressions.test.ts` keeps `expectNoMatch(body, /^\s+TEST_SUPABASE_DB_URL=/m, ...)` and adds a positive pin that `printf 'LANE_DB_URL=%s\n' "${db_url}" >> "${GITHUB_ENV}"` exists. The `.github/workflows/ci.yml` diff is comment-only. The one `pytest` invocation (ci.yml:5886, `python` job) takes its environment from that lane handoff, guarded by `run.sh --assert-local-handoff` (ci.yml:5794). The `TEST_SUPABASE_DB_URL` secret appears only in the `test-db-drift` job (ci.yml:6196, 6235). |
| T-215-07 | Tampering | medium | mitigate | CLOSED | `grep -rn TEST_SUPABASE_DB_URL analytics-service --include='*.py'` finds no environment read. The hits are `live_db_dsn.py`'s `SHARED_TEST_DSN_VAR` constant (never read), the `conftest.py:52` sentinel string, docstrings, and test fixtures that set the variable. `test_live_db_dsn.py` (c) pins a local run with only that variable set to skip. `tests/test_live_db_reach_roster.py` has an AST scan, with no allowlist and self-test fixtures, that reds on any `os.environ[...]`, `.get`, `getenv` or `in os.environ` read of it. |
| T-215-08 | Info disclosure | high | mitigate | CLOSED | `services/app_error_handlers.py::validation_exception_handler` and `_validation_detail` are AST-identical to the former `main.py` functions (diffed with `ast.dump` against `origin/main:analytics-service/main.py`). The body is built from `type` + `loc` only; `input`, `ctx`, `msg` and `url` are never read. `install_app_exception_handlers` registers it. `tests/app_factory.py::build_test_app` calls it. `tests/test_app_factory_parity.py` (b) posts a planted secret to a factory app and asserts it appears zero times in the body plus headers. |
| T-215-09 | Repudiation | medium | mitigate | CLOSED | `test_factory_registers_the_same_handler_objects_main_registers`: for 422, 429 and venue-transient, the factory app's handler `is` `main.app`'s. Also (c) for the 429 body. |
| T-215-10 | Tampering | low | mitigate | CLOSED | `app_factory.py` and `app_error_handlers.py` import no `main` (`services.rate_limit` has no main import). Only `test_factory_registers_the_same_handler_objects_main_registers` does `import main`, inside the test function. |
| T-215-11 | Repudiation | medium | mitigate | CLOSED | `test_app_factory_parity.py::test_no_test_module_constructs_a_fastapi_app_except_the_factory`: AST scan, `FASTAPI_CONSTRUCTION_ALLOWLIST = ()`, `MIN_TEST_FILES_PARSED = 450` vacuity floor, and an exact count of 1 in `app_factory.py`. `test_scan_helpers_can_see_what_they_hunt` proves the scanner fires. Remaining `FastAPI(` string hits under `tests/` are docstrings only. |
| T-215-12 | Info disclosure | low | mitigate | CLOSED | `test_no_test_module_imports_slowapis_default_429_handler`: `DEFAULT_429_HANDLER_ALLOWLIST = ()`, same floor. Remaining `_rate_limit_exceeded_handler` hits are the scanner's own constant and fixtures. |
| T-215-13 | Info disclosure | medium | mitigate | CLOSED (non-blocking caveat) | `app_error_handlers.py::_alert_anon_bucket_saturated` emits a fixed message, fingerprint `["anon-bucket-saturated","process_key"]` and tags `anon_bucket_saturated` and `limit` (server configuration string). It passes no IP, header, claim or correlation id. `test_anon_bucket_alert.py` asserts the recorded call and checks the rendered capture for the correlation id, `testclient`, `127.0.0.1` and the claim. See "Caveat on T-215-13". |
| T-215-14 | DoS | medium | mitigate | CLOSED | `_anon_alert_last_at` monotonic dedupe keyed by the refusing bucket, window from `limit.get_expiry()` with a 3600 s default. Pinned by `test_repeat_refusals_inside_the_window_emit_nothing_more` and `test_a_refusal_after_the_window_emits_again`. |
| T-215-15 | DoS | medium | mitigate | CLOSED | The Sentry emit is wrapped in `try/except Exception` and calls `_log_anon_alert_failure`. The unreadable-bucket path is also caught. The response is built before the hook runs. `test_a_raising_capture_still_returns_the_identical_429` and `test_the_429_is_byte_identical_with_the_hook_neutered` pin it. Diff of `rate_limit_exceeded_handler` vs old `main.py`: the only change is `response = ...; _alert_anon_bucket_saturated(...); return response`. |
| T-215-16 | Repudiation | low | transfer | CLOSED | Transfer recorded in `215-05-SUMMARY.md` "Founder follow-up (no repo work; T-215-16)" (create a Sentry issue-alert rule on fingerprint `anon-bucket-saturated` or the tag) and in the handler docstring. Residual: the rule does not exist until the founder creates it. |
| T-215-17 | Tampering | high | mitigate | CLOSED | `services/job_worker.py::classify_exception` `WorkerJobFailure` arm returns `(exc.error_kind, text[:500])` with the same cause-suffix rule as the HTTP arm. `services/job_failure.py` carries literal tuples ("404: Strategy not found", "400: Insufficient CSV history", "422: Malformed returns_denominator_config", "500: CSV analytics computation failed"). `tests/test_job_failure.py` has the old-vs-new equivalence pin plus four literal tuple tests and a test that the HTTP arm is kept. |
| T-215-18 | DoS | high | mitigate | CLOSED | `services/analytics_runner.py`: `except WorkerJobFailure: raise` sits ahead of the catch-all `except Exception`, so `CsvInsufficientHistory` (permanent) is not re-wrapped as `CsvComputationFailed` (unknown, retried). `test_csv_analytics_runner.py` asserts `pytest.raises(CsvInsufficientHistory)`, `error_kind == "permanent"` and `not isinstance(..., CsvComputationFailed)`. |
| T-215-19 | Info disclosure | low | accept | CLOSED | Accepted risk, recorded here. Same 180-char `repr` cause suffix as the former HTTP arm (`job_worker.py` WorkerJobFailure arm). The only chained cause is `ReturnsDenominatorConfigError`, so no new data reaches the `compute_jobs` row. |
| T-215-20 | Tampering | medium | mitigate | CLOSED | `src/lib/wizardKeyRosters.ts`: two distinct sets, `KNOWN_CREATE_WITH_KEY_CODES` and `KNOWN_ADD_KEY_CODES`. `wizardKeyRosters.test.ts` has frozen sorted member-for-member literals, vacuity floors, `not.toBe` and a non-equality test with route-specific members (`KEY_ORPHANED`, `COMPOSITE_MT5_UNSUPPORTED`). `wizardErrors.invariant.test.ts` pins the cascade tuple to the scanned classifier both directions and each route's own tuple to its emitter scan. |
| T-215-21 | Repudiation | medium | mitigate | CLOSED | The invariant tests (`seam-venue-vocabulary`, `seam-wire-vocabulary`, `seam-ratelimit-posture`, `wizardErrors.invariant`) read live exports and keep vacuity floors (for example `DERIVED_FLOOR = 36` and per-route roster floors). `ConnectKeyStep.tsx` and `MultiKeyConnectStep.tsx` import the derived sets, so the source-text guards no longer rely on hand-typed copies. I did not re-run the RED proofs (see Notes). |
| T-215-22 | Tampering | medium | mitigate | CLOSED | `tests/test_process_key_scope_rejection_statuses.py`: per-arm literal 403 / 424 / 200 pins, and `test_permanent_set_is_exactly_the_five_pinned_codes`. |
| T-215-23 | Repudiation | low | mitigate | CLOSED | `tests/test_csv_rule_family_oracle.py`: executed-family oracle equals the hand-typed family, `FAMILY_FLOOR = 17`, a source-scan enumeration (non-constant-rule scan with self-tests, `test_every_validator_rule_is_a_literal_except_the_one_pandera_emitter`). |
| T-215-24 | Info disclosure | low | accept | CLOSED | Accepted risk, recorded here. CSV wire codes are fixed rule names chosen by our validator, never file content, and this phase leaves them unchanged. |
| T-215-SC | Tampering | high | accept | CLOSED | Accepted risk, recorded here. `git diff origin/main...HEAD --name-only` shows no `package*.json`, lockfile, `requirements*`, `pyproject` or Cargo change. No package was installed or changed. |

## Specific checks requested

1. **`tests/live_db_dsn.py` never reaches shared TEST or PROD.**
   - Loopback: `_require_loopback_dsn` refused URI `hostaddr=8.8.8.8`, URI `host=evil.com`, a mixed host list and a unix-socket path. It passed `[::1]` and `localhost`. (Probed directly.)
   - Server address: `inet_server_addr()` must be NULL, loopback or private. A public address is refused.
   - Stock comment: `shobj_description` must equal `"default administrative connection database"`. A hosted project reached through a localhost tunnel passes the first two guards and is stopped here. PROD and TEST each carry a hand-set naming comment, and a NULL or lost marker is refused (fail-closed).
   - CI fails, not skips: both resolvers call `pytest.fail` under `CI=true` (pinned in `test_live_db_dsn.py`).
   - No `TEST_SUPABASE_DB_URL` read anywhere in `analytics-service` Python (grep above, plus the AST roster scan).
   - `ci.yml` exports only `LANE_DB_URL` (loopback, asserted local) and never the shared-TEST name into the `python` job.
2. **422 handler stays credential-safe for factory apps.** AST-identical to the pre-phase `main.py` handler. Registered through the single `install_app_exception_handlers`. Factory/main handler-object identity is pinned. The canary test (b) pins zero echo.
3. **Anon-bucket Sentry event carries no IP, header, claim or correlation id.** True of everything the handler code supplies. See the caveat below for what the SDK adds on its own.

## Caveat on T-215-13 (non-blocking, recorded, not counted in `threats_open`)

The handler passes only a fixed message, fingerprint and two tags, and the spy-based tests assert exactly that. A spy that records only `message`, `tags` and `fingerprint` cannot observe request context that the real SDK's integrations attach at capture time. The real-SDK test `test_the_real_sentry_sdk_emits_one_event_with_the_fingerprint_and_tag` runs with `default_integrations=False`, so it does not observe that context either.

I probed the real event with `StarletteIntegration` + `FastApiIntegration`, `send_default_pii=False`, and the production `_redact_before_send`. The production-shaped event carried:
- `request.headers["x-correlation-id"]` in clear (a random per-request id, not a secret)
- `request.url`, `user-agent` and `host`
- the request body `data`, with `raw_bytes_base64` redacted but the non-secret `wizard_session_id` visible

Effects:
- **IP:** absent (`user` is null and `x-forwarded-for` is filtered).
- **Tenant claim and `Authorization`:** `[REDACTED]` by the existing `sentry_init` denylist (`x-tenant-claim`, `authorization`).
- **Correlation id:** present as a request header. This is the service-wide posture for every Sentry event, not new exposure from this phase.
- **Docstring:** the handler docstring's "no IP, header, claim or correlation id" is accurate for the handler's own payload but overstates the delivered event.

No credential, IP or claim leaves the process, so I classify the threat CLOSED. Suggested follow-up, not a ship blocker: reword the docstring and the plan note to "the handler adds no ...; request context is the SDK's, redacted by `_redact_before_send`".

## Unregistered Flags

None. The SUMMARY `## Threat Flags` sections (plans 01, 02, 05, 06) say "None" or map to T-215-13 to T-215-16. Plans 03, 04, 07 and 08 declare no new surface.

Two observations that map to existing threats and are not new flags:
- `test_persist_csv_daily_returns_live.py` builds a PostgREST client from `resolve_lane_postgrest`, which checks only that the URL host is loopback. The stock-comment check applies to the same module's `service_role_conn` DB connection, not to the client. This is within T-215-03's accepted boundary.
- `test_compute_job_metadata_merge_live.py` connects with its own `psycopg.connect` rather than `connect_live_db`. It applies the same `_require_loopback_dsn` and `_require_lane_server` guards from `live_db_dsn.py` before any write, and unit-tests them.

## Notes

- I did not neuter the guards to re-run the RED proofs recorded in the SUMMARYs. Verification is by code inspection, direct probes, an AST identity diff and a green test run. The RED-proof claims for T-215-01, 04, 09, 11, 17, 18 and 21 rest on the SUMMARY records.
- No implementation files, `.github`, or `.planning` plans were modified. This file is the only write.

**threats_open:** 0
