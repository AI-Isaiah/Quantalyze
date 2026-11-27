---
phase: 242-secretshygiene-the-full-history-is-scanned-on-a-schedule-and
reviewed: 2026-11-27T12:40:00Z
depth: standard
round: 2
files_reviewed: 3
files_reviewed_list:
  - .github/workflows/secret-scan-full-history.yml
  - src/__tests__/secret-scan-full-history.test.ts
  - .gitleaksignore
findings:
  critical: 1
  warning: 2
  info: 3
  total: 6
status: issues_found
---

# Phase 242: Code Review Report, round 2 (after fix round 1)

**Reviewed:** 2026-11-27T12:40:00Z
**Depth:** standard
**Files Reviewed:** 3. The fix diff runs from `e52c6442d^` to `HEAD` (`e3122f0b1`) over `.github`, `.gitleaksignore` and `src`.
**Status:** issues_found

## Summary

Scope is the round-1 fix commits `e52c6442d`, `d0aed2a24`, `bb22a00b6` and `8c9b2644d`. All measurements used gitleaks 8.30.1 and git 2.39.5 (local, Apple). Every experiment ran in throwaway repos under the session scratchpad. Nothing in the worktree was modified apart from this file.

**What is fixed (verified, not just pinned):**
- **WR-03 (merge diffs): fixed.** `--remerge-diff HEAD` is in the scan step, the self-test, the ignore-file instructions and the issue's reproduction command. The self-test proves gitleaks detects content that exists only in a merge commit. Replacing the log-opts with plain `HEAD` makes it fail (fixer's B3, re-read).
- **WR-01 (fail-open on a `git log` error): fixed for the case round 1 measured.** A rejected ref now gives `MEASURE_FAIL` and exit 1. On the real history, gitleaks reports `2787 commits scanned` at the current worktree HEAD, the step's `want` derivation also reads 2787, rc is 0 and the log has 0 ERR lines. So the step is green today, which is correct.
- **WR-02 / SFH-M1: fixed for the three edits round 1 named.** `--exit-code 0`, a final `exit 0` and `continue-on-error` are each refused by `failRedProblems`, and each has a calibration copy.
- **No credential-shaped literal reaches the repo.** The self-test's private-key fixture is put together at runtime from a format string, with the key-type words passed as a separate argument. The vitest fixture is built with a template literal. Neither source line matches the private-key rule's opening-marker pattern. The fixer's range scan reported 34 commits and no leaks, and I did not repeat it.

**What is not fixed, or newly broken:**
- **CR-01:** the new commit-count check false-reds on a commit class gitleaks does not count. Once one such commit is on main, every daily run is red, and only a workflow edit clears it.
- **WR-01 (below):** the self-test that is meant to re-measure the pinned binary daily cannot tell a commit-scoped suppression from a file-scoped one. SFH-M2's two named semantics are still measured nowhere in CI.
- **WR-02 (below):** the new predicates check that strings are present, not how control flows. Single edits that reopen round-1 WR-01 pass every arm.

**Not done.** I did not read `necessity-review.md` or `cicd-review-patterns.md` this round, so no necessity classification is given and `necessity:` is omitted from the frontmatter. Runner git (ubuntu-24.04) is newer than the git 2.39.5 used here. The workflow cannot be dispatched until it is on main, so its first scheduled run after merge will be the first evidence from a runner. Both the self-test and the count check fail closed there.

## Critical Issues

### CR-01: The `want` derivation counts zero-line file changes that gitleaks does not, so one ordinary commit makes the scan permanently red

**File:** `.github/workflows/secret-scan-full-history.yml:163-166`
**Issue:**
- **The rule the fix assumed.** The awk counts a commit when any `--numstat` row has `$1 != "-"`, on the stated rule that gitleaks counts commits that have a non-binary, non-deleted file. That rule is incomplete. gitleaks counts a commit only when such a file also has a hunk. A numstat row of `0	0` (no lines added or removed) has no hunk.
- **Measured.** In a throwaway repo, under the repo's `.gitleaks.toml`, each case was committed alone and the step's `want` was compared with gitleaks' `commits scanned`:

  | commit content | `want` +1 | gitleaks +1 |
  |---|---|---|
  | text file mode change only (`chmod +x`) | yes | **no** |
  | empty file added (for example a `.gitkeep`) | yes | **no** |
  | pure text rename (`git mv`, 100% similarity) | yes | **no** |
  | binary add, binary rename, binary mode change, a commit touching only an allowlisted path, a deletion-only edit, a symlink add, an empty commit, a clean merge, a merge resolved with "ours" | agree | agree |

- **Why it is green today.** On the real history, both the current awk and the corrected one below give 2787, which equals gitleaks. No commit on main yet consists only of zero-line changes. The defect is latent.
- **What triggers it.** A squash merge that only renames files, only `chmod +x`'s a script, or only adds an empty placeholder file. Each is a normal commit. From then on `want` exceeds `got` by one on every run.
- **Consequence.** History is immutable, so the red is **permanent**. It recurs every day until the workflow is edited. Each run:
  - files or comments on the issue with `Findings: 0`, a count that tells the maintainer nothing (see IN-01);
  - attaches a failing check to main's head SHA, which the header says can block a Railway redeploy of that SHA.

  Any real finding after that arrives only as a comment on an issue that is already red. An alarm that is always red no longer signals anything.

**Fix:** Count only rows that add or remove at least one line. All ten edge cases and the real history (2787) then agree with gitleaks.
```bash
want=$(git log --remerge-diff --diff-filter=d --numstat --format='commit %H' HEAD |
  awk '/^commit /{if(h&&n)c++; h=1; n=0; next} NF>=3 && $1!="-" && ($1+$2)>0{n=1} END{if(n)c++; print c+0}')
```
Fix the comment at lines 160-162 to say "a non-binary, non-deleted file with at least one changed line". Add a needle for `($1+$2)>0` to `failRedProblems`, with a calibration copy that removes it. Also see WR-02 item 3: refuse `want` = 0.

## Warnings

### WR-01: The self-test cannot tell a commit-scoped suppression from a file-scoped one, so round-1 WR-04 / SFH-M2 is only partly fixed

**File:** `.github/workflows/secret-scan-full-history.yml:117-143`
**Issue:**
- **Why the check cannot fail.** The two fixtures go to different paths: `src/planted.pem` in the ordinary commit and `src/planted-in-merge.pem` in the merge. The check "a four-part line suppressed a finding at another commit" (line 143) therefore cannot fail for the reason it names. A suppression that ignored the commit part would still leave the merge finding, because the merge finding is at another file.
- **Measured.** I extracted the step and replaced the four-part fingerprint (line 139) with the three-part global line for the first fixture's file, rule and line. The self-test still printed `gitleaks self-test passed`, exit 0.
- **Why that direction is the dangerous one.** Suppose a future gitleaks version starts treating a four-part line as file-scoped. That is the "GLOBAL fingerprint" trap the test file's header describes. The self-test stays green, and every `.gitleaksignore` entry silently suppresses its site in every later commit.
- **SFH-M2's semantics are still unmeasured in CI.** SFH-M2 named two semantics: a three-part line is global, and an inline comment leaves the line inert. Neither is measured in any CI path. The vitest real-binary arm, which does discriminate (two values at the same file and line), still skips on every shard. The fixer's B4 run only shows that the self-test's own line breaks when a comment is appended. That run is a manual experiment, not a gate.

**Fix:** Give the self-test the vitest arm's shape.
1. After the first plant, commit a second, different runtime-built block to the same `src/planted.pem`, so it lands at the same file and line in a later commit.
2. Assert three things:
   - The first commit's four-part line leaves the later same-site finding in place. This is the commit-scoping property.
   - A three-part `src/planted.pem:private-key:1` line suppresses both same-site findings.
   - The four-part line followed by `  # inline` suppresses nothing.
3. Pin each new `fail` needle in `selfTestProblems`, and give it a calibration copy.

### WR-02: The fail-red and self-test predicates check for strings, not control flow, so single edits that reopen round-1 WR-01 pass every arm

**File:** `src/__tests__/secret-scan-full-history.test.ts:229-251` (`failRedProblems`), `:257-278` (`selfTestProblems`)
**Issue:**
- **How it was measured.** I ran the test file's own helpers and predicates under Node's type-stripping on bad copies of the real workflow. Each copy changed code: the comment-stripped text differs. `failRedProblems`, `selfTestProblems` and `scanCommandProblems` each returned `[]` for all of these:
  1. **The coverage branch's `exit 1` changed to `exit 0` (line 168).** All five needles are still present and the last line is still `exit "${rc}"`. A scan that covered nothing then logs `MEASURE_FAIL` and stays green. That is exactly round-1 WR-01 again. The fixer's PROOF-01 reddened "the commit-count comparison removed", not this edit.
  2. **A step-level `if: false` on the scan step, or on the self-test step.** The step is skipped and the job succeeds.
  3. **The ERR grep is blind without `--no-color`, and nothing pins the flag.** Measured: with colour on, gitleaks writes the level as escape-code-wrapped `ERR`. On a rejected ref, `grep -c ' ERR '` returns 0. That leaves the count check, and the count check is vacuous when git fails for both counts. Measured in an empty repo: `want` = 0 and `got` = 0. With the ERR clause the step exits 1; without it the step exits 0. Round-1 WR-01 named a safe-directory refusal as one such failure, and that refusal hits both git invocations.
  4. Also accepted:
     - `exit 0` inserted directly after `rc=$?`;
     - `rc=0` reassigned before the final exit;
     - `want=0` reassigned before the comparison.
- **What the file claims.** The test file says each predicate is calibrated so that "a predicate that cannot fail is caught". The calibrations cover only the edits round 1 listed.

**Fix (bounded; close items 1-3, item 4 is optional):**
- In `failRedProblems`:
  - require `--no-color` on the gitleaks line;
  - require that the `if` block containing `MEASURE_FAIL: gitleaks scanned` ends in `exit 1`;
  - refuse any `exit` line between `rc=$?` and the final `exit "${rc}"` other than that one;
  - refuse an `if:` key on the scan step;
  - require `[ "${want}" -gt 0 ]` (or an equivalent floor) in the coverage condition, and add that floor to the workflow.
- In `selfTestProblems`, refuse an `if:` key on the self-test step.
- Give each new rule a calibration copy that uses the edits above.

## Info

### IN-01: A failed coverage check files an issue reading `Findings: 0`

**File:** `.github/workflows/secret-scan-full-history.yml:171-182`, `:215-218`
**Issue:** When the coverage check fails with a clean gitleaks run, the report is `[]`. The count step sets `findings=0`, and the issue body says `Findings: 0` beside `job result: failure`. The issue gives no hint that the scan was incomplete rather than dirty. The reproduction command then prints "no leaks found", which invites closing the issue unread. CR-01 would produce exactly this issue every day.
**Fix:** Emit a separate `incomplete=true` output from the scan step when the coverage check fails, pass it as an allowed env value, and print "the scan did not complete; see MEASURE_FAIL in the run log" in place of the count.

### IN-02: The self-test pins the remerge-diff flag but not the merge-only plant

**File:** `src/__tests__/secret-scan-full-history.test.ts:257-278`
**Issue:** `selfTestProblems` checks `--remerge-diff` and the `expected 2 findings` needle. It does not check that the second fixture is committed inside a merge (`merge -q --no-ff --no-commit`). An edit that plants both fixtures in ordinary commits keeps every needle and every assertion green. The step would then no longer prove merge-diff coverage.
**Fix:** Add `--no-ff --no-commit` and the "plant only in the merge commit" commit as needles, and give them a calibration copy.

### IN-03: The vitest real-binary arm still skips on every CI shard

**File:** `src/__tests__/secret-scan-full-history.test.ts:526-579`
**Issue:** This is the declared residual of fix round 1. Removing the always-passing `HAS_GITLEAKS === false` arm was right. But the only test that discriminates commit scoping, by putting two values at the same file and line, still never runs in CI. Until WR-01 is fixed, nothing in CI does.
**Fix:** Covered by WR-01.

---

_Reviewed: 2026-11-27T12:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Round 2 — silent-failure-hunter findings (MEDIUM+), recorded by the orchestrator

The round-2 silent-failure-hunter independently reported the same three defects: (1) the `want` count diverges from gitleaks on rename-only, mode-only and empty-file commits (= CR-01; its fix form `($1+0>0||$2+0>0)` is equivalent); (2) the fail-red pins check strings, not control flow: a removed coverage-branch `exit 1`, a removed `exit 1` in `fail()`, a step-level `if:` on the scan or self-test step, and an `rc=0` reset all stay green (= WR-02, plus the `fail()` case); (3) the self-test cannot prove commit-scoping because its two fixtures sit in different files, and the three-part-global and inline-comment premises are not re-measured in CI (= WR-01). LOW: no floor on `want`.

Disposition: CR-01, WR-01 and WR-02 go to fixer round 2, together with the `want -gt 0` floor and the `fail()` exit pin.

## Fix round 2

**Fixed:** 2026-11-27. **Fix commit:** `b9d1ac8cf` (CR-01, WR-01 and WR-02 in one commit: all three edit the same two files and the pins reference each other's text).
**Fixer:** Claude (gsd-code-fixer), run directly in the phase worktree. **Gates ran in:** the phase worktree, gitleaks 8.30.1, git 2.39.5.

### CR-01 measurement

Each case committed alone in a throwaway repo; `want` is the workflow's awk, `gitleaks` is its "commits scanned" (counts are running totals, so read the step between rows):

```text
case | want_old want_new gitleaks
base | 1 1 1
mode-only | 2 1 1
empty file | 3 1 1
rename-only | 4 1 1
ordinary edit | 5 2 2
empty commit | 5 2 2
```

The old awk drifted by one per zero-line commit; the new one (`($1+$2)>0`) agrees with gitleaks on every row. On this branch's history the real scan step (extracted and run as a script) printed `2788 commits scanned`, `gitleaks exit code: 0` and no MEASURE_FAIL, so `want` equals gitleaks there too. The floor is `! [ "${want}" -gt 0 ] ||` at the head of the coverage condition (a non-numeric or zero `want` takes the `exit 1` branch).

### WR-01

The self-test now plants a runtime-built private-key block in an ordinary commit, a different one at the same path and line (`src/planted.pem`, line 1) in a later commit, and a third only in a merge commit. It asserts: 3 findings with exit 2; the first commit's four-part line leaves exactly the other two; the three-part `src/planted.pem:private-key:1` line leaves only the merge-only finding; the four-part line plus `  # inline` leaves all 3. Ran 11 times locally with no failure. Neutering the script (extracted copies):

```text
=== real self-test
gitleaks self-test passed
=== V1 the first suppression is a three-part (file-scoped) line instead of the four-part one
::error::MEASURE_FAIL: gitleaks self-test: a four-part line did not suppress exactly its own commit's finding.
=== V2 the global-line check writes the four-part line instead
::error::MEASURE_FAIL: gitleaks self-test: a three-part line did not suppress both same-site findings.
=== V3 the inline-comment line is written clean
::error::MEASURE_FAIL: gitleaks self-test: an inline comment did not void the line.
```

### PROOF-01 (in-place neuter of the workflow from a byte backup, vitest run, `cp` restore, `cmp`)

    === NEUTER: coverage branch exit 1 -> exit 0
    × workflow: the scan step fails red, and refuses a clean verdict that scanned nothing 17ms
    Tests  1 failed | 14 passed (15)
    restored: cmp identical
    === NEUTER: drop --no-color from the scan command
    × workflow: the scan command is main's HEAD with merge diffs, redacted, and never verbose 6ms
    × workflow: the scan step fails red, and refuses a clean verdict that scanned nothing 20ms
    Tests  2 failed | 13 passed (15)
    restored: cmp identical
    === NEUTER: step-level if: false on the scan step
    × workflow: the scan step fails red, and refuses a clean verdict that scanned nothing 12ms
    Tests  1 failed | 14 passed (15)
    restored: cmp identical
    === NEUTER: exit 0 right after rc=$?
    × workflow: the scan step fails red, and refuses a clean verdict that scanned nothing 13ms
    Tests  1 failed | 14 passed (15)
    restored: cmp identical
    === NEUTER: rc=0 reset before the final exit
    × workflow: the scan step fails red, and refuses a clean verdict that scanned nothing 32ms
    Tests  1 failed | 14 passed (15)
    restored: cmp identical
    === NEUTER: drop the want floor
    × workflow: the scan step fails red, and refuses a clean verdict that scanned nothing 8ms
    Tests  1 failed | 14 passed (15)
    restored: cmp identical
    === NEUTER: drop the changed-line condition
    × workflow: the scan step fails red, and refuses a clean verdict that scanned nothing 31ms
    Tests  1 failed | 14 passed (15)
    restored: cmp identical
    === NEUTER: self-test: fail() does not exit
    × workflow: a pre-scan self-test proves the pinned binary detects a plant and that a four-part line suppresses one commit 13ms
    Tests  1 failed | 14 passed (15)
    restored: cmp identical
    === NEUTER: self-test: step-level if: false
    × workflow: a pre-scan self-test proves the pinned binary detects a plant and that a four-part line suppresses one commit 43ms
    Tests  1 failed | 14 passed (15)
    restored: cmp identical
    === NEUTER: self-test: second fixture at a different path
    × workflow: a pre-scan self-test proves the pinned binary detects a plant and that a four-part line suppresses one commit 8ms
    Tests  1 failed | 14 passed (15)
    restored: cmp identical
    === NEUTER: self-test: no three-part assertion
    × workflow: a pre-scan self-test proves the pinned binary detects a plant and that a four-part line suppresses one commit 28ms
    Tests  1 failed | 14 passed (15)
    restored: cmp identical
    === NEUTER: self-test: no inline-comment assertion
    × workflow: a pre-scan self-test proves the pinned binary detects a plant and that a four-part line suppresses one commit 30ms
    Tests  1 failed | 14 passed (15)
    restored: cmp identical
    === NEUTER: self-test: merge without --no-commit plant
    × workflow: a pre-scan self-test proves the pinned binary detects a plant and that a four-part line suppresses one commit 14ms
    Tests  1 failed | 14 passed (15)
    restored: cmp identical

Every restore printed `cmp` identical, and the workflow was byte-identical to the committed file afterwards; the runs below are GREEN.

### Verification

- `npx vitest run src/__tests__/secret-scan-full-history.test.ts src/__tests__/critical-regressions.test.ts src/__tests__/gitleaks-allowlist.test.ts --testTimeout=120000`: Test Files 3 passed (3), Tests 222 passed | 1 skipped (223). The secret-scan file alone passed 5 more times in a row (15 of 15).
- `actionlint .github/workflows/secret-scan-full-history.yml`: clean.
- `gitleaks git . --config .gitleaks.toml --log-opts="--remerge-diff HEAD" --redact --no-banner`: 2789 commits scanned, no leaks found, rc 0.
- `gitleaks git . --config .gitleaks.toml --log-opts=origin/main..HEAD --redact --no-banner`: 38 commits scanned, no leaks found.

### Residuals

- IN-01 (an incomplete scan files an issue reading `Findings: 0`) and IN-02 (partly covered now: the merge plant is pinned by two needles and one calibration copy) are not fixed; IN-01 was not in this round's scope. IN-03 is covered by the self-test.
- The vitest real-binary arm still skips on CI shards; the workflow self-test is the CI evidence.
- The first scheduled run on a runner (newer git) is the first runner evidence for the count check; it fails closed.
