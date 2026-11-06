# Phase 175: MT5OFFSET - Research

**Researched:** 2026-10-27
**Domain:** Python analytics worker (`analytics-service/`), broker-clock to UTC conversion for MT5 deal days and instants
**Confidence:** HIGH for the code census, the transition rules and the resolver design (all read or run this session); LOW for which rule the broker follows (unmeasured, that is SC-1 and a founder step)

<user_constraints>
## User Constraints (from 175-CONTEXT.md)

### Locked Decisions

**Carried (not re-asked)**
- FLOWTIMING 164.6.6.2.3 D-08: one seam, one offset; days are UTC days. D-07: an untrustworthy instant means no instant (day-level rule), never a default.
- NAVMTM 167.2.1.1.1 D-23 (founder 2026-10-26, "Use the deposit's exact time"): a flow is placed by its own instant against the mark's `marked_at`. D-03: the chain moves to ~00:10Z.
- 142.2 RESEARCH: a live tick is the only reliable server clock; the last-deal estimator was tried and rejected; the MT5 client read surface is locked (`test_mt5_client_contract.py`), any widening is one purpose-named method.

**D-01 Offset model: a DST rule, measured once.** Founder 2026-10-27, AskUserQuestion: "DST rule, measured once (Recommended)". The broker's rule (EU, US or fixed) is measured live and recorded with its date (SC-1). A pure function gives the offset in force at a broker-clock instant; every MT5 deal day and instant uses it (SC-2). The rule is chosen by a worker setting (a rule id, not a committed broker-server-name table: the server name is secret-grade, T-134-01); an unknown or unset rule fails loud; a fixed-integer form stays for a no-DST broker. One resolver replaces the scattered `int(os.getenv("MT5_SERVER_UTC_OFFSET_S","0"))` reads. No live server-clock check in this phase: it stays with Phase 155 / MT5-06, which 175 does not close.

**D-02 Interim: measure now, set by hand.** Founder 2026-10-27: "Measure now, set by hand (Recommended)". The founder reads the broker's server clock in the MT5 terminal today; `MT5_SERVER_UTC_OFFSET_S` is set to match on the worker, re-checked after 2026-11-01 (US DST end), and the measurement step is added to the NAVMTM chain-move runbook preflight (SC-3). Two readings on trading days, one before and one after 2026-11-01, separate the US rule from a fixed +3 (a +2 reading today already means the EU rule).

**D-03 History when the rule ships (Claude's call, analyzer recommendation).** The nightly derive re-reads the whole MT5 ledger, so strategy and key series re-bucket by themselves. Before deploy, a read-only before/after on the live ledger (counts and ordinals only, `scripts/flowtiming_dry_run.py` precedent) records which days move; allocator-history snapshots (written once, `ON CONFLICT DO NOTHING`) are rebuilt by a named forced rebuild only for keys whose days actually moved.

### Claude's Discretion
- The deterministic tie-break for the repeated or missing broker-local hour at a transition.
- The signature change from an int offset to a resolver across the fold functions and tests.
- Rewriting the `mt5_deals.py` note that says order within the broker clock is exact (REVIEW-3 WR-02).

### Deferred Ideas (OUT OF SCOPE)
- Live server-clock tripwire asserting `measured == rule(now)`: Phase 155 / REQUIREMENTS MT5-06.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs were assigned (ROADMAP: `**Requirements**: TBD`). The phase-local success criteria are the contract. REQUIREMENTS.md `MT5-06` ("measured live and asserted on") is NOT closed by this phase (CONTEXT, Deferred).

| ID | Description (ROADMAP `### Phase 175`) | Research Support |
|----|----------------------------------------|------------------|
| SC-1 | The broker's offset rule is measured (which DST rule it follows) and recorded. | `## Operator Measurement Procedure`: reading dates, discrimination table, what may be recorded in a public repo. |
| SC-2 | MT5 deal day bucketing and D-23 instant placement use the offset in force on the deal's date; tests go RED with the fixed `MT5_SERVER_UTC_OFFSET_S` across a DST change. | `## Call-Site Census`, `## Architecture Patterns` (rule function, tie-break, resolver), `## Validation Architecture` (RED-under-fixed tests, oracle). |
| SC-3 | Interim: the broker's current offset is measured and `MT5_SERVER_UTC_OFFSET_S` set before the first nightly marks. | `## Operator Measurement Procedure` (interim value, history side effect), `## Runtime State Inventory`, runbook anchors. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives that bind this phase (project `CLAUDE.md` + `AGENTS.md`, global `CLAUDE.md`, auto-memory):

- **Never write database or Railway commands from a research/plan agent for this phase**; the founder measurement (SC-1/SC-3) and any PROD capture (D-03) are founder-gated. When a plan does touch PROD, the marker query comes first: `SELECT shobj_description(oid, 'pg_database') AS which_database FROM pg_database WHERE datname = current_database();`. The Supabase CLI in this checkout is linked to PRODUCTION.
- **Public repo with `.planning/` tracked**: no secrets, PROD ids, home paths, account numbers, **no broker server name** (T-134-01), no deal ledger or amount in any tracked text. Measurement notes may record the rule id, the dates, and "server minus UTC" in whole hours only.
- **Commit messages and PR bodies**: never write the CI skip trailer tokens, not even in a sentence denying them (CLAUDE.md "CI gate integrity" trap 1). No `Co-Authored-By`/`Claude-Session` trailers (founder 2026-10-20).
- **Every ship writes a CHANGELOG entry** (grouped by theme, this repo's section vocabulary) in the same commit as the `VERSION` bump; `VERSION` and `package.json` must be byte-equal 4-digit strings. A `CHANGELOG.md` line already routes this phase (`CHANGELOG.md:50`: "The broker's UTC offset is fixed, not DST-aware. ... Routed to Phase 175 MT5OFFSET (REVIEW-3 WR-02).") and the 175 entry must close it.
- **Tests must be able to fail**: neuter the fix, see RED, restore from a byte backup (never `git checkout`/`restore`/`stash` on uncommitted work). Money-math oracles are independent invariants (here: `zoneinfo`, not the resolver's own constants).
- **Python**: pytest only from `analytics-service/`; never `importlib.reload` in tests; `grep -a`; CI mypy strict line (below) belongs in every analytics-touching brief and pre-push check; a new `supabase/tests` file is not needed (no migration).
- **Sibling census**: a new test file or a changed seam moves several censuses; grep them all (`_MT5_BACKFILL_MESSAGES` consumers, closed sets, conftest autouse fixtures).
- **Read before write / surgical changes / match conventions** (global rules 3, 8, 11).
- **Do not edit `ROADMAP.md`/`STATE.md` by hand-run handlers without `git diff` afterwards**; ship branches must change nothing under `.planning`.

## Summary

The broker stamps every MT5 deal `time` in its server clock, delivered verbatim as an epoch (the repo's own contract: `mt5_client.py:3070`, "The raw server-time `time`/`time_msc` epochs are returned VERBATIM"). The worker removes one fixed integer, `MT5_SERVER_UTC_OFFSET_S` (10800 on the worker), to reach UTC. Across a broker DST change that integer is an hour wrong for roughly five months a year (fixed +3 versus a true +2 in winter). NAVMTM D-23 made this expensive: a deposit between about 00:10Z and 01:10Z on a winter night is filed on the wrong side of the mark's read, and the published return becomes +4% then +49% (cumulative +55%) where the truth is +2%. I re-ran the reviewer's reproduction at HEAD in this worktree and got exactly that: `offset right (7200): cum=0.020000` versus `offset as deployed (10800): cum=0.549804` [VERIFIED: ran `/tmp/navmtm-r3/mt5_offset_dst.py` 2026-10-27; the script is ephemeral, port it into pytest]. Marks themselves are offset-independent (NAVMTM D-06); only day bucketing and flow placement move.

The fix is small and local. There are exactly **two production consumers** of the offset (the `derive_broker_dailies` MT5 branch in `job_worker.py`, six reads, and `reconstruct_allocator_history` in `equity_reconstruction.py`, one read) and **one seam** (`mt5_deals.deal_utc_day` / `deal_utc_instant_ms`), threaded through four `broker_dailies.py` functions. `nav_marks_apply.py` takes no offset at all: it receives already-computed `FlowInstant`s, so it needs no change. The recommended design is a pure, dependency-free "server clock" object with a rule (`eu`, `us`, `fixed`), resolved once per derive from the worker env, passed wherever an int offset goes today. The seam accepts either an int (so the roughly 45 existing seam-level test references and the soak/dry-run scripts keep working) or the clock object. Transition rules are the two statutory ones, verified against primary sources and against `zoneinfo`: EU 01:00 UTC on the last Sunday of March and October; US 02:00 local New York time on the second Sunday of March and the first Sunday of November (07:00Z in spring, 06:00Z in autumn). A candidate-based formulation (try both offsets, keep the ones consistent with the UTC transition window) yields the repeated and missing broker-local hour with no special cases, and matched `zoneinfo` on 420,864 quarter-hours from 2024 to 2029 with 0 mismatches.

**Primary recommendation:** add one pure leaf module `analytics-service/services/mt5_server_clock.py` (rule table, `offset_at(broker_epoch)`, env resolver that fails loud), widen the seam's offset type to `int | Mt5ServerClock`, resolve the clock once at the top of the MT5 derive branch and once in `reconstruct_allocator_history`, replace all seven env reads, and pin "no other reader of the env var" with a source test. Treat the repeated or missing broker-local hour as: **day = first occurrence (provably day-invariant), instant = `None`** (D-07). The rule id (`eu` or `us`) comes from the founder's two dated readings (Tue 2026-10-27, Mon 2026-11-02); the broker's own help article describes the US-aligned pattern, which is a prior and not a measurement.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Broker-clock to UTC conversion (rule function, tie-break) | API / Backend (analytics worker, pure Python) | — | One pure seam already owns it (`mt5_deals`); the browser and Next.js never see broker time. |
| Rule selection (`eu`/`us`/`fixed`) | API / Backend (worker env, Railway variable) | — | A deployment setting, per D-01; not a table, because the server name is secret-grade. |
| D-23 flow placement against `marked_at` | API / Backend (`nav_marks_apply.apply_marks`) | — | Unchanged: consumes `FlowInstant(at_ms, day, amount)`; correctness depends only on the instants it is handed. |
| Stored daily series and key inputs | Database / Storage | API / Backend | Re-derived from the full ledger every nightly derive, so they heal by themselves. |
| Allocator-history snapshots (`allocator_equity_snapshots`) | Database / Storage | API / Backend (forced rebuild job) | Written once with `ignore_duplicates`; only a forced account rebuild replaces a window (D-03). |
| Rule measurement (SC-1, SC-3) | Founder at the MT5 terminal | Railway env (founder) | A live tick is the only reliable server clock and the client read surface is locked. |
| Frontend / Vercel | none | — | No TypeScript file reads the offset (grep census below). |

## Standard Stack

### Core

No new dependency. Everything is the Python standard library.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `datetime`, `calendar`, `dataclasses`, `functools` (stdlib) | Python 3.12 (`analytics-service/.python-version` = `3.12`; image `python:3.12-slim`) | Compute transition instants, hold the frozen rule object, memoize per-year windows | The rule is two statutory formulas; a tz database is not needed at runtime. |
| `zoneinfo` (stdlib) | 3.12 | **Test oracle only** (`Europe/Athens`, `America/New_York`) | Independent invariant for the resolver (CLAUDE.md: oracles are independent invariants). |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pytest` (+ `pytest-asyncio`, auto mode) | per `requirements-dev.txt` (unpinned) | Tests | `analytics-service/pytest.ini` has `asyncio_mode = auto`, `pythonpath = .`. |
| `mypy --strict` | per CI | Type gate | The new module is under `services/`, so the CI line covers it. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hand-written rule (recommended) | `zoneinfo.ZoneInfo("Europe/Athens")` for `eu`; `ZoneInfo("America/New_York")` with a +7 h shift for `us` | Works (my oracle does exactly this and agrees on every quarter-hour 2024-2029), and `python:3.12-slim` has `/usr/share/zoneinfo` (verified by running it in the image). But: `requirements.txt` pins `tzdata==2026.5` only for `win32`/`emscripten` (line 290), so on Linux the runtime silently depends on the base image's OS tz package; `pytz==2026.2` is present only transitively via `yfinance` (line 217-218). A tz-database update would also change history re-bucketing without any code change, for a rule that is the BROKER's, not a city's. A hand rule frozen to two documented statutes is auditable and has no environment dependency. If the planner prefers zoneinfo, the recipe is: `server_offset = 7 h + NY_utcoffset(naive_wall - 7 h, fold=0)` for `us` and `Athens_utcoffset(naive_wall, fold=0)` for `eu`. |
| One resolver at the seam | Per-deal offsets pre-computed by each caller | Rejected: it recreates the "scattered reads" defect D-01 removes. |
| Rename `server_utc_offset_s` everywhere | Widen its type, keep the name | See Open Question 2. Widening keeps the roughly 45 test references (grep count: 32 + 12 + 1 + 1 across four files) and two scripts untouched (surgical, global rule 3); the name becomes slightly misleading, which a docstring fixes. |

**Installation:** none. **Version verification:** not applicable (no package added). Package Legitimacy Gate: not run, because the phase installs no external package.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (none) | — | — | — | — | — | No package is installed by this phase |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 MT5 terminal (broker server clock)
        |  history_deals_get -> deals with `time` / `time_msc`
        |  = broker wall clock encoded as epoch, VERBATIM (mt5_client.py:3070)
        v
 services/mt5_read.read_mt5_deal_ledger  (full ledger every derive; unchanged)
        |
        +--------------------------------------------+
        |                                            |
        v                                            v
 job_worker  derive_broker_dailies (MT5 branch)   equity_reconstruction.reconstruct_allocator_history (MT5 arm)
   [NEW] clock = resolve_mt5_server_clock(env)       [NEW] clock = resolve_mt5_server_clock(env)
        |   fail loud: unset / unknown / both / out of range     |   fail loud -> _fail(...)
        |                                                        |
        v                                                        v
 broker_dailies._fold_mt5_deals(deals, clock)            reconstruct_mt5_nav_levels(deals, ..., clock)
   deal_utc_day(time, clock)          <-- ONE seam (mt5_deals) -->  deal_utc_instant_ms(deal, clock)
        |                                   |                                |
        |   clock.offset_at(broker_epoch) = 7200 or 10800 for THAT deal's own wall time
        v                                   v
 per-UTC-day trading P&L, flows         FlowInstant(at_ms, day, amount) list
        |                                   |
        v                                   v
 combine / nav levels / mt5_day_pnl     nav_marks_apply.apply_marks(flow_instants=...)   (no offset inside)
        |                                   |   rule 10: flow on read day and at_ms/1000 <= marked_at -> counted in the mark day
        v                                   v
 stored series, key_inputs            marks applied (marks themselves offset-independent, NAVMTM D-06)
        |
        v
 allocator_equity_snapshots (ON CONFLICT DO NOTHING) -> only a forced account rebuild replaces a window (D-03)
```

### Recommended Project Structure

```
analytics-service/
├── services/
│   ├── mt5_server_clock.py   # NEW, pure leaf: rule table, Mt5ServerClock, resolve_mt5_server_clock, config error
│   ├── mt5_deals.py          # seam: _require_offset_seconds accepts int | Mt5ServerClock; offset looked up per deal
│   ├── broker_dailies.py     # type widening only (4 functions + 1 helper)
│   ├── job_worker.py         # resolve once after the kill-switch gate; replace 6 env reads
│   └── equity_reconstruction.py  # resolve once; replace 1 env read; new _MT5_BACKFILL_MESSAGES key
├── scripts/
│   └── mt5offset_dry_run.py  # NEW, pure and read-only, counts and ordinals only (D-03)
└── tests/
    ├── test_mt5_server_clock.py   # NEW: oracle, golden vectors, env table, single-reader pin
    └── conftest.py                # autouse fixture: MT5_SERVER_UTC_OFFSET_S=0 default for the suite
docs/runbooks/
├── navmtm-chain-move-go-live.md   # add a pre-flight item (additive; do not renumber)
└── mt5-go-live.md                 # Step 2 item 3: name the rule id (additive; do not renumber)
```

### Call-Site Census (every read and every signature, HEAD of `feat/175-mt5offset`)

Reads of the env var in production code [VERIFIED: grep this session, each line also read]. The value is identical at all seven sites: `server_utc_offset_s=int(os.getenv("MT5_SERVER_UTC_OFFSET_S", "0")),` (the `deal_utc_day`/`deal_utc_instant_ms` sites pass the bare `int(os.getenv("MT5_SERVER_UTC_OFFSET_S", "0"))` as the second argument).

| # | File:line | Consumer | What it feeds |
|---|-----------|----------|---------------|
| 1 | `services/job_worker.py:6584` | `combine_mt5_deal_ledger(...)` | return series, `meta` |
| 2 | `services/job_worker.py:6591` | `mt5_day_pnl(...)` (key mode, D-15) | day P&L for dropped days |
| 3 | `services/job_worker.py:6610-6612` | `reconstruct_mt5_nav_levels(...)` (native BTC key) | native NAV levels |
| 4 | `services/job_worker.py:6713-6716` | `deal_utc_day(_deal.get("time"), ...)` | `_mt5_flow_by_day` (flow evidence, `external_flows`) |
| 5 | `services/job_worker.py:6730-6732` | `deal_utc_instant_ms(_deal, ...)` | `_event_flow_instants` / `_mt5_instantless_days` (D-23) |
| 6 | `services/job_worker.py:7543` | `mt5_day_pnl(...)` inside `_apply_day_pnl` | day P&L for `apply_marks` |
| 7 | `services/equity_reconstruction.py:5033` | `reconstruct_mt5_nav_levels(deals, equity, balance, ...)` | allocator-history NAV levels |

Signatures that carry the offset [VERIFIED: read]:

- `services/mt5_deals.py:184` `_require_offset_seconds(server_utc_offset_s: Any) -> None`, body: `if isinstance(server_utc_offset_s, bool) or not isinstance(server_utc_offset_s, int):` then `"MT5 server_utc_offset_s must be an int (seconds) — fail loud"`.
- `mt5_deals.py:216` `_utc_day_of_server_epoch(epoch, server_utc_offset_s)`, `:227` `deal_utc_day(time_value, server_utc_offset_s)`, `:257` `deal_utc_instant_ms(deal, server_utc_offset_s)`; the instant is `instant_ms = server_ms - server_utc_offset_s * 1000` (`:298`) and is cross-checked against the day (`return instant_ms if instant_day == day else None`, `:301`).
- `services/broker_dailies.py:620` `_mt5_flow_day_timing(..., server_utc_offset_s: int)`, `:700` `_fold_mt5_deals(deals, server_utc_offset_s: int)`, `:809` `combine_mt5_deal_ledger(..., *, server_utc_offset_s: int = 0, ...)`, `:956` `reconstruct_mt5_nav_levels(..., server_utc_offset_s: int = 0, ...)`, `:1074` `mt5_day_pnl(..., server_utc_offset_s: int = 0, ...)`. All five reach the seam through `_fold_mt5_deals` (`:886`, `:1021`, `:1089`); `_mt5_flow_day_timing` calls `deal_utc_instant_ms` (`:653`).
- `services/nav_marks_apply.py`: no offset. `apply_marks(..., flow_instants: Sequence[FlowInstant] = ())` and rule 10 compares `if fi.day == read_day and fi.at_ms / 1000.0 <= read_s` (`:255-266`). **No change needed**, but its correctness requires `fi.day` and `fi.at_ms` to come from the same clock, which one resolver guarantees.
- `services/mt5_read.py`: no offset consumption. It only bounds the fetch (`_MT5_DEAL_FETCH_MARGIN_S = 86_400` covers `_MT5_MAX_SERVER_UTC_OFFSET_S = 13 * 3600`, asserted at import). Unaffected by DST.
- Other readers of `deal["time"]`: only `broker_dailies.py:740`, `mt5_deals.py:282` and `job_worker.py:6714` (grep for `get("time")`). `services/ingestion/mt5.py` has no time handling.
- Scripts: `scripts/mt5_soak.py` builds `server_utc_offset_s = offset_min * 60` from `MT5_SOAK_SERVER_OFFSET_MIN` (line 571-572) and passes an int; `scripts/flowtiming_dry_run.py` reads `captured.get("offset_s", 0)` (line 528) and passes an int. Both keep working unchanged through the int form.
- Docs/other: `TODOS.md:1001`, `CHANGELOG.md:50`, `CHANGELOG.md:18716`, ROADMAP/MILESTONES prose. No TypeScript, SQL or workflow file reads the variable. This is a grep census (`grep -rIn`), not a proof of absence; the single-reader source test below is what keeps it true.

Tests pinning the int-only seam [VERIFIED: read]:

- `tests/test_mt5_deal_timing.py:153-158`: `@pytest.mark.parametrize("bad_offset", [True, 3.5, "10800", None])` for both `deal_utc_day` and `deal_utc_instant_ms`, asserting identical `Mt5DealClassificationError` text. Must keep passing (int and the clock object are accepted; bool, float, str, None still rejected).
- `tests/test_mt5_deal_timing.py:49-64, 69-84`: positional ints (`deal_utc_instant_ms(deal, 10800)`), midnight-edge parametrization over offsets `[0, 7200, 10800]`.
- `tests/test_mt5_deal_reconstruction.py:125-138`, `:1670`, `:1752`, `:1907`, `:1914`: `server_utc_offset_s=offset_s` keyword form.
- `tests/test_mt5_soak.py:172`, `tests/test_mt5_derive_branch.py` (comment `:369`): int `0`.
- 13 env-setting tests in `tests/test_equity_reconstruction.py` (`monkeypatch.setenv("MT5_SERVER_UTC_OFFSET_S", "0")`, lines 6128-7388).

### Pattern 1: A DST rule as a pure function over a broker-clock instant

**What:** `offset_at(broker_epoch)` receives the deal's `time` (broker wall clock encoded as an epoch, the same quantity the seam already receives) and returns the UTC offset in force at that wall time. Because the input is wall time, the function has to invert the transition: try both offsets, keep those consistent with the UTC transition window.

**Rules (verified, see Sources):**

| Rule id | Standard / daylight offset | Spring forward | Fall back |
|---------|----------------------------|----------------|-----------|
| `eu` | UTC+2 / UTC+3 (EET/EEST pattern) | last Sunday of March, 01:00 UTC | last Sunday of October, 01:00 UTC |
| `us` | UTC+2 / UTC+3 (server = New York + 7 h, so broker midnight = 17:00 New York) | second Sunday of March, 02:00 New York local = 07:00 UTC | first Sunday of November, 02:00 New York local = 06:00 UTC |
| `fixed` | the integer from `MT5_SERVER_UTC_OFFSET_S` | none | none |

**Exact transitions 2025-2027** [VERIFIED: computed by the candidate formula AND matched against `zoneinfo` `Europe/Athens` and `America/New_York` this session]; broker wall clock shown as the clock reads just before the jump:

| Year | EU spring (UTC) | EU fall (UTC) | US spring (UTC) | US fall (UTC) |
|------|-----------------|---------------|-----------------|---------------|
| 2025 | 2025-03-30 01:00 | 2025-10-26 01:00 | 2025-03-09 07:00 | 2025-11-02 06:00 |
| 2026 | 2026-03-29 01:00 | 2026-10-25 01:00 | 2026-03-08 07:00 | 2026-11-01 06:00 |
| 2027 | 2027-03-28 01:00 | 2027-10-31 01:00 | 2027-03-14 07:00 | 2027-11-07 06:00 |

Broker wall-clock effect: EU spring Sun 03:00 -> 04:00 (hour 03:00-03:59 missing), EU fall Sun 04:00 -> 03:00 (03:00-03:59 repeated); US spring Sun 09:00 -> 10:00 (09:00-09:59 missing), US fall Sun 09:00 -> 08:00 (08:00-08:59 repeated).

The two rules disagree only in two windows a year: 2026-10-25 01:00Z to 2026-11-01 06:00Z (EU already +2, US still +3) and, in 2027, 2027-03-14 07:00Z to 2027-03-28 01:00Z (US already +3, EU still +2).

**Candidate-based algorithm (prototype, validated):** for a wall epoch `w` in year `y`, `[s, e)` the UTC DST window of the rule in `y`. For each offset `o` in `(10800, 7200)`: `u = w - o`; the offset is consistent iff `(o == 10800) == (s <= u < e)`. Result: one consistent offset = unambiguous; two = repeated hour; none = missing hour.

**Tie-break (Claude's discretion, recommended):**
- **Day bucket:** first occurrence for a repeated hour (the daylight offset) and the pre-transition offset (standard) for a missing hour, i.e. `zoneinfo` `fold=0` semantics. The choice cannot change the UTC day: the closest transition to a UTC midnight in 2000-2099 is 3600 s away (EU 01:00Z), so both candidate instants always sit on the same UTC day [VERIFIED: computed this session; 0 violations]. Pin this with a property test.
- **Instant:** `None` for a repeated or a missing hour (D-07: an untrustworthy instant is no instant; the flow day degrades to the day-level rule and is already named by the existing `_mt5_instantless_days` warning). The affected wall hour is Sunday 03:00-03:59 (EU) or 08:00-08:59 (US) twice a year. Under `eu` that hour maps to 00:00-02:00Z, which straddles the 00:10Z read, so a real deposit in that hour is where a wrong tie-break would matter; `None` is the only honest answer there. Under `us` the repeated hour is 05:00-07:00Z, after the read on either candidate, so placement is unaffected.

**Example (prototype, not committed code):**

```python
# Source: prototype validated against zoneinfo on 420,864 quarter-hours 2024-2029, 0 mismatches
from datetime import date, datetime, timedelta, timezone
import calendar
from functools import lru_cache

STD_S, DST_S = 7200, 10800

def _nth_sunday(y: int, m: int, n: int) -> date:           # n > 0: n-th, n == -1: last
    if n > 0:
        d = date(y, m, 1)
        d += timedelta(days=(6 - d.weekday()) % 7)
        return d + timedelta(weeks=n - 1)
    d = date(y, m, calendar.monthrange(y, m)[1])
    return d - timedelta(days=(d.weekday() - 6) % 7)

def _utc(d: date, hour: int) -> int:
    return int(datetime(d.year, d.month, d.day, tzinfo=timezone.utc).timestamp()) + hour * 3600

@lru_cache(maxsize=None)
def _dst_window_utc(rule: str, year: int) -> tuple[int, int]:
    if rule == "eu":
        return _utc(_nth_sunday(year, 3, -1), 1), _utc(_nth_sunday(year, 10, -1), 1)
    if rule == "us":
        return _utc(_nth_sunday(year, 3, 2), 7), _utc(_nth_sunday(year, 11, 1), 6)
    raise ValueError(rule)

def candidates(rule: str, wall_epoch: int) -> list[int]:
    s, e = _dst_window_utc(rule, datetime.fromtimestamp(wall_epoch, tz=timezone.utc).year)
    return [o for o in (DST_S, STD_S) if (o == DST_S) == (s <= wall_epoch - o < e)]
    # len 1 = unambiguous, 2 = repeated hour (day: take [0]), 0 = missing hour (day: STD_S)
```

Golden vectors for tests (broker wall clock, offsets returned by `candidates`) [VERIFIED: ran]:

| Rule | Wall clock | Result |
|------|-----------|--------|
| `eu` | 2026-10-25 02:59:59 | `[10800]` |
| `eu` | 2026-10-25 03:00:00 and 03:59:59 | `[10800, 7200]` (repeated) |
| `eu` | 2026-10-25 04:00:00 | `[7200]` |
| `eu` | 2027-03-28 02:59:59 / 03:00:00-03:59:59 / 04:00:00 | `[7200]` / missing / `[10800]` |
| `us` | 2026-11-01 07:59:59 / 08:00:00-08:59:59 / 09:00:00 | `[10800]` / repeated / `[7200]` |
| `us` | 2027-03-14 08:59:59 / 09:00:00-09:59:59 / 10:00:00 | `[7200]` / missing / `[10800]` |

### Pattern 2: Env resolver that fails loud (one place)

**Names (recommended):** keep `MT5_SERVER_UTC_OFFSET_S` for the fixed integer (D-01 "a fixed-integer form stays"); add `MT5_SERVER_TIME_RULE` with values `eu`, `us`, `fixed`.

| `MT5_SERVER_TIME_RULE` | `MT5_SERVER_UTC_OFFSET_S` | Result |
|------------------------|---------------------------|--------|
| `eu` or `us` | unset or empty | DST rule |
| `eu` or `us` | set | **fail loud** ("one rule only"): the 142.2 RESEARCH runtime-state note warns that a stale env var silently wins; make the stale one an error |
| `fixed` | integer in [-13 h, +13 h] | fixed clock |
| `fixed` | unset / non-integer / out of range | fail loud |
| unset | integer in range | **fixed clock** (back-compat, see Open Question 1) |
| unset | unset | **fail loud** (this removes today's silent `"0"` default) |
| anything else (unknown id, `" EU"`, `"true"`) | any | fail loud (strip and lowercase once; unknown after that is an error) |

The ±13 h bound already exists as `_MT5_MAX_SERVER_UTC_OFFSET_S` in `services/mt5_read.py:93`; restate it in the leaf module (a leaf must not import `mt5_read`, which pulls the client stack) and add a one-line parity test.

**Disposition of a config fault:** raise a dedicated exception class that is NOT a subclass of `Mt5DealClassificationError` (job_worker's handler maps that class to a user-facing `_stamp_strategy_analytics_failed` stamp and a permanent failure; a worker misconfiguration must never be stamped on a user's strategy). In the derive, resolve immediately after the `mt5_enabled_server()` gate (`job_worker.py` MT5 branch, before the imports and the read) and return `DispatchResult(outcome=DispatchOutcome.FAILED, error_message=..., error_kind="permanent")` with NO analytics stamp, the same shape as the kill-switch refusal [VERIFIED: read `job_worker.py:5915`, `if not mt5_enabled_server():`]. The next nightly derive is a new job, so a corrected variable heals it. In `reconstruct_allocator_history` use `_fail(<new key>, "transient")` and add the key to `_MT5_BACKFILL_MESSAGES` (`equity_reconstruction.py:4452`); a one-time rebuild must retry after the founder fixes the variable. A new key moves a census: `tests/test_reconstruct_whole_account.py:1797-1883` maps messages to arms and has an `unmapped` fallback, and `tests/test_equity_reconstruction.py:6616` imports the dict. Grep `_MT5_BACKFILL_MESSAGES` and `history_unsettled` (the sibling key) before adding.

### Pattern 3: Seam widening

`_require_offset_seconds` keeps rejecting `bool`/`float`/`str`/`None` and additionally accepts `Mt5ServerClock`. One helper returns the offset for a given deal epoch:

- `deal_utc_day(time_value, clock)`: parse epoch once (existing `_server_epoch_seconds`), `offset = clock.day_offset_s(int(floor(epoch)))`, `utc_epoch = epoch - offset`.
- `deal_utc_instant_ms(deal, clock)`: same parse; `clock.instant_offset_s(...)` returns `None` for ambiguous or missing; then `None`. Keep the existing day-agreement oracle (`instant_day == day`).
- An int is wrapped as a fixed clock inside `_require_offset_seconds`'s caller, so `isinstance(int)` code paths and every existing test are unchanged.
- `reconstruct_mt5_nav_levels`, `mt5_day_pnl`, `combine_mt5_deal_ledger`, `_fold_mt5_deals`, `_mt5_flow_day_timing`: change the annotation to `int | Mt5ServerClock` only. Do not remove the `= 0` defaults of the three public functions (surgical); instead the single-reader source test and the resolver make the worker path fail loud. Rewrite the "Known limit (Pitfall 3...)" paragraph at `mt5_deals.py:277-280`: the claim "The order of deals and flows within the broker clock is exact either way" is true only for the realized ledger and false once a mark (a true-UTC observation) is compared with a deal (REVIEW-3 WR-02); with a DST-aware clock the order guarantee is also lost across the transition hour, and that hour yields `None`.

### Anti-Patterns to Avoid

- **Caching the resolved clock in a module global or `lru_cache` on the env read.** Tests monkeypatch env per test and a Railway variable change restarts the process anyway; resolve per derive (cheap) and memoize only the per-year window table.
- **Reading the env var anywhere but the resolver** (the defect being removed). Pin it with a source test.
- **Per-deal calls that each re-parse env**, or computing the day and the instant with two different clocks (the D-08 invariant: one seam, one clock per derive).
- **Treating the repeated hour as a data error** (raising): a derive that succeeds today must still succeed (164.6.6.2.3 D-07 stance). Day: deterministic. Instant: `None`.
- **Putting the broker server name in a rule table or a test** (T-134-01).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Independent truth for the rule function | A second copy of the transition formulas inside the test | `zoneinfo` (`Europe/Athens`, `America/New_York`) as the oracle; the same algorithm in the test would pass for the wrong reason | CLAUDE.md "money-math oracles are independent invariants". |
| NAV/flow placement against the mark | A new placement path | Existing `apply_marks(flow_instants=...)` rule 10 | Already correct; only its inputs were wrong. |
| Rebuilding stored allocator history | A migration or hand SQL | The product's forced account rebuild: `force_rebuild: true` job metadata (`RECONSTRUCT_FORCE_REBUILD_KEY`, `equity_reconstruction.py:2156`), venue `mt5` is already in `_ACCOUNT_REBUILD_VENUES: Final[frozenset[str]] = frozenset({"bybit", "binance", "mt5", "okx"})` (`:2264`) | It replaces a window atomically, refuses a day it does not reproduce, and records the `snapshot_rebuild_boundary` seam (D-01..D-03 of ACCTREBUILD). |
| Before/after comparison harness | A new reporting framework | Reuse the captured-ledger JSON shape of `scripts/flowtiming_dry_run.py` (`{"offset_s", "keys": {id: {"status": "captured", "deals", "equity", "balance", "currency"}}}`), with a small counts-only module | Redaction contract and ordinals already exist (`_scrub`, ordinals from list position). |

**Key insight:** the logic is tiny; the risk is in the plumbing (seven reads, five signatures, about 54 tests that lean on the silent default) and in the operations (which rule, which dates, which value is live right now).

## Runtime State Inventory

This is a behaviour and configuration change that re-buckets stored history, so the categories are answered explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `strategy_analytics` series and `allocator_equity_derived` `key_inputs:%` payloads are re-derived from the full ledger every nightly derive, so they re-bucket by themselves after deploy. `allocator_equity_snapshots` rows are written once (`on_conflict="allocator_id,asof", ignore_duplicates=True`, `equity_reconstruction.py:1634-1635`), so the days that moved keep their old value until a forced rebuild. NAVMTM marks are offset-independent (D-06); stored marks need no repair. | Data migration for snapshots only: named forced rebuild, only for keys whose days moved (D-03). Code edit for everything else. |
| Live service config | Railway worker env: `MT5_SERVER_UTC_OFFSET_S=10800` is live (TODOS.md:1001, "Server-UTC offset now SET (2026-07-25)"; that file is the source, the value was not read from Railway this session). The new `MT5_SERVER_TIME_RULE` does not exist yet. | Founder sets the rule and DELETES the integer in the same Railway variable change after 175 is deployed; until then the integer form works unchanged (back-compat). |
| OS-registered state | None: no cron, pm2 or scheduler embeds the variable. The nightly chain is pg_cron SQL that enqueues jobs; it carries no offset. | None, verified by the call-site census (grep, not proof). |
| Secrets/env vars | `MT5_SERVER_UTC_OFFSET_S` (renamed meaning: now "the fixed form"). `MT5_SOAK_SERVER_OFFSET_MIN` (separate knob, script only). The broker server name is secret-grade and must not appear in any rule table. | Document the pair in the runbook; no secret changes. |
| Build artifacts / installed packages | None. Pure Python, no package change, no image change (stdlib only). | None. |

## Common Pitfalls

### Pitfall 1: The interim value is wrong for half of the ledger by construction
**What goes wrong:** `MT5_SERVER_UTC_OFFSET_S` is applied to the whole re-read ledger, not only to new deals. Setting 7200 now fixes winter flows and breaks summer 2026 deals that were bucketed at 10800 since go-live (a deal whose broker wall time is within the one-hour band that straddles a UTC day boundary under the other offset moves to the other day).
**Why:** a fixed integer cannot describe two offsets. D-02 accepts it as an interim; the permanent fix is the rule.
**How to avoid:** state it in the runbook step; prefer the value that is right for the NEXT nightly reads (D-23 placement) and ship the rule before 2027-03-14 so the hand-set value is not flipped again in spring.
**Warning signs:** a derive after the change shows moved days in summer months.

### Pitfall 2: Fail-loud on unset breaks about 54 existing tests
**What goes wrong:** removing the silent `"0"` default makes every test that drives the MT5 branch without setting the variable raise. Measured this session with a simulated fail-loud (an `os.getenv` wrapper loaded via `-p`): `tests/test_mt5_derive_branch.py` 24 of 51 fail, `tests/test_equity_reconstruction.py` 1 fails, and across a 12-file MT5-related subset 29 more fail (`test_allocator_equity_writer_basis.py` 7, `test_derive_allocator_equity_job.py` 9, `test_nav_marks_compose_roundtrip.py` 5, `test_nav_marks_derive_apply.py` 8). That is at least 54 tests, from a subset of the files that mention `"mt5"`.
**How to avoid:** one autouse fixture in `tests/conftest.py` that sets `MT5_SERVER_UTC_OFFSET_S=0` (precedent: `_mt5_known_servers_admit_the_suites_synthetic_servers`, `conftest.py:401`). Tests of the fail-loud table `monkeypatch.delenv(...)` themselves. Re-run the simulated census over the whole `tests/` tree when planning; the wrapper is five lines (`os.getenv` replaced to raise when the key is unset).

### Pitfall 3: A config error stamped on a user's strategy
**What goes wrong:** raising `Mt5DealClassificationError` (or letting the config error fall into its handler) writes a user-visible "deal ledger could not be classified" failure for an operator mistake.
**How to avoid:** separate exception class, resolve before the combine, `permanent` result with no `_stamp_strategy_analytics_failed` (see Pattern 2).

### Pitfall 4: The derive's day and instant disagree
**What goes wrong:** `_mt5_flow_by_day` (day) and `_event_flow_instants` (instant) are built from two separate calls at sites 4 and 5; if one used an int and the other the clock, a flow lands on one day with the instant of another and `apply_marks` rule 10 mis-places it.
**How to avoid:** one `_mt5_clock` variable, threaded to all seven sites; keep the seam's day-agreement check.

### Pitfall 5: Marking the repeated hour `None` leaves a double-booking window
**What goes wrong:** `_mt5_instantless_days` flows keep their own day; "one that really landed before a mark's read is booked by that mark and again on its own day" (`job_worker.py:7380-7393`). Under `eu`, the repeated hour overlaps 00:00-00:10Z of the transition Sunday.
**How to avoid:** accept it: it affects one hour on two Sundays a year, only if a deposit is booked in that hour, and the existing warning already counts it. Do not invent an instant.

### Pitfall 6: The rule's flip instant may not be the broker's
**What goes wrong:** the rule flips at New York 02:00 (US) or 01:00Z (EU). A broker could flip its server clock at a different weekend moment. Only deals stamped in the hours between the rule's instant and the broker's real instant are affected (a weekend, so mainly crypto CFDs and back-office balance deals).
**How to avoid:** record it as an assumption (A2) and, if the founder can, read the Market Watch clock once across the 2027-03-14 weekend. Phase 155 / MT5-06 owns a continuous check; this phase does not.

### Pitfall 7: Measuring on a weekend or an illiquid symbol
**What goes wrong:** the Market Watch clock reflects the last tick; on a closed market or a dead symbol it shows a stale time (142.2 RESEARCH Pattern 6: a live tick is the only reliable clock; a last-deal estimate produced a spurious -810).
**How to avoid:** read on a weekday while a liquid symbol is ticking; see the procedure.

### Pitfall 8: Doc edits that renumber runbook steps
**What goes wrong:** `scripts/prod-prober/arms/mt5.mjs:120` and `scripts/prod-prober/run.mjs:4581` cite "`docs/runbooks/mt5-go-live.md` Step 2" and `src/__tests__/prod-prober-wiring.test.ts:3062` expects the remedy to contain the runbook path.
**How to avoid:** make the runbook edits additive (a new pre-flight item, a sentence in Step 2 item 3); do not renumber.

## Operator Measurement Procedure (D-02, SC-1, SC-3)

**What is read:** the broker's server clock in the MT5 terminal, compared with UTC. Whole-hour difference = `server - UTC`. [CITED: MQL5 community blog "How to Find Your Broker's GMT Offset": formula "GMT Offset = MT5 Server Time - Current GMT Time", server time from the Market Watch clock; typical pattern GMT+2 in winter, GMT+3 in summer, tied to US DST (second Sunday of March to first Sunday of November), "New York close plus 7 hours".] [CITED: the broker's own public help-centre article on the displayed trading-platform time, found by web search 2026-10-27: server runs GMT+2, GMT+3 during daylight saving, server midnight lines up with the 5 PM New York close, live server time visible in Market Watch.] These are priors for the US rule, not a measurement (the article does not state the switch dates).

**Reading steps** (UI mechanics are [ASSUMED], A3): open the terminal (the founder's own desktop MT5 logged into the same broker server is the low-ceremony route; the gateway's VNC console exists per `mt5-go-live.md` Step 2 item 3 but needs the temporary public :3000 access, which the runbook tears down, so do not reopen it just for this). Open Market Watch (Ctrl+M); pick a liquid symbol that is visibly ticking (for example a major FX pair); read the time Market Watch shows. At the same moment read UTC (`date -u` or a UTC clock site). Record: date, server HH:MM:SS, UTC HH:MM:SS, difference rounded to whole hours. Do not record the server name, the login or any balance.

**Discrimination table** (server minus UTC; dates verified for 2026-2027):

| Candidate | Tue 2026-10-27 (R1) | Mon 2026-11-02 (R2) | a weekday between 2027-03-15 and 2027-03-26 (R3, optional) |
|-----------|---------------------|---------------------|------------------------------------------------------------|
| `eu` | +2 | +2 | +2 (EU spring is 2027-03-28) |
| `us` | +3 | +2 | +3 (US spring is 2027-03-14) |
| fixed +3 | +3 | +3 | +3 |
| fixed +2 | +2 | +2 | +2 |

- R1 = +2: EU or fixed +2. Summer 2026 evidence is +3 (MILESTONES.md go-live line: "server-time offset `MT5_SERVER_UTC_OFFSET_S=10800` (EEST)"; whether that was a live reading or an assumption is not established, A4), which excludes fixed +2 and leaves `eu`. EU ended 2026-10-25 01:00Z, so set `MT5_SERVER_UTC_OFFSET_S=7200` now: every nightly read since Oct 25 has used a clock an hour fast.
- R1 = +3: US or fixed +3; both agree until 2026-11-01 06:00Z, so leaving 10800 is right today. R2 decides: +2 means `us`, +3 means fixed +3.
- Exposure on the `us` branch: the flip is Sunday 2026-11-01 06:00Z; the next nightly read is 00:10Z Monday 2026-11-02. If the founder waits for R2 on Monday, that night's read still runs on 10800. The lower-risk order is to set 7200 after 06:00Z on Sunday 2026-11-01 (the prior favours `us`) and verify with R2 on Monday; if R2 reads +3, set 10800 back (one night at risk instead of every night of winter). This is the founder's call; flag it in the runbook step.
- SC-1 record: the rule id, both reading dates and the differences, in the phase SUMMARY and in the runbook step (no server name).
- Shipping deadline pressure: if the rule has not shipped by 2027-03-14 (US) / 2027-03-28 (EU), the hand-set integer must be flipped again.

## Code Examples

### The reviewer's reproduction, to become the SC-2 anchor test (RED under the fixed 10800)

```python
# Source: NAVMTM REVIEW-3 WR-02 repro, re-run at HEAD this session (cum 0.020000 right vs 0.549804 as deployed).
# A 50k deposit at true 00:30Z on 2026-11-11; the mark for 11-10 is read at 00:10Z (NAV 102k, open profit 2k);
# the 11-11 mark has NAV 152k. The broker (rule us or eu) is on UTC+2 that night.
true_utc = datetime.fromisoformat("2026-11-11T00:30:00+00:00")
server_epoch = int((true_utc + timedelta(hours=2)).replace(tzinfo=None).replace(tzinfo=timezone.utc).timestamp())
deal = {"time": server_epoch, "time_msc": server_epoch * 1000}
for clock in (clock_for("us"), clock_for("eu")):          # must give cum == 0.02 (flat after the +2% step)
    day = deal_utc_day(deal["time"], clock)
    ms = deal_utc_instant_ms(deal, clock)
    out = apply_marks(realized, {day: 50_000.0}, marks, day_pnl={}, flow_instants=[FlowInstant(ms, day, 50_000.0)])
    assert (1 + out.returns).prod() - 1 == pytest.approx(0.02)
# neuter: clock = 10800 (fixed) must give 0.549804 and this test must go RED
```

Add the summer mirror (same deposit in July at true 00:30Z; the broker is on UTC+3; the rule and the fixed 10800 must agree) and a ledger that straddles a transition (one deal either side of the jump gets different offsets).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| One env integer for the broker offset (v1.15 go-live, 2026-07-25) | A rule id plus per-deal offsets; the integer stays as the fixed form | This phase | Right winter and summer, one resolver instead of seven reads |
| Last-deal offset estimator (v1.15 spike) | Rejected: produced a spurious -810 (stale-deal artifact); a live tick is the only reliable server clock | Already recorded in 142.2 RESEARCH Pattern 6 | Measurement stays a founder reading here; the automatic check is Phase 155 |

**Deprecated/outdated:** the `mt5_deals.py:277-280` "known limit" wording (order within the broker clock is exact) is stale since NAVMTM D-23 compares broker time with a true-UTC mark.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The broker follows the US rule (server = New York + 7 h) rather than EU or fixed. Prior from the broker's own help text and the MQL5 blog; the SC-1 readings decide. | Operator Measurement Procedure | Wrong rule id re-buckets history wrongly for about 3 weeks a year (US vs EU) or about 5 months (fixed). Founder confirmation required before the rule id is set. |
| A2 | The broker flips its server clock at the rule's instant (New York 02:00, or 01:00Z), not at some other weekend moment. | Pitfall 6 | Deals stamped in the gap hours on the transition weekend are off by an hour; weekend only. |
| A3 | Market Watch shows the server's last-tick time in its header/column and is the right place to read the clock (UI mechanics not re-verified). | Operator Measurement Procedure | The founder reads a different clock; mitigated by the two-reading discrimination and by comparing against a visibly ticking liquid symbol. |
| A4 | The July 2026 "+3 (EEST)" go-live value was a live reading, not an assumption (only MILESTONES.md/TODOS.md carry it; 142.2 RESEARCH A8 says it was not read from Railway). | Operator Measurement Procedure | If it was assumed, fixed +2 cannot be excluded by it; R3 in spring 2027 or a summer reading then separates `eu` from fixed +2. |
| A5 | MT5 deal `time` is the broker wall clock encoded as an epoch, as the existing seam assumes (repo-cited at `mt5_client.py:3070`, tests; not re-checked against MetaQuotes docs this session). | Pattern 1 | The whole phase rests on it; it is the existing contract, not new. |
| A6 | A meaningful share of the live ledger sits in the moving window (broker 02:00-03:00 in winter under fixed +3; Asia open). Unmeasured; the D-03 before/after answers it. | Runtime State Inventory | If none moves, the forced rebuild is skipped; if many, it is larger than assumed. |
| A7 | Removing the integer variable and setting the rule in one Railway variable change is acceptable operationally (a restart occurs). | Runtime State Inventory | A window with both set fails loud; mitigated by the order of operations. |
| A8 | `permanent` without a stamp is the right disposition for a derive config fault, and `transient` for the one-time backfill. | Pattern 2 | Alternative is `transient` for both; low blast radius either way. |

## Open Questions

1. **Does "an unset rule fails loud" apply when the legacy integer is set?**
   - What we know: CONTEXT D-01 says an unknown or unset rule fails loud and that the fixed-integer form stays. Production has only the integer today.
   - What's unclear: strict reading would fail every MT5 derive between deploy and the founder setting the rule.
   - Recommendation: treat integer-only as the fixed form (explicit configuration, no silent default) and fail loud only when BOTH are unset, or both rule and integer are set. State it to the founder at plan review; it is consistent with "a fixed-integer form stays".
2. **Widen the seam type or rename the parameter?**
   - What we know: the existing call sites pass ints under the name `server_utc_offset_s`; the bad-offset parametrized test pins the validation text.
   - Recommendation: widen to `int | Mt5ServerClock`, keep the name, fix the docstring. Rename only if the planner wants a churn-heavy diff.
3. **How is the D-03 before/after captured?**
   - What we know: the deal times needed are not stored anywhere (`key_inputs.flows` keep `utc_day_iso` and `usd_signed` only), so a ledger capture is required. 164.6.6.2.3 plan 08 did exactly this on 2026-10-12 (8 of 8 keys, one-shot read in the backfill worker through `railway ssh`, write review table, quiet-window SELECTs, both services restarted afterwards). The capture script itself was scratch, not committed.
   - Recommendation: repeat that reviewed, founder-gated procedure (its write-review table is in `164.6.6.2.3-08-SUMMARY.md`), and add a small pure `scripts/mt5offset_dry_run.py` that takes the same captured JSON and reports counts and ordinals only: deals and flow deals whose UTC day changes between the legacy integer and the rule, distinct days affected, deals in the repeated or missing hour. Cheaper fallback if the founder declines another live capture: emit the same counts as a one-line log from the first post-deploy MT5 derive (the ledger is already in memory); that is AFTER deploy, so D-03's "before deploy" is then not met and the founder must accept that.
4. **Interim value when R1 reads +2 or +3** (see the measurement section): set now versus wait for R2. Founder decision, recommended order stated above.
5. **Year range guard.** The hand rule is valid for years 2007 and later for the US (pre-2007 US rule differed) and 1996 and later for the EU. Recommend raising `Mt5DealClassificationError` for a deal year outside 2007-2099 (undatable, in the spirit of the existing out-of-range fail-loud).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python venv with pytest/mypy (main checkout `.venv`; the worktree has none) | tests, mypy | yes | Python 3.12.13 | run the main checkout's interpreter from the worktree's `analytics-service/` |
| `zoneinfo` + system tz database | test oracle | yes (local; `python:3.12-slim` verified by running `ZoneInfo('America/New_York')` in the image 2026-10-27) | stdlib | `tzdata` wheel (present in the local venv) |
| `pytz` | optional second oracle | yes | 2026.2 (requirements.txt:217, via yfinance only) | not needed |
| Docker | image check | yes | 29.5.3 | — |
| Supabase / DB | none (no migration, no SQL) | not used | — | — |
| MT5 terminal + Railway env access | SC-1, SC-3, D-03 capture | founder only | — | blocking for those steps; not for the code |

**Missing dependencies with no fallback:** the founder measurement (SC-1/SC-3) cannot be done by an agent.
**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | pytest (+ pytest-asyncio auto mode), `analytics-service/pytest.ini` (`testpaths = tests`, `pythonpath = .`) |
| Config file | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` (mypy strict, coverage `core = "sysmon"`) |
| Quick run command | from `analytics-service/`: `pytest tests/test_mt5_server_clock.py tests/test_mt5_deal_timing.py tests/test_mt5_deal_reconstruction.py -q -p no:cacheprovider` (measured baseline of the last two: 315 passed in 6.4 s) |
| Full suite command | CI: `pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (needs the local-stack DB; do not run the full tree against a real database from an agent) |
| Offline subset for this phase | `pytest tests/test_mt5_server_clock.py tests/test_mt5_deal_timing.py tests/test_mt5_deal_reconstruction.py tests/test_mt5_derive_branch.py tests/test_equity_reconstruction.py tests/test_mt5_soak.py tests/test_nav_marks_derive_apply.py tests/test_nav_marks_compose_roundtrip.py tests/test_allocator_equity_writer_basis.py tests/test_derive_allocator_equity_job.py tests/test_reconstruct_whole_account.py tests/test_flowtiming_dry_run.py -q -p no:cacheprovider`; run with a scrubbed environment so no Supabase variable leaks in (`env -i HOME=/tmp PATH=/usr/bin:/bin <venv>/bin/python -m pytest ...`, which is how the baselines above were taken: 51 passed for `test_mt5_derive_branch.py`, 315 for the two timing/reconstruction files) |
| mypy (CI line, verbatim) | `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (baseline at HEAD: `Success: no issues found in 123 source files`) |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SC-2 | `offset_at` equals `zoneinfo` for both rules at every quarter-hour 2024-2029 (about 420k points, 2-3 s) | unit, oracle | `pytest tests/test_mt5_server_clock.py -q` | Wave 0 |
| SC-2 | Golden vectors: the 16 rows above, incl. repeated and missing hour | unit | same | Wave 0 |
| SC-2 | Repeated/missing hour: day equal for both candidates (property over 2000-2099), instant `None`, never raises | unit/property | same | Wave 0 |
| SC-2 | Seam accepts int and clock; rejects `True`, `3.5`, `"10800"`, `None` with unchanged text; day and instant agree on one clock | unit | `pytest tests/test_mt5_deal_timing.py -q` | exists (extend) |
| SC-2 | Reviewer repro through `apply_marks`: rule gives cum 0.02; fixed 10800 gives 0.549804 (the RED under fixed) | integration (pure) | `pytest tests/test_mt5_server_clock.py -k mark -q` | Wave 0 |
| SC-2 | A ledger straddling a transition buckets each deal with its own offset (`combine_mt5_deal_ledger`, `mt5_day_pnl`, `reconstruct_mt5_nav_levels`) | unit | `pytest tests/test_mt5_deal_reconstruction.py -q` | exists (extend) |
| SC-2 | Derive threads ONE clock: with env rule `us`, flow day and `FlowInstant` of a winter deal use +2 (sites 4 and 5) and `_apply_day_pnl` uses the same | integration (fakes) | `pytest tests/test_mt5_derive_branch.py -q` | exists (extend) |
| SC-2 | Allocator-history path threads the clock (site 7) and a config fault returns the new `_fail` key | integration | `pytest tests/test_equity_reconstruction.py -q` | exists (extend) |
| D-01 | Resolver table: unset/unset, unknown id, both set, out of range, non-integer, whitespace/case; message names the variable, not a value of a server | unit | `pytest tests/test_mt5_server_clock.py -k resolve -q` | Wave 0 |
| D-01 | Single reader: no `os.getenv("MT5_SERVER_UTC_OFFSET_S"...)` / `os.environ` read outside `services/mt5_server_clock.py` (source test over `services/` and `routers/`; cite by symbol) | source pin | `pytest tests/test_mt5_server_clock.py -k single_reader -q` | Wave 0 |
| D-01 | Config fault is NOT `Mt5DealClassificationError` and writes no analytics stamp | unit/integration | `pytest tests/test_mt5_derive_branch.py -k clock -q` | exists (extend) |
| D-03 | `mt5offset_dry_run` counts days moved between legacy integer and rule on a synthetic captured ledger; output carries no amount, id, or server text | unit | `pytest tests/test_mt5offset_dry_run.py -q` | Wave 0 |
| SC-1 | The rule id and two dated readings are recorded in the phase SUMMARY and the runbook step | manual (founder), justified: only a human at the terminal can read the broker clock | `grep -n` of the runbook step | n/a |
| SC-3 | Runbook pre-flight carries the measurement item; the live value matches the reading | manual (founder) + doc | `grep -n` | n/a |

**Neuter proof (required, CLAUDE.md "tests must be able to fail"):** with the resolver forced to return the fixed 10800 (or the seam ignoring the clock), the SC-2 tests must go RED with the arm named; restore from a byte backup; record both runs in the SUMMARY.

### Sampling Rate
- **Per task commit:** the quick run command above (seconds).
- **Per wave merge:** the offline subset above plus the mypy line.
- **Phase gate:** CI green bound to the head SHA (python job, coverage gate, `frontend` aggregator unaffected), before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_mt5_server_clock.py`: oracle, golden vectors, property, resolver table, single-reader pin, repro through `apply_marks`.
- [ ] `analytics-service/tests/test_mt5offset_dry_run.py` (if the dry-run script is built).
- [ ] `analytics-service/tests/conftest.py`: autouse fixture `MT5_SERVER_UTC_OFFSET_S=0` default (the roughly 54 tests that lean on the silent default; precedent `conftest.py:401`). Run the simulated-unset census over all of `tests/` first.
- [ ] Framework install: none.

## Security Domain

`security_enforcement` is absent from `.planning/config.json`, so it is treated as enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | no credential path changes |
| V3 Session Management | no | — |
| V4 Access Control | no | no new data path or table; no migration |
| V5 Input Validation | yes | the env resolver parses and range-checks (strip, lowercase, closed set, integer within +-13 h); deal `time` parsing keeps the existing fail-loud |
| V6 Cryptography | no | — |
| V7 Error Handling and Logging | yes | config error text names the variable and the allowed ids, never a server, login or amount; the instantless-flow warning stays counts-only |
| V14 Configuration | yes | no silent default; both-set conflict is an error; the broker server name is never committed |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Silent misconfiguration (default `"0"`, stale integer winning over the rule) re-buckets money data | Tampering | resolver fails loud on unset, unknown, and both-set |
| Public-repo leak of the broker server name or a ledger in measurement notes (T-134-01) | Information disclosure | record rule id, dates and whole-hour differences only; redaction contract of `flowtiming_dry_run` (ordinals, counts, `_scrub`) for any capture |
| D-03 capture moves the shared terminal and leaves the worker's in-process registries stale | Tampering / DoS | reuse the 164.6.6.2.3-08 procedure: transitive write review, quiet-window SELECT immediately before, `railway restart` (no rebuild) afterwards, founder-gated |
| Operator misconfiguration stamped on a user's strategy | Repudiation | separate exception class, no analytics stamp (Pitfall 3) |

## Sources

### Primary (HIGH confidence)
- Repo files read this session with line evidence: `analytics-service/services/{mt5_deals,broker_dailies,job_worker,equity_reconstruction,nav_marks_apply,mt5_read,mt5_client}.py`, `analytics-service/scripts/{flowtiming_dry_run,mt5_soak}.py`, `analytics-service/tests/{conftest,test_mt5_deal_timing,test_mt5_deal_reconstruction}.py`, `analytics-service/{Dockerfile,requirements.txt,requirements-dev.txt,pytest.ini,pyproject.toml}`, `docs/runbooks/{navmtm-chain-move-go-live,mt5-go-live}.md`, `.planning/REQUIREMENTS.md` (MT5-06), `.planning/ROADMAP.md` (`### Phase 175`).
- NAVMTM `167.2.1.1.1-REVIEW-3.md` WR-02 and `167.2.1.1.1-CONTEXT.md` D-03, D-06, D-23, read via `git show feat/167.2.1.1.1-navmtm:<path>`.
- `142.2-RESEARCH.md` Pattern 6 and Pitfall 4; `164.6.6.2.3-CONTEXT.md` D-07, D-08; `164.6.6.2.3-08-SUMMARY.md` (capture procedure and write-review table).
- US statute, 15 U.S.C. 260a(a): "During the period commencing at 2 o'clock antemeridian on the second Sunday of March of each year" ... "ending at 2 o'clock antemeridian on the first Sunday of November of each year" (https://www.law.cornell.edu/uscode/text/15/260a).
- EU Directive 2000/84/EC on summer-time arrangements: summer time begins at 01:00 GMT on the last Sunday of March and ends at 01:00 GMT on the last Sunday of October (EUR-Lex; a fetch returned an empty page, so the wording was confirmed through search-result excerpts of the Directive and the IANA tz list thread; the transition instants were also confirmed independently against `zoneinfo`). Wikipedia notes a 2020 repeal proposal that had not progressed; the Directive is treated as in force.
- Local runs this session: `zoneinfo` oracle comparison (420,864 quarter-hours, 0 mismatches), day-invariance property (2000-2099, 0 violations), reviewer repro at HEAD, docker `python:3.12-slim` zoneinfo check, mypy baseline, pytest baselines, simulated fail-loud census.

### Secondary (MEDIUM confidence)
- MQL5 community blog "How to Find Your Broker's GMT Offset" (https://www.mql5.com/en/blogs/post/773934): measurement formula and the US-DST-aligned +2/+3 pattern.
- The broker's public help-centre article on the displayed trading-platform time (found via web search 2026-10-27; the page itself returned HTTP 403 to a direct fetch): GMT+2 / GMT+3 during DST, midnight = 5 PM New York close, live server time in Market Watch.

### Tertiary (LOW confidence)
- None used as a basis for a recommendation. The broker's actual switch instants are unknown (A1, A2).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - stdlib only; verified in the target image.
- Architecture: HIGH - every read, signature and consumer opened this session; algorithm validated against an independent oracle.
- Pitfalls: HIGH for code-side items (measured), MEDIUM for operational ones (A1-A4, A7).

**Research date:** 2026-10-27
**Valid until:** 2026-11-03 for the dated measurement guidance (R1/R2 dates); 30 days for the code census (re-grep `MT5_SERVER_UTC_OFFSET_S` at plan time).
