---
phase: 170-pagecopy
fixed_at: 2026-10-01
review_path: .planning/phases/170-pagecopy/170-REVIEW-SFH.md
topic: D (admin + marketing header silent failures)
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 170: Code Review Fix Report, topic D

**Fixed at:** 2026-10-01
**Source review:** `.planning/phases/170-pagecopy/170-REVIEW-SFH.md` (SFH-170-03, -04, -05)
**Branch:** `feat/170-fix-d`, off `37dfad67d`
**Iteration:** 1

**Summary:**
- Findings in scope: 3
- Fixed: 3
- Skipped: 0

**Where verification ran:** in the worktree `quantalyze-170-fd`. Its `node_modules` is a symlink to the main checkout's, so the gate versions are the main checkout's. Nothing was run in the main checkout.

## Fixed Issues

### SFH-170-03: the admin review-queue read swallowed its error and rendered "All caught up"

**Files modified:** `src/app/(dashboard)/admin/page.tsx`, `src/app/(dashboard)/admin/page.test.tsx` (new)
**Commit:** `1ef1d6e5f`
**Applied fix:** the page now checks the `error` of all four queue queries, not only pending strategies. All four share one `Promise.all` and had the same `?? []` swallow. On failure it logs `[admin] <query> query failed` with `{code, message}` and throws. The admin error boundary (`(dashboard)/admin/error.tsx`) then renders its "Something went wrong" state with the digest only. This is the same throw-on-error pattern as `src/lib/admin/match.ts`. `AdminTabs` is unchanged.
**Test:** a new `page.test.tsx` with a self-returning query-builder mock. A strategies-query error must reject with the query name and log it. A contact_requests error must reject. All queries succeeding must render without logging.
**Neuter:** `if (res.error)` changed to `if (false && res.error)` → `2 failed | 1 passed (3)`, both error cases. Restored from the byte backup → `3 passed`.

### SFH-170-04: the masthead session read swallowed every exception silently

**Files modified:** `src/components/marketing/MarketingHeaderActions.tsx`, `src/components/marketing/MarketingHeaderActions.test.tsx`
**Commit:** `198b61e89`
**Applied fix:** the catch now calls `unstable_rethrow(err)` from `next/navigation` first. This follows `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/unstable_rethrow.md`, which names `cookies()`, and `createClient` calls `cookies()`. It then logs `"[marketing-header] session read failed"` with the error message only (no stack, no cookie or session object), then falls back to the documented signed-out links. The anonymous `error` return path (`AuthSessionMissingError`) stays unlogged.
**Tests:**
- A real `redirect()` thrown from inside `createClient` must reject with a `NEXT_REDIRECT` digest.
- The two rejection cases now assert the log line.
- A new case asserts that the anonymous error return logs nothing.

**Neuters:**
- A: replaced `unstable_rethrow(err)` with a no-op → `1 failed | 6 passed (7)` (the rethrow case).
- B: replaced the `console.error(` call with a no-op function → `2 failed | 5 passed (7)` (both log assertions).
- An earlier version of B produced a transform error ("no tests"). It was discarded and not counted as RED.

Each neuter was restored from a byte backup → `7 passed`. The restore was confirmed by grepping the fix lines.

### SFH-170-05: below 768px the open preferences panel still saved, and a confirmed recompute was dropped silently

**Files modified:** `src/components/admin/AllocatorMatchQueue.tsx`, `src/components/admin/PreferencesPanel.tsx`, `src/components/admin/AllocatorMatchQueue.test.tsx`
**Commit:** `1954ab17b`
**Applied fix:**
- `PreferencesPanel` takes a `readOnly` prop, which the queue passes. When it is set:
  - Save is `disabled`.
  - A `role="status"` notice shows "Read-only on mobile. Open on a tablet or desktop (768px or wider) to save preferences." This reuses the existing banner's wording.
  - `handleSubmit` refuses, because a disabled button does not stop an implicit or scripted submit.
- `handleRecompute` reads the current read-only state through a ref synced in an effect. The panel's post-save confirm runs from a `setTimeout` that closed over the submit-time render, so a viewport that crossed below md during the PUT was invisible to the closure. When the recompute is refused, it sets a `role="status"` notice ("Recompute did not run. Open on a tablet or desktop (768px or wider) to recompute the match queue."). The notice renders at every width and is cleared on the next `load()`. It does not go through `error`, because that state's early return would replace the whole queue with the error card for something that is not a failure.
- 170-06's below-md read-only behaviour is unchanged: CSS-hidden openers, `guard`, and the decision early returns.

**Test rewrite, recorded:** the existing case "below md, PreferencesPanel onRecomputeRequested does not POST recompute" submitted the form below md and waited for `confirm`. `confirm` fires only after a successful PUT, so that case asserted the defect (Save still writes below md) as the expected path. It is replaced by two cases:
- (A) Open at md, then narrow. Save becomes disabled, the panel's status notice is present, and a scripted submit issues no PUT, no confirm and no recompute.
- (B) Open at md and save at md, so the PUT goes out. Narrow before the 100 ms confirm, which then returns true. The visible notice must appear, outside any `hidden` class, and no recompute POST is issued.

**Neuters:** each was restored from a byte backup, then confirmed by grepping all four fix lines → `24 passed`.

| Neuter | What was removed | Result | Failing case |
|---|---|---|---|
| N1 | The Save gate and the submit guard | `1 failed \| 23 passed` | (A) |
| N1b | The submit guard only, Save still disabled | `1 failed \| 23 passed` | (A) |
| N2 | The live ref, closure `readOnly` only | `1 failed \| 23 passed` | (B), because the stale closure POSTs the recompute |
| N3 | The notice, so the return is silent again | `1 failed \| 23 passed` | (B) |

## Gates (worktree)

- `npx eslint` on all six touched files: clean.
- `npx tsc --noEmit -p .` (whole project): 0 `error TS` lines.
- `npx vitest run src/components/admin src/app/demo "src/app/(dashboard)/admin" src/components/marketing`: `16 passed (16)` files, `103 passed (103)` tests.

## Not fixed here (out of topic-D scope)

- The review's SFH-170-05 recommendation also names the `handleDecision` early return (`AllocatorMatchQueue.tsx`, `if (readOnly) return;`). The brief limits this topic to Save and the recompute. Decision controls are CSS-hidden below md and the keyboard path is `guard`ed, so no open surface reaches that return below md. It is left as it was.

---

_Fixed: 2026-10-01_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
