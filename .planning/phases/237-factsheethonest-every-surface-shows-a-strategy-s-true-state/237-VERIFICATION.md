---
phase: 237-factsheethonest-every-surface-shows-a-strategy-s-true-state
verified: 2026-11-24T00:30:00Z
status: passed
score: 5/5 must-haves verified
verified_at_sha: c8b0d44f956d3c4ada2bb462c1f1ab00336f96de
drift_subjects:
  - src/lib/analytics-hold.ts
  - src/app/api/og/factsheet/[id]/route.tsx
  - src/lib/factsheet/og-metrics.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/factsheet/owner-trust-tier.ts
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/TimeSeriesChart.tsx
  - src/app/factsheet/[id]/v2/HeatmapPanels.tsx
  - src/app/api/strategies/[id]/returns/route.ts
  - src/app/api/factsheet/[id]/pdf/route.ts
  - src/app/api/factsheet/[id]/tearsheet.pdf/route.ts
  - src/app/(dashboard)/recommendations/page.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/lib/queries.ts
  - src/__tests__/recompute-verdict-census.test.ts
behavior_unverified: 0
overrides_applied: 0
gaps: []
human_verification: []
---

> **verified_at_sha rebound 2026-11-24 (records PR).** The verdict was issued on phase-branch commit `ba46be5ce`, which is not reachable from `main` after the squash merge. It is rebound to the merge commit `c8b0d44f9` (#1316) so that `scripts/verification-drift-report.mjs` can diff from a reachable commit. None of the files listed in `drift_subjects` differs between the two commits. The phase's own changes since `ba46be5ce` are two test pins, updated after CI's first run on #1316: the JOB-01 census row for `analytics-hold.ts`, and the live anon OG probe's expected `no-store`. The other differences come from unrelated phases that merged first (#1314, #1315). None of this changes what was verified.

# Phase 237: FACTSHEETHONEST Verification Report

**Phase Goal:** Every surface shows a strategy's true state (withheld, re-running or owner-private), and no cache re-serves a stale or failed one. This phase owns the factsheet seam: the OG route, `fetch-and-build-payload.ts` and `v2/page.tsx`.
**Verified:** 2026-11-24, source at `ba46be5ce09ce67e746fceda84194f70de712d95`
**Status:** passed (human_needed until the post-merge closure of 2026-11-25 at the end of this report)
**Re-verification:** No, initial verification.

Note on HEAD: the branch tip moved to `45c106594` (`docs(237): security audit SECURED`) while this ran. `git diff --stat ba46be5ce HEAD -- src` is empty, so the verified source is the current source. `237-SECURITY.md` (21 threats, 0 open) was written at `ba46be5ce`.

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A withheld factsheet prints no whole-record reading beside rail figures that read as dashes, per the founder's Q1-Q3 rulings (FACT-01) | VERIFIED | `MetricsColumn.tsx`: `headlineCoverageNote(..., "panel")` returns cause-specific Withheld sentences (`recomputing`, `failed` returns null, else the earlier-history sentence). `worstDrawdownsPanel` withholds on `wholeRecordWithheld` (zoom keeps its slice, Q1). `eoyReturnsPanel`, `calmarByYearPanel`, `styleDriftPanel` gate on `fullHistoryWithheld` and stay withheld under a zoom (Q2, Q3). A failed cause unmounts the panel, with no note. Follow-ons: heatmap `ytdWithheld={fullHistoryWithheld}` for every row (`HeatmapPanels.tsx`); Worst 10 chart renders only title plus `PanelWithheldNote` when `config.withheldNote` is set (`TimeSeriesChart.tsx`); rolling hover dashes the last index (`lastPointWithheld`). One predicate throughout (`useFullHistoryWithheld`, `isHeadlineWithheld`). `MetricsColumn.withheld-panels`, `FactsheetView.withheld-renderings` and `FactsheetView.headline-coverage` pass. |
| 2 | During a re-run every surface on the census stays published with the Updating line; the census fails on an unclassified new reader (FACT-02) | VERIFIED | One verdict, `analyticsHold` (`src/lib/analytics-hold.ts`), restating the resolve stage's three refusals. Applied at: OG route (`hold.admitted` gate, Updating line when `hold.updating && figuresRendered`); returns API (`analytics_updating` field, effective flags); both PDF routes (door is `hold.admitted`, ETag gets `:held`, held render takes `HELD_RERUN_CACHE_CONTROL`); recommendations (`updatingById`, `data-testid="recommendation-analytics-updating"`); composer drawer rows (`d.analytics_updating === true`) and book rows (`analytics_updating` from `getMyAllocationDashboard`, book wins). `ANALYTICS_UPDATING_LINE` equals Phase 190 D-06 verbatim. Tear sheet figures come from the payload builder, which already holds (T5b test). `recompute-verdict-census.test.ts` keys `file::symbol` with exact counts, 7 legal classes, retired surfaces asserted by zero occurrences, and planted self-tests (unclassified, stale, count change, retired symbol). It passes at HEAD. Composite approval 409 is classified `write-gate` per the founder ruling. |
| 3 | A strategy published after its OG card was first requested shows its real card on the next request; a not-found card is never long-cached; a failed BTC price read is not cached as a normal payload and the next view retries it. Each case is driven by a good-after-bad-within-TTL test (CACHE-01, CACHE-03) | VERIFIED | OG route header ladder: `failed \|\| notFound \|\| !figuresRendered` gives `no-store`; held re-run gives 60 s with no SWR; rendered terminal keeps the long cache. `figuresRendered` defaults false beside the sentinels. `route.cache-ttl.test.tsx` C1 (not-found good-after-bad), C2 (figure-less good-after-bad), C3 control, C4 existence oracle (unknown, unpublished and malformed ids send identical header and card), C5, C6 held, C7 failed. All run through the real `GET` against a clock-driven HTTP-cache double. CACHE-03: `buildFactsheetPayloadCached` throws `FactsheetDegradedBuildError(payload, "price_read_failed")` inside the `unstable_cache` callback when `usdViewUnavailable === "price_read_failed"` (only that value; `no_priced_day` stays cached). Key bumped v26 to v27, and `OG_CARD_VERSION` 2 to 3. The page catches the error and renders the carried payload uncached. `page.public-cache-key.test.tsx` drives good-after-bad on a keyed store double of `unstable_cache`. The review verified the double's semantics against installed Next 16.4.2 `unstable-cache.js` (a miss awaits the callback before `cacheNewResult`). The USD note reads "Reload this page to try again." and the registry entry uses A-RELOAD. Round-1 SFH-M2 added a Sentry capture (stage `usd-view-price-read`). |
| 4 | The owner's private factsheet shows the data source of their own key-backed strategy, never "Data source —", while anon reads only the published tier; owner and anon are tested per surface (FACT-04) | VERIFIED | `owner-trust-tier.ts` reads `strategy_verifications` (`trust_tier, created_at` only, newest first, limit 1) on the request client. It is called only inside the `ownRow.status !== "published"` owner-lane block of `v2/page.tsx`, and fails soft with a Sentry capture. `rawTrustTier = verificationSignals.get(id)?.trust_tier ?? ownerTrustTier ?? null`, overlaid through `withTrustTier`, never entering `buildFactsheetPayloadCached`. The RLS policy `strategy_verifications_owner_select` (baseline.sql:17578) is the ownership check; `get_published_trust_signals` is not widened. `page.owner-trust-tier.test.tsx` covers owner with and without a row, request-client-only, read error and throw, anon and non-owner on unpublished (404, owner read never called), WR-01 published-row-on-Lane-B, Lane A, anon on published (dash), and the share-link recipient (still dash, route does not import the read). |
| 5 | PROOF-01: each gate goes RED on pre-fix code or a neutered copy with its named arm first, restored from a byte backup (`cp` back, `cmp`) and GREEN, recorded verbatim in the plan SUMMARY | VERIFIED | Every SUMMARY carries RED, `cmp` and GREEN records (13 of 13; for example 237-13 records RED 1 to 3 with `cp` restore and `cmp` exit 0). Independently re-checked: a detached worktree at base `4002cf06e` with this phase's 31 changed test files copied over and `node_modules` symlinked ran 26 files RED (172 tests failed) and 5 GREEN. The five that pass are phase-150 invariant, recommendations figure-gate, tear sheet stale-analytics, owner-compute-state and signed-zero, which are the existing suites whose edits are pin or fixture reconciliations. The worktree was removed afterwards. |

**Score:** 5/5 truths verified (0 present, behavior-unverified; two visual items below).

### Requirements Coverage

| Requirement | Source Plan | Status | Evidence |
|-------------|-------------|--------|----------|
| FACT-01 | 03, 09, 12 | SATISFIED | Truth 1 |
| FACT-02 | 01, 05, 06, 07, 08, 11, 13 | SATISFIED | Truth 2. Five named surfaces no longer exist (portfolios, `getStrategyDetailV2`, `getPublicStrategyDetail`, `getStrategyDetail`); the census asserts them retired by zero word-bounded occurrences. |
| FACT-04 | 10 | SATISFIED | Truth 4 |
| CACHE-01 | 02, 05 | SATISFIED | Truth 3 |
| CACHE-03 | 04 | SATISFIED | Truth 3 |
| Census SC (SC-2) | 11 | SATISFIED | Truth 2 |

FACT-03 and FACT-05 (Phase 238) and CACHE-02 (Phase 239) are not this phase's: ROADMAP and CONTEXT assign them elsewhere, and REQUIREMENTS.md maps them to 238 and 239. They are not orphaned here.

### Key Link Verification

| From | To | Via | Status |
|------|----|-----|--------|
| OG route | `analyticsHold` / `HELD_RERUN_CACHE_CONTROL` | import and `hold = analyticsHold(analytics)` | WIRED |
| OG route | `computeOgHeadline(..., hold.updating)` | fourth argument into `isStoredResultReadable`, `storedCashHeadlineGate` | WIRED |
| `v2/page.tsx` | `readOwnerTrustTier` | owner-lane block, `?? ownerTrustTier` in `rawTrustTier`, then `withTrustTier` | WIRED |
| `buildFactsheetPayloadCached` | `FactsheetDegradedBuildError("price_read_failed")` | throw inside the `unstable_cache` callback, caught by the page | WIRED |
| `MetricsColumn` | EOY, Calmar, Style Drift, Worst 10 panels | `panelNote` and `wholeRecordPanelOmitted`, in both document and rail layouts | WIRED |
| `FactsheetView` | `TimeSeriesChart` `withheldNote` and `lastPointWithheld` | chart config map | WIRED |
| returns API | composer | `analytics_updating` field read with `=== true` | WIRED |
| `getMyAllocationDashboard` | composer book rows | `analytics_updating` boolean, evidence columns stripped before the payload ships | WIRED |
| PDF routes | `analyticsHold` | door, ETag `:held`, cache header | WIRED |
| recommendations page | `analyticsHold` | `computedById` and `updatingById` | WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data variable | Source | Real data | Status |
|----------|---------------|--------|-----------|--------|
| OG card | `hold`, `sharpe/cagr/maxDd` | `strategy_analytics` embed (now carries `computed_at`) via `computeOgHeadline` | Yes | FLOWING |
| Returns API | `analytics_updating`, series | `strategy_analytics` select with `cumulative_return, computed_at`, effective flags | Yes | FLOWING |
| Recommendations card | `analytics_updating` | `strategy_analytics` select adds `cumulative_return, computed_at, data_quality_flags` | Yes | FLOWING |
| Composer book rows | `analytics_updating` | `getMyAllocationDashboard` embed adds `cumulative_return, computed_at`, destructured away before the payload | Yes | FLOWING |
| Owner trust tier | `ownerTrustTier` | `strategy_verifications` through RLS | Yes | FLOWING |

### Behavioral Spot-Checks and Test Runs

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Type check | `npx tsc --noEmit -p .` | exit 0, no output | PASS |
| The phase's 31 changed test files | `npx vitest run --testTimeout=30000 <the 31 files>` | 31 files passed, 1900 tests passed | PASS |
| Wider regression (src/__tests__, src/lib/factsheet, api/og, api/factsheet, api/strategies, src/app/factsheet) | `npx vitest run --testTimeout=30000 <dirs>` | 417 files passed, 1 failed, 18 skipped; 9880 tests passed, 2 failed, 273 skipped | PASS (known failures only) |
| Pre-fix RED check | the same 31 test files against `4002cf06e` source | 26 files failed (172 tests), 5 passed | RED as expected |

The two failures in the wider run are `compute.conventions.test.ts` fixture B (zero-return days) and fixture C (interior calendar gaps), under "byte-identical to the pre-change compute() (D-36, W1, FROZEN)". They are the known Node 25 float-noise failures, pre-existing at `4002cf06e`, and the phase does not touch `compute.ts`. The other censuses (`degrade-warning-scan`, `copy-census`, `figure-gate-census`, `complete-status-scan`, `critical-regressions`, `check-planning-hygiene`) were in that wider run and pass. The 18 skipped files are skips the suite already carries (the changed files ran with no skips).

### Probe Execution

SKIPPED: the phase declares no `probe-*.sh` probes.

### Anti-Patterns Found

None. No `TBD`, `FIXME` or `XXX` on any line the phase added to non-test source. No stub or hardcoded-empty data on the new code paths.

### Recorded, not gaps (LOW and INFO, none MEDIUM+)

Confirmed against code and against `237-REVIEW.md` (verdict clean after round 2; WR-01, WR-02 and WR-03 and SFH-M2 fixed in `c32bca3a5`, `a18f3602b`, `033cb8a71` and `b9b0f25fc`, re-reviewed at `3fc439e45`):

- The rolling chart's Export CSV still carries the withheld last rolling value (`TimeSeriesChart.tsx` export; plan 09 records it). The hover card and legend chip are dashed; the CSV is not. This is the residue the brief says plan 09 records.
- The heatmap month cell holding the break still prints (IN-07). Outside the founder's literal Q2 scope; the founder can extend the ruling.
- `headline_since` reaches OG, returns and recommendations through the live-blob SQL alias (IN-02), and `generateMetadata`'s `?u=` key reads the raw unit (IN-05). Both are narrow prestamp-window effects on true stored figures.
- PDF routes decide the hold and cache header before the render, so a re-run that starts in that few-second window prints the Updating line under the terminal ETag (IN-03).
- A held public build is labelled `conventions_read_failed` (IN-06); `analyticsHold` has no executable parity test with the resolve stage (IN-01); unfurlers' own caches can outlive the 60 s card (IN-08).
- The returns API's "computing" label for a D-04-withheld terminal row has no time bound, matching the factsheet's own queued state (accepted at round 2).
- D-52 (`readFactsheetBenchmark` failures stay cached) is out of scope per the brief and CONTEXT.

### Ship-time bookkeeping (not phase gaps)

The five TODOS entries this phase closes (`164.6.6.3.3-WITHHELD-RESIDUE`, `[190-RERUN-SURFACES-NOT-HOLDING]`, `164.6.6.2.1-OWNER-TRUST-TIER-UNPUBLISHED`, `170.3-OG-NOTFOUND-CACHE`, `164.6.6.2.1-USDVIEW-READFAIL-CACHED`) are still present in `TODOS.md`. The repo rule is to delete them in the ship PR and name them in the CHANGELOG entry. REQUIREMENTS.md rows and the ROADMAP plan checkboxes still read Pending or unchecked, to be updated by `phase complete`. No `TODOS.md`, `CHANGELOG.md`, `VERSION` or `package.json` change exists on the branch yet, which is expected before ship.

### Human Verification Required

1. **Share card with the Updating line.** Render `/api/og/factsheet/<held id>` and inspect the 1200x630 image. Expected: last computed figures, the Updating sentence under the stat row, legible and unclipped, `Cache-Control: public, max-age=60, s-maxage=60`. Why human: pixel layout.
2. **Withheld factsheet panels.** Open a Withheld factsheet at full history and inside a zoom. Expected: the four panels carry their Withheld sentences, no whole-record figure survives in the EOY bar chart, heatmap YTD, Worst 10 bands or rolling hover, and the failed cause shows none of them. Why human: visual hierarchy across about ten renderings (UI hint: yes).

### Gaps Summary

No gaps. All five roadmap success criteria hold in code, are exercised by tests that pass at the verified source, and fail on pre-fix source. The status is `human_needed` solely because the share-card image layout and the Withheld panel visuals cannot be judged programmatically.

---

_Verified: 2026-11-24_
_Verifier: Claude (gsd-verifier)_


## Post-merge closure (2026-11-25)

Both visual items are closed. Status moves from human_needed to passed. The coordinator ran both in Chrome on 2026-11-25 against a local stack at `origin/main` `8507564ef` (v0.133.74.3), seeded with three strategies: one held (mid re-run over a stored success), one Withheld (chain-broken, headline withheld) and one failed. The stack is torn down. This is the coordinator's relayed reading, not a verifier re-run.

**Item 1, the share card for the held strategy: PASS.** The 1200x630 PNG from `/api/og/factsheet/<held id>` shows the last computed figures (Sharpe 0.42, CAGR +8.2%, Max DD -33.4%). "Updating with the latest data. These figures are from the last completed computation." sits directly under the stat row, legible and not clipped. Response header: `Cache-Control: public, max-age=60, s-maxage=60`.

**Item 2, the Withheld factsheet: PASS.**
- Full history: EOY Returns, Calmar by Year, Worst 10 Drawdowns and Style Drift each show the amber "Withheld: this panel covers earlier history…" sentence in place of their table. The EOY bar chart and the Worst 10 Drawdown Periods chart are withheld. The Monthly Returns YTD column is "–" in every year. Rolling Sharpe hover: Nov 24 2026 (the last index) shows "–"; Nov 22 shows +1.61.
- Inside a zoom (Feb 26 2025 – Nov 24 2026): Worst 10 Drawdowns shows its slice table. EOY, Calmar by Year and Style Drift stay withheld (panel notes EOY RETURNS, CALMAR BY YEAR and STYLE DRIFT), and the Worst 10 chart stays withheld.
- Failed cause: "The detailed factsheet for this strategy is not available yet…" with no panels and no notes.
- Spacing and voice match the Main Metrics Withheld note.

**Observed, not a failure: all four panels use the same sentence.** The expected outcome says "one panel-specific Withheld sentence". The contract it points to is one string: `237-UI-SPEC.md` defines a single FH237-PANEL-WITHHELD sentence ("Withheld: this panel covers earlier history, which is unreliable (it includes {R}), and the span after it has not been measured yet."), and `MetricsColumn.tsx` renders it from the one `headlineCoverageNote(…, "panel")` slot. So "panel-specific" means panel-level wording, as opposed to the headline sentence, not different wording for each panel. The identical text matches the spec. It is recorded here as observed.

_Closure recorded: 2026-11-25 (records PR; coordinator evidence)._
