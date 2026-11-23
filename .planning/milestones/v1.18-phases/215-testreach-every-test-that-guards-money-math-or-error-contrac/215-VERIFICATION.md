---
phase: 215-testreach-every-test-that-guards-money-math-or-error-contrac
verified: 2026-11-16T01:15:00Z
status: passed
score: 9/9 must-haves verified
verified_at_sha: 59f3a01fd417cf6bb20f91550a5670468270300d
drift_subjects:
  - analytics-service/tests/test_outcomes_kpi_parity.py
  - analytics-service/tests/test_repro_key_flow.py
  - analytics-service/tests/live_db_dsn.py
  - analytics-service/tests/test_live_db_reach_roster.py
  - analytics-service/tests/conftest.py
  - analytics-service/tests/app_factory.py
  - analytics-service/tests/test_app_factory_parity.py
  - analytics-service/services/app_error_handlers.py
  - analytics-service/services/job_failure.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/analytics_runner.py
  - analytics-service/services/rate_limit.py
  - analytics-service/routers/process_key.py
  - analytics-service/main.py
  - analytics-service/tests/test_process_key_scope_rejection_statuses.py
  - analytics-service/tests/test_csv_rule_family_oracle.py
  - analytics-service/tests/test_anon_bucket_alert.py
  - analytics-service/tests/test_job_failure.py
  - src/lib/wizardKeyRosters.ts
  - src/lib/seam-venue-vocabulary.invariant.test.ts
  - .github/workflows/ci.yml
behavior_unverified: 0
overrides_applied: 0
re_verification: false
---

# Phase 215: TESTREACH Verification Report

**Phase Goal:** CI-only phase, no product behaviour changes. Every test guarding money math or an error contract runs in some environment, and test apps are built the way production builds them.
**Verified:** 2026-11-16, worktree `/Users/<user>/claude-projects/quantalyze-215` (branch `feat/215-testreach`), HEAD `59f3a01fd417cf6bb20f91550a5670468270300d`
**Status:** passed
**Re-verification:** No, initial verification

## Goal Achievement

### Observable Truths (ROADMAP SC-1..SC-9)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | `HAS_PY_ENV` parity tests run in CI, or are removed with a recorded reason | VERIFIED | `HAS_PY_ENV` has 0 hits under `analytics-service`, `.github`, `src`. `test_outcomes_kpi_parity.py` has no `skipif`/`pytestmark`; run in this session: `5 passed` with no env var. Revert-RED reproduced: in a scratch copy I re-added a module `skipif` on `HAS_PY_ENV`, and `test_live_db_reach_roster.py::test_every_env_gated_skip_under_tests_is_accounted_for` went RED naming `test_outcomes_kpi_parity.py::<module>`. Reverting the fix therefore fails CI. |
| SC-2 | Tests gated on `TEST_SUPABASE_DB_URL` run on `LANE_DB_URL`, or each is listed with why it cannot | VERIFIED (lane execution not re-run here, see note) | `tests/live_db_dsn.py` resolves `LANE_DB_URL` only (loopback guard, lane-address guard, stock-comment guard). Under `CI=true`, a missing DSN is `pytest.fail`; locally it skips. The 7 modules (24 cases) use the `live_db_dsn` fixture and `connect_live_db`. No test module reads `TEST_SUPABASE_DB_URL` (grep: only the helper constant, the roster scan and its snippets). `CANNOT_RUN_ON_LANE` has 9 entries, each with a reason, floor-pinned and rot-checked. Added later in review: an AST scan that accounts for every env-gated skip site under `tests/` (21 sites, allowlist with reasons), which also guards SC-1. `ci.yml` python job exports `LANE_DB_URL`, `SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_KEY` and still never exports the shared-TEST name; `src/__tests__/critical-regressions.test.ts` (181 tests) passes and pins it. `conftest.py` adds `live_db_dsn` to `_DB_MODULE_SENTINELS` so the modules stay in the `shared_test_db` xdist group. |
| SC-3 | A shared app-factory fixture replaces every bare `FastAPI()` in the test suite | VERIFIED | `grep` over `analytics-service` for `FastAPI(`: only `tests/app_factory.py` (the one construction), plus docstring or comment mentions and `main.py`. `build_test_app` calls `install_app_exception_handlers(app)`, the same production function `main.py` now calls (`main.py:404`). Handler bodies moved unchanged from `main.py` (diff of non-comment lines shows only import and `add_exception_handler` lines removed). `test_app_factory_parity.py`: same handler objects as `main.app`, canary 422 with 0 echoes, production 429, AST regrowth scans with empty allowlists and a 450-file vacuity floor. Neuter reproduced (factory skips the installer): 3 parity tests RED. |
| SC-4 | The worker raises a domain exception that `classify_exception` maps, never `HTTPException` | VERIFIED | `services/job_failure.py` defines `WorkerJobFailure` plus four subclasses. `analytics_runner.py` has no `HTTPException` import and no `raise HTTPException`; its four raise sites are `CsvStrategyNotFound`, `CsvInsufficientHistory`, `CsvMalformedDenominatorConfig` (`from cfg_exc`), `CsvComputationFailed`. `classify_exception` has a `WorkerJobFailure` arm above the kept `HTTPException` arm with the same cause-suffix rule. `test_job_failure.py` pins old-vs-new equivalence plus four literal tuples. Neuters reproduced: arm returns `transient`, 9 RED; runner's re-raise arm retargeted, `test_csv_analytics_insufficient_history` RED. mypy strict on the three changed services: clean. |
| SC-5 | `KNOWN_CREATE_WITH_KEY_CODES` and `KNOWN_ADD_KEY_CODES` derived from each route's contract, still per route (not merged) | VERIFIED (note) | `src/lib/wizardKeyRosters.ts` exports two separate `Set`s. The classifier-returned half is derived live from `VENUE_WIRE_CODE_TO_VERDICT` plus one typed cascade tuple. Each route's own codes are a typed tuple pinned both directions to scans of that route's source. Both step files import from this module and no longer hold local rosters. 6 vitest files, 273 tests pass. The tuples are typed, not computed, but each is a scan-pinned contract, so the duplication that `ROSTER-DERIVE-01` named is gone and a missing row still reds CI by name. |
| SC-6 | The binance cassettes are recorded or retired | VERIFIED | The binance cases are retired with a dated reason beside `_REPLAY_BROKERS = ["okx", "bybit"]`. `_require_cassette` calls `pytest.fail` (never skip) and names broker and scenario. `test_every_replay_broker_has_all_four_cassettes` carries a hand-typed floor. `tests/cassettes/` holds only `okx` and `bybit`. 185 tests across the new and changed modules pass. |
| SC-7 | (a) `first_rule.upper()` CSV family visible to the derived vocabulary (D-161-01); (b) 403-vs-422 split decided and pinned; (c) anonymous teaser bucket saturation raises an alert | VERIFIED | (a) `test_csv_rule_family_oracle.py` enumerates the family by executing the validator and compares it with a hand-typed set. `seam-venue-vocabulary.invariant.test.ts` has `CSV_RULE_CODE_FAMILY` with a disposition required per member and an oracle cross-check. (b) Founder decision 2026-11-15, Option A (pin today, no behaviour change, follow-up not booked here). `test_process_key_scope_rejection_statuses.py` pins literals: five permanent codes and `VALIDATION_UNEXPECTED` answer 403 with `recoverable` false; the CSV family answers 424 with `recoverable` true, with the follow-up named in the docstring. Neuter reproduced (CSV arm 424 to 422): 6 RED. (c) `_alert_anon_bucket_saturated` is called from `rate_limit_exceeded_handler` after the response is built. It reads the refusing key from `request.state.view_rate_limit`, emits a de-duplicated Sentry `capture_message` (fingerprint and tag), and never alters the 429. Limit stays 30/hour. Neuter reproduced (call removed): 6 RED, including a real-SDK case. `process_key.py` and `rate_limit.py` diffs are only the `anon_bucket_key` extraction (same string). |
| SC-8 | No migration | VERIFIED | `git diff --name-only origin/main` has no `supabase/` or `migrations` path. |
| SC-9 | Each fix has a test that goes RED when it is reverted | VERIFIED | Independently reproduced in a scratch copy under the scratchpad (source untouched): SC-1 (re-added skip), SC-3, SC-4 (two neuters), SC-7b, SC-7c. SC-2 and SC-5 rest on the documented byte-backup RED proofs in plans 02 and 07 plus inspection that the pins assert literal values. Each plan SUMMARY carries a RED-proof section. |

**Score:** 9/9 truths verified, 0 present-but-behavior-unverified.

### Product-behaviour check ("no product behaviour changes")

Production files changed (`git diff --stat origin/main`): `main.py`, `routers/process_key.py`, `services/analytics_runner.py`, `services/app_error_handlers.py` (new), `services/job_failure.py` (new), `services/job_worker.py`, `services/rate_limit.py`, `src/lib/wizardKeyRosters.ts` (new) and the two wizard step files. Each is a move, an exception-type swap with byte-identical classification, a string-preserving helper extraction, an observability-only hook, or a roster derivation pinned member-for-member. No threshold, status, body or limit changed.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| KPI parity cases run without env | `pytest tests/test_outcomes_kpi_parity.py` | 5 passed | PASS |
| New and changed analytics modules | `pytest` over `test_live_db_dsn`, `test_live_db_reach_roster`, `test_app_factory_parity`, `test_job_failure`, `test_anon_bucket_alert`, `test_process_key_scope_rejection_statuses`, `test_csv_rule_family_oracle`, `test_limiter_identity`, `test_repro_key_flow` | 185 passed | PASS |
| Roster and vocabulary vitest files | `vitest run` over the 6 wizard and seam invariant files | 273 passed | PASS |
| CI wiring pin | `vitest run src/__tests__/critical-regressions.test.ts` | 181 passed | PASS |
| mypy strict | `mypy --strict` on `job_failure`, `app_error_handlers`, `rate_limit` | clean | PASS |

Orchestrator evidence cited, not re-run: full pytest at `7aa52a806` (14981 passed, 93 skipped, 1 failed, the failure being `test_xdist_group_is_real.py` because pytest-xdist is absent locally); mypy strict over 141 files; `npm run lint` 0 errors; full `npm test` 26451 passed.

### Anti-Patterns

No `TBD`, `FIXME` or `XXX` in lines added under `analytics-service`, `src` or `.github`. REVIEW (3 rounds, final clean) and SECURITY (SECURED, 25/25) are consistent with the code read. Info only: two test docstrings still call a bare `FastAPI()` mount "the harness in test_process_key.py" (`test_process_key_onboard_contract.py:27`, `test_validate_key_venue_transient.py:234`). They are stale prose, not constructions, and the AST scan correctly ignores them. A `from fastapi import FastAPI as X` alias would evade the AST scan's name check; none exists.

### Human Verification Required

None. Nothing here needs a human, and the items below are ship-time checks on the PR head SHA.

### Ship-time checks (not gaps)

1. **CI `python` job on the PR head:** `tests/test_xdist_group_is_real.py` passes (needs pytest-xdist, absent locally).
2. **CI skip count:** the python job skip count should fall below the 68 baseline at `3f29f1539` (at least 5 parity plus 4 binance, net of other plans). I could not measure this without CI.
3. **Lane execution of the 24 migrated live-DB cases:** this machine has no docker and no lane (`LANE_DB_URL` unset), so I did not re-run them. Local evidence is the plan-02 executor's lane run (32 passed, 0 skipped) and the round-2 fixer's drain/transition run. The CI python job is the confirmation. Under `CI=true` a missing lane DSN fails by name, so a miss cannot degrade into a quiet skip.
4. **Sentry alert routing:** SC-7(c) delivers the event (fingerprint `anon-bucket-saturated`, tag `anon_bucket_saturated=process_key`). Notifying a human needs a Sentry issue-alert rule on that tag, which lives outside this repo and is stated in the handler docstring. Per the CONTEXT decision this is the intended scope.
5. **Ship bookkeeping (CLAUDE.md "TODOS.md holds open work only"):** delete the closed TODOS entries in the ship PR and name them in the CHANGELOG entry. The entries are "Tests that run in NO environment", the bare-`FastAPI()` entry, "Worker raises an HTTP exception", `ROSTER-DERIVE-01`, `D-161-01`, the 403-vs-422 entry and the teaser-bucket saturation alert. The coordinator books the CSV 424 `recoverable: true` follow-up phase after merge (founder 2026-11-15).

### Gaps Summary

No gaps. All nine success criteria are met in the code at HEAD, with revert-RED behaviour reproduced independently for SC-1, SC-3, SC-4, SC-7b and SC-7c. Two residual notes do not block: SC-5's own-code tuples are scan-pinned rather than computed, and SC-2's lane execution is confirmed locally only by executor-recorded runs until CI runs.

---

_Verified: 2026-11-16_
_Verifier: Claude (gsd-verifier)_
