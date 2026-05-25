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
import { spawnSync } from "node:child_process";
import {
  readFileSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = process.cwd();
const GITLEAKS_TOML = join(REPO_ROOT, ".gitleaks.toml");

/**
 * H-0017: is the `gitleaks` binary available in this environment? The
 * integration test below runs the REAL scanner — but contributors and
 * some CI lanes may not have it installed. Probe once; skip-gate the
 * integration `it` blocks on the result so the parser-shape tests above
 * still run everywhere and the integration arm degrades gracefully
 * (skipped, with an advertised reason) rather than failing on a missing
 * binary.
 */
function gitleaksAvailable(): boolean {
  const probe = spawnSync("gitleaks", ["version"], { encoding: "utf8" });
  return probe.status === 0;
}
const HAS_GITLEAKS = gitleaksAvailable();

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

  // M-0012 — `allowlistCovers` silently `continue`s past a malformed regex
  // (try/catch). On its own that's fine ONLY because the "every pattern is
  // valid" test above guarantees no malformed pattern survives. But the two
  // checks are decoupled: if the validity test were ever weakened, the
  // coverage check's silent skip would let a malformed pattern sit in the
  // production .gitleaks.toml unnoticed (covered-by-another-pattern fixtures
  // would still report covered). This case pins the LINKAGE: the number of
  // compilable patterns must EQUAL the total pattern count, so the
  // silent-continue branch in allowlistCovers is provably never taken for the
  // real config. A single malformed entry fails HERE even if a sibling valid
  // pattern would otherwise mask it in the coverage check.
  it("M-0012: no allowlist pattern is silently skipped as malformed during coverage evaluation", () => {
    const patterns = parseAllowlistPaths(readGitleaksConfig());
    expect(patterns.length).toBeGreaterThan(0);
    const compilable = patterns.filter((pat) => {
      try {
        new RegExp(pat);
        return true;
      } catch {
        return false;
      }
    });
    // Every pattern must compile — otherwise allowlistCovers would silently
    // skip it, and the "covered" verdict for some fixture could rest on a
    // DIFFERENT pattern while the malformed one rots in the config.
    expect(compilable.length).toBe(patterns.length);
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

/**
 * H-0017 — REAL gitleaks invocation (semantic allowlist correctness).
 *
 * The parser-shape tests above only prove the allowlist regexes are
 * syntactically valid and that they `.test()`-match the fixture paths
 * in JS. They do NOT prove the SCANNER behaves the way the config
 * intends — a regex can be syntactically valid yet semantically wrong
 * (too broad → suppresses real secrets; too narrow → red-lights a
 * fixture). This block runs the actual `gitleaks` binary against a
 * synthetic source tree, applying the repo's real `.gitleaks.toml`, and
 * pins TWO behaviors:
 *
 *   1. A secret-shaped string at an ALLOWLISTED path is SUPPRESSED.
 *   2. The SAME string at a NON-allowlisted path is DETECTED.
 *
 * (2) is the load-bearing half: it proves the allowlist isn't a blanket
 * "ignore everything" that would let real secrets through — a failure
 * mode the string-parser tests are structurally blind to.
 *
 * Skip-gated on the binary being present (HAS_GITLEAKS) so creds-less /
 * binary-less environments degrade to "skipped + advertised" rather
 * than a false failure. The real CI gate is the gitleaks-action step in
 * .github/workflows/ci.yml; this test brings that surface into the
 * local fix loop when the binary is available.
 */
describe(".gitleaks.toml — real scanner behavior (H-0017)", () => {
  // A canonical jwt.io tutorial JWT — trips the default `jwt` rule. Not
  // a real token (same fixture the allowlist comment documents).
  const JWT_FIXTURE =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  type GitleaksFinding = { RuleID: string; File: string; Secret: string };

  /**
   * Run `gitleaks detect --no-git` over `sourceDir` with the repo's real
   * config, parsing the JSON report. Returns the findings array (empty
   * = clean). `--no-git` scans the raw files (no commit history needed),
   * which is what we want for a synthetic tree.
   */
  function runGitleaks(sourceDir: string): GitleaksFinding[] {
    const result = spawnSync(
      "gitleaks",
      [
        "detect",
        "--no-git",
        "--source",
        sourceDir,
        "--config",
        GITLEAKS_TOML,
        "--report-format",
        "json",
        "--report-path",
        "-",
        "--no-banner",
        // Non-zero exit on findings is gitleaks' default; we read the
        // JSON report directly and don't branch on exit code, but set an
        // explicit code so a future default change can't surprise us.
        "--exit-code",
        "7",
      ],
      { encoding: "utf8" },
    );
    const stdout = result.stdout?.trim() ?? "";
    if (stdout === "" || stdout === "[]") return [];
    try {
      return JSON.parse(stdout) as GitleaksFinding[];
    } catch {
      // If the report isn't JSON, surface the raw output so the failure
      // is debuggable rather than a silent empty array.
      throw new Error(
        `gitleaks did not emit JSON. stdout=${stdout} stderr=${result.stderr}`,
      );
    }
  }

  it.skipIf(!HAS_GITLEAKS)(
    "suppresses a JWT at an allowlisted path (.env.example) AND detects the SAME JWT at a non-allowlisted path",
    () => {
      const scratch = mkdtempSync(join(tmpdir(), "gitleaks-real-"));
      // Allowlisted: .env.example matches `(^|/)\.env\.example$`.
      writeFileSync(join(scratch, ".env.example"), `JWT=${JWT_FIXTURE}\n`);
      // NOT allowlisted: a plain source file under src/lib. No allowlist
      // path matches `src/lib/leaky.ts`, so the JWT here MUST be caught.
      mkdirSync(join(scratch, "src", "lib"), { recursive: true });
      writeFileSync(
        join(scratch, "src", "lib", "leaky.ts"),
        `const token = "${JWT_FIXTURE}";\n`,
      );

      const findings = runGitleaks(scratch);

      // The non-allowlisted file MUST be flagged — proves the allowlist
      // is NOT a blanket suppressor and the scanner is actually running.
      const leakyHits = findings.filter((f) => f.File.endsWith("leaky.ts"));
      expect(leakyHits.length).toBeGreaterThan(0);
      expect(leakyHits[0].RuleID).toBe("jwt");

      // The allowlisted file MUST NOT be flagged — proves the allowlist
      // path regex actually suppresses the finding in the real scanner,
      // not just in a JS `.test()`.
      const envHits = findings.filter((f) =>
        f.File.endsWith(".env.example"),
      );
      expect(envHits).toEqual([]);
    },
    60_000,
  );

  it.skipIf(HAS_GITLEAKS)(
    "advertises skip reason when the gitleaks binary is unavailable",
    () => {
      console.warn(
        "[gitleaks-allowlist] skipping real-scanner integration arm — " +
          "`gitleaks` binary not found on PATH. The gitleaks-action step " +
          "in .github/workflows/ci.yml is the authoritative gate.",
      );
      expect(HAS_GITLEAKS).toBe(false);
    },
  );
});
