# Phase 239: SURFACECACHE — the composer range and the Discovery ranking reflect the current truth - Research

**Researched:** 2026-11-24
**Domain:** React context state (factsheet range store) + calendar-date arithmetic + a no-change pin for Discovery ranking
**Confidence:** HIGH on CACHE-04 and on every in-repo anchor (all read this session); MEDIUM on the exact shape of the CACHE-02 implementation (a design recommendation, not yet run: the worktree has no `node_modules`, so no command in this file was executed)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**CACHE-04: BTC-unit and USD returns are ranked together as pure performance (founder ruling, 2026-11-24)**
- Q1 (how a BTC-unit strategy ranks beside USD strategies), founder answer verbatim: "That is correct, As BTC Strategies usually just have a different collateral."
- Q2 (percentiles), founder answer verbatim: "This is correct. Inportantly, When comparinh BTC to USaf Strategies. Dont include BTC Price conversion. Just compare pure Performance"
- Reading (coordinator's, confirmed): a BTC-unit strategy's returns are its pure performance on a different collateral. Today's behaviour is correct. Discovery's sort, its `#n` ordinals (`rankOrdinals`) and the percentile cohort (`getPercentiles`, `getOwnRowPercentiles`) keep comparing BTC-unit and USD returns side by side, in one population, with no BTC price conversion and no separate group.
- This overturns the CACHE-04 premise ("never ranks a BTC-unit return beside USD returns as if the two were comparable") and the TODOS gate ("its USD series, or a separate unit bucket … ⛔ Not a close: the chip alone"). CACHE-04 now reads: ranked together as pure performance, by founder ruling; the "in BTC" chip (`ReturnsUnitChip variant="compact"` in `StrategyTable.tsx`) stays.
- No copy changes. Q3 (copy for a separate group) is moot.
- A pin test is added only if it encodes the intended behaviour: no BTC price conversion happens when the Discovery list is built (a native-unit row's return reaches the sort and the percentile cohort unconverted, beside USD rows). It must be able to fail (PROOF-01): neuter by injecting a conversion or a unit partition into a byte copy, see RED, restore with `cp` and `cmp`, see GREEN.

**CACHE-02: presets roll, a manual range keeps its dates (founder ruling, 2026-11-24)**
- Q4 (what a preset does when a new latest day arrives), founder answer verbatim: "Presets roll, manual stays (Recommended)". A 3M/6M/12M preset stays relative and always ends on the latest day; a range the user sets by pan, brush, zoom or keyboard keeps its exact start and end dates when the series grows at either end.
- Q5 (what 12M covers), founder answer verbatim: "12 calendar months (Recommended)". It applies to 3M and 6M too: the preset spans latest date minus N calendar months to the latest date, replacing `PERIOD_TRADING_DAYS` (63/126/252 axis points) in `ScenarioFactsheetChart.tsx` `PeriodControl`.

### Claude's Discretion (reversible, decided by the phase agent)
- The range is held as `[startISO, endISO]` dates (or a preset intent for a rolling preset) in `FactsheetProvider` (`src/app/factsheet/[id]/v2/factsheet-context.tsx`, `userRange`) and resolved to axis indices against the active axis each render: start → first index on or after the start date, end → last index on or before the end date. If the stored dates fall off the axis, fall back to the full range, as the shrunk-axis case does today.
- The change is made in the shared provider, so the real factsheet's pan, zoom and brush also keep their dates on growth. No composer-only fork.
- The existing clamps in `setXRange` (three-axis max, `MIN_VISIBLE_SAMPLES`) and the basis-change reset in `FactsheetView` are kept.
- `factsheet-context.provider.test.tsx` "a range the user set is kept when the series grows" (grows at the back, asserts indices) is re-pinned to mean the same dates are kept (founder 2026-11-13 in the TODOS entry), and a new test grows the series at the FRONT and asserts both the manual range's dates and a 12M preset still ending on the latest day (SC-1).
- PROD trigger reading for CACHE-04, taken read-only 2026-11-24 via MCP (marker named PRODUCTION): 2 published strategies, 0 of them native-unit.

### Deferred Ideas (OUT OF SCOPE)
None.

Out of scope (CONTEXT `<domain>`): any Discovery copy change; any USD conversion of a native-unit strategy at list time; persisting the range anywhere (Phase 193 D-02 keeps `range` out of `factsheetViewStateCodec`); Phase 238 (parallel) owns the `computed_at` reader census in `StrategyTable.tsx` and `queries.ts`; no migration. UI-SPEC (approved): no visual change, no new copy, `PeriodControl` markup and ARIA byte-identical (`aria-selected={false}` on every tab, no active-tab state).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CACHE-02 | The composer stores its selected range as dates, so a 12M preset always ends on the latest day and keeps the same dates when the series grows at the front. | Section "CACHE-02 design": stored-range type, axis bridge in `BasisProvider`, pure resolver, `subtractMonths`, strict off-axis rule, test plan and PROOF-01 neuters. |
| CACHE-04 | (Re-scoped by founder ruling 2026-11-24) Discovery ranks BTC-unit and USD returns together as pure performance, no BTC price conversion at list build; the chip stays. | Section "CACHE-04": the list build is unit-blind by construction; a three-arm behaviour pin in two NEW test files that touch neither `queries.ts` nor `StrategyTable.tsx`. |
</phase_requirements>

## Summary

**CACHE-02.** `userRange` in `FactsheetProvider` holds axis indices, and `xRange` is `userRange` while `userRange[1] <= maxIdx`, else `fullRange`. The fix is to hold dates (manual) or a rolling intent (preset) and resolve to indices on read. The one non-obvious fact, and it shapes the whole design: **the provider cannot resolve "against the active axis", because it sits ABOVE `BasisProvider` and never learns the basis.** Every consumer (`TimeSeriesChart`, `MasterBrush`, `HistogramChart`, `useWindowedView`, `FactsheetBody`) indexes the ACTIVE basis view's `dates` (`useBasisSeriesView(...)`), which under mark-to-market or smoothed can be a different calendar from, and longer than, cash. Cash-only conversion is refuted by an existing test: `MasterBrush.basis.test.tsx` uses an MTM axis of 150 days dated 2031 against a cash axis of 100 days dated 2020, so index 149 has no cash date. Conversion therefore has to live BELOW `BasisProvider`.

**Recommended minimal design** (a refinement inside "Claude's Discretion", not a change to a locked decision): the provider stores a `StoredRange` (`{kind:"manual", start, end}` ISO days or `{kind:"preset", months}`); `BasisProvider` publishes the active axis dates through a tiny new `ActiveAxisContext` (computed with `useMemo` in the same render, no effect, no lag); `useXRange()` composes the raw store with that axis and returns the SAME `{ xRange, setXRange, resetXRange }` shape plus one additive `setPresetRange(months)`. **Zero consumer edits** apart from `PeriodControl`; with no `BasisProvider` above (provider tests, `scenario-factsheet-payload.pending.test.tsx`'s sibling `Grab`) the axis degrades to `payload.dates` (cash), which is exactly today's cash-index semantics.

**CACHE-04.** Today's behaviour already is the ruling. The percentile cohort never sees a unit (`percentileSelect` projects no `native_unit`, `kpiRecord` strips rows to the seven KPIs), and `StrategyTable`'s sort and `rankOrdinals` never read the unit (`native_unit` appears in `StrategyTable.tsx` exactly once, as the chip prop). The only `convertNativeReturnsToUsd` call sites in `queries.ts` are in `getOwnCapitalStrategies` and `getMyAllocationDashboard`, neither of which is on the Discovery path (`getStrategiesByCategory` + `getPercentiles`). A pin is worth adding: three small arms (shape, cohort, table order) in two NEW files; no edit to files Phase 238 touches.

**Primary recommendation:** Store `StoredRange` in the provider; bridge the active axis from `BasisProvider` via a new context; resolve in `useXRange()` with a pure `range-dates.ts` resolver (strict off-axis rule); add `subtractMonths` (UTC, clamp-to-month-end) to `src/lib/dateday.ts`; add `setPresetRange` and route `PeriodControl` through it; add the CACHE-04 pin as two new test files; do not edit `StrategyTable.tsx` or `queries.ts`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Selected-range storage (dates / preset intent) | Browser / Client (React context in `factsheet-context.tsx`) | — | Session-local view state; Phase 193 D-02 forbids persistence. |
| Active-axis publication | Browser / Client (`BasisProvider`) | — | Only `BasisProvider` knows the basis; the provider above it cannot. |
| Index↔date conversion + range resolution | Browser / Client (`useXRange` hook + pure resolver) | — | Must run below `BasisProvider`, per consumer render. |
| Calendar-month arithmetic | Browser / Client (`src/lib/dateday.ts`, pure) | — | One date module already owns calendar-day math (B12). |
| Discovery list sort, `#n` ordinals | Browser / Client (`StrategyTable.tsx`) | — | Unit-blind by construction; ruling = no change. |
| Percentile cohort | API / Backend (server `queries.ts`, `percentile-core.ts`) | — | Unit-blind by construction; ruling = no change. |

## Standard Stack

No new package is installed. The phase uses what the repo already has.

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| React (context, `useMemo`, `useCallback`, `startTransition`) | as installed | range store + axis bridge | The provider is already a split-context design (`factsheet-context.tsx` header). |
| `src/lib/dateday.ts` | in-repo | `IsoDay`, `parseIsoDay`, `utcEpoch` | The B12 module that owns calendar-day arithmetic (header: "calendar-day arithmetic on a branded `IsoDay`"). |
| vitest + @testing-library/react | per `package.json` (`"vitest": "^5.0.3"`) | tests | Existing harness. |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Axis bridge in `BasisProvider` | `setXRange(next, axisDates?)` plus per-consumer read-side resolution | Touches 7 `setXRange` call sites (5 in `TimeSeriesChart`, 2 in `MasterBrush`) and 5 readers. Rejected: larger blast radius, same result. |
| Pure helper `basisAxisDates(payload, basis)` for the bridge | `useBasisSeriesView(payload).dates` inside an inner bridge component | The view hook would start the levered derive from the bridge; the pure helper is cheaper. Pin the helper against the hook with an equality test (see Wave 0). |
| New `subtractMonths` in `dateday.ts` | `CustomRangePicker.addMonths` | Rejected: local-time `setMonth` with rollover (`src/app/(dashboard)/allocations/components/CustomRangePicker.tsx`, `function addMonths`); 31 Mar − 1M would become 3 Mar. |
| Date library | none | `grep -n -E "date-fns|dayjs|luxon|moment|temporal" package.json` returned nothing [VERIFIED: package.json grep, this session]. Do not add one. |

**Installation:** none.

## Package Legitimacy Audit

No external package is installed by this phase, so the gate is not applicable. **Packages removed due to [SLOP] verdict:** none. **Packages flagged [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
 user gesture (drag / wheel / keys / brush)            preset click (3M 6M 12M)         ALL / reset
        │ index pair on ACTIVE axis                         │ months                        │
        ▼                                                    ▼                               ▼
 TimeSeriesChart / MasterBrush ── setXRange([s,e]) ──┐   PeriodControl ── setPresetRange(n) ─┐   resetXRange()
                                                     ▼                                       ▼        │
                          useXRange()  (below BasisProvider; reads ActiveAxisContext, falls back to payload.dates)
                            ├─ existing clamps (three-axis max, MIN_VISIBLE_SAMPLES)         │        │
                            ├─ index → ISO date via the active axis                          │        │
                            └─ write StoredRange ─────────────────────────────────────────────┴────────┘
                                         │
                        XRangeContext (raw store, in FactsheetProvider): StoredRange | null
                                         │
 payload grows / basis flips / leverage changes ─► ActiveAxisContext (BasisProvider useMemo over payload+basis)
                                         ▼
                 resolveStoredRange(stored, axis, fullRange) ── memoised per [stored, axis, fullRange]
                    manual: strict off-axis → fullRange; else lowerBound(start) .. upperBound(end)-1
                    preset: boundary = subtractMonths(axis[last], months); lowerBound(boundary) .. last
                                         ▼
        xRange: readonly [number, number]  (indices into the ACTIVE axis) → TimeSeriesChart, MasterBrush,
        HistogramChart, useWindowedView, FactsheetBody (all unchanged)
```

### Recommended Project Structure
```
src/lib/dateday.ts                                   # + subtractMonths(day: IsoDay, months: number): IsoDay
src/lib/dateday.test.ts                              # + month-end clamp arms
src/app/factsheet/[id]/v2/range-dates.ts             # NEW pure module: StoredRange, resolveStoredRange, lowerBound/upperBound
src/app/factsheet/[id]/v2/range-dates.test.ts        # NEW pure tests (no React)
src/app/factsheet/[id]/v2/factsheet-context.tsx      # store StoredRange; ActiveAxisContext; useXRange composes; setPresetRange
src/app/factsheet/[id]/v2/basis-context.tsx          # BasisProvider publishes the active axis
src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx   # PERIOD_MONTHS + setPresetRange
src/lib/queries.native-unit-ranking.test.ts          # NEW (CACHE-04 shape + cohort arms)
src/components/strategy/StrategyTable.native-unit-ranking.test.tsx   # NEW (CACHE-04 table arm)
```
Keeping the resolver in its own file keeps `factsheet-context.tsx` free of the `\bdark\b` token and keeps the logic testable without React.

### Pattern 1: the stored range
```ts
// range-dates.ts (new). ISO "YYYY-MM-DD" strings compare chronologically (src/lib/dateday.ts header).
export type StoredRange =
  | { kind: "manual"; start: string; end: string }
  | { kind: "preset"; months: number };
```
`manual` is written by every `setXRange` (the whole "manual class": 5 call sites in `TimeSeriesChart`, 2 in `MasterBrush`). `preset` is written only by `setPresetRange`. `resetXRange` writes `null`.

### Pattern 2: the resolver (strict off-axis rule)
```ts
export function resolveStoredRange(
  stored: StoredRange | null,
  axis: readonly string[],
  fullRange: readonly [number, number],
): readonly [number, number] {
  if (!stored || axis.length === 0) return fullRange;
  const last = axis.length - 1;
  if (stored.kind === "preset") {
    const boundary = subtractMonths(axis[last], stored.months); // null when axis[last] is not a real day
    if (boundary === null) return fullRange;
    return [lowerBound(axis, boundary), last];                  // short series: lowerBound -> 0 = full window
  }
  // STRICT: either stored date outside [axis[0], axis[last]] is off-axis -> full range.
  if (stored.start < axis[0] || stored.end > axis[last]) return fullRange;
  const s = lowerBound(axis, stored.start);        // first index with axis[i] >= start
  const e = upperBound(axis, stored.end) - 1;      // last index with axis[i] <= end
  return s <= e ? [s, e] : fullRange;
}
```
**Why strict, and why it is not optional.** The literal CONTEXT rule ("first on or after / last on or before") gives a WRONG answer for the existing pinned shrunk-axis test. `payloadOfLength(120)` runs 2024-01-01 onward one day per index, so `setXRange([10, 40])` is 2024-01-11 to 2024-02-10. On the 20-day axis (2024-01-01 to 2024-01-20) the literal rule gives `10-19`; the test pins `0-19` (`factsheet-context.provider.test.tsx`, "falls back to the current full range"). The strict rule (end after the axis's last day, or start before its first day, falls back) mirrors today's `userRange[1] <= maxIdx ? userRange : fullRange` and leaves that test byte-unchanged. Pin both boundaries in `range-dates.test.ts`: `end > axis[last]` → full; `start < axis[0]` → full; exact equality at either end is on-axis.

`lowerBound` / `upperBound` are standard binary searches over the ascending ISO strings. No `MIN_VISIBLE_SAMPLES` widening at resolve time: growth only adds points, so a range that had ≥5 samples keeps them, and a range that lost them off the axis already fell back. (Decision for the planner: "do not widen at resolve".)

### Pattern 3: the hook
```ts
// factsheet-context.tsx (shape only)
const RangeStoreContext = createContext<RangeStore | null>(null);      // FactsheetProvider provides
export const ActiveAxisContext = createContext<readonly string[] | null>(null); // BasisProvider provides

export function useXRange(): XRangeContextValue {
  const store = useContext(RangeStoreContext);
  if (!store) throw new Error("useXRange must be used inside <FactsheetProvider>");
  const axis = useContext(ActiveAxisContext) ?? store.cashDates;
  const xRange = useMemo(() => resolveStoredRange(store.stored, axis, store.fullRange), [store.stored, axis, store.fullRange]);
  const setXRange = useCallback(/* existing clamps on (s,e), then
        const si = Math.min(s, axis.length - 1), ei = Math.min(e, axis.length - 1);
        startTransition(() => store.write({ kind: "manual", start: axis[si], end: axis[ei] })) */, [...]);
  const setPresetRange = useCallback((months: number) => store.write({ kind: "preset", months }), [store]);
  return useMemo(() => ({ xRange, setXRange, resetXRange: store.reset, setPresetRange }), [...]);
}
```
- **`setXRange` identity MUST follow the axis** (it closes over `axis`). `MasterBrush.basis.test.tsx`'s `XRangeDriver` lists `setXRange` in its effect deps, and its driver effect runs in the same commit as `BasisSetter`, i.e. while the axis is still cash. The axis flip re-creates `setXRange`, the effect re-fires, and the write lands on the MTM axis. If a refactor made `setXRange` identity axis-independent, those arms would go RED for a real reason.
- **The existing three-term `maxIdx` clamp stays verbatim** (CONTEXT). The extra `Math.min(·, axis.length - 1)` only guards the date lookup. Empty axis: do nothing (no throw, no write).
- **`xRange` must be memoised** on `[stored, axis, fullRange]`: `TimeSeriesChart` keys `useMemo` on it (`[config, view, cmp, xRange]`), `useWindowedView` runs it through `useDeferredValue`, and the window-gesture tests assert on its identity.
- **`fullRange` stays cash-sized** (`[0, Math.max(0, payload.dates.length - 1)]`), so `resolveRangeScope`'s full-history rule (`s === 0 && e >= fullEnd`) is unchanged under every basis.
- **No effect + setState to sync the axis**: `react-hooks/set-state-in-effect` is enforced (the file already carries one `eslint-disable-next-line` for hydration) and an effect would add a one-frame lag.

### Pattern 4: the bridge in `BasisProvider`
`BasisProvider` (`basis-context.tsx`, `export function BasisProvider`) already imports from `./factsheet-context` (`import { useXRange } from "./factsheet-context";`), so `factsheet-context.tsx` must NOT import `basis-context.tsx` (cycle). Export `ActiveAxisContext` from `factsheet-context.tsx` and provide it from `BasisProvider`:
```ts
// basis-context.tsx — pure helper, same selection as Layer 1 of useBasisSeriesView
export function basisAxisDates(payload: FactsheetPayload, basis: Basis): readonly string[] {
  const bundle = basis === "mark_to_market" ? payload.seriesByBasis?.mark_to_market
               : basis === "smoothed_mtm" ? payload.seriesByBasis?.smoothed_mtm : undefined;
  return basis === "cash_settlement" || !bundle ? payload.dates : bundle.dates;
}
```
`BasisProvider` calls `usePayload()` and wraps children in `<ActiveAxisContext.Provider value={useMemo(() => basisAxisDates(payload, basis), [payload, basis])}>`. Leverage does not change dates (the levered view re-derives over the same `base.dates`). The provider still renders no DOM element (GUARD-02 byte identity).
- **GUARD-04**: `basis-context.test.tsx` "Test 7" greps the comment-stripped source for `localStorage|sessionStorage|document\.cookie|history\.(push|replace)|location\.|URLSearchParams`. The bridge adds none of these tokens; do not write them in code.
- **Drift pin (Wave 0)**: a test asserting `basisAxisDates(payload, b)` equals `useBasisSeriesView(payload).dates` by value for cash, MTM-with-bundle, MTM-without-bundle (falls back to cash) and smoothed. Neuter by changing one arm of the helper.

### Pattern 5: calendar-month subtraction (Q2)
```ts
// src/lib/dateday.ts (new export)
export function subtractMonths(day: IsoDay | string, months: number): IsoDay | null {
  const d = parseIsoDay(day);                      // rejects 2024-02-31 and non-days
  if (d === null || !Number.isInteger(months) || months < 0) return null;
  const [y, m, dd] = d.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1 - months, 1));          // 1st of the target month, UTC
  const dim = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  return isoFromUtc(first.getUTCFullYear(), first.getUTCMonth() + 1, Math.min(dd, dim));
}
```
**Rule: clamp to the last day of the target month.** 31 Mar − 1M = 28 Feb (29 in a leap year); 29 Feb 2024 − 12M = 28 Feb 2023; 31 Aug − 6M = 28 Feb 2026 (31 Aug 2026 − 6M = 28 Feb 2026); 30 Jun − 3M = 30 Mar. JS `setUTCMonth(m - n)` overflows instead (31 Mar − 1M becomes 3 Mar) and is the trap. The boundary is INCLUSIVE: the window starts at the first axis date on or after the boundary. Dates in `payload.dates` are ISO `YYYY-MM-DD` strings (the brush prints them through `formatDay`, which reads a non-date as "—"; `MasterBrush.basis.test.tsx` fixtures build them with `toISOString().slice(0, 10)`). `parseIsoDay` uses local `new Date(y, m-1, d)` for validation only; the arithmetic above is UTC, so it is timezone-stable. An unparsable latest day returns `null` and the preset falls back to the full range.

### Pattern 6: `PeriodControl`
Replace `PERIOD_TRADING_DAYS` with `PERIOD_MONTHS` and route presets through the additive setter (UI-SPEC: a preset must NOT go through manual `setXRange`):
```ts
const PERIOD_MONTHS: Record<Exclude<ScenarioPeriod, "ALL">, number> = { "3M": 3, "6M": 6, "12M": 12 };
const selectPeriod = (period: ScenarioPeriod) => {
  if (period === "ALL" || axisLength <= 1) { resetXRange(); return; }   // unchanged
  setPresetRange(PERIOD_MONTHS[period]);
};
```
Markup, classes, labels, `aria-selected={false}` stay byte-identical. Update the stale docblock text ("most-recent N trading days") in the same file.

### Anti-Patterns to Avoid
- **Resolving against `payload.dates` only.** Wrong under MTM or smoothed (refuted above).
- **Registering the active axis from an effect** (`useEffect(() => setAxis(...))`): lint error and a one-frame lag.
- **Registering a preset through `setXRange`**: it would be stored as manual and never roll.
- **Literal "first on/after, last on/before" for the shrunk case**: flips the pinned `0-19` to `10-19`.
- **Writing the word `dark` in `factsheet-context.tsx`**, even in a comment: `src/__tests__/trim-removed-surfaces.test.tsx` ("factsheet-context.tsx carries no `dark` token") scans it with `/\bdark\b/i`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Calendar-day parse/validate | a regex | `parseIsoDay` in `src/lib/dateday.ts` | Rejects `2024-02-31`; rollover is the H-1231 class. |
| Month subtraction | `setMonth` / `setUTCMonth` arithmetic | the new clamping `subtractMonths` | Overflow (31 Mar − 1M → 3 Mar). |
| Index ↔ date mapping | per-consumer conversion | the single `useXRange` + `resolveStoredRange` | Seven writers and five readers must agree. |
| Full-history detection | a new rule | `resolveRangeScope` in `basis-context.tsx` | Already derives `Full history` vs `Selected range` from resolved indices. |

## Runtime State Inventory

Not a rename/refactor/migration phase. For completeness, the one category that could apply:
| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — the range is never persisted (Phase 193 D-02; `factsheetViewStateCodec.encode` drops `range`). `PersistedState.range` stays decode-only. | none |
| Live service config / OS-registered state / Secrets / Build artifacts | None — client-only React state. | none |

## Consumer map (Q1): every `useXRange` / `xRange` reader and writer

All of them index the ACTIVE basis view's axis. Under cash that equals `payload.dates`.

| Consumer (file : symbol) | Reads | Emits | Axis it indexes |
|---|---|---|---|
| `factsheet-context.tsx` : `FactsheetProvider` | owns `userRange`; `fullRange = [0, max(0, payload.dates.length - 1)]` | — | cash for `fullRange`; three-term max for the write clamp |
| `TimeSeriesChart.tsx` : `TimeSeriesChart` | `xRange`; `n = view.dates.length` (`view = useBasisSeriesView(payload)`) | `setXRange` ×5 (drag-zoom, drag-pan, wheel, x-pull, keyboard), `resetXRange` (double-click, `Home`, `Esc`) | active view axis |
| `MasterBrush.tsx` : `MasterBrush` | `xRange`; `n = payload.dates.length` where `payload = useBasisSeriesView(usePayload())` | `setXRange` ×2 (drag pan/left/right/select, re-anchor), `resetXRange` (double-click) | active view axis |
| `HistogramChart.tsx` : `HistogramChart` | `const [xStart, xEnd] = xRange`, indexes the view's `strategyReturns` and the view comparator | — | active view axis |
| `MetricsColumn.tsx` | `resetXRange` only (`Reset to full history`) | `resetXRange` | n/a |
| `FactsheetView.tsx` : `FactsheetBody` | `resolveRangeScope(xRange, payload.dates.length, view)` (the "zoomed" gate) | — | active view axis |
| `FactsheetView.tsx` : header controls | — | `resetXRange` on an ACTUAL basis toggle (`prevBasisRef`), on a unit-view toggle (`prevUnitViewRef`), and `resetView` | n/a |
| `basis-context.tsx` : `useWindowedView` | `useDeferredValue(useXRange().xRange)` (or the held gesture range), `resolveRangeScope(range, payload.dates.length, base)` | — | active view axis |
| `ScenarioFactsheetChart.tsx` : `PeriodControl` | — | `setXRange` (to be replaced by `setPresetRange`), `resetXRange` | cash (the composer payload has no `seriesByBasis` / `mtmGate`) |

`chart-configs.ts` and `scenario-factsheet-payload.ts` only mention `xRange` in comments. A basis toggle resets the range (`FactsheetView.tsx`, two `resetXRange()` effects), so index spaces never mix across bases today; with dates, the one-frame window between the flip and the reset effect resolves the OLD basis's dates against the NEW axis and falls back to the full range (strict rule) or lands on a coherent date window, never on out-of-bounds indices.

## Common Pitfalls

### Pitfall 1: the provider cannot see the basis
**What goes wrong:** converting indices to dates with `payload.dates` mislabels or loses every MTM/smoothed range (index 149 on a 100-day cash axis).
**How to avoid:** the `ActiveAxisContext` bridge. **Warning sign:** `MasterBrush.basis.test.tsx` widened-clamp arms RED.

### Pitfall 2: shrunk axis under the literal rule
See Pattern 2. **Warning sign:** the shrunk-axis test reading `10-19`.

### Pitfall 3: the back-growth test cannot go RED on today's code
Back growth keeps indices identical either way, so `expect(range()).toBe("10-40")` passes before and after. The re-pinned test must print DATES (a probe rendering `payload.dates[xRange[0]]` and `payload.dates[xRange[1]]`); the RED gates are the FRONT-growth arms. `payloadOfLength` (`factsheet-context.provider.test.tsx`, inside the D-07 describe) always starts at 2024-01-01 and extends at the back, so it needs a start-date parameter (or a sibling `payloadEndingAt(n, endISO)`).

### Pitfall 4: `useXRange` identity and React Compiler
`factsheet-context.tsx` carries a manual-memo comment: "React Compiler infers the smoothed dep at the `.dates` array level (not `.dates.length`); match its inference so manual memoization is preserved." New `useCallback`/`useMemo` deps must match the compiler's inference or `react-hooks/preserve-manual-memoization` fails lint. Run `npm run lint` right after the first edit, not at the end.

### Pitfall 5: duplicate or non-increasing axis dates
`lowerBound`/`upperBound` assume a strictly increasing ISO axis (composites use a calendar-dense axis, still increasing). A duplicate date would shift a pan by the number of duplicates on each index→date→index round trip. Pin the round trip on a GAPPY axis (weekends missing): `[s, e]` → dates → the same `[s, e]`.

### Pitfall 6: hand-built payloads in the 25 `xRange`-using test files
About 110 test files mount `FactsheetProvider`, and 25 touch `xRange`/`setXRange` (`grep -rln -E "xRange|setXRange|useXRange" src --include='*.test.*'`). Resolution only runs when a range is SET, so unset-range tests are inert. A test that sets a range on a hand-built payload whose `dates` is empty, shorter than the driven index, or not ISO would now write nothing or compare nonsense. Run the whole group first (Validation Architecture) and fix fixtures, not production code.

### Pitfall 7: `ScenarioComposer*.test.tsx` 3M/6M/12M hits are a DIFFERENT control
`ScenarioComposer.d11.test.tsx` (`pickWindow("3M")`, labels `["3M","6M","12M","365D"]`) and `ScenarioComposer.test.tsx` (the rolling-window toggle, "3M (63)") belong to the rolling-window selector, not `PeriodControl`. Do not touch them. `PERIOD_TRADING_DAYS` appears in exactly one file: `grep -rn "PERIOD_TRADING_DAYS" src` returned only `ScenarioFactsheetChart.tsx` (declaration at line 62, use at line 152) [VERIFIED: grep, this session]. No test pins the old 63/126/252 windows.

### Pitfall 8: source-scan guards that read the touched files
- `src/__tests__/phase-52-frozen-spine-guards.test.ts`: `factsheet-context.tsx`, `TimeSeriesChart.tsx`, `HistogramChart.tsx`, `MasterBrush.tsx` were REMOVED from `FROZEN_ISLANDS` (comments at lines 208-257 of that file: "`factsheet-context.tsx` is REMOVED from the frozen set"). `basis-context.tsx` is not frozen either. No carve-out is needed.
- `scenario-factsheet-parity-guard.test.ts` reads `ScenarioFactsheetChart.tsx` and asserts it contains `buildScenarioFactsheetPayload(` and `portfolioDaily`. Keep both literals.
- `ScenarioComposer.test.tsx` static guard: `ScenarioComposer.tsx` must contain the literal `FactsheetBody` zero times. This phase does not touch `ScenarioComposer.tsx`.
- `scenario-factsheet-payload.pending.test.tsx` grabs `setXRange` from a `Grab` sibling OUTSIDE `BasisProvider` (cash-bound), zooms `[280, 399]`, then swaps the payload (same dates) and expects the zoom kept. Works unchanged: same dates, same axis. Its `useEffect` lists `[setXRange]`, which tolerates the identity change.

## Code Examples

The existing contracts being preserved (read this session):

```ts
// factsheet-context.tsx:77
const MIN_VISIBLE_SAMPLES = 5;
// factsheet-context.tsx:224
const xRange = userRange && userRange[1] <= maxIdx ? userRange : fullRange;
// factsheet-context.tsx:218-223 (the three-term max, also inside setXRange at 245-256)
const maxIdx =
  Math.max(
    payload.dates.length,
    payload.seriesByBasis?.mark_to_market?.dates.length ?? 0,
    payload.seriesByBasis?.smoothed_mtm?.dates.length ?? 0,
  ) - 1;
// ScenarioFactsheetChart.tsx:62-66 (to be replaced)
const PERIOD_TRADING_DAYS: Record<Exclude<ScenarioPeriod, "ALL">, number> = {
  "3M": 63,
  "6M": 126,
  "12M": 252,
};
```

### New provider tests (sketch)
```tsx
// factsheet-context.provider.test.tsx, inside the D-07 describe
function payloadSpanning(n: number, startISO: string): FactsheetPayload { /* UTC consecutive days from startISO */ }
function DatesProbe() {
  const { xRange, setXRange, setPresetRange } = useXRange();
  const { dates } = usePayload();
  return (<>
    <span data-testid="dates">{`${dates[xRange[0]]}..${dates[xRange[1]]}`}</span>
    <button data-testid="set" onClick={() => setXRange([10, 40] as const)} />
    <button data-testid="p12" onClick={() => setPresetRange(12)} />
  </>);
}
// manual, FRONT growth: 120 days from 2024-01-01 → set [10,40] = 2024-01-11..2024-02-10;
//   rerender 150 days from 2023-12-02 (30 earlier days): dates probe still 2024-01-11..2024-02-10 (indices now 40-70)
// manual, BACK growth: same dates after 150 days from 2024-01-01 (re-pinned test prints dates, not just "10-40")
// 12M preset on a 500-day series: end = latest day; grow at the FRONT: end still the latest day, start date unchanged
//   (series already spanned 12 months); grow at the BACK by 30 days: end = the NEW latest day (it rolled)
// preset on a series shorter than 12 months: window = full range, eyebrow `Full history`
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `userRange` = axis indices | `StoredRange` dates / preset intent, resolved per render on the active axis | this phase | Same dates survive front growth; presets roll to the latest day. |
| 3M/6M/12M = 63/126/252 axis points (`endIdx - days`, i.e. days+1 points) | N calendar months ending on the latest day, boundary inclusive | this phase (founder Q5) | A 12M window now holds the points from (latest − 12 months) through latest; gaps (weekends) no longer shorten it. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `basisAxisDates` (cash → `payload.dates`; MTM/smoothed → bundle dates, falling back to `payload.dates` when the bundle is absent) matches `useBasisSeriesView` Layer 1 for every basis. Read this session in `basis-context.tsx` Layer 1 (`const bundle = ...` and `if (basis === "cash_settlement" \|\| !bundle) return payload;`); the Wave 0 drift pin makes it checkable. | Pattern 4 | A wrong axis would mis-resolve ranges under that basis; caught by the pin. |
| A2 | Leverage never changes `dates` (levered view re-derives over `base.dates`). Read in the Layer 2 code (`levered = base.strategyReturns.map((r, i) => ({ date: base.dates[i], ... }))`), not run. | Pattern 4 | A leverage-dependent axis would need the bridge to read the levered view. |
| A3 | `payload.dates` are strictly increasing ISO `YYYY-MM-DD` strings in production (calendar-dense composites included). Fixtures confirm the format; production strictness is not proven here. | Pitfall 5 | Duplicates cause a small pan drift; a non-ISO axis falls back to full range for presets. |
| A4 | The 25 `xRange`-using test files are all green after the change with no fixture edits except the arms named below. Not run: no `node_modules` in the worktree. | Pitfall 6 | Extra fixture fixes in Wave 1. |
| A5 | `npm ci` in the worktree (or a `node_modules` link to the main checkout) is acceptable for execution. Not decided here. | Environment | Wave 0 blocker if neither is allowed. |

## Open Questions (RESOLVED)

1. **Should `setPresetRange` accept any positive integer or only 3/6/12?** RESOLVED: any number; `subtractMonths` rejects what is not a non-negative integer and the preset then resolves to the full range. See `239-02-PLAN.md`, section "Flagged assumptions" (Open Question 1).
   - Known: `PeriodControl` is the only caller. Recommendation: accept any integer ≥ 1 (the type is `number`), validate in `subtractMonths` (returns `null` → full range). No extra whitelist.
2. **Does a preset survive a leverage change?** RESOLVED: yes, because leverage does not change the axis. See `239-02-PLAN.md`, section "Flagged assumptions" (Open Question 2).
   - Leverage does not change the axis, so yes (the store is untouched). Not decided by CONTEXT; recorded here as the natural consequence.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node | all commands | ✓ | v25.8.1 locally; `.nvmrc` pins 22 | — |
| `node_modules` in the worktree | vitest, eslint, tsc | ✗ (`test -d node_modules` → absent; the main checkout has one) | — | Wave 0: `npm ci` in the worktree, or link the main checkout's `node_modules` (executor's call, A5) |
| Supabase / PROD / network | — | not needed | — | — |

**Missing dependencies with no fallback:** none. **With fallback:** `node_modules` (above). Every command below is marked "not run in this session".

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest `^5.0.3` (`package.json`), jsdom project, `@testing-library/react` |
| Config file | `vitest.config.ts` (`INCLUDE` globs `src/**/*.test.{ts,tsx}`, `scripts/**/*.test.*`) |
| Quick run command | `npx vitest run src/lib/dateday.test.ts "src/app/factsheet/[id]/v2/range-dates.test.ts" "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx"` |
| Full suite command | `npm test` (`vitest run`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CACHE-02 | `subtractMonths` clamps to month end (31 Mar − 1M, 29 Feb − 12M, 31 Aug − 6M, 30 Jun − 3M); unparsable day → null | unit | `npx vitest run src/lib/dateday.test.ts` | ✅ file exists, arms ❌ Wave 0 |
| CACHE-02 | resolver: manual dates kept at both ends, strict off-axis fallback, preset ends on latest, gappy-axis round trip | unit | `npx vitest run "src/app/factsheet/[id]/v2/range-dates.test.ts"` | ❌ Wave 0 |
| CACHE-02 (SC-1) | manual range keeps DATES on back AND front growth; 12M preset ends on the latest day after front growth and rolls on back growth; shrunk-axis arm unchanged (`0-19`) | provider integration | `npx vitest run "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx"` | ✅ file exists, arms ❌ Wave 0 |
| CACHE-02 | under an MTM/smoothed axis a manual range keeps its dates on growth; bridge equals `useBasisSeriesView(...).dates` | integration | `npx vitest run "src/app/factsheet/[id]/v2/MasterBrush.basis.test.tsx" "src/app/factsheet/[id]/v2/basis-context.test.tsx"` | ✅ files exist, arms ❌ Wave 0 |
| CACHE-02 | `PeriodControl` 3M/6M/12M = calendar months ending on the latest day; markup/ARIA byte-identical | component | `npx vitest run "src/app/(dashboard)/allocations/widgets/performance/scenario-shared-window.test.tsx"` (+ a new `ScenarioFactsheetChart.period-presets.test.tsx`) | ✅ / ❌ Wave 0 |
| CACHE-04 | `shapeRowAnalytics` hands a BTC row's figures through unconverted beside a USD row | unit | `npx vitest run src/lib/queries.native-unit-ranking.test.ts` | ❌ Wave 0 |
| CACHE-04 | `getPercentiles` ranks a BTC row beside USD rows, raw values, one population | unit (mocked supabase, pattern of `queries.percentiles.test.ts`) | same file | ❌ Wave 0 |
| CACHE-04 | `StrategyTable` sorts and numbers (`#n`) a BTC row among USD rows by raw value | component | `npx vitest run src/components/strategy/StrategyTable.native-unit-ranking.test.tsx` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** the quick run command (add the file the task touched).
- **Per wave merge:** all 25 `xRange` consumers plus the guards:
  `npx vitest run $(grep -rl -E "xRange|setXRange|useXRange" src --include='*.test.ts' --include='*.test.tsx')`
- **Phase gate:** full suite green (`npm test`) before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `node_modules` in the worktree (`npm ci`), then record real timings.
- [ ] `src/lib/dateday.test.ts`: `subtractMonths` arms.
- [ ] `src/app/factsheet/[id]/v2/range-dates.test.ts`: resolver + round trip.
- [ ] `factsheet-context.provider.test.tsx`: date-probe re-pin of the back-growth test, front-growth arms (manual + 12M preset), preset-rolls-on-back-growth arm; `payloadOfLength` gains a start-date parameter.
- [ ] `basis-context.test.tsx` or a new `factsheet-context.axis.test.tsx`: `basisAxisDates` ≡ `useBasisSeriesView(...).dates`; MTM-axis manual range kept on growth.
- [ ] `ScenarioFactsheetChart.period-presets.test.tsx`: click 3M/6M/12M on a >12-month series and assert the brush window labels for calendar-month boundaries; update the stale "~63 trading days" comment in `scenario-shared-window.test.tsx`.
- [ ] `src/lib/queries.native-unit-ranking.test.ts` and `src/components/strategy/StrategyTable.native-unit-ranking.test.tsx` (CACHE-04).

### PROOF-01: concrete neuters (backups live OUTSIDE the tree, e.g. under `$SCRATCH`; restore by `cp` back, then `cmp`, never `git checkout`)

Pre-fix RED needs no neuter for the two SC-1 front-growth arms: run them against today's `factsheet-context.tsx` first (they read `40-70` expected vs `10-40` actual) and record that as the named-arm RED. After implementing, each gate gets a neuter:

| Gate (named arm) | Neuter on a byte copy | Expected RED |
|---|---|---|
| Front growth keeps a manual range's dates | `cp` `range-dates.ts` aside; make the manual branch of `resolveStoredRange` ignore the dates and return the indices captured at write time (re-introduce index storage) | "manual range keeps its dates on FRONT growth" |
| 12M ends on the latest day / preset rolls | in `ScenarioFactsheetChart.tsx` route `selectPeriod` through `setXRange` computed from dates at click time (the forbidden manual path) | "12M preset rolls to the new latest day on back growth" |
| Month-end clamp | in `dateday.ts` replace the clamp with `setUTCMonth(getUTCMonth() - months)` | "31 Mar - 1M is 28 Feb" and "29 Feb 2024 - 12M is 28 Feb 2023" |
| Strict off-axis fallback | in `resolveStoredRange` drop the `stored.start < axis[0] \|\| stored.end > axis[last]` guard | shrunk-axis arm reads `10-19`, expected `0-19` |
| Active-axis bridge | in `BasisProvider` remove the `ActiveAxisContext.Provider` wrapper | the MTM-axis kept-on-growth arm, and the `MasterBrush.basis` widened-clamp arms |
| CACHE-04 shape arm | in a `queries.ts` copy, in `shapeStoredAnalytics` after the `const out` line add `if (native_unit) out.cagr = (out.cagr ?? 0) * 0.5;` (an injected conversion) | "a native-unit row's figures reach the list unconverted" |
| CACHE-04 cohort arm | in a `queries.ts` copy, inside `getPercentiles`'s loop right after `if (!isRankableAnalyticsRow(a)) continue;` add `if ((s.strategy_analytics as { data_quality_flags?: { native_unit?: unknown } } \| null)?.data_quality_flags?.native_unit) continue;` (a unit partition) | the BTC row is absent from the map |
| CACHE-04 table arm | in a `StrategyTable.tsx` copy, as the first statement inside `result.sort((a, b) => {` add `const au = parseReturnsUnit(a.analytics.native_unit) !== null; const bu = parseReturnsUnit(b.analytics.native_unit) !== null; if (au !== bu) return au ? 1 : -1;` | BTC row loses `#1` / sinks below the USD rows |

Per neuter: `cp <file> "$SCRATCH/<name>.orig"`, edit, run the single file with `-t "<arm name>"`, paste the RED output with the arm named, `cp "$SCRATCH/<name>.orig" <file>`, `cmp "$SCRATCH/<name>.orig" <file>`, rerun GREEN. Anchor the `StrategyTable.tsx` / `queries.ts` neuters by symbol (`result.sort((a, b) => {` occurs once; `shapeStoredAnalytics`, `getPercentiles`), because Phase 238 moves line numbers in both files.

### Pre-push gates (Q6)
Not run in this session. Each name below was confirmed to exist: `src/lib/seam-log-coverage.test.ts`, `src/__tests__/critical-regressions.test.ts`, the `src/lib/*invariant*.test.ts` files (`analytics-upstream-error.parity`, `dialog-envelope`, `probe-vocabulary`, `seam-budgets`, `seam-citations`, `seam-escape-label`, `seam-ratelimit-posture`, `seam-terminal-arm`, `seam-transport-attribution`, `seam-user-jwt-emitters`, `seam-venue-vocabulary`, `seam-wire-vocabulary`, `strategyGate`, `wizardErrors`), `src/__tests__/check-planning-hygiene.test.ts`, `src/__tests__/verify-plan-anchors.test.ts`, `package.json` scripts `lint` and `typecheck`.
```
npx vitest run src/lib/seam-log-coverage.test.ts src/__tests__/critical-regressions.test.ts src/lib/*invariant*.test.ts
npx vitest run src/__tests__/check-planning-hygiene.test.ts src/__tests__/verify-plan-anchors.test.ts
npx vitest run src/__tests__/trim-removed-surfaces.test.tsx src/__tests__/phase-52-frozen-spine-guards.test.ts
npm run lint        # eslint src/ + route/planning-hygiene/canonical-domain scripts
npm run typecheck   # tsc --noEmit
```
Planning-reading tests: derive the exact set at execution with `grep -l "\.planning" src/__tests__/*.test.ts` and run them before the push (a docs-only change can red main). `VERSION` and `package.json` must be byte-equal 4-digit strings (`critical-regressions.test.ts` asserts it); never `npm version`. The `plan-anchor-verify` CI job runs `node scripts/verify-plan-anchors.mjs --pending`, so plan anchors cite SYMBOLS, not line numbers. Never write the CI-skip tokens in a commit or PR body (CLAUDE.md). Ship: CHANGELOG entry per the repo's mechanism, and delete the two `TODOS.md` entries (`201.1-COMPOSER-RANGE-AS-DATES`, `164.6.6.2.1-DISCOVERY-RANKING-HONESTY`) in the same PR, naming them in the CHANGELOG.

### Tests whose MEANING changes (Q3)
| Test | Change |
|---|---|
| `factsheet-context.provider.test.tsx` "a range the user set is kept when the series grows, and reset returns to the CURRENT full range" | Re-pin to DATES (probe prints dates); keep the `reset` → `0-149` assertion. Today it passes on indices and cannot go RED on back growth. |
| `factsheet-context.provider.test.tsx` "a range the user set that points past the end of a SHRUNK axis falls back to the current full range" | **Byte-unchanged** under the strict rule (a hard requirement of the rule). |
| `factsheet-context.provider.test.tsx` "an unset range follows the axis when the payload grows from 3 to 120 dates" | Unchanged (null store → `fullRange`). |
| `MasterBrush.basis.test.tsx` widened-clamp arms (MTM, SMTM) | Expected to pass unchanged because `XRangeDriver` lists `setXRange` in its deps and the identity follows the axis. If they go RED, the driver effect fired once while the axis was still cash: re-drive after the basis settles. The cash "no bundle" arm is unchanged. |
| `scenario-shared-window.test.tsx` "the SegmentedControl drives the shared window" | Still passes (252 consecutive days ≈ 8.3 months; 3M start is later than day 0). Update the "~63 trading days" comment. |
| `basis-context.window-gesture`, `TimeSeriesChart.window-gesture`, `FactsheetView.window-kpis`, `FactsheetView` basis-change reset tests | Expected unchanged: cash axis, real payloads, indices round-trip through dates. Verify by running (A4). |
| `ScenarioFactsheetChart.opening-range.test.tsx` (D-07) | Unchanged: never clicks a period; asserts the null-store path. |
| `queries.percentile-columns.test.ts` | Unchanged and relied on: it already byte-pins that the percentile projection carries no `native_unit`. |

## CACHE-04 (Q4)

**Where the list is built** (all read this session):
- Projection: `CATEGORY_RANKING_ANALYTICS_COLUMNS` in `src/lib/queries.ts` carries `native_unit:data_quality_flags->>native_unit` (one scalar alias; `queries.test.ts` pins the allowed `->>` forms).
- Row shaping: `shapeRowAnalytics` (exported) → `shapeStoredAnalytics` → `shapedNativeUnit`, which only PARSES the unit (`parseReturnsUnit(a.native_unit ?? a.data_quality_flags?.native_unit)`); it never touches a return figure.
- Cohort: `getPercentiles` (published rows) and `getOwnRowPercentiles` (own rows against the published population) both delegate to `scoreAgainstPopulation` in `src/lib/percentile-core.ts`. Quote, `queries.ts:314-321`: `function kpiRecord(a: Record<string, unknown>): Record<string, number | null> { ... for (const metric of PERCENTILE_METRICS) { const v = a[metric]; out[metric] = typeof v === "number" ? v : null; } return out; }`, and `queries.ts:330-332`: ``function percentileSelect(embedPrefix = ""): string { return `id, asset_class, ${embedPrefix}strategy_analytics (${PERCENTILE_ANALYTICS_COLUMNS}, ${PERCENTILE_GATE_COLUMN}, ${PERCENTILE_SPAN_COLUMNS})`; }``. `scoreAgainstPopulation(subjects, population)` takes `{ id, analytics: Record<string, number | null> }` rows: no unit field exists in its input type. So the cohort is unit-blind by construction, and `queries.percentile-columns.test.ts` byte-pins the projection that keeps it so. A pin placed there cannot encode "an unconverted BTC row".
- Table: `StrategyTable.tsx` `result.sort((a, b) => { ... })` partitions only by ranked/current status and then `compareWithMissingLast(getSortValue(...))`; `rankOrdinals` counts `isRankedRow(s) && isCurrentRow(s)`. `native_unit` appears once: `unit={parseReturnsUnit(s.analytics.native_unit)}` (the chip, `StrategyTable.tsx:1916`).
- Negative claim, backed: the two `convertNativeReturnsToUsd` call sites in `queries.ts` are inside `getOwnCapitalStrategies` (declared at `queries.ts:2113`, call at `:2249`) and `getMyAllocationDashboard` (`export const getMyAllocationDashboard = cache(` at `:5023`, call at `:6284`), the allocator paths. The Discovery chain is `src/app/(dashboard)/discovery/[slug]/page.tsx` and `src/app/browse/[slug]/page.tsx` calling `getStrategiesByCategory` + `getPercentiles` into `StrategyTable`; `grep -rln "convertNativeReturnsToUsd" src` lists no Discovery file.

**Recommendation: add the pin, as TWO new files, three arms.** It encodes the ruling, can fail, and touches neither `queries.ts` nor `StrategyTable.tsx` (Phase 238 edits both):
1. `src/lib/queries.native-unit-ranking.test.ts`
   - **shape arm:** `shapeRowAnalytics` on a BTC row (`native_unit: "BTC"`, `cagr: 0.9`, `cumulative_return: 3.2`) beside a USD row returns the BTC row's `cagr`/`cumulative_return` equal to the input and `native_unit === "BTC"`.
   - **cohort arm:** `getPercentiles` with the mocked-supabase pattern of `queries.percentiles.test.ts` (hoisted `strategiesResolver`, `vi.mock("@/lib/supabase/server")`, `vi.mock("@/lib/supabase/admin")`): five `complete` rows, one carrying `data_quality_flags: { native_unit: "BTC" }` and the highest raw `cagr`; assert it is present in the map, scored on its RAW value (`cagr` percentile 100) in the same population of five as the USD rows.
2. `src/components/strategy/StrategyTable.native-unit-ranking.test.tsx`: one BTC row with the top raw CAGR beside USD rows; click the CAGR header (the existing `#n` test at `StrategyTable.test.tsx`, "renders a #n rank column tied to the active sort order", shows the pattern); assert the BTC row is `#1` and the ordering is by raw value, and that the `in BTC` chip (`[data-returns-unit]`) is still on it. Copy the fixtures it needs (`makeStrategy` / `makeAnalytics` are file-local in `StrategyTable.test.tsx`, not exported) and the module mocks that file declares; keep rows current (`series_end` yesterday) so a Phase 238 partition change cannot reorder them.

Both new files assert behaviour only, no projection bytes and no copy. Test file names are new, so no census edit is expected; grep for a test-file census before adding (`grep -rn "native-unit" src/__tests__ | head`).

## Security Domain

`security_enforcement` is absent from `.planning/config.json`, so it is treated as enabled. This phase is client-only view state plus one pure test pin.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication / V3 Session / V4 Access Control | no | no auth surface touched |
| V5 Input Validation | yes (narrow) | stored dates come from the axis itself, never from user text; `parseIsoDay` guards the one parse (`subtractMonths`); an unparsable day falls back to the full range |
| V6 Cryptography | no | none |
| V8 Data Protection | yes | the range is never persisted: no storage, URL or history write (`basis-context.test.tsx` GUARD-04 scan; `FactsheetBody.guard04-no-bleed.test.tsx`; Phase 193 D-02) |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Crafted `?range=` in a shared URL | Tampering | already dropped: the hydration effect deletes a legacy `range` and never applies it (Phase 193 D-02); unchanged |
| Malformed date in an axis (hand-built payload) | Tampering / DoS | `subtractMonths` returns `null` → full range; empty axis → no write |

## Project Constraints (from CLAUDE.md)

- **Read DESIGN.md before any UI decision**; this phase changes no pixel (UI-SPEC). No raw `text-[Npx]` (`no-raw-font-px` is an error).
- **CHANGELOG entry on every ship**, written before the push, same commit as the `VERSION` bump; `VERSION` and `package.json` byte-equal 4-digit strings; never `npm version`. The skip-CI tokens must never appear in a commit message or PR body, even to deny them.
- **`TODOS.md` holds open work only**: the ship deletes the two entries this phase closes and names them in the CHANGELOG; LOW/Info review survivors are not booked there.
- **Completion is historical**: verifications use `verified_at_sha` + `drift_subjects`, never `covered_digest`/`covered_files`; `TODOS.md`, `CHANGELOG.md`, `VERSION`, `package.json` never belong in `drift_subjects`.
- **Plan anchors cite symbols** (the `plan-anchor-verify` CI job re-resolves every `file:line` anchor).
- **Tracked text**: no home paths, secrets, PROD ids or account numbers; no AI-authorship trailers (memory: founder 2026-10-20).
- **AGENTS.md**: this Next.js differs from training data. This phase touches no Next-specific API (client React context, pure TS, tests), so `node_modules/next/dist/docs/` was not consulted.
- **Never run `git checkout`/`restore`/`stash` on uncommitted work**; neuters restore from a byte copy (`cp` + `cmp`). Data-integrity and user-facing gates must be able to fail (neuter, see RED, restore).
- **Always `grep -a`**; `pytest` not involved.
- Do not edit `StrategyTable.tsx` or `queries.ts` (Phase 238 owns them in a parallel worktree).

## Sources

### Primary (HIGH confidence): in-repo files read this session
- `src/app/factsheet/[id]/v2/factsheet-context.tsx` (whole file), `basis-context.tsx` (BasisProvider, Layer 1/2, `resolveRangeScope`, `useWindowedView`), `MasterBrush.tsx`, `TimeSeriesChart.tsx`, `HistogramChart.tsx`, `FactsheetView.tsx` (reset effects, `FactsheetBody` zoomed gate), `MetricsColumn.tsx` (grep)
- `src/app/(dashboard)/allocations/widgets/performance/ScenarioFactsheetChart.tsx` (whole file), `scenario-shared-window.test.tsx`, `ScenarioFactsheetChart.opening-range.test.tsx`, `scenario-factsheet-parity-guard.test.ts` (grep), `scenario-factsheet-payload.pending.test.tsx` (zoom Grab)
- `src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx` (whole file), `MasterBrush.basis.test.tsx`, `basis-context.test.tsx` (GUARD-04 test)
- `src/lib/dateday.ts` (whole file), `src/lib/queries.ts` (percentile section, `shapeRowAnalytics` chain, `getPercentiles`, `getOwnRowPercentiles`), `src/lib/percentile-core.ts`, `src/lib/queries.percentiles.test.ts`, `src/lib/queries.percentile-columns.test.ts`, `src/components/strategy/StrategyTable.tsx` (sort, `rankOrdinals`, chip prop), `StrategyTable.test.tsx` (`#n` test, chip tests)
- `.planning/phases/239-.../239-CONTEXT.md`, `239-UI-SPEC.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` (Phase 239), `TODOS.md` (`201.1-COMPOSER-RANGE-AS-DATES`, `164.6.6.2.1-DISCOVERY-RANKING-HONESTY`), `.planning/config.json`, `CLAUDE.md`, `package.json`, `src/__tests__/phase-52-frozen-spine-guards.test.ts` (grep), `src/__tests__/trim-removed-surfaces.test.tsx` (`dark` scan)

### Secondary / Tertiary
- None. No web source was needed: no new library, no framework API.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new package.
- Architecture (axis bridge, resolver, strict rule): MEDIUM-HIGH, derived from code read this session and one refuted alternative; not executed.
- Pitfalls: HIGH for items quoted from source; A1-A4 are explicit assumptions.
- CACHE-04: HIGH, the unit-blindness is read from the source and the existing byte pin.

**Research date:** 2026-11-24
**Valid until:** 2026-12-08 (Phase 238 is editing `queries.ts` and `StrategyTable.tsx` in parallel; re-anchor by symbol before each plan runs)
