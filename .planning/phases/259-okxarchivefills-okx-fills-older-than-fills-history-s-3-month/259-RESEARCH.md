# Phase 259: OKXARCHIVEFILLS - Research

**Researched:** 2026-11-27
**Domain:** OKX v5 `account/bills-history-archive` as a source of per-fill history, written into `public.trades` through the existing OKX fills shape
**Confidence:** MEDIUM. The mapping, the seams and the censuses are read from code and are HIGH. Three things only a real PROD file can settle are unmeasured: whether the real CSV populates `tradeId`/`px`/`sz`/`fillTime` on trade bills, whether archive `ts` equals `fills-history` `ts`, and whether the apply POST budget is 12 per day or 1 per 10 s. The design below makes each of them a named gate or a bounded cost, not an assumption.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Founder decision**
- Founder 2026-11-27, verbatim: "Yea, get archive endpoint". The product reads OKX's archive so the fills `fills-history` cannot reach are recovered. The endpoint is `account/bills-history-archive`, the only documented one that reaches them (ROADMAP evidence).

**Source and mapping**
- One stored fill per archive trade bill. `exchange_fill_id` = the bill's `tradeId`, so `trades_dedup_fill (strategy_id, exchange, exchange_fill_id)` absorbs every overlap with `fills-history` rows. `side` comes from `subType` (1 and 3 buy, 2 and 4 sell, 5 sell, 6 buy, with `posSide` net for 1 and 2, long for 3 and 5, short for 4 and 6). Price comes from `px`. Quantity comes from `sz` through the SAME contract-value conversion the `fills-history` normaliser applies to `fillSz` (NEW-C13-01 in `exchange.py`). Fee comes from `fee`. `timestamp` comes from `fillTime` (fall back to `ts` only if the planner proves `fills-history` stores `ts`; match whatever the live normaliser stores). `raw_data` records the source as the archive. — **Reversibility:** costly — rows written to PROD `trades` with a wrong mapping need a scoped repair, so SC-2's reconciliation must pass before any write.
- Which subTypes count as fills is measured, not assumed: start from the trade subTypes (1 to 6) and add liquidation, delivery or block-trade subTypes only if a real file and the `fills-history` overlap show them as fills. Any trade-shaped bill of an unmapped subType stops the write by name.
- The mapping is proven per `instType` on real data. SWAP is the only `instType` in PROD's archive range (measured: the 200 full-payload PROD fills are all SWAP, net, subType 1 = buy, subType 2 = sell). An `instType` without a proof on a real file (SPOT, MARGIN, FUTURES, OPTION) is refused by name and not written.

**Completeness and safety gates**
- A quarter's file is used only when the existing completeness proof passes (`okx_archive_classify.verify_bal_chain`, which OKXHISTORY's calibrate run 5 passed on PROD), and only when the reconciliation against stored `fills-history` fills passes over every span both sources cover (exact `tradeId` match, equal side, price, size and fee, equal counts). Either failure stops that read by name and writes nothing for it. A quarter that is not ingested leaves its span unwritten and named. — **Reversibility:** costly — these gates are what make an un-checksummed file safe to publish as trade history.
- The parser (`okx_archive_files.py`) is extended to keep `tradeId`, `ordId`, `instId`, `px`, `sz`, `execType` and `fillTime`. Its existing pins (the 28-column header, the UTC+8 quarter cut, the D-17 billId strip and the duplicate-conflict stop) and the daily-returns rebuild's behaviour do not change. The tests for those pins stay green unedited.
- No download link, request `ts`, amount or account identifier appears in a log, `last_error`, an exception text or tracked text. This is the OKXHISTORY rule, and it is kept.

**Trigger and scope (Claude's discretion, recorded for the founder)**
- The archive read is automatic: when a `sync_trades` run for an OKX strategy finds history older than the fills begin floor that no completed archive read covers, it chains an archive-fills read for that key, the way `sync_trades` already chains `derive_broker_dailies`. The same read can be enqueued by hand. Recommendation, not a founder ruling: it is the only shape that keeps future OKX strategies complete without an operator. It also matches the backfill instruction (enqueue `sync_trades` through `enqueue_compute_job`, as Phase 255 did).
- The read is a durable job with a stateless wait on OKX's request state, like `okx_archive_rebuild`. It is never a wait inside a `sync_trades` claim. Whether it is a new job kind (a migration adding it to `compute_job_kinds` and the kind arrays) or a new mode of `okx_archive_rebuild` is the planner's call. Pick the smaller change that keeps the daily-returns rebuild's contract untouched.
- The read is scoped per OKX account and quarter, never per strategy. One account's file serves every strategy whose key reads that account. The apply POST (12 a day per user ID, cost 72000 in ccxt) gets its own client, one attempt and no retry loop, as in OKXHISTORY.
- Which quarters are needed is computed from data: from the strategy's start (the planner picks the anchor, such as the earliest daily return or the key's start) up to the begin floor. Quarters before 2021-02 do not exist. The current quarter is outside the archive. A span between the current quarter's start and the begin floor that neither source reaches yet is named, not hidden.

**Decided autonomously**
- [Code layout] Q: "Where does the new code live?" → Selected: "In its own module(s) under analytics-service/services (for example an okx_archive_fills module), touching exchange.py and job_worker.py only at named seams" — Phase 256 is editing exchange.py and job_worker.py now, and code in a separate module is cheap to move.
- [Tests] Q: "How is the mapping tested?" → Selected: "Fixture CSV rows shaped like the real archive header, paired with fills-history rows of the same tradeId, asserting byte-equal stored rows; plus a reconciliation-mismatch arm and an unproven-instType arm" — tests can be reworked freely.
- [Write path] Q: "How are fills written?" → Selected: "The same upsert path and on-conflict-do-nothing behaviour the fills-history ingestion uses for trades" — reusing the live write keeps one write semantics and can be changed locally.

### Claude's Discretion
- The job's result shape, stop-class names and progress fields, following the OKXHISTORY Result shape v1 conventions.
- Whether the backfill's PROD run needs a dry-run mode first. A dry-run is welcome if it is cheap, because the apply budget is small.

### Deferred Ideas (OUT OF SCOPE)
- Spot, margin, futures and options archive fills, until a real file proves their bill shape (refused by name in this phase).
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are mapped to Phase 259 (ROADMAP `**Requirements**: none mapped`). The planner maps the six ROADMAP success criteria instead.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | One stored fill per trade bill, same symbol, side, price, quantity, fee, timestamp and `exchange_fill_id` as `fills-history`; source in `raw_data` | Sections "Mapping (Q1)" and "Live normaliser (Q2)": reuse the live normaliser through one extracted helper |
| SC-2 | Mapping proven per `instType` on real data; mismatch stops with a named class; unproven `instType` refused | "Reconciliation window"; "Stop classes" |
| SC-3 | Idempotent; a quarter not ingested leaves its span named, never a silent partial write | "Write path"; "Per-quarter outcome" |
| SC-4 | Archive wait never blocks a `sync_trades` claim; no link, `ts` or amount in logs | "Job shape (Q3)"; "Trigger"; Validation Architecture |
| SC-5 | PROD backfill through the product's own path, before/after per strategy, unrecovered spans named | "PROD backfill (Q7)" |
| SC-6 | PROOF-01: each gate goes RED on a neutered copy with its named arm first | Validation Architecture, neuter table |
</phase_requirements>

## Summary

The archive file already reaches the code: `okx_archive_job.py` applies, waits statelessly, downloads through a host allow-listed downloader and parses a strict 28-column CSV, and `verify_bal_chain` proves a file complete. What is missing is (a) a parser that keeps the trade cells it currently drops, (b) a mapper from a trade bill to the same row the live `fills-history` normaliser writes, (c) a reconciliation of the mapper against stored fills over the span both sources cover, (d) a per-strategy write through the live upsert shape, and (e) a trigger that does not loop. Everything else is reuse.

Three facts reshape the obvious design. First, the live normaliser stores `ts`, not `fillTime`, as `trades.timestamp`, so CONTEXT's "fillTime, fall back to ts" resolves to `ts` for the stored value (proved below); whether the archive's bill `ts` equals the `fills-history` `ts` of the same fill is unproven offline and must be a reconciliation column. Second, OKX documents the apply POST limit twice and the two readings conflict (12 per day on the endpoint page, 1 per 10 s per user in the 2026-06-11 changelog entry). `okx_archive_job._quarter_step` re-applies every quarter on every claim, which under the 12-per-day reading spends a 3-quarter budget in about 2 h 15 min, so the fills job must read first and apply only when OKX has no usable request. Third, the existing archive tests pin the kind as "nobody's follow-on" and `len(TIMEOUT_PER_KIND) == 16`, and a new kind costs a migration with three admission sites plus about ten census edits, so a new mode of the existing kind, forked at the handler's first line into a new module, is the smaller change.

**Primary recommendation:** Add two modes (`fills_calibrate` = everything but the write, `fills_apply` = the same plus the write) to kind `okx_archive_rebuild`, forked at the top of `run_okx_archive_rebuild_job` into a new `services/okx_archive_fills.py` (plus a small mapper module); extend `ArchiveRow` with raw trailing string fields; extract the per-fill body of `_fetch_raw_trades_okx_inst_type` into one pure helper both paths call; read OKX state with GET before any apply; chain from the end of `run_sync_trades_job` with a data-derived trigger and a 14-day compute_jobs cooldown; run a `fills_calibrate` on PROD first because the first real look at the trade cells is that run.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Archive request, wait, download, parse | API / Backend (analytics worker, `okx_archive_*`) | — | Holds the decrypted read-only key; the wait is `defer_compute_job`, never a held claim |
| Trade-bill to fill mapping | API / Backend (new pure module) | — | Pure function of a parsed row; shares the live normaliser |
| Reconciliation against stored fills | API / Backend | Database / Storage (read of `trades`) | Compares two sources; reads only the strategy's own rows |
| Fill persistence | Database / Storage (`trades`, `trades_dedup_fill`) | API / Backend (service-role upsert) | The unique index is the idempotency authority |
| Auto-trigger | API / Backend (`run_sync_trades_job` tail) | Database (`compute_jobs` rows as cooldown memo) | Chain edge crosses target types (strategy to api_key), like the cron and linked-recompute re-entries |
| Operator report (before/after fills, named spans) | Database (job result block at `metadata->member_progress`, PROD read by MCP) | — | No UI in this phase |
| Browser / SSR / CDN | none | — | No user-facing surface changes. Admin label for the kind is unchanged under the recommended design |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| stdlib `csv`, `decimal`, `dataclasses`, `asyncio` | Python 3.12 (CI and Dockerfile; local dev machine has 3.14.3, build the venv with `make rebuild-venv`) | Parsing, exact money, the job | `okx_archive_files.py` is "stdlib only" by design |
| `ccxt` (async) | 4.5.89 (pinned in `analytics-service/requirements.in`) | `private_get_/post_account_bills_history_archive`, `private_get_trade_fills_history` | Already the client for both live paths |
| `httpx` | already in the lock | The existing downloader | Reuse `download_archive_csv`, never a second downloader |
| supabase-py (`services.db`) | already in the lock | `trades` read and upsert, `compute_jobs` reads | Same write call shape as the live upsert |

### Supporting
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `services.okx_archive_job` helpers `_ApplyPacer`, `_apply_quarter_on_fresh_instance`, `_read_quarter_status`, `_record_ready`, `_download_quarter`, `_defer_job`, `_finish_stop`, `_check_keys`, `_check_account`, `_ClaimBudget`, `_blank_quarter` | The wait, the D-02 checks, the result writer | Imported by the new module (private names, but this file already imports private names from `job_worker` and `exchange`). `_finish_stop` and `_error_text` embed `KIND`, which equals the shared kind, so `last_error` reads `okx_archive_rebuild: <stop_class>`; acceptable, and the mode rides in the result block |
| `services.okx_archive_classify.verify_bal_chain` | Completeness proof | Called with a `summed_ccys` set the fills module computes itself (see Pitfall 9) |
| `services.exchange._okx_fills_begin_floor_ms`, `_OKX_INGEST_CONTRACT_SIZE`, `normalize_symbol`, `_make_fill_dict` | Floor, ctVal table, symbol, row factory | The mapper |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New mode of `okx_archive_rebuild` (recommended) | New kind `okx_archive_fills` | Own in-flight slot and own result contract, but a migration (three admission sites), a PROD apply ordering, a baseline re-dump PR and the census list in "New kind: what it would cost". Choose it only if the founder wants a rebuild and a fills read in flight on one key at once, or a separate admin label |
| Extract a pure helper from `_fetch_raw_trades_okx_inst_type` (recommended) | Build a fake exchange and call the live function with a synthesized one-page response | Zero edit to `exchange.py` and zero merge risk, but it reuses an I/O function as a normaliser (pager, cursor, `billId` semantics) and hides the seam. Fallback only if Phase 256 merge pressure appears |
| Compute `summed_ccys` in the fills module (recommended) | Call `aggregate_archive` for it | `aggregate_archive` also raises the daily-rebuild stops `non_usd_ccy`, `unknown_subtype_nonzero`, `subtype_map_drift`; a quarter with a coin-denominated fee bill would then block a fills read that never uses those sums |

**Installation:** none. No new package is introduced.

## Package Legitimacy Audit

No external package is added or changed. `ccxt==4.5.89`, `httpx`, supabase-py and the stdlib are already pinned. The seam check is not applicable.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 daily 00:10Z trade-sync tick / manual enqueue_compute_job(sync_trades)
                    |
                    v
        run_sync_trades_job (OKX strategy)            <- unchanged fills read, clamped at the begin floor
            |  ...stores fills-history fills, enqueues derive_broker_dailies (JOB_CHAIN_FOLLOW_ON[0])
            v
   [seam] chain_okx_archive_fills(ctx, strategy_id)   <- best-effort, never changes the sync outcome
            |  needs_archive(strategy)?  (anchor < floor, stored reach short, no job in 14 days)
            |  yes -> enqueue_compute_job(p_api_key_id=key, kind=okx_archive_rebuild,
            |         metadata={"mode":"fills_apply"})       (no quarters, no targets: both derived in-claim)
            v
   compute_jobs row (api_key scoped, in-flight unique per key)
            |
            v  claimed by the interactive loop
   run_okx_archive_rebuild_job -- mode in FILLS_MODES? -- yes --> run_okx_archive_fills_job(job)
            |                                    (rebuild modes: untouched path)
            v
   1 validate input  2 resolve sibling strategies of the key's venue account  3 _check_keys (D-02)
   4 _allocator_key_preflight  5 _check_account (uid match, read_only)
   6 quarters needed = f(anchor, floor, today)  -- none --> DONE nothing_to_read
            v
   7 per quarter, READ FIRST: GET state
        finished+link ----------------------------------+
        ongoing -----> defer (poll 15 min, 8 h / 24 h bounds)
        no entry / failed -> ONE apply on its own client -> defer 2 h
            v (all quarters ready)
   8 download (allow-listed host) -> parse_archive_csv (extended ArchiveRow)
   9 gates: verify_bal_chain over adjacent quarters, instType proven, subType mapped,
            trade cells readable, no duplicate tradeId, ctVal known
  10 per strategy: reconcile window [floor+1d, quarter cut end) vs stored fills
            -- mismatch --> named per-strategy stop, nothing written for it
  11 fills_apply: upsert (strategy_id, exchange, exchange_fill_id) ignore_duplicates, 100 per batch
  12 result block (counts only) via set_compute_job_progress; DONE, or FAILED with the first stop class
```

### Recommended Project Structure
```
analytics-service/services/
├── okx_archive_files.py     # + trailing raw string fields on ArchiveRow, filled in the one parse loop
├── okx_archive_fills_map.py # pure: ArchiveRow -> fills-history-shaped dict -> live normaliser; stop errors
├── okx_archive_fills.py     # the job: input, targets, quarters, GET-first step, gates, reconcile, write, result
├── exchange.py              # one extracted pure helper (named seam), loop body calls it
├── okx_archive_job.py       # + a 4-line fork at the top of run_okx_archive_rebuild_job, nothing else
└── job_worker.py            # + one best-effort call at the tail of run_sync_trades_job (lazy import)
analytics-service/tests/
├── fixtures/okx_archive/    # NEW csv files with trade cells; q2_like.csv / q3_like.csv stay untouched
├── test_okx_archive_fills_map.py
├── test_okx_archive_fills_job.py
└── test_okx_archive_fills_chain.py
```

### Pattern 1: Fork inside the existing kind, contract of the rebuild untouched
**What:** the rebuild's `MODES`, `_read_job_input`, `STOP_CLASSES`, Result shape v1 and tests are not edited. The fork sits before `_read_job_input`, keyed on literal mode names that no existing test uses (the existing invalid-mode test feeds `"nonsense"` and `None`).
**Evidence:** `MODES` is `("preflight", "calibrate", "apply")` [VERIFIED: analytics-service/services/okx_archive_job.py:256, quoted: `MODES: Final[tuple[str, ...]] = ("preflight", "calibrate", "apply")`]. The handler is `async def run_okx_archive_rebuild_job(job: dict[str, Any]) -> DispatchResult:` [VERIFIED: okx_archive_job.py:2545]. The dispatch arm is `elif kind == "okx_archive_rebuild":` with a lazy import [VERIFIED: job_worker.py:19681].
**Why the module fork, not a dispatch-arm fork:** `job_worker.py` is shared with Phase 256 and Phase 257; `okx_archive_job.py` has no Phase 256 hunk.

### Pattern 2: Read first, apply only when OKX has no usable request (the apply budget)
See "Apply budget" under Q3. This is the one deliberate departure from `_quarter_step`.

### Pattern 3: Reconcile on the overlap, prove the mapper, trust the chain elsewhere
The span both sources cover is only the part of a quarter inside `fills-history`'s reach. Today that is the tail of the Q3 file. The older quarters have no overlap, so for them the evidence is the bal chain plus the mapper's proof on the overlap. See "Reconciliation window".

### Anti-Patterns to Avoid
- **Re-applying every claim.** `_quarter_step` does it; copying it spends the apply budget.
- **Calling `aggregate_archive` for the fills job's currency set.** It carries daily-rebuild stops unrelated to fills.
- **Defaulting an unknown contract size.** `_okx_contract_size_for_inst_id` returns 1.0 and stamps a DQ flag no archive job drains, which writes a 10x-wrong quantity silently for ETH. Stop by name instead.
- **Registering the chain in `JOB_CHAIN_FOLLOW_ON`.** It feeds the reaper ceiling and `[0]` is load-bearing (see Pitfall 7).
- **A per-key job keyed on the strategy that happened to sync.** The in-flight unique index is per api_key, and the enqueue dedupe returns the existing row and drops the new metadata, so targets must be derived in-claim, not carried in metadata.
- **Strict parsing of `px`/`sz`/`tradeId` inside `parse_archive_csv`.** The committed fixtures carry subType 1 and 2 rows with those cells blank; strict parsing breaks the pins. Keep cells raw, parse in the fills module.

## Q1. OKX API facts (docs and changelog)

Sources: a local text copy of the OKX v5 docs fetched 2026-11-27 (the bills archive section and the `fills-history` section), plus a live re-read of the changelog for the one entry that mattered.

| Fact | Evidence |
|------|----------|
| Apply: `POST /api/v5/account/bills-history-archive`, body `year`, `quarter`, optional `type`; "Apply for bill data since 1 February, 2021 except for the current quarter"; response `result` and `ts`; "Check the file link from the "Get bills details (since 2021)" endpoint in 2 hours"; "If the file link is still unavailable after 3 hours, reach out to customer support" | [CITED: okx.com/docs-v5/en, Apply bills details (since 2021)] |
| Rate limit text on the endpoint page: "Rate Limit: 12 requests per day", "Rate limit rule: User ID" | [CITED: okx.com/docs-v5/en, same section] |
| Changelog 2026-06-11: "The rate limit of POST / Apply bills details (since 2021) has been changed from 12 requests per day to 1 request per 10 seconds per user." | [CITED: okx.com/docs-v5/log_en/, 2026-06-11 heading; re-read live this session] |
| **These two statements conflict.** OKXHISTORY's research (2026-10-15) already recorded the 1-per-10-s reading and ccxt's `# 12 req/day` comment. This research does not pick one. | see Apply budget |
| Get: `GET /api/v5/account/bills-history-archive?year&quarter` returns `fileHref`, `state` (`finished`, `ongoing`, `failed`: "Failed, please apply again"), `ts`; link "expiration of every link is 5 and a half hours"; "If you already apply the files for the same quarter, then it don't need to apply again within 30 days"; "only applicable to the data from the unified account" | [CITED: okx.com/docs-v5/en, Get bills details (since 2021)] |
| CSV fields: `instType, billId, subType, ts, balChg, posBalChg, bal, posBal, sz, px, ccy, pnl, fee, mgnMode, instId, ordId, execType, interest, tag, fillTime, tradeId, clOrdId, fillIdxPx, fillMarkPx, fillPxVol, fillPxUsd, fillMarkVol, fillFwdPx`. This is 28 names. | [CITED: okx.com docs, "Field descriptions in the decompressed CSV file"]; equal to `ARCHIVE_HEADER` [VERIFIED: okx_archive_files.py:63, 28 entries read this session] |
| `px` is "Trade filled price" for subTypes `1` to `6`, the block-trade `204` to `209` and forced-repayment `114`/`115`; `fee` "Negative number represents the user transaction fee charged by the platform. Positive number represents rebate."; `execType` `T` taker `M` maker; `ordId` "Return order ID when the type is 2 / 5 / 9"; `ts` "The time when the balance complete update"; `fillTime` "Last filled time"; `tradeId` "Last traded ID" | [CITED: same section] |
| The CSV has no `side`, no `posSide`, no `feeCcy`. The bill currency is `ccy`, "Account balance currency". | [CITED: same section] |
| `fills-history` response per fill: `side, fillSz, fillPx, fee, feeCcy, ordId, instType, instId, posSide, billId, subType, fillTime, execType, tradeId, ts, ...`. `ts` is "Data generation time"; `fillTime` is "Trade time which is the same as fillTime for the order channel"; the doc's own example has `fillTime` `1708587373361` and `ts` `1708587373362` (they differ by 1 ms). `tradeId` "will be assigned a negative value" for liquidation, partial liquidation and ADL; `fee`: "The trading fee deduction is negative"; `after` pages by billId; `begin`/`end` "Filter with a begin timestamp `ts`". | [CITED: okx.com/docs-v5/en, Get transaction details (last 3 months)] |
| "Transaction details (last 2 years)" endpoints were delisted (changelog); the Trade section lists only `/trade/fills` (3 days) and `/trade/fills-history` (3 months) | [CITED: okx.com/docs-v5/log_en/, ROADMAP evidence paragraph] |

### The stored timestamp is `ts`, not `fillTime`
The live normaliser reads `ts_raw = fill.get("ts", "")`, builds `ts_dt` from it and stores `timestamp=ts_dt.isoformat()` [VERIFIED: analytics-service/services/exchange.py:3110 `ts_raw = fill.get("ts", "")`, and :3213 `timestamp=ts_dt.isoformat(),`]. `fillTime` is never read. CONTEXT's rule ("match whatever the live normaliser stores") therefore resolves to `ts`.

What is unproven: that the archive bill's `ts` ("the time when the balance complete update") equals the `fills-history` `ts` ("data generation time") of the same fill, to the millisecond. The fills-history row carries the bill's `billId`, so it is very likely the same bill timestamp [ASSUMED, A1]. The reconciliation must therefore compare the stored `timestamp` with BOTH archive columns, gate on the one the mapper uses (a single named constant), and record the other's match count in the result's `info`. If `ts` does not match and `fillTime` does, swapping the constant is the whole fix. SC-1's equal-`timestamp` wording is only satisfied if this comparison is part of the SC-2 equality list; CONTEXT's list (tradeId, side, price, size, fee, counts) omits it, so add it.

Note `datetime.fromtimestamp(int(ts_raw) / 1000, ...)` divides a float, so to be byte-equal the mapper must reach the same expression through the shared helper, not re-implement it.

## Q2. The live fills path and the normaliser

### Reach and floor
- `_OKX_FILL_INST_TYPES: tuple[str, ...] = ("SWAP", "FUTURES", "SPOT", "MARGIN")` [VERIFIED: exchange.py:508].
- `OKX_FILLS_REACH_DAYS: int = 93` [VERIFIED: exchange.py:713], the first-sync anchor used by `run_sync_trades_job`.
- `_okx_fills_begin_floor_ms(now_ms)` returns now minus three calendar months (day clamped) plus one day [VERIFIED: exchange.py:721-727]. The floor moves forward every day.
- `_fetch_raw_trades_okx` records `okx_fills_reach_clamped` only when a non-null `since_ms` is below the floor, then raises `since_ms` to the floor [VERIFIED: exchange.py:3262-3290, the `if since_ms < begin_floor_ms:` block]. A sync whose cursor is recent never sets the flag, so **the flag is not usable as the archive trigger.** Phase 255's PROD backfill worked only because all three strategies' cursors were already older than the floor (CHANGELOG, 2026-11-27 entry: "No cursor reset was needed ... the queued read's seed was clamped to the floor").

### Normaliser, step by step (inside the `for fill in data:` loop of `_fetch_raw_trades_okx_inst_type`, exchange.py:3070 onward)
1. `ts` digits-only or the fill is dropped with `logger.error` (`continue`).
2. `symbol = normalize_symbol("okx", raw_inst_id)`, which for `okx` is `raw.replace("-", "")` [VERIFIED: exchange.py:1034-1038 region, quoted `return raw.replace("-", "")` under `if exch == "okx":`]. `ETH-USDT-SWAP` becomes `ETHUSDTSWAP`.
3. `side = fill.get("side", "").lower()`.
4. `price` and `fillSz` through `_finite_positive_decimal` (non-finite or non-positive: dropped).
5. Linear SWAP/FUTURES with settle in `("USDT", "USDC", "BUSD", "USDE", "PYUSD", "USDB")`: `amount = fill_sz_contracts * Decimal(str(_ct))` with `_ct = _okx_contract_size_for_inst_id(raw_inst_id, exchange)`; stamps `fill.setdefault("_ingest_ctval", _ct)` when `_ct != 1.0`; an inverse settle keeps contracts. SPOT/MARGIN keep `fillSz`.
6. Re-validates the post-rescale amount.
7. `fee` through `_finite_decimal(fill.get("fee", 0))`, default `Decimal("0")`; `fee_currency = fill.get("feeCcy", "USDT")`; `_check_fee_currency_mismatch(...)`; `is_maker = fill.get("execType", "") == "M"`.
8. `raw_data = dict(fill)`; `posSide` kept if in `_OKX_VALID_POS_SIDES`; `position_direction` is `long`/`short` only when `posSide` is not `net`.
9. `_make_fill_dict(exchange="okx", symbol, side, price, quantity=amount, fee, fee_currency, timestamp=ts_dt.isoformat(), exchange_order_id=fill.get("ordId", ""), exchange_fill_id=fill.get("tradeId", ""), is_maker, raw_data, position_direction)`.

The factory returns 15 keys: `exchange, symbol, side, price, quantity, fee, fee_currency, timestamp, order_type, exchange_order_id, exchange_fill_id, is_fill, is_maker, cost, raw_data` (`FillRow`, exchange.py:917; `_make_fill_dict`, exchange.py:1050; the docstring says "16-key" but the `FillRow` TypedDict lists 15) [VERIFIED: exchange.py:917-941 field list read this session]. Money fields are numeric strings, `cost = price * quantity`.

### Contract-size table
```
_OKX_INGEST_CONTRACT_SIZE: dict[str, float] = {
    "BTC-USDT": 0.01,
    "ETH-USDT": 0.1,
    ...
```
[VERIFIED: exchange.py:443-445.] ETH-USDT is `0.1`, the only instrument in PROD's archive range. An instId prefix outside the table makes `_okx_contract_size_for_inst_id` fall back to `exchange.markets` and then to `1.0` plus `_record_dq_flag("okx_unknown_ctval", True)`. In the archive job nothing drains that flag, so the mapper must check the prefix against the table itself and stop `unknown_contract_size` by name.

OKX can change a contract's `ctVal` over time. The table is a present-day constant applied to 2026 H1 bills. The overlap reconciliation only proves it for the overlap window [ASSUMED, A5].

### `raw_data` is trimmed
`_RAW_DATA_KEEP_KEYS` keeps `posSide, position_direction, instType, category, execType, feeCcy, feeCurrency, _ingest_ctval` [VERIFIED: exchange.py:971-981 region read this session] and `_trim_raw_data` drops everything else unless `EXCHANGE_STORE_RAW_DATA=1`. An archive-source key passed in `raw_data` is therefore dropped. Two ways: extend the whitelist (edits shared money-path code) or set the key AFTER the factory returns (recommended: `row["raw_data"] = {**(row["raw_data"] or {}), "source": "okx_bills_history_archive"}`). The value string `okx_bills_history_archive` is the one the rebuild RPC already uses as `c_source` [VERIFIED: supabase/migrations/20261026120000_okx_archive_rebuild.sql, `c_source CONSTANT text := 'okx_bills_history_archive';`], so the literal is shared, not invented.

### Write path (inside `run_sync_trades_job`)
```
ctx.supabase.table("trades").upsert(
    [{"strategy_id": strategy_id, **fill} for fill in batch_rows],
    on_conflict="strategy_id,exchange,exchange_fill_id",
    ignore_duplicates=True,
).execute()
```
[VERIFIED: job_worker.py:2965-2972 region, 100 per batch, `for i in range(0, len(raw_fills), 100)`]. The unique index is `CREATE UNIQUE INDEX "trades_dedup_fill" ON "public"."trades" USING "btree" ("strategy_id", "exchange", "exchange_fill_id")` [VERIFIED: supabase/schema/baseline.sql:17381]. `trades.side` has `CHECK (("side" = ANY (ARRAY['buy'::"text", 'sell'::"text"])))` [VERIFIED: baseline.sql:16191]; `trades_insert_deny` blocks client inserts, the service role writes. Legacy daily rows (`is_fill = false`) carry a NULL `exchange_fill_id`, so reconciliation queries must filter `is_fill = true` and `exchange = 'okx'`.

The write is inline in a 1,500-line handler, not a function. The archive module issues its own call of the same shape. Pin the three load-bearing literals (`"strategy_id,exchange,exchange_fill_id"`, `ignore_duplicates=True`, batch 100) with a source-text test, the repo's usual way to bind two copies.

**Never touch the fills cursor.** `last_fetched_trade_timestamp` and the re-read bound table are advanced only by `run_sync_trades_job`'s epilogue. The archive job writes older fills; it must not call `advance_sync_cursor` or `set_strategy_fills_reread_bound`.

### The seam for the chain
`run_sync_trades_job` ends with the follow-on enqueue (`_follow_on_kind = JOB_CHAIN_FOLLOW_ON["sync_trades"][0]` [VERIFIED: job_worker.py:3524]) inside a `try`, whose `except` can return `FAILED`, and a final `return DispatchResult(outcome=DispatchOutcome.DONE, trade_count=...)`. The chain call goes **after that whole `try/except` block and immediately before the final `return`**, so it runs only when the handler would return DONE, is wrapped in its own `try/except Exception` (log, never raise, never change the outcome), and imports lazily. Gate it on `ctx.key_row.get("exchange") == "okx"` and on a clean fills read (the `advance_fetched_cursor` predicate's inputs, job_worker.py:3037, are `phase2_complete`, not `phase2_failed`, not `phase1_failed`, not `phase1_read_refused`, not `_fills_incomplete`; an empty-but-clean read leaves `phase2_complete` False, so the planner decides whether a quiet account chains too; recommended: chain on clean-or-empty-clean, never on a failed or truncated read, because the reconcile assumes stored coverage from the floor).

## Q3. The archive machinery and the job shape

### What the parser keeps and drops
`ArchiveRow` holds `bill_id, sub_type, type_raw, ts_ms, day, inst_type, ccy, pnl, fee, bal_chg, bal` [VERIFIED: okx_archive_files.py:133-147]. It drops `sz, px, instId, ordId, execType, fillTime, tradeId`. Extension that changes no pin:
- Add trailing fields with defaults: `trade_id: str = ""`, `ord_id: str = ""`, `inst_id: str = ""`, `px_raw: str = ""`, `sz_raw: str = ""`, `exec_type: str = ""`, `fill_time_raw: str = ""`, filled in the one existing loop from `row[...]`. They are raw strings: no new parse, no new stop on non-trade rows.
- No test constructs `ArchiveRow(` directly (grep of `analytics-service/tests/*.py`: none), so defaulted fields cannot break a call site.
- `ArchiveRow` is a frozen dataclass whose `==` drives `duplicate_bill_conflict` across files (`earlier != row` in `aggregate_archive`, `kept[0] != row` in `verify_bal_chain`). Adding fields widens equality: two rows are equal only if the new fields are equal too. For a bill present in two adjacent files the new cells are identical (same bill), so no spurious conflict; a bill whose trade cells differ between files is now a conflict, which is correct.
- Duplicate detection inside one file compares the cell tuple (`earlier == cell_tuple`), unchanged.
- Apply the D-17 strip (`_strip_bill_id`) to `tradeId` and `ordId` as well. D-17 found the export wraps each `billId` in apostrophes or quotes; the same wrap on `tradeId` would make `exchange_fill_id` unequal to the live value. Whether the real file wraps them is unmeasured [ASSUMED, A2]. After the strip, `tradeId` must match `-?[0-9]+`; anything else is the stop `unreadable_trade_bill` carrying only a value-free shape (reuse `okx_archive_classify._bill_id_shape`) and a count. A scientific-notation id (the D-17 example `1.23E+17`) cannot be repaired and must stop.

### Reuse inventory for the job
| Need | Reuse | Note |
|------|-------|------|
| D-02 key checks (OKX, active, not disconnected, not revoked; every target on the same venue account) | `_check_keys(supabase, job, inp)` reads only `inp.target_strategy_ids`, so a `_JobInput(mode=..., quarters=(), target_strategy_ids=...)` works [VERIFIED: okx_archive_job.py:636 body, `ids = list(inp.target_strategy_ids)`] | One disconnected target key makes it raise `target_key_disconnected` for the whole job, so the fills job must FILTER disconnected siblings out of the target list first and report the skipped count, not stop on them |
| Account uid and `read_only` perm | `_check_account` | Fail-closed on a missing stored `venue_account_id` |
| Decrypt and build the client | `_allocator_key_preflight(job, ...)` | `job.api_key_id` scoped; a DEFERRED passes through |
| Apply on its own client, one attempt | `_ApplyPacer`, `_apply_quarter_on_fresh_instance` | ccxt cost 72000 stalls the next call on the same instance about 7,920 s (OKXHISTORY RESEARCH Pitfall 1) |
| Download, one fresh status read and one retry on expiry | `_download_quarter` | Closed-vocabulary stops, link never in a message |
| Wait | `_defer_job` (`defer_compute_job`, claim fenced, clamp to `MAX_DEFER_S = 3600`, 24 h backstop `BACKSTOP_AFTER_S`) | Attempts are not burned by a defer |
| Claim budget | `_ClaimBudget(CLAIM_BUDGET_S)`, `_within` | `CLAIM_BUDGET_S = TIMEOUT_PER_KIND[KIND] - CLAIM_RESERVE_S` = 900 - 60 s |
| Result writer | `_write_result` (`set_compute_job_progress`, atomic merge into `metadata.member_progress`) | The handler never writes `compute_jobs.metadata` (races the claim RPC) |

### Apply budget: the 12-per-day conflict, stated
- **What the code does now.** Every claim calls `answer = await pacer.apply(key_row, year, label)` for each quarter before reading state [VERIFIED: okx_archive_job.py:986-1010 region, `_quarter_step`, quoted `answer = await pacer.apply(key_row, year, label)`]. The wait constants are `FIRST_STATUS_READ_AFTER_S = 2 * 60 * 60`, `STATUS_POLL_INTERVAL_S = 15 * 60`, `GIVE_UP_AFTER_S = 8 * 60 * 60`, `MAX_REAPPLIES = 1`, `MAX_DEFER_S = 3600` [VERIFIED: okx_archive_job.py:198-210].
- **What that costs under 12 per day.** A 3-quarter job claims at t=0, about 1 h and about 2 h (defers are capped at an hour), then every 15 min while OKX generates: 3 applies per claim, so 9 by the third claim and the 12th at the fourth, about 2 h 15 min in. After that OKX would answer a rate-limit error and the existing handler defers 15 min on it, so the job survives but spends the whole day's budget, shared with every other apply on that OKX user ID.
- **What is unmeasured.** Whether an apply that answers `result: true` ("already exists") consumes budget. PROD only ever recorded `applied_existing` true (OKXHISTORY plan 12 summary), which does not say.
- **Assumption for this design.** Budget 12 per day, idempotent re-applies counted [ASSUMED, A3], because it is the stricter reading and the cost of assuming it is one extra GET per claim.
- **What breaks under the other reading (1 per 10 s per user).** Nothing: GET-first just never uses the headroom.
- **The fills-job quarter step (GET first):** read state. `finished` with a link: ingest. `ongoing`: defer. No entry (`data: []`), or `failed`: apply once on a fresh client, then defer to the 2 h mark. Re-apply once more only when the download answers expired twice (`link_expired`), because whether a GET after the 5.5 h link life issues a fresh link without a re-apply is unmeasured [ASSUMED, A4]. Reuse `_record_ready`, `_age_s` and `MAX_REAPPLIES`; the age bounds (8 h from OKX's `ts`, 24 h from the job's own `created_at`) are unchanged.
- **GET on a never-applied quarter is unmeasured** [ASSUMED, A6]. The existing `_read_quarter_status` returns `state=None` for a response with no entry and the existing `_quarter_step` treats that as contract drift (`archive_request_failed`). The fills step must treat "no entry" as "never requested" and apply, but still treat a non-mapping or an unknown `state` word as `archive_request_failed`.
- **Budget on the PROD run:** Q1 2026 was never applied, and the OKXHISTORY requests for Q2 and Q3 are older than 30 days now, so assume 3 applies for the dry run and 3 for the apply if links expire between them: 6 of 12 worst case, plus at most 3 on expiry.

### Job input and which strategies it serves
The job needs no strategy list and no quarter list in its metadata. Reasons: (1) the in-flight index is per `api_key_id` and the enqueue dedupe returns the existing row, so a second strategy of the same key that enqueues while one is pending would have its metadata dropped (the dedupe is recorded in `compute_job_dedup_events` but not honoured); (2) the quarters are a function of data and the clock.

Metadata: `{"mode": "fills_apply"}` or `{"mode": "fills_calibrate"}`, with optional `fill_strategy_ids` (uuid list) and `quarters` overrides for manual runs, validated like `_uuid_list` / the existing quarter checks (a quarter must have ended: `end_exclusive <= today` UTC, the rule `_read_job_input` already applies).

**Targets, in the claim:** read the job key's `venue_account_id` and exchange from `api_keys` (`_KEY_COLUMNS` already selects both); select every `api_keys` row with exchange `okx`, the same non-blank `venue_account_id`, connected (`is_active` true, `disconnected_at` null, `sync_status != 'revoked'`); select `strategies` with `api_key_id` in those keys. `strategies.api_key_id` and `strategies.status` (`draft, pending_review, published, archived, private`) exist [VERIFIED: baseline.sql strategies table, `"api_key_id" "uuid"` and the `strategies_status_check`]. Status filter is the planner's call (recommend: exclude `archived`; keep `draft`, because the wizard's first sync is exactly when a new strategy needs this). Then `_check_keys` + `_check_account` verify the uid for all of them. A key with a NULL `venue_account_id` can never match (fail-closed) and its strategies are simply not served.

**Which key per account:** the chain enqueues for the syncing strategy's own key. With several keys on one account there can be several jobs; they read the same account-level OKX request state, so the first applies and the others read `ongoing` or `finished` (GET-first), and each job's early exit (every target already reaches its anchor) makes the redundant ones cheap. No election is needed; the in-claim target discovery makes the dedupe loss harmless.

### Which quarters
Per strategy: `anchor_ms` = start of the earliest `csv_daily_returns.date` (UTC day), or the earliest stored OKX fill if earlier (recommended; the planner picks, per CONTEXT). `M` = `_okx_fills_begin_floor_ms(now) + 86_400_000` (one day above the floor, the margin the reach rule's vagueness needs). A quarter is needed when its cut range `[start 00:00 UTC+8, end 00:00 UTC+8)` (the parser's `_QUARTER_CUT_UTC_OFFSET_MS = 8 * 3_600_000` [VERIFIED: okx_archive_files.py:104]) intersects `[anchor_ms, M)` OR is the reconciliation quarter (it contains `M` and has ended), and it has ended, and it is not before 2021 Q1 (OKX: "since 1 February, 2021"). The job's quarter set is the union over targets. The current quarter is never requested; a span between the current quarter's start and `M` that neither source covers is reported as `unreachable_span`, not hidden. Worked case on the PROD shape: first daily returns in Feb and Apr 2026, `M` about 2026-08-29, today 2026-11-27: Q1, Q2, Q3 2026; Q4 not yet over.

The files cut at 00:00 UTC+8, so the first UTC day of a file and the last UTC day of its predecessor are split between two files. The mapper works on instants (`ts_ms`), not UTC days, so the split is harmless for fills; only the adjacency rule in `verify_bal_chain` (the shared edge day) matters, and the job must request adjacent quarters together so the seam is chained.

### Trigger (the data-derived chain, and what "covered" means)
There is no durable per-strategy coverage record today. Checked: `okx_archive_job` is stateless by design; `compute_jobs` rows are pruned (`done` after 30 days, `failed_final`/`failed_retry` after 90) [VERIFIED: supabase/migrations/20260417110539_retention_crons.sql:276-303, `created_at < now() - interval '30 days'` and `'90 days'`]; `strategy_fills_reread_bounds(strategy_id, api_key_id, unread_from, updated_at)` is a re-read lower bound, not a coverage record [VERIFIED: baseline.sql:CREATE TABLE ... "strategy_fills_reread_bounds"]; `series_provenance.reconstructed_ranges` is the DAILY-return rebuild's record and is written under the rebuild RPC's row lock.

Recommended trigger, no schema change:
```
needs_archive(strategy) :=
    exchange is okx
    AND anchor_ms exists AND anchor_ms < M
    AND earliest stored OKX fill (is_fill, exchange 'okx') is later than anchor_ms + 2 days
    AND no okx_archive_rebuild job of mode fills_apply (never fills_calibrate) on this api_key was
        created in the last 14 days that is in flight, done, or failed_final with a NAMED
        permanent stop (not invalid_input)
```
- After a successful backfill, the earliest stored fill reaches the anchor, so the second term turns false; the cooldown (14 days, under the 30-day `done` retention) covers a quiet-start account whose first real fill is more than 2 days after its first daily return and any permanent stop (`empty_file` for a pre-account quarter, a refused instType). Worst case that account re-reads once per cooldown, GET-first, so about 0 applies while OKX's 30-day request validity holds.
- The durable alternative is a small marker table plus an RPC, which is a migration, and then the "no migration" advantage of the mode design is gone. Recommend it only if a monthly re-read of a quiet-start account is unacceptable. [Open Question 2]
- Chain edge placement: do NOT add the kind to `JOB_CHAIN_FOLLOW_ON`. That constant is "load-bearing" (production enqueue sites read it, `[0]` is read at job_worker.py:3524) and feeds `TestReaperThresholdInvariant`. The file already records the precedent for a cross-target re-entry that is "not a parented follow-on, so this map and TestReaperThresholdInvariant stay unchanged" (the key-mode linked-strategy re-entry, job_worker.py comment above `JOB_CHAIN_FOLLOW_ON`). The api_key-scoped archive job never holds a `strategy_analytics` row `computing` (OKXHISTORY plan 07 rationale in `test_main_worker.py`), so the reaper ceiling is unchanged. The existing pin `assert "okx_archive_rebuild" not in chain` and `all("okx_archive_rebuild" not in tail for tail in chain.values())` [VERIFIED: tests/test_okx_archive_job.py:411-413] stays green.
- Deploy order: the mode names are unknown to an old worker, which would end a claimed fills job as `invalid_input` (permanent). During a rolling deploy a new instance's chain can enqueue a job an old instance claims. That `failed_final` must not count as "answered" in the cooldown (hence the "NAMED permanent stop, not invalid_input" clause), and the next sync re-chains.

### New kind: what it would cost (if the planner overrides the recommendation)
| Site | Evidence |
|------|----------|
| `compute_job_kinds` row; `compute_jobs_kind_check` list (17 kinds ending `'okx_archive_rebuild'::text`); `compute_jobs_kind_target_coherence` api_key arm. The latest definition of both is `20261026120000` (grep of migrations naming either constraint: nothing later; `20261103120000` only mentions the registry row of a retired kind) | [VERIFIED: supabase/migrations/20261026120000_okx_archive_rebuild.sql] |
| `TIMEOUT_PER_KIND` entry and `len(TIMEOUT_PER_KIND) == 16` pin, which must be bumped consciously | [VERIFIED: job_worker.py:1097 and tests/test_main_worker.py, quoted `assert len(TIMEOUT_PER_KIND) == 16`] |
| `WATCHDOG_PER_KIND_OVERRIDES`: `"okx_archive_rebuild": "30 minutes",  # handler timeout = 15 minutes`; `BACKFILL_KINDS` is `("derive_broker_dailies", "derive_allocator_equity")` and must not gain the kind | [VERIFIED: main_worker.py:404 and :252-255] |
| Dispatch arm | job_worker.py:19681 |
| `src/lib/display-labels.ts` `COMPUTE_JOB_KIND_LABELS` has `okx_archive_rebuild: "OKX history rebuild"` | [VERIFIED: display-labels.ts:62] |
| TS `JobKind` in `src/lib/types.ts` lists only `"sync_trades" \| "compute_portfolio" \| "poll_positions"`: not a kind census. `database.types.ts` and the admin route read kinds from the registry table | [VERIFIED: src/lib/types.ts:1911; admin route reads `compute_job_kinds`] |
| Reference-data replay: `scripts/restore-test-refdata-allowlist.txt` line `20261026120000_okx_archive_rebuild.sql	public.compute_job_kinds	1`, its pinned counts (`23 ENTRIES over 20 FILES`), `scripts/restore-test-from-baseline.sh` (kinds comment "SEVENTEEN kinds"), `src/__tests__/refdata-allowlist.test.ts`, `src/__tests__/restore-test-from-baseline.test.ts` (the `23, not 22` count) | [VERIFIED by grep of those files for `okx_archive_rebuild`] |
| After the PROD apply: baseline re-dump PR (`supabase/schema/baseline.sql`, `baseline-carried-migrations.txt`, `BASELINE.md`), as `db51435e2` did for a prior migration | [VERIFIED: git log of origin/main] |
| Ship ordering: migration first and applied to PROD before the code that enqueues the kind (an enqueue of an unadmitted kind violates the CHECK and the registry FK) | design fact |

The mode design avoids every row above. Its price is the shared per-key in-flight slot: a fills job waiting up to 24 h would make a founder-run rebuild enqueue on the same key return the fills job's id (the runbook readback `this_run_jobs` would read 0, so it fails loudly), and a pending rebuild would swallow a chain enqueue for that sync cycle (the next sync re-chains). Both are rare, founder-visible and recorded in `compute_job_dedup_events`.

## Q4. Phase 256 OKXUNITSWITCH overlap (three-dot diff of its branch, symbols not line numbers)

Measured by `git diff origin/main...HEAD` in the Phase 256 worktree (branch `gsd/phase-256-okxunitswitch`, plans 01 to 05 have SUMMARYs; plans 06 to 10 do not, so treat the lists as lower bounds).

- `analytics-service/services/exchange.py`: hunks in the import block, after `get_and_clear_last_dq_flags` (new side channels), in `_okx_bills_window_read` / `fetch_daily_pnl`, in `fetch_all_trades`, and around `fetch_okx_total_equity_and_upl_usd`. **None in `_fetch_raw_trades_okx_inst_type`, `_fetch_raw_trades_okx`, `_okx_fills_begin_floor_ms` or `_OKX_INGEST_CONTRACT_SIZE`.**
- `analytics-service/services/job_worker.py`: hunks in the `from services.exchange import (` block and the line after it, near `_realized_refusal_token`, near `_read_okx_option_refusal_once_per_day`, and throughout `run_derive_broker_dailies_job`. **None in `run_sync_trades_job`, `TIMEOUT_PER_KIND`, `JOB_CHAIN_FOLLOW_ON`, or the `dispatch` arms.**
- Plans 06 and 09 (not yet summarised) list `job_worker.py` for the derive path only; plan 03 lists `okx_archive_job.py` as READ context ("keep refusing") and requires `test_okx_archive_job.py` to pass unchanged.
- `okx_archive_job.py`, `okx_archive_files.py`, `okx_archive_classify.py`, `main_worker.py`: no Phase 256 hunk.

Overlap risks and how to keep this phase small:
1. `exchange.py`: textual hunks do not overlap; keep the extraction to the loop body of `_fetch_raw_trades_okx_inst_type` and do not touch imports (the mapper imports the helper lazily or from its own module-level import in the NEW module, not in `exchange.py`).
2. `job_worker.py`: one call site at the tail of `run_sync_trades_job` with a **lazy import inside the helper** (the shared import block stays untouched; this is what Phase 256 edits).
3. `okx_archive_job.py` must keep `test_okx_archive_job.py` green unedited (Phase 256 plan 03 depends on it): the 4-line fork must not change `result["mode"]` echo, the `"nonsense"`/`None` invalid-input behaviour, or the existing import list.
4. Semantic overlap: Phase 256 changes OKX unit handling for the BILLS path (switched accounts book coin bills). Fills quantities are unaffected. But a switched account's Q4 file will carry coin-denominated fee bills; the fills job must not depend on `aggregate_archive`'s `non_usd_ccy` stop (Pitfall 9) so a Q4 read is not blocked by the same bills.
5. Merge order: this phase's `exchange.py` diff is a pure extraction (behaviour-preserving); if 256 merges first nothing conflicts, if 259 merges first 256 rebases over untouched regions.

## Validation Architecture (Q5)

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 8-series via `analytics-service/requirements-dev.txt`, `asyncio_mode = auto` (`pytest.ini`) |
| Config file | `analytics-service/pytest.ini` (`testpaths = tests`, `pythonpath = .`); mypy strict via `[tool.mypy]` in `analytics-service/pyproject.toml` |
| Quick run command | `cd analytics-service && python -m pytest tests/test_okx_archive_fills_map.py tests/test_okx_archive_fills_job.py tests/test_okx_archive_fills_chain.py -x -q` |
| Full suite command | `cd analytics-service && make test` (CI runs serial pytest with coverage `--cov-fail-under=80`) and `make typecheck` (mypy strict over `services/ routers/ models/`) |
| Rules | pytest only from `analytics-service/`; never `importlib.reload` in tests; `grep -a`; no `git checkout/restore/stash` on uncommitted work (restore neutered files from a byte backup with `cp`, prove with `cmp`) |

mypy strict is a CI gate: every new module needs complete annotations; ccxt/pandas are `Any`. Add the new modules to the Makefile typecheck path set only if it lists files (it lists directories).

### Phase Requirements to Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|-------------|
| SC-1 | For each subType 1 to 6 the mapped row equals the live normaliser's row for the same logical fill on every key (`symbol`, `side`, `price`, `quantity`, `fee`, `fee_currency`, `timestamp`, `exchange_order_id`, `exchange_fill_id`, `is_maker`, `cost`, `raw_data` except the source key); ETH ctVal 0.1; `posSide` net/long/short and `position_direction`; `raw_data["source"]` present | unit | `pytest tests/test_okx_archive_fills_map.py -x` | Wave 0 |
| SC-1 | Extracted live helper is behaviour-preserving: a golden of fills-history-shaped inputs recorded BEFORE the extraction, replayed after | unit (golden) | `pytest tests/test_exchange.py -k "Okx or okx" -x` plus the new golden | existing + Wave 0 |
| SC-2 | Reconcile arms, one named RED each: size differs, price differs, fee differs, side differs, timestamp differs (both candidate columns reported), stored fill absent in archive, archive bill absent in stored, count mismatch, duplicate `tradeId` in the file | unit | `pytest tests/test_okx_archive_fills_job.py -k reconcile -x` | Wave 0 |
| SC-2 | Unproven `instType` (SPOT, MARGIN, FUTURES, OPTION) with a `tradeId` is `unproven_inst_type` and writes nothing; trade-shaped bill of an unmapped subType (for example 104) is `unmapped_trade_subtype`; blank or non-digit `tradeId`/`px`/`sz` on subType 1 to 6 is `unreadable_trade_bill`; unknown ctVal prefix is `unknown_contract_size` | unit | same file, `-k refuse` | Wave 0 |
| SC-3 | Second run stores nothing new (a fake `trades` table that emulates `trades_dedup_fill`); a quarter that fails parse, chain or reconcile leaves its span named in the result and writes zero rows for it; other quarters' outcome recorded independently; the three upsert literals pinned by a source-text test | unit | `-k idempotent`, `-k span` | Wave 0 |
| SC-4 | The chain seam: called after the follow-on enqueue, never before; its exception leaves the sync outcome DONE and unchanged; non-OKX never calls it; `JOB_CHAIN_FOLLOW_ON` and the `not in chain` pins unchanged; the job returns DEFERRED (never awaits the 2 h) while a quarter is `ongoing`; a log and `last_error` scan with sentinel link, `ts` and amount values finds none (reuse the `LINK_SECRETS` idea of `test_okx_archive_job.py`) | unit | `pytest tests/test_okx_archive_fills_chain.py -x` and `-k wait` in the job file | Wave 0 |
| SC-4 | GET-first: with an `ongoing` or `finished` answer the fake exchange records zero apply calls; with no entry exactly one apply on a separate instance that is the last call on it; `failed` applies once per claim; 3 quarters over a simulated 6 claims never exceed the bound | unit | `-k apply_budget` | Wave 0 |
| SC-5 | PROD backfill and before/after report | manual, PROD read by MCP, marker query first | runbook in the PLAN | n/a |
| SC-6 | PROOF-01 neuter table below | neuter, RED, `cp` restore, `cmp`, GREEN | the same commands, recorded verbatim in the SUMMARY | Wave 0 |
| Pins | Existing parser, job, apply, rebuild and main_worker tests stay green UNEDITED after the `ArchiveRow` extension and the fork | regression | `pytest tests/test_okx_archive_parse.py tests/test_okx_archive_job.py tests/test_okx_archive_apply.py tests/test_okx_archive_rebuild.py tests/test_okx_archive_reconcile.py tests/test_okx_archive_download.py tests/test_main_worker.py -x` | existing |

### PROOF-01: which tests can go RED on pre-fix code, and the neuter copies
On pre-fix code the new modules do not exist, so a test that merely imports them is RED by ImportError, which proves nothing. Each gate therefore needs a neutered copy with its named arm first:
| Gate | Neuter | Must go RED first |
|------|--------|-------------------|
| side map | swap subType 5 and 6 | the subType-parametrized mapping arm for 5 (named) |
| ctVal | skip the `* ctVal` rescale | the ETH quantity arm |
| timestamp column | read `fillTime` instead of `ts` (or the reverse) | the timestamp equality arm |
| reconciliation | drop the size or the fee comparison | the matching mismatch arm |
| count equality | compare matched pairs only | the count-mismatch and archive-only-bill arms |
| unproven instType | add `SPOT` to the proven set | the refusal arm |
| unmapped subType | treat 104 as mapped | the `unmapped_trade_subtype` arm |
| duplicate tradeId | remove the pre-upsert check | the duplicate arm (the fake table would silently absorb) |
| GET-first | apply before reading | the zero-apply arm |
| extraction | change the helper's ctVal or ts handling | the golden and the live `test_exchange.py` OKX arms |
| chain seam | call before the follow-on enqueue, or let it raise | the ordering and outcome arms |
| write literals | change `ignore_duplicates` or `on_conflict` | the source-text pin |

### Censuses a recommended-design change moves (grep before editing)
- Moves: nothing in SQL, nothing in `TIMEOUT_PER_KIND` (stays 16), nothing in `JOB_CHAIN_FOLLOW_ON`, `WATCHDOG_PER_KIND_OVERRIDES`, `BACKFILL_KINDS`, refdata allowlist or `display-labels.ts`.
- Moves: `ArchiveRow` field list (no test enumerates it; `ArchiveAggregate.__dataclass_fields__` is checked in `test_okx_archive_parse.py`, a different class).
- Moves: `ci.yml` has no per-file test list for pytest, so new test files are picked up by `testpaths`. `scripts/mutation-floors.mjs`, the SQL gate censuses and `supabase/tests/` do not move (no migration).
- If a new kind is chosen instead: the full table in "New kind: what it would cost", plus `supabase/tests/` arms for the migration (new files move several censuses, grep them all).

### Sampling Rate
- **Per task commit:** the quick command above plus `python -m mypy --config-file=pyproject.toml <new modules>`.
- **Per wave merge:** the Pins row plus `make typecheck`.
- **Phase gate:** full suite green and a PROD `fills_calibrate` result block read, before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/fixtures/okx_archive/q*_trades.csv`: NEW fixtures with trade cells (real header; the existing `q2_like.csv`/`q3_like.csv` have blank `sz`, `px`, `tradeId` on subType 1 and 2 rows and must not be edited).
- [ ] A fake `trades` table with `trades_dedup_fill` semantics and a fake supabase client shared by the job and chain tests.
- [ ] A golden of the live normaliser's output recorded on pre-extraction code.
- [ ] `tests/test_okx_archive_fills_map.py`, `test_okx_archive_fills_job.py`, `test_okx_archive_fills_chain.py`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fill row construction | A second copy of the OKX normaliser | An extracted pure helper in `exchange.py` called by both paths, then `_make_fill_dict` | Two copies drift (the repo's own G12.B.4 note); contract-size, `posSide` whitelist, Decimal guards and fee-currency checks all live there |
| Download | A second HTTP client | `download_archive_csv` | SSRF-safe exact host allow-list `{"okg-pri-hk.oss-cn-hongkong.aliyuncs.com"}` [VERIFIED: okx_archive_download.py:66-68], size and ratio caps, IP vetting |
| Completeness | A new continuity check | `verify_bal_chain` | OKXHISTORY calibrate run 5 passed it on the real Q2 and Q3 files |
| Wait | A sleep inside the claim | `defer_compute_job` via `_defer_job` | A held claim blocks the worker and the watchdog resets at 30 min |
| Idempotency | A pre-insert existence probe | `trades_dedup_fill` plus `ignore_duplicates` | The index is the arbiter; a probe races |
| Account match | A new identity rule | `_check_keys` + `_check_account` | OKX uid versus stored `venue_account_id`, fail-closed |

**Key insight:** every dangerous edge here (wrong account, wrong quarter, partial file, wrong units) already has a named gate in the OKXHISTORY path. The new work is the mapping and its proof, not new plumbing.

## Common Pitfalls

### Pitfall 1: The real CSV may not populate the trade cells
**What goes wrong:** the committed fixtures have blank `sz`, `px`, `tradeId`, `fillTime`, `ordId` on subType 1 and 2 rows; the real Q2 and Q3 files were counted and chained by OKXHISTORY but never inspected for those cells. The ROADMAP's field list is the docs', not a measurement.
**How to avoid:** the first PROD step is `fills_calibrate`, which writes nothing and returns a value-free census: trade-bill counts by `instType` and subType, how many have a readable digit `tradeId`, `px`, `sz`, `fillTime`, `ordId`, the `tradeId` shape tokens, and the reconcile reading.
**Warning signs:** `unreadable_trade_bill` on the first calibrate. That is the phase learning its premise is wrong; stop and return to the founder.

### Pitfall 2: The apply budget
Covered in Q3. Never copy `_quarter_step`'s apply-every-claim into the fills job.

### Pitfall 3: Link expiry between the dry run and the apply run
A link lives 5.5 h. A `fills_calibrate` followed hours later by the chained `fills_apply` reads `finished` with a dead link. The download path does one fresh status read and one retry, then `link_expired` (transient). Plan the PROD apply immediately after the calibrate finishes, or accept one extra apply per quarter.

### Pitfall 4: Reconcile window edges and a moving floor
`fills-history`'s reach is "the last 3 months" and the floor moves daily. Write only bills before `M = floor + 1 day`; reconcile only bills at or after `M` and before the file's cut end. Stored fills before the strategy's last clean read floor are incomplete (the old one-page pager left 100 to 200 rows over 3 to 10 days), so comparing the whole file against stored rows would mismatch by construction. The overlap shrinks daily and is empty after about 2026-12-29; later runs reconcile nothing and rely on the bal chain plus the per-`instType` proof recorded at ship (see Open Question 3).

### Pitfall 5: Duplicate `tradeId`
`ignore_duplicates` hides a second bill with the same `tradeId` (spot can produce one bill per currency under one `tradeId`; negative ids mark liquidation and ADL). Check uniqueness over trade bills before the upsert and stop `duplicate_trade_id`.

### Pitfall 6: Fee currency
The CSV has `ccy`, not `feeCcy`. For a linear USDT-margined SWAP they coincide, so synthesize `feeCcy` from `ccy` and include `fee_currency` in the reconcile equality; a mismatch stops. Do not synthesize it for any other `instType` (those are refused anyway).

### Pitfall 7: Topology and reaper pins
Adding the kind to `JOB_CHAIN_FOLLOW_ON` or to `TIMEOUT_PER_KIND` moves `test_main_worker.py`'s `== 16` pin and the reaper ceiling, and breaks `test_okx_archive_job.py`'s `not in chain` pins. Neither is needed in the recommended design.

### Pitfall 8: A quarter-edge fill belongs to one file only
Because of the UTC+8 cut, a fill at 2026-09-30T20:00Z is in the Q4 file, not Q3. The mapper must key everything on `ts_ms` instants; never assign a bill to a quarter by its UTC day.

### Pitfall 9: `aggregate_archive` is not the fills job's friend
It raises `non_usd_ccy`, `unknown_subtype_nonzero` and `subtype_map_drift`, which are daily-rebuild concerns. Compute `summed_ccys` in the fills module as the set of `ccy` values with a nonzero `pnl`, `fee` or `balChg` on any bill, and pass it to `verify_bal_chain`. A chain break or `too_few_pairs` (floor `MIN_CHAINED_PAIRS = 2` [VERIFIED: okx_archive_classify.py:82]) still stops, which is the proof this phase wants.

### Pitfall 10: Silent partial write on a claim timeout
A 100-row batch loop can run past `CLAIM_BUDGET_S`. Wrap writes in `_within(budget, ..., step="write")`; the transient `claim_budget_exceeded` retries statelessly and the upsert resumes idempotently. A batch failure after some batches must surface (never swallow like the live `phase2_failed` path does silently into a cursor hold): the job reports `inserted_before_failure` counts and ends FAILED transient.

### Pitfall 11: The 00:00 to 01:45 UTC window
The OKXHISTORY go-live runbook says the enqueue forms refuse inside 00:00-01:45 UTC (the daily derive chain window, moved 2026-10-26). Schedule the PROD enqueues outside it.

## Code Examples

No implementation is written in this phase. The load-bearing shapes the planner needs, verbatim from the live code:

```
# Live write call (job_worker.py run_sync_trades_job, Phase 2): the archive write must have this shape.
ctx.supabase.table("trades").upsert(
    [{"strategy_id": strategy_id, **fill} for fill in batch_rows],
    on_conflict="strategy_id,exchange,exchange_fill_id",
    ignore_duplicates=True,
).execute()
```
```
# subType -> (side, posSide) the mapper commits (CONTEXT), for subTypes 1..6 only
1: ("buy",  "net")    2: ("sell", "net")
3: ("buy",  "long")   4: ("sell", "short")
5: ("sell", "long")   6: ("buy",  "short")
```
```
# A fills-history-shaped dict the mapper synthesizes from an ArchiveRow, handed to the extracted live helper
{ "instType": row.inst_type, "instId": row.inst_id, "side": side, "posSide": pos_side,
  "fillPx": row.px_raw, "fillSz": row.sz_raw, "fee": str(row.fee), "feeCcy": row.ccy,
  "ts": str(row.ts_ms), "ordId": row.ord_id, "tradeId": row.trade_id, "execType": row.exec_type }
```
The helper returns the `FillRow` or `None` (a drop). In the archive path a `None` is a named stop (`unreadable_trade_bill`), never a logged skip: the live path may drop-and-log a bad fill, but a bad fill missing from a quarter published as complete is exactly the silent-partial class the founder rejected.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `trade/fills-archive` (2 years) | delisted; only `bills-history-archive` reaches old spans | 2024-09-18 (changelog) | the only documented source for this phase |
| Apply POST 12 per day | "1 request per 10 seconds per user" per changelog; endpoint page still says 12 per day | 2026-06-11 changelog; page unchanged at 2026-11-27 | design to the stricter reading (A3) |
| OKX pager `after=tradeId` | `after=billId` | Phase 255 | why PROD recovered fills only to about 2026-08-27 |

**Deprecated/outdated:** the CONTEXT/ROADMAP line "12 a day per user ID" is the endpoint page's text; the changelog supersedes it only if the page is stale. Unresolved.

## Runtime State Inventory

Not a rename or migration phase. Omitted. (State written: `public.trades` rows and one result block per job; no schema, no registration, no secrets, no build artifact.)

## PROD backfill (Q7)

Facts used, as given (not re-measured): three OKX strategies, apparently one account; archive-range fills all SWAP ETH-USDT-SWAP, `posSide` net, subType 1 buy, 2 sell; `exchange_fill_id` = `tradeId` on 200 of 200 full-payload rows; stored pre-2026-08-27 fills 100, 106 and 200 rows over 3, 10 and 9 days; first daily returns 2026-02-23 and 2026-04-30; Q2 2026 (596 bills, first 2026-03-31) and Q3 2026 (1,010 bills, through 2026-09-30) read from the allow-listed host; Q1 never read.

Sequence (marker query first on every write; PROD reads by MCP, one query per call, never chained; the `fills_*` enqueues avoid 00:00-01:45 UTC):
1. Deploy the worker code (analytics deploys only after main CI is green). Nothing runs by itself yet except the new chain, which is gated by the trigger and the cooldown.
2. **Before** (read-only): per strategy `count(*)`, `min(timestamp)`, `max(timestamp)` of `trades` where `is_fill` and `exchange = 'okx'`, plus `count(*) filter (where raw_data->>'source' = 'okx_bills_history_archive')`. Record in the SUMMARY by strategy ordinal, never by id.
3. **Dry run:** `enqueue_compute_job(p_kind => 'okx_archive_rebuild', p_api_key_id => <one OKX key>, p_strategy_id => NULL, p_metadata => '{"mode":"fills_calibrate"}')`. One job covers all three strategies (targets are derived in-claim). Expect about 2 h to the first status read (OKX documents 2 h, up to 3 at peak), then 15 min polls, 8 h give-up from OKX's `ts`, 24 h backstop from `created_at`. Apply cost: up to 3 (Q1 never applied; Q2 and Q3 older than 30 days). Read the result block at `metadata->member_progress`: census, `bal_chain`, reconcile per strategy, would-insert counts per strategy, the `tradeId` shape tokens, and which archive column matched `timestamp`.
4. Decide on the reading: proceed only if the calibrate is clean (no `unreadable_trade_bill`, reconcile equal on the Q3 overlap, `ts` column settled). The proven-`instType` constant (SWAP) is set from this reading. A bad reading returns to the founder; nothing was written.
5. **Apply through the product's path:** `enqueue_compute_job` for `sync_trades` per strategy, exactly as Phase 255 did. Each finished sync reaches the chain seam; the trigger is true (earliest stored fill is months after the anchor and no `fills_apply` job is within 14 days). **Trap:** the dry run's `done` `fills_calibrate` job must not count toward the cooldown, or the backfill would never chain; the cooldown reads `fills_apply` jobs only. The chained `fills_apply` finds the quarters `finished` (GET-first, no apply) if within the 5.5 h link life of the calibrate, else it applies again (up to 3 more of the 12). It downloads, gates, reconciles and writes for all three strategies in one claim.
6. **After:** repeat step 2. Report fills before and after per strategy, the earliest stored fill versus each strategy's anchor, rows written by quarter, and the spans left unwritten with their names (for example a quarter before the account existed: `empty_file`; the span from the current quarter's start to the floor: `unreachable_span`).
7. A second `fills_apply` (or a repeat `sync_trades`) must insert zero rows (SC-3, idempotency on PROD).
Recompute: archive fills are older than the floor; the daily-return series comes from bills, so no `derive_broker_dailies` is chained by this phase (CONTEXT: writes fills only). Fills-based readers (position reconstruction, trade views) pick the rows up on their next read; nothing here recomputes `strategy_analytics`.

Budget arithmetic: dry run 3 applies, apply run 0 to 3, expiry fallback up to 3 more: at most 9 of a 12-per-day budget, if the founder does not run anything else against the same OKX user ID that day.

## Security Domain

`security_enforcement` is absent from `.planning/config.json`, so it is treated as enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | no new credential path; the existing decrypted read-only key |
| V4 Access Control | yes | D-02: OKX key, active, connected, uid equals stored `venue_account_id` for the job key and every target; `perm` contains `read_only`; disconnected siblings filtered, never written for |
| V5 Input Validation | yes | the CSV is untrusted: strict header pin, quarter cut, `tradeId` regex `-?[0-9]+` after the D-17 strip, `Decimal` parse with the existing bounded plain-decimal rule, tradeId uniqueness |
| V7 Error Handling and Logging | yes | no link, request `ts`, amount or uid in a log, `last_error` or exception text; `ArchiveParseError.detail` is counts and dates only; scrub with `scrub_freeform_string` where venue text is logged |
| V10 SSRF / outbound | yes | `fileHref` only through `download_archive_csv` (exact host allow-list, https only, IP vetting); a Q1 file served from a host not in the list stops `download_refused` and the host is added by review, never by metadata |
| V12 Files and Resources | yes | existing caps (64 MiB compressed, 512 MiB inflated, ratio 100), no extraction to disk |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| A forged or truncated archive written as trade history | Tampering | bal chain plus per-strategy overlap reconcile before any write; byte-exact mapper proof |
| Another account's file attributed to a strategy | Spoofing | uid equality for every target; targets derived from the job key's own `venue_account_id` |
| Cross-user write via a shared OKX account | Elevation | writes only for strategies whose key is connected and verified on the same uid; the live path already stores the same account-wide fills per strategy |
| Bearer link in logs | Information disclosure | link held in memory per claim; only scheme and host described (existing `describe_href`) |
| Apply-budget exhaustion by a loop | Denial of service | GET-first, `MAX_REAPPLIES = 1`, 24 h backstop, cooldown on the chain |
| `ignore_duplicates` hides a wrong row | Tampering | duplicate-`tradeId` stop before the upsert; reconcile equality on overlap |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The archive bill `ts` equals the `fills-history` `ts` of the same fill to the millisecond | Q1 | `timestamp` unequal on overlap rows; fix is one constant (`fillTime`), caught by the reconcile before any write |
| A2 | Real-file `tradeId` and `ordId` carry at most the D-17 wrap and are digit strings after the strip | Q3 parser | Systematic `unreadable_trade_bill`; phase premise fails; return to founder (found at the first calibrate, nothing written) |
| A3 | Apply budget is 12 per day and an idempotent re-apply counts | Q3 apply budget | If wrong (1 per 10 s), GET-first is merely conservative; if right and unhandled, a 3-quarter job exhausts the day in about 2 h 15 min |
| A4 | A GET after the 5.5 h link life does not return a fresh link without a re-apply | Q3 | One extra apply per quarter on expiry; already budgeted |
| A5 | The present-day `ctVal` table (ETH-USDT 0.1) holds for 2026 H1 bills | Q2 | A wrong quantity in older quarters that the Q3 overlap cannot reveal; mitigated only by the recorded per-`instType` proof and a one-time review of OKX's ctVal history for ETH-USDT-SWAP |
| A6 | GET on a never-applied quarter answers `data: []` or `failed`, not an error | Q3 | The fills step treats any other shape as `archive_request_failed`; measured at the first calibrate |
| A7 | A Q1 file is served from the allow-listed host | Security | `download_refused` named stop; founder adds the host by review |
| A8 | The anchor "earliest `csv_daily_returns` day or earliest stored fill" is what the founder means by "start" | Q3 quarters | Fills before the anchor in the first quarter are not written; the planner may choose the key's creation date instead |
| A9 | A subType 1 to 6 bill carries one fill and one `tradeId` for SWAP (no per-currency duplicate) | Pitfall 5 | `duplicate_trade_id` stop; caught before the write |
| A10 | Phase 256 plans 06 to 10 do not touch `run_sync_trades_job` or `okx_archive_job.py` | Q4 | A merge conflict, resolved by rebasing over untouched regions |

## Open Questions (RESOLVED)

All six were resolved by the orchestrator in `259-CONTEXT.md`, "Addendum 2026-11-27 (after research)". Each item carries its resolution.

1. **Mode versus kind (planner's call per CONTEXT).**
   - What we know: the mode design needs no migration and no census edit, keeps the rebuild's pins green, and shares the per-key in-flight slot.
   - What's unclear: whether the founder ever wants a rebuild and a fills read in flight on one key.
   - Recommendation: mode. Revisit only on that need.
   - RESOLVED: mode (`fills_calibrate`, `fills_apply`), no migration.
2. **Durable coverage marker versus the compute_jobs cooldown.**
   - What we know: no per-strategy coverage record exists; the cooldown plus the earliest-fill test is loop-free but re-reads a quiet-start account once per 14 days.
   - What's unclear: whether that is acceptable.
   - Recommendation: the cooldown. A marker table is a migration and removes the main advantage of the mode design.
   - RESOLVED: the 14-day cooldown; `fills_calibrate` does not count toward it.
3. **Reconcile when the overlap is empty (after about 2026-12-29).**
   - What we know: only Q3 overlaps today; Q1 and Q2 never do.
   - What's unclear: whether a run with an empty overlap may write.
   - Recommendation: allow it for a per-`instType` proven mapper (constant set at ship from the PROD calibrate), bal chain mandatory, `reconcile: window_empty` recorded in the result; refuse for an unproven `instType`.
   - RESOLVED: as recommended (proven instType only, bal chain mandatory).
4. **Strategy status filter and anchor.** Recommendation: exclude `archived`; anchor = earlier of first daily return and first stored fill.
   - RESOLVED, overriding the recommendation: anchor = the strategy's earliest `csv_daily_returns` date only. Exclude `archived`.
5. **Extract versus fake-exchange reuse** of the live normaliser. Recommendation: extract (golden recorded first); fall back to the fake only if Phase 256 merge pressure appears.
   - RESOLVED: extract, golden first.
6. **Chain on an empty clean read.** Recommendation: yes, never on a failed or truncated read.
   - RESOLVED: as recommended; an empty clean read counts as answered for the cooldown.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.12 venv in `analytics-service` | pytest, mypy | The main checkout has a `.venv`; this worktree has none; the machine default is 3.14.3 | 3.14.3 default | `make rebuild-venv` (builds 3.12; a 3.13 or 3.14 venv is documented to segfault) |
| PROD DB read (Supabase MCP) | before/after report | yes | - | CLI one query per call |
| PROD enqueue and worker | backfill | founder-authorized | - | none |
| OKX archive via the worker's key | backfill | at run time | - | none; a stop result names the cause |
| Docker / local Supabase stack | only if a migration is chosen | not needed for the recommended design | - | - |

**Missing dependencies with no fallback:** none for the code. The PROD run needs OKX to generate three files (about 2 to 3 h each, in parallel).

## Sources

### Primary (HIGH confidence)
- Repository files read this session: `analytics-service/services/exchange.py` (normaliser, floor, ctVal table, `FillRow`, `_make_fill_dict`, `_RAW_DATA_KEEP_KEYS`), `okx_archive_job.py`, `okx_archive_files.py`, `okx_archive_classify.py`, `okx_archive_download.py`, `job_worker.py` (sync tail, upsert, `TIMEOUT_PER_KIND`, `JOB_CHAIN_FOLLOW_ON`, dispatch), `main_worker.py`, `supabase/migrations/20261026120000_okx_archive_rebuild.sql`, `supabase/schema/baseline.sql` (trades, index, constraints, enqueue functions), `20260417110539_retention_crons.sql`, `src/lib/display-labels.ts`, `src/lib/types.ts`, the OKXHISTORY RESEARCH and summaries, the Phase 255 verification and CHANGELOG, the Phase 256 plans and branch diff.
- OKX v5 docs, bills archive and `fills-history` sections (local text copy fetched 2026-11-27) and the changelog (`https://www.okx.com/docs-v5/log_en/`, 2026-06-11 rate-limit entry re-read live this session).

### Secondary (MEDIUM confidence)
- OKXHISTORY RESEARCH measurements (ccxt cost 72000, 7,920 s stall) as recorded 2026-10-15.

### Tertiary (LOW confidence)
- None relied on without an `[ASSUMED]` tag.

## Project Constraints (from CLAUDE.md)

- Read the live thresholds and census literals by symbol, never from prose; cite by symbol, not line number, where lines drift. Several line numbers above are for this checkout only.
- ⛔ No skip-CI trailer token in any commit message or PR body, not even to deny it.
- CHANGELOG entry for every ship, written before the push with the VERSION bump; `VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`.
- TODOS.md holds open work only: LOW and Info survivors are not booked there; every phase ship deletes the entries it closes in the same PR and names them in the CHANGELOG.
- `covered_digest` and `covered_files` are banned: use `verified_at_sha` plus `drift_subjects`; never list `TODOS.md`, `CHANGELOG.md`, `VERSION` or `package.json` in `drift_subjects`.
- Which database am I on: the CLI is linked to PRODUCTION; run the `COMMENT ON DATABASE` marker query before any write; PROD reads by MCP, one query per call; TEST is shared with other people's CI.
- Migrations (if any): re-base on the latest definition; run `scripts/lint-migration-data-dependence.mjs` clean (no data-reading `DO` guard); migration-reviewer and rls-policy-auditor clean before merge; no human gate between merge and PROD apply.
- Tests: neuter a data-integrity gate, see it RED, restore from a byte backup with `cp` and `cmp`, never `git checkout/restore/stash` on uncommitted work; pytest only from `analytics-service/`; never `importlib.reload`; always `grep -a`.
- CI gates: mypy strict over the running-service surface is a blocking job; coverage ratchet; the `frontend` aggregator.
- Public repo with tracked `.planning/`: no secrets, PROD ids, home paths or account numbers in tracked text; never quote a search pattern as proof of absence.
- No AI authorship attribution trailers in commits.
- GSD: never hand-dispatch `gsd-*` agents; `gsd-tools` state handlers can clobber `STATE.md` and `ROADMAP.md` (diff after every run).
- Next.js caveat in `AGENTS.md` does not apply: this phase touches only `analytics-service/` Python.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new package, all reuse read in source.
- Architecture (mode, fork, seams, chain placement): HIGH for the seams and censuses (read in source), MEDIUM for the trigger (no durable marker exists; the cooldown design is new).
- Mapping and reconcile: MEDIUM until the first PROD calibrate, because the real CSV's trade cells and the `ts` equivalence are unmeasured.
- Pitfalls: HIGH for the code-derived ones, MEDIUM for the OKX-behaviour ones (A3, A4, A6).

**Research date:** 2026-11-27
**Valid until:** 2026-12-27 for the code facts; the reconciliation overlap itself expires about 2026-12-29, which is why the PROD run should not wait.
