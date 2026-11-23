---
phase: 218-selfheal-the-wizard-s-mt5-key-check-heals-an-owed-terminal-s
plan: 04
subsystem: wizard
tags: [wizard, resume-banner, hold-gate, copy]
requires: []
provides:
  - stepHeld render gate in WizardClient
  - resumeBannerBody / resumeSecretKind pure functions
affects:
  - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
tech-stack:
  added: []
  patterns: [pure matrix-tested copy function, unmocked-derivation hold test]
key-files:
  created:
    - src/lib/wizard/resume-banner.ts
    - src/lib/wizard/resume-banner.test.ts
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.resume-hold.test.tsx
  modified:
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.tsx
    - src/app/(dashboard)/strategies/new/wizard/WizardClient.test.tsx
    - src/app/(dashboard)/allocations/components/ContributionWizardOverlay.test.tsx
    - src/app/(dashboard)/allocations/components/ContributionWizardOverlay.preselect.test.tsx
key-decisions:
  - "No exemption for preselect mounts (RESEARCH Pitfall 10): a draft with no pointer holds the preselect summary too."
requirements-completed: [218-SC-6, 218-SC-7]
status: complete
commits: 2
plan_head_before: 81d2a9eb6122958fa25f5f4cac232ac3cd6355a5
plan_head_after: 6ba7424a1
actuals:
  tasks: 2
  commits: 2
---

# Phase 218 Plan 04: Wizard resume hold and banner copy Summary

A draft with no matching local pointer now shows the resume banner as the only content until Resume or Start fresh, and the banner copy follows the key type and the resumed step.

## What was built

- **Task 1 (tracer), commit `8dfc8eae3`.** `stepHeld = Boolean(initialDraft) && (!hydrated || showResumeBanner)` wraps the whole step-branch block in `WizardClient.tsx`; the `wizard_step_view` effect returns while held. Declared beside the `hydrated` state, not just before `return`, because the effect's dependency array reads it (const temporal dead zone). Resume, Start fresh, the confirmed delete, silent resume and the no-draft mount are untouched.
- **Task 2, commit `6ba7424a1`.** `resumeBannerBody({source, secretKind, resumeStep})` and `resumeSecretKind(supportedExchanges)` in `src/lib/wizard/resume-banner.ts`, using `venueSecretIsVerbatim`. CSV keeps the re-select copy; API/MT5 resuming onto `sync_preview` carry no re-entry sentence; a `connect_key` resume names the investor password (MT5) or the API secret. The sentence "paste your API secret again" now lives only in `resume-banner.ts`.

## Neuter-once RED proof

Backed up `WizardClient.tsx` to the scratchpad, set `stepHeld` to `false`, ran `WizardClient.resume-hold.test.tsx`: 4 of 7 RED (`no local pointer: the banner is alone`, `a pointer for ANOTHER draft is the same hold`, `a CSV draft holds the dropzone too`, `the step-view event does NOT fire while the step is held`; first line `AssertionError: expected <div …(1)></div> to be null`). Restored from the backup, `cmp` exit 0. The three cases that must stay green (Resume, matching pointer, no draft) stayed green.

## Verification

- `npx vitest run src/lib/wizard/resume-banner.test.ts "src/app/(dashboard)/strategies/new/wizard" "src/app/(dashboard)/allocations/components" src/lib/wizard`: 117 files, 3134 tests passed.
- `npm run typecheck`: clean. `npm run lint`: 0 errors (4 pre-existing warnings in `queries.stale-analytics-detail.test.ts` and similar, untouched), planning-hygiene checks OK.
- `npm ci` left `package-lock.json` unchanged.
- `e2e/wizard-resume.spec.ts` NOT run (needs the seeded TEST env). Its flow, banner then Resume then the step, is unchanged by construction.

## Deviations from Plan

**1. [Rule 3 - Blocking] `ContributionWizardOverlay.preselect.test.tsx` rewritten (not in the plan's file list).**
- **Found during:** Task 1 full-directory run (RESEARCH had only grepped it, and said its draft+preselect cases were unaffected).
- **Issue:** O-4 ("key with a live draft: shows the summary first, then resumes THAT draft") mounted a draft with no pointer plus a preselect; the preselect summary sat under the banner. With the hold, the summary is hidden until the banner is answered.
- **Fix:** O-4 now asserts the banner alone (no summary, no sync preview), then Resume lands on `sync_preview` with the draft id and key id. Resume already replaced the summary with `sync_preview` before this plan, so the post-Resume outcome is unchanged; what is lost is only the ability to click "Continue with this key" under an unanswered banner, which is the pre-made choice this plan removes (Pitfall 10, no exemption). Surfaced here because RESEARCH's "unaffected" claim was wrong for this case.
- **Files modified:** `src/app/(dashboard)/allocations/components/ContributionWizardOverlay.preselect.test.tsx`
- **Commit:** `8dfc8eae3`

**2. [Minor] TRAP-4 ANTI-REGRESSION test part (2)** now deletes through the chrome's `wizard-delete-draft` control, which shares the confirm dialog with Start fresh, because the Resume click needed for part (1) removes the banner. Start fresh's own confirm path stays covered by the other TRAP-4 cases.

## Known Stubs

None.

## Threat Flags

None.

## Self-Check: PASSED

Files exist (resume-banner.ts, resume-banner.test.ts, WizardClient.resume-hold.test.tsx); commits `8dfc8eae3` and `6ba7424a1` are on `worktree-agent-218-04`; `grep -c 'const stepHeld = Boolean(initialDraft) && (!hydrated || showResumeBanner);'` = 1.
