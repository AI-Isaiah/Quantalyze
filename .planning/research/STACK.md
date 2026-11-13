# Stack Research

**Domain:** Live parity harness for an existing MT5 ingestion path (v1.18 MT5-VERIFY, Phase 155: MT5-06..10, MT5-15, MT5-GOAL-01)
**Researched:** 2026-11-13
**Confidence:** HIGH for "what is installed and what it can do" (read from the lock, the repo and the unpacked `mt5linux` 0.1.9 wheel). MEDIUM to LOW for MT5 report formats and live tick behaviour (vendor docs are thin and nothing is measured live yet).

> **Bottom line: add no runtime package.** Everything the harness needs is already in
> `analytics-service/requirements.txt`, in the Python standard library, or reachable
> through the `mt5linux` 0.1.9 RPyC bridge the worker already uses. The real stack changes
> are two:
> 1. **A narrow, read-only widening of the `Mt5Client` facade**: one or two committed
>    remote expressions in the `_REMOTE_SESSION_SNAPSHOT_SRC` style.
> 2. **An execution channel.** The last recorded `railway ssh` attempt failed after
>    authentication on both analytics services (2026-11-03, Phase 175 D-06), and the terminal
>    lease is in-process only (section 3).
>
> There is also one optional dev dependency (`unpdf`), needed only if MT5-09 must read
> numbers out of the PDF bytes rather than the page the PDF is printed from.

> ⚠️ **Tooling note.** Context7 needed an OAuth flow this agent could not complete. Versions
> below come from the repo lock, the PyPI and npm registry JSON (fetched 2026-11-13), and the
> `mt5linux` 0.1.9 wheel source. No version claim here rests on training data. No live spike
> was run. Every "needs a live spike" item below is unmeasured.

---

## 1. Oracle capability matrix (read this first: it decides the rest)

The settled criterion is **within 1%, including open P&L, over a window that ends before
the run day** (founder, 2026-08-14). Measured against that, the possible oracles prove
different things:

| Oracle | What it proves | What it cannot prove | Independent of our gateway? | Stack cost |
|---|---|---|---|---|
| **A. Gateway snapshot** captured by the harness on an earlier day: `account_info()` `equity`, `balance`, `profit`, `credit`, `currency`, plus the server-clock probe | Past-dated **equity including open P&L** and **balance**, at a recorded instant. Tests the backward ledger fold (`reconstruct_mt5_nav_levels` / `combine_mt5_deal_ledger`) across every deal between the snapshot and the run-day anchor | That the gateway itself reads the broker correctly. It shares the pipe the app's anchor is read through | **No.** It is temporal independence only | None. `Mt5Client.account_info()` exists |
| **B. Founder's own terminal**, History tab, *Report* saved as HTML over the window | **Balance after every deal** (the deals table), so it gives the **realized-basis balance at any past instant**. That is the exact quantity the app reconstructs for interior days (see below) | Past-dated equity. The report's *Summary* (equity, floating P/L, balance) is the value **at generation time** (MetaQuotes help, verified) | **Yes**: a different terminal and a different login session | Stdlib `html.parser` only |
| **C. Founder reads the terminal live** during the scripted session (Trade tab: Balance, Equity, Profit) | Run-day equity and balance through a terminal we do not operate | Anything past-dated. Comparing the run day's equity with the app's run-day anchor is near-tautological (`initial capital = current_equity − total_pnl`) | **Yes** | None |
| **D. `tools/mt5/QuantalyzeDailyReturns.mq5`** attached to the founder's terminal | Daily pre-rollover **equity including floating P&L**, sampled every 15 s | Anything before the day it is attached. Its days are **server-date** buckets, not UTC. Its CSV holds returns, not levels | **Yes** | None. It is already in the repo |
| **E. Broker-emailed daily statements** | Possibly EOD balance and equity per server day | Not a platform feature. Whether these brokers send them at all is unknown (LOW) | **Yes** | Stdlib `email` + `html.parser`, if they exist |

**Two facts from the code that shape the comparison** (HIGH, read from `services/broker_dailies.py`):

1. **The reconstructed history is realized-basis (balance), by design.** The uPnL wedge
   `account_equity − account_balance` is removed from the anchor before the backward roll.
   The code is explicit: "historical open-position marks are not retrievable on a read-only
   key, so uPnL is NEVER spread back across history". So a rendered interior day equals
   **balance**, not equity.
   ⛔ **Consequence:** at the window ends, the app and the terminal's equity differ **by design**
   by the open P&L carried at those instants. Over the window, that is the **change in open
   P&L**. If that exceeds 1% of equity, an equity-vs-rendered comparison fails **with no bug
   anywhere**, and MT5-10 is uncapped. The roadmap must therefore define the criterion as
   two checks before any number is read:
   - rendered vs oracle **balance**, tight;
   - oracle **equity − balance** reported and bounded.
   Otherwise the founder's settled "including open P&L" wording collides with a deliberate
   design decision of the backbone. This is the first open question for the roadmap.
2. **Days bucket on the UTC day** (`deal_utc_day`). A snapshot must therefore record its
   instant near a **UTC midnight**, not the broker's server midnight (22:00 UTC in winter
   for a UTC+2 broker).

**Recommendation:** A + B as the pair, with C as the run-day tie-break. A is captured by
agents now, with no founder involvement, subject to the execution channel in section 3. B and C
are the founder's one scripted terminal session. D is the fallback if the founder wants an
independent equity series for future windows. It cannot cover a window that has already passed.

⭐ **Practical timing (MEDIUM, verify per account).** FX/CFD books are flat-priced between the
Friday close (about 22:00 UTC) and the Sunday open, so **the Friday UTC-midnight equity can be
captured at any time over the weekend** without pinning a capture to a midnight. That holds
only if the account holds no weekend-quoted symbol, such as crypto CFDs. The server-clock
probe (section 2.1) needs fresh ticks, so it must run on a trading day. Today, 2026-11-13, is a
Friday and still trades until about 22:00 UTC.

---

## 2. Recommended Stack

### Core technologies (all already installed and pinned; no change)

| Technology | Version (lock) | Purpose in the harness | Why |
|---|---|---|---|
| Python | 3.12 (`python:3.12-slim`, `pyproject.toml python_version = "3.12"`) | Harness runtime on Railway, the only host with a route to the gateway | Same image as production |
| `mt5linux` | **0.1.9**, installed `--no-deps` in `analytics-service/Dockerfile` | RPyC client to the Wine-side MT5 terminal | It is the validated gateway client. Its `MetaTrader5` class is `rpyc.classic.connect` plus f-string `eval` passthroughs, so **every** MT5 Python function is reachable, including `symbol_info_tick`, `symbols_get`, `positions_get`, `copy_rates_range` and raw `eval` (HIGH, wheel source). The far-side namespace holds only `import MetaTrader5 as mt5` |
| `rpyc` | **5.3.1** (lock; the `requirements.in` comment says 5.2.3 and is stale, so trust the lock) | Wire protocol to the gateway | It must stay on 5.x to match the Wine server (5.0.1 or 5.2.3). 6.x fails the handshake |
| `services/mt5_client.py` `Mt5Client` | repo | `account_info()`, `history_deals_get()`, `terminal_info()`, `session_snapshot()`, timeouts, scrubbing, netref materialization, login bracket | The harness must read through it, never through a raw `mt5linux` connection (see "What NOT to use") |
| `services/mt5_server_clock.py` `Mt5ServerClock` | repo (Phase 175) | Broker wall-clock to UTC: `candidates()`, `day_offset_s()`, `instant_offset_s()` | It is a stdlib-only hand rule (`eu` / `us` / `fixed`) checked against `zoneinfo` in tests. The live measurement **asserts against it** and does not replace it |
| `services/broker_dailies.py` | repo | `combine_mt5_deal_ledger`, `reconstruct_mt5_nav_levels`: the series under test | Parity must exercise the production fold, never a copy |
| `scripts/mt5offset_dry_run.py` captured-ledger shape | repo | `{"offset_s", "keys": {id: {"status", "deals", "equity", "balance", "currency"}}}` plus ordinal redaction | The harness's capture should **extend this shape**. Its producer (the 164.6.6.2.3 plan 08 capture, base64-exec'd over `railway ssh`) was **never committed**; this milestone should commit one |

### Supporting libraries (all already present; none added)

| Library | Version | Purpose | When to use |
|---|---|---|---|
| stdlib `json` + `hashlib` | 3.12 | Canonical, sealed oracle snapshot (section 2.3) | Every capture |
| stdlib `html.parser` + `codecs` | 3.12 | Parse the founder's HTML report (oracle B) | Once a real report file exists |
| stdlib `datetime.timezone.utc`, `zoneinfo` (tests only) | 3.12 | UTC instants; cross-checking the hand rule in tests | Always / tests only |
| `pandas` | 3.0.3 | Only through the existing `broker_dailies` functions | When re-folding a captured ledger |
| `psycopg[binary]` | 3.3.6 | Read what PROD actually stored, if not via the Supabase MCP | Comparator inputs |
| `structlog` | 26.1.0 | Probe and capture log lines (redacted) | Existing logging convention |

### Development tools

| Tool | Purpose | Notes |
|---|---|---|
| `pytest` (<9.2) + `pytest-xdist` | Near-midnight regression, comparator unit tests, parser tests against a redacted fixture | Run only from `analytics-service/`. The existing cap and xdist-group rules apply |
| `mypy==2.4.0` (strict in CI) | Type gate on every new analytics-service module | Must be in every analytics-touching brief |
| `@playwright/test` ^1.64.1 | MT5-09 cross-surface read | Existing e2e stack |
| `unpdf` 2.1.0 (optional, dev) | PDF text extraction | Only if PDF bytes must be read (section 2.6) |

### New capabilities and how to get them without a new package

#### 2.1 Live server-UTC offset at connect (MT5-06): one committed remote expression

**Add** a `Mt5Client.server_clock_probe()` read backed by a committed constant, for example
`_REMOTE_SERVER_CLOCK_SRC`, evaluated through `_MetaTrader5__conn.eval` in **one RPyC
crossing**. That is exactly the `session_snapshot()` pattern. It returns plain ints only:

- the **maximum `time_msc`** over `mt5.symbol_info_tick(s.name)` for the visible
  (Market Watch) symbols from `mt5.symbols_get()`, ignoring `None` ticks;
- how many symbols answered;
- the far-side clock as **`__import__("time").time()` inline**. The far namespace has no
  `time` (or `datetime`) import, so a bare `time.time()` raises `NameError`. Never use
  `conn.execute("import time")`: it mutates the shared far-side namespace that every key uses.

The worker brackets the call with its own `time.time()` before and after. Then:

- `raw = tick_ms/1000 − utc_now`. This equals `offset − tick_age`.
- Round to the nearest 900 s. **Refuse** (`not measurable`) when `|raw − rounded|` exceeds a
  small bound, for example 120 s (stale ticks, a closed session, a weekend), or when no
  symbol answered. This is the same rounding idea as `scripts/mt5_spike.py`
  `_leg4_server_time_offset`, which used deal times and was explicitly only an estimate.
- **Assert** `rounded ∈ Mt5ServerClock.candidates(wall_epoch_s)` for the configured clock at
  that instant. Persist the measurement (offset, instant, symbol count, bracket width,
  far-side clock skew).

**Why this read?** The Python package has no `TimeCurrent` or `TimeTradeServer`; those exist
only in MQL5. MQL5 defines `TimeCurrent` as *"the last known server time, time of the last
quote receipt for one of the symbols selected in the Market Watch window"*, formed on the trade
server. The max over visible-symbol ticks reproduces that definition
([MQL5 TimeCurrent](https://www.mql5.com/en/docs/dateandtime/timecurrent); vendor primary,
LOW per the classify seam).

**Why one crossing?** `Mt5Client._materialize_rows` measured 60 ms per element when netrefs
are iterated from the worker side. A per-symbol loop over `symbols_get()` from the worker would
cost seconds and risk the 30 s RPyC bound.

⚠️ **LOW / needs a live spike before the plan relies on it:**
- whether `symbol_info_tick` answers for a symbol that is not in Market Watch (the vendor
  example calls `symbol_select` first). Restricting to `s.visible` avoids `symbol_select`,
  which **mutates** the shared terminal's Market Watch;
- what an investor-password session's Market Watch contains on these servers;
- how stale a tick reads during a session break.

⚠️ **Conflict to surface, not resolve silently.** MT5-06's text names
`MT5_SOAK_SERVER_OFFSET_MIN` as the carrier and rejects hardcoding. Phase 175 since shipped
a **configured rule** (`MT5_SERVER_TIME_RULE` = `eu`/`us`, or `MT5_SERVER_UTC_OFFSET_S`). The
compatible reading is that **the rule is configured and the live measurement asserts the
rule**, failing loud on disagreement. The roadmap should state this reading explicitly. Note
that `MT5_SERVER_TIME_RULE` is **one value for the whole worker**. If MM2, MM3 and FX-AI_V sit
on different broker servers, a single rule is wrong for at least one of them. That is a
per-server clock question. `164.6.6.3.6 MT5SERVERLEARN` was taken out of v1.20 by founder
decision on 2026-11-03 and kept on its branch (PROJECT.md). Check what it holds before
building anything per-server.

#### 2.2 Which DST rule (`eu` vs `us`): optional, retroactive, same mechanism

A November probe **cannot tell `eu` from `us`**: both rules sit at UTC+2 after
2026-11-01. The rules differ only in the gap weeks (2026-03-08..03-29 and
2026-10-25..11-01). Those weeks are recoverable from **history the broker still serves**.
The weekly FX open is fixed to New York 17:00. Under `us` (NY+7) the first H1 bar of the week
sits at server 00:00 all year. Under `eu` it sits at server 23:00 Sunday during the
late-October gap week.

One committed remote expression can call
`mt5.copy_rates_range(<liquid FX symbol>, mt5.TIMEFRAME_H1, <int epoch>, <int epoch>)` and
return `[(time, ...) ...]` via `.tolist()`, which settles the rule from data rather than from
a broker's web page. **MEDIUM**: some brokers open at 00:05 or skip the first bar, so the
plan should read the bar pattern across both gap windows, not a single bar.
⛔ Do not use the `mt5linux` `copy_rates_range` wrapper (see "What NOT to use").

#### 2.3 Reproducible oracle snapshot (MT5-07/08): stdlib only

- **Capture:** a committed `scripts/mt5_parity_capture.py` (name illustrative), reading through
  `Mt5Client` on the execution channel in section 3. It records per key:
  - `account_info()` `equity`, `balance`, `profit`, `credit`, `currency`, `margin`;
  - the server-clock probe (section 2.1);
  - the window's deals via `history_deals_get()`, with raw `time` and `time_msc` verbatim;
  - `captured_at_utc`, bracketed by the worker clock;
  - `deploy_sha` (the running image's commit), `schema_version`, and the configured clock rule.

  The open-P&L quantity the backbone uses is **`equity − balance`** (the code's uPnL wedge).
  Record it directly. The vendor `profit` field is understood to be floating P/L, but that is
  unverified here (LOW), so record it beside the wedge rather than in place of it.
  `positions_get` is therefore not needed for the 1% check (Rule 2: do not widen the read
  surface without a consumer).
- **Seal:** canonical JSON (`json.dumps(obj, sort_keys=True, separators=(",", ":"),
  allow_nan=False)`) plus `hashlib.sha256`. Stdlib, deterministic, and `allow_nan=False`
  makes a NaN fail loud instead of serialising as invalid JSON.
- **Store:** the raw capture holds amounts and login-linked data, and **the repo is public**.
  Keep the raw file **out of git**: the operator's scratch, or a private store the founder
  owns. Track only the sha256 and **ratios and verdicts**, using the
  `mt5offset_dry_run` / `flowtiming_dry_run._scrub` redaction (reused, not copied). Re-running
  the comparator on the same sealed file must give a byte-identical report.
- **Compare:** a pure function over (sealed capture, stored series), comparing in the
  **account's native currency**. Native-unit (BTC) MT5 accounts exist since v1.20, so the
  oracle should not route through a USD conversion that could itself be the divergence. Use
  explicit relative error. Read the stored series through the existing reconstruct functions,
  or through `psycopg` / the Supabase MCP for what PROD actually stored.

#### 2.4 Broker statement (oracle B): stdlib `html.parser`, HTML only

The terminal's *Report* is generated from the `ReportHistory.htm` template and can also be
saved as Open XML (XLSX). **Parse HTML with `html.parser.HTMLParser`** into rows of the
*Deals* table, and read the balance-after-deal column. Sniff a BOM to choose `utf-16`
or `utf-8` with `codecs`. **Do not support XLSX**: one format is enough, and XLSX would need
`openpyxl` (3.1.5, not installed).

⚠️ **LOW**: the file encoding, the thousands and decimal separators, the column order and the
exact balance header are **undocumented**, and two searches found nothing authoritative. The
parser must be written against **one real file the founder exports** and fail loud on any
header it does not recognise. The deals' `Time` column is **broker server time**, so fold it
through `Mt5ServerClock` exactly as the ingestion does, never through a tz database.

#### 2.5 Timezone / DST handling: what is already there is the answer

| Need | Use | Not |
|---|---|---|
| Broker wall time to UTC | `Mt5ServerClock` (hand rule, stdlib) | `zoneinfo` at runtime, `pytz`, `dateutil.tz`, `pendulum`, `arrow` |
| UTC instants | `datetime.timezone.utc`, epoch ints | naive datetimes |
| Cross-checking the rule in tests | `zoneinfo` `Europe/Athens` and `America/New_York`, **test-only**, exactly as `tests/test_mt5_server_clock.py` already does | adding `tzdata` to the runtime lock |
| Near-midnight regression (MT5-06) | Extend `tests/test_mt5_deal_timing.py`, which already has `test_instant_day_equals_deal_utc_day_around_a_utc_midnight` and a rule-clock variant, with **a real near-midnight deal from the live capture**, redacted to timing fields only | a synthetic-only case: the requirement is "lands on the day the terminal shows" |

Why: Phase 175's module docstring records the decision. The rule is the **broker's**, not a
city's, and a tzdata update must not silently re-bucket history. `tzdata` is pinned only for
win32/emscripten in the lock, so a Linux runtime `zoneinfo` would depend on the base image's
system tz database. Whether `python:3.12-slim` ships one is **unverified (LOW)**, and the
design avoids needing to know. `pytz` 2026.2 and `python-dateutil` are in the lock only
transitively (via yfinance, and via pandas/matplotlib). Never import them directly, because a
quantstats bump could drop them.

#### 2.6 Surface parity (MT5-09): existing JS test stack

| Tool | Version | Use |
|---|---|---|
| `@playwright/test` | ^1.64.1 (installed) | Read the rendered figures on strategy detail, the factsheet, the composer and browse for each MT5 strategy, and compare them with one another and with the oracle verdict |
| PDF | n/a | Both PDF routes (`/api/factsheet/[id]/pdf`, `/tearsheet.pdf`) use `puppeteer-core` to **`page.goto` `/factsheet/[id]`** and print it. Reading that page's DOM proves the PDF's **source**. If the acceptance must read the **PDF bytes**, add **`unpdf` 2.1.0** as a devDependency (a pdf.js wrapper for Node) rather than raw `pdfjs-dist` 6.5.438 |

---

## 3. Execution channel (the stack decision most likely to block, HIGH that it matters)

**What the code and the record say:**

- **The terminal lease is in-process.** `services/mt5_concurrency.py` serialises on a
  module-level `dict[str, asyncio.Lock]`, which is single-event-loop by its own documented
  scope. The API service runs the interactive worker in the same loop, so the API is
  serialised against itself. A separately started process, such as a script run over
  `railway ssh`, shares **no** lease with it. Neither does the separate backfill worker
  service, which owns its own registry.
- **The cross-process safety net is the login bracket** (`account_info().login == expected`,
  asserted before and after a read) **plus a quiet window**. The 164.6.6.2.3 plan 08 capture
  (2026-10-12) ran this way: base64-exec over `railway ssh` into the backfill service, one
  `Mt5Client` per key, a `compute_jobs` quiet-window SELECT immediately before, and MT5 jobs
  known to run at 04:00, 05:00 and 05:30 UTC.
- ⛔ **`railway ssh` then failed after authentication on both analytics services**
  (2026-11-03, Phase 175 D-06). Giving the container user a home directory (#1190) did not fix
  it, and Phase 175 shipped without its live capture for that reason.

**Recommendation:**

1. **Re-measure `railway ssh` at HEAD first.** It is a claim dated 10 days ago, and the
   founder's memory rules say to re-measure before acting.
2. **If it still fails, the harness needs an in-process entry point.** The candidate is an
   authenticated internal route beside the existing ones in `routers/internal.py`. That costs
   no new library, takes the real lease against the API's own worker, and needs the same quiet
   window against the backfill service.
3. **Either way, run the capture in a quiet window**, proven by a `compute_jobs` SELECT, and
   keep the login bracket on.

A capture logs the one shared terminal into each account in turn. The next scheduled job's
own login bracket is what makes that safe, so the capture must never weaken or skip it.

---

## Installation

```bash
# analytics-service: nothing. No requirements.in / requirements.txt change.

# Only if MT5-09's acceptance must extract text from the PDF bytes:
npm install -D unpdf@2.1.0
```

---

## Alternatives Considered

| Recommended | Alternative | When to use the alternative |
|---|---|---|
| Committed remote expression via `conn.eval` | The `mt5linux` method passthroughs (`self._mt5.symbol_info_tick(...)`) | Never, for multi-element reads: they iterate netrefs from the worker (measured 60 ms per element). A single scalar call is acceptable |
| Max-tick server time (MQL5's `TimeCurrent` definition) | Deal-derived offset (`mt5_spike._leg4_server_time_offset`) | Only as a cross-check. It equals the offset only when the latest deal is seconds old |
| Max-tick server time | Gateway container clock vs broker | Never as the measurement, since the container clock is not the broker's. Record it as a skew diagnostic |
| Oracle A (gateway snapshot) + B (report) | EA `QuantalyzeDailyReturns.mq5` on the founder's terminal | Choose this when the founder wants an **independent equity** series for **future** windows. It cannot reconstruct a past window. It buckets by server date, so the comparison must convert |
| HTML report | XLSX report + `openpyxl` 3.1.5 | Only if the founder's terminal cannot save HTML. Adding a parser for a second format of the same data is not justified |
| Stdlib `html.parser` | `pandas.read_html` | It needs `lxml` 6.1.3 or `html5lib`, and neither is installed. `bs4` is only transitive via yfinance |
| `railway ssh` one-shot (if it works again) | Internal authenticated route in the API process | The route is preferred when ssh still fails, and it takes the real in-process lease besides |
| Weekend capture of Friday-close equity | A scheduler firing captures at 00:00 UTC on weekdays | Only if a window must end mid-week. Then use a one-off timed run, not new scheduler infrastructure |

---

## What NOT to Use

| Avoid | Why | Use instead |
|---|---|---|
| **rpyc 6.x** (latest 6.0.2) | Not wire-compatible with the 5.x Wine server: `ValueError: invalid message type: 18` | The locked 5.3.1. Keep `<6` on both ends |
| **mt5linux ≥ 0.1.10 / 1.x** (latest 1.1.1) | 0.1.10+ regressed to `Popen(..., shell=True)`, so the gateway's `server.py` is never created. 1.x dropped the `-w` interface `start.sh` needs, and its class layout is entirely different | 0.1.9, `--no-deps` |
| **`mt5linux` 0.1.9 `copy_rates_range` wrapper** | Verified in the wheel at line 2289: it interpolates `repr(date_from.astimezone())`. An int bound raises `AttributeError`. A datetime emits `datetime.datetime(...)`, which the far namespace cannot resolve (no `datetime` import, the same defect `history_deals_get` already works around). It then `rpyc.classic.obtain`s a **numpy** array across a numpy 1.x (Wine) / 2.5.4 (worker) pickle boundary | A committed `conn.eval` expression with int epochs that returns `.tolist()` plain tuples |
| **`conn.execute("import ...")`** on the far side | It mutates the namespace every key's reads share | `__import__("time")` inline in the committed expression |
| **`symbol_select(...)`** in the probe | It mutates Market Watch on the **one shared** terminal every key runs through | Read only `s.visible` symbols |
| **A second raw `mt5linux.MetaTrader5(host, port)` connection** from the harness | It skips `Mt5Client`'s login bracket, timeout chain and scrubbing. Logging in another account switches the single shared terminal's session under a running derive | `Mt5Client`, in a quiet window, preferably in-process (section 3) |
| **A generic attribute passthrough** on `Mt5Client` | The facade is read-only **by construction**, and a passthrough re-exposes the trade path (`api_verified` trust story; CI grep gate) | Named methods, one committed remote source each |
| **`positions_get`** | The wedge `equity − balance` already gives the open P&L the backbone uses. Widening the surface needs a consumer | Add it only if a per-position breakdown is required to explain a divergence (MT5-10) |
| **`pytz`, `python-dateutil`, `pendulum`, `arrow`, runtime `zoneinfo`/`tzdata`** | A tz-data update would silently re-bucket history, and pytz/dateutil are transitive-only | `Mt5ServerClock` |
| **`ntplib`** or any clock-sync dependency | The offset is rounded to 15 minutes, so seconds of host skew are immaterial. The worker-side bracket already bounds it | Record the bracket width and the far-side clock as diagnostics |
| **`openpyxl`, `lxml`, `html5lib`, direct `bs4` imports** | Not in the lock (`bs4` only transitively). A new native wheel adds attack surface for one parse | Stdlib `html.parser` + `codecs` |
| **The `MetaTrader5` Windows package in-process** | Windows-only. The worker contract (MT5GW-02) forbids it | The RPyC bridge |
| **Comparing run-day equity with the app's run-day value** | `broker_dailies` anchors to today's equity, so the comparison is near-tautological | A window that ends at a captured past instant |

---

## Stack Patterns by Variant

**If all three accounts are on one broker server:**
- One configured clock rule, asserted once per connect per key.
- Because the measurement is per server, it is the same answer three times. The redundancy is
  free evidence.

**If they are on different broker servers:**
- The single worker-global `MT5_SERVER_TIME_RULE` cannot be right for all of them. The live
  probe will expose it as a disagreement on one key.
- Route that to a per-server clock (check the parked `164.6.6.3.6 MT5SERVERLEARN` branch
  first) before parity, because a wrong offset leaves period totals reconciling while the
  daily series shifts (MT5-06's own warning).

**If an account holds weekend-quoted symbols:**
- The weekend Friday-close shortcut does not hold. Capture at a UTC midnight instead.

**If `railway ssh` works again at HEAD:**
- The one-shot capture can follow the 164.6.6.2.3 plan 08 procedure, committed this time.

**If it does not:**
- Build the in-process internal route first. Every agent-capturable oracle (A, the probe, the
  DST-rule read) depends on it.

---

## Version Compatibility

| Package A | Compatible with | Notes |
|---|---|---|
| `rpyc==5.3.1` (worker) | gateway rpyc 5.0.1 / 5.2.3 | Same 5.x protocol is what matters, verified live per the `requirements.in` notes. 6.x breaks |
| `mt5linux==0.1.9` (worker, `--no-deps`) | gateway `mt5linux==0.1.9` (`deploy/mt5-gateway/mt5linux-constraint.txt`) | The gateway needs `PIP_CONSTRAINT` set or the bridge is silently dead |
| gateway `MetaTrader5==5.0.36` | gateway `numpy<2` | Its compiled core is numpy 1.x ABI. That is also why no numpy object may cross to the worker's numpy 2.5.4 |
| `pandas==3.0.3` | `numpy==2.5.4`, stdlib `zoneinfo` | pandas 3 uses zoneinfo by default. Irrelevant here because the harness folds through `Mt5ServerClock` |
| `@playwright/test ^1.64.1` | `next ^16.4.2` | Existing e2e stack |
| `unpdf 2.1.0` (optional) | Node runtime used by vitest/playwright | Dev-only. Never in the app bundle |

---

## Sources

- Repo, read directly (HIGH):
  - `analytics-service/requirements.in`, `requirements.txt` (lock), `requirements-dev.txt`,
    `Dockerfile`;
  - `services/mt5_client.py` (facade contract, `session_snapshot` /
    `_REMOTE_SESSION_SNAPSHOT_SRC`, `history_deals_get`, the `_materialize_rows` 60 ms per
    element measurement);
  - `services/mt5_concurrency.py` (single-event-loop lease scope);
  - `services/mt5_server_clock.py`;
  - `services/broker_dailies.py` (realized basis, uPnL wedge, UTC-day bucketing);
  - `scripts/mt5offset_dry_run.py`, `scripts/mt5_spike.py`, `scripts/deribit_ground_truth.py`;
  - `tests/test_mt5_deal_timing.py`, `tests/test_mt5_server_clock.py`;
  - `tools/mt5/README.md`, `deploy/mt5-gateway/mt5linux-constraint.txt`,
    `src/app/api/factsheet/[id]/pdf/route.ts`;
  - `.planning/PROJECT.md`, `.planning/milestones/v1.16-REQUIREMENTS.md` (MT5-06..10);
  - archived Phase 175 `175-06-SUMMARY.md` (D-06, `railway ssh` failure) and 164.6.6.2.3
    `-08-SUMMARY.md` (capture procedure).
- `mt5linux` 0.1.9 wheel from PyPI, unpacked and read (HIGH): method list, `rpyc.classic.connect`,
  far-side `import MetaTrader5 as mt5` only, `copy_rates_range` body at line 2289.
- PyPI / npm registry JSON, 2026-11-13 (MEDIUM): rpyc 6.0.2, mt5linux 1.1.1, openpyxl 3.1.5,
  lxml 6.1.3, unpdf 2.1.0, pdfjs-dist 6.5.438.
- [MQL5 docs, `TimeCurrent`](https://www.mql5.com/en/docs/dateandtime/timecurrent) (vendor primary; LOW per seam):
  last quote receipt across Market Watch symbols, formed on the trade server.
- [MQL5 docs, `symbol_info_tick`](https://www.mql5.com/en/docs/python_metatrader5/mt5symbolinfotick_py)
  (LOW per seam): fields incl. `time_msc`, `None` on error; time zone and Market Watch requirement not stated.
- [MetaTrader 5 help, Trading Report](https://www.metatrader5.com/en/terminal/help/trading_advanced/history_report)
  (vendor primary; LOW per seam): `ReportHistory.htm` template; Summary equity is at generation
  time; balance graph built from deals.
- [MetaTrader 5 help, Report](https://metatrader5.com/en/terminal/help/trading/report) and
  [MQL5 article on daily reports via SendMail](https://www.mql5.com/en/articles/23093) (LOW): no
  platform-standard daily statement email.

---
*Stack research for: live MT5 parity harness (v1.18 MT5-VERIFY)*
*Researched: 2026-11-13*
