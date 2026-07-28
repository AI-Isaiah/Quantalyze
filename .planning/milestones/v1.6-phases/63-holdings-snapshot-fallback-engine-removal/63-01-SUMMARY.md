---
phase: 63-holdings-snapshot-fallback-engine-removal
plan: 01
status: complete
completed: 2026-07-03
requirements: []
key-files:
  created: []
  modified:
    - src/app/(dashboard)/allocations/lib/scenario-adapter.ts
    - src/app/(dashboard)/allocations/lib/scenario-adapter.test.ts
commits:
  - 3c40ee19 (test — RED buildAddedOnlySet equivalence + no-alias + id-format pins)
  - 00763847 (feat — export buildAddedOnlySet, the ONE added-only engine set)
---

# Plan 63-01 Summary — Foundations (Task 1 of 2; Task 2 resequenced)

**Delivered (Task 1):** `buildAddedOnlySet` exported from scenario-adapter.ts
(delegates to `buildAddedUnits` via `mergeAddedIntoPerKeySet` with an empty per-key
set — equivalence-pinned RED-first), plus the ENGINE-04 precondition-(b) assertions:
explicit no-alias (per-key ids are api_keys UUIDs, added ids are strategies UUIDs,
disjoint by construction) and id-format pins. Adapter suite 36/36 green, tsc clean,
GUARD-03 zero-diff.

**Resequenced (Task 2 → 63-02 Task 0):** ENGINE-03 (gate=false blank init + note
repoint) moved to plan 63-02 by orchestrator decision (executor checkpoint,
Option A). Reason: the init flip breaks 24 default-payload composer tests; 9 of
them (H-0487, WINDOW-06, 7× Phase-59 PERSIST-01 window-reopen) require the
(gate=false AND book) state ENGINE-03 removes and are the GUARD-02
break-by-construction set owned by the ENGINE-01 deletion — landing ENGINE-03
alone would force either out-of-scope machinery work or it.skip on a shipped
feature's suite during composer surgery.

**Wave-1 artifacts handed to 63-02:**
- RED tests: commit `6a0960a1` (reset off branch tip, reachable by hash for cherry-pick)
- GREEN impl: scratchpad `engine03-impl.patch` (86 lines, ScenarioComposer.tsx)

**Requirements:** none closed by this plan (ENGINE-03 accounting moved to 63-02).

## Self-Check: PASSED
- buildAddedOnlySet exported + pinned: VERIFIED (commits on branch)
- No-alias assertion green: VERIFIED
- Frozen engine zero-diff: VERIFIED
- Working tree clean at handoff: VERIFIED
