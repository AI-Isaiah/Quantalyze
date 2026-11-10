---
phase: 196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it
plan: 21
subsystem: phase-close
tags: [knip, census, todos, ship-notes, gates]
requires: ["196-01", "196-02", "196-14"]
provides:
  - "196-KNIP-BASELINE.txt: exactly two sections, ## pre-phase and ## end of phase"
  - "196-CENSUS.md: ## After with fixture counts, met/not-met per target, the pending production after-run and the gate line"
  - "TODOS.md: 196-V2-PANELS-REVIVAL-01 and eight further Phase 196 entries, two closures"
  - "the ship notes below (CHANGELOG must-carry list)"
affects: []
key-files:
  created: []
  modified:
    - .planning/phases/196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it/196-KNIP-BASELINE.txt
    - .planning/phases/196-onestrategypage-a-strategy-has-one-page-the-factsheet-and-it/196-CENSUS.md
    - TODOS.md
key-decisions:
  - "Four new knip entries, each already dispositioned in 196-14-SUMMARY.md, so no code was deleted here (this plan deletes nothing)"
  - "Every open item that needs a design or founder call is booked as a TODOS entry, none decided"
requirements-completed: [LEAN-02, LEAN-05, ROUTE-02, ROUTE-04]
status: complete
commits: 3
plan_head_before: f1e488f7cc77e14f7425b441d6876cef2e0f568f
plan_head_after: a519ca53769f21077c23b1592f04529bd9f99186
actuals:
  tokens: 21000
  tasks: 3
  commits: 3
---

# Phase 196 Plan 21: Phase close, the record half Summary

The phase's knip record has its end-of-phase reading with every new entry already dispositioned, the census has its After section (SC-5 met with Advanced closed, one target not met with it open, the production run pending deploy), the dropped panels and every open design call are booked in TODOS.md, two TODOS entries are closed, and tsc, lint, the test suite and the route contract are green on the final tree apart from the known Node 25 snapshot skew.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | 26ca0bba8 | `## end of phase` knip section in `196-KNIP-BASELINE.txt`; the commit lists only that file |
| 2 | 9e74234b7 | census `## After`; `TODOS.md`: `196-V2-PANELS-REVIVAL-01` and eight further entries, two closures, one re-measure note |
| 3 | a519ca537 | gate line under the census After section; one lint residual added to the orphans entry |

`commits: 3` is measured from the ledger (`rev-list --count f1e488f7c..HEAD`) before this SUMMARY's own commit.

Tracer gate: the Task 1 `<verify>` (knip) was re-run on the final tree. No `gate` attribute on the task, `HUMAN_VERIFY_MODE` default, automated-only verify: no checkpoint. Its fail condition (an entry absent from both pre-phase and plan 14's new-entry table) did not fire.

## Task 1: knip

`npx knip --include files,exports --reporter compact` on the final tree exits 1, as at the baseline (findings present).

| Section | Unused files | Unused-export lines |
|---------|--------------|---------------------|
| `## pre-phase` (plan 02, base `49566dbc0`) | 45 | 70 |
| `## end of phase` (this plan, HEAD `f1e488f7c`) | 46 | 73 |

Both sections drop the same 20 `.planning/` unused-file lines (archived-milestone scripts this phase cannot touch). A `comm` of the two sorted sections: every pre-phase entry is present and unchanged, and exactly four entries are new, each with a disposition in `196-14-SUMMARY.md`'s new-entry table:

| New entry | Plan 14 disposition |
|-----------|---------------------|
| `scripts/factsheet-census/run.ts` (unused file) | KEPT, plan 01's manual census driver, plan 21 owns its wiring (it is not wired to CI by design) |
| `src/app/factsheet/[id]/trade-fetch-lines.tsx: TradeFetchUnavailableLine` | KEPT, residual R2 |
| `src/components/charts/chart-tokens.ts: 13 CHART_* exports` | KEPT, residual R3 |
| `src/lib/min-history.ts: CORRELATION_90D_MIN_DAYS, BENCHMARK_ROLLING_WINDOW_DAYS, WORST_DRAWDOWNS_MIN_DAYS` | KEPT, residual R4 |

No unexplained entry, so nothing stopped the plan. Acceptance greps: `^## end of phase` 1, `^## pre-phase` 1, `^## ` 2 (no intermediate section). The commit lists only the knip file.

## Task 2: census After and TODOS

**Census After** (jsdom, final tree, 27 arms of `FactsheetBody.census.test.tsx` pass). Closed (the opening view), all three fixtures: 4 sections, 2 charts, 0 repeated metrics, at most 1 small-sample warning (A 0, B 1, C 1), 1 hint, 0 "— on request" rows: **every target met**. Open (Advanced open): hints, warnings and on-request rows met; **repeated metrics not met**: A 3 (sharpe, sortino, volatility), B 2 and C 2 (sharpe, sortino), all from the two Rolling Metrics tables (plan 09 open item 1, plan 11 open item 1; booked below). The open section counts (15, 14, 12) are one lower than the 16, 15, 13 plan 11 recorded; the cause was not traced, and the test does not pin the open section count. The production after-run is **pending until the phase deploys** (command shape and env var names recorded in the census, ids as placeholders). The census file carries no UUID-shaped string (grep returns 0).

**TODOS.md bookings** (all under `## 🟡 FIX MID-TERM`, newest first, house shape; no ids, amounts or home paths):

| Id | What |
|----|------|
| `196-V2-PANELS-REVIVAL-01` | D-06: what Trades & positions and Exposure & benchmark greeks showed, owner unrouted, trigger, what closing means |
| `196-ROLLING-REPEATS-01` | SC-5 repeated metrics with Advanced open (plans 09, 11) |
| `196-STYLE-DRIFT-CENSUS-BLIND-01` | the counter cannot read the Style Drift table, plus two small-sample notes outside the note family (plan 09) |
| `196-HINT-COPY-PARITY-01` | the one hint dropped "0 resets" and the plain-wheel statement (plan 11) |
| `196-FACTSHEET-DETAIL-CALLS-01` | four small calls: BASIS eyebrow twice (plan 10), `maxDdSpan` wording (09), native-unit Signatures (11), no "Strategy" column label (09) |
| `196-BENCHMARK-ROW-FULL-LAYOUT-01` | the Terms Benchmark row also shows on allocator and composer mounts (plan 16) |
| `196-TEARSHEET-NONTERMINAL-404-01` | the tearsheet 404s a non-terminal strategy where HEAD rendered a 200 page of dashes (plan 13) |
| `196-CANONICAL-LINK-01` | no canonical link, so `?share=1` and `?from=` variants of an indexable page can be indexed (plan 19) |
| `196-ORPHANS-01` | plan 14's R2 to R5, `readRecordSpan`, the census `run.ts` knip entry, two unused test fixtures (new lint warnings), stale mentions in generated maps and comments |

**Closures** (original entries kept as lineage, in each section's own style): `198-ADD-DEEPLINK-UNMARKED-OWN` closed by plan 05 (`a0f56dabe`); `194.1-CENSUS-196-STALE-EXCLUSIONS` closed by plans 18 and 14 (`29aa5a581`, `1921b9eea`, `442b734e0`).

**Re-measure, not a closure:** `195-EXCHANGE-MONITORING-CLAIM` names Phase 196 as owner and no plan took it. Of its three surfaces the browse detail page and its meta description are gone (plan 17); the tearsheet Risk Disclosure and the `custody` variant of `Disclaimer.tsx` still claim read-only exchange monitoring for every tier. A dated sub-bullet records this. It needs routing; I did not fix product code here.

## Task 3: gates on the final tree

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | exit 0, 0 `error TS` |
| `npm run lint` | exit 0, 0 errors, **4 warnings**: the 2 pre-existing (`nativeUnitReason` in `MetricsColumn.tsx`, `isRankableAnalyticsRow` in `composite-read-path.ts`) and 2 new (`WARNED_ROW`, `COMPUTING_ROW` in `src/lib/queries.stale-analytics-detail.test.ts`, left unused when plan 14 removed their test groups; booked in `196-ORPHANS-01`). Trailing checks OK: admin-route manifest 20 routes, route contract 48 routes, planning hygiene (rules 1, 6, 7), canonical domain |
| `npm test` | exit 1: 1178 files passed, 1 failed, 20 skipped; 24,504 tests passed, 2 failed, 306 skipped. The 2 failures are `src/lib/factsheet/compute.conventions.test.ts` "fixture B" and "fixture C" (the known last-digit snapshot skew, local Node 25 against CI Node 22). Nothing else failed, including `verify-plan-anchors.test.ts` |
| `npm run check:route-contract` | exit 0, `OK — 48 page routes, all declared in the manifest.` |

`git diff --name-only f1e488f7c..HEAD -- CHANGELOG.md VERSION package.json` prints nothing; no CHANGELOG, VERSION or package.json change was made.

`verify-plan-anchors --pending`: exit 0 once this SUMMARY exists (see "Self-check and anchors" below).

## Ship notes

For the ship step's CHANGELOG entry (written at ship time in the version-bump commit, per CLAUDE.md "CHANGELOG discipline"; this plan wrote none). Themes: new capability, behaviour change, removal, infrastructure. Every item below must map to a bullet.

### Changed: one strategy, one page

- The strategy's one page is `/factsheet/<id>`. `/strategy/<id>`, `/strategy/<id>/v2`, `/browse/<slug>/<id>` and `/discovery/<slug>/<id>` are config-level 308s to it (the browse and discovery ones carry `from` and `cat`; the request's own query passes through). Every in-app strategy link goes through `buildFactsheetHref` with an origin, so the factsheet's back link reads "Back to Discovery", "Back to My allocation" and so on; `one-strategy-page-links.test.ts` fails CI if a retired-route href returns.
- The factsheet opens as the KPI strip, the control bar and one equity figure (curve with drawdown) beside one Main metrics table, with every other section behind one collapsed "Advanced" disclosure that mounts on first open and remembers the reader. One visible chart hint, at most one small-sample warning, no empty section, each KPI cell prints the active comparator's value beneath it. SC-5 census: see `196-CENSUS.md` `## After`.
- Viewer chrome by session: a signed-in viewer bar (back link, Request intro or Add to my allocation as the role allows, the owner's Edit strategy, the viewer's note card); a visitor header and sign-up line for a reader with no session. `/browse` is session-aware: a signed-in reader sees one "Go to Discovery" link instead of Log in and Sign up.
- Request intro copy now reads in sentence case and cannot send two requests from a click burst. The shared factsheet (`/factsheet-share/<token>`) carries the slim visitor header.
- `/allocations?add=<id>` for an own strategy not marked own capital lands on the picker row's reason instead of the amount step (closes TODOS `198-ADD-DEEPLINK-UNMARKED-OWN`).
- Every My allocation strategy link (holdings, watchlist, scenario composer, optimizer) opens the factsheet with `?from=allocations`.
- The factsheet page renders its own single `<main>` landmark (`v2/layout.tsx` deleted).

### Founder decisions to carry (D-06 to D-09)

- **D-06 panels dropped.** "Trades & positions" (trade, position, risk-reward and volume figures, Trade mix) and "Exposure & benchmark greeks" (net and gross exposure, turnover, benchmark greeks table, 90-day rolling correlation with BTC) rendered only in the retired `/strategy/<id>/v2` shell and are gone. Their revival is booked as `196-V2-PANELS-REVIVAL-01`.
- **D-09.** A "Print view" link to `/factsheet/<id>/tearsheet` replaces the discovery page's "Tear Sheet" link, and "Book Intro Call" is not carried to the factsheet (its component `BookIntroCall` and the `NEXT_PUBLIC_SCHEDULING_URL` entry in `.env.example` are removed; the env var, if set in a deployment, is now unread).
- **D-07 search indexing.** The published factsheet is indexable (`robots` omitted only when the published-only probe finds the strategy; an erroring probe fails closed to noindex). The owner, unpublished and share-token lanes stay `noindex`. No canonical link exists yet (`196-CANONICAL-LINK-01`).
- **D-08 LP report.** `/api/factsheet/<id>/pdf` opens Advanced server-side (not reachable from a viewer-controlled parameter) and answers 503 rather than ship a short report.

### Where each HEAD tearsheet item lives (nothing from the tearsheet is dropped)

The tearsheet is now the factsheet's print view on the published-only payload builder (`/factsheet/<id>/tearsheet`, Print view). Per the 196-13 home table, as completed by plan 16:

- **Percentile ranks** (five badges): kept on the tearsheet, and added inside Advanced at the end of the Detailed metrics rail (published lane, read per request, never cached).
- **Hero and detail figures** (CAGR, Sharpe, Sortino, Max DD, Volatility, Calmar, Cumulative): the KPI strip, in the opening view. 6 Month, VaR 95%, CVaR 95% and the VaR method line: the Main metrics table, in the opening view. Best Day and Worst Day: Advanced, Detailed metrics, Best / Worst Period. Monthly Returns table: Advanced, Heatmaps. Equity Curve sparkline: the equity figure in the opening view.
- **Contact block**: kept on the tearsheet, copy kept, link "Open the factsheet". Also kept on the tearsheet: the manager identity panel (attestation gate unchanged), the one Risk Disclosure, the freshness and trade-fetch lines, the "Generated" date.
- **Declared benchmark**: a Benchmark row in Terms inside Advanced (declared value only; the HEAD fallback to "BTC" is not carried). It also shows on the full-layout mounts (`196-BENCHMARK-ROW-FULL-LAYOUT-01`).
- AUM stays under the 194 D-22 gate, Leverage and the types and markets line move to the masthead chip line, "Live since" to Terms in Advanced.
- The "PLATFORM · Institutional Tear Sheet" eyebrow label has no home by decision (a label, not a figure); the document `<title>` still reads "<name> institutional tear sheet".
- Behaviour change worth a line: a failed, computing or otherwise unbuildable strategy now answers 404 on the tearsheet (HEAD rendered a 200 page of dashes), booked as `196-TEARSHEET-NONTERMINAL-404-01`.

### Removed (shell-only components and libraries, from plan 14, and the route trees)

- Route trees: `src/app/strategy/` (both trees, 13 files), `/discovery/[slug]/[strategyId]` (8 files), `/browse/[slug]/[strategyId]` (4 files), `src/app/factsheet/[id]/v2/layout.tsx`.
- `src/components/strategy-v2/`: `StrategyV2Shell`, `TradeAndPositionPanel`, `TradeMixSubPanel`, `ExposureAndGreeksPanel`, `DrawdownPanel`, `HeadlineMetricsPanel`, `OverviewPanel`, `ReturnsDistributionPanel`, `RollingMetricsPanel`, `BenchmarkGreeksTable`, `MetricCell`, `format.ts`, `panel7-series` (kept: `SegmentedControl`, `PartialDataBanner`).
- Ten charts: `CorrelationWithBenchmark`, `DailyHeatmap`, `MonthlyHeatmap`, `YearlyReturns`, `WorstDrawdowns`, `EquityCurve`, `DrawdownChart` (the allocations widget of the same name is a different, live file), `NetGrossExposureChart`, `TurnoverChart`, `RollingAlphaBetaChart`.
- Libraries and hooks: `useLazyPanelMetrics`, `queries-client`, `benchmark-why`, `drawdown-math`, `factsheet/v2-joint`, `composite-joint`, `BookIntroCall`. Query readers with no non-test importer: `getStrategyDetailV2`, `fetchStrategyLazyMetrics`, `getStrategyDetail`, `getPublicStrategyDetail` (the manager-identity redaction now pinned on `getFactsheetDetail`). Four `strategy-v2-*` e2e specs and two `tests/visual/strategy-v2-*` gates.
- Left in place and booked: `196-ORPHANS-01`.

### svg golden re-bake

Plan 10 recorded it: the two `full-page-*` goldens (desktop and 2560) capture the whole page and now show the new layout, so they mismatch by construction; plan 09's document variant also drops the Point column of the Bootstrap panel, so the `bootstrap-ci-*` goldens may mismatch. Per-panel crops should be unaffected. Both are for the CI `workflow_dispatch` bake (`bake_svg_goldens`); the ship step decides whether to bake on the phase branch. Plan 16 adds that a published strategy with ranks changes the printed report (Advanced is closed by default, so the opening view is unchanged).

### OQ-3 session read on the token lane (for the phase security review)

The token page (`/factsheet-share/<token>`) now constructs the request-scoped Supabase client and calls `auth.getUser()` once, after the constant-time HMAC match, to choose the visitor header's chrome (Sign up shown without a session, never with one). The answer is one boolean; it reads no profile, role or owner state, is never passed to the payload builder or `withViewerAum`, and every recipient gets the same payload, AUM rule and owner chrome. The rate-limit card and 410 redirects run before the read. `Referrer-Policy: no-referrer` for the path is pinned by a test (T-196-27, T-196-28).

### e2e specs CI must run green (none were run in any worktree: the seeded lane needs CI)

`route-redirects` (four Phase 196 D-03 arms), the retargeted badge specs `mt5-badge` and `sfox-badge` (plus `composite-onboarding` and `sync-analytics-flow`), `axe-app-wide` (anonymous strict row on the factsheet, three viewports), `reflow-sweep-authed` (signed-in and anonymous factsheet rows at 390/640/960), and the five factsheet specs `svg-chart-parity`, `target-size`, `composite-factsheet-render`, `layout-narrow`, `full-flow`. The 308 status and `Location` header, the browser-cached-308 behaviour, the Advanced toggle in real Chromium, the PDF render (including whether LazyMount sections appear), and the factsheet at 320 px (not a supported width, founder decision 2026-09-27) were not measured anywhere.

### Production census after-run: pending

Run after the deploy; the command shape, env var names and the three profiles are in `196-CENSUS.md`. Expect repeated metrics > 0 with Advanced open until `196-ROLLING-REPEATS-01` is decided. Named-strategy after-run on production is not done and cannot be from a worktree (no PROD access).

### Ship check: .planning must not reach the ship branch

`196-CENSUS.md` and `196-KNIP-BASELINE.txt` (written by plans 01, 02 and this plan) are under `.planning/` and must not reach the ship branch. The `-pr` filter strips `.planning/`, and before the push the ship step confirms `git diff --name-only origin/main...<ship branch> -- .planning` prints nothing. Also confirm `TODOS.md` is the only non-`.planning` records file this plan touched, and write the CHANGELOG, VERSION and package.json bump in the version commit.

## Deviations from Plan

None. Task 2 dated the TODOS entry 2026-11-09 (the day it was written) rather than the plan's example 2026-11-08, the day of the founder decision, which the entry cites. Beyond the plan's list, nine bookings were made because the orchestrator brief named them, and one dated re-measure note was added to `195-EXCHANGE-MONITORING-CLAIM` (not a closure). No product code was touched.

## Auth gates

None.

## Known Stubs

None. This plan writes records only.

## Threat Flags

None. No new network, auth or schema surface. T-196-36: the census, TODOS and knip records carry display names, profile letters, file paths and export names only; the UUID grep on `196-CENSUS.md` returns 0 and command shapes use placeholders. T-196-37: every dropped surface (D-06 panels, D-09 Book Intro Call and Tear Sheet link) is in the ship notes above and booked in TODOS.md.

## Self-check and anchors

- Commits 26ca0bba8, 9e74234b7, a519ca537 are ancestors of HEAD.
- Files exist: this SUMMARY, `196-KNIP-BASELINE.txt` (two `## ` sections), `196-CENSUS.md` (one `## After`, 0 UUID-shaped strings), `TODOS.md` (`196-V2-PANELS-REVIVAL-01` count 3: heading and two cross-references).
- `STATE.md` and `ROADMAP.md` untouched.
- `node scripts/verify-plan-anchors.mjs --pending` result: exit 0, `OK: 0 pending plan file(s) of 111, no stale claims. Every plan in the tree has a SUMMARY or an explicit deferral.` (run with this SUMMARY present; the two 192 deferrals are exempt by their own markers).

## Self-Check: PASSED
