/**
 * Phase 201 plan 25, folded by plan 201-23 (D-08): the copy census report. READ-ONLY.
 *
 *   npx tsx scripts/copy-census/run.ts --file <repo path>    remaining hits in one file
 *   npx tsx scripts/copy-census/run.ts --summary             remaining hits by rule, and the exception count
 *
 * A hit prints as `<rule> <file>:<line> <text>`: repo-relative path, line number and the matched
 * copy, nothing else (no ids, no environment, no secrets). "Remaining" means the live hits the
 * census still counts, net of the permanent exceptions it consumes. Run it from the repo root.
 * The permanent gate is `src/__tests__/copy-census.test.ts`; this command is the developer's
 * report and decides nothing. It changes nothing: it cannot add an exception, because a shipped
 * command that wrote exceptions would let a change excuse its own hits, which D-08 forbids.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { scanTree, type CensusHit, type CensusRule } from "./scan";
import { EXCEPTIONS, POLICY } from "./policy";

const norm = (s: string): string => s.replace(/\s+/g, " ").trim();

/** The live hits net of the exceptions: each exception row consumes one hit (rule, file, exact text). */
function remainingHits(): CensusHit[] {
  const left = scanTree(process.cwd(), POLICY);
  for (const row of EXCEPTIONS) {
    const i = left.findIndex((h) => h.rule === row.rule && h.file === row.file && norm(h.text) === norm(row.literal));
    if (i >= 0) left.splice(i, 1);
  }
  return left;
}

const line = (h: CensusHit): string => `${h.rule} ${h.file}:${h.line} ${norm(h.text)}`;

function summary(hits: readonly CensusHit[]): void {
  const live: Record<CensusRule, number> = { A: 0, B: 0, C: 0 };
  for (const h of hits) live[h.rule]++;
  const files = new Set(hits.map((h) => h.file)).size;
  console.log(`remaining  files=${files}  A=${live.A} B=${live.B} C=${live.C}  exceptions=${EXCEPTIONS.length}`);
}

function main(argv: readonly string[]): number {
  if (!existsSync(join(process.cwd(), "src"))) {
    console.error("run this from the repo root (no src/ directory here)");
    return 2;
  }
  const [flag, value] = argv;
  if (flag === "--summary" && value === undefined) {
    summary(remainingHits());
    return 0;
  }
  if (flag === "--file" && value) {
    for (const h of remainingHits().filter((x) => x.file === value)) console.log(line(h));
    return 0;
  }
  console.error("usage: run.ts --file <repo-relative path> | --summary");
  return 2;
}

process.exitCode = main(process.argv.slice(2));
