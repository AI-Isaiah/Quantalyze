# Phase 169: PAGETRUTH - Research

**Researched:** 2026-09-25
**Domain:** Cross-page number consistency (Next.js 16 RSC pages, TS factsheet math, analytics-service benchmark cache, one Postgres RPC)
**Confidence:** HIGH for root causes (each traced to code and quoted); MEDIUM for sequencing against Phase 167.1.2 (depends on an unmerged plan set)

## Summary

The eight success criteria trace to **seven independent root causes**. None of them needs a migration. Several criteria are one-line predicate bugs: SC1's empty state, SC6's windows, SC7's count and SC8's gate. SC3 and SC4 are "two sources for one number" defects, and they are the structural core of the phase.

- **SC1.** The 500 is a Postgres error inside `get_admin_compute_jobs`. `RETURNS TABLE("id" …)` declares an OUT variable named `id`, and the admin gate's `WHERE id = auth.uid()` is then ambiguous. I reproduced this on a throwaway local cluster. Every call fails before the gate returns anything. A second, latent defect sits behind it: the route calls the RPC with the service-role client, so `auth.uid()` is NULL. Once the ambiguity is fixed, the gate would return an empty set for every caller.
- **SC3.** Every factsheet's BTC column, and the /allocations Overview BTC column, is computed from a **bundled static JSON**. It ends 2026-05-12 and is forward-filled flat after that. That is why MTD and 3M read exactly +0.00%.
- **SC4.** The factsheet recomputes CAGR and Sharpe in TypeScript. Discovery, recommendations and my-strategies read the Python-persisted scalars. The factsheet overlays the persisted values only for composites and options strategies.
- **SC5.** The freshness chip changes its subject to "Track record" but still prints the compute date under it.
- **SC6.** `periodReturn` clamps its look-back to index 0, so a 3Y row on a 0.45-year record shows the whole-record return.
- **SC2 and SC7.** These sit on surfaces that Phase 167.1.2 is rebuilding. They must land **after** 167.1.2's PR C, and they read fields that phase introduces (`equityDailyReturns`, `equityHistoryState`, `account_share_kind`).

**Primary recommendation:** Six code plans do not depend on 167.1.2: 01 ADMINJOBS, 02 BENCHFEED, 03 RECS, 04 KPISOURCE, 05 BENCHTRUTH and 06 CHIP+WINDOWS-MATH. Ship them first as one PR, in two waves. Three more plans read fields that 167.1.2 PR C introduces: 07 RECORDLENGTH+3Y/5Y in MetricsColumn, 08 RISKTAB and 09 EXCHANGES. Ship those in a second PR, gated by a precondition check that PR C is merged. Take no migration. Record the dead RPC's DROP as an open question.

## User Constraints

No `169-CONTEXT.md` exists (no discuss step was run). The binding constraints are the ROADMAP `### Phase 169` entry, quoted verbatim:

### Locked Decisions (ROADMAP, verbatim)
- **Founder decision, 2026-09-25 (AskUserQuestion):** "the session QA sweep and the 2026-09-24 layout notes book as TWO phases; this numbers phase ships FIRST, Phase 170 PAGECOPY second. Phase 167.1.2 ACCOUNTTRUTH already owns the Allocations equity curve, Sharpe beside a negative return, the Scenario zero weights/UUID/$0 total, and the holdings total; they are EXCLUDED here."
- "Each contradiction below is traced to ONE source of truth and fixed there, not patched per page."
- **Depends on:** "none in code. Plan after 167.1.2 plan 01 (HIDE) so the two do not edit the same Allocations widgets at once."
- SC9: "Every fix carries a test that fails on the old behaviour (neuter → RED → restore), and each page is re-checked in the logged-in browser after deploy."

### Claude's Discretion
All implementation choices below (sources, predicates, plan split).

### Deferred / out of scope (verbatim from the ROADMAP and the 167.1.2 exclusion)
- The Allocations equity curve, Sharpe beside a negative return, the Scenario zero weights, UUID and $0 total, and the holdings total. All of these belong to Phase 167.1.2.
- Layout, copy, typos, raw enums, internal text and test text belong to Phase 170 PAGECOPY. That covers QA findings L1–L11 and Y1–Y4.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SC1 | /admin Compute Jobs: no HTTP 500, and no "No compute jobs found" on error | Root cause A (ambiguous `id` in the RPC, service-role `auth.uid()` NULL, empty state ignores `error`) |
| SC2 | The Risk tab and Overview/Scenario read one series | Root cause G (Risk widgets read `payload.strategies`; Overview reads the equity series) and the 167.1.2 boundary |
| SC3 | BTC benchmark current; a stale benchmark is shown as stale | Root cause B (static `BTC_DAILY` ending 2026-05-12, forward-filled flat) and the `/api/benchmark/btc` 1000-row truncation |
| SC4 | CAGR/Sharpe identical across surfaces | Root cause C (TS `compute()` vs persisted `strategy_analytics` scalars; overlay only on composite/options) |
| SC5 | Header date, "track record through" and record length agree; length stated one way | Root cause D (`FreshnessChip` prints `computedAt` under a "Track record" subject; `n/252` vs calendar years) |
| SC6 | No 3Y/5Y rows for shorter records | Root cause E (`periodReturn` clamps to index 0; trailing windows in `compute()` never null) |
| SC7 | /profile Exchanges counts live keys only and never repeats a balance | Root cause H (`activeKeys` = not disconnected, includes revoked); duplicate balance needs 167.1.2's marker |
| SC8 | /recommendations mandate copy and stale records | Root cause F (candidates render regardless of `mandateSet`; header copy hard-coded; no series-end shown) |
| SC9 | Neuter→RED→restore test per fix and a browser re-check | Validation Architecture below |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **The Supabase CLI is linked to PRODUCTION.** No `db push`, `db reset --linked`, `--db-url` or remote SQL. The schema comes from `supabase/schema/baseline.sql` only.
- **Migrations auto-apply to TEST, then to PROD, on merge**, with no human gate. Any migration needs the 3-reviewer pass (migration-reviewer, rls-policy-auditor, silent-failure-hunter) before merge. This research recommends none.
- **A failing TEST apply blocks PROD.** A data-reading `DO` block can refuse on the empty TEST database.
- Coverage thresholds: read them from `vitest.config.ts`. They are a ratchet, so never restate them.
- **CHANGELOG discipline:** every ship writes a unified entry, with the commit checklist cross-checked. `VERSION` and `package.json` must be byte-equal 4-digit strings. Never run `npm version`.
- Never write a CI skip token in a commit message or PR body, not even to deny it.
- `covered_digest` and `covered_files` are banned in verification frontmatter. Use `verified_at_sha` and `drift_subjects`, and exclude TODOS, CHANGELOG, VERSION and package.json.
- Read DESIGN.md before any visual or copy decision. The em-dash null rule applies ("a claim with no date, a metric with no provenance … fails"; `DESIGN.md:26-30`).
- AGENTS.md: "This is NOT the Next.js you know". Read `node_modules/next/dist/docs/` before writing route or RSC code.
- The repo is PUBLIC and `.planning/` is tracked. No identifiers, home paths, usernames or strategy names in any artifact.
- Never start `uvicorn` locally. It claims real PROD compute jobs. Run pytest only from `analytics-service/`.
- Do not hand-dispatch gsd agents. `gsd-tools` state handlers can clobber STATE.md and ROADMAP.md, so `git diff` after each one.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Admin job list (SC1) | API route (`/api/admin/compute-jobs`) | Browser (`ComputeJobsTable` states) | The route owns the admin gate and the read; the client only renders load, error and empty states |
| BTC price feed (SC3) | analytics-service (fetch + `benchmark_prices` cache) | Vercel cron (daily trigger), DB table | The only fetcher is Python (`services/benchmark.py`); TS must read the table, never re-fetch |
| Benchmark metrics (SC3) | Frontend server (RSC payload build) | Browser (`basis-context` re-derive) | `buildFactsheetPayload` is server-side; the MTM basis re-derives client-side, so the series must ride the payload |
| Headline CAGR/Sharpe (SC4) | analytics-service (persisted `strategy_analytics`) | Frontend server (overlay) | Ranking, discovery and recommendations already read the persisted value; the factsheet must read the same |
| Freshness and record length (SC5, SC6) | Browser (FactsheetView, MetricsColumn) | TS math (`compute.ts`) | Pure presentation plus one pure-math gate |
| Risk tab series (SC2) | Frontend server (payload field from 167.1.2) | Browser widgets | Widgets accept `compositeReturns`; the payload supplies it |
| Exchange key liveness (SC7) | Browser (`AllocatorExchangeManager`) | DB marker columns (167.1.2) | Count and balance display; the duplicate identity is 167.1.2's data |
| Recommendations gating (SC8) | Frontend server (RSC page) | DB (`series_end` projection) | Server decides the copy and the candidate rendering |

## Root Causes (one source of truth each)

### A. SC1: `/api/admin/compute-jobs` returns 500 [VERIFIED]

**The route:** `src/app/api/admin/compute-jobs/route.ts:34-49` [VERIFIED: read this session]:
```ts
const admin = createAdminClient();
const { data, error } = await admin.rpc("get_admin_compute_jobs", { p_limit, p_offset, p_status, p_kind, p_exchange });
if (error) { console.error("get_admin_compute_jobs RPC failed:", error);
  return NextResponse.json({ error: "Failed to fetch compute jobs" }, { status: 500, … }); }
```

**The function:** `supabase/schema/baseline.sql:5623-5663` [VERIFIED: read this session]. It is `RETURNS TABLE("id" "uuid", "strategy_id" "uuid", … "user_email" "text")`, `LANGUAGE "plpgsql" STABLE SECURITY DEFINER`, and its gate is:
```sql
SELECT COALESCE(
  (SELECT is_admin FROM profiles WHERE id = auth.uid() LIMIT 1),
  false
) INTO v_is_admin;
```
The body is identical in the original migration, `supabase/migrations/20260412094449_compute_jobs_admin_and_defer.sql:337`. No later migration redefines it. The baseline is a dump of PROD's catalogue, so PROD carries this body.

**The falsification** was run on a throwaway local PostgreSQL 16.13 cluster. The input was the function body verbatim, minimal `profiles` and `compute_jobs_admin` tables, and an `auth.uid()` stub. The output, pasted:
```
ERROR:  column reference "id" is ambiguous
LINE 1: ...ECT COALESCE((SELECT is_admin FROM profiles WHERE id = auth....
DETAIL:  It could refer to either a PL/pgSQL variable or a table column.
QUERY:  SELECT COALESCE((SELECT is_admin FROM profiles WHERE id = auth.uid() LIMIT 1), false)
CONTEXT:  PL/pgSQL function f() line 4 at SQL statement
```
[VERIFIED: local PG 16.13 repro]. PROD runs PG 17 with the default `plpgsql.variable_conflict = error`, and I assume it raises identically [ASSUMED]. The error fires on **every** call, before any row is read. So the function has never returned rows through this route. There is no `supabase/tests` gate for it: a grep for `get_admin_compute_jobs` under `supabase/tests` hits only a comment.

**The latent second defect.** The route passes the **service-role** client (`src/lib/supabase/admin.ts`, `createSupabaseClient(url, serviceKey)`). `auth.uid()` is then NULL, so after an ambiguity fix the gate would hit `IF NOT v_is_admin THEN RETURN;` and return an empty set for every caller. That is a permanent "No compute jobs found".

**The "No compute jobs found" on error.** `src/components/admin/ComputeJobsTable.tsx:298` [VERIFIED] renders `{jobs.length === 0 && !loading && (… No compute jobs found.` and ignores `error`. On a failed load, `jobs` stays `[]`, so both the alert (`role="alert"`, the error text) and the false empty row render.

**The "header counts a job in progress".** That count is not a compute-job count. It is `IntroRequestsTab`'s summary, `src/components/admin/AdminTabs.tsx:217`: `{counts.intro_made} in progress`, where `counts.intro_made` = intro requests with status `intro_made` [VERIFIED]. `TabsContent` is Radix and renders only the active panel (`src/components/ui/Tabs.tsx:102-103`). There is no compute-jobs header to reconcile. SC1's second clause is therefore satisfied by the empty-state fix alone. Relabelling the intro counts ("intro requests") is copy, which belongs to Phase 170.

**Fix (no migration).** The route reads the admin view directly with the service-role client, after its existing `isAdminUser` gate. This mirrors its sibling page, `src/app/(dashboard)/admin/compute-jobs/page.tsx`, which already reads `compute_jobs` via `createAdminClient()` with an explicit column list. The read is: `admin.from("compute_jobs_admin").select("<the 21 RPC columns, explicit>")`, with `.eq` filters only when the param is present, `.order("created_at", { ascending: false })` and `.range(offset, offset + limit - 1)`. Keep the limit clamp at 1..200 and the offset at ≥0. The view `compute_jobs_admin` (`baseline.sql:10579-10608`) is `security_invoker`, exposes no `claim_token`, and is granted to `service_role` (`baseline.sql:15671`). Keep the `src/__tests__/compute-jobs-claim-token-not-leaked.test.ts` grep gate green: never `select("*")`. The client change is `jobs.length === 0 && !loading && !error`.

### B. SC3: BTC benchmark frozen at 2026-05-12 [VERIFIED]

**Source of every factsheet and /allocations Overview BTC number.** `src/lib/factsheet/benchmarks.ts:1-25` [VERIFIED]:
```ts
import btcDaily from "./data/btc-daily.json";
/** Bundled benchmark price series. Sourced from Yahoo Finance daily closes, covering 2023-04-26 onwards. … Extending coverage is a follow-on (either expand the static fixture or add a server-side fetcher). */
export const BTC_DAILY: DailyPrice[] = btcDaily as DailyPrice[];
export const BENCH_END = BTC_DAILY[BTC_DAILY.length - 1]?.date ?? null;
```
I measured the fixture coverage this session: `btc-daily.json 1113 2023-04-26 2026-05-12`, `eth-daily.json … 2026-05-11`, `spx/gld/ief-daily.json … 2026-05-08`. The last change to `btc-daily.json` is commit `a7abfadd5` (2026-05-20) [VERIFIED: git log].

**The forward-fill that turns "no data" into "0% return".** In `src/lib/factsheet/align.ts:12-32`, `alignReturns` carries `lastP` forward and pushes `a / b - 1`, which is **0** on every day past the fixture's end. `build-payload.ts:360-367` says so out loud: "comparator series just go flat on the unsupported dates". The consumers are `build-payload.ts:229-232` (`deriveSeriesBundle`, which is also run client-side from `basis-context.tsx`), `build-payload.ts:407-410` (`buildFactsheetPayload`) and `comparator-block.ts` (`compute(benchReturns, …)` → `mtd`, `p3m`, `win_rate`, `ann_vol`, `max_dd`). Every strategy day after 2026-05-12 is therefore a 0.00% BTC day. That explains: MTD and 3M exactly +0.00%; a win rate of 11.45%, because zero days are not wins; a depressed volatility and drawdown; and an IR/alpha whose sign disagrees (QA D8 is downstream of this). /allocations Overview goes through `allocator-portfolio-payload.ts:3,46` → `buildFactsheetPayload`, so it has the same source.

**The DB feed exists but is not used by the factsheet.** `benchmark_prices(date, symbol, close_price)` has PK `(date, symbol)` (`baseline.sql:10254-10258`, `:12015-12016`) and public SELECT RLS (`:13808`, `:13812`). The only writer is `analytics-service/services/benchmark.py` `get_benchmark_returns`. It is **lazy**: it refetches from Binance, then CoinGecko, and upserts only on a cache miss during an analytics compute (`analytics_runner.py:1723`, `routers/portfolio.py:986`, `job_worker.py:5414`). No scheduled refresh exists (the `vercel.json` crons list has no benchmark job) [VERIFIED].

**A second truncation defect on the Scenario path.** In `src/app/api/benchmark/btc/route.ts:105-109` [VERIFIED], `.from("benchmark_prices").select("date, close_price").eq("symbol", "BTC").order("date", { ascending: true })` has no range. PostgREST caps it at `max_rows` (`supabase/config.toml:18`: `max_rows = 1000`), so it returns the **oldest** 1000 rows. Each fresh fetch upserts `days + 1 = 1001` completed days and the table keeps every older row, so it holds more than 1000 rows. The route's newest row therefore lags today, and the lag grows by one day per day. PROD's `max_rows` and row count are [ASSUMED].

**Fix (no migration).**
1. **Refresh.** Add a daily Vercel cron route, `/api/cron/refresh-benchmark`, with the `CRON_SECRET` Bearer pattern of `src/app/api/cron/warm-analytics/route.ts`. It calls a new analytics-service endpoint under `/internal` (the `verify_service_key` pattern, `main.py:783`). That endpoint calls the existing `get_benchmark_returns("BTC")` and returns `{through: <newest cached date>, stale: bool}`. It returns non-2xx on `None`, because the cron only alarms on non-2xx (comment at `warm-analytics/route.ts`). Do not write a second fetcher in TS.
2. **One read path.** Add `src/lib/factsheet/benchmark-source.ts`, which pages `benchmark_prices` newest-first in 1000-row pages until a short page, then reverses. Both `/api/benchmark/btc` and the factsheet payload builders use it. Merge rule: DB closes win on every date the DB has, and the bundled fixture supplies only dates strictly before the DB's first date. This avoids a Yahoo/Binance seam day inside the DB window.
3. **Coverage, not flat.** Each comparator block carries `through` (its last real price date). `alignReturns` must not fabricate 0 returns past `through`. Either clip the comparator's `compute` to the overlap, or mark those days `null`. A window (MTD, 3M, 6M, YTD, 1Y) that ends after `through` renders the em-dash with a dated caption ("BTC prices through <date>"), never +0.00%. SPX, ETH, GLD and IEF stay static (the DB has no feed: `benchmark.py` raises `Unsupported benchmark` for anything but BTC). They get the same `through` label automatically, which is honest.
4. The series must ride the payload (bounded to the strategy's date range), because `basis-context.tsx` re-derives `deriveSeriesBundle` in the browser, where a server DB read is impossible.

### C. SC4: CAGR/Sharpe differ between the lists and the factsheet [VERIFIED]

| Site | Computation | Read by |
|------|-------------|---------|
| `analytics-service/services/metrics.py` `compute_all_metrics` (CAGR `:1683-1690`: `(1+total_return) ** (_CALENDAR_DAYS_PER_YEAR / _elapsed_days) - 1` over the post-last-break suffix; Sharpe on `stat_returns`) → persisted `strategy_analytics.cagr`, `.sharpe`, `.cumulative_return`, `.volatility`, `.max_drawdown`, `.sortino`, `.calmar` (`baseline.sql` `strategy_analytics` columns) | Python, calendar/365, suffix-aware | **Discovery** (`queries.ts:335` projection `"computed_at, computation_status, cumulative_return, cagr, sharpe, …"`), **recommendations** (RPC `get_allocator_recommendations` → `recommendations/page.tsx:129-130`, `:220-221`), **my-strategies** (`getMyStrategies`, `strategy_analytics (*)`, `queries.ts:637`) |
| `metrics_json_by_basis.cash_settlement` | Python, same engine | Factsheet **only for composites and options** |
| `src/lib/factsheet/compute.ts:18-50` `compute()`: `years = days / 365.25`, `cagr = eq[n-1] ** (1/years) - 1` over the whole series; Sharpe via `pstdev` over all days | TS second computation | **Factsheet** KpiStrip (`FactsheetView.tsx:1422-1423`) and MetricsColumn §I, for every single-key, non-options strategy |
| `src/lib/factsheet/og-metrics.ts` `computeOgHeadline` | TS third computation (CAGR hidden < 0.95y) | OG image card (`src/app/api/og/factsheet/[id]/route.tsx:133`) |

The mechanism is `build-payload.ts:405` [VERIFIED]: `const strategyMetrics = overlayBasisScalars(computedMetrics, opts?.metricsByBasis?.cash_settlement);`. `basis-metrics.ts:33-35` documents the gap itself: "`serverScalars` ABSENT … This is the single-key / non-composite path: no persisted by-basis object, so the client-computed `base` is the coherent value". `fetch-and-build-payload.ts:224`: "The assembly returns `{}` for every non-options single-key strategy". The overlay's own rationale is already the SC4 answer. `build-payload.ts` explains: "The KpiStrip's seven headline scalars read the PERSISTED `cash_settlement` basis so they agree with discovery / ranking / acceptance" [CITED: build-payload.ts:396-404].

**Fix (no migration).** In the ONE shared single-key owner, `readSingleKeyBasisOpts` (`src/lib/factsheet/composite-read-path.ts:509`), which is called by both `fetch-and-build-payload.ts:240` and `discovery/[slug]/[strategyId]/page.tsx:141`, supply the persisted top-level scalars as the cash headline when `cash_settlement` is absent. Map them through `BASIS_KPI_MAP` (`basis-metrics.ts:18-26`: `cumulative_return, volatility, max_drawdown, cagr, sharpe, sortino, calmar`). Gate this on the row being rankable (`isRankableAnalyticsRow`, the same predicate recommendations uses). Otherwise a failed run's leftovers would overlay. The OG card reads the same persisted scalars and keeps its display policy (hide CAGR < 0.95y). /allocations Overview is the allocator's own book, has no persisted scalars, and is 167.1.2's surface, so it is not touched.

### D. SC5: the header date, "track record through" and record length [VERIFIED]

- `FactsheetView.tsx:1195-1272` `FreshnessChip`: when `seriesIsBinding`, the eyebrow reads `{subject} · {label}` = "Track record · old" (`:1266`). The date line under it still prints `{formatIsoDate(computedAt)}` with `({Math.round(days)}d)` (`:1269-1270`), which is the compute date. `SeriesRecencyLine` (`:1317-1326`) then prints "Track record through {end.formatted}". So there are two dates under one subject. **Fix:** when the series arm binds, the chip's date line shows the series end and its age (`resolveSeriesEnd`, the same derivation the line uses), and the compute date moves to its own labelled line ("Computed <date>"). The chip's 3d/7d ladder is unchanged.
- Record length appears in three phrasings over two clocks. `MandatePanels.tsx:42`: `({n} trading days, {years.toFixed(2)} years)`. `MetricsColumn.tsx:66`: `Years Observed {m.years.toFixed(2)}`. `MetricsColumn.tsx:72`: `Only {m.n} observations ({(m.n / 252).toFixed(2)}y)`. `m.years` is calendar (`compute.ts:36-37`, `days / 365.25`), while `(m.n / 252)` is an observation clock. On a daily crypto series, 166 observations give 0.45 calendar years but 0.66 "y". **Fix:** one pure formatter (for example `src/lib/factsheet/record-length.ts`) that takes `{n, years}` and states the length once, in calendar years (domain rule: RETURN/CAGR on the calendar clock). All three sites call it. "Trading days" is wrong for 24/7 venues, so it becomes "daily observations".
- ⚠️ **Conflict with 167.1.2 plan 07, surfaced per CLAUDE.md Rule 7.** That plan (167.1.2 branch, commit `d3649d486`) edits the same `MetricsColumn.tsx` lines. Its must-have is "the observation warning, its 'years' figure and its 3Y / 5Y look-backs derive from payload.periodsPerYear". That keeps an observation clock for a length and for return windows. It removes the /252 error for crypto but still disagrees with the calendar "Years Observed" on sparse CSV/MT5 series. It also keeps the index-0 clamp that causes SC6. Recommendation: 169's MetricsColumn plan lands **after** 167.1.2 PR C and replaces the plan 07 look-back with the calendar gate below. Alternatively, the orchestrator trims plan 07 to the threshold sentence before it executes. Either way, only one of the two may own the `periodReturn` lines.

### E. SC6: 3Y and 5Y rows on sub-year records [VERIFIED]

`MetricsColumn.tsx:403-424` `CumulativeReturnsPanel`:
```ts
const periodReturn = (lookbackDays: number): number | null => {
  if (n < 2) return null;
  const startIdx = Math.max(0, n - 1 - lookbackDays);
```
with `<Row label="3 Year" value={pct(periodReturn(3 * 252), true)} …/>` and `"5 Year" … periodReturn(5 * 252)`. On a record shorter than the look-back, `startIdx` clamps to 0 and the row shows `eq[n-1]/eq[0]-1`. That is the record return **excluding day 1**, which is why it differs from "Since Inception" (−43.01% vs −42.76%). The same class sits in `compute.ts:141-184`: `compoundFrom(offsetDays(90|182|365))` never returns null, so 3M, 6M and 1Y also show the since-inception return on a shorter record. **Fix:** one calendar-cutoff helper. A trailing window of D calendar days returns `null` when the first date is after `lastDate − D`, and the row renders the em-dash (or the row is hidden; this is the planner's call against DESIGN.md's null rule). Apply it to `compute()`'s `p3m`, `p6m` and `p1y`, and to the 3Y/5Y rows as 3×365 and 5×365 calendar days. That is not 3×252 observations: 3×252 = 756 days, which on a daily crypto series is about 2.07 calendar years. MTD and YTD keep their calendar cutoffs. Note that `compute()` also feeds the benchmark summary (`comparator-block.ts`) and the allocator Scenario payload, so a short record nulls the bench windows too. That is the correct result, and the `__snapshots__` in `src/lib/factsheet/` will move.

### F. SC8: /recommendations [VERIFIED]

`recommendations/page.tsx:80` sets `const mandateSet = Boolean(preferences?.mandate_archetype);`. `:232` hard-codes `description="Top 3 strategies that fit your mandate. Updated daily."`. `:245` renders `{!mandateSet ? <NoMandateState /> : null}` **and** `:251` renders `{candidates.length > 0 && (` independently of `mandateSet`. The match engine scores allocators with no mandate on defaults (`analytics-service/services/match_defaults.py:39,57`, `"mandate_archetype": None`), so a batch exists and both blocks render. **Fix:** a single `mandateSet` branch drives both the header description and the candidate section. With no mandate, the page either withholds the list or labels it "scored on default preferences" with the set-mandate CTA; it never says "fit your mandate". **Stale records:** extend the already-bounded status read (`:162-170`, `.select("strategy_id, computation_status")` over the RPC's own ids) with the existing projection device `series_end:returns_series->-1->>date` (`queries.ts:283-298`, `:335`). Render the track-record age through the existing `resolveEffectiveRecency` (`src/lib/freshness.ts`) / `SyncBadge` copy ("Track record ends …"). Do not add a new threshold. **Predicate drift (open question):** `/allocations` uses `deriveMandateIsSet` (`queries.ts:3124-3131`: `max_weight` or `preferred_strategy_types`). Recommendations uses `mandate_archetype`. Both are written by `MandateForm`. Unifying them means editing `queries.ts`, which 167.1.2 plans 01, 07 and 11 also edit.

### G. SC2: the Risk tab reads a different series [VERIFIED]

`RiskTabPanel.tsx` passes the whole payload to six widgets. VaR/ES and TailRisk compute `data.compositeReturns ?? buildCompositeReturns(data.strategies)` (`widgets/risk/VarExpectedShortfall.tsx:36`, `TailRisk.tsx:40`). `buildCompositeReturns` (`widgets/lib/composite-returns.ts`) weights `strategy.strategy_analytics.daily_returns` by `weight ?? current_weight ?? 0`, and `if (w === 0) continue;`. `payload.strategies` is the legacy `portfolio_strategies` set. It is empty or zero-weighted for a key-connected book, so the result is "Insufficient return data" (VaR shows it when `allReturns.length < 10`). `AlphaBetaDecomposition.tsx:20-25` is a **different quantity**: "portfolio daily returns vs an equal-weight benchmark of all strategies", not vs BTC. `CorrelationMatrix.tsx:98` reads `analytics.correlation_matrix` or `strategies`. The Overview reads the equity-curve returns (factsheet payload); the Scenario reads `perKeyReturnsByApiKeyId`. `riskWidgetDataSchema` already accepts `compositeReturns` ("an optional precomputed override (injected by tests; absent in prod)", `widgets/lib/widget-data.ts`).

**Boundary with 167.1.2 (decided here).** 167.1.2 owns the book series. Plan 01 adds `equityHistoryState: "rebuilding" | "ready"` and withholds the curve. Plan 11 adds `equityDailyReturns: DailyPoint[]` from `payload.returns` (quoted from the 167.1.2 plans 01 and 11). 169 owns only the Risk tab's **consumption**:
- When `rebuilding`, the Risk tab renders the same `EquityHistoryRebuilding` state, not "insufficient data".
- When `ready`, `RiskTabPanel` passes `compositeReturns = equityDailyReturns` to VaR, TailRisk and RiskDecomposition.
- Alpha/beta is computed vs BTC from the same series and the fixed BTC feed (SC3), so it agrees with Overview's "α vs BTC".
- Correlation reads the per-key set the Scenario uses, labelled through 167.1.2's `apiKeyLabelById`.

This needs 167.1.2 PR C merged. It edits none of 167.1.2's files: `RiskTabPanel.tsx` and `widgets/risk/*` are absent from every 167.1.2 `files_modified` list.

### H. SC7: /profile Exchanges [VERIFIED]

`AllocatorExchangeManager.tsx:719` is `const activeKeys = keys.filter((k) => k.disconnected_at === null);`. A credential-revoked key (`sync_status = 'revoked'`, never disconnected) is therefore "connected" and counted in `${activeKeys.length} connected · …` (`:733-738`). The balance is `formatUsd(key.account_balance_usdt)` (`:795`), a per-key column written on every sync (`analytics-service/routers/exchange.py:1425`, `routers/cron.py:1063`). Three keys on one exchange account each hold the same account's balance. That is 167.1.2's identity defect, marked by its `account_share_kind`/`account_shared_with_api_key_id` (167.1.2 D-11). **Fix:** one liveness predicate, "connected" = `disconnected_at === null && sync_status !== 'revoked'`. 167.1.2 D-09 already defines "departed" = disconnected OR revoked, and its plan 09 adds `src/lib/departed-history.ts`; reuse that predicate rather than writing a third. A revoked key's balance renders as "last known … as of <last_sync_at>" or not at all. A key marked `duplicate`/`composite_member` renders no balance and points to the holder (167.1.2 plan 04's `accountShareNote` sentence is the one source of that wording). `AllocatorExchangeManager.tsx` is edited by 167.1.2 plans 04 and 09, so this plan must land after PR C.

## Standard Stack

No new packages. Everything uses what is installed.

| Library | Version | Use here |
|---------|---------|----------|
| next | ^16.2.11 (package.json) | RSC pages, route handlers, `vercel.json` crons |
| vitest | ^4.1.2 (package.json) | All TS tests (`npm test` = `vitest run`) |
| @supabase/supabase-js | installed | `.from().select().range()` paging |
| pytest (analytics-service) | installed in the main checkout `.venv` | The refresh endpoint test |

## Package Legitimacy Audit

This phase installs no external packages. There is nothing to audit. **Packages removed:** none. **Flagged:** none.

## Architecture Patterns

### System Architecture Diagram

```
                 Vercel cron (daily) ──► /api/cron/refresh-benchmark ──X-Service-Key──► analytics /internal/benchmark/refresh
                                                                                          │ get_benchmark_returns("BTC")
                                                                                          ▼ Binance → CoinGecko → upsert
                                                                                   benchmark_prices (date,symbol PK)
                                                                                          │ paged newest-first
                                     ┌────────────────────────────────────────────────────┤
                                     ▼                                                    ▼
                       benchmark-source.ts (ONE reader, DB ∪ pre-DB fixture, `through`)   /api/benchmark/btc → Scenario overlay
                                     │
strategy_analytics (persisted scalars + series) ─► readSingleKeyBasisOpts ─► buildFactsheetPayload
                                                   (persisted headline)         │ strategy series + BTC series + through
                                                                                ▼
                                             payload ─► KpiStrip / MetricsColumn / MandatePanels / FreshnessChip
                                                    └─► basis-context (browser re-derive, same series)

portfolio book (167.1.2: equityHistoryState, equityDailyReturns) ─► RiskTabPanel ─► compositeReturns ─► VaR / Tail / α-β vs BTC
admin page ─► /api/admin/compute-jobs ─isAdminUser─► service-role read of compute_jobs_admin ─► ComputeJobsTable (error ≠ empty)
```

### Pattern 1: persisted-first overlay (SC4)
**What:** The display reads the stored scalar and falls back to the client computation only when no trustworthy stored value exists. **Where:** the `overlayBasisScalars` mechanism already exists; the fix changes only its input for the single-key arm.

### Pattern 2: coverage-dated comparator (SC3)
**What:** A comparator carries its own `through` date. A window that extends past it is null plus a dated caption, never a forward-filled zero. This matches the DESIGN.md "dated document" principle.

### Pattern 3: error ≠ empty (SC1)
This repo's precedent: "149 review WR-01 — error ≠ empty" (`my-strategies/page.tsx:69`). The empty state renders only when there is no error.

### Anti-Patterns to Avoid
- **Patching per page.** For example, special-casing `+0.00%` in MetricsColumn. The ROADMAP forbids it: fix at the one source.
- **A second BTC fetcher in TS.** Python owns fetching and caching.
- **A silent fallback to the bundled fixture on a DB read error.** That fallback is the stale bug itself. On a read error, render the comparator unavailable.
- **Editing `queries.ts`, `AllocationDashboardV2.tsx`, `ScenarioComposer.tsx` or `AllocatorExchangeManager.tsx` before 167.1.2 PR C merges.** The same files are in flight there.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| BTC price fetch and cache | A TS fetcher | `services/benchmark.py` `get_benchmark_returns` | It already handles completed-days-only, gap detection and a stale fallback |
| Series end date | A new query | `series_end:returns_series->-1->>date` projection + `resolveEffectiveRecency` | One ladder; a fourth freshness ladder is forbidden (`FactsheetView.tsx` SeriesRecencyLine doc) |
| Headline overlay | A new mapping | `BASIS_KPI_MAP` + `overlayBasisScalars` | Strict NaN→"—" semantics already exist |
| Key "departed" predicate | A third predicate | 167.1.2's `src/lib/departed-history.ts` (D-09) | One definition across the compose and the card |
| Admin read | A new RPC or migration | The service-role read of `compute_jobs_admin`, as the sibling page does | Avoids a PROD auto-apply |

## Common Pitfalls

### Pitfall 1: the overlay breaks chart/headline invariance (SC4)
Python's `cumulative_return` compounds the post-last-break suffix (`metrics.py:1683`), while the chart's endpoint is TS `cumEq` over the whole series. On a chain-broken series, "Cumulative Return" would disagree with the chart's end. **Avoid:** pin a test that the persisted `cumulative_return` equals the chart endpoint on a clean series. On a broken-chain series, the existing `dataQuality` caveat must render. **Warning sign:** snapshot diffs in `FactsheetBody.*` tests.

### Pitfall 2: the benchmark series is too big for the RSC payload
The whole DB history is about 1,200 points × 5 comparators. **Avoid:** ship only BTC closes within `[strategyStart − 1d, strategyEnd]`.

### Pitfall 3: null windows cascade (SC6)
`compute()` feeds `comparator-block.ts`, the allocator payload and the Scenario payload. Nulling `p1y` changes their shapes, because `ComputeResult` types become `number | null`. **Avoid:** widen the type once and let tsc find every reader. Snapshots move deliberately; explain each moved snapshot in the SUMMARY.

### Pitfall 4: PostgREST `max_rows` silently truncates
Any unbounded `.order()` read of a growing table returns the first 1000 rows (`supabase/config.toml:18`). **Avoid:** page explicitly and assert a short final page.

### Pitfall 5: cron alarms only on non-2xx
A refresh that "succeeds" with `{ok:false}` reads green. **Avoid:** return 500 when `get_benchmark_returns` returns `None` or `is_stale=True` (the pattern documented at `warm-analytics/route.ts`).

### Pitfall 6: two phases editing MetricsColumn (SC5/SC6 vs 167.1.2 plan 07)
The same `periodReturn` and warning lines are in both. **Avoid:** land after PR C and rebase, or trim plan 07 (Open Question 2).

### Pitfall 7: an effect never identifies the writer (browser re-check, SC9)
A correct number after deploy may come from a cache. The factsheet cache key is id-only (`fetch-and-build-payload.ts` header comment). **Avoid:** re-check each page with the deployed commit hash confirmed. For factsheets, check a strategy whose cache has drained, or bust it via the publish tag.

## Code Examples

```ts
// SC1 — route read (shape; columns quoted from baseline.sql:5623 RETURNS TABLE)
const { data, error } = await admin
  .from("compute_jobs_admin")
  .select("id, strategy_id, portfolio_id, kind, status, attempts, max_attempts, next_attempt_at, claimed_at, claimed_by, last_error, error_kind, idempotency_key, exchange, trade_count, created_at, updated_at, metadata, strategy_name, portfolio_name, user_email")
  .order("created_at", { ascending: false })
  .range(p_offset, p_offset + p_limit - 1);   // + .eq("status"|"kind"|"exchange") only when present
```
```ts
// SC6 — calendar trailing window (shape)
const trailing = (days: number): number | null => {
  const cutoff = offsetDays(days);                 // compute.ts helper
  return new Date(dates[0]) > cutoff ? null : compoundFrom(cutoff);
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bundled Yahoo fixtures for comparators | DB-fed BTC + dated coverage | This phase | The BTC column moves on every factsheet |
| Client `compute()` headline for single-key | Persisted scalars everywhere | This phase (composites since Phase 90) | The factsheet matches discovery |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | PROD PostgREST `max_rows` = 1000 (local config says 1000) | B | The truncation fix is still harmless (paging is correct at any cap) |
| A2 | PROD (PG 17) raises the same ambiguity error as the local PG 16 repro | A | If PROD somehow resolves it, the 500 has another cause. Check Vercel logs for the `get_admin_compute_jobs RPC failed:` line before closing SC1 |
| A3 | PROD `benchmark_prices` holds more than 1000 BTC rows | B | Scenario lag is smaller than stated; the fix is unchanged |
| A4 | The Vercel plan allows one more cron (8 exist, one at `*/15`) | B | Fall back to adding the refresh call inside the existing daily `warm-analytics` cron |
| A5 | Which mandate predicate is canonical (`mandate_archetype` vs `deriveMandateIsSet`) | F | Page self-consistency holds either way; cross-surface agreement needs a decision |
| A6 | 167.1.2 ships `equityDailyReturns` and `equityHistoryState` as written in its plans 01 and 11 | G | The SC2 plan's inputs change; re-read the merged code before planning 08 |
| A7 | BTC cum 13.80% equal to BTC vol 13.80% on /allocations is a coincidence of the flat series | B | If it is a field-mapping bug, the SC3 tests must catch it: pin cum ≠ vol on a fixture |
| A8 | The QA's "1 in progress" was the Intro Requests summary (Radix unmounts inactive panels) | A | If a compute-jobs header exists elsewhere, SC1 needs one more reconciliation |

## Open Questions (all RESOLVED 2026-09-25; pointers inline)

1. **(RESOLVED 2026-09-25: not dropped here; CONTEXT D-01, TODOS `[169-DEAD-ADMIN-JOBS-RPC]`) Drop the dead `get_admin_compute_jobs`?** After fix A it has no caller, and its body is broken. The fix-or-drop rule says drop. A DROP is a migration, which means auto-apply, 3 reviewers, `database.types.ts` and the census pins. Recommendation: do not bundle it into this phase. Record it for the next migration-carrying phase, with this research as the evidence. The orchestrator decides.
2. **(RESOLVED 2026-09-25: 169 plan 07 owns it, after PR C; CONTEXT D-02, D-17) MetricsColumn ownership vs 167.1.2 plan 07.** Recommendation: 169 plan 07 owns the calendar-gated windows and the record-length formatter, and lands after PR C. Tell the 167.1.2 orchestrator that plan 07's `periodReturn` look-back change will be superseded.
3. **(RESOLVED 2026-09-25: unified on `deriveMandateIsSet` in plan 10, PR 2, rather than the page-local recommendation below; CONTEXT D-03) Mandate predicate unification (A5).** Recommendation: page-local self-consistency now. Unify after 167.1.2 releases `queries.ts`.
4. **(RESOLVED 2026-09-25: routed to Phase 170; CONTEXT D-04) Month-to-date on an ended record.** `compute()`'s `mtd` is the record's last month, not today's. With SC3's `through` and SC5's series-end line it is dated. A relabel ("last month of record") is copy, for Phase 170.
5. **(RESOLVED 2026-09-25: D12 and D14 routed to Phase 170, D14 as amended; own-strategy recommendation fixed in plan 03 at the engine; CONTEXT D-05, D-06) Not covered by any SC:** QA D12 (venue label on CSV strategies), D14 (attribution to verify), recommending the viewer's own strategy. Route them via the ROADMAP if they are data-integrity; otherwise fix-or-drop in Phase 170.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | vitest, tsx | ✓ | v25.8.1 | — |
| node_modules in the 169 worktree | vitest | ✗ | — | `npm ci` in the worktree (resolution walks UP and the sibling checkout is not an ancestor) |
| analytics-service `.venv` in the 169 worktree | pytest | ✗ | — | Create a venv in the worktree, or run pytest with the main checkout's `.venv` python from `analytics-service/` |
| psql + postgresql@16 binaries (Homebrew) | optional local SQL repro | ✓ | 16.13 | — |
| Remote DB access | — | Not to be used | — | The CLI is linked to PROD; never used |

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.2; pytest (analytics-service) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run <file>` |
| Full suite command | `npm test` (and `cd analytics-service && pytest`) |

### Phase Requirements → Test Map
| Req | Behavior | Type | Command | File Exists? |
|-----|----------|------|---------|-------------|
| SC1 | Route reads the view, 500 only on a read error, admin gate precedes the read, no `claim_token` | unit | `npx vitest run src/app/api/admin/compute-jobs/route.test.ts` | ✅ (rewrite the rpc mocks) |
| SC1 | Error renders the alert and NOT "No compute jobs found" | component | `npx vitest run src/components/admin/ComputeJobsTable.test.tsx` | ✅ extend |
| SC2 | Risk tab shows rebuilding state / uses `equityDailyReturns`; α-β vs BTC | component | `npx vitest run src/app/(dashboard)/allocations/widgets/risk/risk.test.tsx` | ✅ extend + new RiskTabPanel test |
| SC3 | Past `through`, the windows are null, not 0; the Scenario route returns the newest rows (paging) | unit | `npx vitest run src/lib/factsheet/align.test.ts src/app/api/benchmark/btc/route.test.ts` | ✅ extend |
| SC3 | The refresh endpoint calls `get_benchmark_returns`, non-2xx on None/stale | pytest | `pytest tests/test_benchmark_refresh.py` | ❌ Wave 0 |
| SC3 | Cron route: 401 without the secret, 500 on upstream failure | unit | `npx vitest run src/app/api/cron/refresh-benchmark/route.test.ts` | ❌ Wave 0 |
| SC4 | Single-key factsheet CAGR/Sharpe equal the persisted values | unit | `npx vitest run src/lib/factsheet/composite-read-path.test.ts` (or a new test beside `basis-metrics.test.ts`) | partial |
| SC5 | Chip date = series end when the series binds; one record-length phrase | component | `npx vitest run src/app/factsheet/[id]/v2/FactsheetView.chip-honesty.test.tsx` | ✅ extend |
| SC6 | 3M/6M/1Y/3Y/5Y null on shorter records (calendar cutoff) | unit | `npx vitest run src/lib/factsheet/compute.metrics.test.ts` | ✅ extend |
| SC7 | The count excludes revoked keys; a duplicate shows no balance | component | `npx vitest run src/components/exchanges/AllocatorExchangeManager.test.tsx` | ✅ extend |
| SC8 | No "fit your mandate" without a mandate; series-end age shown | component | new `src/app/(dashboard)/recommendations/page.test.tsx` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the quick command for the touched test files.
- **Per wave merge:** `npm test` plus `npx tsc --noEmit` plus lint. Run pytest when Python was touched.
- **Phase gate:** the full suite green, each fix's neuter→RED→restore recorded in its SUMMARY, then the logged-in browser re-check of /admin, /allocations (Risk), three factsheets, /discovery, /recommendations, /my-strategies and /profile?tab=exchanges on the deployed commit.

### Wave 0 Gaps
- [ ] `analytics-service/tests/test_benchmark_refresh.py`
- [ ] `src/app/api/cron/refresh-benchmark/route.test.ts`
- [ ] `src/app/(dashboard)/recommendations/page.test.tsx`
- [ ] `src/lib/factsheet/benchmark-source.test.ts`

## Proposed Plan Split

| Plan | SC | Wave | Files (primary) | Depends on |
|------|----|------|-----------------|------------|
| 01 ADMINJOBS | 1 | 1 | `api/admin/compute-jobs/route.ts`(+test), `components/admin/ComputeJobsTable.tsx`(+test) | — |
| 02 BENCHFEED | 3a | 1 | `api/benchmark/btc/route.ts`(+test), `lib/factsheet/benchmark-source.ts`(+test), `api/cron/refresh-benchmark/route.ts`(+test), `vercel.json`, `analytics-service/routers/internal.py`, `analytics-service/tests/test_benchmark_refresh.py` | — |
| 03 RECS | 8 | 1 | `(dashboard)/recommendations/page.tsx`(+new test) | — |
| 04 KPISOURCE | 4 | 1 | `lib/factsheet/composite-read-path.ts`, `api/og/factsheet/[id]/route.tsx`, `lib/factsheet/og-metrics.ts`(+tests) | — |
| 05 BENCHTRUTH | 3b | 2 | `lib/factsheet/build-payload.ts`, `benchmarks.ts`, `align.ts`, `comparator-block.ts`, `types.ts`, `fetch-and-build-payload.ts`, `factsheet/[id]/v2/basis-context.tsx`, `MandatePanels.tsx` comparator sentence | 02, 04 |
| 06 CHIP+WINDOWS-MATH | 5a, 6a | 2 | `factsheet/[id]/v2/FactsheetView.tsx` (FreshnessChip), `lib/factsheet/compute.ts` (+tests, snapshots) | — (disjoint from 05) |
| 07 RECORDLENGTH+3Y/5Y | 5b, 6b | 3 | `factsheet/[id]/v2/MetricsColumn.tsx`, new `lib/factsheet/record-length.ts`, `MandatePanels.tsx` line 42 | 05, 06, **167.1.2 PR C** |
| 08 RISKTAB | 2 | 3 | `(dashboard)/allocations/RiskTabPanel.tsx`, `widgets/risk/*`, `widgets/attribution/AlphaBetaDecomposition.tsx` (+tests) | 02, **167.1.2 PR C** |
| 09 EXCHANGES | 7 | 3 | `components/exchanges/AllocatorExchangeManager.tsx`(+test) | **167.1.2 PR C** |

Plans 05 and 07 both touch `MandatePanels.tsx`. Keep them in different waves (as above), or move the line-42 edit into 07 only.

**PRs.** PR 1 = waves 1–2 (independent of 167.1.2). PR 2 = wave 3, cut after 167.1.2 PR C merges. The first task of each wave-3 plan must check that `HEAD` contains PR C's merge commit and fail loudly otherwise. This is the same device as 167.1.2's `D12_ORDER_OK`. **Migrations:** none.

## Security Domain

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | SC1: `isAdminUser` must run BEFORE the service-role read (it already does, `route.ts:17-25`); keep `assertSameOrigin`; never project `claim_token`. Cron: `CRON_SECRET` Bearer with `safeCompare`; Python endpoint behind `verify_service_key` |
| V5 Input Validation | yes | Clamp `limit`/`offset`; `status`/`kind`/`exchange` pass as `.eq` values (parameterised by PostgREST); the benchmark route still takes no params |
| V6 Cryptography | no | — |

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Service-role read reachable by a non-admin | Elevation | Gate first, then read; a test asserts 403 makes no DB call |
| Cache-busting abuse on the public benchmark route | DoS | Existing `publicIpLimiter` is unchanged |
| Recommendations extra read widened by params | Info disclosure | Keep the read bounded to the RPC's returned ids (existing pattern, `page.tsx:162-170`) |

## Sources

### Primary (HIGH confidence, read this session)
- `supabase/schema/baseline.sql` (the function `:5623-5669`, the view `:10579-10613`, `compute_jobs`, `benchmark_prices`, `strategy_analytics`, `allocator_preferences`)
- `src/app/api/admin/compute-jobs/route.ts`, `src/components/admin/ComputeJobsTable.tsx`, `AdminTabs.tsx`, `src/components/ui/Tabs.tsx`
- `src/lib/factsheet/{benchmarks,align,build-payload,comparator-block,compute,basis-metrics,fetch-and-build-payload,og-metrics}.ts`, `src/lib/factsheet/data/*.json` (coverage measured)
- `src/app/api/benchmark/btc/route.ts`, `supabase/config.toml`, `analytics-service/services/benchmark.py`, `services/metrics.py:1590-1720`
- `src/app/factsheet/[id]/v2/{FactsheetView,MetricsColumn,MandatePanels}.tsx`
- `src/app/(dashboard)/recommendations/page.tsx`, `src/lib/queries.ts` (payload type, `deriveMandateIsSet`, per-key blend)
- `src/app/(dashboard)/allocations/RiskTabPanel.tsx`, `widgets/risk/*`, `widgets/attribution/AlphaBetaDecomposition.tsx`, `widgets/lib/{composite-returns,widget-data}.ts`
- `src/components/exchanges/AllocatorExchangeManager.tsx`
- The 167.1.2 CONTEXT (D-02, D-09, D-11) and plans 01, 04, 07, 09 and 11 `files_modified`/must-haves (167.1.2 branch at `d3649d486`)
- A local PostgreSQL 16.13 reproduction of the ambiguity error (output pasted above)

### Secondary / Tertiary
- None. No external documentation was needed. Every question was an in-repo root-cause trace, so the research-plan seam was not used.

## Metadata

**Confidence breakdown:**
- Root causes: HIGH. Each is quoted from source and SC1 was reproduced.
- Fix design: HIGH for SC1, SC3, SC4, SC6 and SC8; MEDIUM for SC2 and SC7 (they depend on 167.1.2's unmerged code).
- Sequencing: MEDIUM. It depends on when 167.1.2 PR C lands and on Open Question 2.

**Research date:** 2026-09-25
**Valid until:** 2026-10-09, or until 167.1.2 PR C merges, whichever is first (re-read the merged code before planning plans 07–09)
