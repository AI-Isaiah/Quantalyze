# Phase 237: FACTSHEETHONEST - Pattern Map

**Mapped:** 2026-11-23
**Files analyzed:** 42 (8 new, 34 modified; 16 of the 34 are existing tests extended or flipped in place; re-measure-only tests are listed but not counted)
**Analogs found:** 42 / 42 whole files. Match split: 34 modified files are `exact` (the analog is the file itself or its sibling test); of the 8 new files, 3 are `exact` (the census, `route.cache-ttl.test.tsx`, `page.owner-trust-tier.test.tsx`) and 5 are `role-match` (`analytics-hold.ts`, `cache-control.ts`, `owner-trust-tier.ts`, `MetricsColumn.withheld-panels.test.tsx`, `page.rerun-hold.test.tsx`). Whole files with no analog: 0. Sub-pieces with no analog: 2 (see "No Analog Found").
**Base:** worktree `quantalyze-wt-237`, branch `gsd/phase-237-factsheethonest`. Every analog path below was checked with `git ls-files` and is tracked source (no `.gsd/capabilities` mirror is named).

Line numbers are HEAD at mapping time. The repo's own rule applies: cite by symbol if a number has drifted (`grep -n` the symbol first).

---

## READ THIS FIRST: three conflicts and one trap

**CONFLICT 1 - the not-found OG cache value (CONTEXT vs RESEARCH vs UI-SPEC).**
`237-CONTEXT.md` "Research follow-ups" (2026-11-23) **supersedes** its own "about 60 s" value. CONTEXT is the locked source. The header ladder is:

| Card case | `Cache-Control` |
|---|---|
| read or compute failed (`failed`) | `no-store` (existing `FAILURE_CACHE_CONTROL`) |
| genuine not-found (`data === null && !failed`: unknown, unpublished, malformed alike, one identical header and card) | **`no-store`** |
| published but rendered WITHOUT figures (first compute, failed row, composite re-stitch, D-04 unbound prestamp, or an admitted row with under 2 series points: i.e. `!figuresRendered`, see LADDER GAP) | **`no-store`** |
| rendered during a held re-run (figures plus the Updating line) | `SHORT_CACHE_CONTROL = "public, max-age=60, s-maxage=60"` |
| rendered terminal data | `LONG_CACHE_CONTROL` (unchanged) |

`237-RESEARCH.md` (Code Examples "Held OG card header ladder", Open Question 1 and 2, PROOF-01 row "CACHE-01", test map row `route.cache-ttl.test.tsx` "request 3 at t0+61 s") and `237-UI-SPEC.md` section 4.1 table still say SHORT for the not-found card. **Do not copy those.** The planner should use the CONTEXT ladder above. Consequences: the existing tests F2 and P1-P3 flip to `no-store` (not to the short value); the good-after-bad double sees the real card on the very next request (the double already honors `no-store`); the 61 s step applies only to the held-re-run case. The existence-oracle rule still binds: unknown, unpublished and malformed get byte-identical header and card.

**CONFLICT 2 - the evidence-column list is a dependency, not a detail.** Adding the hold to a surface without widening its `select` makes the hold dead code (RESEARCH Pitfall 1). Every surface plan must widen the select in the same task as the gate and assert the select string in a route test (the OG `O4` test records it).

**CONFLICT 3 - FACT-02 reach is smaller than the founder's list.** Portfolios, `getStrategyDetailV2`, `getPublicStrategyDetail`, `getStrategyDetail` are deleted at HEAD. They are census entries of class `retired`, asserted mechanically, never work items.

**CONFLICT 4 - `getFactsheetDetail` is census-only, not edited.** CONTEXT "Research follow-ups" says it "is classified in the census, not widened: the tear sheet's figures come from the payload builder, which already holds; its `analytics` output is only null-checked." `237-RESEARCH.md` (S2b, Open Question 5) recommends widening its select with the alias set. **Do not copy that.** CONTEXT is locked: leave `getFactsheetDetail` and `PUBLIC_ANALYTICS_COLUMNS` untouched, classify it in the census, and cover the tear sheet with the T5b seam test only.

**LADDER GAP the planner must decide (flagged, not resolved here).** CONTEXT's words are "any published card rendered WITHOUT figures" gets `no-store`. The route's figures actually print only when `hold.admitted && rows.length >= 2` (`route.tsx:273`). Keying the header on `!hold.admitted` alone leaves an admitted row with fewer than 2 points (dashes, no error) on `LONG_CACHE_CONTROL`, the same stale-blank-for-a-day defect. Recommendation: key on a `figuresRendered` boolean (`hold.admitted && rows.length >= 2`, declared beside the NaN sentinels, false by default so a throw in the compute `try` also lands on `no-store`). Reversible, one condition.

**TRAP - never import `MetricsColumn` from `AnalyticalPanels.tsx` or `BatchDPanels.tsx`.** `MetricsColumn.tsx` already imports both (lines 33-34); a back-import is a cycle. `DistributionPanels.tsx` already imports from `./MetricsColumn` (line 8), so only it may import `headlineCoverageNote` directly. For Calmar and Style Drift, compute the note in `MetricsColumn` and pass it down as a prop (see FACT-01 below).

---

## File Classification

### FACT-01 (display, client components)

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/app/factsheet/[id]/v2/MetricsColumn.tsx` | component | transform | itself: span-note markup `:512-515`, gates `:318-319`, `headlineCoverageNote` `:118-168` | exact |
| `src/app/factsheet/[id]/v2/AnalyticalPanels.tsx` (`CalmarByYearPanel`) | component | transform | itself `:286-345` (existing last-year dash) | exact |
| `src/app/factsheet/[id]/v2/BatchDPanels.tsx` (`StyleDriftPanel`) | component | transform | itself `:33-125` | exact |
| `src/app/factsheet/[id]/v2/DistributionPanels.tsx` (`EndOfYearBarsPanel`) | component | transform | itself `:37-100` (existing `fullHistoryWithheld` prop) | exact |
| `src/app/factsheet/[id]/v2/HeatmapPanels.tsx` (`MonthlyRow`) | component | transform | itself `:110-122`, `:195-210` | exact |
| `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` + `chart-configs.ts` + `FactsheetView.tsx` wrappers | component | event-driven (hover) | `showStratAverage` config field threaded from `FactsheetView.tsx:1038-1046,1127` | role-match |
| `src/app/factsheet/[id]/v2/MetricsColumn.withheld-panels.test.tsx` (NEW) | test | request-response | `FactsheetView.headline-coverage.test.tsx` (`renderColumn` `:167`, `rowsOf`, `readCell` `:964`) | role-match |
| `src/app/factsheet/[id]/v2/FactsheetView.headline-coverage.test.tsx` (REWRITE D1 `:1238`, D4 `:1253`, WR-01 `:1265`) | test | request-response | itself | exact |

### FACT-02 (hold: shared helper plus seven surfaces plus census)

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/analytics-hold.ts` (NEW) | utility | transform | `src/lib/factsheet/fetch-and-build-payload.ts:416-445,506` (the rule it restates) plus `src/lib/factsheet/headline-basis.ts:206-212` (`isStoredResultReadable`, small pure composer) | role-match |
| `src/lib/factsheet/cache-control.ts` (NEW) | utility | request-response | `src/app/api/og/factsheet/[id]/route.tsx:41-46` (two constants) plus `src/lib/api/headers.ts` (shared header module) | role-match |
| `src/lib/factsheet/og-metrics.ts` | utility | transform | itself `:93-182`; `storedCashHeadlineGate` (starts `headline-basis.ts:234`) already takes `recomputeOverStoredResult = false` (`:238-242`) | exact |
| `src/app/api/og/factsheet/[id]/route.tsx` | route | request-response | itself | exact |
| `src/app/api/factsheet/[id]/pdf/route.ts` | route | request-response | itself `:225-262`, `:305-322`, `:415-445` | exact |
| `src/app/api/factsheet/[id]/tearsheet.pdf/route.ts` | route | request-response | itself `:182-216`, `:258-275` | exact |
| `src/app/api/strategies/[id]/returns/route.ts` | route | request-response | itself `:360-470` (`analyticsRankable` single decision point) | exact |
| `src/app/(dashboard)/recommendations/page.tsx` | page (server) | CRUD read | itself `:283-326` (`computedById`) | exact |
| `src/lib/queries.ts` (`getMyAllocationDashboard` embed `:6055-6065`, builder `:6280-6345`, `:6440-6460`, payload type `:2640-2665`) | service | CRUD read | itself (`series_state` beside the field to add; `_cs`/`_dqf` strip idiom) | exact |
| `src/lib/queries.ts` `getFactsheetDetail` (`:1735`): **NOT EDITED** (CONFLICT 4); census classification only | service | CRUD read | n/a (census entry; its tear sheet is covered by T5b) | n/a |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | component | event-driven | itself: `addedSeriesStateByRef` `:2666-2675`, note slot `:8690-8760` | exact |
| `src/lib/degrade-warnings.ts` (+ `degrade-warnings.test.tsx` SAMPLES, `degrade-warning-scan.test.ts` ledger) | config | transform | `factsheet.analytics-updating` entry `:1149-1154` | exact |
| `src/__tests__/recompute-verdict-census.test.ts` (NEW) | test | batch (source scan) | `src/__tests__/figure-gate-census.test.ts` (whole file) plus `src/lib/complete-status-scan.test.ts` (count-keyed allowlist) | exact |
| `src/app/(dashboard)/recommendations/page.rerun-hold.test.tsx` (NEW) | test | request-response | `page.stale-analytics.test.tsx` beside it (read it first) | role-match |
| `src/app/factsheet/[id]/tearsheet/page.stale-analytics.test.tsx` (add T5b) | test | request-response | itself, T5 | exact |

### FACT-04 and CACHE-01 / CACHE-03

| New/Modified File | Role | Data Flow | Closest Analog | Match |
|---|---|---|---|---|
| `src/lib/factsheet/owner-trust-tier.ts` (NEW) | service | CRUD read (fail-soft) | `readPublicVerificationSignals` `src/lib/queries.ts:1557-1617` (error/capture posture) plus the Lane B share-state read in `v2/page.tsx:640-681` (request-scoped client, `captureToSentry` with `route` + `stage`) | role-match |
| `src/app/factsheet/[id]/v2/page.tsx` (Lane B call `:610-690`, overlay `:953-968`, cache callback `:218-224`, key `:307`, error classes `:113-143`) | page (server) | request-response | itself | exact |
| `src/app/factsheet/[id]/v2/page.owner-trust-tier.test.tsx` (NEW) + owner-lane harness edits | test | request-response | `page.owner-lane.test.tsx` (`mockRequestClient` `:227-266`) and `page.usd-trust.test.tsx` | exact |
| `src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx` (add CACHE-03 case) | test | request-response | itself, `READ-ERROR-NOT-CACHED` `:250-281` | exact |
| `src/app/api/og/factsheet/[id]/route.cache-ttl.test.tsx` (NEW) | test | request-response | `route.public-access.test.tsx` harness (`:62-143`) | exact |
| `src/app/api/og/factsheet/[id]/route.test.tsx` F2 `:590`, `route.public-access.test.tsx` P1-P3 | test | request-response | themselves (flip LONG to `no-store`) | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` `:2956-2962` + `FactsheetView.usd-toggle.test.tsx:379` + `degrade-warnings.test.tsx:1045-1056` | component/config/test | transform | `A-RELOAD` vocabulary `degrade-warnings.ts:153` | exact |

### Existing tests extended or re-measured in place (analog: the file itself)

| File | What moves | Role | Data Flow | Match |
|---|---|---|---|---|
| `src/app/api/og/factsheet/[id]/route.stored-parity.test.tsx` | held-card figures plus the line, SHORT header; terminal stays LONG (RESEARCH test map S5) | test | request-response | exact |
| `src/app/api/og/factsheet/[id]/route.test.tsx`, `route.public-access.test.tsx` | F2, P1-P3 flip to `no-store`; O4 records the select string (assert the new column) | test | request-response | exact |
| `src/app/api/factsheet/[id]/pdf/route.test.ts`, `src/app/api/factsheet/[id]/tearsheet.pdf/route.test.ts` | held door admitted (no 400), SHORT header, held ETag, held 304 short; terminal keeps its header | test | request-response | exact |
| `src/app/api/strategies/[id]/returns/route.test.ts` | `analytics_updating` always present; held series and scalars | test | request-response | exact |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`, `src/lib/queries.my-allocation.test.ts` | S8/S8b line, book-wins-over-S6 precedence, payload keys (the two stripped columns must not appear) | test | event-driven / CRUD | exact |
| `src/lib/degrade-warnings.test.tsx`, `src/__tests__/degrade-warning-scan.test.ts`, `src/app/factsheet/[id]/v2/FactsheetView.usd-toggle.test.tsx` | USD entry pin `:1045-1056`, new SAMPLES entry, `scenario` ledger id list, verbatim sentence `:379` | test | transform | exact |
| `src/app/factsheet/[id]/v2/page.owner-lane.test.tsx`, `page.usd-trust.test.tsx`, `src/app/factsheet-share/[token]/page.cache-isolation.test.tsx` | owner-lane harness answers `strategy_verifications`; both-views shape; `EXPECTED_KEY_PREFIX` if the key bumps | test | request-response | exact |
| Re-measure only (no edit expected): `MetricsColumn.no-loss-residues.test.tsx`, `MetricsColumn.parts.test.tsx`, `MetricsColumn.headline-bench.test.tsx`, `FactsheetView.window-kpis.test.tsx`, `FactsheetBody.census.test.tsx` (all under `src/app/factsheet/[id]/v2/`), `src/__tests__/copy-census.test.ts`, `src/lib/complete-status-scan.test.ts` | `headlineWithheld: true` fixtures; empty-frame counter; copy census pin; SI-01 only moves if a `=== 'complete'` site changes | test | request-response | exact |

---

## Pattern Assignments

### `src/lib/analytics-hold.ts` (NEW; utility, transform)

**Analog:** the factsheet resolve stage, `src/lib/factsheet/fetch-and-build-payload.ts`. This file restates one existing rule for reuse; it must not become a second rule.

**The three predicates, verbatim from the resolve stage** (lines 416-420, 441, 506):
```typescript
const analyticsUpdating = isRecomputeOverStoredResult(
  analytics?.computation_status,
  hasStoredAnalyticsResult(analytics),
);
// ...
if (isComputedAnalytics(analytics?.computation_status) && hasUnboundDerivePrestamp(analytics)) {
  /* ... */ return notBuildable("not_computed");
}
// ...
if (isComposite && analyticsUpdating) {
  return notBuildable("not_computed");
}
```

**Imports** (match how the resolve stage and og-metrics import; keep this module free of `server-only`, the OG route imports closed-sets directly):
```typescript
import { isComputedAnalytics, isRecomputeOverStoredResult } from "@/lib/closed-sets";
import {
  effectiveDataQualityFlags,
  hasStoredAnalyticsResult,
  hasUnboundDerivePrestamp,
} from "@/lib/stored-analytics-result";
```

**Core shape** (from RESEARCH Pattern 1; names are mine, predicates are the repo's):
```typescript
export function analyticsHold(row: HoldRow | null | undefined) {
  const status = typeof row?.computation_status === "string" ? row.computation_status : null;
  const composite = effectiveDataQualityFlags(row).flags?.composite === true;
  const updating = isRecomputeOverStoredResult(status, hasStoredAnalyticsResult(row)) && !composite;
  const terminalOk = isComputedAnalytics(status) && !hasUnboundDerivePrestamp(row);
  return { updating, admitted: terminalOk || updating };
}
```

**Rules to carry into the plan (cited from source docblocks):**
- `isRecomputeOverStoredResult` (`closed-sets.ts:823-828`) is `hasStoredResult && (status === "pending" || status === "computing")`. A `failed` row is never admitted. Never widen `isComputedAnalytics` (`:808`) or `isRankableAnalyticsRow` (`:871`) for this: progress consumers read them as "a run ended" (docblock `:812-822`).
- Flags for the stored numbers come from `effectiveDataQualityFlags(row).flags` (`stored-analytics-result.ts:122`), never `row.data_quality_flags`: during the derive prestamp window the live flags are the new derive's (unit, curve method, composite, tiny-base days all wrong).
- A projection without the flags blob cannot answer `hasUnboundDerivePrestamp` (it returns false, `stored-analytics-result.ts:225-237` docblock). Recommendations therefore applies the evidence rule only (and, for the same reason, cannot answer the helper's `!composite` term either: that flag lives in the blob); record both exemptions in the census classification (Phase 190 plan 07 precedent). `getFactsheetDetail` is census-only (CONFLICT 4).
- `stored-analytics-result.ts` itself stays import-free (its header, `:5-8`). Do not add the helper there.

---

### `src/lib/factsheet/cache-control.ts` (NEW; utility)

**Analog:** the two constants in the OG route (`route.tsx:41-46`) and the shared-header module `src/lib/api/headers.ts` (an `as const` export object, one source for every route).

**Constants to lift (currently route-private):**
```typescript
/** A healthy card, or a genuine not-found: amortised across many unfurl hits. */
const LONG_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";
const FAILURE_CACHE_CONTROL = "no-store";
```
Add `SHORT_CACHE_CONTROL = "public, max-age=60, s-maxage=60"` (no `stale-while-revalidate`, deliberate, UI-SPEC 4.1). A route file must not export non-handler names (Next route modules), which is why this is a lib module and why both PDF routes can import it.

**Note for tests:** `route.public-access.test.tsx:151-157` reads `FAILURE_CACHE_CONTROL` by regex out of `route.tsx` source (`/const FAILURE_CACHE_CONTROL\s*=\s*"([^"]+)"/`). If the constant moves to the lib module that helper breaks. Either keep `FAILURE_CACHE_CONTROL` defined in `route.tsx` or repoint the helper to import the lib constant. Decide once and update the one helper.

---

### `src/app/api/og/factsheet/[id]/route.tsx` (route, request-response)

**Analog:** itself. Add the select column, the hold, the line, the header ladder.

**Select edit** (`:163-165`: add `computed_at` to the embed; the concatenation with `RECORD_SCALAR_ALIASES` stays a `string`, comment `:157-162` explains why):
```typescript
"id, name, codename, description, asset_class, strategy_analytics ( daily_returns, returns_series, computation_status, cumulative_return, volatility, cagr, sharpe, sortino, calmar, max_drawdown, data_quality_flags, metrics_json_by_basis, " +
  RECORD_SCALAR_ALIASES +
  " )",
```
Also add `computed_at?: unknown;` to the `AnalyticsEmbed` type (`:74-92`).

**Gate edit** (`:260-277`, replace the `isComputedAnalytics` line; keep the comment that explains why the gate lives in-route):
```typescript
const analyticsComputed = isComputedAnalytics(computationStatus);
// ...
if (analyticsComputed && rows.length >= 2) {
  ({ sharpe, cagr, maxDd } = computeOgHeadline(rows, data?.asset_class, analytics));
```
becomes `const hold = analyticsHold(analytics); if (hold.admitted && rows.length >= 2) { figuresRendered = true; ... computeOgHeadline(rows, data?.asset_class, analytics, hold.updating)}` with `let figuresRendered = false;` declared beside the sentinels. Take `unit` (`:232-235`) and `curveMethodFromFlags` (`:240`) from `effectiveDataQualityFlags(analytics).flags`, not from `analytics.data_quality_flags`.

**The line** (draw after `figureNote`, UI-SPEC S5): copy the existing `figureNote` element at `:346-348` and change only the top gap:
```tsx
{figureNote && (
  <div style={{ marginTop: 24, fontSize: 20, color: "#64748B" }}>{figureNote}</div>
)}
{hold.updating && (
  <div style={{ marginTop: figureNote ? 8 : 24, fontSize: 20, color: "#64748B" }}>{ANALYTICS_UPDATING_LINE}</div>
)}
```
Import `ANALYTICS_UPDATING_LINE` from `@/lib/status-surface-copy` (`:701`); never inline the sentence. `hold` must be declared in the same scope as the `let sharpe = NaN ...` sentinels (`:203-217`) so a throw leaves it false and the card still renders.

**Header ladder** (replace `:366`):
```typescript
response.headers.set("Cache-Control", failed ? FAILURE_CACHE_CONTROL : LONG_CACHE_CONTROL);
```
becomes (CONTEXT ladder, see CONFLICT 1):
```typescript
const notFound = data === null && !failed;
const cacheControl = failed || notFound || !figuresRendered   // see LADDER GAP: or `!hold.admitted` if the planner keeps the narrower reading
  ? FAILURE_CACHE_CONTROL           // no-store
  : hold.updating ? SHORT_CACHE_CONTROL : LONG_CACHE_CONTROL;
```
`hold` and `figuresRendered` must default to not-admitted / false when `data` is null or the compute `try` threw. The three not-found paths (malformed `isUuid` `:118-121`, no row, unknown) all leave `data === null && !failed`; keep them on one branch so the header is no existence oracle.

**Version bump:** `OG_CARD_VERSION` `og-metrics.ts:191` `"2"` becomes `"3"` (docblock `:184-190`). Tests import the constant (`page.public-cache-key.test.tsx` does), so no literal to chase.

**Error handling pattern to keep untouched:** `reportOgFailure` (`:51-65`), `failed = true` in both catch blocks (`:175-177`, `:179-184`, `:295-298`).

---

### `src/lib/factsheet/og-metrics.ts` (utility, transform)

**Analog:** itself. `computeOgHeadline` has three inner gates that each read the raw status; they all need the hold flag or the card stays blank even after the route admits the row.

Today (`:93-115`):
```typescript
export function computeOgHeadline(
  rows: ReadonlyArray<{ date: unknown; value: number }>,
  assetClass: string | null | undefined,
  persisted?: OgPersistedScalars | null,
): { sharpe: number; cagr: number; maxDd: number } {
  ...
  const status = persisted?.computation_status;
  const stored = isRankableAnalyticsRow({ computation_status: typeof status === "string" ? status : null })
    ? persisted
    : undefined;
  const gate = storedCashHeadlineGate(persisted, persisted?.metrics_json_by_basis, status);
  if (headlineVerdict(persisted?.data_quality_flags, gate, status).kind === "withheld") {
    return { sharpe, cagr, maxDd };
  }
```
Edit: add a fourth parameter `recomputeOverStoredResult = false` (same default idiom as `storedCashHeadlineGate`'s, `headline-basis.ts:234-242`); replace `isRankableAnalyticsRow(...)` with `isStoredResultReadable(status, recomputeOverStoredResult)` (`headline-basis.ts:206-212`); pass the flag as `storedCashHeadlineGate`'s fourth argument; read `data_quality_flags` for `headlineVerdict` and the E2 suffix flags (`:120-125`) through `effectiveDataQualityFlags`. Keep the default `false` so the other caller behaves as before (the docblock at `headline-basis.ts:200-205` says exactly this).

---

### `src/app/api/factsheet/[id]/pdf/route.ts` and `tearsheet.pdf/route.ts` (route, request-response)

**Analogs:** themselves. Both gate with a literal pair, so the SI-01 scan (`=== "complete"` only) never saw them.

**Door today** (identical in both; `pdf/route.ts:247-261`, `tearsheet.pdf/route.ts:~203-214`):
```typescript
const analytics = extractAnalytics(strategy.strategy_analytics);
if (
  !analytics ||
  (analytics.computation_status !== "complete" &&
    analytics.computation_status !== "complete_with_warnings")
) {
  return NextResponse.json({ error: "Analytics not computed" }, { status: 400 });
}
```
**Select today:** `pdf` `:236-238` `"id, name, status, strategy_analytics (computation_status, computed_at)"`; `tearsheet.pdf` `:187` `"id, name, status, strategy_analytics (computation_status)"`.

**Change:** widen both selects to `computation_status, computed_at, cumulative_return, daily_returns, returns_series, data_quality_flags`; replace the door with `const hold = analyticsHold(analytics); if (!analytics || !hold.admitted) return 400`. (`extractAnalytics`, `src/lib/utils.ts:250-255`, returns the embed row unprojected, so the extra columns reach `analyticsHold`.)

**Cache and ETag, `pdf` only** (RESEARCH Pitfall 4). Today:
```typescript
const etag = `"${id}:${analytics.computed_at ?? ""}"`;                    // :307
...  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",  // :316 (304 branch) and :424 (200 branch)
```
A held render and the terminal render of the same `computed_at` share an ETag and the 304 branch runs before the render, so a client holding the terminal PDF would be told 304 during a re-run. Give a held ETag a suffix (for example `:updating`) and send `SHORT_CACHE_CONTROL` on both the held 304 and the held 200. Terminal PDFs keep their header. `tearsheet.pdf` has only a 200 header (`:~258-275`, keep its `Vary`).

**Do not** admit pending/computing at the door and let the page decide (RESEARCH "Alternatives Considered"): that turns a 400 into a 409 on `pdf` (`:380`) and a 503 plus a Sentry `marker_absent` error on `tearsheet.pdf` (`:~233-250`).

---

### `src/app/api/strategies/[id]/returns/route.ts` (route, request-response)

**Analog:** itself. `analyticsRankable` is the single decision point (comment `:442-447`): everything the route withholds hangs off one boolean, so swap that boolean and the rest follows.

**Select today** (`:360-364`):
```typescript
.select(
  `daily_returns, returns_series, computation_status, data_quality_flags, cagr, sharpe, ${RECORD_SCALAR_ALIASES}`,
)
```
Add `cumulative_return, computed_at` (both are missing today, so `hasStoredAnalyticsResult` would always answer false). Add the two keys to the `analyticsRow` cast (`:~393-405`).

**Decision point today** (`:447-449`):
```typescript
const analyticsRankable = isRankableAnalyticsRow({ computation_status: status });
const daily_returns: DailyPoint[] = analyticsRankable ? resolveDailyReturnSeries(..., curveMethodFromFlags(analyticsRow?.data_quality_flags)) : [];
```
Replace with `const hold = analyticsHold(analyticsRow); const analyticsRankable = hold.admitted;` (keep the name so the dozen downstream uses `cagr`, `sharpe`, `figure_*` do not churn, or rename once and sweep). Then read curve method (`:456`, `:573`), `dqf` (`:551` composite, `native_unit`, `tiny_base_days`) through `effectiveDataQualityFlags(analyticsRow).flags`.

**Machine surface carries a field, never text.** Add to `ReturnsResponse` (`export interface ReturnsResponse` is declared in this same file, `route.ts:92`) and to the `body` literal (`:~597-612`), always present:
```typescript
analytics_updating: hold.updating,
```
Snake case matches `series_state`, `figure_unreadable`, `is_composite` on the same body. The route is already `NO_STORE_HEADERS` (`:616`), so no header change. Keep `withPublishedOrOwner` and the allocator-auth wrapper unchanged (the field is emitted only after the existing visibility probe).

**Figure-gate census:** this route is in `figure-gate-census.test.ts` `EXCLUDED` as `"no render"` and in `TOUCHED_BUT_EXCLUDED` (`:89`, `:135`); adding no figure-gate import keeps it valid.

---

### `src/app/(dashboard)/recommendations/page.tsx` (page, CRUD read)

**Analog:** itself `:283-326`.

**Select today:** ``strategy_id, computation_status, trades_fetched_at, ${RECORD_SCALAR_ALIASES}`` and `computedById.set(r.strategy_id, isRankableAnalyticsRow(r));` (`:317`).

**Change:** this is a list projection with no flags blob, so use the alias form. Widen the select with the evidence aliases, copied byte for byte from `CATEGORY_RANKING_ANALYTICS_COLUMNS` (`queries.ts:598`):
```
cumulative_return, computed_at, cumulative_method:data_quality_flags->>cumulative_method, last_success_cumulative_method:data_quality_flags->last_success_snapshot->flags->>cumulative_method, last_success_computed_at:data_quality_flags->last_success_snapshot->>computed_at
```
`computedById` becomes `hold.admitted`; add a parallel `updatingById` map and an `analytics_updating` field on the `candidates` entries; render in `RecommendationCard` (`:557`, `Metric` row at `:626-642`, `Metric` fn `:662`):
```tsx
{c.analytics_updating && (
  <p className="mt-2 text-xs text-text-muted" data-testid="recommendation-analytics-updating">{ANALYTICS_UPDATING_LINE}</p>
)}
```
Exemption: no `hasUnboundDerivePrestamp` on this projection (record it in the census). Keep the existing cast comment at `:307-309` (postgrest-js cannot parse the negative JSONB index). Measure on a CSV fixture before trusting the `series_end` alias (RESEARCH A2). `RecommendationCard` is not a degrade-registry surface: import the constant directly (UI-SPEC 2.4).

---

### `src/lib/queries.ts` (service, CRUD read)

**(a) Book embed, `getMyAllocationDashboard`** (S8b). **Analog:** the `series_state` field and the `_cs` / `_dqf` strip idiom.

Embed today (`:6055-6065`): `strategy_analytics ( daily_returns, cagr, sharpe, volatility, max_drawdown, data_quality_flags, returns_series, computation_status, record_observations:metrics_json->record_observations )`. Add `cumulative_return` and `computed_at`.

Strip idiom (`:6286-6294`), extend with two more throwaway names so neither reaches the client (RESEARCH Pitfall 7):
```typescript
const {
  data_quality_flags: _dqf,
  returns_series: _rs,
  computation_status: _cs,
  // 194 D-15: read below for `figure_observations`, then dropped.
  record_observations: _ro,
  ...analyticsRest
} = analyticsObj;
```
Verdict beside `series_state` (`:6335-6338`; `seriesStatus` is already read at `:6322-6325`):
```typescript
const series_state: SeriesState =
  resolvedDailyReturns.length > 0 ? "available" : deriveEmptySeriesState(seriesStatus, strategyCreatedAt);
```
add `const analytics_updating = analyticsHold(analyticsObj).updating;` and set `analytics_updating,` next to `series_state,` at `:6451`. Type it on the payload beside `series_state: SeriesState;` (`:2661`), docblock in the same voice as the `series_state` one (`:2650-2660`): always present, raw `computation_status` never ships. Assert the payload keys in `queries.my-allocation.test.ts`.

**(b) `getFactsheetDetail`** (`:1735`, S2b). **Make no edit** (CONTEXT: "classified in the census, not widened"; this supersedes RESEARCH S2b / Open Question 5). Its `analytics` output (the `shapeRowAnalytics` result) is only null-checked by `tearsheet/page.tsx`, and every tear sheet figure comes from the payload builder. The census records that its own `analytics` stays blank during a re-run and that this is deliberate. The reader it calls, `shapeRowAnalytics`, already holds: the Phase 190 arm at `queries.ts:966-968` is the reference for how a list-shaped row is held (`isRecomputeOverStoredResult(a.computation_status, hasStoredAnalyticsResult(a)) -> { ...shapeStoredAnalytics(a), analytics_updating: true }`).

---

### `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (component, event-driven)

**Analog:** itself, the precedence model `addedSeriesStateByRef` (`:2666-2675`):
```typescript
const addedSeriesStateByRef = useMemo<Record<string, SeriesState>>(() => {
  const map: Record<string, SeriesState> = {};
  for (const a of scenario.draft.addedStrategies) {
    const found = strategyById.get(a.id);
    map[a.id] = found
      ? narrowSeriesState(found.strategy.series_state)
      : (addedSeriesStateById[a.id] ?? "available");
  }
  return map;
}, [scenario.draft.addedStrategies, strategyById, addedSeriesStateById]);
```
Copy it as `addedAnalyticsUpdatingByRef` (book payload wins, else the lazy S6 value, else `false`). Parse the lazy fetch strictly (`d.analytics_updating === true`) where `settle(...)` handles the response (`:~1745-1810`), store beside `addedSeriesStateById` (`useState` at `:1362`). Thread the map as a prop the way `addedSeriesStateByRef` is (`:6860`, `:7401`, `:7456`).

**Render slot** (`:8690-8760`). Copy the neighbouring `nativeUnpriced` note's structure and place the new line after it:
```tsx
{nativeUnpriced && (
  <div className="mt-2">
    <p className="text-xs text-text-muted" data-testid={`scenario-detail-usd-unpriced-${a.id}`}>...</p>
  </div>
)}
```
New element (UI-SPEC S8/S8b, same element for both sources):
```tsx
<p className="mt-2 text-xs text-text-muted" data-degrade-id="scenario.analytics-updating"
   data-testid={`scenario-detail-analytics-updating-${a.id}`}>{ANALYTICS_UPDATING_LINE}</p>
```
It never coexists with `metricsAbsentSettled` or `metricsUnavailable` (a held row has figures). The blend's own scenario factsheet keeps `analyticsUpdating: false` (`scenario-factsheet-payload.ts`); do not touch it. Composer is a figure-gate-census anchor for several gated-upstream entries (`figure-gate-census.test.ts:112-119`): do not remove its `@/lib/figure-gate` import.

---

### `src/lib/degrade-warnings.ts` (config, transform)

**Analog:** `factsheet.analytics-updating` (`:1147-1154`):
```typescript
{
  id: "factsheet.analytics-updating",
  surface: "factsheet",
  class: "in_progress",
  scope: "none",
  action: null,
},
```
Add `scenario.analytics-updating` (surface `scenario`, same four fields). New SAMPLES fixture in `degrade-warnings.test.tsx` (the judge fails "no fixture sample" otherwise; shape near `:234`) and one more id in the `scenario` ledger row of `degrade-warning-scan.test.ts` for `ScenarioComposer.tsx`.

**CACHE-03 copy edit, same file** (`:1133-1139`, today):
```typescript
{
  id: "factsheet.usd-view-read-failed",
  surface: "factsheet",
  class: "read_failure",
  scope: "none",
  action: null,
  shippedAction: "It is retried within the hour.",
},
```
becomes `action: "A-RELOAD"` with `shippedAction` removed (vocabulary entry `A-RELOAD` at `:153-156`, sentence "Reload this page to try again."). Update the comment above it (`:1128-1132`, "OQ-3: no vocabulary id fits"). A marker-only entry with an action is legal for class `read_failure` (RESEARCH, judged at `degrade-warnings.test.tsx:283-330`). Pins to update: `degrade-warnings.test.tsx:1045-1056` and `FactsheetView.usd-toggle.test.tsx:379`.

**`FactsheetView.tsx:2956-2962`:** copy edit only:
```typescript
? "No USD view: the daily BTC closes could not be read. It is retried within the hour."
```
becomes `"No USD view: the daily BTC closes could not be read. Reload this page to try again."` and rewrite the comment at `:2956-2958` ("A failed read is transient (the cached payload expires within the hour)") because it states the thing CACHE-03 removes.

---

### `src/__tests__/recompute-verdict-census.test.ts` (NEW; test, batch source scan)

**Analog 1 (structure): `src/__tests__/figure-gate-census.test.ts`.** Copy the skeleton verbatim, change the pattern and the map.

Reusable skeleton (same file):
```typescript
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = process.cwd();
// typed-in oracle: pattern, reason set and map live in THIS file, nothing imported from a page.
function isTestPath(rel: string): boolean { /* :150-158 */ }
function walk(repoRoot: string, dir: string, out: string[]): void { /* :160-171 */ }
function readStripped(repoRoot: string, rel: string): string {
  return stripCommentsPreserveLines(readFileSync(resolve(repoRoot, rel), "utf8"));
}
interface Population { walked: string[]; /* + per-(file,symbol) counts */ }
function analyze(repoRoot, roots): Population { /* :193-213 */ }
function judge(pop, maps): string[] { /* returns problems: "ungated: ...", "stale: ...", "reason: ..." */ }
describe("...", () => {
  it("every reader is classified", () => { const problems = judge(pop, {...}); expect(problems, problems.join("\n")).toEqual([]); });
  it("anti-vacuity: the walk is non-empty and every anchor is walked and matched", ...);
  describe("self-test: the matcher can fire (planted files in a temp directory)", () => {
    function withPlanted(files, run) { /* mkdtempSync + try/finally rmSync, :285-297 */ }
    // planted unclassified reader fails; comment-only mention does not count; stale entry fails
  });
});
```
Walk `src/` (not just `src/app` and `src/components`), non-test `.ts` and `.tsx`.

**Analog 2 (count-keyed map and failure wording): `src/lib/complete-status-scan.test.ts`.** It freezes `{path: count}` (`ALLOWLIST`, a count per file) and fails on both a new site and a removed one, so the map cannot rot into an over-allow. The new census keys by **(file, symbol) with a count**, not by file (`queries.ts` alone holds five readers). Failure messages must name the file, the symbol, both counts and the legal classes.

**What to scan** (RESEARCH, comment-stripped): call sites of `isComputedAnalytics(`, `isRankableAnalyticsRow(`, `isRecomputeOverStoredResult(`, `hasStoredAnalyticsResult(`, `hasUnboundDerivePrestamp(`, `isStoredResultReadable(`, `storedCashHeadlineGate(`, `usesLastSuccessSnapshot(`, `effectiveDataQualityFlags(`, plus `analyticsHold(`; and the two success literals under `===` and `!==`, both operand orders (the SI-01 regex is `COMPLETE_COMPARISON = /===\s*["']complete["']/g` and sees only `===`, so the two PDF doors were invisible to it).

**Classification vocabulary** (closed set, validate like `PLAIN_REASONS` `figure-gate-census.test.ts:66-72`): `owner`, `holds`, `progress-terminal`, `percentile-cohort`, `write-gate`, `other-table`, `definition`, `retired`.

**HEAD reader counts** (measured by grep this session, comment lines filtered; the census regenerates and is the truth, not this list):
- `src/lib/factsheet/fetch-and-build-payload.ts`: `isRecomputeOverStoredResult` 1 (`:416`), `hasStoredAnalyticsResult` 1 (`:418`), `hasUnboundDerivePrestamp` 1 (`:441`), `effectiveDataQualityFlags` 1 (`:471`). Class `owner`.
- `src/lib/factsheet/headline-basis.ts`: `isRecomputeOverStoredResult` 1 (`:211`). Class `owner`.
- `src/lib/factsheet/composite-read-path.ts`: `isStoredResultReadable` 3 (`:804,1330,1356`), `storedCashHeadlineGate` 1 (`:1015`). Class `holds` (it receives the flag).
- `src/lib/queries.ts`: `usesLastSuccessSnapshot` 1 (`:873`), `effectiveDataQualityFlags` 1 (`:874`), `isRecomputeOverStoredResult` 1 (`:966`). Class `owner` (`shapeRowAnalytics`, which `getFactsheetDetail` calls; no separate entry or edit for it). Plus its `isRankableAnalyticsRow` sites (`percentile-cohort`, `:393`, `:1429`, `:1458` per RESEARCH; re-grep).
- `src/lib/strategyGate.ts:557`: `isRecomputeOverStoredResult`. Class `holds`.
- `src/app/api/admin/strategy-review/route.ts`: `hasStoredAnalyticsResult` 2 (`:267`, `:402`), `isRecomputeOverStoredResult` 1 (`:400`). Class `write-gate` for the 409 arm (founder ruled it out of FACT-02); the first-pass gate is `holds`.
- `src/app/(dashboard)/compare/page.tsx:156`: `usesLastSuccessSnapshot`. Class `holds` (Phase 190 plan 07).
- `src/lib/factsheet/og-metrics.ts:114`: `storedCashHeadlineGate`. Class `holds` after the edit.
- `src/lib/portfolio-analytics-adapter.ts` and `getPortfolioAnalyticsWithFallback` (`queries.ts:2299-2316`, `.eq("computation_status","complete")` is on `portfolio_analytics`): class `other-table`.
- Progress consumers (`useStrategySyncPoller`, `SyncPreviewStep`, `keys/sync`, `csv-finalize`, `ApiKeyManager`, `finalize-rerun`): `progress-terminal`.
- New: `analytics-hold.ts` `definition`/`owner`; each newly holding surface `holds`.

**Retired entries are asserted by the test, not just recorded** (RESEARCH): after stripping comments, zero non-test occurrences, word-bounded, of `StrategyBreakdownTable`, `getStrategyDetailV2`, `getPublicStrategyDetail`, `getStrategyDetail` (word boundary keeps `getStrategyDetailV2` its own entry), and `src/app/portfolio-pdf/[id]/page.tsx` imports neither `closed-sets` nor a figure formatter. The `queries.ts` docblocks name the deleted functions in comments, which is why the stripper matters (UI-SPEC evidence table).

**PROOF-01:** plant a reader file (RED names file and symbol), or delete one classification row (RED stale/unclassified); restore with `cp` and `cmp`.

---

### `src/lib/factsheet/owner-trust-tier.ts` (NEW; service, CRUD read, fail-soft)

**Why its own module:** at least eight page tests mock `@/lib/queries` as `{ readPublicVerificationSignals: vi.fn() }` only (`page.public-cache-key.test.tsx:71-73`, `page.owner-lane.test.tsx:92`) and their fake request clients expose only `select().eq().maybeSingle()`. A new `queries.ts` export would be undefined there, and an `.order().limit()` chain would throw. Update the owner-lane harnesses to answer `strategy_verifications` (find them with `grep -l "withPublishedOrOwner" src/app/factsheet/\[id\]/v2/*.test.tsx`).

**Analog for the error posture: `readPublicVerificationSignals`, `src/lib/queries.ts:1557-1617`** (console first, then Sentry, never throws, null on failure):
```typescript
if (error) {
  console.error("[readPublicVerificationSignals] get_published_trust_signals RPC failed — all trust badges hidden:", error);
  captureToSentry(error, { tags: { op: "readPublicVerificationSignals" }, level: "error" });
  return byStrategy;
}
...
} catch (err) {
  console.error("[readPublicVerificationSignals] unexpected error — all trust badges hidden:", err);
  captureToSentry(err, { tags: { op: "readPublicVerificationSignals" }, level: "error" });
}
```
**Analog for the read shape: the Lane B share-state read, `v2/page.tsx:640-681`** (request-scoped client, `error-absent != legit-absent`, `captureToSentry` with `route` + `stage` tags, no row content):
```typescript
if (shareError) {
  console.error("[factsheet/v2/page] share-state read failed", { id, code: shareError.code, message: shareError.message });
  captureToSentry(shareError, { tags: { route: "factsheet/v2/page", stage: "share-state" } });
}
```
**Core read** (RESEARCH FACT-04; the column list IS the whole projection, never `*`: the table holds `encrypted_credentials` and `public_token`, `baseline.sql:14729-14748`):
```typescript
const { data, error } = await supabase
  .from("strategy_verifications")
  .select("trust_tier, created_at")
  .eq("strategy_id", id)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
```
Order and limit mirror `get_published_trust_signals` (`DISTINCT ON (strategy_id) ... ORDER BY created_at DESC`). Use the request-scoped client passed in, never `createAdminClient` (the RLS policy `strategy_verifications_owner_select` is the ownership check; admin would bypass it). Return a validated three-literal value or `null`, using the same normalisation the page applies at `:955-960`:
```typescript
rawTrustTier === "api_verified" || rawTrustTier === "csv_uploaded" || rawTrustTier === "self_reported" ? rawTrustTier : null
```
Tag the capture with a stage name; it fails soft (`—`, page renders). The generated `database.types.ts` may not know the table's chain; if the typed `.from()` overload objects, use the same cast-through-unknown idiom as the `strategy_shares` read (`:640-657`) and cite its deletion trigger.

---

### `src/app/factsheet/[id]/v2/page.tsx` (page, request-response)

**FACT-04 wiring.** Lane order is load-bearing: the published probe and `readPublicVerificationSignals([id])` run together first (`:437-448`), Lane B only on a Lane A miss. Call the new module **only** inside the existing `if (ownRow.status !== "published") { lane = "owner"; ... }` block (`:610-690`), next to the share-state read, storing the result in a `let ownerTrustTier: TrustTierKind | null = null;` declared with the other owner-lane `let`s. Then at the overlay (`:955-960`):
```typescript
const rawTrustTier = verificationSignals.get(id)?.trust_tier ?? null;
```
becomes `verificationSignals.get(id)?.trust_tier ?? ownerTrustTier ?? null`, so a published row that reaches Lane B keeps its published signal. `withTrustTier(payload, trustTier)` (`:968`) already reaches `usdView.payload` (CR-02); no markup change. Never call this on the public lane and never put the tier in the cache key or payload (Lane B never enters `buildFactsheetPayloadCached`, `:706`).

**CACHE-03 throw** (Pattern 3). The callback today (`:218-224`):
```typescript
async () => {
  const built = await fetchAndBuildPayloadWithReason(id, withPublishedOnly);
  if (built.reason === "read_error") throw new FactsheetReadError();
  // SFH HIGH-1: a degraded build is rendered, never stored (see the class).
  if (built.payload && built.conventionsDegraded) throw new FactsheetDegradedBuildError(built.payload);
  return built.payload;
},
```
Add one line before `return built.payload`:
```typescript
if (built.payload?.usdViewUnavailable === "price_read_failed") throw new FactsheetDegradedBuildError(built.payload);
```
Only `price_read_failed` throws; `no_priced_day` is a data fact and stays cached (type at `types.ts:1045`, producer `fetch-and-build-payload.ts:1103-1105,1149`). The throw lives in the page callback, **not** in `buildUsdView`: the phase-148 closure test (`phase-148-owner-lane-cache-isolation.test.ts`) forbids cache reach in the builder's import closure. The page's existing catch (`:~733`, `if (err instanceof FactsheetDegradedBuildError) payload = err.payload;`) needs no change. The class message (`:~136`, "built on the config tier after a failed conventions read") is now wrong for this cause: generalise it or add a sibling class.

**Cache key bump** (decided in CONTEXT): `"factsheet-v2-payload-v26"` (`:307`) becomes `v27`, with a dated comment line in the house format. The comment block above the key is one `// Bumped vN->vN+1 (Phase ..., date): why` line per bump (`:~290-306`); add yours at the end. Pins that must move together: `page.public-cache-key.test.tsx:290,360,381`, `factsheet-share/[token]/page.cache-isolation.test.tsx:156` (`EXPECTED_KEY_PREFIX`).

---

### `src/app/factsheet/[id]/v2/MetricsColumn.tsx` and the four panels (FACT-01)

**Analog:** the existing note markup and the existing gates in the same file.

**Gates, decided once** (`:318-319`; do not call `isHeadlineWithheld` anywhere else):
```typescript
const fullHistoryWithheld = useFullHistoryWithheld();
const wholeRecordWithheld = !selected && fullHistoryWithheld;
```
Scope per panel (UI-SPEC 1.2): Worst 10 Drawdowns gets **`wholeRecordWithheld`** (keeps its zoomed slice, it reads `useWindowedView`); EOY Returns, Calmar by Year, Style Drift and the secondary renderings get **`fullHistoryWithheld`**.

**New slot.** Extend (`:65`):
```typescript
export type HeadlineNoteSlot = "strip" | "stripRelative" | "main" | "returns" | "maxdd" | "cumulative";
```
with `"panel"`. In `headlineCoverageNote` the withheld arm (`:129-139`) returns null for any slot outside strip, stripRelative, main:
```typescript
if (isHeadlineWithheld(dataQuality, basis)) {
  if (slot !== "strip" && slot !== "stripRelative" && slot !== "main") return null;
  if (dataQuality.headlineWithheldCause === "recomputing") {
    return { variant: "withheld", text: "Headline figures are being recomputed." };
  }
  if (dataQuality.headlineWithheldCause === "failed") return null;
  return { variant: "withheld", text: `Headline figures withheld: earlier history is unreliable (it includes ${reasons}), and the span after it has not been measured yet.` };
}
```
Add a `"panel"` branch ahead of the `slot !== ...` early return, using `reasons` (`joinGuardPhrases`, already computed at `:126`):
`recomputing` -> `Withheld while the headline figures are recomputed.`; `failed` -> `null` (panel omitted); absent -> `Withheld: this panel covers earlier history, which is unreliable (it includes ${reasons}), and the span after it has not been measured yet.` (UI-SPEC FH237-PANEL-WITHHELD / FH237-PANEL-RECOMPUTING, ASCII except the `⚠ ` the slot renders). Pin both strings character for character in the function's unit test (extend `FactsheetView.headline-coverage.test.tsx` or a new unit file).

**Note markup to copy** (existing span note, `:512-515`, `:652-655`; the panel note is the same element minus `mb-2`, plus a testid):
```tsx
<p className="mb-2 text-fixed-10 italic" style={{ color: headlineNoteColor(spanNote.variant) }}>
  {headlineNoteGlyph(spanNote.variant)}
  {spanNote.text}
</p>
```
becomes
```tsx
<p data-testid="panel-withheld-note" className="text-fixed-10 italic" style={{ color: headlineNoteColor("withheld") }}>
  {headlineNoteGlyph("withheld")}{note.text}
</p>
```
Inline `style={{ color }}`, not `text-warning`, so it does not trip the degrade scan (`TRIP_SOURCE`). Exactly one `<p>` as the body; header kept; table, footnotes, KS sentence, half-dates subline, `< 126 obs` note removed (UI-SPEC 1.4). Precedence inside each panel: no-data `null` first, then failed-cause `null`, then note, else unchanged (UI-SPEC 1.3).

**Per-panel edits.**
- `WorstDrawdownsTablePanel` (`:1549`, file-local, no props today): takes `wholeRecordWithheld` and the note. The hook order matters: keep `useWindowedView` and the `rows.length === 0` early return (`:1556-1557`) before the new branch.
- `EoyReturnsPanel` (`:1626`): already takes `fullHistoryWithheld`; today only `year === lastYear` is dashed (`:1676`). Replace with the whole-body note; the withheld EOY panel drops its `vs {comparator}` `benchHeader` (UI-SPEC 1.4).
- `CalmarByYearPanel` (`AnalyticalPanels.tsx:286`): today `const dashed = fullHistoryWithheld && r.year === lastYear;` (`:329`). It keeps its own `<header className="mb-2 border-b border-text pb-1">` and `ScopeNote`. Receives the computed `HeadlineNote | null` (and a way to tell "gate off" from "omit") as a prop from `MetricsColumn`; **no import of `MetricsColumn`** (cycle).
- `StyleDriftPanel` (`BatchDPanels.tsx:33`, takes no props today): same prop approach. Remove the KS sentence with the body. **Mount condition** (`MetricsColumn.tsx:592`): `(hasStyleDrift || scenarioMode) && { name: "Style", ... }` must use the same verdict on the failed arm, else an empty "Style" heading renders and later sections keep a wrong number (`hasStyleDrift` at `:401`).
- Mount sites (each panel has exactly two): `EoyReturnsPanel` `:575`, `:701`; `CalmarByYearPanel` `:586`, `:730`; `WorstDrawdownsTablePanel` `:587`, `:731`; `StyleDriftPanel` `:597`, `:742`.

**Secondary renderings** (UI-SPEC 1.6; `fullHistoryWithheld` is already available at the wrappers `FactsheetView.tsx:1003-1009`):
- `EndOfYearBarsPanel` (`DistributionPanels.tsx:37`; it already takes `fullHistoryWithheld` and dashes only `year === lastYear` at `:81`): replace with the `<figure>` title plus `chart-withheld-note` (drop the subtitle and the SVG). It may import `headlineCoverageNote` from `./MetricsColumn` directly (existing import at `:8`).
- `MonthlyRow` (`HeatmapPanels.tsx:119` `ytdWithheld={fullHistoryWithheld && r.year === lastYear}`, cell `:202-208`): widen to `ytdWithheld={fullHistoryWithheld}` and add `data-testid="heatmap-ytd-withheld"` on the dashed `<td>`; keep `withheldMonthIdx` (`:120`) as is. The existing branch already renders `{ytdWithheld ? "—" : formatPct(row.ytd, 1)}` untoned.
- Worst 10 chart: `TimeSeriesChart.tsx:1076` `config.ddHighlights && view.strategyWorst10.map(...)`; render the note instead via a config field threaded the way `showStratAverage` is (`chart-configs.ts:108,212`, `FactsheetView.tsx:1127` `const avg = railAvgWithheld ? { showStratAverage: false } : {};`). Gate is `fullHistoryWithheld`, not `wholeRecordWithheld` (the bands read the whole-record basis view; UI-SPEC 1.6).
- Crosshair last-point value: `CrosshairTooltip` (`TimeSeriesChart.tsx:~1462-1480`, `s.values[crossIdx]`), gate `railAvgWithheld = fullHistoryWithheld && !zoomed` (`FactsheetView.tsx:1046`; its comment `:1032-1037` already says the tooltip is "booked with the residue"). Print `—` with `data-testid="crosshair-value-withheld"` on the strategy row at the last index only.

**Tests that encode the OLD behaviour** (rewrite, do not delete): `FactsheetView.headline-coverage.test.tsx` D1 (`:1238`: every EOY row except the last keeps its figure), D4 (`:1253`), WR-01 (`:1265`). Re-measure `MetricsColumn.no-loss-residues.test.tsx`, `MetricsColumn.parts.test.tsx`, `MetricsColumn.headline-bench.test.tsx`, `FactsheetView.window-kpis.test.tsx`, `FactsheetBody.census.test.tsx` (counts empty frames; a note-only panel must not read as empty, RESEARCH A3). New file harness: reuse `renderColumn` (`headline-coverage.test.tsx:167`), `rowsOf`, the `WITHHELD_DQ` / `CLEAN` fixtures (`:150`, `:157`), `payloadWithComparator`. Include the held-re-run-over-a-Dated-row case (tables render; UI-SPEC 1.4 last paragraph).

---

### Tests: CACHE-01 `route.cache-ttl.test.tsx` (NEW)

**Analog:** `route.public-access.test.tsx` harness (`:62-143`): `vi.hoisted` `STATE` + `ogCalls`, the `next/og` stub class that records `(element, options)`, the cookie-scoped `createClient` fake whose `maybeSingle()` applies every `eq` filter to the row (so dropping `withPublishedOnly` goes RED), and the `afterSpy` for `after()`. The real `withPublishedOnly` and `computeOgHeadline` run. Mutate `STATE.strategyRow.status` between requests to simulate the publish.

**Clock-driven HTTP-cache double** (RESEARCH Code Examples; test-local, parses the real header the route set):
```typescript
function httpCache(now: () => number) {
  const store = new Map<string, { body: unknown; expires: number }>();
  return async (key, fetchOrigin) => {
    const hit = store.get(key);
    if (hit && hit.expires > now()) return hit.body;
    const res = await fetchOrigin();
    if (res.cacheControl.includes("no-store")) return res.body;
    const sMax = /s-maxage=(\d+)/.exec(res.cacheControl)?.[1];
    if (sMax) store.set(key, { body: res.body, expires: now() + Number(sMax) * 1000 });
    return res.body;
  };
}
```
Cases under the CONTEXT ladder (not RESEARCH's): (1) not-found then publish then the **next request** shows the real card, red on `LONG_CACHE`; (2) published row without figures (first-compute `pending`, no stored result) then complete, next request real; (3) held re-run card with the Updating line at t0, run completes, real card at t0+61 s (this is where SHORT's 60 s applies); (4) terminal card keeps LONG (control). Use `vi.useFakeTimers` or a manual clock. Existing assertions to flip to `no-store`: `route.test.tsx` F2 (`:590-597`, `LONG_CACHE` at `:124`), `route.public-access.test.tsx` P1 (`:271`), P2 (`:283`), P3 (`:293`). Unchanged: F3 `:601-609` LONG, F1/F4/F5/P7 `no-store`. The `LONG_CACHE` constants in those files (`route.test.tsx:124`, `route.public-access.test.tsx:147`) stay for the rendered-data cases.

### Tests: CACHE-03 case in `page.public-cache-key.test.tsx`

**Analog:** `READ-ERROR-NOT-CACHED` (`:250-281`), copy its structure (request 1 fails, request 2 recovers inside the same run key and must BUILD). The store double (`:51-64`) mirrors Next's keying and lets a throw propagate before the store:
```typescript
vi.mock("next/cache", () => ({
  unstable_cache:
    (fn, keyParts) => async (...args) => {
      cacheKeys.push(keyParts);
      const key = JSON.stringify([keyParts, args]);
      if (cacheStore.has(key)) return cacheStore.get(key);
      const value = await fn(...args);   // a throw propagates before the store
      cacheStore.set(key, value);
      return value;
    },
}));
```
Use a native-unit row (`data_quality_flags: { native_unit: "BTC" }`) and extend `mockAdmin` (`:122-135`), which answers `{data:null,error:null}` for every non-`strategies` table, to answer `benchmark_prices` with an error on request 1 and rows on request 2, counting those reads. Assert request 2 carries a `usdView` and no `usdViewUnavailable`, and `adminReads` shows two builds. A builder-level fake already exists in `fetch-and-build-payload.test.ts:1254` ("a failed closes read says price_read_failed", `fake.btcRows`, `fake.btcError`). Neuter: remove the new throw line, RED: request 2 replays `usdViewUnavailable`. An identity stub `(fn) => fn` makes every cache case vacuous (that file's docblock, `:28-33`).

### Tests: FACT-04 `page.owner-trust-tier.test.tsx` (NEW)

**Analog:** `page.owner-lane.test.tsx` (`:67-92` mocks, `mockRequestClient` `:227-266`, `givenOwnerDraft` `:339`, `findPayload`/`findViewProps` `:291`/`:311`) and `page.usd-trust.test.tsx` (the both-views shape). Cases per UI-SPEC section 3.2 and the ROADMAP per-surface rule: owner with a verification row (Terms "Data source" label and masthead pill, native and USD views); owner with none (`—`, no pill); owner with a failing read (`—`, page renders, `captureToSentry` called with the stage tag); anon and non-owner on an unpublished strategy (404, unchanged); share-link recipient (`/factsheet-share/[token]`, `—`, unchanged). Neuters: read on every lane (drop the `lane === "owner"` guard), pass the unvalidated string.

### Tests: S2 T5b, S7 `page.rerun-hold.test.tsx`

- T5b: add beside the existing T5 in `tearsheet/page.stale-analytics.test.tsx`. The surface already holds (its figures come from `fetchAndBuildPayloadWithReason`, which admits a held row), so there is no pre-fix RED: PROOF-01 needs a neutered copy (force `analyticsUpdating` false in the resolve stage, `fetch-and-build-payload.ts:416`). The file's design is real `getFactsheetDetail` -> real builder gate -> real page with `FactsheetView` as a recorder (docblock `:20-37`): a computing row WITH stored evidence mounts the view with `analyticsUpdating: true`; the existing T5 fixture has no stored evidence and stays correct.
- S7: model on `page.stale-analytics.test.tsx` beside the recommendations page (read it first for the harness).

---

## Shared Patterns

### One source for the Updating sentence
**Source:** `src/lib/status-surface-copy.ts:701`
```typescript
export const ANALYTICS_UPDATING_LINE =
  "Updating with the latest data. These figures are from the last completed computation.";
```
**Apply to:** OG route, recommendations card, composer rows. The factsheet's own use (`FactsheetView.tsx:1632-1638`) is the reference markup: `data-testid` plus `data-degrade-id` plus the host's note class, no `role`, no `aria-live`.

### The evidence-column rule (every held surface)
**Source:** `src/lib/stored-analytics-result.ts:194-204` (`hasStoredAnalyticsResult`): (a) a stored series (`daily_returns` or `returns_series` non-empty, or the `series_end` alias), (b) a finite `cumulative_return`, (c) a success-written `cumulative_method` (live, snapshot bound to `computed_at`, or the two `last_success_*` aliases). A select missing any of these makes the hold silently false. Full-column surfaces (OG, returns, both PDFs, book): add `cumulative_return`, `computed_at` (and for PDFs the series and flags). List-projection surface (recommendations only; `getFactsheetDetail` is not widened): the alias set from `queries.ts:598`.

### Fail-soft read with a Sentry stage tag
**Source:** `readPublicVerificationSignals` `queries.ts:1574-1590,1605-1614` and the share-state read `v2/page.tsx:664-681`. **Apply to:** `owner-trust-tier.ts` only. Console first, `captureToSentry` second, tags carry a route or op plus a stage, no row content, never throw.

### Throw inside `unstable_cache` so a degraded build is never stored
**Source:** `v2/page.tsx:113-143` (classes) and `:218-224` (callback); `FactsheetReadError` for an outage, `FactsheetDegradedBuildError(payload)` when the page should still render it uncached. **Apply to:** CACHE-03 only.

### Cache header strings in one lib module
**Source:** `route.tsx:41-46` lifted to `src/lib/factsheet/cache-control.ts`. **Apply to:** OG route, both PDF routes.

### Comment-stripped source scans
**Source:** `src/lib/source-scan.ts` `stripCommentsPreserveLines` (its header explains why: a needle is more likely to appear in a comment than anywhere else). **Apply to:** the census, and any new grep-style pin. A count taken without stripping is not a count.

### PROOF-01 (every gate must be able to fail)
Byte backup before each neuter (`cp file file.bak`), run the named command and record the failing test name, restore with `cp file.bak file`, `cmp file file.bak` (exit 0), then GREEN; never `git checkout`, `restore` or `stash`. Neuter map is in RESEARCH "PROOF-01: neuter map"; two corrections from this mapping: CACHE-01's neuter is "not-found back to `LONG_CACHE_CONTROL`" with the **next request** still blank (no 61 s step), and S2's neuter has no natural RED (it already holds).

---

## No Analog Found

| File | Role | Data Flow | Reason |
|---|---|---|---|
| clock-driven HTTP-cache double (inside `route.cache-ttl.test.tsx`) | test helper | request-response | No existing test simulates an HTTP cache over a route's own `Cache-Control`; use the RESEARCH Code Example above, test-local. The nearest conceptual analog is the `unstable_cache` store double in `page.public-cache-key.test.tsx:51-64` (keyed store, store-before-throw semantics). |
| `"panel"` note slot arm | component | transform | No existing panel-level Withheld note exists; the slot function and glyph/colour helpers are the analog, the strings are new copy (UI-SPEC). |

---

## Metadata

**Analog search scope:** `src/lib/` (`closed-sets`, `stored-analytics-result`, `factsheet/*`, `queries`, `status-surface-copy`, `degrade-warnings`, `source-scan`, `api/headers`), `src/app/api/{og,factsheet,strategies}/**`, `src/app/factsheet/[id]/{v2,tearsheet}/**`, `src/app/(dashboard)/{recommendations,allocations}`, `src/__tests__/` census tests.
**Files scanned:** ~45 read in part (largest read by symbol and line range: `queries.ts`, `page.tsx`, `MetricsColumn.tsx`, `ScenarioComposer.tsx`).
**Tracked-source check:** every `src/...` path in this file (44 distinct) was run through `git ls-files --error-unmatch`; all are tracked except the 8 files marked NEW, which do not exist yet. Bare test-file names in the tables were resolved to full paths with `git ls-files | grep` and are tracked.
**Not executed:** the worktree has no `node_modules`, so no test, lint or typecheck was run. Every line number is from `Read` or `sed -n` at HEAD of `gsd/phase-237-factsheethonest`; counts of readers are `grep` output, not census output.
**Pattern extraction date:** 2026-11-23
