# Phase 115: E2 Allocator Equity Reconstruction (SCOPE-GATED, verify-first) - Research

**Researched:** 2026-07-17
**Domain:** analytics-service (FastAPI worker + pandas) — allocator equity derivation on the unified backbone
**Confidence:** HIGH (every claim below grepped/read in the live tree this session; file:line cited)

## Summary

**SCOPE-GATE VERDICT: the census does NOT clear — DEFER the physical store retirement; ship routing/derivation only.**

The per-key first-writer-wins TWR reconstruction store (`allocator_equity_snapshots`, written by `services/equity_reconstruction.py`) cannot be retired in this phase, for two independent reasons. (1) **Reader side:** three live consumers depend on the per-SYMBOL `breakdown` column — `routers/match.py:586` (`_load_holding_portfolio_context` → per-holding pseudo-strategy return series → `score_candidates`), `src/app/(dashboard)/compare/lib/holding-compare-adapter.ts:153`, and the dashboard payload (`src/lib/queries.ts:2583`, which also reads `value_usd`/`source`/`history_depth_months`/`pre_terminus_balance_unknown`). The dailies-blend-on-backbone path is per-KEY; it structurally cannot produce per-symbol series, so these readers cannot "move" — moving match.py would change score semantics (holding-granularity weights → key-granularity weights), a product-visible change no one has approved. (2) **Writer side:** nothing else produces `breakdown` — `_compute_daily_equity` (equity_reconstruction.py:807) is the only per-symbol daily valuation in the system, so even the writer arm can't be deleted without starving those readers on all future days. Additionally the store has a live SQL enqueue surface (pg_cron daily fan-out `enqueue_refresh_allocator_equity_for_all` scheduled in migration 070:382, the first-connect wrapper in migration 076, the reconnect re-enqueue in `20260422101911:258,351`) and `compute_job_kinds` constraints pinned across ≥4 migrations — retirement is a migration project, not a Python edit.

What the phase CAN and SHOULD ship (and this is exactly the CONTEXT's defer branch): route the allocator display derivation onto the per-key dailies blend (the infra already exists — key-mode `derive_broker_dailies` writes per-key `csv_daily_returns` rows for allocator keys, role-agnostically, and the frontend already blends them for curve SHAPE + KPIs per Phase 36), add the $-equity-curve layer (returns path + dated-cashflow ledger + current-equity anchor, backward per STITCH-04 — `nav_twr.py` already owns this exact convention), and the stitch-seam synthetic-flow rule. This closes the worst dogfooding finding — all-deribit allocators currently get NOTHING (`equity_reconstruction.py:2084` hard-fails deribit) while the dailies pipeline handles deribit natively.

**Primary recommendation:** Ship STITCH-01/03/04/05/06 as an ADDITIVE derivation path in analytics-service; leave the store and both its jobs running untouched; record the residual readers (below) as the follow-up census; optionally delete the `compute_twr` METHOD under its own micro-oracle (gate stays green either way — the exemption is allowed-but-not-required).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (founder-locked — STITCH-01..06)

**STITCH-01 — one pipeline.** Route the allocator's multi-key account through the SAME strategy dailies pipeline (windowed `strategy_keys` stitch → dailies → backbone), NOT the parallel per-key path. The allocator = a strategy + a current-holdings snapshot.

**STITCH-02 — retire the duplicate reconstruction (CENSUS-GATED).** Retire the per-key first-writer-wins TWR reconstruction (`equity_reconstruction.py`) + the deribit carve-out. KEEP the Dietz/MWR cashflow path (BACKBONE-01 — the backbone cannot reproduce it). ⚠️ The physical store deletion is GATED on the reader census (the scope gate). If the census does NOT clear, DEFER the store retirement and ship only the routing/derivation change.

**STITCH-03 — perf-curve ≠ equity-curve.** Perf-curve (TWR, cashflow-neutral) ≠ equity-curve ($, steps on deposits/withdrawals); equal ONLY with zero cashflows. Derive dailies FIRST, then layer the equity curve = return path + cashflow ledger.

**STITCH-04 — unknown start.** Unknown starting value → derive backward from current equity + the known return path.

**STITCH-05 — external cashflows.** Deposits/withdrawals handled via Modified-Dietz/MWR (the KEPT path).

**STITCH-06 — stitch-seam rule (⭐).** A window-boundary equity jump (key N last day → key N+1 first day) is treated as a SYNTHETIC deposit/withdrawal through the SAME Dietz/MWR ledger — TWR stays clean across the seam, equity reflects the real jump. Windowed stitch and cashflow accounting are ONE code path.

### Claude's Discretion
Implementation mechanics (how the ledger is threaded, function boundaries) at Claude's discretion within the STITCH contract and codebase conventions. The frozen TypeScript `scenario.ts` engine is NOT touched.

### Deferred Ideas (OUT OF SCOPE)
- If the reader census does NOT clear: DEFER the physical store deletion; ship only the routing/derivation change + leave the store in place behind the new path. Record the residual readers as follow-up. ← **This branch is now ACTIVE (census did not clear).**
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| STITCH-01 | Allocator multi-key account through the same strategy dailies pipeline | §4: key-mode `derive_broker_dailies` already writes per-key `csv_daily_returns` for allocator keys (job_worker.py:1869-1917, "role-agnostic" per phase35_backfill_enqueue.py); reuse the per-key derive entry points exactly as `run_stitch_composite_job` does (job_worker.py:3360). ⚠️ concurrent keys = weighted BLEND, not the overlap-guarded stitch core (Landmine L1) |
| STITCH-02 | Retire reconstruction store — CENSUS-GATED | §1: census does NOT clear → DEFER store retirement. Residual-reader table recorded. Optional severable sub-scope: `compute_twr` METHOD deletion via re-route (§5, gate-green either way) |
| STITCH-03 | Perf-curve ≠ equity-curve; dailies first, then $-layer | §3: expressible — per-key returns already persisted (`csv_daily_returns`); dated-flow ledger exists (`ccxt_flows.ccxt_rows_to_dated_flows`, deribit native ledger); `nav_twr.py` owns the NAV/flow convention |
| STITCH-04 | Unknown start → backward from current equity | §3/§5: `nav_twr.py` L776 `reconstruct_nav_and_twr` already implements `NAV_{t-1} = NAV_t - pnl_t - F_t` backward chaining with fail-loud denominators; anchors available (`_fetch_current_equity` eq_rec.py:1924, `fetch_deribit_native_account_state`, api_keys balance seed exchange.py:215/cron.py:394) — all advisory/fallible → honest degradation required |
| STITCH-05 | External cashflows via Dietz/MWR (KEPT path) | §3: `compute_mwr`/`compute_modified_dietz` are KEPT but currently DORMANT (zero production call sites). The REAL flow machinery is the nav_twr dated-flow ledger. STITCH-05 = flows enter ONE dated ledger; Dietz/MWR are scalar consumers of that ledger |
| STITCH-06 | Seam jump = synthetic flow through the same ledger | §3: the dated-flow ledger `(utc_day_iso, usd_signed)` shape (ccxt_flows) accepts synthetic entries verbatim; TWR-side neutrality is automatic (stitch operates on returns, already flow-neutral) |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- Coverage is a blocking CI gate (vitest thresholds; Python `--cov-fail-under=80`; analytics suite currently 89.00% per P114). New Python modules must carry tests.
- Root-cause obsession, fail loud, tests verify intent; every found bug gets a regression test that fails without the fix.
- Test the WIRING, not just the helper (memory: guard each call site, prove it fails when neutered).
- Commit via /ship, feature branch + PR; never bundle commit with edits.
- Banned packages list — irrelevant here (no new packages).
- DB tests that gate must be `supabase/tests/test_*.sql`; `*_live.py` never runs in CI.
- Account-size leak discipline: never log raw NAV/flow USD (T-73-02, enforced in nav_twr.py).
- Worker-only key decryption LOCKED: only `_allocator_key_preflight` decrypts (job_worker).
- CI is Node22/python serial; local vitest flakes → `--no-file-parallelism` (TS side unlikely touched).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Per-key daily-return derivation | analytics-service worker (job_worker key-mode) | — | Already exists; single owner of exchange fetch + derive |
| Per-key → allocator blend (perf-curve) | analytics-service (new, this phase) | Frontend has a Phase-36 TS blend (queries.ts:2096-2130) for Overview shape | Python must own the canonical blend so match/factsheet/UI converge; TS blend is a display-era stopgap |
| $-equity-curve layering (returns + flows + anchor) | analytics-service (new, this phase) | — | Needs exchange flow data + anchor; server-only |
| Cashflow ledger (real + synthetic seam flows) | analytics-service (`ccxt_flows` shape) | — | STITCH-06: ONE code path |
| Per-symbol breakdown production | `equity_reconstruction._compute_daily_equity` (UNCHANGED) | — | Sole producer; retirement deferred |
| Match scoring inputs | `routers/match.py` (UNCHANGED this phase) | — | Stays on snapshots.breakdown; parity gate pins it |
| Dashboard display repoint | Frontend (queries.ts / AllocationDashboardV2) | — | Planner decides whether the repoint lands in 115 or 116/117; scenario.ts is FROZEN either way |

## 1. THE SCOPE GATE — Reader Census (go/no-go)

The "store" = the allocator arm of `services/equity_reconstruction.py`: `run_reconstruct_allocator_history_job` (L2070) + `run_refresh_allocator_equity_daily_job` (L2367) + `persist_equity_snapshots` (L1271, `upsert on_conflict='allocator_id,asof', ignore_duplicates=True` — THE first-writer-wins) + `replace_equity_snapshots`/`_purge` (L1453-1560) + the deribit carve-out (L2084 hard-FAIL "Deribit reconstruction not supported"; refresh job skips deribit holdings at L2430) — writing `allocator_equity_snapshots` (migration `20260420213754`).

**Full census** (whole-repo grep: analytics-service services/routers/scripts, src/, supabase/, e2e — per the v1.10 whole-repo lesson):

| # | Reader | What it reads | Can move to dailies-blend? | Verdict |
|---|--------|--------------|---------------------------|---------|
| R1 | `analytics-service/routers/match.py:586` `_load_holding_portfolio_context` | `asof, breakdown` → `reconstruct_symbol_returns(snapshots, symbol)` (eq_rec.py:2593) per holding → warm-up gate (≥30 pts) → per-holding pseudo-strategy series + value-weights → `score_candidates` | **NO.** Dailies are per-KEY; breakdown is per-SYMBOL. Moving = re-basing portfolio composition math (weights per holding→per key) = score changes visible in match results. Not a mechanical migration | **HARD BLOCKER** |
| R2 | `src/app/(dashboard)/compare/lib/holding-compare-adapter.ts:153` | `asof, breakdown, pre_terminus_balance_unknown` → per-symbol `reconstructAndAnalyze` for holding-vs-strategy compare | **NO** — same per-symbol dependency, plus TS scope | **HARD BLOCKER** |
| R3 | `src/lib/queries.ts:2583` `getMyAllocationDashboard` | `asof, value_usd, breakdown, source, history_depth_months, pre_terminus_balance_unknown` (≤730 rows) — $-curve + AUM + warm-up copy | **PARTIALLY.** The $-curve/AUM part is exactly what STITCH-03/04 rebuilds. `breakdown`/`history_depth_months`/`source` provenance fields have no dailies equivalent | Partial — repoint the $-curve when the new derivation ships; table stays |
| R4 | `src/lib/factsheet/allocator-portfolio-payload.ts:77` | Comment-documented: AUM computed from `value_usd` | Follows R3 | Follows R3 |
| R5 | `src/lib/gdpr-export-manifest.ts:618,962` + `scripts/check-gdpr-export-coverage.ts:324-333` | Table in the GDPR export manifest (user-owned via `allocator_id`, no FK cascade) | N/A — must stay while table exists; deletion requires manifest + sanitize_user audit | Blocks table DROP |
| R6 | SQL enqueue surface: migration 076 `request_allocator_holdings_sync` (first-connect per-key enqueue), `20260422101911:258,351` (reconnect re-enqueue of BOTH kinds), migration 070:314-382 `enqueue_refresh_allocator_equity_for_all` + **pg_cron schedule at 070:382** | Enqueues `reconstruct_allocator_history` / `refresh_allocator_equity_daily` | N/A — retirement = SQL migration to unschedule cron + drop enqueues + prune `compute_job_kinds` check constraints (pinned in ≥4 migrations: 20260522111858, 20260614120000, 20260710130000, 20260624120100) | Blocks job retirement |
| R7 | `services/job_worker.py:5844-5849` dispatch + `:256-257` timeout table | Dispatches the two jobs | Trivial once R6 lands — deferred with it | Deferred |
| R8 | `services/audit.py:217-230` | Audit action taxonomy (`allocator.equity.*`, 10 actions, "already written in prod") | Actions retire with jobs; TS mirror carries them | Cosmetic, deferred |
| R9 | `analytics-service/scripts/*` (all 14 files) + Railway one-offs | **grep-verified: ZERO scripts import equity_reconstruction or read allocator_equity_snapshots** | — | **CLEAR** |
| R10 | e2e/ + supabase/tests | No live readers found (grep `allocator_equity_snapshots` in e2e: none) | — | **CLEAR** |

**Same-FILE (not same-store) consumers** — these live in `equity_reconstruction.py` but are NOT the store; they make FILE deletion impossible regardless of the store verdict:

| # | Consumer | What it uses | Note |
|---|----------|-------------|------|
| F1 | `routers/process_key.py:983` + `services/ingestion/long_fetch.py:391` → adapters (`ingestion/{binance,bybit,okx,deribit,csv_adapter}.py`) | `EquityCurveBuilder(trades).to_metrics_snapshot()` / `.reconstruct_positions()` | **LIVE unified key-submission verification flow** (Phase 106 Stage B permanent-on). `to_metrics_snapshot` (L3065) calls `self.compute_twr()` (L2972) |
| F2 | `services/job_worker.py:1792` | `_fetch_ohlcv_daily`, `_fetch_coingecko_daily_closes`, `_cache_coingecko_prices`, `_read_cached_prices` — the ONE price-fetch path for ccxt flow valuation (76-x Don't-Hand-Roll) | Shared infra hosted in the file |
| F3 | `routers/match.py:54` | `reconstruct_symbol_returns` (pure function over snapshot rows) | R1's helper |
| F4 | `tests/test_e1_delete_gate.py:139` | `import services.equity_reconstruction as eqr_mod` (Part A hasattr assertion) | **FILE deletion would ImportError the permanent gate** |

**Writer-side blocker (decisive):** `_compute_daily_equity` (L807) is the ONLY producer of per-symbol `breakdown`. Retiring the writer jobs stops breakdown production → R1/R2 starve on all future days. There is no dailies-pipeline substitute.

**CONCLUSION — census does NOT clear. DEFER the store retirement (STITCH-02 defer branch). Ship routing/derivation only. Residual blockers for the follow-up ledger: R1 (match per-symbol), R2 (compare per-symbol), R3-partial (breakdown/provenance fields), R5 (GDPR manifest), R6 (SQL enqueue + kind constraints + pg_cron), writer-side breakdown monopoly.**

The **deribit carve-out** (L2084/L2430) also survives in code this phase — but it becomes MOOT for the display once the allocator curve derives from dailies (the dailies pipeline handles deribit natively via `build_deribit_native_ledger` + `combine_native_ledger`). Do NOT delete the carve-out branch: the jobs keep running for non-deribit breakdown production, and a deribit key reaching the legacy job must keep failing loud rather than fabricating spot-gap data.

## 2. match.py Score Parity

**Exactly what match.py consumes** (verified read, match.py:533-680):
1. `allocator_holdings` (venue, symbol, holding_type, value_usd, asof) → latest-asof collapse per (venue,symbol,holding_type) — mirrors queries.ts holdingsMap.
2. `allocator_equity_snapshots` (asof, breakdown) ASC → `reconstruct_symbol_returns` per collapsed holding symbol: extract `breakdown[symbol]` per day, drop absent/zero (partial days = missing, never forward-filled), `pct_change().dropna()`, None if <2 points.
3. Warm-up gate: series with <30 daily returns excluded entirely (counted in `warm_up_dropped`).
4. Weights = `value_usd / total_eligible_value`; all-zero → equal-weight fallback.
5. Output feeds `score_candidates` (match_engine.py:802) — portfolio blend correlation/diversification math over `portfolio_returns` dict + `portfolio_weights` + `portfolio_aum`.

**Since the store is deferred, match.py's input path is UNCHANGED this phase — parity must hold trivially, and the gate exists to PROVE nothing regressed via shared-code edits** (e.g., if `reconstruct_symbol_returns` moves file, or `equity_reconstruction.py` internals shift).

**Parity assertion (define it as a golden, not a re-derivation):** for a fixed fixture (snapshot rows + holdings rows — extend `tests/test_match_integration_phase09.py` fixtures):
- (a) per-holding series: exact index equality + `pd.testing.assert_series_equal` (no tolerance — same code path must be byte-stable);
- (b) `portfolio_weights` dict exact-equal; `portfolio_aum` exact; `warm_up_dropped` count exact;
- (c) `score_candidates` full output structure (scores + components per candidate) golden-pinned (JSON golden file, exact compare — scores are deterministic given fixed inputs, ENGINE_VERSION/WEIGHTS_VERSION pinned).
Capture the golden BEFORE any Phase-115 edit lands (wave-0 task), assert GREEN after every wave.

## 3. Cashflow / Dietz-MWR Reality (design-meets-reality correction — read this, planner)

**⭐ The KEPT `compute_mwr`/`compute_modified_dietz` are DORMANT library functions, not a live ledger:**
- `compute_mwr` (portfolio_metrics.py:70): imported at `routers/portfolio.py:37` but **NEVER CALLED in production code** (whole-tree grep: zero call sites outside tests + the P114 KEEP-path smoke). The import is dead weight kept alive by the delete-gate's functional smoke.
- `compute_modified_dietz` (portfolio_metrics.py:155): **test-only** (test_e1_delete_gate.py:225, test_coverage_extras.py).
- Signatures: `compute_mwr(cash_flows: [{date, amount}], final_value, end_date) -> IRR`; `compute_modified_dietz(begin_value, end_value, cash_flows: [{amount, day}], period_days)`. Both accept a plain flow list — they can consume ANY ledger shape trivially.

**Where flows REALLY enter today (per key):**
- ccxt venues: `services/ccxt_flow_fetch.py` (`fetch_ccxt_transfers` — the ONE paginated deposits/withdrawals path, promoted verbatim from equity_reconstruction in Phase 76) → `services/ccxt_flows.ccxt_rows_to_dated_flows` → dated flows `(utc_day_iso, usd_signed)` — deposit positive, withdrawal negative (nav_twr.py:28-29).
- Deribit: transfers/deposits/withdrawals are rows in the native transaction ledger (`build_deribit_native_ledger`, deribit_ingest).
- These feed `nav_twr.reconstruct_nav_and_twr` (nav_twr.py:776) inside the key-mode derive: **backward NAV chain `NAV_{t-1} = NAV_t - pnl_t - F_t`** + chain-linked flow-neutral daily TWR + fail-loud denominator guards (dust/negative/flow-dominated, `FLOW_DOM_RATIO`=1.0) + DQ-02 flow-coverage terminus (a deposit older than venue retention SEGMENTS + flags rather than fabricating).

**How STITCH-05/06 map onto this (recommended interpretation):** "handled via Modified-Dietz/MWR (the KEPT path)" = all flows — real AND synthetic seam jumps — enter the ONE dated-flow ledger shape `(utc_day_iso, usd_signed)` that nav_twr already consumes; `compute_mwr`/`compute_modified_dietz` are then scalar CONSUMERS of that same ledger wherever an MWR display is wanted. TWR-side seam cleanliness is automatic: the per-key daily returns are already flow-neutral (nav_twr chain-links flows out), and blending/stitching operates on returns. The equity-curve layer replays the ledger: seam day gets a synthetic flow = (key N+1 first equity − key N last equity) so the $ curve steps while TWR does not. **STITCH-06's "one code path" is satisfiable by construction: synthetic seam entries are appended to the same flow list before both the $-replay and any Dietz/MWR scalar.**

**STITCH-03 expressibility on the existing pipeline: YES.** Per-key daily returns are already persisted (`csv_daily_returns` — schema is `(strategy_id|api_key_id+allocator_id, date, daily_return)` per migrations 20260522111839 + 20260614120000 + 20260624120100 dual-target; **no NAV column** — the $ curve is NOT persisted anywhere on the dailies path and must be computed by the new layer). Perf-curve = blend of per-key flow-neutral returns; equity-curve = per-key NAV replay (anchor + returns + flows) summed across keys.

## 4. `strategy_keys` Windowed Stitch Reuse (STITCH-01)

**The v1.9 path exists and is production:** `services/stitch_composite.py` (pure core: `clip_to_window` half-open `[start,end)`, `assert_windows_disjoint`, `stitch_clipped_series`, `coverage_mask`, `mark_to_market_available`) + `services/job_worker.py:3360 run_stitch_composite_job` (fans over `strategy_keys` ORDER BY seq, reconstructs each member via **the SAME per-key entry points the single-key derive uses** — `build_deribit_native_ledger`+`combine_native_ledger` for deribit, `combine_realized_and_funding` for ccxt — then metrics ONCE via `derive_basis_series`/`compute_all_metrics`).

**The allocator is ALREADY on the per-key half of this shape:** key-mode `derive_broker_dailies` (job_worker.py:1869-1917: `is_key_mode = bool(job.get("api_key_id"))`, upsert keyed `(api_key_id, date)` with denormalized `allocator_id` from `api_keys.user_id`) — explicitly **role-agnostic** ("the per-key axis is key-identity, not role-identity", scripts/phase35_backfill_enqueue.py:17). The frontend already blends these per-key rows for the Overview curve shape + KPIs (queries.ts:2096-2130, D1 blend unit = api_key_id, weighted by each key's current equity; D3: blend used IFF every active key has a non-empty series).

**Cite-able reuse points for the planner:**
- Per-key series: read `csv_daily_returns` by `allocator_id` (RLS `allocator_id = auth.uid()` for user reads; service-role in worker) — no new derivation needed for keys that have rows.
- Composition-at-metrics: `services/metrics.py compute_all_metrics` (L398) + `total_return_from_equity` (L1240) + `sharpe_vol_status_from_backbone` (L1298) — the P114 helpers.
- Seam/window semantics: `tests/fixtures/window_overlap_convention.json` is THE shared overlap spec.

**⚠️ Landmine L1 — "windowed stitch" does not literally apply to concurrent keys.** `stitch_clipped_series` RAISES `CompositeOverlapError` on any post-clip day present in >1 series (two-layer fail-loud guard, by design). An allocator with two live exchange keys has fully OVERLAPPING coverage — the correct composition for concurrent days is the capital-weighted BLEND (the Phase-36 TS blend is the semantic precedent), not the disjoint-window stitch. The windowed stitch + STITCH-06 seam rule apply to SEQUENTIAL coverage segments (key rotation / disconnect→reconnect). The plan must build the blend arm in Python and reserve the stitch/seam machinery for genuine coverage boundaries. Do not try to force allocator keys through `assert_windows_disjoint` — it will correctly refuse.

## 5. STITCH-04 Backward Derivation + P114 Delete-Gate Interaction

**Backward derivation: FEASIBLE, already implemented at the single-key level.** `nav_twr.reconstruct_nav_and_twr` walks `NAV_{t-1} = NAV_t - pnl_t - F_t` from a terminal anchor with dated flows — precisely STITCH-04. Anchor sources, all fallible-by-design:
- ccxt: `_fetch_current_equity` (equity_reconstruction.py:1924 — spot marked value + derivative uPnL, OKX special-cased via `fetch_okx_total_equity_usd`; returns `(None, …)` on failure — "advisory, not load-bearing"). NOTE: this helper lives in the deferred file — if reused by the new path, import it as-is (file survives) or promote it (mirror the Phase-76 `ccxt_flow_fetch` promotion pattern).
- Deribit: `fetch_deribit_native_account_state` (deribit_ingest).
- Cached fallback: `api_keys` balance seed written by `routers/exchange.py:215` / `routers/cron.py:394` (dogfooding: can be stale/misleading — treat as last resort with a staleness flag).
**Honest-degradation rule:** anchor unavailable → ship perf-curve WITHOUT a $-curve (no invented data), mirroring the existing "unanchored series rather than failing the whole job" semantics.

**Delete-gate interaction (verified in tests/test_e1_delete_gate.py):**
- The METHOD exemption is **allowed-but-NOT-required** (walk uses `≤` against the exemption set) → deleting `compute_twr` keeps the gate GREEN with zero gate edits; KEEPING it also stays green. Either end-state is safe.
- Part A does `import services.equity_reconstruction as eqr_mod` (L139) and asserts no MODULE-LEVEL twr attribute → **deleting the FILE breaks the gate with an ImportError; a module-level free `def`/alias of the twr symbol trips Part A+B**. Any refactor must keep the symbol either absent or a bound `self`-method inside that file.
- Part B additionally bans any line carrying BOTH `portfolio_metrics` and the twr token — the method's replacement must not import portfolio_metrics on the same line as the token (it shouldn't import it at all).
- **Live-dependency caution:** `compute_twr` is called by `to_metrics_snapshot` (L3081) inside the LIVE unified verification flow (process_key.py:983, long_fetch.py:391). Deleting the method therefore REQUIRES re-routing `to_metrics_snapshot`'s twr onto a backbone-derived equivalent first (mirror of 114-02). ⚠️ `total_return_from_equity` is ENDPOINT-RATIO; `compute_twr` is `prod(1+r)-1` over the builder's daily_return column — the P114 oracle proved these differ by the day-0 `(1+r_0)` factor in the backbone context. On the builder's own curve `prod(1+r)` equals `equity_last / starting_nav` only when the prev-equity chain is unbroken (the builder masks non-positive prev_equity to `starting_nav`, L2958-2962 — a masked day breaks exact equivalence). **Recommendation: make the method deletion its own gated sub-plan with a micro-oracle over builder fixtures (test_equity_curve_builder.py), or explicitly KEEP the method and record the exemption as retained** — both are gate-green; do NOT delete it as a drive-by.

## 6. Independent Golden-Parity Strategy (deribit_ground_truth.py pattern)

Pattern to copy (scripts/deribit_ground_truth.py): committed read-only one-off, `railway ssh "cd /app && python -m scripts.<name>"`, credentials via env only, proves read-only scope BEFORE fetching, whitelisted fields, single sanitized JSON to stdout, never writes prod tables, non-zero exit on any skip.

**⚠️ Landmine L4 — byte-parity vs the old store is IMPOSSIBLE for ccxt venues and must not be gated on.** The store's curve is holdings-MARK-based (`_compute_daily_equity`: positions × daily closes); the dailies path is realized+funding CASH-basis for ccxt keys (that's WHY `mark_to_market_available` gates MTM off for ccxt: "no mark-to-market basis concept"). These are different measures of the same account. A curve-shape parity gate between them will fail honestly. For deribit-only allocators there is NO store curve at all (the carve-out wrote nothing).

**Achievable and meaningful gates for a real allocator account (`scripts/e2_allocator_ground_truth.py`):**
1. **Anchor consistency (the equity number):** new derivation's terminal equity == live current equity from the exchange (per-key `_fetch_current_equity` / deribit account state), within same-day drift tolerance. This is the number the founder sees.
2. **Internal consistency:** new perf-curve TWR over the window == `compute_all_metrics` output on the blended series (no tautology: assert via an inline pandas re-derivation, the 114-01/111-01 oracle pattern); $-curve replay minus flows reproduces the return path day-by-day (`(equity_t - F_t)/equity_{t-1} - 1 == r_t` within float tolerance).
3. **Zero-cashflow equivalence pin (STITCH-03's own claim):** on a fixture with zero flows, perf-curve and normalized $-curve are IDENTICAL; on a fixture with one deposit, they diverge by exactly the flow step.
4. **Seam pin (STITCH-06):** fixture with key rotation — TWR across the seam equals the product of the two segments' TWRs (no seam return), $-curve steps by exactly the seam jump, and the synthetic entry appears in the same ledger the Dietz/MWR scalar consumes.
5. **match.py score parity (§2):** golden `score_candidates` output for the fixture allocator, exact — captured pre-phase, asserted post-phase (match path unchanged ⇒ must be byte-stable).
6. **Non-deribit sanity (NOT a gate):** capture old-store curve vs new curve for one ccxt allocator as EVIDENCE (documented divergence with reasons), not an assertion.

## Standard Stack

### Core (all already in the tree — no new dependencies)
| Library/Module | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| pandas / numpy | pinned in analytics-service requirements | series math | existing backbone |
| `services/metrics.py` | in-tree | `compute_all_metrics`, `total_return_from_equity`, `sharpe_vol_status_from_backbone` | THE backbone (BACKBONE-01) |
| `services/nav_twr.py` | in-tree | NAV/flow backward chain + guards | already owns STITCH-04's math |
| `services/ccxt_flows.py` + `ccxt_flow_fetch.py` | in-tree | dated-flow ledger shape + the ONE transfer fetch | Don't-Hand-Roll (Phase 76) |
| `services/stitch_composite.py` | in-tree | window clip/overlap/coverage-mask vocabulary | v1.9 proven core |
| `services/portfolio_metrics.py` | in-tree | `compute_mwr` / `compute_modified_dietz` scalar consumers | the KEPT path |

**Installation:** none. **[VERIFIED: in-tree]** — every module above read directly this session.

## Package Legitimacy Audit

No external packages are installed by this phase. **Packages removed due to slopcheck [SLOP]: none. Packages flagged [SUS]: none.** (slopcheck not run — nothing to check.)

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NAV backward chain + flow guards | a new equity replay | `nav_twr.reconstruct_nav_and_twr` conventions (or the function itself) | dust/negative/flow-dominated/terminus guards took 3 phases to harden |
| Transfer fetch | per-venue deposit/withdrawal fetchers | `ccxt_flow_fetch.fetch_ccxt_transfers` | 90-day pagination windows, WR-04 exception discipline |
| UTC day bucketing | any date helper | `services/dateday.epoch_ms_to_iso_day` | midnight-boundary flow placement is load-bearing (nav_twr:34-45) |
| Window overlap predicate | inline interval math | `tests/fixtures/window_overlap_convention.json` + stitch_composite helpers | the ONE shared spec (v1.5 lesson) |
| Metrics | any scalar re-derivation | `compute_all_metrics` / P114 helpers | that's the whole point of the milestone |
| Price closes for flow valuation | new price fetcher | eq_rec's `_fetch_ohlcv_daily`/CoinGecko chain (F2) | 76-x Don't-Hand-Roll, cached in token_price_history |

## Runtime State Inventory (refactor phase — required)

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | `allocator_equity_snapshots` rows in prod (per-allocator daily, ≤730/allocator); `csv_daily_returns` key-mode rows (may be STALE for some keys — queries.ts:3016 warns the by-allocator read "carries STALE per-key series" for disconnected keys) | None this phase (store stays). New blend MUST filter to active/connected keys, mirroring D3 eligibility |
| Live service config | pg_cron schedule `enqueue_refresh_allocator_equity_for_all` (migration 070:382) + match_engine_cron (01:00 UTC → /api/match/cron-recompute); Railway worker consumes compute_jobs | None this phase — both keep running. Follow-up ledger: unschedule on retirement |
| OS-registered state | None — verified (Railway/Vercel/pg_cron only, no local registrations) | — |
| Secrets/env vars | None new. Ground-truth script needs an allocator read-only key via Railway env (founder action, deribit_ground_truth runbook pattern) | Founder sets env for the acceptance run |
| Build artifacts | None — Python service deploys from source on Railway | Verify `railway deployment list` green post-merge (red main silently skips) |

## Common Pitfalls

### Pitfall 1: Forcing concurrent allocator keys through the disjoint-window stitch (L1)
**What goes wrong:** `CompositeOverlapError` on every multi-venue allocator. **Why:** the stitch core is fail-loud on overlap BY DESIGN. **Avoid:** concurrent days = capital-weighted blend; stitch/seam machinery only at coverage boundaries. **Warning sign:** any plan task that calls `assert_windows_disjoint` on live sibling keys.

### Pitfall 2: Gating on curve parity vs the old store for ccxt venues (L4)
**What goes wrong:** permanent red gate. **Why:** mark-basis vs cash-basis are different measures. **Avoid:** gate on anchor-consistency + internal-consistency + seam pins (§6); record store-divergence as evidence only.

### Pitfall 3: Treating Dietz/MWR as the live flow machinery (L3)
**What goes wrong:** plan tasks "reuse the MWR ledger" that doesn't exist — `compute_mwr` has ZERO production call sites; there is no persisted cashflow ledger today. **Avoid:** the ledger is the per-key dated-flow list built at derive time (ccxt_flows/deribit ledger); STITCH-06 appends synthetic entries to THAT; Dietz/MWR consume it as scalars.

### Pitfall 4: Deleting `compute_twr` as a drive-by (L6)
**What goes wrong:** breaks the LIVE unified verification flow (process_key.py:983) or trips endpoint-ratio-vs-prod day-0/masked-day divergence. **Avoid:** own gated sub-plan with a micro-oracle, or keep the method (both gate-green, §5).

### Pitfall 5: Two writers on (allocator_id, asof)
**What goes wrong:** if the new derivation ALSO upserts `allocator_equity_snapshots.value_usd`, it races the legacy jobs on the same PK — first-writer-wins means non-deterministic mixing of methodologies per day. **Avoid:** the new derivation must NOT write the legacy table (serve via new endpoint/payload or a distinct store); the legacy writer keeps sole ownership until retirement. If the planner wants persistence, use a NEW keyed surface.

### Pitfall 6: Stale/ineligible per-key series in the blend
**What goes wrong:** disconnected keys' stale `csv_daily_returns` rows poison the blend (queries.ts:3016 already documents this hazard). **Avoid:** replicate the D3 eligibility predicate (active + connected + non-revoked, phase35 script's IS DISTINCT FROM semantics) server-side.

### Pitfall 7: Whole-repo grep before any disclosure-delete
Per the v1.10 lesson: grep src/ AND e2e/ AND tests/ AND scripts/ before deleting any string/symbol. The census above did this; keep the discipline for any plan-time deletions.

## State of the Art (internal)

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Allocator equity = holdings-mark reconstruction store (first-writer-wins per (allocator,asof)) | Per-key dailies blend on the backbone + $-layer (this phase, display only) | 115 | store becomes breakdown-only producer |
| Deribit allocators: hard-fail, zero snapshots | Deribit flows through native-ledger dailies | 115 | closes the dogfooding gap |
| Legacy Sharpe/TWR scalars | `compute_all_metrics` + P114 helpers | 114 (done) | reuse, never re-derive |
| Composite stitch offline prototype | `stitch_composite.py` + `run_stitch_composite_job` | v1.9 (Phase 86) | the reuse target |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Key-mode `derive_broker_dailies` coverage is complete enough for real allocator keys (phase35 backfill ran; connect-time enqueue exists for post-35 keys) | §4 | Some allocator keys lack `csv_daily_returns` rows → blend ineligible → plan needs a backfill-enqueue task (cheap: mirror phase35 script). Verify row counts on the test project in wave 0 |
| A2 | The dashboard $-curve repoint (TS) is allowed inside this phase (CONTEXT says display derives from the blend; prompt freezes only scenario.ts) | Responsibility map | If repoint is deferred to 116/117, this phase ships the Python derivation + endpoint only — smaller, still coherent |
| A3 | pg_cron schedule from migration 070:382 is actually active in prod (migration-time DO block could have skipped on missing settings) | §1 R6 | Only affects the FOLLOW-UP retirement ledger, not this phase |

## Open Questions

1. **Where does the new derivation surface its output?** (new FastAPI endpoint computed on read vs a new persisted table/column vs job-computed cache). Constraint from Pitfall 5: NOT the legacy table. Recommendation: worker job writing a NEW keyed surface (allocator_id, asof, value_usd_derived, basis) OR an on-demand endpoint with cache — planner's call; endpoint-first is smaller and avoids a migration.
2. **Is the `compute_twr` METHOD deletion in or out?** Both gate-green. Recommendation: OUT unless the planner budgets the micro-oracle (§5) — the exemption is permanent-safe and the method serves the live verification flow.
3. **MWR display scope:** STITCH-05 keeps the Dietz/MWR path, but nothing displays MWR today. Does 115 add an MWR scalar to the allocator payload, or just thread the ledger so it CAN? Recommendation: thread-only (ledger produced + tested), display deferred.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Python + pytest (analytics-service) | all tests | ✓ (P114 ran 3687 tests green 2026-07-17) | per requirements.txt | — |
| Supabase test project (qmnijlgmdhviwzwfyzlc) | SQL/RLS checks, A1 verification | ✓ (per MEMORY, MCP) | — | — |
| Railway worker SSH | ground-truth acceptance run | ✓ (established runbook) | — | run locally against test project |
| Real allocator account creds (read-only) | golden acceptance | founder action (env vars) | — | fixture-only gates still ship |

**Missing dependencies with no fallback:** none blocking. The real-account acceptance run needs founder-set env (documented runbook step, same as deribit_ground_truth).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | pytest (analytics-service), config `analytics-service/pyproject.toml`/`pytest.ini` conventions in-tree |
| Quick run command | `cd analytics-service && python -m pytest tests/test_e1_delete_gate.py tests/test_match_router.py -q` |
| Full suite command | `cd analytics-service && python -m pytest -q` (3687 tests, ~serial in CI; coverage gate `--cov-fail-under=80`, actual 89.00%) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| STITCH-01 | allocator per-key blend on backbone | unit | `pytest tests/test_e2_allocator_blend.py -q` | ❌ Wave 0 |
| STITCH-02 | census documented; delete-gate green; store untouched | gate | `pytest tests/test_e1_delete_gate.py -q` | ✅ |
| STITCH-03 | perf≠equity; zero-flow equivalence pin | unit | `pytest tests/test_e2_equity_curve_layer.py -q` | ❌ Wave 0 |
| STITCH-04 | backward derivation from anchor; honest degradation w/o anchor | unit | same file as STITCH-03 | ❌ Wave 0 |
| STITCH-05/06 | flows + synthetic seam through ONE ledger; TWR seam-clean | unit | `pytest tests/test_e2_seam_ledger.py -q` | ❌ Wave 0 |
| match parity | score_candidates golden byte-stable | integration | `pytest tests/test_match_integration_phase09.py -q` (extended golden) | ✅ (extend) |
| oracle | independent pandas re-derivation of blend/curve (114-01 pattern) | unit | `pytest tests/test_e2_parity_oracle.py -q` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the task's own test file + `tests/test_e1_delete_gate.py`
- **Per wave merge:** `cd analytics-service && python -m pytest -q`
- **Phase gate:** full analytics suite + full TS suite green (TS only if queries.ts touched) before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `tests/test_e2_parity_oracle.py` — the independent oracle + golden capture of match scores (MUST land before any derivation code)
- [ ] `tests/test_e2_allocator_blend.py`, `tests/test_e2_equity_curve_layer.py`, `tests/test_e2_seam_ledger.py`
- [ ] Fixture: allocator with 2 concurrent keys + 1 rotated key + real-flow days (extend phase09 match fixtures)
- [ ] A1 verification: per-key `csv_daily_returns` row counts for allocator keys on the test project

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2/V3 Auth/Session | no (worker-internal) | — |
| V4 Access Control | yes | RLS `allocator_id = auth.uid()` on csv_daily_returns/snapshots reads; service-role only in worker; any new endpoint must gate on owner |
| V5 Input Validation | yes | job payload validation via existing `_allocator_key_preflight`; never trust job-payload allocator_id (job_worker.py:1910 — authoritative owner from api_keys.user_id) |
| V6 Cryptography | yes (existing) | worker-only key decryption LOCKED inside `_allocator_key_preflight`; Next.js never decrypts |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Account-size leak in logs/errors | Information disclosure | never log raw NAV/flow USD (T-73-02, nav_twr discipline); scrub via `scrub_freeform_string` (T-86-10) |
| Cross-tenant series read | Elevation | explicit `.eq("allocator_id", …)` defence-in-depth atop RLS (queries.ts pattern) |
| Fabricated data on gaps | Tampering (self) | no-invented-data invariant: gaps MARKED never zero-filled; unanchored → no $ curve |

## Sources

### Primary (HIGH confidence — all read/grepped this session)
- `analytics-service/services/equity_reconstruction.py` (structure, persist L1271, carve-out L2084/2430, builder L2678-3090, reconstruct_symbol_returns L2593)
- `analytics-service/routers/match.py` L520-680; `services/match_engine.py` L802
- `analytics-service/services/{nav_twr,ccxt_flows,ccxt_flow_fetch,stitch_composite,broker_dailies,portfolio_metrics,metrics,job_worker,audit}.py`
- `analytics-service/routers/{process_key,cron,portfolio}.py`; `services/ingestion/*.py`; `scripts/{phase35_backfill_enqueue,deribit_ground_truth}.py`
- `analytics-service/tests/test_e1_delete_gate.py` (full header + Part A/B mechanics)
- `supabase/migrations/{20260420213754,20260422101911,20260422122720,20260522111839,20260614120000,20260624120100,20260710130000}*.sql`
- `src/lib/queries.ts` L1610-1645, 2095-2130, 2570-2605, 2981-3017; `src/app/(dashboard)/compare/lib/holding-compare-adapter.ts`; `src/lib/gdpr-export-manifest.ts`
- `.planning/phases/115-.../115-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `.planning/DOGFOODING-FINDINGS-2026-07-16.md`

### Secondary / Tertiary
- None needed — no external-ecosystem claims in this phase.

## Metadata

**Confidence breakdown:**
- Scope-gate census: HIGH — whole-repo grep + read of every hit; both reader-side and writer-side blockers independently decisive
- Cashflow reality: HIGH — dormancy of compute_mwr verified by whole-tree call-site grep
- Stitch reuse / blend landmine: HIGH — overlap guard read in source
- Golden strategy: MEDIUM-HIGH — basis-mismatch reasoning verified via `mark_to_market_available` docs in stitch_composite.py; exact tolerance values are planner discretion
- A1 (key coverage): MEDIUM — needs a wave-0 row-count check

**Research date:** 2026-07-17
**Valid until:** ~2026-08-16 (internal codebase research; re-verify after any merge touching equity_reconstruction/job_worker/match.py)
