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
