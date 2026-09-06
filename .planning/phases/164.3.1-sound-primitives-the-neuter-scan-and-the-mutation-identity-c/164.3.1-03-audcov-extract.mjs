#!/usr/bin/env node
/**
 * [AUDCOV-01] calibration instrument — extract-and-run, VERDICT-FREE.
 *
 * WHAT IT EXTRACTS, FROM WHERE
 * ----------------------------
 * It reads `src/__tests__/audit-coverage.test.ts` (resolved from THIS script's
 * own location, three directories up, so the measured subject is always the
 * checkout the instrument lives in — never a cwd accident), parses it with the
 * TypeScript compiler API, and lifts the source text of exactly six TOP-LEVEL
 * declarations by name:
 *
 *   MUTATOR_CALL_RE, FROM_CALL_RE        (const declarations)
 *   unmatchedBlockOpen, stripBlockComments, stripLineComment, findMutations
 *
 * Those extracted bytes are transpiled and evaluated in a `node:vm` context,
 * and the REAL `findMutations` is driven over three fixtures. Nothing here
 * reimplements any of the six — a retyped approximation would calibrate a
 * subject that is not the one shipping on main, which is itself the
 * measure-the-wrong-thing failure this phase exists to close. If ANY of the
 * six cannot be located the script prints the missing name(s) and exits 1.
 * There is deliberately no fallback path.
 *
 * The file is never imported dynamically (its vitest imports would execute)
 * and never written.
 *
 * THE THREE CASES
 * ---------------
 *   A — multi-line template literal whose continuation line carries `/*`,
 *       with a real same-line-anchored mutation below it. At pre-fix HEAD
 *       `unmatchedBlockOpen`'s quote state is per-line and is discarded at
 *       every newline, so line 3 reads its `/*` outside any quote, opens a
 *       phantom block, and `stripBlockComments` blanks everything below.
 *   B — CALIBRATION CONTROL: byte-identical to A except line 3 drops the
 *       `/*` opener. No phantom block can open, so the mutation survives.
 *       B is what makes "A now finds its site" falsifiable — a stripper that
 *       returned every line would also make A pass.
 *   C — the shipped SP-I01 single-line-template arm's input shape
 *       (`src/__tests__/audit-coverage.test.ts:1166-1174`), reduced to the
 *       backtick line. Its quote pair opens and closes within one line, so
 *       the interior `/*` is correctly seen as quoted.
 *
 * WHY IT IS VERDICT-FREE
 * ----------------------
 * This script asserts NOTHING and bakes in NO expected site values. It exits 0
 * whenever extraction and evaluation succeed, whatever the sites turn out to
 * be. Expectations live in the verify gates of plan 164.3.1-03 (the pre-fix
 * "before" leg) and plan 164.3.1-06 (the post-fix "after" leg), not in the
 * instrument. That is the point: plan 164.3.1-06 owns the quote-carry fix and
 * re-runs THIS SAME FILE, UNEDITED, to produce its "after" column. An
 * instrument carrying baked-in before-values would have to be edited between
 * the two legs, and a before/after comparison across two different
 * instruments measures the instruments, not the fix.
 *
 * Output is diagnostic-first (house standard): per case, the numbered input
 * and the full mutations JSON, then one machine-greppable summary line:
 *
 *   AUDCOV-CAL A=<sites> B=<sites> C=<sites>
 *
 * Usage (from anywhere; the repo root is the documented invocation):
 *   node .planning/phases/164.3.1-sound-primitives-the-neuter-scan-and-the-mutation-identity-c/164.3.1-03-audcov-extract.mjs
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import ts from "typescript";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
// .planning/phases/<phase>/  ->  repo root
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..", "..", "..");
const SUBJECT_REL = path.join("src", "__tests__", "audit-coverage.test.ts");
const SUBJECT_ABS = path.join(REPO_ROOT, SUBJECT_REL);

/** The six declarations that must be lifted from the subject's own bytes. */
const REQUIRED_FUNCTIONS = [
  "unmatchedBlockOpen",
  "stripBlockComments",
  "stripLineComment",
  "findMutations",
];
const REQUIRED_CONSTS = ["MUTATOR_CALL_RE", "FROM_CALL_RE"];

/**
 * Lift the source text of the six named top-level declarations.
 * Fails loud (exit 1, naming the misses) rather than approximating.
 */
function extractDeclarations(filePath, source) {
  // NUL-safe by construction: readFileSync + the compiler API, no grep.
  const sourceFile = ts.createSourceFile(
    filePath,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const found = new Map();

  for (const stmt of sourceFile.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && REQUIRED_FUNCTIONS.includes(stmt.name.text)) {
      found.set(stmt.name.text, stmt.getText(sourceFile));
      continue;
    }
    if (ts.isVariableStatement(stmt)) {
      const first = stmt.declarationList.declarations[0];
      if (first && ts.isIdentifier(first.name) && REQUIRED_CONSTS.includes(first.name.text)) {
        found.set(first.name.text, stmt.getText(sourceFile));
      }
    }
  }

  const wanted = [...REQUIRED_CONSTS, ...REQUIRED_FUNCTIONS];
  const missing = wanted.filter((name) => !found.has(name));
  if (missing.length > 0) {
    console.error(
      `FATAL: could not locate ${missing.length} of ${wanted.length} required top-level ` +
        `declaration(s) in ${SUBJECT_REL}: ${missing.join(", ")}`,
    );
    console.error(
      "The subject file has moved or been restructured. This instrument refuses to " +
        "substitute an inline approximation — calibrating a retyped copy would measure " +
        "a subject that is not the one shipping.",
    );
    process.exit(1);
  }

  // Declaration order is irrelevant: function declarations hoist, and the two
  // consts are only read when findMutations is CALLED, after evaluation.
  return wanted.map((name) => found.get(name));
}

/** Transpile the extracted TS and evaluate it in an empty vm context. */
function evaluateExtracted(declarationTexts) {
  const snippet = declarationTexts.join("\n\n");
  const transpiled = ts.transpileModule(snippet, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;

  const context = vm.createContext({});
  // Trailing expression is the script's completion value.
  return vm.runInContext(`${transpiled}\n;({ findMutations })`, context, {
    filename: "audcov-extracted.js",
  });
}

// --- The three fixtures. Multi-line REAL-shape bytes, joined with "\n". ------

// A — the [AUDCOV-01] blindness: `/*` on a continuation line INSIDE a
// multi-line template literal, real mutation on line 5.
const CASE_A_LINES = [
  "export async function POST() {",
  "  const tpl = `a multi-line template",
  "   a glob like /* appears mid-template",
  "   and it ends here`;",
  "  const { error } = await supabase.from('trades').insert(batch);",
  "  return Response.json({ ok: !error });",
  "}",
];

// B — the calibration control: identical to A except line 3 drops the opener.
const CASE_B_LINES = [
  "export async function POST() {",
  "  const tpl = `a multi-line template",
  "   a glob like appears mid-template",
  "   and it ends here`;",
  "  const { error } = await supabase.from('trades').insert(batch);",
  "  return Response.json({ ok: !error });",
  "}",
];

// C — the shipped SP-I01 single-line-template shape, insert on line 3.
const CASE_C_LINES = [
  "export async function POST() {",
  "  const tpl = `c /* d`;",
  "  const { error } = await supabase.from('trades').insert(batch);",
  "  return Response.json({ ok: !error });",
  "}",
];

const CASES = [
  {
    label: "A",
    title: "multi-line template whose continuation line carries a `/*`",
    lines: CASE_A_LINES,
  },
  {
    label: "B",
    title: "CONTROL — identical to A with the `/*` removed from line 3",
    lines: CASE_B_LINES,
  },
  {
    label: "C",
    title: "shipped SP-I01 single-line-template arm shape",
    lines: CASE_C_LINES,
  },
];

function main() {
  const source = readFileSync(SUBJECT_ABS, "utf8");
  const sha256 = createHash("sha256").update(readFileSync(SUBJECT_ABS)).digest("hex");

  console.log("=== [AUDCOV-01] extract-and-run calibration =========================");
  console.log(`subject      : ${SUBJECT_REL}`);
  console.log(`resolved from: ${SUBJECT_ABS}`);
  console.log(`sha256       : ${sha256}`);
  console.log(`typescript   : ${ts.version}`);
  console.log(`node         : ${process.version}`);
  console.log("");

  const declarationTexts = extractDeclarations(SUBJECT_ABS, source);
  const wanted = [...REQUIRED_CONSTS, ...REQUIRED_FUNCTIONS];
  console.log(`extracted ${declarationTexts.length}/${wanted.length} declarations from the`);
  console.log(`subject's OWN bytes (no reimplementation): ${wanted.join(", ")}`);
  console.log("");

  const { findMutations } = evaluateExtracted(declarationTexts);
  if (typeof findMutations !== "function") {
    console.error("FATAL: evaluation did not yield a callable findMutations.");
    process.exit(1);
  }

  const sites = {};

  for (const testCase of CASES) {
    const src = testCase.lines.join("\n");
    console.log(`--- CASE ${testCase.label} — ${testCase.title} ---`);
    testCase.lines.forEach((line, idx) => {
      console.log(`  ${String(idx + 1).padStart(2, " ")} | ${line}`);
    });
    const mutations = findMutations(`case-${testCase.label}.ts`, src);
    console.log(`  mutations = ${JSON.stringify(mutations, null, 2)}`);
    const caseSites = JSON.stringify(mutations.map((m) => m.line));
    console.log(`  sites = ${caseSites}`);
    console.log("");
    sites[testCase.label] = caseSites;
  }

  console.log(`AUDCOV-CAL A=${sites.A} B=${sites.B} C=${sites.C}`);
}

main();
