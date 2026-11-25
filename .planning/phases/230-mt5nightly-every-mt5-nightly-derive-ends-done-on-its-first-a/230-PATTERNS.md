# Phase 230: MT5NIGHTLY - Pattern Map

**Mapped:** 2026-11-25
**Files analyzed:** 22 new or modified (plus 1 untracked hand-off artifact)
**Analogs found:** 21 / 22 (the capture script has only a recorded precedent, no tracked source)

All analog paths below were checked as git-tracked source in this worktree. No path under any gitignored capability mirror is named. Line numbers were read in this worktree at HEAD (main at `8507564ef` plus the phase's own planning files) and the plan-anchor-verify gate will re-resolve them, so re-measure a line number before pasting it into a plan if a rebase has happened.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `analytics-service/services/mt5_xlease.py` (new) | service (leaf) | request-response + background renew task | `analytics-service/main_worker.py` (`_renew_claims`, `_validate_claim_renew_interval`, `_is_missing_rpc`) plus `analytics-service/services/mt5_handover.py` (leaf, never-raises, redaction) | role-match (two analogs, each covers half) |
| `analytics-service/services/mt5_concurrency.py` (modify `mt5_terminal_lease`, add error class, extend reset) | service (lease helper) | request-response (async context manager) | itself (lines 345-503) | exact (self) |
| `analytics-service/services/db.py` (add `is_missing_rpc`) | utility | transform (predicate) | `analytics-service/main_worker.py:667-722` (`_is_undefined_function_structured`, `_is_missing_rpc`) and `db.py:174-192` (`_is_gateway_timeout`) | exact |
| `analytics-service/services/mt5_handover.py` (export a public site normalizer) | utility | transform | itself (lines 144-156, 200-201) | exact (self) |
| `analytics-service/services/job_worker.py` (`classify_exception` transient arm) | service | transform | `job_worker.py:1285-1286` (`HandlerIOUnavailable` arm) | exact |
| `analytics-service/services/allocator_positions.py` (one `except Mt5TerminalBusyError` arm) | service | request-response | same file, lines 1008-1022 and the `AllocatorHoldingsSyncTransientError` raises | exact |
| `analytics-service/routers/process_key.py` (two validate arms) | controller | request-response | same file, lines 1166-1209 and 2068-2101 (`except Mt5SessionAbandoned`) | exact |
| `analytics-service/tests/test_mt5_xlease.py` (new) | test | request-response, event ordering | `analytics-service/tests/test_mt5_concurrency.py` lines 303-435 | role-match |
| `analytics-service/tests/test_mt5_xlease_live.py` (new) | test | CRUD over real PostgREST + N-thread contention | `analytics-service/tests/test_compute_job_metadata_merge_live.py` (PostgREST half, lines 373-464, and the pool at 255) | role-match |
| `analytics-service/tests/conftest.py` (autouse default backend) | test config | n/a | same file, lines 126-147 (`_handover_recorder_never_reaches_a_real_project`) | exact |
| `analytics-service/tests/test_sql_gate_scoped_updates.py` (`_EXPECTED_MATCH_COUNTS`) | test | static scan | same file, lines 183-195 | exact |
| `analytics-service/tests/test_mt5_concurrency.py` (roster stays, one new member note) | test | static AST scan | same file, lines 1010-1041 (`_PRODUCTION_LEASE_SITES`) | exact (no edit expected) |
| `supabase/migrations/<stamp>_mt5_terminal_lease.sql` (new) | migration | CRUD (table plus 3 RPCs) | `supabase/migrations/20261124120200_compute_job_claim_renewal.sql` | exact for RPC half; no table analog in that file |
| `supabase/migrations/down/<stamp>-rollback.sql` (new) | migration | n/a | `supabase/migrations/down/20261124120200-rollback.sql` | exact |
| `supabase/tests/test_mt5_terminal_lease.sql` (new) | test (SQL gate) | CRUD | `supabase/tests/test_compute_job_claim_renewal.sql` | exact |
| `supabase/schema/functions/{acquire,renew,release}_mt5_terminal_lease.sql` (generated) | generated mirror | n/a | `supabase/schema/functions/renew_compute_job_claims.sql` | generated, never hand-written |
| `src/lib/database.types.ts` (hand-add table and 3 signatures) | config (types) | n/a | the Phase 227 hand-add in commit `d04ef47c1` (`git show d04ef47c1 -- src/lib/database.types.ts`) | role-match |
| Census files (see Shared Patterns, census table) | config / test | static | commit `d04ef47c1` file list | exact |
| `analytics-service/scripts/mt5offset_dry_run.py` (`--days-out`) | utility (CLI) | file-I/O (scratch only) | same file, `--map-out` at lines 262 and 288-290 | exact (self) |
| `analytics-service/tests/test_mt5offset_dry_run.py` (extend) | test | file-I/O | same file, line 179 (`test_the_command_line_writes_the_report_and_the_id_map...`) and line 294 (import-purity test) | exact |
| `docs/runbooks/mt5-go-live.md` (SINGLE REPLICA invariant, lines 120-146) | doc | n/a | itself | exact (self) |
| Capture script (UNTRACKED, text handed to the coordinator in the plan) | utility (one-shot) | file-I/O + terminal read | `.planning/milestones/v1.20-phases/164.6.6.2.3-flowtiming-a-deposit-never-breaks-a-return/164.6.6.2.3-08-SUMMARY.md` lines 69-124 (recorded precedent; the script itself was never tracked) | partial (precedent text only) |

## Pattern Assignments

### `analytics-service/services/mt5_xlease.py` (service leaf, request-response plus background task)

**Analogs:** `analytics-service/main_worker.py` (interval validation, RPC call shape, missing-RPC relog) and `analytics-service/services/mt5_handover.py` (leaf discipline, never-raises, redaction). The digest, poll loop, shield and late-grant release have no codebase analog; take them from RESEARCH "Pattern 2" and "Pattern 3".

**Import-time interval validation** (`main_worker.py` lines 443-467, copy the shape, change the inequalities to RESEARCH's `0 < poll < renew < ttl`, `rpc_timeout < renew`, `ttl >= 2*renew + rpc_timeout`):
```python
def _validate_claim_renew_interval(interval: float, smallest_threshold_s: float) -> float:
    if not 0.0 < interval < smallest_threshold_s:
        raise ValueError(
            f"_CLAIM_RENEW_INTERVAL_S must be in (0, {smallest_threshold_s}); got "
            f"{interval} - ..."
        )
    return interval

_CLAIM_RENEW_INTERVAL_S: Final[float] = _validate_claim_renew_interval(
    120.0, _SMALLEST_WATCHDOG_THRESHOLD_S
)
_CLAIM_RENEW_TIMEOUT_S: Final[float] = 20.0
```
Plain constants, no env override (RESEARCH "Lease design": TTL 90.0, renew 20.0, rpc timeout 15.0, poll 0.5, error budget 60.0).

**RPC call and missing-RPC relog** (`main_worker.py` lines 703-767, the shape to copy; `get_supabase` and `db_execute` come from `services.db`):
```python
_RENEW_UNAVAILABLE_RELOG_S: Final[float] = 900.0
_RENEW_UNAVAILABLE_LAST_LOGGED: float | None = None

async def _renew_claims(job_ids, tokens):
    global _RENEW_UNAVAILABLE_LAST_LOGGED
    supabase = get_supabase()

    def _renew() -> Any:
        return supabase.rpc(
            "renew_compute_job_claims",
            {"p_job_ids": job_ids, "p_claim_tokens": tokens},
        ).execute()

    try:
        result = await db_execute(_renew)
    except Exception as exc:  # noqa: BLE001
        if not _is_missing_rpc(exc):
            raise
        _now = time.monotonic()
        if (
            _RENEW_UNAVAILABLE_LAST_LOGGED is None
            or _now - _RENEW_UNAVAILABLE_LAST_LOGGED >= _RENEW_UNAVAILABLE_RELOG_S
        ):
            _RENEW_UNAVAILABLE_LAST_LOGGED = _now
            logger.error("... is unavailable (%s): ...", exc,
                         extra={"event_type": "claim_renew_unavailable"})
        return None
```
Adapt: wrap `db_execute(_call)` in `asyncio.wait_for(..., timeout=_MT5_XLEASE_RPC_TIMEOUT_S)`, and the log line must carry counts only (no `exc` text that could echo a host), event_type `mt5_xlease_unavailable`. Never latch the fallback.

**Holder and site redaction** (`services/mt5_handover.py` lines 186-201). Call `normalize_mt5_holder(holder)` before the RPC. `_normalize_site` is underscore-private; export a public name from `mt5_handover.py` rather than importing the underscore (RESEARCH "Don't Hand-Roll"):
```python
def normalize_mt5_holder(value: object) -> str:
    if not isinstance(value, str):
        return HOLDER_UNATTRIBUTED
    if value in _HOLDER_LITERALS:
        return value
    lowered = value.lower()
    if _UUID_RE.fullmatch(lowered):
        return lowered
    return HOLDER_UNATTRIBUTED

def _normalize_site(value: object) -> str:
    return value if isinstance(value, str) and value in _SITES else HOLDER_UNATTRIBUTED
```

**Leaf invariant.** Imports allowed: `services.db`, `services.mt5_client` constants, `services.mt5_handover`. Forbidden: `services.job_worker`, `main_worker`. Pinned by the subprocess test `test_importing_leaf_does_not_import_job_worker` (`tests/test_mt5_concurrency.py:175`), which should be extended to import `services.mt5_xlease` in the fresh subprocess.

**Renew task discipline** (RESEARCH Pattern 3): one `try/except Exception` around the loop body that logs counts only and keeps looping; `asyncio.CancelledError` passes through; a raising background task reaches `main.lifespan`'s crash handler, which stops dispatch (the same reason the `mt5_concurrency.py` finally block says the handover recorder never raises).

---

### `analytics-service/services/mt5_concurrency.py` (modify `mt5_terminal_lease`)

**Analog:** itself. Edit only the lease helper, the error class, the module docstring import list and `reset_terminal_state_for_tests`.

**Current acquire half to keep unchanged** (lines 430-449):
```python
lock = _mt5_terminal_lock_for(terminal_key)
queued_at = time.monotonic()

if wait_s is None:
    await lock.acquire()
else:
    try:
        await asyncio.wait_for(lock.acquire(), timeout=wait_s)
    except asyncio.TimeoutError:
        logger.warning("mt5_terminal_lease: gave up waiting ... (D-29)", wait_s)
        raise Mt5TerminalBusyError(
            "the MT5 terminal was still in use when the acquisition bound expired"
        ) from None
```
Insert the cross-process acquire AFTER this block and BEFORE `begin_mt5_lease_occupancy`, in a `try/except BaseException: lock.release(); raise` so a refused or cancelled DB acquire releases the local lock and stamps nothing. The remaining `wait_s` is `wait_s - (time.monotonic() - queued_at)` (one deadline across both stages).

**Current finally to keep ordering of** (lines 470-503). The new `stop_renewing()` (sync `task.cancel()`) goes before `bump_mt5_terminal_epoch`; the awaited DB release goes AFTER `lock.release()` and the `after = mt5_terminal_holder(...)` read, and BEFORE the handover record. No `await` may precede `lock.release()`:
```python
    finally:
        bump_mt5_terminal_epoch(terminal_key)
        end_mt5_lease_holder(holder_token)
        end_mt5_lease_occupancy(token)
        lock.release()
        after = mt5_terminal_holder(terminal_key)
        if after is not None and after != before:
            await record_mt5_terminal_handover(
                previous_holder=before or HOLDER_UNKNOWN,
                incoming_holder=after,
                site=site or HOLDER_UNATTRIBUTED,
            )
```

**Error class style** (lines 353-367): plain `Exception` subclass, fixed docstring, "carries no host, port, terminal key, queue depth or account value". `Mt5TerminalLeaseUnavailableError(Mt5TerminalBusyError)` follows RESEARCH: subclass of busy, fixed message carrying nothing.

**Reset hook** (lines 321-342). New per-process state (missing-RPC relog clock, cleanup-task set) is added to `reset_terminal_state_for_tests()` once, per its own instruction ("new per-terminal state is added HERE, once"):
```python
    _MT5_TERMINAL_LOCKS.clear()
    _reset_mt5_epochs_for_tests()
```
Also add a dated CORRECTED note, kept as lineage, to the "SCOPE - a DOCUMENTED gap" comment block above `_MT5_TERMINAL_LOCKS` (line 318), in the style of the `CLOSED` and `RE-CUT` notes at lines 291-317.

---

### `analytics-service/services/db.py` (add `is_missing_rpc`)

**Analog:** `analytics-service/main_worker.py` lines 667-679 and 713-722 (the predicate to copy) and `analytics-service/services/db.py` lines 174-192 (home file's own structured-code predicate style).

**Predicate to copy verbatim in behaviour** (`main_worker.py` 667-679, 713-722):
```python
def _is_undefined_function_structured(exc: BaseException) -> bool:
    code = getattr(exc, "code", None)
    if code == _SQLSTATE_UNDEFINED_FUNCTION:
        return True
    details = getattr(exc, "details", None)
    if isinstance(details, dict) and details.get("code") == _SQLSTATE_UNDEFINED_FUNCTION:
        return True
    return False

def _is_missing_rpc(exc: BaseException) -> bool:
    if _is_undefined_function_structured(exc):
        return True
    if getattr(exc, "code", None) == _POSTGREST_UNDEFINED_FUNCTION:
        return True
    details = getattr(exc, "details", None)
    return isinstance(details, dict) and details.get("code") == _POSTGREST_UNDEFINED_FUNCTION
```
Structured codes only, never message text. Leave `main_worker` untouched (Rule 3). Add a parity test in `tests/test_main_worker.py` style across the same exception-shape matrix (the existing missing-RPC cases there are the matrix to reuse; grep `_is_missing_rpc` in that file when planning).

---

### `analytics-service/services/job_worker.py` (`classify_exception` arm)

**Analog:** the `HandlerIOUnavailable` arm in the same function, lines 1285-1286 (add the new arm beside it, same most-specific-first ordering and a FIXED message that carries nothing):
```python
    if isinstance(exc, HandlerIOUnavailable):
        return ("transient", str(exc)[:500])
```
New arm shape: `if isinstance(exc, Mt5TerminalLeaseUnavailableError): return ("transient", "<fixed text>")`. Import lazily or from `services.mt5_concurrency` per the file's existing import style (`job_worker` already imports from `mt5_concurrency`). The unit test goes beside the existing `classify_exception` tests and must go RED when the arm is removed.

---

### `analytics-service/services/allocator_positions.py` (one except arm)

**Analog:** the same function's existing conversions to the user-facing-safe transient error, lines 1001-1022. Wrap the `async with mt5_terminal_lease(...)` entry so a busy or unavailable raise becomes the fixed copy:
```python
    async with mt5_terminal_lease(
        session.client.terminal_key, holder=api_key_id, site=SITE_HOLDINGS
    ):
        try:
            info = await asyncio.wait_for(
                asyncio.to_thread(_mt5_read), timeout=_MT5_DERIVE_READ_TIMEOUT_S
            )
        except asyncio.TimeoutError as exc:
            ...
            raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE) from exc
```
Constant at line 193: `MT5_UNREACHABLE_NOTE = "MT5 terminal unreachable — sync will retry automatically."`. Required arm: `except Mt5TerminalBusyError as exc: raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE) from exc`, placed so it catches the lease ENTRY and not body exceptions (the body's own arms must keep their dispositions). Do not widen the lease call; the roster `test_no_production_function_holds_two_terminal_leases` must stay green.

---

### `analytics-service/routers/process_key.py` (two validate arms)

**Analog:** the existing `except Mt5SessionAbandoned` arms, lines 1166-1209 (`_run_validate_only`) and 2068-2101 (synchronous pipeline). Add `Mt5TerminalBusyError` to each arm (`except (Mt5SessionAbandoned, Mt5TerminalBusyError):`) and keep the arm's body, which already emits the venue-transient 424 envelope. Excerpt of the envelope (lines 1194-1209):
```python
        log.warning(
            "process_key.validate_only_session_abandoned",
            source=body.source,
            correlation_id=correlation_id,
            duration_ms=int((time.monotonic() - started_at) * 1000),
        )
        return JSONResponse(
            status_code=424,
            content=_envelope_error(
                "NETWORK_UNAVAILABLE",
                exchange_svc.NETWORK_ERROR_DETAIL,
                correlation_id,
                None,
                recoverable=True,
            ),
        )
```
Import: next to `from services.mt5_client import Mt5SessionAbandoned` (line 64) add `from services.mt5_concurrency import Mt5TerminalBusyError` after confirming that import is already reachable from this router (grep before editing). No new user-facing code is minted. Tests: extend `tests/test_process_key.py` lines 4571-4670, which already drive `mt5_adapter.validate = AsyncMock(side_effect=Mt5SessionAbandoned("account_info"))` for both arms; clone each with `Mt5TerminalBusyError` and require RED when the new exception is removed from the tuple.

---

### `analytics-service/tests/test_mt5_xlease.py` (unit and PROOF-01)

**Analog:** `analytics-service/tests/test_mt5_concurrency.py` lines 303-435. Copy: module docstring that names the oracle, blocking-behaviour oracles (event ordering, elapsed time against a bound, `lock.locked()` read from outside), deadman `asyncio.wait_for(..., timeout=10.0)` around anything that could wait forever, and the autouse reset around every test.

**Ordering oracle to copy** (lines 314-334), then run it over TWO separate lock registries sharing ONE fake backend (RESEARCH "Proof" steps 1-4; the `ContextVar("proc")` plus patched `_mt5_terminal_lock_for` factory):
```python
async def test_lease_serializes_two_holders_of_the_same_terminal() -> None:
    events: list[str] = []

    async def hold(name: str) -> None:
        async with mt5_concurrency.mt5_terminal_lease("h:1"):
            events.append(f"{name}-enter")
            await asyncio.sleep(0.05)
            events.append(f"{name}-exit")

    await asyncio.gather(hold("a"), hold("b"))

    assert events == ["a-enter", "a-exit", "b-enter", "b-exit"], (...)
```
The first arm is named `XPROC-01`. It is green on a single registry already, so it MUST use two registries (RESEARCH Pitfall 8), and the neuter-restore record (`cp -p` backup, neuter, RED with `XPROC-01` first, `cp` back, `cmp`, GREEN) goes into the plan SUMMARY.

**Bounded-expiry oracle to copy** (lines 386-434): the held-lock-is-still-held assertion (`assert lock.locked()` after the busy raise) and the successor case that follows; extend it so a DB-refused bounded caller also leaves the local lock released and nothing stamped.

**Import-graph arm:** extend `test_importing_leaf_does_not_import_job_worker` (line 175) style, a fresh subprocess, never an in-process `sys.modules` check. No `importlib.reload` anywhere (project rule).

---

### `analytics-service/tests/test_mt5_xlease_live.py` (lane test, SHOULD not MUST)

**Analog:** `analytics-service/tests/test_compute_job_metadata_merge_live.py`. Copy the PostgREST half exactly:

**Env gating and skip-or-fail** (lines 376-396):
```python
def _need_supabase() -> None:
    if create_client is None:
        if _in_ci():
            pytest.fail("supabase-py is not installed in CI; the PostgREST half cannot run", pytrace=False)
        pytest.skip("supabase-py not installed in this environment")
    if not SUPABASE_URL or not SUPABASE_KEY:
        if _in_ci():
            pytest.fail("... are unset in CI. ...", pytrace=False)
        pytest.skip("local-stack lane not configured (local dev)")
    host = urlparse(SUPABASE_URL).hostname
    if host not in _LOOPBACK_HOSTS:
        pytest.fail("... refuses to write: ... not a loopback lane.", pytrace=False)
```
**Client and schema-cache retry** (lines 399-428): `_lane_client()` with the `http2=False` session rebuild and `wrap_live_db_client`, and `_rpc()` that reloads the PostgREST schema cache once on `PGRST202`. The new RPCs are created after the lane's dump, so the replay path (CLAUDE.md D-F) makes them exist but PostgREST may need the reload.

**Answer-shape pin to adapt** (lines 431-447): call by the module's own RPC-name constants so a rename breaks here, assert `result.data is True` or `is False` (a Python bool). Guards come from `tests.live_db_dsn` (`_in_ci`, `_LOOPBACK_HOSTS`, ...). For N-client contention reuse the `concurrent.futures` pool at line 255 with one client per thread. Use a random digest per test (own rows only; never assert about other rows). Because the module names `SUPABASE_TEST_URL`, conftest's content scan puts it in the `shared_test_db` xdist group automatically.

---

### `analytics-service/tests/conftest.py` (autouse in-memory-grant default)

**Analog:** same file lines 126-147, `_handover_recorder_never_reaches_a_real_project`:
```python
@pytest.fixture(autouse=True)
def _handover_recorder_never_reaches_a_real_project(monkeypatch):
    from services import mt5_handover

    def _refuse():
        raise RuntimeError(
            "unit tests never write a handover row to a real project"
        )

    monkeypatch.setattr(mt5_handover, "get_supabase", _refuse)
    yield
```
Difference to carry: that sink REFUSES (safe because the recorder never raises). The lease fails CLOSED on a refusing sink, which would break about 17 lease-driving modules, so the new default backend must GRANT every acquire (and answer renew and release True) from an in-memory dict. Tests about the lease re-bind their own backend; this fixture runs first so theirs wins (the file's own comment, lines 135-136).

---

### `supabase/migrations/<stamp>_mt5_terminal_lease.sql` (migration)

**Analog:** `supabase/migrations/20261124120200_compute_job_claim_renewal.sql` (162 lines, read in full). Copy structure, not text.

**Header and decision block** (lines 1-51): phase banner, traced root cause, `DECISIONS` with ids, `REJECTED OPTIONS`, `WHAT THIS DOES NOT TOUCH`.

**Function skeleton and hardening** (lines 53-88), reused for each of the three RPCs (all `RETURNS boolean` here):
```sql
CREATE FUNCTION public.renew_compute_job_claims(
  p_job_ids      uuid[],
  p_claim_tokens uuid[]
)
RETURNS SETOF uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $function$
BEGIN
  IF p_job_ids IS NULL ... THEN
    RAISE EXCEPTION '...' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  ...
END
$function$;

COMMENT ON FUNCTION public.renew_compute_job_claims(uuid[], uuid[]) IS '...service_role only.';

REVOKE ALL ON FUNCTION public.renew_compute_job_claims(uuid[], uuid[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.renew_compute_job_claims(uuid[], uuid[]) TO service_role;
```
Also copy `SET LOCAL lock_timeout = '3s';` (used in the rollback at line 37; the research cites it for migrations), and no explicit transaction statements.

**Catalogue-only self-verify** (lines 101-162): `DO $verify$` with `to_regprocedure`, `prosecdef`, `proconfig` containing `'search_path=public, pg_catalog'`, comment-stripped body via `regexp_replace(regexp_replace(pg_get_functiondef(v_oid), '/\*.*?\*/', '', 'gs'), '--.*', '', 'gn')`, `aclexplode` for PUBLIC, `has_function_privilege` for anon, authenticated and service_role. ONE `IF ... THEN RAISE EXCEPTION` per clause so a mutation twin can stand down exactly one clause. Reads no row (`scripts/lint-migration-data-dependence.mjs`). Extend with table checks: RLS on, no anon/authenticated privilege on the table, the digest CHECK present.

**No table analog in this file.** For the table half use `supabase/migrations/20261124120000_jobledger_attempt_failures.sql` (the 227 ledger: RLS enabled, service_role holds SELECT only, CHECK shapes at lines 126-150 per RESEARCH) and `scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql` for why an explicit `REVOKE ALL ON TABLE ... FROM PUBLIC, anon, authenticated` is required.

**Stamp.** Newest tracked migration in this worktree is `20261125132334_api_keys_venue_server_owner_read.sql`. Re-run `git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -3` immediately before push (225 PR-2b-2 has one in flight). A re-stamp touches the migration name, the gate's RED-UNDER annotations, the down file name and header, and generated mirror headers in one commit (RESEARCH Pitfall 10).

---

### `supabase/migrations/down/<stamp>-rollback.sql` (rollback)

**Analog:** `supabase/migrations/down/20261124120200-rollback.sql` (59 lines). Copy: the header block (psql `--single-transaction -v ON_ERROR_STOP=1`, marker query FIRST, "current_database() is `postgres` on BOTH projects and proves nothing", ledger-row-left-in-place warning, `supabase migration repair --status reverted`), `SET LOCAL lock_timeout = '3s';`, a catalogue-only `DO $precondition$` that refuses when the function is absent, the `DROP`s, and a catalogue-only `DO $verify$`. Extend to drop the three functions and the table. State in the header that no worker rollback order is needed because the client falls back on a missing RPC (same sentence as lines 22-26).

---

### `supabase/tests/test_mt5_terminal_lease.sql` (SQL gate)

**Analog:** `supabase/tests/test_compute_job_claim_renewal.sql` (384 lines).

**File header** (lines 1-55): WHAT IS UNDER TEST, THE FAILURE IT CLOSES, HOW (plain `DO` blocks, pgTAP is not installed, no psql meta-commands, every arm its own `BEGIN ... ROLLBACK`), ARMS list, the self-verify layering warning, and the one-line `-- RED-UNDER-SETUP: {"apply":[...]}` JSON. The substrate here is minimal (RESEARCH): `scripts/pg-lane/fixtures/01-fixture-core.sql`, `scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql`, then the new migration.

**Arm skeleton with RED-UNDER and RED-UNDER-M** (lines 133-170 and 319-380):
```sql
-- RED-UNDER: drop the token predicate (`AND c.claim_token = r.tok`) from the renew UPDATE in <migration>. ...
-- RED-UNDER-M: {"arm":"R2","apply":[{"kind":"edit","file":"supabase/migrations/20261124120200_compute_job_claim_renewal.sql","find":"AND c.claim_token = r.tok","replace":"AND TRUE","occurrences":1},{"kind":"edit","file":"...","find":"IF v_body !~* '\\yclaim_token\\s*=' THEN","replace":"IF FALSE AND v_body !~* '\\yclaim_token\\s*=' THEN","occurrences":1}]}
BEGIN;
DO $$
DECLARE ...
BEGIN
  ...
  v_err := NULL; v_msg := NULL;
  BEGIN
    <call under test>
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS v_err = RETURNED_SQLSTATE, v_msg = MESSAGE_TEXT;
  END;
  IF v_err IS NOT NULL THEN
    RAISE EXCEPTION 'TEST FAILED (R2): ...';
  END IF;
  ...
  RAISE NOTICE 'R2 OK: ...';
END $$;
ROLLBACK;
```
The call under test sits in an inner `BEGIN ... EXCEPTION` that only captures the SQLSTATE; the arm's RAISE comes AFTER the block (lint rule R1). Every mutation that breaks something the migration's self-verify also checks stands that clause down in the same `RED-UNDER-M` (`IF FALSE AND ...`) so the gate, not the apply, goes RED.

**Grants arm to copy** (lines 331-380, arm R5): `SET LOCAL ROLE anon` / `authenticated` / `service_role` inside each inner block, capture SQLSTATE, `RESET ROLE`, then expect `'42501'`, `'42501'`, NULL, and a `proconfig` pin check. Add table-privilege assertions for the lease table (L6).

**Sentinel final line** (line 382-384): `DO $$ BEGIN RAISE NOTICE 'ALL N ARMS EXECUTED (L1,L2,...): ...'; END $$;` The file must declare its own `ALL N ARMS EXECUTED` sentinel (anti-skip gate).

**Expiry arms:** `now()` is frozen inside one transaction, so back-date with a scoped `UPDATE public.mt5_terminal_leases SET expires_at = now() - interval '1 second' WHERE terminal_digest = <this arm's digest>` and then call the RPC (RESEARCH Pitfall 9). Add the file's measured count to `_EXPECTED_MATCH_COUNTS` in `analytics-service/tests/test_sql_gate_scoped_updates.py` (lines 183-195, a plain `dict[str, int]` keyed by file name; the 227 commit moved it by +6 lines in that file).

---

### `analytics-service/scripts/mt5offset_dry_run.py` (`--days-out`)

**Analog:** the same file's `--map-out` handling.

**Flag declaration** (line 262) and **write** (lines 288-290):
```python
    parser.add_argument("--map-out", help="write the ordinal map (scratch only; it holds ids)")
    ...
    if args.map_out:
        with open(args.map_out, "w", encoding="utf-8") as fh:
            json.dump(analysis["ordinals"], fh)
```
Add `--days-out` beside it, same shape, written only where the path is named. The day sets must be collected inside `key_shift` (lines 108-167), which today keeps only counts (`moved_days: set[str]` is counted via `len(moved_days)`, and `_by_day(...)` dictionaries are local). Return the sets under a key that `render_report` never reads (the report iterates only `_COLUMNS` fields, lines 221-228), and `analyze` already separates the id-bearing `ordinals` dict from the rows (lines 173-202), which is the pattern for keeping day sets out of the rendered text. Report stays counts-only and every line still passes `_scrub`.

**Tests to extend** (`tests/test_mt5offset_dry_run.py`): clone the CLI test at line 179 (`...writes_the_report_and_the_id_map_and_scrubs_the_note`) so `--days-out` writes only to the named path, and keep the import-purity test at line 294 (`test_the_script_imports_no_client_or_network_module`) green. `scripts/` is ungated by mypy but tests run in the pytest job.

---

### `analytics-service/tests/test_sql_gate_scoped_updates.py`, census files and generated mirrors

**Analog:** commit `d04ef47c1` (Phase 227 ship). Its file list is the authoritative set of census files a new gate file and function set moves. Read each live value by running the check, never from prose. For this phase the moved set is:

| Census | Where | How to read the live value |
|--------|-------|----------------------------|
| mutation floors | `scripts/mutation-floors.mjs` (`FILES_FLOOR` line 1394, `ARMS_FLOOR` line 3563, `WAIVED_CEILING` line 3677 = 0, must stay 0) | `grep -nE '^export const (FILES_FLOOR\|ARMS_FLOOR\|WAIVED_CEILING)' scripts/mutation-floors.mjs`, `node scripts/mutation-runner/run.mjs --parse-only` |
| floor restatements | `src/__tests__/gate-family-meta.test.ts`, `src/__tests__/mutation-annotation-parser.test.ts`, `src/__tests__/mutation-runner-floors.test.ts` | the tests fail with the measured number |
| SQL gate file count | `src/__tests__/lint-sql-gates.test.ts` | `node scripts/lint-sql-gates.mjs` |
| anti-skip sentinels | `.github/workflows/ci.yml`, `src/__tests__/drift-check-scripts.test.ts`, `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` | re-derived by the contract test |
| compared-function floor | `scripts/baseline-content-drift-check.mjs` `COMPARED_FLOOR` (line 378) | moves by the 3 new functions |
| name-set ratchet | `scripts/dump-sql-functions.ts` (`NAME_SET_RATCHET`; 227's comment block at lines 395-410 records the add-then-delete lifecycle) | `snapshot-only` rows cleared by the first re-dump after PROD applies; never an allowlist row |
| TS types | `src/lib/database.types.ts` | hand-add table and 3 signatures, dated note (see `d04ef47c1`, 85 lines) |
| GDPR census | `scripts/check-gdpr-export-coverage.ts` | run it; expect no change (table has no `user_id`, no FK to `auth.users`) |
| scoped UPDATE count | `analytics-service/tests/test_sql_gate_scoped_updates.py` | see gate section above |
| function mirrors | `supabase/schema/functions/*.sql` | `npm run schema:functions` generates; never hand-write |

---

### `docs/runbooks/mt5-go-live.md` (SINGLE REPLICA invariant)

**Analog:** itself, lines 120-146. The paragraph that says serialization is a "per-event-loop `asyncio.Lock`" and "Raising the replica count requires a durable CROSS-PROCESS serializer first" needs a dated CORRECTED note, kept as lineage: the analytics-side constraint is lifted by the lease, the gateway-side constraint (ONE `ThreadedServer`, ONE logged-in account) is not. Do not claim multi-replica is supported without a measured test.

---

### Capture script (UNTRACKED; no tracked analog)

**Precedent (recorded, not tracked source):** `.planning/milestones/v1.20-phases/164.6.6.2.3-flowtiming-a-deposit-never-breaks-a-return/164.6.6.2.3-08-SUMMARY.md`.

- Lines 69-74: "One-shot read inside `quantalyze-analytics-backfill` through `railway ssh`, base64-exec, sequential, one `Mt5Client` per key, `settle_history=True` (every login fresh), derive-bound timeout of 100 s per key."
- Lines 76-88: the restart sequence used afterwards (both services, `railway restart --service <name> --yes`, health reads after).
- Lines 99-124: the write-review table (module, symbol, what it writes) and the "Excluded by design, never called" list (`mt5_terminal_lease`, `record_mt5_terminal_handover`, `_mt5_bounded_restart`, `Mt5Client.restart`, `recycle_terminal_process`, `scrub_terminal_account_data`, `_persist_account_unit`, all of `job_worker`).

**Read seam the script calls:** `analytics-service/services/mt5_read.py`, `read_mt5_deal_ledger` (line 245; synchronous, blocking, no lease, no bound; the caller bounds it). Output JSON contract is the docstring of `analytics-service/scripts/mt5offset_dry_run.py` lines 7-11. Terminal identity must come from `services.mt5_client.mt5_terminal_key` (line 354), never a second spelling.

The script text goes into the plan, the write review table goes into the plan SUMMARY, output goes only to the coordinator's scratchpad. RESEARCH Open Questions 3 and 4 (take the lease or not; `railway ssh` reach to the backfill service) are unresolved and belong to the coordinator and founder, so the plan must carry them as explicit decision steps and must not choose silently.

---

## Shared Patterns

### Fail-closed with a named fallback for a missing RPC
**Source:** `analytics-service/main_worker.py` lines 700-767 (comment 700-708, `_is_missing_rpc` 713-722, `_renew_claims` 725-767), moved to `services/db.py::is_missing_rpc` for this phase.
**Apply to:** `services/mt5_xlease.py` (all three RPC calls).
Missing RPC (42883 or PGRST202 on `.code` or `.details["code"]`) returns "in-process only", logged at ERROR with counts only, re-logged at most every 900 s, never latched. Any other exception fails closed for that caller (batch: retry as transient after the 60 s error budget; bounded: busy at its deadline).

### Redaction: holder and site only through the normalizers, digest only for the terminal
**Source:** `analytics-service/services/mt5_handover.py` lines 186-201, `HANDOVER_ATTRIBUTION_LIMIT` (170-178), site literals 127-156.
**Apply to:** `mt5_xlease.py`, the SQL `holder` and `site` CHECKs, every log line and exception in this phase.
A row, log line, exception or test fixture never carries a login, server, host, port, raw `terminal_key` or key id beyond an `api_key_id` UUID in the holder column. The digest is `sha256("mt5-terminal-lease/v1\x00" + terminal_key.strip().lower())`, 64 hex chars, with a CHECK `^[0-9a-f]{64}$`. Plan tests should scan the written row and captured log text for `host` and port text.

### Plain-Exception busy contract
**Source:** `analytics-service/services/mt5_concurrency.py` lines 353-367 (`Mt5TerminalBusyError`).
**Apply to:** `Mt5TerminalLeaseUnavailableError`. Plain `Exception`, never an `Mt5ClientError` subclass (so no credential classify arm can absorb it into a user verdict), fixed text, nothing about the terminal. The existing test `test_busy_error_cannot_be_absorbed_into_a_credential_verdict` (`tests/test_mt5_concurrency.py:482`) is the pin to extend to the new subclass.

### Sync finally, then awaited work
**Source:** `analytics-service/services/mt5_concurrency.py` lines 470-503 (the order comment and body).
**Apply to:** the new DB release and renew-task cancel. No `await` before `lock.release()` or between the release and the holder read. The recorder's never-raises contract is what keeps the body's own exception intact through the finally; the DB release must carry the same contract (bounded, never raises `Exception`).

### Neuter-restore proof (PROOF-01)
**Source:** CLAUDE.md test-gate integrity rule and RESEARCH "Proof".
**Apply to:** `tests/test_mt5_xlease.py` (client neuter and call-site neuter, both) and every SQL arm's `RED-UNDER-M`. `cp -p` backup, neuter, run, record the named first RED, `cp` back, `cmp`, GREEN, paste verbatim into the plan SUMMARY. Never `git checkout`, `git restore` or `git stash` on uncommitted work.

### Migration safety rails
**Source:** `supabase/migrations/20261124120200_compute_job_claim_renewal.sql` lines 84-162 and `scripts/lint-migration-data-dependence.mjs` rule.
**Apply to:** the new migration and its down file. SECURITY DEFINER with `SET search_path = public, pg_catalog`; `REVOKE ALL ... FROM PUBLIC, anon, authenticated`; `GRANT EXECUTE ... TO service_role`; catalogue-only `DO $verify$`; no `cron` schedule call; no data-reading guard. Marker query first before any statement on a database; the merge auto-applies to TEST then PROD with no human stop, so migration-reviewer and rls-policy-auditor must be clean BEFORE merge.

### Analytics gates
**Apply to:** every analytics file in this phase. `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` from `analytics-service/`; pytest only from `analytics-service/`; never `importlib.reload` in tests; always `grep -a`.

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Cross-process acquire poll with `asyncio.shield` and late-grant release (inside `mt5_xlease.py`) | service | request-response with abandoned-thread cleanup | No existing helper shields a `db_execute` future and releases a late-landing grant. The closest prose is `services/db.py::db_execute` docstring (lines 137-147, zombie threads after `wait_for`) and RESEARCH Pattern 2, which is the spec. Use RESEARCH Pattern 2 as the design. |
| Capture script (untracked) | utility | file-I/O | Only the recorded precedent exists (164.6.6.2.3-08 SUMMARY); the script itself was never tracked, by design. |
| Lease table definition | migration | CRUD | No existing table with an owner token and expiry. Take the table-hardening idioms (RLS on, no policy, explicit REVOKE, service_role SELECT only) from `20261124120000_jobledger_attempt_failures.sql`, and the RPC idioms from the renewal migration. |

## Conflicts surfaced (Rule 7)

1. **CONTEXT "no site edits" versus RESEARCH "three site edits and one classify arm".** CONTEXT's own "Decided autonomously after research" block already records the correction, so this map follows it: edits in `allocator_positions.py`, the two `process_key.py` validate arms, and the `classify_exception` arm. All other lease sites need no edit.
2. **CONTEXT "logs once per process" versus RESEARCH "relog every 900 s".** CONTEXT's later block adopts 900 s (the 227 cadence, `_RENEW_UNAVAILABLE_RELOG_S`). Follow 900 s.
3. **CONTEXT night-1 definition versus RESEARCH Pitfall 5.** CONTEXT's later block corrects to the later of the backfill and API deploys, after the migration applies. This affects the plan's evidence steps, not any source file.

## Metadata

**Analog search scope:** `analytics-service/services/`, `analytics-service/routers/`, `analytics-service/tests/`, `analytics-service/scripts/`, `analytics-service/main_worker.py`, `supabase/migrations/`, `supabase/migrations/down/`, `supabase/tests/`, `scripts/`, `docs/runbooks/`, and the 164.6.6.2.3 plan summary.
**Files scanned:** about 30 read or grepped.
**Pattern extraction date:** 2026-11-25
