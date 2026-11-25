---
phase: 230-mt5nightly-every-mt5-nightly-derive-ends-done-on-its-first-a
reviewed: 2026-11-25T22:18:09Z
depth: standard
files_reviewed: 35
files_reviewed_list:
  - .github/workflows/ci.yml
  - analytics-service/routers/process_key.py
  - analytics-service/scripts/mt5offset_dry_run.py
  - analytics-service/services/allocator_positions.py
  - analytics-service/services/db.py
  - analytics-service/services/job_worker.py
  - analytics-service/services/mt5_concurrency.py
  - analytics-service/services/mt5_handover.py
  - analytics-service/services/mt5_xlease.py
  - analytics-service/tests/conftest.py
  - analytics-service/tests/test_allocator_positions_non_ccxt.py
  - analytics-service/tests/test_db_is_missing_rpc.py
  - analytics-service/tests/test_job_worker.py
  - analytics-service/tests/test_mt5_concurrency.py
  - analytics-service/tests/test_mt5_terminal_scrub.py
  - analytics-service/tests/test_mt5_xlease.py
  - analytics-service/tests/test_mt5_xlease_live.py
  - analytics-service/tests/test_mt5offset_dry_run.py
  - analytics-service/tests/test_process_key.py
  - analytics-service/tests/xlease_fakes.py
  - scripts/baseline-content-drift-check.mjs
  - scripts/dump-sql-functions.ts
  - scripts/mutation-floors.mjs
  - src/__tests__/drift-check-scripts.test.ts
  - src/__tests__/gate-family-meta.test.ts
  - src/__tests__/lint-sql-gates.test.ts
  - src/__tests__/mutation-annotation-parser.test.ts
  - src/__tests__/mutation-runner-floors.test.ts
  - src/lib/database.types.ts
  - supabase/migrations/20261126120000_mt5_terminal_lease.sql
  - supabase/migrations/down/20261126120000-rollback.sql
  - supabase/schema/functions/acquire_mt5_terminal_lease.sql
  - supabase/schema/functions/release_mt5_terminal_lease.sql
  - supabase/schema/functions/renew_mt5_terminal_lease.sql
  - supabase/tests/test_mt5_terminal_lease.sql
findings:
  critical: 1
  warning: 1
  info: 7
  total: 9
  necessity: 1
status: issues_found
---

# Phase 230: Code Review Report

**Reviewed:** 2026-11-25T22:18:09Z
**Depth:** standard, with cross-file tracing of every `mt5_terminal_lease` call site
**Files Reviewed:** 35
**Status:** issues_found

## Summary

Scope: `git diff origin/main...HEAD -- . ':!.planning' ':!docs'` in the phase-230 worktree. Most of the
effort went to the Python lease client (`services/mt5_xlease.py`), its wiring in
`mt5_concurrency.mt5_terminal_lease`, the error classification and call-site arms (`job_worker`,
`allocator_positions`, `process_key`), and whether the tests encode intent and can fail. The
migration was read only to confirm what the client relies on: renew matches the token regardless
of expiry, release clears the token, acquire with the same token is idempotent and extends the expiry,
and the holder/site CHECKs accept every value `normalize_mt5_holder` and `normalize_mt5_site` can emit.
I did not re-review the migration, because migration-reviewer and rls-policy-auditor already passed it.

I traced every unbounded (`wait_s=None`) site, because each can now raise at entry for the first time:
- derive (`job_worker.py:7815`): the raise propagates to `dispatch`, where `classify_exception`
  makes it transient with fixed text.
- balance read (`job_worker.py:876`): the best-effort `except` returns `None`.
- holdings (`allocator_positions.py:1171`): fixed `MT5_UNREACHABLE_NOTE`, transient.
- worker validate (`ingestion/mt5.py:275`): no catch-all, so it propagates to the long-fetch
  classifier and comes out transient.
- terminal scrub (`mt5_terminal_scrub.py:609-621`): logs at ERROR, alerts and records `failed`;
  the pending key is discarded and the owed mark kept.
- the two `process_key` validate sites: 424 `NETWORK_UNAVAILABLE` with `recoverable: true`.

The bounded heal and liveness sites already treat busy as a skip. All of these are correct.
The worker-validate path was traced into its caller: `long_fetch.run_process_key_long_job` calls
`adapter.validate` with no `try` (`ingestion/long_fetch.py:463`), so no verdict or draft transition
is recorded on a lease raise.

**The concern is the client itself.** There are two provable defects in the "degrade loudly, never
silently" and "the self-fence fires while the lease is still ours" contracts. I confirmed both by
running the shipped code against the repo's own `FakeXLeaseBackend`, using scratch scripts outside the
tree; the results are below.

- **CR-01 (HIGH):** an acquire RPC that hangs is never counted and never logged. An unbounded
  caller waits silently until the database recovers or a job ceiling kills it, and is never handed
  the classifiable `XLeaseUnavailable`. `230-04-SUMMARY.md` records this under "Open issues" as "worth a decision". No
  decision was taken and no test covers it.
- **WR-01 (MEDIUM):** the self-fence can fire after the row has already expired on the database
  clock. The import-time validator pins an inequality that does not guarantee what its docstring
  claims.

**Coverage:** I read in full every Python source diff, the call-site and classification tests,
`xlease_fakes.py`, `conftest.py`, `test_db_is_missing_rpc.py`, the live test and the
`test_mt5offset_dry_run.py` additions. I skimmed the `src/__tests__` census diffs (they are consistent
with `ci.yml` and `mutation-floors.mjs`). I read `test_mt5_xlease.py` at lines 1-130, 440-640 and
780-905, and only by test name elsewhere. I read the migration's function bodies, but not
`supabase/tests/test_mt5_terminal_lease.sql` or the rollback, which belong to the migration reviewers.

**Not run:** the full pytest/vitest suites, Docker, the SQL gate and the live lane test. I ran
two scratch probes with `analytics-service/.venv/bin/python`, both importing only `services.mt5_xlease`
and `tests.xlease_fakes`. **MT5 docs:** I did not consult them. No finding depends on MT5 terminal
behaviour. The fence analysis depends only on this repo's `Mt5Client._assert_live` (checked once per
round-trip, `mt5_client.py:2573-2589`), not on terminal semantics.

## Critical Issues

### CR-01: A hung lease acquire is silent and unbudgeted, so an unbounded caller waits with no log line for as long as the hang lasts (HIGH)

**File:** `analytics-service/services/mt5_xlease.py:619-680` (the `else` of `if fut in done`, i.e. the
timeout path at lines 671-673)

**Issue:**
- When `asyncio.wait({fut}, timeout=rpc_bound)` times out, the loop does three things:
  - it logs nothing;
  - it neither sets nor clears `first_error_at`;
  - it starts the next poll.
- The httpx error that eventually ends the abandoned call (postgrest's default 120 s client timeout)
  lands on a future nobody awaits, and `_consume_future` swallows it.
- So against a PostgREST or database that **hangs** rather than errors, an unbounded caller never
  reaches `XLeaseUnavailable`. That covers the nightly derive, the holdings poll, the balance read,
  worker validate and the scrub. Causes include a black-holed connection, a row lock held by a stuck
  transaction, or an overloaded pooler.
- Meanwhile the caller:
  - holds the in-process lock, so every interactive validate in that process answers busy;
  - leaves a new thread blocked in `_DB_EXECUTOR` every ~15.5 s, for up to 120 s each;
  - adds one future per poll to `pending`.
- It ends only when the database recovers (the next fresh poll is answered) or when something
  cancels the caller:
  - A job is cancelled by its per-kind ceiling (`TIMEOUT_PER_KIND`: derive 900 s, poll 180 s).
    `classify_exception` files that as `("transient", "Handler exceeded timeout: ...")`
    (`job_worker.py:1282-1283`). No lease attribution survives anywhere, so the night shows a second
    attempt that nothing names.
  - The spawned validation-terminal scrub (`mt5_terminal_scrub.py:601`, `wait_s=None`) has no
    ceiling at all. It holds the validation terminal's in-process lock for the whole hang, so every
    wizard validate in that process answers busy (user-facing) with no lease line in the log.
- This violates DEC-04-C's intent ("a PostgREST blip must not burn a derive attempt", answered by a
  classifiable `XLeaseUnavailable`) and the phase brief's "a lease outage must degrade loudly, never
  silently". The only protection left is that it fails closed.

Reproduced on the shipped code, with the timing constants scaled 1:300 and the backend's `acquire`
hook set to `sleep_forever`:

```
RESULT: still waiting after 2.0s (10x the 0.2s error budget); XLeaseUnavailable never raised
acquire calls: 33
log records: []
```

No test covers this. Every budget test (`test_mt5_xlease.py:794-903`) drives fast *raising* backends.

**Fix:** treat a client-side RPC timeout as a backend error for the budget, and log it like one:
```python
            done, _ = await asyncio.wait({fut}, timeout=rpc_bound)
            if fut in done:
                ...  # unchanged
            else:
                # The call outlived its RPC bound: no answer, so it counts toward the error
                # window exactly like a raised error (DEC-04-C), and it is logged once.
                error_now = time.monotonic()
                if first_error_at is None:
                    first_error_at = error_now
                if not error_logged:
                    error_logged = True
                    logger.warning(
                        "mt5_xlease: the lease acquire RPC timed out (site=%s); retrying",
                        site_n,
                        extra={"event_type": "mt5_xlease_rpc_error", "rpc": XLEASE_ACQUIRE_RPC,
                               "site": site_n, "exc_class": "TimeoutError"},
                    )
                if bound_s is None and error_now - first_error_at >= _MT5_XLEASE_ERROR_BUDGET_S:
                    raise XLeaseUnavailable() from None
```
Add a test in `test_mt5_xlease.py`. Set `fake.before["acquire"] = sleep_forever`, shrink
`_MT5_XLEASE_RPC_TIMEOUT_S` and `_MT5_XLEASE_ERROR_BUDGET_S`, and call
`mt5_terminal_lease(_KEY)` (unbounded). Assert:
- `Mt5TerminalLeaseUnavailableError` is raised at or after the budget, inside a deadman timeout;
- exactly one `mt5_xlease_rpc_error` record is logged;
- the local lock is released.

Neuter the new `else` arm and watch the test go RED before restoring it. The validator's
`rpc_timeout < error_budget` already guarantees at least one timed-out attempt fits in the budget.

## Warnings

### WR-01: The self-fence can fire after the row expired, and the timing validator pins the wrong inequality (MEDIUM)

**File:** `analytics-service/services/mt5_xlease.py:463-496` (`_renew_loop`); `:115-120` and the docstring at
`:93-96` (`_validate_xlease_timing`)

**Issue:** Loss is checked only *after* a renew attempt returns, and `last_success` is stamped with
the time the reply arrived, not the time the request was sent. The database stamps `expires_at` when
it executes the statement, which can be up to one RPC timeout earlier. With fast failures followed by
a hang, the check runs at `last_success + 70 + 20 + 15`, up to about 105 s, against a row that expired
at most 90 s after the database executed the last successful renew.

Reproduced on the shipped loop with 1:100 scaled constants that pass `_validate_xlease_timing`
(TTL 0.9, renew 0.2, RPC timeout 0.15, LOST_AFTER 0.7). The first three renews fail fast and the
fourth hangs:

```
ttl (row expiry) = 0.90 ; LOST_AFTER = 0.70 ; on_lost fired at = 0.957
```

At the shipped scale that is a fence about 6 s after expiry, and up to about 15 s in the worst
mixed-latency case. In that window another process can take the row while this holder still drives
the terminal.

The fence also acts only at the body's next MT5 round-trip (`Mt5Client._assert_live`). An in-flight
`history_deals_get` carries on for up to the read bound (`_MT5_DERIVE_READ_TIMEOUT_S`, plus the 30 s
settle budget on a fresh login). So even a perfectly timed fence leaves a 20 s margin
(`TTL - LOST_AFTER`), which is smaller than one derive read.

The MT5CONC-02 login bracket is still the net, so this is not a correctness hole. But the docstring
claim "the self-fence (`ttl - renew`) fires while the lease is still ours" is false, and the
inequality `ttl >= 2*renew + rpc_timeout` does not imply it.

The tests cannot see this:
- `quick_renew` (`test_mt5_xlease.py:446-451`) patches `_MT5_XLEASE_LOST_AFTER_S` separately from the
  RPC timeout, which stays 15 s.
- `test_lost_on_silence...` uses a backend whose renew raises instantly.

**Fix:** make loss a deadline that bounds both the sleep and the in-flight renew, measured from the
send time:
```python
    async def _renew_loop(self) -> None:
        lost_at = self._granted_sent_at + _MT5_XLEASE_LOST_AFTER_S  # monotonic at the granting acquire's SEND
        while True:
            now = time.monotonic()
            if now >= lost_at:
                self._declare_lost(); return
            await asyncio.sleep(min(_MT5_XLEASE_RENEW_INTERVAL_S, lost_at - now))
            sent_at = time.monotonic()
            budget = min(_MT5_XLEASE_RPC_TIMEOUT_S, max(0.0, lost_at - sent_at))
            try:
                renewed = await asyncio.wait_for(self._backend.renew(...), budget)
            except Exception as exc:
                ...  # missing-RPC branch unchanged; otherwise log and fall through
                renewed = None
            if renewed is True:
                lost_at = sent_at + _MT5_XLEASE_LOST_AFTER_S
            elif renewed is False:
                self._declare_lost(); return
```
⛔ Keep the existing outer `try/except Exception` never-raise guard around the loop body. The sketch
omits it for brevity, and dropping it would let a raise reach `main.lifespan`'s crash handler.
Pass the granting poll's send time from `acquire_terminal_xlease` into `XLeaseHold`. Then either
(a) state the real guarantee, that loss is declared by `send_time_of_last_success + LOST_AFTER`, and
size TTL so that `TTL - LOST_AFTER` covers one derive read bound, or (b) narrow the docstring to what
is true. Add a test that uses the scaled constants above and asserts `on_lost` fires before the
scaled TTL. It should be RED on the current loop.

## Info

### IN-01: A bounded caller's lease-database outage is answered, and logged, as "busy in another process" (LOW)

**File:** `analytics-service/services/mt5_concurrency.py:532-544`
**Issue:**
- A bounded caller (wizard, heal, liveness) ignores the error budget, so a database outage ends as
  `XLeaseBoundExpired`. The call site then logs "the terminal is busy in another process" and raises
  a plain `Mt5TerminalBusyError`.
- Heal and liveness record it as `KIND_BUSY_SKIP`. That is a `not_measured` reading which escalates
  (`mt5_session_episodes.py:150` and the note at `:174-176`), so an outage is not silently counted as
  healthy, but it is attributed to a busy terminal.
- The only correct signal is the single `mt5_xlease_rpc_error` WARNING.
- The UX is a recorded CONTEXT decision ("interactive answers busy"). The log text is not.

**Fix:** have `acquire_terminal_xlease` raise `XLeaseBoundExpired` with a flag when the last outcome
was an error rather than a refusal. Log "lease database unreachable" in that case and keep the busy
raise.

### IN-02: No cross-process fairness at the handover (LOW)

**File:** `analytics-service/services/mt5_concurrency.py:609-612`
**Issue:**
- The row is released, then the local lock, and an in-process waiter re-acquires the row about one RTT
  later. A cross-process poller (0.5 to 0.75 s cadence) only wins the free window by chance.
- `dispatch_tick` runs claimed jobs one after another (`main_worker.py:374-375`), so back-to-back
  in-process leases are rare today. If a future change runs MT5 jobs concurrently in one process, the
  poll (180 s ceiling) could be starved.

**Fix:** none needed now. If MT5 dispatch ever becomes concurrent in one process, add a short gap of
`_MT5_XLEASE_POLL_S` plus jitter before an in-process successor re-acquires, or a waiter column.

### IN-03: A missing renew RPC stops renewing while the row is still live (LOW)

**File:** `analytics-service/services/mt5_xlease.py:476-482`
**Issue:**
- PGRST202 also fires on a parameter-signature drift of `renew` alone (the module's own note at
  `:153-156`). In that case the row survives, expires within 90 s, and the holder keeps the terminal
  with no fence.
- It is loud (`mt5_xlease_unavailable`) and matches DEC-04-A.

**Fix:** none required. Optionally fence on renew-missing when the acquire for this hold succeeded
cross-process.

### IN-04: `pending` grows by one future per timed-out poll for the whole wait (INFO)

**File:** `analytics-service/services/mt5_xlease.py:618-621, 671-673`
**Issue:** futures that finish after their poll's `wait` are never discarded until the acquisition
ends, and then each gets a late-grant callback. This is bounded in practice once CR-01's fix caps the
wait.

**Fix:** use a done-callback to discard finished non-True futures from `pending`, or rely on CR-01.

### IN-05: The digest normalizes the key but the in-process registry does not (INFO)

**File:** `analytics-service/services/mt5_xlease.py:174-182`
**Issue:**
- Two spellings of one `host:port` in one process take two local locks and one row. The second waits
  on the first's row and emits a `mt5_xlease_waited`, the cross-process signal plan 09 counts, for an
  in-process collision.
- Every production key comes from `mt5_terminal_key`, so this is judgment, not shown.

**Fix:** none now. Note the assumption beside DEC-02-D.

### IN-06: Impossible-state guard, nested `except BaseException: pass` around a `logger.warning` (INFO)

**File:** `analytics-service/services/mt5_xlease.py:497-504`
**Category:** necessity
**Issue:**
- `Logger.warning` with no `extra` cannot raise on a handler fault, because `Handler.handleError`
  absorbs it.
- The inner `except BaseException` also silently swallows `KeyboardInterrupt` and `SystemExit`.
- This rests on judgment, not on a repository proof.

**Fix:** drop the inner try, and let the outer `except Exception` stand.

### IN-07: The late-grant callback can raise inside a done-callback on a closing loop (INFO)

**File:** `analytics-service/services/mt5_xlease.py:337`
**Issue:** if a stranded acquire lands while the loop is shutting down, `fut.get_loop().create_task(...)`
raises `RuntimeError` inside the callback, and asyncio logs it as "Exception in callback". The row
still expires on its TTL.

**Fix:** guard with `if not loop.is_closed()` and wrap in `try/except RuntimeError`.

---

_Reviewed: 2026-11-25T22:18:09Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure hunter (round 1, 2026-11-26, pr-review-toolkit:silent-failure-hunter, Sonnet high)

MEDIUM 6, LOW 7. MEDIUM findings, all routed to the fixer round:
- SF-M1: a bounded caller's lease outage surfaces as plain "busy" (mt5_xlease.py acquire deadline -> XLeaseBoundExpired; mt5_concurrency.py busy arm), so the boot heal reads it as "session fine" and the liveness probe records KIND_BUSY_SKIP. (Code reviewer graded the same issue LOW as IN-01.)
- SF-M2: a hung acquire RPC is invisible and never opens the error budget; pending thread jobs grow (same issue as CR-01).
- SF-M3: budget exhaustion raises with no ERROR-level log and loses the exception class.
- SF-M4: the renew loop returns permanently, unfenced, on one missing-RPC renew answer. (Code reviewer graded this LOW as IN-03, "matches DEC-04-A".)
- SF-M5: the self-fence can fire after the row has expired (same issue as WR-01).
- SF-M6: a non-boolean RPC answer reads as "refused" and is polled forever without a log.
LOW (recorded only): process-wide 900 s unavailable throttle; 42883 raised inside an RPC body reads as missing; balance-sync broad except; hold.lost unchecked at body exit; release False unlogged; process_key plain-busy copy; --days-out not-measured keys indistinguishable from nothing-moved.
