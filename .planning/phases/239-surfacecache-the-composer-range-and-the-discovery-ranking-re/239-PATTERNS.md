# Phase 239: SURFACECACHE - Pattern Map

**Mapped:** 2026-11-24
**Files analyzed:** 11 (6 new, 5 modified; `StrategyTable.tsx` and `queries.ts` are deliberately NOT edited, Phase 238 owns them)
**Analogs found:** 11 / 11
**Cite rule:** symbols, not line numbers (the `plan-anchor-verify` job re-resolves `file:line`). All analogs below are git-tracked source (`git ls-files` checked on the three load-bearing ones; the rest are `src/` files).

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/dateday.ts` (+ `subtractMonths`) | utility | transform | same file: `parseIsoDay`, `utcEpoch`, `diffDays` | exact |
| `src/lib/dateday.test.ts` (+ arms) | test | transform | same file: `describe("parseIsoDay ...")` block | exact |
| `src/app/factsheet/[id]/v2/range-dates.ts` (NEW) | utility (pure resolver) | transform | `resolveRangeScope` in `basis-context.tsx` (pure, index-range in / range out); `dateday.ts` for header style | role-match |
| `src/app/factsheet/[id]/v2/range-dates.test.ts` (NEW) | test | transform | `src/lib/dateday.test.ts` (pure, no React) | role-match |
| `src/app/factsheet/[id]/v2/factsheet-context.tsx` | provider / store | event-driven (state) | itself: `userRange` / `setXRange` / `resetXRange` / `useXRange` | exact (modify) |
| `src/app/factsheet/[id]/v2/basis-context.tsx` (+ axis bridge) | provider | pub-sub (context) | itself: `BasisProvider` (`RangeGestureContext` is the sibling context-publish pattern) | exact (modify) |
| `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` | component | event-driven | itself: `PeriodControl`, `PERIOD_TRADING_DAYS` | exact (modify) |
| `src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx` | test | provider integration | itself: D-07 describe (`payloadOfLength`, `RangeProbe`, `tree`, `range()`) | exact (modify) |
| `src/lib/queries.native-unit-ranking.test.ts` (NEW) | test | request-response (mocked supabase) | `src/lib/queries.percentiles.test.ts` (cohort arm); `src/lib/queries.figure-record-report.test.ts` (`shapeRowAnalytics` arm via dynamic import) | exact |
| `src/components/strategy/StrategyTable.native-unit-ranking.test.tsx` (NEW) | test | component render | `src/components/strategy/StrategyTable.test.tsx` (`#n rank column` test + `native-unit chip` describe) | exact |
| `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.period-presets.test.tsx` (NEW, optional per RESEARCH Wave 0) | test | component | `scenario-shared-window.test.tsx`, `ScenarioFactsheetChart.opening-range.test.tsx` (same dir) | role-match |

## Pattern Assignments

### `src/lib/dateday.ts` + test (`subtractMonths`)

**Analog:** same file. Branded `IsoDay`, `pad2`, `parseIsoDay` (rejects rollover), `utcEpoch` (`Date.UTC`, timezone-stable). Header block documents "ONE module so the UTC-vs-local-midnight off-by-one becomes unrepresentable": add `subtractMonths` with a docblock in that voice, UTC arithmetic only (the research sketch uses UTC; `parseIsoDay` validates locally but never feeds the arithmetic).

**Validate-then-split pattern to copy** (`utcEpoch` / `parseIsoDay`):
```ts
const [y, m, d] = day.split("-").map(Number);
return Date.UTC(y, m - 1, d);
```
**Return-null-on-garbage convention:** `parseIsoDay` returns `IsoDay | null`; `subtractMonths` returns `IsoDay | null` the same way (unparsable day, non-integer or negative months -> null).

**Gotcha (research sketch is incomplete):** RESEARCH Pattern 5 calls `isoFromUtc(...)`, which does NOT exist in `dateday.ts`. Build the string with the existing private `pad2` (`` `${y}-${pad2(m)}-${pad2(d)}` as IsoDay ``), do not add a helper. Rule: clamp to last day of target month (31 Mar - 1M = 28 Feb; 29 Feb 2024 - 12M = 28 Feb 2023). Do NOT use `setMonth`/`setUTCMonth` (rollover; `CustomRangePicker.addMonths` is the rejected analog).

**Test pattern** (`dateday.test.ts`): `describe("<fn> - ...")` + `it("...(H-1231 ...)")`, plain `expect(fn("...")).toBe("...")` / `.toBeNull()`; add the named import to the existing import block from `"./dateday"`. Arm names the neuter table cites: "31 Mar - 1M is 28 Feb", "29 Feb 2024 - 12M is 28 Feb 2023".

---

### `src/app/factsheet/[id]/v2/range-dates.ts` (NEW, pure resolver)

**Analog:** `resolveRangeScope` in `basis-context.tsx` (pure function over index ranges, no React) for shape; `dateday.ts` for the "ISO strings compare chronologically" rationale. No React import, so `factsheet-context.tsx` stays free of extra tokens.

Core to implement (RESEARCH Pattern 1 and 2, copy verbatim): `StoredRange = {kind:"manual";start;end} | {kind:"preset";months}`; `resolveStoredRange(stored, axis, fullRange)` with the **strict off-axis rule** (`stored.start < axis[0] || stored.end > axis[last]` -> `fullRange`) so the existing shrunk-axis test stays `0-19` byte-unchanged; `lowerBound`/`upperBound` binary searches. Import `subtractMonths` from `@/lib/dateday`.

**Test analog:** `src/lib/dateday.test.ts` structure (pure vitest, no render). Pin: end > last -> full; start < first -> full; equality at either end on-axis; gappy-axis (weekends missing) index -> date -> index round trip; preset on a short series -> `[0, last]`; empty axis -> `fullRange`.

---

### `src/app/factsheet/[id]/v2/factsheet-context.tsx` (provider, modify)

**Analog:** itself.

**What exists to preserve (cite by symbol):**
- `type XRangeContextValue = { xRange; setXRange; resetXRange }` and `const XRangeContext = createContext<XRangeContextValue | null>(null)`: split-context design (header comment: "four narrow contexts"). Keep `xRange/setXRange/resetXRange` shape; add `setPresetRange(months)` additively.
- `const MIN_VISIBLE_SAMPLES = 5;` and the clamp block in `setXRange` (keep verbatim):
```ts
let [s, e] = next;
if (s < 0) s = 0;
if (e > maxIdx) e = maxIdx;
if (e - s < MIN_VISIBLE_SAMPLES - 1) e = Math.min(maxIdx, s + MIN_VISIBLE_SAMPLES - 1);
if (e - s < MIN_VISIBLE_SAMPLES - 1) s = Math.max(0, e - MIN_VISIBLE_SAMPLES + 1);
startTransition(() => setUserRange([s, e]));
```
- The three-term `maxIdx = Math.max(payload.dates.length, mark_to_market?.dates.length ?? 0, smoothed_mtm?.dates.length ?? 0) - 1` (kept as the write clamp).
- `fullRange = useMemo(() => [0, Math.max(0, payload.dates.length - 1)], [payload.dates.length])` stays cash-sized.
- `const resetXRange = useCallback(() => setUserRange(null), []);` stays a plain eager write (comment: not wrapped in `startTransition`).
- The `xRangeValue = useMemo<XRangeContextValue>(() => ({ xRange, setXRange, resetXRange }), [...])` memo and `useXRange()` hook (`useContext` + `throw new Error("useXRange must be used inside <FactsheetProvider>")`) are the error and memo pattern to copy for any new context/hook.
- Manual-memo dep comment ("React Compiler infers the smoothed dep at the `.dates` array level ... match its inference"): new `useCallback`/`useMemo` deps must follow it. Run `npm run lint` after the first edit.

**Change (RESEARCH Pattern 3):** replace `userRange` (indices) with `StoredRange | null` state; the derived `xRange = userRange && userRange[1] <= maxIdx ? userRange : fullRange` becomes `resolveStoredRange(stored, activeAxis, fullRange)` computed inside `useXRange()` (below `BasisProvider`) reading `ActiveAxisContext ?? payload.dates`. `setXRange` identity MUST follow the axis (it closes over it).

**Hard guards:** no word `dark` anywhere in this file, even in a comment (`src/__tests__/trim-removed-surfaces.test.tsx` scans `/\bdark\b/i`). No `localStorage|sessionStorage|document.cookie|history.push|location.|URLSearchParams` tokens in new code (the persistence effects already here are the only allowed site). The range stays out of `factsheetViewStateCodec` (Phase 193 D-02). Do not import `basis-context.tsx` (cycle: `basis-context.tsx` already imports `useXRange` from here); export `ActiveAxisContext` from this file instead.

---

### `src/app/factsheet/[id]/v2/basis-context.tsx` (axis bridge, modify)

**Analog:** same file. `BasisProvider` already renders only providers (no DOM element, GUARD-02 byte identity) and nests `BasisContext.Provider > RangeGestureContext.Provider`:
```tsx
const value = useMemo<BasisContextValue>(() => ({ basis, setBasis }), [basis]);
...
return (
  <BasisContext.Provider value={value}>
    <RangeGestureContext.Provider value={gesture}>{children}</RangeGestureContext.Provider>
  </BasisContext.Provider>
);
```
Add `usePayload()` + `const axis = useMemo(() => basisAxisDates(payload, basis), [payload, basis])` and wrap with `<ActiveAxisContext.Provider value={axis}>` (no effect + setState: `react-hooks/set-state-in-effect` is enforced and an effect adds a one-frame lag).

**`basisAxisDates` must mirror Layer 1 of `useBasisSeriesView`** (copy the selection exactly):
```ts
const bundle =
  basis === "mark_to_market" ? payload.seriesByBasis?.mark_to_market
  : basis === "smoothed_mtm" ? payload.seriesByBasis?.smoothed_mtm
  : undefined;
// ... if (basis === "cash_settlement" || !bundle) return payload;
```
Drift pin test (Wave 0): `basisAxisDates(payload, b)` equals `useBasisSeriesView(payload).dates` for cash, MTM with bundle, MTM without bundle (falls back to cash), smoothed. Place beside `basis-context.test.tsx` conventions (its "Test 7" GUARD-04 source scan still must pass).

---

### `ScenarioFactsheetChart.tsx` (`PeriodControl`, modify)

**Analog:** same file. Replace `PERIOD_TRADING_DAYS` (63/126/252; sole occurrence repo-wide, declaration plus one use in `selectPeriod`) with `PERIOD_MONTHS: Record<Exclude<ScenarioPeriod, "ALL">, number> = { "3M": 3, "6M": 6, "12M": 12 }`. Keep the guard branch and route presets through the additive setter:
```ts
const { setPresetRange, resetXRange } = useXRange();
const selectPeriod = (period: ScenarioPeriod) => {
  if (period === "ALL" || axisLength <= 1) { resetXRange(); return; }
  setPresetRange(PERIOD_MONTHS[period]);
};
```
Markup, classes, labels, `aria-selected={false}` on every tab stay byte-identical (UI-SPEC). Update the stale docblock ("most-recent N trading days") and the `scenario-shared-window.test.tsx` "~63 trading days" comment. Keep the literals `buildScenarioFactsheetPayload(` and `portfolioDaily` (`scenario-factsheet-parity-guard.test.ts` greps them). Do not touch `ScenarioComposer*.test.tsx` 3M/6M/12M hits (a different, rolling-window control).

---

### `factsheet-context.provider.test.tsx` (modify, D-07 describe)

**Analog:** same file, the D-07 describe: `payloadOfLength(n)` (UTC consecutive days from 2024-01-01 over `makePayload()`), `RangeProbe` (renders `${xRange[0]}-${xRange[1]}` and buttons `set` -> `setXRange([10, 40])`, `reset`), `tree(n)` = `<FactsheetProvider payload={...} persist={false}>`, `range()` reads `data-testid="range"`, growth via `rerender(tree(N))` inside `act(() => fireEvent.click(...))`.

**Changes:**
- Give `payloadOfLength` a start-date parameter (or add a sibling `payloadSpanning(n, startISO)`); add a `DatesProbe` printing `` `${dates[xRange[0]]}..${dates[xRange[1]]}` `` via `usePayload()` plus a `p12` button calling `setPresetRange(12)`.
- Re-pin "a range the user set is kept when the series grows ..." to DATES (indices alone pass before and after on back growth; it cannot go RED). Keep the `reset` -> `0-149` assertion.
- New RED-first arms: manual range keeps dates on FRONT growth (indices shift 10-40 -> 40-70); 12M preset ends on latest day after front growth; preset rolls to the new latest day on back growth.
- "SHRUNK axis falls back to `0-19`" stays byte-unchanged (the hard requirement behind the strict rule). "unset range follows the axis 3 -> 120" unchanged.

---

### `src/lib/queries.native-unit-ranking.test.ts` (NEW, CACHE-04 shape + cohort arms)

**Analog 1 (cohort arm):** `src/lib/queries.percentiles.test.ts`. Copy the hoisted resolver and the two mocks verbatim, then import after the mocks:
```ts
const strategiesResolver = vi.hoisted(() => ({ data: null as unknown, error: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain; chain.eq = () => chain;
    chain.then = (onFulfilled) => Promise.resolve({ data: strategiesResolver.data, error: strategiesResolver.error }).then(onFulfilled);
    return chain;
  } }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => ({}) }) }));
import { getPercentiles } from "./queries";
beforeEach(() => { strategiesResolver.data = null; strategiesResolver.error = null; });
```
Row shape: `{ id, strategy_analytics: { computation_status: "complete", max_drawdown, cagr, sharpe, sortino, calmar, volatility, cumulative_return } }`; `getPercentiles` returns `null` below 5 rows, so seed exactly five `complete` rows, one carrying `data_quality_flags: { native_unit: "BTC" }` with the highest raw `cagr`. Assert it is present and scored on its raw value (cagr percentile 100). The `getPercentiles` loop is `extractAnalytics` -> `isRankableAnalyticsRow` -> `kpiRecord` -> `scoreAgainstPopulation(rows, rows)`: unit-blind by construction.

**Analog 2 (shape arm):** `queries.figure-record-report.test.ts`: `const { shapeRowAnalytics } = await import("./queries");` then `shapeRowAnalytics({ computation_status: "complete", ... } as never, "s-1")`. For the pin: a BTC row (`native_unit: "BTC"`, `cagr: 0.9`, `cumulative_return: 3.2`) must come back with the same figures and `native_unit === "BTC"` (`shapeStoredAnalytics` only parses the unit via `shapedNativeUnit`).

Assert behaviour only (no projection bytes, no copy): `queries.percentile-columns.test.ts` already byte-pins the projection and is relied on, not duplicated. Neuters anchor by symbol (`shapeStoredAnalytics`; `getPercentiles` after `if (!isRankableAnalyticsRow(a)) continue;`).

---

### `src/components/strategy/StrategyTable.native-unit-ranking.test.tsx` (NEW, CACHE-04 table arm)

**Analog:** `StrategyTable.test.tsx`. `makeStrategy` / `makeAnalytics` are file-local (not exported), so copy them (incl. the default `series_end` = yesterday so rows stay current and a Phase 238 partition change cannot reorder them), plus the module stub and per-test setup:
```ts
vi.mock("@/components/discovery/SimulateImpactButton", () => ({ SimulateImpactButton: () => null }));
beforeEach(() => { installFetchMock(); try { window.localStorage.clear(); } catch {} });
afterEach(() => { restoreFetchMock(); });
```
(imports: `StrategyTable`, `installFetchMock/restoreFetchMock` from `@/test/helpers/fetch`, `userEvent`, `within`).

**Core pattern** (`describe("StrategyTable - v1.11 rank + percentile encoding")`, the `#n` test): click the CAGR header's button, read `document.querySelectorAll("tbody tr")`, assert `rows[0].textContent` contains `#1` and the name. For CACHE-04: set the BTC row `analytics.native_unit = "BTC"` with the top raw `cagr` beside USD rows; assert it is `#1`, order is by raw value, and the chip still renders (`nameCell.querySelectorAll("[data-returns-unit]")` has length 1, `getAttribute("data-returns-unit") === "BTC"`; chip pattern from `describe("StrategyTable - native-unit chip (164.6.6.2.1 D-05)")` `renderOne`). Neuter anchors by symbol: first statement inside `result.sort((a, b) => {` (occurs once).

---

### `ScenarioFactsheetChart.period-presets.test.tsx` (NEW, optional)

**Analog:** `scenario-shared-window.test.tsx` ("the SegmentedControl drives the shared window") and `ScenarioFactsheetChart.opening-range.test.tsx` (same directory): mount `ScenarioFactsheetChart` with a >12-month `portfolioDaily`, click a `role="tab"` period, assert the brush window labels. Read both before writing; mirror their mocks and fixture builders rather than inventing new ones.

## Shared Patterns

### PROOF-01 (every gate must be able to fail)
**Source:** RESEARCH "PROOF-01: concrete neuters" table. **Apply to:** every new test above. Backup outside the tree (`cp <file> "$SCRATCH/<name>.orig"`), neuter, run the single file with `-t "<arm>"`, paste the RED with the arm named, `cp` back, `cmp`, rerun GREEN. Never `git checkout/restore/stash`. SC-1 front-growth arms go RED on today's `factsheet-context.tsx` with no neuter needed (record that as the named-arm RED).

### Context hook error + memo convention
**Source:** `factsheet-context.tsx` `useXRange` / `xRangeValue` memo. **Apply to:** any new context or hook (`ActiveAxisContext` is the one deliberate exception: nullable with a `payload.dates` fallback, so provider tests and a `Grab` sibling outside `BasisProvider` stay cash-bound).

### Date handling
**Source:** `src/lib/dateday.ts`. **Apply to:** `subtractMonths`, `range-dates.ts`. UTC for math, `parseIsoDay` for validation, ISO strings compared lexicographically, no date library (none in `package.json`).

### Source-scan guards that read touched files
`trim-removed-surfaces.test.tsx` (`dark` token in `factsheet-context.tsx`), `basis-context.test.tsx` Test 7 (GUARD-04 storage/URL tokens), `scenario-factsheet-parity-guard.test.ts` (two literals in `ScenarioFactsheetChart.tsx`), `phase-52-frozen-spine-guards.test.ts` (none of the touched files are frozen any more). `ScenarioComposer.tsx` must keep zero `FactsheetBody` literals (not touched).

### Ship hygiene (not a code pattern, but every plan inherits it)
CHANGELOG entry plus byte-equal 4-digit `VERSION`/`package.json` bump in one `chore(release)` commit; delete the TODOS entries `201.1-COMPOSER-RANGE-AS-DATES` and `164.6.6.2.1-DISCOVERY-RANKING-HONESTY` in the same PR and name them in the CHANGELOG; never write the CI-skip tokens in a commit or PR body; no AI-authorship trailers; no home paths or PROD ids in tracked text.

## No Analog Found

None. The only novelty is `ActiveAxisContext` (a nullable fallback context). The nearest analog is `RangeGestureContext` in `basis-context.tsx` (`createContext<...|null>(null)` with a no-op fallback via `useContext(...) ?? NO_GESTURE`).

## Metadata

**Analog search scope:** `src/lib/`, `src/app/factsheet/[id]/v2/`, `src/app/(dashboard)/allocations/widgets/performance/`, `src/components/strategy/`
**Files read for excerpts:** `dateday.ts`, `dateday.test.ts` (head), `factsheet-context.tsx`, `basis-context.tsx` (provider and Layer 1), `ScenarioFactsheetChart.tsx`, `factsheet-context.provider.test.tsx` (D-07), `queries.percentiles.test.ts`, `queries.figure-record-report.test.ts`, `StrategyTable.test.tsx`, `queries.ts` (`getPercentiles`, `shapeStoredAnalytics`, `shapeRowAnalytics`)
**Pattern extraction date:** 2026-11-24
