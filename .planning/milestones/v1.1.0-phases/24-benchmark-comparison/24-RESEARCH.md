# Phase 24: Benchmark Comparison - Research

**Researched:** 2026-06-22
**Domain:** Client-side active-return analytics (TS) + shared market-data read route (Next.js 16 App Router) + chart overlay wiring (existing SVG EquityChart)
**Confidence:** HIGH (all claims verified against live source; no novel external dependencies)

## Summary

Phase 24 attaches a BTC benchmark dimension to the ACTIVE scenario projection: a chart overlay, four active-return metrics (tracking error / information ratio / alpha / beta) computed over the date-intersection window with 252-day annualization, and an honest "Benchmark comparison unavailable" empty state. The work is almost entirely **reuse and wiring** — the math primitives, the chart prop, the empty-state shell, the sample-floor gate, the methodology line, and the formatters all already exist. The genuine net-new code is (a) ONE GET route that exposes the BTC daily-returns series from `benchmark_prices`, (b) a thin pure-TS module that derives the scenario's full daily portfolio-return series + the inner-join alignment + assembles the four metrics, and (c) the metrics-section / empty-state UI mounted in `ScenarioComposer.tsx`.

The single most important correction the planner must absorb: **CONTEXT and UI-SPEC both reference `EquityCurve.tsx`'s `benchmarkSeries` prop, but the composer's projection chart is NOT `EquityCurve.tsx` — it is the SVG `EquityChart` widget** (`src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx`), which already has its OWN `benchmark?: DailyPoint[]` prop and its own internal date-keyed alignment + anchoring pipeline. `EquityCurve.tsx` (lightweight-charts) is a DIFFERENT component used elsewhere (the single-strategy v2 panel + factsheet). Plumbing the overlay = passing the BTC series to `EquityChart.benchmark`, NOT to `EquityCurve.benchmarkSeries`. Getting this wrong sends the planner to the wrong component.

The second load-bearing correction: `computeScenario` does NOT expose the per-day portfolio-return series — it builds `portDaily` internally (`scenario.ts:221`) but only returns a **downsampled** (every-5-business-day) `equity_curve`. The active-return math needs the FULL daily series aligned to its exact dates. The cleanest source is to **expose the full daily portfolio returns from `computeScenario`** (additive return field) rather than reconstruct from the lossy downsampled curve.

**Primary recommendation:** Reuse the existing `computeAlphaBeta` + `computeTrackingError` from `portfolio-stats.ts` (their formulas already match the CONTEXT spec exactly), add a full-daily-returns output to `computeScenario`, inner-join scenario-daily-returns ∩ BTC-daily-returns by date BEFORE calling the metric helpers, gate on `evaluateSampleFloor(n, 30)`, and pass the date-keyed BTC series to the composer's `EquityChart.benchmark` prop. No Python change, no new npm dependency.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| BTC daily-returns read (shared market data) | API / Backend (Next.js Route Handler) | Database (`benchmark_prices`) | Shared, non-tenant data; one GET route reads the table server-side and returns `[{date,value}]`. |
| Active-return math (TE/IR/alpha/beta) | Browser / Client (pure TS) | — | Scenario surface is client-side by design (`scenario.ts`); no worker round-trip (Phase 21/22/23 precedent). |
| Date-intersection alignment | Browser / Client (pure TS) | — | Both series are already client-side once fetched; inner-join is a pure transform. |
| Sample-floor honesty gate | Browser / Client (pure TS) | — | `evaluateSampleFloor` is pure; runs on the aligned `n`. |
| Overlay render + toggle | Browser / Client (React) | — | Existing `EquityChart` SVG widget already owns the benchmark series + per-component render. |
| Empty-state render | Browser / Client (React) | — | `EmptyStateCard` is a pure presentational shell. |

## Standard Stack

### Core (all already in the project — NO new installs)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | ^16.2.3 [VERIFIED: package.json] | Route Handler for the BTC series GET | Project framework; App Router route handlers. |
| react | 19.2.4 [VERIFIED: package.json] | Metrics section + empty state | Project UI runtime. |
| @supabase/ssr | ^0.10.0 [VERIFIED: package.json] | Request-scoped server client (`createServerClient`) for the DB read | The established `src/lib/supabase/server.ts` factory. |
| @supabase/supabase-js | ^2.101.1 [VERIFIED: package.json] | Underlying client | Project dependency. |
| vitest | ^4.1.2 [VERIFIED: package.json] | Golden unit tests + route test + component test | Project test runner (jsdom env). |
| lightweight-charts | ^5.1.0 [VERIFIED: package.json] | (NOT used by the composer's chart) | Only `EquityCurve.tsx`/`PortfolioEquityCurve.tsx` use it — see wiring note. |

**Installation:** None. `[VERIFIED: npm registry]` N/A — no packages added this phase. The `## Package Legitimacy Audit` is therefore a no-op (see below).

### Reused In-House Primitives (the actual "stack" for this phase)
| Symbol | Location | Purpose |
|--------|----------|---------|
| `computeAlphaBeta(returns, benchmark)` | `src/lib/portfolio-stats.ts:412` | CAPM beta=cov/var, alpha=(mean_r − β·mean_b)×252. **Already matches CONTEXT spec.** |
| `computeTrackingError(returns, benchmark)` | `src/lib/portfolio-stats.ts:444` | TE = std(r−b)×√252. **Already matches CONTEXT spec.** |
| `computeScenario(...)` | `src/lib/scenario.ts:132` | Scenario engine; builds `portDaily` (line 221) but does NOT expose it — see Pitfall 1. |
| `evaluateSampleFloor(n, floor)` | `src/lib/sample-floor.ts:70` | Honesty gate; pass `floor=30` for the benchmark window. |
| `EmptyStateCard` | `src/components/ui/EmptyStateCard.tsx:23` | Neutral muted card (no `role="alert"`), `{heading, body}` props. |
| `methodologyLine(n)` | `src/lib/scenario-history.ts:41` | "Historical realized · {n} overlapping days · not a forecast." |
| `EquityChart` (SVG) `.benchmark` prop | `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx:192` | `benchmark?: DailyPoint[]` — date-keyed, anchored to composite base, sliced to visible window (lines 625-635). |
| `formatPercent` / `formatNumber` | `src/lib/utils.ts:3,27` | Emit em-dash "—" for null/non-finite (verified line 8/28). |
| `createClient()` (SSR) | `src/lib/supabase/server.ts:6` | Request-scoped server client for the route. |
| `NO_STORE_HEADERS` | `src/lib/api/headers.ts` | `{ "Cache-Control": "private, no-store" }` — the contrast pattern; the benchmark route should NOT use this. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| New `computeScenario` daily-returns output | Reconstruct from `equity_curve` via `(1+cum[i])/(1+cum[i-1])−1` | The `equity_curve` is downsampled to every-5-days AND rounded to 5 decimals (`scenario.ts:404,407`) — reconstruction yields 5-day-block returns at wrong dates, NOT daily returns. **Rejected** — would silently mis-align the intersection and corrupt all four metrics. |
| New `computeScenario` daily-returns output | Recompute the weighted daily sum in the new module | Duplicates the renormalization + leverage logic (`scenario.ts:219-236`) — a drift risk (Rule 7). **Rejected** — expose, don't re-derive. |
| New GET route | Reuse `payload.*.btc_benchmark_returns` already on the dashboard | That field is PER-STRATEGY (each strategy's analytics JSON, aligned to that strategy's own window — `queries.ts:711-713,737-739`), NOT a standalone BTC series spanning an arbitrary scenario blend window. **Rejected** — the locked CONTEXT route is correct and necessary. |

## Package Legitimacy Audit

> **No external packages are installed in this phase.** All code reuses in-repo modules and existing dependencies (next, react, @supabase/ssr, vitest). slopcheck/registry verification is N/A. The planner does not need a `checkpoint:human-verify` install gate for this phase.

| Package | Disposition |
|---------|-------------|
| (none) | No installs — phase is reuse + wiring only |

## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Benchmark = BTC only** (`benchmark_prices`, populated by `benchmark.py` `get_benchmark_returns("BTC")`). Label UI "vs BTC".
- **New GET route** exposes BTC daily-returns as `[{date, value}]` (pct-change of `close_price`). Shared market data → **cacheable** (short cache OK; NOT the allocator no-store path), no per-tenant RLS. Read server-side.
- **No Python / no analytics-service change** → Railway deploy is a no-op. No new dependencies.
- **Reuse `computeTrackingError`** (`portfolio-stats.ts:444`, ×√252).
- **IR** = `mean(excess) × 252 / trackingError`; **Beta** = `cov(p,b)/var(b)`; **Alpha** = `(mean_p − β·mean_b) × 252`. All 252, never √365. (Correlation may reuse `scenario.ts:389` Pearson.)
- **Alignment = INTERSECTION (inner-join)** of scenario dates ∩ benchmark dates — mirror `portfolio.py:915-916`. Do NOT reuse the scenario's zero-filled date UNION.
- **Overlay** on the projection equity chart, toggleable; **metrics** in a labeled "vs BTC over {N} overlapping days" section; numbers in Geist Mono.
- **Honest empty state** via `EmptyStateCard` with neutral "Benchmark comparison unavailable" heading whose body names the specific reason (heading must match body — the #509 lesson). Floor = `evaluateSampleFloor(n, 30)` (30-day benchmark floor, matching `portfolio.py:917`).
- **Degenerate single metric** (null/non-finite) → em-dash "—", never a fabricated 0/"0.00%"/"N/A".
- **Methodology disclosure**: `methodologyLine(n)` + note "Metrics are 252-day annualized active returns."

### Claude's Discretion
- Exact route path/name; the daily-returns source (expose from `computeScenario` vs reconstruct — **research recommends expose**, see Pitfall 1); the metrics-section layout; the overlay toggle placement.

### Deferred Ideas (OUT OF SCOPE)
- Benchmark columns in the Phase-23 multi-scenario compare table.
- Additional benchmarks (SPX/SPY/ETH) — only BTC exists in `benchmark_prices`.
- Byte-exact parity with quantstats `greeks` — standard CAPM definitions, hand-computed goldens.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| BENCH-01 | The scenario projection surfaces performance vs a benchmark (reusing `benchmark_prices` / `benchmark.py`), including tracking error / information ratio / alpha-beta over the overlap window | Reuse `computeAlphaBeta`+`computeTrackingError` (already correct); add full-daily-returns to `computeScenario`; inner-join by date; gate on `evaluateSampleFloor(n,30)`; pass BTC series to `EquityChart.benchmark`; new GET route reads `benchmark_prices` (RLS `SELECT USING(true)`, public-read confirmed). All five research questions answered below. |

## Architecture Patterns

### System Architecture Diagram

```
                        ┌─────────────────────────────────────────┐
  benchmark.py (worker) │  Supabase: benchmark_prices              │
  upserts BTC closes ──▶│  (date, symbol, close_price)             │
  (NO change this phase)│  RLS: SELECT USING(true); write=service  │
                        └───────────────────┬─────────────────────┘
                                            │ server-side read (request-scoped client)
                                            ▼
                        ┌─────────────────────────────────────────┐
   browser fetch ──────▶│  GET /api/benchmark/btc   (NEW)          │
   (composer effect)    │  rows → sort asc → pct_change →          │
                        │  [{date, value}]  +  Cache-Control:      │
                        │  public, s-maxage=… (shared, cacheable)  │
                        └───────────────────┬─────────────────────┘
                                            │ {date,value}[] (BTC daily returns)
                                            ▼
  ScenarioComposer.tsx  ┌─────────────────────────────────────────┐
  ────────────────────  │  computeScenario(...)                    │
  (client)              │   → ComputedMetrics                      │
                        │   → NEW: portfolio_daily_returns[]       │  (full daily, dated)
                        └───────────────────┬─────────────────────┘
                                            │
              ┌─────────────────────────────┼───────────────────────────────┐
              ▼                             ▼                                 ▼
   ┌──────────────────┐      ┌──────────────────────────────┐    ┌────────────────────────┐
   │ scenario-        │      │ INNER-JOIN by date:          │    │ EquityChart.benchmark  │
   │ benchmark.ts     │◀────▶│ scenarioDates ∩ btcDates     │    │ (SVG widget overlay)   │
   │ (NEW pure TS)    │      │ → aligned p[], b[] (no fill) │    │ date-keyed, anchored   │
   │ TE/IR/α/β over n │      │ n = aligned length           │    │ to composite base      │
   └────────┬─────────┘      └──────────────┬───────────────┘    └────────────────────────┘
            │                               │
            ▼                               ▼
   ┌──────────────────┐      ┌──────────────────────────────┐
   │ evaluateSample   │      │ n ≥ 30 AND benchmark covers   │
   │ Floor(n, 30)     │─────▶│ window?                        │
   └──────────────────┘      └──────┬────────────────┬───────┘
                                 yes│              no │
                                    ▼                 ▼
                        ┌────────────────────┐  ┌───────────────────────────┐
                        │ "vs BTC over {N}…" │  │ EmptyStateCard            │
                        │ TE / IR / α / β    │  │ "Benchmark comparison     │
                        │ (Geist Mono, — for │  │  unavailable" + reason    │
                        │  null) + method.   │  │  (no-overlap vs <30-floor)│
                        └────────────────────┘  └───────────────────────────┘
```

### Component Responsibilities

| File | Responsibility | New or Edit |
|------|----------------|-------------|
| `src/app/api/benchmark/btc/route.ts` (suggested path) | Read `benchmark_prices` where `symbol='BTC'`, sort by date asc, pct_change → `[{date,value}]`, set cacheable header | NEW |
| `src/lib/scenario.ts` | Add full daily portfolio-returns + their dates to `ComputedMetrics` output (additive) | EDIT (additive) |
| `src/lib/scenario-benchmark.ts` (suggested name) | Pure-TS: inner-join by date, assemble `{trackingError, informationRatio, alpha, beta, correlation, n}` from the aligned arrays via the existing helpers | NEW |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | Fetch BTC series; compute aligned metrics; pass BTC `{date,value}[]` to `EquityChart.benchmark`; render metrics section or `EmptyStateCard` | EDIT |
| `src/lib/portfolio-stats.ts` | `computeAlphaBeta` + `computeTrackingError` — REUSE as-is | NO EDIT |

### Pattern 1: Date-keyed inner-join BEFORE positional metric helpers
**What:** `computeAlphaBeta` and `computeTrackingError` take two POSITIONAL arrays and zip them by index (`returns.slice(0,n)` / `benchmark.slice(0,n)` — `portfolio-stats.ts:416-420,448`). They do NOT align by date. The intersection MUST happen first.
**When to use:** Always, before calling either helper with the scenario + BTC series.
**Example:**
```typescript
// Source: mirrors analytics-service/routers/portfolio.py:915-916
//   aligned = portfolio_returns.reindex(benchmark.index).dropna()
//   b_aligned = benchmark.reindex(aligned.index).dropna()
// Pure-TS inner-join by date (NO zero-fill — the benchmark cannot be
// zero-filled the way the scenario UNION zero-fills late strategies):
function innerJoinByDate(
  port: { date: string; value: number }[],
  bench: { date: string; value: number }[],
): { dates: string[]; p: number[]; b: number[] } {
  const bMap = new Map(bench.map((d) => [d.date, d.value]));
  const dates: string[] = [];
  const p: number[] = [];
  const b: number[] = [];
  for (const d of port) {
    const bv = bMap.get(d.date);
    if (bv === undefined) continue; // intersection only
    dates.push(d.date);
    p.push(d.value);
    b.push(bv);
  }
  return { dates, p, b };
}
// Then: const n = p.length;  // the ALIGNED count — this is {N} in the heading
//       computeTrackingError(p, b); computeAlphaBeta(p, b);
//       const ir = te > 0 ? (mean(excessPB) * 252) / te : null;
```

### Pattern 2: Information ratio (reuse TE, never re-derive √252)
```typescript
// Source: analytics-service/services/metrics.py:811-814 (Python reference)
//   excess = aligned_returns - aligned_benchmark
//   te = excess.std() * np.sqrt(252)
//   info_ratio = excess.mean() * 252 / te   (only when te > 0)
const te = computeTrackingError(p, b);              // std(p-b) * sqrt(252)
const excessMean = mean(p.map((v, i) => v - b[i])); // mean(p-b)
const informationRatio = te > 0 ? (excessMean * 252) / te : null; // null → "—"
```

### Pattern 3: Cacheable shared-data GET route (contrast with no-store)
**What:** The benchmark series is shared market data, not tenant-scoped. The route reads via the SSR `createClient()` (which calls `cookies()`, making the handler request-scoped/dynamic — `force-static`/`use cache` do NOT apply here). Set a **response-level** `Cache-Control` header for CDN/browser caching instead of `NO_STORE_HEADERS`.
**Example:**
```typescript
// Source: src/app/api/strategies/browse/route.ts (analog read route) +
//         next/dist/docs/.../15-route-handlers.md (Route Handlers not cached
//         by default; reading the DB is dynamic — cache via response header).
import { createClient } from "@/lib/supabase/server";
export const runtime = "nodejs"; // AGENTS.md: SSR cookie client needs Node runtime

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("benchmark_prices")
    .select("date, close_price")
    .eq("symbol", "BTC")
    .order("date", { ascending: true });
  // ... error → 200 empty (degrades to the honest empty state, never a red alert) ...
  // pct_change → [{date, value}], drop the first (no prior close)
  return NextResponse.json(series, {
    status: 200,
    headers: {
      // Shared market data; refreshed ~daily by benchmark.py. A short
      // s-maxage with SWR is appropriate — NOT private/no-store.
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
```
> Note: pick the exact `s-maxage` at plan time. `benchmark.py` rejects cache older than 48h (`benchmark.py:113`) and upserts on a ~daily cadence; an hour of CDN cache is safely fresh. This is a discretion knob — the load-bearing requirement is "cacheable, public, not no-store."

### Anti-Patterns to Avoid
- **Passing the BTC series to `EquityCurve.benchmarkSeries`:** the composer renders `EquityChart` (SVG), not `EquityCurve`. Wrong component.
- **Reconstructing daily returns from `equity_curve`:** it is downsampled (every 5 days) and rounded — yields wrong dates and 5-day-block returns. Expose the full daily series from `computeScenario` instead.
- **Using the scenario's UNION date axis for alignment:** the union zero-fills late strategies (`scenario.ts:181-189`); the benchmark must be inner-joined with NO fill (Pitfall 2).
- **`force-static` / `use cache` on the route:** the SSR client reads `cookies()` (dynamic). Use a response `Cache-Control` header for caching, as the codebase already does for shareable data.
- **`role="alert"` / red / amber on the empty state:** insufficient/missing benchmark is honest absence, not an error (UI-SPEC Color invariant; #509).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| CAPM alpha/beta | A new OLS function | `computeAlphaBeta` (`portfolio-stats.ts:412`) | Already cov/var beta + annualized-CAPM alpha; already golden-tested (`portfolio-stats.test.ts:286-316`). |
| Tracking error | `std(excess)×√252` inline | `computeTrackingError` (`portfolio-stats.ts:444`) | Already correct + tested (`portfolio-stats.test.ts:319-343`). |
| Sample-floor gate | An `n < 30` check | `evaluateSampleFloor(n, 30)` (`sample-floor.ts:70`) | Guard-first (null/NaN/Infinity/negative never pass); discriminated verdict; clamps a bad floor. |
| Empty-state card | A new card | `EmptyStateCard` (`EmptyStateCard.tsx:23`) | Pins UI-SPEC tokens; no `role="alert"`; one source. |
| Methodology line | A literal string | `methodologyLine(n)` (`scenario-history.ts:41`) | Single source shared with the projection caveat; append the 252-note literal. |
| em-dash for null metric | A ternary on every value | `formatPercent`/`formatNumber` (`utils.ts:3,27`) | Already return "—" for null/non-finite. |
| Chart benchmark overlay | A new chart series | `EquityChart.benchmark` prop (`EquityChart.tsx:192,625-635`) | Already date-keyed, anchored, sliced, missing-day→null path-break. |
| Per-day portfolio returns | A re-weighted recompute | New additive output on `computeScenario` | The weighted/renormalized/leveraged sum already lives at `scenario.ts:219-236`; expose it, don't duplicate. |

**Key insight:** This phase has near-zero genuinely-new math. The risk is entirely in (a) routing to the right chart component, (b) sourcing the daily returns losslessly, and (c) inner-joining (not unioning) before the positional helpers.

## Common Pitfalls

### Pitfall 1: `computeScenario` does not expose daily portfolio returns
**What goes wrong:** A planner assumes `equity_curve` is the daily series. It is downsampled to every 5 business days and rounded to 5 decimals (`scenario.ts:404,407`). Reconstructing daily returns from it yields 5-day-block returns stamped at sparse dates — the inner-join with daily BTC dates collapses to a handful of points, and TE/IR/α/β are computed over the wrong window.
**Why it happens:** The internal `portDaily` array (`scenario.ts:221`, full daily, exact dates = `commonDates`) is never returned.
**How to avoid:** Add an additive output to `ComputedMetrics`, e.g. `portfolio_daily_returns: { date: string; value: number }[]` built from `commonDates[i]` + `portDaily[i]` (full resolution, unrounded), guarded the same way the engine guards the curve (suppress on the non-finite / `minCumulative<=0` early returns — `scenario.ts:281`). Additive ⇒ all `scenario.test.ts` pins hold.
**Warning signs:** `n` in the metrics heading is far smaller than `scenarioMetrics.n`; α/β look quantized.

### Pitfall 2: Union vs intersection (the headline trap)
**What goes wrong:** Using the scenario's union date axis (which zero-fills days a late-inception strategy isn't active — `scenario.ts:181-189`) as the left side of the join silently widens the comparison window and fabricates active return on zero-filled days.
**Why it happens:** The scenario engine deliberately unions+zero-fills strategy dates; the benchmark must NOT be zero-filled.
**How to avoid:** Inner-join scenario-daily-return dates ∩ BTC-daily-return dates with NO fill (Pattern 1). The aligned length is `{N}` in the heading. Mirror `portfolio.py:915-916`.
**Warning signs:** `{N}` ≈ the full scenario window even when BTC history is short; α/β suspiciously close to a single strategy's.

### Pitfall 3: Wrong chart component
**What goes wrong:** Wiring `benchmarkSeries` onto `EquityCurve.tsx`. The composer renders the SVG `EquityChart` (`ScenarioComposer.tsx:1437-1442`), which uses a different prop (`benchmark`) and a different (non-lightweight-charts) render path.
**How to avoid:** Pass the BTC `{date,value}[]` (cumulative-WEALTH-form, anchored — see note) to `EquityChart.benchmark`. The widget already anchors it to the composite first-positive base and re-emits values aligned to the visible composite dates with missing-day → null (`EquityChart.tsx:625-635`).
**Warning signs:** Lightweight-charts touched in the diff; a second BTC checkbox appears.

> **Benchmark form for the chart vs the math:** the chart's `benchmark` prop is anchored via `anchorFromFirstPositive` (`EquityChart.tsx:627`), which divides by the first value — so it expects a **cumulative** series (wealth-form, like the strategy line), NOT raw daily returns. The four METRICS use raw daily returns. So the route/lib should expose **daily returns** for the math, and the composer converts to a cumulative curve (`computeStrategyCurve`-style, `scenario.ts:444`) for the chart overlay. Two derived shapes from one daily-returns source. The planner must not feed raw daily returns to `EquityChart.benchmark`.

### Pitfall 4: Two empty-state reasons must not be conflated (#509)
**What goes wrong:** A single generic "unavailable" body when the real cause differs.
**How to avoid:** Branch the body: (a) **no overlap / window not covered** (intersection empty OR benchmark doesn't span the window) → "...doesn't cover this scenario's date window..."; (b) **overlap below the 30-day floor** (`evaluateSampleFloor(n,30).reason === "below-floor"`) → "...share {N} overlapping days... fewer than the 30 needed...". Heading "Benchmark comparison unavailable" stays constant; body names the specific reason. (Note: this phase uses a **30**-day floor passed explicitly — distinct from the module default `SAMPLE_FLOOR_OVERLAPPING_DAYS = 60`.)
**Warning signs:** Same body string for both branches; reusing the 60 default.

### Pitfall 5: Route transport failure must degrade to the empty state, not an error envelope
**What goes wrong:** A 500/red alert on the projection when the BTC fetch fails.
**How to avoid:** On route error OR fetch failure, the composer renders the SAME neutral "Benchmark comparison unavailable" empty state (and suppresses the overlay). UI-SPEC: "transport failures degrade to the same honest 'unavailable' empty state, never a red alert." The route can return `200` with an empty array on read error to keep this uniform.

## Runtime State Inventory

> This is a code/config + one-DB-read phase, NOT a rename/refactor/migration. No stored-state rewrite, no live-service reconfig, no OS registration, no secret rename, no build-artifact churn.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — `benchmark_prices` is READ-only here; written by `benchmark.py` (unchanged). No new table, no migration. | None — verified: no `supabase/migrations` change planned; `benchmark_prices` already exists + is in `database.types.ts:457`. |
| Live service config | None — no n8n/Datadog/Tailscale/Cloudflare touched. Railway deploy is a no-op (no analytics-service diff). | None — verified by CONTEXT lock + zero Python edits. |
| OS-registered state | None. | None. |
| Secrets/env vars | None new. Route reuses `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (already set; used by `server.ts`). | None — verified: anon key + existing RLS `SELECT USING(true)` suffices; no service-role key needed for a read. |
| Build artifacts | None. | None. |

## Code Examples

### Exposing daily portfolio returns from computeScenario (additive)
```typescript
// Source: derived from src/lib/scenario.ts:219-236 (portDaily) + :190 (commonDates)
// Add to ComputedMetrics (additive field; existing tests unaffected):
//   portfolio_daily_returns: { date: string; value: number }[];
// Built alongside the existing equity_curve, BEFORE downsampling:
const portfolio_daily_returns = commonDates.map((date, i) => ({
  date,
  value: portDaily[i],            // full resolution, unrounded
}));
// On every early-return that nulls the metrics (n<10, non-finite / minCumulative<=0),
// return `portfolio_daily_returns: []` so a degenerate scenario yields no false overlap.
```

### Assembling the four metrics over the aligned window
```typescript
// Source: portfolio-stats.ts:412 (computeAlphaBeta), :444 (computeTrackingError),
//         metrics.py:806-814 (Python reference for IR/correlation).
import { computeAlphaBeta, computeTrackingError } from "@/lib/portfolio-stats";
import { mean } from "@/lib/portfolio-math-utils";

export function computeScenarioBenchmark(
  portfolioDaily: { date: string; value: number }[],
  btcDaily: { date: string; value: number }[],
): {
  n: number;
  trackingError: number | null;
  informationRatio: number | null;
  alpha: number | null;
  beta: number | null;
  correlation: number | null;
} {
  const { p, b } = innerJoinByDate(portfolioDaily, btcDaily); // Pattern 1
  const n = p.length;
  if (n < 2) return { n, trackingError: null, informationRatio: null, alpha: null, beta: null, correlation: null };
  const te = computeTrackingError(p, b);
  const { alpha, beta } = computeAlphaBeta(p, b);
  const excessMean = mean(p.map((v, i) => v - b[i]));
  const ir = te > 0 ? (excessMean * 252) / te : null;
  // correlation: reuse the Pearson shape from scenario.ts:389 (sample cov / std·std)
  return { n, trackingError: te, informationRatio: ir, alpha, beta, correlation: /* pearson(p,b) */ 0 };
}
```
> The caller gates render on `evaluateSampleFloor(n, 30)` BEFORE showing these; the helper above can run unconditionally because each field is null-safe.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| quantstats `greeks()` reindex-with-bfill over the strategy's FULL range | inner-join (`align(join="inner")`) then `greeks()` on the aligned pair | metrics.py refactor (comment at :790-803) | Confirms the inner-join convention this phase mirrors; α/β and IR now share one window. The TS `computeAlphaBeta` already matches the inner-join `greeks` math (cov/var β, annualized α). |
| Route Handlers cached by default (older Next) | Route Handlers NOT cached by default; opt in per-GET (`dynamic='force-static'` or `use cache`); DB reads are dynamic → cache via response header | Next.js 15→16 | The benchmark route caches via `Cache-Control` response header, not route-config caching (the SSR cookie client makes it dynamic). [CITED: node_modules/next/dist/docs/.../15-route-handlers.md] |

**Deprecated/outdated:** None relevant. `EquityCurve.tsx`'s `benchmarkSeries` prop is NOT deprecated — it is simply the wrong component for the composer (used by the single-strategy v2 panel + factsheet, which DO use lightweight-charts).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Exact route path `/api/benchmark/btc` and the `s-maxage=3600` value are suggestions (Claude's Discretion per CONTEXT). | Pattern 3 / route file | None to correctness — load-bearing requirement is "public, cacheable, not no-store." Planner picks final path + TTL. |
| A2 | The chart overlay should be cumulative-WEALTH-form (anchored), derived from the same BTC daily-returns the metrics use, because `EquityChart.benchmark` runs `anchorFromFirstPositive` (divide-by-first). | Pitfall 3 note | If wrong (e.g. the widget were changed to accept raw returns), the overlay would render mis-scaled. Verified against `EquityChart.tsx:627` — anchoring confirms cumulative expectation. LOW risk. |

**Note:** Only 2 minor discretion/derivation assumptions — both flagged as Claude's Discretion in CONTEXT. No compliance/security/retention assumptions. Everything else is `[VERIFIED: source]`.

## Open Questions

1. **Chart overlay series form vs the metrics series form.**
   - What we know: metrics need raw daily returns; `EquityChart.benchmark` anchors (expects cumulative).
   - What's unclear: nothing blocking — the composer derives both from one daily-returns source.
   - Recommendation: route/lib returns daily returns; composer builds a cumulative curve for `EquityChart.benchmark` (mirror `computeStrategyCurve`) and feeds raw daily returns to `computeScenarioBenchmark`. Pin both with a test.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `benchmark_prices` table | BTC series read | ✓ | n/a | — (exists; migration `20260405093623` + RLS `20260406065011`) |
| RLS `SELECT USING(true)` on `benchmark_prices` | Authenticated read without service-role | ✓ | n/a | — (verified `20260406065011_security_hardening.sql:7-8`) |
| `benchmark_prices` in `database.types.ts` | Typed Supabase read | ✓ | n/a | — (`database.types.ts:457`) |
| Populated BTC rows | Non-empty series | ⚠ depends on environment | — | If empty in a given env (e.g. fresh test DB), the route returns `[]` → honest empty state. No block. |
| Node runtime for SSR cookie client | Route Handler | ✓ | `runtime="nodejs"` | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** Empty `benchmark_prices` in a non-prod env → route returns `[]` → "Benchmark comparison unavailable" empty state (correct, honest behavior).

## Validation Architecture

> nyquist_validation: treated as ENABLED (no `workflow.nyquist_validation: false` found in config).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^4.1.2 [VERIFIED: package.json] |
| Config file | `vitest.config.ts` (environment: `jsdom`, line 21) |
| Quick run command | `npx vitest run src/lib/scenario-benchmark.test.ts` |
| Full suite command | `npm test` (or `npm run test:coverage` for the CI gate) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| BENCH-01 | TE/IR/α/β match hand-computed goldens over a known pair | unit | `npx vitest run src/lib/scenario-benchmark.test.ts -t "golden"` | ❌ Wave 0 |
| BENCH-01 | Inner-join keeps ONLY intersection dates (no zero-fill widening) | unit | `npx vitest run src/lib/scenario-benchmark.test.ts -t "intersection"` | ❌ Wave 0 |
| BENCH-01 | `computeScenario` exposes full daily returns matching `portDaily` length+dates | unit | `npx vitest run src/lib/scenario.test.ts -t "daily_returns"` | ⚠ extend existing `scenario.test.ts` |
| BENCH-01 | n<30 aligned → below-floor verdict → empty state body names {N} | unit + component | `npx vitest run -t "below floor"` | ❌ Wave 0 |
| BENCH-01 | No overlap → "doesn't cover window" body (distinct from below-floor) | component | `npx vitest run -t "no overlap"` | ❌ Wave 0 |
| BENCH-01 | Null/non-finite single metric → em-dash "—" (no fabricated 0) | component | `npx vitest run -t "em-dash"` | ❌ Wave 0 |
| BENCH-01 | GET route returns `[{date,value}]` for BTC, sorted, pct-changed; public Cache-Control | route | `npx vitest run src/app/api/benchmark/btc/route.test.ts` | ❌ Wave 0 |
| BENCH-01 | Route read error → 200 empty array (degrades to empty state) | route | `npx vitest run src/app/api/benchmark/btc/route.test.ts -t "error"` | ❌ Wave 0 |
| BENCH-01 | Empty state has NO `role="alert"`, no red/amber | component | `npx vitest run -t "no alert"` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run src/lib/scenario-benchmark.test.ts src/lib/scenario.test.ts`
- **Per wave merge:** `npm test`
- **Phase gate:** full suite green + coverage gate (lines 82 / stmts 80 / fns 74 / branches 72 per CLAUDE.md) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `src/lib/scenario-benchmark.test.ts` — golden TE/IR/α/β + intersection + null-safety (covers BENCH-01 math/alignment)
- [ ] `src/app/api/benchmark/btc/route.test.ts` — series shape + sort + pct_change + cache header + error→empty (covers BENCH-01 read path)
- [ ] Extend `src/lib/scenario.test.ts` — assert the new `portfolio_daily_returns` field length/dates equal the internal daily axis, and is `[]` on the degenerate early-returns
- [ ] Component test (composer or an extracted metrics-section component) — both empty-state bodies + em-dash + no-`role="alert"` (covers BENCH-01 honesty UI)
- [ ] Golden fixtures: a small hand-computed `{p[], b[]}` pair with known β, α, TE, IR (compute by hand; mirror `portfolio-stats.test.ts:299-314`'s cov/var beta golden style)

## Security Domain

> security_enforcement: treated as ENABLED (no `false` in config).

### Tenant-data exposure analysis (the phase's only security-relevant surface)
The new GET route reads `benchmark_prices` — **shared, non-tenant market data** (BTC closes). It exposes NO user, allocator, strategy, holding, or cross-tenant data. Confirmed:
- The table has exactly three columns: `date`, `symbol`, `close_price` (`20260405093623_indexes_and_benchmark.sql:7-12`) — no `allocator_id`, no `user_id`, nothing tenant-scoped.
- RLS is enabled with `SELECT USING (true)` (any authenticated caller) and write restricted to `service_role` (`20260406065011_security_hardening.sql:4-19`). The route reads via the anon-key SSR client and CANNOT write.
- Therefore the route needs **no allocator auth** and **no `NO_STORE_HEADERS`**; a public/cacheable response is correct and leaks nothing. **`benchmark_prices` is NOT tenant-scoped** — no flag needed.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Route reads public market data; no auth secret involved. (May still sit behind the app's session, but auth is not load-bearing for correctness/security here.) |
| V3 Session Management | no | No session-scoped data read or written. |
| V4 Access Control | no (by design) | The data is intentionally world-readable-to-authenticated; RLS `SELECT USING(true)` is the deliberate control. No per-tenant access decision exists to get wrong. |
| V5 Input Validation | yes (minimal) | The route takes no user input (fixed `symbol='BTC'`). If a `?symbol=` param is ever added, validate against an allowlist — but CONTEXT locks BTC-only, so the route should hard-code `'BTC'` and accept no params. |
| V6 Cryptography | no | No crypto; reuse existing Supabase TLS transport. |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| SQL injection via a symbol param | Tampering | None needed — hard-code `'BTC'`; the Supabase client `.eq("symbol","BTC")` is parameterized regardless. Do NOT add a free-text symbol param. |
| Cross-tenant leak via a shared cache (the reason allocator routes use no-store) | Information Disclosure | N/A here — the data is identical for every caller, so a shared CDN cache leaks nothing. This is exactly WHY the route may be `public`-cached (contrast: tenant routes use `private, no-store`). |
| Write via the read route | Tampering | RLS blocks writes for non-`service_role`; the anon SSR client cannot insert/update/delete (`20260406065011:12-19`). Route exposes GET only. |
| Resource exhaustion (unbounded read) | DoS | `benchmark_prices` is ~1000 rows for BTC (capped by `benchmark.py days=1000`). A bounded `.order("date")` select is small; optionally `.limit(1100)`. Low risk. |

## Sources

### Primary (HIGH confidence — verified in live source this session)
- `src/lib/scenario.ts:132-454` — `computeScenario` builds `portDaily` (221) but returns only downsampled `equity_curve` (403-415); union+zero-fill axis (181-189); 252 convention (300,308); Pearson corr (389).
- `src/lib/portfolio-stats.ts:412-455` — `computeAlphaBeta` (cov/var β, annualized α ×252) + `computeTrackingError` (std(excess)×√252). Already match CONTEXT spec.
- `src/lib/portfolio-stats.test.ts:286-343` — existing golden tests for both (the test pattern to mirror).
- `src/lib/sample-floor.ts:37,70-88` — `evaluateSampleFloor` guard-first; default floor 60 (this phase passes 30).
- `src/components/ui/EmptyStateCard.tsx:23` — `{heading, body}`, no `role="alert"`, neutral.
- `src/lib/scenario-history.ts:41` — `methodologyLine(n)`.
- `src/lib/utils.ts:3,8,27,28` — `formatPercent`/`formatNumber` emit "—" for null/non-finite.
- `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx:190-246,506-520,625-655,1437` — SVG widget; `benchmark?: DailyPoint[]` prop; date-keyed anchor+slice; the composer mounts THIS, with `scenarioSeries` + `toWealth`.
- `src/components/charts/EquityCurve.tsx:15-31` — `benchmarkSeries` prop on the OTHER (lightweight-charts) component — NOT used by the composer.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:85,922-931,1437-1442` — imports `EquityChart`+`toWealth`; converts `equity_curve`→wealth; renders `EquityChart` (no `benchmark` prop today).
- `src/app/api/strategies/browse/route.ts` — analog read route (server client, `runtime="nodejs"`); uses `NO_STORE_HEADERS` because strategies are visibility-scoped (the contrast the benchmark route deliberately breaks).
- `src/lib/api/headers.ts` — `NO_STORE_HEADERS = { "Cache-Control": "private, no-store" }`.
- `src/lib/supabase/server.ts:6-29` — `createClient()` SSR factory (anon key, cookies).
- `src/lib/queries.ts:711-713,737-739` — existing `btc_benchmark_returns`/`benchmark_returns` are PER-STRATEGY (not a standalone series).
- `analytics-service/services/metrics.py:790-819` — Python reference: inner-join then `greeks`; IR=`excess.mean()×252/te`; the convention TS mirrors.
- `analytics-service/routers/portfolio.py:909-938` — `reindex(...).dropna()` inner-join + `>= 30` floor (the 30-day precedent).
- `analytics-service/services/benchmark.py:82-148` — `prices_to_returns` = `pct_change().dropna()`; populates `benchmark_prices`; 48h freshness reject (113). NO change needed.
- `supabase/migrations/20260405093623_indexes_and_benchmark.sql:6-12` — table shape (date,symbol,close_price; PK).
- `supabase/migrations/20260406065011_security_hardening.sql:3-19` — RLS enabled; `SELECT USING(true)`; write=service_role.
- `src/lib/database.types.ts:457` — `benchmark_prices` typed for Supabase reads.
- `node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md:49-89,124` — Route Handlers not cached by default; DB reads are dynamic; cache via response header.
- `package.json` — next ^16.2.3, react 19.2.4, lightweight-charts ^5.1.0, vitest ^4.1.2, @supabase/ssr ^0.10.0.

### Secondary (MEDIUM)
- `CLAUDE.md` / `AGENTS.md` — coverage gate thresholds; "read Next 16 docs before route/cache code"; explicit Node runtime.
- `vitest.config.ts:21` — jsdom env.

### Tertiary (LOW)
- None — no claim in this research rests on unverified WebSearch.

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Coverage gate is blocking** (lines 82 / stmts 80 / fns 74 / branches 72, `vitest.config.ts`). New lib + route + UI must carry tests to avoid regressing the ratchet.
- **Bump VERSION AND package.json together** (critical-regressions test). Surfaces at /ship, not in this phase's code, but the planner should note it for the commit task.
- **Next.js 16 is NOT the trained Next.js** (AGENTS.md) — read `node_modules/next/dist/docs/` before route/cache code. The route handler caching model is documented above [CITED].
- **DESIGN.md governs visuals** — UI-SPEC already pins them (Geist Mono numbers, `#94A3B8` benchmark line, neutral empty state, 2 weights). No new visual direction.
- **Always /ship to commit; never manual git commit** (memory). `.planning` is gitignored — RESEARCH.md is written, not committed (no-op).
- **Skip-Grok / Codex→Claude** for any adversarial pass.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every reused symbol verified at its line; no new package.
- Architecture / wiring: HIGH — read both candidate chart components + the composer mount; the EquityChart-vs-EquityCurve correction is verified, not assumed.
- Math correctness: HIGH — TS helpers' formulas read line-by-line and cross-checked against the Python reference + existing golden tests.
- Pitfalls: HIGH — each grounded in a specific source line (downsampling, union axis, anchoring).
- Security: HIGH — table shape + RLS policies read directly.

**Research date:** 2026-06-22
**Valid until:** 2026-07-22 (stable — in-repo primitives + a pinned framework; re-verify only if `scenario.ts`/`EquityChart.tsx`/`benchmark_prices` migrations change).
