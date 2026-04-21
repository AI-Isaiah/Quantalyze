---
phase: 08-connection-management-and-notes
plan: "05"
subsystem: notes
tags: [notes, holdings, read-back, gap-closure, phase-08, manage-05]
dependency_graph:
  requires: [08-04]
  provides: [holding-scope-note-read-back]
  affects: [HoldingNoteRow, HoldingsTable.test]
tech_stack:
  added: []
  patterns: [lazy-fetch-on-mount, cancelled-flag-cleanup, loading-gate]
key_files:
  created: []
  modified:
    - src/components/notes/HoldingNoteRow.tsx
    - src/components/notes/HoldingNoteRow.test.tsx
    - src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx
decisions:
  - "Option (a) — in-row lazy GET — shipped. Option (b) (server-side widening of getMyAllocationDashboard) explicitly deferred to Phase 11+."
  - "HoldingNoteIconButton state remains driven by notesByHoldingScopeRef prop from HoldingsTable; icon stays outlined until the user opens the sub-row once. This is accepted tech debt and does NOT reopen MANAGE-05 — the lived-experience gap (saved content appears lost on re-open) is closed."
  - "Test harness change: beforeEach in HoldingNoteRow.test.tsx defaults fetchSpy to 404 so existing tests' empty-state assertions still hold after passing through the loading gate."
  - "HoldingsTable.test.tsx T18+T19 updated to expect 2 fetch calls (mount GET + blur PATCH); Rule 1 auto-fix."
metrics:
  duration: "6m"
  completed: "2026-04-21T09:08:36Z"
  tasks_completed: 3
  files_changed: 3
---

# Phase 08 Plan 05: Holding-Note Read-Back Gap Closure Summary

**One-liner:** Holding-scope note read-back shipped via in-row lazy GET (mirrors BridgeOutcomeNoteSection). MANAGE-05 now fully satisfied.

## What Was Built

`HoldingNoteRow` previously seeded its state from `props.initialContent=""` (always empty because `HoldingsTable`'s `notesByHoldingScopeRef` prop was never populated by `AllocationDashboard`). Saved notes appeared lost to the allocator on every sub-row re-open.

This plan adds a single `useEffect` with a cancelled-flag cleanup that fires `GET /api/notes?scope_kind=holding&scope_ref=<encoded>` on mount — the same pattern already verified in `BridgeOutcomeNoteSection`. The server returns 200+content (→ read mode, note visible) or 404 (→ empty edit mode). A loading gate (`Loading…` inside the `<tr><td>` shell) is shown before the fetch resolves.

## Files Touched

| File | Change |
|------|--------|
| `src/components/notes/HoldingNoteRow.tsx` | Add `useEffect` lazy GET, loading gate, `initialSavedAt` state |
| `src/components/notes/HoldingNoteRow.test.tsx` | 4 new RED→GREEN regression tests + updated existing tests |
| `src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx` | Rule 1 auto-fix: T18+T19 updated for 2 fetch calls |

## Commits

| SHA | Type | Description |
|-----|------|-------------|
| `2eb38f9` | test (RED) | Add failing regression tests for holding-note read-back |
| `278c819` | feat (GREEN) | Lazy-fetch holding-scope note on HoldingNoteRow mount |

Task 3 is verification-only — no third commit.

## Test Results

| Suite | Before | After |
|-------|--------|-------|
| HoldingNoteRow.test.tsx | 11 pass | 15 pass (0 fail) |
| HoldingsTable.test.tsx | 14 pass | 14 pass (0 fail) |
| Full `npm test` | 1535 pass / 158 files | 1539 pass / 158 files |
| `npm run typecheck` | 0 errors | 0 errors |
| `npm run lint` | 18 warnings | 18 warnings (0 new) |

## Verification Gap Status

**VERIFICATION.md gaps[0] — CLOSED.**

- `grep -c 'useEffect' src/components/notes/HoldingNoteRow.tsx` → 2
- `grep -c '/api/notes?scope_kind=holding&scope_ref=' src/components/notes/HoldingNoteRow.tsx` → 1
- `grep -c 'cancelled = true' src/components/notes/HoldingNoteRow.tsx` → 1
- `grep -c 'Loading' src/components/notes/HoldingNoteRow.tsx` → 2

Human-verification probes 2–4 from VERIFICATION.md remain unchanged — they are manual QA items not affected by this plan.

## Decisions Made

1. **Option (a) — in-row lazy GET — shipped.** Option (b) (server-side widening of `getMyAllocationDashboard` to prefetch `notesByHoldingScopeRef`) explicitly deferred to Phase 11+ per CLAUDE.md "minimal impact" rule. Option (a) closes the lived-experience gap (re-open shows saved content) with ~40 new lines and zero surface widening.

2. **Icon-state follow-up deferred.** `HoldingNoteIconButton` state (solid vs. outlined) is still driven by `notesByHoldingScopeRef` from `HoldingsTable` — always `{}` by default, so the icon remains outlined until the user opens the sub-row. This is accepted tech debt. The lived-experience gap (saved content appears on re-open) is closed; the icon-state nuance is a Phase 11+ follow-up.

3. **Test harness change.** `beforeEach` in `HoldingNoteRow.test.tsx` now defaults `fetchSpy` to `makeResponse(404)` so all existing tests thread through the loading gate and reach their expected empty-textarea state. Individual tests that need 200 override with `mockResolvedValueOnce`.

4. **HoldingsTable.test.tsx T18+T19 updated (Rule 1 auto-fix).** The test previously expected `fetchSpy` called 1 time (the PATCH). With the mount GET added, it is called 2 times. Test updated to queue 404→200 and check `calls[1]` for the PATCH shape.

## Deferred Items

| Item | Reason | Target |
|------|--------|--------|
| Option (b) server-side prefetch in `getMyAllocationDashboard` | Widens AllocationDashboard data pipeline; larger surface change; minimal-impact rule | Phase 11+ |
| `HoldingNoteIconButton` solid-fill when note exists before sub-row opened | Requires populating `notesByHoldingScopeRef` from server | Phase 11+ (same as option b) |

## Known Stubs

None. The lazy GET wires to the live `/api/notes` route and the server returns real DB content. No placeholder data flows to the UI.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. The new GET call uses the same trust boundary as `BridgeOutcomeNoteSection` (already verified in VERIFICATION.md as T-08-18/T-08-19 pattern). Threat register entries T-08-30 through T-08-33 in the plan's `<threat_model>` are all mitigated as designed — server enforces `auth.uid()` + owner-RLS, cancelled flag prevents unmount state mutations.

## Self-Check

- `src/components/notes/HoldingNoteRow.tsx` — FOUND (modified)
- `src/components/notes/HoldingNoteRow.test.tsx` — FOUND (modified)
- `src/app/(dashboard)/allocations/components/HoldingsTable.test.tsx` — FOUND (modified, Rule 1 fix)
- Commit `2eb38f9` — FOUND (RED test commit)
- Commit `278c819` — FOUND (GREEN implementation commit)
- `npm test` 1539 passed / 0 failed — VERIFIED

## Self-Check: PASSED
