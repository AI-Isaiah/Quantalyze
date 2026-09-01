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
 * True when `node`'s subtree contains no `Identifier`, call, or member access —
 * that is, nothing through which a value could have reached the system under
 * test. A template qualifies only if every one of its span expressions does,
 * which the generic walk gives us for free.
 */
function isLiteralOnly(node: ts.Node): boolean {
  let literal = true;
  const walk = (n: ts.Node): void => {
    if (!literal) return;
    if (
      ts.isIdentifier(n) ||
      ts.isCallExpression(n) ||
      ts.isPropertyAccessExpression(n) ||
      ts.isElementAccessExpression(n)
    ) {
      literal = false;
      return;
    }
    ts.forEachChild(n, walk);
  };
  walk(node);
  return literal;
}

type Container = ts.Block | ts.SourceFile;

/**
 * The statement that owns `node`, plus the block that owns THAT statement.
 * Climbs `parent` (hence `setParentNodes`) and proves statement-hood by
 * MEMBERSHIP in the container's own statement list rather than by a kind
 * predicate — membership is what the preceding-statements scan actually needs.
 */
function enclosingStatement(node: ts.Node): { stmt: ts.Statement; container: Container } | null {
  let cur: ts.Node = node;
  while (cur.parent) {
    const parent = cur.parent;
    if (ts.isBlock(parent) || ts.isSourceFile(parent)) {
      const container = parent as Container;
      if (container.statements.indexOf(cur as ts.Statement) >= 0) {
        return { stmt: cur as ts.Statement, container };
      }
    }
    cur = parent;
  }
  return null;
}

/**
 * Line of the `const <subject> = <literal-only>` binding in the SAME block, or
 * null. Scans BACKWARDS from the expect's own statement so the nearest
 * shadowing declaration wins; if that nearest binding is not literal-only the
 * subject is considered reachable from the system under test and nothing is
 * reported, even if an earlier literal of the same name exists.
 */
function resolveSameBlockLiteralConst(
  subject: ts.Identifier,
  expectCall: ts.Node,
  source: ts.SourceFile,
): number | null {
  const owned = enclosingStatement(expectCall);
  if (owned === null) return null;
  const statements = owned.container.statements;
  const stop = statements.indexOf(owned.stmt);
  for (let i = stop - 1; i >= 0; i--) {
    const statement = statements[i];
    if (!ts.isVariableStatement(statement)) continue;
    if ((statement.declarationList.flags & ts.NodeFlags.Const) === 0) continue;
    for (const decl of statement.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || decl.name.text !== subject.text) continue;
      if (decl.initializer === undefined || !isLiteralOnly(decl.initializer)) return null;
      return source.getLineAndCharacterOfPosition(decl.name.getStart(source)).line + 1;
    }
  }
  return null;
}

/**
 * The detector. Pure: takes a name and bytes, returns findings sorted by
 * expectLine. See the header for the three bounds it does not cross.
 *
 * The SUBJECT is `expect`'s argument 0 — this repo uses the two-argument
 * `expect(subject, message)` form widely, and the message is deliberately
 * ignored. The matcher side is never examined.
 */
export function findSelfReferentialExpects(fileName: string, code: string): SelfRefFinding[] {
  const source = parseSource(fileName, code);
  const findings: SelfRefFinding[] = [];
  const lineOf = (n: ts.Node): number =>
    source.getLineAndCharacterOfPosition(n.getStart(source)).line + 1;

  const walk = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "expect" &&
      node.arguments.length > 0
    ) {
      const subject = node.arguments[0];
      const expectLine = lineOf(node);

      if (
        ts.isStringLiteral(subject) ||
        ts.isNoSubstitutionTemplateLiteral(subject) ||
        ts.isNumericLiteral(subject)
      ) {
        findings.push({
          file: fileName,
          expectLine,
          subjectName: null,
          declLine: null,
          kind: "inline-literal",
        });
      } else if (ts.isIdentifier(subject)) {
        const declLine = resolveSameBlockLiteralConst(subject, node, source);
        if (declLine !== null) {
          findings.push({
            file: fileName,
            expectLine,
            subjectName: subject.text,
            declLine,
            kind: "same-block-const",
          });
        }
      }
    }
    ts.forEachChild(node, walk);
  };

  ts.forEachChild(source, walk);
  findings.sort((a, b) => a.expectLine - b.expectLine);
  return findings;
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

/**
 * Bare `expect(...)` call sites in `code`. The fixture tests' VACUITY FENCE.
 *
 * MEASURED THIS SESSION, and the reason this function exists: the first draft
 * of both fixtures carried the glob `**` + `/*.ts` inside their JSDoc banner.
 * The `*` + `/` in the middle of that glob TERMINATES the block comment, so the
 * remaining prose parsed as code — `ts.createSourceFile` recovers rather than
 * throwing (`seam-log-coverage.test.ts:1010`), and it returned a tree of
 * nonsense `BinaryExpression`s containing NO call expressions at all. The red
 * fixture test caught it, because it asserts a POSITIVE. The green fixture test
 * did not: it asserts an ABSENCE, and an absence is satisfied perfectly by a
 * corrupted parse. "Green fixture is clean" would have read as proof while
 * inspecting rubble — a self-referential oracle inside the self-referential
 * oracle detector. Counting the fixture's `expect` sites is what makes the
 * green assertion bind to the fixture's real contents.
 */
export function countExpectCallSites(fileName: string, code: string): number {
  const source = parseSource(fileName, code);
  let sites = 0;
  const walk = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "expect") {
      sites += 1;
    }
    ts.forEachChild(node, walk);
  };
  ts.forEachChild(source, walk);
  return sites;
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

  it("SRO-01 green fixture is clean, and is really being read", () => {
    const relPath = `${SRO_FIXTURE_DIR}/SRO-01-same-block-const.green.ts`;
    const code = readFixture("SRO-01-same-block-const", "green");

    // VACUITY FENCE FIRST — see countExpectCallSites. An absence proves nothing
    // until we know the parse found the assertions it is an absence of.
    expect(
      countExpectCallSites(relPath, code),
      "the green fixture must parse to at least one real expect() site; zero means the fixture was corrupted (a stray comment terminator) and the emptiness below would be rubble, not cleanliness",
    ).toBeGreaterThanOrEqual(1);

    const findings = findSelfReferentialExpects(relPath, code);
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

    // ⚠️ WRITTEN TO stdout DIRECTLY, NOT VIA `console.log`. MEASURED this
    // session: vitest 4.1.10's DEFAULT reporter swallows console output from
    // PASSING tests, so a report-only gate that logs its findings prints
    // nothing on a green run — the report would exist only in the source. A
    // raw `process.stdout.write` is not intercepted, so the bare
    // `vitest run <file>` command records the measurement. (`--reporter=verbose`
    // and `--disable-console-intercept` also surface console output, but a gate
    // whose evidence depends on the caller remembering a flag is one flag away
    // from being evidence of nothing.)
    const report = findings.map((f) => `${formatFinding(f)}\n`).join("");
    const affected = new Set(findings.map((f) => f.file));
    process.stdout.write(
      `${report}${SRO_SUMMARY_PREFIX} ${findings.length} finding(s) in ${affected.size} file(s), ${files.length} file(s) scanned\n`,
    );

    // REPORT-ONLY BY PHASE DESIGN — there is deliberately NO assertion on the
    // finding count here. Plan 164.3.1-08 flips this to blocking against the
    // measured allowlist. Only finding SHAPE is checked, so a detector emitting
    // unusable records still reds.
    const malformed = findings.filter((f) => !f.file || !Number.isInteger(f.expectLine) || f.expectLine < 1);
    expect(malformed, "every finding must carry a file and a 1-based expect line").toEqual([]);
  });
});
