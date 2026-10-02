---
phase: 62-explicit-draft-series-membership-schema-v4
plan: 04
subsystem: allocations / scenario composer membership persistence
tags: [schema-v4, membership, member-04, stamp, reopen-derive, provenance-note, f5-closure]
requires:
  - "62-01: ScenarioDraft.memberKeyIds + setMemberKeyIds / deriveMembershipFromGate (schema v4)"
  - "62-02: membership-driven compare selector (persisted membership is load-bearing)"
provides:
  - "new-save entryMode-aware membership STAMP at both save sites (POST + PUT)"
  - "reopen DERIVE-AND-STAMP: underived drafts become self-describing in the working state"
  - "reopen ineligible-member disclosure via a distinct ephemeral ProvenanceNote variant"
  - "ProvenanceNote parameterized (optional message + optional action + testId)"
affects:
  - "ScenarioComposer save toolbar (POST/PUT bodies now carry stamped membership)"
  - "ScenarioComposer reopen decision tree (window notes gated on !showMembershipNote)"
  - "ProvenanceNote (second, membership variant reuses the ephemeral shell)"
tech-stack:
  added: []
  patterns:
    - "STAMP ≠ DERIVE: new-save stamp is entryMode-aware (blank ⇒ [] even at gate=true); reopen derive is gate-only (upgrade-read)"
    - "ephemeral per-open disclosure note (component-local dismissal, nonce-keyed remount, no cross-tab key)"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.tsx"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx"
    - "src/app/(dashboard)/allocations/components/ProvenanceNote.tsx"
    - "src/app/(dashboard)/allocations/components/ProvenanceNote.test.tsx"
decisions:
  - "The SAVE stamp uses the entryMode-aware condition (entryMode === 'book' && gate) NOT deriveMembershipFromGate — the gate-only rule would stamp book members onto a blank draft whenever the live gate is satisfied, re-opening F5. deriveMembershipFromGate is reserved for the reopen (upgrade-read) path."
  - "Reopen derive reads decoded.value.memberKeyIds === undefined to detect underived drafts (upgraded v2/v3 OR underived-v4 round-trip); a genuine-v4 draft hydrates unchanged. Ineligible disclosure reads the RAW decoded membership (an underived draft has no persisted membership → derived set is eligible-only → no false note)."
  - "The membership note renders independent of windowBounds (a dropped data source is orthogonal to coverage windows) and takes priority over the window/default notes (both gated on !showMembershipNote) so the two note families never stack."
requirements: [MEMBER-04]
metrics:
  duration_min: 22
  tasks: 3
  files_modified: 4
  completed: "2026-07-03"
---

# Phase 62 Plan 04: Explicit Draft Series Membership — Composer STAMP + Reopen Derive + Disclosure Summary

MEMBER-04 completes the persisted-membership contract at the composer. New saves
STAMP entryMode-aware membership (book+gate ⇒ eligible ids; blank ⇒ [] even when
the gate is true — the F5 STAMP closure). Reopening an upgraded/underived draft
DERIVES membership from the gate and stamps it into the WORKING draft so the
draft is self-describing immediately (the next localStorage persist writes a
v4-with-membership blob; `entryMode` stops being load-bearing). Reopening a draft
whose persisted membership includes an id no longer eligible DISCLOSES the drop
via a distinct ephemeral provenance note — the recompute over the remainder is
never silent.

## What shipped

- **STAMP (Task 2, entryMode-aware):** `const memberKeyIdsForSave = entryMode === "book" && payload.perKeyDailiesGateSatisfied ? (payload.eligibleApiKeyIds ?? []) : [];`, applied at BOTH save sites via `draft: setMemberKeyIds(scenario.draft, memberKeyIdsForSave)` (`postNewScenario` POST + `putUpdateScenario` PUT). Book+gate ⇒ eligible ids; blank ⇒ [] EVEN when gate=true (F5 closure); book without gate ⇒ [] (holdings fallback has no per-key membership). Deliberately NOT `deriveMembershipFromGate` — that gate-only rule ignores entryMode and would re-open F5.
- **DERIVE-AND-STAMP (Task 3, gate-only):** the reopen path computes a single `hydratedValue` — when `decoded.value.memberKeyIds === undefined` (upgraded v2/v3 `upgraded_v3_membership` / `upgraded_v2_chain`, or an underived-v4 round-trip) it stamps `setMemberKeyIds(decoded.value, deriveMembershipFromGate(gate, eligibleIds))`; a genuine-v4 draft hydrates unchanged. Both the `readonly` and `ok` hydrate calls consume `hydratedValue`, so the reopened working draft is self-describing.
- **Ineligible disclosure (Task 3):** a second `showMembershipNote` gate flag (parallel to `showProvenanceNote`), set in the non-drift `ok` branch from `droppedMembers = (decoded.value.memberKeyIds ?? []).filter(id => !eligibleSet.has(id))`; cleared on drift/readonly/reset. Renders a distinct `scenario-membership-note` ProvenanceNote (LOCKED copy: "A data source saved with this scenario is no longer available — showing the remaining sources."), keyed on `loadedScenarioId-nonce` for per-affected-draft re-show. Window + default notes now gated on `!showMembershipNote` so the two families never stack.
- **ProvenanceNote parameterized:** optional `message` (defaults to the window copy), optional `onShowFullRange` (the inline "Show full range" action renders ONLY when provided), and optional `testId` (defaults to `scenario-provenance-note`). Ephemeral `role="status"` shell + component-local `useState` dismissal kept byte-intact; NO cross-tab storage key added.

## TDD gates

- **RED (`9530947c`):** `MEMBER-04 membership stamping + reopen derive + ineligible disclosure` describe block (7 cases). 4 assertions RED against the pre-plan composer (book-stamp, reopen-derive save-after-reopen oracle, ineligible note, ephemeral re-show); the 3 that assert `[]`/absence coincided with pre-impl behavior (default draft `memberKeyIds=[]`, no note exists). RED-CONFIRMED.
- **GREEN save stamp (`0c339a50`):** entryMode-aware stamp at both save sites; all 3 STAMP assertions pass.
- **GREEN reopen + disclosure (`13dab730`):** reopen derive-and-stamp + ineligible note + ProvenanceNote parameterization; full ScenarioComposer + ProvenanceNote suites 168/168.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] ProvenanceNote `React.ReactNode` type without a React namespace import**
- **Found during:** Task 3 (ProvenanceNote parameterization)
- **Issue:** The plan's `message?: React.ReactNode` referenced the `React` namespace, but the file imports only `{ useState }` from "react" (new JSX transform — no `React` in scope). This would fail `tsc`.
- **Fix:** Imported `type ReactNode` alongside `useState` (`import { useState, type ReactNode } from "react";`) and typed the prop as `ReactNode`. Type-only, zero runtime change.
- **Files modified:** ProvenanceNote.tsx
- **Commit:** 13dab730

**2. [Rule 2 - Missing critical] `openSavedScenario` dependency array widened for the new gate/eligible reads**
- **Found during:** Task 3 (reopen derive + disclosure)
- **Issue:** The reopen callback now reads `payload.perKeyDailiesGateSatisfied` and `payload.eligibleApiKeyIds` (DERIVE + ineligible disclosure). The prior dep array (`[holdingsSummary, scenario.hydrateFromSaved]`) would capture a stale eligible set if it changed without a holdings change, misjudging dropped members.
- **Fix:** Added `payload.perKeyDailiesGateSatisfied` + `payload.eligibleApiKeyIds` to the dep array (behind the existing `exhaustive-deps` disable comment, which is retained for the stable-setter/callback closure) and updated the rationale comment.
- **Files modified:** ScenarioComposer.tsx
- **Commit:** 13dab730

## Verification

- ScenarioComposer.test.tsx + ProvenanceNote.test.tsx: **168 passed / 0 failed** (`--no-file-parallelism`).
- Full allocations subtree regression: **106 files / 1355 passed / 0 failed** (ProvenanceNote signature change has one consumer — ScenarioComposer — and existing callers pass `onShowFullRange`, so no breakage).
- Composer P61-BUG-1 block: green (inside the passing composer suite).
- `npx tsc --noEmit`: **0 errors**.
- `npx eslint` on the 4 touched files: **0 errors, 0 warnings**.
- GUARD-03 frozen zero-diff: `git diff src/lib/scenario.ts src/lib/scenario-window.ts` **empty**.
- ProvenanceNote ephemeral contract: `grep -c "useCrossTabStorage\|localStorage" ProvenanceNote.tsx` = **0**.
- Acceptance greps: `setMemberKeyIds(scenario.draft` ×2; entryMode-aware STAMP condition present; `deriveMembershipFromGate` in the reopen path; `showMembershipNote` present; `scenario-membership-note` testid present; locked copy string present; action renders only when `onShowFullRange` provided.
- Threat register: T-62-07 (client-stamped membership) — bounded by scenarioDraftSaveSchema at the save route + compute-time intersection (62-02); T-62-08 (silent recompute) — mitigated: reopen raises the disclosed note whenever ≥1 member is ineligible.

## LAND STEP (phase-wide, NOT in this plan's commits)

Per project convention, `VERSION` AND `package.json` are bumped together in the
SAME commit at `/ship` / land time (the frontend CI gate fails if only one is
bumped). All four Phase-62 plans land together; this final plan records the step
so it is not forgotten. No version bump was made in this plan's three commits.

## Known Stubs

None. New saves persist real entryMode-aware membership; reopened upgraded/underived
drafts derive + stamp membership into the working state (self-describing); a dropped
member is always disclosed. The persisted-membership contract (MEMBER-01…04) is now
complete end to end.

## Self-Check: PASSED
- ScenarioComposer.tsx / .test.tsx / ProvenanceNote.tsx / .test.tsx: all present and modified on disk.
- Commits 9530947c, 0c339a50, 13dab730 all exist in git log.
