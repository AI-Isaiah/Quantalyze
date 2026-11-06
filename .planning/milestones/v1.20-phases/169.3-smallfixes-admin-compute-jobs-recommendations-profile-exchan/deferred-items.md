# 169.3 deferred items (out of scope, logged by executors)

## 2026-09-30, found while executing 169.3-03

- **`src/__tests__/verify-plan-anchors.test.ts`: 2 cases fail on the real tree** (`--pending prints its
  scan counts and exits 0 on the real tree`, `R2-W05: the REAL marker in the tree satisfies the
  tightened rule`). They fail alone as well as in the full run, so this is not the load flake.
  `node scripts/verify-plan-anchors.mjs --pending` reports 3 stale claims, all in Phase 169 plans:
  `169-02-PLAN.md:109` (`alignReturns` absent from `src/lib/factsheet/align.ts`),
  `169-02-PLAN.md:115` (`factsheet-v2-payload-v6` absent from `src/app/factsheet/[id]/v2/page.tsx`)
  and `169-03-PLAN.md:108` (`forward-filled` absent from `src/app/factsheet/[id]/v2/MandatePanels.tsx`).
  Those files were last changed on origin/main by `f1ca32b56` (169.5 BENCHCOMPARE, #908), merged
  into feat/169.3 at `3d2b7445a`. 169.3-03 touches none of them. The owner is whoever next plans or
  executes Phase 169 (re-anchor or retire those claims); the `plan-anchor-verify` CI job likely
  shows the same red on this branch until then (not measured in CI; the local CLI is what was run).

  **RESOLVED 2026-09-30 (recorded by the 169.3-04 executor).** The orchestrator removed the three
  pre-split Phase 169 plan copies that main no longer carries (`169-02-PLAN.md`, `169-03-PLAN.md`,
  `169-08-PLAN.md` under `.planning/phases/169-pagetruth/`, commit `6634c5207`). Re-measured at
  HEAD `a17a8592f`: `node scripts/verify-plan-anchors.mjs --pending` prints
  `OK: 19 plan file(s), no stale claims.`, and `src/__tests__/verify-plan-anchors.test.ts` passes
  58/58, both cases named above included. Nothing is left to own.
