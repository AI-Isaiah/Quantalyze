// Proves every file this plan touched differs from the base ONLY in comments.
// Predicate: for each changed tracked file, take `git show <base>:<path>` and the
// worktree copy, strip comments with src/lib/source-scan.ts's
// stripCommentsPreserveLines (ts for .ts/.tsx, py for .py), then collapse ALL
// whitespace runs to a single space and compare. Whitespace is collapsed because
// blanking a trailing comment leaves spaces where the comment was, and because a
// re-wrapped comment shifts nothing but indentation on the lines it occupies.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
// Run from the REPO ROOT:
//   npx tsx .planning/phases/140.5-*/140.5-04-comment-only-proof.mjs <base-ref>
const { stripCommentsPreserveLines } = await import(
  new URL(`file://${process.cwd()}/src/lib/source-scan.ts`).href
);

const base = process.argv[2];
const changed = execFileSync("git", ["diff", "--name-only", base, "--"], { encoding: "utf8" })
  .split("\n").filter(Boolean);
// SOURCE files only. Planning ledgers (.md) and the receipt scripts themselves
// are genuinely edited, not comment-only, and including them would make this
// proof report a false negative about the thing it exists to prove.
const files = changed.filter((f) => /\.(ts|tsx|py)$/.test(f) && !f.startsWith(".planning/"));
const skipped = changed.filter((f) => !files.includes(f));

let codeChanged = 0;
for (const f of files) {
  const lang = f.endsWith(".py") ? "py" : "ts";
  const before = execFileSync("git", ["show", `${base}:${f}`], { encoding: "utf8" });
  const after = readFileSync(f, "utf8");
  const norm = (s) => stripCommentsPreserveLines(s, lang).replace(/\s+/g, " ").trim();
  const same = norm(before) === norm(after);
  if (!same) codeChanged++;
  console.log(`${same ? "COMMENT-ONLY" : "CODE CHANGED "}  ${f}`);
}
console.log(`\nsource files compared: ${files.length}   code-changed: ${codeChanged}`);
if (skipped.length) {
  console.log(`not source, excluded from the proof (${skipped.length}):`);
  for (const f of skipped) console.log(`        ${f}`);
}
process.exit(codeChanged === 0 ? 0 : 1);
