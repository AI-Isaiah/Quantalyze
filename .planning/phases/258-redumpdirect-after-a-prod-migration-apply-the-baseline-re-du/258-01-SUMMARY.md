---
phase: 258-redumpdirect-after-a-prod-migration-apply-the-baseline-re-du
plan: 01
subsystem: infra
tags: [github-actions, supabase-migrate, baseline-redump, git-push, wiring-pins, self-test]
requires:
  - phase: 164.9.5
    provides: the redump-dump / redump-pr split, compose(), the wiring suite and the six-job no-softening roster
provides:
  - "scripts/baseline-redump.mjs --compose-and-push: compose the six-path commit onto main, then one plain push of HEAD to refs/heads/main through the frozen PUSH_ARGV"
  - "a bounded retry (MAX_PUSH_ATTEMPTS = 3) that re-composes onto the fresh main after a refusal caused by a concurrent merge, never by rebase or force"
  - "the redump-push job (permissions contents: write only, one compose-and-push step) in supabase-migrate.yml"
  - "wiring pins retargeted to redump-push, plus push, gh-pr, PUSH_ARGV, script-region and token-order pins"
affects: [258-02, 258-03]
status: complete
commits: 3
plan_head_before: 8aace5126b31483ba419510790963fb2e2f8792a
plan_head_after: cad77f949d44e97cd4bdd23d4ca638fca662fa10
actuals:
  tokens: 12000
  tasks: 2
  commits: 3
tech-stack:
  added: []
  patterns:
    - "token leaves process.env first in main(), only the push child's env carries it"
    - "retry by hard-reset to the fetched tip and re-compose; the old tip stays an ancestor"
key-files:
  created: []
  modified:
    - scripts/baseline-redump.mjs
    - .github/workflows/supabase-migrate.yml
    - src/__tests__/baseline-redump-wiring.test.ts
    - src/__tests__/supabase-migrate-test-first.test.ts
key-decisions:
  - "D-25's one-refspec principle is kept with the refspec HEAD:refs/heads/main; D-13, D-23 and D-12 are retired in the workflow by the founder ruling of 2026-11-27 (CONTEXT A6)"
  - "D-14 is kept and its judged text widened to the commit message, the composed CHANGELOG entry and the composed Regenerated section (CONTEXT A8)"
requirements-completed: []
---

# Phase 258 Plan 01: redump-push Summary

**A succeeded, changed re-dump is now composed onto current main and pushed straight to refs/heads/main by one frozen argv, retried by re-composing (never rebase, never force) at most three times; the live push is unproven until the first real run after merge.**

## Baseline readings (before the first edit)

- `node scripts/baseline-redump.mjs --self-test`: `baseline-redump self-test OK: 226 assertion(s)`.
- The four wiring files (`baseline-redump-wiring`, `supabase-migrate-test-first`, `critical-regressions`, `ghcr-login-before-image-pull.contract`): 4 files, 253 tests, all passed.

## Final readings

- Self-test: `baseline-redump self-test OK: 239 assertion(s)`.
- The four wiring files: 4 files, 255 tests, all passed. The five adjacent readers named in the plan's verification block: 5 files, 428 tests, all passed. `actionlint` exit 0, `eslint` on the two edited test files exit 0, `tsc --noEmit` exit 0.

## EXPECTED_ASSERTIONS ledger

| Point | Value | Why |
|---|---|---|
| plan start | 226 | measured |
| after deleting the pr-body arm | 225 | measured; the arm labelled `--compose writes <out>/pr-body.md beside pr-title.txt, carrying the repo and the bot commit's own head sha, and no skip token` was deleted because compose no longer writes any PR file |
| Task 1 (four new arms in section 4e) | 229 | PUSH_ARGV, takePushToken, first-try push, empty token |
| Task 2 (ten new arms in section 4f) | 239 | race then success, not a race, exhausted, re-compose no-op, newer marker, migration merge, fetch failure, remote name, token boundary across a retry, skip token |

Every other arm kept its count: the `noPr` conjuncts and the `pr4` existence conjunct were removed from existing arms without removing an `ok()`. The `tokenRun` arm was relabelled `a skip token reaching the composed CHANGELOG entry or Regenerated section refuses before the commit, naming the class index and never the token`; its predicate is unchanged apart from `noPr`.

Which artifact the 4e first-try arm composed: `art2`, on a fresh clone of `repo` at HEAD = head2 (its merge). `repo`'s HEAD had not moved, `art2` composed (`committed === true`), and the real `pushToMain` landed the six-path commit on a local bare origin on attempt 1. The fallback of gating a fresh artifact was not needed.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | f48ee0217 | script mode, job, retargeted pins, self-test 229 |
| 2 | cad77f949 | fetchMainTip, MAX_PUSH_ATTEMPTS, the bounded loop, section 4f, self-test 239, one wiring calibration fix |

`commits: 3` is the measured `git rev-list --count` over the ledger base. One of the three, `c09905f55` (`docs(258): CONTEXT states plainly what verifies the bot commit`), is not this plan's: it landed on the phase branch between my two task commits and only touches `258-CONTEXT.md`. This plan made two code commits.

## PROOF-01 readings (verbatim; each neuter was restored with `cp` and confirmed with `cmp`)

The driver wrote a byte backup per item into the session scratchpad, applied ONE neuter, ran the check, restored, asserted `cmp` identical, and re-ran the check. The scratchpad path is deliberately not recorded here (public repo). Self-test lines are cut at 210 characters by the driver's display filter, which is why some labels end mid-word; the full labels are in the script.

### Task 1

```
##### T1-1 PUSH_ARGV last element made a plus-prefixed refspec
--- RED (neutered):
FAIL — PUSH_ARGV is the frozen seven elements, one push, HEAD:refs/heads/main, no plus prefix and no force, lease, mirror, all, tags, delete or prune flag (D-25)
=== SELF-TEST FAILED: 229 assertion(s) run, at least one did not hold ===
× PUSH_ARGV is the one frozen plain push of HEAD:refs/heads/main, and the script issues no other (D-25, CONTEXT A6) 14ms
AssertionError: PUSH_ARGV must stay the seven elements ending in HEAD:refs/heads/main, with no plus prefix, force, lease, mirror, all, tags, delete or prune.: expected [ …(3) ] to deeply equal []
 Test Files  1 failed (1)
      Tests  1 failed | 18 skipped (19)
--- restored: cmp identical
--- GREEN (restored):
baseline-redump self-test OK: 229 assertion(s)
Test Files  1 passed (1)
      Tests  1 passed | 18 skipped (19)

##### T1-2 the takePushToken statement deleted from main()
--- RED (neutered):
× main()'s --compose-and-push branch takes the token out of process.env before anything else (T-258-01) 15ms
AssertionError: `const token = takePushToken(process.env);` must be the first statement of the --compose-and-push branch, before cwdRepoRoot() and composeAndPush(: every gate child inherits process.env, so a token still in it is handed to code that must never see it.: expected false to be true // Object.is equality
 Test Files  1 failed (1)
      Tests  1 failed | 18 skipped (19)
--- restored: cmp identical
--- GREEN (restored):
Test Files  1 passed (1)
      Tests  1 passed | 18 skipped (19)

##### T1-3 the CHANGELOG entry and Regenerated section dropped from the judged list
--- RED (neutered):
FAIL — a skip token reaching the composed CHANGELOG entry or Regenerated section refuses before the commit, naming the class index and never the token
=== SELF-TEST FAILED: 229 assertion(s) run, at least one did not hold ===
--- restored: cmp identical
--- GREEN (restored):
baseline-redump self-test OK: 229 assertion(s)

##### T1-4 pull-requests: write re-added to the push job
--- RED (neutered):
× permissions are exactly {contents: read, packages: read} and {contents: write} (D-05, D-21) 13ms
AssertionError: redump-push gets exactly what pushing one bot commit to main needs: contents: write. No pull-requests scope, since no PR is opened, and no actions: write.: expected { contents: 'write', …(1) } to deeply equal { contents: 'write' }
 Test Files  1 failed (1)
      Tests  1 failed | 18 skipped (19)
--- restored: cmp identical
--- GREEN (restored):
Test Files  1 passed (1)
      Tests  1 passed | 18 skipped (19)

##### T1-5 a live git push line added to the push step
--- RED (neutered):
× the workflow has no live git push and no live gh pr line; its one push step runs the --compose-and-push mode (D-25, CONTEXT A6) 12ms
AssertionError: .github/workflows/supabase-migrate.yml may not push by itself. The one push is the script's frozen PUSH_ARGV, to HEAD:refs/heads/main. Branch protection is off, so a second push line is an unpinned write to main.: expected [ Array(1) ] to deeply equal []
 Test Files  1 failed (1)
      Tests  1 failed | 18 skipped (19)
--- restored: cmp identical
--- GREEN (restored):
Test Files  1 passed (1)
      Tests  1 passed | 18 skipped (19)

##### T1-6 a live gh pr list line added to the push step
--- RED (neutered):
× the workflow has no live git push and no live gh pr line; its one push step runs the --compose-and-push mode (D-25, CONTEXT A6) 11ms
AssertionError: No gh pr call of any kind may remain in .github/workflows/supabase-migrate.yml: there is no PR to open, edit, list or merge.: expected [ Array(1) ] to deeply equal []
 Test Files  1 failed (1)
      Tests  1 failed | 18 skipped (19)
--- restored: cmp identical
--- GREEN (restored):
Test Files  1 passed (1)
      Tests  1 passed | 18 skipped (19)

##### T1-7 the env block moved from the --compose-and-push step to the self-test step
--- RED (neutered):
× credentials: step-level env: only in redump-dump; none in redump-push but its one GH_TOKEN (D-03, D-05) 10ms
AssertionError: A PROD credential outside a step-level env:, or any credential in the write-token job, breaks the D-21 split. Put it back in the step's env: and reference it as $NAME in the run body.: expected [ Array(1) ] to deeply equal []
 Test Files  1 failed (1)
      Tests  1 failed | 18 skipped (19)
--- restored: cmp identical
--- GREEN (restored):
Test Files  1 passed (1)
      Tests  1 passed | 18 skipped (19)

##### T1-8 the job key renamed back to the old name
--- RED (neutered):
× carries none of the softening tokens, in ANY of the four jobs the phase added 11ms
     × job order: divergence verdict < redump-dump < redump-push < apply, and apply is last 13ms
     × needs: and if: are line-exact on both jobs (D-01, D-02, D-21) 2ms
     × redump-dump runs in environment Production and redump-push in none (D-03, D-21) 1ms
     × permissions are exactly {contents: read, packages: read} and {contents: write} (D-05, D-21) 2ms
     × credentials: step-level env: only in redump-dump; none in redump-push but its one GH_TOKEN (D-03, D-05) 2ms
     × no run: body in either job contains an ${{ }} expression (D-03, D-18) 1ms
     × redump-dump runs the gitleaks self-test; redump-push the plain one, with no gitleaks on a live line 1ms
     × every checkout in both jobs sets persist-credentials: false (D-05, D-22) 1ms
     × the workflow carries no PR merge, auto-merge or approval token on any live line (D-13) 3ms
     × the workflow has no live git push and no live gh pr line; its one push step runs the --compose-and-push mode (D-25, CONTEXT A6) 2ms
 Test Files  2 failed (2)
      Tests  11 failed | 41 passed (52)
--- restored: cmp identical
--- GREEN (restored):
Test Files  2 passed (2)
      Tests  52 passed (52)

##### T1-9 EXPECTED_ASSERTIONS left at 226
--- RED (neutered):
=== SELF-TEST FAILED: 229 assertion(s) ran, but this self-test declares 226. An arm was deleted, skipped, or added without updating EXPECTED_ASSERTIONS or EXPECTED_GITLEAKS_ASSERTIONS. A shrinking self-test that still says PASSED is the defect. ===
× node scripts/baseline-redump.mjs --self-test exits 0 and prints its OK line (D-18) 20978ms
AssertionError: the self-test exited 1. stderr tail:
 Test Files  1 failed (1)
      Tests  1 failed | 18 skipped (19)
--- restored: cmp identical
--- GREEN (restored):
baseline-redump self-test OK: 229 assertion(s)
Test Files  1 passed (1)
      Tests  1 passed | 18 skipped (19)
```

### Task 2

```
##### T2-1 fresh === base changed to fresh !== base
--- RED (neutered):
FAIL — a push refused because main moved is retried by re-composing onto the fresh main: attempt 2 pushes a six-path commit whose parent is the race tip, VERSION one pa
  FAIL — a refused push with origin/main unmoved fails at once naming 'not a race' (auth, a ruleset or a network fault): one push call, the remote untouched
  FAIL — three refused pushes with main moving each time fail red naming 'main moved each time': exactly three push calls, and the remote tip is the third race commit
  FAIL — a race that lands the artifact's own pair on main makes the re-compose a no-op: pushed=false, committed=false emitted once, one push call
  FAIL — a race that lands a newer marker is refused by the re-compose ('the new marker omits 1 migration(s)'): one push call, the remote is the race tip
  FAIL — a re-compose whose content-drift gate reports findings (a migration merged since) is refused naming the likely cause, after one push call
  FAIL — across a retried run no gate child sees GH_TOKEN or GITHUB_TOKEN in process.env, and the push seam receives the token on both calls (T-258-01)
=== SELF-TEST FAILED: 239 assertion(s) run, at least one did not hold ===
--- restored: cmp identical
--- GREEN (restored):
baseline-redump self-test OK: 239 assertion(s)

##### T2-2 the reset --hard call deleted
--- RED (neutered):
FAIL — a push refused because main moved is retried by re-composing onto the fresh main: attempt 2 pushes a six-path commit whose parent is the race tip, VERSION one pa
  FAIL — three refused pushes with main moving each time fail red naming 'main moved each time': exactly three push calls, and the remote tip is the third race commit
  FAIL — a race that lands a newer marker is refused by the re-compose ('the new marker omits 1 migration(s)'): one push call, the remote is the race tip
  FAIL — a re-compose whose content-drift gate reports findings (a migration merged since) is refused naming the likely cause, after one push call
  FAIL — across a retried run no gate child sees GH_TOKEN or GITHUB_TOKEN in process.env, and the push seam receives the token on both calls (T-258-01)
=== SELF-TEST FAILED: 239 assertion(s) run, at least one did not hold ===
--- restored: cmp identical
--- GREEN (restored):
baseline-redump self-test OK: 239 assertion(s)

##### T2-3 MAX_PUSH_ATTEMPTS set to 4
--- RED (neutered):
FAIL — three refused pushes with main moving each time fail red naming 'main moved each time': exactly three push calls, and the remote tip is the third race commit
=== SELF-TEST FAILED: 239 assertion(s) run, at least one did not hold ===
--- restored: cmp identical
--- GREEN (restored):
baseline-redump self-test OK: 239 assertion(s)

##### T2-4 any push status treated as success
--- RED (neutered):
FAIL — a push refused because main moved is retried by re-composing onto the fresh main: attempt 2 pushes a six-path commit whose parent is the race tip, VERSION one pa
  FAIL — a refused push with origin/main unmoved fails at once naming 'not a race' (auth, a ruleset or a network fault): one push call, the remote untouched
  FAIL — three refused pushes with main moving each time fail red naming 'main moved each time': exactly three push calls, and the remote tip is the third race commit
  FAIL — a race that lands the artifact's own pair on main makes the re-compose a no-op: pushed=false, committed=false emitted once, one push call
  FAIL — a race that lands a newer marker is refused by the re-compose ('the new marker omits 1 migration(s)'): one push call, the remote is the race tip
  FAIL — a re-compose whose content-drift gate reports findings (a migration merged since) is refused naming the likely cause, after one push call
  FAIL — a refused push whose main cannot be fetched is MEASURE_FAIL: whether main moved was not measured, and HEAD was not reset
  FAIL — across a retried run no gate child sees GH_TOKEN or GITHUB_TOKEN in process.env, and the push seam receives the token on both calls (T-258-01)
=== SELF-TEST FAILED: 239 assertion(s) run, at least one did not hold ===
--- restored: cmp identical
--- GREEN (restored):
baseline-redump self-test OK: 239 assertion(s)

##### T2-5 the two delete statements inside takePushToken removed
--- RED (neutered):
FAIL — takePushToken returns GH_TOKEN over GITHUB_TOKEN, an empty string for neither, and leaves neither key in the env it was given
  FAIL — across a retried run no gate child sees GH_TOKEN or GITHUB_TOKEN in process.env, and the push seam receives the token on both calls (T-258-01)
=== SELF-TEST FAILED: 239 assertion(s) run, at least one did not hold ===
--- restored: cmp identical
--- GREEN (restored):
baseline-redump self-test OK: 239 assertion(s)
```

### Task 2 arms written first, run against the Task 1 single-attempt code

Before implementing the loop, the ten 4f arms were run against the Task 1 code (single attempt, no `fetchMainTip`). Nine FAILed; the tenth (skip token with zero push calls) already held because compose judges the date before any push:

```
  FAIL — a push refused because main moved is retried by re-composing onto the fresh main: attempt 2 pushes a six-path commit whose parent is the race tip, VERS
  FAIL — a refused push with origin/main unmoved fails at once naming 'not a race' (auth, a ruleset or a network fault): one push call, the remote untouched
  FAIL — three refused pushes with main moving each time fail red naming 'main moved each time': exactly three push calls, and the remote tip is the third race 
  FAIL — a race that lands the artifact's own pair on main makes the re-compose a no-op: pushed=false, committed=false emitted once, one push call
  FAIL — a race that lands a newer marker is refused by the re-compose ('the new marker omits 1 migration(s)'): one push call, the remote is the race tip
  FAIL — a re-compose whose content-drift gate reports findings (a migration merged since) is refused naming the likely cause, after one push call
  FAIL — a refused push whose main cannot be fetched is MEASURE_FAIL: whether main moved was not measured, and HEAD was not reset
  FAIL — fetchMainTip refuses a remote that is an option string before git is spawned
  FAIL — across a retried run no gate child sees GH_TOKEN or GITHUB_TOKEN in process.env, and the push seam receives the token on both calls (T-258-01)
=== SELF-TEST FAILED: 239 assertion(s) run, at least one did not hold ===
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wiring calibration `takePushToken given a copy of the env` stopped biting**
- **Found during:** Task 2 (the full wiring run before the Task 2 commit)
- **Issue:** the mutation `s.replace("takePushToken(process.env)", ...)` rewrites the FIRST occurrence in the script text. Task 2's token-boundary arm adds `takePushToken(process.env)` to the self-test region, which precedes the CLI region, so the mutant no longer touched `main()` and the predicate did not flip. The wiring suite reported `CALIBRATION takePushToken given a copy of the env: the predicate did NOT flip`.
- **Fix:** the calibration now replaces the whole statement `const token = takePushToken(process.env);` with `const token = takePushToken({ ...process.env });`, which exists once.
- **Files modified:** `src/__tests__/baseline-redump-wiring.test.ts`
- **Commit:** cad77f949

### Process notes (not code deviations)

- **Task 2 is `tdd="true"` but has one commit.** A RED-only commit would make `--self-test` exit 1, which reds the wiring suite's spawned-self-test arm and the commit hooks, against the plan's rule that no suite is red between commits. The plan is `type: execute` and prescribes one commit per task. The RED evidence is the run of the ten new arms against the Task 1 code (above), plus the five neuters.
- **Acceptance grep 4 reads 0 under this shell's `grep`.** `grep -c -- '--compose-and-push --in "${RUNNER_TEMP}/redump-in"'` returns 0 here (`grep` resolves to ugrep, which treats the `${` sequence as a pattern construct) and 1 under `grep -F` and `/usr/bin/grep`. The line is present; the criterion's intent holds.
- **`critical-regressions.test.ts`, `BASELINE.md`, `.gitleaks.toml` and the comments above the job key and in `redump-dump` were not touched**, as the write scope says. They still say `redump-pr`; plans 02 and 03 own them. `REPO_SLUG_RE` and `DEFAULT_REPO` stay because `checkBotBranch`, `openOrEditPr` and `main()`'s bot-mode branches still call them; plan 02 deletes those with their code.
- `composePrBody` and `composePrTitle` stay defined (plan 02 deletes and renames them); `compose` no longer calls `composePrBody`. The `title` local in `compose` was dropped as unused.

## Authentication gates

None.

## Known Stubs

None.

## Threat Flags

None. The push to `main` and the job token are the surfaces T-258-01 to T-258-06 already name.

## What is NOT proven

The live push is unproven until the first real run after merge. Everything here is proven against a local bare origin and text pins. Nothing in this plan exercises `gh auth git-credential`, the real `GITHUB_TOKEN`, or GitHub's acceptance of a `contents: write` job-token push to an unprotected `main`. The credential-helper form is taken from run 46036945243, which proved it for the old bot-branch push.

## Self-Check: PASSED

- Files: `scripts/baseline-redump.mjs`, `.github/workflows/supabase-migrate.yml`, `src/__tests__/baseline-redump-wiring.test.ts`, `src/__tests__/supabase-migrate-test-first.test.ts` all exist and carry the symbols named above.
- Commits `f48ee0217` and `cad77f949` are ancestors of HEAD on `gsd/phase-redumpdirect`.
- `STATE.md` and `ROADMAP.md` were not touched.
