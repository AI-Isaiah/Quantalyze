---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 13
subsystem: ui
tags: [tearsheet, print-view, factsheet, pdf, advanced-disclosure, peer-ranks, attestation-gate]
status: complete

requires:
  - phase: 196
    provides: "plan 05 buttonClassName, plan 07 links guard, plan 10 FactsheetView printView / AdvancedDisclosure / buildTearsheetHref"
provides:
  - "/factsheet/<id>/tearsheet as the factsheet's print view (FactsheetView printView on the published lane's payload)"
  - "PeerRanksSection: the HEAD rank block with its 194 gate, extracted (plan 16 mounts it in Advanced)"
  - "PrintButton as a secondary 'Print tearsheet' control"
  - "/api/factsheet/<id>/pdf opens Advanced server-side and answers 503 instead of a short report"
affects: [196-16, 196-21]

key-files:
  created:
    - src/components/strategy/PeerRanksSection.tsx
  modified:
    - "src/app/factsheet/[id]/tearsheet/page.tsx"
    - "src/app/factsheet/[id]/tearsheet/page.test.tsx"
    - "src/app/factsheet/[id]/tearsheet/page.rank-gate.test.tsx"
    - "src/app/factsheet/[id]/tearsheet/page.stale-analytics.test.tsx"
    - "src/app/factsheet/[id]/tearsheet/page.trade-fetch.test.tsx"
    - src/components/ui/PrintButton.tsx
    - src/__tests__/one-strategy-page-links.test.ts
    - src/__tests__/figure-parity-pages.test.tsx
    - src/lib/anon-strategies-projection.test.ts
    - src/lib/anon-strategies-live-probe.test.ts
    - "src/app/api/factsheet/[id]/pdf/route.ts"
    - "src/app/api/factsheet/[id]/pdf/route.test.ts"

key-decisions:
  - "The tearsheet keeps getFactsheetDetail (identity panel, disclosure tier, owner id for the AUM gate, category slug for the ranks); everything figure-shaped comes from fetchAndBuildPayload(id, withPublishedOnly) with the trust tier overlaid, exactly as the factsheet's published lane builds it"
  - "A strategy the builder cannot build (failed, computing, not visible) answers notFound(); the old 200 shell of dashes is gone"
  - "The two reads only the old page made (readReturnsUnit, readTradeFacts) were removed: the masthead states the returns unit and the trade-fetch facts from the payload (verified below)"
  - "Screen width: .tearsheet is max-width 72rem on screen (the factsheet's own two-column opening view cannot lay out inside 6.5in); print keeps Letter portrait, 1in margins, full width of the page box"

requirements-completed: [LEAN-02, LEAN-05]

actuals:
  tokens: 48000
  tasks: 3
  commits: 3
plan_head_before: afff3f94d16cbfcace00877d420877235e249268
plan_head_after: 6351c0cb1ed504eac4cc1e441adab73106280d56
---

# Phase 196 Plan 13: The tearsheet is the factsheet's print view Summary

The tearsheet now renders the factsheet's own opening view through `FactsheetView printView` on the same payload builder the published lane uses, keeps its attestation and AUM gates verbatim, keeps its peer ranks (extracted to `PeerRanksSection` with the 194 gate), its contact copy and its one Risk Disclosure, and the LP-report PDF route opens Advanced server-side and answers 503 rather than shipping a short report.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | a34c0e473 | page rebuilt on printView, `PeerRanksSection`, restyled `PrintButton`, links-guard allow-list entry removed, `page.test.tsx` rewritten (33 arms), two read-only census entries removed |
| 2 | 48ce0f5ca | rank-gate, stale-analytics, trade-fetch and figure-parity tests moved to the rebuilt page |
| 3 | 6351c0cb1 | PDF route opens Advanced, waits, 503 on a failed mount; 5 new arms (6 tests) |

## Tracer gate (auto mode)

`<verify>` re-run end to end after Task 1 and again after Task 3: `npx vitest run "src/app/factsheet/[id]/tearsheet" "src/app/api/factsheet" src/__tests__/figure-parity-pages.test.tsx src/__tests__/one-strategy-page-links.test.ts src/lib/anon-strategies-projection.test.ts src/components/strategy/PercentileRankBadge.test.tsx`: 10 files, 144 tests passed. Tracer verified, expansion proceeded.

## Per-arm test table

| File | Arm | Disposition | Reason |
|------|-----|-------------|--------|
| `page.test.tsx` | 6 disclosure arms (anonymous, attested, unattested, attestation error, createClient throws, getUser error) | kept | unchanged invariants, now through a `FactsheetView` recorder |
| `page.test.tsx` | T1-T9 returns-unit arms (chip, BTC labels, withheld note, unit read filters) | removed | the page no longer reads or prints a unit; the masthead and strip do, from `payload.returnsUnit` (their own tests: `FactsheetView.usd-terms.test.tsx`, `ReturnsUnitChip.test.tsx`) |
| `page.test.tsx` | AUM visibility arms (10) | retargeted | assert `showAum` and the payload's `aum`/`maxCapacity` after `withViewerAum`, same viewers, same roles outcomes, same `[tearsheet]` log lines |
| `page.test.tsx` | VaR/CVaR labels, method line, annualised-gate dashes, caption, span-read filter arms | removed | the figures and `VAR_METHOD_LINE` render in the opening view and Main metrics table; the gate is the payload's `figureRecord` (rank arms below, `figure-parity-pages`) |
| `page.test.tsx` | rounded-sign tone arms (monthly cell, Max DD hero) | removed | the page owns no cell or hero; tone is the strip's (`FactsheetView.kpistrip.test.tsx`) |
| `page.test.tsx` | Risk Disclosure arms (2) | kept | the five literal sentences once, one block, below the contact block |
| `page.test.tsx` | new: printView + published-only builder + tier overlay + unknown tier dropped + no own blocks | added | the construction |
| `page.test.tsx` | new: notFound for a missing strategy, no analytics, null payload | added | D-03 / T-196-35 |
| `page.test.tsx` | new: ranks placement and category, no bare heading, Generated line, contact block, section order, controls row (order, hrefs, classes, 44px, primary last), Print tearsheet calls `window.print` | added | the kept blocks and D-09 controls |
| `page.rank-gate.test.tsx` | 4 arms | kept (retargeted source) | record now `figureRecord()` on the payload; read-failure arm is `figureRecord: null`; no arm became an absence assertion |
| `page.stale-analytics.test.tsx` | T1 failed run leaks no figure | retargeted | page answers notFound through the REAL builder status gate; the opening view is never mounted |
| same | T5 computing run | retargeted | same |
| same | T6 complete control | retargeted | same seeded row with a payload from the builder mounts the opening view and does not 404 |
| same | T2 heatmap/risk block, T3 own freshness badge, T4 name+terms around dashes, T7 complete_with_warnings control | removed | no subject left: the page prints none of those; a non-terminal run now 404s (T4's behaviour is replaced, see Deviations); T7's decision is the builder's `isComputedAnalytics` |
| `page.trade-fetch.test.tsx` | 19 arms on the page's own `readTradeFacts` (published-only select, malformed stamp, non-string exchange, read failure to Sentry, unavailable line, sizing, DOM order, print visibility, reconstructed ranges) | removed | the read no longer exists; wording, size, order and verdicts are proven at the masthead (`FactsheetView.trade-fetch-line.test.tsx`, `FactsheetView.reconstructed-range.test.tsx`) |
| same | 3 new arms | added | facts reach `FactsheetView` unchanged; malformed range record arrives as `unavailable`; the page makes no service-role read of its own |
| `figure-parity-pages.test.tsx` | tearsheet each-value, SAME-text-as-table, D-05, interim withheld, CR-01 arms | retargeted | page run over the same fake admin client; assert `printView`, the payload's metrics to 1e-12, and the withheld/cleared record; new arm: print-view payload deep-equals the factsheet fetch path's `strategyMetrics` and `figureRecord`. The Phase 197 "strip a leading plus from the tearsheet side" note is gone with the page's own formatter |
| `one-strategy-page-links.test.ts` | allow-list | updated | entry removed and exact-set arm now `[origin.ts]` |
| `anon-strategies-projection.test.ts` | tearsheet exemption (`readTradeFacts`) | removed | the select is gone; a stale exemption fails its own count |
| `anon-strategies-live-probe.test.ts` | arm (m) `readReturnsUnit` replay | removed | the select is gone (this arm is skipped without the anon probe env, so it would have failed only in CI) |
| `route.test.ts` | 6 new D-08 tests (5 arms, one `it.each` of two) | added | below |

## Neuter records (each: backup in the scratchpad, edit, run, RED, restore with `cp -p`, `cmp` exit 0, GREEN)

1. **Attestation gate, `page.tsx`.** The plan's literal instruction (`effectiveManager` ignores `isAttested`) alone stays GREEN: `effectiveDisclosureTier` independently redacts, as it did at HEAD (two layers, by design). Neutering the tier alone also stays GREEN (the panel receives `manager = null`). Neutering BOTH (`effectiveDisclosureTier = disclosureTier`, `effectiveManager = manager`) is RED: 7 arms, including `anonymous viewer: institutional bio / LinkedIn / AUM range are NOT rendered`, `authenticated + UNATTESTED viewer: redacted`, `authenticated + attestation lookup errors`, `createClient throws`, `auth getUser() returns error`. Restored, `cmp` 0, 33 passed.
2. **Rank gate, `PeerRanksSection.tsx`.** `percentile = percentiles[metric]` (no withheld drop): RED, 2 arms: `a 20-observation record ... only the Max DD rank renders` and `a record that could not be read (figureRecord null)`. Restored, `cmp` 0, 4 passed.
3. **Null payload, `page.tsx`.** `notFound()` on a null payload replaced by a fall-through: RED, 3 arms: `T1 a failed run answers not-found`, `T5 a live computing run`, `a strategy the factsheet builder cannot build (null payload) calls notFound()`. Restored, `cmp` 0, 36 passed.
4. **printView, `page.tsx`.** `printView` removed from the `FactsheetView` call: RED, 3 distinct arms in 2 files (`FactsheetView is rendered once, in printView`, the parity construction arm and the 1e-12 arm). Restored, `cmp` 0, 70 passed.
5. **PDF mount check, `route.ts`.** `throw new AdvancedOpenError(err)` replaced by `void err`: RED, 2 arms (`waitForSelector rejects`, `waitForNetworkIdle rejects`: 503, no-store, one Sentry report, `page.pdf` never called). Restored, `cmp` 0, 51 passed.
6. **PDF open step, `route.ts`.** `el.open = true` commented out: RED, 1 arm (`opens Advanced after goto ...`; the page function is RUN against a stand-in `details` element, so setting `open` is observed, not merely the call). Restored, `cmp` 0, 51 passed.

## Verified home table (every HEAD tearsheet item has a named home)

Enumerated from `git show origin/main:"src/app/factsheet/[id]/tearsheet/page.tsx"` at the base. "Verified by" is a grep or test run on this branch; plan 16 pins the Advanced homes with its own test.

| HEAD tearsheet item | Home after this phase | On the tearsheet | Verified by |
|---------------------|-----------------------|------------------|-------------|
| CAGR, Sharpe, Sortino, Max DD (hero grid) | KPI strip | yes | `FactsheetView.tsx` `KpiStrip` items: `withUnit("CAGR", ...)`, `"Sharpe"`, `"Sortino"`, `"Max DD"` |
| Volatility, Calmar, Cumulative (detail grid) | KPI strip: Ann. Vol, Calmar, Cum. Return | yes | same `KpiStrip` items: `"Ann. Vol"`, `"Calmar"`, `withUnit("Cum. Return", ...)` |
| 6 Month, VaR 95%, CVaR 95% and the VaR method line | Main metrics table, Returns and Risk groups, `VAR_METHOD_LINE` under Risk | yes | `MetricsColumn.tsx` `part === "main"`: `Row label="6 Month"`, `"VaR 95%"`, `"CVaR 95%"`, `data-testid="var-method-line"` |
| Best Day, Worst Day | Advanced, Detailed metrics rail, "Best / Worst Period", Day row | no | `MetricsColumn.tsx` `bestWorstPanel` with `<BwRow scale="Day" ...>`, mounted in `part === "detailed"` |
| figure-gate note under the hero grid | KPI strip note | yes | `FactsheetView.tsx` `data-testid="strip-figure-gate-note"`; the rail's own note is not rendered in `part="main"` |
| Equity Curve sparkline | the equity figure (Cumulative Returns with drawdown beneath) | yes | `FactsheetBody` `[data-census-section="equity"]` with `PerformanceCharts variant="equity"` |
| Monthly Returns table | Advanced, Heatmaps | no | `FactsheetView.tsx` `{ id: "factsheet-heatmaps", title: "Heatmaps" }` mounting `MonthlyReturnsHeatmap` |
| Peer-relative ranks (five badges) | kept on the tearsheet; also inside Advanced, Detailed metrics rail (plan 16) | yes | `page.test.tsx` ranks arms, `page.rank-gate.test.tsx` (4 arms), `PeerRanksSection.tsx`. Advanced mount is plan 16's, not in this branch |
| Allocation Terms: AUM (gated) | masthead AUM chip under 194 D-22 | yes, same gate | `FactsheetView.tsx` `showAum && payload.aum != null && <CapacityChip aum=... unit={returnsUnit}>`; the 10 AUM arms in `page.test.tsx` |
| Allocation Terms: Leverage | masthead chip line | yes | `FactsheetView.tsx` `FactsheetHeader`: `chips.push(\`leverage ${leverage}\`)` from `payload.leverageRange` |
| Allocation Terms: Benchmark (declared) | no factsheet home at HEAD; plan 16 adds a Benchmark row to Terms in Advanced (declared value only; the HEAD fallback to "BTC" is not carried) | no | `grep -n "Benchmark" MandatePanels.tsx`: no Terms row yet at this base. Pending plan 16, as planned |
| "Live since" start date | Advanced, Terms, "Live since" | no | `MandatePanels.tsx` `<Term label="Live since">` |
| types and markets line | masthead chip line | yes | `FactsheetHeader`: `strategyTypes`, `subtypes`, `markets` chips |
| returns-unit chip, and "Return unit could not be confirmed" note | masthead `ReturnsUnitChip`; an undeterminable unit now fails the build, so the page 404s | yes | `FactsheetHeader` `<ReturnsUnitChip unit={returnsUnit}>`; `page.test.tsx` null-payload arm |
| freshness pill (and its STALE-01 gate) | masthead `FreshnessChip` + `SeriesRecencyLine`; a non-terminal run 404s | yes | `FactsheetHeader` `<FreshnessChip computedAt=... seriesDates=...>`; `page.stale-analytics.test.tsx` T1/T5 |
| trade-fetch line, gap lines, reconstructed ranges | masthead | yes | `FactsheetHeader` `TradeFetchLine`, `UnrecoveredGapLines`, `ReconstructedRangeLines`; `page.trade-fetch.test.tsx` (payload carries them) |
| "Generated" date | one line under the opening view (printView renders no footer stamp); factsheet footer stamp and Terms "Factsheet computed" | yes | `page.test.tsx` `the Generated line renders once, is printed ...`; `MandatePanels.tsx` `Term label="Factsheet computed"` |
| ManagerIdentityPanel | tearsheet only, attestation gate unchanged | yes | `page.test.tsx` disclosure arms; neuter record 1 |
| Contact box | tearsheet only, copy kept, restyled, link "Open the factsheet" | yes | `page.test.tsx` contact arm; `grep -a -c "Interested in" page.tsx` 1, `"Request an introduction through"` 1 |
| Risk Disclosure | tearsheet only, the page's one disclaimer | yes | `page.test.tsx` Risk Disclosure arms |
| "PLATFORM · Institutional Tear Sheet" eyebrow (not in the plan's table) | no home: a label, not a figure. The document `<title>` still reads "<name> institutional tear sheet" (`generateMetadata`) | no | `grep -n "institutional tear sheet" page.tsx`. Flagged for plan 21's ship list |

## Verification

- `npx vitest run "src/app/factsheet/[id]/tearsheet" "src/app/api/factsheet" src/app/api/cron/founder-lp-report`: green (74 tests across 3 files for the API and cron half; tearsheet dir 36 + 4 + 3 + parity).
- `npx vitest run src/__tests__ src/lib/anon-strategies-projection.test.ts src/lib/anon-strategies-live-probe.test.ts src/lib/freshness.single-classifier.test.ts "src/app/factsheet/[id]/tearsheet" src/components/strategy src/components/ui`: 277 files passed, 1 failed (`verify-plan-anchors.test.ts` "--pending exits 0", the known noise until every SUMMARY exists), 18 skipped. Run before Task 3 landed; Task 3 touches only the PDF route and its test, re-run green separately.
- `npx tsc --noEmit`: clean. `npm run lint`: 0 errors, 2 pre-existing warnings (`nativeUnitReason`, `isRankableAnalyticsRow`); admin-route manifest, route contract and planning-hygiene checks OK.
- Acceptance greps: `printView` in `page.tsx` 2 (HEAD 0); `investor_attestations` 4 (HEAD 4, text kept; the string appears in the gate and its comments); `Download as PDF` in `PrintButton.tsx` 0; `Strategy not found.` in `page.tsx` 0; `PeerRanksSection` in `page.tsx` 2 and `getPercentiles` 3; `Peer-relative ranks` in `PeerRanksSection.tsx` 1; `Interested in` 1, `Request an introduction through` 1; `factsheet-advanced` in `route.ts` 2; `searchParams` in `route.ts` 0 (HEAD 0: the mode reads no parameter).

## LazyMount and beforeprint notes (flagged assumptions)

Neither was measured: no local PDF render was possible here (the seeded lane and a Chromium render need the TEST database environment, and no PROD access was used). By construction: the PDF route opens Advanced explicitly, so the full report does not depend on `beforeprint` firing under `page.pdf()` (RESEARCH A2/A3); sections inside Advanced that default closed print in their default state, as they do today. `LazyMount` panels below the fold mount on an IntersectionObserver that the headless render does not scroll to, so Returns Signatures and other lazy panels may be absent from the PDF today and after this plan. That is pre-existing and unchanged here; whether the signatures section appears in a real render is unmeasured.

The new waits fit one budget: `waitForSelector` and `waitForNetworkIdle` each carry the plan's 10 s timeout on top of the existing 25 s navigation timeout, against the route's `maxDuration = 30`. A worst case beyond 30 s is cut by the platform, which still ships no PDF (fail loud, but with the platform's status rather than this route's 503).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - blocking] Two guard tests outside the plan's file list depended on reads this plan removes.** `src/lib/anon-strategies-projection.test.ts` pinned a tearsheet exemption with `hits: 1` for `readTradeFacts`; with the read gone its count is 0 and its own "exemption must match exactly" assertion fails. `src/lib/anon-strategies-live-probe.test.ts` arm (m) replays the tearsheet's `readReturnsUnit` select and asserts exactly one; skipped locally without the anon probe env, it would have failed in CI. Both edits are removals of the entries that no longer have a subject. Commit a34c0e473.

**2. [Rule 1 - plan instruction cannot be satisfied as written] Neuter instruction for the attestation gate.** Ignoring `isAttested` in `effectiveManager` alone does not turn the suite RED (the tier layer still redacts), as at HEAD. Neutered both layers together instead; recorded above. No product change.

**3. [Rule 2 - correctness] Screen layout.** The HEAD `.tearsheet` container was `width: 6.5in` with 0.75in padding. The factsheet's opening view uses `lg:grid-cols-[1fr_380px]`, which on a desktop screen inside 6.5in would leave about 50px for the chart column. Screen is now `width: 100%; max-width: 72rem; padding: 1rem`; the `@media print` rule is `max-width: none; padding: 0` inside the unchanged `@page { Letter portrait; margin: 1in }`, so paper output is the Letter content box. The outer element became `<main>` (the root layout has none; the factsheet page wraps `FactsheetView` in `<main>` too). The PDF wrapper (`tearsheet.pdf`) is unchanged and renders print media at an 816px viewport (stacked layout). Not visually verified (no browser run here).

### Behaviour changes worth the reader's eye

- **A failed, computing or otherwise unbuildable strategy now answers 404 on the tearsheet** (HEAD rendered a 200 page with the name, terms and dashes). This is the plan's "null payload or missing strategy answers notFound" and is strictly stronger for STALE-01; the PDF wrapper already 400'd the same strategies.
- **The tearsheet's own "trade fetch status unavailable" state (SFH-M2) and its Sentry reports from a read of its own are gone.** The print view now states exactly what the masthead states. If the builder's read fails the build fails and the page 404s; the masthead has no "unavailable" arm of its own.
- **Now unused in production (knip candidates, not deleted, out of this plan's file list):** `TradeFetchUnavailableLine` and the `fixed-10` size variant in `src/app/factsheet/[id]/trade-fetch-lines.tsx` (only a comment in `FactsheetView.reconstructed-range.test.tsx` names the former), and `readRecordSpan` in `src/lib/record-span-read.ts` (its tests remain). Plan 21 or a dead-code pass can retire them with the `196-KNIP-BASELINE.txt` reconciliation.

## Not measured

- No browser, no PDF render, no e2e run (the layout claim in deviation 3, the 320px control-row wrap and the Download PDF "renders once, primary, rightmost" backstops are by construction: `flex-wrap`, `buttonClassName` `min-h-[44px]`, asserted classes in jsdom).
- No PROD access was used or needed.

## Known Stubs

None. No TODO, placeholder or hardcoded-empty value was introduced.

## Threat Flags

None. No new endpoint or trust boundary: the PDF route's new step runs inside the existing server-driven render, reads no input, and the tearsheet's new read path is the published-only builder the factsheet already uses (T-196-31 to T-196-35, T-196-39 mitigated as planned).

## Self-Check: PASSED

Created and modified files exist; commits a34c0e473, 48ce0f5ca and 6351c0cb1 are ancestors of HEAD; `git rev-list --count afff3f94d..HEAD` was 3 before this SUMMARY commit.
