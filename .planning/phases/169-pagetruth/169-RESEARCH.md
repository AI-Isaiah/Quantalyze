# Phase 169: FACTSHEETTRUTH - Research (regenerated)

**Researched:** 2026-09-27 (regenerated against `origin/main` at `320fba4ef`, phase branch HEAD contains it)
**Supersedes:** the 2026-09-25 research (commit `2d01a2244`). See `## Lineage` at the end.
**Domain:** factsheet number consistency (Next.js 16 RSC + TS factsheet math), plus two routed display-unit defects on `/portfolios/[id]` and `/allocations`
**Confidence:** HIGH for every root cause (each re-read at HEAD this session and quoted); MEDIUM for sequencing (two external merges are still open: Phase 169.2 PR #879 and Phase 167.1.2 PR C3)

## Summary

All four factsheet root causes the 2026-09-25 research named for this phase still hold at HEAD, verbatim: the BTC comparator is still the bundled fixture forward-filled flat (B), the single-key headline still comes from the TypeScript recompute instead of the persisted scalars (C), the freshness chip still prints the compute date under a "Track record" subject (D), and every return window still clamps to the record's start (E). The composite read-error item (169-07, D-41) also still holds: `readCompositeFactsheet` still folds a failed `csv_daily_returns` read into an empty series, and the v2 page's own comment names it as the accepted residual "owned by Phase 169 plan 04".

What moved under the plans is the scaffolding, not the defects. Phase 166.2 (#874) already bumped the factsheet cache key to `factsheet-v2-payload-v7` in its three-part form. It also replaced every dated "v6" quote with `vN`. So 169-02's "v6 -> v7" task, every "exactly N files still hold v6" criterion and all of 169-08's key-reconciliation work are obsolete. Phase 167.2.1 was merged into the branch before any 169 code existed, so the rebase 169-08 was written for has nothing left to reconcile. The 169.2 reader's contract adds `dropped` (corrupt closes that must not be bridged), which 169-02 and 169-03 do not carry. And "167.1.2 PR C" no longer exists as one PR: only C3 (plan 167.1.2-07) touches a 169 file (`MetricsColumn.tsx`).

The two routed items each have ONE wrong consumer. **Risk attribution:** the producer and every other consumer agree the unit is percent (0 to 100). Only `RiskAttribution` feeds it to `formatPercent`, which takes fractions, so a 28% share renders "+2800.00%". **Open Positions:** OpenPositionsTable and HoldingsTable format prices through whole-dollar formatters, and P&L through a `formatPnl` that picks its sign before rounding. So a $0.42 price reads "$0" and a +$0.37 P&L reads "+$0". The fix belongs beside Phase 150's declared single money module, `src/lib/dollar-validation.ts`. No root cause needs a migration. A separate, out-of-scope defect was found behind the risk-attribution data and is routed to the orchestrator (Open Question 1).

**Primary recommendation:**
- Keep 169-01, 169-04 and 169-07. Relax their entry gates so they can start now.
- Rewrite 169-02: a v7 -> v8 bump, plus the `dropped` contract.
- Rewrite 169-03 lightly (carry `dropped`; the chart already breaks at null).
- Rewrite 169-05's gate so it waits on C3 only, and resolve its test conflict with 167.1.2-07.
- Drop 169-08 and move its one surviving duty to 169-06.
- Add two small file-disjoint plans for the routed items. No migration.

<user_constraints>
## User Constraints (from CONTEXT.md)

`169-CONTEXT.md` has no separate "Claude's Discretion" list beyond one bullet, and its decision bodies run to about 1,100 lines. The planner reads CONTEXT.md directly. Below: the decision headings **verbatim** (each heading is the decision), with their status for THIS phase after the 2026-09-26 split. Retired or moved decisions are marked; their bodies are lineage.

### Locked Decisions (verbatim headings, in force for Phase 169)
- **D-02:** "Plan 07 OWNS the MetricsColumn period math (orchestrator, OQ2, 2026-09-25)" — now plan 169-05 (D-37 id map). Amended by D-17.
- **D-09:** "A comparator is measured only over the dates it has real prices for (planner, 2026-09-25)" — includes "A DB read error renders the comparator unavailable. It never falls back to the fixture".
- **D-10:** "The factsheet headline reads the persisted scalars for single-key strategies (planner, 2026-09-25)" — the OG half moved to Phase 169.4.1 (D-44).
- **D-11:** "One calendar coverage rule for every return window (planner, applying D-02, 2026-09-25)"
- **D-12:** "Record length is stated one way (planner, 2026-09-25)" — four sites, including the Terms panel's "Sample size" Term.
- **D-14:** "No migration (orchestrator, 2026-09-25)"
- **D-16:** "The freshness chip's date line matches its subject (planner, 2026-09-25)"
- **D-17:** "SC6 is read literally: a 3 Year / 5 Year row is NOT SHOWN for a shorter record (orchestrator, W4, 2026-09-25)"
- **D-19:** "The factsheet cache shape key moves v6 -> v7 once, in plan 05a (planner, W3, 2026-09-25)" — ⚠️ its premise is obsolete at HEAD (v7 exists since 166.2). See Finding K and Open Question 2.
- **D-21:** "No PR 1 type change may force an edit in a 167.1.2 file (orchestrator, round-3 B2, 2026-09-25)" — `ComparatorBlock.through` and the payload BTC field are OPTIONAL.
- **D-22:** "Merge order with Phase 167.2.1 (orchestrator, round-3 W2, 2026-09-25; mirrors 167.2.1 D-09)" — owner moved to 169-08 by D-42; this research moves it to 169-06.
- **D-23:** "The discovery detail page's duplicate builder assembly (167.2.1 D-03)" — the consolidation is 169.1-01's; Phase 169 keeps the lockstep test (169-03).
- **D-25:** "Founder principle, 2026-09-25: "calculate Sharpe once; every page reads it" (founder direction, recorded by the orchestrator)"
- **D-37:** "Phase 169 is split into five one-topic phases, and D-13's two-PR packaging retires (founder decision + orchestrator, 2026-09-26)"
- **D-41:** "A composite's failed `csv_daily_returns` read is a `read_error`, and the public cache never stores it (orchestrator (routed from 167.2.1 D-07), 2026-09-26)"
- **D-42:** "One rebase of the phase branch, owned by a new plan 169-08 between wave 3 and wave 5 (orchestrator (plan-check blocker), 2026-09-26)" — ⚠️ obsolete in effect at HEAD. See Finding L.
- **D-44:** "The OG card's half of D-10 splits out to Phase 169.4.1 OGSHARPE (FOUNDER DECISION, 2026-09-26)"

Moved out with their plans (lineage only for Phase 169): D-01, D-03, D-05, D-06, D-08, D-15, D-20 (Phases 169.2 / 169.3); D-26 to D-36 (Phase 169.1); D-43, D-45 (Phase 169.4.1). Retired: D-13 (by D-37), D-43 (by D-44).

### Claude's Discretion (verbatim)
- "Test file names, helper names not fixed above, and the exact caption wording within DESIGN.md's em-dash and dated-document rules."

### Deferred Ideas (OUT OF SCOPE) (verbatim)
- "Dropping `get_admin_compute_jobs`: `TODOS.md` `[169-DEAD-ADMIN-JOBS-RPC]` (D-01)."
- "A `periodsPerYear` on the Scenario payload, so a selected range there shows figures instead of the withheld form: `TODOS.md` `[169-SCENARIO-WINDOW-ANNUALIZATION]`, owner Phase 167.1.2 (D-29)."
- "\"Month-to-date\" relabel on an ended record, and the D12 venue label: Phase 170 (D-04, D-06)."
- "QA D14 (the `/admin` Strategy Review owner attribution when display names collide) and QA I5 (the intro-requests \"N in progress\" relabel): Phase 170 (D-06 as amended 2026-09-25)."
- "Widening `deriveMandateIsSet` to every engine-consumed preference field: not planned (D-03)."
- "A live feed for SPX, ETH, GLD and IEF: not planned; they carry a dated `through` label (D-09)."

### Out of scope by the orchestrator's brief (owned elsewhere)
167.1.2 (the Allocations equity curve, Sharpe beside a negative return, the Scenario zero weights, UUID and $0 total, the holdings total, Open Positions showing closed positions), 169.1 (zoom KPIs, engine conventions, the discovery-detail consolidation), 169.2 (BTC freshness and refresh), 169.3 (admin jobs, recommendations, profile exchanges, the mandate rule), 169.4 (the Allocations Risk tab), 169.4.1 (the OG card), 170 / 170.1 (layout and copy).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (ROADMAP `### Phase 169`, verbatim) | Research Support |
|----|-------------|------------------|
| SC3 | "The BTC benchmark is current: MTD and 3-month returns, win rate, volatility and drawdown come from a benchmark series that is refreshed, and a stale benchmark is shown as stale rather than as +0.00%." | Finding B (forward-fill at `alignReturns`), Finding M (169.2 reader contract incl. `dropped`), Finding K (cache key) |
| SC4 | "A strategy's CAGR and Sharpe are identical on discovery, recommendations, my-strategies and its factsheet (one computation, one stored value), or a surface that must differ says why." | Finding C (no persisted overlay on the single-key arm; resolve-stage select lacks the scalars), Finding F (D-41 composite read error) |
| SC5 | "A factsheet's header date, its "track record through" date and its stated record length agree, and record length is stated one way." | Finding D (chip date line; four record-length phrasings on two clocks) |
| SC6 | "3-year and 5-year rows are not shown for a record shorter than that period." | Finding E (`compoundFrom` never null; `periodReturn(3 * 252)` clamps to index 0) |
| SC9 | "Every fix carries a test that fails on the old behaviour (neuter → RED → restore), and each page is re-checked in the logged-in browser after deploy." | Validation Architecture |
| R1 (routed 2026-09-26) | "risk attribution renders a share in percent twice … Success: the page shows the producer's number once, and a test built from the producer's real shape fails on the double scale." | Finding R1 |
| R2 (routed 2026-09-27) | "/allocations Open Positions shows entry/mark prices under $1 as $0, and unrealized P&L as −$0 / +$0 … Success: a sub-dollar price and a sub-dollar P&L render with their real precision, and a zero-rounded value never shows a sign." | Finding R2 |
| R3 (routed 2026-09-26, = D-41) | "The composite read must surface a distinguishable read error and the public cache callback must throw on it, with a red-first test." | Finding F |
</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md)

- ⛔ The Supabase CLI in this checkout is linked to PRODUCTION. No `supabase`, `psql` or remote SQL. The schema comes from `supabase/schema/baseline.sql` only. This research ran none.
- ⛔ Merging `supabase/migrations/**` auto-applies to TEST, then PROD, with no human gate. This phase needs no migration (D-14 holds; see below).
- AGENTS.md: "This is NOT the Next.js you know". Read `node_modules/next/dist/docs/` before touching route or cache code. The v2 page's comment cites the bundled Next 16.2.11 `unstable_cache` behaviour ("on a miss the callback is awaited BEFORE `cacheNewResult`, so a throw propagates and nothing is stored").
- Coverage thresholds: read them from `vitest.config.ts`; never restate them.
- CHANGELOG discipline: one unified entry per version, the commit checklist cross-checked, and `VERSION` / `package.json` byte-equal 4-digit strings. Never `npm version`. HEAD is `0.106.0.2`; 169.2's open branch is at `0.107.0.0`, so re-read `VERSION` at ship.
- Never write the CI skip trailer in a commit or PR body, not even to deny it.
- Verification frontmatter uses `verified_at_sha` + `drift_subjects`. `covered_digest` / `covered_files` are banned.
- DESIGN.md governs every visual decision: the Numbers Contract, the em-dash null rule, "Red = never for a zero". Its Numbers Contract has **no currency row** (see R2).
- The repo is PUBLIC and `.planning/` is tracked: no identifiers, strategy names, home paths or usernames in any artifact.
- pytest runs only from `analytics-service/`. Never start `uvicorn`.
- The Phase 166.2 compute-once gate (`src/lib/return-stats.single-source.test.ts`) constrains every `src/` edit (Pitfall 3).
- Never hand-dispatch gsd agents. `gsd-tools` state handlers can clobber STATE.md / ROADMAP.md, so `git diff` after each.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Headline CAGR / Sharpe (SC4) | Frontend server (resolve stage + `readSingleKeyBasisOpts` in `fetch-and-build-payload.ts` / `composite-read-path.ts`) | Database (persisted `strategy_analytics` scalars) | The engine persists the value every list reads; the factsheet must overlay it, not recompute |
| BTC comparator numbers (SC3) | Frontend server (`buildFactsheetPayload` / `comparator-block.ts`) | Database (`benchmark_prices`, read via 169.2's `readBenchmarkPrices`) | Coverage and `through` are decided where the block is built |
| BTC re-derive on basis / leverage toggle (SC3) | Browser (`basis-context.tsx` -> `deriveSeriesBundle`) | Frontend server (prices carried on the payload) | The browser cannot read the DB; the same bounded prices must ride the payload |
| Freshness chip and record length (SC5) | Browser (`FreshnessChip`, `MetricsColumn`, `MandatePanels`) | TS math (`compute()` `years`) | Presentation of one stored date and one calendar length |
| Return windows (SC6) | TS math (`compute()` in `src/lib/factsheet/compute.ts`) | Browser (`MetricsColumn` hides 3Y / 5Y rows) | One calendar coverage rule, one implementation |
| Composite read error vs empty (D-41) | Frontend server (reader + resolve stage + `unstable_cache` callback) | — | Only the server can tell an outage from a fact about the row, and only it decides what is cached |
| Risk share display (routed R1) | Browser (`RiskAttribution`) | API (`services/portfolio_risk.py` is the unit's owner) | The producer's unit is fixed; the one wrong consumer converts |
| Price / P&L display (routed R2) | Browser (OpenPositionsTable, HoldingsTable) | Shared lib (`src/lib/dollar-validation.ts`, the declared money module) | One formatter module, many tables |

## Root causes, re-verified at HEAD

### B. SC3: the BTC comparator is the bundled fixture, forward-filled flat [VERIFIED: read this session]
- `src/lib/factsheet/align.ts` `alignReturns`, verbatim: `if (a != null && b != null && b !== 0) rets.push(a / b - 1); else rets.push(0);`, with `lastP` carried forward. Past the fixture's last date, `a === b`, so every day is a 0 return.
- `src/lib/factsheet/build-payload.ts` still aligns straight from the fixtures in BOTH `deriveSeriesBundle` and `buildFactsheetPayload`: `const btcRet = alignReturns(BTC_DAILY, dates);` (two occurrences, plus SPX / ETH / GLD / IEF).
- Fixture coverage, measured this session by loading each JSON: `btc-daily.json 1113 2023-04-26 2026-05-12`, `eth-daily.json 1112 2023-04-26 2026-05-11`, and `spx/gld/ief-daily.json 762 2023-04-26 2026-05-08`.
- `src/lib/factsheet/comparator-block.ts` `buildComparatorBlock` computes `const benchSummary = compute(benchReturns, dates, 0, periodsPerYear);` and `jointMetrics(stratReturns, benchReturns, …)` over the whole zero-padded series. There is no `through` field, and `dailyReturns: benchReturns` is carried as-is.
- `fetch-and-build-payload.ts` performs NO benchmark read today (no `readBenchmarkPrices`, no `benchmark_prices`).

### C. SC4: the single-key headline is the TS recompute [VERIFIED]
- `build-payload.ts`: `const strategyMetrics = overlayBasisScalars(computedMetrics, opts?.metricsByBasis?.cash_settlement);`. Its own comment says the overlay does nothing when "`cash_settlement` is absent (overlayBasisScalars returns base unchanged)".
- `composite-read-path.ts` `singleKeyBasisOpts` threads only `mark_to_market` / `smoothed_mtm`, "NEVER a lingering cash_settlement key (SC-4)". It returns `{}` for every non-options single-key strategy.
- **New at HEAD (167.2.1's resolve stage):** `resolveFactsheetInputs` selects `strategy_analytics ( daily_returns, returns_series, computed_at, data_quality_flags, metrics_json_by_basis, computation_status )`. That embed contains **none** of the seven `BASIS_KPI_MAP` scalars. So 169-01 must widen this select (the probe shares it; the cost is harmless).
- `BASIS_KPI_MAP` (`src/lib/factsheet/basis-metrics.ts`), verbatim server keys: `cumulative_return`, `volatility`, `max_drawdown`, `cagr`, `sharpe`, `sortino`, `calmar`.
- The discovery page's row already carries them. `PUBLIC_ANALYTICS_COLUMNS` (queries.ts) is `"cumulative_return, cagr, volatility, sharpe, sortino, calmar, max_drawdown, max_drawdown_duration_days, six_month_return, sparkline_returns, computation_status, computed_at"`, and `STRATEGY_DETAIL_DISCOVERY_ANALYTICS_COLUMNS` extends it. No `queries.ts` edit is needed.
- **Nuance:** the resolve stage's G1 already returns `notBuildable("not_computed")` unless `isComputedAnalytics(...)`, and `isRankableAnalyticsRow` (closed-sets.ts) is `return isComputedAnalytics(row?.computation_status);`. So 169-01's "not rankable → no overlay" arm is unreachable through `fetchAndBuildPayload`. It is reachable only on the discovery page, which has no G1 gate, until 169.1-01 consolidates it. Keep the arm and its test (it pins the discovery path).
- The D-25 cash re-pin premise holds. `basis-context.tsx`: `if (basis === "cash_settlement" || L <= 0) return lb.strategyMetrics;`, with the comment "cash's `basisM` already equals the client recompute". 169-01 makes that comment false, so its re-pin step stays.

### D. SC5: two dates under one chip subject; four record-length phrasings [VERIFIED]
- `FactsheetView.tsx` `FreshnessChip`: `const subject = seriesIsBinding ? "Track record" : "Computed";`. Its date line still renders `{formatIsoDate(computedAt)}` with `({Math.round(days)}d)`.
- `MetricsColumn.tsx`: `<Row label="Years Observed" value={m.years.toFixed(2)} bench="" />`, and the warning `⚠ Only {m.n} observations ({(m.n / 252).toFixed(2)}y)`.
- `MandatePanels.tsx`: `({payload.strategyMetrics.n.toLocaleString()} trading days, {payload.strategyMetrics.years.toFixed(2)} years).` and `<Term label="Sample size">{payload.strategyMetrics.n.toLocaleString()} days · {payload.strategyMetrics.years.toFixed(2)}y</Term>`.
- `compute()`: `const years = days / 365.25;` (calendar).

### E. SC6: windows clamp to the record start [VERIFIED]
- `compute.ts` `compute()`: `compoundFrom` loops `if (new Date(dates[i]) > cutoff) c *= 1 + rets[i];` and never returns null. It returns `p3m: compoundFrom(offsetDays(90))`, `p6m: compoundFrom(offsetDays(182))` and `p1y: compoundFrom(offsetDays(365))`. There is no `p3y` / `p5y`.
- `MetricsColumn.tsx`: `const periodReturn = (lookbackDays: number): number | null => {`, `<Row label="3 Year" value={pct(periodReturn(3 * 252), true)} bench="" />` and `<Row label="5 Year" value={pct(periodReturn(5 * 252), true)} bench="" />`.
- `src/lib/factsheet/types.ts` `ComputeResult`: `mtd: number; ytd: number; p3m: number; p6m: number; p1y: number;`.
- ⚠️ The brief named `src/app/factsheet/[id]/v2/types.ts`. **That file does not exist** (directory listing this session). The type file is `src/lib/factsheet/types.ts`, which is what #874 edited.

### F. D-41 / R3: a composite read outage is cached as a null payload [VERIFIED]
- `composite-read-path.ts` `readCompositeFactsheet`: on `sparseErr` it only `console.error`s ("composite csv_daily_returns read failed"). It then continues with `(sparseRows ?? [])`, "Fail-SAFE: below, an empty series returns null".
- `fetch-and-build-payload.ts` `resolveFactsheetInputs`: `if (!composite) return compositeUnbuildable(id, caller, "headline");`, and an empty series maps to `compositeUnbuildable(id, caller, "empty_series")`. The `NotBuildableReason` union is verbatim `"read_error" | "not_visible" | "not_computed" | "composite_unbuildable" | "too_few_points" | "malformed_series"`.
- The v2 page `buildFactsheetPayloadCached`: `if (built.reason === "read_error") throw new FactsheetReadError();`. Its comment says verbatim: "⚠️ Accepted residual under D-07, owned by Phase 169 plan 04: a composite's failed `csv_daily_returns` read still arrives as `composite_unbuildable` … so that outage cannot be told apart here and its `null` is still cached."
- 169-07's design (a thrown `CompositeSeriesReadError`, caught only in the resolve stage and mapped to `read_error` with its code) fits HEAD unchanged. `probeFactsheetBuildable` shares the resolve stage, so it answers `read_error` too, which `status-surface-copy.ts` already renders (`"unreadable"`, `"finished_build_unreadable"`).

### K. The factsheet cache key at HEAD (drives 169-02, 169-03, 169-07, 169-08) [VERIFIED]
- `src/app/factsheet/[id]/v2/page.tsx`: `["factsheet-v2-payload-v7", id, computedAt],`, lineage "Bumped v6→v7 (Phase 166.2 review round 2, IN-03): the shape is unchanged but the VALUES are not. … bumping serves the fix at deploy instead of after the 1h TTL drain."
- The house rule in the same comment: "Bump it … whenever FactsheetPayload adds non-optional fields".
- `git grep factsheet-v2-payload-v` over `src`: four LIVE v7 sites. They are `page.tsx` (keyParts), `page.cache-isolation.test.tsx` `const EXPECTED_KEY_PREFIX = "factsheet-v2-payload-v7";`, `page.public-cache-key.test.tsx` `expect(cacheKeys).toEqual([["factsheet-v2-payload-v7", STRATEGY_ID, T0]]);`, and the `fetch-and-build-payload.ts` CACHE KEY REALITY paragraph. Every other hit is a `vN` placeholder (the NEUTER-D records, the phase-148 header). **Zero `v6` strings remain in `src`.**
- **Recommendation: bump v7 -> v8 exactly once, in 169-02.** The lineage line names every payload-value change this phase ships: 169-04's null windows and `p3y`/`p5y`, 169-02's `through` and covered-span numbers, 169-03's carried BTC prices, and 169-05's null-padded `dailyReturns`. Reasons:
  *(Superseded 2026-09-27 by 169-CONTEXT D-62: after the split (D-61), Phase 169 bumps v7 -> v8 in 169-07 Task 3 and Phase 169.5 bumps v8 -> v9 in 169.5-01; kept as lineage.)*
  1. The deciding case is 169-03. Under D-21's reader rule, a stale v7 entry has no carried prices, so the browser MTM / leverage re-derive yields the BTC **unavailable** form for up to the 1 h TTL. That is a visible regression during the drain, not a byte-identical page.
  2. 166.2 set the precedent of bumping for a values-only change, "so the fix serves at deploy".
  3. The `computedAt` key part does not move on a deploy.
  169-03, 169-05 and 169-07 do not bump again.

### L. 169-08's rebase has nothing left to reconcile [VERIFIED]
- The branch already contains `origin/main`: `git merge-base --is-ancestor origin/main HEAD` succeeded this session, with two merge commits of `origin/main` on the branch. So the D-42 phase-entry sync has happened, and 167.2.1 (#866) came in before any 169 code.
- D-42 (a) to (d) are true at HEAD, before any 169 edit: three-part keyParts, the KEY SHAPE pin at v7, and zero v6 strings. (e) (the D-22 parity table and SC1 live repro) is still a duty, because 169-01 edits the resolve stage's select. It belongs in 169-06 step 0, which already carries it.
- A `git rebase` would drop the branch's merge commits and replay its docs commits. Bring in C3 / 169.2 with an orchestrator **merge**, as the entry sync was done.

### M. The 169.2 reader's contract (open PR #879, read from `origin/feat/169.2`) [VERIFIED: `git show origin/feat/169.2:src/lib/factsheet/benchmark-source.ts`]
- Exports, verbatim: `BENCHMARK_PAGE_SIZE = 1000`, `BENCHMARK_MAX_PAGES = 50`, `type BenchmarkSymbol = "BTC"`, `BenchmarkReadResult`, `BenchmarkReadOptions { from?: string; to?: string }`, `readBenchmarkPrices(client, symbol, opts)`, `BenchmarkReturnPoint`, `pricesToDailyReturns(prices, dropped)` and `mergeWithFixture(db: { prices; dropped }, fixture)`.
- `BenchmarkReadResult` is `{ ok: true; prices: DailyPrice[]; through: string | null; dropped: string[] } | { ok: false; error: unknown }`. `mergeWithFixture` returns `{ prices, through, dropped }`.
- The names 169-02 cites (`readBenchmarkPrices`, `mergeWithFixture`, the `{ ok, prices, through }` result) **match**. What 169-02 / 169-03 miss:
  1. **`dropped`.** The module says "⛔ Returns come from `pricesToDailyReturns(prices, dropped)` ONLY … A consumer therefore MUST pass the reader's `dropped` through". Price-based alignment (`alignReturns`) would silently bridge a corrupt close. The build opt and the payload field must carry `dropped`, and the coverage-aware alignment must yield no return for a pair whose span contains a dropped date. The recommended way is to derive BTC returns with `pricesToDailyReturns` and align those RETURNS by date, rather than re-deriving from prices.
  2. `mergeWithFixture`'s `through` "is NOT a DB-freshness signal". 169-02 already trims and recomputes `through` from the trimmed series, which is correct.
  3. 169.2 touches no file a 169 plan edits (its non-planning diff stat against `origin/main`: benchmark-source, the btc and cron routes, seam censuses, `ScenarioComposer.tsx`, `vercel.json`, `analytics-service`), so the entry sync that brings it in is conflict-free for 169's `src/lib/factsheet/**` edits.

## Routed items

### R1. Risk attribution renders a percent share twice [VERIFIED end to end; one sub-claim ASSUMED]
**Producer (the unit's owner):**
- `analytics-service/services/portfolio_risk.py` `compute_risk_decomposition`: `"marginal_risk_pct": _safe_float(float(cr / port_vol * 100)),`, a percent from 0 to 100 (`None` when the book carries no risk).
- `"standalone_vol": _safe_float(float(np.sqrt(covariance_matrix[i][i]))),`, where the covariance comes from `overlap_df.cov()` in `routers/portfolio.py`. It is never annualised and is a **fraction** (not a percent). It is a **daily** volatility ONLY IF `overlap_df` holds daily returns. Open Question 1 shows its input is `returns_series`, which `metrics.py` writes as a cumulative series, so the period (and meaning) of `standalone_vol` is **unconfirmed end to end** [VERIFIED for the expression; the input's meaning is inferred, see OQ1]. It is not double-scaled either way.
- `routers/portfolio.py`: `"weight_pct": _safe_float(ordered_weights[i] * 100),`, a percent.

**Every consumer, by symbol:**

| Consumer | Treats share as | Correct? |
|---|---|---|
| `src/lib/portfolio-analytics-adapter.ts` (`asNumber(v.marginal_risk_pct)`, passes through) | producer unit | ✓ |
| `src/lib/portfolio-insights.ts` (`top.marginal_risk_pct > top.weight_pct * 1.4 && top.marginal_risk_pct > 30`, `${Math.round(top.marginal_risk_pct)}%`) | percent | ✓ |
| `analytics-service/services/portfolio_optimizer.py` narrative (`{top_risk['marginal_risk_pct']:.0f}% of portfolio volatility`) | percent | ✓ |
| `src/components/portfolio/RiskAttribution.tsx` table: `formatPercent(d.weight_pct)`, `formatPercent(d.marginal_risk_pct)`; chart `domain={[0, 1]}`; tooltip `` `${(Number(v) * 100).toFixed(1)}%` `` | **fraction** | ✗ |
| `RiskAttribution.test.tsx` fixtures (`marginal_risk_pct: 0.8, weight_pct: 0.3`) | fraction the producer never sends | ✗ (encodes the wrong unit) |

- `formatPercent` (`src/lib/utils.ts`), verbatim: `return \`${sign}${(value * 100).toFixed(decimals)}%\`;`, with `signed` defaulting to true.
- Replicated this session with that exact expression: `formatPercent(28)` → `+2800.00%`, `formatPercent(40)` → `+4000.00%`, `formatPercent(0.11)` → `+11.00%`.
- The `Assessment` comparison `share > d.weight_pct * 1.3` is unit-consistent (both percent) and correct today.

**One source of truth:** the unit is the producer's (percent, as the `_pct` suffix says), and every other consumer already agrees. Fix:
1. Document the unit on `RiskDecompositionRow` in `src/lib/types.ts`. Its doc today states nullability but no unit.
2. Make `RiskAttribution` convert once (`/ 100`) before `formatPercent(..., { signed: false })`. Weights and shares are an unsigned domain per `src/__tests__/format-percent-contract.test.ts` ("pass `{ signed: false }` for unsigned-domain values like weights").
3. Fix the stacked bar so its domain and tooltip agree with the unit fed to it.
4. Rewrite `RiskAttribution.test.tsx`'s fixtures to the producer's percent shape.
- Do NOT convert at the adapter: that would move `portfolio-insights.ts` and its tests too, for the same outcome. `standalone_vol` is not double-scaled (a fraction into a fractions formatter), so leave its value alone. Its "+" sign and missing "daily" qualifier are labelling (see Open Question 3).

**Placement / collisions:**
- `RiskAttribution` renders only on `/portfolios/[id]` (`page.tsx`, `<RiskAttribution data={riskDecomposition} />` under "Risk decomposition"). `AllocationsTabs.tsx` names it only in a comment.
- The Allocations Risk tab's `widgets/risk/RiskDecomposition.tsx` is a different component that computes its own decomposition.
- The 169.4 plans' `files_modified` are `RiskTabPanel.tsx`, `AlphaBetaDecomposition.tsx`, `book-risk-input.ts`, `allocator-portfolio-payload.ts`, `queries.ts`, `AllocationDashboardV2.tsx` and their tests. **No collision with 169.4.**

**⚠️ Found behind this item, OUT OF SCOPE, routed to the orchestrator (Open Question 1):**
- `routers/portfolio.py` `_compute_portfolio_analytics` selects `"strategy_id, returns_series, equity_curve, total_aum"` from `strategy_analytics`. The table's column list in `supabase/schema/baseline.sql` has **neither `equity_curve` nor `total_aum`**. The full column list of `CREATE TABLE IF NOT EXISTS "public"."strategy_analytics"` as dumped, verbatim: `id strategy_id computed_at computation_status computation_error benchmark cumulative_return cagr volatility sharpe sortino calmar max_drawdown max_drawdown_duration_days six_month_return sparkline_returns sparkline_drawdown metrics_json returns_series drawdown_series monthly_returns daily_returns rolling_metrics return_quantiles trade_metrics data_quality_flags volume_metrics exposure_metrics computation_warned metrics_json_by_basis computing_started_at series_completeness computation_error_source computation_error_job_id`. Also, `git grep equity_curve -- supabase/migrations` hits only `portfolio_equity_curve` (another table) and a COMMENT on `allocator_equity_derived` [VERIFIED: both read this session].
- Separately, it treats `returns_series` as daily returns (`strategy_returns[sid] = s`, then `.cov()`). `services/metrics.py` writes `returns_series` from `cumulative`, the equity curve (`(1 + returns_for_chart).cumprod()` on the geometric path) [VERIFIED: metrics.py].
- Inference [ASSUMED, not measured against PROD]: the select raises and the compute always lands in its `except Exception` arm (row marked FAILED). So `/portfolios/[id]`'s risk decomposition is stale or never freshly produced, and `standalone_vol`'s unit cannot be confirmed end to end on real data.
- The R1 display fix is correct regardless. This is a data-integrity defect and needs a phase, not a TODO.

### R2. Open Positions: sub-dollar prices read "$0", P&L reads "+$0" / "−$0" [VERIFIED]
- `src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx` has a private `formatUsd` (`maximumFractionDigits: 0`), used on `entry_price`, `mark_price` and `notional_usd`. It also has a private `formatPnl`: `const sign = n >= 0 ? "+" : "−";`, then the whole-dollar `Math.abs(n)`, used on each row's `unrealized_pnl_usd` and on the footer total. `pnlColor` colors by the raw sign (`pnl > 0` green, `pnl < 0` red).
- Replicated this session with those exact bodies: `formatUsd(0.4213)` → `$0`, `formatUsd(0.00009876)` → `$0`, `formatPnl(0.37)` → `+$0`, `formatPnl(-0.21)` → `−$0`, `formatPnl(-0.0001)` → `−$0`. A red "−$0" also violates DESIGN.md's "Red … Never for absence, never for a zero."
- **The one owner already exists:** `src/lib/dollar-validation.ts` `formatUsd`, doc'd "Whole-dollar USD rendering for the allocations surface". HoldingsTable imports it with the comment "it is now the ONE money formatter for this surface … a second money formatter here is forbidden". OpenPositionsTable's private `formatUsd` is a byte-identical duplicate of it, a Phase 150 violation.
- **Same defect class, enumerated (money):**
  - `HoldingsTable.tsx` renders `formatUsd(h.entry_price)` (shared whole-dollar, so a sub-dollar entry price reads $0) and carries its own `formatPnl`, identical to OpenPositionsTable's, on `h.unrealized_pnl_usd`.
  - No other `src` file renders `entry_price` / `mark_price` (grep this session).
- **Same sign-before-rounding shape, different unit (percent / ratio deltas), NOT in R2's literal scope:** `KpiStrip.tsx` `formatSignedDelta`, `ScenarioComposer.tsx` `pushDelta`, `SyncPreviewStep.tsx` `formatContribution`, `HeatmapPanels.tsx` `formatPctShort`, and `formatPercent` itself (`value >= 0 ? "+" : ""` before `toFixed`, so −0.00001 renders "-0.00%"). Listed for the orchestrator; recommend they stay out of this phase (Rule 2) unless the founder widens R2.
- **Fix at one source:** add a price formatter and a signed-money formatter beside `formatUsd` in `src/lib/dollar-validation.ts`. The signed formatter derives its sign (and the caller's color) from the ROUNDED value, so a value that rounds to zero is unsigned and uncolored. Delete both local `formatPnl` copies and OpenPositionsTable's private `formatUsd`. Leave the existing whole-dollar `formatUsd` unchanged: it is pinned by `src/lib/dollar-validation.test.ts` and is right for AUM, notional and allocation amounts.
- **Precision policy is a design decision [ASSUMED, needs founder confirmation]:** DESIGN.md's Numbers Contract has rows for ratios, percentages, tail risk and integers, and **none for currency**. A proposal to confirm: price ≥ $1 at 2 dp, below $1 to 4 significant digits (capped), P&L at 2 dp, and a zero-after-rounding value unsigned and muted. The chosen rule should be added to DESIGN.md's Numbers Contract in the same plan.
- **Collisions:** no unexecuted plan on this branch, and no 167.1.2 plan (read in the sibling worktree), lists `OpenPositionsTable.tsx`, `HoldingsTable.tsx` or `dollar-validation.ts`. 167.1.2's "Open Positions shows closed positions" item edits `queries.ts` / `latest-holdings-per-key.ts`, a different file.

## Existing plans: verdicts at HEAD

| Plan | Verdict | Reason (re-measured) |
|---|---|---|
| 169-01 KPISOURCE | **KEEP**, small edits | Root cause C holds. Edits: (a) widen `resolveFactsheetInputs`' `strategy_analytics` embed with the seven scalars (the plan's "strategies select" key-link already implies it); (b) drop the `readBenchmarkPrices`-on-main check from its Task 1 entry gate (169-01 reads no benchmark), keeping "branch and HEAD contain origin/main" (true now); (c) note G1 makes the not-rankable arm discovery-only. |
| 169-02 BENCHTRUTH-CORE | **REWRITE** | (a) Task 3 becomes v7 -> v8 (Finding K); every "v6 survives in exactly N files" criterion and the `verify-symbol … factsheet-v2-payload-v6` line are obsolete (zero v6 at HEAD). (b) The opt and alignment must carry and honour `dropped` (Finding M). (c) Its precondition stays: 169.2 on the branch. |
| 169-03 BENCHTRUTH-PAGE | **REWRITE (light)** | Carry `dropped` in the payload BTC field. Its PRECONDITION "`grep -c 'factsheet-v2-payload-v7'`" and the "(no v8)" criterion no longer discriminate (v7 predates the phase; with the bump it must read v8). `TimeSeriesChart.tsx` `buildPath` already breaks the path at null (`const skip = v == null \|\| !Number.isFinite(v) …; prevValid = false`), so the chart edit may be test-only. The lockstep test and the discovery page's BTC read stay (169.1-01 owns the consolidation). |
| 169-04 CHIP+WINDOWS | **KEEP**, gate edit | Root causes D and E hold verbatim. Drop the 169.2 check from its entry gate (it reads no benchmark). |
| 169-05 RECORDLENGTH+3Y/5Y | **REWRITE the gate + the conflict** | (a) Its gate checks `departed-history.ts` (C4), `account-share-note.ts` (C1), `equityDailyReturns` (C2) and 169.2. Only C3 (167.1.2-07) edits a file of this plan (`MetricsColumn.tsx`; it also edits `scenario-factsheet-payload.ts`, which 169 does not touch). Gate on C3's artefact instead, e.g. `MetricsColumn.periods-per-year.test.tsx` on `origin/main`. (b) Rule 7 conflict: 167.1.2-07's planned test asserts an observation-clock length ("periodsPerYear 252, 200 observations: the warning renders with \"(0.79y)\""), which D-12 supersedes with a calendar length. 169-05 says both "only the stated LENGTH changes" and "167.1.2's tests unedited". Pick one (Open Question 4). |
| 169-06 integration + browser re-check | **KEEP**, step 0 rewritten | 166.1 and 166.2 are on `origin/main` and `compute.ts` already has `import { dispersion, sharpe as sharpeRatio } from "@/lib/return-stats";`, so step 0b's detection is true before any 169 code and its reconciliation arm is moot. Step 0 absorbs 169-08's surviving duty (D-22 parity table + SC1 live repro after the last sync). Add R1 (`/portfolios/[id]` risk decomposition) and R2 (`/allocations` Open Positions + Holdings) browser items. |
| 169-07 COMPOSITEREADERR | **KEEP**, gate + deps edit | Premise verified (Finding F). Remove the "this branch carries 169-02's v7 key" check (non-discriminating) and the `depends_on 169-08`; it needs only 169-01 (same files: `composite-read-path.ts`, `fetch-and-build-payload.ts`, the discovery page). If 169-02 bumps to v8, its v7-count check becomes v8 or is dropped (it does not own the key). |
| 169-08 REBASE | **DROP** | Finding L: (a) to (d) are done at HEAD; (e) moves to 169-06 step 0; the C3 / 169.2 intake is an orchestrator merge, as the phase-entry sync was. |
| NEW R1 plan (RISKUNIT) | **ADD** | `src/lib/types.ts` (doc only), `RiskAttribution.tsx`, `RiskAttribution.test.tsx`. File-disjoint from every 169 plan; wave 1. |
| NEW R2 plan (MONEYFMT) | **ADD** | `src/lib/dollar-validation.ts` (+ test), `OpenPositionsTable.tsx`, `HoldingsTable.tsx`, their tests, `DESIGN.md` Numbers Contract row. File-disjoint; wave 1. Precision policy needs founder confirmation first. |

**Sequencing (facts, not a decision).** Two independent external waits:
1. **169.2 (#879 open):** only 169-02 and 169-03 need it.
2. **167.1.2 C3 (plan 167.1.2-07, not yet executed; no SUMMARY in the sibling worktree):** only 169-05 needs it.

With the wave-1 gates relaxed, 169-01, 169-04, R1 and R2 can start now, and 169-07 can follow 169-01. The phase then needs one orchestrator merge of `origin/main` per external arrival: two if 169.2 and C3 land apart, one if both land before 169-02 starts. Each merge is followed by the D-22 re-run in 169-06 step 0. No plan syncs itself.

**Cross-phase notice for the orchestrator:** 169.1's plans (D-19 amendments for 14b to 14f) reason from a v7 key and a "no v8 bump" rule. If 169 bumps to v8, those plans' key text is stale when 169.1 runs after 169.

## Standard Stack

No new packages. Everything is in `package.json`: `next ^16.2.11`, `vitest ^4.1.2`, `@supabase/supabase-js`. Python: none of this phase's plans edits `analytics-service/`.

## Package Legitimacy Audit

This phase installs no external packages. **Packages removed:** none. **Flagged:** none.

## Architecture Patterns

### System Architecture Diagram
```
strategy_analytics (persisted scalars + series) ──► resolveFactsheetInputs (G0..G4; select widened, 169-01)
        │                                                   │ composite? ──► readCompositeFactsheet ──(read error: throw CompositeSeriesReadError, 169-07)──► read_error ──► cached callback throws, nothing stored
        │                                                   ▼
        │                                           buildFromResolved ──► readSingleKeyBasisOpts (+ persisted cash headline, 169-01)
        │                                                   │
benchmark_prices ──► readBenchmarkPrices (169.2) ──► mergeWithFixture ──► trim to [first-1d, last] ──► { prices, through, dropped } (169-02)
                                                            ▼
                                   buildFactsheetPayload ──► comparator block over the COVERED span, windows null past `through`
                                                            │  compute(): calendar windows, p3y/p5y (169-04)
                                                            ▼
                                   unstable_cache ["factsheet-v2-payload-v8", id, computedAt] (bump in 169-02)
                                                            ▼
                     FactsheetView: chip (series end + "Computed <date>", 169-04) · MetricsColumn (record-length formatter, 3Y/5Y hidden, 169-05)
                     basis-context re-derive ◄── payload BTC { prices, through, dropped } (169-03)

portfolio_risk.py (percent) ──► adapter ──► RiskAttribution (convert /100 once, unsigned, R1)
allocator_holdings rows ──► OpenPositionsTable / HoldingsTable ──► dollar-validation.ts price + signed-money formatters (R2)
```

### Pattern 1: persisted-first overlay (SC4)
Feed the persisted scalars into the EXISTING `overlayBasisScalars` through `readSingleKeyBasisOpts`. Do not add a second mapping; `BASIS_KPI_MAP` is the one map.

### Pattern 2: coverage-dated comparator (SC3)
Each block carries an optional `through`. Past it, windows are null and per-day arrays are null. A read error gives the unavailable form, never the fixture.

### Pattern 3: an outage is thrown, a fact is returned (D-41)
This mirrors 167.2.1's `FactsheetReadError`. The reader throws a named class; only the resolve stage catches that class, and `unstable_cache` stores nothing on a throw.

### Pattern 4: convert units at the one wrong consumer, not the boundary (R1)
When the producer and every other consumer agree, the outlier converts, and the type documents the unit.

### Anti-Patterns to Avoid
- Special-casing "+0.00%" or "$0" in a page: fix at the formatter or the builder.
- Re-deriving BTC returns from prices with `alignReturns` after 169.2 ships: it bridges a dropped close.
- A `git rebase` of the phase branch: it drops the entry-sync merge commits.
- Changing `dollar-validation.ts` `formatUsd` to show cents: it moves AUM and allocation amounts on every money surface and breaks its pinned test.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---|---|---|---|
| BTC read / paging / corrupt closes | a second reader or price→return loop | `readBenchmarkPrices`, `mergeWithFixture`, `pricesToDailyReturns` (169.2) | keyset paging, `dropped` handling, strictly-decreasing check |
| Headline overlay | a new scalar map | `BASIS_KPI_MAP` + `overlayBasisScalars` | strict null → "—" semantics exist |
| Any Sharpe / Pearson / beta | an inline ratio | `@/lib/return-stats` | Phase 166.2 compute-once gate fails CI otherwise |
| Rankable / computed predicate | a status literal compare | `isRankableAnalyticsRow` / `isComputedAnalytics` | SI-01 census greps raw source |
| Series end date | a new derivation | `resolveSeriesEnd` (FactsheetView) | chip and line must agree |
| Money formatting | a per-table formatter | `src/lib/dollar-validation.ts` (extend it) | Phase 150 made it the one owner |
| Percent formatting | a local `formatPercent` | `@/lib/utils` `formatPercent` | `format-percent-contract.test.ts` forbids local declarations |

## Common Pitfalls

### Pitfall 1: persisted cumulative_return vs the chart endpoint (SC4)
Python compounds the post-last-break suffix; the chart draws the whole series. On a chain-broken series the overlay can disagree with the chart end. Pin equality on a clean series, and require the existing `dataQuality` caveat on a broken one (unchanged from the prior research).

### Pitfall 2: the benchmark series in the RSC payload
Ship only BTC closes within `[strategy first date − 1 day, strategy last date]`, plus the `dropped` dates in that range.

### Pitfall 3: the compute-once gate (`src/lib/return-stats.single-source.test.ts`)
- Its whole-tree shape matcher flags, among fourteen forms, `SHARPE S8 <..ret..> / <..vol..>` (e.g. `annRet / annVol` by name) and `SHARPE S6 ID * ANN / ID`.
- Coverage code in `comparator-block.ts` / `align.ts` must not divide a return-named value by a vol-named one, and must not name a covered-span helper that way.
- The file states: "this gate constrains every later src/ edit, including Phase 169's". A red gate is fixed by routing through `@/lib/return-stats`, never by an allowlist entry.
- It also names comparator-block.ts as "NOT in the list … the file computes no ratio and Phase 169 owns its edits". Keep it that way.

### Pitfall 4: null windows cascade through the type (SC6)
- Widening `ComputeResult` windows to `number | null` reaches `comparator-block.ts`, the allocator payload and `scenario-factsheet-payload.ts` (a 167.1.2 file).
- D-21's optional-field device and `tsc` find every reader. `ComparatorBlock.summary` already picks `"mtd" | "ytd" | "p3m" | "p6m" | "p1y"`.
- Snapshots under `src/lib/factsheet/__snapshots__/` move deliberately; explain each moved key.

### Pitfall 5: `dailyReturns` null padding readers (169-05)
Re-measured at HEAD, the comparator `dailyReturns` readers are `MetricsColumn.tsx` (EoY loop, `const r = cmp.dailyReturns[i];`), `DistributionPanels.tsx` (EoY bars, `const r = vcmp.dailyReturns[i];`) and `HistogramChart.tsx` (`const b = cmp.dailyReturns?.[i];`, already guarded). D-21's list is still complete.

### Pitfall 6: a benchmark read blip is cached for the TTL
169-02 turns a `benchmark_prices` read error into the BTC unavailable form, and the WHOLE payload is then stored by `unstable_cache` for up to 1 h under that `computedAt`. This is the same class D-41 closes for composites, but here the rendered state is honest ("BTC prices unavailable") and bounded. Recommendation: accept and record it. Throwing would replace the whole factsheet with the placeholder for that request, which is worse. See Open Question 5.

### Pitfall 7: an effect never identifies the writer (browser re-check)
Keys are `[version, id, computedAt]`, so a deploy does not bust entries without the version bump. Bind each browser reading to the deployed SHA and a non-zero SHA-bound CI run count.

### Pitfall 8: `/portfolios/[id]` may show no fresh risk data (R1)
Because of Open Question 1, the post-deploy browser check of R1 may find "No risk attribution data available." or an old row. That is not evidence the unit fix failed. The component test with the producer's real shape is the gate; the browser item records what it saw.

## Code Examples

```ts
// SC4 — widen the resolve-stage embed (fetch-and-build-payload.ts resolveFactsheetInputs). Keys verbatim from BASIS_KPI_MAP.
strategy_analytics ( daily_returns, returns_series, computed_at, data_quality_flags, metrics_json_by_basis, computation_status,
                     cumulative_return, volatility, max_drawdown, cagr, sharpe, sortino, calmar )
```
```ts
// SC3 — honour 169.2's contract (shape; names verbatim from origin/feat/169.2 benchmark-source.ts)
const read = await readBenchmarkPrices(supabase, "BTC", { from, to });
const merged = read.ok ? mergeWithFixture({ prices: read.prices, dropped: read.dropped }, BTC_DAILY) : null;
// trim merged.prices to [from, to]; through = last trimmed date; carry merged.dropped;
// BTC returns = pricesToDailyReturns(trimmed, merged.dropped), then aligned BY DATE to the strategy dates.
```
```ts
// R1 — the one conversion (RiskAttribution), unsigned per the formatPercent contract
formatPercent(d.marginal_risk_pct == null ? null : d.marginal_risk_pct / 100, 1, { signed: false })
```
```ts
// R2 — sign from the ROUNDED value (shape; name and precision to be confirmed, see R2)
const rounded = Number(n.toFixed(2));
const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
```

## State of the Art (what changed on main since the plans)

| Old premise in the plans | At HEAD | When | Impact |
|---|---|---|---|
| cache key v6, two parts | `["factsheet-v2-payload-v7", id, computedAt]` | 167.2.1 (#866), 166.2 (#874) | 169-02 bumps to v8; 169-08's reconciliation is moot |
| dated NEUTER-D records quote v6 | they quote `vN` | 166.2 | "exactly N files hold v6" criteria are void |
| 166.1 may merge after 169 | 166.1 (#872) and 166.2 (#874) merged; `compute.ts` imports `@/lib/return-stats` | 2026-09-26/27 | 169-06 step 0b detection is already true |
| "167.1.2 PR C" is one PR | C1 (02,04), C2 (10,05,11,12,13), C3 (06,07,14), C4 (09,15), then 08 | founder, 2026-09-27 | only C3 gates 169-05 |
| 169.2 reader returns `{ ok, prices, through }` | also `dropped`; returns only via `pricesToDailyReturns` | 169.2 review rounds (branch) | 169-02/03 carry `dropped` |
| `src/app/factsheet/[id]/v2/types.ts` | does not exist; `src/lib/factsheet/types.ts` | — | cite the real file |

## Runtime State Inventory

Not a rename/refactor phase. One runtime-state item exists and is handled by the key bump: **cached factsheet payloads** in Next's `unstable_cache` (1 h TTL) keyed `["factsheet-v2-payload-v7", id, computedAt]`. The bump to v8 makes pre-deploy entries unreachable. Stored data, live service config, OS registrations, secrets and build artifacts: none (verified by reading every file the plans edit; no plan writes a table, env var or cron).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `_compute_portfolio_analytics` fails in PROD on its select of non-existent columns (inferred from baseline.sql; not measured) | R1 / OQ1 | If some other path writes `risk_decomposition`, the R1 browser check will show live data; the fix is unchanged |
| A2 | The R2 precision policy (price ≥ $1 at 2 dp, below $1 to 4 significant digits; P&L 2 dp; zero-after-rounding unsigned and muted) | R2 | A design decision; DESIGN.md requires founder approval before any deviation |
| A3 | A v8 bump is wanted (founder / orchestrator call on D-19's premise) | Finding K | Without it, the MTM / leverage re-derive shows BTC unavailable for up to 1 h after deploy |
| A4 | 167.1.2-07's executed test will pin "(0.79y)" as its plan says (the plan is unexecuted) | 169-05 verdict | If it asserts only the threshold, the conflict disappears |
| A5 | 169.2 merges with the reader contract as on `origin/feat/169.2` today | Finding M | A further review round could rename or reshape it; re-read at the sync |

## Open Questions (RESOLVED)

All six were resolved by the orchestrator on 2026-09-27 in `169-CONTEXT.md`; each line below ends with its resolution.

1. **The portfolio analytics select (`equity_curve`, `total_aum`) and `returns_series`-as-returns in `routers/portfolio.py`.** What we know: neither column exists on `strategy_analytics` in baseline.sql, and `returns_series` is written as a cumulative series. What's unclear: PROD behaviour (no DB access by rule). Recommendation: route to a new data-integrity phase via `/gsd-phase`, not into 169; confirm with one Sentry / log read of "Portfolio analytics computation failed". **RESOLVED (D-53):** out of 169's scope; booked in `TODOS.md` as `[169-PORTFOLIO-ANALYTICS-COLUMNS]` for the founder to route.
2. **v8 or not (D-19's premise).** Recommendation: v8, once, in 169-02 (Finding K); CONTEXT gets a dated D-19 amendment. **RESOLVED (D-48):** v8, once, in 169-02, as recommended.
   *(Superseded 2026-09-27 by 169-CONTEXT D-62: v7 -> v8 in 169-07 Task 3, v8 -> v9 in 169.5-01.)*
3. **`standalone_vol` labelling.** It is a fraction (daily, if its input is daily returns; see OQ1) shown as "Standalone Vol" with a "+" sign. Recommendation: in the R1 plan, render it unsigned (a formatter argument, number truth) and route the "daily" qualifier to Phase 170 (copy), unless the founder wants both here. Do not annualise on the page (D-25: no page-local computation). **RESOLVED (D-49), departing from the recommendation:** `standalone_vol` is left unchanged in RISKUNIT; its labelling (sign and period) is copy, routed to Phase 170.1, because its period cannot be confirmed until D-53's defect is routed.
4. **169-05 vs 167.1.2-07's test.** Options: (a) 169-05 edits 167.1.2's `MetricsColumn.periods-per-year.test.tsx` length assertion with a dated supersession line citing D-12; (b) ask the 167.1.2 orchestrator to make 167.1.2-07 assert only the threshold. Recommendation: (b) if C3 is not yet planned in detail, else (a); never both "unedited" and "changed". **RESOLVED (D-51):** option (a), 169-05 edits only that length assertion with a dated supersession line.
5. **A cached BTC-unavailable payload after a read blip (Pitfall 6).** Recommendation: accept and record it in 169-02's SUMMARY as a known, honest, TTL-bounded limit. **RESOLVED (D-52):** accepted and recorded, as recommended.
6. **R2 precision policy (A2).** Recommendation: ask the founder with the concrete proposal before the R2 plan executes; add the confirmed row to DESIGN.md. **RESOLVED (D-50), departing from the recommendation:** decided by the orchestrator without asking, under the founder's standing rule to take decisions autonomously ("No clients, take decisions"); the basis is the founder's 2026-09-27 UAT booking, whose success line asks that a sub-dollar price and P&L "render with their real precision" and that "a zero-rounded value never shows a sign". The rule is added to DESIGN.md by 169-10.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|---|---|---|---|---|
| node | vitest, tsx | ✓ | v25.8.1 | — |
| `node_modules` in this worktree | vitest, tsc | ✗ | — | Executors follow each plan's worktree rule. This research did not symlink one (brief forbids it) and so ran no vitest; resolution walks UP and the main checkout is not an ancestor |
| `analytics-service/.venv` in this worktree | pytest | ✗ | — | Not needed: no plan edits Python |
| Remote DB | — | not to be used | — | baseline.sql only |

## Validation Architecture

`workflow.nyquist_validation` is `true` in `.planning/config.json`.

### Test Framework
| Property | Value |
|---|---|
| Framework | vitest ^4.1.2 (package.json) |
| Config file | `vitest.config.ts` |
| Quick run command | `npx vitest run <file>` |
| Full suite command | `npm test` plus `npx tsc --noEmit -p .` |

"Fails today" below is reasoned from the source quoted above plus this session's node replications of the exact formatter bodies. No vitest run was possible here (no `node_modules`). Each executor records the real neuter → RED → restore.

### Phase Requirements → Test Map
| Req | Behavior | Type | Automated Command | Fails today because | File Exists? |
|---|---|---|---|---|---|
| SC4 | single-key factsheet CAGR / Sharpe == persisted; persisted null → "—" | unit | `npx vitest run src/lib/factsheet/build-payload.headline-source.test.ts src/lib/factsheet/composite-read-path.test.ts` | `singleKeyBasisOpts` returns `{}`; the overlay is a no-op | ❌ new file / ✅ extend |
| SC4 | cash leverage keeps persisted Sharpe / Sortino | component | `npx vitest run "src/app/factsheet/[id]/v2/basis-context.cash-leverage-repin.test.tsx"` | `if (basis === "cash_settlement" …) return lb.strategyMetrics;` | ❌ new |
| SC3 | BTC windows null past `through`; win rate / vol over the covered span; read error → unavailable, never fixture; `dropped` not bridged | unit | `npx vitest run src/lib/factsheet/build-payload.benchmark-opt.test.ts src/lib/factsheet/comparator-block.coverage.test.ts src/lib/factsheet/align.test.ts src/lib/factsheet/fetch-and-build-payload.benchmark.test.ts` | `alignReturns` pushes 0 past the fixture; no DB read | ❌ new / ✅ extend |
| SC3 | re-derive uses the carried prices; caption; chart gap | component | `npx vitest run "src/app/factsheet/[id]/v2/basis-context.benchmark-prices.test.tsx" "src/app/factsheet/[id]/v2/ComparatorPicker.test.tsx" "src/app/factsheet/[id]/v2/MandatePanels.comparator-coverage.test.tsx"` | re-derive aligns `BTC_DAILY`; "forward-filled" copy | ❌ / ✅ extend |
| SC3 | cache key v8 | unit | `npx vitest run "src/app/factsheet-share/[token]/page.cache-isolation.test.tsx" "src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx"` | pins say v7 | ✅ edit pins |
| SC5 | chip date = series end when the series binds; "Computed <date>" line | component | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetView.chip-honesty.test.tsx"` | `{formatIsoDate(computedAt)}` under "Track record" | ✅ extend |
| SC5 | one record-length phrase, calendar years, "daily observations" | unit + component | `npx vitest run src/lib/factsheet/record-length.test.ts "src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx"` | `(m.n / 252).toFixed(2)`; "trading days" | ❌ new |
| SC6 | 3M / 6M / 1Y / 3Y / 5Y null on a shorter record; 3Y / 5Y rows absent | unit + component | `npx vitest run src/lib/factsheet/compute.metrics.test.ts "src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx"` | `compoundFrom` never null; `periodReturn(3 * 252)` clamps | ✅ extend |
| SC3 / D-21 | EoY never counts an uncovered day as 0 | component | `npx vitest run "src/app/factsheet/[id]/v2/EoyComparatorCoverage.test.tsx"` | `dailyReturns: benchReturns` zero-padded | ❌ new |
| R3 / D-41 | composite read error → `read_error`, not cached; empty read unchanged | unit + page | `npx vitest run src/lib/factsheet/composite-read-path.test.ts src/lib/factsheet/fetch-and-build-payload.test.ts "src/app/factsheet/[id]/v2/page.composite-read-error.test.tsx" "src/app/(dashboard)/discovery/[slug]/[strategyId]/page.pending-fallback.test.tsx"` | `sparseErr` folded into `[]` → `composite_unbuildable` | ❌ new / ✅ extend |
| R1 | producer-shape row (parsed from `src/__tests__/fixtures/portfolio-analytics/complete.json` through the adapter) renders 28.0% / 40.0%, unsigned; bar domain matches | component | `npx vitest run src/components/portfolio/RiskAttribution.test.tsx` | `formatPercent(28)` → `+2800.00%` (replicated) | ✅ rewrite fixtures + add case |
| R2 | $0.42 price shows its precision; +0.37 P&L shows cents; a value rounding to 0 has no sign and no color | unit + component | `npx vitest run src/lib/dollar-validation.test.ts "src/app/(dashboard)/allocations/components/OpenPositionsTable.all-columns.test.tsx" "src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx"` | `formatUsd(0.4213)` → `$0`, `formatPnl(-0.0001)` → `−$0` (replicated) | ✅ extend |
| SC9 | neuter → RED → restore per fix; browser re-check bound to the deployed SHA | manual + CI | 169-06 | — | plan |

### Sampling Rate
- **Per task commit:** the quick command for the touched files.
- **Per wave merge:** `npm test`, `npx tsc --noEmit -p .`, `npm run lint` (which runs the planning-hygiene check), and the compute-once gate `npx vitest run src/lib/return-stats.single-source.test.ts`.
- **Phase gate:** full suite green. 169-06 step 0 runs the D-22 parity table (`fetch-and-build-payload.test.ts`) and the SC1 live repro after the last sync. Then the browser re-check of a factsheet (single-key and composite), discovery detail, `/portfolios/[id]`, and `/allocations` Open Positions + Holdings.

### Wave 0 Gaps
- [ ] `src/lib/factsheet/build-payload.headline-source.test.ts`, `build-payload.benchmark-opt.test.ts`, `comparator-block.coverage.test.ts`, `fetch-and-build-payload.benchmark.test.ts`, `record-length.test.ts`
- [ ] `src/app/factsheet/[id]/v2/basis-context.cash-leverage-repin.test.tsx`, `basis-context.benchmark-prices.test.tsx`, `MetricsColumn.record-length.test.tsx`, `EoyComparatorCoverage.test.tsx`, `page.composite-read-error.test.tsx`, `MandatePanels.comparator-coverage.test.tsx`
- No framework install needed.

## Security Domain

`security_enforcement` is absent from config, so it is treated as enabled.

| ASVS Category | Applies | Standard Control |
|---|---|---|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | The BTC read reuses the resolve stage's service-role handle for a public-SELECT market table; the outer request-scoped signature probe stays the auth gate; no visibility widening. The persisted scalars come from the same row the gate already admitted. |
| V5 Input Validation | yes | `from` / `to` are derived from the strategy's own dates, never request params; formatters treat non-finite as "—" |
| V6 Cryptography | no | — |

| Pattern | STRIDE | Mitigation |
|---|---|---|
| A viewer-dependent value entering the id-keyed cache | Information disclosure | Nothing added is viewer-dependent (market prices, row scalars); the CACHE KEY REALITY corollary holds |
| A read outage pinned in the cache | Denial of service (availability) | D-41 throws for the composite series; the BTC blip is honest and TTL-bounded (Pitfall 6) |
| A corrupt benchmark close bridged into a fabricated return | Tampering (integrity) | Carry `dropped`; returns only via `pricesToDailyReturns` |

## Lineage (what the 2026-09-25 research said, re-judged at HEAD)

- **Still holds (re-verified, quoted above):** B (the BTC fixture forward-filled flat), C (the single-key headline recomputed), D (chip date and record length), E (windows clamp), and the D-41 composite read-error premise. Pitfalls 1, 2, 3 (null cascade, now Pitfall 4), 4 (`max_rows`, now 169.2's) and 7 carry over.
- **Moved with the 2026-09-26 split (D-37 / D-44):** A (admin compute jobs) → 169.3, shipped (#868); F (recommendations) → 169.3; G (Risk tab series) → 169.4; H (profile exchanges) → 169.3; the OG card → 169.4.1; the discovery-detail consolidation → 169.1-01; the zoom and convention work → 169.1.
- **Obsolete:** the v6 cache-key premise and every "v6 survives in N files" check (v7 three-part since 166.2 / 167.2.1; zero v6 strings); "167.1.2 PR C" as one gate (split into C1 to C4; only C3 matters here); the 169-08 rebase (entry sync done, 167.2.1 already in); the 166.1 merge-order reconciliation arm (166.1 and 166.2 are on main); the old research's "`/internal` endpoint" BENCHFEED design (169.2's, already built differently); `src/app/factsheet/[id]/v2/types.ts` (never existed).
- **New in this regeneration:** Finding M (`dropped`), Finding K (v8), R1, R2, Open Question 1 (the portfolio router select), Pitfalls 3, 6 and 8.

## Sources

### Primary (HIGH, read this session)
- `src/lib/factsheet/{align,comparator-block,compute,build-payload,basis-metrics,composite-read-path,fetch-and-build-payload,types}.ts`, `src/lib/factsheet/data/*.json` (coverage measured)
- `src/app/factsheet/[id]/v2/{page,FactsheetView,MetricsColumn,MandatePanels,basis-context,TimeSeriesChart}.tsx`
- `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx`, `src/lib/queries.ts` (`PUBLIC_ANALYTICS_COLUMNS`), `src/lib/closed-sets.ts` (`isRankableAnalyticsRow`)
- `src/lib/return-stats.single-source.test.ts` (header), `src/__tests__/format-percent-contract.test.ts` (header)
- `origin/feat/169.2:src/lib/factsheet/benchmark-source.ts`, and `git diff origin/main origin/feat/169.2 --stat`
- `src/components/portfolio/RiskAttribution.tsx` (+ test), `src/lib/utils.ts` (`formatPercent`), `src/lib/types.ts` (`RiskDecompositionRow`), `src/lib/portfolio-insights.ts`, `src/lib/portfolio-analytics-adapter.ts`, `analytics-service/services/portfolio_risk.py`, `analytics-service/routers/portfolio.py`, `analytics-service/services/metrics.py`
- `src/app/(dashboard)/allocations/components/{OpenPositionsTable,HoldingsTable,KpiStrip,ScenarioComposer}.tsx`, `src/lib/dollar-validation.ts` (+ test header), `DESIGN.md` Numbers Contract
- `supabase/schema/baseline.sql` (`strategy_analytics` column list)
- 167.1.2 plans 01 to 15 `files_modified` and plan 07's must-haves (sibling worktree, read-only); the 169.4 plans' `files_modified`
- `git show --stat b10cea659` (#874), `git log origin/main`

### Secondary / Tertiary
- None. Every question was an in-repo trace, so the research-plan seam and external docs were not needed.

## Metadata

**Confidence breakdown:**
- Root causes: HIGH (each quoted at HEAD).
- Plan verdicts: HIGH for 01, 04, 07, 08; MEDIUM for 02 / 03 (they depend on 169.2's final contract) and 05 (depends on 167.1.2-07 as executed).
- Routed items: HIGH for the unit and formatter defects; LOW for Open Question 1's PROD behaviour (inferred).

**Research date:** 2026-09-27
**Valid until:** the next merge to `origin/main` of 169.2 (#879) or 167.1.2 C3, whichever is first. Re-read the reader contract and `MetricsColumn.tsx` at that sync.
