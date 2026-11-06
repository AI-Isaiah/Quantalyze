# Phase 162: HONEST — What the user sees is true — Research

**Researched:** 2026-08-25
**Domain:** User-visible data honesty — error copy, freshness claims, equity-curve wiring, wizard affordances (repo-internal; no new libraries)
**Confidence:** HIGH (every behavioural claim verified by reading source at HEAD this session; PROD-data claims marked as census-dependent)

## Summary

Two supervening changes landed AFTER this phase's roadmap entry was written, and they materially shift four of the six requirements:

1. **STALE-01 hotfix (v0.72.1.0, merged to `origin/main` 2026-08-25, commit `dc7b17d3c`).** A failed computation no longer presents as a current one on ELEVEN public surfaces: `shapeRowAnalytics` (exported, `src/lib/queries.ts:440`) nulls the KPI values of any non-terminal-success row, and the discovery-table SyncBadge gate is now unconditional. Per the PROD census in that commit, 17 of 18 published strategies were `failed` — so at HEAD **HONEST-03's headline symptom (stale "Synced Nd ago" badges on discovery) no longer reproduces for those rows**. What remains is a data-repair decision and a class guard (details below).
2. **Phase 161.1 LEDGER-REFRESH (v0.73.0.0, on branch `feat/v1.20-phase-161.1-ledger-refresh`, NOT yet merged to main).** It ships the exact instrument HONEST-02 needs: `public.ledger_refresh_staleness`, a view whose freshness verdict is keyed on `max((e->>'date')::date)` inside `strategy_analytics.returns_series` — "a column that only a real analytics run can advance" (migration `20260825120000`, header). Its D-03 section documents, with measurements, why every other timestamp (`last_sync_at`, `computed_at`, `computing_started_at`, `series_written_at`) is a liar. **HONEST-02's freshness fix should build on this verdict, not invent a second one.**

⚠️ **The v0.73 migration payload is larger than the TODOS 0.1 progress note records.** That note names two migrations; the branch carries **four**, ~3,045 lines total (verified `wc -l` this session):

| Migration | Lines | What it does |
|---|---|---|
| `20260825120000_ledger_refresh_staleness_view.sql` | 492 | The staleness view + immutable parser fn (read-only, revoked from non-service roles) |
| `20260825130000_ledger_refresh_fanout_dormant.sql` | 691 | Single-key fan-out `enqueue_ledger_refresh_for_strategies()`, fail-closed behind `app.ledger_refresh_enabled`, registers NO job |
| `20260825140000_ledger_refresh_composite_arm.sql` | 615 | Composite arm (`stitch_composite` kind), same dormancy contract (D-11: separate function — kinds and chain shapes differ) |
| `20260825150000_sync_status_protect_marked_refresh.sql` | 1,247 | **Rewrites `sync_strategy_analytics_status`** (CR-01): the SQL bridge was undoing the Python D-15 guard one statement later; adds a protected-refresh exemption with a COALESCEd `computation_error` write. Re-based on the latest live definition (`20260802120000`), per the file's own re-base contract |

All four self-describe as behaviour-neutral at merge (dormant / guard-scoped), but `20260825150000` is a full re-definition of the live status bridge — the largest single migration on the branch — and `supabase/migrations/**` auto-applies to PROD on merge to main. Any Phase 162 change to `computation_error` semantics in that function must re-base on **`20260825150000`**, not `20260802120000`.

**Primary recommendation:** Plan this phase as (1) a diagnostic-first pair of tasks for HONEST-01's root cause and HONEST-02's flat-vs-derive-gap question, using read-only PROD queries (the phase-159 C-M1 census pattern); (2) mechanical, fully-shaped fixes for HONEST-04/05/06 whose fix shapes were already written down in the pre-scope TODOS entries (recovered below from `git show ca3f0c5c2:TODOS.md`); (3) a founder-decision checkpoint for the three open product calls (example-row repair, flat-account copy, orphaned-key reuse scope).

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HONEST-01 | Raw Python exception strings never render as user-facing `computation_error` copy — mapped at the writer, str/None compare root-caused | Writer chain fully traced (§HONEST-01): `classify_exception` catch-all → `compute_jobs.last_error` → SQL bridge branch (b) verbatim copy → wizard envelope. Second live raw writer on the portfolio path. Root cause needs a PROD diagnostic task (protocol given) |
| HONEST-02 | Freshness badge reflects series recency; investigate flat-account vs derive-gap FIRST | Every freshness surface mapped (§HONEST-02); truth-signal exists (`ledger_refresh_staleness`, max-date-in-`returns_series`); evidence protocol for the investigation written; `computed_at`/`last_sync_at` unreliability re-verified at HEAD |
| HONEST-03 | Example strategies don't advertise stale "Synced Nd ago" on discovery | Premise LARGELY ALREADY SATISFIED at HEAD by STALE-01 for failed rows (§HONEST-03); residuals = 159-SEED-01 data-repair decision + optional `is_example` class guard |
| HONEST-04 | `buildEquityCurveSeries` serves real curves; `equityCurve: null` + false comment go | Premise TRUE at HEAD (§HONEST-04); `returns_series` IS selected; series shapes and transform helpers identified; STALE-01 gating requirement flagged |
| HONEST-05 | Drawer-added strategies render CAGR/Sharpe like book rows | Premise TRUE at HEAD (§HONEST-05); fix shape recovered from TODOS WR-02 (widen `/returns` route + `addedMetricsById`); STALE-01 interaction pinned |
| HONEST-06 | "Finish setup →" opens the wizard with the clicked key preselected | Premise TRUE at HEAD (§HONEST-06); deeper than the recorded DEF-149-A fix shape — no saved-key picker exists, and the KEY_ORPHANED unwinnable loop (measured in Phase 161) makes reuse-not-refill the required semantics |
</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md)

- Read `node_modules/next/dist/docs/` guides before writing Next.js code (AGENTS.md — this Next version diverges from training data).
- Read `DESIGN.md` before ANY visual/UI decision; do not deviate without explicit approval. This phase has `UI hint: yes` — the ui-phase workflow (UI-SPEC) is enabled in config and will run.
- Coverage is a blocking CI gate: vitest thresholds lines 82 / statements 80 / functions 74 / branches 72 (`vitest.config.ts`); analytics-service pytest enforces `--cov-fail-under=80`.
- Feature-branch + PR always; never commit from main; `/ship` (not `/gsd-ship`) for commits.
- Tests must be able to fail (founder rule): every regression test proven RED against the neutered fix.
- Money-math oracles pin economics, not the implementation's own formula.
- Banned packages list (CLAUDE.md) — irrelevant here; this phase adds no dependencies.
- `.planning/` is tracked and the repo is PUBLIC — no PII/secrets/prod identifiers in planning docs.

## Working-Tree State (planner must know)

- Current checkout: branch `feat/v1.20-phase-161.1-ledger-refresh` at `5dbafc120` (161.1 docs close-out), tracking its own origin branch. `origin/main` was at `dc7b17d3c` (v0.72.1.0) when this research was read. ⚠️ **CORRECTED POST-RUN: Phase 161.1 MERGED as #713 (squash `91fa2aad`, v0.73.0.0) at 2026-08-25T19:53Z — during this research run** — and its four migrations were applied to PROD and verified (`Supabase Migrate` green; all 4 `schema_migrations` rows + all 5 objects present; the new `sync_strategy_analytics_status` body confirmed live via 3 executable-code hits on `v_protect_hold`). The tree read below is byte-identical to the merged main (`git diff HEAD origin/main` empty), so every code citation stands; only this merge-state sentence was stale. Phase 162 planning should treat 161.1 as LANDED, not pending. All citations below were read from this tree, which contains main's v0.72.1.0 merged in (`93f656fd9`).
- Phase 158 (the declared dependency) is closed (`ecfbb362f`).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Mapping exceptions → user copy (HONEST-01) | Analytics worker (Python) + SQL status bridge | Next.js render (display only) | The requirement locks mapping "at the WRITER"; the render sites (`SyncPreviewStep`, portfolio `StaleWarning`) must keep displaying whatever the column holds |
| Freshness verdict (HONEST-02) | Database (staleness view / series max-date) | Next.js SSR (badge render) | Only a real analytics run advances the series; every app-tier timestamp is proven unreliable (D-03) |
| Discovery badge honesty (HONEST-03) | Next.js SSR (`shapeRowAnalytics` + StrategyTable) | Database (data repair of example rows) | Code half already shipped in STALE-01; remaining half is a data decision |
| Per-strategy equity curves (HONEST-04) | Next.js SSR (portfolio page RSC) | — | Data already on the wire via `getPortfolioStrategies`; pure server-side transform + chart prop |
| Drawer-added metrics (HONEST-05) | API route (`/api/strategies/[id]/returns`) + client lazy-fetch | — | Same row, same RLS, no new round-trip (recorded fix shape) |
| Key preselect (HONEST-06) | Next.js client (overlay → WizardClient) + API route (create-with-key resolver) | — | Client threads the key id; server must support strategy-over-existing-key without re-entered credentials |

## Standard Stack

No new libraries. Everything needed exists in-repo:

| Existing asset | Location | Used for |
|---|---|---|
| `lightweight-charts` (already a dep) | `src/components/portfolio/PortfolioEquityCurve.tsx:4` | HONEST-04 chart (no change to the component needed) |
| `resolveDailyReturnSeries` / `equityCurveToDailyReturns` | `src/lib/factsheet/resolve-series.ts:14,50` | Series-shape resolution (HONEST-04) |
| `shapeRowAnalytics`, `isComputedAnalytics`, `isRankableAnalyticsRow` | `src/lib/queries.ts:440`, `src/lib/closed-sets.ts:747,789` | Status gating (HONEST-03/04/05) |
| `computeFreshness` (12h/48h SoT) / `FreshnessChip` (3d/7d) | `src/lib/freshness.ts:17-18` / `src/app/factsheet/[id]/v2/FactsheetView.tsx:843` | HONEST-02 surfaces |
| `ledger_refresh_staleness` view | `supabase/migrations/20260825120000_...sql` | HONEST-02 truth signal |
| `scrub_freeform_string` | `analytics-service/services/redact.py` (used at `job_worker.py:2733` etc.) | Secret-scrubbing (NOT user-copy mapping — see pitfalls) |
| `deriveEmptySeriesState` | shared by `/api/strategies/[id]/returns` + my-allocation payload (`queries.ts` Phase 147 SC2) | HONEST-05 failed-row withholding |

**Installation:** none.

## Package Legitimacy Audit

This phase installs **no external packages**. No audit rows; nothing flagged.

---

## Premise Verification (the core of this research)

### HONEST-01 — the raw-exception leak: writer chain traced at HEAD

**Premise TRUE as a class.** The PROD evidence (recovered from the pre-scope snapshot, `git show ca3f0c5c2:TODOS.md` ~L1939): a founder-owned strategy's `strategy_analytics.computation_error` holds the bare string `'<' not supported between instances of 'str' and 'NoneType'` — an unprefixed Python `TypeError` message.

**The writer chain that produces exactly this shape, all verified at HEAD:**

1. **The catch-all.** `analytics-service/services/job_worker.py:828` and `:831` — verbatim:
   ```python
   return ("unknown", str(exc)[:500])
   ```
   `classify_exception`'s bottom arms return the bare exception string as the sanitized message for anything unrecognized (the docstring at `:678` promises "sanitized_message"; for the unknown arm sanitization is truncation only).
2. **Into the job row.** That message flows through `mark_compute_job_failed` into `compute_jobs.last_error` (mapping documented at `job_worker.py:7961`: "DispatchResult.error_message → compute_jobs.last_error").
3. **The verbatim copy — THE WRITER the requirement means.** `sync_strategy_analytics_status` branch (b), `supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql:392-394` — verbatim:
   ```sql
   INSERT INTO strategy_analytics (strategy_id, computation_status, computation_error, computing_started_at)
   VALUES (p_strategy_id, 'failed', v_latest_error, NULL)
   ```
   where `v_latest_error` is the newest non-superseded `failed_final` job's `last_error`. This is the seam that turns an operator-diagnostic field into a user-facing column with no mapping. ⚠️ The LATEST definition of this function is now `20260825150000_sync_status_protect_marked_refresh.sql` (on the 161.1 branch) — any change re-bases on THAT file, and its protected branch also writes `computation_error` (COALESCEd from the protected job's `last_error` — same class of content).
4. **User-facing render.** `src/app/(dashboard)/strategies/new/wizard/steps/SyncPreviewStep.tsx:2103-2106`: the `GATE_ANALYTICS_FAILED` cause gains `"Details: {computation_error}."` inside `WizardErrorEnvelope` — the wizard's terminal failure screen. The comment there calls the value "server-scrubbed", which is true only for secrets: `scrub_freeform_string` redacts credentials/PII, it does not map exception prose to user copy.

**A second, independent raw writer (portfolio path), live at HEAD:** `analytics-service/routers/portfolio.py:1191` — verbatim:
```python
_fail(f"{type(exc).__name__}: {str(exc)[:400]}")
```
`_fail` (`portfolio.py:692-701`) writes that into `portfolio_analytics.computation_error`, and the portfolio dashboard renders it verbatim: `StaleWarning` at `src/app/(dashboard)/portfolios/[id]/page.tsx:137-139` renders `Showing last-good data.{error ? ` Error: ${error}` : ""}`. Closing HONEST-01 "as a class" must include this writer or the class regrows one table over.

**Writers that are already curated (do NOT rework):** the CSV runner's terminal arms are fixed literals (`"CSV analytics computation failed."` at `analytics_runner.py:2079,2114`; typed-arm messages at `:1979,:2023`); the reaper writes a fixed literal (`20260802120000:508`); the TS routes write fixed copy (`finalize-wizard/route.ts:2294,2367`, `keys/sync/route.ts:552`). The `job_worker` stamp family prefixes a human sentence then appends `scrubbed` raw text (e.g. `:3700-3704`, `:4256-4258`) — partially mapped; the planner should decide whether the appended raw suffix survives (it is operator-oriented detail on a user-readable column).

**The str/None root cause is NOT statically determinable from this repo.** `'<' not supported between instances of 'str' and 'NoneType'` is a comparison/sort over mixed `str`/`None` values (candidates: any `sorted()`/`min`/`max` over date-keyed rows where a field can be NULL), but the failing row predates several rewrites and the exact site needs the job history. **Diagnostic protocol for the plan (read-only):** pull `compute_jobs` rows (`kind`, `last_error`, `created_at`) for the affected strategy id (recorded in the snapshot entry above), and the matching Sentry events (org/workflow in memory notes; events lag deploys). That yields the traceback → the site → whether it is still reachable at HEAD. Only then choose between "fix the compare" and "the site no longer exists; document + repair the row".

**Also plan a PROD repair census:** rows whose `computation_error` matches exception-shaped patterns (`not supported between instances`, `Traceback`, `Error:` prefixes) — mapping at the writer stops NEW leaks; existing rows keep rendering the old text until repaired or until their next terminal write.

### HONEST-02 — freshness claims: surfaces mapped, investigation protocol

**Premise TRUE.** The factsheet v2 chip (`FreshnessChip`, `src/app/factsheet/[id]/v2/FactsheetView.tsx:843-877`) keys ONLY on `payload.computedAt` — verbatim thresholds:
```ts
: days <= 3 ? "fresh"
: days <= 7 ? "stale"
: "old";
```
Nothing anywhere in the render path consults the END DATE of the return series. So a strategy whose series ended 89 days ago but whose compute ran yesterday reads `COMPUTED · FRESH (0d)` — exactly the snapshot finding (`ca3f0c5c2:TODOS.md` ~L1953, the "Phoenix Protocol" case: window ended 2026-05-06, badge FRESH).

**All freshness/sync surfaces at HEAD (the fix must be class-complete):**

| Surface | Signal used | Cited |
|---|---|---|
| Factsheet v2 `FreshnessChip` | `computedAt` (3d/7d buckets) | `FactsheetView.tsx:843-877` |
| Tearsheet `FreshnessBadge` | `computed_at` via `computeFreshness` (12h/48h) — STALE-01 withholds it for non-computed rows | `factsheet/[id]/tearsheet/page.tsx:196-208` |
| Discovery/browse `SyncBadge` ("Synced Nd ago") | `computed_at`, gated `hasComputedAnalytics` since STALE-01 | `StrategyTable.tsx:969,1158`; `SyncBadge.tsx:27-48` |
| Portfolio constituents (`FreshnessBadge`, stale-constituent warning, donut stale flag) | `computed_at` | `portfolios/[id]/page.tsx:396,408`; `buildCompositionRows` `:201-205` |
| Portfolio PDF vintage | `computeFreshness` SoT | `portfolio-pdf/[id]/vintage.ts:36` |
| Profile exchanges "Synced {ago}" | `api_keys.last_sync_at` | `AllocatorSyncStatus.tsx:40,206` |

**Why `computed_at` cannot be the truth — verified at HEAD, not just remembered.** The staleness view's D-03 header (`20260825120000:21-35`) documents with measurements: `last_sync_at` "advanced daily by key-scoped jobs even when zero trades landed. This is the liar that hid the bug"; `computed_at` — "`sync_strategy_analytics_status` writes `computed_at = now()` in ALL arms including the `failed` arm (20260802120000 lines 342/398/421)". Confirmed independently: branch (b) sets `computed_at = now()` at `20260802120000:398`. The ADOPTED verdict: `max((e->>'date')::date)` over `returns_series` — "no writer that can advance it without new data".

**The flat-account vs derive-gap question (the criterion's mandatory investigation).** The two hypotheses and the evidence that separates them:

- *Flat account*: the venue produced no fills/ledger rows after the series end date → the series legitimately ends there. Evidence: the trades store (written via the `sync_trades` RPC — `routers/cron.py:370-373`) has NO rows for the strategy's key after the end date; `compute_jobs` shows syncs completing with zero stored.
- *Derive gap*: data exists after the end date but no compute consumed it. Evidence: trades/ledger rows exist after the end date, OR no compute job ran at all. Two known structural gaps make this hypothesis live: (a) **ledger venues have no recurring refresh** (TODOS 0.1 — measured; 161.1's fix is built but DORMANT until the founder executes the go-live runbook); (b) **a quiet ccxt strategy never recomputes** — `routers/cron.py:471-472`, verbatim:
  ```python
  recompute_strategy_ids = [
      sid for sid, stored in per_strategy_stored.items() if stored > 0
  ]
  ```
  A flat trading day drops the strategy from the recompute list entirely (TODOS 0.2, re-verified at HEAD this session). Note the wrinkle: under (b) the account being flat CAUSES the derive gap — the categories overlap, which is precisely why the criterion refuses to pre-judge.

**Investigation protocol (plan as the phase's first task, read-only against PROD):** for the affected strategy — (1) `api_keys.exchange` for its key (venue determines which structural gap applies); (2) series end = max date in `returns_series` (or via `ledger_refresh_staleness` if ledger-venue; note the view's row restriction is currently venue-filtered — TODOS 0.2 records that dropping `WHERE sv.exchanges && lv.venues` surfaces the ccxt cohort for free); (3) trades rows after that date; (4) `compute_jobs` history since that date. Decision table: data-after-end → derive gap (fix the pipeline / activate the 161.1 mechanism per its runbook); no-data-after-end → flat account (fix is a UI/copy decision — see Open Decisions).

**Fix-direction constraint:** whatever badge change ships, key it on series recency (the D-03-verdict signal), never on `computed_at` alone, and never "fix" it by advancing timestamps. The `example strategies` half of the criterion is HONEST-03 (below).

### HONEST-03 — example-row "Synced Nd ago" on discovery: largely superseded by STALE-01

**Premise NO LONGER REPRODUCES for failed rows — with evidence.** Both discovery surfaces (`src/app/browse/[slug]/page.tsx:63`, `src/app/(dashboard)/discovery/[slug]/page.tsx:81`) render `StrategyTable`, where since v0.72.1.0 the badge is gated: `{hasComputedAnalytics && (<SyncBadge …/>)}` (`StrategyTable.tsx:1158`), with `hasComputedAnalytics = isComputedAnalytics(chipStatus)` (`:969`), and `shapeRowAnalytics` additionally blanks `computed_at` server-side for non-terminal-success rows (commit `dc7b17d3c`'s message; the shaper is `queries.ts:440`, applied on the browse read at `:348`). Per the 159 census (TODOS 0d) all 15 published example strategies sit at `computation_status = 'failed'` since 2026-05-27 → at HEAD they render **no** Synced badge on discovery.

**What remains for this requirement:**
1. **The 159-SEED-01 data repair is an OPEN, explicitly-deferred decision** (TODOS 0d, verbatim options): "(a) recompute analytics for the 15 example strategies …; (b) unpublish them …; (c) accept a badge-free discovery surface". This phase is the natural place to force the choice — option (a) would resurrect Synced badges on example rows (honest but demo-stale), which is exactly the surface this requirement polices.
2. **Optional class guard:** suppress the sync badge whenever `s.is_example` regardless of status (the snapshot finding's own suggested remedy: "Consider suppressing the sync badge on example rows"). `is_example` is already on the row (`StrategyTable.tsx:555` filters on it; `StrategyGrid.tsx:84` renders an Example chip). Cheap, and makes the requirement immune to whatever remedy (a)-(c) picks.
3. **Verify, don't assume:** the plan's first acceptance step for this requirement should be an observation of the live discovery page (or the seam test) — the premise verification here is code-level + census-level, not a fresh PROD screenshot.

Note: `StrategyGrid` renders `SyncBadge` ungated (`StrategyGrid.tsx:110`) but has **no page consumer at HEAD** (grep over `src/app` returns none) — STALE-01's commit relies on the shaper for it. If the guard in (2) ships, cover both components or the shaper.

### HONEST-04 — `buildEquityCurveSeries`: premise TRUE, transform fully mapped

**The false comment and hard-coded null are still there.** `src/app/(dashboard)/portfolios/[id]/page.tsx:224-227` — verbatim:
```ts
// Returns_series is not selected in the existing query (would balloon
// the response). The chart still renders the portfolio composite line
// by itself; per-strategy lines remain a future enhancement.
equityCurve: null as { date: string; value: number }[] | null,
```
**And the comment is false:** `getPortfolioStrategies` (`src/lib/queries.ts:2092-2102`) selects it — verbatim select:
```ts
*, strategies (id, name, status, strategy_types, supported_exchanges, start_date, aum,
  strategy_analytics (cagr, sharpe, max_drawdown, volatility, cumulative_return, sparkline_returns, computed_at, computation_status, returns_series, daily_returns)
)
```
(the DEF-147-A entry, `ca3f0c5c2:TODOS.md` ~L1991, records the same conclusion and adds: "the data is already on the wire and is being thrown away").

**Shapes (all verified):** `returns_series` holds the **cumprod WEALTH curve** written by the analytics service; `daily_returns` is CSV-ingest-only (`resolve-series.ts:41-48` docblock). The chart wants exactly `{date, value}[]` wealth points: `RETURN_FORMATTER = (v) => \`${((v - 1) * 100).toFixed(1)}%\`` (`PortfolioEquityCurve.tsx:31`) and it skips empty/null curves (`:78`). So for API-ingested strategies the fix is nearly a passthrough (normalize `returns_series` → sorted `{date,value}` points via `normalizeDailyReturns`-style validation); for CSV strategies (where only `daily_returns` exists) derive wealth via cumprod — `resolveDailyReturnSeries` + a cumprod fold (precedent: `scenario-blend-adapter.ts:133`).

**Three constraints the fix MUST honor:**
1. **STALE-01 gating.** `extractAnalytics` does no status gating (`src/lib/utils.ts:171-176`) and `getPortfolioStrategies` rows are NOT run through `shapeRowAnalytics`. A failed constituent's `returns_series` is a dead run's series — wire the curve only for `isRankableAnalyticsRow` rows (same predicate STALE-01 used everywhere), or a fresh instance of the just-closed class ships in this very phase. `computation_status` is already in the select.
2. **Payload size.** DEF-147-A's caution verbatim: "Confirm the response-size concern the comment cites is still acceptable before wiring it — the reason may be stale but the cost is real." The series is already fetched server-side; the new cost is the RSC-boundary crossing into `equitySeries`. Reduce server-side to the curve points only (repo convention: other paths strip `returns_series`/`daily_returns` before the client — `queries.ts:2246-2276` `_rs`/`_dr` destructure idiom).
3. **The "drawer-added strategies render CAGR/Sharpe" clause of success criterion 3 is HONEST-05, a different surface (ScenarioComposer)** — do not conflate it with this portfolio-page fix.

### HONEST-05 — drawer-added CAGR/Sharpe: premise TRUE, recorded fix shape verified still-applicable

**Premise TRUE at HEAD.** `addedStrategyMetadataLookup` (`ScenarioComposer.tsx:2491-2553`) sources the metric pair from ONE place — verbatim (`:2528-2530`):
```ts
cagr: found?.strategy.strategy_analytics?.cagr ?? null,
sharpe: found?.strategy.strategy_analytics?.sharpe ?? null,
```
`found` comes from `strategyById`, built from the BOOK-ONLY payload. Unlike `asset_class` and provenance — which have lazily-fetched fallbacks `addedAssetClassById` (`:1131`) and `addedProvenanceById` (`:1143`) — the metrics have none. And the lazy-fetch route serves no scalars — verbatim select (`src/app/api/strategies/[id]/returns/route.ts:257-259`):
```ts
.select(
  "daily_returns, returns_series, computation_status, data_quality_flags",
)
```
A drawer-added (non-book) leg therefore always renders the metrics-absent panel — the WR-02 entry's exact analysis (`ca3f0c5c2:TODOS.md` ~L2209), whose fix shape remains correct at HEAD: "widen `/api/strategies/[id]/returns` to co-serve `cagr, sharpe` from `strategy_analytics` — same row, same RLS, no new round-trip — and add an `addedMetricsById` lazy fallback mirroring `addedProvenanceById`."

**Mandatory STALE-01 interaction:** this route was one of the nine surfaces STALE-01 part 2 closed — it now **withholds** the series for failed rows (routes into `deriveEmptySeriesState`; commit `dc7b17d3c` message). Co-served `cagr`/`sharpe` MUST be withheld under the same predicate (`isRankableAnalyticsRow`), or the widened route re-leaks dead KPIs through a fresh door. There are existing stale-analytics spec files on this route to extend (`returns/route.test.ts` R4/R4b/R10 fixtures per the commit message).

**Adjacent, recorded, NOT in scope:** 159-BASIS-FLIP (TODOS 0e) — the blend basis flip while a drawer-added leg's probe is in flight; a product call logged separately. Don't fold it in; do avoid worsening it (the `addedMetricsById` settle will add one more async settle to the same family — follow the `addedProvenanceById` purge-on-remove discipline documented at `:1136-1148`).

### HONEST-06 — "Finish setup →" preselect: premise TRUE, and deeper than the recorded fix shape

**Premise TRUE at HEAD, three layers:**
- The callback carries no key: `onFinishSetup?: () => void;` (`StrategyTable.tsx:303`), invoked bare from the placeholder row (`:1379-1383`) even though the row HAS the key id (`placeholderRows` maps `{ id: k.id, exchangeLabel, keyLabel }`, `my-strategies/page.tsx:94-98`).
- The overlay has no seam: `ContributionWizardOverlayProps` is `{ isOpen, onClose, onSuccess? }` (`ContributionWizardOverlay.tsx:49-53`); both mounts (`MyStrategiesSection.tsx:129-136`, `MyStrategiesEmptyState.tsx:47`) open it fresh. The comment at `MyStrategiesSection.tsx:124-127` records the founder's 2026-08-05 ruling and points at the (now-promoted) TODOS follow-up.
- `WizardClient` holds `apiKeyId` state seeded only from a resumed draft: `useState<string | null>(initialDraft?.api_key_id ?? null)` (`WizardClient.tsx:246-248`).

**Why DEF-149-A's "one optional prop" underestimates the work (this is the load-bearing research finding):**
1. **There is no key-selection step to preselect into.** `ConnectKeyStep` is credential ENTRY: its props are `{wizardSessionId, onSuccess, footerSlot?, onDraftChange?}` (`ConnectKeyStep.tsx:431-449`) and its state is exchange/nickname/apiKey/apiSecret (`:452-457`). No saved-key picker exists on the single-key branch.
2. **Re-entering credentials for an orphaned key is an UNWINNABLE loop, measured in Phase 161.** `wizardErrors.ts:1780-1817` (the KEY_ORPHANED docblock) records: "`my-strategies` DOES surface the orphan, as a 'No strategy yet' row — but its only control is 'Finish setup →', which reopens this same wizard and lands on this same refusal" (the `api_keys.venue_account_id` partial-unique refusal). So for the orphaned-key population, prefilling a form is NOT a fix — the wizard must **reuse the existing `api_keys` row** and never re-INSERT.
3. **Server support exists for half the population.** `create-with-key`'s `resolveByVenueIdentity` already returns `{ kind: "draft"; strategy_id; api_key_id }` for a key with a live draft (`route.ts:189-192`) — the draft-resume path threads `api_key_id` into the wizard today. The `orphaned` arm deliberately carries nothing (`:184-186`, T-154-06-C: key id not surfaced) — but that rule was minted for the anonymous-ish wizard context; on `/my-strategies` the owner is authenticated and the key id is already in their page payload, so threading it from the CLIENT is a different (and defensible) trust posture. The missing piece is a server path that mints a draft strategy over an EXISTING owned key id (today `create_wizard_strategy` INSERTs the key — service-role-only writer per `route.ts:117-125` comments).

**Populations to handle:** (a) key with live draft → preselect = resume that draft with the key (plumbing exists); (b) orphaned active key, no draft → needs the new "use existing key" server path; (c) mid-sync keys → the pending chip already covers them (`StrategyTable.pending-chip.test.tsx:665-681` pins when Finish setup shows at all).

---

## Architecture Patterns

### Data flow (per requirement)

```
HONEST-01 (write path):
  handler exception → classify_exception (job_worker.py:678)
    → ("unknown", str(exc)[:500])  [:828/:831 — THE UNMAPPED ARM]
    → mark_compute_job_failed → compute_jobs.last_error
    → sync_strategy_analytics_status branch (b)  [SQL: latest def = 20260825150000]
    → strategy_analytics.computation_error  [VERBATIM COPY]
    → SyncPreviewStep "Details: {computation_error}" (user)
  parallel: routers/portfolio.py:1191 → portfolio_analytics.computation_error
    → portfolios/[id] StaleWarning "Error: {error}" (user)

HONEST-02 (read path today):        computed_at ──→ FreshnessChip/Badge/SyncBadge
HONEST-02 (truth signal):           max(date) in returns_series ──→ ledger_refresh_staleness (view)

HONEST-04:
  getPortfolioStrategies (returns_series selected, queries.ts:2098)
    → [NEW: status-gate + normalize/cumprod → {date,value}[] wealth points]
    → buildEquityCurveSeries → PortfolioEquityCurve (RETURN mode = (v−1)·100%)

HONEST-05:
  drawer add → /api/strategies/[id]/returns [WIDEN: + cagr, sharpe, gated like the series]
    → addedMetricsById (NEW, mirrors addedProvenanceById settle/purge)
    → addedStrategyMetadataLookup ?? fallbacks → SCEN-03 row panel

HONEST-06:
  placeholder row (has key id) → onFinishSetup(keyId) [WIDEN]
    → ContributionWizardOverlay preselect prop [NEW]
    → WizardClient apiKeyId seam (exists, :246)
    → draft-resume (exists) | use-existing-key server path (NEW for orphans)
```

### Patterns to reuse (do not invent parallels)

- **Curated-copy-at-writer:** the reaper's fixed literal (`20260802120000:508`), the CSV runner's constants (`analytics_runner.py:2079`), the `curated_gateway_detail` allow-list pattern (`job_worker.py:723-736` comment — "Ships a message read through an ALLOW-LIST …, never a bare str(exc)"). HONEST-01's unknown-arm fix is the same move: fixed user copy in the column, raw text to logs/Sentry only.
- **Status gating:** `isRankableAnalyticsRow` / `shapeRowAnalytics` — "the row denied a rank, the row denied its list cells and the row denied its DETAIL cells are the same row, decided once" (STALE-01 commit message). Extend, never fork.
- **Lazy per-leg fallback in the composer:** `addedProvenanceById` (settle writer + purge in `handleRemoveAdded`, `ScenarioComposer.tsx:1136-1148`) is the template for `addedMetricsById`.
- **Keyed remount for wizard state:** the overlay's `key={`${source}:${draftId}`}` idiom (`ContributionWizardOverlay.tsx:244-245`) — a preselect key id belongs in that key so toggling keys remounts cleanly.
- **Read-only PROD census before deciding:** phase-159 C-M1 (`159-CENSUS.md`) is the template for both diagnostic tasks.

### Anti-patterns to avoid
- **Advancing a timestamp to fix a badge** — the entire D-03 section exists because timestamps that move without data are the disease.
- **A second freshness ladder** — `computeFreshness` (12h/48h) and `FreshnessChip` (3d/7d) already disagree; do not add a third ad-hoc threshold set. If series-recency becomes a badge input, thread it through ONE of the existing SoTs (and note the existing chip/SoT split as a known inconsistency for the UI-SPEC).
- **Mapping error copy at the READER** — the requirement locks the writer; `wizardErrors.ts` render-side mapping of `computation_error` content would leave the column itself dirty (factsheets, exports, admin all read it).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Series-recency verdict | A new max-date query | `ledger_refresh_staleness` (or its parser fn) | 492 lines of measured design; venue-filter widening is a recorded one-line direction (TODOS 0.2) |
| Wealth-curve ↔ daily-returns conversion | Inline math | `resolveDailyReturnSeries`, `equityCurveToDailyReturns` (`resolve-series.ts`) | Handles column drift, sorting, non-finite filtering; phase-147 grep-gates watch the select widths |
| Failed-row suppression | Per-surface if-statements | `shapeRowAnalytics` + `isRankableAnalyticsRow` | STALE-01 made this the single decided predicate across 11 surfaces |
| Secret scrubbing | New regexes | `scrub_freeform_string` | Already the T-74-03 fence; but remember it is NOT user-copy mapping |
| Empty-series state | New status ladder | `deriveEmptySeriesState` | Phase-147 SC2 explicitly forbids a second table |

## Common Pitfalls

1. **Re-opening STALE-01 through a widened route.** Co-serving `cagr`/`sharpe` on `/returns` (HONEST-05) or wiring `returns_series` curves (HONEST-04) without the terminal-success gate ships dead numbers through brand-new doors, days after an 11-surface hotfix closed the class. The gate pair is `'complete','complete_with_warnings'` (`STRATEGY_ANALYTICS_TERMINAL_SUCCESS_STATUSES` per `20260825150000` conjunct (ii)).
2. **Editing the WRONG definition of `sync_strategy_analytics_status`.** Five historical definitions exist; the latest is `20260825150000` (161.1 branch). Grep ALL migrations and re-base on the latest before any `CREATE OR REPLACE` (project rule ⭐), and remember merges auto-apply to PROD.
3. **Treating `scrubbed` as "user-safe".** `scrub_freeform_string` removes secrets, not internals. `"'<' not supported…"` passes scrubbing untouched. HONEST-01 is a mapping problem, not a scrubbing problem.
4. **Fixing HONEST-02 before the investigation.** The criterion hard-orders it: flat-account and derive-gap need different fixes (copy vs pipeline), and the ccxt `stored > 0` filter means a flat account CAUSES a derive gap — the census must disentangle them for the specific strategy before any code is written.
5. **HONEST-06 as a form prefill.** Preselecting means REUSING the existing `api_keys` row. A prefilled credential form still re-POSTs, still hits the `venue_account_id` unique, still lands on KEY_ORPHANED — the measured unwinnable loop (`wizardErrors.ts:1802-1808`).
6. **The curated-message test fence (Phase 161).** New user-facing error copy lives inside the WIZERR fences (seam vocabulary law, curated-message tests). A new `computation_error` literal on the Python side may also interact with the JOB-01 AST census (`tests/test_computing_started_at_stamp.py`) — payloads must stay dict literals at the call site (`analytics_runner.py:1340-1350` documents the measured failure of "cleaning this up").
7. **Anti-vacuity gate mechanics.** Several files touched here sit inside indentation-bounded or literal-matching gate regions (`job_worker.py:2855-2874` comments). Prose must never satisfy or trip a mechanical gate; count gate tokens PRE-edit.
8. **`grep` blind spots.** `src/lib/wizardErrors.test.ts` contains a deliberate NUL byte at line 1572 — plain grep silently skips it (exit 1 reads as "clean"). Use `grep -a`/node when sweeping wizard error surfaces.
9. **Node version skew.** CI is Node 22, local is Node 25 — CI-only vitest failures are reproducible via `PATH=/opt/homebrew/opt/node@22/bin`. Run full-suite on Node 22 parity before ship (STALE-01's commit did exactly this).
10. **File-scoped test runs cannot clear contract tests** — `src/__tests__/contracts/` scans all of `src/`; full-suite is the only clean signal.
11. **`.planning/` is public.** The diagnostic tasks touch a founder-owned strategy and PROD rows — plans must reference them by snapshot citation, never by email/full-UUID.

## Open Decisions (no CONTEXT.md exists — these are the founder's, list-not-assume)

| # | Decision | Options (researched) |
|---|----------|----------------------|
| OD-1 | 159-SEED-01 example-strategy repair (couples to HONEST-03) | (a) recompute the 15 example rows to terminal success — badges + percentiles return, Synced dates become recent; (b) unpublish them — discovery thins to real strategies; (c) accept badge-free discovery until real strategies clear the `< 5` floor. TODOS 0d demands "a decided state, not a surprise" |
| OD-2 | What a flat account's factsheet should claim (HONEST-02, if investigation says "flat") | The snapshot finding's own words: "the factsheet arguably should say so". Options: series-recency line beside the chip ("Track record through {date}"); demote FRESH when series-end exceeds a bound; leave chip but add copy. UI-SPEC territory (DESIGN.md governs) |
| OD-3 | HONEST-06 orphaned-key scope | Minimal: preselect only for keys with a live draft (plumbing exists), orphans keep KEY_ORPHANED contact-support copy; Full: new use-existing-key server path (closes the 161-recorded "manager cannot release their own orphaned key" gap for the create direction). The full option touches the service-role writer boundary (ADR-0001/0003 territory) |
| OD-4 | Whether the `job_worker` prefixed-`scrubbed` suffixes count as "raw exception strings" under HONEST-01 | Strict reading: yes, map them too (fixed copy per typed arm; raw to logs). Lenient: only the UNPREFIXED bare-`str(exc)` writers (classify_exception unknown arm, portfolio `_fail`) violate. Affects ~15 call sites vs 3 |

## Code Examples

### The unknown-arm mapping (HONEST-01, the shape — writer-side)
```python
# analytics-service/services/job_worker.py — classify_exception bottom arm today:
return ("unknown", str(exc)[:500])          # :828 and :831 — VERBATIM at HEAD
# Fix shape (pattern: the InvalidToken arm :698-703 and curated_gateway_detail):
#   log/Sentry the raw string; return a fixed user-recoverable message for the
#   unknown arm, e.g. the 142-reaper voice (20260802120000:508):
#   'Analytics was interrupted before it could finish and did not recover. Retry the sync.'
# NOTE: error_kind handling must not change — 'unknown' drives retry classification.
```

### Status-gated curve building (HONEST-04, the shape)
```ts
// portfolios/[id]/page.tsx — inside buildEquityCurveSeries, per strategy:
const a = extractAnalytics(ps.strategies.strategy_analytics);
// STALE-01 predicate — same call the shaper/cohort use (closed-sets.ts:789)
const curve = isRankableAnalyticsRow(a)
  ? normalizeWealthPoints(a.returns_series)         // API strategies: already cumprod wealth
    ?? cumprodToWealth(resolveDailyReturnSeries(a.daily_returns, a.returns_series)) // CSV
  : null;                                            // failed/absent → chart skips (":78")
```

### Lazy metrics fallback (HONEST-05, mirror of addedProvenanceById)
```ts
// ScenarioComposer.tsx — beside addedProvenanceById (:1143):
const [addedMetricsById, setAddedMetricsById] = useState<Record<string, { cagr: number|null; sharpe: number|null }>>({});
// settle from the widened /returns payload; purge in handleRemoveAdded; then in the lookup:
cagr: found?.strategy.strategy_analytics?.cagr ?? addedMetricsById[a.id]?.cagr ?? null,
```

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | vitest/tsc | ✓ | 25.8.1 local (CI = 22 — parity runs needed) | `PATH=/opt/homebrew/opt/node@22/bin` |
| Python 3 + pandera | analytics-service tests | ✓ (per repo memory: `pandera==0.32.1` installed) | — | run pytest from `analytics-service/` only |
| PROD read access (census) | HONEST-01/02 diagnostics | ✓ (established pattern: phase-159 read-only census) | — | — |
| Local analytics-service | — | ⛔ MUST NOT RUN | — | read code only (claims real PROD jobs) |

No missing blocking dependencies.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (v8 coverage; thresholds 82/80/74/72) + pytest (`analytics-service/`, `--cov-fail-under=80`) + SQL tests (`supabase/tests/test_*.sql`) |
| Config file | `vitest.config.ts`; `analytics-service/` pytest config |
| Quick run command | `npx vitest run <file>` (⚠️ worktree agents: symlink `node_modules` first — GSD worktrees provision no deps) |
| Full suite command | `npx vitest run` on Node 22 parity; `python3 -m pytest` from `analytics-service/` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HONEST-01 | unknown-arm returns curated copy; raw text absent from column writes | unit (py) | `python3 -m pytest tests/ -k classify -x` (from `analytics-service/`) | ❌ Wave 0 (new cases beside existing classify/stamp suites) |
| HONEST-01 | bridge branch-(b) copy semantics (if changed) | SQL | `supabase/tests/test_*.sql` via db-test CI wiring | ❌ Wave 0 |
| HONEST-01 | portfolio `_fail` catch-all curated | unit (py) | pytest portfolio router tests | ❌ Wave 0 |
| HONEST-02 | badge honors series recency per chosen fix | unit (tsx) | `npx vitest run src/app/factsheet/[id]/v2/` | partially (FactsheetView specs exist) |
| HONEST-03 | example rows never advertise Synced (per OD-1 outcome) | unit (tsx) | `npx vitest run src/components/strategy/StrategyTable.stale-analytics.test.tsx` | ✅ extend (STALE-01 specs) |
| HONEST-04 | failed constituent → null curve; success → real wealth points; comment gone | unit (tsx) | `npx vitest run "src/app/(dashboard)/portfolios"` | ❌ Wave 0 |
| HONEST-05 | widened route withholds scalars on failed rows; drawer leg renders metrics | unit (ts+tsx) | `npx vitest run "src/app/api/strategies/[id]/returns" src/app/(dashboard)/allocations` | ✅ extend (R4/R4b/R10 fixtures) |
| HONEST-06 | preselect mounts wizard with key chosen; orphan path never re-INSERTs | unit (tsx) | `npx vitest run src/components/strategy/StrategyTable.pending-chip.test.tsx` + new overlay spec | ✅ extend + ❌ new |

### Sampling Rate
- **Per task commit:** targeted file run + `npx tsc --noEmit`; ⚠️ mypy --strict before shipping analytics-service changes (memory rule).
- **Per wave merge:** full vitest suite (Node 22 parity) — contract tests scan `src/` globally, so only full-suite is a clean signal.
- **Phase gate:** full suite + pytest green before `/gsd-verify-work`; every new regression test witnessed RED against its neutered fix (founder rule).

### Wave 0 Gaps
- [ ] pytest cases for the classify_exception unknown-arm mapping (must fail if `str(exc)` returns to the message slot)
- [ ] SQL test for `sync_strategy_analytics_status` copy semantics if the bridge changes (re-based on `20260825150000`)
- [ ] Portfolio-page equity-series spec (fixtures: one success row with `returns_series`, one failed row with best-in-class stale values — the STALE-01 fixture discipline)
- [ ] Overlay/WizardClient preselect spec proving the step mounts with the key chosen (DEF-149-A's own acceptance)

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes (route widening) | existing route validation idioms; no new user input surfaces |
| V8 Data Protection / error handling | **yes — core of HONEST-01** | raw exception text is an information-disclosure surface (internal types, schema hints); fixed copy in user columns, raw to logs/Sentry only. Precedent: T-74-03, T-134-01 (upstream text = credential-disclosure surface), the InvalidToken fixed-message arm |
| V4 Access Control | yes (HONEST-06 full option) | `create_wizard_strategy` is service-role-only (migrations A/B, `20260813150106`/`20260814120000`); a use-existing-key path must preserve that boundary and the `.eq("user_id")` tenant scoping the resolver documents as load-bearing |

### Known Threat Patterns for this phase
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Exception text → user surface | Information Disclosure | curated copy at writer; scrub remains defense-in-depth |
| Key-id threading (HONEST-06) | Elevation/IDOR | server re-verifies key ownership (`user_id` filter) — never trust the client-supplied key id beyond selection intent |
| Dead-metrics resurrection | Tampering (integrity of displayed data) | `isRankableAnalyticsRow` gate on every new read path |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The PROD `computation_error` TypeError row was written via the classify_exception→bridge chain (vs a since-deleted writer) | HONEST-01 | Low — the chain is live at HEAD regardless; the diagnostic task confirms provenance [ASSUMED] |
| A2 | "Phoenix Protocol" (HONEST-02 subject) is a real API-verified strategy, not one of the 15 seeded examples | HONEST-02 | If it IS an example row, HONEST-02 partially collapses into OD-1; the census step resolves this first [ASSUMED] |
| A3 | All 15 example rows are still `failed` at plan time (census dated 2026-08-21; STALE-01 re-measured 17/18 on 2026-08-25) | HONEST-03 | If any were recomputed, Synced badges may already render — the observation step catches it [ASSUMED, census-cited] |
| A4 | The 161.1 branch merges before/with this phase (citations to `20260825150000` and the staleness view assume its tree) | throughout | If 161.1 re-lands differently, re-verify the bridge's latest definition [ASSUMED] |
| A5 | `trades` persistence via `sync_trades` RPC is the correct place to look for post-series-end venue activity on ccxt venues; ledger venues need their own ledger-crawl evidence | HONEST-02 | Wrong table → wrong verdict; the diagnostic task should confirm table names against the RPC definition [ASSUMED] |

## Open Questions

> **DISPOSITIONED 2026-08-25 (plan-checker warning 2).** All three are answered or
> deliberately routed to a measuring task; none is an open blocker at execute time.
> **Q1** -> 162-01 census. It CANNOT be resolved pre-execution by design: success
> criterion 2 mandates investigating before a fix is chosen.
> **Q2** -> answered by UI-SPEC C-2, which removes the envelope's "Details:" appendix.
> **Q3** -> answered by founder decision D-162-4 (strict reading).
> Left in place as the record of what was genuinely open at research time.


1. **Which venue backs the HONEST-02 subject strategy?** Determines whether the derive-gap hypothesis routes to the ledger mechanism (dormant 161.1 fan-out + runbook) or the ccxt `stored > 0` filter (TODOS 0.2, unfixed by design there). Resolved by census query #1.
2. **Does the wizard envelope's "Details: {computation_error}" survive HONEST-01?** Once the column holds curated copy, the Details line becomes redundant with the cause sentence — a UI-SPEC call, not a research one.
3. **Scope of OD-4 (prefixed-scrubbed suffixes)** — 3 writers vs ~15 call sites; blast radius vs strictness. Founder call.

## Sources

### Primary (HIGH confidence — read this session at HEAD `5dbafc120`)
- `src/app/(dashboard)/portfolios/[id]/page.tsx`, `src/lib/queries.ts`, `src/lib/freshness.ts`, `src/lib/utils.ts`, `src/lib/factsheet/resolve-series.ts`, `src/lib/closed-sets.ts`
- `src/components/strategy/{SyncBadge,StrategyTable,StrategyGrid,FreshnessBadge}.tsx`, `src/app/factsheet/[id]/v2/FactsheetView.tsx`
- `src/app/(dashboard)/allocations/components/{ScenarioComposer,ContributionWizardOverlay}.tsx`, `src/app/(dashboard)/strategies/new/wizard/{WizardClient,steps/ConnectKeyStep,steps/SyncPreviewStep}.tsx`, `src/app/(dashboard)/my-strategies/{page,MyStrategiesSection}.tsx`
- `src/app/api/strategies/{[id]/returns,create-with-key,finalize-wizard}/route.ts`, `src/app/api/keys/sync/route.ts`, `src/lib/wizardErrors.ts`
- `analytics-service/services/{job_worker,analytics_runner}.py`, `analytics-service/routers/{portfolio,cron}.py`
- `supabase/migrations/20260802120000_*.sql`, `20260825120000..150000_*.sql`
- Git: `dc7b17d3c` (STALE-01, full message), `ca3f0c5c2:TODOS.md` (pre-scope snapshot — the six requirements' original entries), `.planning/REQUIREMENTS.md`, `.planning/STATE.md`, `TODOS.md` items 0d/0e/0.1/0.2
- Phase artifacts: `161-*/deferred-items.md`, `161.1` migration headers

### Secondary / Tertiary
- None needed — no external libraries or ecosystem questions in this phase; the research-plan seam was deliberately not invoked (repo-internal domain, all fix shapes recovered from in-repo records).

## Metadata

**Confidence breakdown:**
- Premise verification (all six): HIGH — every claim cited to file:line read this session, with verbatim quotes for discrete values
- HONEST-01 root cause (the specific str/None site): LOW by design — requires PROD job history/Sentry; protocol provided
- HONEST-02 flat-vs-gap verdict: deliberately UNDECIDED — the criterion mandates investigation; evidence map provided
- Fix shapes: HIGH for 04/05 (recorded + re-verified), MEDIUM for 06 (server-path half needs a design decision, OD-3)

**Research date:** 2026-08-25
**Valid until:** ~2026-09-08 (repo moves fast; re-verify the 161.1 merge state and the example-row census at plan time)
