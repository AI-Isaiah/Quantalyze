---
phase: 255-nullanchor-an-okx-bybit-or-deribit-fills-read-that-fails-aft
reviewed: 2026-11-27T10:44:51Z
reviewed_at_sha: f3c22f4696402e9afe17442e9c085094461d1a0f
diff_base: 45d7b4e5c
depth: deep
files_reviewed: 8
files_reviewed_list:
  - analytics-service/services/job_worker.py
  - analytics-service/services/exchange.py
  - analytics-service/services/trade_resume.py
  - analytics-service/tests/test_nullanchor_bound.py
  - analytics-service/tests/test_binancefills_cursor.py
  - analytics-service/tests/test_sync_trades_resume_seed.py
  - analytics-service/tests/test_sync_trades_store_truth.py
  - analytics-service/tests/test_ana_recon_audit.py
findings:
  critical: 0
  warning: 2
  info: 8
  total: 10
  necessity: 1
severity_breakdown:
  critical: 0
  high: 0
  medium: 2
  low: 4
  info: 4
status: issues_found
---

# Phase 255: Code Review Report

**Reviewed:** 2026-11-27T10:44:51Z
**Depth:** deep
**Files Reviewed:** 8
**Status:** issues_found

## Summary

Phase 255 extends Phase 253's per-strategy re-read bound (`strategy_fills_reread_bounds` /
`set_strategy_fills_reread_bound`) from Binance to OKX, Bybit and Deribit inside
`run_sync_trades_job`. It splits the gate into `_bound_read` (any of the four venues) and
`_binance_read` (Binance-only predicates), adds per-venue reach anchors (OKX now minus 93 days,
Bybit now minus 365 days, Deribit epoch 0), and adds an off-Binance `_earliest_through` branch that
keeps the bound when `phase2_failed` is true or any `sync_truncated_*` flag is truthy.

**Severity scale.** Each finding carries the project's five-level label. Tier mapping for the
frontmatter: CRITICAL and HIGH map to `critical`, MEDIUM to `warning`, LOW and INFO to `info`. The
project acts on MEDIUM and above only. LOW and INFO findings stay in this file and are not booked in
`TODOS.md`.

**What holds (verified, not assumed):**
- **Epilogue clear predicate.** For each venue, a raised read, a persist failure and an OKX
  page-capped read keep the bound. Bybit and Deribit never return a flagged partial read: they
  raise, and the worker's `except Exception` arm sets `phase2_failed`. Daily-read flags merge into
  `exchange_dq_flags`, but they are all named `daily_pnl_*`, so none can trip the
  `sync_truncated_*` test. The one non-complete read that does clear the bound is the OKX
  stuck-cursor silent stop (IN-05). The plan hand-over already books it.
- **Binance-only predicates and flag clear.** `binance_stop_below_cursor` is written only under
  `_binance_read` at both sites (job_worker.py:3092, :3131). The binance flag clear is still gated
  on `_binance_read` (job_worker.py:3287). The orphan arm resets both `_bound_read` and
  `_binance_read` (job_worker.py:2591-2592). A Binance run's `_earliest_through` path is unchanged:
  the new code is an `elif` under `if _binance_read:`.
- **Deribit epoch 0.** No truthiness bug in the worker: every gate tests `is not None`, so anchor 0
  and provisional value 0 flow through.
- **Bybit anchor vs `start_too_old`.** With the 365-day anchor, run 2's walk start after a failed
  first sync stays inside the 730-day refusal line (pinned by
  `test_bybit_bound_stays_inside_the_venue_history_on_a_later_clock`, PROOF-01 N4).
- **Test runs at HEAD.** 225 passed across the six phase suites, and 619 passed / 13 skipped
  across the other suites that drive `run_sync_trades_job`. No other hand-rolled RPC fake answers
  falsy for the bound RPC with ingestion on: the remaining non-Binance drivers patch
  `_RAW_TRADE_INGESTION_ENABLED` to False.
- **PROOF-01.** The recorded N1 to N10 output in 255-03-SUMMARY.md shows each gate turning RED by
  node id and restoring byte-identical. The off-Binance clear predicate is discriminated by
  separate arms: okx-set-plain for `phase2_failed`, okx-set-trunc for `sync_truncated_*`.
- **mypy.** `mypy --strict --follow-imports=silent --config-file=pyproject.toml` over the CI
  surface printed `Success: no issues found in 146 source files`. The local binary is 2.0.0 and CI
  pins 2.4.0, so CI's run is binding.

**Key concerns (MEDIUM).** Both come from the same design choice: a pinned seed that never advances
until a read completes. On OKX and Bybit that choice has two failure modes the phase has not
routed. (1) A Bybit walk longer than the 900 s handler budget now repeats forever, where before it
recovered on the next run (WR-01). (2) Every OKX retry after a failed first sync sends a `begin`
beyond the endpoint's documented 3-month reach. The venue's reply to that is unverified
(assumption A1, WR-02).

## Warnings

### WR-01: MEDIUM — a Bybit fills walk longer than the handler budget now wedges for good: every retry re-walks the same pinned span and is cancelled again

**User-facing:** yes. Fills, positions and trade-volume views stop updating for that strategy. A
first sync for a heavy new Bybit key can exhaust its retries in the wizard. **Data-integrity:** no
(no span is skipped; the problem is liveness).
**File:** `analytics-service/services/job_worker.py:2426-2431` (Bybit anchor),
`:2539-2541` (provisional value = seed or anchor), `:1071` (`"sync_trades": 15 * 60`);
`analytics-service/services/exchange.py:2554` (`read_deadline_s` "bounds the Binance fills read
only; the other venues ignore it")

**Issue:** Binance's read has an 840 s deadline that stops at a window and records
`binance_read_through_ms`, so a long Binance read still makes partial progress. OKX, Bybit and
Deribit have no deadline. A non-Binance read that outlasts the handler's `asyncio.wait_for`
(900 s) is cancelled before the persist and before the epilogue. The provisional row stays at the
seed, and the next run's seed is `min(column, high-water, bound)`, which is the same seed. The
next walk is the same span plus the time elapsed since, so it is cancelled again. Before this
phase, run 2 on a NULL column, or on a set column with no stored fill, seeded from the daily
high-water that run 1 had just moved. It walked a short span and completed, at the cost of the
silent loss this phase fixes.

The cancel path also never reaches `advance_sync_cursor`, which holds `last_sync_at`. It never
reaches the `derive_broker_dailies` follow-on enqueue either, and it never writes
`phase2_fill_ingestion_failed`, so the strategy carries no signal at strategy level. The only trace
is the job's timeout, which is classed as transient.

- **OKX** is safe in practice. The page cap bounds it to at most 4 instTypes x 100 pages.
- **Deribit** is unaffected, because its read ignores the seed.
- **Bybit** is the exposed venue. A 365-day first sync walks 53 seven-day windows of up to 200
  pages each. The module's own comment records a PROD key at 121 pages in one window
  (exchange.py:175). A heavy key's first sync, or a pinned set-seed span that has grown, plausibly
  exceeds 900 s.

RESEARCH Pitfall 4 accepts this as "the intended integrity-over-liveness trade" for the first sync
only, and the hand-over routes it to a CHANGELOG note ("first-sync retry cost"). It is wider than
the first sync: it also covers the NULL-column and set-column-no-fill classes. It has no owner, no
trigger and no founder decision.

**Fix:** Pick one of these before ship.
- **Route it.** Book a `TODOS.md` entry with an owner and a trigger, and put it to the founder as
  a decision item next to `[253-CRON-MOVES-SEED-WHILE-BOUND-RPC-DOWN]`, stating the scope above.
- **Or close it at the root, the Binance way.** Give `_fetch_raw_trades_bybit` a read deadline
  (pass `read_deadline_s` through `fetch_raw_trades`). Have it stop at a completed window
  boundary, record the window end as a read-through instant, and make the off-Binance
  `_earliest_through` branch return that instant instead of `walk_start - 1`. Successive runs then
  advance through the span instead of repeating it.

### WR-02: MEDIUM (conditional on unverified assumption A1) — every OKX run after a failed first sync sends a `begin` beyond the endpoint's 3-month reach

**User-facing:** yes, if A1 is false: OKX fills stop for that strategy, flagged by
`phase2_fill_ingestion_failed`. **Data-integrity:** no span is skipped, but fills ingestion stops
for good.
**File:** `analytics-service/services/exchange.py:712` (`OKX_FILLS_REACH_DAYS: int = 93`),
`:3069-3070` (`begin` sent unclamped on every page); `analytics-service/services/job_worker.py:2421-2425`

**Issue:** The OKX anchor is deliberately 93 days, longer than any 3 calendar months (92 days at
most), so that the provisional row is never later than the walk's real start. The consequence
follows by construction. A failed OKX first sync, with no `begin` sent, leaves a bound at
`now - 93d` (or 1 ms less). Run 2 then seeds from that bound, and `fetch_raw_trades` sends
`begin = seed - 1h`, at least 93.04 days old. `test_first_sync_run2_walks_from_the_reach_anchor[okx-first-*]`
pins exactly this value.

Before this phase, that path never sent an out-of-reach `begin`. Run 2 seeded from the daily
high-water. RESEARCH A1 records that OKX's reply to a `begin` older than the reach is undocumented
in every source read. The vendor page was unreachable, and the recommended read-only probe "before
ship" was not run; the hand-over routes A1 to a CHANGELOG note only. The matrix doubles
`fetch_raw_trades`, so no test can observe the venue's reply.

If OKX rejects such a `begin`, every later run raises. Each failure writes `walk_start - 1` (an
hour earlier, RPC R4), the bound never clears, and the strategy's OKX fills never ingest again. A
cron-moved daily high-water cannot rescue it, because the bound pins the seed. The same happens to
any OKX strategy whose bound ages past 3 months.

**Fix:** Run the one read-only probe RESEARCH A1 names: a `fills-history` call with `begin` at now
minus 94 days, through the founder's authorised PROD-read path. Record the reply in the SUMMARY. If
OKX errors, clamp the sent `begin` in `_fetch_raw_trades_okx` to the venue reach. That is lossless,
because the venue cannot return older fills, and the epilogue's `covers` stays `-infinity` because
`walk_start <= _reach_anchor_ms`:

```python
# _fetch_raw_trades_okx, before the instType loop
if since_ms is not None:
    since_ms = max(since_ms, _now_ms() - OKX_FILLS_REACH_DAYS * 86_400_000)
```

(If OKX serves fewer than 93 days, clamp to the shortest documented reach, or send no `begin` when
`since_ms` is at or below the reach, which already walks the venue's full window.)

## Info

### IN-01: LOW — a Deribit strategy writes a pre-epoch value into the shared `api_keys.last_fetched_trade_timestamp` column

**User-facing:** no. **Data-integrity:** no in effect (the only reader is the fills seed, which
Deribit ignores).
**File:** `analytics-service/services/job_worker.py:2433-2436` (anchor 0), `:2495`
(`fills_anchor_iso = _iso_of_ms(_reread_bound_ms)`), `:3060` (stamped on a failed Phase 2)

**Issue:** Measured with a scratch two-run probe on the real `run_sync_trades_job` (pinned clock,
the plan-01 harness):
- Run 1 is a Deribit first sync: NULL column, no daily high-water. Its fills read raises, so the
  bound is `-1` ms.
- Run 2 has a NULL column and a daily high-water. The bound lowers the seed to `-1`, and
  `fills_anchor_iso` follows it to `"1969-12-31T23:59:59.999000+00:00"`.
- Run 2's read raises too, so the epilogue passes that value as `p_last_fetched_ts`, and
  `advance_sync_cursor` writes it into the NULL column.

The probe asserted `p_last_fetched_ts == '1969-12-31T23:59:59.999000+00:00'`. A cancelled run 1
gives `1970-01-01T00:00:00+00:00` instead. The value stays until a Deribit read persists at least
one fill. RESEARCH D2 named this exact write as the reason the None-seed column anchor must never
apply to Deribit ("an epoch-0 anchor would write 1970 into a shared per-key column"). The
implementation reaches it through the bound-lowering branch instead.

**Fix:** Do not let the column anchor follow a bound at or below the epoch: guard line 2495 with
`if _fills_cursor_ms is None and _reread_bound_ms > 0:`. Alternatively, take Deribit out of the
bound (IN-02).

### IN-02: LOW — Already-defended-elsewhere: the Deribit bound guards a span loss that cannot occur

**Category:** necessity
**File:** `analytics-service/services/job_worker.py:2433-2436`; evidence
`analytics-service/services/deribit_ingest.py:3341-3344`

**Issue:** `fetch_deribit_fills` ignores `since_ms`: "the id-cursor crawl is full-history
(`historical=true`)". Every Deribit run re-reads all history, so no seed can skip a span. The code
comment says so ("the bound is inert in effect"), and so do RESEARCH D1 and A3. What the bound adds
on Deribit is cost, not protection:
- One bound read and two fenced RPCs per run.
- The fail-closed arm, which now holds a Deribit run's daily `sync_trades` store and skips its
  fills read whenever the bound RPC raises.
- The orphan arm, which skips the store and the flags write.
- The pre-epoch column stamp (IN-01).

RESEARCH D1 chose uniform treatment so that SC-1's three-venue wording stays literal. That is a
scope choice, not a defect.

**Fix:** None required. If the founder prefers, drop the `deribit` branch so `_bound_read` stays
False for Deribit, reword SC-1 to OKX and Bybit with a deviation note, and keep the Deribit arms as
pins that the full-history read is unaffected.

### IN-03: LOW — Bybit's `-infinity` covers and the "a None seed already covers every bound" rule treat the 365-day product lookback as the venue's reach

**User-facing:** no. **Data-integrity:** yes, in principle (narrow trigger).
**File:** `analytics-service/services/job_worker.py:2814-2817`, `:2474-2479`;
`analytics-service/services/trade_resume.py:156-161`

**Issue:** `-infinity` means "the walk started at the venue reach" (the RPC's COMMENT). For Binance
that is honest: older is unreachable. For Bybit the anchor is the 365-day first-sync lookback,
while the venue serves 730 days, so a walk that starts at or before `now - 365d` gets `-infinity`
without having covered `[now - 730d, walk_start)`.

`load_strategy_fills_reread_bound`'s fail-open docstring rests its safety on the run's `covers`
being "above the stored bound". That does not hold under `-infinity`. A transient bound-read error
on a Bybit run whose seed is at least 365 days old therefore lets a clean read clear (R6), or a
failed read raise (R4), a stored bound that is still readable. The None-seed skip at :2474-2479
has the same premise and accepts the "sliver" RESEARCH records.

**Fix:** For Bybit, compute the `-infinity` test against `BYBIT_EXECUTION_HISTORY_DAYS`, keeping
the 365-day value only as the provisional anchor. Alternatively, write the walk start ISO, never
`-infinity`, when the bound read returned an error.

### IN-04: LOW — the failed epilogue-write log names `binance_stop_below_cursor` on OKX, Bybit and Deribit runs that never set it

**File:** `analytics-service/services/job_worker.py:3125-3132`

**Issue:** The venue word was removed from the message, but its tail still reads "...re-read only
if the provisional bound written before the read landed (binance_stop_below_cursor)". Off Binance
the flag is deliberately not set (`if _binance_read:`). An operator grepping flags after this ERROR
on an OKX key finds nothing.

**Fix:** Name the flag only on Binance, for example with a `flag_note` string chosen by
`_binance_read`, or drop the parenthetical and keep `phase2_fill_ingestion_failed` as the named
signal.

### IN-05: INFO — the OKX stuck-cursor silent stop clears the bound (acknowledged; hand-over item 4 books it)

**File:** `analytics-service/services/exchange.py` (`_fetch_raw_trades_okx_inst_type`,
`natural_break = True` on `not new_cursor` and on a repeated cursor)

**Issue:** This is the one non-complete off-Binance read that `_earliest_through` cannot see: no
flag and no raise, so the epilogue clears the row and the cursor advances. It was known before
this phase and is outside SC-1. 255-03-SUMMARY "Ship hand-over" item 4 books it as a MEDIUM+
residual. It is recorded here so the review's list of clear-predicate gaps is complete.

**Fix:** As booked. The minimal root fix is to return `hit_page_cap=True` (or a distinct
`sync_truncated_okx_stuck` flag) from those two breaks so the existing predicate keeps the bound.

### IN-06: INFO — stale or garbled comments after the gate split

**File:** `analytics-service/services/job_worker.py:2320` ("a Binance run whose provisional re-read
bound could not be recorded"), `:2602` ("only when a Binance run held its store"), `:2672`
("`_binance_read` are read here as the run's seed", which is now `_bound_read`), `:380-381` ("keeps
the bound off Binance when `phase2_failed`…", which reads as "the bound is kept off Binance"; the
intent is "off Binance, keeps the bound when…"). The bound table's catalog COMMENT still says
"Binance" (CONTEXT Deferred).

**Fix:** Reword those four comment lines. The catalog COMMENT waits for the next migration, as
deferred.

### IN-07: INFO — the negative-millisecond round trip through `parse_since_ms` is inexact

**File:** `analytics-service/services/exchange.py` (`parse_since_ms`: `int(dt.timestamp() * 1000)`)

**Issue:** Measured: over `x` in `[-5000, 0]`, 48 values come back 1 ms later
(`parse_since_ms(_iso_of_ms(-4095)) == -4094`). `int()` truncates toward zero. 200,000 sampled
positive instants round-trip exactly, and the Deribit consecutive-failure chain (-1, -3600002,
-7200003, …) round-trips exactly. Only Deribit can produce negative bounds, and its read ignores
them, so this is inert.

**Fix:** None needed unless a venue with a real negative bound ever appears. `math.floor`, or an
integer-exact `(dt - EPOCH) // timedelta(milliseconds=1)`, would make it exact.

### IN-08: INFO — test coverage gaps

**File:** `analytics-service/tests/test_nullanchor_bound.py`

**Issue:**
- The matrix doubles `fetch_raw_trades`, so the per-venue reader facts the design rests on are
  established by reading the code, not by any test: Deribit ignores `since_ms`, Bybit's
  `start_too_old` line, and OKX's `begin` handling (WR-02).
- No off-Binance arm asserts that the recovering run 2 clears the bound row, so `bounds.rows == {}`
  after run 2 is never checked. The bound's lifetime after recovery is pinned only by the
  single-run `test_a_clean_read_writes_the_seed_then_clears`.
- No arm covers IN-01 (a Deribit NULL-column run 2 that fails again).

**Fix:** Add `assert bounds.rows == {}` after a clean run 2 in one matrix arm per venue, and one
Deribit two-failure arm asserting the column stamp is not pre-epoch once IN-01 is fixed.

---

_Reviewed: 2026-11-27T10:44:51Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
