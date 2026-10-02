---
phase: 137-mt5conc-concurrency-terminal-hardening
plan: 02
subsystem: api
tags: [mt5, concurrency-hardening, per-terminal-lock, login-bracket, trust-integrity, api-verified, cross-account-contamination, tdd]

# Dependency graph
requires:
  - phase: 136-mt5recon-equity-reconstruction
    provides: "job_worker venue=='mt5' derive branch: the ONE bounded to_thread+wait_for read (login→account_info→history_deals_get), PRE _info equity/balance anchor, Mt5ClientError classify/stamp arm, Mt5Session holder"
  - phase: 137-mt5conc-concurrency-terminal-hardening
    plan: 01
    provides: "Mt5Client.restart() + _MT5_RESTART_TIMEOUT_S + the module-level _mt5_bounded_restart(client) helper (to_thread+wait_for bounded) — REUSED by the mismatch branch, never re-implemented"
provides:
  - "mt5_client.Mt5Client.terminal_key property (host:port process-wide terminal identity)"
  - "mt5_client.Mt5AccountMismatchError (plain Exception, deliberately NOT an Mt5ClientError subclass; message = the two int logins only)"
  - "job_worker._MT5_TERMINAL_LOCKS: dict[str, asyncio.Lock] + _mt5_terminal_lock_for() (setdefault, mirroring position_reconstruction.py:308-317); async-with wrap of the whole terminal-IPC region; PRE+POST account_info().login brackets in _mt5_read; a dedicated except Mt5AccountMismatchError branch (transient + bounded restart, NO stamp, NO persist)"
  - "tests: concurrent-no-interleave regression (gather, deterministic, embedded neutered-lock negative control) + pre/post/missing login-bracket regressions + the exact 4-call read-sequence pin + a lock-registry autouse reset fixture"
affects: [139-mt5-golive]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level per-terminal asyncio.Lock registry keyed by host:port (NOT Session-attached — a fresh Session per job would serialize nothing); the exact position_reconstruction.py:308-317 shape, atomic setdefault, unbounded-by-design"
    - "Login-bracket as an access-control assertion: account_info().login == expected_login asserted pre AND post the read; a mismatch raises a typed error that is structurally UN-absorbable by the user-blame classify/stamp arm (plain Exception, not Mt5ClientError) → transient + restart + persist-NOTHING"
    - "Deterministic in-both-directions concurrency test: a bounded event handshake where the blocked job's login structurally cannot fire inside the holder's read window; embedded neutered-lock negative control keeps the guarantee non-vacuous (bounded waits only — a broken lock reds, never hangs CI)"

key-files:
  created: []
  modified:
    - "analytics-service/services/mt5_client.py"
    - "analytics-service/services/job_worker.py"
    - "analytics-service/tests/test_mt5_derive_branch.py"

key-decisions:
  - "Lock is MODULE-LEVEL keyed by Mt5Client.terminal_key (host:port), never Session-attached — _make_mt5_session builds a fresh Mt5Session+Mt5Client per job, so a Session lock would be a new object per job and serialize nothing (Pitfall 1)"
  - "The async-with wraps the ENTIRE terminal-IPC region (the bounded read + all except branches incl. the 137-01 restart and the new mismatch restart); the post-read PURE computation (equity extract, combine, persist) stays OUTSIDE the lock — no terminal IPC there, and holding the terminal through the combine would needlessly serialize CPU work"
  - "Mt5AccountMismatchError is a PLAIN Exception, NOT an Mt5ClientError subclass — so the except Mt5ClientError classify arm (which can stamp a user-attributed permanent failure) can NEVER absorb it; a mismatch is a mis-routed/stale-terminal INFRA fault, never user-blame (A3)"
  - "Mismatch disposition = TRANSIENT + bounded restart (REUSING 137-01's _mt5_bounded_restart) + persist NOTHING + NO _stamp_strategy_analytics_failed; a genuinely persistent mis-map exhausts the DB backoff to failed_final WITHOUT ever stamping/persisting the wrong account's numbers (A3)"
  - "PRE _info stays the returned economic anchor (equity/balance byte-preserved from 136); the POST bracket does one extra assertion-only account_info() read whose dict is discarded"
  - "A MISSING login field must FAIL LOUD (info.get('login') → None != expected int), never default-match (Pitfall 3)"
  - "expected_login = Mt5Session.login (the parsed api_key slot, mt5_validation.py:75); live account_info() field name 'login' is [ASSUMED A2], gated to Phase 139 — offline doubles are authoritative for these tests"
  - "Cross-replica/cross-process serialization is a DOCUMENTED v1 gap (asyncio.Lock is single-event-loop; sequential main_worker loop covers in-process); the login bracket is the cross-process net"

patterns-established:
  - "Pattern: embedded negative control for a concurrency guarantee — the same test runs the two-job scenario a second time with the lock neutered (a fresh Lock per call) and asserts the interleave DOES occur, so the positive assertion can never silently go vacuous"
  - "Pattern: independent bracket RED-proof — neutering ONLY the PRE assert reds pre_mismatch + missing while post_hijack stays green; neutering ONLY the POST assert reds post_hijack while the others stay green (proven this session, restored)"

requirements-completed: [MT5CONC-02]

# Metrics
duration: 40min
completed: 2026-07-23
---

# Phase 137 Plan 02: Per-terminal serialization lock + account_info().login bracket Summary

**Cross-account contamination on the ONE shared MT5 terminal is now structurally impossible: a MODULE-LEVEL per-terminal `asyncio.Lock` (keyed `host:port`) serializes every terminal-IPC region in-process, and an `account_info().login == expected_login` bracket asserted BOTH pre- and post- the deal read fails loud (typed `Mt5AccountMismatchError`), actively restarts the terminal, classifies transient, and persists NOTHING — so `api_verified` can never be stamped on the wrong account's numbers (MT5CONC-02).**

## Performance
- **Duration:** ~40 min
- **Tasks:** 3 (Tasks 1 & 2 TDD; Task 3 verification + docstring)
- **Files:** 3 modified

## Accomplishments

- **`Mt5Client.terminal_key`** (mt5_client.py) — a read-only `host:port` property from the `__init__`-stored `_host`/`_port`; the process-wide identity two per-job clients share so a single module-level lock serializes the ONE terminal.
- **Module-level lock registry** (job_worker.py) — `_MT5_TERMINAL_LOCKS: dict[str, asyncio.Lock]` + `_mt5_terminal_lock_for()` (atomic `setdefault`), mirroring `position_reconstruction.py:308-317` including the unbounded-by-design and single-event-loop-safety comments, PLUS an explicit v1-scope note documenting the cross-replica gap (asyncio.Lock is single-event-loop; the sequential `main_worker.py:606` loop covers in-process; the login bracket is the cross-process net). The whole terminal-IPC region (bounded read + every except branch) is wrapped in `async with _mt5_terminal_lock_for(_mt5_session.client.terminal_key)`; the post-read pure computation stays outside it.
- **`Mt5AccountMismatchError`** (mt5_client.py) — a plain `Exception` (deliberately NOT an `Mt5ClientError` subclass, so the classify/stamp arm cannot absorb it); message = the two int logins only, no server/password.
- **PRE + POST login brackets** (job_worker.py `_mt5_read`) — a nested `_assert_expected_login(info)` strict-compares `info.get("login")` to `_mt5_session.login`; called after the first `account_info()` (PRE) and after a second assertion-only `account_info()` following `history_deals_get` (POST). The PRE `_info` remains the 136 economic anchor. A dedicated `except Mt5AccountMismatchError` branch logs (two ints only), `await`s `_mt5_bounded_restart`, and returns transient — no stamp, no persist.
- **6 mt5-branch tests total for 137 (+4 new this plan)** — `test_mt5_concurrent_syncs_serialized` (deterministic gather with an embedded neutered-lock negative control), `test_mt5_login_bracket_pre_mismatch`, `test_mt5_login_bracket_post_hijack` (mutating `second_account` double), `test_mt5_login_field_missing_fails_loud`; the healthy `test_mt5_routes_one_backbone` pin strengthened to the exact 4-call sequence (`login, account_info, history_deals_get, account_info`); a `_reset_mt5_terminal_locks` autouse fixture; a `"login"` field added to every account dict.

## Guarantee (stated honestly)

The in-process lock makes cross-account interleave **structurally impossible within one worker event loop** — which, under the sequential `main_worker` dispatch loop, is the entire in-process surface. It does **not** serialize across worker replicas or the separate FastAPI validate process (an `asyncio.Lock` is single-event-loop). That cross-process gap is **documented in-code**, not silently assumed; the pre+post login bracket is the cross-process safety net — a mis-routed terminal fails loud regardless of which process issued the read, so no wrong-account numbers are ever persisted or stamped `api_verified`.

## Verification

- `cd analytics-service && python3 -m pytest tests/test_mt5_derive_branch.py tests/test_mt5_client_contract.py -q` → **51 passed** (was 47; +1 concurrent, +3 login-bracket).
- `cd analytics-service && python3 -m pytest -q` → **4398 passed, 96 skipped** — no regressions (136-03 baseline 4385, plus the Phase-137 additions).
- Grep gate: `grep -c '^_MT5_TERMINAL_LOCKS' services/job_worker.py` → **1** (module-level, never Session-attached).
- The 136 read bound is NOT re-bounded: exactly ONE `to_thread(_mt5_read)` (the restart bound is a distinct `to_thread(client.restart)` inside `_mt5_bounded_restart`, reused unchanged).
- **RED-proof (both TDD tasks):** Task 1 — the concurrent test errored without the registry (RED), passed with the lock, and reds with the embedded neutered-lock control. Task 2 — the pre/post/missing tests + the strengthened pin all failed without the brackets (RED); with the brackets, neutering ONLY the PRE assert reddened `pre_mismatch` + `missing` while `post_hijack` stayed green, and neutering ONLY the POST assert reddened `post_hijack` while the others stayed green (proven this session, restored).

## Threat Model Coverage

- **T-137-04 (Spoofing/Tampering — wrong account stamped api_verified)** — mitigated: pre+post `account_info().login == expected` bracket → typed raise, persist NOTHING.
- **T-137-05 (Tampering — cross-account interleave on the shared terminal)** — mitigated: module-level per-terminal `asyncio.Lock` (in-process, structural) + the bracket as the cross-process net.
- **T-137-06 (Information Disclosure — mismatch message)** — mitigated: message carries ONLY the two int logins; server/password never interpolated (no scrubbing dependency because nothing freeform enters).
- **T-137-07 (Repudiation / false user-blame)** — mitigated: the mismatch branch structurally skips `_stamp_strategy_analytics_failed`; regressions assert ZERO `strategy_analytics` upserts.
- **T-137-08 (DoS — mis-routed terminal burning retries)** — mitigated: the branch reuses `_mt5_bounded_restart`; a persistent mis-map exhausts the DB backoff to `failed_final` without wrong-account persistence.
- **T-137-SC (supply chain)** — accept: NO package installs (stdlib `asyncio`/`threading`/`time` only).

## Deviations from Plan

None — plan executed exactly as written (both TDD tasks RED→GREEN, both RED-proofs performed and restored). One in-task assertion refinement: the post-hijack test pins the read-sequence PREFIX (`transport.calls[:4]`) plus an explicit `"shutdown" in calls` restart check, because the bounded restart appends a `"shutdown"` call to the shared transport after the 4-call read — the exact-list form would spuriously red on the restart's own teardown. Not a plan deviation, a test-oracle correctness fix.

## Deferred Issues (out of scope)

- Cross-replica/cross-process serialization of the ONE gateway (SQL advisory lock or single-replica worker-role pin) — a documented v1 gap, deferred to a Phase-139/pooling follow-up (the bracket is the v1 net).
- Live confirmation of the `account_info()` `login` field name (A2) and live `initialize()` restart semantics (A1) — gated to the Phase-139 spike; offline doubles are authoritative for these tests.

## Self-Check: PASSED

- `analytics-service/services/mt5_client.py` — FOUND, `terminal_key` property + `Mt5AccountMismatchError` present
- `analytics-service/services/job_worker.py` — FOUND, `_MT5_TERMINAL_LOCKS` + `_mt5_terminal_lock_for` + `async with _mt5_terminal_lock_for` + `_assert_expected_login` + `except Mt5AccountMismatchError` present
- `analytics-service/tests/test_mt5_derive_branch.py` — FOUND, concurrent + 3 login-bracket tests + reset fixture present
- Commits: `ea16804a` (RED lock test), `ebfa13eb` (GREEN lock), `954f9510` (RED bracket tests), `aa68ed14` (GREEN brackets), `f3a4a1c3` (docstring) — all present in `git log`
