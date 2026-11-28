---
phase: 258-redumpdirect-after-a-prod-migration-apply-the-baseline-re-du
reviewed: 2026-11-27T21:40:00Z
depth: deep
files_reviewed: 7
files_reviewed_list:
  - .github/workflows/supabase-migrate.yml
  - scripts/baseline-redump.mjs
  - src/__tests__/baseline-redump-wiring.test.ts
  - src/__tests__/supabase-migrate-test-first.test.ts
  - src/__tests__/critical-regressions.test.ts
  - supabase/schema/BASELINE.md
  - .gitleaks.toml
findings:
  critical: 0
  warning: 1
  info: 0
  total: 1
  necessity: 0
status: issues_found
---

# Phase 258: Code Review Report

**Reviewed:** 2026-11-27T21:40:00Z
**Depth:** deep
**Files Reviewed:** 7
**Status:** issues_found

## Summary

Scope: `git diff 8aace5126 HEAD -- . ':!.planning'` in the `gsd/phase-redumpdirect` worktree.
Severity bar, as the caller set it: MEDIUM and above only. A MEDIUM is filed under `## Warnings`.
Removing human review was decided by the founder ruling and is not a finding.

What I ran, at the worktree HEAD:

- `node scripts/baseline-redump.mjs --self-test` printed `baseline-redump self-test OK: 201 assertion(s)`.
- `npx vitest run` on `baseline-redump-wiring.test.ts`, `supabase-migrate-test-first.test.ts` and `critical-regressions.test.ts`: 3 files, 238 tests, all passed.
- I compared the self-test assertion messages between `8aace5126` and HEAD. Every removed `ok(` arm is about the bot branch, the lease, the open-PR lookup, `gh pr` or the PR title or body. Two arms were replaced by arms for their new form: the `--remote` refusal (now the `fetchMainTip` arm) and the skip-token arm (now over the CHANGELOG entry and the Regenerated section). No proof unrelated to the PR machinery was deleted.

Checked with no finding:

- **Workflow job.** `redump-push` has `permissions: contents: write` and nothing else, checks out with `persist-credentials: false`, and has job-level `timeout-minutes: 15`. Its three actions are pinned to a SHA. Its live `run:` bodies contain no `${{ }}`. `GH_TOKEN` appears on exactly one live line, in the `--compose-and-push` step. The workflow has no live `git push` or `gh pr` line. No `steps.compose` or `steps.botbranch` reference is left.
- **Where the token goes.** `takePushToken(process.env)` is the first statement of the `--compose-and-push` branch, ahead of `cwdRepoRoot()`. These all inherit the scrubbed `process.env`: `realRunner`, `git()` (which reads `opts.env ?? process.env` at call time), compose's `merge-base` spawn, `anonGit` and the commit env. Only `pushToMain` adds `GH_TOKEN` back. An empty token, or `GH_TOKEN=""` beside a set `GITHUB_TOKEN`, is refused before anything is composed. No git hook can inherit the token: the job runs no `npm ci`, `package.json` has no `prepare` or husky script, the repo has no `.husky` or `.githooks` directory, and checkout sets no `core.hooksPath`.
- **Logs.** `pushToMain` prints git's stderr only, at most 2000 characters, and the token is never in argv. `anonGit` prints no stderr. Compose and the push print sha prefixes, counts and gate summary lines. Nothing prints a line of the dump.
- **Retry loop.** These cases are all handled correctly:
  - A refusal with main unmoved fails at once.
  - A fetch failure is MEASURE_FAIL and HEAD is not reset.
  - `reset --hard` runs only after a successful fetch shows that main moved, on a tree that is clean apart from the discarded local bot commit.
  - The re-compose re-runs every refusal: ancestry, the marker that may only grow, drift, currency, staleness, the version mirror, the staged-set judge and the skip token.
  - A race that lands the same pair turns into a green no-op.
  - The attempt bound is exact.
- **Pins bite.** Every new wiring pin goes through `calibrate()`, which requires the mutant to differ from the real text, the predicate to hold on the real text, and the predicate to go false on the mutant. The script-region split is calibrated in both directions: a push seeded above the self-test marker is caught, and a push seeded below it is ignored. `tokenTakenFirst` is calibrated against both a plain read and a copied env.
- **Stale references.** The remaining mentions of `redump-pr`, `automation/baseline-redump`, `--check-bot-branch` and `--open-or-edit-pr` are dated lineage, or historical `### Regenerated` sections that the CONTEXT says must not be rewritten.
- **CI/CD rubric** (`cicd-review-patterns.md`, read): no `npm install`, no `continue-on-error`, no unpinned action, and the timeout is present. `cancel-in-progress: false` is the deliberate serialisation this workflow relies on, not a missing guard.
- **Necessity rubric** (`necessity-review.md`, read): no MEDIUM necessity finding.

## Warnings

### WR-01: A push that reaches `main` but exits non-zero is reported as "nothing was pushed", or turns the job red on attempt 3

**File:** `scripts/baseline-redump.mjs`, `composeAndPush` (the refusal branch after `push({ repoRoot, token })`, lines 1489-1512)

**Issue:** After a non-zero push status, the loop fetches main and compares the tip only with `base`, the commit this attempt composed onto. It never compares the tip with the local HEAD it just tried to push. Suppose git exits non-zero although the remote accepted the ref update. For example, the connection drops after receive-pack has updated `refs/heads/main` but before the client reads the report. Then the fetched tip is this run's own bot commit, which differs from `base`, so the code reads its own push as "main moved":

- **Attempt 1 or 2.** It prints `::notice:: … the push was refused because main moved from <base> to <own commit>`, runs `reset --hard` to its own commit, and re-composes. Compose's second D-10 check finds the pair already committed and returns `committed: false`. `composeAndPush` then prints `nothing was pushed: the composed pair is already on main`, emits `pushed=false`, and exits 0. The commit on `main` came from this run, but the job's own log says nothing was pushed.
- **Attempt 3.** It throws `the push to main was refused 3 time(s) and main moved each time (now <own commit>); nothing was pushed`, and the job goes red. The commit really is on `main`.

`main`'s content is correct in every branch, so this is not a data-integrity defect. The defect is that the job's record is false. After this phase that record matters more: no workflow runs on the bot commit and no human reads it, so the job log is the only account of what reached `main`. The precondition is rare, since git must exit non-zero after the remote accepted the update. I found this by tracing the code, not by a run. No self-test arm covers it: `racingPush` always lands a race commit before the real push, and `refusingPush` never touches the remote.

**Fix:** Before the moved/unmoved branch, treat a fetched tip equal to the local HEAD as a successful push. Add one self-test arm whose push seam runs the real `pushToMain` and then returns `{ status: 1 }`.

```js
const { status } = push({ repoRoot, token });
const head = git(repoRoot, ["rev-parse", "HEAD"]).trim();
if (status === 0) { /* unchanged success path */ }
const fresh = fetchMain({ repoRoot, remote });
if (fresh === head) {
  console.log(`::notice::baseline-redump: git reported the push as failed, but main's tip is this run's commit ${short(head)}; it landed on attempt ${attempt}`);
  emit("committed", "true");
  emit("pushed", "true");
  return { pushed: true, attempts: attempt };
}
if (fresh === base) { /* unchanged: not a race */ }
```

New self-test arm: a seam `({ repoRoot, token }) => { pushToMain({ repoRoot, token }); return { status: 1 }; }`. Assert `pushed === true`, `attempts === 1`, a single push call, and bare tip equal to the clone's HEAD. Add 1 to `EXPECTED_ASSERTIONS`.

---

_Reviewed: 2026-11-27T21:40:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: deep_
