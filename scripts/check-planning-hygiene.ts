#!/usr/bin/env -S npx tsx
/**
 * CI hook — fail if ANY tracked file carries the macOS username or a local
 * absolute home path. Phase 163 SEC-02.
 *
 * The repo is public and `.planning/` is tracked, so every committed byte is
 * world-readable. GSD tooling and agents routinely write absolute worktree and
 * scratchpad paths into new planning artifacts; before this gate existed, 95
 * tracked files had accumulated ~940 such occurrences. ⚠️ The token is local
 * identity METADATA, not a credential — this gate exists to stop new leakage,
 * not because a secret escaped. Redaction is forward-only by founder decision:
 * git history still holds the old occurrences and is deliberately not rewritten.
 *
 * ⛔ NO PATH ALLOWLIST — BY CONSTRUCTION.
 * The reason the existing tooling missed this class entirely is that gitleaks'
 * allowlist is PATH-based, so `.planning/**` was carved out and the scanner was
 * structurally blind. This gate therefore has no path exclusions of any kind:
 * not for its own source, not for tests, not for `supabase/migrations/`, not
 * for fixtures. The single exemption is by VALUE (Rule 4 below) — a redaction
 * placeholder is definitionally non-identifying, wherever it appears. Adding a
 * path carve-out here reproduces the exact blindness this file exists to fix.
 *
 * Rules enforced
 * --------------
 *   1. LOCAL-USERNAME — the local machine username appears in a tracked file
 *      (matched case-insensitively). ⛔ The needle is DERIVED AT RUNTIME from
 *      the environment and never committed in any encoding. Storing it base64
 *      — the first cut of this gate — let the scanner pass its own scan while
 *      leaving the name recoverable from a public clone by anyone with
 *      `base64 -d`, so the success line was false of the tree it had walked
 *      (Phase 163 WR-01). This rule DISABLES ITSELF, loudly, when no plausible
 *      personal identifier can be derived; see `deriveLocalUsername`.
 *   2. ABSOLUTE-HOME-PATH — the macOS home-directory prefix (spelled escaped:
 *      `\/Users\/`) appears in a tracked file. STRUCTURAL, not name-based, so a
 *      teammate's absolute path with a DIFFERENT username fails too. A gate that
 *      only knew one username would guard exactly one laptop.
 *   3. SCRATCH-HOME-PATH — the dash-mangled form of the same path (spelled
 *      escaped: `\-Users\-`), which is how agent scratchpad directory names
 *      encode a home path. Same structural reasoning as Rule 2.
 *   4. The value exemption: an occurrence of the Rule 2 / Rule 3 prefix that is
 *      immediately followed by the redaction placeholder `<user>` is NOT a
 *      violation. This is a VALUE test on the matched text, never a test on the
 *      file's path.
 *   5. EMPTY-SCAN — enumerating zero files is a FAILURE, not a pass. A gate that
 *      silently walks nothing (wrong cwd, `git ls-files` returning empty) is
 *      worse than no gate: it reports OK forever. The success line always prints
 *      the scanned-file count for the same reason.
 *
 * Two blind spots this gate is built to avoid
 * -------------------------------------------
 *   - NUL bytes. `grep` and `git grep -I` classify a file containing a NUL as
 *     binary and silently skip its content; exit 1 then reads as "clean".
 *     `src/lib/wizardErrors.test.ts` carries a deliberate NUL at line 1572, so a
 *     grep-based gate is structurally blind to that one file. Every file here is
 *     read with `readFileSync(..., "latin1")`: a byte-exact 1:1 decode that
 *     neither truncates at a NUL nor collapses invalid sequences into
 *     replacement characters the way a utf8 decode would.
 *   - Self-match. See Rules 1-3 — runtime-derived username, char-code structural
 *     prefixes, escaped prose. ⚠️ An ENCODING IS NOT A REDACTION: base64, hex,
 *     percent-encoding and split-and-concatenated literals all keep the value
 *     recoverable, so none of them is an acceptable way to carry a needle in a
 *     tracked file. The only self-match escape that is also a real redaction is
 *     not having the value in the tree at all.
 *
 * A known sharp edge: tracked binaries
 * ------------------------------------
 * ⚠️ A tracked BINARY that happens to contain the bytes of a home-path prefix
 * fails Rules 2-3 with no fix available: the bytes cannot be edited out the way
 * a line of prose can, and there is no path allowlist to excuse the file. This
 * is ACCEPTED, not overlooked — measured 2026-08-26, zero of the 5712 tracked
 * files hit it. If one ever does, the remedy is to stop tracking that binary or
 * to regenerate it without the embedded path. ⛔ It is NOT to add a path
 * exemption here: the moment this file grows a path allowlist it is blind in
 * exactly the way that let 940 occurrences accumulate under gitleaks.
 *
 * False positives, and why Rule 1 is CORROBORATION-GATED
 * ------------------------------------------------------
 * Rule 1's needle is DERIVED, and a derived needle can be an ordinary word.
 * `deriveLocalUsername` used to accept anything that stayed off a hand-written
 * denylist and cleared a 6-character floor, so an ordinary non-personal home
 * directory — `/home/developer`, `/home/deployer`, a `workspace` container home
 * — sailed through both tests and became a case-insensitive substring search
 * over every tracked file. MEASURED on this tree at the commit that introduced
 * this paragraph: `HYGIENE_LOCAL_USERNAME=developer` produced 153 violations
 * across 102 files on a tree with ZERO real leakage. Because there is no path
 * allowlist by construction, that contributor's only escape was the very
 * variable that caused it, and nothing in the output distinguished a false
 * positive from a real leak. A gate that cries wolf on a clean tree is switched
 * off by the third person who hits it, which costs more than the wolf did.
 *
 * The remedy is CORROBORATION, never an exemption. Rule 1 searches for a needle
 * only when the tree agrees the word could be an identity. A needle is
 * corroborated when EITHER
 *   - it occurs at least once in a HOME-PATH-SHAPED context — immediately after
 *     the escaped-spelling `\/Users\/`, `\-Users\-`, `/home/`, `-home-` or `~`.
 *     That is the leak class this gate exists for, and it is positive evidence
 *     that the word names a home directory in THIS repo; OR
 *   - it is RARE: at most `MAX_ENDEMIC_FILES` tracked files contain it. A fresh
 *     leak is small at the instant it appears — which is precisely what a
 *     per-commit gate is for — while an ordinary word is endemic from day zero.
 *     See `MAX_ENDEMIC_FILES` for the measured separation the threshold sits in.
 *
 * ⛔ Corroboration is a test on the NEEDLE and on the MATCHED CONTEXT. It is
 * never a test on a file's path, and it never exempts an individual file: once
 * a needle is corroborated, every occurrence of it in every tracked file is a
 * violation, including bare ones in prose and including this file.
 *
 * Uncorroborated ⇒ Rule 1 is DISABLED AND SAYS SO, printing the file count that
 * disabled it — distinguishable and self-explaining, never silently absent.
 * ⚠️ That is a deliberate fail-open, bounded to Rule 1: Rules 2-3 are
 * structural, keep running, and still catch every absolute and dash-mangled
 * home path on any machine. Someone whose real account name happens to be
 * endemic in this codebase therefore loses Rule 1 loudly and keeps Rules 2-3.
 * There is deliberately NO force-on override for that case: a switch that can
 * turn a gate on is the same switch that can turn it off.
 *
 * The denylist below stays, and is load-bearing rather than redundant: it names
 * accounts that are non-personal ON ANY MACHINE AND IN ANY REPO, whereas
 * corroboration can only measure THIS tree. `runner` is the proof — this file's
 * own prose documents `/home/runner`, a home-path-shaped occurrence, so
 * corroboration ALONE would confirm the CI account name and fire 2863 times.
 *
 * Demonstrated RED (Phase 163 plan 03, recorded in 163-03-SUMMARY.md): with the
 * scrub landed and `npm run lint` green, a scratch tracked file
 * (`.planning/red-demo-scratch.md`) containing one raw structural occurrence was
 * added with `git add -N`; `npm run lint` exited 1 with
 * `ABSOLUTE-HOME-PATH: .planning/red-demo-scratch.md:1`. Deleting the scratch
 * file returned lint to green. The mutation is: introduce one unescaped home-path
 * prefix into any tracked file; the direction is green → exit 1.
 *
 * Demonstrated RED for Rule 1 after the WR-01 rework (2026-08-26), on the real
 * default derivation: a scratch `red-demo-username.md` holding the derived
 * username was added with `git add -N`; the gate exited 1 with
 * `LOCAL-USERNAME: red-demo-username.md:1`. Deleting it returned exit 0 with
 * `5714 tracked files scanned`. Running with `HYGIENE_LOCAL_USERNAME=runner`
 * exits 0 but prints the rule-1-DID-NOT-RUN warning and drops the username
 * clause from the success line — the honest-claim behaviour WR-01 asked for.
 *
 * Exit codes
 * ----------
 *   0  every tracked file is clean (count printed).
 *   1  one or more violations, or zero files enumerated.
 *
 * Invocation
 * ----------
 * Wired into `npm run check:planning-hygiene` and `npm run lint` — lint runs in
 * the `frontend-lint` CI job, which is already in the `frontend` aggregator's
 * `needs:` list, so no workflow-file change was required. ⛔ Deliberately NOT
 * attached to the `secret-scan` job: it is not in the aggregator and is already
 * red on `workflow_dispatch`, so a violation there would gate nothing.
 *
 * Fixing a violation: replace the username with the placeholder `<user>`,
 * rewrite absolute paths that point into this repo as repo-relative paths, and
 * spell the patterns escaped when a document needs to NAME them.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";
import { basename, dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

/**
 * The two STRUCTURAL needles, spelled as char codes so this source does not
 * trip its own Rules 2-3. They encode no identity — they are the shape of a
 * home path, not anyone's name — so committing them discloses nothing.
 *
 * The Rule 1 needle is deliberately absent from this list: see
 * `deriveLocalUsername` below.
 */
const HOME_PREFIX = String.fromCharCode(47, 85, 115, 101, 114, 115, 47);
const SCRATCH_PREFIX = String.fromCharCode(45, 85, 115, 101, 114, 115, 45);

/**
 * ⛔ THE RULE 1 NEEDLE IS NEVER COMMITTED, IN ANY ENCODING (Phase 163 WR-01).
 *
 * The first cut of this gate stored the username base64-encoded so the scanner
 * could pass its own scan. That kept the gate self-consistent and left the
 * disclosure fully intact: `base64 -d` recovers the name from a public clone,
 * so the success line "none carry the local username" was false of the very
 * tree it had just walked. Hex, char codes and split-and-concatenated literals
 * all fail the same way — an encoding is not a redaction.
 *
 * The needle is therefore derived from the RUNNING MACHINE and exists only in
 * memory. Precedence:
 *   1. `HYGIENE_LOCAL_USERNAME` — an explicit override, so CI can inject the
 *      name from a repository secret without it ever entering the tree.
 *   2. the basename of the home directory (what actually appears in leaked
 *      absolute paths).
 *   3. the OS user record.
 *
 * ⚠️ The derived value is NEVER echoed — not into a violation message, not into
 * the success line, not into a warning. This repo is public, so CI logs are
 * public; a gate that printed the needle would republish what it just removed.
 */
const LOCAL_USERNAME_ENV = "HYGIENE_LOCAL_USERNAME";

/**
 * A bare substring search for a short or generic name is worse than no rule:
 * it fails a clean tree. MEASURED on this repo (2026-08-26): the GitHub Actions
 * account name — `os.userInfo().username` under `/home/runner` — occurs 2800
 * times across 507 tracked files. Deriving the needle naively would therefore
 * turn `frontend-lint` permanently red on a tree with zero real leakage.
 *
 * So Rule 1 runs only against a name that could plausibly identify a person.
 * When it cannot, the rule is DISABLED AND SAID SO OUT LOUD (see `main`) rather
 * than silently passing — the whole point of this phase is fail-safe and loud.
 * Rules 2-3 are structural and username-agnostic, so they run everywhere and
 * still catch every home-path form on any machine.
 */
const MIN_PLAUSIBLE_USERNAME_LENGTH = 6;

/**
 * Account names that are non-personal ON ANY MACHINE AND IN ANY REPO — build,
 * CI, container and role accounts. All are >= the length floor above (shorter
 * generics such as `root`, `node`, `ci`, `user` and `app` are already excluded
 * by that floor, so listing them here would be redundant).
 *
 * This list is checked BEFORE a single file is read, and it is not made
 * redundant by the corroboration gate that follows it — the two answer
 * different questions. Corroboration can only measure THIS tree; a name absent
 * from this repo's prose but obviously non-personal (`azureuser` on a fresh
 * clone) would pass corroboration's rarity test and fail a clean tree. And
 * `runner` shows the reverse: this file documents `/home/runner`, a home-shaped
 * occurrence, so corroboration alone would CONFIRM the CI account name and fire
 * 2863 times.
 *
 * `deployer`, `developer` and `workspace` were added 2026-08-26 from the
 * phase-163 review: all three are ordinary container/CI home-directory names,
 * all three cleared the length floor, and `developer` alone produced 153
 * violations across 102 files on a tree with zero real leakage.
 */
const GENERIC_ACCOUNTS = new Set([
  "administrator",
  "azureuser",
  "buildkite",
  "builder",
  "circleci",
  "codespace",
  "container",
  "deployer",
  "devcontainer",
  "developer",
  "docker",
  "ec2-user",
  "github",
  "gitlab",
  "jenkins",
  "runner",
  "runneradmin",
  "travis",
  "ubuntu",
  "vercel",
  "vscode",
  "worker",
  "workspace",
]);

/**
 * The home-directory prefixes that CORROBORATE a needle: an occurrence
 * immediately preceded by one of these is positive evidence that the word names
 * a home directory rather than being ordinary prose.
 *
 * ⛔ This is the mirror image of an allowlist and must stay that way. These
 * shapes decide whether a needle is SEARCHED AT ALL; they never decide whether
 * a particular file or occurrence is excused. The macOS forms are spelled as
 * char codes for the same self-match reason as Rules 2-3 above.
 *
 * `~` is deliberately last and deliberately bare: `~name` and `~/name` are both
 * home references, and the bare form subsumes the slash form.
 */
const HOME_SHAPES: readonly string[] = [
  HOME_PREFIX,
  SCRATCH_PREFIX,
  "/home/",
  "-home-",
  "~",
];

/**
 * The rarity half of corroboration: a needle found in MORE than this many
 * distinct tracked files, with no home-shaped occurrence anywhere, is treated
 * as an ordinary word in this codebase rather than an identity.
 *
 * Measured separation on this tree 2026-08-26 (distinct files containing the
 * word): the real local identity 0, `deployer` 1, `ubuntu` 24, `analyst` 30,
 * `developer` 102, `workspace` 113, `runner` 513. ⚠️ Those counts were taken
 * BEFORE this file named any of the words, and naming one here necessarily adds
 * this file to its count — `analyst` reads 31 as of the commit that wrote this
 * sentence. Re-measure rather than trusting the literals. Eight sits an order of
 * magnitude below the smallest endemic word measured and well above a fresh
 * leak, which lands in one or two files per commit.
 *
 * ⚠️ The residual risk this accepts, stated plainly: a bare-word leak that
 * appears in more than eight files SIMULTANEOUSLY, with no accompanying path
 * form anywhere, would disable Rule 1 instead of failing. Such a leak would
 * have been caught at the first file if the gate ran per commit, and in
 * practice the artifacts that carry a username also carry its absolute path,
 * which Rules 2-3 catch structurally and unconditionally.
 */
export const MAX_ENDEMIC_FILES = 8;

/**
 * Why Rule 1 is or is not running, and what a reader should DO about it.
 * ⚠️ Never contains the derived value itself — CI logs on a public repo are
 * public, so a status line that printed the needle would republish it.
 */
export interface UsernameRuleStatus {
  active: boolean;
  reason: string;
  /**
   * Actionable next step, printed by `main` whenever the rule did not run. This
   * exists because "rule 1 did not run" is useless on its own: the reader
   * cannot tell a deliberate stand-down from a broken gate without being told
   * which it is and whether anything needs fixing.
   */
  advice: string;
}

/**
 * One Rule 1 candidate occurrence, classified by the CONTEXT it sits in.
 * Carries a line number rather than the file's text so the corroboration pass
 * needs no second read of any file.
 */
export interface UsernameHit {
  relPath: string;
  line: number;
  /** Immediately preceded by a home-directory prefix — see `HOME_SHAPES`. */
  homeShaped: boolean;
}

/** The raw inputs to the derivation, injectable so tests need not mutate the OS. */
export interface LocalIdentitySources {
  envOverride?: string | undefined;
  homeDir?: string | undefined;
  osUsername?: string | undefined;
}

/** The real machine's inputs. Both `os` calls can throw in stripped containers. */
function defaultIdentitySources(): LocalIdentitySources {
  let home: string | undefined;
  try {
    home = homedir();
  } catch {
    home = undefined;
  }
  let osUsername: string | undefined;
  try {
    osUsername = userInfo().username;
  } catch {
    osUsername = undefined;
  }
  return {
    envOverride: process.env[LOCAL_USERNAME_ENV],
    homeDir: home,
    osUsername,
  };
}

/**
 * Resolve the Rule 1 needle from the environment. Returns `null` — plus a
 * reason the caller MUST surface — whenever no plausible personal identifier
 * is available, rather than searching for something that would false-positive.
 */
export function deriveLocalUsername(
  sources: LocalIdentitySources = defaultIdentitySources(),
): { username: string | null; status: UsernameRuleStatus } {
  const fromEnv = (sources.envOverride ?? "").trim();
  const homeBase = sources.homeDir ? basename(sources.homeDir).trim() : "";
  const fromOs = (sources.osUsername ?? "").trim();

  let candidate = "";
  let source = "";
  if (fromEnv) {
    candidate = fromEnv;
    source = `the ${LOCAL_USERNAME_ENV} override`;
  } else if (homeBase && homeBase !== "/" && homeBase !== ".") {
    candidate = homeBase;
    source = "the home-directory basename";
  } else if (fromOs) {
    candidate = fromOs;
    source = "the OS user record";
  }

  if (!candidate) {
    return {
      username: null,
      status: {
        active: false,
        reason: `no local identity could be derived from the environment (no ${LOCAL_USERNAME_ENV}, no home directory, no OS user record)`,
        advice: `If this machine has an identity worth protecting, set ${LOCAL_USERNAME_ENV} (in CI, from a repository secret — never commit it).`,
      },
    };
  }
  if (GENERIC_ACCOUNTS.has(candidate.toLowerCase())) {
    return {
      username: null,
      status: {
        active: false,
        reason: `the derived local identity is a known generic CI/build/container account, not a personal identifier — searching for it would flag thousands of ordinary occurrences`,
        advice:
          "NOTHING IS WRONG AND NOTHING NEEDS FIXING: a generic account name identifies no one, so Rule 1 has nothing to protect on this machine. Rules 2-3 ran over every file.",
      },
    };
  }
  if (candidate.length < MIN_PLAUSIBLE_USERNAME_LENGTH) {
    return {
      username: null,
      status: {
        active: false,
        reason: `the derived local identity is shorter than ${MIN_PLAUSIBLE_USERNAME_LENGTH} characters, so a bare substring search would collide with ordinary prose and identifiers`,
        advice:
          "NOTHING IS WRONG AND NOTHING NEEDS FIXING: a name this short cannot be searched as a substring without flagging ordinary words. Rules 2-3 ran over every file.",
      },
    };
  }
  return {
    username: candidate,
    status: { active: true, reason: `derived at runtime from ${source}`, advice: "" },
  };
}

/** The founder-locked redaction token — the ONLY exemption, and it is by value. */
const PLACEHOLDER = "<user>";

/** 1-based line number of a character offset, for actionable violation text. */
function lineOf(contents: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (contents[i] === "\n") line += 1;
  return line;
}

/** Every offset at which `needle` occurs in `haystack`. */
function occurrences(haystack: string, needle: string): number[] {
  const out: number[] = [];
  let i = haystack.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = haystack.indexOf(needle, i + needle.length);
  }
  return out;
}

/**
 * Scan one file's CONTENTS. Pure — takes the text, returns violation strings.
 * `relPath` is used only to label the violation; it NEVER affects whether an
 * occurrence counts (Rule 0: no path allowlist).
 *
 * `localUsername` is REQUIRED and has no default on purpose: a default would let
 * a caller silently run with Rule 1 off and never notice. `null` means the rule
 * is knowingly inactive (see `deriveLocalUsername`).
 */
export function scanFile(
  relPath: string,
  contents: string,
  localUsername: string | null,
): string[] {
  return [
    ...findUsernameHits(relPath, contents, localUsername).map(formatUsernameHit),
    ...findStructuralViolations(relPath, contents),
  ];
}

/** `HOME_SHAPES` folded once, for comparison against lower-cased contents. */
const LOWERED_HOME_SHAPES: readonly string[] = HOME_SHAPES.map((s) =>
  s.toLowerCase(),
);

/**
 * Rule 1 CANDIDATES in one file, each classified as home-shaped or bare.
 * Returns candidates rather than violations because whether they count is a
 * property of the WHOLE tree (see `corroborate`), not of this file.
 *
 * ⚠️ Offsets come from the lower-cased copy and are used against the original.
 * That alignment holds because every file is decoded `latin1`, so each char is
 * one byte in U+0000..U+00FF, and no character in that range changes length
 * when lower-cased (the length-changing cases, e.g. U+0130, cannot occur).
 */
function findUsernameHits(
  relPath: string,
  contents: string,
  localUsername: string | null,
): UsernameHit[] {
  // Skipped only when the needle could not be derived, which `main` announces
  // loudly rather than letting a reader discover it by reading this source.
  if (!localUsername) return [];
  const lowered = contents.toLowerCase();
  return occurrences(lowered, localUsername.toLowerCase()).map((idx) => ({
    relPath,
    line: lineOf(contents, idx),
    homeShaped: LOWERED_HOME_SHAPES.some(
      (shape) =>
        idx >= shape.length && lowered.startsWith(shape, idx - shape.length),
    ),
  }));
}

/** ⚠️ Never interpolates the needle — CI logs on a public repo are public. */
function formatUsernameHit(hit: UsernameHit): string {
  const where = hit.homeShaped
    ? "inside a home-directory path"
    : "in a tracked file";
  return `LOCAL-USERNAME: ${hit.relPath}:${hit.line} — the local machine username appears ${where} on a public repo. Replace it with the placeholder ${PLACEHOLDER}.`;
}

/** Rules 2-3. Structural and username-agnostic, so they run on every machine. */
function findStructuralViolations(relPath: string, contents: string): string[] {
  const violations: string[] = [];

  // Rules 2 and 3 — the two structural home-path forms, with the Rule 4 value
  // exemption applied to the text that FOLLOWS the prefix.
  const structural: Array<[string, string, string]> = [
    [
      HOME_PREFIX,
      "ABSOLUTE-HOME-PATH",
      "a local absolute home path appears in a tracked file on a public repo. Rewrite it repo-relative if it points into this repo, otherwise replace the username segment with " +
        PLACEHOLDER +
        ". To NAME the pattern in prose, spell it escaped.",
    ],
    [
      SCRATCH_PREFIX,
      "SCRATCH-HOME-PATH",
      "a dash-mangled local home path (an agent scratchpad directory name) appears in a tracked file on a public repo. Replace the username segment with " +
        PLACEHOLDER +
        ", or the whole directory name with a placeholder.",
    ],
  ];
  for (const [prefix, code, advice] of structural) {
    for (const idx of occurrences(contents, prefix)) {
      // The one exemption, and it is on the matched VALUE: a placeholder is
      // definitionally non-identifying no matter which file it sits in.
      if (contents.startsWith(PLACEHOLDER, idx + prefix.length)) continue;
      violations.push(
        `${code}: ${relPath}:${lineOf(contents, idx)} — ${advice}`,
      );
    }
  }

  return violations;
}

/**
 * Decide whether the tree CORROBORATES the needle as an identity, given every
 * Rule 1 candidate found in it. This is the answer to "would failing here be
 * crying wolf on a clean tree?", and it is the only thing standing between a
 * derived needle and 153 violations over ordinary prose.
 *
 * Corroborated when EITHER
 *   - some occurrence is home-path-shaped (the word demonstrably names a home
 *     directory in this repo), OR
 *   - the word is rare enough to be an identity rather than vocabulary.
 *
 * ⛔ Note what this does NOT do. It never exempts a file, never consults a path,
 * and is not consulted per-occurrence: the answer is one boolean for the whole
 * tree, and when it is `true` EVERY occurrence is a violation. A per-file or
 * per-path version of this function would be the allowlist this gate exists to
 * avoid.
 *
 * ⚠️ Zero hits corroborates. A clean tree must leave Rule 1 ACTIVE — otherwise
 * the rule would switch itself off exactly when it is working, and the first
 * leak after a successful scrub would land unnoticed.
 */
export function corroborate(
  hits: UsernameHit[],
):
  | { corroborated: true }
  | { corroborated: false; status: UsernameRuleStatus } {
  if (hits.some((h) => h.homeShaped)) return { corroborated: true };

  const fileCount = new Set(hits.map((h) => h.relPath)).size;
  if (fileCount <= MAX_ENDEMIC_FILES) return { corroborated: true };

  return {
    corroborated: false,
    status: {
      active: false,
      reason: `the needle occurs in ${fileCount} tracked files (more than ${MAX_ENDEMIC_FILES}) and never once inside a home-directory path, so it reads as ordinary vocabulary in this codebase rather than a local identity`,
      advice:
        "THIS IS WHAT A FALSE POSITIVE LOOKS LIKE FROM THE INSIDE, and nothing needs fixing: a word this common is prose, not leakage, and failing on it would redden a clean tree. Rules 2-3 are structural and still cover every absolute and dash-mangled home path. If you believe it IS a real leak, find the occurrences with `git grep -ai <the word>` — and note that `grep` alone is blind to files containing a NUL byte, so use `-a`.",
    },
  };
}

/**
 * Enumerate the tracked files. `git ls-files -z` is the source of truth: it is
 * exactly "what is committed and therefore public", and it needs no ignore
 * logic of its own. NUL-delimited so paths containing spaces or newlines
 * survive. `execFileSync` with an argument array — no shell, nothing to inject.
 */
export function listTrackedFiles(rootDir: string): string[] {
  const raw = execFileSync("git", ["ls-files", "-z"], {
    cwd: rootDir,
    maxBuffer: 1 << 28,
    encoding: "buffer",
  });
  return raw.toString("utf-8").split("\0").filter(Boolean);
}

/**
 * Entry point for the gate. `files` is injectable so tests can drive a fixture
 * tree; in production it is the tracked-file list. Returns both the violations
 * and the number of files actually READ — the count is what makes a vacuous run
 * visible (Rule 5).
 */
export function runCheck(
  rootDir: string,
  files: string[] = listTrackedFiles(rootDir),
  localUsername?: string | null,
): {
  violations: string[];
  filesScanned: number;
  usernameRule: UsernameRuleStatus;
} {
  // `undefined` = derive from this machine; an explicit `string | null` is an
  // injected needle (tests) or a knowingly-disabled Rule 1.
  const derived =
    localUsername === undefined
      ? deriveLocalUsername()
      : {
          username: localUsername,
          status: {
            active: localUsername !== null,
            reason:
              localUsername !== null
                ? "an explicitly supplied needle"
                : "Rule 1 was explicitly disabled by the caller",
            advice: "",
          },
        };

  const violations: string[] = [];
  const usernameHits: UsernameHit[] = [];
  let filesScanned = 0;

  // Phase 1 — one read per file. Rules 2-3 are decided here and unconditionally;
  // Rule 1's candidates are only COLLECTED, because whether they are violations
  // depends on the whole tree.
  for (const rel of files) {
    let contents: string;
    try {
      // latin1 = byte-exact 1:1 decode. A NUL neither truncates the read nor
      // hides what follows it, which a grep-based gate cannot promise.
      contents = readFileSync(resolve(rootDir, rel), "latin1");
    } catch {
      // A tracked path that cannot be read (deleted in the working tree,
      // submodule gitlink) is skipped — and deliberately NOT counted as
      // scanned, so it cannot inflate the anti-vacuity count.
      continue;
    }
    filesScanned += 1;
    violations.push(...findStructuralViolations(rel, contents));
    usernameHits.push(...findUsernameHits(rel, contents, derived.username));
  }

  // Phase 2 — corroborate the needle, then emit (or stand down from) Rule 1.
  let usernameRule = derived.status;
  if (derived.username !== null) {
    const corroboration = corroborate(usernameHits);
    if (corroboration.corroborated) {
      // Home-shaped hits first: on a tree that has both, the path form is the
      // real leak and the bare hits are its fallout, so burying the former
      // under the latter would hide the line the reader needs.
      const ordered = [
        ...usernameHits.filter((h) => h.homeShaped),
        ...usernameHits.filter((h) => !h.homeShaped),
      ];
      violations.push(...ordered.map(formatUsernameHit));
    } else {
      usernameRule = corroboration.status;
    }
  }

  if (filesScanned === 0) {
    violations.push(
      "EMPTY-SCAN: zero files were scanned. A gate that walks nothing reports OK forever — this is a failure, not a pass. Check that the scan is running from the repository root and that `git ls-files` returns the tracked set.",
    );
  }

  return { violations, filesScanned, usernameRule };
}

function main(): void {
  const { violations, filesScanned, usernameRule } = runCheck(REPO_ROOT);

  // Loud BEFORE the verdict: a rule that did not run must never be discoverable
  // only by reading the source (Phase 163 WR-01 — the success line must not
  // claim more than the scan actually checked).
  if (!usernameRule.active) {
    // ⚠️ The advice is per-reason and NOT boilerplate. It used to be a fixed
    // "set HYGIENE_LOCAL_USERNAME" line, which is actively misleading for a
    // stand-down that the override itself triggered: telling someone to set the
    // variable that just disabled the rule sends them in a circle.
    console.warn(
      `[check-planning-hygiene] ⚠️ LOCAL-USERNAME (rule 1) DID NOT RUN — ${usernameRule.reason}.\n` +
        `  Rules 2-3 (absolute and dash-mangled home paths) are structural and ran over every file.\n` +
        `  ${usernameRule.advice}`,
    );
  }

  if (violations.length > 0) {
    console.error(`[check-planning-hygiene] ${violations.length} violation(s):\n`);
    // Print a bounded sample so one badly-leaking file cannot bury the rest.
    for (const v of violations.slice(0, 50)) console.error(`  - ${v}`);
    if (violations.length > 50) {
      console.error(`  … and ${violations.length - 50} more.`);
    }
    console.error(
      "\nThe repo is public and .planning/ is tracked — every committed byte is world-readable.\nPhase: 163 SEC-02 (no-allowlist local-identity scan).",
    );
    process.exit(1);
  }

  // The claim is scoped to what actually ran. Saying "none carry the local
  // username" after Rule 1 was skipped is exactly the false success line WR-01
  // filed, so the username clause appears only when the username was searched.
  console.log(
    usernameRule.active
      ? `[check-planning-hygiene] OK — ${filesScanned} tracked files scanned, none carry the local username or an absolute home path (rule 1 needle: ${usernameRule.reason}).`
      : `[check-planning-hygiene] OK — ${filesScanned} tracked files scanned, none carry an absolute home path. LOCAL-USERNAME (rule 1) was NOT checked; see the warning above.`,
  );
}

// Only run the CLI when invoked directly (not when imported by tests).
//
// ⚠️ The `?? ""` fallback this replaced was always-true: EVERY string ends with
// the empty string, so `argv[1] === undefined` made the guard fire on a plain
// import and run `main()` — including its `process.exit(1)` path — inside
// whatever imported it (Phase 163 IN-03). Both the undefined and the
// empty-string cases are now rejected before `endsWith` is reached.
const entryPath = process.argv[1];
if (entryPath !== undefined && entryPath.length > 0) {
  // `pathToFileURL` is the exact comparison (it handles Windows drive letters,
  // spaces and percent-encoding that a hand-built `file://` prefix does not).
  // The `endsWith` arm stays for loaders that hand `import.meta.url` a
  // specifier that is not byte-identical to the resolved entry path.
  if (
    import.meta.url === pathToFileURL(entryPath).href ||
    import.meta.url.endsWith(entryPath)
  ) {
    main();
  }
}
