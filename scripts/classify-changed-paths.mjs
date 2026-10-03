#!/usr/bin/env node
/**
 * Docs-only path classifier — Phase 164.6.3 / CI-DOCSPATH-01.
 *
 * ⚠️ WHY THIS EXISTS, measured 2026-09-06 (PR #750, CI run `34062196456`): a
 * roadmap-insertion PR whose only substantive content was planning bookkeeping
 * ran the entire gate corpus, and took the shared-TEST advisory lock `61616158`
 * against other people's CI while doing it. `.planning/ROADMAP.md` and
 * `TODOS.md` both record that run as `21 jobs / ~50 job-minutes`.
 *
 * ⚠️ THREE jobs take that lock per run, not two: `python`, `e2e-seeded` and
 * `sql-tests`. The ROADMAP and the `[CI-DOCSPATH-01]` TODOS entry both
 * undercount at two — `python` is the forgotten taker. Corrected here and in
 * the ledger by this phase; if you are counting mutex acquires in a run log,
 * count to three.
 * (2026-09-26, Phase 164.9.4: no ci.yml job takes the lock; the docs-only filter no longer changes any key take.)
 *
 * ⛔ AND PR #750 ITSELF WOULD NOT BE FILTERED BY THIS GATE. Measured
 * 2026-09-12 from its own file list: alongside four `.planning/` paths it
 * changed `CHANGELOG.md`, `TODOS.md`, `VERSION` and `package.json`, none of
 * which is on the allow-list below — so #750 classifies as CODE here and
 * would still run the whole corpus. The ledger entries call it a docs PR;
 * that describes its SHAPE, not its classification under this rule. This
 * paragraph exists so a future reader does not open the motivating incident,
 * see a full corpus, and conclude the filter is broken. The PR class this
 * gate DOES filter is the `.planning/`-only one: the plan, summary and state
 * commits that carry no release toll, which is the common GSD case and the
 * reason the allow-list is drawn where it is rather than one file wider.
 * ⛔ Do NOT "fix" this by adding `CHANGELOG.md` / `VERSION` / `TODOS.md` to
 * the allow-list. Those paths are how a release ships, and a release is
 * exactly the change that must run every gate.
 *
 * ⚠️ TWO CORPUS FIGURES EXIST AND BOTH ARE RIGHT AT THEIR OWN SCOPE — do not
 * book a phantom drift between them. `21 jobs / ~50 job-minutes` is the
 * ROADMAP/TODOS figure and it counts by JOB KEY. The complete census by CHECK
 * ROW is `23 rows / 4,760 job-seconds`, measured on CI run `34717952454` — a
 * later, different pull request, cited for the corpus baseline and not for
 * #750. The counts differ for two stated reasons: `frontend-test` is a
 * two-shard matrix and reports two check rows for one job key, and the earlier
 * count was taken while `e2e-seeded` and `sql-tests` were still running. Both
 * halves are carried in this phase's `164.6.3-RESEARCH.md` — the "Before/After
 * Job Census" section, which ends with its own `23 rows, not 21 job keys`
 * warning, and the "Evidence Collection" section, whose first recipe quotes the
 * executed 23-row census verbatim. Cited by SECTION, never by line number:
 * `[164.7-CITATION-DRIFT-01]` is this repository's named defect class for prose
 * that carries a coordinate which later drifts, and a permanent script header
 * is the worst possible place to seed another instance.
 *
 * The rule: a pull request whose changed-file list is ENTIRELY under
 * `.planning/` is docs-only; anything else is code.
 * (2026-10-01, Phase 164.9.4 review WR-01: the same rule now also applies to a
 * PUSH, over its pushed range, failing safe to code — see `classifyPushRange`.)
 *
 * ⛔ FAIL-CLOSED, BY DECISION. Every unreadable, empty or otherwise ambiguous
 * input classifies as CODE. The asymmetry is the whole argument: a wrong
 * `true` skips sixteen gates at once — it is a gate-disable primitive wearing
 * an optimisation's clothes — while a wrong `false` costs a few runner
 * minutes. A read failure is a `MEASURE_FAIL` and a non-zero exit, because a
 * gate that cannot read cannot report a pass.
 *
 * `--self-test` proves every verdict fires against synthetic inputs. A gate
 * whose red path has never been observed is the defect this repository's 164.3
 * phase exists to remove — and this classifier is the single point of trust for
 * the whole path filter, so its own table is the first thing that must be true.
 */
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

/**
 * ⛔ AN ALLOW-LIST. It must never become a deny-list of code paths: under a
 * deny-list a new top-level directory defaults to "docs" and silently skips the
 * corpus, which is the fail-open direction this file exists to refuse.
 *
 * ⭐ The trailing separator lives INSIDE the literal rather than being appended
 * at compare time. That is what makes the prefix-boundary self-test rows fail
 * closed: `.planningfake/y.ts`, a tracked file named exactly `.planning`, and
 * `.planning-notes/x.md` all fail `startsWith(".planning/")`.
 */
export const DOCS_ONLY_PREFIXES = [".planning/"];

/**
 * The `.planning/` files a `frontend-test` assertion reads FROM THE REAL TREE.
 * A PUSH range that changes one of them is CODE, not docs-only, even though
 * every path in it is under `.planning/`.
 *
 * WHY (review 164.9.4 round 2 WR-01, founder decision 2026-10-02, "Treat those
 * as code"): a docs-only PR skips `frontend-test`, and `[CI-DOCSPATH-01]`
 * accepted that because the UNFILTERED merge push re-ran it. Once a docs-only
 * push took the short path too, a docs merge that broke one of these
 * assertions went green on `main` and the red surfaced on the next unrelated
 * code change, which got blamed for it. Keeping the push full for exactly
 * these files restores that backstop and keeps the short path for the common
 * STATE / state.json / VERIFICATION close-out merges.
 *
 * Each entry, and the assertion that reads it:
 *   - config.json: `src/__tests__/critical-regressions.test.ts`, the two
 *     `workflow.use_worktrees` guards (review 164.9.4 round 3, CR-01).
 *   - REQUIREMENTS.md, ROADMAP.md: `src/__tests__/lint-sql-gates.test.ts` G3
 *     ("the PLANNING DOCUMENTS do not claim more shapes than the linter ships").
 *   - 159-VERIFICATION.md, 164.3-07-DEFERRED.md: `src/__tests__/verify-plan-anchors.test.ts`
 *     G2 ("an exempted plan is ROUTED"), read by name.
 *   - 164.3-07-PLAN.md: the same file's "phase 164.3 plan 07 … is exempt and
 *     REPORTED" pin and its R2-W05 real-marker arm, by name.
 *   - 164.3-07-SUMMARY.md: ABSENT today, and listed for that reason. Creating
 *     it ends the deferral those two pins assert, so adding it reds them.
 *
 * ⚠️ The founder's question named THREE files (the review listed REQUIREMENTS,
 * ROADMAP and 159-VERIFICATION). G2 and its neighbours also read the 164.3-07
 * trio by name, and round 3 (CR-01) found `config.json`, read by a third test
 * file the round-2 measurement never scanned. The exact set is SEVEN entries:
 * six existing files plus the absent SUMMARY. The founder confirmed on
 * 2026-10-02 that the list may grow past the original three.
 * The whole-corpus `--pending` scans in `verify-plan-anchors.test.ts` are NOT
 * listed: `plan-anchor-verify` runs the same scan, unfiltered, on every PR,
 * docs-only PRs included, so the PR board already carries that backstop.
 * A PUSH is covered by that only because every commit it brings is a PR merge;
 * since review 164.9.4 round 4 (WR-02) `classifyPushRange` CHECKS that, through
 * `isPrMergeCommit`, rather than assuming it.
 *
 * ⛔ PUSH ONLY. The PR path is unchanged: the PR board is green by the
 * accepted `[CI-DOCSPATH-01]` trade, and this list is what makes the merge
 * push re-check it. The list is hand-kept; `ci-docs-path-filter.contract.test.ts`
 * re-derives it from EVERY tracked test file (vitest, Playwright, pytest) and
 * the local modules they import or spawn, in both directions, so a reader the
 * list lacks and an entry no test reads are each a red.
 */
export const TEST_READ_PLANNING_PATHS = [
  ".planning/config.json",
  ".planning/REQUIREMENTS.md",
  ".planning/ROADMAP.md",
  ".planning/phases/159-rank-public-ranking-integrity/159-VERIFICATION.md",
  ".planning/phases/164.3-vacuity-a-control-that-cannot-fail-must-be-caught-by-machine/164.3-07-DEFERRED.md",
  ".planning/phases/164.3-vacuity-a-control-that-cannot-fail-must-be-caught-by-machine/164.3-07-PLAN.md",
  ".planning/phases/164.3-vacuity-a-control-that-cannot-fail-must-be-caught-by-machine/164.3-07-SUMMARY.md",
];

/**
 * PURE: given the changed-file list, is this diff docs-only? No I/O, so the
 * self-test drives it directly.
 *
 * ⚠️ This is the SAME predicate `scripts/check-version-bump.mjs` uses for its
 * planning-only exemption (`!f.startsWith(".planning/")`). The two are kept
 * provably identical by a self-test row here rather than by a shared import.
 * ⛔ Do NOT refactor `check-version-bump.mjs` to import this module: that is a
 * behavioural change to an always-on release gate in exchange for nothing.
 *
 * ⭐ The verdict is order-independent by construction — `.every` over a
 * membership predicate is commutative — and the self-test pins it anyway
 * rather than trusting the reasoning.
 */
export function judge(changedFiles) {
  // An EMPTY diff is CODE by decision, not by omission. It is reachable two
  // ways: an empty commit, and a base ref that resolved to nothing (so the
  // three-dot diff printed no names). Both mean "we do not know what changed",
  // and the fail-closed answer to that is to run everything.
  if (changedFiles.length === 0) return false;
  return changedFiles.every((f) => DOCS_ONLY_PREFIXES.some((p) => f.startsWith(p)));
}

function git(args, cwd) {
  // stderr is PIPED, never inherited (review 164.4.2 IN-02): a failing git's
  // `fatal:` line travels inside the caller's MEASURE_FAIL instead of printing
  // raw into the log above whatever verdict follows.
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...(cwd ? { cwd } : {}) });
}

/**
 * The merge-base ref a pull request is diffed against: `origin/<GITHUB_BASE_REF>`,
 * or `origin/main` when the variable is absent.
 */
export function baseRefFor(baseRefName = process.env.GITHUB_BASE_REF) {
  return baseRefName ? `origin/${baseRefName}` : "origin/main";
}

/**
 * THE changed-file list against the PR's merge base — the ONE implementation in
 * this repo (Phase 164.4.2 plan 07). Lifted out of `main()` byte-for-byte in
 * behaviour so `scripts/sql-gate-subset.mjs` can be a second CALLER rather than
 * a second diff: two diffs that agree today can disagree tomorrow, one gaining
 * `--no-renames` and the other not, and a moved gate file would then read as
 * unchanged to exactly one of them.
 *
 * ⛔ THROWS on an unreadable base — a `MEASURE_FAIL:` error, never `[]`. `git
 * diff` against a missing ref exits non-zero and prints nothing, and "nothing"
 * is exactly what "no files changed" looks like to a caller that swallows it.
 *
 * @param {{baseRefName?: string, cwd?: string}} [opts] — `cwd` exists for the
 *   self-test's scratch repository; every production caller omits it.
 * @returns {string[]} repo-relative paths, in the order git printed them
 */
export function changedFilesAgainstBase({ baseRefName = process.env.GITHUB_BASE_REF, cwd } = {}) {
  const baseRef = baseRefFor(baseRefName);
  try {
    // ⚠️ `--no-renames` is MANDATORY, not stylistic. With rename detection a
    // `src/x.ts` → `.planning/x.md` rename prints ONLY the destination, so a
    // deleted code file would classify as docs-only and skip the corpus that
    // would have noticed. `check-version-bump.mjs` carries this same hole today
    // and is deliberately NOT being changed here — a named, routed divergence
    // rather than drift, and a behavioural edit to an always-on gate is out of
    // this phase's scope.
    //
    // The base ref is passed as an argv ELEMENT to execFileSync, never
    // interpolated into a shell string: `GITHUB_BASE_REF` is a branch name and
    // on a fork PR an untrusted contributor chooses it.
    //
    // ⚠️ `-z` is MANDATORY too (review 164.4.2 WR-01). Without it git QUOTES
    // any path holding a non-ASCII byte, a tab, a newline, a backslash or a
    // double quote (`core.quotePath`), so `supabase/tests/test_é.sql` prints
    // as `"supabase/tests/test_\303\251.sql"` and every `startsWith` caller
    // misses it. NUL-separated names are never quoted.
    return git(["diff", "--name-only", "--no-renames", "-z", `${baseRef}...HEAD`], cwd)
      .split("\0")
      .filter(Boolean);
  } catch (e) {
    // ⛔ A gate that cannot read cannot report a pass.
    const why = String(e.stderr ?? "").trim() || e.message;
    throw new Error(`MEASURE_FAIL: could not read ${baseRef} — ${why}`);
  }
}

/**
 * THE PUSH-RANGE LISTER — Phase 164.9.6 (D-01), extracted from `classifyPushRange`
 * verbatim so `scripts/sql-gate-subset.mjs` is a second CALLER of one diff, never
 * a second implementation of it (the `changedFilesAgainstBase` rule, applied to
 * the push path). Every check and reason string is the one `classifyPushRange`
 * used inline before the extraction; see that function's header for why each
 * shape is undeterminable.
 *
 * ⛔ NEVER THROWS. An undeterminable range is `{ ok: false, reason }`, and each
 * caller decides what "undeterminable" costs (the docs classifier: code; the
 * SQL gate subset: FULL). It stops BEFORE any predecessor lookup, so the subset
 * path never makes a `gh api` call.
 *
 * @param {{before?: string, forced?: string|boolean, cwd?: string}} opts
 * @returns {{ok: true, sha: string, files: string[]} | {ok: false, reason: string}}
 */
export function pushRangeFiles({ before, forced, cwd } = {}) {
  const fail = (reason) => ({ ok: false, reason });
  const sha = String(before ?? "").trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(sha)) return fail(`before-SHA ${sha ? "is not an object name" : "is absent"}`);
  if (/^0+$/.test(sha)) return fail("before-SHA is all zeros, a branch-creating push");
  if (String(forced ?? "").trim() === "true" || forced === true) return fail("a forced push");
  try {
    git(["cat-file", "-e", `${sha}^{commit}`], cwd);
  } catch (e) {
    return fail(`before-SHA is not a commit in this clone${gitWhy(e)}`);
  }
  try {
    git(["merge-base", "--is-ancestor", sha, "HEAD"], cwd);
  } catch (e) {
    return fail(`before-SHA is not an ancestor of HEAD${gitWhy(e)}`);
  }
  try {
    // Two-dot, `--no-renames` and `-z` for the same reasons the PR diff carries
    // them (see `changedFilesAgainstBase`).
    const files = git(["diff", "--name-only", "--no-renames", "-z", sha, "HEAD"], cwd)
      .split("\0")
      .filter(Boolean);
    return { ok: true, sha, files };
  } catch (e) {
    return fail(`git diff over the range failed${gitWhy(e)}`);
  }
}

/**
 * The pushed range's first-parent commits, oldest-last as git prints them, each
 * a `[hash, committerEmail, subject]` triple — Phase 164.9.6 (D-01), extracted
 * from `classifyPushRange` so both callers read one log. ⛔ THROWS on a git
 * error; each caller turns that into its own fail-safe verdict.
 *
 * @param {string} sha — the before-SHA, already validated by `pushRangeFiles`
 * @param {string} [cwd]
 * @returns {string[][]}
 */
export function firstParentCommits(sha, cwd) {
  return git(["log", "--first-parent", "--format=%H%x1f%ce%x1f%s%x1e", `${sha}..HEAD`], cwd)
    .split("\x1e")
    .map((c) => c.trim())
    .filter(Boolean)
    .map((c) => c.split("\x1f"));
}

/**
 * THE PUSH PATH — Phase 164.9.4, routed in by the founder on 2026-09-27
 * (ROADMAP `### Phase 164.9.4`, "a docs-only push to `main` runs the full
 * corpus"). It supersedes the Phase 164.6.3 trigger-scope decision that the
 * push corpus is never filtered, for `push` ONLY: `workflow_dispatch` and every
 * other non-PR event still hard-code a code verdict in `main()`.
 *
 * A push is classified by the PUSHED RANGE, `<before>..HEAD`, with the same
 * `judge()` the PR path uses. On a single squash merge `before` is HEAD's first
 * parent, so this is exactly the ROADMAP's "diff against its first parent". On a
 * multi-commit push it is the union of every pushed commit, which is STRICTER: a
 * code commit followed by a docs commit stays code, where a `HEAD^1..HEAD` diff
 * would have read only the docs commit and skipped the corpus.
 *
 * ⛔ FAIL SAFE TO CODE, NEVER TO RED. Every range this function cannot determine
 * returns `docsOnly: false` with a named reason, and `main()` exits 0. It never
 * throws: a non-zero exit fails `changed-paths`, which skips every dependent and
 * turns the `frontend` aggregator red on `main`, so Railway skips the deploy.
 * The undeterminable shapes, each one a "we do not know what was pushed":
 *   - `before` absent, or not a 40/64-hex object name;
 *   - `before` all zeros (a branch-creating push);
 *   - `forced` is true (a force push rewrote history, so `before` is not a base);
 *   - `before` is not a commit in this clone;
 *   - `before` is not an ancestor of HEAD (the ancestor check also covers a
 *     forced push whose payload lost the flag);
 *   - any git error during the diff;
 *   - an empty diff (`judge([])` is code by decision).
 *
 * ⭐ A docs-only push is a SHORT run, never a missing one. `changed-paths`, the
 * always-on jobs and the `if: always()` `frontend` aggregator still run, so the
 * SHA gets a recorded green run that deploy automation can wait on.
 *
 * ⛔ (2026-10-02, review 164.9.4 round 2, SFH-04) A docs-only range is ALSO
 * required to sit on a PROVEN predecessor. Without that, a `.planning/`-only push
 * on top of a red or still-running code commit got a short green run on the very
 * code CI had rejected, and Railway (which deploys on a docs-only push, gated on
 * that push's own suite) shipped it. Red, cancelled, pending, absent, or a
 * lookup that failed: full corpus, with the reason printed.
 * (Review 164.9.4 round 3, WR-01 + SFH LOW-04: "proven" now mirrors Railway's
 * own gate, which `docs/runbooks/railway-worker.md` (Recovery, step 2) records as
 * the CHECK-RUNS of the commit, every workflow's: every GitHub Actions check run
 * on `before` must be non-red. The `frontend` check alone was not enough: `e2e`
 * and `lighthouse-mobile` are docs-filtered jobs outside the aggregator, and CI
 * run `36892795002` concluded `failure` while its `frontend` concluded
 * `success`. See `predecessorVerdict`.)
 * (Review 164.9.4 round 4, CR-01 + WR-01 + SFH MEDIUM-01 + LOW-07: "every
 * Actions check run non-red" was NOT enough on its own. Scheduled and
 * `workflow_run` workflows attach green checks to `main` SHAs, so a commit whose
 * CI never ran, or had not finished, passed it. The gate now also requires a
 * completed, successful `frontend` check run (CI's `if: always()` aggregator)
 * and every GitHub Actions check SUITE on `before` completed. See
 * `predecessorVerdict`.)
 *
 * @param {{before?: string, forced?: string|boolean, cwd?: string, fetchPredecessor?: (sha: string) => any}} opts —
 *   `before` and `forced` come from `github.event.before` / `.forced`, passed in
 *   through the step's `env:`. `cwd` exists for the self-test's scratch repos.
 *   `fetchPredecessor` is the predecessor-verdict seam, answering
 *   `{ runs, suites }` (the two `gh api` bodies): production reads it through
 *   `gh api` (`readPredecessor`); the self-test injects canned responses,
 *   offline.
 * @returns {{docsOnly: boolean, reason: string}}
 */
export function classifyPushRange({ before, forced, cwd, fetchPredecessor = defaultFetchPredecessor } = {}) {
  const fullCorpus = (reason) => ({ docsOnly: false, reason: `${reason} — classified as code, full corpus` });
  const code = (reason) => fullCorpus(`push range undeterminable (${reason})`);
  // Phase 164.9.6 (D-01): the range checks and the diff live in `pushRangeFiles`,
  // shared with `scripts/sql-gate-subset.mjs`. Reasons and order are unchanged.
  const pushed = pushRangeFiles({ before, forced, cwd });
  if (!pushed.ok) return code(pushed.reason);
  const { sha, files } = pushed;
  if (files.length === 0) return code("the range changed no files");
  const range = `${files.length} changed file(s) in the pushed range ${sha.slice(0, 12)}..HEAD`;
  if (!judge(files)) return { docsOnly: false, reason: range };
  // Review 164.9.4 round 2, WR-01 (founder decision 2026-10-02): a push that
  // touches a `.planning/` file a `frontend-test` assertion reads keeps the
  // merge-push backstop. See `TEST_READ_PLANNING_PATHS`.
  const read = files.filter((f) => TEST_READ_PLANNING_PATHS.includes(f));
  if (read.length > 0) return fullCorpus(`the pushed range changes ${read.length} planning file(s) a frontend-test assertion reads: ${read.join(", ")}`);
  // Review 164.9.4 round 4, WR-02: `plan-anchor-verify` runs ONLY on
  // `pull_request`, so on a push the `--pending` plan-anchor corpus is covered
  // only by the PR run that preceded the merge. That holds only when every
  // commit the push brings is a PR merge; a direct push to `main` was never
  // checked by it. The assumption is CHECKED here, not merely stated: any
  // first-parent commit in the range that is not a GitHub PR merge runs the full
  // corpus. See `isPrMergeCommit`.
  let commits;
  try {
    commits = firstParentCommits(sha, cwd);
  } catch (e) {
    return fullCorpus(`the pushed range's commit log could not be read${gitWhy(e)}`);
  }
  if (commits.length === 0) return fullCorpus("the pushed range lists no first-parent commit");
  const direct = commits.find(([, email, subject]) => !isPrMergeCommit(email, subject));
  if (direct) {
    return fullCorpus(
      `commit ${String(direct[0]).slice(0, 12)} in the pushed range is not a GitHub PR merge, so plan-anchor-verify (pull_request only) never ran on it`,
    );
  }
  // Review 164.9.4 round 2, SFH-04 (rounds 3 and 4). A docs-only range proves
  // nothing about the CODE under it, which is exactly `before`'s code. The short
  // path is taken only when CI provably ran and finished green on `before`; see
  // `predecessorVerdict`. Consulted LAST, so a code push never calls the API.
  const verdict = predecessorVerdict(sha, fetchPredecessor);
  if (!verdict.ok) return fullCorpus(`predecessor ${sha.slice(0, 12)} is not proven green (${verdict.why})`);
  return { docsOnly: true, reason: `${range}; predecessor ${sha.slice(0, 12)} ${verdict.why}` };
}

/**
 * Is this first-parent `main` commit a GitHub PR merge? (Review 164.9.4 round
 * 4, WR-02.) GitHub commits every web merge as `noreply@github.com`, with a
 * squash subject ending `(#N)` or a merge subject `Merge pull request #N from …`.
 * Measured on first-parent `main` since 2026-06-01: 460 commits had that shape
 * (431 squash, 29 merge) and 11 did not, every one a direct push by a
 * developer. A rebase merge (original subjects) and a locally squashed `(#N)`
 * commit pushed by hand both read as NOT a PR merge, the safe direction.
 * ⚠️ This is a guard against ACCIDENT, not an adversary: a committer address and
 * a subject are both settable by whoever can push to `main`.
 */
export function isPrMergeCommit(committerEmail, subject) {
  if (committerEmail !== "noreply@github.com") return false;
  return /\(#\d+\)$/.test(String(subject)) || /^Merge pull request #\d+ from /.test(String(subject));
}

/**
 * WHAT "PROVEN" MEANS for `before` (review 164.9.4 round 4: CR-01, WR-01, SFH
 * MEDIUM-01 and LOW-07, one root cause, design decided by the orchestrator on
 * 2026-10-02). The gate must prove CI actually RAN and FINISHED on `before`, not
 * merely that whatever checks happen to exist are green. ALL THREE must hold:
 *
 *   (a) a completed `frontend` check run concluded `success`. `frontend` is
 *       `ci.yml`'s `if: always()` aggregator, a job name only `ci.yml` carries,
 *       and it is created only after every job it needs has finished, so its
 *       presence proves CI ran to the end. Round 3 dropped this requirement, and
 *       a commit carrying only a scheduled workflow's green checks (a skip-trailer
 *       merge, say), or a CI run caught between `needs:` stages, then passed.
 *   (b) every GitHub Actions check run (app slug `github-actions`, every
 *       workflow, every event, `workflow_dispatch` included) is completed with a
 *       conclusion in `PREDECESSOR_OK_CONCLUSIONS`. Read with `filter=all` and
 *       deduplicated HERE, explicitly, by (check_suite.id, name), keeping the
 *       highest id: the latest attempt inside ONE suite, so an in-suite re-run
 *       that went green supersedes its red attempt. (Measured 2026-10-02: CI run
 *       `36899566710`'s attempt 1, cancelled, and attempt 2, success, share check
 *       suite `99947175931`, and `filter=all` returns both attempts' runs there,
 *       26 names twice. A re-run is therefore in-suite.) Runs in DIFFERENT suites are
 *       never collapsed, so a newer suite cannot hide an older red one. (Round 3
 *       relied on `filter=latest` for that, and whether `latest` also collapses
 *       across suites was unmeasured, SFH LOW-07. Now it is true by construction.)
 *   (c) every GitHub Actions check SUITE is `completed`, with a conclusion in the
 *       same set. A workflow run queued at the workflow level (a
 *       `supabase-migrate` run waiting on its concurrency group, review WR-01)
 *       has a suite but no check runs yet, so (b) alone cannot see it. The
 *       conclusion half is stricter than the decided design and is the safe
 *       direction: a completed suite with no runs and a red conclusion is a
 *       workflow that failed to start (a workflow-file error), and it is refused.
 *       Non-Actions suites are ignored: measured 2026-10-02 on three `main`
 *       commits, the `claude`, `vercel`, `railway-app` and `fly-io` apps each
 *       leave a suite `queued` with zero runs forever.
 *
 * Anything else (absent, pending, red, a truncated page, a foreign SHA, a
 * malformed body, a lookup error) runs the full corpus with the reason printed.
 *
 * ⚠️ ACCEPTED COST, by decision (review 164.9.4 round 4, IN-03): because (b) and
 * (c) count every workflow, a scheduled or `workflow_run` workflow that is
 * running or red on `before` (the hourly `prod-prober` and `phase-19-stability`,
 * the daily `Nightly probes`, the `Main CI cancelled watcher`) also costs the
 * short path. That is the safe direction, and it is not scoped away.
 */
export const PREDECESSOR_APP_SLUG = "github-actions";
export const PREDECESSOR_OK_CONCLUSIONS = new Set(["success", "skipped", "neutral"]);
/** `ci.yml`'s `if: always()` aggregator: requirement (a). */
export const PREDECESSOR_REQUIRED_CHECK = "frontend";

/** The `gh api` path for `before`'s check runs, every attempt. A truncated page is refused, never trusted. */
export function checkRunsPath(repo, sha) {
  return `repos/${repo}/commits/${sha}/check-runs?filter=all&per_page=100`;
}

/** The `gh api` path for `before`'s check suites. A truncated page is refused, never trusted. */
export function checkSuitesPath(repo, sha) {
  return `repos/${repo}/commits/${sha}/check-suites?per_page=100`;
}

/**
 * PRODUCTION reader for `before`'s check runs and check suites, through `gh api`
 * with the job's `GH_TOKEN` (`checks: read` covers both). `GITHUB_REPOSITORY` is
 * set on every Actions runner. THROWS on anything it cannot read;
 * `predecessorVerdict` turns a throw into a code verdict.
 */
export function readPredecessor(sha, repo = process.env.GITHUB_REPOSITORY) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo ?? ""))) {
    throw new Error(`GITHUB_REPOSITORY is ${repo ? "not an owner/name pair" : "absent"}`);
  }
  // argv elements, never a shell string; a bounded wait, since the job has five
  // minutes in total.
  const get = (path) =>
    JSON.parse(
      execFileSync("gh", ["api", path], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 60_000,
      }),
    );
  return { runs: get(checkRunsPath(repo, sha)), suites: get(checkSuitesPath(repo, sha)) };
}

/**
 * The seam a caller gets when it passes none. Production: the real `gh` reader.
 * `selfTest()` rebinds it to a sentinel that records the hit and throws (review
 * 164.9.4 round 3, SFH LOW-05), so an in-process row that reaches the lookup
 * without injecting a seam is a NAMED red, never a network call. The throw alone
 * would not be a red: `predecessorVerdict` turns it into a code verdict, which
 * is what most of those rows expect anyway.
 */
let defaultFetchPredecessor = readPredecessor;

/**
 * Review 164.9.4 round 2, LOW-03: git's own reason for a fail-safe arm, as
 * `: <first stderr line>`, so a recurring cause is named in the log rather than
 * quietly costing every docs-only push a full run. Measured (review 164.9.4
 * round 3, IN-01): `cat-file -e <sha>^{commit}`, the form called here, prints
 * `fatal: Not a valid object name …` and exits 128 on a missing object, and the
 * self-test pins that line. Only `merge-base --is-ancestor` on a non-ancestor
 * exits 1 with no stderr, so its reason is empty, which is honest there.
 * git's `fatal:` line names refs and paths, never a secret.
 */
function gitWhy(e) {
  const line = String(e?.stderr ?? "").trim().split("\n")[0];
  return line ? `: ${line}` : "";
}

/** The first line of a failed child's stderr, or the error message. */
function firstLine(e) {
  return (String(e?.stderr ?? "").trim().split("\n")[0] || String(e?.message ?? e)).trim();
}

/**
 * PURE apart from the injected `fetchPredecessor(sha)`: did CI provably run and
 * finish green on `before`? The three requirements are documented above
 * `PREDECESSOR_APP_SLUG`. Anything else is `ok: false` with the reason, and the
 * caller runs the full corpus.
 *
 * ⛔ FAIL SAFE TO CODE. The checks run in a fixed order so each refusal names
 * its most specific cause: the shape of both bodies, a foreign SHA, the run
 * dedupe, a pending run, a red run, an open or red suite, and requirement (a)
 * last.
 *
 * @returns {{ok: boolean, why: string}}
 */
export function predecessorVerdict(sha, fetchPredecessor = defaultFetchPredecessor) {
  let body;
  try {
    body = fetchPredecessor(sha);
  } catch (e) {
    return { ok: false, why: `the check-run lookup failed: ${firstLine(e)}` };
  }
  const runsBody = body?.runs;
  const suitesBody = body?.suites;
  if (!Array.isArray(runsBody?.check_runs)) return { ok: false, why: "the check-run lookup returned no check_runs array" };
  const all = runsBody.check_runs;
  if (typeof runsBody.total_count !== "number" || runsBody.total_count > all.length) {
    return { ok: false, why: `the lookup returned ${all.length} of ${runsBody.total_count} check run(s), so the rest are unread` };
  }
  if (!Array.isArray(suitesBody?.check_suites)) return { ok: false, why: "the check-suite lookup returned no check_suites array" };
  const allSuites = suitesBody.check_suites;
  if (typeof suitesBody.total_count !== "number" || suitesBody.total_count > allSuites.length) {
    return { ok: false, why: `the lookup returned ${allSuites.length} of ${suitesBody.total_count} check suite(s), so the rest are unread` };
  }
  const foreign = [...all, ...allSuites].find((r) => r?.head_sha !== sha);
  if (foreign) return { ok: false, why: `the lookup returned a check run or suite for another commit (${String(foreign?.head_sha).slice(0, 12)})` };

  // (b) Dedupe by (check_suite.id, name), keeping the highest id: the latest
  // attempt inside ONE suite. Never across suites.
  const latest = new Map();
  for (const r of all.filter((x) => x?.app?.slug === PREDECESSOR_APP_SLUG)) {
    const suite = r?.check_suite?.id;
    if (typeof suite !== "number" || typeof r.id !== "number" || typeof r.name !== "string") {
      return { ok: false, why: "a GitHub Actions check run carries no numeric id, check_suite.id or name, so its attempt cannot be placed" };
    }
    const key = `${suite}\u0000${r.name}`;
    if (!latest.has(key) || latest.get(key).id < r.id) latest.set(key, r);
  }
  const runs = [...latest.values()];
  if (runs.length === 0) return { ok: false, why: "absent: no GitHub Actions check run on that commit" };
  const pending = runs.find((r) => r.status !== "completed");
  if (pending) return { ok: false, why: `pending: check '${pending.name}' status ${pending.status}` };
  const bad = runs.find((r) => !PREDECESSOR_OK_CONCLUSIONS.has(r.conclusion));
  if (bad) return { ok: false, why: `check '${bad.name}' concluded ${bad.conclusion}` };

  // (c) Every GitHub Actions check suite completed, and not red.
  const suites = allSuites.filter((s) => s?.app?.slug === PREDECESSOR_APP_SLUG);
  const open = suites.find((s) => s.status !== "completed");
  if (open) {
    return { ok: false, why: `pending: GitHub Actions check suite ${open.id} status ${open.status} with ${open.latest_check_runs_count ?? "an unknown number of"} check run(s) so far` };
  }
  const redSuite = suites.find((s) => !PREDECESSOR_OK_CONCLUSIONS.has(s.conclusion));
  if (redSuite) return { ok: false, why: `GitHub Actions check suite ${redSuite.id} concluded ${redSuite.conclusion}` };

  // (a) CI ran to the end: its aggregator exists and succeeded.
  const frontendOk = runs.some((r) => r.name === PREDECESSOR_REQUIRED_CHECK && r.conclusion === "success");
  if (!frontendOk) {
    return { ok: false, why: `absent: no successful '${PREDECESSOR_REQUIRED_CHECK}' check run, so CI has not run or not finished on that commit` };
  }
  return { ok: true, why: `'${PREDECESSOR_REQUIRED_CHECK}' succeeded and all ${runs.length} GitHub Actions check run(s) in ${suites.length} completed suite(s) are non-red` };
}

/**
 * One machine-readable summary line always; the `$GITHUB_OUTPUT` append only
 * when the variable is present, so a bare local run still works the way every
 * other script in `scripts/` does.
 */
function emit(value, reason) {
  console.log(`docs_only=${value} — ${reason}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${value}\n`);
  }
}

/**
 * A throwaway git repository for the push-range rows. `commit(files)` writes
 * the given paths, commits them and returns the new HEAD sha.
 */
export function scratchRepo(label) {
  const dir = mkdtempSync(join(tmpdir(), `gsd-classify-${label}-`));
  const g = (args) =>
    execFileSync("git", ["-c", "user.name=self-test", "-c", "user.email=self-test@invalid", "-c", "commit.gpgsign=false", ...args], {
      cwd: dir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  g(["init", "-q"]);
  // Every commit is PR-merge-shaped by default (GitHub's committer address and a
  // `(#N)` squash subject), so the push rows reach the predecessor gate; `pr:
  // false` makes a direct-push commit for the WR-02 rows.
  const commit = (files, { pr = true } = {}) => {
    for (const [rel, body] of Object.entries(files)) {
      mkdirSync(join(dir, rel, ".."), { recursive: true });
      writeFileSync(join(dir, rel), body);
    }
    g(["add", "-A"]);
    g(["-c", `user.email=${pr ? "noreply@github.com" : "self-test@invalid"}`, "commit", "-q", "-m", pr ? "c (#1)" : "c"]);
    return g(["rev-parse", "HEAD"]);
  };
  return { dir, g, commit, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Run THIS script's `main()` end to end as CI does, in `cwd`, on a push event.
 * Returns the exit code and the `docs_only=` value it appended to GITHUB_OUTPUT.
 */
function runMainOnPush(cwd, env, { gh = "fail" } = {}) {
  const outFile = join(cwd, ".gsd-github-output");
  writeFileSync(outFile, "");
  // ⭐ OFFLINE BY CONSTRUCTION (SFH-04). A fake `gh` goes FIRST on the child's
  // PATH, so the production reader runs its real argv and never reaches the
  // network. It APPENDS the argv of every call (the reader makes two: check
  // runs, then check suites) and answers each by its path with the canned body
  // for `gh` ("success" | "failure": the `frontend` run's conclusion, its one
  // suite completed success), or exits 1 for "fail". The default is "fail": a
  // row that reaches the lookup without asking for a verdict reads as code, the
  // safe direction.
  const bin = mkdtempSync(join(tmpdir(), "gsd-classify-gh-"));
  const argvFile = join(bin, "argv");
  const head = env.PUSH_BEFORE_SHA ?? "";
  const runsBody = JSON.stringify({
    total_count: 1,
    check_runs: [{ id: 1, name: "frontend", app: { slug: PREDECESSOR_APP_SLUG }, check_suite: { id: 1 }, head_sha: head, status: "completed", conclusion: gh }],
  });
  const suitesBody = JSON.stringify({
    total_count: 1,
    check_suites: [{ id: 1, app: { slug: PREDECESSOR_APP_SLUG }, head_sha: head, status: "completed", conclusion: "success", latest_check_runs_count: 1 }],
  });
  const script =
    gh === "fail"
      ? `#!/bin/sh\nprintf '%s\\n' "$@" >> '${argvFile}'\necho 'gh: self-test lookup failure' >&2\nexit 1\n`
      : `#!/bin/sh\nprintf '%s\\n' "$@" >> '${argvFile}'\ncase "$2" in\n  *check-suites*) printf '%s' '${suitesBody}' ;;\n  *) printf '%s' '${runsBody}' ;;\nesac\n`;
  writeFileSync(join(bin, "gh"), script, { mode: 0o755 });
  try {
    const res = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
      cwd,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        GITHUB_REPOSITORY: "self-test/repo",
        GITHUB_EVENT_NAME: "push",
        GITHUB_OUTPUT: outFile,
        PUSH_BEFORE_SHA: "",
        PUSH_FORCED: "",
        ...env,
      },
    });
    const line = readFileSync(outFile, "utf8").match(/^docs_only=(.*)$/m);
    let ghArgv = null;
    try {
      ghArgv = readFileSync(argvFile, "utf8").split("\n").filter(Boolean);
    } catch {
      // the fake gh was never invoked
    }
    return { code: res.status, docsOnly: line ? line[1] : null, out: `${res.stdout ?? ""}${res.stderr ?? ""}`, ghArgv };
  } finally {
    rmSync(bin, { recursive: true, force: true });
  }
}

/**
 * Canned `{ runs, suites }` bodies for the in-process predecessor rows: GitHub
 * Actions check runs on the asked SHA, named `frontend`, numbered in order and
 * placed in check suite 1, unless a row overrides a field. The suites body
 * carries one COMPLETED, successful suite per distinct suite id the runs name,
 * with the app of the first run in it, plus any `extraSuites` a row adds (a
 * queued one, a red one, a Vercel one).
 */
const checkRuns = (...runs) => withSuites(runs, []);
const withSuites = (runs, extraSuites) => (sha) => {
  const placed = runs.map((r, i) => ({ id: i + 1, name: "frontend", app: { slug: PREDECESSOR_APP_SLUG }, check_suite: { id: 1 }, head_sha: sha, ...r }));
  const suites = new Map();
  for (const r of placed) {
    const id = r.check_suite?.id;
    if (!suites.has(id)) suites.set(id, { id, app: r.app, head_sha: sha, status: "completed", conclusion: "success", latest_check_runs_count: 0 });
    suites.get(id).latest_check_runs_count += 1;
  }
  const allSuites = [...suites.values(), ...extraSuites.map((x) => ({ app: { slug: PREDECESSOR_APP_SLUG }, head_sha: sha, latest_check_runs_count: 0, ...x }))];
  return {
    runs: { total_count: placed.length, check_runs: placed },
    suites: { total_count: allSuites.length, check_suites: allSuites },
  };
};
const GREEN = checkRuns({ status: "completed", conclusion: "success" });
const done = (name, conclusion, extra = {}) => ({ name, status: "completed", conclusion, ...extra });

/**
 * The fixture table. Every row carries its own claim and fires on its own
 * input; the terminal count is DERIVED from this array's length rather than
 * hand-typed, so a row added without a banner cannot drift.
 */
const CASES = [
  {
    claim: "a .planning/-only diff is docs-only (the happy path exists at all)",
    run: (ok) => ok(judge([".planning/ROADMAP.md"]) === true, "a roadmap-only diff classifies as docs"),
  },
  {
    claim: "a MIXED diff is CODE",
    run: (ok) =>
      ok(
        judge([".planning/ROADMAP.md", "src/app/page.tsx"]) === false,
        "one code file anywhere in the list makes the whole diff code",
      ),
  },
  {
    claim: "the filter's own subject re-runs the corpus — .github/workflows/ci.yml",
    run: (ok) =>
      ok(
        judge([".github/workflows/ci.yml"]) === false,
        "a PR editing the workflow that hosts the filter is never filtered",
      ),
  },
  {
    claim: "the detector's own subject re-runs the corpus — scripts/classify-changed-paths.mjs",
    run: (ok) =>
      ok(
        judge(["scripts/classify-changed-paths.mjs"]) === false,
        "a PR editing this very file is never filtered",
      ),
  },
  {
    claim: "a migration alone is CODE",
    run: (ok) =>
      ok(
        judge(["supabase/migrations/20260912000000_x.sql"]) === false,
        "supabase/migrations/ is not on the allow-list",
      ),
  },
  {
    claim: "the allow-list is .planning/, NOT every markdown file",
    run: (ok) => {
      // Each of these ships real behaviour or a real release toll. CHANGELOG.md
      // and VERSION move together on every release; TODOS.md is the backlog's
      // single ground truth; docs/ is link-checked. None is `.planning/`.
      const lookalikes = ["README.md", "docs/runbooks/x.md", "CHANGELOG.md", "VERSION", "TODOS.md"];
      let pass = true;
      for (const f of lookalikes) {
        pass = ok(judge([f]) === false, `${f} alone classifies as code`) && pass;
      }
      return pass;
    },
  },
  {
    claim: "the EMPTY list is CODE — the fail-closed empty-input edge",
    run: (ok) => ok(judge([]) === false, "a zero-file diff runs the full corpus rather than skipping it"),
  },
  {
    claim: "the prefix-boundary edge — .planningfake/ is not .planning/",
    run: (ok) =>
      ok(
        judge([".planning/x.md", ".planningfake/y.ts"]) === false,
        "a sibling directory sharing the prefix does not launder into the allow-list",
      ),
  },
  {
    claim: "the prefix-boundary edge from the other side — a bare `.planning` and `.planning-notes/`",
    run: (ok) => {
      let pass = ok(
        judge([".planning"]) === false,
        "a tracked file named exactly `.planning`, with no separator, classifies as code",
      );
      pass = ok(judge([".planning-notes/x.md"]) === false, ".planning-notes/ classifies as code") && pass;
      return pass;
    },
  },
  {
    claim: "a traversal form does not launder into the allow-list",
    run: (ok) =>
      ok(judge(["docs/../src/a.ts"]) === false, "docs/../src/a.ts classifies as code on its literal bytes"),
  },
  {
    claim: "ORDERING EDGE — the verdict does not depend on the order of the list",
    run: (ok) => {
      const original = [".planning/a.md", "src/b.ts", ".planning/c.md"];
      const reversed = [...original].reverse();
      // ⭐ The reversal is asserted to have APPLIED before the equality is
      // believed. On a one-element list `reverse()` is a no-op and this row
      // would pass while proving nothing — the vacuity shape this table exists
      // to refuse.
      let pass = ok(
        JSON.stringify(reversed) !== JSON.stringify(original),
        "CALIBRATION: the reversal actually produced a different array",
      );
      pass = ok(judge(original) === judge(reversed), "the same set in two orders yields the same verdict") && pass;
      return pass;
    },
  },
  {
    claim: "an UNREADABLE diff base THROWS a MEASURE_FAIL — the shared diff never answers `[]` for it",
    run: (ok) => {
      // A real `git diff` against a ref that cannot exist: exactly the missing-
      // base shape, where git exits non-zero and prints no names. The function
      // is shared with scripts/sql-gate-subset.mjs, so an `[]` here would read
      // as "no gate file changed" there and as "no file changed" here.
      let threw = null;
      let returned;
      try {
        returned = changedFilesAgainstBase({ baseRefName: "gsd-self-test-no-such-base-ref" });
      } catch (e) {
        threw = e;
      }
      let pass = ok(threw !== null, `the diff THREW rather than returning ${JSON.stringify(returned)}`);
      pass =
        ok(
          threw !== null && threw.message.startsWith("MEASURE_FAIL: could not read origin/gsd-self-test-no-such-base-ref"),
          "and the error is the named MEASURE_FAIL naming the unreadable ref",
        ) && pass;
      // Review 164.4.2 IN-02: git's own reason travels INSIDE the MEASURE_FAIL,
      // and is not printed raw above a PASSED verdict where a reader triaging a
      // red run could take it for the cause.
      pass =
        ok(
          threw !== null && /fatal: /.test(threw.message),
          `and it carries git's own stderr reason (got ${JSON.stringify(threw?.message ?? null)})`,
        ) && pass;
      return pass;
    },
  },  {
    claim: "a path git would QUOTE (non-ASCII byte) comes back VERBATIM — never as a `\"…\"` escape",
    run: (ok) => {
      // Review 164.4.2 WR-01. `git diff --name-only` quotes any path holding a
      // non-ASCII byte, a tab, a newline, a backslash or a double quote
      // (`core.quotePath`), printing e.g. `"supabase/tests/test_\303\251.sql"`.
      // The leading `"` defeats every `startsWith` caller: sql-gate-subset.mjs
      // then drops the file from BOTH its gate list and its non-conforming
      // list, and a SUBSET run silently omits it. A real scratch repository,
      // because the defect lives in git's output format, not in our parsing.
      const dir = mkdtempSync(join(tmpdir(), "gsd-classify-quote-"));
      const g = (args) =>
        execFileSync("git", ["-c", "user.name=self-test", "-c", "user.email=self-test@invalid", "-c", "commit.gpgsign=false", ...args], {
          cwd: dir,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      const odd = "supabase/tests/test_\u00e9.sql";
      // Silent-failure-hunter round 2, WR-07: on a machine whose git config sets
      // `core.quotePath=false`, git never quotes this path, so the old no-`-z`
      // code passed this row too. Pin quotePath ON for the row through git's
      // env-config seam (it outranks every config file), and prove below that
      // git DOES quote here without `-z` — otherwise the row measures nothing.
      const pinned = { GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "core.quotePath", GIT_CONFIG_VALUE_0: "true" };
      const saved = Object.fromEntries(Object.keys(pinned).map((k) => [k, process.env[k]]));
      Object.assign(process.env, pinned);
      try {
        g(["init", "-q"]);
        writeFileSync(join(dir, "base.txt"), "base\n");
        g(["add", "base.txt"]);
        g(["commit", "-q", "-m", "base"]);
        g(["update-ref", "refs/remotes/origin/gsd-self-test-base", "HEAD"]);
        mkdirSync(join(dir, "supabase/tests"), { recursive: true });
        writeFileSync(join(dir, odd), "select 1;\n");
        writeFileSync(join(dir, "supabase/tests/test_ok.sql"), "select 1;\n");
        g(["add", "."]);
        g(["commit", "-q", "-m", "head"]);
        const quoted = g(["diff", "--name-only", "--no-renames", "origin/gsd-self-test-base...HEAD"]);
        let pass = ok(
          quoted.includes('"supabase/tests/test_\\303\\251.sql"'),
          `CALIBRATION: without -z, git QUOTES the path here, so this row can fail (got ${JSON.stringify(quoted)})`,
        );
        const files = changedFilesAgainstBase({ baseRefName: "gsd-self-test-base", cwd: dir });
        pass = ok(files.length === 2, `CALIBRATION: both committed paths came back (got ${JSON.stringify(files)})`) && pass;
        pass = ok(files.includes(odd), "the non-ASCII gate path is returned byte-verbatim") && pass;
        pass = ok(!files.some((f) => f.startsWith('"')), "no returned path is a git-quoted escape") && pass;
        return pass;
      } finally {
        for (const [k, v] of Object.entries(saved)) {
          if (v === undefined) delete process.env[k];
          else process.env[k] = v;
        }
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    claim: "WR-01: a docs-only PUSH range takes the SHORT path (docs_only=true), through main() as CI runs it",
    run: (ok) => {
      // RED against the pre-164.9.4 code, which hard-coded a code verdict for
      // every push. Both the function and the end-to-end main() must say true.
      const r = scratchRepo("push-docs");
      try {
        const before = r.commit({ "src/a.ts": "export {};\n" });
        r.commit({ ".planning/STATE.md": "# s\n" });
        let pass = ok(
          classifyPushRange({ before, cwd: r.dir, fetchPredecessor: GREEN }).docsOnly === true,
          "classifyPushRange says docs-only for a .planning/-only pushed range on a green predecessor",
        );
        const e2e = runMainOnPush(r.dir, { PUSH_BEFORE_SHA: before }, { gh: "success" });
        pass = ok(e2e.code === 0 && e2e.docsOnly === "true", `main() on a push event writes docs_only=true and exits 0 (got exit ${e2e.code}, docs_only=${e2e.docsOnly})`) && pass;
        return pass;
      } finally {
        r.cleanup();
      }
    },
  },
  {
    claim: "WR-01: a CODE-touching push range is NOT filtered, including a code commit hidden under a later docs commit",
    run: (ok) => {
      const r = scratchRepo("push-code");
      try {
        const base = r.commit({ "src/a.ts": "export {};\n" });
        r.commit({ "src/b.ts": "export {};\n" });
        let pass = ok(classifyPushRange({ before: base, cwd: r.dir }).docsOnly === false, "a single code commit pushed classifies as code");
        const mid = r.g(["rev-parse", "HEAD"]);
        r.commit({ ".planning/STATE.md": "# s\n" });
        // CALIBRATION: the last commit alone IS docs-only, so a first-parent
        // `HEAD^1..HEAD` diff would skip the corpus here. This row can fail.
        const lastOnly = r.g(["diff", "--name-only", "--no-renames", mid, "HEAD"]).split("\n").filter(Boolean);
        pass = ok(judge(lastOnly) === true, "CALIBRATION: the newest pushed commit on its own is docs-only") && pass;
        pass = ok(classifyPushRange({ before: base, cwd: r.dir }).docsOnly === false, "a two-commit push (code, then docs) classifies as code") && pass;
        const e2e = runMainOnPush(r.dir, { PUSH_BEFORE_SHA: base });
        pass = ok(e2e.code === 0 && e2e.docsOnly === "false", `main() writes docs_only=false for it (got exit ${e2e.code}, docs_only=${e2e.docsOnly})`) && pass;
        return pass;
      } finally {
        r.cleanup();
      }
    },
  },
  {
    claim: "WR-01: an UNDETERMINABLE push range fails SAFE to code (full corpus) and never red",
    run: (ok) => {
      const r = scratchRepo("push-undet");
      try {
        const base = r.commit({ "src/a.ts": "export {};\n" });
        r.commit({ ".planning/a.md": "a\n" });
        const head = r.g(["rev-parse", "HEAD"]);
        // A sibling of HEAD off the same base, differing from HEAD only under
        // `.planning/`: the shape a force push leaves as `before`.
        r.g(["checkout", "-q", "-b", "sibling", base]);
        const sibling = r.commit({ ".planning/b.md": "b\n" });
        r.g(["checkout", "-q", head]);
        const siblingDiff = r.g(["diff", "--name-only", "--no-renames", sibling, "HEAD"]).split("\n").filter(Boolean);
        let pass = ok(
          judge(siblingDiff) === true,
          `CALIBRATION: a two-dot diff from the non-ancestor sibling is docs-only, so only the ancestor guard keeps this row code (got ${JSON.stringify(siblingDiff)})`,
        );
        // CALIBRATION: the same repo says docs-only for its real range, so a
        // `false` below is caused by the bad input and not by the fixture.
        pass = ok(classifyPushRange({ before: base, cwd: r.dir, fetchPredecessor: GREEN }).docsOnly === true, "CALIBRATION: the real pushed range is docs-only") && pass;
        const undeterminable = [
          ["a non-ancestor (force-pushed-over) before-SHA", { before: sibling }],
          ["a forced push flag (string, as GitHub's expression renders it)", { before: base, forced: "true" }],
          ["a forced push flag (boolean)", { before: base, forced: true }],
          ["an all-zero before-SHA (branch creation)", { before: "0".repeat(40) }],
          ["a before-SHA that is not in this clone", { before: "1".repeat(40) }],
          ["an absent before-SHA", { before: "" }],
          ["a before-SHA that is not an object name", { before: "HEAD~1" }],
        ];
        for (const [label, input] of undeterminable) {
          const v = classifyPushRange({ ...input, cwd: r.dir });
          pass = ok(v.docsOnly === false && v.reason.startsWith("push range undeterminable"), `${label} classifies as code (${v.reason})`) && pass;
        }
        // LOW-03: a fail-safe arm keeps git's own reason. Measured: `cat-file -e`
        // on an absent `<sha>^{commit}` prints `fatal: Not a valid object name …`.
        const absent = classifyPushRange({ before: "1".repeat(40), cwd: r.dir });
        pass = ok(/: fatal: /.test(absent.reason), `the not-in-clone reason carries git's stderr line (${absent.reason})`) && pass;
        const e2e = runMainOnPush(r.dir, { PUSH_BEFORE_SHA: "0".repeat(40) });
        pass = ok(e2e.code === 0 && e2e.docsOnly === "false", `main() exits 0 with docs_only=false on an undeterminable range, never red (got exit ${e2e.code}, docs_only=${e2e.docsOnly})`) && pass;
        const dispatch = runMainOnPush(r.dir, { GITHUB_EVENT_NAME: "workflow_dispatch", PUSH_BEFORE_SHA: base });
        pass = ok(dispatch.code === 0 && dispatch.docsOnly === "false", `a workflow_dispatch is still never filtered (got docs_only=${dispatch.docsOnly})`) && pass;
        return pass;
      } finally {
        r.cleanup();
      }
    },
  },
  {
    claim: "SFH-04 / CR-01 r4: a docs-only push on an UNPROVEN predecessor runs the full corpus; only proof that CI ran and finished green on `before` (a successful `frontend`, every Actions check run and suite completed non-red) earns the short path",
    run: (ok) => {
      // RED against the round-1 code, which judged the pushed range alone: every
      // row below then said docs_only=true over a red or unfinished code commit.
      // The no-`frontend` rows are RED against the round-3 code (review round 4
      // CR-01, SFH MEDIUM-01), and the queued-suite row against every earlier
      // round (review round 4 WR-01).
      const r = scratchRepo("push-pred");
      try {
        const before = r.commit({ "src/a.ts": "export {};\n" });
        r.commit({ ".planning/STATE.md": "# s\n" });
        const sha12 = before.slice(0, 12);
        // CALIBRATION: with a green predecessor this exact range IS docs-only,
        // so each `false` below is caused by the verdict and not by the range.
        let pass = ok(classifyPushRange({ before, cwd: r.dir, fetchPredecessor: GREEN }).docsOnly === true, "CALIBRATION: green predecessor, docs-only range → docs_only=true");
        const s2 = { check_suite: { id: 2 } };
        // Rows that MUST take the short path: each pins one half of the rule, so
        // a predicate that refused everything could not pass this table.
        const proven = [
          ["every Actions check green, one SKIPPED and one NEUTRAL", checkRuns(done("frontend", "success"), done("e2e", "skipped"), done("lighthouse-mobile", "neutral"))],
          ["a FAILED non-Actions check (a Vercel deployment) is ignored", checkRuns(done("frontend", "success"), done("Vercel", "failure", { app: { slug: "vercel" }, check_suite: { id: 9 } }))],
          // Measured 2026-10-02 on three `main` commits: the claude, vercel,
          // railway-app and fly-io apps each leave a suite QUEUED with zero runs
          // forever. Requirement (c) must ignore them, or it refuses every push.
          ["a QUEUED non-Actions suite with no runs (Vercel's, every commit carries one) is ignored", withSuites([done("frontend", "success")], [{ id: 9, app: { slug: "vercel" }, status: "queued", conclusion: null }])],
          // An in-suite re-run: `filter=all` returns BOTH attempts, the red one
          // with the lower id. Deduped by (suite, name), the green attempt wins.
          ["an in-suite re-run (an older RED attempt and a newer GREEN attempt, same suite)", checkRuns(done("e2e", "failure", { id: 7 }), done("e2e", "success", { id: 8 }), done("frontend", "success", { id: 9 }))],
          ["a green CI suite beside a green scheduled workflow's suite", checkRuns(done("frontend", "success"), done("npm-audit", "success", s2))],
        ];
        for (const [label, fetchPredecessor] of proven) {
          const v = classifyPushRange({ before, cwd: r.dir, fetchPredecessor });
          pass = ok(v.docsOnly === true, `${label} → docs_only=true (${v.reason})`) && pass;
        }
        const unproven = [
          ["a RED predecessor (frontend concluded failure)", checkRuns(done("frontend", "failure")), "concluded failure"],
          // Review round 3 WR-01: CI run 36892795002's shape. Its `frontend` check
          // concluded success while a job outside the aggregator reddened the run.
          ["a RED non-aggregated check beside a green frontend (run 36892795002's shape)", checkRuns(done("frontend", "success"), done("e2e", "failure")), "'e2e' concluded failure"],
          ["a RED check from ANOTHER workflow on the same commit", checkRuns(done("frontend", "success"), done("apply-test", "failure", s2)), "'apply-test' concluded failure"],
          ["a RED dispatch-run check (Railway counts dispatch runs too)", checkRuns(done("frontend", "success"), done("secret-scan", "failure", s2)), "'secret-scan' concluded failure"],
          ["a newer RED attempt of the same check in the same suite", checkRuns(done("e2e", "success", { id: 7 }), done("e2e", "failure", { id: 8 }), done("frontend", "success", { id: 9 })), "'e2e' concluded failure"],
          // Orchestrator decision 2026-10-02: a newer suite does NOT hide an older
          // red one. Whether Railway lets it is unmeasured, so this is refused.
          ["a RED run in another suite beside a GREEN run of the same name", checkRuns(done("e2e", "failure"), done("e2e", "success", s2), done("frontend", "success")), "'e2e' concluded failure"],
          ["a CANCELLED predecessor", checkRuns(done("frontend", "cancelled")), "concluded cancelled"],
          ["a TIMED-OUT check", checkRuns(done("frontend", "timed_out")), "concluded timed_out"],
          ["an ACTION_REQUIRED check", checkRuns(done("frontend", "action_required")), "concluded action_required"],
          ["a STALE check", checkRuns(done("frontend", "stale")), "concluded stale"],
          ["a PENDING predecessor (its CI still running)", checkRuns({ name: "frontend", status: "in_progress", conclusion: null }), "status in_progress"],
          // Review round 4 CR-01 / SFH MEDIUM-01: green checks are not proof that
          // CI ran. Each of these three is the round-3 fail-open.
          ["green Actions checks but NO frontend (CI caught between needs: stages)", checkRuns(done("changed-paths", "success"), done("python", "success"), done("contracts", "success", s2)), "no successful 'frontend' check run"],
          ["ONLY a scheduled workflow's checks (a skip-trailer merge: CI never ran)", checkRuns(done("npm-audit", "success"), done("preflight", "success")), "no successful 'frontend' check run"],
          ["a SKIPPED frontend (it must have concluded success)", checkRuns(done("frontend", "skipped"), done("python", "success")), "no successful 'frontend' check run"],
          // Review round 4 WR-01: a workflow run queued at the workflow level (a
          // supabase-migrate run waiting on its concurrency group) has a suite
          // and no check runs yet.
          ["a QUEUED Actions suite with no check runs beside a green CI", withSuites([done("frontend", "success")], [{ id: 5, status: "queued", conclusion: null }]), "check suite 5 status queued with 0 check run(s)"],
          ["a COMPLETED Actions suite with no runs that concluded failure (a workflow that failed to start)", withSuites([done("frontend", "success")], [{ id: 5, status: "completed", conclusion: "failure" }]), "check suite 5 concluded failure"],
          ["a MISSING predecessor verdict (no check run)", withSuites([], []), "absent: no GitHub Actions check run"],
          ["only non-Actions check runs (no Actions verdict at all)", checkRuns(done("Vercel", "success", { app: { slug: "vercel" } })), "absent"],
          ["an API ERROR during the lookup", () => { const e = new Error("Command failed: gh api"); e.stderr = "gh: HTTP 502: Bad Gateway\n"; throw e; }, "gh: HTTP 502: Bad Gateway"],
          ["a malformed API body", () => ({ message: "Not Found" }), "no check_runs array"],
          ["a malformed check-suite body", (sha) => ({ ...GREEN(sha), suites: { message: "Not Found" } }), "no check_suites array"],
          ["a TRUNCATED lookup (more check runs than one page)", (sha) => ({ ...GREEN(sha), runs: { ...GREEN(sha).runs, total_count: 150 } }), "check run(s), so the rest are unread"],
          ["a TRUNCATED check-suite lookup (more suites than one page)", (sha) => ({ ...GREEN(sha), suites: { ...GREEN(sha).suites, total_count: 150 } }), "check suite(s), so the rest are unread"],
          ["a check run for ANOTHER commit in the response", checkRuns(done("frontend", "success", { head_sha: "f".repeat(40) })), "another commit"],
          ["a check SUITE for ANOTHER commit in the response", withSuites([done("frontend", "success")], [{ id: 5, status: "completed", conclusion: "success", head_sha: "f".repeat(40) }]), "another commit"],
          ["an Actions check run with no check_suite.id (its attempt cannot be placed)", checkRuns(done("frontend", "success", { check_suite: null })), "cannot be placed"],
        ];
        for (const [label, fetchPredecessor, why] of unproven) {
          const v = classifyPushRange({ before, cwd: r.dir, fetchPredecessor });
          pass =
            ok(
              v.docsOnly === false && v.reason.startsWith(`predecessor ${sha12} is not proven green`) && v.reason.includes(why),
              `${label} classifies as code, naming why (${v.reason})`,
            ) && pass;
        }
        // A zero before-SHA never reaches the lookup at all: it is code first.
        let called = false;
        const spy = (sha) => {
          called = true;
          return GREEN(sha);
        };
        const zero = classifyPushRange({ before: "0".repeat(40), cwd: r.dir, fetchPredecessor: spy });
        pass = ok(zero.docsOnly === false && !called, `a zero before-SHA is code without consulting the predecessor (${zero.reason})`) && pass;
        // End to end through main() and the production `gh api` reader, offline:
        // the fake gh records its argv, so the endpoint itself is pinned.
        const red = runMainOnPush(r.dir, { PUSH_BEFORE_SHA: before }, { gh: "failure" });
        pass = ok(red.code === 0 && red.docsOnly === "false", `main() on a red predecessor writes docs_only=false and exits 0, never red (got exit ${red.code}, docs_only=${red.docsOnly})`) && pass;
        pass =
          ok(
            JSON.stringify(red.ghArgv) ===
              JSON.stringify([
                "api",
                `repos/self-test/repo/commits/${before}/check-runs?filter=all&per_page=100`,
                "api",
                `repos/self-test/repo/commits/${before}/check-suites?per_page=100`,
              ]),
            `the production reader asks gh for exactly before's check runs (every attempt) and check suites (got ${JSON.stringify(red.ghArgv)})`,
          ) && pass;
        const broken = runMainOnPush(r.dir, { PUSH_BEFORE_SHA: before }, { gh: "fail" });
        pass = ok(broken.code === 0 && broken.docsOnly === "false" && /gh: self-test lookup failure/.test(broken.out), `main() on a failing gh writes docs_only=false, exits 0 and prints gh's reason (got exit ${broken.code}, docs_only=${broken.docsOnly})`) && pass;
        const norepo = runMainOnPush(r.dir, { PUSH_BEFORE_SHA: before, GITHUB_REPOSITORY: "" }, { gh: "success" });
        pass = ok(norepo.code === 0 && norepo.docsOnly === "false" && norepo.ghArgv === null, `main() with no GITHUB_REPOSITORY is code and never calls gh (got docs_only=${norepo.docsOnly})`) && pass;
        // A CODE range never calls the API either: the lookup is consulted last.
        r.commit({ "src/b.ts": "export {};\n" });
        called = false;
        const codeRange = classifyPushRange({ before, cwd: r.dir, fetchPredecessor: spy });
        pass = ok(codeRange.docsOnly === false && !called, `a code-touching range is code without consulting the predecessor (${codeRange.reason})`) && pass;
        return pass;
      } finally {
        r.cleanup();
      }
    },
  },
  {
    claim: "WR-02 r4: a docs-only push range carrying a commit that is NOT a GitHub PR merge runs the FULL corpus (plan-anchor-verify never saw it)",
    run: (ok) => {
      // RED against the round-4 code, which trusted, unchecked, that every main
      // commit is a PR merge. A direct push skips plan-anchor-verify entirely.
      const r = scratchRepo("push-direct");
      try {
        let pass = ok(isPrMergeCommit("noreply@github.com", "fix(x): y (#123)"), "CALIBRATION: a GitHub squash merge is a PR merge");
        pass = ok(isPrMergeCommit("noreply@github.com", "Merge pull request #656 from owner/branch"), "CALIBRATION: a GitHub merge commit is a PR merge") && pass;
        pass = ok(!isPrMergeCommit("dev@example.invalid", "fix(x): y (#123)"), "a (#N) subject committed by a developer (a local squash pushed by hand) is NOT a PR merge") && pass;
        pass = ok(!isPrMergeCommit("noreply@github.com", "docs(146): close Phase 146"), "a GitHub-committed commit without a PR subject is NOT a PR merge") && pass;
        const before = r.commit({ "src/a.ts": "export {};\n" });
        r.commit({ ".planning/STATE.md": "# s\n" });
        // CALIBRATION: the same shape with a PR-merge commit IS docs-only.
        pass = ok(classifyPushRange({ before, cwd: r.dir, fetchPredecessor: GREEN }).docsOnly === true, "CALIBRATION: a PR-merge docs-only push on a green predecessor is docs-only") && pass;
        const mid = r.g(["rev-parse", "HEAD"]);
        r.commit({ ".planning/STATE.md": "# s2\n" }, { pr: false });
        let called = false;
        const spy = (sha) => {
          called = true;
          return GREEN(sha);
        };
        const v = classifyPushRange({ before, cwd: r.dir, fetchPredecessor: spy });
        pass = ok(v.docsOnly === false && v.reason.includes("is not a GitHub PR merge") && !called, `a direct-push docs commit in the range classifies as code without consulting the predecessor (${v.reason})`) && pass;
        const only = classifyPushRange({ before: mid, cwd: r.dir, fetchPredecessor: GREEN });
        pass = ok(only.docsOnly === false && only.reason.includes("is not a GitHub PR merge"), `a direct push alone classifies as code (${only.reason})`) && pass;
        return pass;
      } finally {
        r.cleanup();
      }
    },
  },
  {
    claim: "WR-01 round 2: a push touching a .planning/ file a frontend-test assertion reads runs the FULL corpus, even on a green predecessor",
    run: (ok) => {
      // RED against the round-1 code, which classified every such push as
      // docs-only and so dropped the merge-push backstop for these files.
      const r = scratchRepo("push-testread");
      try {
        let pass = ok(TEST_READ_PLANNING_PATHS.length === 7, `the list carries the seven measured paths (got ${TEST_READ_PLANNING_PATHS.length})`);
        pass = ok(TEST_READ_PLANNING_PATHS.every((f) => judge([f])), "CALIBRATION: every listed path is docs-only to judge(), so only the new rule can make it code") && pass;
        let head = r.commit({ "src/a.ts": "export {};\n" });
        // CALIBRATION: a planning file NOT on the list still takes the short path.
        let before = head;
        head = r.commit({ ".planning/STATE.md": "# s\n" });
        pass = ok(classifyPushRange({ before, cwd: r.dir, fetchPredecessor: GREEN }).docsOnly === true, "CALIBRATION: a STATE.md-only push on a green predecessor stays docs-only") && pass;
        for (const f of TEST_READ_PLANNING_PATHS) {
          before = head;
          head = r.commit({ [f]: `# ${f}\n` });
          const v = classifyPushRange({ before, cwd: r.dir, fetchPredecessor: GREEN });
          pass = ok(v.docsOnly === false && v.reason.includes(f), `${f} alone classifies as code (${v.reason})`) && pass;
        }
        // Mixed with an unlisted planning file it is still code.
        before = head;
        head = r.commit({ ".planning/ROADMAP.md": "# r2\n", ".planning/STATE.md": "# s2\n" });
        pass = ok(classifyPushRange({ before, cwd: r.dir, fetchPredecessor: GREEN }).docsOnly === false, "ROADMAP.md beside STATE.md classifies as code") && pass;
        const e2e = runMainOnPush(r.dir, { PUSH_BEFORE_SHA: before }, { gh: "success" });
        pass = ok(e2e.code === 0 && e2e.docsOnly === "false", `main() writes docs_only=false for it and exits 0 (got exit ${e2e.code}, docs_only=${e2e.docsOnly})`) && pass;
        // The PR path is unchanged by decision: judge() still says docs-only.
        pass = ok(judge([".planning/ROADMAP.md"]) === true, "the PR predicate judge() is untouched: a ROADMAP-only PR is still docs-only") && pass;
        return pass;
      } finally {
        r.cleanup();
      }
    },
  },
];

function selfTest() {
  let pass = true;
  const ok = (cond, msg) => {
    console.log(`  ${cond ? "ok  " : "FAIL"} — ${msg}`);
    return cond;
  };

  // ⛔ The non-empty fixture fence, imported from `scripts/lint-app-guc.mjs`'s
  // self-test (which `check-version-bump.mjs` lacks). An empty table is not a
  // clean one: every arm below would report zero fixtures and this self-test
  // would have nothing to prove, while still exiting 0.
  if (CASES.length === 0) {
    console.error("=== SELF-TEST FAILED: the fixture table is EMPTY — this self-test would prove nothing ===");
    return 1;
  }
  if (DOCS_ONLY_PREFIXES.length === 0) {
    console.error(
      "=== SELF-TEST FAILED: DOCS_ONLY_PREFIXES is EMPTY — judge() would answer false for every input, " +
        "which passes every negative row below while the allow-list has ceased to exist ===",
    );
    return 1;
  }

  // SFH LOW-05: the in-process rows never fall back to the production reader.
  // `runMainOnPush` rows run in a child process with a fake `gh` and are unaffected.
  const STRAY = "self-test row reached the predecessor lookup without a seam";
  let stray = false;
  defaultFetchPredecessor = () => {
    stray = true;
    throw new Error(STRAY);
  };
  try {
    CASES.forEach((c, i) => {
      console.log(`=== SELF-TEST ${i + 1}/${CASES.length}: ${c.claim}`);
      stray = false;
      pass = c.run(ok) && pass;
      if (stray) pass = ok(false, `${STRAY} (row ${i + 1}); inject fetchPredecessor, never the real gh`) && pass;
    });
  } finally {
    defaultFetchPredecessor = readPredecessor;
  }

  console.log("");
  if (!pass) {
    console.error("=== SELF-TEST FAILED ===");
    return 1;
  }
  console.log(`=== SELF-TEST PASSED: ${CASES.length}/${CASES.length}, every verdict fired on its own input ===`);
  return 0;
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();

  if (process.env.GITHUB_EVENT_NAME === "push") {
    // Phase 164.9.4 (founder routing 2026-09-27): a push is classified by its
    // pushed range, failing SAFE to code. See `classifyPushRange`.
    const { docsOnly, reason } = classifyPushRange({
      before: process.env.PUSH_BEFORE_SHA,
      forced: process.env.PUSH_FORCED,
    });
    emit(docsOnly, reason);
    return 0;
  }

  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    // LOCKED DECISION (Phase 164.6.3 CONTEXT.md, trigger scope): the dispatch
    // corpus, and every event that is neither a push nor a pull_request, is
    // NEVER filtered. `ci.yml`'s own header records why — every commit to main
    // must produce its own recorded green run (deploy automation keys on
    // per-SHA status), and Railway waits on main CI and SKIPS the
    // analytics-service deploy when it is red.
    // (2026-10-01, Phase 164.9.4 review WR-01: `push` left this branch above,
    // by the founder's 2026-09-27 routing. A docs-only push still produces a
    // recorded green run; it is a short run, not a missing one.)
    emit(false, `event is '${process.env.GITHUB_EVENT_NAME ?? "(unset)"}', neither push nor pull_request — never filtered`);
    return 0;
  }

  const baseRef = baseRefFor();
  let changedFiles;
  try {
    changedFiles = changedFilesAgainstBase();
  } catch (e) {
    // ⛔ A gate that cannot read cannot report a pass. The message is the
    // `MEASURE_FAIL: could not read <ref> — <cause>` line, printed as before.
    console.error(e.message);
    return 1;
  }

  emit(judge(changedFiles), `${changedFiles.length} changed file(s) against ${baseRef}`);
  return 0;
}

/**
 * Realpath-safe main-module guard — the `[VAC04-C2]` lesson, copied from
 * `scripts/lint-app-guc.mjs`: comparing `import.meta.url` to
 * `file://${process.argv[1]}` no-ops on symlinked or space-bearing paths,
 * silently turning the CLI into a library.
 *
 * ⚠️ A DECLARED DIVERGENCE FROM THE ANALOG, not drift. `check-version-bump.mjs`
 * ends with a bare `process.exit(main());`, and it gets away with it because
 * nothing imports it. This module IS imported — `ci-docs-path-filter.contract.
 * test.ts` calls `judge()` directly, and that import is the end-to-end wiring
 * the contract test exists to prove — so an unguarded `process.exit` here would
 * terminate the vitest worker at import time. Two in-repo idioms exist
 * (`lint-sql-gates.mjs`'s `resolve()` form and `lint-app-guc.mjs`'s realpath
 * form); the realpath one is taken because it is the one that carries a named
 * defect lesson.
 */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (invokedDirectly()) {
  process.exit(main());
}
