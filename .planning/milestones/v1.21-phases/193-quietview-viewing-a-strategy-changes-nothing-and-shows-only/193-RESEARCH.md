# Phase 193: QUIETVIEW — viewing a strategy changes nothing and shows only its own content - Research

**Researched:** 2026-11-06
**Domain:** Client-side React/Next.js factsheet interaction (wheel zoom, view-state persistence), removal of placeholder/demo content, and note-card write-on-blur. In-repo only: no new package, no schema change.
**Confidence:** HIGH (every claim below was read in the worktree this session; the three items that were not run are tagged `[ASSUMED]` in the Assumptions Log)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Chart range (area 1 — founder changed Q1, accepted Q2-Q3)**
- **D-01 (founder override of the recommendation, 2026-11-06):** plain mouse-wheel over a factsheet chart no longer zooms; zoom stays available only on **Ctrl/⌘ + wheel**. The founder chose "Ctrl+wheel zoom" over "remove wheel zoom entirely". Plain scrolling must scroll the page and leave the date range and every headline figure unchanged. SC-1 reads "the range changes only through an explicit control"; Ctrl/⌘+wheel counts as that explicit control by this decision. ⚠️ The plan must record this reading in the ROADMAP Phase 193 section too (deviation policy: CONTEXT and ROADMAP).
- **D-02** The view range is no longer persisted to localStorage or the URL query string. On load, any range a browser saved before this change is ignored and deleted. A later visit or reload opens the full history.
- **D-03** A narrowed range is labelled next to the figures it changes ("Showing <start> – <end>", the dates shown) with a one-click "Reset to full history" control (an existing "Reset view" control is at `FactsheetView.tsx:2873`).

**Placeholder and foreign content (area 2, accepted as recommended)**
- **D-04** Remove the "Synthesized peer cohort (deterministic seed)…" panel (`BatchDPanels.tsx:125`); synthesized data is invented data.
- **D-05** Remove the "Demo portfolios" / "Suggested MultiMarket sleeve" allocator section from the factsheet (`BatchDPanels.tsx:303`, `:351`).
- **D-06** Hide the "Commercial terms not yet wired through from the strategy registry." row (`MandatePanels.tsx:153`).
- **D-07** A test goes RED if any of the three strings, or content belonging to another strategy or portfolio, renders again.

**No write on view (area 3, accepted as recommended)**
- **D-08** Before the fix, a read-only PROD count of empty notes is recorded through the Supabase MCP, one query per call, marker query first. Rows are left in place.
- **D-09** Measure the write path first (the `StrategyNoteCard` textarea is `autoFocus` and saves on blur, `src/components/notes/StrategyNoteCard.tsx:42-60`, a candidate, not confirmed). Then: no `autoFocus`, and save only when the text actually changed and is non-empty.
- **D-10** A test is RED on today's behaviour: open the page, leave without typing, and no write happens.

### Claude's Discretion
- Whether the persistence codec and its storage key are deleted outright or kept as a one-shot purge of old keys.
- Label wording within DESIGN.md's voice rules.

### Deferred Ideas (OUT OF SCOPE)
- A real platform peer cohort (not chosen; new capability).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRUST-02 | Scrolling over a factsheet chart never changes its date range by itself. A narrowed range is always labelled with a one-click reset, and is never silently restored on a later visit. | Two wheel handlers found (`TimeSeriesChart.tsx`, `HistogramChart.tsx`), both with a native non-passive listener that `preventDefault`s every wheel (the page-scroll trap). Range persistence is in `factsheet-context.tsx` (URL + `factsheet-v2:` blob). A range label already exists (`RangeEyebrow`) and gets the reset button. Purge needs presence detection of the legacy field (see Pattern 2). |
| TRUST-03 | No factsheet shows developer notes, placeholder copy, or demo content that belongs to another strategy or portfolio. | Exact sources and mount points located (`BatchDPanels.tsx`, `MetricsColumn.tsx:482`, `FactsheetView.tsx:575/2211/3027`, `MandatePanels.tsx:153`). `MultiMarket` is hard-coded in `AllocatorSection` and appears nowhere else in `src` outside tests. D-07 guard has a vacuous-pass trap (LazyMount under the IntersectionObserver stub). |
| TRUST-06 | Opening any page writes nothing on the user's behalf (for example, viewing a strategy no longer creates an empty note). | Write path measured by reading: `autoFocus` on an empty note + unconditional blur `save(draft)` -> `PATCH /api/notes` -> `upsert` of `content: ""` plus an audit row. Four of five `useNoteAutoSave` surfaces share the defect; `DashboardNoteCard` already has the dirty check. |
</phase_requirements>

## Summary

All three requirements are fixable inside existing files with no new dependency, no migration and no schema change. The phase is removal plus three small behaviour gates. The UI-SPEC was checked against HEAD and is accurate on every load-bearing point (two wheel handlers, `RangeEyebrow` already printing the range label, five `useNoteAutoSave` surfaces, the removal sites). Four of its claims need correction or a caveat; they are listed under "UI-SPEC verification" below.

Five findings change how the plan should be written. (1) Today the native wheel listener calls `preventDefault` on every wheel event, so even if the React `onWheel` body is gated the page still cannot scroll; both charts need the native listener gated too. (2) Three existing tests fire a plain `fireEvent.wheel` and will go red after D-01; they must be repointed at `ctrlKey: true`, and become the positive arms. (3) The range-persistence purge cannot be done by "drop the field from the codec": nothing writes after hydration unless state changes, so a stale `range` would survive in localStorage and the URL; the codec must keep decoding `range` as a legacy field so the provider can detect it and delete it once. (4) The D-07 regression test is vacuous if written the obvious way, because `src/test-setup.ts` stubs `IntersectionObserver` as a no-op and `AllocatorSection` is wrapped in `LazyMount`; the guard must fire the observer or assert on the un-lazy wrapper and nav entry. (5) Three test files mock `useNoteAutoSave` with only `{saveState, lastSavedAt, save}`, so the dirty-check must live in the components (the `DashboardNoteCard` idiom), not in new hook methods.

Payload fields `peerPercentile` and `allocatorPortfolios` are produced server-side and pinned by about 13 files including a snapshot and the `unstable_cache` key version in `page.tsx`. The recommendation is UI-only removal in this phase and a booked follow-up for the producers (Open Question 3).

**Primary recommendation:** Gate both wheel handlers (React and native) on `ctrlKey || metaKey`; stop persisting `range` and purge legacy copies once on hydration; add the reset button inside `RangeEyebrow`; delete the three demo/developer items at the render site only (keep payload fields); add a component-local dirty check and remove `autoFocus` on the four note surfaces. Write each RED test first and confirm it fails against today's code.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Wheel/zoom gesture | Browser / Client (SVG event handlers) | — | Pure DOM event handling in `"use client"` chart components. |
| View-range state and its persistence | Browser / Client (React context, `localStorage`, `history.replaceState`) | — | The provider owns it; the server never sees `range`. Removing persistence is a client-only change. |
| Range label and reset control | Browser / Client | — | Derived from `RangeScope` in `basis-context.tsx`; reset calls `resetXRange`. |
| Demo/placeholder content removal | Browser / Client (render sites) | API / Backend (payload builder still emits the data) | Render-site removal is the phase scope; builder removal is a follow-up (Open Question 3). |
| Note save-on-blur | Browser / Client (decides whether to call) | API / Backend (`/api/notes` PATCH upserts) | The defect is the client sending an empty write the user did not intend. The route correctly accepts `""` for a deliberate clear. |
| PROD empty-note count (D-08) | Database / Storage (read-only, via MCP at execution time) | — | Evidence for the record; no code path. |

## Standard Stack

### Core

No new libraries. Everything uses what is already installed.

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| react | 19.3.1 | components, hooks | `[VERIFIED: package.json:44]` `"react": "19.3.1"` |
| next | ^16.4.2 | app router | `[VERIFIED: package.json:40]` `"next": "^16.4.2"`. `window.history.replaceState` is documented as integrated with the router `[CITED: node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md]`. |
| vitest | ^5.0.3 (ran as v5.0.5) | unit/component tests | `[VERIFIED: package.json:76]`; ran `npx vitest run` on two files this session: 17 passed. |
| @testing-library/react | ^16.3.3 | render, `fireEvent` | `[VERIFIED: package.json:61]` |
| @testing-library/user-event | 14.6.8 | real focus/blur sequences | `[VERIFIED: package.json:62]` |
| jsdom | ^30.1.3 | test DOM | `[VERIFIED: package.json:71]` |
| @playwright/test | ^1.64.1 | e2e (optional backstop) | `[VERIFIED: package.json:58]` |

### Supporting
In-repo seams to reuse (not packages): `useCrossTabStorage` (`src/lib/storage/cross-tab.ts`, exposes `value`, `setValue`, `removeStored`, `readOnly`, `isHydrated`), `useNoteAutoSave`, `NoteSaveStatus`, `resetXRange` from `useXRange()`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Keep codec, decode `range` as legacy for a one-shot purge (recommended) | Delete the codec outright | The codec also carries `cmp`, `cb`, `reg`, `dark`, which D-02 and UI-SPEC A-5 keep persisting. Deleting it would silently reset every user's comparator and display toggles. |
| Keep codec, decode `range` as legacy for a one-shot purge (recommended) | Move to a new storage key and delete the old one | Resets `cmp/cb/reg/dark` for everyone; the provider comment calls an unversioned byte-compatible blob a deliberate gate. |
| Component-local dirty check (recommended) | New `saveIfChanged` on `useNoteAutoSave` | Three test files mock the hook with only `{saveState,lastSavedAt,save}` (`HoldingDetail.test.tsx:31-37`, `HoldingsTable.sub-row.test.tsx:50`, `HoldingsTable.sub-row.errors.test.tsx:42`); a new method would be `undefined` there. |

**Installation:** none.

**Version verification:** no packages added, so no registry lookup applies.

## Package Legitimacy Audit

No external packages are installed or recommended by this phase. `gsd-tools query package-legitimacy check` was not run because there is nothing to check.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
 WHEEL (D-01)                                   RANGE STATE (D-02, D-03)
 wheel event on chart <svg>                     page load (/factsheet/[id]/v2, /allocations Overview)
   |                                              |
   +--> native listener (non-passive)             +--> useCrossTabStorage deferred load -> storedView
   |      ctrl|meta ? preventDefault : (nothing)  |      (codec still decodes legacy `range`)
   |                                              v
   +--> React onWheel (root, passive)            hydration effect (one-shot, persist=true only)
          ctrl|meta ? zoom : return                 |-- URL has range=?  -> delete param, replaceState
                |                                   |-- storedView.range? -> strip it (or removeStored if blob now empty)
                v                                   |-- cmp / cb / reg / dark: unchanged
        setXRange -> XRangeContext                  v
                |                            xRange stays at fullRange (never narrowed on load)
                v                                   |
   useWindowedView -> RangeScope{kind,start,end}    v
        |                                    write effect (cmp/cb/reg/dark only; NOT keyed on xRange)
        +--> RangeEyebrow (strip + rail)
               kind==="selected" ? [label <p> + "Reset to full history" button -> resetXRange(); focus label <p>]
               kind==="full"     ? [label <p>]

 NOTES (D-09, D-10)
 note surface mounts -> textarea shown (empty note) WITHOUT focus
   user types -> draft != persisted
   blur -> draft === persisted || draft.trim()==="" ? no PATCH : save(draft)
   "Edit" click -> focus textarea via ref in the click path
   save("saved") -> persisted baseline advances (DashboardNoteCard idiom)
```

### Recommended Project Structure
No new directories. Optional single new file for the shared wheel rule:
```
src/app/factsheet/[id]/v2/
├── wheel-zoom.ts            # isZoomWheel(e): ctrlKey || metaKey (new, ~5 lines; optional)
├── TimeSeriesChart.tsx      # gate onWheel + native listener
├── HistogramChart.tsx       # gate onWheel + native listener + hint copy + legend flex-wrap
├── factsheet-context.tsx    # stop persisting range; one-shot purge
├── MetricsColumn.tsx        # RangeEyebrow gains the reset; peer panel gate loses its api arm
├── BatchDPanels.tsx         # delete AllocatorSection, DemoBadge, api arm of PeerPercentilePanel
├── FactsheetView.tsx        # AllocatorSection mount, nav entry, footer sentence, (optional) caption word
└── MandatePanels.tsx        # drop the developer sentence
```

### Pattern 1: Wheel gate (both charts, both layers)
**What:** a wheel zooms only with Ctrl or Cmd held; otherwise nothing happens and the browser scrolls the page.
**When to use:** `TimeSeriesChart.tsx` and `HistogramChart.tsx`; the only two wheel handlers in `src` (`grep -rnE "onWheel|\"wheel\"|'wheel'" src`, non-test hits: `TimeSeriesChart.tsx:724,821,941`, `HistogramChart.tsx:163,205,272`).
**Root cause being fixed:** today the native listener is `const handler = (ev: WheelEvent) => { if (ev.cancelable) ev.preventDefault(); };` on every wheel (`TimeSeriesChart.tsx:820`, `HistogramChart.tsx:204`), which blocks page scrolling. Gating only the React body would still trap the scroll.
```ts
// wheel-zoom.ts (optional shared rule; one rule for two charts)
export const isZoomWheel = (e: { ctrlKey: boolean; metaKey: boolean }): boolean =>
  e.ctrlKey || e.metaKey;

// native listener (both charts)
const handler = (ev: WheelEvent) => {
  if (isZoomWheel(ev) && ev.cancelable) ev.preventDefault();
};

// React handler (both charts): gate FIRST, before the deltaY === 0 early return
const onWheel = useCallback((e: ReactWheelEvent<SVGSVGElement>) => {
  if (!isZoomWheel(e)) return;
  if (e.deltaY === 0) return;
  /* existing body unchanged */
}, [/* unchanged */]);
```
Trackpad pinch arrives as wheel + `ctrlKey`, so it zooms the chart and (because `preventDefault` runs) does not zoom the page while over the chart; this is accepted in UI-SPEC I-1.

### Pattern 2: Stop persisting `range`; purge legacy copies once
**What:** remove `range` from the write path and the read path, and delete any copy a browser already holds.
**Why detection must be explicit:** the write effect only runs when a dependency changes (`[xRange, comparator, colorblind, regimes, darkMode, ...]`). After this change hydration no longer changes `xRange`, so nothing would rewrite the blob; a stale `{"range":"10-120",...}` would sit in `localStorage` forever and a `?range=` URL would stay until the next write. Dropping `range` from the codec's projection alone therefore does **not** purge. Keep `range?: string` in `PersistedState` and in `parsePersistedFields` as a **decode-only legacy field**, never encoded.
```ts
// factsheet-context.tsx, inside the existing hydration effect, after `if (!persist) return;`
const params = new URLSearchParams(window.location.search);
if (params.has("range")) {
  params.delete("range");
  const qs = params.toString();
  window.history.replaceState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`);
}
if (storedView.range !== undefined && !readOnly) {          // readOnly: forward-compat newer blob, do not touch
  const { range: _legacy, ...rest } = storedView;
  if (Object.keys(rest).length === 0) removeStored(EMPTY_PERSISTED);
  else setStoredView(rest);
}
// ...and DELETE the `rangeRaw` block (`const rangeRaw = get("range"); ... setXRangeRaw(...)`).
```
- `readOnly` and `removeStored` are already returned by the hook `[VERIFIED: src/lib/storage/cross-tab.ts:123-135]`; the provider currently destructures only `value`, `setValue`, `isHydrated`.
- Purge only fires when a legacy range is present: a visitor with no saved range gets **no** storage or URL write on open (this is part of the "opens write nothing" contract and must be asserted).
- In the write effect: remove `range` from `state`, remove the `params.set("range")` / `params.delete("range")` lines, and **remove `xRange` from the dependency array**. As written, every pan frame re-armed a 250 ms debounce that re-wrote an identical blob; with `range` gone, a pan has nothing to persist.
- `persist={false}` (scenario composer) keeps its early returns: no purge, no write.
- Comments to update: the "Persistence: xRange + comparator + toggles ..." block (`factsheet-context.tsx:20-22`), the `PersistedState` doc, the `persist` prop doc mentioning `?range=`, and `ScenarioFactsheetChart.tsx:44`.

### Pattern 3: Reset control inside `RangeEyebrow`
**What:** `RangeEyebrow` (exported from `MetricsColumn.tsx`, rendered by the KPI strip at `FactsheetView.tsx:1951` and the rail at `MetricsColumn.tsx:347`) wraps the existing `<p>` and adds a button when `scope.kind === "selected"`. Both mounts are inside a `FactsheetProvider` (the strip and rail call `useWindowedView`, which reads `useXRange`), so calling `useXRange()` inside `RangeEyebrow` does not throw.
- Keep the `<p data-testid="range-eyebrow-{surface}">` text byte-identical: tests pin `textContent` exactly (`FactsheetView.window-kpis.test.tsx:199,201,205`, `MetricsColumn.window.test.tsx:231`).
- Move the `className` prop to the new wrapper `div` so the strip keeps `mt-6`.
- Button classes: copy the ControlBar `Reset view` string verbatim: `px-2.5 py-1 text-caption rounded-sm border bg-surface-subtle text-text-2 border-border hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent min-h-[28px] pointer-coarse:min-h-[44px]` `[VERIFIED: FactsheetView.tsx:2870]`, plus `factsheet-v2-no-print` (defined `display: none` in print at `globals.css:535`).
- Click: `resetXRange(); labelRef.current?.focus();` with `tabIndex={-1}` on the `<p>`. Focus is moved before the button unmounts, so it is never lost to `<body>`.
- The ControlBar `Reset view` keeps its own behaviour (comparator + range) and its analytics event.

### Pattern 4: Note surfaces never write on open
**What:** per surface, hold a `persisted` baseline (what the server is known to hold), advance it only when `saveState === "saved"`, and skip the PATCH on blur when nothing changed or the draft is blank. Remove `autoFocus`; focus the textarea from the **Edit click** path via a ref.
```tsx
// shared shape for StrategyNoteCard, HoldingNoteRow, BridgeOutcomeNoteSection, HoldingDetail
const [persisted, setPersisted] = useState(initialContent);   // loaded surfaces: set from the GET result
const pendingRef = useRef(initialContent);
useEffect(() => { if (saveState === "saved") setPersisted(pendingRef.current); }, [saveState]);

const onBlurTextarea = () => {
  if (draft === persisted || draft.trim() === "") return;     // single predicate, one line to change for Q-1
  pendingRef.current = draft;
  void save(draft);
  setContent(draft);
  setEditing(false);
};
```
Reference idiom: `DashboardNoteCard.tsx` (`if (content === lastSavedContent) return;` with `lastSavedContent` advanced on `"saved"`) `[VERIFIED: src/app/(dashboard)/allocations/components/DashboardNoteCard.tsx]`. Keep the single predicate in one place so Open Question 1 is a one-line flip. The existing `HoldingDetail` data-loss fence (`if (noteLoadError) return;`) stays.
- For the three lazily-loaded surfaces (`HoldingNoteRow`, `BridgeOutcomeNoteSection`, `HoldingDetail`) the baseline is set where the GET result is applied (`setNoteContent(c)` / `setContent(c)`), and is `""` on 404.
- A skipped blur must leave the card truthful and silent: no `save`, so `NoteSaveStatus` shows nothing (idle with no timestamp renders empty).

### Anti-Patterns to Avoid
- **Gating only `onWheel`:** leaves the native `preventDefault` on every wheel, so the page still cannot scroll.
- **Hiding removed panels with CSS / `hideAllocatorSection`:** the guard test would pass while the content still ships. Removal means not in the DOM.
- **Deleting `factsheetViewStateCodec` or the storage key:** drops comparator and display persistence that D-02 does not name.
- **A D-07 test that mounts `FactsheetBody` with `hideAllocatorSection` or `hideFooter`:** most existing fixtures do (43 test and source files mention `hideAllocatorSection`), so copying one of them makes the guard unable to fail.
- **Asserting `fetch` was not called at all in the note tests:** `HoldingNoteRow`, `BridgeOutcomeNoteSection` and `HoldingDetail` GET `/api/notes` on mount by design. Assert on calls with `method === "PATCH"`.
- **Editing `supabase-migrate.yml`, ci.yml gates, or adding a `[skip ci]`-style token to a commit message:** unrelated to this phase and forbidden by CLAUDE.md.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Persisted-state deletion | raw `localStorage.removeItem` | `removeStored` / `setValue` from `useCrossTabStorage` | The B25 lint capstone bans raw storage; the primitive also handles SSR, the dirty guard and fail-loud logging. |
| Dirty-check for notes | a second idiom | the `DashboardNoteCard` `lastSavedContent` idiom | In-repo precedent; the UI-SPEC names it explicitly. |
| Reset action | a new range reset | `resetXRange()` from `useXRange()` | The only action the control performs. |
| Button styling | a `Button` primitive or new classes | the ControlBar `Reset view` class string | `Button` `sm` is white-fill `px-3 py-1.5` and would not match the neighbouring reset. |
| Range label | a second "Showing …" line | the existing `RangeEyebrow` (`Selected range: …`) | Already printed beside both sets of range-following figures from the same `RangeScope` (T-169-43). |

**Key insight:** nearly everything this phase needs already exists in the repo (the label, the reset action, the dirty-check idiom, the storage primitive). The work is removing code and tightening three conditions, not building.

## Runtime State Inventory

(Included because D-02 deletes previously persisted state. The phase is not a rename.)

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Browser `localStorage` key `factsheet-v2:<strategyId>` may hold `"range":"<s>-<e>"` for any past visitor. `user_notes` rows with empty content may exist in PROD (written by the defect) | Code: one-shot client purge on hydration (Pattern 2). PROD notes: count only (D-08), rows left in place by decision |
| Live service config | None. `range` is never sent to a server or cached server-side; `revalidateTag(\`factsheet-v2:${id}\`)` in `fetch-and-build-payload.ts` is an unrelated cache tag with the same prefix | None, verified by grep of `src` |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | None | None |

**URL state:** any bookmarked or shared URL carrying `?range=a-b` is rewritten without it on load. `ShareLinkButton` builds `?share=1` from `window.location.pathname`, so published share links never carried `range` `[CITED: comment at FactsheetView.tsx, "rebuilds the URL as <origin><pathname>?share=1"]`.

## Common Pitfalls

### Pitfall 1: The purge never runs
**What goes wrong:** the codec stops reading `range`, hydration stops applying it, and the stale blob/URL survive indefinitely.
**Why it happens:** the write effect only fires on a dependency change; after the fix nothing changes on hydration.
**How to avoid:** decode `range` as a legacy field and delete it explicitly in the hydration effect (Pattern 2). Test with a seeded blob and assert `removeItem`/`setItem` and `replaceState` calls.
**Warning signs:** after reload, `lsStore.get(KEY)` still contains `range`.

### Pitfall 2: Three existing tests go red on the wheel change
**What goes wrong:** `charts.signed-zero.test.tsx:274` (`fireEvent.wheel(svg, { deltaY: -577, ... })` on `HistogramChart`), `TimeSeriesChart.window-gesture.test.tsx:233,265` and `FactsheetView.headline-coverage.test.tsx:1652` fire wheels with no modifier `[VERIFIED: grep]`.
**How to avoid:** add `ctrlKey: true`. They then double as the "Ctrl+wheel still zooms" positive arms.

### Pitfall 3: D-07 guard that cannot fail
**What goes wrong:** `AllocatorSection` is inside `LazyMount`, and `src/test-setup.ts:259-270` replaces `IntersectionObserver` with a no-op stub, so `LazyMount` never mounts its children in tests. A guard asserting "Allocator Portfolio Analysis is absent" passes against today's code.
**How to avoid:** install a test-local `IntersectionObserver` that calls its callback with `isIntersecting: true` on `observe`, and in addition assert the un-lazy signals, which are RED today for an `ingestSource: "api"` payload: `document.getElementById("factsheet-allocator")` is null and the SectionNav has no "Allocator" link. Run the guard against today's code and confirm each assertion arm goes red before applying the removal.

### Pitfall 4: Test fixtures that skip the content under test
**What goes wrong:** the D-07 test must render without `hideAllocatorSection` and without `hideFooter` (the footer sentence), on an **api** payload (the peer and allocator sections gate on `ingestSource === "api"`), with a strategy name that is not MultiMarket (`FactsheetView.window-kpis.test.tsx` names it generically; use a similar fixture).

### Pitfall 5: Peer panel tests that render the api arm directly
`BatchDPanels.peer-scenario.test.tsx:150` ("api path: 'Demo cohort' badge + italic synthesized-cohort footnote UNCHANGED"), `FactsheetBody.basis.test.tsx:1169` and `FactsheetView.leverage.test.tsx:658` render `<PeerPercentilePanel />` on an api payload to test the basis and leverage notes. After the api arm is removed these must be repointed at a csv scenario payload (the arm that remains) or deleted with the arm.

### Pitfall 6: Dead-code and prop fallout from removing `AllocatorSection`
`hideAllocatorSection` appears in 68 places across 43 files. Recommended: keep it in the `FactsheetBody` props type as an accepted no-op (not destructured, so no unused-variable warning), mark it deprecated in a comment, and leave callers alone; this also keeps `FactsheetView.tsx` edits narrow for Phase 195. `BaseLeverageNote.wiring.test.tsx` (`AllocatorSection` case, line ~84) and `BatchDPanels.null-honest.test.tsx` / the allocator half of `panels.signed-zero.test.tsx` test the deleted component and are deleted or shrunk with it. `panels.signed-zero.test.tsx:305-315` quotes `Correlation with MultiMarket` and `MultiMarket mean return`.

### Pitfall 7: Strings quoted in unrelated pins
The what-if caption at `FactsheetView.tsx:1943` says "peer, allocator, and event-study panels stay at base 1×" and is pinned verbatim at `FactsheetView.leverage.test.tsx:324`. After removal "allocator" names a panel that is gone. See Open Question 4.

### Pitfall 8: plan-anchor-verify and planning hygiene
CI re-resolves every `file:line` anchor a pending PLAN.md asserts; cite by symbol (line numbers in this document are as read on 2026-11-06 and drift). The ROADMAP edit for D-01 must keep `scripts/check-planning-hygiene.ts` rules 6d/6e happy: no new heading between the `### Phase 193` heading and its `Plans:` list (use a bold field line), and no unchecked bullet that names another phase as "Phase N". Edit ROADMAP by hand and `git diff` after any gsd-tools handler (CLAUDE.md).

### Pitfall 9: ship-time obligations
Every ship needs a CHANGELOG entry and a byte-equal `VERSION`/`package.json` bump (CLAUDE.md). Close-out `VERIFICATION.md` must use `verified_at_sha` + `drift_subjects`, never `covered_files`/`covered_digest`. These belong to ship/verify, not to execution plans.

## Code Examples

### Wheel RED test (plain wheel must neither change the range nor be default-prevented)
```tsx
// Source: pattern from TimeSeriesChart.window-gesture.test.tsx (mountZoomed, ev helper) + RTL fireEvent
it("a plain wheel leaves the range alone and does not block page scroll; Ctrl and Cmd still zoom", async () => {
  const { svg } = await mountZoomed();
  const before = live();
  const notPrevented = fireEvent.wheel(svg, { deltaY: -100, clientX: PLOT_X, clientY: PLOT_Y });
  expect(notPrevented).toBe(true);               // today: false (native handler prevents every wheel)
  expect(live()).toEqual(before);                // today: changes
  const ctrlPrevented = fireEvent.wheel(svg, { deltaY: -100, ctrlKey: true, clientX: PLOT_X, clientY: PLOT_Y });
  expect(ctrlPrevented).toBe(false);
  expect(live()).not.toEqual(before);
  expect(fireEvent.wheel(svg, { deltaY: -100, metaKey: true, clientX: PLOT_X, clientY: PLOT_Y })).toBe(false);
});
```

### D-07 guard with a firing IntersectionObserver
```tsx
// Source: src/test-setup.ts stubs IntersectionObserver as a no-op; override per test
class FiringIO { constructor(cb: IntersectionObserverCallback) { this.cb = cb; }
  cb: IntersectionObserverCallback;
  observe(el: Element) { this.cb([{ isIntersecting: true, target: el } as IntersectionObserverEntry], this as never); }
  unobserve() {} disconnect() {} takeRecords() { return []; } }
vi.stubGlobal("IntersectionObserver", FiringIO);   // unstubGlobals is on in vitest.config.ts
// render <FactsheetProvider persist={false}><FactsheetBody payload={apiPayload /* not named MultiMarket */} /></FactsheetProvider>
const text = container.textContent ?? "";
for (const s of ["Synthesized peer cohort","deterministic seed","Production: replace","Demo cohort","Demo portfolios",
  "Allocator Portfolio Analysis","Suggested MultiMarket sleeve","Commercial terms not yet wired through",
  "Demo cohorts and demo portfolios","MultiMarket","60/40 Stocks/Bonds","Multi-Asset Risk Parity","Diversified Crypto Book"])
  expect(text, s).not.toContain(s);
expect(document.getElementById("factsheet-allocator")).toBeNull();
```

### D-10 note guard (one per surface, plus a positive arm)
```tsx
// Source: StrategyNoteCard.test.tsx conventions (fetch stub, makeResponse)
const patches = () => fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "PATCH");
const user = userEvent.setup();
render(<StrategyNoteCard strategyId="s" initialContent="" initialLastSavedAt={null} />);
await user.click(document.body);                      // leave without typing
expect(patches()).toHaveLength(0);                    // today: 1 (autoFocus then blur saves "")
// positive arm: type "x", blur -> exactly one PATCH with content "x"
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Plain wheel zooms the chart and traps page scroll | Ctrl/Cmd+wheel zooms; plain wheel scrolls the page | this phase (D-01) | Standard pattern for embedded zoomable charts; pinch arrives as ctrl+wheel |
| View range persisted to URL and localStorage | Range is session-local; opens at full history | this phase (D-02) | Removes the silently-clipped-range class (Phase 194 depends on it) |
| Blur always saves | Blur saves only on a real change | this phase (D-09) | Matches `DashboardNoteCard` since Phase 100 F-1 |

**Deprecated/outdated:** the `hideAllocatorSection` prop becomes a no-op; `PeerPercentilePanel`'s api/demo arm and `DemoBadge` go away.

## UI-SPEC verification (claims checked at HEAD)

| UI-SPEC claim | Result |
|---------------|--------|
| Exactly two wheel handlers (TimeSeriesChart, HistogramChart) | Confirmed by `grep -rnE "onWheel|\"wheel\"|'wheel'" src`; no other zoom library or `handleScale` use in `src`. |
| Native listener calls `preventDefault` on every wheel | Confirmed (`TimeSeriesChart.tsx:820`, `HistogramChart.tsx:204`). |
| `RangeEyebrow` already prints `Full history: …` / `Selected range: …` and exports from `MetricsColumn.tsx` | Confirmed (`MetricsColumn.tsx:822-841`). |
| Five `useNoteAutoSave` surfaces, `DashboardNoteCard` already dirty-checked, other four `autoFocus` | Confirmed. `autoFocus` at `StrategyNoteCard.tsx:60`, `HoldingNoteRow.tsx:245`, `BridgeOutcomeNoteSection.tsx:106`, `HoldingDetail.tsx:242`. |
| Removal sites and the footer sentence, nav entry | Confirmed (`FactsheetView.tsx:575`, `2211`, `3027`; `MetricsColumn.tsx:482`; `MandatePanels.tsx:153`). |
| **"A strategy with no series keeps today's behaviour (the label is not rendered when there are no dates)"** | **Not supported by code.** `RangeEyebrow` has no guard; empty dates print `— – —` via `isoToMonthDay`. Moot in practice because a payload with no data does not build, but do not write a test asserting the label is absent. |
| **"`FactsheetView.tsx` needs no edit for D-03"** | Confirmed, and `tests/visual/strategy-v2-type-scale.test.ts` counts the ControlBar button class string in `FactsheetView.tsx` only (`>= 7`), so a copy in `MetricsColumn.tsx` neither helps nor breaks it. Optional: extend that lint to `MetricsColumn.tsx`. |
| **Omission:** the footer-removed sentence and "Allocator" nav are fine, but the UI-SPEC does not mention the what-if caption (`FactsheetView.tsx:1943`), the `hideAllocatorSection` prop, or that three tests plus the peer-panel direct-render tests need repointing | Added as Pitfalls 2, 5, 6, 7. |
| **Omission:** D-07 guard mechanics (LazyMount/IntersectionObserver) | Added as Pitfall 3; the UI-SPEC's "must go RED against today's code" is not achievable by a naive render. |
| Histogram wheel is a "local value-axis zoom" | Confirmed; it does not change the date range or any figure. Applying the Ctrl/Cmd rule to it is a consistency reading of D-01 ("a factsheet chart"), which is reasonable. `HistogramChart` already has a `Reset zoom` button. |

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | React `autoFocus` focuses the textarea on mount under jsdom, so `document.activeElement` is the textarea before any user input and `user.click(document.body)` then fires `blur` | Code Examples, D-10 | If not, the RED test needs an explicit `ta.focus()` first; the production defect is unaffected (real browsers focus). Confirm in the first RED run. |
| A2 | `fireEvent.wheel(...)` returns the `dispatchEvent` boolean (`false` when `preventDefault` was called) | Code Examples | If it did not, assert on a native `new WheelEvent(..., { cancelable: true })` dispatched on the svg and read `defaultPrevented`. |
| A3 | PostHog `factsheet_v2_view` capture on mount is third-party analytics, not a "write on the user's behalf" and out of D-08..D-10 scope | Security / Open Questions | If the founder counts it, a separate decision is needed; no DB row is written by it. |
| A4 | `HoldingNoteRow` / `BridgeOutcomeNoteSection` / `HoldingDetail` need an explicit user click to open (icon, caret, tab), so they are lower severity than `StrategyNoteCard`, but the same blur defect writes an empty row | Pattern 4 | If the founder wants only the page-open path fixed, drop them; UI-SPEC and D-09's "any page that carries a note" say include them. |
| A5 | The Edit-click focus can use a ref set in the click path without a layout flash | Pattern 4 | Cosmetic only. |

## Open Questions (RESOLVED in plans; Q-1 open for founder, default option A applied)

1. **Clearing a saved note (D-09 "non-empty").** [needs founder answer]
   - What we know: read literally, "save only when changed and non-empty" means a user who deletes all text of an existing note and blurs gets no save; the note returns on reload. `DashboardNoteCard` does allow clearing (it compares to the last saved content only).
   - What's unclear: whether "non-empty" was meant to forbid clearing.
   - Options: **(A, locked literal)** no save when `draft.trim() === ""` ever; **(B)** no save when unchanged, and no save when the draft is empty AND nothing is saved yet; clearing an existing note still saves `""`.
   - Recommendation: **B**, because it satisfies TRUST-06 (opening and leaving writes nothing) and does not remove a user capability. B needs the founder's explicit override recorded in CONTEXT and the ROADMAP. **Default for the planner if unanswered: A (the locked text)**, with the predicate in one place so flipping is a one-line change and the test arms are parametrised.
   - **RESOLVED for planning, OPEN for the founder:** the plans apply the default, option A (the locked D-09 text), through the one predicate `shouldSaveNoteOnBlur`; carried as A-193-12 in `193-07-PLAN.md`, where option B is a one-expression change plus its Q-1 test row.
2. **"Fees & Subscription" rows.** `MandatePanels.tsx` renders seven rows reading "— on request" under a code comment that calls the block "a contractual placeholder". SC-3 says "no placeholder copy". UI-SPEC A-2 keeps them (the rows state an honest fact) and removes only the developer sentence per D-06.
   - Recommendation: keep, per A-2; flag to the founder at verify time. Not decided here.
   - **RESOLVED:** kept per UI-SPEC A-2; the seven `— on request` rows stay and only the developer sentence goes (D-06, `193-04-PLAN.md`).
3. **Payload producers.** `build-payload.ts` still computes and ships `peerPercentile` (from `peer-cohort.ts`, the "deterministic seed" cohort) and `allocatorPortfolios` into the RSC blob and the cached payload. Removing the render does not stop the invented numbers shipping to the client.
   - Options: (A) UI-only removal now, book the producer removal; (B) also drop the fields.
   - Recommendation: **A**. B touches `types.ts`, `build-payload.ts`, the `build-payload.test.ts.snap` snapshot, about 13 test files (`grep -rlE "peerPercentile|allocatorPortfolios"`), and requires bumping the `unstable_cache` key version in `factsheet/[id]/v2/page.tsx` (the file records a v19 -> v20 bump for a payload shape change). Book it as a follow-up phase via `/gsd-phase`.
   - **RESOLVED:** option A; the removal is UI-only (`193-04-PLAN.md`, `193-06-PLAN.md`), and the producer removal is booked in `TODOS.md` as `[193-DEMO-PAYLOAD-PRODUCERS]` (`193-06-PLAN.md`).
4. **What-if caption wording.** After D-05 the caption names "allocator" panels that no longer exist. Options: leave verbatim (pinned at `FactsheetView.leverage.test.tsx:324`) or drop the word and update that one pin. Recommendation: drop "allocator," and update the pin; it is a one-line change in a file this phase already edits. Not covered by CONTEXT or UI-SPEC, so confirm.
   - **RESOLVED:** the caption word is dropped, so the clause reads `peer and event-study panels stay at base 1×`, and its one pin in `FactsheetView.leverage.test.tsx` moves with it (`193-04-PLAN.md` Task 2).
5. **Server-side hardening of `/api/notes`.** The route accepts `content: ""` and upserts it with an audit row. Recommendation: leave unchanged in this phase (a deliberate clear must still work, and D-09 locks the fix on the client).
   - **RESOLVED:** the route is unchanged, and so is `useNoteAutoSave` (`193-07-PLAN.md`).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | tests, tsc | ✓ | v25.8.1 | — |
| npm / vitest | all unit and component tests | ✓ | vitest v5.0.5 ran 17 tests green | — |
| Playwright + seeded Supabase | optional e2e wheel/scroll backstop | not probed (seeded CI only; needs the test-project env) | — | jsdom native-event tests cover the contract; the e2e is a backstop only |
| Supabase MCP (PROD, read-only) | D-08 count | not used in this research (forbidden here) | — | execution-time task, see below |

**Missing dependencies with no fallback:** none.

**D-08 is an execution-time task, not a research result.** Per CLAUDE.md: PROD reads go through the Supabase MCP, one read-only query per call, marker query first. Proposed shapes (table and column names verified from migrations: `user_notes(user_id, scope_kind, scope_ref, content, updated_at, created_at)` from `20260412094453_user_notes.sql` and `20260421060316_user_notes_multiscope.sql`; `audit_log(user_id, action, entity_type, entity_id, metadata, created_at)` from `20260407075303_portfolio_intelligence.sql`; the audit action and `content_length` metadata key from `src/app/api/notes/route.ts`):
```sql
-- 0. marker (must come back naming PROD)
SELECT shobj_description(oid, 'pg_database') AS which_database
  FROM pg_database WHERE datname = current_database();

-- 1. empty notes by scope (counts only, no ids)
SELECT scope_kind,
       count(*)                                       AS total_rows,
       count(*) FILTER (WHERE btrim(content) = '')    AS empty_rows,
       min(created_at) FILTER (WHERE btrim(content) = '') AS first_empty_at,
       max(created_at) FILTER (WHERE btrim(content) = '') AS last_empty_at
  FROM public.user_notes
 GROUP BY scope_kind
 ORDER BY scope_kind;

-- 2. empty saves seen by the audit trail (the PATCH wrote it, so this ties rows to the write path)
SELECT action,
       count(*) AS saves,
       count(*) FILTER (WHERE (metadata->>'content_length')::int = 0) AS zero_length_saves
  FROM public.audit_log
 WHERE action LIKE 'user_note.%.update'
 GROUP BY action
 ORDER BY action;
```
Record only the counts and the date in the phase artifacts (public repo: no user ids, no PROD identifiers). Rows are left in place by decision D-08. Run before the code fix merges.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest ^5.0.3 (v5.0.5 observed) with jsdom, `@testing-library/react` 16, `@testing-library/user-event` 14.6.8 |
| Config file | `vitest.config.ts` (jsdom project; `unstubGlobals: true`, `unstubEnvs: true`) |
| Quick run command | `npx vitest run "src/app/factsheet/[id]/v2/<file>" src/components/notes/<file>` |
| Full suite command | `npm test` (`vitest run`), plus `npm run typecheck` and `npm run lint` |
| Lint gates touching this phase | `eslint` (React compiler / hooks rules), `scripts/check-planning-hygiene.ts` (ROADMAP edit), `plan-anchor-verify` (PLAN anchors) |

### Phase Requirements -> Test Map

| Req / Criterion | Behavior | Test Type | Automated Command | File | RED on today's code? |
|-----------------|----------|-----------|-------------------|------|----------------------|
| TRUST-02 / SC-1 | Plain wheel over a time-series chart: range unchanged, event not default-prevented; Ctrl and Cmd zoom | component | `npx vitest run "src/app/factsheet/[id]/v2/TimeSeriesChart.window-gesture.test.tsx"` (extend) or new `TimeSeriesChart.wheel-gate.test.tsx` | extend/new | Yes: today the plain wheel changes the range and `fireEvent.wheel` returns false |
| TRUST-02 / SC-1 | Same for `HistogramChart`: plain wheel leaves the zoom hint/state; Ctrl zooms; hint copy reads `Ctrl/Cmd + wheel to zoom · double-click to reset` | component | `npx vitest run "src/app/factsheet/[id]/v2/charts.signed-zero.test.tsx"` (repoint existing wheel test to `ctrlKey: true`) + new arm | extend | Yes (plain-wheel arm) |
| TRUST-02 / SC-1 | Existing wheel tests repointed at `ctrlKey: true`: `charts.signed-zero.test.tsx:274`, `TimeSeriesChart.window-gesture.test.tsx:233,265`, `FactsheetView.headline-coverage.test.tsx:1652` | component | run those three files | existing | They go red on the code change until repointed; positive arms |
| TRUST-02 / SC-1 | Plain wheel scrolls the page in a real browser | e2e (backstop, optional) | `npx playwright test e2e/<new>.spec.ts` (needs seeded env and FLOW-01 dual wiring into `ci.yml`) | new, optional | n/a; UI-SPEC classes this as backstop |
| TRUST-02 / SC-2 | Hydration with `?range=` and a stored `range` opens full history; URL loses `range`; stored blob loses `range` (other fields kept) or is removed when empty; visitor with nothing stored causes no storage or URL write | provider | `npx vitest run "src/app/factsheet/[id]/v2/factsheet-context.provider.test.tsx"` (add cases; rewrite the "writes BOTH ?range= and blob after a pan" case into "a pan writes nothing") | extend | Yes: today the stored range is applied and written back |
| TRUST-02 / SC-2 | Codec still decodes a legacy `range` (purge detection) but `encode` never emits it | unit | `npx vitest run "src/app/factsheet/[id]/v2/factsheet-context.codec.test.ts"` (update `CANONICAL_BLOB` and the `'{"range":"0-9","cmp":"none"}'` expectation) | extend | n/a (contract change) |
| TRUST-02 / SC-2 | Selected range shows `Selected range: …` plus `Reset to full history` (strip and rail); click returns `Full history: …`, button gone, focus on label `<p>`; no button at full history; label text unchanged | component | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetView.window-kpis.test.tsx" "src/app/factsheet/[id]/v2/MetricsColumn.window.test.tsx"` (extend; reuse `RangeHarness` `zoom`/`reset`) | extend | Yes: no button exists today |
| TRUST-03 / SC-3 | D-07 guard: nine strings plus `MultiMarket` plus the three demo portfolio names absent; `#factsheet-allocator` absent; no "Allocator" nav link; scenario-blend peer panel still renders | component | new `src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx` | new | Yes, provided the IntersectionObserver is made to fire and the fixture omits `hideAllocatorSection`/`hideFooter` (Pitfall 3, 4); verify by running it before the removal |
| TRUST-03 / SC-3 | Fees block keeps its second sentence verbatim, loses the developer sentence | component | `npx vitest run "src/app/factsheet/[id]/v2/FactsheetBody.no-demo-content.test.tsx"` (same file) | new | Yes |
| TRUST-06 / SC-4 | For each of `StrategyNoteCard`, `HoldingNoteRow`, `BridgeOutcomeNoteSection`, `HoldingDetail`: open with no saved note, leave without typing -> zero `PATCH` calls; textarea not focused on open | component | `npx vitest run src/components/notes "src/app/(dashboard)/allocations/components/HoldingDetail.test.tsx"` (add arms; note `HoldingDetail.test.tsx` mocks the hook, so assert on `saveSpy`) | extend | Yes for `StrategyNoteCard` (autoFocus + blur saves `""`); verify the other three before the fix |
| TRUST-06 / SC-4 | Positive arm per surface: type then blur -> exactly one PATCH with that content; Edit click focuses the textarea | component | same files | extend | n/a (guards against a guard that never saves) |
| TRUST-06 / SC-4 | `DashboardNoteCard` unchanged: add one open-and-leave arm as a pin | component | `npx vitest run "src/app/(dashboard)/allocations/components/"` | extend | Already green (confirms it was never a writer) |
| SC-4 | D-08 PROD count recorded before the fix | manual, MCP | the three read-only queries above | evidence file in the phase dir | n/a |

### Sampling Rate
- **Per task commit:** the single test file the task touches (under 10 s each).
- **Per wave merge:** all files under `src/app/factsheet/[id]/v2/` plus `src/components/notes` plus `src/app/(dashboard)/allocations/components/HoldingDetail*` and `HoldingsTable.sub-row*`.
- **Phase gate:** `npm test`, `npm run typecheck`, `npm run lint` green before `/gsd-verify-work`.

### Wave 0 Gaps
- [ ] `FactsheetBody.no-demo-content.test.tsx` (new): D-07 guard (needs a firing `IntersectionObserver`).
- [ ] `TimeSeriesChart` wheel-gate test (new or extension) and a `HistogramChart` wheel arm.
- [ ] Provider cases for the purge and the "pan writes nothing" rewrite.
- [ ] `RangeEyebrow` reset cases.
- [ ] D-10 arms per note surface.
- No framework install or config change is needed.
- **Mandatory neuter-then-RED step (project rule, CLAUDE memory):** after the fix, for each new guard, neuter the fix (restore from a byte backup, never `git checkout/restore/stash` on uncommitted work), see RED, restore. The wheel guard, the D-07 guard, the purge case and the note guard each need this.

## Security Domain

`security_enforcement` is not set to false in `.planning/config.json` (the key is absent from the file read), so it is enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | unchanged |
| V3 Session Management | no | unchanged; sign-out still purges `factsheet-v2:` via `APP_NAMESPACED_PREFIXES` (prefix stays registered because the blob still holds `cmp/cb/reg/dark`) |
| V4 Access Control | no | `/api/notes` ownership (`checkScopeOwnership`) and RLS untouched |
| V5 Input Validation | yes (narrows) | the unvalidated-ish `?range=` URL parse (`T-169-44`, a crafted range bounded by `resolveRangeScope`) is removed from the hydration path entirely |
| V6 Cryptography | no | none |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Crafted `?range=` link makes a recipient view a clipped history that reads as the full record | Tampering / Spoofing | Range is no longer read from the URL (D-02); nothing to craft |
| Stale persisted clipped range distorts later figures (Phase 194 dependency) | Tampering (silent) | One-shot purge, full history on every load |
| Empty or accidental note write creating rows and audit events the user never intended | Repudiation / data integrity | Dirty-checked blur (D-09); rate limit (`notesUpsertLimiter`), CSRF guard and audit trail already on the route |
| Prototype-poison keys in a hand-edited blob | Tampering | `stripPoisonKeys` stays in the codec decode |
| Public-repo leakage | Information disclosure | The D-08 record must hold counts and dates only; no user ids, PROD identifiers or home-directory paths |

## Sources

### Primary (HIGH confidence): files read this session in the phase worktree
- `.planning/phases/193-…/193-CONTEXT.md`, `193-UI-SPEC.md`; `.planning/REQUIREMENTS.md` (TRUST-02/03/06 at lines 14, 15, 18); `.planning/ROADMAP.md` Phase 193 section; `DESIGN.md` (voice rules, glyph allow-list at lines 456/472, Decisions Log row 2026-09-27 for ControlBar voice); `CLAUDE.md` (project rules).
- `src/app/factsheet/[id]/v2/{TimeSeriesChart,HistogramChart,factsheet-context,MetricsColumn,BatchDPanels,MandatePanels,FactsheetView,LazyMount,basis-context}.tsx` (relevant ranges).
- `src/components/notes/{StrategyNoteCard,HoldingNoteRow,BridgeOutcomeNoteSection,useNoteAutoSave,NoteSaveStatus}.ts(x)`, `src/app/(dashboard)/allocations/components/{DashboardNoteCard,HoldingDetail}.tsx`, `src/app/api/notes/route.ts`, `src/lib/storage/cross-tab.ts`, `src/lib/storage-namespaces.ts`, `src/lib/factsheet/build-payload.ts` (peer and allocator producers).
- Migrations `20260412094453_user_notes.sql`, `20260421060316_user_notes_multiscope.sql`, `20260407075303_portfolio_intelligence.sql` (column names).
- Tests read for conventions and impact: `factsheet-context.provider.test.tsx`, `factsheet-context.codec.test.ts`, `FactsheetBody.guard04-no-bleed.test.tsx`, `FactsheetView.window-kpis.test.tsx`, `BatchDPanels.null-honest.test.tsx`, `BaseLeverageNote.wiring.test.tsx`, `FactsheetBody.degenerate.test.tsx`, `StrategyNoteCard.test.tsx`, `HoldingNoteRow.test.tsx`, `HoldingDetail.test.tsx`, `charts.signed-zero.test.tsx`, `TimeSeriesChart.window-gesture.test.tsx`, `tests/visual/strategy-v2-type-scale.test.ts`, `src/test-setup.ts`, `vitest.config.ts`, `playwright.config.ts`.
- `node_modules/next/dist/docs/01-app/01-getting-started/04-linking-and-navigating.md` (native `history.replaceState` integration).
- Ran `npx vitest run` on the codec and `StrategyNoteCard` tests: 17 passed (environment works in the worktree).

### Secondary / Tertiary
- None. No web search or package registry query was needed; no Context7 lookup applied (in-repo behaviour only).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, no new dependency; versions read from `package.json`.
- Architecture: HIGH, every mount point, handler and consumer was read; counts come from greps run this session.
- Pitfalls: HIGH for Pitfalls 1-8 (each traced to a file read); A1/A2 in the Assumptions Log are the only unrun items.
- Not measured here: D-08 PROD counts (execution-time by design), real-browser page-scroll behaviour (backstop e2e), `plan-anchor-verify` output.

**Research date:** 2026-11-06
**Valid until:** 2026-11-20 (the factsheet files are actively edited by neighbouring phases; Phase 195 TRIM edits `FactsheetView.tsx` after this phase, so re-anchor by symbol before executing)

## Suggested plan shape (for the planner; not a decision)

Seams that do not share files, so they can run as parallel plans or waves:
1. **Wheel gate** (TimeSeriesChart, HistogramChart, optional `wheel-zoom.ts`, three repointed tests, new wheel tests, the sr-only help sentence and histogram hint/legend wrap per UI-SPEC copy contract).
2. **Range persistence purge** (`factsheet-context.tsx`, provider and codec tests).
3. **Reset control + peer-panel gate** share `MetricsColumn.tsx`, so keep them in one plan or sequence them. Include the `BatchDPanels`, `FactsheetView` (mount, nav entry, footer, caption word) and `MandatePanels` removals and the D-07 guard plus test churn (Pitfalls 5-7).
4. **Notes** (four components, their tests, D-10 arms). Task 0 of this plan is the D-08 PROD count (MCP, one query per call, marker first), recorded before the code change merges.
5. **ROADMAP D-01 record**: a hand edit as a bold-field line inside the Phase 193 section (hygiene rules 6d/6e), done in whichever plan touches planning docs.
