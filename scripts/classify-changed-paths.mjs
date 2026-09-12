#!/usr/bin/env node
/**
 * Docs-only path classifier — Phase 164.6.3 / CI-DOCSPATH-01.
 *
 * ⚠️ WHY THIS EXISTS, measured 2026-09-06 (PR #750, CI run `34062196456`): a
 * roadmap-insertion PR whose only substantive content was planning bookkeeping
 * ran the entire gate corpus, and took the shared-TEST advisory lock `61616158`
 * against other people's CI while doing it. `.planning/ROADMAP.md` and
 * `TODOS.md` both record that run as `21 jobs / ~50 job-minutes`.
 *
 * ⚠️ THREE jobs take that lock per run, not two: `python`, `e2e-seeded` and
 * `sql-tests`. The ROADMAP and the `[CI-DOCSPATH-01]` TODOS entry both
 * undercount at two — `python` is the forgotten taker. Corrected here and in
 * the ledger by this phase; if you are counting mutex acquires in a run log,
 * count to three.
 *
 * ⛔ AND PR #750 ITSELF WOULD NOT BE FILTERED BY THIS GATE. Measured
 * 2026-09-12 from its own file list: alongside four `.planning/` paths it
 * changed `CHANGELOG.md`, `TODOS.md`, `VERSION` and `package.json`, none of
 * which is on the allow-list below — so #750 classifies as CODE here and
 * would still run the whole corpus. The ledger entries call it a docs PR;
 * that describes its SHAPE, not its classification under this rule. This
 * paragraph exists so a future reader does not open the motivating incident,
 * see a full corpus, and conclude the filter is broken. The PR class this
 * gate DOES filter is the `.planning/`-only one: the plan, summary and state
 * commits that carry no release toll, which is the common GSD case and the
 * reason the allow-list is drawn where it is rather than one file wider.
 * ⛔ Do NOT "fix" this by adding `CHANGELOG.md` / `VERSION` / `TODOS.md` to
 * the allow-list. Those paths are how a release ships, and a release is
 * exactly the change that must run every gate.
 *
 * ⚠️ TWO CORPUS FIGURES EXIST AND BOTH ARE RIGHT AT THEIR OWN SCOPE — do not
 * book a phantom drift between them. `21 jobs / ~50 job-minutes` is the
 * ROADMAP/TODOS figure and it counts by JOB KEY. The complete census by CHECK
 * ROW is `23 rows / 4,760 job-seconds`, measured on CI run `34717952454` — a
 * later, different pull request, cited for the corpus baseline and not for
 * #750. The counts differ for two stated reasons: `frontend-test` is a
 * two-shard matrix and reports two check rows for one job key, and the earlier
 * count was taken while `e2e-seeded` and `sql-tests` were still running. Both
 * halves are carried in this phase's `164.6.3-RESEARCH.md` — the "Before/After
 * Job Census" section, which ends with its own `23 rows, not 21 job keys`
 * warning, and the "Evidence Collection" section, whose first recipe quotes the
 * executed 23-row census verbatim. Cited by SECTION, never by line number:
 * `[164.7-CITATION-DRIFT-01]` is this repository's named defect class for prose
 * that carries a coordinate which later drifts, and a permanent script header
 * is the worst possible place to seed another instance.
 *
 * The rule: a pull request whose changed-file list is ENTIRELY under
 * `.planning/` is docs-only; anything else is code.
 *
 * ⛔ FAIL-CLOSED, BY DECISION. Every unreadable, empty or otherwise ambiguous
 * input classifies as CODE. The asymmetry is the whole argument: a wrong
 * `true` skips sixteen gates at once — it is a gate-disable primitive wearing
 * an optimisation's clothes — while a wrong `false` costs a few runner
 * minutes. A read failure is a `MEASURE_FAIL` and a non-zero exit, because a
 * gate that cannot read cannot report a pass.
 *
 * `--self-test` proves every verdict fires against synthetic inputs. A gate
 * whose red path has never been observed is the defect this repository's 164.3
 * phase exists to remove — and this classifier is the single point of trust for
 * the whole path filter, so its own table is the first thing that must be true.
 */
import { appendFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/**
 * ⛔ AN ALLOW-LIST. It must never become a deny-list of code paths: under a
 * deny-list a new top-level directory defaults to "docs" and silently skips the
 * corpus, which is the fail-open direction this file exists to refuse.
 *
 * ⭐ The trailing separator lives INSIDE the literal rather than being appended
 * at compare time. That is what makes the prefix-boundary self-test rows fail
 * closed: `.planningfake/y.ts`, a tracked file named exactly `.planning`, and
 * `.planning-notes/x.md` all fail `startsWith(".planning/")`.
 */
export const DOCS_ONLY_PREFIXES = [".planning/"];

/**
 * PURE: given the changed-file list, is this diff docs-only? No I/O, so the
 * self-test drives it directly.
 *
 * ⚠️ This is the SAME predicate `scripts/check-version-bump.mjs` uses for its
 * planning-only exemption (`!f.startsWith(".planning/")`). The two are kept
 * provably identical by a self-test row here rather than by a shared import.
 * ⛔ Do NOT refactor `check-version-bump.mjs` to import this module: that is a
 * behavioural change to an always-on release gate in exchange for nothing.
 *
 * ⭐ The verdict is order-independent by construction — `.every` over a
 * membership predicate is commutative — and the self-test pins it anyway
 * rather than trusting the reasoning.
 */
export function judge(changedFiles) {
  // An EMPTY diff is CODE by decision, not by omission. It is reachable two
  // ways: an empty commit, and a base ref that resolved to nothing (so the
  // three-dot diff printed no names). Both mean "we do not know what changed",
  // and the fail-closed answer to that is to run everything.
  if (changedFiles.length === 0) return false;
  return changedFiles.every((f) => DOCS_ONLY_PREFIXES.some((p) => f.startsWith(p)));
}

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

/**
 * One machine-readable summary line always; the `$GITHUB_OUTPUT` append only
 * when the variable is present, so a bare local run still works the way every
 * other script in `scripts/` does.
 */
function emit(value, reason) {
  console.log(`docs_only=${value} — ${reason}`);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `docs_only=${value}\n`);
  }
}

/**
 * The fixture table. Every row carries its own claim and fires on its own
 * input; the terminal count is DERIVED from this array's length rather than
 * hand-typed, so a row added without a banner cannot drift.
 */
const CASES = [
  {
    claim: "a .planning/-only diff is docs-only (the happy path exists at all)",
    run: (ok) => ok(judge([".planning/ROADMAP.md"]) === true, "a roadmap-only diff classifies as docs"),
  },
  {
    claim: "a MIXED diff is CODE",
    run: (ok) =>
      ok(
        judge([".planning/ROADMAP.md", "src/app/page.tsx"]) === false,
        "one code file anywhere in the list makes the whole diff code",
      ),
  },
  {
    claim: "the filter's own subject re-runs the corpus — .github/workflows/ci.yml",
    run: (ok) =>
      ok(
        judge([".github/workflows/ci.yml"]) === false,
        "a PR editing the workflow that hosts the filter is never filtered",
      ),
  },
  {
    claim: "the detector's own subject re-runs the corpus — scripts/classify-changed-paths.mjs",
    run: (ok) =>
      ok(
        judge(["scripts/classify-changed-paths.mjs"]) === false,
        "a PR editing this very file is never filtered",
      ),
  },
  {
    claim: "a migration alone is CODE",
    run: (ok) =>
      ok(
        judge(["supabase/migrations/20260912000000_x.sql"]) === false,
        "supabase/migrations/ is not on the allow-list",
      ),
  },
  {
    claim: "the allow-list is .planning/, NOT every markdown file",
    run: (ok) => {
      // Each of these ships real behaviour or a real release toll. CHANGELOG.md
      // and VERSION move together on every release; TODOS.md is the backlog's
      // single ground truth; docs/ is link-checked. None is `.planning/`.
      const lookalikes = ["README.md", "docs/runbooks/x.md", "CHANGELOG.md", "VERSION", "TODOS.md"];
      let pass = true;
      for (const f of lookalikes) {
        pass = ok(judge([f]) === false, `${f} alone classifies as code`) && pass;
      }
      return pass;
    },
  },
  {
    claim: "the EMPTY list is CODE — the fail-closed empty-input edge",
    run: (ok) => ok(judge([]) === false, "a zero-file diff runs the full corpus rather than skipping it"),
  },
  {
    claim: "the prefix-boundary edge — .planningfake/ is not .planning/",
    run: (ok) =>
      ok(
        judge([".planning/x.md", ".planningfake/y.ts"]) === false,
        "a sibling directory sharing the prefix does not launder into the allow-list",
      ),
  },
  {
    claim: "the prefix-boundary edge from the other side — a bare `.planning` and `.planning-notes/`",
    run: (ok) => {
      let pass = ok(
        judge([".planning"]) === false,
        "a tracked file named exactly `.planning`, with no separator, classifies as code",
      );
      pass = ok(judge([".planning-notes/x.md"]) === false, ".planning-notes/ classifies as code") && pass;
      return pass;
    },
  },
  {
    claim: "a traversal form does not launder into the allow-list",
    run: (ok) =>
      ok(judge(["docs/../src/a.ts"]) === false, "docs/../src/a.ts classifies as code on its literal bytes"),
  },
  {
    claim: "ORDERING EDGE — the verdict does not depend on the order of the list",
    run: (ok) => {
      const original = [".planning/a.md", "src/b.ts", ".planning/c.md"];
      const reversed = [...original].reverse();
      // ⭐ The reversal is asserted to have APPLIED before the equality is
      // believed. On a one-element list `reverse()` is a no-op and this row
      // would pass while proving nothing — the vacuity shape this table exists
      // to refuse.
      let pass = ok(
        JSON.stringify(reversed) !== JSON.stringify(original),
        "CALIBRATION: the reversal actually produced a different array",
      );
      pass = ok(judge(original) === judge(reversed), "the same set in two orders yields the same verdict") && pass;
      return pass;
    },
  },
];

function selfTest() {
  let pass = true;
  const ok = (cond, msg) => {
    console.log(`  ${cond ? "ok  " : "FAIL"} — ${msg}`);
    return cond;
  };

  // ⛔ The non-empty fixture fence, imported from `scripts/lint-app-guc.mjs`'s
  // self-test (which `check-version-bump.mjs` lacks). An empty table is not a
  // clean one: every arm below would report zero fixtures and this self-test
  // would have nothing to prove, while still exiting 0.
  if (CASES.length === 0) {
    console.error("=== SELF-TEST FAILED: the fixture table is EMPTY — this self-test would prove nothing ===");
    return 1;
  }
  if (DOCS_ONLY_PREFIXES.length === 0) {
    console.error(
      "=== SELF-TEST FAILED: DOCS_ONLY_PREFIXES is EMPTY — judge() would answer false for every input, " +
        "which passes every negative row below while the allow-list has ceased to exist ===",
    );
    return 1;
  }

  CASES.forEach((c, i) => {
    console.log(`=== SELF-TEST ${i + 1}/${CASES.length}: ${c.claim}`);
    pass = c.run(ok) && pass;
  });

  console.log("");
  if (!pass) {
    console.error("=== SELF-TEST FAILED ===");
    return 1;
  }
  console.log(`=== SELF-TEST PASSED: ${CASES.length}/${CASES.length}, every verdict fired on its own input ===`);
  return 0;
}

function main() {
  if (process.argv.includes("--self-test")) return selfTest();

  if (process.env.GITHUB_EVENT_NAME !== "pull_request") {
    // LOCKED DECISION (CONTEXT.md, trigger scope): the push and dispatch corpus
    // is NEVER filtered. `ci.yml`'s own header records why — every commit to
    // main must produce its own recorded green run (deploy automation keys on
    // per-SHA status), and Railway waits on main CI and SKIPS the
    // analytics-service deploy when it is red. A half-skipped main run is a
    // change to deploy behaviour, which this phase is not allowed to make.
    emit(false, `event is '${process.env.GITHUB_EVENT_NAME ?? "(unset)"}', not pull_request — never filtered`);
    return 0;
  }

  const baseRef = process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "origin/main";
  let changedFiles;
  try {
    // ⚠️ `--no-renames` is MANDATORY, not stylistic. With rename detection a
    // `src/x.ts` → `.planning/x.md` rename prints ONLY the destination, so a
    // deleted code file would classify as docs-only and skip the corpus that
    // would have noticed. `check-version-bump.mjs` carries this same hole today
    // and is deliberately NOT being changed here — a named, routed divergence
    // rather than drift, and a behavioural edit to an always-on gate is out of
    // this phase's scope.
    //
    // The base ref is passed as an argv ELEMENT to execFileSync, never
    // interpolated into a shell string: `GITHUB_BASE_REF` is a branch name and
    // on a fork PR an untrusted contributor chooses it.
    changedFiles = git(["diff", "--name-only", "--no-renames", `${baseRef}...HEAD`])
      .split("\n")
      .filter(Boolean);
  } catch (e) {
    // ⛔ A gate that cannot read cannot report a pass.
    console.error(`MEASURE_FAIL: could not read ${baseRef} — ${e.message}`);
    return 1;
  }

  emit(judge(changedFiles), `${changedFiles.length} changed file(s) against ${baseRef}`);
  return 0;
}

/**
 * Realpath-safe main-module guard — the `[VAC04-C2]` lesson, copied from
 * `scripts/lint-app-guc.mjs`: comparing `import.meta.url` to
 * `file://${process.argv[1]}` no-ops on symlinked or space-bearing paths,
 * silently turning the CLI into a library.
 *
 * ⚠️ A DECLARED DIVERGENCE FROM THE ANALOG, not drift. `check-version-bump.mjs`
 * ends with a bare `process.exit(main());`, and it gets away with it because
 * nothing imports it. This module IS imported — `ci-docs-path-filter.contract.
 * test.ts` calls `judge()` directly, and that import is the end-to-end wiring
 * the contract test exists to prove — so an unguarded `process.exit` here would
 * terminate the vitest worker at import time. Two in-repo idioms exist
 * (`lint-sql-gates.mjs`'s `resolve()` form and `lint-app-guc.mjs`'s realpath
 * form); the realpath one is taken because it is the one that carries a named
 * defect lesson.
 */
function invokedDirectly() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (invokedDirectly()) {
  process.exit(main());
}
