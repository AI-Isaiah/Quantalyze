# Phase 250: BINANCEFILLS - Research

**Researched:** 2026-11-25
**Domain:** Binance fills read (`GET /fapi/v1/userTrades` and siblings) through ccxt 4.5.89, plus the fills-cursor gate of `run_sync_trades_job`
**Confidence:** HIGH for the code and ccxt facts (read in the venv, reproduced with a real ccxt instance and a venue fake); MEDIUM for venue behaviour (the docs are silent on three points, listed as UNMEASURED)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

Classification note: every choice below is a code change inside the Binance branch of the fills read and the cursor gate of one handler. There is no migration, no schema change, no public API or URL contract and no new dependency, and the sync path is dormant in PROD (`USE_RAW_TRADE_INGESTION` off). So each is technical and reversible by a code revert. The live reconcile caller is the one reach into PROD, and it only reads and diffs. No question met the hard-to-reverse or preference class, so none was put to the founder.

#### Decided autonomously
- [Window walk, R2-02] Q: "Shape of the fix?" → Selected: "Per symbol, walk UTC-aligned or since-aligned windows of at most 7 days from the seed to now (the clock is `_now_ms`), passing an explicit `until`/`endTime` on EVERY request so the window never depends on ccxt's implicit linear-only cap; page oldest-first inside each window with `limit=1000`, keeping the existing same-ms +1 rule; an empty window advances to the next window." — code inside `_fetch_raw_trades_binance`; a revert restores the single read.
- [Window walk, R2-02] Q: "Seed when `since_ms` is None (NULL cursor and a failed daily high-water read)?" → Selected: "Walk from the venue's reach (now minus the reach constant), never send a request without `startTime`; this replaces today's silent last-7-days read." — one branch in the same helper.
- [Window walk, R2-02] Q: "A seed older than the venue's 3-month reach?" → Selected: "Clamp the walk start to the reach and record a named, NON-holding flag naming the clamp (exact key is a research output, e.g. `binance_fills_reach_clamped`); never read an out-of-reach window as quiet, never hold the cursor on it (holding cannot help: the venue cannot serve it). The reach constant is set from the verbatim doc line with a safety margin, test-lowerable like the caps." — a module constant and a flag key; no stored state depends on them.
- [Window walk, R2-02] Q: "How does SC-1 read when there are NO fills at all from C to now?" → Selected: "The 232 rule is kept: the cursor is stamped only with a stored fill. On a fully empty tail the cursor stays at C, but every run walks C to now, so nothing is missed; once later fills exist the stamp moves to the newest stored one (SC-1's 'reaches fills newer than those days'). If C ages past the reach, the clamp flag above names it. A non-fill (read-through) stamp is NOT introduced: it would relax a 232 rule the roadmap says this phase keeps." — reading recorded, no code beyond the walk.
- [Unlisted symbols, R2-01] Q: "How do healthy symbols advance while a dead symbol is still named?" → Selected: "Classify each failed symbol. A `ccxt.BadSymbol` (client-side 'not in markets' or venue codes -1108/-1121/-20121) is named every run in a NEW flag (exact key a research output, e.g. `binance_unlisted_symbols`) that the cursor gate does NOT hold on. Any other exception keeps today's `binance_partial_symbols` hold, so a transiently failed symbol's span is re-read on the next run. The all-symbols-failed raise (`BinancePerSymbolFetchError`) is unchanged." — a classification inside the gather loop plus one flag key.
- [Unlisted symbols, R2-01] Q: "Is `BadSymbol` the same as 'nothing to read'?" → Selected: "No. Research measures, at ccxt 4.5.89 with real market metadata, how every stored-symbol shape resolves through `ccxt_symbol_by_normalized` (USDT-M, USDC-M, COIN-M, a spot/linear strip collision). If a symbol that has fills can resolve to the wrong market or raise `BadSymbol` because of the map, the map is fixed in this phase (it lives in `_fetch_raw_trades_binance`), so the non-holding flag is reached only by symbols the venue genuinely does not list. The flag's record says how to recover a span skipped while a symbol was unlisted (a reconcile or backfill with an explicit since)." — the map is a local dict build.
- [Page cap stop] Q: "How is a capped symbol flagged and resumed?" → Selected: "`BINANCE_PAGE_CAP` stays 20 and becomes per WINDOW (raising a cap is not a close, the 232 precedent). A symbol that hits it stops its walk at that point and is named in a new NON-holding flag (exact key a research output, e.g. `binance_page_cap_symbols`) together with the newest fill timestamp it read. The cursor gate stamps the EARLIER of the newest persisted fill and that capped symbol's newest read fill (the minimum over capped symbols), which is a stored fill and never past the capped symbol's unread fills; the next run seeds there (minus the existing 1 h overlap) and continues past the cap instead of re-reading the same oldest pages." — the resume point is the cursor itself, written by the same `advance_sync_cursor` RPC as every stamp, so it does not depend on the best-effort `data_quality_flags` stamp.
- [Page cap stop] Q: "Holds versus the cap stamp?" → Selected: "A hold still wins: a transient `binance_partial_symbols`, a `sync_truncated_*` flag, `phase1_failed`, `phase2_failed` or an incomplete persist hold the cursor exactly as today. The cap stamp applies only when nothing holds." — gate arithmetic.
- [Budget] Q: "Can the walk exceed the handler budget?" → Selected: "Research bounds windows x symbols x pages against the sync handler's 900 s timeout AND reconcile's 5-minute timeout, at the venue's weight (5 per request) and ccxt's rate limiter. If the worst case can exceed a budget, a read deadline stops the walk the SAME way the cap does (named, contiguous per-symbol prefix, resumable through the cap stamp), never a cancel that stores nothing." — a deadline is a parameter on the same helper.
- [Write scope] Q: "Which symbols may plans edit?" → Selected: "`services/exchange.py`: `_fetch_raw_trades_binance` and new module constants/helpers beside `BINANCE_PAGE_CAP`/`OVERLAP_WINDOW_MS`. `services/job_worker.py`: inside `run_sync_trades_job` ONLY the cursor gate block (`_fills_incomplete`, `advance_fetched_cursor`, the `_p_last_fetched` computation and its comments); the `_RAW_TRADE_INGESTION_ENABLED` declaration comment (SC-4). `run_reconcile_strategy_job` only if research shows a flag-drain change is needed. Never 222's enqueue arm, never Phase 1 / Phase 2 ordering (251)." — scope list.
- [SC-4 precondition] Q: "Where is the precondition recorded?" → Selected: "At the place the flag is read (`_RAW_TRADE_INGESTION_ENABLED` declaration comment, naming Phase 250 and SC-1..3) and in the CHANGELOG entry; plus a pinned test that the comment names the precondition is NOT added (a test reading prose is the wrong shape, CLAUDE.md TODOS rule)." — comment text.
- [Tests] Q: "How are the gates made able to fail?" → Selected: "The fake `fetch_my_trades` models the VENUE, not ccxt's convenience: with `since` and no `until` on a linear market it serves at most `[since, since+7d]`; with no `since` it serves only the last 7 days; it refuses a request whose `endTime - startTime` exceeds 7 days; it returns at most 1000 rows oldest-first. A fake that returns everything after `since` would go GREEN on today's code and is forbidden. Each gate (quiet stretch, unlisted symbol, capped symbol, reach clamp, cap-stamp in the gate) goes RED on pre-fix code or a neutered copy, PROOF-01 recorded verbatim." — test files only.

### Claude's Discretion
- Exact flag key names, constant names, the reach safety margin, window alignment, and test file names, within the decisions above.

### Deferred Ideas (OUT OF SCOPE)
- A read-through (non-fill) cursor stamp for a fully empty tail: would relax a Phase 232 rule; a founder decision if ever wanted.
- Per-symbol persisted cursors: a migration; not needed for SC-1..3 under the decisions above.
- Clearing a stale `binance_partial_symbols` / new flag from `data_quality_flags` once resolved: the flag-clearing class belongs to Phase 251 SYNCSTORE (its item 3).
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are mapped (ROADMAP: "**Requirements**: none mapped (routed review survivors from Phase 232: R2-01, R2-02 and the `BINANCE_PAGE_CAP` stop)"). The planner maps the four success criteria directly.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 (R2-02) | Quiet stretch > 7 days: the read keeps walking windows and reaches newer fills | Q1 (ccxt `until`), Q2 (walk constants), reproduced RED today (Code Examples, "Venue fake") |
| SC-2 (R2-01) | A symbol failing every run is named every run, healthy symbols still advance, a transient failure's span is re-read | Q1 (BadSymbol origin), Q2 (classification location) |
| SC-3 (page cap) | A capped symbol is flagged, the cursor never stamps past its unread fills, a later run resumes past the cap | Q3 (gate change), Q4 (deadline shares the shape) |
| SC-4 | `USE_RAW_TRADE_INGESTION` precondition recorded | Q8 |
| SC-5 | PROOF-01 per gate | Validation Architecture |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives from `./CLAUDE.md`, `./AGENTS.md`, the global `~/.claude/CLAUDE.md` and the user's auto-memory that bind this phase. Treat them with the authority of locked decisions.

- **Which database (CLAUDE.md):** this checkout's Supabase CLI is linked to PRODUCTION. Run the marker query (`SELECT shobj_description(oid, 'pg_database') ... `) before any statement that writes; `current_database()` proves nothing. This phase writes nothing to a database; the PROD reads here were marker-first, one query per call.
- **CHANGELOG discipline (CLAUDE.md, founder 2026-09-09):** the ship writes a CHANGELOG entry in the same commit as the VERSION bump (`VERSION` and `package.json` byte-equal 4-digit strings, never `npm version`): enumerate every commit, group by theme, cross-check each commit maps to a bullet, use the repo's section vocabulary (`### Fixed`, `### Added`, `### Changed`, `### Tests`, `### Notes`). The entry carries the SC-4 precondition and the known limits recorded here (reconcile sees a stopped read as short; quiet-prefix stall; over-20K-in-one-hour stall; UNMEASURED venue behaviours).
- **TODOS.md holds open work only (CLAUDE.md, founder 2026-11-14):** this phase closes no `TODOS.md` entry (CONTEXT measured the set empty). LOW and Info review survivors are not booked in `TODOS.md`.
- **CI gate integrity (CLAUDE.md):** never write a skip-CI trailer token in a commit message or PR body, not even to deny it; bind "green" to the head SHA and count the checks. Do not rely on `workflow_dispatch` on `main` to re-trigger a lost gate set.
- **Completion is historical (CLAUDE.md):** after any verifier run, convert `covered_files`/`covered_digest` to `verified_at_sha` + `drift_subjects`; never put `TODOS.md`, `CHANGELOG.md`, `VERSION` or `package.json` in `drift_subjects`.
- **GSD orchestration (CLAUDE.md):** never hand-dispatch a `gsd-*` agent; `git diff` after every `gsd-tools` state handler (`phase complete` drops Progress-table prose and advances STATE to the next roadmap phase).
- **Global rules:** fail loud (a skipped or silent path is not "completed"); tests encode WHY and must be able to fail (neuter, see RED, restore from a byte backup with `cp` and `cmp`, never `git checkout`/`restore`/`stash` on uncommitted work); read before write; surgical changes; write scope BY SYMBOL because 222 shares `run_sync_trades_job`.
- **User memory:** no AI authorship trailers in commits or PRs; PROD reads are authorized (marker first); no secrets, PROD ids, home paths or account numbers in tracked text; never quote a search pattern as proof of absence; `grep -a`; pytest only from `analytics-service/`; never `importlib.reload` in tests; CI mypy strict and the pytest gate belong in every executor brief; agent briefs that touch a venue read also consult the venue docs; a ship branch changes nothing under `.planning`; a new `supabase/tests` file is not part of this phase.
- **AGENTS.md ("This is NOT the Next.js you know")** concerns the Next.js frontend; this phase touches no Next.js code.
- **Banned packages (global):** none involved (no package is added).

## Summary

Four findings change what the plan should say, beyond the CONTEXT decisions:

1. **A stored linear symbol routes to the SPOT endpoint whenever `exchange.markets` is not loaded when `_fetch_raw_trades_binance` builds its reverse map.** A fresh ccxt instance has `markets = None`; the map build is guarded by `if hasattr(exchange, "markets") and exchange.markets:`, so the map is empty and the raw stored string `BTCUSDT` is passed to `fetch_my_trades`. ccxt's `market('BTCUSDT')` resolves an id with `defaultType == 'spot'` to the spot market. Measured with a real `ccxt.binance` 4.5.89 instance, a venue fake and a stored `BTCUSDT`: markets preloaded gives `linear_endpoint_calls=1 spot_endpoint_calls=0 fills=1`; markets unloaded gives `linear_endpoint_calls=0 spot_endpoint_calls=1 fills=0`. The sync handler is saved only because Phase 1's `fetch_balance()` calls `load_markets()` first (`binance.py:4046`: `if self.markets is None: await self.load_markets()`); **`run_reconcile_strategy_job` loads nothing before the read, so its nightly Binance read is shaped for spot today.** That second half is `[VERIFIED: job_worker.py:1848-1900 read in full]`: `_exchange_preflight` loads the strategy and key rows, runs `_check_circuit_breaker(supabase, job, key_row)` (a database call that takes no exchange argument), decrypts, and builds the client through `_make_exchange_client` -> `create_exchange` (`exchange.py:1065-1118`, read), which constructs `cls(config)` and touches `exchange.has` only for bybit; no step calls `load_markets()`. Inside the helper, the only path that loads markets before the map build is the cold start (`fetch_positions`, symbols table empty). PROD holds zero Binance rows (below), so nothing is hurt yet, but the first Binance key hits it. The fix lives inside `_fetch_raw_trades_binance`: `await exchange.load_markets()` when `not exchange.markets`, before the map build.
2. **With markets loaded, a stored linear symbol never resolves to a spot market.** On the live public metadata (4742 markets), all 451 strip collisions are exactly (`linear-swap`, `spot`) pairs and the as-built map (last write wins, spot iterated first) resolves every one to the linear swap. That is iteration-order luck, not a rule; make the precedence explicit.
3. **The cursor gate needs one more input than the CONTEXT names.** The CONTEXT's "minimum over capped symbols of the newest read fill" is exactly right for a page-cap stop, but a deadline stop (Q4) has no newest-read fill when the walk stopped between windows or never started a symbol. Both stops are one concept: "this symbol was read through instant B". Record the minimum B in ONE scalar flag, `binance_read_through_ms` (int epoch ms), beside the two named lists; the gate stamps the newest persisted fill `<= B`. For a cap stop B is the capped symbol's newest read fill, so this reduces to the CONTEXT rule exactly.
4. **PROD holds no Binance data at all** (marker query first, see Q4): 0 Binance `api_keys` rows, 0 Binance `trades`, 0 Binance `position_snapshots`. Per-symbol counts and fills per symbol per 7 days are UNMEASURED because they do not exist; the budget below is a bound, not a measurement.

**Primary recommendation:** rewrite `_fetch_raw_trades_binance`'s per-symbol fetch as a per-symbol 7-day-window walk (explicit `until` on every request, reach clamp, per-window page cap, one read deadline), classify `ccxt.BadSymbol` into a non-holding `binance_unlisted_symbols` flag, load markets before the map build with explicit linear-over-spot precedence, emit one `binance_read_through_ms` scalar for cap and deadline stops, and teach the cursor gate to stamp the newest persisted fill at or before it. Test it with a real ccxt instance whose HTTP-method layer is replaced by a venue fake (the Phase 231 `_bybit_real_markets.py` / Phase 232 `_okx_bills.py` precedent), never with a mock `fetch_my_trades`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Window walk, reach clamp, per-window page cap, read deadline | API / Backend (`services/exchange.py::_fetch_raw_trades_binance`) | — | It is the venue read; the OKX walk (`fetch_daily_pnl`) and Bybit walks live in the same module |
| Symbol -> ccxt market resolution, BadSymbol classification | API / Backend (same helper) | — | The reverse map is a local dict build inside the helper |
| Flag production (`_record_dq_flag`) | API / Backend (`services/exchange.py`) | — | Per-task ContextVar buffer; drained by the caller |
| Fills-cursor stamp / hold / bootstrap anchor | API / Backend (`services/job_worker.py::run_sync_trades_job` epilogue) | Database (`advance_sync_cursor` RPC, monotone) | The gate decides the value, the SECDEF RPC only writes it forward |
| Flag persistence | Database (`strategy_analytics.data_quality_flags`, best-effort upsert) | — | Not an input to the next run; the cursor is |
| Reconcile diff | API / Backend (`run_reconcile_strategy_job`) | — | Second caller of `fetch_raw_trades`; read-only; discards the DQ flags |

No browser, SSR, CDN or frontend capability is touched. The frontend files that read `strategy_analytics.data_quality_flags` (factsheet pages, the finalize-wizard route) read specific keys; no consumer of any Binance flag was found in this session, which is not an exhaustive proof, so the plan should treat the new keys as backend-only and not assume a UI surface for them.

## Standard Stack

No new package, no new dependency, no migration. The existing pins are used.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ccxt | 4.5.89 `[VERIFIED: analytics-service/requirements.txt:33 "ccxt==4.5.89"; .venv `ccxt.__version__` printed 4.5.89]` | Binance REST via `fetch_my_trades` | Already pinned; rate limiter, signing, parsing, exception map |
| pytest + pytest-asyncio | repo pins; `asyncio_mode = auto` `[VERIFIED: analytics-service/pytest.ini:4]` | Tests | Existing suite |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `services/exchange.py::_record_dq_flag`, `_now_ms`, `_monotonic` | in repo | flag buffer, pinned clock, pinned monotonic | The walk's flags, clock and deadline |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Per-symbol window loop (locked) | Window-major loop (OKX shape: windows outer, symbols inner) | The FIFO semaphore already interleaves per-symbol tasks to a common frontier at a deadline (prototyped, Q4), so window-major buys no better prefix; the CONTEXT locked per-symbol. See Open Question 1 |
| `startTime`/`endTime` windows | `fromId` paging | Docs: "The parameter `fromId` cannot be sent with `startTime` or `endTime`", so `fromId` cannot be bounded by a window; deferred as the only route past a single window of more than 20,000 fills |

**Installation:** none.

## Package Legitimacy Audit

No external package is installed or changed by this phase. Audit not applicable.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 run_sync_trades_job (dormant, flag off)          run_reconcile_strategy_job (LIVE nightly 03:30Z, 300 s)
   seed = min(cursor, newest stored fill)            since = now - 24h
   fetch_raw_trades(since_ms=seed)                   fetch_raw_trades(since_ms=since)
              \                                          /
               v                                        v
            fetch_raw_trades: reset DQ buffer; effective_since = since_ms - OVERLAP_WINDOW_MS (1 h)
                                     |
                                     v
            _fetch_raw_trades_binance(exchange, strategy_id, supabase, effective_since)
               1. discover symbols (trades + position_snapshots; cold start: fetch_positions)
               2. ensure markets loaded  (NEW: await exchange.load_markets() if not exchange.markets)
               3. reverse map {strip(unified) -> unified}, linear/inverse/delivery over spot (NEW: explicit)
               4. read_now = _now_ms() once; start = max(effective_since, read_now - REACH) or read_now - REACH
                  (clamp -> binance_fills_reach_clamped, non-holding)
               5. per symbol, Semaphore(5), ccxt throttler (~229 ms per weight-5 request, shared):
                    for window [s, min(s+W-1ms, read_now)], W = 7 d (linear, inverse) or 24 h (spot); next s = previous end:
                      page: fetch_my_trades(sym, since=cur, limit=1000, params={"until": window_end})
                      full page -> since = last ts (same-ms: +1) ; short/empty page -> next window
                      20 full pages in one window -> STOP symbol (cap)   -> read_through = newest read ts
                      deadline passed before a request -> STOP symbol    -> read_through = last read ts / window start - 1
                      ccxt.BadSymbol -> unlisted (non-holding)   other exception -> partial (holding)
               6. classify results; record flags; all symbols failed/unlisted -> BinancePerSymbolFetchError
                                     |
                       fills + flags (drained by get_and_clear_last_dq_flags)
              /                                                              \
   sync: persist fills; gate:                                       reconcile: flags DISCARDED, diff vs DB
     holds win (partial, sync_truncated_*, phase failed) -> NULL                (a stopped read looks short)
     else stamp = newest persisted fill <= binance_read_through_ms (if present)
          else newest persisted fill; none -> anchor (NULL column) or nothing
     advance_sync_cursor RPC: writes only if column NULL or strictly older (monotone)
```

### Recommended Project Structure
```
analytics-service/
├── services/exchange.py      # constants block (~line 150-216); _fetch_raw_trades_binance (2483-2723)
├── services/job_worker.py    # _RAW_TRADE_INGESTION_ENABLED comment (327-333); gate block (2688-2752)
└── tests/
    ├── _binance_fills.py             # NEW helper: real ccxt.binance + venue fake (not collected)
    ├── test_binancefills_walk.py     # NEW: exchange-level gates (SC-1, SC-2, SC-3 producer, reach, deadline, markets)
    ├── test_binancefills_cursor.py   # NEW: gate arms through the REAL run_sync_trades_job (SC-3 consumer)
    └── test_exchange.py / test_ana_recon_audit.py   # EDIT: migrate the 14 affected tests (census below)
```

### Pattern 1: Per-symbol window walk with an explicit `until`, window length by market kind
**What:** `start`, `end = min(start + window - 1 ms, read_now)`, next `start = end` (1 ms overlap so an exclusive venue `endTime` cannot lose a boundary fill; the unique index absorbs the duplicate). Every request carries `params={"until": end}`. **`window` is 7 days for a linear or inverse market and 24 hours for a spot market**, chosen from the resolved ccxt market (`exchange.markets[ccxt_symbol]["spot"]`; a missing entry, as with the test doubles' empty `markets`, takes the 7-day window). The spot page says "The time between `startTime` and `endTime` can't be longer than 24 hours.", so one 7-day rule for all three would refuse every spot-resolved name on every run into the HOLDING `binance_partial_symbols` (R2-01 again), where today's start-only spot request succeeds.
**When to use:** every Binance fills request. A stored name can resolve to spot when no derivative shares its stripped name (`BTCUSDC`, `ETHBTC`; Q1 table). Excluding spot from the reverse map was considered and rejected: it removes a read that works today, whereas a 24-hour window keeps it.
**Example:**
```python
# Source: ccxt 4.5.89 async_support/binance.py:8663-8679 (read in the venv); mirrors services/exchange.py OKX walk, 1780-1846
#   endTime = self.safe_integer_2(paramsPaginate, 'until', 'endTime')
#   ...
#   if (currentTimestamp - startTime) >= oneWeek:
#       if (endTime is None) and (self.safe_bool(market, 'linear', False)):
#           endTime = self.sum(startTime, oneWeek)
#           ...
#           endTime = min(endTimeValue, currentTimestamp)
#   if endTime is not None:
#       request['endTime'] = endTime
batch = await exchange.fetch_my_trades(
    ccxt_symbol, since=current_since, limit=BINANCE_FILLS_PAGE_LIMIT, params={"until": window_end}
)
```

### Pattern 2: One "read-through" bound for every resumable stop
**What:** a cap stop and a deadline stop both mean "this symbol is complete through instant B and unread after". The producer records the lists (`binance_page_cap_symbols`, `binance_deadline_symbols`) and ONE scalar `binance_read_through_ms` = min of B over stopped symbols. The gate stamps `max(ts of persisted fills with ts <= B)`.
**Why a scalar and not a per-symbol dict:** `_record_dq_flag` overwrites a non-list, non-bool, non-number value and caps lists at `_DQ_LIST_MERGE_CAP = 64`; one int written once at the end of the helper is the simplest thing the buffer already carries, and the gate needs only the minimum.
**Example (gate, skeleton):**
```python
# Source: services/job_worker.py gate block 2714-2752 (read this session); additions marked NEW
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)
_rt = exchange_dq_flags.get("binance_read_through_ms")                          # NEW
_fills_stopped = isinstance(_rt, int) and not isinstance(_rt, bool)             # NEW
# _fills_incomplete and advance_fetched_cursor stay exactly as they are (holds win)
if advance_fetched_cursor:
    try:
        _stamps = [coerce_to_aware_utc(f["timestamp"], "sync_trades") for f in raw_fills]
        if _fills_stopped:                                                      # NEW
            _bound = _EPOCH + timedelta(milliseconds=_rt)                       # exact; never ms/1000 floats
            _stamps = [t for t in _stamps if t <= _bound]
        _p_last_fetched = max(_stamps).isoformat() if _stamps else None
    except (KeyError, ValueError, TypeError, OverflowError, OSError) as exc:
        ...  # unchanged hold
elif (phase2_failed or _fills_incomplete) and fills_anchor_iso is not None:
    _p_last_fetched = fills_anchor_iso                                           # unchanged
# NEW: a stop with nothing to stamp on a NULL column anchors at the read start, exactly as a hold does
if _p_last_fetched is None and _fills_stopped and not phase2_failed and not _fills_incomplete \
        and fills_anchor_iso is not None:
    _p_last_fetched = fills_anchor_iso
```

### Anti-Patterns to Avoid
- **A `sync_truncated_*` or `binance_partial_symbols` name for the new keys.** The gate holds on `key.startswith("sync_truncated_") or key == "binance_partial_symbols"`. A new key with that prefix would hold silently.
- **A fake `fetch_my_trades` mock.** It skips ccxt's `market()`, `until` handling, implicit linear cap and `parse_trades` filters, which are exactly where today's three defects and the spot-routing defect live.
- **Stamping `read_now`, a window end, or `read_through` itself.** The 232 rule is "stamp a stored fill or nothing"; `read_through` bounds which stored fill may be stamped.
- **`ms / 1000` float conversion for the bound.** Use `timedelta(milliseconds=ms)` from the epoch (exact).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Request signing, throttle, exception mapping | A custom Binance client | `ccxt.binance.fetch_my_trades` | It maps `-1108/-1121/-20121` to `BadSymbol`, throttles at weight cost, sorts and filters rows |
| Duplicate fills from the window overlap and the 1 h overlap | A seen-id set in the walk | The `(strategy_id, exchange, exchange_fill_id)` unique index | The existing contract (NEW-C13-03 comment in the helper) |
| Per-task flag buffer | A new return channel | `_record_dq_flag` / `get_and_clear_last_dq_flags` | Callers already drain it; reconcile drains-and-discards |
| A monotonic deadline clock | `time.monotonic()` inline | `services.exchange._monotonic` (line 207) | Tests pass the deadline without sleeping |
| A wall clock | `time.time()` / `datetime.now()` | `services.exchange._now_ms` (line 216) | One pinned instant per read, no fixture straddles a window edge |
| Market metadata for tests | Hand-written market dicts in each test | A recorded subset, as `tests/_bybit_real_markets.py` does | Round-trips the real `strip` and the real `market()` |

**Key insight:** the three survivors all come from trusting a convenience layer (ccxt's implicit cap, a mock that returns everything, an iteration-order map). The walk plus a real-ccxt/venue-fake test removes the trust.

## Common Pitfalls

### Pitfall 1: Markets not loaded -> linear symbol read from the spot endpoint
**What goes wrong:** the helper reads 0 fills (spot has none for a futures-only account) and reports success.
**Why it happens:** `exchange.markets` is `None` on a fresh instance; the map guard skips; the raw string reaches ccxt's `market()`, which picks spot for `defaultType == 'spot'`.
**How to avoid:** `if not exchange.markets: await exchange.load_markets()` before the map; if markets are still empty afterwards, keep today's passthrough (test doubles use `markets = {}`).
**Warning signs:** reconcile reports `db_only` discrepancies for a quiet Binance strategy.

### Pitfall 2: `test_c13_03_binance_cursor_advances_without_plus_one` reads the helper's SOURCE
**What goes wrong:** `inspect.getsource(exchange._fetch_raw_trades_binance)` must contain `cursor_stuck` or `next_since == current_since` and must not contain `int(last_ts) + 1` (`tests/test_ana_recon_audit.py:648-662`). Moving the pagination into a module-level helper turns it RED.
**How to avoid:** keep the pagination (and the literal `next_since == current_since`) inside `_fetch_raw_trades_binance`'s nested function, or replace that test in the same plan with a behavioural pin (a venue-fake case with at least 1000 rows on one millisecond).

### Pitfall 3: All symbols unlisted returns an empty read silently
**What goes wrong:** the all-failed raise is `len(failed_symbols) == len(symbols)`. Once `BadSymbol` leaves `failed_symbols`, an all-unlisted strategy returns `[]` with no raise.
**How to avoid:** count unlisted plus failed in that comparison so "every symbol failed" keeps its meaning ("unchanged" in the CONTEXT).

### Pitfall 4: A capped window of more than 20,000 fills inside the 1 h overlap never leaves
**What happens:** after a cap stop at X the cursor is X; the next run seeds X minus 1 h and the first pages re-read the fills in that hour. If those alone exceed 20,000 (about 5.6 fills per second sustained for a symbol) the walk re-caps at the same X, the RPC's monotone guard (`last_fetched_trade_timestamp < p_last_fetched_ts`) makes the stamp a no-op, and `binance_page_cap_symbols` names the symbol every run. It is loud and permanent, never silent. A way past a single window of this density needs `fromId` paging (cannot combine with `startTime`/`endTime`), which is out of scope. Name it in a WARNING log when the newest read fill is at or before the run's pre-overlap seed.

### Pitfall 5: A NULL cursor plus a stop with nothing to stamp
**What goes wrong:** the NULL-column seed is the daily high-water, which Phase 1 moves forward; a stop that stamps nothing and does not anchor lets a later run seed past the unread span (the 232 CR-01 class).
**How to avoid:** the anchor branch in Pattern 2 (stop + no stamp + `fills_anchor_iso` set -> anchor). It must also fire when `raw_fills` is empty (a deadline stop that read nothing).

### Pitfall 6: Transient failure of one symbol hides behind a stop
**What goes wrong:** one symbol stops resumably (bound B1) and another fails transiently. Both flags exist; the hold must win.
**How to avoid:** the new branch is guarded by `not _fills_incomplete`; test the pair.

### Pitfall 7: `_record_dq_flag` SUMS two ints, so write the bound once
`_record_dq_flag` merges an existing int with a new int by addition (`current[key] = existing + value`, exchange.py lines 313-316). Recording `binance_read_through_ms` once per stopped symbol would give a far-future sum, the gate's `<= bound` filter would pass every fill, and the stamp would run past unread fills. **Compute the minimum over stopped symbols after the gather and call `_record_dq_flag("binance_read_through_ms", min_ms)` exactly once** (lists dedup, bools OR, strings overwrite; only the int needs this care). Test it with two stopped symbols and assert the flag equals the smaller bound.

### Pitfall 8: Per-key cursor, per-strategy symbols
`api_keys.last_fetched_trade_timestamp` is per KEY (migration comment: "that column is per-KEY"), while the symbol set is per strategy. This is a pre-existing premise of the whole gate; the phase neither fixes nor worsens it. Do not widen scope to it.

## Research Findings by Question

### Q1. ccxt 4.5.89 `fetch_my_trades` with `until`, and symbol resolution

**Docs pages read (founder rule).** (a) `https://developers.binance.com/docs/derivatives/usds-margined-futures/trade/rest-api/Account-Trade-List`, twice, through `WebFetch`. **This is a summarising fetch, not a verbatim page read:** `curl` returns a 302 to `/en/docs/catalog/core-trading-derivatives-trading-usd-s-m-futures/api/rest-api/trade#account-trade-list`, which then answers `202` with a zero-byte body, so the raw page was not obtainable in this environment. The fetcher quoted these lines, each under its 125-character limit, so they are verbatim as the fetcher reports them: `GET /fapi/v1/userTrades`; weight 5; "If `startTime` and `endTime` are both not sent, then the last 7 days' data will be returned."; "The time between `startTime` and `endTime` cannot be longer than 7 days."; "The parameter `fromId` cannot be sent with `startTime` or `endTime`."; "Only support querying trade in the past 3 months"; `fromId`: "Trade id to fetch from. Default gets most recent trades."; `limit`: "Default: 500" with maximum 1000 (the CONTEXT's reading; the second fetch showed no description cell). `[CITED: developers.binance.com Account-Trade-List]` (b) `https://developers.binance.com/docs/derivatives/coin-margined-futures/trade/rest-api/Account-Trade-List` through `WebFetch`: `GET /dapi/v1/userTrades`; weight "20 with symbol，40 with pair (after CM migration: 5 flat)"; the same four lines (7-day default, 7-day window, `fromId` exclusivity, "Only support querying trade in the past 3 months"); "Pair and fromId cannot be sent together". `[CITED: developers.binance.com COIN-M Account-Trade-List]` (c) Spot: `https://raw.githubusercontent.com/binance/binance-spot-api-docs/master/rest-api.md`, read line by line (lines 4739-4800), which IS verbatim: `GET /api/v3/myTrades`; weight "Without orderId|20"; "The time between `startTime` and `endTime` can't be longer than 24 hours."; "If `fromId` is set, it will get trades >= that `fromId`. Otherwise most recent trades are returned."; supported combinations include `symbol` + `startTime`; `limit` "Default: 500; Maximum: 1000." `[CITED: github.com/binance/binance-spot-api-docs rest-api.md]` (d) the public `exchangeInfo` of `fapi`, `dapi` and spot, for the IP weight limits, measured: `REQUEST_WEIGHT` 2400 per minute on `fapi` and `dapi`, 6000 per minute on spot. `[VERIFIED: live public GET, 2026-11-25]`

**UNMEASURED (the docs do not state these; no signed call was possible in this environment):**
- result order of `userTrades` (all three pages are silent; the fetcher found no ascending or descending sentence);
- what the venue does with a `startTime` older than three months (error, empty list, or silent clamp);
- whether `endTime` is inclusive;
- what a `startTime`-only request returns on COIN-M and on spot (the `dapi` and spot pages give a 7-day / 24-hour window rule but no default for a lone `startTime`);
- the exact reach rule ("past 3 months": calendar or a fixed number of days).

**What ccxt sends (read in `.venv/.../ccxt/async_support/binance.py:8619-8885`).** `[VERIFIED: file read]`
- `until` (or `endTime`) in `params` becomes `request['endTime']` for every market type (spot, linear, inverse); `startTime` is `since`.
- Without `until`, ccxt adds `endTime = min(since + 7d, now)` only when `now - since >= 7d` AND the market is linear (`safe_bool(market, 'linear', False)`). Inverse and spot get no `endTime`.
- Routes: `type == 'spot'` -> `privateGetMyTrades`; `market['linear']` -> `fapiPrivateGetUserTrades`; `market['inverse']` -> `dapiPrivateGetUserTrades`. `limit` is clamped to 1000 only for contract markets.
- `parse_trades(..., since, limit)` sorts by `(timestamp, id)` ascending, drops rows whose `symbol` differs from the market symbol (`filter_by_symbol_since_limit`, base/exchange.py:5752-5765), drops `timestamp < since`, then keeps the FIRST `limit` rows. So ccxt hands the helper oldest-first rows whatever order the venue used; if the venue returned the newest 1000 of a window the helper would still advance `since` past the middle. That is the order UNMEASURED risk and it is not new (the existing H-0662 loop relies on it).

**Reproduction with a real ccxt instance plus a venue fake (scratch, not committed).** Markets `BTC/USDT` (spot) and `BTC/USDT:USDT` (linear swap) set through `set_markets`, `ex.milliseconds` pinned, `fapiPrivateGetUserTrades` replaced by a venue that serves `[startTime, endTime]` with a 7-day cap and one fill 2 days old:
- today's call `fetch_my_trades("BTC/USDT:USDT", since=now-25d, limit=1000)` sent `{'symbol': 'BTCUSDT', 'startTime': 1797840000000, 'endTime': 1798444800000, 'limit': 1000}` (endTime = start + 7d exactly) and returned 0 rows, so R2-02 reproduces;
- with `params={"until": start + 7d - 1}` it sent `endTime: 1798444799999`;
- the inverse market sent `{'symbol': 'BTCUSD_PERP', 'startTime': 1797840000000, 'limit': 1000}`: no `endTime`.

**How the stored symbol is formed and resolved.** `_normalize_fill` stores `normalize_symbol("binance", trade["symbol"])`, i.e. `raw.replace("/", "").replace(":USDT", "").replace(":USD", "")` on the ccxt UNIFIED symbol `[VERIFIED: services/exchange.py:860-908, read]`. The reverse map in the helper applies the identical expression to every key of `exchange.markets` (lines 2574-2582, read), so the round trip is exact except for collisions. Measured on the live public metadata (`load_markets()` with no keys, ccxt 4.5.89, 4742 markets: 3756 spot, 951 linear swap, 5 linear future, 20 inverse swap, 10 inverse future): `[VERIFIED: live public load_markets, 2026-11-25]`

| Stored form | Source market | Resolves to | Endpoint |
|---|---|---|---|
| `BTCUSDT` | `BTC/USDT:USDT` linear swap AND `BTC/USDT` spot | `BTC/USDT:USDT` | fapi (map as built, last write wins) |
| `BTCUSDCC` | `BTC/USDC:USDC` (`:USD` strips the head of `:USDC`) | `BTC/USDC:USDC` | fapi |
| `BTCUSDC` | `BTC/USDC` spot only (the USDC-M perp is `BTCUSDCC`) | `BTC/USDC` | spot, 24 h windows |
| `BTCUSD:BTC` | `BTC/USD:BTC` inverse swap | `BTC/USD:BTC` | dapi |
| `BTCUSDT-261225` | `BTC/USDT:USDT-261225` linear future | itself | fapi |
| `ETHBTC` | spot only | `ETH/BTC` | spot, 24 h windows |

- 4291 distinct stripped names; 451 collisions, every one the pair (`linear-swap`, `spot`); resolved kinds of the built map: spot 3305, linear swap 951, linear future 5, inverse swap 20, inverse future 10; **0 collisions resolve to anything but the linear swap.** The dependency is `fetchMarkets` order `['spot', 'linear', 'inverse']` (binance.py:1387-1393, 3410) with later keys overwriting; make it an explicit rule (skip a spot market when the stripped name already maps to a non-spot one, or build spot first and let derivatives win by test).
- A spot twin of a collided name is never read (pre-existing; spot is not a surface this repo ingests: `fetch_daily_pnl` reads futures income). UNMEASURED whether any strategy trades the spot twin; PROD has no Binance data at all.
- Raw (unmapped) `BTCUSDT` through ccxt resolves to spot (`market('BTCUSDT') -> BTC/USDT type spot`), `BTCUSDCC` and `BTCUSD:BTC` and `BTCUSDT-261225` raise `BadSymbol`. So a symbol absent from a LOADED map either hits the spot routing or `BadSymbol`; with markets loaded and the symbol unmapped, raise `ccxt.BadSymbol` locally (classified unlisted) instead of passing the raw string.
- 2514 of 4742 markets are `active: False` and stay in `exchange.markets`, so a delisted-but-still-listed symbol does NOT raise `BadSymbol` client-side; it is read normally (likely empty). `BadSymbol` arises for symbols absent from the metadata (client-side) or venue codes `-1108/-1121/-20121`, all three mapped to `BadSymbol` `[VERIFIED: ccxt `exceptions['exact']` printed]`. `BadSymbol` is a subclass of `BadRequest` -> `ExchangeError`. Only `ccxt.BadSymbol` (not `BadRequest`) goes to the non-holding flag.

### Q2. Flag keys, constants, alignment, classification location

Proposed (all plain module-level values, NOT `Final`, so a test lowers them by monkeypatch like `OKX_BILLS_PAGE_CAP`, lines 150-163):

| Name | Value | Notes |
|---|---|---|
| `BINANCE_FILLS_WINDOW_DAYS` | `7` | Linear and inverse: the doc line "cannot be longer than 7 days"; request span is `7d - 1 ms` |
| `BINANCE_SPOT_FILLS_WINDOW_HOURS` | `24` | Spot: "can't be longer than 24 hours" (spot `rest-api.md`); span `24h - 1 ms`, chosen when the resolved market is spot |
| `BINANCE_FILLS_REACH_DAYS` | `85` | Doc: "past 3 months". The shortest three calendar months are 89 days (1 Feb to 1 May, non-leap), so a rule in days of 90 or in calendar months both clear 85 with 4 days of margin. Not 93 (OKX's value is a floor for an archive; here an out-of-reach `startTime` has UNMEASURED behaviour, so the margin goes the safe way). `[ASSUMED]` margin |
| `BINANCE_PAGE_CAP` | `20`, module level, per WINDOW | Today it is a LOCAL in `_fetch_one` (line 2594); lift it so tests can lower it. Pinned by `test_binance_pagination_hits_page_cap` (expects 20 calls) |
| `BINANCE_FILLS_PAGE_LIMIT` | `1000` | Doc max 1000 for all three endpoints |
| `BINANCE_FILLS_READ_DEADLINE_S` | `240.0` | See Q4; default used by both callers, no caller edit |
| `binance_unlisted_symbols` | list[str] | non-holding; BadSymbol |
| `binance_page_cap_symbols` | list[str] | non-holding; capped |
| `binance_deadline_symbols` | list[str] | non-holding; deadline-stopped |
| `binance_read_through_ms` | int epoch ms | min over stopped symbols; the gate's bound |
| `binance_fills_reach_clamped` | bool | non-holding; seed older than the reach |
| `binance_partial_symbols` | list[str] | unchanged, holding, any non-BadSymbol failure |

**Alignment.** Since-aligned windows (no UTC-day floor): the venue's only rule is the span (7 days, or 24 hours on spot), and the OKX day alignment exists for per-day bills. Window `k`: `[s, min(s + W - 1 ms, read_now)]`; next `s` = previous end (1 ms overlap). One `read_now = _now_ms()` per read, shared by all symbols. `start = read_now - REACH` when `since_ms is None`; `max(since_ms, read_now - REACH)` otherwise, with the clamp flag when `since_ms < read_now - REACH`. A fill newer than `read_now` is read next run (cursor stamps persisted fills only).

**Where the BadSymbol classification sits.** In the result loop after `asyncio.gather(..., return_exceptions=True)` (exchange.py lines 2679-2690), not in `_fetch_one`: add `if isinstance(item, ccxt.BadSymbol): unlisted.append(symbol)` before the generic `failed_symbols.append`. Keep the `asyncio.CancelledError` scan (2671-2674) first. `services/exchange.py` imports `ccxt.async_support as ccxt` (line 2) and `ccxt.async_support.BadSymbol is ccxt.BadSymbol` is True `[VERIFIED]`. The total-failure raise at 2720 becomes `len(failed_symbols) + len(unlisted) == len(symbols)` with `first_error` set from whichever came first (Pitfall 3). The recovery text for an unlisted span (a reconcile or an explicit-since backfill) goes in the comment above the `_record_dq_flag("binance_unlisted_symbols", ...)` call and in the CHANGELOG.

**Optional named self-check (CONTEXT Specifics).** After each page, a row with a timestamp outside `[window_start, window_end]` raises a named per-symbol error (`BinanceFillsOutOfWindow`), classified as a holding failure. ccxt already drops rows before `since`, so only rows after `until` can trigger it; cheap, and it names a venue that ignores `endTime`. Planner's call (Open Question 3).

### Q3. The cursor gate and the page-cap / deadline resume

Current block (`job_worker.py:2714-2752`, read): `_fills_incomplete` is true for `sync_truncated_*` or `binance_partial_symbols` with a truthy value; `advance_fetched_cursor = bool(raw_fills) and phase2_complete and not phase2_failed and not phase1_failed and not _fills_incomplete`; the stamp is `max` over `coerce_to_aware_utc(fill["timestamp"], "sync_trades")`; the `elif (phase2_failed or _fills_incomplete) and fills_anchor_iso is not None` branch anchors a NULL column.

Change (Pattern 2 skeleton above):
1. `_fills_incomplete` is NOT edited: the new keys never hold. The three existing holds, `phase1_failed` and `phase2_failed` all still win because the new stamp logic lives only under `if advance_fetched_cursor`.
2. Under `advance_fetched_cursor`, when `binance_read_through_ms` is present, filter the fill timestamps to `<= bound` before the `max`. A cap stop has `B` = the capped symbol's newest read fill (persisted, so the filtered max equals `B`), which is the CONTEXT's "min of newest persisted and the capped symbol's newest read fill".
3. If nothing survives the filter, the stamp is `None` and the new anchor line fires only on a NULL column (`fills_anchor_iso is not None`).
4. The bootstrap anchor for holds is unchanged.

**Seed path confirmed.** `_fills_cursor_ms` parsed from the column; `_seed_bound_ms = _fill_hw_ms if _fill_hw_ms is not None else daily_since_ms`; `fills_since_ms = min(_fills_cursor_ms, _seed_bound_ms)` (lines 2247-2268, read). After a stop at `X`: column `X`; stored high-water `T >= X`; `min(X, T) = X`; `fetch_raw_trades` subtracts `OVERLAP_WINDOW_MS` to get `X - 1 h`. A failed high-water read falls to `daily_since_ms`, still `<=` the min. So the resume IS the cursor, as decided.

**RPC monotonicity** `[VERIFIED: supabase/migrations/20260602173710_advance_sync_cursor_claim_token_fence.sql:128-135]`: `WHEN p_last_fetched_ts IS NOT NULL AND (last_fetched_trade_timestamp IS NULL OR last_fetched_trade_timestamp < p_last_fetched_ts) THEN p_last_fetched_ts ELSE last_fetched_trade_timestamp`. A stamp at or before the column is a no-op; no later migration redefines the function (`grep` of `FUNCTION.*advance_sync_cursor` finds only that file).

**The cost the plan must state.** After a cap stop the healthy symbols' newer fills are re-read on each run until the capped symbol catches up (deduplicated by the unique index). Acceptable and bounded by the deadline.

### Q4. Budget

**PROD measurement (read-only, marker first).** The marker query returned the PRODUCTION comment (`which_database: ⛔ PRODUCTION — real customer data...`). Then, one query per call: Binance `api_keys` joined to strategies: `binance_keys 0, binance_strategies 0, with_cursor 0`; `trades WHERE exchange='binance'`: 0 rows, 0 strategies; `position_snapshots WHERE exchange='binance'`: 0 rows; `api_keys WHERE exchange='binance'`: 0 rows. `[VERIFIED: PROD read via supabase CLI, 2026-11-25]` Distinct symbols per Binance strategy and maximum fills per symbol per 7 days are UNMEASURED because no Binance data exists. No ids or account numbers are written here.

**Throughput.** ccxt cost per request: `fapiPrivate userTrades` 5, `dapiPrivate userTrades` 5, spot `myTrades` 4; `rateLimit = 50` ms; leaky bucket. Measured against the real throttler (no network): 12 sequential cost-5 calls took 2.75 s (229 ms per call, about 4.4 per second, about 262 per minute); cost-20 took 938 ms per call. The limiter is per instance, so `Semaphore(5)` bounds in-flight requests but not throughput. 262 per minute at weight 5 is about 1,310 weight per minute, under `fapi`'s 2400. For the spot endpoint, ccxt's cost 4 lets about 327 requests per minute through against a documented weight of 20 and a limit of 6000, i.e. 6,540 weight per minute: a spot-routed walk can exceed the spot limit. Spot is not a surface this repo ingests (Q1), but it is another reason to prefer the loaded-markets fix.

**Bound (requests = windows x symbols + extra pages).** Windows for a seed `D` days old: `ceil(min(D, 85) / 7)`, at most 13. At 229 ms per request:

| Case | Requests | Time |
|---|---|---|
| Steady state, cursor under 7 days, S = 100 symbols, no extra pages | 100 | about 23 s |
| Cold or stalled 85-day seed, S = 50 | 650 | about 149 s |
| Cold seed, S = 80 | 1,040 | about 238 s (meets the 240 s deadline) |
| Cold seed, S = 300 | 3,900 | about 893 s (the whole sync budget) |
| One page-heavy symbol, every window capped | 13 x 20 = 260 | about 60 s |
| Reconcile, 25 h window, S = 100 | 100 | about 23 s of its 300 s |

`TIMEOUT_PER_KIND`: `"sync_trades": 15 * 60` and `"reconcile_strategy": 5 * 60` `[VERIFIED: job_worker.py:997,1002]`. A spot-resolved name is walked in 24-hour windows: an 85-day cold seed is up to 85 requests per symbol at the documented spot weight of 20 (ccxt cost 4, 183 ms each, about 15.6 s per symbol), which is why spot is the one case where the 429 circuit breaker (`_stamp_429`) could fire; it is a corner (Q1: no spot twin is ingested) and the deadline bounds it. Reconcile's request count does not change with the walk: its window is `now - 24h` minus the 1 h overlap, one 7-day window per symbol, and today's `now - since < 7d` sends no `endTime` while the walk sends `endTime = now`; same rows.

**Decision: add a read deadline.** The worst case CAN exceed the sync budget (S about 300 cold, or about 15 page-heavy symbols) and a heavy-symbol case can approach reconcile's 300 s when S is large. Shape: module constant `BINANCE_FILLS_READ_DEADLINE_S = 240.0` (fits under reconcile's 300 s with 60 s for the DB scan, diff and upserts; about 1,050 requests per run for sync), `deadline = _monotonic() + BINANCE_FILLS_READ_DEADLINE_S` taken after symbol discovery, checked inside the `async with sem:` block immediately before each network call (so a task that waited on the semaphore past the deadline does not fire). A stopped symbol returns what it read, is named in `binance_deadline_symbols` and contributes its `B` to `binance_read_through_ms`: the last read fill's timestamp when the stop is mid-window with fills read, otherwise `window_start - 1` (everything before the first unread window), or `start - 1` for a symbol never started. This is the same stop shape as the cap, resumable through the same stamp, never a cancel. No caller edit: the constant is the default for both callers. `[ASSUMED]` the value 240 (a judgment from the two budgets and the measured throttle).

**How the per-symbol design behaves at the deadline (re-derived, then prototyped).** `_fetch_one` holds the semaphore only across one request, and `asyncio.Semaphore` wakes waiters first in, first out, so the symbol tasks interleave round-robin, one request each in turn, instead of running one symbol to completion. A scratch simulation of that exact shape (5 slots, every symbol needing 13 windows, a budget of 1,048 requests, which is 240 s at 229 ms) measured: S=50 finishes every symbol (650 requests, no stop); S=100 stops with every symbol 10 or 11 windows in; S=300 stops with every symbol 3 or 4 windows in; only S=1200 leaves some symbols with 0 windows. So at a deadline the symbols are all about equally far along, `binance_read_through_ms` is the common frontier, and the gate stamps the newest persisted fill at or before it, which advances the cursor whenever the covered prefix holds at least one stored fill. The cursor stalls only when the covered prefix is entirely quiet (no stored fill at or before the frontier) or S exceeds about 1,000 symbols: both are named every run (`binance_deadline_symbols`) and neither is silent. A quiet-prefix stall is the CONTEXT's own rule (no non-fill stamp) showing through, and window-major order would not change it.

### Q5. The second caller, `run_reconcile_strategy_job`

`job_worker.py:15438-15535` (read): `since = now - timedelta(hours=24)`, `since_ms = parse_since_ms(None, preferred=since_iso)`, `fetch_raw_trades(ctx.exchange, strategy_id, ctx.supabase, since_ms=since_ms)`; then `get_and_clear_last_dq_flags()` and DISCARD ("it does not own a strategy_analytics row to stamp these into"); `ColdStartSymbolDiscoveryError` becomes `exchange_fills = []`; every other exception drains and re-raises. Not gated by `_RAW_TRADE_INGESTION_ENABLED`. Enqueued nightly 03:30 UTC (CONTEXT, `src/app/api/cron/reconcile-strategies/route.ts`, not re-read).

- **Behaviour change from the walk:** none in request count or rows for a normal key (one window, `endTime = now`). The behaviour change is the markets-load fix (Pitfall 1): today it reads spot for linear symbols; after the fix it reads the linear market and the diff becomes real. PROD has 0 Binance strategies, so nothing live moves.
- **Flag drain:** no change is REQUIRED for correctness. One cost: a stopped read (cap, deadline, partial symbol) gives a short `exchange_fills` against a complete DB window, so the diff would report `db_only` mismatches and can fan a `sync_failure` alert. That is true today for the page cap and for `binance_partial_symbols` and needs more than 20,000 fills per symbol in 25 h to trigger. Recommendation: do NOT edit reconcile in this phase (scope fence "only if research shows a flag-drain change is needed"); record it as a known limit in the CHANGELOG (Open Question 2 offers a log line).
- **Tests covering reconcile:** `tests/test_job_worker_reconcile_audit.py`, `tests/test_job_worker.py` (4668-4722 area), `tests/test_routers_audit_emission.py`, `tests/test_routers_audit_emission_structure.py`. They patch `services.job_worker.fetch_raw_trades`, so none exercises `_fetch_raw_trades_binance` and none breaks.

### Q6. Test census and the venue fake

**Census (`grep -ac`, per file, this session):**

| File | `_fetch_raw_trades_binance` | `binance_partial_symbols` | `BINANCE_PAGE_CAP` | `BinancePerSymbolFetchError` |
|---|---|---|---|---|
| `tests/test_exchange.py` | 3 | 17 | 1 | 3 |
| `tests/test_job_worker.py` | 0 | 1 (line 4705, reconcile drain test; unaffected) | 0 | 1 (comment, 4671) |
| `tests/test_okxtrades_cursor.py` | 0 | 3 (lines 39, 671, 686: the CR-02 arm and its neuter note) | 0 | 0 |
| `tests/test_ana_recon_audit.py` | 1 (line 653, source inspection) | 0 | 0 | 0 |

`binance_fill_cursor_advance_plus1` and `ccxt_symbol_by_normalized` have a count of 0 in every test file. The files that name `binance_partial_symbols` or `BINANCE_PAGE_CAP` outside `.planning/phases` are CHANGELOG.md, the Python files in the table above plus `services/exchange.py` and `services/job_worker.py`, `.planning/STATE.md` and `.planning/ROADMAP.md`; that is a census of where the names occur, not a proof that no other consumer exists.

**13 tests in `tests/test_exchange.py` fake `exchange.fetch_my_trades` for `fetch_raw_trades` on Binance** (lines 1046, 1180, 1393, 1452, 1527, 1594, 1649, 1739, 2806, 2893, 4077, 4147, 4845), plus the source-inspection test in `test_ana_recon_audit.py`: **14 to migrate**. Two classes of breakage:
- **8 use a hand fake with signature `(symbol, since=None, limit=None)`** (lines 1192, 1466, 1610, 1666, 1761, 2846, 2921, 4091). The walk passes `params=`, which raises `TypeError` inside `_fetch_one`; every such symbol becomes a "failed symbol". The "always fails" test (1610) would pass for the wrong reason.
- **5 use `AsyncMock(return_value=...)`** (1054, 1404, 1549, 4159, 4859). They accept `params`, but every test passes `since_ms=None`, so the seed becomes `read_now - 85 d` and each symbol makes up to 13 window calls returning the same canned rows (duplicates, changed `await_count`).
- All 13 use `mock_exchange.markets = {}` (falsy): with the load-markets fix this calls `AsyncMock.load_markets()` (harmless) and keeps the raw passthrough.
- `test_c13_03_binance_cursor_advances_without_plus_one` (source inspection): Pitfall 2.
- `test_binance_pagination_hits_page_cap` asserts exactly 20 calls and a `"page cap"` warning containing the symbol: keep the cap at 20 per window and keep that log text, or update it in the same plan.
- Phase 1 tests (3839-3999, `fetch_daily_pnl`'s income fallback, `tests/test_exchange_harness.py:448,1124-1140`) use `fetch_my_trades` for the BTC/USDT spot fallback and are NOT touched.

**The venue-modelling fake: a real ccxt instance with its HTTP-method layer replaced** (precedent: `tests/_bybit_real_markets.py` builds a real `ccxt.async_support.bybit` from recorded instruments and a position-list book; `tests/_okx_bills.py::OkxBillsArchive` is the venue-faithful bills fake used by `test_okxtrades_walk.py`, which pins the clock with `monkeypatch.setattr(ex, "_now_ms", lambda: NOW_MS, raising=False)`). Recipe, verified end to end in scratch under ccxt 4.5.89:
- `ex = ccxt.async_support.binance({"enableRateLimit": False})`; `ex.set_markets([...])` with recorded unified market dicts for `BTC/USDT`, `BTC/USDT:USDT`, `BTC/USDC`, `BTC/USDC:USDC`, `BTC/USD:BTC`, `BTC/USDT:USDT-261225` (record them once from the public `load_markets()` into a committed JSON, as the Bybit helper does from a cassette); `ex.milliseconds = lambda: NOW_MS`.
- Replace `ex.fapiPrivateGetUserTrades`, `ex.dapiPrivateGetUserTrades`, `ex.privateGetMyTrades` with a `BinanceFillsVenue` callable that receives the REQUEST (`symbol`, `startTime`, `endTime`, `limit`) and returns raw venue rows (string numbers, `time` in ms), so ccxt's `market()`, `until`, implicit cap and `parse_trades` run unchanged.
- Venue rules to model (and label which are documented): linear and inverse: no `startTime` and no `endTime` serves `[now - 7d, now]` (documented); both sent and `endTime - startTime > 7d` raises `ccxt.BadRequest` (documented rule, the error class is the fake's choice); `startTime` only serves `[start, min(start + 7d, now)]` (the CONTEXT's rule; UNMEASURED for the venue, correct for ccxt-linear because ccxt sends the cap itself); `startTime` older than the reach raises `ccxt.BadRequest` (UNMEASURED at the venue; the fake is deliberately strict so a walk past the reach goes RED, and a second switch makes it return an empty list instead, to prove the clamp is not the only defence); spot window 24 h; rows sorted by `(time, id)` ascending (UNMEASURED at the venue; ccxt sorts anyway, so add a `newest_first=True` switch used by one arm that proves the helper is not order-dependent on a single page); at most `min(limit, 1000)` rows; default `limit` 500; `endTime` treated inclusive with a switch for exclusive.
- To model "markets not loaded": leave `ex.markets = None`, replace `ex.fetch_markets` with a coroutine returning the recorded list and `ex.fetch_currencies` with one returning `{}`, so the REAL `load_markets()` runs lazily (the scratch run used exactly this).

**Which gates go RED on today's code with it** (scratch-confirmed where marked):

| Gate | Arm | RED today because |
|---|---|---|
| SC-1 quiet stretch | cursor C, fill at C, 20 quiet days, fill at day 25 | confirmed: request carries `endTime = since + 7d`, rows 0; the day-25 fill is never returned |
| SC-1 seed None | `since_ms=None` | today sends no `startTime` (venue serves only the last 7 days); the walk reads from the reach |
| SC-1 reach clamp | cursor 120 days old | today sends the out-of-reach `startTime` -> strict venue raises -> symbol "partial"; no clamp flag exists |
| SC-2 unlisted | symbol absent from markets + a healthy symbol with fills past C+7d | today: `binance_partial_symbols` set, the key `binance_unlisted_symbols` absent |
| SC-2 transient | a symbol raising `ccxt.NetworkError` | GREEN today and after (guard that the hold is kept) |
| SC-2 all unlisted | every symbol BadSymbol | must raise `BinancePerSymbolFetchError` (guard for Pitfall 3) |
| SC-3 producer | one symbol with 21,000 fills in one window | today: no flag; 20,000 returned, nothing says so |
| SC-3 consumer | gate arm through the real `run_sync_trades_job` | today stamps `max` of all fills, past the capped symbol |
| SC-3 resume | second run seeded from the stamp reads fills 20,001 onward | today re-reads the same oldest 20,000 |
| Markets unloaded | stored `BTCUSDT`, `markets=None` | confirmed: spot endpoint, 0 fills |
| Deadline | `_monotonic` pinned past the deadline after N requests | no deadline today |

### Q7. Phase 222 overlap

`git fetch origin gsd/phase-222-alerttruth main` then `git diff origin/main...origin/gsd/phase-222-alerttruth -- analytics-service/services/job_worker.py analytics-service/services/exchange.py` (HEAD of this worktree is `5af373617` on `origin/main` `21b9ad929`): `exchange.py | 2 +-` (hunk `@@ -1505 +1505 @@ async def validate_key_permissions`, a message string); `job_worker.py | 270` lines in hunks starting at 2851/2895/2979/2982/2986/2987 (all inside `run_sync_trades_job`'s follow-on enqueue epilogue, after line 2851) and one at 12429 (`run_stitch_composite_job`). The changed lines of the hunks are the enqueue-outcome comment and its `except` arm (read in the diff output); none of the lines the diff shows as added or removed names `_fills_incomplete`, `advance_fetched_cursor`, `_p_last_fetched`, `fills_anchor_iso`, `_RAW_TRADE_INGESTION_ENABLED` or any Binance symbol. **No hunk touches a symbol this phase writes**: the gate block is at lines 2688-2752, the RPC write at 2754-2835, the declaration comment at 327-333, and exchange.py edits sit around 150-216 and 2483-2723. `[VERIFIED: git diff]`. List write scope by symbol in each plan anyway; the line numbers above will move.

### Q8. SC-4

The declaration is `job_worker.py:331-333`:
```
_RAW_TRADE_INGESTION_ENABLED: Final[bool] = (
    os.environ.get("USE_RAW_TRADE_INGESTION", "false").lower() == "true"
)
```
under a comment starting "M-0673: Feature flag is read once at module import" (lines 327-330). Record the precondition in that comment (name Phase 250 and SC-1..3, and "Binance"), and in the CHANGELOG entry ("Keep `USE_RAW_TRADE_INGESTION` off until this PR is on main" is the 232 wording). No runbook that tells an operator how to flip it was found. Where the name occurs outside `.planning/phases`: CHANGELOG.md, `job_worker.py` (332 declaration; comments near 2585 and 2697), three test files, two migration comments, `.planning/STATE.md` and `ROADMAP.md`, a v0.15 discussion log, and a comment in `src/app/(dashboard)/admin/compute-jobs/page.tsx:50`. `docs/` holds `architecture`, `demos`, `notes`, `pitch`, `runbooks`, `superpowers` and `analytics-service/docs/` holds Deribit and MT5 notes; none of them was found to describe the switch, which is a finding of this session's reading and not proof that none does (UNMEASURED). The Railway variable's current value was not re-read this session (CONTEXT: off in PROD). The flag is venue-agnostic: turning it on enables OKX, Bybit and Deribit raw ingestion as well, so the comment should say the Binance precondition is one of several venue conditions and not claim the others.

### Q9. CI checks to run before push

- **mypy:** `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` `[VERIFIED: .github/workflows/ci.yml:5740]`; the Makefile `typecheck` target is pinned to the same path set by `src/__tests__/contracts/ci-mypy-strict-surface.contract.test.ts` (read, 1-200 of 1462 lines: its header comment states the pins). It derives the surface from `git ls-files`: every top-level directory under `analytics-service/` holding a tracked `.py`, minus the hand-typed `EXCLUDED` set (`tests`, `scripts`), plus every tracked top-level `analytics-service/*.py`. Consequence for this phase: keep ALL new production code inside `services/exchange.py` and `services/job_worker.py` (or a new file under `services/`); a new top-level module or package would need the ci.yml command and the Makefile `typecheck` recipe widened in the same commit or the contract test goes RED. The new test helper under `tests/` is excluded and needs nothing. It also pins the exact mypy flag set, so do not add a flag or a `# mypy:` comment. `.venv/bin/mypy` exists. New code in `services/exchange.py` and `services/job_worker.py` is inside the gated surface; `ccxt.*` is `ignore_missing_imports` (Any at the boundary). Tests are untyped by design.
- **ruff:** none. `ruff` is not in `.venv/bin`, `requirements-dev.txt`, the Makefile or any workflow (grep of `.github/workflows`, Makefile, `package.json`). Nothing to run.
- **pytest, CI:** `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` `[VERIFIED: ci.yml:5919]`, pinned byte-equal with the Makefile `test:` target by `src/__tests__/local-stack-lane-wiring.test.ts`. `asyncio_mode = auto`, so async tests need no marker (the older `test_exchange.py` tests still carry `@pytest.mark.asyncio`, which is harmless). The `python` job boots a local Supabase lane; the offline Binance tests need none. Run from `analytics-service/` only; never `importlib.reload`.
- **Quick local gates:** `cd analytics-service && .venv/bin/pytest tests/test_exchange.py tests/test_okxtrades_cursor.py tests/test_ana_recon_audit.py tests/test_binancefills_walk.py tests/test_binancefills_cursor.py -q -p no:cacheprovider` (baseline measured here before any edit: `-k "inance or cursor or c13_03 or okxtrades"` gave `50 passed, 213 deselected in 13.90s`).
- Repo rules for the executor (CLAUDE.md): a CHANGELOG entry and a 4-digit `VERSION`/`package.json` bump in the ship commit, no skip-CI token anywhere in a commit message or PR body, `git diff` after any `gsd-tools` state handler, the PR changes nothing under `.planning`, no AI attribution trailers (user memory), neuter from a byte backup (`cp` back, `cmp`), `grep -a`.

## Code Examples

### Walk skeleton (per symbol, inside `_fetch_raw_trades_binance`)
```python
# Source: derived from services/exchange.py 2584-2656 (read) and the OKX walk 1780-1846; names are proposals
read_now = _now_ms()                                   # once, outside _fetch_one
reach_ms = read_now - BINANCE_FILLS_REACH_DAYS * 86_400_000
if since_ms is not None and since_ms < reach_ms:
    _record_dq_flag("binance_fills_reach_clamped", True)
start_ms = reach_ms if since_ms is None else max(since_ms, reach_ms)
deadline = _monotonic() + BINANCE_FILLS_READ_DEADLINE_S

async def _fetch_one(symbol):
    ccxt_symbol = ...   # map; unmapped + markets loaded -> raise ccxt.BadSymbol(...)
    window_ms = _window_ms_for(exchange, ccxt_symbol)   # 24 h if markets[ccxt_symbol]["spot"] is True, else 7 d
    trades, window_start, stop = [], start_ms, None
    while window_start <= read_now and stop is None:
        window_end = min(window_start + window_ms - 1, read_now)   # window_ms: 7 d, or 24 h for a spot market
        current_since, window_trades = window_start, []
        for _page in range(BINANCE_PAGE_CAP):
            async with sem:
                if _monotonic() >= deadline:
                    stop = ("deadline", window_trades[-1]["timestamp"] if window_trades else window_start - 1)
                    break
                batch = await exchange.fetch_my_trades(
                    ccxt_symbol, since=current_since, limit=BINANCE_FILLS_PAGE_LIMIT,
                    params={"until": window_end},
                )
            if not batch: break
            window_trades.extend(batch)
            if len(batch) < BINANCE_FILLS_PAGE_LIMIT: break
            last_ts = int(batch[-1]["timestamp"])      # keep the "no timestamp -> stop" guard
            next_since = last_ts
            if next_since == current_since:            # keep this literal: test_c13_03 greps the source
                next_since = current_since + 1         # and the binance_fill_cursor_advance_plus1 flag
            current_since = next_since
        else:
            stop = ("cap", int(window_trades[-1]["timestamp"]))
        trades.extend(window_trades)
        window_start = window_end                       # 1 ms overlap
        if window_end >= read_now: break
    return symbol, trades, stop
```
(A deadline stop mid-window with fills read uses the newest read fill; with none read, `window_start - 1`. The skeleton shows the shape; the executor writes the typed version under mypy strict.)

### Venue fake, request-layer
```python
# Source: scratch prototype run under ccxt 4.5.89 (this session); NOT committed code
class BinanceFillsVenue:
    def __init__(self, fills_by_venue_id, kind, now_ms): ...
    async def __call__(self, req):                      # req: symbol, startTime, endTime, limit
        win = 7 * DAY if self.kind != "spot" else DAY
        s, e, lim = req.get("startTime"), req.get("endTime"), int(req.get("limit", 500))
        if s is None and e is None: lo, hi = self.now - win, self.now
        else:
            if s is not None and e is not None and e - s > win: raise ccxt.BadRequest("window")
            lo = s if s is not None else e - win
            hi = e if e is not None else min(s + win, self.now)
        rows = sorted((r for r in self.fills[req["symbol"]] if lo <= r["time"] <= hi), key=lambda r: (r["time"], r["id"]))
        return rows[:min(lim, 1000)]
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Binance docs at `binance-docs.github.io/apidocs/futures/en/` | `developers.binance.com`, which now 302s the old derivatives URLs to `/en/docs/catalog/...` | observed 2026-11-25 | The GitHub-pages docs are a redirect stub; spot docs remain raw markdown on GitHub |
| ccxt docs list `until` for `fetchMyTrades` | `params.until` documented in the 4.5.89 docstring (binance.py:8638) | pinned version | The walk relies on it |

**Deprecated/outdated:** the CONTEXT note that the primary checkout's venv is 4.5.85; the worktree venv is 4.5.89 and matches the pin.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `BINANCE_FILLS_REACH_DAYS = 85` clears the venue's "past 3 months" rule | Q2 | Too long: an out-of-reach `startTime` errors (the walk fails loudly and holds); too short: a cursor 86-89 days old is clamped needlessly and flagged |
| A2 | The venue serves the OLDEST rows of a `[startTime, endTime]` window first when `limit` truncates it | Q1 | If it served the newest, advancing `since` to the last row would skip the middle of a full window; the docs are silent, ccxt sorts client-side, and the existing H-0662 loop already depends on it |
| A3 | `endTime` is inclusive (1 ms window overlap makes the walk safe either way) | Q2 | None if overlap is kept |
| A4 | A `startTime`-only request on COIN-M and spot is a forward window of 7 d / 24 h | Q6 (fake) | The fake models it; the walk never sends one, so only the fake's fidelity is affected |
| A5 | `BINANCE_FILLS_READ_DEADLINE_S = 240.0` is a good default for both callers | Q4 | Too low: more cold runs stop early; too high: reconcile times out near 300 s |
| A6 | Spot-only stored symbols are not a product surface | Q1 | If a strategy trades a collided spot twin, those fills are never read (pre-existing) |
| A7 | PROD had zero Binance rows at 2026-11-25 only; the first key changes every figure here | Q4 | Re-run the counts when a key is onboarded |
| A8 | `-1121` and the other two codes fire for symbols the venue does not know, not for a transient fault | Q1 | A transient fault classified unlisted would skip a span silently; the codes are the CONTEXT's and ccxt maps them to `BadSymbol` |
| A9 | The Railway `USE_RAW_TRADE_INGESTION` value is off (not re-read here) | Q8 | If on, the Binance sync path is live and the phase is more urgent |

## Open Questions

1. **Per-symbol (locked) or window-major (OKX shape) loop order?**
   - What we know: the interleaving prototype (Q4) shows per-symbol tasks stop at a common frontier, so per-symbol gives the same global prefix the OKX window-major order would.
   - What's unclear: nothing that blocks; window-major would also need the 1 ms overlap and the same stamp bound.
   - Recommendation: keep per-symbol (locked, simpler). Low weight; no founder question.
2. **Should reconcile log that its read was stopped?**
   - What we know: it discards the flags; a stopped read yields spurious `db_only` rows.
   - Recommendation: out of scope; one line in the CHANGELOG limits section. A log line is a reconcile edit the scope fence only allows if the planner judges it required.
3. **Add the `BinanceFillsOutOfWindow` self-check?**
   - Recommendation: yes if cheap; it is the only way a venue that ignores `endTime` becomes visible.
4. **Name the single-window more-than-20K-fills-within-1-hour stall?**
   - Recommendation: a WARNING log naming the symbol; no extra flag (Pitfall 4).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python venv with ccxt | all tests | yes | `analytics-service/.venv`, ccxt 4.5.89 | — |
| pytest, mypy in the venv | gates | yes | `.venv/bin/pytest`, `.venv/bin/mypy` | — |
| ruff | none (not a gate) | no | — | not needed |
| Public Binance REST (no keys) | recording markets metadata once | yes (not geo-blocked here) | `load_markets()` returned 4742 markets | the committed recording |
| Signed Binance endpoint | measuring order / reach behaviour | no (no keys; PROD has none) | — | UNMEASURED items stay assumptions |
| Supabase CLI to PROD (read) | counts | yes | 2.84.2, marker verified | — |
| Docker / local stack | not required | not booted | — | the offline tests need none |

**Missing dependencies with no fallback:** none for planning or implementation.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest with pytest-asyncio, `asyncio_mode = auto` |
| Config file | `analytics-service/pytest.ini` |
| Quick run command | `cd analytics-service && .venv/bin/pytest tests/test_binancefills_walk.py tests/test_binancefills_cursor.py -q -p no:cacheprovider` |
| Full suite command | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` |

### Phase Requirements -> Test Map
Every arm drives either the REAL `_fetch_raw_trades_binance` through `fetch_raw_trades` on a real `ccxt.binance` with the venue fake (walk file) or the REAL `run_sync_trades_job` through the `test_okxtrades_cursor.py` harness (`_make_supabase`, `_run_job(fills_flags=...)`; cursor file). Instants are hand-typed epoch-ms literals beside the pinned `NOW_MS`.

| Criterion | Behavior | Test file | RED on pre-fix | PROOF-01 neuter (restore with `cp`, `cmp`, GREEN) |
|---|---|---|---|---|
| SC-1 | 20 quiet days then a fill is read; cursor stamp = that fill | walk + cursor | `endTime = since+7d`, rows 0 (confirmed in scratch) | N1: drop `params={"until": ...}` from the request -> quiet-stretch arm RED |
| SC-1 | `since_ms=None` walks from the reach, never a start-less request | walk | start-less request, last 7 days only | N2: send `since=None` when `since_ms is None` |
| SC-1 | seed older than the reach is clamped, flag named, no hold | walk + cursor | no clamp, strict venue raises | N3: drop the clamp (`max(since_ms, reach)`) |
| SC-1 | window span never exceeds 7 days, boundary fill read once or twice, never zero | walk | n/a | N4: window span `7d + 1 ms` -> strict venue raises; N5: next start = end + 1 with an exclusive-`endTime` venue switch -> boundary fill lost |
| SC-2 | unlisted symbol named in `binance_unlisted_symbols`, absent from `binance_partial_symbols`; healthy symbol's fills past C+7d returned | walk | key absent; partial set | N6: remove the `isinstance(item, ccxt.BadSymbol)` branch |
| SC-2 | gate does not hold on `binance_unlisted_symbols`; stamps | cursor | n/a (key unknown today) | N7: add the new key to `_fills_incomplete` -> arm RED |
| SC-2 | transient failure keeps the hold and its span is re-read on the next clean run (refuse-then-clean) | cursor | GREEN (guard) | existing N8 (drop the `binance_partial_symbols` disjunct) |
| SC-2 | all symbols unlisted still raises `BinancePerSymbolFetchError` | walk | n/a | N8b: compare `len(failed_symbols)` alone |
| SC-3 | capped window: flag + `binance_read_through_ms`, 20 pages per window, returns the 20K oldest | walk | no flag | N9: delete the `_record_dq_flag` for the cap |
| SC-3 | stamp = newest persisted fill `<= bound`, never past the capped symbol's unread fills | cursor | stamps `max` of all | N10: ignore the bound in the gate |
| SC-3 | a hold beats the stop stamp | cursor | n/a | N11: apply the bound branch outside `if advance_fetched_cursor` |
| SC-3 | NULL column + stop + nothing stampable anchors at `fills_anchor_iso`, also with empty `raw_fills` | cursor | no anchor | N12: drop the new anchor line |
| SC-3 | resume: second run, seed = stamp - 1 h, reads fills 20,001 onward; end to end across two runs | walk + cursor | re-reads the oldest 20K | N10 again |
| SC-3 | two symbols stopped at different instants: `binance_read_through_ms` equals the SMALLER bound and the gate stamps at or before it | walk + cursor | n/a | N16: record the bound per symbol so `_record_dq_flag` sums them -> the equality assert goes RED |
| Spot | a spot-only stored name (`ETHBTC`) resolves to the spot market and is read in 24 h windows, never refused into `binance_partial_symbols`, fills 3 days apart both read | walk | today's start-only spot request serves one 24 h forward window, so the later fill is lost (fake models the 24 h rule) | N17: use the 7-day window for a spot market -> the strict venue raises `BadRequest`, the symbol turns partial, arm RED |
| Budget | deadline stops the walk, names `binance_deadline_symbols`, bound = last read fill or window start - 1, stores nothing extra | walk | no deadline | N13: delete the deadline check |
| Markets | stored `BTCUSDT` with `markets=None` reads the linear endpoint; `BTCUSDCC`, `BTCUSD:BTC`, `BTCUSDT-261225` resolve to fapi, dapi, fapi | walk | spot endpoint, 0 fills (confirmed) | N14: remove the `load_markets()` call |
| Markets | collision resolves to linear regardless of market iteration order (spot listed last) | walk | GREEN by luck today (the arm only goes RED on the neuter) | N15: last-write-wins without the precedence rule, spot listed last |
| Reconcile | a 25 h `since` sends one window per symbol with `endTime = now`, same rows | walk | n/a | covered by the walk arms |
| SC-4 | comment names the precondition | none | prose is not tested (CONTEXT) | none |

### Sampling Rate
- **Per task commit:** the quick run command plus the migrated `test_exchange.py` Binance tests.
- **Per wave merge:** `tests/test_exchange.py tests/test_okxtrades_cursor.py tests/test_ana_recon_audit.py tests/test_job_worker.py tests/test_sync_trades_resume_seed.py` and mypy strict.
- **Phase gate:** full suite green with `--cov-fail-under=80`, mypy strict green, before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `analytics-service/tests/_binance_fills.py` — real `ccxt.binance`, recorded markets, `BinanceFillsVenue`
- [ ] A recorded markets fixture (JSON of the six unified market dicts, from a public `load_markets()`; the scratch recording script is trivial)
- [ ] `tests/test_binancefills_walk.py`, `tests/test_binancefills_cursor.py`
- [ ] Migrate the 14 tests in the census to the fake (or to `since_ms`-pinned `AsyncMock` returns with `params` accepted); replace the source-inspection test with a behavioural same-ms pin
- [ ] A module-level `BINANCE_PAGE_CAP` so a test can lower it (today it is a local)
- [ ] A `_window_ms_for(exchange, ccxt_symbol)` helper (spot 24 h, else 7 d) beside the constants

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no (no new auth surface) | — |
| V3 Session Management | no | — |
| V4 Access Control | no (no RPC, RLS or migration change; the SECDEF RPC is untouched) | — |
| V5 Input Validation | yes | Venue rows are parsed by ccxt; the helper validates `timestamp` is numeric before using it (existing guard) and the gate parses stamps with `coerce_to_aware_utc` |
| V6 Cryptography | no (ccxt signs) | never hand-roll |
| V7 Error handling / logging | yes | Scrub exception text with `scrub_freeform_string` before logging (existing NEW-C13-10 pattern); never log a venue string into a flag verbatim; the new flags carry symbol names (already stored by `binance_partial_symbols`) and ints |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| HMAC signature leaking through a ccxt exception message | Information disclosure | `scrub_freeform_string(str(e))` in every new log line (the existing per-symbol warning at line 2687 logs `str(item)` unscrubbed; keep or scrub, do not add a new unscrubbed one) |
| Venue-controlled list growth in `data_quality_flags` JSONB | DoS | `_DQ_LIST_MERGE_CAP = 64` caps list flags in `_record_dq_flag`; the new list flags inherit it |
| Cursor running ahead of stored data (data integrity) | Tampering | Stamp only a stored fill bounded by `binance_read_through_ms`; RPC monotone |
| Public repo with tracked `.planning` | Information disclosure | No account numbers, key ids or PROD ids in artifacts (this file has counts only) |

## Sources

### Primary (HIGH confidence)
- ccxt 4.5.89 installed source: `async_support/binance.py` 8619-8885 (`fetch_my_trades`), 2913-2967 (`market`), 3400-3470 (`fetch_markets` types and order), 4027-4075 (`fetch_balance` loads markets); `base/exchange.py` 5752-5765, 3448-3470, 6665-6690
- `analytics-service/services/exchange.py` 100-340, 682-690, 755-775, 840-910, 1040-1110, 1760-1846, 2420-2723, 3180-3260, 3320-3380
- `analytics-service/services/job_worker.py` 310-345, 996-1008, 2120-2160, 2195-2360, 2540-2870, 15438-15535
- `supabase/migrations/20260602173710_advance_sync_cursor_claim_token_fence.sql` 126-135
- `.github/workflows/ci.yml` 5700-5750, 5905-5925; `analytics-service/pytest.ini`, `pyproject.toml`, `Makefile`
- Tests read: `tests/test_exchange.py` (1040-1100, 2797-2990 and the census), `tests/test_okxtrades_cursor.py` (1-420), `tests/test_ana_recon_audit.py` 630-662, `tests/_okx_bills.py`, `tests/_bybit_real_markets.py`, `tests/test_okxtrades_walk.py` header
- Live public measurements (scratch, 2026-11-25): `load_markets()` on ccxt 4.5.89 (4742 markets); `exchangeInfo` rate limits of `fapi`, `dapi`, spot; the ccxt throttler timing; real-ccxt-plus-venue-fake prototype
- PROD read via `supabase db query --linked` from the primary checkout: marker query then four count queries, all Binance counts 0
- `git diff origin/main...origin/gsd/phase-222-alerttruth` for the two files

### Secondary (MEDIUM confidence)
- `developers.binance.com` USDⓈ-M and COIN-M Account Trade List, through a summarising fetch (short quotes only; raw page unobtainable here)
- `github.com/binance/binance-spot-api-docs` `rest-api.md` lines 4739-4800 (verbatim)

### Tertiary (LOW confidence)
- None used.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new package, versions read from the pin and the venv
- Architecture: HIGH, the helper, gate and RPC were read in full and the key behaviours reproduced
- Pitfalls: HIGH for 1-6 (reproduced or read); MEDIUM for the venue-order and reach behaviours (UNMEASURED)
- Budget: MEDIUM, the throttle is measured but PROD holds no Binance data to size symbols or fills

**Method notes (what was and was not done):**
- The PROD counts came through the Supabase CLI (`supabase db query --linked`, one query per call, marker first), not the Supabase MCP, which was not available to this agent. The marker comment named PRODUCTION. Corroboration of the zero: REQUIREMENTS.md `LATENT-01` (BINANCEREADY) carries the trigger "the first Binance key is onboarded".
- The GSD `research-plan`, `research-store` and `classify-confidence` seams and the package-legitimacy gate were not run: every source here was read directly (installed ccxt source, repo files, live public endpoints, the Binance pages) and no package is installed. Confidence tags above are the researcher's own.
- The two Binance futures pages were read through `WebFetch`, a summarising fetch that returns short quotes; the raw pages could not be fetched (302 then an empty 202). The spot page was read verbatim from the Binance spot-docs repository.
- No signed Binance call was made (no keys exist, and PROD has none), so order, out-of-reach `startTime`, `endTime` inclusivity and the start-only default on COIN-M and spot are UNMEASURED.
- Scratch scripts (market recording, collision analysis, throttle timing, the real-ccxt venue-fake prototype, the interleaving simulation) lived in the session scratchpad and are not committed; the plan's Wave 0 recreates the fake and the recorded markets.

**Research date:** 2026-11-25
**Valid until:** 2026-12-25 (ccxt pinned; venue docs have restructured once already)
