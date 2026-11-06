---
phase: 170
fixed_at: 2026-10-01
review_path: .planning/phases/170-pagecopy/170-REVIEW.md
iteration: 1
topic: C
findings_in_scope: 2
fixed: 2
skipped: 0
status: all_fixed
---

# Phase 170: Code Review Fix Report, topic C (round 1)

**Fixed at:** 2026-10-01
**Source review:** `.planning/phases/170-pagecopy/170-REVIEW.md`
**Iteration:** 1
**Scope:** WR-01 and WR-03, as assigned by the orchestrator. Topics A, B and D are handled by sibling fixers and are not covered here.

**Summary:**
- Findings in scope: 2
- Fixed: 2
- Skipped: 0

## Fixed Issues

### WR-01: Tweaks toggle moved to the header but the dialog stays at the end of the DOM

**Files modified:** `src/app/(dashboard)/allocations/components/Tweaks.tsx`, `src/app/(dashboard)/allocations/components/TweaksToggle.tsx`, `src/app/(dashboard)/allocations/components/Tweaks.test.tsx`
**Commit:** `7b8ec0e83`
**Applied fix:**
- `Tweaks` focuses its first control (the × button) when it opens.
- When it closes, focus returns to `[data-tweaks-toggle]`, but only if focus was inside the panel or fell to `<body>` as the panel unmounted. If focus is already somewhere else, for example in a composer input when Escape is pressed, it stays there.
- The panel has a stable id, `TWEAKS_PANEL_ID`. The toggle now carries `aria-expanded`, and `aria-controls` only while the panel exists, so it never points at an id that isn't in the DOM.
- `aria-pressed` is kept because the AD-05 pressed styling uses `aria-pressed:` variants. Announcing both pressed and expanded is redundant but valid.
- I chose focus management over moving `<Tweaks />` into the header row. It fixes the reported failure without putting a `fixed` element inside an action-row ancestor.

**Tests:** five cases in a harness that copies the real DOM order (toggle, unrelated controls, then the panel), driven by `@testing-library/user-event`:
- opening from the keyboard moves focus into the panel, and the next Tab stays inside it
- Escape returns focus to the toggle
- × returns focus to the toggle
- an Escape pressed after focus has left the panel does not pull focus back
- `aria-expanded` and `aria-controls` are set correctly

An outside-click case is also pinned. It passes with or without the guard, because React applies the close inside `mousedown` and the browser moves focus afterwards. It stays as a regression check on what the user sees, and the guard's own neuter is caught by the Escape-from-outside case instead.

**Neuters** (cp byte backup → edit → run → cp restore, `cmp`-verified identical, never `git checkout --`):

| Neuter | Result |
|---|---|
| Old code (before the fix) | RED, 3 failing: focus-in on open, × return, aria |
| Remove both `.focus()` calls | RED, 2 failing: focus-in on open, × return |
| Remove only the focus-return call | RED, 2 failing: Escape return, × return |
| Remove the outside-focus guard | RED, 1 failing: Escape pressed from outside the panel |
| Restored | GREEN, 41/41 |

### WR-03: "Final month (MMM YYYY)" appears on live strategies whenever the last daily is in the previous month

**Files modified:** `src/app/factsheet/[id]/v2/MetricsColumn.tsx`, `src/app/factsheet/[id]/v2/MetricsColumn.final-month.test.tsx`, `DESIGN.md`, `.planning/phases/170-pagecopy/170-CONTEXT.md`
**Commit:** `ec46d20aa`
**Status:** fixed (label logic; orchestrator decision applied as given)
**Applied fix:**
- `monthRowLabel` now counts how many UTC calendar months the record's last month lies behind `now`, with years included, so December to January counts as one month:
  - 0 months behind, or a future `end`: `Month-to-date`
  - 1 month behind: `Last month (MMM YYYY)`
  - 2 or more months behind: `Final month (MMM YYYY)`
- The fallback for an empty or unparseable `end`, the value, and 169-05's em-dash lock are unchanged.
- **CONTEXT:** added one dated bullet, "WR-03 amendment (2026-10-01) to the 170-13 month-row label", in the 2026-09-30 orchestrator-decisions section. It is labelled as a review fix, not a `GC-0n` gap. CONTEXT had no standalone 170-13 decision block; line 14 is its only other mention.
- **DESIGN.md:** a dated "Amended 2026-10-01" sentence is appended to the existing AD-10 Decisions Log row; the original text is kept. The row's old objection to "Last month" (that it reads as the calendar's previous month) is now the reason to use it, because that is exactly when the label appears.
- **ROADMAP:** the deviation policy wants a matching dated line in the ROADMAP too. This fixer was told not to edit the ROADMAP, so **that line is the orchestrator's to add.**

**Tests:**
- The old "1 Sep, record ending 31 Aug" case now expects `Last month (Aug 2026)`.
- New cases:
  - the review's own example: 30 Sep record, 1 Oct clock → `Last month (Sep 2026)`
  - a month-start weekend: last daily Fri 2026-10-30, clocks Sun 11-01 and Mon 11-02 → `Last month (Oct 2026)`
  - the year boundary: 2025-12-31 record, 2026-01-01 clock → `Last month (Dec 2025)`
  - two months behind: 31 Aug record, 1 Oct clock → `Final month (Aug 2026)`
- `MetricsColumn.window-rows.test.tsx:137,146` and `MetricsColumn.record-length.test.tsx:171` still pin `Final month (Jun 2024)`. I checked them and left them unchanged: neither file fakes the clock, and June 2024 is always at least two months back, so the pins stay correct under the new rule.

**Neuters** (same protocol as WR-01):

| Neuter | Result |
|---|---|
| Old helper (before the fix) | RED, 4 failing: 1st of month, review case, month-start weekend, year boundary |
| Previous month labelled "Final" | RED, the same 4 |
| Two or more months back labelled "Last" | RED, 3 failing: Jun 2024 record, two months back, em-dash lock |
| Restored | GREEN, 10/10 |

## Verification

All gates ran in the isolated worktree `quantalyze-170-fc` (branch `feat/170-fix-c`, base `37dfad67d`), not in the main checkout.

- `npx tsc --noEmit -p .`: 0 errors.
- `npx eslint` on all 5 touched source and test files: exit 0.
- `npx vitest run` on `src/app/factsheet/[id]/v2`, `AllocationsTabs*` and `components/Tweaks*`: 67 files, 707/707 passed after both commits.
- One earlier run of the v2 directory had two 5 s timeouts in `MetricsColumn.record-length.test.tsx` (the 4-year and 6-year records). The load average was 64 at the time because sibling fixers were running. The file passed 16/16 on its own, and the full rerun above was green.
- Not run: the full test suite, and the e2e and visual lanes (topic B owns `e2e/**`).

---

_Fixed: 2026-10-01_
_Fixer: Claude (gsd-code-fixer), topic C_
_Iteration: 1_
