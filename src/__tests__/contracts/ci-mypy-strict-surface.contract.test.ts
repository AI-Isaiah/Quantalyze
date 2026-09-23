import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 164.6.1 / MYPY-MAINPY-01 — the pin for the mypy --strict gate's SURFACE.
 *
 * ⛔ It is deliberately NOT a grep pin. `toContain("main.py")` over ci.yml
 * passes when the COMMENT names the module and the COMMAND drops it — which is
 * precisely the defect this phase removed: the comment above the step claimed
 * ALL running-service code while `main.py`, the `uvicorn main:app` entry, was
 * not on the command line. So this test EXTRACTS the step's `run:` line and the
 * Makefile `typecheck` recipe line, TOKENISES them on whitespace (never a
 * substring match — `main.py` is a substring of nothing else, but a substring
 * pin has no way to know that), and compares SETS.
 *
 * WHAT IT PINS:
 *   - the path set of the ci.yml `python` job's step
 *     `Type gate - mypy strict over the running-service surface` EQUALS the
 *     service surface derived from the TRACKED tree (`git ls-files`, so local
 *     and CI agree): every top-level directory under `analytics-service/`
 *     holding a tracked `.py` file anywhere beneath it (namespace packages
 *     included — `__init__.py` does not decide it; `__pycache__` and
 *     dot-directories skipped), minus the hand-typed `EXCLUDED` record, plus
 *     every tracked top-level `analytics-service/*.py` file;
 *   - the Makefile `typecheck` recipe names the same set;
 *   - the `python` job carries exactly ONE mypy --strict invocation, and its
 *     flag set is EXACTLY `--strict --follow-imports=silent` (an extra flag
 *     such as `--exclude=` narrows the gate while the path set stays equal);
 *   - the Makefile `typecheck` recipe carries NO flag (pyproject.toml supplies them);
 *   - the gate step sets only `name` and `run` (no `if:`, `continue-on-error:`,
 *     `shell:` or `env:` that could switch it off with its run line intact), the
 *     `python` job carries no job-level `continue-on-error:`, and neither the job's
 *     nor the workflow's `defaults:` sets a `shell:`;
 *   - every `EXCLUDED` member still holds a tracked `.py` (a stale exclusion reddens).
 *   The D-02 before/after record this pin keeps from going stale:
 *     BEFORE: `services/ routers/ models/` — 96 source files as mypy counts them.
 *     AFTER:  that set plus exactly `main.py main_worker.py main_worker_healthz.py
 *             sentry_init.py` — 100.
 *
 * ⚠️ WHAT IT DOES NOT PIN, stated rather than implied:
 *   - it does NOT prove mypy is green over that set — the `python` job does;
 *   - it does NOT prove the job goes RED on GitHub when a named module breaks.
 *     That is D-06b, OPEN until the phase PR: a neuter commit on the PR, the
 *     step observed RED naming `main.py`, bound to the head SHA, then restored.
 *
 * ⭐ PLACEMENT ARGUMENT, stated so it is not re-derived. This file lives under
 * `src/__tests__/contracts/`, so it runs in `contracts.yml` (no `paths:`
 * filter) and in the `frontend-test` shards. A docs-only PR cannot BY
 * CONSTRUCTION change `.github/workflows/ci.yml` or `analytics-service/Makefile`
 * or add a module under `analytics-service/`, so every PR that can break this
 * test's subject is a code PR on which it runs.
 */

const ROOT = process.cwd();
const STEP_NAME = "Type gate - mypy strict over the running-service surface";
const CI_YML = join(ROOT, ".github/workflows/ci.yml");
const MAKEFILE = join(ROOT, "analytics-service/Makefile");
const SERVICE_DIR_REL = "analytics-service";

/** The ci.yml mypy command's flag set, EXACTLY (sorted). */
const REQUIRED_CI_FLAGS = ["--follow-imports=silent", "--strict"] as const;

/**
 * Top-level directories holding tracked `.py` files that are OUTSIDE the gate
 * BY STATED DESIGN. Hand-typed on purpose: an exclusion is a decision, and a
 * decision must be written down where a reviewer sees it. Each member is
 * asserted to still hold a tracked `.py`, so an exclusion cannot outlive its
 * subject silently.
 */
const EXCLUDED: Record<string, string> = {
  tests:
    "untyped by design — the open `B-mypy part j` strict-scope policy question in TODOS.md, " +
    "not carried by Phase 164.6.1",
  scripts:
    "one-off operational tooling (backfills, cassette recording), not the running service; " +
    "gating it would add a types-PyYAML dev-dep for throwaway scripts",
};

/** The raw lines of the `python` job's block, from its key line to the line before the next job key. */
function pythonJobLines(ymlText: string): string[] {
  const lines = ymlText.split("\n");
  const jobsIdx = lines.indexOf("jobs:");
  if (jobsIdx === -1) {
    throw new Error(
      "ci.yml has no top-level `jobs:` key. The job-key scan is scoped to the lines after it so a " +
        "trigger key cannot leak into it; without the anchor the `python` job cannot be located.",
    );
  }
  const keyPositions = lines
    .map((l, i) => [l, i] as [string, number])
    .filter(([l, i]) => i > jobsIdx && /^ {2}[a-z0-9-]+:$/.test(l))
    .map(([l, i]) => [l.trim().replace(/:$/, ""), i] as [string, number]);
  const at = keyPositions.findIndex(([k]) => k === "python");
  if (at === -1) {
    throw new Error(
      "ci.yml has no `python:` job key. That job carries the analytics-service mypy --strict gate; " +
        "if it was renamed, update this test in the same commit — if it was deleted, the type gate " +
        "is gone and this test is the only thing that says so.",
    );
  }
  const start = keyPositions[at][1];
  const end = at + 1 < keyPositions.length ? keyPositions[at + 1][1] : lines.length;
  return lines.slice(start, end);
}

/** Non-comment lines in the job that invoke mypy with --strict. */
function mypyInvocationCount(jobLines: string[]): number {
  return jobLines.filter((l) => {
    const t = l.trim();
    return !t.startsWith("#") && /\bmypy\b/.test(t) && /(^|\s)--strict(\s|$)/.test(t);
  }).length;
}

const indentOf = (l: string): number => l.length - l.trimStart().length;
const isContent = (l: string): boolean => l.trim() !== "" && !l.trim().startsWith("#");

/**
 * The gate step's own lines: from its `- name:` line up to (not including) the
 * next content line at the step's dash indentation or shallower — the next
 * step, whatever key it opens with.
 */
function gateStepLines(ymlText: string): string[] {
  const job = pythonJobLines(ymlText);
  const stepAt = job.findIndex((l) => l.trim() === `- name: ${STEP_NAME}`);
  if (stepAt === -1) {
    throw new Error(
      `the ci.yml \`python\` job has no step named "${STEP_NAME}". That step IS the mypy --strict ` +
        `gate. If it was renamed, update STEP_NAME here in the same commit; if it was deleted, the ` +
        `gate is gone.`,
    );
  }
  const dash = indentOf(job[stepAt]);
  let end = stepAt + 1;
  while (end < job.length && !(isContent(job[end]) && indentOf(job[end]) <= dash)) end++;
  return job.slice(stepAt, end);
}

/** The keys the gate step sets, `name` included (read off the `- name:` line). */
function gateStepKeys(ymlText: string): string[] {
  const step = gateStepLines(ymlText);
  const keyIndent = indentOf(step[0]) + 2;
  const keys = ["name"];
  for (const l of step.slice(1)) {
    const m = /^([A-Za-z0-9_-]+):/.exec(l.trimStart());
    if (m && isContent(l) && indentOf(l) === keyIndent) keys.push(m[1]);
  }
  return keys;
}

/**
 * The lines of a key's block at a given indentation: the key line plus every
 * following line indented deeper (blank and comment lines included). Empty
 * when the key is absent.
 */
function keyBlock(lines: string[], indent: number, key: string): string[] {
  const at = lines.findIndex((l) => indentOf(l) === indent && l.trimStart().startsWith(`${key}:`));
  if (at === -1) return [];
  let end = at + 1;
  while (end < lines.length && !(isContent(lines[end]) && indentOf(lines[end]) <= indent)) end++;
  return lines.slice(at, end);
}

/**
 * Every YAML key that can switch the gate off without touching its `run:`
 * line: an extra key on the step (`if: false`, `continue-on-error: true`, a
 * `shell:` that swallows the exit status, an `env:` that repoints mypy), a
 * job-level `continue-on-error`, or a `shell:` in the job's or the workflow's
 * `defaults:`.
 */
function stepSwitchProblems(ymlText: string): string[] {
  const problems: string[] = [];
  for (const k of gateStepKeys(ymlText)) {
    if (k !== "name" && k !== "run") {
      problems.push(
        `ci.yml: step "${STEP_NAME}" carries the key "${k}:"; only \`name\` and \`run\` are allowed. ` +
          `A key such as \`if: false\`, \`continue-on-error: true\` or \`shell:\` can switch the gate ` +
          `off while its run line stays pinned.`,
      );
    }
  }
  const job = pythonJobLines(ymlText);
  if (keyBlock(job, 4, "continue-on-error").length) {
    problems.push(
      "ci.yml: the `python` job carries a job-level `continue-on-error:`, so a red mypy step no " +
        "longer fails the job.",
    );
  }
  const lines = ymlText.split("\n");
  for (const [label, block] of [
    ["the `python` job's", keyBlock(job, 4, "defaults")],
    ["the workflow's top-level", keyBlock(lines, 0, "defaults")],
  ] as const) {
    // `\bshell\s*:` rather than a line-start match, so a flow mapping
    // (`defaults: {run: {shell: bash}}`) is seen too.
    if (block.some((l) => isContent(l) && /\bshell\s*:/.test(l))) {
      problems.push(
        `ci.yml: ${label} \`defaults:\` sets a \`shell:\`, which applies to the mypy step and can ` +
          `swallow its exit status.`,
      );
    }
  }
  return problems;
}

/** The whitespace tokens after `mypy` on the named step's `run:` line. */
function ciMypyArgs(ymlText: string): string[] {
  let runLine: string | undefined;
  for (const l of gateStepLines(ymlText).slice(1)) {
    const t = l.trim();
    if (t.startsWith("run: ")) {
      runLine = t;
      break;
    }
  }
  if (runLine === undefined) {
    throw new Error(`step "${STEP_NAME}" has no single-line \`run: \` value before the next step`);
  }
  const value = runLine.slice("run: ".length).trim();
  if (!value.startsWith("mypy ")) {
    throw new Error(
      `step "${STEP_NAME}" runs \`${value}\`, which does not start with \`mypy \`. This test parses ` +
        `the path set out of a single-line mypy command; a wrapped or multi-line body must be ` +
        `taught to the extractor rather than silently read as empty.`,
    );
  }
  return value.slice("mypy ".length).split(/\s+/).filter(Boolean);
}

/** The whitespace tokens after `$(MYPY)` on the `typecheck:` recipe line. */
function makefileTypecheckArgs(makefileText: string): string[] {
  const lines = makefileText.split("\n");
  const at = lines.indexOf("typecheck:");
  if (at === -1) {
    throw new Error(
      "analytics-service/Makefile has no `typecheck:` target. It is the local mirror of the CI mypy " +
        "gate (`make ci` runs it); if it was renamed, update this test in the same commit.",
    );
  }
  const recipe = lines[at + 1];
  const prefix = "\t$(MYPY) ";
  if (recipe === undefined || !recipe.startsWith(prefix)) {
    throw new Error(
      `the line after \`typecheck:\` is not a TAB-indented \`$(MYPY) ...\` recipe line: ` +
        `${JSON.stringify(recipe)}`,
    );
  }
  return recipe.slice(prefix.length).split(/\s+/).filter(Boolean);
}

/** Path tokens only (flags dropped), one trailing `/` stripped. */
function pathSet(tokens: string[]): Set<string> {
  return new Set(tokens.filter((t) => !t.startsWith("--")).map((t) => t.replace(/\/$/, "")));
}

function flagSet(tokens: string[]): Set<string> {
  return new Set(tokens.filter((t) => t.startsWith("--")));
}

/**
 * Every TRACKED path under `analytics-service/`, relative to it. Read from
 * `git ls-files`, not the working tree, so a developer's untracked scratch
 * file (or a gitignored `__pycache__/`) cannot make this test disagree with
 * CI's clean checkout. `execFileSync` with no shell; an empty result throws,
 * because an empty listing would derive an empty surface and read as a
 * mismatch against every named path rather than as a broken read.
 */
function readTrackedListing(): string[] {
  const out = execFileSync("git", ["ls-files", "-z", "--", SERVICE_DIR_REL], {
    cwd: ROOT,
    encoding: "utf8",
  });
  const prefix = `${SERVICE_DIR_REL}/`;
  const paths = out
    .split("\0")
    .filter(Boolean)
    .map((p) => (p.startsWith(prefix) ? p.slice(prefix.length) : p));
  if (paths.length === 0) {
    throw new Error(
      `\`git ls-files -- ${SERVICE_DIR_REL}\` returned nothing from ${ROOT}. The surface is derived ` +
        `from that listing; run this test from the repository root of a git checkout.`,
    );
  }
  return paths;
}

/**
 * The top-level directory a tracked `.py` path makes a surface candidate, or
 * `null`. Any directory holding a `.py` file ANYWHERE beneath it counts —
 * `__init__.py` does NOT decide it, because Python 3 imports a directory
 * without one as a namespace package and mypy follows it under
 * `--follow-imports=silent` with its errors suppressed. `__pycache__` and
 * dot-directories are skipped at any depth.
 */
function pyTopDir(path: string): string | null {
  const parts = path.split("/");
  if (parts.length < 2 || !path.endsWith(".py")) return null;
  const dirs = parts.slice(0, -1);
  if (dirs.some((d) => d === "__pycache__" || d.startsWith("."))) return null;
  return dirs[0];
}

/** Top-level `*.py` files plus every top-level directory holding a `.py`, minus `excluded`. */
function diskSurface(listing: string[], excluded: Record<string, string>): Set<string> {
  const surface = new Set<string>();
  for (const p of listing) {
    if (!p.includes("/") && p.endsWith(".py")) surface.add(p);
    const top = pyTopDir(p);
    if (top !== null && !Object.hasOwn(excluded, top)) surface.add(top);
  }
  return surface;
}

/** Every disagreement between the CI command, the Makefile recipe and disk. Empty ⇔ pinned. */
function surfaceProblems(
  ymlText: string,
  makefileText: string,
  listing: string[],
  excluded: Record<string, string>,
): string[] {
  const problems: string[] = [];

  const count = mypyInvocationCount(pythonJobLines(ymlText));
  if (count !== 1) {
    problems.push(
      `ci.yml: the \`python\` job carries ${count} mypy --strict invocation(s); exactly ONE is allowed. ` +
        `A second, partial invocation lets the gate's surface be split across steps where no single ` +
        `line states it.`,
    );
  }

  problems.push(...stepSwitchProblems(ymlText));

  // The flag set is pinned EXACTLY, not by presence. A presence check lets an
  // added `--exclude=services/ingestion/` (or `--allow-untyped-defs`) narrow or
  // weaken the gate while the PATH set, which is all the surface arm reads,
  // stays equal. The Makefile recipe carries NO flags: its flags come from
  // pyproject.toml.
  const ciTokens = ciMypyArgs(ymlText);
  const flags = flagSet(ciTokens);
  for (const f of REQUIRED_CI_FLAGS) {
    if (!flags.has(f)) problems.push(`ci.yml: the mypy invocation lost the flag "${f}"`);
  }
  for (const f of [...flags].sort()) {
    if (!(REQUIRED_CI_FLAGS as readonly string[]).includes(f)) {
      problems.push(
        `ci.yml: the mypy invocation carries the flag "${f}"; exactly ` +
          `${JSON.stringify(REQUIRED_CI_FLAGS)} is allowed. Any other flag can narrow or weaken the ` +
          `gate while its path set stays equal.`,
      );
    }
  }
  const mkTokens = makefileTypecheckArgs(makefileText);
  for (const f of [...flagSet(mkTokens)].sort()) {
    problems.push(
      `Makefile: the \`typecheck\` recipe carries the flag "${f}"; it carries none, because its ` +
        `flags come from pyproject.toml [tool.mypy]. A flag here can narrow or weaken the local gate.`,
    );
  }

  const surface = diskSurface(listing, excluded);
  const sets: Array<[string, Set<string>]> = [
    ["ci.yml", pathSet(ciTokens)],
    ["Makefile", pathSet(mkTokens)],
  ];
  for (const [label, named] of sets) {
    for (const member of [...surface].sort()) {
      if (!named.has(member)) {
        problems.push(
          `${label}: service-surface member "${member}" is tracked under analytics-service/ but ` +
            `is NOT named by the mypy invocation. Name it on the command line (a module reached only ` +
            `by import is followed with its errors suppressed), or add it to EXCLUDED with a reason.`,
        );
      }
    }
    for (const path of [...named].sort()) {
      if (!surface.has(path)) {
        problems.push(
          `${label}: the mypy invocation names "${path}", which is not a service-surface member ` +
            `(not a tracked top-level *.py file, not a top-level directory holding a tracked .py ` +
            `file, or an EXCLUDED one).`,
        );
      }
    }
  }

  for (const name of Object.keys(excluded).sort()) {
    if (!listing.some((p) => pyTopDir(p) === name)) {
      problems.push(
        `EXCLUDED: the exclusion "${name}" names no directory holding a tracked .py file under ` +
          `analytics-service/. A stale ` +
          `exclusion is a decision that outlived its subject — remove it or restore the directory.`,
      );
    }
  }

  return problems;
}

// ── read ONCE at module load; the byte-unchanged arm compares disk to these ──
const REAL_YML = readFileSync(CI_YML, "utf8");
const REAL_MAKEFILE = readFileSync(MAKEFILE, "utf8");
const REAL_LISTING = readTrackedListing();

describe("[164.6.1 / MYPY-MAINPY-01] the mypy --strict invocation names exactly the service surface", () => {
  it("ci.yml path set == disk-derived surface == Makefile `typecheck` set, one invocation", () => {
    const problems = surfaceProblems(REAL_YML, REAL_MAKEFILE, REAL_LISTING, EXCLUDED);
    expect(problems, problems.join("\n")).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ⛔ CALIBRATION — every leg feeds a MUTATED COPY of the real text (or the real
// listing) through `surfaceProblems`, so extraction runs on every leg too. The
// mutations are string operations in memory; nothing here writes a file, and
// nothing restores with a checkout.
// ---------------------------------------------------------------------------
describe("[164.6.1 / MYPY-MAINPY-01] CALIBRATION — the surface pin can FAIL", () => {
  const RUN_LINE =
    "run: mypy --strict --follow-imports=silent services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py";
  const RECIPE_LINE =
    "\t$(MYPY) services/ routers/ models/ main.py main_worker.py main_worker_healthz.py sentry_init.py";
  const PRE_PHASE_RUN_LINE = "run: mypy --strict --follow-imports=silent services/ routers/ models/";

  /**
   * ⛔ ASSERT THE MUTATION APPLIED BEFORE BELIEVING ANYTHING. A neuter that does
   * not apply leaves the real text in place, the pin stays green, and the leg
   * certifies nothing while looking like evidence.
   */
  function mutate(original: string, target: string, replacement: string, label: string): string {
    expect(
      original.includes(target),
      `CALIBRATION ${label}: the mutation target is not present in the real text — nothing would be ` +
        `replaced and the leg would measure the unmutated file. Re-anchor the target.`,
    ).toBe(true);
    const mutated = original.replace(target, replacement);
    expect(mutated, `CALIBRATION ${label}: the mutated text is identical to the original`).not.toBe(original);
    expect(
      mutated.includes(target),
      `CALIBRATION ${label}: the target SURVIVED the mutation, so the copy still carries the real line`,
    ).toBe(false);
    return mutated;
  }

  /** An ADDITIVE mutation: the anchor stays, so the self-checks are on the added text instead. */
  function insertAfter(original: string, anchor: string, added: string, label: string): string {
    expect(
      original.split(anchor).length - 1,
      `CALIBRATION ${label}: the anchor must occur exactly once in the real text`,
    ).toBe(1);
    expect(original.includes(added), `CALIBRATION ${label}: the added text is already present`).toBe(false);
    const mutated = original.replace(anchor, `${anchor}${added}`);
    expect(mutated.includes(added), `CALIBRATION ${label}: the added text did not land`).toBe(true);
    return mutated;
  }

  const has = (problems: string[], ...needles: string[]) =>
    problems.some((p) => needles.every((n) => p.includes(n)));

  it("(a) dropping `main.py` from the ci.yml run line → a problem naming main.py and ci.yml", () => {
    const yml = mutate(REAL_YML, RUN_LINE, RUN_LINE.replace(" main.py ", " "), "(a)");
    const problems = surfaceProblems(yml, REAL_MAKEFILE, REAL_LISTING, EXCLUDED);
    expect(has(problems, '"main.py"', "ci.yml:"), problems.join("\n")).toBe(true);
    // The Makefile was not mutated, so it must not be blamed.
    expect(has(problems, "Makefile:"), problems.join("\n")).toBe(false);
  });

  it("(b) a phantom tracked top-level `newmod.py` → a problem naming newmod.py", () => {
    const listing = [...REAL_LISTING, "newmod.py"];
    const problems = surfaceProblems(REAL_YML, REAL_MAKEFILE, listing, EXCLUDED);
    expect(has(problems, '"newmod.py"', "ci.yml:"), problems.join("\n")).toBe(true);
    expect(has(problems, '"newmod.py"', "Makefile:"), problems.join("\n")).toBe(true);
  });

  it("(c) dropping `main_worker.py` from the Makefile recipe → a problem naming main_worker.py and Makefile", () => {
    const mk = mutate(REAL_MAKEFILE, RECIPE_LINE, RECIPE_LINE.replace(" main_worker.py ", " "), "(c)");
    const problems = surfaceProblems(REAL_YML, mk, REAL_LISTING, EXCLUDED);
    expect(has(problems, '"main_worker.py"', "Makefile:"), problems.join("\n")).toBe(true);
    expect(has(problems, "ci.yml:"), problems.join("\n")).toBe(false);
  });

  it("(d) a phantom package `newpkg/` with __init__.py → a problem naming newpkg (D-09)", () => {
    const listing = [...REAL_LISTING, "newpkg/__init__.py"];
    const problems = surfaceProblems(REAL_YML, REAL_MAKEFILE, listing, EXCLUDED);
    expect(has(problems, '"newpkg"', "ci.yml:"), problems.join("\n")).toBe(true);
    expect(has(problems, '"newpkg"', "Makefile:"), problems.join("\n")).toBe(true);
  });

  it("(d2) a phantom NAMESPACE package `newns/` (a nested .py, no __init__.py) → a problem naming newns", () => {
    const listing = [...REAL_LISTING, "newns/dispatch/worker.py"];
    expect(
      listing.some((p) => p.startsWith("newns/") && p.endsWith("__init__.py")),
      "CALIBRATION (d2): the phantom must carry NO __init__.py, or it proves nothing new over (d)",
    ).toBe(false);
    const problems = surfaceProblems(REAL_YML, REAL_MAKEFILE, listing, EXCLUDED);
    expect(has(problems, '"newns"', "ci.yml:"), problems.join("\n")).toBe(true);
    expect(has(problems, '"newns"', "Makefile:"), problems.join("\n")).toBe(true);
  });

  it("(e) a second, partial mypy --strict step in the python job → an invocation-count problem", () => {
    const yml = insertAfter(
      REAL_YML,
      RUN_LINE,
      "\n      - name: Partial type gate\n        run: mypy --strict --follow-imports=silent services/",
      "(e)",
    );
    const problems = surfaceProblems(yml, REAL_MAKEFILE, REAL_LISTING, EXCLUDED);
    expect(has(problems, "carries 2 mypy --strict invocation(s)"), problems.join("\n")).toBe(true);
  });

  it("(f) HISTORICAL — the pre-phase command names none of the four top-level modules", () => {
    const yml = mutate(REAL_YML, RUN_LINE, PRE_PHASE_RUN_LINE, "(f)");
    const problems = surfaceProblems(yml, REAL_MAKEFILE, REAL_LISTING, EXCLUDED);
    for (const m of ["main.py", "main_worker.py", "main_worker_healthz.py", "sentry_init.py"]) {
      expect(has(problems, `"${m}"`, "ci.yml:"), `${m} was not named.\n${problems.join("\n")}`).toBe(true);
    }
  });

  it("(g) removing `scripts` from the listing → a stale-exclusion problem naming scripts", () => {
    const listing = REAL_LISTING.filter((p) => !p.startsWith("scripts/"));
    expect(listing.length, "CALIBRATION (g): `scripts/` held no tracked path").toBeLessThan(REAL_LISTING.length);
    const problems = surfaceProblems(REAL_YML, REAL_MAKEFILE, listing, EXCLUDED);
    expect(has(problems, "EXCLUDED:", '"scripts"'), problems.join("\n")).toBe(true);
  });

  it("(h) an added `--exclude=services/ingestion/` in ci.yml → a flag problem, with the path set still equal", () => {
    const yml = mutate(
      REAL_YML,
      RUN_LINE,
      RUN_LINE.replace("--follow-imports=silent ", "--follow-imports=silent --exclude=services/ingestion/ "),
      "(h)",
    );
    const problems = surfaceProblems(yml, REAL_MAKEFILE, REAL_LISTING, EXCLUDED);
    expect(has(problems, "ci.yml:", '"--exclude=services/ingestion/"'), problems.join("\n")).toBe(true);
    // The path set did not change, so the surface arm must stay quiet: the flag
    // arm is the ONLY thing that sees this narrowing.
    expect(has(problems, "service-surface member"), problems.join("\n")).toBe(false);
  });

  it("(h2) removing `--follow-imports=silent` alone from ci.yml → a lost-flag problem naming it", () => {
    const yml = mutate(REAL_YML, RUN_LINE, RUN_LINE.replace(" --follow-imports=silent", ""), "(h2)");
    const problems = surfaceProblems(yml, REAL_MAKEFILE, REAL_LISTING, EXCLUDED);
    expect(has(problems, "ci.yml:", 'lost the flag "--follow-imports=silent"'), problems.join("\n")).toBe(true);
    expect(has(problems, '"--strict"'), problems.join("\n")).toBe(false);
  });

  const STEP_LINE = `      - name: ${STEP_NAME}\n`;

  it("(j) `if: false` on the gate step → a step-key problem naming `if`", () => {
    const yml = insertAfter(REAL_YML, STEP_LINE, "        if: false\n", "(j)");
    const problems = surfaceProblems(yml, REAL_MAKEFILE, REAL_LISTING, EXCLUDED);
    expect(has(problems, "ci.yml:", 'carries the key "if:"'), problems.join("\n")).toBe(true);
  });

  it("(k) `continue-on-error: true` on the gate step → a step-key problem naming it", () => {
    const yml = insertAfter(REAL_YML, STEP_LINE, "        continue-on-error: true  # calibration (k)\n", "(k)");
    const problems = surfaceProblems(yml, REAL_MAKEFILE, REAL_LISTING, EXCLUDED);
    expect(has(problems, "ci.yml:", 'carries the key "continue-on-error:"'), problems.join("\n")).toBe(true);
  });

  it("(l) a job-level `continue-on-error: true` on the python job → a job problem", () => {
    const yml = insertAfter(REAL_YML, "\n  python:\n", "    continue-on-error: true  # calibration (l)\n", "(l)");
    const problems = surfaceProblems(yml, REAL_MAKEFILE, REAL_LISTING, EXCLUDED);
    expect(has(problems, "ci.yml:", "job-level `continue-on-error:`"), problems.join("\n")).toBe(true);
  });

  it("(m) a `shell:` in the python job's `defaults: run:` → a defaults problem", () => {
    // The anchor must occur once (insertAfter asserts it): today only the
    // python job carries this defaults block, so the shell lands in it.
    const yml = insertAfter(
      REAL_YML,
      "    defaults:\n      run:\n        working-directory: analytics-service\n",
      "        shell: bash {0} || true\n",
      "(m)",
    );
    const problems = surfaceProblems(yml, REAL_MAKEFILE, REAL_LISTING, EXCLUDED);
    expect(has(problems, "ci.yml:", "`python` job's `defaults:` sets a `shell:`"), problems.join("\n")).toBe(true);
  });

  it("(i) a flag on the Makefile `typecheck` recipe → a Makefile flag problem", () => {
    const mk = mutate(
      REAL_MAKEFILE,
      RECIPE_LINE,
      RECIPE_LINE.replace("$(MYPY) ", "$(MYPY) --no-strict-optional "),
      "(i)",
    );
    const problems = surfaceProblems(REAL_YML, mk, REAL_LISTING, EXCLUDED);
    expect(has(problems, "Makefile:", '"--no-strict-optional"'), problems.join("\n")).toBe(true);
    expect(has(problems, "ci.yml:"), problems.join("\n")).toBe(false);
  });

  // ⛔ WITHOUT THIS THE LEGS ABOVE PROVE NOTHING: a `surfaceProblems` that
  // always returned a non-empty list would pass every one of them.
  it("NON-VACUITY CONTROL — the unmutated inputs pass through the same function with no problem", () => {
    expect(surfaceProblems(REAL_YML, REAL_MAKEFILE, REAL_LISTING, EXCLUDED)).toEqual([]);
    const surface = diskSurface(REAL_LISTING, EXCLUDED);
    expect(surface.has("main.py"), "the disk surface lost main.py — the listing is not the service").toBe(true);
    const dirs = [...surface].filter((m) => !m.endsWith(".py"));
    expect(dirs.length, "fewer than 3 directories derived — the listing is suspect").toBeGreaterThanOrEqual(3);
    // The recursive rule's two exclusions, and a non-.py directory, stay OUT of
    // the surface: a `.py` under `__pycache__/` or a dot-directory is not
    // service code, and `docs/` (tracked, no .py) is not a package.
    const extra = diskSurface([...REAL_LISTING, "cachey/__pycache__/x.py", ".hidden/x.py", "docs/x.md"], EXCLUDED);
    expect([...extra].sort(), "a __pycache__/dot-dir/non-.py path entered the surface").toEqual([...surface].sort());
    expect(
      pathSet(ciMypyArgs(REAL_YML)).size,
      "fewer than 7 path tokens extracted from the run line — extraction is broken",
    ).toBeGreaterThanOrEqual(7);
  });

  it("ci.yml and the Makefile are byte-unchanged on disk by the legs above", () => {
    expect(readFileSync(CI_YML, "utf8"), "ci.yml changed on disk while this block ran").toBe(REAL_YML);
    expect(readFileSync(MAKEFILE, "utf8"), "the Makefile changed on disk while this block ran").toBe(REAL_MAKEFILE);
  });
});
