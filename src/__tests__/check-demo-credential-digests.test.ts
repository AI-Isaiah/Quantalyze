import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import {
  DIGEST_TABLE,
  checkFloors,
  fingerprint,
  formatOffender,
  scanBuffer,
  scanTree,
  verdict,
  type DigestRow,
  type ScanResult,
} from "../../scripts/check-demo-credential-digests";

/**
 * Regression tests for `scripts/check-demo-credential-digests.ts`, the
 * whole-tree guard that fails `npm run lint` when a tracked file carries a
 * retired demo login or password (Phase 241 DEMOCREDS, SECR-02).
 *
 * NO REAL NEEDLE LIVES IN THIS FILE, IN ANY ENCODING. The live-tree arms use
 * only the digests stored in `DIGEST_TABLE`, and every other arm generates
 * its literal at runtime. This file is tracked in a public repo and is itself
 * scanned by the guard it tests.
 *
 * Failure output is role, path and line, never the matched bytes. The fix for
 * a red arm is removing the text from the named file; never exempt a path.
 */

const REPO_ROOT = resolve(__dirname, "..", "..");

/**
 * Build a digest row from raw bytes at runtime, the way the stored rows were
 * built. Logins fold ASCII case before hashing, passwords do not. The fold is
 * spelled out here on purpose: it must not share a code path with the script.
 */
function makeRow(role: string, literal: Buffer, foldCase: boolean): DigestRow {
  const hashed = Buffer.from(literal);
  if (foldCase) {
    for (let i = 0; i < hashed.length; i++) {
      if (hashed[i] >= 65 && hashed[i] <= 90) hashed[i] += 32;
    }
  }
  return {
    role,
    length: literal.length,
    foldCase,
    fp32: fingerprint(literal, foldCase),
    sha256: createHash("sha256").update(hashed).digest("hex"),
  };
}

/** A synthetic mixed-case literal of `n` characters; belongs to nobody. */
function syntheticLiteral(n: number): string {
  return "aB" + randomBytes(n).toString("base64url").slice(0, n - 2);
}

function swapCase(s: string): string {
  return s.replace(/[a-zA-Z]/g, (c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase()));
}

describe("demo credential digest guard", () => {
  let live: ScanResult;

  beforeAll(() => {
    live = scanTree();
  }, 120_000);

  for (const role of [
    "pair-A-login",
    "pair-A-password",
    "pair-B-login",
    "pair-B-password",
  ]) {
    it(`${role}: no tracked file carries it`, () => {
      const offenders: string[] = [];
      for (const o of live.offenders) {
        if (o.role === role) offenders.push(formatOffender(o));
      }
      expect(
        offenders,
        `a tracked file carries the ${role} demo credential. Remove the text from the named file; never allowlist a path.`,
      ).toEqual([]);
    });
  }

  it("the digest table has one row per role", () => {
    const roles = DIGEST_TABLE.map((r) => r.role);
    expect(roles).toEqual([
      "pair-A-login",
      "pair-A-password",
      "pair-B-login",
      "pair-B-password",
    ]);
  });

  it("the lint chain runs the guard", () => {
    const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf-8")) as {
      scripts: { lint: string };
    };
    // Chained with `&&` and followed only by `&&` or the end, so a trailing
    // `|| true` (which would swallow the exit 1) fails this arm.
    expect(pkg.scripts.lint).toMatch(
      /&& tsx scripts\/check-demo-credential-digests\.ts(?=\s*(?:&&|$))/,
    );
    expect(pkg.scripts.lint).not.toMatch(/check-demo-credential-digests\.ts\s*(?:\|\||;)/);
  });

  it("CLI: the script run as npm run lint runs it exits 0 and prints the OK line", () => {
    // execFileSync throws on a non-zero exit, so a red tree fails here too.
    const out = execFileSync("npx", ["tsx", "scripts/check-demo-credential-digests.ts"], {
      cwd: REPO_ROOT,
      encoding: "utf-8",
      maxBuffer: 1 << 24,
    });
    expect(out).toMatch(/^\[check-demo-credential-digests\] OK — \d+ tracked files, \d+ bytes scanned against 4 digest rows; 0 matches\.$/m);
  }, 120_000);

  it("verdict: every failure kind fails the run, and only a clean full scan passes", () => {
    const clean: ScanResult = {
      offenders: [],
      filesListed: 6_000,
      filesScanned: 6_000,
      bytesScanned: 200_000_000,
      unreadable: [],
      violations: [],
    };
    expect(verdict(clean)).toEqual([]);
    expect(verdict({ ...clean, offenders: [{ role: "r", path: "p", line: 1 }] })).toEqual(["r p:1"]);
    expect(verdict({ ...clean, violations: ["EMPTY-SCAN: x"] })).toEqual(["EMPTY-SCAN: x"]);
    expect(verdict({ ...clean, violations: ["UNREADABLE: p"] })).toEqual(["UNREADABLE: p"]);
    expect(verdict({ ...clean, filesScanned: 10 })).toHaveLength(1);
    expect(verdict({ ...clean, bytesScanned: 10 })).toHaveLength(1);
  });

  // ---- anti-vacuity: the guard cannot go green by not looking ----

  let scratch: string;
  beforeAll(() => {
    scratch = mkdtempSync(join(tmpdir(), "demo-digest-guard-"));
  });
  afterAll(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it("EMPTY-SCAN: an empty file list is a failure, not a pass", () => {
    const row = makeRow("canary", Buffer.from(syntheticLiteral(12)), false);
    const empty = scanTree(scratch, [], [row]);
    expect(empty.violations[0] ?? "").toMatch(/^EMPTY-SCAN/);
    // A path that cannot be read is reported and never counted as scanned.
    const missing = scanTree(scratch, ["no-such-file.txt"], [row]);
    expect(missing.filesScanned).toBe(0);
    expect(missing.unreadable).toEqual(["no-such-file.txt"]);
    expect(missing.violations.some((v) => v.startsWith("EMPTY-SCAN"))).toBe(true);
  });

  it("coverage: every tracked file is read (scanned count equals git ls-files count, none unreadable)", () => {
    const tracked = execFileSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      maxBuffer: 1 << 28,
      encoding: "buffer",
    })
      .toString("utf-8")
      .split("\0")
      .filter(Boolean);
    expect(live.filesScanned).toBe(tracked.length);
    expect(live.unreadable).toEqual([]);
  });

  it("floors: the live scan reads at least 5,000 files and 100 MB", () => {
    expect(live.filesScanned).toBeGreaterThanOrEqual(5_000);
    expect(live.bytesScanned).toBeGreaterThanOrEqual(100_000_000);
    expect(checkFloors(live)).toEqual([]);
    expect(checkFloors({ filesScanned: 10, bytesScanned: 10 })).toHaveLength(2);
  });

  it("canary: a runtime-digested literal is found once, a clean buffer zero times", () => {
    const literal = syntheticLiteral(18);
    const row = makeRow("canary", Buffer.from(literal), false);
    const head = Buffer.from("first line\nsecond line\n");
    const buf = Buffer.concat([head, Buffer.from(literal), Buffer.from(" tail\n")]);
    expect(scanBuffer(buf, [row])).toEqual([{ role: "canary", offset: head.length, line: 3 }]);
    expect(scanBuffer(Buffer.concat([head, Buffer.from(" tail\n")]), [row])).toEqual([]);
  });

  it("case: login rows fold case, password rows do not", () => {
    const literal = syntheticLiteral(20);
    const loginRow = makeRow("login-style", Buffer.from(literal.toLowerCase()), true);
    // Uppercase bytes AHEAD of the literal leave the rolling window before it
    // completes, so dropping the fold on the leaving byte alone goes red here.
    const upper = Buffer.from(`X LEADING UPPERCASE TEXT\n${literal.toUpperCase()}\n`);
    expect(scanBuffer(upper, [loginRow]).map((h) => h.line)).toEqual([2]);

    const passwordRow = makeRow("password-style", Buffer.from(literal), false);
    const flipped = Buffer.from(`x\n${swapCase(literal)}\n`);
    expect(scanBuffer(flipped, [passwordRow])).toEqual([]);
    expect(scanBuffer(Buffer.from(`x\n${literal}\n`), [passwordRow]).map((h) => h.line)).toEqual([2]);
  });

  it("edges: CRLF, offset 0, EOF without newline, embedded in a token, after NUL bytes", () => {
    const literal = syntheticLiteral(14);
    const lit = Buffer.from(literal);
    const row = makeRow("edge", lit, false);
    const cases: Array<[string, Buffer, number, number]> = [
      ["CRLF", Buffer.from(`a\r\nb\r\n${literal}\r\nc`), 6, 3],
      ["offset 0", Buffer.concat([lit, Buffer.from("\nrest")]), 0, 1],
      ["EOF without newline", Buffer.from(`x\ny\n${literal}`), 4, 3],
      ["embedded in a token", Buffer.from(`abc123${literal}xyz789`), 6, 1],
      ["after NUL bytes", Buffer.concat([Buffer.alloc(5, 0), lit]), 5, 1],
    ];
    const problems: string[] = [];
    for (const [name, buf, offset, line] of cases) {
      const hits = scanBuffer(buf, [row]);
      if (hits.length !== 1 || hits[0].offset !== offset || hits[0].line !== line) {
        problems.push(`${name}: ${hits.length} hit(s), expected one at offset ${offset} line ${line}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("one byte short is not a match", () => {
    const literal = syntheticLiteral(16);
    const row = makeRow("short", Buffer.from(literal), false);
    const missingLast = Buffer.from(`x ${literal.slice(0, -1)} y`);
    const missingFirst = Buffer.from(`x ${literal.slice(1)} y`);
    expect(scanBuffer(missingLast, [row])).toEqual([]);
    expect(scanBuffer(missingFirst, [row])).toEqual([]);
  });

  it("failure text names role, path and line and never the matched bytes", () => {
    const literal = syntheticLiteral(22);
    const row = makeRow("planted-role", Buffer.from(literal), false);
    writeFileSync(join(scratch, "planted.txt"), `one\ntwo\n${literal}\n`);
    const result = scanTree(scratch, ["planted.txt"], [row]);
    const text = result.offenders.map(formatOffender).join("\n");
    expect(text).toContain("planted-role planted.txt:3");
    const leaks: string[] = [];
    if (text.includes(literal)) leaks.push("failure text carries the matched literal");
    if (text.includes(literal.slice(0, 8))) leaks.push("failure text carries a prefix of the matched literal");
    expect(leaks).toEqual([]);
  });

  it("every window of a random buffer is found at its own offset (rolling and direct fingerprints agree)", () => {
    const buf = randomBytes(600);
    const missed: string[] = [];
    for (const length of DIGEST_TABLE.map((r) => r.length)) {
      for (let offset = 0; offset + length <= buf.length; offset++) {
        const row = makeRow("window", buf.subarray(offset, offset + length), false);
        if (!scanBuffer(buf, [row]).some((h) => h.offset === offset)) {
          missed.push(`length ${length} offset ${offset}`);
        }
      }
    }
    expect(missed).toEqual([]);
  }, 120_000);
});
