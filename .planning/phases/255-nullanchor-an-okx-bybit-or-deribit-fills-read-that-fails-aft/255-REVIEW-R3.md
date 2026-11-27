---
phase: 255-nullanchor-an-okx-bybit-or-deribit-fills-read-that-fails-aft
round: 3
reviewed: 2026-11-27T12:02:40Z
reviewed_at_sha: 9c089a45e98fb6f13550dbb537c33c7102532bbc
diff_base: 8ff3d8d23
depth: deep
scope_note: focused on the three round-2 fix commits 0896c039d, 8033fdd0e and 73d12296f
files_reviewed: 4
files_reviewed_list:
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/test_nullanchor_bound.py
  - analytics-service/tests/test_exchange.py
findings:
  critical: 0
  warning: 2
  info: 5
  total: 7
severity_breakdown:
  critical: 0
  high: 0
  medium: 2
  low: 3
  info: 2
status: issues_found
---

# Phase 255: Code Review, Round 3 (round-2 fix commits)

**Scope.** `git diff 8ff3d8d23 HEAD -- analytics-service`. The commits are `0896c039d` (R2-CR-01,
the OKX pager cursor moves from `tradeId` to `billId`), `8033fdd0e` (R2-WR-01, the OKX `begin`
floor becomes now minus three calendar months plus one day, with the non-holding
`okx_fills_reach_clamped` flag) and `73d12296f` (R2-WR-02 (b), the Bybit read deadline becomes
840 s minus the time the handler has already used). Callers were traced in
`services/job_worker.py` (the sync epilogue, the dispatcher, the chained derive prestamp, the
reconcile job), `services/binance_sync_flags.py`, `services/analytics_runner.py`,
`services/ingestion/okx.py`, `routers/cron.py`, and every `src/` reader of `data_quality_flags`.

**Severity scale.** Same mapping as rounds 1 and 2: CRITICAL and HIGH go to `critical`, MEDIUM to
`warning`, LOW and INFO to `info`. The project acts on MEDIUM and above.

**Booking items are not counted.** As in round 2, items that need booking or a founder decision
are listed under "Carried forward", not in the counts.

**Necessity.** No `necessity:` count. The necessity reference was not read for this focused round.

**Evidence run.** `pytest tests/test_nullanchor_bound.py` at HEAD, from `analytics-service/`:
`92 passed in 44.71s`. The OKX v5 docs page (`https://www.okx.com/docs-v5/en/`) was fetched and
text-extracted on 2026-11-27 for this review. The quotes below come from that copy.

## Verdict per question

| Q | Answer |
|---|---|
| 1. Does each commit close its finding without a new MEDIUM+? | **R2-CR-01: yes.** The cursor is now the documented key. No other code reads the cursor value, and nothing else regressed. A backfill for strategies synced under the old cursor is still owed and is time-sensitive (see Carried forward). **R2-WR-02 (b): yes.** The clock is right and no other venue changed. **R2-WR-01: partly.** The far-edge loss is down to one day under the calendar-month reading. But the new floor sends a `begin` 91 days back on 214 dates a year, which reopens the unbounded mode round 2 ranked worst (R3-WR-01, unverified). Also, the flag that was meant to name the clamp leaves no lasting trace (R3-WR-02). |
| 2. Does anything else depend on the cursor value? Is the docs citation right? | **Nothing else depends on it.** `cursor` and `prev_cursor` are locals of `_fetch_raw_trades_okx_inst_type`. The round-1 stuck arms compare whatever the cursor is, so they now run on `billId` unchanged. `exchange_fill_id` is still `fill.get("tradeId", "")` (`exchange.py:3215`), so the stored dedupe key does not move. The bills readers (`_okx_bills_window_read`, `exchange.py:1792-1860`; `okx_opening_balance.py:257-289`; `funding_fetch.py:603`) have always paged by their own `billId` and share no state with the fills pager. The reconcile job and the `services/ingestion/okx.py` adapter use the same reader and now page correctly too. **The citation is right.** The fetched page carries, under "GET / Transaction details (last 3 months)", `GET /api/v5/trade/fills-history`: "after String No Pagination of data to return records earlier than the requested billId", and the response table lists `tradeId` ("Last trade ID") and `billId` ("Bill ID") as separate fields. ccxt 4.5.x `okx.fetch_my_trades` agrees (`# 'after': billId,`). |
| 3. Is `okx_fills_reach_clamped` user-facing, and should the sync clear it? | **Not user-facing. "Never cleared" is the wrong premise: the key is wiped soon after it is written.** No `src/` file reads it, iterates flag keys, or forwards the raw blob. The returns route says "The RAW `data_quality_flags` blob is still never forwarded" (`src/app/api/strategies/[id]/returns/route.ts:204`, `:588`). Every other reader picks named keys, and the admin review route only calls `hasStoredAnalyticsResult`. The Binance analogue `binance_fills_reach_clamped` appears nowhere in `src/` either. In the analytics service, every `sync_trades` enqueues `derive_broker_dailies` (`JOB_CHAIN_FOLLOW_ON["sync_trades"]`, `job_worker.py:1122`, `:3524`). Its strategy-mode prestamp REPLACES the column, starting from `{"csv_source": True}` (`:11962`), and carries only the Binance allowlist (`:12365`). So the top-level key is gone once the derive reaches its prestamp. It lives on only inside `last_success_snapshot.flags`: `_last_success_snapshot` deep-copies the whole prior flag object when a success wrote it (`:4459-4460`). That copy rotates out at the next derive after the following success. **Should the sync clear it?** That question only matters if the key is carried, like Binance's. If it is carried, then yes: mirror D-09 and clear it on an OKX read that ran and did not raise. Otherwise a recovered strategy would keep it forever. The real gap is R3-WR-02. |
| 4. Is `_monotonic` / `_handler_start` right against the 900 s handler timeout? Any Binance, MT5 or Deribit regression? | **Correct.** The dispatcher runs `asyncio.wait_for(handler(job), timeout=timeout)` (`job_worker.py:19703`), and `_handler_start = _monotonic()` is the handler's first statement (`:2239`). The two clocks start together. `run_sync_trades_job` has no other caller (no inline call from `long_fetch`, the routers or the cron). The read must therefore finish by handler start + 840 s, which keeps the 60 s margin for the post-read work. `fetch_raw_trades` does no work before `_fetch_raw_trades_bybit` stamps its own deadline (`exchange.py:2605-2610`), and both clocks are `time.monotonic` in production. The 1 s floor lets one request run, and the refusal is the named `"deadline"`. **No regression:** any venue other than `"bybit"` still gets `BINANCE_SYNC_FILLS_READ_DEADLINE_S` unchanged. OKX and Deribit ignore the argument, and the Binance pins pass. The new module-level `import time` shadows no local name in `job_worker.py`. |

## Warnings

### R3-WR-01: MEDIUM (UNVERIFIED, conditional on venue behaviour; introduced by `8033fdd0e`): the calendar floor sends a `begin` 91 days back on 214 dates a year, beyond a 90-day reading of "the last 3 months", against round 2's "keep 89 until the probe"

**Data-integrity:** yes, if the venue condition holds. **User-facing:** yes, through fills, positions
and trade volume.
**File:** `analytics-service/services/exchange.py:714-726` (`_okx_fills_begin_floor_ms` and its
comment "so it sits inside the documented reach on every date") and `:3272-3281` (the clamp).

**Evidence.** `_okx_fills_begin_floor_ms` was run over every day of 2026 at 12:00Z. This is the
look-back it produces (`now - floor`, in days):

```
[(88.0, 28), (89.0, 62), (90.0, 61), (91.0, 214)]
first date of each: 91 -> 2026-01-01, 89 -> 2026-03-01, 88 -> 2026-05-01, 90 -> 2026-05-30
```

The docs say only "This endpoint can retrieve data from the last 3 months". ccxt models the same
endpoint as `'daysBack': 90` (`okx.py` features, `fetchMyTrades`; the `fetchClosedOrders` copy is
commented `# 3 months`). So whether "3 months" means calendar months or 90 days is not settled by
any source. The comment's "inside the documented reach on every date" holds only under the
calendar reading. The flat 89 days it replaced was inside both readings on every date.

**Why it matters.** Round 2's option table showed the worst case of an out-of-reach `begin`. If
OKX answers one with an EMPTY list, the whole span is lost silently: R6 clears the bound under
`-infinity`, the cursor advances and `phase2_recovered_at` is stamped. That is the loss Phase 255
exists to stop. Round 2 kept the 89-day clamp because it was "the only option whose worst case is
bounded". On 214 dates a year the new floor is no longer bounded under a 90-day reading. On 28
dates it is 88 days, which is SHORTER than the 89 it replaced, so the far edge lost there is
larger than before. Nothing about the venue was measured. The probe round 2 asked for is still
owed (fix report Round 2, residual limit (1)).

**What is not known.** How OKX answers a `begin` 91 days old. It may honour it, error, or return
empty. If it honours it or errors, this finding is void.

**Fix.** Either (a) run the read-only probe round 2 described (compare `begin = now - 94 d`,
`now - 91 d`, `now - 89 d` and no `begin`, on an OKX account with fills in that band) and set the
floor from the measurement, or (b) until the probe runs, keep the floor inside both readings:

```python
def _okx_fills_begin_floor_ms(now_ms: int) -> int:
    ...  # calendar computation unchanged
    calendar_floor = int(shifted.timestamp()) * 1000 + now_ms % 1000 + 86_400_000
    return max(calendar_floor, now_ms - 90 * 86_400_000)  # inside "3 months" read as 90 days too
```

Then correct the comment so it says which reading the floor relies on. Under the calendar reading
this caps the loss at about two days on the 92-day dates. It leaves the 88-day dates as they are.

### R3-WR-02: MEDIUM (introduced by `8033fdd0e`; the visibility half of R2-WR-01 is not delivered): `okx_fills_reach_clamped` is gone from the row once the chained derive prestamps, and the clamp branch logs nothing, so a dropped far edge leaves no lasting signal

**Data-integrity:** yes (the signal for an accepted loss). **User-facing:** no.
**File:** `analytics-service/services/exchange.py:3279-3281` (the flag, with no log line);
`analytics-service/services/job_worker.py:1122` and `:3524` (every `sync_trades` enqueues
`derive_broker_dailies`), `:11962` (`_prestamp_flags = {"csv_source": True}`), `:12363-12371`
(only `carry_binance_sync_flags` is carried), `:4459-4460` (the snapshot nests a copy);
`analytics-service/services/binance_sync_flags.py:79-92` (the explicit allowlist: "A key outside
the allowlist, such as `sync_truncated_okx`, is never carried").

**Issue.** Round 2's fix asked for the clamp to be "named on the strategy instead of stamped
`phase2_recovered_at`". What happens instead:
1. The sync epilogue merges the flag into `existing_flags` and upserts it (`:3280-3281`, and the
   `elif exchange_dq_flags_present` write arm). It reaches the row.
2. The same handler enqueues the derive (`:3524-3530`). The derive's strategy-mode prestamp
   replaces `data_quality_flags` wholesale. The top-level key, and `phase2_recovered_at` with it,
   are dropped. The prestamp is not venue-gated. Key mode returns earlier, but strategy mode
   always reaches it on a derive that gets that far.
3. The only copy left is nested in `last_success_snapshot.flags`. No reader looks for this key
   there (Q3), and the copy rotates out after the next success.
4. Binance logs a WARNING beside its flag (`exchange.py:2782`, "seed %d is older than the venue
   reach %d, starting at the reach"). The OKX clamp logs nothing.

So within one job chain, no flag and no log line records that the far edge was skipped. Phase
253 round 3 WR-02 treated exactly this wipe as a defect for the `binance_*` keys ("before this
module the WARNING log was the only lasting signal"). That is why `binance_sync_flags.py` exists.
The same wipe already hits `sync_truncated_okx` (pre-existing, not counted here). The fix report's
residual (2), "stays on the strategy's `data_quality_flags` until something overwrites it", is
true in the letter. Something overwrites it every time.

**Fix (minimal).** Log a WARNING in the clamp branch with the seed and the floor (no venue text),
like Binance's, so Railway keeps a record:

```python
if since_ms < begin_floor_ms:
    logger.warning(
        "OKX fills read: seed %d is older than the begin floor %d, starting at the floor "
        "(okx_fills_reach_clamped)", since_ms, begin_floor_ms,
    )
    _record_dq_flag("okx_fills_reach_clamped", True)
    since_ms = begin_floor_ms
```

If the row itself should carry it, add it to a carried allowlist with a D-09-style clear on an
OKX read that ran and did not raise (see Q3). That is a larger change, and the phase agent should
decide it.

## Info

### IN-R3-01: LOW: the flag fires on every run for a dormant OKX account whose seed is older than the floor

**File:** `analytics-service/services/exchange.py:3278-3281`. A stale seed in normal operation
(the newest stored fill is more than about three months old) trips the clamp on every sync. That
means a flag write every run, and nothing in the band to lose. Once R3-WR-02 is fixed, this
becomes a recurring WARNING. It is noise, not a defect. If it matters, phrase the log so that a
reader does not take it for a loss.

### IN-R3-02: LOW: the fills pager trusts `data[-1]` as the page's smallest `billId`, without the order check its sibling pagers carry

**File:** `analytics-service/services/exchange.py:3221`. `_okx_bills_window_read` checks that
`billId` strictly descends (`order_drift`, `:1797`), and `okx_opening_balance.py:283` pages from
`min(billId)`. The fills pager uses the last row. The docs give no ordering statement for
`fills-history`, but newest-first is what H-0665 and ccxt rely on. A row out of order makes the
next page repeat rows, not skip them, so this fails toward duplicates. It is not a regression,
since the old `tradeId` cursor had the same shape.

### IN-R3-03: LOW: no test pins that `okx_fills_reach_clamped` reaches the upserted `data_quality_flags`, or what the derive does to it

**File:** `analytics-service/tests/test_nullanchor_bound.py`,
`test_the_flag_names_the_clamp_but_never_holds_the_cursor`. It asserts the reader raised the flag,
the cursor advanced and the bound cleared. It never reads the `strategy_analytics` upsert payload.
That is why R3-WR-02's lifetime went unseen.

### IN-R3-04: INFO: OKX documents a NEGATIVE `tradeId` for liquidation and ADL fills, which `exchange_fill_id` stores as-is

**File:** `analytics-service/services/exchange.py:3215`. The fetched docs, in the response notes
for `fills-history`, say: "tradeId When the order category to which the transaction details
belong is partial_liquidation, full_liquidation, or adl, this field will be assigned a negative
value". This no longer touches pagination after `0896c039d`. It is pre-existing and recorded for
whoever owns the backfill and dedupe below. Whether negative ids are unique was not checked.

### IN-R3-05: INFO: Q4, the remaining-budget arithmetic is verified, and the post-read margin is still unmeasured

**File:** `analytics-service/services/job_worker.py:2239`, `:2684-2698`. Verified as in the Q4 row.
The 60 s after the read still has to hold the persist, the DQ stamp and the cursor RPC, which is
the same posture Binance has. The fixer stated this residual already.

## Carried forward (booking or decision items, not counted)

- **R2-CR-01 backfill: needs a founder decision, data-integrity, user-facing, time-sensitive.**
  OKX strategies synced under the `tradeId` cursor may hold only the newest 100 fills per
  instType from each run (the phase agent's PROD figures of 200, 106 and exactly 100 SWAP fills
  fit that pattern). Their cursor has moved past the unread fills, so this fix will not re-read
  them by itself. `fills-history` reaches only "the last 3 months", so every day of delay puts
  another day of those fills beyond this endpoint's reach. No `TODOS.md` entry exists at HEAD
  (`grep -n 255 TODOS.md` hits only `[253-NULL-COLUMN-ANCHOR-ALL-VENUES]`).
- **R2-WR-02 (a): still unbooked.** The Bybit no-progress re-read and the R4 creep of the bound by
  1 h + 1 ms per refusal, as round 2 stated.
- **The OKX `begin` probe (R2-WR-01 step 1):** still owed. It would settle R3-WR-01.

## What holds (verified)

- **R2-CR-01** (`0896c039d`). The only behavioural change is the cursor field. The SFH-M1 arms now
  test a varying `billId`, so the repeated-cursor arm tests what it names. The new
  `TestOkxPagerCursorIsABillId` fake honours `after` only as `billId < after`, so the recorded
  neuter (`tradeId` back) goes RED. A row with no `billId` on a full page is a held stuck stop,
  not a fallback to `tradeId`, which fails safe.
- **R2-WR-02 (b)** (`73d12296f`). The handler clock, the Bybit-only branch and the floor all check
  out (Q4). The parametrised test pins Bybit at `840 - 100` and Binance at the fixed 840.
- **R2-WR-01 arithmetic** (`8033fdd0e`). The helper matches its five pinned dates, including the
  February clamp, the leap year and the year wrap. The flag does not start with
  `sync_truncated_`, so `_fills_incomplete` never holds the cursor on it, and the bound is cleared
  as round 2 accepted.

---

_Reviewed: 2026-11-27T12:02:40Z_
_Reviewer: Claude (gsd-code-reviewer), round 3_
_Depth: deep (focused)_
