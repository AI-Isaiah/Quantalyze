# Phase 232: OKXTRADES - Research

**Researched:** 2026-11-24
**Domain:** Python analytics service (`analytics-service/`), OKX v5 account-bills read, trade-sync cursor
**Confidence:** MEDIUM-HIGH (code facts HIGH; OKX venue behaviour under `begin`/`end` is UNMEASURED and tagged `[ASSUMED]`)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
(The "PROD readings" bullets and the "Decided autonomously" bullets of `232-CONTEXT.md`, copied verbatim.)

### PROD readings taken 2026-11-24 (marker query returned the PRODUCTION comment first; counts only, no ids)
- `api_keys.last_fetched_trade_timestamp` is non-NULL on 20 active keys: Bybit 5 (4 with no stored fill at all, 1 ahead of its newest stored fill by 33.0 days), MT5 10 (none has any stored fill), OKX 5 (2 with no stored fill, 2 ahead of their newest stored fill by more than 1 day, at most 6.0 days). No key is ahead of its newest stored daily (`is_fill = false`) row by more than 1 day.
- Code reading: the ONLY writer is `run_sync_trades_job`'s epilogue through the `advance_sync_cursor` RPC, which stamps wall-clock `now` (`_p_last_fetched = _now_iso if advance_fetched_cursor else None`). `advance_fetched_cursor` is true whenever `raw_fills` is empty, which covers a raised fetch, an empty read, the MT5 arm and every run with `USE_RAW_TRADE_INGESTION` off. So the writer that puts the column ahead is identified: it stamps "now" rather than a stored-through mark. The RPC keeps the column monotonic (`CASE ... last_fetched_trade_timestamp < p_last_fetched_ts`), so a lower value cannot be written back through it.

### Decided autonomously
- [VREAD-08] Q: "What does the cursor stamp?" -> Selected: "A stored-through mark: the newest timestamp among the fills this run persisted; when the run persisted no fill, the column is left untouched (NULL param). It never stamps wall-clock now." - Python-only change to the param the existing RPC already takes.
- [VREAD-08] Q: "When may it advance?" -> Selected: "Only when Phase 2 ran, did not raise and persisted, and Phase 1 did not fail: gate `advance_fetched_cursor` on `not phase2_failed` as the 231 hand-off asks. A refused or failed fills read holds the cursor." - one boolean expression.
- [VREAD-08] Q: "How does the read seed when the column is ahead?" -> Selected: "`fills_since_ms` is the EARLIER of the column and the strategy's stored fills high-water (newest `is_fill = true` trade); with no stored fill it falls back to the stored daily high-water, as a NULL cursor does today. So an ahead key re-reads its skipped days; the over-fetch is absorbed by the `exchange_fill_id` unique-index dedup." - read-side clamp, local.
- [VREAD-08] Q: "Does the refusal flag survive until the refused span is covered (231 gap 1)?" -> Selected: "Yes by construction: the cursor holds on a refusal, so the next clean run re-reads from the stored high-water, which covers the refused span; only then does the existing self-heal clear the flag. A test pins that sequence." - no new state.
- [VREAD-08] Q: "231 gap 3 (Phase-1 persist ordered after the Phase-2 walk)?" -> Selected: "Not fixed here: it reorders `run_sync_trades_job` beyond the cursor read and `advance_fetched_cursor` path the ROADMAP fences. Recorded in the phase report and routed by name to 222 ALERTTRUTH (shares the function), latent while `USE_RAW_TRADE_INGESTION` is off." - scope note, revisitable.
- [VREAD-08] Q: "Repair of the columns already ahead on PROD?" -> Selected: "No migration and no RPC change in this phase. The read clamp makes an ahead column harmless at once. A one-time PROD repair (set the column to the newest stored fill, or NULL where none) is proposed to the coordinator for after the merge, recorded in the SUMMARY with the before/after counts; the TODOS gate's repeated read is taken after it." - a data write, decided outside the code.
- [VREAD-06] Q: "Convert or refuse?" -> Selected: "A bill whose `ccy` is a stable coin under the existing shared rule `services/price_rule.is_stable_value` is counted at 1.0 (the codebase's stated rate for stable coins, already used by the current-equity read). Any other `ccy`, including a blank or missing one, refuses the OKX daily-P&L read by name: a new closed token (for example `daily_pnl_non_usd_okx`) recorded through `_record_dq_flag`, carried by `daily_pnl_read_verdict` and the realized refusal set exactly like `daily_pnl_truncated_okx`, never summed. No price source is added." - code-only; a conversion path can be added later without migrating anything. Exposure measured nil so far (the 2026-10-26 archive census: 1606 of 1606 bills USDT; stored OKX fills and funding all USDT).
- [VREAD-06] Q: "Refuse the day or the whole read?" -> Selected: "The whole read, permanent class (the same history fails the same way), like a cap hit. Withholding one day would leave a hole a downstream reader can take for zero P&L." - local to the verdict.
- [VREAD-07] Q: "Already closed by OKXHISTORY?" -> Selected: "Research re-measures at HEAD first. The TODOS entry says 'measured, not fixed, stays open' (2026-10-15 and 2026-10-26), so the default is to fix it." - evidence step.
- [VREAD-07] Q: "Fix shape?" -> Selected: "Walk the OKX bills read in UTC-day-aligned time windows (`begin`/`end` on every request) taken OLDEST first, each window paged newest-first by `after` up to the unchanged `OKX_BILLS_PAGE_CAP`. A walk stopped by the read deadline returns only fully read windows, a contiguous oldest prefix, under a distinct non-error marker so the caller stores that prefix and the next tick resumes from the stored high-water; a single window that exceeds the cap still refuses by name (`daily_pnl_truncated_okx`). Window length is sized by research from the measured bill density." - request-shape change inside the OKX branch of `fetch_daily_pnl`; the exact marker and the caller wiring are research outputs.
- [Fixtures] Q: "Test payloads?" -> Selected: "Built from recorded real OKX v5 `/account/bills` payload shapes (fields `billId`, `ccy`, `pnl`, `fee`, `ts`, `type`, `instType`), mocks mirror the payload, not the parser's field names." - test-only.

### Claude's Discretion
- Plan split and waves, within: research first; VREAD-06 and VREAD-07 both edit the OKX branch of `fetch_daily_pnl`, so they are serial or one plan; VREAD-08 edits only `run_sync_trades_job`'s cursor read and `advance_fetched_cursor` path and can run in parallel. At most 2 executors at once.

### Deferred Ideas (OUT OF SCOPE)
- Converting a non-stable OKX bill at a market rate (needs a price source): not needed while exposure is nil; the refusal names it if it appears.
- 231 gap 3 (Phase-1 persist after the Phase-2 walk): routed to 222 ALERTTRUTH.
- One-time PROD repair of the ahead cursors: coordinator decision after the merge.

(Scope fence, `ROADMAP.md` `### Phase 232`: this phase edits only the cursor read and the `advance_fetched_cursor` path of `run_sync_trades_job`; Phase 223 FLOWKINDS owns `run_sync_funding_job`, `services/okx_archive_job.py`, `services/funding_fetch.py`; plan write scopes are listed BY SYMBOL.)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VREAD-06 | An OKX daily P&L bill in a currency other than USDT is converted at a stated rate or refused by name; never summed at face value. | Section "VREAD-06": ccy check position (after the type-8 drop), `is_stable_value` behaviour, token registration table (7 sites), return `[]` on refusal, consumer list. |
| VREAD-07 | An OKX first window longer than the page cap completes across ticks instead of truncating every day; raising `OKX_BILLS_PAGE_CAP` is not a close. | Section "VREAD-07": OKXHISTORY did NOT close it (re-measured), windowed oldest-first design, window = 7 days, caller wiring (cron deadline + prefix hold), resume table. |
| VREAD-08 | `api_keys.last_fetched_trade_timestamp` never reads ahead of the newest stored trade; a key found ahead has its skipped days re-read. | Section "VREAD-08": stored-through stamp, lazy fills high-water clamp, gate expression, tests that flip, one decision-premise gap (bootstrap self-heal). |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

Directives that bind this phase (project `CLAUDE.md` + `AGENTS.md` + the global `CLAUDE.md`):

- **Python tests only from `analytics-service/`**: `cd analytics-service && python -m pytest ...` (`pytest.ini`: `testpaths = tests`, `pythonpath = .`, `asyncio_mode = auto`). Never `importlib.reload` in tests. Always `grep -a`.
- **mypy strict is a CI gate** (command in "Validation Architecture"). `tests/` stays untyped by design.
- **Neuter, see RED, restore from a byte backup** (`cp` back, `cmp`); never `git checkout/restore/stash` on uncommitted work. Data-integrity gates must be able to fail (PROOF-01).
- **CHANGELOG discipline**: the ship PR writes a unified CHANGELOG entry in the same commit as the VERSION bump, names the closed TODOS entries (`[167.1.2.2.2.1-OKX-DAILY-PNL-MIXED-CCY]`, `[167.1.2.2.2-OKX-PERSISTENT-TRUNCATION]`, `167.1.2.2.2-LAST-FETCHED-TRADE-TS-AHEAD`), and **deletes them from `TODOS.md` in the same PR**; fix any pointer to them (a dated corrected note) in the same PR. Never write the CI-skip tokens in a commit or PR body, even to deny them.
- **No AI authorship attribution** in commits/PRs (memory rule, founder 2026-10-20); the per-session attribution reminder conflicts with it, so the orchestrator decides.
- **`.planning/` is tracked in a public repo**: no secrets, PROD ids, home paths, account numbers. This file cites paths repo-relative.
- **Fail loud, fail alone**: a typed, scrubbed refusal by a closed token, never a silent partial (186 decision 05). Venue message text never reaches a stored flag, log field of record, or marker (ccxt messages can carry signed URLs): class names and closed tokens only.
- **Before `CREATE OR REPLACE`, re-base on the latest definition**: not triggered (no migration, no RPC change).
- **Parallel-phase hygiene**: do not touch `services/okx_archive_job.py`, `services/funding_fetch.py`, `run_sync_funding_job` (Phase 223); 222 ALERTTRUTH re-bases on this phase's `run_sync_trades_job` edit, so keep the diff to the cursor read and the `advance_fetched_cursor` path.
- **Cite by symbol, not line number** (line numbers drift; they are hints only here).

## Summary

**VREAD-06 (mixed currency).** Today the OKX branch of `fetch_daily_pnl` never reads `ccy`: it sums `pnl + fee` per UTC day for every non-funding bill (`pnl_val = _pnl_raw + _fee_raw`), so a BTC-denominated bill is added to USDT P&L at face value. The fix is a ccy check placed **after the type-8 funding drop and before the amount parse**: a stable `ccy` (`is_stable_value`) counts at 1.0; anything else (including blank/missing) stamps a new closed token and the walk returns `[]`. The new token must be registered in six places for it to behave like `daily_pnl_truncated_okx` end to end (table below); one reader (`okx_archive_job._check_live_realized_flags`, Phase 223's file) matches two exact flag names and will not see it, so that needs a hand-off, not an edit here.

**VREAD-07 (long first window).** OKXHISTORY (167.1.2.2.2.1) did **not** close the truncation: its plan 10 recorded "measured, not fixed, stays open", and at HEAD `fetch_daily_pnl` still runs one `range(OKX_BILLS_PAGE_CAP)` page loop per (endpoint, instType) over the whole range with `begin` only. The fix is a window-major walk: UTC-day-aligned 7-day windows, oldest first, every instType and endpoint read per window, each window paged newest-first by `after` up to the unchanged cap (100). A deadline stop or a cap breach returns only completely read windows (a contiguous oldest prefix). **Recommended marker: reuse the existing `daily_pnl_deadline_okx` flag** (already distinct from `daily_pnl_truncated_okx`, already refused by the derive verdict, zero change to the 480-case parity matrix) and give the cron the one new behaviour: pass an OKX-only read deadline and treat that flag as "store the prefix, hold every cursor". Without that cron change a long first window never completes (it hits the cron's 60 s `wait_for` cancel with nothing stored). Several venue behaviours that this design leans on (order under `begin`, `begin`/`end` inclusivity, what `/account/bills` returns for a window older than 7 days) are **unmeasured** inside this repo, so the walk is made self-checking and fails by name on drift.

**VREAD-08 (cursor ahead).** The only reader is `fills_since_ms = parse_since_ms(None, preferred=ctx.key_row.get("last_fetched_trade_timestamp"))` and the only writer is the epilogue's `_p_last_fetched = _now_iso if advance_fetched_cursor else None`. The fix is Python-only: stamp `max(timestamp)` of the fills the run persisted under `phase2_complete and not phase1_failed and not phase2_failed` (else NULL), and clamp the read to `min(column, newest stored fill)` via a new lazy helper in `services/trade_resume.py`. No migration; the RPC's monotonic guard already makes a lower value a no-op. One premise of the CONTEXT decision does not hold in the bootstrap case (see Open Question 1): with a NULL column and no stored fill, the refused span is re-read from the *daily* high-water, which advances every day, so "the next clean run covers the refused span" is false there.

**Primary recommendation:** Three code changes in `services/exchange.py` (ccy refusal + windowed walk), `services/job_worker.py` + `routers/cron.py` (token registration, cron prefix handling), and `services/job_worker.py` + `services/trade_resume.py` (cursor); reuse `daily_pnl_deadline_okx` as the prefix marker; window = 7 days; do **not** reuse `walk_paginated` (inst-major, no deadline hook).

### Needs a ruling before planning (decisions this research could not close)

| # | Question | Recommendation |
|---|----------|----------------|
| Q1 | The VREAD-08 "flag survives until the span is covered" premise fails at bootstrap (NULL column, no stored fill). | Record a `phase2_failed_since_ms` beside `phase2_failed_at`, or accept and document; see Open Question 1. |
| Q2 | Marker name: reuse `daily_pnl_deadline_okx` (recommended) or mint a new name (needs verdict + token + parity-matrix edits and a derive refusal mapping so the derive does not read a prefix as complete). | Reuse. |
| Q3 | ccy-only refusal vs "ccy not stable AND nonzero `pnl + fee`". CONTEXT says ccy-only. | Implement CONTEXT literally; flag that zero-amount legs (the base-coin leg of a spot sell) refuse a spot-trading key permanently. OKXHISTORY section 1 keyed on nonzero amounts. |
| Q4 | Phase 223's `_check_live_realized_flags` will not name the new token (and never names the deadline flag). | One-line hand-off to Phase 223 (exact text below). |
| Q5 | Adopt the self-checking walk (window clip + billId-descending check)? It forces every OKX fixture with an out-of-window `ts` to be re-dated. | Adopt; it is the only guard against a venue that ignores `begin`/`end` or serves oldest-first under `begin`. |
| Q6 | Age-route endpoints per window (`/bills` for the last 7 days, `/bills-archive` older) instead of today's "archive only if `since_ms` is older than 90 days" gate. | Adopt; flips `test_90_day_gate_skips_archive`. |
| Q7 | Hold `advance_fetched_cursor` also when a `sync_truncated_*` flag is set (extends the locked "only when Phase 2 ran, did not raise and persisted" gate). | Adopt (one extra conjunct). |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| OKX bills read, ccy refusal, windowed walk | API / Backend (`analytics-service/services/exchange.py`) | - | Pure venue I/O + aggregation; no browser or DB involvement. |
| Refusal token registry (derive) | API / Backend (`services/job_worker.py`) | Database (owner-only `allocator_equity_derived` marker row, already exists) | Closed token set is written to an existing owner-only row family; no schema change. |
| Cron prefix handling | API / Backend (`routers/cron.py`) | Database (`trades` via `sync_trades` RPC, `api_keys`, per-strategy cursor table) | The cron owns store + cursor decisions. |
| Fills cursor read/stamp | API / Backend (`services/job_worker.py::run_sync_trades_job`, `services/trade_resume.py`) | Database (`advance_sync_cursor` RPC, `trades` index read) | Python picks the value; the existing RPC keeps it monotonic. |
| PROD column repair | Database (one-time data write, post-merge, coordinator) | - | Not a code path; decided outside this phase. |

No browser/frontend tier is involved: the TS side keys on the presence of a `read_incomplete:` row, not on token names [VERIFIED: `src/lib/queries.ts` grep for `token` and `read_incomplete` found only the reason class, no token enumeration].

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| ccxt (async) | **CI pin 4.5.89** | OKX implicit methods `private_get_account_bills`, `private_get_account_bills_archive` | Already the repo's venue client `[VERIFIED: analytics-service/requirements.txt:33 `ccxt==4.5.89`]` |
| pytest / pytest-asyncio | `pytest<9.2`, asyncio auto mode | Tests | `[VERIFIED: analytics-service/requirements-dev.txt:43 `pytest<9.2`; pytest.ini `asyncio_mode = auto`]` |
| mypy | **2.4.0** (strict) | Type gate | `[VERIFIED: requirements-dev.txt:53 `mypy==2.4.0`]` |

### Supporting
None new. `services/price_rule.is_stable_value`, `services/closed_sets.STABLECOINS`, `services/exchange_pagination._MS_PER_DAY`-style constants already exist.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Own window-major generator | `services/exchange_pagination.walk_paginated` | Rejected: inst-major (one inst type across all windows, then the next), no deadline hook, windows advance `prev_end + 1` so they are not UTC-day aligned after the first, and it cannot discard a partially read window. A contiguous oldest prefix needs window-major order. |
| Reuse `daily_pnl_deadline_okx` | New marker (e.g. `daily_pnl_resume_okx`) | New name needs: verdict + `READ_INCOMPLETE_TOKENS` + `_realized_refusal_token` mapping so the derive still refuses it, parity-matrix growth, and a cron reader. Reuse changes only the cron. |

**Installation:** none. **Package Legitimacy Audit:** this phase installs no external packages (no `npm`/`pip` change), so the `package-legitimacy` gate does not apply; no `SLOP`/`SUS` verdicts.

**Version facts (state them in the plan):**
- CI pins **ccxt 4.5.89** (`analytics-service/requirements.txt:33`). The main checkout's `analytics-service/.venv` carries **4.5.85** (Python 3.12.13, pytest 9.1.1, mypy 2.4.0); the system `python3` has 4.5.64 on Python 3.14 (do not use it); the phase-232 worktree has **no venv**. **All test and mypy runs in this research used the main checkout's `.venv` interpreter run with cwd = the worktree's `analytics-service/`** (`pytest.ini` `pythonpath = .` makes it import the worktree's code). Local 4.5.85 does not match CI 4.5.89; the OKX tests use mocks of the two implicit methods so a ccxt skew is not expected to matter `[ASSUMED]` (CI will confirm; the first push is the check).
- Baselines at HEAD (worktree, ccxt 4.5.85): `tests/test_exchange_harness.py tests/test_daily_pnl_read_verdict.py tests/test_sync_trades_resume_seed.py` = **542 passed in 15.6 s**; the wider affected set (list under Validation Architecture) = **1328 passed, 1 skipped in 61.9 s**; mypy = **`Success: no issues found in 142 source files`**.

## Architecture Patterns

### System Architecture Diagram

```
                          fetch_daily_pnl(exchange, since_ms, read_deadline_s)   [OKX branch]
 callers ───────────────▶  S0 = floor_day(since_ms or now - 93d)   (since_ms=None => reach start)
 cron  (since=high-water,                │
        deadline=OKX_CRON_DEADLINE)      ▼
 queued sync job (since=high-water)   for window k = [S0+7d*k, +7d) oldest first   ◀── deadline check before EVERY request
 derive (since=None, 397 s)               │
 /fetch-trades, verify, composite         │   for inst_type in ["SWAP","FUTURES","SPOT","MARGIN"]   (literal list: AST-pinned)
 okx_archive_job (since=None)             │      endpoint by age: /bills if window ends after live_floor,
                                          │                       /bills-archive if window starts before it (straddle: both)
                                          │      page newest-first: after=<last billId>, up to OKX_BILLS_PAGE_CAP per (window, inst, endpoint)
                                          │      checks per page: ts inside window (+-1 ms edge), billId descending  ──▶ drift ⇒ raise (named class)
                                          ▼
                              window complete? ──no (deadline)──▶ discard window, stamp daily_pnl_deadline_okx, STOP
                                          │       no (cap)     ──▶ discard window, stamp daily_pnl_truncated_okx, STOP
                                          ▼ yes
                              scan window bills: non-stable ccy (after type-8 drop)? ──yes──▶ stamp daily_pnl_non_usd_okx, return []
                                          ▼ no
                              keep bills (dedup by billId) ──▶ next window ... ──▶ aggregate per UTC day (drop type 8, pnl+fee)
                                          ▼
                              rows = whole days of the completed windows only (a contiguous oldest prefix on any stop)

 consumers of the DQ buffer:
   cron _fetch_degradation ── truncated_* / non_usd / fetch_error ──▶ degraded: store nothing, hold, status "error"
   cron (new) deadline_okx ───────────────────────────────────────▶ prefix: store rows, hold key cursor + markers, no stamp, no enqueue, status "held"
   derive daily_pnl_read_verdict ── all reasons incl. deadline ─────▶ refuse (read_deadline | truncated | non_usd), write nothing
   queued sync job (no flag read before the RPC) ───────────────────▶ stores whatever is returned (safe: prefix or [])
```

### Recommended write scopes (BY SYMBOL), suggested plan split

- **Plan A (VREAD-06 + VREAD-07 core, serial, one executor):** `services/exchange.py`: `fetch_daily_pnl` (OKX branch only), new module constants (`OKX_BILLS_WINDOW_DAYS`, `OKX_BILLS_REACH_DAYS`, `OKX_LIVE_BILLS_DAYS`), `daily_pnl_read_verdict` (token), new helper(s) for one window read. `services/job_worker.py`: `READ_INCOMPLETE_TOKENS`, `_DAILY_PNL_REFUSAL_ORDER` (not `_TRANSIENT_REFUSAL_TOKENS`). `routers/cron.py`: `_fetch_degradation` (token) and, in Plan B, the prefix handling.
- **Plan B (cron prefix handling):** `routers/cron.py`: `_sync_single_key` (deadline kwarg for OKX, prefix flag, the four gates: store, `should_advance_cursor`, `strategy_advances`, `recompute_strategy_ids`), a new `_fetch_prefix_only(flags)` helper. Depends on Plan A's walk (it can be developed against a mocked `fetch_all_trades`).
- **Plan C (VREAD-08, parallel to A/B, a different worktree):** `services/job_worker.py::run_sync_trades_job` (the `fills_since_ms` block and the `advance_fetched_cursor` / `_p_last_fetched` epilogue only), `services/trade_resume.py` (one new function). 222 ALERTTRUTH shares `run_sync_trades_job`: keep that diff to exactly those two spans.
- **Not edited (hand-offs):** `services/okx_archive_job.py::_check_live_realized_flags` (223), `services/funding_fetch.py`, `run_sync_funding_job`.

### Pattern 1: window-major generator, day aligned, overlap-safe edges
**What:** windows are `[S0 + k*W, S0 + (k+1)*W)` with `S0` a UTC-day floor and `W = 7 * 86_400_000`; the last window ends at `now_ms`. Each request carries `begin = start - 1` and `end = next_start` (overlap by one millisecond each side), and the walk **clips** returned rows to `[start, next_start)`, accepting rows exactly at `start-1` / `next_start` as edge rows to drop silently. Any other out-of-window row means the venue ignored `begin`/`end`: raise a typed exception (class name flows through `daily_pnl_fetch_error_class`). `[ASSUMED]` basis: `begin`/`end` inclusivity is undocumented (`tests/_okx_bills.py` docstring: "whether the venue's bounds are inclusive is undocumented; inclusive is assumed, RESEARCH A4"; `179-RESEARCH.md` row A4). Overlap + clip is exact under either semantics.
**Why not `walk_paginated._windows`:** its `next_start = prev_end + 1` drifts one millisecond per window off the UTC-day grid; the partial-day hazard (`_floor_to_utc_day_ms` docstring in `routers/cron.py`) is exactly a window that starts mid-day.

### Pattern 2: whole windows or nothing
Collect each window's bills in a local list; only after all four instTypes (and the needed endpoints) finish does the window's list join `all_bills`. On a deadline or a cap breach the local list is dropped. Because windows are day-aligned, every returned day is entirely inside one completed window, so storing the result never stores a partial day (the cron's `sync_trades` call deletes the payload's `[min, max]` day span before inserting, so a partial day would overwrite a whole stored one).

### Pattern 3: refusal returns no rows
On the ccy refusal return `[]` and stamp the token. Rationale (unflagged callers): `/fetch-trades` (`routers/exchange.py::fetch_trades`), `verify_strategy` (`routers/portfolio.py`), the queued sync job's Phase 1 and the composite member read never read the DQ buffer before they use the rows; an empty list stores nothing / fails closed, a partial list would be taken as truth.

### Anti-Patterns to Avoid
- **Raising `OKX_BILLS_PAGE_CAP`** (explicitly "not a close"); also leave `OKX_ARCHIVE_PAGE_CAP = 100`. Pin both at 100 in a test.
- **Treating a flag as the stop**: a flag alone does not stop a sum; the OKX branch must return `[]` itself.
- **Client-side filtering that hides a venue defect**: dropping out-of-window rows silently would turn a venue that ignores `begin`/`end` into a quietly different read. Only the 1 ms edge is dropped silently; everything else refuses by name.
- **Marking an empty prefix as an idle tick**: `not trades` is evidence of idleness only when no deadline flag is set (same trap as `daily_pnl_fetch_error` in the cron's `strategy_advances`).
- **Writing a held marker row at the prefix end for a marker-less strategy**: `MAX_MARKER_LOOKBACK_MS` (30 days) clamps it on the next read and abandons the remainder (the cron's own documented trap).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stable-coin test | a new `{"USDT","USDC"}` literal | `services.price_rule.is_stable_value` | One shared rule; OKXHISTORY's pinned USD family is a different, narrower set. |
| 429 retry per page | a new retry loop | `_okx_bills_fetch_with_backoff` | Already re-raises non-429s; used by every OKX bills reader. |
| Finite-number parse | `float()` | `_finite_float` | Rejects NaN/Inf strings (NEW-C13-09). |
| Day floor | new arithmetic | `ms - ms % _MS_PER_UTC_DAY` pattern (`routers/cron.py::_floor_to_utc_day_ms`) | Same grid the cron already uses. |
| Timestamp parse for the stamp | `fromisoformat` inline | `services.ingestion._timestamps.coerce_to_aware_utc` | Raises `ValueError` on unsupported shapes (catch it and hold the cursor). |
| Venue-faithful OKX fake | `AsyncMock` that ignores params | `tests/_okx_bills.py::OkxBillsArchive` + `okx_bill` | Honours `begin`/`end`/`after`/`limit`/`instType`, newest-first by `billId`; has `oldest_first_with_begin`, `ignore_after`, `empty_after_cursor` switches for the negative tests. |
| High-water read fake | bare `MagicMock` | the `_FakeTradesQuery` shape in `tests/test_sync_trades_resume_seed.py` | Applies every `.eq/.order/.limit`, so a failed read is distinguishable from a real seed. |

**Key insight:** every defect here is a *silent* one (a flag nobody drains, a cursor nobody checks, a partial day nobody notices). The reusable machinery is the fail-loud kind: closed tokens, named exception classes, faithful fakes.

## Runtime State Inventory

Not a rename/refactor/migration phase. The one runtime-state item is data, not code, and is already decided outside the code:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | 20 active keys with a non-NULL `api_keys.last_fetched_trade_timestamp` (CONTEXT PROD reading: Bybit 5, MT5 10, OKX 5; 5 keys ahead of their newest stored fill). | Post-merge one-time repair proposed to the coordinator (set to the newest stored fill, or NULL). A direct `UPDATE`: the RPC cannot lower the column. Marker query first, counts before/after in the SUMMARY. |
| Live service config | None. | None. |
| OS-registered state | None. | None. |
| Secrets/env vars | `USE_RAW_TRADE_INGESTION` (read once at import: `os.environ.get("USE_RAW_TRADE_INGESTION", "false").lower() == "true"`, `services/job_worker.py:327`). PROD value is not readable from the repo. 231 says "Raw trade ingestion stays off until that lands". | Keep OFF until VREAD-08 ships; the ship note says so. |
| Build artifacts | None. | None. |

## VREAD-06: the non-USDT bill

### Today (verified)
`fetch_daily_pnl` OKX aggregation loop (`services/exchange.py`, `for bill in all_bills:`): after `if bill_type == _OKX_FUNDING_BILL_TYPE: ... continue` it computes `_pnl_raw = _finite_float(bill.get("pnl", 0), label="OKX bill pnl")`, `_fee_raw = ...`, then `pnl_val = _pnl_raw + _fee_raw`. `ccy` is never read. The daily row hard-codes `"fee_currency": "USDT"`. [VERIFIED: Read of `services/exchange.py` OKX branch]

### The check
- **Position:** after the type-8 `continue`, before `_finite_float`. Funding bills (type `8`) are dropped by the existing line and belong to `funding_fetch` (Phase 223); refusing on a BTC-margined funding bill would be an over-refusal. A test pins this order (a type-8 bill with `ccy="BTC"` does not refuse).
- **Missing/blank ccy:** `str(bill.get("ccy") or "")` before calling `is_stable_value` (it calls `.upper()`; `None` would raise `AttributeError`).
- **`is_stable_value` behaviour** [VERIFIED: ran against HEAD, and Read `services/price_rule.py` `is_stable_value`]: signature `def is_stable_value(asset: str) -> bool` returning `asset.upper() in _STABLE_VALUE` where `_STABLE_VALUE: Final[frozenset[str]] = STABLECOINS | STABLECOIN_SPLIT_SUFFIXES`. `STABLECOINS: frozenset[str] = frozenset({"USDT", "USDC", "DAI", "BUSD", "TUSD", "FDUSD", "USD"})`, `STABLECOIN_SPLIT_SUFFIXES: frozenset[str] = frozenset({"USDE", "PYUSD", "USDB"})` [VERIFIED: Read `services/closed_sets.py`]. Measured: `"USDT"` True, `"USDC"` True, `"usdt"` True, `""` False, `"USDG"` False, `"BTC"` False, `"DAI"` True. So blank refuses automatically, `USDG` (an OKX USD-margined settle coin, per OKXHISTORY RESEARCH section 1) refuses by name, and USDC/DAI count at 1.0 (the daily row's `fee_currency: "USDT"` label then names USDT for a USDC day; acceptable and unchanged).
- **Refuse the whole read:** stop the walk at the first window containing a non-stable bill, stamp `daily_pnl_non_usd_okx`, clear `daily_totals`, return `[]`. Log the ccy census at WARNING (counts per ccy code, each code accepted only if it matches `^[A-Za-z0-9]{1,16}$`, else `"malformed"`); do **not** put the code list in the DQ flag (the queued sync job merges every flag into the publicly readable `strategy_analytics.data_quality_flags`, and a venue string must not reach it).
- **Token name:** `daily_pnl_non_usd_okx` (CONTEXT's example). It matches neither the `daily_pnl_truncated_` nor the `daily_pnl_deadline_` prefix, so it must be registered explicitly.

### Where the token must be registered (every consumer of `daily_pnl_truncated_okx` and how it reacts)

| # | Consumer (symbol) | Reaction to `daily_pnl_truncated_okx` today | What the new token needs |
|---|-------------------|---------------------------------------------|---------------------------|
| 1 | `services/exchange.py::fetch_daily_pnl` | Stamps via `_record_dq_flag("daily_pnl_truncated_okx", True)` in both the live and archive loops. | Stamp `daily_pnl_non_usd_okx`; return `[]`. |
| 2 | `services/exchange.py::daily_pnl_read_verdict` | Names every flag with prefix `daily_pnl_truncated_` or `daily_pnl_deadline_` (`key.startswith(("daily_pnl_truncated_", "daily_pnl_deadline_"))`). | Add an explicit `if flags.get("daily_pnl_non_usd_okx"): reasons.append(...)`. |
| 3 | `services/job_worker.py::READ_INCOMPLETE_TOKENS` | In the set; `_record_read_incomplete` returns False ("token outside the set") for any other token, so the key would be refused **unnamed**. | Add it. `tests/test_derive_broker_dailies_dualmode.py:2584` pins `READ_INCOMPLETE_TOKENS == frozenset({...})` by equality: update it. |
| 4 | `services/job_worker.py::_DAILY_PNL_REFUSAL_ORDER` | In the tuple; the derive names `next((t for t in _DAILY_PNL_REFUSAL_ORDER if t in _refusal_tokens), _refusal_tokens[0])`. | Insert right after `"daily_pnl_truncated_okx"` (both permanent; the existing order stays stable). |
| 5 | `services/job_worker.py::_TRANSIENT_REFUSAL_TOKENS` | **Not** in it (`{"daily_pnl_fetch_error", "read_deadline"}`), so a truncation is permanent. | **Do not add** (permanent class, per CONTEXT). A test pins `permanent=True` on the first attempt. |
| 6 | `routers/cron.py::_fetch_degradation` | Prefix `_FETCH_TRUNCATED_PREFIX = "daily_pnl_truncated_"` only. **An empty list plus an unnamed token reads as an idle tick** (`not trades`) and advances the cursor. | Name the token explicitly (a module constant beside `_FETCH_INCOME_FALLBACK_FLAG`). Add to `tests/test_cron_router.py::TestATruncatedWindowIsNeverTreatedAsComplete.FLAGS`. |
| 7 | `tests/test_daily_pnl_read_verdict.py` parity matrix | `verdict.reasons == sorted(cron_reasons + derive-only deadline flags)`. | Both readers must name the token identically; add it as a new flag dimension (the documented size `480` becomes `960`). |
| 8 | `services/okx_archive_job.py::_check_live_realized_flags` (**Phase 223's file, not edited**) | Matches exactly `daily_pnl_fetch_error` and `daily_pnl_truncated_okx`; ignores every other flag. | **Hand-off.** It will not refuse on the new token (nor on `daily_pnl_deadline_okx`; it passes no deadline so the latter is moot). With `[]` + token it proceeds with an empty live realized series. Ask 223 for: `if flags.get("daily_pnl_non_usd_okx"): raise _Stop("live_anchor_unusable", "live_realized=non_usd")`. The parity test only compares this reader's `rate_limited`, so nothing forces it; it must be raised explicitly. |

Callers that never read the buffer (consequence of returning `[]`): `/fetch-trades` stores nothing and advances `last_sync_at` (not a resume point since 167.1.2.2.2); `verify_strategy` answers 400 "Insufficient trade history" (misleading text, fail-closed); the queued sync job stores nothing and merges the token into `data_quality_flags` (a closed constant, safe); the composite member read (`services/job_worker.py`, inside the `run_stitch_composite_job` region) raises `_CcxtMemberDegrade("realized_stream_unavailable")` only when funding is non-empty, otherwise reads flat. That last residual is routed (it never drains flags); not in this phase's fence.

### Fixtures without `ccy` (the count)
[VERIFIED: grep of every OKX bill dict that reaches the real `fetch_daily_pnl` aggregator] **2 tests, 5 bill dicts**, both in `tests/test_exchange.py`: `TestFetchDailyPnlOkxFailLoud::test_okx_bill_dropped_on_non_digit_ts_logs_warning` (B1, B2, B3: `{"ts": ..., "pnl": ..., "fee": ..., "billId": ..., "billType": "8"}`, none has `ccy`; they carry `billType`, not `type`, so none is dropped as funding) and `TestClusterIOkxFundingBillFilter::test_okx_funding_bills_excluded_from_daily_pnl` (two bills; the type-8 one is dropped before the ccy check, the `bill-trade` one needs `ccy`). Everything else carries `ccy`: the harness `_okx_bill` helper (`"ccy": "USDT"`), `tests/_okx_bills.py::okx_bill` (always sets `ccy`), `tests/test_derivegaps_probe.py` builders (`"ccy": "USDT"`); the cron/derive/job tests mock `fetch_all_trades` and feed no bills.

## VREAD-07: the long first window

### Did OKXHISTORY close it? **No.** (re-measured at HEAD)
- `167.1.2.2.2.1-RESEARCH.md` section 11 recommends "do not fix truncation in this phase" and keeps the entry open; plan 10 SUMMARY frontmatter: "dated measurement on OKX-PERSISTENT-TRUNCATION (trigger narrowed, open)". `TODOS.md` `[167.1.2.2.2-OKX-PERSISTENT-TRUNCATION]` carries "measured, not fixed, stays open" (2026-10-15) and the Phase 232 owner tag (2026-11-23). [VERIFIED: Read of both]
- At HEAD `services/exchange.py` has `OKX_BILLS_PAGE_CAP: int = 100` and `OKX_ARCHIVE_PAGE_CAP: int = 100`, and `fetch_daily_pnl` still runs `for page in range(OKX_BILLS_PAGE_CAP):` inside `for inst_type in [...]` with `params["begin"] = str(since_ms)` and **no `end`**. `git log` for the file shows no commit after 231's (Bybit) touching the OKX branch. So the cap is **per (endpoint, instType) for the whole range** today; the change is to make it per window.

### Venue facts used (and their confidence)
| Fact | Tag |
|------|-----|
| `/account/bills`: "can retrieve data from the last 7 days", sorted most recent first; `/account/bills-archive`: "last 3 months", most recent first; `after` = records earlier than the bill id, `before` = newer; `begin`/`end` "Filter with a begin timestamp `ts`"; `limit` max 100 | `[CITED: okx.com/docs-v5/en Get bills details (last 7 days / last 3 months), as quoted in 179-RESEARCH.md and 167.1.2.2.2-RESEARCH.md; re-fetched this session via WebFetch, which returned a paraphrase, not a verbatim quote]` |
| Archive rate limit "5 requests per 2 seconds" | `[CITED: 179-RESEARCH.md]` |
| `begin`/`end` inclusive on `ts` | `[ASSUMED]` (RESEARCH A4, `tests/_okx_bills.py`) |
| Reply order **under `begin`** is newest-first | `[ASSUMED]`; in-repo evidence points the other way: `walk_okx_bills_archive` sends no `begin` because "its reply order is not guaranteed", and `BelowStop.complete` notes "a `begin`-bounded reply may be oldest first". Phases 172/179 recorded this as a **design caution, not a measurement** (172 REVIEW: "no longer depends on reply order"). The live walk has sent `begin` daily since TRADESYNC with plausible results, which is circumstantial only. |
| What `/account/bills` returns for a window wholly older than 7 days | `[ASSUMED]` empty (docs bound it at 7 days); not measured in-repo. |
| A computed `begin` for `since_ms=None` does not cut the reach shorter than today's no-`begin` request | `[ASSUMED]`; mitigated by starting at `floor_day(now - 93d)` (a calendar three months is 89..92 days per the comment above `LIVE_REACH_ASSUMED_DAYS` in `services/okx_archive_job.py`: "a calendar three months is 89..92 days and ``exchange.fetch_daily_pnl`` itself approximates it as 90"). A start older than the venue's real reach only returns an emptier first window. |

### Latent defect the windowed design also removes (flag it, do not overstate it)
Today `should_fetch_archive = since_ms is None or since_ms < three_months_ago_ms`: for a `since_ms` 8 to 89 days old only `/bills` is read, and the docs bound `/bills` at 7 days. So a stale high-water between 8 and 89 days old would read only the newest 7 days. TRADESYNC's recoverability table treated 51.6 days as "bills-archive 3 months: recoverable" while this gate skips the archive for it. Not measured on PROD here (no PROD access in this phase). Age-routing each window (below) makes it correct under either venue behaviour (the archive covers 3 months by the docs; if `/bills` really reached 3 months the archive would too). It flips `test_90_day_gate_skips_archive`. (Ruling Q6.)

### Design
**Constants (module level, test-lowerable like the caps):** `OKX_BILLS_WINDOW_DAYS = 7`, `OKX_BILLS_REACH_DAYS = 93`, `OKX_LIVE_BILLS_DAYS = 7` (docs). `OKX_BILLS_PAGE_CAP` and `OKX_ARCHIVE_PAGE_CAP` stay 100 (pin both).

**Window sizing (measured density + request floor).**
- Density: OKXHISTORY's archive census ingested **1606 bills for the in-scope account** over two quarterly files (about 180 days, so ~9 bills/day, all instTypes); the heaviest stored account holds "a few thousand fills over several months" (about 10 to 50 a day) [CITED: TODOS `[167.1.2.2.2-OKX-PERSISTENT-TRUNCATION]`, `[167.1.2.2.2.1-OKX-DAILY-PNL-MIXED-CCY]`]. A 7-day window at the unchanged cap holds up to 100 pages x 100 = 10,000 bills per (instType, endpoint) = 1,428/day: **at least 28x** the heaviest measured day. A 14-day window would still hold 714/day (14x) and halve the request floor; 7 days matches the Bybit precedent (`BYBIT_PNL_WINDOW_MS`, 7-day windows). Recommendation: **7**.
- Request floor (minimum requests = windows x 4 instTypes x endpoints, one page each): a daily cron tick (`since_ms` about 1 day old) = 1 window x 4 = **4 requests** (equal to today). A first window or the derive (`since_ms=None`, reach 93 days = 14 windows; ~13 archive-routed + 1 to 2 live-routed incl. one straddle) = **about 60 requests**; at the archive's documented 2.5 requests/second that is a **24 s floor** before latency. Against the cron's `KEY_SYNC_TIMEOUT = 60` that does not reliably fit alongside balance, store and marker work, which is exactly why the cron needs a deadline and the prefix path; against the derive's `DAILY_PNL_READ_DEADLINE_S: float = 397.0` it fits (about 24 to 60 s a day per OKX key, up from ~8 requests today: state this cost in the SUMMARY).

**Per-window read.** For window `[a, b)`: `live_floor = floor_day(now) - 6 days` (so the live endpoint is only trusted for ts at or after `now - 7d` by construction). Read `/bills` if `b > live_floor`; read `/bills-archive` if `a < live_floor`; both for a straddling window, union by `billId`. Keep the literal `for inst_type in ["SWAP", "FUTURES", "SPOT", "MARGIN"]` loop **inside `fetch_daily_pnl`**: `tests/test_okx_archive_parse.py::TestLiveInstTypePin` AST-reads `fetch_daily_pnl` for a `For` whose target is `inst_type` over a list literal and fails "the pin would be vacuous" if none is found. Page loop per (window, instType, endpoint): `params = {"instType": ..., "limit": "100", "begin": str(a - 1), "end": str(b)}` plus `after`; stop on an empty page or a page shorter than 100; a full page on the last allowed page sets the cap-hit (the accepted over-refusal `test_history_that_is_an_exact_multiple_at_the_cap_still_reports_truncated` stays true per window). Self-checks per page (rows with a **numeric** `billId` only): ts within `[a - 1, b]`; `billId` strictly descending and the next cursor below the previous. Violation: raise a typed exception whose class name flows through the existing outer handler into `daily_pnl_fetch_error_class` (refused by every reader, retried as transient).

**Stops.** Deadline (`read_deadline_s`, checked before **every** request): drop the in-progress window, stamp `daily_pnl_deadline_okx`, stop. Cap breach: drop the window, stamp `daily_pnl_truncated_okx`, **stop** (later windows would make the prefix non-contiguous). Exceptions: unchanged (propagate to the outer handler: `daily_pnl_fetch_error`, rows `[]`; an exception mid-walk does not return the prefix: fetch errors keep meaning "nothing").

**Aggregation:** unchanged (drop type `8`, then ccy, then `_finite_float` pnl+fee, group by UTC day), run over the completed windows' bills only.

### Marker and caller wiring (the minimal change)

**Marker = the existing `daily_pnl_deadline_okx` flag, with a tightened contract: "the rows returned are the whole UTC days of the windows read before the deadline, a contiguous oldest prefix".** Why reuse (Q2): the derive's `daily_pnl_read_verdict` already names it (reason `daily_pnl_deadline_okx` -> token `read_deadline`, transient, permanent from the second attempt), so the one caller that **cannot** store a prefix keeps refusing with zero edits, the 480-case parity matrix is unchanged (`_DERIVE_ONLY_FLAGS` already lists it), and `READ_INCOMPLETE_TOKENS` is untouched. A fresh name would be read as "complete" by the derive until registered. Bybit's `daily_pnl_deadline_bybit` is a partial window (its cap-hit windows continue), not a prefix: the cron must act on the **OKX** flag only and pass the deadline for OKX only.

**Caller table (verified by reading each call site):**

| Caller (symbol) | `since_ms` | Deadline passed | Reads flags | Stores under a flag | Next tick resumes from |
|-----------------|-----------|-----------------|-------------|---------------------|------------------------|
| `routers/cron.py::_sync_single_key` | `_floor_to_utc_day_ms(_resume_floor_ms(...))` (marker-less: stored daily high-water; marker present: the marker, clamped to `MAX_MARKER_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000`) | none today (only the 60 s `wait_for` cancel -> status `timeout`, nothing stored) | `_fetch_degradation` (error, income fallback, `daily_pnl_truncated_*`) | no: degraded stores nothing, holds `last_sync_at` and markers, status `error` | stored daily high-water, **only for a marker-less strategy**; a present marker dominates (`_strategy_resume_point`) |
| `services/job_worker.py::run_sync_trades_job` | `daily_since_ms = parse_since_ms(stored daily high-water)` | none | drains into `exchange_dq_flags` (merged into `data_quality_flags` only inside the phase-2 flag block) | **yes, unconditionally**: `if trades:` -> `sync_trades` RPC regardless of any flag | stored daily high-water (always) |
| `run_derive_broker_dailies_job` | `None` every run | `DAILY_PNL_READ_DEADLINE_S` (397 s) | `daily_pnl_read_verdict` | n/a: refuses before any write | n/a (reads from inception each day) |
| `services/okx_archive_job.py::_live_reference` (223) | `None` | none | `_check_live_realized_flags`: error + `daily_pnl_truncated_okx` only | n/a | n/a |
| `routers/exchange.py::fetch_trades` | stored high-water seed (+ clamp probe) | none | never | yes, always; advances `last_sync_at` always | stored daily high-water |
| `routers/portfolio.py::verify_strategy`, composite member read (`run_stitch_composite_job` region) | `None` | none | never | n/a | n/a |

Consequences to record: (a) the queued sync job already stores whatever a truncated read returns, i.e. today the **newest** part, which creates a permanent hole behind it; under the new walk a cap breach returns the **oldest prefix**, so that unchanged store becomes hole-free. Its Phase 1 store is outside this phase's fence; record it and route the remaining flag-merge/never-cleared behaviour to 222. (b) The cron is the only caller that can usefully pass a deadline.

**Cron change (Plan B), the four gates plus the call:**
1. Call: `fetch_all_trades(exchange, since_ms=since_ms, read_deadline_s=OKX_CRON_READ_DEADLINE_S if exchange_name == "okx" else None)`. Value `[ASSUMED]` about 35 s of the 60 s `KEY_SYNC_TIMEOUT` (leaves 25 s for the balance read, per-strategy RPCs and marker writes); tune against the 24 s request floor. Existing tests read `fetch_mock.call_args.kwargs["since_ms"]`, so an extra kwarg does not break them.
2. New `_fetch_prefix_only(flags) -> bool` = `bool(flags.get("daily_pnl_deadline_okx"))` and **not degraded**. A prefix is not degraded: the existing storing gate `if trades and strategy_ids and not fetch_degraded` stays as is.
3. `should_advance_cursor = (((not trades) or synced_count > 0) and not fetch_degraded and not fetch_prefix_only)`. This also stops an **empty** prefix (deadline before the first window completed) from reading as an idle tick.
4. `strategy_advances = (not fetch_degraded) and (not fetch_prefix_only) and (...)`. A prefix tick therefore writes no `marker_now`, no `trades_fetched_at` stamp (`advancing_strategy_ids`), and holds present markers at their pre-tick value.
5. `recompute_strategy_ids = [] if (fetch_degraded or fetch_prefix_only)`.
6. Status falls out of the existing classifier with no new `SyncStatus`: not degraded, no errors, `not should_advance_cursor` -> **`held`**. `held` is in `_NON_OK_STATUSES`, so a self-resolving first-window tick shows once or twice in the heartbeat as non-OK. That is the honest, un-silent choice: an `ok` status over a perpetually held key would hide a stall. Add `result["fetch_partial_prefix"] = True` so an alarm can tell a self-resolving hold from a stuck one. (Open Question 3 covers the marker-present case.)

**Does the next tick really resume?** Marker-less strategy (the first-window case SC-2 is about): yes, from the stored `is_fill = false` high-water (`load_strategy_high_waters`), floored to the UTC day; the last stored day is re-read whole (idempotent: `sync_trades` deletes the payload's day span then inserts). Marker-present strategy: **no**, it re-reads from its marker, which is at most 30 days old (the clamp), i.e. at most 5 windows x 4 = 20 requests, so only a key whose 30 days exceed the deadline can stall, and it stalls loudly (`held` every tick). Writing the marker at the prefix end would close that (`max(pre-tick marker, prefix_end_day)`; a **null** marker must stay null and a marker-less strategy must get **no** row, because of the 30-day clamp), but it widens the cron change; recommended as a follow-on only if the stall is ever observed.

### Tests that flip or rot (VREAD-07)
In `tests/test_exchange_harness.py`: `TestOKXFetchDailyPnl::test_since_ms_passed_to_recent_and_archive` (asserts `params["begin"] == str(since_ms)`), `test_90_day_gate_skips_archive` (archive no longer gated by 90 days), `test_pagination` (page 1 is numeric ascending ids `"0".."99"`: trips the descending check), and every canned-page test whose bills carry a fixed 2024 `ts` (with the window clip they would be dropped or refuse: re-date to window-relative times; ~20 tests, mechanical); `TestPageCapsStampTheTruncationFlag::test_okx_deadline_ends_the_walk_with_its_own_deadline_flag` and `test_okx_archive_deadline_ends_the_walk_with_its_own_deadline_flag` (`assert rows`: now whole windows only), `test_okx_archive_that_ends_on_a_short_page_is_not_truncated` (`calls["n"] == 100`: the stub is not window-aware). The cap-flag tests (`counter["n"] == 100`, `== 3`, `== 2`) keep passing because the first window caps. **Calendar rot:** `tests/test_walletoffset_probe.py::test_okx_parity_with_fetch_daily_pnl_and_fetch_funding_okx` uses `_B_MS` = 2026-10-27 with an `OkxBillsArchive` that honours `begin` and `since_ms=None`: it goes RED when the reach start passes that date, about **2027-01-28**; make the fixture time relative to now. `tests/test_okx_archive_parse.py::TestLiveInstTypePin` stays green only if the literal list loop remains in `fetch_daily_pnl`. `tests/test_cron_router.py::test_the_venue_set_is_exactly_the_branches_fetch_daily_pnl_has` regex-reads `exchange.id == "..."` branches: keep the branch literal.

## VREAD-08: the fills cursor

### Facts (verified by Read)
- **Reader (only one):** in `run_sync_trades_job` Phase 2: `fills_since_ms = parse_since_ms(None, preferred=ctx.key_row.get("last_fetched_trade_timestamp"))`, then `if fills_since_ms is None: fills_since_ms = daily_since_ms`. `parse_since_ms(last_sync_at, preferred)` returns epoch ms of `preferred` when non-null, `None` for a falsy or unparsable value (it logs a warning on the latter).
- **Writer (only one):** the epilogue: `advance_fetched_cursor = (not raw_fills) or (phase2_complete and not phase1_failed)` then `_p_last_fetched = _now_iso if advance_fetched_cursor else None`, passed as `p_last_fetched_ts` to `advance_sync_cursor`. [VERIFIED: grep for `last_fetched_trade_timestamp` across Python/TS found no other writer; the reader/writer are the only two code sites]
- **RPC guard** [VERIFIED: Read of `supabase/migrations/20260602173710_advance_sync_cursor_claim_token_fence.sql`; it is the only definition, `FUNCTION.*advance_sync_cursor` appears in no later migration]: `last_fetched_trade_timestamp = CASE WHEN p_last_fetched_ts IS NOT NULL AND (last_fetched_trade_timestamp IS NULL OR last_fetched_trade_timestamp < p_last_fetched_ts) THEN p_last_fetched_ts ELSE last_fetched_trade_timestamp END`. A NULL param leaves the column; an older value is a no-op. So the new stamp can never lower an ahead column; only a direct `UPDATE` repairs one.
- **Fill persistence:** `ctx.supabase.table("trades").upsert([...], on_conflict="strategy_id,exchange,exchange_fill_id", ignore_duplicates=True).execute()` in batches of 100; the response is never read. It reports **no inserted count**: `phase2_persisted += len(batch)` counts rows attempted. So "persisted" means "every batch's upsert returned without raising" (`phase2_complete = True`), and every fill in `raw_fills` is then present in `trades` (inserted now or already there). The fill timestamp field is `"timestamp": timestamp` in `_make_fill_dict` (ISO string; OKX passes `ts_dt.isoformat()`), which is the `trades.timestamp` column. Therefore `max(parsed fill timestamp)` over `raw_fills` is never ahead of the newest stored fill.
- **Existing stored fills high-water helper:** none. `services/trade_resume.py::load_strategy_high_waters` filters `.eq("is_fill", False)` and floors to the UTC day via `high_water_floor_iso`. No migration needed: `idx_trades_strategy_timestamp ON trades (strategy_id, timestamp)` (initial schema) serves a newest-first `limit(1)` read; a strategy with no fill scans its few hundred daily rows.
- **Reconcile:** `run_reconcile_strategy_job` reads a fixed 24 h window (`since = now - timedelta(hours=24)`; `parse_since_ms(None, preferred=since_iso)`), calls `fetch_raw_trades` and never calls `advance_sync_cursor` or touches the column. Not a writer, no edit.

### Design (Plan C, two spans of `run_sync_trades_job` and one helper)
1. **Helper** `load_strategy_fill_high_water(supabase, strategy_id) -> tuple[str | None, str | None]` in `services/trade_resume.py`, same fail-open contract and error string as `load_strategy_high_waters`, but `.eq("is_fill", True)`, `.order("timestamp", desc=True)`, `.limit(1)` and the **exact** timestamp (no day floor: the fills seed is unfloored per LASTSYNC-SEED decision 4). Read via `db_execute`.
2. **Seed (lazy):** only when the column parses to a value, read the fills high-water. `fills_since_ms = min(column_ms, fill_hw_ms)` if a fill exists; **if no stored fill, ignore the column and use `daily_since_ms`** (decision text); **if the read fails, also ignore the column** (never trust it when it cannot be clamped) and use `daily_since_ms`. **If the column is NULL (or unparsable), keep today's behaviour: `daily_since_ms`**, and do **not** use the fills high-water: `tests/test_sync_trades_resume_seed.py::test_fresh_last_sync_at_and_no_fills_cursor_reach_back_to_stored_day` pins a NULL column to the daily day with a *newer* stored fill present (the CONTEXT text is silent on this case). Laziness also means bare-`MagicMock` Supabase fakes in the ingestion-on tests (all with a NULL/absent column) never reach the new read.
3. **Stamp:** `_p_last_fetched` = ISO of `max(coerce_to_aware_utc(f["timestamp"], "sync_trades") for f in raw_fills)` only when `raw_fills and phase2_complete and not phase2_failed and not phase1_failed` and no `sync_truncated_*` flag is true in `exchange_dq_flags` (Q7); otherwise `None`. An unparsable timestamp (`ValueError`) holds the cursor. A run with no fills (including a clean empty read and every `USE_RAW_TRADE_INGESTION`-off run and the MT5 arm) leaves the column untouched, as decided. Keep the `_p_last_fetched is None and _p_last_sync is None and account_balance is None` skip log accurate (its message names `advance_fetched_cursor`).
4. **Ordering invariant to test:** `advance_fetched_cursor` must be False when `fetch_raw_trades` raised (`phase2_failed`), which is what 231's `dependency-232` asks (the raised-fetch path leaves `raw_fills == []`, which the old `not raw_fills` disjunct turned into an advance).

### Consequences to record without reopening the decision
- **A quiet key's fills window grows every run.** The column no longer stamps "now", so a strategy with no new fills seeds from its last fill each day (OKX: bounded by the venue's fills reach; Bybit: `BYBIT_EXECUTION_HISTORY_DAYS = 730`, a start older than that is refused before any request by `BybitTradeWindowIncomplete`, so a Bybit key whose last fill is older than two years would refuse its fills read every run). Accepted by the decision; record it in the SUMMARY.
- **PROD effect today:** ingestion is believed OFF, so nothing reads the column; the clamp makes the 5 ahead keys harmless on turn-on, and the post-merge repair (coordinator) cleans the data.
- **MT5/flag-off keys keep their stale `now` stamps** until the repair; harmless (no Phase 2 reads them).

### Tests that flip (VREAD-08)
- `tests/test_job_worker.py::TestAdvanceSyncCursorFence::test_threads_claim_token_when_fence_on`: `assert params["p_last_fetched_ts"] is not None` (ingestion off, one daily trade) flips to `is None`.
- `tests/test_ana_recon_audit.py::test_redteam_c1_phase1_failed_blocks_fetched_cursor_advance`: it **re-evaluates the formula inline** (`advance_fetched_cursor = (not raw_fills) or (phase2_complete and not phase1_failed)` typed into the test), so it never touches production code and cannot go RED. Replace it with a test that drives `run_sync_trades_job` (Rule 9).
- `tests/test_sync_trades_resume_seed.py` module docstring and `test_fresh_last_sync_at_and_no_fills_cursor...` assert `all(("is_fill", False) in q["eq"] for q in rec.trades_queries)`; with the lazy read a NULL-column case issues no fills query so it still holds, but the case with a column set (`test_fills_cursor_governs_the_fills_read_only`) now issues one `is_fill=True` query: keep its assertions about `since_ms`, add the new query to the recorder checks.
- Unchanged and still green: the G12.A.7 `TestSyncTradesPhase2PartialBatchFailure` (`p_last_fetched_ts is None`), `tests/test_compute_jobs_fencing.py` (live-DB RPC arms), `tests/test_mt5_sync_path.py` (asserts `p_last_sync_at`, not the fetched param).

## Common Pitfalls

### Pitfall 1: the flag is the only stop, so the sum still happens
**What goes wrong:** stamping the token while still returning the summed rows lets every flag-blind caller store a mixed series.
**How to avoid:** return `[]` on the refusal; test the return value and the flag together.

### Pitfall 2: a prefix tick read as an idle or complete tick
**What goes wrong:** the cron advances `last_sync_at`, the per-strategy marker (`marker_now`) and `trades_fetched_at`, so the next tick resumes from "now" and the unread suffix is lost for good; an **empty** prefix (`not trades`) is read as idle.
**How to avoid:** the four cron gates above; tests assert the RPC stored the prefix **and** the cursor/marker/stamp/enqueue did not move.
**Warning signs:** `held` every tick with `fetch_partial_prefix` and no new stored days.

### Pitfall 3: venue order or bounds differ from the assumption
**What goes wrong:** a `begin`-bounded reply served oldest-first makes `after=<last billId>` re-serve earlier rows, a short page ends the window silently and the tail is missing (reproduced by reasoning with `OkxBillsArchive(oldest_first_with_begin=True)`: page 1 = the 100 smallest ids, `after=largest` returns 99 rows < 100 -> "window complete").
**How to avoid:** the self-checks (numeric `billId` descending, ts inside the window) and a negative test with `oldest_first_with_begin=True` that must end in a named refusal, never a short read. `[ASSUMED]` until a probe measures the venue; a read-only probe is not available to this research (no PROD/venue access).

### Pitfall 4: tests that cannot fail
**What goes wrong:** the inline-formula test above; canned-page mocks that serve the same bills to every window (dedup hides a missing window); flags asserted on a patched buffer instead of the real walk.
**How to avoid:** drive the real functions with `OkxBillsArchive`; assert on sums per day and on request params.

### Pitfall 5: the bootstrap self-heal gap (VREAD-08, Open Question 1)
See the Open Questions.

### Pitfall 6: `daily_pnl_*` flags persist forever in public `data_quality_flags`
The queued job merges drained flags into `strategy_analytics.data_quality_flags` and only pops the `phase2_*` keys on recovery, so `daily_pnl_truncated_okx` / `daily_pnl_non_usd_okx` once set are never cleared by a clean run. Pre-existing for the truncated flag; not fixable inside the phase-232 fence; route to 222.

## Code Examples

### Window generator and clip (shape, not final)
```python
# Source: this research; mirrors routers/cron.py::_floor_to_utc_day_ms and Bybit's 7-day window walk
_MS_PER_UTC_DAY = 86_400_000

def _okx_windows(start_ms: int, now_ms: int, days: int) -> Iterator[tuple[int, int]]:
    """Yield [start, next_start) windows on the UTC-day grid; the last ends at now_ms."""
    step = days * _MS_PER_UTC_DAY
    a = start_ms - start_ms % _MS_PER_UTC_DAY
    while a < now_ms:
        yield a, min(a + step, now_ms)
        a += step
```
Request params per page: `{"instType": it, "limit": "100", "begin": str(a - 1), "end": str(b)}` (+ `after`); keep rows with `a <= ts < b`; drop rows at `a - 1` and `b`; any other ts -> raise.

### ccy check (after the type-8 drop)
```python
# Source: this research; services/price_rule.is_stable_value signature verified
ccy = str(bill.get("ccy") or "")
if not is_stable_value(ccy):
    _record_dq_flag("daily_pnl_non_usd_okx", True)
    return []          # whole read refused; nothing summed
```

### Cron prefix gates (names are suggestions)
```python
fetch_prefix_only = bool(fetch_dq_flags.get("daily_pnl_deadline_okx")) and not fetch_degraded
should_advance_cursor = (((not trades) or synced_count > 0) and not fetch_degraded and not fetch_prefix_only)
strategy_advances = (not fetch_degraded) and (not fetch_prefix_only) and (...)
```

### Fills seed and stamp
```python
# Source: this research
col_ms = parse_since_ms(None, preferred=ctx.key_row.get("last_fetched_trade_timestamp"))
fills_since_ms = daily_since_ms
if col_ms is not None:
    hw_iso, _hw_err = await db_execute(lambda: load_strategy_fill_high_water(ctx.supabase, strategy_id))
    if hw_iso is not None:
        fills_since_ms = min(col_ms, parse_since_ms(hw_iso))
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| One page loop per instType over the whole range, `begin` only | Window-major, per-window cap, `begin`+`end` | Phase 232 | Persistent truncation removed without touching the cap |
| Cursor stamped to wall-clock now on any empty/raised/disabled read | Stored-through mark or untouched | Phase 232 | Column can no longer read ahead of stored data |
| Archive read only when `since_ms` is older than 90 days | Endpoint routed per window by age | Phase 232 (ruling Q6) | 8-to-89-day gaps read through the archive |

**Deprecated/outdated:** the CONTEXT/TODOS phrase "the cap is 10k bills per inst type over ~157 days" (it is per endpoint per instType per whole range; the venue reach is 7 days live and 3 months archive).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OKX `begin`/`end` are inclusive on `ts` | VREAD-07 | Off by one ms at a window edge; overlap + clip makes it exact either way. |
| A2 | A `begin`-bounded reply is newest-first (venue order) | VREAD-07 | Silent short reads without the self-check; the check turns it into a named refusal. |
| A3 | `/account/bills` returns nothing useful for a window older than 7 days; `/bills-archive` covers 3 months including near-now days | VREAD-07 | Age-routing is weakly dominant either way; wrong routing costs requests, not data. |
| A4 | Starting the `since_ms=None` walk at `floor_day(now - 93d)` does not shorten the reach vs today's no-`begin` request | VREAD-07 | The derive's first day could move; 93 days exceeds the longest calendar three months (92). |
| A5 | `OKX_CRON_READ_DEADLINE_S` about 35 s fits inside `KEY_SYNC_TIMEOUT = 60` | VREAD-07 | Too high: the 60 s cancel still bites; too low: more ticks. Tune at plan time. |
| A6 | PROD has `USE_RAW_TRADE_INGESTION` off | VREAD-08 | If on, the 5 ahead keys re-read now (harmless with the clamp). |
| A7 | A local ccxt 4.5.85 vs CI 4.5.89 skew does not change the OKX implicit method names the mocks use | Stack | A CI-only failure on first push. |
| A8 | Real OKX SPOT bills carry the base coin as `ccy` with zero pnl/fee on one leg (the decision's refusal would then refuse a spot-trading key permanently) | VREAD-06 / Q3 | If wrong the over-refusal does not exist; if right, ccy-only refuses all spot-trading keys. |
| A9 | The 7-day window's request floor (about 60 requests, 24 s at 2.5 rps) | VREAD-07 | Only affects the deadline value. |

## Open Questions

1. **VREAD-08 bootstrap: "the next clean run covers the refused span" is false when the column is NULL and no fill is stored.**
   - What we know: the seed then falls to `daily_since_ms`, the newest stored `is_fill = false` day, which advances every day regardless of fills. After N refusal days a clean run seeds N days later, reads clean, and the existing self-heal pops `phase2_fill_ingestion_failed`: 231's gap 1, only at bootstrap. Once any fill has been stored (column non-NULL), the held column anchors the re-read and the decision holds.
   - What's unclear: whether the founder accepts it while ingestion is OFF.
   - Recommendation: record `phase2_failed_since_ms` (the failing run's seed) in the same flag write as `phase2_failed_at`, keep the first value of a streak, seed from `min(computed seed, phase2_failed_since_ms)` while the flag is set, and pop it with the other `phase2_*` keys. It adds one JSONB key and one read of the existing flags before the fills read; if that is outside the fence, accept and document, and pin the sequence test for the column-non-NULL case only.
2. **Marker reuse (Q2).** Confirm `daily_pnl_deadline_okx` as the prefix marker.
3. **Marker-present strategies can stall (Q: follow-on).** Present markers dominate the resume point, so a marker-present key whose at-most-30-day window exceeds the deadline re-reads the same prefix every tick (loud: `held` + `fetch_partial_prefix`). Fix is `max(marker, prefix_end)` writes; not needed for the first-window case.
4. **The Phase 223 hand-off line** for `_check_live_realized_flags` (table row 8).
5. **Gap 3 and the Phase-1 store under flags** route to 222 ALERTTRUTH by name (also: `run_sync_trades_job` stores truncated windows today; the flag merge is never cleared).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python 3.12 + deps | all tests | yes, in the **main checkout's** `analytics-service/.venv` (the worktree has none) | 3.12.13, pytest 9.1.1, mypy 2.4.0, ccxt 4.5.85 | run that interpreter with cwd = the worktree's `analytics-service/` |
| ccxt at CI's pin | CI parity | no (local 4.5.85 vs CI 4.5.89) | - | CI is the check |
| Supabase local stack | `supabase/tests` SQL corpus only | not needed (no SQL change) | - | - |
| PROD/venue access | live OKX probe | not available to this research | - | the order/bounds assumptions are guarded by the self-check instead |

**Missing dependencies with no fallback:** none. **With fallback:** worktree venv (use the main checkout's interpreter).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest `<9.2` (9.1.1 local) + pytest-asyncio (`asyncio_mode = auto`) |
| Config file | `analytics-service/pytest.ini` (`testpaths = tests`, `pythonpath = .`) |
| Quick run command | `cd analytics-service && python -m pytest tests/test_exchange_harness.py tests/test_daily_pnl_read_verdict.py tests/test_sync_trades_resume_seed.py -q` (542 passed, 15.6 s at HEAD) |
| Affected-set command | `cd analytics-service && python -m pytest tests/test_exchange.py tests/test_cron_router.py tests/test_job_worker.py tests/test_derive_broker_dailies_dualmode.py tests/test_okx_archive_apply.py tests/test_okx_archive_parse.py tests/test_walletoffset_probe.py tests/test_derivegaps_probe.py tests/test_ana_recon_audit.py tests/test_mt5_sync_path.py tests/test_writer_residual_parity.py tests/test_derive_allocator_equity_job.py tests/test_job_worker_flipretry.py -q` (1328 passed, 1 skipped, 61.9 s at HEAD, without `test_okx_archive_parse.py`) |
| Full suite (CI) | `cd analytics-service && pytest -n auto --dist loadgroup --cov=services --cov=routers --cov=main_worker --cov-report=term-missing --cov-fail-under=80` (CI runs it against a local-stack lane; the new tests are pure-mock) |
| Type gate (CI) | `cd analytics-service && mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py` (`ci.yml` step "Type gate - mypy strict over the running-service surface"; the Makefile `typecheck` recipe is the same path set with `--config-file=pyproject.toml`; HEAD baseline: no issues in 142 files) |

### Phase Requirements -> Test Map (new test files: `tests/test_okxtrades_ccy.py`, `tests/test_okxtrades_walk.py`, `tests/test_okxtrades_cursor.py`, plus edits to the flip list above)

| Req | Behavior (named arm) | Test type | Automated command | File exists? |
|-----|----------------------|-----------|-------------------|--------------|
| VREAD-06 | `okx-mixed-ccy-day-refused`: a day with USDT + BTC bills returns `[]`, flag `daily_pnl_non_usd_okx`, no face-value sum (RED on HEAD: one row summing both) | unit (real `fetch_daily_pnl`, `OkxBillsArchive`) | `pytest tests/test_okxtrades_ccy.py -q` | no, Wave 0 |
| VREAD-06 | `okx-blank-ccy-refused`, `okx-stable-ccy-counted-at-1` (USDC, DAI), `okx-funding-bill-in-btc-not-refused` (type 8 first), `okx-usdg-refused` | unit | same | no, Wave 0 |
| VREAD-06 | `non-usd-token-registered-everywhere`: verdict names it, cron `_fetch_degradation` names it identically, in `READ_INCOMPLETE_TOKENS` and `_DAILY_PNL_REFUSAL_ORDER`, absent from `_TRANSIENT_REFUSAL_TOKENS`; derive refuses permanently on the first attempt with the token in the marker | unit + derive harness | `pytest tests/test_daily_pnl_read_verdict.py tests/test_derive_broker_dailies_dualmode.py tests/test_cron_router.py -q -k "non_usd or Truncated"` | partial (edit) |
| VREAD-07 | `long-first-window-completes`: more bills per instType than `cap x 100` over the range but each 7-day window within the cap -> no `daily_pnl_truncated_okx`, per-day sums exact, `OKX_BILLS_PAGE_CAP == 100` and `OKX_ARCHIVE_PAGE_CAP == 100` pinned (RED on HEAD: truncated flag) | unit (cap lowered by `monkeypatch`) | `pytest tests/test_okxtrades_walk.py -q` | no, Wave 0 |
| VREAD-07 | `deadline-returns-whole-windows-only`, `cap-breach-returns-contiguous-prefix`, `ticks-complete-the-range` (loop: feed `floor_day(max returned day)` as the next `since_ms` until no flag; union of days complete, `daily_pnl_truncated_okx` never set) | unit | same | no, Wave 0 |
| VREAD-07 | `begin-oldest-first-venue-refused`, `out-of-window-row-refused`, `edge-bill-counted-once` (a bill exactly on a window boundary) | unit (`OkxBillsArchive(oldest_first_with_begin=True)`) | same | no, Wave 0 |
| VREAD-07 | `cron-prefix-holds-cursor-and-marker`: fetch mock returns rows + `daily_pnl_deadline_okx`; `sync_trades` RPC called, `last_sync_at` NOT advanced, no marker row, no `trades_fetched_at`, no enqueue, status `held`, `fetch_partial_prefix` in the envelope; and an EMPTY prefix is not idle; `cron-okx-gets-a-deadline`, `cron-bybit-gets-none` | cron harness (`_drive_cron_sync`) | `pytest tests/test_cron_router.py -q -k "prefix"` | partial (edit) |
| VREAD-08 | `refused-fills-read-holds-cursor` (fetch_raw raises -> `p_last_fetched_ts is None`; RED on HEAD: now stamped) | unit (real `run_sync_trades_job`) | `pytest tests/test_okxtrades_cursor.py -q` | no, Wave 0 |
| VREAD-08 | `cursor-stamps-stored-through-not-now` (value == max fill timestamp), `empty-run-leaves-column-untouched` (ingestion off, MT5, clean empty read), `truncated-fills-read-holds-cursor` | unit | same | no, Wave 0 |
| VREAD-08 | `ahead-key-reads-from-stored-fill-high-water` (column ahead of newest stored fill -> `fetch_raw_trades` `since_ms` == stored fill ms; no stored fill -> daily seed; read failure -> daily seed; NULL column -> daily seed, no fills query) | unit (`_FakeTradesQuery`) | same | no, Wave 0 |
| VREAD-08 | `refusal-then-clean-sequence`: refuse on day 1 (column set), clean on day 2 -> seed still covers day 1's span before `phase2_fill_ingestion_failed` is popped (column-non-NULL case; the bootstrap case per Open Question 1) | unit | same | no, Wave 0 |
| PROOF-01 | each gate above RED under its neuter, restored by `cp` from a byte backup, `cmp` clean, GREEN, recorded verbatim in the plan SUMMARY | manual procedure | see table below | n/a |

### PROOF-01: the neuter for each gate (the line to revert, and the arm that must go RED first)

| Gate arm | Neuter (revert this) | RED arm named |
|----------|----------------------|----------------|
| `okx-mixed-ccy-day-refused` | delete the new `if not is_stable_value(ccy): ... return []` branch in the `fetch_daily_pnl` OKX aggregation loop | that arm (HEAD already RED: the pre-fix run is the "pre-fix code" evidence) |
| `okx-funding-bill-in-btc-not-refused` | move the ccy check above the `bill_type == _OKX_FUNDING_BILL_TYPE` `continue` | that arm |
| `non-usd-token-registered-everywhere` | remove the token from `daily_pnl_read_verdict` / `READ_INCOMPLETE_TOKENS` / cron `_fetch_degradation` (one neuter per site) / add it to `_TRANSIENT_REFUSAL_TOKENS` | the matching sub-arm per site |
| `long-first-window-completes` | restore the single-range request (`begin=since_ms`, no `end`, one cap per instType) | that arm, naming `daily_pnl_truncated_okx` |
| `deadline-returns-whole-windows-only` | keep the in-progress window's bills on a deadline stop | that arm |
| `cap-breach-returns-contiguous-prefix` | `continue` to later windows after a cap breach | that arm |
| `begin-oldest-first-venue-refused` / `out-of-window-row-refused` | delete the descending/ts self-check | those arms |
| `cron-prefix-holds-cursor-and-marker` | drop `and not fetch_prefix_only` from `should_advance_cursor` and from `strategy_advances` (one neuter each) | the cursor arm, then the marker arm |
| `okx-page-cap-unchanged` | raise `OKX_BILLS_PAGE_CAP` (the "not a close") | that pin |
| `refused-fills-read-holds-cursor`, `cursor-stamps-stored-through-not-now`, `empty-run-leaves-column-untouched` | restore `advance_fetched_cursor = (not raw_fills) or (phase2_complete and not phase1_failed)` and `_p_last_fetched = _now_iso if advance_fetched_cursor else None` | each arm (all three fail under that one revert; neuter the stamp and the gate separately to prove each) |
| `ahead-key-reads-from-stored-fill-high-water` | restore `fills_since_ms = parse_since_ms(None, preferred=ctx.key_row.get("last_fetched_trade_timestamp"))` without the clamp | that arm |
| `truncated-fills-read-holds-cursor` | drop the `sync_truncated_` conjunct | that arm |

### Sampling Rate
- **Per task commit:** the quick run command above plus the new test file for that plan.
- **Per wave merge:** the affected-set command and the mypy command.
- **Phase gate:** full suite + mypy green (CI), the PROOF-01 transcript in each plan SUMMARY, then `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `tests/test_okxtrades_ccy.py`, `tests/test_okxtrades_walk.py`, `tests/test_okxtrades_cursor.py` (covers VREAD-06/07/08); import `tests._okx_bills` (`OkxBillsArchive`, `okx_bill`); build bills with window-relative timestamps.
- [ ] Extend `tests/_okx_bills.py` only additively (default-off), or build a small `/bills` 7-day fake from the same class.
- [ ] Re-fixture the OKX harness tests listed under "Tests that flip or rot", the two `tests/test_exchange.py` ccy tests, and the walletoffset calendar rot.
- [ ] No new framework install.

## Security Domain

`security_enforcement` is absent from `.planning/config.json` (treated as enabled).

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication / V3 Session | no | no auth surface touched |
| V4 Access Control | no | the refusal marker row is the existing owner-only `allocator_equity_derived` family (RLS); nothing new written to a public column except a closed token |
| V5 Input Validation | yes | venue strings (`ccy`, `billId`, `ts`) are validated before use (`is_stable_value` on a coerced `str`, numeric `billId` parse guarded, ccy code regex before logging); closed token sets (`READ_INCOMPLETE_TOKENS`) |
| V7 Error handling / logging | yes | `scrub_freeform_string` on any logged exception text; only class names and closed tokens reach flags, markers and the cron envelope |
| V6 Cryptography | no | none |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Venue-controlled text in a stored/public flag (`ccy` code list) | Tampering / Info disclosure | token-only flag; ccy census in the log only, regex-validated |
| Signed request URL in an exception message | Info disclosure | class name only (`daily_pnl_fetch_error_class`), `scrub_freeform_string` |
| A venue that ignores `begin`/`end` or reorders pages -> silent partial P&L | Tampering (data integrity) | self-checking walk, named refusal |
| Partial day overwriting a whole stored day (`sync_trades` window-scoped delete) | Tampering | day-aligned windows; whole windows only |

## Sources

### Primary (HIGH confidence)
- In-repo source read this session (Read tool): `analytics-service/services/exchange.py` (verdict, caps, OKX and Bybit branches, `_make_fill_dict`), `services/job_worker.py` (token sets, `run_sync_trades_job`, derive realized read), `routers/cron.py` (`_fetch_degradation`, `_sync_single_key` gates, `KEY_SYNC_TIMEOUT`, `_NON_OK_STATUSES`, `MAX_MARKER_LOOKBACK_MS`), `services/trade_resume.py`, `services/price_rule.py`, `services/closed_sets.py`, `services/exchange_pagination.py` (via full read), `supabase/migrations/20260602173710_advance_sync_cursor_claim_token_fence.sql`.
- Tests read: `tests/test_exchange_harness.py`, `tests/test_sync_trades_resume_seed.py`, `tests/test_daily_pnl_read_verdict.py`, `tests/_okx_bills.py`, `tests/test_okx_archive_parse.py::TestLiveInstTypePin`, `tests/test_cron_router.py` pins.
- Phase records: `.planning/phases/232-*/232-CONTEXT.md`; `.planning/phases/231-*/231-REVIEW-W2.md` (WR-03, SF-6, R2-3), `231-04-SUMMARY.md` (`dependency-232`); `.planning/milestones/v1.20-phases/167.1.2.2.2.1-okxhistory-*/167.1.2.2.2.1-RESEARCH.md` sections 1 and 11, plan 10 SUMMARY; `TODOS.md` three entries.
- Measurements run this session: `is_stable_value` over `USDT/USDC/usdt/""/USDG/BTC/DAI`; pytest baselines; mypy baseline.

### Secondary (MEDIUM confidence)
- OKX docs (`https://www.okx.com/docs-v5/en/`, Get bills details last 7 days / last 3 months): re-fetched via WebFetch (paraphrase) and cross-read against the verbatim quotes recorded in `179-RESEARCH.md` and `167.1.2.2.2-RESEARCH.md`.

### Tertiary (LOW confidence)
- Venue behaviour under `begin`/`end` and for windows older than 7 days: not measured anywhere in the repo (tagged `[ASSUMED]`).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new.
- Architecture (VREAD-06, VREAD-08, token registration, cron gates): HIGH, read from source.
- VREAD-07 venue behaviour: MEDIUM-LOW, assumptions guarded by self-checks.
- Pitfalls: HIGH for code-level, MEDIUM for venue-level.

**Research date:** 2026-11-24
**Valid until:** 2026-12-08 (the planned order has 222 and 223 editing adjacent files; re-measure line anchors at plan time and cite by symbol)
