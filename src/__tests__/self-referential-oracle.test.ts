/**
 * Phase 164.3.1 / SC-5 — PRIMITIVE D: the machine check for self-referential
 * oracles.
 *
 * THE CLASS. A control whose own oracle agrees with it BY CONSTRUCTION. The
 * measured live instance is `src/__tests__/lint-sql-gates.test.ts:182-186`
 * ([VAC-SELFREF-01]): a `const` bound to a string literal, asserted three lines
 * later by the same block. That assertion holds whether or not the system under
 * test exists, so it cannot fail when the behaviour it claims to pin changes.
 * SP-C04 (`local-stack-teardown-assertion.test.ts:178`, since removed) was the
 * same shape. Four review rounds closed the EXAMPLE and declared the CLASS
 * closed; this file is the machine that does not need a reviewer to notice.
 *
 * WHY AN AST AND NOT A REGEX. CONTEXT.md D-04 rejects a regex heuristic
 * explicitly: "a line-based reader with quote/comment blind spots is Primitive
 * A's own defect; shipping one to police Primitive D would be a new instance of
 * the family." `typescript` is already a dev dependency (see
 * `src/lib/seam-log-coverage.test.ts:6`, the repo's other AST-walking gate,
 * whose parse/walk shape this file copies). Nothing was installed for this.
 *
 * ── REPORT-ONLY IN THIS PLAN, AND THAT IS DELIBERATE ───────────────────────
 * Plan 164.3.1-02 ships the detector and MEASURES it. It fixes nothing and
 * asserts nothing about the corpus-wide finding count. The ordering is the
 * point: CONTEXT.md D-06 requires the rule to be observed flagging the real
 * `:182-186` instance AT HEAD, BEFORE that site is fixed — "a rule written
 * after the fix and never observed firing on the real instance is unproven."
 * The measurement is committed at
 * `.planning/phases/164.3.1-.../164.3.1-02-CALIBRATION.md`. Plan 164.3.1-08
 * consumes that count, sizes the measured-exception allowlist (D-05: every
 * entry carries its measurement), fixes the `:182-186` site, and flips the
 * corpus scan to blocking.
 *
 * ── WHAT THIS RULE DOES NOT COVER, stated rather than implied ──────────────
 * (RESEARCH anti-pattern 5 — every control states its own bounds, because the
 * failure this phase exists to stop is a control whose scope is assumed wider
 * than it is.)
 *   1. SAME-BLOCK ONLY. Subject resolution searches the statements of the
 *      nearest enclosing block (or the source file's top level) that PRECEDE
 *      the expect's own statement. Nothing else.
 *   2. NO OUTER-SCOPE OR MODULE-LEVEL RESOLUTION. A `const` declared in a
 *      `describe` body, a module-level literal, or an imported constant
 *      asserted inside an `it` is NOT flagged, even though the same vacuity is
 *      available there.
 *   3. NO DATAFLOW THROUGH CALLS, and NO INSPECTION OF THE MATCHER SIDE. A
 *      literal laundered through a helper (`expect(wrap(lit))`) is invisible,
 *      and the matcher's arguments are never examined — only `expect`'s own
 *      argument 0.
 * A subject that is a call into the system under test is out of scope BY
 * DESIGN: that is precisely what makes the green fixture green.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, sep } from "node:path";
import ts from "typescript";

const ROOT = process.cwd();

/** Repo-relative directory holding the rule's red/green fixture pair. */
export const SRO_FIXTURE_DIR = "scripts/self-referential-oracle-fixtures";

/**
 * The EXACT fixture-ID set. Mirrors the `RULES`-registry discipline of
 * `scripts/lint-sql-gates.mjs` (:75-76): adding an ID reds the suite until its
 * pair exists on disk, and dropping a fixture reds it immediately. An unpaired
 * or unregistered fixture fails BY NAME.
 */
export const SRO_FIXTURE_IDS: readonly string[] = ["SRO-01-same-block-const"];

/** Report line prefixes. Exported so plan 164.3.1-08 and the calibration
 *  artifact grep for the same tokens this file prints. */
export const SRO_FINDING_PREFIX = "SELF-REF-ORACLE finding:";
export const SRO_SUMMARY_PREFIX = "SELF-REF-ORACLE report-only summary:";

/** The scanned population. */
const CORPUS_DIR = "src/__tests__";

/**
 * Non-vacuity floor for the corpus walk. MEASURED 127 files under
 * `src/__tests__/**\/*.test.ts` on 2026-09-01 at 4752920d. A broken walker
 * scores 0 and reds here rather than reporting a clean scan of nothing;
 * ordinary churn stays far above 100. (SC-9 measured-threshold convention:
 * thresholds are set by measurement with wide separation, never by taste.)
 */
const CORPUS_FLOOR = 100;

export type SelfRefFinding = {
  file: string;
  expectLine: number;
  subjectName: string | null;
  declLine: number | null;
  kind: "same-block-const" | "inline-literal";
};

/**
 * Parse. Total: `ts.createSourceFile` RECOVERS from malformed input rather than
 * throwing (see the note at `seam-log-coverage.test.ts:1010`). `setParentNodes`
 * is REQUIRED — the enclosing-block walk climbs `node.parent`.
 */
function parseSource(file: string, code: string): ts.SourceFile {
  return ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/**
 * The detector. Pure: takes a name and bytes, returns findings sorted by
 * expectLine. See the header for the three bounds it does not cross.
 */
export function findSelfReferentialExpects(fileName: string, code: string): SelfRefFinding[] {
  // TDD RED — the walk is not implemented yet. The SRO-01 red fixture test
  // below MUST fail against this stub; that failure is the fire proof that the
  // fixture test is bound to the detector and not to its own expectations.
  void fileName;
  void code;
  return [];
}

/**
 * Every `*.test.ts` under `src/__tests__`, repo-relative, sorted.
 *
 * Reads through `node:fs`, never shell `grep`: this repo has a MEASURED
 * grep-blind file (`src/lib/wizardErrors.test.ts` carries a deliberate NUL
 * byte, and `grep`'s exit 1 there reads as "clean"). That file is outside this
 * population, but the property is kept anyway — a scanner that can be
 * silently blinded is the defect this phase is closing.
 */
export function listCorpusFiles(): string[] {
  const entries = readdirSync(join(ROOT, CORPUS_DIR), { recursive: true }) as string[];
  return entries
    .filter((name) => name.endsWith(".test.ts"))
    .map((name) => `${CORPUS_DIR}/${name.split(sep).join("/")}`)
    .sort();
}

/** One report line per finding, in the shape the calibration artifact quotes. */
export function formatFinding(f: SelfRefFinding): string {
  const subject = f.subjectName === null ? "<literal>" : f.subjectName;
  const decl = f.declLine === null ? "-" : String(f.declLine);
  return `${SRO_FINDING_PREFIX} ${f.file}:${f.expectLine} expect(${subject}) — ${f.kind} declared :${decl}`;
}

function fixturePath(id: string, side: "red" | "green"): string {
  return join(ROOT, SRO_FIXTURE_DIR, `${id}.${side}.ts`);
}

function readFixture(id: string, side: "red" | "green"): string {
  return readFileSync(fixturePath(id, side), "utf8");
}

describe("primitive D — self-referential oracle detector", () => {
  it("SRO-01 red fixture is flagged", () => {
    const relPath = `${SRO_FIXTURE_DIR}/SRO-01-same-block-const.red.ts`;
    const findings = findSelfReferentialExpects(relPath, readFixture("SRO-01-same-block-const", "red"));
    const sameBlock = findings.filter((f) => f.kind === "same-block-const");

    expect(
      sameBlock,
      `the rule must flag the shape modelled on the live :182-186 instance; findings were ${JSON.stringify(findings)}`,
    ).not.toHaveLength(0);

    const hit = sameBlock[0];
    expect(hit.subjectName, "the flagged subject must be the fixture's const").toBe("banner");
    expect(hit.declLine, "the declaration line must resolve").not.toBeNull();
    expect(hit.expectLine, "the expect line must resolve").toBeGreaterThan(0);
    expect(
      hit.declLine as number,
      "the const must be reported as declared BEFORE the assertion that reads it",
    ).toBeLessThan(hit.expectLine);
  });

  it("SRO-01 green fixture is clean", () => {
    const relPath = `${SRO_FIXTURE_DIR}/SRO-01-same-block-const.green.ts`;
    const findings = findSelfReferentialExpects(relPath, readFixture("SRO-01-same-block-const", "green"));
    expect(
      findings,
      `the repaired idiom must pass — a rule that flags it would flag every honest assertion; findings were ${JSON.stringify(findings)}`,
    ).toHaveLength(0);
  });

  it("fixture-ID set is pinned exactly", () => {
    const onDisk = readdirSync(join(ROOT, SRO_FIXTURE_DIR));
    const red = onDisk.filter((n) => n.endsWith(".red.ts")).map((n) => n.replace(/\.red\.ts$/, ""));
    const green = onDisk.filter((n) => n.endsWith(".green.ts")).map((n) => n.replace(/\.green\.ts$/, ""));
    const expected = [...SRO_FIXTURE_IDS].sort();

    expect(
      red.sort(),
      "every registered fixture ID must have a RED member, and no unregistered red fixture may sit in the directory",
    ).toEqual(expected);
    expect(
      green.sort(),
      "every registered fixture ID must have a GREEN member, and no unregistered green fixture may sit in the directory",
    ).toEqual(expected);

    const stray = onDisk.filter((n) => !n.endsWith(".red.ts") && !n.endsWith(".green.ts"));
    expect(stray, "the fixture directory holds pairs and nothing else").toEqual([]);
  });

  it("report-only corpus scan over src/__tests__", () => {
    const files = listCorpusFiles();

    expect(
      files.length,
      `the corpus walker returned ${files.length} files; 127 were measured on 2026-09-01 at 4752920d, so anything under ${CORPUS_FLOOR} means the walk broke rather than the corpus shrank`,
    ).toBeGreaterThanOrEqual(CORPUS_FLOOR);

    const findings: SelfRefFinding[] = [];
    for (const rel of files) {
      const code = readFileSync(join(ROOT, rel), "utf8");
      findings.push(...findSelfReferentialExpects(rel, code));
    }
    findings.sort((a, b) => (a.file === b.file ? a.expectLine - b.expectLine : a.file < b.file ? -1 : 1));

    for (const f of findings) console.log(formatFinding(f));
    const affected = new Set(findings.map((f) => f.file));
    console.log(
      `${SRO_SUMMARY_PREFIX} ${findings.length} finding(s) in ${affected.size} file(s), ${files.length} file(s) scanned`,
    );

    // REPORT-ONLY BY PHASE DESIGN — there is deliberately NO assertion on the
    // finding count here. Plan 164.3.1-08 flips this to blocking against the
    // measured allowlist. Only finding SHAPE is checked, so a detector emitting
    // unusable records still reds.
    const malformed = findings.filter((f) => !f.file || !Number.isInteger(f.expectLine) || f.expectLine < 1);
    expect(malformed, "every finding must carry a file and a 1-based expect line").toEqual([]);
  });
});
