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
 *   1. LOCAL-USERNAME — the macOS username appears in a tracked file (matched
 *      case-insensitively). The needle is stored BASE64-ENCODED and decoded at
 *      runtime: a scanner whose source spells its own needle fails its own scan,
 *      and the only way out of that would be the one thing Rule 0 forbids, a
 *      path allowlist for this file.
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
 *   - Self-match. See Rules 1-3 — encoded needle, escaped prose.
 *
 * Demonstrated RED (Phase 163 plan 03, recorded in 163-03-SUMMARY.md): with the
 * scrub landed and `npm run lint` green, a scratch tracked file
 * (`.planning/red-demo-scratch.md`) containing one raw structural occurrence was
 * added with `git add -N`; `npm run lint` exited 1 with
 * `ABSOLUTE-HOME-PATH: .planning/red-demo-scratch.md:1`. Deleting the scratch
 * file returned lint to green. The mutation is: introduce one unescaped home-path
 * prefix into any tracked file; the direction is green → exit 1.
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
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

/**
 * The needles, never spelled literally in this source (see Rules 1-3).
 * `USERNAME` is base64; the two path prefixes are char codes. Decoding at
 * runtime is what lets this file pass its own scan without a path carve-out.
 */
const USERNAME = Buffer.from("aGVsaW9zLW1hbW11dA==", "base64").toString();
const HOME_PREFIX = String.fromCharCode(47, 85, 115, 101, 114, 115, 47);
const SCRATCH_PREFIX = String.fromCharCode(45, 85, 115, 101, 114, 115, 45);

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
 */
export function scanFile(relPath: string, contents: string): string[] {
  const violations: string[] = [];

  // Rule 1 — the username itself, case-insensitively.
  const lowered = contents.toLowerCase();
  for (const idx of occurrences(lowered, USERNAME.toLowerCase())) {
    violations.push(
      `LOCAL-USERNAME: ${relPath}:${lineOf(contents, idx)} — the macOS username appears in a tracked file on a public repo. Replace it with the placeholder ${PLACEHOLDER}.`,
    );
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
): { violations: string[]; filesScanned: number } {
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
    violations.push(...scanFile(rel, contents));
  }

  if (filesScanned === 0) {
    violations.push(
      "EMPTY-SCAN: zero files were scanned. A gate that walks nothing reports OK forever — this is a failure, not a pass. Check that the scan is running from the repository root and that `git ls-files` returns the tracked set.",
    );
  }

  return { violations, filesScanned };
}

function main(): void {
  const { violations, filesScanned } = runCheck(REPO_ROOT);

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

  console.log(
    `[check-planning-hygiene] OK — ${filesScanned} tracked files scanned, none carry the local username or an absolute home path.`,
  );
}

// Only run the CLI when invoked directly (not when imported by tests).
if (
  import.meta.url === `file://${process.argv[1]}` ||
  import.meta.url.endsWith(process.argv[1] ?? "")
) {
  main();
}
