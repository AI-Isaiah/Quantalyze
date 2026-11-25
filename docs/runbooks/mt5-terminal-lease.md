# MT5 terminal lease: the cross-process serializer (Phase 230 MT5NIGHTLY)

Operator runbook for the database lease that serializes every user of the ONE shared MT5
terminal across the analytics services. Read it before touching the lease table, rolling the
migration back, or reading a night's evidence.

> Nothing in this file may name a host, port, login, broker server, key id or account number.
> Every check below records a count or a yes/no, never a value. If a step seems to need a value,
> stop and read the value in the Railway dashboard, never write it down.

Related: `docs/runbooks/mt5-go-live.md` (the gateway, and the single-replica invariant this lease
narrows), `docs/runbooks/mt5-clock-replay.md` (the other half of the phase, MT5D-03).

## 1. What it is

**The cause it removes.** The MT5 terminal is one process behind one gateway. Two Railway services
drive it: the backfill worker (its nightly `derive_broker_dailies` run, about 00:40Z to 01:40Z)
and the API service (the allocator holdings poll, about 01:00Z to 01:10Z). The in-process serializer
in `analytics-service/services/mt5_concurrency.py` is an `asyncio.Lock` per process, so it serialized
nothing across the two services. The two logged the terminal into different accounts at the same
time, the derive's login bracket refused its read (nothing persisted), the job was retried as
transient, and the retry succeeded. That second attempt is what the nightly record showed.

**The fix.** After a caller holds the in-process lock, `mt5_terminal_lease` takes a database lease
for the same terminal before its body runs, renews it while the body runs, and releases it in the
same `finally`. The decision was the founder's, D-01 of the phase context, option title
"Database lease (Recommended)". Moving the holdings polls to the worker and moving the holdings
cron out of the derive window were both put to the founder and rejected.

**The table.** `public.mt5_terminal_leases` holds one row per terminal and nothing else. The key is
`terminal_digest`, a sha256 of a versioned prefix plus the stripped, lower-cased terminal key
(`terminal_lease_digest` in `analytics-service/services/mt5_xlease.py`). The raw host and port are
never written. `holder` is an `api_key_id` or one of four closed literals (`house`, `validation`,
`unknown`, `unattributed`); `site` is the lease site name. A release clears `owner_token` and keeps
the row, so the row records the last holder and last site. Free means `owner_token IS NULL OR
expires_at <= now()`. Expiry is the database's `now()`; no client clock is written.

**The three RPCs** (all `RETURNS boolean`, SECURITY DEFINER with a pinned search_path, EXECUTE for
`service_role` only, the table RLS-enabled with no browser policy):

| RPC | Answer |
|---|---|
| `acquire_mt5_terminal_lease(text, uuid, text, text, integer)` | true when the row was free, expired, or already held by the same token |
| `renew_mt5_terminal_lease(text, uuid, integer)` | true only while the caller's token still owns an unexpired row |
| `release_mt5_terminal_lease(text, uuid)` | true only for the owner; a foreign token changes nothing |

**The constants** (`analytics-service/services/mt5_xlease.py`, validated against each other at
import by `_validate_xlease_timing`; read them by symbol, they are the source):

| Symbol | Bounds |
|---|---|
| `_MT5_XLEASE_TTL_S` | how long a lease lives without a renew; an orphaned lease expires by itself after this |
| `_MT5_XLEASE_RENEW_INTERVAL_S` | how often the holder renews while its body runs |
| `_MT5_XLEASE_RPC_TIMEOUT_S` | the ceiling on every single lease RPC |
| `_MT5_XLEASE_POLL_S`, `_MT5_XLEASE_POLL_JITTER_S` | the wait between two acquire attempts, and its jitter |
| `_MT5_XLEASE_LOST_AFTER_S` | derived as TTL minus one renew interval: no successful renew for this long means the lease is lost and the holder is fenced |
| `_MT5_XLEASE_MIN_ATTEMPT_S` | the least one acquire RPC is given when a bounded caller's bound is nearly spent |
| `_MT5_XLEASE_ERROR_BUDGET_S` | how long an UNBOUNDED caller tolerates consecutive RPC errors before it fails closed |
| `_MT5_XLEASE_UNAVAILABLE_RELOG_S` | how often the "RPC is missing" ERROR is re-logged |

The lease changes no stored value and sits outside the 155.2 freeze.

## 2. What callers see

- **Unbounded callers** (`wait_s=None`: the derive, the balance sync, the holdings poll, the worker
  validate, the terminal scrub) wait until the lease is free. A wait is normal and is what the
  `mt5_xlease_waited` event counts.
- **Bounded callers** (the wizard validate, the heal, the liveness probe) raise the existing
  `Mt5TerminalBusyError` when their bound expires. One deadline covers the in-process lock and the
  database lease together.
- **A lease the database cannot answer** fails CLOSED: the caller never proceeds unserialized. An
  unbounded caller raises `Mt5TerminalLeaseUnavailableError` after the error budget; a bounded one
  reaches its own deadline. `Mt5TerminalLeaseUnavailableError` is a subclass of
  `Mt5TerminalBusyError` and, like it, deliberately not an `Mt5ClientError`, so a lease outage can
  never be absorbed into a verdict that blames a user's key.
  - the derive: classified transient with a fixed message, so the job is retried;
  - the holdings poll: the existing "will retry" unreachable-terminal note, never the lease text;
  - the wizard validate and the worker validate: the existing retryable 424 `NETWORK_UNAVAILABLE`,
    never a bodyless 500.
- **A lease RPC that does not exist** (SQLSTATE 42883, or PGRST202 for a function absent from
  PostgREST's schema cache) is not a failure: the caller keeps only the in-process lock, as before
  this phase, and the ERROR event `mt5_xlease_unavailable` says so. It is never latched.

**Site to terminal map**, read from source at the phase head. Two terminals exist, each with its own
endpoint, so each has its own lease row. Which row a site takes depends only on which gateway pair
it reads:

| Terminal | Gateway pair read | Lease sites |
|---|---|---|
| job terminal | `MT5_GATEWAY_HOST` / `MT5_GATEWAY_PORT` | `derive_broker_dailies`, `sync_trades_balance`, `allocator_holdings` (both through `job_worker._make_mt5_session`), `session_heal` (`read_env_gateway_endpoint`) |
| validation terminal | `MT5_VALIDATION_GATEWAY_HOST` / `MT5_VALIDATION_GATEWAY_PORT` | `validate_wizard`, `validate_worker`, `terminal_scrub`, `validation_liveness` (all through `read_env_validation_gateway_endpoint`) |

`equity_backfill` is in the closed site set in `services/mt5_handover.py` but no production lease call
passes it at the phase head (a grep for the constant finds only its definition and the closed set).

Because the row key is a digest of the endpoint's spelling, the two services MUST spell the job
gateway endpoint identically. If they do not, they take two different rows and the lease serializes
nothing. Check 5(b) below is the check for that.

## 3. Log events

All six are emitted by `analytics-service/services/mt5_xlease.py`, as the `event_type` extra on a
log record. None carries a key, host, port, digest, holder or the text of an exception (a PostgREST
message can echo a URL); where an exception matters only its class name is logged.

| `event_type` | Level | Fields | Meaning |
|---|---|---|---|
| `mt5_xlease_waited` | INFO | `site`, `duration_ms`, `refusals` | **The positive cross-process signal.** The caller found the terminal held in another process, waited, and was then granted. One line per wait, never one for an uncontended acquire. A long `duration_ms` is the derive waiting behind a holdings poll or the reverse. |
| `mt5_xlease_unavailable` | ERROR | `rpc`, `site` | A lease RPC does not exist in the database. The terminal is serialized in-process only until it does. Re-logged at most every 900 s (`_MT5_XLEASE_UNAVAILABLE_RELOG_S`), never latched. Seen after deploy means the migration has not applied, was rolled back, or the PostgREST schema cache is stale. A night that carries one does not count toward the seven. |
| `mt5_xlease_lost` | ERROR | `site` | The lease was lost while its holder was still running (no successful renew inside `_MT5_XLEASE_LOST_AFTER_S`, or a renew answered false). The holder's session is fenced, so its next terminal touch refuses. Any occurrence is named in the night's record. |
| `mt5_xlease_rpc_error` | WARNING | `rpc`, `site`, `exc_class` | An acquire RPC failed for a reason other than a missing function. One line per acquisition. The caller keeps retrying inside its budget or deadline, then fails closed. |
| `mt5_xlease_renew_failed` | WARNING | none beyond `event_type` | A single renew call failed. The lease is declared lost only if no renew succeeds inside the lost-after window. |
| `mt5_xlease_release_failed` | WARNING | none beyond `event_type` | A release (or the release of a late-landing grant) failed. The row expires on its own TTL; nothing needs doing. |

## 4. Rollback

The down file is `supabase/migrations/down/20261126120000-rollback.sql`. It is manual and sits off the
auto-apply path.

1. Run the marker query alone, FIRST, and read which database it names. `current_database()` is
   `postgres` on both projects and proves nothing; a NULL marker means re-set it before anything else.

   ```sql
   SELECT shobj_description(oid, 'pg_database') AS which_database
     FROM pg_database WHERE datname = current_database();
   ```

2. Run the file as one transaction: `psql --single-transaction -v ON_ERROR_STOP=1 -f <the down file>`.
   It refuses if the three functions are not all present, drops them and the table, and verifies by
   catalogue.
3. **No worker rollback order is needed.** The client treats a missing lease RPC as "in-process lock
   only" and says so loudly (`mt5_xlease_unavailable`), which is the behaviour before this phase.
   Expect that event from both services after a rollback until the migration is applied again.
4. The migration ledger row is left in place by the down file. To re-apply, delete that ledger row in
   the same change, or mark it reverted with `supabase migration repair --status reverted` against the
   database the marker query named.
5. **Never hand-edit lease rows.** An orphaned lease expires by itself after the TTL, and a release
   keeps the row on purpose. A hand edit can hand the terminal to two callers.

## 5. Post-deploy checks (the coordinator, after merge)

Every check is read-only and recorded as a count or a yes/no. Run the marker query first for any read
of the PROD database, and one query per call.

**(a) Both deploys carry the merge, and the migration has applied.**
- Record each service's current deployment creation time and confirm each carries the merge commit.
  The services are the backfill worker and the API service.
- Read the PROD migration ledger's newest version (`SELECT max(version) FROM
  supabase_migrations.schema_migrations;`, marker first) and confirm it is at or after the lease
  migration's version.
- **Night 1 is the first 00:40Z derive after the LATER of the two deploys, and after the migration's
  PROD apply.** The holdings poll runs in the API process, so a night where only the worker carried the
  lease is not a night of the fix.

**(b) The two services spell the gateway endpoint the same way.** Compare `MT5_GATEWAY_HOST` and
`MT5_GATEWAY_PORT` across the backfill and API services and record "equal: yes" or "equal: no" for the
pair. Never record the values. A "no" means the services will take two lease rows for one terminal;
fix the variables before counting any night.

**(c) After the first night, the lease table holds one row per terminal.** Count the rows whose last
`site` is a job-terminal site and the rows whose last `site` is a validation-terminal site (the map in
section 2). Each count is at most 1. Two job-terminal rows is a spelling split and the lease serializes
nothing. Record two counts, no digests.

**(d) Neither service logged `mt5_xlease_unavailable` since its deploy.** Record "0" or the count per
service. A non-zero count means the migration or the schema cache was missing for some period.

## 6. Nightly evidence

The seven-night count, its pass rule, the evidence queries and the per-night record are in the section
that plan 09 of this phase adds below this one after the deploy, because the queries are proven against
the lane before they are written here. Night 1 is defined in 5(a).
