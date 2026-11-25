/**
 * Whole-tree absence guard for the two retired demo credential pairs
 * (Phase 241 DEMOCREDS, SECR-02). Fails `npm run lint` when ANY tracked file
 * carries one of four literals: a demo login or password, by role.
 *
 * WHAT IT STORES: digests, never literals. `DIGEST_TABLE` below holds, per
 * role, the literal's length, a 32-bit rolling fingerprint and its sha256.
 * The scan slides a window of each row's length over every byte of every
 * tracked file. The fingerprint is a cheap prefilter; the sha256 confirms.
 * Logins hash their lowercased bytes (`foldCase`), passwords their exact bytes.
 *
 * ⛔ NO PATH ALLOWLIST - BY CONSTRUCTION. Every `git ls-files` path is read,
 * every byte, binaries included, this file included (it holds digests only).
 * A match is cleared by removing the text, never by exempting a path. The
 * same stance as `check-planning-hygiene.ts`, whose file enumeration and CLI
 * entry guard this script copies.
 *
 * WHY IT LIVES IN THE LINT CHAIN AND NOT ONLY IN VITEST: a pasted literal is
 * most likely to arrive in a planning record, and a planning-only push skips
 * the vitest shards. The `frontend-lint` job is deliberately unfiltered, so
 * `npm run lint` runs on every event, docs-only included. The vitest test
 * `check-demo-credential-digests.test.ts` imports this module for named arms.
 *
 * FAILURE OUTPUT IS ROLE, PATH AND LINE ONLY. The matched window never leaves
 * `scanBuffer`: the output is pasted into CI logs and tracked records that
 * this very guard scans.
 *
 * HONEST LIMIT: a sha256 of a 6-character password can be brute-forced
 * offline. That is accepted, not hidden. The literals are already in public
 * history, the shared e2e login stops working when the founder resets it, and
 * the allocator account is deleted. The table is a tripwire against
 * reintroduction, not secrecy.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..");

export type DigestRow = {
  role: string;
  length: number;
  foldCase: boolean;
  fp32: number;
  sha256: string;
};

export type Hit = { role: string; offset: number; line: number };
export type Offender = { role: string; path: string; line: number };

export type ScanResult = {
  offenders: Offender[];
  filesListed: number;
  filesScanned: number;
  bytesScanned: number;
  unreadable: string[];
  /** Verdicts other than a match: EMPTY-SCAN and unreadable paths. */
  violations: string[];
};

/**
 * Anti-vacuity floors. Measured 2026-11-24 at 12,171 files and 263,116,843
 * bytes; set well below, so normal growth never trips them and they are never
 * raised by reflex. A floor pinned at the measurement gets raised the first
 * time it fires.
 */
export const FILES_FLOOR = 5_000;
export const BYTES_FLOOR = 100_000_000;

/** Polynomial hash multiplier (FNV prime). */
const M = 0x01000193;

/**
 * The ONE place a byte is case-folded (ASCII A-Z to a-z) for a foldCase row.
 * `fingerprint`, `scanBuffer` and the sha256 input all call it, so a single
 * edit here disables folding everywhere.
 */
function foldByte(c: number, foldCase: boolean): number {
  return foldCase && c >= 65 && c <= 90 ? c + 32 : c;
}

/** 32-bit polynomial fingerprint (`h = h * M + b`), returned unsigned. */
export function fingerprint(bytes: Uint8Array, foldCase: boolean): number {
  let h = 0;
  for (let i = 0; i < bytes.length; i++) {
    h = (Math.imul(h, M) + foldByte(bytes[i], foldCase)) | 0;
  }
  return h >>> 0;
}

/** `M^length mod 2^32`: the weight of the byte that leaves the window. */
function powFor(length: number): number {
  let p = 1;
  for (let i = 0; i < length; i++) p = Math.imul(p, M);
  return p;
}

/**
 * The digest rows, in role order. Neutral field names on purpose: a
 * keyword-bearing identifier on a digest's line trips gitleaks'
 * `generic-api-key`, neutral names do not, and no allowlist entry is wanted.
 * Logins: foldCase true, sha256 of the lowercased bytes. Passwords: foldCase
 * false, sha256 of the exact bytes.
 */
export const DIGEST_TABLE: readonly DigestRow[] = Object.freeze([
  { role: "pair-A-login", length: 27, foldCase: true, fp32: 1146936604, sha256: "7225b29d6f1efb5ac5e12613ce982c6fe9b9294a1bfeb15cd112e5ec1d19bb80" },
  { role: "pair-A-password", length: 6, foldCase: false, fp32: 2082127179, sha256: "176344d4b7feeec6e6cdc05ac78b35496367bb0620d2b24292dd7c26cda6e550" },
  { role: "pair-B-login", length: 30, foldCase: true, fp32: 4092474371, sha256: "29815557797baed383ac7397a1a2a125dd20c777198436cb881b4b86f1f9fa79" },
  { role: "pair-B-password", length: 14, foldCase: false, fp32: 3500895320, sha256: "295e3093df975b5dd4699c7aed2c397c2e591849d51c8e2d98c7da62e1fcd7fe" },
]);

/**
 * Find every window of each row's length whose digest matches. Returns role
 * and position only: the window bytes never leave this function.
 */
export function scanBuffer(buf: Uint8Array, rows: readonly DigestRow[]): Hit[] {
  const out: Hit[] = [];
  for (const r of rows) {
    const len = r.length;
    if (!(len > 0) || buf.length < len) continue;
    const pow = powFor(len);
    let h = 0;
    for (let i = 0; i < buf.length; i++) {
      h = (Math.imul(h, M) + foldByte(buf[i], r.foldCase)) | 0;
      if (i >= len) {
        h = (h - Math.imul(foldByte(buf[i - len], r.foldCase), pow)) | 0;
      }
      if (i >= len - 1 && h >>> 0 === r.fp32) {
        const start = i - len + 1;
        const win = Buffer.from(buf.subarray(start, i + 1));
        for (let k = 0; k < win.length; k++) win[k] = foldByte(win[k], r.foldCase);
        if (createHash("sha256").update(win).digest("hex") === r.sha256) {
          out.push({ role: r.role, offset: start, line: lineOf(buf, start) });
        }
      }
    }
  }
  return out.sort((a, b) => a.offset - b.offset);
}

function lineOf(buf: Uint8Array, offset: number): number {
  let n = 1;
  for (let i = 0; i < offset; i++) if (buf[i] === 0x0a) n++;
  return n;
}

/**
 * Enumerate the tracked files. `git ls-files -z` is exactly "what is committed
 * and therefore public"; NUL-delimited so odd paths survive, `execFileSync`
 * with an argument array so there is no shell.
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
 * Scan a file list. `files` and `rows` are injectable so tests can drive a
 * fixture tree; in production they are the tracked-file list and
 * `DIGEST_TABLE`. Each path is read as raw bytes: no decode, no skip.
 */
export function scanTree(
  rootDir: string = REPO_ROOT,
  files: string[] = listTrackedFiles(rootDir),
  rows: readonly DigestRow[] = DIGEST_TABLE,
): ScanResult {
  const offenders: Offender[] = [];
  const unreadable: string[] = [];
  const violations: string[] = [];
  let filesScanned = 0;
  let bytesScanned = 0;
  for (const path of files) {
    let buf: Buffer;
    try {
      buf = readFileSync(resolve(rootDir, path));
    } catch {
      unreadable.push(path);
      continue;
    }
    filesScanned++;
    bytesScanned += buf.length;
    for (const hit of scanBuffer(buf, rows)) {
      offenders.push({ role: hit.role, path, line: hit.line });
    }
  }
  if (filesScanned === 0) {
    violations.push(
      "EMPTY-SCAN: zero files were read. A gate that walks nothing reports OK forever.",
    );
  }
  for (const path of unreadable) {
    violations.push(`UNREADABLE: ${path} is tracked but could not be read, so it was not scanned`);
  }
  return {
    offenders,
    filesListed: files.length,
    filesScanned,
    bytesScanned,
    unreadable,
    violations,
  };
}

/** Floor violations: a scan that read far less than the tree is not a pass. */
export function checkFloors(result: {
  filesScanned: number;
  bytesScanned: number;
}): string[] {
  const out: string[] = [];
  if (result.filesScanned < FILES_FLOOR) {
    out.push(
      `FLOOR: ${result.filesScanned} files scanned, below the ${FILES_FLOOR} floor`,
    );
  }
  if (result.bytesScanned < BYTES_FLOOR) {
    out.push(
      `FLOOR: ${result.bytesScanned} bytes scanned, below the ${BYTES_FLOOR} floor`,
    );
  }
  return out;
}

/** Role, path and line. Never the matched bytes. */
export function formatOffender(o: Offender): string {
  return `${o.role} ${o.path}:${o.line}`;
}

/**
 * Every reason the run fails: matches, EMPTY-SCAN and unreadable paths, and
 * floor misses. Empty means pass. `main` exits 1 on a non-empty verdict.
 */
export function verdict(result: ScanResult): string[] {
  return [
    ...result.offenders.map(formatOffender),
    ...result.violations,
    ...checkFloors(result),
  ];
}

function main(): void {
  const result = scanTree(REPO_ROOT);
  const problems = verdict(result);
  if (problems.length > 0) {
    console.error(`[check-demo-credential-digests] ${problems.length} match(es):`);
    for (const p of problems.slice(0, 50)) console.error(`  - ${p}`);
    if (problems.length > 50) {
      console.error(`  ... and ${problems.length - 50} more`);
    }
    process.exit(1);
  }
  console.log(
    `[check-demo-credential-digests] OK — ${result.filesScanned} tracked files, ${result.bytesScanned} bytes scanned against ${DIGEST_TABLE.length} digest rows; 0 matches.`,
  );
}

// Only run the CLI when invoked directly (not when imported by tests). Both
// the undefined and the empty-string argv cases are rejected before
// `endsWith`, because every string ends with the empty string.
// Paths compare after realpath, so a run through a symlinked directory still
// reaches `main` instead of exiting 0 having scanned nothing.
const entryPath = process.argv[1];
if (entryPath !== undefined && entryPath.length > 0) {
  if (
    import.meta.url === pathToFileURL(entryPath).href ||
    import.meta.url.endsWith(entryPath) ||
    realpathOrSelf(fileURLToPath(import.meta.url)) === realpathOrSelf(resolve(entryPath))
  ) {
    main();
  }
}

function realpathOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}
