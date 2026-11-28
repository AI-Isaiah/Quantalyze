# Phase 257: SEEDHOLD - Research

**Researched:** 2026-11-27
**Domain:** analytics worker `run_sync_trades_job` (fills-read seed, re-read bound, epilogue) and the Bybit execution-list reader
**Confidence:** HIGH on the measurements and the Bybit half; MEDIUM on the Half-1 home (the best record is existing and measured, but its convention-compliant write needs a migration, so Half 1 is a founder question, see the escalation verdict)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (verbatim)

- [Where the span lives when the bound write fails] Q: "What record carries run 1's seed to run 2 when `set_strategy_fills_reread_bound` raised?" → Selected: "NOT locked here. Research enumerates every candidate home and rates each against the five criteria below, with a measurement where the code allows one. The home is chosen only if an EXISTING record that is not anon-readable passes all five." — the choice is the research's, and the escalation trigger below keeps a hard-to-reverse choice away from autonomy.
  - (a) It works after ONE failed write. A probe of whether the RPC exists is not enough, because the arm is `except Exception`.
  - (b) It works on a first sync (possibly no `strategy_analytics` row yet) and on a set column with no stored fill for the strategy.
  - (c) It survives everything that can run between run 1 and run 2: the chained `derive_broker_dailies` pre-stamp (`_prestamp_dq_flags` builds a fresh flags dict and carries only an allowlist), the wholesale CSV rebuild in `analytics_runner`, any other wholesale `data_quality_flags` writer the census finds (including the Next.js routes under `src/app/api/`), and the worker's own `flag_load_failed` upsert, which replaces the column from an empty dict.
  - (d) It says what happens when its own write fails (the flags upsert is best-effort and unfenced), and that failure is named in the SUMMARY as a residual or closed.
  - (e) It leaves the shared `last_fetched_trade_timestamp` and the Phase 232 Q1 seed rule alone.
  - ⛔ **Escalation trigger.** If the only homes that pass (a) to (e) are a NEW key on the anon-readable `strategy_analytics.data_quality_flags` row, a migration (new table, column or RPC), or `cron_sync` and `/fetch-trades` holding their daily store, that is a founder question (it reverses Phase 255's "No new public key" choice, or adds a one-way schema change, or changes daily-P&L freshness on a separate path). The phase agent stops before planning this half and reports the measured table with a recommendation. The Bybit half may still be planned.
- [Writer census] Q: "Which writers can move a seed term between run 1 and run 2?" → Selected: "Research lists every writer of `is_fill = false` daily rows (every `sync_trades` RPC caller in Python and TypeScript, the chained derive) and every writer of the record chosen above. A seed-side fix is writer-agnostic; a writer-side fix must cover every writer on the list" — research-only.
- [Measurement first] Q: "Which SC-1 arms are RED at HEAD?" → Selected: "Not assumed. The FIRST plan task writes the matrix (Binance, OKX, Bybit, Deribit × a set column with no stored fill, a first sync with no column and no daily high-water, and a NULL column with a seed × run 1's provisional bound write raising, a daily row stored by a cron-style writer between the runs, run 2 with the RPC recovered) and runs it on unmodified code, recording each arm RED or GREEN verbatim. A GREEN arm (expected: every NULL-column-with-seed arm, and possibly Binance's first sync through the Phase 250 CR-01 reach anchor) stays as a regression pin and is reported, never forced RED" — test-only.
- [Bybit read-through shape] Q: "How does a deadline-stopped Bybit read record progress?" → Selected: "As Binance does: a window counts as complete only when its page loop ended naturally; the fills of the completed windows are returned and persisted; the read records the instant it is complete through (the end of the last completed window); the cursor stamp is at or before that mark; the epilogue's bound advances to it (`_earliest_through()` returns the mark, not the walk start minus 1 ms). A persist failure still falls back to the walk start minus 1 ms. When the deadline hits inside the FIRST window, nothing is complete: the bound holds at the run's seed and does not creep down by the overlap" — internal logic.
- [Bybit stall stays visible] Q: "Does a deadline-stopped Bybit run read as clean?" → Selected: "No. The run is never reported clean: it keeps an existing incomplete-read signal (`phase2_fill_ingestion_failed` or an existing key the research names) set, while the stamp and bound gates are decoupled from `phase2_failed` for this one case so the creep stops. The mark itself lives in the bound row and within the run if that suffices; a NEW public key for it is the same escalation as above" — avoids widening the anon-readable surface without a founder ruling.
- [Shared driver] Q: "May `walk_paginated` change?" → Selected: "Only additively, if at all: the Bybit reader tracks window completion in its own page callback, or through an opt-in the other contracts do not set. A pin asserts the other callers' behaviour is unchanged" — internal.
- [Timing] Q: "Does a partial persist after the deadline fit inside the 900 s handler cancel?" → Selected: "Research measures it against the read deadline constant and the persist batch size, and the plan states the margin; if it does not fit, the deadline is lowered for Bybit, never the handler cap raised" — internal constant.
- [Tests] Q: "Where do the gate arms live?" → Selected: "A new pytest module under `analytics-service/tests/` built on the two-run harnesses in `test_nullanchor_bound.py`, `test_binancefills_cursor.py` and `test_okxtrades_cursor.py`; existing suites change only where an assertion encodes the old behaviour, each with a dated intent-change note" — test files only.
- [Migration] Q: "Is a migration expected?" → Selected: "No. If research finds one is needed, that is the escalation above" — keeps the serial migration lane out unless a founder rules.

### Claude's Discretion

- Plan count and wave split. Standing rules: one executor per plan, PROOF-01 recorded verbatim in each plan SUMMARY, CI mypy strict in every analytics-touching pre-push check, the Bybit v5 API docs read for the execution-list paging and window semantics.

### Deferred Ideas (OUT OF SCOPE)

- `[255-OKX-BEGIN-REACH-PROBE]` stays booked; this phase does not touch the OKX reader.

(Out of scope per the CONTEXT boundary: `_fetch_raw_trades_okx`, MT5, the Phase 232 VREAD-08 ruling Q1 seed rule, the shared `api_keys.last_fetched_trade_timestamp` semantics, and the contract of the shared `walk_paginated` driver for its other callers.)
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are mapped (routed review survivors). The success criteria in `ROADMAP.md` `### Phase 257: SEEDHOLD` stand in. The map below uses them as SC-1 to SC-5.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | Run 2's walk start is at or before run 1's seed after a failed provisional bound write, whatever daily row lands between, for Binance, OKX, Bybit, Deribit, on a set column with no stored fill and on a first sync | Measured matrix (section "SC-1 measured matrix"); recommended home C4 turns all 7 RED arms GREEN in a scratch prototype |
| SC-2 | Deadline-stopped Bybit read keeps completed windows, the bound advances to the last completed window end, a deadline inside the first window holds the bound at the seed, the run stays flagged | Scratch prototype P5 measured both arms; HEAD measured RED on both. **Two inequalities in SC-2 need rewording, see Pitfall 3** |
| SC-3 | Binance read-through, Phase 255 matrix and `advance_sync_cursor` callers do not regress | 918 tests over 19 files pass unchanged on both P5 and P4 (4 scratch-copy artefacts fail identically on the unmodified copy, see Test census) |
| SC-4 | Both TODOS entries deleted in the ship PR and named in CHANGELOG | `grep -arl` of both ids: code, tests and runbooks hold none; only `TODOS.md`, `CHANGELOG.md`, `.planning/` |
| SC-5 | PROOF-01 | Neuter targets per gate in "Validation Architecture" |
</phase_requirements>

## Summary

**Half 1 (bound write failed).** At HEAD the premise "one transient failed write is enough" is false. A provisional write that fails once is repaired by the epilogue write that follows it seconds later (the run skips its read, so the epilogue runs almost at once). Measured: all 12 `first-call-only` arms are GREEN. The hole needs the RPC to fail across both writes of run 1, which in practice means the function or table is missing (the rollback or a not-yet-applied migration the TODOS entries name) or the RPC is failing function-specifically. For that persistent case 7 of 12 arms are RED at HEAD: all four venues on a set column with no stored fill, and OKX, Bybit and Deribit on a first sync. Binance first sync is GREEN through the Phase 250 CR-01 anchor, and every NULL-column-with-seed arm is GREEN through the Phase 232 bootstrap anchor.

**ESCALATION TRIGGER: it fires, conditionally. Stop before planning Half 1 and put the table below to the founder.** One existing, service-role-only record carries the span and passes (a) to (e) as a record: the finishing run's own `compute_jobs.metadata` (candidate C4). A scratch prototype that writes a seed-hold mark into the run's own job row when the provisional write fails, and reads the latest finished `sync_trades` job's mark at seed time, turns all 7 RED arms GREEN. But the repo's recorded convention (Phase 191 REFUSALRACE, migration `20261106120000_refusalrace_metadata_merge_rpcs.sql`) forbids the write path the prototype used: Python read-modify-write of `compute_jobs.metadata` through PostgREST replaces the column and loses a concurrent writer's keys, and that migration moved every such write into single-statement, service-role-only merge RPCs. Every worker writer of job metadata today is such an RPC and every direct `.table("compute_jobs")` use in the service is a SELECT. So a compliant C4 needs a new fenced merge RPC, which is a migration, which is the escalation. Every other candidate is a new public key (C1, C2), a migration, cron holding its store (C8), or fails a criterion. The Bybit half does not depend on any of this and can be planned now.

**Three C4 findings that shape the founder question.** (1) With a status- and recency-aware fake, the prototype's first reader (status list including `failed_final`) goes RED when a finished row without a mark lands between the runs; a reader limited to `done` rows, plus a fail-safe that writes `min(reach anchor, seed)` when its own hold read failed, is GREEN on the two realistic intervening-run shapes and RED only on the documented double fault (see "C4 hand-off measurement"). (2) The residual after those fixes is: the RPC down AND the mark write failing in the same run, which then also hides any earlier mark. (3) Retention bounds the mark to the 30-day reaper window for `done` rows.

**Half 2 (Bybit deadline).** Bybit lists executions newest first inside each 7-day window and the walk visits windows oldest first, so only a window whose page loop ended naturally (empty page or empty `nextPageCursor`) is complete; a partially read window holds its newest fills and misses its oldest. Recommended design, prototyped and measured: the reader's own page callback tracks completed windows in closure state (no `walk_paginated` change), and on the deadline raises the same `BybitTradeWindowIncomplete("deadline")` with two extra attributes (`completed_fills`, `read_through_ms`). Every other caller still gets a plain raise. The worker's existing `except Exception` arm reads the attributes, keeps `phase2_failed = True` (so `phase2_fill_ingestion_failed` stays set and no new public key exists), persists the completed windows' fills, and the epilogue advances the bound to the mark and stamps the newest persisted fill at or before it. A deadline inside the first window holds the bound at the seed. HEAD is RED on both arms (the bound creeps 1 h + 1 ms per refusal); the prototype is GREEN on both, passes `mypy --strict` and breaks no existing test (619 pass). The partial persist after the deadline does NOT reliably fit the 900 s handler cancel for a heavy key (an unmeasured database round trip decides it); the plan must lower the Bybit read deadline or bound the persist (see "Timing margin").

**Primary recommendation:** plan Half 2 now (reader attributes plus worker epilogue, a lower Bybit deadline constant, optional persist guard). For Half 1, report the measured table and recommend the founder approve ONE small additive migration, a fenced merge RPC that writes a seed-hold key into the running job's own `metadata` (the template is `mark_compute_job_kept_figures` and `set_compute_job_progress`), with the reader limited to `done` rows and the fail-safe above; the alternatives are a new public flag key (C1) or accepting the persistent-outage residual and booking it. In every case the matrix is written first and recorded RED/GREEN on unmodified code, and its 7 RED arms plus the pins are the gate.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Fills-read seed and provisional bound | API / Backend (`run_sync_trades_job`) | Database (bound table and RPC) | Seed computed in the worker; the DB stores and arbitrates (R0 to R7) |
| Seed-hold mark when the bound RPC is down (C4, founder-gated) | Database / Storage (`compute_jobs.metadata`, service role) | API / Backend (writer and reader) | Existing service-role-only table and column; the convention-compliant write is a new merge RPC, so a migration (the escalation) |
| Bybit window completion and read-through mark | API / Backend (`_fetch_raw_trades_bybit` page callback) | — | Window state is only visible inside the page callback; `walk_paginated` stays unchanged |
| Cursor stamp and bound advance on a deadline stop | API / Backend (worker epilogue) | Database (`advance_sync_cursor`, bound RPC) | Epilogue owns the stamp gate and `_earliest_through()` |
| Incomplete-read signal | Database (`strategy_analytics.data_quality_flags`, existing `phase2_*` keys) | API / Backend | Existing keys only; anon-readable, so no new key |
| Daily rows (`is_fill = false`) | API / Backend (`cron_sync`, `/fetch-trades`, the worker's Phase 1) | Database (`sync_trades` RPC) | Out of scope to change; the fix is seed-side and writer-agnostic |

## Standard Stack

No new libraries. The stack is the repo's own modules. [VERIFIED: no import or `requirements*.txt` change in either prototype] Half 1 option 1 adds one SQL function, nothing else.

### Core
| Component | Where | Purpose | Why standard |
|-----------|-------|---------|--------------|
| `run_sync_trades_job` | `analytics-service/services/job_worker.py:2229` | The one sync handler; seed, provisional bound, epilogue | Phases 253 and 255 built the mechanism here |
| `_fetch_raw_trades_bybit` | `analytics-service/services/exchange.py:3303` | Bybit execution reader | The reader to change |
| `BybitTradeWindowIncomplete` | `analytics-service/services/exchange.py:816` | Closed-reason refusal; two attributes get added | Already caught by the worker's `except Exception` |
| `set_strategy_fills_reread_bound` + `strategy_fills_reread_bounds` | `supabase/migrations/20261126150000_strategy_fills_reread_bound.sql` | Fenced per-strategy bound | R0 to R7 state machine, venue-agnostic |
| Two-run harness | `tests/test_nullanchor_bound.py`, `tests/_binance_fills.py` (`RereadBounds`, `column_after_advance`), `tests/test_okxtrades_cursor.py` (`_make_supabase`, `_run_job`) | Gate arms | Models the forward-only column and the stateful bound |

**Installation:** none. **Tooling observed:** Python 3.14.3, pytest 9.0.2, mypy 2.0.0 local while CI pins `mypy==2.4.0` (`analytics-service/requirements-dev.txt:53`). [VERIFIED: shell this session; requirements-dev.txt grep]

## Package Legitimacy Audit

Not applicable: this phase installs no external packages. Packages removed: none. Packages flagged SUS: none.

## Architecture Patterns

### System Architecture Diagram

```
queued sync_trades job (claimed: job row carries id, claim_token, metadata)
        |
        v
 Phase 1 daily read (seeded by load_strategy_high_waters = newest is_fill=false row)
        |
        v  _RAW_TRADE_INGESTION_ENABLED and venue in {binance, okx, bybit, deribit}
 seed = min(column, stored-fill hw | daily hw, stored bound)
        |        [C4, founder-gated]  seed = min(seed, hold mark of the latest `done` sync_trades job)
        v
 PROVISIONAL set_strategy_fills_reread_bound(unread = seed | reach anchor, covers NULL)
        |
        +-- raised --> skip fills read, hold daily store, phase2_failed ("re-read bound write failed")
        |              [C4, founder-gated]  merge {reread_floor_ms: seed} into THIS job's compute_jobs.metadata
        |              through a NEW fenced merge RPC (the prototype used a direct update, see Pattern 3)
        |              (the epilogue bound write is still attempted: it repairs a one-off failure)
        v
 Phase 1 store (sync_trades RPC) -> balance -> fetch_raw_trades(since_ms = seed)
        |
        +-- Bybit deadline: reader raises BybitTradeWindowIncomplete("deadline")
        |       carrying completed_fills (windows that ended naturally) + read_through_ms
        |       [NEW]  worker keeps phase2_failed = True, persists completed_fills
        v
 persist raw fills (batches of 100: 1 amendment SELECT + 1 upsert each)
        |
        v  EPILOGUE
   _earliest_through():  Binance branch | [NEW] Bybit deadline branch | non-Binance walk_start - 1
   stamp = newest PERSISTED fill <= read-through   (never the mark itself; Phase 250 rule)
   set_strategy_fills_reread_bound(unread = through, covers = walk start)   (R4 advance / R6 clear)
   data_quality_flags upsert (phase2_fill_ingestion_failed stays True on a deadline stop)
   advance_sync_cursor(stamp, last_sync_at, balance)
        |
        v
 other writers between run 1 and run 2:  cron_sync / POST /fetch-trades  (sync_trades RPC, is_fill=false)
                                         derive prestamp / CSV rebuild / TS routes (replace data_quality_flags wholesale)
```

### Recommended Project Structure (touch points only)
```
analytics-service/
├── services/exchange.py      # BybitTradeWindowIncomplete (2 attrs); _fetch_raw_trades_bybit closure state + deadline raise
├── services/job_worker.py    # run_sync_trades_job: seed block read (C4), provisional except arm write (C4),
│                             #   Phase-2 except arm, persist except arm, _read_through, advance_fetched_cursor, _earliest_through
└── tests/
    ├── test_seedhold_bound.py        # NEW: SC-1 matrix, SC-2 arms, SC-3 pins
    └── (existing suites unchanged unless an assertion names the old behaviour; none found, see Test census)
```

### Pattern 1: Bybit window completion tracked in the page callback (no driver change)
**What:** the callback already receives every page's `items` and `next_cursor`. `walk_paginated` ends a window's page loop naturally on `is_empty` or an empty `next_cursor` (`stop_on_short_page=False`, a stuck cursor with rows is refused in the callback), so the callback can tell when a window ended: `not items or not next_cursor`. It keeps `window_rows` for the in-flight window and moves them into `completed_rows` and records `completed_through = req.window_end` only then. A page-cap exhaustion raises in `walk_paginated`'s `for ... else`, never through this path, so a capped window is never counted complete. [VERIFIED: Read `services/exchange_pagination.py:178-253` and `services/exchange.py:3357-3550` this session]
**When to use:** only for the deadline refusal; `walk_paginated`'s other callers (`services/bybit_unified_flows.py:213`, `services/funding_fetch.py:859`, `scripts/bybit_funding_record.py:381,418`) never see a change. [VERIFIED: grep `walk_paginated(`]
**Example (scratch prototype P5, measured; not in the repo):**
```python
# exchange.py: BybitTradeWindowIncomplete.__init__
self.completed_fills: list[dict[str, Any]] = []   # set only on a "deadline" refusal
self.read_through_ms: int | None = None

# exchange.py: _fetch_raw_trades_bybit, before _fetch_page
window_rows: list[dict[str, Any]] = []
completed_rows: list[dict[str, Any]] = []
completed_through: list[int | None] = [None]
# top of _fetch_page, the existing deadline check
if _monotonic() >= deadline:
    refusal = BybitTradeWindowIncomplete("deadline")
    # dedup completed_rows on exchange_fill_id exactly like the success path, then:
    refusal.completed_fills.extend(deduped)
    refusal.read_through_ms = completed_through[0]
    raise refusal
# end of _fetch_page, before the PageResult
window_rows.extend(page_fills)
if not items or not next_cursor:          # the natural end of this window
    completed_rows.extend(window_rows)
    window_rows.clear()
    completed_through[0] = req.window_end
```

### Pattern 2: worker epilogue reads the attributes, never a public flag
**Example (scratch prototype P5, measured):**
```python
# Phase-2 `except Exception as e:` arm, after phase2_failed = True / phase2_error_message
if isinstance(e, BybitTradeWindowIncomplete) and e.reason == "deadline":
    _bybit_deadline = True
    raw_fills = list(e.completed_fills)        # persisted by the existing block below
    _bybit_through_ms = e.read_through_ms      # None = nothing complete
# persist except arm: add `_persist_failed = True` beside phase2_failed = True
# after the Binance _read_through derivation:
if _bybit_through_ms is not None:
    _read_through = datetime(1970, 1, 1, tzinfo=timezone.utc) + timedelta(milliseconds=_bybit_through_ms)
# advance_fetched_cursor gains one disjunct:
_bybit_partial_ok = _bybit_through_ms is not None and phase2_complete and not _persist_failed
advance_fetched_cursor = bool(raw_fills) and phase2_complete and (not phase2_failed or _bybit_partial_ok) and ...
# _earliest_through(), new branch between the Binance branch and the walk-start branch:
elif _bybit_deadline and not _persist_failed:
    _throughs.append(
        _bybit_through_ms if _bybit_through_ms is not None
        else (fills_since_ms if fills_since_ms is not None else _reach_anchor_ms)   # hold at the seed
    )
elif phase2_failed or any(key.startswith("sync_truncated_") and value for ...):
    _throughs.append(_walk_start_ms - 1)       # unchanged: a persist failure still lands here
```
Why "hold at the seed" is not "creep": the epilogue passes `covers = walk start` (seed minus 1 h), which is at or below the stored provisional bound (the seed), so RPC R4 sets the bound to the passed instant. Passing the seed leaves it unchanged; passing `walk_start - 1` (today) lowers it by 1 h + 1 ms every refusal. [VERIFIED: Read the RPC R4 arm in `supabase/migrations/20261126150000_strategy_fills_reread_bound.sql`; prototype run: bound `2026-05-07T00:00:00+00:00` after a first-window deadline against `2026-05-06T22:59:59.999000+00:00` at HEAD]

### Pattern 3 (Half 1, C4, founder-gated): the hold mark lives on the finishing job's own row
**Example (scratch prototype P4, measured; the prototype's write is a DIRECT update, which the repo's REFUSALRACE convention forbids, see the candidate table; the compliant form calls a new fenced merge RPC with the same value):**
```python
# seed block, after the bound read (only when _bound_read): read the latest `done` sync_trades job
res = (ctx.supabase.table("compute_jobs").select("metadata")
       .eq("strategy_id", strategy_id).eq("kind", "sync_trades")
       .in_("status", ["done"])                      # NOT failed_final (see the hand-off measurement)
       .order("created_at", desc=True).limit(1).execute())
hold = ((rows(res)[0].get("metadata") or {}).get("reread_floor_ms") if rows(res) else None)
if type(hold) is int and fills_since_ms is not None and hold < fills_since_ms:
    fills_since_ms = hold
    if _fills_cursor_ms is None:
        fills_anchor_iso = _iso_of_ms(hold)
# provisional `except Exception` arm, after phase2_error_message. FAIL-SAFE: when the hold READ itself failed
# open earlier in this run, write min(_reach_anchor_ms, seed) instead of the seed (over-fetch, never skip):
mark = min(_reach_anchor_ms, _provisional_unread_ms) if hold_read_failed else _provisional_unread_ms
# prototype (direct, replaces the column):  .table("compute_jobs").update({"metadata": {..., "reread_floor_ms": mark}})
# compliant form (a NEW migration):          .rpc("set_compute_job_seed_hold", {"p_job_id": ..., "p_claim_token": ..., "p_floor_ms": mark})
```
The mark clears itself: the next `done` `sync_trades` job row is newer and carries no mark. Marks older than the `done` reaper (30 days) are gone with their row.

### Anti-Patterns to Avoid
- **Changing `walk_paginated` or the shared pagination contract.** Not needed; the closure covers it. Other callers must be pinned unchanged.
- **A new `data_quality_flags` key for the Bybit mark or the span.** That is the escalation; the exception attributes keep the mark inside the run.
- **Persisting a partially read window.** Bybit answers newest first within a window, so a partial window holds its newest fills and misses its oldest; persisting them moves the stored-fill high-water past an unread span. The prototype drops the in-flight window (measured: 2 fills persisted from 2 completed windows, the third window's page-1 fill dropped).
- **Stamping the mark.** `last_fetched_trade_timestamp` is stamped only with the newest PERSISTED fill at or before the read-through (`job_worker.py:3035-3058` comment: "never a read-through instant, a window end or the clock"). Stamping the mark would change shared column semantics (out of scope, criterion (e)).
- **Returning the partial fills as the normal return value of `_fetch_raw_trades_bybit`.** `run_reconcile_strategy_job` (`job_worker.py:16275`, default 240 s deadline) and `scripts/bybit_reconcile.py:623` would then treat a deadline stop as a complete read. The attributes-on-the-exception shape keeps every non-worker caller raising as today. [VERIFIED: grep of `fetch_raw_trades(` callers]
- **Reading `_bound_err` or hold-read errors as "no mark" silently.** Fail open (same posture as `load_strategy_fills_reread_bound`) but log at ERROR and name the residual.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Window arithmetic | A second window iterator in the Bybit callback | `exchange_pagination._windows` already yields `(w_start, w_end)` with the `+1 ms` boundary; read `req.window_end` | Boundary bugs (mark ends in `...001`) |
| Fill dedup on a partial return | New key logic | The success path's `seen` loop on `exchange_fill_id` | Same unique index `(strategy_id, exchange, exchange_fill_id)` |
| Bound arbitration | A Python LEAST/advance in the worker | The RPC R0..R7 and the test mirror `bound_after_set` / `RereadBounds` | A PostgREST upsert cannot express LEAST (relevant to candidate C3) |
| Two-run harness | A new fake Supabase | `_make_supabase`, `_run_job`, `RereadBounds`, `column_after_advance`, `_persisted_fills`, `_two_run_walk_start_ms` | Already model the forward-only column and the stateful bound |
| Mark shape validation | Trusting stored JSON | `type(x) is int and x >= 0` (the `binance_sync_flags._valid` idiom) | The metadata is read back from a table |

**Key insight:** both halves need no new mechanism. Half 2 is a reader that reports what it completed and an epilogue branch; Half 1 is one durable value that outlives a failed RPC.

## SC-1 measured matrix (HEAD `b55fc433f`, code identical to `origin/main` `da98acd39`)

[VERIFIED: scratch pytest `tests/test_scratch_seedhold_matrix.py` in a scratch copy, 24 arms, 24 passed; the copy is `scratch/257/head/analytics-service`, raw output `scratch/257/matrix_head.txt`; `scratch/` is the session scratchpad, outside the repo]

Harness: the real `run_sync_trades_job` through `_run_job`, clock pinned at `NOW_MS = 1784116800000` (2026-07-15T12:00Z). Run 1: provisional `set_strategy_fills_reread_bound` raises (`persistent`: every call raises; `first-call-only`: the first call raises and later calls work), so the read is skipped and the daily store held (`sync_trades` was NOT called in any run 1, `fetched=0`). Between runs a cron-style daily row `2026-07-14T00:00:00+00:00` is appended. Run 2: the RPC works. Run 1's walk start is its seed minus 1 h (`1778108400000` for DAILY_ONLY_TRADES, `RUN1_SEED_MS = 1778112000000`) or the venue's reach anchor on a first sync (Binance `1776772800000` = now minus 85 d, OKX `1776081600000`, Bybit `1752580800000`, Deribit `0`). Verdict: GREEN iff run 2's walk start (`since_ms` minus the 1 h overlap) is at or before run 1's walk start.

Persistent (RPC down for the whole of run 1):

| Venue | set column, no stored fill | first sync | NULL column with a seed |
|-------|---------------------------|-----------|-------------------------|
| Binance | **RED** (run 2 `since_ms` 1781913600000 = the column) | GREEN (CR-01 anchor stamped `2026-04-21T12:00:00+00:00`, run 2 `since_ms` 1776772800000) | GREEN (bootstrap anchor stamped `2026-05-07T00:00:00+00:00`, `since_ms` 1778112000000) |
| OKX | **RED** (1781913600000) | **RED** (1783987200000 vs run 1 walk 1776081600000) | GREEN (1778112000000) |
| Bybit | **RED** (1781913600000) | **RED** (1783987200000 vs 1752580800000) | GREEN (1778112000000) |
| Deribit | **RED** (1781913600000) | **RED** (1783987200000 vs 0) | GREEN (1778112000000) |

`first-call-only` (provisional write fails once, the epilogue write lands): **all 12 arms GREEN.** The epilogue inserted the bound at `walk_start - 1 ms` (for example `2026-05-06T22:59:59.999000+00:00`) and run 2 seeded from it. Consequence for the plan: CONTEXT's "one transient failed write is enough" does not hold at HEAD; the real trigger is an RPC that is unavailable for the whole of a (short, read-skipping) run, that is, a missing function or a function-specific failure. State this in the SUMMARY.

The RED set equals the CONTEXT expectation (every NULL-column-with-seed arm GREEN, Binance first sync GREEN). Binance set-column-no-fill is the original `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` arm; Phase 255's own matrix did not cover Binance, so it is a new measurement here. Two arms to keep as regression pins even though GREEN: all NULL-column-with-seed, Binance first sync, and all `first-call-only`.

Side observation (cosmetic, pre-existing): Deribit first sync under `first-call-only` hands `since_ms = -1` to the reader (the bound `1969-12-31T23:59:59.999000+00:00` parses to -1). `fetch_deribit_fills` ignores `since_ms`, so there is no data effect; do not "fix" it here.

## Writer census (answer to required question 1)

**Writers of `is_fill = false` daily rows** (they move the daily high-water, the seed term the hole rides on):

| Writer | Where | How |
|--------|-------|-----|
| Queued sync worker, Phase 1 | `services/job_worker.py:2627-2639` (`_sync`) | `sync_trades` RPC; HELD when the provisional bound write fails (`phase1_read_refused`) |
| Nightly cron | `routers/cron.py:1138` (`_sync_single_key` fan-out) | `sync_trades` RPC per strategy; does not consult the bound or any flag |
| `POST /fetch-trades` | `routers/exchange.py:2150` | `sync_trades` RPC; does not consult the bound |
| CSV trade upload | `src/app/api/trades/upload/route.ts:130` (`supabase.from("trades").insert(batch)`) | Inserts trade rows for uploaded strategies (not exchange-key strategies; no fills read runs for them) |

[VERIFIED: `grep -anr '"sync_trades"'` over `analytics-service` (non-test) and `grep -anr "sync_trades" src scripts` (TS/mjs, the only RPC hit is a comment in `finalize-wizard/route.ts:1729`); `grep -anrl "INSERT INTO trades"` over `supabase/migrations` returns only `20260406065011_security_hardening.sql`, `20260510172558_sync_trades_preserve_fills.sql`, `20260510180535_sync_trades_date_range_scoped_delete.sql` (the `sync_trades` versions)] `derive_broker_dailies` writes NO `trades` rows: the only `table("trades")` writers in `services/` are `job_worker.py:2968` (fills upsert) and the readers at `:2940`, `:16344`, `position_reconstruction.py:375`, `exchange.py:2667`, `trade_resume.py:73,121`. [VERIFIED: grep `table("trades")`]

**Wholesale writers of `strategy_analytics.data_quality_flags`** (relevant to any home that lives there, candidates C1 and C2):

| Writer | Where | Carries |
|--------|-------|---------|
| Worker flag upsert (read-modify-write, `flag_load_failed` falls back to an empty dict) | `job_worker.py:3207-3405` (`_stamp_phase2_flags`) | merges |
| Chained `derive_broker_dailies` pre-stamp | `job_worker.py:11962` `_prestamp_flags: dict[str, Any] = {"csv_source": True}`, upsert at `:12374` | only `LAST_SUCCESS_SNAPSHOT_KEY` and `carry_binance_sync_flags` (nine `binance_*` keys): **`phase2_*` is wiped here** |
| Derive failed stamp | `job_worker.py:6738` area (`_derive_failed_flags`) | binance carry |
| Composite stitch error stamps | `job_worker.py:13130`, `:13171` (`merged_flags`) | merges |
| CSV rebuild | `analytics_runner.py:2243` (`data_quality_flags = {"csv_source": True}`, upsert payload `:2505`) | binance carry (`:2396`) |
| CSV insufficient-window stamp / truncated / config-failed stamps | `analytics_runner.py:1993`, `:2651`, `:2711` | partial |
| Next.js routes | `src/app/api/strategies/finalize-wizard/route.ts:2555,2698`, `src/app/api/strategies/csv-finalize/route.ts:1930`, `src/app/api/keys/sync/route.ts:654` | fresh `{ csv_source: true, ... }` objects |

[VERIFIED: Read of `job_worker.py:12290-12380`, `binance_sync_flags.py:1-80`; grep of `data_quality_flags` in `src/app/api`; scripted scan of `table("strategy_analytics").upsert|update|insert` in `services/` and `routers/`. Line numbers for the stamps not Read in full (`:1993`, `:2651`, `:2711`, `:6738`, `:13130`, `:13171`) are anchors from grep and should be re-resolved by the planner.]

SQL-side: no database function writes the column. `grep -an "data_quality_flags" supabase/schema/functions/*.sql` lists two files, `enqueue_ledger_refresh_for_strategies.sql` and `get_verified_cohort_rank.sql`, and every hit is a read expression (`->>`). [VERIFIED: grep this session]

Consequence: a record that lives in `data_quality_flags` needs a carry edit in at least nine writers (Python and TypeScript) to satisfy (c); `phase2_fill_ingestion_failed` itself does not survive the chained derive today.

## Candidate homes for the span (answer to required question 3)

Failure model used: "the provisional write failed, and so did the epilogue write" (persistent), because `first-call-only` is already GREEN. A home counts for (a) when it is written through a surface that does not depend on `set_strategy_fills_reread_bound` working.

| # | Candidate | (a) | (b) | (c) | (d) | (e) | Closes (measured or reasoned) | Verdict |
|---|-----------|-----|-----|-----|-----|-----|-------------------------------|---------|
| C1 | NEW key on `data_quality_flags` (for example the seed instant), carried | yes (flags upsert, a separate call) | yes (the upsert creates the row; `_load_existing_flags` already handles a missing row via `one()`) | **only after carry edits in the nine writers above** | flags upsert is unfenced best-effort (`job_worker.py:3398-3405`) | yes | all states | **Escalation item**: a new anon-readable key reverses Phase 255's "No new public key". Precedent exists (`binance_read_through_ms` is public and carried) but is the founder's call |
| C2 | Carry the existing `phase2_*` keys | yes | yes | **no today**: derive pre-stamp wipes them; passes only with the same nine carry edits | same | yes | value-less (a dirty bit, not the span); would need a widening to the reach anchor on read | Same escalation in practice (changes the carry surface of a public record) |
| C3 | `strategy_fills_reread_bounds` written by a direct PostgREST table upsert when the RPC raises | **no for the named triggers**: a rollback or a not-yet-applied migration removes the table together with the function (both are created in the same migration); passes only for a function-only fault | yes | yes (no flags writer touches it) | a second write on the same endpoint | yes | all states if the table is up | Fails (a) for the failure it exists for; also loses the claim-token fence and the LEAST arbitration (a PostgREST upsert replaces the value, so it could RAISE a stored bound) |
| **C4** | **The running job's own `compute_jobs.metadata` (service-role only, RLS deny-all), read from the latest `done` `sync_trades` job** | yes as a record (a separate table on a separate endpoint; both failing in one run is the named residual) | yes (a job row exists for every run, no `strategy_analytics` row needed) | yes against the writers on the census (none touches `compute_jobs`); `claim_compute_jobs_with_priority` merges metadata with `||` (Read: `claim_compute_jobs_with_priority.sql:410`), `mark_compute_job_done` flips only `status` (Read: `mark_compute_job_done.sql:39-43`) | write best-effort; failure logged at ERROR and named as the residual "RPC down and the mark write failed in the same run" (which also hides an earlier mark) | yes | **all 7 RED arms (measured P4); intervening-run arms GREEN with the two fixes (measured)** | **Passes (a) to (e) as a record. The write path is the problem:** a direct PostgREST update replaces `metadata` (the lost-update class Phase 191 REFUSALRACE removed); the compliant write is a NEW merge RPC = a migration = the escalation. Recommended as the founder's option 1 |
| C5 | `strategy_sync_cursors` | yes | yes | yes | — | yes | none | Rejected: it is the cron's per-strategy daily-window resume marker (its row means "this strategy is HELD" to the fan-out); writing the span there changes the cron's window and does not stop the daily high-water moving |
| C6 | Lower `api_keys.last_fetched_trade_timestamp` | — | — | — | — | **no** | — | Excluded by (e); the column is forward-only through `advance_sync_cursor` |
| C7 | Generalise the Phase 250 CR-01 reach anchor (D2 in 255-RESEARCH) to OKX and Bybit | yes (a different RPC, `advance_sync_cursor`) | first sync only | yes | the anchor rides the epilogue stamp | yes | **OKX and Bybit first sync only (measured P1)**; NOT set-column-no-fill; NOT Deribit first sync (an epoch-0 anchor must not be written into the shared per-key column, 255 D2 and A4); a naive copy using `BINANCE_FILLS_REACH_DAYS` (85 d) stays RED, the anchor must be the per-venue `_reach_anchor_ms` (measured) | Partial. Not needed if C4 is taken. Side effect: anchors the shared per-key column at the venue reach for sibling strategies on the key |
| C8 | `cron_sync` and `/fetch-trades` hold their daily store | needs a record to key on | — | — | changes daily-P&L freshness | yes | — | Escalation item by CONTEXT, and not self-sufficient |
| C9 | Retry the provisional RPC in-run | — | — | — | — | yes | adds nothing: `first-call-only` is already GREEN through the epilogue write | Not a home |
| C10 | Store a sentinel fill row at the seed so the stored-fill high-water holds it | — | — | — | — | — | — | Rejected: invents data in `trades` |

**ESCALATION TRIGGER: fires, conditionally.** C4 is an existing record that is not anon-readable (`compute_jobs` carries `CREATE POLICY ... compute_jobs_deny_all`, comment "Service-role-only. Non-service callers get zero rows. User-scoped reads go through get_user_compute_jobs() SECURITY DEFINER", `baseline.sql:18511`; `GRANT ALL ON TABLE "public"."compute_jobs" TO "service_role"`, `baseline.sql:19497`), so on the record alone the trigger would not fire. It fires on the write path, for three reasons all read this session:
1. **Convention.** `20261106120000_refusalrace_metadata_merge_rpcs.sql` opens: "Two callers change `compute_jobs.metadata` by reading the whole object, editing one key and writing the whole object back. PostgREST replaces the column, so if the other writer lands between that read and that write, its key is undone", and its remedy is "Two new service-role-only functions. Each does its whole job in ONE UPDATE that merges into `metadata`". The worker's job-metadata writers are `mark_compute_job_kept_figures(p_job_id)` and `set_compute_job_progress(p_job_id, p_claim_token, p_progress)`; every `table("compute_jobs")` use in non-test service code is a SELECT (`main_worker.py:1674`, `routers/process_key.py:1090,1860`, `job_worker.py:4594,5345,5387,5404,19522`). A direct update with the claimed `job["metadata"]` would hold a stale copy for the whole handler (minutes), exactly the race window REFUSALRACE closed.
2. **No existing RPC fits.** `mark_compute_job_kept_figures` sets one fixed key. `set_compute_job_progress` is fenced and merge-safe but writes `member_progress` and `member_progress_at`, which the frontend reads for the sync progress UI (`src/lib/sync-progress.ts`, `src/app/api/strategies/[id]/sync-progress/route.ts`); reusing it would put a seed instant into a user-visible progress field.
3. **So the compliant C4 is a new RPC** (for example `set_compute_job_seed_hold(p_job_id, p_claim_token, p_floor_ms)`, one fenced `||` merge, service-role grant only, catalogue-only verify block). That is "a migration (new ... RPC)" in CONTEXT's escalation list, serial migration lane, PROD auto-applies after TEST on merge.

**What to put to the founder (Half 1 only; Half 2 is independent):** (1) approve the additive merge RPC and C4 (recommended: closes all 7 RED arms, no public surface, residual named); (2) approve a new public key (C1, reverses Phase 255 and needs carry edits in the nine writers); (3) accept the persistent-outage residual, book it, and ship Half 2 alone (the matrix still lands as pins and as RED arms marked as the booked residual). All three options keep the matrix as the first task.

**C4 measured (scratch prototype P4, `scratch/257/p4`, output `scratch/257/matrix_p4.txt`):** with the mark written on the provisional failure and read at seed time, all 24 matrix arms are GREEN, including the 7 RED persistent arms (for example OKX set column: run 2 `since_ms` 1778112000000 = run 1's seed; Bybit first sync: 1752580800000 = run 1's reach anchor; Deribit first sync: 0). The prototype's `JobsStore` fake replaces the whole `metadata` and, for this table, ignores status and recency; the next table is the measurement that models both.

**C4 hand-off measurement (scratch `scratch/257/p4`, output `scratch/257/handoff.txt`; real worker, fake that filters by `status` and orders by recency; venues OKX and Bybit, set-column-no-fill and first sync, 36 arms):** run 1 (RPC down, mark written, status `done`), then an intervening row or run, then run 2 with the RPC recovered and a cron-style daily row stored.

| Intervening row | Reader V1: statuses `done`, `done_pending_children`, `failed_final` | Reader V2: `done` and `done_pending_children` | Reader V3: V2 plus fail-safe write on a failed hold read |
|-----------------|------|------|------|
| A: a `failed_final` row with no mark (a run that died before the seed block) | **RED** (hides the mark) | GREEN | GREEN |
| B: a finished run, RPC still down, whose hold read failed open (a `compute_jobs` blip) | **RED** (its own later seed becomes the mark) | **RED** | **GREEN** (it wrote `min(reach anchor, seed)`; run 2 re-reads from the anchor, for example OKX walk 1776078000000) |
| C: a finished row with no mark and no recorded bound (the double fault: RPC down AND the mark write failed) | RED | RED | RED |

So V3 is the specification: status list without `failed_final`, and the fail-safe on a failed hold read. Arm C is the named residual (d), now stated as: the RPC down AND the mark write failing in one run loses the span, and the finished row without a mark also hides any earlier mark. A positive hand-off (carry the mark forward on every finished run that did not clear it) would not close C either, because the carrying write is the thing that failed. The planner must keep arms A, B, C as gates (A and B GREEN, C recorded as the residual with its RED output).

**Costs and residuals of C4 (state in the SUMMARY):**
1. One extra indexed read per sync run on the bound venues (the same query shape already runs at `job_worker.py:5387`); fail OPEN with an ERROR log and the V3 fail-safe on the next write. [ASSUMED: index coverage was not measured]
2. Retention: `DELETE FROM compute_jobs WHERE status = 'done' AND created_at < now() - interval '30 days'` (Read: `20260515113853_retention_crons_safe.sql:196-201`; later migrations name it only in comments, `20261021120000_refresh_fanout_owed_key_reconstruct.sql:13` still says 30 days). A mark older than that is lost; the claim is bounded to an outage shorter than 30 days. `done_pending_children` rows are not reaped by it.
3. A new migration and RPC (the escalation), with a catalogue-only verify block, a SQL gate and the `schema:functions` snapshot regeneration, in the serial migration lane.
4. Status semantics (Read this session): `mark_compute_job_done` flips `running` to `done` (`mark_compute_job_done.sql:39-43`); `done_pending_children` is the waiting state of a row whose parents are unfinished, released to `pending` by a parent finishing (`:108-118`), so a finished `sync_trades` row is `done` and the reader needs only `done`.
5. Residual (d) as stated under the hand-off table.
6. The mark clears by recency, not deletion: a later `done` row without a mark hides it. A later run that fails before finishing is not in the status list, so the earlier mark stays honoured.

**What each candidate closes, in one line:** C4 closes every column state on all four venues; C7 closes only OKX and Bybit first sync; nothing but C4, C1 or C2 closes set-column-no-fill (C1 and C2 need the nine carry edits).

## Bybit API semantics (answer to required question 4)

Read from `https://bybit-exchange.github.io/docs/v5/order/execution` this session. [CITED: bybit-exchange.github.io/docs/v5/order/execution]
- `startTime` and `endTime`: "startTime and endTime are not passed, return 7 days by default"; "Only startTime is passed, return range between startTime and startTime+7 days"; "Only endTime is passed, return range between endTime-7 days and endTime"; "If both are passed, the rule is endTime - startTime <= 7 days".
- `limit`: "Limit for data size per page. [`1`, `100`]. Default: `50`". `cursor`: "Use the `nextPageCursor` token from the response to retrieve the next page of the result set".
- Sort: "sorted by `execTime` in descending order"; tip: ties sort by `execId+OrderId+leavesQty`.
- History: the page body states no retention period; the title reads "Get Trade History (2 years)" (the repo's `BYBIT_EXECUTION_HISTORY_DAYS: int = 730` rests on that and its code comment, `exchange.py:192`).
- No rate-limit text on the page.

Implications for "window complete":
1. Pages inside a window arrive newest first, and the repo walks windows oldest first. A deadline mid-window therefore leaves the window's NEWEST executions in hand and its OLDEST unread. A partially read window must not be persisted or counted: "complete through" is the end of the last window whose cursor ran out.
2. A window is complete exactly when its page loop ended naturally: an empty `list` or an empty `nextPageCursor`. A short page with a live cursor is NOT the end (the reader is cursor-authoritative, `stop_on_short_page=False`). Page-cap exhaustion (200 pages, `BYBIT_EXECUTION_WINDOW_PAGE_CAP: int = 200`) raises and is never complete.
3. Window ends carry the driver's `+1 ms` boundary: with `effective_since = RUN1_SEED - 3_600_000` the first two window ends measured `1778713200000` and `1779318000001`, so the mark ends in `...001`. The docs do not say whether `endTime` is inclusive. [ASSUMED: inclusive, matching the existing Phase 231 contract; the overlap hour absorbs a boundary row either way]
4. The mark is a window end (a wall-clock instant), not a fill timestamp. The stamp stays the newest persisted fill at or before it.

## Bybit design and how Binance does it (answer to required question 5)

| Concern | Binance today | Bybit (recommended) |
|---------|---------------|---------------------|
| Where completion is tracked | per symbol in `_BinanceSymbolRead.read_through_ms` (`exchange.py:2806-2932`) | closure state in `_fetch_page` (the shared driver loses its rows on a raise) |
| How the mark reaches the worker | `_record_dq_flag("binance_read_through_ms", min(stop_bounds))` (`exchange.py:3058`), merged into `exchange_dq_flags`, PUBLIC and carried by `binance_sync_flags.py` | attributes on the raised `BybitTradeWindowIncomplete`; no flag, nothing public |
| Run flagged incomplete? | no `phase2_failed`; `binance_*_symbols` flags name the stop | yes: `phase2_failed = True` stays, so `phase2_fill_ingestion_failed` and the existing `phase2_error` text stay |
| Fills returned | healthy symbols' fills, normal return | completed windows' fills only, on the exception; `fetch_raw_trades` re-raises the same object (`exchange.py:2614-2621`), so its `except` arm needs no change |
| Stamp | newest persisted fill ≤ `_read_through` (`job_worker.py:3052-3058`) | same code path: `_read_through` is set from the Bybit mark |
| Bound | `_earliest_through()` Binance branch returns `binance_read_through_ms` | new branch returns the mark; hold at the seed when no window completed; persist failure keeps `walk_start - 1` |

**Measured arms (scratch P5 vs HEAD)**, real `_fetch_raw_trades_bybit` with a fake exchange and fake clock (each request costs 1 s; each window is 2 requests, page 1 returns one fill and a cursor, page 2 empty), real `run_sync_trades_job` for run 1 and run 2; seed `RUN1_SEED_MS` (2026-05-07T00:00Z), column set (`CURSOR_AHEAD_TS`) and NULL. [VERIFIED: scratch run, `scratch/257/bybit_arms.txt`]

| Arm | HEAD | Prototype P5 |
|-----|------|--------------|
| Deadline after window 2 (set and NULL column) | reader `mark=None`, 0 fills persisted; bound `2026-05-06T22:59:59.999000+00:00` (seed - 1 h - 1 ms); run 2 walk `1778104799999` < run 1 walk `1778108400000` (**creeps, RED**) | `mark=1779318000001` (2026-05-20T23:00:00.001Z), 2 fills persisted (the in-flight third window's fill dropped), stamp `2026-05-20T22:30:00.001000+00:00` (the newest persisted fill, ≤ mark), bound `2026-05-20T23:00:00.001000+00:00` (= mark), `phase2_fill_ingestion_failed` True, run 2 `since_ms` 1779316200001, walk `1779312600001` (**advanced, GREEN**) |
| Deadline inside the first window (set and NULL column) | bound seed - 1 h - 1 ms; run 2 walk below run 1's (**creeps, RED**) | `mark=None`, nothing persisted, bound `2026-05-07T00:00:00+00:00` (= the seed exactly), run 2 walk `1778108400000` = run 1's (**holds, GREEN**), flag True |

`mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` on the prototype: `Success: no issues found in 146 source files`. Existing suites on P5: `619 passed, 1 skipped` over `test_nullanchor_bound`, `test_binancefills_cursor`, `test_okxtrades_cursor`, `test_job_worker`, `test_sync_trades_store_truth`, `test_sync_trades_resume_seed`, `test_ana_recon_audit`, `test_exchange`, `test_binancefills_e2e` (193 s). [VERIFIED: scratch runs this session]

**Callers of the changed surface (list for the pin):**
- `_fetch_raw_trades_bybit`: `fetch_raw_trades` (`exchange.py:2607`, passes `read_deadline_s`), `services/ingestion/bybit.py:79` (passes no deadline, never takes the deadline path, `test_no_deadline_reads_the_whole_span` pins it).
- `fetch_raw_trades` callers: `run_sync_trades_job` (`job_worker.py:2695`), `run_reconcile_strategy_job` (`job_worker.py:16275`, default 240 s deadline), `scripts/bybit_reconcile.py:623`. The last two keep raising on a deadline and never read the attributes; the worker's `classify_exception` (`job_worker.py:1462`) sees the same exception class and reason.
- `walk_paginated`: unchanged; other callers `bybit_unified_flows.py:213`, `funding_fetch.py:859`, `scripts/bybit_funding_record.py:381,418`.

## Timing margin (answer to required question 5, last part)

Constants. [VERIFIED: Read this session] `BINANCE_SYNC_FILLS_READ_DEADLINE_S: float = 840.0` (`exchange.py:759`); `"sync_trades": 15 * 60,` in `TIMEOUT_PER_KIND` (`job_worker.py:1072`) wrapped by `result = await asyncio.wait_for(handler(job), timeout=timeout)` (`job_worker.py:19703`); the Bybit deadline is `max(1.0, 840 - (monotonic() - handler_start))` (`job_worker.py:2689-2694`); the watchdog override is 30 minutes (`main_worker.py:344`). The comment at `exchange.py:741-758` already names the persist tail as the SYNC HANDLER TAIL known limit and the 60 s remainder.

What the 60 s (900 minus 840) must hold after the deadline: one request already past the check (at most ccxt's 10 s default timeout, `exchange.py:749` comment), the partial persist, the flag upsert, the bound RPC, `advance_sync_cursor`, the enqueue. Persist cost per 100 fills is two round trips (one amendment-probe SELECT of at most 100 ids, one upsert; `job_worker.py:2931-2973`).

| Database round trip r (per call) | Fills persistable in about 45 s of the 60 s margin |
|----------------------------------|-----------------------------------------------------|
| 0.05 s | about 45,000 (450 batches x 2 x 0.05 s) |
| 0.10 s | about 22,500 |
| 0.20 s | about 11,250 |

A Bybit read produces up to 100 fills per request and the measured busiest week was 44 pages at about 0.5 s a page (`255-REVIEW-R2.md`, R2-WR-02 (b)). So 840 s of reading can hold up to about 1,680 pages, up to 168,000 fills, whose persist takes about 336 s at r = 0.1 s. A deadline stop is by definition a heavy key, so the persist overrunning the handler is the EXPECTED case, not the corner. The database round trip from the worker is UNMEASURED [ASSUMED: 0.05 to 0.2 s; nothing in the repo records it, `exchange.py:752` says so too], and this session had no database access, so the margin cannot be stated as a measured number.

What the cancel does if it lands mid-persist: `CancelledError` is not caught by `except Exception`; the epilogue never runs; fills already upserted stay (idempotent); the provisional bound row stands at the seed; the job fails as a timeout. Integrity is unchanged from today (no span lost), liveness is today's stall (same seed, no progress) and the loud `phase2_fill_ingestion_failed` flag is lost for that run.

**Recommendation (CONTEXT: lower the Bybit deadline, never raise the cap):** pick the Bybit read deadline as `D = (900 - elapsed_before_read - 10 - 15) / (1 + rho)` where `rho = 2 * r / page_seconds` for full pages (r = 0.1 s, page 0.5 s gives rho 0.4 and D about 600 s; r = 0.2 s gives rho 0.8 and D about 485 s), keep the existing "remaining budget" subtraction, and give it its own named constant rather than reusing `BINANCE_SYNC_FILLS_READ_DEADLINE_S`. Measure r first (worker logs or Sentry spans, a read-only PROD query the founder has authorised) and write the number and its derivation beside the constant. As a hard backstop independent of the estimate, plan a persist-time guard in the persist loop (stop persisting once handler elapsed passes a reserve before 900 s, then take the "hold at the seed" bound so the epilogue still runs and the stall stays loud) and say so in the plan; whether to include the guard is the planner's call, not decided here. Pin the new constant and the margin with a test against `TIMEOUT_PER_KIND["sync_trades"]`.

## Write scope by symbol (answer to required question 8)

`run_sync_trades_job` is shared with Phase 256, which edits `services/exchange.py` OKX paths (`_fetch_raw_trades_okx`, `OKX_FILLS_REACH_DAYS`, `_okx_fills_begin_floor_ms`). The hunks below are disjoint from those; re-base on `origin/main` before ship.

| File | Symbol (hunk) | Half | Change |
|------|---------------|------|--------|
| `services/exchange.py` | `class BybitTradeWindowIncomplete.__init__` (`:843`) | 2 | two attributes, default empty/None |
| `services/exchange.py` | `_fetch_raw_trades_bybit`: closure state before `_fetch_page`, the `deadline` branch at the top of `_fetch_page`, the tail before `PageResult` | 2 | track windows; attach on deadline |
| `services/exchange.py` | a new named constant for the Bybit sync read deadline (next to `BINANCE_SYNC_FILLS_READ_DEADLINE_S`, `:759`) | 2 | timing |
| `services/job_worker.py` | `run_sync_trades_job`: declarations beside `_fills_read_skipped` (`:2277`) | 1, 2 | `_bybit_deadline`, `_bybit_through_ms`, `_persist_failed` |
| `services/job_worker.py` | seed block after the bound read (`:2481-2502`) | 1 | read the hold mark |
| `services/job_worker.py` | provisional `except Exception` arm (`:2553-2576`) | 1 | write the hold mark |
| `services/job_worker.py` | `_fills_read_deadline_s` computation (`:2689-2694`) | 2 | Bybit constant |
| `services/job_worker.py` | Phase-2 `except Exception as e` arm (`:2718-2750`) | 2 | read the attributes |
| `services/job_worker.py` | `_read_through` derivation (`:2787-2796`), `_earliest_through` (`:2838-2861`), persist `except` (`:2976-2989`), `advance_fetched_cursor` (`:3037-3044`) | 2 | epilogue branches |
| `supabase/migrations/<ts>_set_compute_job_seed_hold.sql` plus `supabase/tests/` gate plus regenerated `supabase/schema/functions/` snapshot | new, ONLY if the founder rules option 1 | 1 | one fenced merge RPC; serial migration lane; catalogue-only verify block (the repo rule: shared TEST holds PROD's catalogue and never its data) |
| `tests/test_seedhold_bound.py` | new module | 1, 2 | matrix, arms, pins |

Not touched: `walk_paginated`, `fetch_raw_trades`'s body, the other venue readers, `advance_sync_cursor`, any migration other than the option-1 RPC above, `routers/cron.py`, `routers/exchange.py`, the derive and CSV writers.

Plan split suggestion (the planner decides): plan 01 writes `test_seedhold_bound.py` (the SC-1 matrix on unmodified code, recorded RED/GREEN verbatim, plus SC-2 arms RED at HEAD); plan 02 does Half 2 (reader plus epilogue plus constant); plan 03 does Half 1 (C4) and the SC-3 pins; both code plans edit `run_sync_trades_job`, so serialise them or give them separate worktrees and merge by hunk.

## Test census (answer to required question 6)

`grep -a` for the old behaviour: only `tests/test_nullanchor_bound.py::TestBybitReadDeadline` (lines 742-803) exercises the deadline refusal. `tests/test_exchange.py` holds 21 `BybitTradeWindowIncomplete` references, none for `deadline`; `tests/test_job_worker.py:81-106` classifies the reasons for `classify_exception` and is unaffected. No test asserts an exact `rpcs ==` list for the bound RPC; the two RPC-order assertions are index comparisons (`test_nullanchor_bound.py:472`, `test_binancefills_cursor.py:1516`). `read_deadline_s` appears in 8 test files; the Binance ones pin the Binance branch.

Measured on the prototypes over the full 255-RESEARCH census (19 files, including `test_stamp_io_exhaustive.py`, `test_binance_sync_flags.py`, `test_fetch_trades_resume_seed.py`, `test_computation_error_provenance_census.py`): P5 (Bybit read-through) and P4 (C4) each `918 passed, 13 skipped, 4 failed`. The 4 failures are scratch-copy artefacts: the unmodified copy fails the same 4 (`test_computation_error_provenance_census.py` x3 and `test_no_contact_support_copy.py` x1, `git ls-files` exits 128 outside a git checkout). Those two files therefore were NOT verified against the prototypes; re-run them in the real worktree at plan time. **No other existing assertion breaks**, so no intent-change edits are required for existing suites. (Earlier narrower runs: P5 619 passed over 9 files, P4 398 over 8.) Review each of these for a wording or dated-note touch only if the plan changes them:
- `TestBybitReadDeadline::test_the_worker_keeps_the_bound_and_stamps_phase2_failed` still passes because its `raw_error` is the reader's real refusal, which now carries an empty fill list and a mark; it asserts `bounds.rows != {}` and a held stamp, both still true. Consider tightening it to the new bound value.
- `test_the_bybit_read_gets_the_handler_budget_remaining` asserts `read_deadline_s == BINANCE_SYNC_FILLS_READ_DEADLINE_S - 100.0` for Bybit; it WILL break if the plan introduces a separate lower Bybit constant. That is an intent change; record a dated note.

**RED-on-HEAD expectation for SC-2's two arms** (measured, section above): arm 1 RED (the bound lowers and run 2 walks earlier, nothing persisted); arm 2 RED if asserted as "bound equals the seed exactly" or "run 2 walk start equals run 1's" (HEAD creeps by 1 h + 1 ms), and GREEN if asserted only as "at or before" (it is at or before, trivially). Assert equality.

New fakes must route the new reads: any fake that drives `run_sync_trades_job` and answers `table("compute_jobs")` with an unconfigured MagicMock tolerates the read (it iterates empty), which is why the existing suites still pass; the new arms need a stateful `JobsStore` fake that models status and recency (the scratch `JobsStore` in `scratch/257/p4/analytics-service/tests/test_scratch_c4_handoff.py` is a starting point).

## Common Pitfalls

### Pitfall 1: treating one failed write as the trigger
**What goes wrong:** arms built on a single failing call are GREEN at HEAD and prove nothing. **Why:** the epilogue write repairs it. **How to avoid:** the RED arms use a persistent `rpc_error` (both writes fail), and `first-call-only` is a pin. **Warning sign:** an arm that is GREEN on unmodified code.

### Pitfall 2: the mark must outlive the derive, so it cannot live in `data_quality_flags`
**What goes wrong:** the chained derive replaces the column with `{"csv_source": True, ...}` plus two carries (`job_worker.py:11962`), minutes after run 1. **How to avoid:** any value in that row needs a carry in nine writers (the census); C4 avoids it.

### Pitfall 3: SC-2's inequalities are tighter than the mechanism allows
**What goes wrong:** SC-2 says run 2's seed is at the mark and its walk starts "no earlier than the mark minus the 1 h overlap". Run 2's seed is `min(column, newest stored fill, bound)`, and the column is stamped with the newest PERSISTED fill, never the mark (Phase 250 rule, criterion (e)). Measured: mark `2026-05-20T23:00:00.001Z`, newest fill 30 min earlier, run 2 walk start `1779312600001` = mark minus 1.5 h, which fails the literal "no earlier than mark minus 1 h". **How to avoid:** word the arm as `run 2 walk start == newest completed-window fill minus OVERLAP_WINDOW_MS`, `> run 1's walk start`, and `bounds.rows[strategy] == mark`; or place a fill exactly at the mark. If completed windows hold no fill at all, the seed does not advance (nothing was stored to stamp) but the bound is still the mark; that case costs only re-reading empty windows. Raise this wording change in the plan, it edits a ROADMAP success criterion's detail.

### Pitfall 4: `phase2_failed` is overloaded
It is set by a failed read AND by a failed persist (`job_worker.py:2988`). The "persist failure falls back to walk start minus 1 ms" rule therefore needs its own marker (`_persist_failed`); without it the deadline branch cannot tell the two apart.

### Pitfall 5: partial window rows
Persisting the in-flight window moves the stored-fill high-water to its newest fill, which is past an unread span (the window's oldest part). The seed term `min(column, fill hw, bound)` is then rescued only by the bound; do not rely on that. Drop the in-flight window.

### Pitfall 6: the harness runs both runs under one job id
`_run_job` hard-codes `{"id": "job-232", ...}`, so a reader that excludes the current job by id would hide run 1's mark from run 2 in a test while working in production. Model status and recency in the fake and give the two runs distinct job ids in the new arms.

### Pitfall 7: the Bybit anchor and a later clock
Unchanged from Phase 255: the Bybit reach anchor is the 365-day first-sync lookback, never the 730-day cap; a hold at the anchor on a later clock must stay inside `BYBIT_EXECUTION_HISTORY_DAYS` or the reader raises `start_too_old`. The first-sync C4 hold keeps the anchor, so run 2's walk start is the anchor of run 1: with a clock days later it is still far inside 730 days.

### Pitfall 8: Phase 256 conflict and the TODOS ids
Re-base on `origin/main` before ship. Both ids appear only in `TODOS.md`, `CHANGELOG.md` and `.planning/` (no source, test or runbook): delete both `TODOS.md` entries in the ship PR, name them in the CHANGELOG entry, and fix any `.planning` pointer the ship touches. No skip-CI token in any message, even to deny it.

## Code Examples

### SC-1 two-run arm (the harness the matrix uses)
```python
# Source: scratch tests/test_scratch_seedhold_matrix.py, adapted from tests/test_nullanchor_bound.py::_two_runs
bounds = FlakyBounds(fail_first=99)          # 99 = persistent; 1 = first-call-only
sb1, rec1 = _make_supabase(trades_rows=rows1, bounds=bounds, flags=flags)
out1 = await _run_job(supabase=sb1, column=column, exchange=venue, daily_trades=DAILY_TRADES_RUN1)
assert out1.fetch_raw.call_count == 0          # the read is skipped
assert "sync_trades" not in [c.args[0] for c in sb1.rpc.call_args_list]   # the daily store is held
stamp = rec1.advance_params[0]["p_last_fetched_ts"] if rec1.advance_params else None
rows2 = rows1 + [DAILY_MOVED]                  # the cron-style writer
bounds.fail_first = 0                          # the RPC recovers
sb2, _ = _make_supabase(trades_rows=rows2, bounds=bounds, flags=flags)
out2 = await _run_job(supabase=sb2, column=column_after_advance(column, stamp), exchange=venue)
assert _two_run_walk_start_ms(out2) <= run1_walk_ms      # hand-typed per venue/state, see the table
```
`FlakyBounds` subclasses `RereadBounds`, wraps its `rpc().execute` to raise on the first N calls and record the payload. Hand-typed instants (all verified by the measurements above): `1778112000000` 2026-05-07T00:00Z, `1781913600000` 2026-06-20T00:00Z, `1783987200000` 2026-07-14T00:00Z, `1784116800000` 2026-07-15T12:00Z, reach anchors OKX `1776081600000`, Bybit `1752580800000`, Binance `1776772800000`, Deribit `0`.

### Bybit deadline arm (fake exchange and fake clock)
```python
# Source: scratch test_scratch_bybit_deadline.py (real reader, real worker)
monkeypatch.setattr(ex, "_monotonic", lambda: clock[0])          # every request costs 1 s
with pytest.raises(ex.BybitTradeWindowIncomplete) as raised:
    await ex._fetch_raw_trades_bybit(exchange, RUN1_SEED_MS - ex.OVERLAP_WINDOW_MS,
                                     now_ms=NOW_MS, read_deadline_s=4.5)   # 0.5 = inside the first window
await _run_job(supabase=sb1, column=column, exchange="bybit",
               daily_trades=DAILY_TRADES_RUN1, raw_error=raised.value)
```
Two requests per window (page 1: one fill and cursor `"c"`; page 2: empty list and `""`). 4.5 s completes two windows then dies on the first request of the third; 0.5 s dies inside the first.

## State of the Art

| Old approach | Current approach | When changed | Impact |
|--------------|------------------|--------------|--------|
| Bybit deadline raises, reader returns nothing, every refusal lowers the bound by 1 h + 1 ms | Reader reports completed windows and a mark, worker advances or holds the bound | this phase | Closes `[255-BYBIT-DEADLINE-NO-PROGRESS]` |
| Provisional bound failure leaves the seed dependent on the daily high-water | A hold mark outside the RPC | this phase (C4) | Closes `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]` for the persistent-outage case |

**Deprecated or corrected:** CONTEXT's "one transient failed write is enough" (measured not true at HEAD, see matrix).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Database round trip from the worker is 0.05 to 0.2 s; nothing in the repo or this session measured it | Timing margin | The Bybit deadline constant would be mis-sized; mitigated by measuring r first and by the persist guard |
| A2 | (resolved, was assumed) a finished `sync_trades` row is `done`; `done_pending_children` is the waiting state of a row whose parents are unfinished | Pattern 3 | none now; Read in `mark_compute_job_done.sql:39-43,108-118` |
| A3 | Bybit `endTime` is inclusive (the docs do not say) | Bybit semantics | A fill exactly on a window end could sit in neither window; the 1 h overlap absorbs it |
| A4 | The realistic persistent-outage triggers are a missing function (rollback or an unapplied migration) or a function-specific failure; no down migration exists in the repo for `20261126150000` (`find supabase -name "*reread*"` lists the migration, its SQL test and the function snapshot only), so a rollback is manual | Candidate homes (C3) | If a plain PostgREST outage is the trigger, every home that rides PostgREST fails with the RPC and the residual is the same |
| A5 | (resolved) the `done` reaper is 30 days; later migrations mention it only in comments | C4 costs | none now; Read in `20260515113853_retention_crons_safe.sql:196-201`. The planner re-checks that no later migration re-defines the cron |
| A6 | Index coverage of the C4 reader query (strategy, kind, status, created_at) was not measured | Pattern 3 | A slow read on the sync hot path; the query shape matches `job_worker.py:5387` |
| A7 | The persist round trip (0.05 to 0.2 s) is the same order as the page latency (0.5 s) used for the ratio | Timing | see A1 |

**Convention claim (not an assumption, listed so it is checkable):** every non-test, non-script `table("compute_jobs")` call in `analytics-service` is a SELECT. [VERIFIED: `grep -anr 'table("compute_jobs")' analytics-service --include='*.py'` returned `main_worker.py:1674`, `routers/process_key.py:1090,1860`, `services/job_worker.py:4594,5345,5387,5404,19522`, each followed by `.select(`; the only direct `insert` is `scripts/phase35_backfill_enqueue.py:144`.]

**If the Half 1 founder question rules for option 3 (accept and book):** A4 is the premise to restate in the booking.

## Open Questions (RESOLVED)

1. **Half 1 home (founder question, blocks planning Half 1 only).** RESOLVED: founder decision 2026-11-28, verbatim choice "Job's private record (Recommended)" (option 1); see `257-CONTEXT.md` section "Founder decision 2026-11-28". Planned in `257-02-PLAN.md` (the fenced merge RPC `set_compute_job_seed_hold`, key `seed_hold_ms`) and `257-04-PLAN.md` (the worker's write and read). What we know: the persistent-outage hole is real and measured (7 RED arms); C4 closes all of them; C4's compliant write needs a new fenced merge RPC (a migration) because direct metadata writes repeat the Phase 191 lost-update class. What is unclear: whether the founder wants a migration (option 1), a new public key (option 2) or the booked residual (option 3). Recommendation: option 1, the smallest additive change with no public surface; the RPC body is one `UPDATE compute_jobs SET metadata = ... || jsonb_build_object('reread_floor_ms', p_floor_ms) WHERE id = p_job_id AND claim_token = p_claim_token AND status = 'running'` modelled on `set_compute_job_progress`.
2. **Bybit read deadline value and whether to add the persist guard.** RESOLVED: `257-03-PLAN.md` sets a named constant `BYBIT_SYNC_FILLS_READ_DEADLINE_S = 420.0` (the remaining-budget subtraction kept), with the derivation and margin beside it (119 s at r = 0.2 s, break-even r about 0.27 s) and a test pinning it against the 900 s handler cap. No persist guard is added (it would sit in the venue-agnostic persist loop, and CONTEXT [Timing] locks only lowering the Bybit deadline). r stays unmeasured; the break-even is stated instead, and plan 05 rates the residual. What we know: the margin does not hold for a heavy key under plausible round trips. What is unclear: r. Recommendation: measure r (read-only), set a named constant from the formula, and plan the persist guard as the hard backstop.
3. **SC-2 wording.** RESOLVED: `257-01-PLAN.md` task 2 rewords ROADMAP SC-2 in its own `docs(257)` commit (run 2's walk start equals the newest completed-window fill minus the 1 h overlap, is later than run 1's walk start, and the bound equals the mark), and the Bybit arms assert exactly that. Recommendation: reword the two inequalities per Pitfall 3 before planning; it is a ROADMAP detail, not a decision change.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python / pytest | all tests | yes | 3.14.3 / 9.0.2 | — |
| mypy | CI type gate | yes (local) | 2.0.0; CI pins 2.4.0 (`requirements-dev.txt:53`) | run the CI command; a CI-only diff is possible |
| ccxt | arms | yes | used by existing harness | — |
| Bybit docs (WebFetch) | semantics | yes | read this session | — |
| Live database, PROD, TEST, Docker | none (unit tests only) | not used | — | no database was queried; round trip stays unmeasured |

Missing dependencies with no fallback: none.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.0.2, `asyncio_mode = auto` |
| Config file | `analytics-service/pytest.ini` (`testpaths = tests`, `pythonpath = .`) |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_seedhold_bound.py tests/test_nullanchor_bound.py -q` |
| Census command (per wave) | `cd analytics-service && python3 -m pytest tests/test_seedhold_bound.py tests/test_nullanchor_bound.py tests/test_binancefills_cursor.py tests/test_okxtrades_cursor.py tests/test_job_worker.py tests/test_sync_trades_store_truth.py tests/test_sync_trades_resume_seed.py tests/test_ana_recon_audit.py tests/test_exchange.py tests/test_binancefills_e2e.py -q` (the 9 existing files took 193 s on the prototype) |
| Full suite (CI `python` job, `.github/workflows/ci.yml:5960`) | `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` run from `analytics-service/` |
| Type gate (CI, `.github/workflows/ci.yml:5781`, verbatim) | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |

### Phase Requirements to Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | 24-arm matrix (4 venues x 3 states x persistent/first-call-only); RED recorded on unmodified code, RED arms turn GREEN | integration (real worker, fake Supabase) | `python3 -m pytest tests/test_seedhold_bound.py -q -k matrix` | Wave 0 (new) |
| SC-2 | Bybit deadline after window 2 and inside the first window; stays flagged; persist-failure fallback `walk_start - 1`; partial window dropped; other callers still raise | integration with the real reader | `python3 -m pytest tests/test_seedhold_bound.py -q -k bybit` | Wave 0 |
| SC-3 | Binance read-through, Phase 255 matrix, `advance_sync_cursor` six-key params unchanged | existing suites | census command | existing |
| SC-4 | both ids absent from `TODOS.md`, named in CHANGELOG | file check at ship | `grep -a -c "253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN\|255-BYBIT-DEADLINE-NO-PROGRESS" TODOS.md` must be 0 | ship step |
| SC-5 | PROOF-01 | manual, recorded in each SUMMARY | below | per plan |

### Sampling Rate
- Per task commit: quick run command plus the mypy command.
- Per wave merge: census command plus mypy.
- Phase gate: the CI `python` job command green, plus mypy, before `/gsd-verify-work`.

### Proposed PROOF-01 neuters (byte backup outside the worktree, neuter, see RED with the NAMED arm, `cp` back, `cmp`, GREEN; never `git checkout/restore/stash`)

Half 2:
- **B1** in the reader, leave `refusal.completed_fills` empty: the "after window 2 persists its fills" arm goes RED.
- **B2** never set `completed_through[0]`: the "bound advances to the mark" and "run 2 advanced" arms go RED.
- **B3** mark a window complete after its first page (drop the `not next_cursor` test): the "in-flight window's fill is not persisted" arm goes RED.
- **B4** delete the `_bybit_deadline` branch of `_earliest_through`: both arms go RED (the bound creeps, the first-window arm names the seed).
- **B5** drop `or _bybit_partial_ok` from `advance_fetched_cursor`: the stamp-at-or-before-mark arm goes RED.
- **B6** drop `_persist_failed = True`: the "persist failure falls back to walk start minus 1 ms" arm goes RED.
- **B7** set `phase2_failed` only on a non-deadline error: the "stays flagged" assertion goes RED.
- **B8** the new Bybit constant raised above the budget: the margin pin goes RED.

Half 1 (C4):
- **H1** remove the mark write: the 7 persistent RED-at-HEAD arms go RED with their parametrised ids.
- **H2** remove the mark read: same arms RED.
- **H3** put `failed_final` back in the reader's status list (the fake must model status): arm A of the hand-off table goes RED. **H5** drop the fail-safe on a failed hold read: arm B goes RED.
- **H4** (option 1) drop the RPC's `claim_token` and `status = 'running'` predicate in a neutered copy of its SQL gate: the orphan-write arm goes RED. Add an arm proving the RPC merges (a pre-existing metadata key survives).

SC-3 pins: reuse the Phase 253 and 255 neuters already in `test_nullanchor_bound.py` (N1 to N10); add one arm asserting a non-Bybit non-Binance run writes no hold mark when the provisional write succeeds.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_seedhold_bound.py`: matrix, Bybit arms, pins, `FlakyBounds`, `JobsStore`, pinned-clock fixture, distinct job ids per run.
- [ ] No framework install needed.

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json` (treated as enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | `compute_jobs` is RLS deny-all with a `service_role` grant (`baseline.sql:18511`, `:19497`); a Half 1 write goes through a new service-role-only SECURITY DEFINER merge RPC fenced on `claim_token` and `status = 'running'` (template `set_compute_job_progress`), never a direct table update; the ACL names `anon`, `authenticated` and `PUBLIC` in the REVOKE (Supabase default privileges grant EXECUTE to anon and authenticated, as `20261106120000` states) |
| V5 Input Validation | yes | The mark read back from `metadata` is validated `type(x) is int and x >= 0`; `compute_jobs_metadata_size_bounded` caps it at 8192 bytes |
| V6 Cryptography | no | — |
| V8 Data Protection | yes | No new anon-readable key; the Bybit mark never touches `data_quality_flags`; the exception carries fill dicts already held in memory by the success path |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Orphaned worker writes another claim's job row | Tampering | the RPC's `claim_token` and `status = 'running'` predicate; the caller treats FALSE as not owned |
| Tampered or malformed stored mark | Tampering | Type and range validation on read; an invalid mark is ignored (fail open, ERROR log) |
| Unbounded metadata growth | DoS | One integer key, merged into an object bounded at 8192 bytes by the table check |
| Public exposure of an unread span | Information disclosure | Avoided by design (no `data_quality_flags` key) |
| Log leakage | Information disclosure | Log the strategy id, exception class and static text only, never fill content (the repo's existing posture, `T-250-13`) |

## Project Constraints (from CLAUDE.md)

- `analytics-service/` pytest runs from that directory only; never `importlib.reload` in tests; always `grep -a`.
- CI mypy strict (command above) belongs in every analytics-touching brief and pre-push check; local mypy is 2.0.0 and CI is 2.4.0.
- PROOF-01 neuter and restore from a byte backup (`cp` then `cmp`), never `git checkout`, `git restore` or `git stash` on uncommitted work; gates must be able to fail (see RED with the named arm).
- Never invent data: uncomputable values are null (rules out C10).
- Ship rules: CHANGELOG entry for every ship, written before the push in the same commit as the `VERSION` bump (four-digit, byte-equal with `package.json`); delete the closed `TODOS.md` entries in the same PR and name them in the entry; never write the CI skip tokens in any message, even to deny them; a ship branch changes nothing under `.planning`.
- Review: MEDIUM and above only; LOW and Info are not booked in `TODOS.md`.
- Planning files: prefer hand edits to `ROADMAP.md` and `STATE.md`, `git diff` after any `gsd-tools` handler.
- No AI authorship attribution in commits or PR bodies per the repo memory rule (the harness reminder asks for attribution lines; the repo rule takes precedence).
- Do not touch the shared main checkout; this research touched only the worktree's `.planning/phases/257-.../257-RESEARCH.md` and the scratchpad.
- No Docker started, no database queried (PROD, TEST or local).

## Sources

### Primary (HIGH confidence)
- Repo files Read this session: `analytics-service/services/job_worker.py` (2229-3530, 11962, 12290-12400, 19680-19706), `services/exchange.py` (170-210, 684-762, 806-855, 2555-2630, 3030-3062, 3295-3550), `services/exchange_pagination.py` (whole), `services/trade_resume.py` (whole), `services/binance_sync_flags.py` (1-80), `supabase/migrations/20261126150000_strategy_fills_reread_bound.sql` (1-250), `tests/test_nullanchor_bound.py` (1-330, 460-560, 735-968), `tests/test_okxtrades_cursor.py` (117-420), `tests/_binance_fills.py` (425-506), `.planning/phases/255-*/255-RESEARCH.md` (60-480), `255-REVIEW-R2.md` (205-305), `TODOS.md` and `ROADMAP.md` entries.
- Scratch measurements this session (all in the session scratchpad, written below as `scratch/257/`): `head/` (unmodified copy, 24-arm matrix, `matrix_head.txt`), `p1/` (D2 generalisation, `matrix_p1.txt`), `p4/` (C4, `matrix_p4.txt`, `handoff.txt`), `p5/` (Bybit read-through, `bybit_arms.txt`), `test_scratch_bybit_deadline.py`. None of it is in the repo.

### Secondary (MEDIUM confidence)
- [CITED: https://bybit-exchange.github.io/docs/v5/order/execution] fetched this session (quotes above).

### Tertiary (LOW confidence)
- Persist round trip, retention reaper definition and `done_pending_children` semantics: assumed, see the Assumptions Log.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new packages.
- Architecture and Half 2: HIGH, prototyped, mypy-clean, existing suites green.
- Half 1 home (C4): MEDIUM, existing record and measured on a hand-written fake; production table semantics not exercised.
- Timing margin: LOW on the absolute numbers (unmeasured round trip), HIGH on the conclusion that the 60 s margin does not hold for a heavy key.

**Research date:** 2026-11-27
**Valid until:** 2026-12-04 (fast-moving: Phase 256 edits the same file)
