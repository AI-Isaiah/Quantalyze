# Phase 205: ONEVERDICT — every figure path follows the record's one readability verdict - Context

**Gathered:** 2026-11-10
**Status:** Ready for planning
**Mode:** smart discuss run by the phase agent with no founder available. Every decision below is
the recommended option, marked "(orchestrator default, founder may revisit)".

<domain>
## Phase Boundary

Three survivors of Phase 194.2's review rounds (`194.2-REVIEW-R3.md` WR-01..03), routed here by
founder decision 2026-11-10. The record's one readability verdict is `totalRecord.unreadable`
(computed once per build in `buildFromBuildableSeries`, `src/lib/factsheet/build-payload.ts`, from
`firstUnreadableDate`). Three paths still test dates themselves instead of following it:

1. **WR-01, the USD view's record verdict.** `buildUsdView` (`src/lib/factsheet/fetch-and-build-payload.ts`)
   passes `recordSourceDates: nativeSeries.map((p) => p.date)` from the `keepAbsent = true` series.
   That series keeps placeholder days the native build drops, so a malformed date on an absent day
   withholds the USD view while the native view shows its figures.
2. **WR-02, the stress-windows block.** `stressWindows` in the series bundle is withheld when the
   bundle's own `dates[0]` is unreadable, not when the record is unreadable. The USD view never
   carries the native first date, so it prints a stress table the native view withholds; an
   interior unreadable date prints a table under a withheld record.
3. **WR-03, the api-arm allocator blends.** On `ingestSource === "api"` (every PROD strategy),
   `alignBlend` (`src/lib/factsheet/allocator.ts`) calls `isoDayBefore(dates[0])`, which throws
   `RangeError` on a first date `Date.parse` rejects. Nothing catches it, so `/factsheet/<id>`
   renders the route error page instead of the withheld record.

Delivers: one rule on every path — an unreadable record is withheld the same way in the native
view, the USD view, the stress block and the allocator blends, and no unreadable date reaches an
error page. Out of scope: the 194.2 intro-path authorization gap (routed elsewhere), any new UI
copy, any migration.

All three findings were re-measured at HEAD `6b76bc76b` before this file was written: the
`recordSourceDates` line, the `dates[0]` stress guard and the unguarded `isoDayBefore(dates[0])`
are all still present as the review describes.

</domain>

<decisions>
## Implementation Decisions

### D-01 — USD verdict equals the native verdict by construction (WR-01)
- The native build's verdict (`nativePayload.figureRecord.unreadable`, or the equivalent value the
  native build computed) is threaded into `buildUsdView` and OR'd into the USD build's
  `totalRecord`. The USD record is unreadable exactly when the native record is, never by
  scanning a second date list. (orchestrator default, founder may revisit)
- The `recordSourceDates` opt, whose only caller is `buildUsdView`, is replaced by this threaded
  verdict rather than kept beside it, so there are not two mechanisms for one fact. The planner
  confirms by grep that nothing else passes `recordSourceDates` before removing it.
  (orchestrator default, founder may revisit)
- The USD build still scans its own converted dates as today (they are a subset of priced,
  readable days, so this cannot add a verdict the native build lacks).
- Sentry: a native-unreadable record is already reported once by the native build. The USD build
  does not send a second `figure-record-unreadable` event for an inherited verdict. Its own scan
  still reports if it ever finds an unreadable date of its own. (orchestrator default, founder may revisit)

### D-02 — the stress block follows the record verdict (WR-02)
- `stressWindows` is the withheld form (`unreadable: true`, no windows, the existing shape) on
  every bundle (cash, mark-to-market, smoothed) whenever `totalRecord.unreadable` is true, applied
  where `totalRecord` is known in `buildFromBuildableSeries`. (orchestrator default, founder may revisit)
- The existing `dates[0]` guard stays only as throw-avoidance for `computeStressWindows` (a code
  bug guard); it is no longer the user-facing predicate.
- An interior unreadable date therefore also withholds the stress windows. The panel's existing
  sentence ("Stress windows are not shown: the record's dates could not be read.") is a claim about
  the record and stays true; no copy change. (orchestrator default, founder may revisit)
- With D-01, the USD view of an unreadable record shows the same withheld stress form as the
  native view.

### D-03 — the api-arm allocator blends are withheld on an unreadable record (WR-03)
- When `totalRecord.unreadable`, the api arm does not build the allocator blends:
  `allocatorPortfolios` is `null` (the type already allows `null`). They are record-derived
  figures, so the phase's rule — an unreadable record withholds its figures — applies.
  (orchestrator default, founder may revisit)
- No defensive date guard is added inside `alignBlend`: the record verdict is the one gate, and a
  throw there on a readable record still signals a code bug. (orchestrator default, founder may revisit)
- The planner verifies how a `null` `allocatorPortfolios` renders today (its readers, including
  `BatchDPanels`) and that it does not claim the strategy lacks data in a misleading way. If the
  null rendering says something false for this case, that is a finding to report, not new copy to
  invent.
- The planner probes the whole api-arm build (`buildFactsheetPayload` with `ingestSource: "api"`)
  for unreadable first dates `""`, `"2023-13-01"`, `"2023-02-32"`, `"2024-1-5"`, `"2024-02-30"`,
  to confirm no OTHER api-arm step throws once the blends are skipped. Any further throw site found
  is in scope under the same rule.
- `peerPercentile` is untouched: it ranks the stored SQL scalars, not the record's dates.

### D-04 — tests that can fail
- Each fix gets a gate that goes RED with the fix neutered (neuter, see RED, restore from a byte
  backup; never git checkout/restore/stash uncommitted work), per project rules:
  - WR-01: a parity case through `fetchAndBuildPayload` with a BTC-native api-arm curve whose
    interior element is `{date: "2024-07-3", value: null}` (and `"2024-07-31x"`): native and USD
    `figureRecord.unreadable` agree (both false).
  - WR-02: a USD-view case (curve `curve[1].date = "2024-02-30"`) where native and USD both carry
    the withheld stress form; and an interior unreadable date case where the stress block is
    withheld.
  - WR-03: `ingestSource: "api"` cases added to `StressWindowsPanel.unreadable.test.tsx` (the R2
    file pins only the csv arm) for the first dates listed in D-03, asserting a payload with
    `figureRecord.unreadable === true` and `allocatorPortfolios === null`, not a throw; plus a
    parity case through `fetchAndBuildPayload` for an api-arm curve whose second point is
    `"2024-01-1"`.
- Readable records stay byte-identical: the existing payload snapshot
  (`src/lib/factsheet/__snapshots__/build-payload.test.ts.snap`) must not move.

### D-05 — payload cache key bump
- The page payload cache key moves `factsheet-v2-payload-v22` → `v23`
  (`src/app/factsheet/[id]/v2/page.tsx`), with a dated comment in the house style beside the v22
  one. For the same inputs the payload's values change (stress block, allocator blends, USD
  record), so a v22 entry must not serve the old form after deploy. (orchestrator default, founder may revisit)

### Claude's Discretion
- Exact parameter name and threading shape for the native verdict into `buildUsdView` and
  `buildFactsheetPayload`'s opts.
- Whether the stress override is applied inside `deriveSeriesBundle` (via its `figureRecord`
  input, which already carries `totalRecord`) or after the bundles are built; pick whichever keeps
  one rule for all three bundles.
- Plan split: these are small, mostly in `build-payload.ts` and `fetch-and-build-payload.ts`;
  plans touching the same files run one at a time.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `isReadableDay`, `firstUnreadableDate`, `curveRecordStart` (194.2) — the readability primitives.
- `StressWindowPayload.unreadable` withheld form and its two readers (`StressWindowsPanel`,
  `advancedSectionContent`), both already handle it.
- `src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx` (`payloadWithFirstDate`
  fixture) and `src/__tests__/figure-parity-pages.test.tsx` — the 194.2 gates to extend.

### Established Patterns
- One record verdict per build, reported to Sentry once (`reportUnreadable`), never from a render.
- Dated `194.2 ...` / phase comments beside each gate explain why; follow that voice with `205`.
- Payload cache key bumps carry a dated rationale comment.

### Integration Points
- `fetchAndBuildPayload` → `buildUsdView` (USD view, native-unit strategies only; composite has no
  USD view).
- `buildFromBuildableSeries` → `deriveSeriesBundle` (cash / MTM / smoothed) → `stressWindows`.
- `buildFactsheetPayload` api arm → `portfolioFigures` → `alignBlend`.

</code_context>

<specifics>
## Specific Ideas

The review's measured inputs (`194.2-REVIEW-R3.md`) are the test inputs. Its probe scripts were
never committed; re-create the scenarios as tests, not as probes.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
