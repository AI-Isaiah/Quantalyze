---
phase: 24-benchmark-comparison
verified: 2026-06-22T08:15:00Z
status: human_needed
score: 3/3
overrides_applied: 0
human_verification:
  - test: "Open the Scenario Composer tab with at least one active strategy; verify BTC Benchmark overlay toggles on/off on the EquityChart SVG"
    expected: "A second cumulative-wealth line (BTC, muted #94A3B8 colour) appears and disappears with the checkbox; EquityChart not EquityCurve receives the line"
    why_human: "Cannot confirm which React component instance receives the benchmark prop without a browser — static grep confirms EquityChart.benchmark is wired but visual rendering requires browser verification"
  - test: "With strategies whose history overlaps BTC benchmark data (>= 30 days), verify the ScenarioBenchmarkSection shows vs BTC over {N} overlapping days plus four metric rows (Tracking Error, Information Ratio, Alpha, Beta)"
    expected: "The heading contains the intersection count N (not the union/full window), four rows render with non-empty numeric values in Geist Mono, and the methodology line reads '... 252-day annualized active returns'"
    why_human: "The intersection vs union count and the live metric values require actual BTC data from the benchmark_prices table and a real scenario projection to verify"
  - test: "With strategies whose benchmark overlap is below 30 days, verify the below-floor empty state"
    expected: "EmptyStateCard heading 'Benchmark comparison unavailable' with body containing 'fewer than the 30 needed'; no role=alert; no metric rows visible"
    why_human: "Requires constructing a scenario with short history and confirming the exact body copy renders without an alert role"
  - test: "Disconnect network / simulate a failed /api/benchmark/btc fetch, then load the Scenario tab"
    expected: "ScenarioBenchmarkSection renders the no-overlap empty state ('doesn't cover this scenario's date window'); BTC overlay checkbox is disabled; no red alert or error UI"
    why_human: "Network-failure path requires browser DevTools to block the fetch and confirm the graceful degrade renders"
---

# Phase 24: Benchmark Comparison — Verification Report

**Phase Goal**: An allocator can see how the scenario projection performed against a benchmark over the aligned overlap window, with the standard active-return metrics.
**Verified**: 2026-06-22T08:15:00Z
**Status**: human_needed
**Re-verification**: No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | The scenario projection overlays a benchmark series (reusing `benchmark_prices`) aligned to the scenario's common-overlap window (INTERSECTION, not union) | VERIFIED | `innerJoinByDate` in scenario-benchmark.ts uses a Map-lookup that keeps only dates present in BOTH series — no zero-fill, no union. `ScenarioComposer.tsx:1516` passes `btcWealth` (derived via `computeStrategyCurve`) to `EquityChart.benchmark`. The intersection count `n` drives the heading in `ScenarioBenchmarkSection`. |
| 2 | The comparison surfaces TE / IR / alpha-beta over the aligned window using 252-day annualization (no √365 / monthly) | VERIFIED | `computeTrackingError` + `computeAlphaBeta` from `@/lib/portfolio-stats` (golden-tested at 252) are reused. IR computed as `(excessMean * 252) / te`. Alpha/beta use the same 252 convention via `computeAlphaBeta`. Golden test (`scenario-benchmark.test.ts:93-97`) explicitly asserts √365 would NOT match — so a √365 implementation would fail the test suite. No `365` token appears in scenario-benchmark.ts or route.ts. |
| 3 | When the benchmark series does not cover the scenario window (or is missing/below 30-day floor), an honest "Benchmark comparison unavailable" empty state renders | VERIFIED | Two distinct empty-state bodies confirmed in code: `NO_OVERLAP_BODY` (fetch fails / zero overlap: `benchmarkAvailable=false \|\| n===0`) and `belowFloorBody(n)` (below 30-day floor). Routing order is enforced in `ScenarioBenchmarkSection.tsx:107-113`. Tests in `ScenarioBenchmarkSection.test.tsx` assert each body is present AND the other is absent. No `role="alert"` anywhere in the file. |

**Score: 3/3 truths verified**

### Additional Must-Have Checks (Plan frontmatter)

| Check | Status | Evidence |
|-------|--------|---------|
| `computeScenario` exposes `portfolio_daily_returns?` as OPTIONAL | VERIFIED | `scenario.ts:128` — `portfolio_daily_returns?: Array<...>`. All three early-return paths set it to `[]` (lines 172, 225, 327). Main success path builds it at line 264 and includes it in the final return at line 463. |
| `scenario-benchmark.ts` exports `innerJoinByDate` + `computeScenarioBenchmark` | VERIFIED | Both exported at lines 63 and 97 respectively. |
| varB degeneracy guard (relative-scale, not exact `=== 0`) | VERIFIED | `benchmarkIsDegenerate` computed at lines 138-140 using `Math.sqrt(varB) <= 1e-12 * (Math.abs(meanB) + 1e-12)`. This fires BEFORE `computeAlphaBeta` is called. The comment at lines 120-136 explicitly explains why exact `=== 0` would miss float-residue cases. |
| IR degeneracy guard (relative-scale, not exact `te > 0`) | VERIFIED | `teIsDegenerate` at line 118 guards via `stdExcess <= 1e-12 * (Math.abs(excessMean) + 1e-12)`. |
| Null metrics render em-dash, never fabricated 0 | VERIFIED | All four metric rows flow through `formatPercent`/`formatNumber` (lines 129, 134, 139, 141). Both formatters return `"—"` for null. No `.toFixed()` or `+ "%"` on metric values in JSX. Test at `ScenarioBenchmarkSection.test.tsx:173-213` asserts `"—"` for constant-benchmark (beta=null, alpha=null) and checks absence of `"0.00"`. |
| GET /api/benchmark/btc returns `public` Cache-Control | VERIFIED | `CACHE_CONTROL = "public, s-maxage=3600, stale-while-revalidate=86400"` at route.ts:52. `NO_STORE_HEADERS` is not imported (grep returns 0). Route test at line 96-108 asserts `cc.toContain("public")` and `cc` does NOT contain `"no-store"`. |
| Route error degrades to 200 + `[]` (never 500) | VERIFIED | `emptyResponse()` helper at route.ts:54-59 returns `NextResponse.json([], {status: 200, ...})`. Called on DB error (line 79) and on `rows.length < 2` (line 86). Route test at line 110 asserts status 200 + body `[]` on simulated DB error. |
| Route coerces DECIMAL-as-string (PostgREST serialization) | VERIFIED | `Number(rows[i-1].close_price)` and `Number(rows[i].close_price)` at lines 102-103. Guards for `<= 0` and non-finite after coercion. |
| Composer wires `EquityChart.benchmark` (not EquityCurve) | VERIFIED | `ScenarioComposer.tsx:1516` — `benchmark={btcWealth}` on the `<EquityChart>` element. `computeStrategyCurve(btcDaily)` used to derive the cumulative-wealth form (line 641). Static grep confirms no new `EquityCurve` reference was introduced. |
| Methodology line stamps `{N}` and "252-day annualized active returns" | VERIFIED | `ScenarioBenchmarkSection.tsx:144` — `{methodologyLine(m.n)} Metrics are 252-day annualized active returns.` |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/app/(dashboard)/allocations/lib/scenario-benchmark.ts` | innerJoinByDate + computeScenarioBenchmark (INTERSECTION, 252-annualized, null-safe) | VERIFIED | 186 lines; both functions exported; imports `computeAlphaBeta`/`computeTrackingError` from portfolio-stats |
| `src/app/(dashboard)/allocations/lib/scenario-benchmark.test.ts` | Golden TE/IR/alpha/beta + intersection n===4 + null-safety | VERIFIED | 258 lines; golden with hand-computed expected values; intersection test proves non-overlapping dates are excluded; null tests for n<2, constant benchmark (beta/alpha null), te=0 (IR null) |
| `src/app/api/benchmark/btc/route.ts` | GET handler: BTC daily returns, public cache, error→200-empty, no tenant data | VERIFIED | 126 lines; runtime=nodejs; DECIMAL-string coercion; public Cache-Control; emptyResponse() on error |
| `src/app/api/benchmark/btc/route.test.ts` | shape/sort/pct_change/cache/error-degrade/no-tenant-keys tests | VERIFIED | 227 lines; covers all required cases |
| `src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.tsx` | Metrics section + two honest empty states + em-dash + no role=alert | VERIFIED | 149 lines; two distinct empty-state bodies; all metrics via formatPercent/formatNumber; no role=alert |
| `src/app/(dashboard)/allocations/components/ScenarioBenchmarkSection.test.tsx` | Both empty bodies + em-dash + no role=alert + N-in-heading tests | VERIFIED | 216 lines; distinct bodies asserted with mutual-exclusion checks; em-dash test with absence of "0.00" |
| `src/lib/scenario.ts` (additive field) | `portfolio_daily_returns?` OPTIONAL on ComputedMetrics; always set by computeScenario | VERIFIED | `?` present at line 128; set at 4 locations (172, 225, 327, 463); field is unrounded (portDaily values, not .toFixed'd) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| scenario-benchmark.ts | portfolio-stats.ts | import computeAlphaBeta + computeTrackingError | VERIFIED | Line 38: `import { computeAlphaBeta, computeTrackingError } from "@/lib/portfolio-stats"` |
| scenario-benchmark.ts | portfolio-math-utils.ts | import mean + DailyPoint | VERIFIED | Line 39: `import { mean, type DailyPoint } from "@/lib/portfolio-math-utils"` |
| route.ts | benchmark_prices | `.from('benchmark_prices').eq('symbol','BTC')` | VERIFIED | Lines 67-71 in route.ts |
| route.ts | Cache-Control: public | response header | VERIFIED | `CACHE_CONTROL = "public, s-maxage=3600..."` at line 52; applied to all responses |
| ScenarioComposer.tsx | /api/benchmark/btc | fetch in useEffect | VERIFIED | Line 598: `fetch("/api/benchmark/btc")` |
| ScenarioComposer.tsx | EquityChart.benchmark | cumulative-wealth via computeStrategyCurve | VERIFIED | `btcWealth = computeStrategyCurve(btcDaily)` at line 641; passed as `benchmark={btcWealth}` at line 1516 |
| ScenarioComposer.tsx | ScenarioBenchmarkSection | mount with portfolioDaily + btcDaily + benchmarkAvailable | VERIFIED | Lines 1575-1579; `portfolioDaily={scenarioMetrics.portfolio_daily_returns ?? []}` |
| ScenarioBenchmarkSection.tsx | scenario-benchmark.ts + sample-floor.ts + EmptyStateCard | computeScenarioBenchmark + evaluateSampleFloor + EmptyStateCard | VERIFIED | All three imported at lines 3-10 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| ScenarioBenchmarkSection | `m` (ScenarioBenchmark) | `computeScenarioBenchmark(portfolioDaily, btcDaily)` | Yes — portfolioDaily comes from computeScenario's portDaily (real weighted returns), btcDaily comes from the DB-backed /api/benchmark/btc route | FLOWING |
| ScenarioBenchmarkSection | `n` (overlap count) | `innerJoinByDate(portfolioDaily, btcDaily).p.length` | Yes — intersection of real series dates | FLOWING |
| EquityChart benchmark prop | `btcWealth` | `computeStrategyCurve(btcDaily)` where btcDaily is fetched from DB | Yes — pct-change of real benchmark_prices rows | FLOWING |
| route.ts | `series` | `benchmark_prices` table query | Yes — RLS `SELECT USING(true)`, real Supabase DB query | FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED — no running server available; all behavioral paths are covered by vitest unit tests (scenario-benchmark.test.ts, route.test.ts, ScenarioBenchmarkSection.test.tsx). Browser-round-trip is a human UAT item.

### Probe Execution

Step 7c: No probe scripts defined for Phase 24 in `.planning/phases/24-benchmark-comparison/` or `scripts/*/tests/`. Phase is TS-only (no migration, no Python path).

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| BENCH-01 | 24-01, 24-02, 24-03 | Scenario projection surfaces performance vs benchmark (TE / IR / alpha-beta over overlap window) | SATISFIED | All three plans shipped: scenario-benchmark.ts (math + alignment), /api/benchmark/btc (data path), ScenarioBenchmarkSection + composer wiring (UI); ROADMAP marks BENCH-01 Complete |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | No TBD/FIXME/XXX markers found in any of the 7 phase-24 files. No raw `.toFixed()`/`+ "%"` on metric values. No `return null` stubs. No hardcoded empty arrays passed where real data is expected. |

### Human Verification Required

Four items require a running browser session. All automated checks (unit tests: 258 + 227 + 216 lines of test coverage, typecheck, lint) passed per the commit history (6351+ green suite per SUMMARY claims, consistent with the code structure).

#### 1. BTC Overlay Toggle (Visual)

**Test:** Open the Scenario tab with an active strategy; check and uncheck the "BTC Benchmark" checkbox next to the chart.
**Expected:** A second line (muted, #94A3B8 colour) appears and disappears on the EquityChart SVG widget; the checkbox is disabled when the benchmark fetch returns empty.
**Why human:** Static grep confirms `EquityChart.benchmark={btcWealth}` is wired and `computeStrategyCurve` converts to cumulative-wealth form, but visual rendering of the SVG overlay requires a browser.

#### 2. Metrics Section with Live Overlap (Visual + Data)

**Test:** With strategies having >= 30 days of BTC-overlap history, load the Scenario tab and read the "vs BTC over {N} overlapping days" section.
**Expected:** Heading contains the actual intersection count (not the full scenario window length); four metric rows (Tracking Error, Information Ratio, Alpha, Beta) show plausible non-zero values in Geist Mono font; methodology line reads "... 252-day annualized active returns".
**Why human:** The intersection count and metric values depend on the live benchmark_prices table and real strategy daily_returns — not verifiable without a running app pointed at the DB.

#### 3. Below-Floor Empty State (Visual)

**Test:** Construct a scenario with strategies whose BTC overlap is 12-29 days; load the Scenario tab.
**Expected:** EmptyStateCard with heading "Benchmark comparison unavailable" and body containing "fewer than the 30 needed"; no role=alert visible; no metric rows.
**Why human:** Requires a specific short-history strategy configuration against live data.

#### 4. Network-Failure Degrade (Visual)

**Test:** In DevTools, block `GET /api/benchmark/btc`; load the Scenario tab.
**Expected:** The benchmark section shows "The BTC benchmark series doesn't cover this scenario's date window..."; the BTC checkbox is disabled; no red/amber alert UI.
**Why human:** Network blocking requires browser DevTools; the honest-degrade code path is verified in unit tests but visual confirmation is needed.

### Gaps Summary

No gaps. All three ROADMAP success criteria are VERIFIED by direct code inspection:

1. **Intersection alignment** — `innerJoinByDate` Map-lookup confirmed; union axis is only the LEFT input to the join, not the reported window; ScenarioBenchmarkSection uses the post-join `p.length` as `n`.
2. **252-day annualization** — reused helpers (`computeAlphaBeta`, `computeTrackingError`) confirmed; no `365` token in any phase-24 file; golden test explicitly falsifies a √365 implementation.
3. **Honest empty states** — two distinct body strings confirmed, routing order enforced (no-overlap before below-floor), no `role="alert"`, metrics null → em-dash via formatters.

The four human-verification items are visual/browser round-trip checks that cannot be resolved programmatically. They do not represent code gaps — the underlying logic is fully implemented and tested.

---

_Verified: 2026-06-22T08:15:00Z_
_Verifier: Claude (gsd-verifier)_
