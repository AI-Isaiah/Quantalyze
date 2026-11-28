# Phase 259: OKXARCHIVEFILLS - Context

**Gathered:** 2026-11-27
**Status:** Ready for planning

<domain>
## Phase Boundary

An OKX strategy's stored fills (`public.trades`, `is_fill = true`) are complete back to its start. OKX's `fills-history` reaches only the last 3 months, so fills older than Phase 255's begin floor (`_okx_fills_begin_floor_ms` in `analytics-service/services/exchange.py`) are read from OKX's quarterly bills archive (`POST`/`GET /api/v5/account/bills-history-archive`). Each trade bill becomes one stored fill with the same shape and the same `exchange_fill_id` (`tradeId`) the `fills-history` read stores. After deploy, the three PROD OKX strategies are backfilled through the product's own path.

Out of scope: daily returns, NAV, `csv_daily_returns` and `strategy_analytics` (OKXHISTORY already rebuilt days from the archive; this phase writes fills only); Phase 256 OKXUNITSWITCH's unit handling; any venue other than OKX.

The endpoint choice and its evidence are in the ROADMAP `### Phase 259` section (OKX v5 docs and changelog, read 2026-11-27). The fills archive ("Transaction details (in the past 2 years)", `trade/fills-archive`) was delisted on 2024-09-18, and `bills-history-archive` is the only documented source that reaches the missing spans.

</domain>

<decisions>
## Implementation Decisions

### Founder decision
- Founder 2026-11-27, verbatim: "Yea, get archive endpoint". The product reads OKX's archive so the fills `fills-history` cannot reach are recovered. The endpoint is `account/bills-history-archive`, the only documented one that reaches them (ROADMAP evidence).

### Source and mapping
- One stored fill per archive trade bill. `exchange_fill_id` = the bill's `tradeId`, so `trades_dedup_fill (strategy_id, exchange, exchange_fill_id)` absorbs every overlap with `fills-history` rows. `side` comes from `subType` (1 and 3 buy, 2 and 4 sell, 5 sell, 6 buy, with `posSide` net for 1 and 2, long for 3 and 5, short for 4 and 6). Price comes from `px`. Quantity comes from `sz` through the SAME contract-value conversion the `fills-history` normaliser applies to `fillSz` (NEW-C13-01 in `exchange.py`). Fee comes from `fee`. `timestamp` comes from `fillTime` (fall back to `ts` only if the planner proves `fills-history` stores `ts`; match whatever the live normaliser stores). `raw_data` records the source as the archive. — **Reversibility:** costly — rows written to PROD `trades` with a wrong mapping need a scoped repair, so SC-2's reconciliation must pass before any write.
- Which subTypes count as fills is measured, not assumed: start from the trade subTypes (1 to 6) and add liquidation, delivery or block-trade subTypes only if a real file and the `fills-history` overlap show them as fills. Any trade-shaped bill of an unmapped subType stops the write by name.
- The mapping is proven per `instType` on real data. SWAP is the only `instType` in PROD's archive range (measured: the 200 full-payload PROD fills are all SWAP, net, subType 1 = buy, subType 2 = sell). An `instType` without a proof on a real file (SPOT, MARGIN, FUTURES, OPTION) is refused by name and not written.

### Completeness and safety gates
- A quarter's file is used only when the existing completeness proof passes (`okx_archive_classify.verify_bal_chain`, which OKXHISTORY's calibrate run 5 passed on PROD), and only when the reconciliation against stored `fills-history` fills passes over every span both sources cover (exact `tradeId` match, equal side, price, size and fee, equal counts). Either failure stops that read by name and writes nothing for it. A quarter that is not ingested leaves its span unwritten and named. — **Reversibility:** costly — these gates are what make an un-checksummed file safe to publish as trade history.
- The parser (`okx_archive_files.py`) is extended to keep `tradeId`, `ordId`, `instId`, `px`, `sz`, `execType` and `fillTime`. Its existing pins (the 28-column header, the UTC+8 quarter cut, the D-17 billId strip and the duplicate-conflict stop) and the daily-returns rebuild's behaviour do not change. The tests for those pins stay green unedited.
- No download link, request `ts`, amount or account identifier appears in a log, `last_error`, an exception text or tracked text. This is the OKXHISTORY rule, and it is kept.

### Trigger and scope (Claude's discretion, recorded for the founder)
- The archive read is automatic: when a `sync_trades` run for an OKX strategy finds history older than the fills begin floor that no completed archive read covers, it chains an archive-fills read for that key, the way `sync_trades` already chains `derive_broker_dailies`. The same read can be enqueued by hand. Recommendation, not a founder ruling: it is the only shape that keeps future OKX strategies complete without an operator. It also matches the backfill instruction (enqueue `sync_trades` through `enqueue_compute_job`, as Phase 255 did).
- The read is a durable job with a stateless wait on OKX's request state, like `okx_archive_rebuild`. It is never a wait inside a `sync_trades` claim. Whether it is a new job kind (a migration adding it to `compute_job_kinds` and the kind arrays) or a new mode of `okx_archive_rebuild` is the planner's call. Pick the smaller change that keeps the daily-returns rebuild's contract untouched.
- The read is scoped per OKX account and quarter, never per strategy. One account's file serves every strategy whose key reads that account. The apply POST (12 a day per user ID, cost 72000 in ccxt) gets its own client, one attempt and no retry loop, as in OKXHISTORY.
- Which quarters are needed is computed from data: from the strategy's start (the planner picks the anchor, such as the earliest daily return or the key's start) up to the begin floor. Quarters before 2021-02 do not exist. The current quarter is outside the archive. A span between the current quarter's start and the begin floor that neither source reaches yet is named, not hidden.

### Decided autonomously
- [Code layout] Q: "Where does the new code live?" → Selected: "In its own module(s) under analytics-service/services (for example an okx_archive_fills module), touching exchange.py and job_worker.py only at named seams" — Phase 256 is editing exchange.py and job_worker.py now, and code in a separate module is cheap to move.
- [Tests] Q: "How is the mapping tested?" → Selected: "Fixture CSV rows shaped like the real archive header, paired with fills-history rows of the same tradeId, asserting byte-equal stored rows; plus a reconciliation-mismatch arm and an unproven-instType arm" — tests can be reworked freely.
- [Write path] Q: "How are fills written?" → Selected: "The same upsert path and on-conflict-do-nothing behaviour the fills-history ingestion uses for trades" — reusing the live write keeps one write semantics and can be changed locally.

### Claude's Discretion
- The job's result shape, stop-class names and progress fields, following the OKXHISTORY Result shape v1 conventions.
- Whether the backfill's PROD run needs a dry-run mode first. A dry-run is welcome if it is cheap, because the apply budget is small.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `analytics-service/services/okx_archive_job.py`: the `okx_archive_rebuild` job (D-02 key checks, the apply POST on its own client, the stateless wait, the claim budget, the Result shape v1 writer).
- `analytics-service/services/okx_archive_download.py`: the one SSRF-safe download of `fileHref`, with an exact host allow-list. `okg-pri-hk.oss-cn-hongkong.aliyuncs.com` was measured on PROD's real Q2 and Q3 files.
- `analytics-service/services/okx_archive_files.py`: the strict CSV parser (`ArchiveRow`, `ArchiveFile`, `quarter_bounds`, the UTC+8 cut).
- `analytics-service/services/okx_archive_classify.py`: `verify_bal_chain` (the completeness proof) and the committed subType table.
- `analytics-service/services/exchange.py`: `_fetch_raw_trades_okx`, `_fetch_raw_trades_okx_inst_type`, the fills normaliser (contract-value conversion, NEW-C13-01), `_okx_fills_begin_floor_ms`, the `okx_fills_reach_clamped` flag.

### Established Patterns
- Durable jobs: `compute_jobs` kinds admitted in `compute_job_kinds` plus the kind arrays (see `supabase/migrations/20261026120000_okx_archive_rebuild.sql`), dispatched in `job_worker.dispatch` with a handler timeout and a watchdog override in `main_worker.py`.
- Fills dedupe on `trades_dedup_fill (strategy_id, exchange, exchange_fill_id)`. OKX's `exchange_fill_id` is `tradeId` (measured: 200 of 200 full-payload rows).
- PROD measurements from OKXHISTORY: Q2 2026 file 596 bills (first 2026-03-31), Q3 2026 file 1010 bills (through 2026-09-30), both zip. Q1 2026 was never read.

### Integration Points
- `run_sync_trades_job` in `services/job_worker.py` (shared with Phase 256 and Phase 257; change it only at a named seam).
- `enqueue_compute_job` (the product path for the PROD backfill).

</code_context>

<specifics>
## Specific Ideas

- PROD at booking: three OKX strategies, which appear to be one OKX account (identical newest fills), with 100, 106 and 200 fills before 2026-08-27, spread over 3, 10 and 9 days. Their first daily returns date from 2026-02-23 or 2026-04-30. Fills before and after the backfill are reported per strategy.
- The Q3 2026 file overlaps `fills-history`'s reach (about 2026-08-27 to 2026-09-30), which gives the real-data reconciliation for SWAP.

</specifics>

<deferred>
## Deferred Ideas

- Spot, margin, futures and options archive fills, until a real file proves their bill shape (refused by name in this phase).

</deferred>

## Addendum 2026-11-27 (after research): orchestrator resolutions of RESEARCH.md's open questions

These are the phase agent's calls under "Claude's Discretion". The founder can override them. They follow the research recommendations:
- **Mode, not kind.** The read is two new modes of `okx_archive_rebuild`, `fills_calibrate` (everything except the write) and `fills_apply`, forked at the top of `run_okx_archive_rebuild_job` into a new module. There is no migration and no new job kind. Targets and quarters are derived in-claim and never carried in metadata (the enqueue dedupe drops new metadata).
- **Cooldown, not a marker table.** A `sync_trades` run chains `fills_apply` for an OKX strategy whose anchor is below the begin floor, whose earliest stored fill is more than 2 days after the anchor, and whose key has had no `fills_apply` job in the last 14 days. `fills_calibrate` does not count toward the cooldown.
- **Empty overlap.** A read whose quarters have no `fills-history` overlap may write for an instType proven on a real file (SWAP), and only with the bal chain passing.
- **Anchor.** The strategy's earliest `csv_daily_returns` date. The targets are strategies on connected OKX keys of the same account (`venue_account_id`), and D-02 verifies the uid of each.
- **Normaliser.** Extract one pure helper from `_fetch_raw_trades_okx_inst_type`'s loop body, pinned by a golden recorded before the extraction.
- **Empty but clean read.** It counts as answered for the cooldown.
- **Timestamp.** The stored `timestamp` is `ts`, matching the live normaliser (`exchange.py` reads `fill["ts"]`). The reconcile compares timestamp too, and names which archive column matches.
- **Apply budget.** Read state with GET first, and apply only when OKX has no entry or the state is `failed`. There is no per-claim re-apply loop for the fills modes.
