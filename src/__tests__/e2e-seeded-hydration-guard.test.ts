/**
 * Phase 169.1.1 SC-4 — anti-drift guard: every seeded e2e spec runs under the
 * hydration guard.
 *
 * `e2e/helpers/hydration-guard.ts` turns a React #418 on a page into a named
 * test failure, but only for specs that take `test` from it. A spec added to
 * CI's seeded list with a plain Playwright import, or a guarded spec reverted
 * to one, would silently lose that protection while CI stays green. This test
 * reads the seeded list from `.github/workflows/ci.yml` (the
 * `Run seed-gated specs (MA-8 / BLOCK-3)` step, its `else` arm only) and fails
 * when any listed spec does not bind `test` from the guard.
 *
 * The population is pinned at its measured size so a parser that loses the
 * list fails loudly instead of reporting "no unguarded specs" over nothing.
 * The matcher is self-tested in both polarities below.
 *
 * It also pins where the guard's own self-test runs: every invocation must sit
 * in a step that can fail the `frontend` aggregator (no `continue-on-error`, no
 * `if:`, in a job the aggregator needs and judges). Presence in an advisory
 * step would let a guard that has gone blind merge with CI green.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = resolve(__dirname, "..", "..");
const CI_WORKFLOW = ".github/workflows/ci.yml";
const SEEDED_STEP_NAME = "- name: Run seed-gated specs (MA-8 / BLOCK-3)";
const GUARD_MODULE = "./helpers/hydration-guard";
const PLAYWRIGHT_MODULE = "@playwright/test";

/**
 * PIN: the number of distinct specs in the seeded step's `else` arm, measured
 * 2026-10-02 (Phase 169.1.1 plan 03). Update this pin TOGETHER with the CI
 * list. An empty or shorter parsed list fails, so a parser that stops finding
 * the step can never pass as "every spec is guarded".
 */
const SEEDED_SPEC_COUNT = 26;

function readRepoFile(rel: string): string {
  return readFileSync(resolve(REPO_ROOT, rel), "utf-8");
}

/**
 * The seeded specs, read from the workflow text. Only the `else` arm's
 * `npx playwright test` invocation is taken, up to its `--timeout` flag, so
 * the `if` arm's one-spec golden-bake line is never counted.
 */
function parseSeededSpecs(workflow: string): string[] {
  const start = workflow.indexOf(SEEDED_STEP_NAME);
  if (start === -1) return [];
  const rest = workflow.slice(start + SEEDED_STEP_NAME.length);
  const nextStep = rest.search(/\n\s*- name:/);
  const step = nextStep === -1 ? rest : rest.slice(0, nextStep);
  const elseArm = step.match(/\belse\s*\n\s*npx playwright test\b([\s\S]*?)--timeout/);
  if (!elseArm) return [];
  const paths = elseArm[1].match(/e2e\/[\w.-]+\.spec\.ts/g) ?? [];
  return [...new Set(paths)];
}

const GUARD_SELF_TEST = "e2e/hydration-guard.self-test.spec.ts";

/**
 * The one command the self-test step may run, verbatim. `--retries 0` because
 * its `test.fail()` cases make retries noise; `list` so a red result reads in
 * the step log. Anything else on the `run:` line can disarm the step.
 */
const SELF_TEST_COMMAND = `npx playwright test ${GUARD_SELF_TEST} --retries 0 --reporter=list`;

const NOT_EXACT_RUN =
  "its step's `run:` is not exactly the self-test command on one line " +
  "(a shell wrapper, an extra flag, an echo or a block scalar can each disarm it)";
const STEP_COE = "its step has a `continue-on-error:` key (any value)";

/** The merge-gating aggregator job of `.github/workflows/ci.yml`. */
const AGGREGATOR_JOB = "frontend";

interface SelfTestPlacement {
  job: string;
  /** Why this invocation does not block a merge; empty when it does. */
  advisoryBecause: string[];
}

/** Uncommented lines of `text`, with their original indentation. */
function codeLines(text: string): string[] {
  return text.split("\n").filter((line) => !/^\s*#/.test(line));
}

/**
 * The top-level jobs of a workflow, each as its uncommented lines. A job starts
 * at a two-space `name:` key under `jobs:` and runs to the next one.
 */
function workflowJobs(workflow: string): Map<string, string[]> {
  const jobs = new Map<string, string[]>();
  let inJobs = false;
  let current: string[] | null = null;
  for (const line of codeLines(workflow)) {
    if (/^\S/.test(line)) {
      inJobs = /^jobs:\s*$/.test(line);
      current = null;
      continue;
    }
    const key = inJobs ? line.match(/^ {2}([\w-]+):\s*$/) : null;
    if (key) {
      current = [];
      jobs.set(key[1], current);
    } else if (current) {
      current.push(line);
    }
  }
  return jobs;
}

/**
 * Every place the workflow runs the guard's self-test, and for each one why it
 * would NOT stop a merge. That spec is the only proof the guard bites, so it
 * must run where a red result fails the required check: in a step whose `run:`
 * is exactly SELF_TEST_COMMAND, with no `continue-on-error` key (whatever its
 * value) and no `if:`, in a job with no `continue-on-error` key, which
 * the `frontend` aggregator both `needs:` and judges in its result loop
 * (`needs:` alone only makes the aggregator wait). The invocation is matched on
 * one line; a reflow onto continuation lines finds no placement and fails loudly.
 */
function selfTestPlacements(workflow: string): SelfTestPlacement[] {
  const invocation = new RegExp(
    `npx playwright test\\b.*\\s${GUARD_SELF_TEST.replace(/\./g, "\\.")}(\\s|$)`,
  );
  // The step's `run:` must be SELF_TEST_COMMAND alone on its key's line. A
  // match on `invocation` only proves the path is named, not that it runs.
  const exactRun = new RegExp(
    `^ {6}(?:- | {2})run:[ \\t]+${SELF_TEST_COMMAND.replace(/[.]/g, "\\.")}[ \\t]*$`,
  );
  const jobs = workflowJobs(workflow);
  const aggregatorText = (jobs.get(AGGREGATOR_JOB) ?? []).join("\n");
  const needsList = aggregatorText.match(/^ {4}needs:\s*\n((?: {6}- [\w-]+[ \t]*(?:\n|$))+)/m);
  const needs = new Set(
    (needsList?.[1] ?? "")
      .split("\n")
      .map((l) => l.replace(/^\s*- /, "").trim())
      .filter(Boolean),
  );
  const placements: SelfTestPlacement[] = [];
  for (const [job, lines] of jobs) {
    lines.forEach((line, i) => {
      if (!invocation.test(line)) return;
      let start = i;
      while (start > 0 && !/^ {6}- /.test(lines[start])) start--;
      let end = i + 1;
      while (end < lines.length && !/^ {6}- /.test(lines[end])) end++;
      const step = lines.slice(start, end);
      const advisoryBecause: string[] = [];
      if (!step.some((l) => exactRun.test(l))) {
        advisoryBecause.push(NOT_EXACT_RUN);
      }
      if (step.some((l) => /^ {6}(?:- | {2})continue-on-error:/.test(l))) {
        advisoryBecause.push(STEP_COE);
      }
      if (step.some((l) => /^ {6}(?:- | {2})if:/.test(l))) {
        advisoryBecause.push("its step has an `if:` that can skip it");
      }
      if (lines.some((l) => /^ {4}continue-on-error:/.test(l))) {
        advisoryBecause.push(`job \`${job}\` has a \`continue-on-error:\` key (any value)`);
      }
      if (!needs.has(job)) {
        advisoryBecause.push(`job \`${job}\` is not in the \`${AGGREGATOR_JOB}\` aggregator's needs:`);
      }
      if (!aggregatorText.includes(`"${job}=\${{ needs.${job}.result }}"`)) {
        advisoryBecause.push(`job \`${job}\` has no row in the \`${AGGREGATOR_JOB}\` result loop`);
      }
      placements.push({ job, advisoryBecause });
    });
  }
  return placements;
}

interface ImportBinding {
  module: string;
  bindsValueTest: boolean;
}

/**
 * Import statements in comment-stripped source, each reduced to its module and
 * whether it binds the VALUE named `test` (by its imported name, so an alias
 * such as `test as base` still counts). Type-only imports bind no value. A
 * namespace import binds every value of the module, `test` included. The
 * inline type form `import("@playwright/test").Page` is not an import
 * statement and is never matched.
 */
function importBindings(source: string): ImportBinding[] {
  const code = stripCommentsPreserveLines(source);
  const out: ImportBinding[] = [];
  const named = /\bimport\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["']/g;
  for (const m of code.matchAll(named)) {
    const typeOnly = Boolean(m[1]);
    const bindsValueTest =
      !typeOnly &&
      m[2]
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !/^type\s/.test(s))
        .some((s) => s.split(/\s+as\s+/)[0].trim() === "test");
    out.push({ module: m[3], bindsValueTest });
  }
  const namespace = /\bimport\s+\*\s+as\s+\w+\s+from\s*["']([^"']+)["']/g;
  for (const m of code.matchAll(namespace)) {
    out.push({ module: m[1], bindsValueTest: true });
  }
  return out;
}

/** Why a spec is unguarded, or null when it is guarded. */
function unguardedReason(source: string): string | null {
  const bindings = importBindings(source);
  if (bindings.some((b) => b.module === PLAYWRIGHT_MODULE && b.bindsValueTest)) {
    return `binds \`test\` from "${PLAYWRIGHT_MODULE}"`;
  }
  if (!bindings.some((b) => b.module === GUARD_MODULE && b.bindsValueTest)) {
    return `does not bind \`test\` from "${GUARD_MODULE}"`;
  }
  return null;
}

describe("seeded e2e specs run under the hydration guard (Phase 169.1.1 SC-4)", () => {
  const seeded = parseSeededSpecs(readRepoFile(CI_WORKFLOW));

  it(`the seeded list parses to exactly ${SEEDED_SPEC_COUNT} distinct specs`, () => {
    expect(
      seeded.length,
      `Parsed ${seeded.length} spec(s) from the "${SEEDED_STEP_NAME}" step of ${CI_WORKFLOW}, ` +
        `expected ${SEEDED_SPEC_COUNT}. If the CI list changed, update SEEDED_SPEC_COUNT with it. ` +
        "If it did not, the parser has lost the list: fix the parser, never lower the pin to match.",
    ).toBe(SEEDED_SPEC_COUNT);
  });

  it("every seeded spec binds `test` from the hydration guard", () => {
    const offenders = seeded
      .map((rel) => {
        const reason = unguardedReason(readRepoFile(rel));
        return reason ? `${rel}: ${reason}` : null;
      })
      .filter((x): x is string => x !== null);
    expect(
      offenders,
      `Seeded specs without the hydration guard. Change the spec's import to ` +
        `\`import { test, expect } from "${GUARD_MODULE}";\` (keep its other named imports).`,
    ).toEqual([]);
  });

  it("the guard's self-test runs in CI, and only where a red result blocks a merge", () => {
    const placements = selfTestPlacements(readRepoFile(CI_WORKFLOW));
    expect(
      placements.length,
      `${GUARD_SELF_TEST} is not run by any \`npx playwright test\` line of ${CI_WORKFLOW}. ` +
        "It is the only proof the hydration guard bites; run it again in its own blocking step " +
        "of the `e2e-seeded` job.",
    ).toBeGreaterThan(0);
    expect(
      placements.filter((p) => p.advisoryBecause.length > 0),
      `${GUARD_SELF_TEST} runs somewhere a red result WOULD SURFACE in the run log but WOULD NOT ` +
        `stop a merge. It is the only proof the hydration guard bites, so every run of it must ` +
        `gate the \`${AGGREGATOR_JOB}\` check.`,
    ).toEqual([]);
  });

  describe("self-tests of the real matcher", () => {
    /** A minimal workflow: an aggregator gating `gated`, and an ungated `advisory` job. */
    function workflow(opts: {
      gatedStep?: string[];
      advisoryStep?: string[];
      needs?: string[];
      rows?: string[];
      gatedJobExtra?: string[];
    }): string {
      const needs = opts.needs ?? ["gated"];
      const rows = opts.rows ?? ["gated"];
      return [
        "name: CI",
        "jobs:",
        `  ${AGGREGATOR_JOB}:`,
        "    needs:",
        ...needs.map((n) => `      - ${n}`),
        "    if: always()",
        "    steps:",
        "      - name: Verify",
        "        run: |",
        "          for r in \\",
        ...rows.map((n) => `            "${n}=\${{ needs.${n}.result }}" \\`),
        "            ; do :; done",
        "  gated:",
        "    runs-on: ubuntu-latest",
        ...(opts.gatedJobExtra ?? []),
        "    steps:",
        "      - name: Earlier",
        "        continue-on-error: true",
        "        run: echo earlier",
        ...(opts.gatedStep ?? []),
        "      - name: Later",
        "        if: always()",
        "        run: echo later",
        "  advisory:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        ...(opts.advisoryStep ?? []),
        "",
      ].join("\n");
    }
    const blockingStep = [
      "      - name: Hydration guard self-test",
      `        run: ${SELF_TEST_COMMAND}`,
    ];

    it("passes a self-test in its own step of a job the aggregator needs and judges", () => {
      expect(selfTestPlacements(workflow({ gatedStep: blockingStep }))).toEqual([
        { job: "gated", advisoryBecause: [] },
      ]);
    });

    it("flags a self-test step with continue-on-error", () => {
      const [p] = selfTestPlacements(
        workflow({
          gatedStep: [
            "      - name: Hydration guard self-test",
            "        continue-on-error: true",
            `        run: ${SELF_TEST_COMMAND}`,
          ],
        }),
      );
      expect(p.advisoryBecause).toEqual([STEP_COE]);
    });

    it("passes only the exact command on the step's `run:` line", () => {
      for (const run of [
        `      - run: ${SELF_TEST_COMMAND}`,
        `        run: ${SELF_TEST_COMMAND}  `,
      ]) {
        const gatedStep = run.startsWith("      - ")
          ? [run]
          : ["      - name: Hydration guard self-test", run];
        expect(selfTestPlacements(workflow({ gatedStep }))).toEqual([
          { job: "gated", advisoryBecause: [] },
        ]);
      }
    });

    it("flags the command reflowed into a block scalar, or run without its flags", () => {
      for (const gatedStep of [
        ["      - name: S", "        run: |", `          ${SELF_TEST_COMMAND}`],
        ["      - name: S", `        run: npx playwright test ${GUARD_SELF_TEST}`],
        ["      - name: S", `        run: npx playwright test e2e/auth.spec.ts ${GUARD_SELF_TEST}`],
      ]) {
        const [p] = selfTestPlacements(workflow({ gatedStep }));
        expect(p.advisoryBecause).toEqual([NOT_EXACT_RUN]);
      }
    });

    it("flags a self-test step with an if:", () => {
      const [p] = selfTestPlacements(
        workflow({
          gatedStep: [
            "      - name: Hydration guard self-test",
            "        if: github.event_name == 'push'",
            `        run: ${SELF_TEST_COMMAND}`,
          ],
        }),
      );
      expect(p.advisoryBecause).toEqual(["its step has an `if:` that can skip it"]);
    });

    it("flags a job-level continue-on-error, literal or expression-valued", () => {
      for (const coe of [
        "    continue-on-error: true",
        "    continue-on-error: ${{ github.event_name == 'pull_request' }}",
      ]) {
        const [p] = selfTestPlacements(workflow({ gatedStep: blockingStep, gatedJobExtra: [coe] }));
        expect(p.advisoryBecause).toEqual(["job `gated` has a `continue-on-error:` key (any value)"]);
      }
    });

    it("flags a job the aggregator does not need", () => {
      const [p] = selfTestPlacements(workflow({ gatedStep: blockingStep, needs: ["other"] }));
      expect(p.advisoryBecause).toEqual([
        `job \`gated\` is not in the \`${AGGREGATOR_JOB}\` aggregator's needs:`,
      ]);
    });

    it("flags a job the aggregator needs but does not judge in its result loop", () => {
      const [p] = selfTestPlacements(workflow({ gatedStep: blockingStep, rows: ["other"] }));
      expect(p.advisoryBecause).toEqual([
        `job \`gated\` has no row in the \`${AGGREGATOR_JOB}\` result loop`,
      ]);
    });

    it("flags a copy left in an advisory job beside a blocking one", () => {
      const placements = selfTestPlacements(
        workflow({
          gatedStep: blockingStep,
          advisoryStep: [
            "      - name: Smoke",
            `        run: npx playwright test e2e/auth.spec.ts ${GUARD_SELF_TEST}`,
          ],
        }),
      );
      expect(placements.map((p) => p.job)).toEqual(["gated", "advisory"]);
      expect(placements[1].advisoryBecause).toContain(
        `job \`advisory\` is not in the \`${AGGREGATOR_JOB}\` aggregator's needs:`,
      );
    });

    // An echoed `npx playwright test <spec>` IS a placement, flagged by the
    // real-ci.yml case "flags an echoed command" below.
    it("finds no placement when the self-test is dropped, commented out, or its path is echoed without the command", () => {
      for (const gatedStep of [
        ["      - name: S", "        run: npx playwright test e2e/auth.spec.ts"],
        ["      - name: S", "        run: |", `          # npx playwright test ${GUARD_SELF_TEST}`],
        ["      - name: S", `        run: echo ${GUARD_SELF_TEST}`],
      ]) {
        expect(selfTestPlacements(workflow({ gatedStep }))).toEqual([]);
      }
    });

    describe("edits to the real ci.yml that disarm the self-test step are flagged", () => {
      const real = readRepoFile(CI_WORKFLOW);
      const runLine = `        run: ${SELF_TEST_COMMAND}`;

      it("the real step's run: line is present exactly once (else every case below is vacuous)", () => {
        expect(real.split(runLine).length - 1).toBe(1);
      });

      const disarms: Array<[string, string, string]> = [
        ["|| true", `${runLine} || true`, NOT_EXACT_RUN],
        [
          "an expression-valued continue-on-error",
          `        continue-on-error: \${{ github.event_name == 'pull_request' }}\n${runLine}`,
          STEP_COE,
        ],
        ["--list", `${runLine} --list`, NOT_EXACT_RUN],
        [
          "--grep NOMATCH --pass-with-no-tests",
          `${runLine} --grep NOMATCH --pass-with-no-tests`,
          NOT_EXACT_RUN,
        ],
        [
          "a shell if false wrapper",
          `        run: if false; then ${SELF_TEST_COMMAND}; fi`,
          NOT_EXACT_RUN,
        ],
        [
          "an echoed command",
          `        run: echo npx playwright test ${GUARD_SELF_TEST} --retries 0`,
          NOT_EXACT_RUN,
        ],
      ];

      it.each(disarms)("flags %s", (_label, replacement, reason) => {
        const mutated = real.replace(runLine, replacement);
        expect(mutated).not.toBe(real);
        const placements = selfTestPlacements(mutated);
        expect(placements.length).toBeGreaterThan(0);
        expect(placements.flatMap((p) => p.advisoryBecause)).toContain(reason);
      });
    });

    it("reports a plain Playwright import", () => {
      expect(unguardedReason('import { test, expect } from "@playwright/test";\n')).toBe(
        'binds `test` from "@playwright/test"',
      );
    });

    it("reports an aliased Playwright `test`", () => {
      expect(unguardedReason('import { test as base } from "@playwright/test";\n')).not.toBeNull();
    });

    it("reports a namespace Playwright import", () => {
      expect(unguardedReason('import * as pw from "@playwright/test";\n')).not.toBeNull();
    });

    it("passes a guarded import with type specifiers", () => {
      expect(
        unguardedReason('import { test, expect, type Page } from "./helpers/hydration-guard";\n'),
      ).toBeNull();
    });

    it("passes a guarded spec that also uses an inline Playwright type", () => {
      expect(
        unguardedReason(
          'import { test, expect } from "./helpers/hydration-guard";\n' +
            'async function login(page: import("@playwright/test").Page) {}\n',
        ),
      ).toBeNull();
    });

    it("passes a guarded spec with a type-only Playwright import", () => {
      expect(
        unguardedReason(
          'import type { Page } from "@playwright/test";\n' +
            'import { test } from "./helpers/hydration-guard";\n',
        ),
      ).toBeNull();
    });

    it("does not count a guard import inside a line comment", () => {
      expect(
        unguardedReason('// import { test } from "./helpers/hydration-guard";\nconst x = 1;\n'),
      ).toBe('does not bind `test` from "./helpers/hydration-guard"');
    });

    it("does not count a guard import that binds only `expect`", () => {
      expect(unguardedReason('import { expect } from "./helpers/hydration-guard";\n')).not.toBeNull();
    });

    it("parses only the else arm of the seeded step, de-duplicated", () => {
      const sample = [
        "      - name: Unseeded",
        "        run: |",
        "            npx playwright test e2e/auth.spec.ts --timeout 60000",
        `      ${SEEDED_STEP_NAME}`,
        "        run: |",
        '          if [ "${BAKE_SVG_GOLDENS}" = "true" ]; then',
        "            npx playwright test e2e/svg-chart-parity.spec.ts \\",
        "              --update-snapshots \\",
        "              --timeout 60000",
        "          else",
        "            npx playwright test \\",
        "              e2e/a.spec.ts \\",
        "              e2e/b.spec.ts \\",
        "              e2e/a.spec.ts \\",
        "              --timeout 60000",
        "          fi",
        "      - name: Later step",
        "        run: npx playwright test e2e/later.spec.ts --timeout 1",
      ].join("\n");
      expect(parseSeededSpecs(sample)).toEqual(["e2e/a.spec.ts", "e2e/b.spec.ts"]);
    });

    it("returns an empty list when the seeded step is missing", () => {
      expect(parseSeededSpecs("jobs: {}\n")).toEqual([]);
    });
  });
});
