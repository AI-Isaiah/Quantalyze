---
phase: 08-connection-management-and-notes
fixed_at: 2026-04-21T00:00:00Z
review_path: .planning/phases/08-connection-management-and-notes/08-REVIEW.md
iteration: 1
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 08 Plan 05: Code Review Fix Report

**Fixed at:** 2026-04-21T00:00:00Z
**Source review:** .planning/phases/08-connection-management-and-notes/08-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 2 (Critical: 0, Warning: 2)
- Fixed: 2
- Skipped: 0
- Info findings (4): deferred, out of scope for this fix pass.

## Fixed Issues

### WR-01: Unvalidated JSON shape coerced via `as string` assertions

**Files modified:** `src/components/notes/HoldingNoteRow.tsx`
**Commit:** 239de0e
**Applied fix:** Replaced the untyped `await res.json()` + `as string | undefined` / `as string` casts in the 200 branch with a runtime-validated unwrap: `const json: unknown = await res.json();` then narrow to `Record<string, unknown>` and guard each consumed field with `typeof ... === "string"`. `content` now defaults to `""` and `updated_at` now defaults to `null` when the server returns a malformed body, so neither `NoteRender` nor `new Date(...)` can be fed a non-string value. Scope was intentionally kept narrow to `HoldingNoteRow.tsx` per orchestrator guidance — the parallel unsafe pattern in `BridgeOutcomeNoteSection.tsx` and `NotesWidget.tsx` is tracked as notes-family consolidated debt for a future plan, not this fix pass.

### WR-02: Mount GET ignores non-200 / non-404 status codes (500, 401, 403) — silent empty read state

**Files modified:** `src/components/notes/HoldingNoteRow.tsx`, `src/components/notes/HoldingNoteRow.test.tsx`
**Commit:** f0808f2
**Applied fix:** Collapsed the `else if (!cancelled && res.status === 404)` branch into `else if (!cancelled)` so every non-OK status (401/403/404/429/500/502/503/504/...) routes through the same recovery sink as the catch block — `setEditing(true)`. This matches the invariant already used by the catch/network-error path: any read failure ⇒ empty edit mode so the user is never blocked, and `NoteSaveStatus` surfaces the real error on first blur. Added 2 regression tests (500 and 401) that assert the loading gate resolves to an empty edit-mode textarea instead of a silent empty read view. All 17 tests in `HoldingNoteRow.test.tsx` pass (15 existing + 2 new). This invariant also makes the IN-01 "implicit editing default" observation explicit — every reachable branch now demonstrably calls `setEditing` before the `finally` flips `initialLoaded`.

## Skipped Issues

None — both in-scope Warning findings were fixed.

---

_Fixed: 2026-04-21T00:00:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
