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
 * ── BLOCKING SINCE PLAN 164.3.1-08 (was report-only in 164.3.1-02) ─────────
 * Plan 164.3.1-02 shipped the detector and MEASURED it, asserting nothing about
 * the corpus-wide finding count. The ordering was the point: CONTEXT.md D-06
 * requires the rule to be observed flagging the real `:182-186` instance AT
 * HEAD, BEFORE that site is fixed — "a rule written after the fix and never
 * observed firing on the real instance is unproven." That measurement is
 * committed at `.planning/phases/164.3.1-.../164.3.1-02-CALIBRATION.md` § II.
 *
 * Plan 164.3.1-08 consumed it: the `:182-186` site is FIXED, the corpus scan is
 * EXACT-SET BLOCKING against `SRO_ALLOWLIST` below (D-05: every entry carries
 * the measurement that justifies it), and one measured imprecision was closed
 * rather than allowlisted — see the next block, which is the honest record of a
 * detector change made AFTER a count was seen.
 *
 * ── THE MUTATION NARROWING, AND WHY IT IS NOT COUNT-TUNING ─────────────────
 * The 164.3.1-02 calibration measured 23 findings / 14 files / 128 scanned and
 * then SPLIT them by re-reading the flagged sites (§ III.a): 19 of 23 were ONE
 * shared shape — `const offenders: string[] = []` → a loop `push`es →
 * `expect(offenders).toEqual([])`. Those assertions were MEASURED able to fail.
 * They are not Primitive-D instances; they are this detector's own dominant
 * imprecision, recorded there as non-coverage bound 4 ("NO MUTATION
 * MODELLING"). The calibration deliberately declined to narrow the rule and
 * handed plan 08 the choice, ranking narrow-then-re-measure ABOVE allowlisting
 * the 19.
 *
 * Plan 08 narrowed. The reasoning, recorded because "tune the detector until
 * the number is comfortable" is exactly the move this phase distrusts:
 *   * The change is justified INDEPENDENTLY of the count. A binding mutated
 *     between its declaration and the assertion that reads it is not a
 *     constant, so the premise the finding rests on is false at those sites.
 *   * Allowlisting them would mean 19 entries whose justification reads "the
 *     detector is wrong here". Under D-05 an allowlist entry records a MEASURED
 *     EXCEPTION, not a known detector bug; recording a bug as a permanent
 *     exception is how a gate becomes ceremony.
 *   * The accumulator idiom is the repo's dominant HONEST gate-test shape (12
 *     of the 14 flagged files). A blocking gate that reds on it would be waived
 *     by reflex — a control routinely waived is a control that cannot fail.
 *   * The narrowing LOSES NO ENFORCEMENT relative to allowlisting: both leave
 *     those sites unflagged. It only generalises to sites not yet written.
 * The compensating controls the calibration demanded were all performed and are
 * recorded in `164.3.1-08-SUMMARY.md`: the corpus was RE-MEASURED after the
 * change (before and after the `:182-186` fix), the SRO-02 fixture pair below
 * pins the narrowing in BOTH directions so it cannot silently widen back, and
 * the fire proof was RE-RUN against the narrowed, blocking rule.
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
 *   4. ANY METHOD CALL ON THE BINDING COUNTS AS MUTATION. `isMutatedBetween`
 *      cannot tell `offenders.push(x)` from `offenders.join(",")` without type
 *      information, so it treats every method call on the binding as mutation
 *      and declines to report. That is deliberate: for a BLOCKING gate the
 *      conservative direction is to miss rather than to red on honest code, and
 *      the alternative — a hardcoded list of mutator NAMES — would be silently
 *      wrong for any custom mutator, which is a false attestation rather than a
 *      stated miss. (Bound 4 in the 02 calibration was "no mutation modelling
 *      at all"; this is its replacement, narrower and stated.)
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
export const SRO_FIXTURE_IDS: readonly string[] = [
  "SRO-01-same-block-const",
  "SRO-02-mutated-binding",
];

/** Report line prefixes. Exported so plan 164.3.1-08 and the calibration
 *  artifact grep for the same tokens this file prints. */
export const SRO_FINDING_PREFIX = "SELF-REF-ORACLE finding:";
export const SRO_SUMMARY_PREFIX = "SELF-REF-ORACLE blocking summary:";

/** The scanned population. */
const CORPUS_DIR = "src/__tests__";

/**
 * Non-vacuity floor for the corpus walk. MEASURED 127 files under
 * `src/__tests__/**\/*.test.ts` on 2026-09-01 at 4752920d, 128 at 807702ff
 * (the 164.3.1-02 calibration run), and 130 at 420b8fcb (the 164.3.1-08 run
 * that flipped this gate blocking — Wave-1 siblings added two). A broken walker
 * scores 0 and reds here rather than reporting a clean scan of nothing;
 * ordinary churn stays far above 100. (SC-9 measured-threshold convention:
 * thresholds are set by measurement with wide separation, never by taste — the
 * floor is deliberately NOT ratcheted to 130, because a floor pinned at the
 * measurement reds on every legitimate test deletion and gets raised by reflex.)
 */
const CORPUS_FLOOR = 100;

/**
 * THE MEASURED-EXCEPTION ALLOWLIST (CONTEXT.md D-05). The corpus scan below is
 * EXACT against this set in BOTH directions: a finding that is not here fails by
 * name, and an entry no longer found fails by name too.
 *
 * ⛔ EVERY ENTRY CARRIES THE MEASUREMENT THAT JUSTIFIES IT. D-05 is literal
 * about this — "an unexplained entry is itself a primitive-D instance" — because
 * an allowlist of bare file names is a control whose exceptions cannot be
 * audited. `reason` states what was measured; `measured` cites where.
 *
 * KEYED ON `file + subjectName + kind`, NEVER ON THE LINE NUMBER. This mirrors
 * `audit-coverage.test.ts:1488-1495`'s hard-won record: its sites moved
 * 403 -> 489 and 518 -> 620 under unrelated edits, and a key that decays on
 * every insertion above it trains people to RE-NUMBER the record rather than
 * RE-MEASURE it, preserving whatever errors it already held.
 *
 * ── SIZING, AND ITS ARITHMETIC (plan 164.3.1-08) ───────────────────────────
 * `164.3.1-02-CALIBRATION.md` § III recorded 23 findings / 14 files / 128
 * scanned at HEAD before any fix, and § III.a split them by re-reading the
 * flagged sites. This list is that record, minus what was disposed of:
 *
 *     23  recorded findings at HEAD (calibration § III)
 *   − 19  MEASURED false positives — the accumulator idiom, mutated between
 *         declaration and assertion, so able to fail. NOT allowlisted: the
 *         detector was narrowed instead (see the header). Re-measured after the
 *         narrowing and before the site fix: 23 -> 4, and the 4 survivors were
 *         exactly the two classes § III.a called TRUE POSITIVE, which is an
 *         independent confirmation of that split.
 *   −  2  FIXED, not excepted — [VAC-SELFREF-01] at
 *         `lint-sql-gates.test.ts:183` and `:184`, the calibration target.
 *   =  2  entries below.
 *
 * Re-measured after both dispositions on 2026-09-01 with
 * `npx vitest run src/__tests__/self-referential-oracle.test.ts`:
 * "2 finding(s) in 1 file(s), 130 file(s) scanned".
 */
export const SRO_ALLOWLIST: ReadonlyArray<{
  file: string;
  subjectName: string;
  kind: SelfRefFinding["kind"];
  reason: string;
  measured: string;
}> = [
  {
    file: "src/__tests__/types-design-tests.test.ts",
    subjectName: "empty",
    kind: "same-block-const",
    reason:
      "TRUE POSITIVE at runtime, and deliberately so. `const empty: LazyMetricsPayload = {}` then `expect(empty).toEqual({})` cannot fail when vitest runs it — the real assertion is the TYPE ANNOTATION, checked by `tsc --noEmit`, which is where this contract actually binds: the arm reds if `LazyMetricsPayload` stops accepting an empty map (the Partial<Record<…>> bug it was written for). The vitest arm is the annotation's carrier, not its oracle. Allowlisted rather than converted to `satisfies` because `types-design-tests.test.ts` is outside plan 164.3.1-08's declared file set; conversion is a candidate for the plan 164.3.1-12 corpus pass.",
    measured:
      "164.3.1-02-CALIBRATION.md § III (finding `types-design-tests.test.ts:27 expect(empty)`) and § III.a row 'Type-level contract' (2 findings / 1 file, classed TRUE POSITIVE at runtime by reading the site). Re-confirmed present 2026-09-01 after the mutation narrowing.",
  },
  {
    file: "src/__tests__/types-design-tests.test.ts",
    subjectName: "_kinds",
    kind: "same-block-const",
    reason:
      "TRUE POSITIVE at runtime, same mechanism. `const _kinds: StrategyAnalyticsSeriesKind[] = [ …12 string literals ]` then `expect(_kinds).toHaveLength(12)` counts the literals the block itself just wrote. What binds is the annotation: `tsc` reds if any of the 12 stops being a member of `StrategyAnalyticsSeriesKind`. Same disposition and same 164.3.1-12 candidacy as the entry above.",
    measured:
      "164.3.1-02-CALIBRATION.md § III (finding `types-design-tests.test.ts:63 expect(_kinds)`) and § III.a row 'Type-level contract'. Re-confirmed present 2026-09-01 after the mutation narrowing.",
  },
];

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
 * The identifier a member chain is rooted at: `x` for `x`, `x.y`, `x[i].z`.
 * Anything not rooted at a bare identifier (a call result, a literal) is null.
 */
function rootIdentifier(node: ts.Expression): ts.Identifier | null {
  let cur: ts.Node = node;
  while (ts.isPropertyAccessExpression(cur) || ts.isElementAccessExpression(cur)) {
    cur = cur.expression;
  }
  return ts.isIdentifier(cur) ? cur : null;
}

const ASSIGNMENT_OPERATORS: ReadonlySet<ts.SyntaxKind> = new Set([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/**
 * True when `subjectName` is MUTATED by any statement strictly between its
 * declaration and the statement holding the assertion.
 *
 * THE POINT (calibration § III.a). `const offenders: string[] = []` has a
 * literal-only initializer, but a loop that `push`es into it means the value at
 * assertion time was PRODUCED BY THE SYSTEM UNDER TEST. `expect(offenders)`
 * there can fail; it is not a self-referential oracle, and 19 of the 23 findings
 * measured at HEAD on 2026-09-01 were exactly this shape. Reporting them would
 * make the blocking gate red on the repo's dominant honest idiom.
 *
 * Direct mutation evidence only — the binding must itself be the receiver or the
 * assignment target. The subject merely APPEARING as a call argument
 * (`JSON.stringify(subject)` in an assertion message, or an earlier
 * `expect(subject)` on the same const) is deliberately NOT mutation: counting it
 * would have suppressed `:184` of the calibration target, whose only
 * intervening statement is the `expect` at `:183`.
 *
 * See non-coverage bound 4 in the file header for what this deliberately misses.
 */
export function isMutatedBetween(
  subjectName: string,
  statements: readonly ts.Statement[],
  declIndex: number,
  expectIndex: number,
): boolean {
  let mutated = false;

  const visit = (n: ts.Node): void => {
    if (mutated) return;

    // `subject.push(x)`, `subject.set(k, v)`, `subject[k]()` — a method call
    // whose receiver chain is rooted at the binding.
    if (
      ts.isCallExpression(n) &&
      (ts.isPropertyAccessExpression(n.expression) || ts.isElementAccessExpression(n.expression))
    ) {
      const root = rootIdentifier(n.expression);
      if (root !== null && root.text === subjectName) {
        mutated = true;
        return;
      }
    }

    // `subject.k = v`, `subject[i] = v` (`subject = v` cannot occur on a const).
    if (ts.isBinaryExpression(n) && ASSIGNMENT_OPERATORS.has(n.operatorToken.kind)) {
      const root = rootIdentifier(n.left);
      if (root !== null && root.text === subjectName) {
        mutated = true;
        return;
      }
    }

    // `delete subject.k`
    if (ts.isDeleteExpression(n)) {
      const root = rootIdentifier(n.expression);
      if (root !== null && root.text === subjectName) {
        mutated = true;
        return;
      }
    }

    ts.forEachChild(n, visit);
  };

  for (let i = declIndex + 1; i < expectIndex; i++) visit(statements[i]);
  return mutated;
}

/**
 * Line of the `const <subject> = <literal-only>` binding in the SAME block that
 * is STILL literal-valued at the assertion, or null. Scans BACKWARDS from the
 * expect's own statement so the nearest shadowing declaration wins; if that
 * nearest binding is not literal-only the subject is considered reachable from
 * the system under test and nothing is reported, even if an earlier literal of
 * the same name exists. A binding mutated on the way to the assertion
 * (`isMutatedBetween`) is likewise not reported — it is no longer a constant.
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
      if (isMutatedBetween(subject.text, statements, i, stop)) return null;
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

/**
 * The allowlist identity key: file + subject + kind, NEVER the line number.
 * Shared by the findings and the allowlist so the two sets are comparable.
 */
export function findingKey(f: {
  file: string;
  subjectName: string | null;
  kind: SelfRefFinding["kind"];
}): string {
  return `${f.file}::${f.subjectName ?? "<literal>"}::${f.kind}`;
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

  // ── SRO-02: the mutation narrowing, pinned in BOTH directions ───────────
  // Plan 164.3.1-08 narrowed the detector AFTER seeing a corpus count. These
  // two arms are what stop that narrowing drifting: widen it and the red
  // fixture stops being flagged; revert or break it and the green fixture
  // starts being flagged. Either way an arm reds by name.
  it("SRO-02 red fixture — an INERT collection const is still flagged", () => {
    const relPath = `${SRO_FIXTURE_DIR}/SRO-02-mutated-binding.red.ts`;
    const code = readFixture("SRO-02-mutated-binding", "red");
    const findings = findSelfReferentialExpects(relPath, code);
    const sameBlock = findings.filter((f) => f.kind === "same-block-const");

    expect(
      sameBlock.map((f) => f.subjectName),
      `an array const that is never mutated is still a constant, so the assertion reading it is still true by construction; if this arm is empty the mutation narrowing has been widened past "mutated" into "collection-shaped" or "merely mentioned". Findings were ${JSON.stringify(findings)}`,
    ).toContain("offenders");
  });

  it("SRO-02 green fixture — the accumulator idiom passes, and is really being read", () => {
    const relPath = `${SRO_FIXTURE_DIR}/SRO-02-mutated-binding.green.ts`;
    const code = readFixture("SRO-02-mutated-binding", "green");

    // VACUITY FENCE FIRST — the SRO-01 green arm's hard-won lesson (see
    // countExpectCallSites). An absence proves nothing until the parse is known
    // to have found the assertions it is an absence of.
    expect(
      countExpectCallSites(relPath, code),
      "the green fixture must parse to at least one real expect() site; zero means the fixture was corrupted and the emptiness below would be rubble, not cleanliness",
    ).toBeGreaterThanOrEqual(1);

    const findings = findSelfReferentialExpects(relPath, code);
    expect(
      findings,
      `a binding filled by the scan it reports on CAN fail and is not primitive D; flagging it would red the repo's dominant honest gate-test idiom (19 of 23 findings at HEAD, calibration § III.a). Findings were ${JSON.stringify(findings)}`,
    ).toHaveLength(0);
  });

  it("BLOCKING corpus scan over src/__tests__ — exact against SRO_ALLOWLIST", () => {
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

    // Shape first: a detector emitting unusable records must red here rather
    // than pass the set comparison below on garbage keys.
    const malformed = findings.filter((f) => !f.file || !Number.isInteger(f.expectLine) || f.expectLine < 1);
    expect(malformed, "every finding must carry a file and a 1-based expect line").toEqual([]);

    // ── BLOCKING, EXACT, BOTH DIRECTIONS (D-05) ──────────────────────────
    // The discipline is `audit-coverage.test.ts:1625-1650`'s: a new finding
    // fails by name with instructions that do NOT include "add it to the
    // allowlist", and a discharged entry fails by name too, so the exception
    // list can only shrink silently — never grow.
    const allowKeys = new Set(SRO_ALLOWLIST.map(findingKey));
    const foundKeys = new Set(findings.map(findingKey));

    const unexplained = findings.filter((f) => !allowKeys.has(findingKey(f)));
    if (unexplained.length > 0) {
      const formatted = unexplained.map((f) => `  ${formatFinding(f)}`).join("\n");
      throw new Error(
        `Found ${unexplained.length} self-referential oracle(s) NOT in SRO_ALLOWLIST:\n${formatted}\n\n` +
          "Each flagged assertion reads a `const` bound to a literal in its OWN block, so it\n" +
          "holds whether or not the system under test exists — it cannot fail when the behaviour\n" +
          "it claims to pin changes. FIX IT: bind the subject to something the system under test\n" +
          "produced (read the real artifact, call the real function) and assert what is true of\n" +
          "those bytes. `scripts/self-referential-oracle-fixtures/SRO-01-same-block-const.green.ts`\n" +
          "is the repaired idiom, one line long.\n" +
          "\n" +
          "⛔ Do NOT add the site to SRO_ALLOWLIST to silence this. That list holds MEASURED\n" +
          "exceptions only, each carrying the measurement that justifies it (CONTEXT.md D-05:\n" +
          "an unexplained entry is itself a primitive-D instance). A newly written\n" +
          "self-referential oracle is the exact thing this gate exists to stop — four review\n" +
          "rounds closed the example and declared the class closed before this machine existed.",
      );
    }

    const discharged = SRO_ALLOWLIST.filter((a) => !foundKeys.has(findingKey(a)));
    if (discharged.length > 0) {
      const formatted = discharged
        .map((a) => `  ${a.file} :: ${a.subjectName} :: ${a.kind}\n    (${a.reason})`)
        .join("\n");
      throw new Error(
        `${discharged.length} SRO_ALLOWLIST entr(y/ies) are no longer flagged:\n${formatted}\n\n` +
          "Good news — the debt shrank, or the detector moved. Establish WHICH before editing:\n" +
          "  * the site was fixed  -> DELETE the entry, and update the arithmetic in the\n" +
          "    SRO_ALLOWLIST header so the sizing still reconciles against the calibration;\n" +
          "  * the detector stopped seeing it -> that is a REGRESSION in the rule, not a\n" +
          "    discharge. Re-run the fire proof before touching this list.\n" +
          "A stale entry is not harmless: it overstates the rule's coverage, which is the\n" +
          "false-attestation shape this phase exists to close.",
      );
    }
  });
});
