---
phase: 164-share-copy-link-always-works-and-never-discloses
plan: 07
subsystem: testing
tags: [static-analysis, import-closure, next-cache, unstable_cache, disclosure, vitest]

# Dependency graph
requires:
  - phase: 164-share-copy-link-always-works-and-never-discloses
    provides: "164-01 / D-06 moved fetchAndBuildPayload to src/lib/factsheet/fetch-and-build-payload.ts, creating the single builder whose closure this plan guards"
provides:
  - "Transitive-closure cache-reach guard over the payload builder's whole dependency graph (38 modules), extending the existing phase-148 cache-isolation file"
  - "A closure walker that follows relative AND `@/` specifiers, with three anti-vacuity pins against its own blindness"
  - "The builder docblock now CITES its enforcing test instead of asserting the absence on its own authority"
affects: [164-03, 164-05, factsheet-share token lane, any future perf work inside src/lib/factsheet]

actuals:
  tokens: 14660    # chars/4 over the two files actually changed (58,640 chars). Diff-only basis: 4,560.
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Transitive-import-closure static gate: walk the graph from an entry module and assert a property over EVERY reachable module, not over one file's bytes"
    - "Closure floor asserted against an INDEPENDENT pre-edit measurement, never against the finished walker's own output"

key-files:
  created: []
  modified:
    - src/__tests__/phase-148-owner-lane-cache-isolation.test.ts
    - src/lib/factsheet/fetch-and-build-payload.ts

key-decisions:
  - "Extended phase-148-owner-lane-cache-isolation.test.ts rather than forking a second cache-guard file — one invariant, one guard, per 164-VALIDATION.md Wave 0"
  - "Closure floor set at >= 30 citing the independent pre-edit measurement of 38 (2026-08-27); NOT derived from the walker, because a resolver that resolves nothing returns {entry} and passes every no-cache-reach assertion vacuously"
  - "Alias resolution proven by an ALIAS-ONLY witness module (src/lib/portfolio-math-utils.ts) computed by the walk itself, not asserted by hand"
  - "Bare-specifier collection asserted explicitly — `next/cache` IS a bare specifier, so dropping bare specifiers would make the headline assertion unable to fire"
  - "RED planted at DEPTH 3 (src/lib/utils.ts), not on the entry: a guard that reads only the entry file is the bug being fixed"
  - "JSON data files are closure MEMBERS (resolveJsonModule pulls 5 of them in) and are token-scanned, but are treated as import leaves"

patterns-established:
  - "Chain-reporting failure messages: an offender is reported as `file — reason — reached via a → b → c`, so the next reader does not bisect imports by hand"
  - "Guard-the-guard assertions: when the walker's own blindness is the threat, half the assertions pin the walker (floor, alias resolution, bare collection, unresolved edges) and half pin the property"

requirements-completed: [SHARE-02]

coverage:
  - id: D1
    description: "No module in the payload builder's transitive import closure imports next/cache or names unstable_cache / revalidateTag / revalidatePath / cacheTag / cacheLife"
    requirement: SHARE-02
    verification:
      - kind: unit
        ref: "src/__tests__/phase-148-owner-lane-cache-isolation.test.ts#NO module in the closure imports next/cache or names a Next cache API"
        status: pass
      - kind: unit
        ref: "manual mutation 2026-08-28: `import { unstable_cache } from \"next/cache\";` planted in src/lib/utils.ts (depth 3) → 1 failed / 17 passed"
        status: pass
    human_judgment: false
  - id: D2
    description: "The closure walker is non-vacuous — it resolves a real 38-module graph, follows `@/` aliases, collects bare specifiers, and leaves no unresolved edge"
    requirement: SHARE-02
    verification:
      - kind: unit
        ref: "src/__tests__/phase-148-owner-lane-cache-isolation.test.ts#walks a real graph: at least 30 modules (38 measured PRE-EDIT on 2026-08-27)"
        status: pass
      - kind: unit
        ref: "src/__tests__/phase-148-owner-lane-cache-isolation.test.ts#really followed `@/` aliases and not just relative paths"
        status: pass
      - kind: unit
        ref: "src/__tests__/phase-148-owner-lane-cache-isolation.test.ts#really collected BARE specifiers — the net that would catch `next/cache` itself"
        status: pass
      - kind: unit
        ref: "src/__tests__/phase-148-owner-lane-cache-isolation.test.ts#resolved EVERY relative and alias specifier it met (an unresolved edge is an unwalked subtree)"
        status: pass
    human_judgment: false
  - id: D3
    description: "The builder's docblock cites phase-148-owner-lane-cache-isolation.test.ts as the enforcement of its no-cache-reach claim, and states the transitive scope, while preserving the SL-1 id-only-key argument"
    requirement: SHARE-02
    verification:
      - kind: unit
        ref: "src/__tests__/contracts (109/109 pass — these specs scan all of src/, so a comment alone can redden them)"
        status: pass
    human_judgment: true
    rationale: "Whether the rewritten prose preserves the SL-1 argument's intent (rather than merely mentioning the test) is an editorial judgment no automated check can make."

duration: 12min
completed: 2026-08-28
status: complete
---

# Phase 164 Plan 07: Transitive cache-reach guard over the payload builder Summary

**The factsheet payload builder's 38-module transitive import closure is now pinned against `next/cache` reach — RED-proven by a planted `unstable_cache` import three hops deep, where all twelve pre-existing assertions in the same file stayed green.**

## Performance

- **Duration:** ~12 min
- **Started:** 2026-08-28T00:14Z
- **Completed:** 2026-08-28T00:26Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- **Closed F6 (gate condition 4's static half).** Both existing cache controls scanned a single file's bytes. `src/lib/factsheet/fetch-and-build-payload.ts` and its 37 transitive dependencies were unguarded. The new pin 8 walks the whole graph and fails if ANY reachable module imports `next/cache` or names `unstable_cache` / `revalidateTag` / `revalidatePath` / `cacheTag` / `cacheLife`.
- **Proved the guard is not blind, three independent ways.** The walker's own failure modes are the real threat here, so three of the six new assertions pin the walker rather than the property: a closure floor against an independent pre-edit measurement, an alias-only witness module, and a bare-specifier collection check.
- **The failure message names the chain.** An offender is reported as `file — reason — reached via entry → … → file`, not as "something in the graph caches".
- **The builder's docblock stopped claiming what nothing enforced.** It now cites the test by name and states that the property holds over the transitive closure, not over its own bytes.

## Task Commits

1. **Task 1: Pin the builder's TRANSITIVE closure against cache reach** — `861d4c042` (test)
2. **Task 2: Make the builder's docblock cite its enforcement** — `6b07bdbcb` (docs)

## Files Created/Modified

- `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` — +300 lines. New `describe` block ("SHARE-02 / F6"), the closure walker (`transitiveClosure`, `resolveSpecifier`, `importSpecifiers`, `cacheReachOffenders`), and a header amendment recording the RED experiment in the file's existing convention. Reuses the file's `stripComments` helper unchanged.
- `src/lib/factsheet/fetch-and-build-payload.ts` — comment-only. The `⛔ THIS MODULE HAS NO CACHE REACH` paragraph rewritten to cite its enforcing test and state the transitive scope; the SL-1 id-only-key argument split out under `WHY THE ABSENCE MATTERS` and preserved.

## Measurements

### Closure size — walker vs. the pre-edit floor

| Basis | Result |
|---|---|
| Pre-edit measurement cited by the plan (2026-08-27) | **38** modules, entry included |
| Independent throwaway script, re-measured 2026-08-28 before writing the guard | **38** |
| The finished walker's own `closure.chains.size` (read via a temporary `toBe(-1)`, then reverted) | **38** |
| Floor asserted in the test | `>= 30`, citing the 2026-08-27 measurement inline |

**No material difference.** All three agree at 38, and the floor stayed at the plan's 30 — it was never adjusted to match anything.

One **non-material discrepancy**, reported rather than papered over: the plan records the reached bare specifiers as `@supabase/supabase-js, zod`. This walker also collects **`server-only`**, because its specifier regex covers bare side-effect imports (`import "server-only";`) in addition to `from "…"` and `import("…")` forms. Same graph, wider specifier net — and the wider net is the load-bearing one, since `next/cache` would most plausibly arrive as `import { unstable_cache } from "next/cache"` but a bare `import "next/cache"` must also be caught. The test asserts only on the two specifiers the pre-edit measurement recorded, and the discrepancy is documented in the `CLOSURE_FLOOR` docblock.

Depth distribution of the closure: 1 entry, 7 at depth 1, 20 at depth 2, 10 at depth 3 (5 of which are the `resolveJsonModule` benchmark data files).

### RED experiment (Rule 9 — the guard must be able to fail)

Planted **three hops in**, deliberately not on the entry file — a guard that reads only the entry is the bug being fixed, so proving it there proves nothing.

- **Site:** `src/lib/utils.ts`, reached via `fetch-and-build-payload.ts → strategy-display.ts → types.ts → utils.ts`
- **Mutation:** `import { unstable_cache } from "next/cache";` added as line 1

Exact observed failure:

```
FAIL  |node| src/__tests__/phase-148-owner-lane-cache-isolation.test.ts >
  SHARE-02 / F6 — the payload builder's TRANSITIVE closure has no reach into the Next data cache >
  NO module in the closure imports next/cache or names a Next cache API
AssertionError: expected [ Array(1) ] to deeply equal []

- []
+ [
+   "src/lib/utils.ts — imports \"next/cache\"; names unstable_cache — reached via
+    src/lib/factsheet/fetch-and-build-payload.ts → src/lib/strategy-display.ts →
+    src/lib/types.ts → src/lib/utils.ts",
+ ]

 Tests  1 failed | 17 passed (18)
```

**Measured asymmetry — the reason this pin was needed at all:** under that same mutation, **all twelve pre-existing assertions in this file stayed GREEN**. They read `page.tsx` and the builder's own bytes, and neither changed. For this edit the closure guard is the sole control.

**Restore:** byte backup taken before the plant, restored by `cp`, verified by `shasum` — `806c8681bab71e74b6ac544d99010392638ae11f` before and after — with `git diff --quiet -- src/lib/utils.ts` exiting 0 and `grep -c "next/cache" src/lib/utils.ts` returning 0. No `git checkout --` was used anywhere in this tree.

### Gate results on the final tree

| Gate | Result |
|---|---|
| `npx vitest run src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` | **18/18 pass** (12 pre-existing + 6 new) |
| `npx vitest run src/__tests__/contracts` | **109/109 pass**, 5 files — run in full after the Task 2 docblock edit, since those specs scan all of `src/` and a comment alone can redden them |
| `npx tsc --noEmit` | **exit 0** |
| `src/__tests__/phase-147-series-resolution-guards.test.ts` + `src/app/factsheet-share/[token]/page.test.tsx` | **32/32 pass** (the other two test files that reference the builder module) |

## Decisions Made

- **Extended, did not fork.** The new pin lives in `phase-148-owner-lane-cache-isolation.test.ts` as "pin 8", reusing its `stripComments` helper verbatim. Two guards over one invariant is how they drift.
- **The floor is an input, not an output.** `CLOSURE_FLOOR = 30` cites the 2026-08-27 measurement of 38 in its docblock, with an explicit warning that deriving it from the walker would encode whatever the walker happens to do — including doing nothing.
- **Alias proof is computed, not asserted.** The walk records, per resolved module, whether it was reached by an alias form, a relative form, or both; `aliasOnly` falls out of that, and the test pins `src/lib/portfolio-math-utils.ts` (reached only as `@/lib/portfolio-math-utils` from `allocator-portfolio-payload.ts:1`). A resolver that drops aliases produces an empty `aliasOnly` and loses the module — both assertions fire.
- **Unresolved edges fail loud.** A relative or alias specifier that resolves to no file is collected and asserted empty, because such an edge is an entire subtree the gate never looked at. Measured: zero.
- **Comment stripping is pinned as load-bearing here too.** The entry's own docblock names `next/cache` while documenting this exact hazard, so an unstripped scan would report the entry as its own offender and the gate would be red on a healthy tree — which is how a gate gets deleted. The test asserts raw-contains / stripped-not-contains.
- **JSON files: members, not walk sources.** `resolveJsonModule` pulls five benchmark data files into the closure (they are part of the measured 38 and are token-scanned), but they declare no imports, so the walker treats them as leaves.

## Deviations from Plan

None — plan executed exactly as written. Two additions inside the plan's own instructions, neither a scope change:

1. **Two extra non-vacuity assertions beyond the two the plan named** (bare-specifier collection, and the unresolved-edge check). The plan required a floor and an alias proof; `next/cache` is itself a bare specifier, so a walker that silently dropped bare specifiers would render the headline assertion unable to fire — a third vacuity mechanism the two named pins do not cover.
2. **A header amendment block** documenting pin 8 and the RED experiment, matching the convention every prior amendment in that file follows (Rule 11 — conform to the codebase).

## Issues Encountered

None. One reporting note above: the walker's bare-specifier set is a superset of the plan's recorded set (`server-only` extra). Reported as a difference in the specifier net, not reconciled by narrowing the walker.

## Known Stubs

None.

## Threat Flags

None — this plan added no network surface, no auth path, no file access, and no schema change. It is one static test extension plus a comment rewrite.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- **Gate condition 4's static half is closed.** Condition 4 is NOT closed until 164-05-03's ORDERED acceptance spec lands — the behavioural half. Neither substitutes for the other; this plan did not touch `src/app/factsheet-share/[token]/page.cache-isolation.test.tsx`.
- **This must land before 164-03.** Live exposure is zero today (no mint route, empty table); it stops being zero the moment 164-03 ships a mint path.
- **The guard is a standing CI invariant now.** Any future perf work inside `src/lib/factsheet/**` that reaches for `unstable_cache` will redden `phase-148-owner-lane-cache-isolation.test.ts` with the offending file and the import chain named.

## Self-Check: PASSED

- `src/__tests__/phase-148-owner-lane-cache-isolation.test.ts` — exists on disk (41,721 bytes)
- `src/lib/factsheet/fetch-and-build-payload.ts` — exists on disk (16,919 bytes)
- `.planning/phases/164-share-copy-link-always-works-and-never-discloses/164-07-SUMMARY.md` — exists on disk
- Commit `861d4c042` — present in `git log`
- Commit `6b07bdbcb` — present in `git log`
- `git status --short` reports only this SUMMARY as untracked, confirming `164-VALIDATION.md` (orchestrator-owned) and `src/app/factsheet-share/[token]/page.cache-isolation.test.tsx` (164-05's concurrent file) were never touched
- `git diff --diff-filter=D` across both commits: no file deletions

---
*Phase: 164-share-copy-link-always-works-and-never-discloses*
*Completed: 2026-08-28*
