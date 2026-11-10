---
phase: 205-oneverdict-every-figure-path-follows-the-record-s-one-readab
iteration: 2
reviewed: 2026-11-10T20:35:17Z
depth: standard
diff_range: "fixes a948a33a4..HEAD (1baa4c9b0); whole phase 240999b5f..HEAD (excluding .planning)"
files_reviewed: 10
files_reviewed_list:
  - src/lib/factsheet/build-payload.ts
  - src/lib/factsheet/fetch-and-build-payload.ts
  - src/app/factsheet/[id]/v2/page.tsx
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.ts
  - src/app/(dashboard)/allocations/widgets/performance/scenario-factsheet-payload.test.ts
  - src/__tests__/figure-parity-pages.test.tsx
  - src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx
  - src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx
  - src/app/factsheet-share/[token]/page.cache-isolation.test.tsx
  - src/lib/factsheet/audit-c20.test.ts
findings:
  critical: 0
  warning: 0
  info: 0
  total: 0
  necessity: 0
status: clean
---

# Phase 205: Code Review Report, round 2

**Reviewed:** 2026-11-10T20:35:17Z
**Depth:** standard, with cross-file reads of every reader of the changed fields.
**Files Reviewed:** 10
**Status:** clean
**Scope rule:** MEDIUM and above only, as the brief asked. LOW and INFO are left out on purpose.

## Summary

Both round-1 findings are closed, and neither fix causes a regression. A re-read of the whole phase diff (`240999b5f..HEAD`) found nothing new at MEDIUM or above.

**Checks run:**
- `npx tsc --noEmit` exits 0 with no output.
- The three directly changed test files pass (114/114).
- The broader suites (`src/lib/factsheet`, `src/app/factsheet`, `src/app/factsheet-share`, `src/app/(dashboard)/allocations`, `figure-parity-pages`) ran **6674 of 6676**.
  - The 2 failures are inline snapshots in `src/lib/factsheet/compute.conventions.test.ts`: fixture B (zero-return days) and fixture C (interior calendar gaps).
  - They fail the same way at the phase base `240999b5f`.
  - The phase touches neither that test nor `compute.ts` (`git diff --stat` is empty for both).
  - So they predate this phase and are not a finding. Their cause was not investigated.
- Neuter probes ran in a throwaway `git worktree` under the scratchpad, which has since been removed. No source file in this checkout was modified.

The necessity rubric (`necessity-review.md`) was read. No necessity finding reaches MEDIUM.

### WR-01 (Sentry double report through `recordSeriesStart`): closed

- **The fix.** `build-payload.ts:976` now reports only when `!opts?.inheritedUnreadable`.
- **Exactly one event per record:**
  - `inheritedUnreadable` is set only by `buildUsdView` (`fetch-and-build-payload.ts:1168`), from `nativePayload.figureRecord?.unreadable === true` (`:1075`).
  - The native build's `totalRecord.unreadable` (`build-payload.ts:968-969`) can be true only through `firstBad` or through `endsRecord.unreadable`, which the spread carries. Those are exactly the native build's report condition.
  - The native build always runs with `reportUnreadable: true` (`fetch-and-build-payload.ts:1042`).
  - So an inherited verdict has always already been reported once.
- **D-01's "own scan still reports" clause.** The USD build now never reports when the verdict is inherited. Its own scan cannot add a verdict the native build lacks:
  - `recordSeriesStart` is the native first date, copied verbatim.
  - A converted USD date is one that matched a stored close string, so it is readable.
  - So the clause has no reachable case to lose.
- **The test can fail.** With the `&& !opts?.inheritedUnreadable` clause removed, the new row "a bad first curve point is reported to Sentry exactly once" goes RED (2 reports). The interior row stays green, as expected: the original D-01 change bites that arm, not this fix.
- **The row asserts the right things:**
  - It runs through `fetchAndBuildPayload`.
  - It asserts `usdViewUnavailable` is undefined and both verdicts are `true`.
  - It asserts `firstBadAxis: "record_start"`, so it cannot pass with the USD view missing.

### WR-02 (Scenario stress block ignoring its record verdict): closed

- **The fix.** `scenario-factsheet-payload.ts:486-488` withholds on `record.unreadable` alone.
- **The fixer's claim that the first-date clause is dead holds by construction:**
  - `record` comes from `firstUnreadableDate(datesR)` (`:414`), which scans index 0 first.
  - This line is reached only when `datesR.length >= 2` (the degenerate gate at `:349-352`).
  - `READABLE_DAY` (`figure-gate.ts:82`) is the same regex as `ISO_DATE` (`stress-windows.ts:70`), and `isReadableDay` also requires a real calendar day.
  - So a date that would trip the `computeStressWindows` throw at `stress-windows.ts:96` always makes `record.unreadable` true first.
  - A probe confirmed it. These seven cases all returned the withheld form with no throw:
    - first date `""`, `"2023-13-01"`, `"2020-02-30"`, `"2020-01-1"` and `"2019-12-31x"`
    - last date `"2020-1-1"`
    - interior date `""`
- **`benchName: ""` in the withheld form is benign:**
  - `StressWindowsPanel.tsx` destructures `benchName` at `:29`, but every use (`:75`, `:76`, `:106`, `:109`) comes after the `if (unreadable) return` at `:32`.
  - `FactsheetView.tsx:710` reads only `windows.length` and `unreadable`.
  - No other non-test reader of `stressWindows` exists.
  - `""` is also the Scenario's own convention: its readable form passes `""` (`:488`), and so does `emptyStressWindows()` (`:276`).
  - A levered Scenario view takes `deriveSeriesBundle`'s `"BTC"` withheld form, while the base view carries `""`. They differ only in a field that nothing reads when `unreadable` is set.
- **Base and levered views now agree, by construction.** This was the user-facing disagreement round 1 described.
  - The levered arm passes `view.figureRecord` (`basis-context.tsx:288`, via `rederiveArgs` at `:400`) into the D-02 predicate at `build-payload.ts:664`.
  - That is the same `record` the base builder now gates on.
  - The new tests cover the builder only, not this parity.
- **The tests can fail.** With the predicate forced to `false`, two cases go RED: "a malformed interior date withholds the stress block with the record" and "a non-ISO first date withholds the stress block and does not throw". The readable control stays green.

### Re-check of the whole phase diff

Nothing new at MEDIUM or above. Checked:
- **No leftovers.** No non-planning reference to `recordSourceDates` or the `record_source` axis remains.
- **Every producer is covered.** The non-test callers of `computeStressWindows`, `firstUnreadableDate` and `alignBlend` are exactly the sites this phase now gates:
  - the Scenario builder
  - `deriveSeriesBundle`
  - `buildFromBuildableSeries`
  - `portfolioFigures`, reached only inside the `totalRecord.unreadable ? null : [...]` literal at `build-payload.ts:1228`
- **`deriveSeriesBundle` callers.** Its only callers are the three server bundles (all passing `totalRecord`) and the two browser re-derives (`basis-context.tsx:400` and `:655`). `windowView` does not take `stressWindows` from its slice bundle.
- **`allocatorPortfolios`.** It has no non-test reader beyond its type (`types.ts:1146`, already `| null`).
- **Cache key.** `page.tsx` still holds the only payload cache key, and v23 covers it.
- **`audit-c20.test.ts` fixtures.** Several api-arm cases still use `makeReturns()`. Its 40 points run into impossible dates (`2024-01-32` and on), so those records are now unreadable. None of these cases asserts stress or allocator content:
  - they check `ingestSource`
  - they run type-level `@ts-expect-error` probes
  - the `#597` peer-percentile case uses its own readable `rets`
  - so none of them became vacuous.

---

_Reviewed: 2026-11-10T20:35:17Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Silent-failure-hunter findings

The silent-failure-hunter (model sonnet) read the fix diff `a948a33a4..HEAD` and reports **no MEDIUM-or-above findings**:
- **No Sentry report is lost.** `inheritedUnreadable` is set only from the native verdict, and the native build always reports it. A USD-only unreadable date is still reported.
- **The Scenario withheld form never shows a false claim.** `StressWindowsPanel` returns the withheld sentence before it reads `benchName`, so `""` never renders.
- **The new tests can fail.** The scenario cases assert the withheld form against a readable control, and the parity `it.each` asserts exactly one report.

One note below the reporting bar, outside this diff: the client-side `buildScenarioFactsheetPayload` sends no Sentry event for an unreadable blend record. It is neither user-facing nor data-integrity.
