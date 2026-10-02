---
phase: 58-coverage-legibility-disclosure
plan: 03
subsystem: ui
tags: [react, tailwind-v4, scenario-composer, coverage-window, a11y, mini-gantt, localStorage, ssr-safe]

# Dependency graph
requires:
  - phase: 58 (plan 01)
    provides: "the composer. storage prefix (registered in storage-namespaces.ts + SignOutButton KNOWN_APP_KEYS), BlendHeader (data-testid=scenario-blend-header), the coverageEligible/selectedSpanById/fullRangeWindow/applyWindow memos threaded read-only"
  - phase: 58 (plan 02)
    provides: "the auto-excluded amber chip + include-cost affordance already wired (last-writer serialization on the shared ScenarioComposer.tsx)"
  - phase: 57 (window control & auto-toggle state machine)
    provides: "coverageWindow, fullRangeWindow (unionOf), applyWindow, the :1813 desync guard, the coverage-window control container"
  - phase: 55 (frozen blend engine)
    provides: "scenario.ts member_count + effective_* (the honest divisor/window BlendHeader reads); scenario-window.ts unionOf"
provides:
  - "CoverageTimeline.tsx (COVERAGE-01) — collapsed-by-default mini-gantt: one bar per selected strategy vs the union axis, active-window band overlay, accent/amber bars agreeing with the row chips, each aria-labelled; utcEpoch(parseIsoDay) date->x scale"
  - "DefaultChangeNote.tsx (POLISH-03) — SSR-safe one-time union->intersection note persisting dismissal at the composer. key via useCrossTabStorage; Show-full-range escape hatch"
  - "ScenarioComposer wiring: timelineRows + intersectionTruncatesUnion memos from existing engine axes; note above the blend header, timeline after the window control"
  - "composer-axe.spec.ts extended in place with blend-header + expanded-coverage-timeline anchors before the composed analyze()"
affects: [59 (window persistence — the note/timeline consume but do not persist the window), 60 (golden/e2e re-bake picks up the new gantt + note)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Presentation-only membership: the gantt receives inBlend as a prop from coverageEligible and NEVER runs the containment predicate locally — bars agree with the row chips + divisor by construction (the :1813 guard reconciles the same axis)"
    - "Timezone-stable date->x scale via utcEpoch(parseIsoDay(iso)) ONLY (never a JS Date from an ISO string); single-day union guarded against divide-by-zero (span || 1); percents clamped to [0,100]"
    - "SSR-safe one-time note = the verbatim CollapsibleSection.tsx:71-102 useCrossTabStorage + rawStringCodec<boolean> idiom, render gated on isHydrated && !dismissed && condition (no flash-of-note)"
    - "Colocated child tests exercise the REAL storage primitive against a backing localStorage Map (same idiom as CollapsibleSection.test.tsx) so the deferred-hydration gate is genuinely tested, not stubbed"
    - "Static source guards in the unit test (readFileSync + toContain/not.toContain) pin the timezone rule (no `new Date(`), no charting dep, exact key, verbatim copy, role=status not alert"

key-files:
  created:
    - "src/app/(dashboard)/allocations/components/CoverageTimeline.tsx"
    - "src/app/(dashboard)/allocations/components/CoverageTimeline.test.tsx"
    - "src/app/(dashboard)/allocations/components/DefaultChangeNote.tsx"
    - "src/app/(dashboard)/allocations/components/DefaultChangeNote.test.tsx"
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "e2e/composer-axe.spec.ts"

key-decisions:
  - "CoverageTimeline renders NO panel (returns null) when there are no rows or no union axis — not an empty collapsible shell — so the composer stays uncluttered"
  - "The active-window band overlay is aria-hidden (decorative); membership is carried on each bar's aria-label as text (WCAG-AA — color never the sole signal)"
  - "intersectionTruncatesUnion computed inline in the composer as coverageWindow narrower than fullRangeWindow (same lexicographic truncation shape BlendHeader uses); the note self-gates on it — never re-derived inside DefaultChangeNote"
  - "onShowFullRange calls only applyWindow(fullRangeWindow) — the existing Full-range preset — never a new window setter; the note never touches selected"
  - "Placement per 58-UI-SPEC: DefaultChangeNote ABOVE the blend header/window control, CoverageTimeline AFTER the window control (tertiary, collapsed)"

patterns-established:
  - "Literal acceptance-grep compliance: forbidden-pattern words (new Date(, recharts, covers(, role=alert, the raw key string) were rephrased OUT of doc comments so the plan's own greps return the expected counts — compliance with the acceptance criteria, not a scope change (the wave-1 lesson re-applied)"

requirements-completed: [COVERAGE-01, POLISH-03]

# Metrics
duration: 20min
completed: 2026-07-02
---

# Phase 58 Plan 03: Coverage Timeline + Default-Change Note Summary

**The final two disclosure surfaces: a collapsed-by-default coverage-timeline mini-gantt (COVERAGE-01) that plots each selected strategy's span against the union axis — accent/amber bars agreeing with the row chips, an active-window band overlay, a timezone-stable utcEpoch(parseIsoDay) date->x scale, every bar aria-labelled — and an SSR-safe one-time union->intersection note (POLISH-03) that shows only on real truncation, persists its dismissal at the wave-1 composer. key via useCrossTabStorage, and offers a Show-full-range escape hatch through the existing applyWindow preset; both wired into ScenarioComposer from existing engine axes (no membership re-derived, no number moved), with the composer-axe WCAG-AA scan extended in place to cover the new blend header + gantt.**

## Performance

- **Duration:** ~20 min
- **Completed:** 2026-07-02
- **Tasks:** 3
- **Files modified:** 6 (4 created, 2 modified)

## Accomplishments
- **COVERAGE-01 CoverageTimeline** — a pure presentational mini-gantt hosted in a collapsed-by-default `CollapsibleSection` ("Coverage timeline"). One `<li>` bar per selected strategy: `leftPct`/`widthPct` computed via `utcEpoch(parseIsoDay(...))` against the union axis, guarding a single-day union against divide-by-zero (`x1 - x0 || 1`) and clamping percents to [0,100]. In-blend bars are `bg-accent`; auto-excluded bars are `bg-warning-bg border-warning-border` (amber, agreeing with the row chip, never red). The active window draws as an accent-framed band overlay (`bg-accent/5`). Every bar carries an `aria-label` restating coverage dates + membership ("in blend" / "auto-excluded") as text. Union start/end endpoint labels only (no interior ticks) in `font-mono tabular-nums`.
- **POLISH-03 DefaultChangeNote** — the verbatim `CollapsibleSection` persistence idiom swapped to a boolean: `rawStringCodec<boolean>` + `useCrossTabStorage({ key: "composer.coverageDefaultChangeNoteDismissed", initial: false, sentryArea: "composer.default-change-note" })`. Renders ONLY when `isHydrated && !dismissed && intersectionTruncatesUnion` (no flash-of-note for a returning-dismissed user; never when spans coincide). Verbatim copy `Now showing the common period where all {N} overlap · Show full range` with the inline accent "Show full range" text-button and a persistent `×` dismiss. Root is `role="status" aria-live="polite"` (never alert). No raw localStorage (B25).
- **Composer wiring** — added `timelineRows` (selected strategies mapped to `{ id, name, span: selectedSpanById.get(id), inBlend: coverageEligible[id] === true }`) and `intersectionTruncatesUnion` (coverageWindow narrower than fullRangeWindow) memos from the existing engine axes — membership never re-derived (the `covers()` predicate is not called; the desync guard stays quiet). `DefaultChangeNote` renders above the blend header; `CoverageTimeline` (collapsed) after the coverage-window control. `onShowFullRange` = `applyWindow(fullRangeWindow)`.
- **Extended composer-axe anchors** — added blend-header (`[data-testid="scenario-blend-header"]`) + coverage-timeline (expand the "Coverage timeline" `<summary>`, gate on `scenario-coverage-timeline-body`) visible-anchor gates before the single composed `analyze()`, so the whole-`<main>` WCAG-AA scan covers the new surfaces. Extended IN PLACE — no new spec, no HAS_SEED_ENV const, no ci.yml entry (FLOW-01 does not apply).

## Task Commits

Each task committed atomically (TDD RED→GREEN folded per task for Tasks 1-2):

1. **Task 1: CoverageTimeline mini-gantt (COVERAGE-01) + colocated test** — `9ee799ef` (feat)
2. **Task 2: DefaultChangeNote one-time note (POLISH-03) + colocated test** — `064e9903` (feat)
3. **Task 3: Wire both into composer; extend composer-axe anchors** — `3fb8cbed` (feat)

_Note: `.planning/` is gitignored in this repo (commit_docs=false); no docs metadata commit is made — the three code commits above are the deliverable._

## Files Created/Modified
- `src/app/(dashboard)/allocations/components/CoverageTimeline.tsx` — collapsed mini-gantt; `utcEpoch(parseIsoDay)` date->x scale; accent/amber bars + active-window band overlay; per-bar aria-label; union endpoint labels
- `src/app/(dashboard)/allocations/components/CoverageTimeline.test.tsx` — bar-per-row, accent-vs-amber encoding, aria-label content, collapsed-default, single-day div-by-zero guard, empty-rows null, static timezone/no-charting-dep guard
- `src/app/(dashboard)/allocations/components/DefaultChangeNote.tsx` — SSR-safe useCrossTabStorage boolean note; verbatim copy; Show-full-range escape hatch + × dismiss; role=status
- `src/app/(dashboard)/allocations/components/DefaultChangeNote.test.tsx` — hidden/shown/role=status/escape-hatch/dismiss-persists-across-remount (real hydration gate) + static guard (no raw localStorage, exact key, verbatim copy, role=status not alert)
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — imports + `timelineRows`/`intersectionTruncatesUnion` memos; DefaultChangeNote above the blend header; CoverageTimeline after the window control
- `e2e/composer-axe.spec.ts` — blend-header + expanded-coverage-timeline anchors before the composed analyze() (in place)

## Decisions Made
- **Null panel on empty input**: CoverageTimeline returns `null` when `rows.length === 0 || !unionWindow` (not an empty collapsible shell), keeping the composer uncluttered.
- **Band overlay is aria-hidden**: the active-window band is decorative; membership is text on each bar's aria-label (WCAG-AA — color is never the sole signal).
- **Truncation gate computed in the composer**: `intersectionTruncatesUnion` (coverageWindow narrower than fullRangeWindow, lexicographic compare — the same shape BlendHeader uses) is threaded into DefaultChangeNote, which self-gates on it — never re-derived inside the note.
- **Escape hatch is the existing preset**: `onShowFullRange` calls only `applyWindow(fullRangeWindow)`; the note never touches `selected` and adds no new window logic.

## Deviations from Plan

None — plan executed exactly as written. The recurring wave-1 adjustment re-applied: forbidden-pattern words (`new Date(`, `recharts`, `covers(`, `role="alert"`, and the raw `composer.coverageDefaultChangeNoteDismissed` string) were rephrased out of doc comments so the plan's own literal acceptance greps return the expected counts (e.g. `new Date(` = 0, `covers(` in the composer diff = 0, the key grep = 1). This is compliance with the plan's acceptance criteria, not a scope change; membership is still correctly threaded (`coverageEligible[id] === true`) and the timezone rule still holds (`utcEpoch` = 5 uses).

## Issues Encountered
- **Static-guard test tripped on `import.meta.url`**: the first draft read the source via `fileURLToPath(new URL("./…", import.meta.url))`, which vitest rejected ("The URL must be of scheme file"). Resolved by `path.resolve(process.cwd(), "src/…/CoverageTimeline.tsx")`. Caught by the RED→GREEN loop before commit.
- **Bar-class assertion on the wrong node**: the first CoverageTimeline test asserted `bar.innerHTML` for `bg-accent`, but the `data-testid` bar IS the leaf fill div (empty innerHTML). Fixed to assert `bar.className`. Same for the single-day div-by-zero guard (assert the inline `style`, not innerHTML).
- **Interpolated count split across a mono span**: `getByText(/all 3 overlap/)` could not match because `{memberCount}` renders in its own `<span>`; switched to asserting the note's composed `textContent`.
- **Doc-comment grep self-trips**: the CoverageTimeline test's own `not.toContain("recharts")` / `not.toContain("new Date(")` static guards initially failed on my own JSDoc mentioning those words — rephrased the prose (the wave-1 lesson).

## Threat Flags
None — no new security-relevant surface. Both components render only strings (strategy names, ISO dates, N) as React text children + aria-label props (auto-escaped; no `dangerouslySetInnerHTML`). The threat register's `mitigate` dispositions are all satisfied: T-58-07/08 (localStorage poison / sign-out survival) inherited from `useCrossTabStorage` + the wave-1 `composer.` prefix registration (SignOutButton purge test green); T-58-10 (timezone off-by-one) by the `utcEpoch(parseIsoDay)` scale + the static `new Date(` = 0 guard. T-58-SC (installs) N/A — zero new dependency.

## Known Stubs
None. `timelineRows` derives from real strategy spans + the real `coverageEligible` axis; `DefaultChangeNote` persists to the real registered key; `onShowFullRange` wires to the real `applyWindow`. No hardcoded empty values, no placeholder text, no unwired data source.

## Verification
- `npx vitest run CoverageTimeline.test.tsx DefaultChangeNote.test.tsx ScenarioComposer.test.tsx` — **148 passed** (8 + 6 + 134).
- `npx vitest run scenario-window.test.ts phase-52-frozen-spine-guards.test.ts` — 41 passed (BLEND-07 numpy gate + frozen spine green; no engine file touched).
- `npx vitest run -t "frozen|BLEND-07|parity"` — 133 passed (parity/frozen name sweep green).
- `npx vitest run SignOutButton.test.tsx` — 2 passed (the composer. purge inventory covers the note key).
- `npm run test:coverage` — ratchet **PASSED, exit 0**: lines 85.43 (≥82), statements 83.28 (≥80), functions 79.72 (≥74), branches 76.11 (≥72).
- `npx tsc --noEmit` — clean (exit 0). `npx eslint` over all 6 touched files — clean (no `no-raw-font-px` / B25 `no-raw-localstorage` / a11y violations).
- The composer-axe WCAG-AA e2e (`e2e/composer-axe.spec.ts`) is seed-env-gated and runs in CI / /qa; anchors for the new blend header + expanded gantt were added in place so the composed `analyze()` covers them.

## Next Phase Readiness
- Phase 58 (Coverage Legibility & Disclosure) is now fully implemented across waves 1-3: BlendHeader (COVERAGE-03), the three-state chips + auto-excluded amber (COVERAGE-02), the include-cost affordance (COVERAGE-04), the coverage timeline (COVERAGE-01), and the default-change note (POLISH-03).
- Phase 59 (window PERSISTENCE) can build on the note/timeline, which consume the window but deliberately do not persist it (per the phase boundary).
- Phase 60 (golden/e2e re-bake) will pick up the new mini-gantt + note in the composed-surface baselines.
- No numeric/engine change — the frozen spine, BLEND-07, and parity guards stay green; "if a number moves, that is a bug" holds (presentation-only).

## Self-Check: PASSED
- FOUND: src/app/(dashboard)/allocations/components/CoverageTimeline.tsx
- FOUND: src/app/(dashboard)/allocations/components/CoverageTimeline.test.tsx
- FOUND: src/app/(dashboard)/allocations/components/DefaultChangeNote.tsx
- FOUND: src/app/(dashboard)/allocations/components/DefaultChangeNote.test.tsx
- FOUND commit 9ee799ef (Task 1), 064e9903 (Task 2), 3fb8cbed (Task 3)
- Acceptance greps: CoverageTimeline `new Date(`=0, `utcEpoch`=5, `recharts|duration-250`=0, `aria-label`=3; DefaultChangeNote `useCrossTabStorage`≥1, raw localStorage=0, key=1, `role="alert"`=0, `role="status"`=1, verbatim copy=1; composer `CoverageTimeline|DefaultChangeNote`=5, added `covers(`=0, new e2e spec=0, ci.yml diff=0

---
*Phase: 58-coverage-legibility-disclosure*
*Completed: 2026-07-02*
