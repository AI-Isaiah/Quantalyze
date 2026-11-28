# Phase 258: REDUMPDIRECT — after a PROD migration apply, the baseline re-dump commits straight to main with no PR and no approval - Context

**Gathered:** 2026-11-27
**Status:** Ready for planning

<domain>
## Phase Boundary

CI only. After a PROD migration apply, `.github/workflows/supabase-migrate.yml` re-dumps the PROD
catalogue (`redump-dump`, unchanged) and today hands the gated dump to `redump-pr`. That job composes
the re-dump onto current `main`, force-pushes `automation/baseline-redump`, and opens or edits ONE bot
PR with the job token. GitHub holds that PR's CI in an approval-required state until a human clicks
"Approve workflows to run". A human then merges the PR. This phase replaces that last job: after
`redump-dump` succeeds with a changed dump, the workflow composes the SAME commit it composes today
(the six paths: `supabase/schema/baseline.sql`, `supabase/schema/baseline-carried-migrations.txt`,
`supabase/schema/BASELINE.md`, `VERSION`, `package.json`, `CHANGELOG.md`) onto the current `main`
and pushes it straight to `refs/heads/main`. There is no PR, no bot branch and no human step.

Out of scope: `redump-dump` and its gates (unchanged), the PROD/TEST apply jobs, the manual
`## Regenerating` procedure in `BASELINE.md`, any app, analytics or migration code.

</domain>

<decisions>
## Implementation Decisions

### Founder ruling and the decisions it overrides (deviation record)
- Founder ruling 2026-11-27, verbatim answer to the choice "Bot token / Claude allow rule / Push to main directly": **"Push to main directly"**. The founder also said: "So stupid that I have to approve the baseline redump. I want it to be approved or just that no approval is needed."
- ⛔ DEVIATION RECORD (global deviation policy; also recorded in the ROADMAP Phase 258 entry). This phase OVERRIDES Phase 164.9.5 AUTOREDUMP decision **D-13** ("The PR NEVER auto-merges ... A human reviews and merges every re-dump") and **D-23** (the bot PR's `pull_request` runs wait in an approval-required state and the reviewer approves them, then reads each head-SHA run's conclusion). Reason: the founder ruling above. The same ruling also retires, as consequences, D-11 (one fixed force-pushed bot branch and one reused PR), D-12 (CI on the bot PR via a human approve or reopen), D-24 (refuse to force-push over a human commit on the bot branch) and the bot-branch half of D-25 (the hard-coded refspec `HEAD:refs/heads/automation/baseline-redump`). D-25's principle, ONE hard-coded refspec that a wiring test pins as the only push in the file, is KEPT, with the refspec now `HEAD:refs/heads/main`. D-21 (the PROD credential and the write token never share a job; the write job runs no third-party code and no `npm ci`) and D-14 (skip-token judge on the commit message before the commit) are KEPT unchanged. — **Reversibility:** costly — reverting means restoring the bot-branch/PR machinery and its tests from git history.

### What a GITHUB_TOKEN push to main means, and the choice made
- A push made with the workflow's `GITHUB_TOKEN` starts NO workflow (GitHub's recursion guard; only `workflow_dispatch` and `repository_dispatch` are exempt). So the bot commit on `main` carries ZERO Actions runs: no `ci.yml`, no `sql-function-snapshot.yml`, no `migration-drift-check.yml`. That is now the normal shape of a re-dump commit, and it must not be read as the skip-trailer failure from CLAUDE.md "CI gate integrity" section 1 (that one is a human commit whose runs were suppressed; this one is a bot commit by construction). — **Reversibility:** costly — it is the property of the credential the founder chose; changing it means a new credential (App token or PAT), which was offered and not chosen.
- **What verifies the bot commit, stated plainly (added 2026-11-27 after an automated security review flagged the removed human gate as MEDIUM; the founder kept the direct push with the tradeoff stated, and no approval environment is added).** No workflow runs on the bot commit and no human reads it. Everything that verifies it runs BEFORE the push, all of it automated. (1) `redump-dump`, a separate job holding the PROD credential and a read-only token: the five-class secret scan over every dump line, a sha256-pinned gitleaks 8.30.1 scan, the integrity gate (no NUL bytes, `client_encoding`, no home path), the shape gate, which refuses any dump carrying a data statement (`INSERT INTO`, `COPY`, `setval`), so the content is schema only and never table rows, and the regeneration of the carried-migrations marker from the merge tree. The artifact uploads only when all of them pass. (2) The push job, holding the write token and no PROD credential: the compose-side re-scan of the same dump (secret scan and integrity again, trusting no verdict it did not measure), the D-10 no-op and SFH-02 refusals (an older dump never replaces a newer baseline), `run.sh --check-currency`, the baseline content-drift gate, `check-baseline-staleness.mjs`, the `judgeVersionBump` mirror, the six-path staged-set judge, and the skip-token judge over the commit message, CHANGELOG entry and Regenerated section. The residual this leaves is recorded, not fixed: the D-33 limit (a dump truncated after its `CREATE EXTENSION` lines is not refused) now reaches `main` with no reviewer, and the full `ci.yml` and `sql-function-snapshot.yml` verdict on the re-dump tree arrives only at the next push.
- **Main's CI.** The tree the bot commit adds (the six paths) is verified by the gates that already run before the push: in `redump-dump`, the secret scan, gitleaks, integrity, shape and marker gates; in the push job's compose, the compose-side re-scan, `scripts/local-stack/run.sh --check-currency`, `scripts/baseline-content-drift-check.mjs` (self-test and run), `scripts/check-baseline-staleness.mjs`, the `judgeVersionBump` mirror of `check-version-bump.mjs`, the staged-set judge and the skip-token judge. What is GIVEN UP: the full `ci.yml` suite and `sql-function-snapshot.yml` (`tsx scripts/dump-sql-functions.ts --check`) used to run on the bot PR's head before a human merged it. They now first run on the re-dump tree at the NEXT push to `main`. Measured precedent: PR #1398 (v0.133.105.1) needed a human fix commit for two stale `NAME_SET_RATCHET` rows that the re-dump cleared. A second precedent, from the coordinator 2026-11-27: re-dump PR #1406 (after Phase 256) needed an extra fixture-fix commit because `test_mt5_parity_capture`'s whole-row slices break once the baseline gains a new column, and its VERSION collided with another PR. Under the new flow that class turns the next `main` push red (by name, `ratchet-stale`) instead of holding a PR, and is fixed by an ordinary PR. CHOSEN: accept this and record it. A tokenless pre-push verify job running `npm ci` and `dump-sql-functions --check` was considered and NOT taken: a refusal there needs a human to fix and then re-dispatch, which puts back more human steps than a red next push does, against the founder's ruling. — **Reversibility:** reversible — such a verify job can be added later between `redump-dump` and the push job without touching anything this phase builds.
- **Railway.** Measured 2026-11-27 with Railway `list-deployments` on the one Railway project: Railway deploys EVERY push to `main`. The API service waits for CI and SKIPS a red commit: migration merges `8e8c0753` and `1863fe80` were `SKIPPED` because `sql-gate-lint`'s `baseline-content-drift` step is red on every migration merge until the re-dump lands (measured: `SNAPSHOT_MISSING` findings for the two functions migration `20261127120100` added). The worker service deploys regardless. Until now the re-dump PR's squash merge carried green CI and deployed the API (`f4e3d7d2`, `SUCCESS`). A check-less bot commit gives Railway nothing to wait for, and CLAUDE.md records (2026-09-17) that Railway deploys a commit with no CI. So after this phase the bot commit is what deploys the API after a migration merge, usually within minutes of the merge and before that merge's own `ci.yml` (16 to 24 minutes, measured) has finished. CHOSEN: accept this and record it. In the common case it is the deploy we want: the parent's only red is the drift the bot commit clears, and the API code was green on its PR head before the merge (this repo lands on first green). The risk given up is a migration merge whose squash tree differs from its green PR head (main moved underneath it) and is red for a reason other than drift: that tree now deploys to the API without a main verdict. Waiting inside the job for the parent's CI to complete (with `predecessorVerdict`'s `tolerateBaselineDrift` proof) was considered and NOT taken: it holds the `supabase-migrate-refs/heads/main` concurrency group for up to about 25 minutes per apply, and its refusal path needs a human to re-dispatch, against the founder's ruling. A dispatched `ci.yml` on the bot commit was NOT taken either: it needs `actions: write`, races Railway's webhook, and D-12 records that a dispatched `ci.yml` is not a usable verdict. — **Reversibility:** reversible — a wait-for-parent gate can be added in front of the push later.
- **The next push's predecessor proof.** `predecessorVerdict` in `scripts/classify-changed-paths.mjs` reads the check runs on `github.event.before`. After a bot commit, the next push's `before` is the bot commit, which has no runs, so the verdict is `absent`. Consequences, accepted and recorded, not fixed here: that push runs the FULL `sql-mutation` corpus (not the subset) and does not take the docs-only short path. It costs runner time, never correctness (a FULL run is the safe fallback by design). — **Reversibility:** reversible.
- **Vercel** deploys every push regardless of CI; the bot commit changes only `VERSION`, `package.json`, `CHANGELOG.md` and three files under `supabase/schema/`, so a Vercel rebuild of it is a no-op for the app.

### The push and its race with concurrent merges
- One job (rename `redump-pr` to `redump-push`; the old name would be false) with `permissions: contents: write` only; `pull-requests: write` is dropped. It keeps D-21: no PROD credential, no `npm ci`, no third-party code beyond the SHA-pinned checkout, setup-node and download-artifact. — **Reversibility:** reversible.
- Exactly ONE push, refspec `HEAD:refs/heads/main`, plain: no `--force`, no `--force-with-lease`, no `+` prefix, no `--mirror`, no `--all`, no `--tags`, no `--delete`. Never force-push `main`. No `gh pr` call of any kind remains in the file. The wiring tests pin all of this, and each pin is proven to bite (PROOF-01). — **Reversibility:** reversible.
- A refused push is retried by RE-COMPOSING, not by `git rebase`. Every merge to `main` moves `VERSION`, `package.json` and the top of `CHANGELOG.md`, so rebasing the bot commit would conflict or carry a stale version. On a refused push: fetch `origin main`; if `origin/main` MOVED from the sha the attempt composed onto, hard-reset the runner checkout to the fresh `origin/main`, re-run compose (which re-reads `VERSION`, re-picks the next patch version, and already handles "byte-identical, nothing to commit" and "main moved past the dump's merge"), and push again. If `origin/main` did NOT move, the refusal is not a race (auth, a ruleset, a network fault): fail at once, red, naming it. Bounded at 3 attempts in total; after the third refused push the job fails red naming the cause. — **Reversibility:** reversible.
- RESOLVED after research (A6): the push lives in the script, not the workflow. So D-25's principle is pinned as (a) ONE frozen push argv constant in `scripts/baseline-redump.mjs` with refspec `HEAD:refs/heads/main` and no force/lease/`+`, the only `push` the script's non-self-test code issues, and (b) NO `git push` line and no `gh pr` call anywhere in `supabase-migrate.yml`. — **Reversibility:** reversible.
- RESOLVED after research (A7): `botPrStatus`, `BOT_BRANCH` and the rest of the bot-branch machinery are removed. `gateDump` calls `botPrStatus` only for its no-op notice, so `redump-dump`'s no-op `::notice::` text changes by that one clause (output only; no gate, input or permission of `redump-dump` changes), with its self-test arm updated. — **Reversibility:** reversible.
- RESOLVED after research (A8): with the PR body gone, the skip-token judge (D-14) runs before every commit over the commit message AND the composed CHANGELOG entry AND the composed `### Regenerated` section, so it keeps judging free text. — **Reversibility:** reversible.
- RESOLVED after research: the standalone `--compose` CLI mode is replaced by the new compose-and-push mode (the `compose()` function stays and is called by it). — **Reversibility:** reversible.
- The job token is exposed to the push invocation ONLY. The re-run compose and its child gates must never inherit it. — **Reversibility:** reversible.
- The version is picked at push time against the fresh `main`: `compose` reads `VERSION` from the checkout of `main` that the push job makes seconds before the push, and every retry hard-resets to the freshly fetched `origin/main` and re-composes, so it re-reads `VERSION` and re-picks the next patch version. A bot commit therefore never carries a version picked against a stale `main`, which removes the #1406 collision class on the bot side. A human PR that picked the same next version before the bot landed still conflicts on `CHANGELOG.md`, or fails `check-version-bump` after its rebase, exactly as it did when a re-dump PR merged first. — **Reversibility:** reversible.
- `VERSION` and `package.json` stay byte-equal 4-digit strings in the pushed commit (compose's `nextVersion` + `bumpPackageJson` + `judgeVersionBump` already do this; the plan keeps it pinned). — **Reversibility:** reversible.
- The workflow's existing `concurrency: supabase-migrate-${{ github.ref }}` with `cancel-in-progress: false` already serializes re-dump runs, so two re-dumps never race each other; the retry covers only human merges landing between compose and push. — **Reversibility:** reversible.

### Text the bot writes
- The commit message keeps today's title `chore(release): vX.Y.Z.B — baseline re-dump after the PROD apply of <sha8>` and body. The CHANGELOG entry and the `### Regenerated` section of `BASELINE.md` stop naming `redump-pr` and stop saying a judgment is "left to the reviewer" (there is no reviewer); they name the new job and say the bot commit went straight to `main`. Historical `### Regenerated` sections and CHANGELOG entries are NOT rewritten. — **Reversibility:** reversible.
- No skip-CI token anywhere: not in the commit message (the existing `judgeSkipTokens` guard stays and runs before every commit, including retries), not in any comment, CHANGELOG, PR body or prose. No AI attribution lines in commits or PR bodies. — **Reversibility:** reversible.

### Decided autonomously
- [Script] Q: "Where does the compose-push-retry loop live?" → Selected: "In `scripts/baseline-redump.mjs` as a new frozen-CLI mode (e.g. `--compose-and-push`) with injectable git/push seams and self-test arms, matching the file's house style (every mode is self-tested); the workflow step stays a one-liner" — a mode is a local, self-contained addition.
- [Script] Q: "What happens to `--check-bot-branch`, `--open-or-edit-pr`, `composePrBody`, `composePrTitle`'s PR role, `BOT_BRANCH` and their self-test arms?" → Selected: "Removed (they become dead code this phase creates). `EXPECTED_ASSERTIONS` moves to the measured count, and the SUMMARY states each removed arm by name and why, so the drop is visibly deliberate, not a deleted proof. The commit title composer stays (it is the commit subject)" — git history restores them.
- [Script] Q: "How does the script keep the push token away from compose's children?" → Selected: "The push credential reaches only the push child's environment; compose and its gates run with an environment that does not carry it, and a self-test arm proves the gate runner never sees it" — internal.
- [Workflow] Q: "Job name" → Selected: "`redump-push`" — a rename touches only this file and its pins.
- [Docs] Q: "CLAUDE.md note that a check-less bot commit on main is now normal?" → Selected: "Not edited by this phase; the note is carried in the workflow comment, the CHANGELOG entry and this CONTEXT, and the handback asks the main session whether to add it to CLAUDE.md" — prose only.

### Claude's Discretion
- Exact step names, comment wording and dated lineage notes in `supabase-migrate.yml` (header Flow steps 5 and 6, the workflow `permissions:` comment, and the D-13/D-23/D-25 comments get dated ⛔ CORRECTED notes; the old text is kept as lineage per house style).
- Exact self-test arm shapes and the measured `EXPECTED_ASSERTIONS`.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/baseline-redump.mjs` `compose()` already does everything the commit needs: re-scan, D-10 no-op, SFH-02 ancestry and marker-coverage refusals, the offline gates as child processes, the four writers, the version-gate mirror, the six-path staged-set judge, the skip-token judge, and the bot-authored commit. Its `out` dir currently receives `pr-title.txt` and `pr-body.md`, which become unnecessary.
- `committedBytes`, `git()`, `emitToGithubOutput` and the injectable `runner` seam are the patterns for new seams.

### Established Patterns
- Every mode of the script is driven by `--self-test`, which counts `ok()` calls against `EXPECTED_ASSERTIONS`; the workflow runs the self-test before acting.
- Workflow pins are text pins in `src/__tests__/baseline-redump-wiring.test.ts` (plan 09 of 164.9.5), `src/__tests__/critical-regressions.test.ts` and `src/__tests__/supabase-migrate-test-first.test.ts` (`REDUMP_PR_JOB`, the six-job no-softening roster), with neuter-and-see-RED arms.
- `src/__tests__/contracts/ghcr-login-before-image-pull.contract.test.ts` constrains `redump-dump` (unchanged here).
- Measured: `main` has NO branch protection and NO rulesets (`gh api .../branches/main/protection` returns 404 "Branch not protected", `rulesets` returns `[]`), so a `contents: write` job token can push to `main`.

### Integration Points
- `.github/workflows/supabase-migrate.yml` jobs `redump-dump` → `redump-pr` (to become `redump-push`).
- `.gitleaks.toml` (comment near line 416 names the re-dump; read and correct only if it names the PR or bot branch).
- `supabase/schema/BASELINE.md` prose (historical sections untouched).

</code_context>

<specifics>
## Specific Ideas

- Rollout: bot PR #1401 (`automation/baseline-redump`, v0.133.106.1) is open at booking time. After this phase merges it is either merged by the main session as before or closed with the bot branch deleted. If it is closed unmerged, a `workflow_dispatch` of `supabase-migrate.yml` on `main` then re-dumps and is the first live proof of the direct push; otherwise the next migration merge is. The verification records which one happened, and the phase does not claim the push works live before a real run shows it.

</specifics>

<deferred>
## Deferred Ideas

- A wait-for-parent-CI gate before the push (would restore Railway's CI wait for migration merges).
- A tokenless pre-push verify job running `npm ci` and `tsx scripts/dump-sql-functions.ts --check`.
- Teaching `predecessorVerdict` to look through a re-dump bot commit to its parent.
- A CLAUDE.md note that a check-less re-dump commit on `main` is normal (main session's call).

</deferred>
