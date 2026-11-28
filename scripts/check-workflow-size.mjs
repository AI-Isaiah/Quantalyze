#!/usr/bin/env node
/**
 * Workflow file size gate - Phase 260 CIHEADROOM.
 *
 * WHY THIS LIVES OUTSIDE ci.yml. GitHub starts NO run for a workflow file above
 * its size limit: the documented sentence is "Each workflow file ... must be
 * 500 KB or smaller to trigger a run", and 500 KB is 512,000 bytes here. A check
 * inside the oversized file could never fire, because the file would never run.
 * The board then shows only the non-CI checks, and two green checks read as a
 * healthy PR (CLAUDE.md, "CI gate integrity", trap 1: count the checks). So this
 * script runs from its own workflow, `.github/workflows/workflow-size.yml`, which
 * stays small and has no paths filter.
 *
 * MEASURED DATA POINTS (Phase 243, 2026-11-27, recorded in 260-CONTEXT.md): a
 * ci.yml of 512,355 bytes got a run that failed at startup with zero jobs, on two
 * pushes; at 511,664 bytes CI started normally. Both agree with 512,000.
 *
 * THE VERDICT. A file is red when it is strictly ABOVE `CEILING`. A file of exactly
 * `CEILING` bytes is green. There is no warning tier: a file is over the ceiling
 * or it is not. The script prints every file's size and its headroom to the
 * ceiling and to the hard limit, so the margin is visible on every run.
 *
 * AN EMPTY SCAN IS NOT A PASS. No matching file, or a directory that cannot be
 * read, is a MEASURE_FAIL and exits 1. A gate over nothing reports a clean
 * corpus it never opened.
 *
 * USAGE
 *   node scripts/check-workflow-size.mjs [dir]       scan dir (default .github/workflows)
 *   node scripts/check-workflow-size.mjs --self-test  prove the gate can go red and green
 * Any other flag prints a usage line and exits 1, so a gate never passes on a typo.
 */
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * GitHub's documented limit, "500 KB or smaller to trigger a run", read as 500 KiB
 * = 512,000 bytes. Consistent with the two measured data points above: 511,664
 * bytes ran, 512,355 bytes did not.
 */
export const HARD_LIMIT = 512_000;

/** 90 percent of the hard limit: a 51,200-byte margin. Strictly above this is red. */
export const CEILING = 460_800;

const DEFAULT_DIR = ".github/workflows";
const WORKFLOW_NAME_RE = /\.ya?ml$/;

/**
 * Regular files matching *.yml / *.yaml in `dir`, sorted by name. `path` is the
 * directory exactly as given joined with the name, never resolved to an absolute
 * path, so the default scan annotates `.github/workflows/<name>`. Anything that
 * matches by name but is not a regular file goes in `skipped`. Throws when the
 * directory is unreadable.
 */
export function scan(dir) {
  const names = readdirSync(dir)
    .filter((n) => WORKFLOW_NAME_RE.test(n))
    .sort();
  const rows = [];
  const skipped = [];
  for (const name of names) {
    const path = join(dir, name);
    const st = lstatSync(path);
    if (st.isFile()) rows.push({ name, path, bytes: st.size });
    else skipped.push(name);
  }
  return { rows, skipped };
}

/** PURE: rows -> { ok, lines, errors }. An empty set is an error, never a pass. */
export function judge(rows) {
  if (rows.length === 0) {
    return {
      ok: false,
      lines: [],
      errors: [
        "::error::MEASURE_FAIL: no workflow file matched *.yml or *.yaml; a gate over nothing is not a pass",
      ],
    };
  }
  const lines = [];
  const errors = [];
  for (const r of rows) {
    lines.push(
      `${r.path}: ${r.bytes} bytes, ${CEILING - r.bytes} to the ceiling ${CEILING}, ${HARD_LIMIT - r.bytes} to the hard limit ${HARD_LIMIT}`,
    );
    if (r.bytes > CEILING) {
      errors.push(
        `::error file=${r.path}::${r.name} is ${r.bytes} bytes, over the ${CEILING}-byte ceiling; GitHub starts no run for a workflow file above ${HARD_LIMIT} bytes.`,
      );
    }
  }
  return { ok: errors.length === 0, lines, errors };
}

/** scan + judge. A scan throw becomes a MEASURE_FAIL naming the directory. */
export function evaluate(dir) {
  let scanned;
  try {
    scanned = scan(dir);
  } catch (err) {
    return {
      ok: false,
      rows: [],
      lines: [],
      errors: [`::error::MEASURE_FAIL: cannot scan ${dir}: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
  const verdict = judge(scanned.rows);
  const skippedLines = scanned.skipped.map((n) => `skipped (not a regular file): ${n}`);
  return { ...verdict, rows: scanned.rows, lines: [...skippedLines, ...verdict.lines] };
}

const ASCII_FILL = "# x\n";

/** A file of exactly `bytes` ASCII bytes. */
function fixture(bytes) {
  const body = ASCII_FILL.repeat(Math.floor(bytes / ASCII_FILL.length));
  return body + "#".repeat(bytes - body.length);
}

/**
 * Prove the gate can fail and can pass, on fixtures at the exact boundary: a
 * 460,801-byte file must go red and a 460,800-byte file must go green, so an
 * off-by-one in the comparison is caught. Returns true on success.
 */
export function selfTest() {
  const roots = [];
  const mk = () => {
    const d = mkdtempSync(join(tmpdir(), "check-workflow-size-"));
    roots.push(d);
    return d;
  };
  const fail = (leg) => {
    process.stdout.write(`SELF-TEST FAIL: ${leg}\n`);
    return false;
  };
  try {
    // Leg 1: over (CEILING + 1) beside an at-ceiling file: red, names over.yml only.
    const d1 = mk();
    writeFileSync(join(d1, "over.yml"), fixture(CEILING + 1));
    writeFileSync(join(d1, "under.yml"), fixture(CEILING));
    const r1 = evaluate(d1);
    const errs1 = r1.errors.filter((e) => e.startsWith("::error file="));
    if (r1.ok || errs1.length !== 1 || !errs1[0].includes("over.yml") || errs1[0].includes("under.yml")) {
      return fail("over-ceiling red (a 460801-byte file must be the only file named)");
    }

    // Leg 2: exactly CEILING alone: green, no annotation of any kind.
    const d2 = mk();
    writeFileSync(join(d2, "at.yml"), fixture(CEILING));
    const r2 = evaluate(d2);
    if (!r2.ok || r2.errors.length !== 0 || r2.lines.some((l) => l.startsWith("::"))) {
      return fail("at-ceiling green (a 460800-byte file must pass with no annotation)");
    }

    // Leg 3: a .yaml over the ceiling is scanned too.
    const d3 = mk();
    writeFileSync(join(d3, "big.yaml"), fixture(CEILING + 1));
    const r3 = evaluate(d3);
    if (r3.ok || !r3.errors.some((e) => e.startsWith("::error file=") && e.includes("big.yaml"))) {
      return fail(".yaml red (a 460801-byte .yaml must be scanned and named)");
    }

    // Leg 4: a directory with no workflow file is a MEASURE_FAIL, never a pass.
    const d4 = mk();
    writeFileSync(join(d4, "notes.md"), "not a workflow\n");
    const r4 = evaluate(d4);
    if (r4.ok || !r4.errors.some((e) => e.includes("MEASURE_FAIL"))) {
      return fail("empty red (no workflow file is a MEASURE_FAIL)");
    }

    // Leg 5: a path that does not exist is a MEASURE_FAIL.
    const missing = join(mk(), "does-not-exist");
    const r5 = evaluate(missing);
    if (r5.ok || !r5.errors.some((e) => e.includes("MEASURE_FAIL"))) {
      return fail("missing dir red (an unreadable directory is a MEASURE_FAIL)");
    }
  } finally {
    for (const d of roots) rmSync(d, { recursive: true, force: true });
  }
  process.stdout.write(
    "check-workflow-size self-test OK: 5 legs (over-ceiling red, at-ceiling green, .yaml red, empty red, missing dir red).\n",
  );
  return true;
}

const USAGE = "usage: node scripts/check-workflow-size.mjs [--self-test | <dir>]";

function main(argv) {
  const flags = argv.filter((a) => a.startsWith("-"));
  const positional = argv.filter((a) => !a.startsWith("-"));
  const selfTestRequested = flags.length === 1 && flags[0] === "--self-test";
  if ((flags.length > 0 && !selfTestRequested) || positional.length > 1 || (selfTestRequested && positional.length > 0)) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  if (selfTestRequested) return selfTest() ? 0 : 1;

  const dir = positional[0] ?? DEFAULT_DIR;
  const result = evaluate(dir);
  const out = [...result.lines, ...result.errors];
  const over = result.errors.filter((e) => e.startsWith("::error file=")).length;
  if (result.ok) {
    const largest = result.rows.reduce((a, b) => (b.bytes > a.bytes ? b : a));
    out.push(
      `workflow-size: OK, ${result.rows.length} file(s) at or under the ${CEILING}-byte ceiling; largest ${largest.name} at ${largest.bytes} bytes.`,
    );
  } else if (over > 0) {
    out.push(`workflow-size: FAIL, ${over} of ${result.rows.length} file(s) over the ${CEILING}-byte ceiling.`);
  } else {
    out.push("workflow-size: FAIL, the scan could not measure any workflow file.");
  }
  process.stdout.write(`${out.join("\n")}\n`);
  return result.ok ? 0 : 1;
}

// Entry guard, the three-way shape of scripts/lint-migration-data-dependence.mjs:
// a module invoked as a program that cannot recognise itself would fall off the end
// and exit 0 having scanned NOTHING, and a workflow step asserting only an exit code
// is satisfied by that. Exit 2, distinct from the red verdict's exit 1, keeps a
// harness fault from reading as a clean tree. Importing the module from a test
// (a different basename) runs nothing.
const samePath = (a, b) => {
  try {
    return realpathSync(a) === realpathSync(b);
  } catch {
    return false;
  }
};
const ENTRY = process.argv[1];
if (ENTRY !== undefined) {
  const selfPath = fileURLToPath(import.meta.url);
  if (resolve(ENTRY) === resolve(selfPath) || samePath(ENTRY, selfPath)) {
    process.exitCode = main(process.argv.slice(2));
  } else if (basename(resolve(ENTRY)) === basename(selfPath)) {
    process.stderr.write(
      [
        `check-workflow-size: REFUSING TO EXIT SILENTLY. This module was invoked as a program ("${basename(selfPath)}" is the entry point's own basename) but the entry point does not resolve to this file, so the CLI never ran and NOTHING was scanned.`,
        `  entry (process.argv[1]): ${ENTRY}`,
        `  this module:             ${selfPath}`,
        "  Exit 0 here would be a gate reporting a clean tree it never opened.",
      ].join("\n") + "\n",
    );
    process.exit(2);
  }
}
