# Phase 57: Window Control & Auto-Toggle State Machine - Research

**Researched:** 2026-07-01
**Domain:** Client-side React state machine + coverage-window UI on the `/allocations` scenario tab (Next.js client component, zero new deps)
**Confidence:** HIGH (all findings verified by direct source read of the exact files the plan touches)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions (ADR-001 + accepted UX, 2026-07-01)
- **State machine (ADR §"UI state machine"):** per selected strategy, `selected` (user subset) + `coverageEligible` (DERIVED: `covers(coverageSpanOf(returns), [winStart,winEnd])` via `scenario-window.ts`). **In-blend iff `selected && coverageEligible`.**
- `winStart`/`winEnd` are state. On any window change → recompute `coverageEligible` for every selected strategy (pure). No-longer-covering → **auto-off (coverage)**, visually distinct from manual off; excluded from blend + divisor. The scenario tab passes the explicit `window` to `computeScenario`.
- **Default & snap target = the max-overlap (intersection) window** of selected+on via `defaultWindowFor()` — default + snap target, NOT a hard cap (WINDOW-01).
- Widening past a strategy's coverage → auto-OFF (WINDOW-02); narrowing until it regains full coverage → auto-ON — ONLY within the user's selected subset, never adds an unselected strategy (WINDOW-03).
- **"Common period (all in)"** preset → snap `[max(firstDate over selected), min(lastDate over selected)]`, all selected become members (WINDOW-04). **"Full range (some drop out)"** preset → widen to the union of the selected set, auto-dropping non-covering members (WINDOW-05).
- **Empty intersection** → guided fix (WINDOW-06), not a dead-end.
- **Manual off** = remove from subset (`selected=false`), permanent until re-added; DISTINCT from coverage auto-off.
- Zero-member window → honest empty-state (engine already guards, BLEND-05).
- **Window control form factor:** REUSE / adapt `CustomRangePicker` (two-date + presets rail, `onApply({start,end})`, `min`/`max` Date, `initialRange`). Add the two coverage presets to/near it. Gantt-brush deferred to Phase 58.
- **Auto-toggle presentation (POLISH-02):** dropped row **animates (fade + slide)** into a visually-distinct **"auto-excluded (outside window)"** group with an inline reason (e.g. "ends Jan 2025 — outside window"); manual-excluded is a separate state; respect `prefers-reduced-motion`.
- **Empty-intersection guidance (WINDOW-06):** inline **warning banner** above the control naming outlier(s) + one-click **"deselect {X}"**; guided fix, not a modal.
- **POLISH-01 (LOCKED):** chart brush-zoom stays a VIEW control, visually distinct from the analytical coverage window — NEVER merged. `rollingWindow` (63/126/252 rolling-metrics axis) and per-strategy `startDates` (legacy include-from) are SEPARATE axes — do NOT conflate any with coverage `[winStart,winEnd]`.
- **DESIGN.md governs all visuals** — executor MUST read it; WCAG-AA floor holds.

### Claude's Discretion
- Exact placement of the window control + preset buttons within `ScenarioComposer` layout (follow DESIGN.md + existing composer structure).
- The `useScenarioState` internal shape for `winStart/winEnd` + the `coverageEligible` memo (pure, derived from coverage spans; debounce window changes into `computeScenario` like the existing weight-edit debounce if perf needs it).
- Animation implementation (CSS transition vs a lib already present) — no new deps.

### Deferred Ideas (OUT OF SCOPE)
- Coverage mini-gantt (COVERAGE-01), rich per-row three-state chips + reasons (COVERAGE-02), blend header member·window·N (COVERAGE-03), include-cost affordance (COVERAGE-04), one-time default-change note (POLISH-03) — all **Phase 58**.
- Persisting `[winStart,winEnd]` in `ScenarioDraft` + migration + shared/compare — **Phase 59**.
- Golden/e2e re-bake — **Phase 60**. Authed prod canary — **Phase 61**.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| WINDOW-01 | Default timeline = max-overlap intersection of selected+on (default + snap target, not hard cap) | `defaultWindowFor(spans)` returns the intersection window (`scenario-window.ts:91`); feed selected+eligible coverage spans. Composer already builds the strategy set with returns — derive spans via `coverageSpanOf`. |
| WINDOW-02 | Widening past a strategy's coverage auto-toggles it OFF | `covers(span, window)` returns false when `span.last < window.end` (`scenario-window.ts:103`). Derived `coverageEligible` memo flips false → excluded from the `window`-present blend automatically (engine already drops non-covering members, `scenario.ts:263-268`). |
| WINDOW-03 | Narrowing until it regains coverage auto-toggles it back ON — only within selected subset | Same `covers` predicate flips true on narrow. In-blend gate = `selected && coverageEligible`; `selected` (subset membership) is never mutated by coverage — auto-on only restores an already-selected strategy. |
| WINDOW-04 | "Common period (all in)" preset → snap to selected set's common overlap, all in | `defaultWindowFor(spansOfSelected)` = `[max(firsts), min(lasts)]`. Set `winStart/winEnd` to it; every selected strategy covers it by construction → all eligible. |
| WINDOW-05 | "Full range (some drop out)" preset → union of selected, auto-drop non-covering | Union = `[min(firsts), max(lasts)]` over selected spans (small addition — see Preset Math). Set window; `coverageEligible` drops any strategy whose span doesn't ⊇ the union (only those spanning the full union survive). |
| WINDOW-06 | Empty intersection → name outlier(s) + one-click deselect (guided fix) | `intersectionOf(spans)` returns `null` when `start > end` (`scenario-window.ts:73-82`). Detect null → identify outlier(s) whose span doesn't overlap the rest → warning banner + "deselect {X}" calls the existing `onToggle`/removeAddedStrategy path. |
| POLISH-01 | Brush-zoom stays a view control, distinct from the analytical window | Brush-zoom lives INSIDE `ScenarioFactsheetChart`'s MasterBrush (`ScenarioComposer.tsx:2474-2494`), `persist=false`, never touches `state.window`. `rollingWindow` is a separate `useState(126)` (`:698`). `startDates` comes from the adapter (`:1501`). Four provably distinct axes documented below. |
| POLISH-02 | Auto-toggle transition animates; dropped row visibly moves | Tailwind `transition-*` + `motion-reduce:transition-none` is the established codebase pattern (`CustomizeDrawer.tsx:158/166`; `globals.css:182` reduced-motion block). DESIGN.md Motion: medium 250ms = `duration-300` (Tailwind v4 has no `duration-250`). |

</phase_requirements>

## Summary

Phase 55 already shipped the entire compute + derivation core. `src/lib/scenario-window.ts` exports the four pure primitives the state machine needs — `coverageSpanOf`, `intersectionOf`, `defaultWindowFor`, `covers` — and `src/lib/scenario.ts` `computeScenario` already honours an optional `state.window` (present-window path blends only members whose coverage span ⊇ the window, constant divisor = member count, honest zero-member empty-state). **No engine change is required.** Phase 57 is purely the client wiring: derive the window + `coverageEligible`, thread `state.window` into the `computeScenario` call, and render the window control + auto-excluded group + empty-intersection banner.

The composer's projection pipeline is a three-stage memo chain: `buildStrategyForBuilderSet` (adapter → `{strategies, state}`) → `projectionState` (overlays draft toggles/weights/leverage) → `collapseAliasedHoldingStrategies` (de-alias) → `computeScenario`. **The single most important integration hazard: `collapseAliasedHoldingStrategies` reconstructs the `ScenarioState` from scratch and only carries `selected`/`weights`/`startDates`/`leverage` — it silently DROPS `state.window`.** So injecting `window` into `projectionState` alone will not reach the engine; the plan must either extend the collapse to carry `window` (mirror the `leverage?` pattern at `scenario-dealias.ts:89-100,163-165`) or inject `window` onto `deAliased.state` after the collapse and before `computeScenario` (`ScenarioComposer.tsx:1519-1533`). The latter is smaller and lower-risk.

`useScenarioState` operates on a `ScenarioDraft` (localStorage-persisted UI edit state: `toggleByScopeRef`, `weightOverrides`, `addedStrategies`), NOT the engine `ScenarioState`. `winStart`/`winEnd` are EPHEMERAL this phase (persistence is deferred to Phase 59), so the cleanest home is composer-local `useState` (or a small hook extension that deliberately does NOT persist), sidestepping a schema_version bump. `coverageEligible` is a pure `useMemo` over the strategy set's coverage spans + the window — never persisted, always re-derived.

**Primary recommendation:** Add ephemeral `winStart`/`winEnd` composer state (default via `defaultWindowFor` over the selected+eligible spans), derive `coverageEligible` as a pure memo, inject `{ start: winStart, end: winEnd }` onto `deAliased.state` immediately before `computeScenario`, reuse `CustomRangePicker` verbatim for the two-date control with two coverage-preset buttons rendered alongside it, and render an "auto-excluded (outside window)" group + empty-intersection warning banner using Tailwind `transition-*`/`motion-reduce:transition-none` + DESIGN.md warning tokens. Do NOT extend Phase 58's rich legibility (gantt, three-state chips, blend header).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Window state (`winStart`/`winEnd`) | Browser / Client (composer `useState`) | — | Ephemeral this phase (persist = Phase 59); a what-if overlay, never server state |
| `coverageEligible` derivation | Browser / Client (pure `useMemo`) | `src/lib/scenario-window.ts` (pure fns) | Derived from in-memory returns; no I/O; must re-run on window change |
| Blend membership + divisor | `src/lib/scenario.ts` engine | — | Already owns it (present-window path); composer only PASSES the window |
| Coverage-span math | `src/lib/scenario-window.ts` (Phase 55) | — | SINGLE source of truth; UI must NOT re-derive intersection/coverage logic |
| Window control UI | Browser / Client (`CustomRangePicker` reuse) | — | Client-only popover; no SSR/RSC surface |
| Auto-excluded group + banner | Browser / Client (`ScenarioComposer` JSX) | — | Presentation derived from `coverageEligible` + spans |
| Persistence of window | (OUT OF SCOPE — Phase 59) | — | Deferred; keep window OUT of `ScenarioDraft` this phase |

## Standard Stack

No new packages. This phase is entirely internal client wiring over already-present code.

### Core (already in the repo — consume, do not re-derive)
| Module | Purpose | Why Standard |
|--------|---------|--------------|
| `src/lib/scenario-window.ts` | `coverageSpanOf`, `intersectionOf`, `defaultWindowFor`, `covers` | Phase 55 SINGLE source of truth for window derivation + coverage predicate. ADR §"UI state machine" mandates the UI derive membership IDENTICALLY to the engine via these. |
| `src/lib/scenario.ts` `computeScenario` | Blend engine; honours optional `state.window` | Already emits `member_count`/`member_ids`/`effective_start`/`effective_end` and the honest zero-member empty-state. |
| `CustomRangePicker` (`allocations/components/CustomRangePicker.tsx`) | Two-date + presets-rail popover; `onApply({start,end})`, `min`/`max` Date, `initialRange` | Locked reuse (CONTEXT). Already a11y-hardened: `role="dialog"`, Esc/outside-click dismiss, `start ≤ end` clamp + disabled Apply, aria-live clamp announcement. |
| `src/lib/dateday.ts` | `parseIsoDay`, `isoDayFromDate`, `localMidnight`, `diffDays` | The lexicographic "YYYY-MM-DD" convention `scenario-window` and `CustomRangePicker` both use — no JS Date TZ off-by-one. |

### Supporting (already imported in the composer)
| Module | Purpose | When to Use |
|--------|---------|-------------|
| `collapseAliasedHoldingStrategies` (`scenario-dealias.ts`) | De-alias multi-venue holdings before the engine | Already in the pipeline; MUST be made window-aware OR bypassed for window injection (see hazard). |
| `buildStrategyForBuilderSet` (`scenario-adapter.ts`) | Adapter → `{strategies, state}` | Source of `strategies` (with `daily_returns`) → coverage spans derive from these. |
| DESIGN.md warning tokens (`--color-warning` #B45309, `--color-warning-bg`/`border` #FEF3C7/#FDE68A) | Empty-intersection banner + auto-excluded styling | WCAG-AA verified (5.05:1 on white). |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Ephemeral composer `useState` for window | Persist `winStart/winEnd` in `ScenarioDraft` | Persistence is EXPLICITLY Phase 59 (deferred). Adding it now forces a `SCENARIO_SCHEMA_VERSION` bump + migration + share/compare — out of scope. Keep it ephemeral. |
| Reuse `CustomRangePicker` verbatim | New coverage-specific picker | CONTEXT locks the reuse. The two coverage presets are the ONLY delta; render them as sibling buttons, not fork the component. |
| Inject `window` after collapse | Extend collapse to carry `window` | Both valid; post-collapse injection is smaller (1 line) and avoids touching the frozen-ish de-alias contract + its tests. Extending the collapse is more "correct" long-term but larger diff. Planner picks; document the hazard either way. |

**Installation:** None. `git grep` confirms zero new dependencies. No package-version verification needed — no packages added.

## Package Legitimacy Audit

**Not applicable.** This phase installs zero external packages (confirmed: pure internal wiring over `src/lib/scenario-window.ts`, `src/lib/scenario.ts`, `CustomRangePicker`, and `ScenarioComposer`). No `npm install` step. Slopcheck/registry verification is vacuous.

## Architecture Patterns

### System Architecture Diagram

```
                    ScenarioComposer (client component)
                              │
   ┌──────────────────────────┼───────────────────────────────────┐
   │                          │                                    │
[useScenarioState]     [NEW: winStart/winEnd useState]      [rollingWindow useState]  ← SEPARATE axis
   │ draft:                   │  default = defaultWindowFor(          (63/126/252)
   │  toggleByScopeRef        │            selectedEligibleSpans)          │
   │  weightOverrides         │                                            ▼
   │  addedStrategies         ▼                              [buildBlendPanels] (rolling)
   │                  [CustomRangePicker]  ← REUSE
   ▼                   onApply({start,end}) → setWinStart/setWinEnd
[buildStrategyForBuilderSet]  + 2 preset buttons:
   → {strategies (w/ daily_returns), state}   • Common period (all in) → defaultWindowFor(selected)
   │                                           • Full range (some drop) → union(selected)
   ▼
[projectionState memo]  overlays draft toggles/weights/leverage
   │  {selected, weights, startDates, leverage}   ← startDates = SEPARATE legacy axis
   ▼
[NEW: coverageEligible memo]  ← PURE, per selected strategy:
   │   covers(coverageSpanOf(s.daily_returns), {winStart,winEnd})
   │   ↳ drives the auto-excluded GROUP + inline reason + empty-intersection detection
   ▼
[collapseAliasedHoldingStrategies]  ⚠️ DROPS state.window — reconstructs {selected,weights,startDates,leverage}
   │
   ▼
[deAliased.state]  ← ⚠️ INJECT { window: {start:winStart, end:winEnd} } HERE (post-collapse)
   │
   ▼
[computeScenario(deAliased.strategies, deAliased.state, cache)]
   → ComputedMetrics { …, member_count, member_ids, effective_start/end, portfolio_daily_returns }
   │
   ▼
[ScenarioFactsheetChart]  ← MasterBrush brush-zoom (persist=false) = SEPARATE VIEW axis (POLISH-01)
```

**Trace the primary use case (widen → drop):** user drags End past a strategy's last data day in `CustomRangePicker` → `onApply` → `setWinEnd` → `coverageEligible` memo re-runs → that strategy's `covers()` flips false → it animates into the auto-excluded group AND `deAliased.state.window` re-derives → `computeScenario` re-blends without it → divisor drops by one, tail no longer diluted.

### Recommended integration points (file:line map)

```
ScenarioComposer.tsx
├─ :698   const [rollingWindow] = useState(126)      ← EXISTING separate axis (do not touch)
├─ :1300  disabledHoldingRefs (empty)
├─ :1302  adapterOutput = buildStrategyForBuilderSet(...)   ← strategies carry daily_returns
├─ :1463  projectionState memo {selected,weights,startDates,leverage}
├─ :1519  deAliased = collapseAliasedHoldingStrategies(...)  ⚠️ drops window
├─ :1528  dateMapCache = buildDateMapCache(deAliased.strategies)
├─ :1532  scenarioMetrics = computeScenario(deAliased.strategies, deAliased.state, cache)
│         ↑ NEW: inject window onto deAliased.state before this call
├─ :2053  if (isEmptyState) return <blank slate>   ← window control mounts AFTER this (composed branch only)
├─ :2474  ScenarioFactsheetChart + MasterBrush (persist=false)  ← brush-zoom VIEW axis (POLISH-01)
├─ :2995  CollapsibleSection "Strategies & weights"
└─ :3168  CompositionList (rows)  ← auto-excluded group renders near/within this
```

### Pattern 1: Ephemeral window state + default from intersection
**What:** `winStart`/`winEnd` as composer `useState`, seeded from `defaultWindowFor` over the selected+eligible coverage spans.
**When to use:** This phase (persistence deferred to 59). Keeps window out of `ScenarioDraft` (no schema bump).
**Example (shape only — planner writes the code):**
```typescript
// Source: derived from scenario-window.ts:91 (defaultWindowFor) + composer strategy set
// spans = coverage spans of the currently-selected strategies (from their daily_returns)
// default window = defaultWindowFor(spans)  → intersection [max(firsts), min(lasts)] | null
// null (empty intersection) → no default window; render the WINDOW-06 banner instead
```

### Pattern 2: Pure `coverageEligible` memo (the derivation the ADR mandates)
**What:** `Record<strategyId, boolean>` = per selected strategy, `covers(coverageSpanOf(returns), window)`.
**When to use:** Re-derived on EVERY window change or selection change. Drives the auto-excluded group, the inline reason, and empty-intersection detection.
**Example:**
```typescript
// Source: scenario-window.ts:53 (coverageSpanOf), :103 (covers)
// for each selected strategy s:
//   span = coverageSpanOf(s.daily_returns)   // [first,last] | null
//   eligible[s.id] = span !== null && covers(span, {start:winStart,end:winEnd})
// In-blend iff selected[s.id] && eligible[s.id]  (ADR §"UI state machine")
// This memo is the SAME predicate the engine applies internally (scenario.ts:263-268),
// so the UI's auto-excluded group and the engine's divisor can never disagree.
```

### Pattern 3: Post-collapse window injection (the hazard fix)
**What:** Inject `window` onto `deAliased.state` after `collapseAliasedHoldingStrategies`, before `computeScenario`.
**Why:** The collapse reconstructs the state and drops `window` (see Common Pitfalls #1).
**Example (shape):**
```typescript
// Source: ScenarioComposer.tsx:1519-1533; scenario-dealias.ts:161-166
// const engineState = window ? { ...deAliased.state, window } : deAliased.state;
// scenarioMetrics = computeScenario(deAliased.strategies, engineState, dateMapCache)
// Only attach window on the composed scenario-tab path; own-book callers stay union-path.
```

### Anti-Patterns to Avoid
- **Merging the coverage window with the brush-zoom.** POLISH-01 LOCKED. The brush-zoom is a VIEW control inside `ScenarioFactsheetChart` (`persist=false`); it must never write `state.window`, and the coverage window must never drive the brush.
- **Re-deriving intersection/coverage math in the composer.** Use `scenario-window.ts` verbatim (ADR: "USE THESE — do not re-derive"). A second implementation reintroduces the off-by-one (`<` vs `<=`) the Phase-55 tests pin.
- **Persisting `winStart`/`winEnd` in `ScenarioDraft`.** That is Phase 59. A schema field now forces a version bump + migration + share/compare, all out of scope.
- **Forking `CustomRangePicker`.** The two coverage presets are sibling buttons; the component's a11y + clamping is reused as-is.
- **Deriving the auto-excluded group from the engine's `member_ids` alone.** `member_ids` tells you WHO is in the blend, but the UI also needs the DISTINCTION between manual-off (`selected=false`) and coverage-off (`selected && !coverageEligible`) — that requires the composer-level `coverageEligible` memo, not just the engine output. (The engine's `member_ids` is a good cross-check but not sufficient for the three-state distinction.)
- **Over-building into Phase 58.** No mini-gantt, no per-row three-state chips with rich reasons, no `member·window·N` blend header, no one-time default-change note. Deliver the FUNCTIONAL group + a MINIMAL honest label + the animation only.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Coverage span of a series | min/max date loop | `coverageSpanOf(returns)` (`scenario-window.ts:53`) | Handles empty series (→null), unsorted defensively, lexicographic compare. |
| Intersection / default window | `[max(firsts), min(lasts)]` by hand | `intersectionOf` / `defaultWindowFor` (`:73`/`:91`) | Returns `null` on empty intersection (`start>end`) — the WINDOW-06 signal — instead of a fabricated window. |
| Coverage-eligibility predicate | `span.first <= start && span.last >= end` inline | `covers(span, window)` (`:103`) | INCLUSIVE-CLOSED containment; the `<=`/`>=` off-by-one is the exact Pitfall-1 the Phase-55 tests lock. |
| Two-date range control + presets | New picker | `CustomRangePicker` | a11y (`role=dialog`, Esc/outside-click, aria-live clamp), `start≤end` clamp, dual-month grid all done. |
| Local-midnight ↔ ISO date | `new Date(str)` | `dateday.ts` helpers | Avoids the UTC/local off-by-one the whole `dateday` module exists to kill. |
| Reduced-motion gating | JS `matchMedia` listener | Tailwind `motion-reduce:transition-none` / `motion-safe:` + `globals.css` block | Established codebase convention (`CustomizeDrawer.tsx:158/166`); no JS, no hydration mismatch. |

**Key insight:** Phase 55 deliberately front-loaded ALL the window math into `scenario-window.ts` and the engine so Phase 57 is a thin wiring layer. Any window/coverage math written in the composer is a smell — it belongs in the already-tested library.

## Common Pitfalls

### Pitfall 1: `collapseAliasedHoldingStrategies` silently drops `state.window`
**What goes wrong:** You set `window` on `projectionState`, but `computeScenario` never sees it — the blend stays on the legacy union path and NOTHING changes. Silent: no error, no type failure (window is optional).
**Why it happens:** `collapseAliasedHoldingStrategies` (`scenario-dealias.ts:60-166`) reconstructs a fresh `ScenarioState` and returns only `{selected, weights, startDates}` or `{selected, weights, startDates, leverage}` (`:161-166`). `window` is not in the `carry()` closure (`:96-101`) nor the return. It is dropped.
**How to avoid:** Inject `window` onto `deAliased.state` AFTER the collapse (`ScenarioComposer.tsx:1519`), before `computeScenario` (`:1532`) — OR extend the collapse to carry `window` (mirror the `leverage?` handling at `:89-100,163-165`). Post-collapse injection is the smaller, lower-risk change.
**Warning signs:** `scenarioMetrics.member_count === activeStrategies.length` even after widening past an ended strategy; the auto-excluded group renders (UI-derived from `coverageEligible`) but the KPIs / divisor don't change (engine still on union path). This desync is the tell.

### Pitfall 2: Membership desync between UI group and engine divisor
**What goes wrong:** The auto-excluded group shows N strategies dropped, but `member_count` says a different set is in the blend.
**Why it happens:** The UI's `coverageEligible` and the engine's internal membership are computed on DIFFERENT strategy sets (pre-collapse vs post-collapse) or with a different window value.
**How to avoid:** Derive `coverageEligible` from the SAME window value passed to the engine, and reconcile against `scenarioMetrics.member_ids` as a dev-mode invariant. Note the collapse merges aliased holdings — the UI group is per-row (pre-collapse) while the engine members are post-collapse; for the scenario tab the added-strategy rows (the toggle-able ones) are passthrough (not collapsed), so they align. Document this seam.

### Pitfall 3: Default window recomputes and fights the user
**What goes wrong:** Every time the user narrows the window, the "default = intersection" logic snaps it back.
**Why it happens:** Treating `defaultWindowFor` as a controlled value rather than an initial seed.
**How to avoid:** `defaultWindowFor` seeds the INITIAL window state (and is the target of the "Common period" preset button), but once the user sets a window it is the source of truth until they hit a preset. Seed once (e.g. lazy `useState` initializer or a "not yet user-touched" guard), re-seed only on an explicit preset click or a selection change that invalidates the current window.

### Pitfall 4: Empty-intersection default → no window at all
**What goes wrong:** Selected set shares no common window; `defaultWindowFor` returns `null`; you feed `null` as the window and the engine runs the union path (or you crash).
**Why it happens:** `intersectionOf`/`defaultWindowFor` return `null` when `start > end` (`scenario-window.ts:81`).
**How to avoid:** `null` is the WINDOW-06 trigger, not an error. Detect it, render the warning banner naming the outlier(s), and do NOT pass a window (or pass the last-valid one). The outlier is the strategy whose span pushes `max(firsts) > min(lasts)` — i.e. its `first` is the latest OR its `last` is the earliest, breaking the overlap. Reuse `coverageSpanOf` per strategy to find it.

### Pitfall 5: `motion-reduce` applied only to the enter, not the group transition
**What goes wrong:** The fade+slide honours reduced-motion, but a residual transition on the group container still animates.
**Why it happens:** Partial application of `motion-reduce:transition-none`.
**How to avoid:** Apply `motion-reduce:transition-none` on every element that carries a `transition-*` for the auto-toggle move. DESIGN.md: medium 250ms = Tailwind `duration-300` (`duration-250` is not a valid Tailwind v4 token and silently drops — DESIGN.md:152). "No decorative animation" (DESIGN.md:153) — the move must aid comprehension (row visibly relocating to the excluded group), nothing more.

### Pitfall 6: composer-axe e2e goes red on the new controls
**What goes wrong:** The window-control popover, preset buttons, or banner introduce a WCAG-AA violation (missing label, low contrast) and `composer-axe.spec.ts` fails.
**Why it happens:** New interactive controls without `aria-label`/associated `<label>`, or warning text below 4.5:1.
**How to avoid:** `composer-axe.spec.ts` is ALREADY in the CI seeded list (`ci.yml:1378`) and scans the composed surface after adding a strategy — so it WILL scan the new controls; NO FLOW-01 wiring needed (it's not a new spec). Use DESIGN.md warning tokens (AA-verified) and label every control (`CustomRangePicker` already does; the preset buttons + "deselect {X}" need explicit labels). The banner should use `aria-live="polite"` (mirror `CustomRangePicker`'s clamp region) and `role` appropriate to a warning.

## Code Examples

Verified patterns from the actual codebase (shapes, not full implementations):

### Reuse CustomRangePicker (exact current mount pattern)
```tsx
// Source: EquityChart.tsx:1324-1336 — the canonical open/apply pattern
{pickerOpen && (
  <CustomRangePicker
    isOpen={pickerOpen}
    onClose={() => setPickerOpen(false)}
    onApply={({ start, end }) => { setWinStart(start); setWinEnd(end); setPickerOpen(false); }}
    min={/* union earliest firstDate over selected, as a local-midnight Date */}
    max={/* union latest lastDate over selected, as a local-midnight Date */}
    initialRange={{ start: winStart, end: winEnd }}
  />
)}
```

### Reduced-motion-safe transition (codebase convention)
```tsx
// Source: CustomizeDrawer.tsx:158,166 — transition + motion-reduce:transition-none
// className="... transition-transform duration-300 ease-out motion-reduce:transition-none ..."
// Enter: ease-out (DESIGN.md:149). Medium 250ms → duration-300 (DESIGN.md:152).
```

### Engine call with injected window (the one-line seam)
```tsx
// Source: ScenarioComposer.tsx:1519-1533 — inject window post-collapse
const engineState = win ? { ...deAliased.state, window: win } : deAliased.state;
const scenarioMetrics = useMemo(
  () => computeScenario(deAliased.strategies, engineState, dateMapCache),
  [deAliased.strategies, engineState, dateMapCache],
);
// win = { start: winStart, end: winEnd } | null (null when empty-intersection / untouched)
```

### Preset math (helpers already cover intersection; union is the small addition)
```typescript
// "Common period (all in)"  = defaultWindowFor(spansOfSelected)   // scenario-window.ts:91 (intersection)
// "Full range (some drop out)" = union of selected spans:
//    unionStart = min over spans of span.first  (lexicographic)
//    unionEnd   = max over spans of span.last
//    → set window; coverageEligible then drops any strategy whose span ⊄ [unionStart,unionEnd]
// Union is a ~5-line pure helper; consider adding `unionOf(spans)` to scenario-window.ts
// for symmetry with intersectionOf, OR compute inline in the composer. Zero new deps either way.
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Scenario tab passes NO window (union-when-absent, tail-diluted) | Scenario tab passes explicit `state.window` | Phase 57 (this phase) | First phase where the coverage-window blend is user-visible; the ended-strategy tail-dilution disappears. |
| Coverage math scattered / would-be-inline | Centralized in `scenario-window.ts` | Phase 55 | UI derives membership IDENTICALLY to the engine; no drift. |
| Manual toggle only (P37/P38) | Manual toggle + derived coverage auto-toggle | Phase 57 | Two independent axes: `selected` (manual subset) × `coverageEligible` (derived); in-blend = both true. |

**Deprecated/outdated:** Nothing removed. The `leverage?`/`window?` optional-additive-field precedent (`scenario.ts:109/126`) is the model for how `window` threads through without breaking own-book callers.

## Runtime State Inventory

Not a rename/refactor/migration phase — greenfield UI wiring over existing code. Section omitted per template (no stored data, service config, OS state, secrets, or build artifacts embed a renamed string).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Ephemeral composer `useState` for the window is the right home (vs a non-persisting `useScenarioState` extension) | Standard Stack / Pattern 1 | LOW — both are ephemeral this phase; if the planner prefers the hook, the derivation is identical. Discretion area per CONTEXT. |
| A2 | Post-collapse window injection is preferred over extending `collapseAliasedHoldingStrategies` | Alternatives / Pitfall 1 | LOW — both reach the engine correctly; this is a size/risk tradeoff, not correctness. Either satisfies the requirement. |
| A3 | The "Full range" union needs a small `unionOf`-style helper (not already in `scenario-window.ts`) | Preset Math | LOW — verified `scenario-window.ts` exports only intersection-side helpers; union is a ~5-line addition. If a union helper is added, it should live in `scenario-window.ts` for symmetry. |
| A4 | composer-axe will scan the new controls without new CI wiring | Pitfall 6 | LOW — verified it's already in `ci.yml:1378` and scans the composed surface post-add; the new controls mount in that same composed branch. |

**Note:** All four assumptions are LOW-risk discretion/tradeoff calls, not factual uncertainties. Every load-bearing claim (helper signatures, engine window path, collapse dropping window, mount points) is VERIFIED by direct source read.

## Open Questions

1. **Where exactly does the window control mount in the composed layout?**
   - What we know: it must be in the composed branch (after `isEmptyState` early-return at `:2053`), and CONTEXT gives placement to Claude's discretion within DESIGN.md.
   - What's unclear: above the factsheet chart vs near the CompositionList vs a dedicated control row.
   - Recommendation: place it near the top of the composed surface (above or beside the strategy controls) so the window is set BEFORE reading the blend, mirroring how the rolling-window control sits above its graph. Planner + DESIGN.md decide; the auto-excluded group should sit adjacent to CompositionList (`:3168`) since it is a variant of the strategy rows.

2. **Does the "deselect {X}" action in the empty-intersection banner use `onToggle` or `removeAddedStrategy`?**
   - What we know: manual-off = `selected=false` = `onToggle` for the toggle-able (added-strategy) rows; holdings are read-only (no toggle in the v2 model).
   - What's unclear: whether an outlier can be a holding (read-only) — if so, "deselect" has no affordance for it.
   - Recommendation: the outlier will in practice be an added strategy (the only toggle-able unit); "deselect {X}" calls `onToggle(x.id)`. If the outlier is a holding, the banner should say so honestly (holdings are fixed context) — but this is an edge case; confirm the toggle-able set with the planner.

## Environment Availability

Not applicable. This phase has no external dependencies — it is client-side React/TypeScript changes over existing modules. No CLI tools, services, runtimes, or databases are introduced. (Step 2.6: SKIPPED — no external dependencies.)

## Validation Architecture

`workflow.nyquist_validation` is `true` (`.planning/config.json`). Section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (frontend) + `@vitest/coverage-v8`; Playwright (e2e) |
| Config file | `vitest.config.ts` (coverage thresholds: lines 82 / stmts 80 / fns 74 / branches 72 per CLAUDE.md) |
| Quick run command | `npx vitest run src/app/\(dashboard\)/allocations/hooks/useScenarioState.test.tsx src/app/\(dashboard\)/allocations/components/CustomRangePicker.test.tsx` |
| Full suite command | `npm test` (frontend vitest) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| WINDOW-01 | Default = intersection window | unit | `npx vitest run src/lib/scenario-window.test.ts` (helper) + new composer/hook test | ✅ helper / ❌ Wave 0 composer |
| WINDOW-02 | Widen → auto-off | unit | new `useScenarioState`/composer coverageEligible test | ❌ Wave 0 |
| WINDOW-03 | Narrow → auto-on (only in subset) | unit | new coverageEligible test | ❌ Wave 0 |
| WINDOW-04 | "Common period" preset → all in | unit | new composer test (preset click → window = defaultWindowFor) | ❌ Wave 0 |
| WINDOW-05 | "Full range" preset → union, drop non-covering | unit | new composer test + `unionOf` helper test if added | ❌ Wave 0 |
| WINDOW-06 | Empty intersection → banner + deselect | unit (component) | new `ScenarioComposer.test.tsx` test (render banner, click deselect) | ⚠️ extend existing |
| POLISH-01 | Brush/rolling/startDates stay separate | unit (guard) | new assertion that `state.window` ≠ rollingWindow/brush; the coverage window doesn't reach the brush | ❌ Wave 0 |
| POLISH-02 | Animation + reduced-motion | unit (component) | assert `motion-reduce:transition-none` class present (mirror `AllocatorSyncStatus.test.tsx:540` className-match) | ❌ Wave 0 |
| all | Composed surface stays WCAG-AA | e2e | `npx playwright test e2e/composer-axe.spec.ts` (seeded; already CI-wired) | ✅ |

### Sampling Rate
- **Per task commit:** the quick vitest run above (hook + picker + new coverage tests).
- **Per wave merge:** `npm test` (full frontend vitest) — the 7252-test suite the 55 close ran green must stay green (esp. `scenario.test.ts`, `scenario-dealias.test.ts`, `ScenarioComposer.test.tsx`).
- **Phase gate:** full suite green + `composer-axe.spec.ts` green (seeded) before `/gsd:verify-work`.

### Wave 0 Gaps
- [ ] `useScenarioState` (or composer) coverageEligible derivation tests — covers WINDOW-01/02/03. New test cases; the hook test file (`useScenarioState.test.tsx`) is a candidate but the derivation may live composer-side (discretion) → likely `ScenarioComposer.test.tsx` additions.
- [ ] `ScenarioComposer.test.tsx` additions — window control mount, preset buttons (WINDOW-04/05), empty-intersection banner + deselect (WINDOW-06), auto-excluded group render, `motion-reduce` class (POLISH-02). Extend the existing 214KB spec.
- [ ] `unionOf` helper test in `scenario-window.test.ts` IF a union helper is added (WINDOW-05).
- [ ] POLISH-01 separation guard — a focused test asserting the coverage window is a distinct value from `rollingWindow` and never feeds the brush.
- Framework install: none — Vitest + Playwright already present.

## Security Domain

`security_enforcement` is not present in `.planning/config.json` (treat as enabled), but this phase's threat surface is minimal.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth change; the scenario tab is already behind the authed `/allocations` route. |
| V3 Session Management | no | No session change. |
| V4 Access Control | no | No new data access; all state is client-side ephemeral over already-authorized in-memory returns. |
| V5 Input Validation | yes | `CustomRangePicker` already validates dates via `dateday.parseIsoDay` (rejects `2024-13-01`/`2024-02-31`) + `start≤end` clamp. Window values are ISO strings compared lexicographically — no injection surface (no SQL, no network). |
| V6 Cryptography | no | None. |

### Known Threat Patterns for this stack (client-side React, ephemeral state)
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed date input (rollover garbage) | Tampering | `dateday.parseIsoDay` strict parse (existing); clamp to `[min,max]`. |
| Fabricated/empty window → divide-by-zero or fake curve | Tampering / Info-disclosure | Engine's BLEND-05 zero-member empty-state (`scenario.ts:275-294`) + `intersectionOf` null-on-empty; UI never fabricates a window (WINDOW-06 banner instead). |
| State desync hiding a strategy from the blend without disclosure | Repudiation / Info-integrity | Auto-excluded group makes every coverage-drop VISIBLE with a reason (POLISH-02) — the honesty guarantee the milestone exists for. |

No secrets, no network calls, no server mutation, no PII. The security surface is essentially the existing `CustomRangePicker` input validation, already hardened.

## Project Constraints (from CLAUDE.md / AGENTS.md / DESIGN.md)

- **DESIGN.md is MANDATORY** for all visual/UI decisions (font, color, spacing, motion). Executor MUST read it. Motion: minimal-functional, medium=250ms=`duration-300`, enter=ease-out, "no decorative animation". Color: warning=`#B45309` (amber-700, AA 5.05:1), warning bg/border `#FEF3C7`/`#FDE68A`.
- **AGENTS.md:** "This is NOT the Next.js you know" — read `node_modules/next/dist/docs/` before Next.js code. This phase is client-component work (`"use client"`), no routing/RSC surface, so the caveat is largely inert; still, do not assume Next.js APIs.
- **CLAUDE.md Test Coverage:** vitest coverage is a BLOCKING CI gate (`frontend-coverage` job); thresholds lines 82/stmts 80/fns 74/branches 72. New code must carry tests (Wave 0 gaps above).
- **CLAUDE.md Rule 2 (Simplicity First):** reuse `CustomRangePicker`, reuse `scenario-window.ts` — no new picker, no re-derived math. Rule 3 (Surgical): touch only the composer wiring + a possible `unionOf` helper; do NOT refactor the frozen engine or the de-alias contract beyond the minimal window pass-through.
- **CLAUDE.md Skill routing:** design-system/visual decisions route to design-consultation/design-review skills — relevant when the executor styles the banner + auto-excluded group.
- **Banned packages:** none relevant (no packages added).

## Sources

### Primary (HIGH confidence — direct source read this session)
- `src/lib/scenario-window.ts` (1-106) — `coverageSpanOf`, `intersectionOf`, `defaultWindowFor`, `covers` signatures + null semantics.
- `src/lib/scenario.ts` (76-295) — `ScenarioState.window?`, `ComputedMetrics` (member_count/member_ids/effective_*), present-window blend path, zero-member empty-state.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (698, 1290-1535, 2053-2094, 2460-2575, 3151-3351) — projection pipeline, computeScenario call site, isEmptyState branch, factsheet/brush mount, CompositionList rows, rollingWindow state.
- `src/lib/scenario-dealias.ts` (60-166) — collapse reconstructs state WITHOUT window (the hazard).
- `src/app/(dashboard)/allocations/lib/scenario-adapter.ts` (87-190) — `buildStrategyForBuilderSet` → `{strategies (daily_returns), state{selected,weights,startDates}}`; startDates origin.
- `src/app/(dashboard)/allocations/hooks/useScenarioState.ts` (36-324) + `lib/scenario-state.ts` (41-661) — ScenarioDraft shape, schema_version, cross-tab persistence, additive-optional field precedent.
- `src/app/(dashboard)/allocations/components/CustomRangePicker.tsx` (46-528) — props, presets rail, clamping, a11y, aria-live clamp region.
- `src/app/(dashboard)/allocations/widgets/performance/EquityChart.tsx` (1324-1336) — canonical CustomRangePicker mount/apply pattern.
- `.planning/SCENARIO-COVERAGE-WINDOW-ADR.md` (105-116) — the exact state-machine spec.
- `.planning/REQUIREMENTS.md` (36-47, 69-70, 115-126) — WINDOW/POLISH/COVERAGE requirement text + phase assignment.
- `.planning/phases/55-*/55-04-SUMMARY.md` — confirms no consumer passes state.window until Phase 57; floor gates fire on the shorter series here.
- `DESIGN.md` (94-153) — Color (warning tokens) + Motion (duration-300, ease-out, no decorative animation).
- `src/app/globals.css` (182-199) — reduced-motion block.
- `.github/workflows/ci.yml` (1378) + `e2e/composer-axe.spec.ts` (1-60) — composer-axe already CI-wired on the seeded composed surface.
- `src/components/strategy/CustomizeDrawer.tsx` (158,166) + `AllocatorSyncStatus.tsx` (142) — `motion-reduce:transition-none` / `motion-safe:` convention.

### Secondary (MEDIUM confidence)
- `useScenarioState.test.tsx` (101-806 describe/it survey) — existing test surface to extend.

### Tertiary (LOW confidence)
- None. Every claim is source-verified.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages; all reused modules read directly.
- Architecture / integration map: HIGH — the pipeline (`adapter → projectionState → collapse → computeScenario`) and the window-drop hazard verified line-by-line.
- Pitfalls: HIGH — the collapse-drops-window hazard and the membership-desync seam are verified from source, not inferred.

**Research date:** 2026-07-01
**Valid until:** 2026-07-31 (stable — internal code; only risk is a concurrent refactor of `ScenarioComposer.tsx` or `scenario-dealias.ts` moving the cited line numbers).
