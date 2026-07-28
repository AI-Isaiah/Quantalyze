# Phase 58: Coverage Legibility & Disclosure - Pattern Map

**Mapped:** 2026-07-01
**Files analyzed:** 6 new (4 components + 1 in-place extension + N unit tests) + 3 modified
**Analogs found:** 6 / 6 (every new file has an in-repo analog — this is a composition-of-existing-primitives phase)

> Presentation-only. No engine / `scenario.ts` / `scenario-window.ts` / numeric change.
> Every new surface READS the same membership axis (`coverageEligible` / `scenarioMetrics.member_ids`)
> that the dev desync guard at `ScenarioComposer.tsx:1813` reconciles — never re-derives it.
> All paths are absolute-from-repo-root under `/Users/helios-mammut/claude-projects/quantalyze/`.

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/app/(dashboard)/allocations/components/CoverageStateChip.tsx` (NEW) | component (presentational) | transform (props→JSX) | `src/components/ui/Badge.tsx` + `AutoExcludedRow` (`ScenarioComposer.tsx:3678`) | exact (chip precedent + amber tokens) |
| `src/app/(dashboard)/allocations/components/BlendHeader.tsx` (NEW) | component (presentational) | transform (metrics→text) | `KpiStrip.scenario.test.tsx` fixture shape + `ComputedMetrics` (`scenario.ts:129`) | role-match (reads engine output; no 1:1 header exists) |
| `src/app/(dashboard)/allocations/components/CoverageTimeline.tsx` (NEW) | component (presentational) | transform (spans→bars) | `dateday.ts` (scale) + `CollapsibleSection.tsx` (host) + `AutoExcludedRow` (a11y/motion idiom) | role-match (no existing gantt; scale + host analogs exact) |
| `src/app/(dashboard)/allocations/components/DefaultChangeNote.tsx` (NEW) | component (presentational + persistence) | event-driven (dismiss → localStorage) | `CollapsibleSection.tsx:71-102` (SSR-safe `useCrossTabStorage` + `rawStringCodec`) | exact (same persistence primitive + codec) |
| `AutoExcludedRow` include-cost button (MODIFY `ScenarioComposer.tsx:3678`) | component (in-place extension) | request-response (click → `applyWindow`) | `ScenarioComposer.tsx:2850-2865` (preset button → `applyWindow`) | exact (same window-set path) |
| `src/lib/storage-namespaces.ts:20` (MODIFY — add `composer.` or reuse) | config | — | `storage-namespaces.ts:20-31` `APP_NAMESPACED_PREFIXES` | exact (same registry) |
| `*.test.tsx` for each new child (NEW) | test | — | `KpiStrip.scenario.test.tsx`, `MonteCarloSection.test.tsx` (colocated child tests) | exact |
| `ScenarioComposer.test.tsx` (MODIFY — COVERAGE-03/04 integration) | test | — | `ScenarioComposer.test.tsx` Phase-57 window block (picker-capture + REAL `computeScenario`) | exact (extend) |

**Test file placement note:** child-component tests are COLOCATED as siblings (e.g. `KpiStrip.scenario.test.tsx`,
`MonteCarloSection.test.tsx`) — NOT under `__tests__/` (that dir holds only `bridge-to-composer-seam.test.tsx`).
Follow the colocated convention: `CoverageStateChip.test.tsx` next to `CoverageStateChip.tsx`.

---

## Pattern Assignments

### `CoverageStateChip.tsx` (component, transform) — COVERAGE-02

**Analogs:** `src/components/ui/Badge.tsx` (chip shape) + `src/app/(dashboard)/allocations/components/HoldingsTable.tsx:52-60` (amber-chip token precedent).

**Chip shape idiom** (`Badge.tsx:43-57`) — copy the `cn(...)` base + a `Record<state,string>` token map (Badge already does this with `colorMap`/`statusMap`):
```typescript
// Badge.tsx:51-57 — the shape to match (4px radius ladder, px-2 py-0.5, text-caption font-medium)
<span
  className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-caption font-medium", styles, className)}
>
  {displayLabel}
</span>
```
UI-SPEC pins the Phase-58 chip to `rounded-sm px-2 py-0.5 text-fixed-11 font-medium uppercase tracking-wide` (a tighter
badge tier); keep the `Record<CoverageState, {label, cls}>` lookup shape from Badge.

**Amber token precedent** — the exact three warning tokens the auto-excluded state must use (already the codebase's revoked-key chip):
```typescript
// HoldingsTable.tsx:52-60 — AMBER_CHIP_STYLE (the DESIGN.md reservation for transient-recoverable)
color: "var(--color-warning)",            // text  #B45309  → Tailwind: text-warning
backgroundColor: "var(--color-warning-bg)", // bg   #FEF3C7  → bg-warning-bg
border: "1px solid var(--color-warning-border)", // #FDE68A → border-warning-border
```
Auto-excluded chip = these three tokens. NEVER negative/red (`text-negative` `#DC2626`) — auto-excluded is
transient-recoverable, not permanent failure.

**State derivation (READ from existing memos — never re-derive):**
```typescript
// selected === false          → "manually-excluded"  (text-text-muted bg-track)
// selected && coverageEligible → "in-blend"           (text-accent bg-accent/10)
// selected && !coverageEligible→ "auto-excluded"      (amber tokens + coverageDropReason() inline)
```
`coverageEligible` is `ScenarioComposer.tsx:1762`; `selected` is `deAliased.state.selected[id]`. Thread as props;
do NOT import `covers`/`coverageSpanOf` into the chip.

**Inline reason (REUSE — no new copy):** `coverageDropReason()` at `ScenarioComposer.tsx:435` emits
`ends {Mon YYYY} — outside window` / `starts {Mon YYYY} — outside window` / `no data — outside window`.

---

### `BlendHeader.tsx` (component, transform) — COVERAGE-03

**Analog:** the honest engine output `ComputedMetrics` (`src/lib/scenario.ts:129-195`); test-fixture shape from
`KpiStrip.scenario.test.tsx:25-63`. No existing header component — this is the one genuinely new presentational shape,
but its INPUT is a verified, test-pinned engine struct.

**Read these fields ONLY (`scenario.ts:193-194, 154-155, 130`):**
```typescript
metrics.member_count  // number | undefined  → N (the honest divisor; read with ?? 0)
metrics.member_ids    // string[] | undefined
metrics.effective_start // string | null      → effStart
metrics.effective_end   // string | null      → effEnd
```
`member_count` is the blend divisor by construction (BLEND-06); NEVER count `coverageEligible` entries in the header
(Pitfall 1 — divisor desync). All four fields are OPTIONAL on the type (additive) — read with `?? 0` / `?? null`.

**Degrade order (LOCKED, `58-RESEARCH.md:513-521`):**
```typescript
const N = metrics.member_count ?? 0;
// N === 0 → "No strategies span the selected window"
// N === 1 → "1 strategy — not a blend"
// else    → `Mean of ${N} strategies · ${effStart}–${effEnd}`
// truncated (append "· window truncated from full range") when:
const truncated =
  unionSpan != null && effStart != null && effEnd != null &&
  (effStart > unionSpan.start || effEnd < unionSpan.end);  // lexicographic string compare
```
`unionSpan` = `fullRangeWindow` (`ScenarioComposer.tsx:1722` = `unionOf(selectedSpans)`).

**A11y / typography:** `role="status" aria-live="polite"` (NEVER `role="alert"` — non-blocking). Numbers + dates in
`font-mono tabular-nums` (Geist Mono) per DESIGN.md. This header is the phase's PRIMARY visual anchor (UI-SPEC §Interaction).

**Fixture-driven test shape** (copy `KpiStrip.scenario.test.tsx:25-51`): build an `EMPTY_METRICS` base then spread
per-case overrides (`{ ...EMPTY_METRICS, member_count: 2, effective_start: "...", effective_end: "..." }`).

---

### `CoverageTimeline.tsx` (component, transform) — COVERAGE-01

**Analogs:** `src/lib/dateday.ts:94-97` (`utcEpoch`/`parseIsoDay` date→x scale) + `src/components/ui/CollapsibleSection.tsx`
(collapsed-by-default host) + `AutoExcludedRow` (`ScenarioComposer.tsx:3696-3711`) for the a11y/motion idiom.

**Date→x scale (Pitfall 2 — NEVER `new Date(str)`):**
```typescript
// dateday.ts:94-97 — utcEpoch is the timezone-stable conversion (docstring: "chart x-axis scaling")
import { parseIsoDay, utcEpoch } from "@/lib/dateday";
const x0 = utcEpoch(parseIsoDay(union.start)!);
const x1 = utcEpoch(parseIsoDay(union.end)!);
const span = x1 - x0 || 1;                       // guard single-day union div-by-zero
const leftPct  = ((utcEpoch(parseIsoDay(s.first)!) - x0) / span) * 100;
const widthPct = ((utcEpoch(parseIsoDay(s.last)!) - utcEpoch(parseIsoDay(s.first)!)) / span) * 100;
```
`union` = `unionOf(selectedSpans)` (`scenario-window.ts:99`); per-strategy span = `coverageSpanOf` (already scanned once
in `selectedSpanById`, `ScenarioComposer.tsx:1639` — thread it down, do not re-scan).

**Bar encoding (WCAG-AA — color never the sole signal):** in-window portion `bg-accent`; out-of-window `bg-track`;
auto-excluded whole bar `bg-warning-bg` + `border-warning-border` (agrees with the row chip). Every bar carries an
`aria-label` restating coverage + membership as text (see `58-RESEARCH.md:552-560` skeleton).

**Collapsed-by-default host** (`CollapsibleSection.tsx:33-55`) — pass `defaultOpen={false}`; optionally persist via
`storageKey` under a registered prefix (or leave un-persisted). Native `<details>`, keyboard-accessible, respects
`prefers-reduced-motion` already.

**Motion idiom** (`AutoExcludedRow`, `ScenarioComposer.tsx:3699`): `transition-all duration-300 ease-out motion-reduce:transition-none`
(NOT `duration-250` — invalid Tailwind v4, Pitfall 5).

---

### `DefaultChangeNote.tsx` (component + persistence, event-driven) — POLISH-03

**Analog:** `src/components/ui/CollapsibleSection.tsx:71-102` — the EXACT SSR-safe `useCrossTabStorage` + `rawStringCodec`
boolean-persistence pattern this note reuses.

**Codec + hook** (copy `CollapsibleSection.tsx:71-90` verbatim, swap the codec to boolean):
```typescript
// rawStringCodec: src/lib/storage/codecs.ts:146-157 (decode is always "ok"; parse folds to a valid fallback)
const dismissedCodec = useMemo(
  () => rawStringCodec<boolean>({
    parse: (raw) => raw === "true",
    serialize: (v) => (v ? "true" : "false"),
  }), []);
const { value: dismissed, setValue: setDismissed, isHydrated } = useCrossTabStorage<boolean>({
  key: "composer.coverageDefaultChangeNoteDismissed",  // MUST match a registered prefix (see Shared Patterns)
  initial: false,                                       // server + first client render = not dismissed
  codec: dismissedCodec,
  sentryArea: "composer.default-change-note",
});
```
`useCrossTabStorage` deferred hydration (`cross-tab.ts:84-95`): server HTML == first client render (both use `initial`),
no mismatch. Gate the render on `isHydrated && !dismissed && intersectionTruncatesUnion` (Pitfall 3 — no flash-of-note).

**Visibility gate:** `intersectionTruncatesUnion` = the effective/intersection window is narrower than
`fullRangeWindow` (`unionOf(selectedSpans)`). Compute in `ScenarioComposer` and thread down.

**Escape hatch:** "Show full range" calls `applyWindow(fullRangeWindow)` (`ScenarioComposer.tsx:1705/1722`) — the existing
Full-range preset. No new window logic.

**A11y:** `role="status" aria-live="polite"`, `×` dismiss button. Copy verbatim:
`Now showing the common period where all {N} overlap · Show full range`.

---

### `AutoExcludedRow` include-cost button (MODIFY in place) — COVERAGE-04

**Analog:** the preset buttons at `ScenarioComposer.tsx:2850-2865` — the exact `onClick → applyWindow(range)` idiom.

**Apply path** (`ScenarioComposer.tsx:1705-1709`):
```typescript
const applyWindow = useCallback((range: { start: string; end: string }) => {
  windowTouchedRef.current = true;
  setWinStart(range.start);
  setWinEnd(range.end);
}, []);
```
The include target = `intersectionOf([currentWindow-as-span, strategySpan])` — pull `winStart` forward to
`max(winStart, span.first)` and `winEnd` back to `min(winEnd, span.last)`. DELEGATE the bound math to
`scenario-window.ts` `intersectionOf` (`:75`) — never hand-roll interval math (Rule 2, "Don't Hand-Roll").

**Cost label (LOCKED copy):** `Include → shortens window to {date} (−{N} mo)`. `{date}` = the single moved bound;
`{N}` = `diffDays` (`dateday.ts:118`) between old and new bound folded to whole months (round-to-nearest, floor at 1 mo
when delta > 0 but < 1 — A3 discretion). `{date}` + `−{N} mo` in `font-mono tabular-nums`.

**Button styling** (match existing composer buttons, `ScenarioComposer.tsx:2862/2883`): accent-tinted text-button
`text-accent hover:text-accent-hover`, `focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none`.
No modal (cost disclosed in label, immediate + reversible). Does NOT reselect a manual-off strategy — `applyWindow` only
moves the window; `selected` is never touched.

`AutoExcludedRow` currently takes `{id, name, reason}` (`:3678`) — extend the prop set additively (e.g. add `includeCost`
+ `onInclude`) rather than rebuilding the row (Rule 3, surgical).

---

## Shared Patterns

### Membership single-source (the load-bearing correctness rule)
**Source:** dev desync guard `ScenarioComposer.tsx:1813-1832`; `coverageEligible` `:1762`; `scenarioMetrics.member_ids`.
**Apply to:** `BlendHeader` (N = `member_count`), `CoverageTimeline` (bar color = `coverageEligible[id]`), `CoverageStateChip` (state = `selected` + `coverageEligible`).
```typescript
// ScenarioComposer.tsx:1818-1831 — the contract every new surface must keep quiet
const uiInBlend = deAliased.strategies
  .filter((s) => deAliased.state.selected[s.id] && coverageEligible[s.id])
  .map((s) => s.id).sort();
const engineMembers = [...scenarioMetrics.member_ids].sort();
// warns if these diverge — so every surface MUST read this same axis, never recompute covers() locally.
```

### Coverage-span / intersection / union math
**Source:** `src/lib/scenario-window.ts` — `coverageSpanOf` (:55), `intersectionOf` (:75), `unionOf` (:99), `covers` (:128), `defaultWindowFor` (:116).
**Apply to:** gantt x-scale (`unionOf`), include-cost bound (`intersectionOf`), truncation gate (`unionOf` vs effective).
Inclusive-closed containment + null-on-empty semantics are pinned here — reuse, never re-derive (Rule 2).

### Timezone-free formatting
**Source:** `formatIsoMonth()` `ScenarioComposer.tsx:418-424` (string-slice "YYYY-MM-DD" → "Mon YYYY"); `dateday.ts` `utcEpoch`/`diffDays`/`parseIsoDay`.
**Apply to:** all date labels (gantt axis endpoints, include-cost `{date}`, blend-header dates). Never `new Date(iso)`.

### SSR-safe localStorage persistence
**Source:** `useCrossTabStorage` (`src/lib/storage/cross-tab.ts`) + `rawStringCodec` (`src/lib/storage/codecs.ts:146`).
**Apply to:** POLISH-03 dismissal flag ONLY. Raw `localStorage.setItem` is banned (B25 lint); this primitive bakes in
deferred hydration, cross-tab sync, quota/private-mode guards, sign-out purge, Sentry breadcrumbs.

### localStorage prefix registration (REQUIRED for the new key)
**Source:** `src/lib/storage-namespaces.ts:20-31` `APP_NAMESPACED_PREFIXES`; test inventory `SignOutButton.test.tsx:124-136`.
**Apply to:** the POLISH-03 key. Two edits so the sign-out purge reaches it:
```typescript
// storage-namespaces.ts:20 — add the prefix (or name the key under an existing one, e.g. "composer-collapse:")
"composer.",   // NEW — if key = "composer.coverageDefaultChangeNoteDismissed"
// SignOutButton.test.tsx:124 — add a representative KNOWN_APP_KEYS entry so the purge-coverage test asserts it
"composer.coverageDefaultChangeNoteDismissed", // DefaultChangeNote.tsx (Phase 58)
```
NOTE: an existing `composer-collapse:` prefix already exists (`:30`) — if the key is named under a NEW `composer.` prefix
they are DISTINCT strings; register whichever you choose. (A2 discretion.)

### Unit-test structure (colocated child tests)
**Source:** `KpiStrip.scenario.test.tsx:25-63` (fixture-spread over an `EMPTY_METRICS` base), `MonteCarloSection.test.tsx:1-70`
(`render(<Component .../>)` + `screen.getByText(...)`, `vi.mock` for heavy deps).
**Apply to:** each new child's colocated `*.test.tsx`. Cover every branch (BlendHeader: N=0/N=1/truncated/normal;
chip: 3 states × token classes × label; gantt: in/out/auto bars + aria-label + collapsed default; note:
shown/hidden/dismissed/escape-hatch/a11y) — the `frontend-coverage` ratchet (lines 82 / functions 74 / branches 72) is a
BLOCKING gate.

### Integration-test rig (composer window block)
**Source:** `ScenarioComposer.test.tsx` Phase-57 window block (`:186-215`, `:5138-5340`).
**Apply to:** COVERAGE-03/04 assertions. Mock `CustomRangePicker` to an inert spy capturing `onApply`; keep
`@/lib/scenario` REAL so `member_count` is the genuine engine oracle; drive `applyWindow` and assert the header text +
divisor move together. Extend the EXISTING block — no new spec, no new `HAS_SEED_ENV` const, no ci.yml entry.

---

## No Analog Found

None. Every new file composes verified in-repo primitives; the only file with no 1:1 component twin is `BlendHeader.tsx`,
but its input struct (`ComputedMetrics`) and its test-fixture idiom (`KpiStrip.scenario.test.tsx`) are both established —
so it is a role-match, not a gap. Planner should NOT fall back to RESEARCH.md abstractions for any file.

---

## Metadata

**Analog search scope:** `src/app/(dashboard)/allocations/components/` (composer + colocated children/tests),
`src/components/ui/` (Badge, CollapsibleSection), `src/lib/` (scenario, scenario-window, dateday, storage/*, storage-namespaces),
`src/components/auth/` (SignOutButton test).
**Files scanned:** 12 read in full/targeted + grep across ScenarioComposer.tsx (3993 lines) and scenario.ts.
**Pattern extraction date:** 2026-07-01
