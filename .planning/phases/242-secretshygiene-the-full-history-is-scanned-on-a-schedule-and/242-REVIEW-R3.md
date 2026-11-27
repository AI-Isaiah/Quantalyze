---
phase: 242-secretshygiene-the-full-history-is-scanned-on-a-schedule-and
reviewed: 2026-11-27T13:55:00Z
depth: standard
round: 3
files_reviewed: 2
files_reviewed_list:
  - .github/workflows/secret-scan-full-history.yml
  - src/__tests__/secret-scan-full-history.test.ts
findings:
  critical: 0
  warning: 0
  info: 1
  total: 1
status: issues_found
---

# Phase 242: Code Review Report, round 3 (final, after fix round 2)

**Reviewed:** 2026-11-27T13:55:00Z
**Depth:** standard
**Files Reviewed:** 2. Scope is fix commit `b9d1ac8cf`, read against HEAD `9dc3b4dad`.
**Status:** issues_found (Info only. Nothing at MEDIUM or above.)

## Summary

I re-checked round 2's CR-01, WR-01 and WR-02 by running the workflow's own steps, not by reading the fixer's report. I extracted the self-test step and the scan step byte for byte from the workflow (awk on the step bodies) and ran them under gitleaks 8.30.1 and git 2.39.5. Every throwaway repo sat in the session scratchpad. Nothing in the worktree changed apart from this file.

**CR-01: fixed.**
- **Real history.** I ran the extracted scan step in a fresh `git clone` of the worktree, the same shape as `actions/checkout` with `fetch-depth: 0`. It printed `2790 commits scanned` and `gitleaks exit code: 0`, with no `MEASURE_FAIL`. So `want` equals gitleaks' count.
- **Edge cases round 2 did not cover.** Each commit was made alone, and I compared `want` with gitleaks' `commits scanned` after each one. All of these agree:
  - a `.gitattributes` commit;
  - a file under a `-diff` attribute (git treats it as binary);
  - a submodule add;
  - a submodule bump with nothing else in the commit;
  - a merge whose modify/delete conflict was resolved by deleting the file. Its remerge diff carries a `deleted file mode` header. `--diff-filter=d` drops it from `want`, and gitleaks skips it as a delete, so neither side counts the merge.
- **The floor works.** `! [ "${want}" -gt 0 ] ||` sends a zero, empty or non-numeric `want` to `exit 1`.

**WR-01: fixed.**
- **The fixtures now share a site.** The first two sit at the same path and line (`src/planted.pem`, line 1). The second fixture uses a different key-type word. Under `-U0`, all three lines of the block change, so gitleaks sees a whole new block. A fixture with the same header would show only its middle line as added, and nothing would match.
- **The assertions now discriminate.** A file-scoped suppression can no longer pass the four-part assertion. The three-part global line and the inline-comment line are each measured with their own counts.
- **Runs.** The extracted self-test printed `gitleaks self-test passed` five times out of five.
- **Rule id.** `.gitleaks.toml` extends the default ruleset (`useDefault = true`), so the rule id `private-key` in the three-part line is the real one.
- **False findings.** A random base64 middle line contains no operator character and no dash. So the generic-api-key rule and the prefix rules that need `-` or `_` cannot fire on it. A rule like `AIza…` matching by chance has a probability of about 1e-6 per fixture. That is far too small to false-red the daily run.

**WR-02: fixed for the bounded items.**
- **The test file passes.** `npx vitest run src/__tests__/secret-scan-full-history.test.ts` gave 15 passed out of 15.
- **The new pins hold.** Each calibration copy goes red: `--no-color`, `exit 1` in the coverage branch, `exit 1` in `fail()`, a step-level `if:` on either step, an `exit` or an `rc=` reassignment after `rc=$?`, the `want` floor, and the changed-line condition.
- **The `if:` checks catch the one placement they miss.** An `if:` written before `name:` (`- if: false` / `name: …`) makes `stepSlice` return null, and a null step fails every needle. So that placement is caught too.
- **A job-level `if: false`.** It skips `scan`, and `report` (`needs.scan.result != 'success'`) then files an issue. That case is loud, not silent.

**False-red on a real runner (newer git, `ref: main`, `fetch-depth: 0`).** Round 2 adds nothing that depends on the git version:
- **The count.** Both `want` and gitleaks call the same runner git with the same `--remerge-diff HEAD` scope.
- **The self-test.** It sets `-b main` and user identity on every command, and builds the merge with `--no-commit`. `node` comes preinstalled on `ubuntu-24.04`.

Runner git is still unmeasured, as round 2 said. The first scheduled run after merge will be the first runner evidence, and both checks fail closed.

**False-green.** I found no path introduced by round 2:
- The self-test's `count` helper fails if a report is missing or malformed. The `[` comparison then errors, and `fail` runs, because a failed command substitution inside a test argument does not trip `set -e`.
- The scan step's `got` falls back to `0` when the log has no count line.

**Not re-raised (accepted residuals):** the vitest real-binary arm skipping on CI, and round 2's IN-01 (an incomplete scan files an issue reading `Findings: 0`).

**Not done.** I did not read `necessity-review.md` this round, so no necessity classification is given and `necessity:` is omitted from the frontmatter. No newer git was available locally (Apple git 2.39.5 only), so runner-git behaviour is reasoned, not measured.

## Info

### IN-01: Two more control-flow edits still pass every fail-red pin, because the pins match strings

**File:** `src/__tests__/secret-scan-full-history.test.ts:230-262` (`failRedProblems`), workflow `.github/workflows/secret-scan-full-history.yml:174`
**Issue:** I copied `failRedProblems` and its helpers out of the test file and ran them under Node's type stripping on two bad copies of the real workflow. Both returned `[]`, the same result as the real file:
1. **`||` swapped for `&&` in the coverage condition** (`! [ want -gt 0 ] && grep … ERR … && [ got != want ]`). Every needle is still present. The check then fires only when all three hold at once, so it never fires in practice.
2. **`want="${got}"` inserted just before the `if`.** The pins forbid reassigning `rc` after the gitleaks command, but not `want`. The commit-count comparison becomes vacuous, and only the floor and the ERR grep are left.

This is the residual class of round 2's WR-02, whose item 4 (reassigning `want`) was marked optional. Round 2 did not introduce it. It is Info, not MEDIUM: each edit is a deliberate rewrite of the coverage line that a diff review shows plainly, and pins that match strings can never list every such rewrite.
**Fix (optional):** Pin the condition's exact text, for example a needle of the whole `if ! [ "${want}" -gt 0 ] || grep -aq ' ERR ' "${log}" || [ "${got}" != "${want}" ]; then` line. Then refuse any `want=` assignment other than the derivation.

---

_Reviewed: 2026-11-27T13:55:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_

## Round 3 — silent-failure-hunter (recorded by the orchestrator)

All three round-2 MEDIUMs closed; no new MEDIUM+ finding. One LOW: string-based pins still let a deliberate edit (`got=${want}`, `-ge 0` comparators, a fixed `count()`/`scan()`) neuter an assertion. Recorded here only (LOW/Info are not booked or fixed).

Review loop result: converged at round 3 with 0 CRITICAL, 0 HIGH, 0 MEDIUM from both reviewers. migration-reviewer and rls-policy-auditor: 0 findings (round 1; the migration did not change after round 1).
