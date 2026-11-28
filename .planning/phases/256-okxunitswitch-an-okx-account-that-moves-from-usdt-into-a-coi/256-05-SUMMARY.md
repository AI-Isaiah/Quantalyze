---
phase: 256-okxunitswitch
plan: 05
subsystem: ui
tags: [factsheet, unit-switch, copy, parser, payload-cache]
requires:
  - phase: 256-okxunitswitch
    provides: "256-02: strategy_analytics.unit_segments (jsonb, nullable) and the stored shape"
provides:
  - "src/lib/factsheet/unit-segments.ts: parseUnitSwitch, parseUnitSegments, composeUnitSwitchSentence and the nine copy templates (isomorphic, React-free)"
  - "payload fields unitSwitch and unitSegments (by spread; absent means a USD strategy)"
  - "UnitSwitchDisclosure in the masthead, KPI note under the Main metrics heading"
  - "payload cache factsheet-v2-payload v29 to v30"
affects: [256-06, 256-07, 256-08, 256-09, 256-10]
tech-stack:
  added: []
  patterns: ["strict parse at the boundary, malformed reads as absent (parseReturnsUnit posture)", "conditional spread so an unswitched payload is byte-identical"]
key-files:
  created:
    - src/lib/factsheet/unit-segments.ts
    - src/lib/factsheet/unit-segments.test.ts
    - src/app/factsheet/[id]/v2/FactsheetView.unit-switch.test.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.unit-switch.test.tsx
  modified:
    - src/lib/database.types.ts
    - src/lib/factsheet/types.ts
    - src/lib/factsheet/returns-unit.ts
    - src/lib/factsheet/fetch-and-build-payload.ts
    - src/lib/factsheet/fetch-and-build-payload.test.ts
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/MetricsColumn.tsx
    - src/app/factsheet/[id]/v2/page.tsx
    - src/app/factsheet/[id]/v2/page.public-cache-key.test.tsx
    - src/app/factsheet-share/[token]/page.cache-isolation.test.tsx
    - src/__tests__/computed-at-reader-census.test.ts
key-decisions:
  - "Dates print through formatCloseDay (Nov 14, 2026, Phase 201 U-14). The founder's yearless '14 Nov' is a named open conflict routed to UI review, not implemented."
  - "parseUnitSegments checks the sidecar against the already-parsed switch (USD segment ends on last_usd_day, coin base_day is last_usd_day, coin from_day is first_coin_return_day, no point on the wrong side) and de-duplicates and sorts unpriced_days, so the count m in the unpriced note is a count of distinct days."
  - "A flag that parses with a sidecar that does not keeps unitSwitch and drops unitSegments: the sentence is true on the flag alone, the chart falls back to the single series."
  - "The KPI note is a const rendered in both Main metrics panels (part main and the whole rail), not in the detailed half."
requirements-completed: [SC-3, SC-7]
status: complete
duration: 150min
completed: 2026-11-27
commits: 2
plan_head_before: 70d6110d8c35065ed22b73fc501d1e6a7c3d4728
plan_head_after: 1216cef9ebcbc588d79c25fffca1cfee99118b0c
actuals:
  tokens: 15800
  tasks: 3
  commits: 2
---

# Phase 256 Plan 05: PRESENT-TEXT Summary

**A switched strategy's factsheet states "In USD to Nov 14, 2026, in BTC from Nov 15, 2026." in the masthead and notes under the Main metrics heading that its figures are whole-record USD, all built from the stored derived days through one strict parser and one composer; an unswitched factsheet is unchanged.**

## What was built

- `unit-segments.ts`: `parseUnitSwitch` (coin through `RETURNS_UNIT_RE`, not USD, strict ISO days, first coin day exactly one UTC day after the last USD day), `parseUnitSegments` (version 1, two segments consistent with the switch, strictly ascending days, finite values, `unpriced_days` ISO), `composeUnitSwitchSentence` and the templates `unitSwitchMastheadLine`, `unitSwitchKpiNote`, `unitSwitchUnpricedNote`, `unitSwitchFigcaption`, `unitSwitchBaseOnlyFigcaption`, `unitSwitchChipText`, `unitSwitchChipTitle`, `unitSwitchLeverageReason`, `unitSwitchOgNote`. Units and days are parameters; dates only through `formatCloseDay`; no quote pair named.
- Payload: `fetch-and-build-payload.ts` adds `unit_segments` to the analytics select, `unit_switch` to the `dqf` cast, and sets `unitSwitch` and (when it parses against the flag) `unitSegments` by spread on the single-key arm. It never sets `returnsUnit` from the switch, so a switched payload has no unit chip, toggle or `usdView`. A composite never carries a switch.
- `FactsheetView.tsx`: `UnitSwitchDisclosure`, last child of `<header>`, shell classes byte-equal to `UsdDisclosure`, neutral tone, line 2 (`factsheet-unit-switch-unpriced-note`) only with unpriced days and with day/days and that day/those days agreeing with the count.
- `MetricsColumn.tsx`: `metrics-unit-switch-note` directly under the Main metrics heading, before the first figure; every figure still renders.
- `page.tsx`: cache key v29 to v30 with a dated comment naming Phase 256 and the two fields.
- `database.types.ts`: `unit_segments` in strategy_analytics Row, Insert and Update.

## Verification

- Task verify command (4 files, `--testTimeout 120000`): `Test Files  4 passed (4)`, `Tests  220 passed (220)`.
- `npm run typecheck` run without a pipe and redirected: `EXIT=0`, 0 `error TS` lines (re-run after the Task 2 commit state).
- Scope run `src/app/factsheet/[id]/v2/ src/lib/factsheet src/app/factsheet-share` (210 files, raised timeout): 3901 passed, 3 failed. The three are not this plan's:
  - `compute.conventions.test.ts` fixtures B and C: a last-digit float difference in `skew` (`-0.11360716852722537` expected, `-0.11360716852722538` received) in a FROZEN byte-identity inline snapshot of `compute()`. This plan touches nothing `compute()` reads; it fails when run alone too. Pre-existing and platform-dependent; not fixed (scope boundary), listed under Deferred Issues.
  - `FactsheetBody.advanced.test.tsx` "writes open and closed under the registered key": fails under suite load (host load average above 80), passes alone.
- Pinning-test sweep: every file under `src/__tests__` naming `fetch-and-build-payload`, `database.types`, `MetricsColumn`, `FactsheetView`, `returns-unit`, `factsheet-v2-payload`, `factsheet/types`, `unit_segments` or `strategy_analytics` (60 files, run in batches of 10): all green, no failures (integration and live-DB files skip by design).
- Acceptance greps: `unitSwitch` in types.ts 2; `factsheet-unit-switch-disclosure` in FactsheetView.tsx 1; `unit_segments` in database.types.ts 3; `14 Nov|Nov 14` in unit-segments.ts 0; `metrics-unit-switch-note` in MetricsColumn.tsx 1; `Phase 256` in page.tsx 1.
- Tracer gate: the combined Task 1 command was red once on a pre-existing load timeout in the native-strategy `BLEED GATE` arm (5 s default, host load average ~85); re-run with `--testTimeout`, green, and `BLEED GATE` alone green. Expansion followed only after that.

## PROOF-01 (each gate seen RED by assertion, restored by cp, cmp silent, GREEN)

Byte backup with `cp` to the scratchpad, neuter by an exact-string replace, run with `--testTimeout 120000`, restore with `cp`, `cmp` silent, rerun. `git status --short` showed 0 changed files after the last restore. No git checkout, restore or stash.

Gate A, adjacency check neutered in `parseUnitSwitch`:

```
     × a first coin day two days after the last USD day reads as absent 9ms
     × a first coin day on the last USD day reads as absent 1ms
     × a first coin day before the last USD day reads as absent 1ms
 FAIL  src/lib/factsheet/unit-segments.test.ts > parseUnitSwitch > a first coin day two days after the last USD day reads as absent
AssertionError: expected { Object (fromUnit, toUnit, ...) } to be null
 Test Files  1 failed (1)
      Tests  3 failed | 51 passed (54)
cmp(us): silent
-- GREEN after restore
 Test Files  1 passed (1)
      Tests  54 passed (54)
```

Gate B, `composeUnitSwitchSentence` swaps the two days (unit test and the FactsheetView test both go RED):

```
 FAIL  src/lib/factsheet/unit-segments.test.ts > composeUnitSwitchSentence > builds the founder's frame from the two derived days, through formatCloseDay
Expected: "In USD to Nov 14, 2026, in BTC from Nov 15, 2026"
Received: "In USD to Nov 15, 2026, in BTC from Nov 14, 2026"
 FAIL  src/lib/factsheet/unit-segments.test.ts > composeUnitSwitchSentence > a second fixture renders its own dates (no day or unit is a literal)
Expected: "In USD to Oct 2, 2026, in ETH from Oct 3, 2026"
Received: "In USD to Oct 3, 2026, in ETH from Oct 2, 2026"
 FAIL  src/app/factsheet/[id]/v2/FactsheetView.unit-switch.test.tsx > UnitSwitchDisclosure — the masthead switch sentence > renders the sentence from the derived days, with a full stop, as the last child of the header
Expected: "In USD to Nov 14, 2026, in BTC from Nov 15, 2026."
Received: "In USD to Nov 15, 2026, in BTC from Nov 14, 2026."
 FAIL  src/app/factsheet/[id]/v2/FactsheetView.unit-switch.test.tsx > UnitSwitchDisclosure — the masthead switch sentence > a second fixture with other days and another coin renders its own text (label binding, no literal)
 Test Files  2 failed (2)
      Tests  7 failed | 57 passed (64)
cmp(us): silent
-- GREEN after restore
 Test Files  2 passed (2)
      Tests  64 passed (64)
```

Gate C, the `unitSwitch` spread removed in `fetch-and-build-payload.ts`:

```
     × a switched row carries unitSwitch and unitSegments and leaves returnsUnit and usdView unset 38ms
     × a flag with no sidecar carries unitSwitch alone (the sentence still renders, the chart stays single) 21ms
     × a sidecar that disagrees with the flag is dropped, the flag is kept 20ms
 FAIL  ... > 256 plan 05 — unit_switch on the analytics row becomes payload.unitSwitch > a switched row carries unitSwitch and unitSegments and leaves returnsUnit and usdView u
AssertionError: expected undefined to deeply equal { Object (fromUnit, toUnit, ...) }
 Test Files  1 failed (1)
      Tests  3 failed | 9 passed | 138 skipped (150)
cmp(fb): silent
-- GREEN after restore
 Test Files  1 passed (1)
      Tests  12 passed | 138 skipped (150)
```

Extra gate, the composite arm (found vacuous in self-review and rebuilt on a composite that builds): with `isComposite ? null :` removed from the `unitSwitch` derivation the arm went RED (`AssertionError: expected true to be false`); restored with `cp`, `cmp` silent, GREEN.

Date format: the sentence follows Phase 201 U-14 (`formatCloseDay`, `Nov 14, 2026`). The founder's literal `14 Nov` is routed to UI review / UAT as the UI-SPEC's named open conflict; it needs a DESIGN-level exception recorded in CONTEXT and the ROADMAP, and was not made inline.

## Deviations from Plan

**1. [Rule 3 - blocking] `parseIsoDay` exported from `returns-unit.ts`.** The plan lists unit-segments.ts as importing only from `./returns-unit`, but its strict ISO day parse was module-private. Exported (one added keyword and a doc line) instead of carrying a second copy that could drift. Not in the plan's `files_modified`; other parallel plans that edit `returns-unit.ts` may collide textually.

**2. [Rule 3 - blocking] Cache-key pins updated outside the plan's file list.** The v29 to v30 bump required `page.public-cache-key.test.tsx` (the plan allows "any test that pins the version string") and `src/app/factsheet-share/[token]/page.cache-isolation.test.tsx` (`EXPECTED_KEY_PREFIX`), plus the docblock in `fetch-and-build-payload.ts` and the reason text in `src/__tests__/computed-at-reader-census.test.ts`. Text-only; the census count is unchanged.

**3. [Rule 1 - test bug] A vacuous composite arm fixed in Task 2's commit.** My first "a composite never carries a unit switch" arm seeded a composite with no persisted headline, which builds `null`, so its assertions sat inside an `if (payload !== null)` that never ran. Rebuilt on a composite that builds, asserts `not.toBeNull()`, and was shown RED against the neutered guard.

**4. [Commit trailers] No Co-Authored-By or Claude-Session trailer on either commit**, per the founder's no-AI-attribution rule (user memory and the dispatch's project rules).

**5. [Environment] `node_modules` is a symlink to the main checkout's** (read-only use, allowed by the executor rules) instead of `npm ci`; it is untracked and not staged.

## Deploy order

⛔ The analytics select now NAMES `unit_segments`. A PostgREST select naming an absent column fails the whole request, so this reader must ship only after the plan 02 migration PR has applied to PROD (the DEPLOY ORDER block in that migration). Do not merge this plan's PR ahead of it.

## Known Stubs

None. The chart, chip, leverage, OG and list surfaces are other plans; their templates exist here with no caller yet by design (plans 07 and 08), and are pinned by `unit-segments.test.ts`.

## Deferred Issues

- `src/lib/factsheet/compute.conventions.test.ts` fixtures B and C fail on a last-digit `skew` float difference at HEAD of this base, independent of this plan. Not fixed (out of scope).
- Basis control (UI-SPEC "unresolved: planner reads `basis-context.tsx`") is a chart concern (plan 07); this plan's masthead and KPI note render on every basis.

## Threat Flags

None. T-256-13 is mitigated (strict parse; malformed reads as absent, never partially; proven by the 16-row malformed matrix and the consistency matrix). T-256-14: React text nodes only. No new endpoint, auth path or schema surface.

## Self-Check: PASSED

- FOUND: src/lib/factsheet/unit-segments.ts, src/lib/factsheet/unit-segments.test.ts, FactsheetView.unit-switch.test.tsx, MetricsColumn.unit-switch.test.tsx
- FOUND commits ce9eace6f and 1216cef9e (ancestors of HEAD)
- STATE.md and ROADMAP.md untouched.
