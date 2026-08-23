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
 * responsibility, exercised by the `gitleaks-action@v3.0.0` step in CI
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
    label: "Cluster-19 portfolio router test noop-limiter shim (batch a4)",
    relPath: "analytics-service/tests/test_c19_portfolio_fixes.py",
  },
  {
    label: "package-lock integrity hashes (high-entropy noise)",
    relPath: "package-lock.json",
  },
  {
    label: "gitleaks-allowlist meta-test JWT fixture (H-0017)",
    relPath: "src/__tests__/gitleaks-allowlist.test.ts",
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

/**
 * The CI scanner must be new enough to READ this config.
 *
 * PR #705 root cause. `gitleaks-action` resolves its scanner as
 * `process.env.GITLEAKS_VERSION || "8.24.3"`, and **gitleaks 8.24.3
 * silently ignores the top-level `[[allowlists]]` array-of-tables form**
 * that this repo's `.gitleaks.toml` uses (converted to array form by
 * 158-REVIEW CR-03). There is no parse error and no warning — the
 * allowlist is simply dropped and the scan proceeds on default rules.
 *
 * The failure mode is therefore invisible from the config side: the file
 * looks correct, `gitleaks-allowlist.test.ts` passes, a modern local
 * gitleaks reports "no leaks found", and CI red-lights PRs over fixtures
 * this file has exempted since the v1.12 CI-green commit.
 *
 * Measured on PR #705 (same config, same commit range):
 *   8.24.3 + [[allowlists]]  -> leaks found: 2   (== what CI reported)
 *   8.24.3 + [allowlist]     -> no leaks found
 *   8.30.1 + [[allowlists]]  -> no leaks found
 *
 * So the pin is load-bearing, not hygiene: drop it and every allowlist
 * entry in this repo stops working, silently. This test fails if someone
 * removes `GITLEAKS_VERSION` from ci.yml, downgrades it to a version that
 * predates array-form support, while `.gitleaks.toml` still uses that form.
 */
describe("CI scanner version can read this config's allowlist form", () => {
  // MEASURED, not assumed. gitleaks' ViperConfig gained the top-level
  // `Allowlists []*viperGlobalAllowlist` field in 8.25.0; 8.24.3 has only the
  // singular `Allowlist`, so a top-level `[[allowlists]]` has nothing to bind
  // to and is dropped without a parse error. Confirmed against both binaries
  // over this repo's own config, and 8.24.3 is the last 8.24.x release — so
  // this is the true release boundary, not an untested interval:
  //   8.24.3 + [[allowlists]] -> leaks found   (allowlist dropped)
  //   8.25.0 + [[allowlists]] -> no leaks      (allowlist honored)
  const MIN_ARRAY_FORM_VERSION = [8, 25, 0] as const;
  const CI_YML = join(REPO_ROOT, ".github", "workflows", "ci.yml");

  /**
   * Slice out ONLY the `gitleaks/gitleaks-action` step's own YAML block.
   *
   * Scoping matters more than it looks. A whole-file search for the pin stays
   * GREEN under two mutations that both re-break the gate: moving the env line
   * to a different job (where the gitleaks step would not inherit it), and
   * deleting the gitleaks step outright. A guard that survives deletion of the
   * thing it guards is not a guard. Returns null when the step is absent, which
   * the assertions below treat as failure.
   *
   * Done by indentation rather than a YAML parser deliberately: `yaml` is a
   * transitive dependency here, not a declared one, and knip gates undeclared
   * imports in CI.
   */
  function gitleaksStepBlock(ci: string): string | null {
    const lines = ci.split("\n");
    const start = lines.findIndex((l) =>
      /^\s*-\s+uses:\s*gitleaks\/gitleaks-action@/.test(l),
    );
    if (start === -1) return null;
    const stepIndent = /^(\s*)/.exec(lines[start])![1].length;
    const block = [lines[start]];
    for (let i = start + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") continue;
      // Dedent to the step's own level or shallower = next step, or out of
      // this job entirely. Either way the step's block has ended.
      if (/^(\s*)/.exec(line)![1].length <= stepIndent) break;
      block.push(line);
    }
    return block.join("\n");
  }

  function parseVersion(v: string): [number, number, number] {
    const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v.trim());
    if (!m) throw new Error(`unparseable gitleaks version: ${JSON.stringify(v)}`);
    return [Number(m[1]), Number(m[2]), Number(m[3])];
  }

  function gte(a: readonly number[], b: readonly number[]): boolean {
    for (let i = 0; i < 3; i++) {
      if (a[i] !== b[i]) return a[i] > b[i];
    }
    return true;
  }

  it("pins GITLEAKS_VERSION on the gitleaks step whenever .gitleaks.toml uses [[allowlists]]", () => {
    const toml = readFileSync(GITLEAKS_TOML, "utf8");
    const usesArrayForm = /^\s*\[\[allowlists\]\]/m.test(toml);

    // Pin the premise. If the config is ever migrated to the singular
    // [allowlist] form this test must be UPDATED, not silently pass vacuously.
    expect(
      usesArrayForm,
      "Expected .gitleaks.toml to use [[allowlists]]. If it was migrated to " +
        "the singular [allowlist] form, update this test — do not delete it.",
    ).toBe(true);

    expect(existsSync(CI_YML), `${CI_YML} must exist`).toBe(true);
    const block = gitleaksStepBlock(readFileSync(CI_YML, "utf8"));

    expect(
      block,
      "No `uses: gitleaks/gitleaks-action@...` step found in ci.yml. If the " +
        "secret-scan gate was intentionally removed, delete this test with it; " +
        "otherwise the gate is gone and nothing is scanning for secrets.",
    ).not.toBeNull();

    // Trailing comments after the value are legal YAML and must not read as
    // "no pin found" — that would send the next reader after a phantom deletion.
    const pin = /^\s*GITLEAKS_VERSION:\s*["']?([0-9]+\.[0-9]+\.[0-9]+)["']?\s*(?:#.*)?$/m.exec(
      block!,
    );
    expect(
      pin,
      "The gitleaks step does not pin GITLEAKS_VERSION. gitleaks-action " +
        "defaults to 8.24.3, which SILENTLY ignores [[allowlists]] — every " +
        "allowlist entry in .gitleaks.toml would stop working, with no error. " +
        "A pin elsewhere in ci.yml does NOT count: the step only inherits env " +
        "from its own job. See PR #705.",
    ).not.toBeNull();

    const pinned = parseVersion(pin![1]);
    expect(
      gte(pinned, MIN_ARRAY_FORM_VERSION),
      `The gitleaks step pins ${pin![1]}, which predates ${MIN_ARRAY_FORM_VERSION.join(".")} ` +
        "— the first release honoring top-level [[allowlists]]. The allowlist " +
        "would be silently dropped and the gate would scan on default rules.",
    ).toBe(true);
  });
});
