# Phase 250: BINANCEFILLS — a Binance fills read walks every window and never stalls its cursor - Context

**Gathered:** 2026-11-25
**Status:** Ready for planning

<domain>
## Phase Boundary

From ROADMAP.md `### Phase 250` (quoted, binding): "A Binance raw fills read covers every window from its cursor to now, and its cursor never stalls, silently or because one symbol fails. This phase must land before `USE_RAW_TRADE_INGESTION` is turned on for Binance."

It closes the three Binance survivors that Phase 232's review routed (`232-REVIEW.md` round 2, `232-VERIFICATION.md`):
- R2-02 (silent stall): a Binance linear key with a set cursor and more than 7 quiet days reads an empty `[C, C+7d]` window, never stamps, and its cursor never moves again.
- R2-01 (loud stall): a symbol that raises `ccxt.BadSymbol` on every run sets `binance_partial_symbols` every run, the CR-02 hold keeps the cursor at C, and healthy symbols stop past C+7d.
- `BINANCE_PAGE_CAP` stop: records no flag, so a capped symbol loses its newest fills and the max over the other symbols stamps past them silently.
- SC-4: `USE_RAW_TRADE_INGESTION` is not turned on for Binance before SC-1..3 are on `main`; the phase records this as an explicit precondition of that switch.
- SC-5 PROOF-01: every gate goes RED on pre-fix code or a neutered copy with its named arm first, restored from a byte backup (`cp` back, `cmp`), GREEN, recorded verbatim in the plan SUMMARY.

Scope fence (ROADMAP, Depends on): it keeps Phase 232's fills-cursor rules ("stamp the newest stored fill or nothing; hold on `sync_truncated_*` and `binance_partial_symbols`"). It shares `run_sync_trades_job` with 222 ALERTTRUTH (built, not shipped, on `origin/gsd/phase-222-alerttruth`; its `job_worker.py` hunks are the follow-on enqueue arm of `run_sync_trades_job` and one line in `validate_key_permissions`'s neighbourhood of `exchange.py`), so plans list their write scope BY SYMBOL and never edit 222's handler changes. Phase 251 SYNCSTORE (booked, not started) will reorder `run_sync_trades_job`; this phase does not reorder it.

### Facts measured during discuss (2026-11-25, worktree at `21b9ad929`)
- Venue doc read: Binance USDⓈ-M futures "Account Trade List", `GET /fapi/v1/userTrades` (developers.binance.com, derivatives/usds-margined-futures/trade/rest-api/Account-Trade-List), read through a summarising fetch: weight 5; `limit` default 500, max 1000; "If `startTime` and `endTime` are both not sent, then the last 7 days' data will be returned."; "The time between `startTime` and `endTime` cannot be longer than 7 days."; "The parameter `fromId` cannot be sent with `startTime` or `endTime`."; "Only support querying trade in the past 3 months". The page does not state result order, nor what the venue does with a `startTime` older than 3 months. Research re-reads the page verbatim and records both unknowns as unmeasured.
- ccxt at the pinned `4.5.89` (`requirements.txt`; the primary checkout's venv is 4.5.85, the worktree venv was built at 4.5.89): `binance.fetch_my_trades` sets `endTime = min(since + 7d, now)` only when `now - since >= 7d`, no `until`/`endTime` was passed, AND the market is `linear`. With `since=None` it sends no `startTime`, so the venue returns only the last 7 days. ccxt maps venue codes `-1108`, `-1121`, `-20121` to `BadSymbol`, and also raises `BadSymbol` client-side from `self.market(symbol)` when the symbol is not in its loaded markets.
- `_fetch_raw_trades_binance` (`services/exchange.py`) calls `exchange.fetch_my_trades(ccxt_symbol, since=current_since, limit=1000)` with no `until`, pages oldest-first by advancing `since` to the last fill's timestamp (+1 ms on a same-ms full page), stops at `BINANCE_PAGE_CAP = 20` pages with only a log line, gathers symbols with `Semaphore(5)`, names failed symbols in `binance_partial_symbols`, and raises `BinancePerSymbolFetchError` when every symbol failed.
- The read has TWO callers, and only one is dormant: `run_sync_trades_job` (gated on `_RAW_TRADE_INGESTION_ENABLED`, off in PROD) and `run_reconcile_strategy_job` (NOT gated; enqueued nightly at 03:30 UTC by `src/app/api/cron/reconcile-strategies/route.ts`; its handler timeout is 5 minutes, `job_worker.py` timeout table). So a change to the Binance read is LIVE in PROD through reconcile on merge.
- The reverse map `ccxt_symbol_by_normalized` uses the same strip as `normalize_symbol` (`replace("/","").replace(":USDT","").replace(":USD","")`). A spot `BTC/USDT` and a linear `BTC/USDT:USDT` both strip to `BTCUSDT`, so which market a stored symbol resolves to depends on `exchange.markets` iteration order, and `BTC/USDC:USDC` strips to `BTCUSDCC`. Whether a stored linear symbol can resolve to a spot market (whose window limit is not 7 days) is UNMEASURED.
- TODOS.md: `grep -a` for `R2-01`, `R2-02`, `BINANCE_PAGE_CAP`, `binance_partial` and `Binance fills` returns 0 lines, so the measured set of TODOS entries this phase closes is EMPTY (the three items live only in `232-REVIEW.md` / `232-VERIFICATION.md`).

</domain>

<decisions>
## Implementation Decisions

Classification note: every choice below is a code change inside the Binance branch of the fills read and the cursor gate of one handler. There is no migration, no schema change, no public API or URL contract and no new dependency, and the sync path is dormant in PROD (`USE_RAW_TRADE_INGESTION` off). So each is technical and reversible by a code revert. The live reconcile caller is the one reach into PROD, and it only reads and diffs. No question met the hard-to-reverse or preference class, so none was put to the founder.

### Decided autonomously
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

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- OKX window walk in `fetch_daily_pnl` (Phase 232): `OKX_BILLS_WINDOW_DAYS`, `OKX_BILLS_REACH_DAYS`, `_now_ms` clock indirection (`_wall_clock_ms`), oldest-first windows, contiguous-prefix stop. The Binance walk mirrors its shape.
- `_record_dq_flag` / `get_and_clear_last_dq_flags` per-task DQ buffer; `fetch_raw_trades` resets it at entry and applies `OVERLAP_WINDOW_MS` (1 h).
- `analytics-service/tests/test_okxtrades_cursor.py`: the cursor-gate test harness for `run_sync_trades_job` (CR-01/CR-02 arms).

### Established Patterns
- Cursor gate in `run_sync_trades_job`: `_fills_incomplete` (hold on `sync_truncated_*` and `binance_partial_symbols`), `advance_fetched_cursor`, stamp = max persisted fill timestamp, bootstrap anchor `fills_anchor_iso` for a NULL column. Seed: `min(cursor, newest stored fill)`.
- Page caps are pinned by tests and never raised as a close.

### Integration Points
- `fetch_raw_trades` → `_fetch_raw_trades_binance`; callers `run_sync_trades_job` (dormant) and `run_reconcile_strategy_job` (live, nightly, 5 min).
- `advance_sync_cursor` RPC writes the cursor monotonically.

</code_context>

<specifics>
## Specific Ideas

- Read the venue doc page verbatim (not through a summariser) for the window, reach and `fromId` lines, and record the two unstated behaviours (result order, older-than-reach `startTime`) as unmeasured with the walk self-checking on them where cheap (e.g. a row outside the requested window is refused by name).
- Agent briefs that touch this read also consult the Binance venue docs (founder rule, 2026-11-25).

</specifics>

<deferred>
## Deferred Ideas

- A read-through (non-fill) cursor stamp for a fully empty tail: would relax a Phase 232 rule; a founder decision if ever wanted.
- Per-symbol persisted cursors: a migration; not needed for SC-1..3 under the decisions above.
- Clearing a stale `binance_partial_symbols` / new flag from `data_quality_flags` once resolved: the flag-clearing class belongs to Phase 251 SYNCSTORE (its item 3).

</deferred>
