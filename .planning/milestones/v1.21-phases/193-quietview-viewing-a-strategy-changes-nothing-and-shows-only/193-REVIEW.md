---
phase: 193-quietview-viewing-a-strategy-changes-nothing-and-shows-only
reviewed: 2026-11-07T04:07:48Z
round: 3
diff_range: 41ab75f21..d59e3f6c4
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/components/notes/StrategyNoteCard.tsx
  - src/components/notes/HoldingNoteRow.tsx
  - src/components/notes/BridgeOutcomeNoteSection.tsx
  - src/app/(dashboard)/allocations/components/HoldingDetail.tsx
findings:
  critical: 0
  warning: 0
  info: 5
  total: 5
status: issues_found
---

# Phase 193: Code Review Report (round 3, final, note surfaces)

**Reviewed:** 2026-11-07T04:07:48Z
**Depth:** standard
**Files Reviewed:** 4 changed components. I also read `useNoteAutoSave.ts`, `should-save-note.ts`, `NoteSaveStatus.tsx`, the `/api/notes` PATCH handler, the four mount sites and the four changed test files. Those were read to trace the state machine and are not under review.
**Status:** issues_found (Info only. No BLOCKER and no WARNING.)

## Round 2 status

Round 2 ended `issues_found` with 1 WARNING and 4 INFO.

- **WR-01 (round 2): resolved.** Each of the four blur handlers now skips only when `saveState !== "error" && !shouldSaveNoteOnBlur(draft, baseline)`, at `StrategyNoteCard.tsx:73`, `HoldingNoteRow.tsx:270`, `BridgeOutcomeNoteSection.tsx:145` and `HoldingDetail.tsx:171`. After a failed save, the next blur sends the draft. Three tests replay the round-2 probe against the real hook, and the `HoldingDetail` test sets a mocked `"error"` state. The tests hold `PATCH y`, answer `PATCH x` with 429, release `y` with 200, then Edit and leave. They assert a third `PATCH x` and that the label clears.
- **IN-01 (round 2): partly addressed.** The new error-path tests assert the end state. The round-1 in-flight tests still stop after `releaseFirst`. See IN-03 below.
- **IN-02, IN-03, IN-04 (round 2):** out of scope this round and unchanged. They are not re-listed.

## Summary

I read `git diff 41ab75f21..HEAD` in full. The only commit after the fix commit is `d59e3f6c4`, which touches `TODOS.md` only. Gates at HEAD:
- `npx vitest run src/components/notes "src/app/(dashboard)/allocations/components/HoldingDetail.test.tsx"`: 8 files, 99 tests, all green.
- `npx tsc --noEmit`: exit 0.

I also ran a throwaway 4-test probe against `StrategyNoteCard` and the real hook. All 4 passed. I deleted it afterwards, and `git status --short` is empty.

The orchestrator's three questions, answered against the code:

- **Can any path now write on open-and-leave without an earlier user save failing (D-10)? No.** `saveState` becomes `"error"` only inside `save()` (`useNoteAutoSave.ts:93`, `:119`). `save()` has exactly four callers, the four blur handlers (`StrategyNoteCard.tsx:82`, `HoldingNoteRow.tsx:280`, `BridgeOutcomeNoteSection.tsx:155`, `HoldingDetail.tsx:181`).
  - Outside `"error"`, each handler still gates on the D-09 predicate. So the first save on any mount needs a draft the user changed, and only a failed save can produce `"error"`.
  - Seeds agree on every surface: draft equals persisted from props or the GET, and the editor is gated behind the load.
  - `saveState` cannot carry from one scope to another. Every mount site keys per scope: `HoldingsTable.tsx:1054` `Fragment key={row.id}` around `HoldingDetail`, `:721` `key={h.id}` around `HoldingNoteRow`, `OutcomesWidget.tsx:958` `key={o.id}`. `StrategyNoteCard` sits on the `/strategy/[id]` page segment, which remounts when the param changes.
  - `noteLoadError` and `loadError` can only be set by a load. A load with an earlier save is unreachable, so the bypass cannot meet a load-error state. The `if (loadError) return` fence also stays first.
- **Can an unchanged blur in `"error"` loop or spam (30/min limiter)? No loop.**
  - Each send needs a real user blur, and no write path refocuses the textarea: the focus effect fires only from `focusOnEditRef`, which only an Edit click sets.
  - Probe P3: with every PATCH answering 429, one Edit-and-leave sent exactly one PATCH. The count stayed put for 100 ms and the label stayed "Save failed — retry".
  - Probe P4: while the retry is `"saving"`, a further unchanged blur compares against `pendingSaveRef` and is skipped. A user can only add one PATCH per blur, and only while the state reads `"error"`.
  - A 5xx still gets the hook's single 2 s retry, which is unchanged.
- **Does the error label clear correctly? Yes.** A retry moves the state `error → saving → saved → idle`. The `"saved"` effect advances `persisted` to the value sent, which restores D-10. Probe P2: after a successful retry, "Note saved" shows, and a later unchanged Edit-and-leave sends nothing (`bodies` stays `["xy","xy"]`). A retry that fails again leaves the label up, which is correct.

No BLOCKER or WARNING remains. The five Info items are below. None of them is user-facing in a way that misleads the user, and none is a data-integrity defect. IN-01 is the only one with a decision attached.

## Info

### IN-01: After a failed first save, clearing the text and leaving now writes an empty row (spec wording only; not user-facing, not data-integrity)

**File:** `src/components/notes/StrategyNoteCard.tsx:73`, `src/components/notes/HoldingNoteRow.tsx:270`, `src/components/notes/BridgeOutcomeNoteSection.tsx:145`, `src/app/(dashboard)/allocations/components/HoldingDetail.tsx:171`; the write happens at `src/app/api/notes/route.ts` (`upsert` with `content: ""` plus a `user_note.*.update` audit event)
**Issue:** Probe P1 reproduced this sequence:
1. A scope with no note. The user types `a` and blurs, and `PATCH a` answers 429.
2. The user clicks Edit, clears the text and leaves.
3. The bypass sends `PATCH ""`. Before the fix, `shouldSaveNoteOnBlur("", "")` skipped it.

The D-09 override in `193-CONTEXT.md:30` says *"blurring an unchanged or never-saved blank draft still writes nothing"*. Read literally, this case breaks it. In substance it is the retry working as intended. After a final-attempt 5xx, or a superseded save, `a` may have committed, so sending `""` is the only way to make sure the server matches the empty editor. After a 429 nothing committed, and the write only leaves an empty row and an audit entry. The empty row renders as "no note", and `hasNote` in `HoldingsTable.tsx:797` reads a map that no caller fills in. D-10 holds, because this needs a save the user made and that failed.
**Fix:** No code change. A guard such as "skip a blank draft over a blank baseline even in error" would reopen the retry hole for the commit-unknown case. Per the deviation policy, add one line beside D-09 in `193-CONTEXT.md` and in the ROADMAP Phase 193 section: after a failed save, the next blur always sends the draft, a blank one included.

### IN-02: Two docblocks still describe the predicate as the only gate on a save

**File:** `src/components/notes/StrategyNoteCard.tsx:18-23`, `src/components/notes/should-save-note.ts:6-9`
**Issue:** `StrategyNoteCard` says *"a blur saves only when `shouldSaveNoteOnBlur` says the draft differs from what is persisted"*. `should-save-note.ts` says *"opening a note and leaving without typing never writes a row"*. Since 4770c0032, both are false after a failed save. The inline comments in the four handlers are accurate, so these two headers now contradict their own files.
**Fix:** Add one clause to each, for example: "…except after a failed save, when the next blur always resends the draft (the server state is unknown)."

### IN-03: The label-clears assertion would also pass in `"saving"`, and no test pins that D-10 returns after a successful retry

**File:** `src/components/notes/StrategyNoteCard.test.tsx` (WR-01 round 2 describe, last line), plus the same line in `HoldingNoteRow.test.tsx` and `BridgeOutcomeNoteSection.test.tsx`
**Issue:** `waitFor(() => expect(screen.queryByText("Save failed — retry")).toBeNull())` is also true while the retry reads "Saving…". It proves the label left `"error"`, not that the save was accepted. Nothing asserts what Probe P2 measured: after the successful retry, another unchanged Edit-and-leave writes nothing. That assertion is the one that pins "the bypass is scoped to `"error"`". The round-1 in-flight tests still stop after `releaseFirst`, which is round 2's IN-01 residual.
**Fix:** Assert `await screen.findByText("Note saved")`. Then Edit and leave once more and assert `bodies()` is unchanged.

### IN-04: The blur decision is still copied four times, and each fix round has had to patch all four

**File:** `src/components/notes/StrategyNoteCard.tsx:67-84`, `src/components/notes/HoldingNoteRow.tsx:261-284`, `src/components/notes/BridgeOutcomeNoteSection.tsx:136-157`, `src/app/(dashboard)/allocations/components/HoldingDetail.tsx:162-183`
**Issue:** The baseline choice, the error bypass and the skip-and-reset logic are byte-similar in four files. Rounds 1 and 2 each edited all four. `HoldingDetail`'s test mocks the hook, so it checks only its own copy of the branch, not the shared behaviour. The next change to this logic risks one copy drifting.
**Fix:** Optional. Move the decision into `should-save-note.ts` as one pure function, for example `blurDecision({ draft, persisted, pending, saveState }) → { send: boolean, baseline: string }`. Unit-test it once, and have the four handlers call it.

### IN-05: In `"error"`, the bypass resends after any failure status, including ones a retry cannot fix

**File:** same four lines as IN-01
**Issue:** The bypass does not check why the save failed. After a 403, for example when the strategy is no longer published, or a 400 for an oversize body, every Edit-and-leave sends another doomed PATCH and keeps "Save failed — retry" up. After a 429, each blur makes another request against the limiter. Before the fix, a changed draft was already resent in all these cases, so this adds only the draft-equals-baseline blur. It is user-driven, one request per blur, with no loop (P3). A related point: while the state reads `"error"`, an unchanged Edit-and-leave now overwrites a newer value written from another device. That is the same last-writer-wins behaviour that every blur had before Phase 193.
**Fix:** None needed for this phase. If wanted later, have the hook expose the failure status and keep the bypass to commit-unknown failures (network, 5xx, or a superseded save). That belongs with round 2's IN-04 (serialise saves per scope), not here.

---

_Reviewed: 2026-11-07T04:07:48Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
