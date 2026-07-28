# Phase 117: UIFIX — tooltip portal + overflow polish - Context

**Gathered:** 2026-07-18
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — mechanical/objectively-correct UI polish; no founder design decision required (DESIGN.md governs all visuals). Grey areas resolved to Claude's Discretion on implementation; acceptance criteria are locked by UIFIX-01/02/03.

<domain>
## Phase Boundary

An orthogonal UI-polish batch — three independent defects, each fixed to its own acceptance criterion:

- **UIFIX-01** — the tooltip must render FULLY when its trigger sits inside a scroll/overflow container: portal to `document.body` + horizontal viewport flip (so an edge-adjacent tooltip stays on-screen), while continuing to work near the viewport edge, inside an open Dialog, and inside the mobile drawer. Client-mount SSR gate (no portal on the server) + disciplined listener mount/unmount.
- **UIFIX-02** — focus rings must NOT be clipped by `overflow-x-auto` containers (WCAG 2.4.7 focus-visible).
- **UIFIX-03** — the factsheet CUM RETURN KPI card must display extreme values (e.g. under high leverage) without truncation/ellipsis; the axe route×viewport matrix must re-run green.

Out of scope: any behavior/data change; the chart `TouchTooltip` (separate component) unless a fix is trivially shared; net-new design tokens.
</domain>

<decisions>
## Implementation Decisions

### Tooltip portal (UIFIX-01)
- Fix the EXISTING `src/components/ui/Tooltip.tsx` (currently `absolute bottom-full … -translate-x-1/2`, 90 lines) — do NOT introduce a new tooltip component or a positioning library. Convert to a `createPortal(..., document.body)` render with fixed-position coordinates computed from the trigger's `getBoundingClientRect()`, keeping the existing vertical flip and ADDING a horizontal viewport flip/clamp so an edge-adjacent tooltip stays fully on-screen.
- Client-mount SSR gate: gate the portal on a mounted flag (no `document` access during SSR). Preserve `role="tooltip"` + `aria-describedby` + the existing hover/focus open semantics and the DESIGN.md short-motion.
- Listener discipline: any scroll/resize/reposition listeners are added on open and removed on close/unmount (no leaks).

### Focus-ring clipping (UIFIX-02)
- Apply the minimal, conventional fix so focus-visible rings render fully under `overflow-x-auto` (e.g. focus-ring inset/offset, scroll-padding, or a non-clipping outline approach consistent with DESIGN.md's ring tokens). Reuse whatever the codebase already does for rings — introduce zero new tokens.

### CUM RETURN KPI card (UIFIX-03)
- Adjust the factsheet CUM RETURN KPI card (in `FactsheetView.tsx` KPI strip) so extreme/high-leverage values render without truncation/ellipsis — prefer a layout fix (allow the value to size/wrap/fit) over shrinking below DESIGN.md type minimums. Keep every other KPI card visually identical.

### Claude's Discretion
- Exact positioning math for the portal (flip vs clamp thresholds), the precise focus-ring technique, and whether the KPI fix is a width/wrap/tabular-nums change — all implementer's call within DESIGN.md, chosen for the smallest correct diff.
- Whether the chart `TouchTooltip` shares the portal fix (only if trivially reusable; otherwise leave it — separate criterion).
</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/components/ui/Tooltip.tsx` (+ `Tooltip.test.tsx`) — the single tooltip to fix. Currently absolute-positioned with a vertical-only flip → clips inside overflow containers and can overflow the viewport horizontally.
- `src/app/factsheet/[id]/v2/FactsheetView.tsx` — hosts the CUM RETURN KPI card (KPI strip); leverage/kpistrip tests already exist (`FactsheetView.leverage.test.tsx`, `FactsheetView.kpistrip.test.tsx`).
- `overflow-x-auto` sites for the focus-ring fix: `FactsheetView.tsx`, `HeatmapPanels.tsx`, `DistributionPanels.tsx`, `MetricsColumn` (worst-drawdowns reflow), `StressWindowsPanel`, `AllocationsTabs.tsx`, `ExposureByClass.tsx`, `ScenarioFlaggedHoldingsList.tsx`.

### Established Patterns
- DESIGN.md owns ring/color/type/spacing tokens — cite, never invent.
- Existing reflow tests (`*.reflow.test.tsx`) show the project already tests overflow behavior — extend that style.

### Integration Points
- Tooltip is consumed widely — a portal change must not regress existing call sites (hover/focus, aria wiring). Verify against `Tooltip.test.tsx` + consumers.
- axe route×viewport matrix (UIFIX-03 acceptance) — there is an existing axe test harness to re-run green.

</code_context>

<specifics>
## Specific Ideas

- These three are genuinely independent — plan them as separable tasks (likely one wave, but each with its own regression test).
- Every fix gets a test that fails without it: a tooltip-in-overflow-container render test (portal escapes the clip; edge flip keeps it on-screen), a focus-ring-not-clipped assertion, and a CUM RETURN extreme-value no-ellipsis assertion + the axe matrix.

</specifics>

<deferred>
## Deferred Ideas

None — the three UIFIX criteria are self-contained.
</deferred>
