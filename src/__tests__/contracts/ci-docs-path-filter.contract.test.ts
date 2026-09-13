import { afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { judge } from "../../../scripts/classify-changed-paths.mjs";

/**
 * Phase 164.6.3 / CI-DOCSPATH-01 — the pin for the docs-only path filter's
 * aggregator arm.
 *
 * ⛔ It is deliberately NOT a set of grep assertions over the YAML. A grep pin
 * goes green the moment someone keeps the strings and guts the logic — the
 * defanging case, which is the likelier one. So this test EXTRACTS the
 * `frontend` aggregator's shell script out of ci.yml, substitutes the GitHub
 * expressions per scenario, and RUNS it under bash, asserting on exit codes.
 * Deleting or renaming the step makes extraction throw; weakening any branch
 * makes a scenario stop failing.
 *
 * WHAT IT PINS, in both polarities:
 *   - a docs-only classification greens the board only for rows OUTSIDE the
 *     declared ALWAYS_ON list (S1, S2a, S2b);
 *   - a code classification leaves every row's path byte-identical, so a skip
 *     still reddens (S4) and an all-success board still greens (S6);
 *   - a FAILED detector — whose output is the empty string — reddens (S5).
 *
 * ⚠️ WHAT IT DOES NOT PIN, stated rather than implied: it proves the
 * aggregator's SHELL behaves correctly under injected inputs. It does NOT prove
 * that GitHub's scheduler produces those inputs — that a filtered job actually
 * skips, and that `needs.changed-paths.outputs.docs_only` actually arrives
 * empty on a cancelled detector. Only the two real PRs in this phase's wave 4
 * close that half.
 *
 * ⭐ PLACEMENT ARGUMENT, stated so it is not re-derived. This file lives under
 * `src/__tests__/contracts/` and therefore runs in `frontend-test` — a job this
 * very phase filters. That is sound rather than circular: a docs-only PR cannot
 * BY CONSTRUCTION change `scripts/classify-changed-paths.mjs` or
 * `.github/workflows/ci.yml`, because neither is under the `.planning/`
 * allow-list, so every PR that CAN break this test's subject is a code PR on
 * which `frontend-test` runs. It additionally runs unfiltered in
 * `contracts.yml`, which has no `paths:` filter at all — a second surface.
 */

const ROOT = process.cwd();
const STEP_NAME = "Verify all frontend-* jobs succeeded";
const CI_YML = join(ROOT, ".github/workflows/ci.yml");
const CLASSIFIER = join(ROOT, "scripts/classify-changed-paths.mjs");

/** Pull a step's `run: |` body out of the workflow, dedented. */
function extractRunScript(yml: string, stepName: string): string {
  const lines = yml.split("\n");
  const start = lines.findIndex((l) => l.trim() === `- name: ${stepName}`);
  if (start === -1) {
    throw new Error(
      `ci.yml has no step named "${stepName}". That step is the frontend aggregator's ` +
        `entire body — the result loop that decides whether a skipped gate reddens the ` +
        `board. If it was renamed, update STEP_NAME here; if it was deleted, every gate ` +
        `this aggregator fronts became advisory and this test is the only thing that says so.`,
    );
  }
  const runIdx = lines.findIndex((l, i) => i > start && l.trim() === "run: |");
  if (runIdx === -1) throw new Error(`step "${stepName}" has no "run: |" body`);
  const indent = lines[runIdx].length - lines[runIdx].trimStart().length;
  const body: string[] = [];
  for (const line of lines.slice(runIdx + 1)) {
    if (line.trim() === "") {
      body.push("");
      continue;
    }
    if (line.length - line.trimStart().length <= indent) break;
    body.push(line.slice(indent + 2));
  }
  return `${body.join("\n")}\n`;
}

const YML = readFileSync(CI_YML, "utf8");
const SCRIPT = extractRunScript(YML, STEP_NAME);

/**
 * The loop's row roster, DERIVED from the extracted script rather than
 * hand-typed — a row added to ci.yml without a scenario here then shows up in
 * every scenario automatically instead of being silently unexercised.
 */
const ROWS: string[] = [...SCRIPT.matchAll(/"([a-zA-Z0-9-]+)=\$\{\{\s*needs\.[a-zA-Z0-9-]+\.result\s*\}\}"/g)].map(
  (m) => m[1],
);

/**
 * The ALWAYS_ON membership, PARSED OUT of the extracted script. ⭐ Parsed, not
 * hand-typed: the S2 legs below are generated one per member, so a third member
 * added later without a leg cannot go silently unproven — it gets a leg for
 * free, and a member DELETED from ci.yml loses its leg loudly.
 */
const alwaysOnMatch = SCRIPT.match(/^\s*ALWAYS_ON="([^"]*)"/m);
const ALWAYS_ON: string[] = alwaysOnMatch ? alwaysOnMatch[1].split(/\s+/).filter(Boolean) : [];
const FILTERABLE = ROWS.filter((r) => !ALWAYS_ON.includes(r));

// ---------------------------------------------------------------------------
// The STRUCTURAL population, re-derived from `ci.yml` TEXT.
//
// ⛔ Nothing below imports a list from the classifier, from the aggregator's
// shell, or from any constant. The re-derivation is what makes the agreement
// EVIDENCE rather than construction — the same statement
// `mutation-runner-floors.test.ts` makes about its own regexes, restated here
// rather than imported, matching the self-containment these pins are built on.
// ---------------------------------------------------------------------------

const CONJUNCT_SUBJECT = "needs.changed-paths.outputs.docs_only";
const NOT_EQUALS_TRUE = `${CONJUNCT_SUBJECT} != 'true'`;
/** ⛔ The fail-OPEN spelling. `'' == 'false'` is FALSE, so an empty detector
 *  output written this way would SKIP the gate instead of running it. */
const EQUALS_FALSE = `${CONJUNCT_SUBJECT} == 'false'`;

const YML_LINES = YML.split("\n");

/**
 * ⚠️ SCOPED SO IT CANNOT ADMIT A TRIGGER KEY. A bare two-space-indent scan over
 * the whole file ALSO matches `push:` under `on:` — measured, and it is the only
 * such leak because the character class excludes the `_` that every other
 * trigger key (`pull_request:`, `workflow_dispatch:`) carries. A population that
 * silently included a trigger would make the exact-set pins below report a
 * phantom unclassified key. So the scan starts AFTER the `jobs:` key, and the
 * fence in the vacuity arm asserts `push` is absent from the result.
 */
const JOBS_KEY_IDX = YML_LINES.indexOf("jobs:");
if (JOBS_KEY_IDX === -1) {
  throw new Error(
    "ci.yml has no top-level `jobs:` key. Every derivation in this file is scoped to the lines " +
      "after it precisely so a trigger key cannot leak into the job-key population; without the " +
      "anchor the scan would silently widen to the whole file.",
  );
}

/** `[jobKey, firstLineIndex]` for every job, in file order. */
const JOB_KEY_POSITIONS: Array<[string, number]> = YML_LINES.map(
  (l, i) => [l, i] as [string, number],
)
  .filter(([l, i]) => i > JOBS_KEY_IDX && /^ {2}[a-z0-9-]+:$/.test(l))
  .map(([l, i]) => [l.trim().replace(/:$/, ""), i] as [string, number]);

const JOB_KEYS: string[] = JOB_KEY_POSITIONS.map(([k]) => k);

/** The raw lines of one job's block, key line to the line before the next key. */
function jobBlockLines(name: string): string[] {
  const at = JOB_KEY_POSITIONS.findIndex(([k]) => k === name);
  if (at === -1) {
    throw new Error(
      `ci.yml has no job key \`${name}\`. This file's rosters name it explicitly; a rename must be ` +
        `made here in the same commit, because an unclassified job key is the silent hole the ` +
        `exact-set pins below exist to close.`,
    );
  }
  const start = JOB_KEY_POSITIONS[at][1];
  const end = at + 1 < JOB_KEY_POSITIONS.length ? JOB_KEY_POSITIONS[at + 1][1] : YML_LINES.length;
  return YML_LINES.slice(start, end);
}

/** Job-LEVEL `if:` lines only (four-space indent); step-level `if:` is deeper. */
function jobIfLines(name: string): string[] {
  return jobBlockLines(name).filter((l) => /^ {4}if: /.test(l));
}

/** Job-LEVEL `needs:` entries, in either the inline-flow or block-list spelling. */
function jobNeeds(name: string): string[] {
  const lines = jobBlockLines(name);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const inline = lines[i].match(/^ {4}needs: \[([^\]]*)\]\s*$/);
    if (inline) {
      out.push(...inline[1].split(",").map((s) => s.trim()).filter(Boolean));
      continue;
    }
    if (/^ {4}needs:\s*$/.test(lines[i])) {
      for (let j = i + 1; j < lines.length; j++) {
        const entry = lines[j].match(/^ {6}- ([\w-]+)\s*$/);
        if (!entry) break;
        out.push(entry[1]);
      }
    }
  }
  return out;
}

/** Non-comment lines of a block — a header must never satisfy a structural pin. */
function jobCodeLines(name: string): string[] {
  return jobBlockLines(name).filter((l) => !/^\s*#/.test(l));
}

/** A job is FILTERED iff a job-level `if:` names the detector output. */
const DERIVED_FILTERED: string[] = JOB_KEYS.filter((k) =>
  jobIfLines(k).some((l) => l.includes(CONJUNCT_SUBJECT)),
);

/** The aggregator and the detector are classified BY NAME, never left over. */
const AGGREGATOR = "frontend";
const DETECTOR = "changed-paths";

/** Everything that is neither filtered nor one of those two is ALWAYS-ON. */
const DERIVED_ALWAYS_ON: string[] = JOB_KEYS.filter(
  (k) => !DERIVED_FILTERED.includes(k) && k !== AGGREGATOR && k !== DETECTOR,
);

/**
 * The hand-typed rosters. ⭐ These are the CLAIM; everything above is the
 * MEASUREMENT. Comparing them as exact sets in both directions is what makes a
 * silent reclassification impossible: a job that gains the conjunct without
 * moving rosters reddens naming itself, and so does one that loses it.
 */
const ROSTER_FILTERED = [
  "deps-cache",
  "frontend-typecheck",
  "frontend-test",
  "frontend-coverage",
  "frontend-seam-redis",
  "frontend-local-stack",
  "frontend-policy",
  "knip",
  "frontend-build",
  "sql-gate-lint",
  "sql-mutation",
  "python",
  "e2e",
  "sql-tests",
  "e2e-seeded",
  "lighthouse-mobile",
];
const ROSTER_ALWAYS_ON = [
  "plan-anchor-verify",
  "secret-scan",
  "version-gate",
  "docs-link-check",
  "frontend-lint",
];

const sorted = (xs: string[]) => [...xs].sort();

/** `text.indexOf(anchor)`, but a miss THROWS by name instead of returning -1. */
function anchorIndex(text: string, anchor: string): number {
  const at = text.indexOf(anchor);
  if (at < 0) {
    throw new Error(
      `ANCHOR MISSING: ${JSON.stringify(anchor)} is not present in the extracted aggregator body. ` +
        `A relative-position pin computed from a -1 would compare a negative index and pass ` +
        `vacuously (JavaScript reads a negative slice index FROM THE END). Fix the anchor or the ` +
        `subject — do not default it.`,
    );
  }
  return at;
}

interface Scenario {
  /** The literal the detector output is substituted with: "true", "false" or "". */
  docsOnly: string;
  /** Row → result. Any row not named here defaults to "success". */
  results: Record<string, string>;
  eventName?: string;
  isForkPr?: boolean;
}

/**
 * Replace every GitHub expression in the extracted body with the scenario's
 * value. ⛔ An unrecognised expression THROWS rather than being passed through:
 * a `${{ ... }}` left in place would be seen by bash as a literal, the scenario
 * would silently not be the scenario, and the test would pass while proving
 * nothing — the same vacuity shape this file exists to remove.
 */
function substitute(script: string, scenario: Scenario): string {
  const eventName = scenario.eventName ?? "pull_request";
  const isForkPr = scenario.isForkPr ?? false;
  const out = script.replace(/\$\{\{([^}]*)\}\}/g, (_whole, rawExpr: string) => {
    const expr = rawExpr.trim();
    const resultMatch = expr.match(/^needs\.([a-zA-Z0-9-]+)\.result$/);
    if (resultMatch) return scenario.results[resultMatch[1]] ?? "success";
    if (expr === "needs.changed-paths.outputs.docs_only") return scenario.docsOnly;
    if (
      expr ===
      "github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name != github.repository"
    ) {
      return String(eventName === "pull_request" && isForkPr);
    }
    if (expr === "github.event_name == 'workflow_dispatch'") return String(eventName === "workflow_dispatch");
    if (expr === "github.event_name == 'pull_request'") return String(eventName === "pull_request");
    throw new Error(
      `CALIBRATION: the aggregator body contains a GitHub expression this test does not know how ` +
        `to substitute: \${{ ${expr} }}. Teach substitute() about it — leaving it unhandled would ` +
        `hand bash a literal and make every scenario below assert against the wrong input.`,
    );
  });

  expect(out, "CALIBRATION: the substitution changed nothing — the scenario was never applied").not.toBe(script);
  expect(
    out.includes("${{"),
    "CALIBRATION: an unsubstituted GitHub expression opener survived into the executed script",
  ).toBe(false);
  return out;
}

const workdir = mkdtempSync(join(tmpdir(), "docspathfilter-"));
afterAll(() => rmSync(workdir, { recursive: true, force: true }));

let scriptSeq = 0;
/**
 * Write ONE step.sh per scenario into the module tempdir and execute it.
 * ⛔ The mutated subject is NEVER written to the real file on disk and never
 * restored with a checkout — this repo has a dated record of `git checkout --`
 * destroying uncommitted work in exactly this neuter/restore shape.
 */
function runGate(scenario: Scenario): { code: number | null; out: string } {
  const scriptPath = join(workdir, `step-${scriptSeq++}.sh`);
  writeFileSync(scriptPath, substitute(SCRIPT, scenario));
  const res = spawnSync("bash", [scriptPath], { cwd: ROOT, encoding: "utf8" });
  return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

/** Every filterable row skipped; ALWAYS_ON rows left at success. */
function allFilterableSkipped(): Record<string, string> {
  return Object.fromEntries(FILTERABLE.map((r) => [r, "skipped"]));
}

describe("[164.6.3 / CI-DOCSPATH-01] the docs-only filter's aggregator arm, EXECUTED", () => {
  it("the extracted body is non-trivial and its roster parsed (vacuity fence)", () => {
    expect(SCRIPT.length, "the extracted aggregator body is empty — every scenario below would be vacuous").toBeGreaterThan(
      500,
    );
    expect(
      ROWS.length,
      "no `<row>=${{ needs.X.result }}` entries parsed out of the aggregator loop — the roster " +
        "derivation broke, so every scenario would drive an empty loop and exit 0 for the wrong reason",
    ).toBeGreaterThanOrEqual(13);
    expect(
      ALWAYS_ON.length,
      "ALWAYS_ON did not parse out of ci.yml. It is the declared list of aggregator rows the docs-only " +
        "filter may never skip; an empty parse would make every S2 leg below disappear silently, which is " +
        "the un-fireable-control shape this milestone exists to remove.",
    ).toBeGreaterThanOrEqual(2);
    expect(FILTERABLE.length, "no filterable rows — S1 would assert nothing").toBeGreaterThan(0);
  });

  // ── S1 — the happy path: docs-only, every filterable row skipped ──────────
  // ⭐ The docs_only value is NOT hard-coded. It is computed by the REAL
  // `judge()` over a real `.planning/`-only fixture list, so this scenario
  // exercises the detector and the aggregator as ONE path. That import is the
  // end-to-end wiring this tracer exists to prove: neuter the classifier's
  // predicate and this scenario changes answer.
  it("S1 — docs-only: skipped filterable rows are tolerated uniformly and the board is GREEN", () => {
    const docsOnly = String(judge([".planning/ROADMAP.md", ".planning/STATE.md"]));
    expect(docsOnly, "CALIBRATION: judge() must say true for a .planning/-only list, or S1 is not S1").toBe("true");

    const { code, out } = runGate({ docsOnly, results: allFilterableSkipped() });
    expect(code, `expected a GREEN board on a docs-only PR.\n${out}`).toBe(0);
    expect(out).toContain("All frontend-* jobs succeeded.");
    // The per-row message must name the row and the detector as the cause.
    expect(out).toContain(
      "sql-gate-lint: skipped by the docs-only path filter (changed-paths said docs_only=true); tolerated UNIFORMLY, not per-row.",
    );
    // ⛔ And it must NOT use the per-row-tolerance vocabulary the four job
    // headers forbid by name. `plan-anchor-verify` is success here, so no
    // pre-existing arm can legitimately print that phrase either.
    expect(out).not.toContain("tolerated for this row only");
  });

  // ── S4 — the code PR: a skip still reddens ───────────────────────────────
  // ROADMAP criterion 2 as an executable assertion.
  it("S4 — code PR: a skipped row still reddens the board", () => {
    const docsOnly = String(judge([".planning/ROADMAP.md", "src/app/page.tsx"]));
    expect(docsOnly, "CALIBRATION: judge() must say false for a mixed list, or S4 is not S4").toBe("false");

    const { code, out } = runGate({ docsOnly, results: { "sql-gate-lint": "skipped" } });
    expect(code, `a skipped gate on a CODE PR must redden the board.\n${out}`).toBe(1);
    expect(out).toContain("One or more frontend-* jobs did not succeed.");
    // The docs-only arm must be INERT here: it must not have excused the row.
    expect(out).not.toContain("skipped by the docs-only path filter");
  });

  // ── S6 — the harness non-vacuity control ─────────────────────────────────
  // Without this, a harness that always exited 1 would pass S4.
  it("S6 — every row success on a code PR: the board is GREEN", () => {
    const docsOnly = String(judge([".planning/ROADMAP.md", "src/app/page.tsx"]));
    const { code, out } = runGate({ docsOnly, results: {} });
    expect(code, `an all-success board must be green.\n${out}`).toBe(0);
    expect(out).toContain("All frontend-* jobs succeeded.");
  });

  // ── S5 — FAIL-CLOSED ─────────────────────────────────────────────────────
  // ⭐ THE SINGLE MOST IMPORTANT PROPERTY IN THIS FILE. When `changed-paths`
  // fails or is cancelled, `needs.changed-paths.outputs.docs_only` is the EMPTY
  // STRING, not "false". That is why every filtered job's `if:` is written in
  // the not-equals-true form (`!= 'true'`) rather than the equals-false form:
  // `'' != 'true'` runs the gate, while `'' == 'false'` would skip it. This
  // scenario discharges the research assumption directly — the behaviour for an
  // empty output is ASSERTED here by execution, not inferred from documentation
  // that does not state the value.
  it("S5 — a failed/cancelled detector (empty output) reddens the board even with every row skipped", () => {
    const { code, out } = runGate({ docsOnly: "", results: allFilterableSkipped() });
    expect(code, `an empty detector output must FAIL CLOSED.\n${out}`).toBe(1);
    expect(out).toContain("One or more frontend-* jobs did not succeed.");
    expect(
      out,
      "an empty docs_only must never be read as a docs-only classification — that is the fail-OPEN direction",
    ).not.toContain("skipped by the docs-only path filter");
  });

  // ── S3 — the tolerance is scoped to exactly `skipped` ────────────────────
  // ⭐ One of the THREE independent conjuncts that keep the uniform arm from
  // greening a code PR. `sql-mutation` is a hermetic job whose header forbids a
  // tolerance arm BY NAME; under a docs-only classification its SKIP is excused,
  // but a `failure` must fall straight through to the strict default. Widening
  // the arm past `skipped` is the prohibition this scenario enforces.
  it("S3 — docs-only: a FAILED filterable row still reddens (the tolerance is `skipped`-only)", () => {
    const docsOnly = String(judge([".planning/ROADMAP.md", ".planning/STATE.md"]));
    expect(docsOnly, "CALIBRATION: S3 is only S3 under a docs-only classification").toBe("true");

    const results = allFilterableSkipped();
    expect(
      results["sql-mutation"],
      "CALIBRATION: sql-mutation must be a FILTERABLE row, or S3 tests the wrong arm",
    ).toBe("skipped");
    results["sql-mutation"] = "failure";

    const { code, out } = runGate({ docsOnly, results });
    expect(code, `a FAILED gate must redden even on a docs-only PR.\n${out}`).toBe(1);
    expect(out).toContain("One or more frontend-* jobs did not succeed.");
    expect(
      out,
      "the uniform arm excused a `failure` — it must match the result EXACTLY, never merely `!= success`",
    ).not.toContain("sql-mutation: skipped by the docs-only path filter");
  });

  // ── S7 — COMPOSITION with the two pre-existing tolerance arms ────────────
  // ⭐ A FORK pull request is the event on which `e2e-seeded` and `sql-tests`
  // have their OWN legitimate skip. Under a docs-only classification they are
  // also filterable rows, so both arms have a claim on them. This scenario is
  // the proof that they COMPOSE rather than collide: the uniform arm, being
  // first, claims those rows and prints its own message, the pre-existing arms
  // are never reached for them, and the board is GREEN.
  // It is also the scenario that catches the arm having been APPENDED at the
  // bottom of the chain: from there the plain filterable rows fall into the
  // strict default and never reach it, and this exits 1.
  it("S7 — docs-only on a FORK PR: the uniform arm and the two pre-existing arms COMPOSE, board GREEN", () => {
    const docsOnly = String(judge([".planning/ROADMAP.md", ".planning/STATE.md"]));
    expect(docsOnly, "CALIBRATION: S7 is only S7 under a docs-only classification").toBe("true");
    for (const row of ["e2e-seeded", "sql-tests"]) {
      expect(
        FILTERABLE,
        `CALIBRATION: ${row} must be a FILTERABLE row, or S7 does not exercise the collision it exists for`,
      ).toContain(row);
    }

    const { code, out } = runGate({
      docsOnly,
      results: allFilterableSkipped(),
      eventName: "pull_request",
      isForkPr: true,
    });
    expect(code, `a docs-only FORK PR must be GREEN.\n${out}`).toBe(0);
    expect(out).toContain("All frontend-* jobs succeeded.");
    // The uniform arm claimed BOTH tolerance-bearing rows, first.
    expect(out).toContain("e2e-seeded: skipped by the docs-only path filter");
    expect(out).toContain("sql-tests: skipped by the docs-only path filter");
    // ⛔ And the per-row vocabulary the four job headers forbid never appeared:
    // control never reached either pre-existing arm for these rows.
    expect(
      out,
      "a pre-existing per-row tolerance arm was reached — the uniform arm is no longer FIRST in the chain",
    ).not.toContain("tolerated for this row only");
  });

  // ── S8 — CALIBRATION: the arm this phase reached PAST still bites ────────
  // ⛔ This is the ONLY scenario that would notice if placing the uniform arm
  // first had weakened `e2e-seeded`'s pre-existing arm. On a SAME-REPO PR with a
  // CODE classification the uniform arm is inert by both its first and second
  // conjuncts, so a skipped `e2e-seeded` must reach its own arm and produce its
  // own distinctive error — not merely redden for some other reason.
  it("S8 — CALIBRATION: code PR, same-repo, e2e-seeded skipped → its PRE-EXISTING arm still fires", () => {
    const docsOnly = String(judge([".planning/ROADMAP.md", "src/app/page.tsx"]));
    expect(docsOnly, "CALIBRATION: S8 is only S8 under a CODE classification").toBe("false");

    const { code, out } = runGate({
      docsOnly,
      results: { "e2e-seeded": "skipped" },
      eventName: "pull_request",
      isForkPr: false,
    });
    expect(code, `a skipped e2e-seeded on a same-repo code PR must exit 1.\n${out}`).toBe(1);
    expect(
      out,
      "e2e-seeded did not reach its OWN arm. This phase reached PAST that arm to place the uniform " +
        "one first; if the pre-existing error text is gone, the reach weakened the arm it went past " +
        "— the go-live badge gate would green-wash on a lost E2E_TEST_DB_CONFIGURED (RT-01 H4).",
    ).toContain("::error::e2e-seeded result=skipped on a TRUSTED event");
    expect(out).toContain("One or more frontend-* jobs did not succeed.");
    expect(
      out,
      "the uniform arm fired on a CODE classification — it must be inert on every code PR",
    ).not.toContain("skipped by the docs-only path filter");
  });

  // ── S2 — the ALWAYS_ON list bites, ONE LEG PER MEMBER ────────────────────
  // ⛔ CALIBRATION, in the same words the sibling tests use: these legs are what
  // make the ALWAYS_ON list non-decorative. Removing EITHER member from the list
  // in ci.yml flips its own leg from exit 1 to exit 0, and that flip is the
  // proof the list is load-bearing. A list nobody can fail is a comment.
  //
  // ⭐ The legs are GENERATED from the membership parsed out of the extracted
  // script, not hand-typed as two blocks — so a third member added to ci.yml
  // later gets a leg for free rather than going silently unproven, and a member
  // deleted from ci.yml loses its leg loudly.
  describe("S2 — under docs_only=true, a skipped ALWAYS_ON row is never excused", () => {
    it.each(ALWAYS_ON)("S2 leg — %s skipped still exits 1", (member) => {
      const docsOnly = String(judge([".planning/ROADMAP.md", ".planning/STATE.md"]));
      expect(docsOnly, "CALIBRATION: S2 is only S2 under a docs-only classification").toBe("true");

      // Every filterable row skipped (they are legitimately filtered), the
      // member under test ALSO skipped, and the other ALWAYS_ON rows success —
      // so the only thing that can redden the board is the member under test.
      const results = allFilterableSkipped();
      for (const m of ALWAYS_ON) results[m] = m === member ? "skipped" : "success";

      const { code, out } = runGate({ docsOnly, results });
      expect(
        code,
        `${member} is on the ALWAYS_ON list: its skip must NOT be excused by the docs-only arm.\n${out}`,
      ).toBe(1);
      expect(out).toContain("One or more frontend-* jobs did not succeed.");
      // ⛔ In both legs the uniform arm must not have claimed this row.
      expect(
        out,
        `the docs-only arm excused ${member}, which the ALWAYS_ON list exists to prevent`,
      ).not.toContain(`${member}: skipped by the docs-only path filter`);
    });

    // S2a — `plan-anchor-verify` HAS its own strict arm, so the leg can assert
    // the row fell through to that arm by its distinctive error text rather
    // than merely that the board is red.
    it("S2a — plan-anchor-verify falls through to its OWN strict arm, by its error text", () => {
      const docsOnly = String(judge([".planning/ROADMAP.md", ".planning/STATE.md"]));
      const results = allFilterableSkipped();
      for (const m of ALWAYS_ON) results[m] = m === "plan-anchor-verify" ? "skipped" : "success";

      const { code, out } = runGate({ docsOnly, results });
      expect(code).toBe(1);
      expect(
        out,
        "the leg must show plan-anchor-verify reached its own strict arm, not merely that something reddened",
      ).toContain("::error::plan-anchor-verify result=skipped");
    });

    // S2b — `frontend-lint` has NO per-row arm; it takes the loop's STRICT
    // DEFAULT, which prints no row-specific message. So the assertion is on the
    // generic error PLUS an ABSENCE, and that distinction is what makes this leg
    // able to fail rather than a restatement of S2a.
    //
    // ⭐ THIS IS THE LEG THAT MATTERS. `frontend-lint` runs `npm run lint`, which
    // runs `scripts/check-planning-hygiene.ts` — the leak gate on a PUBLIC repo
    // with `.planning/` TRACKED, whose subject IS a `.planning/`-only
    // agent-written diff. Filtering it would silently regress the one gate aimed
    // squarely at this PR class.
    // ⚠️ The job CANNOT reach this state today: it carries no `if:` and no
    // `needs:` edge, so it is never `skipped` and the arm can never see it. The
    // leg is therefore DEFENCE IN DEPTH against a future edit that gives it a
    // skip route. ⛔ Do not delete it as unreachable — unreachable-today is why
    // it is cheap, not a reason it is useless.
    it("S2b — frontend-lint takes the STRICT DEFAULT: aggregate error present, uniform arm's message absent", () => {
      expect(
        ALWAYS_ON,
        "frontend-lint must be on the ALWAYS_ON list — it is the planning-hygiene leak gate on a public repo",
      ).toContain("frontend-lint");

      const docsOnly = String(judge([".planning/ROADMAP.md", ".planning/STATE.md"]));
      const results = allFilterableSkipped();
      for (const m of ALWAYS_ON) results[m] = m === "frontend-lint" ? "skipped" : "success";

      const { code, out } = runGate({ docsOnly, results });
      expect(code, `a skipped frontend-lint under docs_only=true must exit 1.\n${out}`).toBe(1);
      // PRESENT: the strict default's aggregate verdict.
      expect(out).toContain("One or more frontend-* jobs did not succeed.");
      // ABSENT: the uniform arm never named it. `frontend-lint` prints no
      // row-specific error of its own, so the absence IS the assertion.
      expect(out).not.toContain("frontend-lint: skipped by the docs-only path filter");
    });
  });
});

describe("[164.6.3 / CI-DOCSPATH-01] the PARTITION, pinned as an exact set in BOTH directions", () => {
  // ── vacuity fences ───────────────────────────────────────────────────────
  // ⛔ A set-equality assertion over two EMPTY sets passes and proves nothing.
  // That is the defect class this whole file lives inside, so every derived
  // population below is fenced before it is compared, in the same form
  // `mutation-runner-floors.test.ts` uses for its own re-derivations.
  it("the derived populations are non-empty and trigger-free (vacuity fence)", () => {
    expect(
      JOB_KEYS.length,
      "no job keys parsed out of ci.yml — every exact-set assertion below would compare two empty " +
        "sets, pass, and prove nothing",
    ).toBeGreaterThanOrEqual(20);
    expect(
      DERIVED_FILTERED.length,
      "no job carries the docs-only conjunct on a job-level `if:` — the filter is GONE from ci.yml, " +
        "and the exact-set pins below would be comparing an empty measurement to a full claim",
    ).toBeGreaterThan(0);
    expect(
      JOB_KEYS,
      "the job-key scan escaped the `jobs:` block and swallowed the `push:` TRIGGER. Every exact-set " +
        "pin below would then report a phantom unclassified key and send the reader to classify a " +
        "trigger as a job.",
    ).not.toContain("push");
    // Duplicate keys would make a set comparison agree while the file is invalid.
    expect(new Set(JOB_KEYS).size, "ci.yml has a DUPLICATE job key").toBe(JOB_KEYS.length);
  });

  // ── the partition closes ─────────────────────────────────────────────────
  it("filtered ∪ always-on ∪ {aggregator, detector} is EXACTLY the job-key set", () => {
    const classified = new Set([...DERIVED_FILTERED, ...DERIVED_ALWAYS_ON, AGGREGATOR, DETECTOR]);
    const unclassified = JOB_KEYS.filter((k) => !classified.has(k));
    expect(
      unclassified,
      `ci.yml carries job key(s) that belong to NEITHER set: ${unclassified.join(", ")}. Classify ` +
        `each one — add it to ROSTER_FILTERED and give it \`needs: [changed-paths]\` plus the ` +
        `docs-only conjunct, or add it to ROSTER_ALWAYS_ON and give it neither. A job that nobody ` +
        `classifies defaults to whichever set the person who wrote it happened to land in, which is ` +
        `the silent hole this pin exists to close.`,
    ).toEqual([]);
    expect(sorted([...classified]), "a classified name is not a job key in ci.yml").toEqual(sorted(JOB_KEYS));
  });

  it("the FILTERED set equals its roster of sixteen, in both directions", () => {
    const gained = DERIVED_FILTERED.filter((k) => !ROSTER_FILTERED.includes(k));
    const lost = ROSTER_FILTERED.filter((k) => !DERIVED_FILTERED.includes(k));
    expect(
      gained,
      `job(s) GAINED the docs-only conjunct without moving the roster: ${gained.join(", ")}. ` +
        `A silent move between the two sets is the gate-silently-not-running shape this milestone ` +
        `exists to remove — update ROSTER_FILTERED in the same commit or revert the conjunct.`,
    ).toEqual([]);
    expect(
      lost,
      `job(s) LOST the docs-only conjunct: ${lost.join(", ")}. That is not an optimisation, it is a ` +
        `job that now runs on every docs-only PR (harmless) or — if its \`needs:\` edge also went — ` +
        `a job whose classification is no longer readable in the run log.`,
    ).toEqual([]);
    expect(DERIVED_FILTERED.length).toBe(16);
  });

  it("every filtered job ALSO carries the `changed-paths` needs: edge", () => {
    const missing = DERIVED_FILTERED.filter((k) => !jobNeeds(k).includes(DETECTOR));
    expect(
      missing,
      `filtered job(s) whose \`if:\` reads \`needs.changed-paths.outputs.docs_only\` while ` +
        `\`changed-paths\` is NOT in their \`needs:\`: ${missing.join(", ")}. GitHub evaluates the ` +
        `condition against a job this one does not depend on, so the output is the empty string and ` +
        `the gate runs unconditionally — the filter would be silently dead for that job.`,
    ).toEqual([]);
  });

  it("the ALWAYS-ON set equals its roster of five, and carries NEITHER the edge NOR the conjunct", () => {
    expect(
      sorted(DERIVED_ALWAYS_ON),
      `the always-on set drifted. It is ${ROSTER_ALWAYS_ON.join(", ")} and nothing else: ` +
        `plan-anchor-verify's whole subject IS \`.planning/**\`; secret-scan guards a PUBLIC repo ` +
        `with \`.planning/\` TRACKED; version-gate already exempts planning-only PRs from INSIDE ` +
        `check-version-bump.mjs and must not gain a second mechanism; docs-link-check is a docs ` +
        `gate; and frontend-lint chains check-planning-hygiene.ts, the no-allowlist leak gate aimed ` +
        `squarely at this PR class.`,
    ).toEqual(sorted(ROSTER_ALWAYS_ON));

    for (const job of ROSTER_ALWAYS_ON) {
      expect(
        jobNeeds(job),
        `${job} gained a \`needs: changed-paths\` edge. A skipped or failed \`needs:\` job SKIPS its ` +
          `dependents, so that edge alone is enough to silence an always-on gate even with no \`if:\`.`,
      ).not.toContain(DETECTOR);
      expect(
        jobIfLines(job).filter((l) => l.includes(CONJUNCT_SUBJECT)),
        `${job} gained the docs-only conjunct. It is an always-on gate: filtering it is a REGRESSION ` +
          `wearing an optimisation's clothes, and for secret-scan and frontend-lint it is one on a ` +
          `PUBLIC repo whose \`.planning/\` is TRACKED.`,
      ).toEqual([]);
    }
  });

  // ── the aggregator's shell list, pinned against the DERIVED intersection ─
  it("the aggregator's ALWAYS_ON shell list equals (always-on ∩ aggregator needs:), both directions", () => {
    const aggNeeds = jobNeeds(AGGREGATOR);
    expect(
      aggNeeds.length,
      "the aggregator's `needs:` list did not parse — the intersection below would be empty and the pin vacuous",
    ).toBeGreaterThanOrEqual(10);
    expect(
      ALWAYS_ON.length,
      "the aggregator's ALWAYS_ON shell list did not parse — the pin below would compare two empty sets",
    ).toBeGreaterThan(0);

    const expected = DERIVED_ALWAYS_ON.filter((k) => aggNeeds.includes(k));
    expect(
      expected.length,
      "no always-on job is also an aggregator row — the intersection is empty and this pin would be vacuous",
    ).toBeGreaterThan(0);

    expect(
      sorted(ALWAYS_ON),
      `the aggregator's ALWAYS_ON shell list is no longer (always-on roster ∩ aggregator \`needs:\`). ` +
        `Derived: ${sorted(expected).join(", ")}. In ci.yml: ${sorted(ALWAYS_ON).join(", ")}. ` +
        `CONSEQUENCE of a MISSING member: that row is an always-on job AND an aggregator row, so a ` +
        `\`skipped\` result for it can be EXCUSED by the uniform docs-only arm — and for ` +
        `frontend-lint that is check-planning-hygiene.ts, the leak gate on a PUBLIC repo with ` +
        `\`.planning/\` TRACKED. CONSEQUENCE of an EXTRA member: a filterable job can never be ` +
        `excused and every docs-only PR reddens. This pin is what keeps the list from shrinking ` +
        `back to one member.`,
    ).toEqual(sorted(expected));
    expect(aggNeeds, "the aggregator stopped depending on `changed-paths`, so `docs_only` is the empty string in its loop").toContain(
      DETECTOR,
    );
  });

  // ── the detector itself ──────────────────────────────────────────────────
  it("`changed-paths` carries NO job-level `if:` at all", () => {
    expect(
      jobIfLines(DETECTOR),
      "the detector gained a job-level `if:`. A conditional detector does not skip ONE gate — every " +
        "filtered job carries `needs: [changed-paths]`, and a skipped `needs:` job SKIPS its " +
        "dependents, so a condition here silently skips the WHOLE corpus. That is the exact " +
        "fail-open this phase exists to refuse.",
    ).toEqual([]);
  });

  // ── the CONDITION FORM: one physical line, fail-closed spelling ──────────
  it("every filtered condition is ONE physical line in the not-equals-true form", () => {
    for (const job of DERIVED_FILTERED) {
      const bearing = jobIfLines(job).filter((l) => l.includes(CONJUNCT_SUBJECT));
      expect(
        bearing.length,
        `${job}: expected exactly ONE job-level \`if:\` line carrying the conjunct, found ` +
          `${bearing.length}. A folded or duplicated condition breaks the single-line regexes other ` +
          `gates match this file with — critical-regressions.test.ts reads e2e-seeded's ` +
          `\`vars.E2E_TEST_DB_CONFIGURED\` gate that way and a fold reads as a LOST job-level gate, ` +
          `which looks like a security regression and is not one.`,
      ).toBe(1);
      expect(
        bearing[0],
        `${job}: the conjunct is not in the not-equals-true form. Write \`${NOT_EQUALS_TRUE}\`.`,
      ).toContain(NOT_EQUALS_TRUE);
      expect(
        bearing[0].trimEnd(),
        `${job}: the \`if:\` line ends on an operator, so the condition continues onto a second ` +
          `physical line. Keep it on one.`,
      ).not.toMatch(/(&&|\|\||\(|>|\|)$/);
    }
  });

  it("the fail-OPEN equals-false form appears in NO filtered condition", () => {
    const offenders = DERIVED_FILTERED.filter((k) =>
      jobCodeLines(k).some((l) => l.includes(EQUALS_FALSE)),
    );
    expect(
      offenders,
      `job(s) written in the fail-OPEN spelling \`${EQUALS_FALSE}\`: ${offenders.join(", ")}. When ` +
        `\`changed-paths\` fails or is cancelled its output is the EMPTY STRING, not "false". ` +
        `\`'' != 'true'\` RUNS the gate; \`'' == 'false'\` SKIPS it. Scenario S5 executes that ` +
        `difference; this pin makes it unwritable.`,
    ).toEqual([]);
    // Fence: the needle must be findable at all, or the absence proves nothing.
    expect(
      YML.includes(NOT_EQUALS_TRUE),
      "the not-equals-true form is absent from ci.yml entirely — the absence asserted above would be " +
        "the absence of the whole mechanism, not the absence of a bad spelling",
    ).toBe(true);
  });

  // ── the arm's PLACEMENT, pinned by relative position ─────────────────────
  it("the uniform arm is the FIRST branch of the loop's chain, by position", () => {
    const uniform = `if [ "$docs_only" = "true" ] && [ "$filterable" = "true" ] && [ "$result" = "skipped" ]; then`;
    const uniformAt = anchorIndex(SCRIPT, uniform);

    const perRow = [...SCRIPT.matchAll(/elif \[ "\$name" = "([a-z0-9-]+)" \]; then/g)];
    expect(
      perRow.length,
      "no per-row `elif [ \"$name\" = ... ]` branches found in the extracted loop — the pre-existing " +
        "tolerance arms are gone, and the position assertion below would have nothing to be before",
    ).toBeGreaterThanOrEqual(3);
    const firstPerRowAt = Math.min(...perRow.map((m) => m.index as number));

    expect(
      uniformAt,
      `the uniform docs-only arm is no longer FIRST in the loop's chain — the first per-row branch ` +
        `(\`${perRow.find((m) => (m.index as number) === firstPerRowAt)?.[1]}\`) comes before it. ` +
        `Appended lower it is UNREACHABLE on exactly the PRs this phase speeds up: e2e-seeded's arm ` +
        `and sql-tests' arm both compute is_fork_pr=false on a same-repo PR and set fail=1 before ` +
        `control could reach a later branch, and every docs-only PR would be RED. Scenario S7 ` +
        `executes the consequence; this pin catches the move even though every string is still present.`,
    ).toBeLessThan(firstPerRowAt);

    // ⭐ And it is an `if`, not an `elif`: a branch is only first if nothing
    // above it can claim the row.
    expect(
      SCRIPT.slice(Math.max(0, uniformAt - 5), uniformAt + 4),
      "the uniform arm was demoted from `if` to `elif` — something else now gets first claim on the row",
    ).not.toContain("elif");
  });

  // ── the trigger stays job-level ──────────────────────────────────────────
  it("neither trigger carries a `paths:` / `paths-ignore:` key", () => {
    const onAt = YML_LINES.indexOf("on:");
    expect(onAt, "ci.yml has no top-level `on:` key — the slice below would be empty and this pin vacuous").toBeGreaterThanOrEqual(
      0,
    );
    let end = YML_LINES.length;
    for (let i = onAt + 1; i < YML_LINES.length; i++) {
      if (/^[a-zA-Z]/.test(YML_LINES[i])) {
        end = i;
        break;
      }
    }
    const onBlock = YML_LINES.slice(onAt, end);
    // Fence: both triggers must actually be inside the slice.
    expect(onBlock, "the `on:` slice does not contain the `push:` trigger").toContain("  push:");
    expect(onBlock, "the `on:` slice does not contain the `pull_request:` trigger").toContain("  pull_request:");

    const offenders = onBlock.filter((l) => /^\s+paths(-ignore)?:/.test(l) && !/^\s*#/.test(l));
    expect(
      offenders,
      `a workflow-level path filter appeared under \`on:\`: ${offenders.join(" | ")}. It is REJECTED ` +
        `on evidence, not taste: it is all-or-nothing and would also suppress plan-anchor-verify — ` +
        `whose whole subject is \`.planning/**\` — and secret-scan on a PUBLIC repo. The mechanism ` +
        `is job-level and must stay job-level.`,
    ).toEqual([]);

    // ⛔ And the `push:` trigger's own branch list is untouched: CONTEXT.md
    // REFUSES filtering it, because deploy automation and Railway both key on a
    // per-SHA green run of main CI.
    const pushAt = onBlock.indexOf("  push:");
    expect(
      onBlock[pushAt + 1],
      "the `push:` trigger's `branches: [main]` moved or changed. Filtering the push corpus is " +
        "REFUSED in CONTEXT.md: every commit to main must produce its own recorded green run, and " +
        "Railway waits on main CI and SKIPS the analytics deploy when it is red.",
    ).toBe("    branches: [main]");
  });
});

// ---------------------------------------------------------------------------
// ⛔ CALIBRATION — THE DETECTOR'S OWN RED PATH, MANUFACTURED AND OBSERVED.
//
// ⭐ THE DIRECTION MATTERS AND IT IS THE REASON THIS BLOCK EXISTS. Neutering the
// detector produces a GREEN, SHORT board, not a red one: a classifier that says
// `docs_only=true` on a code diff skips sixteen gates and the aggregator's
// uniform arm excuses every one of them. A control that waits for red to appear
// on its own would never fire here. So the red is MANUFACTURED — the allow-list
// is widened on a COPY — and then OBSERVED.
//
// ⛔ The mutation is applied to a `mkdtempSync` copy and NEVER to the file on
// disk, and nothing here restores with a checkout: this repo has a dated record
// of `git checkout --` in a neuter/restore harness silently destroying
// uncommitted work, and the byte-backup remedy goes stale mid-edit. A tempdir
// copy has neither failure mode. `git status --porcelain
// scripts/classify-changed-paths.mjs` is a verify command on this plan for
// exactly that reason.
//
// ⭐ PLACEMENT, because this is the arm a reader will question. This file runs
// in `frontend-test`, which this phase FILTERS. That is sound, not circular: a
// docs-only PR cannot BY CONSTRUCTION change
// `scripts/classify-changed-paths.mjs` — it is not under the `.planning/`
// allow-list, and the classifier's own self-test row 4 pins that — so every PR
// that can break this arm's subject is a code PR on which `frontend-test` runs.
// ---------------------------------------------------------------------------
describe("[164.6.3 / CI-DOCSPATH-01] CALIBRATION — the classifier's self-test can FAIL", () => {
  const ORIGINAL = readFileSync(CLASSIFIER, "utf8");

  /** The allow-list declaration — the widening neuter's target. */
  const ALLOWLIST_DECL = 'export const DOCS_ONLY_PREFIXES = [".planning/"];';
  /** The `.every` quantifier — the loosening neuter's target. */
  const EVERY_DECL = "return changedFiles.every((f) => DOCS_ONLY_PREFIXES.some((p) => f.startsWith(p)));";

  const FAILED_BANNER = "=== SELF-TEST FAILED ===";
  const PASSED_BANNER = "=== SELF-TEST PASSED:";

  let seq = 0;
  /** Write `src` into the module tempdir and run ITS `--self-test`. */
  function selfTest(src: string): { code: number | null; out: string } {
    const path = join(workdir, `classifier-${seq++}.mjs`);
    writeFileSync(path, src);
    const res = spawnSync(process.execPath, [path, "--self-test"], { cwd: ROOT, encoding: "utf8" });
    return { code: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
  }

  /**
   * ⛔ ASSERT THE MUTATION APPLIED BEFORE BELIEVING ANYTHING. A neuter that does
   * not APPLY reads as GREEN — the subject still holds its real predicate, the
   * self-test still passes, and the arm certifies nothing while looking like
   * evidence. This is the whole point of the block.
   */
  function mutate(target: string, replacement: string, label: string): string {
    expect(
      ORIGINAL.includes(target),
      `CALIBRATION ${label}: the mutation target is not present in scripts/classify-changed-paths.mjs. ` +
        `Nothing would be replaced, the copy would be byte-identical to the real classifier, its ` +
        `self-test would PASS, and the red below would never be observed. Re-anchor the target.`,
    ).toBe(true);
    const mutated = ORIGINAL.replace(target, replacement);
    expect(
      mutated,
      `CALIBRATION ${label}: the mutated text is identical to the original — the neuter did not apply`,
    ).not.toBe(ORIGINAL);
    expect(
      mutated.includes(target),
      `CALIBRATION ${label}: the original declaration SURVIVED the mutation, so the copy still carries ` +
        `the real predicate and the red below would be measuring the wrong program`,
    ).toBe(false);
    return mutated;
  }

  // ── the non-vacuity control ──────────────────────────────────────────────
  // ⛔ WITHOUT THIS THE TWO NEUTER LEGS PROVE NOTHING. An arm that always saw a
  // non-zero exit — a broken spawn, a missing interpreter, a bad cwd, an
  // unwritable tempdir — would pass both legs while measuring the harness
  // instead of the subject. The control spawns the UNMUTATED copy through the
  // SAME call and requires exit 0.
  it("NON-VACUITY CONTROL — the UNMUTATED copy self-tests GREEN through the same spawn", () => {
    const { code, out } = selfTest(ORIGINAL);
    expect(code, `the unmutated classifier must exit 0 through this harness.\n${out}`).toBe(0);
    expect(out).toContain(PASSED_BANNER);
    expect(out, "a passing self-test must print no FAIL row").not.toContain("  FAIL");
  });

  // ── neuter leg 1: WIDEN the allow-list ───────────────────────────────────
  it("CALIBRATION — widening the allow-list to accept everything turns the self-test RED", () => {
    const mutated = mutate(ALLOWLIST_DECL, 'export const DOCS_ONLY_PREFIXES = [""];', "widening");

    const { code, out } = selfTest(mutated);
    expect(
      code,
      "the widened classifier must EXIT NON-ZERO. The empty-string prefix makes every path match, so " +
        "EVERY fixture row whose expected verdict is CODE must break: the mixed diff, ci.yml alone, " +
        "the classifier's own file, a migration alone, all five allow-list lookalikes " +
        "(README.md / docs/runbooks / CHANGELOG.md / VERSION / TODOS.md), both prefix-boundary rows " +
        "and the traversal row. If this exits 0 the self-test table has stopped covering the " +
        "allow-list, and the filter's single point of trust is unguarded.\n" +
        out,
    ).not.toBe(0);
    expect(out, "the terminal failed banner is absent — the self-test did not reach its own verdict").toContain(
      FAILED_BANNER,
    );
    expect(out).toContain("FAIL — one code file anywhere in the list makes the whole diff code");
    expect(out).toContain("FAIL — a sibling directory sharing the prefix does not launder into the allow-list");
    expect(out).toContain("FAIL — a PR editing this very file is never filtered");
  });

  // ── neuter leg 2: the OTHER polarity ─────────────────────────────────────
  // ⭐ Two independent mutations, so the arm shows that BOTH the widening
  // (the allow-list accepts too much) and the loosening (the quantifier asks
  // too little) are caught. One leg alone would leave the other untested.
  it("CALIBRATION — loosening the quantifier (`every` → `some`) turns the self-test RED", () => {
    const mutated = mutate(
      EVERY_DECL,
      "return changedFiles.some((f) => DOCS_ONLY_PREFIXES.some((p) => f.startsWith(p)));",
      "loosening",
    );

    const { code, out } = selfTest(mutated);
    expect(
      code,
      "the loosened classifier must EXIT NON-ZERO. `some` makes ONE `.planning/` file enough to " +
        "classify a whole mixed diff as docs-only — a gate-disable primitive on any PR that touches " +
        "a plan alongside code, which is the common GSD shape. The rows that must break are the " +
        "mixed-diff row and the `.planningfake/` prefix-boundary row.\n" + out,
    ).not.toBe(0);
    expect(out).toContain(FAILED_BANNER);
    expect(out).toContain("FAIL — one code file anywhere in the list makes the whole diff code");
    expect(out).toContain("FAIL — a sibling directory sharing the prefix does not launder into the allow-list");
  });

  // ── the tree is untouched ────────────────────────────────────────────────
  it("the checked-out classifier is byte-unchanged by the mutations above", () => {
    expect(
      readFileSync(CLASSIFIER, "utf8"),
      "scripts/classify-changed-paths.mjs changed on disk while this block ran. The mutations are " +
        "string operations on a tempdir copy and must NEVER reach the working tree — a mutation " +
        "harness that writes to the tree can destroy concurrent uncommitted work.",
    ).toBe(ORIGINAL);
  });
});
