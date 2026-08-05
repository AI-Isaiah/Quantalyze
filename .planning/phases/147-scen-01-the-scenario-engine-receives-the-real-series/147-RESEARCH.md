# Phase 147: SCEN-01 — The scenario engine receives the real series - Research

**Researched:** 2026-08-04
**Domain:** In-repo data-plumbing defect (Next.js 16 App Router + Supabase/PostgREST reads → frozen scenario engine). Zero new dependencies.
**Confidence:** HIGH (every finding below is a direct codebase read at a pinned line number; nothing rests on training data)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Fix scope (Area 1)**
- Fix ALL THREE bare readers of `strategy_analytics.daily_returns`, not just the composer:
  1. `src/app/api/strategies/[id]/returns/route.ts:221` (the SCEN-01 bug proper)
  2. `src/app/scenario-share/[token]/share-resolve.ts:184` (share recipients see the same zeros)
  3. `src/app/api/og/factsheet/[id]/route.tsx:63` (OG image sparkline)
  Class closure per the standing fix-campaign rule (close the whole class across the surface).
- Differencing stays INSIDE `resolveDailyReturnSeries` (it already differences wealth curves
  via `equityCurveToDailyReturns`). Call sites only widen their select to
  `daily_returns, returns_series` and call the resolver. No new fetch abstraction.

**Structural assertion (Area 2)**
- SC2 ("no third mechanism") is enforced by a grep-gate vitest: repo-wide scan that fails
  if any `strategy_analytics` select fetches `daily_returns` without also fetching
  `returns_series` and resolving through `resolveDailyReturnSeries`.
- SC3 differencing regression is a ROUTE-LEVEL test on the composed path: feed an analytics
  row whose `returns_series` starts at exactly 1.0 and assert day one is NOT +100%. This
  tests the wiring (fails if the route stops invoking the resolver), not just the helper —
  per the economic-invariant-oracle testing rule.

**Honest empty state (Area 3)**
- A strategy with genuinely no stored series remains ADDABLE to a scenario; its composer
  row shows an explicit no-data state and is excluded from the blend with a visible note
  (matches the existing warm-up gate; fresh keys legitimately sync ~10–15 min).
- Two distinct states derived from `strategy_analytics` status:
  - computing/in-flight → "Syncing — first metrics arrive in ~10–15 min"
  - terminal with no series → "No return series available"
  Never 0.00 metrics with no signal; never a fabricated series.

### Claude's Discretion
- Exact copy wording (within the two-state structure above), test file placement,
  and whether the OG route reuses the resolver directly or via its existing normalize path —
  provided the grep-gate passes and no third mechanism is minted.

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope.

### Out of scope per `<domain>`
Any writer/backfill (⛔ fights migration 087 / decision D-02); composer legibility (Phase 152);
AUM (Phase 151).
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCEN-01 | A strategy added to a scenario contributes its **actual return series**; today ~4 in 10 (in truth: *every* service-computed strategy) contribute `[]` and fail silently. The READER is wrong, not the writer. | §Architecture Patterns (reader census — **4 sites, not 3**), §Code Examples (resolver call shape at each site), §Common Pitfalls P1–P8, §Validation Architecture (per-SC test map) |

</phase_requirements>

---

## Summary

This is a pure reader-plumbing phase with **zero new dependencies** and **zero DDL**. The
correct series already exists in `strategy_analytics.returns_series` (a wealth index), the
correct resolver already exists and is already tested
(`resolveDailyReturnSeries`, `allocator-portfolio-payload.ts:51`), and two production
surfaces already use it correctly (`factsheet/[id]/v2/page.tsx:71`,
`discovery/[slug]/[strategyId]/page.tsx:65`). The work is widening four reads and threading
one additive discriminator.

Three findings materially change the plan versus CONTEXT.md's assumptions, and the planner
must handle all three:

1. **There is a FOURTH bare reader, and it is the one that feeds the book path.**
   `getMyAllocationDashboard` (`src/lib/queries.ts:3405`) selects
   `strategy_analytics ( daily_returns, cagr, sharpe, volatility, max_drawdown, data_quality_flags )`
   — no `returns_series`, no `computation_status`. That projection *is*
   `payload.strategies[].strategy.strategy_analytics`, which
   `addedStrategyReturnsLookup` (`ScenarioComposer.tsx:2069`) consults FIRST, and the lazy
   fetch is deliberately skipped for any id already in the book
   (`ScenarioComposer.tsx:2096`). So an allocator whose strategy is in their own portfolio
   gets `[]` with **no** lazy-fetch rescue. The SC2 grep-gate would fail on this file
   anyway, so it is structurally forced into scope. This is an *addition consistent with*
   the locked "close the whole class" intent, not a contradiction of it.

2. **Site 2 (`share-resolve.ts:184`) cannot be fixed by widening a select — its series comes
   from a SECURITY DEFINER RPC, and a migration that widens that RPC is blocked by a live CI
   gate.** `src/__tests__/phase-29-frozen-spine-guards.test.ts:141` fails the build on ANY
   migration in the branch delta matching `/scenario|share/i`. The correct pattern is the
   caller-side sibling read Phase 84 already established for `asset_class`
   (`scenario-share/[token]/page.tsx:163-197`).

3. **The UI-SPEC's flagged missing-row risk is REAL: strategy creation does NOT guarantee a
   `strategy_analytics` row exists.** No trigger creates one on `strategies` INSERT; the row
   is first written by `sync_strategy_analytics_status` on a compute-job hop, and the
   finalize-wizard enqueue is explicitly non-blocking. Mapping missing-row → `computing`
   unconditionally re-creates the permanent-spinner class Phase 142 existed to kill. The fix
   is cheap and is spelled out in §Common Pitfalls P5.

**Primary recommendation:** Extract `resolveDailyReturnSeries` + `equityCurveToDailyReturns`
into a leaf module, resolve **server-side at all four read sites** so the wire shape stays
byte-identical (`returns_series` never crosses to a client), thread an additive
`series_state` on the returns route and on the book payload, and bound the missing-row →
`computing` mapping by strategy age using the existing 16-hour reap threshold.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Resolve wealth-index → daily returns | Pure lib (`src/lib/factsheet/…`) | — | Already lives there, already tested, already the one mechanism. No I/O, no framework coupling. |
| Fetch the analytics columns | API / Backend (route handlers + `queries.ts` SSR) | — | Every one of the four sites is a server read. Widening happens where the Supabase query is built, never on the client. |
| Decide `series_state` (available / computing / empty) | API / Backend | — | ⛔ UI-SPEC §3 is explicit: `daily_returns.length === 0` cannot distinguish computing from empty. The discriminator must be derived where `computation_status` is readable. |
| Render chip + note | Browser / Client (`CoverageStateChip`, `ScenarioComposer`) | — | Presentation-only; receives `state` as a prop, never re-derives it (`CoverageStateChip.tsx` docstring, Pitfall 1 divisor-desync). |
| Blend / overlap arithmetic | Pure lib (`src/lib/scenario.ts`, frozen engine) | — | **Untouched.** The engine consumes `DailyPoint[]`; this phase only changes what array it receives. |
| Public share projection | Frontend Server (SSR `page.tsx`) → pure resolve layer | — | `share-resolve.ts` is documented PURE (no network, no Next import). The sibling read belongs in `page.tsx`; the resolve layer takes it as a param. |
| OG image | API / Backend (`next/og` route) | CDN | The route is `force-dynamic` but stamps `s-maxage=86400` — CDN owns staleness, not the route. |

---

## Standard Stack

### Core

**No new libraries. This phase adds zero dependencies.** Everything below already exists in
the repo at the pinned location.

| Module | Location | Purpose | Why it is the standard |
|--------|----------|---------|------------------------|
| `resolveDailyReturnSeries(dailyRaw, returnsSeriesRaw)` | `src/lib/factsheet/allocator-portfolio-payload.ts:51` | Try `daily_returns`; if empty, difference the wealth index | [VERIFIED: codebase] Already backs `factsheet/[id]/v2/page.tsx:71` and `discovery/[slug]/[strategyId]/page.tsx:65`; its docstring names this exact bug; tested at `allocator-portfolio-payload.test.ts:147-211`. ROADMAP Rule-7 pin. |
| `equityCurveToDailyReturns(points)` | `src/lib/factsheet/allocator-portfolio-payload.ts:15` | `curr/prev − 1` over a date-sorted, positive-value-filtered wealth curve | [VERIFIED: codebase] The differencing itself. Filters `value > 0` and `Number.isFinite`, sorts by date. |
| `normalizeDailyReturns(raw)` | `src/lib/portfolio-math-utils.ts` | Canonical JSONB parser: array / flat-dict / nested year-keyed record → sorted `DailyPoint[]` | [VERIFIED: codebase] WR-05 guard; already used by both the returns route (`route.ts:252`) and the book path (`ScenarioComposer.tsx:594`) so the two boundaries cannot drift. |
| `withPublishedOrOwner` / `withPublishedOnly` | `src/lib/visibility.ts` | Visibility predicate; keeps the `quantalyze/no-raw-published-predicate` ESLint tripwire active | [VERIFIED: codebase] `eslint.config.mjs:46` — `error` repo-wide. Any raw `.eq("status","published")` on these files is a lint failure. |
| `CoverageStateChip` | `src/app/(dashboard)/allocations/components/CoverageStateChip.tsx` | The one per-row chip vocabulary | [VERIFIED: codebase] UI-SPEC §1 mandates extending the `CoverageState` union in place. |
| `LiveRegion` | `src/components/ui/LiveRegion.tsx` | Polite announcement primitive | [VERIFIED: file exists] UI-SPEC Accessibility Contract prefers it for the syncing note. |

### Type equivalence (removes a would-be adapter)

`resolveDailyReturnSeries` returns `DailyReturn[]` = `{ date: string; value: number }`
(`src/lib/factsheet/types.ts:11`). The routes emit `DailyPoint[]` = `{ date: string; value:
number }` (`src/lib/portfolio-math-utils.ts:11-14`). **Structurally identical** — assign
directly, do NOT write a mapper. [VERIFIED: codebase]

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Server-side resolution at each read site | Forward `returns_series` raw to the client and difference there | ⛔ Rejected. Doubles wire bytes, and a client that forgets to difference claims +100% on day one (the exact SCEN-01 failure re-created client-side). Server-side keeps the wire shape byte-identical. |
| Caller-side sibling read on the share page | `CREATE OR REPLACE FUNCTION get_shared_scenario` to add `returns_series` | ⛔ **Blocked by CI.** `phase-29-frozen-spine-guards.test.ts:150-166` fails on any migration matching `/scenario\|share/i` in the branch delta. Phase 84 hit this exact wall and chose the sibling read (`page.tsx:158`). |
| Extract the resolver into a leaf module | Import `allocator-portfolio-payload.ts` directly at all four sites | ⚠️ Direct import pulls `./build-payload` and its **18 transitive imports** (align, compute, rolling, peer-cohort, stress-windows, …) into the OG route and the public share path. Extraction to a leaf + re-export keeps ONE mechanism with a clean import graph. **Recommended**, but this is Claude's-discretion territory. |
| Backfill `strategy_analytics.daily_returns` | — | ⛔ **Locked out.** Migration 087 (`20260428120919`, D-02) deliberately moved heavy series off this table for the 1MB TOAST ceiling. Explicit ROADMAP trap. |

**Installation:** none. `npm install` is not run in this phase.

---

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.** No `npm install`, no
`pip install`, no registry read is required. The banned-package list in the global CLAUDE.md
is unaffected. If the planner's implementation drifts into adding a dependency, that is a
signal the approach has gone wrong (every capability needed already exists in-repo).

---

## Architecture Patterns

### System Architecture Diagram — where the series does and does not flow today

```
                    analytics-service (Python)
                    metrics.py:775-778
                    cumulative = (1+returns).cumprod()
                              │
                              ▼
                 strategy_analytics.returns_series   ◄── WEALTH INDEX (starts ~1.0)
                 strategy_analytics.daily_returns    ◄── ⛔ NO PRODUCTION WRITER
                              │
        ┌──────────┬──────────┼───────────┬──────────────┬──────────────┐
        │          │          │           │              │              │
        ▼          ▼          ▼           ▼              ▼              ▼
   factsheet   discovery   returns     og/factsheet   queries.ts    get_shared_
   v2 page     detail      route       route          :3405 SSR     scenario RPC
   :45 ✅      :65 ✅      :221 ❌     :35 ❌         ❌ (SITE 4)   (series jsonb) ❌
     BOTH       BOTH      daily only  daily only     daily only    daily only
       │          │          │           │              │              │
       ▼          ▼          ▼           ▼              ▼              ▼
  resolveDaily  resolve   normalize   Array.isArray  normalizeBook  normalizeDaily
  ReturnSeries  Daily…    DailyReturns  → computeOg   Returns        Returns
       │          │          │           │              │              │
     REAL       REAL        [] ⛔       NaN ⛔          null→[] ⛔     [] ⛔
     series     series
                              │           │              │              │
                              ▼           ▼              ▼              ▼
                   ScenarioComposer   blank OG    addedStrategy    scenario-share
                   addedReturnsById   headline    ReturnsLookup    projection
                              │                        │              │
                              └────────┬───────────────┘              │
                                       ▼                              ▼
                          scenario-adapter → computeScenario    ResolvedOk.metrics
                          (FROZEN ENGINE — untouched)           "0 overlapping days"
                                       │
                                       ▼
                          "0 overlapping days" · 0.00 metrics
```

**After the fix**, all six arms converge on `resolveDailyReturnSeries` and the frozen engine
receives the same array the detail pages render.

### The reader census — FOUR sites, not three [VERIFIED: codebase, all line numbers read]

| # | Site | Current select / source | Fix shape | Transport / visibility |
|---|------|-------------------------|-----------|------------------------|
| 1 | `src/app/api/strategies/[id]/returns/route.ts:219-223` | `.select("daily_returns, data_quality_flags")` on `strategy_analytics` | Widen to `daily_returns, returns_series, computation_status, data_quality_flags`; resolve; add `series_state` | `createClient()` (RLS-scoped). `analytics_read` RLS is table-level `published OR user_id = auth.uid()` — no column grants exist, so widening needs **no** RLS work. |
| 2 | `src/app/scenario-share/[token]/share-resolve.ts:184` | `normalizeDailyReturns(s.daily_returns)` where `s` comes from the `get_shared_scenario` RPC `series` jsonb | ⚠️ **Not a select.** Add a caller-side sibling read in `page.tsx`, pass a `returnsSeriesById` map into `resolveSharedScenario` as an optional param (mirroring `assetClassById`), resolve inside the pure layer | `createAdminClient()` (service_role transport). Sibling read MUST be bounded to `row.series` ids AND `status='published'` — the RPC's own rule. |
| 3 | `src/app/api/og/factsheet/[id]/route.tsx:35` | `strategy_analytics ( daily_returns )` embedded on a `withPublishedOnly` strategies read | Widen embed to `( daily_returns, returns_series )`; resolve; drop the `Array.isArray(dailyRaw)` gate (resolver always returns an array) | `createClient()` (typically anon on an unfurl). Same `analytics_read` policy; published-only. |
| 4 | `src/lib/queries.ts:3405` **(NEW — not in CONTEXT.md)** | `strategy_analytics ( daily_returns, cagr, sharpe, volatility, max_drawdown, data_quality_flags )` | Widen to add `returns_series, computation_status`; resolve **inside `queries.ts`** and emit the already-resolved array on `payload.strategies[].strategy.strategy_analytics.daily_returns` | `admin` client, `.eq("portfolio_id", portfolio.id)` ownership-gated. Server-only module. |

**Sites already correct — do NOT touch, they are the SC2 reference implementation:**
- `src/app/factsheet/[id]/v2/page.tsx:45,71` ✅
- `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:65` ✅
- `src/lib/queries.ts:1299` (`getPortfolioStrategies`) — already selects `returns_series, daily_returns, computation_status`; its consumers may still read `daily_returns` bare, worth a plan-time grep.

**Sites that select `strategy_analytics (*)` (both columns present by construction, gate-safe):**
`queries.ts:218`, `queries.ts:516-517`, `src/app/(dashboard)/compare/page.tsx:68`.

**`PUBLIC_ANALYTICS_COLUMNS` (`queries.ts:284`) does NOT include `daily_returns`** — the
type annotation at `queries.ts:414` declaring `daily_returns?: unknown` is dead. Not in
scope; flag to TODOS if the grep-gate trips on it.

### Pattern 1: Server-side resolution, byte-identical wire shape

**What:** Widen the *select*, resolve on the *server*, emit the *same field name* with the
resolved array. `returns_series` never crosses a wire.
**When to use:** Every one of the four sites.
**Why:** Client consumers (`ScenarioComposer.tsx:1338`, the six book-payload widgets)
already destructure `daily_returns` and validate `Array.isArray`. Keeping the field name and
type means **zero downstream change on the happy path** — exactly what CONTEXT.md's
Integration Points section asserts.

### Pattern 2: The Phase-84 sibling-read (the share page's only legal move)

**What:** A second, narrower service-role read bounded to the RPC-returned ids and
`status='published'`, wrapped in try/catch, degrading to an empty lookup.
**When to use:** `scenario-share/[token]/page.tsx` only.
**Precedent:** `page.tsx:163-197` does exactly this for `asset_class`, and its comment block
names the CI gate as the reason.
⚠️ The new read must be a **separate query**, not a widening of the existing
`.select("id, asset_class")` — that literal is pinned by
`src/__tests__/phase-84-asset-class-flow.test.ts:47`.

### Pattern 3: Additive-field tolerance (`series_state`)

**What:** New response fields are accepted only when they match a known literal; anything
else (absent from a stale deploy, null, malformed) collapses to a conservative default.
**Established at:** `ScenarioComposer.tsx:1349-1359` (asset_class → null; trust_tier →
null; is_composite → strict `=== true`).
**Apply as:** `const seriesState = d.series_state === "computing" || d.series_state === "empty" ? d.series_state : "available";`
A stale deploy therefore degrades to "no chip", never to a throw and never to a false
"Syncing".

### Recommended module layout (Claude's discretion, recommended)

```
src/lib/factsheet/
├── resolve-series.ts          # NEW leaf: equityCurveToDailyReturns + resolveDailyReturnSeries
│                              #   imports ONLY normalizeDailyReturns + types
├── allocator-portfolio-payload.ts  # re-exports both (back-compat: 2 pages + 1 test file
│                                   #   keep their existing import specifier, zero diff)
└── …
```
This keeps ONE mechanism (SC2) while preventing the 18-module `build-payload` graph from
being dragged into the OG route and the public share page.

### Anti-Patterns to Avoid

- **Forwarding `returns_series` to a client.** Doubles bytes and re-creates the +100%-day-one
  bug on the client side.
- **A second resolver, a "composerResolveSeries", or an inline `curr/prev - 1`.** SC2's whole
  point. The grep-gate must catch this.
- **Deriving `series_state` from `daily_returns.length === 0` on the client.** UI-SPEC §3
  forbids it explicitly; it guarantees one of the two states is a lie.
- **A new `SeriesStateChip` component.** UI-SPEC §1: extend `CoverageState` in place.
- **Renaming `CoverageStateChip.tsx` / the `CoverageState` type.** UI-SPEC §1: churns three
  call sites + a test file for zero user-visible gain.
- **Any migration whose filename matches `/scenario|share/i`.** Hard CI failure.
- **Editing `src/lib/scenario.ts`.** The engine is frozen for this phase; only its input changes.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Wealth index → daily returns | `points.map((p,i)=> p.value/points[i-1].value - 1)` | `equityCurveToDailyReturns` | Handles date-sort, `value > 0` filter, `Number.isFinite` guard, `< 2` points bail. A naive version divides by zero on a wiped-out day and mis-orders unsorted jsonb. |
| Two-column fallback | `daily_returns ?? returns_series` | `resolveDailyReturnSeries` | `??` only guards null/undefined — an empty-array `daily_returns` short-circuits and strands the real series. The resolver checks `direct.length > 0`. |
| Parsing the `daily_returns` JSONB | `Array.isArray(raw) ? raw : []` | `normalizeDailyReturns` | Column is typed as a nested year-keyed record (`types.ts:304`); the bare cast is the WR-05 silent-data-loss bug already fixed twice in this repo. |
| Published-only predicate | `.eq("status","published")` | `withPublishedOnly` / `withPublishedOrOwner` | `quantalyze/no-raw-published-predicate` is `error` repo-wide (`eslint.config.mjs:46`). |
| Widening the share RPC | A new SQL migration | Caller-side sibling read | CI gate `phase-29-frozen-spine-guards.test.ts:141` hard-fails. |
| A "stuck computing" timer | A new column / a new cron | `STRATEGY_ANALYTICS_REAP_THRESHOLD` = `"16 hours"` (`job_worker.py:547`), mirrored in the pg_cron reaper (`20260802120000`) | One threshold, already deployed, already asserted by the migration's own DO block (`:672`). |
| Re-deriving blend membership in the chip | Reading analytics status inside `CoverageStateChip` | Pass `state` as a prop | Component docstring: re-derivation risks disagreeing with the blend divisor (Pitfall 1). |

**Key insight:** Every capability this phase needs already exists and is already tested. A
plan that introduces a new helper for series resolution has, by construction, failed SC2.

---

## Runtime State Inventory

Not applicable — this is not a rename / refactor / migration phase. No stored data, live
service config, OS-registered state, secret, or build artifact carries a value this phase
changes. **Verified by:** the phase writes no data (⛔ backfill is explicitly out of scope),
adds no migration, and changes no env var or package name.

---

## Common Pitfalls

### P1 — `share-resolve.ts:184` is fed by a SECURITY DEFINER RPC, not a select
**What goes wrong:** The plan says "widen the select" and the executor discovers there is no
select, then reaches for a migration and hard-fails CI.
**Why it happens:** CONTEXT.md groups all three sites as "call sites only widen their select".
Site 2's series is built in SQL:
`supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql:200-206` —
`jsonb_build_object('strategy_id', sa.strategy_id, 'daily_returns', sa.daily_returns)`.
**How to avoid:** Plan Site 2 as a Phase-84-shaped caller-side sibling read in `page.tsx`,
plus an optional param on the pure `resolveSharedScenario`.
**Warning signs:** any new file under `supabase/migrations/` in the branch.
**Confidence:** HIGH [VERIFIED: migration SQL + `phase-29-frozen-spine-guards.test.ts:141,150-166`]

### P2 — The book path (Site 4) is invisible to the lazy-fetch rescue
**What goes wrong:** The three named sites get fixed, the founder's MT5 strategy is *in their
own portfolio*, and the composer still shows 0.00 — SC1 fails on the acceptance anchor.
**Why it happens:** `addedStrategyReturnsLookup` prefers the book value
(`ScenarioComposer.tsx:2069`: `fromBook ?? addedReturnsById[a.id] ?? []`), and
`handleAddStrategy` **skips** the lazy fetch when `strategyById.has(s.id)`
(`:2096`). `normalizeBookReturns(null)` returns `null` → falls through to an `undefined`
lazy entry → `[]`.
**How to avoid:** Widen `queries.ts:3405` and resolve in `queries.ts` before the payload
crosses to the client. This also fixes six other consumers in one edit:
`ScenarioComparePanel.tsx:182`, `strategies-row-adapter.ts:106`,
`AlphaBetaDecomposition.tsx:33`, `composite-returns.ts:45`, `RiskDecomposition.tsx:82`,
`CorrelationMatrix.tsx:128`.
**Warning signs:** the SC2 grep-gate goes red on `src/lib/queries.ts`.
**Confidence:** HIGH [VERIFIED: codebase, all line numbers read]

### P3 — Widening the payload type without widening the `Pick<>`
**What goes wrong:** `queries.ts:1666` declares
`strategy_analytics: Pick<StrategyAnalytics, "daily_returns" | "cagr" | "sharpe" | "volatility" | "max_drawdown"> | null`.
`computation_status` added to the select but not the `Pick` is a TS error at the consumer,
or worse, silently stripped by the `{ data_quality_flags: _dqf, ...analyticsRest }`
destructure at `queries.ts:3536-3540`.
**How to avoid:** Widen the `Pick` and verify `returns_series` is **stripped** the same way
`data_quality_flags` is — the raw wealth index should not cross to the client once the
resolved series is emitted.
**Confidence:** HIGH [VERIFIED: codebase]

### P4 — Differencing loses exactly one day, and the count is N−1, not N
**What goes wrong:** SC1 is written as "contributes its 136 days" and the test hard-asserts
`136`. The actual differenced count is **135**.
**Why it happens:** `returns_series` has one point per return day
(`metrics.py:775-778`, `cumulative = (1+returns_for_chart).cumprod()` — no prepended seed),
and `equityCurveToDailyReturns` starts at `i = 1`. PROD's `4eab92b0` starting at exactly
`1.0` means its first return was `0.0`, so the dropped day carries no information *in this
case* — but the off-by-one is structural.
**How to avoid:** Assert `>= 130` / `≈ 136` or assert equality against the *resolver's own*
output length, not a hard-coded 136. Record the N−1 relationship in the plan.
**Warning signs:** an acceptance test asserting `toBe(136)`.
**Confidence:** HIGH [VERIFIED: `metrics.py:568,654,775-778`; `allocator-portfolio-payload.ts:15-35`]

### P5 — Missing-row → `computing` is a permanent spinner (the UI-SPEC's own flagged risk)
**The definitive answer to the UI-SPEC's open question: strategy creation does NOT guarantee
a `strategy_analytics` row.** Evidence chain [all VERIFIED: codebase]:
- No trigger creates one on `strategies` INSERT (`grep "CREATE TRIGGER" supabase/migrations/*.sql` → the eight strategy-related triggers are ownership/sentinel/publish-guard/stamp triggers, none inserts an analytics row).
- The only row-*creating* writers are `sync_strategy_analytics_status`
  (`20260710150000:115,174,189` — INSERTs on a compute-job hop / done / failed), Python
  `analytics_runner._mark_computing`, three Next routes' terminal `'failed'` placeholder
  upserts, the pg_cron reaper, and the demo/e2e seeds.
- `sync_strategy_analytics_status` branch (d) is explicitly **"no rows → preserve existing
  strategy_analytics row (unchanged)"** — with no compute_jobs row, nothing is created.
- The finalize-wizard enqueue is **non-blocking**: `enqueue_compute_job` failures are logged
  and swallowed inside a `Promise.allSettled` wrapper (`finalize-wizard/route.ts:1358-1361,
  1387-1432, 1450`).
- No cron backstops a *missing* row: `reconcile-strategies` is scoped to
  `RECONCILABLE_EXCHANGES` (`FUNDING_EXCHANGES`) **and** `api_keys.last_sync_at > now()-24h`
  (`route.ts:36,54-59`); the reaper terminalizes only rows already at `'computing'`.

**How to avoid — recommended:** map missing-row → `computing` **only while the strategy is
young**, else `empty`. The returns route already reads the `strategies` row
(`route.ts:191-197`) — add `created_at` to that probe (one word) and gate on the SAME
`16 hours` the reaper uses (`STRATEGY_ANALYTICS_REAP_THRESHOLD`, `job_worker.py:547`), so
there is one threshold, not two.
**Fallback if the planner wants zero new probe columns:** map missing-row → `empty`. Safer
than a permanent spinner, at the cost of mislabelling the legitimate 10–15 min warm-up.
⚠️ Whichever is chosen, ⛔ do **not** ship unbounded missing-row → `computing`.
**Confidence:** HIGH

### P6 — A reopened / page-reloaded scenario never fetches its added series (adjacent defect)
**What goes wrong:** The founder adds a strategy, refreshes the page (or reopens a saved
scenario), and every added strategy contributes `[]` again — the SCEN-01 symptom survives the
fix on that path.
**Why it happens:** `fetchAddedReturns` has exactly **two** call sites, both add seams
(`ScenarioComposer.tsx:2097` handleAddStrategy, `:4976` BridgeDrawer). `openSavedScenario`
(`:1484`) does not call it, and neither does the localStorage-draft hydration path.
`addedReturnsById` starts empty on every fresh mount.
**How to avoid:** This is a **distinct root cause** (no fetch) from the phase's locked scope
(wrong column), so it is a genuine scope decision. Recommendation: it is small (one effect
that fires `fetchAddedReturns` for each `draft.addedStrategies` id not in the book and not
already resolved/in-flight) and without it SC1's acceptance anchor is only reproducible in a
single unbroken session. **Surface to the founder at plan time**; do not silently absorb it,
and do not silently skip it.
**Warning signs:** an acceptance walkthrough that never refreshes the browser.
**Confidence:** HIGH [VERIFIED: `grep -n "fetchAddedReturns(" ScenarioComposer.tsx` → 2 hits; `grep -n "setAddedReturnsById" → 1312, 2125` only]

### P7 — Two pinned string literals break if the select is edited carelessly
**What goes wrong:** CI goes red in a file the plan never mentions.
**Pinned literals** [VERIFIED: `src/__tests__/phase-84-asset-class-flow.test.ts`]:
- `:36` asserts `src/app/api/strategies/[id]/returns/route.ts` contains `.select("id, asset_class")` — that is the **strategies probe**, not the analytics select. Leave it byte-unchanged.
- `:47` asserts `src/app/scenario-share/[token]/page.tsx` contains `.select("id, asset_class")` — the sibling analytics read must be a **separate** query.
- `:24-31` slices `queries.ts` between `"strategy:strategies!inner ("` and the next `"strategy_analytics ("` and asserts `asset_class` is inside. Adding columns *inside* the `strategy_analytics (...)` block is safe; moving the block is not.
**Confidence:** HIGH

### P8 — SC2's literal wording ("equals the series the detail pages render") is false for composites
**What goes wrong:** A reviewer reads SC2 literally, tests a composite strategy, and the
composer's series differs from the factsheet's.
**Why it happens:** For `data_quality_flags.composite === true`, `factsheet/[id]/v2/page.tsx`
**overrides** the resolver output with `readCompositeFactsheet(...)`'s `csv_daily_returns`-
derived arithmetic running-cumulative series (`page.tsx:95-113`). The resolver result is
discarded on that arm. The composer will receive the differenced `returns_series` instead.
**How to avoid:** Read SC2 as its *structural* clause — "both resolved through the ONE
existing `resolveDailyReturnSeries`, with no third resolution mechanism minted" — which the
plan satisfies. Record the composite divergence explicitly so it is a known, reviewed fact
rather than a review finding. ⚠️ Determine at plan time whether the founder's `4eab92b0` MT5
strategy is a composite (`data_quality_flags.composite`); if it is, the SC1 acceptance
numbers need re-deriving against the composite path.
**Confidence:** HIGH on the mechanism [VERIFIED: `factsheet/[id]/v2/page.tsx:95-113`];
MEDIUM on whether `4eab92b0` is affected (not verified against PROD in this session).

### P9 — The differenced series is gap-filled; it is not `csv_daily_returns`
**What goes wrong:** Someone expects the composer's blend Sharpe to match a
`csv_daily_returns`-based figure exactly.
**Why it happens:** `returns_for_chart = returns.fillna(0).clip(lower=_LOG_RETURN_FLOOR)`
(`metrics.py:568`) — NaN days become `0.0` before the cumprod, and values are floored at
`−1 + 1e-9`. Differencing recovers those `0.0` days.
**How to avoid:** Document it. This is pre-existing behaviour that both detail pages already
render, so it is *consistent* (SC2 holds) — it just is not byte-equal to the sparse CSV
series. Do not "fix" it in this phase.
**Confidence:** HIGH [VERIFIED: `metrics.py:558-568`]

### P10 — OG image staleness is CDN-owned, not route-owned
**What goes wrong:** The OG fix is verified locally, then "doesn't work" on a re-unfurl.
**Why it happens:** `route.tsx:13` is `dynamic = "force-dynamic"`, but `:124-127` stamps
`Cache-Control: public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800`.
**How to avoid:** Verify with a cache-busting query string or a fresh URL; state in the plan
that the corrected card appears within the 24h CDN TTL / 7d SWR window.
**Confidence:** HIGH [VERIFIED: codebase]

---

## Code Examples

### Site 1 — the returns route (`route.ts:219-282`)

```ts
// Source: current file src/app/api/strategies/[id]/returns/route.ts:219-223 (widened)
const { data, error } = await supabase
  .from("strategy_analytics")
  // Phase 147 / SCEN-01 — `daily_returns` has NO production writer (migration 087 / D-02
  // moved heavy series off this table). The real series is the `returns_series` WEALTH
  // INDEX and MUST be differenced. `computation_status` discriminates computing vs
  // terminal-empty server-side (a client cannot: length===0 is ambiguous).
  .select("daily_returns, returns_series, computation_status, data_quality_flags")
  .eq("strategy_id", id)
  .maybeSingle();

// ... existing error redaction (T-29-02) unchanged ...

const row = data as {
  daily_returns?: unknown;
  returns_series?: unknown;
  computation_status?: unknown;
  data_quality_flags?: unknown;
} | null;

// ONE mechanism (SC2). DailyReturn and DailyPoint are structurally identical.
const daily_returns: DailyPoint[] = resolveDailyReturnSeries(
  row?.daily_returns,
  row?.returns_series,
);

const series_state: SeriesState =
  daily_returns.length > 0
    ? "available"
    : deriveEmptySeriesState(row?.computation_status ?? null, strat.created_at);
```

```ts
// Source: NEW — the ONE server-side discriminator (share it; do not inline it twice).
// Closed set at src/lib/closed-sets.ts:414-419.
export type SeriesState = "available" | "computing" | "empty";

export function deriveEmptySeriesState(
  status: string | null,
  strategyCreatedAt: string | null,
): SeriesState {
  if (status === "pending" || status === "computing") return "computing";
  if (status === null) {
    // P5 — no analytics row exists. Creation does NOT guarantee one (no trigger; the
    // finalize enqueue is non-blocking; no cron backstops a MISSING row). Bound the
    // optimistic reading by the SAME 16h the reaper uses
    // (job_worker.py:547 STRATEGY_ANALYTICS_REAP_THRESHOLD) so a never-enqueued
    // strategy degrades to honest absence instead of spinning "Syncing" forever.
    const t = strategyCreatedAt ? Date.parse(strategyCreatedAt) : NaN;
    if (!Number.isFinite(t)) return "empty";           // unknown age → honest absence
    return Date.now() - t < 16 * 60 * 60 * 1000 ? "computing" : "empty";
  }
  // complete / complete_with_warnings / failed with no series → terminal absence.
  // UI-SPEC gate: `failed` renders MUTED "No data", never red.
  return "empty";
}
```

### Site 2 — the share page sibling read (mirror of `page.tsx:163-197`)

```tsx
// Source: pattern copied verbatim from src/app/scenario-share/[token]/page.tsx:163-197
// (the Phase-84 asset_class read). SEPARATE query — do NOT fold into the pinned
// `.select("id, asset_class")` (phase-84-asset-class-flow.test.ts:47).
const returnsSeriesById: Record<string, unknown> = {};
if (seriesIds.length > 0) {
  try {
    const { data: rsRows, error: rsError } = await admin
      .from("strategy_analytics")
      .select("strategy_id, returns_series")
      .in("strategy_id", seriesIds);   // ids already published-gated by the RPC
    if (rsError) {
      console.error("[scenario-share/page] returns_series read failed", {
        message: (rsError as { message?: string }).message,
      });
    }
    for (const r of (rsRows ?? []) as Array<{ strategy_id: string; returns_series: unknown }>) {
      returnsSeriesById[r.strategy_id] = r.returns_series;
    }
  } catch (e) {
    console.error("[scenario-share/page] returns_series read threw", {
      message: (e as { message?: string }).message,
    });
  }
}
const resolved = resolveSharedScenario(row, assetClassById, returnsSeriesById);
```

```ts
// Source: src/app/scenario-share/[token]/share-resolve.ts:183-185 (widened; stays PURE)
for (const s of row.series ?? []) {
  seriesById.set(
    s.strategy_id,
    resolveDailyReturnSeries(s.daily_returns, returnsSeriesById?.[s.strategy_id]),
  );
}
```

### Site 4 — the book payload (`queries.ts:3405` + `:3536`)

```ts
// Source: src/lib/queries.ts:3405-3411 (widened)
strategy_analytics (
  daily_returns,
  returns_series,          // Phase 147 — the ONLY populated series for real strategies
  computation_status,      // Phase 147 — server-side series_state discriminator
  cagr, sharpe, volatility, max_drawdown,
  data_quality_flags
)
```

```ts
// Source: src/lib/queries.ts:3536-3540 (widened) — strip returns_series the SAME way
// data_quality_flags is stripped, and emit the RESOLVED array under the SAME field name
// so every existing consumer is byte-unchanged.
if (analyticsObj) {
  const {
    data_quality_flags: _dqf,
    returns_series: _rs,
    ...analyticsRest
  } = analyticsObj;
  strategyAnalyticsForPayload = {
    ...analyticsRest,
    daily_returns: resolveDailyReturnSeries(
      analyticsObj.daily_returns,
      analyticsObj.returns_series,
    ),
  } as MyAllocationDashboardPayload["strategies"][number]["strategy"]["strategy_analytics"];
}
```

### Composer — additive tolerance + chip precedence

```ts
// Source: tolerance pattern from ScenarioComposer.tsx:1349-1359
const seriesState: SeriesState =
  d.series_state === "computing" || d.series_state === "empty"
    ? d.series_state
    : "available";   // stale deploy / malformed → no chip, never a false "Syncing"
```

```ts
// Source: chip precedence from UI-SPEC §2, replacing ScenarioComposer.tsx:5582-5586
const chipState: CoverageState | null = !enabled
  ? "manually-excluded"          // explicit user intent wins
  : seriesStateByRef[a.id] === "computing"
    ? "syncing"
    : seriesStateByRef[a.id] === "empty"
      ? "no-series"
      : coverageEligible[a.id]
        ? "in-blend"
        : null;                   // auto-excluded group renders its own — unchanged
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Heavy series stored on `strategy_analytics` JSONB columns | Heavy series in `strategy_analytics_series` (per-kind rows) via `fetch_strategy_lazy_metrics` / `upsert_strategy_analytics_series_batch` | Migration 087, `20260428120919` (D-02, 1MB TOAST ceiling) | ⛔ Makes backfilling `daily_returns` the wrong lever. `returns_series` still lives on `strategy_analytics` and is still written — that is what this phase reads. |
| `computation_status` exact-match on `'complete'` | `isComputedAnalytics()` (`closed-sets.ts`) admits `complete_with_warnings` | Migration `20260707120000` | If the plan gates on terminal-success anywhere, use the shared predicate — not `=== "complete"`. |
| A stuck `computing` row spun forever | pg_cron reaper terminalizes after `16 hours` | Migration `20260802120000` | Gives the plan a ready-made, deployed threshold for P5's age bound. |
| `get_shared_scenario` widened by migration | Caller-side sibling read | Phase 84 (`page.tsx:158`) | The only legal pattern for adding data to the share page. |

**Deprecated / dead:**
- `queries.ts:414` type annotation declares `daily_returns` on a select
  (`PUBLIC_ANALYTICS_COLUMNS`, `:284`) that does not include it — dead field. Out of scope;
  log to TODOS if the grep-gate trips on it.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node / npm | vitest suite | ✓ | repo-pinned (CI = Node 22, local may be 25) | ⚠️ CI-only vitest failures reproduce with `PATH=/opt/homebrew/opt/node@22/bin` — not a flake |
| vitest | all new tests | ✓ | `^4.1.2` (`package.json:71`) | — |
| `@vitest/coverage-v8` | blocking coverage gate | ✓ | `^4.1.10` | — |
| git (with `origin/main` reachable) | `phase-29-frozen-spine-guards.test.ts` baseline resolution | ✓ | — | ⛔ none — the guard throws (Rule 12) on an unresolvable base. Run against a non-shallow clone. |
| Playwright / e2e | `e2e/composer-axe.spec.ts` | assumed ✓ | — | Not required for this phase's gates |
| Supabase MCP / PROD access | optional PROD re-verification of `4eab92b0` | not exercised this session | — | The REQUIREMENTS.md census is the cited evidence |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** none blocking.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | vitest `^4.1.2` (`package.json:71`) |
| Config file | `vitest.config.ts` (coverage thresholds: lines 82 / statements 80 / functions 74 / branches 72 — blocking CI gate per CLAUDE.md) |
| Quick run command | `npx vitest run <path> --no-file-parallelism` |
| Full suite command | `npm run test` (CI runs sharded with `--coverage`, merged by the `frontend-coverage` job) |
| Local flake note | `--no-file-parallelism` for local vitest; ⚠️ Node-version skew (CI 22 vs local 25) produces CI-only failures that are NOT flakes |

### Phase Requirements → Test Map

| SC | Behavior | Test Type | Automated Command | File Exists? |
|----|----------|-----------|-------------------|-------------|
| SC1 | Returns route returns a non-empty differenced series when only `returns_series` is populated | route unit | `npx vitest run "src/app/api/strategies/[id]/returns/route.test.ts" -t "returns_series"` | ⚠️ file exists (`route.test.ts`, R1–R8 matrix) — **extend**, do not create |
| SC1 | Book path: an added strategy present in `payload.strategies` with `daily_returns=null` still contributes a series | component | `npx vitest run "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx" -t "book"` | ⚠️ file exists (`LAZY_ID` fixtures at `:1187+`) — **extend** |
| SC1 | Share projection resolves the wealth index | unit | `npx vitest run "src/app/scenario-share/[token]/share-resolve.test.ts"` | ✅ exists |
| SC1 | OG headline is finite when only `returns_series` is populated | route unit | `npx vitest run "src/app/api/og/factsheet"` | ❌ Wave 0 — no `route.test.tsx` for the OG route |
| SC2 | **Structural:** no `strategy_analytics` read fetches `daily_returns` without `returns_series` + a resolver call | grep-gate | `npx vitest run src/__tests__/phase-147-series-resolution-guards.test.ts` | ❌ Wave 0 |
| SC2 | Both detail pages still resolve through the ONE resolver (non-regression pin) | grep-gate | same file | ❌ Wave 0 |
| SC3 | **Route-level wiring:** a `returns_series` starting at exactly `1.0` yields day one ≠ `+1.0` | route unit | `npx vitest run "src/app/api/strategies/[id]/returns/route.test.ts" -t "wealth index"` | ⚠️ extend existing |
| SC3 | Same assertion on the book path and the share path (the wiring, not the helper) | unit | `npx vitest run "share-resolve.test.ts" -t "wealth index"` | ⚠️ extend existing |
| SC4 | `computing` + empty series → `data-series-state="computing"`, chip `SYNCING`, note has `role="status"` | component | `npx vitest run "ScenarioComposer.test.tsx" -t "syncing"` | ⚠️ extend existing |
| SC4 | `complete` / `failed` + empty series → `data-series-state="empty"`, chip `NO DATA`, **no** `text-negative`/`bg-negative`/`border-negative` | component | same file | ⚠️ extend existing |
| SC4 | Neither state renders `opacity-50` / `line-through`; toggle `aria-checked="true"`; weight + leverage inputs not `disabled` | component | same file | ⚠️ extend existing |
| SC4 | Exactly one chip per row, ever | component | same file | ⚠️ extend existing |
| SC4 | Zero contributing constituents → no blend KPI cell renders the literal `0.00` | component | same file | ⚠️ extend existing |
| SC4 | UNIFY-04 `data-testid="scenario-loading-returns"` banner still renders while a lazy fetch is in flight (regression guard) | component | `-t "loading-returns"` | ✅ exists (`ScenarioComposer.tsx:4764`) |
| P5 | Missing analytics row on a >16h-old strategy → `empty`, NOT `computing` (permanent-spinner guard) | route unit | `-t "missing analytics row"` | ❌ Wave 0 |
| P1 | No new `supabase/migrations/**` file matches `/scenario\|share/i` | existing gate | `npx vitest run src/__tests__/phase-29-frozen-spine-guards.test.ts` | ✅ exists — must stay green |
| P7 | `asset_class` still projected on all three surfaces | existing gate | `npx vitest run src/__tests__/phase-84-asset-class-flow.test.ts` | ✅ exists — must stay green |

### The SC2 grep-gate: how to build it (mirror, don't invent)

Two in-repo precedents, both `readFileSync`-based:
- `src/__tests__/phase-84-asset-class-flow.test.ts` — **the closest analog**: same three
  surfaces, same "one field must reach every projection or a surface silently degrades"
  rationale. Copy its structure.
- `src/__tests__/phase-63-series-space-guards.test.ts` — the two-layer (source-scan +
  runtime-value) pattern, with an explicit non-vacuity record in its docstring.

Gate design requirements:
- **Explicit file allowlist**, not a corpus walk — `no-store-coverage.test.ts:29-33` documents
  exactly why a forces-classify-everything gate trips every unrelated PR.
- **A missing file is a FAILURE, not a skip** (Rule 12; `phase-63:83-85` states this).
- Assert the **resolver is invoked**, not a specific import specifier — the recommended leaf
  extraction changes the specifier at some call sites.
- Tolerate `strategy_analytics (*)` splats (both columns present by construction).
- **Record non-vacuity in the commit message**: plant a bare `daily_returns` select, watch it
  go red, revert. `phase-63` and `phase-29` both do this and say so.

### Sampling Rate
- **Per task commit:** `npx vitest run <the touched test files> --no-file-parallelism`
- **Per wave merge:** `npm run test` (full suite; ⚠️ mind the CI Node-22 skew)
- **Phase gate:** full suite green, `npm run lint` green (`no-raw-published-predicate`,
  `no-raw-font-px` are `error`), and both pre-existing structural gates (phase-29, phase-84)
  still green, before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `src/__tests__/phase-147-series-resolution-guards.test.ts` — the SC2 structural gate
- [ ] `src/app/api/og/factsheet/[id]/route.test.tsx` — no test file exists for this route today
- [ ] Missing-analytics-row age-bound case in `returns/route.test.ts` (covers P5)
- [ ] Test-harness widening in `returns/route.test.ts`: `STATE.analyticsRow` must carry
      `returns_series` + `computation_status`, and `STATE.observedFilters.analyticsSelect`
      (already captured at `:107`) should be asserted to contain `returns_series`
- [ ] Framework install: **none** — vitest + coverage-v8 already installed

---

## Security Domain

`security_enforcement` is not disabled in `.planning/config.json`, so this section applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | Untouched. `withAllocatorAuth` on the returns route is unchanged; the share page and OG route are deliberately sessionless. |
| V3 Session Management | no | No session surface touched. |
| V4 Access Control | **yes** | ⭐ The 404 existence-oracle mitigation (`withPublishedOrOwner` probe → 404, never 403) and the `analytics_read` RLS boundary must be **provably unchanged**. The share page's sibling read must stay bounded to RPC-returned ids. |
| V5 Input Validation | yes | Existing `isUuid` 400-before-auth ordering (B15) and `normalizeDailyReturns` JSONB validation are unchanged; the resolver adds `Number.isFinite` + `value > 0` filtering. |
| V6 Cryptography | no | No crypto surface. `hashShareToken` untouched. |
| V9 / V13 Data protection & API | **yes** | `NO_STORE_HEADERS` must remain on every returns-route response arm; the OG route's public CDN headers must not change. |

### Known Threat Patterns for this change

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Column-widening leaks a non-public field | Information Disclosure | ✅ **No new disclosure.** `returns_series` and `computation_status` are already served publicly for published strategies by `factsheet/[id]/v2/page.tsx:45` and `PUBLIC_ANALYTICS_COLUMNS` respectively. `analytics_read` RLS (`20260405061912_rls_policies.sql:36-42`) is table-level — **no column grants exist on `strategy_analytics`** [VERIFIED: `grep GRANT/REVOKE`], so the widened selects need zero RLS work. |
| Raw wealth index reaching a client | Information Disclosure (minor) | Resolve server-side and **strip** `returns_series` from the emitted payload (see the `queries.ts:3536` example). Wire bytes stay flat. |
| Share sibling read over-returns | Information Disclosure | Bound `.in("strategy_id", seriesIds)` to the RPC's own output — those ids are already `status='published'`-gated inside the SECDEF function (`20260622120000:205`). Never read an arbitrary id on that page. |
| `series_state` becomes an existence oracle | Information Disclosure | The discriminator is emitted **only after** the 404 probe passes, so it reveals nothing the existing 404 oracle did not already gate. |
| RPC tampering via a widening migration | Tampering | ⛔ Structurally prevented: `phase-29-frozen-spine-guards.test.ts:150-166` fails the build. |
| Postgres error text reaching the caller | Information Disclosure | Existing T-29-02 redaction (`route.ts:225-236`) must survive the widening: static envelope + `captureToSentry`, never `error.message`. |
| Cached response served cross-tenant | Information Disclosure | `NO_STORE_HEADERS` on every returns-route arm (locked by `src/__tests__/no-store-coverage.test.ts`). The share page stays `force-dynamic`. The OG route serves published-only data and its CDN caching is intentional. |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The founder's MT5 strategy `4eab92b0` is **not** a composite (`data_quality_flags.composite !== true`) | Pitfalls P8 | If it IS a composite, its factsheet renders the `csv_daily_returns` arithmetic curve while the composer gets the differenced `returns_series` — SC1's "136 days" acceptance numbers need re-deriving. **Cheap check: one PROD read of `data_quality_flags` for that id.** |
| A2 | PROD currently has `strategies` rows with **no** `strategy_analytics` row at all | Pitfalls P5 | The mechanism (no trigger, non-blocking enqueue, no missing-row cron) is VERIFIED in code; the *present-tense PROD count* is not. If the count is 0 today, the age bound is still correct defence-in-depth but is less urgent. **Cheap check: `SELECT count(*) FROM strategies s LEFT JOIN strategy_analytics a ON a.strategy_id=s.id WHERE a.strategy_id IS NULL;`** |
| A3 | The `returns` for `4eab92b0` are indexed on trading days only (so `fillna(0)` does not densify to calendar days) | Pitfalls P9 | If upstream reindexes to calendar days, the differenced series carries weekend zeros — deflating vol/Sharpe on the blend. Both detail pages already render this, so it is consistent, but the magnitude is unknown. |
| A4 | Extracting the resolver to a leaf module is acceptable under Rule 3 (surgical) | Architecture Patterns | If the founder prefers zero file moves, import `allocator-portfolio-payload.ts` directly and accept the 18-module import graph on the OG/share paths. Behaviourally identical either way. |
| A5 | P6 (reopen/refresh never re-fetches) is in scope for this phase | Pitfalls P6 | If descoped, SC1's acceptance anchor is only reproducible in one unbroken browser session and the founder will likely re-report the same symptom. Must be an explicit, recorded decision. |

---

## Open Questions (RESOLVED)

1. **Is the founder's MT5 strategy a composite?**
   - What we know: `csv_daily_returns` holds 136 rows for `4eab92b0`; `returns_series`
     starts at 1.0 and ends 0.7196; the factsheet has a composite arm that overrides the
     resolver.
   - What's unclear: whether `data_quality_flags.composite === true` for that id.
   - Recommendation: one PROD read at plan time. It decides whether SC1's expected count is
     ~135 differenced days or the composite path's own count.
   - **RESOLVED:** carried as 147-VALIDATION.md §Manual-Only Verifications "A1 composite
     check" — a PROD read (orchestrator-only; MCP stripped from subagents) executed before
     the acceptance walkthrough judges SC1.

2. **Does the missing-analytics-row case exist on PROD today, and at what volume?**
   - What we know: nothing structurally guarantees the row exists; no cron backstops a
     missing one.
   - What's unclear: the present count.
   - Recommendation: implement the P5 age bound regardless (it is ~6 lines and reuses a
     deployed threshold), and record the count for the acceptance write-up.
   - **RESOLVED:** the P5 age bound is implemented in 147-02 Task 1 regardless of count;
     the PROD census is carried as 147-VALIDATION.md §Manual-Only Verifications "A2
     missing-row census".

3. **Is P6 (reopen / page-refresh never re-fetches added series) in this phase?**
   - What we know: `fetchAddedReturns` has exactly two call sites, both add seams.
   - What's unclear: whether the founder considers it the same defect.
   - Recommendation: **surface it as an explicit plan-time decision.** It is small, it shares
     the user-visible symptom, and leaving it silently open means the acceptance walkthrough
     must never refresh the page. Do not absorb it silently in either direction.
   - **RESOLVED:** orchestrator ruled P6 IN SCOPE (the founder's acceptance anchor must
     survive a page refresh); implemented in 147-06 Task 1 (hydration effect).

4. **Should `getPortfolioStrategies` (`queries.ts:1299`) consumers be audited?**
   - What we know: that query already selects both columns, so the grep-gate passes.
   - What's unclear: whether its consumers read `daily_returns` bare and therefore still see
     `null` for real strategies.
   - Recommendation: a plan-time grep of its consumers; log anything found to TODOS rather
     than expanding this phase further.
   - **RESOLVED:** 147-06 Task 3 runs the log-only consumer audit — findings logged to
     TODOS.md as DEF-147-A/B/…; NO code changes, no scope expansion.

---

## Sources

### Primary (HIGH confidence) — direct codebase reads, this session
- `src/app/api/strategies/[id]/returns/route.ts` (full file), `route.test.ts:1-200`
- `src/app/scenario-share/[token]/share-resolve.ts:1-200`, `page.tsx:1-230`
- `src/app/api/og/factsheet/[id]/route.tsx:1-130`
- `src/lib/factsheet/allocator-portfolio-payload.ts:1-60`, `allocator-portfolio-payload.test.ts:145-215`
- `src/lib/queries.ts:100-150, 284, 410-460, 700-745, 1290-1310, 1585-1700, 2740-2870, 3395-3560`
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:580-640, 960-1060, 1281-1380, 1484-1500, 2040-2135, 4415-4465, 4955-4995, 5560-5650`
- `src/app/(dashboard)/allocations/components/CoverageStateChip.tsx` (full file)
- `src/app/factsheet/[id]/v2/page.tsx:30-150`; `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx:40-80`
- `src/lib/closed-sets.ts:410-450`; `src/lib/portfolio-math-utils.ts:11-14`; `src/lib/factsheet/types.ts:11`
- `src/__tests__/phase-29-frozen-spine-guards.test.ts:1-200`; `phase-84-asset-class-flow.test.ts` (full); `phase-63-series-space-guards.test.ts:1-90`; `no-store-coverage.test.ts:1-60`
- `supabase/migrations/20260622120000_scenario_shares_and_read_rpc.sql:125-235, 320-360`
- `supabase/migrations/20260405061911_initial_schema.sql:69-97`; `20260405061912_rls_policies.sql:36-45`
- `supabase/migrations/20260428120919_strategy_analytics_series.sql:1-60, 192, 230-231`
- `supabase/migrations/20260710150000_sync_status_supersede_failed_per_kind.sql:71-206`
- `supabase/migrations/20260802120000_strategy_analytics_stuck_computing_reaper.sql:477-520, 672`
- `src/app/api/keys/sync/route.ts:40-110` (the authoritative computation_status writer census)
- `src/app/api/strategies/finalize-wizard/route.ts:1315-1460, 1495-1560`
- `src/app/api/cron/reconcile-strategies/route.ts:30-80`
- `analytics-service/services/metrics.py:556-600, 645-665, 765-790`; `transforms.py:395-399`; `job_worker.py:505, 547`
- `eslint.config.mjs:46, 98`; `package.json:13-16, 63-71`

### Secondary (MEDIUM confidence)
- `.planning/REQUIREMENTS.md` SCEN-01 (the PROD census, 2026-08-04) — founder-verified but
  not re-measured in this session
- `.planning/ROADMAP.md` Phase 147 (binding traps)
- `147-CONTEXT.md`, `147-UI-SPEC.md`

### Tertiary (LOW confidence)
- None. No web search was performed; this phase has no external-technology component and
  every claim above is a file read.

---

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — zero new dependencies; every module pinned to a line number read this session
- Architecture / reader census: **HIGH** — all four sites read directly; the fourth site's
  consequence traced through `addedStrategyReturnsLookup` to `[]`
- Pitfalls P1, P2, P5, P6, P7, P10: **HIGH** — each verified against source
- Pitfall P4 (N−1 count): **HIGH** on the mechanism, **MEDIUM** on the exact expected number
  for `4eab92b0` (not re-measured against PROD)
- Pitfall P8 (composite divergence): **HIGH** on the mechanism, **MEDIUM** on applicability
  to the acceptance anchor (see A1)
- Security: **HIGH** — RLS policy and grant surface read directly; no column grants exist
- Validation architecture: **HIGH** — every referenced test file confirmed present or
  confirmed absent

**Research date:** 2026-08-04
**Valid until:** 2026-09-03 (30 days — in-repo findings; invalidated early by any merge
touching `queries.ts:3405`, the returns route, the share RPC, or `resolveDailyReturnSeries`)
