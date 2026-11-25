# Phase 230: MT5NIGHTLY - Research

**Researched:** 2026-11-25
**Domain:** cross-process serialization of one shared MT5 terminal (Postgres lease behind `mt5_terminal_lease`), plus a read-only clock-switch replay
**Confidence:** HIGH on the code seams and census files (all read this session); MEDIUM on the lease timing constants (derived, not measured); LOW on anything about Railway env spelling or `railway ssh` reach (not readable here)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**D-01 - How the shared MT5 terminal is serialized across processes (MT5D-02)**
- RULED (founder 2026-11-25 UTC, AskUserQuestion, relayed by the coordinator): **"Database lease (Recommended)"**. The option text read, verbatim: "One lease row per terminal in the database (with an expiry and an owner token), taken by every MT5 terminal user: derive, holdings poll, balance sync, key validation. A caller that finds it busy waits or gets the existing 'terminal busy' answer. The runbook already calls for this. It needs a small migration and changes no stored values."
- Rejected alternatives (put to the founder): (B) move MT5 holdings polls onto the backfill worker (claim scope is by kind, not venue, and `validate_key` stays uncovered); (C) move the holdings cron out of the derive window (a schedule bandaid).
- 155.2 freeze: the lease changes no stored values, so it is outside the freeze window.
- Migration lane: serial. migration-reviewer and rls-policy-auditor must be clean, and the migration's timestamp must be the newest at push. 225 PR-2b-2 has a migration in flight, so re-check `supabase/migrations/` on origin/main immediately before the push and re-stamp if needed.

**D-02 - Who runs the MT5D-03 clock replay**
- RULED (founder 2026-11-25 UTC, AskUserQuestion, relayed by the coordinator): **"I run it (Recommended)"**. The coordinator runs the read-only ledger capture on the Railway worker outside 00:40 to 01:40 UTC, then replays it with the existing `analytics-service/scripts/mt5offset_dry_run.py`, putting counts only into records. This phase writes the exact one-shot capture command (read-only, with output kept off tracked files) and the replay steps for the coordinator. **The phase's agents never run the capture.**

**Decided autonomously (reversible technical choices, logged in CONTEXT.md)**
- [Choke point] Inside `services.mt5_concurrency.mt5_terminal_lease`, after the in-process lock is acquired and before the body runs, released in the same `finally`. Every existing site already goes through it, so no second registry is created.
- [Busy behaviour] `wait_s=None` (batch jobs) polls until acquired; `wait_s` a float (interactive validate) raises the existing `Mt5TerminalBusyError` at its bound. The poll interval is a stated constant.
- [Expiry and renewal] The lease row carries an expiry and an owner token. Acquire succeeds when the row is free or expired. The holder renews while the body runs. Release frees only the holder's own token. TTL and renew interval are stated constants, validated at import against each other, following the 227 claim-renewal pattern (`_CLAIM_RENEW_INTERVAL_S`). Exact values are research's.
- [Missing RPC during deploy order] A missing lease RPC (42883 / PGRST202) falls back to the in-process lock only, logs once per process, and stays loud. Any OTHER lease RPC error fails closed for that caller (a batch job retries as transient, interactive answers busy), never proceeds unserialized. Mirrors 227 DEC-08-A.
- [Security] SECURITY DEFINER with a pinned search_path, EXECUTE for service_role only, no anon or authenticated grant, the table RLS-enabled with no browser policy. Holder fields carry an api_key_id or a closed literal only, never a login, server or host.
- [Proof] PROOF-01 per ROADMAP SC-4: a test with two holders contending for one terminal key goes RED on a neutered copy of the cross-process acquire, with its named arm first; restored by `cp` from a byte backup, checked with `cmp`, goes GREEN, recorded verbatim in the plan SUMMARY. The SQL side has a gate in `supabase/tests` with RED-UNDER annotations (acquire exclusivity, expiry takeover, foreign-token release refused, grants).
- [Nights] Counted from the lease fix's backfill-worker deploy; each night reads stored job rows (MT5 `derive_broker_dailies`, `attempts > 1` = 0) and the 227 ledger (MT5 rows in `compute_job_attempt_failures` = 0), marker query first, recorded with its date. The phase never sleeps in a loop.
- [Replay] A read-only capture script handed to the coordinator, kept OUT of the tracked tree, run by base64-exec through `railway ssh` into `quantalyze-analytics-backfill`, output to the coordinator's scratchpad only; write review recorded in the plan SUMMARY; replay steps run `mt5offset_dry_run` once per clock setting the 202 values were written under; attribution compares moved days per scope with 202's recorded moved sets, counts per scope only.

### Claude's Discretion
- Plan split, file placement, RPC and table names, TTL, renew and poll constants, provided they are stated and pinned.

### Deferred Ideas (OUT OF SCOPE)
- Raising retries, the watchdog or any timeout (ROADMAP).
- Moving or rescheduling crons (rejected as a bandaid, D-01 option C).
- The OKX `daily_pnl_non_usd_okx` permanent refusals seen on 11-25 (223/232 territory, not MT5).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MT5D-02 | The named cause of MT5 `derive_broker_dailies` second attempts is fixed at its root, so that over seven consecutive nights every MT5 derive ends `done` with `attempts=1`. Raising retries or a watchdog threshold is not a close. | Sections "Lease design", "Per-site disposition", "Migration", "Proof", "Nightly evidence". The cause (cross-process terminal contention) and the choke point are settled by 230-DISCUSSION-LOG R-3 and CONTEXT D-01. |
| MT5D-03 | The MT5 derive values that moved without explanation are replayed under both server-clock settings, and each moved value is attributed to the clock switch or to another named cause. | Section "MT5D-03 replay": clock history, 202's recorded moved sets by count, the capture contract, the compare rules, and what the replay cannot attribute. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Never dispatch `gsd-*` agents by hand; this research spawned none. `gsd-tools` state handlers clobber STATE and ROADMAP: `git diff` after any handler run.
- CHANGELOG discipline: every ship writes an entry before the push, in the same commit as the VERSION bump; `VERSION` and `package.json` are byte-equal 4-digit strings; never `npm version`. Never write the CI-skip tokens in a commit or PR body, not even to deny them.
- TODOS.md holds open work only: a ship deletes the entries it closes (`175-NIGHTLY-MT5-DERIVE-CHECK` once the seven nights are recorded, `202-MT5-CLOCK-LEAD-01` once MT5D-03 is attributed) in the same PR and names them in the CHANGELOG. LOW/Info review survivors are not booked in TODOS.
- Marker query FIRST before any statement on a database (`current_database()` is `postgres` on both projects). The migration auto-applies TEST then PROD on merge with no human stop, so every review (migration-reviewer, rls-policy-auditor) happens BEFORE the merge.
- A migration may not carry a data-reading `DO` guard (`scripts/lint-migration-data-dependence.mjs`); the self-verify block must be catalogue-only.
- Test-gate integrity: a gate must be able to fail (neuter, see RED, restore from a byte backup, `cmp`, GREEN). Never `git checkout/restore/stash` on uncommitted work. Always `grep -a`. pytest only from `analytics-service/`; never `importlib.reload` in tests.
- Every analytics change passes CI `mypy --strict` over `services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (`scripts/` is ungated).
- Public repo with `.planning/` tracked: no secrets, PROD ids, home paths, hosts, logins, server names or account numbers in any tracked text. Logs and records carry counts only.
- Ship planning guard: a ship branch changes nothing under `.planning`.
- No AI authorship trailers in commits (user memory, 2026-10-20). Banned packages list: none relevant (no new packages in this phase).
- CI census gates move when a gate file or arm is added (listed under "Migration" below). Read live floors by symbol, never from a restated number.

## Summary

The nightly retry is one cause with one choke point. `services/mt5_concurrency.py` `_MT5_TERMINAL_LOCKS` is an `asyncio.Lock` per process; the backfill worker (derive, 00:40Z onward) and the API process (`poll_allocator_positions` holdings, 01:00Z) are two processes that log the ONE gateway terminal into different accounts, and the MT5CONC-02 bracket refuses the derive read, which then retries as transient. All eight production lease sites already pass through `mt5_terminal_lease`, so a database lease taken inside it serializes every site at once. The lease is a table `public.mt5_terminal_leases` (one row per terminal digest) behind three SECURITY DEFINER RPCs (acquire, renew, release), driven by a new leaf client module `services/mt5_xlease.py` that `mt5_terminal_lease` calls.

Four traps decide whether the fix is real. (1) Release must kill the token (set the owner to NULL), not merely expire the row, or a renew RPC that lands after release resurrects the lease for a full TTL. (2) The acquire RPC is idempotent for the same client-generated token and a late-landing acquire (caller timed out or was cancelled while the RPC thread kept running) must be released on completion, or one timeout wedges the terminal for a TTL. (3) The `finally` of `mt5_terminal_lease` is fully synchronous today up to `lock.release()` and the holder read; the DB release is awaited only AFTER those, never before, or a cancellation during the await strands the local lock. (4) The lease key is a digest of `host:port` and each Railway service reads its own env; if the two spellings differ, two rows exist and nothing is serialized. Post-deploy evidence must show both sites on one row (row count check) and the seven-night count must start only when BOTH services run the lease code.

CONTEXT says "no site edits are needed". That holds for the acquire path but not for fail-closed: a lease-unavailable raise at `async with` entry reaches three sites that would mishandle it (the holdings fetcher stamps `str(exc)` into a user-visible `sync_error`; two `process_key` validate arms turn an unhandled exception into a bodyless 500 that reads "do not retry"). The plan must carry three small edits and one `classify_exception` arm (see "Per-site disposition"). MT5D-03 is a count-level replay on the coordinator's capture; by construction it can attribute only the days the 7200-to-`us` switch moves (US summer) and cannot attribute 202's 29 vanished winter rows, which are clock-independent.

**Primary recommendation:** Build `services/mt5_xlease.py` (digest, never-raise bounded RPC client, renew task with self-fence, late-grant release) and call it from `mt5_terminal_lease` with the order "local lock, then DB lease; sync finally, then DB release"; ship migration `mt5_terminal_leases` with a catalogue-only self-verify and a `supabase/tests` gate; add an autouse in-memory-grant default to `tests/conftest.py`; prove it with a two-"process" contention test (separate lock registries, shared fake DB) that goes RED when the cross-process acquire is neutered; count the seven nights from the later of the two service deploys.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Terminal mutual exclusion across processes | Database / Storage (lease row, atomic single-statement RPC) | API / Backend (clients in worker and API process) | Only the database is shared by both Railway services; PostgREST is stateless so a session advisory lock cannot span a hold. `[VERIFIED: grep, no psycopg import under services/ routers/ main*.py]` |
| In-process ordering and FIFO fairness | API / Backend (existing `asyncio.Lock`) | - | Stays first in the order; FIFO inside one process |
| Renewal while the body runs in `asyncio.to_thread` | API / Backend (asyncio task on the same loop) | Database (extends expiry on DB `now()`) | The loop is free while the body awaits the thread; expiry clock is the database's, never the client's |
| Abandoned-thread fencing on lost lease | API / Backend (`bump_mt5_terminal_epoch`) | - | Reuses the D-36 epoch; the lease only adds a second trigger for the bump |
| Holder and site on the row | API / Backend (normalizes) | Database (CHECK shape) | `normalize_mt5_holder` and the closed site set decide; the CHECK is a second line against a raw login or host reaching a row |
| User-facing "terminal busy" answers | API / Backend (existing 424 arms) | - | Unchanged contract; lease-unavailable subclasses busy for bounded callers |
| Seven-night evidence | Database (stored job rows, 227 ledger) | API / Backend logs (positive contention signal) | Clean nights alone are weak evidence (see "Seven nights") |
| Clock replay | Offline script on coordinator scratch | Railway worker host (one-shot capture) | PROD stores no MT5 deal ledger; the capture is the only source |

## Standard Stack

### Core

No new packages. Everything is already in the tree.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| supabase-py (sync client via `services.db.get_supabase`) | pinned in `analytics-service/requirements.txt` | `.rpc(name, params).execute()` for the three lease RPCs | Every other worker RPC goes this way; wrapped by `db_execute` |
| `services.db.db_execute` | in tree | runs the sync call on the bounded 48-thread executor `_DB_EXECUTOR` | `[VERIFIED: services/db.py read]` |
| stdlib `asyncio`, `hashlib`, `uuid`, `random`, `time` | Python (local 3.14.3; CI version not read) | digest, token, jitter, deadlines | no dependency |
| PostgreSQL plpgsql SECURITY DEFINER | Supabase | the three RPCs | house style: `20261124120200_compute_job_claim_renewal.sql` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| pytest 9.0.2 + `asyncio_mode = auto` | local | unit and live-lane tests | `[VERIFIED: pytest --version; analytics-service/pytest.ini]` |
| mypy 2.0.0 `--strict` | local | CI type gate | every new module under `services/` |
| psycopg 3.3.6 | `requirements.txt:181` | test-only live DB probes | only if a two-connection probe is wanted; the PostgREST half needs none |
| node scripts `mutation-runner/run.mjs`, `lint-sql-gates.mjs` | repo | SQL gate censuses | gate file work |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Table lease via RPC | Postgres advisory lock | Rejected: PostgREST gives no session, so a session lock cannot span a multi-second hold and a transaction lock ends at RPC return. The go-live runbook's "advisory lock or equivalent" is satisfied by the lease row. |
| Poll loop | LISTEN/NOTIFY or Realtime | No persistent DB connection exists in the worker; polling at 0.5 s is cheap at O(terminals)=2 rows |
| FIFO waiter slot in SQL | Plain poll | Not recommended in v1: the other process's inter-hold gap includes a claim RPC, a persist and a session build (seconds), against a 0.5 s poll. Revisit only if the lease wait log shows waits near a handler budget (see Pitfall 6). |

**Installation:** none.

**Version verification:** no package added; `npm view` / `pip index versions` not applicable.

## Package Legitimacy Audit

No external packages are installed by this phase. Nothing to check.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 backfill worker process                         API process (main.py + merged worker)
 -----------------------                         -------------------------------------
 derive_broker_dailies (00:40Z..)                poll_allocator_positions (01:00Z..)
 sync_trades balance, heal, scrub                validate wizard, heal, liveness, scrub
        |                                                  |
        v                                                  v
   mt5_terminal_lease(terminal_key, wait_s, holder, site)      (same function, same file)
        |  1. in-process asyncio.Lock (FIFO, wait_s deadline starts here)
        |  2. mt5_xlease.acquire(digest, token, holder, site, remaining deadline)
        |        poll acquire RPC every ~0.5 s (+ jitter) until granted
        |        bounded caller: deadline -> Mt5TerminalBusyError (release local lock, stamp nothing)
        |        RPC errors: tolerated up to a budget, then Mt5TerminalLeaseUnavailableError(Busy)
        |        missing RPC (42883/PGRST202): in-process only, loud, re-logged every 900 s
        |  3. stamp occupancy + holder, start renew task (every 20 s)
        v
   body (await asyncio.to_thread(...)) ........ renew task: renew RPC; False or 70 s without
        |                                        success -> bump epoch (self-fence), mark lost
        v
   finally (SYNCHRONOUS, in this order):
        renew_task.cancel(); bump epoch; end holder; end occupancy;
        lock.release(); after = holder read           <- no await anywhere above
        then:  await mt5_xlease.release(token)        <- bounded, never raises
        then:  handover recorder (existing, after release)
                         |
                         v
            Postgres: public.mt5_terminal_leases (one row per terminal digest)
            acquire / renew / release_mt5_terminal_lease  (SECURITY DEFINER, service_role only)
```

### Recommended Project Structure

```
analytics-service/
  services/mt5_xlease.py              # NEW leaf: digest, backend, acquire poll, renew task, release, missing-RPC latch
  services/mt5_concurrency.py         # edit mt5_terminal_lease only (+ re-exports, + error class)
  services/db.py                      # + is_missing_rpc (home for the predicate; see Don't Hand-Roll)
  services/job_worker.py              # + classify_exception arm (transient)
  services/allocator_positions.py     # + one except arm around the lease entry
  routers/process_key.py              # + Mt5TerminalBusyError in the two validate arms
  tests/test_mt5_xlease.py            # NEW unit + PROOF-01
  tests/test_mt5_xlease_live.py       # NEW lane test (PostgREST answer shapes, two-client exclusivity)
  tests/conftest.py                   # + autouse in-memory-grant default backend
supabase/migrations/<stamp>_mt5_terminal_lease.sql
supabase/migrations/down/<stamp>-rollback.sql
supabase/schema/functions/{acquire,renew,release}_mt5_terminal_lease.sql   # generated: npm run schema:functions
supabase/tests/test_mt5_terminal_lease.sql
```

`mt5_xlease.py` MUST NOT import `services.job_worker` or `main_worker` (leaf invariant, pinned by the subprocess import test in `tests/test_mt5_concurrency.py`). It may import `services.db` (already reached by `services.mt5_handover`) and `services.mt5_client` constants.

### Lease design (settled values)

| Item | Decision | Basis |
|------|----------|-------|
| Table | `public.mt5_terminal_leases(terminal_digest text PK, owner_token uuid NULL, holder text NOT NULL, site text NOT NULL, acquired_at timestamptz NOT NULL, expires_at timestamptz NOT NULL)`; RLS enabled, no policy; no FK; no user column | A user column or FK to `auth.users` would pull the table into the GDPR export census; none is needed (see Migration) |
| Free state | `owner_token IS NULL` or `expires_at <= now()`. Release sets `owner_token = NULL, expires_at = now()` and KEEPS the row (last holder stays readable; cardinality O(terminals)). A released token is dead: a late renew with it matches nothing | Pitfall 1 |
| Digest | `sha256("mt5-terminal-lease/v1\x00" + terminal_key.strip().lower())` hex, 64 chars, CHECK `^[0-9a-f]{64}$` | Never a raw `host:port` on a row. A hash of a low-entropy `host:port` is brute-forceable by anyone who can read the table; the table is service_role-only with RLS and no browser policy, which is the stated control. Lower-casing the host in the DIGEST only (not in the in-process registry key) hardens against case drift between services |
| Holder / site | `normalize_mt5_holder(holder)` and the closed site set (`_normalize_site`, currently private to `services/mt5_handover.py`; export a public name rather than import the underscore) before the RPC. SQL CHECK on `holder`: one of the four literals or a canonical lower-case UUID; CHECK on `site`: `^[a-z_]{1,48}$` (shape only, so a new Python site needs no migration) | `mt5_handover` redaction rule; digit-only holders are refused by the CHECK |
| `acquire_mt5_terminal_lease(p_terminal_digest text, p_owner_token uuid, p_holder text, p_site text, p_ttl_s integer) RETURNS boolean` | One `INSERT ... ON CONFLICT (terminal_digest) DO UPDATE ... WHERE owner_token IS NULL OR expires_at <= now() OR owner_token = EXCLUDED.owner_token`; `GET DIAGNOSTICS` row count = 1. Idempotent for the same token (a retried acquire whose answer was lost succeeds). `p_ttl_s` validated `BETWEEN 1 AND 900`; digest, holder, site shape validated; bad input raises `invalid_parameter_value` | Single statement under the row lock: a concurrent first INSERT blocks on the unique index, then re-evaluates the WHERE on the committed row (READ COMMITTED; the Phase 191 live probe in `test_compute_job_metadata_merge_live.py` demonstrates the same rule `[CITED: that file's docstring]`) |
| `renew_mt5_terminal_lease(p_terminal_digest text, p_owner_token uuid, p_ttl_s integer) RETURNS boolean` | `UPDATE ... SET expires_at = now() + ttl WHERE terminal_digest = ... AND owner_token = p_owner_token`; true iff a row matched. Matches regardless of expiry (an expired-but-untaken lease is renewable; once anyone else takes it the token no longer matches) | Race-free: both statements key on the row |
| `release_mt5_terminal_lease(p_terminal_digest text, p_owner_token uuid) RETURNS boolean` | `UPDATE ... SET owner_token = NULL, expires_at = now() WHERE ... AND owner_token = p_owner_token`; true iff matched. A foreign token changes nothing | Pitfall 1 |
| Expiry clock | DB `now()` (each RPC is its own transaction). Client deadlines use `time.monotonic()` | No client clock skew between the two Railway services |
| TTL | `_MT5_XLEASE_TTL_S = 90.0` | ties the crash-recovery worst case (another process waits at most ~90 s after a crash) to the heartbeat's own 90 s STALE threshold |
| Renew interval | `_MT5_XLEASE_RENEW_INTERVAL_S = 20.0` (about 4.5 renews per TTL) | |
| Renew RPC bound | `_MT5_XLEASE_RPC_TIMEOUT_S = 15.0`, applied to EVERY lease RPC (the PostgREST session timeout is 120 s `[CITED: services/db.py, db_read_with_retry docstring, measured 2026-10-21]`, so an unbounded call would hold a pool thread for 2 minutes) | |
| Poll interval | `_MT5_XLEASE_POLL_S = 0.5` plus `random.uniform(0, 0.25)` jitter; bounded callers sleep `min(poll, remaining)` | a waiting process issues about 2 RPC/s; at most a handful of waiters |
| RPC error budget | `_MT5_XLEASE_ERROR_BUDGET_S = 60.0` of consecutive RPC errors before a batch caller raises; a bounded caller keeps polling to its own deadline then raises busy | a PostgREST blip must not burn a derive attempt (that is the quantity the seven nights count) |
| Self-fence | derived `TTL - RENEW_INTERVAL = 70 s` without a successful renew | monotonic clock; fires while the lease is still ours |
| Import-time validation | raise `ValueError` unless `0 < poll < renew < ttl`, `rpc_timeout < renew`, `ttl >= 2*renew + rpc_timeout` (55 < 90 holds) | mirrors `_validate_claim_renew_interval` `[VERIFIED: main_worker.py:~440-460]`; plain constants, no env override (the 227 pattern) |

### Pattern 1: order of operations inside `mt5_terminal_lease`

**What:** local lock, then DB lease, then stamps; a synchronous finally; DB release last.
**When to use:** always; this is the only shape that keeps the existing cancellation guarantees.

```python
# Design-level skeleton [ASSUMED shape; every name outside this file is quoted from the repo below]
lock = _mt5_terminal_lock_for(terminal_key)
queued_at = time.monotonic()
# ... existing local acquire, unchanged (wait_for(lock.acquire(), wait_s) -> Mt5TerminalBusyError) ...

xlease = None
try:
    # ONE deadline across both stages: the DB stage gets what is left of wait_s.
    remaining = None if wait_s is None else max(0.0, wait_s - (time.monotonic() - queued_at))
    xlease = await acquire_cross_process(
        terminal_key, holder=normalize_mt5_holder(holder), site=site, bound_s=remaining,
        on_lost=lambda: bump_mt5_terminal_epoch(terminal_key),
    )   # None => in-process only (missing RPC); raises Mt5TerminalBusyError at the bound
except BaseException:
    lock.release()          # we hold the local lock, never held the terminal: release, stamp NOTHING
    raise
token = begin_mt5_lease_occupancy(terminal_key)
holder_token = begin_mt5_lease_holder(holder)
before = mt5_terminal_holder(terminal_key)
try:
    yield
finally:
    if xlease is not None:
        xlease.stop_renewing()            # sync: task.cancel(), not awaited
    bump_mt5_terminal_epoch(terminal_key)
    end_mt5_lease_holder(holder_token)
    end_mt5_lease_occupancy(token)
    lock.release()
    after = mt5_terminal_holder(terminal_key)      # no await between release and this read
    if xlease is not None:
        await xlease.release()                      # bounded, NEVER raises Exception
    if after is not None and after != before:
        await record_mt5_terminal_handover(...)     # unchanged, still after release
```

Why local release precedes the DB release: today there is no `await` before `lock.release()` and none between the release and the holder read `[VERIFIED: services/mt5_concurrency.py:470-503]`. An `await` earlier in the `finally` can be cancelled and strand the local lock for every caller in the process. An in-process successor that wins the local lock then waits one poll for the DB row; that is safe and costs at most about 0.75 s.

### Pattern 2: acquire is never a bare `wait_for` around the RPC

`db_execute` runs the call on a thread; `asyncio.wait_for` cancels the awaiting future but the thread keeps running, and the RPC may commit after the caller gave up. Use a client-generated token, run the RPC future under `asyncio.shield`, and on a timeout or cancellation attach a done-callback to the in-flight future: if it later completes with `True`, issue `release(token)` (idempotent; a release that finds no row is a no-op). Keep a module-level set of those cleanup tasks so they are not garbage collected. Without this, one slow acquire wedges the terminal for the full TTL. `[ASSUMED: asyncio/run_in_executor semantics, consistent with services/db.py's own comment on zombie threads]`

### Pattern 3: renewal that cannot reach the crash handler

The renew loop is a background task (a raising task reaches `main.lifespan`'s crash handler, which stops dispatch, as the existing never-raises comment in `mt5_concurrency` records). Wrap the loop body in a single `try/except Exception` that logs counts only and keeps looping; let `CancelledError` through. Each tick: `renew` RPC bounded by `_MT5_XLEASE_RPC_TIMEOUT_S`. Result `False`, or `monotonic() - last_success >= TTL - RENEW_INTERVAL` (70 s): log one `mt5_xlease_lost` error (no key, no host), call `on_lost` (bump the terminal epoch, so the body's NEXT session touch is refused by `Mt5Client._assert_live` with `Mt5SessionAbandoned`), set `lost`, and stop. A missing renew RPC (the migration was rolled back while holding) logs and stops renewing without bumping. The body runs in `asyncio.to_thread` and the event loop stays free, so the renew task runs during a hold; the post-read CPU work is already outside the lease.

If the holder's DB lease expires while its thread still runs (renewals failed for longer than TTL, or the loop stalled): the self-fence has already bumped the epoch at 70 s, so the zombie's next touch is refused (D-36 mechanism, `[VERIFIED: mt5_client.py:2536-2580 _assert_live lazy bind]`). Caveat recorded: the bind is lazy, so a lease lost BEFORE the body's first touch binds the new generation and is not fenced; that window is at most one poll plus one login and the MT5CONC-02 bracket still refuses a wrong-account read.

### Anti-Patterns to Avoid
- **A second `dict[str, asyncio.Lock]` or a second lease helper.** The module docstring forbids it and `test_lease_is_backed_by_the_one_registry` reds on it. The cross-process step lives inside the one lease.
- **Awaiting the DB release before `lock.release()`.** See Pattern 1.
- **Expire-only release.** Pitfall 1.
- **Writing `host:port` or any login/server to the row, a log line or an exception message.** Digest only; `Mt5TerminalBusyError` already carries nothing.
- **Letting an RPC error fall through to "proceed unserialized".** Only a missing RPC (42883 / PGRST202) falls back, loudly.
- **Calling `mt5_terminal_lease` twice in one function with one client** (`test_no_production_function_holds_two_terminal_leases`): unchanged by this phase.

## Per-site disposition (all eight production sites)

`[VERIFIED: grep of mt5_terminal_lease( in services/ routers/ ingestion; sites roster read at tests/test_mt5_concurrency.py:1025-1041]`. Two new outcomes exist: **Busy** (bounded caller, deadline, or DB error to deadline) and **Unavailable** (`Mt5TerminalLeaseUnavailableError`, raised for unbounded callers after the 60 s RPC-error budget). Make `Mt5TerminalLeaseUnavailableError` a SUBCLASS of `Mt5TerminalBusyError`, with a fixed message carrying nothing: every existing `except Mt5TerminalBusyError` arm (wizard, heal, liveness) then treats a DB outage as busy with no edit, and unbounded callers (which never catch busy) see a plain exception.

| # | Site (file:function) | `wait_s` | Today | With the lease | Edit needed |
|---|----------------------|----------|-------|----------------|-------------|
| 1 | `services/job_worker.py:run_derive_broker_dailies_job` | None | lease entry sits OUTSIDE the inner `try` whose arms start at `except asyncio.TimeoutError` (arms at about lines 7825-8048); an entry raise reaches the dispatch catch-all and `classify_exception` | Busy cannot occur. Unavailable falls to `classify_exception` | `classify_exception` arm returning `("transient", <fixed text>)` (otherwise `unknown`) |
| 2 | `services/job_worker.py:_fetch_mt5_account_balance` | None | `except (asyncio.TimeoutError, Exception)` logs "continuing without a balance snapshot", returns None `[VERIFIED: job_worker.py:874-880]` | Unavailable is swallowed the same way; sync continues without a balance snapshot | none |
| 3 | `services/allocator_positions.py:_fetch_mt5_account_rows` | None | entry raise propagates to `fetch_allocator_holdings`; the handler's generic `except Exception` arm stamps `classify_exception`'s `str(exc)` into the allocator-visible sync error (the dedicated `AllocatorHoldingsSyncTransientError` arm exists precisely to keep non-user copy out; `[VERIFIED: job_worker.py:15114-15125 comment]`) | Unavailable would leak infrastructure text to a user-visible column | ONE `except Mt5TerminalBusyError as exc: raise AllocatorHoldingsSyncTransientError(MT5_UNREACHABLE_NOTE) from exc` around the `async with` |
| 4 | `services/ingestion/mt5.py:validate` (validate_worker) | None | called from `routers/process_key.py` request handlers (two `adapter.validate` call sites at about lines 1167 and 2069), whose only arm is `Mt5SessionAbandoned`; any other exception is an unhandled bodyless 500 that STATUS_CONTRACT R-1 reads as "service-permanent, do not retry" `[VERIFIED: process_key.py:1166-1215 comment]` | Unavailable (and a long cross-process wait) would hit that 500 | add `Mt5TerminalBusyError` to both arms, answering the arms' existing 424 `NETWORK_UNAVAILABLE` envelope. No new user code |
| 5 | `routers/exchange.py:_validate_mt5_key_probe` (wizard) | `_MT5_LEASE_WAIT_S` | `except Mt5TerminalBusyError` -> 424 `MT5_TERMINAL_BUSY` `[VERIFIED: exchange.py:1679-1740]` | DB busy and DB-outage both land here | none |
| 6 | `services/mt5_relogin.py:heal_mt5_terminal_session` | bounded | busy = designed skip ("a busy terminal is a terminal somebody is already successfully using"), except while a relaunch debt is owed | cross-process busy and DB-outage both skip. A DB outage makes every heal tick a skip: acceptable, the lease logs the outage loudly | none |
| 7 | `services/mt5_validation_liveness.py:probe_validation_terminal` | bounded | `except Mt5TerminalBusyError` -> `KIND_BUSY_SKIP`; `classify_reading` maps `busy_skip` and `probe_failed` (code None) to `not_measured`, never `authorized` `[VERIFIED: mt5_session_episodes.py:897-935]` | same | none. Note the outage tracker pages on a run of non-authorized readings, so a long DB outage can page; consistent with an outage |
| 8 | `services/mt5_terminal_scrub.py:scrub_validation_terminal` | None | wrapped in `except Exception as lease_error`: logs, `_alert_scrub_failed`, records a failed scrub | Unavailable is recorded as a failed scrub (owed scrub stays owed) | none |

This corrects CONTEXT's "no site edits are needed": three small edits (rows 3 and 4 x2) plus the classify arm. Tests: one per edit, each RED when the arm is removed.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Missing-RPC detection | a message-substring match, or an import of `main_worker._is_missing_rpc` | a new `is_missing_rpc(exc)` in `services/db.py` using structured `.code` / `.details["code"]` equal to `"42883"` (`_SQLSTATE_UNDEFINED_FUNCTION`, `main_worker.py:558`) or `"PGRST202"` (`_POSTGREST_UNDEFINED_FUNCTION: Final = "PGRST202"`, `main_worker.py:703`); a parity test across the same exception-shape matrix as `test_main_worker.py` pins it against `main_worker._is_missing_rpc` | `mt5_concurrency` is a pinned leaf and `main_worker` imports `job_worker` and half the service, so importing it is a cycle. `services/db.py` is already reached by the leaf. Leave `main_worker` untouched (Rule 3); the twin is pinned by the parity test, the repo's usual shape |
| Redaction of holder / site | a new normalizer | `normalize_mt5_holder` and the closed site set in `services/mt5_handover.py` (export `normalize_mt5_site` publicly rather than import `_normalize_site`) | one source of truth for what may reach a row |
| Import-time interval validation | ad-hoc asserts | a `_validate_xlease_timing()` modelled on `_validate_claim_renew_interval` | the 227 pattern, raised at import |
| Test reset | a hand-rolled `.clear()` | extend `reset_terminal_state_for_tests()` (the one reset) to reset the xlease latch, relog clock and cleanup-task set | the file's own instruction |
| Terminal identity | a second spelling of `host:port` | `mt5_terminal_key(host, port)` / `Mt5Client.terminal_key` (the property delegates to the module function `[VERIFIED: mt5_client.py:354-374, 3881-3899]`) | two spellings serialize nothing |

**Key insight:** serialization bugs here are all "two copies of the identity" bugs (two registries, two key spellings, two lease helpers). Every item above keeps exactly one copy.

## Runtime State Inventory

Not a rename/refactor/migration phase. One related fact the planner must carry: per-process terminal registries (`_MT5_TERMINAL_HOLDERS`, `_MT5_TERMINAL_HISTORY_SETTLED`, relaunch debt, scrub owed) stay in-process after this phase. The lease serializes access but does not make those registries cross-process (the existing `HANDOVER_ATTRIBUTION_LIMIT` text says so). After the other process moves the terminal, this process may believe a key is still "settled" and skip the history wait (`mt5_history_wait_due`, `mt5_client.py:941-962`). That gap exists today and is not widened; it is booked as Open Question 5, not fixed here. The kept-row design (release NULLs the owner but keeps `holder`) leaves the hook for a later "someone else held since my record" invalidation.

## Common Pitfalls

### Pitfall 1: a released lease is resurrected by a late renew
**What goes wrong:** release only sets `expires_at = now()`; a renew RPC already in flight in its thread then matches the token and sets `expires_at = now() + 90 s`. The terminal looks held for 90 s with nobody using it.
**Why it happens:** `stop_renewing()` cancels the asyncio task but not the executor thread, and renew matches on token regardless of expiry.
**How to avoid:** release sets `owner_token = NULL`; renew requires `owner_token = p_owner_token`. Gate arm: renew after release returns false and the row stays free.
**Warning signs:** a lease row with a recent `expires_at` and no live holder.

### Pitfall 2: a timed-out acquire wedges the terminal for a TTL
**What goes wrong:** the acquire RPC commits after the caller gave up (timeout, cancel, bound expiry); nobody owns the token locally and nobody releases it.
**How to avoid:** Pattern 2 (shield, late-grant release callback, same-token idempotent acquire). Test arm: acquire slower than its bound; after the late success `release` was called with that token.

### Pitfall 3: DB release awaited before the local release
**What goes wrong:** cancellation during the await skips `lock.release()`; every later caller in the process hangs.
**How to avoid:** Pattern 1 order. Test: cancel a holder while the DB release is pending; the local lock is released and the next acquire in the process succeeds.

### Pitfall 4: lease key spelled two ways
**What goes wrong:** the backfill service and the API service read their own `MT5_GATEWAY_HOST` / `MT5_GATEWAY_PORT`. A different spelling (case, trailing dot, an address instead of a name) gives two digests, two rows, and the lease serializes nothing, while every lock "works".
**Why it happens:** the key is `f"{host}:{port}"` of whatever each service's env holds `[VERIFIED: mt5_client.py:354-374]`. Whether the two env values are equal on Railway cannot be read here. `[ASSUMED: equal; not verified]`
**How to avoid:** digest the stripped, lower-cased key. Post-deploy check: `SELECT count(*) FROM public.mt5_terminal_leases` must read exactly the number of distinct terminals (the job terminal and the validation terminal, which uses `MT5_VALIDATION_GATEWAY_HOST/PORT`, so 2); 3 or more means a spelling split. Put this in the evidence query and in the plan's checkpoint.

### Pitfall 5: night 1 counted before the API service runs the lease code
**What goes wrong:** the holdings poll is a job of the API process. If only the backfill service has the new code, the contested 01:00Z window is unprotected and the night proves nothing.
**How to avoid:** night 1 is the first 00:40Z derive after BOTH services run lease code AND the migration is applied. CONTEXT's wording ("from the lease fix's backfill-worker deploy") is amended to `max(backfill deploy, API deploy)`; read both deployment creation times from Railway (coordinator).

### Pitfall 6: waiting inside a handler budget converts one retry into another
**What goes wrong:** a cross-process wait now sits inside the waiter's job timeout. `TIMEOUT_PER_KIND["poll_allocator_positions"]` is `3 * 60` and `["derive_broker_dailies"]` is `15 * 60` `[VERIFIED: job_worker.py:1005, 1009]`. The longest legitimate hold is the derive's fresh read: `mt5_derive_read_bound_s(read_s=_MT5_DERIVE_READ_TIMEOUT_S, wait_s=_MT5_HISTORY_WAIT_S, fresh=True)` = (30 + 10) + 30 + 30 = 100 s `[VERIFIED: mt5_concurrency.py:91-92, 110, 116, 148 and MT5_REQUEST_TIMEOUT_S default 30 at mt5_client.py:262]`, plus the 10 s restart bound (`_MT5_RESTART_TIMEOUT_S`) = at most about 110 s. One such hold leaves a holdings poll about 70 s of its 180 s. The poll is not FIFO-protected (the DB poll has no queue), so a waiter can in principle lose several gaps in a row.
**Why it is judged acceptable in v1:** MT5 derive jobs run about 8 to 11 per night spread across about an hour (R-1/R-3), each hold is typically 10 to 60 s, and the other process's inter-hold gap includes a claim RPC, a persist and a session build (seconds) against a 0.5 s poll.
**How to avoid / detect:** log every cross-process wait over the existing 0.5 s threshold with `site` and `duration_ms` (counts only); add `poll_allocator_positions` `attempts > 1` as a GUARD metric to the seven-night read (it must not rise). If a wait approaches 150 s, add the single-slot waiter reservation (a `waiter_token`, `waiter_until` pair on the same row, granted before a releaser's immediate re-acquire) as a follow-up, not before.

### Pitfall 7: tests that drive the real lease reach a real project
**What goes wrong:** about 17 test modules drive the real lease (`grep -c mt5_terminal_lease tests/*.py`). With the RPC inside the lease, each would call `get_supabase()`.
**How to avoid:** an autouse fixture in `tests/conftest.py`, modelled on `_handover_recorder_never_reaches_a_real_project` (`conftest.py:128-152`), that installs an in-memory backend which GRANTS every acquire (not a refusing sink: a refusing sink would make the lease fail closed and break every lease test). Tests that are ABOUT the lease re-bind their own backend (this fixture runs first, so theirs wins). Extend `reset_terminal_state_for_tests()` for the new module state.

### Pitfall 8: the PROOF-01 test is green when neutered
**What goes wrong:** two holders in one event loop share `_MT5_TERMINAL_LOCKS`, so the in-process lock already serializes them and the test stays green with the cross-process acquire removed.
**How to avoid:** the two "processes" get SEPARATE lock registries over ONE shared fake database (see Proof).

### Pitfall 9: `now()` is frozen inside one transaction
**What goes wrong:** a SQL gate arm that tries to test expiry with `pg_sleep` inside one `DO` block never sees time advance (`now()` = transaction start).
**How to avoid:** backdate directly: `UPDATE public.mt5_terminal_leases SET expires_at = now() - interval '1 second' WHERE terminal_digest = ...` (scoped to the arm's own digest), then call the RPC.

### Pitfall 10: restamping the migration breaks the gate's annotations
**What goes wrong:** `RED-UNDER-SETUP` and `RED-UNDER-M` strings name the migration FILE by path. A re-stamp at push (D-01 requires the newest timestamp) leaves them pointing at a file that no longer exists.
**How to avoid:** choose the final stamp last; a restamp edits the migration file name, the gate's annotations, the down file name and header, and the generated mirror headers in one commit, then `node scripts/mutation-runner/run.mjs --parse-only` exits 0.

## Migration

**Newest on origin/main today:** `20261125132334_api_keys_venue_server_owner_read.sql` `[VERIFIED: git ls-tree origin/main supabase/migrations/ after git fetch; origin/main 91f5023e0]`. A stamp of `20261126120000` sorts after it; Phase 225 PR-2b-2 has a migration in flight, so re-run `git ls-tree --name-only origin/main supabase/migrations/ | sort | tail -3` immediately before the push and re-stamp if needed (Pitfall 10).

**Conventions to copy from `20261124120200_compute_job_claim_renewal.sql` `[VERIFIED: read in full]`:** header with decisions and rejected options; `SET LOCAL lock_timeout = '3s'`; no explicit transaction statements; `SECURITY DEFINER` and `SET search_path = public, pg_catalog`; `COMMENT ON FUNCTION`; `REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role`; a CATALOGUE-ONLY `DO $verify$` block with one `IF v_... THEN RAISE EXCEPTION` per clause (so a mutation twin can stand down exactly one clause and let the gate, not the apply, go RED). For the table: `ENABLE ROW LEVEL SECURITY` with no policy, `REVOKE ALL ON TABLE ... FROM PUBLIC, anon, authenticated` explicitly (Supabase default privileges grant new public tables to anon/authenticated/service_role; `scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql` models that), and `GRANT SELECT` to service_role only (diagnostics; the 227 ledger precedent says "service_role holds SELECT only"). The verify block asserts: the three functions exist with these exact signatures and return `boolean`; all `prosecdef` with the exact `search_path=public, pg_catalog` pin; no EXECUTE for PUBLIC/anon/authenticated and EXECUTE for service_role; table RLS on; no privilege for anon/authenticated on the table; the digest CHECK exists. It reads NO row (`lint-migration-data-dependence.mjs`). Add no `cron` schedule call: a lease has no pruning need (O(terminals) rows) and a raw-text "schedules nothing" census exists for sibling phases (`src/__tests__/jobledger-migrations-schedule-nothing.test.ts`); a twin for this migration is optional.

**Rollback:** `supabase/migrations/down/<stamp>-rollback.sql`, same structure as `down/20261124120200-rollback.sql` (manual, off the auto-apply path; marker query first; ledger row note; worker tolerates the missing RPC by the fallback, so no worker rollback order is needed, and say so).

**Gate:** `supabase/tests/test_mt5_terminal_lease.sql`. Apply list is minimal: `scripts/pg-lane/fixtures/01-fixture-core.sql`, `scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql`, then the migration `[VERIFIED: the shortest existing RED-UNDER-SETUP line in supabase/tests reads {"apply":["scripts/pg-lane/fixtures/01-fixture-core.sql","scripts/pg-lane/fixtures/07-fixture-supabase-default-privileges.sql","supabase/migrations/20260919120000_strategy_sync_cursors.sql"]}]`. Suggested arms (each `BEGIN; DO $$...$$; ROLLBACK;`, calls under test inside an inner `BEGIN ... EXCEPTION` that only captures the SQLSTATE, the arm's RAISE after the block per lint rule R1, assertions scoped to the arm's own digest; every arm carries `RED-UNDER:` prose and a `RED-UNDER-M:` JSON twin whose mutation also stands down the matching self-verify clause, as R2/R3 of the 227 renewal gate do):
- L1 exclusivity: second token refused while unexpired; same token re-acquire idempotent.
- L2 expiry takeover: backdate, new token takes it; old token's renew then returns false.
- L3 foreign release refused: row unchanged, returns false; own release frees; next acquire true.
- L4 renew: own token extends; foreign false and row unchanged; renew after release false (Pitfall 1).
- L5 input validation: non-hex digest (e.g. a `host:port` string), ttl 0 or 901, NULL token each raise `invalid_parameter_value`; no row written.
- L6 grants: anon and authenticated cannot EXECUTE or touch the table; service_role EXECUTE yes, no INSERT/UPDATE/DELETE on the table; `proconfig` pins search_path; RLS on.
- L7 distinct digests independent.
- L8 holder CHECK refuses a digit-only holder and a `host:port` string; accepts the four literals and a canonical UUID.
Because arms backdate with a scoped `UPDATE`, run `analytics-service/tests/test_sql_gate_scoped_updates.py` and add the file's measured count to `_EXPECTED_MATCH_COUNTS` (227 plan 10 did this for `test_reset_stalled_bridge_provenance.sql`).

**Censuses a new gate file and function set move.** Read each live value by running the check; the 227 commit `d04ef47c1` shows which files moved `[VERIFIED: git show d04ef47c1 read]`. Do not restate numbers.
| Census | How to read it | File |
|--------|----------------|------|
| mutation floors `FILES_FLOOR`, `ARMS_FLOOR`, `WAIVED_CEILING` (must stay 0) | `grep -nE '^export const (FILES_FLOOR\|ARMS_FLOOR\|WAIVED_CEILING)' scripts/mutation-floors.mjs` (read this session: 93 / 1021 / 0) and `node scripts/mutation-runner/run.mjs --parse-only` | `scripts/mutation-floors.mjs` |
| floor restatements | pin tests read live values and fail with the measured number | `src/__tests__/gate-family-meta.test.ts` (`KNOWN_THRESHOLD_SITES` strings), `src/__tests__/mutation-annotation-parser.test.ts` (`armsSeen`, `stepsSeen`, `needles.length`, `corpus.filesTotal`, `corpus.filesAnnotated`, the by-name list), `src/__tests__/mutation-runner-floors.test.ts` |
| SQL gate file count | `node scripts/lint-sql-gates.mjs` (read this session: `scanned 120 file(s)`) | `src/__tests__/lint-sql-gates.test.ts` |
| anti-skip sentinels | the gate file must declare its own first `ALL N ARMS EXECUTED` sentinel; `SENTINEL_FLOOR` / `ARMS_FLOOR` and the table comment | `.github/workflows/ci.yml` (sql-tests step), `src/__tests__/drift-check-scripts.test.ts`, `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` (re-derives them) |
| scoped UPDATE count | `analytics-service/tests/test_sql_gate_scoped_updates.py` | same |
| function mirror | `npm run schema:functions` regenerates `supabase/schema/functions/*.sql` (three new files) | `scripts/dump-sql-functions.ts` |
| function name-set ratchet | three `snapshot-only` rows in `NAME_SET_RATCHET`, cleared by the first re-dump taken after PROD applies (227 did exactly this); do NOT add an allowlist row | `scripts/dump-sql-functions.ts` |
| compared-function floor | `COMPARED_FLOOR` (read this session: 144) moves by +3 | `scripts/baseline-content-drift-check.mjs` (`grep -n 'COMPARED_FLOOR = '`) |
| TS database types | hand-add the table and three function signatures (227 did, with a dated note that a regen against PROD drops them until PROD applies) | `src/lib/database.types.ts` |
| GDPR export census | none expected: the table has no `user_id`, no FK to `auth.users` or `profiles`. Prove it by running `npx tsx scripts/check-gdpr-export-coverage.ts` | - |
| baseline replay | the python lane replays migrations newer than its dump (CLAUDE.md D-F; `scripts/check-baseline-currency.mjs --replay-set`), so the live-lane test can call the RPCs; shared-TEST restore still refuses a dump older than the migrations | no edit |

## Proof (PROOF-01)

**How the existing tests fake things** `[VERIFIED: tests/test_mt5_concurrency.py read at 300-460, 1025-1170]`: the real `mt5_terminal_lease` runs over the module's real `_MT5_TERMINAL_LOCKS`; oracles are blocking behaviour (event ordering of two `gather`ed holders, elapsed time against a bound, `lock.locked()` observed from outside); an autouse fixture calls `reset_terminal_state_for_tests()` around every test; roster pins walk production source by `ast`. 36 tests in that file pass locally in about 21 s (`python3 -m pytest tests/test_mt5_concurrency.py -q`).

**Two-holder contention test (unit, no DB).** `tests/test_mt5_xlease.py`, first arm named `XPROC-01 two holders, two lock registries, one database`:
1. A `FakeXLeaseBackend` implements `acquire/renew/release` over ONE dict with the same semantics as the SQL (free = owner None or expired by an injectable clock; same-token acquire idempotent; release NULLs the owner).
2. Simulate two processes inside one event loop: a `ContextVar("proc")`; patch `mt5_concurrency._mt5_terminal_lock_for` with a factory that returns `registries[proc.get()].setdefault(key, asyncio.Lock())`; start holder A and holder B as two `asyncio.create_task`s (each task copies its context, so each sees its own `proc`). The two holders therefore have DIFFERENT local locks and can only exclude each other through the shared fake database.
3. Oracle: ordering. `events == ["a-enter", "a-exit", "b-enter", "b-exit"]` with a real `await asyncio.sleep` inside each body.
4. Neuter (PROOF-01): `cp -p` backup, then make `FakeXLeaseBackend.acquire` (or `mt5_xlease.acquire_cross_process`) always grant, run, record the RED with `XPROC-01` first, `cp` back, `cmp`, GREEN. A second neuter at the call site (skip the `acquire_cross_process` call in `mt5_terminal_lease`) must also go RED, so both the client and the wiring are covered.
Further arms: bounded caller times out to `Mt5TerminalBusyError` with the local lock released and nothing stamped (existing test `test_lease_bound_expiry_raises_busy_and_never_acquires` must still pass with the null default); `wait_s` is one deadline across both stages; batch caller tolerates RPC errors under the budget then raises `Mt5TerminalLeaseUnavailableError`; missing RPC falls back and re-logs on the 900 s clock (inject the clock); late-grant release (Pitfall 2); cancel during the DB release leaves the local lock free (Pitfall 3); renew `False` and a 70 s no-success both bump the epoch and the body's next `Mt5Client` touch is refused; digest is stable, hex-64, contains no `host`/`port` text, and two spellings differing only in case/whitespace collapse; import-time validation raises on each broken inequality; lease-unavailable maps to transient in `classify_exception`; the three site edits.

**Does it need a real database too?** The fake can drift from the SQL. Add `tests/test_mt5_xlease_live.py`, modelled on the PostgREST half of `tests/test_compute_job_metadata_merge_live.py` `[VERIFIED: read]`: it reads `SUPABASE_TEST_URL` / `SUPABASE_TEST_SERVICE_KEY` (the lane's values in CI), skips locally when unset and FAILS when unset with `CI == "true"`, and uses a random digest per test (own rows only; the table is shared with other jobs on shared TEST but the lane is private). Arms: the three RPCs return Python `True`/`False` through real PostgREST (answer shapes the client relies on); N threads each with their own client contend for one digest and exactly one wins per round (`concurrent.futures`, as the 191 module does); a 1 s TTL expires and is taken over; a foreign release is refused. The python CI job runs pytest against a lane private to its runner (`pytest -n auto --dist loadgroup ...`, `.github/workflows/ci.yml`, step near line 5919) and the conftest content scan puts any module naming `SUPABASE_TEST_URL` into the `shared_test_db` xdist group automatically. This module is a SHOULD, the SQL gate is the MUST.

## MT5D-03 replay

### Clock history (the repo's record, not a read of Railway)
`[CITED: .planning/milestones/v1.21-phases/202-.../202-05-SUMMARY.md:179-183; CHANGELOG.md [0.133.18.4]; 175-VERIFICATION.md lines 57, 71]`: the fixed integer **10800** from go-live to 2026-11-01T07:11Z, the fixed integer **7200** from 2026-11-01T07:11Z, then the rule `us` set on the backfill service at 2026-11-03T13:38:28Z and on the API service at 2026-11-03T13:38:36Z (`MT5_SERVER_UTC_OFFSET_S` deleted on both). Under `us` the broker clock is +3 h in US summer and +2 h in winter; the 2026 dates are 2026-03-08 07:00Z to 2026-11-01 06:00Z `[VERIFIED: services/mt5_server_clock.py module docstring]`. So fixed 7200 and `us` agree in winter and differ in summer by one hour of the deal's day boundary; fixed 10800 and `us` agree in summer and differ in winter.

### Which legacy offset per 202 pair
From 202-05's derive-timestamp lines `[CITED: 202-05-SUMMARY.md gc-c-codepath-derive and xcheck lines]`: the b0 derives of s6, s9, s10 ran on 2026-11-02 (after 07:11Z on 11-01, before the switch) so they were written under **7200**; their b1 derives ran 2026-11-06 under `us`. The c0 side of s2, s5, s8, s13 was derived 2026-11-03 before 13:38Z (`older_derive=before_switch`), so **7200**; c1 after the switch, `us`. Every derive rewrites the full history, so no scope still carries 10800 rows. Therefore the replay is ONE fold per key: `--legacy-offset-s 7200 --rule us`. An optional second run with `--legacy-offset-s 10800` is a control only (it shows the winter moves that no 202 pair can contain).

### 202's recorded moved sets (counts, from the tracked records)
`[CITED: 202-07-SUMMARY.md gc-c-c01-diff lines; 202-05-SUMMARY.md xcheck lines; 202-REPORT.md]`

| Pair | Scope | Moved values | Notes |
|------|-------|-------------|-------|
| b0 to b1 | s6 | 31 | all in US summer (aggregate statement for the three) |
| b0 to b1 | s9 | 24 | 24 of 120 active summer days changed, 0 of 36 active winter |
| b0 to b1 | s10 | 17 | sum 72 |
| c0 to c1 | s2 | 24 | first changed 2025-10-30, last 2026-08-08; plus **29 vanished rows**, 2025-11-17 to 2025-12-15, all US winter (15 nonzero) |
| c0 to c1 | s5 | 21 | first 2026-03-25, last 2026-10-01 |
| c0 to c1 | s8 | 21 | identical stats to s5 |
| c0 to c1 | s13 | 21 | identical stats to s5; sum 87 |

s5, s8 and s13 report identical `compared`, `changed`, bands and first/last days; they probably resolve to one key. `[ASSUMED]` The coordinator's private scope-to-key map decides; the replay is per KEY and is reported per scope through that map.

### What the capture script must produce
Keep it OUT of the tracked tree; hand it to the coordinator as text in the plan, run by base64-exec. Precedent: `164.6.6.2.3-08-SUMMARY.md` ("One-shot read inside `quantalyze-analytics-backfill` through `railway ssh`, base64-exec, sequential, one `Mt5Client` per key, `settle_history=True`, derive-bound timeout of 100 s per key") `[CITED]`. Output is the JSON the dry run reads `[VERIFIED: scripts/mt5offset_dry_run.py module docstring]`:

`{"offset_s": <int>, "keys": {"<key id>": {"status": "captured", "deals": [...], "equity": <float>, "balance": <float>, "currency": "<str>"} | {"status": "not_captured", "error_class": "<ClassName>"}}}`

The object key order is the capture order and is the only source of the report's ordinals (`mt5-key-N`). Written to the coordinator's scratchpad only; stdout never goes to a tracked file.

Read-only modules the script may import (the 164.6.6.2.3-08 write review, re-checked here): `services.db.get_supabase` (one SELECT on `api_keys` for connected MT5 keys; the exact column predicates are copied from the plan-08 run `[ASSUMED: not tracked; the coordinator re-reads the schema before running]`), `services.encryption` decrypt, `services.mt5_validation.parse_mt5_credentials` and `mt5_venue_account_id`, `services.mt5_client.Mt5Client` (construct, `login`, `account_info`, `history_deals_get`, `close`), `services.mt5_probe.assert_expected_login`, `services.mt5_read.read_mt5_deal_ledger` (read-only: login, `account_info`, `history_deals_get`, settle loop, one tick read, post bracket) and `services.account_unit.classify_account_currency`. Session construction mirrors `job_worker._make_mt5_session` (`Mt5Session(client=Mt5Client(host, port), login, investor_password, server, venue_account_id)`) without importing `job_worker`. Never call `Mt5Client.restart`, `_mt5_bounded_restart`, `recycle_terminal_process`, `scrub_terminal_account_data`, `record_mt5_terminal_handover` or anything under `job_worker`. Print a per-key progress line carrying only the ordinal and the error class; on any raise record `not_captured` with the class name only.

**The lease and the capture (blocks the capture steps; Open Question 3).** After this phase ships, the capture moves the shared terminal from a third process. Taking the real `mt5_terminal_lease` makes it exclude the nightly jobs, but it writes one lease row per key and a handover `cron_runs` row when the holder changes (the 164.6.6.2.3-08 review excluded the lease for the handover insert), which is not "read-only" in D-02's strict sense. Not taking it relies on the quiet-window proof only.

**Transport (Open Question 4).** `railway ssh` evidence conflicts: failed after authentication on both analytics services on 2026-11-03 (`CHANGELOG.md` `[0.133.18.4]`, `[0.133.18.3]`) `[CITED]`; worked for the founder on `quantalyze-analytics` on 2026-11-25 (`229-06-SUMMARY.md` line 76, `railway ssh --service quantalyze-analytics -- sh -c '...'`) `[CITED]`; two runbooks say never use it (`docs/runbooks/marksource-okx-history-correction.md:476` says TRADEPAGES found it broken; `231-RESEARCH.md` run protocol says never `railway ssh`). Reach into the BACKFILL service on 2026-11-25 is unmeasured. `[ASSUMED]` Fallback: the 186-04 / 231-02 start-command probe protocol (a temporary `sh -c` start command on the backfill worker that runs the one-shot and then `exec`s `python -m main_worker`, founder approval each time, restore and verify), which needs the probe script to be shipped in the image and so conflicts with "kept out of the tracked tree". The coordinator picks.

### Replay steps (coordinator)
1. Marker query first on any PROD statement (CLAUDE.md query).
2. Quiet window: a SELECT shows no running or queued MT5-terminal job (precedent counts the job kinds from `job_worker.py`), outside 00:40Z to 01:40Z.
3. Capture to scratch.
4. `cd analytics-service && python -m scripts.mt5offset_dry_run --captured <scratch>/captured.json --rule us --legacy-offset-s 7200 --out <scratch>/report-7200-us.md --map-out <scratch>/ordinals.json`. Exit 1 means some key is `not measured` and the report says so.
5. Optional control: the same with `--legacy-offset-s 10800`.
6. Map ordinals to 202 scopes through the coordinator's private strategy-to-key map (a SELECT, scratch only).
7. Record counts per scope.

### Comparison and attribution rules (counts only)
The tool prints counts per key: `moved_days`, `level_days_changed`, `return_days_changed`, `moved_flow_deals` `[VERIFIED: _COLUMNS in mt5offset_dry_run.py]`. Per scope, with M = 202's moved count above and R = `return_days_changed` for the scope's key:
- **Count-level (no new code):** R = M for every scope in a pair is consistent with "all M moved values are the clock switch". R < M leaves M - R values to another named cause. R > M means the clock predicts moves 202 did not observe (different window or deal set; flag). The structural prediction to confirm from tracked values: every changed day sits in US summer, so the earliest 202 change for s2 (2025-10-30) must fall before the 2025 US fall change (first Sunday of November) `[ASSUMED: 2025-11-02 from the statute; confirm by running services.mt5_server_clock]`, and the three scopes' bands agree.
- **Day-set level (stronger; needs one small tracked change):** counts cannot show that the SAME days moved. 202's per-scope day sets are scratch-only on the coordinator's machine, and the tool has no per-day output. Add an optional `--days-out PATH` to `mt5offset_dry_run.py`, written to scratch exactly as `--map-out` is today (surgical, in the file's own pattern), holding per ordinal the moved return days, moved level days and the full legacy and target fold day indexes. The coordinator then intersects the day sets with 202's scratch sets and reports only counts: attributed to the clock switch (in both), predicted by the clock but not observed, observed but not predicted. Planner decision; recommended, because s5/s8/s13's identical counts make a count-only match weak.
- **Metric caveat:** the dry run folds `combine_mt5_deal_ledger` and `reconstruct_mt5_nav_levels`; the stored 202 values come from the full derive (anchor, marks, flows epilogue). The two agree on day boundaries but not necessarily on every value, so day-set equality is the evidence and magnitude equality is not claimed.

### What the replay can and cannot attribute
- **Can:** which days a 7200-to-`us` switch moves (US-summer days only) and, with `--days-out`, whether 202's moved days are that set.
- **Cannot attribute the 29 vanished s2 winter rows** (2025-11-17 to 2025-12-15): 7200 and `us` agree in winter, so the replay predicts zero vanished rows by construction. Those stay "another cause". The candidates `202-MT5-CLOCK-LEAD-01` names are #1196 (TINYBASE; touches `combine_mt5_deal_ledger`) and #1205 (gap closure; CHANGELOG records it deleting rows stored on stated days, "Rows stored on stated days went from 24 to 0", `CHANGELOG.md` around line 3441) `[CITED]`. The replay can still help: with `--days-out`, check whether the 29 days are present in the current fold under `us` (present means the current code would write them, so their absence from c1 is a storage-side delete, consistent with #1205; absent from the fold points at the fold, i.e. #1196). That is a presence count, not a proof, and the record must say "weighed, not proven" unless both counts are decisive.
- **Cannot:** show what the worker actually executed. The 7200 and `us` windows are the repo's record of the settings, not a read of Railway variables (202-05 line 307 says so); the replay shows consistency with them, not their application.
- **Cannot** cover days after the capture's own ledger, and the capture reflects the broker's CURRENT deal list, which may have grown since 2026-11-06 (new winter days do not move under 7200 versus `us`, so counts are unaffected).

## Nightly evidence query

Marker first (CLAUDE.md), run alone, must name PROD:
```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();
```
Per night (UTC), both job scopes. A derive job is key-scoped (`api_key_id` set, `strategy_id` NULL) or strategy-scoped (`strategy_id` set, others NULL) `[VERIFIED: supabase/migrations/20260614120000_derive_broker_dailies_kind.sql:65-91 CHECK shapes]`; 202's s-scopes are strategy-mode MT5, and R-1 already met a row "the key join does not reach", so join through all three paths. `compute_jobs.exchange` admits `'mt5'` `[VERIFIED: supabase/schema/baseline.sql:2036]` but may be NULL for derive rows, so do not filter on it alone. `[ASSUMED]` column names beyond those quoted are read from the baseline at plan time; the coordinator checks the query against the schema before the first run.
```sql
WITH mt5 AS (
  SELECT ak.id FROM public.api_keys ak WHERE ak.exchange = 'mt5'
), jobs AS (
  SELECT cj.id, cj.status, cj.attempts, cj.created_at
    FROM public.compute_jobs cj
   WHERE cj.kind = 'derive_broker_dailies'
     AND cj.created_at >= :night_start AND cj.created_at < :night_end
     AND (
          cj.api_key_id IN (SELECT id FROM mt5)
       OR cj.strategy_id IN (SELECT s.id FROM public.strategies s WHERE s.api_key_id IN (SELECT id FROM mt5))
       OR cj.strategy_id IN (SELECT sk.strategy_id FROM public.strategy_keys sk WHERE sk.api_key_id IN (SELECT id FROM mt5))
     )
)
SELECT count(*) AS jobs,
       count(*) FILTER (WHERE status = 'done')            AS done,
       count(*) FILTER (WHERE status = 'done' AND attempts = 1) AS done_first_attempt,
       count(*) FILTER (WHERE attempts > 1)                AS second_attempts,
       count(*) FILTER (WHERE status NOT IN ('done'))      AS not_done
  FROM jobs;
```
Ledger half (227 `compute_job_attempt_failures`; reclaim DECREMENTS `attempts`, so the ledger can show a failed attempt that `attempts` no longer does): count rows for the same MT5 job scope with `recorded_at` in the night's window, by `cause_class` and `error_kind` `[VERIFIED: 20261124120000_jobledger_attempt_failures.sql:126-150 columns and CHECK]`. The ledger carries `api_key_id` and `strategy_id` copied from the job, so use the same three-path predicate. The night passes only if `second_attempts = 0`, `not_done = 0` for that night's MT5 derive jobs AND the MT5 ledger count is 0.

Guard and positive-signal reads (same marker discipline): `SELECT count(*) FROM public.mt5_terminal_leases` equals the expected terminal count (Pitfall 4); `poll_allocator_positions` jobs with `attempts > 1` for the night do not rise (Pitfall 6); Railway log count of the cross-process wait line (site and `duration_ms` only) over the 00:40Z to 02:30Z window, read through the Railway MCP by the coordinator. Record each night with its date.

### Seven nights and base rate (so the nights discriminate)
From 230-DISCUSSION-LOG R-1 `[CITED]`: second attempts on 11-05, 11-15, 11-20, 11-21, 11-23 (five of the 25 nights 11-01 to 11-25), and every other night `attempts=1`. So **11-06 to 11-14 were nine consecutive clean nights with no fix in place**, and 11-24 and 11-25 were clean as well. If a collision were independent per night: at the 25-night rate (5/25 = 0.2) the chance of seven clean nights with NO fix is 0.8^7 = 0.21; at the rate since 11-15 (4 of 11 nights, 0.36) it is 0.64^7 = 0.04 (arithmetic on the cited counts; independence is `[ASSUMED]`). Seven clean nights alone are therefore weak evidence. The positive signal is a logged cross-process wait on at least some nights of the seven (a collision happened and was serialized). If no night logs a wait, record the count as "not discriminating" rather than "fixed" and let the nights run longer. Nights start at `max(backfill deploy, API deploy)` and after the migration applied (Pitfall 5).

## Code Examples

Quoted values this phase's code and tests reuse `[VERIFIED: read this session]`:

```python
# services/mt5_client.py:712-721
HOLDER_HOUSE: Final[str] = "house"
HOLDER_VALIDATION: Final[str] = "validation"
HOLDER_UNKNOWN: Final[str] = "unknown"
HOLDER_UNATTRIBUTED: Final[str] = "unattributed"

# services/mt5_handover.py:127-142 (the closed site set, 9 members in _SITES)
SITE_DERIVE = "derive_broker_dailies"; SITE_BALANCE = "sync_trades_balance"
SITE_HOLDINGS = "allocator_holdings"; SITE_BACKFILL = "equity_backfill"
SITE_VALIDATE_WIZARD = "validate_wizard"; SITE_VALIDATE_WORKER = "validate_worker"
SITE_HEAL = "session_heal"; SITE_TERMINAL_SCRUB = "terminal_scrub"
SITE_VALIDATION_LIVENESS = "validation_liveness"

# main_worker.py:558 and :703
_SQLSTATE_UNDEFINED_FUNCTION = "42883"
_POSTGREST_UNDEFINED_FUNCTION: Final = "PGRST202"
# main_worker.py:708
_RENEW_UNAVAILABLE_RELOG_S: Final[float] = 900.0
```

RPC call shape (the 227 renew precedent `[VERIFIED: main_worker.py:725-760]`), adapted:

```python
supabase = get_supabase()
def _call() -> Any:
    return supabase.rpc(
        "acquire_mt5_terminal_lease",
        {"p_terminal_digest": digest, "p_owner_token": token, "p_holder": holder,
         "p_site": site, "p_ttl_s": 90},
    ).execute()
result = await asyncio.wait_for(db_execute(_call), timeout=_MT5_XLEASE_RPC_TIMEOUT_S)
granted = result.data is True        # PostgREST answers a Python bool for a boolean function
```

Missing-RPC fallback: on `is_missing_rpc(exc)` return `None` (in-process only), log at ERROR with counts only and an `event_type` like `mt5_xlease_unavailable`, re-logged at most every 900 s (CONTEXT says "once per process"; the 227 comment explains why a single line is wrong because PGRST202 also fires on parameter-signature drift. The 900 s relog is a superset that stays loud; the planner confirms). Never latch the fallback: a later successful call must resume leasing without a restart.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| per-process `asyncio.Lock`; cross-process caught only by the login bracket | DB lease behind the same lease helper | this phase | the bracket stays as the last-resort net and is not weakened |
| runbook: single replica both services because the lock is per event loop | the analytics-side replica constraint is lifted by the lease; the gateway constraint (one `ThreadedServer`, one logged-in account) is not | this phase | update `docs/runbooks/mt5-go-live.md` (the "SINGLE REPLICA" invariant, lines 120-146) in the same PR; do NOT claim multi-replica is now supported without a measured test |
| claim reset by watchdog while waiting | 227 `renew_compute_job_claims` | 2026-11-24 | the pattern this lease copies |

**Deprecated/outdated:** the comment block above `_MT5_TERMINAL_LOCKS` ("SCOPE - a DOCUMENTED gap") needs a dated `CORRECTED` note, kept as lineage, in the style that file already uses.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The backfill and API services hold the SAME `MT5_GATEWAY_HOST`/`PORT` spelling | Pitfall 4 | two lease rows, no serialization; caught by the row-count check |
| A2 | `ON CONFLICT DO UPDATE ... WHERE` re-evaluates on the committed row under concurrent first inserts | Lease design | double grant; caught by the live-lane N-thread test |
| A3 | `run_in_executor` thread keeps running after `wait_for` cancels the awaiter, so a late acquire can land | Pattern 2 | late-grant release unnecessary (harmless if so) |
| A4 | Typical holds 10 to 60 s and inter-hold gaps of seconds make 0.5 s polling adequate without a FIFO slot | Pitfall 6 | a waiter loses repeated gaps and nears its handler budget; the logged wait and poll-attempts guard detect it |
| A5 | Per-night collisions independent (base-rate arithmetic) | Seven nights | the 21% / 4% figures are illustrative only |
| A6 | `railway ssh` reaches `quantalyze-analytics-backfill` | MT5D-03 | capture needs the start-command fallback |
| A7 | s5, s8, s13 resolve to one key | MT5D-03 | per-scope table needs three keys |
| A8 | The `api_keys` selection predicate for connected MT5 keys is re-read by the coordinator | MT5D-03 | wrong key set captured |
| A9 | 2025 US fall change was 2025-11-02 | MT5D-03 | only the summer-only sanity check shifts |
| A10 | CI Python version equals local 3.14.3 | Standard Stack | none expected; not read |

## Open Questions (RESOLVED)

1. **Does the plan accept three site edits and one classify arm against CONTEXT's "no site edits"?**
   - What we know: the holdings fetcher and the two `process_key` validate arms mishandle a lease-unavailable raise (user-visible leak, bodyless 500).
   - Recommendation: yes; they are the price of the locked fail-closed rule. Flag the correction to the coordinator.
   - RESOLVED: CONTEXT "Decided autonomously after research" [Site edits] accepts the three site edits and the classify arm; plan 05 implements them.
2. **Night 1 definition.** CONTEXT counts from the backfill deploy; the API process runs the holdings poll. Recommendation: `max(both deploys)`, after the migration applied.
   - RESOLVED: CONTEXT [Night 1] adopts the later of the two deploys, after the PROD apply; plan 09 defines and records night 1.
3. **Capture and the lease (D-02 is silent; blocks the capture steps).** (a) capture takes `mt5_terminal_lease` (excludes the nightly jobs; writes lease and handover rows, so not strictly read-only) or (b) capture without it in the proven quiet window, as the 164.6.6.2.3-08 precedent did. Either way the capture moves the terminal under the live workers' in-process holder and settled registries; the precedent restarted both services afterwards (founder decision "Both services") and D-02 covers no restart. Recommendation: (b) plus the precedent's restart sequence, put to the founder as one question.
   - RESOLVED: CONTEXT [Capture] takes (b), no lease and a quiet window, and ends with the restart of both services as a coordinator step; plan 10 hands it over (D-02) and plan 03 writes the steps.
4. **`railway ssh` reach to the backfill service** (Assumption A6) and the fallback.
   - RESOLVED as unmeasured, fallback planned: plan 03 (DEC-03-D) writes the API-service fallback into the runbook, and plan 10 stops and asks the founder if both routes fail. Not a measurement.
5. **Cross-process staleness of the per-process holder and settled registries** (Runtime State). Pre-existing, not widened by the lease; the kept-row design leaves the hook. Recommendation: book as a follow-up, not fix here.
   - RESOLVED: booked as a follow-up through plan 08's ship record (the new staleness TODOS entry), not fixed in this phase.
6. **`--days-out` on `mt5offset_dry_run.py`** (comparison level). Recommendation: add it (small, scratch-only, tested).
   - RESOLVED: CONTEXT [Replay] adopts it; plan 03 adds the flag with its test.
7. **Relog cadence for the missing-RPC line:** once per process (CONTEXT) or every 900 s (227)? Recommendation: 900 s.
   - RESOLVED: CONTEXT [Missing RPC] adopts 900 s; plan 04 implements the relog clock.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | census scripts, vitest | yes | v25.8.1 | - |
| python3 / pytest / mypy | analytics tests, type gate | yes | 3.14.3 / 9.0.2 / 2.0.0 | - |
| psql, pg_ctl | SQL gate lane (`scripts/pg-lane/run.sh`) | yes | 18.6 | - |
| docker | local-stack lane for live-DB tests | yes | 29.9.2 | skip live module locally; CI runs it |
| supabase CLI | migration tooling (linked to PROD; never push from here) | yes | 2.84.2 | - |
| railway CLI | coordinator's capture and deploy reads | yes | 5.71.0 | Railway MCP |
| live PROD / TEST / gateway | evidence and capture | not used by this research | - | coordinator only |

**Missing dependencies with no fallback:** none for the build. The capture depends on `railway ssh` reach (A6).
Run docker only for the live lane and clean up afterwards (user memory: Docker cleanup).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.0.2 (`analytics-service/pytest.ini`, `asyncio_mode = auto`), vitest for census files, plain-SQL `DO` gates under `supabase/tests` with the mutation runner |
| Config file | `analytics-service/pytest.ini`; `scripts/mutation-floors.mjs`; `vitest` via package scripts |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_mt5_xlease.py tests/test_mt5_concurrency.py -q -p no:cacheprovider` (36 existing tests take about 21 s) |
| Full suite command | `cd analytics-service && pytest -n auto --dist loadgroup` ; `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` ; `node scripts/mutation-runner/run.mjs --parse-only` ; `node scripts/lint-sql-gates.mjs` ; `npx vitest run src/__tests__/<census files>` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MT5D-02 | two holders on two lock registries never overlap (PROOF-01, RED when neutered) | unit | `pytest tests/test_mt5_xlease.py::test_xproc_01_two_holders_two_registries -x` | Wave 0 |
| MT5D-02 | bounded caller -> `Mt5TerminalBusyError`, local lock released, nothing stamped; `wait_s` one deadline | unit | `pytest tests/test_mt5_xlease.py -k bound -x` | Wave 0 |
| MT5D-02 | RPC errors tolerated under budget, then Unavailable; classify transient | unit | `pytest tests/test_mt5_xlease.py -k unavailable -x` | Wave 0 |
| MT5D-02 | missing RPC falls back, loud, relogs on the injected clock, never latches | unit | `pytest tests/test_mt5_xlease.py -k missing_rpc -x` | Wave 0 |
| MT5D-02 | late-grant release; cancel during DB release frees local lock | unit | `pytest tests/test_mt5_xlease.py -k "late_grant or cancel" -x` | Wave 0 |
| MT5D-02 | renew false / 70 s no-success bumps epoch; body's next touch refused | unit | `pytest tests/test_mt5_xlease.py -k lost -x` | Wave 0 |
| MT5D-02 | timing constants validated at import | unit | `pytest tests/test_mt5_xlease.py -k timing -x` | Wave 0 |
| MT5D-02 | digest hex-64, no host/port text, spelling-normalized | unit | `pytest tests/test_mt5_xlease.py -k digest -x` | Wave 0 |
| MT5D-02 | three site edits each RED when removed | unit | `pytest tests/test_allocator_positions_non_ccxt.py tests/test_process_key.py tests/test_job_worker.py -k lease -x` | extend existing |
| MT5D-02 | existing lease behaviours unchanged under the null default | unit | `pytest tests/test_mt5_concurrency.py tests/test_mt5_abandon_fence.py tests/test_mt5_handover.py -q` | exists |
| MT5D-02 | SQL: exclusivity, takeover, foreign release, renew, validation, grants, digests, holder CHECK | SQL gate | `node scripts/mutation-runner/run.mjs` (full) ; `--parse-only` for the static pass | Wave 0 |
| MT5D-02 | RPC answer shapes and N-client exclusivity on a real database | live lane | `cd analytics-service && pytest tests/test_mt5_xlease_live.py -x` (needs the lane env) | Wave 0 |
| MT5D-03 | `--days-out` (if adopted) writes day sets only to the named scratch path; report stays counts-only | unit | `pytest tests/test_mt5offset_dry_run.py -x` | extend existing |

### Sampling Rate
- **Per task commit:** `python3 -m pytest tests/test_mt5_xlease.py tests/test_mt5_concurrency.py -q`
- **Per wave merge:** analytics full pytest + mypy strict + `node scripts/mutation-runner/run.mjs --parse-only` + `node scripts/lint-sql-gates.mjs` + the census vitest files
- **Phase gate:** full suite green and one full mutation-runner run before `/gsd-verify-work`; PROOF-01 neuter-restore record pasted into the plan SUMMARY

### Wave 0 Gaps
- [ ] `analytics-service/services/mt5_xlease.py` and `tests/test_mt5_xlease.py` - MT5D-02 unit and PROOF-01
- [ ] `tests/conftest.py` autouse in-memory-grant default backend (before any lease test is changed)
- [ ] `tests/test_mt5_xlease_live.py` - lane answer-shape and contention test
- [ ] `supabase/tests/test_mt5_terminal_lease.sql` plus migration, down file, generated mirrors
- [ ] census edits listed under Migration (floors, pins, `ci.yml` sentinels, `database.types.ts`, `NAME_SET_RATCHET`, `COMPARED_FLOOR`)
- [ ] `services/db.py::is_missing_rpc` plus parity test against `main_worker._is_missing_rpc`

## Security Domain

`security_enforcement` is not set in `.planning/config.json` (read this session), so it is enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | - |
| V3 Session Management | no | - |
| V4 Access Control | yes | table RLS enabled with no policy; table privileges revoked from PUBLIC/anon/authenticated; three RPCs SECURITY DEFINER, `search_path = public, pg_catalog`, EXECUTE for service_role only; asserted by the migration's self-verify and gate arm L6 |
| V5 Input Validation | yes | the RPCs validate digest shape, ttl range, non-null token; CHECKs on `holder` and `site`; Python normalizes holder and site through the closed sets |
| V6 Cryptography | no | SHA-256 is an identifier digest, not a secret; the low-entropy-key brute-force limit is stated and bounded by service_role-only access |
| V7 Error handling and logging | yes | counts-only log lines; `Mt5TerminalBusyError` and `Mt5TerminalLeaseUnavailableError` carry fixed text (no host, port, key, digest, queue depth); no lease value reaches a response body (WIZFORM-03) |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A browser role extends or steals a lease | Tampering / EoP | no anon/authenticated EXECUTE or table grant; arm L6 and the self-verify |
| Search-path hijack of a SECURITY DEFINER body | EoP | pinned `search_path`; verify asserts `proconfig` |
| Raw login, server or host written to a row, log or exception | Information disclosure | digest-only key, normalized holder/site, DB CHECKs, fixed exception text, a test that scans the row and log capture for `host`/`port` text |
| Lease stranded by crash or timeout | DoS | TTL 90 s, late-grant release, token-fenced release |
| Two holders on the terminal after a stalled renew | Tampering (wrong-account read) | self-fence at 70 s via the D-36 epoch; MT5CONC-02 bracket remains |
| Lease outage becoming a user-visible 500 | DoS / info disclosure | the three site edits and the classify arm |

## Sources

### Primary (HIGH confidence, files read this session)
- `analytics-service/services/mt5_concurrency.py` (full), `services/mt5_client.py` (key, epoch, holder, `_assert_live`, `mt5_history_wait_due`), `services/mt5_handover.py`, `services/db.py`, `services/mt5_read.py` (ledger read), `main_worker.py` (renew, missing-RPC, constants), `services/job_worker.py` (sites, `classify_exception`, `TIMEOUT_PER_KIND`, holdings arms), `services/allocator_positions.py`, `routers/exchange.py`, `routers/process_key.py`, `services/ingestion/mt5.py`, `services/mt5_relogin.py`, `services/mt5_validation_liveness.py`, `services/mt5_terminal_scrub.py`, `services/mt5_session_episodes.py`, `scripts/mt5offset_dry_run.py`, `services/mt5_server_clock.py` (docstring)
- `analytics-service/tests/test_mt5_concurrency.py`, `tests/conftest.py`, `tests/test_compute_jobs_fencing.py`, `tests/test_compute_job_metadata_merge_live.py`
- `supabase/migrations/20261124120200_compute_job_claim_renewal.sql`, `20261124120000_jobledger_attempt_failures.sql`, `20261125132334_api_keys_venue_server_owner_read.sql`, `20260614120000_derive_broker_dailies_kind.sql`; `supabase/tests/test_compute_job_claim_renewal.sql`; `supabase/migrations/down/20261124120200-rollback.sql`; `supabase/schema/baseline.sql:2036`
- `git show d04ef47c1` (Phase 227 ship): the census files a gate and function set move
- `scripts/mutation-floors.mjs`, `scripts/dump-sql-functions.ts`, `scripts/baseline-content-drift-check.mjs`, `scripts/check-gdpr-export-coverage.ts`, `.github/workflows/ci.yml` (python and sql-tests steps), `.planning/config.json`
- `.planning/phases/230-*/230-CONTEXT.md`, `230-DISCUSSION-LOG.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `CLAUDE.md`, `TODOS.md` (`202-MT5-CLOCK-LEAD-01`)
- `.planning/milestones/v1.21-phases/202-residchurn-*/202-05-SUMMARY.md`, `202-07-SUMMARY.md`, `202-REPORT.md`; `.planning/milestones/v1.20-phases/175-mt5offset-*/175-04-SUMMARY.md`, `175-06-SUMMARY.md`, `175-VERIFICATION.md`; `.../164.6.6.2.3-*/164.6.6.2.3-08-SUMMARY.md` and `-08-PLAN.md`; `.planning/phases/229-*/229-06-SUMMARY.md`; `.planning/phases/231-*/231-RESEARCH.md`; `CHANGELOG.md` `[0.133.18.4]`, `[0.133.18.3]`

### Secondary (MEDIUM confidence)
- MT5 Python API notes recorded in `230-DISCUSSION-LOG.md` R-5 (not re-fetched, per the brief): `login` says nothing about per-process or terminal-wide state; R-3's measurement is what establishes the terminal-wide behaviour.

### Tertiary (LOW confidence)
- Railway env spelling, `railway ssh` reach to the backfill service, base-rate independence (see Assumptions Log).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new; every seam read.
- Architecture: HIGH for order, fencing and site dispositions (read at source); MEDIUM for timing constants (derived from existing bounds, not measured).
- Pitfalls: HIGH for 1 to 3, 7 to 10 (mechanical); MEDIUM for 4 to 6 (depend on deployed env and load).
- MT5D-03: MEDIUM; clock history and moved counts are tracked records, but the replay compares a partial fold with stored full-derive values, and the capture transport is unconfirmed.

**Research date:** 2026-11-25
**Valid until:** 2026-12-02 for the migration stamp and floors (both move with every merge); 30 days for the design.
