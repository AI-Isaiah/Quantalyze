# Phase 211: SYNCJOBS - Research

**Researched:** 2026-11-14
**Domain:** Postgres enqueue-dedup bookkeeping (PL/pgSQL SECURITY DEFINER), Python analytics-service sync/job handlers, SQL gate + mutation-runner corpus
**Confidence:** HIGH on code facts (every caller, body, test and census was read in this checkout at HEAD `8fc78b69a`); MEDIUM on three design choices that were flagged as Open Questions (all RESOLVED in 211-CONTEXT.md D11-8..D11-13).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(Copied from `211-CONTEXT.md` `## Implementation Decisions`; the full text there is authoritative.)

**LASTSYNC-SEED (TODOS `167.1.2.2.2-SYNCTRADES-LASTSYNC-SEED`)**
1. Both readers change, not just the route: `fetch_trades` (`analytics-service/routers/exchange.py`, `POST /fetch-trades`) and `run_sync_trades_job` (`analytics-service/services/job_worker.py`). The entry can be deleted only when both are fixed.
2. The new seed copies the cron's rule exactly: the strategy's stored high-water = the newest `trades` row with `is_fill = false`, floored to 00:00 UTC of its day; no such row = `None` = full-reach fetch. Source is `_load_strategy_high_waters` / `_high_water_floor_iso` in `routers/cron.py`; ONE definition. Move to a shared module or import, never copy. If cron tests patch it by name, the name stays importable from `routers.cron`.
3. A failed high-water read fails open to a full reach, never back to `last_sync_at`. Over-fetch is idempotent. After the change `last_sync_at` is no longer a seed anywhere on these two paths.
4. Fills seed in `run_sync_trades_job`: the daily-P&L `fetch_all_trades` read seeds from the stored high-water (decision 2). The fills read (`fetch_raw_trades`) keeps `api_keys.last_fetched_trade_timestamp` as its preferred cursor; when NULL it falls back to the stored daily high-water, not to `last_sync_at`. `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD` stays open and unchanged; the phase report says so.
5. Unchanged in `fetch_trades`: the 7-day trade-span guard; the route still writes `last_sync_at` and `account_balance_usdt` after the fetch. The MT5 arm of `run_sync_trades_job` fetches no daily P&L and is unaffected.
6. The test must fail on today's code: a fresh `last_sync_at` beside an old stored daily trade must still reach back to that trade's UTC day, for both the route and the job. A second case: a failed high-water read produces `since_ms=None`, not the `last_sync_at` value.

**D5 (TODOS `161.1-D5`)**
1. Only `computation_status` moves to an entry snapshot (and `computation_warned` if the guard needs it), read once at handler entry of `run_stitch_composite_job`; `_stamp_failed` uses it in place of the live read for `existing_status`. Mirrors `_read_entry_publish_state` / `_refresh_publish_status` in the derive handler.
2. The `data_quality_flags` read stays LIVE at stamp time (M-2 read-modify-write).
3. The entry read is gated on the composite refresh marker (`ledger-refresh-composite`). A failed entry read is reported then re-raised (job fails rather than guessing), like the derive entry read. An unmarked job keeps today's LOUD path with no extra read.
4. The live marker re-read (`_read_refresh_marker_state`, Phase 164.6.7 D-05) and the `_stamp_io` failure handling are unchanged.
5. M-3 source scan (`tests/test_stitch_composite_job.py`) greps the whole function body, comments included, for the publish-lifecycle token. New comments say "live".
6. The test must go RED when reverted: a sibling bridge call moves `computation_status` after entry and before the stamp (F2 shape); the marked job's failure must still be judged against the entry status.

**D11 (TODOS `161.1-D11`) - FOUNDER DECISION 2026-11-14: OPTION B ("Record + drop the flag")**, on every dedup hit, in BOTH overloads of `_enqueue_compute_job_internal`, at BOTH return sites (optimistic look-up, lost-race re-read):
- D11-1 Record: caller `p_metadata` goes into a new side table `compute_job_dedup_events` (deduped-onto job id, caller metadata, time). No other key is merged into the job row.
- D11-2 Drop the flag: when the existing row carries a refresh marker (`source` in `ledger-refresh`, `ledger-refresh-composite`) and the caller's metadata carries a `correlation_id` and no refresh marker, retract the marker in the same function in the shape `retract_ledger_refresh_marker` uses (drop `source`, set `refresh_marker_retracted`). A `done` row is never rewritten.
- D11-3 Never add a marker, merge nothing else.
- D11-4 The Python retraction stays as a backstop (`_retract_refresh_marker_on_reuse`); it then answers `no_marker`.
- D11-5 CENSUS (founder constraint): before the migration, verify no background path sends `correlation_id` to `enqueue_compute_job` / the internal function. Any background sender found BLOCKS the plan and is reported. (See Summary: two exist.)
- D11-6 Both overloads rewritten from their latest definitions (10-param `20261024120000`; 7-param `20260716090000`, verify nothing newer). Needs migration-reviewer and rls-policy-auditor clean before ship. Auto-applies to PROD after TEST.
- D11-7 D12 (read-modify-write residual) and the Phase 191 D-02 gap are closed by D11-2 for the resync-tail collision; comments that describe D-02 as open are updated.

SC-4 (ROADMAP): each fix has a test that goes RED when it is reverted.

### Claude's Discretion
- Where the shared high-water helper lives, and its exact signature.
- How D5's entry snapshot is passed to `_stamp_failed`: a closure variable or a parameter.
- Test file placement, following the existing `tests/test_*` conventions.

### Deferred Ideas (OUT OF SCOPE)
- `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD` stays open. The fills read keeps trusting `last_fetched_trade_timestamp`; nobody has traced which writer put it ahead.
- The cron path in `routers/cron.py` was already fixed by Phase 167.1.2.2.2 (out of scope).
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs were provided (`Requirements: TBD` in ROADMAP). The four ROADMAP success criteria (SC-1..SC-4) are the contract; each is mapped in `## Validation Architecture`.
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives that bind this phase (project `CLAUDE.md` + global `~/.claude/CLAUDE.md`; treated as locked):
- **Migration auto-applies to PROD after TEST** with no human gate; every review (migration-reviewer, rls-policy-auditor) must be clean BEFORE merge. Never edit `supabase-migrate.yml` to force a deploy; the remedy for a migration that refuses on TEST is to revert the merge.
- **TEST holds PROD's catalogue, not its data:** a migration's self-verify block must be CATALOGUE-ONLY (`pg_proc`, `pg_class`, `has_*_privilege`). `scripts/lint-migration-data-dependence.mjs` fails CI on a data-reading `DO` block that raises (no opt-out marker exists).
- **No PROD/CLI access from this checkout** (CLI is linked to PRODUCTION). Do not run `supabase db push` or any remote supabase CLI. Do not regenerate `src/lib/database.types.ts` with the linked CLI (see Pitfall 13).
- Pytest only from `analytics-service/`; CI mypy strict as CI runs it; never `importlib.reload` in tests; use `grep -a`; cite code by symbol, not line number, in durable text.
- **Every ship writes a CHANGELOG entry and moves VERSION + package.json (byte-equal 4-digit strings)**, in one `chore(release)` commit; never `npm version`. Never write the CI skip-trailer tokens in a commit/PR text, even to deny them.
- A ship branch must change nothing under `.planning/`. Public repo: no secrets, PROD ids, home paths in tracked text.
- Tests verify intent: neuter -> see RED -> restore from a byte backup (never `git checkout/restore/stash` on uncommitted work). New `supabase/tests` file or arm moves several censuses: grep them all (listed below).
- CI-adjacent: `src/__tests__/critical-regressions.test.ts` asserts VERSION == package.json.
- Banned packages (CLAUDE.md table): none relevant; this phase installs no packages.

## Summary

Three small, independent corrections plus one cross-cutting SQL change. LASTSYNC-SEED and D5 are Python-only and low risk. D11 is the dangerous one: a `CREATE OR REPLACE` of the function that every enqueue in the system goes through, shipped in a migration that auto-applies to PROD.

**D11-5 CENSUS RESULT, reported as the constraint demands: YES, two BACKGROUND senders of `correlation_id` exist.** `src/app/api/cron/reconcile-strategies/route.ts` (kind `reconcile_strategy`) and `src/app/api/cron/sync-funding/route.ts` (kind `sync_funding`) both call `enqueue_compute_job` with `p_metadata: { correlation_id }` from Vercel cron. By the founder's own wording this blocks the plan until acknowledged. The mitigating fact, measured: the retraction in D11-2 can only fire when the EXISTING row carries a ledger-refresh marker, and dedup is per `(target, kind)`; the only kinds that can ever carry a marker are `derive_broker_dailies`, `compute_analytics_from_csv` and `stitch_composite` (full table below). So those two senders can never retract anything today. But that is a property of two other files, not of the migration. **Recommendation (needs founder/orchestrator acknowledgement before plan lock, Open Question 1): add a kind scope to the SQL predicate (`p_kind IN ('derive_broker_dailies','compute_analytics_from_csv','stitch_composite')`) so the "no background retraction" property is structural.** It mirrors the kind scope the status bridge already uses as containment. The census also found the INVERSE gap: the finalize-wizard `stitch_composite` enqueue is user-initiated but sends only `{source: "finalize-wizard"}` (no `correlation_id`), so D11-2's predicate never fires for it and its TS backstop (`retractInheritedRefreshMarker`) remains the only retraction on that path. D11-7 therefore closes D-02 for senders that carry `correlation_id` (process_key_long tails, keys/sync), not for finalize-wizard.

The 7-argument overload of `_enqueue_compute_job_internal` is unreachable (any 7-arg call raises 42725 because the 10-arg overload has DEFAULTs on its last three parameters) [CITED: `supabase/migrations/20260924230827_fanin_initial_status_10param.sql` header "D-27"]. D11-6 says to rewrite it anyway; it can only be pinned by a body-text arm (or by an in-transaction `DROP` of the 10-arg overload, see Pitfall 5), never by a plain call. `enqueue_compute_portfolio_job` (its only caller) has zero callers outside generated types.

**Primary recommendation:** Implement D11 as ONE new migration with (a) a new service-role-only side table with an FK to `compute_jobs` ON DELETE CASCADE, (b) a small new SECURITY DEFINER helper that is called at all four return sites (2 overloads x 2 sites) and that itself calls the existing `public.retract_ledger_refresh_marker(...)` (single source of the marker list and of the one-statement shape), and (c) a verbatim re-base of both overloads with only those four call sites added. Do LASTSYNC-SEED by moving the two cron helpers into a new leaf module `analytics-service/services/trade_resume.py` and re-importing them into `routers/cron.py` under their existing names. Do D5 with a gated entry read mirroring the derive handler's, passed to `_stamp_failed` as a closure variable.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| User-triggered trade fetch resume point (`POST /fetch-trades`) | API / Backend (analytics-service route) | Database (reads `trades`) | The route owns the seed; the data it needs is the stored `trades` high-water |
| Queued `sync_trades` resume point | API / Backend (worker handler `run_sync_trades_job`) | Database | Same helper, called through `db_execute` from the async handler |
| Enqueue dedup bookkeeping + marker retraction | Database (SECURITY DEFINER function) | API / Backend (Python/TS backstops) | Atomicity with the dedup hit is only possible inside the function; backstops stay for callers outside the predicate |
| Composite failure-stamp protection judgment | API / Backend (worker handler) | Database (status bridge `sync_strategy_analytics_status`) | Python holds the snapshot; the SQL bridge reads the live marker independently |
| Dedup side table | Database / Storage | - | Service-role only; no UI reads it |

## Standard Stack

No new external packages. Everything is in-repo code and existing tooling.

### Core
| Component | Version / location | Purpose | Why standard |
|-----------|--------------------|---------|--------------|
| PL/pgSQL SECURITY DEFINER, `SET search_path = public, pg_catalog` | existing house style | the two overload re-bases + helper | every sibling in `supabase/schema/functions/` |
| `public.retract_ledger_refresh_marker(uuid, text)` | migration `20261106120000`; snapshot `supabase/schema/functions/retract_ledger_refresh_marker.sql` | the ONE-statement retraction D11-2 reuses | already pinned by Python + TS parity tests |
| pytest (+ pytest-asyncio, `asyncio_mode = auto`) | `analytics-service/pytest.ini` | Python RED-first tests | existing suite |
| mypy `--strict` via `analytics-service/pyproject.toml` | CI step "Type gate - mypy strict" | typing gate | CI parity |
| `scripts/pg-lane/run.sh` + `scripts/mutation-runner/run.mjs` | existing | SQL gate execution + neuter-to-RED proof | the repo's SQL gate machinery |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New helper function called at 4 sites | Inline record+retract at each of the 4 sites | Inline = 4 copies + a second/third copy of the marker list that the parity tests do not cover (see Pitfall 4). Helper = one more function (REVOKE/GRANT/COMMENT/snapshot) but one marker-list owner |
| Helper calls `retract_ledger_refresh_marker` | Helper re-writes the UPDATE | Re-writing duplicates the marker list and shape; calling reuses both |
| FK `job_id -> compute_jobs ON DELETE CASCADE` | No FK (like `strategy_analytics.computation_error_job_id`) | No FK leaves orphan rows forever; FK ties growth to existing retention (done 30d, failed 90d) |

**Installation:** none.

## Package Legitimacy Audit

No external packages are installed or recommended by this phase. Audit table not applicable. Packages removed (SLOP): none. Packages flagged (SUS): none.

## Architecture Patterns

### System Architecture Diagram (D11)

```
caller (PostgREST RPC / SQL fan-out)
   |  enqueue_compute_job(target, kind, p_metadata)
   v
public.enqueue_compute_job  --(ownership / allocator auth)-->  public._enqueue_compute_job_internal (10-arg; 7-arg is dead)
                                                               |
          +----------------------------------------------------+
          | 1. 4-way XOR guard, retired-kind guard, parent lock (_fan_in_lock_rows)
          | 2. optimistic look-up (target,kind, in-flight)
          |       hit  --> [SITE A] helper(v_existing_id, p_metadata, p_kind) --> RETURN v_existing_id
          | 3. INSERT ... ON CONFLICT DO NOTHING RETURNING id
          |       row  --> RETURN v_new_id            (a fresh job: nothing to record)
          | 4. lost race: re-read winner
          |       none --> RAISE 40001
          |       found--> [SITE B] helper(v_new_id, p_metadata, p_kind) --> RETURN v_new_id
          v
helper _record_enqueue_dedup(job, metadata, kind)         (new; SECDEF; service_role-only EXECUTE)
   a. IF metadata is a non-empty object AND kind in marker kinds AND metadata has correlation_id
         AND metadata.source is not a marker  -->  v_res := retract_ledger_refresh_marker(job, correlation_id)
   b. IF metadata is a non-empty object  -->  INSERT compute_job_dedup_events(job_id, caller_metadata, retracted_marker)
```

### Recommended Project Structure
```
supabase/migrations/<ts>_enqueue_dedup_record_retract.sql   # table + helper + 2 re-based overloads + ACL + catalogue-only verify
supabase/migrations/down/<ts>-rollback.sql                  # manual rollback (house convention)
supabase/schema/functions/*.sql                             # REGENERATED by `npm run schema:functions` (never hand-edit)
supabase/tests/test_enqueue_dedup_record_retract.sql        # new gate, RED-UNDER + RED-UNDER-M twins
analytics-service/services/trade_resume.py                  # new leaf: high-water helpers (imports stdlib + services.db only)
analytics-service/tests/test_fetch_trades_resume_seed.py    # new: route RED-first
analytics-service/tests/test_sync_trades_resume_seed.py     # new: job RED-first
analytics-service/tests/test_stitch_composite_entry_snapshot.py  # new: D5 F2-shape RED-first
```

### Pattern 1: one-statement retraction reuse (D11-2)
**What:** inside the helper, call the existing function instead of re-writing its UPDATE; read its jsonb answer to record what happened.
**Why safe:** `retract_ledger_refresh_marker` is a single UPDATE; under READ COMMITTED a blocked UPDATE re-evaluates WHERE and SET against the latest committed row, so a concurrent claim's `unified_backbone_at_claim` merge is never lost [VERIFIED: `supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql` header "WHY ONE STATEMENT IS ENOUGH"].
**The function body being reused, verbatim [VERIFIED: supabase/schema/functions/retract_ledger_refresh_marker.sql:23-30]:**
```sql
  UPDATE public.compute_jobs
     SET metadata = (metadata - 'source')
                    || jsonb_build_object('refresh_marker_retracted', metadata ->> 'source',
                                          'correlation_id', p_correlation_id)
   WHERE id = p_job_id
     AND status <> 'done'
     AND (metadata ->> 'source') IN ('ledger-refresh', 'ledger-refresh-composite')
  RETURNING metadata ->> 'refresh_marker_retracted' INTO v_marker;
```
Its four answers are `retracted` (with `marker`), `done`, `no_marker`, `no_row`.

### Pattern 2: entry snapshot, gated on the marker (D5)
Mirror the derive handler's block [VERIFIED: `analytics-service/services/job_worker.py`, the `_read_entry_publish_state` block inside `run_derive_broker_dailies_job`]: gated on `_entry_source == LEDGER_REFRESH_SINGLE_KEY_SOURCE`, read through `db_read_with_retry`, failure -> programming errors re-raised unchanged after `logger.error` + `_capture_read_failure`, anything else -> `RefreshMarkerRereadUnavailable` (TRANSIENT) `from` the cause. For the composite there is no open exchange at entry, so the derive block's `aclose_exchange` step does not apply.

### Pattern 3: shared helper re-exported under the old name (LASTSYNC-SEED)
`routers/cron.py` keeps `_high_water_floor_iso` and `_load_strategy_high_waters` as importable names (`from services.trade_resume import high_water_floor_iso as _high_water_floor_iso, ...`). No cron test patches either name (rg over `analytics-service/tests`: zero hits for both names), but `cron.py` calls them as module globals and the CONTEXT keeps the name importable.

### Anti-Patterns to Avoid
- **Merging caller keys into the job row.** Option C was rejected; D11-3 forbids it (would switch a pending `process_key_long` job to another `verification_id`).
- **Adding a fifth `SELECT id INTO v_new_id`, or any `INTO STRICT`,** to either overload body: `supabase/tests/test_enqueue_internal_destrict.sql` counts exactly four form-agnostic re-reads, requires 0 `INTO STRICT`, and requires the `serialization_failure` raise and `p_kind = 'compute_analytics'` guard to survive (Pitfall 3).
- **A copy of the marker list in a third place** that the Python/TS parity tests do not read (Pitfall 4).
- **A data-reading `DO` block that RAISEs** in the migration (Pitfall 9).
- **Re-deriving the high-water in `fetch_trades`/the job** instead of calling the shared helper.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Marker retraction | a second UPDATE with its own `IN (...)` list | `public.retract_ledger_refresh_marker(uuid, text)` | one list, one shape, already parity-pinned |
| Stored high-water | a new query in the route/job | `_load_strategy_high_waters` + `_high_water_floor_iso` (moved) | cron tests pin its exact supabase chain (`.eq("is_fill", False)`, order, limit) |
| Day-aligned floor | manual `ms - ms % day` | `_high_water_floor_iso` output through `parse_since_ms` | already day-aligned and tz-normalised |
| 504-retried read | bare `db_execute` | `db_read_with_retry` | SFH-R2-02 class |
| Stamp I/O cause preservation | new try/except | `_stamp_io` (inside the stamp closure only) | `tests/test_stamp_io_exhaustive.py` statically scans the closures |
| Side-table RLS | new policy style | the `strategy_sync_cursors` form (ENABLE RLS, `USING (false)` policy, REVOKE, GRANT) | see Pitfall 6 for why NOT `FORCE` |

## D11 Census (Question 1)

Method: `rg` over `analytics-service` (non-test), `src` (non-test), every `supabase/schema/functions/*.sql` that mentions an enqueue call, and every `cron.schedule` body in `supabase/migrations`. All of them were read.

### Python (`analytics-service`, non-test)
| Site | Kind | Metadata keys sent | Initiator |
|------|------|--------------------|-----------|
| `routers/cron.py` cron_sync recompute loop | `derive_broker_dailies` | none | BACKGROUND (cron) |
| `services/job_worker.py` `run_sync_trades_job` follow-on (`JOB_CHAIN_FOLLOW_ON["sync_trades"][0]`) | `derive_broker_dailies` | none | chain edge (background or user sync) |
| `services/job_worker.py` `_enqueue_allocator_compose` | `derive_allocator_equity` | none | background chain |
| `services/job_worker.py` `_enqueue_csv_analytics` (derive -> hop 2, `JOB_CHAIN_FOLLOW_ON["derive_broker_dailies"][0]`) | `compute_analytics_from_csv` | only when marked: `source`, `chained_from`, `publish_status`, `publish_warned`; else none | chain edge; carries a marker, NEVER `correlation_id` |
| `services/account_identity.py` recompose after a new marker | `derive_allocator_equity` | none | background |
| `services/ingestion/long_fetch.py` `process_key_long` tail (`JOB_CHAIN_FOLLOW_ON["process_key_long"]`) | `derive_broker_dailies` or `sync_trades` | `{correlation_id}` | USER (resync/onboard request) |
| `routers/process_key.py` (two sites: `_resume_duplicate_job`, the long-fetch dispatch) | `process_key_long` | `correlation_id`, `verification_id`, `flow_type`, `source` (a venue name) | USER (HTTP request) |
| `scripts/probe_composite_claimtime.py` `_enqueue` | any (lane probe) | probe-chosen (`source: ledger-refresh-composite` marker) | manual/lane only |

`job_worker.py` never forwards `job["metadata"]` wholesale into an enqueue: all four enqueue sites build their payload from scratch (read: lines containing `p_metadata` in `job_worker.py` and `long_fetch.py`; only `_enqueue_csv_analytics` builds a dict, from marker + publish state).

### TypeScript (`src`, non-test)
| Site | Kind | Metadata | Initiator |
|------|------|----------|-----------|
| `app/api/cron/reconcile-strategies/route.ts` | `reconcile_strategy` | `{ correlation_id }` | **BACKGROUND (Vercel cron) - SENDS `correlation_id`** |
| `app/api/cron/sync-funding/route.ts` | `sync_funding` | `{ correlation_id }` | **BACKGROUND (Vercel cron) - SENDS `correlation_id`** |
| `app/api/keys/sync/route.ts` | `stitch_composite` | `{ source: "keys/sync", correlation_id }` | USER (owner resync) |
| `app/api/strategies/finalize-wizard/route.ts` | `stitch_composite`, `sync_trades` | `{ source: "finalize-wizard" }` | USER; **no `correlation_id`** (retraction predicate never fires) |
| `app/api/strategies/csv-finalize/route.ts` | `compute_analytics_from_csv` | `{ source: "csv-finalize", fmt }` | USER; no `correlation_id` |
| `app/api/intro/route.ts` | `compute_intro_snapshot` | `{ contact_request_id, correlation_id }` | USER |
| `app/api/allocator/holdings/sync/route.ts` | via `request_allocator_holdings_sync` (SQL, no metadata) | none | USER |

### SQL (current bodies, `supabase/schema/functions/`)
Callers of `enqueue_compute_job` / the internal function: `enqueue_ledger_refresh_for_strategies` (`derive_broker_dailies`, metadata `{source:'ledger-refresh', enqueued_at}`), `enqueue_ledger_composite_refresh` (`stitch_composite`, `{source:'ledger-refresh-composite', enqueued_at}`), `enqueue_poll_positions_for_all_strategies` (`{enqueued_by, enqueued_at}`), `enqueue_poll_allocator_positions_for_all_keys`, `enqueue_derive_broker_dailies_for_allocator_keys`, `request_allocator_holdings_sync`, `set_departed_key_history_inclusion`, `update_allocator_mandates` (metadata `NULL`), the two wrappers, and the function itself. `commit_scenario_batch.sql` only mentions it in a comment. **None sends `correlation_id`.** The five `cron.schedule` bodies call these wrapper functions (`SELECT enqueue_...()`); the two cron bodies that mention the RPC name (`reconcile_dropped_enqueue_sweep`, `retention_compute_jobs_orphaned_running`) ASSERT its absence in their verify blocks (the sweep INSERTs directly and bypasses the RPC entirely). Migration-time DML callers (older migrations) are historical, not live code.

### Which kinds can carry a refresh marker (the containment fact)
Writers of `source IN ('ledger-refresh','ledger-refresh-composite')`: the two SQL fan-outs above (`derive_broker_dailies`, `stitch_composite`) and the single Python chain edge (`compute_analytics_from_csv`). Nothing writes it for `reconcile_strategy`, `sync_funding`, `process_key_long`, `sync_trades` or `compute_intro_snapshot`. [VERIFIED: rg `ledger-refresh` over `analytics-service` and `src`, plus the SQL bodies read above.] The status bridge uses the same kind scope as its containment [CITED: `COMMENT ON FUNCTION sync_strategy_analytics_status` in `supabase/schema/baseline.sql` "kind is one a refresh can reach (derive_broker_dailies, stitch_composite, or the forwarded chain hop compute_analytics_from_csv)"].

**Definitive answer to "does ANY background path send `correlation_id`?": YES, two (both Vercel cron routes), both to kinds that can never hold a marker. No SQL fan-out, no Python chain edge, no analytics-service cron path sends it.**

## D11 SQL Facts (Question 2)

- **Latest bodies.** The only `CREATE [OR REPLACE] FUNCTION ... _enqueue_compute_job_internal` statements in `supabase/migrations` are in `20260411144407`, `20260418194206`, `20260420073003`, `20260510180226`, `20260716090000` (7-arg at line 49, a superseded 10-arg at 181), `20260826150000`, `20260924230827` and `20261024120000` (10-arg, line 499) [VERIFIED: grep over `supabase/migrations`]. **10-arg latest = `20261024120000`; 7-arg latest = `20260716090000`; nothing newer.** The generated snapshot `supabase/schema/functions/_enqueue_compute_job_internal.sql` holds exactly those two sections (7-arg from `20260716090000`, 10-arg from `20261024120000`).
- **Wrapper resolution.** `public.enqueue_compute_job` always calls the internal function with TEN arguments (`p_strategy_id, NULL, p_kind, p_idempotency_key, p_parent_job_ids, p_exchange, p_metadata, NULL, NULL, p_run_at` and the allocator/api_key variants) [VERIFIED: `supabase/schema/functions/enqueue_compute_job.sql`]. `enqueue_compute_portfolio_job` passes SEVEN (`NULL, p_portfolio_id, 'compute_portfolio', p_idempotency_key, p_parent_job_ids, NULL, p_metadata`) [VERIFIED: `supabase/schema/functions/enqueue_compute_portfolio_job.sql`], so it raises 42725 on every call [CITED: `20260924230827` header D-27, measured there on a throwaway cluster]. **The 7-arg overload is not reachable; D11-6's rewrite of it is untestable by a call.**
- **ACL / catalog text.** 10-arg, restated in `20261024120000`: `REVOKE ALL ON FUNCTION public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;` then `GRANT EXECUTE ... TO service_role;` and a `COMMENT ON FUNCTION` that must keep the phrase `Phase 163 OPS-08`. 7-arg: `REVOKE ALL ON FUNCTION public._enqueue_compute_job_internal(uuid, uuid, text, text, uuid[], text, jsonb) FROM PUBLIC, anon, authenticated;` + `GRANT ... TO service_role;` in `20260515130001` (line 62). `CREATE OR REPLACE` keeps COMMENT and ACL, BUT a Supabase default-grant event trigger can re-open EXECUTE on this function family on every `CREATE OR REPLACE` (migration `20260515130001` records it), so the new migration must RESTATE the REVOKE/GRANT for both overloads and, if the COMMENT is re-issued, keep `Phase 163 OPS-08` verbatim. Name every overload with its full argument list: an unqualified statement "silently failed under two coexisting overloads" in mig 109 [CITED: `20260515130001` header].
- **`retract_ledger_refresh_marker`**: body above; service-role-only; `LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog`. Callable from inside another SECDEF function (the owner holds EXECUTE).
- **Existing SQL gates touching enqueue/dedup** (`supabase/tests`): `test_enqueue_compute_job_dedupe_non_terminal.sql` (B1/B2, 3 twins, SETUP stops at `20260924230827`), `test_enqueue_race_loss_40001.sql` (4 twins), `test_enqueue_internal_destrict.sql` (no twins; structural regex arms, Pitfall 3), `test_compute_analytics_kind_retired.sql` (structural, both overloads), `test_resync_retry_single_job.sql` (calls `enqueue_compute_job` twice with `{'fixture': ...}` metadata), `test_compute_job_metadata_merge.sql` (the retraction function; closest template, 13 arms), `test_fan_in_lock_order_race.sql` / `test_fan_in_failure_cascade.sql` (load `20261024120000`). Their twins edit the migration copy listed in their own `RED-UNDER-SETUP`; none of those lists contains the new migration, so none breaks structurally, but on the real-DB lane (`sql-tests`) they run against the NEW body, so the structural arms must be re-run (Pitfall 3).
- **RED-UNDER conventions** [CITED: `scripts/mutation-runner/GRAMMAR.md`]: each arm that exercises the migration carries a prose `RED-UNDER:` line and an adjacent `RED-UNDER-M:` JSON twin; every `edit`/`insert-after` step carries a MEASURED `occurrences`; markers count only at line start; a mutation may not inject `TEST FAILED (`; the file declares `RED-UNDER-SETUP: {"apply":[...]}` (the pg-lane apply list). Every `TEST FAILED (N)` raise sits directly in the DO body. Template for the apply list: the `RED-UNDER-SETUP` of `supabase/tests/test_fan_in_lock_order_race.sql` (ends with `supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql`), then append `supabase/migrations/20261106120000_refusalrace_metadata_merge_rpcs.sql` and the new migration. [ASSUMED] that this list is sufficient for a gate that only calls `enqueue_compute_job` and reads `compute_jobs`; verify by running it.
- **Censuses a new gate FILE moves (all measured):** `scripts/mutation-floors.mjs` `FILES_FLOOR` (currently `export const FILES_FLOOR = 81;`) +1 and `ARMS_FLOOR` (currently `export const ARMS_FLOOR = 830;`) + one per twinned arm, each with a dated paragraph above the constant; `WAIVED_CEILING` is 0 and stays 0 [CITED: CLAUDE.md]. `src/__tests__/mutation-runner-floors.test.ts` re-derives both independently and fails in BOTH directions (stale-low and stale-high). `node scripts/mutation-runner/run.mjs --parse-only` prints `coverage: files N/M` and the static annotated-unwaived count. A new arm in an EXISTING file moves only `ARMS_FLOOR` (+ that file's per-file line). Also: CHANGELOG entry, VERSION + package.json, and `node scripts/lint-sql-gates.mjs --self-test` + corpus scan must stay clean (7 rules R1..R7 per CLAUDE.md).
- **Migration conventions.** Latest timestamp today: `20261110150000_intro_path_authz_hardening.sql`; the new file must sort after it and after whatever `origin/main` holds when the version is re-picked before the single CI run. Files carry `SET LOCAL lock_timeout = '3s';`, no explicit BEGIN/COMMIT, single-literal RAISE format strings, a catalogue-only verify block, and a manual rollback at `supabase/migrations/down/<ts>-rollback.sql`. `supabase/schema/functions/*.sql` are regenerated with `npm run schema:functions` (`tsx scripts/dump-sql-functions.ts`; CI runs `--check`). `supabase/schema/baseline-carried-migrations.txt` is NOT edited: a migration newer than the dump is the normal replay case (D-F). Backdated-migration guard: `.github/workflows/migration-policy.yml` rejects a new migration older than PROD's tip; keep the timestamp current. **VAC-04** (`migration-drift-check.yml`, `scripts/prod-body-drift-check.sh`) requires one `-- prod-body-ack: <sha256>` pragma per re-based function whose PROD body differs from the snapshot; the precedent computes it as the `live` column of `node scripts/sql-body-normalize.mjs --diff-bodies <new snapshot> <(git show origin/main:supabase/schema/functions/<fn>.sql)` [CITED: `20261024120000` header]. BOTH overloads now change, so the 7-arg gets its own pragma (the last re-base noted "the 7-argument overload is a MATCH"). The new helper has no PROD body and needs none. VAC-08 / baseline-content-drift go red on the PR by construction until apply-on-merge ("stale-baseline drift red counts as green" per project memory).

## D11 Design Details (Question 3)

1. **Where the code goes.** Four call sites, all just before an existing `RETURN`: 10-arg (a) between `IF v_existing_id IS NOT NULL THEN` and its `RETURN v_existing_id;`, (b) between the closing `END IF;` of the `IF v_new_id IS NULL THEN RAISE ...` block and the final `RETURN v_new_id;`; the 7-arg has the identical two shapes. The fresh-INSERT return (`IF v_new_id IS NOT NULL THEN RETURN v_new_id;`) is NOT a dedup and gets nothing. [VERIFIED: `supabase/schema/functions/_enqueue_compute_job_internal.sql:298-300` (`IF v_existing_id IS NOT NULL THEN` / `RETURN v_existing_id;`), `:314-319` (`ON CONFLICT DO NOTHING` / `RETURNING id INTO v_new_id;` / `IF v_new_id IS NOT NULL THEN RETURN v_new_id;`), `:328-358` (the four re-reads then `IF v_new_id IS NULL THEN`).]
2. **Locks and ordering.** Do the record/retract LAST, after the parent lock and after every re-read, and take no further lock after it. The retraction is one UPDATE on the existing row (row lock until commit); the side-table INSERT with an FK takes `FOR KEY SHARE` on the same row, which conflicts with the claim's `FOR UPDATE SKIP LOCKED` (so a claim skips that row for the transaction's length; benign) but not with `mark_compute_job_done`'s non-key UPDATE. A claim that commits first is safe: the blocked UPDATE re-evaluates against the new row (status `running`, `status <> 'done'` still true, `source` still marker) and keeps `unified_backbone_at_claim`. A `done` row never matches. **Residual (Open Question 3):** the 164.9.3.1 lock-order proof covers fan-in rows taken in ascending `(depth, id)` through `_fan_in_lock_rows`; a PARENTED enqueue that dedups onto an unrelated in-flight row would take parent-share first and the dedup row second, in an order the helper does not control [CITED: `20261024120000` header "THE LOCK ORDER"]. Latent (zero callers pass `p_parent_job_ids`; migration `20260924230827` header D-02, and the Python grep for `parent_job_ids` returns none). Recommendation: skip record+retract when `p_parent_job_ids` is non-empty, or founder accepts and books it.
3. **`updated_at`.** The `compute_jobs_set_updated_at_trigger` is BEFORE UPDATE FOR EACH ROW [VERIFIED: `supabase/schema/baseline.sql` `CREATE OR REPLACE TRIGGER "compute_jobs_set_updated_at_trigger" BEFORE UPDATE ON "public"."compute_jobs" FOR EACH ROW`], so the retraction bumps `updated_at` and rewrites `metadata` (that is existing behaviour of today's Python retraction). Readers: `get_user_compute_jobs` and `get_admin_compute_jobs` return both to the UI; `enqueue_poll_positions_for_all_strategies` and `backfill_api_keys_history_reconstructed_at` filter on `updated_at` of `status = 'done'` rows only, which the retraction never touches. The side-table INSERT does not touch the job row's columns (a KEY SHARE lock is not an UPDATE; no trigger fires).
4. **Skip the side-table INSERT for NULL and `{}`.** `p_metadata IS NULL` is what cron.py, the chain edges and most SQL fan-outs send; recording nothing carries no information. Guard: `jsonb_typeof(p_metadata) = 'object' AND p_metadata <> '{}'::jsonb`. Non-object JSON (array/scalar) can be stored by the INSERT path today; for it, skip the record as well (no keys to read, `->>` yields NULL).
5. **Metadata size.** `compute_jobs` has `CONSTRAINT "compute_jobs_metadata_size_bounded" CHECK ((("metadata" IS NULL) OR ("octet_length"(("metadata")::"text") <= 8192)))` [VERIFIED: `supabase/schema/baseline.sql:1930-1969` CREATE TABLE]. A fresh INSERT with larger metadata fails 23514; a DEDUP today never inserts it, so it never fails. If the side table copies the same CHECK, an oversized caller that previously deduped fine would now abort the enqueue (a behaviour change with a PROD blast radius). Decide (Open Question 4): recommended = mirror the CHECK (parity with the fresh-insert contract; fail loud) and verify no caller can exceed it (largest known sender is `process_key.py`'s four small keys); alternative = truncate/skip with a warning.
6. **Growth bound.** FK `job_id UUID NOT NULL REFERENCES public.compute_jobs(id) ON DELETE CASCADE` + `CREATE INDEX ... ON compute_job_dedup_events (job_id)` (otherwise each retention delete seq-scans the child). Retention deletes `done` rows older than 30 days and `failed_*` older than 90 days [VERIFIED: `supabase/migrations/20260515113853_retention_crons_safe.sql` JOB 4/JOB 5 bodies], so events die with their jobs. Dedup rate is low (fan-outs skip strategies with in-flight jobs; only `compute_intro_snapshot` dedups routinely because the unique index excludes that kind but the optimistic look-up does not). Erasure: account deletion cascades strategy -> compute_jobs -> events; add NO delete-guard trigger (and if one is ever added it must exempt `quantalyze.sanitize_in_progress = 'on'`).
7. **Recommended side-table shape (planner may adjust):** `id uuid PK default gen_random_uuid()`, `job_id` (above), `caller_metadata jsonb NOT NULL` (+ size CHECK per item 5), `retracted_marker text NULL` (the marker the SAME call retracted, else NULL), `deduped_at timestamptz NOT NULL DEFAULT now()`. `retracted_marker` is the audit trail that replaces the log line Python used to emit: after D11 the Python backstop answers `no_marker` and (per `test_a_job_with_no_marker_is_silent`) logs nothing, so without this column nobody could tell a SQL retraction happened.
8. **Helper vs inline** (Claude's discretion): helper recommended. It needs its own REVOKE/GRANT/COMMENT/verify arm and appears as a new snapshot file, but it keeps the marker list in one place (regex `->>\s*'source'\)\s*IN\s*\(([^)]*)\)` in the Python and TS parity tests matches only the form `(... ->> 'source') IN (...)`; write the caller-has-no-marker test as `NOT ((p_metadata ->> 'source') IN ('ledger-refresh','ledger-refresh-composite'))` so the same regex still sees it) and extend both parity tests (`analytics-service/tests/test_compute_job_metadata_merge_parity.py`, `src/lib/ledger-refresh-marker.test.ts`) to read the helper's snapshot.

## LASTSYNC-SEED Facts (Question 4)

- **`fetch_trades`** (`analytics-service/routers/exchange.py`, `POST /fetch-trades`): seed is `since_ms = parse_since_ms(key_data.get("last_sync_at"))`, then, `if since_ms is not None:`, a span probe (two `trades` selects, earliest and latest `timestamp`) that sets `since_ms = None` when `span_days < STRATEGY_GATE_MIN_DAYS` (7); its `except Exception` only warns "fall through to the original since_ms". After the fetch it writes `last_sync_at` and `account_balance_usdt` (unchanged by decision 5). Replace the seed with `parse_since_ms(<high-water ISO or None>)` from the shared helper; the probe's except now leaves the high-water value in place (still never `last_sync_at`). The span guard must keep running only on a non-None seed, as today.
- **`run_sync_trades_job`**: `since_ms = parse_since_ms(ctx.key_row.get("last_sync_at"), preferred=ctx.key_row.get("last_fetched_trade_timestamp"))` computed before the `try`; the one `since_ms` feeds `fetch_all_trades(ctx.exchange, since_ms=since_ms)` (ccxt arm only) and `fetch_raw_trades(ctx.exchange, strategy_id, ctx.supabase, since_ms=since_ms)`. Per decision 4 split it into two values: `daily_since_ms` from the helper; `fills_since_ms = parse_since_ms(None, preferred=last_fetched_trade_timestamp)` if non-NULL else `daily_since_ms`. [VERIFIED by reading `parse_since_ms`: `value = preferred if preferred is not None else last_sync_at`; passing `last_sync_at=None` removes the last_sync_at fallback entirely.] Do the high-water read only in the ccxt `else` arm (the MT5 arm fetches no daily P&L); the helper is sync, so call it as `await db_execute(lambda: ...)`.
- **Cron helpers** (`routers/cron.py`): `_floor_to_utc_day_ms` (line ~527), `_high_water_floor_iso(timestamp: str) -> str` (547), `_load_strategy_high_waters(supabase, strategy_ids) -> tuple[dict[str, str | None], str | None]` (560). The query chain is `supabase.table("trades").select("timestamp").eq("strategy_id", sid).eq("is_fill", False).order("timestamp", desc=True).limit(1).execute()`, wrapped per strategy in `try/except Exception` -> `mapping[sid] = None` + an error string, and it NEVER raises. Cron tests exercise it THROUGH THE ROUTE with a fake `trades` table (`_make_mock_supabase_for_cron_sync(trades_rows=..., trades_select_error=...)`, class `TestHighWaterIgnoresFillRows` asserts `("is_fill", False) in queries[0]["eq"]`, `queries[0]["order"] == ("timestamp", True)`, `queries[0]["limit"] == 1`), so the moved helper MUST keep that exact chain and the same fail-open mapping; `parse_since_ms` stays a module global of `routers.cron` (patched in many cron tests by `patch.object(cron_mod, "parse_since_ms", ...)`).
- **Best home:** new leaf `analytics-service/services/trade_resume.py`. `routers/cron.py` and `routers/exchange.py` import only `services.*` at module level; `services/job_worker.py` imports `routers.*` only lazily inside functions (`from routers.portfolio import ...`, `from routers.match import ...`), so a services-level leaf creates no import cycle. Use `logging.getLogger("quantalyze.analytics")` (the logger `routers/cron.py` and `routers/exchange.py` both use) so existing `caplog` expectations keep working.
- **Existing tests to extend / mirror:** `tests/test_exchange_router_c0202.py` has the `stubbed_exchange_router` fixture (uses `evicted("routers.exchange")` from `tests/limiter_stub.py`, no `importlib.reload`) and a hand-built supabase chain mock; `tests/test_job_worker.py` has many `run_sync_trades_job` tests built on `mock_ctx = MagicMock()` with `mock_ctx.supabase.table.side_effect` chains (see `TestSyncTradesPhase2PartialBatchFailure`); `tests/test_cron_router.py` has the filtering fake `trades` table. **No existing test asserts the `since_ms` passed to the job's `fetch_all_trades`** (rg over `test_job_worker.py`, `test_sync_trades_preserves_fills.py`, `test_ana_recon_audit.py`), so the job's RED-first test is new ground; `test_sync_trades_preserves_fills.py` is a live-DB test (skipif no `TEST_SUPABASE_DB_URL`) and is unrelated.
- **Silent-pass hazard:** existing `run_sync_trades_job` tests use a bare `MagicMock` supabase. The new high-water read will run against those mocks, the helper will catch whatever it raises (or `rows()` of a MagicMock), and map to `None` (full reach) with a logged exception, so those tests keep passing while no longer being exercised with a real resume point. Run `tests/test_job_worker.py`, `tests/test_mt5_sync_path.py`, `tests/test_mt5_handover.py`, `tests/test_failed_status_logged.py`, `tests/test_ana_recon_audit.py` after the change and read the new log noise; give the RED-first job test a real filtering `trades` fake like the cron suite's.

## D5 Facts (Question 5)

- `run_stitch_composite_job` (`analytics-service/services/job_worker.py`) defines the nested closure `_stamp_failed(message, *, detail=None)`. It does ONE `strategy_analytics` select of `"data_quality_flags, computation_status"` through `_stamp_io(lambda: db_read_with_retry(_read_existing_failed_row), op=_STAMP_OP_STATUS_READ, ...)`, builds `existing_flags` via `_flags_object_or_dropped`, sets `existing_status`, and computes `_honour_marker = (_job_source == "ledger-refresh-composite" and existing_status in STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES)`. If `_honour_marker`, it re-asks the live marker (`_read_refresh_marker_state(supabase, job.get("id"), LEDGER_REFRESH_COMPOSITE_SOURCE)`) through `_stamp_io`; a non-`PRESENT` answer takes the LOUD path and sets `_lost_protection_of = existing_status`.
- **Change:** take the snapshot at handler entry (after `_stitch_start`, before the member load), gated on `job.get("metadata")` being a dict with `source == "ledger-refresh-composite"`; on the marked path use the snapshot in place of the live `computation_status` for `existing_status`; keep reading `data_quality_flags` live. Narrow the select to `data_quality_flags` only (a dead second column read next to a banned-oracle comment is a trap), or keep it and ignore the column; recommended = narrow. The entry read's failure handling must mirror the derive block (programming errors re-raised unchanged after `logger.error` + `_capture_read_failure`; others `RefreshMarkerRereadUnavailable`), minus `aclose_exchange` (no exchange is open at entry here).
- **M-3 gate** [VERIFIED: `analytics-service/tests/test_stitch_composite_job.py:3438-3440`]: `src = inspect.getsource(run_stitch_composite_job)` then `assert "verification_status" not in src` and `assert "published" not in src`. Banned substrings anywhere in the function source INCLUDING comments and identifiers: `verification_status`, `published`. Note `"published"` also matches `unpublished`/`un-published`; `publish_status`, `publish_warned`, `publish-lifecycle` do NOT match. Do not name the snapshot variable anything containing `published`.
- **Existing composite tests that go red by construction** (the fake `_FakeSupabase` in `tests/test_stitch_composite_job.py` serves `existing_status` to EVERY `strategy_analytics` select and pops `analytics_read_raises` per read): in `tests/test_ledger_refresh_composite_nondestructive.py`, `TestStampReadRetriesAGateway504` (marked job, `assert fake.analytics_reads == 2`) and the two MARKED cases of `TestAFailedStampReadKeepsTheCause` (`marked-persistent-504`, `marked-non-504-first-failure`; the `unmarked-user-stitch-non-504` case is unaffected because unmarked jobs take no entry read). With a marked job the entry read is now the FIRST `strategy_analytics` select, so the queued exceptions hit it and the job fails in the entry path with different text, never reaching the stamp read these tests target. Re-point them (e.g. let the first read answer, then fail the stamp read) by extending the fake. The F2-shape RED-first test needs the fake to serve a DIFFERENT status on the entry read than on the stamp read (a per-read status sequence field). Also run `tests/test_stamp_io_exhaustive.py` (its discovery scenarios include marked composite jobs through `tests.test_derive_broker_dailies_dualmode._build_ctx`), `tests/test_ledger_refresh_gates.py`, `tests/test_failed_status_logged.py`, `tests/test_probe_composite_claimtime.py`.
- **Test that must go RED on revert:** marked job, entry status `complete_with_warnings`; make the sibling bridge move the live row to `computing` (or `failed`) between entry and stamp; assert the error-only write (no `computation_status` / `computation_warned` in the upsert payload) still lands. Neuter: restore the live-read oracle for `existing_status`; the guard disarms and the loud payload (`computation_status = "failed"`) is written.

## Common Pitfalls

### Pitfall 1: the census blocks the plan as written
**What goes wrong:** D11-5 says any background sender of `correlation_id` blocks the plan; two exist (cron routes). **How to avoid:** get the founder/orchestrator to acknowledge the containment fact or accept the recommended kind scope in the SQL predicate (Open Question 1). Do not silently proceed. **Warning sign:** a plan that restates "no background sender" without the two route names.

### Pitfall 2: the predicate misses a user path
finalize-wizard's `stitch_composite` and csv-finalize's `compute_analytics_from_csv` enqueues send no `correlation_id`; their dedup onto a marked job is NOT retracted by SQL (TS backstop only for finalize-wizard; csv-finalize has none). D11-7's wording ("for the resync-tail collision") is accurate; the TODOS entry `161.1-D11` must not be deleted as fully closed without saying so, or the finalize-wizard sender gets `correlation_id` added (a TS edit with 25 assertions in `src/app/api/strategies/finalize-wizard/route.test.ts` that read the enqueue payload).

### Pitfall 3: existing structural arms read the enqueue body
`supabase/tests/test_enqueue_internal_destrict.sql` reads the deployed bodies (comment-stripped `pg_get_functiondef`) and enforces: `c_strict_re = 'INTO[[:space:]]+STRICT\M'` count 0 in BOTH bodies; `c_arm_re = 'SELECT[[:space:]]+id[[:space:]]+INTO[[:space:]]+(STRICT[[:space:]]+)?v_new_id'` count EXACTLY 4 in the 10-arg body; `c_serfail_re` present in both; `c_retired_re = 'p_kind[[:space:]]*=[[:space:]]*''compute_analytics'''` present in both; SECURITY DEFINER + `search_path` value in `pg_proc.proconfig`; the catalog COMMENT of the 10-arg keeps `Phase 163 OPS-08`; ACL arm per overload. [VERIFIED: `supabase/tests/test_enqueue_internal_destrict.sql:484-493` for the regex constants and `:653-670` for the arms.] The new code must add no extra `SELECT id INTO v_new_id` and no `INTO STRICT` (use `v_res := ...`/`SELECT ... INTO v_res` of the helper's result only inside the helper). `test_compute_analytics_kind_retired.sql` requires BOTH overloads still exist and keep the retired-kind text. These run in `sql-tests` against the new body; run them locally in the lane before opening the PR.

### Pitfall 4: a third marker-list copy no parity test covers
`analytics-service/tests/test_compute_job_metadata_merge_parity.py` pins the retraction snapshot's marker lists (`assert len(lists) == 2`) against `LEDGER_REFRESH_JOB_SOURCES`, and the TS twin (`src/lib/ledger-refresh-marker.ts` + `.test.ts`) does the same. Any NEW `IN ('ledger-refresh', ...)` list added by D11 (the caller-has-no-marker test, the kind scope) is unpinned unless both tests are extended to read the new snapshot. Prefer one helper with one list and extend both parity tests (with their widened-copy "can go red" cases).

### Pitfall 5: the 7-arg overload cannot be called
Edit it as a verbatim re-base + the two call sites, restate its REVOKE/GRANT, and pin it with a comment-stripped body-text arm (the shape of arms 12/13 in `test_compute_job_metadata_merge.sql`). A behavioural arm is possible only by `DROP FUNCTION` of the 10-arg overload INSIDE the gate's transaction (DDL is transactional; the gate is `BEGIN ... ROLLBACK`), then calling the 7-arg directly. [ASSUMED] feasible; if it is not, SC-4 for that overload is the body pin only and the plan must say so. The wrapper `enqueue_compute_portfolio_job` raising 42725 is pre-existing and not fixed here.

### Pitfall 6: `FORCE ROW LEVEL SECURITY` on the side table
The writer is a SECURITY DEFINER function (owner = table owner). [VERIFIED: `supabase/migrations/20260919120000_strategy_sync_cursors.sql:160-168`] "Deliberately NO `FORCE ROW LEVEL SECURITY`, and this is a DECISION ... FORCE is the clause under which a SECURITY DEFINER reader degrades CLOSED AND SILENT. This table has ZERO SECURITY DEFINER readers and zero owner-facing tiers, so FORCE buys nothing here and carries a silent-failure mode." Here the SECDEF function is a WRITER, so FORCE could turn every dedup-with-metadata into a policy refusal that aborts the enqueue. `api_key_flow_prices` (`20261101120000`, "row level security is enabled and forced with ZERO policies") has a service_role-only worker writer, a different case. Recommended: `ENABLE` (not FORCE) RLS + `CREATE POLICY ..._deny_all ... FOR ALL USING (false) WITH CHECK (false)` + `REVOKE ALL ... FROM PUBLIC, anon, authenticated` + a POSITIVE `GRANT SELECT ... TO service_role` (lines 185-214 of that migration explain why the positive half is not optional) + a catalogue-only verify of `relrowsecurity`, the policy, and `has_table_privilege` for each role. A SQL gate arm must prove the SECDEF function can INSERT while `anon`/`authenticated` cannot read or write.

### Pitfall 7: lock order for parented enqueues (see Design Details 2 / Open Question 3).

### Pitfall 8: the Python double no longer mirrors SQL
`analytics-service/tests/test_ledger_refresh_reuse_collision.py::_Queue.enqueue` documents and implements "DISCARD `p_metadata`, exactly as in SQL". After the migration that sentence is false for senders with `correlation_id`. No existing Python test breaks (the doubles model Python's view and the backstop is unchanged), but update the docstring, the comment blocks naming D-02 as open (`services/ingestion/long_fetch.py` `_retract_refresh_marker_on_reuse` docstring and the tail comment "there is no merge arm", `services/job_worker.py` REUSE-01 block, `src/lib/ledger-refresh-marker.ts` "D-02, UNCHANGED"), and consider making `_Queue.enqueue` retract so a test shows the Python backstop answering `no_marker`. Python's `no_marker` path is silent by design, hence the `retracted_marker` audit column.

### Pitfall 9: TEST has no data
`[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`: a verify block that reads `compute_jobs` rows and raises fails on TEST and withholds the PROD apply; `scripts/lint-migration-data-dependence.mjs` fails CI for it. Verify = `pg_proc` (both overloads, helper: `prosecdef`, `proconfig` contains `search_path=public, pg_catalog`), `has_function_privilege` for anon/authenticated/service_role, `aclexplode` PUBLIC check, `pg_get_functiondef` contains the helper call twice per overload, table catalogue facts. Behaviour is proven by the SQL gate, not the migration.

### Pitfall 10: default-grant event trigger
Restate REVOKE ALL FROM PUBLIC, anon, authenticated and GRANT EXECUTE TO service_role for BOTH overloads AND the helper after the `CREATE OR REPLACE` / `CREATE FUNCTION`, with grantees named (the 20261106120000 migration's STEP 3 pattern), and assert it in the verify block.

### Pitfall 11: the Python `last_sync_at` writer ordering
`fetch_trades` still writes `last_sync_at` after the fetch (four other readers depend on it); do not remove that write and do not read it back as a seed in the same request.

### Pitfall 12: the span guard on a high-water seed
The span probe reads min/max `timestamp` over ALL stored rows (fills included) and nulls `since_ms` when under 7 days. With a stored-high-water seed this still only widens the reach; keep it.

### Pitfall 13: `database.types.ts`
Generated by `npx supabase gen types` (needs the linked CLI = PROD). The side table has no TypeScript reader and `scripts/check-gdpr-export-coverage.ts` only triggers on tables with a `user_id ... REFERENCES auth.users/profiles` column, which this table lacks; do not regenerate. [ASSUMED] no gate requires the new table in `database.types.ts` (rg for `database.types` in workflows/scripts found only the GDPR script's remediation text).

### Pitfall 14: commit/PR hygiene
CHANGELOG discipline (one entry, sections from this repo's own vocabulary, `### Root cause` / `### Notes` for known limits), VERSION + package.json byte-equal, no skip-trailer tokens, no AI attribution trailers per project memory, ship branch changes nothing under `.planning/`.

## Code Examples

### Helper skeleton (shape only; names are recommendations)
```sql
-- Source: shapes taken from supabase/schema/functions/retract_ledger_refresh_marker.sql (SECDEF + search_path)
CREATE FUNCTION public._record_enqueue_dedup(p_job_id uuid, p_kind text, p_metadata jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_res    jsonb;
  v_marker text;
BEGIN
  IF p_job_id IS NULL OR jsonb_typeof(p_metadata) IS DISTINCT FROM 'object' OR p_metadata = '{}'::jsonb THEN
    RETURN;
  END IF;
  IF p_kind IN ('derive_broker_dailies', 'compute_analytics_from_csv', 'stitch_composite')   -- Open Question 1
     AND p_metadata ? 'correlation_id'
     AND NOT (COALESCE(p_metadata ->> 'source', '') IN ('ledger-refresh', 'ledger-refresh-composite')) THEN
    v_res := public.retract_ledger_refresh_marker(p_job_id, p_metadata ->> 'correlation_id');
    IF v_res ->> 'outcome' = 'retracted' THEN
      v_marker := v_res ->> 'marker';
    END IF;
  END IF;
  INSERT INTO public.compute_job_dedup_events (job_id, caller_metadata, retracted_marker)
  VALUES (p_job_id, p_metadata, v_marker);
END;
$$;
```
(The `COALESCE` matters: a caller with `correlation_id` and NO `source` at all (the `process_key_long` tail sends exactly `{correlation_id}`) must count as "no marker"; a bare `NOT (NULL IN (...))` is NULL and would silently skip the retraction. The gate needs an arm for that exact caller. The parity regex `->>\s*'source'\)\s*IN` does not match the `COALESCE(... ->> 'source', '') IN` spelling, so if the list is written this way the parity tests must be extended with a second regex, or the test written as `(p_metadata ->> 'source') IN (...)` inside `COALESCE(..., FALSE)` instead; decide in the plan.)

### Call sites in each overload
```sql
  IF v_existing_id IS NOT NULL THEN
    PERFORM public._record_enqueue_dedup(v_existing_id, p_kind, p_metadata);   -- SITE A
    RETURN v_existing_id;
  END IF;
  ...
  PERFORM public._record_enqueue_dedup(v_new_id, p_kind, p_metadata);          -- SITE B, after the NULL-raise block
  RETURN v_new_id;
```

### Shared Python helper (LASTSYNC-SEED)
```python
# analytics-service/services/trade_resume.py  (moved verbatim from routers/cron.py; same query chain, same fail-open mapping)
def high_water_floor_iso(timestamp: str) -> str: ...
def load_strategy_high_waters(supabase: Any, strategy_ids: list[str]) -> tuple[dict[str, str | None], str | None]: ...

# routers/exchange.py::fetch_trades
hw, hw_err = load_strategy_high_waters(supabase, [req.strategy_id])
since_ms = parse_since_ms(hw.get(req.strategy_id))      # None => full reach; never last_sync_at
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Cron resumes from `api_keys.last_sync_at` | Cron resumes from stored per-strategy high-water | Phase 167.1.2.2.2 | This phase extends it to the two remaining readers |
| Retraction as Python read-modify-write | One-statement SQL `retract_ledger_refresh_marker` | Phase 191 (`20261106120000`) | D11 reuses it inside the enqueue |
| Derive reads publish status live in the guard | Entry snapshot carried forward | Phase 161.1 | D5 applies it to the composite stamp |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The `test_fan_in_lock_order_race.sql` apply list + `20261106120000` + the new migration is a sufficient `RED-UNDER-SETUP` for the new gate | D11 SQL Facts | Gate fails to apply on the pg-lane; add missing fixtures |
| A2 | In-transaction `DROP FUNCTION` of the 10-arg overload lets a gate call the 7-arg directly | Pitfall 5 | SC-4 for the 7-arg is body-pin only |
| A3 | No gate requires the new table in `database.types.ts` | Pitfall 13 | A typecheck/test gate fails on the PR |
| A4 | `GRANT SELECT` (not INSERT) to `service_role` suffices because only the SECDEF owner writes | Pitfall 6 | A future direct service-role writer gets 42501 (positive-half lesson) |
| A5 | Mirroring the 8192-byte CHECK is acceptable (callers cannot exceed it) | Design Details 5 | An oversized dedup that used to succeed aborts an enqueue |
| A6 | Local Python 3.14.3 runs the suite equivalently to CI's 3.12 (`pyproject.toml` `python_version = "3.12"`) | Environment | A local pass hides a 3.12-only failure |
| A7 | pytest in CI runs the whole suite (`pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80`); the new tests keep coverage above 80 | Validation | Coverage gate trips |

## Open Questions (RESOLVED)

1. **Background `correlation_id` senders (BLOCKS under D11-5).** **RESOLVED: D11-8 (kind scope).**
   - Known: `cron/reconcile-strategies` and `cron/sync-funding` send `correlation_id` from cron; they target kinds that can never carry a marker.
   - Unclear: whether the founder accepts "structurally impossible today" or wants it made structural.
   - Recommendation: add the kind scope to the SQL predicate (Code Examples) and state the census with both route names in the migration header; get acknowledgement before plan lock.
2. **finalize-wizard / csv-finalize collision gap.** **RESOLVED: D11-9 (recorded residual).**
   - Known: neither sends `correlation_id`; D11-2 does not fire for them.
   - Recommendation: accept (D11-7 says "resync-tail"), keep the TS backstop, and reword the TODOS closure honestly; or add `correlation_id` to the finalize-wizard stitch metadata (TS edit + test churn).
3. **Parented-enqueue lock order.** Skip record+retract when `p_parent_job_ids` is non-empty (recommended) or accept and book it. **RESOLVED: D11-10 (skip parented).**
4. **Side-table metadata size policy** (mirror the 8192 CHECK vs truncate vs skip). **RESOLVED: D11-11 (record `{oversize_bytes: n}`, never raise).**
5. **Does the retraction write `correlation_id` onto the existing row?** Reusing `retract_ledger_refresh_marker` does (it sets `correlation_id` to the caller's). That matches the Python backstop today (provenance only) and D11-2 says "in the shape retract_ledger_refresh_marker uses"; confirm it is intended, since D11-3 says "no other key is merged". **RESOLVED: D11-12 (yes, part of the retraction).**
6. **7-arg overload.** D11-6 locks rewriting it although it is unreachable; confirm the body-pin-only proof is acceptable for SC-4 there. **RESOLVED: D11-13 (body pin accepted).**

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| python3 (+ ccxt, fastapi, supabase importable) | pytest, mypy | yes | 3.14.3 (CI uses 3.12) | `make install` creates `analytics-service/.venv`; none exists in this worktree |
| pytest | Python tests | yes | one `-k source_scan` test ran green in 15 s | - |
| mypy | strict gate | yes | 2.0.0 (compiled) | - |
| psql, `pg_ctl`, `initdb` | `scripts/pg-lane/run.sh` | yes (binaries found) | not probed | `PGBIN` override |
| docker | `scripts/local-stack/run.sh` | CLI present (`Docker version 29.9.2` client); daemon NOT verified | - | pg-lane covers the SQL gates; the local-stack lane is CI's `sql-tests` |
| supabase CLI | local stack only | installed, but linked to PRODUCTION | - | never run against a remote from this checkout |
| node / npm | vitest, schema:functions, mutation runner | not probed this session | - | `npm ci` |

Missing with no fallback: none identified. Docker daemon state and node version are unverified.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Python | pytest (`analytics-service/pytest.ini`: `testpaths = tests`, `pythonpath = .`, `asyncio_mode = auto`) |
| Types | mypy strict; run from `analytics-service/` |
| SQL | plain PL/pgSQL gates in `supabase/tests/test_*.sql` (pgTAP is not installed); lane = `scripts/pg-lane/run.sh`; neuter proof = `scripts/mutation-runner/run.mjs` |
| TS | vitest (`npm test`) for parity tests and floors |

### Commands (all run from the repo root unless noted)
- Quick Python: `cd analytics-service && python3 -m pytest tests/test_fetch_trades_resume_seed.py tests/test_sync_trades_resume_seed.py tests/test_stitch_composite_entry_snapshot.py -q`
- Affected existing Python suites: `cd analytics-service && python3 -m pytest tests/test_cron_router.py tests/test_exchange_router_c0202.py tests/test_job_worker.py tests/test_stitch_composite_job.py tests/test_ledger_refresh_composite_nondestructive.py tests/test_stamp_io_exhaustive.py tests/test_ledger_refresh_reuse_collision.py tests/test_compute_job_metadata_merge_parity.py tests/test_long_fetch.py tests/test_mt5_sync_path.py -q`
- Full suite as CI: `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` [CITED: `.github/workflows/ci.yml` `python` job]
- mypy as CI: `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` [CITED: `.github/workflows/ci.yml` step "Type gate - mypy strict over the running-service surface"]
- One SQL gate on the throwaway lane: `bash scripts/pg-lane/run.sh --workdir <scratch-dir> --apply <each path from the file's RED-UNDER-SETUP, in order> --gate supabase/tests/test_enqueue_dedup_record_retract.sql` [CITED: `scripts/pg-lane/README.md` CLI contract]
- Neuter proof for one file: `node scripts/mutation-runner/run.mjs --file supabase/tests/test_enqueue_dedup_record_retract.sql` (diagnostic, never exits 0); static census: `node scripts/mutation-runner/run.mjs --parse-only`; gate lint: `node scripts/lint-sql-gates.mjs --self-test` then `node scripts/lint-sql-gates.mjs`; migration data-dependence lint: `node scripts/lint-migration-data-dependence.mjs`; snapshot regen/check: `npm run schema:functions` / `npm run schema:functions:check`
- TS parity + floors: `npx vitest run src/lib/ledger-refresh-marker.test.ts src/__tests__/mutation-runner-floors.test.ts`

### Phase Success Criteria -> Test Map
| SC | Behavior | Test type | Test (new) | Neuter to prove RED |
|----|----------|-----------|-----------|---------------------|
| SC-1 route | fresh `last_sync_at` beside an old stored daily trade still reaches that trade's UTC day | unit (route) | `tests/test_fetch_trades_resume_seed.py` (reuse `stubbed_exchange_router`; filtering `trades` fake) | restore `parse_since_ms(key_data.get("last_sync_at"))`; the asserted `since_ms` becomes the `last_sync_at` value |
| SC-1 route | failed high-water read -> `since_ms is None`, not `last_sync_at` | unit | same file | make the helper's `except` return `last_sync_at` or re-raise |
| SC-1 job | same two cases through `run_sync_trades_job` (ccxt arm); plus fills read uses `last_fetched_trade_timestamp` when set and the high-water when NULL | unit | `tests/test_sync_trades_resume_seed.py` (filtering `trades` fake on `mock_ctx.supabase`; capture the two `since_ms` args) | restore the old `parse_since_ms(last_sync_at, preferred=...)`; drop the fills fallback |
| SC-1 cron unchanged | cron tests still pass with the helper moved | regression | `tests/test_cron_router.py` (already exists) | - |
| SC-2 | dedup records caller metadata (both return sites, both overloads: 10-arg by call, 7-arg by body pin/DROP trick) | SQL gate | `supabase/tests/test_enqueue_dedup_record_retract.sql` | edit the migration copy so a call site is removed; the arm for that site names itself first |
| SC-2 | marked row + caller `correlation_id` and no marker -> marker retracted, `retracted_marker` recorded; marked caller, no-`correlation_id` caller, `{}`/NULL caller, `done` row, unmarked row, non-marker kind -> NOT retracted | SQL gate | same file | widen/narrow the predicate (twin per arm) |
| SC-2 | no other key merged into the job row; fresh INSERT records nothing | SQL gate | same file | add a merge to the helper |
| SC-2 | ACL + RLS: SECDEF writer works; `anon`/`authenticated` cannot read or write the table; helper and overloads service-role only | SQL gate | same file (ACL arms use post-apply `sql` twins like arms 1-2 of `test_compute_job_metadata_merge.sql`) | post-apply GRANT to `anon` |
| SC-2 | marker list parity for the new copy | Python + TS | extend `test_compute_job_metadata_merge_parity.py`, `ledger-refresh-marker.test.ts` | widened-copy case (already the pattern) |
| SC-3 | marked composite job whose live status moves after entry is still judged on the entry status | unit | `tests/test_stitch_composite_entry_snapshot.py` | revert to the live-read oracle |
| SC-3 | failed entry read: reported then re-raised (TRANSIENT; programming errors unchanged); unmarked job takes no extra read | unit | same file | remove the gate / the re-raise |
| SC-4 | every row above names its neuter | all | - | recorded in each test's docstring, restored from a byte backup |

### Sampling Rate
- Per task commit: the quick Python command and, for SQL tasks, the one-gate pg-lane run.
- Per wave merge: affected existing suites + `mypy` command + `--parse-only` + both lints.
- Phase gate: full CI-equivalent pytest + mypy + vitest for the two TS files + a FULL `node scripts/mutation-runner/run.mjs` if the host has the disk (about 15 GB free; otherwise record "not run" as `scripts/mutation-floors.mjs` precedent does and let CI `sql-mutation` FULL compare the floors).

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_fetch_trades_resume_seed.py`, `test_sync_trades_resume_seed.py`, `test_stitch_composite_entry_snapshot.py`
- [ ] `_FakeSupabase` extension in `tests/test_stitch_composite_job.py` (per-read status sequence; skip-N-reads before raising) and re-pointing of the four marked stamp-read tests
- [ ] `supabase/tests/test_enqueue_dedup_record_retract.sql` + its `RED-UNDER-SETUP`
- [ ] Python venv for this worktree (`make install` in `analytics-service/`) if the system interpreter is not wanted

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json` (absent = enabled).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | - (no auth surface changed) |
| V3 Session Management | no | - |
| V4 Access Control | yes | service-role-only side table (ENABLE RLS + deny policy + REVOKE + positive GRANT); SECDEF helper EXECUTE only to `service_role`; REVOKE restated after `CREATE OR REPLACE` |
| V5 Input Validation | yes | `jsonb_typeof = 'object'` guard, size CHECK, `correlation_id` read with `->>` into a text parameter only; no dynamic SQL |
| V6 Cryptography | no | - |
| V7/V8 Data protection | yes | side table holds caller metadata (correlation ids, `contact_request_id`, `verification_id`); FK cascade ties erasure to the job/account; no PII keys known; not in the GDPR export (no `user_id` column) |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Default-grant event trigger re-opens EXECUTE on a SECDEF function after `CREATE OR REPLACE` | Elevation of privilege | restate REVOKE/GRANT, catalogue verify with `has_function_privilege` + `aclexplode` |
| Search-path hijack of a SECDEF function | Tampering | `SET search_path = public, pg_catalog`, schema-qualify every object |
| Caller-controlled `p_metadata` used to force a protection downgrade | Tampering | retraction only drops a marker toward the LOUD path, never adds one; kind scope; gated on an existing marker and non-`done` status |
| Oversized metadata growing the side table | DoS | size CHECK + FK cascade retention |
| Unbounded loud-path exposure from a background sender | Tampering/DoS | kind scope (Open Question 1) |

## Sources

### Primary (HIGH confidence, read in this checkout this session)
- `supabase/schema/functions/_enqueue_compute_job_internal.sql`, `enqueue_compute_job.sql`, `enqueue_compute_portfolio_job.sql`, `retract_ledger_refresh_marker.sql`, `enqueue_ledger_refresh_for_strategies.sql`, `enqueue_ledger_composite_refresh.sql` and the other enqueue callers
- `supabase/migrations/20261024120000_fan_in_graph_and_decision_cascade.sql`, `20260924230827_fanin_initial_status_10param.sql`, `20260716090000_...`, `20260515130001_...`, `20261106120000_refusalrace_metadata_merge_rpcs.sql`, `20260919120000_strategy_sync_cursors.sql`, `20261101120000_api_key_flow_prices.sql`, `20260515113853_retention_crons_safe.sql`
- `analytics-service/routers/{cron,exchange,process_key}.py`, `services/job_worker.py`, `services/ingestion/long_fetch.py`, `services/exchange.py` (`parse_since_ms`), `services/db.py`
- `src/app/api/**` enqueue routes, `src/lib/ledger-refresh-marker.ts`
- `supabase/tests/test_enqueue_internal_destrict.sql`, `test_compute_job_metadata_merge.sql`, `test_enqueue_compute_job_dedupe_non_terminal.sql`, `test_compute_analytics_kind_retired.sql`; `analytics-service/tests/test_stitch_composite_job.py`, `test_ledger_refresh_composite_nondestructive.py`, `test_ledger_refresh_reuse_collision.py`, `test_compute_job_metadata_merge_parity.py`, `test_cron_router.py`, `test_exchange_router_c0202.py`
- `scripts/mutation-floors.mjs`, `scripts/mutation-runner/GRAMMAR.md`, `scripts/pg-lane/README.md`, `.github/workflows/ci.yml` (mypy, pytest steps), `.github/workflows/migration-drift-check.yml`, `migration-policy.yml`
- TODOS entries `167.1.2.2.2-SYNCTRADES-LASTSYNC-SEED`, `161.1-D5`, `161.1-D11`, `161.1-D12`

### Secondary / Tertiary
- None. No web sources were needed: this is an in-repo phase. No external documentation (Context7) was consulted.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - no new packages; all components exist.
- Architecture: HIGH for the call sites and the reuse of the retraction function; MEDIUM for the helper-vs-inline and lock-order choices (Open Questions 3, 5).
- Pitfalls: HIGH - each is tied to a file that was read.
- Census: HIGH - Python/TS/SQL enumerated from code, not from the CONTEXT.

**Research date:** 2026-11-14
**Valid until:** 2026-11-21 (the repo moves daily: re-measure the latest migration timestamp, the floors, and the caller census at plan time; ledger claims are dated claims).
