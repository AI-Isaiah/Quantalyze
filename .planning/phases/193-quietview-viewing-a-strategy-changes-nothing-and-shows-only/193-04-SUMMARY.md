---
phase: 193-quietview-viewing-a-strategy-changes-nothing-and-shows-only
plan: 04
subsystem: ui
tags: [factsheet, demo-content, trust-03, d-04, d-05, d-06, d-07, guard]

requires: []
provides:
  - "FactsheetBody.no-demo-content.test.tsx: the D-07 guard, which renders the real FactsheetBody for an api strategy with a firing IntersectionObserver and no hide flags, and fails on any of thirteen forbidden strings"
  - "An api factsheet carries no demo allocator section, no #factsheet-allocator anchor, no Allocator nav link, no demo-cohort peer panel, no developer sentence in Fees and no demo sentence in the footer"
affects: [193-05 MetricsColumn peer gate, 193-06 AllocatorSection deletion, phase 195 TRIM (FactsheetView.tsx)]

actuals:
  tokens: 6200
  tasks: 3
  commits: 3
plan_head_before: 04313e7882946b66b9799f55aec8d58b1d51b0d6
plan_head_after: 93f0ca85790bd877c796aab624a9d60e76916dba

tech-stack:
  added: []
  patterns: ["a guard over a lazily-mounted body installs a test-local firing IntersectionObserver per test (unstubGlobals restores it) and pins premises so a green run cannot mean an empty fixture"]

key-files:
  created:
    - "src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx"
  modified:
    - "src/app/factsheet/[id]/v2/MandatePanels.tsx"
    - "src/app/factsheet/[id]/v2/FactsheetView.tsx"
    - "src/app/factsheet/[id]/v2/FactsheetView.leverage.test.tsx"
    - "src/app/factsheet/[id]/v2/BatchDPanels.tsx"
    - "src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx"

key-decisions:
  - "hideAllocatorSection stays in FactsheetBodyOptions as a documented no-op so its 43 callers compile; FactsheetBody no longer destructures it"
  - "The what-if caption drops the word allocator (RESEARCH Open Question 4); its pin moved with it"
  - "DemoBadge stays in BatchDPanels.tsx because AllocatorSection still uses it until plan 193-06 deletes both"

patterns-established:
  - "Removal means not in the DOM: no CSS hiding, no placeholder in the gap"

requirements-completed: [TRUST-03]

duration: 25min
completed: 2026-11-07
status: complete

coverage:
  - id: D1
    description: "No api factsheet renders any of the thirteen forbidden strings (the three removed strings, the demo portfolio names, MultiMarket on a strategy not named MultiMarket)"
    requirement: "TRUST-03"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx#an api factsheet renders no %s (D-07)"
        status: pass
    human_judgment: false
  - id: D2
    description: "The Allocator Portfolio Analysis section is not in the DOM: no #factsheet-allocator element and no section-nav link to it"
    requirement: "TRUST-03"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx#the api factsheet has no allocator anchor and no Allocator nav link (D-05)"
        status: pass
    human_judgment: false
  - id: D3
    description: "Fees & Subscription loses the developer sentence and keeps its closing sentence; the footer disclaimer ends at past performance"
    requirement: "TRUST-03"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx#the Fees block keeps its closing sentence (D-06)"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx#the footer disclaimer ends at past performance (A-3)"
        status: pass
    human_judgment: false
  - id: D4
    description: "PeerPercentilePanel renders nothing for an api payload that carries a peerPercentile; the scenario-blend panel still renders with its disclosure"
    requirement: "TRUST-03"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/BatchDPanels.peer-scenario.test.tsx#api path renders nothing: the demo cohort arm is gone (D-04)"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx#the scenario-blend peer panel still renders, with real data only"
        status: pass
    human_judgment: false
  - id: D5
    description: "The guard cannot pass vacuously: the fixture still carries a peerPercentile and an allocatorPortfolios entry, and LazyMount children mount under the firing observer"
    requirement: "TRUST-03"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx#premise: the fixture still carries the demo payload fields"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx#premise: LazyMount mounts its children under the firing observer"
        status: pass
    human_judgment: false
---

# Phase 193 Plan 04: QUIETVIEW demo content removed from the factsheet Summary

**An api factsheet no longer renders the demo allocator section or its nav link, the synthesized peer cohort, the Fees developer sentence or the footer demo sentence, and a guard over the real body (firing IntersectionObserver, no hide flags, premises pinned) goes RED if any returns; three neuters prove it bites per source.**

## Performance

- **Duration:** about 25 min
- **Tasks:** 3
- **Files modified:** 6 (1 created, 5 modified)

## Accomplishments

- Task 1 (tracer): the D-07 guard exists with a test-local `FiringIntersectionObserver`, installed with `vi.stubGlobal` per test, and renders `FactsheetBody` with no option that suppresses a section or the footer. `TermsPanel` lost the developer sentence (the closing sentence and the seven "on request" rows stay). The footer paragraph lost its demo-cohort sentence.
- Task 2: `FactsheetView.tsx` no longer imports or mounts the allocator section, has no allocator nav entry, no `FactsheetBody` destructuring of `hideAllocatorSection`, and the what-if caption reads `peer and event-study panels stay at base 1×`. The type member stays, documented as a no-op.
- Task 3: `PeerPercentilePanel` reads only the csv `scenarioPeer` arm, so an api payload renders nothing; the badge and the synthesized footnote are gone and the scenario disclosure always renders. The peer-scenario test's api case now asserts an empty panel, and the two dash cases moved to the csv fixture.

## Task Commits

1. **Task 1: Tracer, the D-07 guard plus the two sentence removals** - `9c6dcb828` (feat)
2. **Task 2: Unmount the demo allocator section and its nav entry; trim the caption** - `3dd0aa0f4` (feat)
3. **Task 3: Narrow the peer panel to its real-data arm; repoint its tests** - `93f0ca857` (feat)

**Plan metadata:** the SUMMARY commit that follows this file (docs).

## RED-first, neuter and pin runs

- **RED at HEAD (guard added, no source change):** `19 tests | 16 failed`. Failed: all thirteen forbidden-string arms, `the api factsheet has no allocator anchor and no Allocator nav link (D-05)`, `the footer disclaimer ends at past performance (A-3)` and `the scenario-blend peer panel still renders, with real data only` (it failed on its absence half, `scenario body must not render Demo cohort`, because the scenario body renders the footer and `TermsPanel`; its presence half held).
- **HEAD-green pins, named (3):** `premise: the fixture still carries the demo payload fields`, `premise: LazyMount mounts its children under the firing observer`, and `the Fees block keeps its closing sentence (D-06)` (a presence assertion; it fails if the sentence goes). These passed at HEAD and are not claimed as RED-first.
- **After Task 1:** the `-t` filtered arms (developer sentence, footer, Fees, footer disclaimer, premises): `6 passed | 13 skipped`.
- **After Task 2:** allocator arms and anchor arm `8 passed | 11 skipped`; `FactsheetView.leverage.test.tsx` `21 passed`.
- **After Task 3:** guard plus peer-scenario file: `24 passed (24)`.
- **Neuter 1, `MandatePanels.pre` copied over** (guard plus peer-scenario file, `2 failed | 22 passed`): `an api factsheet renders no Commercial terms not yet wired through (D-07)` and the scenario-blend arm failed. Restored from `.post`, `cmp` equal.
- **Neuter 2, `FactsheetView.pre`** (`12 failed | 12 passed`): `Demo cohort`, `Demo portfolios`, `Allocator Portfolio Analysis`, `Suggested MultiMarket sleeve`, `Demo cohorts and demo portfolios`, `MultiMarket`, `60/40 Stocks/Bonds`, `Multi-Asset Risk Parity`, `Diversified Crypto Book`, the anchor arm, the footer-disclaimer arm and the scenario-blend arm failed. Restored, `cmp` equal.
- **Neuter 3, `BatchDPanels.pre`** (`5 failed | 19 passed`): `api path renders nothing: the demo cohort arm is gone (D-04)` and the guard's `Synthesized peer cohort`, `deterministic seed`, `Production: replace` and `Demo cohort` arms failed. Restored, `cmp` equal.
- After the three restores the three sources byte-match their `.post` copies; scratch copies live outside the repo in the session scratchpad under `193/qv/`.

## Final gates

- Neighbours named by the plan (guard, peer-scenario, `FactsheetBody.degenerate`, `.scenario-mode`, `.basis`, `FactsheetView.leverage`, `BaseLeverageNote.wiring`, `panels.signed-zero`, `BatchDPanels.null-honest`, `ScenarioComposer`): 10 files, 590 tests passed, 0 failed, 0 skipped.
- Wider sweep, `src/app/factsheet`, `src/app/(dashboard)/allocations`, `src/app/(dashboard)/discovery`: 276 files, 4229 tests passed, 0 failed, 0 skipped.
- `npm run typecheck` (`tsc --noEmit`): exit 0, no output.
- `npm run lint`: 0 errors, 2 warnings, both unused-variable warnings in files this plan did not touch (`MetricsColumn.tsx`, `src/lib/factsheet/composite-read-path.ts`; pre-existing, out of scope). The hygiene, route and domain checks printed OK.
- `FactsheetView.tsx` diff across the two tasks that touch it: the footer sentence, the allocator import, the mount block, the destructuring entry, two doc comments, the FINDING-10 comment line, the nav spread and the caption word. Nothing else.

## Deviations from Plan

None - plan executed exactly as written. One small addition inside the plan's "rewrite the panel's comments" instruction: the file-level docblock line for `PeerPercentilePanel` in `BatchDPanels.tsx` no longer says "synthesized cohort (tagged Demo cohort)".

## Known Stubs

None. One code comment in `FactsheetView.tsx` (the leverage rail commentary) still lists "peer/allocator/event-study" panels staying at base 1x. It sits outside the plan's named edit list (Phase 195 overlap kept narrow) and is left for a later plan.

## Threat Flags

None. No new endpoint, auth path or file access; the plan removes UI only.

## Assumptions carried (from the plan, not decided here)

- A-193-07: the D-07 guard's premises and its scenario-blend positive arm stand in for TRUST-03's unclassified empty and zero-one-many shapes.
- A-193-08: the seven "on request" Fees rows stay (UI-SPEC A-2); flag to the founder at verify time.
- A-193-09: the caption drops "allocator,".
- Backstop truths (no automated verification, per the plan): the scenario-blend peer panel renders for real strategies in a real browser; a factsheet for a strategy not named MultiMarket never shows the word in the live app.

## Self-Check: PASSED

Created and modified files exist; commits `9c6dcb828`, `3dd0aa0f4` and `93f0ca857` are ancestors of HEAD.
