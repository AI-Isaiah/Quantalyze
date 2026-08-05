# Phase 149: NAV — "My strategies": a ranking at discovery parity - Context

**Gathered:** 2026-08-05
**Status:** Ready for planning

<domain>
## Phase Boundary

The allocator side stops being write-only: a sidebar "my strategies" entry (MY WORKSPACE)
opens a ranking covering every key the allocator uploaded AND the strategies derived from
them — including `private` and `draft` rows — at PARITY with the external/discovery ranking
(same metric columns, same sort affordances, same `#n` + percentile presentation per
DESIGN.md). Every row opens its factsheet via Phase 148's owner lane. Requirement: NAV-01.

Out of scope: any change to public/discovery ranking behavior for anon/non-owner viewers;
publication flow; the ranking toggle (deferred — see decisions).

</domain>

<decisions>
## Implementation Decisions

### Percentile population (founder decision 2026-08-05)
- Own rows (incl. private/draft) get percentiles against the PUBLISHED UNIVERSE — the same
  population every ranking surface uses. Semantics: "if published, this would sit at #n /
  Pth percentile."
- `getPercentiles()` is reused UNCHANGED — no second percentile mechanism.
- The comparison set is LABELED on the surface ("ranked against N published strategies") —
  the honest-set requirement from the roadmap trap.
- Own unpublished rows NEVER enter the percentile population — a draft must not shift public
  ranks nor leak unpublished data into numbers any other viewer sees.
- "Both via toggle" explicitly deferred — can be a follow-up once the ranking exists.

### Locked by ROADMAP success criteria (not re-decided)
- Structural reuse, ASSERTED: the surface is the EXISTING ranking component/query; the
  visibility predicate (own-including-unpublished via 148's `withPublishedOrOwner`) is the
  only genuine difference. No second ranking implementation.
- Parameterize the predicate — do NOT globally widen the shared query; published-only on
  discovery/public surfaces must be PROVABLY unchanged (assert it, don't observe it).
- Metrics for private/draft rows come from the same analytics the factsheet renders; a row
  whose analytics have not computed shows an honest pending state, never zeros (Phase 147's
  series_state/pending idioms are the precedent).
- Every row — including private/draft — opens its factsheet via OWN-02's owner lane, never
  `notFound()`.
- Proof case: the founder's account (8 active keys — bybit, okx, deribit ×3, mt5 ×3), none
  visible on any ranking today, all present here.

### Claude's Discretion
- Route path and sidebar wiring (MY WORKSPACE section per DESIGN.md nav conventions),
  page-level file layout, how the visibility-predicate parameterization is threaded, test
  placement — provided the structural-reuse assertion and the provably-unchanged public
  predicate both hold.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `getPercentiles(categorySlug?)` — `src/lib/queries.ts:118`; published-only, min-5
  population, lower-is-better inversion. REUSE UNCHANGED.
- `withPublishedOrOwner` (`src/lib/visibility.ts:115`) — the 148-landed gate this ranking
  consumes.
- The existing discovery/external ranking component + query (pattern mapper to pin exact
  files/lines).
- Phase 148's owner-lane factsheet (`/factsheet/[id]/v2`) — row link target, cannot dead-end.

### Established Patterns
- Rank presentation: `#n` + percentile per DESIGN.md (v1.11 design pass: rank→#n+percentile,
  table color sign-only, nav → LIGHT RAIL).
- Honest pending states: Phase 147's series_state two-state idiom.
- Structural-reuse assertion: the phase-147/148 source-scan gate architecture.

### Integration Points
- Sidebar (MY WORKSPACE) — DESIGN.md light-rail nav conventions.
- Phase 150 (OWN-03) follows; Phase 152's SCEN-03 also consumes the 148 gate.

</code_context>

<specifics>
## Specific Ideas

- ⚠️ Reuse cuts both ways (roadmap trap): an unpublished row's metrics must never reach any
  anon or non-owner surface through the shared path — the public predicate stays provably
  unchanged.
- ⛔ Phase 149 executes only AFTER Phase 148 lands on main (structural dependency) — planning
  may proceed; execution forks from post-merge main.

</specifics>

<deferred>
## Deferred Ideas

- Percentile re-rank toggle (among-own-rows view) — deferred at discuss; follow-up candidate
  once the ranking ships.

</deferred>
