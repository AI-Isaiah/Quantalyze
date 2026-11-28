# Phase 258: REDUMPDIRECT - Research

**Researched:** 2026-11-27
**Domain:** GitHub Actions workflow (`supabase-migrate.yml`) + a node-builtins-only script (`scripts/baseline-redump.mjs`) + vitest text-pin wiring tests. CI-only.
**Confidence:** HIGH (every in-repo fact below was read in the worktree this session; the one live-behaviour claim, that the `gh auth git-credential` push works, is backed by a green run id; GitHub-side behaviour (GITHUB_TOKEN starts no workflow, no branch protection) is taken from CONTEXT and not re-measured, see A2)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Founder ruling and the decisions it overrides (deviation record)
- Founder ruling 2026-11-27, verbatim answer to the choice "Bot token / Claude allow rule / Push to main directly": **"Push to main directly"**. The founder also said: "So stupid that I have to approve the baseline redump. I want it to be approved or just that no approval is needed."
- ⛔ DEVIATION RECORD (global deviation policy; also recorded in the ROADMAP Phase 258 entry). This phase OVERRIDES Phase 164.9.5 AUTOREDUMP decision **D-13** ("The PR NEVER auto-merges ... A human reviews and merges every re-dump") and **D-23** (the bot PR's `pull_request` runs wait in an approval-required state and the reviewer approves them, then reads each head-SHA run's conclusion). Reason: the founder ruling above. The same ruling also retires, as consequences, D-11 (one fixed force-pushed bot branch and one reused PR), D-12 (CI on the bot PR via a human approve or reopen), D-24 (refuse to force-push over a human commit on the bot branch) and the bot-branch half of D-25 (the hard-coded refspec `HEAD:refs/heads/automation/baseline-redump`). D-25's principle, ONE hard-coded refspec that a wiring test pins as the only push in the file, is KEPT, with the refspec now `HEAD:refs/heads/main`. D-21 (the PROD credential and the write token never share a job; the write job runs no third-party code and no `npm ci`) and D-14 (skip-token judge on the commit message before the commit) are KEPT unchanged. — **Reversibility:** costly — reverting means restoring the bot-branch/PR machinery and its tests from git history.

#### What a GITHUB_TOKEN push to main means, and the choice made
- A push made with the workflow's `GITHUB_TOKEN` starts NO workflow (GitHub's recursion guard; only `workflow_dispatch` and `repository_dispatch` are exempt). So the bot commit on `main` carries ZERO Actions runs: no `ci.yml`, no `sql-function-snapshot.yml`, no `migration-drift-check.yml`. That is now the normal shape of a re-dump commit, and it must not be read as the skip-trailer failure from CLAUDE.md "CI gate integrity" section 1 (that one is a human commit whose runs were suppressed; this one is a bot commit by construction). — **Reversibility:** costly — it is the property of the credential the founder chose; changing it means a new credential (App token or PAT), which was offered and not chosen.
- **Main's CI.** The tree the bot commit adds (the six paths) is verified by the gates that already run before the push: in `redump-dump`, the secret scan, gitleaks, integrity, shape and marker gates; in the push job's compose, the compose-side re-scan, `scripts/local-stack/run.sh --check-currency`, `scripts/baseline-content-drift-check.mjs` (self-test and run), `scripts/check-baseline-staleness.mjs`, the `judgeVersionBump` mirror of `check-version-bump.mjs`, the staged-set judge and the skip-token judge. What is GIVEN UP: the full `ci.yml` suite and `sql-function-snapshot.yml` (`tsx scripts/dump-sql-functions.ts --check`) used to run on the bot PR's head before a human merged it. They now first run on the re-dump tree at the NEXT push to `main`. Measured precedent: PR #1398 (v0.133.105.1) needed a human fix commit for two stale `NAME_SET_RATCHET` rows that the re-dump cleared. Under the new flow that class turns the next `main` push red (by name, `ratchet-stale`) instead of holding a PR, and is fixed by an ordinary PR. CHOSEN: accept this and record it. A tokenless pre-push verify job running `npm ci` and `dump-sql-functions --check` was considered and NOT taken: a refusal there needs a human to fix and then re-dispatch, which puts back more human steps than a red next push does, against the founder's ruling. — **Reversibility:** reversible — such a verify job can be added later between `redump-dump` and the push job without touching anything this phase builds.
- **Railway.** Measured 2026-11-27 with Railway `list-deployments` on the one Railway project: Railway deploys EVERY push to `main`. The API service waits for CI and SKIPS a red commit: migration merges `8e8c0753` and `1863fe80` were `SKIPPED` because `sql-gate-lint`'s `baseline-content-drift` step is red on every migration merge until the re-dump lands (measured: `SNAPSHOT_MISSING` findings for the two functions migration `20261127120100` added). The worker service deploys regardless. Until now the re-dump PR's squash merge carried green CI and deployed the API (`f4e3d7d2`, `SUCCESS`). A check-less bot commit gives Railway nothing to wait for, and CLAUDE.md records (2026-09-17) that Railway deploys a commit with no CI. So after this phase the bot commit is what deploys the API after a migration merge, usually within minutes of the merge and before that merge's own `ci.yml` (16 to 24 minutes, measured) has finished. CHOSEN: accept this and record it. In the common case it is the deploy we want: the parent's only red is the drift the bot commit clears, and the API code was green on its PR head before the merge (this repo lands on first green). The risk given up is a migration merge whose squash tree differs from its green PR head (main moved underneath it) and is red for a reason other than drift: that tree now deploys to the API without a main verdict. Waiting inside the job for the parent's CI to complete (with `predecessorVerdict`'s `tolerateBaselineDrift` proof) was considered and NOT taken: it holds the `supabase-migrate-refs/heads/main` concurrency group for up to about 25 minutes per apply, and its refusal path needs a human to re-dispatch, against the founder's ruling. A dispatched `ci.yml` on the bot commit was NOT taken either: it needs `actions: write`, races Railway's webhook, and D-12 records that a dispatched `ci.yml` is not a usable verdict. — **Reversibility:** reversible — a wait-for-parent gate can be added in front of the push later.
- **The next push's predecessor proof.** `predecessorVerdict` in `scripts/classify-changed-paths.mjs` reads the check runs on `github.event.before`. After a bot commit, the next push's `before` is the bot commit, which has no runs, so the verdict is `absent`. Consequences, accepted and recorded, not fixed here: that push runs the FULL `sql-mutation` corpus (not the subset) and does not take the docs-only short path. It costs runner time, never correctness (a FULL run is the safe fallback by design). — **Reversibility:** reversible.
- **Vercel** deploys every push regardless of CI; the bot commit changes only `VERSION`, `package.json`, `CHANGELOG.md` and three files under `supabase/schema/`, so a Vercel rebuild of it is a no-op for the app.

#### The push and its race with concurrent merges
- One job (rename `redump-pr` to `redump-push`; the old name would be false) with `permissions: contents: write` only; `pull-requests: write` is dropped. It keeps D-21: no PROD credential, no `npm ci`, no third-party code beyond the SHA-pinned checkout, setup-node and download-artifact. — **Reversibility:** reversible.
- Exactly ONE `git push` in the whole workflow file, refspec `HEAD:refs/heads/main`, plain: no `--force`, no `--force-with-lease`, no `+` prefix, no `--mirror`, no `--all`, no `--tags`, no `--delete`. Never force-push `main`. No `gh pr` call of any kind remains in the file. The wiring tests pin all of this, and each pin is proven to bite (PROOF-01). — **Reversibility:** reversible.
- A refused push is retried by RE-COMPOSING, not by `git rebase`. Every merge to `main` moves `VERSION`, `package.json` and the top of `CHANGELOG.md`, so rebasing the bot commit would conflict or carry a stale version. On a refused push: fetch `origin main`; if `origin/main` MOVED from the sha the attempt composed onto, hard-reset the runner checkout to the fresh `origin/main`, re-run compose (which re-reads `VERSION`, re-picks the next patch version, and already handles "byte-identical, nothing to commit" and "main moved past the dump's merge"), and push again. If `origin/main` did NOT move, the refusal is not a race (auth, a ruleset, a network fault): fail at once, red, naming it. Bounded at 3 attempts in total; after the third refused push the job fails red naming the cause. — **Reversibility:** reversible.
- The job token is exposed to the push invocation ONLY. The re-run compose and its child gates must never inherit it. — **Reversibility:** reversible.
- `VERSION` and `package.json` stay byte-equal 4-digit strings in the pushed commit (compose's `nextVersion` + `bumpPackageJson` + `judgeVersionBump` already do this; the plan keeps it pinned). — **Reversibility:** reversible.
- The workflow's existing `concurrency: supabase-migrate-${{ github.ref }}` with `cancel-in-progress: false` already serializes re-dump runs, so two re-dumps never race each other; the retry covers only human merges landing between compose and push. — **Reversibility:** reversible.

#### Text the bot writes
- The commit message keeps today's title `chore(release): vX.Y.Z.B — baseline re-dump after the PROD apply of <sha8>` and body. The CHANGELOG entry and the `### Regenerated` section of `BASELINE.md` stop naming `redump-pr` and stop saying a judgment is "left to the reviewer" (there is no reviewer); they name the new job and say the bot commit went straight to `main`. Historical `### Regenerated` sections and CHANGELOG entries are NOT rewritten. — **Reversibility:** reversible.
- No skip-CI token anywhere: not in the commit message (the existing `judgeSkipTokens` guard stays and runs before every commit, including retries), not in any comment, CHANGELOG, PR body or prose. No AI attribution lines in commits or PR bodies. — **Reversibility:** reversible.

#### Decided autonomously
- [Script] Q: "Where does the compose-push-retry loop live?" → Selected: "In `scripts/baseline-redump.mjs` as a new frozen-CLI mode (e.g. `--compose-and-push`) with injectable git/push seams and self-test arms, matching the file's house style (every mode is self-tested); the workflow step stays a one-liner" — a mode is a local, self-contained addition.
- [Script] Q: "What happens to `--check-bot-branch`, `--open-or-edit-pr`, `composePrBody`, `composePrTitle`'s PR role, `BOT_BRANCH` and their self-test arms?" → Selected: "Removed (they become dead code this phase creates). `EXPECTED_ASSERTIONS` moves to the measured count, and the SUMMARY states each removed arm by name and why, so the drop is visibly deliberate, not a deleted proof. The commit title composer stays (it is the commit subject)" — git history restores them.
- [Script] Q: "How does the script keep the push token away from compose's children?" → Selected: "The push credential reaches only the push child's environment; compose and its gates run with an environment that does not carry it, and a self-test arm proves the gate runner never sees it" — internal.
- [Workflow] Q: "Job name" → Selected: "`redump-push`" — a rename touches only this file and its pins.
- [Docs] Q: "CLAUDE.md note that a check-less bot commit on main is now normal?" → Selected: "Not edited by this phase; the note is carried in the workflow comment, the CHANGELOG entry and this CONTEXT, and the handback asks the main session whether to add it to CLAUDE.md" — prose only.

### Claude's Discretion
- Exact step names, comment wording and dated lineage notes in `supabase-migrate.yml` (header Flow steps 5 and 6, the workflow `permissions:` comment, and the D-13/D-23/D-25 comments get dated ⛔ CORRECTED notes; the old text is kept as lineage per house style).
- Exact self-test arm shapes and the measured `EXPECTED_ASSERTIONS`.

### Deferred Ideas (OUT OF SCOPE)
- A wait-for-parent-CI gate before the push (would restore Railway's CI wait for migration merges).
- A tokenless pre-push verify job running `npm ci` and `tsx scripts/dump-sql-functions.ts --check`.
- Teaching `predecessorVerdict` to look through a re-dump bot commit to its parent.
- A CLAUDE.md note that a check-less re-dump commit on `main` is normal (main session's call).
</user_constraints>

<phase_requirements>
## Phase Requirements

None. CI-only phase; ROADMAP Phase 258 states `**Requirements**: none (CI-only; no REQUIREMENTS.md id)`. The six ROADMAP success criteria (SC-1 to SC-6) are the acceptance set; section "Validation Architecture" maps each to a command.
</phase_requirements>

## Summary

The phase replaces one job and one script surface. `redump-pr` (workflow lines 1417-1476) becomes `redump-push`: it keeps the same `needs`, `if`, checkout, setup-node, download-artifact and plain self-test steps, drops `pull-requests: write`, and its last three steps (compose, bot-branch check, force-with-lease push plus `--open-or-edit-pr`) collapse into ONE step that runs a new script mode, `--compose-and-push`. The loop lives in `scripts/baseline-redump.mjs`: compose onto the checkout, push `HEAD:refs/heads/main`, and on a refusal fetch main anonymously, hard-reset only if main moved, re-compose, at most 3 attempts. The machinery for the bot branch and the PR is deleted by SYMBOL, not by line range (see the KEEP/DELETE ledger below: the 971-1408 span also holds helpers `gateDump` and `compose` still call), and 41 of the 226 self-test assertions go with it (8 PR-body presence arms, 1 pr-body arm, all 20 arms of section 4c, all 12 of section 4d), so the baseline for `EXPECTED_ASSERTIONS` is 185 before the new arms are added.

Four facts the CONTEXT did not name and the planner must absorb. (1) `gateDump` (the UNCHANGED `redump-dump` path) calls `botPrStatus` for its D-10 no-op notice (script line 1534), so removing `BOT_BRANCH` forces a one-line edit to `gateDump`'s notice text and to the two arms that pin it. (2) With the push moved into the script, the workflow file contains ZERO `git push` lines; the "exactly one push, refspec `HEAD:refs/heads/main`" pin must be retargeted to the script's production-code region through an exported frozen `PUSH_ARGV`, while the workflow keeps a "no live `git ... push` line" pin. (3) Dropping the PR body removes the only skip-token judge input that carried free text (`m.date`); to keep D-14 meaningful and its self-test arm (`tokenRun`) alive, the judged set must become commit message plus the composed CHANGELOG entry plus the composed `### Regenerated` section. (4) `BASELINE.md`'s `## Regenerating` prose (lines 1563-1612) is live, not historical, and now false in four places, including the D-33 "recorded limit" which says a truncated dump "reaches only the bot pull request ... nothing merges without a human"; that sentence needs a dated correction because a truncated dump now reaches public `main` directly.

**Primary recommendation:** Add `composeAndPush()` plus `takePushToken()`, `PUSH_ARGV`, `pushToMain()`, `fetchMainTip()` to the script (injectable `push` and `fetchMain` seams, real local bare-repo arms), delete the bot-branch/PR code, make the workflow step a one-liner whose `env:` carries the only `GH_TOKEN`, and retarget the three wiring suites in the same commit as the code they pin so no suite is ever red between commits.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Re-dump PROD catalogue and gate it (unchanged) | `redump-dump` job (credentialed, read-only token) | `scripts/baseline-redump.mjs --gate-dump` | D-21: the PROD credential never shares a job with the write token |
| Compose the six-path commit onto fresh main | `redump-push` job step | `compose()` in the script | Needs a checkout of main plus the gated artifact; runs the offline gates as child processes |
| Decide retry vs fail, bound attempts | Script (`composeAndPush`) | — | Testable with injectable seams; the workflow cannot be unit-tested except by text pin |
| Hold and spend the write token | Workflow step `env:` (one line) | Script child-env construction (`pushToMain` only) | Token must reach only the push child; script strips it from `process.env` at entry |
| Authorize the push to main | GitHub repo settings (no protection, measured in CONTEXT) | Workflow `permissions: contents: write` | `contents: write` is the whole bound; the refspec pin is the second bound |
| Prove nothing else pushes / opens PRs | Wiring tests (vitest text pins) | Script self-test (`PUSH_ARGV` arms) | Tests read workflow text and script text; calibrated on mutants |
| Say what happened to humans | CHANGELOG entry, `### Regenerated` section, workflow comments, `BASELINE.md` note | `.gitleaks.toml` comment | Prose must stop naming a PR, a bot branch or a reviewer |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node builtins only (`node:child_process`, `node:fs`, `node:crypto`, `node:path`, `node:os`, `node:url`) | CI Node 22 (`actions/setup-node` `node-version: 22`); local dev machine has v25.8.1 | The whole script | Script header: "node builtins only. `redump-pr` runs this with no `npm ci`" [VERIFIED: scripts/baseline-redump.mjs:28] |
| git CLI | 2.39.5 local; runner-provided in CI | compose, fetch, reset, push | Already the only VCS tool the script uses |
| `gh` CLI (credential helper only) | runner-provided | `git -c credential.helper=!gh auth git-credential` | Proven live: run 46036945243, step "Push the bot branch and open or edit its PR" concluded `success` [VERIFIED: gh run view 46036945243] |
| vitest | repo's installed version (`@vitest/coverage-v8 ^5.0.5`) | Wiring tests | Existing suites |

### Supporting
| Tool | Version | Purpose | When to Use |
|------|---------|---------|-------------|
| actionlint | `/opt/homebrew/bin/actionlint` present; `actionlint .github/workflows/supabase-migrate.yml` exits 0 today [VERIFIED: run this session] | Workflow syntax gate | After every workflow edit |
| gitleaks | 8.30.1 local [VERIFIED: `gitleaks version`] | `--self-test --with-gitleaks` | Same command the `redump-dump` job runs |
| PyYAML | 6.0.3 | `python3 -I -c "import yaml; yaml.safe_load(open(...))"` YAML parse | Cheap second syntax check |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Retry loop in the script (CONTEXT, decided) | Bash `for` loop in the workflow step | Untestable except by text pin; would keep a `git push` line in YAML so the old pin shape survives, but CONTEXT chose the script. Do not reopen. |
| Strip the token from `process.env` once at mode entry | Pass an explicit `env` to every child (`realRunner`, `git()`, the `anc` spawn, `anonGit`) | Four call sites to remember; one missed site leaks. The single delete is the smaller seam. |

**Installation:** none. No package is added or changed.

## Package Legitimacy Audit

No external package is installed, added or upgraded by this phase. Table not applicable.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
push to main touching supabase/migrations/**  (or workflow_dispatch on main)
        |
        v
  plan -> apply-test -> apply (PROD)                      [unchanged]
        |
        v
  redump-dump  (PROD credential, contents:read + packages:read)   [unchanged]
     supabase db dump --linked -> gate (scan, gitleaks, integrity, shape, marker)
        |-- changed=false --> job ends green, redump-push is skipped (if: ... changed == 'true')
        |-- changed=true  --> upload artifact `baseline-redump` (1 day)
        v
  redump-push  (contents: write ONLY, no PROD credential, no npm ci)
     checkout main (fetch-depth 0, persist-credentials false) -> setup-node -> download artifact
     -> plain self-test
     -> ONE step, env: GH_TOKEN (only live github.token line in the job)
          node scripts/baseline-redump.mjs --compose-and-push --in <artifact dir>
             |
             |  main(): token = takePushToken(process.env)   // GH_TOKEN/GITHUB_TOKEN removed from process.env
             v
        +--> attempt n (n = 1..3)
        |      base = git rev-parse HEAD
        |      compose(...)  // re-scan, D-10 no-op, SFH-02 ancestry, marker-coverage, dirty check,
        |         |           // offline gates as children (env WITHOUT token), writers, version-gate mirror,
        |         |           // staged-set judge, skip-token judge, bot-authored commit
        |         |-- committed=false (D-10) --> notice, emit committed=false, STOP green, no push
        |         |-- throws (any refusal)   --> job red, no push
        |         v
        |      pushToMain({token})   // git -c credential.helper= -c credential.helper=!gh auth git-credential
        |         |                  //     push origin HEAD:refs/heads/main     (token only in THIS child's env)
        |         |-- status 0 --> emit pushed=true, STOP green
        |         v refused
        |      fresh = fetchMainTip()   // anonymous fetch +refs/heads/main:refs/remotes/origin/main
        |         |-- fresh == base           --> throw: "main did not move: not a race (auth, ruleset, network)"
        |         |-- n == 3                  --> throw: "refused 3 times, main moved each time"
        |         v main moved, n < 3
        |      git reset --hard fresh  --------+   (no rebase, never force)
        +----------------------------------------
```

### Recommended Project Structure
No new files except `258-PLAN*.md` etc. Edits only:
```
.github/workflows/supabase-migrate.yml      # job rename + step collapse + prose
scripts/baseline-redump.mjs                 # delete bot-branch/PR code, add composeAndPush mode, retune self-test
src/__tests__/baseline-redump-wiring.test.ts
src/__tests__/supabase-migrate-test-first.test.ts   # REDUMP_PR_JOB -> push job constant (2 lines + comments)
src/__tests__/critical-regressions.test.ts          # comment-only mention at :1216-1217
supabase/schema/BASELINE.md                 # ## Regenerating prose only (dated correction note)
.gitleaks.toml                              # comment at :416-418 only
```

### Pattern 1: injectable-seam mode (house style)
**What:** every mode is a pure-ish exported function taking its I/O as parameters with real defaults (`compose({runner, emit})`, `gateDump({gitleaks, mainListing})`, `checkBotBranch({lsRemote, openPrs})`). The self-test injects fakes or real local bare repos. [VERIFIED: scripts/baseline-redump.mjs:1417-1419, 1583, 1227]
**When to use:** the new `composeAndPush`.
**Proposed shape (design, not existing code):**
```js
// Source: designed for this phase from scripts/baseline-redump.mjs compose()/gateDump() conventions
export const MAX_PUSH_ATTEMPTS = 3;
/** D-25 kept: ONE hard-coded push. The remote and the refspec are literals; nothing builds them. */
export const PUSH_ARGV = Object.freeze([
  "-c", "credential.helper=",
  "-c", "credential.helper=!gh auth git-credential",
  "push", "origin", "HEAD:refs/heads/main",
]);

/** Move the push credential OUT of `env` and return it; compose and its gates then inherit nothing. */
export function takePushToken(env) {
  const token = env.GH_TOKEN ?? env.GITHUB_TOKEN ?? "";
  delete env.GH_TOKEN;
  delete env.GITHUB_TOKEN;
  return token;
}

function pushToMain({ repoRoot, token }) {            // the ONLY consumer of the token
  const r = spawnSync("git", [...PUSH_ARGV], {
    cwd: repoRoot, encoding: "utf8",
    env: { ...process.env, GH_TOKEN: token, GIT_TERMINAL_PROMPT: "0" },
  });
  if (r.stderr) process.stderr.write(r.stderr.slice(0, 2000));
  return { status: r.error ? -1 : r.status };
}

function fetchMainTip({ repoRoot, remote }) {         // anonGit: credential.helper reset, prompt off
  assertRemoteName(remote);
  const f = anonGit(repoRoot, ["fetch", "--quiet", "--no-tags", remote, `+refs/heads/main:refs/remotes/${remote}/main`]);
  if (f.status !== 0) throw new Error(`MEASURE_FAIL: git fetch of main exit ${f.status}; whether main moved was not measured, so nothing more is pushed`);
  const tip = anonGit(repoRoot, ["rev-parse", "--verify", "--quiet", `refs/remotes/${remote}/main^{commit}`]).stdout.trim();
  if (!/^[0-9a-f]{40}$/.test(tip)) throw new Error("MEASURE_FAIL: main's fetched tip is unreadable");
  return tip;
}

export function composeAndPush({ repoRoot, inDir, runner, emit, date, token, remote = "origin",
  maxAttempts = MAX_PUSH_ATTEMPTS, push = pushToMain, fetchMain = fetchMainTip }) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const base = git(repoRoot, ["rev-parse", "HEAD"]).trim();
    const c = compose({ repoRoot, inDir, runner, emit: () => {}, date });   // compose's own emits are swallowed
    if (!c.committed) { emit("committed", "false"); emit("pushed", "false"); return { pushed: false, attempts: attempt }; }
    if (push({ repoRoot, token }).status === 0) {
      emit("committed", "true"); emit("pushed", "true"); emit("attempts", String(attempt));
      return { pushed: true, attempts: attempt };
    }
    const fresh = fetchMain({ repoRoot, remote });
    if (fresh === base) throw new Error(`the push to main was refused although origin/main did not move from ${short(base)}: not a race (auth, a ruleset, a network fault); nothing was retried`);
    if (attempt === maxAttempts) throw new Error(`the push to main was refused ${maxAttempts} times and main moved each time (now ${short(fresh)}); nothing was pushed`);
    git(repoRoot, ["reset", "--hard", fresh]);
  }
}
```
`main()` dispatch: `const token = takePushToken(process.env);` then `composeAndPush({ repoRoot: cwdRepoRoot(), inDir: resolve(f["--in"]), runner: realRunner, emit: emitToGithubOutput, date: new Date().toISOString().slice(0, 10), token })`. Flags: `parseFlags(argv.slice(1), ["--in"])`. [ASSUMED: exact names and the `emit` set; the planner may choose others]

### Pattern 2: calibrated text pins
**What:** every wiring predicate is written over arbitrary text and proven on a mutant by `calibrate(label, mutate, predicate, text=WF)`: it asserts the mutant differs, the predicate is true on the real file, and false on the mutant. [VERIFIED: src/__tests__/baseline-redump-wiring.test.ts:175-194]
**When to use:** every new or retargeted pin in this phase. A pin without a calibrate arm is not accepted (PROOF-01).

### Anti-Patterns to Avoid
- **`git rebase` for the retry:** CONTEXT-locked out; VERSION/package.json/CHANGELOG top move on every merge.
- **Reading `refs/remotes/origin/main` without a fresh fetch** to decide "main moved": the checkout's tracking ref is stale by construction; always `fetchMainTip()` first.
- **Letting compose's `emit("committed", ...)` reach `$GITHUB_OUTPUT` on every attempt:** duplicate keys; swallow compose's emits, emit once at the end.
- **A bare `text.replace(...)` mutation in a calibration:** lands on the first occurrence in the file (the header documents this for `mutateInJob`); use `mutateInJob` against the renamed job.
- **Citing `file:line` anchors in PLAN.md without checking them:** `plan-anchor-verify` (CI) re-resolves every `file:line` anchor and named symbol a pending PLAN asserts (CLAUDE.md "SQL gate integrity jobs"). Cite by symbol.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Anonymous fetch of public main | A new `git fetch` wrapper | `anonGit()` (script :1034-1042) | Already resets `credential.helper`, sets `GIT_TERMINAL_PROMPT=0`; its fetch of public main works under `persist-credentials: false` in live `redump-dump` runs |
| "Is the merge an ancestor / is the pair already committed / is the tree dirty" on the re-compose | New checks | `compose()` as is | It already does D-10 no-op (:1615-1623), SFH-02 ancestry (:1625-1638), dirty check (:1640-1642), marker-coverage (:1644-1673) on every call |
| Skip-token detection | A second regex set | `judgeSkipTokens()` (:873) | Six classes assembled from fragments so the file spells none |
| Version bump + byte-equal VERSION/package.json | New logic | `nextVersion` + `bumpPackageJson` + `judgeVersionBump` already inside `compose()` | SC-3 is already enforced; the plan only adds a pin/arm that it still holds after a re-compose |
| Credential for the push | A PAT, App token or `x-access-token` URL | `git -c credential.helper= -c credential.helper=!gh auth git-credential push` with `GH_TOKEN` | Proven live (run 46036945243); an extraheader fallback is documented in the old step's comment but was never needed |

**Key insight:** this phase deletes more than it writes. The one genuinely new logic is the 25-line retry loop and the token boundary; everything else is reuse of gates that already ran in 50+ live re-dumps (BASELINE.md carries one `### Regenerated` section per automated run).

## Runtime State Inventory

Partial rename (`redump-pr` to `redump-push`) plus a retired flow. All five categories answered:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Remote branch `automation/baseline-redump` exists on origin and bot PR #1401 (v0.133.106.1) is open at booking time (CONTEXT `<specifics>`). | No code. Rollout step recorded in CONTEXT: main session merges or closes #1401 and deletes the branch after the phase merges. The new flow never reads or writes that branch. |
| Live service config | GitHub check-run names: the job's check run is named after the job key, so the check name `redump-pr` stops appearing. Branch protection and rulesets are absent (CONTEXT: 404 / `[]`), so no required-check name references it. Railway "wait for CI" reads check runs on a commit regardless of name. | None. Do not add a required-check rule. |
| OS-registered state | None. Verified by absence of any `redump` string in `scripts/`, `docs/runbooks/` (one prose mention, `docs/runbooks/legacyretire-go-live.md:762`, which describes a different phase's go-live and is left alone) and `.github/` outside the two files in scope. | None. |
| Secrets/env vars | The job token (`${{ github.token }}`) only; scope changes from `{contents: write, pull-requests: write}` to `{contents: write}`. No secret is created, renamed or rotated. Artifact name `baseline-redump` is the contract between `redump-dump` (upload) and the push job (download) and MUST NOT change. | Keep artifact name byte-identical. |
| Build artifacts / installed packages | None (no `npm ci` in these jobs; the script is run from the checkout). | None. |

## Common Pitfalls

### Pitfall 1: Removing `BOT_BRANCH` breaks the unchanged `redump-dump` path
**What goes wrong:** `gateDump` (used by `--gate-dump` in the credentialed job) calls `botPrStatus(repoRoot, remote)` at script :1534 and prints `... — no PR; ${status.text}` (:1536). `botPrStatus` depends on `BOT_BRANCH`, `BOT_REF`, `lsRemoteBotRefs`, `botBranchTip`, `findPullRefsForSha`, `PULL_HEAD_LINE_RE`, `OBJECT_SHA_RE`. Delete those and `gateDump` throws a ReferenceError inside a job whose gates were declared "unchanged".
**Why it happens:** the CONTEXT's removal list names `--check-bot-branch`, `--open-or-edit-pr`, `composePrBody`, `BOT_BRANCH` but not `botPrStatus`.
**How to avoid:** remove `botPrStatus` too and make the no-op notice say what is true now, e.g. `::notice::baseline-redump: dump and marker are byte-identical to the committed pair — nothing to commit` (no bot-branch clause; a stale `automation/baseline-redump` branch is no longer this job's business). Edit the two arms that pin the old text: the `noop` arm (script :3008-3012, output arm #185) and the three notice arms in 4c (they are deleted with 4c). Nothing outside the script reads this string [VERIFIED: grep for `no PR; ` and `byte-identical to the committed pair` outside .planning returns only scripts/baseline-redump.mjs, CHANGELOG.md:12544 (history) and BASELINE.md:1598 (prose in the AUTOMATED paragraph)].
**Warning signs:** `ReferenceError: BOT_BRANCH is not defined` in the `redump-dump` job's self-test step, which runs before the dump.

### Pitfall 2: "Exactly ONE `git push` in the workflow file" cannot hold once the loop is in the script (NEEDS CONFIRMATION, Open Question 1)
**What goes wrong:** the existing pin `pushOffenders(WF)` (test :904-918) requires exactly one live line matching `GIT_PUSH_RE = /\bgit\b.*\spush(\s|$)/` in the workflow. The one-liner step has none, so the pin goes RED for the wrong reason, and a naive fix (re-adding a `git push` line to YAML) contradicts the script mode CONTEXT decided on.
**CONTEXT conflict, stated plainly:** CONTEXT says both "Exactly ONE `git push` in the whole workflow file" and "the workflow step stays a one-liner" with the loop in the script. Those cannot both hold literally. The reading below is this researcher's choice, tagged `[ASSUMED]` (A6), and the orchestrator should confirm it before planning locks it.

**How to avoid (recommended reading of CONTEXT D-25):** the principle is "ONE hard-coded refspec that a wiring test pins as the only push". Pin it where the push lives:
1. Workflow: `pushOffenders(WF)` becomes "ZERO live `git ... push` lines" and the step invokes `--compose-and-push` (keep the calibration "a push seeded into another job (the scan is file-wide)", now expecting RED on any seeded `git push` line).
2. Script: an exported `PUSH_ARGV` deep-equals `["-c","credential.helper=","-c","credential.helper=!gh auth git-credential","push","origin","HEAD:refs/heads/main"]`; its one `push` element is the last-but-two; no element starts with `+` or equals/contains `--force`, `--force-with-lease`, `--mirror`, `--all`, `--tags`, `--delete`, `--prune`; and in the script's PRODUCTION region the string literal `"push"` appears exactly once. The region is TWO slices: the text BEFORE the `// ── self-test` marker (line :1802 today) PLUS the text from the `// ── CLI` marker (line :3623 today) to end of file, because `main()` and the CLI dispatch sit AFTER `selfTest`; assert both markers exist and are in that order. The self-test region between them legitimately contains many `g(["push", ...])` calls to local bare repos, so a whole-file count is polluted. Add a neuter that seeds a second `["push"]` argv inside `main()`.
3. Do NOT scan the script for a leading `+`: the existing anonymous fetches use `+refs/heads/main:...` tracking refspecs (script :1066, :1242), which are fetches, not pushes.
**Warning signs:** a pin that scans the whole script file for `+refs/heads` going RED on the fetch refspec.

### Pitfall 3: The token boundary has more than one leak path
**What goes wrong:** `realRunner` (script :906-911) calls `spawnSync(cmd, args, { cwd, ... })` with NO `env` option, so every gate child (`bash scripts/local-stack/run.sh --check-currency`, `node scripts/baseline-content-drift-check.mjs`, `node scripts/check-baseline-staleness.mjs`) inherits `process.env`. `git()` (:880-888) uses `opts.env ?? process.env`. `compose` has a raw `spawnSync("git", ["merge-base", "--is-ancestor", ...])` (:1627) with no env. `anonGit` spreads `process.env`. If the workflow step puts `GH_TOKEN` in the step `env:` (it must, there is one step), ALL of these inherit it unless `process.env` is cleaned first.
**How to avoid:** `takePushToken(process.env)` as the first statement of the `--compose-and-push` branch of `main()`, before `cwdRepoRoot()` and before any child; only `pushToMain` builds an env containing it. Self-test arms (see Validation Architecture): the pure `takePushToken` arm; a `composeAndPush` run whose fake `runner` asserts `process.env.GH_TOKEN === undefined && process.env.GITHUB_TOKEN === undefined` on every call across a retried run; the push seam receives the sentinel token. The file already has a precedent for seeding and restoring `process.env` inside an arm with `try/finally` (script :3017-3036, `GITHUB_OUTPUT`).
**Warning signs:** an arm that checks the fake runner's `opts` for env: the fake runner receives only `{ cwd }`, so env cannot be observed there; assert on `process.env` itself.

### Pitfall 4: The skip-token judge loses its only free-text input
**What goes wrong:** today `compose` judges `[commit message, PR title, PR body]` (script :1758-1764). The commit message and title are built from `newVersion`, `merge`, `runId`, basenames (strict-regex validated), sha prefixes and counts: no free text. The PR body was the one that carried `m.date` (`### Regenerated ${m.date}`), which is why the `tokenRun` arm (`date: "2026-02-03 [skip ci]"`, script :2961-2967) refuses today. Delete the PR body and that arm's refusal vanishes: the date lands in CHANGELOG.md and BASELINE.md, committed, unjudged.
**How to avoid:** judge `[the commit message, the composed CHANGELOG entry, the composed ### Regenerated section]` before the commit. The token only matters in a commit message (GitHub honours it there), but CONTEXT also forbids it in CHANGELOG, and judging the file texts is the way the existing arm keeps proving the guard runs "before every commit, including retries". The arm's label changes from "composed PR body" to "composed CHANGELOG entry or section".
**Warning signs:** the `tokenRun` arm FAILs with "threw === null".

### Pitfall 5: Dropping `out` ripples through ~17 self-test lines
**What goes wrong:** `compose({ ..., out, repo })` writes `pr-title.txt` and `pr-body.md` into `out` (script :1790-1793). Both go away. `out` then has no purpose, and `repo` (only used for the PR body, :1584 and :1763) has none either. Callers: `main` (:3685-3693) and six self-test sites (:2715, :2768, :2775, :2787, :2823-2828 `composeIn`, plus `compose-in` helper). The `composeIn` helper returns a `noPr` flag (`!existsSync(prOut)`) used by 11 arms (:2843, :2849, :2854, :2867, :2877, :2882, :2892, :2898, :2914, :2958, :2965) plus a raw `!existsSync(join(dir, "pr4"))` at :2793.
**How to avoid:** drop `out` and `repo` from the signature, drop `noPr` from `composeIn` and from those predicates (the arms stay, their counts do not change), drop `--out` from the `--compose` flag list. Because the `--compose-and-push` mode replaces the `--compose` CLI mode, also remove the `--compose` branch of `main()` and update the header's frozen-CLI list and the `unknown argument(s)` usage string (:3703-3706).
**Warning signs:** `compose` being called with a stray `out:` and silently ignoring it (no failure), leaving dead params.

### Pitfall 5b: `composePrTitle` is called by the commit message
`composeCommitMessage` calls `composePrTitle(m)` as its subject (:679). Keep the text byte-identical (CONTEXT: "keeps today's title"); rename to `composeCommitTitle` (recommended, two self-test call sites at :2196 and :2250) or keep the name and fix the comment. Not renaming leaves a function called "PR title" that no PR uses.

### Pitfall 6: The retry's `reset --hard` and compose's own preconditions
Verified behaviour of `compose()` when called again after `git reset --hard <fresh origin/main>` (script :1583-1800):
- **Reads inputs fresh each call:** artifact (`measured.json`, dump, marker) from `inDir`, `VERSION` and `package.json`/`CHANGELOG.md`/`BASELINE.md` from the checkout (:1693, :1718-1722). VERSION is re-picked from the new main.
- **Second D-10 check** (:1615-1623): if fresh main already carries the same pair, returns `{committed:false}` and the loop must STOP GREEN with no push (arm required).
- **SFH-02 ancestry** (:1627-1638): `git merge-base --is-ancestor <measured.merge> HEAD` is true on a main that moved forward; exit 1 would mean main moved past the dump's merge (throw, red, "dispatch a fresh run").
- **Dirty check** (:1641): clean after `reset --hard` (compose writes only the six tracked paths; `supabase/.temp/*` is untracked and absent in this job).
- **Marker coverage** (:1644-1673): throws if fresh main's committed marker carries a migration (still in main's tree) that the artifact marker omits: that is "another re-dump landed", correct to fail red.
- **CHANGELOG collision:** `insertChangelogEntry` refuses a duplicate `## [<newVersion>]` heading (`changelog-duplicate-heading`, :427-429); throws, red.
- **Expected red when the commit that moved `main` is itself a migration merge:** the re-compose's `baseline-content-drift-check` finds the new migration's function bodies absent from the dump and refuses with the existing cause text `main holds a migration that has not applied to PROD yet; the queued apply run will produce the right dump` (script arm :2874-2878 pins that message today). That is correct, not a defect: the migration's own apply run is queued behind this run in the `supabase-migrate-refs/heads/main` concurrency group and re-dumps. The job goes red naming that cause, with zero further pushes. Give it an arm (new arm 15).
- **What stays across attempts:** the local branch `main` (checkout used `ref: main`), the artifact dir, the `date` string. Nothing in `compose` caches state in module scope.

### Pitfall 7: Softening tokens in the workflow
`SOFTENING_TOKENS` (supabase-migrate-test-first.test.ts:273-283) bans, on LIVE lines of every scanned job including the push job: `continue-on-error`, `|| true`, `exit 0`, `::warning`, `set +e`, `|| :`, `2>/dev/null`, `set +o pipefail`, `|| exit 0`. The new step is one line of `node ...`, so this is easy; just do not add a shell wrapper for "success even if nothing to push". Comments are exempt (`liveLines` drops `#` lines).

### Pitfall 8: No `node_modules` in the worktree
`<the phase worktree>` has no `node_modules` [VERIFIED: `ls node_modules` failed]; the main checkout does. vitest cannot run until the executor does `npm ci` or symlinks the main checkout's `node_modules`. The script self-test needs none (builtins only).

### Pitfall 9: A bot commit on main makes in-flight PRs' version picks stale sooner
The bot bumps `VERSION` within minutes of a migration merge instead of at human-merge pace. House rule (MEMORY.md): version digit "re-picked from origin/main before the single CI run", so the process absorbs it; noted as a low-severity consequence, not a design input. [ASSUMED]

## Code Examples

### The workflow job after the change (shape; comments get dated lineage notes)
```yaml
  redump-push:
    needs: [redump-dump]
    if: needs.redump-dump.result == 'success' && needs.redump-dump.outputs.changed == 'true' && github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    timeout-minutes: 15
    permissions:
      contents: write
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1  # v7.0.1
        with:
          ref: main
          fetch-depth: 0
          persist-credentials: false
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1  # v7.1.0
        with:
          node-version: 22
      - uses: actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333  # v8.0.2
        with:
          name: baseline-redump
          path: ${{ runner.temp }}/redump-in
      - name: baseline-redump self-test
        run: node scripts/baseline-redump.mjs --self-test
      - name: Compose the re-dump onto current main and push it (retry only when main moved)
        id: push
        env:
          GH_TOKEN: ${{ github.token }}
        run: node scripts/baseline-redump.mjs --compose-and-push --in "${RUNNER_TEMP}/redump-in"
```
Source: the unchanged lines are copied from `.github/workflows/supabase-migrate.yml:1417-1448` [VERIFIED]; the last step is new. The `GH_TOKEN` line keeps the exact 10-space indent and text the existing credential pin requires (`"          GH_TOKEN: ${{ github.token }}"`, test :364).

Measured timing for sizing `timeout-minutes: 15` (kept): in run 46036945243 the whole `redump-pr` job took 36 s, compose 1 s, push step 4 s; three attempts cost seconds, not minutes [VERIFIED: gh run view 46036945243 --json jobs].

### Real local-bare-remote arm shape (for retry arms)
```js
// Source: modelled on the botRemote() fixture in selfTest section 4c (script :3195-3222), which this phase deletes
const mkOrigin = () => {                       // a bare repo whose main equals the scratch repo's HEAD
  const bare = join(dir, `push-remote-${++n}.git`);
  g(["init", "-q", "--bare", bare], { cwd: dir });
  g(["push", "-q", bare, "HEAD:refs/heads/main"]);
  return bare;
};
// race: a wrapper over the REAL pushToMain that first advances bare main from a second clone
// (touching VERSION and the top of CHANGELOG.md, as every real merge does), then delegates.
// The real PUSH_ARGV push to a file-path remote never invokes the credential helper.
```
Both `fetchMain` (real `fetchMainTip` against the clone whose `origin` is the bare repo) and `push` (real `pushToMain`) can be real in these arms; only the race injection is synthetic.

### Prose that must change (inventory, not history)
| Where | Today | Becomes |
|-------|-------|---------|
| workflow header Flow step 6 (`supabase-migrate.yml:30-33`) | "`redump-pr` composes ... opens or edits the ONE bot PR ... a human reviews and merges every re-dump" | `redump-push` composes and pushes straight to `main`; dated ⛔ CORRECTED note, old text kept |
| workflow `permissions:` comment (`:164-167`) | "exactly one job, `redump-pr`, is uplifted to `contents: write` + `pull-requests: write`" | `redump-push`, `contents: write` only |
| `redump-dump` comments (`:1261-1262`, `:1270-1274`, `:1387`) | name `redump-pr`; "a human must see before a dump can reach a public PR" | name `redump-push`; a refusal is what stands between a dump and public `main` |
| block above the job (`:1397-1416`) | PR approval (D-23), never merged (D-13), refspec bound (D-25) | direct push, no PR, token on the one step, D-25 now `HEAD:refs/heads/main`; D-13/D-23 dated CORRECTED |
| job comments (`:1422-1423`, `:1428-1431`, `:1449-1467`) | bot branch push, `check-bot-branch`, lease, `gh` fallback A3/A4 | replaced by the one step |
| script header (`:3-53`, `:130-134`, `:540-547`, `:564`, `:626-630`, `:971`, `:1481`, `:1532-1533`, `:1683`, `:1792`) | two halves ..., `--check-bot-branch`, `--open-or-edit-pr`, "left to the reviewer", PR body | frozen CLI lists `--compose-and-push --in <dir>`; reviewer/PR prose removed |
| `composeChangelogEntry` (`:585-587`) and `composeRegeneratedSection` (`:604`) | "composed by the `redump-pr` job"; "left to the reviewer" | name `redump-push`; "committed straight to `main` by the `redump-push` job, with no pull request"; no reviewer |
| `BASELINE.md ## Regenerating` AUTOMATED paragraph (`:1563-1612`) | `redump-pr` proposes ONE pull request ... never merges ... CI waits for **Approve workflows to run** ... D-33: "reaches only the bot pull request ... nothing merges without a human" | keep the paragraph as lineage, add a dated ⛔ CORRECTED note AFTER it (after the fenced `grep -anE` block, so `documentedScanPattern` still finds the first fence and the `docGrep` regex still reads the first `grep -anE '...' supabase/schema/baseline.sql`). The note must say a refused dump reaches nowhere but a red job, and that a dump truncated after its `CREATE EXTENSION` lines (D-33) now reaches `main` itself. Do not start any line with `### Regenerated ` (that heading is `rewriteBaselineMd`'s insertion anchor) |
| `.gitleaks.toml:416-418` | "... before a bot branch is pushed to a PUBLIC repository" | "... before the re-dump commit is pushed to `main` of a PUBLIC repository" (comment only; `gitleaks-allowlist.test.ts` reads the file, rerun it) |
| `critical-regressions.test.ts:1216-1217` comment | "`redump-pr` jobs sit ABOVE `apply`" | `redump-push` (comment-only; the 2-space-key count is unchanged by a rename) |
| `supabase-migrate-test-first.test.ts:314-317` comment | "`redump-pr`'s bot-branch refusal exists to be RED" | a ⛔ note; the constant rename is the code change |

NOT changed: past `### Regenerated` sections (BASELINE.md:101-1144), past CHANGELOG entries (e.g. CHANGELOG.md:12544), `docs/runbooks/legacyretire-go-live.md:762`, `scripts/baseline-content-drift-check.mjs` floor-history comments ("cleared by the re-dump"), `scripts/check-baseline-staleness.mjs` (names no PR; verified by grep), `CLAUDE.md` (CONTEXT: main session's call).

## Script symbol ledger: KEEP vs DELETE

Every caller below was found by grepping the whole script (line numbers as read this session). The span :971-1408 mixes both lists, so delete by symbol.

**DELETE (dead once the bot branch and PR go):**
| Symbol (definition line) | Only callers |
|---|---|
| `BOT_BRANCH` (:117) | bot-branch/PR code, `gateDump` via `botPrStatus`, self-test 4c/4d, the wiring test import (:41-45) |
| `BOT_REF` (:973), `PULL_HEAD_LINE_RE` (:978) | `lsRemoteBotRefs`, `botBranchTip`, `checkBotBranch`; `findPullRefsForSha` |
| `findPullRefsForSha` (:993), `botBranchTip` (:1003), `judgeForeignCommits` (:1021) | `botPrStatus`, `checkBotBranch`, 4c arms |
| `lsRemoteBotRefs` (:1045), `botPrStatus` (:1118) | `botPrStatus` is called by `gateDump` at :1534 (see Pitfall 1); `lsRemoteBotRefs` by `botPrStatus` and `checkBotBranch` |
| `judgeOpenBotPrs` (:1154), `openBotPrsCurlArgv` (:1175), `anonOpenBotPrs` (:1193), `checkBotBranch` (:1227) | each other, `main()`, 4c |
| `PR_URL_RE` (:1312), `buildPrArgv` (:1320), `readArgFile` (:1328), `realGh` (:1342), `openOrEditPr` (:1355) | each other, `main()`, 4d |
| `composePrBody` (:631) | `compose` (:1763, :1793) and self-test 1c/1e |
| `composePrTitle` (:672) | rename to a commit-title composer (keeps the text); do not delete |

**DEAD ONLY AFTER `compose` drops `repo` and `out`, and `main()` loses its three bot modes (grep before deleting):**
| Symbol | Callers today | Verdict |
|---|---|---|
| `REPO_SLUG_RE` (:135) | :1176 (`openBotPrsCurlArgv`), :1370 (`openOrEditPr`), :1584 (`compose`) | dead, delete |
| `DEFAULT_REPO` (:134) and its doc comment :129-133 | :1227 (`checkBotBranch`), :1583 (`compose`), `main()` :3670, :3694 | dead, delete |
| `OBJECT_SHA_RE` (:977) | :1009 (`botBranchTip`), :1023 (`judgeForeignCommits`) | dead unless the new `fetchMainTip` reuses it for its 40-hex check (then KEEP; either is fine) |

**KEEP (still called by code that stays):**
| Symbol | Why it stays |
|---|---|
| `REMOTE_NAME_RE` (:975), `assertRemoteName` (:980) | `anonMainMigrationListing` (:1064); the new `fetchMainTip` should call it too |
| `anonGit` (:1034) | `anonMainMigrationListing` (:1066, :1070); the new `fetchMainTip` |
| `migrationBasenames` (:1050) | `anonMainMigrationListing` :1072, `gateDump` :1469, `compose` :1654, self-test `mainAtHead` :1884 |
| `anonMainMigrationListing` (:1063), `judgeMainListing` (:1087) | `gateDump` :1418 and :1482 (the SFH-01 / D-31 main-listing verdict of the unchanged job) |
| `statSync` import (:63) | `assertScanTarget` (:316) |
| `MAX_LINES_PRINTED` (:167) | `lineList` and `runGitleaksGate` (:964); also used by `checkBotBranch` but not only |
| `BOT_NAME`, `BOT_EMAIL` (:118-119), `short` (:537), `markerBasenames`, `committedBytes`, `git`, `emitToGithubOutput`, `realRunner`, `runGate`, `compose`'s gate helpers | the commit author and everything `compose` uses |
| the section comment at :971 ("the bot branch and the pull requests at its tip") | rewrite it to head the surviving helpers (anonymous git, main listing) |

## Self-test arm ledger (for `EXPECTED_ASSERTIONS`)

Measured by running `node scripts/baseline-redump.mjs --self-test` in the worktree: exit 0, `baseline-redump self-test OK: 226 assertion(s)`, 226 `ok` lines [VERIFIED]. Per-section counts from the run output (section header, arms): 1/4:1, 1b:22, 1c:45, 1e:11, 1d:16, 2/4:15, 2b:28, 2c:11, 3/4:14, 4/4:3, 4a:10, 4a2:3, 4b:8, 4b2:7, 4c:20, 4d:12.

### REMOVED outright (41 arms: 226 to 185)
| Source line (`ok(`) | Section | Label | Why it goes |
|---|---|---|---|
| :2166 (loop, runs 8x over `prArms`, array :2150-2165) | 1c | `D-23 presence (PR body): the 'Approve workflows to run' instruction`, `... reading each run's conclusion`, `... branch protection is off, so a zero-check merge is possible`, `... the SHA-bound gh api command with the real repo and head sha`, `... the invitation to add the 'what it adds' column`, `... re-dispatching supabase-migrate.yml on main when main moved or VERSION collides`, `... close-and-reopen named only as a fallback`, `... the PR is never auto-merged` | `composePrBody` is deleted (8 arms) |
| :2749 | 3/4 | `--compose writes <out>/pr-body.md beside pr-title.txt, carrying the repo and the bot commit's own head sha, and no skip token` | compose no longer writes `out` |
| :3180, :3184 | 4c | `findPullRefsForSha returns the refs/pull/<n>/head refs ...` ; `... returns an empty list when no /head ref carries the sha` | helper deleted |
| :3245 | 4c | `an absent bot branch emits an EMPTY lease ...` | `checkBotBranch` deleted |
| :3251 | 4c | `a bot branch whose commits over main are all bot-authored emits lease=<its tip sha> and prs=none` | same |
| :3258 | 4c | `an all-bot branch whose tip refs/pull/7/head points at prints prs=#7 beside its lease` | same |
| :3266 | 4c | `a commit on the bot branch authored by anyone but the bot, while OPEN pull request #7 has the branch as its head, REFUSES (D-24, CR-02) ...` | D-24 retired |
| :3272 | 4c | `the refusal never prints the foreign commit's message or its author's email` | same |
| :3280 | 4c | `the same human commit after PR #7 was merged or closed ... PASSES with lease=<tip> ...` | same |
| :3289 | 4c | `a foreign commit with NO pull ref at its tip and no open pull request passes too ...` | same |
| :3299 | 4c | `an open-PR lookup that fails (HTTP 403 ...) refuses as MEASURE_FAIL and emits no lease ...` | same |
| :3311 | 4c | `a bot-branch proposal whose marker carries a migration main's checkout holds and this commit's marker lacks is NEWER ... (R2-06)` | same |
| :3319 | 4c | `a bot-branch marker naming a migration main's checkout no longer holds ... is not 'newer' ... (R2-06, WR-07)` | same |
| :3331 | 4c | `judgeOpenBotPrs reads only open PRs headed by the bot branch ...` | helper deleted |
| :3346 | 4c | `the open-PR lookup is anonymous: curl's -q comes first ...` | `openBotPrsCurlArgv` deleted |
| :3355 | 4c | `an ls-remote that fails (a remote path that does not exist) is MEASURE_FAIL and never emits a lease` | `checkBotBranch` deleted |
| :3361 | 4c | `a --remote value that is not a plain remote name (here an option) refuses before git is spawned` | its subject was `checkBotBranch`. The same `assertRemoteName` guard survives on `anonMainMigrationListing`; the new `fetchMainTip` should get ITS OWN arm (see new arms) |
| :3366 | 4c | `a bot branch whose fetched tip differs from the ls-remote tip is MEASURE_FAIL ...` | deleted |
| :3391, :3397, :3403 | 4c | `the no-op notice names the bot branch's tip and pull request #7 ...` ; `... says so when the bot branch exists and no pull request points at its tip` ; `a failed bot-PR lookup is a ::warning:: naming the ls-remote exit code ...` | `botPrStatus` deleted (Pitfall 1) |
| :3428, :3434, :3442 | 4d | `buildPrArgv with no open PR is 'pr create ...'` ; `... with one open PR is 'pr edit <n>' ...` ; `neither argv carries the merge subcommand, the auto flag, a review or an approval (D-13)` | `buildPrArgv` deleted. The D-13 intent ("nothing merges, auto-merges or approves") survives as the workflow-level `mergeTokenOffenders` pin plus a new "no `gh pr`" pin |
| :3463, :3471, :3477 | 4d | `no open PR on the bot branch: one list, one create ...` ; `exactly one open PR: it is edited in place (D-11) ...` ; `two open PRs on the bot branch refuse ...` | `openOrEditPr` deleted |
| :3488 | 4d | `judgeSkipTokens re-runs over the title and body ... before gh is called at all (D-14)` | its guard moves to compose (Pitfall 4) |
| :3495, :3501, :3507 | 4d | `a failing 'gh pr list' is MEASURE_FAIL ...` ; `a 'gh pr list' answer that is not an array of PR numbers is MEASURE_FAIL` ; `a failing 'gh pr create' is MEASURE_FAIL, exit 1, and no pr_number is emitted` | deleted |
| :3514, :3522 | 4d | `a missing title or body file refuses with ::error:: before any gh call` ; `no GH_TOKEN, or a GITHUB_REPOSITORY that is not <owner>/<name>, refuses before any gh call (a local keyring login is never used)` | `readArgFile`/`openOrEditPr` deleted. Analogue for the new mode: an empty token is allowed to reach the push (it will be refused by git) OR refused up front; planner's call, but pin whichever is chosen |

Line numbers are the `ok(` call lines in the file as read this session; they will shift as the file is edited. The label text is the stable key.

### EDITED but count unchanged (predicate or label changes, same number of arms)
| Source line | Section | Edit |
|---|---|---|
| :2194-2200 | 1c | `the fixed templates (entry, commit message, PR title, regenerated section, PR body) carry no CI skip token (D-14)`: drop `composePrBody` (and the separate title if renamed) from the list |
| :2248-2253 | 1e | `judgeSkipTokens passes the commit message, PR title and PR body composed from the fixed templates`: commit message (and the entry and section) only; relabel |
| :2961-2967 | 4a2 | `a skip token reaching the composed PR body refuses ...`: relabel; true only if Pitfall 4's fix is in |
| :3008-3012 | 4b | `a dump and marker byte-identical ...: changed=false, a ::notice:: that also says the bot branch is absent, and no out dir at all`: new notice text, drop "bot branch is absent" (output arm #185) |
| :2793, :2843, :2849, :2854, :2867, :2877, :2882, :2892, :2898, :2914, :2958, :2965 | 3/4, 4/4, 4a, 4a2 | remove the `noPr` / `!existsSync(prN)` conjunct (Pitfall 5) |
| :2715, :2768, :2775, :2787, :2828 | compose callers | drop `out:` and `repo:` |
| arms 25-39 region and :2139-2148 | 1c | unchanged unless the new CHANGELOG/section wording breaks a needle; none of the current needles name `redump-pr` or "reviewer" [VERIFIED: needles at :2113-2131 are values, not job names] |

### NEW arms the plan should add (count them when measuring; ~15 expected, final number is the planner's)
1. `composeAndPush` first-try push to a real local bare origin: bare `main` equals local HEAD, `pushed=true attempts=1`, the commit's changed files are exactly `STAGED_PATHS`.
2. Race: bare main advanced (VERSION and top of CHANGELOG moved) between compose and push, using a wrapper over the real `pushToMain`: attempt 1 refused, reset, re-compose, attempt 2 succeeds; new commit's parent is the advanced tip, VERSION is advanced+1 (not stale), old tip is an ancestor of the new bare main (never forced), VERSION equals package.json version byte-for-byte (SC-3).
3. Refusal with main NOT moved (fake `push` returns 1, real or fake fetch returns the same sha): throws naming "did not move", exactly 1 push call.
4. Three refusals each with main moving: throws naming "3 times", exactly 3 push calls, bare main never holds a bot commit.
5. Re-compose finds fresh main already carries the pair: `committed=false`, zero further pushes, returns green.
6. Re-compose finds a main whose marker is newer (another re-dump landed): throws, zero pushes.
7. `fetchMainTip` failure (remote that does not exist) is MEASURE_FAIL and nothing is reset.
8. `fetchMainTip` rejects a non-plain remote name before git is spawned (replaces the deleted `--remote` option arm).
9. `takePushToken` moves `GH_TOKEN` and `GITHUB_TOKEN` out of an env object and returns the token; empty env returns "".
10. Across a retried `composeAndPush`, a fake `runner` sees `process.env.GH_TOKEN` and `GITHUB_TOKEN` undefined on every call, while the push seam received the token (arm that "proves the gate runner never sees it", CONTEXT).
11. `PUSH_ARGV` is the exact seven-element array; no force/lease/plus/mirror/all/tags/delete/prune element; the real `pushToMain` pushes `HEAD` to bare `main` (covered by arm 1) and builds an env containing the token only for itself.
12. Skip token reaching the composed entry or section refuses before the commit AND `push` was never called.
13. `MAX_PUSH_ATTEMPTS === 3` and `composeAndPush` honours a `maxAttempts` override (so arm 4 does not need 3 real races).
15. Main moved by a migration merge between compose and push: attempt 2's re-compose is refused by the content-drift gate (fake runner prints `baseline-content-drift: findings 2` on the second call only) with the named cause, exactly 1 push call, nothing pushed.
14. The composers' new wording: entry and section name `redump-push`, say the commit went straight to `main`, and contain neither `redump-pr` nor "reviewer" nor "pull request".
Also add: the notice text of `gateDump`'s no-op (if not already covered by the edited :3008 arm).

## Test and pin ledger

| Test / script | Asserts today | Must assert after |
|---|---|---|
| `src/__tests__/baseline-redump-wiring.test.ts` (1093 lines) | | |
| imports (:41-45) | `BOT_BRANCH, GITLEAKS_VERSION, SECRET_SCAN_PATTERN` from the script | drop `BOT_BRANCH`; add `PUSH_ARGV`, `MAX_PUSH_ATTEMPTS` if pinned |
| `PR_JOB = "redump-pr"` (:59), `REDUMP_JOBS` (:61), `PR_NEEDS`/`PR_IF` (:239-241), `PR_PERMISSIONS` (:284) | job order divergence < dump < PR < apply; `needs: [redump-dump]`; `if:` line-exact `needs.redump-dump.result == 'success' && needs.redump-dump.outputs.changed == 'true' && github.ref == 'refs/heads/main'` | rename constant to the push job (`redump-push`); `PUSH_NEEDS`/`PUSH_IF` keep the same TEXT (the `if:` is unchanged); `PUSH_PERMISSIONS = { contents: "write" }` |
| `permissionsHold` + calibrations (:296-301, :629-648) | `{contents: write, pull-requests: write}`; calibration "actions: write added to redump-pr" mutates the line `      pull-requests: write\n` | exact map `{contents: "write"}` only; the mutation anchor changes to `      contents: write\n` (anchor on `pull-requests: write` would no longer exist, and `calibrate` fails with "identical string"); ADD a calibration "pull-requests: write re-added" |
| `credentialOffenders` (:326-371) | redump-pr: no `secrets`/`vars`, no `SUPABASE_`, `github.token` on exactly ONE live line equal to `"          GH_TOKEN: ${{ github.token }}"` | same text, new job; calibration "the job token exposed to the compose step too" (:690-700, anchored on `id: compose`) must be retargeted: e.g. seed the same env into the plain self-test step; assert it flips. ADD a pin that the one `GH_TOKEN` line belongs to the step whose command is `--compose-and-push` (token must not sit on the self-test step) |
| `runBodyOffenders` (:405-422), calibration "redump-pr's flow-scalar compose line" (:715-719, anchored on `--in "${RUNNER_TEMP}/redump-in"`) | no `${{` in run bodies | new job; the anchor `--in "${RUNNER_TEMP}/redump-in"` still exists in the new step, keep; "redump-pr deleted" calibration renames |
| `selfTestFormsHold` (:498-508) | pr job runs plain self-test, no `gitleaks` on a live line | new job, same text |
| `checkoutsHold`, `environmentsHold` (:259-268, :544-554) and their calibrations (anchors `timeout-minutes: 15`, `persist-credentials: false`) | both jobs | new job; keep `timeout-minutes: 15` so the anchor survives |
| `mergeTokenOffenders` + 4 calibrations (:885-993), anchored on `PUSH_BODY_TAIL = '--body-file "${RUNNER_TEMP}/redump-pr/pr-body.md"\n'` | no `gh pr merge`/`--auto`/`--approve`/auto-merge anywhere in the workflow | KEEP the predicate; re-anchor the four calibrations on the new last line of the push step (`--in "${RUNNER_TEMP}/redump-in"\n`); the `${BOT_BRANCH}` interpolations in the seeded text go (use a literal like `main`). ADD `ghPrOffenders`: no live line matches `/\bgh\s+pr\b/` (CONTEXT: no `gh pr` of any kind), with a calibration seeding `gh pr list` |
| `pushOffenders` + 3 calibrations (:904-1023) | exactly ONE live `git ... push` line ending ` origin HEAD:refs/heads/${BOT_BRANCH}`; calibration "the bot push retargeted to main" | workflow: ZERO live `git ... push` lines (Pitfall 2); script: `PUSH_ARGV` pins and the production-region `"push"` count. Calibrations: seeded `git push` in the push job RED; seeded `git push` in another job (file-wide) RED; script mutant with `+HEAD:refs/heads/main` RED; mutant adding `--force-with-lease` RED; mutant adding a second `"push"` argv RED; mutant retargeting to another ref RED |
| `documentedScanPattern` / `SECRET_SCAN_PATTERN` (:924-1038) | first fenced block of `## Regenerating` carries the byte-equal `grep -anE '...'` | unchanged; the BASELINE.md note must go AFTER that fence |
| spawned self-test (:1040-1062) | `--self-test` exits 0 and prints `baseline-redump self-test OK: \d+ assertion` (count NOT pinned, :939) | unchanged; it is the vitest-side proof that `EXPECTED_ASSERTIONS` matches |
| `--gate-dump` attempt arm (:1064-1092) | spawns `--gate-dump` with a missing dump | unchanged (does not touch bot-branch code) |
| `src/__tests__/supabase-migrate-test-first.test.ts` | `REDUMP_PR_JOB = "redump-pr"` (:61); `SCANNED_JOBS` six-job roster (:322-329) incl. it; per-job calibrations iterate the roster (:928-940) | rename the constant and its value to `redump-push` (the two `s.replace('\n  ${job}:\n', ...)` calibrations rebuild themselves from the roster); roster stays SIX; softening tokens must be absent from the new job's live lines |
| `src/__tests__/critical-regressions.test.ts` | only a COMMENT mentions `redump-pr` (:1216-1217); generic `applyJobBlock` slice bound and VERSION/package.json byte-equal tests unchanged by a rename | comment-only touch; run the file to confirm green |
| `src/__tests__/contracts/ghcr-login-before-image-pull.contract.test.ts` | lists `supabase-migrate.yml:redump-dump` in `PULLING_JOBS` (:49); the write job is not named and runs no `supabase`/`run.sh up` command | NO edit expected; run it. The new step contains no pull command (`PULL_CMD_RE` matches `run.sh up` and `supabase start/db dump/...`) |
| Adjacent suites that read the same files | `gitleaks-allowlist.test.ts` (`.gitleaks.toml`), `baseline-wiring-claim.test.ts` and `test-restore-workflow-wiring.test.ts` (BASELINE.md), `secret-scan-full-history.test.ts`, `ci-apt-bounded.contract.test.ts`, `mutex-dead-holder-verdict.test.ts` (supabase-migrate.yml) | NO edit expected; run them after the prose edits |

`scripts/classify-changed-paths.mjs` and `scripts/sql-gate-subset.mjs` need no edit, but note `LANE_STEP_INPUTS` lists `.github/workflows/supabase-migrate.yml` (script `sql-gate-subset.mjs:157`): a push to `main` changing it runs `sql-mutation` FULL ("FULL naming it"). Cost: runner time on this phase's own merge. The dead-holder drill extracts the release step of `apply-test` from that file, which this phase does not touch [VERIFIED: sql-gate-subset.mjs:148-157].

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Bot branch + one reused PR + approve-and-merge by a human (164.9.5 D-11/D-12/D-13/D-23/D-24/D-25) | Direct plain push of one bot commit to `main`; retry by re-compose | Founder ruling 2026-11-27 | Deletes ~480 lines and 41 self-test arms; main's first CI over the re-dump tree is the NEXT push |
| Wiring test pins one `git push` in YAML | Pin on `PUSH_ARGV` in the script plus "no push in YAML" | this phase | Pin moves with the code it bounds |

**Deprecated/outdated:** the `gh` extraheader fallback described in the old step comment (assumptions A3/A4): A3 (`gh auth git-credential`) was proven by live runs, A4 never needed.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The exact function names, signature and `emit` key set in "Pattern 1" are a proposal; the planner may name them differently | Architecture Patterns | Low: pins reference whatever names are chosen |
| A2 | A push of the bot commit to `main` by `GITHUB_TOKEN` with `contents: write` is accepted (no protection, no rulesets). CONTEXT records 404 / `[]` measured 2026-11-27; not re-measured here. The existing job already pushed a branch with the same token | Summary | If a ruleset appears the push is refused with main NOT moved, so the job fails red naming "not a race"; no data harm |
| A3 | Version-pick staleness for in-flight PRs after a bot bump is absorbed by the house "re-pick from origin/main" rule | Pitfall 9 | Low: a one-time version collision on someone's PR |
| A4 | `git push` to a `file://`-style local bare remote never invokes the configured credential helper, so real-push self-test arms need no token | Code Examples | Low: if it did, the arm would hang or fail visibly in the first run |
| A5 | Whether an EMPTY token should be refused up front or allowed through to git (and refused there) is left to the planner | Self-test ledger | Low |
| A6 | **Reading of CONTEXT's "exactly ONE `git push` in the whole workflow file":** because the loop lives in the script, the workflow holds ZERO push lines and the one-push pin moves to the script's `PUSH_ARGV` (plus a no-push-in-YAML pin). CONTEXT's two statements conflict literally; this is a researcher's reading, not a locked decision | Pitfall 2, Test ledger | Medium: if the founder meant a literal bash push in YAML, the loop must move into the step and the retry loses its self-test seam |
| A7 | **Editing `gateDump`'s no-op notice and dropping `botPrStatus`** (the unchanged `redump-dump` path's stdout) is acceptable although CONTEXT calls `redump-dump` unchanged; only its log text and two self-test arms change, no gate | Pitfall 1 | Low-Medium: alternative is keeping `botPrStatus` and 7 dependencies (3 more arms) |
| A8 | Widening the skip-token judge to the composed CHANGELOG entry and `### Regenerated` section (beyond "the commit message") is within D-14's spirit | Pitfall 4 | Low |

## Open Questions

1. **CONTEXT conflict to CONFIRM: "exactly ONE `git push` in the whole workflow file" vs "the workflow step stays a one-liner" (A6).**
   - What we know: with the loop in the script (decided), the workflow cannot contain a `git push` line.
   - What's unclear: whether the intended pin is "script-level `PUSH_ARGV` plus zero pushes in YAML" (this research's reading) or a literal push line in YAML.
   - Recommendation: take the script-level reading; flag it in the plan and the SUMMARY as an interpretation of D-25's principle ("ONE hard-coded refspec that a wiring test pins as the only push"). The handback asks the orchestrator to confirm.
2. **Also to CONFIRM (A7): editing `redump-dump`'s no-op notice.** Dropping `botPrStatus` changes one log line of a job CONTEXT calls unchanged. Recommendation: do it (Pitfall 1); keeping it costs 7 dead-in-spirit symbols and 3 arms.
3. **Replace or keep the `--compose` CLI mode?**
   - What we know: the workflow was its only caller; `compose()` stays exported for the new mode and the arms.
   - What's unclear: CONTEXT says "a new frozen-CLI mode (e.g. `--compose-and-push`)", not that `--compose` goes.
   - Recommendation: remove the `--compose` CLI branch (mode with no caller and no self-test of the CLI layer = dead surface); keep `compose()` exported.
4. **Does #1401 need a line in the plan?**
   - What we know: CONTEXT `<specifics>` handles it as a rollout step recorded in verification.
   - Recommendation: none beyond what CONTEXT says; the plan must not claim the push works live before a real run (SC-5/`<specifics>`).
5. **Judging the CHANGELOG entry and Regenerated section for skip tokens (Pitfall 4) goes slightly beyond "judge on the commit message" (A8).**
   - Recommendation: do it; it costs two string args, and without it the D-14 arm cannot be kept honest.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node | self-test, vitest | yes | v25.8.1 local (CI uses 22) | — |
| git | all | yes | 2.39.5 | — |
| gh | live push only (credential helper); not needed locally | yes | `/opt/homebrew/bin/gh` | — |
| gitleaks | `--self-test --with-gitleaks` | yes | 8.30.1 (equals the pinned `GITLEAKS_VERSION`) | — |
| actionlint | workflow syntax | yes | present | PyYAML parse |
| python3 + PyYAML | YAML parse | yes | PyYAML 6.0.3 | — |
| `node_modules` in the worktree | vitest | NO | — | symlink `<the main checkout>/node_modules`, or `npm ci` |
| bash | `run.sh --check-currency` is faked in self-test; only the live job runs it | yes | `/opt/homebrew/bin/bash` | — |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** worktree `node_modules` (symlink or `npm ci`; document which one in the plan).

Local self-test wall time is about 35 s (`time node scripts/baseline-redump.mjs --self-test`: 35.1 s real) [VERIFIED]; the vitest arm that spawns it has a 110 s spawn timeout (:941). On the runner the same step took 7 s (run 46036945243).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | vitest (`npm test` is `vitest run`) for the three wiring suites; the script's own `--self-test` for behaviour |
| Config file | `vitest.config.ts`; `src/**/*.test.ts` is in `INCLUDE`; `critical-regressions.test.ts` also appears in `vitest.node-env.ts:64` |
| Quick run command | `node scripts/baseline-redump.mjs --self-test` |
| Full suite command | `npx vitest run src/__tests__/baseline-redump-wiring.test.ts src/__tests__/supabase-migrate-test-first.test.ts src/__tests__/critical-regressions.test.ts src/__tests__/contracts/ghcr-login-before-image-pull.contract.test.ts` then the adjacent six: `src/__tests__/gitleaks-allowlist.test.ts src/__tests__/baseline-wiring-claim.test.ts src/__tests__/test-restore-workflow-wiring.test.ts src/__tests__/secret-scan-full-history.test.ts src/__tests__/contracts/ci-apt-bounded.contract.test.ts src/__tests__/mutex-dead-holder-verdict.test.ts` (needs `node_modules`) |

CI reality: no `ci.yml` job runs the script's self-test directly [VERIFIED: grep `redump` in ci.yml returns nothing]. It runs (a) in `redump-dump` (`--self-test --with-gitleaks`) and the push job (`--self-test`) at apply time, after merge, and (b) pre-merge through the vitest wiring test that spawns it, which the sharded frontend job executes. So a broken `EXPECTED_ASSERTIONS` is caught pre-merge only through that vitest arm.

### Phase Requirements to Test Map (success criteria)
| SC | Behavior | Test Type | Automated Command | File Exists? |
|----|----------|-----------|-------------------|-------------|
| SC-1 | one plain push of exactly six paths to `refs/heads/main`; no PR; nothing waits on a human | self-test arms 1, 11 + wiring (`PUSH_ARGV`, no-`git push` in YAML, no `gh pr`, `permissions == {contents: write}`) | `node scripts/baseline-redump.mjs --self-test` ; `npx vitest run src/__tests__/baseline-redump-wiring.test.ts` | arms and pins: Wave 0 (write) |
| SC-2 | refused-because-main-moved retries by re-compose, never force; 3 tries then red naming the cause; other failures red at once | self-test arms 2, 3, 4, 5, 6, 7, 13 | `node scripts/baseline-redump.mjs --self-test` | Wave 0 (write) |
| SC-3 | VERSION and package.json byte-equal 4-digit strings in the pushed commit | existing arms `VERSION is bumped ... no trailing newline`, `package.json's version equals VERSION` (3/4) kept + arm 2's equality check after a re-compose; `critical-regressions.test.ts` byte-equal assertion (existing) | self-test; `npx vitest run src/__tests__/critical-regressions.test.ts` | exists / Wave 0 for arm 2 |
| SC-4 | the three suites pin the new shape; each new pin RED under a neutered copy, GREEN after restore from a byte backup | the retargeted suites with `calibrate` arms | the four-file vitest command above | edit in place |
| SC-5 | CONTEXT states the GITHUB_TOKEN consequence and the deliberate choice | document review only (already in `258-CONTEXT.md`) | `grep -n "recursion guard" .planning/phases/258-*/258-CONTEXT.md` | exists |
| SC-6 | no skip token in any commit message or prose; no AI attribution; nothing under `.planning/` on the ship branch | self-test arm 12 + the existing `guardRe` template arm; ship-time checks | self-test; `git diff --name-only origin/main...HEAD \| grep -c '^\.planning/'` must print 0 before push; `grep -rn` of the six token classes assembled from fragments is NOT to be written as a literal pattern in any file | Wave 0 (arm 12) |

### Sampling Rate
- **Per task commit:** `node scripts/baseline-redump.mjs --self-test` (35 s) and, for workflow or test edits, `actionlint .github/workflows/supabase-migrate.yml`
- **Per wave merge:** the four-file vitest command, then the adjacent six
- **Phase gate:** self-test plain and `--with-gitleaks`, all ten vitest files green, `actionlint` clean, then `/gsd-verify-work`

### Neutering protocol for every new pin (house rule)
Backup, neuter, run (expect RED), restore, `cmp`, run (expect GREEN). Never `git checkout`/`restore`/`stash` on uncommitted work. Use the session scratchpad for backups:
```bash
SP=<your session scratchpad>
cp scripts/baseline-redump.mjs "$SP/baseline-redump.mjs.bak"
# ... apply ONE neuter with the Edit tool, run the check, expect RED ...
cp "$SP/baseline-redump.mjs.bak" scripts/baseline-redump.mjs && cmp "$SP/baseline-redump.mjs.bak" scripts/baseline-redump.mjs && echo restored-byte-equal
```
| New pin or arm | Neuter (one edit at a time) | Expected RED |
|---|---|---|
| `PUSH_ARGV` pins | change the refspec element to `+HEAD:refs/heads/main`; then add `"--force-with-lease"`; then retarget to `refs/heads/automation/x`; then add a second `"push"` argv in the pre-self-test region; then seed one inside `main()` (the post-`// ── CLI` slice) | wiring `pushOffenders`-style test names the offender; self-test PUSH_ARGV arm FAILs |
| workflow zero-push pin | add a live `git push origin HEAD:refs/heads/main` line to the push step, and separately to another job | wiring test RED (file-wide) |
| no-`gh pr` pin | add a live `gh pr list` line to the push step | `ghPrOffenders` RED |
| permissions pin | add `pull-requests: write`; then `actions: write` | `permissionsHold` RED |
| token placement pin | move `env: GH_TOKEN` onto the plain self-test step (or add it a second time) | `credentialOffenders` RED |
| retry arms | change `fresh === base` to `fresh !== base`; set `MAX_PUSH_ATTEMPTS` to 4; replace `reset --hard` with nothing; swallow the push result as success | the matching arms 2/3/4/13 FAIL |
| token boundary arm | delete the `takePushToken` call in the `main` branch (or delete the two `delete` lines inside it) | arm 9/10 FAIL (arm 10 needs the fake runner to observe `process.env`) |
| skip-token-before-push arm | move the skip-token judge after the commit, or drop the entry/section texts from the judged list | arm 12 / the `tokenRun` arm FAIL |
| `EXPECTED_ASSERTIONS` | leave it at 226 while the arms are removed (must FAIL loudly: "An arm was deleted, skipped, or added without updating EXPECTED_ASSERTIONS") | self-test exits 1; the wiring test's spawned-self-test arm RED |
| job-rename pins | rename the job key back to `redump-pr` in the workflow | job order, needs/if, environment, permissions and softening-roster pins all RED by name |

### Wave 0 Gaps
- [ ] `node_modules` in the worktree (symlink or `npm ci`) so vitest can run
- [ ] A GREEN baseline recorded BEFORE edits: self-test 226 OK (done this session), the four wiring files green (not run this session; needs `node_modules`)
- [ ] The new self-test arms and the retargeted wiring pins (written in the same commits as the code they pin)
- [ ] Measured `EXPECTED_ASSERTIONS` = 185 + number of added arms, recorded in the SUMMARY with each removed arm named and why (CONTEXT requirement)

## Security Domain

`.planning/config.json` read this session: `security_enforcement` is absent (treated as enabled) and `workflow.nyquist_validation` is `true`, so both this section and Validation Architecture are required.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | no end-user auth in scope |
| V3 Session Management | no | — |
| V4 Access Control | yes (CI token scope) | job-level `permissions: contents: write` only; no `pull-requests`, `actions` or `id-token`; no PROD credential in the job (D-21); wiring pin on the exact map |
| V5 Input Validation | yes | `MIGRATION_BASENAME_STRICT_RE` on every basename that reaches a commit message, CHANGELOG or section (`^[0-9]{14}_[a-z0-9_]+\.sql$`, script :115); `parseFlags` whitelist; `assertRemoteName` |
| V6 Cryptography | no | none new; dump/marker hashes are sha256 via `node:crypto` |
| V7 Error handling and logging | yes | nothing prints a dump line, DSN, token or project ref (script header :23-26); the new mode's messages carry sha prefixes and counts only |
| V14 Configuration / build pipeline | yes | SHA-pinned actions unchanged; no `${{ }}` in `run:` bodies (existing pin); no third-party code in the write job |

### Known Threat Patterns for this stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Write token inherited by gate child processes (bash, node) | Information disclosure / Elevation | `takePushToken(process.env)` before any child; only `pushToMain` env carries it; arms 9 and 10 |
| Force-push or push to another ref rewriting `main` history | Tampering | single hard-coded `PUSH_ARGV`, plain push, retry by reset+re-compose; pins and neuter proofs |
| Secret-shaped or truncated dump reaching PUBLIC `main` with no human reviewer | Information disclosure | The same gates as before still run (secret scan, gitleaks in `redump-dump`; compose-side re-scan). What changed: the human review is gone, so the D-33 recorded limit (a dump truncated after its `CREATE EXTENSION` lines is not refused) now reaches `main`. Must be stated in the BASELINE.md correction note and in the CHANGELOG `### Notes`. Founder ruling accepts removing the reviewer; this is the residual risk to record, not to fix here |
| Skip-CI token in a commit message suppressing every check on `main` | Denial of service (of CI) | `judgeSkipTokens` before every commit including retries; judged set widened (Pitfall 4) |
| Script injection via `${{ }}` in a `run:` body | Tampering | existing `runBodyOffenders` pin; the step uses `env:` and `${RUNNER_TEMP}` |
| Unreviewed bot commit deploys to Railway with no CI | Integrity | accepted and recorded in CONTEXT (Railway section); out of scope to fix |

## Sources

### Primary (HIGH confidence, read this session)
- `.github/workflows/supabase-migrate.yml` lines 1-60, 150-190, 1235-1500: job text, header, permissions comment, D-xx comments
- `scripts/baseline-redump.mjs` lines 1-150, 421-530, 525-720, 855-1420, 1417-1820, 2087-2260, 2690-3060, 3158-3260, 3380-3420, 3526-3727 (whole-file symbol census by grep); `node scripts/baseline-redump.mjs --self-test` run: 226 assertions, 35 s
- `src/__tests__/baseline-redump-wiring.test.ts` (read in full), `supabase-migrate-test-first.test.ts` (:60-61, :273-283, :295-345, :895-1000), `critical-regressions.test.ts` (:1195-1260), `contracts/ghcr-login-before-image-pull.contract.test.ts` (:30-75)
- `supabase/schema/BASELINE.md` `## Regenerating` (:1545-1625) and the `redump-pr` grep census; `.gitleaks.toml` (:405-440)
- `scripts/sql-gate-subset.mjs` (:140-160, :845-862)
- `gh run list` / `gh run view 46036945243` (workflow_dispatch on 1863fe80, 2026-11-27): `redump-pr` job 36 s, push step success
- `258-CONTEXT.md`, `ROADMAP.md` `### Phase 258`, project `CLAUDE.md` and `AGENTS.md`

### Secondary (MEDIUM confidence)
- GITHUB_TOKEN-push-starts-no-workflow behaviour and "branch protection absent": taken from `258-CONTEXT.md` (recorded as measured/decided there; not re-fetched, per instruction)

### Tertiary (LOW confidence)
- none

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH, nothing new is installed; node builtins and git/gh already in use
- Architecture: HIGH for the script seam (modelled on three existing seams) and the retry's interaction with `compose()` (read line by line); MEDIUM for exact test-arm count of NEW arms (a plan-time measurement)
- Pitfalls: HIGH, each traced to a line read this session

**Research date:** 2026-11-27
**Valid until:** 2026-12-27 for the file/line facts only while `scripts/baseline-redump.mjs`, `supabase-migrate.yml` and the three suites are not edited by another phase; re-measure the arm ledger at HEAD before planning (the repo's own rule: ledger numbers are claims)
