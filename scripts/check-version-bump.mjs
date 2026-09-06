#!/usr/bin/env node
/**
 * VERSION-bump gate.
 *
 * ⚠️ WHY THIS EXISTS, measured 2026-09-06 (PR #746, Phase 164.1): a branch
 * shipped an entire phase — a new workflow, four new script modules and a
 * changed API response — with VERSION and package.json still identical to
 * main and NO CHANGELOG entry. CI was fully green across 21 checks, because
 * nothing enforced either. It was caught by hand at the merge gate. Main's
 * changelog would have claimed the newest change was a planning-only
 * re-partition.
 *
 * The rule: if a PR changes anything OUTSIDE .planning/, VERSION must differ
 * from the base branch's VERSION, and CHANGELOG.md must contain the new
 * version as a heading. Planning-only PRs are exempt — they are how roadmap
 * edits ship, and requiring a release for them would train people to bypass
 * this gate.
 *
 * ⛔ VERSION and package.json must be EXACTLY equal (critical-regressions
 * asserts it). Checked here too, so the gate reports the real reason rather
 * than letting a 3-digit package.json surface as an unrelated test failure.
 *
 * `--self-test` proves every failure mode fires against synthetic inputs. A
 * gate whose red path has never been observed is the defect this repository's
 * 164.3 phase exists to remove.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

export const DEFECTS = ["version-not-bumped", "version-package-mismatch", "changelog-missing-entry"];

/** PURE: given the facts, name every defect. No I/O, so the self-test drives it directly. */
export function judge({ changedFiles, baseVersion, headVersion, packageVersion, changelog }) {
  const defects = [];
  const nonPlanning = changedFiles.filter((f) => !f.startsWith(".planning/"));
  if (nonPlanning.length === 0) return defects; // planning-only PR: exempt by design

  if (headVersion === baseVersion) {
    defects.push({
      kind: "version-not-bumped",
      detail:
        `${nonPlanning.length} file(s) outside .planning/ changed but VERSION is still ` +
        `"${headVersion}". Every merge in this repo carries a version bump and a CHANGELOG ` +
        `entry; PR #746 shipped a whole phase without either and 21 green checks did not ` +
        `notice. First changed file: ${nonPlanning[0]}`,
    });
  }
  if (headVersion !== packageVersion) {
    defects.push({
      kind: "version-package-mismatch",
      detail: `VERSION is "${headVersion}" but package.json is "${packageVersion}" — they must be byte-equal.`,
    });
  }
  if (headVersion !== baseVersion && !changelog.includes(`[${headVersion}]`)) {
    defects.push({
      kind: "changelog-missing-entry",
      detail: `VERSION moved to "${headVersion}" but CHANGELOG.md has no "[${headVersion}]" heading.`,
    });
  }
  return defects;
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function selfTest() {
  let pass = true;
  const ok = (cond, msg) => {
    console.log(`  ${cond ? "ok  " : "FAIL"} — ${msg}`);
    return cond;
  };
  const base = { changedFiles: ["src/a.ts"], baseVersion: "1.0.0.0", headVersion: "1.0.1.0", packageVersion: "1.0.1.0", changelog: "## [1.0.1.0] - x" };

  console.log("=== SELF-TEST 1/5: a correct bump is clean");
  pass = ok(judge(base).length === 0, "no defects on a well-formed release") && pass;

  console.log("=== SELF-TEST 2/5: source changed, VERSION frozen (the PR #746 shape)");
  const d2 = judge({ ...base, headVersion: "1.0.0.0", packageVersion: "1.0.0.0" });
  pass = ok(d2.some((d) => d.kind === "version-not-bumped"), "version-not-bumped fires") && pass;

  console.log("=== SELF-TEST 3/5: planning-only PR is EXEMPT");
  const d3 = judge({ ...base, changedFiles: [".planning/ROADMAP.md"], headVersion: "1.0.0.0", packageVersion: "1.0.0.0" });
  pass = ok(d3.length === 0, "a roadmap-only PR needs no release") && pass;

  console.log("=== SELF-TEST 4/5: VERSION and package.json disagree");
  const d4 = judge({ ...base, packageVersion: "1.0.1" });
  pass = ok(d4.some((d) => d.kind === "version-package-mismatch"), "the 3-digit package.json trap fires") && pass;

  console.log("=== SELF-TEST 5/5: bumped but no CHANGELOG heading");
  const d5 = judge({ ...base, changelog: "## [0.9.0.0] - old" });
  pass = ok(d5.some((d) => d.kind === "changelog-missing-entry"), "changelog-missing-entry fires") && pass;

  console.log("");
  if (!pass) { console.error("=== SELF-TEST FAILED ==="); return 1; }
  console.log("=== SELF-TEST PASSED: 5/5, every defect kind fired on its own input ===");
  return 0;
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();
  const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main";
  let changedFiles, baseVersion;
  try {
    changedFiles = git(["diff", "--name-only", `${baseRef}...HEAD`]).split("\n").filter(Boolean);
    baseVersion = git(["show", `${baseRef}:VERSION`]).trim();
  } catch (e) {
    // ⛔ A gate that cannot read cannot report a pass.
    console.error(`MEASURE_FAIL: could not read ${baseRef} — ${e.message}`);
    return 1;
  }
  const headVersion = readFileSync("VERSION", "utf8").trim();
  const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
  const changelog = readFileSync("CHANGELOG.md", "utf8");

  const defects = judge({ changedFiles, baseVersion, headVersion, packageVersion, changelog });
  console.log(`base=${baseVersion} head=${headVersion} package=${packageVersion} changed=${changedFiles.length}`);
  if (defects.length === 0) { console.log("✅ No defects"); return 0; }
  for (const d of defects) console.error(`::error::${d.kind} — ${d.detail}`);
  console.error(`${defects.length} defect(s)`);
  return 1;
}

process.exit(main());
