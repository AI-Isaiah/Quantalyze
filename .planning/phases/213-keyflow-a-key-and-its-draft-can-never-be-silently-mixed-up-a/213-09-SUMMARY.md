---
phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a
plan: 09
subsystem: ui
tags: [react, scenario-composer, blend-basis, rolling-panels, delta, persistence-pin, vitest, sc-4, sc-6]

requires:
  - phase: 213-05
    provides: "legsPending memo beside blendBasis; deferredReturnsFetch() harness and the real-KpiStrip decision (d) describe"
  - phase: 213-11
    provides: "mountWithBookLeg / bookPayload optional series; gate caption and peer-rank hold"
provides:
  - "Rolling Sharpe, Rolling volatility and Rolling Sortino draw nothing while a leg's probe is open; caption, annualization note and withheld reason are not rendered while pending"
  - "Footer Sharpe delta item, the strip's Sharpe delta pill and the tooltip's book Sharpe are held while pending"
  - "scenarioOwnBookDelta blanks sharpe/sortino and withholds its basis-built records and span while pending; max drawdown still renders"
  - "Structural pin: POST and PUT bodies are exactly { name, draft }, no sharpe/sortino/volatility key at any depth"
affects: [213-10]

actuals:
  tokens: 7200
  tasks: 3
  commits: 3
plan_head_before: 034a307dc9695329a3eaed25643bf27028202dd4
plan_head_after: 1011224aeb5f75a85c730fd1ff42ce771328c913

tech-stack:
  added: []
  patterns:
    - "A held chart is handed the empty input its component already renders as nothing (RollingMetrics {} / charts []), never routed into an empty or withheld branch that names a cause"
    - "Held-probe cases always assert the non-vacuous settled state first, then the held state, then the once-only return on the final basis"

key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx"
    - "src/app/(dashboard)/allocations/components/KpiStrip.tsx"

key-decisions:
  - "The strip's Sharpe delta pill is suppressed through one optional KpiStrip prop (sharpeDeltaHeld, default false) because the composer cannot remove one cell's pill otherwise: nulling liveMetrics would drop every cell's pill, and a null scenario Sharpe still printed a dash pill"
  - "While pending scenarioOwnBookDelta omits records and span_days as well as nulling the ratios, so the factsheet panel reads deltaState 'null' and prints no withheld cause read off an interim verdict"
  - "Rolling panel while pending keeps the populated layout (headings kept) with held data; it never takes the withheld branch"

patterns-established:
  - "Rolling charts are mocked in the added-metrics file, so the rolling case asserts the data prop each mock receives on every render between the add and the answer, with non-vacuity pinned on the settled render"

requirements-completed: []

coverage:
  - id: D1
    description: "Rolling Sharpe, volatility and Sortino panels, caption, annualization note and withheld reason are silent while a drawer leg's probe is open; one draw on the final 252 basis after the answer"
    verification:
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx#decision (d): the rolling Sharpe, volatility and Sortino panels draw nothing, name no basis and state no cause while a leg's probe is open, then draw once on the final basis"
        status: pass
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx#decision (d): the annualization note / the withheld reason of the rolling panel is silent while a leg's probe is open, and the populated headings stay"
        status: pass
    human_judgment: false
  - id: D2
    description: "Footer Sharpe delta item, the strip's Sharpe pill and the tooltip's book Sharpe are held; the other cells' pills are untouched; all return after the answer"
    verification:
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx#decision (d): the footer Sharpe delta, the strip's Sharpe pill and the book Sharpe in its tooltip are held while a leg's probe is open, then return once"
        status: pass
    human_judgment: false
  - id: D3
    description: "Own-book delta Sharpe/Sortino slots and basis-built records are held; max drawdown still renders; slots return after the answer"
    verification:
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.added-metrics.test.tsx#decision (d): the own-book delta's basis-dependent slots and basis-built records are held while a leg's probe is open; max drawdown still renders"
        status: pass
    human_judgment: false
  - id: D4
    description: "Save (POST) and update (PUT) persist no figure: bodies are exactly name and draft with no sharpe/sortino/volatility key at any depth"
    verification:
      - kind: automated_ui
        ref: "src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx#Phase 213 decision (d): save and update persist no figure (three cases)"
        status: pass
    human_judgment: false

duration: 35min
completed: 2026-11-14
status: complete
---

# Phase 213 Plan 09: Rolling panels, delta consumers and persistence pin Summary

**While any leg's asset-class probe is open the composer's rolling panels, Sharpe delta (footer, pill, tooltip) and own-book delta slots print nothing on the interim basis and return once on the final one; the save and update bodies are pinned to `{ name, draft }`.**

## Accomplishments

- Task 1 (tracer): while `legsPending`, `RollingMetrics` gets `{}` and the volatility and Sortino charts get `[]`. The three headings stay. The `N-day rolling window · {blendBasis}-day annualized` caption, the `blend-rolling-annualization-note` and the withheld `PartialDataBanner` (it names a cause) are not rendered. Read from the components: `RollingMetrics` returns null only for an empty object, `RollingVolatilityChart` and `RollingSortinoChart` return null on `[]` (both confirmed by reading, no deviation from the plan's inputs).
- Task 2: footer Sharpe item skipped, tooltip book Sharpe (`gatedLiveMetrics.sharpe`) null, strip Sharpe pill suppressed, `scenarioOwnBookDelta` sharpe/sortino null with `records` and `span_days` omitted. `max_dd` still renders.
- Task 3: three cases on the captured request bodies (exact keys, key walk to any depth, plus a control case proving the walk can fail). No production change was needed; both bodies were already `{ name, draft }`.

## Task Commits

1. **Task 1 (tracer): rolling panels held** - `19df68c9a` (feat)
2. **Task 2 (tdd): Sharpe delta and own-book delta held** - `a872cc3e7` (feat)
3. **Task 3 (tdd): persistence pin** - `1011224ae` (test)

## SC-6 neuter evidence

Byte backups in the scratchpad (`p09/`), restored with `cp`, `shasum -a 256` matched every time (composer `28a874ec...` after Task 1, `a5061e5e...` after Task 2; KpiStrip `bc6c1959...`). No `git checkout`, `git restore` or `git stash`.

Task 1 (target: the rolling cases):
- (i) `RollingMetrics` gets `blendPanels.rollingSharpe` regardless of `legsPending` - `decision (d): the rolling Sharpe, volatility and Sortino panels draw nothing...` RED: `AssertionError: RollingMetrics was handed a series while held: expected { sharpe_365d: [ { …(2) }, …(274) ] } to deeply equal {}`.
- (ii) caption rendered regardless (`{true && ...}`) - same case RED: `AssertionError: expected 'Rolling metrics3M6M12M365DRolling Sha…' not to match /-day annualized/`.
- (iii) withheld branch ignores `legsPending` - `decision (d): the withheld reason of the rolling panel is silent...` RED: `AssertionError: the withheld reason was shown while held: expected <p …(1)></p> to be null`.
- (iv) annualization note ignores `legsPending` - `decision (d): the annualization note of the rolling panel is silent...` RED: `AssertionError: the annualization note was shown while held: expected <p …(2)></p> to be null`.
- Pre-implementation RED (before any source change) for the main case failed on the same `RollingMetrics was handed a series while held` assertion; non-vacuity assertions on the settled render passed first.

Task 2:
- Pre-fix RED (before any source change): footer case `AssertionError: expected '4 changes+8.87 Sharpe · +6.9% Max DD …' not to contain 'Sharpe'`; own-book case `AssertionError: the Sharpe delta slot carried a number while held: expected 0.45699999999999896 to be null`. Both executed and failed on the planned assertion (not on setup, import or fixture), after their non-vacuity assertions passed. `gsd_run check tdd-red-evidence` was not run; the evidence is the vitest assertion text recorded here (same convention as plans 05 and 11).
- (a) footer Sharpe item ignores `legsPending` - footer case RED: `expected '4 changes+8.87 Sharpe · +6.9% Max DD …' not to contain 'Sharpe'`.
- (b) KpiStrip `sharpeDeltaHeld` ignored - footer/pill case RED: `AssertionError: the Sharpe delta pill was rendered while held`.
- (c) tooltip book Sharpe ungated - footer/pill case RED: `AssertionError: expected 1.2 to be null`.
- (d) own-book Sharpe slot ungated - own-book case RED: `AssertionError: the Sharpe delta slot carried a number while held: expected 0.45699999999999896 to be null`.
- (e) own-book records not withheld - own-book case RED: `AssertionError: expected { Object (blend, book) } to be undefined`.

Task 3 (target: the persistence pin):
- POST neuter (`sharpe: scenarioMetrics.sharpe` added to the `postNewScenario` body) - `the POST body of a save has exactly the keys name and draft...` RED: `AssertionError: expected [ 'draft', 'name', 'sharpe' ] to deeply equal [ 'draft', 'name' ]`.
- PUT neuter (`volatility` added to the `putUpdateScenario` body) - `the PUT body of an update has exactly the keys name and draft...` RED: `AssertionError: expected [ 'draft', 'name', 'volatility' ] to deeply equal [ 'draft', 'name' ]`.
- The depth walk is pinned by its own control case (`the key walk itself bites`), which passes on a nested `sharpe`.

## Moved pins (same-commit rule)

None. All composer suites (`added-metrics`, `ScenarioComposer.test`, `d11`, `constituent-figure-gate`, `save`) plus `KpiStrip*` stayed green after every change: 637 tests after Task 2, 640 after Task 3. No existing case expected a basis-dependent figure or basis text while a drawer leg's probe was open, so nothing was edited, retitled or deleted.

## Consumer enumeration (CONTEXT (d); `grep -n blendBasis` and the `blendGateState` / `blendRecord` consumers on `ScenarioComposer.tsx`, re-run at HEAD)

| Consumer | Status | Held by |
|---|---|---|
| `blendBasis` / `blendPeriodsPerYear` (the 365/252 rule itself) | untouched | plan 05 (rule stays one function) |
| `scenarioMetrics` (`computeScenario(..., blendBasis)`) | held at every reader below | plans 05, 11, 09 |
| `blendRecord` -> `blendGateState` -> `gatedBlendMetrics` (strip Sharpe; vol/sortino/cagr nulled) | held | plan 05 |
| `blendGateNote` (gate caption) | held | plan 11 |
| `peerSharpe` / `peerSortino` -> peer-rank request | held (no request) | plan 11 |
| `rollingVerdict` (withheld branch, annualization note) | held | this plan, Task 1 |
| `blendPanels` -> `RollingMetrics`, `RollingVolatilityChart`, `RollingSortinoChart` and the `{blendBasis}-day annualized` caption | held | this plan, Task 1 |
| `sharpeDeltaState` consumers: footer Sharpe item (`deltaSummary`) | held | this plan, Task 2 |
| `sharpeDeltaState` consumers: strip delta pill, `gatedLiveMetrics` tooltip book Sharpe | held | this plan, Task 2 (`sharpeDeltaHeld`, `gatedLiveMetrics`) |
| `scenarioOwnBookDelta` (`sampleBasisRatios(..., blendBasis)`, basis-built `records`) | held: sharpe, sortino, records, span_days; `max_dd`, `blend_n`, `book_n` render | this plan, Task 2 |
| `handleTargetCommit` -> `solveLeverageForMaxDD({ periodsPerYear: blendBasis })` | invariant: `solve-leverage.ts` documents `max_drawdown` as annualization-invariant | not held, by measurement |
| Monte Carlo and stress | invariant (not annualized by blendBasis; no `blendBasis` read in the grep) | not held |
| `postNewScenario`, `putUpdateScenario`, `handleCommit` persistence | persist no figure | this plan, Task 3 pin |
| `<ScenarioFactsheetChart periodsPerYear={blendBasis}>` | delegated | plan 10 |
| `<ScenarioBenchmarkSection periodsPerYear={blendBasis}>` | delegated | plan 10 |

Consumers found beyond the plan's seed: none new. The seed list stood.

## Verification

- Composer suites + `KpiStrip*`: 9 files, 640 passed (final). Full `src/app/(dashboard)/allocations` run: 185 files passed, 1 failed (`RiskTabPanel.book-series.test.tsx`, a VaR render at 1162 ms under full-suite load); re-run alone it passes 3/3. It does not import any file this plan touched.
- `npx tsc --noEmit -p tsconfig.json`: clean.
- `npm run lint`: 0 errors (4 pre-existing warnings in unrelated files); planning-hygiene, route and domain checks OK.
- `node scripts/verify-plan-anchors.mjs` on the plan: OK, 6 claims.
- SC-5: `git diff --stat <merge-base> -- supabase/` prints nothing.

## Deviations from Plan

**1. [Rule 3 - Blocking] KpiStrip.tsx modified (not in the plan's `files_modified`)**
- **Found during:** Task 2
- **Issue:** the plan and UI-SPEC 4.3 require the strip's delta pill to be not rendered while pending. `KpiStrip` renders a pill whenever `liveMetrics != null`, and with a null scenario Sharpe it prints a dash pill ("— vs current allocation") whose tooltip carries the book Sharpe. The composer cannot remove one cell's pill by props alone: `liveMetrics={null}` would drop the pill on every cell, including the basis-invariant ones.
- **Fix:** one optional prop, `sharpeDeltaHeld` (default `false`, every other caller byte-identical), which suppresses only the Sharpe cell's pill. The composer passes `legsPending`. UI-SPEC 4.2 anticipated this ("the planner adds a hold input to it. That adds state, not a visual primitive").
- **Files modified:** `src/app/(dashboard)/allocations/components/KpiStrip.tsx`
- **Commit:** `a872cc3e7`

**2. [Process] Tasks 1 and 2 have no separate RED commit**, per the plan's same-commit rule (no commit carries a red test). RED was observed before each fix and is recorded above. Same shape as plans 05 and 11.

**3. [Process] Task 3 is one `test(...)` commit.** The behaviours already held (RESEARCH verified both bodies are `{ name, draft }`), so there is no RED-then-GREEN; the RED evidence is the neuter, recorded above.

**Total deviations:** 1 Rule 3 (one extra file, one optional prop), 2 process notes.

## TDD Gate Compliance

`git log --grep='^test\(213-09\)'` returns the Task 3 commit only. Tasks 1 and 2 are single `feat` commits because the plan forbids committing a red test; their RED evidence is recorded in the neuter section. Task 3 never had a failing state to commit (the production code already satisfied the pin).

## Known Gap handed to plan 10 (not fixed here)

While pending, the own-book panel in the factsheet (`OwnBookDeltaPanel` in `src/app/factsheet/[id]/v2/BatchDPanels.tsx`) still prints its basis caption `Delta = blend minus your live allocation · sample/{basisDays} basis · ...`, where `basisDays` reads `records?.blend.crypto === false ? 252 : 365`. With `records` withheld (so no cause note is read off an interim verdict) that falls to 365, the interim basis, and flips to 252 once the leg settles. The Sharpe and Sortino rows read the dash and no note prints, but the caption names a basis. That panel is a child of `ScenarioFactsheetChart`, which plan 10 owns (UI-SPEC 4.3: "prints no basis-gate caption"), and this plan's file list does not include it. Plan 10 should either blank the `sample/{N} basis` words when its `basisPending` input is set or strip the own-book delta there. The composer already hands the panel null ratios and no records while pending.

## Known Stubs

None.

## Threat Flags

None. No new endpoint, auth path, file access or schema surface. T-213-21 (persisted figures) is mitigated and pinned by the Task 3 cases; T-213-22 (interim-basis delta and rolling figures) is mitigated and pinned by the held-probe cases above.

## Issues Encountered

- The first own-book case mounted with the default fixture and the delta was `undefined`: the composer needs `bookEntryGateSatisfied` and `hasConnectedKeys` as well as a ready `equityDailyReturns`; the helper now sets them.
- The default fixture's live baseline has two equity points, so the live-book Sharpe is already gated to null and the tooltip assertion would have been vacuous; the Sharpe-delta case uses a 400-day live baseline so the book Sharpe is a real `1.2` before the hold.
- A full-directory vitest run took more than 120 s and one unrelated RiskTabPanel test failed under load (passes alone).

## Next Phase Readiness

Plan 10 holds `ScenarioBenchmarkSection` and the `ScenarioFactsheetChart` preview, and should also close the own-book panel's `sample/{N} basis` caption (see Known Gap). Everything else in the composer body is held or measured invariant.

## Self-Check: PASSED

All four modified files exist and are committed; commits `19df68c9a`, `a872cc3e7`, `1011224ae` are ancestors of HEAD.

---
*Phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a*
*Completed: 2026-11-14*
