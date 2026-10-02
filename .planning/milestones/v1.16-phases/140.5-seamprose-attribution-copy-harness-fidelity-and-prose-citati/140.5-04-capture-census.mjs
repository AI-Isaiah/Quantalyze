import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
// Run from the REPO ROOT: `npx tsx .planning/phases/140.5-*/140.5-04-capture-census.mjs`
const { stripCommentsPreserveLines } = await import(
  new URL(`file://${process.cwd()}/src/lib/source-scan.ts`).href
);

const roster = readFileSync("src/lib/seam-log-coverage.test.ts", "utf8")
  .match(/const EXPECTED_SEAM_FILES[\s\S]*?\n\];/)[0]
  .match(/"([^"]+)"/g)
  .map((s) => s.slice(1, -1));

const count = (files, needle) => {
  let sites = 0;
  const hit = [];
  for (const f of files) {
    let src;
    try {
      src = readFileSync(f, "utf8");
    } catch {
      continue;
    }
    const code = stripCommentsPreserveLines(src, "ts");
    const n = (code.match(needle) || []).length;
    if (n) {
      sites += n;
      hit.push([f, n]);
    }
  }
  return { sites, files: hit.length, hit };
};

const NEEDLE = /captureToSentry\s*\(/g;
const EXC = /(captureException|captureMessage)\s*\(/g;

const p1 = count(roster, NEEDLE);
const routes = roster.filter((f) => f.startsWith("src/app/api/"));
const p2 = count(routes, NEEDLE);
const all = execFileSync("git", ["ls-files", "src"], { encoding: "utf8" })
  .split("\n")
  .filter(
    (f) =>
      /\.tsx?$/.test(f) &&
      !/\.test\.tsx?$/.test(f) &&
      f !== "src/lib/sentry-capture.ts",
  );
const p3 = count(all, NEEDLE);
const p3routes = p3.hit.filter(([f]) => f.startsWith("src/app/api/")).length;
const p4 = count(roster, EXC);

console.log(`roster size (EXPECTED_SEAM_FILES) : ${roster.length} files`);
console.log(`P1  the ${roster.length}-file EXPECTED_SEAM_FILES roster : ${p1.sites} sites / ${p1.files} files`);
console.log(`P2  its route files only                  : ${p2.sites} sites / ${p2.files} of ${routes.length} files`);
console.log(`P3  repo-wide src/ non-test, minus helper  : ${p3.sites} sites / ${p3.files} files (${p3routes} under src/app/api)`);
console.log(`P4  captureException|captureMessage over the roster : ${p4.sites} sites   <-- the LITERALLY TRUE grep`);
console.log(`\n--- P1 per file ---`);
for (const [f, n] of p1.hit) console.log(`${String(n).padStart(3)}  ${f}`);
