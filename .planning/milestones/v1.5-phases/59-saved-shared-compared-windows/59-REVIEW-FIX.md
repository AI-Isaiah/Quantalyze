---
phase: 59-saved-shared-compared-windows
fixed_at: 2026-07-02T12:05:00Z
review_path: .planning/phases/59-saved-shared-compared-windows/59-REVIEW.md
iteration: 3
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 59: Code Review Fix Report (cumulative — iterations 1 + 3)

**Fixed at:** 2026-07-02T12:05:00Z
**Source review:** .planning/phases/59-saved-shared-compared-windows/59-REVIEW.md
**Iteration:** 3 (final)

**Summary (cumulative):**
- Findings in scope: 6 — iteration 1: 2 Critical + 3 Warning; iteration-2
  re-review: 1 new Warning (fix_scope=critical_warning; the re-review's 2 Info
  findings IN-01/IN-02 are out of scope and untouched)
- Fixed: 6
- Skipped: 0

Every fix carries a regression test proven RED without the fix (stash/pop or
mutation simulation) and GREEN with it. Acceptance before each commit: touched
suites green, `npx tsc --noEmit` clean, eslint clean, full
`npm run test:coverage` (blocking ratchet) green. Frozen engine untouched
across all iterations (`src/lib/scenario.ts` / `src/lib/scenario-window.ts`
byte-unchanged).

## Fixed Issues

### WR-01 (re-review, iteration 3): drifted-reopen seed divergence — displayed window ≠ persisted window

**Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`, `src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx`
**Commit:** 79ef3a14
**Applied fix:** Both reachable divergence states are closed at the shared root
cause the review named ("the local seed is a cached mirror of the draft window
with no invalidation when the draft window disappears out from under it"):

1. **Drifted reopen** — `openSavedScenario` now decides drift SYNCHRONOUSLY
   (`decoded.value.init_holdings_fingerprint !==
   defaultDraft.init_holdings_fingerprint` — the exact predicate the hook's
   `storedMismatch` derives on the next render; `defaultDraft` carries the
   live fingerprint by construction) and on drift **leaves the window view
   state untouched** in BOTH the `ok` and `readonly` branches. Deliberate
   adaptation of the review's suggested `resetWindowToDefaultOnReopen()`:
   when the pre-open working draft was already the identity-stable default
   (fresh session), `selectedSpans` keeps its identity, the WINDOW-01
   auto-default effect would NOT re-fire after a reset, and the readout would
   fall to "All history" instead of the intersection. "Untouched" is the
   correct drift semantics — the working draft did not change, so its window
   context (the intersection auto-default, or invalidation via #2 below) must
   not change either. The provenance note is suppressed on drift (a note
   explaining a draft that was NOT applied would be dishonest; the drift
   banner is the honest signal — same rationale as the iteration-1 WR-03 fix).
2. **Seed invalidation (cross-tab reset + drift-over-windowed-draft)** — a new
   effect watches `scenario.draft.window` and clears the local seed
   (`winStart`/`winEnd` + un-touch `windowTouchedRef`) whenever the draft's
   window transitions set → absent out from under it (cross-tab adoption of a
   windowless draft after a tab-B reset+edit; a drifted open replacing a
   windowed working draft; a live-holdings flip to the default). Defined
   BEFORE the WINDOW-01 effect so the auto-default re-seeds the intersection
   in the SAME commit (React runs effects in definition order) — identical
   semantics to `handleReset`. Local view state only: it never writes
   `draft.window`, so the CR-01 no-feedback-loop invariant (scrutiny point b)
   is preserved. Note the primitive ignores a bare cross-tab `removeItem`
   (null-newValue clears, cross-tab.ts:485) — the review's divergence arises
   on the follow-up windowless WRITE from the other tab, which is exactly
   what the invalidation handles.
3. The now-stale `coverageWindow` comment (which documented the buggy "owner's
   window on a drifted reopen" fallback as intended) was corrected.

Regression tests (both proven RED with the composer fix stashed):
- `T_WIN_SAVE4` — drifted reopen of a v3 row carrying a window only the saved
  draft can produce ([01-02, 01-05], strictly inside the intersection): the
  drift banner is up, the readout stays on the intersection default (does NOT
  show the owner's window), and "Update portfolio" PUTs a draft with NO
  `window` key — the save matches what is displayed (T_WIN_SAVE2 contract:
  the intersection default is never force-persisted). Pre-fix failure:
  readout showed `01-02 → 01-05` over a windowless working draft.
- `T_WIN_SAVE5` — apply the union window via the REAL Full-range preset, let
  the 150ms autosave debounce settle (so flush-before-adopt does not cement
  the local write), then dispatch a cross-tab StorageEvent adopting a
  WINDOWLESS fingerprint-current draft: the stale union seed is invalidated
  and the readout falls back to the intersection default. Pre-fix failure:
  readout stayed at the union `01-01 → 01-12` — a window no save would
  persist.

Constraints held: CR-01 write-through, the non-drifted verbatim-seed reopen
(T_WIN_SAVE3), and all iteration-1 pins stay green (ScenarioComposer.test.tsx
+ save.test.tsx + useScenarioState.hydrate.test.tsx + scenario-state.test.ts:
215/215); frozen engine untouched; coverage ratchet green.

**Documented behavior deltas (intentional, within the finding's honesty class):**
- A drifted upgraded-v2 reopen no longer raises the provenance note (it
  previously could claim "showing the common period" over a default draft the
  note does not describe). The drift banner covers this state.
- A drifted reopen when the session's working draft was already the default
  keeps the pre-open window view (intersection default) rather than
  re-deriving it — same displayed value, no state churn.

### CR-01 (iteration 1): The coverage window is never written into the saved draft (PERSIST-01 write path missing)

**Files modified:** `src/app/(dashboard)/allocations/lib/scenario-state.ts`, `src/app/(dashboard)/allocations/lib/scenario-state.test.ts`, `src/app/(dashboard)/allocations/hooks/useScenarioState.ts`, `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`, `src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx`
**Commit:** bd1b2c24
**Applied fix:** Root-cause alternative (option b): `setWindow(draft, window)`
pure transform (the ONE production writer of `draft.window`, M9 same-window
no-op), exposed via `useScenarioState` (`baseOf`-rebased), wired into the
composer's `applyWindow` gesture path so autosave/save/share/compare all carry
the applied window. `coverageWindow` prefers `scenario.draft.window` over the
local seed. Reopen uses a LOCAL-ONLY seeder (`seedWindowLocal`). The WINDOW-01
intersection auto-default deliberately never writes the draft. Tests:
T_WIN_SAVE1 (preset → POST carries exactly the applied union), T_WIN_SAVE2
(untouched → windowless draft), T_WIN_SAVE3 (reopen → PUT round-trips
verbatim) + pure-transform pins. Verified RESOLVED by the iteration-2
re-review.

### CR-02 (iteration 1): The re-baselined frozen-spine content pin is vacuous

**Files modified:** `src/__tests__/phase-29-frozen-spine-guards.test.ts`
**Commit:** a24f324c
**Applied fix:** Pin asserts the OPERATIVE guard line verbatim
(`IF payload_text ~ 'api_key|allocated_amount|account_balance|value_usd' THEN`)
plus a >= 3 occurrence-count belt-and-braces. Non-vacuity proven by mutation
simulation (guard-line deletion and field-drop both fail the pin). Verified
RESOLVED by the iteration-2 re-review.

### WR-01-prior (iteration 1): `handleReset` leaves the prior open's window on the fresh draft

**Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`, `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
**Commit:** c2029554
**Applied fix:** `handleReset` calls `resetWindowToDefaultOnReopen()` so the
WINDOW-01 auto-default re-seeds the intersection for the fresh live-book
draft. Regression test proven red without the fix. Verified RESOLVED by the
iteration-2 re-review.

### WR-02-prior (iteration 1): Provenance-note dismissal survives a same-scenario reopen

**Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`, `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
**Commit:** 7ee7483b (grouped with WR-03-prior — same render surface)
**Applied fix:** Per-open nonce (`provenanceOpenNonceRef`, bumped on every
COMPLETED open, after the reset-outcome refusal) combined with the scenario id
in the note's key — every open remounts a fresh, un-dismissed note. Verified
RESOLVED by the iteration-2 re-review.

### WR-03-prior (iteration 1): Note claims "showing the common period" when no common period exists

**Files modified:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx`, `src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx`
**Commit:** 7ee7483b (grouped with WR-02-prior)
**Applied fix:** Render gate `&& commonPeriodWindow` suppresses the note
exactly when the intersection is empty (union path); the Phase-57
empty-intersection banner still guides the user. Verified RESOLVED by the
iteration-2 re-review.

## Skipped Issues

None. (The iteration-2 re-review's IN-01 — structurally unvalidated windows in
`setWindow` — and IN-02 — window-only edits not counting as "dirty" for the
mode-switch confirm — are Info-severity and outside `fix_scope:
critical_warning`; deliberately not touched.)

## Verification (iteration 3)

- RED proof: both T_WIN_SAVE4 and T_WIN_SAVE5 fail with the composer fix
  stashed (T_WIN_SAVE4: readout shows the owner's `01-02 → 01-05`;
  T_WIN_SAVE5: readout stuck at the stale union `01-01 → 01-12`); green with
  it.
- Suites: ScenarioComposer.save.test.tsx 15/15, ScenarioComposer.test.tsx +
  useScenarioState.hydrate.test.tsx + scenario-state.test.ts 200/200.
- `npx tsc --noEmit` clean; eslint clean on both touched files.
- Full `npm run test:coverage` (blocking ratchet) green.
- Frozen engine untouched (git status: only the two intended files modified).

## Commits (cumulative)

| Finding | Iteration | Commit | Message |
|---|---|---|---|
| CR-01 | 1 | bd1b2c24 | fix(59): CR-01 persist the applied coverage window into the saved draft |
| CR-02 | 1 | a24f324c | fix(59): CR-02 pin the OPERATIVE shares leak-scan guard line, not the bare alternation |
| WR-01-prior | 1 | c2029554 | fix(59): WR-01 Reset clears the reopened scenario's coverage window |
| WR-02-prior + WR-03-prior | 1 | 7ee7483b | fix(59): WR-02+WR-03 ProvenanceNote per-open remount + honest empty-intersection suppression |
| WR-01 (re-review) | 3 | 79ef3a14 | fix(59): WR-01 drifted reopen must not display a window the save would not persist |

---

_Fixed: 2026-07-02T12:05:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 3_
