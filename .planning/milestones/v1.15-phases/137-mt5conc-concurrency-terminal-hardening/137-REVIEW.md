---
phase: 137-mt5conc-concurrency-terminal-hardening
reviewed: 2026-07-23T21:45:54Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - analytics-service/services/job_worker.py
  - analytics-service/services/mt5_client.py
findings:
  critical: 0
  warning: 1
  info: 1
  total: 2
status: issues_found
resolution:
  resolved_at: 2026-07-23T00:00:00Z
  WR-01: fixed (commit 4ecda30e)
  IN-01: fixed (commit 78401f1b)
  fixed: 2
  deferred: 0
  full_suite: 4400 passed, 96 skipped (analytics-service pytest -q)
---

# Phase 137: Code Review Report

**Reviewed:** 2026-07-23T21:45:54Z
**Depth:** standard
**Files Reviewed:** 2 (scoped to Phase-137 deltas only)
**Status:** issues_found

## Summary

Reviewed the Phase-137 concurrency/lifecycle additions ONLY: `Mt5Client.restart()`,
the module-level per-terminal lock (`_MT5_TERMINAL_LOCKS` / `_mt5_terminal_lock_for`),
`_mt5_bounded_restart`, and the `account_info().login` bracket + `Mt5AccountMismatchError`
branch in the mt5 derive path. Phase-136 code (equity extraction, combine, persist,
`_guarded_read`, dual-timeout) was read for context but not re-reviewed.

**The core trust guarantees hold and were verified by tracing the code, not assumed:**

- **Login-bracket integrity.** `_assert_expected_login` uses STRICT `!=`; a missing
  `login` field resolves to `info.get("login") -> None`, and `None != int` is `True`,
  so it fails loud (no default-match). `_mt5_session.login` is an `int`
  (`parse_mt5_credentials` does `login = int(raw_login)`, mt5_validation.py:109) and
  `account_info().login` is materialized through `_coerce`, which passes `int` through
  as `int` — so both sides are the same type and the strict comparison cannot false-mismatch
  a correct account. The bracket is asserted BOTH pre (job_worker.py:3420) and post
  (job_worker.py:3430) the deal fetch, and the POST assertion re-reads
  `account_info()` fresh (a new RPyC round-trip via `_guarded_read`), not a cached value.
- **No mismatch can reach persist/stamp.** Every `except` arm inside the
  `async with` returns a `DispatchResult` (TimeoutError:3465, Mismatch:3498,
  Mt5ClientError:3519/3532), so control only falls through to the equity-extraction /
  combine / persist block (3541+, OUTSIDE the lock) when `_mt5_read` returned successfully
  with BOTH brackets passing. `_mt5_info` / `_mt5_deals` are therefore always bound when
  read at 3547/3587 — no UnboundLocalError path.
- **`Mt5AccountMismatchError` is truly outside the `Mt5ClientError` hierarchy**
  (`class Mt5AccountMismatchError(Exception)`, mt5_client.py:101), and its `except`
  arm (3474) precedes the `except Mt5ClientError` arm (3506), so the classify/stamp
  path is structurally unable to absorb it and can never stamp `api_verified` /
  `_stamp_strategy_analytics_failed` on a wrong account.
- **Lock correctness.** `async with` guarantees release on every exit (return/raise).
  Keyed on `host:port` (`Mt5Client.terminal_key`) so all jobs against the ONE gateway
  contend on the SAME lock while distinct terminals would not serialize spuriously. No
  re-entrant acquisition; the lock is not held across a DB re-queue (the transient
  `return` exits the `async with` first). `setdefault` on `_MT5_TERMINAL_LOCKS` has no
  intervening `await`, so it is atomic within one event loop.
- **Secret hygiene.** The mismatch message carries only the two login ints; no server
  or password is interpolated (mt5_client.py:119-125).
- **Cross-replica limitation documented**, not silently assumed (job_worker.py:369-378).

Remaining findings are one WARNING (restart reliability under the abandon-thread model)
and one INFO (POST-read error classification asymmetry). Neither is a wedge or a
wrong-account trust breach.

## Warnings

### WR-01: Bounded restart can operate on a transport still in use by the abandoned timed-out read thread

**Status: FIXED (commit 4ecda30e).** `Mt5Client.restart()` now rebuilds and swaps
in the fresh connection FIRST, then best-effort-disposes the stale connection
(swallowed). A hanging stale `shutdown()` (the abandoned read thread still driving
the shared rpyc connection) can no longer prevent the reconnect: the client holds a
fresh usable connection whenever a connect is possible, even if the stale shutdown
blocks. Regression `test_restart_reconnects_before_stale_shutdown_can_block`
(offline, bounded via a test-controlled Event) simulates a blocking stale shutdown
and asserts the fresh connection is live before the block.

Test evidence — BEFORE (shutdown-first ordering): `AssertionError: restart must
rebuild the transport BEFORE the stale shutdown can block; connect invocations=1`
(assert 1 == 2). AFTER (fix applied): the restart contract suite passes (4 passed),
full analytics suite 4400 passed / 96 skipped. The live rpyc-concurrency behavior
(whether `shutdown()` on a connection an abandoned reader is parked on is safe)
remains `[ASSUMED]` for the Phase-139 gateway spike; the offline test pins the
ORDERING invariant that keeps the restart reliable regardless.


**File:** `analytics-service/services/job_worker.py:332-354, 3444-3464`
(`_mt5_bounded_restart` invoked from the `asyncio.TimeoutError` branch);
`analytics-service/services/mt5_client.py:309-337` (`Mt5Client.restart`)

**Issue:** When the outer `asyncio.wait_for(asyncio.to_thread(_mt5_read), timeout=_MT5_DERIVE_READ_TIMEOUT_S)`
fires, the `_mt5_read` OS thread is ABANDONED but keeps running — it is not joined and
is not gated by the per-terminal `asyncio.Lock` (the lock serializes coroutines within
the event loop, not detached OS threads). The timeout branch then calls
`_mt5_bounded_restart`, which spawns a SECOND thread that calls `client.restart()` ->
`self._mt5.shutdown()` and reassigns `self._mt5` — mutating and issuing requests on the
SAME rpyc connection object the abandoned thread may still be using.

This outer bound is designed to catch a hang OUTSIDE a bounded round-trip — the comment
names "netref materialization" (job_worker.py:284-285, 3395). Netref materialization
itself performs rpyc round-trips to fetch attributes, so in exactly that case the
abandoned thread is actively driving the connection while `restart()`'s `shutdown()`
issues a concurrent request on it. rpyc classic connections are not safe for concurrent
requests from two threads; the protocol stream can be corrupted, so the `shutdown()`
that is supposed to free the wedged remote Wine terminal may not do so reliably —
undermining the restart's stated purpose (a fresh next-retry connection then reconnects
to a possibly-still-wedged terminal and can still burn to `failed_final`).

Impact is bounded and does not breach trust: `restart()`'s failure is swallowed
best-effort, the outer `wait_for` re-bounds it, the next retry builds a fresh
`Mt5Client` (new connection), and the login bracket catches any cross-actor relogin. The
defect is reliability of the recovery, not safety. Live restart semantics are already
marked `[ASSUMED]` (A1) pending the Phase-139 spike (mt5_client.py:326-328), so this is
the right place to record that the abandon-thread + shared-transport interaction must be
validated there.

**Fix:** At the Phase-139 live spike, verify `restart()` behaves correctly when the prior
read thread is still attached to the connection. Prefer making `restart()` build a NEW
transport object and discard the old one WITHOUT calling `shutdown()` on the shared
connection the abandoned thread may hold (or shut down out-of-band), e.g.:

```python
def restart(self) -> None:
    old = self._mt5
    # Rebuild on a fresh connection first so the wedged/abandoned reader keeps
    # its own (soon-discarded) transport; never issue concurrent requests on `old`.
    self._mt5 = self._connect(host=self._host, port=self._port,
                              timeout=self._request_timeout_s)
    self._closed = False
    try:
        old.shutdown()  # best-effort remote teardown of the wedged session
    except Exception:
        logger.warning("Mt5Client.restart: stale shutdown() raised; swallowing.")
```

Confirm against live rpyc/mt5linux whether `shutdown()` on `old` while a reader is parked
on it is safe, or whether the remote terminal must be freed by a separate control channel.

## Info

### IN-01: A transient blip on the assertion-only POST re-read is classified through the permanent-stamp arm

**Status: FIXED (commit 78401f1b) — not deferred.** The fix was low-risk and did
NOT require restructuring in a way that touches the trust guarantees. Only the POST
`account_info()` CALL is wrapped: an `Mt5ClientError` there re-raises as a new
internal `_Mt5PostReadVerificationError` (a plain `Exception`, structurally unable
to be absorbed by the `except Mt5ClientError` classify/stamp arm), handled by a
dedicated transient no-stamp arm. A genuine wrong-account POST read still raises
`Mt5AccountMismatchError` from `_assert_expected_login` (OUTSIDE the wrap) and routes
to the mismatch arm, so `api_verified` can never be stamped on the wrong account and
a mismatch still persists nothing. Regression
`test_mt5_post_read_transient_blip_is_not_permanent` reds against the pre-fix routing
(`error_kind == "permanent"` + a `strategy_analytics` 'failed' stamp) and passes with
the fix (transient, nothing stamped).


**File:** `analytics-service/services/job_worker.py:3424-3430, 3506-3526`

**Issue:** The POST bracket calls `account_info()` a second time purely to re-assert the
account. If that assertion-only read raises `Mt5ClientError` (a mid-read transport blip
after the CORRECT account's deals were already fetched successfully), it flows into the
same `except Mt5ClientError` arm as a login failure. If `classify_mt5_login_error`
returns `auth`/`wrong_server`, the job is stamped PERMANENT `failed` even though the read
of the correct account actually succeeded. This does not persist wrong data (it fails the
job), and the likelihood is low (a generic post-read blip is unlikely to classify as
`auth`), so it is INFO not WARNING — but PRE (gates the read) and POST (safety re-assert)
are semantically different and arguably should not share the permanent-stamp classifier.

**Fix:** If desired, treat a POST-bracket `Mt5ClientError` as transient (never permanent)
— the economic read already succeeded, so a failure to re-confirm the account is a
retry-worthy verification gap, not a credential fault. E.g. wrap the POST `account_info()`
so its `Mt5ClientError` re-raises as a transient-only signal distinct from the login-path
classification.

---

_Reviewed: 2026-07-23T21:45:54Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
