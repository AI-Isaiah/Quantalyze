---
phase: 62-explicit-draft-series-membership-schema-v4
plan: 02
subsystem: allocations / scenario compare engine selection
tags: [schema-v4, membership, compare, f5-closure, member-04-drop]
requires:
  - "62-01: ScenarioDraft.memberKeyIds + deriveMembershipFromGate / setMemberKeyIds (schema v4)"
provides:
  - "membership-driven compare selector (usePerKeySources reads draft.memberKeyIds, not the live gate)"
  - "MEMBER-04 compute-time drop: persisted membership intersected with the SSR-eligible set"
  - "buildLiveBookDraft(eligibleApiKeyIds) — own-book column stamps derived membership, stays on the union path"
  - "panel derives membership for EVERY underived column before compute (golden preserved)"
affects:
  - "scenario compare tab per-column engine-set selection"
  - "the live-book own-book column (Phase-55 union lock, byte-stable)"
tech-stack:
  added: []
  patterns:
    - "persisted-membership selector replaces the runtime gate as the saved-draft compare selector"
    - "boundary-derive underived membership at the single per-column compute seam"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/lib/scenario-compare.ts"
    - "src/app/(dashboard)/allocations/lib/scenario-compare.test.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComparePanel.tsx"
decisions:
  - "The `?? []` in the selector is DEFENSIVE only — the panel guarantees membership is defined (derives it for underived columns) BEFORE compute, so the default never silently flips an upgraded book column to added-only (the golden-regression the checker flagged)"
  - "buildLiveBookDraft stamps membership = deriveMembershipFromGate(true, eligibleIds); an empty eligible set → empty membership → the legacy holdings path (matches pre-membership gate-off behavior)"
requirements: [MEMBER-02]
metrics:
  duration_min: 18
  tasks: 2
  files_modified: 3
  completed: "2026-07-03"
---

# Phase 62 Plan 02: Membership-Driven Compare Selector (F5 closure) Summary

MEMBER-02 makes the scenario-compare engine select its per-key set from a saved
draft's PERSISTED `memberKeyIds` instead of the live gate. A blank-authored
draft (`memberKeyIds=[]`) now computes the added-only holdings path even when the
live per-key gate is satisfied, so it can never inherit the live book in its
compare column — red-team F5 closed by construction. `entryMode` is retired as a
load-bearing signal for saved drafts.

## What shipped

- **Selector rewrite (`scenario-compare.ts`):** `usePerKeySources = (draft.memberKeyIds ?? []).length > 0` replaces the gate-only `perKeyDailiesGateSatisfied === true`. Membership is the self-describing selector; the `?? []` is defensive only (the panel guarantees membership is defined upstream).
- **MEMBER-04 compute-time drop:** the per-key branch intersects `draft.memberKeyIds` with `liveInputs.eligibleApiKeyIds` (the SSR SoT). A persisted member that is no longer eligible — or a fabricated id — drops at compute, never blended (T-62-04 disclosure / T-62-05 tampering mitigated). An empty membership ⇒ `usePerKeySources` false ⇒ the existing holdings/added path (F5 closed).
- **`buildLiveBookDraft(eligibleApiKeyIds)`:** signature changed; stamps `memberKeyIds: deriveMembershipFromGate(true, eligibleApiKeyIds)` so the own-book column selects the per-key union blend. `{ liveBook: true }` at the call site holds it on the Phase-55 own-book union path (byte-stable). Empty eligible set → empty membership → holdings path (unchanged legacy behavior).
- **Panel derivation (`ScenarioComparePanel.tsx`):** passes `payload.eligibleApiKeyIds ?? []` into `buildLiveBookDraft`, and for EVERY per-column draft whose decoded `memberKeyIds === undefined` (upgraded v2/v3 `upgraded_v3_membership` / `upgraded_v2_chain`, or a round-tripped underived-v4) derives membership via `deriveMembershipFromGate(gate, eligibleIds)` and stamps it with `setMemberKeyIds` BEFORE `computeMetricsForDraft`. So old/underived columns compute IDENTICALLY to today — the Atlas golden is preserved — and the selector never sees undefined. Genuine-v4 columns pass through unchanged (their dropped members intersect out at compute).

## TDD gates

- **RED (`17633567`):** new `MEMBER-02 membership selector (F5 closure)` describe block — F5 blank-membership computes added-only under gate=true, membership-subset blends only persisted members, MEMBER-04 drop, the Atlas-class 40-day golden, live-book union lock. Rebased the P61-BUG-2 per-key fixtures to carry explicit `memberKeyIds`. 3 assertions RED against the gate-only selector (F5 + subset + empty-membership-with-gate-true). RED-CONFIRMED.
- **GREEN (`172bef96`):** selector rewrite + intersection + `buildLiveBookDraft` stamp + panel derivation. scenario-compare + ScenarioComparePanel tests 30/30; the full allocations + share subtree 1369/1369.

## Golden preservation

The 40-day per-key book blend (Atlas-class golden) computes IDENTICALLY after the
change when membership is derived = eligible ids: `n=40, twr≈0.04074, sharpe≈10.45,
member_count=2, effective 2026-02-02 → 2026-03-27`. The live-book union column is
byte-identical on the same fixture. Pinned as an explicit regression guard in the
new describe block (this is why the golden fixture is modeled with derived
membership, NOT `memberKeyIds=[]` — the latter would flip it to added-only).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] `buildLiveBookDraft()` call sites broke on the required-arg signature change**
- **Found during:** Task 2 (GREEN)
- **Issue:** Making `eligibleApiKeyIds` a required parameter broke 3 pre-existing test call sites (`scenario-compare.test.ts:322/438/462`) that called `buildLiveBookDraft()` with no argument — `deriveMembershipFromGate` then spread `undefined` (`TypeError: eligibleApiKeyIds is not iterable`).
- **Fix:** Updated the 3 call sites to `buildLiveBookDraft([])`. All three are holdings-only book fixtures (no per-key keys) → `[]` → empty membership → the holdings union path, preserving their pre-change intent. The `ScenarioComparePanel.test.tsx` mock (`buildLiveBookDraft: () => mockBuildLiveBookDraft()`) ignores the arg and needed no change.
- **Files modified:** scenario-compare.test.ts
- **Commit:** 172bef96

## Verification

- `npm test` full suite: **7435 passed / 0 failed** (288 skipped).
- `npx tsc --noEmit`: **0 errors**.
- `npx eslint` on the 3 touched files: **0 errors**.
- P61-BUG-2 per-key block + T_CP8 (ScenarioComparePanel.test.tsx): green.
- GUARD-03 frozen zero-diff: `git diff src/lib/scenario.ts src/lib/scenario-window.ts` **empty**.
- Threat register: T-62-04 / T-62-05 mitigated (membership ∩ SSR-eligible drop at compute).

## Known Stubs

None. Membership is now the load-bearing compare selector; the panel derives it
for underived columns so there is no undefined path reaching the engine. Plan 04
stamps derived membership onto the persisted localStorage blob on reopen/save.

## Self-Check: PASSED
- scenario-compare.ts / scenario-compare.test.ts / ScenarioComparePanel.tsx: all present and modified on disk.
- Commits 17633567, 172bef96 exist in git log.
