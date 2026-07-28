---
phase: 111-constit-unified-constituent-presentation-parity-pre-check-re
plan: 02
subsystem: ui
tags: [design-tokens, provenance-badge, trust-tier, scenario-composer, postgrest, rls, react]

# Dependency graph
requires:
  - phase: 111-01
    provides: CONSTIT-05 pandas parity gate (green) — clears the CONSTIT UI to proceed
  - phase: 17 (DESIGN-01)
    provides: TrustTierLabel + TRUST_TIER_TOKENS 3-variant badge + a11y drift gate
  - phase: 84 (BLEND-01/02)
    provides: asset_class threading precedent (SSR payload + returns route widening)
provides:
  - "composite (4th) provenance badge variant — ProvenanceTier union, DESIGN.md-allowlisted"
  - "trust_tier + is_composite threaded through the SSR allocation payload + the lazy returns route"
  - "deriveProvenance pure helper (badge derivation) + addedProvenanceById composer wiring"
affects: [111-03, CONSTIT-01, scenario-composer, provenance-badge-render]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "ProvenanceTier = TrustTier | 'composite' — badge layer widens; DB TrustTier stays 3-valued"
    - "Server-side boolean projection of data_quality_flags.composite (strict === true); raw blob never shipped"
    - "D-04 latest-verification pick reused verbatim in a 3rd + 4th projection site"

key-files:
  created:
    - "src/app/(dashboard)/allocations/lib/provenance.ts"
    - "src/app/(dashboard)/allocations/lib/provenance.test.ts"
  modified:
    - "src/lib/design-tokens/trust-tier.ts"
    - "src/components/strategy/TrustTierLabel.tsx"
    - "DESIGN.md"
    - "src/lib/queries.ts"
    - "src/app/api/strategies/[id]/returns/route.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"

key-decisions:
  - "composite badge = dark-navy outline (#1A1A2E on #FFFFFF) — both hexes already DESIGN.md-allowlisted; api_verified keeps the sole accent fill"
  - "DB TrustTier stays 3-valued; composite lives only in the presentation ProvenanceTier union (WatchlistPanel TIER_ORDER unaffected)"
  - "is_composite is a server-coerced strict-=== true boolean; the raw data_quality_flags blob (degraded-member venue detail) never crosses to the client (T-111-03/04)"
  - "deriveProvenance precedence: composite > valid trust_tier > null; placed in a pure lib module, NOT scenario.ts / StrategyForBuilder (Pitfall 3)"

patterns-established:
  - "Provenance rides the composer metadata lookup BESIDE the engine-facing Pick, cast away at the adapter call sites so it never enters the frozen engine"
  - "Drawer-added provenance settle/purge mirrors addedAssetClassById byte-for-byte (book payload wins → lazy fetch → null)"

requirements-completed: [CONSTIT-02]

# Metrics
duration: 20min
completed: 2026-07-16
---

# Phase 111 Plan 02: CONSTIT-02 composite badge + trust_tier/is_composite threading Summary

**Added the 4th `composite` provenance badge variant (DESIGN.md-allowlisted dark-navy outline) and threaded `trust_tier` + a server-coerced `is_composite` boolean through the SSR allocation payload and the lazy returns route into the composer's added-strategy metadata lookup — no engine edits, no badge render yet.**

## Performance

- **Duration:** ~20 min
- **Started:** 2026-07-16T22:00:00Z
- **Completed:** 2026-07-16T22:20:00Z
- **Tasks:** 3 (all TDD: RED → GREEN)
- **Files modified:** 17 (2 created)

## Accomplishments
- `composite` badge variant added to `TRUST_TIER_TOKENS` via a new `ProvenanceTier = TrustTier | "composite"` union; the DB `TrustTier` union stays 3-valued so WatchlistPanel `TIER_ORDER` / `Strategy["trust_tier"]` are untouched. DESIGN.md table row + Decisions Log entry added so the verbatim a11y drift gate passes.
- `trust_tier` (D-04 most-recent verification pick) + `is_composite` (strict `data_quality_flags.composite === true`) projected onto `MyAllocationDashboardPayload.strategies[].strategy` and emitted by the returns route — the raw verification embed + flags blob are stripped server-side (T-111-03/04).
- Composer wiring: `addedProvenanceById` state records provenance from the widened lazy-returns body and is purged on remove (mirrors `addedAssetClassById`); `addedStrategyMetadataLookup` now carries `trust_tier` + `is_composite` (book payload wins, else drawer fetch, else null/false). Pure `deriveProvenance` helper (composite > tier > null) exported for the 111-03 badge render.

## Task Commits

1. **Task 1: composite badge variant — token + component + DESIGN.md** - `11dadd3e` (feat, TDD)
2. **Task 2: server-side threading — SSR payload + returns route** - `f7e07709` (feat, TDD)
3. **Task 3: composer-side provenance lookup + deriveProvenance** - `1b55f0f7` (feat, TDD)

## Files Created/Modified
- `src/lib/design-tokens/trust-tier.ts` - `ProvenanceTier` union + `composite` token slot; `TRUST_TIER_TOKENS` retyped `Record<ProvenanceTier, …>`
- `src/components/strategy/TrustTierLabel.tsx` - prop widened to `ProvenanceTier | null | undefined`; null contract preserved
- `DESIGN.md` - Trust-Tier Badges `composite` row + dated Decisions Log entry
- `tests/a11y/trust-tier-tokens.test.ts` - composite drift-gate assertions
- `src/components/strategy/TrustTierLabel.test.tsx` - composite render test
- `src/lib/queries.ts` - embed `strategy_verifications` + `data_quality_flags` on the portfolio_strategies select; project `trust_tier` + `is_composite`; strip raw embeds; widen payload type
- `src/app/api/strategies/[id]/returns/route.ts` - widen probe + analytics read; emit `trust_tier` + `is_composite` (BLEND-01 pattern), never the raw blob
- `src/app/api/strategies/[id]/returns/route.test.ts` - R9/R9b/R9c provenance tests + mock wiring
- `src/lib/queries.my-allocation.test.ts` - `getMyAllocationDashboard` provenance-threading behavioural tests (latest pick, null, strict coercion, no-leak)
- `src/app/(dashboard)/allocations/lib/provenance.ts` **(created)** - pure `deriveProvenance` helper
- `src/app/(dashboard)/allocations/lib/provenance.test.ts` **(created)** - exhaustive derivation coverage
- `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` - `addedProvenanceById` state + settle/purge + metadata-lookup extension
- `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx` - `T_C_PROVENANCE` widened-body tolerance regression
- `src/__tests__/phase-84-asset-class-flow.test.ts` - updated returns-route select structural pin for the widened probe
- `src/app/(dashboard)/allocations/lib/mandate-gates.test.ts`, `HoldingsTable.strategy-rows.test.tsx`, `strategies-row-adapter.test.ts` - payload fixture builders extended with the two new required fields

## Decisions Made
- **composite badge color:** dark-navy outline (`#1A1A2E` text/border on `#FFFFFF`). Both hexes already live in DESIGN.md's Color section (Text-primary / Surface), so the AI-Slop Ban / no-new-colours rule holds and the verbatim drift gate passes. Navy is a distinct 4th identity that leaves the sole accent fill to `api_verified`.
- **Type split:** DB `TrustTier` stays 3-valued (mirrors `strategy_verifications.trust_tier`); `composite` is presentation-only in `ProvenanceTier`.
- **deriveProvenance placement:** a new pure `allocations/lib/provenance.ts` module — never `scenario.ts` (frozen) nor the `StrategyForBuilder` engine shape (Pitfall 3). Provenance rides the composer metadata lookup beside the engine-facing `Pick` and is cast away at the adapter call sites, so it cannot enter the blend engine.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Extended 3 payload-fixture builders + 1 structural pin for the widened type/select**
- **Found during:** Task 2 (server-side threading)
- **Issue:** Adding the required `trust_tier` / `is_composite` fields to `MyAllocationDashboardPayload.strategies[].strategy` and widening the returns-route probe select broke `tsc` on three test fixture builders (`mandate-gates.test.ts`, `HoldingsTable.strategy-rows.test.tsx`, `strategies-row-adapter.test.ts`) and the exact-string select pin in `phase-84-asset-class-flow.test.ts`.
- **Fix:** Added `trust_tier: … ?? null` + `is_composite: … ?? false` to each fixture builder (coalesced after the Partial spread in mandate-gates so the required fields never widen to `undefined`); updated the phase-84 pin to assert the widened select string.
- **Verification:** `tsc --noEmit` clean; the three fixture suites + phase-84 green.
- **Committed in:** `f7e07709` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking — downstream type/pin propagation)
**Impact on plan:** Mechanical propagation of the intended type/select widening. No scope creep; the scenario.ts freeze held throughout.

## Issues Encountered
- The returns-route probe embed typed `strategy_verifications` as a PostgREST `SelectQueryError` at the type level (FK-inference limitation), tripping the `as`-cast. Resolved by casting through `unknown` — the runtime shape is the embedded array (matches queries.ts's own D-04 extraction cast pattern).

## Testing / Observability Note (fail-loud)
Per the plan's scope fence, this plan threads the metadata but does **not** render the badge (rows reshape in 111-03). Provenance is presentation metadata and is deliberately NOT a `StrategyForBuilder` field (Pitfall 3), so it is **not** observable at the `computeScenario` call site the composer test harness spies on. Coverage is therefore:
- `deriveProvenance` — exhaustively unit-pinned (4 variants + null + composite-over-tier precedence + strict coercion + per-key api-verified-by-construction) in `provenance.test.ts`.
- Server threading — behaviourally pinned in `queries.my-allocation.test.ts` (latest pick, null-verification, strict coercion, no-blob-leak) and route `R9/R9b/R9c`.
- Composer settle/purge — the widened settle body is guarded non-breaking by `T_C_PROVENANCE`; the settle/purge **mechanism** is byte-parallel to `addedAssetClassById`, already regression-covered by `T_C_ASSETCLASS` / `T_C_ASSETCLASS_PURGE`. Full badge-in-DOM observability lands with the 111-03 render.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- 111-03 can render the per-row provenance badge: the token (`composite`), the `deriveProvenance` seam, and the threaded `trust_tier` / `is_composite` (book SSR + drawer lazy fetch) are all in place. Per-key legs resolve to `api_verified` by construction (encoded in `deriveProvenance` doc + test).
- `scenario.ts` verified byte-frozen (`git diff --exit-code` clean); `tsc` + `npm run lint` clean (0 errors; 1 pre-existing unrelated EquityChart warning, out of scope).

## Self-Check: PASSED
- Created files verified on disk: `provenance.ts`, `provenance.test.ts`, `111-02-SUMMARY.md`
- Task commits verified in git log: `11dadd3e`, `f7e07709`, `1b55f0f7`

---
*Phase: 111-constit-unified-constituent-presentation-parity-pre-check-re*
*Completed: 2026-07-16*
