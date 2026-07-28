# Phase 57: Window Control & Auto-Toggle State Machine - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — ADR-001 locks the behavior; user answered the 3 open UX-presentation decisions.

<domain>
## Phase Boundary

Give the allocator a **coverage-window control** on the `/allocations` scenario tab and a
**client-side auto-toggle state machine** so membership adjusts honestly as the window
moves. The engine capability landed in Phase 55 (`computeScenario` + `scenario-window.ts`);
this phase wires the UI + `useScenarioState` so the scenario tab actually PASSES an explicit
`window` and reacts to it. Requirements: **WINDOW-01…06, POLISH-01, POLISH-02**.

**In scope:** the window control (set `[winStart, winEnd]`), the derived `coverageEligible`
gate + auto on/off within the selected subset, the two presets ("Common period (all in)" /
"Full range (some drop out)"), the empty-intersection guided fix, the auto-toggle animation,
and keeping the chart brush-zoom a separate VIEW axis.

**Out of scope:** the coverage mini-gantt + per-row reason chips + blend header + the
one-time default-change note (all **Phase 58** legibility — this phase delivers the
*mechanism*, 58 delivers the *legibility*); persistence of the window (**Phase 59**);
golden re-bake (**60**); authed canary (**61**). Some visual disclosure (the auto-excluded
group + inline reason) is a natural seam with 58 — deliver the functional state + a minimal
honest presentation here; the rich gantt/legibility is 58.
</domain>

<decisions>
## Implementation Decisions

### ADR-001 locked behavior (WINDOW-01…06, the state machine — ADR §"UI state machine")
- State per selected strategy: `selected` (in the user's subset) + `coverageEligible`
  (DERIVED: `covers(coverageSpanOf(returns), [winStart,winEnd])` via `scenario-window.ts`).
  **In-blend iff `selected && coverageEligible`.**
- `winStart`/`winEnd` are state. On any window change → recompute `coverageEligible` for
  every selected strategy (pure). No-longer-covering → **auto-off (coverage)**, visually
  distinct from a manual off; excluded from blend + divisor. The scenario tab passes the
  explicit `window` to `computeScenario` (which then emits the member-windowed series).
- **Default & snap target = the max-overlap (intersection) window** of the selected+on set
  via `defaultWindowFor()` — default + snap target, NOT a hard cap (WINDOW-01).
- Widening past a strategy's coverage auto-toggles it OFF (WINDOW-02); narrowing until it
  regains full coverage auto-toggles it back ON — ONLY within the user's selected subset,
  never adds an unselected strategy (WINDOW-03).
- **"Common period (all in)"** preset → snap `[max(firstDate over selected), min(lastDate
  over selected)]`, all selected become members (WINDOW-04). **"Full range (some drop out)"**
  preset → widen to the union of the selected set, auto-dropping non-covering members
  (WINDOW-05).
- **Empty intersection** (selected set shares no common window) → guided fix, not a dead-end
  (WINDOW-06).
- **Manual off** = remove from subset (`selected=false`), permanent until re-added; DISTINCT
  from coverage auto-off.
- Zero-member window → honest empty-state (the engine already guards this — BLEND-05).

### User UX decisions (accepted 2026-07-01)
- **Window control form factor:** REUSE / adapt the existing **`CustomRangePicker`**
  (`src/app/(dashboard)/allocations/components/CustomRangePicker.tsx`) — two-date control
  with a presets rail, `onApply({start,end})`, `min`/`max` Date bounds, `initialRange`. Add
  the two coverage presets ("Common period (all in)" / "Full range (some drop out)") to/near
  it. Precise, keyboard-accessible, reuses a built component (Rule 2). The visual
  gantt-brush is deferred to Phase 58.
- **Auto-toggle presentation (POLISH-02, COVERAGE-02 seam):** a dropped strategy row
  **animates (fade + slide)** into a visually-distinct **"auto-excluded (outside window)"**
  group with an inline reason (e.g. "ends Jan 2025 — outside window"); **manual-excluded**
  stays a separate state. (The full three-state legibility + gantt is Phase 58; here deliver
  the functional group + minimal honest label + the animation.)
- **Empty-intersection guidance (WINDOW-06):** an inline **warning banner** above the window
  control that NAMES the outlier(s) and offers a one-click **"deselect {X}"** action that
  restores a valid intersection — a guided fix, not a modal, not a dead-end.

### POLISH / separation invariants
- **POLISH-01 (LOCKED):** the chart **brush-zoom stays a VIEW control**, visually distinct
  from the analytical coverage window — NEVER merged. Likewise the existing `rollingWindow`
  (3M/6M/12M → 63/126/252 trading-day rolling-metrics axis) and per-strategy `startDates`
  are SEPARATE axes — do NOT conflate any of them with the coverage `[winStart,winEnd]`.
- **POLISH-02:** the auto-toggle transition animates (see UX decision above) — respect
  `prefers-reduced-motion`.
- **DESIGN.md governs all visuals** — the executor MUST read it; WCAG-AA floor holds.

### Claude's Discretion
- Exact placement of the window control + preset buttons within `ScenarioComposer` layout
  (follow DESIGN.md + existing composer structure).
- The `useScenarioState` internal shape for `winStart/winEnd` + `coverageEligible` memo
  (pure, derived from coverage spans; debounce window changes into `computeScenario` like the
  existing weight-edit debounce if perf needs it).
- Animation implementation (CSS transition vs a lib already present) — no new deps.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/app/(dashboard)/allocations/components/CustomRangePicker.tsx` — the two-date +
  presets-rail picker to REUSE for the window control. Props: `onApply({start,end})`,
  `min: Date`, `max: Date`, `initialRange?`, presets rail. Bubbles ISO `{start,end}`.
- `src/lib/scenario-window.ts` (Phase 55) — `coverageSpanOf`, `defaultWindowFor`
  (intersection), `intersectionOf`, `covers`. The SINGLE source for window derivation +
  the coverage-eligibility predicate. USE THESE — do not re-derive.
- `src/lib/scenario.ts` `computeScenario(strategies, state, cache)` — pass
  `state.window = { start: winStart, end: winEnd }` to get the member-windowed series +
  `member_count`/`member_ids`/`effective_start`/`effective_end` in the output.
- `src/app/(dashboard)/allocations/hooks/useScenarioState.ts` — the client scenario-state
  hook (`selected`, `weights`, `startDates`, `leverage?`, `window?`). Extend with
  `winStart`/`winEnd` + the derived `coverageEligible` map + the auto-toggle transitions.
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` — mounts the composer;
  has the per-strategy rows, weight sliders, the SEPARATE `rollingWindow` (GRAPH-03,
  63/126/252) and the factsheet mount. The window control + auto-excluded group land here.

### Established Patterns
- Weight-edit debounce (`ScenarioComposer` WR-01) into the peer-rank fetch — mirror for
  window changes if a recompute-on-drag needs debouncing.
- Additive-optional state fields (the `leverage?`/`window?` precedent).
- `prefers-reduced-motion` + WCAG-AA (v1.3/v1.4 conventions) for the animation.

### Integration Points
- The composer already builds `ScenarioState` from the adapter + client edits and calls
  `computeScenario`. Phase 57 adds the `window` to that state + the coverage-eligibility
  gate BEFORE the compute, and renders the auto-excluded group from `member_ids` /
  `coverageEligible`.
- Distinct axes to keep separate (POLISH-01): coverage `[winStart,winEnd]` (NEW, analytical
  membership) vs `rollingWindow` (rolling-metrics view) vs chart brush-zoom (view) vs
  per-strategy `startDates` (legacy include-from).

</code_context>

<specifics>
## Specific Ideas

- The scenario tab has, until now, NOT passed a `window` (Phase 55 kept union-when-absent
  so nothing regressed). Phase 57 is where the scenario tab STARTS passing an explicit
  window — so this is the first phase where the coverage-window blend is user-visible.
- The auto-excluded group + inline reason is the visible proof of "an ended strategy no
  longer dilutes the tail" — the whole milestone's point becomes tangible here.
- Reuse `CustomRangePicker`'s existing a11y + clamping (start ≤ end) rather than re-solving.
</specifics>

<deferred>
## Deferred Ideas

- Coverage mini-gantt (COVERAGE-01), rich per-row three-state chips + reasons (COVERAGE-02),
  blend header (COVERAGE-03), include-cost affordance (COVERAGE-04), one-time default-change
  note (POLISH-03) — all **Phase 58**.
- Persisting `[winStart,winEnd]` in `ScenarioDraft` + migration + shared/compare — **Phase 59**.
- Golden/e2e re-bake — **Phase 60**. Authed prod canary — **Phase 61**.
