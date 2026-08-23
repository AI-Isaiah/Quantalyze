# Phase 159: RANK — Public-ranking integrity - Research

**Researched:** 2026-08-21 (all line refs re-verified at HEAD `5916012b`)
**Domain:** In-repo fix phase — TS percentile/projection surfaces, one SQL RPC migration, Python quantstats path, csv-finalize race, wizard fingerprint
**Confidence:** HIGH (every fix location read from source this session; the one LOW item is the PROD census access mechanism)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (Census & C-D1):** The C-M1 census is a committed phase artifact (`159-CENSUS.md`) produced BEFORE the filter lands: per-category published-with-analytics counts before/after the gate, checked against BOTH floors (<5 badge floor, RPC min-N 20), plus the per-strategy percentile before/after snapshot. Any category that crosses a floor because of the gate is recorded there as an expected visible change and surfaced in phase UAT — the filter then proceeds regardless (ROADMAP already decides a disappearing rank is the HONEST outcome). No test asserts rank direction (not uniform).
- **D-02 (Splat-class closure, RANK-02):** Close the WHOLE `strategy_analytics (*)` splat class, not the two listed sites. Verified at HEAD (afc90779): `src/lib/queries.ts` has THREE splats (lines 210, 310, 936 — the requirement's `:218` drifted to `:210`) plus `src/app/(dashboard)/compare/page.tsx:68`. Every splat is classified anon-reachable vs owner-only; anon-reachable sites become explicit projections excluding `daily_returns`/`metrics_json`/`data_quality_flags`; owner-only sites keep the splat with a one-line exemption comment at the site. — Reversibility: reversible
- **D-03 (Shared gate helper placement, RANK-01):** The ONE shared computed-analytics filter helper for both TS callers lives in `src/lib/closed-sets.ts` next to `isComputedAnalytics` (the MD-01 single-source module exists precisely for this). `PERCENTILE_GATE_COLUMN` is a separate exported constant; `PERCENTILE_ANALYTICS_COLUMNS` stays byte-unchanged (binding — the csv-finalize mirror prose at three sites depends on it). The `get_verified_cohort_rank` SQL RPC moves in lockstep by default (its prose claims parity-by-construction); if the planner finds a hard reason to exclude it, the exclusion is recorded IN the RPC migration comment — and any RPC change re-bases on the LATEST migration definition (grep ALL migrations first, house rule).
- **D-04 (quantstats sign-flip mechanism, RANK-05):** Kill the guess, don't patch the guesser: the strategy-analytics path must hand quantstats returns explicitly / disable its price auto-detection, mirroring the mechanism already used where this class was previously closed (planner reads the existing closed path and reuses its exact pattern — no new abstraction, no quantstats fork/pin).
- **D-05 (Re-mint fingerprint, RANK-08):** Default = include classification in the re-mint fingerprint (the real fix, per the requirement's first arm). Fallback ONLY on source evidence that the current fingerprint's classification-blindness is load-bearing (e.g. intentional dedupe across classifications): document the exclusion AT the fingerprint site including the 409-remedy consequence. Planner decides from the source read; both arms satisfy RANK-08 as written.
- **D-06 (uid shape validation, RANK-09):** `withPublishedOrOwner` validates the uid as a strict UUID BEFORE interpolating into the PostgREST `.or()` filter; a non-conforming uid is rejected fail-loud (treated as anon / published-only path — fail CLOSED, never a permissive fallback). — Reversibility: reversible

### Claude's Discretion

Exact projection column lists, census SQL, CAS test shape (two-writer race), blend unknown-`asset_class` implementation detail (RANK-06 — must respect the `closed_sets.py` MD-01 single-source discipline for anything venue-set-adjacent), and test placement. Money-math tests pin ECONOMICS via invariant oracles, never the implementation's own formula (house testing law).

### Deferred Ideas (OUT OF SCOPE)

- `StrategyTable` ungated KPI cells — C-D2, explicitly out of scope per ROADMAP; logged there.
- RANK-03 / RANK-04 (server-authoritative venue + attested annualization stamp) — Phase 160, with B-M1 census.
</user_constraints>

## Summary

Every fix location for the seven requirements was read from source this session at HEAD `5916012b`. The phase is entirely surgical: no new packages, one new SQL migration (the RPC gate), and edits confined to `src/lib/queries.ts`, `src/lib/closed-sets.ts`, `src/lib/visibility.ts`, `src/lib/wizard/localStorage.ts`, `WizardClient.tsx`, `compare/page.tsx`, `csv-finalize/route.ts`, and `analytics-service/services/metrics.py`.

Three research corrections matter beyond what the orchestrator supplied. (1) **RANK-06 is TS-side, not Python-side**: the blend RISK decision point is `blendPeriodsPerYear` in `src/lib/closed-sets.ts:605-609`; the Python composite path was already closed via `CRYPTO_VENUES` (closed_sets.py) and job_worker's venue-blend cross-check. (2) **RANK-05 cannot be closed by a `prepare_returns=False` kwarg sweep alone**: in the pinned quantstats 0.0.81, `volatility`/`cvar`/`value_at_risk`/`tail_ratio`/`profit_factor` accept `prepare_returns=`, but `sharpe`/`sortino`/`smart_sharpe`/`smart_sortino`/`omega`/`gain_to_pain_ratio` do NOT — the headline Sharpe/Sortino need the P114 inline-pandas pattern (`sharpe_vol_status_from_backbone`, metrics.py:1299) mirrored, exactly as D-04's "reuse the closed path's pattern" prescribes. (3) The reason `PERCENTILE_ANALYTICS_COLUMNS` is byte-frozen is now precisely located: `CLOCK_SAFETY_KPI_COLUMNS` (csv-finalize/route.ts:1039-1047) hand-mirrors it "member for member" with prose at :1031, :1488, and :1505 — and :1505 explicitly declares `computation_status` NOT a member, so appending the gate column would falsify all three sentences.

**Primary recommendation:** Plan RANK-01+census first (census artifact is a hard ordering gate per D-01), then RANK-02 as a projection sweep with a per-site consumer inventory, then the two money-math fixes (RANK-05 Python, RANK-06 TS) as independent plans, then the three small route/lib fixes (RANK-07/08/09) which are each ~1-file + tests.

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RANK-01 | Percentile ranks never fold failed/stale-computation KPIs; gate on `isComputedAnalytics` semantics, separate `PERCENTILE_GATE_COLUMN`, both TS callers + RPC in lockstep | §RANK-01 findings: both callers, floors, byte-freeze mechanism, RPC single-definition proof, PROD fossil-row evidence |
| RANK-02 | Anon readers get explicit projections; `daily_returns`/`metrics_json`/`data_quality_flags` absent | §RANK-02: full splat inventory at HEAD, per-site reachability classification, consumer field inventory, column list |
| RANK-05 | quantstats price-detection sign-flip closed on strategy-analytics path | §RANK-05: verified `_prepare_returns` heuristic, kwarg availability matrix, P114 closed-path pattern, blast radius |
| RANK-06 | Blend annualization treats unknown-`asset_class` legs as crypto for RISK | §RANK-06: `blendPeriodsPerYear` decision point + all 4 production call sites, Python side already closed |
| RANK-07 | Concurrent same-session resubmits cannot both take FILL arm — CAS on `category_id IS NULL` | §RANK-07: exact UPDATE statement, `.is()` precedent, 0-rows-detection requirement, existing route-test harness |
| RANK-08 | Re-mint fingerprint accounts for classification (or exclusion documented) | §RANK-08: fingerprint + signature source, both call sites, falsified docblock claim = evidence FOR inclusion |
| RANK-09 | `withPublishedOrOwner` validates uid shape before `.or()` interpolation | §RANK-09: exact interpolation, `isUuid`/`UUID_RE` house pattern, module-purity constraint |
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Percentile gate (RANK-01 TS) | Next.js server (RSC data layer, `queries.ts`) | — | Percentiles are computed server-side from PostgREST reads |
| Percentile gate (RANK-01 SQL) | Database (SECURITY DEFINER RPC via migration) | — | `get_verified_cohort_rank` bypasses RLS; its cohort predicate is SQL-only |
| Anon column projections (RANK-02) | Next.js server (query builders) | Database (RLS is row-level, CANNOT hide columns) | RLS `analytics_read` has no TO clause → applies to anon; projection is the only column control |
| Money math — quantstats (RANK-05) | Python worker (`analytics-service/services/metrics.py`) | — | `compute_all_metrics` is the strategy-analytics KPI writer |
| Money math — blend clock (RANK-06) | Next.js server + client (`closed-sets.ts` isomorphic helper) | — | All 4 production blend call sites derive from the ONE helper |
| Resubmit CAS (RANK-07) | API route (`csv-finalize/route.ts`) | Database (the CAS predicate executes in PostgREST/SQL) | Race is between two route invocations; the `.is()` filter makes SQL the arbiter |
| Re-mint fingerprint (RANK-08) | Browser client (`WizardClient.tsx` + `localStorage.ts`) | — | The fence is a client-session mechanism; server equality refusal is unchanged backstop |
| uid shape validation (RANK-09) | Shared pure lib (`visibility.ts` — client-safe module) | — | Module is deliberately pure/isomorphic; fix must not add server-only imports |

## Standard Stack

**No new packages.** This phase installs nothing; every fix uses already-pinned dependencies.

| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| quantstats | 0.0.81 (pinned, `analytics-service/requirements.txt:206` + `requirements-dev.txt:16`) | Python metrics — the RANK-05 defect lives in its `_prepare_returns` | `[VERIFIED: analytics-service/requirements.txt:206]` — pin unchanged by this phase (D-04: no fork/pin change) |
| @supabase/supabase-js (PostgREST builder) | already in repo | `.is("category_id", null)` CAS filter on update chains | `[VERIFIED: src/app/api/admin/deletion-requests/[id]/approve/route.ts:345-346]` — `.is("completed_at", null).is("rejected_at", null)` on an `.update()` chain is an existing house pattern |
| zod | already in repo | only import allowed in `closed-sets.ts` (module-header rule) | `[VERIFIED: src/lib/closed-sets.ts:16-18]` "This module imports ONLY zod." |

## Package Legitimacy Audit

Not required — the phase installs zero external packages. No SLOP/SUS candidates exist.

## Requirement-by-Requirement Findings

### RANK-01 — Percentile gate (TS callers + RPC)

**The two TS callers** (both must share ONE filter helper per success criterion 1):

- `getPercentiles` — `src/lib/queries.ts:141`. Projections at :150 and :156: `` strategy_analytics (${analyticsColumns}) `` where `analyticsColumns = PERCENTILE_ANALYTICS_COLUMNS` (:144). Floors: `if (strategies.length < 5) return null;` (:170) and `if (rows.length < 5) return null;` (:180). Rows with a missing/null `strategy_analytics` embed are already skipped via `extractAnalytics` returning null (:174-178). `[VERIFIED: src/lib/queries.ts:141-183]`
- `getOwnRowPercentiles` — `src/lib/queries.ts:617`. Projection at :625: `` .select(`id, strategy_analytics (${PERCENTILE_ANALYTICS_COLUMNS})`) ``. Floors at :634 and :646. `[VERIFIED: src/lib/queries.ts:617-646]`

**The frozen constant**, verbatim `[VERIFIED: src/lib/queries.ts:126-127]`:

```ts
const PERCENTILE_ANALYTICS_COLUMNS =
  "cagr, sharpe, sortino, calmar, max_drawdown, volatility, cumulative_return";
```

**Why it is byte-frozen** (the "mirror prose at three sites"): `CLOCK_SAFETY_KPI_COLUMNS` in `src/app/api/strategies/csv-finalize/route.ts:1039-1047` duplicates those seven members, verbatim `[VERIFIED: src/app/api/strategies/csv-finalize/route.ts:1039-1047]`:

```ts
const CLOCK_SAFETY_KPI_COLUMNS = [
  "cagr",
  "sharpe",
  "sortino",
  "calmar",
  "max_drawdown",
  "volatility",
  "cumulative_return",
] as const;
```

The three prose sites: route.ts:1031 ("MIRRORING `PERCENTILE_ANALYTICS_COLUMNS` … member for member"), :1488 ("The column set MIRRORS `PERCENTILE_ANALYTICS_COLUMNS`"), and :1505 ("`computation_status` JOINS THE PROJECTION, and it is NOT a member of `CLOCK_SAFETY_KPI_COLUMNS`"). Appending `computation_status` to `PERCENTILE_ANALYTICS_COLUMNS` would falsify all three — hence the separate `PERCENTILE_GATE_COLUMN` constant, appended at the projection site: `` strategy_analytics (${PERCENTILE_ANALYTICS_COLUMNS}, ${PERCENTILE_GATE_COLUMN}) ``.

**Gate semantics**, verbatim `[VERIFIED: src/lib/closed-sets.ts:715-719]`:

```ts
export function isComputedAnalytics(
  status: string | null | undefined,
): boolean {
  return status === "complete" || status === "complete_with_warnings";
}
```

The full status closed set, verbatim `[VERIFIED: src/lib/closed-sets.ts:696-702]`:

```ts
export const STRATEGY_ANALYTICS_COMPUTATION_STATUSES = [
  "pending",
  "computing",
  "complete",
  "complete_with_warnings",
  "failed",
] as const;
```

**Helper placement:** D-03 fixes it in `closed-sets.ts`. Compatible with the module-header rule ("This module imports ONLY zod", closed-sets.ts:16) — a pure row-filter helper needs no imports, and `queries.ts` already imports from closed-sets (`blendPeriodsPerYear` at queries.ts:8), so no cycle. The helper should take a row's gate-column value (or a row carrying it) and delegate to `isComputedAnalytics` — it must NOT re-derive status semantics (CONTEXT code-insight).

**The RPC** — `supabase/migrations/20260626120000_get_verified_cohort_rank.sql` is the ONLY definition: repo-wide grep of `supabase/migrations/` for `get_verified_cohort_rank` matches exactly this one file `[VERIFIED: grep 2026-08-21 + Read of the migration]`. Re-verify at plan time (house rule), but today "re-base on latest def" = re-base on this file. Facts the lockstep change needs:

- Cohort predicate appears TWICE (count query :174-184, rank query :212-227), both as: `s.status = 'published' AND a.sharpe IS NOT NULL AND a.sortino IS NOT NULL AND a.max_drawdown IS NOT NULL AND EXISTS (SELECT 1 FROM strategy_verifications v WHERE v.strategy_id = s.id AND v.status = 'published')`. The gate predicate `AND a.computation_status IN ('complete', 'complete_with_warnings')` must be added to BOTH, or the min-N denominator diverges from the rank numerator (the migration's own auditor-MEDIUM lesson at :56-62). `[VERIFIED: supabase/migrations/20260626120000_get_verified_cohort_rank.sql:174-227]`
- Min-N floor: `v_min_n CONSTANT INT := 20;` (:152). `[VERIFIED: same file:152]`
- The parity prose (what D-03 calls "parity-by-construction"), verbatim from the header (:72-73, :83): "Ranking convention (parity-by-construction with getPercentiles)" … "The RPC mirrors that EXACTLY". The COMMENT ON FUNCTION (:241-242) repeats "for parity-by-construction". A TS-side gate without the SQL twin falsifies this prose — the reason D-03 defaults to lockstep.
- New-migration mechanics: `CREATE OR REPLACE FUNCTION` carrying the FULL body (never a diff), keep the SECURITY DEFINER + `SET search_path = public, pg_catalog` + REVOKE/GRANT + self-verifying DO block pattern of the original. ⚠️ Merging `supabase/migrations/**` to main AUTO-applies to PROD (house ops memory) — the census (D-01) must be committed BEFORE this migration merges.
- The status-gate is NOT redundant with the `IS NOT NULL` predicates: PROD carries failed rows WITH KPI values — route.ts:1493-1500 records "PROD carries 7 zero-dailies csv strategies whose failed rows DO hold a sharpe and a cagr, computed 2026-05-27 under older code". `[VERIFIED: src/app/api/strategies/csv-finalize/route.ts:1493-1500]` These are exactly the rows the census should surface.
- RPC caller: `src/app/api/scenario/peer-rank/route.ts` (+ `route.test.ts`); a HAS_LIVE_DB integration test exists at `src/__tests__/verified-cohort-rank-rls.test.ts` but NEVER runs in CI (house rule: only `supabase/tests/test_*.sql` run in CI; no SQL test pins this RPC today — grep of `supabase/tests/` returned zero matches).

**C-M1 census design** — see Code Examples for a concrete read-only SQL. Population sources: `strategies` (`status`, `category_id`), `strategy_analytics` (`computation_status` + the seven KPI columns), `discovery_categories` (`slug`), `strategy_verifications` (`status='published'` for the RPC cohort). Floors to check against: `< 5` (queries.ts:170/:180/:634/:646) and `20` (RPC :152). The per-strategy percentile snapshot keys on strategy **ids only** (ids are non-secret per SHARE-01; never names/emails/uids — repo is PUBLIC and `.planning/` is tracked).

### RANK-02 — Splat-class closure

**Complete inventory at HEAD `5916012b`** (repo-wide grep including tests/scripts — house rule after the v1.10 lesson):

| # | Site | Function | Reachability | Disposition per D-02 |
|---|------|----------|--------------|----------------------|
| 1 | `src/lib/queries.ts:210` | `getStrategiesByCategory` | **ANON** — called by `src/app/browse/[slug]/page.tsx:38` (no auth gate; public marketing browse) and authed `discovery/[slug]/page.tsx:39` | Explicit projection |
| 2 | `src/lib/queries.ts:310` | `getMyStrategies` | **OWNER-ONLY** — `.eq("user_id", userId)` at :311 | Keep splat + one-line exemption comment |
| 3 | `src/lib/queries.ts:936-937` | `getStrategyDetail` | **ANON** — called by `src/app/strategy/[id]/page.tsx:28,:86` (getUser is optional, no redirect — verified :95-119) and authed `discovery/[slug]/[strategyId]/page.tsx:39` | Explicit projection |
| 4 | `src/app/(dashboard)/compare/page.tsx:68` | inline | **AUTHED allocator, cross-tenant** (`redirect("/login")` + `requireRolePage(…, "allocator")` at :30-34) — but named explicitly by the requirement | Explicit projection |

Comment-only references (no code change, but their prose must stay true or be updated): `queries.ts:332`, `queries.ts:1120`, `discovery/[slug]/[strategyId]/page.tsx:123`, `my-strategies/page.test.tsx:17,:60` (pins the OWNER splat shape — consistent with the exemption), `queries.test.ts:662`, `phase-147-series-resolution-guards.test.ts:38`, `queries.has-any-own-strategies.test.ts:15`.

**Full `strategy_analytics` column inventory** (for building projection lists), from `src/lib/database.types.ts` Row type `[VERIFIED: src/lib/database.types.ts, strategy_analytics Row]`: `benchmark, cagr, calmar, computation_error, computation_status, computation_warned, computed_at, computing_started_at, cumulative_return, daily_returns, data_quality_flags, drawdown_series, exposure_metrics, id, max_drawdown, max_drawdown_duration_days, metrics_json, metrics_json_by_basis, monthly_returns, return_quantiles, returns_series, rolling_metrics, series_completeness, sharpe, six_month_return, sortino, sparkline_drawdown, sparkline_returns, strategy_id, trade_metrics, volatility, volume_metrics`.

**Consumer field facts the projection lists must honor** (exact column lists are Claude's discretion, but these are measured constraints):

- `StrategyTable` (consumer of site 1 rows) renders `sparkline_returns` (:1111) and `sparkline_drawdown` (:1118) — sparkline columns MUST stay in the list projection. Its ONLY `metrics_json` use is the advanced 3M filter reading `mj?.three_month` (:567-568) — excluding `metrics_json` degrades only that filter (options: accept degradation, or alias-project `three_month:metrics_json->three_month`; note queries.ts:1130-1132 claims "PostgREST cannot project a JSONB sub-tree without an RPC" — the planner must reconcile that comment with the `->` operator if aliasing is chosen). `computation_status` must join list projections: `shapeRankingRows` (queries.ts:251) / Phase-147 series-state logic depends on it.
- `getStrategyDetail` (site 3) feeds `discovery/[slug]/[strategyId]/page.tsx`, which reads `analyticsRow?.data_quality_flags` (`dqf`, page :85) and depends on `computation_status` "arriv[ing] on the row" (page :123 comment). ⚠️ This is the phase's sharpest RANK-02 tension: the SAME function serves the anon `/strategy/[id]` page. The projection must retain `computation_status`; whether `data_quality_flags` stays (server-consumed, not necessarily client-forwarded) or the function grows a caller-scoped projection is a planner decision — enumerate BOTH pages' actual analytics-field reads before cutting the list.
- The house precedent to copy is `getStrategyDetailV2`'s path-extraction projection (`queries.ts:1118-1133`) — the codebase already did exactly this conversion once.
- RLS context (why projection is the only lever): policy `analytics_read` (migration `20260405061912:35-44`) is `status = 'published' OR user_id = auth.uid()` **with no `TO` clause**, so it applies to `anon`; RLS is row-level and cannot hide a column. `[CITED: TODOS.md @ ca3f0c5c L1143-1150 — the original finding; re-verify the policy text when writing the plan]`

### RANK-05 — quantstats price-detection sign-flip (Python)

**Defect mechanism**, verbatim from the INSTALLED quantstats 0.0.81 `_prepare_returns` `[VERIFIED: local `python3 -c "inspect.getsource"` against the 0.0.81 install, 2026-08-21]`:

```python
elif data.min() >= 0 and data.max() > 1:
    data = data.pct_change(fill_method=None)
```

An all-non-negative daily-returns series with one >100% day (`max > 1`) is silently re-read as PRICES and `pct_change`-d. Note `_prepare_returns` also does `data.fillna(0)` — relevant to blast radius below. (⚠️ Verified against the Mac-local install; re-verify inside `analytics-service`'s CI environment — same `==0.0.81` pin, but the local-behind-pin drift class is a known house failure mode.)

**The previously-closed path (the pattern D-04 mandates mirroring):** `sharpe_vol_status_from_backbone`, `metrics.py:1299-1371` (Phase 114). Its mechanism is INLINE pandas math that never enters quantstats, verbatim `[VERIFIED: analytics-service/services/metrics.py:1360-1366]`:

```python
vol = _safe_float(returns.std() * math.sqrt(periods_per_year))
mean_ret = returns.mean() * periods_per_year
...
sharpe = _safe_float(mean_ret / vol)
```

Its docblock states the exact defect: "the unified pipeline routes through quantstats `_prepare_returns`, which carries a PRICE-detection heuristic … an all-non-negative series whose `max > 1` is assumed to be a PRICE path and silently `pct_change`-d, which FLIPS the sign of Sharpe" (:1315-1324). Consumers of the closed path: `routers/portfolio.py:2406` + verify_strategy.

**The still-exposed strategy-analytics path:** `compute_all_metrics` (`metrics.py`), the KPI writer for `strategy_analytics`. Callers: `analytics_runner.run_csv_strategy_analytics` (analytics_runner.py:1181 region — CSV strategies) and the process_key/job_worker pipelines. Its `qs.stats` call sites (headline + metrics_json):

| metrics.py line | Call | Has `prepare_returns=` kwarg in 0.0.81? |
|------|------|------------------------------------------|
| :700 | `qs.stats.max_drawdown(returns)` | NO (routes through `_prepare_prices`) |
| :702 | `qs.stats.to_drawdown_series(returns_for_chart)` | NO |
| :707 | `qs.stats.volatility(stat_returns, periods=…)` | **YES** |
| :708 | `qs.stats.sharpe(stat_returns, periods=…)` | **NO** |
| :713 | `qs.stats.sortino(stat_returns, rf=MAR, periods=…)` | **NO** |
| :826 | `qs.stats.value_at_risk(…, confidence=0.95)` | YES |
| :836 | `qs.stats.cvar(returns)` | YES |
| :884 | `qs.stats.omega(returns)` | NO |
| :893 | `qs.stats.gain_to_pain_ratio(returns)` | NO |
| :902 | `qs.stats.tail_ratio(returns)` | YES |
| :935/:944 | `qs.stats.smart_sharpe` / `smart_sortino` | NO |
| :966 | `qs.stats.profit_factor(returns)` | YES |

`[VERIFIED: inspect.signature sweep against the installed 0.0.81, 2026-08-21]`

**Planner consequence:** D-04's slash reads operationally as — functions WITH the kwarg get `prepare_returns=False` plus caller-side cleanup equivalent to what `_prepare_returns` did minus the price guess (inf→NaN handling is already largely done upstream; verify per site); headline `sharpe`/`sortino` (no kwarg) mirror the P114 inline-math pattern exactly. **No new abstraction**: the docblock pattern of `sharpe_vol_status_from_backbone` is the template.

**Blast radius (must be measured, not assumed):** inline pandas uses skipna (NaN days dropped from the statistic) while `_prepare_returns` does `fillna(0)` (NaN days counted as 0-return). On NaN-bearing series the two divergence-free only when no interior NaN exists. Golden/parity suites that will detect movement: `tests/test_metrics_parity.py`, `tests/test_metrics.py`, `tests/test_accuracy.py`, `tests/test_mt5_golden_fixtures.py`, `tests/test_teaser_derive_golden.py`, `scripts/zavara_acceptance.py`, `tests/fixtures/regen_golden.py`. A fixture that moves is a FINDING to adjudicate (which NaN convention is the honest one), not a regen-and-move-on.

### RANK-06 — Blend RISK annualization: unknown → crypto

**CORRECTION to the orchestrator's brief:** the fix point is TS, not `analytics-service`. The ONE decision point, verbatim `[VERIFIED: src/lib/closed-sets.ts:605-609]`:

```ts
export function blendPeriodsPerYear(
  legs: ReadonlyArray<{ asset_class?: string | null }>,
): number {
  return legs.some((l) => l.asset_class === "crypto") ? 365 : 252;
}
```

Production call sites (all derive from this helper — the fix at the helper covers the class): `src/lib/queries.ts:2985` (live-baseline `computeScenario`), `src/app/scenario-share/[token]/share-resolve.ts:363`, `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:3222`, `src/app/(dashboard)/allocations/lib/scenario-compare.ts:349`. `[VERIFIED: grep 2026-08-21]`

**The Python side is already closed** — do not re-fix it: `closed_sets.py:195-213` (CRYPTO_VENUES docblock: "proactively closes the known unknown-asset_class √252 blend-underestimation class"), and job_worker's composite clock is `periods_per_year_for_asset_class(strategies.asset_class)` with a venue-blend cross-check that fails loud on divergence (job_worker.py:6293-6330). `CRYPTO_VENUES` verbatim `[VERIFIED: analytics-service/services/closed_sets.py:211-213]`: `frozenset({"deribit", "binance", "okx", "bybit", "sfox"})`.

**Where "unknown" actually comes from:** `strategies.asset_class` is `NOT NULL DEFAULT 'traditional'` (route.ts:1434-1435 cites migration `20260709130000:26-27`), so a DB-read leg is never SQL-NULL. Unknown = a leg OBJECT that omits the field (the structural param type admits `asset_class?: string | null`) — i.e., a caller whose projection/shape drops the column (the v1.11 "per-key refs invisible to naive diff" class). The planner must enumerate each call site's leg-source projection: e.g. queries.ts:2978-2981 documents that per-key legs all carry `asset_class "crypto"` today. The helper-level fix (`l.asset_class === "crypto" || l.asset_class == null` → crypto, or equivalent) makes the projection gap harmless regardless.

**Two deliberate behavior changes to record in the docblock:** (a) the current docblock's "An empty or all-unknown blend keeps the 252 pre-#597 default byte-identical" becomes false for all-unknown (empty should stay 252 — a planner decision to state explicitly); (b) the scope is the RISK basis only — #597 law: RISK rides the frequency clock, RETURN/CAGR ride the calendar clock and must not move. Confirm `blendPeriodsPerYear`'s output feeds only RISK annualization at each call site (queries.ts:2232 comment says it is the blend RISK basis). MD-01 discipline: the fix adds NO venue literal anywhere; if any venue-adjacent logic appears Python-side it must import `CRYPTO_VENUES`.

### RANK-07 — FILL-arm compare-and-set

**The pieces at HEAD** (all in `src/app/api/strategies/csv-finalize/route.ts`):

- Resolve projection: `.select("id, name, status, category_id, asset_class")` (:1216, with the 146.2-01/R1 comment at :1210). `[VERIFIED: route.ts:1210-1216]`
- FILL discriminator: `if (existingRow.category_id === null) {` (:1451); the ⭐ "THE DISCRIMINATOR IS `category_id IS NULL`" anchor comment at :1433-1443; sibling anchors at :423 ("LOAD-BEARING: `category_id IS NULL` on the committed row is the FILL") and :2595. The mismatch/refuse arm: :1673-1699 (`typeof existingRow.category_id === "string"` → 409 on divergent `requestedCategoryId`); the absent-reading arm at :1699.
- The UPDATE both racers run — verbatim `[VERIFIED: route.ts:2068-2072]`:

```ts
const { error: updateError } = await supabase
  .from("strategies")
  .update(updatePayload)
  .eq("id", strategyId)
  .eq("user_id", userId);
```

inside `applyCsvMetadataUpdate` (:2034), invoked at :2602 under `if (outcome.fresh || outcome.fillClassification)` (:2601); the FILL arm already refuses honestly when `metaResult.kind !== "applied"` (:2610-2629, `CSV_PERSIST_FAIL` 503).

**The CAS:** append `.is("category_id", null)` to that chain. supabase-js precedent on `.update()` chains exists in-repo: `deletion-requests/[id]/approve/route.ts:345-346` and `reject/route.ts:163-164` (`.is("completed_at", null)`), `create-with-key/route.ts:193`. Safe on BOTH arms that reach this UPDATE (a fresh row's `category_id` is also NULL — the fold's INSERT never writes it, :1438).

**⚠️ The load-bearing subtlety:** PostgREST returns NO error when an UPDATE matches 0 rows — a raced-out second writer would currently return `kind: "applied"`, a false receipt (exactly the BL-01 class this route just paid for at :2580-2591). The CAS must be paired with row-count observation: chain `.select("id")` and map `data.length === 0` to a distinct result kind (e.g. `"raced"`), routed into the existing `metaResult.kind !== "applied"` refusal at the FILL arm. The IN-04 record's "second writer is a no-op" is the mechanism; BL-01's "no false receipt" decides how the no-op is REPORTED. Divergent-classification racers then resolve honestly: the loser re-submits, reads a now-non-NULL `category_id`, and takes the :1673 refuse/echo arm.

**Test harness that exists today:** `src/__tests__/csv-finalize-cross-submission-merge.test.ts` imports the real `POST` (:268) and drives it with `NextRequest` against a mocked supabase builder that records every ordered read (:97); the FILL/REFUSE describe block is at :1417. Siblings: `csv-finalize-rpc.test.ts:165-220` (FILL semantics), `csv-finalize-c14-regression.test.ts:942-1065`. The two-writer race test interleaves two `POST`s whose mocked resolve reads BOTH return `category_id: null`, with the mock honoring `.is("category_id", null)` (first update matches, second returns empty data) — and a wiring pin that the update chain received the `.is` filter (neuterable: remove `.is` → RED).

### RANK-08 — Re-mint fingerprint × classification

**Sources** (`src/lib/wizard/localStorage.ts`): `csvSubmissionSignature` :664-672 — verbatim `[VERIFIED: src/lib/wizard/localStorage.ts:664-672]`:

```ts
export function csvSubmissionSignature(
  strategyName: string,
  series: readonly { date: string; daily_return: number }[] | undefined,
): string {
  const rows = (series ?? []).map((r) => `${r.date}=${r.daily_return}`).join("|");
  // NUL separates the two fields so no name/series boundary is ambiguous.
  return `${strategyName}\u0000${rows}`;
}
```

`csvSubmissionFingerprint` :702-717 (64-bit two-lane FNV-1a over the signature, prefixed with exact signature length). Call sites: `WizardClient.tsx:587` (the re-mint effect, deps `[source, strategyName, csvDailyReturnsSeries, wizardSessionId, step]` at :624) and :635 (`handleCsvSubmitFailed`, deps at :651). Wizard classification state exists in `WizardClient`: `categoryId` (:272), `assetClass` (:294).

**Evidence bearing on D-05's decision:** the signature docblock claims "`date` and `daily_return` are the only fields that reach `csv-finalize`, so they are the only fields fingerprinted" (:661-662) — that premise is FALSE today (`metadata.category_id`/`asset_class` also reach csv-finalize and are precisely what the 146.2 classification-conflict 409 refuses on). No source evidence of intentional cross-classification dedupe was found; the IN-03 record explicitly frames the omission as the defect. → D-05's default arm (include classification) stands on evidence; the falsified docblock sentence must be corrected in the same edit.

**Safety of widening:** a persisted pre-change burn will never equal a post-change fingerprint → the fence reads "material change" → re-mints. That FREES stuck sessions (the safe direction); the server-side series-equality refusal (route.ts:820-863 per the fingerprint docblock) remains the operative fence. Implementation constraints: classification values join the SIGNATURE (more NUL-separated fields), both call sites pass them, and BOTH React dep arrays (:624, :651) gain the classification state — a fingerprint that reads stale state via a missing dep is the silent failure mode here.

### RANK-09 — uid shape validation in `withPublishedOrOwner`

**The interpolation**, verbatim `[VERIFIED: src/lib/visibility.ts:115-125]`:

```ts
export function withPublishedOrOwner<Q>(query: Q, authUserId: string): Q {
  return (query as { or(filter: string): Q }).or(
    `status.eq.published,user_id.eq.${authUserId}`,
  );
}
```

**House validation pattern**, verbatim `[VERIFIED: src/lib/utils.ts:77-83]`:

```ts
export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}
```

**Fix shape per D-06:** validate `authUserId` with `isUuid` BEFORE `.or()`; non-conforming → fail CLOSED to the published-only predicate (append `.eq("status","published")` — i.e. the `withPublishedOnly` shape) and fail LOUD (log; see constraint below). Constraints: (a) `visibility.ts` is deliberately PURE and client-safe — "it imports nothing server-only (no `next/headers`, no `@/lib/supabase/server`)" (:17-19); `utils.ts` `isUuid` is pure, importable; `captureToSentry` must be checked for client-purity before importing — `console.error` is the safe floor. (b) The only consumer is GET `/api/strategies/browse`, whose `authUserId` comes from `withAllocatorAuth` session (:103-106 docblock) — today's inputs are well-formed, so the change is defense-in-depth with near-zero behavioral blast radius. Tests: `src/lib/visibility.test.ts` (fake-builder harness verified — asserts exact `.or()` payload and builder identity; the new tests assert the fail-closed arm calls `.eq("status","published")` and never `.or` for a malformed uid, e.g. `"x) or (user_id.neq.z"`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Terminal-success semantics | A second status predicate | `isComputedAnalytics` (closed-sets.ts:715) | A literal `complete` filter drops `complete_with_warnings` — the exact defect RANK-01 names |
| UUID validation | A new regex | `isUuid` / `UUID_RE` (utils.ts:77-83) | Every API route already uses it; pinned by utils.test.ts:188 |
| CAS on update | Advisory locks / SELECT-FOR-UPDATE RPC | `.is("category_id", null)` on the update chain | House precedent (deletion-request routes); the race window is one UPDATE, SQL is the arbiter |
| Explicit projection shape | A fresh convention | `getStrategyDetailV2`'s path-extraction projection (queries.ts:1118-1133) | The codebase already converted a splat once; copy its shape and docblock discipline |
| Crypto-venue membership (if any Python edit) | A new literal | `closed_sets.py::CRYPTO_VENUES` | MD-01 single source; a second literal is the drift mechanism it exists to kill |
| Inline Sharpe/vol math | A new quantstats wrapper | `sharpe_vol_status_from_backbone`'s exact pattern (metrics.py:1299) | D-04: mirror the closed path, no new abstraction |

## Runtime State Inventory

Not a rename phase, but two PROD-data facts are load-bearing:

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | PROD `strategy_analytics`: ~7 zero-dailies CSV strategies whose `failed` rows HOLD sharpe/cagr values (2026-05-27 era, route.ts:1493-1500) — these currently pollute percentiles and are what the gate removes | Census counts them (C-M1); NO data migration — the gate is a read-time filter |
| Stored data | PROD categories near the <5 / min-N 20 floors — unknown until census | C-M1 census BEFORE the filter lands (D-01); artifact `159-CENSUS.md`, counts + percentiles only, ids not names/emails |
| Live service config | None — no env vars, flags, crons, or external services change | None |
| Secrets/env vars | None; ⛔ never read `.env.local` (PROD env); TEST env only via `.env.test.local` | None |
| Build artifacts | None — TS + one SQL migration + one Python module | None (migration auto-applies to PROD on merge — sequence census → migration) |

## Common Pitfalls

### Pitfall 1: Literal `complete` filter
**What goes wrong:** `complete_with_warnings` is a terminal SUCCESS; an exact-match filter blanks warned strategies' ranks. **Avoid:** gate ONLY through `isComputedAnalytics` / the SQL two-value IN-list mirroring it. **Warning sign:** any new `=== "complete"` or `= 'complete'` in the diff.

### Pitfall 2: Appending to `PERCENTILE_ANALYTICS_COLUMNS`
**What goes wrong:** falsifies the "member for member" mirror prose at csv-finalize :1031/:1488/:1505 (`CLOCK_SAFETY_KPI_COLUMNS`). **Avoid:** separate `PERCENTILE_GATE_COLUMN` constant, composed at the projection sites only.

### Pitfall 3: `prepare_returns=False` sweep as the whole RANK-05 fix
**What goes wrong:** `sharpe`/`sortino` (the headline ranked KPIs!) have NO such kwarg in 0.0.81 — a kwarg-only fix leaves the exact defect open on the two metrics that matter most. **Avoid:** P114 inline-math mirror for sharpe/sortino; kwarg for the functions that have it.

### Pitfall 4: NaN-convention drift moving golden fixtures silently
**What goes wrong:** inline pandas skipna vs `_prepare_returns` `fillna(0)` diverge on interior-NaN series; parity/golden suites fail (or worse, get regenerated without adjudication). **Avoid:** run the full analytics-service suite per change; treat fixture movement as a finding.

### Pitfall 5: Breaking list consumers with an over-narrow projection
**What goes wrong:** dropping `sparkline_returns`/`sparkline_drawdown` blanks table sparklines; dropping `computation_status` breaks Phase-147/149 series-state + rank shaping; dropping `metrics_json` silently degrades the 3M advanced filter. **Avoid:** enumerate consumer reads per site before writing each list (§RANK-02 facts above).

### Pitfall 6: CAS without row-count observation
**What goes wrong:** PostgREST reports success on a 0-row UPDATE; the raced-out writer returns `"applied"` — a false receipt, the BL-01 class. **Avoid:** `.select("id")` + distinct `"raced"` outcome into the existing `!== "applied"` refusal.

### Pitfall 7: Widened fingerprint with stale React deps
**What goes wrong:** classification joins the fingerprint but not the dep arrays at WizardClient :624/:651 — the fence compares stale values and the 409's remedy still dead-ends. **Avoid:** both dep arrays move with the inputs; test drives a classification change and asserts a re-mint.

### Pitfall 8: Asserting rank direction
**What goes wrong:** removing polluted rows moves other strategies' percentiles BOTH ways. A "ranks improve" assertion is forbidden by success criterion 2. **Avoid:** tests pin membership (gated rows excluded; `complete_with_warnings` retained), never direction.

### Pitfall 9: RPC migration hygiene
**What goes wrong:** a partial-body `CREATE OR REPLACE` drops the auth guard/quantization/REVOKEs; or the migration merges before the census exists (auto-applies to PROD). **Avoid:** full re-based body + self-verifying DO block; census artifact committed first (D-01 ordering).

## Code Examples

### C-M1 census SQL (read-only; counts + ids only)

```sql
-- Per-category published-with-analytics counts, before/after the gate,
-- against the <5 badge floor (queries.ts) — plus the uncategorized pool.
SELECT
  coalesce(dc.slug, '(no category)')                                   AS category,
  count(*)                                                             AS published,
  count(a.strategy_id)                                                 AS with_analytics_row,
  count(*) FILTER (WHERE a.computation_status IN
                   ('complete','complete_with_warnings'))              AS after_gate,
  (count(a.strategy_id) >= 5)                                          AS badge_floor_before,
  (count(*) FILTER (WHERE a.computation_status IN
                   ('complete','complete_with_warnings')) >= 5)        AS badge_floor_after
FROM strategies s
LEFT JOIN strategy_analytics a  ON a.strategy_id = s.id
LEFT JOIN discovery_categories dc ON dc.id = s.category_id
WHERE s.status = 'published'
GROUP BY 1 ORDER BY 1;

-- RPC cohort (min-N 20 floor), before/after the gate.
SELECT
  count(*)                                                             AS cohort_before,
  count(*) FILTER (WHERE a.computation_status IN
                   ('complete','complete_with_warnings'))              AS cohort_after
FROM strategies s
JOIN strategy_analytics a ON a.strategy_id = s.id
WHERE s.status = 'published'
  AND a.sharpe IS NOT NULL AND a.sortino IS NOT NULL AND a.max_drawdown IS NOT NULL
  AND EXISTS (SELECT 1 FROM strategy_verifications v
              WHERE v.strategy_id = s.id AND v.status = 'published');

-- The pollution population the gate exists for (ids only — no names/emails).
SELECT s.id, a.computation_status,
       (a.sharpe IS NOT NULL) AS has_sharpe, (a.cagr IS NOT NULL) AS has_cagr
FROM strategies s JOIN strategy_analytics a ON a.strategy_id = s.id
WHERE s.status = 'published'
  AND a.computation_status NOT IN ('complete','complete_with_warnings')
  AND (a.sharpe IS NOT NULL OR a.cagr IS NOT NULL);
```

Per-strategy percentile before/after: replicate `percentile-core`'s count-based rank in SQL (`100.0 * count(<=) / n`, `Math.abs` on max_drawdown, `100 −` for LOWER_IS_BETTER — the RPC comment at migration :80-88 documents the exact convention) or run the TS scorer twice in a read-only script; snapshot keyed by strategy id.

### Gate composition at the projection site (RANK-01 sketch)

```ts
// closed-sets.ts — next to isComputedAnalytics (D-03)
export const PERCENTILE_GATE_COLUMN = "computation_status";
export function isRankableAnalyticsRow(
  row: { computation_status?: string | null } | null | undefined,
): boolean {
  return isComputedAnalytics(row?.computation_status);
}

// queries.ts — both callers, PERCENTILE_ANALYTICS_COLUMNS byte-unchanged
.select(`id, strategy_analytics (${PERCENTILE_ANALYTICS_COLUMNS}, ${PERCENTILE_GATE_COLUMN})`)
// …then filter each embedded row through the ONE helper before scoring.
```

(Exact naming/shape is planner discretion; the invariants are: one helper, delegates to `isComputedAnalytics`, both callers use it, frozen constant untouched.)

### CAS with observed row count (RANK-07 sketch)

```ts
const { data: casRows, error: updateError } = await supabase
  .from("strategies")
  .update(updatePayload)
  .eq("id", strategyId)
  .eq("user_id", userId)
  .is("category_id", null)   // the FILL premise, enforced in SQL
  .select("id");             // 0 rows ⇒ raced out — never report "applied"
```

## State of the Art

No framework/library movement is relevant; the phase is defect closure against pinned versions. One deprecation-adjacent note: `AGENTS.md` warns the repo's Next.js diverges from training data — any route/page edit (compare/page.tsx, csv-finalize route) should be checked against `node_modules/next/dist/docs/` conventions rather than memory.

## Project Constraints (from CLAUDE.md / AGENTS.md / house rules)

- AGENTS.md: read `node_modules/next/dist/docs/` before writing Next.js code; heed deprecation notices.
- Coverage is a blocking CI gate (lines 82 / statements 80 / functions 74 / branches 72 via vitest thresholds).
- DESIGN.md governs visual decisions — this phase has no UI pixels (projection changes must not alter rendered output except decided census-surfaced rank disappearances).
- Banned packages list — untouched (no installs).
- House testing laws (binding on plans): every test must be able to fail (neuter→RED→restore drill); money-math oracles pin ECONOMICS, not the impl's formula; test the wiring, not just the helper; regression test for every defect fix.
- `/ship` not `/gsd-ship`; feature-branch + PR; never bundle commit with edits; VERSION + package.json bump same commit.
- pytest ONLY from `analytics-service/` (VCR cassettes); `python3` not `python`; run `mypy --strict` before ship on analytics-service changes.
- Local vitest full-suite reds ~274 BY DESIGN (`.env.test.local` un-skips `HAS_LIVE_DB`); the valid local gate is a worktree WITHOUT the .env files, or targeted file runs.
- GSD worktree agents get NO node_modules (measured: `npx vitest` exits 1) — plans must run TS validation from an installed checkout or install first.
- Repo is PUBLIC and `.planning/` is tracked — census artifact carries counts/percentiles/ids only; never emails/uids; never read `.env.local`.
- Supabase migrations auto-apply to PROD on merge to main.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The installed-local quantstats 0.0.81 (signatures + `_prepare_returns` body) matches what analytics-service CI/prod runs under the same `==0.0.81` pin | RANK-05 | A kwarg assumed present/absent differs in CI → fix compiles locally, fails in CI (known local-behind-pin class). Cheap re-verification: run the same `inspect.signature` sweep inside the analytics-service environment as a plan step |
| A2 | The `analytics_read` RLS policy text (`status='published' OR user_id=auth.uid()`, no TO clause) is unchanged since the 2026-08-03 finding | RANK-02 | If a later migration narrowed it, the anon-reachability classification of splat sites could relax; grep migrations for `analytics_read` at plan time |
| A3 | PROD census access exists via a read-only mechanism the orchestrator/founder already uses for "close-by-measurement" (prior v1.19 censuses ran PROD counts) | Census | If no read path is available to the executor, the census task blocks — see Open Questions |
| A4 | PostgREST supports JSONB key aliasing in `select` (`three_month:metrics_json->three_month`) despite queries.ts:1130's contrary comment | RANK-02 (optional 3M-filter preservation) | If wrong, the 3M advanced filter degrades under the projection — an accepted-degradation decision, not a blocker |

## Open Questions

1. **How does the census executor read PROD?** (RESOLVED)
   - What we know: prior milestones ran PROD counts ("close-by-measurement", v1.19); the Supabase MCP in this workspace is linked to the TEST project (`qmnijlgmdhviwzwfyzlc` per the RPC migration header); `.env.local` (PROD env) is off-limits to agents.
   - What's unclear: whether the planner should route the census through the Supabase MCP pointed at PROD, a founder-run SQL snippet, or the authed-prod verification pattern.
   - Recommendation: plan the census as a task that EMITS the exact read-only SQL (above) plus a `checkpoint:human-verify`-style step where the orchestrator/founder executes it against PROD and pastes results into `159-CENSUS.md` — the SQL is deterministic either way, and this keeps PROD credentials out of agent hands.
   - **RESOLVED → 159-01-PLAN.md (Tasks 1-2):** the recommendation was adopted — Task 1 authors the `159-CENSUS.md` scaffold embedding the read-only SQL verbatim; Task 2 is a `checkpoint:human-action` where the orchestrator/founder executes it against PROD and commits the pasted results. PROD credentials never reach agent hands.
2. **`getStrategyDetail` projection split** (RESOLVED) (anon `/strategy/[id]` vs authed discovery detail needing `data_quality_flags` + `computation_status`): one shared explicit projection retaining both columns, or a caller-scoped parameter? Planner decides after enumerating both pages' analytics-field reads; retaining `computation_status` is mandatory either way, and `data_quality_flags` is on the requirement's exclusion list for anon responses — the tension must be resolved explicitly, not silently.
   - **RESOLVED → 159-03-PLAN.md (Task 2):** caller-scoped projections — `getStrategyDetail` gains a variant parameter (`public` default | `discovery`) selecting between `STRATEGY_DETAIL_PUBLIC_ANALYTICS_COLUMNS` (excludes `data_quality_flags`, retains `computation_status`) and `STRATEGY_DETAIL_DISCOVERY_ANALYTICS_COLUMNS` (public list plus `data_quality_flags`). The tension is resolved explicitly, per-caller.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | vitest/tsc | ✓ | v25.8.1 local (⚠️ CI = Node 22; CI-only failures reproducible via `PATH=/opt/homebrew/opt/node@22/bin`) | — |
| npm | test runs | ✓ | 11.11.0 | — |
| Python 3 | analytics-service tests | ✓ | 3.14.3 | — |
| pandas + quantstats importable | RANK-05 verification | ✓ (verified from `analytics-service/`) | quantstats 0.0.81 | — |
| PROD DB read | C-M1 census | ✗ (from agent context) | — | Founder/orchestrator executes the emitted SQL (Open Question 1) |

**Missing dependencies with no fallback:** none that block planning; the PROD read has a defined fallback.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Frameworks | Vitest (TS; config `vitest.config.ts`, coverage thresholds 82/80/74/72) + pytest (Python; run from `analytics-service/` only) |
| Quick run (TS) | `npx vitest run <file> --no-file-parallelism` from an installed checkout (⚠️ GSD worktrees have NO node_modules) |
| Quick run (Py) | `cd analytics-service && python3 -m pytest tests/<file> -x` |
| Full suite | `npm run test` (expect ~274 known local reds if `.env.test.local` present — valid gate is a checkout without it, or CI); `cd analytics-service && python3 -m pytest` + `mypy --strict` before ship |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| RANK-01 | Gate excludes non-computed rows; `complete_with_warnings` retained; frozen constant byte-unchanged | unit | `npx vitest run src/lib/queries.percentiles.test.ts src/lib/closed-sets.test.ts --no-file-parallelism` | ✅ both exist (thenable-chain mock harness verified in queries.percentiles.test.ts) — extend |
| RANK-01 (SQL) | RPC cohort gated in both queries; migration invariants | migration self-check + SQL test | self-verifying DO block (house pattern); NEW `supabase/tests/test_get_verified_cohort_rank_gate.sql` (none exists today — Wave 0 gap; `verified-cohort-rank-rls.test.ts` is HAS_LIVE_DB and never runs in CI) | ❌ Wave 0 |
| RANK-02 | Anon-reachable projections exclude the 3 columns; owner splat exempted | unit (capture `.select()` strings via mock builder) | `npx vitest run src/lib/queries.test.ts --no-file-parallelism` + new projection pins | ✅ harness exists — extend; update `my-strategies/page.test.tsx` select-shape pin if touched |
| RANK-05 | All-non-negative series w/ >100% day yields correctly-signed Sharpe from `compute_all_metrics` | unit, economic invariant | `cd analytics-service && python3 -m pytest tests/test_metrics.py -x -k sign` (new test) + full `tests/test_metrics_parity.py` | ❌ new test (harness exists in test_metrics.py); parity/golden suites exist |
| RANK-06 | Sole-crypto-leg blend with unknown `asset_class` leg annualizes RISK on √365 | unit + wiring | `npx vitest run src/lib/closed-sets.test.ts --no-file-parallelism` + a call-site wiring pin (queries.ts:2985 path) | ✅ closed-sets.test.ts exists — extend |
| RANK-07 | Two-writer race: exactly one FILL lands; loser refuses honestly; `.is("category_id", null)` present on the chain | route-level unit | `npx vitest run src/__tests__/csv-finalize-cross-submission-merge.test.ts --no-file-parallelism` | ✅ harness exists (real POST + ordered-read mock) — extend |
| RANK-08 | Classification change re-mints a burned session; identical resubmit does NOT re-mint | unit | `npx vitest run src/lib/wizard/localStorage.test.ts --no-file-parallelism` + WizardClient-level test (locate/extend existing wizard tests) | fingerprint tests: verify at plan time; harness patterns exist in `steps/CsvSubmitStep.test.tsx` |
| RANK-09 | Malformed uid → published-only predicate, never interpolated `.or()` | unit | `npx vitest run src/lib/visibility.test.ts --no-file-parallelism` | ✅ exists (fake-builder harness verified) — extend |

### Sampling Rate
- **Per task commit:** the targeted file commands above (TS from an installed checkout; Py from `analytics-service/`).
- **Per wave merge:** affected-suite sweep + `npm run lint`; analytics-service waves add `mypy --strict`.
- **Phase gate:** full CI green (the `frontend` aggregator is the real gate); census artifact exists BEFORE the RANK-01 migration merges.

### Anti-vacuity & oracle laws (binding)
- Every new pin gets the neuter→observe-RED→restore drill (founder law: a test that cannot fail is worse than none).
- Money-math tests (RANK-05/06) pin ECONOMICS via invariants — e.g. "an all-winning series has non-negative Sharpe", "√365 vol ≥ √252 vol on the same series by exactly √(365/252)" — never the implementation's own formula re-evaluated.
- No test asserts rank DIRECTION (success criterion 2).
- Wiring, not just helper: RANK-06's helper test must be paired with a call-site pin; RANK-07's `.is` must be asserted on the route's actual chain.

### Wave 0 Gaps
- [ ] `supabase/tests/test_get_verified_cohort_rank_gate.sql` — CI-runnable pin for the RPC gate (covers RANK-01 SQL; today the RPC has zero CI-executed tests)
- [ ] `analytics-service/tests/test_metrics.py::test_price_detection_sign_invariant` (name illustrative) — the RANK-05 economic invariant, RED against pre-fix `compute_all_metrics`
- [ ] Locate/confirm the fingerprint test home (`src/lib/wizard/localStorage.test.ts` or sibling) for RANK-08

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V4 Access Control | yes | RANK-02 projections (column-level exposure to anon); RANK-09 predicate integrity; RPC stays REVOKEd from anon w/ in-fn guard (preserve in re-based migration) |
| V5 Input Validation | yes | RANK-09 `isUuid` gate before PostgREST filter-string interpolation (filter-injection class); csv-finalize already `isUuid`-gates `category_id` (route.ts:433) |
| V6 Cryptography | no | fingerprint is explicitly non-cryptographic by design (localStorage.ts:690-696) — do not "upgrade" it |
| V8 Data Protection | yes | Census artifact: counts/percentiles/ids only — repo public, `.planning/` tracked; RPC identity-strip + decile quantization preserved verbatim in the re-based migration |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| PostgREST `.or()` filter injection via uid | Tampering / Info disclosure | Strict UUID validation, fail-closed to published-only (D-06); CONTRIB-04 lint already bans raw owner-OR outside visibility.ts |
| Column over-exposure to anon (RLS is row-level only) | Info disclosure | Explicit projections (D-02); the `readPublicVerificationSignals`/SECDEF precedent for column-explicit anon reads |
| TOCTOU on FILL discriminator | Tampering | SQL CAS `.is("category_id", null)` + observed row count |
| Rank pollution by non-computed KPIs | Integrity | `isComputedAnalytics` gate on both TS callers + RPC (parity-by-construction preserved) |
| Probe-oracle on RPC percentiles | Info disclosure | KEEP decile quantization + min-N 20 + route rate-limit unchanged in the re-based body |

## Sources

### Primary (HIGH confidence — read this session at HEAD 5916012b)
- `src/lib/closed-sets.ts` (full read), `src/lib/queries.ts` (:100-230, :295-370, :600-660, :900-975, :1110-1132, :2970-2990), `src/lib/visibility.ts` (full), `src/lib/utils.ts` (:75-95), `src/lib/wizard/localStorage.ts` (:660-717), `WizardClient.tsx` (:570-651), `compare/page.tsx` (:1-99), `browse/[slug]/page.tsx` (:1-30), `strategy/[id]/page.tsx` (:95-119), `discovery/[slug]/[strategyId]/page.tsx` (:85, :110-130)
- `src/app/api/strategies/csv-finalize/route.ts` (:327-570, :1025-1060, :1200-1240, :1420-1510, :1590-1710, :2030-2130, :2540-2650)
- `supabase/migrations/20260626120000_get_verified_cohort_rank.sql` (full read; repo-wide migration grep = single definition)
- `analytics-service/services/metrics.py` (:525-730, :1290-1371 + qs-call grep), `closed_sets.py` (:185-213), `analytics_runner.py` / `job_worker.py` (targeted greps)
- Installed quantstats 0.0.81: `inspect.getsource(_prepare_returns)` + `inspect.signature` sweep (local; A1 caveat)
- Test harnesses: `queries.percentiles.test.ts`, `visibility.test.ts`, `csv-finalize-cross-submission-merge.test.ts` (heads read)

### Secondary (MEDIUM confidence)
- `TODOS.md @ ca3f0c5c` (git-history recovery): original defect records L855-860 (RANK-05/06), L1143-1150 (RANK-02 + `analytics_read` policy cite), L2086-2090 (RANK-09/DEF-148-C), L3169-3196 (IN-03/IN-04)
- `.planning/REQUIREMENTS.md` §RANK, `.planning/ROADMAP.md` §Phase 159, `159-CONTEXT.md`

### Tertiary (LOW confidence)
- PROD census access mechanism (Open Question 1); PostgREST JSONB-alias projection capability (A4)

## Metadata

**Confidence breakdown:**
- Fix locations & predicates: HIGH — every value quoted verbatim from files read this session
- quantstats behavior: HIGH locally / MEDIUM for CI parity (A1 — one-command re-verification planned)
- Census mechanics: HIGH for the SQL, LOW for the PROD execution path (Open Question 1)
- Blast radius (RANK-05 fixtures, RANK-02 consumers): MEDIUM — populations enumerated, magnitudes must be measured in-plan

**Research date:** 2026-08-21
**Valid until:** the next commit touching any cited file — planner must re-grep line anchors at its own HEAD (house rule; this phase's own history shows refs drift within days)
