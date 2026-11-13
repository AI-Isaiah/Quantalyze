# Phase 205: ONEVERDICT - Research

**Researched:** 2026-11-10
**Domain:** factsheet payload builder (`src/lib/factsheet/*`), one readability verdict per record
**Confidence:** HIGH (every claim below was re-measured at HEAD `20f3136a2` in worktree `quantalyze-205`, with probes and a throwaway prototype of the fix; the worktree was restored byte-identical afterwards, `git status` clean)

> **NO MIGRATION NEEDED.** All three fixes are TypeScript in `src/lib/factsheet/` plus one cache-key string. No SQL, no `supabase/` file, no analytics-service change. [VERIFIED: prototype of all three fixes built, `npx tsc --noEmit` clean]

> **TWO LOUD FINDINGS THE CONTEXT DID NOT ANTICIPATE (read before planning):**
> 1. **An existing test goes RED under D-03 and must be fixed in the same plan.** `src/lib/factsheet/audit-c20.test.ts` > "api strategy: all four synthesized fields are present and non-null" builds its fixture with `makeReturns()` (`date: \`2024-01-${String(i + 1).padStart(2, "0")}\``, `n = 40`), which yields `2024-01-32` to `2024-01-40`: impossible dates. That api-arm record is unreadable, so after D-03 `allocatorPortfolios` is `null` and the `.not.toBeNull()` assertion fails. Measured: it is the only factsheet-test failure the prototype causes. Fix the FIXTURE (a readable-date helper used by that one test), never the assertion.
> 2. **The Sentry report condition must NOT be left as `totalRecord.unreadable && opts?.reportUnreadable`** once `totalRecord` can be unreadable by inheritance. The correct own-verdict predicate is `(firstBad || endsRecord.unreadable) && opts?.reportUnreadable`. A first prototype using `firstBad && ...` broke `src/lib/factsheet/figure-record-unreadable.test.ts` > "a malformed headline start (chain-broken suffix) is unreadable and reported too" (an unreadable `headlineSince` has no `firstBad`, only `endsRecord.unreadable`). Measured.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope. (Out of scope per the phase boundary: the 194.2 intro-path authorization gap, any new UI copy, any migration.)
</user_constraints>

<phase_requirements>
## Phase Requirements

None. ROADMAP.md lists `**Requirements**: TBD` for Phase 205 and the brief names no IDs. The planner maps plans to WR-01..03 of `194.2-REVIEW-R3.md`.
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **No migration; no PROD/TEST DB writes.** This phase touches none. (Project CLAUDE.md "Which database am I on?" is not triggered.)
- **CHANGELOG discipline:** every ship writes a unified `## [X.Y.Z.B] - YYYY-MM-DD` entry in the same commit as the VERSION bump (`chore(release): vX.Y.Z.B`); `VERSION` and `package.json` byte-equal 4-digit strings; never run `npm version`. Sections from this repo's own vocabulary (`### Fixed`, `### Changed`, `### Tests`, `### Root cause`, `### Notes`).
- **Never write a CI skip token** (the bracketed skip-ci family) in a commit message or PR body, not even to deny it. Say "the skip trailer".
- **Never quote a credential-shaped fixture literal** in CHANGELOG prose (gitleaks scans the squash diff).
- **Cite by symbol, not line number** in prose that will outlive the commit (the `[164.7-CITATION-DRIFT-01]` rule). Anchors below carry symbols.
- **Tests must be able to fail:** neuter, see RED, restore from a BYTE backup (`cp` to a backup, `cmp`/`shasum` after restoring); never `git checkout/restore/stash` uncommitted work.
- **Ship branch must change nothing under `.planning`**; no AI-authorship trailers; Next.js docs in `node_modules/next/dist/docs/` need reading only if a Next API changes. This phase changes only an `unstable_cache` key string, not an API.
- DESIGN.md: not applicable. No UI, no copy change (D-02).
- `grep -a` always; pytest only from `analytics-service/` (not used here).

## Summary

The three review findings are real at HEAD and each reproduces exactly as `194.2-REVIEW-R3.md` states (probe table below). Fixing them as decided is small: ~15 changed source lines across `build-payload.ts` and `fetch-and-build-payload.ts`, plus one cache-key string. A throwaway prototype of D-01/D-02/D-03 (a) made every R3 probe agree (native == USD verdict, USD stress withheld, api arm returns a payload with `allocatorPortfolios: null` instead of throwing, and no other api-arm step threw for any probed first date), (b) left the readable-record payload snapshot untouched, and (c) passed `tsc --noEmit`.

The two things the plan must handle that CONTEXT does not mention: the `audit-c20.test.ts` impossible-date fixture (red under D-03) and the Sentry report predicate (see the loud findings above). A third correction to CONTEXT's test list: of D-03's five first dates only `""`, `"2023-13-01"` and `"2023-02-32"` throw today; `"2024-1-5"` and `"2024-02-30"` do NOT throw (V8 parses `2024-1-5T00:00:00Z` and rolls `2024-02-30`), so for those two the case is RED today only on the `allocatorPortfolios === null` assertion (it is an array now), not on a throw. The throwing second-position case is `"2024-01-1"`.

**Primary recommendation:** Implement the stress override inside `deriveSeriesBundle` on `args.figureRecord?.unreadable === true` (one rule for the three server bundles AND the two browser re-derive call sites), thread the native verdict as a new optional `BuildFactsheetOpts` boolean replacing `recordSourceDates`, gate the api-arm blends with `totalRecord.unreadable ? null : [...]`, and run the four edits as ONE serialized chain (they share `build-payload.ts` and two test files).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Record readability verdict (`totalRecord.unreadable`) | API / Backend (server payload build, `buildFromBuildableSeries`) | Browser (re-derive reads `view.figureRecord`) | Computed once per build server-side; the browser only reads it |
| USD view verdict inheritance | API / Backend (`buildUsdView` in `fetch-and-build-payload.ts`) | — | USD view is built server-side beside the native payload |
| Stress block withholding | API / Backend (`deriveSeriesBundle`) | Browser (`StressWindowsPanel`, `advancedSectionContent` render the withheld form) | Bundle derivation is shared by server and client re-derive |
| Allocator blends | API / Backend (api arm of `buildFromBuildableSeries`) | — | No renderer reads `allocatorPortfolios` (see Pitfall 5): payload-only |
| Page payload cache | Frontend Server (SSR, `unstable_cache` in `v2/page.tsx`) | — | Key string versions the payload shape/values |

## Standard Stack

No new packages. Existing: Vitest `5.0.5` (`npx vitest --version` ran as `RUN v5.0.5`), TypeScript via `npx tsc --noEmit`. [VERIFIED: vitest run output header]

### Package Legitimacy Audit
No external packages installed or recommended. Packages removed: none. Packages flagged SUS: none. (Banned-package list in global CLAUDE.md is not touched.)

## Re-measurement of 194.2-REVIEW-R3.md at HEAD

Probes were temporary vitest files reusing `figure-parity-pages.test.tsx`'s fake admin client, run through the real `fetchAndBuildPayload` (the review probed lower modules directly). The probe file is deleted; its source is only in the research scratchpad. All three findings reproduce.

| Finding | Input | Result at HEAD |
|---|---|---|
| WR-01 | BTC-native api-arm 400-point curve, `curve[200] = {date:"2024-07-3", value:null}` | native `unreadable` false, USD **true**, Sentry axis `record_source` |
| WR-01 | same with `"2024-07-31x"` | native false, USD **true**, Sentry `record_source` |
| WR-02 | curve from 2024-02-28, `curve[1].date="2024-02-30"` | native `stressWindows.unreadable` true, 0 windows; USD `unreadable` absent, **1 window** |
| WR-02 | interior `curve[100].date="2024-06-31"` | native record unreadable but `stressWindows` **has 1 window** (table under a withheld record); USD same |
| WR-03 | direct `buildFactsheetPayload`, api arm, first date `""`, `"2023-13-01"`, `"2023-02-32"` | **throws** `RangeError: Invalid time value` at `Date.prototype.toISOString` (from `isoDayBefore` in `alignBlend`); csv arm returns withheld payload |
| WR-03 | api arm, first date `"2024-1-5"`, `"2024-02-30"`, `"2024-02-31x"` | **does not throw** (record unreadable, stress withheld, `allocatorPortfolios` is an array today) |
| WR-03 | through `fetchAndBuildPayload`, api arm (`daily_returns` null), curve from 2024-01-09 with `curve[1].date="2024-01-1"` | **throws**, both with `data_quality_flags: null` and with `{native_unit:"BTC"}` (native build throws before the USD view) |

After the prototype every row above resolved as intended (native == USD verdict, both stress blocks `unreadable: true` with 0 windows including the interior case, api arm `alloc null` for all six first dates, fetch cases return a payload; BTC-native case returns `usd unreadable true` consistently with native).

**Other api-arm steps (D-03's probe question): none throw.** With the blends skipped, `""`, `"2023-13-01"`, `"2023-02-32"`, `"2024-1-5"`, `"2024-02-30"`, `"2024-02-31x"` all build. The remaining api-arm steps (`computePeerPercentile`, `computeEventSignatures` x2) read stored scalars and number arrays, not dates. [VERIFIED: probe run, 12 direct builds + 2 fetch builds]

## Per-finding file map

Symbols, not lines (anchors drift). All paths under the repository root.

### WR-01 (USD record verdict)
| File | Symbol | Change |
|---|---|---|
| `src/lib/factsheet/build-payload.ts` | `BuildFactsheetOpts.recordSourceDates` | replace by one optional boolean (name is Claude's discretion; prototype used `inheritedUnreadable`) |
| same | `buildFromBuildableSeries`: the `firstUnreadableDate(dates, mtmDates, smoothedDates, ...recordSeriesStart, opts?.recordSourceDates ?? [])` call and `const totalRecord` | drop the 5th axis argument; `totalRecord` = `firstBad \|\| inherited ? {...endsRecord, unreadable: true} : endsRecord` |
| same | report block `if (totalRecord.unreadable && opts?.reportUnreadable)` and the `firstBadAxis` tuple `["cash","mark_to_market","smoothed_mtm","record_start","record_source"]` | predicate becomes `(firstBad \|\| endsRecord.unreadable) && opts?.reportUnreadable`; drop the dead `"record_source"` tuple entry and the `recordSourceDates` doc comment |
| `src/lib/factsheet/fetch-and-build-payload.ts` | `buildUsdView` `args` + `usdOpts` | add `nativeUnreadable: boolean` arg (from `nativePayload.figureRecord?.unreadable === true` at the one call site); replace `recordSourceDates: nativeSeries.map(...)` with the spread of the boolean. `nativeSeries` is still needed for `buildUsdViewFacts` and the converter |

Confirmed by grep: `recordSourceDates` / `record_source` appear only in `build-payload.ts` (opts type + axis tuple) and the single `buildUsdView` call. No test file mentions either. [VERIFIED: `grep -rn "recordSourceDates\|record_source" src scripts docs analytics-service supabase`]

Why equal-by-construction holds: `convertNativeReturnsToUsd` emits day `k >= 1` only when `Number.isFinite(series[k].value)` and paired; `equityCurveToDailyReturns` keeps NaN placeholders only at days the `keepAbsent=false` path drops, so every USD date is a native build date. The USD build also gets the same `recordSeriesStart`. So the USD build's own scan can add no verdict the native build lacks; the inherited boolean is the only transfer needed. The native verdict also covers the native MTM/smoothed axes, which the USD build has none of, which is the intended "equal" semantics. [VERIFIED: read `native-to-usd.ts`, `resolve-series.ts`]

Tests already covering it: `src/__tests__/figure-parity-pages.test.tsx` > "194.2 R2 WR-01: a malformed date at %s curve point is unreadable on the native AND the USD view" (the `it.each` with `"2026-06-31"` interior and `"2026-13-01"` last). **This existing case is the gate for the inheritance half**: neuter the OR-in and it must go RED (the conversion drops the bad date, so USD's own scan sees nothing).

### WR-02 (stress block)
| File | Symbol | Change |
|---|---|---|
| `src/lib/factsheet/build-payload.ts` | `deriveSeriesBundle`, the `stressWindows:` ternary | predicate `args.figureRecord?.unreadable === true \|\| (dates.length > 0 && !isReadableDay(dates[0]))`; the `dates[0]` half stays as throw-avoidance when `figureRecord` is `null` (unknown) |

Recommended placement: inside `deriveSeriesBundle`, not after the bundles. Reasons measured/verified: (1) one edit covers cash, MTM and smoothed (all three pass `figureRecord: totalRecord`); (2) the two browser call sites, `useBasisSeriesView` leverage arm (`deriveSeriesBundle(levered, rederiveArgs(base))`) and `windowView` (`deriveSeriesBundle(slice, rederiveArgs(view))`), already pass `view.figureRecord` through `rederiveArgs`, so a levered view of an unreadable record also stays withheld (post-hoc override in `buildFromBuildableSeries` would leave the leverage arm computing a table); (3) a readable or unknown (`null`) record is byte-identical (snapshot passed). `windowView` does not follow `stressWindows` (it is not in `WINDOW_FOLLOW_FIELDS`), so only the leverage arm is newly covered. [VERIFIED: read `basis-context.tsx` `rederiveArgs`, `WINDOW_FOLLOW_FIELDS`]

Side effect to state in the plan: `figureRecord()` marks the record unreadable also for an unreadable `headlineSince` (chain-broken suffix) or `seriesEnd`, not just `dates[0]`. Those records now also withhold stress windows. The panel sentence ("the record's dates could not be read") is true for them, so no copy change; this is a behaviour change worth one CHANGELOG line.

Readers of `StressWindowPayload.unreadable` (no change needed): `StressWindowsPanel` (renders the withheld `<figure>`), `advancedSectionContent` in `FactsheetView.tsx` (`"factsheet-stress": view.stressWindows.windows.length > 0 || view.stressWindows.unreadable === true`). `scenario-factsheet-payload.ts` builds its own stress via `computeStressWindows` and an `emptyStressWindows` and never sets `unreadable`: untouched. [VERIFIED: grep of non-test `stressWindows` readers]

Tests covering it: `StressWindowsPanel.unreadable.test.tsx` (csv arm, direct build, first date only). New cases needed (D-04): USD view via `fetchAndBuildPayload` (needs WR-01 landed first so the USD record is unreadable) and the interior-date case.

### WR-03 (api-arm blends)
| File | Symbol | Change |
|---|---|---|
| `src/lib/factsheet/build-payload.ts` | api arm `if (ingestSource === "api")` return, `allocatorPortfolios:` | `totalRecord.unreadable ? null : [ ...unchanged... ]`. `portfolioFigures`/`alignBlend` are only called inside the array literal, so a ternary alone skips them |
| `src/lib/factsheet/allocator.ts` | `alignBlend` / `isoDayBefore` | **no change** (D-03) |
| `src/lib/factsheet/audit-c20.test.ts` | `makeReturns` fixture used by "api strategy: all four synthesized fields are present and non-null" | give that test a readable-date series (new helper); do not change `makeReturns` for the other tests in the file |

How `null` renders (D-03 asks): **nothing renders it.** `allocatorPortfolios` has exactly two non-test references in `src`: its type in `types.ts` (`FactsheetApiPayload.allocatorPortfolios: AllocatorPortfolioPayload[] | null`) and its construction in `build-payload.ts`. `BatchDPanels.tsx` reads only `scenarioPeer` / `scenarioOwnBookDelta` on the csv arm; `FactsheetView.tsx` gates "Signatures" on `ingestSource === "api"` and never touches the portfolios. So `null` cannot print a false "no data" claim; it only drops payload weight. No finding to report on copy. [VERIFIED: `grep -rn "allocatorPortfolios" src` excluding tests; `BatchDPanels.tsx` lines reading `ingestSource`]

Tests that mention the field and stay valid: `build-payload.null-honest.test.ts` (readable fixtures), `FactsheetBody.no-demo-content.test.tsx` (`(p.allocatorPortfolios ?? []).length > 0` on a readable fixture, passed under the prototype), `composite-read-path.test.ts`, `BatchDPanels.*` (literal `null`), snapshot `build-payload.test.ts.snap` (readable api arm, passed).

### D-05 (cache key) — five places for one literal
`factsheet-v2-payload-v22` appears in: `src/app/factsheet/[id]/v2/page.tsx` (the `unstable_cache` keyParts in `buildFactsheetPayloadCached`; add the dated `// Bumped v22→v23 (Phase 205 ONEVERDICT, 2026-11-10 ...)` comment under the v21→v22 one), `src/lib/factsheet/fetch-and-build-payload.ts` (a doc comment quoting the keyParts, "CACHE KEY REALITY"), `src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx` (three hand-typed expectations), and `src/app/factsheet-share/[token]/page.cache-isolation.test.tsx` (`EXPECTED_KEY_PREFIX`, hand-typed by design: "Never imported from the page"). The two test files are the gate: leave page.tsx on v22 and they go RED. [VERIFIED: `grep -rln "payload-v22"` excluding node_modules/.git]

## Shared files and plan serialization

| File | WR-01 | WR-02 | WR-03 | D-05 |
|---|---|---|---|---|
| `build-payload.ts` | yes | yes | yes | — |
| `fetch-and-build-payload.ts` | yes | — | — | comment only |
| `figure-parity-pages.test.tsx` | yes | yes (USD stress) | yes (api curve `2024-01-1`) | — |
| `StressWindowsPanel.unreadable.test.tsx` | — | yes (interior) | yes (api first dates) | — |
| `audit-c20.test.ts` | — | — | yes (fixture) | — |
| `page.tsx`, two cache-key tests | — | — | — | yes |

Everything funnels through `build-payload.ts` and two test files, so **no plan can run in parallel with another.** Recommended order (one worktree chain, one executor at a time):
1. **WR-01** (opts rename, `buildUsdView` thread, report predicate, parity gate). Needed first because WR-02's USD case and D-02's last bullet depend on the USD record being unreadable.
2. **WR-02** (`deriveSeriesBundle` predicate, USD + interior gates).
3. **WR-03** (api-arm ternary, `audit-c20` fixture, api first-date cases, `"2024-01-1"` fetch parity case).
4. **D-05** + release bookkeeping (cache key in 5 places, VERSION/package.json/CHANGELOG per CLAUDE.md).

## Architecture Patterns

```
stored row (analytics.daily_returns | returns_series)
        |
resolveDailyReturnSeries (keepAbsent=false) --> buildFactsheetPayload --> buildFromBuildableSeries
                                                   |  firstUnreadableDate(cash, mtm, smoothed, recordSeriesStart)
                                                   |  --> totalRecord.unreadable   <== THE one verdict (+ inherited flag on the USD build)
                                                   |        |-> deriveSeriesBundle x3 (stress withheld when unreadable)  [WR-02]
                                                   |        |-> api arm: allocatorPortfolios null when unreadable        [WR-03]
                                                   |        '-> reportUnreadable -> Sentry (own verdict only)            [WR-01/D-01]
                                                   v
                                           nativePayload.figureRecord.unreadable
                                                   |  (native-unit strategy, not composite)
                                                   v
resolveDailyReturnSeries (keepAbsent=true) --> convertNativeReturnsToUsd --> buildFactsheetPayload (USD)
                                                   inherited flag OR'd into the USD totalRecord                           [WR-01]
```

**Pattern: one verdict, derived once, consumed everywhere.** Downstream code reads `totalRecord.unreadable` (or `figureRecord.unreadable` in the browser) and never re-tests dates. The only date test left outside the verdict is `computeStressWindows`' own throw-avoidance, kept for a `null` (unknown) record.

**Anti-patterns:** a second date scan beside the verdict (`recordSourceDates`); a defensive date guard inside `alignBlend` (D-03 forbids: a throw on a readable record is a code-bug signal); reporting from a render.

## Don't Hand-Roll

| Problem | Don't build | Use instead | Why |
|---|---|---|---|
| Is a date readable | a new regex/`Date.parse` test | `isReadableDay` / `firstUnreadableDate` (`src/lib/figure-gate.ts`) | `Date.parse` accepts `2024-02-30` and `2024-1-5`; only `isReadableDay` round-trips through `toISOString` |
| Withheld stress shape | a new object | the existing literal `{windows: [], benchName: "BTC", totalCatalogued: 0, droppedOutOfRange: 0, droppedPartial: 0, unreadable: true}` | both readers already handle it |
| Verdict for USD | a second scan | the threaded native boolean | D-01 |

## Common Pitfalls

### Pitfall 1: Report predicate keyed to the combined verdict
**What goes wrong:** after D-01, `totalRecord.unreadable` is true for an inherited verdict, so the USD build would send a second Sentry event (violates D-01); keying it to `firstBad` alone drops the headlineSince-only report and breaks `figure-record-unreadable.test.ts`.
**How to avoid:** `(firstBad || endsRecord.unreadable) && opts?.reportUnreadable`. **Add a gate:** through `fetchAndBuildPayload` on a native-unreadable BTC curve, `captureToSentry` is called once with `firstBadAxis` set (native) and the USD build adds none. Existing `figure-record-unreadable.test.ts` covers the headlineSince arm.
**Residual:** a native record unreadable via `headlineSince` has the same `headlineSince` in the USD build (`singleKeyDataQuality(dqf)`), so USD also reports its own `endsRecord.unreadable`. That is today's behaviour and "its own scan" in D-01; do not widen scope. Worth one line in the plan so the executor does not "fix" it.

### Pitfall 2: The api-arm test fixture has impossible dates
`audit-c20.test.ts` `makeReturns(40)` -> `2024-01-32..40`. See loud finding 1. Any other api-arm fixture with day > 31 or malformed dates would silently flip to `null`. The full suite under the prototype showed exactly one such case (24 716 tests passed otherwise). [VERIFIED: full `npx vitest run`]

### Pitfall 3: D-03's date list does not all throw
Use `""`, `"2023-13-01"`, `"2023-02-32"` (and `"2024-01-1"` via the curve) as the RED-on-throw cases; `"2024-1-5"`, `"2024-02-30"` are RED on the `allocatorPortfolios === null` assertion only. State both in the test comments so a future reader does not think they throw.

### Pitfall 4: Curve test dates sort in place
`figure-parity-pages` interior cases note it already: a 2024 date in a 2026 curve sorts to index 0 (the base point the inversion never emits). Choose bad dates inside the curve's own year-month range, as the existing `"2026-06-31"` case does. For the WR-01 `{date:"2024-07-3", value:null}` case, `"2024-07-3"` sorts between `2024-07-29` and `2024-07-30`, which is fine (the element still becomes an absent placeholder on the `keepAbsent=true` series: measured, USD true / native false at HEAD).

### Pitfall 5: Don't expect `null` blends to change any rendered text
No reader exists (see WR-03 map). A test asserting rendered output would be vacuous; assert the payload field.

### Pitfall 6: Gate vacuity
A gate that cannot go RED is wrong. See the neuter table below; each neuter was either executed in the prototype (WR-01 `record_source`-style RED reproduced at HEAD, WR-03 throw reproduced at HEAD) or is mechanical (restore the old line). The executor must run each neuter with a byte backup.

## Code Examples

Prototype diff that passed `tsc --noEmit`, the snapshot and the full suite (except the fixture/pre-existing items listed) — names are illustrative, the planner may rename (Discretion):

```ts
// build-payload.ts: BuildFactsheetOpts
/** 205 D-01: the NATIVE build's verdict, for the USD view. OR'd into the USD record; never re-scanned. */
inheritedUnreadable?: boolean;

// buildFromBuildableSeries
const firstBad = firstUnreadableDate(
  dates, mtmDates, smoothedDates,
  opts?.recordSeriesStart ? [opts.recordSeriesStart] : [],
);
const totalRecord: FigureRecord =
  firstBad || opts?.inheritedUnreadable ? { ...endsRecord, unreadable: true } : endsRecord;
if ((firstBad || endsRecord.unreadable) && opts?.reportUnreadable) { /* unchanged body; drop "record_source" from the axis tuple */ }

// deriveSeriesBundle
stressWindows:
  args.figureRecord?.unreadable === true || (dates.length > 0 && !isReadableDay(dates[0]))
    ? { windows: [], benchName: "BTC", totalCatalogued: 0, droppedOutOfRange: 0, droppedPartial: 0, unreadable: true }
    : computeStressWindows(/* unchanged */),

// api arm
allocatorPortfolios: totalRecord.unreadable ? null : [ /* three blends unchanged */ ],

// fetch-and-build-payload.ts buildUsdView usdOpts
...(args.nativeUnreadable ? { inheritedUnreadable: true } : {}),
// call site: nativeUnreadable: nativePayload.figureRecord?.unreadable === true,
```

## State of the Art

| Old | Current | Changed | Impact |
|---|---|---|---|
| USD verdict from a second date list (`recordSourceDates`, 194.2 R2) | inherited native verdict | this phase | no split in either direction |
| Stress withheld on bundle `dates[0]` | on the record verdict | this phase | USD and interior-date cases agree |
| api-arm blends always built | withheld on unreadable | this phase | no error page |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The three non-factsheet full-suite failures (`accounttruth-census` needs a local PG cluster, `ci-apt-bounded` R4, `drift-check-scripts` F6) are environmental and not caused by this phase's prototype; they were NOT re-measured at an unmodified HEAD | Validation | Low: none touches `src/lib/factsheet`; planner should confirm by running them once at baseline before the phase gate [ASSUMED] |
| A2 | Headline-only (`headlineSince`) unreadable records withholding stress windows is acceptable (copy still true) | WR-02 | Low: it is the logical consequence of D-02 as decided; flagged so the CHANGELOG states it |

## Open Questions

1. **Should the inherited flag be a boolean or the verdict object?** Discretion area; a boolean suffices because the USD build derives everything else itself. No blocker.
2. **Client re-derive builds** (`AllocationDashboardV2`'s `buildAllocatorPortfolioFactsheetPayload`, csv arm) never set `reportUnreadable` or the new opt; both are optional, so unaffected. No action.

## Environment Availability

No external dependencies beyond the repo's own toolchain. `node_modules` present (715 entries), `vitest` 5.0.5, `tsc` available. Not used, per brief: `npm install`, `next build`, Docker, local Supabase stack. [VERIFIED: ran vitest and tsc]

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 5.0.5 (jsdom project) |
| Config file | `vitest.config.ts` (existing) |
| Quick run command | `npx vitest run src/__tests__/figure-parity-pages.test.tsx "src/app/factsheet/[id]/v2/StressWindowsPanel.unreadable.test.tsx" src/lib/factsheet/build-payload.test.ts src/lib/factsheet/figure-record-unreadable.test.ts src/lib/factsheet/audit-c20.test.ts` (about 5 s) |
| Full factsheet scope | `npx vitest run src/lib/factsheet "src/app/factsheet" "src/app/(dashboard)/allocations" src/__tests__/figure-parity-pages.test.tsx` (about 130 s) |
| Types | `npx tsc --noEmit` (about 21 s; clean with the prototype) |
| Full suite | `npx vitest run` (about 8-10 min) |

### Phase decisions -> test map (every row must be shown RED by neutering)
| Decision | Behavior | Test (file > case) | Command | Neuter to see RED | Exists |
|---|---|---|---|---|---|
| D-01 inherit | USD unreadable whenever native is | `figure-parity-pages.test.tsx` > "194.2 R2 WR-01: a malformed date at %s curve point ..." | quick run | drop the `\|\| opts?.inheritedUnreadable` | yes (existing) |
| D-01 no false withhold | native/USD both readable for `{date:"2024-07-3", value:null}` and `"2024-07-31x"` | new case in the same describe | quick run | restore `recordSourceDates: nativeSeries.map((p) => p.date)` (reproduced RED at HEAD: USD true) | Wave 0 |
| D-01 Sentry | native reports once, USD adds none | new case, `captureToSentry` mock | quick run | drop the `firstBad \|\| endsRecord.unreadable` narrowing back to `totalRecord.unreadable` | Wave 0 |
| D-02 USD + first date | `curve[1].date="2024-02-30"`: native and USD `stressWindows.unreadable === true`, 0 windows | new case through `fetchAndBuildPayload` | quick run | remove `args.figureRecord?.unreadable === true \|\|` | Wave 0 |
| D-02 interior | interior bad date: stress withheld on cash (and MTM/smoothed bundle if a fixture builds one) | new case in `StressWindowsPanel.unreadable.test.tsx` (render `StressWindowsPanel`, assert the withheld sentence) | quick run | same neuter | Wave 0 |
| D-02 leverage re-derive | `deriveSeriesBundle` direct with unreadable `figureRecord` returns the withheld form | new unit case (cheap, direct call) | quick run | same neuter | Wave 0 |
| D-03 | api arm first dates `""`, `"2023-13-01"`, `"2023-02-32"` build, `figureRecord.unreadable === true`, `allocatorPortfolios === null`; `"2024-1-5"`, `"2024-02-30"` same (null only) | new `it.each` in `StressWindowsPanel.unreadable.test.tsx` with `ingestSource: "api"` | quick run | drop the ternary (first three throw; last two see an array) | Wave 0 |
| D-03 fetch | api-arm curve, `curve[1].date="2024-01-1"`: payload returned, unreadable, `allocatorPortfolios === null` | new parity case (curve from 2024-01-09, `daily_returns: null`) | quick run | drop the ternary (throws, reproduced) | Wave 0 |
| D-03 fixture | api arm present-and-non-null on a READABLE series | `audit-c20.test.ts` > "api strategy: all four synthesized fields ..." with a readable-date series | quick run | n/a (control; it is RED after D-03 until the fixture is fixed) | yes, edit |
| D-04 readable unchanged | snapshot does not move | `build-payload.test.ts` (+ `.snap`, no `-u`) | quick run | n/a | yes |
| D-05 | key is `v23` everywhere | `page.public-cache-key.test.tsx`, `page.cache-isolation.test.tsx` | `npx vitest run "src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx" "src/app/factsheet-share/[token]/page.cache-isolation.test.tsx"` | leave `page.tsx` on v22 | yes, edit |

### Sampling Rate
- Per task commit: quick run + `npx tsc --noEmit`.
- Per wave (plan) merge: full factsheet scope.
- Phase gate: `npx vitest run` full suite; expected non-phase reds at HEAD: `compute.conventions.test.ts` fixtures B and C (2 inline-snapshot failures, **measured at unmodified HEAD**, unrelated to this phase) and the three environmental reds in A1. Do not "fix" them here; do not accept any NEW red.

### Wave 0 Gaps
- [ ] new cases listed above (no new test files needed; all go in existing files)
- [ ] a readable-date helper in `audit-c20.test.ts` for the one api test
- Byte-backup discipline for each neuter: `cp <file> <scratch>/bak`, edit, run, `cp` back, `shasum` equal.

## Security Domain

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V5 Input Validation | yes | stored dates are untrusted data: `isReadableDay` is the one validator; an unparseable date must withhold, not throw |
| V7 Error Handling | yes | WR-03 is a public-page unhandled-exception path (`/factsheet/<id>` is anonymous-reachable): after the fix no stored date reaches `error.tsx` |
| V2/V3/V4/V6 | no | no auth, session, access-control or crypto change |

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Corrupt stored date causes a public error page for every visitor (availability) | Denial of service | withhold via the record verdict (D-03); no date math on an unreadable record |

## Sources

### Primary (HIGH)
- Repo files read this session at HEAD `20f3136a2`: `src/lib/factsheet/build-payload.ts`, `fetch-and-build-payload.ts`, `allocator.ts`, `resolve-series.ts`, `native-to-usd.ts`, `types.ts`; `src/lib/figure-gate.ts`; `src/app/factsheet/[id]/v2/StressWindowsPanel.tsx`, `basis-context.tsx` (`rederiveArgs`), `page.tsx` (cache key); `src/__tests__/figure-parity-pages.test.tsx`; `StressWindowsPanel.unreadable.test.tsx`; `audit-c20.test.ts`; `194.2-REVIEW-R3.md`; `205-CONTEXT.md`.
- Executed: targeted vitest runs, full `npx vitest run` under the prototype, `npx tsc --noEmit`, temporary probe test (deleted).

### Secondary / Tertiary
- None; no web sources needed (no external library behaviour in question).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH (no new packages)
- Architecture / file map: HIGH (read and prototyped)
- Pitfalls: HIGH (two measured as test failures under the prototype)

**Research date:** 2026-11-10
**Valid until:** until any of `build-payload.ts`, `fetch-and-build-payload.ts`, `allocator.ts` or the two parity test files changes on `main`.
