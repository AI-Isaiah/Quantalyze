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
 * Generic build/CI/container account names, all of them >= the length floor
 * above (shorter generics such as `root`, `node`, `ci`, `user` and `app` are
 * already excluded by that floor, so listing them here would be redundant).
 */
const GENERIC_ACCOUNTS = new Set([
  "administrator",
  "azureuser",
  "buildkite",
  "builder",
  "circleci",
  "codespace",
  "container",
  "devcontainer",
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
]);

/** Why Rule 1 is or is not running. Never contains the derived value itself. */
export interface UsernameRuleStatus {
  active: boolean;
  reason: string;
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
      },
    };
  }
  if (GENERIC_ACCOUNTS.has(candidate.toLowerCase())) {
    return {
      username: null,
      status: {
        active: false,
        reason: `the derived local identity is a known generic CI/build/container account, not a personal identifier — searching for it would flag thousands of ordinary occurrences`,
      },
    };
  }
  if (candidate.length < MIN_PLAUSIBLE_USERNAME_LENGTH) {
    return {
      username: null,
      status: {
        active: false,
        reason: `the derived local identity is shorter than ${MIN_PLAUSIBLE_USERNAME_LENGTH} characters, so a bare substring search would collide with ordinary prose and identifiers`,
      },
    };
  }
  return {
    username: candidate,
    status: { active: true, reason: `derived at runtime from ${source}` },
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
  const violations: string[] = [];

  // Rule 1 — the username itself, case-insensitively. Skipped only when the
  // needle could not be derived, which `main` announces loudly.
  if (localUsername) {
    const lowered = contents.toLowerCase();
    for (const idx of occurrences(lowered, localUsername.toLowerCase())) {
      violations.push(
        // ⚠️ Never interpolate the needle here — CI logs on a public repo are public.
        `LOCAL-USERNAME: ${relPath}:${lineOf(contents, idx)} — the local machine username appears in a tracked file on a public repo. Replace it with the placeholder ${PLACEHOLDER}.`,
      );
    }
  }

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
          },
        };

  const violations: string[] = [];
  let filesScanned = 0;

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
    violations.push(...scanFile(rel, contents, derived.username));
  }

  if (filesScanned === 0) {
    violations.push(
      "EMPTY-SCAN: zero files were scanned. A gate that walks nothing reports OK forever — this is a failure, not a pass. Check that the scan is running from the repository root and that `git ls-files` returns the tracked set.",
    );
  }

  return { violations, filesScanned, usernameRule: derived.status };
}

function main(): void {
  const { violations, filesScanned, usernameRule } = runCheck(REPO_ROOT);

  // Loud BEFORE the verdict: a rule that did not run must never be discoverable
  // only by reading the source (Phase 163 WR-01 — the success line must not
  // claim more than the scan actually checked).
  if (!usernameRule.active) {
    console.warn(
      `[check-planning-hygiene] ⚠️ LOCAL-USERNAME (rule 1) DID NOT RUN — ${usernameRule.reason}.\n` +
        `  Rules 2-3 (absolute and dash-mangled home paths) are structural and ran over every file.\n` +
        `  To enable rule 1 here, set ${LOCAL_USERNAME_ENV} (in CI, from a repository secret — never commit it).`,
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
