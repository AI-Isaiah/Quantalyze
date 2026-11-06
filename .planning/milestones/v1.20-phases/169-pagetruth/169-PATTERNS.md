# Phase 169: FACTSHEETTRUTH (pagetruth) - Pattern Map

**Mapped:** 2026-09-27 (against the phase branch HEAD, which contains `origin/main`)
**Files analyzed:** 47 (new + modified, across 169-01 to 169-07 and the two new plans RISKUNIT and MONEYFMT; 169-08 is dropped by D-47)
**Analogs found:** 46 / 47 (the one gap is 169.2's reader, an external contract, see "No Analog Found")

Citation rule for this file: code is cited by **file + symbol**, never by line number
(`[164.7-CITATION-DRIFT-01]` class). Every path below was checked with `git ls-files` and is
tracked source at HEAD, except the one external contract flagged as such.

---

## ⛔ Blocking planner inputs (read before assigning files)

These are test pins OUTSIDE the plans' current `files_modified` that the planned fixes will turn
red. Each must be listed in the owning plan, or the plan ships a red suite.

| # | Owning plan | File not yet listed | What it pins today | Why it reddens |
|---|---|---|---|---|
| B1 | MONEYFMT | `src/app/(dashboard)/allocations/components/untrusted-key-status.surfaces.test.tsx` | describe `"[167.1] AUMTRUST — OpenPositionsTable footer qualifier"` (helper `footerTotal`) and describe `"[167.1 R2 WR-05] a holding whose key is missing from the key list"`: roughly a dozen literal money strings such as `"+$1,300"`, `"+$300"`, `"Includes +$0 from keys needing attention."`, `"Includes −$1,235 from keys needing attention."` | Those strings come from OpenPositionsTable's private `formatPnl`, which is passed into `buildKeyTrustClause` as `render.amount`. D-50's rule (P&L at 2 dp; a value that rounds to zero is unsigned) changes every one: `"+$1,300"` becomes `"+$1,300.00"`, `"+$0"` becomes `"$0.00"`. Each changed literal gets a dated comment naming D-50. |
| B2 | 169-07 | `src/lib/factsheet/fetch-and-build-payload.test.ts` (already listed by 169-07, but the exact arm must be named) | Inside the capture test, the arm commented "a csv read OUTAGE folds into an empty series": `fake.csvError = { message: "synthetic csv outage", code: "57014" }` then `expect(await fetchAndBuildPayload(...)).toBeNull()` and `toMatchObject({ tags: { caller: "build", gate: "empty_series" } })` | D-41 inverts exactly this arm: the outage must become `read_error` (with its code), not `composite_unbuildable` / `empty_series`. The arm is rewritten, not deleted: it is the old-behaviour pin that proves the new one. |
| B3 | 169-02 | `src/lib/factsheet/align.test.ts` (listed) | `it("returns 0 when prior price is unavailable")` and `it("forward-fills benchmark prices over strategy date gaps")` (asserts `rets[1]` is `0` "forward-fill keeps prior price → 0 return") | These pin the fabricated-zero behaviour SC3 removes. Rewrite them with a dated D-09 comment; do not leave both the old and the new expectation. |
| B4 | RISKUNIT | (no extra file; a criterion problem) | `RiskAttribution.test.tsx` mocks `recharts` with `XAxis: NullComponent` and `Bar: NullComponent` | A "bar domain matches the unit" assertion (RESEARCH test map, R1 row) cannot fire under this mock: `XAxis` renders nothing and receives no inspectable props. Either the mock captures props (e.g. `XAxis: (p) => { captured.push(p); return null; }`) and the test asserts `domain`, or the criterion is dropped. Do not write a domain test that cannot fail. |

**Also binding, from the decisions (not from the research):**
- `standalone_vol` is **left alone** in RISKUNIT (D-49: "`standalone_vol` is not double-scaled and is left alone; its missing period label is copy (Phase 170.1)"). RESEARCH Open Question 3 floated rendering it unsigned; D-49 is the later decision and wins (Rule 7).
- The whole-dollar `formatUsd` in `src/lib/dollar-validation.ts` is **not changed** (RESEARCH anti-pattern; `dollar-validation.test.ts` pins it; `ScenarioComposer.tsx` `buildUntrustedAumClause` passes it to the same `buildKeyTrustClause` and must keep whole dollars).

---

## File Classification

### RISKUNIT (new plan, D-49)

| File | New/Mod | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|---|
| `src/components/portfolio/RiskAttribution.tsx` | mod | component | transform (display) | itself; unit contract from `src/lib/utils.ts` `formatPercent` + `src/__tests__/format-percent-contract.test.ts` | exact |
| `src/components/portfolio/RiskAttribution.test.tsx` | mod (rewrite fixtures + add case) | test | request-response (render) | itself + `src/lib/portfolio-analytics-adapter.test.ts` (fixture import) | exact |
| `src/lib/types.ts` (`RiskDecompositionRow`, doc only) | mod | model | — | itself (the existing null-reason JSDoc on `marginal_risk_pct`) | exact |

### MONEYFMT (new plan, D-50)

| File | New/Mod | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|---|
| `src/lib/dollar-validation.ts` | mod (add price + signed-money formatters) | utility | transform | itself (`formatUsd`); threshold shape from `formatQuantity` in `OpenPositionsTable.tsx` | exact |
| `src/lib/dollar-validation.test.ts` | mod | test | transform | itself (literal-oracle header) | exact |
| `src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx` | mod (delete private `formatUsd` + `formatPnl`, import shared) | component | transform (display) | `HoldingsTable.tsx` Phase 150 import of `formatUsd` | exact |
| `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` | mod (delete `formatPnl`, price cell to price formatter) | component | transform (display) | itself (Phase 150 import comment) | exact |
| `src/app/(dashboard)/allocations/components/OpenPositionsTable.all-columns.test.tsx` | mod (add cell-value cases) | test | render | itself (`makeRow`) | exact |
| `src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx` | mod | test | render | itself (`makeHolding`) | exact |
| `src/app/(dashboard)/allocations/components/untrusted-key-status.surfaces.test.tsx` | mod (**B1, not yet listed**) | test | render | itself | exact |
| `DESIGN.md` `## Numbers Contract` (new currency row) | mod | config (design contract) | — | the existing `| Kind | Rule |` rows | exact |

### Factsheet plans (169-01 to 169-07; plans already exist, files listed here for the planner's re-derive)

| File | New/Mod | Plan | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|---|---|
| `src/lib/factsheet/composite-read-path.ts` | mod | 01, 07 | service | CRUD read | itself: `singleKeyBasisOpts`, `readCompositeFactsheet` | exact |
| `src/lib/factsheet/composite-read-path.test.ts` | mod | 01, 07 | test | CRUD read | itself (`mockSeriesAdmin` `{ data: null, error: { message: "boom" } }` arms) | exact |
| `src/lib/factsheet/fetch-and-build-payload.ts` | mod | 01, 02, 07 | service | request-response | itself: `resolveFactsheetInputs` embed, `notBuildable`, `FactsheetProbeTimeoutError` | exact |
| `src/lib/factsheet/fetch-and-build-payload.test.ts` | mod | 07 | test | request-response | itself (`fake` hoisted state, `csvError`) | exact |
| `src/lib/factsheet/fetch-and-build-payload.benchmark.test.ts` | NEW | 02 | test | request-response | `fetch-and-build-payload.test.ts` (`vi.mock("@/lib/supabase/admin")` builder double) | exact |
| `src/lib/factsheet/build-payload.headline-source.test.ts` | NEW | 01 | test | transform | `src/app/factsheet/[id]/v2/MetricsColumn.no-loss-residues.test.tsx` `payloadFrom` (real `buildFactsheetPayload`) + `basis-metrics.test.ts` | role-match |
| `src/lib/factsheet/build-payload.ts` | mod | 02, 03 | service | transform | itself: `overlayBasisScalars(computedMetrics, …)`, `alignReturns(BTC_DAILY, dates)` | exact |
| `src/lib/factsheet/build-payload.benchmark-opt.test.ts` | NEW | 02 | test | transform | `build-payload.test.ts` / `build-payload.arithmetic.test.tsx` | exact |
| `src/lib/factsheet/align.ts` | mod | 02 | utility | transform | itself: `alignReturns` | exact |
| `src/lib/factsheet/align.test.ts` | mod (**B3**) | 02 | test | transform | itself | exact |
| `src/lib/factsheet/comparator-block.ts` | mod | 02, 03, 05 | utility | transform | itself: `buildComparatorBlock` | exact |
| `src/lib/factsheet/comparator-block.coverage.test.ts` | NEW | 02 | test | transform | `src/lib/factsheet/joint.test.ts` / `compute.metrics.test.ts` (pure fixtures) | role-match |
| `src/lib/factsheet/types.ts` | mod | 02, 03, 04, 05 | model | — | itself (`ComputeResult`, `ComparatorBlock`; optional-field device per D-21) | exact |
| `src/lib/factsheet/compute.ts` | mod | 04 | utility | transform | itself: `compoundFrom`, `offsetDays`, `years` | exact |
| `src/lib/factsheet/compute.metrics.test.ts` | mod | 04 | test | transform | itself (30-day `rets`/`dates` fixture) | exact |
| `src/lib/factsheet/record-length.ts` | NEW | 05 | utility | transform | `src/app/factsheet/[id]/v2/format.ts` (`pctSigned` shape, header contract) | role-match |
| `src/lib/factsheet/record-length.test.ts` | NEW | 05 | test | transform | `src/lib/factsheet/period-buckets.test.ts` + `dollar-validation.test.ts` literal-oracle header | role-match |
| `src/lib/factsheet/__snapshots__/build-payload.test.ts.snap` | mod | 02, 03, 04, 05 | test fixture | — | itself (explain each moved key, RESEARCH Pitfall 4) | exact |
| `src/app/factsheet/[id]/v2/page.tsx` | mod | 02, 03, 07 | route (RSC) | request-response + cache | itself: `buildFactsheetPayloadCached`, `FactsheetReadError` | exact |
| `src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx` | mod | 02 | test | cache | itself (`cacheStore` / `cacheKeys` double) | exact |
| `src/app/factsheet-share/[token]/page.cache-isolation.test.tsx` | mod | 02 | test | cache | itself (`EXPECTED_KEY_PREFIX`) | exact |
| `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` | run only (not modified; 169-02 Task 3 runs it) | 02 | test | cache | itself | exact |
| `src/app/factsheet/[id]/v2/page.composite-read-error.test.tsx` | NEW | 07 | test | cache | `page.public-cache-key.test.tsx` `it("READ-ERROR-NOT-CACHED …")` | exact |
| `src/app/factsheet/[id]/v2/basis-context.tsx` | mod | 01, 03 | provider/hook | transform | itself: the `strategyMetrics` IIFE re-pin arm in `useBasisSeriesView` | exact |
| `src/app/factsheet/[id]/v2/basis-context.cash-leverage-repin.test.tsx` | NEW | 01 | test | hook | `basis-context.leverage.test.tsx` (`renderHook` + `BasisProvider` + `LeverageProvider`) | exact |
| `src/app/factsheet/[id]/v2/basis-context.benchmark-prices.test.tsx` | NEW | 03 | test | hook | `basis-context.leverage.test.tsx` | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | mod | 04 | component | transform | itself: `FreshnessChip`, `resolveSeriesEnd` | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.chip-honesty.test.tsx` | mod | 04 | test | render | itself | exact |
| `src/app/factsheet/[id]/v2/MetricsColumn.tsx` | mod | 05 | component | transform | itself: `periodReturn`, the `"Years Observed"` row, the `⚠ Only {m.n} observations` warning, the EoY `cmp.dailyReturns[i]` loop | exact |
| `src/app/factsheet/[id]/v2/MetricsColumn.record-length.test.tsx` | NEW | 05 | test | render | `MetricsColumn.no-loss-residues.test.tsx` (`payloadFrom` + `FactsheetProvider`) | exact |
| `src/app/factsheet/[id]/v2/MandatePanels.tsx` | mod | 03, 05 | component | transform | itself: the "trading days" thesis sentence and `<Term label="Sample size">` | exact |
| `src/app/factsheet/[id]/v2/MandatePanels.comparator-coverage.test.tsx` | NEW | 03 | test | render | `MandatePanels.scenario.test.tsx` | exact |
| `src/app/factsheet/[id]/v2/DistributionPanels.tsx` | mod | 05 | component | transform | the EoY loop in `MetricsColumn.tsx` (same `const r = …dailyReturns[i]` shape) | exact |
| `src/app/factsheet/[id]/v2/EoyComparatorCoverage.test.tsx` | NEW | 05 | test | render | `MetricsColumn.no-loss-residues.test.tsx` | role-match |
| `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` | mod (maybe test-only, RESEARCH 169-03 verdict) | 03 | component | transform | itself: `buildPath` null-break | exact |
| `src/app/factsheet/[id]/v2/TimeSeriesChart.coverage-gap.test.tsx` | NEW | 03 | test | render | `TimeSeriesChart.markers.test.tsx` | exact |
| `src/app/factsheet/[id]/v2/ComparatorPicker.tsx` + `ComparatorPicker.test.tsx` | mod | 03 | component + test | render | themselves | exact |
| `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx` | mod | 01, 03, 07 | route (RSC) | request-response | `src/lib/factsheet/fetch-and-build-payload.ts` (the lockstep partner, D-23) | exact |
| `src/app/(dashboard)/discovery/[slug]/[strategyId]/page.pending-fallback.test.tsx` | mod | 07 | test | render | itself | exact |

---

## Pattern Assignments

### RISKUNIT

#### `src/components/portfolio/RiskAttribution.tsx` (component, transform)

**Analog:** itself, plus the unit contract of `formatPercent` in `src/lib/utils.ts`.

**The contract the fix must obey** (`src/lib/utils.ts`, `formatPercent`, verbatim):
```ts
export function formatPercent(
  value: number | null | undefined,
  decimals = 2,
  options?: { signed?: boolean },
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const signed = options?.signed ?? true;
  const sign = signed && value >= 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(decimals)}%`;
}
```
It takes a FRACTION. The producer sends percent (fixture `complete.json` `risk_decomposition[*]`:
`"marginal_risk_pct": 28.0`, `"weight_pct": 40.0`), so today the cell reads `+2800.00%`.

**Unsigned-domain rule** (`src/__tests__/format-percent-contract.test.ts`, file header, verbatim):
> New callers must import from `@/lib/utils` and pass `{ signed: false }` for unsigned-domain values like weights.

**Current table cells to change** (`RiskAttribution`, the `<tbody>` map):
```tsx
<td className="py-2 pr-4 text-right font-metric">{formatPercent(d.weight_pct)}</td>
<td className="py-2 pr-4 text-right font-metric">{formatPercent(d.marginal_risk_pct)}</td>
<td className="py-2 pr-4 text-right font-metric">{formatPercent(d.standalone_vol)}</td>   {/* D-49: leave alone */}
```
Target shape (RESEARCH Code Examples, R1): convert once at this consumer, unsigned, null stays null:
```ts
formatPercent(d.marginal_risk_pct == null ? null : d.marginal_risk_pct / 100, 1, { signed: false })
```
Decimal count: DESIGN.md Numbers Contract says percentages are 1 dp; a dense comparison table may
widen to 2 dp. Pick one and state it in the plan (Claude's discretion covers helper names, not this;
it is a Numbers Contract application).

**Chart pieces that must agree with the unit fed to them** (`RiskAttribution`, the `BarChart`):
```tsx
<XAxis type="number" hide domain={[0, 1]} />
<TouchTooltip formatter={(v, name) => [`${(Number(v) * 100).toFixed(1)}%`, name]} ... />
```
`chartData` stacks `d.marginal_risk_pct` (percent) against a `[0, 1]` domain. Either feed the bar
fractions (`/ 100` in the `chartData` reduce) and keep `[0, 1]` + the `* 100` tooltip, or keep
percent and set `[0, 100]` + drop the tooltip's `* 100`. The tooltip's inline `toFixed` is
explicitly exempt from the formatPercent contract scan (file header: "The test deliberately does NOT
scan for inline `(x * 100).toFixed(N)%` patterns — those appear in Recharts tickFormatters and
tooltip formatters"), so no routing through `formatPercent` is needed there.

**Keep unchanged:** the 166.1 D7 null arms (`d.marginal_risk_pct === null ? acc : …` in the
`chartData` reduce; the `share === null` colorless "—" assessment cell). The `Assessment` compare
`share > d.weight_pct * 1.3` is percent-vs-percent and correct (RESEARCH R1); if the plan converts
`share` to a fraction for display, the compare must stay on the SAME unit for both sides.

#### `src/components/portfolio/RiskAttribution.test.tsx` (test)

**Analog:** itself (mock block + null-share describe) and `src/lib/portfolio-analytics-adapter.test.ts`
(how the producer fixture is imported).

**Fixture import pattern** (`portfolio-analytics-adapter.test.ts`, imports):
```ts
import { adaptPortfolioAnalytics } from "./portfolio-analytics-adapter";
import complete from "@/__tests__/fixtures/portfolio-analytics/complete.json";
```
D-49 requires the fixture "rebuilt from the producer's real shape": parse `complete` through
`adaptPortfolioAnalytics` and pass `parsed.risk_decomposition` to `<RiskAttribution data=… />`, so
the test fails if either the producer fixture or the adapter drifts in unit. Assert the rendered
Risk % cells as literals (e.g. the 28.0 row renders `28.0%`, no `+`), never computed from the
module under test. Do not quote the fixture's strategy names in planning prose; select rows by
`strategy_id` or by index.

**Mock block to keep** (verbatim), and see **B4** for the domain-assertion caveat:
```tsx
vi.mock("recharts", () => {
  const Passthrough = ({ children }: { children?: React.ReactNode }) => (<div>{children}</div>);
  const NullComponent = () => null;
  return { ResponsiveContainer: Passthrough, BarChart: Passthrough, Bar: NullComponent, XAxis: NullComponent, YAxis: NullComponent };
});
vi.mock("@/components/charts/TouchTooltip", () => ({ TouchTooltip: () => null }));
```
**Existing fixtures that encode the wrong unit** (must be rewritten to percent, D-49):
`marginal_risk_pct: 0.8, weight_pct: 0.3` / `0.2, 0.7` in `it("keeps the assessment for a real risk share")`,
and `weight_pct: 0.5` in the null-share case. The Assessment outcome (Overweight / Balanced) must be
re-derived on percent inputs, not assumed.

**Neuter target for SC9:** restore `formatPercent(d.marginal_risk_pct)` (no `/ 100`) and observe the
`28.0%` assertion go RED showing `+2800.0%`.

#### `src/lib/types.ts` — `RiskDecompositionRow` (model, doc only)

**Analog:** the existing JSDoc on the same interface (verbatim):
```ts
export interface RiskDecompositionRow {
  strategy_id: string;
  strategy_name: string;
  /**
   * null = the portfolio carries no risk, so no share of it exists to
   * apportion (166.1 D7, founder 2026-09-26; round-1 SFH MEDIUM-2). Never 0.
   */
  marginal_risk_pct: number | null;
  standalone_vol: number;
  /** null for the same reason as `marginal_risk_pct`. */
  component_var: number | null;
  weight_pct: number;
}
```
Add the unit (percent, 0 to 100, producer `analytics-service/services/portfolio_risk.py`
`compute_risk_decomposition` / `routers/portfolio.py`) to the `marginal_risk_pct` and `weight_pct`
docs in the same dated-reason voice. No type change. Do NOT convert at
`src/lib/portfolio-analytics-adapter.ts` (`asNumber(v.marginal_risk_pct)`): `portfolio-insights.ts`
reads percent and would move too (RESEARCH R1, Pattern 4).

---

### MONEYFMT

#### `src/lib/dollar-validation.ts` (utility, transform)

**Analog:** itself. The module header declares it the ONE money module (verbatim excerpt):
```ts
 *   - `formatUsd` came from
 *     `src/app/(dashboard)/allocations/components/HoldingsTable.tsx`, where it
 *     was module-private. The Mark-ownership confirm copy and the Holdings
 *     allocation cells/dialog must render amounts through the SAME formatter —
 *     a second money formatter on this surface is forbidden (150-UI-SPEC).
```
**Existing formatter to copy the shape from, and NOT to change** (`formatUsd`, verbatim):
```ts
/**
 * Whole-dollar USD rendering for the allocations surface.
 * `null` renders the em-dash, never `$0` (no-invented-data).
 */
export function formatUsd(n: number | null): string {
  if (n == null) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
```
**Threshold-shape analog for the price rule** (`formatQuantity`, duplicated in both tables):
```ts
function formatQuantity(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const digits = abs < 1 ? 4 : 2;
  return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
```
Note the difference: `formatQuantity` switches DECIMAL PLACES; D-50's sub-dollar price rule is
4 SIGNIFICANT DIGITS (`maximumSignificantDigits: 4` on `toLocaleString`, currency style), and 2 dp
at or above $1. `formatQuantity` is not a money formatter and is out of scope (Rule 3).

**Signed-money formatter: sign from the ROUNDED value** (RESEARCH Code Examples, R2, shape):
```ts
const rounded = Number(n.toFixed(2));
const sign = rounded > 0 ? "+" : rounded < 0 ? "−" : "";
```
Constraints the new signed formatter must meet:
- Null (and, matching the table's own `Number.isFinite` totals, non-finite) renders `"—"` (D-50,
  DESIGN.md null rule).
- It must stay assignable to `KeyTrustClauseRender.amount`, typed `(n: number) => string` in
  `src/app/(dashboard)/allocations/lib/live-holdings-summary.ts`, because OpenPositionsTable passes it
  to `buildKeyTrustClause`. A `(n: number | null) => string` signature is assignable; a non-string
  return is not.
- The minus glyph is the existing U+2212 `−` used by both `formatPnl` copies (pinned by B1's
  literals); keep it.
- **Sign and colour from ONE rounding.** `pnlColor` in OpenPositionsTable colours by the raw value
  (`pnl > 0` / `pnl < 0`), so a P&L of `-0.001` would render an unsigned `$0.00` in red, which
  DESIGN.md forbids ("Red … never for a zero"). Export the rounded-sign decision from this module
  (e.g. a small `signOfRoundedUsd(n)` or a `{ text, sign }` pair) and have `pnlColor` read it, so the
  text and the colour cannot drift. Helper name is Claude's discretion.

#### `src/lib/dollar-validation.test.ts` (test)

**Analog:** itself. Its header states the oracle rule every new formatter case must follow (verbatim):
```ts
 * Both are behaviour pins on a MOVE: every expectation below is a literal
 * typed into this file (never imported from the module under test, never from
 * `MAGNITUDE_CAPS`), so a drifted cap or a "cleaned up" formatter reddens here
 * rather than silently changing what a money surface accepts or renders.
```
**Describe shape to copy** (`describe("formatUsd — the ONE money formatter for the allocations surface")`):
```ts
it("renders the em-dash for a null amount — never $0 (no-invented-data)", () => {
  expect(formatUsd(null)).toBe("—");
});
```
Add sibling describes for the price and signed formatters with literal cases from RESEARCH R2's
replications: `0.4213` (sub-dollar price, 4 sig. digits), `0.00009876`, a ≥ $1 price at 2 dp,
`0.37` → `+$0.37`, `-0.21` → `−$0.21`, `-0.0001` and `0.004` → unsigned zero, `null` → `"—"`. Keep
the existing `formatUsd` describe byte-identical (it is the proof the whole-dollar formatter did not
move).

#### `src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx` (component)

**Analog:** HoldingsTable's Phase 150 import (verbatim, `HoldingsTable.tsx` imports):
```ts
// Phase 150: `formatUsd` was module-private here; it is now the ONE money
// formatter for this surface (shared with the Phase-150 mark/allocate
// dialogs). Body unchanged — a second money formatter here is forbidden.
import { formatUsd } from "@/lib/dollar-validation";
```
**To delete** (module-private duplicates, both byte-level Phase 150 violations): `formatUsd` and
`formatPnl` (`const sign = n >= 0 ? "+" : "−";` then whole-dollar `Math.abs(n)`).

**Call sites to move:**
- `{formatUsd(r.entry_price)}` and `{formatUsd(r.mark_price)}` → the new price formatter.
- `{formatUsd(r.notional_usd)}` → the shared whole-dollar `formatUsd` (notional is exposure, not a
  price; RESEARCH R2 keeps whole dollars for AUM / notional / allocation).
- `{formatPnl(r.unrealized_pnl_usd)}` (row), `{formatPnl(totalUnrealized)}` (footer) and
  `buildKeyTrustClause(untrusted, unknownStatus, { amount: formatPnl, … })` → the signed formatter.
- `style={{ color: pnlColor(r.unrealized_pnl_usd) }}` and `pnlColor(totalUnrealized)` → colour from
  the rounded sign (see the module section).

**Keep untouched:** the single-pass total/untrusted loop in `OpenPositionsTable` (Phase 167.1
AUMTRUST D-16 comment block), the `isUntrustedKeySyncStatus` / `untrustedKeyChipLabel` imports.

#### `src/app/(dashboard)/allocations/components/HoldingsTable.tsx` (component)

**Analog:** itself. Delete its module-private `formatPnl` (identical to OpenPositionsTable's). Call
sites in the legacy holdings `<tbody>`:
```tsx
<td className={numericCell}>{formatUsd(h.entry_price)}</td>      {/* → price formatter */}
<td className={numericCell}>{formatUsd(h.value_usd)}</td>        {/* stays whole-dollar */}
<td className={numericCell}>{formatPnl(h.unrealized_pnl_usd)}</td> {/* → signed formatter */}
```
This P&L cell carries **no colour today**; D-50 adds none here (Rule 3). `formatUsd(row.allocation)`
and `formatUsd(row.alloc)` are allocation amounts and stay whole-dollar.
Note `src/__tests__/format-percent-contract.test.ts` renders `HoldingsTable` (H-1208) but asserts only
percent strings; it is not moved by MONEYFMT.

#### `OpenPositionsTable.all-columns.test.tsx` / `HoldingsTable.test.tsx` (tests)

**Analog:** their own row builders. `OpenPositionsTable.all-columns.test.tsx`:
```ts
function makeRow(over: Partial<OpenPositionRow> = {}): OpenPositionRow {
  return { id: "pos-1", venue: "binance", symbol: "BTC-PERP", side: "long", quantity: 1.25,
    notional_usd: 90_000, entry_price: 60_000, mark_price: 72_000, unrealized_pnl_usd: 1_500,
    api_key_id: "key-1", source_key_sync_status: "complete", ...over };
}
```
`HoldingsTable.test.tsx` has `makeHolding` (defaults `entry_price: 60_000`,
`unrealized_pnl_usd: 1_200`). Add cases with `entry_price: 0.4213`, `unrealized_pnl_usd: 0.37`,
`-0.0001`; assert the cell text as literals and, for OpenPositionsTable, that a zero-rounded P&L cell
has no `color` style. The existing header-guard arms stay as they are.

#### `untrusted-key-status.surfaces.test.tsx` (test, **B1**)

Rewrite each money literal in the `footerTotal` describe and the WR-05 describe to the D-50 form, one
dated comment per describe naming D-50. The assertions' SUBJECT (which rows are counted, the
"unavailable for N positions" wording) does not change; only the amount text does.

#### `DESIGN.md` `## Numbers Contract` (config)

**Analog:** the table rows (verbatim):
```md
| Kind | Rule |
|------|------|
| Ratios (Sharpe, Calmar, Sortino) | 2 decimal places |
| Tail-risk (VaR, CVaR, max drawdown) | 2 decimal places |
| **Null / non-finite** | **em-dash `—`. Never `0`, never blank, never a fabricated value.** ... |
```
Add one currency row stating D-50's rule verbatim in substance (price ≥ $1 at 2 dp, under $1 at 4
significant digits, P&L 2 dp, sign from the rounded value, zero unsigned and neutral, null em-dash),
and name `src/lib/dollar-validation.ts` as its one formatter module (the Numbers Contract's own "one
formatter module per surface family" rule).

---

### 169-01 KPISOURCE (SC4)

#### `src/lib/factsheet/fetch-and-build-payload.ts` — `resolveFactsheetInputs` embed

Current select (verbatim):
```ts
strategy_analytics ( daily_returns, returns_series, computed_at, data_quality_flags, metrics_json_by_basis, computation_status )`,
```
Widen with the seven `BASIS_KPI_MAP` server keys (RESEARCH Code Examples, SC4). The probe
(`probeFactsheetBuildable`) shares this stage, so the D-22 parity table re-run belongs to 169-06 step 0.

#### `src/lib/factsheet/composite-read-path.ts` — `singleKeyBasisOpts` / `readSingleKeyBasisOpts`

The early return that makes the overlay a no-op today (verbatim):
```ts
if (mtm === undefined && reason === undefined && smoothed === undefined) return {};
```
and the SC-4 rule it must now reconcile with (verbatim comment):
```ts
//    carries NO by-basis object), and NEVER a lingering cash_settlement key (SC-4).
```
The one map to reuse, never duplicate (`src/lib/factsheet/basis-metrics.ts`, `BASIS_KPI_MAP`):
```ts
export const BASIS_KPI_MAP: { tsKey: string; serverKey: string }[] = [
  { tsKey: "cum_ret", serverKey: "cumulative_return" },
  { tsKey: "ann_vol", serverKey: "volatility" },
  { tsKey: "max_dd", serverKey: "max_drawdown" },
  { tsKey: "cagr", serverKey: "cagr" },
  { tsKey: "sharpe", serverKey: "sharpe" },
  { tsKey: "sortino", serverKey: "sortino" },
  { tsKey: "calmar", serverKey: "calmar" },
];
```
and its consumer in `build-payload.ts` (verbatim):
```ts
const strategyMetrics = overlayBasisScalars(computedMetrics, opts?.metricsByBasis?.cash_settlement);
```
Predicate for the "not rankable → no overlay" arm: `isRankableAnalyticsRow` (`src/lib/closed-sets.ts`),
never a status literal (SI-01 census).

#### `src/app/factsheet/[id]/v2/basis-context.tsx` — the cash re-pin (D-25)

The arm whose premise 169-01 makes false (verbatim):
```ts
// excluded (its L=1 KPIs already equal the client recompute).
if (basis === "cash_settlement" || L <= 0) return lb.strategyMetrics;
const persisted = (basis === "mark_to_market"
  ? payload.metricsByBasis?.mark_to_market
  : payload.metricsByBasis?.smoothed_mtm) as Record<string, unknown> | undefined | null;
```
Extend `persisted` to `metricsByBasis.cash_settlement` for the cash basis; the per-scalar withhold
(`out[tsKey] = NaN`) and the Sharpe/Sortino-only re-pin (`tsKey === "sharpe" || tsKey === "sortino"`)
stay as written. Keep the `L <= 0` guard.

#### New tests: `build-payload.headline-source.test.ts`, `basis-context.cash-leverage-repin.test.tsx`

- **Headline test analog:** `MetricsColumn.no-loss-residues.test.tsx` `payloadFrom` (a REAL
  `buildFactsheetPayload` call over synthetic `isoDay(i)` dates) plus a JSON round trip ("the payload
  cache turns NaN into null"). Pin equality on a clean series; on a chain-broken series require the
  existing `dataQuality` caveat (RESEARCH Pitfall 1).
- **Re-pin test analog:** `basis-context.leverage.test.tsx` (verbatim imports):
```ts
import { renderHook, act } from "@testing-library/react";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { deriveSeriesBundle } from "@/lib/factsheet/build-payload";
import { BasisProvider, useBasis, useBasisSeriesView, leverageEligibleFor } from "./basis-context";
import { LeverageProvider, useLeverage } from "./leverage-context";
```
Its `makeDates()` comment is load-bearing for any BTC-touching fixture: dates must sit INSIDE the
bundled BTC history (it starts 2023-04-26) or the comparator leg is all zeros and the assertion is
vacuous.

---

### 169-02 / 169-03 BENCHTRUTH (SC3)

#### `src/lib/factsheet/align.ts` — `alignReturns` (utility)

The fabricating line (verbatim): `if (a != null && b != null && b !== 0) rets.push(a / b - 1); else rets.push(0);`
with `lastP` carried forward. Per RESEARCH Finding M, BTC returns after 169.2 come from
`pricesToDailyReturns(prices, dropped)` and are aligned BY DATE; price-based `alignReturns` must not
be used for BTC (it bridges a dropped close). Test rewrite: **B3**.

#### `src/lib/factsheet/comparator-block.ts` — `buildComparatorBlock`

Whole-series numbers today (verbatim):
```ts
const benchSummary = compute(benchReturns, dates, 0, periodsPerYear);
const joint = jointMetrics(stratReturns, benchReturns, 0, periodsPerYear);
// …
dailyReturns: benchReturns,
```
Covered-span code here must not divide a return-named value by a vol-named one (compute-once gate,
`src/lib/return-stats.single-source.test.ts`, shapes S6 / S8; RESEARCH Pitfall 3). Route any ratio
through `@/lib/return-stats`; never add an allowlist entry.

#### `src/lib/factsheet/types.ts` — optional-field device (D-21)

New fields (`ComparatorBlock.through`, the payload BTC `{ prices, through, dropped }`, `p3y`/`p5y`)
are OPTIONAL so 167.1.2's hand-built `inertComparatorBlock` in `scenario-factsheet-payload.ts`
compiles unedited. Readers treat ABSENT as "no coverage information", distinct from the unavailable
form (`through: null`, `summary: null`).

#### `src/app/factsheet/[id]/v2/page.tsx` — cache key (D-48)

Key and house rule (verbatim):
```ts
// Cache key carries a shape-version suffix. Bump it (e.g. -v2 → -v3)
// whenever FactsheetPayload adds non-optional fields, …
```
`["factsheet-v2-payload-v7", id, computedAt]` → `v8` once, in 169-02, with a lineage line in the
same "Bumped vN→vN+1 (…): reason" voice the comment already carries. Pins that move in the same
commit: `page.public-cache-key.test.tsx` (`expect(cacheKeys).toEqual([["factsheet-v2-payload-v7", STRATEGY_ID, T0]])`),
`page.cache-isolation.test.tsx` (`const EXPECTED_KEY_PREFIX = "factsheet-v2-payload-v7";`), and the
CACHE KEY REALITY paragraph in `fetch-and-build-payload.ts`. 169-03, 169-05 and 169-07 do not bump.

#### `fetch-and-build-payload.benchmark.test.ts` (NEW)

**Analog:** `fetch-and-build-payload.test.ts`'s hoisted-state admin double (verbatim excerpt):
```ts
vi.mock("server-only", () => ({}));
vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }));
const fake = vi.hoisted(() => ({
  strategyResult: { data: null as unknown, error: null as unknown },
  csvRows: [] as { date: string; daily_return: number }[],
  csvError: null as unknown,
  tablesSeen: [] as string[],
  // …
}));
vi.mock("@/lib/supabase/admin", () => { function builder(table: string) { /* select/eq/order/limit chain; thenable for csv_daily_returns */ } … });
```
Add a `benchmark_prices` branch to the builder (thenable, like `csv_daily_returns`) with a `fake`
error slot, so "read error → unavailable, never fixture" (D-09) and D-52's "dated, never +0.00%" are
both provable.

#### `basis-context.benchmark-prices.test.tsx`, `MandatePanels.comparator-coverage.test.tsx`, `TimeSeriesChart.coverage-gap.test.tsx`, `ComparatorPicker.test.tsx`

Analogs: `basis-context.leverage.test.tsx` (hook), `MandatePanels.scenario.test.tsx` (panel render),
`TimeSeriesChart.markers.test.tsx` (chart render), `ComparatorPicker.test.tsx` (itself).
`TimeSeriesChart.tsx` `buildPath` already breaks at null (`const skip = v == null || !Number.isFinite(v) …; prevValid = false`),
so 169-03's chart work may be test-only (RESEARCH 169-03 verdict).

---

### 169-04 CHIP + WINDOWS (SC5, SC6)

#### `src/lib/factsheet/compute.ts` — `compoundFrom`

Verbatim:
```ts
const compoundFrom = (cutoff: Date): number => {
  let c = 1;
  for (let i = 0; i < n; i++) {
    if (new Date(dates[i]) > cutoff) c *= 1 + rets[i];
  }
  return c - 1;
};
```
D-11: return `null` unless the first observation is on or before `cutoff + 1 day`; add `p3y`
(`offsetDays(3 * 365)`) and `p5y` (`offsetDays(5 * 365)`). `years` stays `days / 365.25`.
Test analog: `compute.metrics.test.ts` (30-day `rets` + `dates` built with `Date.UTC(2024, 0, i + 1)`).

#### `src/app/factsheet/[id]/v2/FactsheetView.tsx` — `FreshnessChip`

The mismatch (verbatim):
```tsx
const subject = seriesIsBinding ? "Track record" : "Computed";
// …
<p className="mt-1 text-small font-mono tabular-nums text-text-secondary">
  {formatIsoDate(computedAt)}
  {Number.isFinite(days) && days >= 0 && <span className="ml-1 text-text-muted">({Math.round(days)}d)</span>}
</p>
```
D-16: when `seriesIsBinding`, the date line shows `seriesEnd.formatted` (from the SAME
`resolveSeriesEnd(seriesDates)` already computed in the function) with its own age, and the compute
date moves to a labelled "Computed <date>" line. Keep the `EPOCH_SENTINEL` arm and the
`useState` hoisting comment as they are. Test: extend `FactsheetView.chip-honesty.test.tsx`.

---

### 169-05 RECORDLENGTH + 3Y/5Y (SC5, SC6, D-12, D-17, D-51)

#### `src/lib/factsheet/record-length.ts` (NEW utility)

**Analog:** `src/app/factsheet/[id]/v2/format.ts` — a header stating the unit contract, one pure
function per figure, `"—"` on non-finite (verbatim excerpt):
```ts
export function pctSigned(v: number | null | undefined, dp = PCT_DEFAULT_DP): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const x = v * 100;
  return `${x >= 0 ? "+" : ""}${x.toFixed(dp)}%`;
}
```
`formatRecordLength` takes `compute()`'s calendar `years` and the observation count `n`, states the
length in calendar years and the count as "daily observations" (D-12). No site divides a count by
252 (D-25).

#### `src/lib/factsheet/record-length.test.ts` (NEW)

**Analog:** `src/lib/factsheet/period-buckets.test.ts` (flat `describe`/`it` with literal inputs and
literal expectations), under the `dollar-validation.test.ts` literal-oracle rule quoted above.

#### Sites that call it

- `MetricsColumn.tsx`: `<Row label="Years Observed" value={m.years.toFixed(2)} bench="" />` and
  `⚠ Only {m.n} observations ({(m.n / 252).toFixed(2)}y)` (the observation-clock length D-12 removes).
- `MandatePanels.tsx`: `({payload.strategyMetrics.n.toLocaleString()} trading days, {payload.strategyMetrics.years.toFixed(2)} years).`
  and `<Term label="Sample size">{payload.strategyMetrics.n.toLocaleString()} days · {payload.strategyMetrics.years.toFixed(2)}y</Term>`.
- `MetricsColumn.tsx` `periodReturn` and `<Row label="3 Year" value={pct(periodReturn(3 * 252), true)} … />` /
  `"5 Year"`: delete `periodReturn`; render the rows only when `m.p3y` / `m.p5y` is `!= null`
  (covers absent AND null, D-17 lineage).
- EoY loops: `MetricsColumn.tsx` `const r = cmp.dailyReturns[i];` and `DistributionPanels.tsx`
  `const r = vcmp.dailyReturns[i];` gain a null guard when `dailyReturns` widens (D-21).
  `HistogramChart.tsx` already guards (`cmp.dailyReturns?.[i]`), no edit.
- D-51: the one 167.1.2-07 length assertion (`MetricsColumn.periods-per-year.test.tsx`, arrives with
  C3) is edited with a dated comment naming D-12 and D-51; its threshold assertion stays unedited.

Component test analog for `MetricsColumn.record-length.test.tsx` and `EoyComparatorCoverage.test.tsx`:
`MetricsColumn.no-loss-residues.test.tsx` (verbatim imports):
```ts
import { render } from "@testing-library/react";
import { buildFactsheetPayload } from "@/lib/factsheet/build-payload";
import type { FactsheetPayload } from "@/lib/factsheet/types";
import { FactsheetProvider } from "./factsheet-context";
import { MetricsColumn } from "./MetricsColumn";
```

---

### 169-07 COMPOSITEREADERR (D-41 / R3)

#### `src/lib/factsheet/composite-read-path.ts` — `readCompositeFactsheet`

The fold (verbatim):
```ts
if (sparseErr) {
  // … Fail-SAFE:
  // below, an empty series returns null → placeholder,
  // never the api arm / flat-zero line.
  console.error("[factsheet] readCompositeFactsheet — composite csv_daily_returns read failed", {
    strategyId,
    errorMessage: sparseErr.message,
  });
}
const dailyReturns: DailyReturn[] = (sparseRows ?? []).map(…);
```
Replace with a thrown named error carrying the PostgREST code.

**Named-error class analog** (`fetch-and-build-payload.ts`, `FactsheetProbeTimeoutError`, verbatim;
the exported-class shape `CompositeSeriesReadError` should copy):
```ts
export class FactsheetProbeTimeoutError extends Error {
  readonly deadlineMs: number;
  constructor(deadlineMs: number) {
    super(`factsheet probe: no answer within ${deadlineMs} ms`);
    this.name = "FactsheetProbeTimeoutError";
    this.deadlineMs = deadlineMs;
  }
}
```
(`FactsheetReadError` in `page.tsx` is the module-private sibling of the same shape.)

#### `fetch-and-build-payload.ts` — resolve stage catch

Map the class to the existing outage vocabulary, same as the strategies-read arm (verbatim):
```ts
const code = error.code || "none";
// …
if (caller === "build") {
  captureToSentry(new Error(`factsheet resolve: admin strategy read failed (${code})`), {
    tags: { stage: "factsheet-resolve", caller, reason: "read_error", code, strategy_id: id },
  });
}
return notBuildable("read_error", { code });
```
Catch ONLY `CompositeSeriesReadError` around `readCompositeFactsheet(...)`; everything else rethrows.
`probeFactsheetBuildable` then answers `read_error` for free (shared stage).

#### `page.tsx` — remove the accepted-residual comment

The paragraph starting `⚠️ Accepted residual under D-07, owned by Phase 169 plan 04` inside
`buildFactsheetPayloadCached` is now false; replace with a dated line naming D-41. The throw
(`if (built.reason === "read_error") throw new FactsheetReadError();`) already covers the new case.

#### `page.composite-read-error.test.tsx` (NEW)

**Analog:** `page.public-cache-key.test.tsx` — the `unstable_cache` double that stores `null` the way
Next does (verbatim excerpt) and the `it("READ-ERROR-NOT-CACHED …")` two-request shape (request 1
fails → placeholder sentence `"The detailed factsheet for this strategy is not available yet."`,
captured once; request 2 recovers → builds, `adminReads` is 2):
```ts
const cacheStore = vi.hoisted(() => new Map<string, unknown>());
const cacheKeys = vi.hoisted(() => [] as unknown[][]);
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn: (...args: unknown[]) => Promise<unknown>, keyParts: unknown[]) =>
    async (...args: unknown[]) => {
      cacheKeys.push(keyParts);
      const key = JSON.stringify([keyParts, args]);
      if (cacheStore.has(key)) return cacheStore.get(key);
      // A throw propagates before the store, as Next's miss path does
      const value = await fn(...args);
      // …
```
Its header warns: "An identity stub (`(fn) => fn`) would make every case below vacuous". Copy the
real-store double, not an identity stub. Composite arm: set the csv read to fail, then recover.

---

## Shared Patterns

### One formatter, one module (money and percent)
**Sources:** `src/lib/dollar-validation.ts` header (money); `src/__tests__/format-percent-contract.test.ts`
header (percent); DESIGN.md "Rule: one formatter module per surface family".
**Apply to:** RISKUNIT, MONEYFMT. Never declare a local `formatPercent` (the contract test walks
`src/` and fails on it). Never add a per-table money formatter.

### Null is the em-dash; zero is not red
**Source:** DESIGN.md Numbers Contract null row + Color gates; `formatUsd` JSDoc "`null` renders the
em-dash, never `$0` (no-invented-data)"; `RiskAttribution` 166.1 D7 null arms.
**Apply to:** every formatter and cell touched in this phase.

### Literal oracles in tests
**Source:** `src/lib/dollar-validation.test.ts` header (quoted above).
**Apply to:** every new formatter / window / record-length test. Expected values are typed literals,
never computed by the module under test.

### Outage is thrown; fact is returned; the cache stores nothing on a throw
**Source:** `page.tsx` `FactsheetReadError` + `buildFactsheetPayloadCached` comment (Next 16.2.11
`unstable_cache` awaits the callback before `cacheNewResult`); `fetch-and-build-payload.ts`
`notBuildable("read_error", { code })`.
**Apply to:** 169-07. 169-02's benchmark read blip is the deliberate exception (D-52: the honest
unavailable form may be cached for the TTL).

### Compute once
**Source:** `src/lib/return-stats.single-source.test.ts` (whole-tree shape matcher); D-25.
**Apply to:** every `src/` edit, especially `comparator-block.ts` and `align.ts`. A red gate is fixed
by routing through `@/lib/return-stats`, never by an allowlist entry.

### Optional-field device for cross-phase types
**Source:** D-21; `ComputeResult` / `ComparatorBlock` in `src/lib/factsheet/types.ts`.
**Apply to:** 169-02, 169-03, 169-04, 169-05. A required field on these types fails `tsc` in the
167.1.2 file `scenario-factsheet-payload.ts`.

### Neuter → RED → restore (SC9)
**Apply to:** every fix. Named neuter targets: RISKUNIT, drop the `/ 100`; MONEYFMT, restore the
`n >= 0 ? "+"` sign rule; 169-07, restore the `(sparseRows ?? [])` fold; 169-04, restore
`compoundFrom`'s never-null return.

---

## No Analog Found

| File / symbol | Role | Data Flow | Reason |
|---|---|---|---|
| `src/lib/factsheet/benchmark-source.ts` (`readBenchmarkPrices`, `mergeWithFixture`, `pricesToDailyReturns`, `BenchmarkReadResult` incl. `dropped`) | service | CRUD read | **Not on disk at HEAD** (`git ls-files` empty). It is an external contract on `origin/feat/169.2` (PR #879), read with `git show`. 169-02 / 169-03 consume it only after the orchestrator merge (D-47); re-read its exports at that sync (RESEARCH A5). Never cite it as a HEAD analog. |

---

## Metadata

**Analog search scope:** `src/lib/factsheet/`, `src/app/factsheet/[id]/v2/`,
`src/app/factsheet-share/`, `src/app/(dashboard)/allocations/components/` and `lib/`,
`src/components/portfolio/`, `src/lib/{utils,types,dollar-validation,portfolio-analytics-adapter}.ts`,
`src/__tests__/`, `DESIGN.md`.
**Files scanned:** about 40 read or grepped.
**Pattern extraction date:** 2026-09-27
