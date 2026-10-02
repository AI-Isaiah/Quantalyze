#!/usr/bin/env node
/**
 * VERIFICATION DRIFT REPORT — advisory, never a gate.
 *
 * ⛔ WHY THIS EXISTS, AND WHY IT IS NOT A DIGEST.
 * GSD's `covered_digest` demoted a `passed` verification to `stale` the moment any
 * covered file changed. MEASURED 2026-09-18 on this repo: 7 phases carried a digest
 * and 5 of them were stale, while the 21 phases carrying no digest read `passed`
 * unconditionally forever. The rule punished thoroughness — listing the files your
 * verdict rested on was what got the verdict revoked — and in a repo where phases
 * deliberately layer on the same prober, CI and migration files, that makes a
 * milestone impossible to close. Founder decision 2026-09-18: COMPLETION IS
 * HISTORICAL, DRIFT IS A SEPARATE SIGNAL.
 *
 * So a verdict records the sha it was issued at (`verified_at_sha`) and the files it
 * rested on (`drift_subjects`). Neither field opts the report into GSD's fingerprint
 * check — that check keys on `covered_files`/`covered_digest`, and those are gone on
 * purpose. This script is the replacement signal: it says which verdicts now predate
 * changes to their own subjects, so a human can decide whether to re-verify.
 *
 * ⛔ IT ALWAYS EXITS 0. A drifted verdict is not a failure; it is a prompt. Anything
 * that makes this block a merge re-creates the defect it was written to remove.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const PHASES = ".planning/phases";

/** Frontmatter is read with a deliberately small parser — only the three keys we own. */
function readFrontmatter(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end < 0) return null;
  const body = text.slice(4, end);
  const sha = body.match(/^verified_at_sha:\s*"?([0-9a-f]{7,40})"?\s*$/m);
  const subjects = [];
  const block = body.match(/^drift_subjects:\n((?:[ \t]+-[^\n]*\n?)+)/m);
  if (block) {
    for (const line of block[1].split("\n")) {
      const m = line.match(/^[ \t]+-\s*"?([^"\n]+?)"?\s*$/);
      if (m) subjects.push(m[1]);
    }
  }
  return { sha: sha ? sha[1] : null, subjects };
}

function changedSince(sha, paths) {
  if (!paths.length) return [];
  try {
    const out = execFileSync("git", ["diff", "--name-only", `${sha}..HEAD`, "--", ...paths], {
      encoding: "utf8",
    });
    return out.split("\n").filter((l) => l.trim().length > 0);
  } catch {
    // An unreachable sha (rebased away) is reported as INDETERMINATE, never as clean.
    return null;
  }
}

let drifted = 0;
let clean = 0;
let indeterminate = 0;
const rows = [];

for (const dir of readdirSync(PHASES)) {
  let files;
  try {
    files = readdirSync(join(PHASES, dir));
  } catch {
    continue;
  }
  const vf = files.find((f) => f.endsWith("-VERIFICATION.md"));
  if (!vf) continue;
  const fm = readFrontmatter(readFileSync(join(PHASES, dir, vf), "utf8"));
  if (!fm || !fm.sha || fm.subjects.length === 0) continue;

  const phase = dir.split("-")[0];
  const moved = changedSince(fm.sha, fm.subjects);
  if (moved === null) {
    indeterminate++;
    rows.push(`  ? ${phase}  INDETERMINATE — ${fm.sha.slice(0, 8)} is unreachable (rebased away?)`);
  } else if (moved.length === 0) {
    clean++;
  } else {
    drifted++;
    rows.push(`  ~ ${phase}  verified at ${fm.sha.slice(0, 8)}; ${moved.length} subject(s) moved since:`);
    for (const m of moved) rows.push(`      ${m}`);
  }
}

console.log("verification drift report — ADVISORY, exit 0 always");
console.log(`  ${clean} verdict(s) whose subjects have not moved`);
console.log(`  ${drifted} verdict(s) that predate changes to their own subjects`);
if (indeterminate) console.log(`  ${indeterminate} indeterminate`);
if (rows.length) {
  console.log("");
  for (const r of rows) console.log(r);
  console.log("");
  console.log("A drifted verdict is NOT wrong — it is a prompt to decide whether the");
  console.log("change could have invalidated it. Re-verify deliberately, or leave it.");
}
