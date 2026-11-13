# Phase 197: SCREEN - Context

**Gathered:** 2026-11-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Discovery reads plainly: every column states its period and annualisation, volatility carries no sign, a track-length column exists, stale strategies are flagged and do not rank as current, a shared exchange account is noted, and an allocator can select strategies and open Compare from the UI. Requirements: ROUTE-05, CLAR-01, CLAR-02, CLAR-05. Renames/tooltips across the app are Phase 201.
</domain>

<decisions>
## Implementation Decisions

### Shared-account notice (discussed with the founder)
- **D-01 Audience: admins only.** Founder pick "Admins only" (2026-11-08). The notice ("Shares an exchange account with <other strategy>") renders only when the viewer is an admin; allocators, managers and visitors see nothing. This narrows ROADMAP SC-4 / CLAR-05 ("A listing says…"); the narrowing is recorded in the ROADMAP Phase 197 section as well (deviation policy). Built from stored data only (no new manager-entered data); no account identifiers shown.
- **D-02 Unpublished partner: nothing.** If the other strategy on the account is unpublished, the published one shows no notice; an unpublished strategy is never named or hinted at.

### Settled on the recommendation (founder left these to me, 2026-11-08)
- **D-03 Stale:** stale = the newest stored return day is older than 7 calendar days (crypto) / 10 calendar days (traditional). The phase names the field it reads; never `strategy_analytics.computed_at` (a recompute on old data is not fresh). Stale rows show "Data from <date>" and sort below all current rows within whatever sort is active; they are never removed. A test with a stale fixture goes RED on today's ranking.
- **D-04 Compare selection:** a checkbox per discovery row; a sticky "Compare (n)" bar appears from 2 selected, max 4; it opens `/compare` with those strategies. `/compare` gets an "Add strategy" search and no longer says adding is "not available yet".
- **D-05 Column headers:** the header itself states period and annualisation (e.g. "Return 1y, ann.", "Vol 1y, ann."), a tooltip carries the definition; volatility shows no sign; a "Track" column shows months of record.

### Carried forward
- Phase 194 figure gate: withheld figures read as withheld in discovery columns; definitions are 194's.
- Phase 195: do-nothing toggles already gone.

### Claude's Discretion
- How the shared-account link is derived from stored data (key/account fingerprint), admin check mechanism, compare URL format, threshold constant placement.
</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` (### Phase 197) — goal, success criteria (SC-4 narrowed per D-01), evidence at HEAD
- `.planning/REQUIREMENTS.md` — ROUTE-05, CLAR-01, CLAR-02, CLAR-05
- `DESIGN.md` — Numbers Contract, data density principle, Trust-Tier Badges
- `.planning/phases/194-figuretruth-a-figure-means-one-thing-everywhere-and-shows-on/194-CONTEXT.md` — figure definitions and gate
</canonical_refs>

<code_context>
## Existing Code Insights

- `src/app/(dashboard)/compare/page.tsx:75`, `:266` — "not available yet".
- `StrategyTable.tsx` (`:316` "6 Month") — discovery columns; `StrategyTable.stale-analytics.test.tsx` — measure today's stale behaviour first.
- `FactsheetView.tsx` "Compare strategies" — the only current entry to compare.
- `EquityHistoryRebuilding.tsx:237` — existing same-account signal for an allocator's own keys (reuse its derivation).
- Phase 196 runs in parallel on the factsheet; keep factsheet edits out of this phase.
</code_context>

<specifics>
## Specific Ideas
- Founder memory: one exchange account under several logins is intended; the notice informs, it does not flag wrongdoing.
</specifics>

<deferred>
## Deferred Ideas
- None.
</deferred>

---

*Phase: 197-screen*
*Context gathered: 2026-11-08*
