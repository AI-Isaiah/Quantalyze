/**
 * VAC-04 reader hardening pins (Phase 164.3.1, plan 04).
 *
 * VAC-04 ("repo function bodies vs PROD") claims soundness from TWO
 * INDEPENDENT readings of "which functions does this SQL define" —
 * `scripts/sql-body-normalize.mjs` (lexer) and
 * `scripts/sql-function-names-naive.mjs` (line-anchored regex). Two readings
 * that agree are only evidence if they can fail SEPARATELY. Two measured
 * defects meant they could not:
 *
 * ── [VAC04-C2] the main-module guard no-ops ────────────────────────────────
 * BOTH members carried the IDENTICAL guard
 * `import.meta.url === \`file://${process.argv[1]}\``. `import.meta.url` is
 * realpath-resolved and percent-encoded; `process.argv[1]` is neither. So on
 * any symlinked invocation path, or any path containing a space, the
 * comparison is false, `main()` never runs, stdout is empty — and the process
 * exits 0. A green gate that read NOTHING.
 *
 * MEASURED at this plan's base `e0660031` (both members, pre-fix):
 *
 *     $ node scripts/sql-function-names-naive.mjs --self-test   # CONTROL
 *     sql-function-names-naive self-test OK (12 checks)
 *     exit=0
 *     $ node "$TMP/link-naive.mjs" --self-test                  # SYMLINK
 *     exit=0                                                   # …and NOTHING printed
 *     $ node "$TMP/link-norm.mjs" --self-test                   # SYMLINK
 *     exit=0                                                   # …and NOTHING printed
 *     $ node "$TMP/link-naive.mjs"                              # NO ARGS
 *     exit=0                                                   # should be 2
 *
 * One mechanism, both "independent" members. That is what made VAC-04's
 * redundancy a lie rather than a cross-check, and it is why the fix is
 * DUPLICATED into each file rather than extracted to a shared helper: a shared
 * guard would recreate exactly the one-mechanism-fails-both shape. (The naive
 * member's node:-builtins-only import contract is machine-pinned at
 * drift-check-scripts.test.ts, which a shared module would also break.)
 *
 * The arms below drive BOTH members through the SAME probes, and each carries
 * a passing control so a probe that cannot distinguish "ran" from "did not
 * run" is itself detectable.
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync, cpSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

/** The two VAC-04 union members, driven identically. */
const MEMBERS = [
  {
    script: "scripts/sql-function-names-naive.mjs",
    okMarker: "sql-function-names-naive self-test OK (",
  },
  {
    script: "scripts/sql-body-normalize.mjs",
    okMarker: "sql-body-normalize self-test OK (",
  },
] as const;

const NAIVE = "scripts/sql-function-names-naive.mjs";

describe("main-module guard ([VAC04-C2]) — every invocation shape must actually RUN the reader", () => {
  for (const { script, okMarker } of MEMBERS) {
    it(`${script}: CONTROL — a plain direct invocation runs main() and prints its self-test line`, () => {
      // The control is not decoration. Arms 2-4 assert on an OK marker being
      // PRESENT; without a run that produces it, "marker missing" could just
      // mean the marker string is wrong, and every arm below would pass
      // vacuously in the wrong direction.
      const r = spawnSync("node", [script, "--self-test"], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain(okMarker);
    }, 30_000);

    it(`${script}: through a SYMLINK, main() still runs`, () => {
      // realpath(argv[1]) !== fileURLToPath(import.meta.url) under the old
      // URL-string guard, so this exited 0 printing nothing — pre-fix RED.
      const dir = mkdtempSync(join(tmpdir(), "vac04-guard-"));
      const link = join(dir, "link.mjs");
      symlinkSync(resolve(script), link);
      const r = spawnSync("node", [link, "--self-test"], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      expect(
        r.stdout,
        "a symlinked invocation that prints NOTHING is a reader that read nothing while reporting success",
      ).toContain(okMarker);
    }, 30_000);

    it(`${script}: from a path containing a SPACE, main() still runs`, () => {
      // Isolates the second leg of the same mechanism: import.meta.url
      // percent-encodes the space (%20) while the old `file://${argv[1]}`
      // concatenation does not, so the strings differ even with no symlink
      // involved. Both scripts import only node: builtins, so a copy runs
      // from anywhere.
      const dir = mkdtempSync(join(tmpdir(), "vac04 guard sp-"));
      const copy = join(dir, "reader.mjs");
      cpSync(resolve(script), copy);
      const r = spawnSync("node", [copy, "--self-test"], { encoding: "utf8" });
      expect(r.status, r.stderr).toBe(0);
      expect(r.stdout).toContain(okMarker);
    }, 30_000);
  }

  it("the symlinked naive reader with NO ARGS exits 2 — the arm where the EXIT CODE itself flips", () => {
    // The other arms detect a silent skip by MISSING STDOUT. This one detects
    // it by the status: the no-args usage error is exit 2, and a skipped
    // main() is exit 0. A gate that shells out and checks only `$?` would see
    // the skip as a pass, which is precisely the failure mode.
    const dir = mkdtempSync(join(tmpdir(), "vac04-guard-noargs-"));
    const link = join(dir, "link.mjs");
    symlinkSync(resolve(NAIVE), link);
    const r = spawnSync("node", [link], { encoding: "utf8" });
    expect(r.status, `stdout=${r.stdout} stderr=${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("at least one file is required");
  }, 30_000);
});
