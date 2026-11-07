# Phase 193: QUIETVIEW - Pattern Map

**Mapped:** 2026-11-06
**Files analyzed:** 22 (12 source files modified, 1 optional new source file, 9 test files modified or created)
**Analogs found:** 21 / 22 (one gap: the firing IntersectionObserver test helper has no in-repo precedent)

Citation convention: every anchor is **symbol plus file path**. Line numbers are hints read on 2026-11-06 and drift (Phase 195 TRIM edits `FactsheetView.tsx` after this phase). All analog paths were checked with `git ls-files` and are tracked source. All paths below are relative to the repo root; `V2` = `src/app/factsheet/[id]/v2`.

This phase is mostly removal plus three behaviour gates. Nearly every "analog" is the file being edited, or a sibling that already carries the idiom to copy. The excerpts below are therefore either (a) the exact code to change, or (b) the idiom to copy into it.

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `V2/wheel-zoom.ts` (new, optional, ~5 lines) | utility | transform | small pure helpers beside it, e.g. `V2/format.ts` (pure exports) | role-match |
| `V2/TimeSeriesChart.tsx` (`onWheel`, native wheel `useEffect`, `chart-help` span) | component | event-driven | itself; sibling `V2/HistogramChart.tsx` carries the identical pair | exact |
| `V2/HistogramChart.tsx` (`onWheel`, native wheel `useEffect`, hint copy, legend row) | component | event-driven | itself (mirrors `TimeSeriesChart.tsx`) | exact |
| `V2/factsheet-context.tsx` (`PersistedState`, `parsePersistedFields`, hydration effect, write effect) | provider | CRUD (localStorage + URL) | itself; `useCrossTabStorage` exposes `removeStored`/`readOnly` | exact |
| `V2/MetricsColumn.tsx` (`RangeEyebrow`, peer-panel gate in `MetricsColumn`) | component | request-response (render) | itself; ControlBar `Reset view` button in `V2/FactsheetView.tsx` for the button recipe | exact |
| `V2/BatchDPanels.tsx` (`AllocatorSection`, `DemoBadge`, api arm of `PeerPercentilePanel`) | component | transform (render) | itself; scenario arm of `PeerPercentilePanel` stays | exact |
| `V2/FactsheetView.tsx` (`AllocatorSection` mount, `sections` nav entry, `FactsheetFooter` sentence, what-if caption word, `hideAllocatorSection` prop) | component | transform (render) | itself | exact |
| `V2/MandatePanels.tsx` (`TermsPanel` developer sentence) | component | transform (render) | itself | exact |
| `src/components/notes/StrategyNoteCard.tsx` | component | CRUD (save-on-blur) | `src/app/(dashboard)/allocations/components/DashboardNoteCard.tsx` (dirty-check idiom) | exact |
| `src/components/notes/HoldingNoteRow.tsx` | component | CRUD (lazy GET, save-on-blur) | `DashboardNoteCard.tsx` idiom + its own GET block | exact |
| `src/components/notes/BridgeOutcomeNoteSection.tsx` | component | CRUD (lazy GET, save-on-blur) | `DashboardNoteCard.tsx` idiom + its own GET block | exact |
| `src/app/(dashboard)/allocations/components/HoldingDetail.tsx` | component | CRUD (lazy GET, save-on-blur) | `DashboardNoteCard.tsx` idiom; keep its `noteLoadError` fence | exact |
| `V2/TimeSeriesChart.window-gesture.test.tsx` (repoint 2 wheel calls, add plain-wheel arm) | test | event-driven | itself (`mountZoomed`, `ev`, `live`) | exact |
| `V2/charts.signed-zero.test.tsx` (repoint histogram wheel call, add plain arm) | test | event-driven | itself | exact |
| `V2/FactsheetView.headline-coverage.test.tsx` (repoint wheel call) | test | event-driven | itself | exact |
| `V2/factsheet-context.provider.test.tsx` (purge cases; rewrite "writes BOTH ?range=" case) | test | CRUD | itself (`lsStore`, `localStorageMock`, `Harness`, `renderPersist`) | exact |
| `V2/factsheet-context.codec.test.ts` (legacy `range` decode-only) | test | transform | itself | exact |
| `V2/FactsheetView.window-kpis.test.tsx` and `V2/MetricsColumn.window.test.tsx` (reset-control cases) | test | event-driven | `RangeHarness` in `window-kpis` | exact |
| `V2/FactsheetBody.no-demo-content.test.tsx` (new, D-07 guard) | test | transform | `V2/FactsheetBody.guard04-no-bleed.test.tsx` (full-body mount stub block) + `V2/FactsheetView.window-kpis.test.tsx` (api payload fixture) | role-match |
| `src/components/notes/*.test.tsx` and `HoldingDetail.test.tsx` (D-10 arms) | test | CRUD | `src/components/notes/StrategyNoteCard.test.tsx` | exact |
| Firing `IntersectionObserver` stub inside the D-07 test | test helper | event-driven | `src/test-setup.ts` `IntersectionObserverStub` (the no-op to override) | partial (see No Analog Found) |
| `.planning/ROADMAP.md` Phase 193 section (D-01 reading) | config (planning doc) | n/a | hand-edit as a bold field line; see Shared Patterns | n/a |

## Pattern Assignments

### `V2/wheel-zoom.ts` (utility, transform) - optional

**Analog:** none needed; the rule is one predicate used by both charts. Research Pattern 1 shape:

```ts
export const isZoomWheel = (e: { ctrlKey: boolean; metaKey: boolean }): boolean =>
  e.ctrlKey || e.metaKey;
```

If the planner prefers zero new files, inline `e.ctrlKey || e.metaKey` in the four places (two `onWheel`, two native listeners). One shared predicate keeps the two charts from drifting apart.

---

### `V2/TimeSeriesChart.tsx` (component, event-driven)

**Analog:** itself. Two edit sites, both must change (gating only the first leaves the page-scroll trap).

**Site 1: React `onWheel`** (symbol `onWheel`, `useCallback`, hint ~:724). Insert the gate as the FIRST statement, before the `deltaY === 0` early return:

```tsx
const onWheel = useCallback(
  (e: ReactWheelEvent<SVGSVGElement>) => {
    if (e.deltaY === 0) return;          // <- put `if (!isZoomWheel(e)) return;` ABOVE this line
    const svg = svgRef.current;
    ...
    holdRange(xRange);
    setXRange([s, eN]);
    // Inside a drag the drag's pointer up releases the hold, not the wheel.
    if (panRef.current || xDragRef.current) return;
    wheelTimerRef.current = setTimeout(() => {
      wheelTimerRef.current = null;
      releaseRange();
    }, WHEEL_SETTLE_MS);
  },
  [pixelToIdx, xStart, xEnd, n, setXRange, xRange, holdRange, releaseRange],
);
```

The body (anchor math, `Math.exp(e.deltaY * 0.0012)`, `holdRange` / `WHEEL_SETTLE_MS` settle) is unchanged. A gated-out plain wheel must not call `holdRange`, so no hold or settle timer is left behind.

**Site 2: native non-passive listener** (comment "Wheel listener attached non-passively", `useEffect` with `[]` deps, hint ~:816-823). This is the root cause: it prevents EVERY wheel today.

```tsx
useEffect(() => {
  const el = svgRef.current;
  if (!el) return;
  const handler = (ev: WheelEvent) => { if (ev.cancelable) ev.preventDefault(); };
  //               change to: if (isZoomWheel(ev) && ev.cancelable) ev.preventDefault();
  el.addEventListener("wheel", handler, { passive: false });
  return () => el.removeEventListener("wheel", handler);
}, []);
```

**Copy change** (screen-reader help span, hint ~:848): replace only the sentence `Mouse wheel zooms toward the cursor.` with `Hold Control or Command and turn the mouse wheel to zoom toward the cursor; the wheel alone scrolls the page.` Other sentences in the `chart-help-*` span stay verbatim.

Also update the explanatory comment above the native listener, which claims the purpose is to prevent default for all wheels.

---

### `V2/HistogramChart.tsx` (component, event-driven)

**Analog:** `V2/TimeSeriesChart.tsx` (same two-layer pair; the file's own comment says "mirrors TimeSeriesChart").

Same two edits at `onWheel` (hint ~:163, gate first, above `if (e.deltaY === 0) return;`) and the native listener (comment "Non-passive wheel listener so we can preventDefault", hint ~:200-207):

```tsx
const handler = (ev: WheelEvent) => { if (ev.cancelable) ev.preventDefault(); };
el.addEventListener("wheel", handler, { passive: false });
return () => el.removeEventListener("wheel", handler);
```

Copy and layout (UI-SPEC Copywriting Contract): the hint string becomes `Ctrl/Cmd + wheel to zoom · double-click to reset` (U+00B7 middle dot; no command glyph, DESIGN.md allows only `⚠ — · × ✓`); keep its raw `text-[10px] italic text-text-muted` (documented chart-internal island, exempt from `no-raw-font-px`). Add `flex-wrap gap-y-1` to the legend row so the longer hint wraps at 390 px. Today's hint is the literal `Wheel to zoom · double-click to reset` (symbol: the legend row JSX just after the comparator name span, hint ~:260; locate with `grep -n "Wheel to zoom" 'src/app/factsheet/[id]/v2/HistogramChart.tsx'`). The cursor style `zoom ? "zoom-out" : "zoom-in"` on the svg (hint ~:271) is unchanged.

---

### `V2/factsheet-context.tsx` (provider, CRUD: localStorage + URL)

**Analog:** itself. Four edit sites. The codec stays (it also carries `cmp`, `cb`, `reg`, `dark`).

**Site 1: `PersistedState` and `parsePersistedFields`** (hint ~:80-125). Keep `range?: string` and the `r.range` read as a **decode-only legacy field** so the provider can detect a stale value. Never encode it.

```ts
type PersistedState = {
  range?: string;                 // keep: decode-only legacy field (D-02 purge detection)
  cmp?: ComparatorKey;
  ...
};
...
function parsePersistedFields(r: Record<string, unknown>): PersistedState {
  const out: PersistedState = {};
  if (typeof r.range === "string") out.range = r.range;   // keep, with a comment: purge-only
  ...
```

Update the doc comments that say "five fields" and describe `range` as persisted (hint ~:20-22, ~:80-90, the `persist` prop doc mentioning `?range=` ~:183-195), and `ScenarioFactsheetChart.tsx` (comment near :44).

**Site 2: storage hook destructure** (symbol `useCrossTabStorage<PersistedState>`, hint ~:284). Today it destructures `value`, `setValue`, `isHydrated`. Add `removeStored` and `readOnly` (both already returned by the hook in `src/lib/storage/cross-tab.ts`):

```ts
const { value: storedView, setValue: setStoredView, isHydrated: storageHydrated } =
  useCrossTabStorage<PersistedState>({
    key: `factsheet-v2:${payload.strategyId}`,
    initial: EMPTY_PERSISTED,
    codec: factsheetViewStateCodec,
    debounceMs: 0,
    crossTab: false,
    hydration: "deferred",
    sentryArea: "factsheet.view",
  });
```

**Site 3: hydration effect** (comment "URL + localStorage hydration", hint ~:305-347). Delete the `rangeRaw` block; add the one-shot purge after `if (!persist) return;`:

```ts
if (!persist) return;
const params = new URLSearchParams(window.location.search);
const get = (k: keyof PersistedState) => params.get(k) ?? storedView[k];
const maxIdx = payload.dates.length - 1;

// DELETE this whole block (D-02):
const rangeRaw = get("range");
if (typeof rangeRaw === "string") {
  const [s, e] = rangeRaw.split("-").map(n => parseInt(n, 10));
  if (Number.isFinite(s) && Number.isFinite(e) && s >= 0 && e <= maxIdx && e - s >= MIN_VISIBLE_SAMPLES - 1) {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setXRangeRaw([s, e] as const);
  }
}
// KEEP: cmp / cb / reg / dark reads unchanged (A-5).
```

Purge (Research Pattern 2): URL half uses the same `URLSearchParams` + `window.history.replaceState(null, "", ...)` idiom the write effect uses; storage half uses the primitive, never raw `localStorage.removeItem` (B25 lint capstone):

```ts
if (params.has("range")) {
  params.delete("range");
  const qs = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
}
if (storedView.range !== undefined && !readOnly) {   // readOnly: forward-compat newer blob, do not touch
  const { range: _legacy, ...rest } = storedView;
  if (Object.keys(rest).length === 0) removeStored(EMPTY_PERSISTED);
  else setStoredView(rest);
}
```

Add `removeStored`/`readOnly` to the effect's dependency array. A visitor with no saved range must cause NO storage or URL write (assert it). `persist={false}` keeps its early return: no purge, no write.

**Site 4: write effect** (comment "Debounced write-back", hint ~:355-387). Remove `range` from `state`, remove the two `params.set("range")` / `params.delete("range")` lines and the `fullRangeStr` constant, and remove `xRange` from the dependency array:

```ts
const state: PersistedState = {
  range: `${xRange[0]}-${xRange[1]}`,   // remove
  cmp: comparator,
  cb: colorblind ? "1" : undefined,
  reg: regimes ? "1" : undefined,
  dark: darkMode ? "1" : undefined,
};
...
if (state.range && state.range !== fullRangeStr) params.set("range", state.range);  // remove both lines
else params.delete("range");
...
}, [xRange, comparator, colorblind, regimes, darkMode, payload.strategyId, payload.dates.length, payload.activeComparator, setStoredView, persist]);
//  ^^^^^^ remove xRange
```

Reuse: `resetXRange` (a `useCallback(() => setXRangeRaw(fullRange), [fullRange])` just above the storage hook) is unchanged.

---

### `V2/MetricsColumn.tsx` (component, request-response render)

**Analog for `RangeEyebrow`:** itself, plus the ControlBar `Reset view` `<button>` in `V2/FactsheetView.tsx` (symbol `ControlBar`, hint ~:2867) for the class string.

**Current `RangeEyebrow`** (exported function, hint ~:822-841):

```tsx
export function RangeEyebrow({ scope, surface, className = "" }: {
  scope: RangeScope; surface: "strip" | "rail"; className?: string;
}) {
  const head = scope.kind === "full" ? "Full history" : "Selected range";
  return (
    <p
      data-testid={`range-eyebrow-${surface}`}
      className={`font-mono text-micro uppercase tracking-[0.18em] text-text-muted ${className}`}
    >
      {`${head}: ${isoToMonthDay(scope.start)} – ${isoToMonthDay(scope.end)}`}
    </p>
  );
}
```

**Target shape** (UI-SPEC I-2): root becomes `<div className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`}>` (the `className` prop MOVES here so the strip keeps `mt-6`). The `<p>` keeps its testid, its classes and its text byte-identical (tests pin `textContent`), and gains `tabIndex={-1}` plus a ref. When `scope.kind === "selected"`, a second child:

```tsx
<button
  type="button"
  data-testid={`range-reset-${surface}`}
  onClick={() => { resetXRange(); labelRef.current?.focus(); }}
  className="px-2.5 py-1 text-caption rounded-sm border bg-surface-subtle text-text-2 border-border hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent min-h-[28px] pointer-coarse:min-h-[44px] factsheet-v2-no-print"
>
  Reset to full history
</button>
```

The class string up to `pointer-coarse:min-h-[44px]` is copied byte for byte from the ControlBar `Reset view` button (the excerpt below); `factsheet-v2-no-print` is appended (defined `display: none` in print in `globals.css`). Do NOT use the `Button` primitive (`sm` is white-fill `px-3 py-1.5`).

ControlBar source of the class string (`V2/FactsheetView.tsx`, `ControlBar`, hint ~:2864-2873):

```tsx
<button
  type="button"
  onClick={resetView}
  title="Reset comparator + visible window to defaults (toggles, persisted layout stay)"
  className="px-2.5 py-1 text-caption rounded-sm border bg-surface-subtle text-text-2 border-border hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent min-h-[28px] pointer-coarse:min-h-[44px]"
>
  Reset view
</button>
```

**Imports:** `useXRange` is exported from `./factsheet-context`; `MetricsColumn.tsx` already imports `usePayload, useActiveComparator` from that module (import line ~:15), so extend that import with `useXRange`. Add `useRef` from `react` (the file imports only `type ReactNode` from react today, line ~:3). `RangeEyebrow` mounts (strip at `FactsheetView.tsx` `<RangeEyebrow scope={scope} surface="strip" className="mt-6" />` ~:1951, rail at `MetricsColumn.tsx` ~:347) are both inside a `FactsheetProvider`, so `useXRange()` does not throw.

Do not call `useXRange()` conditionally; call it unconditionally at the top, render the button conditionally.

**Peer-panel gate** (symbol: the `PeerPercentilePanel` mount inside `MetricsColumn`, hint ~:470-482). Current:

```tsx
{(payload.ingestSource === "api" ||
  (scenarioMode &&
    payload.ingestSource === "csv" &&
    payload.scenarioPeer != null)) && <PeerPercentilePanel />}
```

Drop the `payload.ingestSource === "api" ||` arm (and its comment text about the demo cohort) so only the scenario-blend arm remains. The panel itself already returns null when `p` is absent, but remove the gate arm so the DOM never carries the api demo panel and the rail leaves no doubled `gap-12`.

---

### `V2/BatchDPanels.tsx` (component, transform render)

**Analog:** itself.

**`PeerPercentilePanel`** (hint ~:84-170). Narrow to the scenario arm: read only `payload.scenarioPeer`, remove the `isScenario` branching and `DemoBadge`:

```tsx
const isScenario = payload.ingestSource === "csv";
const p =
  payload.ingestSource === "api"
    ? payload.peerPercentile
    : (payload.scenarioPeer ?? null);
if (!p) return null;
...
Peer Percentile {!isScenario && <DemoBadge>Demo cohort</DemoBadge>}
...
{isScenario ? (
  <p className="mt-2 text-micro text-text-muted">
    hypothetical blend · ranked vs verified strategies · sample/252 basis
  </p>
) : (
  <p className="mt-2 text-micro italic text-text-muted">
    Synthesized peer cohort (deterministic seed). Production: replace with platform strategy DB.
  </p>
)}
```

Keep the scenario disclosure line verbatim (real data, UI-SPEC I-4). The `basis === "mark_to_market" || "smoothed_mtm"` honest-note block below the footnote stays. Narrow with the `payload.ingestSource === "csv"` discriminant before reading `scenarioPeer` (B6 discriminated-union discipline in this file).

**Delete outright:** `AllocatorSection` (exported function, hint ~:268-385), its helpers used only by it (`tailCaption`, `KvRow`, `KvSep`, and `DemoBadge` once the api arm is gone; check each with grep before deleting, since `KvRow`/`PercentileBar` may be shared), and any now-unused imports. `PercentileBar` is still used by the scenario arm and stays.

Do NOT remove `peerPercentile` / `allocatorPortfolios` from `types.ts` or `build-payload.ts` in this phase (Research Open Question 3, recommendation A: UI-only now, book the producer removal).

---

### `V2/FactsheetView.tsx` (component, transform render) - keep edits narrow (Phase 195 overlap)

**Analog:** itself. Four small edits, all deletions or one-line trims.

**1. `AllocatorSection` mount** (comment "AllocatorSection uses demo blended portfolios", hint ~:572-581):

```tsx
{/* AllocatorSection uses demo blended portfolios — ... (NEW-C20-01) */}
{!hideAllocatorSection && payload.ingestSource === "api" && (
  <div id="factsheet-allocator" className="mt-12">
    <LazyMount minHeight={400}>
      <AllocatorSection />
    </LazyMount>
  </div>
)}
```

Delete the whole block including the comment, and the now-unused `AllocatorSection` import. Keep `hideAllocatorSection` in the `FactsheetBodyProps` type (hint ~:381) as an accepted no-op: mark it deprecated in its comment and do NOT destructure it at ~:408 (avoids an unused-variable lint error and leaves 43 caller files alone). `LazyMount` is still used by the Signatures section, so keep its import.

**2. `sections` nav entry** (symbol `sections`, `React.useMemo`, hint ~:2200-2212). Remove only the Allocator spread, and trim `payload.ingestSource` from the dependency array only if nothing else in the memo reads it (the Signatures entry still reads `payload.ingestSource`, so keep it):

```tsx
...(payload.ingestSource === "api"
  ? [{ id: "factsheet-allocator", label: "Allocator" }]
  : []),
```

**3. `FactsheetFooter` sentence** (symbol `FactsheetFooter`, hint ~:3020-3030). Remove the last sentence so the paragraph ends `Past performance is not indicative of future results.`:

```tsx
Demo cohorts and demo portfolios are flagged inline; production replaces them
with platform data.
```

**4. What-if caption word** (symbol: the `role="status"` caption, hint ~:1941): `peer, allocator, and event-study panels stay at base 1×`. Research Open Question 4 recommends dropping "allocator," and updating the one pin in `V2/FactsheetView.leverage.test.tsx` (hint ~:324). NOT decided by CONTEXT or UI-SPEC: the planner must confirm or leave verbatim.

**What `FactsheetView.tsx` must NOT get:** nothing for D-03 (the reset lives in `MetricsColumn.tsx`, UI-SPEC A-7).

---

### `V2/MandatePanels.tsx` (component, transform render)

**Analog:** itself. In `TermsPanel` (hint ~:152-156) remove only the first sentence; keep the paragraph, classes and the second sentence verbatim:

```tsx
<p className="mt-2 text-fixed-10 italic text-text-muted">
  Commercial terms not yet wired through from the strategy registry. Allocators should request
  the full fund offering memorandum directly from the manager before subscribing.
</p>
```

becomes `Allocators should request the full fund offering memorandum directly from the manager before subscribing.` The seven "— on request" `Term` rows stay (UI-SPEC A-2; Research Open Question 2 flags this to the founder at verify time, undecided).

---

### Note surfaces (4 files): `StrategyNoteCard.tsx`, `HoldingNoteRow.tsx`, `BridgeOutcomeNoteSection.tsx`, `HoldingDetail.tsx` (component, CRUD save-on-blur)

**Analog (idiom to copy):** `src/app/(dashboard)/allocations/components/DashboardNoteCard.tsx`, symbol `DashboardNoteCard`, hint ~:42-66. It is already a dirty-checked, no-`autoFocus` surface.

```tsx
import { useEffect, useRef, useState } from "react";
...
const [content, setContent] = useState(props.initialContent);

// Dirty check: `lastSavedContent` is the last content known-persisted (seeded
// from the server-rendered initial value). We advance it only when the hook
// reports a successful save ("saved"), so a failed PATCH stays dirty and a
// later blur retries — but a no-op blur is silently skipped.
const [lastSavedContent, setLastSavedContent] = useState(props.initialContent);
const pendingSaveRef = useRef(props.initialContent);
useEffect(() => {
  if (saveState === "saved") {
    setLastSavedContent(pendingSaveRef.current);
  }
}, [saveState]);

const handleBlur = () => {
  if (content === lastSavedContent) return; // idle blur — no clobber, no PATCH
  pendingSaveRef.current = content;
  void save(content);
};
```

**Today's defect, identical in all four** (`StrategyNoteCard.tsx` symbol `onBlurTextarea`, hint ~:42-47; `autoFocus` hint ~:60):

```tsx
const onBlurTextarea = () => {
  const payload = draft;
  setContent(payload);
  void save(payload);            // unconditional: an empty draft PATCHes "" on open-then-leave
  if (payload) setEditing(false);
};
...
<textarea value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={onBlurTextarea}
  placeholder="Private note about this strategy — markdown supported." autoFocus rows={6} ... />
```

**Target (Research Pattern 4, single predicate in one place so Open Question 1 is a one-line flip):**

```tsx
const [persisted, setPersisted] = useState(initialContent);   // lazily-loaded surfaces: set where the GET result is applied; "" on 404
const pendingRef = useRef(initialContent);
useEffect(() => { if (saveState === "saved") setPersisted(pendingRef.current); }, [saveState]);

const onBlurTextarea = () => {
  if (draft === persisted || draft.trim() === "") return;     // D-09 literal; Q-1 option B would change only this line
  pendingRef.current = draft;
  void save(draft);
  setContent(draft);
  setEditing(false);
};
```

Per surface:
- **`StrategyNoteCard`:** baseline seeded from `props.initialContent`. Remove `autoFocus`; add a ref and focus the textarea from the **Edit** click path (`onClick={() => setEditing(true)}` hint ~:73) via an effect keyed on an "edit requested" flag or a callback ref, not the `autoFocus` attribute.
- **`HoldingNoteRow` and `BridgeOutcomeNoteSection`:** baseline set where the GET result is applied (`setContent(c); setDraft(c);` inside the `useEffect` async block), and `""` on a 404 or network error. Keep their `initialLoaded` loading gate and `cancelled` flag untouched. Remove `autoFocus` (hints `HoldingNoteRow.tsx` ~:245, `BridgeOutcomeNoteSection.tsx` ~:106).
- **`HoldingDetail`:** same, using `setNoteContent(c)`; baseline set at the same place. **Keep the data-loss fence verbatim** (`if (noteLoadError) return;` at the top of `onNoteBlur`, hint ~:142). Remove `autoFocus` (hint ~:242).
- **`DashboardNoteCard`:** unchanged; add one open-and-leave arm as a pin only (already green).

The dirty check MUST live in each component, not in new `useNoteAutoSave` methods: three test files mock the hook with only `{ saveState, lastSavedAt, save }` (`HoldingDetail.test.tsx`, `HoldingsTable.sub-row.test.tsx`, `HoldingsTable.sub-row.errors.test.tsx`), so a new hook method would be `undefined` there. Do not touch `useNoteAutoSave.ts` or `/api/notes` (a deliberate clear must still reach the route).

A skipped blur must save nothing and show no status (`NoteSaveStatus` renders empty for idle with no timestamp).

---

### Tests

#### Wheel tests: `V2/TimeSeriesChart.window-gesture.test.tsx`, `V2/charts.signed-zero.test.tsx`, `V2/FactsheetView.headline-coverage.test.tsx`

**Analog:** `TimeSeriesChart.window-gesture.test.tsx` itself. Fixture helpers: `mountZoomed()` (renders `FactsheetProvider persist={false}` + `BasisProvider` + `Harness`, clicks `zoom`, asserts `kind: "selected"`), `ev(fn)` (`await act(async () => fn())`), `live()` (current xRange), `PLOT_X`/`PLOT_Y`. Existing wheel call to repoint (it is the positive arm after the change):

```tsx
await ev(() => fireEvent.wheel(svg, { deltaY: -100, clientX: PLOT_X, clientY: PLOT_Y }));
//                                                  add `ctrlKey: true`
```

Three existing wheel tests go red on the code change until repointed with `ctrlKey: true`: `window-gesture` (the "6-tick wheel burst" case and the "unmount mid-wheel-burst" case), `charts.signed-zero.test.tsx` (the `HistogramChart` wheel case, hint ~:274), `FactsheetView.headline-coverage.test.tsx` (hint ~:1652). Locate each with `grep -n "fireEvent.wheel"`.

New RED arm (Research Code Examples; asserts that plain wheel is neither a range change nor default-prevented; A2 in the assumptions log: `fireEvent.wheel` returns the `dispatchEvent` boolean, false when prevented):

```tsx
const before = live();
expect(fireEvent.wheel(svg, { deltaY: -100, clientX: PLOT_X, clientY: PLOT_Y })).toBe(true);   // today: false
expect(live()).toEqual(before);                                                                 // today: changes
expect(fireEvent.wheel(svg, { deltaY: -100, ctrlKey: true, clientX: PLOT_X, clientY: PLOT_Y })).toBe(false);
expect(live()).not.toEqual(before);
expect(fireEvent.wheel(svg, { deltaY: -100, metaKey: true, clientX: PLOT_X, clientY: PLOT_Y })).toBe(false);
```

File header convention: `/** @vitest-environment jsdom */`, `vi.mock("@/lib/sentry-capture", ...)`, localStorage stub in `beforeEach`, `getBoundingClientRect` spy returning a viewBox-sized box so client coords equal viewBox coords.

#### `V2/factsheet-context.provider.test.tsx`

**Analog:** itself: `lsStore` Map + `localStorageMock` (`getItem`/`setItem`/`removeItem` spies, installed per test via `vi.stubGlobal("localStorage", ...)` in `beforeEach`), `KEY = "factsheet-v2:test-strategy"`, `makePayload()` (200 synthetic days), `Harness` (has a `pan` button calling `setXRange([10, 120])`), `renderPersist(persist)` helper, and a `beforeEach` that resets the URL with `window.history.replaceState(null, "", "/factsheet/test-strategy/v2")`.

The case to **rewrite** is `"default (persist omitted) writes BOTH the URL ?range= and the localStorage blob after a pan"`: it currently seeds `lsStore.set(KEY, JSON.stringify({ cmp: "spx" }))`, clicks `pan`, and awaits `window.location.search` to contain `range=10-120` and the blob's `.range` to be `"10-120"`. It becomes "a pan writes neither a `?range=` nor a `range` field". New cases: seed `lsStore.set(KEY, JSON.stringify({ range: "10-120", cmp: "spx" }))` and `?range=10-120` on the URL, mount, then assert the full-history range, `window.location.search` has no `range`, and the blob has no `range` but keeps `cmp` (or `removeItem` was called when `range` was the only field); plus a no-saved-range visitor causes zero `setItem`/`removeItem`/`replaceState` calls.

#### `V2/factsheet-context.codec.test.ts`

**Analog:** itself. Update `CANONICAL_BLOB` and the expectation `'{"range":"0-9","cmp":"none"}'` per the contract change: `decode` still returns `range` (legacy), `encode` never emits it.

#### `V2/FactsheetView.window-kpis.test.tsx` and `V2/MetricsColumn.window.test.tsx` (reset-control cases)

**Analog:** `window-kpis` `RangeHarness` (hint ~:113-120) and `mount()`:

```tsx
function RangeHarness({ range = [100, 299] as const }: { range?: readonly [number, number] }) {
  const { setXRange, resetXRange } = useXRange();
  return (
    <>
      <button data-testid="zoom" onClick={() => setXRange(range)}>zoom</button>
      <button data-testid="reset" onClick={() => resetXRange()}>reset</button>
    </>
  );
}

function mount(payload: FactsheetPayload, range?: readonly [number, number]) {
  return render(
    <FactsheetProvider payload={payload} persist={false}>
      <RangeHarness range={range} />
      <FactsheetBody payload={payload} hideHeader hideAllocatorSection hideFooter />
    </FactsheetProvider>,
  );
}
```

New arms: after `zoom`, `range-eyebrow-strip` reads `Selected range: ...` (text unchanged) and `range-reset-strip` / `range-reset-rail` exist; clicking one returns `Full history: ...`, the button is gone, and `document.activeElement` is the label `<p>`; at full history no button renders. Existing assertions pin the `<p>` `textContent` exactly, so the label text must not change.

#### `V2/FactsheetBody.no-demo-content.test.tsx` (new D-07 guard)

**Analog (mount/stub block):** `V2/FactsheetBody.guard04-no-bleed.test.tsx`: `vi.mock("@/lib/sentry-capture", () => ({ captureToSentry: vi.fn() }))` plus the `lsStore`/`localStorageMock` block; mounts the REAL `FactsheetBody` inside `<FactsheetProvider persist={false}>`. **Analog (api fixture):** `FactsheetView.window-kpis.test.tsx` payload (generic strategy name, built with `buildFactsheetPayload` and `ingestSource: "api"`; `TimeSeriesChart.window-gesture.test.tsx` `build400()` is the shortest example).

Traps the test MUST avoid (RESEARCH Pitfalls 3 and 4; otherwise it cannot fail):
- Do NOT pass `hideAllocatorSection` or `hideFooter` (most fixtures do).
- The payload must be `ingestSource: "api"` and its name must not be MultiMarket.
- `AllocatorSection` sits in `LazyMount`, and `src/test-setup.ts` stubs `IntersectionObserver` as a no-op, so install a firing observer in the test (`vi.stubGlobal`, restored by `unstubGlobals: true` in `vitest.config.ts`). See No Analog Found.
- Also assert the un-lazy signals, RED today: `document.getElementById("factsheet-allocator")` is null, the SectionNav has no "Allocator" link.
- Assert the nine UI-SPEC D-07 strings plus `MultiMarket` and the demo portfolio names (`60/40 Stocks/Bonds`, `Multi-Asset Risk Parity`, `Diversified Crypto Book`) are absent from `container.textContent`; a csv scenario-blend payload still renders the real-data peer panel; the Fees block keeps its second sentence verbatim and loses the developer sentence.
- Run it against today's code and confirm every assertion arm goes RED before applying the removals; then neuter-and-restore from a byte backup (project rule; never `git checkout`/`restore`/`stash` on uncommitted work).

Existing tests that render removed content and need repointing or deletion (RESEARCH Pitfalls 5-7): `V2/BatchDPanels.peer-scenario.test.tsx` (api-arm case at hint ~:150), `V2/FactsheetBody.basis.test.tsx` (hint ~:1169) and `V2/FactsheetView.leverage.test.tsx` (hint ~:658) render `<PeerPercentilePanel />` on an api payload; `V2/BaseLeverageNote.wiring.test.tsx` (AllocatorSection case), `V2/BatchDPanels.null-honest.test.tsx` and the allocator half of `V2/panels.signed-zero.test.tsx` test the deleted component. `tests/visual/strategy-v2-type-scale.test.ts` counts the ControlBar button class string in `FactsheetView.tsx` only; a copy in `MetricsColumn.tsx` neither helps nor breaks it.

#### Note surface tests: `src/components/notes/StrategyNoteCard.test.tsx` (and the sibling tests)

**Analog:** `StrategyNoteCard.test.tsx` itself: `makeResponse(status, body)` helper, `fetchSpy = vi.fn()` with `vi.stubGlobal("fetch", ...)` in `beforeEach` and `vi.unstubAllGlobals()` in `afterEach`, render with `initialContent=""`, `fireEvent.change(ta, ...)` then `fireEvent.blur(ta)` inside `act`, and PATCH body assertion via `JSON.parse((init as RequestInit).body as string)`.

Existing positive arm (T29) to keep as the "type, blur, exactly one PATCH" guard:

```tsx
await act(async () => { fireEvent.change(ta, { target: { value: "Conviction: high." } }); });
await act(async () => { fireEvent.blur(ta); });
await waitFor(() => { expect(fetchSpy).toHaveBeenCalledTimes(1); });
const [url, init] = fetchSpy.mock.calls[0];
expect(url).toBe("/api/notes");
expect((init as RequestInit).method).toBe("PATCH");
```

New D-10 arm (RESEARCH): render with `initialContent=""`, leave without typing (`userEvent.click(document.body)` or `fireEvent.blur`), assert no call with `method === "PATCH"` (`fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH")` has length 0). Today that is 1 (autoFocus then blur saves `""`; A1 in the assumptions log: if jsdom does not honour `autoFocus`, call `ta.focus()` first). For `HoldingNoteRow`, `BridgeOutcomeNoteSection` and `HoldingDetail`, which GET `/api/notes` on mount by design, assert on PATCH calls only, never "fetch not called". `HoldingDetail.test.tsx` mocks `useNoteAutoSave` with a module-level `saveSpy` (`saveState: "idle"`, never "saved"), so assert on `saveSpy` there. Also assert the textarea is not focused on open, and an Edit click focuses it.

---

## Shared Patterns

### Dirty-check before save (D-09)
**Source:** `src/app/(dashboard)/allocations/components/DashboardNoteCard.tsx`, `DashboardNoteCard` (`lastSavedContent` / `pendingSaveRef` / `handleBlur`).
**Apply to:** the four note surfaces above. Excerpt under "Note surfaces". Keep the predicate in one place per file.

### Persisted view-state via the cross-tab primitive, never raw storage
**Source:** `src/lib/storage/cross-tab.ts`, `useCrossTabStorage` (returns `value`, `setValue`, `removeStored`, `readOnly`, `isHydrated`); consumed in `V2/factsheet-context.tsx`.
**Apply to:** the range purge. Raw `localStorage.removeItem` is banned by the B25 lint capstone. The sign-out purge keeps working because the `factsheet-v2:` prefix stays registered in `src/lib/storage-namespaces.ts` (`APP_NAMESPACED_PREFIXES`), since the blob still holds `cmp/cb/reg/dark`.

### Wheel gate, both layers
**Source:** Pattern 1 in `193-RESEARCH.md`; the two handler pairs in `V2/TimeSeriesChart.tsx` and `V2/HistogramChart.tsx`.
**Apply to:** exactly those two files (a repo-wide `grep -rnE "onWheel|\"wheel\"|'wheel'" src` finds no other handler).

### ControlBar action-button recipe
**Source:** `V2/FactsheetView.tsx`, `ControlBar`, the `Reset view` button class string.
**Apply to:** the new `Reset to full history` button only. Copy byte for byte, plus `factsheet-v2-no-print`. Neutral and muted: no red, no amber (UI-SPEC Color).

### Removal means not in the DOM
**Source:** UI-SPEC I-4.
**Apply to:** every removal in `BatchDPanels.tsx`, `FactsheetView.tsx`, `MetricsColumn.tsx`, `MandatePanels.tsx`. No CSS hiding, no empty `<section>`, no placeholder in the gap, nothing invented to fill it.

### Test discipline for every new guard
**Source:** project rules (CLAUDE.md memory, "Testing").
**Apply to:** the wheel guard, D-07 guard, purge case and note guard. Write the test first and see it RED against today's code, apply the fix, then neuter the fix (restore from a byte backup, never `git checkout`/`restore`/`stash` on uncommitted work), see RED, restore. Grep censuses with `grep -a`.

### ROADMAP edit for the D-01 reading
**Source:** `193-CONTEXT.md` D-01 and CLAUDE.md deviation policy (record in CONTEXT and ROADMAP).
**Apply to:** the ROADMAP Phase 193 section. Hand-edit; add the D-01 reading as a **bold field line** inside the Phase 193 section. `scripts/check-planning-hygiene.ts` rules 6d/6e fail lint if a new heading appears between the `### Phase 193` heading and its `Plans:` list, or an unchecked bullet names another phase as "Phase N". `git diff` after any gsd-tools handler. Use the same shape other bold-field lines in that section use (read the section before editing; do not copy this document's wording).

### D-08 PROD count (execution-time, not a code pattern)
Read-only count of empty notes through the Supabase MCP, one query per call, marker query first (`SELECT shobj_description(oid, 'pg_database') ...`), before the fix merges. Record counts and the date only (public repo: no user ids, PROD identifiers or home paths). Rows left in place. The three query shapes are in `193-RESEARCH.md` "Environment Availability".

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Firing `IntersectionObserver` stub for the D-07 guard | test helper | event-driven | Only `src/test-setup.ts` `IntersectionObserverStub` (a no-op) exists. Use the RESEARCH Code Examples `FiringIO` class (callback invoked with `isIntersecting: true` on `observe`) via `vi.stubGlobal("IntersectionObserver", FiringIO)`. `unstubGlobals: true` in `vitest.config.ts` restores it per test. |
| Focus-on-Edit-click for the note textarea | component behaviour | event-driven | No note surface focuses via a ref today (all use `autoFocus`). Plan a small ref + effect in the click path (RESEARCH A5: cosmetic risk only); no analog to copy. |
| `RangeEyebrow` focus move to the label after reset | component behaviour | event-driven | No in-file precedent for programmatic focus on a `<p tabIndex={-1}>`. Follow the UI-SPEC I-2.5 contract. |

## Metadata

**Analog search scope:** `src/app/factsheet/[id]/v2/`, `src/components/notes/`, `src/app/(dashboard)/allocations/components/`, `src/lib/storage/`, `src/test-setup.ts`, `src/lib/storage-namespaces.ts`.
**Files scanned:** about 30 read or grepped (the 12 source files and the 7 test files named above, plus `LazyMount.tsx`, `useNoteAutoSave.ts`, `test-setup.ts`).
**Not re-measured here (carried from RESEARCH):** the counts of `hideAllocatorSection` callers and `peerPercentile` / `allocatorPortfolios` consumers, and 
**Pattern extraction date:** 2026-11-06
