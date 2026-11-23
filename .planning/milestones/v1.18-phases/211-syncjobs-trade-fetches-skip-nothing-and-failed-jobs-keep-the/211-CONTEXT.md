# Phase 211: SYNCJOBS — trade fetches skip nothing and failed jobs keep their real status - Context

**Gathered:** 2026-11-14
**Status:** Ready for planning. D11 decided by the founder 2026-11-14 (option B).

<domain>
## Phase Boundary

The phase delivers three corrections to sync and job bookkeeping, as ROADMAP `### Phase 211` states.
It closes TODOS `167.1.2.2.2-SYNCTRADES-LASTSYNC-SEED`, `161.1-D11` and `161.1-D5`.

1. A user-triggered trade fetch, and the queued `sync_trades` job, no longer take their resume
   point from `api_keys.last_sync_at`. The daily holdings poll overwrites that column (SC-1).
2. A deduplicated enqueue keeps or merges the caller's metadata by a recorded rule (SC-2). The
   rule is option B, decided by the founder. See D11 below.
3. The composite `_stamp_failed` judges protection from the status captured at job start, like
   Phase 161.1's other paths (SC-3).
4. Each fix has a test that goes RED when it is reverted (SC-4).

Out of scope:
- `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD` stays open. See LASTSYNC-SEED decision 4.
- The cron path in `routers/cron.py` was already fixed by Phase 167.1.2.2.2.

</domain>

<decisions>
## Implementation Decisions

### LASTSYNC-SEED (TODOS `167.1.2.2.2-SYNCTRADES-LASTSYNC-SEED`)

1. **Both readers change, not just the route.** SC-1 names the user-triggered fetch only. The
   TODOS gate names both `fetch_trades` (`analytics-service/routers/exchange.py`, `POST /fetch-trades`)
   and `run_sync_trades_job` (`analytics-service/services/job_worker.py`). The entry can be
   deleted only when both are fixed.
2. **The new seed copies the cron's rule exactly.** It is the strategy's stored high-water: the
   newest `trades` row with `is_fill = false`, floored to 00:00 UTC of its day. No such row
   means `None`, which is a full-reach fetch. The source is `_load_strategy_high_waters` /
   `_high_water_floor_iso` in `routers/cron.py`, and there is one definition. The plan moves it
   to a shared module or imports it. It must not copy it. If cron tests patch it by name, the
   name stays importable from `routers.cron`.
3. **A failed high-water read fails open to a full reach, never back to `last_sync_at`.** This
   is the cron's direction: over-fetch is idempotent because `sync_trades` rewrites only its own
   payload window. Today's span-guard `except` in `fetch_trades` falls back to the old seed.
   After the change its fallback is the high-water value or `None`, and `last_sync_at` is no
   longer a seed anywhere on these two paths.
4. **The fills seed in `run_sync_trades_job` is decided explicitly.** Today one `since_ms`
   feeds two reads: the daily-P&L `fetch_all_trades` call and the Phase-2 `fetch_raw_trades`
   call.
   - The daily-P&L read seeds from the stored high-water (decision 2).
   - The fills read keeps `api_keys.last_fetched_trade_timestamp` as its preferred cursor. When
     that cursor is NULL it falls back to the stored daily high-water, not to `last_sync_at`.
   - Why: if the fills read stopped trusting `last_fetched_trade_timestamp`, the change would
     reach into `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD`. That entry needs its writer traced,
     and this phase does not close it. The entry stays open and unchanged, and the phase report
     says so.
5. **What stays the same in `fetch_trades`:**
   - The 7-day trade-span guard that forces a full lookback stays as it is.
   - The route still writes `last_sync_at` and `account_balance_usdt` after the fetch, because
     four other readers depend on that column (TODOS entry).
   - The MT5 arm of `run_sync_trades_job` fetches no daily P&L, so it is unaffected.
6. **The test must fail on today's code.** This is the TODOS gate. Set up a fresh `last_sync_at`
   beside an old stored daily trade. The fetch must still reach back to that trade's UTC day, for
   both the route and the job. A second case covers a failed high-water read: it must produce a
   full reach (`since_ms=None`), not the `last_sync_at` value.

### D5 (TODOS `161.1-D5`): composite `_stamp_failed` status snapshot

1. **Only `computation_status` moves to an entry snapshot.** `run_stitch_composite_job` reads
   the row's `computation_status` (and `computation_warned`, if the guard needs it) once, at
   handler entry. `_stamp_failed` uses that captured value in place of the live read for
   `existing_status`. The single-key derive path already works this way: `_refresh_publish_status`
   / `_refresh_publish_warned` are captured at entry in `job_worker.py`, in the
   `_read_entry_publish_state` block.
2. **The `data_quality_flags` read stays LIVE at stamp time.** M-2's read-modify-write must
   still merge over the flags the row holds when the stamp lands. Today one SELECT reads both
   columns, and it splits: the flags stay at stamp time and the status moves to entry.
3. **The entry read is gated and fails like its sibling.** Take the snapshot only when the job
   carries the composite refresh marker (`ledger-refresh-composite`). Only then can the snapshot
   grant protection. A failed entry read takes the same path as the derive entry read:
   reported, then re-raised, so the job fails rather than guessing. An unmarked job keeps today's
   LOUD path with no extra read.
4. **The live marker re-read stays.** The `_read_refresh_marker_state` re-ask (Phase 164.6.7
   D-05) and the `_stamp_io` failure handling are unchanged. The snapshot replaces only the
   oracle that the SQL bridge can move.
5. **Watch the wording.** The M-3 source scan (`tests/test_stitch_composite_job.py`) greps the
   whole function body, comments included, for the publish-lifecycle token. New comments say
   "live", as the existing ones do.
6. **The test must go RED when reverted.** A sibling bridge call moves `computation_status`
   after entry and before the stamp (the F2 shape). The marked job's failure must still be
   judged against the entry status. Revert to the live read and the test must go RED.

### D11 (TODOS `161.1-D11`): enqueue dedup metadata rule. ✓ FOUNDER DECISION 2026-11-14: OPTION B

**⭐ FOUNDER DECISION (2026-11-14, AskUserQuestion): "Record + drop the flag" — option B.**
The rule on every dedup hit, in BOTH overloads of `_enqueue_compute_job_internal` and at BOTH
return sites (the optimistic look-up and the lost-race re-read):
- **D11-1 Record.** The caller's `p_metadata` is recorded in a new side table
  (`compute_job_dedup_events`: deduped-onto job id, caller metadata, time). The job row's other
  keys are NOT merged, so `updated_at` and `get_user_compute_jobs` do not move for that part.
- **D11-2 Drop the flag.** When the existing row carries a refresh marker (`source` in
  `ledger-refresh`, `ledger-refresh-composite`) and the caller's metadata carries a
  `correlation_id` and no refresh marker, the marker is retracted in the same function, in the
  shape `retract_ledger_refresh_marker` uses (drop `source`, set `refresh_marker_retracted`).
  A `done` row is never rewritten (dedup only hits in-flight rows anyway).
- **D11-3 Never add a marker, merge nothing else.** No caller key is ever written into an
  existing job row except the retraction above.
- **D11-4 The Python retraction stays as a backstop** (`_retract_refresh_marker_on_reuse`); after
  this change it answers `no_marker` on the collision it used to handle.
- **D11-5 Census (founder constraint).** Before the migration, the plan verifies that no
  background path sends `correlation_id` to `enqueue_compute_job` / the internal function
  (Python, TS, SQL fan-outs, cron). Any background sender found blocks the plan and is reported.
- **D11-6** Both overloads are rewritten from their latest definitions (10-param:
  `20261024120000`; 7-param: `20260716090000`, verify nothing newer). The migration needs
  migration-reviewer and rls-policy-auditor clean before ship. It auto-applies to PROD after TEST.
- **D11-7** D12 (read-modify-write residual) and the Phase 191 D-02 gap are closed by D11-2 for
  the resync-tail collision; the comments that describe D-02 as open are updated.

**Orchestrator decisions after the D11-5 census (2026-11-14, research `211-RESEARCH.md`).**
These are taken as the reading of the founder's intent ("no background path retracts"), not new
founder questions:
- **D11-8 Kind scope makes "no background retraction" structural.** The census found two
  background (Vercel cron) senders of `correlation_id`: `src/app/api/cron/reconcile-strategies/route.ts`
  (kind `reconcile_strategy`) and `src/app/api/cron/sync-funding/route.ts` (kind `sync_funding`).
  Neither kind can carry a refresh marker, so neither can retract today. The SQL predicate is
  nonetheless scoped to the three marker-capable kinds (`derive_broker_dailies`,
  `compute_analytics_from_csv`, `stitch_composite`), so a future background sender of another
  kind cannot retract either. The two cron senders are reported to the founder; nothing about them
  changes.
- **D11-9 Senders without `correlation_id` are a recorded residual, not widened.** The
  finalize-wizard `stitch_composite` enqueue (`{source: "finalize-wizard"}`, TS backstop retraction
  exists) and the csv-finalize `compute_analytics_from_csv` enqueue (no backstop) send no
  `correlation_id`, so D11-2 does not fire for them. Widening them changes TS callers and is out of
  scope; the residual is booked as a new TODOS entry at ship (it replaces D11 with a narrower id).
- **D11-10 Parented enqueues are skipped.** When `p_parent_job_ids` is non-empty, neither record
  nor retract runs, so the Phase 164.9.3.1 ancestor-first lock order cannot be disturbed. No
  caller passes parents together with a marker-capable kind today.
- **D11-11 The record never fails an enqueue.** `NULL` and `{}` caller metadata are not recorded.
  Metadata above 8192 bytes is recorded as `{"oversize_bytes": n}` rather than raising.
- **D11-12 The retraction reuses `public.retract_ledger_refresh_marker`** (one marker list, one
  UPDATE shape). The `refresh_marker_retracted` / retraction-provenance keys it writes are the
  retraction's own audit trail and count as part of D11-2, not as a merge under D11-3.
- **D11-13 The 7-param overload is unreachable** (any 7-arg call is ambiguous, 42725). It is still
  rewritten from its latest body per the founder constraint, and its SC-4 proof is a body-text pin.

The options considered are kept below as lineage.

**Evidence (measured at HEAD `8fc78b69a`):**
- **What the function does today.** `_enqueue_compute_job_internal` has two overloads. The live
  10-param body was last re-based in `20261024120000_fan_in_graph_and_decision_cascade.sql`; the
  7-param one in `20260716090000`. On a `(target, kind)` hit over
  `('pending','running','done_pending_children')` it does `RETURN v_existing_id`. The lost-race
  re-read after `ON CONFLICT DO NOTHING` also returns an existing id. Both paths discard
  `p_metadata`.
- **Callers send metadata that changes behaviour.** For example:
  - `source` is the D-15 refresh marker (`ledger-refresh`, `ledger-refresh-composite`). It is
    read by `sync_strategy_analytics_status` and by the Python guards.
  - `publish_status` / `publish_warned` are forwarded at the derive to analytics chain edge
    (`job_worker.py` `_enqueue_csv_analytics`) and read by hop 2.
  - `process_key_long` jobs carry `verification_id` and `flow_type` (`routers/process_key.py`).
  - Other callers send `correlation_id`, `source: finalize-wizard` and `source: csv-finalize`.
- **The codebase has a deliberate rule that a merge would break.** "Protection is never
  inherited across a dedup collision, in either direction." See the REUSE-01 block above the
  marker helpers in `job_worker.py`, and `tests/test_ledger_refresh_reuse_collision.py::TestMirrorDirection`.
  A merge that adds missing keys would let a later refresh write its marker onto a user's resync
  job, which sends no `source`. A merge where the caller's values win would switch a pending
  `process_key_long` job to another `verification_id` and abandon the first verification.
- **The gap D11 exists to close.** The resync tail retracts an inherited marker after the
  enqueue returns (`_retract_refresh_marker_on_reuse` → `retract_ledger_refresh_marker`, Phase
  191 D-01). The `long_fetch.py` docstring records the remaining gap between the deduped enqueue
  and that retraction as D-02. It says closing the gap "is a merge arm inside
  `enqueue_compute_job`".
- **Writing to the existing row is not free.** `get_user_compute_jobs` returns `metadata` and
  `updated_at` to the user, and `/api/strategies/[id]/sync-progress` curates that payload.
  `enqueue_poll_positions_for_all_strategies` filters on `compute_jobs.updated_at`. The
  `updated_at` trigger fires on any UPDATE.
- **A merge into a `running` job is invisible to its handler.** The handler holds a claim-time
  copy. Only SQL readers and the re-ask sites would see the merge.

| Option | Rule on a dedup hit | Closes the D-02 gap? | Visible to users? |
|---|---|---|---|
| **A: record only** | The existing row is untouched. The caller's metadata goes to a side record (a new `compute_job_dedup_events` row: job id, caller metadata, time), not into the job row, so `updated_at` and `get_user_compute_jobs` stay unchanged. Both overloads and both return sites get it. | **No.** D11 would be closed on SC-2's wording only, and the D-02 gap would need rebooking as its own entry. | No |
| **B: A plus an atomic marker retraction (recommended)** | A, plus one more step in the same statement. If the existing row carries a refresh marker and the caller sends a `correlation_id` with no marker, the marker is retracted in the shape `retract_ledger_refresh_marker` uses: drop `source`, set `refresh_marker_retracted`. A marker is never added to an existing row, and no other key is merged. The Python retraction stays as a backstop and then answers `no_marker`. | **Yes**, for the resync-tail collision the entry names. | **Yes, in a narrow window.** A failed refresh that a user's resync attached to goes LOUD (the factsheet shows failed) in the seconds before the Python retraction lands. That is the outcome Phase 161.1 already decided, applied earlier. Risk: any background caller that sends a `correlation_id` would also retract. Today only user-initiated paths are known to send one (`process_key`, the resync tail). The plan would verify that census. |
| **C: key merge** (the caller wins or fills absent keys, with marker keys exempt) | Caller keys are written into the pending row. | Partly | **Yes, broadly.** It changes the inputs a handler runs with: `verification_id`, `metrics_snapshot`, `publish_status` and `encrypted_credentials` on the verification path. It also needs per-key exemptions to keep the never-inherit rule. Not recommended. |

**Recommendation was B; the founder took B.** It is the only option that closes what D11 is for, and its one visible
effect already has a decided answer in Phase 161.1: toward the loud path, never toward
suppression. If the founder wants zero visible change, take A. Then book the D-02 gap as a new
TODOS entry rather than deleting D11 as closed.

### Claude's Discretion
- Where the shared high-water helper lives, and its exact signature.
- How D5's entry snapshot is passed to `_stamp_failed`: a closure variable or a parameter.
- Test file placement, following the existing `tests/test_*` conventions.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `routers/cron.py`: `_load_strategy_high_waters`, `_high_water_floor_iso`. This is the stored
  high-water rule, failing open per strategy.
- `services/exchange.py`: `parse_since_ms(last_sync_at, preferred=...)`.
- `job_worker.py`: `_read_entry_publish_state` and `_refresh_publish_status` in the derive
  handler. This is the entry-snapshot pattern D5 mirrors.
- `supabase/schema/functions/retract_ledger_refresh_marker.sql`: the one-statement marker
  retraction (D11 option B would reuse its shape).

### Established Patterns
- Run pytest only from `analytics-service/`, and run mypy strict as CI does. Never use
  `importlib.reload` in tests.
- `parse_since_ms` is patched by module global in the cron tests
  (`patch.object(cron_mod, "parse_since_ms", ...)`).
- Fail open toward over-fetch: a full reach is idempotent.
- Fail loud toward the destructive stamp: never suppress on an unrecognised state.

### Integration Points
- `POST /fetch-trades` in `routers/exchange.py`.
- `run_sync_trades_job` in `services/job_worker.py`.
- `run_stitch_composite_job._stamp_failed` in `services/job_worker.py`.
- For D11: a new migration that re-bases BOTH overloads of
  `_enqueue_compute_job_internal` on their latest bodies. It needs migration-reviewer and
  rls-policy-auditor clean, and it auto-applies to PROD after TEST.

</code_context>

<specifics>
## Specific Ideas

- The LASTSYNC-SEED regression case is fixed by the TODOS gate: a fresh `last_sync_at` beside an
  old stored trade must still reach back to that trade.
- D5's fix shape is fixed by its TODOS entry: take the snapshot at handler entry and carry it
  forward, as `run_csv_strategy_analytics`'s `refresh_publish_status` / `refresh_publish_warned`
  do.

</specifics>

<deferred>
## Deferred Ideas

- `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD` stays open. The fills read keeps trusting
  `last_fetched_trade_timestamp`, and nobody has traced which writer put it ahead.

</deferred>
