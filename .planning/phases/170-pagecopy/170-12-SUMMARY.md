---
phase: 170-pagecopy
plan: 12
subsystem: ui
tags: [factsheet, control-bar, share-link, design-voice, decisions-log]
status: complete

requires:
  - phase: 169
    provides: "169-04 FactsheetView.tsx and 169-10 DESIGN.md on origin/main (gate re-run, PAGETRUTH_ON_MAIN_OK)"
  - phase: 170
    provides: "170-11 KpiStrip ladder and SectionNav census (left untouched)"
provides:
  - "Factsheet ControlBar action buttons in the DM Sans interactive voice (text-caption)"
  - "Action order Display, Reset view, Compare strategies, share control, Revoke link, ComparatorPicker"
  - "OwnerUnpublishedNotice optional children row; OwnerUnpublishedPanel's share controls render inside the notice box"
  - "Source-lint pins for the ControlBar voice, SectionNav mono voice, LEVERAGE label and the notice row"
  - "Two DESIGN.md Decisions Log rows dated 2026-09-27 (grey chip contrast; ControlBar voice)"
affects: [170-13, 170-14]

actuals:
  tokens: 4900
  tasks: 3
  commits: 2

plan_head_before: d371639936cb38ccd0adc0bdcae285f59c4d668a
plan_head_after: 2e835aea737f18b30ee9a79122b985b6e64f7570

tech-stack:
  added: []
  patterns:
    - "A notice that owns controls takes them as a children row inside its own box, so the no-children mount stays byte-identical"

key-files:
  created: []
  modified:
    - src/app/factsheet/[id]/v2/FactsheetView.tsx
    - src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx
    - tests/visual/strategy-v2-type-scale.test.ts
    - DESIGN.md

key-decisions:
  - "Phase 170 C1-F1: factsheet ControlBar buttons use text-caption (DM Sans, sentence case); SectionNav and the LEVERAGE label keep the mono voice"
  - "Phase 170 C1-F3: OwnerUnpublishedNotice gains an optional children slot; the panel's share controls are that slot, no negative-margin wrapper"
  - "Reset 1x converted with the enumerated buttons (not in the plan's list) so the leverage group does not keep the mono pill beside a DM Sans Reset view"

metrics:
  duration: "about 10 minutes"
  completed: 2026-09-30
---

# Phase 170 Plan 12: Factsheet ControlBar voice and owner-notice share row Summary

The factsheet's ControlBar buttons now speak the DM Sans `text-caption` voice while SectionNav keeps the mono eyebrow voice, the private-link control is the last action before ComparatorPicker, and the owner-pending share controls are the notice's own last row instead of a row pulled up under it by `-mt-4`.

## Task 1: gate and re-read at HEAD d37163993

Gate output (verbatim):

```
169 169-04 src/app/factsheet/[id]/v2/FactsheetView.tsx 3357a2eb5824c0f5f4381beff348f942a5680f7a
169 169-10 DESIGN.md 3357a2eb5824c0f5f4381beff348f942a5680f7a
PAGETRUTH_ON_MAIN_OK
```

Class strings recorded before any edit (FactsheetView.tsx at d37163993):

| Site | Class string at HEAD |
|------|----------------------|
| ControlBar pill buttons (Display `<summary>`, Reset view, Reset 1x, ShareLinkButton, ShareRevokeControl Revoke link / Revoke, Compare strategies) | `px-2.5 py-1 text-micro font-mono uppercase tracking-wider rounded-sm border bg-surface-subtle text-text-2 border-border hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent min-h-[28px] pointer-coarse:min-h-[44px]` (revoke arms use `text-negative`; share adds `disabled:opacity-60`; Compare adds `inline-flex items-center`; Display prefixes `list-none cursor-pointer`) |
| ShareRevokeControl Keep link | `px-2.5 py-1 text-micro font-mono uppercase tracking-wider rounded-sm text-text-2 hover:bg-surface ...` (no border) |
| SectionNav `<ul>` | `flex items-center gap-1 px-1 text-micro font-mono uppercase tracking-[0.18em]` |
| LEVERAGE label | `text-micro font-mono uppercase tracking-wider text-text-muted` |
| Owner-pending share wrapper | `-mt-4 mb-2 flex flex-wrap items-center gap-2` (sibling after `OwnerUnpublishedNotice`) |
| Action order | Display, Reset view, ShareLinkButton, ShareRevokeControl, Compare strategies, ComparatorPicker |

Counts before: `text-caption` 22, `-mt-4` 1, mono pill run `text-micro font-mono uppercase tracking-wider rounded-sm` 8. After: `text-caption` 30, `-mt-4` 0, mono pill run 0.

Type-scale pins to update: **none existed.** `tests/visual/strategy-v2-type-scale.test.ts` linted only `src/components/strategy-v2/**` and six chart files and never named FactsheetView, `font-mono` or `uppercase`. The pins were added (see Deviations).

Decisions Log insertion point: the table under `## Decisions Log`, after its last row (`| 2026-08-09 | Dense tables lose their px cap ...`). Phase 169 added no Decisions Log row (its DESIGN.md change was a Numbers Contract row), so no 169 row sits in the log to follow or protect.

## Task 2: ControlBar voice, order, notice row

- The mono pill run was replaced by `text-caption` on all 8 buttons. Weight, border, `rounded-sm`, `bg-surface-subtle`, touch heights, focus outline and colour are unchanged.
- The Compare strategies link moved ahead of the share controls (C1-F2). The share control stays inside ControlBar (`flex flex-wrap`), bordered secondary, never accent-filled.
- `OwnerUnpublishedNotice` takes an optional `children` rendered as the last child of its `<section role="note">`. Without children the markup is unchanged (the full-factsheet mount at the owner lane). `OwnerUnpublishedPanel` passes `<div className="mt-3 flex flex-wrap items-center gap-2">` with ShareLinkButton and, while live, ShareRevokeControl. `shareNote` stays the panel's last child with `mt-2`.

**RED at HEAD** (new pins against the d37163993 file, byte copy swapped in and restored with `cp`, `cmp` confirmed):

```
× no factsheet action button carries the mono pill voice          expected 8 to be +0
× the action buttons carry the DM Sans caption voice ...           expected 0 to be greater than or equal to 7
× the owner-pending share controls sit inside the notice ...      not to contain '-mt-4'
× FULL-RENDER-NO-NOTE ...                                          expected …(2) to have a length of 1 but got 2
Tests  4 failed | 47 passed (51)
```

**Neuter RED** (Reset view alone put back to `text-micro font-mono uppercase tracking-wider`, restored from the byte backup):

```
× no factsheet action button carries the mono pill voice          expected 1 to be +0
× the action buttons carry the DM Sans caption voice ...           expected 6 to be greater than or equal to 7
Tests  2 failed | 7 passed (9)
```

**GREEN:** `npx vitest run tests/visual/strategy-v2-type-scale.test.ts "src/app/factsheet/[id]/v2/"` gave 60 files, 570 tests passed. Adjacent consumers (`factsheet-share/`, strategies share-affordance, og page-agreement, phase-52 guards, freshness two-surfaces, scenario empty-render) gave 12 files, 115 passed. `npx tsc --noEmit -p .` exit 0. `eslint` on the three touched source/test files exit 0.

## Task 3: DESIGN.md rows

Two rows appended, both headed `2026-09-27`:

1. "Grey data-state chips move their text to `text-secondary` on `bg-track` (6.87 : 1) ... `text-muted` on `track` measured 4.34 : 1, below AA at 11 px. Tone family unchanged (neutral); no global token change." The four chip sites were confirmed at HEAD to already carry `text-text-secondary bg-track` (`CoverageStateChip` `manually-excluded`, `no-series`; `StrategyTable` both data-state chips).
2. "Factsheet ControlBar actions use the DM Sans interactive voice; SectionNav keeps the mono eyebrow voice."

The rows use the log's three-column table shape (date, decision, rationale), with the operative sentences unchanged. `git diff -- DESIGN.md` shows only 2 insertions, 0 deletions. Every test that reads DESIGN.md (20 files, including `design-changelog-table-shape`, `design-token-drift`, `trust-tier-tokens`) passed: 877 tests.

## Commits

| Task | Commit | Message |
|------|--------|---------|
| 1 | none | read-only gate |
| 2 | c66f7c61c | feat(170-12): factsheet ControlBar speaks the DM Sans button voice; share controls sit inside the owner notice |
| 3 | 2e835aea7 | docs(170-12): DESIGN.md Decisions Log records the grey-chip contrast and the factsheet ControlBar voice |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing pins] The type-scale file had no ControlBar pins to update**
- **Found during:** Task 1
- **Issue:** The plan says to update the `font-mono uppercase` pins in `tests/visual/strategy-v2-type-scale.test.ts`. There were 0 (measured at d37163993).
- **Fix:** Added a dated `describe` block that source-lints FactsheetView.tsx. It checks that the mono pill run is absent, that at least 7 bordered `text-caption` buttons exist, that SectionNav and the LEVERAGE label keep their mono class strings, and that `-mt-4` is gone while the `mt-3 flex flex-wrap items-center gap-2` row is present.
- **Commit:** c66f7c61c

**2. [Rule 1 - Test tracks the old structure] FULL-RENDER-NO-NOTE pinned the hung-below wrapper**
- **Found during:** Task 2
- **Issue:** `page.owner-compute-state.test.tsx` asserted the panel has 2 children with a trailing DIV. C1-F3 removes that DIV by design. The file is outside `files_modified` but inside the plan's verify glob.
- **Fix:** Now asserts 1 child (the SECTION) and that the note contains the share button. It has a dated comment and was observed RED on the pre-change file.
- **Commit:** c66f7c61c

**3. [Rule 2 - Consistency] Reset 1x converted too**
- **Found during:** Task 2
- **Issue:** The leverage group's `Reset 1×` button had the same mono pill class. It is not in C1-F1's enumerated list, but it is a ControlBar button, and DESIGN.md requires DM Sans for buttons. Left mono, it would sit as a mono pill in the same bar as a DM Sans `Reset view`.
- **Fix:** Converted with the others. The LEVERAGE label stays mono per the spec.
- **Commit:** c66f7c61c

## Findings (for the orchestrator)

- **Spacing below the owner-pending box grows.** `OwnerUnpublishedNotice` keeps `mb-6` (unchanged by spec), and `shareNote` keeps `mt-2`. Sibling margins collapse to 24 px, so the recipient-view note now sits 24 px below the box. Before, it sat 8 px below the controls row (`mb-2` / `mt-2`). The spec's classes are followed literally. If the note should read as attached to the box, a visual pass can decide. Not user-facing data.
- **Button type grows from `text-micro` to `text-caption`** (10-11 px to 12-13 px fluid). The ControlBar is `flex flex-wrap`, so wider labels wrap and do not overflow. The touch heights (`min-h-[28px]`, `pointer-coarse:min-h-[44px]`) are unchanged.
- No e2e spec references the uppercase text or the order of these controls (grep over `e2e/` for the labels returned nothing).

## Seeded e2e expectations (need CI)

| Row family | Expectation | Why |
|------------|-------------|-----|
| `e2e/target-size.spec.ts` factsheet controls | pass | touch heights unchanged |
| axe rows on `/factsheet/[id]` (owner, published, share token) | pass | colours unchanged; buttons inside `role="note"` are allowed content |
| `e2e/layout-narrow.spec.ts` factsheet KPI (170-11) | pass | KpiStrip untouched |
| `e2e/layout-narrow.spec.ts` composed scenario N-FOOT / N-SCN | still fail, as in run 36755290085 | deferred-items 1 and 2 (owner 170-04 and the 170-01 walker), not this plan's files |
| Known flakes (ci-anti-skip-gate, MultiKeyConnectStep, drift-check D-04) | may flake | pass alone |

## Threat Flags

None. Share mint, revoke and payload are unchanged; only classes, order and DOM nesting moved.

## Known Stubs

None.

## Self-Check: PASSED

- FOUND: src/app/factsheet/[id]/v2/FactsheetView.tsx, tests/visual/strategy-v2-type-scale.test.ts, DESIGN.md, src/app/factsheet/[id]/v2/page.owner-compute-state.test.tsx
- FOUND: c66f7c61c, 2e835aea7
