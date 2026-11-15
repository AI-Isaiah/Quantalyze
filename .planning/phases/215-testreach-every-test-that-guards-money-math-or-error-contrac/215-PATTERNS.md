# Phase 215: TESTREACH - Pattern Map

**Mapped:** 2026-11-15
**Files analyzed:** 17 new or modified file groups
**Analogs found:** 16 / 17 (one partial, noted)
**Citation rule:** by symbol, never by line number. Every analog path below was checked as git-tracked in the 215 worktree (`git ls-files`).
**Scope source:** CONTEXT.md decisions plus RESEARCH.md "Suggested plan split" (plans A-F). RESEARCH.md already holds measured counts and the RED proofs; this file only says what to copy from.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `analytics-service/tests/test_outcomes_kpi_parity.py` (modify: drop `pytestmark` skipif and fix docstring) | test | transform (cross-runtime oracle) | itself (one-line gate removal) | exact |
| `analytics-service/tests/test_repro_key_flow.py` (modify: `_REPLAY_BROKERS`, drop binance) | test | request-response (cassette replay) | its own `["okx", "bybit"]` parametrize near the end of the module | exact |
| `analytics-service/tests/live_db_dsn.py` (new) | test utility | request-response (DSN guard) | `tests/test_compute_job_metadata_merge_live.py` (`_require_loopback_dsn`, `_server_addr_is_lane`, `_require_stock_database_comment`, `_dsn`) | exact (extract) |
| `analytics-service/tests/conftest.py` (modify: `live_db_dsn` fixture, `_DB_MODULE_SENTINELS`) | test config | event-driven (collection hook) | its own `_DB_MODULE_SENTINELS` tuple | exact |
| 7 DSN-gated live modules (modify: `service_role_conn` fixture and skipif) | test | CRUD (lane DB) | `test_compute_job_metadata_merge_live.py::_dsn` | role-match |
| `analytics-service/services/app_error_handlers.py` (new) | service | request-response | `analytics-service/main.py` (`validation_exception_handler`, `rate_limit_exceeded_handler`, `venue_transient_exception_handler`, the three `add_exception_handler` calls) | exact (extract) |
| `analytics-service/main.py` (modify: import back and call installer) | config | request-response | itself | exact |
| `analytics-service/tests/app_factory.py` (new) + 21 modules moved onto it | test utility | request-response | `tests/test_benchmark_refresh.py` `client` fixture (bare `FastAPI()` plus `include_router`) | role-match |
| `analytics-service/tests/test_app_factory_parity.py` (new, includes AST regrowth scan) | test | transform (AST census) | `tests/test_raw_5xx_census.py` (`scan_source`, vacuity floors) | role-match |
| Anon-saturation alert inside `app_error_handlers.rate_limit_exceeded_handler` + test | service + test | event-driven (Sentry capture) | `main._capture_secret_misconfig` and `routers/internal._alert_kek_unavailable`; test double `tests/test_secret_misconfig_signal.py` (`_FakeSentry`, `sentry_spy`) | exact |
| `analytics-service/services/job_failure.py` (new) | model (domain exception) | event-driven (worker failure taxonomy) | `services/allocated_capital.py` `ReturnsDenominatorConfigError` plus the sink arms in `services/job_worker.py::classify_exception` | role-match |
| `services/job_worker.py::classify_exception`, `services/analytics_runner.py::run_csv_strategy_analytics` (modify) | service | event-driven | `classify_exception`'s `Mt5GatewayMisconfigured` / `BybitUnifiedFlowReadError` arms | exact |
| ~8 test modules re-pointed from `pytest.raises(HTTPException)`, `tests/test_raw_5xx_census.py` (`QUARANTINE`) | test | transform | themselves | exact |
| `src/lib/wizardKeyRosters.ts` (new) + `ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx` (modify) | utility | transform | `src/lib/wizardErrors.ts` `KNOWN_VALIDATE_AND_ENCRYPT_CODES` (a roster as an exported `ReadonlySet<WizardErrorCode>`) | exact |
| `src/lib/wizardErrors.invariant.test.ts` and the four sibling scanners (modify) | test | transform (source scan) | `deriveRoster(source, name)` in `wizardErrors.invariant.test.ts` | exact |
| `src/lib/seam-venue-vocabulary.invariant.test.ts` (modify) + new pytest oracle `analytics-service/tests/test_csv_rule_family_*.py` | test | transform (scan) | the `DECLARED BLIND SPOT` test in `seam-venue-vocabulary.invariant.test.ts`; `test_raw_5xx_census.py` for the Python-side oracle | exact |
| `_scope_rejected` per-arm pin, NEW file in `analytics-service/tests/` | test | request-response | `tests/test_process_key.py::test_process_key_sync_caller_fault_stays_403_terminal` | exact |
| `src/__tests__/critical-regressions.test.ts` (modify: dated CORRECTED note, positive `LANE_DB_URL` pin) | test | transform | the `python reads no shared-TEST secret ...` `it` in that file | exact |

## Pattern Assignments

### SC-1 `tests/test_outcomes_kpi_parity.py` (test, transform)

**Analog:** itself. Delete only the module-level gate and the docstring sentence "Running this test gated on HAS_PY_ENV=1". Drop the `os` import only if nothing else uses it (check before deleting).

**Code to delete:**
```python
pytestmark = pytest.mark.skipif(
    os.environ.get("HAS_PY_ENV") != "1",
    reason="Python parity test gated on HAS_PY_ENV=1 (Phase 5 D-21 / Voice-D2 option a)",
)
```

### SC-6 `tests/test_repro_key_flow.py` (test, request-response)

**Analog:** the last `@pytest.mark.parametrize("broker", ["okx", "bybit"])` in the same module is the target shape. Four tests use `["okx", "binance", "bybit"]` and call `_skip_if_no_cassette(broker, "<scenario>")`; replace the four literals with one `_REPLAY_BROKERS = ["okx", "bybit"]` carrying a dated retire-reason comment, and drop the `"binance"` entry of `TEST_CREDS`. Fix the docstring count (12 to 8). If the planner takes the optional hard-fail conversion, `_skip_if_no_cassette` becomes `pytest.fail`, and a pin asserts every `_REPLAY_BROKERS` broker has all four files under `tests/cassettes/<broker>/`.

---

### SC-2 `tests/live_db_dsn.py` (test utility, request-response)

**Analog:** `analytics-service/tests/test_compute_job_metadata_merge_live.py`. Move the three guards out and import them back so one definition guards every writing module.

**Constants and guard to copy** (symbols `_LOOPBACK_HOSTS`, `_LANE_DATABASE_COMMENT`, `_in_ci`, `_require_loopback_dsn`):
```python
_LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
_LANE_DATABASE_COMMENT = "default administrative connection database"

def _in_ci() -> bool:
    return os.getenv("CI", "").lower() == "true"

def _require_loopback_dsn(dsn: str | None) -> None:
    try:
        params = conninfo_to_dict(dsn or "")
    except psycopg.ProgrammingError:
        params = {}
    hosts = [h.strip() for h in str(params.get("host", "")).split(",")]
    addrs = [a.strip() for a in str(params.get("hostaddr", "")).split(",") if a.strip()]
    bad = [h for h in hosts if h not in _LOOPBACK_HOSTS] + [
        a for a in addrs if a not in _LOOPBACK_HOSTS
    ]
    if not params.get("host") or bad:
        pytest.fail("... refuses to write: LANE_DB_URL does not name only loopback hosts ...", pytrace=False)
```

**Identity query to copy** (`_require_stock_database_comment`; this is CLAUDE.md's marker query applied in code):
```python
comment = conn.execute(
    "SELECT shobj_description(oid, 'pg_database') FROM pg_database "
    "WHERE datname = current_database()"
).fetchone()[0]
if comment != _LANE_DATABASE_COMMENT:
    pytest.fail(..., pytrace=False)
```
Also copy `_server_addr_is_lane` (NULL, loopback or private address passes; public fails).

**CI-fails-never-skips pattern** (`_dsn` in the same module; reuse its shape for `resolve_live_db_dsn`):
```python
if not LANE_DB_URL:
    if _in_ci():
        pytest.fail("... LANE_DB_URL is unset in CI. The python job's 'Lane handoff' step exports it ...", pytrace=False)
    pytest.skip("LANE_DB_URL unset (local dev): export it from scripts/local-stack/.stack-env")
_require_loopback_dsn(LANE_DB_URL)
return LANE_DB_URL
```
Adapt: when `LANE_DB_URL` is unset and not in CI, `pytest.skip`; when in CI without it, `pytest.fail`. (CORRECTED 2026-11-15, plan-check revision: an earlier draft fell back to `TEST_SUPABASE_DB_URL` locally; that unguarded write path to shared TEST is dropped, and 215-02 Task 1 governs.) Never export `TEST_SUPABASE_DB_URL` from ci.yml.

**Census trap (copy the rule, not code):** `tests/test_live_db_transport.py` asserts the set of modules defining `def _need_supabase` equals the set containing the string `live_db_transport`. Do not wrap a persist-module client with `wrap_live_db_client` unless the module also defines `_need_supabase`.

### SC-2 `tests/conftest.py` (test config)

**Analog:** the existing tuple. Add `"live_db_dsn"` beside `"live_db_transport"`, which was added for the identical content-based-sentinel reason; without it the 7 modules leave the `shared_test_db` xdist group.
```python
_DB_MODULE_SENTINELS = (
    "SUPABASE_TEST_URL",
    "SUPABASE_TEST_SERVICE_KEY",
    "_need_supabase",
    "TEST_SUPABASE_DB_URL",
    "HAS_LIVE_DB",
    "live_db_transport",
    # + "live_db_dsn"
)
```
Pin it in `tests/test_xdist_group_is_real.py` or a sibling test.

---

### SC-3 `services/app_error_handlers.py` (service, request-response)

**Analog:** `analytics-service/main.py`. Move these definitions verbatim; `main.py` imports the names back (tests call `main.venue_transient_exception_handler` and `main._retry_after_seconds`) and calls the installer where the three `add_exception_handler` calls sit today.

**Symbols to move:** `_validation_detail`, `validation_exception_handler`, `_retry_after_seconds`, `rate_limit_exceeded_handler`, `venue_transient_exception_handler`, plus `_rate_limit_log`. The module must not import `main` (it changes router module identity).

**Handler signature convention to keep** (mypy strict, no suppression comments):
```python
async def rate_limit_exceeded_handler(request: Request, exc: Exception) -> Response:
    throttle = cast(RateLimitExceeded, exc)
    retry_after = _retry_after_seconds(request, throttle)
    ...
    return JSONResponse(status_code=429, content={"ok": False, "code": "RATE_LIMITED", ...,
                        "recoverable": True, "retry_after_seconds": retry_after},
                        headers={"Retry-After": str(retry_after)})
```
**Registration to centralise** (the three calls, in `main.py` today):
```python
app.add_exception_handler(RequestValidationError, validation_exception_handler)
app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
app.add_exception_handler(VenueTransientHTTPException, venue_transient_exception_handler)
```
New function: `install_app_exception_handlers(app: FastAPI) -> None` doing exactly those three. `_retry_after_seconds` reads `limiter.limiter.get_window_stats`, so it imports `limiter` from `services.rate_limit` (a leaf) rather than from `main`.

**Census edit forced by the move:** `tests/test_raw_5xx_census.py::test_the_three_known_non_literal_sites_are_the_contract_pass_throughs` hand-types `("main.py", "venue_transient_exception_handler", "JSONResponse")`; becomes `("app_error_handlers.py", ...)`. `EXPECTED_NON_LITERAL_STATUS_SITES` stays 3.

### SC-3 `tests/app_factory.py` (test utility) and the 21 moved modules

**Analog for the call-site shape being replaced:** `tests/test_benchmark_refresh.py` `client` fixture:
```python
@pytest.fixture
def client(table: _FakeTable) -> Iterator[TestClient]:
    app = FastAPI()
    app.include_router(cron_mod.router)
    yield TestClient(app, raise_server_exceptions=False)
```
Becomes `app = build_test_app(cron_mod.router)`. Factory shape (from RESEARCH.md; function, not only a fixture, because several sites live in helper functions like `_probe_app()` and `_simulator_app()`):
```python
def build_test_app(*routers: APIRouter, middleware: Sequence[Any] = ()) -> FastAPI:
    app = FastAPI()
    install_app_exception_handlers(app)   # the SAME function main.py calls
    for m in middleware:
        app.add_middleware(m)
    for r in routers:
        app.include_router(r)
    return app
```
**Do not import `main`** in the factory. **Per-site notes the executor must keep:** `tests/test_process_key.py::throttled_client` also sets `app.state.limiter = process_key_router.limiter` and registers slowapi's default 429 handler; after the move keep the `app.state.limiter` line and the `process_key_router.limiter.reset()` call, drop the slowapi-default handler registration (production handler replaces it, only status 429 is read). `tests/test_limiter_identity.py::_assert_not_the_in_handler_429` must be re-cut to the structural discriminator (in-handler quota: `body["detail"]` is a dict with `code`; production slowapi handler: top-level `code` with string `detail`). Verify per module or with the full suite, never the 21 modules together (20 baseline failures from shared limiter state).

### SC-3 `tests/test_app_factory_parity.py` (test, transform)

**Analog:** `tests/test_raw_5xx_census.py`. Copy the `ast`-scan idiom (`scan_source`, `CensusKey = tuple[str, str, int]`, hand-typed expected counts, a vacuity-floor test such as `assert len(found) > EXPECTED_SITE_COUNT`) for an AST scan of `analytics-service/tests/**/*.py` for `FastAPI(` constructor calls outside `app_factory.py`, with an empty (or one-entry, recorded) allowlist. Canary 422 test: copy the secret-appears-zero-times idiom from `tests/test_validation_error_contract.py`. Parity test: `build_test_app().exception_handlers` equals the three handler objects registered on `main.app` (importing `main` inside this one test is fine, it is only the factory that must not).

---

### SC-7c Anonymous saturation alert (service + test)

**Analog:** `main._capture_secret_misconfig` (module-dict plus `time.monotonic` de-dup, new scope, tags, whole emit in `try/except: pass`).
```python
throttle_key = f"{fault}:{secret_name}"
now = time.monotonic()
last = _secret_capture_last_at.get(throttle_key)
if last is not None and (now - last) < _SECRET_CAPTURE_MIN_INTERVAL_S:
    return
_secret_capture_last_at[throttle_key] = now
try:
    with sentry_sdk.new_scope() as scope:
        scope.set_tag("config_fault", fault)
        sentry_sdk.capture_message(f"Platform secret {secret_name} is {fault}", level="error")
except Exception:
    pass
```
Adapt: key the dict by the bucket key, window = `exc.limit.limit.get_expiry()` falling back to 3600, `scope.fingerprint = ["anon-bucket-saturated", "process_key"]`, tags `anon_bucket_saturated=process_key` and `limit=...`. Detect with `request.state.view_rate_limit[1][0] == "process_key:anon"` (wrap in try/except; never recompute via `key_func`). Call from inside `rate_limit_exceeded_handler` after the response is built, so the 429 is byte-identical. Add `anon_bucket_key(scope)` to `services/rate_limit.py` (used by `tenant_rate_limit_key`, `_process_key_limit_for` and the alert) instead of a third `"process_key:anon"` literal.

**Test double to copy:** `tests/test_secret_misconfig_signal.py` (`_FakeSentry` with `new_scope`/`capture_message`, and the `sentry_spy` fixture that monkeypatches the module's `sentry_sdk` and clears the throttle dict both ways; the spy fixture there patches `main`, retarget it at `services.app_error_handlers`). Drive the real refusal with the `throttled_client` harness and `_mint_claim("public")` in `tests/test_process_key.py`, shrinking via `monkeypatch.setattr(process_key_router, "_PROCESS_KEY_ANON_LIMIT", "2/hour")`. Assertions are all literals (first refusal 1 capture, repeat 1, tenant bucket 0, ceiling 0, after window 2, raising `capture_message` still returns 429).

---

### SC-4 `services/job_failure.py` (model, event-driven)

**Analog for the exception type:** `services/allocated_capital.py`:
```python
class ReturnsDenominatorConfigError(ValueError):
    """A ``returns_denominator_config`` is structurally malformed — permanent, never a transient condition..."""
```
Named domain exception, docstring states its disposition. New leaf (imports nothing from `job_worker`/`analytics_runner`): `WorkerJobFailure(Exception)` with `error_kind: Literal["transient","permanent","unknown"]` (the same alphabet as `job_worker.ErrorKind`) and `message: str` that keeps the legacy numeric prefix (e.g. `"404: Strategy not found"`), plus four named subclasses. No `.status_code`/`.detail` aliases.

**Analog for the classify arm:** `services/job_worker.py::classify_exception`'s sink arms, placed most-specific-first above the HTTPException arm:
```python
if isinstance(exc, BybitUnifiedFlowReadError):
    return ("permanent", str(exc)[:500])
```
and the cause-suffix idiom of the HTTPException arm it mirrors:
```python
detail_str = _format_http_detail(exc.detail)
cause = getattr(exc, "__cause__", None)
if cause is not None:
    detail_str = f"{detail_str} (cause: {repr(cause)[:180]})"
```
New arm: `if isinstance(exc, WorkerJobFailure): return (exc.error_kind, (exc.message + cause_suffix)[:500])`. Keep the HTTPException arm (other callers and `test_http_exception_*` cases).

**Trap in `services/analytics_runner.py::run_csv_strategy_analytics`:** the existing `except HTTPException:\n    raise` arm sits before `except PaginatedSelectTruncated` and the catch-all. Change it to `except WorkerJobFailure: raise`, or the 400 raised inside the `try` becomes the 500 "CSV analytics computation failed" classified `unknown`. The 422 site keeps `raise ... from cfg_exc`; the 500 site has no `from`.

**Census:** `tests/test_raw_5xx_census.py` `QUARANTINE` row `("analytics_runner.py", "run_csv_strategy_analytics", 500): 1` is deleted, `EXPECTED_SITE_COUNT` 12 to 11, `EXPECTED_TRIPLE_COUNT` 9 to 8, with a dated prose note. Serialize with the SC-3 edit of the same file.

**Equivalence pin:** see "Equivalence oracle for SC-4" in RESEARCH.md Code Examples (parametrized old-`HTTPException` vs new, plus four literal tuples as an independent oracle). Re-point the ~25 `pytest.raises(HTTPException)` assertions (modules listed in RESEARCH.md Pattern 4 trap 3) to `.error_kind` and `.message`.

---

### SC-5 `src/lib/wizardKeyRosters.ts` (utility, transform)

**Analog:** `src/lib/wizardErrors.ts::KNOWN_VALIDATE_AND_ENCRYPT_CODES`, a roster that is an exported typed set the guard reads:
```typescript
export const KNOWN_VALIDATE_AND_ENCRYPT_CODES: ReadonlySet<WizardErrorCode> =
  new Set<WizardErrorCode>([
    // the two request-shape families 161-09 split off KEY_INVALID_FORMAT
    "KEY_MISSING_REQUIRED_FIELD",
    ...
  ]);
```
Export two separate sets (never merged, never one object) built from `[...VENUE_WIRE_CODE_TO_VERDICT.values()].map(v => v.code)` minus `SEAM_CODE_TO_WIZARD_CODE` keys, plus the cascade tuple and the per-route own-code tuples. The two consumers keep their translate-then-membership shape:
```typescript
return translated !== "UNKNOWN"
  ? translated
  : data.code && KNOWN_CREATE_WITH_KEY_CODES.has(data.code as WizardErrorCode)
    ? (data.code as WizardErrorCode)
    : "UNKNOWN";
```
Today `ConnectKeyStep.tsx` declares `const KNOWN_CREATE_WITH_KEY_CODES: ReadonlySet<WizardErrorCode> = new Set<WizardErrorCode>([ ... ])` and `MultiKeyConnectStep.tsx` has the twin `KNOWN_ADD_KEY_CODES`. Do not edit the two route files (the guard's emitter regex needs `code:` then `error:`). Pin each derived set member for member against a frozen hand-typed literal list taken from the current declarations before editing. Update `ROSTER-DERIVE-01` citations in `ConnectKeyStep.tsx`, `MultiKeyConnectStep.tsx` and `wizardErrors.invariant.test.ts` when the TODOS entry is deleted.

### SC-5 `wizardErrors.invariant.test.ts` and the four sibling scanners (test, transform)

**Analog:** `deriveRoster` in `src/lib/wizardErrors.invariant.test.ts`:
```typescript
function deriveRoster(source: string, name: string): string[] {
  const start = source.indexOf(`const ${name}`);
  if (start < 0) return [];
  const tail = source.slice(start);
  const openMatch = /\(\s*\[/.exec(tail);
  if (openMatch === null) return [];
  ...
  return [...block.matchAll(/"([A-Z][A-Z0-9_]*)"/g)].map((m) => m[1]);
}
```
This returns `[]` the moment the declaration stops being a literal `([` array; re-point every reader (`wizardErrors.roster-render.test.tsx`, `seam-wire-vocabulary.invariant.test.ts`, `seam-ratelimit-posture.invariant.test.ts`, `seam-transport-attribution.invariant.test.ts`) at the live exports in the same commit and keep the `> 10` / 28 / 23 floors.

---

### SC-7a D-161-01 CSV rule family (test, transform)

**Analog (TS side):** the `DECLARED BLIND SPOT — the dynamic emitter is SEEN, and yields no literal of its own` `it` in `src/lib/seam-venue-vocabulary.invariant.test.ts`; keep it (`csv_adapter.py: 1`) and add a sibling family test. Source-scan idiom to follow: `import { stripCommentsPreserveLines } from "./source-scan";` with `"py"` mode, then scan `analytics-service/services/csv_validator.py` for `"rule": "<lit>"` and `error="<lit>"`, upper-case, union a hand-typed pandera-built-in list, require a `CSV_RULE_LABELS` key or a reasoned exemption (same >80 chars, no "todo" discipline `VENUE_WIRE_CODES_WITHOUT_VERDICT` enforces). Make it a sibling set `CSV_RULE_CODE_FAMILY`, not a member of `derived`; the plan's first task must read the scanner predicate first (RESEARCH.md marks this [ASSUMED]).

**Analog (Python oracle):** `tests/test_raw_5xx_census.py` pattern of an independent derivation with a hand-typed expected set (`csv_validator.SCHEMAS` check names plus an `ast` scan of the `"rule"` literals).

---

### SC-7b `_scope_rejected` per-arm pin, NEW test file (test, request-response)

**Analog:** `tests/test_process_key.py::test_process_key_sync_caller_fault_stays_403_terminal` (parametrized, adapter mocked):
```python
fake = _build_supabase_mock(existing_row=None, insert_id="ver-permanent")
permanent_adapter = MagicMock()
permanent_adapter.validate = AsyncMock(
    return_value=ValidationResult(valid=valid, read_only=False, error_code=error_code,
                                  human_message="...", debug_context={}))
with patch("routers.process_key.get_supabase", return_value=fake), \
     patch("routers.process_key.get_adapter", return_value=permanent_adapter):
    r = client.post("/process-key", json={"flow_type": "teaser", "source": "okx", ...},
                    headers=_auth_headers())
```
Put the new parametrized CSV-family pin (status 424, `recoverable is True`, comment naming the follow-up) in a NEW file to avoid overlapping SC-3's edits to `test_process_key.py`; reuse its helpers via import or a small local copy (`_build_supabase_mock`, `_auth_headers`). Tighten the loose `assert r.status_code in (403, 424), r.text` in `test_sync_pipeline_rejection_also_forwards_the_breakdown` to `== 424`. That is a one-line edit to `test_process_key.py`, so schedule it in the same plan as the SC-3 edits of that file or after it. Optional: pin `_run_validate_only`'s HTTP 200 plus `ok:false` for `not val.valid`, with a comment. Pin current behaviour only; do not edit `routers/process_key.py`.

---

### `src/__tests__/critical-regressions.test.ts` (test, transform)

**Analog:** the `it` named "python reads no shared-TEST secret and runs no TEST ordering wait (Phase 164.9.4 D-08)". Keep its regex (never export under `TEST_SUPABASE_DB_URL`, no `secrets.TEST_SUPABASE_*`); add a dated `CORRECTED` note to its message and a new positive assertion that the `python` job's lane handoff step exports `LANE_DB_URL`. The pytest command literal in `src/__tests__/local-stack-lane-wiring.test.ts` is byte-pinned; do not touch the step or add `-rs`.

## Shared Patterns

### Oracle discipline (all new Python tests)
**Source:** `tests/test_secret_misconfig_signal.py` module docstring ("every expected count, tag, status and key below is a LITERAL") and `tests/test_raw_5xx_census.py` (hand-typed counts, vacuity floors).
**Apply to:** every new pin in SC-3, SC-4, SC-7a/b/c. A derivation that can return `[]` needs a hand-typed floor and a RED proof (neuter, see RED, restore from a byte backup).

### Sentry capture, never fatal
**Source:** `main._capture_secret_misconfig`; `routers/internal._alert_kek_unavailable` (log every occurrence, capture at most once per window, `try/except: pass`).
**Apply to:** SC-7c only.

### Lane-only writes with identity check
**Source:** `tests/test_compute_job_metadata_merge_live.py` guards (loopback, private server address, stock `COMMENT ON DATABASE`).
**Apply to:** the 7 DSN-gated modules and anything else that writes in `tests/`. Under `CI=true` a missing DSN fails, never skips.

### mypy strict surface
**Source:** CI gate `mypy --strict services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`. New `services/*.py` files are covered automatically; `tests/` is untyped by design. No `# mypy:` or suppression comments in surface files.
**Apply to:** `services/app_error_handlers.py`, `services/job_failure.py`, `services/rate_limit.py`, `services/job_worker.py`, `services/analytics_runner.py`, `main.py`.

### Source-scan in vitest
**Source:** `stripCommentsPreserveLines` from `src/lib/source-scan.ts`.
**Apply to:** SC-5 and SC-7a scanners.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `services/job_failure.py` named subclasses carrying a persisted-text prefix | model | event-driven | No existing worker exception carries both `error_kind` and a persisted message prefix as attributes; `ReturnsDenominatorConfigError` is a plain `ValueError` and `classify_exception` derives kind from `isinstance`. Use RESEARCH.md Pattern 4 "Design" and its equivalence oracle. |

## Metadata

**Analog search scope:** `analytics-service/main.py`, `analytics-service/services/`, `analytics-service/routers/`, `analytics-service/tests/`, `src/lib/`, `src/app/(dashboard)/strategies/new/wizard/steps/`, `src/__tests__/`.
**Files read for excerpts:** `main.py` (two sections), `tests/test_compute_job_metadata_merge_live.py`, `tests/conftest.py`, `tests/test_secret_misconfig_signal.py`, `tests/test_raw_5xx_census.py`, `tests/test_process_key.py` (two sections), `tests/test_benchmark_refresh.py`, `services/job_worker.py` (`classify_exception`), `services/analytics_runner.py` (the `except HTTPException` arm), `services/allocated_capital.py`, `routers/internal.py`, `src/lib/wizardErrors.ts` (roster), `src/lib/wizardErrors.invariant.test.ts` (`deriveRoster`), `src/lib/seam-venue-vocabulary.invariant.test.ts` (blind-spot test), `ConnectKeyStep.tsx` (membership check).
**Tracked-source gate:** every analog path above is under tracked source directories; none is a `.gsd/capabilities` mirror.
**Pattern extraction date:** 2026-11-15
