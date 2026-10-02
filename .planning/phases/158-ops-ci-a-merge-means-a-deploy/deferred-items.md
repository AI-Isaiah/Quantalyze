# Phase 158 — deferred items

Discovered during execution, deliberately NOT fixed in-phase (out of the owning plan's scope).

---

## D-158-04-1 — Intra-file test-order dependence in 10 vitest files

**Found during:** plan 158-04 task 1 (the OPS-11 reproduction sweep), 2026-08-20, HEAD `35c74149`.
**Status:** open. **Reachable from CI today:** NO.

### What

Ten test files fail when tests are reordered *within* the file. Surfaced by
`npx vitest run --sequence.shuffle --sequence.seed=<n>` (which shuffles file order AND test order);
they are green in declaration order. Observed across seeds 1–10 (see `158-OPS11-EVIDENCE.md` §6):

| File | Seeds affected |
|---|---|
| `src/app/api/strategies/create-with-key/route.test.ts` | all 10 |
| `src/lib/auth.test.ts` | 8 |
| `src/app/api/admin/users/[id]/roles/route.test.ts` | 4 |
| `src/app/(dashboard)/allocations/components/OptimizerPanel.test.tsx` | 4 |
| `src/app/(dashboard)/strategies/new/wizard/steps/MetadataStep.test.tsx` | 4 |
| `src/app/(dashboard)/allocations/widgets/performance/EquityChart.boundary.test.tsx` | 4 |
| `src/app/api/alert-digest/route.test.ts` | 3 |
| `src/proxy.test.ts` | 3 |
| `src/app/api/admin/match/allocators/route.test.ts` | 2 |
| `src/app/api/admin/strategy-review/route.test.ts` | 2 |

### Root mechanism (identified, not guessed)

`src/app/api/strategies/create-with-key/route.test.ts:2374-2385` — the H-0306 "unmocked withAuth
boundary" describe registers `vi.doMock("@/lib/api/withAuth", …actual…)` and
`vi.doMock("@/lib/supabase/server", …getUser → null…)`, and cleans up with `vi.resetModules()` only.

`vi.resetModules()` clears the module **cache**; it does **not** deregister a `vi.doMock`. In
declaration order the block runs late and nothing re-imports after it, so the file is green.
Reordered, it runs early and every later test doing `await import("./route")` resolves the *real*
`withAuth` against a user-less Supabase client — yielding `401` where `400`/`429`/`503` was expected.

This is the DEF-16-1 class (an unrestored mock crossing a test boundary), one scope inward:
intra-file rather than cross-file.

### Remedy when picked up

Add the matching deregistration to the leaking block's `afterEach` — the DEF-16-1 shape:

```ts
afterEach(() => {
  vi.doUnmock("@/lib/api/withAuth");
  vi.doUnmock("@/lib/supabase/server");
  vi.resetModules();
});
```

Then re-run the sweep and confirm the file is green under `--sequence.shuffle`. Triage the other
nine the same way (each needs its own diagnosis — only `create-with-key` was traced to a mechanism).

### Why it was NOT fixed in 158-04

1. **Out of scope.** Plan 158-04 owns OPS-11 — the `MultiKeyConnectStep` flake. The target file was
   green in all 15 runs; these 10 files are unrelated to it and cannot affect it
   (`MultiKeyConnectStep.test.tsx` makes no `vi.doMock` call and imports its component statically).
2. **CI cannot currently hit it.** Neither `vitest.config.ts` nor the `ci.yml:290-299` shard command
   sets `sequence.shuffle`; CI runs tests in declaration order. Under **file-order-only** shuffling
   — which is what CI's sharding actually varies — the whole suite is green (3/3 seeds, exit 0).
3. Editing ~10 unrelated specs inside a flake-closure plan is exactly the scope creep the executor
   contract's scope boundary forbids.

### Caveat worth stating

This debt becomes live the moment anyone enables `sequence.shuffle` in `vitest.config.ts` or CI as a
flake-hunting measure. Fix these first if that is ever proposed.
