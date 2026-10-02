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

  describe("self-tests of the real matcher", () => {
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
