---
phase: 162-honest-what-the-user-sees-is-true
plan: 07
subsystem: ui
tags: [react, nextjs, factsheet, freshness, data-integrity, vitest]

requires:
  - phase: 162-01
    provides: "162-CENSUS.md HONEST-02 verdict (flat-account vs derive-gap) — the D-162-2 fence this plan is gated on"
provides:
  - "Factsheet v2 masthead series-recency line: 'Track record through {date}', keyed on the resolved return series' last point"
  - "FactsheetView.recency-line.test.tsx — F-1/F-1b/F-2/F-3a/F-3b/F-4, all five neuters witnessed RED"
  - "HONEST-02 disposition record: flat-account arm taken; the derive-gap routing arm is NOT taken"
affects: [162-08, 162-09, phase-close, factsheet-freshness, HONEST-02]

actuals:
  tokens: 4350
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Adjacent-surface formatter identity pinned by comparing two RENDERED strings, not the implementation's formatter against itself"
    - "Additive UI proven additive by a byte-identity assertion on the untouched neighbour's serialized subtree"

key-files:
  created:
    - "src/app/factsheet/[id]/v2/FactsheetView.recency-line.test.tsx"
  modified:
    - "src/app/factsheet/[id]/v2/FactsheetView.tsx"

key-decisions:
  - "Flat-account arm taken on the committed census verdict; the derive-gap arm (161.1 runbook / ccxt stored>0 filter routing) is NOT taken and is NOT filed"
  - "The recency line lives in a wrapper div beside FreshnessChip, not inside it — the shorter diff would have silently broken D-162-2's additive contract; F-4 makes that failure mechanical"
  - "Unknown/unparseable series end renders zero nodes, never 'Track record through —'"
  - "HONEST-02 NOT marked complete — the requirement names the BADGE, and D-162-2 deliberately leaves the badge untouched; the call belongs to the phase close"

patterns-established:
  - "Formatter-identity oracle: read both strings out of the DOM and compare; a self-referential oracle passes for any format including a divergent one"
  - "Additive-contract oracle: two payloads differing only in the new input must serialize the untouched neighbour byte-identically"

requirements-completed: []

coverage:
  - id: D1
    description: "The factsheet v2 masthead states where the track record ends, keyed on the resolved series' last point — never on computed_at or last_sync_at"
    requirement: "HONEST-02"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetView.recency-line.test.tsx#F-1: renders the exact copy, keyed on the series' last point, in the muted caption tier"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetView.recency-line.test.tsx#F-1b: the date follows the SERIES, not `computedAt` — the whole point of the line"
        status: pass
    human_judgment: true
    rationale: "Whether the rendered masthead now reads honestly to an allocator — typography tier, adjacency, and whether an additive line beside an unchanged FRESH badge satisfies HONEST-02's 'badge reflects series recency' wording — is a founder/phase-close judgment, not an automatable one. The tests pin the data source and the copy; they cannot pin 'does this stop misleading a reader'."
  - id: D2
    description: "Adjacent freshness dates cannot drift: the recency date and the chip's date line render byte-identically for the same day"
    requirement: "HONEST-02"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetView.recency-line.test.tsx#F-2: renders the date BYTE-IDENTICALLY to the chip's date line one row above"
        status: pass
    human_judgment: false
  - id: D3
    description: "An unknown series end renders no claim at all — absence, not a placeholder"
    requirement: "HONEST-02"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetView.recency-line.test.tsx#F-3a: renders NO line at all when the series is empty — absence, not a placeholder"
        status: pass
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetView.recency-line.test.tsx#F-3b: renders NO line when the series' last date does not parse"
        status: pass
    human_judgment: false
  - id: D4
    description: "D-162-2 additive contract: FreshnessChip's logic, thresholds and anatomy are untouched"
    requirement: "HONEST-02"
    verification:
      - kind: unit
        ref: "src/app/factsheet/[id]/v2/FactsheetView.recency-line.test.tsx#F-4: FreshnessChip serializes byte-identically with and without the line"
        status: pass
    human_judgment: false

duration: 18min
completed: 2026-08-26
status: complete
---

# Phase 162 Plan 07: HONEST-02 series-recency line Summary

**The factsheet masthead now states where the track record ENDS, keyed on the resolved return series' last point, so a strategy whose series died in May can no longer read FRESH without also saying so — pinned by six tests whose five neuter-witnesses were each run to RED.**

## Performance

- **Duration:** ~18 min
- **Tasks:** 2/2
- **Files modified:** 2 (1 created, 1 modified)

## The verdict this plan was gated on

The plan is a two-armed fence (D-162-2). The committed census line, quoted verbatim from
`162-CENSUS.md`:

```
HONEST-02 VERDICT: flat-account
```

**The flat-account arm was taken. The derive-gap arm was not**, so no routing note is filed
and plan 162-08 is handed nothing from this plan for TODOS.md.

**A2: NO** — the subject is not one of the 15 example rows, so this plan and plan 162-08 act
on disjoint populations. HONEST-02 does not collapse into D-162-1's recompute, and nothing
here touches the example cohort.

I judged the verdict rather than inheriting it. It rests on the decisive row being a
*measured* zero, not an unrun one: the key is alive and polling (sync complete, no error, no
429, not disconnected, last sync hours old) while the store-side fill watermark sat frozen at
the series' end date for 111 days. The census records its own limit honestly — that watermark
proves we never *received* a newer fill, not that the venue holds none — and that is as
strong as this evidence class gets.

## Accomplishments

- **The line ships, keyed on the honest column.** `SeriesRecencyLine` renders
  `Track record through {date}` from `payload.dates`' last point — the series axis the read
  path builds via `resolveDailyReturnSeries`. `computed_at` and `last_sync_at` are
  structurally excluded: neither is in scope in the component, and F-1b fails if the date
  ever follows the recompute instead of the series.
- **Two adjacent dates cannot drift.** The line calls `formatIsoDate` — the chip's own
  formatter, one row above. F-2 proves it by reading both strings out of the DOM.
- **Absence is the render when there is no date.** Empty series and unparseable series-end
  both produce zero nodes. No `Track record through —`.
- **Additive proven, not asserted.** The line sits in a wrapper beside `FreshnessChip`, not
  inside it, and F-4 fails on any byte of chip contamination.

## Task Commits

1. **Task 1: implement the flat-account arm** — `2f799d7eb` (feat)
2. **Task 2: pin the line in a falsifiable spec** — `1903d8fff` (test)

## Files Created/Modified

- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — new `SeriesRecencyLine` component; the
  masthead's freshness block wraps chip + line so the line stacks `mt-1` directly below the
  chip's date row.
- `src/app/factsheet/[id]/v2/FactsheetView.recency-line.test.tsx` — F-1, F-1b, F-2, F-3a,
  F-3b, F-4.

## C-1 contract rows, each cited

| Contract row | Where satisfied |
| --- | --- |
| Copy `Track record through {date}` | `FactsheetView.tsx` `SeriesRecencyLine` return; pinned verbatim by F-1 (literal typed in the spec, never imported) |
| Date via the factsheet's OWN formatter | `formatIsoDate(last)` — the chip's formatter; pinned by F-2 across two rendered surfaces |
| Data source = series max date | `seriesDates={payload.dates}`, last element; pinned by F-1b |
| Placement: same block, directly below the chip's date line, `mt-1`, right-aligned | wrapper `<div>` in the masthead freshness block; F-1 asserts `chip.nextElementSibling === line` and `mt-1` |
| Typography `text-caption text-text-muted`, DM Sans sentence case, not a mono eyebrow | F-1 asserts both classes present and `font-mono` / `uppercase` absent |
| Colorless, no dot | F-1 asserts no semantic tone class and no `span[aria-hidden]` |
| Unknown date ⇒ no render at all | two early returns; F-3a + F-3b |
| No threshold, chip never demoted | no date arithmetic in the component; F-4 byte-identity |
| A11y: plain flow text, no ARIA | F-1 asserts `role` and `aria-live` are absent |

## RED-witness evidence (verbatim observed output)

Baseline: `src/app/factsheet/[id]/v2/FactsheetView.tsx` byte backup taken to the scratchpad,
`shasum -a 256` = `6350f2109931d118081c33069e4aca058f4677d3d3d355e8bcc31c15e98efdf8`. After
**every** restore the same digest was re-measured and matched, and after the last restore
`git diff --stat` was empty. `git checkout --` was never used.

Green baseline before neutering: `Test Files 1 passed (1) / Tests 6 passed (6)`.

**Neuter 1 — copy string changed to "Track record up to {formatted}"** → `Tests 4 failed | 2 passed (6)`

```
FAIL … > F-1: renders the exact copy, keyed on the series' last point, in the muted caption tier
AssertionError: recency line did not render: expected null not to be null
FAIL … > F-1b: the date follows the SERIES, not `computedAt` — the whole point of the line
AssertionError: recency line did not render: expected null not to be null
FAIL … > F-2: renders the date BYTE-IDENTICALLY to the chip's date line one row above
AssertionError: expected null not to be null
FAIL … > F-4: FreshnessChip serializes byte-identically with and without the line
AssertionError: expected null not to be null
```

**Neuter 2 — data source swapped to `computedAt`** (`seriesDates={[payload.computedAt]}`) → `Tests 4 failed | 2 passed (6)`

```
FAIL … > F-1b: the date follows the SERIES, not `computedAt` — the whole point of the line
AssertionError: expected 'Track record through Aug 20, 2026' to be 'Track record through May 6, 2026' // Object.is equality
Expected: "Track record through May 6, 2026"
Received: "Track record through Aug 20, 2026"
FAIL … > F-3a: renders NO line at all when the series is empty — absence, not a placeholder
AssertionError: expected <p …(1)></p> to be null
FAIL … > F-3b: renders NO line when the series' last date does not parse
AssertionError: expected <p …(1)></p> to be null
FAIL … > F-4: FreshnessChip serializes byte-identically with and without the line
AssertionError: expected <p …(1)></p> to be null
```

This is the load-bearing witness: the exact dishonesty the requirement exists to kill is
mechanically detected, and it is detected by a *value* difference, not by absence.

**Neuter 3 — second formatter on the line** (`formatIsoDate` → `isoToYmd`) → `Tests 3 failed | 3 passed (6)`

```
FAIL … > F-2: renders the date BYTE-IDENTICALLY to the chip's date line one row above
AssertionError: expected '2026.05.06' to be 'May 6, 2026' // Object.is equality
Expected: "May 6, 2026"
Received: "2026.05.06"
FAIL … > F-1: … expected 'Track record through 2026.05.06' to be 'Track record through May 6, 2026'
FAIL … > F-1b: … expected 'Track record through 2026.05.06' to be 'Track record through May 6, 2026'
```

Both compared strings were read out of the DOM — `'2026.05.06'` from the recency line,
`'May 6, 2026'` from the chip's date row. A self-referential oracle would have been green here.

**Neuter 4 — unknown-date omission replaced with a placeholder** (em-dash guard deleted and
`!last` returning `Track record through —`) → `Tests 3 failed | 3 passed (6)`

```
FAIL … > F-3a: renders NO line at all when the series is empty — absence, not a placeholder
AssertionError: expected <p …(1)></p> to be null
FAIL … > F-3b: renders NO line when the series' last date does not parse
AssertionError: expected <p …(1)></p> to be null
FAIL … > F-4: FreshnessChip serializes byte-identically with and without the line
AssertionError: expected <p …(1)></p> to be null
```

**Neuter 5 — the line moved INSIDE `FreshnessChip`** (chip given a `seriesDates` prop and
rendering the line in its own subtree) → `Tests 2 failed | 4 passed (6)`

```
FAIL … > F-4: FreshnessChip serializes byte-identically with and without the line
AssertionError: expected '<div><div class="flex items-center ju…' to be '<div><div class="flex items-center ju…' // Object.is equality
FAIL … > F-1: renders the exact copy, keyed on the series' last point, in the muted caption tier
AssertionError: expected null to be <p …(1)></p> // Object.is equality
```

This is why the wrapper exists. Putting the line inside the chip is the shorter diff and the
one that silently breaks D-162-2's additive contract; F-4 turns that into a build failure.

## Verification run

| Gate | Result |
| --- | --- |
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run "src/app/factsheet/[id]/v2/"` | 35 files / 305 tests passed |
| `npx vitest run "…FactsheetView.recency-line.test.tsx"` | 6/6 passed |
| `npx vitest run src/__tests__/` (repo-wide contract + guard specs — I edited `src/`) | 100 files passed, 17 skipped; 1265 passed, 262 skipped |
| `npx eslint --no-cache` on both touched files | clean |
| census verdict grep | `HONEST-02 VERDICT: flat-account` |

`node_modules` was symlinked to the main checkout before any of this, and
`npx vitest --version` → `vitest/4.1.10`, `npx tsc --version` → `6.0.3` — i.e. the repo's own
toolchain, not downloaded substitutes.

The 262 skipped tests in `src/__tests__/` are pre-existing (e2e/env-gated suites); this plan
adds no skip and disables nothing.

## Decisions Made

1. **The line lives in a wrapper, not inside `FreshnessChip`.** UI-SPEC C-1 says "the block is
   the chip", which reads as licence to render inside it — but D-162-2 also says the chip is
   byte-untouched, and F-4 is the plan's own stated proof of that. Both cannot hold if the
   line is a chip child. I resolved in favour of the byte-identity contract and made the
   pairing a wrapper's job. Visual result is identical (the line is the chip's immediate
   sibling, `mt-1`, inheriting the block's right alignment).
2. **The unknown-date guard keys on `formatIsoDate`'s own em-dash sentinel** rather than a
   second `new Date()` parse, so one decision — the formatter's — governs both whether the
   date is known and how it renders.
3. **HONEST-02 was NOT marked complete.** See below.

## Deviations from Plan

**1. [Rule 3 - Blocking] The census is not in this worktree**

- **Found during:** Task 1 precondition
- **Issue:** The plan's `<precondition>` and `<verify>` grep target
  `.planning/phases/162-.../162-CENSUS.md` relative to the executing worktree. The census is
  plan 162-01's artifact and lives in that agent's worktree; the path does not exist here.
- **Fix:** Read it read-only at its absolute path in the sibling worktree and ran the verdict
  grep there. Nothing was written to, edited in, or git-operated against that path.
- **Verification:** `grep -E "HONEST-02 VERDICT: (flat-account|derive-gap)"` → `flat-account`.
- **Impact:** None on the delivered code. Worth noting for the phase close: this plan's
  committed artifacts do not contain the census, so the verdict citation in this SUMMARY is
  the only in-tree trace of the authority until the wave merges.

**2. [Scope — not a code change] Two extra tests beyond the plan's F-1..F-4**

- F-1b (date follows the series, not `computedAt`) and F-3b (unparseable series end) were
  added. F-1 alone could not distinguish the two data sources, because the fixture
  deliberately puts `computed_at` and the series end on the same day so F-2 can compare them.
  Without F-1b the single most important claim in the requirement had no failing test.

**Total deviations:** 1 auto-fixed (Rule 3) + 1 additive test-scope extension.
**Impact:** No scope creep into other surfaces; both touched files are this plan's own.

## Correction to the census — a claim I measured and disproved

The census records, as a standing finding, a fleet-wide `compute_analytics` drought since
2026-05-27. **That framing is void and must not be re-filed.** PROD was queried directly: the
`compute_analytics` job kind has 30 rows, 100% `failed_final`, zero successes ever. It was
superseded by `compute_analytics_from_csv` (14 done) and `derive_broker_dailies` (14 done),
both of which ran within hours, and `strategy_analytics` shows 7 fresh computations in the
last 7 days, the newest hours old. The pipeline is healthy; `compute_analytics` is a retired
kind from before the backbone unification.

This **strengthens** the flat-account verdict rather than weakening it. The census's
derive-gap trigger — "0 `compute_analytics` jobs since series end" — was never a meaningful
signal, because that kind runs for nobody. Any part of the census or this plan that leans on
that trigger is void. The verdict survives on rows (2)–(4), which do not depend on it.

*(This measurement was handed to me by the orchestrator; I did not re-run the PROD queries
myself and am recording it as attributed evidence, not as my own measurement.)*

## HONEST-02 disposition — NOT marked complete

`requirements.mark-complete HONEST-02` was **deliberately not run**, and the checkbox is left
open. The requirement reads:

> The factsheet freshness **badge** reflects series recency — a strategy whose return series
> ended 89 days ago cannot read FRESH; investigate (flat account vs derive gap) before fixing.

D-162-2 deliberately leaves the badge itself untouched and adds a neighbouring line instead.
After this plan the *surface* states the series' end; the *badge* still computes from
`computed_at` and can still read FRESH on a dead track. Whether that satisfies the
requirement's wording is a phase-close judgment spanning 162-01 (the investigate half) and
this plan (the fix half) — not a call this executor should make unilaterally, and a sibling
plan already ticked it prematurely tonight. It stays open for the close.

## Issues Encountered

None. No blocked commands, no auth gates, no package installs.

## What I could not verify

- **The full vitest suite.** I ran the factsheet v2 directory and all of `src/__tests__/`
  (which is where the repo-wide contract scans live) — both green — but a file-scoped run
  cannot clear the whole suite. The wave gate owns that claim.
- **A real browser render.** All assertions are jsdom. Typography tier, adjacency and right
  alignment are asserted via classes and DOM order, not pixels; no screenshot was taken. The
  D1 coverage row is marked `human_judgment: true` for exactly this reason.
- **That okx holds no newer fills.** Inherited from the census and restated here: the
  watermark evidence is store-side. It proves we never received a newer fill across 111 days
  of error-free polling; it is not a venue-side attestation.
- **Production behaviour of the line.** Nothing was shipped, pushed, merged, or deployed.

## Next Phase Readiness

Nothing is handed to plan 162-08 by this plan — the derive-gap arm was not taken, so there is
no routing line for TODOS.md. The phase close inherits two items: the HONEST-02 checkbox
decision above, and the correction to the census's `compute_analytics` drought finding.

## Self-Check: PASSED

- `src/app/factsheet/[id]/v2/FactsheetView.recency-line.test.tsx` — FOUND
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — FOUND
- commit `2f799d7eb` — FOUND
- commit `1903d8fff` — FOUND
