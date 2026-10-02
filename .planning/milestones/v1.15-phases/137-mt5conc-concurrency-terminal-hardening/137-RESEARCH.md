# Phase 137: MT5CONC — Concurrency + terminal-lifecycle hardening - Research

**Researched:** 2026-07-23
**Domain:** asyncio worker concurrency + RPyC terminal lifecycle (Python 3, analytics-service worker)
**Confidence:** HIGH (all seams read directly with file:line; the phase is provable entirely offline against the Phase-134 contract double — no external docs required)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**MT5CONC-01 — never wedge (restart-on-timeout + re-queue)**
- Every MT5 IPC at the derive seam runs under `asyncio.to_thread` + `asyncio.wait_for` (the WEDGE-01/PR#632 lesson — heavy/blocking work OFF the shared event loop, bounded). The 136 branch already bounds the read; 137 makes it COMPLETE + hardened.
- **Terminal-restart-on-timeout:** a `wait_for` TimeoutError does NOT just classify transient — it ACTIVELY tears down + reinitializes the terminal session (a blocked RPyC pipe won't self-unblock; the next job would inherit the wedge otherwise). The restart itself is bounded (never a nested wedge).
- The hung-then-timeout path classifies TRANSIENT and RE-QUEUES the job — NEVER a permanent `failed_final` from a transient hang (`asyncio.TimeoutError → transient` classification already exists; 137 ensures the restart + re-queue wiring is correct end-to-end).
- **Regression test:** a deliberately-hung terminal (contract double blocks past the ceiling) → `wait_for` fires → restart invoked + job classified transient/re-queued; the event loop and healthz stay live. Fails without the restart wiring.

**MT5CONC-02 — never cross-bleed (per-terminal lock + login bracket)**
- **Per-terminal serialization lock** (`asyncio.Lock`, keyed to the single terminal): two concurrent MT5 syncs CANNOT share the terminal — structurally serialized. A regression test proves two concurrent syncs cannot interleave on one terminal.
- **Login-bracket assertion:** `account_info().login == expected_login` is asserted BOTH pre- and post- every read block. A mismatch FAILS LOUD (typed raise) and persists NOTHING — the guarantee that `api_verified` is never stamped on the wrong account's numbers. Secrets never in the mismatch message (only the expected/actual login integer, which is not a secret, but scrub any server/password context).
- **v1 = serialized login→read→logout loop on ONE terminal** (no pooling). The lock + the logout-between-accounts + the bracket assertion together make cross-account contamination structurally impossible.

### Claude's Discretion
The exact lock granularity (module-level singleton vs Session-attached), the restart bound value, and the bracket-assertion error type are engineering-discretion, grounded in the existing job_worker transient/failed_final machinery + the Mt5Session lifecycle.

### Deferred Ideas (OUT OF SCOPE)
- Multi-terminal pooling / parallel MT5 syncs → post-v1 (v1 is ONE serialized terminal).
- Live-broker validation of the hang/restart behavior → Phase-134 human_needed spike / Phase 139.
- The master-rejection retcode (WR-03) + DEAL_TYPE middle (136-05) remain their own human gates.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MT5CONC-01 | Derive seam never blocks the loop on a hanging terminal: `to_thread` + `wait_for` bounds + **terminal-restart-on-timeout** | §Q1 — the `wait_for` fires at `job_worker.py:3332`; TimeoutError→transient at `:3336`; restart mechanism = add `Mt5Client.restart()` (shutdown + re-connect via the `_connect` factory), invoke it on the TimeoutError branch, re-queue via the existing DB backoff. |
| MT5CONC-02 | One-terminal-one-account cross-bleed impossible: per-terminal serialization lock + `account_info().login == expected` bracket pre+post read | §Q2 — module-level `dict[str, asyncio.Lock]` registry keyed by `host:port` (mirror `position_reconstruction.py:308`); §Q3 — bracket around the read block at `job_worker.py:3317-3329`, `expected_login = _mt5_session.login`. |
</phase_requirements>

## Summary

Phase 136 landed the `venue == "mt5"` derive branch (`job_worker.py:3273`) with the **baseline** wedge guard already in place: the whole login→account_info→history_deals_get read block runs OFF the event loop via `asyncio.to_thread`, wrapped in a single `asyncio.wait_for(timeout=_MT5_DERIVE_READ_TIMEOUT_S)` (`:3332`), and a `TimeoutError` is already classified `transient` (`:3336`). The explicit marker at `job_worker.py:281-282` reserves *restart-on-timeout + per-terminal lock* for Phase 137. So 137 is a **completion + hardening** phase on an existing, tested seam — not new architecture.

Three net-new pieces, all provable offline against the Phase-134 `Mt5Client` `_connect` double (no `mt5linux`, no live broker): (1) an **active terminal restart** invoked on the `TimeoutError` branch — the current code only *classifies* transient and lets the `finally` close the client; a blocked RPyC pipe on the shared Wine terminal will not self-unblock, so the restart must `shutdown()` the terminal and re-establish it via the injected `_connect` factory before the next attempt; (2) a **module-level per-terminal `asyncio.Lock`** keyed by `host:port` (NOT a `Mt5Session` attribute — each job builds a *fresh* `Mt5Session`, so a Session-attached lock would be a new lock per job = zero serialization); (3) a **login-bracket assertion** reading `account_info()["login"]` and comparing to `_mt5_session.login` both before and after the read block, raising a new typed error that persists NOTHING on mismatch.

**Primary recommendation:** Add `Mt5Client.restart()` (bounded `shutdown()` + re-`_connect`) and a module-level `_MT5_TERMINAL_LOCKS: dict[str, asyncio.Lock]` registry mirroring `position_reconstruction.py:308-317`. Wrap the existing `_mt5_read` block (`job_worker.py:3317-3335`) in `async with _lock_for(host, port):`, add pre/post `account_info().login == _mt5_session.login` brackets inside `_mt5_read`, and call `restart()` on the `except asyncio.TimeoutError` branch (`:3336`) before returning the already-correct `transient` result. Everything else (transient classification, DB re-queue backoff, material-equity floor, the combine) is already correct and must NOT be duplicated.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Bound the RPyC read off the loop | Worker (job_worker derive branch) | — | Already exists at `:3332`; the event-loop bound is a worker-seam concern (per `mt5_client.py:47-48` the client is deliberately synchronous/blocking). |
| Active terminal restart | Worker calls into `Mt5Client` | Gateway (Wine terminal) | The restart *decision* (on timeout) lives in the worker; the *mechanism* (`shutdown()` + re-connect) belongs on `Mt5Client` next to `close()` (`mt5_client.py:262`). |
| Per-terminal serialization | Worker (module-level lock registry) | — | The terminal is a process-wide singleton identified by `MT5_GATEWAY_HOST/PORT`; the lock must live at module scope, not on the per-job `Mt5Session`. |
| Login-bracket assertion | Worker derive branch (`_mt5_read`) | `Mt5Client.account_info` | `expected_login` comes from the parsed key (`Mt5Session.login`); the read is `account_info()` which the client already materializes. |
| Re-queue / backoff | Database (`mark_compute_job_failed` RPC) | main_worker dispatch loop | Transient→`failed_retry`→backoff is entirely DB-side (migration `20260411144407`); the worker only returns `error_kind="transient"`. |

## Research Question Answers

### Q1 — Restart-on-timeout + transient re-queue

**Where the `wait_for` fires (already present, 136):**
`analytics-service/services/job_worker.py:3331-3335`
```python
try:
    _mt5_info, _mt5_deals = await asyncio.wait_for(
        asyncio.to_thread(_mt5_read),
        timeout=_MT5_DERIVE_READ_TIMEOUT_S,
    )
```
- `_mt5_read` (`:3317-3329`) is the synchronous body: `login → account_info → history_deals_get`.
- `_MT5_DERIVE_READ_TIMEOUT_S` (`:286-288`) = `MT5_REQUEST_TIMEOUT_S + 10.0` (default **40s**); `MT5_REQUEST_TIMEOUT_S` default is 30s (`mt5_client.py:78`). `[VERIFIED: codebase read]`

**How the resulting TimeoutError is currently classified (transient), and what is MISSING:**
`job_worker.py:3336-3353` — the `except asyncio.TimeoutError:` branch logs and returns `DispatchResult(outcome=FAILED, error_kind="transient")`. It does **NOT** actively restart the terminal. The only teardown is the surrounding `finally` → `aclose_exchange` (`exchange.py:926-941`) which does a bounded `to_thread(exchange.client.close)` → `Mt5Client.close()` → `self._mt5.shutdown()`. That closes the *client handle*; the next job builds a brand-new `Mt5Client` anyway (via `_make_mt5_session`, `:807`). **The gap:** a wedged Wine terminal behind the RPyC bridge does not restart just because the client reconnects — the phase-goal "active restart" must tell the *remote terminal* to shut down and re-initialize. `[VERIFIED: codebase read]`

**Does `Mt5Client`/mt5linux expose a terminal `initialize`/`shutdown` distinct from `login`?**
- `shutdown()` — YES, wrapped: `Mt5Client.close()` calls `self._mt5.shutdown()` (`mt5_client.py:270`), idempotent via `self._closed` (`:266-268`). This is MT5's terminal-shutdown IPC, distinct from `login`.
- `initialize()` — **NOT wrapped anywhere** (grep of `services/mt5_client.py`, `services/ingestion/mt5.py`, contract test → zero hits). The current facade relies on the constructor `MetaTrader5(host, port, timeout)` (`mt5_client.py:110-112`) to establish the RPyC connection and `login()` to authenticate; there is no explicit `initialize()` call. `[VERIFIED: codebase read]`
- The real `mt5linux.MetaTrader5` proxies the official MetaTrader5 Python API, which DOES expose `initialize()` and `shutdown()` as terminal-lifecycle calls distinct from `login()`. `[ASSUMED — mt5linux is not installed until the 134-03 human-verify gate; A1]`

**Recommended restart mechanism (offline-provable):** Add `Mt5Client.restart()` next to `close()`:
1. best-effort `self._mt5.shutdown()` (tear down the wedged terminal), then
2. rebuild the transport via the SAME injected `_connect` factory the constructor used (store `self._connect`, `self._host`, `self._port`, `self._request_timeout_s` on `__init__` so `restart()` can re-invoke `_connect(host=..., port=..., timeout=...)`), clear `self._closed`.
The subsequent `login()` at read time re-authenticates. Bound the restart itself with `to_thread` + `wait_for` at the call site (never a nested wedge — the CONTEXT requirement). Against the Phase-134 double this is fully exercisable because the double already implements `shutdown()` and is injected via `_connect`.

**How the job re-queues after a transient (DB backoff path):**
- `main_worker.py:681-` `mark_compute_job_failed(p_error_kind="transient")` on `FAILED`.
- Migration `supabase/migrations/20260411144407_compute_jobs_queue.sql` — the RPC body: `permanent` → `failed_final` immediately; else if `attempts >= max_attempts` (default 3) → `failed_final`; else → `failed_retry` with backoff (attempt 1 → +30s, 2 → +2min).
- `failed_retry` rows are re-claimable: `CLAIMABLE_STATUSES = ("pending", "failed_retry")` (`job_worker.py:152`), and `claim_compute_jobs*` picks up `status IN ('pending','failed_retry') AND next_attempt_at <= now()`. `[VERIFIED: migration + codebase read]`

**Confirm a transient hang does NOT become `failed_final`:** Correct in the classification sense — a hang is classified `transient` (`error_kind="transient"`), never `permanent`, so it re-queues per backoff. **Caveat (must inform the plan):** after `max_attempts` (3) transient attempts, the DB *does* transition to `failed_final` via the attempts-exhausted arm — that is exactly why the **active restart matters**: without it, all 3 retries inherit the same wedged terminal and burn to `failed_final`; with it, retry #2/#3 hit a fresh terminal and can succeed. The phase-goal "NEVER a permanent `failed_final` from a transient hang" is satisfied at the *classification* layer (never `error_kind="permanent"`); the restart is what makes the *retry* productive.

### Q2 — Per-terminal serialization lock

**Existing per-resource `asyncio.Lock` pattern to mirror (the canonical analog):**
`analytics-service/services/position_reconstruction.py:308-317`
```python
_RECONSTRUCT_LOCKS: dict[str, asyncio.Lock] = {}

def _lock_for(strategy_id: str) -> asyncio.Lock:
    # setdefault is atomic across coroutine resumption — no await between
    # lookup and insert, so two simultaneous first-callers cannot end up
    # with two different Lock objects for the same key. Single-event-loop safe.
    return _RECONSTRUCT_LOCKS.setdefault(strategy_id, asyncio.Lock())
```
Used as `async with lock:` at `:339`. This is the exact shape 137 should copy, keyed by the **terminal identity** `f"{host}:{port}"`. `[VERIFIED: codebase read]`
(Secondary analog: `sfox_client.py:129` `self._rate_lock = asyncio.Lock()` — instance-level; NOT the right model here, see below.)

**Where the lock should live — MODULE SINGLETON, NOT `Mt5Session` attribute (critical):**
Each job constructs a **fresh** `Mt5Session` → fresh `Mt5Client` via `_make_mt5_session` (`job_worker.py:807-836`, called from the single chokepoint `_make_exchange_client:864-865`). A lock attached to `Mt5Session` would therefore be a *new lock object per job* → serialization of zero. The lock MUST be keyed to the process-wide terminal singleton (`MT5_GATEWAY_HOST`/`MT5_GATEWAY_PORT`, read at `:824-825`). Recommendation: a module-level `_MT5_TERMINAL_LOCKS: dict[str, asyncio.Lock]` + `_terminal_lock_for(host, port)` mirroring the registry above, wrapping the `_mt5_read` block (and the restart) in `async with`.

**Worker concurrency structure (is the loop sequential?):**
- Within one worker process: **SEQUENTIAL.** `main_worker.py:606` `for job in jobs:` awaits `dispatch(cast(...))` (`:657`) one job at a time — no `gather`, no per-job task. Comments throughout (`exchange.py:898-899`, `mt5_client.py:43`) affirm "the SEQUENTIAL worker … jobs run one-at-a-time." So two `derive_broker_dailies` mt5 jobs never interleave *inside one process today.* `[VERIFIED: codebase read]`
- Across replicas / across processes: Railway can run **multiple worker replicas**, and the FastAPI app (validate path, `ingestion/mt5.py:154`) is a *separate* process. Both reach the SAME gateway terminal. An `asyncio.Lock` serializes only within one event loop — it does **NOT** serialize across replicas/processes.

**What this means for the plan:** For v1 (locked scope: ONE serialized terminal), the in-process module-level lock makes interleaving *structurally* impossible within a process — the correct v1 guard, and the thing the regression test proves. The login-bracket (Q3) is the real cross-*account* safety net that also covers the cross-replica gap (a mis-routed terminal fails loud regardless of which process issued the read). The cross-replica serialization gap is a documented limitation (see Open Questions), consistent with how `position_reconstruction` layers an in-process lock over a SQL advisory lock — but 137's locked scope does not add a cross-process lock.

### Q3 — Login-bracket assertion

**Where `account_info()` is read in the derive branch:**
- Inside `_mt5_read` at `job_worker.py:3323`: `_info = _mt5_session.client.account_info()`.
- Equity/balance are extracted from that dict later at `:3394-3395` (`_mt5_info["equity"]`, `_mt5_info["balance"]`). `[VERIFIED: codebase read]`

**What `expected_login` is:** `_mt5_session.login` — the `int` on the `Mt5Session` dataclass (`mt5_client.py:293`), parsed from the reused **`api_key` slot** by `parse_mt5_credentials` (`mt5_validation.py:75-115`: `login -> api_key`, returns `int`). This is the ground-truth "which account did the user connect." `[VERIFIED: codebase read]`

**Where the pre-read and post-read bracket points go:**
Both inside `_mt5_read` (`:3317-3329`), so the assertion runs in-thread under the same `wait_for` bound:
- **PRE-read bracket:** immediately after `login(...)` (`:3318-3322`) and the first `account_info()` (`:3323`), before `history_deals_get` (`:3326`): assert `_info["login"] == _mt5_session.login`.
- **POST-read bracket:** after `history_deals_get` returns (`:3326-3328`), re-read `account_info()` and re-assert `== _mt5_session.login`, guarding against a mid-read session hijack / terminal re-login by another actor.
Both use the SAME `account_info()` seam already wired; the pre-read read can reuse the existing `_info` (no extra round-trip needed for pre; the post-read is one extra `account_info()`).

**`account_info()` must carry a `login` field:** The real MT5 `account_info` namedtuple includes `login` (int). `Mt5Client.account_info()` materializes the whole namedtuple to a dict via `_materialize` (`mt5_client.py:227-232, 123-129`), so `login` flows through if present. **Both test doubles currently populate only `{equity, balance}`** (`test_mt5_derive_branch.py:262` etc.; `test_mt5_client_contract.py`), so the plan must add `"login"` to the fake account dicts. `[VERIFIED: codebase read]` / `[ASSUMED — real namedtuple field name is `login`; A2]`

**How to fail loud + persist nothing (recommended error routing):**
Raise a NEW typed exception (e.g. `Mt5AccountMismatchError` on `mt5_client.py`, or a local sentinel in the branch). A login mismatch is a mis-routed/stale terminal — a SERVER/infra fault, never a user-credential fault — so:
- It must NOT call `_stamp_strategy_analytics_failed(...)` (that persists a user-attributed 'failed' analytics row — wrong blame). Contrast the auth/deal-classification paths which DO stamp (`:3363`, `:3441`).
- It must NOT reach the combine/persist (no `api_verified`, no `csv_daily_returns` — the whole point).
- **Recommended disposition (engineering discretion):** classify **transient** and trigger the Q1 restart — a mis-routed terminal is precisely the "stale/wedged pipe" a restart heals, and a genuinely persistent mis-map fails loud to `failed_final` after retries without ever stamping the wrong account. Alternatively a dedicated permanent-but-no-stamp branch. Either satisfies "persists NOTHING"; the transient+restart option is the more self-healing and is the recommendation. Flag as an [ASSUMED] decision for the planner (A3).
- **Secret hygiene:** the message carries only the two `int` logins (expected/actual) — not secrets. Do NOT interpolate `server`/`password`; if any freeform detail is added, pass it through `scrub_freeform_string` (already imported in the branch, used at `:3361`).

### Q4 — Test injection

**How `test_mt5_derive_branch.py` injects behavior:** `_FakeMt5Transport` (`:66-113`) is the offline double, injected via `Mt5Client("h", 1, _connect=lambda *, host, port, timeout: transport)` in `_session` (`:116-120`). It records every method into `self.calls` (`:87`) — the falsifiability hook for "which IPC calls happened." `_build_ctx` (`:126`) wires it onto `ctx.exchange`; `_patches` (`:171`) stubs `_exchange_preflight`, `aclose_exchange`, `db_execute`. The whole job runs via `run_derive_broker_dailies_job(_job())`.

**(a) Hang past the ceiling (restart test):** Add a hang hook to `_FakeMt5Transport` — e.g. a `hang_s: float` (or a `threading.Event` the test never sets) that makes `history_deals_get` (or `login`) do a real `time.sleep(hang_s)` *inside* the synchronous method. Because `_mt5_read` runs under `asyncio.to_thread`, a real blocking sleep in the worker thread lets the outer `wait_for` fire on the event loop. Monkeypatch `jw._MT5_DERIVE_READ_TIMEOUT_S` (or set `MT5_DERIVE_READ_TIMEOUT_S`) to a small value (e.g. 0.1s). Assert: `result.error_kind == "transient"`, the restart happened (`"shutdown"` — and the new `initialize`/re-connect marker — appears in `transport.calls`, or a `restart_calls` counter), no `csv_daily_returns` upsert, and the event loop stayed responsive (e.g. a concurrent `asyncio.sleep(0)` task completes). *Prefer a bounded sleep over an unbounded Event so a broken test can't hang CI.*

**(b) Wrong `account_info().login` (bracket test):** Build the transport with `account={"login": 999_999, "equity": 110_500.0, "balance": 110_500.0}` while `_session(...)` uses `login=123456` (`:119`). Drive the job → assert `result.outcome == FAILED`, NOTHING persisted (`not any(u[0] == "csv_daily_returns" ...)` and no `strategy_analytics` stamp — the no-blame invariant), and that the two `int`s may appear in the message but the `server`/password never do. Add a healthy-login control (`account["login"] == 123456`) that stays green so the bracket isn't vacuous.

**(c) Two concurrent syncs cannot share the terminal (lock test):** Instrument the double to append lifecycle markers (e.g. `"login"`/`"shutdown"` already recorded, plus an explicit enter/exit) and add a small `await asyncio.sleep` seam so ordering is observable. Launch two jobs concurrently: `await asyncio.gather(run_derive_broker_dailies_job(job_a), run_derive_broker_dailies_job(job_b))` (each with its own transport/session but the SAME module-level lock key `host:port`). Assert the recorded call sequence shows **no interleave** — job B's `login` never appears between job A's `login` and job A's terminal release. The cleanest teeth: a shared list where each read appends `("A","enter")…("A","exit")` and assert the second `enter` follows the first `exit`. Because the module-level lock registry persists across calls, both jobs contend on one `asyncio.Lock`. *Note: reset `_MT5_TERMINAL_LOCKS` between tests (fixture) to avoid cross-test leakage.*

**Client-level contract double (`test_mt5_client_contract.py:63` `_FakeMt5`):** scenario-driven with `login_raises`/`account_raises` hooks and `shutdown_calls` counter (`:104-107`); `_make` (`:110`) captures the connect kwargs. Extend it with a hang hook + an `initialize_calls`/re-connect counter to unit-test the new `Mt5Client.restart()` in isolation (assert `shutdown()` then a fresh `_connect` invocation then `_closed` cleared).

### Q5 — Already done in 136 vs. what 137 adds

**Already present (136 — do NOT duplicate):**
| Asset | Location |
|-------|----------|
| The ONE read block off the loop, `to_thread` + `wait_for` bounded | `job_worker.py:3317-3335` |
| `_MT5_DERIVE_READ_TIMEOUT_S` ceiling (derived from rpyc bound + 10s) | `job_worker.py:286-288` |
| `asyncio.TimeoutError → transient` classification (no stamp) | `job_worker.py:3336-3353` |
| `Mt5ClientError → auth/wrong_server permanent (+stamp) else transient` | `job_worker.py:3354-3386` |
| Bounded idempotent `Mt5Client.close()` → `shutdown()` | `mt5_client.py:262-272` |
| `aclose_exchange` mt5 route: bounded `to_thread(client.close)` + `wait_for` | `exchange.py:918-941` |
| Dual-timeout ordering (login IPC ms < rpyc s) enforced at construction | `mt5_client.py:144-158` |
| DB re-queue backoff for `transient` (failed_retry → failed_final at max) | migration `20260411144407` |
| Offline `_connect` injection double + job-level harness | `test_mt5_derive_branch.py`, `test_mt5_client_contract.py` |
| The `_NATIVE_RETURNS_VENUES` / combine / material-equity floor | `job_worker.py:273, 3432-3494` |

**Net-new in 137 (the delta):**
1. **Active terminal restart** on the `except asyncio.TimeoutError` branch (`:3336`) — add `Mt5Client.restart()` (bounded `shutdown()` + re-`_connect`) and invoke it (itself `to_thread` + `wait_for` bounded) *before* returning the existing transient result.
2. **Module-level per-terminal `asyncio.Lock` registry** keyed by `host:port`, wrapping the read block + restart (`async with`).
3. **Login-bracket assertion** (`account_info()["login"] == _mt5_session.login`) pre- and post- the read, in `_mt5_read` (`:3317-3329`), raising a new typed error that persists nothing.
4. **`Mt5Client.restart()`** method + storing `_connect`/`host`/`port`/`request_timeout_s` on `__init__` (`mt5_client.py:136-164`); `"login"` field added to test doubles.
5. **3 regression tests** (hang→restart+transient; wrong-login→fail-loud-no-persist; two concurrent→no-interleave).

## Standard Stack

No new packages. Everything is Python standard library + the existing worker machinery.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `asyncio` (stdlib) | Python 3.11+ | `Lock`, `wait_for`, `to_thread` | Already the worker's concurrency substrate; the WEDGE-01 pattern and the `position_reconstruction` lock registry both use it. |
| `pytest` + `pytest-asyncio` | as pinned in `analytics-service` | `@pytest.mark.asyncio` job-level tests | The existing `test_mt5_derive_branch.py` harness already uses it. |

**Installation:** none. `mt5linux` is deliberately NOT installed (`mt5_client.py:106-108`) — the phase is proven offline against the injected `_connect` double, so no registry/legitimacy audit applies.

## Architecture Patterns

### System flow (137 additions overlaid on the 136 derive branch)
```
dispatch_tick (main_worker.py:606, SEQUENTIAL for-loop)
  └─ dispatch(job) ── wait_for(handler, per-kind timeout) ─ classify_exception
       └─ run_derive_broker_dailies_job ─ venue=="mt5" (:3273)
            ├─ mt5_enabled_server() kill-switch (:3293)          [136]
            ├─ async with _terminal_lock_for(host,port):         [137 ADD]
            │    ├─ await wait_for(to_thread(_mt5_read), _MT5_DERIVE_READ_TIMEOUT_S) (:3332) [136]
            │    │     _mt5_read:  login (:3318)
            │    │                 account_info() → PRE bracket login==expected [137 ADD]
            │    │                 history_deals_get (:3326)
            │    │                 account_info() → POST bracket login==expected [137 ADD]
            │    └─ except asyncio.TimeoutError:                  [136 classifies transient]
            │           Mt5Client.restart()  (bounded shutdown+reconnect) [137 ADD]
            │           return transient (:3345)                 [136]
            ├─ equity/balance extract + finite guard (:3393)     [136]
            ├─ combine_mt5_deal_ledger + typed dispositions (:3432) [136]
            └─ material-equity floor + uPnL wedge + persist       [136]
       finally: aclose_exchange → bounded to_thread(client.close) (exchange.py:926) [136]
```

### Pattern 1: Module-level per-resource lock registry
**What:** `dict[str, asyncio.Lock]` + `setdefault`-based accessor, keyed by the process-wide resource identity.
**When:** serializing access to a single shared out-of-process resource within an event loop.
**Example:** `position_reconstruction.py:308-317` (verbatim analog — key by `f"{host}:{port}"`).

### Pattern 2: Bounded restart (never a nested wedge)
**What:** wrap the restart's own blocking IPC in `to_thread` + `wait_for`, exactly like the read it heals.
**When:** on the `TimeoutError` branch, before returning transient. Use a small bound (discretion; the CONTEXT calls the value engineering-discretion — the `aclose` precedent is `_ACLOSE_TIMEOUT_S=10s`, `exchange.py:869`).

### Anti-Patterns to Avoid
- **Session-attached lock:** a lock on `Mt5Session` serializes nothing (fresh session per job). Module-level only.
- **Restart that only re-`close()`s the client:** does not restart the remote Wine terminal — the wedge is inherited. Must `shutdown()` the terminal then re-establish transport.
- **Stamping a user-attributed `failed` analytics row on a login mismatch:** the mismatch is a server fault; do not blame the user (skip `_stamp_strategy_analytics_failed`).
- **Unbounded `threading.Event` hang in tests:** use a bounded `time.sleep` so a regression can't hang CI.
- **Re-adding a wait_for/to_thread around the read:** it already exists (`:3332`). 137 wraps it with lock+restart, it does not re-bound it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-terminal serialization | A bespoke flag / busy-wait | `asyncio.Lock` via the `position_reconstruction.py:308` registry pattern | Atomic `setdefault`, no await-gap race, proven in-repo. |
| Re-queue after transient | A Python retry loop in the branch | Return `error_kind="transient"`; the DB `mark_compute_job_failed` backoff owns retries | Backoff + max-attempts + fencing already live in migration `20260411144407`. |
| Bounding the restart IPC | A manual timer | `asyncio.wait_for(asyncio.to_thread(...))` | The exact WEDGE-01 pattern already used at `:3332` and `exchange.py:928`. |
| Secret scrubbing in the mismatch message | Manual string redaction | `scrub_freeform_string` (already imported) + only emit the two `int` logins | `Mt5ClientError` already scrubs at construction (`mt5_client.py:98`). |

**Key insight:** 137 is wiring three small, well-precedented primitives onto an already-correct seam. The heavy correctness machinery (transient classification, DB backoff, bounded close, the combine) is done — the risk is *duplicating* or *re-bounding* it, not building it.

## Runtime State Inventory

Not applicable — this phase is code + tests only (no rename/refactor/migration, no stored-state changes). No DB migration, no env-var rename. `MT5_GATEWAY_HOST/PORT`, `MT5_ENABLED`, `MT5_REQUEST_TIMEOUT_S`, `MT5_DERIVE_READ_TIMEOUT_S` are all read-only inputs already in place. **None found — verified by reading the branch and the CONTEXT scope.**

## Common Pitfalls

### Pitfall 1: Lock attached to the wrong lifetime
**What goes wrong:** a `Mt5Session`-level lock serializes nothing because every job builds a fresh session.
**Why:** `_make_mt5_session` (`:807`) constructs a new `Mt5Session`+`Mt5Client` per job.
**How to avoid:** module-level registry keyed by `host:port`.
**Warning sign:** the concurrent-interleave test passes even with the lock removed.

### Pitfall 2: Restart that leaves the terminal wedged
**What goes wrong:** closing/rebuilding only the client handle; the remote Wine terminal stays blocked, so all 3 retries fail → `failed_final`.
**Why:** the RPyC bridge is stateful; a blocked pipe won't self-unblock (CONTEXT specifics).
**How to avoid:** `restart()` = `shutdown()` the terminal THEN re-`_connect`.
**Warning sign:** the hang-test's restart assertion checks only `close()`, not a re-connect/`initialize`.

### Pitfall 3: `account_info()` double missing `login`
**What goes wrong:** the bracket assertion always compares against a missing key → `KeyError`, or (if defaulted) never fires.
**Why:** the 136 doubles populate only `{equity, balance}`.
**How to avoid:** add `"login"` to every fake `account` dict; assert on it explicitly.
**Warning sign:** the wrong-login test needs no `"login"` key to pass.

### Pitfall 4: Cross-replica assumption
**What goes wrong:** believing the `asyncio.Lock` serializes ALL access to the shared gateway.
**Why:** an `asyncio.Lock` is single-event-loop; multiple replicas + the FastAPI validate process each have their own.
**How to avoid:** rely on the login-bracket as the cross-account safety net; document the cross-replica gap (v1 = one terminal, one worker; pooling deferred).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest + pytest-asyncio (`@pytest.mark.asyncio`) |
| Config file | `analytics-service` pytest config (existing; suite is 4385 passing per 136-03 summary) |
| Quick run command | `cd analytics-service && pytest tests/test_mt5_derive_branch.py -x` |
| Full suite command | `cd analytics-service && pytest` (gate `--cov-fail-under=80`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MT5CONC-01 | Hung terminal → `wait_for` fires → restart invoked → `transient` re-queue; loop/healthz alive | unit (job-level, offline double) | `pytest tests/test_mt5_derive_branch.py -k restart_on_timeout -x` | ❌ Wave 0 (extend existing file) |
| MT5CONC-01 | `Mt5Client.restart()` shutdown+reconnect in isolation | unit (client contract) | `pytest tests/test_mt5_client_contract.py -k restart -x` | ❌ Wave 0 (extend existing file) |
| MT5CONC-02 | Wrong `account_info().login` → FAILED, persists nothing, no user-blame stamp | unit (job-level) | `pytest tests/test_mt5_derive_branch.py -k login_bracket -x` | ❌ Wave 0 |
| MT5CONC-02 | Two concurrent syncs cannot interleave on one terminal | unit (job-level, `gather`) | `pytest tests/test_mt5_derive_branch.py -k concurrent -x` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `pytest tests/test_mt5_derive_branch.py tests/test_mt5_client_contract.py -x`
- **Per wave merge:** `pytest tests/` (analytics-service full suite, coverage gate)
- **Phase gate:** full suite green before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] Extend `_FakeMt5Transport` (`test_mt5_derive_branch.py:66`) with a bounded-hang hook + a `restart`/`initialize` call recorder + a `"login"` account field.
- [ ] Extend `_FakeMt5` (`test_mt5_client_contract.py:63`) with a hang hook + re-connect counter for the `restart()` unit test.
- [ ] Add a fixture to reset the module-level `_MT5_TERMINAL_LOCKS` registry between tests.
- Framework install: none (pytest-asyncio already present).

## Security Domain

Security posture is largely inherited from 136/134 and unchanged; 137 adds one new fail-loud surface (the login bracket).

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | The login-bracket IS an access-control assertion: reads are refused unless the live terminal's account == the connected key's login. |
| V5 Input Validation | yes | `account_info().login` is coerced/compared as `int`; a missing/non-int field must fail loud, never default-match. |
| V6 Cryptography | no | No crypto in scope (credentials already handled by the encryption chokepoint). |
| V7 Error Handling / Logging | yes | Mismatch message emits only the two `int` logins; `server`/password never interpolated; `scrub_freeform_string` for any freeform detail. |

| Threat Pattern | STRIDE | Standard Mitigation |
|----------------|--------|---------------------|
| Wrong account's equity stamped `api_verified` (stale/mis-routed terminal) | Spoofing / Tampering | Login-bracket pre+post read → fail loud, persist nothing (MT5CONC-02). |
| Worker wedge via hung RPyC pipe (DoS of the sequential worker + healthz) | Denial of Service | `to_thread`+`wait_for` bound (136) + active restart (137) → classified transient. |
| Credential disclosure in error text | Information Disclosure | `Mt5ClientError` scrubbing (136) preserved; bracket message emits only non-secret `int`s. |
| Cross-account interleave on the shared terminal | Tampering | Module-level per-terminal `asyncio.Lock` (in-process) + login-bracket (cross-process net). |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `mt5linux.MetaTrader5` exposes `initialize()`/`shutdown()` as terminal-lifecycle calls distinct from `login()`, so a real `restart()` (shutdown + re-init) is achievable. | Q1 | If `initialize` isn't available/needed on the real proxy, the restart may need to be "shutdown + rebuild transport + rely on next login" only. Offline tests pass either way; live behavior is a 134/139 spike concern. Restart is still exercised against the double via `shutdown()`+re-`_connect`. |
| A2 | The real MT5 `account_info()` namedtuple field for the account number is literally `login`. | Q3, Q4 | If the field is named differently (e.g. `login` vs a numeric alias), the bracket key must change; offline doubles are authoritative for the tests, live field name confirmed at the 139 spike. |
| A3 | A login-bracket mismatch should route **transient + restart** (self-healing on a mis-routed terminal) rather than a dedicated permanent-no-stamp branch. | Q3 | If the founder wants a hard permanent stop instead, swap the disposition; both satisfy "persist nothing." Engineering-discretion per CONTEXT — planner should pick and note. |

## Open Questions

1. **Cross-replica / cross-process serialization of the single terminal**
   - What we know: an `asyncio.Lock` serializes only within one event loop; the worker loop is sequential per-process (`main_worker.py:606`), but multiple replicas + the FastAPI validate process share the gateway.
   - What's unclear: whether v1's "ONE terminal, one worker replica" deployment holds in prod, or whether two replicas could interleave.
   - Recommendation: in v1 scope the in-process lock + login-bracket is the guard (the bracket fails loud on any mis-route regardless of process). If prod runs >1 worker replica against one gateway, a cross-process guard (SQL advisory lock keyed to the gateway, or a single-replica worker-role pin) is a Phase-139/pooling follow-up — matches how `position_reconstruction` layers in-process over SQL locks. Not in 137's locked scope.

2. **Restart bound value** — discretion. Recommend reusing the `_ACLOSE_TIMEOUT_S` (10s) magnitude or a fraction of `_MT5_DERIVE_READ_TIMEOUT_S`; must be < the per-kind dispatch outer timeout so the restart can't itself push the job past `failed_final`.

## Sources

### Primary (HIGH confidence — codebase read this session)
- `analytics-service/services/job_worker.py` — derive branch `:3273-3541`, `wait_for` `:3332`, TimeoutError `:3336`, `_mt5_read` `:3317`, `_MT5_DERIVE_READ_TIMEOUT_S` `:286`, `_make_mt5_session` `:807`, `classify_exception` `:449`, dispatch epilogue `:7897`, Phase-137 marker `:281-282`.
- `analytics-service/services/mt5_client.py` — `Mt5Client.login` `:201`, `account_info` `:227`, `close`/`shutdown` `:262`, `Mt5Session` `:276-297`, `_default_connect` `:101`, dual-timeout guard `:144`.
- `analytics-service/services/exchange.py` — `aclose_exchange` mt5 route `:918-941`, `_ACLOSE_TIMEOUT_S` `:869`.
- `analytics-service/services/position_reconstruction.py:296-344` — the `asyncio.Lock` registry analog.
- `analytics-service/main_worker.py:437-663` — sequential `dispatch_tick` loop + heartbeat.
- `analytics-service/services/mt5_validation.py:75-167` — `parse_mt5_credentials`, `classify_mt5_login_error`.
- `analytics-service/tests/test_mt5_derive_branch.py`, `tests/test_mt5_client_contract.py` — offline doubles + injection seams.
- `supabase/migrations/20260411144407_compute_jobs_queue.sql` — `mark_compute_job_failed` transient→failed_retry backoff; `CLAIMABLE_STATUSES`.
- `git show 27ec4eef` (PR#632) — the WEDGE-01 `to_thread` + `wait_for` reference pattern.
- `.planning/phases/136-mt5recon-equity-reconstruction/136-03-SUMMARY.md` — what 136 built (T-136-10 hung-terminal coverage baseline).

### Assumed (training knowledge, unverified this session)
- mt5linux/MetaTrader5 `initialize`/`shutdown`/`account_info().login` surface (A1, A2) — `mt5linux` not installed until the 134-03 gate.

## Metadata

**Confidence breakdown:**
- Seam locations & existing behavior: HIGH — every claim has a file:line read this session.
- Restart mechanism: HIGH for the offline-provable design (shutdown + re-`_connect`); MEDIUM for the live `initialize` detail (A1).
- Lock placement & concurrency model: HIGH — sequential loop + registry analog both read directly.
- Login-bracket field name: HIGH for the wiring; MEDIUM for the live `login` field name (A2).

**Research date:** 2026-07-23
**Valid until:** 2026-08-22 (stable — internal code seams; only the mt5linux live-surface assumptions could shift, and those are gated to Phase 139).
