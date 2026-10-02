// Enumerates, per file, the bare `file.ext:NN` citations remaining on the
// 34-file seam surface — the conversion remainder handed to 140.5-08.
// Predicate: the SAME comment-scoping (`extractComments` from 140.5-01's
// source-scan.ts) and the SAME `CITE` regex the committed census uses
// (140.5-citation-census.mjs:106), applied to 140.5-seam-surface.txt.
import { readFileSync } from "node:fs";
// Run from the REPO ROOT: `npx tsx .planning/phases/140.5-*/140.5-04-seam-remainder.mjs`
const { extractComments } = await import(
  new URL(`file://${process.cwd()}/src/lib/source-scan.ts`).href
);

const CITE =
  /([A-Za-z0-9_./\[\]()@-]*[A-Za-z0-9_\])])\.(ts|tsx|py|mjs|cjs|js|jsx|sql|yml|yaml|md|json)\s*:\s*(\d+(?:\s*[-–,]\s*\d+)*)/g;

const surface = readFileSync(
  ".planning/phases/140.5-seamprose-attribution-copy-harness-fidelity-and-prose-citati/140.5-seam-surface.txt",
  "utf8",
)
  .split("\n")
  .filter(Boolean);

let total = 0;
const rows = [];
for (const f of surface) {
  const lang = f.endsWith(".py") ? "py" : "ts";
  const hits = [];
  for (const c of extractComments(readFileSync(f, "utf8"), lang)) {
    CITE.lastIndex = 0;
    let m;
    while ((m = CITE.exec(c.text))) hits.push(`${c.line}: ${m[1]}.${m[2]}:${m[3]}`);
  }
  if (hits.length) {
    total += hits.length;
    rows.push([f, hits]);
  }
}
console.log(`seam-surface files scanned : ${surface.length}`);
console.log(`files still carrying bare citations : ${rows.length}`);
console.log(`bare citations to convert : ${total}\n`);
for (const [f, hits] of rows) {
  console.log(`${String(hits.length).padStart(3)}  ${f}`);
  for (const h of hits) console.log(`        ${h}`);
}
