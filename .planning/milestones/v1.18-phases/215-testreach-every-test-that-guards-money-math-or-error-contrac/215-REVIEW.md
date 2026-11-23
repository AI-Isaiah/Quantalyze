---
phase: 215-testreach-every-test-that-guards-money-math-or-error-contrac
reviewed: 2026-11-15T22:22:06Z
depth: standard
base: origin/main (3f29f1539)
head: eb6c19f76
files_reviewed: 67
files_reviewed_list:
  - .github/workflows/ci.yml
  - analytics-service/main.py
  - analytics-service/routers/process_key.py
  - analytics-service/services/analytics_runner.py
  - analytics-service/services/app_error_handlers.py
  - analytics-service/services/job_failure.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/rate_limit.py
  - analytics-service/tests/app_factory.py
  - analytics-service/tests/conftest.py
  - analytics-service/tests/live_db_dsn.py
  - analytics-service/tests/test_analytics_runner.py
  - analytics-service/tests/test_anon_bucket_alert.py
  - analytics-service/tests/test_app_factory_parity.py
  - analytics-service/tests/test_benchmark_refresh.py
  - analytics-service/tests/test_computation_error_provenance_fallback.py
  - analytics-service/tests/test_compute_job_metadata_merge_live.py
  - analytics-service/tests/test_correlation_middleware.py
  - analytics-service/tests/test_csv_analytics_runner.py
  - analytics-service/tests/test_csv_daily_returns_dualaxis_live.py
  - analytics-service/tests/test_csv_daily_returns_perkey_rls_live.py
  - analytics-service/tests/test_csv_fault_capture_170_1.py
  - analytics-service/tests/test_csv_hostile_inputs_170_1.py
  - analytics-service/tests/test_csv_rule_family_oracle.py
  - analytics-service/tests/test_csv_validation_off_event_loop_170_1.py
  - analytics-service/tests/test_debug_key_flow_router.py
  - analytics-service/tests/test_failed_status_logged.py
  - analytics-service/tests/test_job_failure.py
  - analytics-service/tests/test_job_worker.py
  - analytics-service/tests/test_ledger_refresh_hop2_oracle.py
  - analytics-service/tests/test_ledger_refresh_publish_guard.py
  - analytics-service/tests/test_limiter_identity.py
  - analytics-service/tests/test_live_db_dsn.py
  - analytics-service/tests/test_live_db_reach_roster.py
  - analytics-service/tests/test_match_holding_returns.py
  - analytics-service/tests/test_match_router.py
  - analytics-service/tests/test_maybe_single_none_guards.py
  - analytics-service/tests/test_mt5_internal_probe.py
  - analytics-service/tests/test_mt5_rotate_secret_internal.py
  - analytics-service/tests/test_ops_alert.py
  - analytics-service/tests/test_outcomes_kpi_parity.py
  - analytics-service/tests/test_persist_csv_daily_returns_live.py
  - analytics-service/tests/test_pgrst204_recovery_fallback.py
  - analytics-service/tests/test_prober_cadence_alert.py
  - analytics-service/tests/test_process_key.py
  - analytics-service/tests/test_process_key_200_discriminator.py
  - analytics-service/tests/test_process_key_scope_rejection_statuses.py
  - analytics-service/tests/test_raw_5xx_census.py
  - analytics-service/tests/test_repro_key_flow.py
  - analytics-service/tests/test_resend_correlation_rls.py
  - analytics-service/tests/test_sentry_transaction_redaction_170_1.py
  - analytics-service/tests/test_sfox_internal_probe.py
  - analytics-service/tests/test_simulator_router.py
  - analytics-service/tests/test_status_contract_exchange_internal.py
  - analytics-service/tests/test_status_contract_match_sim_portfolio.py
  - analytics-service/tests/test_sync_trades_preserves_fills.py
  - analytics-service/tests/test_trigger_rls_audit.py
  - src/__tests__/critical-regressions.test.ts
  - src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx
  - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
  - src/lib/seam-ratelimit-posture.invariant.test.ts
  - src/lib/seam-venue-vocabulary.invariant.test.ts
  - src/lib/seam-wire-vocabulary.invariant.test.ts
  - src/lib/wizardErrors.invariant.test.ts
  - src/lib/wizardErrors.roster-render.test.tsx
  - src/lib/wizardKeyRosters.test.ts
  - src/lib/wizardKeyRosters.ts
findings:
  critical: 0
  warning: 1
  info: 13
  total: 14
  necessity: 0
severity_counts:
  critical: 0
  high: 0
  medium: 1
  low: 8
  info: 5
round2:
  range: a1bb9c805..dfc0d0408
  closed: [MD-01, SF-M1, SF-M2, SF-M3, SF-M4]
  medium: 1
  low: 3
  info: 1
round3:
  range: dfc0d0408..ff29da0af
  closed: [R2-M1, R2-M2]
  medium: 0
  low: 0
  info: 0
status: clean
---

# Phase 215: Code Review Report

**Reviewed:** 2026-11-15T22:22:06Z
**Depth:** standard, plus targeted cross-file traces for the product-side changes
**Files Reviewed:** 67 (`git diff origin/main...HEAD -- . ':!.planning'`)
**Status:** issues_found (1 MEDIUM, 8 LOW, 5 INFO; no HIGH or CRITICAL)

## Summary

This is a CI-only phase. The main question was whether any product behaviour changed. I checked each product-side change against its old version and found **no behaviour change** in the 422, 429 or 424 bodies, statuses or headers, in the persisted job failure kind or text, or in the wizard roster members. The only addition is the observability hook for the anonymous bucket, which the plan asked for. The evidence is in "Verified unchanged" below.

The test DB guards look sound in CI. `LANE_DB_URL` is required under `CI=true`, the DSN must name loopback hosts only, and the server address and the stock database comment are checked before any write. No test module reads the shared-TEST DSN any more. One route around the "lane only" promise remains. The three persist runner cases patch the runner's Supabase client but not the benchmark leg's own client. On a developer machine that client resolves to shared TEST (MD-01). In CI the same leg makes a live network fetch.

The phase's own tests ran green locally in both module orders: 90 phase tests, plus 141 process-key tests with the new modules placed before and after `test_process_key.py`. mypy strict is clean on `app_error_handlers.py`, `job_failure.py`, `rate_limit.py` and `main.py`.

Necessity rubric: `~/.claude/gsd-core/references/necessity-review.md` was read. No finding qualifies (count 0). Neither `.claude/skills/` nor `.agents/skills/` exists in this worktree.

### Verified unchanged (priority 1), with evidence

- **422/429/424 handlers.** The bodies in `services/app_error_handlers.py` are byte-for-byte the code removed from `main.py`, apart from one addition: the anon hook runs after the 429 `JSONResponse` is built and returns that same response object. `install_app_exception_handlers` registers 422, then 429, then venue-transient, the same order as before, at the same point in `main.py` (after `app.state.limiter`, before the middleware). `_retry_after_seconds` binds the same `services.rate_limit.limiter` singleton at import, as before. `main` still re-exports the five names its tests use.
- **slowapi refusing-key read.** In slowapi 0.1.10, `__evaluate_limits` sets `limit_for_header = (lim.limit, args)` for the failing limit and stores it before raising. So `view_rate_limit[1][0]` is the refusing bucket key, and the tenant-vs-ceiling discrimination is correct (with no `key_prefix`, see LO-04).
- **Job failure kind and text.** `classify_exception(WorkerJobFailure)` returns the same `(kind, text)` as the old HTTP arm: `404→unknown "404: Strategy not found"`, `400→permanent "400: Insufficient CSV history"`, `422→permanent "422: Malformed returns_denominator_config (cause: …)"`. For the 500, the old HTTP arm fell through to the final `("unknown", str(exc))`, and `str(HTTPException(500,…))` is `"500: CSV analytics computation failed"`, which is the same text. One theoretical divergence is LO-07. `run_csv_strategy_analytics` has exactly one runtime caller (`job_worker.py:2955`). No HTTP route calls it, so no HTTP status moved. No code calls `HTTPException` from inside the runner's try block. The only other services that raise `HTTPException` are `portfolio_limits.py` and `job_worker.py`, and the runner calls neither, so `except WorkerJobFailure: raise` drops nothing the old `except HTTPException: raise` passed through. Nothing in the services, `sentry_init.py` or the worker reads `status_code` or `.detail` from a caught exception, apart from the kept HTTP arm.
- **Wizard rosters.** I ran a scratch vitest that compared the live `KNOWN_CREATE_WITH_KEY_CODES` and `KNOWN_ADD_KEY_CODES` against the literal sets removed from the step files. Result: `CREATE {"added":[],"removed":[]}` and `ADD {"added":[],"removed":[]}`. The scratch file was deleted afterwards.
- **`anon_bucket_key("process_key")`** returns `"process_key:anon"`, the same string as before, in both key functions and in `_process_key_limit_for`.
- **ci.yml** changed comment lines only. `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are not set anywhere in the python job, neither in `env:` nor in `$GITHUB_ENV`. The only pytest invocation in any workflow is the python job's, which has the lane, so `CI=true` with no lane DSN cannot happen in another job.

## Warnings

### MD-01 (MEDIUM): the "lane-only" persist runner cases reach a non-lane Supabase through the benchmark leg

Fixed in afae3ca08

**Severity:** MEDIUM (data integrity of test DB access, priority 2)
**File:** `analytics-service/tests/test_persist_csv_daily_returns_live.py`, `TestEdgeCaseTerminalStates._runner_uses_the_lane_client`. The path runs through `services/analytics_runner.py` (`get_benchmark_returns("BTC", …)` near line 2126) and `services/benchmark.py` (`_benchmark_client` → `get_supabase()` at line 179, the cache write `get_supabase()` at line 443).

**Issue:** The fixture patches only `services.analytics_runner.get_supabase`. The runner's benchmark leg calls `services.benchmark.get_benchmark_returns`, and that function builds its own client from `SUPABASE_URL` / `SUPABASE_SERVICE_KEY`. The module docstring and the fixture say these cases touch the lane only ("never TEST, never production"). That holds only when `SUPABASE_URL` happens to be unset:

- **Local run:** `main.py:30` runs `load_dotenv(.env.qa-local)`, the TEST project (`main.py:26`) on any `import main`. `tests/conftest.py:~131` already warns that this sets `SUPABASE_URL` for the rest of the process. `test_app_factory_parity.py` (a) imports `main`, and alphabetically it runs before this module. From then on, the all-zero and NaN cases, which pass the row-count gate and reach the benchmark fetch, read `benchmark_prices` on shared TEST and can insert into it (the `to_write` cache fill). That is a write to a database other people's CI uses, from a module documented as unable to do so. If `.env.qa-local` is absent, `load_dotenv()` falls back to `.env`, whatever that holds.
- **CI:** `SUPABASE_URL` is unset, so the cache read is a quiet miss. `fetch_btc_daily_prices` then makes a live external HTTP call from a test that is documented as hermetic on the lane. The runner catches the failure, so the effect is slowness or noise rather than a red build.

**Fix (minimal):** in the same autouse fixture, stub the benchmark leg the way the unit tests already do:

```python
monkeypatch.setattr(
    "services.analytics_runner.get_benchmark_returns",
    AsyncMock(return_value=(None, True)),
)
```

Alternatively, set `services.benchmark.get_supabase` to return the same lane client, if the benchmark cache is meant to be exercised.

## Silent-failure hunt (round 1, 2026-11-16) — MEDIUM findings routed to the fixer

### SF-M1 (MEDIUM): the anon-bucket saturation alert can stop firing with no log

Fixed in 62c70f03e
`services/app_error_handlers.py` `_alert_anon_bucket_saturated`: the `view_rate_limit` read ends in a bare `except Exception: return`, and the Sentry block in `except Exception: pass`, both unlogged. A slowapi shape change or a sentry-sdk API break silently turns the only saturation signal into a no-op. Minimal fix: narrow the first catch to `(AttributeError, IndexError, TypeError)`; in both swallow arms log `request.anon_bucket_alert_failed` with `exc_info=True` through a call that cannot itself raise; the 429 response stays byte-identical.

### SF-M2 (MEDIUM): the alert test never exercises the real Sentry API

Fixed in fa069aef6
`tests/test_anon_bucket_alert.py` replaces the whole `sentry_sdk` module with a spy, so a real API break at the pinned sentry-sdk passes the test while (with SF-M1) disabling the alert. Minimal fix: one case that runs the real SDK (`sentry_sdk.init` with a capturing transport, or the real `new_scope()` un-spied) and asserts one event with the expected fingerprint and tag.

### SF-M3 (MEDIUM): the cannot-run roster cannot notice a new env-gated live-DB skip

Fixed in 5f47df28e
`tests/test_live_db_reach_roster.py` `CANNOT_RUN_ON_LANE` is hand-typed; nothing scans `tests/` for env-gated skip conditions and requires each to be listed, so a new module with its own env-gated skip runs nowhere unnoticed. The DSN-read scan uses `glob` (top level only). Minimal fix: AST-scan `tests/**/*.py` for `skip`/`skipif` whose condition or message reads `os.environ`/`os.getenv`; every hit must be in `CANNOT_RUN_ON_LANE` or a small named allowlist with reasons; switch the DSN scan to `rglob`. Expect existing hits: list them with reasons rather than changing their behaviour.

### SF-M4 (MEDIUM): the CSV rule family scans share a blind spot

Fixed in 3b163fff1
`tests/test_csv_rule_family_oracle.py` and `src/lib/seam-venue-vocabulary.invariant.test.ts` see only literal `"rule": "<lit>"` dicts, `pa.Check(error=...)` names, and failures from fixed broken frames; a non-literal rule value or a pandera check with no `error=` that no frame violates is invisible to both, and test (4) only proves they agree. Minimal fix (oracle side): assert every `check.name`/`check.error` across `SCHEMAS` is in `EXPECTED_FAMILY` (or fails loudly), and assert every `"rule"` key / `rule=` keyword in the validator has a constant string value, so a non-literal form fails instead of being skipped.

LOW findings from the hunt (not fixed, recorded only): `_invoke_csv_runner` swallows the runner exception without asserting its type; `_require_cassette` checks existence not non-emptiness; `test_app_factory_parity` misses an aliased `FastAPI` import; the derived roster half is true by construction.

## Info

### LO-01 (LOW): the scoped claim in the trigger-RLS audit still counts rows it does not own

**Severity:** LOW (test reliability)
**File:** `analytics-service/tests/test_trigger_rls_audit.py`, the priority-claim test (the `claim_compute_jobs_with_priority(%s, %s, %s, %s::text[], NULL)` call and the `priorities.count("normal") == 3` assertion)

**Issue:** The new comment says scoping to `p_kind_include=['compute_analytics']` removes the foreign-backlog exposure. It does not. The claim still picks up any pending `compute_analytics` row on the lane that belongs to another suite, and the lane is shared by the whole python job. It marks those rows claimed and never releases them, and the count runs over every claimed row, not only the five it seeded. The `shared_test_db` xdist group serialises the modules, so this goes red only when some earlier module leaves a pending `compute_analytics` row behind.

**Fix:** filter `claimed` to `strategy_ids` before counting, and say in the comment that the lane is shared by the python job, not private to this suite.

### LO-02 (LOW): the dual-axis CHECK repair accepts almost any error

**Severity:** LOW (assertion loosened during repair)
**File:** `analytics-service/tests/test_csv_daily_returns_dualaxis_live.py`, `TestCheckConstraintsReject`, the per-key row with no allocator

**Issue:** The test now accepts `CheckViolation` or `RaiseException`, and the message check `"…per_key_allocator" in msg or "allocator_id" in msg` passes on nearly any message about that column. The new `pg_constraint` lookup pins that the CHECK exists, so the remaining gap is that a `RaiseException` from an unrelated trigger that mentions `allocator_id` would still pass.

**Fix:** pin the trigger's own message text (or its SQLSTATE and function name) for the `RaiseException` branch.

### LO-03 (LOW): the `clock` fixture freezes `time.monotonic` for the whole process, not one module

**Severity:** LOW (test reliability; the comment is wrong)
**File:** `analytics-service/tests/test_anon_bucket_alert.py`, `clock` fixture

**Issue:** `app_error_handlers.time` is the global `time` module, so `monkeypatch.setattr(app_error_handlers.time, "monotonic", fake)` freezes `time.monotonic` everywhere while the test runs. That includes the asyncio loop inside `TestClient`'s anyio portal. The comment ("scoped to this module's own attribute, so the rest of the process keeps real time") is false. The tests pass today because nothing awaits a timer, but any `wait_for` or `sleep` on that path would hang.

**Fix:** have `app_error_handlers` use `from time import monotonic` (or a module-level `_now = time.monotonic`), and patch that name.

### LO-04 (LOW): the anon alert hook does not fully live up to its "swallows every failure" docstring

**Severity:** LOW
**File:** `analytics-service/services/app_error_handlers.py`, `_alert_anon_bucket_saturated`

**Issue:** There are three small defects:

1. The structlog warning, the window arithmetic and `time.monotonic()` run outside any `try`. If any of them raised, the 429 handler would raise instead of returning its response.
2. `_anon_alert_last_at[refusing_key] = now` is stamped before `capture_message`, so a failed capture silences the alert for the whole window.
3. `view_rate_limit[1][0]` assumes no slowapi `key_prefix`. With `RATELIMIT_KEY_PREFIX` set, `args[0]` is the prefix and the alert never fires.

**Fix:** wrap the body after the key read in one `try/except Exception`, stamp the dedupe only after a successful capture, and read the key as `args[-2]`.

### LO-05 (LOW): the roster docstring promises a completeness guarantee it does not enforce

**Severity:** LOW (I could not name a specific un-rostered case that skips under `CI=true`)
**File:** `analytics-service/tests/test_live_db_reach_roster.py`, module docstring and `CANNOT_RUN_ON_LANE`

**Issue:** The docstring says "Every other live-DB case that still does not run there is listed … a named, reviewed set and not an accident". Nothing checks that. The roster only checks that its own entries exist and that the set has at least 7 entries. Plan 02's SUMMARY itself records about 27 lane-gated cases that appear not to run in CI.

**Fix:** reword the docstring to "the known cases", or add a check that compares CI's skip list against the roster.

### LO-06 (LOW): the sync-trades repair dropped the disjoint-window half of the current contract

**Severity:** LOW
**File:** `analytics-service/tests/test_sync_trades_preserves_fills.py`, `test_phase1_sync_trades_replaces_prior_summaries`

**Issue:** With the timestamps made equal, the test still discriminates: a plain upsert would keep the BTC row. The retry-data-loss guarantee from migration 20260510180535 is that a disjoint window keeps the earlier rows. This module does not pin that, and the old case was rewritten instead of being kept as a second case that inverts the expectation.

**Fix:** add a disjoint-window case that asserts both summaries survive.

### LO-07 (LOW): the 500 arm no longer reaches the geo-block check through `__context__`

**Severity:** LOW (theoretical; the CSV runner's catch-all has no exchange call that can propagate)
**File:** `analytics-service/services/job_worker.py`, `classify_exception`'s `WorkerJobFailure` arm, compared with `services/geo_block.py` `_exc_text`

**Issue:** The old `HTTPException(500)` was raised inside `except Exception as exc` and fell through to `is_geo_blocked(exc)`, which reads `__context__`. The new arm returns before that check. `test_job_failure.py`'s old-vs-new case builds the old 500 with no `__context__`, so it cannot see this difference.

**Fix:** none needed today. If a geo-block can ever propagate into that arm, add a `__context__` case to the equivalence test.

### LO-08 (LOW, ship-time): the TODOS entries this phase closes are still in `TODOS.md`

**Severity:** LOW
**File:** `TODOS.md` (`[D-161-01]` around line 29, `ROSTER-DERIVE-01` around line 42, "Tests that run in NO environment" around line 71, "Worker raises an HTTP exception" around line 87)

**Issue:** The rewritten W-153.7-2 test in `wizardErrors.invariant.test.ts` says "the backlog item is deleted in the same PR", and CLAUDE.md rule (b) requires that. `TODOS.md` is not in this diff.

**Fix:** delete the entries in the ship PR and name them in the CHANGELOG entry.

### IN-01 (INFO): stale lint markers on the new imports

`main.py:83-87`: ruff reports F401 on the five intentional re-exports (ruff is not a CI gate here, and the baseline has errors). A `__all__` or a `# noqa: F401` with a reason would make the intent explicit. `analytics_runner.py:57` carries `# noqa: F401 - WorkerJobFailure is re-exported`, but the module uses the name in `except WorkerJobFailure`, so the comment's claim is wrong.

### IN-02 (INFO): the metadata-merge probe keeps its own DSN resolver

`tests/test_compute_job_metadata_merge_live.py`: `_dsn` and `_connect` duplicate `resolve_live_db_dsn` and `connect_live_db`, with `LANE_DB_URL` read once at import. `_connect` also does not close the connection when `_require_lane_server` fails. The shared helper does close it.

### IN-03 (INFO): code comments still name `main.py` as the home of the 422/429 handlers

`src/lib/seam-discriminator.ts:359`, `src/lib/seam-discriminator.test.ts:724,748`, `src/app/api/keys/[id]/permissions/route.test.ts:836,959,1020` and `scripts/prod-prober/arms/pyapi06.mjs:215` still point at `main.py`. All are comments; no scanner depends on them.

### IN-04 (INFO): the cassette recorder still offers binance

`analytics-service/scripts/record_cassettes.py:163,207` still accepts `binance`. The replay suite retired it, so a recorded binance cassette would be replayed by nothing unless `_REPLAY_BROKERS` is edited as well. The test comment says exactly that, so this is intended. Noted only.

### IN-05 (INFO): the anon-saturation alert reaches no human yet

The Sentry event pages nobody until an issue-alert rule exists. The phase 215-05 SUMMARY ("Founder follow-up", T-215-16) records this as a founder action outside the repo. SC-7's "raises an alert" is met only in the sense that a Sentry event is raised, until that rule is created.

---

_Reviewed: 2026-11-15T22:22:06Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Round 2

**Reviewed:** 2026-11-16, `git diff a1bb9c805..HEAD -- . ':!.planning'` (afae3ca08, 62c70f03e, fa069aef6, 5f47df28e, 3b163fff1; HEAD dfc0d0408). Read-only.
**Result:** all five round-1 MEDIUMs are closed. No production response changed. The round adds **one new MEDIUM (R2-M1)**, so `status` stays `issues_found`. Counts for this round: 1 MEDIUM, 3 LOW, 1 INFO.

**Evidence:**
- Every touched test passed locally (59 passed, 6 skipped; the skips are the lane-gated persist cases).
- The anon-alert module passed when run after `test_app_factory_parity` (which imports `main` and installs the cached structlog configuration), `test_rate_limit_contract` and `test_process_key`. So `capture_logs` was not defeated by `cache_logger_on_first_use=True` in that order.
- mypy strict is clean on `services/app_error_handlers.py`.

### Round-1 findings

| Finding | Verdict | Evidence |
|---|---|---|
| MD-01 | **Closed** | The autouse fixture now stubs `services.analytics_runner.get_benchmark_returns` with `AsyncMock((None, True))`, the runner's own no-benchmark default. Nothing in `services.benchmark` is reached, so no client is built from `SUPABASE_URL` and no network fetch happens. The new guard case runs wherever the fixture runs (CI); locally it skips with the fixture. |
| SF-M1 | **Closed** | Both swallow arms now log `request.anon_bucket_alert_failed` with `exc_info=True` through `_log_anon_alert_failure`, which cannot raise. Tests cover both arms. The 429 response object is unchanged; the hook still runs after it is built. |
| SF-M2 | **Closed** | `test_the_real_sentry_sdk_emits_one_event_with_the_fingerprint_and_tag` runs the real SDK through an in-memory `Transport` on a `.invalid` DSN, and restores the global-scope client in `finally`. It asserts message, level, fingerprint and tag, so a real `new_scope` or `fingerprint` API break turns it red. No global state leaks: the previous client is restored and the dedupe dict is cleared both ways. |
| SF-M3 | **Closed as specified** | An AST scan of `tests/**/*.py` finds env-gated skips (direct reads, `if` guards, names assigned from env reads), with red and green self-tests and a floor of 22. The DSN scan now uses `rglob`. But the scan surfaced one gate that was then allowlisted on a false premise: R2-M1. |
| SF-M4 | **Closed** | Every `pa.Check` on `SCHEMAS` (column- and schema-level) must map its wire name (`error` or else `name`) into `EXPECTED_FAMILY`. Every non-literal `rule` in `csv_validator.py` must be the one pandera `rule_name` emitter, with an exact count of 1. Both have self-tests that can fire. |

### R2-M1 (MEDIUM): SF-M3 allowlists a CI skip whose premise is false at the pinned FastAPI, so 24 simulator error-contract tests still run nowhere in CI

**Severity:** MEDIUM (a phase-goal gap: tests guarding error contracts on the portfolio simulator do not run in any CI environment)
**File:** `analytics-service/tests/test_live_db_reach_roster.py`, the `ENV_GATED_SKIP_ALLOWLIST["test_simulator_router.py::<module>"]` entry. The gate is `analytics-service/tests/test_simulator_router.py:46` (`_BODY_PARSER_SKIP`), applied at 10 sites.

**Issue:** `_BODY_PARSER_SKIP` skips under `CI=true` because "CI runs FastAPI 0.115.12, whose body-vs-query detection returns 422 … Tests pass locally on fastapi>=0.135". That is no longer true: `requirements.txt:75` pins `fastapi==0.161.1`.

Measured locally on FastAPI 0.139:
- without `CI`: `63 passed`
- with `CI=true`: 24 tests `SKIPPED`

The skipped tests include the 404 "Portfolio not found" ownership contract (`TestPortfolioNotFound`). The new allowlist entry repeats the stale premise as its reason ("a known FastAPI Body()/query 422 detection gap"). So the scan meant to make a silent skip impossible has instead signed off on one. Before this round the skip was merely unaccounted for; now the record says it is justified, and it is not.

I did not run the suite on 0.161.1 itself. The premise names 0.135+ as working, and 0.139 passes.

**Fix (minimal):** delete the `_BODY_PARSER_SKIP` decorator from the 10 sites and its definition, then delete the allowlist entry (the stale-entry check will demand that). If any case reds on 0.161.1, fix that case or roster it with the measured reason, not the 0.115.12 one.

**Fixed in e13565c73.** Removed `_BODY_PARSER_SKIP` (definition, 15 decorator uses, the now-unused `os` import) and the allowlist entry; `_ENV_GATED_SITE_FLOOR` 22 to 21. Measured on the pinned `fastapi==0.161.1` (starlette 0.46.2, Python 3.12, `requirements.txt` + `requirements-dev.txt`): `CI=true` on `tests/test_simulator_router.py` alone went `39 passed, 24 skipped` to `63 passed`; the default interpreter (FastAPI 0.139) with `CI=true` also `63 passed`. No router change was needed. RED: a `CI=true` skipif re-added on `TestPortfolioNotFound` turns `test_every_env_gated_skip_under_tests_is_accounted_for` red naming `test_simulator_router.py::<module>`; restored by byte copy, `cmp` clean, `27 passed`.

### R2-M2 (MEDIUM): `_seed_user_id` in the drain and transition modules skips on an empty `profiles` table

**Severity:** MEDIUM (a silent CI skip of a live-DB contract module whose allowlist reason says it runs)
**File:** `analytics-service/tests/test_drain_semantics.py` and `analytics-service/tests/test_transition_rpc.py`, `_seed_user_id`

**Issue:** Both helpers called `pytest.skip("test Supabase project has no seeded profiles")`, while `test_compute_jobs_fencing.py`'s copy does `pytest.fail`. Nothing in `scripts/local-stack/` seeds profiles, so the modules might have skipped silently on the lane.

**Measurement (booted lane, `run.sh up`, values exported as the python job does, `CI=true`):** `profiles` is NOT empty. It holds one row, `[phase-19 sentinel]`, seeded by migration `20260515095804_teaser_anchor_strategy.sql` through the lane's reference-data replay (one matching `auth.users` row). Both modules ran `11 passed, 0 skipped`.

**Fix:** Both helpers now `pytest.fail` (as the fencing module's does), so a lane that loses that reference row goes red instead of skipping. The allowlist reason for the two `_need_supabase` entries now names the sentinel and the failing precondition.

**Fixed in 0d70f16c9.** RED: a stub admin returning no profile rows makes the original helpers `Skipped` (2 skipped) and the fixed helpers raise `Failed` (2 passed as `pytest.raises(pytest.fail.Exception)`); restored by byte copy, `cmp` clean. Lane torn down with `run.sh down`.

**Noticed, not fixed (out of scope):** `test_compute_similarity_sql.py::test_immutable_parallel_safe_flags` skips on every CI run (`psycopg2` is not in `requirements.txt` and `SUPABASE_TEST_DB_URL` is never exported), while the shared `_LANE_SUPABASE_SKIP_ONLY` reason says its cases run on the lane. Record only.

### R2-L1 (LOW): narrowing the refusing-key catch can turn a 429 into a 500

**File:** `services/app_error_handlers.py`, `_alert_anon_bucket_saturated`

**Issue:** The catch went from `except Exception` to `(AttributeError, IndexError, TypeError)`. A `view_rate_limit` shape that raises anything else (for example a `KeyError` if slowapi ever stores a mapping) now propagates out of the 429 handler and becomes a 500. It used to be swallowed. This is theoretical at slowapi 0.1.10, which stores `(item, [key, scope])`.

**Fix:** keep `except Exception`. The new log already gives the visibility SF-M1 wanted.

### R2-L2 (LOW): the module-scope roster match is broader than one gate

**File:** `tests/test_live_db_reach_roster.py`, `in_roster` inside `test_every_env_gated_skip_under_tests_is_accounted_for`

**Issue:** Any `<module>`-scope env-gated skip passes if its module has any `CANNOT_RUN_ON_LANE` entry. `test_compute_jobs_fencing.py`, `test_compute_similarity_sql.py`, `test_migration_108_idempotent.py` and the sfox and upsert modules all have entries. So a new `pytestmark` env gate in one of those files is silently accepted.

**Fix:** accept `<module>` only through an explicit `"<module>::<module>"` key.

### R2-L3 (LOW, carried): LO-04 is only partly addressed

The dedupe stamp is still written before `capture_message`, so a failed capture silences the alert for the whole window (it is now logged, not silent). The structlog warning and `time.monotonic()` path is still outside the guard, and the `key_prefix` index is unchanged.

### R2-I1 (INFO): the real-SDK test never closes its `Client`

`test_the_real_sentry_sdk_emits_one_event_with_the_fingerprint_and_tag` restores the previous client but never calls `close()` on the one it built. This is harmless with an in-memory transport and default integrations off; calling `client.close()` in the `finally` would be cleaner.

_Round 2 reviewed: 2026-11-16, Claude (gsd-code-reviewer)_

## Round 3

**Reviewed:** 2026-11-16, `git diff dfc0d0408..HEAD -- . ':!.planning'` (e13565c73, 0d70f16c9; HEAD ff29da0af). Read-only.
**Result:** both open MEDIUMs are closed. There are no new findings at any severity, and no open MEDIUM or higher, so `status` is now **`clean`**. This round's counts: 0 CRITICAL, 0 HIGH, 0 MEDIUM, 0 LOW, 0 INFO.

The LOW and INFO items from rounds 1 and 2 stay recorded here. Under the project rule they are not booked and not fixed.

| Finding | Verdict | Evidence |
|---|---|---|
| R2-M1 | **Closed** | `_BODY_PARSER_SKIP`, its definition and the now-unused `import os` are removed from `tests/test_simulator_router.py`. I grepped for both and found none left. The stale allowlist entry is deleted, and the site floor went from 22 to 21. That matches the one deleted `<module>` site. Locally with `CI=true`: `test_simulator_router.py` plus `test_live_db_reach_roster.py` gave `90 passed`, 0 skipped. The fixer reports 63 passed on the pinned fastapi 0.161.1. |
| R2-M2 | **Closed** | In `test_drain_semantics.py` and `test_transition_rpc.py`, `_seed_user_id` now ends in `pytest.fail(..., pytrace=False)` instead of `skip` when `profiles` is empty. Both are reached only from fixtures that run after `_need_supabase`, so a dev machine without the lane variables still skips earlier. The two allowlist reasons now say this. No product code was touched. |

_Round 3 reviewed: 2026-11-16, Claude (gsd-code-reviewer)_
