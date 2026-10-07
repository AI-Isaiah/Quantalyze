import { afterAll, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { DRIFT_STEP_RUN_LINE, judge, TEST_READ_PLANNING_PATHS, TOLERATED_DRIFT_CHECK } from "../../../scripts/classify-changed-paths.mjs";

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
  "frontend-live-db-lane",
  "frontend-policy",
  "knip",
  "frontend-build",
  "sql-gate-lint",
  "sql-mutation",
  "python",
  "e2e",
  "sql-tests",
  // Phase 164.4.2 (DECISION B): VAC-08 left `sql-tests` for a job of its own and
  // inherited the same docs-only conjunct and `changed-paths` edge `sql-tests`
  // carries (which `sql-tests` keeps), so it is a FILTERED job by construction. Seventeen became eighteen here, in the
  // same commit that reads the new ci.yml — not by a silent move between sets.
  "test-db-drift",
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

  // ── S1p — the docs-only PUSH to main (Phase 164.9.4 review WR-01) ────────
  // The classifier now says docs_only=true for a `.planning/`-only push range.
  // A push is a TRUSTED event, so e2e-seeded's and test-db-drift's own arms
  // would redden a skip there. This scenario proves the uniform arm, being
  // first, claims them, and the push still gets a GREEN recorded run rather
  // than a red one or none.
  it("S1p — docs-only PUSH: skipped filterable rows are tolerated and the board is GREEN", () => {
    const docsOnly = String(judge([".planning/ROADMAP.md"]));
    expect(docsOnly, "CALIBRATION: S1p is only S1p under a docs-only classification").toBe("true");

    const { code, out } = runGate({ docsOnly, results: allFilterableSkipped(), eventName: "push" });
    expect(code, `expected a GREEN board on a docs-only push.\n${out}`).toBe(0);
    expect(out).toContain("All frontend-* jobs succeeded.");
    expect(out).toContain("e2e-seeded: skipped by the docs-only path filter");
    expect(out).toContain("test-db-drift: skipped by the docs-only path filter");
    expect(out).not.toContain("on a TRUSTED event");
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
  // ⭐ A FORK pull request is the event on which `e2e-seeded` and `test-db-drift`
  // have their OWN legitimate skip. (`test-db-drift` took that skip over from
  // `sql-tests` in Phase 164.4.2: it holds the shared-TEST secret and the fork
  // gate now, and `sql-tests` runs on a private lane on every event, so a fork
  // PR no longer skips it and its per-row tolerance arm is gone.) Under a docs-only classification they are
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
    for (const row of ["e2e-seeded", "test-db-drift"]) {
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
    expect(out).toContain("test-db-drift: skipped by the docs-only path filter");
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

  it("the FILTERED set equals its roster of eighteen, in both directions", () => {
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
    expect(DERIVED_FILTERED.length).toBe(18);
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

  // ── review 164.9.4 round 2, SFH-04 (round 3, WR-01): the predecessor lookup's credentials ─
  it("`changed-paths` declares exactly `contents: read` + `checks: read` + `actions: read`, and only `classify` and `sql_gate_subset` get GH_TOKEN", () => {
    const block = jobBlockLines(DETECTOR);
    const at = block.findIndex((l) => /^ {4}permissions:\s*$/.test(l));
    expect(
      at,
      "`changed-paths` has no job-level `permissions:` block. The push classifier reads `before`'s " +
        "GitHub Actions check runs and needs `checks: read`; without it every lookup fails and every " +
        "docs-only push silently loses its short path (safe, but the founder's routing stops working).",
    ).toBeGreaterThan(-1);
    const perms: string[] = [];
    for (let i = at + 1; i < block.length && /^ {6}\S/.test(block[i]); i += 1) perms.push(block[i].trim());
    // A job-level block REPLACES the workflow-level one: `contents: read` must
    // be restated, and nothing broader may ride in beside the one uplift.
    // Round 3 WR-01, round 4 CR-01 + WR-01: the classifier reads every check run
    // and every check suite on `before`, both of which `checks: read` covers.
    // 2026-10-03, Phase 164.9.6.1 D-02: the SQL gate subset's tolerant
    // predecessor proof reads the `sql-gate-lint` job log through the job-logs
    // endpoint, which needs `actions: read`; that is the one scope added, and
    // nothing broader may ride in beside it.
    expect(perms.sort()).toEqual(["actions: read", "checks: read", "contents: read"]);
    // Review 164.9.6 WR-03: the SQL gate subset derivation reuses the
    // classifier's predecessor proof before a push narrows, so it is the one
    // other step that reads the token. Each token line is pinned to its step,
    // so a third step gaining the token, or the token moving, is red.
    const tokenSteps = block.flatMap((l, i) => {
      if (!/^\s+GH_TOKEN:/.test(l)) return [];
      expect(l.trim(), `GH_TOKEN at block line ${i} must be the job token, read through env:`).toBe("GH_TOKEN: ${{ github.token }}");
      for (let j = i; j >= 0; j -= 1) {
        const m = block[j].match(/^ {6}- (?:id: (\S+)|\S)/);
        if (m) return [m[1] ?? `(an unnamed step above block line ${i})`];
      }
      return [`(no step above block line ${i})`];
    });
    expect(tokenSteps, "GH_TOKEN must reach exactly the classify and sql_gate_subset steps").toEqual(["classify", "sql_gate_subset"]);
  });

  // ── Phase 164.9.6.1 (D-02, D-04): the tolerant predecessor proof stays alive and stays scoped ─
  it("the `sql-gate-lint` job's drift step carries exactly the `run:` line the tolerant log parser requires", () => {
    // The tolerant proof accepts a red predecessor only when the LAST step
    // header in the `sql-gate-lint` job log is `##[group]Run ` + this exact
    // line. If the step's `run:` line moves or the job is renamed, the proof
    // can never match and every drift-red predecessor silently forces FULL
    // again: safe, but the D-02 routing stops working without anyone seeing it.
    expect(TOLERATED_DRIFT_CHECK).toBe("sql-gate-lint");
    expect(
      JOB_KEYS,
      `ci.yml has no job keyed \`${TOLERATED_DRIFT_CHECK}:\`. Its check-run name is what TOLERATED_DRIFT_CHECK ` +
        "matches, so the tolerant predecessor proof could never engage.",
    ).toContain(TOLERATED_DRIFT_CHECK);
    const block = jobBlockLines(TOLERATED_DRIFT_CHECK);
    expect(
      block.filter((l) => /^ {4}name:/.test(l)),
      "a job-level `name:` would rename the check run away from the job key TOLERATED_DRIFT_CHECK matches",
    ).toEqual([]);
    const runs = block.filter((l) => /^\s+run: /.test(l)).map((l) => l.replace(/^\s+run: /, ""));
    expect(runs.length, "vacuity fence: the sql-gate-lint job carries no `run:` line at all").toBeGreaterThan(0);
    expect(
      runs.filter((r) => r === DRIFT_STEP_RUN_LINE).length,
      `exactly one step of \`${TOLERATED_DRIFT_CHECK}\` must have \`run: ${DRIFT_STEP_RUN_LINE}\` with nothing after it. ` +
        "Otherwise the tolerant predecessor proof can never match the drift step's log header, and every " +
        "drift-red predecessor silently forces a FULL sql-mutation run again (Phase 164.9.6.1 D-02).",
    ).toBe(1);
  });

  it("D-04: only `sql-gate-subset.mjs` opts into the tolerance; `classifyPushRange`'s predecessorVerdict call has exactly two arguments", () => {
    /** Strip block and line comments, so prose explaining the scope cannot turn a pin red. */
    const stripComments = (src: string): string =>
      src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
    /** The top-level argument list of every `predecessorVerdict(` call in `src`. */
    const callArgs = (src: string): string[][] => {
      const out: string[][] = [];
      let at = src.indexOf("predecessorVerdict(");
      while (at !== -1) {
        let depth = 0;
        let arg = "";
        const args: string[] = [];
        for (let i = at + "predecessorVerdict(".length; i < src.length; i += 1) {
          const c = src[i];
          if (depth === 0 && c === ")") break;
          if ("([{".includes(c)) depth += 1;
          if (")]}".includes(c)) depth -= 1;
          if (depth === 0 && c === ",") {
            args.push(arg.trim());
            arg = "";
          } else arg += c;
        }
        if (arg.trim()) args.push(arg.trim());
        out.push(args);
        at = src.indexOf("predecessorVerdict(", at + 1);
      }
      return out;
    };
    const classifier = readFileSync(CLASSIFIER, "utf8");
    const start = classifier.indexOf("export function classifyPushRange(");
    expect(start, "scripts/classify-changed-paths.mjs has no `export function classifyPushRange(`").toBeGreaterThan(-1);
    const end = classifier.indexOf("\n}\n", start);
    expect(end, "classifyPushRange's body has no closing brace at column 0").toBeGreaterThan(start);
    const body = stripComments(classifier.slice(classifier.indexOf("{\n", start), end));
    const docsCalls = callArgs(body);
    expect(docsCalls.length, "classifyPushRange must call predecessorVerdict exactly once (vacuity fence)").toBe(1);
    expect(
      docsCalls[0],
      "D-04: the docs-only short path keeps the STRICT predecessor rule. A third argument to its " +
        "predecessorVerdict call could opt it into the drift tolerance, so a docs-only push on a drift-red " +
        "main would skip CI while main reads green over an unresolved drift.",
    ).toEqual(["sha", "fetchPredecessor"]);
    const subset = stripComments(readFileSync(join(ROOT, "scripts/sql-gate-subset.mjs"), "utf8"));
    const optIns = callArgs(subset).filter((a) => a.length === 3 && /\btolerateBaselineDrift:\s*true\b/.test(a[2]));
    expect(
      optIns.length,
      "scripts/sql-gate-subset.mjs must call predecessorVerdict with { tolerateBaselineDrift: true } (Phase " +
        "164.9.6.1 D-02): without it a drift-only red main forces every next push's sql-mutation to FULL again.",
    ).toBe(1);
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

    // ⚠️ BOTH spellings, deliberately. Matching only `elif` would miss the very
    // mutation this pin exists for: moving the uniform arm to the bottom
    // PROMOTES the first per-row branch to a bare `if`, the population would
    // then be one short, and the arm would redden on its own vacuity FENCE
    // instead of on the position — a red that names the wrong cause and sends
    // the reader to the wrong place. Measured here while calibrating this pin.
    const perRow = [...SCRIPT.matchAll(/\b(?:el)?if \[ "\$name" = "([a-z0-9-]+)" \]; then/g)];
    expect(
      perRow.length,
      'no per-row `[el]if [ "$name" = ... ]` branches found in the extracted loop — the pre-existing ' +
        "tolerance arms are gone, and the position assertion below would have nothing to be before",
    ).toBeGreaterThanOrEqual(3);
    const firstPerRowAt = Math.min(...perRow.map((m) => m.index as number));

    expect(
      uniformAt,
      `the uniform docs-only arm is no longer FIRST in the loop's chain — the first per-row branch ` +
        `(\`${perRow.find((m) => (m.index as number) === firstPerRowAt)?.[1]}\`) comes before it. ` +
        `Appended lower it is UNREACHABLE on exactly the PRs this phase speeds up: e2e-seeded's arm ` +
        `and test-db-drift's arm both compute is_fork_pr=false on a same-repo PR and set fail=1 before ` +
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

    // ⛔ And the `push:` trigger's own branch list is untouched: deploy
    // automation and Railway both key on a per-SHA green run of main CI.
    // (2026-10-01, Phase 164.9.4 review WR-01: a docs-only push is now
    // classified SHORT at JOB level by the founder's 2026-09-27 routing. It
    // still produces a run, which is exactly why the trigger must stay
    // unfiltered: a workflow-level filter would produce NO run at all.)
    const pushAt = onBlock.indexOf("  push:");
    expect(
      onBlock[pushAt + 1],
      "the `push:` trigger's `branches: [main]` moved or changed. Every commit to main must produce " +
        "its own recorded run, and Railway waits on main CI and SKIPS the analytics deploy when it is " +
        "red. A docs-only push is shortened at JOB level only (Phase 164.9.4), never at the trigger.",
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
// ---------------------------------------------------------------------------
// Review 164.9.4 round 2, WR-01 (founder decision 2026-10-02): a push touching a
// `.planning/` file a test assertion reads is CODE. The classifier's list is
// hand-kept, so it is RE-DERIVED here, in both directions.
//
// ⛔ Review 164.9.4 round 3, CR-01: the round-2 derivation scanned only the two
// test files the review had named, so a THIRD reader (`critical-regressions.test.ts`
// on `.planning/config.json`) was invisible to it by construction. The SOURCE
// set is now derived from the WHOLE tree: every tracked vitest / Playwright test
// file (`*.test.*`, `*.spec.*`), every pytest file under `analytics-service/tests/`,
// and, transitively, every tracked local module they import (relative, `@/`, or a
// Python module under `analytics-service/`, absolute, relative or parenthesised
// over several lines) or name as a spawned script (one `scripts/…` /
// `analytics-service/…` literal in any quote, a `../`-relative one, or split
// segments `join(…, "scripts", "x", "y.mjs")`). Every docs-filtered test job runs
// one of those runners, so a read anywhere in that closure is a read a docs-only
// push skips.
//
// ⛔ Review 164.9.4 round 4, IN-01 + SFH LOW-08: the scan FAILS CLOSED. Every
// `.planning` occurrence in a scanned source is found by a small lexer (strings in
// every quote, backtick templates and Python triple quotes included, multi-line
// too; comments skipped; JS regex literals recognised), and each one either
// resolves to a planning FILE the list must carry, or is an UNRECOGNISED shape
// that is a red until `NOT_READS` names it with a reason:
//   - a static literal naming a file, wherever `.planning` sits in it (`./`, a
//     `${ROOT}/` or `{ROOT}/` prefix): DERIVED. A file that does NOT exist is
//     derived too, never dropped, because a test may pin its absence;
//   - a `.planning` root or directory joined with literal segments
//     (`join(ROOT, ".planning", "x.md")`, `ROOT / ".planning" / "x.md"`), or a
//     directory literal whose basename literal sits in the same file: DERIVED;
//   - a computed path (`${…}` / `{…}` / a glob), the bare root or a directory
//     held for a later join with a VARIABLE, a regex literal, or a `.planning`
//     the lexer finds outside any literal or comment: UNRECOGNISED. These cannot
//     be resolved statically, so they are loud instead of silent.
//
// THE EXCLUSION RULE, kept in ONE place (the two maps at the top of the block):
//   - `NOT_SCANNED`, whole files whose `.planning` literals are not real-tree
//     reads a docs-filtered job alone would catch:
//     - this contract file: its literals are `judge()` fixtures, not reads;
//     - the classifier: it holds the list itself, so scanning it would derive the
//       list from the list and hide a stale entry;
//     - whole-tree WALKERS, which read every planning file by enumeration rather
//       than by name, so a named-file list cannot express them. Each is covered
//       elsewhere, and EXACTLY how is in its reason below (review 164.9.4 round 4,
//       WR-02 + SFH LOW-09; the earlier "re-runs them on every event" was false):
//       `check-planning-hygiene.ts` runs in the always-on `frontend-lint` on every
//       event, but its TEST's encoded-identity arm runs nowhere on a docs-only
//       push; `verify-plan-anchors.mjs --pending` runs in `plan-anchor-verify`,
//       which is `pull_request` ONLY, so a push is covered only because every
//       commit it brings is a PR merge, and `classifyPushRange` CHECKS that.
//   - `NOT_READS`, single (source, token) pairs that are not real-tree reads: a
//     scratch-tree fixture, prose, a predicate. Keyed by SOURCE (review 164.9.4
//     round 4, WR-02: the round-3 `FIXTURE_COLLISIONS` dropped `.planning/STATE.md`
//     for EVERY source, so a future real reader of the most-edited planning file
//     would have been silently excluded). Each entry is fenced: its source must
//     still be tracked and still produce that exact token.
// ---------------------------------------------------------------------------
type ScanToken = { token: string; kind: string; derived: string[] };

const PLANNING_TOKEN = /(?<![\w.-])\.planning(?![\w-])(?:\/[^\s"'`,;:)\]<>|]*)?/g;
const FILE_SHAPED = /(?:^|\/)[^/]*\.[A-Za-z0-9]+$/;

/** Every `.planning` path token in `s`, trailing sentence dots trimmed. */
function planningTokens(s: string): string[] {
  return [...s.matchAll(PLANNING_TOKEN)].map((m) => m[0].replace(/\.+$/, ""));
}

type Lit = { body: string; start: number; end: number };

/**
 * A small lexer, enough to find every string literal and every `.planning` in
 * CODE. Strings: '…', "…", JS `…` (a `${…}` placeholder kept RAW in the body, so
 * a computed path stays visible as computed), Python '''…''' / """…""". Comments
 * are skipped (`//`, `/* … *\/` in JS/TS; `#` in Python and shell). A JS regex
 * literal is recognised by the previous significant character and reported as a
 * code hit, never as a string. A single-line string that meets a newline ends
 * there, so a stray apostrophe in JSX text desyncs at most one line.
 */
function lex(text: string, lang: "js" | "py" | "sh"): { lits: Lit[]; codeHits: Array<{ at: number; body: string }> } {
  const lits: Lit[] = [];
  const codeHits: Array<{ at: number; body: string }> = [];
  const n = text.length;
  const lineEnd = (i: number) => {
    const e = text.indexOf("\n", i);
    return e < 0 ? n : e;
  };
  let prev = "";
  let word = "";
  let lastWord = "";
  let i = 0;
  while (i < n) {
    const c = text[i];
    const two = text.slice(i, i + 2);
    const three = text.slice(i, i + 3);
    if (lang === "js" && two === "//") {
      i = lineEnd(i);
      continue;
    }
    if (lang === "js" && two === "/*") {
      const e = text.indexOf("*/", i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (lang !== "js" && c === "#" && (lang === "py" || i === 0 || /\s/.test(text[i - 1]))) {
      i = lineEnd(i);
      continue;
    }
    if (lang === "py" && (three === '"""' || three === "'''")) {
      const e = text.indexOf(three, i + 3);
      const end = e < 0 ? n : e + 3;
      lits.push({ body: text.slice(i + 3, e < 0 ? n : e), start: i, end });
      i = end;
      prev = '"';
      word = "";
      continue;
    }
    if (c === '"' || c === "'" || (lang === "js" && c === "`")) {
      let j = i + 1;
      while (j < n) {
        const d = text[j];
        if (d === "\\") {
          j += 2;
          continue;
        }
        if (c === "`" && d === "$" && text[j + 1] === "{") {
          let k = j + 2;
          let depth = 1;
          while (k < n && depth > 0) {
            if (text[k] === "{") depth += 1;
            else if (text[k] === "}") depth -= 1;
            k += 1;
          }
          j = k;
          continue;
        }
        if (d === c) break;
        if (d === "\n" && c !== "`" && lang !== "sh") break;
        j += 1;
      }
      lits.push({ body: text.slice(i + 1, Math.min(j, n)), start: i, end: Math.min(j + 1, n) });
      i = j + 1;
      prev = '"';
      word = "";
      continue;
    }
    if (/[\w$]/.test(c)) {
      word += c;
    } else if (word) {
      lastWord = word;
      word = "";
    }
    if (
      lang === "js" &&
      c === "/" &&
      (prev === "" || /[(,=:[!&|?{};+\-*%<>~^]/.test(prev) || (!word && /^(?:return|typeof|case|in|of|delete|void|throw|new)$/.test(lastWord) && prev === lastWord.slice(-1)))
    ) {
      let j = i + 1;
      let cls = false;
      while (j < n && text[j] !== "\n") {
        const d = text[j];
        if (d === "\\") {
          j += 2;
          continue;
        }
        if (d === "[") cls = true;
        else if (d === "]") cls = false;
        else if (d === "/" && !cls) break;
        j += 1;
      }
      const body = text.slice(i + 1, j);
      if (body.includes("planning")) codeHits.push({ at: i, body: `REGEX:/${body}/` });
      i = j + 1;
      while (i < n && /[a-z]/.test(text[i])) i += 1;
      prev = "/";
      continue;
    }
    if (text.startsWith(".planning", i)) {
      const m = /^\.planning[^\s"'`,;:)\]<>|]*/.exec(text.slice(i));
      codeHits.push({ at: i, body: `CODE:${m ? m[0] : ".planning"}` });
    }
    if (!/\s/.test(c)) prev = c;
    i += 1;
  }
  return { lits, codeHits };
}

const langOf = (src: string): "js" | "py" | "sh" => (src.endsWith(".py") ? "py" : src.endsWith(".sh") ? "sh" : "js");

/**
 * PURE apart from existence checks against the real tree: every `.planning`
 * token in one source, its kind, and the planning files it DERIVES (empty for
 * an unrecognised shape). Exported to the synthetic rows below, which drive
 * every shape, so the grammar itself is shown to fire.
 */
function scanSource(src: string, text: string): ScanToken[] {
  const isFile = (p: string) => existsSync(join(ROOT, p)) && statSync(join(ROOT, p)).isFile();
  const isDir = (p: string) => existsSync(join(ROOT, p)) && statSync(join(ROOT, p)).isDirectory();
  const { lits, codeHits } = lex(text, langOf(src));
  const out: ScanToken[] = [];
  const consumed = new Set<number>();
  const basenames = lits.map((l) => l.body).filter((b) => /^[\w.-]+\.(?:md|json)$/.test(b));
  // Joins: a `.planning` root or directory literal followed by plain literal
  // segments separated by `,` or `/`, stopping after a file-shaped segment.
  for (let k = 0; k < lits.length; k += 1) {
    const head = lits[k].body;
    if (!/^\.planning(?:\/[\w.@-]+)*\/?$/.test(head) || FILE_SHAPED.test(head.replace(/^\.planning/, ""))) continue;
    const segs = [head];
    let m = k;
    while (m + 1 < lits.length && /^\s*[,/]\s*$/.test(text.slice(lits[m].end, lits[m + 1].start)) && /^[\w.@-]+(?:\/[\w.@-]+)*$/.test(lits[m + 1].body)) {
      segs.push(lits[m + 1].body);
      m += 1;
      if (FILE_SHAPED.test(lits[m].body)) break;
    }
    if (segs.length === 1) continue;
    for (let x = k; x <= m; x += 1) consumed.add(x);
    const p = posix.normalize(segs.join("/"));
    out.push(classify(p));
    k = m;
  }
  function classify(token: string): ScanToken {
    if (/[{}*]/.test(token)) return { token, kind: "COMPUTED", derived: [] };
    if (token === ".planning" || token === ".planning/") return { token, kind: "ROOT", derived: [] };
    if (FILE_SHAPED.test(token.replace(/^\.planning/, "")) && !isDir(token)) {
      return { token, kind: isFile(token) ? "FILE" : "ABSENT", derived: [token] };
    }
    if (isDir(token)) {
      const dir = token.replace(/\/$/, "");
      const derived = basenames.map((b) => `${dir}/${b}`).filter(isFile);
      return { token, kind: derived.length > 0 ? "DIR+BASENAME" : "DIR", derived };
    }
    return { token, kind: "ABSENT-DIR", derived: [] };
  }
  lits.forEach((l, k) => {
    if (consumed.has(k) || !l.body.includes(".planning")) return;
    // A `${…}` placeholder (JS) or `{…}` (a Python f-string) BEFORE `.planning`
    // is a root prefix and the token after it is static; one INSIDE the token
    // makes it computed, which `classify` sees.
    for (const t of planningTokens(l.body)) out.push(classify(t));
  });
  for (const h of codeHits) out.push({ token: h.body, kind: "UNRECOGNISED", derived: [] });
  return out;
}

describe("[164.9.4 WR-01 / CR-01] TEST_READ_PLANNING_PATHS matches the planning files the tests read, derived from the whole tree", () => {
  const NOT_SCANNED = new Map<string, string>([
    ["src/__tests__/contracts/ci-docs-path-filter.contract.test.ts", "this file: its .planning literals are judge() fixtures"],
    ["scripts/classify-changed-paths.mjs", "the list's own home: scanning it would derive the list from itself"],
    [
      "src/__tests__/check-planning-hygiene.test.ts",
      "whole-tree walker; the always-on frontend-lint runs the same hygiene script on every event, EXCEPT this " +
        "test's encoded-identity arm (base64/hex of the machine identity), which the script does not carry. Its loss " +
        "on a docs-only push is ACCEPTED: on CI that arm searches the runner's identity, which a developer commit " +
        "never encodes, so moving it into the always-on script would add no protection for the identity that matters",
    ],
    ["scripts/check-planning-hygiene.ts", "whole-tree walker; the always-on frontend-lint runs it on every event"],
    ["scripts/check-canonical-domain.ts", "whole-tree walker; names `.planning/` only as an exclusion, never as a file it reads"],
    ["src/__tests__/check-canonical-domain.test.ts", "scratch-tree fixtures; names `.planning/` only as an exclusion, never as a file it reads"],
    [
      "scripts/verify-plan-anchors.mjs",
      "whole-corpus --pending walker; plan-anchor-verify runs it on every PR, NOT on push. A push is covered only " +
        "because every commit it brings is a PR merge whose PR run checked it, and classifyPushRange CHECKS that " +
        "(isPrMergeCommit): a range carrying any other commit runs the full corpus (review 164.9.4 round 4, WR-02)",
    ],
  ]);

  // Each reason says why the token is not a real-tree read. Two shared reasons:
  const FIXTURE = "a fixture path this file seeds into a mkdtemp scratch tree (or asserts on inside one); never read from the real tree";
  const DOCSTRING = "prose in a docstring or comment-like string citing where a decision is recorded; nothing opens it";
  const NOT_READS = new Map<string, Array<[string, string]>>([
    [
      "src/__tests__/verify-plan-anchors.test.ts",
      [
        [".planning/STATE.md", FIXTURE],
        [".planning/milestones/v1.20-phases/164-old/164-01-PLAN.md", FIXTURE],
        [".planning/phases/.keep", FIXTURE],
        [".planning/phases/00-x/.keep", FIXTURE],
        [".planning/phases/98-done/98-01-PLAN.md", FIXTURE],
        [".planning/phases/98-done/98-01-SUMMARY.md", FIXTURE],
        [".planning/phases/98-done/98-02-PLAN.md", FIXTURE],
        [".planning/phases/99-fixture/99-00-SUMMARY.md", FIXTURE],
        [".planning/phases/99-fixture/99-01-DEFERRED.md", FIXTURE],
        [".planning/phases/99-fixture/99-01-PLAN.md", FIXTURE],
        [".planning/phases/99-fixture/99-02-PLAN.md", FIXTURE],
        [".planning/phases/99-fixture/99-03-PLAN.md", FIXTURE],
        [".planning/phases/99-open/99-01-DEFERRED.md", FIXTURE],
        [".planning/phases/99-open/99-01-PLAN.md", FIXTURE],
        [".planning/phases/99-open/99-02-PLAN.md", FIXTURE],
        [".planning/phases", "join(root, \".planning\", \"phases\") on the mkdtemp scratch root, to list the fixture tree it seeded"],
        [".planning/phases/164-.../pg-harness/run.sh", "prose inside a fixture plan body (an anchor the fixture expects verify-plan-anchors to report), not a path this file opens"],
      ],
    ],
    [
      "analytics-service/tests/test_constit_blend_parity.py",
      [
        [".planning/PROJECT.md", DOCSTRING],
      ],
    ],
    [
      "analytics-service/tests/test_position_reconstruction_fifo_flip.py",
      [
        [".planning/audit-2026-05-07/INVEST-PATTERN-2-POSITIONS.md", DOCSTRING],
      ],
    ],
    [
      "analytics-service/tests/test_probe_composite_claimtime.py",
      [
        [".planning/h.log", "a repo-root path fed to the probe so the test can assert the probe REFUSES a log path inside the repository; never opened"],
      ],
    ],
    [
      "analytics-service/tests/test_mt5_relogin.py",
      [
        [".planning/", DOCSTRING],
      ],
    ],
    [
      "analytics-service/tests/test_mt5_session_monitor.py",
      [
        [".planning/", DOCSTRING],
      ],
    ],
    [
      "analytics-service/tests/test_phase12_kill_switch.py",
      [
        [".planning", DOCSTRING],
        [".planning/", DOCSTRING],
      ],
    ],
    [
      "analytics-service/scripts/phase12_kill_switch.py",
      [
        [".planning/phases/12-backend-metric-contracts/TODOS.md", "TODOS_PATH, an append target that does not exist in the tree; every test of the module monkeypatches TODOS_PATH to a tmp path, so no test reads or writes the real one (measured, review 164.9.4 round 3)"],
        [".planning/", DOCSTRING],
      ],
    ],
    [
      "analytics-service/scripts/phase12_deploy.py",
      [
        [".planning/phases/12-backend-metric-contracts/TODOS.md", "the same absent TODOS_PATH target as phase12_kill_switch.py, cited in the module docstring and joined for a deploy-time write no test performs"],
      ],
    ],
    [
      "analytics-service/scripts/probe_composite_claimtime.py",
      [
        [".planning/", DOCSTRING],
      ],
    ],
    [
      "analytics-service/services/db.py",
      [
        [".planning/phases/140.1-.../140.1-TS-OBLIGATIONS.md", DOCSTRING],
      ],
    ],
    [
      "analytics-service/routers/process_key.py",
      [
        [".planning/phases/140.1-.../140.1-TS-OBLIGATIONS.md", DOCSTRING],
      ],
    ],
    [
      "analytics-service/services/feedback_engine.py",
      [
        [".planning/phases/04-feedback-loop/04-CONTEXT.md", DOCSTRING],
      ],
    ],
    [
      "analytics-service/services/allocator_equity_derive.py",
      [
        [".planning/phases/115-e2-allocator-equity-reconstruction-scope-gated-verify-first/115-STITCH-02-DEFERRAL.md", DOCSTRING],
      ],
    ],
    [
      "analytics-service/services/ingestion/csv_adapter.py",
      [
        [".planning/phase-19/csv-adapter-deviation.md", DOCSTRING],
      ],
    ],
    [
      "src/lib/founder-lp/readiness.ts",
      [
        [".planning/phase-18/founder-lp-runbook.md", "operator-facing message copy (a readiness reason string pointing at the runbook); the app never opens it"],
      ],
    ],
    [
      "src/lib/founder-lp/email-templates.ts",
      [
        [".planning/phase-18/founder-lp-runbook.md", "operator-facing email copy pointing at the runbook; the app never opens it"],
      ],
    ],
    [
      "src/app/api/cron/flag-monitor/route.ts",
      [
        [".planning/phase-19/rollback-runbook.md", "alert-email copy pointing at the runbook; the route never opens it"],
      ],
    ],
    [
      "scripts/check-version-bump.mjs",
      [
        [".planning/", "the planning-only exemption predicate (startsWith) and its messages; a prefix, not a file read"],
      ],
    ],
    [
      "src/__tests__/contracts/contracts-registry.test.ts",
      [
        [".planning/", "invariant description prose in the registry table; not a path read"],
        [".planning/**", "invariant description prose in the registry table; not a path read"],
      ],
    ],
    [
      "src/__tests__/vac06-mechanism-arms.test.ts",
      [
        [".planning/", "a startsWith predicate asserting the demos record does NOT live under .planning/, and its message"],
        [".planning/phases/", "message prose explaining why the record must not live there"],
        [".planning/phases/**", "message prose explaining why the record must not live there"],
      ],
    ],
  ]);

  const TRACKED = new Set(
    execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" }).split("\0").filter(Boolean),
  );
  const isTestFile = (f: string) =>
    /\.(test|spec)\.(ts|tsx|mjs|js)$/.test(f) || /^analytics-service\/tests\/.*\.py$/.test(f);
  const JS_EXT = ["", ".ts", ".tsx", ".mjs", ".js", ".cjs", "/index.ts", "/index.tsx", "/index.js"];

  function resolveJs(from: string, spec: string): string | null {
    let base: string;
    if (spec.startsWith("./") || spec.startsWith("../")) base = posix.normalize(posix.join(posix.dirname(from), spec));
    else if (spec.startsWith("@/")) base = `src/${spec.slice(2)}`;
    else return null;
    for (const e of JS_EXT) if (TRACKED.has(base + e)) return base + e;
    return null;
  }
  /** A Python module spec (absolute `a.b`, relative `.a` / `..a` / `.`) as a path stem. */
  function pyStem(from: string, mod: string): string {
    const dots = (/^\.*/.exec(mod) ?? [""])[0].length;
    const rest = mod.slice(dots).replace(/\./g, "/");
    if (dots === 0) return `analytics-service/${rest}`;
    let dir = posix.dirname(from);
    for (let k = 1; k < dots; k += 1) dir = posix.dirname(dir);
    return rest ? `${dir}/${rest}` : dir;
  }
  const resolvePy = (stem: string) => [`${stem}.py`, `${stem}/__init__.py`].find((c) => TRACKED.has(c)) ?? null;

  /**
   * PURE: the tracked local modules and scripts one source imports or spawns.
   * Exported to the synthetic rows below.
   */
  function importsOf(f: string, text: string): string[] {
    const next: string[] = [];
    if (f.endsWith(".py")) {
      // `from x import a, b`, `from x import (\n a,\n b,\n)`, `from .x import a`, `from . import a`.
      for (const m of text.matchAll(/^[ \t]*from[ \t]+(\.*[\w.]*)[ \t]+import[ \t]+(\([^)]*\)|[^\n#]+)/gm)) {
        const stem = pyStem(f, m[1]);
        next.push(resolvePy(stem) ?? "");
        for (const part of m[2].replace(/[()]/g, "").split(",")) {
          const name = part.trim().split(/\s+/)[0];
          if (name && name !== "*" && name !== "\\") next.push(resolvePy(`${stem}/${name}`) ?? "");
        }
      }
      for (const m of text.matchAll(/^[ \t]*import[ \t]+([\w., \t]+)/gm)) {
        for (const part of m[1].split(",")) next.push(resolvePy(pyStem(f, part.trim().split(/\s+/)[0])) ?? "");
      }
    } else {
      for (const m of text.matchAll(/(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)["'`]([^"'`]+)["'`]/g)) {
        next.push(resolveJs(f, m[1]) ?? "");
      }
    }
    const SCRIPT = /\.(?:mjs|ts|js|cjs|sh|py)$/;
    for (const m of text.matchAll(/["'`]((?:\.\.?\/)*(?:scripts|analytics-service)\/[^"'`\s]+)["'`]/g)) {
      if (!SCRIPT.test(m[1])) continue;
      const lit = m[1].replace(/^(?:\.\.?\/)+/, "");
      next.push(lit, posix.normalize(posix.join(posix.dirname(f), m[1])));
    }
    // Split segments: join(ROOT, "scripts", "local-stack", "run.sh").
    for (const m of text.matchAll(/(["'`])(scripts|analytics-service)\1((?:\s*,\s*(["'`])[\w.-]+\4)+)/g)) {
      const segs = [m[2], ...[...m[3].matchAll(/(["'`])([\w.-]+)\1/g)].map((s) => s[2])];
      next.push(segs.join("/"));
    }
    return next.filter((x) => x && TRACKED.has(x));
  }

  /** The test files plus every tracked local module they import or spawn, transitively. */
  function closure(): Set<string> {
    const seen = new Set<string>();
    const queue = [...TRACKED].filter(isTestFile);
    while (queue.length > 0) {
      const f = queue.pop() as string;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const n of importsOf(f, readFileSync(join(ROOT, f), "utf8"))) if (!seen.has(n)) queue.push(n);
    }
    return seen;
  }

  type Derivation = {
    reached: Set<string>;
    paths: Map<string, Set<string>>;
    unrecognised: string[];
    tokensBySource: Map<string, Set<string>>;
  };
  let memo: Derivation | null = null;
  /** Memoised: every arm reads the same derivation, computed once. */
  function derive(): Derivation {
    if (memo) return memo;
    const reached = closure();
    const paths = new Map<string, Set<string>>();
    const unrecognised: string[] = [];
    const tokensBySource = new Map<string, Set<string>>();
    for (const src of reached) {
      if (NOT_SCANNED.has(src)) continue;
      const text = readFileSync(join(ROOT, src), "utf8");
      if (!text.includes(".planning")) continue;
      const allowed = new Map(NOT_READS.get(src) ?? []);
      const seenTokens = new Set<string>();
      for (const t of scanSource(src, text)) {
        seenTokens.add(t.token);
        if (allowed.has(t.token)) continue;
        if (t.derived.length === 0) {
          unrecognised.push(`${src} :: ${t.token} (${t.kind})`);
          continue;
        }
        for (const p of t.derived) {
          if (!paths.has(p)) paths.set(p, new Set());
          paths.get(p)?.add(src);
        }
      }
      tokensBySource.set(src, seenTokens);
    }
    memo = { reached, paths, unrecognised, tokensBySource };
    return memo;
  }

  const describeSources = (paths: Map<string, Set<string>>, f: string) => [...(paths.get(f) ?? [])].join(", ");

  it("the derivation is not vacuous: it walks every runner's tests and resolves imports in both languages", () => {
    const { reached, paths } = derive();
    const readers = new Set([...paths.values()].flatMap((s) => [...s]));
    expect(readers.size, `vacuity fence: only ${readers.size} reader file(s) found (${[...readers].join(", ")})`).toBeGreaterThanOrEqual(3);
    expect(paths.size, `vacuity fence: the derivation found ${paths.size} file(s)`).toBeGreaterThanOrEqual(6);
    // Each runner's tests are in the walk, and each import resolver reached a module.
    expect([...reached].some((f) => f.startsWith("e2e/") && f.endsWith(".spec.ts")), "no Playwright spec in the walk").toBe(true);
    expect([...reached].some((f) => f.startsWith("analytics-service/tests/")), "no pytest file in the walk").toBe(true);
    expect(reached.has("scripts/check-planning-hygiene.ts"), "the JS import resolver no longer reaches a script a test imports").toBe(true);
    expect(reached.has("analytics-service/scripts/phase12_kill_switch.py"), "the Python import resolver no longer reaches a module a test imports").toBe(true);
  });

  it("the exclusions are fenced: every source is tracked, and every NOT_READS token is still produced by its source", () => {
    const { tokensBySource } = derive();
    for (const f of NOT_SCANNED.keys()) expect(TRACKED.has(f), `${f} is excluded but no longer tracked; drop it from NOT_SCANNED`).toBe(true);
    for (const [src, entries] of NOT_READS) {
      expect(TRACKED.has(src), `${src} has NOT_READS entries but is no longer tracked; drop them`).toBe(true);
      expect(NOT_SCANNED.has(src), `${src} is in BOTH maps; a whole-file exclusion makes its NOT_READS entries dead`).toBe(false);
      for (const [token, reason] of entries) {
        expect(reason.length, `${src} :: ${token} carries no reason`).toBeGreaterThan(20);
        expect(
          tokensBySource.get(src)?.has(token) ?? false,
          `${src} no longer produces the token ${token}, so its NOT_READS entry is STALE; drop it ` +
            `(an entry that matches nothing could later hide a real reader that happens to reuse it)`,
        ).toBe(true);
      }
    }
  });

  it("FAIL CLOSED: no scanned source carries a `.planning` shape the derivation cannot resolve", () => {
    const { unrecognised } = derive();
    expect(
      unrecognised,
      "these `.planning` occurrences are neither a resolvable planning file nor named in NOT_READS. A computed " +
        "path, a root or directory held for a later join with a variable, a regex, or text outside any literal " +
        "cannot be derived statically, and a silent pass here is how a real reader hides. Either it is a real " +
        "read (add the file to TEST_READ_PLANNING_PATHS and make the literal static) or it is not (add a " +
        "(source, token) entry to NOT_READS with the reason).",
    ).toEqual([]);
  });

  it("every real-tree planning file a test reads is on the list (the list cannot lag the tests)", () => {
    const { paths } = derive();
    const missing = [...paths.keys()]
      .filter((f) => !TEST_READ_PLANNING_PATHS.includes(f))
      .map((f) => `${f} (read by ${describeSources(paths, f)})`);
    expect(
      missing,
      "these planning files are read by a scanned source but are NOT in TEST_READ_PLANNING_PATHS, so a " +
        "docs-only push that breaks one goes green on main. Add each to the list in scripts/classify-changed-paths.mjs, " +
        "or, if it is not a real-tree read, name the (source, token) in NOT_READS with the reason. (A file that does " +
        "not exist counts: a test may pin its absence, and creating it must run the full corpus.)",
    ).toEqual([]);
  });

  it("every listed path is derived, or is the ABSENT -SUMMARY sibling of a derived deferred plan (no stale entry)", () => {
    const { paths } = derive();
    for (const f of TEST_READ_PLANNING_PATHS) {
      if (paths.has(f)) continue;
      const plan = f.replace(/-SUMMARY\.md$/, "-PLAN.md");
      expect(plan !== f && paths.has(plan), `${f} is on the list but no test reads it`).toBe(true);
      expect(existsSync(join(ROOT, f)), `${f} now EXISTS, so the deferral the pins assert has ended; revisit the list`).toBe(false);
    }
  });

  // ── the grammar itself can fire (review 164.9.4 round 4, IN-01 + SFH LOW-08) ──
  // Each row feeds ONE shape the round-3 scan missed. Real planning paths are
  // used so existence resolves against the real tree.
  const kinds = (src: string, text: string) => scanSource(src, text).map((t) => `${t.kind} ${t.token}`);
  it.each([
    ["a backtick template, static", "x.test.ts", "readFileSync(`.planning/ROADMAP.md`, 'utf8');", ["FILE .planning/ROADMAP.md"]],
    ["a backtick template with a ROOT placeholder before .planning", "x.test.ts", "readFileSync(`${ROOT}/.planning/ROADMAP.md`);", ["FILE .planning/ROADMAP.md"]],
    ["a `./` prefix mid-string", "x.test.ts", 'readFileSync("./.planning/ROADMAP.md");', ["FILE .planning/ROADMAP.md"]],
    ["a Python f-string with a root placeholder", "t.py", 'open(f"{ROOT}/.planning/ROADMAP.md")', ["FILE .planning/ROADMAP.md"]],
    ["a COMPUTED segment after .planning", "x.test.ts", "readFileSync(`.planning/${phase}/PLAN.md`);", ["COMPUTED .planning/${phase}/PLAN.md"]],
    ["a COMPUTED Python f-string", "t.py", 'open(f".planning/{phase}/PLAN.md")', ["COMPUTED .planning/{phase}/PLAN.md"]],
    ["the root held in a variable and joined later", "x.test.ts", 'const P = join(ROOT, ".planning");\nreadFileSync(join(P, "ROADMAP.md"));', ["ROOT .planning"]],
    ["a root joined with literal segments", "x.test.ts", 'readFileSync(join(ROOT, ".planning", "ROADMAP.md"), "utf8");', ["FILE .planning/ROADMAP.md"]],
    ["a Python path join", "t.py", 'p = ROOT / ".planning" / "ROADMAP.md"', ["FILE .planning/ROADMAP.md"]],
    ["a file literal followed by an encoding is NOT joined", "x.test.ts", 'readFileSync(".planning/ROADMAP.md", "utf8");', ["FILE .planning/ROADMAP.md"]],
    ["an ABSENT file is kept, never dropped (a test may pin absence)", "x.test.ts", 'existsSync(".planning/phases/00-none/00-01-SUMMARY.md");', ["ABSENT .planning/phases/00-none/00-01-SUMMARY.md"]],
    ["a multi-line Python docstring", "t.py", 'def f():\n    """\n    See .planning/ROADMAP.md.\n    """\n', ["FILE .planning/ROADMAP.md"]],
    ["a multi-line template literal", "x.ts", "const html = `<p>\n  .planning/ROADMAP.md\n</p>`;", ["FILE .planning/ROADMAP.md"]],
    ["a regex literal naming .planning", "x.test.ts", "const re = /\\.planning\\/x/;", ["UNRECOGNISED REGEX:/\\.planning\\/x/"]],
    ["a comment is not a read", "x.test.ts", "// see .planning/ROADMAP.md\nconst a = 1;", []],
    ["a Python comment is not a read", "t.py", "# see .planning/ROADMAP.md\na = 1\n", []],
    ["a regex with a quote does not desync the lexer", "x.test.ts", 'const re = /["\']/;\nreadFileSync(".planning/ROADMAP.md");', ["FILE .planning/ROADMAP.md"]],
  ] as const)("the scanner resolves %s", (_label, src, text, want) => {
    expect(kinds(src, text)).toEqual([...want]);
  });

  it.each([
    ["a multi-line parenthesised Python import", "analytics-service/tests/test_x.py", "from scripts.phase12_kill_switch import (\n    main,\n)\n", "analytics-service/scripts/phase12_kill_switch.py"],
    ["a relative Python import", "analytics-service/scripts/x.py", "from .phase12_kill_switch import main\n", "analytics-service/scripts/phase12_kill_switch.py"],
    ["a `from . import` relative import", "analytics-service/scripts/x.py", "from . import phase12_kill_switch\n", "analytics-service/scripts/phase12_kill_switch.py"],
    ["a script spawned through split segments", "src/__tests__/x.test.ts", 'spawnSync("node", [join(ROOT, "scripts", "classify-changed-paths.mjs")]);', "scripts/classify-changed-paths.mjs"],
    ["a script spawned through a backtick literal", "src/__tests__/x.test.ts", "spawnSync('bash', [`scripts/local-stack/run.sh`]);", "scripts/local-stack/run.sh"],
    ["a script spawned through a ../-relative literal", "src/__tests__/x.test.ts", 'spawnSync("node", [resolve(__dirname, "../../scripts/classify-changed-paths.mjs")]);', "scripts/classify-changed-paths.mjs"],
  ] as const)("the closure follows %s", (_label, from, text, want) => {
    expect(importsOf(from, text)).toContain(want);
  });
});

// ⏱ A per-arm timeout, not the 5 s default: every arm below SPAWNS the full
// self-test, which since review 164.9.4 round 2 builds scratch repos and spawns
// main() against a fake gh for the SFH-04 and WR-01 rows (about 3-4 s wall on a
// loaded box, measured 2026-10-02). Under the default the arms timed out before
// the self-test answered, which is a harness red, not a classifier one.
//
// ⏱ SFH LOW-06: `spawnSync` is synchronous, so vitest's 60 s timer cannot fire
// while a child runs. Each spawn therefore carries its own `SPAWN_TIMEOUT_MS`
// below the arm budget, killed with SIGKILL, and asserts right after the spawn,
// so a hung self-test is a named, bounded red instead of a job timeout.
const SPAWN_TIMEOUT_MS = 50_000;
function expectNoHang(res: ReturnType<typeof spawnSync>, what: string): void {
  expect(
    res.error === undefined && res.signal === null,
    `${what} HUNG or could not run: it was killed after ${SPAWN_TIMEOUT_MS} ms or failed to spawn ` +
      `(signal ${String(res.signal)}, error ${String(res.error?.message ?? "none")}). A hang here is the ` +
      `classifier self-test stalling, most plausibly a lookup that reached a real network call.`,
  ).toBe(true);
}

describe("[164.6.3 / CI-DOCSPATH-01] CALIBRATION — the classifier's self-test can FAIL", { timeout: 60_000 }, () => {
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
    const res = spawnSync(process.execPath, [path, "--self-test"], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: SPAWN_TIMEOUT_MS,
      killSignal: "SIGKILL",
    });
    expectNoHang(res, "the classifier copy's --self-test");
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

  // ── neuter legs 3 and 4: the PUSH path (Phase 164.9.4 review WR-01) ──────
  it("CALIBRATION — routing a push back to the old hard-coded code verdict turns the self-test RED", () => {
    // The push branch's verdict is forced back to `false`, the pre-164.9.4
    // behaviour. (Anchored on the emit, not the event check, so this file
    // carries no literal env read for the env-manifest scan to count.)
    const mutated = mutate("emit(docsOnly, reason);", "emit(false, reason);", "push-route");
    const { code, out } = selfTest(mutated);
    expect(code, `a classifier that never shortens a docs-only push must EXIT NON-ZERO.\n${out}`).not.toBe(0);
    expect(out).toContain(FAILED_BANNER);
    expect(out).toContain("FAIL — main() on a push event writes docs_only=true and exits 0");
  });

  it("CALIBRATION — dropping the ancestor guard turns the self-test RED (a force-pushed-over before-SHA)", () => {
    const mutated = mutate('git(["merge-base", "--is-ancestor", sha, "HEAD"], cwd);', "", "ancestor-guard");
    const { code, out } = selfTest(mutated);
    expect(code, `a classifier that trusts a non-ancestor before-SHA must EXIT NON-ZERO.\n${out}`).not.toBe(0);
    expect(out).toContain(FAILED_BANNER);
    expect(out).toContain("FAIL — a non-ancestor (force-pushed-over) before-SHA classifies as code");
    // SFH LOW-05: without the guard that row reaches the predecessor lookup. It
    // must hit the self-test's sentinel seam, a named red, never the real gh.
    expect(out).toContain("FAIL — self-test row reached the predecessor lookup without a seam");
  });

  // ── neuter leg 5: the predecessor-verdict gate (review 164.9.4 round 2, SFH-04)
  it("CALIBRATION — dropping the predecessor-verdict gate turns the self-test RED (SFH-04)", () => {
    // Without the gate a `.planning/`-only push on top of a red code commit gets
    // a short green run on code CI rejected, and Railway deploys it.
    const mutated = mutate("if (!verdict.ok) return fullCorpus(", "if (false) return fullCorpus(", "predecessor-gate");
    const { code, out } = selfTest(mutated);
    expect(code, `a classifier that ignores a red predecessor must EXIT NON-ZERO.\n${out}`).not.toBe(0);
    expect(out).toContain(FAILED_BANNER);
    expect(out).toContain("FAIL — a RED predecessor (frontend concluded failure) classifies as code");
    expect(out).toContain("FAIL — a RED non-aggregated check beside a green frontend (run 36892795002's shape) classifies as code");
    expect(out).toContain("FAIL — a RED check from ANOTHER workflow on the same commit classifies as code");
    expect(out).toContain("FAIL — a PENDING predecessor (its CI still running) classifies as code");
    expect(out).toContain("FAIL — an API ERROR during the lookup classifies as code");
  });

  // ── neuter legs 7 and 8: requirements (a) and (c) of the predecessor gate
  // (review 164.9.4 round 4, CR-01 + SFH MEDIUM-01, and WR-01). Each deletes ONE
  // requirement and expects the rows only that requirement refuses to go RED.
  it("CALIBRATION — dropping the `frontend` requirement turns the self-test RED (CR-01)", () => {
    // Without it, green checks from a scheduled workflow, or a CI run caught
    // between `needs:` stages, prove `before` and a docs-only push goes short
    // over code CI never finished.
    const mutated = mutate("if (!frontendOk) {", "if (false) {", "frontend-required");
    const { code, out } = selfTest(mutated);
    expect(code, `a classifier that never asks for a finished CI run must EXIT NON-ZERO.\n${out}`).not.toBe(0);
    expect(out).toContain(FAILED_BANNER);
    expect(out).toContain("FAIL — green Actions checks but NO frontend (CI caught between needs: stages) classifies as code");
    expect(out).toContain("FAIL — ONLY a scheduled workflow's checks (a skip-trailer merge: CI never ran) classifies as code");
    expect(out).toContain("FAIL — a SKIPPED frontend (it must have concluded success) classifies as code");
  });

  it("CALIBRATION — dropping the open-suite requirement turns the self-test RED (WR-01)", () => {
    const mutated = mutate("  if (open) {", "  if (false) {", "suite-completed");
    const { code, out } = selfTest(mutated);
    expect(code, `a classifier blind to a queued workflow run must EXIT NON-ZERO.\n${out}`).not.toBe(0);
    expect(out).toContain(FAILED_BANNER);
    expect(out).toContain("FAIL — a QUEUED Actions suite with no check runs beside a green CI classifies as code");
  });

  // ── neuter leg 9: the PR-merge rule (review 164.9.4 round 4, WR-02) ──────
  it("CALIBRATION — dropping the PR-merge rule turns the self-test RED (WR-02)", () => {
    // Without it, a direct push to main takes the short path although
    // plan-anchor-verify (pull_request only) never ran on it.
    const mutated = mutate("  if (direct) {", "  if (false) {", "pr-merge-rule");
    const { code, out } = selfTest(mutated);
    expect(code, `a classifier that shortens a direct push must EXIT NON-ZERO.\n${out}`).not.toBe(0);
    expect(out).toContain(FAILED_BANNER);
    expect(out).toContain("FAIL — a direct-push docs commit in the range classifies as code without consulting the predecessor");
  });

  // ── neuter leg 6: the test-read planning rule (review 164.9.4 round 2, WR-01)
  it("CALIBRATION — dropping the test-read planning rule turns the self-test RED (WR-01)", () => {
    const mutated = mutate("if (read.length > 0) return fullCorpus(", "if (false) return fullCorpus(", "test-read-rule");
    const { code, out } = selfTest(mutated);
    expect(code, `a classifier that shortens a ROADMAP.md push must EXIT NON-ZERO.\n${out}`).not.toBe(0);
    expect(out).toContain(FAILED_BANNER);
    expect(out).toContain("FAIL — .planning/ROADMAP.md alone classifies as code");
  });

  // ── review 164.4.2 IN-02: no raw git line above a PASSED verdict ──────────
  // The unreadable-ref arm makes git fail on purpose. With git's stderr inherited,
  // `fatal: ambiguous argument …` printed raw into the CI log above a PASSED
  // verdict, where a reader triaging a red run could take it for the cause. Both
  // scripts that drive the shared diff are checked, through the real files.
  it("neither self-test prints a raw `fatal:` git line — git's reason travels inside the MEASURE_FAIL", () => {
    for (const script of [CLASSIFIER, join(ROOT, "scripts/sql-gate-subset.mjs")]) {
      const res = spawnSync(process.execPath, [script, "--self-test"], {
        cwd: ROOT,
        encoding: "utf8",
        timeout: SPAWN_TIMEOUT_MS,
        killSignal: "SIGKILL",
      });
      expectNoHang(res, `${script} --self-test`);
      const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
      expect(res.status, `${script} self-test must pass through this spawn\n${out}`).toBe(0);
      expect(out, "AIM: the unreadable-ref arm ran").toContain("UNREADABLE diff base");
      expect(out.split("\n").filter((l) => l.startsWith("fatal:")), `${script} printed git's stderr raw`).toEqual([]);
    }
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
