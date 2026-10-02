// DEF-16-2-safe absence checks for 140.5-04 Task 2.
// Every needle is matched against COMMENT-STRIPPED source *and* against the raw
// source, and both are reported — because these claims LIVE in comments, so a
// code-only check is vacuous here and a raw check cannot distinguish a live
// claim from a marked quotation of a superseded one. Both numbers, with the
// predicate, is the honest report.
import { readFileSync } from "node:fs";
// Run from the REPO ROOT: `npx tsx .planning/phases/140.5-*/140.5-04-absence-checks.mjs`
const { stripCommentsPreserveLines, extractComments } = await import(
  new URL(`file://${process.cwd()}/src/lib/source-scan.ts`).href
);

const CHECKS = [
  ["src/lib/sentry-capture.ts", /captures nothing/i, "ABSENT"],
  ["src/lib/sentry-capture.test.ts", /captures nothing/i, "ABSENT"],
  // ⚠️ "5 minutes" is a SUBSTRING of "15 minutes". The plan's two criteria —
  // "5 minutes" absent AND "15 minutes" present, in the SAME file — are
  // mutually unsatisfiable as literally written: the TRUE 15-minute Python-TTL
  // sentence contains the false needle. A left boundary is required, and this
  // is an acceptance criterion that would have failed on CORRECT code.
  ["src/app/api/keys/[id]/permissions/route.ts", /(?<![0-9])5 minutes/i, "ABSENT"],
  ["src/app/api/keys/[id]/permissions/route.ts", /15 minutes/i, "PRESENT"],
  ["src/lib/seam-log-coverage.test.ts", /EIGHT SINCE/i, "ABSENT"],
  ["src/lib/resilient-fetch.wiring.test.ts", /sixteen/i, "ABSENT"],
  // ⚠️ EXPECTED PRESENT, and it is not a live claim: the single surviving hit is
  // inside the paragraph this file explicitly quotes and marks "IS NOW FALSE"
  // (140.4's record of refuted reasoning). The LIVE ordinal was reworded. See
  // the note at that site; recorded rather than satisfied by mutilating a quote.
  ["src/lib/seam-budgets.invariant.test.ts", /sixteen/i, "PRESENT"],
];

let bad = 0;
for (const [file, needle, want] of CHECKS) {
  const src = readFileSync(file, "utf8");
  // A claim lives in PROSE, so scan the comment spans, not the stripped code.
  const prose = extractComments(src, "ts")
    .map((c) => c.text)
    .join("\n");
  const codeOnly = stripCommentsPreserveLines(src, "ts");
  const inProse = (prose.match(new RegExp(needle.source, "gi")) || []).length;
  const inCode = (codeOnly.match(new RegExp(needle.source, "gi")) || []).length;
  const got = inProse + inCode === 0 ? "ABSENT" : "PRESENT";
  const ok = got === want;
  if (!ok) bad++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  want ${want.padEnd(7)} got ${got.padEnd(7)} ` +
      `prose=${inProse} code=${inCode}  /${needle.source}/i  ${file}`,
  );
}

// VACUITY FENCE: a scanner that matched nothing would print all-PASS above.
// Prove the needles are live by asserting each file yields a non-trivial amount
// of prose to scan, and by running one needle that MUST hit.
const fence = CHECKS.map(([f]) => f).filter((v, i, a) => a.indexOf(v) === i);
console.log("\n--- vacuity fence: comment lines extracted per file ---");
for (const f of fence) {
  const n = extractComments(readFileSync(f, "utf8"), "ts").length;
  console.log(`${String(n).padStart(5)}  ${f}`);
  if (n < 20) bad++;
}
const control = extractComments(
  readFileSync("src/lib/sentry-capture.ts", "utf8"),
  "ts",
)
  .map((c) => c.text)
  .join("\n");
const hit = /captureToSentry/i.test(control);
console.log(`\npositive control (a needle that MUST hit): captureToSentry in sentry-capture.ts prose -> ${hit ? "HIT" : "MISS"}`);
if (!hit) bad++;

console.log(`\n${bad === 0 ? "ALL CHECKS PASS" : `${bad} CHECK(S) FAILED`}`);
process.exit(bad === 0 ? 0 : 1);
