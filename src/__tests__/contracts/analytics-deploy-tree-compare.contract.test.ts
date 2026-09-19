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
  /**
   * Age of the main HEAD commit in SECONDS, fed to the probe's in-flight
   * debounce via a stubbed `git log -1 --format=%ct`.
   * `undefined` makes the stub emit NOTHING, which is the real-world case where
   * the timestamp cannot be read — the probe then skips the debounce and
   * escalates, which is the fail-toward-alerting direction.
   */
  commitAgeSec?: number;
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
if [ "$1" = "log" ]; then
  ${s.commitAgeSec === undefined ? "exit 0" : `echo "$(( $(date +%s) - ${s.commitAgeSec} ))"; exit 0`}
fi
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
  // ⛔ No `sleep` stub. The probe is single-pass since 2026-09-19, so nothing
  // sleeps. Keeping a stub would be a control that LOOKS live and governs
  // nothing — and it would actively hurt: if a poll loop were ever
  // reintroduced, a stubbed `sleep` would let it spin at full speed and pass,
  // whereas with no stub the test hangs to the vitest timeout and says so.
  for (const f of ["curl", "git"]) chmodSync(join(binDir, f), 0o755);

  // ⛔ The convergence loop was DELETED from the workflow on 2026-09-19, so the
  // `+ 4800 ))` -> `+ 1 ))` substitution that used to sit here is gone with it.
  // It is not merely unnecessary now, it would be VACUOUS: String.replace with an
  // absent needle returns the string unchanged and reports nothing, so leaving it
  // would have looked like a live shortening while doing nothing at all.
  // The probe is single-pass; nothing needs shortening for it to terminate.
  // ⛔ NO `${{ }}` SUBSTITUTION HERE, AND THAT IS THE POINT. Two `.replace()`
  // calls used to sit on this line. MEASURED 2026-09-19: both needles match ZERO
  // times, because `HEALTH_URL` and `MAIN_SHA` are declared in the step's `env:`
  // block, which is OUTSIDE the `run: |` body `extractProbeScript` slices. They
  // were vacuous no-ops — `String.replace` with an absent needle returns the
  // string unchanged and reports nothing — dressed as live substitution.
  // The values reach the script as real environment variables below, exactly as
  // GitHub Actions delivers them, which is a truer harness than rewriting source.
  const script = SCRIPT;

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
  it("no unsubstituted GitHub expression reaches bash, and the env: seam is real", () => {
    // ⛔ THIS TEST USED TO BE VACUOUS AND IS NOW CALIBRATED. It asserted
    // `not.toContain("${{")` on a string that structurally can never contain one:
    // `extractProbeScript` slices only the `run: |` body, while every `${{ }}` in
    // this step lives in the `env:` block above it. The assertion could not fail
    // for ANY change to the workflow, so it guarded nothing while claiming to
    // guard "every scenario below".
    // Two real properties instead:
    // (1) the sliced script genuinely carries no `${{ }}` — still worth pinning,
    //     because a future edit COULD inline an expression into the run body,
    //     where bash would receive it as a literal and every scenario would
    //     silently assert against the wrong input;
    expect(SCRIPT, "a ${{ }} inlined into the run body would reach bash as a literal").not.toContain("${{");
    // (2) the env: seam this harness depends on actually exists. runProbe supplies
    //     HEALTH_URL and MAIN_SHA as environment variables; if the workflow ever
    //     stopped declaring them that way, the scenarios would run against an
    //     unset variable under `set -u` rather than the value under test.
    const stepBlock = WORKFLOW_TEXT.slice(WORKFLOW_TEXT.indexOf(STEP_NAME));
    const envBlock = stepBlock.slice(0, stepBlock.indexOf("run: |"));
    for (const key of ["HEALTH_URL", "MAIN_SHA"]) {
      expect(envBlock, `the probe step must declare ${key} in env: — runProbe supplies it that way`).toContain(`${key}:`);
    }
    expect(envBlock, "MAIN_SHA must still come from github.sha").toContain("github.sha");
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

  it("S5 — NO READING from /health is reported as unknown, never as a stale-deploy verdict", () => {
    // ⭐ MEASURED 2026-09-14, run 34846043246 (the v0.77.43.0 merge). The probe
    // printed `prod analytics git_sha ('') != main HEAD ('f10b0e23…')` — a
    // STALE verdict — when the loop had never obtained a readable git_sha at
    // all. An empty `$deployed` means /health was unreachable, returned no
    // JSON, or reported no git_sha; the old single message called every one of
    // those "prod is running the wrong code". The deployed commit was UNKNOWN,
    // not known-wrong, and an operator reading that warning chases a deploy
    // that may be perfectly healthy while the real fault goes unnamed.
    //
    // ⛔ A verdict must not assert a measurement it never took. That is this
    // repo's own rule and it is what this scenario pins.
    const r = runProbe({ deployed: "", mainSha: SHA_B, treeProd: "", treeMain: TREE });
    expect(r.code).toBe(0);

    // (a) it says what actually happened
    expect(r.out, "an unreadable /health must be NAMED as such").toContain("NO READING obtained");
    expect(r.out).toContain("not known-wrong");

    // (b) ⛔ the anti-conflation arm — the arm that reds if the two faults are
    // ever merged back into one message. Without the fix this is the ONLY leg
    // that fails, and it fails on the exact string CI printed.
    expect(
      r.out,
      "an empty reading must NOT be reported as a git_sha mismatch against main",
    ).not.toContain("!= main HEAD");

    // (c) alerting is NOT weakened by the new branch — both faults still alert,
    // exactly as S4 insists for the unresolvable-tree case.
    expect(r.output, "an unreadable probe must still alert").toContain("stale=true");
    expect(r.output, "and must be distinguishable downstream").toContain("unreadable=true");
  });

  // ── The in-flight debounce, BOTH polarities ───────────────────────────────
  // ⛔ THIS IS THE HALF THE LOOP REMOVAL WOULD OTHERWISE HAVE LOST. The deleted
  // 4800 s convergence loop did TWO jobs: it retried (the 6-hourly schedule now
  // does that) and it suppressed the alert while a deploy was legitimately still
  // in flight. Only the first was replaced for free. Without S6 below, `stale=true`
  // fires on the FIRST miss and a run started shortly after an analytics merge
  // files a P1 for a deploy that is simply still building — and nothing in the
  // workflow ever closes that issue, so it becomes the permanently-open muted
  // thread this repo already blames for issue #751's nine mis-triaged comments.
  // S7 is the calibration partner: it proves the debounce is a WINDOW and not a
  // blanket mute, which is the way this control could fail silently.

  it("S6 — a commit INSIDE the CI+build window is in-flight: warns, files NOTHING", () => {
    const r = runProbe({
      deployed: SHA_A, mainSha: SHA_B, treeProd: TREE_OTHER, treeMain: TREE,
      commitAgeSec: 120,
    });
    expect(r.code).toBe(0);
    expect(r.out, "it must say why it is holding off").toContain("INSIDE the ~15 min CI+build window");
    expect(r.output, "an in-flight deploy must be marked as such").toContain("in_flight=true");

    // ⛔ The load-bearing arm: the issue-filing step is gated on `stale=true`,
    // so this assertion is the ONLY thing standing between a still-building
    // deploy and a false P1 that no machine ever closes.
    expect(r.output, "a deploy still in flight must NOT file a staleness issue").not.toContain("stale=true");
  });

  it("S7 — the SAME mismatch OUTSIDE the window escalates: the debounce is a window, not a mute", () => {
    const r = runProbe({
      deployed: SHA_A, mainSha: SHA_B, treeProd: TREE_OTHER, treeMain: TREE,
      commitAgeSec: 4000,
    });
    expect(r.code).toBe(0);
    expect(r.output, "a genuinely stale deploy must still alert").toContain("stale=true");
    expect(r.output, "and must not be mislabelled as in-flight").not.toContain("in_flight=true");
    expect(r.out, "the verdict must not claim a poll it never ran").toContain("single reading");
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
