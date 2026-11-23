---
phase: 213-keyflow-a-key-and-its-draft-can-never-be-silently-mixed-up-a
plan: 01
subsystem: wizard
tags: [wizard, localStorage, idempotency, session-fence, telemetry]
requires: []
provides:
  - "deriveWizardResumeOverrides declines an unknown incoming key meeting a stored string key (decision (a), F1 form)"
  - "wizard_session_id_not_restored step label incoming_key_unknown"
affects: [213-02]
tech-stack:
  added: []
  patterns: ["decline-by-omission conjunct in the same if as the session-id emit"]
key-files:
  created: []
  modified:
    - src/lib/wizard/localStorage.ts
    - src/lib/wizard/localStorage.test.ts
    - src/lib/wizard/derive-resume-overrides-arity.contract.test.ts
    - src/__tests__/contracts/contracts-registry.test.ts
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
    - src/app/(dashboard)/allocations/components/ContributionWizardOverlay.sessionid-fence.test.tsx
decisions:
  - "Decline iff source==='api', incoming null, stored apiKeyId is a string, and NOT (initialDraftId !== null && loaded.strategyId === initialDraftId). No new parameter; sessionKeyMatches unchanged."
  - "Only wizardSessionId is withheld on a decline (failedCsvSubmitSig is csv-only). step and showResumeBanner keep their existing rules."
metrics:
  tasks: 2
  commits: 2
  completed: 2026-11-14
status: complete
actuals:
  tokens: 5600
  tasks: 2
  commits: 2
plan_head_before: 1b07768331e7a89ed6c9b6dc3f57c1cc0762dcf8
plan_head_after: a92825cc27352dec50a138d7da88522c53053a62
commits: 2
---

# Phase 213 Plan 01: Unknown-key decline Summary

On the API branch, a wizard that mounts with no incoming key (no draft, no preselect) no longer restores a stored key-A session id, so key A's token can never reach a key-B create-with-key submit through the F6 fence. The CSV literal null and the resumed-composite-draft case (F1) still restore.

## What changed

- `deriveWizardResumeOverrides` computes `sameDraftOnScreen` and `unknownMeetsStoredKey` from existing arguments and ANDs `!unknownMeetsStoredKey` into the same `if` that emits `wizardSessionId` (and, on csv, the burn). `sessionKeyMatches` is untouched. Dated `SUPERSEDED 2026-11-14 (Phase 213 decision (a))` notes sit beside the D-01 paragraph and the KNOWN RESIDUAL paragraph; every old sentence is kept.
- `WizardClient` triage ladder gains `incoming_key_unknown` (fixed string; no key id or session id).
- The 164.2.1 D-01 pin is inverted in place, its title naming `decision (a), 2026-11-14 ... supersedes 164.2.1 D-01`. The plan's five pins are covered by the inverted pin (pin 1: api/null/stored key-a/no draft declines) plus four new ones: (2) csv null still restores; (3) stored key absent and null still restores; (4) F1 control restores `wizardSessionId` AND `step`; (5) different draft on screen declines and sets `showResumeBanner`.
- One wired pin in `ContributionWizardOverlay.sessionid-fence.test.tsx`: real `saveWizardState`, `WizardClient` mounted with no draft and no preselect, real connect step submitted, asserts the POSTed `wizard_session_id` is not key A's token, and asserts the `incoming_key_unknown` telemetry call.
- Arity contract docblock and the registry row: fail-open sentence superseded for the API branch; "must pass UNMODIFIED" replaced by the measured statement (legacy pins still pass because their payloads carry no `apiKeyId`). No assertion changed.

## Verification

- `vitest run` on localStorage.test.ts + sessionid-fence test: 83 passed (2 files). Task 2 command (4 files) plus the fence test: 197 passed (5 files).
- `tsc --noEmit -p tsconfig.json`: clean (after one fix, see deviations). `npm run lint`: 0 errors, 4 warnings (none in touched lines). `eslint` on all six touched files: clean.
- `git diff --stat $(git merge-base origin/main HEAD) -- supabase/`: empty (SC-5).
- `scripts/verify-plan-anchors.mjs` on the plan: OK, 4 claims.
- Acceptance greps: `unknownMeetsStoredKey` in non-comment lines of localStorage.ts = 3 (>=2); `incoming_key_unknown` in non-comment lines of WizardClient.tsx = 1.

## SC-6 neuter evidence (backup by cp to scratchpad, restore by cp, shasum confirmed equal each time: efb5967a... for localStorage.ts, 1f1255f0... for WizardClient.tsx)

| Neuter | RED observed |
|---|---|
| (i) delete the `!unknownMeetsStoredKey` conjunct | `decision (a), 2026-11-14: an unknown incoming key meeting a stored key declines (supersedes 164.2.1 D-01 for the unknown case)`; `decision (a): a DIFFERENT draft on screen still declines the stored token and offers the resume banner`; wired `decision (a): a wizard mounted with no draft and no preselect POSTs a FRESH wizard_session_id, never key A's stored token` (3 failed) |
| (ii) drop `&& !sameDraftOnScreen` (CONTEXT's literal rule) | `decision (a) F1 control: a resumed composite draft (stored draft IS the one on screen) still restores wizardSessionId AND step` (1 failed) |
| (iii) remove the `source === "api"` term | `decision (a): the CSV branch's literal null stays load-bearing and still restores the stored session id`; `leaves step, strategyName and showResumeBanner exactly as the three-arg call returns them` (2 failed) |
| (iv) WizardClient label arm set to "other" | wired case fails on `toHaveBeenCalledWith("wizard_session_id_not_restored", { step: "incoming_key_unknown" })` (1 failed) |

## Deviations from Plan

**1. [Rule 3 - Blocking] Wired pin file also edited in Task 2.** The telemetry-label assertion needs the Task 2 label, so it was added to `ContributionWizardOverlay.sessionid-fence.test.tsx` in the Task 2 commit (the file is not in Task 2's `files`). Also fixed there: `initialDraft={undefined}` failed `tsc` (prop type is `InitialDraft | null`); changed to `null`.

**2. [Rule 2 - precision] Label arm requires `source === "api"`.** The plan's wording was "incomingApiKeyId === null and stored apiKeyId is a string (and the source matched)"; the arm also checks `source === "api"` so a csv mount (null incoming, never declined on key) cannot be mislabeled.

Pin (3) (stored key absent/null still restores) was not separately neutered; it guards over-declining and shares code path with the neutered pins.

## Known Stubs

None.

## Threat Flags

None. T-213-01 mitigated (pin 1 and the wired case go RED when reverted); T-213-02 mitigated (fixed label, asserted exact payload `{ step: "incoming_key_unknown" }`).

## Self-Check: PASSED

Commits 2fdc83dda and a92825cc2 are on feat/213-keyflow; all six modified files exist.
