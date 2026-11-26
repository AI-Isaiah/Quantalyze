---
phase: 250-binancefills-a-binance-fills-read-walks-every-window-and-nev
reviewed: 2026-11-25T00:00:00Z
depth: standard
diff_base: 21b9ad929c9176b4e80d95fe369df14ce39d7858
files_reviewed: 9
files_reviewed_list:
  - analytics-service/services/exchange.py
  - analytics-service/services/job_worker.py
  - analytics-service/tests/_binance_fills.py
  - analytics-service/tests/test_binancefills_adapter.py
  - analytics-service/tests/test_binancefills_cursor.py
  - analytics-service/tests/test_binancefills_e2e.py
  - analytics-service/tests/test_binancefills_harness.py
  - analytics-service/tests/test_binancefills_walk.py
  - analytics-service/tests/test_exchange.py
severity:
  critical: 0
  high: 1
  medium: 3
  low: 2
  info: 2
findings:
  critical: 1
  warning: 5
  info: 2
  total: 8
  necessity: 0
status: issues_found
---

# Phase 250: Code Review Report

**Reviewed:** 2026-11-25
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found (1 HIGH, 3 MEDIUM, 2 LOW, 2 INFO)

## Summary

Scope: the diff `21b9ad929..HEAD` on `gsd/phase-250-binancefills` for the nine listed files. Read in full:
the `_fetch_raw_trades_binance` walk and the `fetch_raw_trades` change in `services/exchange.py`, and the
seed, persist and cursor-gate blocks of `run_sync_trades_job` in `services/job_worker.py`. Read outside
the diff, where a finding needed it:
- the reconcile caller `run_reconcile_strategy_job`;
- the onboarding caller `services/ingestion/binance.py::BinanceAdapter.fetch_raw` and its consumer
  `services/ingestion/long_fetch.py`;
- the forward-only `advance_sync_cursor` CASE (`supabase/migrations/20260602173710_advance_sync_cursor_claim_token_fence.sql:128-133`);
- ccxt 4.5.89's `binance.fetch_my_trades` and `fetch_markets`, from the worktree venv;
- the verbatim spot `GET /api/v3/myTrades` section of `binance-spot-api-docs/rest-api.md`, fetched
  2026-11-25 (lines 4743-4781).

CONTEXT, the founder ruling and the 250-08 hand-over were read as the contract. The quiet-prefix deadline
case is a founder-ruled known limit and is NOT reported. The ruling's premise is that "the next run
re-reads the same prefix". HIGH-01 is a case where the next run does NOT re-read it, so HIGH-01 is a
separate defect. The other recorded limits are reported only where the record is materially wrong
(MEDIUM-02, MEDIUM-03).

The walk itself is sound. Every request carries `until`. Windows are `window - 1` ms and abut with a 1 ms
overlap. Pages advance strictly. The overlap exemption is bounded by the strictly increasing `since`.
Every stop kind carries a bound no later than a row read. The bound is recorded once, as a minimum, in
the parent. Holds still win over a stop.

The defects are in the cursor side. Two states let a stopped read's span be passed. Both were reproduced
on the real `run_sync_trades_job` through the phase's own `_run_job` harness, in a scratch file outside
the worktree. The two states:
- a NULL column with no fills seed, so no anchor is available (HIGH-01);
- a column ahead of the strategy's newest stored fill, where the forward-only RPC drops the bounded stamp
  (MEDIUM-01).

Severity mapping to the canonical keys: `critical` = CRITICAL + HIGH, `warning` = MEDIUM + LOW,
`info` = INFO. Data-integrity findings: HIGH-01, MEDIUM-01, MEDIUM-02 and LOW-01. Necessity was assessed
against `necessity-review.md`. It produced no finding: the untimed-page guard checks venue data, so it
sits on a trust boundary, and the unloaded-markets fallback in `_binance_fills_window_ms` is a test seam.
No source file was modified.

## Critical Issues

### CR-01 (HIGH, data-integrity): with a NULL column and no fills seed, a stopped read that stamps nothing writes no anchor, so the next run skips the stopped span

**Files:**
- `analytics-service/services/job_worker.py:2263-2268`: `fills_anchor_iso` is set only when `daily_since_ms is not None`.
- `analytics-service/services/job_worker.py:2814-2822`: the new stop anchor is gated on `fills_anchor_iso is not None`.
- `analytics-service/services/exchange.py:2730-2731`: a `since_ms` of None now walks 85 days from the reach.

**Issue:** If the column is NULL and `daily_since_ms` is None, then `fills_since_ms` is None and
`fills_anchor_iso` stays None. This happens on the first sync of a strategy with no daily rows yet, or
after a high-water read that failed open to None (comment at :2207-2213). Phase 250 turned that read into
the most expensive one there is: a cold 85-day walk over every symbol, the read most likely to hit the
840 s deadline. Suppose it is deadline-stopped and no persisted fill is at or before the minimum bound,
for example when every symbol's walk is still in a quiet prefix. Then:
- the stamp is None (:2792);
- the 232 hold anchor (:2803) and the new stop anchor (:2814) both need `fills_anchor_iso`, so the column
  stays NULL;
- run 1's Phase 1 `sync_trades` RPC (:2374-2385) persists the income-derived daily rows;
- run 2 reads `load_strategy_high_waters` and gets a recent day, takes the NULL-column branch
  (`fills_since_ms = daily_since_ms`, :2264) and walks only from that day.

Every stopped symbol's span between its bound and that day is never read by the sync, and later stamps
pass it. RESEARCH Pitfall 5 names exactly this class ("a stop that stamps nothing and does not anchor
lets a later run seed past the unread span"). The new block's own comment says the same. The fix covers
only the seeded case.

This is NOT the ruled quiet-prefix limit. That ruling is premised on the next run re-reading the same
prefix ("loud ... bounded by the reach clamp"). Here the next run skips the prefix silently: no flag
fires on run 2.

Reproduced. Run 1 used `_make_supabase(trades_rows=[])`, `column=None`, one fill after the bound and
`{"binance_deadline_symbols": [...], "binance_read_through_ms": 1778414400000}`. Its fills read got
`since_ms=None` and it wrote `p_last_fetched_ts=None`. Run 2 used daily rows present and `column=None`.
Its fills read got `since_ms=1778112000000`, which is the daily seed, not the reach.

The Phase 232 hold arm (:2803) has the same `fills_anchor_iso is not None` hole for a partial-symbol or
phase-2 hold. That code is outside this diff and is not counted, but one fix closes both.

**Missing arm:** `test_a_stop_with_nothing_stampable_anchors_a_null_column`
(`tests/test_binancefills_cursor.py:212-226`) always runs with `DAILY_ONLY_TRADES`, so a daily seed
exists. The e2e harness patches `fetch_all_trades` to return `[]` (`tests/test_binancefills_e2e.py:162`),
so no arm lets run 1's Phase 1 move the daily high-water before run 2.

**Fix:** anchor at the instant the walk actually started when no seed exists. Pick ONE:
1. In `_fetch_raw_trades_binance`, record the walk start in the parent (for example
   `_record_dq_flag("binance_walk_start_ms", walk_start_ms)` beside the clamp flag). In the gate, when
   `fills_anchor_iso is None` and the column was NULL, use that instant as the anchor for both the stop
   anchor and the 232 hold anchor.
2. In `run_sync_trades_job`, on the NULL-column branch with `daily_since_ms is None` and a Binance
   exchange, set `fills_anchor_iso` to the ISO of `_now_ms() - BINANCE_FILLS_REACH_DAYS * 86_400_000`.

Either way, a later run seeds from that anchor, the reach clamp re-reads from the reach, and the case
degrades to the ruled, loud quiet-prefix limit. Add a two-run arm in which run 1 persists daily rows and
run 2's `since_ms` is asserted to be at or before run 1's walk start.

## Warnings

### WR-01 (MEDIUM, data-integrity): when the column is ahead of the strategy's newest stored fill, the bounded stop stamp is dropped by the forward-only RPC and the next run seeds past the stopped symbol's unread span

**Files:**
- `analytics-service/services/job_worker.py:2277-2281`: the seed is `min(cursor, fill high-water)`.
- `analytics-service/services/job_worker.py:2786-2793`: the bounded stamp.
- `supabase/migrations/20260602173710_advance_sync_cursor_claim_token_fence.sql:129-133`: the column is
  written only when it is NULL or earlier.

**Issue:** If the column C is ahead of the strategy's newest stored fill H, the seed is H. Suppose the
walk from H stops (cap or deadline) at a bound b with H < b < C. Then:
1. the gate stamps the newest persisted fill at or before b;
2. that stamp is below C, so the RPC's CASE discards it;
3. the healthy symbols' newer fills were persisted, so the next run's fill high-water is about now;
4. the next seed is `min(C, now) = C`;
5. the stopped symbol's fills in (b, C - 1 h) are never read.

Reproduced. Run 1 used `column=CURSOR_AHEAD_TS` (2026-06-20) and a stored fill at 2026-06-01. Its seed
was `since_ms=1780304400000` (2026-06-01). It capped at a bound of 2026-06-05 and stamped
`2026-06-05T09:00:00+00:00`, which the RPC drops against 2026-06-20. Run 2 had the healthy fill stored,
and its seed was `since_ms=1781913600000` (2026-06-20).

Ways to reach the state C > H:
- One key backs two strategies. The column is per key, the fill high-water is per strategy, and
  shared keys are intended.
- Pre-232 wall-clock stamps.
- Sanitized or deleted fills.

RESEARCH Pitfall 8 excludes the per-key and per-strategy premise as "the phase neither fixes nor worsens
it". That is true against HEAD, which stamped the plain maximum, so this is not a regression. But it
contradicts the SC-3 row of the 250-08 audit, "COVERED with no exception": the resume this phase builds
depends on the stamp landing, and in this state it never lands. The 232 partial hold has the same
mechanism (a held run persists healthy fills, which moves H past C).

**Missing arm:** `tests/test_binancefills_e2e.py:458-463` hand-sets run 2's `column=b_iso` from run 1's
asserted stamp. The Supabase fake records the RPC params and does not apply the RPC's forward-only CASE,
so no arm can observe a dropped stamp.

**Fix:** The column cannot be lowered without an RPC change, and migrations are out of this phase's
scope. Minimal in-scope options:
- (a) When the run stopped or held, `fills_since_ms` is below the column, and the stamp (or nothing) is
  below the column, record a named flag (for example `binance_stop_below_cursor`) and a WARNING. Then
  name the state as an SC-3 exception in the ship CHANGELOG and at the `_RAW_TRADE_INGESTION_ENABLED`
  precondition.
- (b) Route a change, owned by the phase that takes up Pitfall 8, that lets `advance_sync_cursor` lower
  the column to a stop bound.

Either way, make the fake apply the CASE so a dropped stamp is visible to the tests.

### WR-02 (MEDIUM, data-integrity, venue): the spot docs say the venue returns the MOST RECENT trades unless `fromId` is set, but the record says the docs are silent and the walk assumes oldest first

**Files:**
- `analytics-service/services/exchange.py:2785-2790`: spot pages are requested with `since` and `until`,
  and no `fromId`.
- `analytics-service/services/exchange.py:2835-2867`: `since` advances to the last row.
- `analytics-service/tests/_binance_fills.py`, module docstring: "result order (the fake serves oldest
  first)" is listed under "the docs are silent".

**Issue:** `binance-spot-api-docs/rest-api.md:4771`, fetched verbatim on 2026-11-25: "If `fromId` is set,
it will get trades >= that `fromId`. Otherwise most recent trades are returned." RESEARCH quotes this same
line (Q1 (c), line 272) and then says three lines later that "all three pages are silent" on order
(line 275). The 250-08 hand-over files it under "venue behaviours ... UNMEASURED".

Suppose a spot-resolved name (one with no derivative market, which gets 24 h windows) has more than 1,000
fills in one 24 h window, and the venue serves the newest 1,000 as the doc says:
- page 1 is the newest rows;
- `since` jumps to about the window end;
- the next page is short;
- the older fills in that window are skipped with no flag and no stop;
- the stamp is a stored fill after them.

ccxt's client-side sort hides the order, as RESEARCH notes. The fake cannot catch this because it always
serves oldest first.

**Fix:** At minimum, correct the record in RESEARCH, the harness docstring and the ship CHANGELOG line:
the spot doc states an order, so the docs are not silent. Code options for spot-resolved names:
- after the first full page of a window, continue with `params={"fromId": last_id + 1}` and no time
  parameters (the doc supports `symbol` + `fromId` and says ">= that fromId"), stopping when a row passes
  `window_end`;
- or end the window at a full spot page with a named stop that carries a read-through bound, so the
  cursor never passes it.

### WR-03 (MEDIUM): the T-250-19 record understates the sync handler tail; a fill-heavy run that times out repeats the same way on every later run, a permanent stall rather than one failed run

**Files:**
- `analytics-service/services/exchange.py:719-733`: the `BINANCE_SYNC_FILLS_READ_DEADLINE_S` comment.
- `analytics-service/services/job_worker.py:2285`: the 840 s argument.
- `analytics-service/services/job_worker.py:2464-2512`: the persist, which makes one amendment SELECT and
  one upsert per 100 fills.

**Issue:** The record says that when a read runs to its deadline and the persist then overruns the
remaining ~60 s, "`wait_for` cancels before the cursor RPC ... the cursor stays and the next run starts
from the same cursor". It does not say that the next run cannot escape:
- the cursor did not move, so the seed is `min(C, fill_hw) = C`;
- the run re-reads the same span to the same deadline frontier;
- it re-persists the same fills (each batch is still two DB round trips, even when every fill is a
  duplicate);
- it times out again.

While the account stays above the threshold, the cursor never advances. That is a stall, loud but
permanent, and it sits against the phase goal "its cursor never stalls". It is not the founder-ruled
case: the ruling covers the quiet prefix and the 840 s figure, not this tail.

**Fix:** Stop the walk on a fill budget as well as the clock, using the existing stop shape (kind
`deadline`, or a new named kind) with the read-through bound, so that read plus persist fits the 900 s
handler. Alternatively, amend the T-250-19 record and the SC-4 precondition text to say that this tail is
permanent until fills thin out, so the switch decision is made on an accurate record.

### WR-04 (LOW, data-integrity): the read returns duplicate fills, and the live onboarding path computes metrics and the fingerprint on them with no dedupe; Phase 250 widens this from 7 days to 85

**Files:**
- `analytics-service/services/exchange.py:2835-2867`: `since` advances to `last_ts` without +1, so every
  full page re-serves its boundary rows.
- `analytics-service/services/exchange.py:2882`: windows overlap by 1 ms.
- `analytics-service/services/ingestion/long_fetch.py:642-643` and `:684`: `fetch_raw` feeds
  `compute_metrics` and `compute_fingerprint` directly.

**Issue:** The sync and the reconcile are protected: the sync by the unique index, the reconcile because
both copies match the same DB row. The onboarding `metrics_snapshot` and fingerprint count each duplicate
twice. This existed at HEAD within one 7-day read. Phase 250 makes onboarding walk the 85-day reach, so it
now applies to every full page across that span.

**Fix:** Dedupe by `(exchange, exchange_fill_id)` in the parent result loop of `_fetch_raw_trades_binance`
before returning. The order is preserved and the sync and reconcile behave the same.

### WR-05 (LOW): the derived budget region in the hand-over assumes linear names; a spot-resolved name needs about 6.5 times the requests

**File:** `250-08-SUMMARY.md` "For the ship CHANGELOG", the quiet-prefix bullet. Derived from
`analytics-service/services/exchange.py:758-766`.

**Issue:** "up to about 280 symbols a cold 85-day walk reaches in one run" is 3,668 requests divided by
13 seven-day windows. A spot-resolved name walks 85 one-day windows, so the same budget reaches about 43
spot names. The stall region recorded for the founder's switch is therefore optimistic for any account
with spot-only names.

**Fix:** Add the spot figure to the CHANGELOG line.

## Info

### IN-01: `_binance_fills_window_ms` re-implements the spot test instead of calling `_binance_market_is_spot`

**File:** `analytics-service/services/exchange.py:764`, which repeats `:755`.
**Fix:** `if _binance_market_is_spot(markets.get(ccxt_symbol)):`.

### IN-02: the two-run test arms carry state between runs by hand

**Files:**
- `analytics-service/tests/test_binancefills_e2e.py:458-463`: run 2's `column` is copied by hand from
  run 1's asserted stamp.
- `analytics-service/tests/test_binancefills_e2e.py:162`: `fetch_all_trades` is patched to `[]`.

**Issue:** No arm feeds run 2 from what run 1 actually WROTE. Neither the RPC's forward-only CASE nor
Phase 1's daily rows reach run 2. That is how CR-01 and WR-01 passed every gate.
**Fix:** Covered by the arms proposed in CR-01 and WR-01.

---

_Reviewed: 2026-11-25_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure-hunter lane (round 1, 2026-11-25)

Run in parallel with gsd-code-reviewer per the repo review rule. MEDIUM and above only.

### SFH-1 (MEDIUM): `BinanceAdapter.fetch_raw` (onboarding) returns possibly truncated fills and never drains the data-quality flags
`services/ingestion/binance.py:105-110`. Disposition: NOT FIXED in this phase. CONTEXT's orchestrator decision 2026-11-25 (third caller) says "The adapter file is NOT edited"; the undrained flags are already a recorded known limit in 250-08's ship hand-over. Before this phase the same caller read only the venue's last 7 days, so the read is strictly wider than HEAD's.

### SFH-2 (MEDIUM): reconcile discards every flag, so a partially read exchange side produces a normal report
`services/job_worker.py:15549-15560`. Disposition: NOT FIXED. RESEARCH Open Question 2 is EXCLUDED as out of scope and already recorded as a known limit in the ship hand-over.

### SFH-3 (MEDIUM): window selection does not follow ccxt's own name resolution; an unmapped stored name (for example a USDC-margined name mangled by the `:USD` strip) resolves to spot, gets a 7-day window and fails permanently
`services/exchange.py:2701-2708`, `:2742`, and the strip at `:1001` / `:2710`. Routed to the round-1 fixer.

### SFH-4 (MEDIUM): `ccxt.BadSymbol` is read as "venue delisted" (non-holding) although a client-side resolution miss raises it too
`services/exchange.py:2909-2927`, `:2988-2989`; `services/job_worker.py:2640-2690`. Routed to the round-1 fixer, which must confirm or rebut with evidence.

## Round-1 fix dispositions (2026-11-26)

| Finding | Disposition | Commit |
|---|---|---|
| CR-01 (HIGH) | fixed: NULL column with no seed anchors at now minus the reach for a Binance key; two-run e2e arm, RED on pre-fix and on neuter N-CR01 | 41a85bbb1 |
| WR-01 (MEDIUM) | RECORDED, OPEN (round 2): now signalled at run time by `binance_stop_below_cursor` plus a WARNING (6eaaa5b13); closing it needs an RPC change, booked as `[250-BINANCE-STOP-BELOW-CURSOR]` in TODOS.md. Round 1: named SC-3 exception at `_RAW_TRADE_INGESTION_ENABLED`; forward-only `column_after_advance` test helper and pin arm. The RPC change that closes it needs a migration, outside this phase | 93035d5ef |
| WR-02 (MEDIUM) | round 1 added a full-spot-page stop (2414e8b38); round 2 showed it rests on a misread (the spot docs' General API Information: chronological, oldest items from `startTime`), so it was reverted (25bc5e4e7) and WR-02 is REBUTTED; RESEARCH corrected twice | 2414e8b38, 25bc5e4e7 |
| WR-03 (MEDIUM) | fixed as records: switch comment, call-site comment, 840 s constant comment; no fill-count stop | 282540cfa, 9db17efbf |
| SFH-1, SFH-2 (MEDIUM) | not fixed, per CONTEXT (adapter not edited) and RESEARCH OQ2 (excluded); both are recorded known limits | none |
| SFH-3 (MEDIUM) | window half fixed (window from `exchange.market()`); strip half rebutted: `BTCUSDCC` is the consistent stored form across `normalize_symbol`, the map and `positions.py:408` | 00a12974c |
| SFH-4 (MEDIUM) | rebutted: `create_exchange` loads spot, linear and inverse all-or-nothing, and `market()` raises BadSymbol only after markets and markets_by_id both miss, so after SFH-3 BadSymbol means not listed | none |

## Round-2 fix dispositions (2026-11-26)

Round 2 (`250-REVIEW-R2.md`): gsd-code-reviewer 1 HIGH + 1 MEDIUM; silent-failure-hunter clean.

| Finding | Disposition | Commit |
|---|---|---|
| R2 CR-01 (HIGH, regression from 2414e8b38) | fixed: the full-spot-page stop reverted; the arm inverted so an oldest-first spot window of several pages must be read whole (RED with the stop re-applied, R2-N1) | 25bc5e4e7 |
| R2 WR-01 (MEDIUM) | fixed in scope: `binance_stop_below_cursor` flag and WARNING when a stopped or partial read's unread span starts below a non-NULL column and the stamp will not move it; exception text corrected to a recorded open gap naming the shared-key entry; RED on two neuters (R2-N2). The gap itself stays open (RPC change, TODOS.md) | 6eaaa5b13 |

## Round-3 dispositions (2026-11-26, final round)

Round 3 (`250-REVIEW-R3.md`): gsd-code-reviewer 3 MEDIUM, 0 HIGH; silent-failure-hunter 1 MEDIUM (the same predicate gap as R3 MEDIUM 1). Per the repo review rule, data-integrity survivors of three rounds are routed, not fixed in a fourth round.

| Finding | Disposition |
|---|---|
| R3 M1 / SFH-R3 M1: `binance_stop_below_cursor` predicate misses a stop and a partial symbol in the same run (`job_worker.py:2720`) | ROUTED: `[250-BINANCE-STOP-BELOW-CURSOR]` in TODOS.md (the reviewer's predicate, verified in a scratch copy, is carried there) |
| R3 M2: sync-time `binance_*` flags do not survive `derive_broker_dailies` and the CSV analytics step | ROUTED: same TODOS entry; pre-existing for every sync-time flag; the ship hand-over now says the WARNING is the lasting signal |
| R3 M3: records claimed a TODOS booking that did not exist | FIXED: the entry is booked in the ship commit and the records name its id |
