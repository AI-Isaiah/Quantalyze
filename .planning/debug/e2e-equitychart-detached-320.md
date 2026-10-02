---
status: diagnosed
trigger: "main CI e2e-seeded red: target-size.spec.ts:246 EquityChart detached at 320px on /allocations"
created: 2026-10-02
updated: 2026-10-02
goal: find_root_cause_only
---

# Debug: e2e EquityChart detached at 320px on /allocations

## Trigger (data, verbatim from orchestrator)

DATA_START
main CI e2e-seeded red since dbe329186 (#917, docs-only) and 05ebb559b (#918, test-helper only); green on 53c326303 (#913) run 36899566710 and c110555e2 (#916) run 36920076462. Failing: e2e/target-size.spec.ts:246 "EquityChart tap surface measures >= 44px at 320px (coarse) on /allocations" — locator.scrollIntoViewIfNeeded at line 274 throws "Element is not attached to the DOM" (getByRole("img",{name:"Equity chart"}).first()), fails on retry too, in runs 36930606937 and 36930615239.
DATA_END

## Symptoms

- expected: the EquityChart svg on /allocations at 320px (coarse pointer) stays attached; the test measures its tap rect >= 44px.
- actual: `locator.scrollIntoViewIfNeeded: Element is not attached to the DOM` at e2e/target-size.spec.ts:274, on first try and on retry.
- errors: "Element is not attached to the DOM" (waiting for element to be stable).
- timeline: green on main at 53c326303 (CI run 36899566710) and c110555e2 (run 36920076462, merged 2026-10-01 ~20:14Z); red at dbe329186 (run 36930606937) and 05ebb559b (run 36930615239), ~2026-10-01 22:xx Z onward. Neither red commit touches /allocations code (#917 docs-only, #918 a test helper). A third main run at 5a88a165e (run 36981647340) is in progress.
- reproduction: CI job e2e-seeded on push to main; artifacts (screenshot, error-context.md, trace) downloadable via `gh run download <run> -R AI-Isaiah/Quantalyze`.
- second break, flaky only (passed on retry) in 36930606937: e2e/composite-factsheet-render.spec.ts:191 axe (cash basis).

## Hypotheses to test

- time dependence: date-window / zoom-window defaults (Phase 169.1 ZOOMKPIS shipped in #913), runs crossed into 2026-10-02 UTC.
- shared TEST data changed between the green and red runs, causing a chart remount after first paint (React key change, Suspense/refetch, state init).
- test race independent of product code.

## Constraints

- Read-only diagnosis: do NOT commit or push. Never query PROD.
- Work in the main checkout (main checkout is on another branch with local edits; do not touch them). Use a scratch worktree of origin/main if anything must run. Node 22 at the Node 22 toolchain.

## Current Focus

bug_class: Heisenbug in CI (race), but the underlying defect is a deterministic Bohrbug (hydration mismatch)
hypothesis: CONFIRMED - SSR/CSR hydration mismatch (React #418) in the factsheet daily-returns TimeSeriesChart y-axis tick makes React regenerate the tree on the client, replacing the EquityChart svg the locator had resolved.
next_action: none (find_root_cause_only); hand back to orchestrator.

## Evidence

- timestamp: 2026-10-02
  checked: e2e-seeded job logs of every CI run 2026-09-28..2026-10-02 (64 jobs)
  found: target-size.spec.ts:246 appears with the SAME error (scrollIntoViewIfNeeded: Element is not attached) in 16 jobs, first at 2026-09-29T19:51Z (branch feat/167.1.2-c3), then flaky/failed on most later runs incl. the "green" main runs 36899566710 (flaky) and PR run 36979073059 at 07:55Z Oct 2 (flaky). Zero occurrences in the 13 jobs before 2026-09-29T19:51Z.
  implication: NOT a regression from #917/#918 and not a UTC-date flip; a long-running flake that this time exhausted 3 attempts.
- timestamp: 2026-10-02
  checked: git show 6ca90e73e (PR C2, merged 2026-09-29 17:27 +0200) on e2e/target-size.spec.ts + seed helper
  found: C2 RESTORED the EquityChart tap-rect test (previously suspended by D-02 to assert the rebuilding panel) and added the version-2 derived seed. The flake onset coincides with the test's re-introduction.
  implication: the flake is inherent to the restored test vs the current Overview render, not to a later code change.
- timestamp: 2026-10-02
  checked: server-side warning classes in green vs red e2e-seeded logs
  found: no class present only in red runs.
  implication: no server-side data/state difference visible.
- timestamp: 2026-10-02
  checked: EquityChart.tsx warm-up early return (line ~1166)
  found: the warm-up placeholder <div> ALSO carries role="img" aria-label="Equity chart", so the locator can match a node that is not the svg.
  implication: candidate for a resolve-then-replace race. SUPERSEDED by the diag below: the resolved node was the svg (svg#1), so this shared role/label is NOT the mechanism; it remains only a latent locator hazard.

- timestamp: 2026-10-02
  checked: reproduction on the local-stack lane (private empty DB, no shared TEST), scratch worktree of origin/main 5a88a165e, next build + next start, TZ=UTC; only harness change = CSP connect-src allows the lane's 127.0.0.1:54421
  found: original test fails 10/10 with the SAME error (scrollIntoViewIfNeeded: Element is not attached to the DOM).
  implication: not shared TEST data, not the UTC date; reproducible from code alone.
- timestamp: 2026-10-02
  checked: diagnostic spec (MutationObserver on aria-label="Equity chart", console/pageerror capture)
  found: SSR svg#1 present at DOMContentLoaded; at ~900ms pageerror "Minified React error #418" (hydration text mismatch); immediately after, svg#1 REMOVED and a new svg#13 ADDED (width 960->400, y 645.5->660.5).
  implication: one hydration-recovery client re-render replaces the svg the locator resolved; the y move explains the "element is not stable" line before the detach.
- timestamp: 2026-10-02
  checked: same diag under next dev (full hydration diff)
  found: mismatch is inside FactsheetBody > PerformanceCharts > TimeSeriesChartInner (config key "daily...", daily returns) y-axis zero tick: server renders "+0.0%" with the baseline style (t.value === config.baseline), client renders "-0.0%" with the plain gridline style.
  implication: server and client compute different tick values for the same data.
- timestamp: 2026-10-02
  checked: Math.pow(10,k) for k=-12..6 in Node 22.22.1 (V8 12.4.254) vs Playwright Chromium 153.0.8010.12
  found: Node Math.pow(10,-4)=0.00009999999999999999 and Math.pow(10,-5)=0.000009999999999999999; Chromium returns exactly 0.0001 / 0.00001. All other k equal. CI e2e-seeded runs node 22.23.3 (same V8 line).
  implication: niceLinearTicks (TimeSeriesChart.tsx:1506) magnitude differs server vs client when the y span puts rough=span/5 in [1e-4,1e-3) (seed daily returns ~1e-3 span); step/start/accumulated v differ by ulps, so the zero tick is exactly 0 on the server and a tiny negative on the client.
- timestamp: 2026-10-02
  checked: causal test - in the scratch worktree ONLY, replaced line 1506 `Math.pow(10, floor(log10(...)))` with `Number("1e" + floor(...))` (engine-independent), rebuilt
  found: original test 10/10 PASS (was 10/10 FAIL); diag shows no pageerror and svg#1 kept through hydration.
  implication: the Math.pow engine divergence is the necessary cause; fix confirmed by revert-equivalent before/after.

## Eliminated

- hypothesis: regression from #917/#918
  evidence: same failure signature flaky on 16 jobs since 2026-09-29T19:51Z, incl. the green main runs; app code identical between c110555e2 and 05ebb559b.
  timestamp: 2026-10-02
- hypothesis: UTC-date / zoom-window time dependence
  evidence: reproduces 10/10 locally; fixed by a pure math change; seed values are index-based.
  timestamp: 2026-10-02
- hypothesis: shared TEST data change
  evidence: reproduces 10/10 on a private, empty local-stack DB.
  timestamp: 2026-10-02

## Resolution

root_cause: Math.pow(10, n) returns different doubles in Node 22's V8 (12.4: 10^-4 = 9.999999999999999e-5, 10^-5 likewise) and Chromium 153's V8 (exact). niceLinearTicks in src/app/factsheet/[id]/v2/TimeSeriesChart.tsx:1506 derives the y-tick step from it, so for the daily-returns chart (span ~1e-3) the server's zero tick is exactly 0 ("+0.0%", baseline style) and the client's is a tiny negative ("-0.0%", gridline style). React reports hydration error #418 and regenerates the tree on the client, which replaces the Overview EquityChart svg (rendered in the same tree via FactsheetBody topSlot) after the test's locator has resolved it. The test races that one re-render: it fails when Playwright resolves the SSR svg before the recovery render (always locally; often in CI). Exposed when Phase 167.1.2 PR C2 (6ca90e73e, 2026-09-29) restored this test with a ready book that mounts the factsheet.
fix: (not applied - diagnose only)
verification: scratch-worktree patch of line 1506 to Number("1e"+exp): 10/10 pass vs 10/10 fail before; no #418.
files_changed: []
same_class_unverified: Math.pow(10, floor(log10(...))) idiom also at AnalyticalPanels.tsx:249, CrossSignaturePanels.tsx:376, SignaturePanels.tsx:390, TimeSeriesChart.tsx:1487 (log path), EquityChart.tsx:867 (by inspection only). `10 ** n` measured equally engine-dependent in Node 22.
inferences_not_measured: no CI artifact shows #418 (match is by identical error signature); "CI sometimes passes because the recovery render wins the race" is inferred; CI Node 22.23.3 assumed to share the V8 12.4 behaviour measured on 22.22.1.
not_investigated: composite-factsheet-render.spec.ts:191 axe (cash basis) flake - plausible same class (factsheet surface), unverified.
