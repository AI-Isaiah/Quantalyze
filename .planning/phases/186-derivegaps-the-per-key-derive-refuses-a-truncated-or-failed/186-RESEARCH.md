# Phase 186: DERIVEGAPS - Research

**Researched:** 2026-11-03
**Domain:** analytics-service per-key broker derive (`derive_broker_dailies`), the allocator equity compose, Bybit/OKX venue reads, and the TS reader that names a key to the owner.
**Confidence:** HIGH for code facts (every discrete value below was read in this session and is quoted); MEDIUM for venue behaviour (a few items are `[ASSUMED]` and routed to the SC-1 probe).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Carried from the booking (founder 2026-11-01, ROADMAP `### Phase 186` "Booking")**
- **D-01 — One fix phase for Gaps 1+2.** "Book one fix phase (Recommended)". Each gap starts with a read-only PROD count of the keys it affects (SC-1).
- **D-02 — Bybit internal transfers are flows.** This reverses BYBITFUNDING 180 D-02. Wire in the existing reader `fetch_bybit_unified_flows`; do not write a new one.
- **D-03 — A failing key affects only itself.** "Only that key (Recommended)". This reverses 167.1.2.1.1 D-03 and applies the founder rule of 2026-10-28 (a dead key affects only itself).
- **D-04 — Gap 4: count first.** "Add to 186 DERIVEGAPS (Recommended)". First run a read-only count of same-hour funding pairs per (instrument, hour) on OKX and Bybit. Fix the dedup key only if pairs exist.

**Decided in this discussion (founder 2026-11-03, AskUserQuestion)**
- **D-05 — Bad read: hold last good, name it.** Question: "When a key's realized or funding read comes back truncated or failed, what should that key's curve show?" Answer: "Hold last good, name it (Recommended)": "The run writes nothing for that key. Its last good stored days stay as they are, and the key is marked 'read incomplete' by name. Same behaviour as the trade sync today. Nothing partial is ever published." — **Reversibility:** reversible.
- **D-06 — Read caps: page to the end, refuse if still short.** Question: "The derive caps how many pages it reads (OKX 100 pages per instType, Bybit 50 per week). What happens on a key that hits a cap?" Answer: "Page to the end, refuse if still short (Recommended)": "Raise the caps so a normal key reads its full history within the existing crawl time budget. Only a key that is still truncated after that is refused by name. The PROD count (SC-1) comes first and sizes the new caps." — **Reversibility:** reversible.
- **D-07 — Failing key: leaves the book that day.** Question: "A key in the book starts failing (error, sign-in failed, revoked) and its series stops. How should the book treat it?" Answer: "Leaves the book that day (Recommended)": "The key's history counts up to its last good day. From then on its capital is treated as leaving the book (a flow, not a loss or a gain). The rest of the curve draws normally and stays trustworthy, and the readers name the key. Replaces the flat r=0 carry that currently marks the whole curve untrustworthy." — **Reversibility:** costly — `FAILING_KEY_SERIES_ENDED` and the `COMPOSE_INCOMPLETE` refusal are read by the reader copy, the refusal rows and existing tests.

### Claude's Discretion
- The exact new page caps, sized from the SC-1 count within `_BROKER_CRAWL_TIMEOUT_S` (D-06).
- How the "read incomplete" name reaches the readers: reuse an existing reader line where one fits (167.1.2.1.1 D-04, "no new copy"). If none fits, the UI copy needs a DESIGN.md check.
- Whether the failing-key exit reuses the existing departed-key path (`departed_end_by_key`) or adds a sibling to it.

### Deferred Ideas (OUT OF SCOPE)
- Bybit P&L depth is 365 days in the new path against 730 in the legacy engine. That is less history, not wrong history; recorded for the founder in the booking and not in scope.
- The Bybit closed-pnl `limit: 200` against a possible venue max of 100 is a probe inside Gap 1, not a separate phase.
</user_constraints>

<phase_requirements>
## Phase Requirements

No requirement IDs are mapped (`Requirements: TBD` in ROADMAP). SC-1..SC-7 of the `### Phase 186` entry are the contract.

| ID | Description | Research Support |
|----|-------------|------------------|
| SC-1 | PROD count per gap recorded before any code change | Section "SC-1 Measurement Design" (exact SQL + worker probe spec) |
| SC-2 | Truncated/failed realized or funding read refuses that key by name; RED test | Gap 1 design + "Validation Architecture" |
| SC-3 | Bybit derive counts Unified internal/sub-account transfers as flows; no P&L spike test | Gap 2 design |
| SC-4 | Failing key no longer refuses/downgrades the book; readers name it | Gap 3 design |
| SC-5 | Post-deploy PROD reading confirms all three | "SC-5 Post-deploy reading" |
| SC-6 | Never invent data; uncomputable day is null | Pitfall 9; every refusal writes nothing |
| SC-7 | Same-hour funding-pair count first; if any, dedup keeps distinct positions, RED test | Gap 4 design (gated) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Work only in the `quantalyze-186` worktree on `feat/186-derivegaps`; the main checkout's Supabase CLI link is PROD. Marker query (`shobj_description(oid,'pg_database')`) runs ALONE and first before any PROD statement; it must EQUAL `database_marker` in `scripts/prod-prober/cron-manifest.json` (read at run time, never restated).
- PROD SQL: `supabase db query --linked -f <file>` from the main checkout; the file must NOT start with a `--` comment (the inline form breaks).
- Public repo with `.planning/` tracked: no secrets, PROD ids, home paths, account numbers; counts/ratios/closed tokens only; never quote a search pattern as proof of absence.
- Every migration auto-applies to PROD after merge (no human stop since 2026-09-23). A data-reading `DO` block that `RAISE EXCEPTION`s on a count can pass PROD and refuse on TEST (empty tables) and block a deploy (`[164.8-DATA-DEPENDENT-MIGRATION-ESCAPE]`). Re-base `CREATE OR REPLACE` on the latest definition.
- Tests must be able to fail: neuter, see RED, restore from a byte backup (never `git checkout/restore/stash` on uncommitted work). Money-math oracles are independent invariants. Always `grep -a`. pytest only from `analytics-service/`; never `importlib.reload` in tests.
- CI mypy line (verbatim, run from `analytics-service/`): `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`. It belongs in every analytics-touching brief and pre-push check.
- Annualization: risk by frequency (crypto 365, traditional 252). Never invent data: uncomputable metrics are null. Analytics freshness = `strategy_analytics.computed_at`.
- "A key's death affects only itself": a dead key affects only itself, never other keys/venues of the account (founder 2026-10-28); a strategy-linked key can also be in an allocator book.
- UI: read DESIGN.md before any visual/copy decision (voice: DM Sans body, active voice, muted `text-sm text-text-secondary` notes). No AI-authorship trailers in commits. `plan-anchor-verify` re-resolves every `file:line` anchor and named symbol a PLAN.md asserts: plans must cite symbols, not drifting line numbers.
- `/gsd-*` agents are dispatched only by the workflow's own dispatch step; operator steps (Railway start-command, PROD probe) are orchestrator checkpoints, never a dispatched executor. 184 recorded that the standing PROD authorization does NOT cover Railway start-command changes or probes: each needs the founder's explicit approval (AskUserQuestion). [CITED: 184-07-PLAN.md objective, "CONTEXT 'Founder rules carried', correction 2026-11-01"]

## Summary

The per-key derive (`run_derive_broker_dailies_job`, `services/job_worker.py`) calls `fetch_all_trades` → `exchange.fetch_daily_pnl` and then the funding fetcher, and never drains the data-quality (DQ) flag buffer. `fetch_daily_pnl` signals every truncation or failure ONLY through that buffer and returns a partial or empty list. So the derive publishes a funding-only or short-history series as a normal curve. The buffer is a `ContextVar`, not a module global: there is no cross-key concurrency hazard, and it IS visible through `asyncio.wait_for` on Python 3.12 (measured below). The three consumers that already read it (`routers/cron.py::_fetch_degradation`, `services/okx_archive_job.py::_check_live_realized_flags`) are the model for D-05. The CONTEXT sentence "`sync_trades` refuses on truncation flags" is imprecise: `run_sync_trades_job` only merges the flags into `strategy_analytics.data_quality_flags`; the refusal ("hold last good") is the cron tick (`fetch_degraded` skips the `sync_trades` write and does not advance the marker).

Gap 2 is mostly wiring: `fetch_bybit_unified_flows` returns rows already shaped for `ccxt_rows_to_dated_flows` and the flow price resolver. The real decision is REPLACE vs UNION with the on-chain deposit/withdrawal rows (double count if a deposit to FUND is later moved to UNIFIED), and the only way to decide it is a per-key overlap count in the SC-1 probe. The reader's own docstring says "INSTEAD of … never beside". A non-UTA (classic) Bybit key may make the Unified log read fail: the probe must count `uta`.

Gap 3 has a ready mechanism: the compose already has `departed_end_by_key` ("replayed on its FULL series … then clipped … rotated out … The ledger books the exit as an outflow of its last level") and the job already puts an ELIGIBLE key into it in the no-capital exit block (`departed_end_by_key[_k] = _nc_end`). Reuse it: a failing/read-incomplete key with a series that ended early gets `departed_end_by_key[k] = last_return_day[k]` and is named in the payload. Retiring `FAILING_KEY_SERIES_ENDED` as blocking touches a cross-runtime pinned table (Python fixtures, TS reader, SQL census) listed below. The three hidden couplings: (a) a refused (D-05) key whose `sync_status` is still working would be carried flat as benign `stale_mark_carry` unless the compose is told, so the D-05 marker and D-07 exit must be one mechanism; (b) `COMPOSE_INCOMPLETE` (key with no returns and no `key_inputs`) must exempt non-working keys but NOT working ones (self-healing backfill); (c) the shared-account `SHARED_ACCOUNT_NO_WORKING_KEY` block is the same family but a separate founder decision (D-18), see Open Question 3.

Gap 4 is latent and gated on the probe. In the DERIVE only OKX is affected (in-memory `match_key` dedup in `fetch_funding_okx`); Bybit's derive keeps every row (no dedup in `fetch_funding_bybit` or `walk_paginated`), and the collapse for both venues is in the `funding_fees` DB upsert (`on_conflict="match_key"`, `ignore_duplicates=True`), which the curve does not read. A derive-side fix (dedup on bill identity) needs no migration; changing `match_key` itself does (re-key + SQL parity pin + down file).

**Primary recommendation:** Ship in this order: (1) a read-only SC-1 measurement (DB SQL below + one worker-side probe modelled on `scripts/walletoffset_probe.py` reusing `scripts/bybit_funding_record.py`), recorded before any behaviour change; (2) one shared DQ-flag disposition drained right after the realized read, writing nothing and recording an owner-only `read_incomplete:<api_key_id>` marker row (no migration); (3) the compose treats failing OR marked keys through the existing departed-end path and names them in the payload; (4) Bybit Unified edge wired into the same flow block per the probe's replace/union verdict; (5) Gap 4 only if the probe finds pairs.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Venue reads (bills, closed-pnl, funding, transfers) | Analytics worker (Python, `services/exchange.py`, `funding_fetch.py`, `bybit_unified_flows.py`) | — | Keys are decrypted only in the worker; ccxt rate limiter lives there |
| Truncation/failure verdict + refusal (D-05) | Analytics worker (`job_worker.run_derive_broker_dailies_job`) | DB (owner-only marker row in `allocator_equity_derived`) | The read result is only known in-process; the marker survives for the compose and the reader |
| Failing-key exit from the book (D-07) | Analytics worker compose (`job_worker` compose block + `allocator_equity_compose.compose_allocator_equity`) | — | The book curve is composed in the worker; the reader never recomputes it |
| Naming the key to the owner | Frontend Server (SSR reader `src/lib/queries.ts`) | Browser (a muted note in `AllocationDashboardV2.tsx`) | Reader parses the stored payload against the owner's own key list (RLS owner SELECT) |
| Funding dedup identity (Gap 4) | Analytics worker (`funding_fetch`) | Database (`funding_fees.match_key` UNIQUE) | Derive reads in memory; DB table is a separate consumer |
| SC-1 counts | DB (SQL via `supabase db query --linked`) for Gap 3 and Bybit stored-flow candidates | Analytics worker probe (venue API) for Gaps 1, 2, 4 | Caps, transfers and funding pairs exist only at the venue |

## Standard Stack

No new library. Everything is existing code; nothing is installed. [VERIFIED: analytics-service/requirements.txt: `ccxt==4.5.89`]

### Core (existing, reused)
| Module / symbol | Purpose | Why |
|---|---|---|
| `services.exchange.fetch_daily_pnl`, `get_and_clear_last_dq_flags`, `_record_dq_flag` | realized read + the DQ channel | the only channel by which truncation/failure is reported |
| `services.bybit_unified_flows.fetch_bybit_unified_flows`, `BybitUnifiedFlowReadError` | Unified TRANSFER_IN/OUT reader (Gap 2) | D-02: do not write a new reader; error class already classified permanent in `classify_exception` |
| `services.exchange_pagination.walk_paginated` | window/cursor driver with ceiling policy | used by both funding and unified readers |
| `allocator_equity_compose.compose_allocator_equity` (`departed_end_by_key`) | exit of a key from the book | D-07 "leaves the book that day as a flow" is exactly its documented semantics |
| `allocator_equity_derived` table, `kind` family | owner-only per-key marker | `kind` has no CHECK; "Add a new family = INSERT a new row; no ALTER TABLE" |
| `scripts/walletoffset_probe.py`, `scripts/bybit_funding_record.py` | read-only worker probe pattern and Bybit evidence reader | redaction contract, deploy fingerprint, counted GET-only view already exist |

**Installation:** none. **Package Legitimacy Audit:** no external package is added, so the `package-legitimacy` gate is not applicable. Packages removed (SLOP): none. Flagged (SUS): none.

**Local tooling:** the worktree has no `.venv` and no `node_modules`. Python 3.12 venv exists in the main checkout's `analytics-service/.venv` (read-only use: run its `bin/python -m pytest` with cwd = the worktree's `analytics-service/`; `pytest.ini` has `pythonpath = .`). Installed ccxt there is 4.5.85 vs pinned 4.5.89 (cost tables below were read from 4.5.85). Baseline run in this session: `tests/test_derive_allocator_equity_job.py tests/test_writer_residual_parity.py tests/test_derive_refusal_rows.py -k "sc2 or residual or refusal"` → `48 passed`; `tests/test_bybit_unified_flows.py tests/test_trade_pages.py` → `49 passed`. TS tests need `npm ci` in the worktree first (not run).

## Architecture Patterns

### System Architecture Diagram

```
daily fan-out / sync tail
        |
        v
 derive_broker_dailies (key-mode)  ------------------------------+
        |                                                         |
        |  preflight (decrypt, breaker)                           |
        v                                                         |
 [A] equity anchor (wait_for 810s)                                |
        |                                                         |
        v                                                         |
 [B] realized: fetch_all_trades -> fetch_daily_pnl (wait_for 810s)|
        |   OKX: bills + bills-archive, 4 instTypes, page caps    |
        |   Bybit: closed-pnl, 7-day windows, page cap            |
        |   writes ONLY _LAST_DQ_FLAGS (ContextVar), returns rows |
        v                                                         |
 [B'] NEW: drain get_and_clear_last_dq_flags() IMMEDIATELY        |
        |-- rate-limit class -> raise ccxt.RateLimitExceeded ------>  outer arm: _stamp_429 + raise
        |-- fetch_error / truncated -> D-05 refusal:               |
        |        write nothing; marker row read_incomplete:<key>;  |
        |        return FAILED(named token)                        |
        v                                                         |
 [C] funding: fetch_funding_{okx,bybit,binance} (wait_for 810s)   |
        |   raises on page error/ceiling (already loud, unnamed)  |
        v                                                         |
 [D] flows: fetch_ccxt_transfers deposits/withdrawals             |
        |   NEW (bybit): + fetch_bybit_unified_flows (replace|union per SC-1)
        |   -> _resolve_ccxt_flow_price_index -> ccxt_rows_to_dated_flows
        v                                                         |
 combine_realized_and_funding -> csv_daily_returns upsert         |
        |   + key_inputs:<key> row (anchor, flows) + enqueue compose
        v
 derive_allocator_equity (compose)
        |  per key: working? has returns? has key_inputs? marker?
        |-- failing OR marked, series ended early, anchored:
        |        departed_end_by_key[k] = last_return_day[k]   (D-07: leaves as a flow)
        |        benign flag + payload list names the key
        |-- failing/marked, no returns AND no key_inputs: not "missing" (named, left out)
        |-- working, nothing yet: COMPOSE_INCOMPLETE (self-healing, unchanged)
        v
 equity_curve row (is_trustworthy stays true) --> SSR reader (queries.ts)
        --> readFailingKeyExits(flags, payload, owner's keys) --> muted note naming the key
```

### Recommended Project Structure (touch list)
```
analytics-service/
  services/exchange.py                 # caps -> module constants (+ optional deadline); optional shared flag->disposition reader
  services/job_worker.py               # drain+refusal in run_derive_broker_dailies_job; marker write/clear; compose: failing/marked exit; unified flows in flow block
  services/allocator_equity_derive.py  # DegradeReason/_BLOCKING_REASONS (retire FAILING_KEY_SERIES_ENDED as blocking)
  services/allocator_equity_compose.py # payload list for exited keys (modelled on no_capital_exited_keys)
  services/funding_fetch.py            # Gap 4 only if the probe finds pairs
  scripts/derivegaps_probe.py          # NEW read-only worker probe (SC-1)
  tests/                               # see Validation Architecture
src/lib/queries.ts                     # readFailingKeyExits + legacy token mapping kept
src/app/(dashboard)/allocations/AllocationDashboardV2.tsx  # one muted note (DESIGN.md check)
scripts/accounttruth-census.mjs        # CASE arm for the retired token kept as legacy
```

### Pattern 1: Drain the DQ buffer right after the realized read (the D-05 model)
**What:** the okx archive job already turns the buffer into a decision. [VERIFIED: services/okx_archive_job.py `_check_live_realized_flags`; quoted: `if flags.get("daily_pnl_fetch_error"):` … `if name in _RATE_LIMIT_CLASSES:` `raise ccxt.RateLimitExceeded("live realized crawl was rate limited")` … `raise _Stop("live_fetch_failed", f"class={label}")` … `if flags.get("daily_pnl_truncated_okx"):` `raise _Stop("live_anchor_unusable", "live_realized=truncated")`] and its call site comment: "the fetch swallows every error and returns what it has; the only trace is the per-task DQ buffer. Read it NOW, before any other crawl can reset it."
**Cron's reading** (the "trade sync today"): [VERIFIED: routers/cron.py `_fetch_degradation`] reasons = `daily_pnl_fetch_error`, `daily_pnl_binance_income_fallback`, and every flag with prefix `daily_pnl_truncated_` that is truthy; class name only, matched by `^[A-Za-z_][A-Za-z0-9_]{0,63}$`. `fetch_degraded` skips the write: `if trades and strategy_ids and not fetch_degraded:`.
**Measured in this session (Python 3.12.13, repo venv):**
```
bybit RateLimit -> [] {'daily_pnl_fetch_error': True, 'daily_pnl_fetch_error_class': 'RateLimitExceeded'}
bybit Network   -> [] {'daily_pnl_fetch_error': True, 'daily_pnl_fetch_error_class': 'NetworkError'}
visible through wait_for: {'daily_pnl_truncated_okx': True}
windows: 53 limit sent: 200
```
So (a) a venue rate limit on Bybit is NOT re-raised (the outer `except Exception` in `fetch_daily_pnl` swallows it, so the inner comment "must propagate to _stamp_429 path" is false in practice) and arrives only as the class name; (b) the ContextVar set inside `fetch_daily_pnl` is visible to the caller through `asyncio.wait_for(...)` on 3.12; (c) a full 365-day Bybit read is 53 windows.
**Proposed (new names, not existing code):**
```python
# proposed: right after `realized = await asyncio.wait_for(fetch_all_trades(...), timeout=_BROKER_CRAWL_TIMEOUT_S)`
_dq = get_and_clear_last_dq_flags()          # same task: visible through wait_for on 3.12
_verdict = daily_pnl_read_verdict(_dq)        # one shared reader, class NAME only, never the message
if _verdict.rate_limited:
    raise ccxt.RateLimitExceeded("derive realized read was rate limited")   # outer arm stamps 429
if _verdict.token is not None:                # fetch_error | truncated_okx | truncated_bybit | binance_income_fallback
    await _record_read_incomplete(...)        # key-mode marker row; strategy-mode: _stamp_strategy_analytics_failed(..., heal_series=False)
    return DispatchResult(FAILED, error_message=f"derive_broker_dailies: realized read incomplete ({_verdict.token})",
                          error_kind="transient" if fetch_error else "permanent")
```
`DispatchResult.error_kind` is `ErrorKind = Literal["transient", "permanent", "unknown"]` [VERIFIED: services/job_worker.py `ErrorKind = Literal["transient", "permanent", "unknown"]`].

### Pattern 2: Owner-only per-key marker row, no migration
[VERIFIED: services/job_worker.py `_record_nav_mark_refusal`, `_clear_nav_mark_refusal`; services/nav_marks.py `NAV_MARK_REFUSAL_KIND_PREFIX: Final[str] = "nav_mark_refusal:"`] A row `(allocator_id, kind = PREFIX + api_key_id)` with payload `{token, first_seen_day, last_seen_day}`, never raising, cleared when a later derive is clean. The table: `PRIMARY KEY (allocator_id, kind)`, owner SELECT RLS, "Add a new family = INSERT a new row; no ALTER TABLE". [VERIFIED: supabase/migrations/20260717233529_allocator_equity_derived_surface.sql, `COMMENT ON COLUMN allocator_equity_derived.kind`]. A new family `read_incomplete:` follows this exactly. The compose loads only `.like("kind", "key_inputs:%")` today, so the new family never collides with its orphan cleanup.

### Pattern 3: Failing key leaves the book through the departed-end path (D-07)
[VERIFIED: allocator_equity_compose.py `compose_allocator_equity` docstring, quoted] "`departed_end_by_key` … maps a departed key to the last ISO day its history counts. The key is replayed on its FULL series (its anchor is the level on its own last return day), then its levels, returns and flows are clipped to days `<= end`. After that day it is rotated out: it contributes nothing to the $-curve (an exit seam, see `_departure_seams`) and leaves both sums of `payload.returns`, so its leaving is never a return and its level is never carried. The ledger books the exit as an outflow of its last level on the next union day."
The job already feeds an ELIGIBLE key into this map: in the no-capital block `departed_end_by_key[_k] = _nc_end`, followed by `no_capital_exit_by_key[_k] = (_nc_token, _nc_end)`. The existing failing-key block sits immediately after it and today only counts: `failing_series_ended_keys += 1` when `working_holder_predicate` is false and `_member_last < _book_last_day`. **Recommendation (answers Discretion 3): reuse `departed_end_by_key`, not a sibling.** Replace the count with `departed_end_by_key[_member_id] = _member_last` (+ record it for naming), guarded the same way: single eligible member of its group, counted, anchored, has a return day, not already in `departed_end_by_key`. The compose then needs no new math. The exit is named like `no_capital_exited_keys`: a benign flag token plus an additive `payload` list `[{api_key_id, day}]` (no amount), built where `no_capital_exited` is built. [VERIFIED: that list is `{"api_key_id", "reason", "day"}` sorted by key id and present only when non-empty]

### Anti-Patterns to Avoid
- **Fixing only the realized read.** The funding fetch raises loudly on page error/ceiling (`FundingFetchCeilingExceeded`) but its failure is UNNAMED and retried as a transient; D-05 wants a name on both.
- **A refused-but-"working" key left to the compose's benign carry.** `sync_status` does not change on a D-05 refusal, so `working_holder_predicate` stays true and the compose would carry the key flat at r=0 (`stale_mark_carry`, benign): the exact silent dilution D-07 removes. The marker row is the signal the compose must read.
- **A fourth hand-copy of the flag-name list.** Cron and the okx archive job already hold two copies (`_fetch_degradation`, `_check_live_realized_flags`). Add ONE shared reader beside `get_and_clear_last_dq_flags` for the derive and add a parity test over all copies; do not refactor cron in this phase.
- **Writing the partial series "with a warning flag".** D-05: the run writes nothing for that key.
- **Raising caps without a deadline.** `asyncio.wait_for` expiry raises `TimeoutError` out of the fetch → transient FAILED → the same read retried with no resume (ROADMAP Gap 1 evidence). A key that needs more than the budget would loop forever.

## Gap 1 detail: caps, flags, budget

**Verbatim caps** (all FUNCTION-LOCAL constants inside `fetch_daily_pnl`, so a test cannot monkeypatch them today): `OKX_BILLS_PAGE_CAP = 100` (per instType in `["SWAP", "FUTURES", "SPOT", "MARGIN"]`, request `"limit": "100"`), `OKX_ARCHIVE_PAGE_CAP = 100` (same four instTypes), `BYBIT_PNL_PAGE_CAP = 50  # safety net per window` with `BYBIT_PNL_WINDOW_MS = 7 * 24 * 60 * 60 * 1000` and request `"limit": 200`. Default depth with `since_ms=None`: `timedelta(days=365)`. [VERIFIED: services/exchange.py `fetch_daily_pnl`] Funding: `MAX_PAGES = 200`, `OKX_PAGE_SIZE = 100`, `BYBIT_PAGE_SIZE = 50`, `BYBIT_FUNDING_DEFAULT_LOOKBACK_DAYS: int = 365`. [VERIFIED: services/funding_fetch.py]

**Flags** (the whole vocabulary, all booleans except the class string): `daily_pnl_truncated_okx` (set per cap hit on either OKX endpoint), `daily_pnl_truncated_bybit`, `daily_pnl_fetch_error` + `daily_pnl_fetch_error_class` (outer handler; unsupported venue sets `daily_pnl_unsupported_venue` too), `daily_pnl_binance_income_fallback`. Where each outcome leaves the list:
| Condition | Returned list | Flag |
|---|---|---|
| OKX page error | `[]` (aggregation happens after the loops) | fetch_error + class |
| OKX cap hit | PARTIAL (newest-first, so the OLDEST days lose their P&L) | `daily_pnl_truncated_okx` |
| Bybit non-rate-limit error (inner arm) | `[]` | fetch_error + class (stamped since 164.5.1.4) — the ROADMAP text "returns [] on any non-rate-limit error" is true for the list but the flag IS now set |
| Bybit rate limit | `[]` | fetch_error + class `RateLimitExceeded` (measured above) |
| Bybit cap hit | PARTIAL | `daily_pnl_truncated_bybit` |
A cap flag fires when the LAST allowed page is full and still has a cursor/next page; for OKX a history that is exactly a multiple of 100 bills per instType reports truncated falsely (the loop only checks `len(data) < 100` before the cap test). Treat as an accepted over-refusal, state it in the test.

**Funding read:** `fetch_funding_okx` raises on page exceptions, non-dict shape, non-list data, and `FundingFetchCeilingExceeded` at `MAX_PAGES`; `fetch_funding_bybit` raises through `walk_paginated` (`on_ceiling="raise"`), except the inverse category which skips gracefully on `BadRequest`/`PermissionDenied` (by design: key lacks inverse scope). Silent partials that remain: rows dropped by `_normalize_funding_row` (counted and WARN-logged, never flagged), the inverse skip, and Gap 4. The derive path today lets a funding raise propagate to the dispatcher (transient retry); it does not name the key. Open Question 2 covers dropped rows.

**Time budget (D-06).** [VERIFIED: services/job_worker.py] `_DERIVE_OUTER_BUDGET_S: Final[float] = 900.0  # == TIMEOUT_PER_KIND["derive_broker_dailies"]`, `_DERIVE_POST_CRAWL_RESERVE_S: Final[float] = 90.0`, and `_BROKER_CRAWL_TIMEOUT_S` defaults to `str(_DERIVE_OUTER_BUDGET_S - _DERIVE_POST_CRAWL_RESERVE_S)` = 810 s. It is a PER-CRAWL bound applied separately to equity, realized, funding, each transfer fetch and the price index, all under ONE 900 s outer `wait_for`. So the sum of the crawls must fit in 900 s, not each in 810: size the realized deadline from the probe's measured timings, not from 810. ccxt throttle per call = `rateLimit × cost` ms. [VERIFIED: ccxt 4.5.85 `describe()` read in this session] OKX `rateLimit` 110 ms: `account/bills` cost 2 (0.22 s), `account/bills-archive` cost 4 (0.44 s); Bybit `rateLimit` 20 ms: `v5/position/closed-pnl` cost 5 (0.10 s), `v5/account/transaction-log` cost 1.66 (0.033 s), `v5/asset/deposit/query-record` cost 10, `v5/asset/transfer/query-inter-transfer-list` cost 50, `v5/asset/transfer/query-universal-transfer-list` cost 25. Seconds per page = throttle + round-trip (RTT unmeasured: `[ASSUMED]` 0.2-0.5 s; the probe must measure it). Worst case today: OKX 4 instTypes × 100 pages × (0.22 + 0.44) = 264 s throttle-only plus RTT; Bybit 53 windows × 50 pages × 0.1 = 265 s throttle-only plus RTT. **Sizing rule (prescriptive):** new cap per endpoint = `floor(realized_budget_s / s_per_page)` where `realized_budget_s` is the share of the outer budget the probe shows a heavy key can spare after funding, flows and the 90 s reserve; implement a monotonic **deadline** (stop early and report truncated) inside the walk so the refusal is deterministic and named instead of a `TimeoutError`.

**OKX depth.** The recent endpoint covers ~7 days and the archive endpoint ~3 months. [CITED: docs.rs rust-okx / digdigdig3 endpoint tables found by web search, third-party wrappers; the official page could not be read in this session] The repo contradicts itself: `funding_fetch.fetch_funding_okx` docstring says "OKX caps recent bills at 3 months", `scripts/walletoffset_probe.py` says "the 7-day bills endpoint". Treat OKX API realized depth as ~3 months (older history comes from the okx archive job). `[ASSUMED]` for the 7-day / 3-month split; it does not change the design, it explains why a heavy OKX key hits 100 pages in 3 months.

**Bybit `limit: 200`.** Official docs: "Limit for data size per page. [`1`, `100`]. Default: `50`" and "endTime - startTime <= 7 days"; the page nav labels it "Get Closed PnL (2 years)". [CITED: bybit-exchange.github.io/docs/v5/position/close-pnl] The code sends 200 and walks by cursor (does not depend on page size), and Bybit derives work in PROD, so the venue either clamps or tolerates it; the effective page size (and so the real row cap: 50 × 100 = 5,000 per week, not 10,000) is unknown. `[ASSUMED]` clamp. Probe: one GET per limit value on a 7-day window, record `len(list)` and whether an error came back. If 100 is the effective size, change the request to 100 so the sent value is true (a one-line change that cannot alter results when clamped).

## Gap 2 detail: Bybit Unified edge

- **Reader contract.** [VERIFIED: services/bybit_unified_flows.py] `UNIFIED_FLOW_TYPES: Final[tuple[str, ...]] = ("TRANSFER_IN", "TRANSFER_OUT")`, `BYBIT_LOG_PAGE_SIZE: Final[int] = 50`, `UNIFIED_FLOW_PAGE_CAP: int = 200`, signature `async def fetch_bybit_unified_flows(exchange: Any, since_ms: int, now_ms: int) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]` returning `(deposits, withdrawals)`. Each row carries exactly `id`, `type` (`deposit`/`withdrawal`), `currency` (upper), `amount` (absolute, finite), `timestamp` (int ms), `fee` (None); never a `kind` key, never `info`. Direction comes from the REQUESTED type, never from a sign. It raises `BybitUnifiedFlowReadError` rather than return a short list (malformed answer, unreadable row, non-advancing cursor, page ceiling) and propagates every venue exception unchanged. `classify_exception` already maps that class to PERMANENT with the reader's static text. [VERIFIED: tests/test_job_worker.py `test_a_bybit_unified_flow_read_error_is_permanent`]
- **Compatibility with the derive's flow path.** Row shape is what `ccxt_rows_to_dated_flows` reads (`type`, `amount`, `timestamp`, `currency`, optional `fee`); sign comes from `type` (`deposit` → +, `withdrawal` → −), a Unified row has no `info`, so the Bybit own-transfer filter `str(withdraw_type) != "1"` keeps it as external. `_resolve_ccxt_flow_price_index(exchange, venue, supabase, rows)` prices non-stable coins from the rows' `currency`/`timestamp`. Wiring point: the single ccxt else-branch of `run_derive_broker_dailies_job`, inside the existing `try:` that builds `_flow_rows = list(_deposits) + list(_withdrawals)`, each under `asyncio.wait_for(..., timeout=_BROKER_CRAWL_TIMEOUT_S)`.
- **Cost.** 365 days / 7 = 53 windows × 2 types = ≥ 106 calls at ≈ 0.033 s throttle + RTT each: well inside budget. Depth: the reader's source says "documented depth 2 years"; the derive's flow floor is `flow_retention_floor('bybit')` = 365 days; keep it.
- **REPLACE vs UNION (the one real design question).** The reader's docstring: "The rebuild must use these rows INSTEAD of the on-chain deposit and withdrawal reads, never beside them: an on-chain deposit to FUND plus the FUND-to-UNIFIED move would otherwise count twice." The derive's anchor is the Unified wallet balance (`fetch_account_equity_and_upnl_usd`: "the anchor is realized-basis ``walletBalance``" for Bybit). The venue enum has no DEPOSIT/WITHDRAW type in the Unified transaction log; the only transfer types are `TRANSFER_IN` ("assets transferred into the Unified wallet") and `TRANSFER_OUT`. [CITED: bybit-exchange.github.io/docs/v5/enum, type(uta-translog)] Whether an on-chain deposit made directly into UNIFIED appears as a `TRANSFER_IN` is NOT documented → `[ASSUMED]` unknown. Therefore: **decision rule for plan 02, fed by the SC-1 probe's per-key overlap count** (probe pairs each on-chain deposit with a same-currency, equal-amount `TRANSFER_IN` within 30 days after it): (i) overlap pairs > 0 and every on-chain deposit paired → REPLACE for Bybit (Unified edge only), matching 180 D-01's accepted reasoning; (ii) overlap 0 and on-chain rows > 0 → UNION; (iii) partial pairing → UNION minus matched on-chain rows (pair-aware), and report the unpaired remainder to the founder. Whichever is chosen is a founder-visible reversal of 180 D-02 and must be recorded in CONTEXT and the ROADMAP (user-level deviation policy).
- **Evidence from 180-08 (PROD, redacted counts):** the a6 account read `onchain_dep rows=0`, `internal_dep rows=0`, `inter_xfer rows=0`, `universal_xfer rows=8` (oldest 180-364 days), Unified `in=4 out=2 sign_mismatch=0`, `uta=true`. So universal (sub-account) transfers (8 rows) are funding the account yet only 6 Unified rows exist: not every universal row crosses this UID's Unified edge. [CITED: 180-08-SUMMARY.md]
- **Non-UTA keys.** `accountType=UNIFIED` on a classic account will likely error → permanent refusal forever. The probe records `uta` per key (`scripts/bybit_funding_record.read_key_info` already returns `bybit_is_uta`/`bybit_is_master`); plan 02 must fall back to on-chain-only for a key that is not UTA, or name it. `[ASSUMED]` (classic-account behaviour of the log endpoint unverified).
- **Callers to keep consistent.** `run_stitch_composite_job`'s member derive (`_derive_ccxt_member`, the nested function that calls `fetch_all_trades`, `fetch_funding_*` and `fetch_ccxt_transfers` with NO drain and NO `wait_for`) is a second copy of the same three reads for strategies with several keys. 180 D-02 deliberately left composite and live NAV on the old kinds. Decide in planning (Open Question 4): one shared helper used by both, or composite explicitly left and booked.
- **Pins that must change.** `tests/test_trade_pages.py::test_no_service_module_calls_the_unified_flows_reader` asserts `naming == ["bybit_unified_flows.py"]` and that `job_worker.py` mentions `bybit_unified_flows` at most once and only to import `BybitUnifiedFlowReadError`; it is the D-02 pin and goes RED the moment the reader is wired. Replace it with a pin that `job_worker.py` imports the reader exactly once and that `broker_dailies.py` and `okx_archive_job.py` still do not name it (D-02 still holds for them).

## Gap 3 detail: compose, readers, tests

**Blocking machinery.** [VERIFIED: services/allocator_equity_derive.py] `FAILING_KEY_SERIES_ENDED = "failing_key_series_ended"` is a member of `_BLOCKING_REASONS`; `DeriveRefusal.COMPOSE_INCOMPLETE = "compose_incomplete"`; `NOT_WORKING_SYNC_STATUSES: frozenset[str] = frozenset({"revoked", "sign_in_failed", "error"})`; `working_holder_predicate` is true for `is_active is True`, `disconnected_at is None` and `sync_status is None or sync_status not in NOT_WORKING_SYNC_STATUSES`; `eligible_key_predicate` = `is_active and sync_status != "revoked" and disconnected_at is None`. So `error`/`sign_in_failed` keys are eligible-but-not-working; `revoked` keys are not eligible and already take the departed-history rule (`departed_history_inclusion`), so D-07's "(error, sign-in failed, revoked)" is already satisfied for `revoked`.

**Where the two harms come from (job_worker compose):**
1. `FAILING_KEY_SERIES_ENDED`: the block after the no-capital rule (single eligible member, counted, not in `departed_end_by_key`, not working, `_member_last < _book_last_day`) → `degrade_reasons` → `is_trustworthy` false → the reader maps it to `shared_account_no_working_key` ("The keys that read one of your exchange accounts are all failing to sync, so that account's history stops…", which names no key).
2. `COMPOSE_INCOMPLETE`: `missing_ids = counted_ids - (set(returns_by_key) | key_inputs_ids)` non-empty → `_persist_refusal(DeriveRefusal.COMPOSE_INCOMPLETE.value)` and DONE. A permanently failing key that never derived keeps the whole book "rebuilding" forever (the reader reads a sole `compose_incomplete` as `awaiting_derivation`).

**Design.**
- Failing (`not working_holder_predicate`) OR marked (`read_incomplete:<key>` row present) single eligible counted key, anchored, with a return day before the book's last day → `departed_end_by_key[k] = last_return_day[k]`; record `(api_key_id, day)` for naming; no blocking token. Day = the key's last good (stored) return day.
- Such a key with NO returns and NO `key_inputs`: exempt from `missing_ids` (and from `counted_ids` for the compose), named with `day: null`. A WORKING key with neither stays in `missing_ids` (backfill self-healing, existing behaviour).
- Such a key with `key_inputs` but no returns keeps today's blocking `dropped_key` (pinned by `test_sc2_failing_key_with_inputs_but_no_returns_raises_no_keyerror`); do not change it silently. Recommend leaving it (it is "not silent"), note it in the plan. **Superseded at planning (2026-11-03, plan-check revision):** the locked D-03 ("a failing key affects only itself") governs this population, so plan 186-11 removes such a failing or marked key from the compose, names it with `day: null`, and states the change in its must_haves and SUMMARY; a WORKING key with inputs and no returns keeps `dropped_key`. Plan 186-14 reads the population post-deploy.
- A failing key whose series reaches the book's last day: unchanged (nothing diluted).
- Recovery: the exit is a property of this derive's inputs; a key back to working simply composes normally on the next derive (existing `test_sc2_failing_key_recovering_clears_the_token` shape, no grace).
- The shared-account family: `SHARED_ACCOUNT_NO_WORKING_KEY` (group of 2+ with no working member) is the same defect family but a distinct founder decision (D-18, 2026-09-27). Not in the booked gap text; Open Question 3.

**Reader chain that reads the old token (retire carefully; Reversibility = costly):**
| Consumer | File | What it does with `failing_key_series_ended` |
|---|---|---|
| Writer enum + blocking set | `services/allocator_equity_derive.py` | member + `_BLOCKING_REASONS` |
| Writer raise | `services/job_worker.py` (`degrade_reasons=[... (DegradeReason.FAILING_KEY_SERIES_ENDED, failing_series_ended_keys > 0) ...]`) | raises it |
| TS reader | `src/lib/queries.ts::untrustworthyRebuildReason` | `tokens.includes("failing_key_series_ended")` → `"shared_account_no_working_key"` (precedence slot 1) |
| SQL census mirror | `scripts/accounttruth-census.mjs` (`untrustworthy_reason` CASE) | same arm |
| Cross-runtime tables | `analytics-service/tests/fixtures/derive_refusal_rows.json` (`blocking` row), `analytics-service/tests/fixtures/writer_residual_resolution.json` (cell `sc2-failing-key-ends-two-days-early`, `derive.blocking_tokens` and `reader`) | pinned |
| Tests | `tests/test_derive_refusal_rows.py::test_the_fixture_has_one_blocking_row_per_blocking_degrade_reason` (`set(tokens) == {r.value for r in _BLOCKING_REASONS}`), `tests/test_writer_residual_parity.py::test_the_cells_are_unique_and_cover_every_derive_side_token` (`assert "failing_key_series_ended" in raised`), `src/lib/queries.test.ts`, `src/lib/__tests__/writer-residual-parity.test.ts`, `src/lib/__tests__/derive-refusal-rows.test.ts`, `src/__tests__/accounttruth-census.test.ts`, `tests/test_derive_allocator_equity_job.py` sc2 block | pinned |
| Stored rows | PROD `equity_curve` rows written before the change carry the token until the next daily derive replaces them | read, not written |

**Recommended retirement:** keep the enum member and the reader/census mapping as a LEGACY token (stored rows still carry it until replaced; the 183 D-01 `legacy_refusals` precedent in `derive_refusal_rows.json` is the model), remove it from `_BLOCKING_REASONS`, stop raising it, move its fixture row to a legacy list, change the `writer_residual_resolution.json` cell to `blocking_tokens: []`, `trustworthy: true`, reader `ready`, and add a cell for the exit. Update the two assertions that name it. This is the work "costly" refers to: it touches Python, TS and SQL-census twins in one commit.

**Naming the key (D-04 "no new copy" check).** Existing owner-facing lines: `key_not_syncing` names the key but only for an identity-pending failing key (`notSyncingIdentityPendingKeyIds`); `shared_account_no_working_key` names none; `UnpricedAccountNote` names accounts but its sentences are specifically about a missing BTC close; `DepartedHistoryNote` is "at least one disconnected account". None fits "this key is failing, so the total stops counting it after <day>". **A new muted note is needed**, which makes the UI copy a DESIGN.md check (Discretion 2). Pattern to copy: `readUnpricedNativeAccounts(flags, derivedPayload, apiKeys)` (defensive read of a worker-written JSONB list against the owner's own keys; drops unknown ids and logs counts only) feeding `UnpricedAccountNote` (`role="status"`, `data-testid`, `className="mb-3 px-1 text-sm text-text-secondary"`, "Muted, not a warning: the total shown is right for the accounts it covers"). `no_capital_exited_keys` is NOT read by any TS code today (grep: no match in `src/`), so there is no existing reader line for an exit; the failing-key exit would be the first. Label rule from `readUnpricedNativeAccounts`: the key's label if non-empty else its exchange. Copy must be active voice (DESIGN.md), name the label and the day, and say the capital is "no longer counted", not "lost".

**Existing test harness to extend:** `tests/test_derive_allocator_equity_job.py` helpers `_sc2_book`, `_gate_key`, `_stale_curve`, `_run_gate`, `_composed_payload`, `_nc_curve`, `_nc_book_returns`, `_compose_no_capital_book`; the no-capital block there asserts `payload["no_capital_exited_keys"] == [{"api_key_id": "key-B", "reason": "dust", "day": d[2]}, ...]`.

## Gap 4 detail: same-hour funding legs

[VERIFIED: services/funding_fetch.py] `_FUNDING_BUCKET_HOURS: dict[str, int] = {"binance": 1, "okx": 1, "bybit": 1}` and
```python
return (
    f"{strategy_id}:{exchange}:{symbol}:"
    f"{_bucket_for_exchange(ts, hours=hours)}"
)
```
- **Derive impact.** `fetch_funding_okx` dedups in memory: `if row["match_key"] in seen: continue` (to merge the recent+archive overlap). In the derive `strategy_id` is the `funding_label` (the key id), so two distinct legs in one (instrument, hour) collapse to the first. `fetch_funding_bybit` returns `walk.rows` with NO dedup (and `walk_paginated` has no dedup/seen/match_key: grep of `services/exchange_pagination.py` for those words is empty), so the Bybit derive keeps both legs. `fetch_funding_binance` not examined (Binance is Phase 187).
- **DB impact.** `upsert_funding_rows` uses `on_conflict="match_key"`, `ignore_duplicates=True`; the table has `match_key TEXT NOT NULL UNIQUE`. Both venues lose the second leg in `funding_fees` (consumer: `positions.funding_pnl`/reconcile, not the curve).
- **Identity available.** `_RAW_DATA_WHITELIST` keeps OKX `billId`, Bybit `id`, Binance `tranId` in `raw_data`. Whether OKX bills carry `posSide` is `[ASSUMED]` (not in the whitelist; do not rely on it). `billId` is certain (it is the pagination cursor).
- **Fix options (apply only if the probe finds pairs, D-04):**
  1. *Derive-side, no migration (recommended):* dedup `fetch_funding_okx` rows on `billId` (fall back to `match_key` only when `billId` is missing), so the recent+archive overlap still collapses (same `billId`) and distinct legs survive. Leaves `funding_fees.match_key` as is; document that the table still collapses legs (book a TODO).
  2. *Also fix the table:* change `_build_match_key` (e.g. append the bill identity). Every new row then gets a new-format key while old rows keep the old one, so the next overlapping refetch inserts a duplicate of an already-stored settlement and `positions.funding_pnl` double counts. It needs a re-key migration from `raw_data->>'billId'`/`id`, a SQL parity pin (`tests/test_funding_match_key_sql_parity.py`), and a `supabase/migrations/down/` file, modelled on `20260704150835_funding_match_key_1h_rekey.sql` (DELETE the legacy-keyed duplicate first, then UPDATE; idempotent; forward-only). It auto-applies to PROD after merge and must be safe on EMPTY TEST tables (no `RAISE EXCEPTION` on a count). Rows the old key already discarded cannot be reconstructed; a 365-day funding re-backfill restores them.
- **SC-7 RED test:** two OKX type-8 bills, same `instId`, same UTC hour, distinct `billId` (and distinct `pnl`): today `len(await fetch_funding_okx(...)) == 1`; after the fix 2, and an exact duplicate (same `billId` in the recent and archive pages) still collapses to 1. Bybit twin: two SETTLEMENT rows, same `symbol`, same hour, distinct `id`: `fetch_funding_bybit` already returns 2; the RED target is `upsert_funding_rows`/`match_key` equality (assert the two rows' `match_key` differ) only if option 2 is chosen.

## SC-1 Measurement Design

Run order: marker query alone, then the SQL files one per call, then the worker probe. All outputs are `bucket<TAB>count` or the redacted probe records; nothing with ids. [CITED: CLAUDE.md "Which database am I on?"; scripts/accounttruth-census.mjs header]

**Marker (run FIRST, alone, file starts with SELECT):**
```sql
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database()
```
Must EQUAL `database_marker` in `scripts/prod-prober/cron-manifest.json`; NULL or TEST means stop.

**Reuse the existing census where it already answers:** `node scripts/accounttruth-census.mjs --print-sql=<label>` prints standalone SELECTs. Label `c` = owners/eligible keys missing returns or `key_inputs` (the `COMPOSE_INCOMPLETE` population), `d` = `equity_curve` rows by version/trust and every `degrade_reason=<token>` count (gives `failing_key_series_ended`), `e` = readiness by reason. Submit ONE label per call, after the marker and the `rls` label (must answer `bypasses_rls`).

**DB-only, Gap 3 (file `g3.sql`; syntax-checked on a scratch Postgres 16 with stub tables in this session, output shape confirmed):**
```sql
WITH keys AS (
  SELECT ak.id, ak.user_id, lower(btrim(ak.exchange)) AS exchange, ak.sync_status,
         (ak.is_active AND ak.sync_status IS DISTINCT FROM 'revoked' AND ak.disconnected_at IS NULL) AS eligible,
         (ak.is_active AND ak.disconnected_at IS NULL
           AND (ak.sync_status IS NULL OR ak.sync_status NOT IN ('revoked', 'sign_in_failed', 'error'))) AS working
    FROM public.api_keys ak
),
last_ret AS (
  SELECT r.api_key_id, max(r.date) AS last_day
    FROM public.csv_daily_returns r
   WHERE r.api_key_id IS NOT NULL
   GROUP BY r.api_key_id
),
book AS (
  SELECT k.user_id, max(l.last_day) AS book_last_day
    FROM keys k JOIN last_ret l ON l.api_key_id = k.id
   WHERE k.eligible
   GROUP BY k.user_id
),
failing AS (
  SELECT k.id, k.user_id, k.exchange, k.sync_status, l.last_day, b.book_last_day,
         EXISTS (SELECT 1 FROM public.allocator_equity_derived d
                  WHERE d.allocator_id = k.user_id AND d.kind = 'key_inputs:' || k.id::text) AS has_inputs
    FROM keys k
    LEFT JOIN last_ret l ON l.api_key_id = k.id
    LEFT JOIN book b ON b.user_id = k.user_id
   WHERE k.eligible AND NOT k.working
),
curves AS (
  SELECT d.payload AS p FROM public.allocator_equity_derived d WHERE d.kind = 'equity_curve'
)
SELECT 'eligible_keys' AS bucket, count(*) AS n FROM keys WHERE eligible
UNION ALL SELECT 'eligible_failing_keys', count(*) FROM failing
UNION ALL SELECT 'eligible_failing_keys.' || exchange || '.' || COALESCE(sync_status, 'null'), count(*) FROM failing GROUP BY exchange, sync_status
UNION ALL SELECT 'failing.series_ended_before_book_last_day', count(*) FROM failing WHERE last_day IS NOT NULL AND last_day < book_last_day
UNION ALL SELECT 'failing.series_reaches_book_last_day', count(*) FROM failing WHERE last_day IS NOT NULL AND last_day = book_last_day
UNION ALL SELECT 'failing.no_returns_with_inputs', count(*) FROM failing WHERE last_day IS NULL AND has_inputs
UNION ALL SELECT 'failing.no_returns_no_inputs', count(*) FROM failing WHERE last_day IS NULL AND NOT has_inputs
UNION ALL SELECT 'owners_with_failing_key', count(DISTINCT user_id) FROM failing
UNION ALL SELECT 'owners_with_failing_key_and_a_working_key', count(DISTINCT f.user_id) FROM failing f
  WHERE EXISTS (SELECT 1 FROM keys w WHERE w.user_id = f.user_id AND w.working)
UNION ALL SELECT 'equity_curve_rows', count(*) FROM curves
UNION ALL SELECT 'equity_curve_rows.failing_key_series_ended', count(*) FROM curves WHERE p -> 'degrade_reasons' @> '["failing_key_series_ended"]'::jsonb
UNION ALL SELECT 'equity_curve_rows.refusal_compose_incomplete', count(*) FROM curves WHERE p ->> 'refusal' = 'compose_incomplete'
UNION ALL SELECT 'equity_curve_rows.refusal_compose_empty_blocked', count(*) FROM curves WHERE p ->> 'refusal' = 'compose_empty_blocked'
ORDER BY 1
```
(`api_keys` and `csv_daily_returns` column names are the ones `accounttruth-census.mjs` already uses against PROD: `id, user_id, exchange, sync_status, is_active, disconnected_at`; `api_key_id, allocator_id, date`. Shared-account grouping is ignored, so counts are an upper bound on single-key accounts; fine for SC-1.)

**DB-only, Gap 2 candidate set (`g2.sql`, scratch-checked):** Bybit live keys whose stored `key_inputs` flows are empty but anchor is positive are the suspects; this does NOT prove an internal transfer exists, the probe does.
```sql
WITH bk AS (
  SELECT ak.id, ak.user_id
    FROM public.api_keys ak
   WHERE lower(btrim(ak.exchange)) = 'bybit'
     AND ak.is_active AND ak.sync_status IS DISTINCT FROM 'revoked' AND ak.disconnected_at IS NULL
),
ki AS (
  SELECT bk.id, d.payload
    FROM bk
    JOIN public.allocator_equity_derived d
      ON d.allocator_id = bk.user_id AND d.kind = 'key_inputs:' || bk.id::text
)
SELECT 'bybit_live_keys' AS bucket, count(*) AS n FROM bk
UNION ALL SELECT 'bybit_live_keys_with_key_inputs', count(*) FROM ki
UNION ALL SELECT 'bybit_live_keys_stored_flows_zero', count(*) FROM ki
  WHERE jsonb_typeof(payload -> 'flows') = 'array' AND jsonb_array_length(payload -> 'flows') = 0
UNION ALL SELECT 'bybit_live_keys_stored_flows_positive', count(*) FROM ki
  WHERE jsonb_typeof(payload -> 'flows') = 'array' AND jsonb_array_length(payload -> 'flows') > 0
UNION ALL SELECT 'bybit_live_keys_stored_flows_zero_and_anchor_positive', count(*) FROM ki
  WHERE jsonb_typeof(payload -> 'flows') = 'array' AND jsonb_array_length(payload -> 'flows') = 0
    AND jsonb_typeof(payload -> 'anchor_usd') = 'number' AND (payload ->> 'anchor_usd')::float8 > 0
ORDER BY 1
```
**DB-only, Gap 1 proxy (`g1.sql`, scratch-checked):** flags the INCREMENTAL strategy sync stamped (`run_sync_trades_job` merges `exchange_dq_flags` into `strategy_analytics.data_quality_flags`). It under-counts: the derive reads full history; the real Gap 1 count is the probe.
```sql
SELECT 'strategy_analytics_rows' AS bucket, count(*) AS n FROM public.strategy_analytics
UNION ALL SELECT 'dq.daily_pnl_truncated_okx', count(*) FROM public.strategy_analytics WHERE data_quality_flags ->> 'daily_pnl_truncated_okx' = 'true'
UNION ALL SELECT 'dq.daily_pnl_truncated_bybit', count(*) FROM public.strategy_analytics WHERE data_quality_flags ->> 'daily_pnl_truncated_bybit' = 'true'
UNION ALL SELECT 'dq.daily_pnl_fetch_error', count(*) FROM public.strategy_analytics WHERE data_quality_flags ->> 'daily_pnl_fetch_error' = 'true'
ORDER BY 1
```
No DB-only count exists for Gap 4 (the dropped leg is dropped before insert; `funding_fees` cannot show it).

**Worker-side probe (needs venue API; keys are decrypted only in the worker):** a new `analytics-service/scripts/derivegaps_probe.py`, modelled on `scripts/walletoffset_probe.py` (same shape: no arguments, labels `k1..kN`, `emit_record` + `assert_sanitized` as the only stdout path, `deploy_fingerprint()` line, select-only DB handle, counted GET-only exchange view with a per-key call ceiling, per-key `asyncio.wait_for`, exit code 0/1, "a run-level failure prints the exception TYPE only"). Delivery as 184-04 did: ship the probe as a read-only tooling PR first (no behaviour change), then ONE approved run through a temporary Railway start-command wrapper (founder AskUserQuestion each time; orchestrator checkpoint, never an executor). PROD key count for scale: 17 keys on wallet-base venues (OKX 11, Bybit 6, Binance 0). [CITED: 184-04-SUMMARY.md summary record] Per OKX/Bybit key record (counts, booleans, closed tokens, 3-sig-fig ratios, age buckets; `field-absent` for not measured, never 0):
- **Gap 1:** run the REAL `fetch_daily_pnl(exchange, None)` under the counted view and a timer, then `get_and_clear_last_dq_flags()`: record `realized_state` ∈ {`complete`, `truncated`, `fetch_error`, `timeout`}, the flags as booleans, the failure class, rows, and per-endpoint page counts (OKX bills / archive per instType, Bybit windows and max pages in a window), `elapsed_s` bucket and mean seconds per page. For a `truncated` key only, continue with the probe's own walk past the cap (bounded by a call ceiling) to record pages-needed and the oldest day reached (this sizes D-06). Bybit limit probe: one 7-day window GET with `limit=200` and one with `limit=100`: record returned list lengths and whether either errored.
- **Gap 2 (Bybit):** reuse `scripts.bybit_funding_record.measure_funding` for the evidence-source counts and `bybit_is_uta`/`bybit_is_master`; plus `fetch_ccxt_transfers` counts (on-chain deposits/withdrawals), `fetch_bybit_unified_flows` counts (in/out), the ratio of Unified net flow to the key's anchor, and the OVERLAP count (on-chain deposit paired with a same-currency, equal-amount `TRANSFER_IN` ≤ 30 days later; same for withdrawals). This count decides REPLACE vs UNION.
- **Gap 4:** walk raw OKX type-8 bills (recent + archive, no dedup) and raw Bybit SETTLEMENT rows (linear + inverse) and count (a) groups with ≥ 2 DISTINCT bill ids in one (instrument, UTC hour) = real pairs, (b) groups with the same id twice (overlap, harmless), (c) rows dropped as malformed (attach a log handler on `quantalyze.analytics.funding_fetch` and count the `dropped %d malformed rows` WARN; no code change needed). 184-07's window-limited run printed `keys_measured 6 … keys_unmeasurable 0`, i.e. no same-hour duplicate in its one-day windows; that does not cover the 3-month archive. [CITED: 184-VERIFICATION.md SC-1 row]
- **Timing for sizing:** per key, seconds spent in realized, funding and flows, so the plan can split the 900 s outer budget with data.

**SC-5 post-deploy reading.** Re-run `g3.sql` (expect `equity_curve_rows.failing_key_series_ended` → 0 after the daily recompute and `failing.*` keys named in the stored payload `flags`), `accounttruth-census.mjs` labels `d`,`e`, and the probe's Gap 1/2 sections against the deployed worker; take any new SHA-bound CI reading from the right job, never a restated number.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| Bybit Unified/sub-account/universal transfer read | a new reader (D-02) | `fetch_bybit_unified_flows` | already refuses to return short, tested (`tests/test_bybit_unified_flows.py`), classified permanent |
| Key leaves the book as an outflow | new compose math | `departed_end_by_key` (+ `_departure_seams`, ledger exit) | already books the exit, tested for the no-capital path |
| Per-key owner-only marker | new table/column/migration | `allocator_equity_derived` `kind` family (nav_mark_refusal pattern) | no DDL, RLS already correct |
| Window/cursor/ceiling walks | hand loops for any new read | `walk_paginated` + `ProviderPaginationContract` | the ceiling policy and window tiling are already tested |
| Read-only PROD venue probe | an ad-hoc script | `scripts/walletoffset_probe.py` pattern + `scripts/bybit_funding_record.py` | redaction contract, call ceilings, fingerprint, GET-only view exist |
| Flag-name interpretation | a fourth bespoke copy | one shared reader next to `get_and_clear_last_dq_flags` + parity test | two copies already exist (`routers/cron.py`, `services/okx_archive_job.py`) |
| SQL census for owner books | new census section | `scripts/accounttruth-census.mjs --print-sql=c|d|e` + `g3.sql` | already redaction-safe and marker-gated |

**Key insight:** every protection the legacy engine had already has a counterpart in this codebase for some other consumer (cron, okx archive job, no-capital exit, nav-mark refusal row). The work is wiring the derive to them, not inventing mechanisms.

## Runtime State Inventory

(Not a rename phase; included because a token is retired and a row family is added.)

| Category | Items Found | Action Required |
|---|---|---|
| Stored data | PROD `allocator_equity_derived` `equity_curve` rows may carry `failing_key_series_ended` (and `refusal: compose_incomplete`) until the next daily derive replaces them; new `read_incomplete:<api_key_id>` rows will be created | no migration; keep the reader/census mapping of the old token as legacy; SC-1 `g3.sql` counts the stored rows |
| Live service config | none (no external service holds the token) | none |
| OS-registered state | none | none |
| Secrets/env vars | none new. `BROKER_CRAWL_TIMEOUT_S` env can override `_BROKER_CRAWL_TIMEOUT_S`; sizing must not assume the default if PROD overrides it (unverified, `[ASSUMED]` default in effect) | confirm in the Railway variable list at the probe checkpoint (read-only) |
| Build artifacts | none | none |

## Common Pitfalls

### Pitfall 1: The drain after the wrong await
**What goes wrong:** the buffer is reset at the entry of `fetch_daily_pnl` and `fetch_raw_trades`; any later crawl can reset or leak it. **Avoid:** drain immediately after the `fetch_all_trades` await, before funding/flows; a test patches `fetch_all_trades` with a side effect that calls `exchange._record_dq_flag(...)` and asserts the job sees it. **Warning sign:** flag visible in a unit test of `fetch_daily_pnl` but never in the job.

### Pitfall 2: A refusal that retries forever
**What goes wrong:** `TimeoutError` at 810 s → transient FAILED → identical read again (no resume). **Avoid:** deadline inside the walk (deterministic named truncation) and `error_kind="permanent"` for truncation; transient only for a fetch error. Cap hits are deterministic: retrying cannot help (cf. the okx archive job's `_Stop("live_anchor_unusable", ...)`, `[ASSUMED]` that it is permanent there).

### Pitfall 3: Silent dilution of a refused-but-working key
See Anti-Patterns. The compose must treat a `read_incomplete:` key like a failing key.

### Pitfall 4: D-07 and a stale anchor
The exit relies on the key's stored `anchor_usd` being its level on its last return day ("its anchor is the level on its own last return day"). A derive that fails after the daily returns were written but before `key_inputs` is rewritten is the mismatch `KEY_INPUTS_MISMATCH` already detects (R2-WR-01 read order); do not weaken it. A failed/refused derive writes neither, so they stay a matched pair.

### Pitfall 5: Cross-runtime drift when retiring the token
One commit must move the Python enum/blocking set, both fixtures, four test files, the TS reader/tests and the census CASE together; a partial change leaves a green Python run and a red `vitest`/census test (or the reverse).

### Pitfall 6: Replace vs union decided on a guess
Choosing wrong either double counts (union with overlap) or drops direct-to-UTA deposits (replace, if they do not appear as `TRANSFER_IN`). Both look like a plausible curve. The overlap count in SC-1 is the only evidence; do not skip it.

### Pitfall 7: Classic (non-UTA) Bybit keys
A permanent refusal on every derive for a key the Unified log cannot answer. Probe `uta`, fall back or name.

### Pitfall 8: The budget is a sum, not a max
Raising a cap makes the realized crawl longer inside a 900 s outer envelope shared with funding, flows and the 90 s reserve. Size from measured seconds-per-page, and keep the deadline.

### Pitfall 9: Inventing data
SC-6: a refused key writes no rows; a day the read could not reach is absent, never 0.0. `combine_realized_and_funding` has a `realized_reach_start` parameter ("a day the realized fetch could not REACH is MISSING, not 0.0") that the derive does not pass (default `None` drops nothing); do not use it as a substitute for refusing.

### Pitfall 10: Marker row visible to the wrong reader
Counts and closed tokens only in the marker payload (no venue text, no message, class name only, matched by the identifier regex used in `routers/cron.py`); never into `strategy_analytics.data_quality_flags`, which is publicly readable for a published strategy (same reasoning as nav-mark refusals).

## Code Examples

### Existing no-capital exit as the shape of the failing-key exit
```python
# Source: services/job_worker.py compose block (existing code, quoted)
anchors_by_key[_k] = _nc_level
null_anchor_reasons.pop(_k, None)
realized_terminal_by_key[_k] = (_nc_end, _nc_level)
departed_end_by_key[_k] = _nc_end
no_capital_exit_by_key[_k] = (_nc_token, _nc_end)
flows_by_key[_k] = [_f for _f in flows_by_key[_k] if _f.utc_day_iso <= _nc_end]
```
The failing-key exit needs only `departed_end_by_key[_member_id] = _member_last` plus the naming list (levels, returns and flows are clipped inside `compose_allocator_equity`).

### Existing guard to keep for the new block
```python
# Source: services/job_worker.py failing-key block (existing, quoted)
if len(_eligible_members) != 1:
    continue
_member = _eligible_members[0]
_member_id = _member["id"]
if _member_id not in counted_ids or _member_id in departed_end_by_key:
    continue
if working_holder_predicate(_member):
    continue
```
Extend the `working_holder_predicate(_member)` skip with "and no `read_incomplete` marker for `_member_id`".

### RED test shape for Gap 3 (independent invariant, not a restated implementation)
Book: failing A (anchor 40,000, flat r=0 through day 3 of 5) and working B (anchor 60,000, r=+1% each day). After the exit, on days 4-5 the book return must equal B's return (+1.00%) and `is_trustworthy` must be true. Today the compose carries A flat at r=0 on those days, so the book return is 0.6% (40% weight at 0) and the curve is untrustworthy: RED on both assertions. Cross-check with the ledger: the exit is an outflow of A's last level on the next union day, so the money-weighted flow sums to -A_last.

## State of the Art

| Old Approach | Current Approach | When | Impact |
|---|---|---|---|
| Legacy engine reads/protections (ACCTREBUILD, TRADEPAGES, READCEILING, OKXANCHOR, OKXREWRITE, BYBITFUNDING) | per-key derive + compose is the only curve path | Phase 176 closed 2026-11-03 (#1188) | these phases' protections must be re-homed (this phase) |
| Failing key blocks the whole curve | failing key leaves the book (this phase) | 167.1.2.1.1 D-03 (2026-10-16) reversed by D-03/D-07 | readers + fixtures change together |
| Bybit flows = on-chain deposits/withdrawals only | Unified edge via `fetch_bybit_unified_flows` | 180 D-02 reversed by D-02 | the `test_trade_pages` pin is retired |

**Deprecated/outdated:** the inner comment in `fetch_daily_pnl` ("must propagate to _stamp_429 path") is wrong for the Bybit rate-limit (measured). Do not rely on a rate limit surfacing as an exception from `fetch_daily_pnl`; read the class flag.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | OKX `account/bills` covers ~7 days and `bills-archive` ~3 months | Gap 1 detail | cap sizing and the "heavy OKX key" story change; probe measures actual depth reached |
| A2 | Bybit clamps `limit: 200` to 100 (or tolerates it) | Gap 1 detail | real row cap per window is 5,000 not 10,000; probe settles it |
| A3 | RTT per page is 0.2-0.5 s | Gap 1 detail | new caps/deadline mis-sized; probe records seconds per page |
| A4 | A direct on-chain deposit into UNIFIED may not appear as `TRANSFER_IN` | Gap 2 detail | REPLACE would drop real deposits; overlap count decides |
| A5 | Classic (non-UTA) Bybit accounts make `accountType=UNIFIED` log reads fail | Gap 2 detail | permanent refusal for such keys; probe counts `uta` |
| A6 | Truncation should be `permanent`, fetch error `transient` | Pattern 1 | retry noise or a stuck key; planner/founder may prefer both transient with an attempt cap |
| A7 | OKX bills carry `posSide` | Gap 4 detail | only matters if a key including it is chosen; `billId` is certain |
| A8 | PROD does not override `BROKER_CRAWL_TIMEOUT_S` | Runtime State | sizing off the 810 s default is wrong |
| A9 | Composite member derive is out of this phase's booked scope | Gap 2 / Open Q 4 | divergent protections between key-mode and stitched strategies |
| A10 | The non-"working" `read_incomplete` marker should drive the same exit as `sync_status` | Gap 3 detail | if the founder wants a refused working key carried instead, D-05 and D-07 contradict |

## Open Questions (RESOLVED)

Each question is closed by a plan mechanism that decides it from measured data or a founder answer before any code depends on it (resolved at planning, 2026-11-03).

1. **REPLACE vs UNION for Bybit flows.** Known: reader docstring says never beside on-chain; a6 had on-chain 0 and 8 universal rows. Unknown: whether direct-to-UTA deposits appear as `TRANSFER_IN`. Recommendation: let the SC-1 overlap count decide using the rule in Gap 2 detail, then record the reversal of 180 D-02 in CONTEXT and ROADMAP. — RESOLVED: plan 186-04 Task 2 writes `g2-flow-verdict:` from the probe's overlap count (plan 186-03's `pair_onchain_with_unified`), Task 3 asks the founder only when on-chain rows are unpaired and writes `g2-flow-final:`; plan 186-10 implements only the recorded source.
2. **Dropped malformed funding rows.** `_normalize_funding_row` drops (blank symbol, bad amount/ts) are only WARN-logged. Recommendation: expose a count via the DQ buffer and treat any drop on the derive path as read-incomplete ONLY if the probe shows PROD has none (otherwise a single bad row refuses a key forever); decide after SC-1. — RESOLVED: plan 186-04 Task 2 writes `g1-malformed-rule:` from the probe's malformed count, Task 3 writes `g1-malformed-final: refuse|book` (founder question when the count is above 0); plan 186-06 Task 2 adds the raise mode and plan 186-09 Task 2 refuses on it only under `refuse`.
3. **Shared account with no working key (`SHARED_ACCOUNT_NO_WORKING_KEY`).** Same defect family, separate founder decision (D-18). Recommendation: out of scope for 186; keep its blocking token and reader line, book it, and make the new exit block skip any group with 2+ eligible members exactly as the current block does. — RESOLVED: plan 186-04 Task 3 writes `q-shared:` (founder question when plan 186-01 counts a stored curve carrying it, otherwise booked as `[186-SHARED-ACCOUNT-NO-WORKING-KEY]`; `include` replans); plan 186-11 keeps the `len(_eligible_members) != 1` guard.
4. **Composite member derive (`run_stitch_composite_job`).** Same unprotected reads. Recommendation: put the drain/refusal and the Bybit flow source in one helper called by both so they cannot diverge; if the planner keeps scope to key-mode, book the composite explicitly. — RESOLVED: plan 186-04 Task 3 writes `q-composite:` (founder question when plan 186-01 counts a composite with an okx, bybit or binance member, otherwise booked as `[186-COMPOSITE-MEMBER-READ-GAPS]`); plan 186-13 applies the same drain and flow source to the composite member only under `include`.
5. **Cap values and deadline.** Unknown until the probe reports pages-needed and seconds-per-page. Recommendation: module-level constants + monotonic deadline; values from the probe's heaviest key times a margin, never from the 810 s figure. — RESOLVED: plan 186-04 Task 2 computes `g1-caps:` and `deadline_s` by the sizing rule from measured pages-needed and seconds-per-page, and counts every key it could not size on `g1-unmeasured:` (founder question `q-unmeasured`); plan 186-05 sets the module constants and the deadline to those numbers.
6. **Strategy-mode refusal copy.** A refused strategy-mode derive stamps a CURATED sentence that renders verbatim on the owner's page (`computation_error`); it needs a DESIGN.md/voice check and must contain no venue text or numbers. — RESOLVED: plan 186-08 Task 1 runs the DESIGN.md voice check and records the founder-approved sentence as `copy-answer-strategy:` (verified free of digits and venue names); plan 186-09 Task 2 stamps it verbatim.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| Python 3.12 + deps | pytest/mypy | yes (main checkout's `analytics-service/.venv`, invoked from the worktree) | 3.12.13, ccxt 4.5.85, mypy 2.4.0, pytest 9.0.2 | `make install` in the worktree |
| Node/vitest for TS twins | reader/census tests | no `node_modules` in the worktree | — | `npm ci` in the worktree before TS tasks |
| `supabase` CLI linked to PROD | SC-1 SQL | linked from the MAIN checkout only | — | run from the main checkout per CLAUDE.md |
| Railway worker + approval | SC-1 probe | founder approval each run | — | no fallback (keys decrypt only in the worker) |
| psql / Postgres 16 | local SQL syntax check | yes (Homebrew) | 16 | — |
| Venue API reachability from local | n/a | not needed (worker-side only) | — | — |

**Missing with no fallback:** founder approval for the probe run (blocks SC-1 and therefore all code).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest 9.0.2 (`asyncio_mode = auto`, `pythonpath = .`), vitest (`vitest run`) for TS twins |
| Config file | `analytics-service/pytest.ini`, `analytics-service/pyproject.toml` (mypy), root `vitest.config.ts` |
| Quick run | from `analytics-service/`: `<venv>/bin/python -m pytest tests/<file> -q -x` |
| Full suite | from `analytics-service/`: `<venv>/bin/python -m pytest -q`; CI mypy: `mypy --strict --follow-imports=silent --config-file=pyproject.toml services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py`; TS: `npx vitest run src/lib/queries.test.ts src/lib/__tests__/writer-residual-parity.test.ts src/lib/__tests__/derive-refusal-rows.test.ts src/__tests__/accounttruth-census.test.ts` |

### Phase Requirements → Test Map
| Req | Behavior | Type | Command (extend/create) | RED on today's behaviour? |
|-----|----------|------|-------------------------|---------------------------|
| SC-2 | OKX truncation flag from `fetch_all_trades` → derive writes no `csv_daily_returns`/`key_inputs`, returns named FAILED, writes marker | job unit (extend the `_ccxt_key_derive_with_real_combine` harness in `tests/test_derive_broker_dailies_dualmode.py`; the fake `fetch_all_trades` calls `exchange._record_dq_flag("daily_pnl_truncated_okx", True)`) | `pytest tests/test_derive_broker_dailies_dualmode.py -k read_incomplete` | YES: today DONE + upserts |
| SC-2 | `daily_pnl_fetch_error` (class NetworkError) → transient named refusal, nothing written; class `RateLimitExceeded` → `ccxt.RateLimitExceeded` + `_stamp_429` | job unit | same file | YES |
| SC-2 | Bybit truncation, Bybit error, strategy-mode (`_stamp_strategy_analytics_failed(heal_series=False)` keeps a published row) | job unit | same file | YES |
| SC-2 | funding failure/ceiling named + marker | job unit | `tests/test_derive_broker_dailies_dualmode.py` | YES (unnamed today) |
| D-06 | caps are module constants; a 150-page OKX history reads whole when cap raised, flagged when beyond; deadline stops deterministically with the flag (fake monotonic clock) | exchange unit | `tests/test_exchange_harness.py` (existing cap tests at the `daily_pnl_truncated_okx` / `_bybit` cases) | YES for the new caps/deadline |
| D-05 | the three flag readers agree (cron `_fetch_degradation`, okx `_check_live_realized_flags`, new shared reader) over every flag name | parity unit | new test file | YES until the shared reader exists |
| SC-3 | Bybit derive hands `external_flows` containing the internal TRANSFER_IN; internally funded account shows no spike and matches a hand-computed TWR (independent oracle) | job unit with the REAL combine spy (`_ccxt_key_derive_with_real_combine`) and `fetch_bybit_unified_flows` patched | `pytest tests/test_derive_broker_dailies_dualmode.py -k unified` | YES: today `external_flows` is empty |
| SC-3 | replace/union rule: a deposit-then-transfer pair counts once; non-UTA key falls back/named | job unit | same | decided after SC-1 |
| SC-3 | reader pin replaced | text pin | `pytest tests/test_trade_pages.py` | goes RED when wired (expected, then rewritten) |
| SC-4 | failing A ends early → trustworthy, A exits, book return on days after exit == B's return, ledger outflow, payload names A | compose job (extend `_sc2_book`) | `pytest tests/test_derive_allocator_equity_job.py -k sc2` | YES: today untrustworthy + diluted |
| SC-4 | failing key with no returns/no inputs does not refuse the book; a WORKING one still does | compose job | same | YES / regression guard |
| SC-4 | read_incomplete-marked WORKING key exits (no benign carry) | compose job | same | YES |
| SC-4 | recovery clears | compose job | same | regression |
| SC-4 | cross-runtime: fixtures + writer + reader + census agree; legacy token still maps | parity | `tests/test_writer_residual_parity.py`, `tests/test_derive_refusal_rows.py`, TS twins above | YES after fixture change |
| SC-4 | reader names the key (defensive parse, unknown id dropped, count-only log) | vitest | `src/lib/queries.test.ts` (+ a component test for the note) | new |
| SC-7 | two OKX legs, one hour, distinct `billId` → 2 rows; same `billId` recent+archive → 1 | unit | `pytest tests/test_funding_fetch.py` | YES on the current key (only if SC-1 finds pairs) |
| SC-6 | refusal leaves previous rows/series untouched; no row for the unreachable day | job unit | dualmode file (assert zero `csv_daily_returns` ops) | n/a |

**Making each RED honestly:** per project rule, neuter the new code path (byte backup, never git checkout), run the test, see RED, restore. For the compose test the independent invariant is the arithmetic above, not a re-derivation through `compose_allocator_equity`.

### Sampling Rate
- **Per task commit:** the single touched test file (≈5 s each on this machine) plus mypy on the touched module set.
- **Per wave merge:** `tests/test_derive_*`, `tests/test_exchange_harness.py`, `tests/test_funding_fetch.py`, `tests/test_trade_pages.py`, `tests/test_writer_residual_parity.py`, `tests/test_job_worker.py`, the four vitest files, and the full mypy line.
- **Phase gate:** full pytest, full mypy line, `npx vitest run`, `npm run lint`/`typecheck` for the TS files.

### Wave 0 Gaps
- [ ] `analytics-service/scripts/derivegaps_probe.py` (+ its own test file, mirroring `tests/test_walletoffset_probe.py` conventions) — SC-1
- [ ] `g1.sql`/`g2.sql`/`g3.sql` as files in the main checkout scratch (not committed; text is in this document) — SC-1
- [ ] module-level cap constants and a shared flag-disposition reader in `services/exchange.py` — SC-2
- [ ] fixtures: legacy-token move in `derive_refusal_rows.json`; new cell(s) in `writer_residual_resolution.json` — SC-4
- [ ] `npm ci` in the worktree — TS twins

## Security Domain

`security_enforcement` is absent in `.planning/config.json`, so it is enabled.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no change | keys stay decrypted only in the worker (`_allocator_key_preflight`) |
| V4 Access Control | yes | marker rows go in `allocator_equity_derived` (FORCE RLS, owner SELECT); the reader resolves key ids only against the OWNER's own key list (drop unknown ids, as `readUnpricedNativeAccounts`) |
| V5 Input Validation | yes | the payload list is worker-written JSONB: parse defensively in TS; class name accepted only if it matches `^[A-Za-z_][A-Za-z0-9_]{0,63}$` |
| V7 Error handling / logging | yes | class name only; never venue text (ccxt messages can carry a signed URL with `&signature=`); use `scrub_freeform_string` for anything freeform; no key id/venue id/USD in logs of the compose (T-167.1.2-22) |
| V6 Cryptography | no | none added |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---|---|---|
| Signed request URL leaking through an exception message into `compute_jobs.error_message`, Sentry or a marker row | Information disclosure | class name only; `scrub_freeform_string`; the refusal token is from a closed set |
| Public repo leak via the probe's output or this research | Information disclosure | probe `emit_record`/`assert_sanitized` contract (labels, counts, tokens, 3-sig-fig ratios); SQL outputs aggregate counts only; no ids in tracked text |
| Probe issuing a venue write | Tampering | counted GET-only exchange view; a text pin on the file's raw method names (as `bybit_funding_record` has) |
| One owner's marker read by another | Information disclosure | RLS owner SELECT on `allocator_equity_derived`; compose reads by `allocator_id` |
| Wrong-owner write | Spoofing | `allocator_id` from `api_keys.user_id` (the key row), never the job payload (existing rule) |
| Retry storm on a deterministic refusal | DoS | permanent classification for truncation; deadline inside the walk |

## Sources

### Primary (HIGH confidence, read in this session)
- Repo code (cited by symbol): `analytics-service/services/exchange.py` (`fetch_daily_pnl`, `_record_dq_flag`, `get_and_clear_last_dq_flags`, `fetch_all_trades`), `services/job_worker.py` (`run_derive_broker_dailies_job`, `_record_nav_mark_refusal`, `classify_exception`, compose block, `_BROKER_CRAWL_TIMEOUT_S`), `services/allocator_equity_derive.py`, `services/allocator_equity_compose.py`, `services/funding_fetch.py`, `services/ccxt_flow_fetch.py`, `services/ccxt_flows.py`, `services/bybit_unified_flows.py`, `services/okx_archive_job.py`, `routers/cron.py`, `scripts/walletoffset_probe.py`, `scripts/bybit_funding_record.py`, `scripts/accounttruth-census.mjs`, `src/lib/queries.ts`, `src/app/(dashboard)/allocations/**`, `supabase/migrations/20260717233529_allocator_equity_derived_surface.sql`, `20260704150835_funding_match_key_1h_rekey.sql`.
- Executed in this session: Python 3.12.13 micro-run of `fetch_daily_pnl` (rate limit, network error, `wait_for` visibility, window count); ccxt 4.5.85 `describe()` cost table; scratch Postgres 16 syntax check of `g1/g2/g3.sql`; baseline pytest runs (48 + 49 passed).
- Planning artifacts: `186-CONTEXT.md`, `ROADMAP.md` `### Phase 186`, `180-CONTEXT.md`, `180-08-SUMMARY.md`, `167.1.2.1.1-CONTEXT.md` (D-03/D-04), `184-04-SUMMARY.md`, `184-07-PLAN.md`, `184-VERIFICATION.md`.

### Secondary (MEDIUM confidence)
- [Bybit V5 Get Closed PnL](https://bybit-exchange.github.io/docs/v5/position/close-pnl) — `limit` [1,100] default 50, 7-day window, "(2 years)" nav label.
- [Bybit V5 Get Transaction Log](https://bybit-exchange.github.io/docs/v5/account/transaction-log) — `limit` [1,50] default 20.
- [Bybit V5 enum type(uta-translog)](https://bybit-exchange.github.io/docs/v5/enum) — `TRANSFER_IN`/`TRANSFER_OUT`/`BONUS_TRANSFER_*`/Earn types; no DEPOSIT/WITHDRAW type.

### Tertiary (LOW confidence, third-party wrappers via web search)
- [rust-okx account api](https://docs.rs/rust-okx/0.6.4/src/rust_okx/api/account/api.rs.html), [digdigdig3 okx endpoints](https://docs.rs/crate/digdigdig3/0.1.13/source/src/crypto/cex/okx/endpoints.rs) — `account/bills` last 7 days; `bills-archive` up to 3 months. The official OKX page (406k chars) could not be read in this session.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new package; every reused symbol was opened.
- Architecture: HIGH for Gaps 1, 3; MEDIUM for Gap 2 (replace/union unresolved by design) and Gap 4 (gated on a count).
- Pitfalls: HIGH — each is tied to code read or a measurement run in this session.

**Research date:** 2026-11-03
**Valid until:** 7 days for the code facts (the file is edited by parallel phases; re-grep symbols before planning), 30 days for venue-doc facts.
