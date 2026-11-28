/**
 * The workflow file size gate - Phase 260 CIHEADROOM.
 *
 * WHY THIS FILE EXISTS. GitHub starts NO run for a workflow file above 512,000
 * bytes, and the board then shows only the non-CI checks (CLAUDE.md, "CI gate
 * integrity", trap 1). The gate that catches it, `scripts/check-workflow-size.mjs`,
 * therefore has to fire when `ci.yml` ITSELF is the oversized file, which is why
 * it runs from its own workflow, `.github/workflows/workflow-size.yml`. This file
 * pins the things the script's own `--self-test` structurally cannot:
 *
 *   * the two CONSTANTS, so a ceiling nudged upward to make a red PR green is a
 *     red test rather than a quiet edit;
 *   * the VERDICTS of the REAL script, run as a subprocess over fixture
 *     directories at the exact boundary (460,800 green, 460,801 red);
 *   * the WIRING: a gate nobody runs, or one a paths filter or an `if:` can skip,
 *     is a gate that does not exist. Each wiring finding is calibrated by
 *     mutating an in-memory COPY of the real text, never a file on disk.
 *
 * -- WHAT CAN AND CANNOT FAIL TODAY ----------------------------------------
 *   LIVE - every assertion here can fail against the repo as it stands.
 *   DORMANT - none. INERT - none.
 */
import { afterAll, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CEILING, HARD_LIMIT } from "../../scripts/check-workflow-size.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = join(REPO_ROOT, "scripts", "check-workflow-size.mjs");
const SIZE_WF = join(REPO_ROOT, ".github", "workflows", "workflow-size.yml");
const CI_WF = join(REPO_ROOT, ".github", "workflows", "ci.yml");
const NOTES_DOC = join(REPO_ROOT, "docs", "ci-yml-notes.md");

const SCRIPT_BASENAME = "check-workflow-size";

// The decided trigger shape: every push to main and every PR to main, no `types:`
// or `branches-ignore:` narrowing, plus a manual dispatch.
const EXPECTED_ON = ["  push:", "    branches: [main]", "  pull_request:", "    branches: [main]", "  workflow_dispatch:"];

// ---------------------------------------------------------------------------
// Pure helper: the wiring findings. [] means the workflow is wired as decided.
// ---------------------------------------------------------------------------

/** Lines of the top-level `on:` block (up to the next column-0 key). */
function onBlock(text: string): string[] {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => /^on:\s*$/.test(l));
  if (start < 0) return [];
  const out: string[] = [];
  for (let i = start + 1; i < lines.length; i++) {
    const l = lines[i];
    if (l.trim() === "" || l.trim().startsWith("#")) continue;
    if (!/^\s/.test(l)) break;
    out.push(l);
  }
  return out;
}

function wiringFindings(sizeWorkflowText: string, ciText: string): string[] {
  const findings: string[] = [];
  const lines = sizeWorkflowText.split("\n");

  // The gate must not live in ci.yml: an oversized ci.yml starts no run.
  if (ciText.includes(SCRIPT_BASENAME)) findings.push("ci-yml-runs-gate");

  // A paths filter would take the check out of a PR's count.
  if (lines.some((l) => /^\s*paths(-ignore)?:/.test(l))) findings.push("paths-filter");

  const on = onBlock(sizeWorkflowText);
  for (const trigger of ["pull_request", "push", "workflow_dispatch"]) {
    if (!on.some((l) => l === `  ${trigger}:`)) findings.push(`trigger-missing:${trigger}`);
  }
  // Key presence is not enough: `types:`, a changed `branches:` or `branches-ignore:` also drop the check from a PR's count.
  if (JSON.stringify(on) !== JSON.stringify(EXPECTED_ON)) findings.push("on-block-shape");

  if (!lines.some((l) => l === "  workflow-size:")) findings.push("job-key");

  const selfIdx = lines.findIndex((l) => /^\s*run:\s*node scripts\/check-workflow-size\.mjs --self-test\s*$/.test(l));
  const scanIdx = lines.findIndex((l) => /^\s*run:\s*node scripts\/check-workflow-size\.mjs\s*$/.test(l));
  if (selfIdx < 0 || scanIdx < 0 || selfIdx > scanIdx) findings.push("self-test-order");

  if (lines.some((l) => /^\s*(- )?(if|continue-on-error):/.test(l))) findings.push("skippable");

  return findings;
}

/**
 * Pointer findings: every `docs/ci-yml-notes.md#<id>` in ci.yml must name an
 * `<a id="<id>"></a>` line in the doc, and every anchor must be pointed at, so a
 * moved rationale block is never lost behind a dead pointer or left unreferenced.
 */
function pointerFindings(ciText: string, docText: string): string[] {
  const findings: string[] = [];
  const anchors: string[] = [];
  for (const line of docText.split("\n")) {
    const m = /^<a id="([A-Za-z0-9_-]+)"><\/a>$/.exec(line);
    if (m) anchors.push(m[1]);
  }
  const anchorSet = new Set(anchors);
  for (const id of new Set(anchors.filter((a, i) => anchors.indexOf(a) !== i))) findings.push(`duplicate-anchor:${id}`);

  const referenced = new Set<string>();
  let references = 0;
  for (const m of ciText.matchAll(/docs\/ci-yml-notes\.md#([A-Za-z0-9_-]+)/g)) {
    references++;
    referenced.add(m[1]);
    if (!anchorSet.has(m[1])) findings.push(`dangling:${m[1]}`);
  }
  for (const id of anchorSet) if (!referenced.has(id)) findings.push(`orphan:${id}`);
  if (references === 0) findings.push("no-pointers");
  return findings;
}

// ---------------------------------------------------------------------------
// Fixture directories
// ---------------------------------------------------------------------------

const TMP_ROOT = mkdtempSync(join(tmpdir(), "workflow-size-"));
afterAll(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

function fixtureDir(name: string, files: Record<string, number | string>): string {
  const dir = join(TMP_ROOT, name);
  mkdirSync(dir, { recursive: true });
  for (const [file, content] of Object.entries(files)) {
    // ASCII only, so the byte count equals the length.
    writeFileSync(join(dir, file), typeof content === "number" ? "a".repeat(content) : content);
  }
  return dir;
}

function run(args: string[]) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8", cwd: REPO_ROOT });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const count = (text: string, needle: string) => text.split("\n").filter((l) => l.includes(needle)).length;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe("workflow size gate: constants (CONTEXT [Gate] 'What ceiling and margin?')", () => {
  it("HARD_LIMIT is the measured 512,000 bytes", () => {
    expect(HARD_LIMIT).toBe(512000);
  });
  it("CEILING is 90 percent of it, 460,800 bytes, a 51,200-byte margin", () => {
    expect(CEILING).toBe(460800);
    expect(HARD_LIMIT - CEILING).toBe(51200);
  });
});

// ---------------------------------------------------------------------------
// Verdicts of the real script
// ---------------------------------------------------------------------------

describe("workflow size gate: verdicts of the real script", () => {
  it("460,801 bytes is red and only that file is named; 460,800 beside it is not", () => {
    const dir = fixtureDir("over", { "over.yml": CEILING + 1, "under.yml": CEILING });
    const r = run([dir]);
    expect(r.status).toBe(1);
    expect(count(r.out, "::error file=")).toBe(1);
    expect(r.out).toMatch(/::error file=[^:]*over\.yml::/);
    expect(r.out).not.toMatch(/::error file=[^:]*under\.yml::/);
  });

  it("exactly 460,800 bytes is green, with no warning and no error annotation", () => {
    const dir = fixtureDir("at", { "at.yml": CEILING });
    const r = run([dir]);
    expect(r.status).toBe(0);
    expect(r.out).not.toContain("::warning");
    expect(r.out).not.toContain("::error");
    expect(r.out).toMatch(/workflow-size: OK/);
  });

  it("prints every file's size and its headroom to the ceiling and to the hard limit", () => {
    const dir = fixtureDir("headroom", { "small.yml": 1000 });
    const r = run([dir]);
    expect(r.out).toContain(`1000 bytes, ${CEILING - 1000} to the ceiling ${CEILING}, ${HARD_LIMIT - 1000} to the hard limit ${HARD_LIMIT}`);
  });

  it("scans .yaml as well as .yml", () => {
    const dir = fixtureDir("yaml", { "big.yaml": CEILING + 1 });
    const r = run([dir]);
    expect(r.status).toBe(1);
    expect(r.out).toMatch(/::error file=[^:]*big\.yaml::/);
  });

  it("a directory with no workflow file is a MEASURE_FAIL, never a pass", () => {
    const dir = fixtureDir("empty", { "notes.md": "not a workflow\n" });
    const r = run([dir]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
  });

  it("a path that does not exist is a MEASURE_FAIL", () => {
    const r = run([join(TMP_ROOT, "does-not-exist")]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
  });

  it("an unknown flag prints usage and exits 1", () => {
    const r = run(["--selftest"]);
    expect(r.status).toBe(1);
    expect(r.out).toContain("usage:");
  });

  it("--self-test exits 0 and prints its OK line", () => {
    const r = run(["--self-test"]);
    expect(r.status).toBe(0);
    expect(r.out).toContain("check-workflow-size self-test OK: 5 legs");
  });
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

describe("workflow size gate: wiring (CONTEXT [Gate] 'Where does the size gate run?')", () => {
  const sizeText = readFileSync(SIZE_WF, "utf8");
  const ciText = readFileSync(CI_WF, "utf8");

  const mutate = (text: string, from: string, to: string) => {
    expect(text.includes(from), `calibration needle missing: ${JSON.stringify(from)}`).toBe(true);
    const out = text.replace(from, to);
    expect(out).not.toBe(text);
    return out;
  };

  it("has no findings on the real workflow and the real ci.yml", () => {
    expect(wiringFindings(sizeText, ciText)).toEqual([]);
  });

  it("ci-yml-runs-gate fires when ci.yml names the script", () => {
    expect(wiringFindings(sizeText, `${ciText}\n      - run: node scripts/check-workflow-size.mjs\n`)).toContain("ci-yml-runs-gate");
  });

  it("paths-filter fires on a paths: or paths-ignore: key", () => {
    const withPaths = mutate(sizeText, "  pull_request:\n    branches: [main]\n", "  pull_request:\n    branches: [main]\n    paths: ['src/**']\n");
    expect(wiringFindings(withPaths, ciText)).toContain("paths-filter");
    const withIgnore = mutate(sizeText, "  pull_request:\n    branches: [main]\n", "  pull_request:\n    branches: [main]\n    paths-ignore: ['docs/**']\n");
    expect(wiringFindings(withIgnore, ciText)).toContain("paths-filter");
  });

  it("on-block-shape fires on a types: filter, a changed branches:, and a branches-ignore:", () => {
    const pr = "  pull_request:\n    branches: [main]\n";
    const withTypes = mutate(sizeText, pr, `${pr}    types: [labeled]\n`);
    expect(wiringFindings(withTypes, ciText)).toContain("on-block-shape");
    const otherBranch = mutate(sizeText, pr, "  pull_request:\n    branches: [release]\n");
    expect(wiringFindings(otherBranch, ciText)).toContain("on-block-shape");
    const ignored = mutate(sizeText, pr, "  pull_request:\n    branches-ignore: [main]\n");
    expect(wiringFindings(ignored, ciText)).toContain("on-block-shape");
    const pushBranch = mutate(sizeText, "  push:\n    branches: [main]\n", "  push:\n    branches: [release]\n");
    expect(wiringFindings(pushBranch, ciText)).toContain("on-block-shape");
  });

  for (const trigger of ["pull_request", "push", "workflow_dispatch"]) {
    it(`trigger-missing:${trigger} fires when the trigger is renamed away`, () => {
      const broken = mutate(sizeText, `\n  ${trigger}:`, `\n  ${trigger}_x:`);
      expect(wiringFindings(broken, ciText)).toContain(`trigger-missing:${trigger}`);
    });
  }

  it("job-key fires when the job is renamed", () => {
    const broken = mutate(sizeText, "\n  workflow-size:\n", "\n  size-check:\n");
    expect(wiringFindings(broken, ciText)).toContain("job-key");
  });

  it("self-test-order fires when the scan runs first, and when the self-test step is gone", () => {
    const selfRun = "        run: node scripts/check-workflow-size.mjs --self-test\n";
    const scanRun = "        run: node scripts/check-workflow-size.mjs\n";
    const swapped = mutate(mutate(sizeText, selfRun, "@@SELF@@"), scanRun, selfRun).replace("@@SELF@@", scanRun);
    expect(wiringFindings(swapped, ciText)).toContain("self-test-order");
    const noSelf = mutate(sizeText, selfRun, "        run: echo skipped\n");
    expect(wiringFindings(noSelf, ciText)).toContain("self-test-order");
  });

  it("skippable fires on an if: or continue-on-error: key, with or without a dash", () => {
    const withIf = mutate(sizeText, "    timeout-minutes: 5\n", "    timeout-minutes: 5\n    if: always()\n");
    expect(wiringFindings(withIf, ciText)).toContain("skippable");
    const withCoe = mutate(sizeText, "        run: node scripts/check-workflow-size.mjs\n", "        continue-on-error: true\n        run: node scripts/check-workflow-size.mjs\n");
    expect(wiringFindings(withCoe, ciText)).toContain("skippable");
    const dashIf = mutate(sizeText, "      - name: Scan every", "      - if: always()\n        name: Scan every");
    expect(wiringFindings(dashIf, ciText)).toContain("skippable");
  });
});

// ---------------------------------------------------------------------------
// ci.yml headroom (ROADMAP SC-1)
// ---------------------------------------------------------------------------

describe("workflow size gate: ci.yml headroom (SC-1)", () => {
  it("ci.yml is at or under the ceiling", () => {
    const bytes = statSync(CI_WF).size;
    expect(bytes, `ci.yml is ${bytes} bytes; the ceiling is ${CEILING} and GitHub starts no run above ${HARD_LIMIT}`).toBeLessThanOrEqual(CEILING);
  });

  it("the real script is green over the real .github/workflows directory", () => {
    const r = run([]);
    expect(r.status, r.out).toBe(0);
    expect(r.out).not.toContain("::error");
    expect(r.out).toMatch(/workflow-size: OK/);
    // The default scan must have measured .github/workflows itself, not another directory.
    expect(r.out).toContain(".github/workflows/ci.yml:");
    expect(r.out).toContain(".github/workflows/workflow-size.yml:");
    const measured = r.out.split("\n").filter((l) => /^\.github\/workflows\/.*\.ya?ml:/.test(l)).length;
    const onDisk = readdirSync(join(REPO_ROOT, ".github", "workflows"), { withFileTypes: true }).filter((e) => e.isFile() && /\.ya?ml$/.test(e.name)).length;
    expect(measured).toBe(onDisk);
  });
});

// ---------------------------------------------------------------------------
// Pointers resolve (CONTEXT [Headroom] 'Is the move provably lossless?')
// ---------------------------------------------------------------------------

describe("workflow size gate: ci.yml pointers resolve to docs/ci-yml-notes.md anchors", () => {
  const ciText = readFileSync(CI_WF, "utf8");
  const docText = readFileSync(NOTES_DOC, "utf8");

  const mutate = (text: string, from: string | RegExp, to: string) => {
    const out = text.replace(from, to);
    expect(out, `calibration needle missing: ${String(from)}`).not.toBe(text);
    return out;
  };

  it("has no findings on the real files", () => {
    expect(pointerFindings(ciText, docText)).toEqual([]);
  });

  it("dangling fires when a pointer names no anchor", () => {
    const broken = mutate(ciText, "docs/ci-yml-notes.md#sql-mutation-1\n", "docs/ci-yml-notes.md#sql-mutation-1-gone\n");
    expect(pointerFindings(broken, docText)).toContain("dangling:sql-mutation-1-gone");
  });

  it("dangling and orphan fire when an anchor line is deleted and when a pointer is renamed", () => {
    const noAnchor = mutate(docText, '<a id="sql-mutation-1"></a>\n', "");
    expect(pointerFindings(ciText, noAnchor)).toContain("dangling:sql-mutation-1");
    const renamed = mutate(ciText, "docs/ci-yml-notes.md#sql-mutation-1\n", "docs/ci-yml-notes.md#sql-mutation-1-gone\n");
    expect(pointerFindings(renamed, docText)).toContain("orphan:sql-mutation-1");
  });

  it("duplicate-anchor fires on a repeated anchor line", () => {
    const dup = mutate(docText, '<a id="sql-mutation-1"></a>\n', '<a id="sql-mutation-1"></a>\n<a id="sql-mutation-1"></a>\n');
    expect(pointerFindings(ciText, dup)).toContain("duplicate-anchor:sql-mutation-1");
  });

  it("no-pointers fires when every pointer is stripped, so the arm is never vacuous", () => {
    const stripped = mutate(ciText, /docs\/ci-yml-notes\.md#[A-Za-z0-9_-]+/g, "elsewhere");
    expect(pointerFindings(stripped, docText)).toContain("no-pointers");
  });
});
