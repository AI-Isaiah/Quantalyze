---
phase: 59-saved-shared-compared-windows
reviewed: 2026-07-02T09:37:19Z
depth: standard
files_reviewed: 9
files_reviewed_list:
  - src/app/(dashboard)/allocations/lib/scenario-state.ts
  - src/app/(dashboard)/allocations/lib/scenario-state.test.ts
  - src/app/(dashboard)/allocations/hooks/useScenarioState.ts
  - src/app/(dashboard)/allocations/components/ScenarioComposer.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.test.tsx
  - src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx
  - src/app/(dashboard)/allocations/components/ProvenanceNote.tsx
  - src/__tests__/phase-29-frozen-spine-guards.test.ts
  - supabase/tests/test_scenario_shares_rls.sql
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 59: Code Review Report — Iteration 2 (re-review after fixes)

**Reviewed:** 2026-07-02T09:37:19Z
**Depth:** standard
**Files Reviewed:** 9
**Status:** issues_found (no blockers; 1 new warning + 2 info)

## Summary

Re-review of the fix range `eea807a4..HEAD` (commits bd1b2c24, a24f324c, c2029554, 7ee7483b) against the five iteration-1 findings. **All five prior findings are genuinely resolved at root, not band-aided**, and each fix carries a pinning test. The frozen engine is untouched (no `src/lib/scenario.ts` diff in range); no new dependency; changes are presentation/persistence only.

One NEW warning was found in the CR-01 fix: the composer-local window seed (`winStart`/`winEnd`) can outlive the `draft.window` it mirrors, producing a displayed-window ≠ persisted-window divergence on a **drifted** (fingerprint-mismatched) reopen and on a cross-tab reset — the exact disclosure-honesty invariant class the fix exists to protect, though bounded to states where the mismatch banner is already up. Two info items round out the report.

## Prior-Finding Verification

### CR-01 (PERSIST-01 write path missing) — RESOLVED
- **Pure transform:** `setWindow` (`scenario-state.ts:562-578`) is the sole production writer of `draft.window`, immutable, defensive-copied, M9 no-op on same window (no `lastEditedAt` / autosave churn). Unit-tested including codec round-trip at v3 (`scenario-state.test.ts` `describe("setWindow")`).
- **(a) Gesture coverage:** every window-changing gesture routes through `applyWindow` (`ScenarioComposer.tsx:1911`), which calls both `seedWindowLocal` and `scenario.setWindow`: Common-period preset (:3176), Full-range preset (:3195), CustomRangePicker apply (:3216), ProvenanceNote "Show full range" (:3113), DefaultChangeNote "Show full range" (:3127), and the Phase-58 include-cost button (:3893). No other writer of `winStart`/`winEnd` exists besides `seedWindowLocal`, `resetWindowToDefaultOnReopen`, and the WINDOW-01 auto-default effect.
- **(b) No feedback loop:** the auto-default effect (:1843) writes only local view state and is gated by `windowTouchedRef`; nothing reactively writes `draft.window` (gestures only), and `setWindow`'s same-window no-op prevents identity churn. Traced draft.window → coverageWindow → engineState: pure memo chain, no effect writes back.
- **(c) Untouched window saves windowless:** the auto-default never calls `scenario.setWindow`; T_WIN_SAVE2 pins `"window" in body.draft === false` while the intersection default is visibly showing. Confirmed no other path writes the auto-default into the draft.
- **(d) seedWindowLocal desync:** holds on all non-drifted paths (`coverageWindow` prefers `draft.window`, :1865-1869) — but see **WR-01 below** for the drifted-reopen / cross-tab gap.
- **(e) Autosave carries the window:** `setWindow` → `setValue` → the cross-tab primitive's debounced persist encodes the SAME draft object the POST/PUT handlers send (`postNewScenario` :1342, `putUpdateScenario` :1384 both serialize `scenario.draft`). The v3 zod schema includes `window` (`scenario-state.ts:645`), round-trip pinned.
- Tests T_WIN_SAVE1 (preset → POST carries exactly the applied union window, distinct from the intersection default) and T_WIN_SAVE3 (reopen v3-with-window → PUT round-trips verbatim) drive the REAL gesture → save path. Mock hygiene is correct (per-test allocator keys per the WINDOW-06 flake lesson; `afterEach` restores the adapter mock).

### CR-02 (vacuous frozen-spine pin) — RESOLVED
The pin now asserts the operative guard line verbatim: `IF payload_text ~ 'api_key|allocated_amount|account_balance|value_usd' THEN`. Verified against `supabase/tests/test_scenario_shares_rls.sql`: the string matches line 244 exactly (substring match is indentation-tolerant), and the three alternation occurrences (header comment L15, operative IF L244, RAISE message L246) satisfy the `>= 3` belt-and-braces count exactly. A comment or exception message can no longer satisfy the pin; weakening or deleting the operative guard goes red. Not brittle against legitimate whitespace outside the pinned line itself — a reformat of the guard line fails loud, which is the intended reviewed-act semantics.

### WR-01-prior (reset left stale window) — RESOLVED
`handleReset` (:1091) now calls `resetWindowToDefaultOnReopen()` (clears `winStart`/`winEnd`, un-touches `windowTouchedRef`); `scenario.reset()` already replaced the draft with the windowless default, so `draft.window` is gone and the WINDOW-01 auto-default re-seeds the intersection for the fresh draft. Pinned by the new composer test (reopen narrow window `01-02→01-05` → Reset → readout returns to the intersection `01-01→01-06`).

### WR-02-prior (dismissal survived same-scenario reopen) — RESOLVED
Per-open nonce (`provenanceOpenNonceRef`, :851) bumped on every COMPLETED open (:1183, correctly placed after the reset-outcome refusal so a refused open resurrects nothing); the note key `` `${loadedScenarioId ?? "provenance"}-${nonce}` `` remounts it fresh even for the same id. A ref, not state — it cannot change on unrelated re-renders, so a dismissal is never reset spuriously. Pinned by the A→dismiss→reopen-A test.

### WR-03-prior (note copy wrong on empty intersection) — RESOLVED
Render gate `&& commonPeriodWindow` (:3110) suppresses the note exactly when `defaultWindowFor === null` (union path — the "showing the common period" copy would be false); when a common period exists the gate is truthy and the note renders (the pre-existing upgraded-v2 note test still passes unchanged). Pinned by the disjoint-span test, which also asserts the Phase-57 empty-intersection banner still guides the user.

## Narrative Findings (AI reviewer)

## Warnings

### WR-01: Stale composer-local window seed can outlive `draft.window` — displayed window diverges from the window a save persists (drifted reopen + cross-tab reset)

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1233-1234, 1865-1869, 1372-1403, 2826-2838`
**Issue:** `coverageWindow` falls back to the local seed when `draft.window` is absent (:1865-1869). Two reachable states make that fallback claim a window the persisted draft does not carry:

1. **Drifted reopen (the documented case, :1861-1864).** `openSavedScenario`'s "ok" branch seeds the owner's saved window `W` via `seedWindowLocal` (:1234) *regardless of fingerprint drift*. On drift, the hook's working draft is the windowless `defaultDraft` (`useScenarioState.ts:208`), so the readout and the engine compute the **default live-book composition at the owner's window W** (mixed provenance), while "Update portfolio" — which is NOT gated on `fingerprintMismatch` (:2826; `putUpdateScenario` :1373 checks only `loadedScenarioId`/`loadedReadonly`) — PUTs `scenario.draft` = the windowless default. The saved scenario's window `W` (and, pre-existing Phase-23 semantics, its composition) is silently dropped while the screen was showing `W`. This is precisely the disclosure-honesty desync class the CR-01 fix targets (scrutiny point d), surviving on the drift edge. The same applies to "Save as new portfolio" from a drifted or readonly open. Untested — all new reopen tests use fingerprint-matching drafts.
2. **Cross-tab reset.** Tab A applies window `W` (local seed = `W`, `draft.window = W`). Tab B resets; the storage sync adopts the windowless default into tab A's `value`, but nothing invalidates tab A's local seed — `coverageWindow` falls back to `W`, so tab A displays/computes at `W` over a windowless draft, and a save from tab A persists windowless.

Root cause is shared: the local seed is a cached mirror of the draft window with no invalidation when the draft window disappears out from under it.

**Fix:** Two complementary options; (i) is the smaller root fix:
```tsx
// (i) In openSavedScenario's "ok" branch, only seed the owner's window when the
// working draft will actually BE the saved draft (no drift):
const drifted =
  decoded.value.init_holdings_fingerprint !==
  computeHoldingsFingerprint(holdingsSummary as HoldingForFingerprint[]);
if (decoded.value.window && !drifted) {
  seedWindowLocal(decoded.value.window);
  setShowProvenanceNote(false);
} else { /* resetWindowToDefaultOnReopen() + provenance branch as today */ }
```
For (2), invalidate the seed when an adopted draft is windowless and the seed was draft-derived (or track "seed provenance" and clear it whenever `draft.window` transitions W → absent). Alternatively (broader): disable "Update portfolio" while `scenario.fingerprintMismatch` is up — the PUT in that state always overwrites the saved scenario with the default draft, which is questionable independent of windows. Add a drifted-reopen test either way.

## Info

### IN-01: `setWindow` accepts structurally unvalidated windows (no `start <= end` / ISO-shape check)

**File:** `src/app/(dashboard)/allocations/lib/scenario-state.ts:562-578, 645`
**Issue:** Unlike the sibling transforms (which reject non-finite weights at entry), `setWindow` writes any `{start, end}` string pair; the zod schema only caps length at 32 chars, so an inverted or malformed window (e.g. localStorage tampering) round-trips the codec and reaches the engine. Degrades honestly (`covers()` fails → zero-member empty state, no crash), and all current call sites feed ranges from `scenario-window.ts` helpers or the picker — defensive gap only.
**Fix:** Reject in `setWindow` (return `draft` when `window.start > window.end` or either fails a `/^\d{4}-\d{2}-\d{2}$/` shape check), or add `.refine((w) => w.start <= w.end)` on the schema's `window` object.

### IN-02: A window-only edit is a persisted draft change but never counts as "dirty" — the entry-mode switch's discard-confirmation contract (Pitfall 5) does not cover it

**File:** `src/app/(dashboard)/allocations/components/ScenarioComposer.tsx:1114-1125`; `src/app/(dashboard)/allocations/hooks/useScenarioState.ts:308-326`
**Issue:** `handleEntryModeSelect` gates the reset-confirmation on `diffCount > 0`, and `diffCount` counts toggles/adds/user weights — not `draft.window`. A user who has ONLY applied a window (now a real persisted edit stamping `lastEditedAt`) switches modes with no confirm. Impact is soft: the stored blob (with the window) survives the mismatch until the next edit in the other mode, and toggling back restores it — but the :1109 comment's guarantee ("a mode switch that would DISCARD a dirty draft must route through the reset-confirmation, never a silent wipe") is no longer strictly true now that the window lives in the draft.
**Fix:** Either treat `draft.window !== undefined` as dirty for the mode-switch gate specifically (not for the Commit-enabling `diffCount` — a window is not a commit diff), or update the comment to document the accepted window-edit exception.

---

_Reviewed: 2026-07-02T09:37:19Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
_Iteration: 2 (re-review of eea807a4..HEAD — bd1b2c24, a24f324c, c2029554, 7ee7483b)_
