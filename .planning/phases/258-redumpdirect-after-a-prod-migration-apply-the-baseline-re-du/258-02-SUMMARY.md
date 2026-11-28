---
phase: 258-redumpdirect-after-a-prod-migration-apply-the-baseline-re-du
plan: 02
subsystem: infra
tags: [baseline-redump, dead-code-removal, self-test, bot-text]
requires:
  - phase: 258-01
    provides: the direct-push path (compose-and-push, redump-push job) that made the bot-branch and PR machinery dead
provides:
  - "scripts/baseline-redump.mjs with the bot-branch check, the open-or-edit-PR mode, composePrBody and botPrStatus deleted"
  - "composeCommitTitle (renamed from composePrTitle, text unchanged)"
  - "CHANGELOG entry and Regenerated section text that name the redump-push job and the direct push"
affects: [258-03]
status: complete
commits: 3
plan_head_before: 0f830f338a8b3f4e4318206a2f9172d2e65211fb
plan_head_after: 940d913d6167d70d6b7a5870766fa19ef0f6e672
actuals:
  tokens: 16700
  tasks: 3
  commits: 3
tech-stack:
  added: []
  patterns:
    - "count pin proven to bite: leave EXPECTED_ASSERTIONS stale after deleting arms, see the self-test and the wiring suite go RED"
key-files:
  created: []
  modified:
    - scripts/baseline-redump.mjs
key-decisions:
  - "D-11 (one reused PR), D-12 (approve-or-reopen) and D-24 (refuse to force-push over a human commit) are retired in code by the founder ruling of 2026-11-27; D-13's no-merge principle survives as plan 01's merge-token and gh-pr pins on the workflow"
requirements-completed: []
---

# Phase 258 Plan 02: delete the dead bot-PR machinery and correct the bot's text Summary

**`scripts/baseline-redump.mjs` now carries only the direct-push path: the bot-branch check, the open-or-edit-PR mode, `composePrBody` and `botPrStatus` are gone (net 860 lines out, 49 in), the CLI is exactly `--self-test [--with-gitleaks]`, `--gate-dump` and `--compose-and-push`, and every future bot CHANGELOG entry and Regenerated section says it was composed and pushed straight to `main` by the `redump-push` job.**

## EXPECTED_ASSERTIONS ledger (every figure was printed by a real run)

| Point | Value | With `--with-gitleaks` |
|---|---|---|
| plan start (258-01's end, re-measured) | 239 | |
| after Task 1 | 236 | |
| after Task 2 | 199 | |
| after Task 3 | 201 | 210 (`baseline-redump self-test OK: 210 assertion(s) (with gitleaks)`) |

## Final verification readings

- `node scripts/baseline-redump.mjs --self-test`: `baseline-redump self-test OK: 201 assertion(s)`
- `node scripts/baseline-redump.mjs --self-test --with-gitleaks`: `baseline-redump self-test OK: 210 assertion(s) (with gitleaks)` (gitleaks 8.30.1)
- `npx vitest run` on `baseline-redump-wiring`, `supabase-migrate-test-first`, `critical-regressions`, `ghcr-login-before-image-pull.contract`: `Test Files  4 passed (4)`, `Tests  255 passed (255)`
- `npx eslint scripts/baseline-redump.mjs`: no output
- Neither `--check-bot-branch --remote origin` nor `--open-or-edit-pr --title-file x --body-file y` is accepted. Both print `::error::unknown argument(s): … — this script takes --self-test [--with-gitleaks], --gate-dump --dump --merge --run-id --cli-version --out, or --compose-and-push --in` and exit 1.
- The twelve deleted exports (`BOT_BRANCH`, `DEFAULT_REPO`, `findPullRefsForSha`, `botBranchTip`, `judgeForeignCommits`, `judgeOpenBotPrs`, `openBotPrsCurlArgv`, `checkBotBranch`, `buildPrArgv`, `openOrEditPr`, `composePrBody`, `botPrStatus`): `still-exported=` (empty), exit 0. `composeCommitTitle` is a function and `composePrTitle` is not exported (`title-composer-renamed=true`).
- Acceptance greps: the nine deleted internals, 0 hits; `SELF-TEST 4[cd]/4`, 0 hits; `pushed straight to .main. by the .redump-push. job`, 2 hits; `left to the reviewer`, 0 hits; `export function composeCommitTitle(`, 1 hit.

## Commits

| Task | Commit | What |
|---|---|---|
| 1 (tracer) | b4a0baad9 | no-op notice says "nothing to commit", `botPrStatus` and its 3 arms deleted, self-test 236 |
| 2 | 98cb65cc2 | bot-branch check, open-or-edit-PR mode, `composePrBody`, 37 arms deleted, self-test 199 |
| 3 | 940d913d6 | composers name `redump-push` and the direct push, `composeCommitTitle`, 2 new arms, self-test 201 |

All three are this plan's own commits (`git rev-list --count` over the ledger base = 3).

## Removed self-test arms, by group (CONTEXT: the drop is deliberate)

Total self-test arms removed: 3 + 37 = 40, plus plan 01's pr-body arm (below). The 40 are named here; `EXPECTED_ASSERTIONS` was lowered by exactly the removed count at each step and re-measured from a run.

**Task 1: 3 arms in section 4c, the D-10 no-op's bot-PR status notice.** Why: the notice no longer carries a status because the no-op does no lookup, so there is nothing to assert.
- "the no-op notice names the bot branch's tip and pull request #7, and says it is not closed automatically (D-13)"
- "the no-op notice says so when the bot branch exists and no pull request points at its tip"
- "a failed bot-PR lookup is a ::warning:: naming the ls-remote exit code, and the legitimate no-op still prints changed=false and does not throw"
- Helpers deleted with them: `noopClone`, `noopNotice`, `noticeLead` and the three `remote add` lines. The 4b `noop` arm was kept and re-aimed: its new label is "a dump and marker byte-identical to HEAD's committed pair: changed=false, a ::notice:: that says nothing is committed, and no out dir at all".

**Task 2, group 1c: 8 PR-body presence arms (`D-23 presence (PR body): …`).** Why: `composePrBody` is deleted and no PR body exists, so the D-23 instructions it carried (approve workflows, branch protection is off, SHA-bound `gh api`, add the "what it adds" column, re-dispatch when main moves, close-and-reopen fallback, never auto-merged) have no text to be present in.
- the 'Approve workflows to run' instruction
- reading each run's conclusion
- branch protection is off, so a zero-check merge is possible
- the SHA-bound gh api command with the real repo and head sha
- the invitation to add the 'what it adds' column
- re-dispatching supabase-migrate.yml on main when main moved or VERSION collides
- close-and-reopen named only as a fallback
- the PR is never auto-merged

**Task 2, group 4c: 17 bot-branch-check arms.** Why: `checkBotBranch`, `findPullRefsForSha`, `botBranchTip`, `judgeForeignCommits`, `judgeOpenBotPrs`, `openBotPrsCurlArgv` and `lsRemoteBotRefs` are deleted. D-24 (never force-push over a human commit) retires with the force-push itself; the push is now a plain `HEAD:refs/heads/main`.
- findPullRefsForSha returns the refs/pull/<n>/head refs at the sha in NUMERIC ascending order, ignoring /merge refs, other shas and other refs
- findPullRefsForSha returns an empty list when no /head ref carries the sha
- an absent bot branch emits an EMPTY lease (the push's 'must not exist') and prints 'bot-branch: absent'
- a bot branch whose commits over main are all bot-authored emits lease=<its tip sha> and prs=none
- an all-bot branch whose tip refs/pull/7/head points at prints prs=#7 beside its lease
- a commit on the bot branch authored by anyone but the bot, while OPEN pull request #7 has the branch as its head, REFUSES (D-24, CR-02) …
- the refusal never prints the foreign commit's message or its author's email
- the same human commit after PR #7 was merged or closed, with no OPEN pull request, PASSES with lease=<tip> and a ::notice:: naming #7 (CR-02: no permanent wedge)
- a foreign commit with NO pull ref at its tip and no open pull request passes too, stating the measured negative
- an open-PR lookup that fails (HTTP 403, the shared anonymous budget) refuses as MEASURE_FAIL and emits no lease
- a bot-branch proposal whose marker carries a migration main's checkout holds and this commit's marker lacks is NEWER: refused, no lease, no lookup (R2-06)
- a bot-branch marker naming a migration main's checkout no longer holds is not 'newer': the lease is emitted (R2-06, WR-07)
- judgeOpenBotPrs reads only open PRs headed by the bot branch; an error object, a closed or foreign-headed entry, a bad number or non-JSON is MEASURE_FAIL
- the open-PR lookup is anonymous: curl's -q comes first, no argument carries a credential, and a malformed slug refuses
- an ls-remote that fails (a remote path that does not exist) is MEASURE_FAIL and never emits a lease
- a --remote value that is not a plain remote name (here an option) refuses before git is spawned
- a bot branch whose fetched tip differs from the ls-remote tip is MEASURE_FAIL: the lease must be the sha whose commits were judged
- (the `--remote` option-string refusal is still pinned for production code by plan 01's `fetchMainTip` arm in 4f, which uses `assertRemoteName`)

**Task 2, group 4d: 12 open-or-edit-PR arms.** Why: `openOrEditPr`, `buildPrArgv`, `readArgFile`, `realGh` and `PR_URL_RE` are deleted, so no PR is created, edited or listed by this script. D-13 (never merge) and D-14 for the PR title and body are covered on the workflow by plan 01's merge-token and gh-pr pins and by the `--compose-and-push` skip-token arms.
- buildPrArgv with no open PR is 'pr create …', the title and the body file bound to their flags
- buildPrArgv with one open PR is 'pr edit <n>', and it refuses a PR number that is not a positive integer
- neither argv carries the merge subcommand, the auto flag, a review or an approval (D-13)
- no open PR on the bot branch: one list, one create, pr_number from the URL gh printed
- exactly one open PR: it is edited in place (D-11), and pr_number is that PR
- two open PRs on the bot branch refuse, naming both in ascending order, and nothing is created or edited
- judgeSkipTokens re-runs over the title and body: a hit in either refuses by class index before gh is called at all (D-14)
- a failing 'gh pr list' is MEASURE_FAIL: nothing is created or edited on an unmeasured count
- a 'gh pr list' answer that is not an array of PR numbers is MEASURE_FAIL
- a failing 'gh pr create' is MEASURE_FAIL, exit 1, and no pr_number is emitted
- a missing title or body file refuses with ::error:: before any gh call
- no GH_TOKEN, or a GITHUB_REPOSITORY that is not <owner>/<name>, refuses before any gh call (a local keyring login is never used)

**From plan 01 (already counted in its own ledger, listed here for the phase record):** the arm labelled `--compose writes <out>/pr-body.md beside pr-title.txt, carrying the repo and the bot commit's own head sha, and no skip token` was deleted by plan 01 because compose no longer writes any PR file.

**Edited, count unchanged (Task 2):** the 1c fixed-template skip-token arm is relabelled `the fixed templates (entry, commit message, commit title, regenerated section) carry no CI skip token (D-14)`; the 1e judgeSkipTokens arm is relabelled `judgeSkipTokens passes the commit message and commit title composed from the fixed templates`. `repo` and `headSha` are gone from the `M` fixture. The 1c section header no longer promises PR-body instructions.

**Added (Task 3):** two 1c arms, "the CHANGELOG entry and the Regenerated section each name the `redump-push` job and say the commit went straight to `main`, and neither names the old job, a reviewer or a pull request (T-258-07)" and "composeCommitTitle(M) is exactly the commit title text, and the first line of composeCommitMessage(M) equals it".

## PROOF-01 readings (verbatim; each restored with `cp` from a byte backup in the session scratchpad and confirmed with `cmp`)

The scratchpad path is not recorded here (public repo). Self-test lines are cut at 230 to 330 characters by the display filter.

### Task 1: the old trailing clause put back in the notice

```
--- RED
  FAIL — a dump and marker byte-identical to HEAD's committed pair: changed=false, a ::notice:: that says nothing is committed, and no out dir at all
=== SELF-TEST FAILED: 236 assertion(s) run, at least one did not hold ===
restored: cmp identical
--- GREEN
baseline-redump self-test OK: 236 assertion(s)
```

Then `npx vitest run --maxWorkers=2 src/__tests__/baseline-redump-wiring.test.ts`: `Test Files  1 passed (1)`, `Tests  19 passed (19)`.

### Task 2: EXPECTED_ASSERTIONS left at 236 after the 37 arms were deleted

```
--- RED (EXPECTED_ASSERTIONS left at 236):
=== SELF-TEST FAILED: 199 assertion(s) ran, but this self-test declares 236. An arm was deleted, skipped, or added without updating EXPECTED_ASSERTIONS or EXPECTED_GITLEAKS_ASSERTIONS. A shrinking self-test that still says PASSED is the defect. ===
     × node scripts/baseline-redump.mjs --self-test exits 0 and prints its OK line (D-18) 19352ms
 Test Files  1 failed (1)
      Tests  1 failed | 18 passed (19)
--- GREEN (EXPECTED_ASSERTIONS = 199):
baseline-redump self-test OK: 199 assertion(s)
restored: cmp identical   (cmp of the 199 file against its byte backup)
```

### Task 3: the new arms, first written against the old text

Before the composers were edited, the two new arms were run against the old code:

```
  FAIL — the CHANGELOG entry and the Regenerated section each name the `redump-push` job and say the commit went straight to `main`, and neither names the old job, a reviewer or a pull request (T-258-07)
  FAIL — composeCommitTitle(M) is exactly the commit title text, and the first line of composeCommitMessage(M) equals it
=== SELF-TEST FAILED: 201 assertion(s) run, at least one did not hold ===
```

After the implementation, each was neutered once:

```
##### T3-1 old job name back into the entry's provenance bullet
--- RED
  FAIL — the CHANGELOG entry and the Regenerated section each name the `redump-push` job and say the commit went straight to `main`, and neither names the old job, a reviewer or a pull request (T-258-07)
=== SELF-TEST FAILED: 201 assertion(s) run, at least one did not hold ===
--- restored: cmp identical
--- GREEN
baseline-redump self-test OK: 201 assertion(s)
##### T3-2 one character of the title template
--- RED
  FAIL — composeCommitTitle(M) is exactly the commit title text, and the first line of composeCommitMessage(M) equals it
=== SELF-TEST FAILED: 201 assertion(s) run, at least one did not hold ===
--- restored: cmp identical
--- GREEN
baseline-redump self-test OK: 201 assertion(s)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Stale claim] Two self-test comments named the deleted bot branch**
- **Found during:** Task 2
- **Issue:** the gate-dump fixture comment said "every D-10 no-op now asks `origin` for the bot branch", and the 4e comment said it shares nothing with "the bot-branch fixtures above". Both described code this task deleted.
- **Fix:** reworded both to say only what is true now. The fixture's local bare `origin` itself is kept, so no arm reaches a missing remote by accident.
- **Files modified:** `scripts/baseline-redump.mjs`
- **Commit:** 98cb65cc2

**2. [Rule 1 - Stale claim] Two compose-region comments from plan 01 still described the bot PR**
- **Found during:** Task 3
- **Issue:** a comment said CI runs `dump-sql-functions.ts --check` "on the bot PR through `sql-function-snapshot.yml` once the PR's runs are approved", with a CORRECTED line below it; a second said the judged set "was WIDENED" because "the PR body … is gone". The plan asks every production-region comment to stop naming a pull request as current behaviour, with one dated header line as the only lineage mention.
- **Fix:** each is now one present-tense statement. Only the header's dated line and `gateDump`'s dated D-10 line (which the plan prescribes verbatim) still mention a pull request. Comment text only, no logic changed.
- **Files modified:** `scripts/baseline-redump.mjs`
- **Commit:** 940d913d6

**3. [Plan intent] The two `redump-push` provenance sentences are written as plain double-quoted strings**
- **Found during:** Task 3
- **Issue:** the plan's acceptance grep `pushed straight to .main. by the .redump-push. job` (at least 2 hits) matches one character on each side of `main`. In a template literal the backticks are escaped (`\``), two characters, so the grep would read 0.
- **Fix:** the segment carrying that phrase is a double-quoted string with literal backticks, concatenated into the same text. The composed output is byte-identical to the plan's specified wording; the grep reads 2.
- **Files modified:** `scripts/baseline-redump.mjs`
- **Commit:** 940d913d6

**4. [Process] Task 2 is `type="auto"` and was proven with the count pin only**
The plan's PROOF-01 for Task 2 is the stale-count RED, which is recorded above. Task 2 deletes code and arms, so there is no new arm to neuter.

## Authentication gates

None.

## Known Stubs

None.

## Threat Flags

None. T-258-07, T-258-08 and T-258-09 are mitigated as planned: the composers name `redump-push` and the direct push with a wording arm that forbids the old job, "reviewer" and "pull request"; the PR-opening mode, its gh wrapper and its flags are deleted and exit 1 as unknown arguments; the no-op notice was rewritten in the same commit that deleted the lookup, and the wiring suite's spawned `--gate-dump` arm passed after it.

## What is NOT proven

- `redump-pr` still appears in `.github/workflows/supabase-migrate.yml` comments, `src/__tests__/critical-regressions.test.ts`, `supabase/schema/BASELINE.md` and `.gitleaks.toml`. This plan's write scope is the script only; plan 03 owns them.
- The text the bot writes is proven by the self-test's fixtures. The first real bot commit after merge is the first time it lands in `CHANGELOG.md` and `BASELINE.md`.

## Self-Check: PASSED

- File `scripts/baseline-redump.mjs` exists and carries `export function composeCommitTitle`.
- Commits `b4a0baad9`, `98cb65cc2` and `940d913d6` are ancestors of HEAD on `gsd/phase-redumpdirect`.
- `STATE.md` and `ROADMAP.md` were not touched.
