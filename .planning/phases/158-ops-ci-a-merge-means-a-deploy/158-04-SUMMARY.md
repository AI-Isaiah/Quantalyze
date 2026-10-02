---
phase: 158-ops-ci-a-merge-means-a-deploy
plan: 04
subsystem: testing
tags: [vitest, test-isolation, flake, node22, ci, DEF-16-1]

# Dependency graph
requires:
  - phase: 140.5-ops-seam-prose
    provides: "the config-level state fence (vitest.config.ts unstubGlobals/unstubEnvs), the src/test-setup.ts env snapshot-restore, and the falsifiable leak canary (SC-HARNESS-1 / SC-ENV-1) — the mechanism this plan closes OPS-11 on"
provides:
  - "158-OPS11-EVIDENCE.md — a re-runnable 15-run reproduction matrix (13 shuffle seeds, 8 under Node 22, both exact CI shards) closing OPS-11 on mechanism"
  - "Measured-at-HEAD proof that both 140.5 fences are independently falsifiable (neuter → RED → restore, both polarities)"
  - "Identification of a separate, CI-unreachable defect class: intra-file test-order dependence in 10 specs, root mechanism traced"
affects: [158-06, ci-flake-triage, test-hygiene, vitest-config]

actuals:
  tokens: 5800
  tasks: 2
  commits: 2

tech-stack:
  added: []
  patterns:
    - "Reproduction-first flake closure: re-measure a dated defect claim at HEAD before changing code; close on a fix OR on a re-verified mechanism, never on a green rerun"
    - "Detector falsification before trust: prove the reproduction detector fires on a synthetic positive and stays silent on a real negative before believing any sweep result"
    - "Instrument separation: --sequence.shuffle (files AND tests) vs --sequence.shuffle.files (files only) isolate intra-file order bugs from cross-file leaks; only the latter models CI"

key-files:
  created:
    - .planning/phases/158-ops-ci-a-merge-means-a-deploy/158-OPS11-EVIDENCE.md
    - .planning/phases/158-ops-ci-a-merge-means-a-deploy/deferred-items.md
  modified:
    - .planning/WINDOWS.md

key-decisions:
  - "BRANCH B (mechanism closure): the flake did not reproduce in 15 runs, so OPS-11 closes on the Phase 140.5 fence rather than on a fabricated fix — no production or test code was changed"
  - "Re-measured the canary's falsifiability at HEAD instead of citing 140.5-VALIDATION.md, because the falsifiability itself was a dated claim"
  - "Added --sequence.shuffle.files runs beyond the plan's matrix: full --sequence.shuffle also permutes tests WITHIN a file, which CI never does, so alone it could not distinguish an intra-file bug from the cross-file leak OPS-11 describes"
  - "Did NOT fix the 10 files with intra-file order dependence — out of OPS-11's scope and unreachable from CI; logged to deferred-items.md + WINDOWS.md instead"

patterns-established:
  - "A non-reproduction is only credible when the instrument is shown to find the defect class elsewhere — this sweep reddened 10 other files while clearing the target"
  - "Neuter → observe RED → restore → verify tree clean, as the standing proof that a cited fence is live"

requirements-completed: [OPS-11]

coverage:
  - id: D1
    description: "MultiKeyConnectStep passes under every tested ordering, including orderings strictly more aggressive than CI's (ROADMAP 158 SC-5)"
    requirement: "OPS-11"
    verification:
      - kind: unit
        ref: "npx vitest run MultiKeyConnectStep.test.tsx MultiKeyConnectStep.payload.test.ts — 80/80 passed (isolation baseline and closing verify)"
        status: pass
      - kind: unit
        ref: "13 full-suite shuffle seeds (1-13), 8 under PATH=/opt/homebrew/opt/node@22/bin — target failed in 0; file-order-only seeds 11-13 fully green (786 files, exit 0)"
        status: pass
      - kind: integration
        ref: "exact ci.yml:290-299 shard invocation, --shard=1/2 and 2/2 under Node 22 — both exit 0; target present in shard 1"
        status: pass
    human_judgment: false
  - id: D2
    description: "OPS-11 closed on MECHANISM (Phase 140.5 fence), with both fences re-verified falsifiable at HEAD"
    requirement: "OPS-11"
    verification:
      - kind: unit
        ref: "src/test-setup.leak-canary.test.ts — SC-HARNESS-1 neuter (unstubGlobals:false) RED at :86; SC-ENV-1 neuter (drop restoreEnv) RED at :95; both restored, GREEN, git status clean"
        status: pass
    human_judgment: true
    rationale: "Accepting a non-reproduction as closure is a judgment call, not a test result. A human should ratify that the mechanism citation is an adequate close for a defect that never reddened a CI shard, versus keeping OPS-11 open pending a future red."

# Metrics
duration: 67min
completed: 2026-08-20
status: complete
---

# Phase 158 Plan 04: OPS-11 MultiKeyConnectStep Flake Closure Summary

**The 2026-07-30 order-sensitivity claim was re-measured at HEAD across 15 runs and did not reproduce; OPS-11 closes on the Phase 140.5 state fence, with both halves of that fence re-proven falsifiable today — zero code changed.**

## Performance

- **Duration:** ~67 min (dominated by 15 full-suite runs at ~200-240s each)
- **Started:** 2026-08-20T17:55Z
- **Completed:** 2026-08-20T19:02Z
- **Tasks:** 2
- **Files modified:** 3 (all documentation/ledger — no code)

## Accomplishments

- **Reproduction attempted first, honestly, and it failed to reproduce.** 15 runs: 13 distinct shuffle seeds (8 under the CI-parity Node-22 PATH) plus both exact `ci.yml` shard invocations. `MultiKeyConnectStep` failed in **0 of 15**, including the shard that actually contains it.
- **Separated two instruments the plan treated as one.** `--sequence.shuffle` permutes file order *and test order within each file*; `--sequence.shuffle.files` permutes only file order — which is what CI's sharding varies and what "order/shard-sensitive" actually means. Under file-order-only shuffling the **entire suite** is green across 3 seeds (786 files / 11,983 tests / exit 0). This is the load-bearing measurement.
- **Proved the detector before trusting it.** `MultiKeyConnectStep` appears 8× in a run log as stderr from *passing* tests, so a naive substring grep would have declared a false reproduction on every run. The detector was falsified in both polarities (fires on a synthetic FAIL, silent on the real log) before any sweep result was believed.
- **Re-measured the cited mechanism instead of inheriting it.** Both 140.5 fences were neutered one at a time at HEAD: `unstubGlobals: false` reddened the canary's *global* assertion (SC-HARNESS-1), dropping `restoreEnv` reddened its *env* assertion (SC-ENV-1). Different assertions each time — so the two fences are independently live and neither silently carries the other. Both reverted, tree verified clean.
- **Found a real, separate defect class and did not pretend it was this one.** 10 files fail under intra-file test reordering; the root mechanism was traced to a `vi.doMock` never deregistered at `create-with-key/route.test.ts:2374` (`vi.resetModules()` clears the cache, not the registry). Logged, not fixed.

## Task Commits

1. **Task 1: Reproduction sweep at HEAD** - `7a6e22ba` (test)
2. **Task 2: Close on evidence — Branch B mechanism closure** - `6371adf6` (docs)

## Files Created/Modified

- `.planning/phases/158-ops-ci-a-merge-means-a-deploy/158-OPS11-EVIDENCE.md` - The 15-run matrix, environment fingerprints, verbatim re-runnable commands, honest classification of every red, and the closure verdict
- `.planning/phases/158-ops-ci-a-merge-means-a-deploy/deferred-items.md` - D-158-04-1, the 10-file intra-file order-dependence class with its identified mechanism and remedy
- `.planning/WINDOWS.md` - Ledger entry 2 (kind `deviation`, phase 158) for the same class

**No production code and no test code was changed** — required by Branch B, and verified: `git status --short` showed only documentation paths before each commit.

## Decisions Made

- **Branch B over a fabricated fix.** The plan's prohibition is explicit that the flake must not be retried away; it is equally true that it must not be *fixed* away. With 15 non-reproductions, inventing a change to `MultiKeyConnectStep.test.tsx` would have been a change with no defect behind it. The file is already hygienic and already uses the DEF-16-1 remedy pattern (`vi.spyOn(globalThis,"fetch")` + `restoreAllMocks`) — there was nothing to remediate.
- **Went beyond the plan's matrix with file-order-only runs.** Without them the sweep's reds (all intra-file) could have been misread as the OPS-11 defect, or their absence in the target misread as luck. They are what make the negative result mean something.
- **Left the 10-file class alone.** It is unreachable from CI today (CI never shuffles tests within a file), unrelated to the target, and fixing ~10 unrelated specs inside a flake-closure plan is the scope creep the executor contract forbids.

## Deviations from Plan

### Additions beyond the written plan

**1. [Rule 2 - Missing Critical] Detector falsification before the sweep was trusted**
- **Found during:** Task 1
- **Issue:** The plan's reproduction definition assumed a grep for the target name is a sound detector. It is not — the target emits 8 stderr lines per run from passing tests, so a naive grep yields a false positive on every run, which would have manufactured a fake reproduction and then a fake fix.
- **Fix:** Restricted the detector to `^ FAIL ` lines and proved it in both polarities before use.
- **Verification:** Synthetic target FAIL → 1 (fires); real seed-1 log with 8 stderr mentions → 0 (silent).
- **Committed in:** `7a6e22ba`

**2. [Rule 2 - Missing Critical] Re-verified the cited mechanism's falsifiability at HEAD**
- **Found during:** Task 2
- **Issue:** Branch B as written closes by *citing* the leak canary's ledger rows. But that falsifiability is itself a dated claim from Phase 140.5 — closing on an unverified citation reproduces the exact repudiation risk (T-158-15) the branch exists to avoid.
- **Fix:** Neutered each fence independently at HEAD, observed RED on a different assertion each time, restored both, confirmed GREEN and a clean tree.
- **Verification:** Recorded verbatim in `158-OPS11-EVIDENCE.md` §8.
- **Committed in:** `6371adf6`

**3. [Rule 2 - Missing Critical] Added file-order-only shuffle runs (seeds 11-13)**
- **Found during:** Task 1
- **Issue:** The plan specified only `--sequence.shuffle`, which also permutes tests within a file — something CI never does. That instrument alone cannot distinguish an intra-file bug from the cross-file leak OPS-11 describes.
- **Fix:** Added 3 `--sequence.shuffle.files` runs under Node 22.
- **Verification:** All 3 fully green (786 files, exit 0) — the decisive evidence for the closure.
- **Committed in:** `7a6e22ba`

---

**Total deviations:** 3 (all additive rigor; none altered the plan's contract or its prohibitions)
**Impact on plan:** Strengthened the closure from a citation to a measurement. No scope creep — no code touched.

## Issues Encountered

- **`node_modules` absent in the GSD worktree** (a known measured condition). Resolved by `npm ci` from the committed lockfile, exactly as the task's precondition directs.
- **Worker-contention timeout in run 1** (`contracts-registry.test.ts`, "timed out in 5000ms"): sibling GSD phase agents were loading the same machine. Classified as a measurement artifact, not a reproduction — it did not recur in the 14 later runs, and CI is immune by construction (`--test-timeout=20000` in the shard command).
- **Full `--sequence.shuffle` reds in up to 10 files per seed.** Every one was classified; none was the target. See evidence §6.

## Known Stubs

None. This plan shipped no code, no stubbed values, no skipped tests, and left no `<verify>` unrun — both task gates were executed and passed.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes — the plan's output is documentation. The threat register's two entries were both addressed: **T-158-14** (test-state leakage) resolved as not-present at HEAD with the fence re-proven live; **T-158-15** (closure without falsifiable evidence) mitigated by the reproduction-first protocol, the falsified detector, and the neuter→RED→restore measurement.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- **ROADMAP 158 SC-5 is met:** `MultiKeyConnectStep` passes under every ordering tested, and the closure is mechanism-backed rather than retry-backed. No retry annotation, `test.retry`, spec reordering, or timeout bump was introduced anywhere.
- **TODOS.md:1011 can be marked closed** by the orchestrator, citing `158-OPS11-EVIDENCE.md`. This plan did not edit TODOS.md (shared artifact, orchestrator-owned).
- **Carried forward:** D-158-04-1 (10 files, intra-file order dependence). Harmless today; becomes live the moment anyone enables `sequence.shuffle` in `vitest.config.ts` or CI as a flake-hunting measure — fix it first if that is ever proposed.

## Self-Check: PASSED

Claims verified against disk and git, not asserted:

| Claim | Check | Result |
|---|---|---|
| `158-OPS11-EVIDENCE.md` exists | `ls` | FOUND |
| `deferred-items.md` exists | `ls` | FOUND |
| `158-04-SUMMARY.md` exists | `ls` | FOUND |
| Task 1 commit `7a6e22ba` | `git log --oneline` | FOUND |
| Task 2 commit `6371adf6` | `git log --oneline` | FOUND |
| No code changed | `git diff --name-only 35c74149 HEAD` | 4 paths, all `.planning/` — FOUND |
| STATE.md / ROADMAP.md untouched | same diff | absent — CONFIRMED |
| Fence neuters reverted | `git status --short` after restore | empty — CONFIRMED |
| Target green at close | `vitest run` both target specs | 80/80 passed |

---
*Phase: 158-ops-ci-a-merge-means-a-deploy*
*Completed: 2026-08-20*
