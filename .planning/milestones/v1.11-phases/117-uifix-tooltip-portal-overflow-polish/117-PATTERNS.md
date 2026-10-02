# Phase 117: UIFIX — tooltip portal + overflow polish - Pattern Map

**Mapped:** 2026-07-18
**Files analyzed:** 3 modified (+ their test files)
**Analogs found:** 3 / 3 (all strong, in-repo)

This is a mechanical UI-polish batch — three independent defects, each fixed by
mirroring a proven in-repo pattern rather than inventing one. Every fix already
has a well-established analog in the codebase.

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/components/ui/Tooltip.tsx` | component (UI primitive) | event-driven (hover/focus → portal render) | `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.tsx` (SSR-safe portal) + `src/hooks/useTapPin.ts` (getBoundingClientRect + listener discipline) | role-match (portal) + exact (rect/listener) |
| `src/components/ui/Tooltip.test.tsx` | test | — | itself (extend existing timer-lifecycle suite) | exact |
| `src/app/factsheet/[id]/v2/FactsheetView.tsx` | component (KPI strip) | transform (formatted number → cell) | sibling KPI cells in same `items.map` (self-analog) | exact |

The overflow-x-auto focus-ring fix (UIFIX-02) is cross-cutting — see **Shared Patterns**.

---

## Pattern Assignments

### `src/components/ui/Tooltip.tsx` (UIFIX-01 — portal + horizontal flip/clamp)

Two analogs combine: **ContributionWizardOverlay** supplies the SSR-safe
portal-to-body shell; **useTapPin** supplies the react-compiler-safe rect
measurement. The current file's timer discipline (lines 36–60) stays byte-identical.

**Analog A — SSR-safe portal:** `ContributionWizardOverlay.tsx`

**Import + SSR gate** (lines 30, 80-83) — mirror exactly:
```tsx
import { createPortal } from "react-dom";
// ...
if (!isOpen) return null;
if (typeof document === "undefined") return null;   // SSR gate — no document access on server

return createPortal(
  <div /* bubble */ />,
  document.body,
);
```
For the Tooltip the gate is `if (!open) return <span>{trigger}</span>;` then the
bubble is portaled: `{open && typeof document !== "undefined" && createPortal(bubble, document.body)}`.
The `ScenarioCommitDrawer.tsx:1131-1133` inline form
(`{cond && typeof document !== "undefined" && createPortal(<div/>, document.body)}`)
is the exact expression shape to reuse — the bubble stays a conditional sibling,
not a separate mounted component.

**Listener discipline** (`ContributionWizardOverlay.tsx` lines 73-78) — add-on-open / remove-on-close-and-unmount:
```tsx
const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
document.addEventListener("keydown", onKey);
return () => document.removeEventListener("keydown", onKey);
```
For UIFIX-01 the same shape governs the scroll/resize reposition listeners: register
inside a `useEffect` keyed on `open`, tear down in the cleanup. The existing
enter-timer unmount cleanup (`Tooltip.tsx:55-60`) is preserved untouched.

**Analog B — trigger-rect measurement + react-compiler-safe ref:** `useTapPin.ts`

**Callback-ref (NOT a returned RefObject) + getBoundingClientRect** (lines 106-109, 162-164):
```tsx
const elRef = useRef<Element | null>(null);
const setChartEl = useCallback((el: Element | null) => { elRef.current = el; }, []);
// ...
const el = elRef.current;
if (!el) return;
const rect = el.getBoundingClientRect();   // fixed-position coords derive from this
```
Attach a ref to the trigger wrapper `<span>` and read `getBoundingClientRect()`
on open to compute the `fixed` bubble coordinates. `getBoundingClientRect()` returns
**viewport** coords, which is exactly what CSS `position: fixed` consumes — no scroll
offset math needed. The horizontal flip/clamp compares `rect.left`/`rect.right` +
bubble width (224px, `w-56`) against `window.innerWidth`.

**⚠️ z-index stacking — LOAD-BEARING for the planner:**
The current bubble is `z-50`. Every existing body-portaled overlay uses `z-[200]`
(`ContributionWizardOverlay.tsx:88`, `ScenarioCommitDrawer.tsx:1139`). Once the
tooltip is *also* portaled to `document.body`, a tooltip whose trigger sits inside
an **open Dialog/drawer** becomes a sibling of that `z-[200]` overlay in the body
stacking context — at `z-50` it renders **behind** the overlay backdrop. The
UI-SPEC flags this ("`z-50` must clear portaled content; verify against Dialog/drawer
stacking"). The bubble must clear `z-[200]` to satisfy the "works inside an open
Dialog and inside the mobile drawer" invariant — i.e. bump to `z-[210]` (or higher
than any overlay it can appear within). This is the one non-mechanical decision.

**PRESERVE byte-for-byte** (current `Tooltip.tsx:73-87`): `role="tooltip"`,
`aria-describedby={open ? id : undefined}` on the trigger wrapper, hover+focus open
(`onMouseEnter`/`onFocus`) / `onMouseLeave`/`onBlur` close, the 150ms enter timer
(lines 36-48), `pointer-events-none`, and the inline style block (fill `#FFFFFF`,
border `#E2E8F0`, `boxShadow: "0 1px 3px rgba(0,0,0,0.08)"`, `fontFamily: var(--font-body)`,
`text-fixed-13 leading-snug`, `w-56`, `px-3 py-2`, `rounded-md`). Only the
`absolute bottom-full left-1/2 -translate-x-1/2` positioning classes change to
`fixed` + computed `top`/`left`.

---

### `src/components/ui/Tooltip.test.tsx` (UIFIX-01 regression)

**Analog:** the existing suite (self). It already uses `vi.useFakeTimers()`,
`render/screen/fireEvent/act`, and reaches the wrapper via
`screen.getByText("info").parentElement!.parentElement!`.

**⚠️ DOM-tree contract shift:** after the portal change the bubble is no longer a
DOM descendant of the trigger wrapper — it lives under `document.body`. Role queries
(`screen.getByRole("tooltip")`, `screen.queryByRole("tooltip")`) still resolve
because RTL queries the whole document, so the existing timer-lifecycle tests keep
passing. But any *tree-relative* assertion (bubble as child of wrapper) would break —
none currently exist, but new tests must assert via `getByRole`/`getByText`, not
`wrapper.querySelector`. New tests to add (each fails without the fix):
1. **portal escapes the clip** — trigger rendered inside an `overflow-hidden`/`overflow-x-auto`
   container; assert the tooltip node's parent chain is `document.body`, not the clip container.
2. **edge flip keeps it on-screen** — mock `getBoundingClientRect` to a near-right-edge
   rect; assert the computed `left` + width ≤ `window.innerWidth` (no negative/overflow left).
3. **listener cleanup** — spy `removeEventListener` on close/unmount (mirror the
   existing `clearTimeout` spy pattern at lines 44-46, 57).

---

### `src/app/factsheet/[id]/v2/FactsheetView.tsx` (UIFIX-03 — CUM RETURN no-truncation)

**Culprit** (lines 883-895): the KPI **value** `<p>` carries
`whitespace-nowrap overflow-hidden text-ellipsis`; the sibling **label** `<p>`
(line 878) carries the same trio. Under high leverage the CUM RETURN value is
ellipsis-truncated. Panel wrapper is `overflow-hidden @container` (line 864); grid
of cells via `items.map` (line 871).

**Analog:** the sibling KPI cells in the *same* `items.map` — the fix must keep
CAGR / Sharpe / Sortino / label eyebrows visually identical. The value keeps
`mt-1.5 sm:mt-2 font-mono tabular-nums text-h2 leading-none` and the `signTone`
color gate (lines 884-892) unchanged — only the truncation trio on the **value**
`<p>` is the target. Per UI-SPEC: prefer removing `whitespace-nowrap`/`overflow-hidden`/
`text-ellipsis` (allow wrap/fit) or a `min-w-0` width fix over shrinking below
`text-h2`. Because every cell renders from one `items.map`, a change to the value
`<p>` className applies to all four cells uniformly — verify CAGR/Sharpe/Sortino
don't visually shift (that's what `FactsheetView.kpistrip.test.tsx` /
`FactsheetView.leverage.test.tsx` guard). Do NOT touch the label `<p>` (line 878)
unless required — the eyebrow is out of scope.

**Acceptance:** existing axe route×viewport matrix re-runs green (harness already exists).

---

## Shared Patterns

### Focus-ring non-clipping under overflow (UIFIX-02)

**The repo already has TWO ring idioms — pick the outline/inset one (clip-safe), not box-shadow ring.**

**Convention A (dominant, ~all FactsheetView controls) — CSS `outline`:**
Source: `FactsheetView.tsx:1037, 1100, 1219, 1229, 1283, 1293, 1314, 1376`,
`TimeSeriesChart.tsx:727, 760`, `CollapsibleSection.tsx:137`, `SignaturePanels.tsx:341`:
```
focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent
```
And the CSS form in `globals.css:482-483` / `516-517` (`.strategy-v2-skip-link`,
`.app-skip-link`):
```css
outline: 2px solid var(--color-accent);
outline-offset: 1px;
```

**Convention B (single site) — inset box-shadow ring:** `MandateSegmentedRadio.tsx:56`:
```
focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/20
```

**Apply to:** the enumerated `overflow-x-auto` sites (verified this pass):
`FactsheetView.tsx:1025`, `HeatmapPanels.tsx:65, 198`, `DistributionPanels.tsx:497`,
`MetricsColumn` (worst-drawdowns reflow), `StressWindowsPanel`,
`AllocationsTabs.tsx:803`, `ExposureByClass.tsx:142`,
`ScenarioFlaggedHoldingsList.tsx:200`.

**Clip-safety note for the planner (Rule 7 — surface, don't blend):** a positive
`outline-offset` draws the ring OUTSIDE the element bounds, so it is still clipped by
an ancestor `overflow-x-auto`/`overflow-hidden`. The two genuinely clip-proof options
already present in-repo are: (1) **`ring-inset`** (Convention B — draws inside the
element, always within the scroll viewport), or (2) a **`scroll-padding`/`scroll-p-*`
allowance on the scroll container** so the focused child scrolls into a padded region
before its ring can touch the clip edge. `outline-offset: 0`/negative also stays inside.
Technique is Claude's Discretion per UI-SPEC — but the goal is "ring fully visible under
the clip," which a plain positive-offset outline does NOT achieve. Reuse the accent
token; **zero new tokens** (`--color-accent` `#1B6B5A`, ≥2px, ≥3:1 contrast already met).

### SSR-safe portal (shared by any future portal work)

Canonical shape, from `ContributionWizardOverlay.tsx` and `ScenarioCommitDrawer.tsx`:
`import { createPortal } from "react-dom"` → `typeof document !== "undefined"` guard →
`createPortal(node, document.body)`. These are the ONLY two `createPortal` sites in the
repo; both are recent (Phase 110/115) and DESIGN.md-conformant — mirror them, do not
add `react-dom/client` or a positioning library.

---

## Test Conventions (extend these, don't invent)

| Convention | Source | Reuse for |
|-----------|--------|-----------|
| Fake-timer + `render/screen/fireEvent/act`, `clearTimeout` spy | `Tooltip.test.tsx:1-60` | UIFIX-01 listener/timer tests |
| `*.reflow.test.tsx` overflow-behavior tests | `MetricsColumn.worst-drawdowns-reflow.test.tsx`, `StressWindowsPanel.reflow.test.tsx` | UIFIX-02 ring-not-clipped assertion, UIFIX-01 in-overflow render |
| KPI-strip render/tone tests | `FactsheetView.kpistrip.test.tsx`, `FactsheetView.leverage.test.tsx` | UIFIX-03 extreme-value no-ellipsis; guard other cards unchanged |
| axe route×viewport matrix | existing axe harness | UIFIX-03 acceptance (re-run green) |

---

## No Analog Found

None. All three fixes have strong in-repo analogs. The only non-mechanical
decision is the **tooltip z-index bump** (must exceed the `z-[200]` overlay stacking)
— flagged above, not a missing-analog gap.

## Metadata

**Analog search scope:** `src/` (components, hooks, app routes, globals.css)
**Files scanned:** createPortal sites (2), getBoundingClientRect sites (13),
focus-ring idioms (16 matches), overflow-x-auto sites (25), reflow tests (2)
**Pattern extraction date:** 2026-07-18
