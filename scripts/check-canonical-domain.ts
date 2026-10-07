#!/usr/bin/env -S npx tsx
/**
 * CI hook - fail if a git-tracked file mentions the domain this product does
 * not own. Phase 164.6.6.3.5 (DOMAINONE), decision D-10.
 *
 * The product's one canonical address is its Vercel host. The retiring `.com`
 * domain belongs to a third party, so every mention in tracked source points
 * users, mail or a link preview at someone else. D-10: fail on any new
 * occurrence outside `.planning/` and the root `CHANGELOG.md` (both record
 * history, and a record of what a domain used to be is not a link to it),
 * plus a small, named, COUNT-PINNED allowlist of lineage lines.
 *
 * Modelled on `check-planning-hygiene.ts`, and for the same reasons:
 *   - Every tracked file is read as `latin1`, a byte-exact 1:1 decode. A NUL
 *     byte neither truncates the read nor hides what follows it, and a binary
 *     file is scanned like any other. `git grep` returns nothing for the
 *     link annotation inside `public/security-packet.pdf`; this gate sees it.
 *   - Zero files scanned is a FAILURE (EMPTY-SCAN). A gate that walks nothing
 *     reports OK forever.
 *   - The allowlist is pinned to an occurrence COUNT per file, and a count that
 *     moves in either direction is a violation. A pin that only catches growth
 *     lets a lineage assertion be deleted without anyone noticing, and a pin
 *     that only catches shrinkage lets a new mention hide behind an old one.
 *   - The needle is assembled from parts so this file never matches itself.
 *
 * Fixing a violation: replace the domain with the canonical address, with the
 * reserved `example.com` in a fixture, or remove the sentence. Do not widen
 * `ALLOWLIST`; it names the two lineage assertions D-10 gives as its example
 * and nothing else.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

/** The retiring domain, spelled from parts so this source cannot match itself. */
const NEEDLE_PARTS = ["quantalyze", "com"] as const;
const NEEDLE_SOURCE = NEEDLE_PARTS.join("\\.");

/**
 * Anchored by path, never by substring: `docs/CHANGELOG.md` and
 * `x.planning/y.md` are NOT excluded.
 */
export const EXCLUDED_PREFIXES: readonly string[] = [".planning/"];
export const EXCLUDED_FILES: readonly string[] = ["CHANGELOG.md"];

export interface AllowlistEntry {
  file: string;
  occurrences: number;
  reason: string;
}

/**
 * D-10's named lineage lines: the analytics tests that assert the `$host`
 * property is never the retiring domain (M-0487). They have to NAME the domain
 * to assert its absence. Counts were measured at HEAD with a case-insensitive
 * byte-exact scan.
 */
export const ALLOWLIST: readonly AllowlistEntry[] = [
  {
    file: "src/lib/analytics.test.ts",
    occurrences: 3,
    reason:
      "M-0487 lineage: asserts the analytics `$host` is never the retiring domain (D-10 named allowlist)",
  },
  {
    file: "src/lib/analytics/usage-events.test.ts",
    occurrences: 2,
    reason:
      "M-0487 lineage: asserts the usage-event `$host` is never the retiring domain (D-10 named allowlist)",
  },
];

/**
 * Enumerate the tracked files. `git ls-files -z` is exactly "what is committed
 * and therefore public". `execFileSync` with an argument array: no shell.
 */
export function listTrackedFiles(rootDir: string): string[] {
  const raw = execFileSync("git", ["ls-files", "-z"], {
    cwd: rootDir,
    maxBuffer: 1 << 28,
    encoding: "buffer",
  });
  return raw.toString("utf-8").split("\0").filter(Boolean);
}

function isExcluded(rel: string): boolean {
  return (
    EXCLUDED_FILES.includes(rel) ||
    EXCLUDED_PREFIXES.some((prefix) => rel.startsWith(prefix))
  );
}

function countOccurrences(contents: string): number {
  return contents.match(new RegExp(NEEDLE_SOURCE, "gi"))?.length ?? 0;
}

/**
 * Entry point for the gate. `files` is injectable so tests can drive a scratch
 * tree. Returns the violations and the number of files actually READ, which is
 * what makes a vacuous run visible.
 */
export function runCheck(
  rootDir: string,
  files: string[] = listTrackedFiles(rootDir),
): { violations: string[]; filesScanned: number } {
  const violations: string[] = [];
  const pins = new Map(ALLOWLIST.map((e) => [e.file, e]));
  let filesScanned = 0;

  for (const rel of files) {
    if (isExcluded(rel)) continue;
    let contents: string;
    try {
      // latin1 = byte-exact 1:1 decode, binary files included.
      contents = readFileSync(resolve(rootDir, rel), "latin1");
    } catch {
      // A tracked path that cannot be read (deleted in the working tree,
      // submodule gitlink) is skipped and deliberately NOT counted as scanned,
      // so it cannot inflate the anti-vacuity count.
      continue;
    }
    filesScanned += 1;
    const n = countOccurrences(contents);
    const pin = pins.get(rel);
    if (pin !== undefined) {
      if (n !== pin.occurrences) {
        violations.push(
          `${rel}: ${n} occurrence(s), but the allowlist pins exactly ${pin.occurrences} (${pin.reason}). A count that moves in either direction is a violation; update the pin only with the lineage assertion it covers.`,
        );
      }
      continue;
    }
    if (n > 0) violations.push(`${rel}: ${n} occurrence(s)`);
  }

  if (filesScanned === 0) {
    violations.push(
      "EMPTY-SCAN: zero files were scanned. A gate that walks nothing reports OK forever; this is a failure, not a pass. Check that the scan runs from the repository root and that `git ls-files` returns the tracked set.",
    );
  }

  return { violations, filesScanned };
}

function main(): void {
  const { violations, filesScanned } = runCheck(REPO_ROOT);

  if (violations.length > 0) {
    console.error(
      `[check-canonical-domain] ${violations.length} violation(s) across ${filesScanned} tracked files scanned:\n`,
    );
    for (const v of violations) console.error(`  ${v}`);
    console.error(
      "\nThe retiring domain is not ours. Phase 164.6.6.3.5 D-10: use the canonical address, or `example.com` in a fixture.",
    );
    process.exit(1);
  }

  console.log(
    `[check-canonical-domain] OK - ${filesScanned} tracked files scanned, none mention the retiring domain outside the pinned allowlist.`,
  );
}

// Only run the CLI when invoked directly (not when imported by tests). Both the
// undefined and the empty-string argv are rejected before `endsWith` is
// reached: every string ends with the empty string.
const entryPath = process.argv[1];
if (entryPath !== undefined && entryPath.length > 0) {
  if (
    import.meta.url === pathToFileURL(entryPath).href ||
    import.meta.url.endsWith(entryPath)
  ) {
    main();
  }
}
