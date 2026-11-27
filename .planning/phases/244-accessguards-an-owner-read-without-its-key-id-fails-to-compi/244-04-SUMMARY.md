---
phase: 244-accessguards-an-owner-read-without-its-key-id-fails-to-compi
plan: 04
subsystem: testing
tags: [e2e, playwright, ci, wiring-pin, hydration-guard, rls]
requires: [244-03]
provides:
  - "e2e/discovery-watchlist.spec.ts in the gating e2e-seeded Playwright list (MA-8 place 1), seeded census 27"
  - "src/__tests__/discovery-watchlist-e2e-wiring.test.ts, five named arms, each of three neuters seen RED then byte-restored and GREEN"
affects: []
tech-stack:
  added: []
  patterns: ["local copy of the manager-keys seeded-list parser (no test file imported)", "PROOF-01: neuter, RED by arm name, cp restore, cmp 0, GREEN"]
key-files:
  created:
    - src/__tests__/discovery-watchlist-e2e-wiring.test.ts
  modified:
    - .github/workflows/ci.yml
    - src/__tests__/e2e-seeded-hydration-guard.test.ts
key-decisions:
  - "The spec is wired into the e2e-seeded else arm directly before e2e/manager-keys.spec.ts, with a dated Phase 244 DBACC-06 place-1/place-2 note below the arm's fi; no env: key added to any step"
  - "The new pin does not repeat manager-keys-e2e-wiring.test.ts's step-tolerance arm and does not forbid process.env in the spec (the spec keeps its HAS_SEED_ENV skip by design)"
requirements-completed: [DBACC-06]
status: complete
verified_at_sha: 821d3ebfe46c02413cc4eb13605d76988013bcdb
actuals:
  tokens: 9500
  tasks: 2
  commits: 2
plan_head_before: ba4930ca8c610c9ca2f66311de1a118f620d5e31
plan_head_after: 821d3ebfe46c02413cc4eb13605d76988013bcdb
completed: 2026-11-27
---

# Phase 244 Plan 04: wire the watchlist spec into the gating seeded job Summary

The watchlist spec now sits in the `e2e-seeded` job's seeded Playwright list (judged by the `frontend` aggregator), the hydration census moves 26 -> 27 in the same commit, and a new five-arm wiring pin reds on each of the ways that placement or the spec's RLS proof could quietly decay.

## Commits

| Task | Commit | What |
|------|--------|------|
| 1 (tracer) | `480deed7c` | one list line in `ci.yml` plus a dated place-1/place-2 note; `SEEDED_SPEC_COUNT = 27` with its PIN history entry |
| 2 | `821d3ebfe` | NEW `src/__tests__/discovery-watchlist-e2e-wiring.test.ts` (five arms) |

## Verification results

- Tracer gate: `e2e-seeded-hydration-guard.test.ts` + `manager-keys-e2e-wiring.test.ts` 34 passed (2 files). Acceptance greps: seeded list count 1, advisory line count 0, `Phase 244 DBACC-06` in both files.
- New pin: 5 passed. With `spec-disabling.invariant.test.ts`: 14 passed (2 files).
- ci.yml-reader sweep (`grep -rlaE "ci\.yml" src` test files plus `spec-disabling.invariant.test.ts`): 37 files, `Test Files  37 passed (37)`, `Tests  2590 passed | 18 skipped (2608)`. The 18 skips are pre-existing skips in those files, none in this plan's files.
- `npx eslint` on the new pin and the census file: exit 0. `tsc --noEmit` printed nothing for the new file.
- `git status --porcelain -- .github/workflows/ci.yml e2e/discovery-watchlist.spec.ts` after the neuters: empty.

## PROOF-01 (byte backups under the session scratchpad, `$SCRATCH/244/ci.yml.bak` and `spec.bak`)

All three neuters were applied to the committed files, seen RED by arm name, restored with `cp`, checked with `cmp`, and rerun GREEN. No git checkout, restore or stash was used.

**W1 - delete the spec's seeded list line from ci.yml** (`1 file changed, 1 deletion(-)`). Ran the new pin plus the census: exit 1, `Tests  2 failed | 33 passed (35)`.

```
FAIL |jsdom| src/__tests__/discovery-watchlist-e2e-wiring.test.ts > the discovery watchlist e2e spec stays in the blocking lane (Phase 244 DBACC-06) > the seeded list names the watchlist spec
AssertionError: e2e/discovery-watchlist.spec.ts is not in the e2e-seeded list. Without it the only e2e proof of the user_favorites RLS scope runs nowhere that can fail a merge (Phase 244 DBACC-06).: expected [ …(26) ] to include 'e2e/discovery-watchlist.spec.ts'
FAIL |node| src/__tests__/e2e-seeded-hydration-guard.test.ts > seeded e2e specs run under the hydration guard (Phase 169.1.1 SC-4) > the seeded list parses to exactly 27 distinct specs
AssertionError: Parsed 26 spec(s) from the "- name: Run seed-gated specs (MA-8 / BLOCK-3)" step of .github/workflows/ci.yml, expected 27. [...]: expected 26 to be 27 // Object.is equality
```

`cp ci.yml.bak .github/workflows/ci.yml; cmp ...` -> `cmp=0`. GREEN rerun: `Test Files  2 passed (2)`, `Tests  35 passed (35)`.

**W2 - put the conditional anon-key wrapper back around the bare-SELECT block** (replaced the `expect(anonKey, "TEST_SUPABASE_ANON_KEY missing ...").toBeTruthy()` with `if (anonKey) { void 0; }`; `3 insertions(+), 4 deletions(-)`). Ran the new pin: exit 1, `Tests  1 failed | 4 passed (5)`.

```
FAIL |jsdom| src/__tests__/discovery-watchlist-e2e-wiring.test.ts > the discovery watchlist e2e spec stays in the blocking lane (Phase 244 DBACC-06) > the primary RLS proof cannot skip on a missing anon key
AssertionError: the primary RLS proof would silently skip when TEST_SUPABASE_ANON_KEY is unset: expected true to be false // Object.is equality
```

`cp spec.bak e2e/discovery-watchlist.spec.ts; cmp ...` -> `cmp=0`. GREEN rerun: `Tests  5 passed (5)`.

**W3 - add the spec's path to the advisory `e2e` job's one-line list naming `e2e/smoke.spec.ts`** (`1 insertion(+), 1 deletion(-)`; the acceptance grep for the advisory line printed 1 under the neuter, 0 at rest). Ran the new pin: exit 1, `Tests  1 failed | 4 passed (5)`.

```
FAIL |jsdom| src/__tests__/discovery-watchlist-e2e-wiring.test.ts > the discovery watchlist e2e spec stays in the blocking lane (Phase 244 DBACC-06) > the advisory `e2e` job's list does not carry the watchlist spec
AssertionError: e2e/discovery-watchlist.spec.ts is in the advisory unseeded list, whose step has continue-on-error and which no aggregator needs: expected true to be false
```

`cp ci.yml.bak .github/workflows/ci.yml; cmp ...` -> `cmp=0`. GREEN rerun: `Tests  5 passed (5)`.

The extra-skip, fixme/only and lost-anchor arms were not neutered (the plan names W1-W3 as the representative set); they are plain presence/absence scans over the comment-stripped spec.

## Deviations from Plan

None. The plan was executed as written. The `tsc` run was an extra check, not a plan step.

## Ship gate (not measurable here)

Per the plan: the PR head SHA's `e2e-seeded` log must show the four watchlist tests passed and none skipped (`gh run view --job <id> --log | grep -a discovery-watchlist`); quote it in the ship record before merge. This closes the `[158-OPS-03] discovery-watchlist.spec.ts` TODOS bullet together with plan 03 at ship (ship deletes the entry and names it in the CHANGELOG).

## Known Stubs

None.

## Threat Flags

None. No `env:` key was added to any step (T-244-12); no package installed.

## Self-Check: PASSED

- FOUND: src/__tests__/discovery-watchlist-e2e-wiring.test.ts
- FOUND commits: 480deed7c, 821d3ebfe (both ancestors of HEAD)
- `git rev-list --count ba4930ca8..HEAD` = 2 at the time of writing, matching `commits: 2`
