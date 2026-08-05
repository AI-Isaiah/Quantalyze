---
phase: 148-own-owner-factsheet-without-cache-disclosure
plan: 01
subsystem: ui
tags: [react, tailwind, factsheet, vitest, tdd, accessibility]

# Dependency graph
requires:
  - phase: 43-02 (GUARD-02 permanent byte-identity gate)
    provides: FactsheetBody.scenario-mode.test.tsx — the additive-prop proof obligation this plan had to keep green
  - phase: 40 (scenarioMode additive prop)
    provides: the FactsheetBodyOptions additive-field precedent (doc-comment convention + default-off discipline)
provides:
  - "FactsheetBodyOptions.viewerNotice?: 'owner_unpublished' — additive, default-off render prop threaded FactsheetView → FactsheetShell → FactsheetBody"
  - "OwnerUnpublishedNotice — the UI-SPEC owner-lane banner, first child of article#factsheet-main, above the masthead"
  - "FactsheetView.owner-notice.test.tsx — presence / DOM-order / zero-node-absence / token proofs"
affects: [148-03 (page.tsx owner lane wires viewerNotice), 148-04 (cache-isolation invariant), 149 (NAV-01 ranking may extend the notice union)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lane state travels as a RENDER prop, never as a cached-payload field (keeps factsheet-v2-payload-v6 shape frozen)"
    - "Discriminated string union instead of a boolean for viewer-notice kinds — later phases add members, not props"

key-files:
  created:
    - "src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx"
  modified:
    - "src/app/factsheet/[id]/v2/FactsheetView.tsx"

key-decisions:
  - "viewerNotice is a render prop on FactsheetBodyOptions, NOT a FactsheetPayload field — lane state must never enter the object the shared public cache serves (UI-SPEC:112); this also avoids the v6→v7 shape bump"
  - "Banner rendered as an explicit first child of article#factsheet-main rather than through the existing topSlot, because topSlot renders BELOW the masthead (UI-SPEC:97)"
  - "String union ('owner_unpublished') over a boolean so Phase 149/152 can add notice kinds without a second prop"
  - "Reused the NotEnoughDataPanel data-panel treatment with the three UI-SPEC deltas (text-caption body, role=note + aria-label, mb-6, h2) rather than inventing a new banner primitive"
  - "Left NotEnoughDataPanel's text-micro body untouched (Rule 3, surgical) — the caption override applies only to the new load-bearing disclosure"

patterns-established:
  - "Additive-prop byte-identity: every new FactsheetBodyOptions field carries a doc-comment naming who passes it and why the default keeps other call sites byte-identical; absence must produce zero nodes, not a hidden node"
  - "Oracle independence for copy contracts: UI-SPEC copy literals are typed into the test, never imported from the component, so a copy rewrite cannot pass"

requirements-completed: [OWN-02]

# Metrics
duration: 12min
completed: 2026-08-05
---

# Phase 148 Plan 01: Owner-lane visibility notice (capability) Summary

**Additive `viewerNotice="owner_unpublished"` prop on `FactsheetBodyOptions` plus the `OwnerUnpublishedNotice` banner that renders as the first child of `article#factsheet-main` — default-off, zero new DOM nodes on all three existing call sites, and no field added to the cached `FactsheetPayload`.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-08-05T09:03:00Z
- **Completed:** 2026-08-05T09:15:00Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `FactsheetBodyOptions.viewerNotice?: "owner_unpublished"` threaded through all three hops (`FactsheetView` → `FactsheetShell` → `FactsheetBody`), default `undefined`.
- `OwnerUnpublishedNotice` renders the UI-SPEC banner verbatim: `role="note"` / `aria-label="Visibility notice"`, `mb-6 border border-border bg-surface-subtle px-4 py-3`, `h2` eyebrow at `text-caption font-semibold uppercase tracking-[0.18em]`, body at `text-caption text-text-muted`, no icon, no dismiss control, no print-hiding class.
- Published lane proven byte-identical: the PERMANENT GUARD-02 gate passes **unmodified** (zero-line diff on `FactsheetBody.scenario-mode.test.tsx`), and the new file asserts `[role="note"]` is `null` both when the prop is absent and when it is explicitly `undefined`.
- Lane state stayed off `FactsheetPayload` — no `factsheet-v2-payload-v6` → `v7` bump, so the shared public cache shape and its single `revalidateTag` invalidator are untouched.

## Task Commits

1. **Task 1 (RED): failing owner-notice test** — `e44adcb7` (test)
2. **Task 1 (GREEN): viewerNotice prop + OwnerUnpublishedNotice** — `1f299df9` (feat)
3. **Task 2: byte-identity + regression battery** — verification-only, no source change (nothing to commit; `git status` clean after the battery)

No REFACTOR commit: the GREEN implementation is 17 lines of JSX reusing an existing primitive; there was nothing to clean up.

### RED evidence (recorded before implementation)

```
FAIL  src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx >
      viewerNotice="owner_unpublished" renders the role=note banner with the verbatim UI-SPEC copy
AssertionError: expected null not to be null
 ❯ src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx:122:22
    121|     const note = container.querySelector('[role="note"]');
    122|     expect(note).not.toBeNull();
```

3 of 4 tests failed at RED. The 4th (the absence proof) passed at RED **by design** — it must be green both before and after, because it pins the published lane's zero-node behavior.

## Files Created/Modified

- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — added the `viewerNotice` field to `FactsheetBodyOptions` (with the `scenarioMode`-convention doc-comment), threaded it through the three-hop chain, added the private `OwnerUnpublishedNotice` component, and rendered it conditionally as the first child of `article#factsheet-main` above `{!hideHeader && <FactsheetHeader …>}`.
- `src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx` — 4 tests: verbatim-copy presence, DOM order (banner is `article.firstElementChild` and `compareDocumentPosition` puts the masthead after it), zero-node absence (absent prop AND explicit `undefined`), and the token treatment (`mb-6` / `border-border` / `bg-surface-subtle`, `h2` classes, `text-caption` body, `not.toContain("text-micro")`, `not.toContain("print:hidden")`, no `<button>`).

## Decisions Made

See `key-decisions` in the frontmatter. The load-bearing one: the notice is a **render prop**, structurally excluded from `FactsheetPayload`, which is what keeps owner-lane knowledge out of the shared public cache (threat T-148-05).

## Deviations from Plan

None — plan executed exactly as written.

One cosmetic judgment inside the plan's own instruction: the component's doc-comment originally used the literal `print:hidden` while explaining its deliberate absence. Because the plan's acceptance criterion is a **grep** for that literal, the comment was reworded to "carries no print-hiding class" so a greppable audit stays unambiguous. No behavior change; the className assertion is the authoritative proof.

## Verification Evidence

| Gate | Command | Result |
|------|---------|--------|
| New tests | `npx vitest run "…/FactsheetView.owner-notice.test.tsx" --no-file-parallelism` | 4/4 passed |
| GUARD-02 (PERMANENT, unmodified) | `npx vitest run "…/FactsheetBody.scenario-mode.test.tsx" "…/FactsheetView.owner-notice.test.tsx"` | 10/10 passed, 2 files |
| GUARD-02 file zero-diff | `git diff <base> HEAD -- "…/FactsheetBody.scenario-mode.test.tsx" \| wc -l` | `0` |
| Whole v2 suite | `npx vitest run "src/app/factsheet/[id]/v2" --no-file-parallelism` | 32 files / 272 tests passed |
| Other two consumer suites | `npx vitest run "…/widgets/performance" "…/AllocationDashboardV2.staleness.test.tsx"` | 16 files / 173 tests passed |
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | 0 errors (1 pre-existing `react-hooks/exhaustive-deps` warning in the unrelated `widgets/performance/EquityChart.tsx` — out of scope, not introduced here) |
| Diff surface | `git diff --name-only <base> HEAD` | exactly `FactsheetView.tsx` + `FactsheetView.owner-notice.test.tsx` |
| Prop grep | `grep -c viewerNotice FactsheetView.tsx` | `10` (≥ 4 required) |

## Issues Encountered

None.

## Known Stubs

None. The prop is deliberately consumer-less in this wave — plan 148-03 wires `page.tsx`'s owner lane to it in Wave 2. That is the plan's stated design (a capability landed ahead of its consumer), not an unwired stub.

## Threat Flags

None. This plan adds no network endpoint, no auth path, no file access, and no schema change. T-148-05 / T-148-05b are mitigated as planned: the notice is structurally absent from `FactsheetPayload`, and both the new absence test and the unmodified GUARD-02 gate pin the default-off render.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `viewerNotice` is ready for plan 148-03 to pass from the v2 page's Lane-B owner branch. Exact contract: `<FactsheetView payload={payload} viewerNotice="owner_unpublished" />` (also available directly on `FactsheetBody`).
- No blockers. Sibling plan 148-02 owns `page.tsx`; this plan touched neither it nor any shared orchestrator artifact (`STATE.md` / `ROADMAP.md` untouched).

## Self-Check: PASSED

- `src/app/factsheet/[id]/v2/FactsheetView.owner-notice.test.tsx` — FOUND
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — FOUND (modified)
- `.planning/phases/148-own-owner-factsheet-without-cache-disclosure/148-01-SUMMARY.md` — FOUND
- commit `e44adcb7` — FOUND
- commit `1f299df9` — FOUND

---
*Phase: 148-own-owner-factsheet-without-cache-disclosure*
*Completed: 2026-08-05*
