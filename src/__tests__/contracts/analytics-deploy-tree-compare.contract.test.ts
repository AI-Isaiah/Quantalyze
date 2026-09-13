import { afterAll, describe, expect, it } from "vitest";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * `[DEPLOYVERIFY-SHA-NOT-CODE]` — the pin for analytics-deploy-verify.yml's
 * convergence decision.
 *
 * WHY IT EXISTS, measured rather than supposed. The probe compared COMMIT SHAs
 * while its own question is about CODE. On 2026-09-13 merge `f10b0e23` changed
 * two `.planning/` markdown files and nothing else, so Railway did not rebuild
 * and prod stayed on `0b9f0699` — yet the `analytics-service` tree object is
 * byte-identical across both commits (`e6d8e33f`). Prod was running exactly the
 * right code; the probe looped its whole window and advanced to filing P1
 * staleness.
 *
 * ⛔ The class is NOT new, and that is the point. Issue #751 had been open since
 * 2026-09-07 with nine comments, and its ORIGINAL pair — prod `05994f1d` vs main
 * `45218594` — carries the same signature: tree IDENTICAL (`b2f9f92e`) on both.
 * Every comment since was triaged against a cause that was never present, because
 * the issue body's "known causes" list names only red-check-suite and advisory-lock
 * failures. A P1 alert that is STRUCTURALLY UNABLE TO BE TRUE trains its readers
 * to scroll past it, and the next genuinely skipped deploy lands in that same
 * muted thread.
 *
 * ⛔ NOT a grep pin over the YAML. A grep goes green the moment someone keeps the
 * strings and guts the branch — the defanging case, and the likelier one. This
 * EXTRACTS the probe step's shell out of the workflow, stubs `curl`/`git`/`sleep`
 * on PATH, and RUNS it, asserting on the decision. Deleting or renaming the step
 * makes extraction throw.
 *
 * ⚠️ WHAT IT DOES NOT PIN, stated rather than implied: it proves the probe's SHELL
 * decides correctly under injected inputs. It does NOT prove that Railway's watch
 * path behaves as inferred, nor that GitHub's runner resolves the deployed commit —
 * that half is observational and lives in the live run.
 */

const ROOT = join(__dirname, "..", "..", "..");
const WORKFLOW = join(ROOT, ".github", "workflows", "analytics-deploy-verify.yml");
const WORKFLOW_TEXT = readFileSync(WORKFLOW, "utf8");

const STEP_NAME = "Compare prod /health git_sha to main HEAD";

/**
 * Slice the probe step's `run: |` block. Throws loudly if the step is renamed or
 * removed — an extraction that silently returns "" would make every scenario pass
 * against an empty script, which is the vacuity this file exists to avoid.
 */
function extractProbeScript(yamlText: string): string {
  const lines = yamlText.split("\n");
  const nameAt = lines.findIndex((l) => l.includes(STEP_NAME));
  if (nameAt < 0) throw new Error(`probe step "${STEP_NAME}" not found in ${WORKFLOW}`);
  const runAt = lines.findIndex((l, i) => i > nameAt && /^\s*run:\s*\|\s*$/.test(l));
  if (runAt < 0) throw new Error("probe step has no `run: |` block");
  const indent = (lines[runAt].match(/^\s*/) ?? [""])[0].length + 2;
  const body: string[] = [];
  for (let i = runAt + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() !== "" && (line.match(/^\s*/) ?? [""])[0].length < indent) break;
    body.push(line.slice(indent));
  }
  if (body.length < 20) throw new Error(`probe script slice implausibly short (${body.length} lines)`);
  return body.join("\n");
}

const SCRIPT = extractProbeScript(WORKFLOW_TEXT);

const workdir = mkdtempSync(join(tmpdir(), "deployverify-"));
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

interface Scenario {
  /** what /health reports as git_sha */
  deployed: string;
  /** github.sha */
  mainSha: string;
  /** tree object at the deployed commit; "" means unresolvable (unfetchable) */
  treeProd: string;
  /** tree object at main HEAD */
  treeMain: string;
}

let seq = 0;

/**
 * Run the real extracted script against stubbed `curl`, `git` and `sleep`.
 *
 * ⛔ The subject is written to a tempdir copy and NEVER to the file on disk, and
 * is never restored with `git checkout --` — this repo has a dated record of that
 * destroying uncommitted work in exactly this neuter/restore shape.
 */
function runProbe(s: Scenario): { code: number | null; out: string; output: string } {
  const dir = join(workdir, `s${seq++}`);
  const binDir = join(dir, "bin");
  spawnSync("mkdir", ["-p", binDir]);

  writeFileSync(
    join(binDir, "curl"),
    `#!/bin/bash\nprintf '%s' '{"git_sha":"${s.deployed}"}'\n`,
  );
  // `git rev-parse <sha>^{commit}:analytics-service` is the only git the probe
  // uses for the decision; `git fetch` is a no-op here.
  writeFileSync(
    join(binDir, "git"),
    `#!/bin/bash
if [ "$1" = "fetch" ]; then exit 0; fi
if [ "$1" = "rev-parse" ]; then
  case "$2" in
    ${s.deployed}*) [ -n "${s.treeProd}" ] && { echo "${s.treeProd}"; exit 0; }; exit 128 ;;
    ${s.mainSha}*) [ -n "${s.treeMain}" ] && { echo "${s.treeMain}"; exit 0; }; exit 128 ;;
  esac
  exit 128
fi
exit 0
`,
  );
  writeFileSync(join(binDir, "sleep"), "#!/bin/bash\nexit 0\n");
  for (const f of ["curl", "git", "sleep"]) chmodSync(join(binDir, f), 0o755);

  // The 4800s convergence window is a TIMEOUT constant, not the subject under
  // test; shortening it is what lets the loop terminate. Every branch the
  // scenarios assert on is the workflow's own, unmodified.
  const script = SCRIPT.replace("+ 4800 ))", "+ 1 ))")
    .replace(/\$\{\{\s*vars\.ANALYTICS_HEALTH_URL[^}]*\}\}/g, "http://stub/health")
    .replace(/\$\{\{\s*github\.sha\s*\}\}/g, s.mainSha);

  const scriptPath = join(dir, "step.sh");
  writeFileSync(scriptPath, script);
  const outputPath = join(dir, "gh-output");
  writeFileSync(outputPath, "");

  const res = spawnSync("bash", [scriptPath], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      HEALTH_URL: "http://stub/health",
      MAIN_SHA: s.mainSha,
      GITHUB_OUTPUT: outputPath,
    },
  });
  return {
    code: res.status,
    out: `${res.stdout ?? ""}${res.stderr ?? ""}`,
    output: readFileSync(outputPath, "utf8"),
  };
}

const SHA_A = "0b9f06994a9d750928047ae910c6e9cde2e747e6";
const SHA_B = "f10b0e2324fd392dd7e8c2eae39bad78e4f7e72a";
const TREE = "e6d8e33f6e218285244905c7959a01810eee4335";
const TREE_OTHER = "b2f9f92eb30f4d2c224216e8d9e31bc8d8494591";

describe("[DEPLOYVERIFY-SHA-NOT-CODE] the convergence decision, EXECUTED", () => {
  it("no unsubstituted GitHub expression reaches bash", () => {
    // Without this, a `${{ ... }}` left in place is handed to bash as a literal
    // and every scenario below asserts against the wrong input.
    const script = SCRIPT.replace("+ 4800 ))", "+ 1 ))")
      .replace(/\$\{\{\s*vars\.ANALYTICS_HEALTH_URL[^}]*\}\}/g, "x")
      .replace(/\$\{\{\s*github\.sha\s*\}\}/g, "y");
    expect(script, "an unsubstituted ${{ }} would silently invalidate every scenario").not.toContain("${{");
  });

  it("S1 — identical SHA converges (the pre-existing behaviour, unchanged)", () => {
    const r = runProbe({ deployed: SHA_A, mainSha: SHA_A, treeProd: TREE, treeMain: TREE });
    expect(r.code).toBe(0);
    expect(r.out).toContain("prod analytics is on main HEAD");
    expect(r.output).not.toContain("stale=true");
  });

  it("S2 — SHA differs but the analytics tree is identical: CONVERGED, no staleness", () => {
    // The measured 2026-09-13 case: a docs-only merge.
    const r = runProbe({ deployed: SHA_A, mainSha: SHA_B, treeProd: TREE, treeMain: TREE });
    expect(r.code).toBe(0);
    expect(r.out).toContain("tree matches main HEAD");
    expect(r.output, "a docs-only merge must not be reported stale").not.toContain("stale=true");
  });

  it("S3 — SHA differs AND the analytics tree differs: STILL STALE", () => {
    // ⭐ The anti-vacuity arm. A probe that converges on everything has replaced
    // a false alarm with a dead one. This is the case that must still fire.
    const r = runProbe({ deployed: SHA_A, mainSha: SHA_B, treeProd: TREE_OTHER, treeMain: TREE });
    expect(r.code).toBe(0);
    expect(r.output, "a genuine stale deploy must still raise").toContain("stale=true");
    expect(r.out).toContain("::warning::");
  });

  it("S4 — the deployed commit is unresolvable: FAILS TOWARD ALERTING", () => {
    // A probe that converges when it cannot tell is the dead-alarm version of
    // the very bug the tree comparison fixes.
    const r = runProbe({ deployed: SHA_A, mainSha: SHA_B, treeProd: "", treeMain: TREE });
    expect(r.code).toBe(0);
    expect(r.output, "an unresolvable tree must NOT be read as converged").toContain("stale=true");
  });

  it("every path exits 0 — a red check on main HEAD makes Railway skip the deploy", () => {
    // The 2026-06-21 incident recorded in the workflow header: the red check
    // made Railway skip the deploy, prod never converged, the check stayed red.
    for (const s of [
      { deployed: SHA_A, mainSha: SHA_A, treeProd: TREE, treeMain: TREE },
      { deployed: SHA_A, mainSha: SHA_B, treeProd: TREE, treeMain: TREE },
      { deployed: SHA_A, mainSha: SHA_B, treeProd: TREE_OTHER, treeMain: TREE },
      { deployed: SHA_A, mainSha: SHA_B, treeProd: "", treeMain: TREE },
      { deployed: "", mainSha: SHA_B, treeProd: "", treeMain: TREE },
    ]) {
      expect(runProbe(s).code, `scenario ${JSON.stringify(s)} must exit 0`).toBe(0);
    }
  });
});
