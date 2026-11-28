---
phase: 258
slug: redumpdirect
status: secured
threats_open: 0
asvs_level: 2
block_on: high
audited_at_branch: gsd/phase-redumpdirect
---

# Phase 258 REDUMPDIRECT: Security Verification

Scope: the 17 threat rows of plans 01 to 03 (T-258-01 to T-258-13, plus T-258-SC once per plan).
Method: each control was located in code at the branch head and the pinning test was run.
`node scripts/baseline-redump.mjs --self-test` printed `OK: 201 assertion(s)`. The vitest files
`baseline-redump-wiring.test.ts` and `supabase-migrate-test-first.test.ts` passed 52 of 52.
Running `--open-or-edit-pr` exits 1 as an unknown argument.

**Verdict: SECURED. 0 open threats.**

## Threat register

| Threat ID | Severity | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-258-01 token inherited by gate children | high | mitigate | CLOSED | `scripts/baseline-redump.mjs` `takePushToken` deletes `GH_TOKEN` and `GITHUB_TOKEN` from `process.env`. `main()`'s `--compose-and-push` branch calls it as its first statement, before `cwdRepoRoot()` and `composeAndPush(`. `pushToMain` is the only spawn that builds an env carrying the token. `realRunner`, `git()` and `anonGit` inherit the already-stripped env. The workflow exposes the token only in the last step's `env:` (`GH_TOKEN: ${{ github.token }}`). The pinning test is the wiring test's `tokenTakenFirst` (main()'s branch takes the token out of `process.env` before anything else), neutered with two calibrations. The self-test arm "across a retried run no gate child sees GH_TOKEN or GITHUB_TOKEN" asserts `leaks.every(false)` and that the push seam gets the token on both calls. |
| T-258-02 force push or push to another ref | high | mitigate | CLOSED | `PUSH_ARGV` is `Object.freeze` over seven elements and ends in `HEAD:refs/heads/main`. It has no `+` prefix and no force, lease, mirror, all, tags, delete or prune flag. `pushToMain` is its only spread, and the script has one quoted `"push"` literal. Retry is `git reset --hard <fresh>` then re-compose, never rebase or force, bounded by `MAX_PUSH_ATTEMPTS = 3`. If `origin/main` did not move, it fails at once. Tests: `pushArgvOffenders`, `scriptPushOffenders`, `workflowPushOffenders`, `ghPrOffenders` and `mergeTokenOffenders`, each with calibrations, plus the self-test 4e arms (frozen argv, race arms). Live-line grep of the workflow: zero `git push`, `gh pr`, `force` or `automation/baseline`. |
| T-258-03 job token scope | medium | mitigate | CLOSED | `redump-push` has `permissions: contents: write` and nothing else. The checkout has `persist-credentials: false`. No `secrets.*`, `vars.*` or `environment:` appears in that job; the only `${{ }}` uses are `github.token` in the step `env:` and `runner.temp` in a `with:` path. `redump-dump` is unchanged at `contents: read` plus `packages: read` in `environment: Production`. Tests: `permissionsHold` (calibrations add `actions: write` and `pull-requests: write`), `credentialOffenders`, `environmentsHold`, and the `persist-credentials` pin on both checkouts. |
| T-258-04 skip trailer suppressing CI | medium | mitigate | CLOSED | `compose()` runs `judgeSkipTokens` over the commit message, the CHANGELOG entry and the Regenerated section before `git commit`. `composeAndPush` calls `compose` on every attempt, so the retry is covered too. The refusal prints the class index only. Self-test arms: judge classes 1 to 6 in both cases, and the arm "a skip token in the composed text refuses before the commit with zero push calls". |
| T-258-05 `${{ }}` script injection | medium | mitigate | CLOSED | The push step's `run:` is `node scripts/baseline-redump.mjs --compose-and-push --in "${RUNNER_TEMP}/redump-in"`. The token enters through `env:`. Test: `runBodyOffenders` with its calibrations, and `pushStepHolds` pins the exact run line. |
| T-258-06 empty token falls back to a keyring login | low | mitigate | CLOSED | `composeAndPush` throws `no push credential` before compose when the token is not a non-empty string. Self-test arm: "an empty token refuses ... before anything is composed (T-258-06)". |
| T-258-07 bot provenance naming a reviewer and a PR that do not exist | medium | mitigate | CLOSED | The composers name `redump-push` and say the commit went straight to `main` (`baseline-redump.mjs` around lines 575 and 596). The self-test wording arm forbids the old job name, `reviewer` and `pull request` in both texts. |
| T-258-08 dead PR-opening mode still callable | low | mitigate | CLOSED | `botPrStatus`, `BOT_BRANCH`, `composePrBody`, `--check-bot-branch`, `--open-or-edit-pr` and every `gh` spawn are gone from the script. Grep found zero hits outside the PUSH_ARGV test regex. `main()` returns 1 for any unknown argument; this was run and printed the unknown-argument error. |
| T-258-09 removing the PR lookup turns redump-dump's no-op red | medium | mitigate | CLOSED | No `botPrStatus` reference remains. The `--gate-dump` path is exercised by the wiring suite's spawned arm, which passed. The diff shows no non-comment change in the `redump-dump` job. |
| T-258-10 truncated or secret-shaped dump on public main with no reviewer | medium | accept | CLOSED (accepted) | The founder ruling is in 258-CONTEXT, "Founder ruling" and "What verifies the bot commit". The widened D-33 residual is recorded in `supabase/schema/BASELINE.md` ("CORRECTED 2026-11-27 ... The D-33 recorded limit, now wider"), in the workflow comment under RECORDED RESIDUALS (i), and in the `.gitleaks.toml` note. The pre-push gates still run: the five-class scan, gitleaks, integrity and shape gates in `redump-dump`, and the compose-side re-scan. The ship-time CHANGELOG `### Notes` entry is still owed (see below). |
| T-258-11 check-less bot commit mistaken for the skip-trailer failure or an unauthorized push | low | mitigate | CLOSED | The workflow comment item (d) and the BASELINE.md note state it is the normal shape by construction. |
| T-258-12 check-less bot commit deploying Railway without a CI verdict | medium | accept | CLOSED (accepted) | Recorded in 258-CONTEXT ("Railway", Reversibility: reversible, wait-for-parent gate deferred) and in the workflow comment items (f) and RESIDUALS (iii). BASELINE.md also states that Railway deploys the check-less commit. |
| T-258-13 prose edit silently changing a live line | medium | mitigate | CLOSED | `git diff 8aace5126 HEAD` of the workflow shows live-line changes only inside `redump-pr` to `redump-push`: the rename, the permissions drop, and the compose and push steps. All other changes are comment lines. `.gitleaks.toml` has one added comment line; `critical-regressions.test.ts` has one comment line; `supabase-migrate-test-first.test.ts` only renames the job constant, and the roster still scans the job. `redump-dump` gates are unchanged. The wiring suite passed. |
| T-258-SC (plans 01, 02 and 03) supply chain | low | accept | CLOSED (accepted) | No package.json or lockfile change in the diff. The script imports node builtins plus `check-baseline-staleness.mjs`. The write job has no `npm ci`. |

## Residual risk accepted by design

Branch protection and rulesets are absent on `main`. The bound on `contents: write` is therefore
the single frozen push argv, the job permission pins, and the pre-push gates.

## Unregistered flags

None. The `## Threat Flags` sections of the three plan SUMMARYs each say "None", and the audit
found no new attack surface.

## Informational (not a threat, not blocking)

- 258-REVIEW WR-01 (booked, non-user-facing MEDIUM): if `git push` exits non-zero after the
  remote accepted the ref, the job log can wrongly say "nothing was pushed". `main`'s content is
  correct. It is a record-accuracy defect, not a security control, so it is outside this register.
- The ship-time CHANGELOG `### Notes` entry for T-258-10's accepted residual is a ship-time
  obligation. It does not exist yet and cannot be verified in this diff.
- The live push has never run: GitHub's acceptance of a `contents: write` job-token push to an
  unprotected `main` and the `gh auth git-credential` path are unproven until the first real
  `supabase-migrate.yml` run on `main` after merge. This is stated in the plan SUMMARYs.
- The `redump-push` job cannot refuse a dump that the compose-side gates accept but that is bad
  in ways the gates do not measure (the D-33 class). That is the accepted T-258-10 residual.
