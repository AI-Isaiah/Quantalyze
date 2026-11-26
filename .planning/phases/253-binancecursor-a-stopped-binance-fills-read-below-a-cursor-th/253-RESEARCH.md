# Phase 253: BINANCECURSOR - Research

**Researched:** 2026-11-26
**Domain:** Binance raw-fills resume state in `run_sync_trades_job` (Python worker) plus one Supabase migration; data-quality flag durability across the derive and CSV analytics rebuilds
**Confidence:** HIGH on code facts and the D-01 verdict (paper-traced against the real seed and epilogue code, not executed); MEDIUM on venue-doc bearing (docs fetched, ordering unstated); the points tagged `[ASSUMED]` are in the Assumptions Log.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 [auto]:** The choice between (a) letting a stopped read LOWER the shared per-key column and (b) keeping the stop bound in PER-STRATEGY state that the seed reads is decided by RESEARCH, against the locked discriminator in D-02. Recommended default (b): a per-strategy re-read bound the seed takes the minimum with, written only by the run that stopped and cleared only by a run that reads complete through it, leaving `advance_sync_cursor` and its ACL untouched. If research shows (a) survives D-02, (a) is allowed. One-way: either path carries a migration that applies to TEST then PROD with no human stop.
- **D-02 [auto], LOCKED discriminator:** whichever design wins must pass a THREE-STEP INTERLEAVE arm: strategy B (shared key, column set by strategy A, no stored fills of its own) stops below the column; strategy A then syncs cleanly and advances the column; strategy B runs again and MUST re-read its span from the bound. The SC-1 two-run arm is also required, RED on today's code.
- **D-03 [auto]:** SC-1 "the cursor never stamps past stored data" holds for both the per-key column and any new per-strategy state: neither may record a point past where the run is complete through.
- **D-04 [auto]:** No regression for the sibling strategy on the same key and no change for other venues' callers of `advance_sync_cursor`. If (a) wins: DROP + CREATE (never a second overload by `CREATE OR REPLACE` with a new parameter), a default that preserves forward-only behaviour, the live ACL re-applied identically, deploy ordering stated, snapshot and `src/lib/database.types.ts` regenerated, and a no-ping-pong check.
- **D-05 [auto]:** If (b) wins: the write is claim-token fenced the way `advance_sync_cursor` is (or the plan argues why an orphan write is harmless), the bound is monotonic toward the EARLIER instant on a stop (LEAST) and cleared only when a run's earliest complete-through instant is at or past it, concurrent advance-vs-lower on the same strategy is analysed, and the behaviour on a key re-point is defined. If it lives on `strategy_sync_cursors`, the table comment's "sole writer is the cron fan-out" and cron.py's reader (three-state membership rule) must stay correct.
- **D-06 [auto]:** Adopt the round-3 WR-01 predicate: the unread start is the EARLIEST complete-through instant (a stop: its bound; a failed symbol or a stop with no usable bound: the walk start, i.e. the seed minus `OVERLAP_WINDOW_MS`, or the reach when there was no seed), compared with the next run's walk start (at most `column - OVERLAP_WINDOW_MS`). A stop-plus-partial arm pins it (the `test_probe_false_negative_partial_plus_stop_above_column` shape), with a partial-only arm.
- **D-07 [auto]:** A RAISED read (`phase2_fill_ingestion_failed` on the shared-key first sync, R3 `test_probe_raised_read_column_ahead`) joins the predicate and the re-read bound, so it is flagged and re-read rather than self-healed past.
- **D-08 [auto]:** CARRY the sync-time `binance_*` keys (`binance_stop_below_cursor`, `binance_deadline_symbols`, `binance_partial_symbols`, `binance_page_cap_symbols`, and any other `binance_*` key the sync writes; research enumerates them) through the derive prestamp (`_prestamp_flags` in `run_derive_broker_dailies_job`) and the `run_csv_strategy_analytics` rebuild. Lists carry as lists (the `is True` present-only pattern fits only the booleans). An arm proves each hop for `binance_stop_below_cursor` and `binance_deadline_symbols`.
- **D-09 [auto]:** Lifetime: a carried key lives until the NEXT SYNC that does not raise it; that sync removes it. A clearing arm is required, or the flag sticks forever. Research traces whether any early return in the derive skips the prestamp for a Binance key and how the sync epilogue merge treats absent keys.
- **D-10 [auto]:** `USE_RAW_TRADE_INGESTION` stays off for Binance; no plan flips it. The ship PR rewrites the `_RAW_TRADE_INGESTION_ENABLED` comment's SC-3 open-gap paragraph to say it is closed and how, deletes `[250-BINANCE-STOP-BELOW-CURSOR]` from `TODOS.md`, and names it in the CHANGELOG entry.
- **D-11 [auto]:** PROOF-01: every gate goes RED on pre-fix or a neutered copy with its named arm first, restored from a byte backup (`cp` back, `cmp`), recorded verbatim in the plan SUMMARY. Never `git checkout/restore/stash` on uncommitted work.
- **D-12 [auto]:** Any new `supabase/tests` gate carries a `RED-UNDER` annotation, passes `scripts/lint-migration-data-dependence.mjs` and `node scripts/lint-sql-gates.mjs`, and the plan greps every census it moves. The migration is stamped after main's latest and goes through migration-reviewer and rls-policy-auditor clean at MEDIUM+.
- **D-13 [auto]:** Write scope is listed BY SYMBOL in every plan, because `run_sync_trades_job` is shared with Phase 251 SYNCSTORE.

### Claude's Discretion
- Exact column or table name for the per-strategy bound, the RPC name if one is added, and test file names.
- Whether the predicate code and the bound write share one helper.

### Deferred Ideas (OUT OF SCOPE)
- Carrying non-`binance_*` sync-time flags (`sync_truncated_*`) through the derive: same overwrite class, outside this phase's SC-3.
- A fully per-strategy fills cursor replacing the per-key column for every venue: larger than this gap.
- Also out of scope (CONTEXT domain): turning `USE_RAW_TRADE_INGESTION` on for Binance (SC-4), the T-250-19 handler-tail overrun, the quiet-prefix deadline exception, other venues' cursor semantics.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are mapped (routed review survivor `[250-BINANCE-STOP-BELOW-CURSOR]`). The ROADMAP success criteria stand in:

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | Two-run test: run 1's column set by another strategy, run 2 seeded from what run 1 wrote, re-reads the span; RED today; cursor never stamps past stored data | D-01 verdict (b); seed block insertion point; stateful fake of the bound table; SQL gate on the RPC |
| SC-2 | Stop-plus-partial flagged by name; predicate compares earliest complete-through with next walk start | R3 WR-01 predicate, plus the no-seed walk-start anchor and the Binance gate for the raised-read arm |
| SC-3 | `binance_*` sync flags survive the derive write and the CSV rebuild; an arm proves each | Key list, carry helper in a leaf module, clearing arm in the sync epilogue |
| SC-4 | Switch stays off; comment and TODOS entry updated in the ship PR | Records checklist |
| SC-5 | PROOF-01 | Validation Architecture |
</phase_requirements>

## Summary

**D-01 verdict: design (b), a per-strategy re-read bound in a NEW table, with a fenced SECURITY DEFINER RPC. Design (a), lowering the shared per-key column, fails the locked D-02 interleave.** Paper trace of the three-step arm against the real code: B (no stored fills, no daily row) reads from the reach, one symbol stops at bound b1 below column C, healthy symbols store fills near now. Under (a) the RPC lowers the column to the stamp s below C. A's next clean run seeds at `min(s, A's fill high-water)`, re-reads, completes, and stamps A's newest fill (about now), so the column moves forward again. B's next seed is `min(column ~ now, B's strategy-wide fill high-water ~ now)`, and X's span from b1 is never re-read. The column is shared, so any clean sibling undoes the lowering. Under (b) B's bound b1 lives in B's own row, A never touches it, and B's seed is `min(column, hw, b1) = b1`. The scratch pytest was NOT run (the trace is deterministic from the code read; the plan's arm will be the executable proof).

**Two refinements to D-05 the planner must adopt.** (1) A pure LEAST bound stalls: a run that starts at the bound b and stops later at b2 > b would keep b, re-read the same span and stop at the same b2 forever. The bound must ADVANCE to the run's earliest complete-through when that run covered the old bound, and clear when it read complete. The RPC therefore takes the instant the run covered from and applies LEAST only when the run did not cover the existing bound. (2) The bound must be written whenever the read is incomplete (stop, partial, raise), regardless of column state, because a sibling can advance the column between B's runs; the existing NULL-column anchor (`fills_anchor_iso`, Phase 232 CR-01) has the same sibling hole and is left in place but is not sufficient.

**SC-3:** a sync-time flag is overwritten at three sites (the derive prestamp, the derive-failed payload, the CSV rebuild) and is never removed by the sync epilogue today (it only `update`s present keys), so once carried it would stick forever without a clearing arm. Recommend one leaf module owning the key allowlist, a carry function, and the clear rule.

**Primary recommendation:** new table `strategy_fills_reread_bounds` plus RPC `set_strategy_fills_reread_bound`, written in the `run_sync_trades_job` epilogue BEFORE the `advance_sync_cursor` call, read as one more term in the VREAD-08 seed `min`; `advance_sync_cursor` and its ACL are not touched. Migration `20261126140000_strategy_fills_reread_bound.sql` (re-measure before ship).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Decide the unread start and the bound | API / Backend (analytics worker, `run_sync_trades_job`) | — | It owns the read outcome (`exchange_dq_flags`, stamp, seed) |
| Persist the per-strategy bound atomically, fenced | Database (SECDEF RPC + table) | Worker (caller) | Atomic cover/LEAST/clear and the claim-token fence belong in SQL, as `advance_sync_cursor` does |
| Seed the next read | Worker | Database (read of the bound) | One more term in the existing `min` |
| Carry `binance_*` flags | Worker (derive prestamp, CSV rebuild) | Database (`strategy_analytics.data_quality_flags` jsonb) | Both rewrites are Python; the column is replaced wholesale |
| Clear stale flags | Worker (sync epilogue) | — | Only the sync knows whether the Binance fills read ran clean |
| Browser / SSR / CDN | none | — | No UI reads any `binance_*` key (grep of `src`, 0 hits) |

## Standard Stack

No new packages. Everything is the in-repo stack.

| Component | Version | Purpose |
|-----------|---------|---------|
| Python worker (`analytics-service`) | repo, Python 3.14 local | handler, helpers, tests (pytest, mypy strict) |
| PostgreSQL via Supabase migrations | repo | table, RPC, SQL gate |
| vitest | repo | census and ratchet tests only |

**Package Legitimacy Audit:** not applicable, this phase installs no external packages. Banned-package list in the user CLAUDE.md is not touched.

### Don't Hand-Roll
| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Claim-token fence | A new ownership check | The exact `compute_jobs` `status='running' AND claim_token=` EXISTS from `advance_sync_cursor` | Same watchdog-reclaim race; `WORKER_FENCE_V2` NULL-token arm must match |
| Missing-relation handling | Ad hoc string matching | The classification precedent in `routers/cron.py` (`_STRATEGY_SYNC_CURSOR_TABLE`, missing-relation helper near line 359) | Deploy ordering between PROD apply and worker deploy |
| Over-fetch dedup | Any "already stored" filter | The `(strategy_id, exchange, exchange_fill_id)` unique index | Re-reading a span is already idempotent |
| Table ACL / RLS posture | New pattern | Copy `strategy_sync_cursors`: RLS on, deny-all policy, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, `GRANT ALL ... TO service_role` | Bootstrap default privileges grant to anon/authenticated; the explicit GRANT to service_role is load-bearing (migration comments) |

## Verified Facts (in-repo, read this session)

- **Cursor column is per key, written only by `advance_sync_cursor`.** `supabase/schema/functions/advance_sync_cursor.sql` (one definition; `grep -a` over all migrations found it created only in `20260602173710_advance_sync_cursor_claim_token_fence.sql`, later migrations only mention it in comments). Body, verbatim: `UPDATE api_keys SET last_fetched_trade_timestamp = CASE WHEN p_last_fetched_ts IS NOT NULL AND (last_fetched_trade_timestamp IS NULL OR last_fetched_trade_timestamp < p_last_fetched_ts) THEN p_last_fetched_ts ELSE last_fetched_trade_timestamp END`. Signature: `advance_sync_cursor(p_api_key_id UUID, p_job_id UUID, p_claim_token UUID DEFAULT NULL, p_last_fetched_ts TIMESTAMPTZ DEFAULT NULL, p_last_sync_at TIMESTAMPTZ DEFAULT NULL, p_account_balance NUMERIC DEFAULT NULL) RETURNS BOOLEAN ... SECURITY DEFINER SET search_path = public, pg_catalog`. [VERIFIED: supabase/schema/functions/advance_sync_cursor.sql, whole file]
- **Live ACL (baseline):** `REVOKE ALL ON FUNCTION "public"."advance_sync_cursor"(...) FROM PUBLIC;` and `GRANT ALL ON FUNCTION ... TO "service_role";` (anon and authenticated carry no grant). Migration line: `REVOKE ALL ON FUNCTION advance_sync_cursor(UUID, UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, NUMERIC) FROM PUBLIC, anon, authenticated;`. [VERIFIED: supabase/schema/baseline.sql:19001-19002; migration 20260602173710 line 158-159]
- **`20260810120000_lock_api_keys_exchange_column.sql`** enforces `REVOKE UPDATE ON public.api_keys FROM anon, authenticated;` and a trigger `api_keys_lock_exchange` (`prevent_api_key_venue_change`). SECDEF RPCs and the service-role worker are unaffected (its header lists `advance_sync_cursor`). It does not constrain design (b) at all. [VERIFIED: migration lines 66, 104, 107, 135]
- **Seed (Phase 232 VREAD-08)** in `run_sync_trades_job`: `_fills_cursor_ms = parse_since_ms(None, preferred=ctx.key_row.get("last_fetched_trade_timestamp"))`; when non-None, `fills_since_ms = None if _seed_bound_ms is None else min(_fills_cursor_ms, _seed_bound_ms)` with `_seed_bound_ms = _fill_hw_ms if not None else daily_since_ms`; `load_strategy_fill_high_water(ctx.supabase, strategy_id)` is strategy-wide (CONTEXT; not re-read in trade_resume this session beyond its module header, the call site above is verified). A B-strategy with no stored fill and no daily row therefore gets `fills_since_ms = None` and walks from the reach. When the column is NULL: `fills_since_ms = daily_since_ms` and `fills_anchor_iso` is set (daily seed, or for binance with no seed the reach computed from `_exchange._now_ms() - BINANCE_FILLS_REACH_DAYS * 86_400_000` BEFORE the read). Note `fills_anchor_iso` is NOT set when the column is non-NULL, so the shared-key B case has no concrete walk-start instant today. [VERIFIED: analytics-service/services/job_worker.py, seed block in `run_sync_trades_job`, read lines 2292-2330]
- **Venue constants:** `OVERLAP_WINDOW_MS = 3_600_000`; `BINANCE_FILLS_REACH_DAYS: int = 85`; `BINANCE_PAGE_CAP: int = 20`; `BINANCE_SYNC_FILLS_READ_DEADLINE_S: float = 840.0`. `fetch_raw_trades` subtracts the overlap (`effective_since = since_ms - OVERLAP_WINDOW_MS`) and the Binance walk clamps a seed older than the reach to the reach and records `binance_fills_reach_clamped` (non-holding). [VERIFIED: analytics-service/services/exchange.py:686, 705, 709, 736, 2560-2563, 2744-2757]
- **Epilogue gating today:** `_fills_incomplete` is any truthy `sync_truncated_*` or `binance_partial_symbols`; `_fills_stopped` is `"binance_read_through_ms" in exchange_dq_flags` or any of `binance_page_cap_symbols`, `binance_untimed_page_symbols`, `binance_deadline_symbols`; a stop without a usable bound sets `_fills_incomplete = True`. The stamp is the newest persisted fill at or before the bound. The current flag predicate sets `exchange_dq_flags["binance_stop_below_cursor"] = True` when `_fills_cursor_ms is not None` and `(_unread_from_ms is None or _unread_from_ms < _fills_cursor_ms) and (_stamp_ms is None or _stamp_ms < _fills_cursor_ms)` with `_unread_from_ms = _read_through_raw if _read_through is not None else fills_since_ms` (the WR-01 false negative). [VERIFIED: job_worker.py `run_sync_trades_job`, lines 2625-2740]
- **Epilogue merge:** it loads `existing_flags`, does `existing_flags.update(exchange_dq_flags)` only (never pops an absent `binance_*` key), and the `else` branch of `phase2_failed` sets `write_needed = False` when nothing was raised and no stale `phase2_*` flag exists. The upsert writes `{"strategy_id", "data_quality_flags": existing_flags}`; a failed flag load falls back to `{}` and so replaces the column with new keys only. [VERIFIED: job_worker.py lines 2796-2880]
- **Cursor RPC call:** `advance_sync_cursor` is called with `p_claim_token = job.get("claim_token") if WORKER_FENCE_V2 else None`; a `False` return logs `worker_orphan_write_blocked`; an exception only logs a warning. `WORKER_FENCE_V2` defaults on (`os.environ.get("WORKER_FENCE_V2", "true").lower() != "false"`). [VERIFIED: job_worker.py lines 382-384, 2940-2985]
- **`strategy_sync_cursors`** columns, verbatim: `strategy_id UUID PRIMARY KEY REFERENCES strategies(id) ON DELETE CASCADE, last_sync_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`; its `last_sync_at` comment states three states (no row = never synced; row with NULL = held; row with a timestamp = synced) and cron.py's `_resume_floor_ms` pins the key's fetch window at the earliest held marker. Writing a bound onto this table would create rows that cron reads as HELD, pinning every key's window (the WR-04 wedge risk). **Do not reuse this table.** [VERIFIED: migration 20260919120000 lines 101-122; routers/cron.py comment block lines 228-262]
- **Binance sync-time keys, enumerated** (every `_record_dq_flag("binance_...")` in exchange.py plus the one the worker adds): `binance_fills_reach_clamped` (True), `binance_fill_cursor_advance_plus1` (True), `binance_partial_symbols` (list), `binance_unlisted_symbols` (list), `binance_page_cap_symbols` (list), `binance_untimed_page_symbols` (list), `binance_deadline_symbols` (list), `binance_read_through_ms` (int, the minimum stop bound), and worker-written `binance_stop_below_cursor` (True). The `daily_pnl_malformed_binance` and `daily_pnl_binance_income_fallback` keys belong to the daily-PnL path and already have their own carry. [VERIFIED: exchange.py:2748, 2978, 2995, 3004, 3012, 3014, 3016, 3024; job_worker.py:2732]
- **Consumers:** no `src/`, `supabase/migrations`, `supabase/functions` or `scripts` file reads any `binance_*` sync key (grep, 0 hits), so carrying them changes no rendered number. [VERIFIED: grep -a this session]

## Architecture Patterns

### Data flow

```
sync_trades job (strategy B, key K)
  seed: min(column K, B fill high-water | daily seed, B bound if row.api_key_id == K)   --> fills_since_ms
  walk (windows, deadline, page cap)  --> raw_fills + dq flags (stops, partial, read_through)
  epilogue:
    u = earliest complete-through (stop bound / walk start for failed, no-bound stop, raised read)
    predicate(u vs column - overlap) --> binance_stop_below_cursor flag + WARNING
    set_strategy_fills_reread_bound(B, K, job, token, u, covers_from)  --BEFORE-->  advance_sync_cursor(K, ...)
    flags merge: update present keys, POP absent BINANCE_SYNC_FLAG_KEYS when the Binance read ran clean
  --> derive_broker_dailies prestamp: carry BINANCE_SYNC_FLAG_KEYS from the row it already reads
  --> run_csv_strategy_analytics rebuild: carry again from existing_flags
```

### Recommended structure
```
analytics-service/services/binance_sync_flags.py   # leaf: BINANCE_SYNC_FLAG_KEYS, carry_binance_sync_flags(existing)->dict, validators
analytics-service/services/job_worker.py           # seed term, predicate, bound write, flag clear, prestamp carry
analytics-service/services/analytics_runner.py     # DataQualityFlags keys + carry in the rebuild
supabase/migrations/20261126140000_strategy_fills_reread_bound.sql
supabase/schema/functions/set_strategy_fills_reread_bound.sql   # via npm run schema:functions
supabase/tests/test_strategy_fills_reread_bound.sql
```

### Pattern 1: the bound table and RPC (recommended schema)

```sql
CREATE TABLE IF NOT EXISTS strategy_fills_reread_bounds (
  strategy_id uuid PRIMARY KEY REFERENCES strategies(id) ON DELETE CASCADE,
  api_key_id  uuid NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  unread_from timestamptz NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);
-- RLS on, deny-all policy, REVOKE ALL FROM PUBLIC, anon, authenticated; GRANT ALL TO service_role (copy strategy_sync_cursors)

-- set_strategy_fills_reread_bound(p_strategy_id uuid, p_api_key_id uuid, p_job_id uuid,
--   p_claim_token uuid DEFAULT NULL, p_unread_from timestamptz DEFAULT NULL,
--   p_covers_from timestamptz DEFAULT NULL) RETURNS boolean
-- LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_catalog
-- 1. p_strategy_id / p_api_key_id NULL -> RAISE invalid_parameter_value (as advance_sync_cursor)
-- 2. fence, copied: when p_claim_token IS NOT NULL, require p_job_id and
--    EXISTS (SELECT 1 FROM compute_jobs WHERE id=p_job_id AND status='running' AND claim_token=p_claim_token) else RETURN FALSE
-- 3. existing row for p_strategy_id:
--      key differs (re-point)            -> replace: row := (p_api_key_id, p_unread_from) or DELETE when p_unread_from IS NULL
--      covers := p_covers_from IS NOT NULL AND p_covers_from <= existing.unread_from
--      p_unread_from IS NULL             -> DELETE when covers, else keep
--      p_unread_from NOT NULL            -> unread_from := CASE WHEN covers THEN p_unread_from ELSE LEAST(existing, p_unread_from) END
--      no existing row and p_unread_from NOT NULL -> INSERT
-- 4. RETURN TRUE
-- REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role
```

Why a fenced RPC and not the direct upsert style of cron.py: an orphaned (watchdog-reclaimed) worker's CLEAR would erase the live worker's bound, and a lost bound is exactly the data-integrity gap. `covers_from` is computed in the worker as the effective walk start (`max(fills_since_ms - OVERLAP_WINDOW_MS, reach)`), and passed as `-infinity` when the seed was older than the reach (the clamp: nothing older is reachable, so an old bound is unrecoverable and must not live forever). Because the seed is `min(..., bound)`, a normal run always covers the bound; the LEAST branch only protects odd interleavings and a failed bound read.

### Pattern 2: seed term and the walk-start anchor

Add the bound as one more term in BOTH seed branches (non-NULL column and NULL column) after `fills_since_ms` is computed: `None` (reach) stays `None`, otherwise `min(fills_since_ms, bound_ms)`. Read only when `ctx.key_row.get("exchange") == "binance"` and `row.api_key_id == ctx.key_row["id"]`. When the column is non-NULL and there is no seed, take a `walk_start_anchor_ms = _exchange._now_ms() - BINANCE_FILLS_REACH_DAYS * 86_400_000` BEFORE the read (the CR-01 pattern, earlier than the walk's own start, so conservative) so a failed symbol or a raised read has a concrete instant to record. If the NULL-column branch lowers `fills_since_ms` by the bound, `fills_anchor_iso` must follow it.

### Pattern 3: predicate (SC-2, D-06, D-07)

Use the R3 WR-01 code verbatim as the base (published in the Phase 250 R3 review on the local branch `gsd/phase-250-binancefills`, read this session): the complete-through list holds `_read_through_raw` when a usable bound exists, and `None if fills_since_ms is None else fills_since_ms - OVERLAP_WINDOW_MS - 1` when `_partial or _read_through is None`; `_unread_from_ms` is `None` if any entry is `None` else the minimum; flag when `_unread_from_ms is None or _unread_from_ms + 1 < _fills_cursor_ms - OVERLAP_WINDOW_MS`. Extensions:
- D-07: add `phase2_failed` to the trigger (`_fills_stopped or _partial or phase2_failed`) AND gate the whole block on `ctx.key_row.get("exchange") == "binance"`. Without the gate, an OKX or Bybit raised read would set a Binance-named flag.
- Where the old code used `None` for "the reach", the bound write needs a number: use `walk_start_anchor_ms`.
- The flag now means "a span below the next walk start is pending re-read through the recorded bound" (rewrite the WARNING text, which currently says `advance_sync_cursor will not lower the column, so the span may not be re-read`).
- The bound write itself uses the same `u` but is NOT conditioned on the column: write whenever the Binance read was incomplete.

### Pattern 4: bound write placement and failure rule

Call the RPC after the flag merge and BEFORE `advance_sync_cursor`. If the RPC raises, log ERROR, raise `binance_stop_below_cursor`, and hold the fetched-ts stamp (`_p_last_fetched = None`) so the column is not advanced past a span whose bound could not be recorded. The RPC returning `FALSE` (orphan) logs `worker_orphan_write_blocked`-style and is harmless (the re-claiming worker owns the epilogue). A complete read (`not phase2_failed and not _fills_incomplete and not _fills_stopped`, Phase 1 not failed) sends `p_unread_from = NULL` with `p_covers_from`, which clears only a covered bound.

### Pattern 5: SC-3 carry, lifetime and clearing

- **Derive prestamp:** `run_derive_broker_dailies_job` is one very large function (the prestamp dict `_prestamp_flags: dict[str, Any] = {"csv_source": True}` and its upsert `_prestamp_dq_flags` are near lines 11394 and 11790; cite by symbol). It already reads `strategy_analytics` `data_quality_flags, computed_at` once before the write (`_read_last_success_row`, consumed by `_last_success_snapshot`). Hold that row and carry from its `data_quality_flags` into `_prestamp_flags` next to the `_prestamp_flags[LAST_SUCCESS_SNAPSHOT_KEY] = _last_success` assignment. No extra read.
- **Early returns:** every `return DispatchResult(...)` between the function start and the prestamp write leaves `strategy_analytics` untouched, so the sync's flags survive them. The ONLY other site in the function that writes `data_quality_flags` is the derive-failed payload (`_derive_failed_payload`, `"data_quality_flags": {"csv_source": True}`, line ~6182), which rewrites the row to `failed`. Recommend carrying there too through the same helper (cheap) or recording it as a known limit; the bound row stays durable either way. [VERIFIED: awk/grep of `data_quality_flags` over the function, 3 hits: 6182, 11520, 11567]
- **CSV rebuild:** `run_csv_strategy_analytics` in `analytics-service/services/analytics_runner.py` builds `data_quality_flags: DataQualityFlags = {"csv_source": True}` and carries by reading `existing_flags` (read before the benchmark fetch); the `daily_pnl_malformed_` carry iterates `existing_flags` and requires `is True`. `DataQualityFlags` is a TypedDict (mypy strict), so each carried key must be declared, with list and int types for the non-boolean keys. The same file has other wholesale `{"csv_source": True}` writes at lines near 1966, 2613 and 2668 (failure rows); same decision as the derive-failed payload.
- **Helper:** `BINANCE_SYNC_FLAG_KEYS` as an explicit allowlist (not a prefix) in the leaf module, per-key shape validators (True; non-empty list of str; non-negative int that is not bool), `carry_binance_sync_flags(existing: object) -> dict` that drops malformed values. A parity test scans `exchange.py` and `job_worker.py` for `binance_` flag literals and fails when the allowlist drifts (the Phase 222 ast-scan pattern).
- **Clearing (D-09):** in the sync epilogue after `existing_flags.update(exchange_dq_flags)`, when a local `binance_fills_read_ran` is True (set only after `fetch_raw_trades` returned for a Binance key under the switch) pop every allowlisted key absent from `exchange_dq_flags` and set `write_needed = True` when anything was popped. Do NOT clear on `phase2_failed` (a raised read produced no new flags, so the old ones are still the truth), when the switch is off, for a non-Binance key, or when `flag_load_failed`. Without the `write_needed` change the clean-path `write_needed = False` branch would never write the clear.

### Anti-Patterns
- **Lowering the shared column:** fails D-02 and risks every venue's caller.
- **LEAST-only bound:** stalls on a repeated deadline stop (see Summary).
- **Reusing `strategy_sync_cursors`:** a NULL-`last_sync_at` row reads as HELD in cron.
- **Bound write after the cursor RPC or swallowed:** a lost bound is a silent gap.
- **Carrying by `is True` only:** lists and the int bound would be dropped or mis-typed.

## Venue docs bearing (consulted this session)

- Spot `GET /api/v3/myTrades`: `startTime`/`endTime` int64; "The time between `startTime` and `endTime` can't be longer than 24 hours."; `fromId`: "TradeId to fetch from. Default gets most recent trades." and "If `fromId` is set, it will get trades >= that `fromId`."; `limit` default 500, max 1000; supported combinations include `symbol` + `startTime` + `endTime` and `symbol` + `fromId`; the page does not state result ordering. [CITED: https://developers.binance.com/docs/binance-spot-api-docs/rest-api/account-endpoints]
- USD-M `GET /fapi/v1/userTrades`: "If `startTime` and `endTime` are both not sent, then the last 7 days' data will be returned."; "The time between `startTime` and `endTime` cannot be longer than 7 days."; "The parameter `fromId` cannot be sent with `startTime` or `endTime`."; "Only support querying trade in the past 3 months"; `limit` default 500, max 1000; ordering not stated. [CITED: https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Account-Trade-List]
- COIN-M `GET /dapi/v1/userTrades`: same 7-day window, same `fromId` exclusion and 3-month note; `limit` default 50, max 1000. [CITED: https://developers.binance.com/docs/derivatives/coin-margined-futures/trade/rest-api/Account-Trade-List]

**Bearing on a re-read from a lowered bound:** a re-read is an ordinary windowed `startTime`/`endTime` walk (24 h spot, 7 d futures), the same one the first read uses, so nothing new is needed on the venue side. `fromId` cannot be combined with times on futures, so the bound is a time instant, never a trade id. The 3-month reach means a bound older than the reach cannot be re-read: the existing 85-day clamp (`binance_fills_reach_clamped`, non-holding) applies and the RPC's `-infinity` covers rule drops such a bound instead of keeping it forever. Ordering is not documented, which is why correctness rests on the per-symbol `read_through` bound (stored fills at or before it) and the unique-index dedup, not on result order.

## Common Pitfalls

1. **Stall by a stale-low bound.** A run that starts at b and stops at b2 > b must move the bound forward. Pin with an arm: bound b, run covers and stops at b2, bound becomes b2 (and a repeat run progresses).
2. **Sibling advances the column between B's runs.** The three-step arm; also true for the existing NULL-column anchor.
3. **The no-seed instant.** On a non-NULL column with no seed there is no recorded walk start; compute `walk_start_anchor_ms` before the read.
4. **Predicate not Binance-gated once `phase2_failed` joins.** An OKX raised read must not set the flag (arm).
5. **Flag sticks forever once carried.** The epilogue never pops absent keys today; add the clear and `write_needed`.
6. **Clear on a raised or switched-off read.** Gate on `binance_fills_read_ran`.
7. **TypedDict.** `DataQualityFlags` must declare the keys or mypy strict fails.
8. **Key re-point.** Store `api_key_id`; a bound for another key is ignored on read and replaced on write.
9. **Deploy order.** The table may not exist when a new worker first runs; the whole path is dormant while `USE_RAW_TRADE_INGESTION` is off (per CONTEXT, off for Binance), but a missing-relation read must still classify as "no bound" with a WARNING, using the cron.py precedent.
10. **Phase 251 overlap.** `run_sync_trades_job` is shared; list write scope by symbol: seed block, predicate block, bound write (new), flag merge block, `_RAW_TRADE_INGESTION_ENABLED` comment.
11. **Fake mirrors rule.** A Python fake of the bound RPC can only pin the worker; the rule itself is pinned by the SQL gate on the real function (and `column_after_advance` in `tests/_binance_fills.py` is the precedent for a pure mirror that is cross-checked).

## Code Examples

Existing pin to invert (the SC-1 starting point): `test_a_stop_stamp_below_a_column_ahead_of_the_stored_fills_is_dropped_by_the_rpc` in `analytics-service/tests/test_binancefills_cursor.py` asserts `column_after_advance(CURSOR_AHEAD_TS, stamp) == CURSOR_AHEAD_TS`; its docstring names the gap this phase closes. Reuse `_make_supabase`, `_run_job`, `_the_advance`, `_bfill` there, and `symbols_supabase`, `BinanceFillsVenue`, `venue_fill`, `column_after_advance` from `tests/_binance_fills.py`. Add a stateful fake for `strategy_fills_reread_bounds` (select and the new RPC) so run 2's seed is taken from run 1's writes.

## Runtime State Inventory

Not a rename or migration phase. Stored state added: one new table, empty at apply (no data statements; satisfies `scripts/lint-migration-data-dependence.mjs` as long as the verify block is catalog-only). Existing `strategy_analytics.data_quality_flags` rows keep whatever the last overwrite left; no backfill. Nothing in OS-registered state, secrets or build artifacts.

## State of the Art

| Old | Current | Impact |
|-----|---------|--------|
| WARNING log is the only lasting signal | Flags carried through derive and CSV rebuild, cleared by the next clean sync | SC-3 |
| Stop stamp below column dropped by forward-only RPC | Per-strategy bound re-read through the seed | SC-1 |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Per-strategy `sync_trades` jobs never run concurrently (dedupe by status), so the in-SQL cover rule is sufficient without a compare-and-swap | Pattern 1 | A rare double-run could lower or advance a bound wrongly; the fence blocks only orphans |
| A2 | A failed bound read should fail OPEN to a full-reach seed (over-fetch direction) rather than the daily seed | Pitfall 9 | Reach walk under the 840 s deadline may stop repeatedly if the read fails persistently |
| A3 | `src/lib/database.types.ts` has no CI drift gate (only `scripts/check-gdpr-export-coverage.ts` mentions it); it lacks `strategy_sync_cursors`, so internal tables are not tracked there. Add the RPC entry only if the plan finds a drift check | Records | A missing entry breaks a typecheck the plan did not find |
| A4 | Upsert of `data_quality_flags` replaces the jsonb column wholesale (as the prestamp comments state), so a popped key is removed | Pattern 5 | The clear arm would need an explicit null write |
| A5 | Strategy re-point (`strategies.api_key_id` change) is possible; the bound is then ignored | Pitfall 8 | Harmless if re-point cannot happen |
| A6 | COIN-M `/dapi/v1/userTrades` is used by the walk for inverse markets (the exchange.py comment says "USD-M and COIN-M") | Venue docs | None for the design |
| A7 | The migration file stamp `20261126140000` is after main's latest `20261125212222` (re-measured via `git ls-tree origin/main`), but 225 PR-3, 252 and 251 may land first and force a re-stamp | Summary | Re-stamp before ship |

## Open Questions

1. **Derive-failed and CSV failure-row overwrites** (`_derive_failed_payload`, analytics_runner lines near 1966, 2613, 2668). Recommendation: carry through the same helper; if the founder wants it narrower, record them as known limits. The bound table stays durable either way.
2. **Does `phase2_complete` (True only after a persisted batch) matter for the clear?** Recommendation: clear on `not phase2_failed and not _fills_incomplete and not _fills_stopped and not phase1_failed`, which also covers a zero-fill complete read; the plan re-reads lines 2474-2580 to confirm persist failures set `phase2_failed`.
3. **Flag-load failure** replaces the column with new keys only (pre-existing); carried flags are lost on that path. Accepted, record it.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python | pytest, mypy | yes | 3.14.3 | none needed |
| Docker | local-stack SQL lane | yes (present) | not probed | CI `sql-tests` runs it; avoid locally, stop and clean up if used |
| Supabase CLI / PROD | none (no PROD write in research) | n/a | n/a | n/a |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service, run only from `analytics-service/`), vitest for census tests, plain PL/pgSQL `DO` gates under `supabase/tests` |
| Config file | `analytics-service/pytest.ini`; `vitest.config.ts` |
| Quick run command | `cd analytics-service && python -m pytest tests/test_binancefills_cursor.py -x -q` |
| Full suite command | not run per brief (targeted only); `npx vitest run --maxWorkers=2 src/__tests__/mutation-runner-floors.test.ts` |

### Phase Requirements to Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | Two-run arm re-reads bound..column span; RED on today's code | unit | `pytest tests/test_binancefills_cursor.py -k two_run -x` | Wave 0 (new arms; extend file) |
| D-02 | Three-step interleave (A advances the column between B runs) | unit | `pytest tests/test_binancefills_cursor.py -k interleave -x` | Wave 0 |
| D-05 | Bound advances on a later stop, clears on a complete read, key re-point ignored, orphan write blocked | SQL gate + unit | `supabase/tests/test_strategy_fills_reread_bound.sql` on the lane; `pytest ... -k bound` | Wave 0 |
| SC-2 | Stop-plus-partial, partial-only, raised-read arms; non-Binance raised read not flagged | unit | `pytest tests/test_binancefills_cursor.py -k predicate -x` | Wave 0 |
| SC-3 | Each `binance_*` key survives derive prestamp and CSV rebuild; clearing arm; allowlist parity scan | unit | `pytest tests/test_binance_sync_flags.py -x` (plus existing derive/CSV test files) | Wave 0 |
| ACL | New RPC and table denied to anon and authenticated | SQL gate | same new gate file | Wave 0 |

### Sampling Rate
- Per task commit: the one touched pytest file with `-x -q`; `mypy` strict only on touched analytics files.
- Per wave merge: the new SQL gate on the pg-lane plus the census vitest files with `--maxWorkers=2`.
- Phase gate: PROOF-01 per gate (neuter, RED with the named arm first, restore from a byte backup with `cp` and `cmp`, GREEN), recorded verbatim in the SUMMARY.

### Wave 0 Gaps
- [ ] New SQL gate `supabase/tests/test_strategy_fills_reread_bound.sql` with `RED-UNDER` and `RED-UNDER-SETUP` annotations (template: `test_strategy_sync_cursors_rls.sql`, whose setup applies `scripts/pg-lane/fixtures/01-fixture-core.sql`, `07-fixture-supabase-default-privileges.sql` and the migration).
- [ ] Censuses it moves. Run `grep -a "test_strategy_sync_cursors_rls"` over `scripts`, `src/__tests__` and `.github` to find every site (that file is the exact precedent). Known: `scripts/mutation-floors.mjs` (`FILES_FLOOR = 94`, `ARMS_FLOOR = 1033`, `WAIVED_CEILING = 0` at lines 1395, 3567, 3681; read by symbol, move by the new file and its biting arm count), `src/__tests__/mutation-runner-floors.test.ts` (ratchet, fixture run output per file), `src/__tests__/mutation-annotation-parser.test.ts` (file lists near lines 2716, 3034), and also grep `gate-family-meta`, `lint-sql-gates` tests and `scripts/sql-gate-subset.mjs`. The `supabase/tests` directory holds 121 entries at HEAD.
- [ ] Lints: `node scripts/lint-sql-gates.mjs --self-test` then the corpus run (7 rules), `scripts/lint-migration-data-dependence.mjs` (migration verify block must be catalog-only; no data-reading `DO` guard, no opt-out marker).
- [ ] Regeneration: `npm run schema:functions` for `supabase/schema/functions/set_strategy_fills_reread_bound.sql` (`schema:functions:check` is the check). `baseline.sql` and `baseline-carried-migrations.txt` are NOT edited in this PR: the lane replays migrations newer than the dump (D-F) and the re-dump follows the PROD apply as its own PR (precedent #1350); a re-dump must regenerate the marker in the same commit.
- [ ] Python: new arms in `test_binancefills_cursor.py`, new `tests/test_binance_sync_flags.py`, a derive-prestamp arm and a CSV-rebuild arm (find the existing files with `grep -a "daily_pnl_malformed" analytics-service/tests`), plus a stateful bound-table fake in `tests/_binance_fills.py`.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a (service-role worker only) |
| V4 Access Control | yes | RLS deny-all, `REVOKE ALL ... FROM PUBLIC, anon, authenticated`, explicit `GRANT ... TO service_role`; RPC EXECUTE revoked from PUBLIC, anon, authenticated |
| V5 Input Validation | yes | RPC rejects NULL ids with `invalid_parameter_value`; carry helper validates flag shapes (no bool-as-int, no non-string list members) |
| V6 Cryptography | no | n/a |

### Known Threat Patterns
| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| SECDEF search-path hijack | Elevation | `SET search_path = public, pg_catalog`, schema-qualified names |
| Orphaned worker clobbers a bound | Tampering | Claim-token fence in the RPC |
| Client reads or writes the bound | Info disclosure / Tampering | RLS deny-all plus revoked grants, pinned by the SQL gate |
| Flag payload carrying venue text | Info disclosure | Allowlist keys only; lists of symbol names, counts, ints; never fill content (T-250-13 posture) |

## Records checklist (SC-4)
Ship PR: rewrite the SC-3 open-gap paragraph in the `_RAW_TRADE_INGESTION_ENABLED` comment (it currently ends "Closing it needs an RPC change, outside this phase, booked as `[250-BINANCE-STOP-BELOW-CURSOR]`"); delete the `[250-BINANCE-STOP-BELOW-CURSOR]` entry from `TODOS.md` and fix any pointer to it; CHANGELOG entry via the mechanism in CLAUDE.md (names the deleted entry); correct the Phase 250 summary claim "loud on every such run" only if it is on main; version bump, no ship commit may touch `.planning`. No skip-CI token anywhere. Migration goes through migration-reviewer and rls-policy-auditor clean at MEDIUM+ before merge; it auto-applies to TEST then PROD on merge with no human stop.

## Project Constraints (from CLAUDE.md)
- This checkout's Supabase CLI is linked to PRODUCTION: no `db push` or `--linked` writes from a plan; marker query first before any write; PROD reads via MCP first.
- Migrations auto-apply to TEST then PROD on merge; review before merge. Re-base on the latest definition before any `CREATE OR REPLACE` (none needed here; `advance_sync_cursor` untouched). SECDEF helpers need explicit REVOKE; deletion-cascade guards must exempt `quantalyze.sanitize_in_progress='on'` (no guard trigger here).
- Data-integrity gates must be able to fail: neuter, see RED, restore from a byte backup (never `git checkout/restore/stash` on uncommitted work).
- CHANGELOG entry on every ship, written before the push in the VERSION-bump commit; `VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`.
- `TODOS.md` holds open work only: delete closed entries in the ship PR; no LOW or Info survivors booked there.
- Cite census numbers and line numbers by symbol, never from restated prose.
- No AI authorship trailers in commits (user memory); `grep -a` always; pytest only from `analytics-service/`; mypy strict on touched analytics files; no full suites; stop Docker after use.
- Public repo with tracked `.planning/`: no secrets, PROD ids or home paths in tracked text.

## Sources

### Primary (HIGH)
- Repo files read this session: `analytics-service/services/job_worker.py` (seed, epilogue, flag merge, derive prestamp), `analytics-service/services/exchange.py` (constants, walk, `_record_dq_flag` sites), `analytics-service/services/analytics_runner.py` (CSV rebuild), `supabase/schema/functions/advance_sync_cursor.sql`, `supabase/schema/baseline.sql` (ACL), migrations `20260602173710`, `20260810120000`, `20260919120000`, `analytics-service/routers/cron.py` (marker semantics), `analytics-service/tests/_binance_fills.py`, `test_binancefills_cursor.py`, `scripts/mutation-floors.mjs`.
- Phase 250 R3 review on local branch `gsd/phase-250-binancefills` (WR-01 predicate, WR-02 trace).

### Secondary (MEDIUM)
- Binance developer docs (URLs in the Venue docs section), fetched through a summarising fetch tool, ordering unstated.

## Metadata

**Confidence breakdown:**
- D-01 verdict: HIGH (deterministic trace; not executed).
- Standard stack: HIGH (in-repo only).
- Architecture and pitfalls: MEDIUM-HIGH (the large derive function was cited by symbol and its early-return writes were enumerated by grep, not read end to end).

**Research date:** 2026-11-26
**Valid until:** until main's migration lane or `run_sync_trades_job` moves (Phases 251, 225 PR-3, 252 in flight); re-measure the migration stamp and the seed block before planning.
