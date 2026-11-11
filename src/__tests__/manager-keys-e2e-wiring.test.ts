/**
 * Phase 200 gap closure (plan 13) - keep the one-key panel e2e tests where a
 * failure is red.
 *
 * WHY THIS FILE EXISTS. In Phase 200 the panel's Playwright tests (Change key…
 * opens the picker, a pick opens the confirm, nothing is written before Change
 * key) ran nowhere that could block a merge. They skipped on an env var no
 * workflow sets, and their only Playwright list was the advisory `e2e` job,
 * whose step is `continue-on-error: true` and which no aggregator needs. A
 * regression in the confirm-before-re-point control would have merged green.
 *
 * The tests now live in `e2e/manager-keys.spec.ts`, which only the `e2e-seeded`
 * job runs (the `frontend` aggregator judges that job). This test pins the four
 * ways that placement can quietly stop meaning anything:
 *   1. the spec drops out of the seeded list,
 *   2. it is added to the advisory list, or the seeded step starts tolerating
 *      failure (`continue-on-error`, any errexit-off spelling, anything chained
 *      after the invocation's `--timeout 60000` or after the `fi` that closes its
 *      arm, a `$?` capture),
 *   3. the spec grows a skip, a fixme or an `only` on any receiver, or reads
 *      `process.env`, so it can pass without running,
 *   4. the spec stops logging in or stops seeding its own rows.
 *
 * The seeded-list parser is a local copy of the one in
 * e2e-seeded-hydration-guard.test.ts: importing a test file would register its
 * tests a second time.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = resolve(__dirname, "..", "..");
const CI_WORKFLOW = ".github/workflows/ci.yml";
const SPEC = "e2e/manager-keys.spec.ts";
const SEEDED_STEP_NAME = "- name: Run seed-gated specs (MA-8 / BLOCK-3)";
/** The advisory list is the unseeded `e2e` job's line that carries the smoke spec. */
const ADVISORY_ANCHOR = "e2e/smoke.spec.ts";

function readRepoFile(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

/** Uncommented lines of `text`, original indentation kept. */
function codeLines(text: string): string[] {
  return text.split("\n").filter((line) => !/^\s*#/.test(line));
}

/** The seeded step's text, from its name to the next step. Empty when missing. */
function seededStep(workflow: string): string {
  const start = workflow.indexOf(SEEDED_STEP_NAME);
  if (start === -1) return "";
  const rest = workflow.slice(start + SEEDED_STEP_NAME.length);
  const nextStep = rest.search(/\n\s*- name:/);
  return nextStep === -1 ? rest : rest.slice(0, nextStep);
}

/** The seeded step's `else` arm: the spec list, up to its `fi`. Empty when missing. */
function seededElseArm(step: string): string {
  const arm = step.match(/\belse\s*\n\s*npx playwright test\b[\s\S]*?\n\s*fi\b/);
  return arm ? arm[0] : "";
}

/** The specs named by the seeded `else` arm's invocation, up to `--timeout`. */
function parseSeededSpecs(step: string): string[] {
  const elseArm = step.match(/\belse\s*\n\s*npx playwright test\b([\s\S]*?)--timeout/);
  if (!elseArm) return [];
  return [...new Set(elseArm[1].match(/e2e\/[\w.-]+\.spec\.ts/g) ?? [])];
}

describe("the one-key panel e2e spec stays in the blocking lane (Phase 200 gap 1)", () => {
  const workflow = readRepoFile(CI_WORKFLOW);
  const step = seededStep(workflow);

  it("the seeded list names the panel spec", () => {
    const seeded = parseSeededSpecs(step);
    expect(
      seeded.length,
      `Parsed no specs from the "${SEEDED_STEP_NAME}" step of ${CI_WORKFLOW}. The parser lost the list: ` +
        "fix the parser, because an empty list would pass every membership check below as 'absent'.",
    ).toBeGreaterThan(0);
    expect(
      seeded,
      `${SPEC} is not in the e2e-seeded list. Without it the panel's confirm-before-re-point tests run ` +
        "nowhere that can fail a merge (Phase 200 gap 1).",
    ).toContain(SPEC);
  });

  it("the seeded step cannot pass while its Playwright run fails", () => {
    const stepCode = codeLines(step);
    expect(
      stepCode.some((l) => /^\s*(?:- )?continue-on-error:/.test(l)),
      "the seeded step carries a `continue-on-error:` key, so a failing panel test would leave the step green",
    ).toBe(false);
    // Match the errexit OPTION, not one spelling of it: `set +e`, `set +eo pipefail`,
    // `set +o errexit` all switch it off.
    expect(
      stepCode.some((l) => /\bset\s+\+[a-z]*e/.test(l) || /\bset\s+\+o\s+errexit\b/.test(l)),
      "the seeded step switches errexit off (`set +e`, `set +eo pipefail`, `set +o errexit`), so a failing `npx playwright test` no longer fails the step",
    ).toBe(false);
    const arm = codeLines(seededElseArm(step)).join("\n");
    expect(arm, "the seeded step's else arm could not be found").not.toBe("");
    // The invocation must END at `--timeout 60000`: any `||`, `;` or `&&` after it
    // (`|| true`, `|| :`, `|| echo`, `|| exit 0`, `|| PW_EXIT=$?`) lets a red run pass.
    const tail = arm.match(/--timeout 60000([\s\S]*?)\n\s*fi\b/);
    expect(tail, "the seeded else arm no longer ends its invocation at `--timeout 60000`").not.toBeNull();
    expect(
      tail![1].trim(),
      `the seeded step's \`npx playwright test\` has \`${tail![1].trim()}\` after \`--timeout 60000\`, so it can pass when Playwright fails`,
    ).toBe("");
    // Nothing may follow the `fi` that closes the arm either: bash ignores errexit
    // for a compound command that is the non-final element of an `||` list, so
    // `fi || true` turns a red run green without touching the invocation line.
    const armText = seededElseArm(step);
    const armAt = step.indexOf(armText);
    expect(armAt, "the seeded else arm is not inside the seeded step").toBeGreaterThan(-1);
    const afterFi = step.slice(armAt + armText.length).split("\n")[0];
    expect(
      afterFi.trim(),
      `the seeded step's \`if\` has \`${afterFi.trim()}\` after its closing \`fi\`, which ignores errexit for the whole arm`,
    ).toBe("");
    expect(
      stepCode.some((l) => l.includes("$?")),
      "the seeded step reads `$?`, so it is capturing Playwright's exit code instead of failing on it",
    ).toBe(false);
  });

  it("the advisory `e2e` job's list does not carry the panel spec", () => {
    const advisory = codeLines(workflow).filter(
      (l) => /^\s*npx playwright test\b/.test(l) && l.includes(ADVISORY_ANCHOR),
    );
    expect(
      advisory.length,
      `Found no uncommented \`npx playwright test\` line naming ${ADVISORY_ANCHOR}: the advisory list moved, ` +
        "so this check would pass over nothing. Update ADVISORY_ANCHOR.",
    ).toBeGreaterThan(0);
    for (const line of advisory) {
      expect(
        line.includes(SPEC),
        `${SPEC} is in the advisory unseeded list, whose step has continue-on-error and which no aggregator needs`,
      ).toBe(false);
    }
  });

  it("the spec cannot pass by skipping, logs in, and seeds its own rows", () => {
    const code = stripCommentsPreserveLines(readRepoFile(SPEC));
    // Regexes, so a skip on any receiver is caught (`test.info().skip(`, an aliased
    // `t.skip(`). Written with an escaped dot so the source holds no disabled-spec
    // token for src/__tests__/contracts/spec-disabling.invariant.test.ts.
    for (const needle of [/\.skip\(/, /\.fixme\(/, /\.only\(/, /process\.env/, /PLAYWRIGHT_TEST_STRATEGY_ID/]) {
      expect(
        needle.test(code),
        `${SPEC} matches ${needle}: the panel tests could pass without running, which is the Phase 200 gap 1 failure mode`,
      ).toBe(false);
    }
    expect(
      code.includes("loginAs("),
      `${SPEC} no longer logs in through the /login form, so it would test the edit page as an anonymous visitor`,
    ).toBe(true);
    expect(
      code.includes("seedManagerKeyPanel("),
      `${SPEC} no longer seeds its own manager, strategy and keys, so it would depend on a fixed id that does not exist`,
    ).toBe(true);
  });
});
