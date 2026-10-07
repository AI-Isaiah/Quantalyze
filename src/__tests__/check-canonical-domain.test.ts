import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  ALLOWLIST,
  EXCLUDED_FILES,
  EXCLUDED_PREFIXES,
  runCheck,
} from "../../scripts/check-canonical-domain";

/**
 * Regression tests for `scripts/check-canonical-domain.ts` — the D-10 gate of
 * Phase 164.6.6.3.5 (DOMAINONE). It fails when a tracked file mentions the
 * domain this product does not own.
 *
 * The properties under test are the ways a gate of this class has gone blind:
 *   1. a literal planted in a file it never opened,
 *   2. a NUL byte hiding what follows it from a grep-based scan,
 *   3. an exclusion that is a substring match instead of a path-anchored one,
 *   4. an allowlist pinned to a count that can drift in only one direction,
 *   5. a walk that finds zero files reading as OK.
 *
 * The needle is assembled from parts so this file never contains it, which
 * would make the gate fail on its own test.
 */
const NEEDLE = ["quantalyze", "com"].join(".");

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "canonical-domain-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(rel: string, contents: string | Buffer): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, typeof contents === "string" ? Buffer.from(contents, "latin1") : contents);
}

describe("runCheck - end to end over real files", () => {
  it("names a file that carries the literal, with its count, and goes clean once it is rewritten", () => {
    write("src/page.tsx", `href="https://www.${NEEDLE}/privacy" and ${NEEDLE}`);
    const dirty = runCheck(root, ["src/page.tsx"]);
    expect(dirty.violations).toHaveLength(1);
    expect(dirty.violations[0]).toContain("src/page.tsx");
    expect(dirty.violations[0]).toContain("2 occurrence(s)");

    write("src/page.tsx", `href="https://example.com/privacy"`);
    const clean = runCheck(root, ["src/page.tsx"]);
    expect(clean.violations).toEqual([]);
    expect(clean.filesScanned).toBe(1);
  });

  it("is case-insensitive and finds an address form", () => {
    write("a.md", `WWW.${NEEDLE.toUpperCase()}`);
    write("b.md", `mail someone@${NEEDLE} please`);
    const r = runCheck(root, ["a.md", "b.md"]);
    expect(r.violations).toHaveLength(2);
  });

  it("does not match a different domain that merely shares the stem", () => {
    write("a.md", "quantalyze-rho.vercel.app and quantalyze.xyz and quantalyzecom");
    expect(runCheck(root, ["a.md"]).violations).toEqual([]);
  });
});

describe("runCheck - NUL-safety and binary files", () => {
  it("finds a literal planted AFTER a NUL byte", () => {
    write("src/hidden.ts", `clean line${String.fromCharCode(0)}then ${NEEDLE}`);
    const r = runCheck(root, ["src/hidden.ts"]);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toContain("src/hidden.ts");
  });

  it("finds the literal inside a binary file, as a PDF link annotation carries it", () => {
    const head = Buffer.alloc(256);
    for (let i = 0; i < 256; i++) head[i] = i;
    const link = Buffer.from(`/URI (mailto:contact@${NEEDLE})`, "latin1");
    write("public/packet.pdf", Buffer.concat([head, link, head]));
    const r = runCheck(root, ["public/packet.pdf"]);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0]).toContain("public/packet.pdf");
  });
});

describe("runCheck - the two D-10 exclusions are path-anchored", () => {
  it("excludes only the planning tree and the root CHANGELOG", () => {
    expect(EXCLUDED_PREFIXES).toEqual([".planning/"]);
    expect(EXCLUDED_FILES).toEqual(["CHANGELOG.md"]);
    write(".planning/phase/notes.md", NEEDLE);
    write("CHANGELOG.md", NEEDLE);
    write("src/clean.ts", "x");
    const r = runCheck(root, [".planning/phase/notes.md", "CHANGELOG.md", "src/clean.ts"]);
    expect(r.violations).toEqual([]);
    // An excluded file is not READ, so it is not counted as scanned either.
    expect(r.filesScanned).toBe(1);
  });

  it("does not exclude a nested CHANGELOG or a path that merely contains .planning/", () => {
    write("docs/CHANGELOG.md", NEEDLE);
    write("x.planning/y.md", NEEDLE);
    write("src/.planning/z.md", NEEDLE);
    const r = runCheck(root, ["docs/CHANGELOG.md", "x.planning/y.md", "src/.planning/z.md"]);
    expect(r.violations).toHaveLength(3);
  });
});

describe("runCheck - the count-pinned allowlist fails in both directions", () => {
  it("names exactly the two analytics lineage tests", () => {
    expect(ALLOWLIST.map((e) => e.file).sort()).toEqual([
      "src/lib/analytics.test.ts",
      "src/lib/analytics/usage-events.test.ts",
    ]);
    for (const e of ALLOWLIST) {
      expect(e.occurrences).toBeGreaterThan(0);
      expect(e.reason).toContain("D-10");
    }
  });

  it("is clean at exactly the pinned count, a violation at pin+1 and at pin-1, and at zero", () => {
    const entry = ALLOWLIST[0];
    const at = (n: number) => write(entry.file, Array(n).fill(`host !== "${NEEDLE}"`).join("\n"));

    at(entry.occurrences);
    expect(runCheck(root, [entry.file]).violations).toEqual([]);

    at(entry.occurrences + 1);
    const more = runCheck(root, [entry.file]).violations;
    expect(more).toHaveLength(1);
    expect(more[0]).toContain(String(entry.occurrences));
    expect(more[0]).toContain(String(entry.occurrences + 1));

    at(entry.occurrences - 1);
    expect(runCheck(root, [entry.file]).violations).toHaveLength(1);

    at(0);
    expect(runCheck(root, [entry.file]).violations).toHaveLength(1);
  });

  it("does not let an allowlisted path launder another file", () => {
    write("src/other.test.ts", NEEDLE);
    expect(runCheck(root, ["src/other.test.ts"]).violations).toHaveLength(1);
  });
});

describe("runCheck - anti-vacuity", () => {
  it("an empty file list is an EMPTY-SCAN violation, never an OK", () => {
    const r = runCheck(root, []);
    expect(r.filesScanned).toBe(0);
    expect(r.violations).toHaveLength(1);
    expect(r.violations[0].startsWith("EMPTY-SCAN")).toBe(true);
  });

  it("reports the number of files it actually read", () => {
    write("a.ts", "x");
    write("b.ts", "y");
    const r = runCheck(root, ["a.ts", "b.ts"]);
    expect(r.filesScanned).toBe(2);
    expect(r.violations).toEqual([]);
  });

  it("skips a tracked path that cannot be read, without counting it as scanned", () => {
    write("a.ts", "x");
    const r = runCheck(root, ["a.ts", "deleted-in-worktree.ts"]);
    expect(r.filesScanned).toBe(1);
    expect(r.violations).toEqual([]);
  });
});
