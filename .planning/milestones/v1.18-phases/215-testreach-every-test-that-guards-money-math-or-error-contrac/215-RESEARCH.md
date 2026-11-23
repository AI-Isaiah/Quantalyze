# Phase 215: TESTREACH - Research

**Researched:** 2026-11-15
**Domain:** CI test reach for a Python/FastAPI analytics service plus a Next.js/TS wizard (pytest, vitest, slowapi, Sentry, Supabase local-stack lane)
**Confidence:** HIGH on measured facts (every count and failure below was run this session at 3f29f1539 plus the worktree head 1f6db1273); MEDIUM on the SC-5 derivation design and on whether the 21 DSN-gated cases are green on the lane (not booted, see Open Questions)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**403-vs-422 split (SC-7 b) — founder decision 2026-11-15**
- SC-7 (b), the 403-vs-422 split in `_scope_rejected` (`analytics-service/routers/process_key.py`, the `_scope_rejected = (` gate). It changes or pins a public API error contract, so it is not decided here. Measured at 3f29f1539 with the adapter mocked (teaser flow, same gate): `AUTH_FAILED` gives 403 with recoverable false; no error_code plus `read_only=False` (our `VALIDATION_UNEXPECTED` fallback) gives 403 with recoverable false; `PARSE_ERROR` and `CSV_VALIDATION_FAILED` (the `first_rule.upper()` CSV family) give 424 with recoverable true. So the TODOS premise "a malformed CSV answers 403" is stale since PYAPIFIX-02: every non-permanent code, including every CSV rule code, now takes the 424 venue-transient arm. The second gate, `services/ingestion/long_fetch.py` `_scope_rejected`, returns a worker DispatchResult, not an HTTP status, so the 403/422 question applies to the route only. `src/lib/process-key-client.ts` branches on `body.ok`, never on status, so a status change does not change TS routing, but `recoverable` reaches the wizard envelope.
- **FOUNDER DECISION 2026-11-15: Option A, "Pin today, book fix".** Phase 215 changes no behaviour. It pins every current status in the route `_scope_rejected` gate per arm: permanent codes (`AUTH_FAILED`, `PERMISSION_DENIED`, `TRADE_SCOPE`, `WITHDRAW_SCOPE`, `MISSING_SCOPE`) and our `VALIDATION_UNEXPECTED` fallback answer 403 recoverable false; every other code, including the CSV `first_rule.upper()` family and `CSV_VALIDATION_FAILED`, answers 424 recoverable true. The pin's comment names the follow-up fix (a malformed CSV should not be told a retry can succeed). The follow-up phase is booked by the coordinator with /gsd-phase in the 215 records PR after merge; Phase 215 does not book it. — **Reversibility:** costly — public `/process-key` error contract; moving it later is its own phase.

**Money-math parity (SC-1)**
- Run the `HAS_PY_ENV` KPI parity cases in CI. They pass today (`HAS_PY_ENV=1 pytest tests/test_outcomes_kpi_parity.py`: 5 passed at 3f29f1539) and their fixture `tests/fixtures/outcomes-kpi-parity.json` is in the repo.

**Decided autonomously**
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

### Deferred Ideas (OUT OF SCOPE)
- The CSV 424 recoverable:true fix: its own phase, booked by the coordinator after 215 merges (founder 2026-11-15).
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs exist for this phase (ROADMAP: `**Requirements**: TBD`). SC-1..SC-9 of the ROADMAP entry are the contract.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | `HAS_PY_ENV` parity tests run in CI | Section "SC-1": delete the module-level `skipif`; fixture resolves from the full checkout; 5 cases are the only skips of that module |
| SC-2 | `TEST_SUPABASE_DB_URL`-gated tests run on `LANE_DB_URL` or are listed with a reason | Section "SC-2": measured skip population (21 DSN-reason cases in 7 modules + 3 sibling cases), resolver design, guard reuse, roster of cannot-run cases |
| SC-3 | Shared app-factory replaces every bare `FastAPI()` in tests | Section "SC-3": 21 modules / 36 sites, production helper extraction, empirical trial result (one assertion must be re-cut) |
| SC-4 | Worker raises a domain exception that `classify_exception` maps | Section "SC-4": four sites measured byte-for-byte, `except HTTPException: raise` trap, census and test blast radius |
| SC-5 | Two key-step rosters derived per route | Section "SC-5": what the route contract is today, the five test files that parse the roster declarations by source text |
| SC-6 | Binance cassettes recorded or retired | Section "SC-6": retire; no census counts cassettes |
| SC-7 | D-161-01 visible, 403-vs-422 pinned (Option A), teaser alert | Sections "SC-7a/b/c" |
| SC-8 | No migration | `git diff --stat -- supabase/migrations` must stay empty; every change here is test, CI-adjacent or a small production extract |
| SC-9 | Each fix has a test that goes RED when reverted | "Validation Architecture" lists one RED proof per SC |
</phase_requirements>

## Summary

The phase is nine independent test-reach repairs. The measured baseline at 3f29f1539 is: CI `python` job (run 43653840893, job 132628053685) = **14909 passed, 68 skipped, 2 xpassed**; a local run from `analytics-service/` (Python 3.14, no xdist, no DB) = **14877 passed, 101 skipped, 1 failed** where the single failure (`tests/test_xdist_group_is_real.py::test_shared_db_group_runs_on_one_worker_with_the_group_suffix`) is environmental (`-n` is unrecognised because `pytest-xdist` is not installed locally). Same total (14979 tests) both ways. `mypy --strict ... services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` is green locally (139 source files). The worktree has **no `node_modules`**, so every vitest/tsc command needs an install or link first.

Three findings change the plan shape. (1) SC-3: two trials were run, and they showed different things. A lazy plugin attaching the three production app-global handlers (422, 429, venue-transient 424) to bare apps built after `main` was imported left the **full suite** identical to baseline, but a test's own `add_exception_handler` call still overrode it, so that run did not exercise the slowapi-default-handler sites. A second plugin that also substituted production's 429 handler for slowapi's default was run **per module only** (21 modules, each alone): 19 pass unchanged and one module needs **one** assertion re-cut (`_assert_not_the_in_handler_429` in `tests/test_limiter_identity.py`, 2 tests), because it deliberately registered slowapi's default 429 handler and production's body carries `RATE_LIMITED`, which the discriminator uses to tell two 429 sources apart. The full suite with always-on substitution was not run, [ASSUMED] to match baseline. (2) SC-4: replacing the HTTPException sites forces edits in five places that would otherwise fail silently or loudly: the `except HTTPException: raise` arm inside `run_csv_strategy_analytics` (left alone it turns the 400/422 into a 500), the `QUARANTINE` census row, `EXPECTED_SITE_COUNT`/`EXPECTED_TRIPLE_COUNT`, and ~25 `pytest.raises(HTTPException)` assertions across 8 modules. (3) SC-5: five test files read the two roster declarations as source text; changing the declaration shape blinds them unless they are re-pointed at live exports in the same commit.

**Primary recommendation:** Run SC-1/SC-6 (one-line gates), SC-2 (resolver in `tests/`, no YAML export of `TEST_SUPABASE_DB_URL`), SC-3+SC-7c (one new `services/` module holding the three handlers, the installer and the anon-saturation alert), SC-4, SC-5 and SC-7a/b as six plans; serialize the plans that touch the same files (`conftest.py`, `test_raw_5xx_census.py`, `test_process_key.py`).

## Project Constraints (from CLAUDE.md)

- **Which database am I on:** the Supabase CLI in this checkout is linked to PRODUCTION; `current_database()` is `postgres` on both TEST and PROD. Any write needs the `shobj_description(oid,'pg_database')` marker query first. SC-2 must never aim a writing test at shared TEST or PROD: the lane's stock comment is `default administrative connection database` (quoted from `tests/test_compute_job_metadata_merge_live.py` `_LANE_DATABASE_COMMENT`). [VERIFIED: analytics-service/tests/test_compute_job_metadata_merge_live.py]
- `critical-regressions.test.ts` forbids exporting the lane DSN under `TEST_SUPABASE_DB_URL` in the `python` job and forbids `secrets.TEST_SUPABASE_*` there. SC-2 must stay inside that tripwire. [VERIFIED: src/__tests__/critical-regressions.test.ts, the `python reads no shared-TEST secret and runs no TEST ordering wait (Phase 164.9.4 D-08)` `it`]
- **Test coverage:** `vitest.config.ts` thresholds are a ratchet; the `python` job enforces `--cov-fail-under=80`; the pytest command literal is pinned byte-for-byte by `src/__tests__/local-stack-lane-wiring.test.ts` (`-n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`). Do not add flags such as `-rs` to the CI step.
- **mypy strict:** `analytics-service` gate names `services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`; `tests/` is untyped by design; no `# mypy:` comments or suppression comments in surface files (`ci-mypy-strict-surface.contract.test.ts`).
- **CHANGELOG discipline:** every ship writes a CHANGELOG entry plus a `VERSION`/`package.json` bump in the same commit; section vocabulary is the repo's own (`### Fixed`, `### Added`, `### Changed`, `### Removed`, `### Tests`, `### Notes`, ...). Never write the CI skip trailer tokens in a commit message or PR body.
- **TODOS.md holds open work only (rule b):** the ship deletes the entries it closes and names them in the CHANGELOG: `[D-161-01]` (0.011), `ROSTER-DERIVE-01`, and the whole "v1.16 Phase-140.1 review — formerly HOMELESS findings" block (five bullets). Also fix pointers to closed ids in the same PR: `ROSTER-DERIVE-01` is cited in `ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx` and `wizardErrors.invariant.test.ts`. [VERIFIED: grep this session]
- **No AI authorship attribution lines** in commits or PRs (MEMORY rule, which takes precedence).
- **No new packages**, no migration (SC-8). Banned packages table is not touched.
- **Never use Grok or Codex; ask before /simplify; AGENTS.md says Next.js has breaking changes** — read `node_modules/next/dist/docs/` only if a Next route file is edited (SC-5 Option R1 does not edit route files).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| KPI parity gate (SC-1) | Python test tier (pytest in `python` job) | TS test tier (`outcomes-kpi.test.ts` reads same fixture) | Cross-runtime parity oracle lives in `tests/fixtures/outcomes-kpi-parity.json` |
| Live-DB test reach (SC-2) | Test harness (`analytics-service/tests`) | CI job `python` (lane handoff via `$GITHUB_ENV`) | DSN resolution is a harness concern; the YAML must not export `TEST_SUPABASE_DB_URL` |
| App-global error handlers (SC-3) | API tier (`services/` module imported by `main.py`) | Test harness (factory) | One production helper so prod and tests cannot drift |
| Worker failure taxonomy (SC-4) | Worker tier (`services/job_worker.classify_exception`) | `services/analytics_runner` raise sites | `run_csv_strategy_analytics` is called only by the worker, so HTTP vocabulary is a category error there |
| Wizard code rosters (SC-5) | Browser/Client (`ConnectKeyStep`, `MultiKeyConnectStep`) | API tier (two route handlers), `src/lib/wizardErrors.ts` | Step admits the codes ITS route emits plus classifier-returned codes |
| CSV rule family visibility (SC-7a) | Test tier (vitest scanner over Python source) | Python `csv_validator` / `csv_adapter` | The derived vocabulary is a TS invariant that scans Python literals |
| `_scope_rejected` status pins (SC-7b) | API tier (`routers/process_key.py`) | Test tier | Pin only; behaviour unchanged |
| Anon bucket saturation alert (SC-7c) | API tier (429 handler path) | Sentry (rule routing is outside the repo) | Refusal is raised by slowapi, rendered by the app-global 429 handler |

## Standard Stack

### Core (all already installed; nothing new)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pytest | CI 3.12 env from `requirements-dev.txt`; local 9.0.2 | Python tests | Existing |
| pytest-xdist | in `requirements-dev.txt` (not installed locally) | `-n auto --dist loadgroup`, `shared_test_db` group | Existing; `conftest.py` pins live-DB modules to one worker |
| fastapi | local 0.139.0; production pin in `requirements.txt` | handler installation via `add_exception_handler` | Existing |
| slowapi | `slowapi==0.1.10` | rate limiting; `request.state.view_rate_limit` carries the failing limit's key | Existing [VERIFIED: analytics-service/requirements.txt] |
| sentry-sdk | `sentry-sdk==2.73.0` (local 2.58.0) | `capture_message`, `new_scope`, `fingerprint` | Existing |
| psycopg | existing | live-DB tests | Existing |
| vitest | existing (Node 22) | TS invariants | Existing |

### Supporting
| Library | Purpose | When to Use |
|---------|---------|-------------|
| `tests/live_db_transport.wrap_live_db_client` | bounded retry for lane PostgREST calls | Any new lane test that uses `create_client` |
| `tests/test_secret_misconfig_signal._FakeSentry` idiom | capture `new_scope`/`set_tag`/`capture_message` | SC-7c test |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Raw `sentry_sdk.capture_message` + per-process window (locked) | `services/ops_alert.page` | `page` already windows hourly per (source, cause, event) and fingerprints, but it also emails the founder, needs a source in the closed `OPS_ALERT_SOURCES` set and rides a live Sentry rule. Locked decision says capture_message; keep it |
| Export `TEST_SUPABASE_DB_URL=$LANE_DB_URL` in ci.yml | resolver helper in `tests/` | The YAML export is forbidden by a pinned tripwire and would also leak the shared-TEST secret's name into every child process |

**Installation:** none. **Version verification:** no package is added or changed, so no registry check applies.

## Package Legitimacy Audit

No external packages are installed or changed by this phase. **Packages removed due to [SLOP]:** none. **Packages flagged [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
 CI python job (ci.yml: python)
   boot lane (scripts/local-stack/run.sh up) ──► $GITHUB_ENV: SUPABASE_TEST_URL, SUPABASE_TEST_SERVICE_KEY, LANE_DB_URL
        │                                         (never TEST_SUPABASE_DB_URL)
        ▼
   pytest -n auto --dist loadgroup (CI=true)
        │
        ├─ tests/live_db_dsn.py (NEW, SC-2) ── LANE_DB_URL ─► loopback host check ─► stock-comment check ─► psycopg conn
        │       (7 modules; CI + no LANE_DB_URL = FAIL, never skip)
        │
        ├─ tests/app_factory.py (NEW, SC-3) ── build_test_app(*routers) ──► install_app_exception_handlers(app)  ◄── main.py calls the SAME function
        │        422 VALIDATION_FAILED | 429 RATE_LIMITED (+ anon-saturation alert, SC-7c) | 424 venue-transient
        │
        └─ job path: job_worker.classify_exception ◄── WorkerJobFailure (SC-4) raised by run_csv_strategy_analytics (4 sites)
                                                    ◄── fastapi.HTTPException arm kept (other callers, existing tests)

 vitest (frontend shards)
   wizardErrors.invariant.test.ts ◄── live Set exports (SC-5) ── ConnectKeyStep / MultiKeyConnectStep build their roster from them
   seam-venue-vocabulary.invariant.test.ts ◄── csv_validator.py rule literals upper-cased (SC-7a)
```

### Recommended Project Structure
```
analytics-service/
├── services/app_error_handlers.py   # NEW: 3 handlers + install_app_exception_handlers(app) + anon-saturation alert
├── services/job_failure.py          # NEW leaf: WorkerJobFailure + 4 named subclasses (no cycle with job_worker/analytics_runner)
└── tests/
    ├── app_factory.py               # NEW: build_test_app(*routers); conftest fixture wraps it
    ├── live_db_dsn.py               # NEW: resolve_live_db_dsn() + guards extracted from test_compute_job_metadata_merge_live
    └── test_app_factory_parity.py   # NEW: RED proofs for SC-3
src/lib/wizardKeyRosters.ts          # NEW (SC-5 R1): live exports the two steps and the guard both import
```

### Pattern 1: SC-1 (money-math parity runs)
**What:** delete the module-level skip in `analytics-service/tests/test_outcomes_kpi_parity.py` and fix the docstring that says "gated on HAS_PY_ENV=1". The module's own text is the only reference to `HAS_PY_ENV` repo-wide. [VERIFIED: grep this session; the only hits are `test_outcomes_kpi_parity.py:6` and `:17-18`]
```python
# Source: analytics-service/tests/test_outcomes_kpi_parity.py (current, to be deleted)
pytestmark = pytest.mark.skipif(
    os.environ.get("HAS_PY_ENV") != "1",
    reason="Python parity test gated on HAS_PY_ENV=1 (Phase 5 D-21 / Voice-D2 option a)",
)
```
**Checkout:** the `python` job's `actions/checkout` step carries only `persist-credentials: false` (no sparse or path filter), so `REPO_ROOT = parents[2]` resolves to the repo root and `tests/fixtures/outcomes-kpi-parity.json` exists. The fixture is tracked (`git ls-files tests/fixtures/outcomes-kpi-parity.json` prints it) and is also read by `src/lib/outcomes-kpi.test.ts` (TS half). [VERIFIED: ci.yml `python` job steps, `git ls-files`]
**Measured:** with the skip gone the module is 5 tests; `HAS_PY_ENV=1 python3 -m pytest -q tests/test_outcomes_kpi_parity.py` printed `5 passed in 5.80s` this session, and the 5 skip lines are exactly `tests/test_outcomes_kpi_parity.py:31,38,61,144,168` (this session's `-rs`).
**RED proof:** edit one value in `_HAND_DERIVED_SUCCESS` or the fixture's `phase4_success_values` and watch `test_success_value_matches_independent_oracle` / `test_independent_oracle_agrees_with_fixture_for_kpi_rows` go red; restore from a byte backup. Plus a vacuity guard is unnecessary: with no skip the five tests either run or the job's skipped count drops by 5 (68 -> 63 plus other changes), which the verifier reads from the CI summary line.

### Pattern 2: SC-2 (live-DB tests on the lane)

**How the `python` job exports it (measured).** In `.github/workflows/ci.yml` job `python`, step "Lane handoff - assert loopback, then export the URL and keys to later steps" runs `run.sh --assert-local-handoff`, masks the values, then appends to `$GITHUB_ENV`:
```
printf 'SUPABASE_TEST_URL=%s\n' "${api_url}" >> "${GITHUB_ENV}"
printf 'SUPABASE_TEST_SERVICE_KEY=%s\n' "${service_key}" >> "${GITHUB_ENV}"
printf 'LANE_DB_URL=%s\n' "${db_url}" >> "${GITHUB_ENV}"
```
[VERIFIED: ci.yml lines ~5834 area; the step also comments "The name is LANE_DB_URL so the psycopg modules gated on TEST_SUPABASE_DB_URL stay skipped."] The pytest step is `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` with only `CI: 'true'` in `env:` (so nothing shadows the `$GITHUB_ENV` values). [VERIFIED: ci.yml `- run: pytest -n auto`, `CI: 'true'`]

**How tests resolve a DSN today.** Seven modules gate on `os.environ.get("TEST_SUPABASE_DB_URL")` and read `os.environ["TEST_SUPABASE_DB_URL"]` in a `service_role_conn` fixture; only `test_compute_job_metadata_merge_live.py` reads `LANE_DB_URL` (and it runs in CI because it fails rather than skips under `CI=true`). `conftest.py` mentions `TEST_SUPABASE_DB_URL` only as one of six xdist-grouping sentinels (`_DB_MODULE_SENTINELS`), it resolves nothing. [VERIFIED: grep + conftest.py read]

**Measured skip report (`pytest -rs`, whole suite, local, no DB):** 101 skipped. Grouped by reason:

| Reason | Cases | Modules (count) |
|--------|-------|-----------------|
| `TEST_SUPABASE_DB_URL unset` (the SC-2 population) | **21** | `test_csv_daily_returns_dualaxis_live` (7), `test_csv_daily_returns_perkey_rls_live` (3), `test_persist_csv_daily_returns_live` (2), `test_resend_correlation_rls` (2), `test_sync_trades_preserves_fills` (2), `test_trigger_rls_audit` (4), `test_job_worker` (1: `TestTradesIsFillRls`) |
| sibling gate in the same persist module: `SUPABASE_URL or SUPABASE_SERVICE_KEY unset` (the runner's own `get_supabase()`) | 3 | `test_persist_csv_daily_returns_live` |
| lane/`SUPABASE_TEST_*` gates that are meant to run in CI | 60 | fencing 25, similarity 10, drain 6, transition 5, metadata-merge 4, flow_price_store 3, trade_read_store 3, nav_marks_writer 2, computed_at 1, migration_108 1 |
| `test_compute_jobs_fencing.py` P1-TODO skips (`P1 TODO — flaky httpx.ReadTimeout`), skip in every environment | 3 | same module, a different reason from the 25 above |
| `HAS_PY_ENV` (SC-1) | 5 | `test_outcomes_kpi_parity` |
| binance cassettes (SC-6) | 4 | `test_repro_key_flow` |
| founder-gated real venue keys | 3 | `test_sfox_client_live` (2, `SFOX_SANDBOX_KEY`), `test_sfox_ground_truth_live` (1, `SFOX_GROUND_TRUTH_KEY`) |
| `HAS_LIVE_DB + SUPABASE_URL + SUPABASE_ANON_KEY` probe | 1 | `test_upsert_strategy_analytics_series_batch_privilege` |
| empty parameter set (not an env gate) | 1 | `test_mt5_validate` (`got empty parameter set for (observation)`) |

So the TODOS figure "31" is stale; the measured SC-2 population is **21 DSN-reason cases (+3 sibling cases in the same module)**. The CI python job's skip count at 3f29f1539 is 68 and local is 101; The CI job un-skips only 33 net (101 - 68) although 60 locally skipped cases are lane-gated, so **27 lane-gated cases appear to still skip or otherwise not run in CI**; that gap is unexplained here and outside SC-1..SC-9 (report it, do not chase it in this phase). **CI's own skip list is not observable**: CI runs without `-rs` and the pytest command is pinned, so the exact CI set cannot be read from the log. Plan task 1 therefore measures it, either by booting the lane locally (docker is present) and running `pytest -rs` with `LANE_DB_URL`, `SUPABASE_TEST_URL`, `SUPABASE_TEST_SERVICE_KEY`, `CI=true`, or by a one-off CI run on the branch with `-rs` in a throwaway commit that is not shipped.

**Recommended resolver (do not export `TEST_SUPABASE_DB_URL`).** CONTEXT says "conftest-level resolution": make a session-scoped fixture `live_db_dsn` in `conftest.py` the entry point (the 7 modules' `service_role_conn` fixtures request it; the module-level `skipif` goes away because the fixture decides skip-or-fail at run time), and keep the guards in a helper `analytics-service/tests/live_db_dsn.py`:
- `resolve_live_db_dsn() -> str | None`: if `LANE_DB_URL` is set, run the three guards that already exist in `test_compute_job_metadata_merge_live.py` (`_require_loopback_dsn` host and hostaddr loopback, `_server_addr_is_lane`, `_require_stock_database_comment` against `default administrative connection database`) and return it; else return `TEST_SUPABASE_DB_URL` only when `CI` is not `true` (the developer's explicit shared-TEST path, behaviour unchanged); else `None`.
- Under `CI=true` with no `LANE_DB_URL`: `pytest.fail`, never skip (the merge-probe precedent: "The probe FAILS (never skips) when this variable is absent under CI=true").
- Move the guard functions out of the merge probe into this helper and import them back, so one definition guards every writing module.
- The 7 modules replace `skipif(not os.environ.get("TEST_SUPABASE_DB_URL"))` and `os.environ["TEST_SUPABASE_DB_URL"]` with the helper. The nested `TestTradesIsFillRls` gate in `test_job_worker.py` needs the same edit; it also has an in-body `pytest.skip("TEST_SUPABASE_DB_URL not set")` (delete it).
- The three `SUPABASE_URL`/`SUPABASE_SERVICE_KEY` cases (`_worker_pipeline_env_present`): patch `services.analytics_runner.get_supabase` to a lane client built from `SUPABASE_TEST_URL`/`SUPABASE_TEST_SERVICE_KEY`, rather than exporting `SUPABASE_URL`. ⛔ **Census trap:** `tests/test_live_db_transport.py` asserts that the set of `tests/*.py` modules defining `def _need_supabase` equals the set of modules containing the string `live_db_transport`. Wrapping this module's client with `wrap_live_db_client` (or putting that string anywhere in a persist module) without also defining `_need_supabase` reds that census; either build the client unwrapped or follow the census's own rule. [VERIFIED: tests/test_live_db_transport.py, the derived-pin test near its end] `conftest.py` documents why a set `SUPABASE_URL` is a write-to-a-real-project hazard locally.
- **xdist pitfall:** the modules stop containing the literal `TEST_SUPABASE_DB_URL`, and `conftest._DB_MODULE_SENTINELS` is content-based. Add `"live_db_dsn"` to the tuple (as `"live_db_transport"` was added; the modules still contain that token because they request the fixture by that name), or the 7 writing modules silently leave the `shared_test_db` group and race `test_compute_jobs_fencing.py`'s global claim assertions. Pin it in `test_xdist_group_is_real.py` or a sibling test.
- **Pinned tripwire to update, not delete:** the `it` in `critical-regressions.test.ts` whose message says exporting under `TEST_SUPABASE_DB_URL` "silently un-skips 20+ psycopg modules this phase does not scope in". The regex still holds; add a dated `CORRECTED` note to the message and add a positive pin that the `python` job's lane handoff exports `LANE_DB_URL`.

**Cases that cannot run on the lane (to be listed in the pinned roster, with reason):** `test_sfox_client_live` (2) and `test_sfox_ground_truth_live` (1) need a real founder-minted venue key; `test_upsert_strategy_analytics_series_batch_privilege` (1) needs `HAS_LIVE_DB` plus anon-key wiring that the lane does not export (re-measure; it may be runnable); `test_mt5_validate` empty-parameter-set (1) is not a DB gate. Everything else in the 21 + 3 writes only synthetic uuid-keyed rows and needs `auth.users` insert, anon-role denial and the baseline schema, which the lane has (superuser DSN, baseline + replayed migrations). **That the 24 are green on the lane is [ASSUMED]**: not booted in this research.

**Write safety:** all 24 INSERT/DELETE. They must run only against the lane (loopback + stock comment), never shared TEST, and PROD is never reachable from the lane DSN. The helper's marker check is the repo's database-identity query (CLAUDE.md "ask FIRST") applied in code.

### Pattern 3: SC-3 (one production handler helper, one test factory)

**What main.py installs (measured, `analytics-service/main.py`):**
- `app = FastAPI(title="Quantalyze Analytics Service", version="0.1.0", lifespan=lifespan)` then `app.state.limiter = limiter`.
- `app.add_exception_handler(RequestValidationError, validation_exception_handler)` (422, body `{ok:false, code:"VALIDATION_FAILED", human_message, detail:<scalar>, correlation_id, recoverable:false}`).
- `app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)` (429, `code:"RATE_LIMITED"`, `Retry-After`).
- `app.add_exception_handler(VenueTransientHTTPException, venue_transient_exception_handler)` (flat `{detail, code, recoverable}`, status echoed from the exception).
- Then `CorrelationMiddleware`, `CORSMiddleware`, `_gate_process_key` middleware, routers. [VERIFIED: main.py reads of lines 390-725]

So there are **three** app-global handlers, not two; the factory must install all three or a venue-transient `VenueTransientHTTPException` raised in a router under test renders FastAPI's default body (the stated reason `tests/test_validate_key_venue_transient.py` calls `main.venue_transient_exception_handler` directly).

**Production helper.** Extract to a new `analytics-service/services/app_error_handlers.py` (no `main` import, so tests do not pay `load_dotenv`/`init_sentry`/router imports and no cycle): `_validation_detail`, `validation_exception_handler`, `_retry_after_seconds`, `rate_limit_exceeded_handler`, `venue_transient_exception_handler` and `install_app_exception_handlers(app)` that registers all three. Whether the factory should also set `app.state.limiter = limiter` is [ASSUMED] harmless (no trial set it; about half of the 36 sites set it themselves today and slowapi's decorators need it); decide when writing the factory. `main.py` imports the names back (existing tests call `main.venue_transient_exception_handler`; `test_rate_limit_contract.py` documents `main._retry_after_seconds`) and calls `install_app_exception_handlers(app)` where the three `add_exception_handler` calls are now. mypy: `services/` is already in the strict surface (new file needs no command change). Coverage: `--cov=services` includes the new module while `main.py` is outside `--cov`, so the moved handlers now count in the 80% denominator (they are exercised by `test_validation_error_contract.py`, `test_rate_limit_contract.py` and the new tests, so no drop is expected); keep the `(Request, Exception) -> Response` signatures and `cast`, never a suppression comment.

**Census edits forced by the extract:** `tests/test_raw_5xx_census.py::test_the_three_known_non_literal_sites_are_the_contract_pass_throughs` hand-types `("main.py", "venue_transient_exception_handler", "JSONResponse")`; after the move that triple becomes `("app_error_handlers.py", ...)`. `EXPECTED_NON_LITERAL_STATUS_SITES` stays 3. `("main.py", "health", 503)` is untouched. [VERIFIED: test_raw_5xx_census.py lines 203, 748-762]

**The 21 modules (grep `=\s*FastAPI\(` under `analytics-service/tests`, 36 construction sites; the TODOS says nine):**

| Module | Mounts | Change risk under production handlers |
|--------|--------|----------------------------------------|
| test_benchmark_refresh, test_ops_alert, test_prober_cadence_alert | `cron` router | none (measured pass) |
| test_correlation_middleware | no router, `CorrelationMiddleware` only | none; handlers are irrelevant to it. It is middleware-only by design: either move it too (factory with `routers=()` and `middleware=[CorrelationMiddleware]`, zero deviation) or record the one deviation in SUMMARY |
| test_csv_fault_capture_170_1, test_csv_hostile_inputs_170_1, test_csv_validation_off_event_loop_170_1 | `csv` router, `process_key` router | none |
| test_debug_key_flow_router, test_mt5_internal_probe, test_sfox_internal_probe, test_mt5_rotate_secret_internal, test_maybe_single_none_guards, test_status_contract_exchange_internal | `internal`/`exchange`/debug routers | none (the `detail["code"]` assertions are `service_error` envelopes, unaffected) |
| test_match_router, test_match_holding_returns, test_status_contract_match_sim_portfolio | `match`, `simulator`, `portfolio` | none |
| test_simulator_router (5 sites) | `simulator` | none |
| test_process_key (3 sites), test_process_key_200_discriminator, test_sentry_transaction_redaction_170_1 | `process_key` | none. `test_process_key.py::throttled_client` registers slowapi's default 429 handler on purpose; production's handler replaces it with no assertion change (only status 429 is read) |
| **test_limiter_identity (3 sites)** | `match`, probe, `simulator` | **2 tests fail**: `TestSimulatorTenantBucketBehaviour::test_a_tenant_claimed_caller_is_throttled_at_the_decorator` and `::test_one_tenants_exhausted_bucket_does_not_throttle_another`. `_assert_not_the_in_handler_429` asserts `"RATE_LIMITED" not in resp.text` to distinguish slowapi's default `{"error":...}` body from `_check_simulator_user_rate`'s nested `service_error` body; production's 429 body contains `"code":"RATE_LIMITED"`. Re-cut the discriminator to the structural difference (in-handler quota: `body["detail"]` is a dict with `code`; production slowapi handler: top-level `code` and `detail` is a string) |

**Empirical trials (this session, plugins in the scratchpad, no repo edit):** (a) lazy plugin attaching the three handlers to bare apps built after `main` was imported (a test's own later `add_exception_handler` still wins), **full suite**: 1 failed, 14877 passed, 101 skipped, identical to baseline; (b) plugin that additionally substituted production's 429 handler for any registration of slowapi's default and imported `main` on first app construction, **each of the 21 modules run alone**: 19 pass unchanged, `test_limiter_identity.py` fails the 2 tests above, `test_correlation_middleware.py` passes. Full-suite always-on substitution: not run, [ASSUMED] equal to baseline. [VERIFIED: runs this session]

**Pitfall measured: do not verify by running the 21 modules together.** Running just those 21 modules in one pytest invocation fails **20** tests at baseline with no plugin at all (`test_process_key_200_discriminator.py` x15, `test_process_key.py` x5: shared limiter state/module identity, the failure family `test_limiter_identity.py` documents). Verify per module or with the full suite only. An early `import main` in a plugin or conftest also changes router module identity (`test_process_key_route_registers_both_limits` saw 4 limit groups instead of 2): the factory must NOT import `main`, which is the second reason for the `services/` module.

**Factory shape.** `tests/app_factory.py::build_test_app(*routers, middleware=())` returns `FastAPI()` + `install_app_exception_handlers(app)` + `app.include_router(...)` for each router. Needs to be an importable function, not only a conftest fixture, because several sites are inside helper functions or class fixtures (`_probe_app()`, `_simulator_app()`, per-test `app = FastAPI()` in `test_simulator_router.py`). Provide a thin fixture wrapper in `conftest.py` for modules that want one.

**RED proofs (SC-9) and the regrowth guard:**
1. A parity test: `build_test_app().exception_handlers` has the same three handler objects as `main.app.exception_handlers`; revert (factory skips the installer) and it goes red.
2. A canary 422 through a factory app (copy the `test_validation_error_contract.py` canary idiom: secret appears zero times in body and headers) and a 429 through a factory app (`code == "RATE_LIMITED"` and a positive `Retry-After`).
3. An AST scan of `analytics-service/tests/**/*.py` for `FastAPI(` constructor calls outside `app_factory.py`, with an empty allowlist (or exactly `test_correlation_middleware.py` if it is deliberately left bare and recorded). Scan with `ast` and a vacuity floor, the way `test_raw_5xx_census.py` does, not with grep.

### Pattern 4: SC-4 (worker raises a domain exception)

**The four sites, measured byte-for-byte** (Python, this session; `classify_exception` on the current `HTTPException`s):

| Site (`run_csv_strategy_analytics`) | Raised | `classify_exception` returns |
|---|---|---|
| strategy row missing | `HTTPException(status_code=404, detail="Strategy not found")` | `('unknown', '404: Strategy not found')` |
| insufficient history (inside the `try`) | `HTTPException(status_code=400, detail="Insufficient CSV history")` | `('permanent', '400: Insufficient CSV history')` |
| `except ReturnsDenominatorConfigError as cfg_exc` | `HTTPException(status_code=422, detail="Malformed returns_denominator_config") from cfg_exc` | `('permanent', "422: Malformed returns_denominator_config (cause: Cfg('boom'))")` (the `(cause: repr(cause)[:180])` suffix) |
| `except Exception as exc` catch-all | `HTTPException(status_code=500, detail="CSV analytics computation failed")` (no `from`) | `('unknown', '500: CSV analytics computation failed')` |

The 5xx never reaches the HTTPException arm's `return` (it falls through the `match` to the final `return ("unknown", str(exc)[:500])`, and Starlette's `str(HTTPException)` is `"500: ..."`), and it carries no cause because it is raised inside the `except` without `from`. [VERIFIED: job_worker.py `classify_exception` lines 1230-1417, `_format_http_detail` 1208; analytics_runner.py raise sites; executed this session]

**Design.** New leaf module `analytics-service/services/job_failure.py` (leaf, so `job_worker` can import it at module top without the lazy-import dance `analytics_runner` needs; `analytics_runner` re-exports for the CONTEXT wording "domain exception in analytics_runner"):
```python
class WorkerJobFailure(Exception):
    error_kind: Literal["transient", "permanent", "unknown"]   # same alphabet as job_worker.ErrorKind
    message: str   # the persisted prefix text, e.g. "404: Strategy not found"
```
with four named subclasses/constructors (not-found, insufficient-history, malformed-denominator-config, computation-failed). `classify_exception` gets one new arm placed beside the HTTPException arm: `return (exc.error_kind, (exc.message + cause_suffix)[:500])`, with `cause_suffix = f" (cause: {repr(cause)[:180]})"` when `exc.__cause__` is not None (the 422 site keeps `raise ... from cfg_exc`). The `message` keeps the legacy numeric prefix on purpose: SC-4 holds persisted text byte-identical (`compute_jobs.last_error` is read by the admin UI). Do NOT delete the HTTPException arm: other callers and ~12 `test_job_worker.py` cases (`test_http_exception_*`) still exercise it, and `routers/portfolio.py::_compute_portfolio_analytics` and `routers/match.py` helpers legitimately raise `HTTPException` for the route half while also being worker-reached (`run_compute_portfolio_job`, the rescore handler); SC-4 scopes to the four sites (see Open Questions 3).

**Equivalence pin (SC-9):** a parametrized test that builds the old `HTTPException` (with `__cause__` for the 422) and the new exception for each of the four sites and asserts `classify_exception(new) == classify_exception(old)`, plus the four literal tuples above as an independent oracle. RED proof: change one `error_kind` or drop the cause suffix and it fails.

**Traps (each measured by reading code):**
1. `analytics_runner.py` has `except HTTPException:\n    raise` (line ~2544) so the 400 raised inside the `try` bypasses the catch-all. Leaving it while raising `WorkerJobFailure` turns the 400 (and any other new raise inside the `try`) into the 500 "CSV analytics computation failed", persisted as `unknown` (retried) instead of `permanent`. Change it to `except WorkerJobFailure: raise` (and keep HTTPException out). The existing `test_csv_analytics_runner.py` 400 test asserts the status, so re-pointing it catches this.
2. `tests/test_raw_5xx_census.py`: `QUARANTINE` contains `("analytics_runner.py", "run_csv_strategy_analytics", 500): 1`, compared with `==` against the derived census; delete that row, `EXPECTED_SITE_COUNT` 12 -> 11 and `EXPECTED_TRIPLE_COUNT` 9 -> 8 (the module docstring says "the 12 sites collapse to only 9 distinct triples"; fix the prose with a dated note). [VERIFIED: lines 133-151]
3. About 25 `pytest.raises(HTTPException)` assertions on `run_csv_strategy_analytics`/`run_compute_analytics_from_csv_job` must be re-pointed: `test_csv_analytics_runner.py` (224, 317, 391, 443, 588, 1249, 1975, 2136), `test_failed_status_logged.py` (139, 183, 211, 254), `test_analytics_runner.py` (3413, 3470, 3500), `test_ledger_refresh_publish_guard.py` (829, 846, 897, 932), `test_ledger_refresh_hop2_oracle.py` (420), `test_pgrst204_recovery_fallback.py` (175), `test_computation_error_provenance_fallback.py` (271), `test_persist_csv_daily_returns_live.py` (comment at 247/384). They read `.status_code` and `.detail`; assert `.error_kind` and `.message` instead. Do not give the new class `.status_code`/`.detail` aliases (that re-imports the HTTP vocabulary the SC removes).
4. The only source caller is `services/job_worker.py::run_compute_analytics_from_csv_job` (grep); the comment there that says "the other three callers" (wizard route, composite finalizer) is stale lineage, not a live caller.

### Pattern 5: SC-5 (two key-step rosters, per route)

**Where they live.** `KNOWN_CREATE_WITH_KEY_CODES` in `src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.tsx` (`const KNOWN_CREATE_WITH_KEY_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>([ ... ])`, about 31 members) and `KNOWN_ADD_KEY_CODES` in `.../MultiKeyConnectStep.tsx` (about 26 members). Each step calls `translate-first` (`recogniseSeamErrorCode(seamErrorCode(data))`) then the membership check. [VERIFIED: both files read this session]

**What "each route's contract" is today.** The route half and the classifier half are already *derived by the guard*, not by production:
- Route-own codes of `create-with-key` / `composite/add-key`: literal `NextResponse.json({ code: "X", error: ... }, { status: 400 })` sites, scanned by `deriveEmittedCodes`/`emitterRe` in `src/lib/wizardErrors.invariant.test.ts` (per-route `statusRe` "400", `expectedSites` 13 and 13), plus a hand-typed 409 set (`[161-05 / WIZERR-03]` describe) and a hand-typed `RATE_LIMITED` twin (`[164.2-04]`, the code rides `rateLimitDenyJson`, invisible to any literal scan).
- Classifier-returned codes (both routes call `classifyKeyValidationError`): door A = literal `return { code: "X", ... }` in `classifyKeyValidationError` (`deriveClassifierCascadeCodes`, floor 10), door B = the LIVE `VENUE_WIRE_CODE_TO_VERDICT` Map values (`VENUE_WIRE_CODE_TO_VERDICT` in `src/lib/wizardErrors.ts`), admitted unless `SEAM_CODE_TO_WIZARD_CODE` translates the code first. That is `[153.7 review W-153.7-1]`.
- So ~20 of the ~31 rows are classifier-returned and ~11 to 17 are route-own.

**Test files that parse the roster declarations as source text (the blast radius):** `src/lib/wizardErrors.invariant.test.ts` (`deriveRoster(source, name)` anchors on `const KNOWN_*` then `(\s*\[`), `src/lib/wizardErrors.roster-render.test.tsx` (`SURFACES` with `rosterFile`/`rosterName` and floors 28 and 23), `src/lib/seam-wire-vocabulary.invariant.test.ts` (names both rosters at ~388), `src/lib/seam-ratelimit-posture.invariant.test.ts` (~589, 605), `src/lib/seam-transport-attribution.invariant.test.ts`. A spread-of-derived-arrays declaration makes `deriveRoster` return `[]`: the vacuity floors (`> 10`, `28`, `23`) turn red by name, but the membership assertions would pass over an empty roster if a floor were missed. Re-point every reader at live exports in the same commit.

**Recommended design (R1, per route, never merged):** new `src/lib/wizardKeyRosters.ts` exporting two sets built from three named, typed sources: (1) `CLASSIFIER_RETURNED_CODES` computed at module load from `[...VENUE_WIRE_CODE_TO_VERDICT.values()].map(v => v.code)` plus an exported `KEY_CLASSIFIER_CASCADE_CODES` tuple that `classifyKeyValidationError`'s cascade returns by reference (so the cascade literals are no longer a second list), minus `SEAM_CODE_TO_WIZARD_CODE` keys; (2) `CREATE_WITH_KEY_OWN_CODES` and `ADD_KEY_OWN_CODES`, each typed once, `as const satisfies readonly WizardErrorCode[]`, declared beside the route contract; (3) the translate-first exclusions handled once. `ConnectKeyStep` builds `KNOWN_CREATE_WITH_KEY_CODES` from (1)+(2 create), `MultiKeyConnectStep` builds `KNOWN_ADD_KEY_CODES` from (1)+(2 add). The invariant guard keeps its scanners and gains the equality that matters: each `*_OWN_CODES` tuple equals (route literal scan at the route's `statusRe`) union (the hand-typed 409/429 sets), both directions, so the tuple is the contract and the scan is its oracle. Precedent that a roster can be a `lib` export read by the guard: `KNOWN_VALIDATE_AND_ENCRYPT_CODES` is `export const ... ReadonlySet<WizardErrorCode>` in `wizardErrors.ts`. Do not edit the two route files (the guard's emitter regex requires `code:` first then `error:`; a `satisfies` or a wrapper breaks it silently).
**Risk:** refactoring the cascade's literal returns touches a ~3600-line module with heavy coverage; if the planner rejects that, the fallback is R2: keep the cascade literals, derive only (3) from the live Map and keep a hand-typed `KEY_CLASSIFIER_CASCADE_CODES` that the existing scan already checks for equality. R2 still removes the duplication across the two steps but leaves one typed list (see Open Questions 1).
**No-behaviour-change oracle:** the goal is no behaviour change, so pin each derived set member for member against today's roster as a frozen hand-typed literal list in the guard (one per roster, taken from the current declarations before editing; the 28/23 floors only catch shrinkage). It is the SC-5 analogue of SC-4's byte-equal pin.
**RED proof:** delete a row from `CREATE_WITH_KEY_OWN_CODES` or add a route literal not in it and `wizardErrors.invariant.test.ts` reds by name; delete `"SEAM_INTERNAL_FAULT"` from the cascade tuple and the `[153.7 review W-153.7-1]` describe reds. Also pin the two sets are not equal as a set and not one object (the merge the docblock forbids).

### Pattern 6: SC-7a (D-161-01, the `first_rule.upper()` family)

**What "the derived vocabulary" is:** `src/lib/seam-venue-vocabulary.invariant.test.ts`, a vitest that scans `analytics-service/**` Python for `error_code` literals and requires every one to have a row in `VENUE_WIRE_CODE_TO_VERDICT` or a reasoned row in `VENUE_WIRE_CODES_WITHOUT_VERDICT`. Its header names the family as a DECLARED BLIND SPOT (`error_code=first_rule.upper() if first_rule else "CSV_VALIDATION_FAILED"` in `services/ingestion/csv_adapter.py`), and a test `DECLARED BLIND SPOT — the dynamic emitter is SEEN, and yields no literal of its own` pins `dynamicishByFile` with `"analytics-service/services/ingestion/csv_adapter.py": 1`. The deferred-items text (`.planning/milestones/v1.20-phases/161-wizerr-honest-error-surfaces/deferred-items.md`, D-161-01) says the two remedies are "enumerating the rule family as literals at the adapter (so the scanner sees them) or giving the family one disposition — a vocabulary decision". [VERIFIED: files read this session]

**The rule family, measured.** `rule_name = str(row.get("check", "unknown"))` in `services/csv_validator.py` takes pandera's check name. The names come from four places:
- custom `pa.Check(..., error="...")`: `currency_usd_or_blank`, `daily_return_lower_bound`, `monotonic_dates`, `nav_non_zero`, `qty_price_positive` (introspected from `csv_validator.SCHEMAS` this session);
- pandera built-ins that are not literals in the source: `column_in_dataframe`, `not_nullable`, `coerce_dtype(...)`, `dtype(...)` (the last two carry an argument, e.g. `coerce_dtype('datetime64[ns]')`; `.upper()` of that is a code with parentheses; `csvRuleKey` in `wizardErrors.ts` strips it for labels, the wire code does not);
- bespoke `"rule": "<lit>"` dict literals in `csv_validator.py`: `daily_returns_constant`, `daily_sharpe_sentinel`, `daily_return_dollar_form_sentinel`, `auto_normalized_percent_form` (info flag), `date_format_normalized` (flag), `date_format_ambiguous`, `parse_error`, `empty`, `too_many_rows`;
- the existing TS `CSV_RULE_LABELS` keys (`wizardErrors.ts`): `monotonic_dates`, `nav_non_zero`, `daily_return_lower_bound`, `daily_sharpe_sentinel`, `daily_returns_constant`, `currency_usd_or_blank`, `qty_price_positive`, `column_in_dataframe`, `daily_return_dollar_form_sentinel`, `not_nullable`, `coerce_dtype`, `dtype`.
Only the first emitted rule becomes the `error_code` (`errors[0]`), upper-cased, so the code family = upper-cased rule names (including the info-flag rules only if they can be first; they are not errors, so exclude `auto_normalized_percent_form`, `date_format_normalized`).

**Design.** In the vitest, add a scanner over `analytics-service/services/csv_validator.py` (comment-stripped via the existing `stripCommentsPreserveLines`) collecting `"rule": "<lit>"` and `error="<lit>"` literals, upper-case them as `csv_adapter` does, union a small hand-typed pandera-built-in list, and require each member to have either a `CSV_RULE_LABELS` key (case-folded, argument stripped) or a reasoned family exemption (>80 chars, no "todo", the same discipline `VENUE_WIRE_CODES_WITHOUT_VERDICT` already enforces). Add the SAME enumeration as a pytest oracle for independence (`tests/test_csv_rule_family_*`: `SCHEMAS` check names plus an `ast` scan of the `"rule"` literals, compared with a hand-typed expected set), because the pandera built-ins are only knowable by execution; the existing census uses the same two-independent-derivations pattern (`test_raw_5xx_census` vs `seam-venue-vocabulary`'s `EXPECTED_EMITTED_CODES` note). Keep the blind-spot pin (csv_adapter count 1) and add an assertion that the enumerated family is non-empty (vacuity floor, >= the measured count).
**Join or sibling (undecided, read first):** the family should be a SIBLING set (`CSV_RULE_CODE_FAMILY`) rather than join `derived`: `derived`/`EXPECTED_EMITTED_CODES` is a population of literal `error_code` sites, and joining it would move `EXPECTED_EMITTED_CODES`, its floor and the exemption table. This research did not read the scanner's predicate (roughly lines 140-740 of that test), so this is [ASSUMED]; the plan's first task reads it and decides.
**RED proof:** add a `"rule": "brand_new_rule"` literal to `csv_validator.py` (byte backup) and watch the new test red naming it; remove a `CSV_RULE_LABELS` key and watch it red.

### Pattern 7: SC-7b (`_scope_rejected`, Option A, pin only)

**The gate** is in `routers/process_key.py::process_key` (`_scope_rejected = ( not val.valid or val.read_only is False or val.error_code in {"TRADE_SCOPE", "WITHDRAW_SCOPE"} )`). Branches: `val.error_code is not None and val.error_code not in exchange_svc.PERMANENT_VALIDATION_ERROR_CODES` -> 424 `_envelope_error(..., recoverable=True)`; else 403 with the default `recoverable` (False). `PERMANENT_VALIDATION_ERROR_CODES = frozenset({"AUTH_FAILED","PERMISSION_DENIED","TRADE_SCOPE","WITHDRAW_SCOPE","MISSING_SCOPE"})`. [VERIFIED: process_key.py 1983-2110, exchange.py 1165-1173]

**Existing pins per arm (`tests/test_process_key.py`):**
- permanent five -> 403, `recoverable is False`: `test_process_key_sync_caller_fault_stays_403_terminal` (parametrized AUTH_FAILED, PERMISSION_DENIED, TRADE_SCOPE, WITHDRAW_SCOPE, MISSING_SCOPE).
- our `VALIDATION_UNEXPECTED` fallback -> 403: `test_process_key_sync_our_own_validation_unexpected_fallback_stays_403`.
- the five venue-transient codes -> 424 `recoverable True`: `test_process_key_sync_venue_transient_answers_424_recoverable`.
- **The CSV family arm is not pinned, and one test is loose:** `test_sync_pipeline_rejection_also_forwards_the_breakdown` asserts `r.status_code in (403, 424)` (about line 4911) for a `monotonic_dates` rejection. This is exactly the per-arm pin the founder decision asks for and the loose assert is the hole.

**The per-arm pin.** A parametrized test over the CSV family (at least `MONOTONIC_DATES`, `COLUMN_IN_DATAFRAME`, `PARSE_ERROR`, `CSV_VALIDATION_FAILED`, `DAILY_RETURN_LOWER_BOUND`, `COERCE_DTYPE('DATETIME64[NS]')`) asserting status **424** and `recoverable is True`, with a comment naming the follow-up (a malformed CSV should not be told a retry can succeed) and the booked follow-up phase placeholder. Tighten the `in (403, 424)` assert to `== 424`. Optionally pin the sibling arm that answers differently: `_run_validate_only` returns the envelope with HTTP **200** and `ok:false` for `not val.valid` (`process_key.validate_only_failed`); say so in a comment so the follow-up phase does not rediscover it. No behaviour changes anywhere in this plan. [VERIFIED: process_key.py 1105-1125]

**RED proof:** flip the 424 arm's condition (swap `not in` for `in`) with a byte backup and watch the new parametrized test and the existing venue-transient test go red; restore.

### Pattern 8: SC-7c (anonymous teaser bucket saturation alert)

**Where the refusal happens.** `/process-key` is decorated with two stacked limits; per-identity key function `_process_key_rate_limit_key` -> `tenant_rate_limit_key(request, "process_key")` returns `process_key:anon` for a valid claim with payload `ANON_PAYLOAD = "public"`, and `_process_key_limit_for(key)` returns `_PROCESS_KEY_ANON_LIMIT = "30/hour"` for that key. A refusal is a `RateLimitExceeded` raised by slowapi `__evaluate_limits`, rendered by the app-global `rate_limit_exceeded_handler`. [VERIFIED: process_key.py 85-150, rate_limit.py 149/336, main.py handler; slowapi `__evaluate_limits` read from the installed package]

**Detection.** On a failed limit slowapi sets `request.state.view_rate_limit = (lim.limit, [limit_key, limit_scope])` (no `key_prefix` is configured: `limiter = Limiter(key_func=default_platform_key)`), so inside the handler the refusing bucket's key is `request.state.view_rate_limit[1][0]`. The refusal is the anon shared bucket iff that key equals `"process_key:anon"`. The platform ceiling refusal has a different key and must not alert. Define the key once (a `anon_bucket_key(scope)` helper in `services/rate_limit.py` returning `f"{scope}:anon"`, used by `tenant_rate_limit_key`, `_process_key_limit_for` and the alert) instead of a third literal. Never call `exc.limit.key_func(request)` to recompute (it logs `tenant_claim_unverified` warnings again).

**Idiom and de-dup.** Clone `main._capture_secret_misconfig` (new scope, tags, `capture_message`, module-level `{key: monotonic}` dict, whole emit in `try/except: pass`) or `routers/internal._alert_kek_unavailable` (log every occurrence, capture at most once per window). Window = the limit's own expiry (`throttle.limit.limit.get_expiry()` = 3600 s for `30/hour`) so a retune of `_PROCESS_KEY_ANON_LIMIT` keeps the dedupe in step, falling back to 3600. Set `scope.fingerprint = ["anon-bucket-saturated", "process_key"]` (the repo's fingerprint precedent: `services/ops_alert.py` sets `scope.fingerprint`), tags `anon_bucket_saturated=process_key` and `limit=30/hour`; the message carries no IP, header or claim (the bucket is anonymous by construction). Per-process dedupe means at most one event per replica per window; state that in the docstring.

**Where it hooks.** Inside the extracted `rate_limit_exceeded_handler` (the same module as SC-3), after computing the response, so it does not change the 429 body or status. It is observability only: the limit value and the response are byte-identical.

**How tests capture Sentry.** `tests/test_secret_misconfig_signal.py` defines `_FakeSentry` (records `new_scope`, `set_tag`, `capture_message`) and a `sentry_spy` fixture that monkeypatches the module's `sentry_sdk` attribute and clears the module throttle dict both ways; copy it. Drive the real anon refusal with the existing harness in `tests/test_process_key.py` (`_mint_claim("public")`, `throttled_client`, `test_anon_bucket_exhausts_at_30_without_touching_a_tenant`), shrinking the window via `monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_LIMIT", "2/hour")` rather than looping 31 times.
**Assertions (all literals, independent of the code):** first refusal -> exactly 1 capture with the anon tag; second and third refusals inside the window -> still 1; a tenant bucket refusal (`process_key:t:...`) -> 0; the ceiling refusal -> 0; after the window (advance the patched `time.monotonic`) -> 2; a raising `capture_message` -> the 429 is still returned.
**RED proof:** remove the hook or the dedupe and the count assertions fail.
**Note:** a Sentry event is not a notification. Routing the event to a human needs a Sentry issue-alert rule (outside the repo, like the live rule "Ops alert: outage (164.6.8)"); record that as a follow-up for the founder in SUMMARY rather than claiming the alert reaches anyone from code alone.

### Pattern 9: SC-6 (binance cassettes)

`analytics-service/tests/cassettes/` holds only `okx/` and `bybit/` (4 yaml files each). `tests/test_repro_key_flow.py` parametrizes `["okx", "binance", "bybit"]` on four tests and each calls `_skip_if_no_cassette`, so the four binance cases skip with `cassette not yet recorded: binance/<scenario>.yaml (founder gate 16-08 Task 3)`. The module's own comment explains the cause: CI runners sit in GitHub Actions IP ranges that Binance (451) and Bybit (403) block, so recording is impossible from CI. The `cassette-refresh.yml` workflow records okx and bybit only. No test or TS census counts cassettes (`observ12-fixtures-presence.test.ts` guards two other fixtures). [VERIFIED: files read, grep]

**Shape (retire):** one `_REPLAY_BROKERS = ["okx", "bybit"]` constant replacing the four literal lists, with a dated comment recording the reason; delete the `binance` entry of `TEST_CREDS`; fix the docstring "Test count: 12 (3 brokers x 4 scenarios)" to 8. Optionally (beyond the locked decision, planner's call) convert `_skip_if_no_cassette` from `pytest.skip` to a hard failure; `cassette-refresh.yml` does not run this test module (no `pytest` or `test_repro` in the workflow), so the conversion cannot red that workflow. The reason for it: both retained brokers have all four cassettes today and a silently skipped missing cassette is the defect class this phase removes. Leave `scripts/record_cassettes.py` (its `binance` branch is operational tooling, out of scope). **RED proof:** delete `tests/cassettes/okx/happy.yaml` (byte backup) and the test must fail, not skip; plus a pin that every broker in `_REPLAY_BROKERS` has all four files.

### Anti-Patterns to Avoid
- **Exporting the lane DSN as `TEST_SUPABASE_DB_URL`** in ci.yml: red by a pinned tripwire and leaks a shared-TEST name.
- **A skip that CI can hit silently** after SC-2: under `CI=true` a missing lane DSN must fail.
- **Importing `main` from the test factory or a plugin**: changes router module identity and adds import side effects.
- **Verifying SC-3 by running the 21 modules in one pytest call**: 20 baseline failures (state pollution), not regressions.
- **Giving the domain exception `.status_code`/`.detail`**: re-imports the HTTP vocabulary.
- **Merging the two rosters** (`ConnectKeyStep` docblock, `ROSTER-DERIVE-01` warning) or editing the two route files (the guard's emitter regex).
- **Raising the `[ASSUMED]`-green lane claim to fact** without booting the lane.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Lane DSN safety checks | a new loopback/identity check | extract `_require_loopback_dsn`, `_server_addr_is_lane`, `_require_stock_database_comment` from `test_compute_job_metadata_merge_live.py` into `tests/live_db_dsn.py` | Already measured on a booted lane; one definition for every writing module |
| Sentry capture test double | a new fake | `_FakeSentry` + `sentry_spy` idiom in `tests/test_secret_misconfig_signal.py` | Same call shape (`new_scope`, `set_tag`, `capture_message`) |
| Per-window capture de-dup | a new scheduler | the module-dict + `time.monotonic` idiom in `main._capture_secret_misconfig` / `routers.internal._alert_kek_unavailable` | Established, tested |
| Python AST census of constructors | a grep | the `scan_source` / `ast` pattern in `tests/test_raw_5xx_census.py` | Comments and strings do not fool it; has a vacuity floor |
| Source scanning in vitest | a regex over raw text | `stripCommentsPreserveLines` (`src/lib/source-scan`) | Every guard in `src/lib` strips comments first |
| 422 body shape | re-spelling it in the factory | `install_app_exception_handlers` | The whole point of SC-3 is one source |
| Anon bucket key literal | a third `"process_key:anon"` | one `anon_bucket_key(scope)` | Three copies is how drift starts |

**Key insight:** every guard in this repo is born blind if its population is derived by a mechanism that can return `[]`; every new derivation here needs a hand-typed vacuity floor and a RED proof.

## Runtime State Inventory

Not a rename/refactor/migration phase. State explicitly: stored data - none (no migration, SC-8); live service config - none (the Sentry alert RULE for SC-7c is outside the repo and is a recorded follow-up); OS-registered state - none; secrets/env vars - `LANE_DB_URL` is already exported by the `python` job, nothing new is added and `TEST_SUPABASE_DB_URL` must stay unexported; build artifacts - none.

## Common Pitfalls

### Pitfall 1: The `except HTTPException: raise` arm
**What goes wrong:** the new domain exception raised for the 400 inside the `try` falls into `except Exception` and is re-raised as the 500 "CSV analytics computation failed" (classified `unknown`, retried forever for a fault that can never clear).
**How to avoid:** replace the arm with `except WorkerJobFailure: raise` in the same commit; the existing 400 test (`test_csv_analytics_runner.py` ~224) catches it once re-pointed.
**Warning signs:** a job for a short CSV shows `failed_retry` with the text `500: CSV analytics computation failed`.

### Pitfall 2: Silent un-grouping from xdist
**What goes wrong:** after SC-2 the 7 modules no longer contain `TEST_SUPABASE_DB_URL`, drop out of `shared_test_db`, run concurrently with the fencing tests on the one lane database.
**How to avoid:** add `"live_db_dsn"` to `_DB_MODULE_SENTINELS`; pin it.

### Pitfall 3: A skip that survives
**What goes wrong:** the resolver returns `None` in CI (handoff step failed to export) and the module skips again, which is today's defect with a nicer name.
**How to avoid:** `pytest.fail` under `CI=true`; add a CI-time vacuity pin (the helper's self-test with `CI=true` and no DSN must fail).

### Pitfall 4: Roster declaration shape (SC-5)
**What goes wrong:** `deriveRoster` finds no `([` after `const KNOWN_...`, returns `[]`, and any assertion of the form "missing set is empty" passes.
**How to avoid:** re-point every reader at the live export in the same commit; keep the `> 10` / 28 / 23 floors.

### Pitfall 5: Counting from the TODOS or from memory
**What goes wrong:** "31 skips", "nine modules", "12 sites" are all stale (measured: 21 DSN cases, 21 modules/36 sites, 12 sites -> 11 after SC-4).
**How to avoid:** every count in a plan or pin is a number measured by the command in this document.

### Pitfall 6: Local/CI environment skew
**What goes wrong:** local Python 3.14, no xdist, Supabase CLI 2.84.2 vs CI 3.12, xdist, CLI 2.98.2. The local full run fails 1 test for the missing xdist, and the Postgres image pin lives in `scripts/local-stack/run.sh` (`LANE_PG_VERSION`), not in the CLI version, so a local lane should match CI's image.
**How to avoid:** use `make install` (`.venv` on 3.12) for a CI-faithful run, or accept the single known xdist failure.

### Pitfall 7: Editing the shared files in parallel plans
**What goes wrong:** SC-2 and SC-3 both edit `tests/conftest.py`; SC-3 and SC-4 both edit `tests/test_raw_5xx_census.py`; SC-3, SC-7b and SC-7c all touch `tests/test_process_key.py` or the new handlers module.
**How to avoid:** serialize by file (see "Suggested plan split" below).

## Code Examples

### Equivalence oracle for SC-4 (shape)
```python
# Source: derived from the measured tuples above; the HTTPException arm is kept, so the old value is computable in-test
@pytest.mark.parametrize("make_new, status, detail, cause", FOUR_SITES)
def test_classify_matches_the_pre_215_http_exception(make_new, status, detail, cause):
    old = HTTPException(status_code=status, detail=detail)
    new = make_new()
    if cause is not None:
        old.__cause__ = cause
        new.__cause__ = cause
    assert classify_exception(new) == classify_exception(old)

def test_the_four_literals():
    assert classify_exception(CsvStrategyNotFound()) == ("unknown", "404: Strategy not found")
    # permanent / "400: Insufficient CSV history"; permanent / "422: Malformed returns_denominator_config (cause: ...)"; unknown / "500: CSV analytics computation failed"
```

### Anon saturation detection (shape)
```python
# Source: slowapi Limiter.__evaluate_limits (installed package) sets request.state.view_rate_limit = (limit, [key, scope])
def _refusing_bucket_key(request: Request) -> str | None:
    try:
        return str(request.state.view_rate_limit[1][0])
    except Exception:
        return None
```

### Factory (shape)
```python
# tests/app_factory.py
def build_test_app(*routers: APIRouter, middleware: Sequence[Any] = ()) -> FastAPI:
    app = FastAPI()
    install_app_exception_handlers(app)   # the SAME function main.py calls
    for m in middleware:
        app.add_middleware(m)
    for r in routers:
        app.include_router(r)
    return app
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Live-DB pytest on shared TEST behind a mutex | private local-stack lane per runner | Phase 164.9.4 (2026-09-26) | `python` job holds no key; SC-2 wires the remaining psycopg modules onto it |
| Gate by env var that no CI sets (`HAS_PY_ENV`) | gate removed, test runs | this phase | the money-math parity oracle becomes real |

**Deprecated/outdated:** the TODOS claim "403-vs-422 premise: a malformed CSV answers 403" (stale since PYAPIFIX-02); the `python` job comment "keeps 20+ psycopg modules skipped" (the point of SC-2).

## Suggested plan split (for the planner)

| Plan | SC | Files | Parallel? |
|------|----|-------|-----------|
| A | SC-1, SC-6 | `test_outcomes_kpi_parity.py`, `test_repro_key_flow.py` | yes |
| B | SC-2 | `tests/live_db_dsn.py`, 7 live modules, `conftest.py` (sentinel), `critical-regressions.test.ts` message | conftest overlap with C |
| C | SC-3 + SC-7c | `services/app_error_handlers.py`, `main.py`, `tests/app_factory.py`, 21 modules, `test_limiter_identity.py`, `test_raw_5xx_census.py` (non-literal triple), alert + tests | after B or merge conftest by hand |
| D | SC-4 | `services/job_failure.py`, `job_worker.py`, `analytics_runner.py`, ~8 test modules, `test_raw_5xx_census.py` (QUARANTINE) | census overlap with C: serialize C -> D or have one executor edit the census once |
| E | SC-5 | `wizardKeyRosters.ts`, two steps, `wizardErrors.ts`, 5 TS test files | yes (independent, TS) |
| F | SC-7a, SC-7b | `seam-venue-vocabulary.invariant.test.ts`, new pytest oracle, `test_process_key.py` | `test_process_key.py` overlap with C: pin goes in a NEW file to avoid it |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The 24 live-DB cases (21 DSN + 3 sibling) pass on the lane (schema = baseline + replayed migrations, empty data, superuser DSN) | SC-2 | Some need a roster entry with a reason or a per-test fix; found only when the lane is booted |
| A2 | Which lane-gated cases actually run in CI is unknown: 60 are lane-gated locally but CI skips only 33 fewer than local (68 vs 101) | SC-2 | 27 lane-gated cases may still skip in CI for a reason not found here; the exact CI skip list is unobserved, so the plan must measure it (lane boot or throwaway `-rs` run), not assume |
| A3 | An `install_app_exception_handlers` in a `services/` module behaves like the `main`-sourced handlers used in the trial | SC-3 | The trial imported the handlers from `main`; a moved copy could differ only by import cycles (none expected: `services.rate_limit`, `services.logging_config` are leaves) |
| A4 | Moving `venue_transient_exception_handler` out of `main.py` only needs the census triple renamed | SC-3 | Other tests may read `main.py` source for the handler; grep found only `test_raw_5xx_census.py` and the direct `main.venue_transient_exception_handler` calls (kept via re-export) |
| A5 | Cascade literals can be replaced by an exported tuple without changing `classifyKeyValidationError` behaviour | SC-5 R1 | Heavy coverage should catch a slip; fallback R2 avoids it |
| A6 | `request.state.view_rate_limit[1][0]` is the refusing key under slowapi 0.1.10 as in the installed copy | SC-7c | Pin with a live-request test (same reason the repo pins both stacked limits live) |
| A7 | Per-process dedupe (one event per replica per window) satisfies "at most one event per limit window" | SC-7c | If the founder wants one across replicas, it needs storage (out of scope) |
| A8 | A Sentry alert rule for the new event is created outside this repo | SC-7c | Without a rule the capture is visible but pages nobody |

## Open Questions (RESOLVED)

All eight are resolved by the plans or the orchestrator resolutions; each item carries its disposition inline.

1. **SC-5 derivation depth (R1 vs R2).**
   - What we know: ~20 of ~31 rows are classifier-returned and already derived by the guard; route-own rows are typed once per roster; routes cannot be edited without breaking the guard's emitter regex.
   - What's unclear: whether the planner accepts refactoring the cascade's literal returns into an exported tuple (R1) or keeps them literal (R2).
   - Recommendation: R1 with a RED proof per row; fall back to R2 only if the cascade refactor touches more than its `return` literals.
   - **RESOLVED (215-07, orchestrator resolution 1):** R1 for the Map-derived codes and the per-route own codes in `src/lib/wizardKeyRosters.ts`; the classifier cascade stays literal and its codes are typed once and pinned both directions against the scanned cascade (R2 for that one source).
2. **Which lane-resident cases cannot run (SC-2 roster).** Needs one local lane boot or a throwaway CI `-rs` run in plan task 1; recommended: boot locally (docker present, `scripts/local-stack/run.sh up`, then `export` from `scripts/local-stack/.stack-env`), record the per-case outcome, and list failures with reasons.
   - **RESOLVED (215-02, orchestrator resolution 2):** the CI `python` job on the PR head SHA is the measurement; the hand-typed `CANNOT_RUN_ON_LANE` roster in `tests/test_live_db_reach_roster.py` lists the known cannot-run cases, and any migrated case red on the lane is fixed or added to the roster before merge. A local lane boot is optional evidence.
3. **Scope of "the worker raises HTTPException" (SC-4).** `routers/portfolio.py::_compute_portfolio_analytics` (reached by `run_compute_portfolio_job`) and `routers/match.py` helpers (reached by the rescore handler) also raise `HTTPException` in the worker path. CONTEXT and the TODOS scope SC-4 to the four `run_csv_strategy_analytics` sites; recommendation: keep that scope, keep the HTTPException arm, and record the other two as a surfaced deviation in SUMMARY (they share a body with a route, so a domain exception there is a different design).
   - **RESOLVED (215-06, orchestrator resolution 5):** the four runner sites only; the HTTPException arm stays; the portfolio and match raisers are named in SUMMARY as surfaced, not changed.
4. **`test_correlation_middleware.py` (SC-3).** Move it onto the factory with `middleware=[CorrelationMiddleware]` (zero deviation, recommended), or leave it bare and record the deviation.
   - **RESOLVED (215-03, orchestrator resolution 3):** it moves onto the factory with `build_test_app(middleware=[CorrelationMiddleware])`; a test proven to need a bare app is a SUMMARY deviation, never a silent exemption.
5. **`_run_validate_only` returns HTTP 200 for a rejection** (the validate-only arm of `/process-key`). Out of the founder's stated scope (the `_scope_rejected` gate); recommendation: pin it in the same new test file with a comment, change nothing.
   - **RESOLVED (215-08):** pinned as one case in `tests/test_process_key_scope_rejection_statuses.py` with an out-of-scope comment; no behaviour change.
6. **Sentry rule for SC-7c** (A8): founder follow-up.
   - **RESOLVED (215-05, orchestrator resolution 6):** no repo work; 215-05's SUMMARY records the founder follow-up to create a Sentry issue-alert rule for fingerprint `anon-bucket-saturated`.
7. **27 lane-gated cases appear not to run in CI** (60 lane-gated locally, CI skips only 33 fewer than local). Out of scope for SC-1..SC-9; surface it, do not chase it here.
   - **RESOLVED (orchestrator resolution 4):** out of scope; 215-02's SUMMARY names it, no plan works on it.
8. **The lane was not booted in this research** (docker present, not started): whether the 24 SC-2 cases are green on the lane is [ASSUMED] (A1).
   - **RESOLVED (215-02, orchestrator resolution 2):** measured by the CI `python` job on the PR head SHA (0 failed, skip count below the 68 baseline); a red case is fixed or rostered before merge.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python | pytest | yes | 3.14.3 local (CI 3.12) | `make install` creates `.venv` on 3.12 |
| pytest-xdist | `-n auto --dist loadgroup`, `test_xdist_group_is_real.py` | no (local) | CI installs from `requirements-dev.txt` | run serial locally; expect that one test to fail |
| mypy | strict gate | yes | 2.0.0 (passes, 139 files) | `--cache-dir` outside the repo |
| Node 22 | vitest, tsc | yes | v22.22.1 at `/opt/homebrew/opt/node@22/bin` | none |
| `node_modules` | vitest, tsc, eslint | **no** in this worktree | present in the other checkout (715 entries) | `npm ci` in the worktree, or a symlink to the other checkout's `node_modules` (executor decision) |
| Docker | local lane boot | yes (client 29.9.2) | not started here | CI boots the lane; one throwaway CI run |
| Supabase CLI | local lane | yes | 2.84.2 (CI pins 2.98.2) | CI image pin handles the Postgres image |
| psql | lane baseline load | yes | `/opt/homebrew/bin/psql` | none |
| gh | CI evidence | yes | authenticated | none |

**Missing dependencies with no fallback:** none. **With fallback:** xdist locally, `node_modules` in the worktree.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9 (+ pytest-xdist in CI), vitest (Node 22), mypy strict |
| Config file | `analytics-service/pytest.ini` (`testpaths = tests`, `asyncio_mode = auto`), `vitest.config.ts`, `analytics-service/pyproject.toml` `[tool.mypy]` |
| Quick run command | per module from `analytics-service/`: `PYTHONDONTWRITEBYTECODE=1 python3 -m pytest -p no:cacheprovider -q tests/<file>.py` |
| Full suite command | from `analytics-service/`: `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (CI literal; locally serial without `-n`) |
| Type gate | from `analytics-service/`: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |
| TS tests | from repo root: `PATH=/opt/homebrew/opt/node@22/bin:$PATH npx vitest run <files>`; full: `PATH=/opt/homebrew/opt/node@22/bin:$PATH npm test`; types `npm run typecheck`; lint `npm run lint` |

⛔ **Never run the 21 FastAPI modules together as a "SC-3 verification"** (20 baseline failures from shared limiter state). Per module, or the full suite.

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-1 | parity cases run (0 skips) | unit | `python3 -m pytest -q tests/test_outcomes_kpi_parity.py` (expect `5 passed`) | yes (edit) |
| SC-1 RED | perturb fixture value, expect red, restore from byte backup | manual neuter | same command | n/a |
| SC-2 | 7 modules resolve the lane DSN; CI + no DSN fails | unit + CI | helper self-test `tests/test_live_db_dsn.py`; lane run needs `LANE_DB_URL` etc. | Wave 0 |
| SC-2 pin | `live_db_dsn` is an xdist sentinel; python job exports `LANE_DB_URL`, not `TEST_SUPABASE_DB_URL` | unit + vitest | `tests/test_xdist_group_is_real.py` (CI only, needs xdist); `npx vitest run src/__tests__/critical-regressions.test.ts` | Wave 0 / yes |
| SC-3 | factory app == main app handlers; canary 422; production 429; no bare `FastAPI(` | unit | `python3 -m pytest -q tests/test_app_factory_parity.py` | Wave 0 |
| SC-3 census | non-literal triple renamed | unit | `python3 -m pytest -q tests/test_raw_5xx_census.py` | yes (edit) |
| SC-4 | byte-equal classification, four literals; 400 stays permanent | unit | `python3 -m pytest -q tests/test_job_worker.py -k classify tests/test_csv_analytics_runner.py tests/test_job_failure.py` | Wave 0 (new) |
| SC-4 census | QUARANTINE -1 site, counts 11 / 8 | unit | `python3 -m pytest -q tests/test_raw_5xx_census.py` | yes (edit) |
| SC-5 | each `*_OWN_CODES` equals route scan; rosters not merged; guard not blind | vitest | `npx vitest run src/lib/wizardErrors.invariant.test.ts src/lib/wizardErrors.roster-render.test.tsx src/lib/seam-wire-vocabulary.invariant.test.ts src/lib/seam-ratelimit-posture.invariant.test.ts src/lib/seam-transport-attribution.invariant.test.ts "src/app/(dashboard)/strategies/new/wizard/steps/ConnectKeyStep.test.tsx" "src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx"` | yes (edit) |
| SC-6 | 8 replay cases, 0 skips; missing cassette fails | unit | `python3 -m pytest -q tests/test_repro_key_flow.py` (expect no skips) | yes (edit) |
| SC-7a | every CSV rule visible; new rule reds | vitest + pytest | `npx vitest run src/lib/seam-venue-vocabulary.invariant.test.ts`; `python3 -m pytest -q tests/test_csv_rule_family_oracle.py` | Wave 0 (pytest), yes (vitest edit) |
| SC-7b | per-arm status pin (CSV family -> 424 recoverable true; five permanent + fallback -> 403 false) | unit | `python3 -m pytest -q tests/test_process_key_scope_rejection_statuses.py` | Wave 0 (new file) |
| SC-7c | one capture per window; tenant and ceiling refusals silent | unit | `python3 -m pytest -q tests/test_anon_bucket_alert.py` | Wave 0 |
| SC-8 | no migration | shell | `git diff --stat origin/main -- supabase/migrations` prints nothing | n/a |
| SC-9 | each SC has a revert-RED proof | manual neuter | per row above, restore from byte backup (never `git checkout`) | n/a |

### Sampling Rate
- **Per task commit:** the single new/edited module's quick command, then `mypy` command above when a `services/`/`routers/`/`main.py` file changed.
- **Per wave merge:** full pytest from `analytics-service/` (expect 14909-ish passed in CI shape; locally the 1 known xdist failure) and the touched vitest files.
- **Phase gate:** full `python` job green on the head SHA (14909 passed baseline, skip count lower than 68 by the SC-1/SC-2/SC-6 amounts), `npm test` green, `npm run typecheck`, `npm run lint`, mypy green.

### Wave 0 Gaps
- [ ] `analytics-service/tests/live_db_dsn.py` + `tests/test_live_db_dsn.py` - SC-2
- [ ] `analytics-service/tests/app_factory.py` + `tests/test_app_factory_parity.py` - SC-3
- [ ] `analytics-service/services/job_failure.py` + `tests/test_job_failure.py` - SC-4
- [ ] `src/lib/wizardKeyRosters.ts` (or the chosen name) - SC-5
- [ ] `tests/test_csv_rule_family_oracle.py` - SC-7a
- [ ] `tests/test_process_key_scope_rejection_statuses.py`, `tests/test_anon_bucket_alert.py` - SC-7b/c
- [ ] A lane boot (local or throwaway CI `-rs`) to measure SC-2's real lane outcomes
- [ ] `node_modules` in the worktree for every vitest/tsc command

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (no auth code changes) | n/a |
| V3 Session Management | no | n/a |
| V4 Access Control | no | n/a |
| V5 Input Validation | yes (SC-3: the 422 handler is the credential-safe validation body) | the single production handler, never re-spelled; canary test (secret appears zero times in the response) |
| V6 Cryptography | no | n/a |
| V7 Error Handling / Logging | yes (SC-7c capture must carry no claim, IP or header) | tags and message are fixed strings; whole emit wrapped in `try/except` |
| V14 Configuration / Data protection | yes (SC-2 writes to a database) | loopback + stock-comment guard in code before any write; never `TEST_SUPABASE_DB_URL` in the process environment under CI |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Test writes land on shared TEST or PROD | Tampering | resolver refuses non-loopback and non-stock-comment DSNs; CI fails rather than falls back |
| Credential echoed in a 422 from a bare test app (false assurance) | Information disclosure | factory installs the production handler; canary RED proof |
| Alert leaks anonymous-caller identity | Information disclosure | no IP/header/claim in the Sentry message or tags |
| Alert floods Sentry on a saturated bucket | Denial of service | per-window dedupe, whole emit in `try/except` |

## Sources

### Primary (HIGH confidence)
- Repo files read this session at worktree `quantalyze-215` (HEAD 1f6db1273 on top of 3f29f1539): `analytics-service/main.py`, `tests/conftest.py`, `services/job_worker.py` (classify_exception), `services/analytics_runner.py` (raise sites), `routers/process_key.py`, `services/rate_limit.py`, `services/exchange.py` (PERMANENT codes), `services/ingestion/csv_adapter.py`, `services/csv_validator.py`, `tests/test_raw_5xx_census.py`, `tests/test_process_key.py`, `tests/test_limiter_identity.py`, `tests/test_secret_misconfig_signal.py`, `tests/test_compute_job_metadata_merge_live.py`, the 7 DSN-gated modules, `tests/test_repro_key_flow.py`, `.github/workflows/ci.yml` (`python` job), `src/__tests__/critical-regressions.test.ts`, `src/__tests__/local-stack-lane-wiring.test.ts`, `src/__tests__/contracts/ci-mypy-strict-surface.contract.test.ts`, `ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx`, `src/lib/wizardErrors.invariant.test.ts`, `src/lib/seam-venue-vocabulary.invariant.test.ts`, `wizardErrors.ts` (`CSV_RULE_LABELS`, `KNOWN_VALIDATE_AND_ENCRYPT_CODES`), the Phase 161 `deferred-items.md`.
- Executed this session: full pytest with `-rs` (101 skipped), the subset-pollution run (20 failures), the plugin trials (full suite identical to baseline; per-module always-on handlers), `classify_exception` on the four constructed `HTTPException`s, `csv_validator.SCHEMAS` introspection, mypy strict (green), `gh api` CI job log for run 43653840893 (`14909 passed, 68 skipped, 2 xpassed`).
- Installed `slowapi` source (`Limiter.__evaluate_limits`) for `view_rate_limit`.

### Secondary (MEDIUM confidence)
- none (no web sources were needed; every claim is in-repo or measured)

### Tertiary (LOW confidence)
- Assumptions A1-A8 above.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new is installed.
- Architecture: HIGH for SC-1/3/4/6/7b/7c (measured), MEDIUM for SC-2 (lane not booted) and SC-5 (design choice R1 vs R2).
- Pitfalls: HIGH, each was observed (a failing run) or read in source.

**Research date:** 2026-11-15
**Valid until:** 2026-11-22 (the repo moves daily; re-measure counts at the planning head before pinning any number)
