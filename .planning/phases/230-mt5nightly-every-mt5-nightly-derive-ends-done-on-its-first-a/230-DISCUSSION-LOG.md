# Phase 230 MT5NIGHTLY — discussion log

## 2026-11-25 — research readings before discuss (SC-1: "read the records")

All PROD reads went through the Supabase MCP, with the marker query run alone first and naming
PROD each time. Railway reads went through the Railway MCP, reading the backfill worker's deploy
logs. This file holds counts and dates only: no key ids, logins, hosts or server names.

### R-1. The second attempts, from stored job rows (compute_jobs, kind derive_broker_dailies, MT5)

`attempts=2` on `done` jobs: 2026-11-05 (1), 11-15 (1), 11-20 (1), 11-21 (1), 11-23 (2). Every
other night from 11-01 to 11-25 is `attempts=1` only. Separately, 11-18 has 1 `failed_final`
(`attempts=3`, the clock-rule mismatch fixed by Phase 217, see TODOS `175-NIGHTLY-MT5-DERIVE-CHECK`).
`reclaim_count=0` on every row. The jobs are created at 00:40Z. The retried job is always among the
last to finish, 58 to 63 minutes after creation.

⚠️ The 2026-11-23 TODOS reading also listed 11-22 (1). The key-joined read above shows none on 11-22.
The 11-22 row may be a job the key join does not reach. Not re-measured further, because it does not
change R-3.

### R-2. The coordinator's HEAL-02 hypothesis is refuted on the timeline

Phase 227 (#1325) merged at 2026-11-24 15:47Z. The backfill worker first ran that code in the
deploy created at 2026-11-24 21:11Z. So the 11-24 00:40Z night ran **pre-227** code and was clean.
Only the 11-25 night ran post-227 code. "Clean on 11-24 and 11-25, after the deploy" is half wrong.
There is one post-deploy clean night, not two.

### R-3. The named cause: two processes log the ONE shared MT5 terminal into different accounts

The backfill worker's logs for each retried night carry the cause verbatim, on the first attempt:

| night | first-attempt failure (worker log, classified transient) |
|---|---|
| 11-15 | `mt5 login bracket rejected a mismatched terminal account ... restarting the terminal; NOTHING persisted (MT5CONC-02)` |
| 11-20 | same, MT5CONC-02 account mismatch |
| 11-21 | same, MT5CONC-02 account mismatch |
| 11-23 | same, MT5CONC-02 account mismatch (1 job) and `mt5 read hit a transient/wrong-server client error` (1 job) |
| 11-24, 11-25 | no `transient` line in 00:35Z to 02:30Z |

11-05 was not read in the logs.

The handover record (`cron_runs`, `cron_name = mt5_terminal_handover`) shows why. Every night two
processes use the same terminal at the same time, each with its own lease registry:
- the backfill worker runs `derive_broker_dailies` (site `derive_broker_dailies`), 00:40Z to about
  01:40Z;
- the API process runs `poll_allocator_positions` (site `allocator_holdings`), created at 01:00Z and
  done by about 01:10Z.

On 11-20 and 11-23 the two sites' handovers interleave second by second from 01:00Z to 01:09Z.
Every night from 11-19 to 11-25 shows the two kinds on two different hosts in that window. The
collision is a race inside a window that recurs every night. Whether a given night collides is
luck, so a clean night is weak evidence.

**Root cause (code).** `services/mt5_concurrency.py` `_MT5_TERMINAL_LOCKS` is an `asyncio.Lock` per
process. Its own comment records the gap: it serializes only within one event loop, and the
cross-process case is caught only by the login bracket (`_assert_expected_login`, pre and post
read). Since the backfill split (`BACKFILL_KINDS`, `WORKER_CLAIM_ROLE`), `derive_broker_dailies`
runs in a different process from `poll_allocator_positions`. So the lock does not serialize the
nightly derive against the holdings poll. The bracket fails the derive closed (nothing persisted),
the job retries, and the retry succeeds. `docs/runbooks/mt5-go-live.md` already says a second
process needs "a durable CROSS-PROCESS serializer first (a Postgres advisory lock or equivalent)".

**Data integrity.** The bracket held on every recorded night: NOTHING persisted on the refused
attempt. The cost is the retry. A collision that lands between the post-read bracket and the
persist is not covered by this reading.

**Visibility from now on.** Since 227, a transient `mark_compute_job_failed` writes a
`compute_job_attempt_failures` row (`cause_class=error`, `error_kind=transient`). A future
collision therefore shows up in the ledger as an MT5 `derive_broker_dailies` row. On 11-25 there
were zero MT5 rows, which matches the clean logs.

### R-4. MT5D-03 (clock replay) needs a ledger capture on the worker host

`mt5_server_clock_readings` holds clock readings, not deals, and PROD stores no MT5 deal ledger. The
replay tool already exists: `analytics-service/scripts/mt5offset_dry_run.py` (Phase 175 plan 04)
folds one captured ledger under a legacy fixed offset and under a target rule. It needs a one-shot
read-only capture on the worker host (it logs the shared terminal into each key). That is a live
action on the terminal, and it should run outside the 00:40Z to 01:40Z window, because of R-3.

### R-5. MT5 Python API docs read (as the brief required)

- `history_deals_get`
  (https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py): `date_from` and
  `date_to` are a `datetime` or seconds since 1970. The page says nothing about time zone or server
  time.
- `copy_rates_from` (https://www.mql5.com/en/docs/python_metatrader5/mt5copyratesfrom_py): "MetaTrader
  5 stores tick and bar open time in UTC time zone (without the shift)", and "'datetime' should be
  created in UTC". The repo measures the opposite on this broker: deal and tick epochs read as
  broker wall time, which is why `mt5_server_clock.py` and the clock readings exist. The docs'
  UTC claim is not evidence against the repo's server-clock model.
- `symbol_info_tick` (https://www.mql5.com/en/docs/python_metatrader5/mt5symbolinfotick_py): `time`
  and `time_msc` have no stated zone.
- `login` (https://www.mql5.com/en/docs/python_metatrader5/mt5login_py): "Connect to a trading
  account". The example shows a later `login` replacing the account `account_info` reports. The page
  says nothing about whether login state is per process or for the whole terminal, or about
  concurrency. R-3 measures it as terminal-wide: one process's login re-points the other's session.

## OPEN — founder decision needed before planning (D-01)

How to serialize the shared MT5 terminal across processes. Raising retries or the watchdog is not a
close (ROADMAP).

- **(A) Recommended: a DB-backed cross-process terminal lease.** A lease row per terminal key, with
  acquire, renew and release RPCs, a TTL and an owner token, service_role only. It is taken inside
  `mt5_terminal_lease` by every site (derive, holdings, sync balance, validate, scrub), so a single
  choke point covers all of them. This is the serializer the go-live runbook already names as the
  precondition. It costs a migration (the serial lane, migration-reviewer and rls-policy-auditor),
  and an interactive caller waits behind a derive or reports busy (`Mt5TerminalBusyError` already
  exists for that). It changes no stored values, so it is outside the 155.2 freeze.
- (B) Move MT5 terminal work into one process: MT5 holdings polls run on the backfill worker. Claim
  scope is by kind, not venue, so this either moves every venue's holdings poll onto the backfill
  worker (busy for an hour each night) or needs a venue-aware claim. It leaves `validate_key` in
  the API process uncovered.
- (C) Rejected: moving the holdings cron out of the derive window. It is a schedule bandaid. The
  derive window grows with key count, and validate and sync still collide.

MT5D-03 also needs a founder go-ahead (or a founder run) for the one-shot read-only ledger capture on
the worker host, outside 00:40Z to 01:40Z.
