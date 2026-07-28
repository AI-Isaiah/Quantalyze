---
phase: 111-constit-unified-constituent-presentation-parity-pre-check-re
verified: 2026-07-16T23:35:00Z
status: passed
score: 6/6 must-haves verified
overrides_applied: 0
re_verification:
  previous_status: none
  previous_score: n/a
---

# Phase 111: CONSTIT — unified constituent presentation Verification Report

**Phase Goal:** The composer presents every source (api-key / CSV / catalog / composite) as one uniform weightable constituent in a single list — with the blend numerically preserved, or deliberately re-baselined with a recorded decision.
**Verified:** 2026-07-16T23:35:00Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | CONSTIT-05 (GATE): committed, re-runnable parity re-derivation proves interpretation A == frozen-engine blend within tolerance; asserts A, reports B, not a live-DB skipif | ✓ VERIFIED | `analytics-service/tests/test_constit_blend_parity.py` (388 lines): 3 assert-A tests (`test_A_daily_return_curve_matches_engine` atol 1e-9, `_cumulative_curve_`, `_kpis_`) vs committed golden; `test_report_A_vs_B_divergence` REPORTS B (only sanity-asserts A≠B, never asserts B==golden); pandas/numpy/json only, NO `skipif`/`HAS_LIVE_DB`. Ran green: **5 passed in 0.91s**. Fixtures `constit_parity_fixture.json` + `constit_parity_golden.json` present. |
| 2 | CONSTIT-01: composer renders ONE unified constituent list; separate "Data Sources" section GONE | ✓ VERIFIED | `ScenarioComposer.tsx`: the Data-sources Card/group render is deleted (only a CONSTIT-01 explanatory comment remains at L3594). Single `<ul data-testid="scenario-constituent-list">` (L4833) in `CompositionList` renders per-key rows (`scenario-constituent-perkey` L4856) interleaved above added rows (`scenario-constituent-added` L4923). ScenarioComposer.test.tsx passes incl. named "unified constituent list" group. |
| 3 | CONSTIT-02: per-row provenance badge; trust_tier from strategy_verifications; composite = data_quality_flags.composite; DB TrustTier stayed 3-valued | ✓ VERIFIED | `provenance.ts` `deriveProvenance` (composite > valid trust_tier > null, strict `=== true`). `trust-tier.ts`: `TrustTier = api_verified\|csv_uploaded\|self_reported` (3-valued, unchanged); `ProvenanceTier = TrustTier \| "composite"` (badge layer only). Server threading: `queries.ts` embeds `strategy_verifications (trust_tier…)` + projects `is_composite` from `data_quality_flags.composite`; returns route L97/L104 emits both, strips raw blob. Rows render `<TrustTierLabel trustTier="api_verified">` (per-key L4890) and `deriveProvenance`-derived badge (added L4949). |
| 4 | CONSTIT-03: two toggle channels unified onto draft.toggleByScopeRef (includeByApiKeyId gone); book-seed collapses to strategy/key level; per-coin holdings NOT promoted | ✓ VERIFIED | `scenario-state.ts` `togglePerKeySource` (L430) routes through `toggleByScopeRef`, exclude writes `false`, re-include DELETES ref, never touches `weightOverrides`. `includeByApiKeyId` = 0 live hits repo-wide (only a comment in the gate). Per-key rows carry NO weight/leverage input (L4843-4897). Per-coin holdings removed from list — comment L4841 "live on the Holdings tab". Regression tests PK1–PK5 (scenario-state.test.ts) non-tautological (PK3 pins weightOverrides byte-identical; PK4 pins enabled-set non-inflation). |
| 5 | CONSTIT-04: scenario.ts byte-frozen vs origin/main; permanent whole-repo (src+e2e+tests+scripts) orphan-grep gate exists and is neuter-proof | ✓ VERIFIED | `git diff --exit-code origin/main -- src/lib/scenario.ts` → exit 0 (byte-identical). `scenario-backbone-gates.test.ts` CONSTIT-04 block: `ORPHAN_SCAN_FILES` walks src/+e2e/+tests/+scripts/; bans 4 concatenated tokens (self-match-proof); self-excluded walk; neutered-gate detection assertion (matcher fires on synthetic); over-broadening guard pins retained `showDataSources`/`allDataSourcesExcluded`/`dataSourceLabel` OUT. Root-coverage pin forbids narrowing to src-only. Ran green (part of the 183-pass run). |
| 6 | CF-05 supersession intentional + internally consistent (composer↔compare parity); did not break exclusion-only Commit guard | ✓ VERIFIED | Per-key exclusion persists in `toggleByScopeRef` → counts toward `diffCount` exactly like added toggles (togglePerKeySource doc L419-420); compare surface reads the same `toggleByScopeRef` (composer↔compare unified, byte-for-byte). F-01 guard intact: `ScenarioComposer.tsx` L3251 `if (diffs.length === 0)` still fires the honest "Nothing to commit — add a strategy…" error for the exclusion-only commit case (an exclusion is not a committable portfolio diff). |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `analytics-service/tests/test_constit_blend_parity.py` | CONSTIT-05 gate, assert A / report B, no skipif | ✓ VERIFIED | 388 lines, 5 tests pass, offline |
| `analytics-service/tests/fixtures/constit_parity_{fixture,golden}.json` | Committed deterministic fixture + engine golden | ✓ VERIFIED | Both present (73KB / 12KB) |
| `src/app/(dashboard)/allocations/lib/provenance.ts` | deriveProvenance helper | ✓ VERIFIED | Pure, 65 lines, composite>tier>null |
| `src/lib/design-tokens/trust-tier.ts` | ProvenanceTier widens, DB TrustTier 3-valued | ✓ VERIFIED | Both unions correct |
| `src/app/(dashboard)/allocations/lib/scenario-state.ts` | togglePerKeySource on toggleByScopeRef | ✓ VERIFIED | Weightless refs, never rescales weights |
| `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx` | Unified list, badges, per-key toggle wired | ✓ VERIFIED | Single list, both row types badged |
| `src/lib/scenario-backbone-gates.test.ts` | Whole-repo orphan gate, neuter-proof | ✓ VERIFIED | 4 assertions, walks 4 roots |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| ScenarioComposer | togglePerKeySource | `onTogglePerKey={scenario.togglePerKeySource}` (L4449) → useScenarioState | ✓ WIRED | Per-key toggle → toggleByScopeRef |
| CompositionList per-key row | api_verified badge | `<TrustTierLabel trustTier="api_verified">` (L4890) | ✓ WIRED | Rendered per row |
| CompositionList added row | deriveProvenance badge | `addedProvenanceByRef[a.id]` (L2021 useMemo → deriveProvenance) → L4950 | ✓ WIRED | Book payload + drawer lazy fetch |
| queries.ts / returns route | composer metadata lookup | trust_tier + is_composite in SSR payload + returns route | ✓ WIRED | strategy_verifications + data_quality_flags.composite |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| CONSTIT-05 parity gate runs offline + green | `pytest tests/test_constit_blend_parity.py -q` | 5 passed in 0.91s | ✓ PASS |
| Composer + orphan-gate suites green | `vitest run ScenarioComposer.test.tsx scenario-backbone-gates.test.ts` | 183 passed | ✓ PASS |
| scenario.ts byte-frozen vs origin/main | `git diff --exit-code origin/main -- src/lib/scenario.ts` | exit 0 | ✓ PASS |
| includeByApiKeyId fully removed | `grep -rn includeByApiKeyId src e2e tests scripts` | 0 live (1 comment) | ✓ PASS |

### Scope Fence

Phase-111-only diff (`7ac877d2^..e885752a`): 25 files — parity gate (fixture/golden/test/capture), composer reshape (ScenarioComposer, scenario-state, useScenarioState, provenance), provenance threading (queries.ts, returns route, trust-tier, TrustTierLabel, DESIGN.md, a11y), orphan gate, and mechanical test-fixture propagation. **No `scenario.ts` edits, no weights/leverage editing, no E1/E2 (Sharpe/TWR/equity), no "+ Allocation" dispatch.** Fence held.

### Anti-Patterns Found

None. No debt markers (TBD/FIXME/XXX) introduced. No stubs — the reshape wires real data end-to-end (per-key sources from SSR payload, added-row provenance from the 111-02 metadata lookup). Retained `showDataSources`/`allDataSourcesExcluded` are live render-gating locals (not orphans), explicitly pinned in-scope by the over-broadening guard.

### Human Verification Required

None blocking. All six enumerated must-haves are code/test-verifiable and verified. Pixel-level visual QA of the badge tokens (DESIGN.md conformance, radius/color) is covered by the `tests/a11y/trust-tier-tokens.test.ts` drift gate and the DOM-structure assertions in ScenarioComposer.test.tsx; any browser-level design polish is a milestone-level `/qa` concern already tracked in project memory, not a Phase-111 gap.

### Gaps Summary

No gaps. The CONSTIT-05 parity gate is green (interpretation A == frozen engine, no re-baseline; A-vs-B +0.012165 terminal-wealth divergence recorded for a future decision). The Data-Sources section is deleted and replaced by one unified badged constituent list; provenance is threaded from server truth (strategy_verifications.trust_tier + data_quality_flags.composite) with the DB TrustTier union intact; the two toggle channels are unified onto draft.toggleByScopeRef with includeByApiKeyId gone; scenario.ts is byte-frozen vs origin/main and a neuter-proof whole-repo orphan gate enforces the deletion permanently. The CF-05 supersession is intentional, composer↔compare consistent, and leaves the F-01 exclusion-only commit guard intact.

---

_Verified: 2026-07-16T23:35:00Z_
_Verifier: Claude (gsd-verifier)_
