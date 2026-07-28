# Phase 58: Coverage Legibility & Disclosure - Context

**Gathered:** 2026-07-01
**Status:** Ready for planning
**Mode:** Smart discuss (autonomous) — all 4 grey areas accepted as recommended

<domain>
## Phase Boundary

Make the scenario coverage-window blend **legible and self-explaining** on the
`/allocations` scenario composer. Layered on Phase 57's functional state machine
(auto-toggle, auto-excluded group, empty-intersection banner, CustomRangePicker window
control), this phase delivers the *disclosure* surface:

- **COVERAGE-01** — a coverage timeline (mini-gantt) showing each selected strategy's data
  span against the active window.
- **COVERAGE-02** — three-state per-row legibility: **in-blend / manually-excluded /
  auto-excluded (outside window)**, the third visually distinct with an inline reason.
- **COVERAGE-03** — an always-visible honest blend header (member count · effective window ·
  N), degrading honestly.
- **COVERAGE-04** — a one-click "include → shortens window to [date] (−N mo)" affordance on
  auto-excluded rows that shows the cost *before* applying.
- **POLISH-03** — a one-time union→intersection default-change note with a "show full range"
  escape hatch.

**Out of scope (do NOT touch):** the compute engine (`scenario.ts` blend math is FROZEN
after Phase 55 — this phase is presentation only), the window derivation helpers
(`scenario-window.ts`), persistence of the window itself (Phase 59), golden/e2e re-bake
(Phase 60). No numeric behavior changes — if a number moves, that is a bug.

</domain>

<decisions>
## Implementation Decisions

### Area 1 — Coverage Timeline (mini-gantt) — COVERAGE-01
- **Form factor:** horizontal mini-gantt — one thin bar per selected strategy, x-axis = the
  union date range across the selected set, with the active `[winStart,winEnd]` window drawn
  as a shaded vertical band overlay.
- **Placement:** inline **collapsible** panel within `ScenarioComposer`, **collapsed by
  default** behind a "Coverage timeline" toggle so the composer stays uncluttered; reveal on
  demand.
- **Bar encoding:** the in-window portion of each bar = solid accent (`#1B6B5A`); the
  out-of-window portion = muted/hatched; a strategy that is auto-excluded (outside window)
  renders its bar in **warning amber** so the gantt and the row chips agree.
- **Build vs reuse:** a small purpose-built SVG/div-bar component that reuses
  `coverageSpanOf()` + a local date→x scale. **No new dependency** (Rule 2 / ladder). Respect
  `prefers-reduced-motion`; WCAG-AA floor holds (bars carry text/aria, not color-only meaning).

### Area 2 — Three-State Chips + Blend Header — COVERAGE-02, COVERAGE-03
- **State → color mapping (DESIGN.md-grounded):**
  - **in-blend** = accent `#1B6B5A` (verified/member).
  - **manually-excluded** = muted neutral (`--color-text-muted` family) — deliberate, sticky.
  - **auto-excluded (outside window)** = **warning amber** chip: text `#B45309`, bg `#FEF3C7`,
    border `#FDE68A`. This is the exact DESIGN.md reservation — "warning is reserved for
    transient recoverable states the system will handle on its own" — and reuses the
    HoldingsTable revoked-key chip precedent. **Do NOT** use negative/red (that means
    permanent failure, which auto-excluded is not).
- **Where states render:** an inline chip/label on each strategy row. In-blend rows stay in
  the main composition list; auto-excluded rows sit in the Phase-57 auto-excluded group, each
  carrying the amber chip + inline reason.
- **Reason copy:** REUSE the existing `coverageDropReason()` output ("ends {Mon YYYY} —
  outside window" / "starts {Mon YYYY} — outside window" / "no data — outside window"). No new
  copy strings.
- **Blend header (COVERAGE-03):** always-visible header above the blend output reading
  **"Mean of {N} strategies · {effStart}–{effEnd}"**, degrading honestly:
  - N = 1 → "1 strategy — not a blend"
  - effective window narrower than the union of the selected set → append
    "· window truncated from full range"
  - N = 0 → honest empty state (engine already guards BLEND-05; header states it plainly).
  Source `{N}` / effective window from `computeScenario`'s emitted `member_count` /
  `member_ids` / `effective_start` / `effective_end` — never re-derive the blend.

### Area 3 — Include-Cost Affordance — COVERAGE-04
- **Form factor:** an inline text-button on each auto-excluded row:
  **"Include → shortens window to {date} (−{N} mo)"** — the cost is in the label, visible
  before applying.
- **Cost shown:** the window bound the include would force (the strategy's limiting first/last
  date) + the delta in whole months versus the current window, computed from `coverageSpanOf`
  vs current `[winStart,winEnd]`.
- **Apply behavior:** one click narrows the window to the intersection that includes this
  strategy, re-running the Phase-57 auto-toggle state machine (reuse the existing window-set
  path). Reversible via the "Common period" / "Full range" presets. Does **not** auto-reselect
  a manually-excluded strategy — manual-off stays sticky.
- **Confirmation:** no modal — the cost is disclosed in the label and the apply is immediate +
  reversible (matches Phase 57's "guided fix, not a modal").

### Area 4 — One-Time Default-Change Note — POLISH-03
- **Copy:** "Now showing the common period where all {N} overlap · **Show full range**"
  (REQUIREMENTS copy verbatim); the "Show full range" inline action triggers the Full-range
  preset (the escape hatch).
- **Dismissal persistence:** a `localStorage` flag (per-browser, one-time across sessions).
  This note is a UI **education artifact**, not scenario data — it must NOT live in the
  `ScenarioDraft` (window persistence is Phase 59) nor a server/profile flag (overkill).
- **Placement + form:** a dismissible inline **info** note (informational, NOT warning-tier)
  above the window control / blend header, with an `×` to dismiss, `role="status"` +
  `aria-live="polite"`.
- **When shown:** only when the intersection default actually truncates the union (the selected
  members have differing spans) AND the note has not been dismissed. Never when all spans
  already coincide (nothing changed for the user).

### Claude's Discretion
- Exact component decomposition (e.g. `CoverageTimeline.tsx`, a `CoverageStateChip`, a
  `BlendHeader`) and their placement within the existing `ScenarioComposer` layout — follow
  DESIGN.md + existing composer structure.
- The precise localStorage key name and the month-delta rounding for the include-cost label.
- SVG vs flex/div implementation of the gantt bars — whichever is simpler and passes a11y.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/lib/scenario-window.ts` — `coverageSpanOf`, `intersectionOf`, `unionOf`,
  `defaultWindowFor`, `covers`, `outlierIdsFor`; types `CoverageSpan {first,last}`,
  `CoverageWindow {start,end}`. Reuse for the gantt scale + include-cost math.
- `computeScenario` (`src/lib/scenario.ts`) emits `member_count`, `member_ids`,
  `effective_start`, `effective_end` — the honest source for the blend header (parity-by-
  construction; never re-derive).
- `src/components/ui/Badge.tsx` — base chip (props `label`, `type`, `className`); the
  three-state coverage chip is a NEW variant/component but should match its 4px-radius /
  10–11px uppercase badge ladder from DESIGN.md.
- `coverageDropReason()` in `ScenarioComposer.tsx` (~lines 435–447) — reuse for inline reasons.
- Phase-57 auto-excluded group render (~lines 3509–3546) + empty-intersection banner
  (~lines 2779–2820) + window control (~lines 2821–2880) — extend, don't rebuild.

### Established Patterns
- Composer window state: `winStart`/`winEnd` + `windowTouchedRef` + `coverageWindow` memo
  (`ScenarioComposer.tsx` ~lines 765–780, 1656–1687); `autoExcluded` memo (~1780–1810).
- DESIGN.md semantic colors: accent `#1B6B5A`, positive `#15803D`, negative `#DC2626`,
  warning `#B45309` (bg `#FEF3C7` / border `#FDE68A`). Badge radius 4px, micro type 10–11px
  uppercase tracking. Warning = transient recoverable ONLY.
- Motion: 250ms tab/panel (`duration-300` in Tailwind v4; `duration-250` is invalid), 150ms
  hover; honor `prefers-reduced-motion`.

### Integration Points
- All new UI lands inside `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`
  (and any extracted child components under that `components/` dir).
- Guards to keep green: `ScenarioComposer.test.tsx` (coverage-window + auto-toggle blocks),
  `useScenarioState.test.tsx` / `.hydrate.test.tsx`, `e2e/composer-axe.spec.ts`.
- Frozen-spine / parity guards (Phase 55) MUST stay green — no engine or numeric change.

</code_context>

<specifics>
## Specific Ideas

- Three-state chip colors are pinned to DESIGN.md tokens (accent / muted / warning-amber);
  amber = auto-excluded because it is a transient recoverable state (window can be narrowed to
  bring the strategy back), exactly what DESIGN.md reserves warning for.
- Blend header, gantt bars, and row chips must agree on which strategies are members — all
  three read the same `computeScenario` member set / `covers()` predicate, never independent
  derivations.
- POLISH-03 note escape hatch reuses the existing Full-range preset — no new window logic.

</specifics>

<deferred>
## Deferred Ideas

- Persisting the coverage window itself (reopen at owner's window, shared-link recompute,
  compare-across-windows) — Phase 59 (PERSIST-01…03).
- Re-baking the visual golden + e2e baselines to the new blend series — Phase 60 (VERIFY-01).
- Interior mid-window gap density floor (BLEND-F2) — deferred to v2 per Phase 55.

</deferred>
