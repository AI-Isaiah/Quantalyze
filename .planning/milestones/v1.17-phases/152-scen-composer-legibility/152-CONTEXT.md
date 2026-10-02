# Phase 152: SCEN — Composer legibility - Context

**Gathered:** 2026-08-07
**Status:** Ready for planning

<domain>
## Phase Boundary

The composer is legible: rows say whose they are (SCEN-02), open detail on click
(SCEN-03), the numbers are labelled (SCEN-04), and browse never presents an
unresolvable duplicate (SCEN-05). All four defects root-caused with file:line in
REQUIREMENTS.md (~lines 805-840):

- **SCEN-02** — no ownership marker anywhere; the bit exists server-side and is
  deliberately discarded (`browse/route.ts:220` computes `isOwnRow` only to un-redact
  the name). Additive WIRE change: `AddedStrategy` (`scenario-state.ts:96-104`) is
  zod-validated AND persisted (`SCENARIO_SCHEMA_VERSION = 4`).
- **SCEN-03** — rows not clickable at all (`ScenarioComposer.tsx:5588-5595` pre-151
  anchors; re-locate by symbol). Holdings tab already has the affordance
  (`HoldingsTable.tsx:468` → `HoldingDetail`). `addedStrategyMetadataLookup`
  (`:2180-2215`) already holds `cagr`/`sharpe` in memory for book strategies;
  null for drawer-added ones.
- **SCEN-04** — row renders `1.000`, `LEVERAGE` toggle, `1`, `—` with no labels;
  they are weight, mode, leverage, notional.
- **SCEN-05** — two identical owned private "Alpha Centauri" rows in Browse
  (`8d382aaf` 2026-08-04, `081f2912` 2026-07-20); real rows, not a render bug.

Out of scope: duplicate PREVENTION (WIZCONT-02, Phase 154); deleting/merging the
founder's real duplicate rows (separate data decision); building new metric fetches
for drawer-added strategies; any change to the numbers themselves (151 owns sizing).

⚠️ Phase 151 heavily modified ScenarioComposer.tsx (AUM input, dollar input, partial-book
note, gate repoint) — ALL line anchors above predate it. Locate by symbol, never by the
requirement's line numbers.

</domain>

<decisions>
## Implementation Decisions

### Ownership marker (SCEN-02)
- Muted "YOURS" chip on the added-strategy row, visually consistent with the Phase-150
  mark tag on /my-strategies. Never amber/red; sign-only color discipline per DESIGN.md.
- Wire: additive optional `isOwn` on the browse route row AND on `AddedStrategy` —
  zod optional/nullish, NO SCENARIO_SCHEMA_VERSION bump (151-06 `manualAumUsd`
  precedent: optional + no refine + safeParse tolerance; a decode of a v4 blob without
  the field must never reset the draft).
- Old persisted drafts: absent field = no marker rendered (never fabricate ownership);
  the field populates when browse/add next runs.

### Clickable rows (SCEN-03)
- Detail drawer matching the Holdings tab pattern (`HoldingsTable` → `HoldingDetail`);
  contains a "View factsheet" link (OWN-02 shipped in 148 — owner sees own factsheet,
  published resolves for everyone; never a notFound() dead end).
- Drawer content: ONLY what is already in memory (name, provenance/TrustTierLabel,
  markets, strategy types, cagr/sharpe when present). Null metrics → honest
  "not available" state per no-invented-data. NO new fetches this phase.
- Click target: row surface + name clickable; interactive controls (toggle,
  weight/dollar/leverage inputs) excluded via stopPropagation. Keyboard-reachable
  (Enter/Space on focused row) per a11y baseline.

### Labeled numbers (SCEN-04)
- ONE header row over the constituents list, mono eyebrow style per DESIGN.md:
  WEIGHT · MODE · LEV · NOTIONAL (exact copy pinned by UI-SPEC).
- Non-derivable notional em-dash: reuse 151's exact pattern — `title` + `sr-only`
  span with remedy copy ("Set portfolio AUM to size in dollars") so it reads
  "not applicable", never "broken".

### Browse duplicates (SCEN-05)
- DISAMBIGUATE, don't hide: when an owned row's name collides with another owned row
  in the same browse result, render a secondary line (created date + venue/key count +
  status) so the choice is resolvable. No destructive merge, no collapsing — the two
  Alpha Centauri rows are real and may differ in key sets.
- Prevention stays with WIZCONT-02 (Phase 154); data cleanup of the existing duplicate
  rows is a founder decision outside this phase.

### Claude's Discretion
- Drawer component reuse vs. a thin composer-specific wrapper (prefer reuse of the
  Holdings pattern; do not fork a second drawer idiom).
- Exact header-label copy and chip copy within UI-SPEC constraints.
- Disambiguation-line format details (date format per existing browse rows).
- Test placement per repo convention.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `browse/route.ts:220` — `isOwnRow` already computed server-side; row emit at
  `:233-245` is the named-key fence to widen additively.
- `HoldingsTable.tsx:468` → `HoldingDetail` — the click-to-detail pattern to mirror.
- `addedStrategyMetadataLookup` (ScenarioComposer) — in-memory cagr/sharpe for book
  strategies.
- Phase-150 mark tag (/my-strategies row) — visual precedent for the YOURS chip.
- 151-06's `manualAumUsd` zod pattern — additive optional field, no version bump,
  nullish-tolerant decode.
- 151's em-dash title+sr-only pattern in the dollar input cell.

### Established Patterns
- ScenarioComposer just went through 151 (waves 05/06/07) — one weight-write path
  (`handleWeightChange`), `scenario-partial-book-note`, AUM input in summary. Respect
  those; do not touch sizing logic.
- UI-SPEC discipline: 4-size typography, accent reserved, muted notes.

### Integration Points
- `src/app/api/allocator/strategies/browse/route.ts` (additive isOwn + duplicate
  disambiguation data)
- `src/app/(dashboard)/allocations/lib/scenario-state.ts` (AddedStrategy + zod)
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` (row: chip,
  click, header labels)
- Browse overlay component (duplicate secondary line)

</code_context>

<specifics>
## Specific Ideas

- Founder verbatim (SCEN-04): "What do the numbers actually mean?"
- The founder's own account is the SCEN-05 test case: two private Alpha Centauri rows
  must become distinguishable at a glance.

</specifics>

<deferred>
## Deferred Ideas

- Richer drawer metrics for drawer-added strategies (needs a returns-route change —
  separate decision).
- Duplicate-row cleanup/merge tooling for existing data.

</deferred>
