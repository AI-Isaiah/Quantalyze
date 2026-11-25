# Runbook — MT5 server-clock replay (MT5D-03, Phase 230)

**Owner:** the coordinator (the founder's session). Every step that touches PROD, the shared MT5
terminal or Railway is run by the coordinator, never by a phase agent.
**Audience:** whoever replays the `202-MT5-CLOCK-LEAD-01` moved values under both server-clock settings and
attributes each one to the clock switch or to another named cause.
**Risk:** the one-shot capture logs the shared MT5 terminal into each active key's account from a third
process. It writes no row, but it moves the terminal, so the live workers' in-process registries go stale
and both services are restarted as the last step.

## 1. Purpose and boundaries

MT5D-03 asks that the MT5 derive values which moved without explanation are replayed under both
server-clock settings, and that each moved value is attributed to the clock switch or to another named
cause. This runbook is the tooling half: the capture contract, the write review, the commands, the replay
and the attribution arithmetic. It closes the `TODOS.md` entry for `202-MT5-CLOCK-LEAD-01` once the
coordinator records the per-scope counts.

- **D-02 ("I run it (Recommended)").** The coordinator runs the capture. The phase's agents never run the
  capture, never log the terminal in and never touch PROD, TEST, Railway or the gateway.
- **The replay writes no stored value (155.2 freeze).** `scripts/mt5offset_dry_run.py` opens no database
  connection and no socket; it reads one scratch JSON file and writes only the files named on its command
  line.
- **Nothing here goes to a tracked path.** Raw deals, key ids and the ordinal map live only in the
  coordinator's scratchpad, referred to below as `$S`.

## 2. Clock history, from the repo's records

These are the repo's record of the settings, not a read of Railway variables. The replay shows consistency
with them, not that they were applied.

| From | Server clock | Source |
|---|---|---|
| go-live | fixed 10800 | `202-05-SUMMARY.md` (v1.21 milestone, clock-lead lines), `CHANGELOG.md` `[0.133.18.4]` |
| 2026-11-01T07:11Z | fixed 7200 | the same records |
| 2026-11-03T13:38:28Z | rule `us`, backfill service | `CHANGELOG.md` `[0.133.18.4]`, `175-VERIFICATION.md` |
| 2026-11-03T13:38:36Z | rule `us`, API service | the same; `MT5_SERVER_UTC_OFFSET_S` deleted on both |

Under `us` the broker clock is +3 h in US summer and +2 h in winter. Fixed 7200 and `us` therefore agree in
winter and differ in summer by one hour at the deal's day boundary; fixed 10800 and `us` agree in summer and
differ in winter.

**One fold per key (DEC-03-A).** The older side of every 202 pair was derived after the 7200 setting and
before the switch to `us`: the b0 side of s6, s9 and s10 on 2026-11-02, the c0 side of s2, s5, s8 and s13 on
2026-11-03 before 13:38Z. Every derive rewrites the whole history, so no scope still carries 10800 rows. The
replay is `--legacy-offset-s 7200 --rule us`. A second run with `--legacy-offset-s 10800` is a control only: it
shows the winter moves that no 202 pair can contain.

The US fall change in 2025 is 2025-11-02 06:00Z, confirmed against `services.mt5_server_clock` (`_dst_window_utc("us", 2025)`).
The 2026 change is 2026-11-01 06:00Z. Re-run that call if a boundary check below depends on another year.

## 3. 202's recorded moved sets (counts only)

| Pair | Scope | Moved values | Notes |
|---|---|---|---|
| b0 to b1 | s6 | 31 | all in US summer (an aggregate statement for the three) |
| b0 to b1 | s9 | 24 | 24 of 120 active summer days changed, 0 of 36 active winter |
| b0 to b1 | s10 | 17 | sum 72 |
| c0 to c1 | s2 | 24 | first changed 2025-10-30, last 2026-08-08; plus 29 vanished rows, 2025-11-17 to 2025-12-15, all US winter (15 nonzero) |
| c0 to c1 | s5 | 21 | first changed 2026-03-25, last 2026-10-01 |
| c0 to c1 | s8 | 21 | identical statistics to s5 |
| c0 to c1 | s13 | 21 | identical statistics to s5; sum 87 |

s5, s8 and s13 report identical counts and probably resolve to one key. The coordinator's private
scope-to-key map decides that; the arithmetic below is per scope either way. Because identical counts make a
count-only match weak, the dry run's `--days-out` flag exists: it lets the coordinator compare the moved DAYS.

## 4. The capture script contract (DEC-03-B)

The script is specified here and is never committed as source. Plan 10 of Phase 230 materializes the text into
the coordinator's scratchpad from this contract, re-runs the write review at its own head and hands both over.

**Imports allowed:** `services.db.get_supabase`; `services.encryption` `get_kek` and `decrypt_credentials`;
`services.mt5_validation` `parse_mt5_credentials` and `mt5_venue_account_id`; `services.mt5_client` `Mt5Client`,
`Mt5Session` and `mt5_terminal_key`; `services.mt5_read.read_mt5_deal_ledger`; `services.mt5_concurrency`
`mt5_derive_read_bound_s`, `_MT5_DERIVE_READ_TIMEOUT_S` and `_MT5_HISTORY_WAIT_S`; the standard library.

**Never called, each with its reason:**

- the terminal lease helper (`mt5_terminal_lease`) and the database lease client: the lease writes a row
  (CONTEXT [Capture], DEC-03-C), and the capture must write none;
- `record_mt5_terminal_handover`: it INSERTs a `cron_runs` row when the holder changed;
- the bounded restart, `Mt5Client.restart` and the terminal process recycle: they restart the shared terminal;
- the terminal scrub: it deletes account data from the terminal;
- the account-unit persist: it UPDATEs `api_keys`;
- anything in `job_worker` or `main_worker`: they carry every writer;
- any insert, update, upsert, delete or RPC call.

**Key selection:** ONE select on `api_keys` for `exchange = 'mt5'`, `is_active` true and `disconnected_at`
null, reading only `id` and the credential columns `decrypt_credentials` needs (`dek_encrypted`,
`api_key_encrypted`, `api_secret_encrypted`, `passphrase_encrypted`). The coordinator re-reads the
schema before running; the column list is not pinned here.

**Per key, sequentially:**

1. Build the session as `job_worker._make_mt5_session` does, without importing `job_worker`: parse the three
   credential slots with `parse_mt5_credentials`, read `MT5_GATEWAY_HOST` and `MT5_GATEWAY_PORT` from the
   environment, and construct `Mt5Session(client=Mt5Client(host, int(port)), login=..., investor_password=...,
   server=..., venue_account_id=mt5_venue_account_id(<raw login slot>))`. The terminal identity is
   `mt5_terminal_key(host, port)`, the one spelling; the script never hand-writes `host:port`.
2. Run `read_mt5_deal_ledger(session, now=<UTC now>, settle_history=True)` through `asyncio.to_thread` under
   `asyncio.wait_for`, bounded by
   `mt5_derive_read_bound_s(read_s=_MT5_DERIVE_READ_TIMEOUT_S, wait_s=_MT5_HISTORY_WAIT_S, fresh=True)`,
   with the constants read from the DEPLOYED module. `settle_history=True` because the capture always logs
   in fresh. The script does not pass `holder`.
3. Close the client in a `finally`. `Mt5Client.close` closes only our rpyc socket.
4. A timeout records `{"status": "not_captured", "error_class": "TimeoutError"}`, records every remaining key
   as not captured with class `Aborted`, and stops, because a zombie read may still be driving the terminal.
5. Any other exception records its class name only and continues.

For a captured key the record is `{"status": "captured", "deals": <read.deals>, "equity": <info["equity"]>,
"balance": <info["balance"]>, "currency": <info["currency"]>}`, taken from the read's PRE `account_info`.

**Output:** exactly the JSON the dry run's module docstring names, in capture order (the object's key order is
the only source of the report's ordinals):

```
{"offset_s": 7200, "keys": {"<key id>": {"status": "captured", "deals": [...], "equity": 0.0, "balance": 0.0, "currency": "..."} | {"status": "not_captured", "error_class": "..."}}}
```

`offset_s` is the legacy offset the replay folds under, so the 10800 control prints the dry run's mismatch
warning by design.

**stdout carries only** `CAPTURE-PROGRESS mt5-key-<n> <status> <error class or ->` lines and one final
`CAPTURE-JSON <one-line json>` line. Nothing is written inside the container.

## 5. Write review at the reviewed sha

Reviewed at 9ac57ef4f4b96e0c3bb615f741b43e341781fd4a

The review reads the tree at that sha, which already carries #1346 and #1348 (rebased onto `2636fb1e5`). It is
a grep of every allowed module's body (plus the two modules `mt5_read` and `mt5_concurrency` import, `mt5_handover`
and `mt5_probe`) for `.insert(`, `.update(`, `.upsert(`, `.delete(`, `.rpc(`, `enqueue`,
`record_mt5_terminal_handover` and `mt5_terminal_lease`, then a read of every call that reaches `services.db`
or a supabase client. The grep found only comments and docstrings, the lease and handover definitions that the
script never calls, and one `cron_runs` insert inside `mt5_handover._insert_handover_row`, reachable only from
`record_mt5_terminal_handover`.

| File | Symbol | What it writes |
|---|---|---|
| `services/db.py` | `get_supabase` | Nothing. Builds the client from env. The script's own `.table("api_keys").select(...).execute()` is one SELECT. The only grep hit is a `.rpc()` mention in a docstring |
| `services/encryption.py` | `get_kek`, `decrypt_credentials` | Nothing (env read, pure Fernet decrypt) |
| `services/mt5_validation.py` | `parse_mt5_credentials`, `mt5_venue_account_id` | Nothing (pure parse) |
| `services/mt5_client.py` | `Mt5Client.__init__` | An rpyc connection. No row |
| `services/mt5_client.py` | `Mt5Client.login` (with `_timed`, `emit_mt5_stage_event`, `_note_terminal_answered`, `_note_terminal_holder`) | Logs the gateway terminal into the key's account (the intended terminal-state change); a log line; in-process dict entries in this short-lived process. No row, no queue |
| `services/mt5_client.py` | `Mt5Client.account_info`, `history_deals_get`, `server_tick_times`, `_materialize_rows` | Read only. `server_tick_times` returns tick times and counts and never calls `symbol_select` |
| `services/mt5_client.py` | `Mt5Client.close` -> `_teardown_transport` | Closes our rpyc socket. Never `shutdown()` (D-35) |
| `services/mt5_client.py` | `mt5_terminal_key` | Nothing (string join) |
| `services/mt5_probe.py` | `assert_expected_login`, `normalise_mt5_server` | Nothing (compare and raise) |
| `services/mt5_read.py` | `read_mt5_deal_ledger`, `_settle_deal_history`, `log_mt5_poll_server_verdict` | Read, sleep and log. `log_mt5_poll_server_verdict` is a log line only. One in-process dict entry via `note_mt5_history_settled`; no row |
| `services/mt5_handover.py` | `normalize_mt5_holder`, `SITE_DERIVE` (imported by `mt5_read`) | Nothing (pure normaliser, constant). `record_mt5_terminal_handover` and `_insert_handover_row` are defined here and never called by the script |
| `services/mt5_concurrency.py` | `mt5_derive_read_bound_s` and the two constants | Nothing. The module imports `record_mt5_terminal_handover` at import time; the script never calls `mt5_terminal_lease`, the only caller |

**The one difference from the 164.6.6.2.3-08 table:** `read_mt5_deal_ledger` in
`analytics-service/services/mt5_read.py` now takes a `holder` keyword (#1346, in this tree). It feeds only the
server-verdict log line. The script does not pass it. The table also names `server_tick_times` and
`log_mt5_poll_server_verdict`, which were already in `mt5_read` (155.1, 225-20) and were not itemised in the
precedent.

**Excluded by design, never called:** `mt5_terminal_lease` (its release awaits `record_mt5_terminal_handover`,
which INSERTs a `cron_runs` row when the holder changed, and a held lease would write a row of its own),
`record_mt5_terminal_handover`, `_mt5_bounded_restart`, `Mt5Client.restart`, `recycle_terminal_process`,
`scrub_terminal_account_data`, `_persist_account_unit`, the whole of `job_worker`. On a timeout the script
records the class, touches nothing and aborts.

## 6. Coordinator steps

Let `S` be the coordinator's scratchpad directory. Every output below goes there.

**(0) Confirm the deployed commit.** Read the backfill deployment's commit sha from Railway, then run

```bash
git diff --stat <reviewed sha> <deployed sha> -- \
  analytics-service/services/db.py analytics-service/services/encryption.py \
  analytics-service/services/mt5_validation.py analytics-service/services/mt5_client.py \
  analytics-service/services/mt5_read.py analytics-service/services/mt5_concurrency.py \
  analytics-service/services/mt5_probe.py analytics-service/services/mt5_handover.py
```

Empty means the section 5 review holds. Otherwise re-run the section 5 grep at the deployed sha before going on.

**(1) Marker query.** Run the CLAUDE.md marker query first, alone, and it must name PROD. Then every PROD
statement below is a SELECT.

**(2) Quiet window.** Outside 00:40 to 01:40Z and away from the 08:00Z poll. A SELECT shows no running,
queued or retry-waiting compute job of a kind that touches the MT5 terminal. Re-read the kind list from
`job_worker.py` (the `kind ==` dispatch ladder) before running; at the reviewed sha the superset is
`derive_broker_dailies`, `sync_trades`, `process_key_long`, `poll_positions`, `sync_funding` and
`poll_allocator_positions`. Record the list you used in the step.

```sql
SELECT count(*) FILTER (WHERE status = 'running')      AS running,
       count(*) FILTER (WHERE status = 'pending')      AS queued,
       count(*) FILTER (WHERE status = 'failed_retry') AS retry_waiting
  FROM public.compute_jobs
 WHERE kind IN ('derive_broker_dailies', 'sync_trades', 'process_key_long',
                'poll_positions', 'sync_funding', 'poll_allocator_positions');
```

Once the Phase 230 lease migration has applied to PROD, run a second SELECT: no `public.mt5_terminal_leases`
row with a non-NULL `owner_token` and `expires_at` after `now()`. Heal and validate holds never appear in the
job queue, so this is the only proof for them.

```sql
SELECT count(*) AS live_holds
  FROM public.mt5_terminal_leases
 WHERE owner_token IS NOT NULL AND expires_at > now();
```

Counts only; all must be 0.

**(3) The one-shot command.** `B64` is the base64 of `$S/mt5_capture_230.py` (plan 10's hand-off) with newlines
removed:

```bash
B64=$(base64 < "$S/mt5_capture_230.py" | tr -d '\n')
railway ssh --service quantalyze-analytics-backfill \
  "cd /app && python3 -c \"import base64;exec(base64.b64decode('${B64}'))\"" \
  | tee "$S/capture.raw" | grep '^CAPTURE-PROGRESS '
sed -n 's/^CAPTURE-JSON //p' "$S/capture.raw" > "$S/captured.json"
python3 -c 'import json,sys;d=json.load(open(sys.argv[1]));k=d["keys"];print("keys",len(k),"captured",sum(1 for v in k.values() if v.get("status")=="captured"))' "$S/captured.json"
```

Nothing goes to a tracked path.

**(3b) Fallback (DEC-03-D).** The same command with `--service quantalyze-analytics`. It runs the same image
with the same gateway and key-decryption env, and `railway ssh` into it was measured working on 2026-11-25.
If both routes fail, STOP and ask the founder. Do not improvise a start-command probe: that protocol has two
conflicts with this phase and the runbook picks neither. (a) It needs the script inside the image, which
contradicts DEC-03-B (the script is never committed). (b) The alternative of printing the output into the
deploy log puts raw deal rows into Railway's log store, which T-230-10 forbids.

**(4) Bracket mismatch.** If any key reads `not_captured` with `Mt5AccountMismatchError` (the login bracket
refused a terminal moved by a heal or validate), re-run the whole capture once in a fresh quiet window and keep
both runs' counts.

**(5) Restart both services,** the 164.6.6.2.3-08 sequence. Run both (2) SELECTs immediately before each
restart, then:

```bash
railway restart --service quantalyze-analytics-backfill --yes
railway restart --service quantalyze-analytics --yes
```

then read each service's health (the backfill worker's healthz and the API `/health`). It is a restart, not a
redeploy. Why: after a third process moved the terminal, the live workers' per-process holder and
history-settled registries are stale, so the next MT5 read in each must start from empty registries.

**(6) Replay,** from `analytics-service` on the phase branch:

```bash
python -m scripts.mt5offset_dry_run --captured "$S/captured.json" --rule us --legacy-offset-s 7200 \
  --out "$S/report-7200-us.md" --map-out "$S/ordinals.json" --days-out "$S/days-7200-us.json"
```

Exit 1 means some key is `not measured` and the report says so. The optional control uses
`--legacy-offset-s 10800` with `report-10800-us.md`, `ordinals-10800.json` and `days-10800-us.json`; it prints
the capture-offset mismatch warning by design.

**(7) Map ordinals to 202 scopes** through the coordinator's private scope-to-key map (a SELECT, scratch only).

## 7. Attribution arithmetic (counts only, per scope)

Let M be 202's count for the scope, D202 202's scratch day set when it still exists, and Dclock the scope's
key's `moved_return_days` from `days-7200-us.json`.

- attributed to the clock switch = |D202 intersect Dclock|;
- observed but not predicted = |D202 minus Dclock|, which goes to another named cause;
- predicted but not observed = |Dclock minus D202|, flagged.

When 202's day sets are gone, fall back to the count level (R = `return days changed` against M: R = M is
consistent with all M being the clock; R < M leaves M - R to another cause; R > M flags moves 202 did not
observe) plus boundary checks against the tracked first and last changed days of section 3, labelled weaker.
For the boundary check, the earliest 202 change for s2 (2025-10-30) must fall before the 2025 US fall change
(2025-11-02), and every moved day must sit in US summer.

**s2's 29 vanished winter rows (2025-11-17 to 2025-12-15).** The replay cannot attribute them: 7200 and `us`
agree in winter, so it predicts zero vanished rows by construction. Record the count of those 29 dates present
in the scope key's `target_return_days`. Present means the current fold would write them, so their absence from
c1 points at a storage-side delete, consistent with #1205 gap closure. Absent from the fold points at the fold,
#1196 TINYBASE. Record the result as weighed, not proven, unless both counts are decisive. Never record these 29
as the clock.

**One command** over the days file and a D202 JSON file (`{"mt5-key-N": {"moved": [<dates>], "vanished":
[<dates>]}}`, `vanished` optional), printing the four counts for one ordinal:

```bash
python3 -c 'import json,sys;k=sys.argv[3];d=json.load(open(sys.argv[1]))[k];p=json.load(open(sys.argv[2]))[k];m=set(p["moved"]);v=set(p.get("vanished",[]));c=set(d["moved_return_days"]);print("attributed_to_clock",len(m&c),"observed_not_predicted",len(m-c),"predicted_not_observed",len(c-m),"vanished_present_in_target_fold",len(v&set(d["target_return_days"])),"of",len(v))' "$S/days-7200-us.json" "$S/d202.json" mt5-key-1
```

**Metric caveat.** The dry run folds `combine_mt5_deal_ledger` and `reconstruct_mt5_nav_levels`; the stored 202
values come from the full derive (anchor, marks, flows epilogue). The two agree on day boundaries but not
necessarily on every value, so day-set equality is the evidence and magnitude equality is not claimed. Note too
that a deposit moves its NAV-level day but not a return day (a flow is neutral to a return), so a return-day
move is a trade's P&L crossing midnight; `moved_level_days` is the wider set.

## 8. What the replay cannot show

- What the worker actually executed. The 7200 and `us` windows are the repo's record of the settings.
- Days after the capture's own ledger.
- That the broker's deal list has not grown since 2026-11-06. New winter days do not move under 7200 versus
  `us`, so the counts are unaffected.

## 9. What goes into records

Counts per scope and the dates of the run. Never key ids, logins, amounts or server names; the capture, the
ordinal map and the day sets stay in `$S`.
