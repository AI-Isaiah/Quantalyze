# Phase 258: REDUMPDIRECT - Pattern Map

**Mapped:** 2026-11-27
**Files analyzed:** 10 (all are edits to existing tracked files; nothing new is created except planning docs)
**Analogs found:** 10 / 10 (the analog is the file itself or a sibling mode in the same file)

Every path below was verified git-tracked (`git ls-files --error-unmatch`) for the script, workflow and the two main test files. Cite symbols, not line numbers, in PLAN.md (`plan-anchor-verify` re-resolves `file:line` anchors); line numbers here are as read this session in the worktree and are for orientation only.

## File Classification

| File | Role | Data Flow | Closest Analog | Match |
|------|------|-----------|----------------|-------|
| `scripts/baseline-redump.mjs` (new `--compose-and-push` mode, `PUSH_ARGV`, `takePushToken`, `pushToMain`, `fetchMainTip`; delete bot-branch/PR code) | utility / CI script | batch + request-response (git push) | same file: `compose()`, `gateDump()`, `anonGit()`, `gitleaksArgv()`, `emitToGithubOutput` | exact (in-file) |
| `.github/workflows/supabase-migrate.yml` (`redump-pr` -> `redump-push`) | config (workflow) | event-driven | same job as it stands (`redump-pr`), plus `redump-dump` for step style | exact |
| `src/__tests__/baseline-redump-wiring.test.ts` | test | text-pin | same file: `calibrate()`, `pushOffenders`, `GIT_PUSH_RE` | exact |
| `src/__tests__/supabase-migrate-test-first.test.ts` | test | text-pin | same file: `REDUMP_PR_JOB` constant | exact |
| `src/__tests__/critical-regressions.test.ts` | test | comment-only | itself (comment near the "redump-pr jobs sit ABOVE apply" mention) | exact |
| `supabase/schema/BASELINE.md` (`## Regenerating` prose) | docs | n/a | dated "CORRECTED" notes already used in this repo | role-match |
| `.gitleaks.toml` (comment ~line 416) | config (comment) | n/a | itself | exact |
| `CHANGELOG.md`, `VERSION`, `package.json` | release ledger | n/a | newest `## [X.Y.Z.B]` entry; byte-equal 4-digit VERSION/package.json | exact |

## Pattern Assignments

### `scripts/baseline-redump.mjs` (utility, batch)

**Analog:** the file's own existing modes. Node builtins only (header: no `npm ci` runs this).

**Injectable-seam + emit idiom** (`emitToGithubOutput`, `realRunner`, `git`; ~lines 869-911):
```js
function git(repoRoot, args, opts = {}) {
  return execFileSync("git", args, {
    cwd: repoRoot, encoding: opts.encoding === undefined ? "utf8" : opts.encoding,
    maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
    env: opts.env ?? process.env,
  });
}
function emitToGithubOutput(key, value) {
  console.log(`${key}=${value}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
}
function realRunner(cmd, args, { cwd }) {   // NO env option: children inherit process.env
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  ...
  return { status: r.error ? -1 : r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}
```
Consequence for the token boundary: `realRunner`, `git()` (default env), compose's raw `spawnSync("git", ["merge-base","--is-ancestor",...])` and `anonGit` all inherit `process.env`. Hence `takePushToken(process.env)` must be the FIRST statement of the `--compose-and-push` branch of `main()`; only `pushToMain` builds an env containing the token (design in RESEARCH Pattern 1, copy it).

**Frozen argv constant** (copy the shape of `gitleaksArgv`, ~lines 288-305; here a frozen array, exported so tests and self-test can read it):
```js
export function gitleaksArgv(target, reportPath) {
  return [ "dir", target, "--config", ".gitleaks.toml", "--redact", "--no-banner",
    "--ignore-gitleaks-allow", "--report-format", "json", "--report-path", reportPath,
    "--log-level", "error" ];
}
```
Self-test style for it (arms ~2336-2341): `const argv = gitleaksArgv(...)`; `ok(argv[0]==="dir" && pairAt(...) && argv.includes("--redact") ..., "gitleaksArgv: dir <target>, ...")`. New `PUSH_ARGV` arms: deep-equal to `["-c","credential.helper=","-c","credential.helper=!gh auth git-credential","push","origin","HEAD:refs/heads/main"]`; no element starts with `+`; none contains force/lease/mirror/all/tags/delete/prune; `Object.isFrozen`.

**Anonymous git helper to reuse for `fetchMainTip`** (`anonGit`, ~lines 1034-1042):
```js
function anonGit(repoRoot, args) {
  const r = spawnSync("git", ["-c", "credential.helper=", ...args], {
    cwd: repoRoot, encoding: "utf8", maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
  });
  return { status: r.error ? -1 : r.status, stdout: r.stdout ?? "" };
}
```
Existing tracking-fetch refspecs use a leading `+` (`+refs/heads/main:refs/remotes/...`); those are fetches, so a "no `+` in a push" pin must target `PUSH_ARGV`, not a whole-file scan.

**Mode shape to mirror** (`compose({repoRoot, inDir, out, runner, emit, date, repo})`, `gateDump({gitleaks, mainListing})`): pure-ish exported function, I/O as parameters with real defaults. New mode: `composeAndPush({repoRoot, inDir, runner, emit, date, token, remote="origin", maxAttempts=3, push=pushToMain, fetchMain=fetchMainTip})`. Calls `compose(...)` with `emit: () => {}` (swallow per-attempt emits; emit once at the end), drops `out` and `repo` params (their only use was the PR body/title files), re-composes via `git reset --hard <fresh>` (never rebase, never force).

**Skip-token judge (D-14), change its inputs** (`compose`, ~lines 1754-1766 today):
```js
const message = composeCommitMessage(m);
const title = composePrTitle(m);
const tokenHits = [
  ["the commit message", message],
  ["the PR title", title],
  ["the PR body", composePrBody({ ...m, repo, headSha: "0".repeat(40) })],
].flatMap(([where, text]) => judgeSkipTokens(text).map((cls) => `${where} carries skip-token class ${cls} of 6`));
```
Becomes: `[commit message, composed CHANGELOG entry, composed ### Regenerated section]` (the PR body was the only input carrying `m.date`; without this the `tokenRun` arm with `date: "2026-02-03 [skip ci]"` stops refusing). Rename `composePrTitle` -> commit-title composer (it is `composeCommitMessage`'s subject; keep text byte-identical).

**Self-test arm style** (`ok(cond, msg)` increments `asserted`; `EXPECTED_ASSERTIONS = 226` today, checked at end; final failure text "A shrinking self-test that still says PASSED is the defect"):
```js
const ok = (cond, msg) => { asserted += 1; console.log(`  ${cond ? "ok  " : "FAIL"} — ${msg}`); if (!cond) pass = false; return cond; };
const refuses = (fn, re) => ...   // true only when it throws AND the message matches
```
Env seeding precedent with try/finally restore (arm near the `GITHUB_OUTPUT` test, ~3015-3036): save `process.env.X`, set, run, restore in `finally`. Reuse for the token-never-reaches-children arm: assert on `process.env.GH_TOKEN === undefined` inside the fake runner (the fake runner only receives `{cwd}`, so env cannot be read from opts).
Real local bare-remote arm fixture: model on `botRemote()` in self-test 4c (deleted by this phase; copy its shape first): `g(["init","-q","--bare",bare])`, `g(["push","-q",bare,"HEAD:refs/heads/main"])`; race = wrapper over real `pushToMain` that advances bare main from a second clone (touching VERSION and CHANGELOG top) then delegates.
Baseline after deletions is 185 (per RESEARCH ledger: 8 + 1 + 20 + 12 removed); set `EXPECTED_ASSERTIONS` to the measured final count and state each removed arm group by name in the SUMMARY.

**Delete by symbol (not line range):** `BOT_BRANCH`, `BOT_REF`, `PULL_HEAD_LINE_RE`, `findPullRefsForSha`, `botBranchTip`, `judgeForeignCommits`, `lsRemoteBotRefs`, `botPrStatus`, `judgeOpenBotPrs`, `openBotPrsCurlArgv`, `anonOpenBotPrs`, `checkBotBranch`, `PR_URL_RE`, `buildPrArgv`, `readArgFile`, `realGh`, `openOrEditPr`, `composePrBody`, then `REPO_SLUG_RE` once nothing calls it; plus the `--compose`, `--check-bot-branch`, `--open-or-edit-pr` branches of `main()` and the `unknown argument(s)` usage string. Keep `anonGit` (reused by `fetchMainTip`). Pitfall: `gateDump` calls `botPrStatus` for its no-op `::notice::`; edit that one clause (e.g. `... byte-identical to the committed pair — nothing to commit`) and the `noop` self-test arm that pins the text, or `redump-dump` dies with a ReferenceError.

**Production-region marker for the push pin:** the `// ── self-test` and `// ── CLI` section markers. Production region = text before the self-test marker PLUS text from the CLI marker to EOF (`main()` sits after `selfTest`). The literal `"push"` must appear exactly once there.

---

### `.github/workflows/supabase-migrate.yml` (workflow, event-driven)

**Analog:** current `redump-pr` job (lines ~1417-1476). Keep byte-identical: `needs`, `if`, `runs-on`, `timeout-minutes: 15`, the three SHA-pinned `uses:` lines, artifact name `baseline-redump`, the plain self-test step. Imports/pins:
```yaml
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
```
Change: rename key to `redump-push`; drop `pull-requests: write` (keep `contents: write`); replace the last three steps (compose, check-bot-branch, push+open-PR) with ONE step whose `env:` carries the only token line, indentation exactly as the existing credential pin requires (`"          GH_TOKEN: ${{ github.token }}"`):
```yaml
      - name: Compose the re-dump onto current main and push it (retry only when main moved)
        id: push
        env:
          GH_TOKEN: ${{ github.token }}
        run: node scripts/baseline-redump.mjs --compose-and-push --in "${RUNNER_TEMP}/redump-in"
```
No `git push`, no `gh pr`, no `::warning`/`|| true`/`exit 0`/`continue-on-error` on live lines (`SOFTENING_TOKENS` in the test-first suite bans them). Comments (`#` lines) are exempt from live-line scans: add dated "CORRECTED 2026-11-27 (Phase 258)" notes above the job (old D-13/D-23/D-25 text kept as lineage), and to the header Flow step 6 (~lines 30-33), the `permissions:` comment (~164-167) and `redump-dump`'s comments naming `redump-pr` (~1261, ~1387). House style: lineage kept, correction appended. No skip-CI token spelled anywhere.

---

### `src/__tests__/baseline-redump-wiring.test.ts` (test, text-pin)

**Analog:** the file's `calibrate()` (lines ~175-194) and `pushOffenders` (~897-918).
```ts
function calibrate(label, mutate, predicate, text = WF) {
  const mutant = mutate(text);
  expect(mutant, `CALIBRATION ${label}: the mutation produced an identical string, so the twin proves nothing`).not.toBe(text);
  expect(predicate(text), `${label}: the predicate is FALSE on the real file`).toBe(true);
  expect(predicate(mutant), `CALIBRATION ${label}: the predicate did NOT flip on the mutant ...`).toBe(false);
}
const GIT_PUSH_RE = /\bgit\b.*\spush(\s|$)/;
function pushOffenders(text) {
  const pushes = liveLines(text).filter((l) => GIT_PUSH_RE.test(l));
  if (pushes.length !== 1) return [`expected exactly one git push line, found ${pushes.length}: ...`];
  ...endsWith(` origin HEAD:refs/heads/${BOT_BRANCH}`)
}
```
Retarget (RESEARCH Pitfall 2, needs orchestrator confirmation of the reading): `pushOffenders(WF)` -> ZERO live `git ... push` lines, keeping the "push seeded into another job (scan is file-wide)" calibration; plus new script-side pins reading the script text: `PUSH_ARGV` deep-equal, ONE `"push"` literal in the production region (two slices around the self-test marker), a neuter that seeds a second `["push"]` argv in `main()`. Constants to change: `const PR_JOB = "redump-pr"` -> `"redump-push"`, remove the `BOT_BRANCH` import (lines ~41-45), job-order test name/mutants (~560-568), `if:` mutants (~594-599), environment test (~610-623), credentials test (~650-658; the single `GH_TOKEN` line pin stays), compose-line flow-scalar test (~716), deleted-job offender (~732), plain-self-test test (~785-797), persist-credentials (~855), and the no-merge/no-approve seeds that anchor on the `--body-file "${RUNNER_TEMP}/redump-pr/pr-body.md"` tail (~964-1014) which must re-anchor on the new step's `run:` line. Use `mutateInJob` (not bare `text.replace`) to land mutants in the renamed job. Every pin needs a calibrate arm (PROOF-01). Change tests in the same commit as the code they pin so no suite is red between commits.

---

### `src/__tests__/supabase-migrate-test-first.test.ts` (test)

**Analog:** itself. `const REDUMP_PR_JOB = "redump-pr";` (~line 61) -> push-job name; it is a member of the six-job no-softening roster (~line 326). Rename the constant to `REDUMP_PUSH_JOB` (2 code lines) and refresh the comment at ~314-317 ("`redump-pr`'s bot-branch refusal exists to be RED") with a dated note.

### `src/__tests__/critical-regressions.test.ts`

Comment-only at ~1216-1217 (`redump-pr jobs sit ABOVE apply`): rename text to `redump-push`; the 2-space-key count is unchanged by a rename.

### `supabase/schema/BASELINE.md`, `.gitleaks.toml` (prose)

- `BASELINE.md ## Regenerating` AUTOMATED paragraph: keep as lineage, ADD a dated CORRECTED note AFTER the first fenced `grep -anE '...' supabase/schema/baseline.sql` block (tests read the first fence). Must state: a refused dump reaches nowhere but a red job; a dump truncated after its `CREATE EXTENSION` lines (D-33) now reaches `main` directly. Never start a line with `### Regenerated ` (insertion anchor of `rewriteBaselineMd`). Historical `### Regenerated` sections untouched.
- `.gitleaks.toml` comment (~416-418): "before a bot branch is pushed to a PUBLIC repository" -> "before the re-dump commit is pushed to `main` of a PUBLIC repository". Comment only; rerun `gitleaks-allowlist.test.ts`.
- `composeChangelogEntry` / `composeRegeneratedSection` in the script write text into future CHANGELOG/BASELINE entries: stop naming `redump-pr` and "left to the reviewer"; say committed straight to `main` by `redump-push`, no pull request.

### `CHANGELOG.md`, `VERSION`, `package.json`

Per CLAUDE.md: one unified `## [X.Y.Z.B] - YYYY-MM-DD` entry (sections from the repo's vocabulary: Changed, Removed, Tests, Notes), written in the same commit as the VERSION bump (`chore(release): vX.Y.Z.B — <name>`); `VERSION` and `package.json` byte-equal 4-digit strings (pinned by `critical-regressions.test.ts`); never `npm version`. Name the `TODOS.md` entries the phase closes if any, and record the accepted limits (check-less bot commit on main, Railway deploys it, next push's predecessor verdict `absent` runs FULL mutation). No skip-CI token even as a denial; no credential-shaped literals.

## Shared Patterns

### Token boundary (D-21 + "exposed to the push invocation only")
**Source:** RESEARCH Pattern 1 (`takePushToken`, `pushToMain`) over the `anonGit` env idiom.
**Apply to:** `main()` dispatch of the new mode, every child of `compose`.
```js
export function takePushToken(env) { const t = env.GH_TOKEN ?? env.GITHUB_TOKEN ?? ""; delete env.GH_TOKEN; delete env.GITHUB_TOKEN; return t; }
// pushToMain: spawnSync("git", [...PUSH_ARGV], { cwd, encoding:"utf8", env: { ...process.env, GH_TOKEN: token, GIT_TERMINAL_PROMPT: "0" } })
```
Credential helper delegates to `gh auth git-credential` (live precedent: run 46036945243 push step succeeded).

### Calibrated pins (PROOF-01)
**Source:** `calibrate()` in the wiring test. **Apply to:** every new/retargeted predicate. Mutant must differ, predicate true on real, false on mutant.

### Refusal = red job, no softening
**Source:** `compose()` throws on every refusal (D-10 no-op returns `{committed:false}`; SFH-02 ancestry; marker coverage; duplicate CHANGELOG heading; staged-set judge). Retry loop adds: main did not move -> throw "not a race"; attempt 3 refused -> throw. Re-compose after a migration merge lands is expected RED with the existing "main holds a migration that has not applied to PROD yet" cause (give it an arm).

### Dated lineage notes
**Apply to:** workflow, script comments, BASELINE.md, test comments. Old text kept; `CORRECTED 2026-11-27 (Phase 258)` appended. Never rewrite historical entries.

## No Analog Found

| Item | Reason |
|------|--------|
| Retry loop with `reset --hard` re-compose | New logic (about 25 lines); use RESEARCH Pattern 1 design, tested with the real-bare-remote fixture modelled on the deleted `botRemote()` |
| Script-text pin of `PUSH_ARGV` and the production-region `"push"` count | No existing test reads the script's own source; build it with the wiring suite's `calibrate` style over the script text |

## Open point to confirm before planning locks (from RESEARCH Open Question 1)

CONTEXT says both "exactly one `git push` in the workflow" and "the step stays a one-liner with the loop in the script". They cannot both hold literally; the mapped reading is: workflow has ZERO live `git ... push` lines, the script has ONE frozen `PUSH_ARGV`.

## Metadata

**Analog search scope:** `scripts/baseline-redump.mjs`, `.github/workflows/supabase-migrate.yml`, `src/__tests__/{baseline-redump-wiring,supabase-migrate-test-first,critical-regressions}.test.ts`, `.gitleaks.toml`
**Files scanned:** 6 read or grepped (RESEARCH second half, lines 405-669, was not read; this map relies on its first 404 lines and the direct reads above)
**Pattern extraction date:** 2026-11-27

## PATTERN MAPPING COMPLETE
