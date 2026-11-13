# Phase 193: QUIETVIEW — viewing a strategy changes nothing and shows only its own content - Context

**Gathered:** 2026-11-06
**Status:** Ready for planning

<domain>
## Phase Boundary

Looking at a factsheet or a strategy page is passive: no accidental date-range change, a narrowed range is labelled with a one-click reset and never restored on a later visit, no developer note, placeholder or other strategy's or portfolio's demo content appears, and opening a page writes nothing on the user's behalf (TRUST-02, TRUST-03, TRUST-06). UI changes are checked against `DESIGN.md` (dated-document principle). Never invent data.

</domain>

<decisions>
## Implementation Decisions

### Chart range (area 1 — founder changed Q1, accepted Q2-Q3)
- **D-01 (founder override of the recommendation, 2026-11-06):** plain mouse-wheel over a factsheet chart no longer zooms; zoom stays available only on **Ctrl/⌘ + wheel**. The founder chose "Ctrl+wheel zoom" over "remove wheel zoom entirely". Plain scrolling must scroll the page and leave the date range and every headline figure unchanged. SC-1 reads "the range changes only through an explicit control"; Ctrl/⌘+wheel counts as that explicit control by this decision. ⚠️ The plan must record this reading in the ROADMAP Phase 193 section too (deviation policy: CONTEXT and ROADMAP).
- **D-02:** The view range is no longer persisted to localStorage or the URL query string. On load, any range a browser saved before this change is ignored and deleted. A later visit or reload opens the full history.
- **D-03:** A narrowed range is labelled next to the figures it changes ("Showing <start> – <end>", the dates shown) with a one-click "Reset to full history" control (an existing "Reset view" control is at `FactsheetView.tsx:2873`).

### Placeholder and foreign content (area 2, accepted as recommended)
- **D-04:** Remove the "Synthesized peer cohort (deterministic seed)…" panel (`BatchDPanels.tsx:125`); synthesized data is invented data.
- **D-05:** Remove the "Demo portfolios" / "Suggested MultiMarket sleeve" allocator section from the factsheet (`BatchDPanels.tsx:303`, `:351`).
- **D-06:** Hide the "Commercial terms not yet wired through from the strategy registry." row (`MandatePanels.tsx:153`).
- **D-07:** A test goes RED if any of the three strings, or content belonging to another strategy or portfolio, renders again.

### No write on view (area 3, accepted as recommended)
- **D-08:** Before the fix, a read-only PROD count of empty notes is recorded through the Supabase MCP, one query per call, marker query first. Rows are left in place.
- **D-09:** Measure the write path first (the `StrategyNoteCard` textarea is `autoFocus` and saves on blur, `src/components/notes/StrategyNoteCard.tsx:42-60`, a candidate, not confirmed). Then: no `autoFocus`, and save only when the text actually changed and is non-empty.
- **D-09 (founder override of the literal wording, 2026-11-07, "Allow clearing"):** a blur saves when the text changed. A blank draft saves only when it clears a note that was saved non-empty, so deleting a saved note's text and leaving clears it. Opening and leaving, or blurring an unchanged or never-saved blank draft, still writes nothing. Predicate: `draft !== persisted && (draft.trim() !== "" || persisted.trim() !== "")`. Recorded in the ROADMAP Phase 193 section too (deviation policy).
- **D-09 refinement (founder decision, 2026-11-07, "Keep it, record it"; review round 3 IN-01):** after a failed save the server state is unknown, so clearing a note whose save never got confirmed saves `""`. This refines the "Allow clearing" override. No code change. Recorded in the ROADMAP Phase 193 section too (deviation policy).
- **D-10:** A test is RED on today's behaviour: open the page, leave without typing, and no write happens.

### Claude's Discretion
- Whether the persistence codec and its storage key are deleted outright or kept as a one-shot purge of old keys.
- Label wording within DESIGN.md's voice rules.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `resetXRange` in `src/app/factsheet/[id]/v2/factsheet-context.tsx`; the cross-tab storage primitive with the `factsheet-v2:` prefix (sign-out purge registered).

### Established Patterns
- Wheel zoom: `TimeSeriesChart.tsx` `onWheel` (`:724`), `WHEEL_SETTLE_MS` (`:32`), non-passive native listener (`:821`).
- View persistence: URL `history.replaceState` plus localStorage via `factsheetViewStateCodec`, 250 ms debounce (`factsheet-context.tsx:258-270`).

### Integration Points
- `/strategy/[id]` mounts `StrategyNoteCard` (`src/app/strategy/[id]/page.tsx:210`).
- ⚠️ Phase 195 TRIM also edits `FactsheetView.tsx` (dark-mode option) and runs after this phase; keep edits to that file narrow.

</code_context>

<specifics>
## Specific Ideas

- Grep for other pages that carry a note card before declaring "any page that carries a note" covered.

</specifics>

<deferred>
## Deferred Ideas

- A real platform peer cohort (not chosen; new capability).

</deferred>
