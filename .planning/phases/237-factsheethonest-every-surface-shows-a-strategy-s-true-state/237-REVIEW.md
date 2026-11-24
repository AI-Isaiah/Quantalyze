---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
reviewed: 2026-11-23T21:47:55Z
reviewed_at_sha: 70db9bd50a7351dcae75804b9767c094fbd74f30
diff_base: 4002cf06e
depth: deep
files_reviewed: 21
files_reviewed_list:
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/recommendations/page.tsx
  - src/app/api/factsheet/[id]/pdf/route.ts
  - src/app/api/factsheet/[id]/tearsheet.pdf/route.ts
  - src/app/api/og/factsheet/[id]/route.tsx
  - src/app/api/strategies/[id]/returns/route.ts
  - src/app/factsheet/[id]/v2/AnalyticalPanels.tsx
  - src/app/factsheet/[id]/v2/BatchDPanels.tsx
  - src/app/factsheet/[id]/v2/DistributionPanels.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/HeatmapPanels.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/TimeSeriesChart.tsx
  - src/app/factsheet/[id]/v2/chart-configs.ts
  - src/app/factsheet/[id]/v2/page.tsx
  - src/lib/analytics-hold.ts
  - src/lib/degrade-warnings.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/factsheet/og-metrics.ts
  - src/lib/factsheet/owner-trust-tier.ts
  - src/lib/queries.ts
findings:
  critical: 0
  warning: 3
  info: 8
  total: 11
  necessity: 0
status: clean
---

# Phase 237: Code Review Report

**Reviewed:** 2026-11-23T21:47:55Z
**Depth:** deep
**Files Reviewed:** 21 production files. The 29 test files in the 50-file scope were read only where they bear on a finding (returns H8, the CACHE-03 store double, the census F-1 row).
**Status:** issues_found

## Summary

I reviewed `git diff 4002cf06e HEAD -- src` across the phase's production files. I also traced the cross-file seams the brief named: `analyticsHold` against the factsheet resolve stage, the OG cache ladder, the owner-lane trust read, and the `unstable_cache` throw path.

**What holds up (checked, not assumed):**

- **`analyticsHold` matches the resolve stage's three refusals.** I compared `src/lib/analytics-hold.ts:69-75` with `fetch-and-build-payload.ts:416-506`: not terminal and not updating, then a terminal success with an unbound prestamp (D-04), then a composite while updating. Both read the composite term from the effective flags. Every surface the phase wired passes the evidence columns `hasStoredAnalyticsResult` needs: the OG embed, both PDF selects and the returns select carry the series, the headline, the flags and `computed_at`; recommendations carries `series_end`, which comes from `returns_series`, and the metrics writer stamps that on every compute.
- **The CACHE-03 throw path is correct in the installed Next (16.4.2).** I read it in `node_modules/next/dist/server/web/spec-extension/unstable-cache.js`. On a miss, `await cb` runs before `cacheNewResult` (around line 216), so a throw stores nothing and propagates the same error object, and the page's `instanceof FactsheetDegradedBuildError` catch still sees its payload. A stale revalidation that throws returns `cachedResponse` (around lines 185-189). The test uses a store double, but the source confirms the double's semantics.
- **FACT-04 is sound.** The read runs only inside `ownRow.status !== "published"` (`page.tsx:653-726`), on the request client, and selects `trust_tier, created_at` only. The `strategy_verifications_owner_select` RLS policy (baseline:17578) and the table grants (baseline:19387-19388) back it. `get_published_trust_signals` (baseline:7418-7431) applies no verification-status filter, so the owner's tier follows the same "latest row" rule as the published one. The value never enters `buildFactsheetPayloadCached`.
- **The OG ladder is coherent.** `notFound` and `!figuresRendered` both go to `no-store`, so malformed, unknown and unpublished ids send identical headers. A held card gets 60 s with no stale-while-revalidate, and a terminal card keeps the long cache.
- **FACT-01's panel gates agree.** All panel gates share one predicate and one basis (`useFullHistoryWithheld` and `headlineCoverageNote(..., "panel")` both use `useBasisOrCash`). The Worst 10 chart draws its bands from the full-record view (`TimeSeriesChart.tsx:96` uses `useBasisSeriesView`), so withholding it inside a zoom is consistent while the rail table keeps its windowed slice.

**Key concerns (three MEDIUM, all user-facing; one is also data-integrity):**

1. The composer's book rows still resolve their series and unit from the **live** flags. The phase put the Updating line ("these figures are from the last completed computation") on those same rows, and moved the drawer path for the same strategy to the effective flags. That leaves two answers in one composer during the derive window.
2. Plan 01 now withholds a terminal row whose derive prestamp left no bound snapshot (D-04). The returns API then labels that row `series_state: "empty"`, so the composer prints "No data" while the factsheet says it is being computed.
3. F-1 (plan 11): the `/strategies` share note tells the owner the factsheet is "not available yet" during a held re-run. The same row's Health word says Updating, and the factsheet shows figures.

Necessity rubric read (`~/.claude/gsd-core/references/necessity-review.md`); no necessity finding met its evidence rule. No `.claude/skills/` or `.agents/skills/` directory exists in the worktree.

## Warnings

### WR-01: Book-strategy composer rows read the LIVE flags while now vouching "from the last completed computation" (MEDIUM, user-facing + data-integrity)

**Classification:** WARNING. Severity MEDIUM.
**File:** `src/lib/queries.ts:6224-6229`, `:6274`, `:6288`, `:6168` (with `:6361`, which the phase added)
**Issue:** In `getMyAllocationDashboard`, `dqf` is the raw `analyticsObj.data_quality_flags`. That one value drives `curveMethodFromFlags(dqf)` (the series differencing, at 6274 and 6288), `parseReturnsUnit(dqf.native_unit)` (the USD conversion), `is_composite` and `tiny_base_days`, and `bookHasNativeUnit` (6168) reads the live blob too. Inside the derive hop's prestamp window the live flags are the new derive's. They carry no `cumulative_method` (`_prestamp_dq_flags`, job_worker.py), so `curveMethodFromFlags` falls back to `"geometric"` (`resolve-series.ts:23`). A strategy whose stored curve is `simple` is therefore differenced the wrong way, and its tiny-base days and chain flags are the new derive's, not the stored series'.

This phase fixed exactly that defect (RESEARCH Pitfall 2) on the returns API (`returns/route.ts:466-472`, test H6) and the OG card, but left the book path alone. The same phase then added `analytics_updating` to these rows (`queries.ts:6361`), and plan 13 prints the line from it. So during a held re-run, a book row's blend leg can carry a mis-resolved series under a line that says the figures are the last completed computation. A drawer-added row for the same strategy (served by the returns API) would resolve correctly. The two supply paths in one composer disagree, which the UI-SPEC's S8/S8b "one map, the two supply lines cannot disagree" premise rules out.

The live-flags read predates the phase (UI-SPEC 2.2 S8b notes the path has no terminal gate). What is new is that the phase now vouches for those figures, and that the drawer path for the same strategy was fixed while this one was not. Composer legs feed money-math blends, so this is data-integrity.
**Fix:** use the same effective-flags read the returns route now uses. This is a minimal, local change:
```ts
// queries.ts ~6224
const dqf = effectiveDataQualityFlags(analyticsObj).flags as
  | { composite?: unknown; native_unit?: unknown; cumulative_method?: unknown; tiny_base_days?: unknown }
  | null
  | undefined;
// queries.ts ~6168 (bookHasNativeUnit): parseReturnsUnit(effectiveDataQualityFlags(a).flags?.native_unit)
```
Add one case beside `queries.my-allocation.test.ts`'s held fixtures: a pending row whose live flags are a prestamp (no `cumulative_method`), with a bound snapshot whose `cumulative_method` is `"simple"`. The book row's series must equal the snapshot-method resolve. Check it goes RED on the live-flags read first.

### WR-02: Returns API labels a D-04-withheld terminal row `series_state: "empty"`, so the composer prints "No data" for a strategy with a full record (MEDIUM, user-facing)

**Classification:** WARNING. Severity MEDIUM.
**File:** `src/app/api/strategies/[id]/returns/route.ts:466-467`, `:502-531`
**Issue:** Before this phase, a `complete` / `complete_with_warnings` row was always admitted. Now `analyticsRankable = hold.admitted` is false for a terminal row whose derive prestamp left no bound snapshot (D-04). That is the intended parity change, and CONTEXT accepts the withholding. But `daily_returns` is then `[]`, and `series_state = deriveEmptySeriesState(status, …)` with `status === "complete"` answers `"empty"` (`closed-sets.ts:934-937`: "terminal absence"). The composer maps `"empty"` to the "No data" chip (`ScenarioComposer.tsx:8366`, `:8378`) and the settled no-metrics note.

The factsheet for the same row shows its queued/being-computed state (`fetch-and-build-payload.ts:441-447`, `notBuildable("not_computed")`). The resolve-stage comment says this state lasts through the bridge's derive hop and, for a protected refresh's restore, "until the next success", which can be a whole day. A drawer-added strategy with a full record would read "No data" for that whole time. Test H8 (`route.test.ts:1869-1879`) asserts the withholding but never asserts `series_state`, so nothing pins the label.

This scope is the label only. The withholding is correct and must not be reverted.
**Fix:** say "computing" for a row the hold refuses only because of the D-04 window, beside the existing ladder:
```ts
// returns/route.ts, inside `if (daily_returns.length === 0)`
series_state =
  isComputedAnalytics(status) && hasUnboundDerivePrestamp(analyticsRow)
    ? "computing"
    : deriveEmptySeriesState(status, strategyCreatedAt);
```
Extend H8 with `expect(body.series_state).toBe("computing")`, and check it goes RED on the current code first.

### WR-03: F-1 confirmed: `/strategies` share note says "not available yet" for a held re-run, contradicting the same row and the factsheet (MEDIUM, user-facing)

**Classification:** WARNING. Severity MEDIUM.
**File:** `src/app/(dashboard)/strategies/page.tsx:820-825` (with `:792-803`, `:1017`)
**Issue:** I traced plan 11's F-1 and it is real. `if (!isComputedAnalytics(embedStatus))` sends every `pending` / `computing` row to `uncomputedNote`. A held re-run over a stored success is one of those rows. `unbuildableNoteKindOf("not_computed", …)` answers null, and `recipientShareNoteFor(mode, arm, null)` is `recipientShareNote`. For a published row that is KCS12-PUBLIC, "Right now, this strategy's factsheet link shows that the factsheet is not available yet". For a private link it is the "being prepared … numbers appear once a computation succeeds" line.

The public factsheet holds that row and shows its figures (Phase 190), and the same `/strategies` row's Health word reads Updating (`:1017`, `analyticsUpdating: s.analytics.analytics_updating === true`). The owner is told something false about what recipients see, on every daily re-run, for every strategy with a share link. The defect predates the phase (167.2.1 D-04/D-08), but the phase goal is "every surface shows a strategy's true state", and the census row is marked PROVISIONAL pending this decision. It is copy only, with no figure involved.
**Fix:** do not add a third status ladder. Let the builder's own resolve stage answer for in-flight rows: probe `pending` / `computing` rows the way computed rows are probed. `probeFactsheetBuildable` admits a held row (buildable, so no note) and refuses a first compute (`not_computed`, which falls through to `uncomputedNote`, unchanged):
```ts
const inFlight = embedStatus === "pending" || embedStatus === "computing";
if (!isComputedAnalytics(embedStatus) && !inFlight) {
  return [s.id, await uncomputedNote(s, mode, embedStatus === "failed")] as const;
}
```
Then scope the `not_computed` "race" `console.warn` (`:914-918`) to rows whose embed said computed, so a first-compute row does not log a false race. Reclassify the census row from PROVISIONAL `progress-terminal` to `holds` in the same change. The cost is one probe per in-flight row per page load, under the existing `PROBE_CONCURRENCY` limiter.

## Info

### IN-01: `analyticsHold` restates the resolve stage with no executable parity check (LOW)

**File:** `src/lib/analytics-hold.ts:17-19`, `src/lib/factsheet/fetch-and-build-payload.ts:416-506`
**Issue:** The module docblock says "change the resolve stage and this function moves with it, or the two drift". Nothing enforces that. `analytics-hold.test.ts` tests the function in isolation, and the census counts symbol call sites, not outcomes. The resolve stage itself does not call `analyticsHold`.
**Fix:** either have the resolve stage derive `analyticsUpdating` and its two refusals from `analyticsHold(analytics)`, or add one matrix test that feeds the same rows to both and asserts the same admit/refuse answer.

### IN-02: `headline_since` reaches OG, returns and recommendations through a LIVE-blob SQL alias (LOW)

**File:** `src/lib/figure-record-scalars.ts:27-28` (consumed at `og/factsheet/[id]/route.tsx:332`, `returns/route.ts:548`, `recommendations/page.tsx:384`)
**Issue:** `headline_since:data_quality_flags->>headline_since` reads the live flags. Inside a prestamp window a held (or snapshot-bound terminal) Dated chain-broken row loses `headline_since`, so `figureSpan` measures the whole series rather than the headline span. The record gate can then clear on these three surfaces where the factsheet (effective flags) says short or withheld. The window is narrow (Dated row, headline under the 90-day floor, derive hop in flight), and the figures shown are true stored values, not wrong numbers.
**Fix:** on the two routes and recommendations, overwrite `headline_since` from `effectiveDataQualityFlags(row).flags?.headline_since` before `recordFromScalars`, or note it in the ship report as recorded-not-fixed.

### IN-03: PDF routes decide the hold and the cache header before the puppeteer render (LOW)

**File:** `src/app/api/factsheet/[id]/pdf/route.ts:267`, `:328-331`; `tearsheet.pdf/route.ts:216`, `:308-310`
**Issue:** If a re-run starts between the admin read and the page render, the PDF prints the Updating line but carries the terminal ETag and the long cache (1 h CDN plus 1 day SWR on the factsheet PDF). The reverse race is harmless. The window is a few seconds.
**Fix:** accept and record it, or take the short cache whenever the status read is not terminal at either end.

### IN-04: The rolling chart's Export CSV still carries the withheld last rolling value (LOW, recorded residue)

**File:** `src/app/factsheet/[id]/v2/TimeSeriesChart.tsx` (export menu; plan 09 "Residue, recorded not fixed")
**Issue:** The FACT-01 follow-on says that showing a withheld figure in a second rendering defeats the ruling. The hover card and legend chip now dash the last index, but the per-chart CSV export of the same rolling chart still includes the value.
**Fix:** blank the strategy column's last row in the export when `config.lastPointWithheld`, or record it in the ship report as accepted.

### IN-05: `generateMetadata`'s `?u=` cache key reads the raw `native_unit`; the card renders the effective one (LOW)

**File:** `src/app/factsheet/[id]/v2/page.tsx:402-405` vs `src/app/api/og/factsheet/[id]/route.tsx:272-275`
**Issue:** In a prestamp window the URL's unit key and the card's unit can differ, so a card can be cached under a URL whose `u` does not match it. The route never reads `u`, so the card's content stays correct. Only the cache-entry selection the `u` key exists for is weakened.
**Fix:** read `effectiveDataQualityFlags(analytics).flags?.native_unit` in `generateMetadata` (and add `computed_at` to its embed).

### IN-06: A held public build throws `FactsheetDegradedBuildError` labelled `conventions_read_failed` (INFO)

**File:** `src/app/factsheet/[id]/v2/page.tsx:246-249`; cause at `fetch-and-build-payload.ts:698`
**Issue:** `conventionsDegraded` includes `basisInFlight`, so every held build (correctly never stored) takes the conventions reason and message, though no conventions read failed. The phase introduced the `reason` field, so the mislabel is now explicit.
**Fix:** add a third reason, `basis_in_flight`, or document the overload in the class docblock.

### IN-07: The heatmap month cell holding the break still prints (INFO)

**File:** `src/app/factsheet/[id]/v2/HeatmapPanels.tsx:118-123`
**Issue:** The founder's Q2 reason ("the year that holds the break compounds across it") applies equally to the month that holds the break, and twelve visible month cells compound to the withheld year. This is outside the ruling's literal scope (by-year panels only).
**Fix:** none required. Name it in the ship report so the founder can extend the ruling or not.

### IN-08: Unfurl caches ignore `Cache-Control`; a held card can outlive its 60 s at Slack and LinkedIn (INFO)

**File:** `src/app/api/og/factsheet/[id]/route.tsx:429-437`
**Issue:** The 60 s header bounds the CDN, but not the unfurlers' own copies, which can keep "Updating with the latest data…" for days. This is inherent and was accepted by CONTEXT's ruling.
**Fix:** none. Record it in the ship notes beside the 60 s decision.

---

_Reviewed: 2026-11-23T21:47:55Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_

## Silent-failure hunt (round 1), merged here

- **SFH-M1** is the same defect as WR-02: the returns API answers `series_state: "empty"` for a complete row withheld by D-04. One fix covers both.
- **SFH-M2 (MEDIUM): `price_read_failed` reaches only `console.error`** (`src/lib/factsheet/fetch-and-build-payload.ts`, the `!read.ok` branch). Since CACHE-03, nothing caches the failure, so a sustained BTC-price outage hits every view and never reaches Sentry. Fix: `captureToSentry` with stage `usd-view-price-read`.
  - The copy half ("Reload this page" is wrong for structural read defects) is not changed. The UI-SPEC locks that copy and its A-RELOAD action, and the Sentry event now makes a structural defect visible to us.
- LOW notes from the hunt (owner-tier Sentry context, PDF render race, whole-series selects): recorded, not fixed.

## Round 2 re-review

**Reviewed:** 2026-11-23T22:08:37Z at `3fc439e450707f541c09b0f852ee6a0a37f207a5`
**Scope:** `git diff 39a9476f4 HEAD -- src` only (WR-01, WR-02, WR-03, SFH-M2 and the census update; 9 files).
**Reviewer:** Claude (gsd-code-reviewer), depth deep, MEDIUM+ only.
**Tests run:** the five touched suites (`strategies/page.key-pill`, `returns/route`, `fetch-and-build-payload`, `queries.my-allocation`, `recompute-verdict-census`): 5 files, 543 tests, all passed. No source was edited, so no neuter was run. RED-ability is argued from the code below.

**Verdict: no MEDIUM+ findings.**

### WR-01: resolved

- **The select supplies the evidence.** The `strategy_analytics` embed in `getMyAllocationDashboard` (`queries.ts:6068-6080`) carries `data_quality_flags` and `computed_at`, which are the two columns `effectiveDataQualityFlags` reads (the live bag, and the bound snapshot's `computed_at` instant match). It also carries the series, `cumulative_return` and `computation_status`.
- **`bookHasNativeUnit` reads the same embed.** It reads `strategiesRes.data[].strategy.strategy_analytics` (`:6158-6168`), the same rows and embed that `dqf` reads at `:6225`, so the probe and the conversion now agree on the unit. Before this fix they could not disagree either, but both answered from the live flags.
- **No regression.** Every `curveMethodFromFlags` / `native_unit` / `composite` / `tiny_base_days` read in the function goes through `dqf` (`:6229-6289`). `analyticsHold(analyticsObj)` still gets the unstripped row. A row with no marker and no bound snapshot falls back to the live bag, the same value as before. A terminal success always stamps the marker, so the live bag wins for it.
- **The unit-probe half is behaviour-neutral and pinned only by the census.** The derive prestamp writes `native_unit` into its own flags (`job_worker.py:10961`, `_prestamp_flags["native_unit"] = _mt5_unit.code`). The live bag and the bound snapshot therefore agree on the unit unless the account's unit changed between runs. No behavioural test covers `bookHasNativeUnit`, and none is needed for the defect WR-01 named. The census count of 3 keeps the call site in place.
- **The test can fail.** Under the old code the live flags have no `cumulative_method`, so the method falls back to geometric: 1.10/1.05 − 1 ≈ 0.0476 and 1.00/1.10 − 1 ≈ −0.0909. That fails `toBeCloseTo(0.05, 10)` and `toBeCloseTo(-0.1, 10)`.

### WR-02: resolved

- In the `daily_returns.length === 0` branch, `isComputedAnalytics(status) && hasUnboundDerivePrestamp(analyticsRow)` matches the hold's refusal 2 (`analytics-hold.ts:73`) and the resolve stage's D-04 arm (`fetch-and-build-payload.ts:441-447`). A row in this state now reads "computing", the composer's syncing chip, the same as the factsheet's queued state.
- **No regression.** Every other empty case still goes through `deriveEmptySeriesState`. That covers failed rows, missing rows, first computes and terminal rows with a genuinely empty series and no prestamp key.
- **The test can fail.** In H8 the row is `complete` with an unbound prestamp. The old code answers `"empty"` (terminal absence), so the new `toBe("computing")` goes RED.

### WR-03: resolved

I traced each case through `page.tsx:817-936` and the resolve stage (`fetch-and-build-payload.ts:416-506`):

| Row | Path | Note |
|---|---|---|
| First compute (pending or computing, no stored result) | probed; resolve refusal 1, `not_computed` without `analyticsFailed` → `uncomputedNote(s, mode, false)` | the same as before (KCS12-PUBLIC, or MINT-A / "being prepared"); the race warn is suppressed because the embed was not computed |
| Held re-run (stored result, not composite) | probed; `buildable` (no basis gate, `basisInFlight`) | no note, which matches the factsheet showing its figures |
| Held composite re-run | probed; `not_computed` (CR-01 arm) → uncomputed note | "not available yet", which matches the factsheet's own withholding |
| `failed` | not probed → `uncomputedNote(..., true)` | unchanged |
| No analytics row (`null` status) | not probed → `uncomputedNote(..., false)` | unchanged |
| Probe throw, timeout, `read_error` or `not_visible` on an in-flight row (**behaviour change**) | the "could not check" line (`probeUnreadableShareNote`) | the same rule computed rows follow (167.2.1 SFH H-2). It replaces the uncomputed line those rows could not get before, and the outcome is still counted and captured once per load |
| Race: embed says computing, builder reads `failed` | `kind === "analytics_failed"` → failed note | correct copy; no race warn (see below) |

- **The tests can fail.** In HELD-RERUN-PUBLISHED and HELD-RERUN-PRIVATE, the old code never probes an in-flight row, so `adminStrategyReads` would be `[]` and the uncomputed note would render. FIRST-COMPUTE-PUBLISHED catches two regressions: removing the probe (`adminStrategyReads` assertion), and dropping the `isComputedAnalytics(embedStatus)` scope on the warn (`not.toHaveBeenCalledWith`). The mock change only defaults an un-seeded in-flight row to a first compute (series, no headline). The pre-existing MINT-A and NOT-PROBED-UNCOMPUTED cases still pass, and their expectations still mean what they meant.
- **Census.** `page.tsx::isComputedAnalytics` count 2 / `holds` matches the two call sites.

### SFH-M2: resolved

`captureToSentry` sits in the `!read.ok` branch with stage `usd-view-price-read`, the strategy id, the code and the message. Two sibling captures in the module send a message too (`seriesReadError` `:286` and the conventions capture `:711`, both as `errorMessage`). The admin-read capture sends the code only.

- **Can the probe reach it? No.** `buildUsdView` has one caller, `resolveAndBuild` (`:1089`). `probeFactsheetBuildable` (`:1304`) calls only `resolveFactsheetInputs(..., "probe")`, which never builds. WR-03 widens the probed set, but that cannot bring back the per-row-per-load noise that the `caller === "build"` gates exist to prevent (167.2.1-R2 WR-01). Only real builds capture. The test filters by stage and asserts exactly one call. With the old code, no call matches, so it goes RED.

### Below the bar (recorded here only, per the TODOS rule: LOW/INFO is not booked)

- LOW: the embed-computing/builder-failed race on an in-flight row no longer logs any warn. It was never logged before WR-03 either, because such rows were not probed.
- LOW: the `heldRerun` fixture's `cumulative_method: "compound"` is not a recognised method, so it logs a `curveMethodFromFlags` warning. It still satisfies the marker check, so the test means what it says.
- LOW: SFH-M2 captures once per view during a sustained price outage. That volume is the intent of the fix. Sentry groups the events by message.

_Round 2 reviewed: 2026-11-23T22:08:37Z_

### Round 2 silent-failure re-check

No HIGH or CRITICAL findings. One borderline MEDIUM, accepted rather than fixed:
- **Where:** the returns API's WR-02 "computing" label (`route.ts`, the `hasUnboundDerivePrestamp` arm).
- **What:** the label has no time bound. A protected refresh that fails over a legacy row whose snapshot is unbound keeps the composer on "syncing" until the next success.
- **Why it is accepted:** this equals the factsheet's D-04 queued state for the same row, so the two surfaces agree. It is not a regression.

**Final verdict:** clean after round 2. All MEDIUM+ round-1 findings (WR-01, WR-02/SFH-M1, WR-03, SFH-M2) are fixed. Round 2 re-reviewed the fixes at 3fc439e45.
