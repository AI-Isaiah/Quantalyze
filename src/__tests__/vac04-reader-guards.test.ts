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
import { mkdtempSync, symlinkSync, cpSync, writeFileSync } from "node:fs";
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

/**
 * ── [VAC04-C4] truncate-instead-of-refuse ──────────────────────────────────
 *
 * An unquoted identifier containing a character outside `[A-Za-z0-9_$]` was
 * silently NARROWED by both readers, in two different directions:
 *
 * MEASURED at this plan's base `e0660031`, on
 * `CREATE OR REPLACE FUNCTION public.fúnc_é(p uuid) …`:
 *
 *     $ node scripts/sql-function-names-naive.mjs "$P10"
 *     f
 *     exit=0                       # TRUNCATED at the `ú` byte
 *     $ node scripts/sql-body-normalize.mjs --function-names "$P10"
 *     exit=0                       # …and NOTHING printed: DROPPED
 *     $ node scripts/sql-body-normalize.mjs --function-qualified-names "$P10"
 *     exit=0                       # …same
 *
 * `f` is a DIFFERENT FUNCTION from `fúnc_é`. VAC-04 uses that name to look up
 * a body in the PROD dump, so a truncated read makes the gate compare the
 * WRONG subject — and it can report MATCH for it. Silence and a wrong name are
 * both worse than a refusal, so both readers now ERROR.
 *
 * The refusal is bounded in two directions that are asserted separately:
 *  • it FIRES on the shapes above (arms 1-4);
 *  • it is SILENT on everything legitimate — quoted identifiers may still
 *    contain any character (arm 5), the `$` identifier is still DROPPED rather
 *    than refused (arm 6), and drift-check-scripts.test.ts's standing 380-file
 *    corpus-parity arm proves zero firings across every real .sql file.
 *
 * Arm 6 is load-bearing beyond itself: `sanitize_user$v2` is the union's
 * DESIGNED disagreement — `$` is INSIDE Postgres' unquoted charset, the naive
 * member reads it, and the normalizer's inability to is SP-C05's measured
 * limitation, which is the entire reason the naive member exists. A refusal
 * that fired on `$` would break the union's design while claiming to harden it.
 */
describe("charset refusal ([VAC04-C4]) — a reader that cannot read the name must REFUSE, never narrow it", () => {
  const NORMALIZER = "scripts/sql-body-normalize.mjs";

  /**
   * Appears ONLY inside a function body, nowhere else in this file's fixtures.
   * Arm 7 asserts it never reaches stderr: the refusal diagnostic runs over a
   * PROD dump in a PUBLIC CI log, so it may name identifiers and positions but
   * never body text.
   */
  const BODY_SENTINEL = "ZZ_VAC04_BODY_SENTINEL_ZZ";

  /**
   * The P10 input. The leading comment line is not filler — it puts the
   * definition on line 2, so the "1-based line number" claim in the diagnostic
   * is actually computed rather than a hardcoded 1.
   */
  const P10_SQL =
    "-- fixture header, so the definition is NOT on line 1\n" +
    "CREATE OR REPLACE FUNCTION public.fúnc_é(p uuid)\n" +
    "RETURNS void\nLANGUAGE plpgsql\nAS $$\nBEGIN\n" +
    `  PERFORM 1; -- ${BODY_SENTINEL}\nEND;\n$$;\n`;

  const LEADING_SQL =
    "CREATE FUNCTION únc(p int) RETURNS void LANGUAGE plpgsql AS $$ BEGIN END; $$;\n";

  const QUOTED_SQL =
    'CREATE OR REPLACE FUNCTION public."fúnc"(p int) RETURNS void ' +
    "LANGUAGE plpgsql AS $$ BEGIN END; $$;\n";

  const DOLLAR_SQL =
    "CREATE OR REPLACE FUNCTION public.sanitize_user$v2(p uuid) RETURNS void " +
    "LANGUAGE plpgsql AS $fn$ BEGIN END; $fn$;\n";

  /** Write `sql` into a fresh temp dir and return its path. */
  function fixture(sql: string): string {
    const dir = mkdtempSync(join(tmpdir(), "vac04-charset-"));
    const file = join(dir, "in.sql");
    writeFileSync(file, sql, "utf8");
    return file;
  }

  const CHARSET_PHRASE = "identifier leaves the unquoted charset";
  /** ú — the offending character, named by codepoint so the message is precise. */
  const CODEPOINT = "U+00FA";

  it("naive: the P10 input EXITS 1 naming what it saw, instead of printing the truncated `f`", () => {
    const file = fixture(P10_SQL);
    const r = spawnSync("node", ["scripts/sql-function-names-naive.mjs", file], {
      encoding: "utf8",
    });
    expect(r.status, `stdout=${r.stdout} stderr=${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(CHARSET_PHRASE);
    expect(r.stderr, "the diagnostic must name the OFFENDING CHARACTER, not just a conclusion").toContain(CODEPOINT);
    expect(r.stderr, "…and the file it was reading").toContain(file);
    expect(r.stderr, "…and the 1-based line, which is line 2 here").toContain(":2:");
    expect(r.stderr, "…and the identifier prefix it actually read").toContain("public.f");
    expect(r.stdout, "a refusal must print no name at all — `f` is a DIFFERENT function").toBe("");
  }, 30_000);

  it("normalizer --function-names: the P10 input EXITS 1 instead of silently dropping the definition", () => {
    const file = fixture(P10_SQL);
    const r = spawnSync("node", [NORMALIZER, "--function-names", file], {
      encoding: "utf8",
    });
    expect(r.status, `stdout=${r.stdout} stderr=${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(CHARSET_PHRASE);
    expect(r.stderr).toContain(CODEPOINT);
    expect(r.stderr).toContain(file);
    expect(r.stderr).toContain(":2:");
    expect(r.stdout).toBe("");
  }, 30_000);

  it("normalizer --function-qualified-names: the mode VAC-04's SCHEMA check drives refuses too", () => {
    // Same throw site, but asserted through the second mode: VAC-04 reads a
    // `--schema public` dump, so the qualified mode is what decides "this
    // definition targets another schema". A silent narrowing there is the same
    // wrong-subject bug wearing a different hat.
    const file = fixture(P10_SQL);
    const r = spawnSync("node", [NORMALIZER, "--function-qualified-names", file], {
      encoding: "utf8",
    });
    expect(r.status, `stdout=${r.stdout} stderr=${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(CHARSET_PHRASE);
  }, 30_000);

  it("a LEADING non-ASCII identifier is caught by the normalizer — the union covering the naive reader's blind spot", () => {
    // `CREATE FUNCTION únc(...)`: DEF_RE needs a charset byte right after
    // FUNCTION, so the naive reader cannot see this line AT ALL. That is the
    // documented miss, asserted rather than assumed — and it is exactly why
    // the other member's refusal has to exist.
    const file = fixture(LEADING_SQL);
    const lexer = spawnSync("node", [NORMALIZER, "--function-names", file], {
      encoding: "utf8",
    });
    expect(lexer.status, `stdout=${lexer.stdout} stderr=${lexer.stderr}`).toBe(1);
    expect(lexer.stderr).toContain(CHARSET_PHRASE);
    expect(lexer.stderr).toContain(CODEPOINT);

    const naive = spawnSync("node", ["scripts/sql-function-names-naive.mjs", file], {
      encoding: "utf8",
    });
    expect(naive.status, "the naive reader's documented miss: it sees no definition here").toBe(0);
    expect(naive.stdout).toBe("");
  }, 30_000);

  it("QUOTED identifiers may still contain any character — the refusal concerns only UNQUOTED ones", () => {
    const file = fixture(QUOTED_SQL);
    const naive = spawnSync("node", ["scripts/sql-function-names-naive.mjs", file], {
      encoding: "utf8",
    });
    expect(naive.status, naive.stderr).toBe(0);
    expect(naive.stdout).toContain("fúnc");

    const lexer = spawnSync("node", [NORMALIZER, "--function-names", file], {
      encoding: "utf8",
    });
    expect(lexer.status, lexer.stderr).toBe(0);
    expect(lexer.stdout).toContain("fúnc");
  }, 30_000);

  it("the `$` identifier is still DROPPED by the normalizer and SEEN by the naive reader — the union's designed disagreement survives", () => {
    // ⛔ If this arm ever reports a refusal, the fix has broken SP-C05: `$` is
    // inside the unquoted charset, so it is NOT a charset violation. The
    // normalizer's blindness to it is a measured limitation covered by the
    // OTHER member, which is the whole architecture. Refusing it would turn a
    // working cross-check into a wedged gate.
    const file = fixture(DOLLAR_SQL);
    const naive = spawnSync("node", ["scripts/sql-function-names-naive.mjs", file], {
      encoding: "utf8",
    });
    expect(naive.status, naive.stderr).toBe(0);
    expect(naive.stdout.trim()).toBe("sanitize_user$v2");

    const lexer = spawnSync("node", [NORMALIZER, "--function-names", file], {
      encoding: "utf8",
    });
    expect(lexer.status, `a $ identifier must be DROPPED, never refused: ${lexer.stderr}`).toBe(0);
    expect(lexer.stdout.trim()).toBe("");
  }, 30_000);

  it("refusal diagnostics leak NO body text — the normalizer's index run reads a PROD dump into a public CI log", () => {
    const file = fixture(P10_SQL);
    for (const argv of [
      ["scripts/sql-function-names-naive.mjs", file],
      [NORMALIZER, "--function-names", file],
    ]) {
      const r = spawnSync("node", argv, { encoding: "utf8" });
      expect(r.status).toBe(1);
      // Calibration: the sentinel really is in the input we just fed it, so a
      // "not found" below cannot mean the fixture lost its body.
      expect(P10_SQL).toContain(BODY_SENTINEL);
      expect(
        r.stderr + r.stdout,
        `${argv[0]} echoed function body text into its diagnostic`,
      ).not.toContain(BODY_SENTINEL);
      // IN-06 (164.3.1 review): the rule is "never the source line" as well
      // (naive.mjs:302-303). `(p uuid)` is on the definition line and is the
      // only fragment of it beyond the allowed `read 'public.f'` prefix.
      expect(P10_SQL).toContain("(p uuid)");
      expect(
        r.stderr + r.stdout,
        `${argv[0]} echoed the definition line into its diagnostic`,
      ).not.toContain("(p uuid)");
    }
  }, 30_000);

  it("both LIBRARY functions throw — no import path can receive a truncated or dropped name", async () => {
    // The CLI arms above prove the gate's shell path. This one closes the
    // library boundary: vitest suites and any future caller import these
    // directly, and a silent narrowing there is the same wrong-subject bug.
    const { naiveFunctionDefs } = await import(
      "../../scripts/sql-function-names-naive.mjs"
    );
    const { extractFunctionDefs } = await import(
      "../../scripts/sql-body-normalize.mjs"
    );
    expect(() => naiveFunctionDefs(P10_SQL)).toThrow(/identifier leaves the unquoted charset/);
    expect(() => extractFunctionDefs(P10_SQL)).toThrow(/identifier leaves the unquoted charset/);
    // The same two functions must stay SILENT on the $ shape (drop, not throw).
    expect(() => naiveFunctionDefs(DOLLAR_SQL)).not.toThrow();
    expect(() => extractFunctionDefs(DOLLAR_SQL)).not.toThrow();
  });
});
