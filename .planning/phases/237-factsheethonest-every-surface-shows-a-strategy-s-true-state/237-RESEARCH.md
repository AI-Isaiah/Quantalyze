# Phase 237: FACTSHEETHONEST - Research

**Researched:** 2026-11-23
**Domain:** Next.js 16 server components and route handlers, Supabase RLS reads, HTTP and `unstable_cache` caching, a factsheet render seam (React 19, vitest 5)
**Confidence:** MEDIUM-HIGH. Every design claim about the code is read from the repo at HEAD. Nothing was executed: the worktree has no `node_modules`, so no test, lint or typecheck ran in this session.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

FACT-01: the three D6 items on a Withheld factsheet (founder ruling, 2026-11-23)
- Q1 Worst 10 Drawdowns, founder answer "Withhold panel (Recommended)": on a Withheld full-history view with no what-if, the whole Worst 10 Drawdowns panel is replaced by the Withheld note. A zoomed window keeps its own slice.
- Q2 EOY Returns and Calmar by Year, founder answer "Withhold both (Recommended)": on a Withheld full-history view with no what-if, both by-year panels are withheld (the year that holds the break compounds across it and a Withheld row cannot name which year it is). A zoomed window keeps its own slice.
- Q3 Style Drift, founder answer "Withhold panel + KS (Recommended)": on a Withheld full-history view with no what-if, the Style Drift panel and its Kolmogorov-Smirnov line are withheld. A zoomed window keeps its own slice.
- All three use the same predicate as D-15 and its extensions in Phase 164.6.6.3.3 (`isHeadlineWithheld`, full history, no what-if), so the strip, the rail and these panels can never disagree about what "withheld" means.

FACT-02: re-run holding reach (founder ruling, 2026-11-23)
- Founder answer "7 + (a) + (b) (Recommended)". During a pending or computing re-run over a stored success result, these surfaces stay published and show the last computed figures with the quiet Updating line (Phase 190 D-03, D-06 wording "Updating with the latest data. These figures are from the last completed computation."): the share card image (`/api/og/factsheet/[id]`), the tear sheet, both PDF routes (`/api/factsheet/[id]/pdf`, `/api/factsheet/[id]/tearsheet.pdf`), the returns API (`/api/strategies/[id]/returns`), recommendations, portfolios (`StrategyBreakdownTable` and the portfolio PDF) and the scenario composer; plus (a) the strategy page's own panels (`getStrategyDetailV2`, today a terminal-status gate with live data-quality chips) and (b) the detail reads that share `PUBLIC_ANALYTICS_COLUMNS` and withhold by design today: `getPublicStrategyDetail`, `getStrategyDetail` (and `getFactsheetDetail`, the tear sheet read, which the tear sheet needs anyway).
- (c) composite approval answering 409 during a re-stitch is RULED OUT by the founder as a write gate rather than a display. It stays as it is, and the census classifies it so.
- `[190-RERUN-SURFACES-NOT-HOLDING]` is closed on that basis in the ship PR.
- Every holding surface follows Phase 190 plan 03's rule: `hasStoredAnalyticsResult` with `isRecomputeOverStoredResult`, plus `hasUnboundDerivePrestamp` where it reads the flags blob. A machine surface (the returns API) carries the state as a field rather than a line of text.
- A census test lists every reader of the recompute verdict with a classification, and fails when a new reader is added unclassified (SC-2).

Measured at HEAD after the ruling (2026-11-23, UI-SPEC research, re-checked by the phase agent)
- Five surfaces the FACT-02 ruling names no longer exist, so they have nothing to hold: portfolios (`StrategyBreakdownTable` deleted, portfolio PDF retired by Phase 195 TRIM D-03; `/portfolio-pdf/[id]` is now a figure-free landing page), (a) `getStrategyDetailV2` (deleted, Phase 196 plan 14), and (b) `getPublicStrategyDetail` and `getStrategyDetail` (deleted, Phase 196 plan 14). Of (b) only `getFactsheetDetail`, the tear sheet read, is live and it is in scope. The census lists the retired ones as retired with the command that proves it, and `[190-RERUN-SURFACES-NOT-HOLDING]` closes on: every listed live surface holds, the retired ones are gone, and (c) is ruled out by the founder.
- The composer's book-strategy rows (the live successor of "portfolios") already show stored figures during a re-run but without the Updating line; they are in scope as part of the composer and get the line.

Follow-ons of the FACT-01 ruling (phase agent, 2026-11-23; derived from the founder's stated reason, reversible, flagged in the ship report)
- The same figures a withheld panel hides are withheld wherever else they render on the same Withheld full-history view: the EOY bar chart value labels, the heatmap per-year YTD column, the Worst 10 chart bands and the hover note named in the TODOS entry heading. Showing the identical number in a second rendering would defeat the ruling.
- EOY Returns, Calmar by Year and Style Drift show the whole record even inside a zoom, so they have no slice to keep and stay withheld under a zoom; Worst 10 Drawdowns keeps its zoomed slice.
- A failed-cause panel stays omitted as today (no Withheld note on a failed row).
- The new panel notes use panel-specific sentences (UI-SPEC FH237-PANEL-WITHHELD).
- CACHE-03 makes the USD read-failed sentence "It is retried within the hour." false; it becomes the reload sentence (UI-SPEC A-RELOAD).
- Both PDF routes and the share card take the short cache while they render a held re-run.
- A share-link recipient of an unpublished strategy still reads "Data source —" (owner lane only, per the FACT-04 decision and the TODOS gate).

Decided autonomously
- [FACT-04] Q: "How does the owner's private factsheet get its own trust tier?" → Selected: "On the owner lane (Lane B of `v2/page.tsx`) only, read the latest `strategy_verifications` row with the request's user-scoped client; the existing `strategy_verifications_owner_select` RLS policy is the ownership check. `get_published_trust_signals` is not widened, and anon and non-owner readers still get nothing for an unpublished strategy. Owner and anon are tested per surface." — no schema change, one read on one lane.
- [CACHE-01] Q: "What cache does a not-found OG card get?" → Selected: "A genuine not-found (unpublished, unknown or malformed id) gets a short cache (about 60 s, never `LONG_CACHE_CONTROL`); rendered data keeps the long cache. A card rendered during a re-run (FACT-02) also gets the short cache so its Updating line is never pinned at the CDN for a day." — a header constant.
- [CACHE-03] Q: "How is a failed BTC price read kept out of the payload cache?" → Selected: "A `price_read_failed` build throws inside the `unstable_cache` callback, the house degraded-build pattern (ROADMAP: `use cache` is not adopted); the page renders that view uncached and the next view retries. A shorter TTL is not a close." — local to the builder and its wrapper.
- [Gates] Q: "How are SC-3's cache cases proven?" → Selected: "A good-after-bad-within-TTL test on the real cache wrapper for each case; each gate goes RED on pre-fix code or a neutered copy with its named arm first, restored from a byte backup (`cp` back, `cmp`) and GREEN, recorded verbatim in the plan SUMMARY (PROOF-01)." — tests only.

### Claude's Discretion
- Exact short-cache value for the not-found and re-run OG cards, the census test's file location and classification vocabulary, and how plans split by topic.

### Deferred Ideas (OUT OF SCOPE)
- Composite approval during a re-stitch (409) — ruled out by the founder 2026-11-23 as a write gate, not deferred.
- The "one hover note" mentioned in the `164.6.6.3.3-WITHHELD-RESIDUE` heading is not among the three D6 items; the planner re-reads the entry and either covers it or names it.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| FACT-01 | A withheld factsheet prints no whole-record reading beside rail figures that read as dashes (three D6 items = founder ruling) | §FACT-01: four panel components, two mount sites each, the existing `fullHistoryWithheld` / `wholeRecordWithheld` gates, the import-cycle constraint, the tests that encode the OLD last-year-only dash |
| FACT-02 | During a re-run every surface that shows a strategy's figures stays published with the Updating line; a census test lists every reader of the recompute verdict | §FACT-02: per-surface gate lines, which surfaces withhold at HEAD (natural RED) and which already hold (need a neuter), the evidence-column gaps, the census design |
| FACT-04 | The owner's private factsheet shows the data source of their own key-backed strategy | §FACT-04: Lane B line anchors, table GRANT and RLS facts, the column projection rule, test seams that need updating |
| CACHE-01 | A strategy published after its OG card was first requested shows its real card on the next request; a not-found card is never long-cached | §CACHE-01: the route's three not-found paths, the header ladder, the HTTP-cache test double, the existing tests that pin LONG for not-found |
| CACHE-03 | A failed BTC price read is never cached as a normal payload; the next view retries | §CACHE-03: `buildUsdView`, the page wrapper's throw pattern, the existing READ-ERROR-NOT-CACHED analog, copy and registry edits |
</phase_requirements>

## Summary

The phase is five independent seams on three files plus their surfaces. No new library, no migration and no schema change is needed. [VERIFIED: grep of `supabase/schema/baseline.sql` for the grants, and the `v2/page.tsx` / `og route` reads in this session] The real work is (1) a shared way to ask "is this row held, terminal, or neither" from seven readers that today each carry their own terminal-success gate, (2) a withheld-panel rendering rule for four panels and four secondary figure renderings, (3) one owner-lane read, (4) a header ladder on the OG route, and (5) one throw in the page's cache callback.

Two facts change how the plan must be written. First, **only some FACT-02 surfaces withhold at HEAD**. The OG card, both PDF routes, the returns API and recommendations withhold (their own gates say `isComputedAnalytics`, `isRankableAnalyticsRow` or a literal `!== "complete"`), so their gates go RED naturally on pre-fix code. The tear sheet page already holds (its figures come from `fetchAndBuildPayloadWithReason`, which admits a held row) and the composer's book rows already show figures. Those need a neutered copy to satisfy PROOF-01. Second, **the hold is dead code unless each surface also reads the evidence columns**: the OG embed lacks `computed_at`, the returns route lacks `cumulative_return` and `computed_at`, recommendations carries no marker alias, the book payload lacks both, and the PDF routes read only the status. Reading flags from `data_quality_flags` directly during a derive prestamp also serves the wrong unit and curve method, so each held surface must read `effectiveDataQualityFlags(row).flags`.

**Primary recommendation:** add one thin shared verdict helper beside `closed-sets.ts`, make all five newly holding surfaces call it with a row that carries the full evidence columns, add one census test modelled on `src/__tests__/figure-gate-census.test.ts` keyed on (file, symbol) call-site counts, and prove every gate with the existing test seams named below (the `page.public-cache-key.test.tsx` store double is the exact analog for CACHE-03).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Held-re-run verdict (`updating`, `admitted`) | API / Backend (server read) | — | Row state only, decided once per read, never from viewer, cookie or client state (UI-SPEC §2.1). Client code only receives the boolean. |
| Updating line on OG raster | API / Backend (route handler) | CDN / Static (cache header) | Satori raster is built server-side; the header decides how long a CDN keeps it. |
| Updating line on tear sheet / factsheet | Frontend Server (SSR) | — | Rendered from `payload.analyticsUpdating` in `FactsheetView`; already present. |
| PDF hold + cache header | API / Backend (route handler) | CDN | Route gates the render and sets the header and ETag. |
| Returns API `analytics_updating` field | API / Backend | Browser / Client (composer reads it) | Machine surface carries a boolean, never text. |
| Composer Updating line | Browser / Client | API / Backend | Client merges the book payload's field and the lazy fetch's field; server owns the verdict. |
| Withheld panels, charts, dashes | Browser / Client (`"use client"` panels) | Frontend Server | Gates are computed once in `MetricsColumn` and passed down. |
| Owner trust tier | Frontend Server (page, Lane B) | Database (RLS) | RLS is the ownership check; the read is per-request and never enters the cached payload. |
| Not-found OG cache | API / Backend (header) | CDN | An HTTP header decision; no server-side cache is involved. |
| Failed BTC read not cached | Frontend Server (page `unstable_cache` callback) | API / Backend (builder reports it) | The throw lives in the page callback because the phase-148 closure test forbids cache reach inside the builder's import closure. |

## Standard Stack

### Core
No new package is installed or recommended. The phase edits in-repo modules only.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| next | `^16.4.2` [VERIFIED: `package.json` line 40] | `unstable_cache`, route handlers, `next/og` `ImageResponse` | Already the app framework; ROADMAP: `use cache` is not adopted |
| react | `19.3.1` [VERIFIED: `package.json` line 44] | Server and client components | existing |
| vitest | `^5.0.3` [VERIFIED: `package.json` line 76] | Test runner for every gate | existing; config `vitest.config.ts` (jsdom default; node env is opt-in per file in `vitest.node-env.ts`) |
| @testing-library/react | existing | Panel and view render tests | existing seams use it |

### Supporting (in-repo, reuse these, do not rebuild)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `src/lib/stored-analytics-result.ts` | `hasStoredAnalyticsResult`, `effectiveDataQualityFlags`, `hasUnboundDerivePrestamp`, `usesLastSuccessSnapshot` | Every held surface |
| `src/lib/closed-sets.ts` | `isComputedAnalytics`, `isRecomputeOverStoredResult`, `isRankableAnalyticsRow` | gate composition |
| `src/lib/factsheet/headline-basis.ts` | `isStoredResultReadable`, `storedCashHeadlineGate`, `headlineVerdict` | OG card parity with the page |
| `src/lib/source-scan.ts` | `stripCommentsPreserveLines` | the census test |
| `src/lib/status-surface-copy.ts` | `ANALYTICS_UPDATING_LINE` | every Updating line (never inline) |
| `src/lib/degrade-warnings.ts` | registry entries `factsheet.usd-view-read-failed`, new `scenario.analytics-updating` | copy and marker registry |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Evidence columns at each PDF route door | Admit `pending`/`computing` at the door and let the page decide | Fewer reads, but it changes a first-ever-compute pending row from a 400 to a 409 on `pdf` and a 503 plus a Sentry `marker_absent` error on `tearsheet.pdf`, and it makes the PDF route a non-reader of the verdict that CONTEXT says every holding surface must apply. Rejected. |
| A new returns-API text line | A boolean field `analytics_updating` | Founder ruling: machine surface carries a field (CONTEXT). |
| `no-store` for the not-found OG card | `SHORT_CACHE_CONTROL` | CONTEXT locks a short cache; see Open Question 1 for the wording gap with the ROADMAP's "next request". |

**Installation:** none. **Package Legitimacy Audit:** not applicable, no external package is installed in this phase, so the `package-legitimacy` seam was not run.

**Version verification:** no package is added, so there is nothing to confirm on a registry. Installed versions could not be read because `node_modules` is absent in the worktree.

## Architecture Patterns

### System Architecture Diagram

```
                       strategy_analytics row (stored by the analytics worker)
                       computation_status, computed_at, cumulative_return,
                       daily_returns | returns_series, data_quality_flags
                                       |
                                       v
               +-----------------------+---------------------------+
               |  shared verdict helper (new, beside closed-sets)  |
               |  updating = isRecomputeOverStoredResult(status,   |
               |               hasStoredAnalyticsResult(row))      |
               |             && !composite(effective flags)        |
               |  admitted = (isComputedAnalytics(status)          |
               |               && !hasUnboundDerivePrestamp(row))  |
               |             || updating                          |
               +----+--------+----------+----------+------+-------+
                    |        |          |          |      |
          OG card   |  PDF x2|  returns |  recs    | book | factsheet resolve stage
          (route)   | (route)|  (route) |  (page)  | rows | (already holds, owner of the rule)
                    |        |          |          |(queries.ts)
        header:     | header:| field    | line     | field| payload.analyticsUpdating
        LONG|SHORT| | LONG|  | analytics| (S7)     | analytics_updating
        |FAILURE    | SHORT  | _updating|          |   |
                    |        |   |                 |   v
                    |        |   v                 | composer merge map
                    |        | composer lazy fetch | (book wins, else S6, else false)
                    |        |   (S8)              |   -> S8 / S8b line
                    v        v
                 CDN keeps the response for max-age / s-maxage

 Withheld factsheet (FACT-01):
   payload.dataQuality ──isHeadlineWithheld──> useFullHistoryWithheld() ─┐
                                                                         v
   MetricsColumn: fullHistoryWithheld, wholeRecordWithheld = !selected && fullHistoryWithheld
        |- props -> EoyReturnsPanel / CalmarByYearPanel / StyleDriftPanel (fullHistoryWithheld)
        |- props -> WorstDrawdownsTablePanel (wholeRecordWithheld)
        '- FactsheetView wrappers -> EndOfYearBarsPanel, MonthlyReturnsHeatmap, TimeSeriesChart(worstDDs, rolling crosshair)

 Owner tier (FACT-04), v2/page.tsx:
   Lane A probe (published) --miss--> Lane B probe (owner) --status != published--> lane = "owner"
        lane === "owner": strategy_verifications (trust_tier, created_at desc, limit 1) on the request client
        -> rawTrustTier = published signal ?? owner tier -> withTrustTier(payload, tier)  (per request, never cached)

 CACHE-03: unstable_cache callback -> builder -> payload.usdViewUnavailable === "price_read_failed"
        -> throw FactsheetDegradedBuildError(payload) -> page renders it uncached; next view rebuilds
```

### Recommended Project Structure (new and touched files)
```
src/lib/
├── stored-analytics-result.ts          # unchanged (dependency-free; keep it import-free)
├── analytics-hold.ts                   # NEW: the shared verdict helper (name is Claude's discretion)
├── factsheet/cache-control.ts          # NEW: SHORT_CACHE_CONTROL + the header chooser, shared by the OG and PDF routes
└── factsheet/og-metrics.ts             # edit: accept the hold flag, forward it to the gates
src/app/api/og/factsheet/[id]/route.tsx # edit: select, gate, line, header ladder
src/app/api/factsheet/[id]/pdf/route.ts          # edit: door, ETag, 304 header, 200 header
src/app/api/factsheet/[id]/tearsheet.pdf/route.ts# edit: door, 200 header
src/app/api/strategies/[id]/returns/route.ts     # edit: select, gate, effective flags, field
src/app/(dashboard)/recommendations/page.tsx     # edit: status read widened, hold, line
src/lib/queries.ts                               # edit: book embed + payload field; getFactsheetDetail aliases
src/app/(dashboard)/allocations/components/ScenarioComposer.tsx # edit: merge map + line
src/app/factsheet/[id]/v2/{MetricsColumn,AnalyticalPanels,BatchDPanels,DistributionPanels,HeatmapPanels,TimeSeriesChart,FactsheetView}.tsx # FACT-01
src/app/factsheet/[id]/v2/page.tsx               # FACT-04 owner read, CACHE-03 throw
src/__tests__/recompute-verdict-census.test.ts   # NEW census (name is Claude's discretion)
```

### Pattern 1: one verdict, composed once, read by every held surface
**What:** a pure function over a row that carries the evidence columns. It is the factsheet resolve stage's rule restated for reuse, not a second rule.
**When to use:** OG route, both PDF routes, returns route, book payload builder. Recommendations and `getFactsheetDetail` use the alias-projection form (see Pitfall 3).
**Example (shape; ids and names are mine, the three predicates are verbatim from the repo):**
```typescript
// Source: factsheet resolve stage, src/lib/factsheet/fetch-and-build-payload.ts:416-445,506
// [VERIFIED: fetch-and-build-payload.ts:416-420] const analyticsUpdating = isRecomputeOverStoredResult(
//   analytics?.computation_status, hasStoredAnalyticsResult(analytics));
// [VERIFIED: :441] if (isComputedAnalytics(analytics?.computation_status) && hasUnboundDerivePrestamp(analytics)) { ... notBuildable("not_computed")
// [VERIFIED: :506] if (isComposite && analyticsUpdating) { return notBuildable("not_computed");
export function analyticsHold(row: HoldRow | null | undefined) {
  const status = typeof row?.computation_status === "string" ? row.computation_status : null;
  const composite = effectiveDataQualityFlags(row).flags?.composite === true;
  const updating = isRecomputeOverStoredResult(status, hasStoredAnalyticsResult(row)) && !composite;
  const terminalOk = isComputedAnalytics(status) && !hasUnboundDerivePrestamp(row);
  return { updating, admitted: terminalOk || updating };
}
```
The factsheet page refuses a composite while updating and a terminal-success row left with an unbound prestamp (D-04). A surface that admits a row the page renders as pending produces a worse failure than a blank: a 409 on `pdf` and a 503 plus a Sentry error on `tearsheet.pdf` (its `tearsheet-main` marker check). So the helper must carry both refusals. [VERIFIED: `pdf/route.ts:380` returns 409 on the pending marker; `tearsheet.pdf/route.ts:~233-250` returns 503 on a missing `tearsheet-main`]

### Pattern 2: gates decided once in `MetricsColumn`, passed down as props
**What:** `fullHistoryWithheld = useFullHistoryWithheld()` and `wholeRecordWithheld = !selected && fullHistoryWithheld` are computed once and handed to panels. [VERIFIED: `MetricsColumn.tsx:318-319`]
**Import-cycle constraint:** `MetricsColumn.tsx` imports `AnalyticalPanels` and `BatchDPanels` [VERIFIED: `MetricsColumn.tsx:33-34`], so those two must NOT import from `MetricsColumn` (the cycle). `DistributionPanels.tsx` already imports `comparatorPartialYear, isoToMonthDay` from `./MetricsColumn` [VERIFIED: `DistributionPanels.tsx:8`], so it can import `headlineCoverageNote` directly. For `CalmarByYearPanel` and `StyleDriftPanel`, compute the `"panel"` note in `MetricsColumn` and pass it as a prop (a `HeadlineNote | null`, plus a tri-state to distinguish "gate off" from "omit"), or move `headlineCoverageNote` and the glyph and colour helpers into a leaf module that both import.

### Pattern 3: degraded build throws inside the `unstable_cache` callback
**What:** the page's callback already throws `FactsheetReadError` and `FactsheetDegradedBuildError` so `unstable_cache` never stores them; the page catches and renders uncached. [VERIFIED: `v2/page.tsx:120-143`, callback at `:218-224`]
```typescript
// Source: src/app/factsheet/[id]/v2/page.tsx:218-224 (existing)
return unstable_cache(async () => {
  const built = await fetchAndBuildPayloadWithReason(id, withPublishedOnly);
  if (built.reason === "read_error") throw new FactsheetReadError();
  if (built.payload && built.conventionsDegraded) throw new FactsheetDegradedBuildError(built.payload);
  return built.payload;
}, [/* keyParts */], { revalidate: 3600, tags: [/* ... */] })();
// CACHE-03 adds one line before `return built.payload`:
//   if (built.payload?.usdViewUnavailable === "price_read_failed") throw new FactsheetDegradedBuildError(built.payload);
```
The existing class message reads "built on the config tier after a failed conventions read", so generalise the message or add a sibling class.

### Anti-Patterns to Avoid
- **A panel calling `isHeadlineWithheld` itself.** UI-SPEC §1.2: one gate, decided in `MetricsColumn`.
- **Importing `MetricsColumn` from `AnalyticalPanels` or `BatchDPanels`.** Import cycle (above).
- **Putting the CACHE-03 throw in the builder.** The phase-148 closure test walks the builder's import graph and forbids cache reach. [CITED: `fetch-and-build-payload.ts` header comments and `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts`]
- **Reading `data_quality_flags` directly on a held surface.** During the derive prestamp window the live flags are the new derive's while the stored series is the last success's; read `effectiveDataQualityFlags(row).flags` (unit, curve method, composite, tiny-base days). [VERIFIED: `stored-analytics-result.ts` docblocks]
- **Widening `get_published_trust_signals` for FACT-04.** TODOS names it "Not a close".
- **Projecting `*` from `strategy_verifications`.** The table carries `encrypted_credentials` and `public_token` [VERIFIED: `supabase/schema/baseline.sql:14729-14748`]. Select `trust_tier` and `created_at` only.
- **A shorter TTL for CACHE-03.** TODOS names it "Not a close".

## FACT-02: per-surface gate lines and how the rule applies

State at HEAD: **W** = withholds at HEAD (a natural RED test exists on pre-fix code), **H** = already holds (the PROOF-01 gate needs a neutered copy and its named arm).

| # | Surface | Gate line(s) at HEAD | State | Change |
|---|---------|----------------------|-------|--------|
| S5 | OG card, `src/app/api/og/factsheet/[id]/route.tsx` | route.tsx:264 `const analyticsComputed = isComputedAnalytics(computationStatus);` then `computeOgHeadline(rows, data?.asset_class, analytics)` (:277). Inside `og-metrics.ts` there are three more gates: `isRankableAnalyticsRow` picks `stored` (og-metrics.ts:~103), `storedCashHeadlineGate(persisted, persisted?.metrics_json_by_basis, status)` is called WITHOUT the hold flag (:~112), and `headlineVerdict(persisted?.data_quality_flags, gate, status)` reads LIVE flags. | W | Add `computed_at` to the select; compute the helper; admit on `admitted`; pass the hold flag into `computeOgHeadline` so all three inner gates take `isStoredResultReadable(status, hold)`; read curve method, unit and headline flags from `effectiveDataQualityFlags`; draw `ANALYTICS_UPDATING_LINE` after `figureNote`; header ladder (CACHE-01). |
| S3 | `tearsheet.pdf` route | tearsheet.pdf/route.ts:187 `.select("id, name, status, strategy_analytics (computation_status)")`, :203-204 `analytics.computation_status !== "complete" && ... !== "complete_with_warnings"` → 400 | W | Select the evidence columns (see below); door = helper `admitted`; held render takes `SHORT_CACHE_CONTROL` (keep its `Vary`). |
| S4 | `pdf` route | pdf/route.ts:~247-255 same literal pair → 400; :307 `const etag = \`"${id}:${analytics.computed_at ?? ""}"\``; :316 the 304 branch sets `Cache-Control: public, s-maxage=3600, stale-while-revalidate=86400`; :424 the 200 branch sets the same | W | Same door; the ETag of a held render equals the ETag of the terminal render of the same `computed_at`, so a client holding the terminal PDF would be told 304 during a re-run: give a held ETag a suffix (for example `:updating`), and give the 304 branch the short header when held. |
| S6 | returns API | returns/route.ts:363-364 `.select(\`daily_returns, returns_series, computation_status, data_quality_flags, cagr, sharpe, ${RECORD_SCALAR_ALIASES}\`)`; :447 `isRankableAnalyticsRow(...)` decides series, `cagr`, `sharpe`, the three `figure_*` scalars; :456 and :573 `curveMethodFromFlags(analyticsRow?.data_quality_flags)`; :551 `dqf?.composite === true` | W | Add `cumulative_return` and `computed_at` to the select; replace the rankable test with the helper's `admitted`; read flags through `effectiveDataQualityFlags`; add `analytics_updating: boolean` (always present) to `ReturnsResponse` and the body. The route is already `NO_STORE_HEADERS`. |
| S7 | recommendations | recommendations/page.tsx:290-291 `.select(\`strategy_id, computation_status, trades_fetched_at, ${RECORD_SCALAR_ALIASES}\`)`; :317 `computedById.set(r.strategy_id, isRankableAnalyticsRow(r));` | W | Widen the status read with the list-projection evidence aliases (below); `computed` becomes `admitted`; add `analytics_updating` to the candidate; line in `RecommendationCard` after the `Metric` row. The RPC `get_allocator_recommendations` carries no status predicate, so its `cagr/sharpe/max_drawdown` are already the stored values. [CITED: the page's STALE-01 comment] |
| S8 | composer, drawer-added rows | lazy fetch parse at ScenarioComposer.tsx:~1745-1810 (the `d` shape and `settle(...)`); `addedSeriesStateByRef` at :2666-2675 is the precedence model | W (follows S6) | Parse `analytics_updating === true` strictly; store beside `addedSeriesStateById`; render in the note slot after `nativeUnpriced` (rows at :8319-8800). |
| S8b | composer, book rows | `getMyAllocationDashboard` embed `strategy_analytics ( daily_returns, cagr, sharpe, volatility, max_drawdown, data_quality_flags, returns_series, computation_status, record_observations:... )` (queries.ts:~6055-6065); `series_state` at :~6335 | W for the line (field absent); figures already show | Add `cumulative_return` and `computed_at` to the embed; strip both in the same destructure that already drops `computation_status` and `data_quality_flags` so no new field reaches the client; add `analytics_updating?: boolean` beside `series_state` in the payload type (queries.ts:~2661), set it ALWAYS in the builder (repo idiom: optional only so legacy fixtures compile). |
| S2 | tear sheet page | `getFactsheetDetail` (queries.ts:1735) returns `analytics` from `shapeRowAnalytics(...)`; the page only null-checks `result.analytics` (tearsheet/page.tsx `if (!result \|\| !result.analytics) notFound()`). `extractAnalytics` returns null only when there is no analytics row at all [VERIFIED: `src/lib/utils.ts:249-254`], and `shapeRowAnalytics` never returns null. Every figure comes from `fetchAndBuildPayloadWithReason`, which admits a held row. | **H** | No page change. Add a seam test (T5b beside the existing T5 in `page.stale-analytics.test.tsx`): computing row WITH stored evidence mounts the view with `analyticsUpdating: true`. PROOF-01 needs a neutered copy (for example force `analyticsUpdating` false in the resolve stage). The existing T5 fixture has no stored evidence, so it stays correct. |
| S2b | `getFactsheetDetail` projection | PUBLIC_ANALYTICS_COLUMNS (queries.ts:1516) carries no series and no flags, so `hasStoredAnalyticsResult` is false for it and its `analytics` is blank during a re-run | H (unused output) | Cheapest honest change: append the list-projection evidence aliases (below) to its select so its own `shapeRowAnalytics` holds and agrees with the payload. Apply the alias exemption (no `hasUnboundDerivePrestamp`, no blob). Verify nothing renders from it first (tearsheet page and metadata read only `strategy`, `manager`, `disclosureTier`). |
| S1/S10 | factsheet, share, lists, /compare, owner list | resolve stage; `shapeRowAnalytics`; `StrategyTable` | H (Phase 190) | unchanged; classified `owner` / `holds` in the census |
| S9 | composite approval 409 | admin route composite arm | n/a | ruled out; census class `write-gate` |

**Evidence columns each surface must read** (`hasStoredAnalyticsResult` needs a series, a finite `cumulative_return` and the success marker; the snapshot binds through `computed_at`) [VERIFIED: `stored-analytics-result.ts` `hasStoredAnalyticsResult` and `markerSource`]:

| Read | Missing today | Add |
|------|---------------|-----|
| OG embed | `computed_at` | `computed_at` (series, `cumulative_return` and flags are already selected) |
| Returns route | `cumulative_return`, `computed_at` | both |
| Recommendations status read | `cumulative_return`, `computed_at`, any marker alias | `cumulative_return, computed_at, cumulative_method:data_quality_flags->>cumulative_method, last_success_cumulative_method:data_quality_flags->last_success_snapshot->flags->>cumulative_method, last_success_computed_at:data_quality_flags->last_success_snapshot->>computed_at` (the alias spellings are verbatim from `CATEGORY_RANKING_ANALYTICS_COLUMNS`, queries.ts:~597) |
| Book payload embed | `cumulative_return`, `computed_at` | both (strip before the payload leaves) |
| Both PDF routes | everything except the status | `computation_status, computed_at, cumulative_return, daily_returns, returns_series, data_quality_flags` (the OG route already reads both series columns on every unfurl hit) |
| `getFactsheetDetail` | series, marker, `cumulative_return` | the alias set above plus `series_end:returns_series->-1->>date` (already in `RECORD_SCALAR_ALIASES` terms) |

**Rule split to record in the census (Phase 190 plan 07 precedent):** a projection that carries no flags blob cannot answer `hasUnboundDerivePrestamp` (it always answers false). Recommendations and `getFactsheetDetail` therefore apply the evidence rule only and carry an explicit census classification saying so; the blob surfaces (OG, returns, PDFs, book payload) apply both. [CITED: `stored-analytics-result.ts` docblock on `hasUnboundDerivePrestamp`]

**Behaviour change to report plainly:** applying the D-04 refusal to OG, returns and the PDFs blanks a terminal-success row whose derive prestamp left no bound snapshot. Today those surfaces print its stored figures while the factsheet shows the queued state. This follows CONTEXT ("plus `hasUnboundDerivePrestamp` where it reads the flags blob") and G1 ("same state as the factsheet"), but it is a visible change for those rows and belongs in the ship report.

**CSV-only rows (risk):** a surface that projects only the `series_end` alias admits a row only if `returns_series` is populated. A CSV strategy whose only stored series is `daily_returns` would then blank on a list-projection surface while the factsheet holds it. The OG, returns, PDF and book surfaces read the full columns and are safe. For recommendations and `getFactsheetDetail`, measure on a CSV fixture before relying on the alias form. [ASSUMED: whether the analytics runner also writes `returns_series` for CSV strategies]

### Census test design (SC-2)

Model it on `src/__tests__/figure-gate-census.test.ts` (read this session): typed-in oracle, a walked root, an `EXCLUDED`-style map with a closed reason set, anti-vacuity anchors, and planted-file self-tests in a temp directory using `stripCommentsPreserveLines`. A helper-name scan alone is not enough: both PDF routes gate with `!== "complete"` literals, and the SI-01 test (`src/lib/complete-status-scan.test.ts`) freezes only the `=== 'complete'` form. [VERIFIED: its `COMPLETE_COMPARISON = /===\s*["']complete["']/g`]

**What it scans** (non-test `.ts` and `.tsx` under `src/`, comments stripped):
1. Call sites of nine symbols: `isComputedAnalytics(`, `isRankableAnalyticsRow(`, `isRecomputeOverStoredResult(`, `hasStoredAnalyticsResult(`, `hasUnboundDerivePrestamp(`, `isStoredResultReadable(`, `storedCashHeadlineGate(`, `usesLastSuccessSnapshot(`, `effectiveDataQualityFlags(`, plus the new helper's name.
2. Literal comparisons of the two success literals in both operators and both operand orders (`===`, `!==`).

**Key by (file, symbol) with a count, not by file.** `queries.ts` alone already has five verdict readers, so a per-file map would let a sixth through. HEAD call-site counts, measured by `grep` with `//`, `*` and `export function` lines filtered out (approximate: the census itself is the source of truth, regenerate it): `isRecomputeOverStoredResult`: admin route 1, fetch-and-build 1, headline-basis 1, queries 1, strategyGate 1. `hasStoredAnalyticsResult`: admin route 2, fetch-and-build 1, queries 1. `hasUnboundDerivePrestamp`: fetch-and-build 1. `isStoredResultReadable`: composite-read-path 3, headline-basis 1. `usesLastSuccessSnapshot`: compare page 1, queries 1. `effectiveDataQualityFlags`: fetch-and-build 1, queries 1, stored-analytics-result 2. [VERIFIED: grep this session]

**Classification vocabulary** (Claude's discretion; closed set, validated like the figure-gate census): `owner` (derives the verdict for a surface: the resolve stage, `shapeRowAnalytics`, the new helper), `holds` (applies it), `progress-terminal` (a "run ended" consumer that must keep reading terminal success: `useStrategySyncPoller`, `SyncPreviewStep`, `keys/sync`, `csv-finalize`, `ApiKeyManager`, `finalize-rerun`; [CITED: closed-sets.ts docblock "Deliberately separate from isComputedAnalytics"]), `percentile-cohort` (`isRankableAnalyticsRow` in queries.ts at :393, :1429, :1458; OQ-2 default: displayed but kept out of every cohort), `write-gate` (the admin composite 409 arm), `other-table` (`portfolio-analytics-adapter.ts` and `getPortfolioAnalyticsWithFallback`, whose `.eq("computation_status","complete")` is on `portfolio_analytics` [VERIFIED: queries.ts:2299-2316]; key sync and exchange status literals), `definition`, `retired`.

**Retired entries must be asserted mechanically by the test itself**, not only recorded with a command: walk `src/` (comment-stripped) and assert zero non-test occurrences of `StrategyBreakdownTable`, `getStrategyDetailV2`, `getPublicStrategyDetail` and `getStrategyDetail` (word-bounded, so `getStrategyDetailV2` is its own entry), and assert `src/app/portfolio-pdf/[id]/page.tsx` imports neither `closed-sets` nor a figure formatter. The docblocks in `queries.ts` name the deleted functions in comments, which is why the comment stripper matters. [VERIFIED: UI-SPEC evidence table and the `queries.ts` docblock text]

**Failure messages** must name the file, the symbol and both counts, and say which classes are legal, as `complete-status-scan.test.ts` does. A stale entry (a classified (file, symbol) pair the walk no longer finds) fails too. Add the vacuity floor and the planted-tree self-tests (an unclassified new reader fails; a comment-only mention does not count).

PROOF-01 for the census: neuter by adding a planted reader file to the walk (RED naming the file and symbol), or by deleting one classification row (RED stale/unclassified), restore by `cp` + `cmp`.

## FACT-01: where the panels render and how the gates are threaded

Gate computation, once, in `MetricsColumn`:
- `useFullHistoryWithheld()` = `!leverageApplied && isHeadlineWithheld(payload.dataQuality, basis)` [VERIFIED: `MetricsColumn.tsx:111-116`], `isHeadlineWithheld` = `basis === "cash_settlement" && dataQuality?.twrChainBroken === true && dataQuality.headlineWithheld === true` [VERIFIED: `:99-101`].
- `const fullHistoryWithheld = useFullHistoryWithheld(); const wholeRecordWithheld = !selected && fullHistoryWithheld;` [VERIFIED: `:318-319`].

| Panel | Component and file | Mount sites in `MetricsColumn.tsx` | Gate today | Gate after |
|-------|-------------------|-----------------------------------|-----------|------------|
| EOY Returns | `EoyReturnsPanel` (file-local, :1626) | full rail :701; `part="detailed"` :575 | `fullHistoryWithheld` dashes only `year === lastYear` (:1676) | whole panel body replaced; gate `fullHistoryWithheld` |
| Calmar by Year | `CalmarByYearPanel` (`AnalyticalPanels.tsx:286`) | :730; :586 | `fullHistoryWithheld && r.year === lastYear` (:329) | whole body replaced; `fullHistoryWithheld` |
| Worst 10 Drawdowns | `WorstDrawdownsTablePanel` (file-local, :1549; reads `useWindowedView`) | :731; :587 | none | whole body replaced; **`wholeRecordWithheld`** (keeps its zoomed slice) |
| Style Drift + KS | `StyleDriftPanel` (`BatchDPanels.tsx:33`, no props today) | :741 (inside the Style section); :593 | none | whole body replaced incl. the KS sentence; `fullHistoryWithheld` |

Secondary renderings (UI-SPEC §1.6; confirmed present): `EndOfYearBarsPanel` (`DistributionPanels.tsx:37`, `withheld = fullHistoryWithheld && year === lastYear` at :81; mounted by the `EndOfYearBars` wrapper, FactsheetView.tsx:~1002); `MonthlyReturnsHeatmap` (`HeatmapPanels.tsx:46`, `ytdWithheld={fullHistoryWithheld && r.year === lastYear}` at :119, the cell at :202-206); the `worstDDs` chart via `config.ddHighlights` (`TimeSeriesChart.tsx:~1076`, `chart-configs.ts:257-268`; the bands read `view.strategyWorst10` from the basis view, which is the whole record, so the gate is `fullHistoryWithheld`); the rolling crosshair via `CrosshairTooltip` (`TimeSeriesChart.tsx:~1273-1480`) with `railAvgWithheld = fullHistoryWithheld && !zoomed` (FactsheetView.tsx:1046).

**New note slot:** extend `HeadlineNoteSlot` (MetricsColumn.tsx:65, currently `"strip" | "stripRelative" | "main" | "returns" | "maxdd" | "cumulative"`) with `"panel"`. In `headlineCoverageNote` the withheld arm returns null for any slot other than strip, stripRelative and main (:~128), so `"panel"` must be added there and the two FH237 strings pinned in the function's unit test. The `recomputing` and `failed` arms already exist (:~131-135); `failed` returns null, which is UI-SPEC arm 2 (panel omitted).

**Failed arm, no empty heading:** the Style section mount condition is `(hasStyleDrift || scenarioMode) && { name: "Style", ... }` (:592; `hasStyleDrift` at :401). On a Withheld failed row outside scenario mode Style Drift is the only child, so the condition must use the same verdict or an empty "Style" heading renders and the later sections keep a wrong number.

**Tests that encode the OLD behaviour and must be rewritten, not deleted** (found by grep): `FactsheetView.headline-coverage.test.tsx` D1 (:1238), D4 (:1253) and WR-01 (:1265) assert that every EOY and Calmar row except the last keeps its figure; the dash-only-last-year arm is superseded by a whole-panel note. Also re-measure `MetricsColumn.no-loss-residues.test.tsx`, `MetricsColumn.parts.test.tsx`, `MetricsColumn.headline-bench.test.tsx`, `FactsheetView.window-kpis.test.tsx` and `FactsheetBody.census.test.tsx` (all carry `headlineWithheld: true` fixtures). `FactsheetBody.census.test.tsx` counts hints, small-sample warnings, repeated metrics and empty frames through `scripts/factsheet-census/count`; a Withheld census fixture will now render a panel header plus a note, so confirm the "no empty frame" counter does not read a note-only panel as empty. [ASSUMED: whether any of the three census fixtures is a Withheld row]

**Hover note:** the TODOS heading's "one hover note" is the crosshair tooltip on a rolling chart's last point. UI-SPEC §1.6 covers it (dash the strategy row at the last index when `railAvgWithheld`). CONTEXT's Deferred section lets the planner cover or name it; UI-SPEC already covers it, so plan it.

**Copy and registry impact:** the new FH237 sentences carry no registered glossary term. `src/__tests__/copy-census.test.ts` scans JSX text and prose strings (rule A retired words, rule B registered terms must go through `Term`, rule C dates through `formatDay`; pinned `PINNED_EXCEPTION_COUNT = 36`); re-run it, do not assume it stays at 36. The panel note uses an inline `style={{ color }}`, not `text-warning`, so it does not trip the degrade scan's trip pattern. [VERIFIED: `degrade-warning-scan.test.ts` `TRIP_SOURCE`]

## FACT-04: owner trust tier

**Lane B anchors in `src/app/factsheet/[id]/v2/page.tsx`:** Lane A probe and `readPublicVerificationSignals([id])` run together at :437-448; Lane B runs only on a Lane A miss and sets `lane = "owner"` only when `ownRow.status !== "published"` (:610); the owner build is `ownerBuild` (:706); `rawTrustTier = verificationSignals.get(id)?.trust_tier ?? null` (:955); the overlay is `withTrustTier(payload, trustTier)` (:968). Lane order is load-bearing: the published probe runs before any session read.

**The read:** inside `if (ownRow.status !== "published")` or immediately after it, only when `lane === "owner"`, on the existing request-scoped `supabase`:
```typescript
// shape only; columns are the whole projection
const { data, error } = await supabase
  .from("strategy_verifications")
  .select("trust_tier, created_at")
  .eq("strategy_id", id)
  .order("created_at", { ascending: false })
  .limit(1)
  .maybeSingle();
```
Order and limit mirror `get_published_trust_signals` (`SELECT DISTINCT ON (sv.strategy_id) ... ORDER BY sv.strategy_id, sv.created_at DESC`). [VERIFIED: `supabase/migrations/20260719140000_get_published_trust_signals.sql`] Then `rawTrustTier = published signal ?? ownerTier`, so a published row that reaches Lane B (the WR-01 case) keeps its published signal. Normalise the value through the same three-literal check the page already applies to `rawTrustTier`; never pass an unvalidated string.

**Is a schema change needed? No.** The policy exists: `CREATE POLICY "strategy_verifications_owner_select" ON "public"."strategy_verifications" FOR SELECT USING ((EXISTS ( SELECT 1 ...` [VERIFIED: `supabase/schema/baseline.sql:17578`, and the EXISTS body in `supabase/migrations/20260501055213_strategy_verifications_rls_polish.sql:78-85`: `s.id = strategy_verifications.strategy_id AND s.user_id = auth.uid()`]. RLS is enabled (`:17571`) and `authenticated` holds the table SELECT grant: `GRANT SELECT,INSERT,REFERENCES,DELETE,UPDATE ON TABLE "public"."strategy_verifications" TO "authenticated";` [VERIFIED: `baseline.sql:19388`]. The baseline is a dump of the PROD catalogue; a live-DB check was not run (and this phase does not need one). Admin also has `strategy_verifications_admin_select` (:17574); the `.eq("strategy_id", id)` filter keeps the read to one strategy either way. Existing precedent for a user-scoped read of this table: `getMyAllocationDashboard` embeds `strategy_verifications (trust_tier, status, created_at)` through the request client for the viewer's own strategies.

**Failure posture:** fail-soft like `readPublicVerificationSignals`: a read error leaves the tier `null`, the page still renders, and the error is reported (`captureToSentry` with a tag naming the stage). A null tier on the owner lane then reads "—", which is the pre-fix behaviour and honest when no verification row exists.

**Where to put it (test-harness consequence):** at least eight page tests mock `@/lib/queries` as `{ readPublicVerificationSignals: vi.fn() }` only, and their fake request clients expose only `select().eq().maybeSingle()`. A new export in `queries.ts` would be undefined under those mocks, and a chain with `.order().limit()` would throw. Put the read in its own small module (for example `src/lib/factsheet/owner-trust-tier.ts`) called from the Lane B block, with its own try/catch, and update the owner-lane harnesses (`page.owner-lane.test.tsx`, `page.owner-compute-state.test.tsx`, others found by `grep -l "withPublishedOrOwner" src/app/factsheet/\[id\]/v2/*.test.tsx`) to answer `strategy_verifications`.

**Per-surface owner and anon tests (ROADMAP requirement):** the tier renders in the Terms "Data source" row (`TermsPanel` reads `native.trustTier`, `tierLabel` map at MandatePanels.tsx:~85-89: "API-verified", "CSV-uploaded (verification pending)", "Self-reported", "—") and the masthead pill, in both the native and the USD view (`withTrustTier` reaches `usdView.payload`, so the existing `page.usd-trust.test.tsx` shape is the template). Cases: owner with a verification row (label and pill, both views); owner with none (`—`, no pill); owner with a failing read (`—`, page renders, capture called); anon on an unpublished strategy (page 404s on Lane A and has no session, so the observable anon case is the unchanged published signal path); non-owner signed-in on an unpublished strategy (404); share-link recipient (`/factsheet-share/[token]`, unchanged `—`).

## CACHE-01: the OG route

**Paths** (route.tsx): `if (!isUuid(id))` logs an info line and skips the read (:118) → `data` stays null, `failed` false: **malformed**. `withPublishedOnly(...).maybeSingle()` returning no row → `data = null`, `failed` false: **unpublished or unknown**, indistinguishable by design. A read `error` or a throw sets `failed = true` → `no-store` (:366). A **genuine not-found is exactly `data === null && !failed`**. The final line is `response.headers.set("Cache-Control", failed ? FAILURE_CACHE_CONTROL : LONG_CACHE_CONTROL);` [VERIFIED: route.tsx:366]. Constants: `const LONG_CACHE_CONTROL = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800";` (:42) and `const FAILURE_CACHE_CONTROL = "no-store";` (:46) [VERIFIED].

**Header ladder:** `failed` → `FAILURE_CACHE_CONTROL`; else `notFound || held` → `SHORT_CACHE_CONTROL`; else `LONG_CACHE_CONTROL`. The value is UI-SPEC's `SHORT_CACHE_CONTROL = "public, max-age=60, s-maxage=60"` with no `stale-while-revalidate`. [CITED: 237-UI-SPEC.md §4.1] Put it in a lib module so the PDF routes share it (a route file should not export non-handler constants).

⛔ **Unpublished and unknown ids must get the identical header and the identical card.** A different header for "unpublished" than "unknown" would be an existence oracle; today both are `LONG_CACHE_CONTROL`, so keeping both on the same `SHORT_CACHE_CONTROL` preserves the 404-style indistinguishability the other routes document (T-29-01).

**Existing tests that pin LONG for a not-found and must flip to the short constant:** `route.test.tsx` F2 (:~590, "a genuine not-found keeps the long cache"), `route.public-access.test.tsx` P1, P2 and P3 (the malformed case at :~288-301 asserts `LONG_CACHE`). F3 ("a healthy card keeps the long cache") and the P-series rendered-data case (:~372) stay LONG. F1, F4, F5 and P7 stay `no-store`.

**Good-after-bad-within-TTL on the real wrapper.** For the OG card the "cache" is an HTTP cache honouring the route's own `Cache-Control`, so a header string pin cannot exercise "within the TTL". Build a small double in the test: it takes the real `GET` response, parses `max-age`, `s-maxage` and `stale-while-revalidate` from the actual header, honours `no-store`, and serves from a store under a fake clock (`vi.useFakeTimers` / a manual clock). Sequence: request 1 at t0 (unpublished → generic card, header H1); publish; request 2 at t0+30 s (still the cached blank, the documented limit); request 3 at t0+61 s (real card). Under the pre-fix `LONG` header request 3 is still the blank card: RED with the named arm "not-found header". Add the symmetric held-re-run case (card with the Updating line at t0, run completes, real card at t0+61 s). Reuse the route harness in `route.public-access.test.tsx` (`next/og` stub class recording `(element, options)`, the recording query builder with the real `withPublishedOnly`, and the `afterSpy`).

**Gap not covered by CONTEXT or UI-SPEC (Open Question 2):** a **published row that is neither terminal nor held** (first-ever compute pending or computing, `failed`, a composite re-stitch, a D-04 unbound prestamp) still renders the three-dash card and, under the ladder above, takes `LONG_CACHE_CONTROL`. The card is blank because of a status that changes, so the same stale-blank-for-a-day defect remains for those rows. Recommendation: any card rendered without figures because the analytics are not admitted takes the short cache (the ladder condition becomes `notFound || !admitted`, which includes `held`). It is a one-condition change and reversible.

**Version bump:** `OG_CARD_VERSION` (`src/lib/factsheet/og-metrics.ts:191`, `"2"`) exists so cards cached under the old rules are not answered under the new URL, and its docblock says to bump it when the card's figure rules change. FACT-02 changes the figure rules for held rows. Recommendation: bump to `"3"`. The tests import the constant, so there is no literal to chase. [VERIFIED: grep of `OG_CARD_VERSION` in `src`]

## CACHE-03: the USD view and the cache wrapper

`buildUsdView` returns `{ usdViewUnavailable: "price_read_failed" }` when `readBenchmarkPrices(supabase, "BTC")` answers `!read.ok` (fetch-and-build-payload.ts:~1126-1150). The type is `type UsdViewOutcome = | { usdView: FactsheetUsdView } | { usdViewUnavailable: "price_read_failed" | "no_priced_day" };` [VERIFIED: fetch-and-build-payload.ts:~1103-1105] and the payload field is `usdViewUnavailable?: "price_read_failed" | "no_priced_day";` [VERIFIED: `src/lib/factsheet/types.ts:1045`]. Only `price_read_failed` is a transient failure; `no_priced_day` (empty closes, no covered day, too few priced days) is a data fact and **stays cached**.

**Change:** one throw in the page callback (Pattern 3). A degraded build already keeps the payload in the thrown error so the page renders it; the page's catch is `if (err instanceof FactsheetDegradedBuildError) payload = err.payload;` [VERIFIED: v2/page.tsx:~733]. Optionally bump the cache key `factsheet-v2-payload-v26` → `v27` (v2/page.tsx:307) so an entry already stored with `price_read_failed` inside the old hour is not served after deploy; pinned in `page.public-cache-key.test.tsx` (:290, :360, :381) and `factsheet-share/[token]/page.cache-isolation.test.tsx:156` (`EXPECTED_KEY_PREFIX`). The shape does not change, so the bump is the repo's deploy-flush convention, not a requirement. Open Question 3.

**Throw-not-stored semantics.** The page comment records a measured read of the bundled Next source: on a miss the callback is awaited before `cacheNewResult`, so a throw stores nothing, and a stale revalidation's `.catch` keeps the last good entry. [CITED: v2/page.tsx:~185-205, measured against 16.2.11] The official docs page confirms the cache API and `revalidate` but is silent on throws. [CITED: nextjs.org/docs/app/api-reference/functions/unstable_cache] The installed version is `^16.4.2`, so the claim is `[ASSUMED]` for the installed copy: Wave 0 re-reads `unstable-cache.js` in `node_modules/next/dist/server/web/spec-extension/` after install, and the real-wrapper test below is what proves it.

**The test, on the real builder and a store double that mirrors Next's keying:** `page.public-cache-key.test.tsx` already has it. Its `unstable_cache` double keys `[keyParts, args]`, stores a `null` as Next does, and lets a throw propagate before the store; the builder, visibility predicate and payload are real; its `READ-ERROR-NOT-CACHED` case (request 1 admin read fails, request 2 same run recovers and must BUILD, `adminReads` counts 2) is the exact analog. Copy it for CACHE-03 with a native-unit row (`data_quality_flags: { native_unit: "BTC" }`) and a `benchmark_prices` read that errors on request 1 and succeeds on request 2: request 2 must carry a `usdView` and no `usdViewUnavailable`, and `adminReads` must show two builds. The harness's `mockAdmin` answers `{data:null,error:null}` for every non-`strategies` table, so extend it to answer `benchmark_prices` (rows or an error) and to count those reads. `fetch-and-build-payload.test.ts` has the builder-level fake (`fake.btcRows`, `fake.btcError`) and the case "a failed closes read says price_read_failed" (:1254). Neuter: remove the new throw line (RED: request 2 replays `usdViewUnavailable`).

**Copy and registry edits (UI-SPEC A-RELOAD):** `FactsheetView.tsx:2962` text `"No USD view: the daily BTC closes could not be read. It is retried within the hour."` becomes `"No USD view: the daily BTC closes could not be read. Reload this page to try again."` (and the comment at :2956-2958 that calls the failure transient "within the hour"). The registry entry `factsheet.usd-view-read-failed` (`src/lib/degrade-warnings.ts:1133-1139`) currently has `action: null` and `shippedAction: "It is retried within the hour."`; change to `action: "A-RELOAD"` and drop `shippedAction`. A marker-only entry with an action is legal for class `read_failure`: the judge only checks the action sentence when `text` renders (`rendered !== null`), and `read_failure` needs an action or a `shippedAction`. [VERIFIED: `src/lib/degrade-warnings.test.tsx:283-330`; `A-RELOAD` sentence is `"Reload this page to try again."` at `degrade-warnings.ts:153-156`] Tests to update: `degrade-warnings.test.tsx:1045-1056` (pins `failed.shippedAction` and `failed.action`), `FactsheetView.usd-toggle.test.tsx:379` (the verbatim sentence), and `src/__tests__/degrade-warning-scan.test.ts` (the `FactsheetView.tsx` ledger row keeps its id list; no change to its count).

**Adjacent finding, not in scope (Open Question 4):** `readFactsheetBenchmark` (the BTC comparator, `src/lib/factsheet/benchmark-read.ts`) answers a failed read with `{ unavailable: true }`, and its docblock says "The honest unavailable form may be cached for the TTL (D-52)". REQUIREMENTS CACHE-03 reads "A failed BTC price read is never cached as a normal payload", which is broader than CONTEXT's USD-view scope. D-52 is a recorded earlier decision and CONTEXT locks the USD view, so do not widen silently; surface it.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| "Is this row held" | a per-surface status ladder | the shared helper over `hasStoredAnalyticsResult` + `isRecomputeOverStoredResult` + `hasUnboundDerivePrestamp` | five readers writing their own ladder is the drift this phase exists to remove |
| Flags of the stored numbers | `row.data_quality_flags` | `effectiveDataQualityFlags(row).flags` | prestamp window mixes generations |
| The Updating sentence | an inline string | `ANALYTICS_UPDATING_LINE` | single copy source (G2) |
| The Withheld panel sentence | a per-panel string | `headlineCoverageNote(..., "panel")` | one function owns cause mapping and `{R}` |
| Owner tier | a widened RPC or an admin client | request client + the existing RLS policy | the founder decision; admin would bypass the ownership check |
| HTTP cache simulation | a bare header equality | a clock-driven double parsing the real header | "within TTL" is not a string comparison |
| Census scanning | a hand-listed file list | the `figure-gate-census` shape with `stripCommentsPreserveLines` | comments name deleted symbols; a hand list rots |
| CACHE-03 store double | `(fn) => fn` | the keyed store in `page.public-cache-key.test.tsx` | an identity stub makes every cache case vacuous (its own docblock) |

**Key insight:** this phase adds no capability. Each fix is "make a surface ask the same question the factsheet already asks", and each gate is only worth having if a real seam test can fail it.

## Common Pitfalls

### Pitfall 1: the hold passes the status gate but the evidence is missing
**What goes wrong:** the gate admits `computing`, `hasStoredAnalyticsResult` answers false because `cumulative_return` or `computed_at` was never selected, and the surface keeps blanking while the new code looks right.
**How to avoid:** widen each select first (table above); the natural-RED test seeds a computing row WITH evidence, so the pre-fix failure and the post-fix pass both depend on the columns being read.
**Warning signs:** a unit test passes with a hand-built row that carries `cumulative_return` while the route's real select does not name it. Assert the select string in the route test (the OG `O4` test already records the select).

### Pitfall 2: live flags during the prestamp window
**What goes wrong:** a native-unit strategy's flags carry no `native_unit` while the derive prestamp holds; the unit parses as USD and a BTC series is served or labelled as USD.
**How to avoid:** every held surface takes unit, curve method, composite and tiny-base days from `effectiveDataQualityFlags(row).flags`. Test with a prestamp row plus a bound snapshot.

### Pitfall 3: a list-projection surface cannot apply the D-04 refusal
**What goes wrong:** `hasUnboundDerivePrestamp` always answers false for a projection without the flags blob, so recommendations and `getFactsheetDetail` would silently skip D-04.
**How to avoid:** record the exemption in the census classification and in the SUMMARY, as Phase 190 plan 07 did for the lists and /compare.

### Pitfall 4: the PDF ETag and 304 branch
**What goes wrong:** a held render and the terminal render of the same `computed_at` share an ETag, and the 304 branch (which runs before the render) sets `s-maxage=3600, stale-while-revalidate=86400`.
**How to avoid:** suffix the ETag for a held render and send `SHORT_CACHE_CONTROL` on the held 304; test both branches (the route tests already exercise If-None-Match).

### Pitfall 5: import cycle through `MetricsColumn`
**What goes wrong:** `AnalyticalPanels` or `BatchDPanels` importing `headlineCoverageNote` from `MetricsColumn`. See Pattern 2.

### Pitfall 6: the not-found header differing by cause
**What goes wrong:** short cache for unknown but long for unpublished (or the reverse) turns the header into an existence oracle.
**How to avoid:** one `notFound` boolean, one header, one card.

### Pitfall 7: stripped fields reaching the client
**What goes wrong:** widening the book embed with `cumulative_return` and `computed_at` spreads them into `analyticsRest` and onto the client payload.
**How to avoid:** destructure them out with the existing `_cs` and `_dqf` idiom (queries.ts:~6285-6292) and assert the payload keys in `queries.my-allocation.test.ts`.

### Pitfall 8: tests that mock `@/lib/queries` with one export
**What goes wrong:** a new export the page calls is undefined under eight existing page tests. See FACT-04 "Where to put it".

### Pitfall 9: CHANGELOG, TODOS and the skip token
The ship PR deletes the five closed TODOS entries and names them in the CHANGELOG entry; `VERSION` and `package.json` stay byte-equal four-digit strings; no CI skip token may appear in a commit message or PR body, not even in a sentence denying it. [CITED: project CLAUDE.md]

## Code Examples

### Held OG card header ladder
```typescript
// Source: route.tsx:366 (existing line) generalised; SHORT value from 237-UI-SPEC.md §4.1
const notFound = data === null && !failed;
response.headers.set(
  "Cache-Control",
  failed ? FAILURE_CACHE_CONTROL : notFound || !admitted ? SHORT_CACHE_CONTROL : LONG_CACHE_CONTROL,
);
```
(`admitted` as in Open Question 2; restrict to `held` if the founder wants the narrower reading.)

### HTTP-cache double for the OG test
```typescript
// test-local; parses the real header the route set
function httpCache(now: () => number) {
  const store = new Map<string, { body: unknown; expires: number }>();
  return async (key: string, fetchOrigin: () => Promise<{ body: unknown; cacheControl: string }>) => {
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

### Withheld panel body (UI-SPEC §1.4, verbatim markup)
```tsx
<p data-testid="panel-withheld-note" className="text-fixed-10 italic" style={{ color: headlineNoteColor("withheld") }}>
  {headlineNoteGlyph("withheld")}{note.text}
</p>
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `unstable_cache` as the default | `use cache` replaces it for most use cases; `unstable_cache` stays for non-`fetch` data that must persist across deployments | Next.js 16 [CITED: nextjs.org/docs/app/api-reference/functions/unstable_cache] | ROADMAP keeps `unstable_cache`; no migration in this phase |
| Withhold figures for any non-terminal status | Hold the last computed figures during a re-run (Phase 190) | 2026-11-03 | Phase 237 extends it to the remaining surfaces |
| Dash only the last calendar year on a Withheld row (plan 15 round 3) | Whole-panel note for the four panels | this phase | tests D1, D4, WR-01 flip |

**Deprecated/outdated:** the UI-SPEC and TODOS name surfaces deleted by Phases 195 and 196; they are census `retired` entries, not work.

## Runtime State Inventory

Not a rename or migration phase: omitted.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `unstable_cache` in the installed `next@^16.4.2` stores nothing when the callback throws (measured in the repo against 16.2.11; the official docs page is silent) | CACHE-03 | The CACHE-03 gate would go RED for the wrong reason; the real-wrapper test settles it, Wave 0 re-reads the installed source |
| A2 | The analytics runner writes `returns_series` for CSV-only strategies, so the `series_end` alias admits them on list-projection surfaces | FACT-02 | CSV rows would blank on recommendations and `getFactsheetDetail` while the factsheet holds them; measure on a CSV fixture |
| A3 | None of the three `FactsheetBody.census.test.tsx` fixtures is a Withheld row, so its counters do not move | FACT-01 | the census test goes red after the panels change; re-measure |
| A4 | Counts stated as "moves by N" for `degrade-warning-scan`, `copy-census` and the SI-01 allowlist are not computed here | Tests that move | planner must measure after the edit, never trust a number from this file |
| A5 | The `strategy_verifications` table GRANT in the PROD-catalogue baseline matches live PROD | FACT-04 | the owner read returns a permission error; fail-soft shows `—`; run the marker query first if a live check is wanted |
| A6 | Composite strategies should not hold on the new surfaces (factsheet refuses composite + updating, so G1 says match it) | FACT-02 | if the founder wants composites held on OG or returns, the helper's `!composite` term comes out; the page would still render queued |

## Open Questions (RESOLVED)

> All six were settled by 237-CONTEXT.md, section "Research follow-ups" (2026-11-23), and the orchestrator rulings to the planner. Where a recommendation below disagrees with the RESOLVED line, the RESOLVED line governs.

1. **"Next request" versus a 60 s cache (CACHE-01).**
   - What we know: ROADMAP SC-3 and REQUIREMENTS say the real card shows "on the next request". CONTEXT locks "a short cache (about 60 s)". UI-SPEC accepts "a request made 60 s or more later".
   - What's unclear: whether the founder reads "next request" literally.
   - Recommendation: follow CONTEXT (locked), word the test as "the first request after the short TTL expires", and say so in the ship report. `no-store` would satisfy the literal text at the cost of an uncached DB read per unknown-id hit.
   RESOLVED: no-store for every genuine not-found card (CONTEXT Research follow-ups; ruling 1), so the real card shows on the very next request. The 60 s value applies only to a held re-run card with figures.
2. **Published row that is neither terminal nor held still takes the long cache.**
   - What we know: first-ever compute, `failed`, composite re-stitch and D-04 rows render the dash card under `LONG_CACHE_CONTROL` per the CONTEXT ladder.
   - Recommendation: short cache whenever the card is rendered without figures because the analytics are not admitted (`!admitted`, which includes `held`). One condition, reversible. Needs the planner's call.
   RESOLVED: any card rendered without figures is no-store, keyed on `figuresRendered` (CONTEXT Research follow-ups; ruling 1).
3. **Bump the payload cache key (`v26`→`v27`) and `OG_CARD_VERSION` (`"2"`→`"3"`)?**
   - Recommendation: bump both (the OG version because FACT-02 changes the card's figure rules for held rows; the key to flush entries stored with `price_read_failed` before deploy). Both are pinned by constant or by three tests that move together.
   RESOLVED: yes, both bumped once (CONTEXT Research follow-ups).
4. **BTC comparator read failures (`readFactsheetBenchmark`) are cached for the TTL by an earlier decision (D-52).** REQUIREMENTS CACHE-03's wording is broader than CONTEXT's USD-view scope. Recommendation: leave it, name it in the ship report, and book it only if the founder wants it (TODOS holds open work only).
   RESOLVED: out of scope, named in the ship notes (CONTEXT Research follow-ups).
5. **Does `getFactsheetDetail` get widened or only classified?** Its output is unused beyond a null check. Recommendation: widen with the alias set (cheap, makes its `shapeRowAnalytics` agree with the payload) and say in the SUMMARY that no figure renders from it.
   RESOLVED: census classification only, NOT widened (CONTEXT Research follow-ups; ruling 4). The recommendation above is not adopted.
6. **Behaviour change on OG, returns, PDFs for a terminal-success row with an unbound derive prestamp (D-04).** Following CONTEXT blanks it, matching the factsheet. Report it; no action unless the founder disagrees.
   RESOLVED: parity with the factsheet, reported in the ship notes (CONTEXT Research follow-ups).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `node_modules` in the phase worktree | every test, lint and typecheck | ✗ | — | `npm ci` in the worktree (Wave 0, task 0) |
| Node / npm | install and run | not probed (no install attempted) | — | — |
| vitest | gates | ✗ until install | `^5.0.3` per `package.json` | — |
| `tsc`, ESLint | pre-push gates | ✗ until install | — | — |
| Live PROD DB | none required (no migration, no data read) | n/a | — | If a RLS check is wanted: marker query first (`shobj_description(oid, 'pg_database')`), PROD reads go through the MCP, never the linked CLI |
| mypy / analytics-service | only if `analytics-service/` is touched | not needed | — | this phase should touch no Python |

**Missing dependencies with no fallback:** none after `npm ci`.
**Missing with fallback:** `node_modules` (install first). Because it is absent, **no claim in this file about test counts, census moves, lint or tsc was executed**.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest `^5.0.3`, jsdom default; node environment is opt-in per file via `vitest.node-env.ts` |
| Config file | `vitest.config.ts` (`INCLUDE` covers `src/**/*.test.{ts,tsx}` and `scripts/**/*.test.{ts,tsx}`) |
| Quick run command | `npx vitest run <paths to the touched test files>` |
| Full suite command | `npm test` (CI shards it; `frontend-coverage` merges and enforces thresholds) |
| Pre-push gates | `npm run lint` (ESLint on `src/`, then the manifest, route-contract, planning-hygiene and canonical-domain checks), `npm run typecheck` (`tsc --noEmit`), targeted vitest. mypy only if `analytics-service/` is touched (it should not be). |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FACT-01 | per panel × per mount site × cause: note vs table; zoom rules; failed omits and no empty Style heading; KS line absent; EOY chart, heatmap YTD, worst-10 chart, hover | component | `npx vitest run src/app/factsheet/[id]/v2/MetricsColumn.withheld-panels.test.tsx` and extend `HeatmapPanels`/`DistributionPanels`/`TimeSeriesChart` tests | ❌ Wave 0 (new file); rewrite D1, D4, WR-01 in `FactsheetView.headline-coverage.test.tsx` |
| FACT-01 | `headlineCoverageNote(..., "panel")` strings pinned character for character | unit | `npx vitest run src/app/factsheet/[id]/v2/FactsheetView.headline-coverage.test.tsx` (or a new unit file) | ✅ extend |
| FACT-02 S5 | held card: figures plus the line, SHORT header; terminal: LONG | route | `npx vitest run src/app/api/og/factsheet/[id]` | ✅ extend `route.stored-parity.test.tsx`, `route.test.tsx` |
| FACT-02 S3/S4 | held PDF admitted (no 400), SHORT header, held ETag, held 304 short; terminal keeps its header | route | `npx vitest run src/app/api/factsheet/[id]/pdf src/app/api/factsheet/[id]/tearsheet.pdf` | ✅ extend both `route.test.ts` |
| FACT-02 S6 | `analytics_updating` always present; held series and scalars | route | `npx vitest run src/app/api/strategies/[id]/returns` | ✅ extend `route.test.ts` |
| FACT-02 S7 | held card shows stored figures and `recommendation-analytics-updating` | page | `npx vitest run src/app/(dashboard)/recommendations` | ❌ new `page.rerun-hold.test.tsx` beside `page.stale-analytics.test.tsx` |
| FACT-02 S8/S8b | composer line from S6 and from the book field; book wins | component | `npx vitest run src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` and `src/lib/queries.my-allocation.test.ts` | ✅ extend |
| FACT-02 S2 | tear sheet mounts the view with `analyticsUpdating` for a held row | seam | `npx vitest run src/app/factsheet/[id]/tearsheet/page.stale-analytics.test.tsx` | ✅ add T5b |
| FACT-02 census | every reader classified; unclassified fails; retired absent | source scan | `npx vitest run src/__tests__/recompute-verdict-census.test.ts` | ❌ Wave 0 |
| FACT-04 | owner label and pill (both unit views), owner none, owner read fails, non-owner and anon unchanged | page seam | `npx vitest run src/app/factsheet/[id]/v2/page.owner-lane.test.tsx src/app/factsheet/[id]/v2/page.usd-trust.test.tsx` | ✅ extend; ❌ add `page.owner-trust-tier.test.tsx` |
| CACHE-01 | not-found header ≠ LONG, real card after TTL on a clock-driven HTTP-cache double | route | `npx vitest run src/app/api/og/factsheet/[id]/route.public-access.test.tsx` | ✅ flip F2, P1-P3; ❌ new `route.cache-ttl.test.tsx` |
| CACHE-03 | failed price read then good read inside the old TTL: second view has `usdView` | page seam on the keyed store double | `npx vitest run src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx` | ✅ add the case |
| CACHE-03 copy | new sentence verbatim; registry entry has `action: "A-RELOAD"` | unit | `npx vitest run src/lib/degrade-warnings.test.tsx src/app/factsheet/[id]/v2/FactsheetView.usd-toggle.test.tsx` | ✅ update |

### PROOF-01: neuter map (every gate must go RED with its named arm first)
Take a byte backup before every edit (`cp file file.bak`), neuter, run the named command and record the failing test name, restore with `cp file.bak file`, run `cmp file file.bak` (exit 0), then GREEN. Never `git checkout`, `restore` or `stash`.

| Gate | Neuter | Expected RED arm |
|------|--------|------------------|
| FACT-01 gates | force each panel's gate false; swap Worst 10 to `fullHistoryWithheld`; restore the `year === lastYear` condition on the heatmap; drop the last-index condition on the tooltip; force the EOY chart prop false | the withheld cases; the in-range Worst 10 slice case; the earlier-rows YTD case; the previous-index case |
| S5 OG | helper `admitted` hard-wired to terminal-only; drop the hold flag from `computeOgHeadline` | held-card figures case; each inner gate has its own arm |
| S3/S4 | door back to the literal `!== "complete"` pair; drop the held ETag suffix; restore the long 304 header | 400 on a held row; ETag-equal case; 304 header case |
| S6/S7/S8b | helper false; `analytics_updating` forced false in the book builder | `analytics_updating` true case; line present case |
| S2 | force `analyticsUpdating` false in the resolve stage (the surface already holds, so there is no pre-fix RED) | T5b |
| Census | plant a new reader; delete a classification row | unclassified and stale |
| FACT-04 | read on every lane; drop the `lane === "owner"` condition; pass the unvalidated string | non-owner and invalid-tier cases |
| CACHE-01 | not-found back to `LONG_CACHE_CONTROL` | request 3 at t0+61 s still blank |
| CACHE-03 | remove the new throw | request 2 replays `usdViewUnavailable` |

### Sampling Rate
- **Per task commit:** the targeted `npx vitest run` paths for that task, plus `npx tsc --noEmit` when a type changed.
- **Per wave merge:** `npm run lint`, `npm run typecheck`, the full vitest files of every touched directory.
- **Phase gate:** `npm test` green, the census green, `degrade-warning-scan`, `copy-census`, `complete-status-scan` and `figure-gate-census` green, then `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `npm ci` in the worktree (no `node_modules`); re-read the installed `unstable_cache` source to settle A1.
- [ ] `src/__tests__/recompute-verdict-census.test.ts` — FACT-02 census.
- [ ] `src/app/factsheet/[id]/v2/MetricsColumn.withheld-panels.test.tsx` — FACT-01.
- [ ] `src/app/api/og/factsheet/[id]/route.cache-ttl.test.tsx` and the clock-driven HTTP-cache double — CACHE-01.
- [ ] `src/app/(dashboard)/recommendations/page.rerun-hold.test.tsx` — S7.
- [ ] `src/app/factsheet/[id]/v2/page.owner-trust-tier.test.tsx` and the owner-lane harness answers for `strategy_verifications` — FACT-04.
- [ ] `SAMPLES` entry for the new `scenario.analytics-updating` registry id in `src/lib/degrade-warnings.test.tsx` (the judge fails with "no fixture sample" otherwise, :234 shows the shape) and the `scenario` ledger id list in `degrade-warning-scan.test.ts` (ScenarioComposer row, ids list gains one id).

### Tests and censuses that move (all counts `[ASSUMED]` until measured)
`src/__tests__/degrade-warning-scan.test.ts` (ScenarioComposer ids), `src/lib/degrade-warnings.test.tsx` (USD entry pin at :1045-1056, new sample), `src/__tests__/copy-census.test.ts` (re-measure; `PINNED_EXCEPTION_COUNT = 36`), `src/lib/complete-status-scan.test.ts` (only if a `=== 'complete'` site is added or removed; the PDF routes use `!==` and are outside its regex), `FactsheetBody.census.test.tsx`, the figure-parity tests (`route.stored-parity.test.tsx`, `src/__tests__/figure-parity-pages.test.tsx`), `page.public-cache-key.test.tsx` and `page.cache-isolation.test.tsx` if the key bumps. `src/__tests__/figure-gate-census.test.ts` only if a new file prints a figure without a gate import (the panel notes print none).

## Security Domain

`security_enforcement` is absent from `.planning/config.json`, so it is treated as enabled. [VERIFIED: grep of the config returned no `security_enforcement` key]

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no change | existing `supabase.auth.getUser()` (JWT validated server-side); FACT-04 adds no auth path |
| V3 Session Management | no | — |
| V4 Access Control | **yes** | FACT-04 relies on RLS `strategy_verifications_owner_select` as the ownership check; the returns route keeps `withPublishedOrOwner`; the OG route keeps `withPublishedOnly`. Never use the admin client for the owner tier read. |
| V5 Input Validation | yes | `isUuid(id)` on the OG route and `getFactsheetDetail`; normalise `trust_tier` through the three-literal check; parse `analytics_updating` strictly (`=== true`) on the client |
| V6 Cryptography | no | none hand-rolled; do not project `encrypted_credentials` |
| V7 Error handling / logging | yes | fail-soft owner read reports to Sentry with a stage tag and no row content; the `analytics_updating` field adds no error text |
| V8 Data protection | yes | the owner read selects `trust_tier, created_at` only (the table also holds `encrypted_credentials`, `public_token`, `errors`, `metrics_snapshot`); book-payload evidence columns are stripped before the client |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Existence oracle via different OG header for unpublished vs unknown | Information disclosure | one header and one card for every not-found cause |
| Owner's tier cached and served to anonymous readers | Information disclosure | Lane B never enters `buildFactsheetPayloadCached`; the tier is a per-request overlay (`withTrustTier`) and the lane-order and cache-isolation tests stay green |
| Cross-tenant tier read | Elevation of privilege | RLS owner policy plus `.eq("strategy_id", id)`; do not read on the published lane |
| CDN pins a held PDF or card after the run finishes | Tampering (stale truth) | `SHORT_CACHE_CONTROL` for held renders, held ETag suffix |
| `analytics_updating` leaks state of an unreadable strategy | Information disclosure | emitted only after the existing published-or-owner probe, like every other field on the route |
| Unvalidated `trust_tier` string reaches a label | Tampering | strict three-literal normalisation |

## Project Constraints (from CLAUDE.md)

- **Next.js differs from training data** (AGENTS.md): read `node_modules/next/dist/docs/` for any API used. It was unavailable here (no install); the public docs page was read instead, and A1 is flagged.
- **DESIGN.md governs every visual decision**; UI-SPEC is the approved contract and adds no token, size or colour.
- **Which database am I on:** this phase writes no data and applies no migration. If a live PROD read is ever wanted, run the marker query first (`SELECT shobj_description(oid, 'pg_database') AS which_database FROM pg_database WHERE datname = current_database();`); PROD reads go through the MCP.
- **CHANGELOG discipline:** every ship writes an entry before the push, in the same commit as the `VERSION` bump; enumerate commits, group by theme, cross-check each commit maps to a bullet; use this repo's section vocabulary (`### Fixed`, `### Added`, `### Changed`, `### Tests`, `### Notes`, ...); name the five closed TODOS ids. `VERSION` and `package.json` stay byte-equal four-digit strings; never `npm version`.
- **TODOS.md holds open work only:** the ship PR deletes `164.6.6.3.3-WITHHELD-RESIDUE`, `[190-RERUN-SURFACES-NOT-HOLDING]`, `164.6.6.2.1-OWNER-TRUST-TIER-UNPUBLISHED`, `170.3-OG-NOTFOUND-CACHE`, `164.6.6.2.1-USDVIEW-READFAIL-CACHED` in the same PR (not a tick, not a "CLOSED" paragraph), and fixes any pointer to them in the same PR. LOW and Info review survivors are not booked.
- **CI skip trailer:** never write a CI skip token in a commit message or PR body, not even to deny it; count checks bound to the head SHA.
- **Completion is historical:** after any verifier run, convert `covered_files`/`covered_digest` to `verified_at_sha` + `drift_subjects`; never list `TODOS.md`, `CHANGELOG.md`, `VERSION` or `package.json` in `drift_subjects`.
- **GSD orchestration:** never hand-dispatch a `gsd-*` agent; `git diff` after every `gsd-tools` state handler run.
- **Testing rules (project memory):** data-integrity and user-facing gates must be able to fail (PROOF-01, byte backup, never `git checkout/restore/stash`); `grep -a` always; a new test file moves several censuses (grep them all); mypy belongs in a brief only if analytics code is touched (not here); no AI authorship trailers or "Generated with" lines.
- **155.2 freeze:** this phase changes display and cache only. It moves no stored number, writes nothing to the database and does not touch `computed_at` for any strategy, so the freeze window (155.2 plan 12 recapture to plan 14) is not engaged. [VERIFIED by scope: no compute, ingest or migration file is on any change list in this file]

## Figure values, migration and ship-report facts

- **Migration: none.** FACT-04 reads through an existing policy and grant, CACHE-01 is a header, CACHE-03 a throw, FACT-01/02 are display. No `supabase/migrations/**` file, no SQL gate arm, no `RED-UNDER` twin. [VERIFIED: the RLS policy and GRANT above]
- **Displayed figure values that change (report plainly):** (1) FACT-01 removes figures on a Withheld full-history view: the Worst 10 table, EOY Returns, Calmar by Year, Style Drift and its KS line, the EOY chart labels, the heatmap `YTD` column for every year (not just the last), the worst-10 chart bands and the rolling tooltip's last-point value. (2) FACT-02 shows, on the five newly holding surfaces during a pending or computing re-run, the figures stored by the last success (the same ones the factsheet already shows), where they used to be dashes or a 400. (3) A terminal-success row with an unbound derive prestamp now blanks on OG, returns and the PDFs. No stored number, computation or `computed_at` changes anywhere.
- **Ship-report follow-ons to name** (CONTEXT: reversible, derived from the founder's reason): the secondary renderings of the withheld figures, zoom behaviour of the three whole-record panels, failed-cause omission, FH237 sentences, the reload sentence, short cache on PDFs and the card during a held re-run, share-link recipient stays `—`.

## Sources

### Primary (HIGH confidence, read in this session)
- `.planning/phases/237-*/237-CONTEXT.md`, `237-UI-SPEC.md`, `237-DISCUSSION-LOG.md`; `.planning/ROADMAP.md` `### Phase 237`; `.planning/REQUIREMENTS.md` FACT/CACHE rows; five TODOS entries.
- `src/lib/stored-analytics-result.ts`, `src/lib/closed-sets.ts` (:760-880), `src/lib/factsheet/headline-basis.ts`, `src/lib/factsheet/og-metrics.ts`, `src/lib/factsheet/fetch-and-build-payload.ts` (:97-135, :330-560, :680-870, :1060-1215), `src/lib/factsheet/benchmark-read.ts`, `src/lib/queries.ts` (:440-620, :800-1010, :1505-1790, :2296-2320, :6040-6475), `src/lib/utils.ts` (`extractAnalytics`).
- `src/app/api/og/factsheet/[id]/route.tsx` (whole file), `src/app/api/factsheet/[id]/pdf/route.ts`, `.../tearsheet.pdf/route.ts`, `src/app/api/strategies/[id]/returns/route.ts`, `src/app/api/admin/strategy-review/route.ts` (:255-275, :385-440), `src/lib/strategyGate.ts` (:530-600).
- `src/app/factsheet/[id]/v2/{page.tsx, MetricsColumn.tsx, FactsheetView.tsx, HeatmapPanels.tsx, DistributionPanels.tsx, BatchDPanels.tsx, AnalyticalPanels.tsx, TimeSeriesChart.tsx, MandatePanels.tsx}` (the ranges cited), `src/app/factsheet/[id]/tearsheet/page.tsx`, `src/app/(dashboard)/recommendations/page.tsx`, `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (:1660-1830, :2600-2700, :8310-8800).
- Test seams read: `page.public-cache-key.test.tsx`, `page.owner-lane.test.tsx`, `page.usd-trust.test.tsx`, `tearsheet/page.stale-analytics.test.tsx`, OG `route.test.tsx` and `route.public-access.test.tsx`, `src/__tests__/figure-gate-census.test.ts`, `src/lib/complete-status-scan.test.ts`, `src/__tests__/degrade-warning-scan.test.ts`, `src/lib/degrade-warnings.test.tsx`, `src/__tests__/copy-census.test.ts` (header), `src/lib/factsheet/fetch-and-build-payload.test.ts` (:1150-1290), `vitest.config.ts`, `vitest.node-env.ts`.
- `supabase/schema/baseline.sql` (:14729-14753, :17571-17584, :19387-19389), `supabase/migrations/20260501055213_strategy_verifications_rls_polish.sql`, `.../20260719140000_get_published_trust_signals.sql`.
- Prior archives: `.planning/milestones/v1.20-phases/190-*/190-CONTEXT.md` (D-05), `190-03-SUMMARY.md`; `.planning/milestones/v1.20-phases/164.6.6.3.3-*/164.6.6.3.3-15-SUMMARY.md` (classification, B23, D6).

### Secondary (MEDIUM confidence)
- nextjs.org/docs/app/api-reference/functions/unstable_cache (fetched 2026-11-23): API, `revalidate`, `use cache` replaces it in Next 16, silent on throws.

### Tertiary (LOW confidence)
- None used as authority.

### Steps skipped, plainly
The `research-plan` / `research-store` seam, the `package-legitimacy` seam and the graphify queries were **not run**: no external package is involved and the questions were answered from the repo and the one docs page. Context7 requires authentication and was not needed. No code, test, lint or typecheck was executed (no `node_modules`).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no change.
- Architecture (surfaces, gate lines, evidence gaps, seams): HIGH for what was read; the "H versus W" split and the evidence-column gaps follow directly from the selects and gates quoted.
- Pitfalls: MEDIUM-HIGH; the CSV-series and census-fixture points are flagged `[ASSUMED]`.
- Cache semantics: MEDIUM until A1 is settled by the installed source and the real-wrapper test.

**Research date:** 2026-11-23
**Valid until:** 2026-12-07 (the seam is edited by DBACC-01 later in v1.23, and 155.2 work can touch neighbouring files; re-measure the line anchors before planning if the base moves).
