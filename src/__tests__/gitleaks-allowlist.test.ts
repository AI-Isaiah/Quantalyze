/**
 * `.gitleaks.toml` allowlist-shape regression test.
 *
 * Sprint 6 closeout Task 7.6 — CI secret scanning. The plan's
 * Verification §5 third case is: "Test fixture with intentional fake
 * secret in .gitleaks.toml allowlist → CI passes."
 *
 * A full end-to-end dry-run of gitleaks against the current tree
 * requires the `gitleaks` binary in the test environment, which we
 * can't guarantee on every contributor's machine. Instead, this test
 * asserts the shape of the allowlist (which is the load-bearing
 * regression surface): every documented intentional fixture has a
 * corresponding path entry, and the patterns actually match the files
 * they claim to protect.
 *
 * What this test catches
 * ----------------------
 * A future PR that either:
 *   - Removes an allowlist entry whose fixture still exists (turning
 *     the fixture into a secret-scan false-positive that red-lights
 *     every subsequent PR).
 *   - Renames a fixture file without updating the allowlist regex
 *     (same outcome).
 *
 * What this test does NOT cover
 * -----------------------------
 * Whether a real secret slips past gitleaks — that is gitleaks' own
 * responsibility, exercised by the `gitleaks-action@v2` step in CI
 * (`.github/workflows/ci.yml`). The runtime behavior is verified by
 * the CI itself; this test guards the config that CI reads.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const GITLEAKS_TOML = join(REPO_ROOT, ".gitleaks.toml");

// Fixtures that the allowlist must protect — each is a file that has
// an intentional key-shaped string the scanner would otherwise flag.
// Pair the fixture path with a label so assertion failures point at
// the right entry.
const EXPECTED_ALLOWLIST_FIXTURES: Array<{
  label: string;
  relPath: string;
}> = [
  {
    label: "dotenv placeholder sample",
    relPath: ".env.example",
  },
  {
    label: "pii-scrub unit-test JWT fixture",
    relPath: "src/lib/admin/pii-scrub.test.ts",
  },
  {
    label: "Python encryption-service test fixtures",
    relPath: "analytics-service/tests/test_encryption.py",
  },
  {
    label: "package-lock integrity hashes (high-entropy noise)",
    relPath: "package-lock.json",
  },
];

function readGitleaksConfig(): string {
  if (!existsSync(GITLEAKS_TOML)) {
    throw new Error(".gitleaks.toml missing at repo root");
  }
  return readFileSync(GITLEAKS_TOML, "utf8");
}

/**
 * Extract the list of path patterns from the `[allowlist]` block.
 * The toml shape is:
 *   [allowlist]
 *   ...
 *   paths = [
 *     '''pattern1''',
 *     '''pattern2''',
 *     ...
 *   ]
 *
 * We grab the array body between `paths = [` and the closing `]`, then
 * peel out every triple-quoted string.
 */
function parseAllowlistPaths(toml: string): string[] {
  const arrMatch = toml.match(/paths\s*=\s*\[([\s\S]*?)\]/);
  if (!arrMatch) return [];
  const body = arrMatch[1];
  const patterns: string[] = [];
  const tripleQuoteRe = /'''([\s\S]*?)'''/g;
  let m: RegExpExecArray | null;
  while ((m = tripleQuoteRe.exec(body)) !== null) {
    patterns.push(m[1]);
  }
  return patterns;
}

/**
 * Test whether a compiled RegExp matches the expected fixture path. We
 * tolerate both absolute (repo-root) and relative forms because
 * gitleaks runs against paths as reported by git-diff, which are
 * typically repo-root-relative with no leading slash.
 */
function allowlistCovers(
  patterns: string[],
  relPath: string,
): { covered: boolean; matchingPattern: string | null } {
  for (const pat of patterns) {
    try {
      const rx = new RegExp(pat);
      if (rx.test(relPath)) {
        return { covered: true, matchingPattern: pat };
      }
    } catch {
      // Malformed pattern — skip and report below.
      continue;
    }
  }
  return { covered: false, matchingPattern: null };
}

describe(".gitleaks.toml allowlist", () => {
  it("exists at repo root", () => {
    expect(existsSync(GITLEAKS_TOML)).toBe(true);
  });

  it("extends the default gitleaks ruleset (defense-in-depth over built-in rules)", () => {
    const toml = readGitleaksConfig();
    expect(toml).toContain("[extend]");
    expect(toml).toMatch(/useDefault\s*=\s*true/);
  });

  it("has at least one path pattern in the allowlist", () => {
    const patterns = parseAllowlistPaths(readGitleaksConfig());
    expect(patterns.length).toBeGreaterThan(0);
  });

  it("every allowlist path pattern is a syntactically valid regex", () => {
    const patterns = parseAllowlistPaths(readGitleaksConfig());
    const malformed: string[] = [];
    for (const pat of patterns) {
      try {
        new RegExp(pat);
      } catch (err) {
        malformed.push(
          `${pat} -> ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    expect(malformed).toEqual([]);
  });

  for (const fixture of EXPECTED_ALLOWLIST_FIXTURES) {
    it(`allowlists ${fixture.label} at ${fixture.relPath}`, () => {
      const patterns = parseAllowlistPaths(readGitleaksConfig());
      const match = allowlistCovers(patterns, fixture.relPath);
      if (!match.covered) {
        throw new Error(
          `No allowlist pattern in .gitleaks.toml matches "${fixture.relPath}" ` +
            `(fixture: ${fixture.label}). ` +
            `Patterns tried: ${patterns.join(" | ")}. ` +
            `If this fixture was renamed, update the regex to match the new path. ` +
            `If it no longer exists, remove the allowlist entry to avoid stale config drift.`,
        );
      }
      expect(match.covered).toBe(true);
      expect(match.matchingPattern).not.toBeNull();
    });

    // Fixture existence check — if we allowlist a path but the file
    // is gone, that's stale config. Not fatal at runtime (gitleaks
    // just sees nothing), but a code-smell worth surfacing.
    it(`fixture file ${fixture.relPath} exists on disk`, () => {
      expect(existsSync(join(REPO_ROOT, fixture.relPath))).toBe(true);
    });
  }
});
