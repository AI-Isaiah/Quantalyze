# Phase 177: DERIBITFLOWS - Research

**Researched:** 2026-10-28
**Domain:** Python analytics worker (`analytics-service`): Deribit moved-flow pricing inside the NAVMTM mark-apply seam, one new public Deribit market-data read, one counts-only log line.
**Confidence:** HIGH for repo mechanics, the venue read (probe-verified 2026-10-28) and the storage conventions; MEDIUM for the thinly-traded-minute refusal rate (A5) and the untested supabase-py list-upsert forms (A11)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Carried (not re-asked)**
- MARKSOURCE 167.2.1.1.1.1 plan 03: `FlowInstant.amount_prior_day` (the amount counted in the mark day) and `MarkedSeries.flow_moves_out` (the stored amount that leaves the read day); both `job_worker` stored-flow consumers apply `+in` on the mark day and `-out` on the next day. For a flow with `amount_prior_day = None`, in == out.
- MARKSOURCE RESEARCH A5 / plan 03 SUMMARY: Deribit's `native_flow_instants` values an instant at the mark of its own day; same shape as the MT5 case; left unchanged there, "measure-then-book".
- NAVMTM: the stored Deribit mark prices each currency at Deribit's own index read at `marked_at` (`DERIBIT_USD_BASIS = "venue_index_at_marked_at"`, `price_day` NULL). The per-currency index at `marked_at` is not stored.
- Founder 2026-10-27 "Deribit moved-flow pricing (Recommended)" booked this phase.

**D-01 SC-1 measurement.** Founder 2026-10-28, AskUserQuestion: "Upper bound + derive log (Recommended)". Record the SQL upper bound now, and add one counts-only log line in the derive saying how many Deribit flows it moved, so the next nights give the real count.

SC-1 upper bound, measured on PROD 2026-10-28 (marker named PRODUCTION; counts only): deribit_marks=16, deribit_keys_with_marks=8, first_mark_day=2026-10-26, last_mark_day=2026-10-27, max_read_after_midnight=06:41:58, median_read_after_midnight_s=12366 (about 3.4 h). Both mark days were read on the old 04:30Z chain. NAVMTM moved the chain to 00:10Z from mark day 2026-10-27 on, where Deribit marks land roughly 00:40-01:21Z.

Why SQL gives only an upper bound: PROD stores no per-flow Deribit data. `api_key_nav_marks` holds the marks and `marked_at`; the `key_inputs:<key>` rows of `allocator_equity_derived` hold day-summed flows with moves already applied. The exact count needs Deribit's transaction log, which only the derive reads; hence the log line.

**D-02 Moved-flow price.** Founder 2026-10-28, AskUserQuestion (first answer): "Flow's own index (Recommended)". Use the Deribit index on the flow's own transaction row, falling back to the ledger's day-D mark when the row has none. Research must confirm that deposit and withdrawal rows carry an index first. If they don't, stop and hand back.

The check came back negative from the repo, not from a live row: Phase 75 RESEARCH, the `deribit_txn.py` docstrings (`inverse_days_needing_index`, `deribit_dated_external_flows_usd`) and `tests/test_deribit_flow_fixtures.py` all state that a Deribit deposit or withdrawal row carries no own `index_price`.

**SUPERSEDED by the revisited answer.** Founder 2026-10-28, AskUserQuestion (D-02 revisited): "Fetch index at flow time", chosen over the recommended "Day-D ledger mark". The option as offered read: "Read Deribit's public 1-minute index or perpetual data at the flow's moment. Most accurate, but adds an exchange read to every derive that moves a flow, with its own retry and refusal handling. Larger scope."

Constraints that come with it (coordinator brief, 2026-10-28):
- Research pins down the exact public Deribit endpoint and resolution that give the index at an instant, its rate limits, and what happens when that read fails.
- A failed read is a named refusal or retry in the house vocabulary, never a silent fallback that writes a wrong number. Whether a fallback to the day-D mark is acceptable on failure is a further founder decision, raised as a gray area with a recommendation (open).
- New venue-read code goes through the existing exchange client patterns and keeps the 429 and cooldown handling (`_stamp_429`).

**D-03 Zero count.** Founder 2026-10-28, AskUserQuestion: "Fix anyway (Recommended)". Ship the fix with a test that is RED on own-day pricing. This widens SC-2's wording, so record that in the ROADMAP too.

### Claude's Discretion
- Where the at-instant index is attached to the moved instant (`deribit_flow_instants` / `native_flow_instants` / the derive), the log line's exact wording and level, provided it carries counts only (no key ids, no amounts tied to an account).

### Deferred Ideas (OUT OF SCOPE)
- Reading the real moved-flow count off the new log line after the next nightly derives (orchestrator, post-land).

Out of scope (CONTEXT `<domain>`): the legacy chain's cron and runbook files (MARKSOURCE plans 08 and 14 own them; Phase 176 LEGACYRETIRE is held), non-moved Deribit flows (they keep `flowqty x same-day mark`, NAVMTM D-23), MT5 (fixed by MARKSOURCE plan 03). Python only (`analytics-service`); no migration, no cron, no UI.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are assigned (REQUIREMENTS: TBD). The three ROADMAP success criteria (as amended 2026-10-28; SC-3 added with D-05) are the contract.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | The SQL upper bound is recorded (done, in CONTEXT D-01) and the derive logs one counts-only line of the Deribit flows it moved | "D-01 log line" below: placement beside the `nav marks applied` line, exact wording, no id fields, counts computed from the shared rule-10 predicate |
| SC-2 | A moved Deribit flow is priced at the open of the `{CCY}_USDC-PERPETUAL` 1-minute candle containing it (D-04); a test goes RED on own-day pricing; no fallback: structural no-data refuses `mark_flow_index_unavailable`, transient retries, 429 reaches `_stamp_429` (D-05) | "Standard Stack / Endpoint", "Architecture Patterns" (design), "Validation Architecture" (RED test with hand arithmetic), "Failure vocabulary" |
| SC-3 | Each resolved price is stored once in a service-role-only table (RLS forced, erasure path) and reused by later derives; migration-reviewer and rls-policy-auditor clean (D-05) | "Stored at-instant prices (D-05)": table shape, migration conventions, every census it moves, Python read/write path, SQL gate |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives that bind this phase (project `CLAUDE.md`, its imported `AGENTS.md`, user global rules, and the coordinator's standing rules):

- Python work runs from `analytics-service/` (pytest only from there). Analytics briefs carry CI's mypy line verbatim: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`. [VERIFIED: .github/workflows/ci.yml:5572]
- Every ship writes a CHANGELOG entry in the same commit as the VERSION bump (`chore(release): vX.Y.Z.B`), VERSION and package.json byte-equal 4-digit strings; never `npm version`. (Orchestrator's `/gsd-ship` owns this; plans should not touch them.)
- Never write a CI skip token anywhere (commit messages, PR bodies, planning text). No `Co-Authored-By` / `Claude-Session` lines, no "Generated with Claude Code".
- No secrets, PROD ids/uuids, home paths or account numbers in tracked text (public repo; `.planning/` is tracked). Log lines carry counts only.
- No `--linked`, no `db push`, no PROD/TEST/Railway access from plans. D-05 ADDS a migration: it needs migration-reviewer and rls-policy-auditor clean before merge, it auto-applies to TEST then PROD on merge with no human stop (every review happens before the merge), and any `CREATE OR REPLACE` must re-base on the latest definition (the recommended shape touches no existing function). The migration carries no explicit transaction statements and its verify block reads the catalogue only (no row), per the house rule `[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`.
- Tests must be able to fail: neuter, see RED, restore from a byte backup (never `git checkout/restore/stash` uncommitted work). Money-math oracles are independent hand arithmetic. Always `grep -a`.
- Fixer rounds: "For fix rounds minimal fix only, no new abstractions or defensive checks"; fix MEDIUM+ user-facing/data-integrity findings, at most 3 rounds, never LOW/INFO.
- Verification frontmatter holds only `status`, `verified_at_sha`, `drift_subjects` (never `covered_digest`/`covered_files`; never TODOS.md / CHANGELOG.md / VERSION / package.json in `drift_subjects`).
- Execute only via `/gsd-execute-phase 177` (no `--wave`, no plan number). Dispatch-isolation step before any `gsd-*` dispatch. Do not touch the legacy chain's cron or runbook files.
- Design System / Next.js notes in CLAUDE.md/AGENTS.md do not apply (no UI, no TS).

## Summary

The bug is real in the code, not only in theory. `native_flow_instants` values each Deribit instant as `fi.amount * ledger.marks[ccy].loc[Timestamp(fi.day)]`, the mark of the flow's OWN day. `apply_marks` rule 10 moves a flow dated D+1 and made at or before mark D's read into day D at `amount_prior_day` (falling back to `amount` when it is `None`). Deribit never sets `amount_prior_day`, so a BTC deposit at 00:05Z on D+1 is counted in D at `qty x mark(D+1)` while mark D's wallet already holds it and prices it at Deribit's index read at `marked_at`. I reproduced the arithmetic directly against `apply_marks`: with NAV 1244.42, base 1171.0 and a 0.0005 BTC deposit, r(D) is 22.42/1171 under own-day pricing (51.0), 22.92/1171 at an at-instant price of 101000 (50.5) and 23.42/1171 at the day-D mark (50.0). [VERIFIED: ran `apply_marks` this session]

The literal "index at the instant" is not obtainable from Deribit's public API at minute resolution for an arbitrary past instant. `public/get_index_price` is current-only; `public/get_index_chart_data` takes a coarse relative `range` (`1h`,`1d`,`2d`,`1m`,`1y`,`all`) with undocumented sampling and is not even in ccxt 4.5.64's implicit API; `public/get_funding_rate_history` is hourly; `public/get_mark_price_history` is 5-minute and options-only. The one random-access, minute-resolution public source is `public/get_tradingview_chart_data` with `resolution=1` on the `{CCY}_USDC-PERPETUAL` perpetual, the same instrument family the repo already uses as its lowest-precedence daily mark. That is a perpetual's traded price, not the index. RESOLVED by D-04 (founder 2026-10-28, "Perpetual 1-min candle (Recommended)"): the price is the `open` of the `{CCY}_USDC-PERPETUAL` 1-minute candle containing the flow, and the ROADMAP Goal and SC-2 now name that source. The public probe (below) verified candle-start ticks, 421 bars for a 7-hour window, an inclusive end and at least 730 days of 1-minute retention, while the literal index is served at 1-minute steps only for the last 48 hours.

The narrowest coherent design: value only the instants rule 10 will move, with one 1-minute candle read per (currency, mark day) group, attach the result as `FlowInstant.amount_prior_day = qty x price_at_instant`, and leave `amount` (the stored own-day value, which is what `flow_moves_out` removes from D+1) untouched. Two structural facts drive the plan. First, the derive CLOSES the exchange (`finally: aclose_exchange`) before the marks-apply seam, and the derive's own mark is written after the close, so the read must happen inside the Deribit crawl block against a predicted mark set (stored marks plus this derive's own `_mark_read_at`), with its failure captured and surfaced only after the mark write, and with a post-hoc coverage check at the apply seam so a prediction miss can never silently fall back to own-day pricing. Second, every derive re-applies ALL marks from the first one, so historical moved flows are re-priced every night. D-05 (founder 2026-10-28, "Refuse + store prices") answers this twice: there is no fallback (structural no-data refuses `mark_flow_index_unavailable`), and each resolved price is stored once in a new service-role-only table and reused, so an old flow is never re-read. The storage half is a migration and is covered in "Stored at-instant prices (D-05)"; the recommendation there is a per-api-key, write-once table that mirrors Phase 171's `allocator_trade_reads` access model.

**Primary recommendation:** Add `fetch_deribit_perp_minute_prices` (clone of `fetch_deribit_perp_daily_index`'s read discipline, `resolution="1"`) in `services/deribit_ingest.py`; extract rule 10's predicate once; give `native_flow_instants` an optional `at_instant_index`; prefetch pre-close in the derive (capture, do not raise before the mark write) and in the two stitch-composite member paths (exact marks, exchange open); refuse by name on any unpriced moved INDEXED flow; read stored prices BEFORE the exchange read and write each newly resolved price once (service-role-only `api_key_flow_prices`, ON CONFLICT DO NOTHING, see the D-05 section); log one counts-only `deribit flows moved by marks` line.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Decide which flows rule 10 moves | Analytics worker (pure fn, `nav_marks_apply.py`) | - | Pure and venue-free; one predicate shared by apply, prefetch and the coverage check so they cannot drift |
| Read price at an instant | Analytics worker via Deribit public market data (`deribit_ingest.py`) | External venue (Deribit public API) | Same module and exchange client as every other Deribit public read; no credentials needed, per-IP limited |
| Value moved flows (`amount_prior_day`) | Analytics worker (`native_nav.py::native_flow_instants`) | - | The single choke point all five call sites already go through |
| Place the read in the derive lifecycle | Analytics worker (`job_worker.py`) | Database (stored marks read) | Exchange lifetime and mark-write ordering live in the derive; composite members have an open exchange and exact marks |
| Persist moved flows / series | Database (existing `key_inputs`, `csv_daily_returns` writes) | - | Unchanged: the existing flow_moves consumers already store `+in` / `-out` |
| Observability of the count | Analytics worker logs | - | D-01: one counts-only log line, no storage, no migration |

No browser, SSR, CDN or UI tier is touched.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ccxt (async_support) | `ccxt==4.5.88` pinned; 4.5.64 installed in this checkout's interpreter | Deribit implicit API `public_get_get_tradingview_chart_data` | Already the only venue client; sibling readers use the same call [VERIFIED: analytics-service/requirements.txt:33 `ccxt==4.5.88`; ran `hasattr` against installed 4.5.64: `public_get_get_tradingview_chart_data True`, `public_get_get_index_chart_data False`] |
| pandas | existing | `Timestamp` / day arithmetic already used by `native_flow_instants` | No new use beyond the existing call |
| pytest + pytest-asyncio | pytest 9.0.2, `asyncio_mode = auto` | Tests | [VERIFIED: ran `pytest --version`; analytics-service/pytest.ini `asyncio_mode = auto`] |

### Supporting
None new. No new package is installed by this phase.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `get_tradingview_chart_data` 1-min on `{CCY}_USDC-PERPETUAL` | `public/get_index_chart_data` | The literal index, but `range` is relative to now (`1h`,`1d`,`2d`,`1m`,`1y`,`all`), sampling per range is undocumented, so a flow older than a few days cannot be priced at minute resolution; absent from ccxt 4.5.64's implicit API [CITED: docs.deribit.com/api-reference/market-data/public-get_index_chart_data] |
| same | `public/get_index_price` | Current index only, no timestamp parameter [CITED: docs.deribit.com/api-reference/market-data/public-get_index_price]. It is what NAVMTM uses at `marked_at`, which is why it cannot price a past instant |
| same | `public/get_funding_rate_history` | Hourly `index_price` per row, perpetual only [CITED: docs.deribit.com/api-reference/market-data/public-get_funding_rate_history]; up to an hour stale, worse than 1-minute candles |
| same | `public/get_mark_price_history` | 5-minute, "available only for a subset of options"; perpetuals return an empty list [CITED: docs.deribit.com/api-reference/market-data/public-get_mark_price_history] |
| Read before the exchange closes | A fresh public-only `ccxt.deribit` client opened at the apply seam | Needs no mark prediction, but is a second client outside `create_exchange` / `aclose_exchange` and the circuit-breaker pattern the brief asks to keep; rejected as default, see Open Question 3 |

**Endpoint, resolution, field (item 1):**
- Endpoint: `public/get_tradingview_chart_data`, via `exchange.public_get_get_tradingview_chart_data(params)` (the exact attribute `fetch_deribit_perp_daily_index` calls). [VERIFIED: analytics-service/services/deribit_ingest.py:709 `resp = await exchange.public_get_get_tradingview_chart_data(params)`]
- Parameters, all required: `instrument_name`, `start_timestamp` (ms), `end_timestamp` (ms), `resolution` with enum `1, 3, 5, 10, 15, 30, 60, 120, 180, 360, 720, 1D` ("only some specific resolutions are supported"). Result: `status` (`ok` or `no_data`), `ticks` (ms), `open`, `high`, `low`, `close`, `volume`, `cost`. [CITED: docs.deribit.com/api-reference/market-data/public-get_tradingview_chart_data]
- Instrument: `{CCY}_USDC-PERPETUAL` (linear, USDC-quoted), never the bare `{CCY}-PERPETUAL`. [VERIFIED: analytics-service/services/deribit_ingest.py:602 `_PERP_DAILY_INSTRUMENT_SUFFIX = "_USDC-PERPETUAL"`; the docstring at :597-601 says "NEVER the bare "{CCY}-PERPETUAL"". Note the repo's own claim that the bare name is "quoted in coin" is wrong for BTC/ETH (inverse USD-quoted); the suffix rule is kept because it is the repo's one convention and covers every INDEXED coin.] `BTC_USDC-PERPETUAL` appears as a real Deribit instrument in deribit_txn.py:1315 ("e.g. BTC_USDC-PERPETUAL carries currency=USDC but a BTC index_price"). [VERIFIED: analytics-service/services/deribit_txn.py:1315]
- Price at the instant (D-04): the `open` of the candle whose tick `T` satisfies `T <= at_ms < T + 60_000`, the minute containing the instant, and nothing else. If the perpetual printed no candle in that minute there is NO price: that is a structural no-data and a named refusal (D-05, no fallback, no carry-forward of an earlier close; this REPLACES the earlier draft's "else the latest earlier close" rule). The stored key is the candle's tick `T` (`minute_ms = at_ms - at_ms % 60000`). Tick = candle start, the containing candle being returned, an inclusive `end_timestamp`, 421 bars for a 7-hour window and at least 730 days of 1-minute retention are VERIFIED by the 2026-10-28 public probe (see "Public probe" near the end of this file).
- Basis: the candle is the perpetual's TRADED price, not Deribit's index. The perpetual is funding-anchored to the index, so the gap is typically small, and D-04 accepts it knowingly (A6, resolved). The mark itself uses the index at `marked_at`. Say this in the CHANGELOG / docstring; do not call the candle "the index".

**Rate limits (item 2):**
- Public, non-authorized requests are "rate-limited on a per-IP basis" and do not draw on the sub-account credit pool; the non-matching-engine default is 50,000 credits max, refill 10,000 credits/s, 500 credits per request (up to 20 requests/s, burst 100), and 10028 `too_many_requests` terminates the session when credits run out. The page says nothing special about `get_tradingview_chart_data`. [CITED: docs.deribit.com/articles/rate-limits]
- ccxt weights the call at 1 in its own throttle (`'get_tradingview_chart_data': 1` in the installed 4.5.64 deribit definition) and `create_exchange` sets `enableRateLimit: True`. [VERIFIED: ran against installed ccxt 4.5.64; analytics-service/services/exchange.py:857 region `"enableRateLimit": True`]
- Demand is tiny: one request per (currency, mark day) group that has a moved INDEXED flow with at least one minute not yet in the store (D-05), each spanning at most `[00:00Z of D+1, marked_at]` (observed read lag up to 06:41:58 on the old chain, so at most about 400 one-minute bars; about 80 on the 00:10Z chain). [CITED: 177-CONTEXT.md D-01 figures] Per-call bar cap is undocumented (A3); the window is far below any plausible cap.
- How the repo's public reads respect limits: every public reader retries `ccxt.NetworkError` (which covers `RequestTimeout`, `RateLimitExceeded`, `ExchangeNotAvailable`, `DDoSProtection`) with exponential backoff and raises `DeribitTransientReadError` on exhaustion. Verbatim: `PUBLIC_READ_MAX_RETRIES: int = LEDGER_MAX_RETRIES` [VERIFIED: deribit_ingest.py:90], `LEDGER_MAX_RETRIES: int = 8` [VERIFIED: :84], `PUBLIC_READ_BACKOFF_BASE_SECONDS: float = LEDGER_BACKOFF_BASE_SECONDS` [VERIFIED: :91], `LEDGER_BACKOFF_BASE_SECONDS: float = 1.0` [VERIFIED: :82], and `return isinstance(exc, ccxt.NetworkError)` in `_is_transient_read_error` [VERIFIED: :208]. Backoff is `PUBLIC_READ_BACKOFF_BASE_SECONDS * (2 ** (retries - 1))` [VERIFIED: :720]. A flaky HTTP-200 body is retried on the same budget through `_FlakyChartResponse` / `_validate_chart_ok_arrays` (GLB-4) [VERIFIED: :613, :627-660]; an explicit `status == "no_data"` is the one benign "no data" answer (`_CHART_NO_DATA_STATUS = "no_data"`, :610).

**Installation:** none.

**Version verification:** no package added, so no registry check applies. ccxt is pinned in `requirements.txt`; the interpreter in this checkout has 4.5.64, so any "attribute exists on the implicit API" claim about 4.5.88 is unverified here (A7).

## Package Legitimacy Audit

No external packages are installed or recommended by this phase. Audit not applicable. **Packages removed due to [SLOP] verdict:** none. **Packages flagged as suspicious [SUS]:** none. (The `gsd-tools package-legitimacy` seam was not run because there is nothing to check.)

## Architecture Patterns

### System Architecture Diagram

```
 Deribit txn-log crawl (existing)                    stored marks (DB, existing)
        |                                                     |
        v                                                     v
 NativeLedger.flow_instants  ---- raw (at_ms, day, qty_native, CCY) ----+
        |                                                              |
        |            derive_broker_dailies  (Deribit branch, exchange OPEN)
        |            ------------------------------------------------------
        |   predicted marks = read_key_marks(...)  U  {own mark: day(_mark_read_at)-1, read_at=_mark_read_at}
        |                                   |
        |                    rule10_placed(flow_instants, mark)   <-- ONE shared predicate (nav_marks_apply)
        |                                   |
        |            wanted = {(CCY, at_ms)} for INDEXED ccy only, grouped by (CCY, mark day)
        |                                   |
        |        stored prices (service-role-only table, per api key) read FIRST for the wanted minutes;
        |        only MISSING minutes go to the venue:
        |                          one GET per group:
        |                          public/get_tradingview_chart_data
        |                          {CCY}_USDC-PERPETUAL, resolution=1,
        |                          [00:00Z of D+1 .. max at_ms + 60 s]
        |                                   |   retry NetworkError/flaky 200 (8x, 1s*2^n)
        |                                   |   429 -> _stamp_429 ; budget out -> DeribitTransientReadError
        |                                   v
        |        new prices written ONCE (ON CONFLICT DO NOTHING) and re-selected; a store error is a captured failure
        |                                   v
        |                    at_instant_index {(CCY, at_ms): price}   or  captured failure
        |                                   |
 finally: aclose_exchange  (existing, ~7232)      |
 MARK WRITE (existing, ~7238-7353, write-once, marked_at = _mark_read_at)   <-- never blocked by the new read
        |                                   |
        v                                   v
 _stored_marks (all marks, ~7578)   apply seam (~7641-7770)
        |                                   |
        +--> native_flow_instants(ledger, indexable, at_instant_index)
                 amount            = qty * mark(own day)      (unchanged; what leaves D+1)
                 amount_prior_day  = qty * price_at_instant   (NEW; what is counted in D)
                 |
                 +--> coverage check: every rule-10-placed INDEXED instant (FINAL marks) has a price,
                 |    else FAILED/transient (or named permanent refusal for no-data), nothing written
                 v
        apply_marks(..., flow_instants)  -> flow_moves (+in) / flow_moves_out (-out)  (existing consumers)
                 |
                 +--> logger.info("... deribit flows moved by marks (moved=.. at_instant=.. usd_family=.. on_last_mark=.. mode=..)")  [D-01]

 stitch-composite member (exchange OPEN inside _reconstruct_deribit):
   _apply_member_marks / _apply_allocated_member_marks already hold the EXACT marks (relevant / marks)
   -> same prefetch with exact marks -> same native_flow_instants(at_instant_index) -> same check.
```

### Recommended Project Structure
```
analytics-service/
├── services/
│   ├── external_flows.py      # FlowInstant docstring: amount_prior_day is "the amount counted in the mark day"
│   ├── nav_marks_apply.py     # extract rule-10 predicate: placed instants for one mark (apply_marks uses it)
│   ├── native_nav.py          # native_flow_instants(..., at_instant_index=None)
│   ├── deribit_ingest.py      # fetch_deribit_perp_minute_prices (clone of fetch_deribit_perp_daily_index)
│   ├── flow_price_store.py    # NEW (D-05): read_flow_prices / write_flow_prices, sync, wrapped in db_execute by callers
│   └── job_worker.py          # derive prefetch+capture+check+log; composite member prefetch
└── tests/                     # see Validation Architecture
supabase/
├── migrations/<ts>_api_key_flow_prices.sql        # NEW (D-05); next free timestamp after 20261031120000
├── migrations/down/<ts>-rollback.sql              # NEW, keep-data rollback
└── tests/test_api_key_flow_prices.sql             # NEW SQL gate, ~9 arms with RED-UNDER twins
```

### Pattern 1: Shared rule-10 predicate (no drift)
**What:** `apply_marks` lines 265-277 define "placed" inline. Extract that to one function `placed_flow_instants(flow_instants, mark, mark_day) -> list[FlowInstant]` (same behaviour, `apply_marks` calls it) and use it from the prefetch and the coverage check. [VERIFIED: nav_marks_apply.py:270-272 `placed = [ fi for fi in flow_instants if fi.day == read_day and fi.at_ms / 1000.0 <= read_s ]`]
**When to use:** prediction (before the exchange closes), coverage check (after final marks), and the D-01 count.
**Why:** three consumers of one predicate; a parity test pins them equal. A copy of the condition in `job_worker` is the drift this repo's notes warn about.

### Pattern 2: Group by (currency, mark day), one request per group
**What:** all moved instants of one currency for one mark day lie in `[00:00Z of D+1, marked_at(D)]`; request that window once and select per instant.
**Example (illustrative, planner finalizes names/types):**
```python
# Source: shape of fetch_deribit_perp_daily_index (deribit_ingest.py:663-756); params per
# docs.deribit.com/api-reference/market-data/public-get_tradingview_chart_data
# D-04: only the `open` of the containing candle is used, so the reader may return {tick_ms: open}.
async def fetch_deribit_perp_minute_prices(
    exchange: Any,
    currency: str,
    *,
    start_ms: int,            # 00:00Z of the read day
    end_ms: int,              # max(at_ms) + 60_000
    sleep: SleepFn = asyncio.sleep,
    max_retries: int = PUBLIC_READ_MAX_RETRIES,
) -> dict[int, tuple[float, float]]:  # {tick_ms: (open, close)}
    params = {
        "instrument_name": f"{currency.upper()}{_PERP_DAILY_INSTRUMENT_SUFFIX}",
        "start_timestamp": start_ms,
        "end_timestamp": end_ms,
        "resolution": "1",
    }
    ...  # SAME retry loop as the sibling: NetworkError and _FlakyChartResponse retried on one budget;
         # budget out -> DeribitTransientReadError (a 429 on the last attempt: re-raise it, see Failure vocabulary)
         # status == "no_data" or BadSymbol -> a distinct, named structural error, never {} silently
```
The validator `_validate_chart_ok_arrays` returns only `(ticks, close)`; the new reader needs `open` too, so add a sibling validator or an optional argument without changing the two existing callers. Candle selection is a pure function (`price_for_minute(ticks_open, at_ms)`: the candle with tick `at_ms - at_ms % 60000`, else no price) with its own table-driven tests.

### Pattern 3: Prefetch inside the crawl, capture, surface after the mark write
**What:** inside the Deribit branch (exchange open, `native_ledger` and `_completeness` final, `_mark_read_at` known at job_worker.py:5020), compute `wanted` and read. Catch the failure into a local instead of raising. At the apply seam, after the mark write, run the coverage check and convert any gap into the failure disposition.
**Why this order is forced:**
- The exchange is closed before the apply seam: `finally: try: await aclose_exchange(ctx.exchange)` [VERIFIED: job_worker.py:7232-7236], and the repo already records that a read on a closed exchange raises: "a read on a closed exchange raises and would refuse every OKX key every day" [VERIFIED: job_worker.py:7055-7058].
- The marks the apply uses are read after the close and include this derive's own mark, which is written after the close: `_stored_marks = await db_execute(lambda: read_key_marks(...))` [VERIFIED: job_worker.py:7578-7580]; the mark write block says "the exchange is closed" and is ordered "BEFORE the ccxt combine (a later combine failure must not cost the mark)" [VERIFIED: job_worker.py:7238-7245]. A read failure raised inside the crawl would skip the mark write; capture-and-surface keeps the mark.
- The prediction is exact for stored marks (their `marked_at` is in the DB) and for this derive's own mark (`marked_at = _mark_read_at`, write-once so an earlier same-day row would already be in the stored read and wins). The coverage check on the FINAL marks makes any residual miss (a concurrent writer, a refused own mark) a loud transient retry, never an own-day price.
**Stored prices (D-05) slot into the same function, in this order:** (1) compute `wanted` with the shared predicate; (2) read the key's stored prices for the wanted `(instrument, minute_ms)` keys through `ctx.supabase` (a database read, allowed whatever the exchange state; zero database calls when `wanted` is empty); (3) group only the MISSING keys by (currency, read day) and fetch each group once; (4) write every newly resolved price once (`ON CONFLICT DO NOTHING`), then re-select so the stored row, not the local read, is what the index uses (the Pitfall-1 rule `write_nav_mark` follows); (5) build `at_instant_index` from stored plus fetched. A write failure is a named capture, like a read failure. Details, schema and census are in "Stored at-instant prices (D-05)".
**Composite members:** `_apply_member_marks` (job_worker.py:10039) and `_apply_allocated_member_marks` (:10126) are async, hold the exact marks and run inside `_reconstruct_deribit` with `ctx.exchange` open (the `aclose_exchange` is in the caller's `finally`, :10997). Prefetch there with exact marks and let failures propagate to the existing arms (below).

### Anti-Patterns to Avoid
- **Reading the index for every flow, or for every derive:** only rule-10-placed INDEXED instants; zero marks or zero moved flows means zero new exchange calls (derives without marks stay byte-identical, the same property the code comments claim at job_worker.py:7631-7636).
- **Raising out of the crawl on a failed read:** costs the day's mark (above).
- **A second copy of the rule-10 condition in `job_worker.py`.**
- **Calling the candle "the index" in code, logs or CHANGELOG.**
- **Defaulting a missing price to `amount`:** that is exactly the bug; an unpriced moved INDEXED instant must be a refusal, not a pass-through.
- **Touching the three existing readers' behaviour** (settlement, perp daily, option daily); the new reader is a clone, not a refactor of them.

## Where the moved instants are known (item 4)

`native_flow_instants` call sites (all value `ledger.flow_instants`, the raw native-quantity instants):

| Site | Lines | Exchange open there? | Marks known there? |
|------|-------|----------------------|--------------------|
| key-mode writer basis | job_worker.py:7663 | No (closed at :7232) | Only after :7578; predict beforehand |
| allocated-capital NAV twin (strategy mode) | :7715 (`_twin_ledger`) | No | Same; the twin shares the crawl, so the same `(CCY, at_ms)` keys |
| strategy-mode Deribit | :7732 | No | Same |
| composite, allocated member (`_twin_inputs`) | :10168 | Yes (inside `_reconstruct_deribit`) | Exact: `marks` argument |
| composite, plain member (`_deribit_apply_inputs`) | :10328 | Yes | Exact: `relevant` inside `_apply_member_marks` |

[VERIFIED: grep of `native_flow_instants` in services/job_worker.py: 220 (import), 7663, 7715, 7732, 10168, 10328.] The derive's non-writer-basis key-mode branch at :7672-7679 uses `_event_flow_instants`, which only the ccxt, sFOX and MT5 branches fill (assigned `[]` at :4918), so it moves no Deribit flow today and is unchanged.

`what leaves day D+1 stays the stored own-day amount` is coherent: the day aggregate stored on D+1 (`native_ledger_composed_flows`) values each flow at `qty x mark(D+1)`, which is exactly `fi.amount` after `native_flow_instants`. `apply_marks` removes `fi.amount` from D+1 (`flow_moves_out`) and adds `amount_prior_day` to D (`flow_moves`). [VERIFIED: nav_marks_apply.py:273-283 `moved_out = sum(_finite(fi.amount) ...)`, `moved_in = sum(_finite(fi.amount if fi.amount_prior_day is None else fi.amount_prior_day) ...)`, `flows[md] = flows.get(md, 0.0) + amount`, `flows[md + timedelta(days=1)] = ... - moves_out[md]`.] The two job_worker consumers apply `+in` on D and `-out` on D+1 (:7880-7907). USD-family instants keep `amount_prior_day = None` (1.0 both days).

## Failure vocabulary (item 3)

House vocabulary found in the repo:

| Case | Existing word | Disposition |
|------|---------------|-------------|
| Public read: network, timeout, 5xx, 429, flaky 200 | retry with backoff (8x, 1 s doubling) then `DeribitTransientReadError` | Retryable. Pinned: `assert classify_exception(DeribitTransientReadError("x"))[0] != "permanent"` [VERIFIED: tests/test_deribit_ingest.py:2517] |
| Public read: exchange RESPONDED with no data (`BadSymbol`, `status == "no_data"`) | siblings return `{}` and let the caller decide | Caller's call; here it must be a named failure, not `{}` |
| Marks cannot be applied | `MarkApplyRefusal` tokens `"mark_input_nonfinite"`, `"mark_days_not_ascending"` [VERIFIED: nav_marks_apply.py:114-119]; derive-level `_MARK_UNIT_MISMATCH: Final[str] = "mark_unit_mismatch"` [VERIFIED: job_worker.py:380] and `_MARK_ALLOCATED_NAV_UNRECONCILED: Final[str] = "mark_allocated_nav_unreconciled"` [VERIFIED: :385] | Permanent FAILED, `logger.error("derive_broker_dailies: nav marks refused (reason=%s ...)")`, strategy analytics stamped failed, nothing written (:7773-7795). Composite: `_refuse_member_marks(seq, reason)` (:10231) via an exception carrying `token` (`_MemberNavUnreconciled`, :388-394) |
| 429 | `_stamp_429(supabase, key_row, exc)` (job_worker.py:1388) stamps `api_keys.last_429_at` via the `stamp_api_key_429` RPC; skipped for a geo-block; the circuit breaker defers sibling jobs for `EXCHANGE_COOLDOWNS.get(exchange_name, 120)` [VERIFIED: :1303; deribit has no entry in the dict at :759-763, so the default 120 s applies] | Outer arms: derive `except ccxt.RateLimitExceeded: _stamp_429; raise` (:7229-7231); composite `except ccxt.RateLimitExceeded` stamps and returns a transient FAILED (:10852, :10974) |

Gap to close deliberately: the sibling public readers convert a 429 into `DeribitTransientReadError` after their budget, so a Deribit public 429 never reaches `_stamp_429` today. To keep the brief's "keep `_stamp_429`", the new reader should, when the final failed attempt was a `ccxt.RateLimitExceeded`, re-raise it instead of wrapping (documented deviation, pinned by a test). In the derive the capture block catches `ccxt.RateLimitExceeded`, calls `_stamp_429`, then records the failure; in the composite it propagates to the existing arm.

**Dispositions (D-05, founder 2026-10-28: no fallback, so these are decided, not recommended):**
- Transient exhaustion, 429: derive returns `DispatchResult(outcome=FAILED, error_kind="transient")` with static text and counts only, AFTER the mark write; composite lets it propagate (existing transient arms). Nothing written.
- Structural no-data (BadSymbol, `no_data`, no candle for the containing minute, non-finite or non-positive price): a new derive-level token `mark_flow_index_unavailable` on the `_marks_refusal` road (permanent FAILED + stamp, nothing written) and a composite sibling of `_MemberNavUnreconciled`. Token text carries no amount, key or instant.
- Store write or store read failure (a database error, or the table absent because the worker deployed before the migration): the same transient capture and `DispatchResult(FAILED, error_kind="transient")` with static text naming the store, never a silent skip and never a price used without having been stored first-writer-wins. A DB error otherwise bubbles and the job retries, as `write_nav_mark` documents.
- Never: `amount_prior_day = None` for a moved INDEXED instant. The coverage check is what makes this structural rather than a convention.
- Consequence to state in the plan, not hide: stored prices end the retention risk for flows already priced, but a minute that has NO candle can never be stored, so a moved flow in such a minute refuses on every derive until a founder action. Likely only for thinly traded `{CCY}_USDC-PERPETUAL` minutes of non-BTC/ETH coins (A5). That is the accepted cost of "no fallback"; the recovery is operational (the founder chooses a documented override), not code.

## D-01 log line (item 6)

`funding_label` IS an identifier: `funding_label = api_key_id` in key mode and `funding_label = strategy_id` otherwise. [VERIFIED: job_worker.py:4162, :4165] The existing line `derive_broker_dailies: nav marks applied (marks=%d since=%s gaps=%d mode=%s id=%s)` prints it (:7944-7949). The new line must not reuse `id=%s` and adds no identifying field.

Place it immediately after the `nav marks applied` `logger.info` (inside `if _marks_to_apply:`, only when `venue == "deribit"`), computing from the raw ledger instants and the marks actually passed to `apply_marks` (`_marks_in`) through the shared predicate, so USD-family and INDEXED can still be told apart (after `native_flow_instants` every currency is "USD"):

```python
logger.info(
    "derive_broker_dailies: deribit flows moved by marks "
    "(moved=%d at_instant=%d usd_family=%d on_last_mark=%d mode=%s)",
    n_moved, n_priced_at_instant, n_usd_family, n_on_last_mark,
    "key" if is_key_mode else "strategy",
)
```
Composite members: `run_stitch_composite_job: deribit flows moved by marks (seq=%d moved=%d at_instant=%d usd_family=%d on_last_mark=%d)` beside the existing `nav marks applied to member` lines (:10100-10103, :10224-10228), which already use `seq=%d` instead of an id.

Facts the reader of the log needs (put them in the plan, not only the code):
- Emit the line even when `moved=0`, so absence of a line is never read as zero.
- Every derive re-applies all marks since the first, so `moved` is CUMULATIVE over the key's mark history, not new-this-night; `on_last_mark` is the nightly increment. A derive retry logs again.
- A key is logged by its key-mode derive and again by the strategy-mode derive of any strategy on that key; read `mode=key` lines for a per-key count.
- A flow moved at `moved` but missing from `at_instant + usd_family` is impossible by construction (the coverage check fails the derive first).

## Stored at-instant prices (D-05)

D-05 (founder 2026-10-28, "Refuse + store prices") puts a small stored table in THIS phase: each resolved at-instant price is written once and reused by later derives. Constraints from CONTEXT: service-role-only access with RLS forced and no anon/authenticated grants (unless research shows a UI reads it; none does), an erasure path (ON DELETE CASCADE from `api_keys`, or a justified reason it holds no personal data), migration-reviewer and rls-policy-auditor clean before merge, PROD auto-applies after TEST, and "the planner decides the shape: key, currency, minute, price and source".

### 1. Table shape and the per-key versus global decision (item 1)

| Option | Key | Erasure | Fits the derive paths | Verdict |
|--------|-----|---------|-----------------------|---------|
| A. Per key, api_key_id only (RECOMMENDED) | `(api_key_id, instrument, minute_ms)` | `ON DELETE CASCADE` from `api_keys`, the founder's first option; account deletion reaches it through `api_keys` (sanitize purges the keys) | Every derive path already holds `ctx.key_row["id"]` (below) | Mirrors Phase 171's `allocator_trade_reads`, which has no `allocator_id`, no trigger and no function, and so moves no GDPR-manifest, owner-coherence or function-snapshot census |
| B. Per key plus `allocator_id` (the `api_key_nav_marks` shape) | adds `allocator_id UUID REFERENCES auth.users` | cascade from both | same | Rejected: no UI reads the rows, so the owner column, its policy and the SECURITY DEFINER owner-coherence trigger buy nothing; and `allocator_id UUID ... REFERENCES auth.users` makes the GDPR coverage script demand a `USER_EXPORT_TABLES` entry and a `SANITIZE_PARITY_ALLOWLIST` row plus a hand-added type |
| C. Global, `(instrument, minute_ms)` | no key column | none | no key needed | Rejected as the default, see below |

Why C is not recommended even though a public market price is not personal data on its face: the SET of stored minutes is the set of minutes at which some user made a deposit or withdrawal, so a row `(BTC_USDC-PERPETUAL, T)` carries the timing of a user's transaction without a name attached, and a global table has no path that removes it when that user's account is erased. "Holds no personal data" would therefore need an argument (pseudonymous, unlinkable) that a reviewer can contest, while Option A needs none: the founder's first listed erasure path applies as written. C's only benefit (sharing one price across keys) is negligible because rows exist only for moved flows. C also needs a read of "all rows for these minutes" across every key's rows with no ownership filter, which is the opposite of the isolation the worker's other tables have.

The "strategy mode and stitch-composite members may not have an api_key_id" worry does not bite. Every path that calls `native_flow_instants` already reads the key's marks by `ctx.key_row["id"]`: the derive at job_worker.py:7578-7580 (`read_key_marks(ctx.supabase, ctx.key_row["id"])`, both modes), `_apply_member_marks` at :10051-10052 (`key_id = ctx.key_row["id"]`), and `_allocated_member_marks` at :10114-10115. A strategy's Deribit derive and a composite member are always reached through a key row. [VERIFIED: job_worker.py:7578-7580, :10051-10052, :10114-10115] An allocated twin shares its parent derive's key.

Recommended columns (Option A). Planner may rename; keep the semantics.

| Column | Type | Rule |
|--------|------|------|
| `api_key_id` | `UUID NOT NULL REFERENCES public.api_keys(id) ON DELETE CASCADE` | part of the primary key |
| `instrument` | `TEXT NOT NULL` | `CHECK (instrument ~ '^[A-Z0-9]{2,10}_USDC-PERPETUAL$')` (the stored fact names what was read, instead of re-deriving it from a currency code that the suffix rule could one day change) |
| `minute_ms` | `BIGINT NOT NULL` | the candle's tick; `CHECK (minute_ms > 0 AND minute_ms % 60000 = 0)` |
| `price` | `NUMERIC NOT NULL` | the candle `open`; `CHECK (price NOT IN ('NaN', 'Infinity', '-Infinity') AND price > 0)`. Both halves are needed: in PostgreSQL ordering a numeric `NaN` is greater than every number, so `price > 0` alone admits it |
| `source` | `TEXT NOT NULL` | closed set `CHECK (source IN ('deribit_perp_1m_open'))`; a price stored under another rule must never be reused as this rule (the role `read_version` plays in Phase 171, TR-5) |
| `created_at` | `TIMESTAMPTZ NOT NULL DEFAULT now()` | informational |

`PRIMARY KEY (api_key_id, instrument, minute_ms)` is both the write-once arbiter for `ON CONFLICT DO NOTHING` and the lookup index. No other index, no surrogate id (nothing exports the table, so the GDPR export's `ORDER BY id` fallback that motivated the surrogate in `api_key_nav_marks` does not apply), no expiry column, no cron: rows are tiny, immutable facts, one per moved-flow minute. Suggested name: `public.api_key_flow_prices` (planner's call). Not backfilled; a row is created the first time a moved flow is priced, so the first derive after deploy writes the history it needs.

### 2. House migration conventions (item 2)

Closest analogs, by filename in `supabase/migrations/`:
- `20261031120000_allocator_trade_reads.sql` (Phase 171): the service-role-only, api_key-only, no-owner-policy, no-trigger shape. Copy its STEP layout, its "SERVICE-ROLE ONLY, ON PURPOSE" and "NO DATA CENSUS" header paragraphs, its self-verify block, and its rollback.
- `20261029120000_api_key_nav_marks.sql` (NAVMTM): the write-once grant (`GRANT SELECT, INSERT` to `service_role`, UPDATE/DELETE/TRUNCATE withheld), the finite-number CHECK, the named-constraint style, and the long `COMMENT ON TABLE` / `COMMENT ON COLUMN` style.

Conventions to reproduce, all read this session:
- Filename: 14-digit timestamp then snake_case name. The highest timestamp on this branch and on `origin/main` (after `git fetch`) is `20261031120000`; use the next free one (for example `20261101120000_api_key_flow_prices.sql`) and re-check at merge, because Phase 171's migration had to be renamed once when `20261030120000` was taken on main. [VERIFIED: ls supabase/migrations; commit 0ec3da15d "move the trade-read store migration to 20261031120000 - 20261030120000 is taken on main"]
- Header comment block stating what the table is for, the decisions inside it, the `NO DATA CENSUS RUNS INSIDE THIS MIGRATION` paragraph (`[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`), the `DEPLOY ORDER` paragraph, the transaction-style line (no explicit transaction statements; `SET LOCAL lock_timeout = '3s';` first), and the rollback path. [VERIFIED: api_key_nav_marks.sql header and `SET LOCAL lock_timeout = '3s';`]
- `CREATE TABLE public.<name>` with named constraints (`<table>_<what>_chk`), `NUMERIC` for money-like values, `ON DELETE CASCADE` on the key foreign key.
- RLS: `ALTER TABLE ... ENABLE ROW LEVEL SECURITY;` and `ALTER TABLE ... FORCE ROW LEVEL SECURITY;` with NO policy at all (the empty policy set is the statement, as in Phase 171). The write-once control is the grant, not a policy: `service_role` has BYPASSRLS. [VERIFIED: api_key_nav_marks.sql "WRITE-ONCE IS A GRANT, NOT A POLICY"; allocator_trade_reads.sql STEP 3]
- Grants: `REVOKE ALL ON TABLE public.<name> FROM PUBLIC, anon, authenticated, service_role;` then `GRANT SELECT, INSERT ON public.<name> TO service_role;` (verbatim quote of the analog's form: `REVOKE ALL ON TABLE public.api_key_nav_marks FROM PUBLIC, anon, authenticated, service_role;` and `GRANT SELECT, INSERT ON public.api_key_nav_marks TO service_role;`). UPDATE, DELETE and TRUNCATE are withheld; erasure still works because a foreign-key cascade runs with the table owner's privileges, which the SQL gate proves rather than assumes.
- `COMMENT ON TABLE` naming the phase and decisions (D-04, D-05), the write-once rule, the erasure path (and "do NOT add a delete-guard trigger; if one is ever added it MUST exempt `current_setting('quantalyze.sanitize_in_progress', true) = 'on'`"), and that nothing is backfilled. `COMMENT ON COLUMN` for `minute_ms`, `price` and `source`.
- Self-verify `DO $verify$ ... $verify$;` that reads the catalogue only (`to_regclass`, `pg_constraint`), and deliberately does not assert the grants, flags, policies or CHECK bodies (so the mutation gate can apply a mutated copy). It reads no table row.
- Rollback `supabase/migrations/down/<timestamp>-rollback.sql` in the keep-data style (rename aside, never DROP). [VERIFIED: supabase/migrations/down/20261029120000-rollback.sql header]
- No `CREATE OR REPLACE` of any existing function, so the "re-base on the latest definition" requirement is met vacuously; `delete_allocator_api_key` needs NO edit because it deletes from `api_keys` and the cascade follows (the nav-marks migration did not touch it either). [VERIFIED: supabase/migrations/20261028120000_replace_allocator_equity_snapshots_window.sql:335 is its latest definition; test_api_key_nav_marks.sql arm 6 proves the cascade through it]
- migration-reviewer invariants cited by the analogs: 3 (search_path on SECURITY DEFINER, n/a here), 7 (NUMERIC for dollars), 14 (no explicit transactions), 17 (EXECUTE grants, n/a here). With no function and no policy, rls-policy-auditor's surface is the forced RLS plus the empty policy set plus the grant matrix.

### 3. Every census and gate a new table and its gate file move (item 3)

Found by listing every file that names `api_key_nav_marks` or `allocator_trade_reads` (`grep -rl <table> --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.planning .`) and reading the two precedent commits that moved them (`git show --stat 5ff4ba968 03e6bb179 70d9aa56b` for Phase 171, `5218bb105` and `a29d0d856` for NAVMTM).

| Surface | Moves? | What | How to find it |
|---------|--------|------|----------------|
| `supabase/schema/baseline.sql` and `baseline-carried-migrations.txt` | No re-dump in the PR | The local-stack lane loads the dump and REPLAYS every migration the marker does not list (Phase 164.4.2 DECISION F), so a new migration is exercised by the lane without touching either file. The re-dump is an automated post-PROD-apply PR (`redump-dump` / `redump-pr` jobs; recent commits "baseline re-dump after the PROD apply of ..."). Do not hand-edit either file. `restore-test-from-baseline.sh` derives its expected table count from the dump (`grep -ac '^CREATE TABLE'`), so there is no hard-coded count to bump | `bash scripts/local-stack/run.sh up` prints `baseline-replay: N migration(s) newer than the dump`; `grep -n "EXP_TABLES=" scripts/restore-test-from-baseline.sh` |
| GDPR coverage hook `scripts/check-gdpr-export-coverage.ts` | No (Option A). Yes for Option B | The hook scans migrations for `user_id\|allocator_id\|...  UUID ... REFERENCES auth.users\|profiles` columns. A table with only `api_key_id ... REFERENCES api_keys` does not match: I evaluated the hook's own regex (`check-gdpr-export-coverage.ts:862`) on the recommended `CREATE TABLE` text: no match; adding an `allocator_id UUID NOT NULL REFERENCES auth.users` column: match | `npx tsx scripts/check-gdpr-export-coverage.ts` (exit 0 expected); `grep -n "allocator_trade_read" scripts/check-gdpr-export-coverage.ts src/lib/gdpr-export-manifest.ts` returns nothing for the Phase 171 precedent |
| GDPR export manifest `src/lib/gdpr-export-manifest.ts` | No (a derived cache, not exported) | Export inclusion is a founder question (Open Question 7); the 171 precedent does not export its store | `grep -n "api_key_nav_marks" src/lib/gdpr-export-manifest.ts` (the entry Option B would need) |
| Account-deletion erasure | Covered by cascade | `sanitize_user` purges `api_keys` (src/__tests__/sanitize-user.test.ts: "API KEYS PURGED"), so the cascade removes the rows; `delete_allocator_api_key` deletes the key row and cascades | `grep -n "API KEYS PURGED" src/__tests__/sanitize-user.test.ts`; the new SQL gate proves both cascades |
| Function snapshots `scripts/dump-sql-functions.ts`, `scripts/baseline-content-drift-check.mjs`, `supabase/schema/functions/` | No | These count FUNCTIONS; the recommended table adds none (Option B adds `enforce_..._owner_coherence` and would need the snapshot row and COMPARED_FLOOR bump the NAVMTM commit `111619079` made) | `node scripts/baseline-content-drift-check.mjs` |
| Generated types `src/lib/database.types.ts` | Hand-add recommended | Hand-added entries are the precedent (`allocator_trade_reads` at database.types.ts:336-342 with a dated comment; `api_key_nav_marks` at :433). Nothing in CI checks the file against the schema, and no TS reads this table, so adding it is hygiene against the next regeneration, not a gate | `grep -n "allocator_trade_read" src/lib/database.types.ts` |
| RLS / FORCE-RLS census over all public tables | None exists | I searched `supabase/tests`, `src/__tests__`, `scripts` and `.github` for `relrowsecurity`, `relforcerowsecurity`, `information_schema.tables` and `pg_tables`: the hits are per-table gates (this table's own gate is where the flags are asserted), `test_allocator_equity_derived_rls.sql`'s presence gate for another table, and `restore-test-from-baseline.sh`'s dump-derived count. No test enumerates public tables expecting a fixed set | `grep -rln "relrowsecurity\|relforcerowsecurity" supabase/tests src/__tests__ scripts .github` |
| New SQL gate file (see section 5) joins four counters | Yes | `scripts/mutation-floors.mjs` `FILES_FLOOR` (+1) and `ARMS_FLOOR` (+arms); `.github/workflows/ci.yml` `SENTINEL_FLOOR` (+1) and `ARMS_FLOOR` plus the contiguous per-file table above them; pins in `src/__tests__/drift-check-scripts.test.ts` (`SENTINEL_FLOOR=25` grep and its history comments), `src/__tests__/lint-sql-gates.test.ts` (`scanned N file(s)`), `src/__tests__/mutation-annotation-parser.test.ts` (`armsSeen`, `stepsSeen`), `src/__tests__/mutation-runner-floors.test.ts` and `src/__tests__/gate-family-meta.test.ts` (`FILES_FLOOR=`/`ARMS_FLOOR=` pins) | Read the live values, never copy numbers from here: `grep -nE '^export const (FILES_FLOOR\|ARMS_FLOOR\|WAIVED_CEILING)' scripts/mutation-floors.mjs`; `grep -n "SENTINEL_FLOOR=\|ARMS_FLOOR=" .github/workflows/ci.yml`; then run the five vitest files and read each stale-low failure message, the way both precedents did (`expected 25 to be 24`). The precedent commits moved exactly these files: `5ff4ba968` (floors and runner pins) and `03e6bb179` (CI census, drift-check-scripts, lint-sql-gates) |
| `scripts/prod-prober` | No | Its manifests are cron manifests (`cron-manifest.json`), not table lists | `ls scripts/prod-prober`; `grep -rn "allocator_holdings" scripts/prod-prober` returns nothing |
| `lint-migration-data-dependence` | Passes if no row is read | A data-reading `DO` block can pass PROD and refuse on shared TEST, which holds the catalogue and no data; the verify block must stay catalogue-only | `node scripts/lint-migration-data-dependence.mjs` |
| pg-lane fixtures for the new gate's cascade arms | Reuse | `scripts/pg-lane/fixtures/41-fixture-api-keys-user-id-fk.sql` already exists for exactly "account deleted through a table that hangs off `api_keys`"; the Phase 171 gate lists it in `RED-UNDER-SETUP` | read the `RED-UNDER-SETUP` line of `supabase/tests/test_allocator_trade_reads.sql` (line 91) |

The numeric floors will also have moved on `main` by merge time (other phases add gates), so these files are merge-conflict magnets: recompute them last, after merging main, with one full `node scripts/mutation-runner/run.mjs`. `sql-mutation` on a pull request runs FULL when mutation machinery files (this includes `scripts/mutation-floors.mjs`) change.

### 4. Python read and write path (item 4)

How the worker talks to Supabase today: a synchronous supabase-py client (`ctx.supabase`) whose calls are wrapped in `await db_execute(lambda: ...)` (bounded thread pool, `services/db.py:137`); `services/nav_marks.py` holds the sync functions and the caller wraps them. [VERIFIED: nav_marks.py `read_stored_mark`, `write_nav_mark`, `read_key_marks`; job_worker.py:7578-7580] Write-once is `upsert(row, on_conflict="api_key_id,mark_day", ignore_duplicates=True)` followed by a re-select of the stored row, which is the authority. [VERIFIED: nav_marks.py `write_nav_mark`]

`max_rows = 1000` is a hard response clamp (`supabase/config.toml:18`, `max_rows = 1000`), which `read_key_marks` handles with keyset paging that stops on the first EMPTY page, never a short one, with a page ceiling. MARKSOURCE's review flagged an unpaged read as WR-05 (MEDIUM, data integrity): an unbounded select silently truncated at 1000 rows and turned a material gap back into "unsizable"; its remedy was a bounded per-symbol read. [VERIFIED: 167.2.1.1.1.1-REVIEW.md WR-05 on the MARKSOURCE branch]

Recommended module `services/flow_price_store.py` (name is the planner's; Phase 171 used `services/trade_read_store.py`):
- `read_flow_prices(supabase, api_key_id, wanted: Mapping[str, Sequence[int]]) -> dict[tuple[str, int], float]`. Sync. One request per instrument per chunk of at most 100 `minute_ms` values: `.eq("api_key_id", ...).eq("instrument", ...).in_("minute_ms", chunk)`. A response is at most 100 rows, far below the 1000 clamp, so truncation is impossible by construction and no paging loop is needed; the wanted set is already bounded by the number of moved flows. Assert `len(rows) <= len(chunk)` and parse each row strictly (finite, `> 0`, minute in the chunk); a malformed stored row raises, never skips (the `_parse_stored` rule).
- `write_flow_prices(supabase, api_key_id, rows)`. Sync. `upsert(..., on_conflict="api_key_id,instrument,minute_ms", ignore_duplicates=True)` in chunks of at most 100, then re-select the same keys and return the STORED prices, so a concurrent writer's price (identical in practice, being the same candle open) is what the index uses. A database error raises `FlowPriceStoreError` with static text (no amount, no key), which the capture turns into the transient disposition.
- Call sites: `await db_execute(lambda: read_flow_prices(...))` and `await db_execute(lambda: write_flow_prices(...))`, inside the SAME pre-close prefetch function as the chart read (Pattern 3), BEFORE the exchange read so only missing minutes are fetched, and the write immediately after the chart read succeeds, BEFORE the apply and before the mark write. Writing before the apply is deliberate: a price that was read correctly is a permanent fact, so it is kept even when the derive later refuses for an unrelated reason, and a retry then costs no second chart request. The composite members run the identical function at `_apply_member_marks` / `_apply_allocated_member_marks`, where marks are exact.
- Zero database calls and zero chart calls when `wanted` is empty (no marks, no moved INDEXED flow), so a derive that moves no Deribit flow stays byte-identical and no existing fake needs a route for the new table.
- Deploy-order consequence (migration applies to PROD before the worker deploys, but this is not enforced): a new worker that finds the table absent gets a database error on the read, which is the named transient capture, so the affected derive retries until the table exists and never prices without the store. Only derives with a moved INDEXED flow touch the table.

Test fakes: the in-memory fake in `tests/test_nav_marks_writer.py` (`FakeDb`, `route_marks`, `_MarksQuery`) has no `.in_`/`.lt`; add a sibling route for the new table (a small `_FlowPricesQuery` with `eq`, `in_`, `upsert(ignore_duplicates=True)`), and use it to assert: (a) a second derive of the same scenario makes ZERO chart calls, (b) a pre-seeded stored price is used even when the scripted chart disagrees, (c) a write error is the named transient failure with the mark still stored.

### 5. SQL gate idiom for the new table (item 5)

Copy `supabase/tests/test_allocator_trade_reads.sql` (673 lines; the service-role-only, api_key-only gate) and borrow arm 2, 3 and 4 idioms from `supabase/tests/test_api_key_nav_marks.sql` (write-once byte-identical re-read, UPDATE refused 42501, DELETE and TRUNCATE refused). Conventions both files share, all read this session:
- Header lists the arms in executed order (the order is load-bearing: each twin's FIRST `TEST FAILED (N)` must name its own arm); anti-green-skip contract (absence of the table is an EXCEPTION, never a skip); a closing `RAISE NOTICE 'ALL N ARMS EXECUTED (1,...,N)'` sentinel before `ROLLBACK`; `pg_temp` helper functions that return values and never raise an identity; every `TEST FAILED (N)` raise sits directly in the `DO` body; synthetic data only (`@invalid.local`, generated uuids, no amounts in messages).
- Each arm carries a prose `-- RED-UNDER:` line and the machine-readable twin `-- RED-UNDER-M: {"arm":"N","apply":[{"kind":"edit","file":"supabase/migrations/<ts>_<name>.sql","find":"<exact text>","replace":"<mutated text>","occurrences":1}]}`; `occurrences` is a MEASURED count of the needle in the file (a mismatch is the distinct defect kind `occurrence-mismatch`). Grammar and rules: `scripts/mutation-runner/GRAMMAR.md`. Marker lines count only at comment-line start.
- A `-- RED-UNDER-SETUP: {"apply":[...]}` line lists the fixtures and migrations the throwaway pg-lane cluster applies. Reuse the Phase 171 line verbatim, ending with the new migration instead of `20261031120000_allocator_trade_reads.sql`. `07-fixture-supabase-default-privileges.sql` is what makes every REVOKE falsifiable and `41-fixture-api-keys-user-id-fk.sql` makes the account-deletion cascade reach `api_keys`. [VERIFIED: line 91 of test_allocator_trade_reads.sql]

Arms (suggested; each with its own twin):
1. anon and authenticated: SELECT and INSERT refused 42501 with the pinned text `permission denied for table <name>` (pin the message: FORCE RLS with no policy also answers 42501 for an INSERT and would hide a stray grant). Twin: `GRANT SELECT ON ... TO authenticated`.
2. service_role INSERT then SELECT works with no sequence grant; a second INSERT of the same key under `ON CONFLICT (api_key_id, instrument, minute_ms) DO NOTHING` stores 0 rows and `to_jsonb(row)` is byte-identical (write-once). Twin: widen the primary key.
3. service_role UPDATE refused 42501, row unchanged. Twin: add UPDATE to the grant.
4. service_role DELETE and TRUNCATE each refused 42501. Twin: add DELETE.
5. Key erasure: deleting the key through `delete_allocator_api_key` as the owning user removes its rows although service_role holds no DELETE; another key's rows stay. Twin: change `ON DELETE CASCADE` on the key foreign key to `NO ACTION`.
6. Account erasure: deleting the auth user removes the rows (through `api_keys`). Same twin family on the key foreign key (so give it a distinct twin, for example `RESTRICT`).
7. CHECKs, each refusal 23514 naming its own constraint: `price` 0, negative, NaN, `Infinity`; `minute_ms` not a multiple of 60000 and non-positive; malformed `instrument`; `source` outside the closed set; and the legitimate row accepted first. One twin per constraint (a `find` on each constraint text).
8. Primary key: a duplicate `(key, instrument, minute)` without ON CONFLICT is refused 23505 on the primary key; the same minute for another instrument and another minute for the same instrument are accepted.
9. Catalogue: RLS enabled AND forced, ZERO policies, the exact per-role privilege matrix (anon/authenticated none; service_role SELECT and INSERT only).

The sentinel then reads `ALL 9 ARMS EXECUTED (1,...,9)` (counts follow the final arm list). Once written, the file joins `sql-tests` automatically (an ordinary gate that posts nothing) and the pg-lane mutation run (`node scripts/mutation-runner/run.mjs --file supabase/tests/<new file>` for the narrowed measurement, then one full run for the floors). Python-side `test_nav_marks_writer_live.py` shows the optional live-DB (local stack) test idiom if the plan wants a worker-to-real-table check; it is not required.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Retry/backoff/flaky-200 handling for a public chart read | A new loop with new constants | Clone `fetch_deribit_perp_daily_index`'s loop with `PUBLIC_READ_MAX_RETRIES`, `PUBLIC_READ_BACKOFF_BASE_SECONDS`, `_is_transient_read_error`, `_FlakyChartResponse` | One read-retry policy is the stated intent (deribit_ingest.py:86-91 comment) |
| "Which flows does rule 10 move" | A second inline condition in `job_worker.py` | The extracted predicate in `nav_marks_apply.py` | Prediction, check and apply must agree by construction |
| 429 cooldown | Any new cooldown/sleep logic | `_stamp_429` + the existing circuit breaker | The brief and the repo's single mechanism |
| Exception text in logs | `str(exc)` | `scrub_freeform_string(str(exc))` (already imported in `deribit_ingest.py`) | Leak discipline used by every sibling |
| Day/instant parsing | New timestamp code | `_row_utc_day` / `_row_utc_instant` already produce `FlowInstant.day` / `at_ms` | Already tested |
| Mark/flow arithmetic | Any change to `apply_marks`' numbers | The existing `amount_prior_day` in/out split | MARKSOURCE plan 03 already reviewed it for both consumers |

**Key insight:** the pricing math is already built and reviewed. The phase is a venue read plus plumbing that guarantees the read's result, or a named failure, is what `amount_prior_day` carries.

## Common Pitfalls

### Pitfall 1: The exchange is closed before the apply seam
**What goes wrong:** reading at the apply seam raises on a closed client (B1, job_worker.py:7055-7058), or a lazily reopened client leaks a session.
**How to avoid:** prefetch inside the Deribit block; composite members are already open.
**Warning signs:** a test that mocks `aclose_exchange` (`_base_patches` does) passes while production fails. Add an assertion that the read happens before the patched `aclose_exchange` call (record call order).

### Pitfall 2: A failed read costs the day's mark
**What goes wrong:** raising from the crawl skips `_write_nav_mark_for_this_derive`; a persistent outage loses marks.
**How to avoid:** capture the failure, write the mark, surface the failure at the seam. Test: failing read, then assert the derive's own mark IS stored while no `csv` rows or `key_inputs` are written.

### Pitfall 3: Prediction miss falls back silently to own-day pricing
**What goes wrong:** a concurrent writer or a refused own mark changes the final mark set; an instant that rule 10 now moves has `amount_prior_day = None` and is priced at `amount` (the bug, silently).
**How to avoid:** the coverage check on the FINAL marks with the shared predicate; test it by predicting with the wrong `marked_at`.

### Pitfall 4: Historical moved flows are re-priced every night
**What goes wrong:** `_stored_marks` is every mark since the first, `apply_marks` re-runs from the first, so each derive wants a price for every historical moved flow. Without a store, each night re-reads them all and the price is only as stable as Deribit's 1-minute history.
**How to avoid:** D-05. Read the key's stored prices first and fetch only missing minutes; a stored price is write-once, so the number a flow was priced at last night is the number it is priced at tonight whatever the source later serves. Retention is verified to at least 730 days, so the store is a stability and cost property, not a retention rescue. Warning sign: the derive makes a chart request for a minute that already has a stored row (assert zero chart calls on a second derive of the same scenario).

### Pitfall 5: Unscripted `AsyncMock` exchange hangs tests
**What goes wrong:** the derive tests build `ctx.exchange = AsyncMock()`; an unscripted `public_get_get_tradingview_chart_data` returns a mock, the validator calls it flaky, and the real backoff (1+2+4+...+128 s) runs.
**How to avoid:** every new test scripts the exchange explicitly and sets `services.deribit_ingest.PUBLIC_READ_BACKOFF_BASE_SECONDS` to 0.0 (or injects `sleep`) in failure tests. The no-moved-flow tests assert `public_get_get_tradingview_chart_data.assert_not_called()`.

### Pitfall 6: `native_flow_instants` erases the currency
**What goes wrong:** after valuation every instant has `currency="USD"` (native_nav.py:1140-1143), so counting USD-family vs priced-at-instant afterwards is impossible.
**How to avoid:** count from the raw ledger instants and `classify_currency` (`MarkBranch.INDEXED` / `USD_FAMILY`), before valuing.

### Pitfall 7: Allocated twin and plain ledger share instants
**What goes wrong:** two ledgers (`native_ledger` and `nav_twin_ledger`) carry the same raw instants; keying the index by `(CCY, at_ms)` serves both, but a per-ledger fetch would double the reads.
**How to avoid:** one mapping per derive, keyed by `(CCY, at_ms)`.

### Pitfall 8: Candle edge cases
**What goes wrong:** instant on an exact minute boundary, instant in a minute with no trades, `open` of a bar that opened after the instant by up to 59 s.
**How to avoid:** the D-04 rule (the containing minute's `open`, no candle means no price and a named refusal), table-driven tests for each edge, `end_timestamp = max(at_ms) + 60_000` so the containing bar is inside the window (the inclusive end is VERIFIED by the probe).

### Pitfall 9: Untrusted exchange numbers
**What goes wrong:** a string, NaN, 0 or negative price becomes `amount_prior_day`.
**How to avoid:** `float()` coercion with a finite and `> 0` guard (same as `build_deribit_indexable_currencies`, deribit_ingest.py:1152-1157); failure is structural, not a default.

## Code Examples

### The hand-arithmetic oracle (verified against `apply_marks` this session)
```python
# Source: ran services.nav_marks_apply.apply_marks with the scenario below.
# Marks: 03-06 NAV 1050.0, 03-07 NAV 1071.0, 03-10 NAV 1244.42 (read 00:10Z next day).
# Flow of 100.0 on 03-08. Deposit 0.0005 BTC at 00:05:20Z on 03-11, inside mark 03-10.
# Ledger day marks: BTC 03-10 = 100_000.0, 03-11 = 102_000.0. Candle open at 00:05 = 101_000.0.
#   own-day (OLD):   amount_prior_day None  -> in 51.0   -> r(03-10) = (1244.42 - 1171 - 51.0) / 1171 = 22.42 / 1171 = 0.019146029...
#   at-instant (NEW): amount_prior_day 50.5  -> in 50.5   -> r(03-10) = 22.92 / 1171 = 0.019573014...
#   day-D (if allowed): amount_prior_day 50.0 -> in 50.0  -> r(03-10) = 23.42 / 1171 = 0.02
#   out of 03-11 in all three: 51.0 (the stored own-day amount), so 03-11 nets to 0.0
# base = level(03-07) 1071.0 + flow(03-08) 100.0 = 1171.0
```

### Wiring points (illustrative)
```python
# native_nav.py
def native_flow_instants(ledger, *, indexable_currencies, at_instant_index=None):
    ...
    elif branch is MarkBranch.INDEXED:
        mark = ledger.marks[fi.currency].loc[pd.Timestamp(fi.day)]
        prior = None if at_instant_index is None else at_instant_index.get((fi.currency, fi.at_ms))
        out.append(fi._replace(
            amount=fi.amount * float(mark),
            currency="USD",
            amount_prior_day=None if prior is None else fi.amount * prior,
        ))
```
`amount_prior_day` is read by `apply_marks` only for placed instants, so a superset prefetch is harmless; the coverage check, not this function, enforces completeness.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Deribit moved flow valued at `qty x mark(own day)` | `qty x price at the instant` for rule-10-moved INDEXED instants | This phase | Removes the F x (mark(D+1) - price at the flow) residue from r(D) |
| MT5 BTC moved flow at own-day close | `amount_prior_day` = close of mark day | MARKSOURCE plan 03 (merged at b2daab890) | Same shape; Deribit's mark price source differs (index at `marked_at`, not a daily close), which is why a venue read is needed |

**Deprecated/outdated:** nothing to remove. The "left unchanged there, measure-then-book" note (RESEARCH A5) is closed by this phase.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python | tests, mypy | yes | 3.14.3 | - |
| pytest | tests | yes | 9.0.2 | - |
| mypy | CI parity | yes | 2.0.0 | - |
| ccxt (interpreter in this checkout) | reader tests (stubbed exchange) | yes | 4.5.64 (pinned 4.5.88) | tests script the exchange; no network |
| Deribit public API | production behaviour only | probed by the orchestrator 2026-10-28 (see "Public probe") | - | - |
| Node 25 + vitest | census pins in section 3 | node yes (v25.8.1); `node_modules` is absent in this worktree, so `npm ci` first | - | none; the census vitest files cannot run without it |
| PostgreSQL 16 server binaries (pg-lane / mutation runner) | the new SQL gate | yes: `bash scripts/pg-lane/run.sh --print-pgbin` prints the `postgresql@16` bin dir | 16 | CI runs the gate; local run is the fast loop |

[VERIFIED: ran `python3 --version`, `python3 -m pytest --version`, `python3 -m mypy --version`, `import ccxt; ccxt.__version__`]. The 39 tests in `tests/test_nav_marks_flow_instants.py` + `tests/test_nav_marks_apply.py` and 4 Deribit/moved tests in `tests/test_nav_marks_compose_roundtrip.py` pass on this checkout. [VERIFIED: ran]

**Missing dependencies with no fallback:** none.
**Wave-0 checkpoint, DONE 2026-10-28 (kept for lineage; results in "Public probe"):** (a) `public/get_index_chart_data` with `index_name=btc_usd` and `range=2d`: read the timestamp spacing; if it is one minute the literal index is available for recent instants and Open Question 2 changes. (b) `public/get_tradingview_chart_data` for `BTC_USDC-PERPETUAL`, `resolution=1`, a window around an instant about 2 days old, then about 30, 90 and 365 days old: record whether `status` is `ok`, whether `ticks[0]` equals the requested start (candle start), bar count for a 7-hour window, and the oldest age that still returns 1-minute bars (retention, A2). Record the findings in the plan, not the numbers of any account.

## Validation Architecture

> `workflow.nyquist_validation` is `true` in `.planning/config.json`. [VERIFIED: file read]

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.0.2, `asyncio_mode = auto` |
| Config file | `analytics-service/pytest.ini` |
| Quick run command | `cd analytics-service && python3 -m pytest tests/test_nav_marks_flow_instants.py tests/test_nav_marks_apply.py tests/test_nav_marks_derive_apply.py tests/test_nav_marks_compose_roundtrip.py tests/test_nav_marks_composite.py -q` |
| Full suite command | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` [VERIFIED: .github/workflows/ci.yml:5730] |
| Type gate | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` |

### Phase Requirements -> Test Map
| Req | Behavior | Test Type | Automated Command | File Exists? |
|-----|----------|-----------|-------------------|--------------|
| SC-2 | Moved Deribit BTC deposit (0.0005 BTC at 00:05:20Z on 03-11, inside mark 03-10) is counted at the at-instant price: `rows["2026-03-10"] == approx(22.92 / 1171.0, abs=1e-12)`; stored `composed_flows` 03-10 == 50.5; compose reproduces every mark. RED on current code (22.42/1171) | integration (real derive, stubbed ledger + scripted exchange) | `pytest tests/test_nav_marks_compose_roundtrip.py::test_deribit_moved_btc_flow_priced_at_the_instant_price -x` | no, Wave 0 (mirror `test_moved_btc_flow_priced_at_the_mark_day_close`, :1004) |
| SC-2 | Same case where the derive writes its OWN mark (not pre-seeded): the prediction path | integration | `pytest tests/test_nav_marks_compose_roundtrip.py::test_deribit_moved_flow_uses_this_derives_own_mark -x` | no, Wave 0 |
| SC-2 | Failing read (`ccxt.RequestTimeout` every attempt, backoff patched to 0): derive FAILED `error_kind="transient"`, the derive's own mark IS stored, no csv rows / `key_inputs` written | integration | `pytest tests/test_nav_marks_compose_roundtrip.py::test_deribit_moved_flow_index_read_failure_is_named_and_keeps_the_mark -x` | no, Wave 0 |
| SC-2 | `RateLimitExceeded` on the last attempt: `_stamp_429` called once, transient result | integration | `pytest tests/test_nav_marks_compose_roundtrip.py -k moved_flow_index_rate_limited -x` | no, Wave 0 |
| SC-2 | Structural no-data (`status: no_data`, `BadSymbol`, no candle for the containing minute, non-finite or non-positive open): refusal `mark_flow_index_unavailable`, permanent, nothing written, no fallback (D-05) | integration | `pytest tests/test_nav_marks_compose_roundtrip.py -k moved_flow_index_no_data -x` | no, Wave 0 |
| SC-2 | No moved INDEXED flow (USDC deposit in window; BTC deposit outside the window; no marks): zero calls to the chart endpoint | integration | `pytest tests/test_nav_marks_compose_roundtrip.py -k no_chart_read -x` | no, Wave 0 |
| SC-2 | Prediction miss: prefetch used a wrong `marked_at`; the seam's coverage check fails the derive instead of using own-day pricing | integration | `pytest tests/test_nav_marks_derive_apply.py -k coverage_check -x` | no, Wave 0 |
| SC-2 | `native_flow_instants(..., at_instant_index=)` sets `amount_prior_day = qty x price` for INDEXED only; USD-family stays `None`; no index arg is byte-identical to today | unit | `pytest tests/test_nav_marks_flow_instants.py -x` | exists; add cases. Existing `test_a_days_deribit_instants_add_up_to_the_days_composed_flow` (:54) must stay green unchanged |
| SC-2 | Extracted rule-10 predicate equals what `apply_marks` moves (parity) | unit | `pytest tests/test_nav_marks_apply.py -k placed -x` | exists; add case |
| SC-2 | Candle selection table: containing-minute `open`, instant exactly on a minute boundary, a minute with no candle -> named no-data (NOT the earlier close), non-finite/<=0 open -> structural | unit | `pytest tests/test_deribit_ingest.py -k minute_prices -x` | exists; add cases (scripted-exchange classes at :2554 and :3950 are the pattern; `_SleepSpy` at :2506 area) |
| SC-2 | Reader retry discipline: transient retried with `[1.0, 2.0, ...]` waits then `DeribitTransientReadError`; flaky 200 retried; last-attempt 429 re-raised as `ccxt.RateLimitExceeded` | unit | `pytest tests/test_deribit_ingest.py -k minute_prices -x` | add |
| SC-2 | Composite members (plain and allocated) price a moved BTC flow with exact marks; failure propagates to the existing transient arm | integration | `pytest tests/test_nav_marks_composite.py -k moved -x` | exists; add cases (`run_deribit_composite` at :422) |
| SC-1 | One counts-only line `deribit flows moved by marks (...)` per Deribit derive; contains no key/strategy id substring; emitted at `moved=0` | integration (`caplog`) | `pytest tests/test_nav_marks_derive_apply.py -k deribit_flows_moved_log -x` | no, Wave 0 |
| SC-3 | Stored prices: a second derive of the same scenario makes ZERO chart calls and prices from the stored row; a pre-seeded stored price wins over a disagreeing scripted chart; only the MISSING minutes are fetched when one of two is stored | integration (fake store route) | `pytest tests/test_nav_marks_compose_roundtrip.py -k flow_price_store -x` | no, Wave 0 |
| SC-3 | Store write error: named transient failure, derive's own mark still stored, nothing else written; store read error likewise; no price is used that was not stored first-writer-wins | integration | `pytest tests/test_nav_marks_compose_roundtrip.py -k flow_price_store_fault -x` | no, Wave 0 |
| SC-3 | Store module: chunking at 100 keys, strict row parsing (finite, positive, minute in chunk), `ignore_duplicates=True` with the three-column `on_conflict`, re-select returns the stored row | unit | `pytest tests/test_flow_price_store.py -x` | no, Wave 0 (new file) |
| SC-3 | New table at the database boundary: 9 arms (anon/authenticated refused, write-once, UPDATE refused, DELETE/TRUNCATE refused, key cascade, account cascade, CHECKs, primary key, catalogue), each twin bites its own arm | SQL gate + mutation | `node scripts/mutation-runner/run.mjs --file supabase/tests/<new gate file>` then one full `node scripts/mutation-runner/run.mjs` | no, Wave 0 |
| SC-3 | Every census the new gate file moves reads green | vitest | `npx vitest run src/__tests__/drift-check-scripts.test.ts src/__tests__/lint-sql-gates.test.ts src/__tests__/mutation-annotation-parser.test.ts src/__tests__/mutation-runner-floors.test.ts src/__tests__/gate-family-meta.test.ts src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` | exists; pins move (section 3) |
| SC-3 | GDPR coverage hook still exits 0 (the table must not look user-owned to it) | script | `npx tsx scripts/check-gdpr-export-coverage.ts` | exists |
| SC-3 | Migration lints: catalogue-only verify block | script | `node scripts/lint-migration-data-dependence.mjs` | exists |
| SC-1 | The SQL upper bound is recorded in CONTEXT | doc check | `grep -a "deribit_marks=16" .planning/phases/177-*/177-CONTEXT.md` | yes (done) |

Hand-typed numbers in every test; the expected `r_D` is the hand arithmetic above (22.92 / 1171.0), never computed by the code under test.

### Neuter-and-see-RED (required by the project)
1. Run the new RED test against the unchanged tree: it must fail with `22.42/1171` vs `22.92/1171`.
2. After implementing, neuter each guard by byte-backup edit (never `git checkout/restore/stash`) and see the named test go RED, then restore from the backup: (a) pass `at_instant_index=None` in the derive wiring; (b) skip the coverage check; (c) raise instead of capturing; (d) drop the `_stamp_429` call; (e) skip the stored-price read (the zero-chart-calls test must go RED); (f) drop `ignore_duplicates=True` (the write-once test must go RED). Each must be caught by exactly the test that names it. The SQL gate's own neuter proof is the mutation runner (`RED-UNDER-M` twins), which restores the migration itself.

### Sampling Rate
- **Per task commit:** the quick run command above plus `pytest tests/test_deribit_ingest.py -k minute_prices`.
- **Per wave merge:** quick run + mypy line.
- **Phase gate:** full suite green and mypy clean before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/test_nav_marks_compose_roundtrip.py`: BTC variant of `derive_deribit_key` (ledger with `marks={"BTC": Series(03-10: 100000.0, 03-11: 102000.0)}`, instants `FlowInstant(at, "2026-03-11", 0.0005, "BTC")`, `_report` already has `indexable_currencies=frozenset({"BTC"})`, a scripted `ctx.exchange.public_get_get_tradingview_chart_data`).
- [ ] The scripted candle payload (hand-typed): ticks at 00:04, 00:05, 00:06 with opens 100_900.0, 101_000.0, 101_100.0 so containing-minute selection is distinguishable from an adjacent-candle rule, plus a second scripted payload with the 00:05 candle absent (the no-data refusal).
- [x] Public probe results recorded (orchestrator, 2026-10-28; see "Public probe" below): tick = candle start, containing candle returned, end inclusive, 421 bars per 7 hours, retention at least 730 days.
- [ ] `tests/test_flow_price_store.py` and a fake route for the new table (the `tests/test_nav_marks_writer.py` fake has no `in_`).
- [ ] The new SQL gate file `supabase/tests/<name>.sql` and the migration `supabase/migrations/<ts>_api_key_flow_prices.sql` with its `down/` rollback; all census pins (section 3) moved in one commit after merging `main`.

## Security Domain

> `security_enforcement` is absent from `.planning/config.json`, so it is enabled. [VERIFIED: file read]

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | The read is a public, unauthenticated endpoint; no credential is sent or logged |
| V3 Session Management | no | - |
| V4 Access Control | yes | New table, service-role only: RLS enabled and forced, zero policies, `REVOKE ALL` from PUBLIC/anon/authenticated/service_role then `GRANT SELECT, INSERT` to service_role only (write-once is a grant, not a policy, because service_role has BYPASSRLS); proven by the SQL gate and audited by rls-policy-auditor and migration-reviewer |
| V5 Input Validation | yes | Untrusted exchange numbers: `float()` plus finite and `> 0` guard before any price enters money math; array-shape validation as in `_validate_chart_ok_arrays` |
| V6 Cryptography | no | - |
| V7 Error Handling and Logging | yes | Counts-only log line, no key/strategy id, no amounts; exceptions pass through `scrub_freeform_string`; static user-facing text |
| V12 Resilience / DoS | yes | Bounded retries (8), bounded window (<= one day's early hours), per-group request count, existing wall-clock bound `_BROKER_CRAWL_TIMEOUT_S` around the prefetch |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed or poisoned venue price becomes money-math input | Tampering | finite and `> 0` guard; structural failure, never a default or last-known value |
| Silent fallback writes a wrong stored flow | Tampering | coverage check on final marks; named refusal; no `None` pass-through |
| Information leak through logs (key ids, amounts, raw error text) | Information disclosure | counts-only line without `funding_label`; scrub exception text |
| 429 storm from re-pricing history every night | Denial of service | group requests by (currency, mark day); `_stamp_429` and circuit breaker; bounded retries |
| A stored price is changed or removed by the worker or a browser role | Tampering | no UPDATE/DELETE/TRUNCATE grant; no anon/authenticated privilege at all; cascade is the only deletion path and runs with owner privileges |
| One user's transaction timing readable by another through the stored minutes | Information disclosure | per-key table, no authenticated or anon grant, no policy; no UI reads it; cascade erasure with the key and the account |
| Worker wedge on a hung public read | Denial of service | wrap the prefetch in `asyncio.wait_for(..., timeout=_BROKER_CRAWL_TIMEOUT_S)` like every other live crawl in the branch (FLIPRETRY-01) |

## Sources

### Primary (HIGH confidence)
- Repo, read this session at the worktree's HEAD: `analytics-service/services/{deribit_ingest.py, nav_marks_apply.py, native_nav.py, external_flows.py, nav_marks.py, deribit_txn.py, job_worker.py}`, tests `tests/{test_nav_marks_compose_roundtrip.py, test_nav_marks_flow_instants.py, test_nav_marks_derive_apply.py, test_mtm_single_key.py, test_deribit_flow_fixtures.py, test_deribit_ingest.py}`.
- docs.deribit.com `public/get_tradingview_chart_data`, `public/get_index_chart_data`, `public/get_index_price`, `public/get_funding_rate_history`, `public/get_mark_price_history`, `articles/rate-limits` (WebFetch this session).
- MARKSOURCE branch artifacts: 167.2.1.1.1.1-RESEARCH.md ("IN-02 (moved BTC flow ...)" and A5), 167.2.1.1.1.1-03-SUMMARY.md ("Follow-up candidate for the founder: Deribit"), 167.2.1.1.1.1-REVIEW.md (rule 10 in/out split applied consistently in both consumers).

- D-05 storage research (read this session): `supabase/migrations/{20261029120000_api_key_nav_marks.sql, 20261031120000_allocator_trade_reads.sql}` and their `down/` rollbacks, `supabase/tests/{test_api_key_nav_marks.sql, test_allocator_trade_reads.sql}`, `supabase/schema/BASELINE.md`, `scripts/check-gdpr-export-coverage.ts`, `scripts/mutation-floors.mjs`, `scripts/mutation-runner/GRAMMAR.md`, `.github/workflows/ci.yml` (sentinel census), `analytics-service/services/{nav_marks.py, db.py, trade_read_store.py}`, and the precedent commits `5ff4ba968`, `03e6bb179`, `70d9aa56b`, `5218bb105`, `a29d0d856`.

### Secondary (MEDIUM confidence)
- WebSearch for per-call candle cap and `get_index_chart_data` sampling: no authoritative answer found (explicitly an absent result, not evidence of absence).

### Tertiary (LOW confidence)
- None used as a basis for a recommendation.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ~~Ticks mark the candle START~~ VERIFIED by the 2026-10-28 public probe (first tick equals the minute boundary at or before `start_timestamp`) | Endpoint / candle selection | - |
| A2 | ~~1-minute retention undocumented~~ VERIFIED to at least 730 days by the probe; the store (D-05) makes it a stability property, not a rescue | Pitfall 4 | - |
| A3 | ~~7-hour window under the bar cap~~ VERIFIED: 421 bars, no truncation | Rate limits | - |
| A4 | ~~`end_timestamp` inclusive~~ VERIFIED: last tick equals `end_timestamp` | Pitfall 8 | - |
| A5 | `{CCY}_USDC-PERPETUAL` prints a candle in every minute for BTC and ETH; quiet minutes are plausible for other INDEXED coins | Candle selection, Failure vocabulary | With no fallback (D-05), a moved flow in a minute with no candle refuses on every derive until a founder action |
| A6 | ~~Perpetual traded price stands for the index~~ RESOLVED by D-04: the founder chose the candle `open` knowingly; the basis versus the index is accepted and must be stated in the CHANGELOG and docstring, never called "the index" | Endpoint / basis | A funding-stress basis puts a small residue back into r(D); accepted |
| A7 | ccxt 4.5.88 (the pin) has the same implicit API surface as the installed 4.5.64; `public_get_get_index_chart_data` may or may not exist there | Alternatives | Only matters if the index-chart route is revived after the probe |
| A8 | A moved-flow count is small (SC-1 upper bound gives marks, not flows) | Rate limits | If large, per-derive read count grows; grouping by (ccy, mark day) bounds it by the number of mark days with moved flows |
| A9 | Predicting this derive's own mark as `marked_at = _mark_read_at` matches what `write_nav_mark` stores when no same-day row exists | Pattern 3 | Covered by the coverage check, which turns any miss into a loud transient retry |
| A10 | A new worker may deploy before the migration applies (deploy order is not enforced, as in Phase 171) | Section 4, deploy-order bullet | A derive with a moved flow fails transient until the table exists; never a wrong number |
| A11 | The supabase-py client accepts `.in_("minute_ms", [...])`, `.upsert(list_of_rows, on_conflict="a,b,c", ignore_duplicates=True)` | Section 4 | `write_nav_mark` already uses single-row `upsert(..., ignore_duplicates=True)` with a two-column `on_conflict`; the list and three-column forms were not exercised this session, so the unit test against the fake and one local-stack run must prove them |
| A12 | Nothing outside the repo reads or lists public tables (an ad hoc admin tool, a dashboard) in a way a new table breaks | Section 3 | None expected; the in-repo census search found no table enumeration |

### Public probe, 2026-10-28 (orchestrator-side, unauthenticated public GETs, no PROD)

- `get_tradingview_chart_data`, `BTC_USDC-PERPETUAL`, `resolution=1`, 7-hour windows starting about 2, 30, 90, 365 and 730 days ago, `start_timestamp` set 20 s past a minute boundary: every window returned `status=ok`, **421 bars**, first tick equal to the minute boundary at or before `start_timestamp`, last tick equal to `end_timestamp`. **A1 VERIFIED** (a tick is the candle's start, and the candle containing `start_timestamp` is returned), **A2 VERIFIED to at least 730 days**, **A3 VERIFIED** (421 bars, no truncation), **A4 VERIFIED** (end inclusive).
- `get_index_chart_data`, `index_name=btc_usd`: `range=1d` and `2d` give 60 s spacing (the literal index at minute resolution, but only for the last 48 h); `range=1m` gives 3600 s spacing; `range=1y` gives 21600 s spacing. The literal index at minute resolution therefore exists only for flows under 48 h old. Because every derive re-applies all marks from the first one, a moved flow would be re-read nightly, so the literal index cannot price the same flow consistently after 48 h without persisting it. This bears on Open Question 2 (A6).

## Open Questions (RESOLVED)

Resolved since the first draft (kept short, for the planner's lineage):

1. **RESOLVED (D-05, founder 2026-10-28, "Refuse + store prices"): what happens when the at-instant read fails.** No fallback and no day-D mark. Transient failure retries (nothing written, the day's mark still stored); a 429 re-raises to `_stamp_429`; structural no-data refuses `mark_flow_index_unavailable`. Each resolved price is stored once and reused, in this phase, via a migration. The founder chose this over the recommended "Refuse by name" (store deferred); the cost is the table, its gate and the census pins in "Stored at-instant prices (D-05)".
2. **RESOLVED (D-04, founder 2026-10-28, "Perpetual 1-min candle (Recommended)"): whether the perpetual candle may stand for the index.** The price is the `open` of the `{CCY}_USDC-PERPETUAL` 1-minute candle containing the flow. ROADMAP Goal and SC-2 already name that source.
3. **Planner/design choice (not a founder decision): read pre-close with a predicted mark set, or open a second public client at the apply seam?** Recommendation unchanged: pre-close prefetch with prediction plus the coverage check. A second `ccxt.deribit` public client would remove the prediction but adds a client outside `create_exchange` / `aclose_exchange`.
4. **Planner discretion: emit the D-01 line when `moved=0`?** Recommendation: yes (absence must not read as zero). Level INFO, wording as above; confirm `on_last_mark` is wanted as the nightly increment.
5. **RESOLVED (orchestrator, 2026-10-28): the public probes** (candle start, bar count, retention, `get_index_chart_data` spacing). See "Public probe".

Open now:

6. **Per-key versus global table (inside D-05's "planner decides the shape").** Recommendation: per key, `api_key_id`-only, Phase 171's access model (Option A). Reason: the founder's first listed erasure path (ON DELETE CASCADE from `api_keys`) applies as written, while a global table of minutes would need a contestable "holds no personal data" argument because the stored minutes are the timestamps of users' transactions; and every derive path has `ctx.key_row["id"]`. It is a planner decision, but it is the one thing in the plan the founder's erasure requirement can overturn, so surface it at plan approval. If the founder prefers a global table, the section 1 table, the read (`in_` over minutes without an owner filter) and the cascade arms change; the census list is shorter, not longer. **RESOLVED 2026-10-28 by the orchestrator under D-05 "planner decides the shape": per-key `public.api_key_flow_prices` (plan 02). Surfaced to the founder at hand-back.**
7. **GDPR Art. 15 export of the stored prices: include or not?** Recommendation: not exported (a derived cache of a public price, keyed by key only so it can be erased; Phase 171's `allocator_trade_reads` store is not exported either). Including it means adding `allocator_id` (Option B) or an indirect manifest entry, plus the type and the sanitize allowlist row. Founder call because it is a privacy-scope statement; the cost of "include" is a larger migration and census. **RESOLVED 2026-10-28 by the orchestrator: not exported (plan 07 checks the GDPR coverage script still exits 0). Surfaced to the founder at hand-back.**
8. **Accepted risk to confirm, not a new decision: a moved flow in a minute that printed no candle refuses on every derive, indefinitely, with no fallback.** D-05 chose this. Stored prices fix the stability and cost of flows that WERE priced; they cannot help a minute with no candle. Likely only for thinly traded non-BTC/ETH coins (A5). The recovery path (what the founder does on such a refusal: wait, or an explicit documented override of one flow's price) is not designed here; ask at plan approval whether one is wanted in this phase or booked. **RESOLVED 2026-10-28: accepted under D-05 "No fallback"; no recovery path in this phase, named as a known limit (plans 04, 06). Surfaced to the founder at hand-back.**
9. **Retention of stored rows: none.** Recommendation: keep them for the life of the key (rows are immutable and tiny, one per moved-flow minute; no cron, no purge grant). A TTL would reintroduce the re-read the store exists to avoid. Mention only if the founder wants a bound. **RESOLVED 2026-10-28 by the orchestrator: no retention; rows live until the key cascade.**
