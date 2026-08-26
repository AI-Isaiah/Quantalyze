import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  runCheck,
  scanFile,
  listTrackedFiles,
} from "../../scripts/check-planning-hygiene";

/**
 * Regression tests for `scripts/check-planning-hygiene.ts` — the NO-ALLOWLIST
 * gate that fails `npm run lint` when a tracked file carries the macOS username
 * or a local absolute home path (Phase 163 SEC-02).
 *
 * ⚠️ EVERY needle in this file is built from char codes or base64, never spelled
 * literally. This test file is itself tracked, so a literal needle here would
 * make the gate fail on its own test suite — the "needle self-match" trap the
 * plan names. Do NOT "simplify" these constructions into string literals.
 *
 * The four properties under test are the four ways this class of gate has
 * historically gone blind:
 *   1. path allowlists (why gitleaks missed this entirely) — asserted absent,
 *   2. NUL bytes truncating a read (src/lib/wizardErrors.test.ts line 1572),
 *   3. the scanner's own source tripping the scan,
 *   4. a walk that finds zero files reading as "OK".
 */

// The needles, reconstructed — never written out.
const HOME_PREFIX = String.fromCharCode(47, 85, 115, 101, 114, 115, 47);
const SCRATCH_PREFIX = String.fromCharCode(45, 85, 115, 101, 114, 115, 45);
const USERNAME = Buffer.from("aGVsaW9zLW1hbW11dA==", "base64").toString();
const OTHER_USER = "someone-else";

let fixtureRoot: string;

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "planning-hygiene-"));
});

afterEach(() => {
  rmSync(fixtureRoot, { recursive: true, force: true });
});

function write(relativePath: string, contents: string): void {
  const abs = join(fixtureRoot, relativePath);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, contents, "latin1");
}

describe("scanFile — the three needle classes", () => {
  it("flags the macOS username on its own", () => {
    const v = scanFile("docs/notes.md", `authored by ${USERNAME} on a laptop`);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("LOCAL-USERNAME");
    expect(v[0]).toContain("docs/notes.md");
  });

  it("matches the username case-insensitively", () => {
    const v = scanFile("docs/notes.md", `USER=${USERNAME.toUpperCase()}`);
    expect(v.some((s) => s.startsWith("LOCAL-USERNAME"))).toBe(true);
  });

  it("flags an absolute home path even with a DIFFERENT username", () => {
    // The structural rule is what makes this gate outlive one machine: a
    // teammate's absolute path must fail too, or the gate only guards one laptop.
    const v = scanFile("docs/x.md", `see ${HOME_PREFIX}${OTHER_USER}/notes.txt`);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("ABSOLUTE-HOME-PATH");
  });

  it("flags the dash-mangled scratchpad form of a home path", () => {
    const v = scanFile(
      "docs/x.md",
      `/private/tmp/claude-501${SCRATCH_PREFIX}${OTHER_USER}-projects/run.log`,
    );
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("SCRATCH-HOME-PATH");
  });

  it("reports the line number so the violation is actionable", () => {
    const v = scanFile("docs/x.md", `clean\nclean\n${HOME_PREFIX}${OTHER_USER}/f\n`);
    expect(v[0]).toContain("docs/x.md:3");
  });
});

describe("the placeholder is exempted BY VALUE, never by path", () => {
  it("does not flag the redaction placeholder in a home path", () => {
    expect(scanFile("docs/x.md", `${HOME_PREFIX}<user>/notes.txt`)).toEqual([]);
  });

  it("does not flag the dash-mangled placeholder form", () => {
    expect(scanFile("docs/x.md", `${SCRATCH_PREFIX}<user>-projects`)).toEqual([]);
  });

  it("does not flag the ESCAPED spelling of the pattern", () => {
    // Docs, plans and this gate's own source must be able to NAME the pattern.
    const escaped = String.fromCharCode(92, 47, 85, 115, 101, 114, 115, 92, 47);
    expect(scanFile("docs/x.md", `the ${escaped} prefix`)).toEqual([]);
  });

  it("still flags a real path in a file that a path allowlist would exempt", () => {
    // The gitleaks blindness reproduced deliberately: these are exactly the
    // paths a path-based allowlist would carve out. They must STILL fail.
    for (const p of [
      "supabase/migrations/20260517013000_applied.sql",
      ".planning/phases/163/163-03-SUMMARY.md",
      "scripts/check-planning-hygiene.ts",
      "src/__tests__/check-planning-hygiene.test.ts",
      "node_modules/pkg/readme.md",
    ]) {
      const v = scanFile(p, `${HOME_PREFIX}${OTHER_USER}/x`);
      expect(v, `${p} must not be exempted by path`).toHaveLength(1);
    }
  });
});

describe("NUL-safety — the src/lib/wizardErrors.test.ts blind spot", () => {
  it("scans past a NUL byte to find an occurrence after it", () => {
    // `grep`/`git grep -I` classify this content as binary and skip it; exit 1
    // then reads as a clean pass. That is the recorded failure this pins.
    const contents = `header\n${String.fromCharCode(0)}\n${HOME_PREFIX}${OTHER_USER}/late.txt\n`;
    const v = scanFile("src/lib/withNul.test.ts", contents);
    expect(v).toHaveLength(1);
    expect(v[0]).toContain("ABSOLUTE-HOME-PATH");
  });

  it("reads a NUL-carrying file off disk without truncating", () => {
    write(
      "fixture.txt",
      `a\n${String.fromCharCode(0)}\n${HOME_PREFIX}${OTHER_USER}/late.txt\n`,
    );
    const { violations, filesScanned } = runCheck(fixtureRoot, ["fixture.txt"]);
    expect(filesScanned).toBe(1);
    expect(violations).toHaveLength(1);
  });
});

describe("anti-vacuity — an empty walk is a failure, not a pass", () => {
  it("reports EMPTY-SCAN when the file list is empty", () => {
    const { violations, filesScanned } = runCheck(fixtureRoot, []);
    expect(filesScanned).toBe(0);
    expect(violations.some((v) => v.startsWith("EMPTY-SCAN"))).toBe(true);
  });

  it("counts every file it scanned, including clean ones", () => {
    write("a.md", "clean\n");
    write("b.md", "also clean\n");
    const { violations, filesScanned } = runCheck(fixtureRoot, ["a.md", "b.md"]);
    expect(filesScanned).toBe(2);
    expect(violations).toEqual([]);
  });
});

describe("the live repository", () => {
  it("enumerates a plausible number of tracked files", () => {
    // Guards the enumeration itself: if `git ls-files` ever returns nothing
    // (wrong cwd, detached state), the gate would go green over zero files.
    expect(listTrackedFiles(process.cwd()).length).toBeGreaterThan(1000);
  });

  it("has zero violations at HEAD — the scanner's own source included", () => {
    const { violations, filesScanned } = runCheck(process.cwd());
    expect(violations).toEqual([]);
    expect(filesScanned).toBeGreaterThan(1000);
  });
});
