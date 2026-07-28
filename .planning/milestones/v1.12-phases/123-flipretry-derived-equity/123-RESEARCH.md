# Phase 123: FLIPRETRY — derived-allocator-equity FLIP retry - Research

**Researched:** 2026-07-19
**Domain:** asyncio worker event-loop safety, pg_cron fan-out, ground-truth gating (analytics-service Python worker + Next.js display flip)
**Confidence:** HIGH (all findings verified against source; one scope discrepancy flagged as an Open Question)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **The v1.11 rollback root cause IS the spec.** `phase35_backfill_enqueue` (24 keys) wedged the SEQUENTIAL prod worker — a slow/hanging live exchange crawl blocked the event loop on an `await` → healthz stale 12 min, the 90s auto-restart didn't fire. Recovery: deleted flip jobs, emptied `allocator_equity_derived` (0 curves ever shown), unscheduled `derive-allocator-key-dailies` cron. Derived path DORMANT on legacy. The fix is THREE-fold and ALL must land: (01) hard `wait_for` so a crawl can't hang the loop; (02) backfill off the sequential worker's loop; (04) health preserved + re-runnable enqueue with documented rollback.
- **FLIPRETRY-01 — hard per-crawl timeout:** Wrap EACH exchange crawl in `asyncio.wait_for(<crawl>, timeout=<bound>)`. `TimeoutError` → a TRANSIENT/retryable disposition that fails the JOB cleanly, NEVER an unbounded await. The per-kind handler timeout (`job_worker.py`) is the WATCHDOG (reclaims a stuck ROW); it does NOT unblock the event loop mid-await. Mirror the sFOX FLIPRETRY-01 pattern from phase 120.
- **FLIPRETRY-02 — batched, off the sequential worker:** the backfill must NOT run inline on the sequential prod worker. Re-schedule the cron `derive-allocator-key-dailies` at `'30 5 * * *'` (off-hours) — but ONLY once 01/02/04 make it safe.
- **FLIPRETRY-03 — ground-truth gate (founder-gated live leg):** flip is DATA-DRIVEN (no flag): `extractTrustworthyDerivedCurve` returns derived ONLY when trustworthy, else legacy. "Trustworthy" must incorporate `E2_GROUND_TRUTH_*` anchor-consistency (`e2_allocator_ground_truth.py`). Committed harness + fixture/anchor test carry CI; the LIVE E2 run (needs `E2_GROUND_TRUTH_*` read-only key in Railway) + prod backfill enqueue are FOUNDER-gated, never faked.
- **FLIPRETRY-04 — health + re-runnable + rollback:** healthz must never go stale past the restart threshold during backfill (prove it). Enqueue idempotent/safe-to-re-run. Document the ROLLBACK explicitly (delete jobs + `TRUNCATE/DELETE allocator_equity_derived` + unschedule cron) — the same recovery executed at v1.11 close.

### Claude's Discretion
- The exact `wait_for` bound per crawl.
- The batched-worker mechanism (dedicated process vs bounded-batch cron).
- Whether the sFOX-F5 crawl fold is a shared timeout helper or a parallel application of the pattern.

### Deferred Ideas (OUT OF SCOPE)
- The LIVE `E2_GROUND_TRUTH` run + the prod backfill enqueue + the cron re-schedule (founder ops).
- The deribit `correction` classification (Phase 124).
- The sFOX spine (118–122, code-complete) — beyond the minimal F5 fold note.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FLIPRETRY-01 | Each derived-equity exchange crawl bounded by a hard `asyncio.wait_for` per-crawl timeout | §1 — exact crawl sites identified; sFOX mirror pattern at `job_worker.py:2662-2698` |
| FLIPRETRY-02 | Key-mode backfill runs batched/off-hours on its OWN worker; re-scheduled via cron `'30 5 * * *'` | §2 — worker topology mapped; dedicated-worker recommendation; cron in migration `20260717233529` |
| FLIPRETRY-03 | Derived curve passes `E2_GROUND_TRUTH_*` anchor-consistency before shown; `extractTrustworthyDerivedCurve` flips only when trustworthy | §3 — flip already gates on `is_trustworthy`; E2 harness is the founder-gated independent oracle |
| FLIPRETRY-04 | Health preserved throughout backfill; enqueue safe to re-run; documented rollback | §4 — healthz mechanics (90s `STALE_THRESHOLD`); idempotent enqueue confirmed; rollback runbook |
</phase_requirements>

## Summary

The v1.11 FLIP wedge was NOT a mystery — it is fully explained by three facts in the worker source, all verified this session:

1. **The worker is a single process running a single asyncio event loop.** `main_worker.main()` runs `asyncio.gather(dispatch_loop, watchdog_loop, daily_enqueue_loop, start_healthz_server)` on one loop. If any coroutine blocks the loop, ALL of them stall — including the healthz HTTP server.
2. **`dispatch_tick` claims a batch of 5 jobs and processes them SEQUENTIALLY** in a `for job in jobs:` loop, each `await dispatch(job)` inline. The healthz freshness timestamp `LAST_TICK_AT` is written exactly ONCE per tick, at claim time (`main_worker.py:498`) — NOT per job. `STALE_THRESHOLD = 90s`.
3. **The `derive-allocator-key-dailies` cron fans out `derive_broker_dailies` jobs, whose deribit + ccxt crawls are UNWRAPPED.** `dispatch()` does wrap every handler in `asyncio.wait_for(handler, TIMEOUT_PER_KIND[kind])`, but for `derive_broker_dailies` that budget is **15 minutes** — an order of magnitude past the 90s healthz threshold, so it is useless as a freshness guard. When 24 keys were enqueued, the worker claimed 5, ran the deribit-native-ledger / bybit crawls sequentially, one hung, `LAST_TICK_AT` froze, and healthz was stale for 12 minutes.

**Primary recommendation:** (01) Wrap each live crawl in `run_derive_broker_dailies_job` (the deribit `build_deribit_native_ledger` cash pass at `job_worker.py:2319` and the ccxt `fetch_ccxt_transfers` branch at `:2880-2883`) in `asyncio.wait_for(..., timeout=300)`, mirroring the already-landed sFOX branch (`:2662`). Also apply the same discipline to the legacy `equity_reconstruction._fetch_and_price_window` / `_fetch_current_equity` crawls. (02) Move the backfill onto a **dedicated Railway worker** that claims ONLY `derive_broker_dailies` + `derive_allocator_equity` via a kind-filtered claim, so a bounded-but-slow crawl never delays the prod worker's live jobs or its healthz tick; re-enqueue the cron only after that worker exists. (03) No new TS wiring is required — the flip already gates on `is_trustworthy`; the E2 harness is the founder-gated INDEPENDENT confirmation that a persisted `is_trustworthy=true` is earned. (04) The enqueue is already idempotent (per-`(api_key_id, UTC-date)` idempotency key + one-inflight-per-kind index); document the verbatim v1.11 rollback.

**⚠️ Scope discrepancy (see Open Question #1):** CONTEXT names the crawls to wrap as `equity_reconstruction.py` `run_reconstruct_allocator_history_job` (:2070) + `run_refresh_allocator_equity_daily_job` (:2367). But the cron that wedged the worker fans out `derive_broker_dailies` (a DIFFERENT handler, in `job_worker.py`), and the "deribit native ledger" crawl named in the STATE root cause lives there (`build_deribit_native_ledger`), NOT in the reconstruct path (which explicitly SKIPS deribit at `equity_reconstruction.py:2084`). The load-bearing FLIPRETRY-01 target is `derive_broker_dailies`. Wrapping BOTH pipelines is the defensive answer.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-crawl wall-clock bound (01) | Analytics worker (Python) | — | The event-loop guard belongs at the crawl `await` site inside the job handler |
| Off-sequential backfill (02) | Analytics worker process topology + Railway | Supabase (pg_cron + claim RPC) | A dedicated worker + kind-filtered claim isolates backfill from the prod loop |
| Ground-truth gate (03) | Analytics (compose writes `is_trustworthy`; E2 harness validates) | Next.js SSR (`extractTrustworthyDerivedCurve` reads the flag) | The flag is written server-side; the display flip is a pure read-boundary decision |
| Health/liveness + rollback (04) | Analytics worker (healthz) + Supabase (jobs + `allocator_equity_derived`) | Railway (restart policy) | Freshness is a worker-loop property; rollback is DB + cron state |

## The Runtime Data-Flow (verified)

```
pg_cron 'derive-allocator-key-dailies' @ 30 5 * * *  (migration 20260717233529, STEP 5)
        │  SELECT enqueue_derive_broker_dailies_for_allocator_keys();
        ▼
enqueue_derive_broker_dailies_for_allocator_keys()   (same migration, STEP 4)
        │  advisory-lock; FOR each eligible api_key (is_active AND NOT revoked AND disconnected_at IS NULL):
        │    enqueue_compute_job(kind='derive_broker_dailies', api_key_id=<key>,
        │                        idempotency_key='derive-dailies-<key>-<UTC-date>')   ← priority DEFAULTS to 'normal'
        ▼
compute_jobs queue  ──claim_compute_jobs_with_priority(batch=5)──►  main_worker.dispatch_tick
        │                                                             (single loop, sequential for-job)
        ▼
dispatch(job) → run_derive_broker_dailies_job   (job_worker.py:1981)   ◄── THE CRAWL (wedge site)
        ├─ venue=deribit  → build_deribit_native_ledger(...)          :2319  ⚠ UNWRAPPED (cash pass)
        ├─ venue=sfox     → crawl_sfox_balance_history / _transactions :2664  ✅ wait_for(300s) [phase 120]
        └─ venue=ccxt     → fetch_ccxt_transfers(...) ×2               :2880  ⚠ UNWRAPPED
        │  → persists per-key dailies + key_inputs → enqueues:
        ▼
derive_allocator_equity   (run_derive_allocator_equity_job, job_worker.py:6278)   ← crawl-FREE, pure DB+math
        │  compose_allocator_equity(...) → { curve, is_trustworthy, flags } 
        │  → UPSERT allocator_equity_derived (kind='equity_curve')    :6552
        ▼
Next.js SSR: derivePhase07Fields → extractTrustworthyDerivedCurve(payload)   (queries.ts:2379/2505)
        │  is_trustworthy===true AND well-formed dense curve → equityCurveSource='derived'
        └─ else → 'legacy' (equitySnapshotsToDailyPoints)   ← DORMANT-SAFE default today
```

## §1 — FLIPRETRY-01: The Exact Crawl Awaits (LOAD-BEARING)

### The mirror pattern (already landed, phase 120) — copy this verbatim
`job_worker.py:2662-2698` — the sFOX branch inside `run_derive_broker_dailies_job`:
```python
# constant (job_worker.py:195)
_SFOX_CRAWL_TIMEOUT_S: Final[float] = float(os.getenv("SFOX_CRAWL_TIMEOUT_S", "300"))

try:
    _bh_rows, _earliest_ms = await asyncio.wait_for(
        crawl_sfox_balance_history(ctx.exchange, start_date_ms=..., end_date_ms=...),
        timeout=_SFOX_CRAWL_TIMEOUT_S,
    )
    _txn_rows = await asyncio.wait_for(
        crawl_sfox_transactions(ctx.exchange, from_ms=..., to_ms=...),
        timeout=_SFOX_CRAWL_TIMEOUT_S,
    )
except asyncio.TimeoutError:
    logger.warning("... sfox crawl exceeded the %ss per-crawl bound — classified transient, retrying (FLIPRETRY-01)", ...)
    return DispatchResult(outcome=DispatchOutcome.FAILED, error_message="... retrying rather than wedging the worker (FLIPRETRY-01)", error_kind="transient")
```
`[VERIFIED: job_worker.py:2638-2698]` — `error_kind="transient"` is the correct disposition: `classify_exception` maps `asyncio.TimeoutError → ("transient", ...)` (`:364`), and a transient FAILED retries (bounded by `max_attempts`), never a terminal `failed` stamp, never a wedge.

### The UNWRAPPED crawl sites to wrap (the actual wedge targets)
| # | Handler / file:line | Crawl call | Status | Action |
|---|--------------------|-----------|--------|--------|
| C1 | `run_derive_broker_dailies_job` — `job_worker.py:2319` | `await build_deribit_native_ledger(ctx.exchange, ...)` (deribit **cash pass**) | ⚠ UNWRAPPED | Wrap in `wait_for(..., 300)` |
| C2 | `run_derive_broker_dailies_job` — `job_worker.py:2880` + `:2883` | `await fetch_ccxt_transfers(...)` deposits + withdrawals (bybit/binance/okx) | ⚠ UNWRAPPED | Wrap each crawl |
| C3 | `run_derive_broker_dailies_job` — `job_worker.py:2893` | `await _resolve_ccxt_flow_price_index(...)` (may hit venue OHLCV) | ⚠ likely I/O | Wrap or fold into C2's bound |
| — | `job_worker.py:2472` (deribit **MTM second pass**) | `await asyncio.wait_for(build_deribit_native_ledger(...), timeout=_mtm_pass_timeout)` | ✅ already bounded | reference pattern |
| — | `job_worker.py:2664/2672` (sfox) | already `wait_for(300s)` | ✅ phase 120 | mirror |

### Legacy path (CONTEXT-named; wrap defensively)
`equity_reconstruction.py` `run_reconstruct_allocator_history_job` (:2070) calls a SINGLE orchestrating crawl `_fetch_and_price_window(...)` at **:2131**, which internally awaits:
- `_fetch_trades_with_pagination` → `_fetch_trades_paginated_one_pass` — up to **500** pages of `await exchange.fetch_my_trades(...)` (`:604`), `_rate_limit_sleep` between.
- `fetch_ccxt_transfers` deposits + withdrawals (`:1676/:1679`).
- `asyncio.gather(_fetch_primary...)` — concurrent `_fetch_ohlcv_daily` (`:662`, up to 10 pages each).
- sequential CoinGecko fallback (`:1733`, httpx 30s per call).
- `_fetch_current_equity` (`:1774` → `fetch_balance`/`fetch_ticker`/`fetch_positions`, `:1964/:2000/:2029`).
- **Cleanest wrap point:** `asyncio.wait_for(_fetch_and_price_window(...), timeout=<bound>)` at `:2131` bounds the whole reconstruct crawl in one place. `run_refresh_allocator_equity_daily_job` (:2367) reads DB holdings (`_fetch_today_holdings`, `:2387`) and does NOT crawl live — its risk is low, but its `_allocator_key_preflight` opens an exchange (`job_worker.py:848`).

`[VERIFIED: equity_reconstruction.py:1633-1774, 2070-2364]`

### The wait_for bound
- Recommend **300s per crawl** to match the landed sFOX constant (`_SFOX_CRAWL_TIMEOUT_S`), env-overridable. Rationale (from the sFOX comment `:186-197`): under the 15-min `derive_broker_dailies` outer budget, 300s×2 serial crawls = 600s leaves ~300s for pure compose/persist. `[ASSUMED]` the same headroom fits the deribit cash-pass + ccxt branches — verify against a real bybit-19k / deribit-inception crawl duration before locking (founder run).
- **Critical nuance (why the bound alone is not enough):** `asyncio.wait_for` only cancels a crawl that COOPERATIVELY yields to the loop (aiohttp/httpx network waits do). A truly non-yielding await (a sync blocking call or CPU-bound section inside a crawl) cannot be cancelled by `wait_for`, and its timeout callback cannot fire because the loop is frozen. This is exactly why §2 (off-sequential worker) is mandatory and non-negotiable — it is the ONLY guarantee that protects the prod worker's healthz even against a misbehaving crawl. `[VERIFIED: asyncio semantics + main_worker.py single-loop topology]`

## §2 — FLIPRETRY-02: Off the Sequential Worker

### Worker topology (verified)
`main_worker.py` — ONE process, ONE event loop, `asyncio.gather` of 4 loops (`:849-854`). `dispatch_tick` (`:362`) claims `batch=5` via `claim_compute_jobs_with_priority` and processes them in a **sequential** `for job in jobs:` loop (`:505`), each `await dispatch(job)` inline (`:523`). `LAST_TICK_AT` is refreshed once at `:498` (claim time), NOT per job. `[VERIFIED: main_worker.py]`

**Consequence:** even with per-crawl `wait_for(300s)`, a claimed batch of 5 backfill jobs = up to 5×300s = 25 min in ONE `dispatch_tick` with `LAST_TICK_AT` frozen the entire time → healthz stale for 25 min. Per-crawl bounding does NOT keep healthz fresh on the shared worker. The backfill MUST leave this loop.

### Current enqueue priority — a finding
`enqueue_derive_broker_dailies_for_allocator_keys()` calls `enqueue_compute_job(... p_kind:='derive_broker_dailies', p_api_key_id:=...)` with **no `p_priority`** → defaults to `'normal'` (`migration 20260428120836`). So backfill jobs compete DIRECTLY with live sync work; the priority-aware `'low'` throttle (5/min, excluded when normal/high pending) does not even apply to them today. `[VERIFIED: migration 20260717233529 STEP 4 + 20260428120836]`

### Options (Claude's discretion) — evaluated
| Option | Mechanism | Isolates loop? | Fits topology? | Verdict |
|--------|-----------|----------------|----------------|---------|
| A. Dedicated batched worker | 2nd Railway service running a `main_worker` variant that claims ONLY `derive_broker_dailies`/`derive_allocator_equity` via a **kind-filtered claim** (new `p_kind_filter` arg or a new claim RPC); the prod worker EXCLUDES those kinds | ✅ fully | Yes — Railway = one process/container; a 2nd service is the idiom | **RECOMMENDED** |
| B. priority='low' only | Set backfill jobs to `'low'`; rely on the existing throttle | ❌ still shares the loop; per-job block remains | partial | Insufficient alone; pair with A or 01 |
| C. Bounded-batch cron that yields | Fan-out already emits per-key jobs; reduce `batch` / refresh `LAST_TICK_AT` per-job | ❌ still shares the loop | partial | A healthz band-aid, not isolation |

**Recommendation:** Option A + priority `'low'` on the fan-out (defense in depth) + FLIPRETRY-01 bounding (so even the dedicated worker can't wedge on a hung crawl). Option A requires a kind-scoped claim so the prod worker never claims backfill kinds and the batched worker claims only them. Railway config is a founder op (new service, `WORKER_ROLE`/kind-filter env).

### The cron
`derive-allocator-key-dailies` @ `'30 5 * * *'` is defined in **`supabase/migrations/20260717233529_allocator_equity_derived_surface.sql` STEP 5** (`:277-285`), using the idempotent unschedule-then-schedule pattern guarded by `IF EXISTS (SELECT 1 FROM cron.job WHERE jobname=...)`. It was UNSCHEDULED live at v1.11 recovery (`PERFORM cron.unschedule('derive-allocator-key-dailies')`), so the repo migration is unchanged but the live pg_cron state has no such job. **Re-scheduling is a founder-gated live SQL op** (`SELECT cron.schedule('derive-allocator-key-dailies','30 5 * * *', $$SELECT enqueue_derive_broker_dailies_for_allocator_keys();$$);`), OR a new forward migration. Do it ONLY after 01/02/04 land + the dedicated worker is deployed. `[VERIFIED: migration 20260717233529 STEP 5; STATE.md recovery]`

## §3 — FLIPRETRY-03: The Ground-Truth Gate

### How the flip decides "trustworthy" today
`extractTrustworthyDerivedCurve(payload)` (`queries.ts:2379`): returns `null` (→ legacy) unless `payload.is_trustworthy === true` AND every point has a strict `YYYY-MM-DD` date and a finite `equity_usd`, AND the curve is non-empty. `derivePhase07Fields` (`:2505-2516`) then sets `equityCurveSource = derivedCurve !== null ? "derived" : "legacy"`. An empty curve degrades to legacy (`:2408`). Every prod allocator hits legacy today (curves empty / `allocator_equity_derived` emptied at recovery). `[VERIFIED: queries.ts:2379-2518]`

### Where `is_trustworthy` comes from
`compose_allocator_equity` writes `"is_trustworthy": _is_trustworthy(frozenset(reasons))` into the payload (`allocator_equity_compose.py:238`), based on the curve's classified degradation reasons. `run_derive_allocator_equity_job` UPSERTs it into `allocator_equity_derived` (`job_worker.py:6552`). This flag is **self-assessed** by the compose module. `[VERIFIED]`

### The E2 harness — the INDEPENDENT oracle (P115-compliant)
`scripts/e2_allocator_ground_truth.py` (493 lines): a founder-run script that, over service-role READ-ONLY `csv_daily_returns` + persisted per-key anchors, does a LIVE exchange read (creds from `E2_GROUND_TRUTH_API_KEY`/`_API_SECRET`/`_PASSPHRASE`) and checks that the derived terminal equity agrees with the live account within a **2% same-trading-day tolerance** (`compute_anchor_consistency`, `:144`). Exit codes: **0 pass, non-zero fail, 3 SKIP** (missing env creds / account spec). It gates on the curve's `is_trustworthy` (`:155` — a benign `window_truncated` stays clean; a blocking degradation is not clean), and **scrubs evidence via the proven `scripts.deribit_ground_truth.assert_sanitized`/`sanitize_evidence` contract** (`:90`) rather than re-deriving with the module's own formula — this is the P115 independence guarantee. `[VERIFIED: e2_allocator_ground_truth.py:1-241; test_e2_ground_truth_harness.py]`

### The wiring answer (minimal, matches CONTEXT)
**No new TS plug and no new persisted E2 column are required.** The safety model is a staged gate:
1. Backfill writes curves with self-assessed `is_trustworthy`.
2. Founder runs the E2 harness (independent) → confirms the persisted `is_trustworthy=true` curves are anchor-consistent with live ground truth (exit 0).
3. ONLY if E2 passes does the founder enable the backfill/cron.
4. The TS flip reads `is_trustworthy` → shows derived.

The E2 result is **operational (exit code), not a per-request live call** — the runtime display gate stays the persisted `is_trustworthy` flag (keeps it data-driven, no flag, no live-read on the SSR path). If the planner wants a stronger runtime hard-gate, the enhancement is to have the E2 run stamp a persisted `e2_verified_at` marker that `extractTrustworthyDerivedCurve` additionally requires — but that EXCEEDS the CONTEXT ("flip is data-driven on is_trustworthy") and adds a founder-op coupling. **Recommend the minimal staged gate.** `[VERIFIED + one ASSUMED design choice — see Assumptions A2]`

### CI vs founder-gated split
- **CI (committed):** `tests/test_e2_ground_truth_harness.py` pins the pure verdict helpers (`compute_anchor_consistency`, `derive_terminal_equity` fail-loud). Add a fixture that drives a known-anchor pass/fail → asserts derived-vs-legacy via `extractTrustworthyDerivedCurve` (TS/vitest) and the harness verdict (pytest).
- **Founder-gated (human_needed):** the LIVE E2 run with `E2_GROUND_TRUTH_*` (a read-only key in Railway) + the prod backfill enqueue + the cron re-schedule.

## §4 — FLIPRETRY-04: Health + Re-runnable + Rollback

### How healthz goes stale (verified)
`main_worker_healthz.py`: `STALE_THRESHOLD = 90.0`s. The healthz HTTP endpoint returns **503** when `now - LAST_TICK_AT > 90s`, else 200. `LAST_TICK_AT` is written only in `dispatch_tick` at claim time (`main_worker.py:498`). The healthz server is a coroutine on the SAME event loop (`:853`), so if the loop is blocked it cannot even respond (Railway's HTTP healthcheck then gets a connection timeout, not a 503). The "90s auto-restart didn't fire" symptom = Railway's restart-on-healthcheck policy either wasn't aggressive enough or the loop-freeze prevented a clean 503; either way the DESIGN FLAW is `LAST_TICK_AT` being refreshed only per-tick, not per-job, combined with long inline crawls. `[VERIFIED: main_worker_healthz.py; main_worker.py:498]`

### How 01+02 provably keep it fresh
- §2 (dedicated worker) removes backfill from the prod loop → the prod `dispatch_tick` only handles fast live jobs → `LAST_TICK_AT` refreshes every ~30s → healthz never stale. This is the load-bearing guarantee.
- §1 (per-crawl bound) ensures the DEDICATED worker also can't wedge: each job returns within ~600s, and (recommended defense-in-depth) refresh `LAST_TICK_AT` per-job inside the `for job in jobs` loop so even the batched worker's healthz stays green mid-batch. `[recommended, surgical]`

### Enqueue idempotency (verified — answers "safe to re-run")
`enqueue_derive_broker_dailies_for_allocator_keys()` is idempotent by construction:
- `pg_try_advisory_lock(hashtext('derive_broker_dailies_key_fanout'))` — concurrent runs skip (`:229`).
- per-key `idempotency_key = 'derive-dailies-<api_key_id>-<UTC-date>'` (`:247`) + `EXCEPTION WHEN unique_violation THEN NULL` (`:250`) + the `compute_jobs_one_inflight_per_kind_api_key` index → one in-flight `derive_broker_dailies` per key per day.
`[VERIFIED: migration 20260717233529 STEP 4]`

### The rollback runbook (verbatim v1.11 recovery — reuse as FLIPRETRY-04 doc)
1. Delete in-flight/pending flip jobs: `DELETE FROM compute_jobs WHERE kind IN ('derive_broker_dailies','derive_allocator_equity') AND status IN ('pending','running');`
2. Empty the derived surface: `DELETE FROM allocator_equity_derived;` (0 curves ever shown; the TS flip degrades to legacy on empty/absent — safe).
3. Unschedule the cron: `SELECT cron.unschedule('derive-allocator-key-dailies');`
Result: derived path DORMANT, prod renders legacy. `[VERIFIED: STATE.md lines 54; matches migration objects]`

## §5 — The sFOX-F5 Fold

Phase 120 deferred item **F5** (`.planning/phases/120-.../deferred-items.md:28-36`): the sFOX transactions crawl (`SfoxClient` 1 req/10s on `/v1/account/transactions`) deterministically exceeds the `wait_for(300s)` bound for ACTIVE accounts (>~30 pages / ~30k rows) → transient retry → failed. The `wait_for` PREVENTS the wedge (recovers cleanly) but an active algo account can't be crawled inline on the sequential worker. **F5 explicitly says: "This is the same class FLIPRETRY-02 solves … Fold the sFOX reconstruction crawl into the Phase-123 batched-worker architecture."** `[VERIFIED]`

**Minimal fold (don't over-couple):** the sFOX crawl already IS a `venue='sfox'` branch of `run_derive_broker_dailies_job` and already has its FLIPRETRY-01 `wait_for`. Because the FLIPRETRY-02 dedicated worker processes the `derive_broker_dailies` kind (ALL venues), the sFOX active-account crawl rides onto the batched worker for FREE — no separate integration. The dedicated worker gives it either wall-clock room (larger bound off the prod loop) or the natural home for a future transactions-cursor incremental sync. **Note the integration; do not build sFOX-specific batching.** The sFOX spine code (118–122) stays untouched.

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `allocator_equity_derived` — currently EMPTY (emptied at v1.11 recovery); repopulated by the backfill. `compute_jobs` — flip jobs deleted at recovery. | Data migration = the founder-gated backfill enqueue. No code data-migration needed (curves regenerate). |
| Live service config | **pg_cron `derive-allocator-key-dailies`** — UNSCHEDULED live at recovery; the repo migration `20260717233529` STILL contains the schedule, so live pg_cron state and git DIVERGE. Re-scheduling is a live op (founder) or a new forward migration. | Founder-gated `cron.schedule(...)` OR a new migration, AFTER 01/02/04. |
| OS-registered state | Railway worker service(s). A NEW dedicated batched worker service (FLIPRETRY-02 Option A) is an OS/platform registration. | Founder deploys the 2nd Railway service + sets its kind-filter env. |
| Secrets/env vars | `E2_GROUND_TRUTH_API_KEY` / `_API_SECRET` / `_PASSPHRASE` (read-only key, Railway) — needed only for the founder E2 run. `SFOX_CRAWL_TIMEOUT_S` (exists, default 300); a new analog constant for the deribit/ccxt bound is code-only. | Founder sets `E2_GROUND_TRUTH_*` for the live run; no key rename. |
| Build artifacts / installed packages | None — pure Python + SQL + TS changes; no package installs. | None. |

**Nothing found beyond the above** — verified by grepping `supabase/`, `analytics-service/`, `src/` for cron/enqueue/derived references.

## Common Pitfalls

### Pitfall 1: Wrapping the wrong pipeline
**What goes wrong:** Wrapping only `equity_reconstruction.py` reconstruct/refresh (the CONTEXT-named sites) leaves the ACTUAL wedge crawl (`build_deribit_native_ledger` in `derive_broker_dailies`) unbounded — the flip wedges again.
**How to avoid:** Wrap `run_derive_broker_dailies_job`'s deribit + ccxt branches FIRST (load-bearing). Wrap the reconstruct path defensively.
**Warning sign:** The re-enqueue still stalls the worker on a deribit/bybit key.

### Pitfall 2: Trusting `wait_for` alone against event-loop starvation
**What goes wrong:** `asyncio.wait_for` cannot cancel a non-yielding (sync/CPU) await; its own timer can't fire on a frozen loop. Per-crawl bounding is necessary but NOT sufficient on the shared worker.
**How to avoid:** §2 dedicated worker is mandatory — it is the only structural guarantee for the prod loop's healthz.

### Pitfall 3: Long outer budget masquerading as a freshness guard
**What goes wrong:** `dispatch()` already wraps handlers in `wait_for(TIMEOUT_PER_KIND[kind])`, but `derive_broker_dailies`=15 min ≫ 90s healthz threshold. Assuming this protects liveness is the exact v1.11 error.
**How to avoid:** The per-crawl bound must be ≪ 90s×N-safe on the dedicated worker, and `LAST_TICK_AT` should refresh per-job.

### Pitfall 4: Self-referential E2 oracle (P115)
**What goes wrong:** Validating `is_trustworthy` with the compose module's own formula pins the bug.
**How to avoid:** Keep the E2 harness on the independent `deribit_ground_truth` scrub/assert contract + the 2% live-anchor tolerance; the fixture test must assert economics (anchor drift), not re-call the compose formula.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (Python) | pytest (analytics-service; `--cov-fail-under=80`) |
| Framework (TS) | vitest (thresholds lines 82 / stmts 80 / fns 74 / branches 72) |
| Quick run (Python) | `cd analytics-service && python -m pytest tests/test_job_worker.py tests/test_main_worker.py tests/test_health.py -x` |
| Quick run (TS) | `npx vitest run src/lib/queries.test.ts` (or the derived-curve test file) |
| Full suite | `cd analytics-service && python -m pytest` ; `npx vitest run` |

### Phase Requirements → Test Map (all validatable WITHOUT prod)
| Req | Behavior | Test Type | Automated Command | Exists? |
|-----|----------|-----------|-------------------|---------|
| 01 | A hung crawl → bounded `TimeoutError` → transient FAILED (not a wedge) | unit | `pytest tests/test_job_worker.py -k "timeout or wait_for or flipretry"` (mock `build_deribit_native_ledger`/`fetch_ccxt_transfers` to `await asyncio.sleep(9999)`; assert `DispatchResult(FAILED, error_kind="transient")` within the bound) | ❌ Wave 0 (mirror the sFOX timeout test) |
| 01 | `classify_exception(TimeoutError) == ("transient", ...)` | unit | `pytest tests/test_job_worker.py -k classify` | ✅ likely exists |
| 02 | The batched/dedicated claim does not starve `LAST_TICK_AT`; a slow job doesn't freeze the tick | unit | `pytest tests/test_main_worker.py -k "tick or healthz or dispatch"` (assert `LAST_TICK_AT` refreshed; assert kind-filter excludes backfill on the prod claim) | ❌ Wave 0 |
| 02 | Watchdog headroom invariant for any new/changed kind | unit | `pytest tests/test_main_worker.py -k watchdog` | ✅ exists (`test_every_kind_has_watchdog_headroom`) |
| 03 | Fixture anchor pass → `is_trustworthy=true` → `extractTrustworthyDerivedCurve` returns curve (derived); fail → null (legacy) | unit | `npx vitest run -t extractTrustworthyDerivedCurve` + `pytest tests/test_e2_ground_truth_harness.py` | ✅ TS + Python helpers exist; add pass/fail fixture |
| 03 | E2 verdict gates on `is_trustworthy`, scrubs evidence | unit | `pytest tests/test_e2_ground_truth_harness.py` | ✅ exists |
| 04 | healthz 503 past `STALE_THRESHOLD`; 200 within | unit | `pytest tests/test_health.py` | ✅ exists (extend for per-job refresh) |
| 04 | Enqueue idempotency (advisory lock + unique_violation swallow) | SQL/db | `supabase/tests/test_*.sql` fan-out re-run yields no duplicate in-flight | ❌ Wave 0 (db-test project) |

### Founder-gated live legs (carried by committed harness + fixtures)
- LIVE `E2_GROUND_TRUTH` run (needs `E2_GROUND_TRUTH_*` read-only key) — exit 0 before go-live.
- Prod backfill enqueue (`SELECT enqueue_derive_broker_dailies_for_allocator_keys();` or a bounded manual enqueue).
- Cron re-schedule (`cron.schedule('derive-allocator-key-dailies','30 5 * * *', ...)`).
- Dedicated Railway worker deploy + kind-filter env.

### Wave 0 Gaps
- [ ] `tests/test_job_worker.py` — deribit + ccxt crawl `wait_for` timeout tests (mirror the sFOX FLIPRETRY-01 test).
- [ ] `tests/test_main_worker.py` — kind-filter claim excludes/includes backfill kinds; per-job `LAST_TICK_AT` refresh.
- [ ] TS test — `extractTrustworthyDerivedCurve` pass/fail fixture asserting derived↔legacy.
- [ ] `supabase/tests/test_*.sql` — fan-out idempotency (no duplicate in-flight on re-run).

## Security Domain

This is an internal worker refactor — no new external attack surface. Relevant controls (all already present, must be preserved):
| Concern | Control | Status |
|---------|---------|--------|
| V6 Cryptography / credential leakage in crawl errors | `scrub_freeform_string` on all crawl exception logs; never `logger.exception` (HMAC-in-URL leak, H-3) | preserve at new `wait_for` catch sites |
| Ground-truth evidence sanitization (P115) | `assert_sanitized`/`sanitize_evidence` (deribit contract) in the E2 harness | preserve |
| Least-privilege for the E2 live read | `E2_GROUND_TRUTH_*` is a READ-ONLY exchange key | founder-provisioned |
| RPC exposure | `enqueue_derive_broker_dailies_for_allocator_keys` REVOKEd from PUBLIC/anon/authenticated (cron/service-role only) | verified in migration |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 300s per-crawl bound fits the deribit-inception + bybit-19k crawls with headroom under the 15-min outer budget | §1 | Too tight → healthy active accounts always time out (the F5 failure mode); too loose → slower wedge recovery. Verify against a real crawl duration in the founder run. |
| A2 | The runtime display gate stays the persisted `is_trustworthy` flag; the E2 run is a founder-gated PRE-flight, not a per-request live call or a new persisted column | §3 | If the founder wants a hard runtime E2 marker, add `e2_verified_at` + extend `extractTrustworthyDerivedCurve` (exceeds CONTEXT). |
| A3 | FLIPRETRY-02 Option A (dedicated worker + kind-filtered claim) is the intended "own worker"; a new claim RPC arg `p_kind_filter` is acceptable | §2 | If the founder prefers priority='low' + shared worker, the healthz guarantee weakens to "bounded but shared". |
| A4 | The load-bearing crawl to wrap is `derive_broker_dailies` (job_worker.py), not the CONTEXT-named `equity_reconstruction` reconstruct/refresh | §1, Open Q1 | Wrapping only the reconstruct path leaves the real wedge crawl unbounded. Mitigated by wrapping BOTH. |

## Open Questions

1. **Scope: which pipeline does FLIPRETRY-01 target?** (HIGH importance)
   - What we know: the `derive-allocator-key-dailies` cron fans out `derive_broker_dailies`; the "deribit native ledger ~inception" crawl in the STATE root cause lives in `run_derive_broker_dailies_job` (`build_deribit_native_ledger`, `:2319`), and the reconstruct path SKIPS deribit (`:2084`). The sFOX FLIPRETRY-01 wrap is already IN `derive_broker_dailies`.
   - What's unclear: CONTEXT explicitly names `equity_reconstruction.py` reconstruct/refresh (:2070/:2367).
   - Recommendation: Treat `derive_broker_dailies` (deribit + ccxt branches) as the PRIMARY, load-bearing FLIPRETRY-01 target; wrap the `equity_reconstruction` crawls defensively too. Have the planner confirm scope explicitly so no crawl is missed.

2. **Does the prod worker need a kind-EXCLUDE, or is a separate queue simpler?** The dedicated-worker design needs the prod worker to NOT claim backfill kinds. A `p_kind_filter`/`p_kind_exclude` arg on `claim_compute_jobs_with_priority` is the minimal change; confirm the planner is comfortable touching the claim RPC (it's a hot path with a fencing/priority contract).

## Sources

### Primary (HIGH confidence — codebase, verified this session)
- `analytics-service/main_worker.py` — single-loop topology, `dispatch_tick` sequential batch, `LAST_TICK_AT` at :498, watchdog overrides.
- `analytics-service/main_worker_healthz.py` — `STALE_THRESHOLD=90.0`, 503 mechanics.
- `analytics-service/services/job_worker.py` — `dispatch()` (:6581, `wait_for(handler)` :6661), `TIMEOUT_PER_KIND` (:281), sFOX FLIPRETRY-01 (:2638-2698), deribit cash pass (:2319) + MTM wrap (:2472), ccxt branch (:2880), `classify_exception` (:351).
- `analytics-service/services/equity_reconstruction.py` — `_fetch_and_price_window` (:1633), crawl pagination (:587/:632), `_fetch_current_equity` (:1924), reconstruct (:2070) + refresh (:2367).
- `analytics-service/services/allocator_equity_compose.py` — `is_trustworthy` write (:238).
- `analytics-service/scripts/e2_allocator_ground_truth.py` + `tests/test_e2_ground_truth_harness.py` — the independent anchor-consistency oracle.
- `src/lib/queries.ts` — `extractTrustworthyDerivedCurve` (:2379), `derivePhase07Fields` producer (:2505-2518).
- `supabase/migrations/20260717233529_allocator_equity_derived_surface.sql` — kind, fan-out (STEP 4), cron (STEP 5).
- `supabase/migrations/20260428120836_compute_jobs_priority.sql` — priority semantics.
- `.planning/phases/120-.../deferred-items.md` — F5 fold.
- `.planning/STATE.md` — v1.11 rollback root cause + recovery (the spec).

## Metadata

**Confidence breakdown:**
- Crawl-site inventory (§1): HIGH — every await located and status confirmed; sFOX mirror already landed.
- Worker topology + healthz root cause (§2/§4): HIGH — read the full loop + healthz source.
- Ground-truth wiring (§3): HIGH on current mechanics; one design choice (A2) marked ASSUMED.
- FLIPRETRY-02 mechanism (§2): MEDIUM — Option A recommended but the kind-filter claim RPC is a new surface (A3).

**Research date:** 2026-07-19
**Valid until:** ~2026-08-18 (30 days — stable internal codebase; re-verify if the worker/claim RPC changes)
