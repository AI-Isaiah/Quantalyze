# Phase 115 — STITCH-02 Store-Retirement Deferral Record

**Recorded:** 2026-07-17 (Wave 0, plan 115-01)
**Requirement:** STITCH-02 (retire the per-key first-writer-wins TWR reconstruction store)
**Verdict source:** `115-RESEARCH.md` §1 "THE SCOPE GATE — Reader Census" (whole-repo grep, file:line cited) + coordinator phase split (roadmap L179 + L199).

---

## (a) VERDICT

**The reader census did NOT clear. The `allocator_equity_snapshots` STORE RETIREMENT is DEFERRED. Ship the ADDITIVE derivation core only.**

Nothing in Phase 115 deletes, stops, or repoints away from:
- `analytics-service/services/equity_reconstruction.py` (the file, its builder, or `_compute_daily_equity`)
- its writer jobs (`run_reconstruct_allocator_history_job`, `run_refresh_allocator_equity_daily_job`)
- the `allocator_equity_snapshots` table
- the pg_cron daily fan-out (`enqueue_refresh_allocator_equity_for_all`, migration 070:382)
- the deribit carve-out (`equity_reconstruction.py:2084` hard-fail; refresh-skip at L2430)
- the `compute_twr` METHOD (live dep — see the ledger below)

Phase 115 ships STITCH-01/03/04/05/06 as an **additive** per-key dailies blend + $-equity layer path in `analytics-service`, leaving the legacy store as the SOLE writer of `allocator_equity_snapshots` and per-symbol `breakdown`. Two-writers hazard (Pitfall 5) is avoided: the new path never writes the legacy table.

Two independent blockers make the census fail (either alone is decisive):
1. **Reader side** — three live consumers depend on the per-SYMBOL `breakdown` column that the per-KEY dailies blend structurally cannot produce (R1/R2/R3-partial below). Moving `match.py` would change score semantics (holding-granularity → key-granularity weights) — a product-visible change no one has approved.
2. **Writer side** — `_compute_daily_equity` (equity_reconstruction.py:807) is the ONLY per-symbol daily valuation in the system. Retiring the writer jobs starves R1/R2 on all future days. There is no dailies-pipeline substitute for `breakdown`.

Additionally the store has a live SQL enqueue surface + `compute_job_kinds` check constraints pinned across ≥4 migrations — retirement is a migration project, not a Python edit.

---

## (b) RESIDUAL-BLOCKER LEDGER (follow-up census; stands alone)

Transcribed from `115-RESEARCH.md` §1 so the retirement can be planned without re-running the census.

### Store readers (block the table DROP / job retirement)

| # | Reader | What it reads | Verdict |
|---|--------|---------------|---------|
| **R1** | `analytics-service/routers/match.py:586` `_load_holding_portfolio_context` | `asof, breakdown` → `reconstruct_symbol_returns(snapshots, symbol)` per holding → warm-up gate (≥30 pts) → per-holding pseudo-strategy series + value-weights → `score_candidates` | **HARD BLOCKER** — dailies are per-KEY; breakdown is per-SYMBOL. Moving = re-basing composition math (weights per holding → per key) = product-visible score changes. Not a mechanical migration. |
| **R2** | `src/app/(dashboard)/compare/lib/holding-compare-adapter.ts:153` | `asof, breakdown, pre_terminus_balance_unknown` → per-symbol `reconstructAndAnalyze` for holding-vs-strategy compare | **HARD BLOCKER** — same per-symbol dependency + TS scope. |
| **R3** | `src/lib/queries.ts:2583` `getMyAllocationDashboard` | `asof, value_usd, breakdown, source, history_depth_months, pre_terminus_balance_unknown` (≤730 rows) — $-curve + AUM + warm-up copy | **PARTIAL** — the $-curve/AUM part is exactly what STITCH-03/04 rebuilds (repointed in Phase 115.1). `breakdown` / `history_depth_months` / `source` provenance have no dailies equivalent → table stays. |
| R4 | `src/lib/factsheet/allocator-portfolio-payload.ts:77` | AUM computed from `value_usd` | Follows R3. |
| **R5** | `src/lib/gdpr-export-manifest.ts:618,962` + `scripts/check-gdpr-export-coverage.ts:324-333` | Table in the GDPR export manifest (user-owned via `allocator_id`, no FK cascade) | **Blocks table DROP** — deletion requires manifest + `sanitize_user` audit. |
| **R6** | SQL enqueue surface: migration 076 `request_allocator_holdings_sync` (first-connect per-key enqueue); `20260422101911:258,351` (reconnect re-enqueue of BOTH kinds); migration 070:314-382 `enqueue_refresh_allocator_equity_for_all` + **pg_cron schedule at 070:382** | Enqueues `reconstruct_allocator_history` / `refresh_allocator_equity_daily` | **Blocks job retirement** — retirement = SQL migration to unschedule cron + drop enqueues + prune `compute_job_kinds` CHECK constraints (pinned in ≥4 migrations: 20260522111858, 20260614120000, 20260710130000, 20260624120100). |
| R7 | `services/job_worker.py:5844-5849` dispatch + `:256-257` timeout table | Dispatches the two jobs | Trivial once R6 lands — deferred with it. |
| R8 | `services/audit.py:217-230` | Audit action taxonomy (`allocator.equity.*`, 10 actions, already in prod) | Cosmetic, retires with jobs. |
| R9 | `analytics-service/scripts/*` (14 files) + Railway one-offs | ZERO import `equity_reconstruction` / read `allocator_equity_snapshots` (grep-verified) | **CLEAR** |
| R10 | `e2e/` + `supabase/tests` | No live readers (grep clean) | **CLEAR** |

**Writer-side monopoly (decisive):** `_compute_daily_equity` (equity_reconstruction.py:807) is the SOLE producer of per-symbol `breakdown`. Stopping the writer jobs → R1/R2 starve on all future days.

### Same-FILE consumers (make FILE deletion impossible regardless of the store verdict)

| # | Consumer | Uses | Note |
|---|----------|------|------|
| **F1** | `routers/process_key.py:983` + `services/ingestion/long_fetch.py:391` → adapters | `EquityCurveBuilder(trades).to_metrics_snapshot()` → `self.compute_twr()` (L2972) | **LIVE unified key-submission verification flow** (Phase 106 Stage B permanent-on). |
| **F2** | `services/job_worker.py:1792` | `_fetch_ohlcv_daily`, `_fetch_coingecko_daily_closes`, `_cache_coingecko_prices`, `_read_cached_prices` — the ONE price-fetch path for ccxt flow valuation | Shared infra hosted in the file. |
| **F3** | `routers/match.py:54` | `reconstruct_symbol_returns` (pure fn over snapshot rows) | R1's helper. |
| **F4** | `tests/test_e1_delete_gate.py:139` | `import services.equity_reconstruction as eqr_mod` (Part A hasattr) | **FILE deletion would ImportError the permanent P114 gate.** |

**`compute_twr` METHOD deletion is ALSO DEFERRED.** It is live (F1) and its deletion requires re-routing `to_metrics_snapshot`'s TWR onto a backbone-derived equivalent first (mirror of 114-02), guarded by its own micro-oracle (§5 endpoint-ratio vs `prod(1+r)-1` day-0/masked-day divergence). The P114 delete-gate exemption is allowed-but-not-required (≤ against the exemption set), so KEEPING the method is gate-green with zero gate edits. Not a Phase-115 drive-by.

---

## (c) BACKBONE MAPPING (BACKBONE-02 SPLIT / BACKBONE-03 deferred)

| Requirement | Disposition | Where it ships |
|-------------|-------------|----------------|
| **BACKBONE-02** | **SPLIT** | **Derivation CORE = Phase 115 (THIS phase, plans 02–05):** canonical Python per-key blend (STITCH-01), $-equity backward-replay + ONE unified cashflow ledger + seam rule (STITCH-03/04/05/06) as pure core, independent parity oracle + ground-truth script. **Frontend $-equity DISPLAY-REPOINT + worker-side real-flow crawl = Phase 115.1 (roadmap L199).** |
| **BACKBONE-03** | **DEFERRED (gate did not clear)** | Store retirement (`allocator_equity_snapshots` DROP + job/cron/constraint teardown) stays deferred pending the residual census above (R1/R2/R3-partial/R5/R6 + writer monopoly). The BACKBONE-03 **else-branch** (census failed → display-repoint ships, store stays) is Phase 115.1, NOT "deferred to 116/117". |

**Phase 115.1 (NEW, roadmap L199 — SCHEDULED, not deferred):** worker-side flow-aware allocator $-equity derivation onto a **NEW keyed surface** (never legacy `allocator_equity_snapshots` — two-writers hazard, Pitfall 5) + repoint `queries.ts` `equityDailyPoints` / `EquityCurve`+`DrawdownChart` off legacy `value_usd` onto it. Depends on the Phase-115 derivation core; needs the worker-side real-flow crawl. Fulfills the BACKBONE-03 else-branch.

**All-deribit dogfooding gap — PATH PROVEN + PINNED (plan 04); DATA GAP REMAINS.** The concrete existing-consumer problem: deribit allocator keys currently produce NO per-key `csv_daily_returns`, so the EXISTING Phase-36 frontend blend renders nothing for all-deribit allocators (the legacy store hard-fails deribit → they get nothing at all today). Plan 04's derivation path (deribit allocator keys → per-key `csv_daily_returns` the existing blend picks up) is additive, independent of the store retirement, and is proven + pinned by the plan-04 fixture gates. It is NOT operationally closed: the data gap remains until (a) the approval-gated per-key backfill actually runs on prod (`scripts/phase35_backfill_enqueue`, still a pending, approval-gated action per §(d) — prod counts were not read in auto mode) AND (b) a RECURRING key-mode enqueue exists so newly-synced deribit keys keep producing per-key rows. Until both land, all-deribit allocators still render nothing in prod. Honest operative record: path proven + pinned; data gap open.

---

## (d) A1 COVERAGE TABLE (per-key `csv_daily_returns` for eligible allocator keys)

**Eligible predicate** (phase35_backfill_enqueue.py, role-agnostic):
`is_active = true AND sync_status IS DISTINCT FROM 'revoked' AND disconnected_at IS NULL`.
Restricted to **allocator-owned** keys (`profiles.role in ('allocator','both')`).
**COUNTS ONLY** — no balances / NAV / flow USD read (T-115-01 / T-73-02 discipline). Read-only.

### TEST project (`qmnijlgmdhviwzwfyzlc`) — run 2026-07-17

| venue | allocator keys | keys with 0 rows | min rows | max rows |
|-------|---------------:|-----------------:|---------:|---------:|
| binance | 152 | 152 | 0 | 0 |
| deribit | **364** | **364** | 0 | 0 |
| okx | 1 | 1 | 0 | 0 |
| **TOTAL** | **517** | **517** | 0 | 0 |

- Eligible keys (predicate, role-agnostic): **829**; eligible ALLOCATOR keys: **517**.
- `csv_daily_returns` total rows on TEST: **560** — but **ALL 560 are strategy-scoped** (`strategy_id` not null, `api_key_id` NULL). **Zero** rows carry an `api_key_id` → **no per-key allocator coverage on any venue**.
- **>>> DERIBIT allocator keys with 0 per-key rows: 364 / 364** (sizes plan 04 on TEST).

TEST is seed data (all 829 keys active/connected, none disconnected) so the numbers reflect seed fixtures, not real dogfooding — but they confirm the mechanism: allocator keys (incl. all 364 deribit) have **no** per-key `csv_daily_returns`, so the Phase-36 blend has nothing to render until plan 02/04 land.

### PROD project (`khslejtfbuezsmvmtsdn`) — NOT YET RUN (approval required)

The plan intended this via Supabase MCP. MCP tools are not callable from the executor (upstream strip), and the direct prod REST read (prod service-role key) was **denied by the auto-mode classifier** ("Production Reads" — prod target not pre-authorized). Recorded as a **pending, approval-gated action**, not silently skipped (Rule 12).

**To complete:** run the same COUNTS-ONLY query on prod outside auto mode (or via approved Supabase MCP `execute_sql`). Exact query shape (read-only):
- eligible allocator keys per the predicate above, LEFT JOIN a per-`api_key_id` count of `csv_daily_returns` rows, `GROUP BY exchange`; record total + per-venue keys, keys-with-0-rows per venue (esp. **deribit-with-0-rows**), min/max.

Plans 02 and 04 should read the prod deribit-with-0-rows number once this run lands. If prod eligible keys have 0 rows, the remediation is an **execute-time decision** (do NOT run here):
`railway ssh "cd /app && python -m scripts.phase35_backfill_enqueue"` (enqueues per-key `derive_broker_dailies` for every active connected key).

---

*A1 script (read-only, counts-only): captured in the plan-01 execution scratchpad; TEST numbers above are the durable record.*
