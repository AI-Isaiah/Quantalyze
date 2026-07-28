---
phase: 137-mt5conc-concurrency-terminal-hardening
plan: 01
subsystem: api
tags: [mt5, terminal-lifecycle, restart-on-timeout, concurrency-hardening, never-wedge, bounded-recovery, tdd]

# Dependency graph
requires:
  - phase: 134-mt5spike-feasibility-spike
    provides: "Mt5Client contract (login/account_info/history_deals_get, None!=() discipline, _connect injection seam, idempotent close)"
  - phase: 136-mt5recon-equity-reconstruction
    provides: "job_worker venue=='mt5' derive branch: ONE bounded to_thread+wait_for read (:3376), _MT5_DERIVE_READ_TIMEOUT_S ceiling, asyncio.TimeoutError->transient classification, Mt5Session holder"
provides:
  - "mt5_client.Mt5Client.restart() — best-effort bounded-by-caller shutdown() + re-connect via the stored _connect factory; clears _closed; __init__ now stores _connect/_host/_port/_request_timeout_s"
  - "job_worker._MT5_RESTART_TIMEOUT_S (10s) + _mt5_bounded_restart() module helper (to_thread + wait_for; best-effort swallow; reused by plan 137-02) + restart invocation on the derive except asyncio.TimeoutError branch"
  - "tests: 3 restart contract tests + 2 job-level regressions (hung-read active-restart + restart-itself-bounded)"
affects: [137-02, 139-mt5-golive]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Active terminal recovery: a blocked RPyC/Wine pipe never self-unblocks, so a read-timeout ACTIVELY tears down + rebuilds the transport before the transient return (retries hit a fresh terminal, not the same wedge 3x into failed_final)"
    - "Bounded-recovery-at-the-caller: restart() is synchronous/blocking and NEVER self-bounds; the SOLE call site wraps it in to_thread + wait_for so a hung restart is abandoned exactly like a hung read (never a nested wedge)"
    - "Countable offline transport double: a shared _FakeMt5* with a connect-invocation counter proves re-connect (connects==2) while the single fake keeps its call log across the rebuild"

key-files:
  created: []
  modified:
    - "analytics-service/services/mt5_client.py"
    - "analytics-service/services/job_worker.py"
    - "analytics-service/tests/test_mt5_client_contract.py"
    - "analytics-service/tests/test_mt5_derive_branch.py"

key-decisions:
  - "restart() does NOT gate on _closed and NEVER calls close() (that would latch _closed the wrong way) — its contract is teardown+rebuild regardless of prior state, then clear _closed so the fresh session is closable again"
  - "restart()'s shutdown() is best-effort/swallowed (mirrors close()) — a terminal too wedged to tear down cleanly must still be rebuilt, never left un-restartable (the worst case)"
  - "_MT5_RESTART_TIMEOUT_S = 10s (env MT5_RESTART_TIMEOUT_S) mirroring exchange.py:_ACLOSE_TIMEOUT_S; far under TIMEOUT_PER_KIND['derive_broker_dailies'] (15min) so a hung restart can never push a job into the outer dispatch ceiling"
  - "_mt5_bounded_restart kept module-level (not nested in the branch) because plan 137-02 reuses it for the login-mismatch branch"
  - "The 136 read bound (asyncio.wait_for wrapping _mt5_read at :3376) is UNCHANGED — restart is ADDED before the transient return, never a re-bound of the existing read (RESEARCH §Q5 #1 anti-pattern)"
  - "Mt5Client typed into job_worker via a TYPE_CHECKING import only — the module-import-does-not-require-mt5linux contract stays intact (verified: mt5linux not in sys.modules after import)"

patterns-established:
  - "Pattern: never-nested-wedge proof — a regression where BOTH the read AND the restart's own shutdown hang past tiny monkeypatched bounds, asserting the job still returns transient in wall-clock well under the summed genuine hang durations"
  - "Pattern: loop-liveness ticker — a concurrent asyncio task incrementing a counter every ~10ms, asserted advanced during an in-thread hang, proving the read runs OFF the event loop"
  - "Pattern: bounded real time.sleep hangs in the double (never an unbounded threading.Event) so a broken regression drains and can never itself hang CI"

requirements-completed: [MT5CONC-01]

# Metrics
duration: 35min
completed: 2026-07-23
---

# Phase 137 Plan 01: Mt5Client.restart() + restart-on-timeout wiring + hung-terminal regression Summary

**`Mt5Client.restart()` (best-effort bounded-by-caller `shutdown()` + re-connect) is now invoked — itself `to_thread` + `wait_for` bounded so it can never nest-wedge — on the derive branch's `except asyncio.TimeoutError`, so a wedged Wine/RPyC terminal is ACTIVELY torn down and rebuilt before the transient return and the next DB-backoff retry hits a FRESH terminal instead of burning all three attempts into `failed_final`.**

## Performance
- **Duration:** ~35 min
- **Tasks:** 2 (both TDD)
- **Files:** 4 modified

## Accomplishments

- **`Mt5Client.restart()`** (mt5_client.py) — `__init__` now stores `_connect`/`_host`/`_port`/`_request_timeout_s`; `restart()` does a best-effort (swallowed) `shutdown()`, re-invokes the stored factory, and clears `_closed`. It never gates on `_closed`, never calls `close()`, and never sleeps/retries/joins the abandoned reader thread — bounding is the caller's job. Docstring flags live `initialize()` semantics as [ASSUMED] (A1) pending the Phase-139 spike.
- **Timeout-branch wiring** (job_worker.py) — added `_MT5_RESTART_TIMEOUT_S` (10s, mirrors `_ACLOSE_TIMEOUT_S`) and the module-level `_mt5_bounded_restart(client)` helper (`to_thread` + `wait_for`, best-effort swallow). The derive `except asyncio.TimeoutError` branch now `await`s it before the existing transient `DispatchResult` return. The 136 read bound at `:3376` is untouched; the reservation comment at `:280-289` now records that restart-on-timeout landed here and the per-terminal lock lands in 137-02.
- **5 tests** — 3 contract (`restart_reconnects`, `restart_survives_shutdown_raise`, `restart_clears_closed`) + 2 job-level regressions (`test_mt5_hung_read_restart_on_timeout`: hang → wait_for fires → restart invoked (connects==2, `"shutdown"` in calls) → transient, nothing persisted, loop-liveness ticker advanced; `test_mt5_restart_itself_bounded`: read hang AND shutdown hang both cut by their bounds → still transient promptly). Public-surface contract widened to include `restart`.

## Guarantee (stated honestly)

"Never `failed_final` from a SINGLE hang" is a **classification** guarantee: the timeout path always returns `error_kind="transient"` (never `permanent`), so the DB backoff re-queues. The DB backoff still exhausts to `failed_final` after `max_attempts` of GENUINE failures — the restart makes those retries **productive** (fresh terminal) rather than three inheritances of the same wedge. This plan does not, and does not claim to, prevent `failed_final` on a persistently-broken terminal.

## Verification

- `cd analytics-service && python3 -m pytest tests/test_mt5_derive_branch.py tests/test_mt5_client_contract.py -q` → **47 passed** (was 42; +5 new).
- All mt5-tagged tests (`-k mt5`): **182 passed, 2 skipped** (live-gated) — no regressions.
- Grep gate: `grep -v '^\s*#' services/job_worker.py | grep -c '_MT5_RESTART_TIMEOUT_S'` → **3** (definition + docstring + helper use).
- Exactly ONE `asyncio.to_thread(_mt5_read)` (the 136 bound, unchanged); restart bound is a distinct `asyncio.to_thread(client.restart)`.
- Import safety: `services.job_worker` imports with `mt5linux` NOT in `sys.modules`.
- **RED-proof (both TDD tasks):** neutering the re-connect line reddened `restart_reconnects` on `connects==2`; neutering the branch's `_mt5_bounded_restart` call reddened `test_mt5_hung_read_restart_on_timeout` on the `"shutdown" in calls` assertion. Both restored.

## Threat Model Coverage

- **T-137-01 (DoS, read seam)** — mitigated: existing wait_for bound (136) + ACTIVE bounded restart (this plan).
- **T-137-02 (DoS, nested wedge)** — mitigated: `_MT5_RESTART_TIMEOUT_S` via `to_thread`+`wait_for` at the sole call site; restart never sleeps/retries/joins.
- **T-137-03 (Info disclosure)** — no credential interpolation in the new log lines (static text + `funding_label` only).
- **T-137-SC (supply chain)** — accept: NO package installs (stdlib `asyncio`/`time` only).

## Deviations from Plan

None — plan executed exactly as written (both TDD tasks RED→GREEN, both RED-proofs performed and restored).

## Deferred Issues (out of scope)

- Pre-existing `ruff F401` at `job_worker.py:4888` (`compute_all_metrics` imported but unused inside a lazy-import block) — NOT introduced by this plan, untouched (SCOPE BOUNDARY).

## Self-Check: PASSED

- `analytics-service/services/mt5_client.py` — FOUND, `def restart` present
- `analytics-service/services/job_worker.py` — FOUND, `_MT5_RESTART_TIMEOUT_S` + `_mt5_bounded_restart` present
- `analytics-service/tests/test_mt5_client_contract.py` — FOUND, 3 restart tests present
- `analytics-service/tests/test_mt5_derive_branch.py` — FOUND, 2 regression tests present
- Commits: `073c7413` (RED contract), `fd904ec8` (GREEN restart), `89d2d854` (branch wiring + regressions) — all present in `git log`
