---
phase: 193-quietview-viewing-a-strategy-changes-nothing-and-shows-only
fixed_at: 2026-11-07T06:10:00Z
review_path: .planning/phases/193-quietview-viewing-a-strategy-changes-nothing-and-shows-only/193-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 193: Code Review Fix Report (round 1, topic: note surfaces)

**Fixed at:** 2026-11-07T06:10:00Z
**Source review:** .planning/phases/193-quietview-viewing-a-strategy-changes-nothing-and-shows-only/193-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (WR-01, WR-02; this round's topic is the note surfaces; IN-01 to IN-05 are out of scope by instruction)
- Fixed: 2
- Skipped: 0

Verification ran in the feat/193-quietview worktree checkout (no extra fixer worktree was created; the caller supplied the isolated worktree). Gates: `npx tsc --noEmit` exit 0; `npm run lint` exit 0 (0 errors, 2 pre-existing warnings in files this round did not touch); `npx vitest run src/components/notes`, HoldingDetail.test.tsx and DashboardNoteCard.test.tsx: 9 files, 101 tests, 0 failed, 0 skipped.

## Fixed Issues

### WR-01: A blur during an in-flight save is skipped, so the server keeps text the user has removed

**Files modified:** `src/components/notes/StrategyNoteCard.tsx`, `src/components/notes/HoldingNoteRow.tsx`, `src/components/notes/BridgeOutcomeNoteSection.tsx`, `src/app/(dashboard)/allocations/components/HoldingDetail.tsx`, and the four matching test files
**Commit:** 0a09fa40c
**Applied fix:** On all four surfaces the blur baseline is `saveState === "saving" ? pendingSaveRef.current : persisted`, used both for the `shouldSaveNoteOnBlur` check and for the skip path's draft reset. The D-09 predicate is unchanged. A failed save leaves `saveState` at `"error"`, so the baseline is the last confirmed value and the next blur retries as before. One RED-first test per surface holds the first PATCH open (HoldingDetail: mocks `saveState` as `"saving"`), edits back to the original, and expects the second blur to send it. `StrategyNoteCard` also has the clear variant (type `abc`, clear while the `abc` save is open, the second blur sends `""`).
**Status:** fixed: requires human verification (logic fix; the tests exercise the traced race but a human should confirm the in-flight semantics).

### WR-02: A failed note load is treated as "nothing is saved", so typed text overwrites a note the user never saw

**Files modified:** `src/components/notes/HoldingNoteRow.tsx`, `src/components/notes/BridgeOutcomeNoteSection.tsx`, and the two matching test files
**Commit:** b04329a95
**Applied fix:** Both components now mirror HoldingDetail's load-error fence. Only a 404 opens the empty editor. Any other non-OK status, or a thrown fetch or parse error, sets `loadError`, logs with `console.error` (as HoldingDetail does), and renders `<div role="alert">` with "Couldn't load your note. Your saved note is safe." and a Retry button, with no editor, no Edit button and no save status. `onBlurTextarea` returns early while `loadError` is set. Retry clears the error, returns to the Loading gate and re-runs the load through a `loadAttempt` counter in the effect's dependencies, which keeps the existing refetch on a changed `scope_ref` or `outcomeId`. The D-09 baseline comment now says the empty seed applies on a 404 only. Per component, three RED-first tests: 500, a thrown fetch, and Retry recovering to the saved note. The two Phase 08 `HoldingNoteRow` tests that pinned "500 and 401 open the empty editor" were replaced, because they asserted the defect. `src/app/strategy/[id]/page.tsx` was not touched (out of scope, booked separately).
**Status:** fixed: requires human verification (the error state has no textarea, so the test asserts there is no editor to type into and that no PATCH is sent on leaving, rather than typing then blurring).

## Neuter evidence (both restored byte-identical, checked with cmp)

- WR-01 neutered (baseline forced back to `persisted` in all four components): 5 tests RED across 4 files, one per surface plus the Strategy clear variant.
- WR-02 neutered (HoldingNoteRow and BridgeOutcomeNoteSection reset to their WR-01-only state): 6 tests RED, three per component.

## Not touched

`DashboardNoteCard` uses the origin of the same idiom and was not in the review's four surfaces; its tests were run and pass.

---

_Fixed: 2026-11-07T06:10:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_

# Phase 193: Code Review Fix Report (round 2, topic: note surfaces)

**Fixed at:** 2026-11-07T07:00:00Z
**Source review:** .planning/phases/193-quietview-viewing-a-strategy-changes-nothing-and-shows-only/193-REVIEW.md (round 2)
**Iteration:** 2

**Summary:**
- Findings in scope: 1 (WR-01; IN-01 to IN-04 are out of scope by instruction)
- Fixed: 1
- Skipped: 0

Verification ran in the feat/193-quietview worktree checkout (the caller supplied the isolated worktree; no extra fixer worktree). Gates: `npx tsc --noEmit` exit 0; `npm run lint` 0 errors (2 pre-existing warnings in untouched files); `npx vitest run src/components/notes`, `HoldingDetail.test.tsx` and `DashboardNoteCard.test.tsx`: 9 files, 105 tests, 0 failed, 0 skipped.

## Fixed Issues

### WR-01: After a superseded save commits and the newer save fails, "Save failed — retry" cannot retry

**Files modified:** `src/components/notes/StrategyNoteCard.tsx`, `src/components/notes/HoldingNoteRow.tsx`, `src/components/notes/BridgeOutcomeNoteSection.tsx`, `src/app/(dashboard)/allocations/components/HoldingDetail.tsx`, and the four matching test files
**Commit:** 4770c0032
**Applied fix:** In each of the four blur handlers the skip branch is now `if (saveState !== "error" && !shouldSaveNoteOnBlur(draft, baseline))`. After a failed save the server state is unknown, so the user's retry blur sends the draft without consulting the predicate. The D-09 predicate, the round-1 in-flight baseline and the `loadError` fence are unchanged. With no prior failed save the skip path is untouched, so opening and leaving still writes nothing (D-10) and the existing D-10 tests stay green.
**Tests:** `StrategyNoteCard`, `HoldingNoteRow` and `BridgeOutcomeNoteSection` each replay the review's probe: hold `PATCH y`, send `PATCH x` and answer 429, release `y` with 200, assert "Save failed — retry" is still shown, then Edit and leave unchanged and assert a third PATCH carrying `x` and that the error label clears. `HoldingDetail` mocks the hook, so its test sets `saveState` to `"error"` and asserts that an unchanged blur sends the draft.
**Status:** fixed: requires human verification (logic fix; the tests replay the reviewed race, but a human should confirm that resending the draft on any blur while the state reads "error" is the wanted behaviour).

## Neuter evidence (restored byte-identical, checked with cmp)

- Fix neutered (the four components reset to their pre-fix source): 3 tests RED, one each in `StrategyNoteCard`, `HoldingNoteRow` and `BridgeOutcomeNoteSection`; `HoldingDetail.test.tsx` was neutered separately and its new test goes RED too (1 failed, 16 passed). Fix restored, all green.

## Known limits

- The fix re-sends on every blur while `saveState` is `"error"`, including a blur with an unchanged draft. That is the retry the label promises, and `saveState` leaves `"error"` once a save is accepted.

---

_Fixed: 2026-11-07T07:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 2_
