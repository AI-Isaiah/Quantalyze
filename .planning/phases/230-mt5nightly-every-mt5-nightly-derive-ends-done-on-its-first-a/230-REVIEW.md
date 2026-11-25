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

## Round-1 fixes (2026-11-26, gsd-code-fixer)

| Finding | Commit | What changed |
|---|---|---|
| SF-M6 | `617731f5b` | A non-boolean lease RPC answer raises `TypeError` in `_PostgrestXLeaseBackend._call` and takes the backend-error path; it never reads as False. |
| CR-01 = SF-M2 | `5436d53f4` | A call that outlives its RPC bound counts as a backend error (one `mt5_xlease_rpc_error`, `exc_class=TimeoutError`, spends the DEC-04-C budget). The in-flight call is awaited again, never joined by a new RPC, so at most one acquire call is pending. |
| SF-M3 | `94524ccb1` | Budget exhaustion logs one ERROR, event `mt5_xlease_acquire_gave_up` (exc_class, site, duration_ms, attempts), before the unchanged fixed-text raise. |
| SF-M1 (IN-01) | `4fca671de` | A bounded deadline with no answer at all raises `XLeaseUnavailable` (same give-up ERROR), so `mt5_concurrency` raises `Mt5TerminalLeaseUnavailableError`. The boot heal logs a distinct ERROR and records `lease_unavailable`; the liveness probe records `probe_failed`. A genuine refusal stays plain busy. |
| WR-01 = SF-M5 | `4b40330e8` | Loss is a deadline from the send time of the last successful renew (the granting acquire for the first); the sleep and each renew are bounded by it. The `_validate_xlease_timing` docstring and message state what is guaranteed. |
| SF-M4 (IN-03) | `a1362a215` | A missing renew RPC is logged through `_note_unavailable`, counts as a failed renew, and falls through to the loss deadline. Supersedes the plan-04 must-have "renew stops without bumping the epoch"; DEC-04-A (acquire fallback hold) is untouched. |

Recorded only, not fixed (scope: round-1 list): IN-02, IN-04 (now moot, `pending` holds at most one call), IN-05, IN-06, IN-07 and the SF LOW items.

## Round 2 (code reviewer)

**Reviewed:** 2026-11-26, at `e71c86c02`. Scope: `git diff db7fd1316 e71c86c02 -- analytics-service/`, which covers
`services/mt5_xlease.py`, `mt5_relogin.py`, `mt5_validation_liveness.py` and their tests. Read against
`230-CONTEXT.md` and `230-04-PLAN.md` (DEC-04-A to DEC-04-D).
**Counts:** HIGH 1, MEDIUM 1, LOW 6, INFO 3.

### How this was verified

- **RED on the old source.** I exported the pre-fix tree (`db7fd1316`) and the post-fix tree (`e71c86c02`)
  with `git archive` into a scratch directory outside the repo. Then I ran the new test files against both.
  - `test_mt5_xlease.py`: 57 passed on the new tree. On the old tree, 16 failed and 41 passed. Every fix has
    at least one test that fails on the old code.
  - `test_mt5_relogin.py` and `test_mt5_validation_liveness.py` (`-k "sf_m1 or BUSY or busy"`): 9 passed on
    the new tree. On the old tree both `sf_m1` tests failed and the 7 controls passed.
- **Probes.** I ran two scratch probes on both trees, importing only `services.mt5_xlease` and
  `tests.xlease_fakes`, with the shipped constants scaled 1:100. Their output is quoted below.
- **Not run:** the full suites, the mutation runner and Docker. I did not consult the MT5 docs; no finding
  depends on terminal behaviour.

### Round-1 findings: verdicts

| Finding | Verdict | Can its test fail? |
|---|---|---|
| CR-01 = SF-M2 | **Fixed as stated**: a timeout counts toward the budget, is logged once and ends `XLeaseUnavailable`. **But the "one in-flight call" half added a regression (CR2-01).** | Yes: `test_cr01_a_hung_acquire_…` and `test_cr01_no_new_acquire_…` are RED on the old code |
| SF-M3 | Fixed | Yes: both `test_sf_m3_…` parametrizations are RED |
| SF-M1 | Fixed: unanswered bounded attempts raise unavailable, and the heal and liveness arms come before the busy arm | Yes: the xlease, relogin and liveness `sf_m1` tests are RED |
| WR-01 = SF-M5 | Fixed for fast failures followed by a hang. **The case where the grant itself arrives late is not covered (WR2-01).** | Yes: `test_wr01_the_fence_fires_before_…` is RED. `test_wr01_a_renew_that_hangs_from_the_first_tick_…` passes on the old code (IN2-02) |
| SF-M4 | Fixed | Yes: both `test_sf_m4_…` tests are RED |
| SF-M6 | Fixed | Yes: all `test_sf_m6_…` tests are RED |

### Checked, no defect

- **Renew loop edges** (`mt5_xlease.py:495-533`):
  - **No `sleep(0)` spin.** Each pass either sleeps a positive amount or ends at the `sent_at >= lost_at` check
    (`:502`).
  - **At exactly `lost_at`** the loop fences, because the check is `>=`.
  - **A tiny positive renew budget** ends in `TimeoutError`, which takes the warning arm and then the deadline
    fence.
  - **`CancelledError`** passes through both `except Exception` arms, so `stop_renewing` still ends the task.
- **Acquire loop:**
  - A cancellation or give-up leaves at most the one in-flight future. `except BaseException` attaches the
    late-grant callback to it and re-raises.
  - The missing-RPC return dropped `_release_late_grants`. That is correct, because the future was discarded
    and `pending` is empty at that point.
  - The `failure` bookkeeping is shared by the raise arm and the timeout arm, and the window still resets on
    any answer.
- **New `except` arms:**
  - `mt5_relogin.py:2939` sits beside the busy arm, inside the same nested `try`, so the single top-level guard
    is unchanged.
  - `mt5_validation_liveness.py:194` comes before the busy arm.
  - `lease_unavailable` is not enumerated anywhere else: `busy_skip` and `probe_failed` have no hits under
    `supabase/`, `src/` or `scripts/`. `classify_reading` maps an unknown kind with `code=None` to
    `not_measured`, which the blind-run escalation counts.
- **DEC-04-C versus the bounded "no answer means unavailable" path.** DEC-04-C only governs the budget for
  unbounded callers, so it is not contradicted. CONTEXT's "interactive answers busy" still holds, because the
  wizard's `except Mt5TerminalBusyError` (`routers/exchange.py:1680`) catches the subclass and still answers
  `MT5_TERMINAL_BUSY`.

### CR2-01: The CR-01 fix re-awaits one stuck acquire call, so a single lost response now burns the derive attempt that the pre-fix code survived (HIGH, phase-goal gap)

**File:** `analytics-service/services/mt5_xlease.py:685-698` (the `if pending: fut = next(iter(pending))` reuse)
and `:772-773` (`if pending: continue`)

**Issue:**
- After a timed-out wait, the loop never sends a new call. It waits on the same future until that future
  answers or the budget runs out.
- A request that is lost on the wire, for example on a half-open pooled connection, answers only when httpx's
  read timeout fires. `services/db.py` documents that timeout as postgrest's 120 s default.
- The unbounded budget gives up at about 75 s (first timeout at 15 s, plus the 60 s window), which is before
  that 120 s timeout. So the one stuck request turns directly into `XLeaseUnavailable`, then a transient
  retry, then `attempts > 1` on the derive row. That count is the phase's seven-night metric.
- The pre-fix code re-polled with the same token, which is idempotent, and was granted on the next call.
- The failure class is measured in this repo. `services/db.py` `_is_transient_read_error` records six Sentry
  `httpx.ReadTimeout` groups (QUANTALYZE-2B..2G, Phase 166.5.1), where a second attempt lands. This contradicts
  DEC-04-C's stated intent: "a PostgREST blip must not burn a derive attempt".
- A bounded caller (the wizard, `wait_s=20`) is hit the same way. The stuck first call is awaited until the
  deadline, and the answer is unavailable where a fresh call would have validated.

Probe: the first acquire call hangs forever and every later call is answered at once, at 1:100 scale.
```
new (e71c86c02): bound=None: XLeaseUnavailable after 0.756s (acquire calls=1)
                 bound=0.2:  XLeaseUnavailable after 0.202s (acquire calls=1)
old (db7fd1316): bound=None: GRANTED after 0.158s (acquire calls=2)
                 bound=0.2:  GRANTED after 0.159s (acquire calls=2)
```

**Fix:** keep timeouts counted, but send a fresh call after a timed-out wait. The concern behind the reuse,
unbounded thread growth, is already closed: the budget stops an unbounded caller after about 75 s, which is at
most about five calls of up to 120 s each. The deadline does the same for a bounded caller.
```python
            if len(pending) < _MT5_XLEASE_MAX_INFLIGHT:   # e.g. 5 = ceil(budget / rpc_timeout) + 1
                call_sent_at = time.monotonic()
                fut = asyncio.ensure_future(backend.acquire(digest, token, holder_n, site_n, ttl_s))
                fut.add_done_callback(_consume_future)
                pending.add(fut)
                sent_at_of[fut] = call_sent_at
            done, _ = await asyncio.wait(set(pending), timeout=rpc_bound,
                                         return_when=asyncio.FIRST_COMPLETED)
            # handle EVERY future in `done` (discard each; any True wins, using
            # sent_at_of[that_fut] as granted_sent_at; any False -> answered/refusal;
            # errors -> failure); then drop `if pending: continue` so the poll sleep applies.
```
- ⛔ Keep the abandoned calls in `pending` until the acquisition ends. When it ends they pass to
  `XLeaseHold(pending=...)`, so `release()` gets their late-grant callbacks; on an abandon they pass to
  `_release_late_grants`.
- Do NOT attach the late-grant callback when a wait times out. The token is the same, so a straggler's
  release would free the live hold's row.
- Restore the deleted `test_late_grant_after_a_normal_hold_is_released_again` and
  `test_a_late_grant_from_an_earlier_poll_is_released_when_the_fallback_is_taken`. That path is live again.
- Invert the `count("acquire") == 1` assertions in `test_a_slow_acquire_is_awaited_not_resent_…` (`:262`),
  `test_cr01_no_new_acquire_…` (`:759`) and `test_cr01_a_hung_acquire_…` (`:1118`). Bound them with the cap
  instead.
- Add the probe above as a test. It should be RED on `e71c86c02`: a single stuck first call must still be
  granted, by an unbounded caller and by a bounded one.

### WR2-01: A grant that arrives late is fenced with zero renew attempts, and the validator docstring's "first renew always gets its FULL rpc_timeout" is false (MEDIUM)

**File:** `analytics-service/services/mt5_xlease.py:495-504` (the first `lost_at`, the sleep
`min(RENEW, lost_at - now)`, and the fence before any renew); `:810` (`granted_sent_at=call_sent_at`); the
docstring at `:93-97`

**Issue:**
- The first deadline is measured from the granting call's **send** time. That is correct for safety.
- But the loop sleeps until the deadline itself, and only then checks it. It never tries a renew that could
  have succeeded before the deadline.
- If the grant arrives more than `LOST_AFTER - RENEW` (50 s) after the send, which CR2-01's reuse makes
  possible, the holder is fenced about 15 s after the grant without a single renew. If the grant arrives more
  than 70 s after the send, the holder is fenced at once.
- The body's first MT5 round-trip then raises `Mt5SessionAbandoned` and the derive attempt is burned.
- A renew would have settled the question safely. Renew matches the token regardless of expiry, and here it
  would be sent before the earliest possible expiry (`send + TTL`).

Probe: the granting acquire answers after `delay` and renew is healthy, at 1:100 scale.
```
new: delay=0.30: granted 0.302s, fenced [],      renews=5
     delay=0.55: granted 0.552s, fenced [0.702], renews=0
     delay=0.72: granted 0.752s, fenced [0.753], renews=0
old: delay=0.55 / 0.72: granted ~0.16-0.20s by a second call, fenced [], renews=5
```

**Fix:** sleep only until a full-bound renew still fits before the deadline. A stale grant then renews at
once:
```python
            await asyncio.sleep(max(0.0, min(_MT5_XLEASE_RENEW_INTERVAL_S,
                                             lost_at - time.monotonic() - _MT5_XLEASE_RPC_TIMEOUT_S)))
```
- Add a test at the `scaled_timing` scale. An acquire that answers True after 0.55 s must be followed by at
  least one renew and no fence. It is RED on the current loop.
- Narrow the `_validate_xlease_timing` docstring sentence, or make it true with the change above.
- CR2-01's fix shrinks the window; it does not close it. With several calls in flight, an older call's True
  can still win and carry the older send time.

### LOW

- **LR2-01: a bounded caller whose local wait used up its bound gets one 0.5 s attempt, and a slow answer is
  now reported as an outage.**
  - Where: `mt5_xlease.py:766`, and `mt5_concurrency.py:514-515` for the remaining bound.
  - Effect: one RPC slower than `_MT5_XLEASE_MIN_ATTEMPT_S`, for example behind a saturated `_DB_EXECUTOR`,
    now produces `mt5_xlease_acquire_gave_up` at ERROR and a heal `lease_unavailable` reading. Before the fix
    it was an INFO busy skip.
  - Rare: the local lock has to free up just before the bound.
- **LR2-02: the heal's lease-unavailable arm returns before the relaunch-debt branch.**
  - Where: `mt5_relogin.py:2939-2960`.
  - Effect: before the fix, a lease outage with relaunch debt owed reached the busy arm's
    `note_relaunch_debt_lease_busy` page path. Now it logs an ERROR, and the only page left is the blind-run
    escalation at its threshold.
  - Defensible: nothing drives the terminal while the lease is down. Unbounded jobs fail closed too.
- **LR2-03: the CONTEXT and plan records are stale.**
  - `230-CONTEXT.md:46` still says the heal and liveness arms "need no edit". SF-M1 edited both.
  - SF-M4 supersedes the plan-04 must-have "renew stops without bumping the epoch".
  - Both are recorded only in this REVIEW. The deviation policy wants a dated correction in CONTEXT (and in
    the ROADMAP if it carries the line).
- **LR2-04: `attempts` counts waits, not RPCs.**
  - Where: `mt5_xlease.py:703`.
  - Effect: with the reuse, the give-up ERROR says "after 2 attempts" for one RPC (probe output above).
  - CR2-01's fix makes the count mostly right again; renaming the field to `waits` also works.
- **LR2-05: `XLeaseHold._pending` is always empty under single-in-flight.**
  - Effect: the `_release_late_grants(self._pending, …)` call in `release()` (`:592`) is dead code, and its
    test was deleted.
  - Moot once CR2-01 restores concurrent calls.
- **LR2-06: SF-M4 trade-off, recorded.** A deliberate rollback in the middle of a hold now fences the holder
  at `LOST_AFTER`, which burns that attempt; before the fix it ran on unfenced. The fix accepts this to cover
  signature drift. Note it in the plan-04 supersession.

### INFO

- **IN2-01: the WR-01 timing assertion has 100 ms of slack.** `fenced_at[0] < 0.7 + 0.1` (`test_mt5_xlease.py:1339`),
  and `t0` is taken before the acquire. It may flake on a loaded runner.
- **IN2-02: one WR-01 test passes on the old code, so it pins nothing.**
  `test_wr01_a_renew_that_hangs_from_the_first_tick_is_cut_off_at_the_deadline` (`:1343`) passes on
  `db7fd1316`, where the old loop fenced at about 0.70 s. It is a useful control but cannot catch a revert.
- **IN2-03: the round-1 Info items IN-06 and IN-07 are unchanged**, as recorded.

_Round 2 reviewed: 2026-11-26 · Reviewer: Claude (gsd-code-reviewer) · Depth: standard, cross-file for the changed `except` arms_

## Round 2 (silent-failure hunter, 2026-11-26)

All six round-1 SF findings confirmed closed. CRITICAL 0, HIGH 0, MEDIUM 0, LOW 7 (recorded only): late grant fenced before a renew (same as WR2-01 above, graded LOW here); short bound plus slow RPC reads as outage; wizard telemetry outcome still "lease_busy" for the subclass; heal lease-unavailable arm skips the relaunch-debt page; a broken lease contract retried as transient (exc_class only in the log); `_note_unavailable` text stale for renew; log-accuracy nits (attempts counts waits, refused release unlogged).

## Round-2 fixes (2026-11-26, gsd-code-fixer)

| Finding | Commit | What changed |
|---|---|---|
| CR2-01 | `6902fa6bc` | After a timed-out acquire wait a FRESH call (same token) is sent, capped at `_MT5_XLEASE_MAX_INFLIGHT = 5` calls in flight. The wait is `FIRST_COMPLETED` over all pending calls; abandoned calls stay in `pending` until the acquisition ends (late grants are released then, never at a timeout); the renew deadline is seeded by the granting call's own send time. The two late-grant tests rewritten in round 1 are restored and the `count == 1` assertions now check the cap. |
| WR2-01 | `e37067f43` | The first renew sleep is `max(0, min(RENEW, lost_at - now - RPC_TIMEOUT))`, so a stale grant renews at once. Only the first sleep, so a failing renew gets no instant-retry loop. The `_validate_xlease_timing` docstring is narrowed to a prompt grant. |
| IN2-02 | `e37067f43` | The WR-01 first-tick hang test uses an RPC bound of 0.19 and now fails on the pre-WR-01 loop (fence at 0.79 against the 0.7 deadline). |

Recorded only, not fixed: the round-2 LOW and INFO items.

## Round 3 (code reviewer)

**Reviewed:** 2026-11-26, at `34cc1c3ed`. Scope: `git diff 095785dfe 34cc1c3ed -- analytics-service/`, which is
`services/mt5_xlease.py` and `tests/test_mt5_xlease.py`. Read against `230-CONTEXT.md` and DEC-04-A to DEC-04-D in
`230-04-PLAN.md`.
**Counts:** HIGH 0, MEDIUM 0, LOW 2, INFO 5.

### How this was verified

- **Trees.** I exported `095785dfe` (before the round-2 fixes), `34cc1c3ed` (after them) and `db7fd1316` (before WR-01)
  with `git archive` into a scratch directory outside the repo, and copied the new `test_mt5_xlease.py` into the old trees.
  `xlease_fakes.py` is byte-identical across the three.
- **New tree.** `test_mt5_xlease.py`: 62 passed. `test_mt5_concurrency.py`: 36 passed.
- **Pre-fix tree (`095785dfe`).** 8 failed, 54 passed. I read every failure message:
  - `test_cr2_01_one_lost_response_…[None]` and `[0.2]` raise `XLeaseUnavailable`, after 0.756 s and 0.201 s. That is
    the CR2-01 symptom.
  - `test_late_grant_after_a_normal_hold_…` fails `assert 1 == 2` (the acquire count), and
    `test_a_late_grant_from_an_earlier_poll_…_fallback_…` fails `True is False`. Both are right for single-in-flight.
  - `test_wr2_01_…` fails with "a late grant was fenced at [0.701] without being given a renew". That is the WR2-01 symptom.
  - `test_cr2_01_the_renew_deadline_is_seeded_…` fails because the old code never grants at all. Mutation M2 below is
    what pins the seed.
  - `test_cr2_01_a_hung_database_…cap…` and `test_cr01_a_hung_acquire_…` fail only with `AttributeError` on
    `_MT5_XLEASE_MAX_INFLIGHT`. That is no evidence about behaviour (IN3-04). Mutation M3 is what pins the cap.
- **Mutations** on a scratch copy of the new tree, restored from a byte copy after each run. Every one went RED:
  - M1: the first-sleep lead set to 0. `test_wr2_01_…` fails.
  - M2: the deadline seeded from `started`. `test_cr2_01_the_renew_deadline_is_seeded_…` fails.
  - M3: the cap removed (`if True:`). `test_cr2_01_a_hung_database_…cap…` fails.
  - M4: the late-grant callback attached to every pending call at a timed-out wait. Three tests fail:
    - `test_late_grant_after_a_normal_hold_…`, with three releases;
    - `test_a_late_grant_…_fallback_…`;
    - `test_wr2_01_…`, fenced at 0.551 s, because the straggler's cleanup released the live hold's row.
    So "late grants are released only at the end, never at a timeout" is pinned.
- **IN2-02.** `test_wr01_a_renew_that_hangs_from_the_first_tick_…` now fails on `db7fd1316`, with a fence at 0.785 s
  against the 0.75 s bound. The test discriminates.
- **Probes.** Scratch scripts, using `FakeXLeaseBackend` with a 0.9 s scaled TTL and the 1:100 `scaled_stuck`
  constants. Each was run on both trees:

| Scenario | new (`34cc1c3ed`) | old (`095785dfe`) |
|---|---|---|
| DB stall, every call blocked, gate opens at 0.50 s | granted 0.502 s, 4 calls, no fence, 3 renews | granted 0.502 s, fenced 0.702 s, 0 renews |
| same, gate opens at 0.66 s | granted 0.661 s, 5 calls, no fence, 3 renews | fenced 0.701 s, 0 renews |
| same, gate opens at 0.72 s | granted 0.721 s, **fenced 0.722 s, 0 renews** (LR3-01) | fenced 0.721 s, 0 renews |
| cancelled at 0.5 s with calls in flight, all then land True | 4 in flight, 4 cleanup releases, row free | 1 in flight, 1 release, row free |
| three hung calls land True in one wait | granted, 1 release, row free | n/a |
| bounded 2.0 s (20x the RPC bound), every call hangs | `XLeaseUnavailable` at 2.00 s, exactly 5 calls (the cap) | n/a |
| first call commits on the DB after the hold released, then its response errors | **row still held** (LR3-02) | n/a |

- **Not run:** the full suites, the mutation runner and Docker. I also did not re-run the relogin and liveness SF-M1
  tests, because the round-2 diff touches only the two files above. I did not consult the MT5 docs; no finding depends
  on terminal behaviour.

### Round-2 findings: verdicts

| Finding | Verdict |
|---|---|
| CR2-01 | **Fixed.** After a timed-out wait a fresh same-token call follows, so one lost response is granted by the next call, for an unbounded caller and for a bounded one. In-flight calls are capped at 5. `FIRST_COMPLETED` handles every future in `done`. Stragglers stay in `pending`, go to the hold, and are released only at the end (pinned by M4). The deadline is seeded from the granting call's send (pinned by M2). |
| WR2-01 | **Fixed for a grant that lands 50 to 70 s after its send** (probe rows 0.50 and 0.66). **Not beyond that:** a grant that lands at or after `send + LOST_AFTER` is still fenced with zero renews (LR3-01). |
| IN2-02 | Fixed; it discriminates on `db7fd1316`. |

### Round-1 fixes: no regression

- **CR-01, a hung database stays visible.** One `mt5_xlease_rpc_error` WARNING (`error_logged`), and every timed-out wait
  counts toward the budget (`:767-796`). `test_cr01_a_hung_acquire_…` passes, and the bounded-probe log shows a single
  give-up ERROR.
- **A bounded pending set.** `len(pending) < _MT5_XLEASE_MAX_INFLIGHT` (`:706`). With every call hung, the next call
  only follows the end of a wait, so `asyncio.wait` is never handed an empty set.
- **SF-M1.** `answered` is still set only on a True or False answer (`:742`). The bounded probe with every call hung
  ends `XLeaseUnavailable`, not busy.
- **WR-01, the deadline.** `lead_s` applies to the first sleep only (`:510-518`), and every later sleep and renew is
  still bounded by `lost_at`. A prompt grant still sleeps the full renew interval. All the WR-01 tests pass.

### Checked, no defect

- **A stuck old call lands True after the hold is released.** `release()`'s `finally` attaches the callback to every
  straggler (`:611`), and a done-True straggler fires its callback at once (an extra release, which is idempotent). No
  orphan, provided the response arrives. When it does not arrive, see LR3-02.
- **A straggler lands during the hold.** A same-token acquire only extends `expires_at` (the acquire SQL
  `ON CONFLICT … WHERE l.owner_token = EXCLUDED.owner_token`). A straggler that lands after the fence, on an expired
  row, re-takes it for our own token, and `release()` frees it.
- **Several calls grant in one wait.** `min(granted_sends)` (`:748-750`) is the conservative base. Every granting call
  rewrote `expires_at` from its own transaction start, which is at or after its send. The probe confirms a single
  release frees the row.
- **The cap reached with every call hung.** Each wait times out, counts toward the budget and is followed by the poll
  sleep. No new call is sent until one finishes. Thread use is at most 5 per acquisition, out of the 48 in
  `_DB_EXECUTOR`.
- **The poll sleep between fresh calls.** It replaces the removed `continue`, so calls are spaced at least
  `RPC bound + poll` apart. An answer that arrives during the sleep is read at the next wait (IN3-03).
- **The missing-RPC branch with other calls still pending.** A True in the same wait wins (`:748` precedes `:752`). The
  remaining stragglers get the callback, and the fallback hold receives an empty set (`:757`). This is pinned by
  `test_a_late_grant_…_fallback_…`.
- **Cancellation mid-wait or mid-sleep.** `except BaseException` hands every still-pending call to
  `_release_late_grants`. Futures already taken out of `done` were non-True, because a True breaks first. There is no
  `await` between the `break` and `start_renewing`, or between the return and `mt5_terminal_lease`'s `try`.

### LOW

- **LR3-01: a grant that lands at or after `send + LOST_AFTER` is fenced with zero renews, and the docstring says it
  never is.**
  - Where: `mt5_xlease.py:97-99` (the claim) and `:511-523` (the behaviour).
  - The validator docstring says a late grant "gets its first renew at once … never a fence with no attempt". Once
    `lost_at - now <= 0`, the first sleep is 0 and `sent_at >= lost_at` fences before any renew. The probe's 0.72 row
    shows this. The same row on `095785dfe` also fences, so this is a residual, not a regression.
  - Why not MEDIUM: an unbounded caller can only receive such a grant if every call stalls for 70 s or more and the
    database recovers before the budget gives up at about 75-77 s. A stall a few seconds longer burns the attempt by
    `XLeaseUnavailable` anyway. Bounded callers top out well under 70 s at the defaults: the relogin ceiling is 30 s (`MT5_REQUEST_TIMEOUT_S`), the wizard waits 20 s (`MT5_LEASE_WAIT_S`) and liveness 2 s. Only an env override above 70 s would reach the window. The other route, one old request queued on the
    server for 70 s or more while newer ones are answered, does not fit a FIFO pool.
  - Fix: narrow the docstring to "a grant that lands before its deadline gets one renew with whatever time is left".
    To close the window instead, do the renew inside `acquire_terminal_xlease` before it returns when
    `lost_at - now < _MT5_XLEASE_RPC_TIMEOUT_S`. That is safe because the body has not started: a True re-seeds the
    deadline from the renew's send, and a False or a timeout carries on polling.
- **LR3-02: a straggler that commits after the release but whose response errors leaves the row held for one TTL.**
  - Where: `_late_grant_callback`, `mt5_xlease.py:362`, which returns on `fut.exception() is not None`.
  - This shape has existed on every abandon path since plan 02. Round 2 makes it reachable on the grant path too,
    because stragglers now ride into `XLeaseHold._pending`.
  - It needs the database to execute the request after the hold's release, plus a client-side error (for example
    httpx's 120 s read timeout). It heals on the 90 s TTL.
  - Side effect: the next acquisition by any process meets a refusal, which emits `mt5_xlease_waited`, the event plan
    09 counts as a cross-process collision, with no second holder behind it.
  - Fix: release on an unknown outcome too, and skip only a clean False:
    `if fut.cancelled() or (fut.exception() is None and fut.result() is False): return`. It is safe: the callback is
    only attached once the acquisition or the hold has ended, and the release is token-scoped and idempotent.

### INFO

- **IN3-01: max versus min of `granted_sends`.** Each same-token acquire rewrites `expires_at = now() + ttl`, so the
  latest granting send would also be a safe base, except under a row-lock queue that reorders a transaction with an
  earlier start. `min` avoids that. In the stall case it changes nothing, because the oldest call tends to finish
  first.
- **IN3-02 (migration, out of this diff): a same-token acquire sets `expires_at` unconditionally.** A straggler whose
  transaction began more than 20 s before our last successful renew, and writes after it, could lower the expiry below
  the renew loop's assumption. That needs a stall between `BEGIN` and the row write. `GREATEST(l.expires_at,
  EXCLUDED.expires_at)` on the same-token arm would close it.
- **IN3-03: an extra call after the poll sleep.** The loop top sends a fresh call even when a straggler finished
  during the sleep (`:706`). The extra call joins the hold's `pending`, adding one more straggler (see LR3-02). Checking
  `any(f.done() for f in pending)` first avoids it.
- **IN3-04: `test_cr01_a_hung_acquire_…` pins neither shape now.** Its loosened `1 <= count <= cap` passes with or
  without fresh calls. On `095785dfe` it fails only by `AttributeError`. The pin is carried by the cap test and the
  lost-response test.
- **IN3-05: tight timing margins.** `test_cr2_01_the_renew_deadline_is_seeded_…` expects a fence at about 0.857 s
  against `< 0.9`, about 43 ms of headroom. `test_wr01_…first_tick…` expects about 0.70 s against `< 0.75`. Scheduling
  delay only ever makes a fence later, so these can flake on a loaded runner (the same class as IN2-01).

_Round 3 reviewed: 2026-11-26 · Reviewer: Claude (gsd-code-reviewer) · Depth: standard, with mutation and probe evidence on both trees_

## Round 3 (silent-failure hunter, 2026-11-26)

CRITICAL 0, HIGH 0, MEDIUM 0, LOW 4 (recorded only): a grant older than LOST_AFTER is fenced with no renew (same as LR3-01); the in-flight cap is per acquisition, not per process (pool amplification on a sick database, logged by db_execute's saturation warning); a late call ending in an exception releases nothing (pre-existing, same as LR3-02); attempts counts waits (LR2-04 repeat).

Review loop verdict: round 3 has no MEDIUM+ finding from either reviewer. The LOW and INFO items stay recorded here only (CLAUDE.md rule (a)).
