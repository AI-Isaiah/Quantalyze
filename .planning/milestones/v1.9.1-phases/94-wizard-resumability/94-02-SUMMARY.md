---
phase: 94-wizard-resumability
plan: 02
subsystem: wizard
tags: [nextjs, react, client-component, composite, wizard, rehydration, security]

# Dependency graph
requires:
  - phase: 94-wizard-resumability
    plan: 01
    provides: "GET /api/strategies/composite/members?strategy_id — owner-scoped secretless member read (api_key_id + exchange/nickname/window/verified)"
  - phase: 88-onboarding
    provides: MultiKeyConnectStep State A/State B + buildSetMembersKeys secretless set-members payload
provides:
  - "MultiKeyConnectStep rehydrates State B from the WIZ-01 GET on mount (draftStrategyId prop + mount effect)"
  - "Back-nav to connect_key shows pre-filled verified keys, never a blank form"
  - "Rehydrated verified key resubmits with an EMPTY secret (set-members carries api_key_id only) — no re-validation"
affects: [WIZ-05, wizard-resumability, composite-onboarding]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Client-side State B rehydration: mount useEffect consumes the owner-scoped GET, maps members → validated panels with hardcoded-empty plaintext, guarded against clobbering in-progress work via panelsRef at resolve time"
    - "Secretless-by-construction resubmit: a rehydrated panel (status validated + windowStart) satisfies allValidated, so Continue enables and set-members POSTs only api_key_id/window/seq — no secret re-entry, no add-key re-validation"

key-files:
  created: []
  modified:
    - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx
    - src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx

key-decisions:
  - "Named the prop draftStrategyId (not strategyId) to avoid shadowing the local strategyId state at :296"
  - "toRehydratedPanel hardcodes apiKey/apiSecret/passphrase to '' — mirrors T-88-18 post-validate clearing so no secret ever enters browser state on rehydrate"
  - "Rehydration applies only when still pristine (mode single AND panels.length === 0, checked via panelsRef at resolve time) so it never clobbers in-progress work"
  - "Non-ok / failed GET degrades honestly to State A (the pre-phase blank-form behavior) with the error logged (object only, T-94-07); no secret-touching path"

requirements-completed: [WIZ-02]

# Metrics
duration: 6min
completed: 2026-07-11
---

# Phase 94 Plan 02: MultiKeyConnectStep State B Rehydration (WIZ-02) Summary

**MultiKeyConnectStep now rehydrates State B from the WIZ-01 GET on mount — back-nav to connect_key shows stored keys pre-filled and verified (never a blank form), and an unchanged verified key resubmits with an EMPTY secret via set-members (api_key_id only), no re-validation and no secret ever entering browser state.**

## Performance
- **Duration:** ~6 min
- **Completed:** 2026-07-11
- **Tasks:** 2
- **Files modified:** 3 (2 source + 1 test)

## Accomplishments
- Threaded the composite draft's `strategyId` into `MultiKeyConnectStep` as the new optional `draftStrategyId` prop, wired at the single `step === "connect_key"` render site in `WizardClient.tsx`.
- Added a mount `useEffect` (deps `[draftStrategyId]`, `cancelled` cleanup) that fetches `GET /api/strategies/composite/members?strategy_id=…` and rebuilds State B: `setStrategyId(draftStrategyId)`, `setMode("multi")`, `setPanels(members.map(toRehydratedPanel))`.
- `toRehydratedPanel` mirrors a post-validate panel exactly — `status: "validated"`, `apiKeyId` set, `errorCode: null`, and `apiKey/apiSecret/passphrase` hardcoded to `""` — so the existing gating predicates (`allValidated`) accept it: Continue enables with no re-validation and the secretless `set-members` resubmit works by construction.
- Guards: no `draftStrategyId` → no fetch (byte-neutral State A); empty membership → stays single-key State A; rehydration applies only when pristine (`mode === "single"` and `panels.length === 0` via `panelsRef` at resolve time) so it never clobbers in-progress work; non-ok/failed GET degrades to State A with an error-object-only log.
- Component tests pin the whole seam offline (mode flip, 2 verified panels, no `add-key` re-validation, empty-secret Continue enabled, value-pinned `set-members` body, empty-members → State A, no fetch without a draft).

## Task Commits
1. **Task 1: thread draftStrategyId + mount rehydration effect** — `54cfeae4` (feat)
2. **Task 2: rehydration component tests (RED-before/GREEN-after)** — `0a6d0ac0` (test)

_TDD note: Task 2's tests were RED-proofed — neutering the mount effect (early return) turned 3 of the 4 WIZ-02 tests RED (the no-draft negative test correctly stayed green); the neuter was reverted before the test commit._

## Files Created/Modified
- `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.tsx` — `draftStrategyId` prop; `toRehydratedPanel` mapper (empty plaintext); mount rehydration `useEffect`. No change to `buildSetMembersKeys`, `validatePanel`, `handleContinue`, `computeValidation`, or the State A delegation.
- `src/app/(dashboard)/strategies/new/wizard/steps/MultiKeyConnectStep.test.tsx` — new `[WIZ-02] … State B rehydration` describe (4 tests) using the file's fetch-mock idiom; value-pins the `set-members` body keys and asserts the negative space (no `add-key`, no camelCase secret fields).
- `src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx` — one line: `draftStrategyId={strategyId}` at the `connect_key` render site.

## Decisions Made
- Prop named `draftStrategyId` to avoid shadowing the component's local `strategyId` state.
- Rehydrated panels carry empty plaintext (T-94-06 mitigation grep-pinned + test-asserted); no re-validation path exists because a validated panel already satisfies `allValidated`.
- Honest degradation on GET failure (log the error object only, fall back to State A) rather than any silent secret-touching recovery.

## Deviations from Plan
None — plan executed exactly as written (Task 1 source + Task 2 tests, both automated verifies green).

## Verification
- `npx tsc --noEmit` clean.
- `npx vitest run "src/app/(dashboard)/strategies/new/wizard"` — 178/178 pass (whole wizard suite; existing 15 MultiKeyConnectStep tests unchanged + 4 new WIZ-02 tests).
- `npm run lint -- "src/app/(dashboard)/strategies/new/wizard"` — 0 errors (1 pre-existing warning in unrelated `EquityChart.tsx`, out of scope).
- RED-proof: mount effect neutered → 3 of 4 WIZ-02 tests RED; reverted.
- No migration.

## Threat Surface
- T-94-06 (secret disclosure via rehydrated PanelState): mitigated — `toRehydratedPanel` hardcodes the 3 plaintext fields to `""`; test asserts the `set-members` body contains no `apiKey`/`apiSecret`/`passphrase`.
- T-94-07 (log disclosure): mitigated — the effect's `console.error` logs the error/status only.
- No new security surface beyond the plan's `<threat_model>`.

## Known Stubs
None.

## Next Phase Readiness
- WIZ-02 satisfied: composite back-nav rehydrates verified keys, empty-secret resubmit works, single-key State A byte-neutral. Ready for WIZ-05 / remaining resumability plans.
- No blockers.

---
*Phase: 94-wizard-resumability*
*Completed: 2026-07-11*

## Self-Check: PASSED
- MultiKeyConnectStep.tsx, MultiKeyConnectStep.test.tsx, 94-02-SUMMARY.md all present
- commits 54cfeae4 (feat), 0a6d0ac0 (test) both in git history
