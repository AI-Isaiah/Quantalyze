---
phase: 59-saved-shared-compared-windows
plan: 01
subsystem: scenario-persistence
tags: [scenario-draft, schema-versioning, codec, coverage-window, PERSIST-01]
requires: []
provides:
  - "ScenarioDraft.window?: CoverageWindow (additive-optional field)"
  - "SCENARIO_SCHEMA_VERSION = 3 + SCENARIO_SCHEMA_VERSION_PREV = 2"
  - "non-destructive v2→v3 codec branch (outcome ok + reason upgraded_v2_windowless)"
  - "scenarioDraftSchema accepts bounded-optional window"
affects:
  - "reopen (Plan 02) — hydrate reads draft.window + the provenance reason"
  - "share-resolve (Plan 02/03) — threads owner's draft.window verbatim"
  - "scenario-compare (Plan 03) — per-scenario draft.window, post-collapse"
tech-stack:
  added: []
  patterns:
    - "non-destructive schema upgrade as a 4th codec branch (variant of version_ahead→readonly)"
    - "provenance marker carried on DecodeResult.reason (transient, never persisted)"
    - "bounded-optional zod field (.max(32) per FIX A storage-poison convention)"
key-files:
  created: []
  modified:
    - "src/app/(dashboard)/allocations/lib/scenario-state.ts"
    - "src/app/(dashboard)/allocations/lib/scenario-state.test.ts"
    - "src/app/api/allocator/scenario/saved/route.test.ts"
    - "src/app/scenario-share/[token]/share-resolve.test.ts"
    - "src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx"
decisions:
  - "Used named SCENARIO_SCHEMA_VERSION_PREV = 2 (not a bare - 1) to key the upgrade branch and document why it exists (research recommendation)"
  - "window left undefined by the upgrade branch — consumers default via defaultWindowFor() on open"
  - "provenance marker emitted on the ok result's reason field (verified no consumer asserts ok ⇒ reason === null for this codec)"
metrics:
  duration: ~10 min
  completed: 2026-07-02
  tasks: 3
  files-modified: 5
---

# Phase 59 Plan 01: Saved/Shared/Compared Windows — Persistence Foundation Summary

Landed the persistence FOUNDATION for the v1.5 coverage window: `ScenarioDraft.window?: CoverageWindow` (additive-optional, bounded in zod), the `SCENARIO_SCHEMA_VERSION` 2→3 bump, and — in the SAME change — the non-destructive `rawVersion === SCENARIO_SCHEMA_VERSION_PREV` codec branch that upgrades every stored v2 draft to `outcome:"ok"` on read (with the transient `upgraded_v2_windowless` provenance marker) instead of dropping it into the reset bucket. This is the single decode authority all downstream plans (reopen, share, compare) consume, so the data-loss timebomb is defused at the root.

## What Was Built

- **RED-first codec test (Task 1)** — four cases pinning the non-destructive contract: (A) a windowless v2 draft decodes `ok` (never `reset`) + `reason:"upgraded_v2_windowless"` + `window` undefined + `schema_version` upgraded in-memory; (B) a corrupt v2 blob still `reset`s (`schema_invalid`); (C) a current+1 (==4) draft still `readonly` (`version_ahead`); (D) a fresh v3-with-window decodes `ok` (`reason:null`, marker is v2-upgrade-only) and round-trips the window. Confirmed RED (A/C/D failed) against constant=2 before the GREEN task.
- **The GREEN production change (Task 2)** — five edits to `scenario-state.ts`: import `CoverageWindow`; add `window?: CoverageWindow` to `ScenarioDraft` (after `userWeightOverrides?`); add `window: z.object({ start: z.string().max(32), end: z.string().max(32) }).optional()` to `scenarioDraftSchema`; bump `SCENARIO_SCHEMA_VERSION` 2→3 + declare `SCENARIO_SCHEMA_VERSION_PREV = 2`; insert the new codec branch BEFORE the final reset return (safeParse → `ok` + marker + in-memory version upgrade; corrupt → reset). The `version_ahead → readonly` and `=== current → ok` branches are untouched.
- **Save-route round-trip proof (Task 3)** — extended `route.test.ts` (T_S19/T_S20): a v3 draft carrying `window:{start,end}` inserts with `draft.window` intact and `schema_version === 3`; a windowless v3 draft still validates+inserts. `route.ts` was NOT changed — research Assumption 2 (persist-`parsed.data.draft`-whole) confirmed by the passing tests.

## Verification

- `npx vitest run scenario-state.test.ts` → 47 passed (Task 1 RED cases GREEN after Task 2).
- `npx vitest run saved/route.test.ts` → 26 passed (T_S19/T_S20 window round-trip).
- `npx tsc --noEmit` → clean (exit 0) — `CoverageWindow` import + `DecodeResult.reason` string-compatible + the new field type-checks project-wide.
- **Wave gate** — `npm run test:coverage` → **7338 passed / 0 failed** (288 skipped); coverage above every blocking ratchet: Lines 85.43 (≥82), Statements 83.28 (≥80), Functions 79.72 (≥74), Branches 76.13 (≥72).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug / Rule 2 — test-intent] Rebased two version-relative test fixtures broken by the 2→3 bump (Pitfall 2)**
- **Found during:** the wave-gate full-suite run (Task 3 verification). The version bump broke 2 pre-existing tests — direct, in-scope fallout of the constant change, anticipated by the plan's Pitfall 2 note.
- **Issue:**
  - `share-resolve.test.ts` version-ahead pin asserted `SCENARIO_SCHEMA_VERSION === 2` (now 3) and used a literal envelope `schema_version: 3` that is now `== current` (decodes `ok`, no longer "ahead").
  - `ScenarioComposer.save.test.tsx` T_SAVE6 built its "older incompatible schema → reset" fixture at `SCENARIO_SCHEMA_VERSION - 1`, which is now 2 → the new non-destructive branch upgrades it to `ok` (it would hydrate rather than show the older-format notice).
- **Fix:** re-pinned the constant assertion to 3 and made the envelope version `SCENARIO_SCHEMA_VERSION + 1` (self-adjusting, still exercises the readonly/honest-absence path); re-based the older-incompatible fixture to `SCENARIO_SCHEMA_VERSION_PREV - 1` (below the upgrade window, so a genuinely-legacy version still resets — the test's intent, "a truly-old format never hydrates," is preserved). Added `SCENARIO_SCHEMA_VERSION_PREV` to the save-test import.
- **Files modified:** `src/app/scenario-share/[token]/share-resolve.test.ts`, `src/app/(dashboard)/allocations/components/ScenarioComposer.save.test.tsx`
- **Commit:** `5b743236`

No other deviations — the codec branch, field, schema, and version bump landed exactly as the plan and RESEARCH specified. `route.ts` required no change (Assumption 2 held). No SQL migration, no RPC change, no `schema:functions` regeneration (all as designed). No authentication gates.

## Threat Model Coverage

- **T-59-01 (data loss on the bump, HIGH):** mitigated — the non-destructive branch returns `ok` (never `reset`) for a valid v2 draft; RED-test-gated (Task 1 Test A).
- **T-59-02 (storage-poison via the window field):** mitigated — `z.object({ start: max(32), end: max(32) }).optional()`; `MAX_DRAFT_BODY_BYTES` (256KB) backstops the whole draft.
- **T-59-03 (forged future version):** intact — `version_ahead → readonly` threshold shifts to 3; a v4+ draft still `readonly`. Pinned by Task 1 Test C.
- **T-59-SC (package legitimacy):** vacuously satisfied — zero packages installed (first-party TypeScript only).

## Known Stubs

None. This plan is the persistence storage-model + versioning half of PERSIST-01. Reopen-recompute wiring and the provenance-note UI are Plan 02; share/compare threading are Plan 02/03 — those consume this codec but are out of scope here by design (not stubs).

## Self-Check: PASSED

- Created files: none (all changes are modifications).
- Modified files exist: `scenario-state.ts` FOUND, `scenario-state.test.ts` FOUND, `route.test.ts` FOUND, `share-resolve.test.ts` FOUND, `ScenarioComposer.save.test.tsx` FOUND.
- Commits exist: `da5ee8fc` FOUND, `c2e51fb7` FOUND, `bdb84c55` FOUND, `5b743236` FOUND.
