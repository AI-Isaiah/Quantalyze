---
phase: 169-pagetruth
verified: 2026-09-29T22:40:00Z
status: passed
score: 13/13 must-haves verified
verified_at_sha: efaaf92afb38a4438b0c9f32670a36ef6ce36ea9
# re-verified 2026-09-29: the one gap (release entry) closed by 1db0b5d3c; first verdict gaps_found at 48ee02a13972619c0b2b1a548ecede908cadebf2
drift_subjects:
  - src/lib/factsheet/composite-read-path.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/basis-metrics.ts
  - src/lib/factsheet/compute.ts
  - src/lib/factsheet/record-length.ts
  - src/lib/factsheet/types.ts
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/factsheet/[id]/v2/FactsheetView.tsx
  - src/app/factsheet/[id]/v2/MetricsColumn.tsx
  - src/app/factsheet/[id]/v2/MandatePanels.tsx
  - src/app/factsheet/[id]/v2/basis-context.tsx
  - src/app/(dashboard)/discovery/[slug]/[strategyId]/page.tsx
  - src/app/(dashboard)/allocations/components/OpenPositionsTable.tsx
  - src/app/(dashboard)/allocations/components/HoldingsTable.tsx
  - src/app/(dashboard)/allocations/components/HoldingDetail.tsx
  - src/app/(dashboard)/allocations/lib/live-holdings-summary.ts
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
  - src/components/portfolio/RiskAttribution.tsx
  - src/components/exchanges/AllocatorExchangeManager.tsx
  - src/lib/dollar-validation.ts
  - src/lib/freshness.ts
  - src/lib/portfolio-analytics-adapter.ts
  - src/lib/portfolio-insights.ts
  - src/lib/types.ts
  - DESIGN.md
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "Release (169-06 Task 2, CLAUDE.md CHANGELOG discipline): ONE CHANGELOG entry for the phase, every commit enumerated, grouped by theme, each mapped to a bullet"
    status: failed
    reason: "The 0.112.0.0 entry was written at release commit 70ddb7d01 and never regenerated. The 52 non-merge commits after it (review round 1 topics T1 to T5, round 2 topic T6, and the late fix 48ee02a13) carry user-facing and data-integrity behaviour that no bullet names, and one bullet is now false."
    artifacts:
      - path: "CHANGELOG.md"
        issue: "Line 24 says the discovery detail page 'renders the placeholder for that one request' on a composite read outage. Since 2f1daac40 and e3c2fb190 it renders the read-failure sentence and captures to Sentry, on both arms."
      - path: "CHANGELOG.md"
        issue: "Lines 3-38 (the 0.112.0.0 entry) name none of: the chain-break headline caveat (fe0d0e0e3, 39c072c89, e59cc0548), the single-key arithmetic curve and withheld leverage what-if (0516e4428, 6f7e1875f, e3c2fb190), the series-calendar coverage rule that amends D-11 twice (a592a3f14, 9b813427b), the csv_daily_returns keyset read past 1000 rows (50c823f63), MTM/smoothed read outages as read_error (ccb1e5384), whole-day freshness bucketing on the chip and the discovery badge (a2bbb3edc), the hedge share and missing-weight assessment (67be099dd, 5ece86168), the money-module sign/NaN class and the open-positions total (e041950e8, 5992b1d46, 10c5001b5), the key-trust note wording (52367ba40), the backtest flag on the cash record (508b56e31), the empty-blend row omission (7e1ba0bc7)."
    missing:
      - "Regenerate the unified [0.112.0.0] entry over the whole branch (origin/main..HEAD), using the commit-checklist mechanism: enumerate every commit, group by theme, cross-check every commit maps to a bullet"
      - "Correct the line-24 discovery-page sentence to the read-failure line plus the Sentry capture"
      - "No new version bump is needed: 0.112.0.0 is not on origin/main (origin/main is 0.111.1.0); VERSION and package.json are already byte-equal at 0.112.0.0"
deferred:
  - truth: "ROADMAP 'Routed in, 2026-09-25': the discovery detail page's second assembly of the factsheet builder is folded onto the one shared path"
    addressed_in: "Phase 169.1"
    evidence: "Phase 169.1 goal: 'The discovery detail page builds through the one shared path.' Plan line: '169.1-01-PLAN.md — discovery detail page builds through the one shared path (SC3, SC4, D-23) (was 169-13)'"
human_verification:
  - test: "169-06 Task 3: after the phase PR deploys, re-check every changed page in the logged-in browser against the deployed SHA (SHA-bound CI run count non-zero), at 390px and at desktop 200% zoom: a factsheet (headline CAGR/Sharpe, 3Y/5Y/6M/1Y row gating, freshness chip date line and its Computed line, the chain-break caveat on a chain-broken row), the discovery list and detail, /recommendations, /my-strategies, /allocations Open Positions, Holdings and ?tab=scenario, /portfolios/[id] risk panel"
    expected: "One strategy's CAGR and Sharpe read the same on discovery list, discovery detail, /recommendations, /my-strategies and its factsheet; a record shorter than six months shows no 6 Month / 1 Year / 3 Year / 5 Year row in either panel (factsheet and scenario tab); sub-dollar prices keep precision and no signed or red zero appears; the risk panel shows single-scaled unsigned shares or no data (an empty panel is recorded, not counter-evidence, D-53); the deployed page keys on factsheet-v2-payload-v8"
    why_human: "Post-deploy, logged-in, visual and cross-page reading; the plan's own checkpoint (autonomous: false)"
  - test: "169-06 Task 1 D-22: re-run 167.2.1's SC1 live reproduction on the private local lane after the orchestrator's last merge of origin/main (ab12aff26)"
    expected: "7 passed, 0 skipped, including REPRO-SINGLE-ONE-POINT and CONTROL-BUILDABLE"
    why_human: "169-06 has no SUMMARY; the only record of the live-lane run is CHANGELOG prose, and it predates the last merge. The verifier re-ran the D-22 parity table (fetch-and-build-payload.test.ts, green) but not the live lane"
  - test: "Accept or revise the rules the fixers marked 'requires human verification': H-1 caveat copy and its presence gate (headlineCoversFrom must be present, cash basis only, Calmar named); H-2 a single-key 'simple' config draws the arithmetic curve; M-2 the leverage what-if withheld on a returns-convention override or chain-broken row; WR-04 chip and discovery badge bucket the series age on whole days; WR-R2-01 the weekday calendar is read off the series (MT5 weekday strategies with a weekend bar lose the tolerance; population unmeasured)"
    expected: "Each rule is the product decision the founder wants; tests pin the chosen rule, not its rightness"
    why_human: "Each is a judgment on a public number or copy; a test cannot prove the rule is the right one"
uat_2026_10_03:
  run: "Production UAT pass, 2026-10-03. Vercel production 7276aa9a at browser time (VERSION 0.123.0.0); analytics /health 32af2bddae1b = Vercel production 6833324580 at the non-browser pass; CI 37155111609 + Contracts 37155111659 green on it. Browser: the founder's logged-in session on the production Vercel host. Viewports emulated: 606px window + body zoom (1.894 ≈ 320px, 1.554 ≈ 390px); '200%' = 1440px + zoom 2; media queries saw 606px (< 640px breakpoint, mobile layout applied)."
  verdict: "Closed: status set to passed on 2026-10-03. Every human_verification item below carries a result (PASS / DECIDED / NO-SAMPLE-residual / ROUTED) bound to the 2026-10-03 UAT evidence. FAIL readings are ROUTED to their fix phase, not waived."
  no_sample_policy: "Founder decision (AskUserQuestion, 2026-10-03), NO-SAMPLE policy: \"Close, record as residual (Rec.)\". A NO-SAMPLE check is recorded as 'no PROD sample on 2026-10-03, covered by tests'; a live-event check becomes a watch item owned by the phase that would see it."
  routing_policy: "Founder decision (AskUserQuestion, 2026-10-03), defects: \"One fix phase, after 164.6.6 (Rec.)\"."
  items:
    - item: 1
      result: "ROUTED"
      evidence: "169 #1: FAIL: Quantum Drift composite contradicts itself (headline +0.0% / Sharpe 8.10 vs YTD +2283266.93%). AI-FX-35 is consistent across pages (CAGR +742.0%, Sharpe 2.62); Momentum Sphinx discovery +56.28% / 1.47 = factsheet."
      routed_to: "Phase 164.6.6.3 UATFIXES (booked on branch feat/164.6.6-mt5isolation; it reaches main with Phase 164.6.6's PR), defect 2"
    - item: 2
      result: "PASS"
      evidence: "169 #2: PR #904 head f64eb2d178 contains ab12aff26; CI 36635446824 + Contracts 36635446685; job 109635338092 'factsheet-buildable-live-db.test.ts (7 tests)', ledger OK 7/7."
    - item: 3
      result: "DECIDED"
      evidence: "169 #3: all five rules accepted."
      decision: "Founder (AskUserQuestion, 2026-10-03), 169 #3 five rules (H-1, H-2, M-2, WR-04, WR-R2-01): \"Accept all five (Rec.)\"."
---

# Phase 169: FACTSHEETTRUTH Verification Report

**Phase Goal:** A strategy's factsheet agrees with itself and with every other page that shows the same strategy: its headline CAGR and Sharpe read the stored metric, its return windows follow the calendar, and its dates and record length are stated one way. Each contradiction is traced to ONE source of truth and fixed there. (Judged on SC4, SC5, SC6, SC9, R1, R2, R3; SC3 moved to Phase 169.5, D-61.)
**Verified:** 2026-09-29, at `48ee02a13972619c0b2b1a548ecede908cadebf2` on `feat/169-pagetruth`
**Status:** gaps_found
**Re-verification:** No, initial verification

The product code achieves the goal. Every code-level truth holds at HEAD, two of them confirmed by a neuter run by the verifier. The one gap is the release artifact: the CHANGELOG entry predates both review rounds.

## Re-verification 2026-09-29 (orchestrator)

The one gap, the stale release entry, is closed. `1db0b5d3c` rewrote the `[0.112.0.0]` entry over all
112 commits on `origin/main..HEAD`, each mapped to a bullet by sha in `169-06-SUMMARY.md` (mechanical
diff against `git log` empty both ways). The discovery-page outage bullet now states the read-failure
sentence and the Sentry capture. The D-22 live reproduction the report listed as a human item was run
on the local lane by plan 06 Task 1 (7/7 SC1 cases, 408 lane tests, ledger match 7/7), which also
closes `169-SECURITY.md` T-169-06-A. No source file changed after `439e9e259`. Status moves to
`human_needed` for the items below (plan 06 Task 3 and the fixer-flagged rules); the first verdict is
kept as lineage in the frontmatter comment.

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | SC4 / D-10: the single-key factsheet headline (KpiStrip, MetricsColumn) equals the persisted `strategy_analytics` CAGR and Sharpe | ✓ VERIFIED | `persistedCashHeadline` (composite-read-path.ts:873) builds `cash_settlement` from the seven persisted scalars when the row is rankable; `buildFactsheetPayload` overlays it strictly (build-payload.ts:485, basis-metrics.ts:58). The resolve stage selects the seven scalars (fetch-and-build-payload.ts:320). Verifier neuter: forcing `persistedCashHeadline` to return `undefined` turned 8 cases of `build-payload.headline-source.test.ts` RED. File restored and `cmp`-checked |
| 2 | SC4 / D-25: one shared owner, `readSingleKeyBasisOpts`, supplies the headline to both the factsheet route and the discovery detail page | ✓ VERIFIED | Called at fetch-and-build-payload.ts:544 and at discovery page.tsx:247, both passing the analytics row and `returns_denominator_config`. The discovery projection carries the seven scalars (queries.ts:1065, :1341). The list surfaces read the same stored columns: recommendations RPC selects `sa.cagr, sa.sharpe` (20260409003234_recommendations_rpc.sql:173); discovery list and my-strategies read `CATEGORY_RANKING_ANALYTICS_COLUMNS` (queries.ts:336) |
| 3 | SC4: a non-rankable row does not overlay; a persisted null renders the em-dash | ✓ VERIFIED | `isRankableAnalyticsRow` gate (composite-read-path.ts:881); strict overlay maps non-finite to NaN (basis-metrics.ts:66). Pinned by the headline-source cases above |
| 4 | SC4 "or a surface that must differ says why" (SFH H-1): a chain-broken row's stored headline carries a caveat naming the covered span | ✓ VERIFIED | `headlineCoversFrom` read behind `shouldReadSingleKeyCashSeries` (composite-read-path.ts:806-825); `headlineCoverageCaveat` (MetricsColumn.tsx:40) rendered in Main Metrics, Cumulative Return Metrics (:484) and the KPI strip (FactsheetView.tsx:60 import). `FactsheetView.headline-coverage.test.tsx` green. Copy and gating are founder items (human verification) |
| 5 | D-25 / SFH H-2, M-2: the leverage what-if keeps persisted cash Sharpe/Sortino, and is withheld where the stored headline used a convention TypeScript cannot continue; a `simple` single-key row draws the arithmetic curve | ✓ VERIFIED | composite-read-path.ts:777-789 (`cumulativeMethod: "arithmetic"`, `returnsConventionOverride`); `basis-context.cash-leverage-repin.test.tsx` and the discovery `simple`-config case green |
| 6 | SC5 / D-16: the freshness chip's date line shows the series end when the series arm binds, and the compute date on its own "Computed" line | ✓ VERIFIED | `seriesIsBinding` and `resolveSeriesEnd` (FactsheetView.tsx:1100, :1233, :1265-1300); `FactsheetView.chip-honesty.test.tsx` and `freshness.two-surfaces.test.tsx` green |
| 7 | SC5 / D-12: record length stated one way, calendar years plus daily observations, never an observation count over 252 | ✓ VERIFIED | `formatRecordLength` (record-length.ts) used in MetricsColumn.tsx:112 and MandatePanels.tsx:40, :117; grep finds no `n / 252` or `n / periodsPerYear` length in `src/lib/factsheet` or `src/app/factsheet/[id]/v2`. `record-length.test.ts`, `MetricsColumn.record-length.test.tsx`, `MetricsColumn.periods-per-year.test.tsx` green |
| 8 | SC6 / D-11 (as amended twice, 2026-09-29): every window MTD..5Y is null when the record does not cover it; the weekday tolerance is read off the series, never the asset class | ✓ VERIFIED | One `windowReturn` rule for all seven windows (compute.ts:234-273); `weekdayVenue = spansSaturday && !tradesWeekends` (compute.ts:220-227), with no `periodsPerYear` term, matching the amended D-11 at 169-CONTEXT.md:179. Verifier neuter: making `windowReturn` always compound turned 26 cases RED across `compute.metrics.test.ts` and `MetricsColumn.window-rows.test.tsx`. File restored and `cmp`-checked |
| 9 | SC6 / D-17 / D-57: 3Y and 5Y rows, and the 6M and 1Y rows, are not rendered on a shorter record, in both panels and on the scenario mount | ✓ VERIFIED | MetricsColumn.tsx:168-169 (Returns), :496-500 (Cumulative Return Metrics), both conditional on `!= null`; `MetricsColumn.window-rows.test.tsx` (factsheet and scenario-mount pins) green |
| 10 | R3 / D-41 (amended): a failed composite `csv_daily_returns` read is `read_error`, the public cached callback throws, nothing is cached; the discovery page captures it and shows a read-failure line (SFH H-3) | ✓ VERIFIED | `CompositeSeriesReadError` (composite-read-path.ts:199, thrown at :260-274); resolve stage maps it (fetch-and-build-payload.ts:454, :263-289); cached callback throws `FactsheetReadError` on `read_error` (v2/page.tsx:142). Discovery page: `reportSeriesReadFailure` with `captureToSentry` at level error (page.tsx:53-78), both arms (:183, :257), `SERIES_READ_FAILED_SENTENCE` (:39, :363). `page.composite-read-error.test.tsx` and `page.pending-fallback.test.tsx` green |
| 11 | D-62: the factsheet cache key moves v7 -> v8 once, with both key pins moved | ✓ VERIFIED | `factsheet-v2-payload-v8` at v2/page.tsx:191; the only other files carrying it are `page.public-cache-key.test.tsx`, `page.cache-isolation.test.tsx` and the docblock in fetch-and-build-payload.ts. Both pin tests green. Round 1 payload additions ride the same undeployed v8 key (54afefaf0) |
| 12 | R1 / D-49: risk attribution shows the producer's percent once, unsigned; chart on the same unit as its domain; a negative (hedge) share gets no assessment | ✓ VERIFIED | `percentToFraction` (RiskAttribution.tsx:33-35) feeds both table (:115-116) and chart (:55-62, domain [0,1]); `assessable` requires `share >= 0` (:107). `RiskAttribution.test.tsx` green |
| 13 | R2 / D-50 and 169-06 release: sub-dollar prices keep precision, a zero-rounded P&L has no sign (one module); and ONE CHANGELOG entry maps every phase commit | ✗ FAILED (release half) | The money half is VERIFIED: `formatUsdPrice`, `formatUsdSigned`, `signAtCents` in dollar-validation.ts (:52-126), imported by OpenPositionsTable.tsx:50 and HoldingsTable.tsx:53, DESIGN.md:160 carries the Currency row; the four money tests are green. The release half FAILS: see Gaps |

**Score:** 12/13 truths verified (0 present, behavior-unverified)

Truth 13 bundles R2 with the release must-have only because the release is the one 169-06 artifact outside the browser check. R2 itself holds.

### Round-1 HIGHs and round-2 fixes, checked at HEAD

| Item | Claimed fix | At HEAD | Status |
|---|---|---|---|
| SFH H-1 (chain-broken headline, no caveat) | T1 data half 39c072c89, T5 render fe0d0e0e3, T6 labels e59cc0548, gate f38776d23 | composite-read-path.ts:806-825, MetricsColumn.tsx:40-52, three render sites | FIXED |
| SFH H-2 (single-key `simple` headline over a geometric chart) | T1 0516e4428, T5 e3c2fb190 (discovery passes config) | composite-read-path.ts:777-778; discovery page.tsx:254 passes `returns_denominator_config` | FIXED |
| SFH H-3 (discovery outage: no alert, "not ready" copy) | T3 2f1daac40, T5 e3c2fb190 | discovery page.tsx:39, :53-78, :183, :257, :363 | FIXED |
| SFH R2-1 (MTM view calls live record "backtest") | 508b56e31 | MandatePanels.tsx compares the live date with `payload.strategyMetrics.start`; `MetricsColumn.record-length.test.tsx` green | FIXED |
| WR-R2-01 (weekday tolerance keyed on asset class) | 9b813427b | compute.ts:220-227, no `periodsPerYear` in the decision | FIXED |
| WR-R2-02 (hedge share "Balanced") | 67be099dd | RiskAttribution.tsx:107 | FIXED |
| IN-R2-02 (caveat subject labels) | e59cc0548 | `headlineCoverageCaveat(..., subject)` per surface | FIXED |
| IN-R2-05 (key-trust "$0.00" for unknown P&L) | 52367ba40 | `live-holdings-summary.test.ts` and `ScenarioComposer.test.tsx` green (471 with freshness) | FIXED |
| WR-R2-03 (H-1 read bypassed the MED-1 gate) | f38776d23 | `shouldReadSingleKeyCashSeries` (composite-read-path.ts:1061) at the read site (:809) | FIXED |
| IN-R2-01 (stale comments) | da13f532d | comments only | FIXED |
| Late fix 48ee02a13 (phase-148 witness) | one comment line in types.ts:566 | `phase-148-owner-lane-cache-isolation.test.ts` 19/19 green; the raw file contains `fetchAndBuildPayload` and the stripped file does not | FIXED |

Round-2 LOW and Info items not in T6's scope (R2-2, R2-3, R2-4, R2-6, IN-R2-03, IN-R2-04) stay in the review files, per the review policy.

### Deferred Items

| # | Item | Addressed In | Evidence |
|---|---|---|---|
| 1 | Discovery detail page's second builder assembly folded onto the shared path | Phase 169.1 | Goal: "The discovery detail page builds through the one shared path." Plan 169.1-01 DISCOVERYONEPATH (was 169-13) |

### Required Artifacts

| Artifact | Status | Details |
|---|---|---|
| `src/lib/factsheet/composite-read-path.ts` | ✓ VERIFIED | `isRankableAnalyticsRow`, `CompositeSeriesReadError`, `shouldReadSingleKeyCashSeries` present and wired |
| `src/lib/factsheet/fetch-and-build-payload.ts` | ✓ VERIFIED | seven-scalar select; `CompositeSeriesReadError` -> `read_error` |
| `src/lib/factsheet/build-payload.headline-source.test.ts` | ✓ VERIFIED | non-vacuous (verifier neuter, 8 red) |
| `src/app/factsheet/[id]/v2/basis-context.cash-leverage-repin.test.tsx` | ✓ VERIFIED | green |
| `src/lib/factsheet/compute.ts` / `types.ts` | ✓ VERIFIED | p3y / p5y; one coverage rule (verifier neuter, 26 red) |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | ✓ VERIFIED | chip date line bound to its subject |
| `src/lib/factsheet/record-length.ts` | ✓ VERIFIED | `formatRecordLength`, imported at every length site |
| `src/app/factsheet/[id]/v2/MetricsColumn.tsx` / `MetricsColumn.window-rows.test.tsx` | ✓ VERIFIED | row gates in both panels; scenario-mount pin |
| `src/app/factsheet/[id]/v2/page.composite-read-error.test.tsx` | ✓ VERIFIED | contains `csv_daily_returns`; green |
| `src/app/factsheet/[id]/v2/page.tsx` | ✓ VERIFIED | `factsheet-v2-payload-v8` |
| `src/components/portfolio/RiskAttribution.tsx` / test | ✓ VERIFIED | test contains `complete.json`; green |
| `src/lib/dollar-validation.ts`, `DESIGN.md` | ✓ VERIFIED | formatters plus Currency row |
| `CHANGELOG.md` (169-06) | ✗ STALE | entry predates 52 commits; line 24 false |
| `.planning/phases/169-pagetruth/169-06-SUMMARY.md` | not yet due | Task 3 is the post-deploy checkpoint; the orchestrator excluded it |

### Key Link Verification

| From | To | Via | Status |
|---|---|---|---|
| resolve stage and discovery single-key arm | `readSingleKeyBasisOpts(..., persisted row, config)` | direct call, both sites | WIRED |
| `buildFactsheetPayload` | `overlayBasisScalars(computedMetrics, metricsByBasis.cash_settlement)` | build-payload.ts:485 | WIRED |
| `compute()` windows | one coverage helper `windowReturn` | compute.ts:267-273 | WIRED |
| FreshnessChip date line | `resolveSeriesEnd` | `seriesIsBinding` | WIRED |
| CumulativeReturnsPanel 3Y/5Y and Returns 6M/1Y | `compute()` p3y/p5y/p6m/p1y | `m.pNN != null` gates | WIRED |
| length sites | `formatRecordLength` | import in MetricsColumn and MandatePanels | WIRED |
| `readCompositeFactsheet` | resolve stage `read_error` -> `FactsheetReadError` in the cached callback | fetch-and-build-payload.ts:454; v2/page.tsx:142 | WIRED |
| cache key | both pin tests | v8 literal | WIRED |
| adapter fixture (`complete.json`) | RiskAttribution cells | `adaptPortfolioAnalytics` in the test | WIRED |
| OpenPositionsTable / HoldingsTable | `@/lib/dollar-validation` | import | WIRED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Phase test set (21 files: headline source, composite read path, compute metrics, record length, leverage re-pin, chip honesty, headline coverage, window rows, record-length rows, periods-per-year, composite read error, both cache-key pins, fetch-and-build-payload incl. D-22 parity table, discovery pending fallback, RiskAttribution, dollar-validation, OpenPositions, Holdings, untrusted-key surfaces, build-payload snapshot) | `npx vitest run <21 files>` | 21 files, 417 passed | ✓ PASS |
| Fix-edited tests outside that set | `npx vitest run freshness.two-surfaces, ScenarioComposer, live-holdings-summary` | 3 files, 471 passed | ✓ PASS |
| Late-fix witness | `npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` | 19 passed | ✓ PASS |
| SC4 overlay non-vacuity | neuter `persistedCashHeadline` to return `undefined` | 8 cases RED; restored, `cmp` OK | ✓ PASS |
| SC6 coverage non-vacuity | neuter `windowReturn` to always compound | 26 cases RED; restored, `cmp` OK | ✓ PASS |

The full suite was not re-run. The orchestrator's run at the parent of HEAD (after the origin/main merge) is the full-suite record: tsc 0, lint 0, vitest 17523 passed and 2 failed (a load-timeout flake that passes alone, and the phase-148 witness that 48ee02a13 fixes, re-run green above).

### Probe Execution

Step 7c: no probe declared by any 169 plan. SKIPPED.

### Requirements Coverage

| Requirement | Source Plans | Status | Evidence |
|---|---|---|---|
| SC4 | 169-01, 169-07, 169-06 | ✓ SATISFIED (code); cross-page browser reading is a human item | truths 1-5, 10 |
| SC5 | 169-04, 169-05, 169-06 | ✓ SATISFIED | truths 6, 7 |
| SC6 (as widened 2026-09-27) | 169-04, 169-05, 169-06 | ✓ SATISFIED | truths 8, 9 |
| SC9 | all | ✓ SATISFIED for tests (fix reports record neuter RED -> restore; verifier reproduced two); post-deploy browser re-check is a human item |
| R1 | 169-09 | ✓ SATISFIED | truth 12 |
| R2 | 169-10 | ✓ SATISFIED | truth 13, money half |
| R3 | 169-07 | ✓ SATISFIED | truth 10 |

No orphaned requirement: SC3 moved to Phase 169.5 by D-61, and no remaining 169 plan claims it.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| (26 non-test source files changed since 792be2248) | n/a | TBD / FIXME / XXX, TODO / HACK / placeholder in added lines | none found | n/a |
| CHANGELOG.md | 24 | release prose contradicts shipped behaviour | ⚠️ Warning (part of the gap) | a reader of the release notes is told the discovery page shows the placeholder |
| src/lib/factsheet/types.ts | 566 | the restored comment says both arms are assembled by `fetchAndBuildPayload`; the discovery detail page still assembles its own (until 169.1-01) | ℹ️ Info | comment only; true for the factsheet route |

Info, not a gap: the D-41 amendment is recorded in 169-CONTEXT.md:1005 but has no dated note in ROADMAP.md, unlike the D-11 amendments. The ROADMAP text carries no contradicting sentence (it never said "placeholder"), so nothing there is false.

### Human Verification Required

#### 1. Post-deploy browser re-check (169-06 Task 3)

**Test:** After the PR deploys, bind to the deployed SHA with a non-zero SHA-bound CI run count. Then at 390px and at desktop 200% zoom, check: a factsheet (headline, row gating, chip lines, chain-break caveat on a chain-broken row), the discovery list and detail, /recommendations, /my-strategies, /allocations Open Positions, Holdings and ?tab=scenario, and /portfolios/[id].
**Expected:** CAGR and Sharpe identical across the five surfaces. No 6M/1Y/3Y/5Y rows on a record shorter than the period. Sub-dollar precision, no signed zero. Risk shares single-scaled or no data (D-53). The page keys on v8.
**Why human:** Post-deploy, logged-in and visual. This is the plan's own non-autonomous checkpoint.

#### 2. D-22 live-lane reproduction after the last merge

**Test:** Re-run 167.2.1's SC1 live reproduction on the private local lane at HEAD.
**Expected:** 7 passed, 0 skipped.
**Why human:** Its only record is CHANGELOG prose written before ab12aff26. The verifier re-ran the parity table (green) but cannot run the live lane.

#### 3. Rules the fixers flagged "requires human verification"

**Test:** Accept or revise these rules: the H-1 caveat copy and presence gate, the H-2 arithmetic single-key curve, the M-2 withheld what-if, WR-04 whole-day bucketing, and WR-R2-01's series-calendar rule. For WR-R2-01, the population of MT5 weekday strategies with a weekend bar is unmeasured.
**Expected:** Each is the intended product rule.
**Why human:** Tests pin the chosen rule. They cannot show that it is the right one.

### Gaps Summary

The factsheet code delivers the phase goal. The headline reads the stored scalars through one owner. Every return window follows one calendar rule, and rows outside the record are omitted. Record length has one formatter. Composite read outages are never cached. Risk shares and sub-dollar money render once and unsigned. All round-1 HIGHs and all seven round-2 items T6 claims are fixed at HEAD, and the late types.ts fix restores the phase-148 witness.

One gap blocks shipping as-is: the release entry. `chore(release): v0.112.0.0` (70ddb7d01) was written before review rounds 1 and 2, and the entry was never regenerated. Fifty-two later commits change user-facing numbers, copy and read behaviour without a bullet, and CHANGELOG.md:24 now misdescribes the discovery page. CLAUDE.md's CHANGELOG discipline treats an unrepresented commit as a defect, and 169-06's release truth requires every commit mapped. The fix is to regenerate the single [0.112.0.0] entry over origin/main..HEAD, in the same version, before the push. It does not touch product code.

---

_Verified: 2026-09-29_
_Verifier: Claude (gsd-verifier)_
