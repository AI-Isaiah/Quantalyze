# Phase 58: Coverage Legibility & Disclosure - Research

**Researched:** 2026-07-01
**Domain:** Presentation-only React/TypeScript UI on an existing Next.js 16 / React 19 client component (`ScenarioComposer`) — no engine, no new dependency
**Confidence:** HIGH

## Summary

Phase 58 adds the *disclosure* surface on top of Phase 57's already-shipped
coverage-window state machine. Every functional primitive it needs already
exists and is verified in the codebase: the engine's honest member set
(`computeScenario` → `member_count` / `member_ids` / `effective_start` /
`effective_end`), the coverage-span/intersection/union math
(`scenario-window.ts`), the auto-excluded memo + `AutoExcludedRow`, the
`coverageDropReason()` copy, the window-set path (`applyWindow`), the
SSR-safe cross-tab localStorage primitive (`useCrossTabStorage`), the
`CollapsibleSection` host, and the axe-core WCAG-AA e2e that scans the whole
composed `<main>`. This phase is almost entirely *wiring + styling* of these
assets into five legibility affordances — it introduces **zero new runtime
dependencies** and **zero engine changes** (`[VERIFIED: codebase grep]`).

The single load-bearing correctness rule carries over verbatim from Phases
55–57: the blend header, the gantt member bars, and the per-row chips must all
read the **same** engine member set / `covers()` predicate — never three
independent derivations. The composer already enforces this with a dev-mode
desync guard (`ScenarioComposer.tsx:1813-1832`) that `console.warn`s when the
UI's in-blend set diverges from `scenarioMetrics.member_ids`. Every new element
in this phase must source membership from the SAME `coverageEligible` /
`member_ids` axis so that guard stays quiet.

The two genuine implementation unknowns are both timezone-footgun avoidance:
(1) the mini-gantt date→x scale must be built from lexicographic "YYYY-MM-DD"
strings (or `utcEpoch()`), never `new Date(str)`; and (2) the include-cost
month-delta must be computed timezone-free. Both have established in-repo
patterns (`dateday.ts` `utcEpoch`/`diffDays`, `formatIsoMonth` string-slicing).

**Primary recommendation:** Extract `CoverageTimeline.tsx`,
`CoverageStateChip.tsx`, `BlendHeader.tsx` as pure presentational children;
render POLISH-03's note inline (or as `DefaultChangeNote.tsx`) gated by a new
`useCrossTabStorage` boolean key under the `composer.` prefix; feed all four
membership-dependent surfaces from the existing `coverageEligible` /
`scenarioMetrics.member_ids` / `selectedSpanById` memos. Build the gantt as
flex/div bars (simpler than SVG, passes axe with text labels + `aria-label`).
Reuse `applyWindow` for COVERAGE-04's include-cost apply.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Area 1 — Coverage Timeline (mini-gantt) — COVERAGE-01**
- Horizontal mini-gantt: one thin bar per selected strategy, x-axis = union date
  range across the selected set, active `[winStart,winEnd]` window drawn as a
  shaded vertical band overlay.
- Placement: inline **collapsible** panel within `ScenarioComposer`, **collapsed
  by default** behind a "Coverage timeline" toggle.
- Bar encoding: in-window portion = solid accent (`#1B6B5A`); out-of-window
  portion = muted/hatched; an auto-excluded (outside-window) strategy renders its
  bar in **warning amber** so gantt and row chips agree.
- Build vs reuse: small purpose-built SVG/div-bar component reusing
  `coverageSpanOf()` + a local date→x scale. **No new dependency.** Respect
  `prefers-reduced-motion`; WCAG-AA floor holds (bars carry text/aria, not
  color-only meaning).

**Area 2 — Three-State Chips + Blend Header — COVERAGE-02, COVERAGE-03**
- State→color: in-blend = accent `#1B6B5A`; manually-excluded = muted neutral
  (`--color-text-muted` family); auto-excluded = warning amber (text `#B45309`,
  bg `#FEF3C7`, border `#FDE68A`). **Do NOT** use negative/red.
- Where states render: inline chip/label on each strategy row. In-blend rows in
  the main list; auto-excluded rows in the Phase-57 auto-excluded group carrying
  amber chip + inline reason.
- Reason copy: REUSE existing `coverageDropReason()` output. No new copy strings.
- Blend header (COVERAGE-03): always-visible header above the blend output —
  **"Mean of {N} strategies · {effStart}–{effEnd}"**, degrading honestly:
  - N = 1 → "1 strategy — not a blend"
  - effective window narrower than union → append "· window truncated from full range"
  - N = 0 → honest empty state.
  Source N / effective window from `computeScenario`'s emitted
  `member_count` / `member_ids` / `effective_start` / `effective_end` — never
  re-derive the blend.

**Area 3 — Include-Cost Affordance — COVERAGE-04**
- Inline text-button on each auto-excluded row: **"Include → shortens window to
  {date} (−{N} mo)"** — cost in the label, visible before applying.
- Cost shown: the window bound the include forces (the strategy's limiting
  first/last date) + delta in whole months vs the current window, computed from
  `coverageSpanOf` vs current `[winStart,winEnd]`.
- Apply: one click narrows the window to the intersection that includes this
  strategy, re-running the Phase-57 auto-toggle state machine (reuse existing
  window-set path). Reversible via "Common period" / "Full range" presets. Does
  **not** auto-reselect a manually-excluded strategy.
- Confirmation: no modal — cost disclosed in label, apply immediate + reversible.

**Area 4 — One-Time Default-Change Note — POLISH-03**
- Copy: "Now showing the common period where all {N} overlap · **Show full
  range**" (REQUIREMENTS verbatim); "Show full range" triggers Full-range preset.
- Dismissal persistence: a `localStorage` flag (per-browser, one-time across
  sessions). NOT in `ScenarioDraft`, NOT a server/profile flag.
- Placement + form: dismissible inline **info** note (informational, NOT
  warning-tier) above the window control / blend header, with `×` to dismiss,
  `role="status"` + `aria-live="polite"`.
- When shown: only when the intersection default actually truncates the union AND
  the note has not been dismissed. Never when all spans coincide.

### Claude's Discretion
- Exact component decomposition (`CoverageTimeline.tsx`, `CoverageStateChip`,
  `BlendHeader`) and their placement — follow DESIGN.md + existing composer
  structure.
- The precise localStorage key name and the month-delta rounding for the
  include-cost label.
- SVG vs flex/div implementation of the gantt bars — whichever is simpler and
  passes a11y.

### Deferred Ideas (OUT OF SCOPE)
- Persisting the coverage window itself (reopen at owner's window, shared-link
  recompute, compare-across-windows) — **Phase 59** (PERSIST-01…03).
- Re-baking the visual golden + e2e baselines — **Phase 60** (VERIFY-01).
- Interior mid-window gap density floor (BLEND-F2) — deferred to v2 per Phase 55.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| COVERAGE-01 | Coverage timeline (mini-gantt) showing each selected strategy's data span vs the active window | `selectedSpanById` (per-strategy `coverageSpanOf` scan, `ScenarioComposer.tsx:1639`), `unionOf`/`coverageWindow` for the x-scale; `CollapsibleSection` host; `dateday.ts` `utcEpoch` for the date→x linear map (no `new Date`) |
| COVERAGE-02 | Three-state per-row chips (in-blend / manually-excluded / auto-excluded) + inline reason | `coverageEligible` memo (`:1762`) = in-blend axis; `selected===false` = manual-off; `autoExcluded` memo (`:1787`) + `coverageDropReason()` (`:435`) for the amber-chip rows; DESIGN.md warning tokens |
| COVERAGE-03 | Always-visible blend header (member count · effective window · N), degrading honestly | `scenarioMetrics.member_count` / `member_ids` / `effective_start` / `effective_end` / `n` — the ONLY honest source; `ComputedMetrics` shape verified (`scenario.ts:129-195`) |
| COVERAGE-04 | One-click "include → shortens window to [date] (−N months)" on auto-excluded rows, showing cost first | `coverageSpanOf` (limiting bound) + `dateday.ts` month-delta vs `coverageWindow`; `applyWindow` (`:1705`) is the existing window-set path; `AutoExcludedRow` is the host |
| POLISH-03 | One-time union→intersection default-change note with a "show full range" escape hatch | `useCrossTabStorage` deferred-hydration boolean key (SSR-safe); `fullRangeWindow`/`applyWindow` for the escape hatch; visibility gate = intersection truncates union |
</phase_requirements>

## Project Constraints (from CLAUDE.md / AGENTS.md)

- **Modified Next.js (16.2.3):** AGENTS.md warns this Next.js has breaking changes from
  training data — read `node_modules/next/dist/docs/` before any framework-API assumption.
  For Phase 58 this is low-risk: no new routes, no server components, no data fetching, no
  `next/*` API surface changes — all work is inside an existing `"use client"` tree.
- **DESIGN.md is authoritative** for every visual/UI decision (fonts, colors, spacing,
  motion). This phase authors NO new token, NO new copy beyond the four CONTEXT-locked
  strings. `[VERIFIED: DESIGN.md]`
- **Test coverage is a BLOCKING CI gate** (ratchet lines 82 / statements 80 / functions 74 /
  branches 72, `vitest.config.ts`; `frontend-coverage` job gates branch protection). New
  child components MUST ship with unit tests or they can drag coverage below the ratchet.
- **Skill routing** (CLAUDE.md): "code review / check my diff → invoke review"; "QA → invoke
  qa"; "ship → invoke ship". Rule 6 (root-cause), Rule 2 (simplicity-first / no new dep),
  Rule 3 (surgical changes — extend the auto-excluded group, don't rebuild it), Rule 11
  (match codebase conventions) all bear directly on this presentation-only phase.
- **`no-raw-font-px` lint is repo-wide `error`** (Phase 54). New components MUST use the
  `text-fixed-N` / named `--text-*` tiers, never raw `text-[Npx]`. `[VERIFIED: DESIGN.md]`
- **Banned packages** (global CLAUDE.md): irrelevant here — no package install in this phase.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Blend membership / divisor (N, member_ids, effective window) | Client compute (`computeScenario`, already run in `ScenarioComposer`) | — | The engine is the single source of truth (parity-by-construction); the UI READS it, never re-derives it |
| Coverage-span / intersection / union math | Client pure lib (`scenario-window.ts`) | — | Already the ONE derivation site; Phase 58 reuses `coverageSpanOf`/`unionOf`/`covers`, adds no interval math |
| Chip / gantt / header rendering | Client presentational components | — | Pure `props → JSX`; no state, no I/O, no fetch |
| Include-cost apply (window narrow) | Client interaction (`applyWindow` state setter) | — | Reuses the Phase-57 window-set path; the auto-toggle state machine re-runs downstream |
| POLISH-03 dismissal persistence | Browser `localStorage` (`useCrossTabStorage`) | — | A per-device UI education artifact — explicitly NOT scenario data, NOT a server flag (CONTEXT-locked) |
| Date→x scale for the gantt | Client pure helper (`dateday.ts` `utcEpoch`) | — | Timezone-stable integer math; belongs in the render layer, never crosses a tier |

**All work is a single tier: the existing `ScenarioComposer` client subtree.** No API,
no server component, no database, no CDN involvement. This is why the phase is
"presentation-only" and the frozen engine stays untouched.

## Standard Stack

**No new packages.** This phase is built entirely from already-installed, already-verified
in-repo primitives + React 19 / Next 16 already in `package.json`.

### Core (already installed — verified versions)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `react` | 19.2.7 | Component tree, hooks (`useMemo`/`useEffect`/`useState`) | Already the app's runtime `[VERIFIED: package.json]` |
| `next` | ^16.2.3 | App Router client component host | Already the app's framework `[VERIFIED: package.json]` |
| `vitest` | ^4.1.2 | Unit/component tests for new children | Existing test runner `[VERIFIED: package.json]` |
| `@playwright/test` | (installed) | `composer-axe.spec.ts` WCAG-AA e2e | Existing e2e harness `[VERIFIED: e2e/composer-axe.spec.ts]` |

**`recharts` ^3.9.0 is installed but MUST NOT be used for the gantt.** The gantt is a
static horizontal-bar timeline (no tooltips, no interactivity, no data-driven axis ticks) —
flex/div bars or a hand-authored SVG are simpler, lighter, and avoid the recharts
`accessibilityLayer` tab-order pitfall (see Common Pitfalls). CONTEXT locks "no new
dependency" and the ADR locks "zero new runtime dependencies"; recharts would be
over-engineering here (Rule 2). `[CITED: 58-CONTEXT.md, 58-UI-SPEC.md]`

### Supporting (in-repo primitives — reuse verbatim)
| Asset | Path | Purpose in Phase 58 |
|-------|------|---------------------|
| `computeScenario` output | `src/lib/scenario.ts` (`ComputedMetrics`, `:129`) | Honest blend header source: `member_count` / `member_ids` / `effective_start` / `effective_end` / `n` |
| `scenario-window.ts` helpers | `coverageSpanOf` / `intersectionOf` / `unionOf` / `covers` / `defaultWindowFor` | Gantt x-scale + include-cost month-delta + membership predicate |
| `coverageDropReason(span, window)` | `ScenarioComposer.tsx:435` | Inline reason copy for auto-excluded chips (REUSE — no new strings) |
| `formatIsoMonth(iso)` | `ScenarioComposer.tsx:418` | String-slice "YYYY-MM-DD" → "Mon YYYY" (timezone-free; reuse for date labels) |
| `dateday.ts` | `utcEpoch` / `diffDays` / `parseIsoDay` | Timezone-stable date→x scale + month-delta primitives |
| `coverageEligible` memo | `ScenarioComposer.tsx:1762` | The in-blend membership axis (same predicate as engine) |
| `autoExcluded` memo | `ScenarioComposer.tsx:1787` | The auto-excluded rows (id/name/reason) |
| `selectedSpanById` memo | `ScenarioComposer.tsx:1639` | ONE coverage-span scan per selected strategy, shared by all window memos |
| `applyWindow(range)` | `ScenarioComposer.tsx:1705` | The window-set path COVERAGE-04's include reuses |
| `commonPeriodWindow` / `fullRangeWindow` | `ScenarioComposer.tsx:1718/1722` | Preset targets (POLISH-03 escape hatch, COVERAGE-04 reversibility) |
| `CollapsibleSection` | `src/components/ui/CollapsibleSection.tsx` | Host for the collapsed-by-default gantt (native `<details>`, keyboard-accessible) |
| `useCrossTabStorage` + `rawStringCodec` | `src/lib/storage/cross-tab.ts`, `codecs.ts` | SSR-safe deferred-hydration localStorage for the POLISH-03 dismissal flag |
| `Badge` | `src/components/ui/Badge.tsx` | Base chip visual (4px radius ladder); the 3-state chip is a NEW variant/component but matches its shape |
| `AutoExcludedRow` | `ScenarioComposer.tsx:3678` | Extend in place with amber chip (COVERAGE-02) + include-cost button (COVERAGE-04) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| flex/div gantt bars | recharts / d3 / a chart lib | Violates "no new dependency"; over-engineered for a static bar timeline; recharts adds the `accessibilityLayer` tab-order footgun |
| `useCrossTabStorage` for POLISH-03 | raw `localStorage.setItem` | Banned by the B25 `no-raw-localstorage` lint; bypasses SSR-safe hydration → hydration mismatch; not in the sign-out purge |
| A new `DefaultChangeNote.tsx` file | inline JSX in `ScenarioComposer.tsx` | Either is fine per CONTEXT; inline is fewer files but a small extracted component is easier to unit-test in isolation (coverage-gate friendly) |
| SVG gantt | flex/div gantt | SVG gives pixel-precise bars but needs explicit `role`/`aria-label` on `<rect>`s and is harder to make text-carrying; flex/div reuses Tailwind width utilities + native text nodes |

**Installation:** None. `npm install` unchanged.

## Package Legitimacy Audit

**Not applicable — this phase installs zero external packages.** All code is built from
already-installed dependencies (`react`, `next`, `vitest`, `@playwright/test`) and in-repo
modules. No `npm install`, no registry lookup, no slopcheck needed. The ADR
(`REQUIREMENTS.md`) and CONTEXT both lock "zero new runtime dependencies", and the UI-SPEC
Registry Safety section confirms "no registries, no third-party blocks, no new runtime
dependency". `[VERIFIED: package.json unchanged; 58-UI-SPEC.md §Registry Safety]`

## Architecture Patterns

### System Architecture Diagram

Data flow for the four membership-dependent surfaces — all reading ONE engine member set:

```
                 deAliased.strategies (post-collapse set the engine blends)
                 deAliased.state.selected  (manual on/off — sticky)
                          │
                          ▼
        ┌─────────────────────────────────────────────────┐
        │  selectedSpanById  (ONE coverageSpanOf scan/id)  │   ← scenario-window.ts
        └───────┬───────────────────┬────────────┬────────-┘
                │                   │            │
        winStart/winEnd ──▶ coverageWindow ──▶ engineState = {...state, window}
                │                   │            │
                │                   │            ▼
                │                   │     computeScenario(strategies, engineState)
                │                   │            │
                │                   │            ▼
                │                   │     scenarioMetrics: member_count, member_ids,
                │                   │                      effective_start/end, n
                │                   │            │
                ▼                   ▼            │
        coverageEligible[id]   autoExcluded[]    │
        (selected && covers)   (selected &&      │
                │               !eligible +      │
                │               dropReason)      │
    ┌───────────┼───────────────────┼────────────┼──────────────┐
    ▼           ▼                   ▼            ▼               ▼
 CoverageTimeline  CoverageStateChip  AutoExcludedRow   BlendHeader   POLISH-03 note
 (bars: accent/    (per-row: in-blend/  (amber chip +    (Mean of N ·  (shown iff
  muted/amber +     manual/auto — same   include-cost     effStart–     intersection
  window band)      3-state axis)        button →         effEnd;       truncates union
                                         applyWindow)     degrades)     && !dismissed)
                                              │                              │
                                              ▼                              ▼
                                        applyWindow(range)            useCrossTabStorage
                                        (narrows window →             (localStorage flag,
                                         re-runs auto-toggle)          SSR-safe deferred)

  ⚠ DEV DESYNC GUARD (ScenarioComposer.tsx:1813): asserts
     {selected && coverageEligible} === scenarioMetrics.member_ids.
     Every surface above MUST read this same axis — never re-derive membership.
```

### Recommended Project Structure
```
src/app/(dashboard)/allocations/components/
├── ScenarioComposer.tsx           # host — wire the new children in; extend AutoExcludedRow
├── CoverageTimeline.tsx           # NEW (COVERAGE-01) — pure props→bars; date→x via utcEpoch
├── CoverageStateChip.tsx          # NEW (COVERAGE-02) — 3-state chip variant
├── BlendHeader.tsx                # NEW (COVERAGE-03) — reads scenarioMetrics fields
├── DefaultChangeNote.tsx          # NEW (POLISH-03) — OR inline in ScenarioComposer
└── __tests__/                     # existing dir — add child-component unit tests here
    ├── CoverageTimeline.test.tsx
    ├── CoverageStateChip.test.tsx
    ├── BlendHeader.test.tsx
    └── DefaultChangeNote.test.tsx
```

### Pattern 1: Read membership from the engine, never re-derive
**What:** Every surface that names/counts/colors "in-blend" strategies sources it from
`scenarioMetrics.member_ids` / `coverageEligible` — the SAME axis the dev desync guard checks.
**When to use:** BlendHeader (N + effective window), gantt bar color (in-blend vs auto-excluded),
per-row chips.
**Example (existing desync guard — the contract to preserve):**
```typescript
// Source: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1813
useEffect(() => {
  if (process.env.NODE_ENV === "production") return;
  if (!coverageWindow) return;
  const memberIds = scenarioMetrics.member_ids;
  if (!memberIds) return;
  const uiInBlend = deAliased.strategies
    .filter((s) => deAliased.state.selected[s.id] && coverageEligible[s.id])
    .map((s) => s.id).sort();
  const engineMembers = [...memberIds].sort();
  if (uiInBlend.length !== engineMembers.length ||
      uiInBlend.some((id, i) => id !== engineMembers[i])) {
    console.warn("[ScenarioComposer] coverageEligible desync vs engine member_ids", ...);
  }
}, [deAliased, coverageWindow, coverageEligible, scenarioMetrics.member_ids]);
```
BlendHeader's `{N}` = `member_count`; the gantt/chip "in-blend" flag = `coverageEligible[id]`.
Both are the two ends the guard already reconciles — reusing them means the guard also
protects the new surfaces for free.

### Pattern 2: Timezone-free date→x scale (never `new Date(str)`)
**What:** Map a "YYYY-MM-DD" day to a pixel/percent x position using integer epoch math.
**When to use:** The gantt bar left/width, the window-band overlay position.
**Example:**
```typescript
// Source: src/lib/dateday.ts — utcEpoch is the timezone-stable conversion
import { parseIsoDay, utcEpoch } from "@/lib/dateday";
// Given union = { start, end } from unionOf(selectedSpans):
const x0 = utcEpoch(parseIsoDay(union.start)!);      // total epoch span
const x1 = utcEpoch(parseIsoDay(union.end)!);
const span = x1 - x0 || 1;                            // guard div-by-zero (single-day union)
// For a strategy span [first, last] → percent offsets on the shared axis:
const leftPct  = ((utcEpoch(parseIsoDay(span.first)!) - x0) / span) * 100;
const widthPct = ((utcEpoch(parseIsoDay(span.last)!)  - utcEpoch(parseIsoDay(span.first)!)) / span) * 100;
```
`utcEpoch` + `parseIsoDay` are the DESIGN-blessed timezone-stable path (`dateday.ts`
docstring: "UTC-midnight epoch … timezone-stable math — chart x-axis scaling"). Lexicographic
string compare is equally valid for ORDERING, but positions need the numeric epoch.
`[VERIFIED: src/lib/dateday.ts:94-97]`

### Pattern 3: SSR-safe one-time localStorage flag (POLISH-03)
**What:** Persist a per-device "note dismissed" boolean without a hydration mismatch.
**When to use:** POLISH-03 dismissal.
**Example:**
```typescript
// Source: src/lib/storage/cross-tab.ts + codecs.ts (rawStringCodec) — the SAME pattern
// CollapsibleSection uses for open/closed persistence.
const dismissedCodec = useMemo(
  () => rawStringCodec<boolean>({
    parse: (raw) => raw === "true",
    serialize: (v) => (v ? "true" : "false"),
  }), []);
const { value: dismissed, setValue: setDismissed, isHydrated } = useCrossTabStorage<boolean>({
  key: "composer.coverageDefaultChangeNoteDismissed",   // MUST be registered in storage-namespaces.ts
  initial: false,                                        // server + first client render = not dismissed → note hidden pre-hydration
  codec: dismissedCodec,
  sentryArea: "composer.default-change-note",
});
// Render the note only AFTER hydration AND when truncation applies AND not dismissed:
const showNote = isHydrated && !dismissed && intersectionTruncatesUnion;
```
**Critical:** `initial: false` renders "not dismissed" on the server. But because the note's
OTHER visibility condition (`intersectionTruncatesUnion`) is also client-derived and the note
is `role="status" aria-live="polite"`, gate the actual render on `isHydrated` so a
returning-dismissed user never sees a one-frame flash. The `deferred` hydration strategy
(default) makes server HTML == first client render — no mismatch. `[VERIFIED: src/lib/storage/cross-tab.ts:84-95, CollapsibleSection.tsx:80-102]`

### Pattern 4: Reuse `applyWindow` for the include-cost apply (COVERAGE-04)
**What:** One click narrows the window to the intersection that includes the auto-excluded
strategy — reusing the Phase-57 window-set path so the auto-toggle state machine re-runs.
**Example:**
```typescript
// Source: src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1705
const applyWindow = useCallback((range: { start: string; end: string }) => {
  windowTouchedRef.current = true;
  setWinStart(range.start);
  setWinEnd(range.end);
}, []);
// For COVERAGE-04: the include target is the intersection of the CURRENT window with the
// strategy's span — i.e. pull winStart forward to max(winStart, span.first) and winEnd
// back to min(winEnd, span.last) so the strategy becomes a member (covers() true).
// Delegate the bound math to scenario-window.ts (intersectionOf over [currentWindow-as-span,
// strategySpan]) — NEVER hand-roll interval math (Rule 2).
```
The label's `{date}` is the single moved bound; the `−{N} mo` is `diffDays` between the old
and new bound folded to whole months.

### Anti-Patterns to Avoid
- **Re-deriving membership independently in a new component** — computing `covers()` inside
  `BlendHeader` or the gantt off a different span source. This is exactly the desync the
  `:1813` guard exists to catch. Always pass `coverageEligible` / `member_ids` down.
- **`new Date("2026-01-01")` anywhere in the gantt scale** — reintroduces the UTC/local
  off-by-one `dateday.ts` was written to eliminate (`H-1224` / `NEW-C23-01`). Use `utcEpoch`.
- **Raw `localStorage.setItem` for POLISH-03** — banned by the B25 lint; bypasses SSR-safe
  hydration and the sign-out purge. Use `useCrossTabStorage`.
- **`text-[Npx]` font sizes in new components** — repo-wide `no-raw-font-px` `error` lint.
  Use `text-fixed-N` / `--text-*` tiers.
- **`role="alert"` on the note or blend header** — DESIGN-05 reserves `alert` for BLOCKING
  errors; these are non-blocking state changes → `role="status" aria-live="polite"`.
- **Warning/amber for anything permanent, or red for auto-excluded** — auto-excluded is
  transient-recoverable (narrow the window → it returns); DESIGN.md reserves warning amber
  for exactly that, and red for permanent failure.
- **Rebuilding the auto-excluded group / empty-intersection banner** — extend the Phase-57
  render in place (Rule 3, surgical changes).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Coverage-span / intersection / union math | A local min/max loop over dates | `scenario-window.ts` (`coverageSpanOf`/`intersectionOf`/`unionOf`/`covers`) | ONE derivation site keeps UI ↔ engine membership identical (the whole point of v1.5); inclusive-closed containment + null-on-empty semantics are pinned there |
| Date → x pixel scale | `new Date(str).getTime()` | `dateday.ts` `utcEpoch(parseIsoDay(...))` | Avoids the UTC/local off-by-one (`H-1224`); rejects rollover garbage |
| Month-delta for the include-cost label | `Math.round((d2 - d1) / 2.6e9)` on `Date`s | `dateday.ts` `diffDays` folded to months (or a small string-based month diff) | Timezone-free integer days; no DST drift |
| "Mon YYYY" date formatting | `new Date(iso).toLocaleDateString(...)` | `formatIsoMonth(iso)` (`ScenarioComposer.tsx:418`) | Pure string slice — already the composer's convention; locale-independent |
| SSR-safe localStorage persistence | `useEffect` + `localStorage.getItem` + manual mount flag | `useCrossTabStorage` + `rawStringCodec` | Bakes in deferred hydration, cross-tab sync, quota/private-mode guards, sign-out purge registration, Sentry breadcrumbs |
| Collapsible panel for the gantt | A custom `useState(open)` + button + conditional render | `CollapsibleSection` | Native `<details>` — keyboard-accessible, prints open, optional storage-persisted, `prefers-reduced-motion` handled |
| Blend member count / divisor / effective window | Counting `coverageEligible` entries in the header | `scenarioMetrics.member_count` / `member_ids` / `effective_start` / `effective_end` | Parity-by-construction; the engine is the honest divisor source (BLEND-06) |
| Chip base visual | A fresh `<span>` with ad-hoc padding/radius | `Badge` shape (4px radius, `px-2 py-0.5`, `text-caption font-medium`) as the template | Matches the DESIGN.md badge ladder; the 3-state variant just swaps token colors |

**Key insight:** The entire numeric/derivation substrate for this phase already exists and is
test-pinned. Every "don't hand-roll" item above is a case where a naive local reimplementation
would either (a) desync the UI from the engine's honest membership, or (b) reintroduce a
timezone off-by-one that a whole module (`dateday.ts`) was built to kill. Phase 58's job is
composition + styling of verified primitives, not new logic.

## Runtime State Inventory

> Phase 58 is a greenfield *additive UI* phase, not a rename/refactor/migration. It introduces
> ONE new persisted key (the POLISH-03 dismissal flag). No existing stored data, service config,
> OS state, secret, or build artifact is renamed or migrated. Included for completeness because
> the new localStorage key touches persistence infrastructure.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | New localStorage key `composer.coverageDefaultChangeNoteDismissed` (per-device boolean). No existing key renamed. | Register its prefix (`composer.`) in `src/lib/storage-namespaces.ts` `APP_NAMESPACED_PREFIXES` so the sign-out purge reaches it; add a representative key to `KNOWN_APP_KEYS` in `SignOutButton.test.tsx` |
| Live service config | None — no external service, no server config touched | None |
| OS-registered state | None — no OS-level registration | None |
| Secrets/env vars | None — no secret or env var referenced or renamed | None |
| Build artifacts | None — no package rename, no compiled artifact; new `.tsx` files compile normally | None |

**Nothing found in most categories** — verified by grep: Phase 58 touches only
`ScenarioComposer.tsx` + new sibling components + `storage-namespaces.ts` (one prefix
addition) + test files. `[VERIFIED: src/lib/storage-namespaces.ts:20-31]`

## Common Pitfalls

### Pitfall 1: New surface re-derives membership → desync with the engine divisor
**What goes wrong:** `BlendHeader` counts `coverageEligible` entries, or the gantt colors bars
off a locally-computed `covers()` against a differently-sourced span, and it drifts from
`scenarioMetrics.member_count` — the header says "3 strategies" while the divisor is 2.
**Why it happens:** Convenience — a new component computes what it needs locally instead of
threading the engine output down.
**How to avoid:** BlendHeader reads `member_count` / `member_ids` / `effective_start` /
`effective_end` directly. Gantt/chip "in-blend" flag = `coverageEligible[id]` (the exact set
the `:1813` guard reconciles against `member_ids`). Thread these as props; never recompute.
**Warning signs:** The dev desync `console.warn` fires; a component imports `covers`/`coverageSpanOf`
to make its OWN membership decision rather than receiving it.

### Pitfall 2: `new Date(str)` in the gantt scale → one-day-off bars for non-UTC users
**What goes wrong:** Bars shift a day left/right for users east/west of UTC; the window band
misaligns with the bar edges.
**Why it happens:** `new Date("2026-01-01")` parses as UTC-midnight but is read through local
accessors — the exact `H-1224` / `NEW-C23-01` bug `dateday.ts` documents.
**How to avoid:** Use `utcEpoch(parseIsoDay(iso))` for all positions; use lexicographic string
compare for ordering. No `Date` object in the scale math except via `dateday` helpers.
**Warning signs:** A `new Date(` on an ISO string anywhere in `CoverageTimeline.tsx`.

### Pitfall 3: POLISH-03 note hydration mismatch (flash-of-note for dismissed users)
**What goes wrong:** The note renders on the server (dismissed flag unknown at SSR), then
disappears after hydration for a returning-dismissed user — a hydration mismatch warning +
a visible flash.
**Why it happens:** Reading `localStorage` synchronously at render, or not gating render on
`isHydrated`.
**How to avoid:** `useCrossTabStorage` with the default `deferred` strategy (server + first
client render both use `initial: false`); gate the note's render on
`isHydrated && !dismissed && intersectionTruncatesUnion`. Because `initial: false` maps to
"not dismissed → note *may* show", also ensure `intersectionTruncatesUnion` is client-derived
and the whole note is inside the client subtree (it is — the composer is `"use client"`).
**Warning signs:** React hydration warning in console; the note flickering on reload.

### Pitfall 4: recharts `accessibilityLayer` tab-order regression (if SVG-via-recharts is chosen)
**What goes wrong:** A recharts chart root SVG gets `tabIndex=0 role="application"` with no
accessible name, landing an empty focus stop in tab order and breaking keyboard-nav e2e.
**Why it happens:** Recharts 3.x defaults `accessibilityLayer={true}`; the codebase already
had to opt this OUT app-wide (`chart-accessibility-layer.test.ts` grep-guards it).
**How to avoid:** Don't use recharts for the gantt (recommended). If SVG is chosen, hand-author
plain `<svg>` (not recharts) with explicit `role="img"` + `aria-label`, or use flex/div bars.
**Warning signs:** A new recharts import in `CoverageTimeline.tsx`; a new focus stop in the
keyboard-nav specs.

### Pitfall 5: Motion token drift — `duration-250` silently drops the transition
**What goes wrong:** A gantt-panel or chip transition authored with `duration-250` does nothing
(invalid Tailwind v4 token) and reduced-motion users still see it if `motion-reduce` is missing.
**Why it happens:** DESIGN.md says "250ms" but Tailwind v4 has no `duration-250` — must use
`duration-300`.
**How to avoid:** Use `duration-300` for the 250ms tier + `motion-reduce:transition-none` on
the single transition-carrying element (the `AutoExcludedRow` already does exactly this).
**Warning signs:** `duration-250` in a className; a transition without a `motion-reduce:` guard.

### Pitfall 6: Coverage-gate regression from untested new components
**What goes wrong:** Three new `.tsx` files with rich branching (degrade cases, empty states,
3 chip variants) land without tests → function/branch coverage dips below the ratchet →
`frontend-coverage` CI job fails → branch protection blocks merge.
**Why it happens:** Presentation components are easy to ship untested.
**How to avoid:** Each new child gets a unit test in `components/__tests__/` covering its
branches (BlendHeader: N=0 / N=1 / truncated / normal; chip: 3 states; gantt: in/out/auto bars;
note: shown/hidden/dismissed). Follow the existing `ScenarioComposer.test.tsx` Phase-57 pattern
(mocked picker capturing `onApply`, REAL `computeScenario` as the `member_count` oracle).
**Warning signs:** Coverage summary shows new files at low function/branch %.

## Code Examples

### Blend header reading the honest engine output (COVERAGE-03)
```typescript
// Source: shape verified from src/lib/scenario.ts:129-195 (ComputedMetrics) +
//         58-UI-SPEC.md Copywriting Contract (verbatim strings)
// Props: { metrics: ComputedMetrics, unionSpan: CoverageWindow | null }
const N = metrics.member_count ?? 0;
const effStart = metrics.effective_start;
const effEnd = metrics.effective_end;
// Degrade order (locked): N=0 → empty state; N=1 → "not a blend"; else "Mean of N · start–end".
// Truncation note appended when the effective window is narrower than the selected-set union.
const truncated =
  unionSpan != null && effStart != null && effEnd != null &&
  (effStart > unionSpan.start || effEnd < unionSpan.end);
// Renders (role="status" aria-live="polite"):
//   N === 0 → "No strategies span the selected window"
//   N === 1 → "1 strategy — not a blend"
//   else    → `Mean of ${N} strategies · ${effStart}–${effEnd}` (+ "· window truncated from full range" if truncated)
```
Numbers (`{N}`, dates) render in `font-mono tabular-nums` (Geist Mono) per DESIGN.md
"all numbers use Geist Mono". `[CITED: 58-UI-SPEC.md §Typography, §Copywriting Contract]`

### Three-state chip (COVERAGE-02)
```tsx
// Source: 58-UI-SPEC.md §Color (LOCKED 3-state mapping) + DESIGN.md badge ladder
type CoverageState = "in-blend" | "manually-excluded" | "auto-excluded";
const CHIP: Record<CoverageState, { label: string; cls: string }> = {
  "in-blend":           { label: "In blend",      cls: "text-accent bg-accent/10" },
  "manually-excluded":  { label: "Excluded",      cls: "text-text-muted bg-track" },
  "auto-excluded":      { label: "Outside window", cls: "text-warning bg-warning-bg border border-warning-border" },
};
// <span className={cn("inline-flex items-center rounded-sm px-2 py-0.5 text-fixed-11 font-medium uppercase tracking-wide", CHIP[state].cls)}>
//   {CHIP[state].label}
// </span>
// State derivation (from existing memos — NOT re-derived):
//   selected === false           → "manually-excluded"
//   selected && coverageEligible  → "in-blend"
//   selected && !coverageEligible → "auto-excluded"   (+ coverageDropReason() inline)
```
Color is never the sole signal — the text label (`In blend` / `Excluded` / `Outside window`)
carries the meaning; auto-excluded also carries the inline reason. WCAG-AA. `[CITED: 58-UI-SPEC.md §Color]`

### Gantt bar with the window-band overlay (COVERAGE-01, flex/div form)
```tsx
// Source: pattern derived from dateday.ts (scale) + 58-UI-SPEC.md §Color (bar encoding)
// One row per selected strategy; positions as % of the union axis.
// <li className="flex items-center gap-2">
//   <span className="w-32 truncate text-fixed-12" title={name}>{name}</span>
//   <div className="relative h-2 flex-1 rounded-sm bg-track"           // full-axis track
//        aria-label={`${name}: covers ${first}–${last}, ${inBlend ? "in blend" : `auto-excluded — ${reason}`}`}>
//     <div className="absolute inset-y-0 rounded-sm"
//          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
//          // bg-accent when in-blend; bg-warning-bg + border-warning-border when auto-excluded
//     />
//     {/* window band overlay: bg-accent/5 or 1px border-accent framing [winLeftPct, winWidthPct] */}
//   </div>
// </li>
```
Each bar's `aria-label` restates coverage + membership as text (the axe/keyboard path).
The whole panel lives inside a `CollapsibleSection` (collapsed by default). `[CITED: 58-UI-SPEC.md §Color, §Interaction]`

### Test seam (replicate the Phase-57 pattern)
```typescript
// Source: src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx:186-215, 5138-5340
// The composer test mocks CustomRangePicker to an inert spy that captures onApply,
// keeps @/lib/scenario REAL (so member_count is the genuine engine oracle), and wraps
// computeScenario to record each invocation's `state` arg. New Phase-58 assertions reuse
// this rig: mount unequal-span book → assert BlendHeader text == "Mean of 2 strategies · …",
// drive applyWindow past B's last day → assert header degrades to "1 strategy — not a blend"
// AND the auto-excluded chip/row for B appears. member_count remains the load-bearing oracle.
```

## State of the Art

| Old Approach (pre-Phase-58) | Current Approach (Phase 58) | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Minimal inline drop reason only (`coverageDropReason`, real text, no chip) | Rich 3-state chip + amber styling on the same row | Phase 58 | The auto-excluded group gains a chip + include-cost button; reason text is REUSED |
| Coverage window value shown as a raw `"start → end"` string in the control | Always-visible honest blend header (Mean of N · effective window) above the KPIs | Phase 58 | The header is the new primary anchor; the raw control string stays for the picker affordance |
| No timeline visualization | Collapsed-by-default mini-gantt | Phase 58 | New tertiary disclosure surface |
| No default-change education | One-time union→intersection note with escape hatch | Phase 58 | Returning users aren't surprised by the intersection default |

**Deprecated/outdated:** Nothing removed. This phase is purely additive layering on the
Phase-57 functional surface. The Phase-57 auto-excluded group, empty-intersection banner, and
window control all STAY — extended, not replaced.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The gantt is best built as flex/div bars (vs SVG) | Standard Stack / Patterns | LOW — CONTEXT explicitly leaves this to Claude's discretion; either passes a11y. If SVG is preferred, hand-author plain `<svg>` (not recharts) with `role="img"` + `aria-label` |
| A2 | Suggested localStorage key `composer.coverageDefaultChangeNoteDismissed` under a new `composer.` prefix | Runtime State Inventory / Pattern 3 | LOW — key name is Claude's discretion (UI-SPEC suggests `scenario.coverageDefaultChangeNoteDismissed`). Either works IF the prefix is registered in `storage-namespaces.ts`. Confirm final prefix during planning so the sign-out purge + `KNOWN_APP_KEYS` test both cover it |
| A3 | Month-delta rounding = round-to-nearest-whole-month, floor at 1 mo when delta > 0 but < 1 | Don't Hand-Roll / COVERAGE-04 | LOW — UI-SPEC Copywriting Contract states exactly this as Claude's discretion; only affects the `−{N} mo` label text, never the applied window (which is exact bounds) |
| A4 | The frozen-spine guards stay green automatically because Phase 58 touches none of the frozen files | Common Pitfalls (implicit) | LOW — VERIFIED against `phase-52-frozen-spine-guards.test.ts`: the guards are git-delta-based over a fixed `FROZEN_ISLANDS` list. NOTE `scenario.ts` was REMOVED from that list in the v1.5 re-baseline (it is no longer frozen); `compute.ts` + the chart islands REMAIN frozen. Either way Phase 58 edits only `ScenarioComposer.tsx` + new sibling components + `storage-namespaces.ts` — none are in `FROZEN_ISLANDS` AND none are `compute.ts`/`scenario.ts` — so every frozen-spine + BLEND-07 + parity guard stays green with no engine change |

**All package/version claims are `[VERIFIED: package.json]`; all code-surface claims are
`[VERIFIED: codebase grep/read]`.** The four `[ASSUMED]` items above are all
Claude's-discretion choices with locked fallbacks, not unverified facts.

## Open Questions (RESOLVED)

> Both resolved during planning and locked into the PLAN actions: Q1 → Plan 58-03 T1 (union
> start+end endpoint labels only, no interior ticks); Q2 → Plan 58-02 T1 (`intersectionOf` of the
> current window and the strategy span; label shows the most-limiting moved bound + net whole-month
> cost). Left below for provenance.

1. **RESOLVED — Does the mini-gantt render a date axis (endpoint labels) or bars only?**
   - What we know: UI-SPEC §Typography specifies "Timeline axis endpoint dates" styling
     (`text-fixed-11 font-mono tabular-nums text-text-muted`), implying at least start/end
     endpoint labels on the union axis.
   - What's unclear: whether interior tick marks are wanted (UI-SPEC doesn't specify ticks).
   - Recommendation: render union start + union end endpoint labels only (no interior ticks) —
     matches the UI-SPEC typography row and keeps the panel uncluttered; interior ticks would
     need a date-tick generator (avoid — over-engineering). Planner can confirm.

2. **Include-cost apply: pull BOTH bounds or only the offending one?**
   - What we know: COVERAGE-04 says "narrows the window to the intersection that includes this
     strategy." A ragged-head strategy (`first > winStart`) needs `winStart` pulled forward; an
     ended strategy (`last < winEnd`) needs `winEnd` pulled back.
   - What's unclear: whether a strategy failing on BOTH ends moves both bounds in one click.
   - Recommendation: compute the new window as `intersectionOf` of the current window and the
     strategy span — this moves exactly the bounds needed (both if both fail). The label's
     `{date}` shows the single most-limiting moved bound; if both move, the label still reads the
     net cost as whole-month delta. Confirm during planning; delegate the math to
     `scenario-window.ts` regardless.

## Environment Availability

**Not applicable — SKIPPED.** Phase 58 is purely code/config changes inside an existing
client component. No external tool, service, runtime, database, or CLI dependency beyond the
already-present Node/npm/Vitest/Playwright toolchain (which the project already runs in CI).
No new binary, no new service. `[VERIFIED: no external dependency in phase scope]`

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.2 (unit/component) + Playwright (axe e2e) `[VERIFIED: package.json]` |
| Config file | `vitest.config.ts` (root); coverage via `@vitest/coverage-v8` |
| Quick run command | `npx vitest run src/app/\(dashboard\)/allocations/components/` |
| Full suite command | `npm run test` (frontend) / `npm run test:coverage` (with the blocking ratchet) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| COVERAGE-01 | Gantt renders one bar per selected strategy; in-window portion accent, out-of-window muted, auto-excluded bar amber; window band overlays `[winStart,winEnd]`; each bar has an `aria-label`; collapsed by default | unit component | `npx vitest run .../__tests__/CoverageTimeline.test.tsx` | ❌ Wave 0 |
| COVERAGE-02 | Chip shows in-blend/manual/auto by `coverageEligible` + `selected`; auto-excluded carries `coverageDropReason` text; correct DESIGN token classes | unit component | `npx vitest run .../__tests__/CoverageStateChip.test.tsx` | ❌ Wave 0 |
| COVERAGE-03 | BlendHeader text = "Mean of N · start–end"; degrades N=1 → "1 strategy — not a blend", N=0 → empty state, appends "· window truncated…" when effective < union; reads `member_count`/`effective_*` | unit component | `npx vitest run .../__tests__/BlendHeader.test.tsx` | ❌ Wave 0 |
| COVERAGE-03 | End-to-end oracle: header N matches engine `member_count` as the window moves (widen drops a member → header + divisor both fall) | integration (composer) | `npx vitest run .../ScenarioComposer.test.tsx` (extend Phase-57 window block) | ✅ (extend) |
| COVERAGE-04 | Include button label shows the forced date + `−N mo`; click narrows the window via `applyWindow` so the strategy becomes a member (member_count rises); does NOT reselect a manual-off strategy; no modal | integration (composer) | `npx vitest run .../ScenarioComposer.test.tsx` (extend, reuse picker-capture rig) | ✅ (extend) |
| POLISH-03 | Note shown iff intersection truncates union AND not dismissed; `×` dismiss persists (localStorage) and hides on remount; "Show full range" calls `applyWindow(fullRangeWindow)`; `role="status"` aria-live polite; SSR-safe (no hydration flash) | unit component + hydrate | `npx vitest run .../__tests__/DefaultChangeNote.test.tsx` + `useScenarioState.hydrate.test.tsx` idiom | ❌ Wave 0 |
| ALL | Zero WCAG-AA violations on the composed `/allocations?tab=scenario` surface (chips, gantt, note, header all scanned by the whole-`<main>` analyze) | e2e axe | `npx playwright test e2e/composer-axe.spec.ts` | ✅ (extend anchors) |

### Sampling Rate
- **Per task commit:** `npx vitest run` on the touched component test(s) + `ScenarioComposer.test.tsx`.
- **Per wave merge:** `npm run test` (full frontend suite) — the coverage-window blocks +
  the frozen-spine guards + BLEND-07 gate must stay green.
- **Phase gate:** `npm run test:coverage` (blocking ratchet green) + `composer-axe.spec.ts`
  green before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `components/__tests__/CoverageTimeline.test.tsx` — covers COVERAGE-01 (bar encoding, window band, aria-label, collapsed default)
- [ ] `components/__tests__/CoverageStateChip.test.tsx` — covers COVERAGE-02 (3 states × token classes × label text)
- [ ] `components/__tests__/BlendHeader.test.tsx` — covers COVERAGE-03 (4 degrade branches)
- [ ] `components/__tests__/DefaultChangeNote.test.tsx` — covers POLISH-03 (shown/hidden/dismissed/escape-hatch/a11y)
- [ ] Extend `ScenarioComposer.test.tsx` Phase-57 window block with COVERAGE-03/04 integration assertions (reuse the picker-capture + REAL-computeScenario rig at `:186`/`:5138`)
- [ ] Extend `e2e/composer-axe.spec.ts` composed-surface anchors to gate on the new blend-header + (expanded) gantt before `analyze()` — NO new spec, NO new HAS_SEED_ENV const, NO ci.yml entry (FLOW-01 does not apply; the spec is already CI-wired)
- [ ] Register the POLISH-03 localStorage prefix in `storage-namespaces.ts` + add a `KNOWN_APP_KEYS` entry in `SignOutButton.test.tsx`

*Framework install: none — Vitest + Playwright + coverage-v8 already present.*

## Security Domain

> `security_enforcement` is not explicitly `false` in config, so this section is included.
> Phase 58 is a client-only presentation phase with a narrow security surface.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Route already auth-gated by middleware + approval gate; Phase 58 adds no auth surface |
| V3 Session Management | no | No session handling in scope |
| V4 Access Control | no | No new data access; reads only in-memory scenario state already on the client |
| V5 Input Validation | yes (minimal) | The only "input" is the include-cost apply, which sets `winStart`/`winEnd` from `scenario-window.ts`-derived bounds (never free-form user text); the picker path (`CustomRangePicker`) already validates via `parseIsoDay`. New localStorage read is codec-validated (`rawStringCodec` folds any raw string to a boolean) |
| V6 Cryptography | no | No crypto in scope |

### Known Threat Patterns for React/localStorage client UI

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| localStorage prototype-poison / corrupt read | Tampering | `useCrossTabStorage` strips poison keys at the parse boundary + folds corrupt reads to the default with a recovery breadcrumb (`stripPoisonKeys`, `readDecoded`) — inherited for free |
| Cross-device stale flag survives sign-out | Information Disclosure (minor — a UI note-dismissal is non-sensitive) | Register the prefix in `storage-namespaces.ts` so `purgeAppNamespacedStorage()` clears it on sign-out |
| XSS via rendered date/name strings | Tampering / XSS | React auto-escapes all text nodes; the note/chip/gantt render only strings (dates, N, strategy names) as text children — no `dangerouslySetInnerHTML` |
| Cross-tenant leak via shared window | Information Disclosure | Out of scope — window PERSISTENCE (saved/shared) is Phase 59; Phase 58's window lives only in in-memory component state + one per-device dismissal boolean |

**Net:** the security surface is negligible — no new data flow, no server interaction, no
sensitive value persisted. The one persisted value (a boolean "note dismissed") routes through
the hardened storage primitive and must be registered for the sign-out purge.

## Sources

### Primary (HIGH confidence)
- `src/lib/scenario-window.ts` (read in full) — `coverageSpanOf`/`intersectionOf`/`unionOf`/`covers`/`defaultWindowFor`/`outlierIdsFor` + inclusive-closed containment invariant
- `src/lib/scenario.ts:129-195` — `ComputedMetrics` shape (`member_count`/`member_ids`/`effective_start`/`effective_end`/`n`)
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — `coverageDropReason` (:435), `formatIsoMonth` (:418), `selectedSpanById` (:1639), `coverageWindow`/`applyWindow` (:1684/:1705), `coverageEligible` (:1762), `autoExcluded` (:1787), dev desync guard (:1813), window control (:2828), auto-excluded group (:3518), `AutoExcludedRow` (:3678)
- `src/lib/dateday.ts` (read in full) — `utcEpoch`/`diffDays`/`parseIsoDay` timezone-stable scale primitives
- `src/lib/storage/cross-tab.ts` + `src/lib/storage/codecs.ts` — `useCrossTabStorage` + `rawStringCodec` SSR-safe persistence
- `src/components/ui/CollapsibleSection.tsx` — collapsed-by-default host + its deferred-hydration pattern
- `src/components/ui/Badge.tsx` — base chip shape
- `src/lib/storage-namespaces.ts` — `APP_NAMESPACED_PREFIXES` + `purgeAppNamespacedStorage`
- `e2e/composer-axe.spec.ts` (read in full) — whole-`<main>` WCAG-AA scan; serious+critical gate
- `src/__tests__/phase-52-frozen-spine-guards.test.ts` — confirms `scenario.ts`/`compute.ts` are git-delta-frozen; Phase 58 files not in the list
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx:186-215, 5138-5340` — the picker-capture + REAL-computeScenario test rig to replicate
- `DESIGN.md` — color tokens, badge ladder, motion tokens, `role=status`/`role=alert` a11y rule, `duration-300`-for-250ms
- `.planning/phases/58-coverage-legibility-disclosure/58-CONTEXT.md`, `58-UI-SPEC.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`
- `package.json` — react 19.2.7, next ^16.2.3, recharts ^3.9.0, vitest ^4.1.2

### Secondary (MEDIUM confidence)
- None required — every claim resolved against primary in-repo sources.

### Tertiary (LOW confidence)
- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all versions verified in `package.json`; all reused assets read directly
- Architecture: HIGH — the membership-single-source rule + desync guard + all memos verified in situ
- Pitfalls: HIGH — every pitfall is a documented in-repo precedent (`H-1224` timezone, recharts accessibilityLayer, `duration-250`, B25 lint, coverage ratchet)

**Research date:** 2026-07-01
**Valid until:** 2026-07-31 (stable — internal codebase surface; no fast-moving external dep). Re-verify only if `ScenarioComposer.tsx` line anchors shift materially or `ComputedMetrics` changes.
