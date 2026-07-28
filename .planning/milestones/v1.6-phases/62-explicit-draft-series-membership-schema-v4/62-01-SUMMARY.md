---
phase: 62-explicit-draft-series-membership-schema-v4
plan: 01
subsystem: allocations / scenario draft persistence
tags: [schema-v4, membership, codec, zod, non-destructive-upgrade]
requires:
  - "ScenarioDraft codec + scenarioDraftSchema (v1.5 PERSIST-01, schema v3)"
provides:
  - "ScenarioDraft.memberKeyIds: string[] (required@v4)"
  - "SCENARIO_SCHEMA_VERSION = 4, SCENARIO_SCHEMA_VERSION_PREV = 3"
  - "TOLERANT scenarioDraftSchema (memberKeyIds optional, no superRefine)"
  - "scenarioDraftSaveSchema (exported, save-boundary v4 superRefine)"
  - "codec: upgraded_v3_membership (PREV) + upgraded_v2_chain (literal-2) branches"
  - "deriveMembershipFromGate, isBookOnlyDraft (null-safe), setMemberKeyIds"
affects:
  - "saved/route.ts POST + saved/[id]/route.ts PUT (swapped to scenarioDraftSaveSchema)"
  - "ScenarioComposer reopen provenance-note trigger (reason rename)"
tech-stack:
  added: []
  patterns:
    - "tolerant-decode / strict-save schema split (Open Question 3)"
    - "double-bump chain: named-PREV branch + literal-version chain branch"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/lib/scenario-state.ts"
    - "src/app/(dashboard)/allocations/lib/scenario-state.test.ts"
    - "src/app/api/allocator/scenario/saved/route.ts"
    - "src/app/api/allocator/scenario/saved/[id]/route.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ProvenanceNote.tsx"
    - "src/app/(dashboard)/allocations/lib/scenario-compare.ts"
    - "src/app/scenario-share/[token]/share-resolve.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComparePanel.test.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx"
    - "src/app/(dashboard)/allocations/hooks/useScenarioState.test.tsx"
    - "src/app/(dashboard)/allocations/hooks/useScenarioState.hydrate.test.tsx"
    - "src/app/(dashboard)/allocations/lib/scenario-compare.test.ts"
    - "src/app/(dashboard)/allocations/lib/scenario-state-apply-weights.test.ts"
    - "src/app/(dashboard)/allocations/lib/scenario-state.localStorage.test.ts"
    - "src/app/scenario-share/[token]/share-resolve.test.ts"
    - "src/app/scenario-share/[token]/page.test.tsx"
    - "src/lib/scenario-dealias.test.ts"
decisions:
  - "v4 membership REQUIRED enforced ONLY at the save boundary (scenarioDraftSaveSchema); the codec-decode schema stays tolerant so underived-v4 localStorage round-trips decode ok (the blocker fix)"
  - "reason string renamed upgraded_v2_windowless → upgraded_v2_chain (v2 now spans two versions via the literal-2 chain branch); v3 upgrade = upgraded_v3_membership"
requirements: [MEMBER-01]
metrics:
  duration_min: 20
  tasks: 3
  files_modified: 18
  completed: "2026-07-03"
---

# Phase 62 Plan 01: Explicit Draft Series Membership (schema v4) Summary

Persisted-membership foundation for v1.6: `ScenarioDraft` gains a required-at-v4
`memberKeyIds: string[]`, `SCENARIO_SCHEMA_VERSION` double-bumps 3→4 / PREV 2→3,
and the codec grows a SECOND non-destructive branch so BOTH v2 and v3 drafts
decode `ok` (never dropped). The v4 REQUIRED contract lives on a separate
exported `scenarioDraftSaveSchema` (save-boundary fail-loud) while the shared
codec-decode schema stays TOLERANT — the blocker fix that keeps upgraded
localStorage round-trips alive.

## What shipped

- **Field + double bump:** `memberKeyIds` added after `window?`; `SCENARIO_SCHEMA_VERSION = 4`, `SCENARIO_SCHEMA_VERSION_PREV = 3`. `defaultDraftFromHoldings` stamps `memberKeyIds: []`.
- **Tolerant / strict schema split:** `scenarioDraftSchema` gains `memberKeyIds: z.array(z.string().max(512)).max(64).optional()` with NO superRefine (T-62-02 DoS bounds). New exported `scenarioDraftSaveSchema = scenarioDraftSchema.superRefine(...)` requires membership when `schema_version >= 4`. Exactly one `.superRefine(` call in the file (the shared schema has none).
- **Codec:** PREV(v3) branch reason → `upgraded_v3_membership`; NEW `rawVersion === 2` chain branch → `upgraded_v2_chain`; both non-destructive (membership left underived). Exact-v4 branch already tolerant → a v4 blob without membership decodes `ok`/underived and survives encode→decode (the blocker regression, RED-proven then GREEN).
- **Save boundary:** `saved/route.ts` POST and `saved/[id]/route.ts` PUT swapped to `scenarioDraftSaveSchema` (checker W-A symmetric enforcement). No SQL/RPC change — membership rides the whole-draft jsonb.
- **Three shared helpers:** `deriveMembershipFromGate` (gate → copy of ids | []), `isBookOnlyDraft` (null-safe `?? []`), `setMemberKeyIds` (pure stamp). Consumed by plans 02–04.

## TDD gates

- RED (`7c57e629`): `MEMBER-01 v4 codec + membership helpers` describe block, 15 failing (unresolved new exports + v2/round-trip assertions). RED-CONFIRMED.
- GREEN (`1361adda`): field/schema/codec/helpers land; scenario-state.test.ts 72/72 green.
- Fixture rebase (`b6961e81`): full suite green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ScenarioComposer reopen keyed on the renamed reason string**
- **Found during:** Task 2 (reason rename)
- **Issue:** The plan mandated renaming `upgraded_v2_windowless` → `upgraded_v2_chain`, but `ScenarioComposer.tsx:1272` triggered the pre-window provenance note on the OLD string. A real v2 blob reopened through the codec (ScenarioComposer.test.tsx "reopening an upgraded-v2 draft ... shows the provenance note", fed a live v2 blob) would silently stop showing the note — a regression the full suite catches.
- **Fix:** Updated the trigger to `decoded.reason === "upgraded_v2_chain"` (the v2-chain reason precisely maps to "predates coverage windows"; a v3→v4 membership upgrade correctly does NOT show the window note). Updated the adjacent code comment + the stale doc comments in `ScenarioComposer.tsx:834` and `ProvenanceNote.tsx`.
- **Files modified:** ScenarioComposer.tsx, ProvenanceNote.tsx
- **Commit:** 1361adda

**2. [Rule 3 - Blocking] Pitfall-2: T_SAVE6 "genuinely-legacy resets" fixture broke on the double bump**
- **Found during:** Task 3
- **Issue:** `ScenarioComposer.save.test.tsx` T_SAVE6 used `schema_version: SCENARIO_SCHEMA_VERSION_PREV - 1` to mean "a version below the upgrade window → reset". With PREV now 3, that expression = 2, which the NEW v2-chain branch decodes `ok` — so the fixture no longer reset.
- **Fix:** Rebased to the literal `1` (below the v2-chain floor; v1 is the original destructive-reset version and always resets), rewrote the rationale comment, and dropped the now-unused `SCENARIO_SCHEMA_VERSION_PREV` import.
- **Files modified:** ScenarioComposer.save.test.tsx
- **Commit:** b6961e81

**3. [Rule 3 - Blocking] Required-at-v4 field forced memberKeyIds onto existing ScenarioDraft literals (tsc)**
- **Found during:** Task 3
- **Issue:** Making `memberKeyIds` required broke `tsc --noEmit` on 2 source files (`scenario-compare.ts` live-book default, `share-resolve.ts` neutral default) and 10 test files building hand-built `ScenarioDraft` literals.
- **Fix:** Added `memberKeyIds: []` to each (deterministic script for the bulk test literals; source literals get an explaining comment). The tolerant codec still decodes v2/v3 blobs lacking the field.
- **Files modified:** scenario-compare.ts, share-resolve.ts + 10 test files
- **Commit:** b6961e81

## Verification

- `npm test` full suite: **7429 passed / 0 failed** (288 skipped).
- `npx tsc --noEmit`: **0 errors**.
- `npm run lint`: **0 errors, 1 warning** (pre-existing frozen EquityChart hook-dep, not touched).
- GUARD-03 frozen zero-diff: `git diff src/lib/scenario.ts src/lib/scenario-window.ts` **empty**.
- Threat register: T-62-02 mitigated (`.max(64)` + per-element `.max(512)`); T-62-03 mitigated (tolerant-decode / strict-save split; corrupt blobs still reset(schema_invalid)).

## Known Stubs

None. `memberKeyIds` defaults to `[]` at fresh-draft creation and is left underived on upgrade by design; plan 04 derives + stamps real membership on reopen. This is an intentional, documented staged rollout, not a stub blocking the plan goal (MEMBER-01 is the persistence foundation only).

## Self-Check: PASSED
- scenario-state.ts / .test.ts / saved routes / ScenarioComposer.tsx: all present and modified on disk.
- Commits 7c57e629, 1361adda, b6961e81 all exist in git log.
