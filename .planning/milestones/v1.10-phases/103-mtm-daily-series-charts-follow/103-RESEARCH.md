# Phase 103: MTM daily series → charts follow the toggle - Research

**Researched:** 2026-07-12
**Domain:** Analytics derive (Python) + factsheet read-path/charts (Next.js RSC + client) + a Supabase migration
**Confidence:** HIGH (all claims grounded in current source at file:line; two design calls recommended with explicit tradeoffs)

## Summary

Today the `cash_settlement ↔ mark_to_market` toggle swaps only the **seven headline scalars** (`overlayBasisScalars`, `build-payload.ts:243`). Every chart series — `strategyReturns` / `strategyEquity` / `strategyDrawdowns`, rolling, worst-10, heatmap — is derived ONCE from a single `dailyReturns: DailyReturn[]` array inside `buildFactsheetPayload` (`build-payload.ts:203-204`, `:303-310`) and the client honestly captions "Charts show the cash-settlement series" (`FactsheetView.tsx:473-474`). The MTM daily series that would drive MTM charts is **computed then discarded**: single-key `mtm_returns` reduced to scalars at `job_worker.py:2983` and never persisted; composite `clipped_mtm` reduced to scalars via the bespoke `_metrics_result_for(clipped_mtm)` at `job_worker.py:4249` and never persisted (only `stitched_cash` → `csv_daily_returns`, "stays for charting only" `:4336`).

The convergence point already exists and is durable: **`buildFactsheetPayload(strategy, dailyReturns, buildOpts)`** (`build-payload.ts:165`) is the ONE common downstream both single-key (reads `strategy_analytics.daily_returns` column, `page.tsx:62/:70`) and composite (reads sparse `csv_daily_returns` via `readCompositeFactsheet`, `page.tsx:102-110`) route through. The single unifying move is: **persist the MTM daily series → read it into an MTM `DailyReturn[]` → emit a per-basis series BUNDLE from `buildFactsheetPayload` → have charts pick the active-basis bundle via `useBasis()`.** Because MTM gaps ≠ cash gaps, the MTM bundle needs its **own date axis + own gap mask**, not a values array overlaid on cash dates.

**Primary recommendation:** (Q2) Persist the sparse MTM series as a **new `strategy_analytics_series` kind `mtm_daily_returns`** (`{date: return}` JSONB, honest-absent gaps) — near-zero blast radius, no ALTER on the hot `csv_daily_returns` cash table, SC-4 cash byte-identity preserved by construction. (Q3) Represent the per-basis coverage mask as **DERIVED from the persisted sparse MTM series** (absent-day runs), not a separately persisted mask — keeps the series canonical. (Coordinator constraint) Build the derive as ONE **shared `services/basis_series.py` helper** that BOTH derive sites call, so Phase 103 is the first increment of the dailies-canonical route the backbone merge later EXTENDS — never a fork bolted onto the throwaway composite `_metrics_result_for` path.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (LOCKED architectural principle, user 2026-07-12)
- **Daily returns are the canonical source.** ALWAYS compute dailies first, then derive everything (metrics + charts + coverage) FROM them. Identically for cash AND mark_to_market, and identically across every source (CSV upload, single API key, composite stitch).
- **The toggle swaps the daily SERIES** feeding ONE common downstream route; charts + metric cards both follow. Never swap only the scalar cards (the Phase-102 shortcut).
- **Composites first derive their stitched daily returns, then take the SAME route as CSV / all API keys** — no bespoke composite metrics/charts path.
- **Scalars stay as a DERIVED cache** (mirrors cash). They must always be re-derivable from the persisted dailies; add a guard/test that persisted-scalars == derived-from-persisted-dailies (kills the Phase-101 √252-vs-√365 divergence class). The stored scalar is never an independent source of truth.

### User decisions (LOCKED)
- Fold Phase 103 into v1.10 (finish MTM before shipping the milestone).
- **Unify single-key AND composite** (both must swap the series on toggle).
- **Full per-basis coverage mask** (MTM gaps ≠ cash gaps; render MTM-specific MARKED gaps, never zero-filled — NOT the current all-or-nothing MTM gating).
- **NO new valuation math** (persist the series already computed).

### HARD design constraint (coordinator, 2026-07-12) — backbone-aligned shared route
- The MTM-dailies work MUST be built as a **SHARED route**, never bolted onto the composite's bespoke `_metrics_result_for` path (`job_worker.py:4249/:4258`) — that path is what the future backbone merge deletes, so extending it = throwaway.
- "persist the daily series → derive the scalars from it → build the per-basis coverage mask" MUST be ONE shared helper that BOTH the single-key derive (`job_worker.py:~2983`) AND the composite stitch (`~:4249`) call. Phase 103 is the correct FIRST INCREMENT of the dailies-canonical unification (the shared route the backbone merge later EXTENDS), not a fork that gets rewritten.

### Claude's Discretion (DELEGATED to Fable / this research recommends)
- **Persistence home** for the MTM daily series (new `strategy_analytics_series` kind vs per-basis axis on `csv_daily_returns`). → Research recommends **new kind** (Q2).
- **Per-basis coverage-mask design** (persisted mask vs derived). → Research recommends **derived from sparse series** (Q3).
- **Unification degree** (how far to route composite through the common path within v1.10 vs align with in-flight backbone). → Research recommends the **contained shared-helper boundary** (Q6).

### Deferred Ideas (OUT OF SCOPE)
- Full backbone merge of the composite CASH compute into the one CSV route (in-flight `process_key` program) — align, do NOT fork.
- Any new valuation math / smoothing (permanently dropped).
- LIVE Zavara MTM-curve corroboration — POST-DEPLOY ship-time gate (needs the re-derive backfill).
- Option B composite options-MTM parity (deferred in Phase 102).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MTM-04 | The basis toggle swaps the daily SERIES so ALL charts follow (equity/drawdown/returns), single-key AND composite, with a full per-basis coverage mask | Q1 convergence map (`buildFactsheetPayload` is the one route); Q4 threading (per-basis bundle + `useBasis()` in charts); Q3 derived mask |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Compute MTM daily series | Analytics worker (Python) | — | Already computed today (`job_worker.py:2357` single-key, `_reconstruct_all(MTM)` `:4198` composite); NO new math |
| Persist MTM daily series + derive scalars + mask | Analytics worker (Python) | Database (new series row) | Dailies-canonical: ONE shared helper derives scalars+mask from the series |
| Store MTM series | Database (`strategy_analytics_series`) | — | Purpose-built heavy-series sibling table; deny-all RLS; service-role writer |
| Read MTM series → `DailyReturn[]` | Frontend Server (RSC read-path) | — | `page.tsx` / `composite-read-path.ts` already read series server-side via service-role admin |
| Build per-basis chart bundle | Frontend Server (`buildFactsheetPayload`) | — | The existing convergence point; emits basis-keyed series |
| Swap series on toggle | Browser (client charts) | — | `useBasis()` is client context (`basis-context.tsx:44`); `TimeSeriesChart` picks the active-basis bundle |
| Anti-divergence guard | Analytics tests (Python) | — | Assert persisted scalars == derive-from-persisted-dailies |

## Standard Stack

No new packages. This phase is analytics-service (Python/pandas) + Next.js/TypeScript + one Supabase SQL migration, all in-repo. **No Package Legitimacy Audit required** (zero external installs) — consistent with Phase 101/102 (`tech-stack.added: []`).

Test frameworks (already present): **vitest 4.1.2** (`vitest.config.ts`; `npm run test` = `vitest run`, coverage via `@vitest/coverage-v8` 4.1.10) and **pytest** (`analytics-service/pytest.ini`, `--cov-fail-under=80`).

## Q1 — Current daily-series → metrics/charts/coverage routes (3 sources × 2 bases)

### Where the CASH series lives per source (the divergence is at the SOURCE, not the downstream)

| Source | Cash daily-series home (read by factsheet) | Read site |
|--------|--------------------------------------------|-----------|
| CSV upload | `strategy_analytics.daily_returns` JSONB column | `page.tsx:62` (`dailyRaw`) → `resolveDailyReturnSeries` `:70` |
| Single API key (Deribit broker) | `strategy_analytics.daily_returns` column (broker derive also writes `csv_daily_returns` for internal recompute, `job_worker.py:2909`) | `page.tsx:62/:70` |
| Composite stitch | sparse `csv_daily_returns` (honest-absent gaps, `job_worker.py:4285-4291`) | `readCompositeFactsheet` `composite-read-path.ts:68-86` |

### Where they CONVERGE (the durable common downstream)

**`buildFactsheetPayload(strategy, dailyReturns, buildOpts)` — `build-payload.ts:165`.** Both arms produce a `DailyReturn[]` and call this one function (`page.tsx:180-205`). Inside, the ENTIRE chart series set is derived from the single `stratRet = clipped.map(d => d.value)` (`:204`): `strategyReturns` `:303`, `strategyEquity` `:304/:232`, `strategyDrawdowns` `:310/:233`, rolling `:305-307`, worst-10 `:311`, heatmap `:336`. Charts read these off `usePayload()` context (`TimeSeriesChart.tsx:63/:103` → `resolveSeries(config, payload, cmp, xStart)` reads `payload[cfg.stratField]` `chart-configs.ts:262-264`). **There is NO basis dimension in the chart data path** — `resolveSeries` never sees `basis`.

### Where they DIVERGE on the MTM basis (the discard sites)

- **Single-key:** MTM series computed `job_worker.py:2357` (`combine_native_ledger(pnl_basis=mark_to_market)` → `mtm_returns`), reduced to scalars `:2983` (`compute_all_metrics(mtm_returns, …)` → `mtm_metrics_json`), persisted **scalars-only** into `metrics_json_by_basis.mark_to_market`. The `mtm_returns` Series is **discarded**.
- **Composite:** MTM stitched via the bespoke `_metrics_result_for(clipped_mtm)` `:4249` (which internally does `stitch_clipped_series → gap_fill_daily_returns(dense 0.0) → compute_all_metrics`, `:4157-4165`), scalars persisted; the stitched MTM **Series is discarded** — only `stitched_cash` reaches `csv_daily_returns` `:4291`.
- **Read-path (both):** `singleKeyBasisOpts` (`composite-read-path.ts:227`) and the composite `mtmGate` (`:167-170`) thread ONLY the scalar object + an all-or-nothing `available` flag. No MTM series enters the payload.

**Crux:** the convergence point is already correct and durable. The plan does NOT need to build a new common route — it needs to (a) persist the MTM series, (b) read it into a second `DailyReturn[]`, (c) make `buildFactsheetPayload` emit a per-basis bundle, (d) make charts pick the active-basis bundle. The composite bespoke `_metrics_result_for` path is the throwaway; see the shared-helper design below.

## Q2 — Persistence home (RECOMMENDATION: new `strategy_analytics_series` kind)

### Recommended: new kind `mtm_daily_returns` on `strategy_analytics_series`

**Migration `20260428120919_strategy_analytics_series.sql`** already provides: composite PK `(strategy_id, kind)` `:76`, JSONB `payload`, `ON DELETE CASCADE` FK, **RLS deny-all** `:106-112` (service-role writer bypasses; readers go through service-role admin or the fetch RPC), and an atomic **`upsert_strategy_analytics_series_batch(strategy_id, {kind: payload})`** service-role RPC `:208-231`. Adding a kind is documented as "**INSERT a new row; no ALTER TABLE**" (`:83`).

**Payload shape:** sparse `[{ "date": "YYYY-MM-DD", "return": <float> }]` (or `{date: return}` map). Honest-absent discipline preserved by construction — a day the MTM ledger could not mark is simply an ABSENT entry, never 0.0 (mirrors `csv_daily_returns` NaN-skip, `job_worker.py:4292`).

| Dimension | New kind (RECOMMENDED) | Per-basis axis on `csv_daily_returns` (Option B) |
|-----------|------------------------|--------------------------------------------------|
| DDL blast radius | **~none** — kind is bare TEXT (no CHECK constraint); adding a kind is an INSERT | HIGH — the hot cash table: drop/recreate unique indexes `csv_daily_returns_strategy_date_key` + `csv_daily_returns_api_key_date_key` (`20260624120000:55-61`), change `persist_csv_daily_returns` RPC signature (`20260522111839:111`), every `on_conflict="strategy_id,date"` upsert (`job_worker.py:4320`), the paginated reader, the allocator per-key reader |
| SC-4 cash byte-identity | **safe by construction** — cash paths untouched | HIGH risk — every cash read/write gains a basis predicate; a missed one double-counts or perturbs cash |
| Honest-absent gaps | preserved in sparse JSONB | preserved (sparse rows) |
| Serves single-key MTM read | yes — factsheet reads the row via service-role admin (as it reads `csv_daily_returns`) | **no** — single-key factsheet reads the `daily_returns` COLUMN, not `csv_daily_returns`, so a basis axis there wouldn't feed single-key MTM |
| RLS/auditor load | deny-all already in place; no new policy | new per-basis policy + re-audit of 4 existing policies |
| TOAST ceiling | this is the table's raison d'être (`:6-17`) — safe for 5y series | n/a |

**Migration shape (small):** Option A needs at most a **documentation/COMMENT migration** updating the `kind` enumeration comment (`:80/:82-83`) to list `mtm_daily_returns`, and OPTIONALLY extending `fetch_strategy_lazy_metrics`'s panel map (`:163-176`) if you want an RPC read path. **The factsheet read-path uses the service-role admin client and can `.from("strategy_analytics_series").select("payload").eq("strategy_id",…).eq("kind","mtm_daily_returns")` directly** (exactly how `composite-read-path.ts:68` reads `csv_daily_returns`), so **no RPC change is strictly required.** Net: the migration is near-trivial — a plan-size WIN vs Option B. `[VERIFIED: codebase — migration 20260428120919 + 20260522111839 + 20260624120000 read in full]`

> ⚠️ **Flag for the planner:** because Option A may require only a COMMENT migration (or none), the CONTEXT's stated "migration-reviewer + rls-policy-auditor + test-project MCP catch-up" load is LIGHT for Option A and HEAVY for Option B. If the planner wants a schema artifact for the anti-divergence guard or a `kind` CHECK, that is the moment to add DDL — otherwise keep it minimal. Confirm with the planner whether a `kind IN (...)` CHECK is desired (it does not exist today; kind is unconstrained TEXT).

## Q3 — Per-basis coverage mask (RECOMMENDATION: DERIVE from the sparse MTM series)

### Today: all-or-nothing gating

`mtm_gated_reason` gates the WHOLE MTM basis OFF. `singleKeyBasisOpts` sets `available = done && hasBasisHeadline(mtm)` and threads the MTM scalar object ONLY when `available` (`composite-read-path.ts:255-261`); the composite `mtmGate.available` mirrors it (`:143-145`). When gated, the UI shows a disabled reason (`FactsheetView` copy per Phase 102). There is no PARTIAL MTM coverage today.

### Existing coverage-mask machinery (cash / composite, per-strategy — NOT per-basis)

- `segmentBoundaries` — from `data_quality_flags.per_key[]` where `seq > 1` (composite key handoffs), `deriveSegmentMarkers` `build-payload.ts:103-105`. **Basis-invariant** (same members regardless of basis) → shareable across bases.
- `missingSegments` — from `data_quality_flags.gap_spans[]`, `deriveSegmentMarkers:107-114`. These are **CASH** gap spans. MTM gaps differ.
- Rendered only on the cumulative track (`chart-configs.ts:100-101` `segmentMarkers:true`) reading `payload.segmentBoundaries` / `payload.missingSegments` / `payload.dates` (`TimeSeriesChart.tsx:236-241/:335-339`). The a11y summary reads the same counts (`FactsheetView.tsx:451-459`).

### Recommendation

Represent the MTM gap mask as **derived on read from the persisted sparse MTM series** — the contiguous absent-day runs within `[first_marked_day, last_marked_day]`. This is honest (the series IS the truth), keeps the series canonical (aligns with dailies-canonical), and reuses the existing `missingSegments` render shape (`{start, end, kind:"gap", days}`) so `TimeSeriesChart` needs only to read the active-basis bundle's `missingSegments` instead of a cash-only field. `segmentBoundaries` (composite key handoffs) are shared. Do NOT persist a separate MTM mask — that would create a second source of truth to keep in sync.

**Where MTM coverage holes come from** (must be surfaced as marked gaps, never zero-filled): `mtm_summary_coverage_incomplete` / `mtm_anchor_race` / `mtm_second_pass_timeout` / `mtm_series_uncomputable` (reasons owned in `stitch_composite.py`; classified in the degrade catch `job_worker.py:~2381-2398` / `:3005`). Today these degrade the WHOLE basis. Under partial coverage, a hole is simply an absent day in the persisted series and renders as a marked break.

> 🚩 **POTENTIAL BLOCKER for honest per-basis charts (verify in planning):** the current single-key MTM second pass produces ONE `mtm_returns` Series or **degrades the whole basis** (`job_worker.py:2357-2411`). It is not established that the existing MTM reconstruction emits an *interior-sparse* series (some days marked, some honestly absent) DISTINCT from cash. If the MTM compute is "whole book reconstructs OR degrade", then "partial MTM coverage" reduces to: (a) the MTM series spans a DIFFERENT date window than cash (a span-level coverage difference worth marking), and (b) interior gaps appear only where the MTM series is genuinely absent. Because **NO new valuation math is allowed**, the mask can only surface sparsity the existing compute already produces. The plan MUST confirm the actual sparsity of `mtm_returns` / stitched-MTM before promising interior marked gaps; otherwise MTM-04's "full per-basis coverage mask" is honestly satisfied by the series' own span + whatever gaps it already carries. **Recommend a Wave-0 probe:** log `mtm_returns.isna().sum()` / index vs cash on the Zavara book. `[ASSUMED — needs verification against live MTM series sparsity]`

## Q4 — Read-path + build-payload + charts threading (smallest change)

**The MTM bundle needs its own date axis.** MTM gaps ≠ cash gaps, so `payload.dates` differs per basis — you cannot overlay an MTM `number[]` onto cash `payload.dates`. The payload must carry a full per-basis bundle.

Recommended threading (smallest change honoring dailies-canonical):

1. **Read-path** (`page.tsx` single-key arm `:128-131`; `composite-read-path.ts` composite): additionally read the `mtm_daily_returns` row → an MTM `DailyReturn[]`. Thread it into `buildFactsheetPayload` as a new optional input (e.g. `opts.mtmDailyReturns`), gated exactly like the scalar MTM object is today (F-4 DONE gate + `hasBasisHeadline`, `composite-read-path.ts:250-261`) so a non-options / gated strategy passes `undefined` and stays byte-identical.
2. **`buildFactsheetPayload`** (`build-payload.ts:165`): when `mtmDailyReturns` is present, derive a SECOND bundle `{ dates, strategyReturns, strategyEquity, strategyDrawdowns, rolling*, strategyWorst10, dailyHeatmap, missingSegments }` from it using the SAME derivation used for cash (`:203-311`) — ideally by factoring the cash derivation into a `deriveSeriesBundle(dailyReturns, opts)` inner and calling it twice. Emit it under `payload.mtm` (or `payload.seriesByBasis.mark_to_market`). Cash bundle stays at the top level → **cash byte-identical** (SC-4) when `mtmDailyReturns` is absent.
3. **Charts** (`TimeSeriesChart.tsx:62-63/:103`, `chart-configs.ts:238-264`): `TimeSeriesChartInner` calls `useBasis()` (already imported by `FactsheetView`, `:9`) and, when `basis === "mark_to_market"` AND `payload.mtm` present, resolves series + `dates` + `missingSegments` from the MTM bundle instead of the top-level fields. `resolveSeries` gains a basis-aware source (pass the active bundle, not the raw payload).
4. **Remove the honest disclaimer** `FactsheetView.tsx:473-474` ("Charts show the cash-settlement series. Mark-to-market applies to summary metrics only.") — its whole reason for existing is gone once charts follow.
5. **types.ts** (`:406-478`): add the optional per-basis bundle type; keep top-level cash fields (byte-identity contract).

**RSC note (AGENTS.md):** this is a data-flow/threading change on an existing RSC read-path — no new routing/caching primitives. Per AGENTS.md, before writing ANY new RSC/routing/caching code the executor MUST read `node_modules/next/dist/docs/`. The cache key `${id}::${computedAt}` (`page.tsx:357`) already changes on re-derive, so a re-derive that adds the MTM row invalidates the payload cache naturally — confirm no separate cache-key bump is needed once the payload shape grows (mirror the `rollingWindow` schema-drift guard at `FactsheetView.tsx:406-413`).

## Q5 — Anti-divergence guard (kills the Phase-101 √252 class)

**Assertion:** persisted MTM scalars == `compute_all_metrics(<persisted MTM dailies>, …)` under the SAME conventions.

Single-key scalars are computed at `job_worker.py:2983` with `periods_per_year=periods_per_year_for_asset_class(asset_class)` (√365 crypto / √252 traditional, `:2954`), `cumulative_method` / `day_basis` from `denominator_config` (`:2960-2964`), guarded benchmark (`:2972`). The guard re-reads the persisted `mtm_daily_returns` series and recomputes with these EXACT conventions, asserting the seven headline scalars match.

**Nuance (critical):** the composite scalar path computes on a **dense 0.0-gap-filled** series (`_metrics_result_for` does `gap_fill_daily_returns(stitched)` before compute, `build-payload.ts` cash arm computes on the sparse client series — these are already a known transform). The persisted SERIES is SPARSE (honest gaps); the persisted SCALAR is computed on the DENSE fill. So the guard must encode the transform: `assert scalars == compute(gap_fill(persisted_sparse_series), conventions)`. If the shared helper (below) owns both the sparse-series emission AND the dense-fill-then-compute, the transform is in ONE place and the guard is a straight round-trip through it.

**Same guard is feasible for CASH** (per the principle): `assert cash_scalars == compute(gap_fill(persisted csv_daily_returns), conventions)`. This is the durable regression that would have caught the Phase-101 √252-vs-√365 divergence (mismatched `periods_per_year`). Recommend implementing it for BOTH bases in `test_mtm_single_key.py` (extend) + a composite counterpart in `test_stitch_composite_job.py`.

## Q6 / Coordinator constraint — Shared route: DURABLE vs THROWAWAY-RISK

### The anti-fork design (ONE shared helper both derive sites call)

**Do NOT compute MTM scalars/series by extending `_metrics_result_for(clipped_mtm)` at `job_worker.py:4249` — that composite-bespoke path is exactly what the backbone merge deletes.** Instead introduce a shared helper that IS the dailies-canonical route:

**New module: `analytics-service/services/basis_series.py`** — a `derive_basis_series(returns: pd.Series, *, periods_per_year, cumulative_method, day_basis, benchmark_rets) -> BasisSeriesResult` where `BasisSeriesResult` carries `{ metrics_json (scalars), series_rows (sparse honest-absent [(date, return)]), coverage_mask (gap spans derived from series_rows) }`. It internally does `gap_fill_daily_returns` (import from `broker_dailies.py:123`) → `compute_all_metrics` (from `metrics.py:398`) for the scalars, and emits the SPARSE rows + derived mask from the input series. A thin `persist_basis_series(supabase, strategy_id, basis, result)` upserts the `strategy_analytics_series` row (or uses `upsert_strategy_analytics_series_batch`).

Both derive sites become callers of the SAME function:
- **Single-key** (`job_worker.py:~2953-2990`): once `mtm_returns` exists, call `derive_basis_series(mtm_returns, …)` instead of the inline `compute_all_metrics` at `:2983`.
- **Composite** (`job_worker.py:~4230-4249`): once the stitched MTM series exists (`stitch_clipped_series(clipped_mtm)`, `stitch_composite.py:217`), call `derive_basis_series(stitched_mtm, …)` instead of `_metrics_result_for(clipped_mtm)` at `:4249`. The stitch step stays; the compute+persist+mask moves into the shared helper.

This makes Phase 103 the **first increment** of the unified route: the helper owns "compute dailies → derive scalars → derive mask", and the in-flight `process_key`/backbone program later routes the CASH series (currently `_metrics_result_for` composite + `run_csv_strategy_analytics` single-key) through the SAME `derive_basis_series` rather than replacing it. `services/basis_series.py` is the right home because `metrics.py` is the low-level primitive (`compute_all_metrics`) while the new module is the higher-level canonical orchestrator the backbone wants to own — both derive sites already import from `metrics` / `broker_dailies` / `stitch_composite`, so the new module composes them without a cycle. `[VERIFIED: codebase — gap_fill_daily_returns broker_dailies.py:123, stitch_clipped_series stitch_composite.py:217, compute_all_metrics metrics.py:398]`

### DURABLE vs THROWAWAY-RISK ledger

| Piece | Verdict | Why |
|-------|---------|-----|
| Migration / `strategy_analytics_series` kind `mtm_daily_returns` | **DURABLE** | Series storage is the canonical artifact; the backbone reads the same rows. Cash may later join as a sibling kind. |
| Shared `services/basis_series.py` derive+persist+mask helper | **DURABLE** | This IS the unified route; the backbone EXTENDS it (adds cash), never rewrites it. |
| Frontend per-basis series bundle + charts `useBasis()` swap + derived per-basis mask | **DURABLE** | `buildFactsheetPayload` is already the common downstream; per-basis bundling is basis-shape-agnostic and source-agnostic. |
| Anti-divergence guard (both bases) | **DURABLE** | A round-trip through the shared helper; survives any storage-home change. |
| Extending composite `_metrics_result_for(clipped_mtm)` at `:4249` to also persist the series | **THROWAWAY-RISK — AVOID** | That path is composite-bespoke and slated for deletion by the backbone merge; the shared-helper design above avoids it. |
| Reading MTM from a per-basis axis on `csv_daily_returns` (Option B) | **THROWAWAY-RISK — AVOID** | Bakes basis into the hot cash table's uniqueness/RLS the backbone would have to unwind; also does not serve the single-key column read path. |

### IN / OUT boundary (contained Phase 103)

**IN:** persist MTM series (single-key + composite) via the shared helper into `mtm_daily_returns`; read it into an MTM `DailyReturn[]`; per-basis bundle from `buildFactsheetPayload`; charts follow via `useBasis()`; per-basis mask derived from the sparse series; remove the cash-only chart caption; anti-divergence guards (MTM + cash).

**OUT (align, do NOT fork):** the `process_key`/unified-backbone merge of the composite CASH compute into the one CSV route (`process_key_long` scaffold — MEMORY: `project_unified_queued_path_scaffold`); moving cash storage homes; Option B composite options-MTM parity; any new valuation math. Phase 103 routes ONLY the MTM basis through the shared helper today; the backbone later adopts the helper for cash.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Storing the heavy MTM series | A new bespoke table | `strategy_analytics_series` kind | Purpose-built for heavy series, RLS + batch RPC exist (`20260428120919`) |
| Deriving scalars from the series | A second inline `compute_all_metrics` per site | shared `derive_basis_series` | Two inline computes = the exact divergence the guard exists to prevent |
| Gap/seam rendering | New MTM chart overlay | existing `segmentMarkers` / `missingSegments` render (`TimeSeriesChart.tsx:236-335`) | Per-basis bundle reuses the same shape; DESIGN.md gap voice already encoded |
| MTM gap mask | A separately persisted mask table/column | derive from the sparse series on read | Series is canonical; a second store drifts |
| Basis client state | New prop-drilling | existing `useBasis()` (`basis-context.tsx:44`) | Already the ephemeral basis owner both KpiStrip and charts share |

## Common Pitfalls

### Pitfall 1: Overlaying an MTM values array on cash dates
**What goes wrong:** MTM gaps ≠ cash gaps → an MTM `number[]` indexed against `payload.dates` (cash) misaligns every point after the first divergent gap. **Avoid:** the MTM bundle carries its OWN `dates` + `missingSegments`.

### Pitfall 2: Extending the composite `_metrics_result_for` path
**What goes wrong:** builds MTM persistence on the throwaway composite-bespoke compute; the backbone merge deletes it → rewrite. **Avoid:** the shared `derive_basis_series` helper (Q6).

### Pitfall 3: Perturbing cash byte-identity (SC-4)
**What goes wrong:** touching `csv_daily_returns` uniqueness/RLS (Option B) or the top-level cash payload fields risks the nine cash-pin golden files. **Avoid:** Option A (cash paths untouched) + emit the MTM bundle as an ADDITIVE optional field; cash stays top-level.

### Pitfall 4: Promising interior marked gaps the MTM compute doesn't produce
**What goes wrong:** MTM-04 says "partial coverage with marked gaps" but the existing MTM reconstruction may be whole-or-degrade → no interior sparsity to mark, and NO new math is allowed to manufacture it. **Avoid:** Wave-0 probe of `mtm_returns` sparsity (Q3 blocker flag); satisfy the mask honestly from the series' actual span + gaps.

### Pitfall 5: Stale MTM series after a re-derive
**What goes wrong:** the shared persist must be authoritative/idempotent per re-derive (mirror the composite `_reconcile_full_delete` before upsert, `job_worker.py:4297-4312`) or a shrinking re-derive leaves orphan MTM days. **Avoid:** upsert-with-reconcile on `(strategy_id, kind)`; the PK makes this a single-row replace (simpler than the cash multi-row reconcile).

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | No `mtm_daily_returns` row exists for ANY strategy until a re-derive runs. Existing options strategies (Zavara Deribit) have `metrics_json_by_basis.mark_to_market` scalars (Phase 101) but no series. | **Ship-time re-derive backfill** (already the OQ-3 gate, 102-02 SUMMARY §Ship-Time): `enqueue_compute_job(strategy_id, 'derive_broker_dailies')` on Railway (env `SUPABASE_SERVICE_KEY`) populates the new series row + re-verifies cash byte-identity. |
| Live service config | None — no external service holds the MTM series. | None. |
| OS-registered state | None. | None — verified (analytics runs are Railway worker jobs, not OS-registered). |
| Secrets/env vars | None new. Railway worker uses existing `SUPABASE_SERVICE_KEY`. | None. |
| Build artifacts | None — no package rename; new Python module `services/basis_series.py` is source, imported normally. | None. |

**Test-project catch-up:** if ANY DDL ships (COMMENT migration or a `kind` CHECK), the test Supabase project (`qmnijlgmdhviwzwfyzlc`) must be caught up via MCP `apply_migration` BEFORE PR green, or RED-guarded new SQL tests fail (MEMORY: `project_test_project_catchup_unmasks_stale_tests`). If Option A ships with **no DDL** (direct service-role read), no catch-up is needed — confirm which.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework (frontend) | vitest 4.1.2 (`vitest.config.ts`) |
| Framework (analytics) | pytest (`analytics-service/pytest.ini`, `--cov-fail-under=80`) |
| Quick run (frontend) | `npx vitest run src/lib/factsheet src/app/factsheet` |
| Quick run (analytics) | `pytest tests/test_mtm_single_key.py tests/test_stitch_composite_job.py -x` |
| Full suite | `npm run test` / `pytest tests --ignore=tests/e2e --cov --cov-fail-under=80` |

### Phase Requirements → Test Map
| Req | Behavior | Test Type | Command | Exists? |
|-----|----------|-----------|---------|---------|
| MTM-04 | Anti-divergence: persisted MTM scalars == derive-from-persisted-MTM-dailies (both bases) | unit (py) | `pytest tests/test_mtm_single_key.py -k basis_series_roundtrip` | ❌ Wave 0 |
| MTM-04 | Charts follow toggle: under `basis=mark_to_market` charts read the MTM bundle (dates+series+mask) | unit (ts) | `npx vitest run src/app/factsheet/[id]/v2/FactsheetBody.basis.test.tsx` | ⚠️ extend (exists) |
| MTM-04 | SC-4 cash byte-identity: cash charts/series/dates unchanged when MTM bundle absent AND present | unit (ts) + golden (py) | `npx vitest run src/lib/factsheet` + nine cash-pin py files | ⚠️ extend |
| MTM-04 | Per-basis mask derived from sparse MTM series (marked gaps, never 0.0) | unit (ts/py) | mask-derivation test | ❌ Wave 0 |

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_basis_series.py` — shared `derive_basis_series` round-trip (scalars == compute(gap_fill(series))) for BOTH bases (the anti-Phase-101 guard).
- [ ] Per-basis chart-series test (extend `FactsheetBody.basis.test.tsx`) — MTM bundle drives charts under `mark_to_market`; cash bundle under `cash_settlement`.
- [ ] SC-4 cash byte-identity extension — cash payload fields + nine golden py files byte-identical with the MTM bundle present.
- [ ] Wave-0 probe (not a gate): log `mtm_returns` sparsity on the Zavara book to resolve the Q3 partial-coverage blocker.

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | `strategy_analytics_series` RLS deny-all (`20260428120919:106-112`); factsheet reads via service-role admin after the caller's published/owner visibility gate (`composite-read-path.ts:32-38`); public factsheet exposes only published-strategy series (no per-user data in the shared payload cache). |
| V5 Input Validation | yes | Coerce the JSONB series payload defensively on read (mirror the strict `typeof`/`Array.isArray` coercion in `singleKeyBasisOpts` `composite-read-path.ts:235-246` and `deriveSegmentMarkers` `:90-101`) — a malformed series row must degrade to "no MTM bundle", never crash or fabricate. |
| V6 Cryptography | no | — |

**Threat note:** adding the MTM series to the payload does not widen visibility — it rides the SAME published/owner gate as the cash series and scalar MTM object already shipped. Cache key `${id}::${computedAt}` is user-agnostic (published rows) — unchanged.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The existing MTM compute may be whole-or-degrade, not interior-sparse | Q3 | If MTM has no interior sparsity, "partial coverage marked gaps" is honestly satisfied by span + existing gaps only; the plan must not manufacture gaps (no new math). Probe in Wave 0. |
| A2 | Factsheet reads the new series row directly via service-role admin (no RPC change), so Option A may need no DDL | Q2 | If a `kind` CHECK or RPC panel is desired, a real migration + test-project catch-up is needed — changes plan size + review load. Confirm with planner. |
| A3 | Composite MTM scalars are computed on a dense 0.0-gap-filled series while the persisted series is sparse | Q5 | The anti-divergence guard must encode the `gap_fill` transform; if the transform differs the guard gives false RED/GREEN. Verified via `_metrics_result_for:4157-4158` but confirm single-key applies the same fill. |

## Open Questions

1. **Does `mtm_returns` (single-key) / stitched-MTM (composite) carry interior honest-absent gaps distinct from cash?** → Wave-0 probe (Q3). Determines whether MTM-04's "full per-basis coverage mask" has interior marks or is span-level.
2. **Does the planner want any DDL** (a `kind` CHECK constraint / RPC panel entry) or the minimal no-DDL direct-read? → shapes migration-reviewer + rls-auditor + test-project catch-up load (Q2).
3. **Single-key scalar dense-fill parity** — confirm single-key `compute_all_metrics(mtm_returns)` at `:2983` applies (or does not) a `gap_fill` step, so the guard's transform matches both sites (A3).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Supabase (prod `khslejtfbuezsmvmtsdn`, test `qmnijlgmdhviwzwfyzlc`) | migration + series read/write | ✓ (MCP) | — | — |
| Railway analytics worker | re-derive backfill (ship-time) | ✓ | — | — |
| pytest / vitest | tests | ✓ | pytest / vitest 4.1.2 | — |

## Sources

### Primary (HIGH confidence — codebase read in full this session)
- `analytics-service/services/job_worker.py` — single-key MTM compute/discard (`:2357/:2983`), composite (`:4144-4165/:4198/:4230-4291/:4297-4336`)
- `src/lib/factsheet/build-payload.ts` (`:165/:203-311/:79-116`), `composite-read-path.ts` (full), `src/app/factsheet/[id]/v2/{page.tsx,FactsheetView.tsx,TimeSeriesChart.tsx,chart-configs.ts,basis-context.tsx}`
- `supabase/migrations/{20260428120919_strategy_analytics_series,20260522111839_csv_daily_returns,20260624120000_csv_daily_returns_per_key_axis}.sql`
- `services/{broker_dailies.py:123,metrics.py:398,stitch_composite.py:217}` (shared-helper composition targets)
- Phase 101/102 SUMMARYs; `.planning/phases/103-.../103-CONTEXT.md`; MEMORY (`project_unified_queued_path_scaffold`, `project_test_project_catchup_unmasks_stale_tests`, `project_prod_unified_backbone_on_composite_routing`)

## Metadata

**Confidence breakdown:**
- Route map (Q1): HIGH — every convergence/divergence point read at file:line.
- Persistence home (Q2): HIGH — both candidate tables + the per-key precedent read in full.
- Coverage mask (Q3): MEDIUM — render machinery HIGH; the interior-sparsity source is the one unverified item (A1, Wave-0 probe).
- Shared-helper / durable-vs-throwaway (Q6): HIGH — composition targets verified importable.

**Research date:** 2026-07-12
**Valid until:** 2026-08-11 (stable in-repo; re-check if the in-flight backbone program lands first)
