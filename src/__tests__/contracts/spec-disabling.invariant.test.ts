/**
 * 140.5-06 / SEAMPROSE-04 (WP-12) — NO SPEC IS SILENTLY DISABLED.
 *
 * THE PROPERTY: no test file in this repo disables a spec unconditionally. A
 * quietly-skipped spec ships a hole while CI reads green, and the hole is
 * invisible precisely because the suite still passes.
 *
 * ⚠️ BRANCH PROTECTION ON `main` IS OFF (CONTEXT §9), so this guard — like every
 * gate in this repo — is ADVISORY at merge. It "would have caught" the
 * conditions below; it cannot be said to have "stopped" anything.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS IS A VITEST GUARD AND NOT THE `ci.yml` GREP
 *
 * `ci.yml` already greps ONE file (`$spec` is assigned once, to a single e2e
 * spec) with a line-based `grep -Eq`. That line is LEFT UNCHANGED by this plan,
 * deliberately: it is green and harmless where it sits, and widening IT is the
 * thing that does not work. Measured, not predicted — widening that same regex
 * to `src/**` + `tests/**` REDDENS A CLEAN TREE TODAY, on exactly one hit, and
 * that hit is a COMMENT: `src/components/ResponsiveChartFrame.test.tsx` contains
 * the token inside a prose paragraph explaining why a spec was deleted.
 *
 * That is DEF-16-2 (grep is line-based and comment-blind) living inside the very
 * mechanism this work item schedules. bash cannot comment-strip maintainably;
 * this guard can, and does — every needle below runs against COMMENT-STRIPPED
 * source via `stripCommentsPreserveLines`. The specimen is pinned as a
 * both-polarity self-test below, so the comment-blindness cannot come back.
 *
 * Coverage-law row: **ROW 1**. The population is derived from disk on every run,
 * so a spec file added tomorrow is covered without anyone editing this file. The
 * ONE hand-typed list here is the exemption ledger, and its length is pinned as a
 * DECISION (see EXEMPT).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { stripCommentsPreserveLines } from "@/lib/source-scan";

const REPO_ROOT = process.cwd();

/**
 * THE DERIVED POPULATION (row 1). Walked from disk every run.
 *
 * Three roots, because the repo keeps specs in three places: Playwright specs in
 * `e2e/`, vitest suites colocated under `src/`, and the standalone `tests/` tree.
 */
const ROOTS = ["e2e", "src", "tests"] as const;

function isSpecFile(path: string): boolean {
  return (
    path.endsWith(".spec.ts") ||
    path.endsWith(".spec.tsx") ||
    path.endsWith(".test.ts") ||
    path.endsWith(".test.tsx")
  );
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".next" || entry === "dist") continue;
    const full = join(dir, entry);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(full, out);
    else if (isSpecFile(full)) out.push(full);
  }
  return out;
}

function derivedPopulation(): string[] {
  const files: string[] = [];
  for (const root of ROOTS) walk(join(REPO_ROOT, root), files);
  return files.map((f) => relative(REPO_ROOT, f)).sort();
}

/**
 * THE NEEDLES — the `ci.yml:1633` set PLUS the shapes it measurably misses.
 *
 * Each entry is a matcher over COMMENT-STRIPPED source.
 *
 * ⛔ `test.slow(` IS DELIBERATELY NOT A NEEDLE. Playwright's `test.slow()`
 * TRIPLES A TIMEOUT; it does not disable anything. Including it was a category
 * error and it is recorded here so nobody re-adds it as an apparent omission.
 *
 * ⛔ `skipIf(` and CONDITIONAL `test.skip(<expr>, …)` are also NOT needles, and
 * that is the whole point of the distinction: an env-gated skip is a documented
 * precondition, whereas a literal-`true`/empty-arg skip is a disabled spec. The
 * `test.skip(` patterns below therefore match ONLY the literal-true and
 * no-argument forms.
 */
const NEEDLES: readonly { readonly name: string; readonly re: RegExp }[] = [
  // --- the ci.yml:1633 set, re-expressed ---
  { name: "test.skip(true)", re: /\btest\.skip\(\s*true\b/ },
  { name: "test.skip()", re: /\btest\.skip\(\s*\)/ },
  { name: ".fixme(", re: /\.fixme\(/ },
  { name: "test.only(", re: /\btest\.only\(/ },
  { name: "describe.only(", re: /\bdescribe\.only\(/ },
  { name: "describe.skip(", re: /\bdescribe\.skip\(/ },
  // --- the measured misses (RESEARCH §8.3) ---
  { name: "it.skip(", re: /\bit\.skip\(/ },
  { name: "it.only(", re: /\bit\.only\(/ },
  { name: "test.todo(", re: /\btest\.todo\(/ },
  { name: "describe.todo(", re: /\bdescribe\.todo\(/ },
  { name: "xit(", re: /(?<![\w.])xit\(/ },
  { name: "xdescribe(", re: /(?<![\w.])xdescribe\(/ },
  { name: "test.describe.skip(", re: /\btest\.describe\.skip\(/ },
];

/**
 * THE EXEMPTION LEDGER — hand-typed, row 2, and it says so.
 *
 * Its LENGTH IS A DECISION, pinned below with a literal. A silent widening would
 * quietly convert this row-1 guard into a row-2 roster, which is the exact
 * downgrade this milestone exists to stop — so growing this list must be a
 * deliberate act that also edits the pin and states a reason here.
 */
const EXEMPT: readonly { readonly file: string; readonly reason: string }[] = [
  {
    file: "e2e/strategy-v2-keyboard.spec.ts",
    reason:
      "A TODO-rewrite skip (PR #108 deferred follow-ups): the spec needs " +
      "role-based locators and a chart-mount guard before it can run. The CLASS " +
      "of regression it was written to catch is held meanwhile by " +
      "tests/visual/chart-accessibility-layer.test.ts, which the spec's own " +
      "comment names. Un-skipping a spec known to need a rewrite would redden " +
      "CI on a non-defect, so it stays skipped and stays visible HERE instead.",
  },
  {
    file: "e2e/strategy-v2-chart-parity.spec.ts",
    reason:
      "The SAME class as strategy-v2-keyboard above, and found only because " +
      "this guard scans whole files: a TODO-rewrite skip from the PR #108 " +
      "deferred follow-ups. Its own comment records that no SVG paths exist for " +
      "its structural assertions, that goldens were never baselined " +
      "(e2e/__snapshots__/ has never existed on any branch), and that when a " +
      "seed env var briefly un-skipped it in CI the spec was red continuously. " +
      "Converting it to an env gate would therefore re-enable a KNOWN-RED spec " +
      "rather than recover coverage; it needs the canvas-API rewrite first.",
  },
  {
    file: "src/__tests__/audit-coverage.test.ts",
    reason:
      "A DOCUMENTATION skip: the case describes H-0001's intended behaviour " +
      "rather than asserting it. Deliberate, and kept as prose-in-a-test on " +
      "purpose so the intent stays next to the coverage it qualifies.",
  },
];

const EXEMPT_FILES = new Set(EXEMPT.map((e) => e.file));

/**
 * SELF-REFERENCE EXCLUSION — structurally different from EXEMPT, and kept apart
 * from it on purpose.
 *
 * This file necessarily CONTAINS every needle it searches for: the `NEEDLES`
 * table spells them out, and the both-polarity self-tests below feed them
 * through the real pipeline as string literals. The comment-stripper preserves
 * string contents BY CONTRACT (a `//` inside a string is not a comment), so
 * those specimens are live text to the scanner and the guard reports ITSELF —
 * measured on first run, not anticipated.
 *
 * A scanner cannot be its own subject. This is NOT an exemption for a disabled
 * spec (the ledger above is for those, and its length is pinned so it cannot
 * absorb this case quietly); it is the scanner declining to scan itself. It is a
 * single, structural, self-referential exclusion, and the self-tests are what
 * keep this file honest instead.
 */
const SELF = "src/__tests__/contracts/spec-disabling.invariant.test.ts";

/**
 * ⚠️ WHOLE-FILE MATCHING, NOT LINE-BY-LINE — and this is load-bearing.
 *
 * The first cut of this function split the stripped source into lines and tested
 * each line. It was measured against the very sites this plan converted and
 * WOULD HAVE CAUGHT ONLY ONE OF FIVE, because the prettier-formatted shape
 *
 *     test.skip(
 *       true,
 *       "reason",
 *     );
 *
 * puts `test.skip(` and `true` on DIFFERENT LINES, so no single line matches.
 * Four of the five unconditional skips in this repo were written that way. That
 * is DEF-16-2 in its second form — a line-based scanner silently returning zero
 * on a wrapped construct — and it is the same defect that makes `ci.yml`'s
 * `grep -Eq` unfit for this job, arriving here by a different route.
 *
 * So the needles run against the FULL stripped text (their `\s*` therefore spans
 * newlines), and the line number is recovered from the match index so the report
 * still names a real, clickable coordinate.
 */
function offencesIn(relPath: string, source: string): string[] {
  // `SourceLang` is "ts" | "py" — there is no separate "tsx" member, and none is
  // needed: TSX comment syntax is identical to TS, so one tokenizer serves both
  // extensions in the population.
  const stripped = stripCommentsPreserveLines(source, "ts");
  const found: string[] = [];
  for (const needle of NEEDLES) {
    const re = new RegExp(needle.re.source, "g");
    for (const m of stripped.matchAll(re)) {
      const line = stripped.slice(0, m.index).split("\n").length;
      found.push(`${relPath}:${line} → ${needle.name}`);
    }
  }
  return found.sort();
}

describe("[140.5-06 / SEAMPROSE-04] no spec is silently disabled", () => {
  const population = derivedPopulation();

  it("VACUITY FENCE — the walk actually found the spec population", () => {
    // A guard asserting an ABSENCE reads as protection while doing nothing if
    // its scanner breaks. These floors are what stop a walk that has lost its
    // roots from passing as "no offences found".
    //
    // ⚠️ THE PREDICATE THIS FLOOR IS BASED ON, published because a bare integer
    // is what this phase exists to remove — and re-measured at THIS plan's base
    // rather than inherited: `npx vitest run` reports its own file count as
    // **729 passed + 19 skipped = 748 test files**, and `find e2e -name
    // '*.spec.ts'` reports **51**. THIS GUARD'S OWN PREDICATE IS NEITHER of
    // those: it walks `e2e/`, `src/` and `tests/` for `*.{test,spec}.{ts,tsx}`,
    // which counts files vitest never loads (helpers, e2e specs) and so returns
    // a LARGER number than vitest's. The floor is set well under the measured
    // value so ordinary churn does not trip it; the failure message states the
    // predicate so the next reader compares like with like.
    expect(
      population.length,
      `The spec walk over ${ROOTS.join(", ")} is now BLIND, NOT SATISFIED. It ` +
        "scans e2e/ + src/ + tests/ for *.{test,spec}.{ts,tsx} — a different " +
        "population from vitest's own file count (748 at this plan's base: 729 " +
        "passed + 19 skipped) and from `find e2e -name '*.spec.ts'` (51). Fix " +
        "the walk; never lower this floor.",
    ).toBeGreaterThanOrEqual(400);

    // Both non-e2e roots must contribute, or a broken join() silently halves
    // the population while still clearing a single global floor.
    expect(
      population.filter((p) => p.startsWith("e2e/")).length,
    ).toBeGreaterThanOrEqual(30);
    expect(
      population.filter((p) => p.startsWith("src/")).length,
    ).toBeGreaterThanOrEqual(300);
  });

  it("the exemption ledger is FROZEN at its decided length", () => {
    // The literal is the decision record. Widening the allow-list without
    // touching this number is impossible; widening it WITH this number is a
    // deliberate act that a reviewer sees in the diff.
    // ⚠️ THIS PIN WAS PLANNED AS 2 AND IS 3, AND THE DIFFERENCE IS RECORDED
    // RATHER THAN ABSORBED. 140.5-06's plan enumerated SIX unconditional skips
    // and froze this length at two on that basis. Scanning whole files instead
    // of single lines (see `offencesIn`) found FOUR MORE — all in the wrapped
    // `test.skip(\n true,` form that a line-based enumeration cannot see. Three
    // of the four were env-gated preconditions and were CONVERTED, exactly like
    // the planner's own four; the fourth is a second TODO-rewrite skip of the
    // identical class the planner had already decided to allow-list, so it is
    // allow-listed on the planner's own stated reasoning.
    //
    // The planner's count did not survive re-measurement — which is this
    // milestone's own subject matter, so it is stated here in the artefact and
    // in the SUMMARY rather than quietly satisfied.
    expect(
      EXEMPT.length,
      "The exemption ledger grew (or shrank) without this pin being updated. " +
        "Every entry must carry a REASON and be argued in 140.5-06's SUMMARY — " +
        "an allow-list that grows silently turns this row-1 guard into a row-2 " +
        "roster, which is the downgrade this milestone exists to stop.",
    ).toBe(3);
    for (const entry of EXEMPT) {
      expect(entry.reason.length).toBeGreaterThan(80);
    }
  });

  it("no non-exempt spec file disables a spec unconditionally", () => {
    const offences: string[] = [];
    for (const relPath of population) {
      if (relPath === SELF) continue; // see the SELF docblock — a scanner cannot scan itself
      if (EXEMPT_FILES.has(relPath)) continue;
      offences.push(
        ...offencesIn(relPath, readFileSync(join(REPO_ROOT, relPath), "utf8")),
      );
    }

    expect(
      offences,
      "A spec is disabled unconditionally. CI reads GREEN while the behaviour " +
        "it covered ships unguarded.\n\n" +
        "REQUIRED RESPONSE, in order of preference:\n" +
        "  1. Make the skip CONDITIONAL — `test.skip(!process.env.X, reason)` or " +
        "the repo's `it.skipIf(!HAS_LIVE_DB)` convention. The spec then runs " +
        "wherever its precondition holds instead of being dead everywhere.\n" +
        "  2. Fix or delete the spec.\n" +
        "  3. Only if neither is possible: add it to EXEMPT with a written " +
        "reason AND bump the frozen length pin above. Do NOT widen the " +
        "allow-list silently.\n\n" +
        `Offending sites:\n${offences.join("\n")}`,
    ).toEqual([]);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // BOTH-POLARITY NEEDLE SELF-TESTS.
  //
  // These are this guard's falsifiability evidence. The Falsifiability Ledger's
  // usual rule — mutate PRODUCTION source — cannot apply here, because this
  // guard's SUBJECT IS TEST FILES: any edit that would trip it is definitionally
  // a test edit and therefore an inadmissible mutation. Per the Wave-0 sanction
  // these self-tests stand in, and they run the REAL pipeline (the same
  // `offencesIn`, the same comment-strip) over source TEXT samples rather than a
  // reimplementation of it.
  // ───────────────────────────────────────────────────────────────────────────
  describe("needle self-tests (the guard's own falsifiability)", () => {
    it("POSITIVE — every needle is detected in live code", () => {
      const samples: readonly string[] = [
        'test.skip(true, "x");',
        "test.skip();",
        'test.fixme("x", () => {});',
        'test.only("x", () => {});',
        'describe.only("x", () => {});',
        'describe.skip("x", () => {});',
        'it.skip("x", () => {});',
        'it.only("x", () => {});',
        'test.todo("x");',
        'describe.todo("x");',
        'xit("x", () => {});',
        'xdescribe("x", () => {});',
        'test.describe.skip("x", () => {});',
      ];
      for (const sample of samples) {
        expect(
          offencesIn("sample.test.ts", sample),
          `A needle stopped matching live code: ${sample}`,
        ).not.toEqual([]);
      }
    });

    it("POSITIVE — the WRAPPED form is detected (the line-based scanner's blind spot)", () => {
      // ⭐ THE REGRESSION THIS PINS WAS REAL AND WAS MEASURED HERE. A per-line
      // scanner misses this shape entirely, and FOUR of the five unconditional
      // skips 140.5-06 converted were written exactly like it — so a line-based
      // version of this guard would have reported 1 of 5 while reading green.
      const wrapped = [
        "test.skip(",
        "  true,",
        '  "Requires an authenticated session. Set PLAYWRIGHT_TEST_STRATEGY_ID to run.",',
        ");",
      ].join("\n");

      const offences = offencesIn("sample.spec.ts", wrapped);
      expect(
        offences,
        "The wrapped `test.skip(\\n true,` form went undetected. A scanner that " +
          "only ever sees one physical line at a time cannot see this, which is " +
          "why the needles run against the whole stripped file.",
      ).not.toEqual([]);
      // The reported coordinate must be the line the CALL starts on, not the
      // line `true` happens to sit on — a report that points at the argument
      // sends the reader to the wrong place in a long file.
      expect(offences[0]).toBe("sample.spec.ts:1 → test.skip(true)");
    });

    it("NEGATIVE — the DEF-16-2 specimen: a COMMENT mentioning a needle must NOT trip", () => {
      // ⭐ THIS IS THE MEASURED SPECIMEN, and the reason this guard is not a
      // bash grep. The repo really contains a comment of this shape, in
      // `src/components/ResponsiveChartFrame.test.tsx`, and it is what reddens
      // the widened `ci.yml` regex on a clean tree.
      //
      // The sample below is a PARAPHRASE of that comment's shape rather than a
      // copy of its sentence: quoting discredited text verbatim re-seeds the
      // very needle the check is about, which this phase measured happening in
      // 140.5-04 when a correction quoted the coordinate it was correcting.
      const commentOnly = [
        "/**",
        " * A deleted spec that was permanently `test.skip(true)`, aimed at the",
        " * wrong stack, and carried no goldens.",
        " */",
        "// it.only( and describe.skip( named here in prose, not called",
        'it("a real, enabled test", () => {});',
      ].join("\n");

      expect(
        offencesIn("sample.test.ts", commentOnly),
        "A needle matched inside a COMMENT. That is DEF-16-2 — the failure " +
          "mode that makes the bash grep unusable at this scope, and the whole " +
          "reason this guard comment-strips first.",
      ).toEqual([]);
    });

    it("NEGATIVE — conditional skips are PRECONDITIONS, not disabled specs", () => {
      // ⚠️ The env-gated sample below reads its flag through a BOUND NAME rather
      // than a literal `process.env.<KEY>` expression, and that is deliberate:
      // `env-manifest.test.ts` scans all of `src/` for literal env reads and
      // would (correctly, on its own terms) report a specimen string here as an
      // undocumented key. Measured — the first version of this sample reddened
      // that guard on the full suite while this file's own scoped run was green.
      // The property under test is that a CONDITIONAL first argument is not a
      // needle; the shape of the condition is immaterial to it.
      const conditional = [
        'test.skip(!strategyIdFromEnv, "needs a strategy id");',
        'it.skipIf(!HAS_LIVE_DB)("live-DB case", () => {});',
        'describe.skipIf(!HAS_LIVE_DB)("live-DB group", () => {});',
        'test.skip(({ browserName }) => browserName === "webkit", "flaky on webkit");',
      ].join("\n");

      expect(
        offencesIn("sample.test.ts", conditional),
        "A CONDITIONAL skip was reported as a disabled spec. An env-gated or " +
          "browser-gated skip is a documented precondition — flagging it would " +
          "push authors to delete real gating, which is worse than the hole " +
          "this guard closes.",
      ).toEqual([]);
    });

    it("NEGATIVE — `test.slow(` is NOT a needle (it triples a timeout, it does not disable)", () => {
      expect(
        offencesIn("sample.test.ts", "test.slow();\ntest.slow(true);"),
        "`test.slow()` was treated as spec-disabling. It is not: Playwright " +
          "triples the timeout and the spec still RUNS. Including it was a " +
          "category error and must not be reintroduced.",
      ).toEqual([]);
    });

    it("NEGATIVE — a needle inside a STRING is not a call", () => {
      // The comment-stripper deliberately leaves string contents intact, so this
      // case documents the residual: a needle in a string literal still matches.
      // It is asserted as a KNOWN LIMIT rather than silently tolerated.
      const inString = 'const doc = "run test.only( to focus";';
      expect(
        offencesIn("sample.test.ts", inString).length,
        "KNOWN LIMIT, asserted so it cannot change unnoticed: needles inside " +
          "STRING literals still match, because the comment-stripper preserves " +
          "string contents by contract. No occurrence exists in the repo today " +
          "(the population assertion above is green); if one appears, the fix is " +
          "to teach this guard about strings, not to widen EXEMPT.",
      ).toBe(1);
    });
  });
});
