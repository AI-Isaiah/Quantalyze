# Phase 148: OWN — Owner factsheet without cache disclosure - Context

**Gathered:** 2026-08-05
**Status:** Ready for planning

<domain>
## Phase Boundary

The allocator who uploaded a strategy can view its FULL factsheet from that account while the
strategy stays invisible to everyone else, and publication stays admin-only. Requirements:
OWN-02 (owner views own unpublished factsheet — today `withPublishedOnly` at
`factsheet/[id]/v2/page.tsx:344` 404s them) and OWN-04 (wizard preview link that can never
dead-end; strictly AFTER OWN-02 within the phase).

In scope: the factsheet v2 page's visibility lanes + cache safety, the wizard preview link,
the SC2 adversarial cache test. Out of scope: NAV-01 ranking (Phase 149 — consumes this
phase's gate, MUST NOT be pulled forward), any publication-flow changes, verification-state
display for drafts.

</domain>

<decisions>
## Implementation Decisions

### Cache safety — two-lane design (Area 1)
- TWO LANES. Lane A (public, unchanged): `withPublishedOnly` → `unstable_cache`
  (`factsheet-v2-payload-v6` key, per-id tags) — anon path byte-identical to today.
  Lane B (owner-only, new): on published-miss + authed session, probe ownership via the
  existing `withPublishedOrOwner` (`src/lib/visibility.ts:115`), then call
  `fetchAndBuildPayload` DIRECTLY — no cache read, no cache write. Disclosure impossible
  BY CONSTRUCTION: the shared cache is only ever populated by the published-only builder.
- Lane order: published/cached lane FIRST; owner probe only on its miss (no extra query on
  public authed views).
- SC2 acceptance is BOTH layers: behavior (owner renders draft → anon request for same id
  still 404s, cache untouched) AND structural (the cached builder is provably unreachable
  from the owner lane — asserted, not observed).

### Owner draft view — honest absence (Area 2)
- Full factsheet payload on the owner lane — same panels, real analytics.
- Trust/verification badge HIDES: the SECDEF `get_published_trust_signals` already returns
  null for owner-own-unpublished; never fabricate a tier for a draft.
- A clear "Unpublished — only you can see this" banner on the owner lane (exact copy/tokens
  in UI-SPEC). Without it, owners share the URL and recipients 404 — reads as a bug.
- `generateMetadata` on the owner lane: minimal + `robots: noindex` — draft name/description
  never enters page meta. Published metadata path untouched.

### OWN-04 preview link — reuse the real factsheet (Area 3)
- Link target: `/factsheet/{id}/v2` from SyncPreviewStep's existing factsheet-preview area,
  rendered only once the strategy id resolves. No separate preview route (a second factsheet
  implementation is the drift class the reuse rules forbid).
- Cannot dead-end: owner lane covers unpublished, and OWN-04 lands strictly after OWN-02.
- Exact placement/copy pinned by UI-SPEC; finalize-step repetition left to UI-SPEC judgment.

### Claude's Discretion
- Internal naming/structure of the two lanes, test file placement, and how the structural
  unreachability assertion is implemented (module boundary, grep-gate, or DI seam) — provided
  SC2's both-layer acceptance holds and no third factsheet-resolution mechanism is minted.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `withPublishedOrOwner(query, authUserId)` — `src/lib/visibility.ts:115`, already REALIZED
  and used by the returns route (`api/strategies/[id]/returns/route.ts` probe).
- `fetchAndBuildPayload(id)` — the payload builder wrapped by `buildFactsheetPayloadCached`
  (`factsheet/[id]/v2/page.tsx:225-267`); the owner lane calls it directly.
- `readPublicVerificationSignals` — SECDEF-backed, null for unpublished (fail-soft).

### Established Patterns
- `withPublishedOnly` sites on the page: payload build (`:37` area), `generateMetadata`
  (`:275`), signature gate (`:342`) — every site needs a lane decision.
- Cache shape-version discipline: `factsheet-v2-payload-v6` key + bump comments — if the
  payload shape changes for the banner, follow the documented bump protocol (v6 → v7).
- Per-id invalidation: tags `["factsheet-v2", "factsheet-v2:${id}"]`.
- Phase 147's `series_state` / resolver work is upstream on this branch — factsheet renders
  real series via `resolveDailyReturnSeries` already.

### Integration Points
- Wizard: `SyncPreviewStep.tsx` (factsheet-preview area ~`:914` — "moves to the factsheet
  preview as fast as possible") — OWN-04's link site.
- Phase 149 (NAV-01) consumes this phase's cache-safe gate — keep the lane predicate
  parameterizable but do NOT build the ranking here.

</code_context>

<specifics>
## Specific Ideas

- ⛔ NOT a one-line `withPublishedOnly` → `withPublishedOrOwner` swap — the route is PUBLIC
  and `unstable_cache`d keyed `${id}::${computedAt}`; its own header justifies the cache as
  safe because "the only fields we cache come from the published row". Criterion 2 is the
  acceptance test.
- Anonymous and non-owner authed requests must see published-only on EVERY surface the gate
  change touches (SC4); publication remains admin-only.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>
