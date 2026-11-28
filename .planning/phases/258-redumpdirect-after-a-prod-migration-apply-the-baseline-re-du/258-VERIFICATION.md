---
phase: 258-redumpdirect-after-a-prod-migration-apply-the-baseline-re-du
verified: 2026-11-27T21:50:00Z
status: passed
score: 6/6 must-haves verified
verified_at_sha: 6a9f7cc4405c2ecf71b9088513dd8632e5732bc1
drift_subjects:
  - .github/workflows/supabase-migrate.yml
  - scripts/baseline-redump.mjs
  - src/__tests__/baseline-redump-wiring.test.ts
  - src/__tests__/supabase-migrate-test-first.test.ts
  - src/__tests__/critical-regressions.test.ts
  - supabase/schema/BASELINE.md
  - .gitleaks.toml
behavior_unverified: 0
overrides_applied: 0
re_verification: false
---

# Phase 258: REDUMPDIRECT Verification Report

**Phase Goal:** After a PROD migration apply, the gated baseline re-dump reaches `main` with no pull request and no human click. Once `redump-dump` succeeds with a changed dump, the workflow composes the same six-path commit onto current `main` and pushes it straight to `main`.
**Verified:** 2026-11-27
**Status:** passed
**Re-verification:** No, initial verification
**Branch / HEAD:** `gsd/phase-redumpdirect` at `6a9f7cc4405c2ecf71b9088513dd8632e5732bc1`; code diff is `git diff 8aace5126 HEAD -- . ':!.planning'` (7 files).

## Goal Achievement

### Observable Truths (ROADMAP success criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | After a succeeded, changed `redump-dump`, exactly one bot commit is pushed to `refs/heads/main` with a plain push, carrying exactly the six paths; no PR, nothing waits on a human | VERIFIED | Job `redump-push` (`needs: [redump-dump]`, `if` requires `result == 'success'`, `changed == 'true'`, `github.ref == refs/heads/main`) runs one step, `--compose-and-push`. `PUSH_ARGV` is a frozen seven-element array ending `push origin HEAD:refs/heads/main`: no `+`, no force, lease, mirror, all, tags, delete or prune. `judgeStagedSet` refuses any staged set other than the six `STAGED_PATHS` (self-test arms: extra, missing, duplicate each refused; a real-push arm lands the six-path commit on a bare origin). Workflow has no live `git push` and no live `gh pr` line, and no `environment:` on the job. |
| 2 | A push refused because `main` moved is retried by re-composing onto fresh `main`, never by force; bounded; any other failure fails at once | VERIFIED | `composeAndPush`: on non-zero status it fetches `origin/main` anonymously; tip equal to `base` throws "not a race" at once; otherwise `git reset --hard <fresh>` and re-compose (never rebase). `MAX_PUSH_ATTEMPTS = 3`, third refusal throws naming the cause. A fetch failure is MEASURE_FAIL. Self-test arms (`racingPush`, `refusingPush`, a retry arm with token-scrub check) cover race-then-land, unmoved refusal and the bound. Neutering the bound to 9 turned the self-test RED. See WR-01 for one rare misreport. |
| 3 | `VERSION` and `package.json` stay byte-equal 4-digit strings in the pushed commit | VERIFIED | Compose is unchanged here: `nextVersion` + `bumpPackageJson` + `judgeVersionBump` run before every commit, including each retry (the retry re-calls `compose`). The real-push self-test arm asserts VERSION equals `package.json` version as a 4-digit string on the pushed commit. `critical-regressions.test.ts` still asserts byte-equality repo-wide and passes. |
| 4 | Wiring tests pin the single push refspec to `main`; each new pin goes RED under a neutered copy and GREEN when restored (PROOF-01) | VERIFIED | The three test files were retargeted (`REDUMP_PR_JOB` to `REDUMP_PUSH_JOB`, new push/PUSH_ARGV/script-region/token-order pins). Every pin goes through `calibrate()` (mutant must differ, predicate must hold on real text and fail on mutant). I ran four independent neuters myself against byte backups: refspec `+HEAD:refs/heads/main` (wiring pin RED plus script self-test RED), live `git push --force` in the workflow (four pins RED), `pull-requests: write` on `redump-push` (permissions pin RED), `MAX_PUSH_ATTEMPTS = 9` (self-test RED). Both files restored byte-equal (`shasum` compared); worktree clean of code changes afterward. |
| 5 | `258-CONTEXT.md` states what a GITHUB_TOKEN push to `main` means (no workflow starts, no CI on the bot commit, Railway deploys a check-less commit) and the choice made | VERIFIED | CONTEXT sections "What a GITHUB_TOKEN push to main means, and the choice made" cover: zero Actions runs by construction (and that it is not the skip-trailer failure), what verifies the commit (all pre-push, automated), what is given up (full `ci.yml` and `sql-function-snapshot.yml` on the re-dump tree until the next push, with the #1398 and #1406 precedents), Railway measured behaviour, the next push's `predecessorVerdict` reading `absent`, Vercel. Each states CHOSEN and a reversibility. The same facts are mirrored as dated CORRECTED notes in the workflow comments (a to h plus residuals). Deviation record against 164.9.5 D-13 and D-23 is in CONTEXT and ROADMAP. |
| 6 | No skip-CI token in any commit message, PR body or prose; no AI attribution lines; nothing under `.planning/` is on the ship branch | VERIFIED (as scoped) | `git log 8aace5126..HEAD` message bodies grepped for the six skip tokens and for `Co-Authored-By`, `Claude-Session`, `Generated with`: no hits. The same patterns over added lines of the code diff: no hits. Added lines contain no home path or username. Code diff touches only 7 non-planning files; no code change lives under `.planning/`. The "nothing under `.planning` on the ship branch" half is enforced at ship time by the filtered branch, as the caller scoped. |

**Score:** 6/6 truths verified (0 present-but-behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scripts/baseline-redump.mjs` | `--compose-and-push`, `PUSH_ARGV`, `MAX_PUSH_ATTEMPTS`, `takePushToken`, bot-PR machinery deleted | VERIFIED | All present and substantive; CLI accepts only `--self-test [--with-gitleaks]`, `--gate-dump`, `--compose-and-push`. No `botPrStatus`, `BOT_BRANCH`, `composePrBody`, `gh pr` left in live code. |
| `.github/workflows/supabase-migrate.yml` | `redump-push` job, `contents: write` only | VERIFIED | `permissions: contents: write` alone, `persist-credentials: false`, three SHA-pinned actions, 15-minute timeout, `GH_TOKEN` on exactly one step. `actionlint` exit 0. |
| Three wiring test files | Retargeted pins | VERIFIED | 255 tests pass across the four named files. |
| `supabase/schema/BASELINE.md`, `.gitleaks.toml` | Prose and one comment only | VERIFIED | Additive prose; no rule, regex or allowlist changed. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `redump-dump` | `redump-push` | `needs:` + `if:` on result and `changed` output | WIRED | Line-exact pins in the wiring test. |
| `redump-push` step | script mode | `node scripts/baseline-redump.mjs --compose-and-push --in "${RUNNER_TEMP}/redump-in"` | WIRED | Only live line carrying `GH_TOKEN`. |
| `main()` | token isolation | `takePushToken(process.env)` is the first statement of the branch | WIRED | Pinned by `tokenTakenFirst` (calibrated against plain read and copied env). Only `pushToMain` re-adds the token to a child env. |
| `composeAndPush` | `compose()` | called on every attempt | WIRED | Retry re-runs all refusals and version pick. |

### Data-Flow Trace (Level 4)

Not applicable: CI tooling, no rendered dynamic data. The data path (artifact from `redump-dump`, composed by `redump-push`) is exercised end to end by the script's real-push self-test arm against a bare origin.

### Behavioral Spot-Checks and Evidence Re-run

| Check | Command | Result | Status |
|-------|---------|--------|--------|
| Script self-test | `node scripts/baseline-redump.mjs --self-test` | `baseline-redump self-test OK: 201 assertion(s)` | PASS |
| Self-test with real gitleaks | `... --self-test --with-gitleaks` | `OK: 210 assertion(s) (with gitleaks)` | PASS |
| Wiring and contract suites | `npx vitest run` on `baseline-redump-wiring`, `supabase-migrate-test-first`, `critical-regressions`, `ghcr-login-before-image-pull.contract` | 4 files, 255 tests passed | PASS |
| Workflow lint | `actionlint .github/workflows/supabase-migrate.yml` | exit 0, no output | PASS |
| Neuter proofs (4) | see truth 4 | each RED, restored byte-equal | PASS |

### Probe Execution

No `probe-*.sh` declared by the phase. Skipped.

### Requirements Coverage

Phase declares no requirement id (CI-only). No orphaned requirements.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `scripts/baseline-redump.mjs` | `composeAndPush`, refusal branch (about 1489-1512) | Push that lands but exits non-zero is read as "main moved" (WR-01) | Warning (MEDIUM, booked, not fixed) | Wrong job log or a red job after a correct push; `main` content is correct. See below. |

No `TBD`/`FIXME`/`XXX` markers introduced by the code diff.

### Known Items Recorded, Not Gaps

1. **WR-01 (REVIEW.md, MEDIUM, non-user-facing, booked not fixed per the repo review rule).** If git exits non-zero although the remote accepted the update (for example a connection drop after receive-pack updated the ref), the fetched tip is this run's own commit, which differs from `base`. The loop treats that as "main moved", resets to its own commit and re-composes; compose then reports the pair already on `main`, so the job prints "nothing was pushed" and exits 0 on attempts 1 or 2, or throws a red failure on attempt 3. The commit on `main` is correct either way; only the job's record is false. Proposed fix (compare fetched tip with local HEAD before the moved/unmoved test, add one self-test arm) is in REVIEW.md. I confirmed the loop reads as the review describes. It does not defeat any success criterion: no force occurs, the bound holds, and content on `main` is right.
2. **Post-merge live proof (not provable before merge).** The first real push to GitHub needs a real run on `main` after merge: either a `workflow_dispatch` of `supabase-migrate.yml` on `main` (if open bot PR #1401 is closed unmerged) or the next migration merge, as CONTEXT "Specifics" records. Nothing in this report claims the live push works; the credential helper form is the one the script cites as proven by an earlier live run, and everything else is proven against a bare local origin. The first live run should be checked for the log lines `baseline-redump push: <sha> pushed to main on attempt N of 3`, and for the (by-design) absence of any Actions runs on the bot commit.
3. **Accepted and recorded residuals** (CONTEXT and workflow comments): the full `ci.yml` and `sql-function-snapshot.yml` verdict on a re-dump tree arrives only at the next push; Railway deploys the check-less bot commit; the next push's `predecessorVerdict` reads `absent` (FULL `sql-mutation`, no docs-only path); the D-33 truncated-dump limit now reaches `main` with no reviewer. All are founder-chosen with stated reversibility, not defects.

### Human Verification Required

None blocking. The post-merge live run in item 2 above is a proof to observe after merge, not a gate on this phase's code and docs criteria.

### Gaps Summary

No gaps. All six success criteria hold against the code: the single plain push to `refs/heads/main` is a frozen argv pinned by wiring tests that I confirmed bite under four independent neuters; the retry re-composes and is bounded at three; version byte-equality is preserved through compose; the bot-PR machinery is deleted by symbol; the GITHUB_TOKEN consequences and the choice made are stated in CONTEXT and mirrored in the workflow. One booked MEDIUM (WR-01) and the post-merge live proof are recorded above.

---

_Verified: 2026-11-27_
_Verifier: Claude (gsd-verifier)_
