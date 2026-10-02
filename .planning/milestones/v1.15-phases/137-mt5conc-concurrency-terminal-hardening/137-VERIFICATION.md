---
phase: 137-mt5conc-concurrency-terminal-hardening
verified: 2026-07-23T00:00:00Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  note: initial verification
---

# Phase 137: MT5CONC — Concurrency + terminal-lifecycle hardening Verification Report

**Phase Goal:** The trust-critical hardening — the worker can NEVER wedge on a hanging terminal, and `api_verified` can NEVER be stamped on the wrong account's numbers.
**Verified:** 2026-07-23
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must-haves)

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Every MT5 IPC at the derive seam is `to_thread`+`wait_for` bounded; a hung terminal → transient, event loop + healthz stay live | ✓ VERIFIED | `job_worker.py:3444-3447` single `wait_for(to_thread(_mt5_read), timeout=_MT5_DERIVE_READ_TIMEOUT_S)`. `test_mt5_hung_read_restart_on_timeout` (test:643) asserts `error_kind=="transient"` + a concurrent ticker advanced (`ticks["n"]>0`, loop live). |
| 2 | Terminal-restart-on-timeout actively recovers the terminal; the restart is itself bounded (never nested-wedge); a single hang is NEVER `permanent` | ✓ VERIFIED | `_mt5_bounded_restart` (`job_worker.py:332-354`) = `wait_for(to_thread(client.restart), 10s)`, best-effort swallow. Invoked at `:3464` before the transient return. `Mt5Client.restart()` (`mt5_client.py:309-337`) = best-effort shutdown + re-`_connect`, clears `_closed`, never self-bounds. `test_mt5_restart_itself_bounded` (test:699) proves elapsed < summed genuine hangs; `test_mt5_hung_read_restart_on_timeout` asserts `connects==2` + `"shutdown" in calls` (RED without the wiring). |
| 3 | A module-level per-terminal lock (host:port, NOT Session-attached) makes cross-account interleave structurally impossible; regression is deterministic | ✓ VERIFIED | `_MT5_TERMINAL_LOCKS: dict[str,asyncio.Lock]` (`job_worker.py:379`, column-0, grep gate ==1) + `_mt5_terminal_lock_for` setdefault (`:382-387`); `async with _mt5_terminal_lock_for(_mt5_session.client.terminal_key)` wraps the whole IPC region (`:3442`). `terminal_key` = `f"{_host}:{_port}"` (`mt5_client.py:339-352`). `test_mt5_concurrent_syncs_serialized` (test:832) uses a BOUNDED `threading.Event().wait(0.25)` handshake (not sleep-racy) + embedded neutered-lock negative control asserting interleave DOES occur. Autouse `_reset_mt5_terminal_locks` fixture present. |
| 4 | `account_info().login==expected` bracket pre+post read; mismatch fails loud + persists NOTHING + never stamps user-blame; api_verified never on wrong account | ✓ VERIFIED | `_assert_expected_login` (`job_worker.py:3396-3407`) strict `!=`; PRE after first `account_info()` (`:3420`), POST after a second `account_info()` (`:3430`). Mismatch raises `Mt5AccountMismatchError` (`mt5_client.py:101`, PLAIN `Exception`, NOT `Mt5ClientError`) → dedicated branch `:3474-3505` = restart + `error_kind="transient"`, NO `_stamp_strategy_analytics_failed`, NO persist. Tests 883/916/955 (`_persisted_nothing` asserts ZERO `csv_daily_returns` AND ZERO `strategy_analytics` upserts); message carries both int logins, never `Broker-Live`/`pw`; missing-login fails loud. |

**Score:** 4/4 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `services/mt5_client.py` | `restart()` (stores `_connect/_host/_port/_request_timeout_s`), `terminal_key` property, `Mt5AccountMismatchError` (plain Exception) | ✓ VERIFIED | All present (`:194-198`, `:309-337`, `:339-352`, `:101-125`). Mismatch class is NOT an `Mt5ClientError` subclass — structurally un-absorbable by the classify/stamp arm. |
| `services/job_worker.py` | `_MT5_RESTART_TIMEOUT_S`, `_mt5_bounded_restart`, `_MT5_TERMINAL_LOCKS`, `_mt5_terminal_lock_for`, pre+post brackets, mismatch branch | ✓ VERIFIED | All present. 136 read bound UNCHANGED — exactly ONE `to_thread(_mt5_read)`; restart bound is a distinct `to_thread(client.restart)`. |
| `tests/test_mt5_derive_branch.py` | hung-read, restart-bounded, concurrent-serialized, pre/post/missing bracket regressions, 4-call pin, reset fixture | ✓ VERIFIED | 7 Phase-137 tests present; healthy `test_mt5_routes_one_backbone` pins exact `[login, account_info, history_deals_get, account_info]`; money oracles hand-derived and green (136 economics preserved). |
| `tests/test_mt5_client_contract.py` | 3 restart contract tests | ✓ VERIFIED | `test_restart_reconnects` (connects==2), `test_restart_survives_shutdown_raise`, `test_restart_clears_closed` — all substantive. |

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| job_worker TimeoutError branch | mt5_client.restart | `_mt5_bounded_restart` | ✓ WIRED | `:3464` awaits it before transient return |
| job_worker | bounded restart | `wait_for(to_thread(...restart))` | ✓ WIRED | `_mt5_bounded_restart:346-347` |
| job_worker IPC region | `_MT5_TERMINAL_LOCKS` | `async with _mt5_terminal_lock_for(...)` | ✓ WIRED | `:3442` keyed by `client.terminal_key` |
| job_worker `_mt5_read` brackets | `Mt5AccountMismatchError` | dedicated no-stamp branch | ✓ WIRED | raise `:3407`, caught `:3474`; no stamp/persist on the path |

### Behavioral Spot-Checks / Test Execution

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Phase test files green | `pytest tests/test_mt5_derive_branch.py tests/test_mt5_client_contract.py -q` | 51 passed | ✓ PASS |
| Full mt5 surface no-regression | `pytest -k mt5 -q` | 186 passed, 2 skipped (live-gated) | ✓ PASS |

### Grep Gates

| Gate | Expected | Actual | Status |
| --- | --- | --- | --- |
| `grep -c '^_MT5_TERMINAL_LOCKS' services/job_worker.py` | 1 (module-level, not Session-attached) | 1 | ✓ |
| `_MT5_RESTART_TIMEOUT_S` non-comment refs | ≥3 | 3 | ✓ |
| `to_thread(_mt5_read)` (136 bound not duplicated) | 1 | 1 | ✓ |
| `to_thread(client.restart)` (restart bound distinct) | 1 | 1 | ✓ |
| `Mt5AccountMismatchError(Exception)` not Mt5ClientError | plain Exception | `class Mt5AccountMismatchError(Exception)` | ✓ |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| --- | --- | --- | --- | --- |
| MT5CONC-01 | 137-01 | Never wedge — bounded IPC + restart-on-timeout, transient re-queue | ✓ SATISFIED | Truths 1-2 |
| MT5CONC-02 | 137-02 | Never cross-bleed — per-terminal lock + login bracket, persist-NOTHING on mismatch | ✓ SATISFIED | Truths 3-4 |

### Anti-Patterns Found

None. No `TBD/FIXME/XXX/HACK/PLACEHOLDER` in any modified file. The `[ASSUMED]` A1/A2 (live `initialize()` semantics, live `account_info()` `login` field name) are explicitly documented Phase-139 live-spike scope, not debt markers.

### Human Verification Required

None for this phase. Live-terminal confirmation of restart/login-field semantics ([ASSUMED] A1/A2) is Phase-139 scope per the phase boundary (137-CONTEXT.md `<deferred>` and `<verification_context>`), not a gap in this buildable, offline-provable phase.

### Gaps Summary

No gaps. All four ROADMAP success criteria and both requirements (MT5CONC-01/02) are structurally implemented and proven by RED-provable, offline regression tests against the Phase-134 `_connect` double:
- The read seam is bounded once (136 bound untouched, exactly one `to_thread(_mt5_read)`); the timeout branch actively restarts via a separately-bounded helper; the event loop stays live under a hung read.
- The per-terminal lock is module-level keyed `host:port` (not Session-attached), with a deterministic (event-handshake, not sleep-racy) concurrent regression and an embedded neutered-lock negative control.
- The login bracket is asserted pre AND post read; a mismatch raises a plain `Mt5AccountMismatchError` (structurally un-absorbable by the user-blame classify/stamp arm), routes to transient + restart + persist-NOTHING, and the regressions assert ZERO upserts of both `csv_daily_returns` and `strategy_analytics`. Missing `login` fails loud (never default-matches). The message carries only the two int logins.
- The 136 economic anchor (equity/balance from the PRE `_info`) is byte-preserved; the healthy path pins the exact 4-call sequence and all money oracles are green.

---

_Verified: 2026-07-23_
_Verifier: Claude (gsd-verifier)_
