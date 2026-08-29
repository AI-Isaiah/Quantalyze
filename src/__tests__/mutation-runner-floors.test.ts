/**
 * Mutation-runner coverage ratchet — contract test (D-01, D-09).
 *
 * WHY THIS FILE EXISTS. `run.mjs` stores its coverage floor as a constant. A
 * constant nobody re-derives is a claim nobody compares to the thing, which is
 * the defect class this whole phase exists for. This test re-derives
 * `files_annotated` and `files_total` from `supabase/tests/` INDEPENDENTLY —
 * its own directory walk, its own line-start regex, deliberately not importing
 * the parser it is checking — and fails on drift in EITHER direction:
 *
 *   - annotated < FILES_FLOOR  → a real regression; someone deleted annotations
 *   - annotated > FILES_FLOOR  → the ratchet is stale and must be raised
 *
 * This is the floor-plus-contract-test storage pattern already used in this
 * repo by `src/__tests__/contracts/ci-anti-skip-gate.contract.test.ts` against
 * ci.yml's SENTINEL_FLOOR / ARMS_FLOOR.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ARMS_FLOOR,
  DEFECT_KINDS,
  FILES_FLOOR,
} from "../../scripts/mutation-runner/run.mjs";
import { parseFile, scanCorpus } from "../../scripts/mutation-runner/parse.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE_DIR = join(REPO_ROOT, "supabase", "tests");
const CI_PATH = join(REPO_ROOT, ".github", "workflows", "ci.yml");
const RUNNER_PATH = join(REPO_ROOT, "scripts", "mutation-runner", "run.mjs");

/**
 * Independent re-derivation. These regexes are written out again on purpose —
 * importing the parser's own constants would make this test agree with the
 * parser by construction and prove nothing about the corpus.
 */
const PROSE = /^[ \t]*--[ \t]*RED-UNDER:/;
const TWIN = /^[ \t]*--[ \t]*RED-UNDER-M:/;
// A waiver is a twin declaring no executable mutation. Matched textually here,
// deliberately, rather than by JSON.parse through the parser under test.
const WAIVER = /^[ \t]*--[ \t]*RED-UNDER-M:.*"waiver"[ \t]*:/;

function rederive(dir: string = GATE_DIR) {
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const perFile = files.map((name) => {
    // node:fs, never shell grep — grep is silently NUL-blind in this repo.
    const lines = readFileSync(join(dir, name), "utf8").split("\n");
    return {
      name,
      prose: lines.filter((l) => PROSE.test(l)).length,
      twins: lines.filter((l) => TWIN.test(l)).length,
      waivers: lines.filter((l) => WAIVER.test(l)).length,
    };
  });
  return {
    filesTotal: files.length,
    // ⛔ SP-I04. This read `f.prose > 0`, while `scanCorpus` counts a file as
    // annotated on prose OR a structured twin (deliberately — IN-01). The two
    // agree TODAY only because the single annotated file happens to carry both.
    // The moment 164.4 backfills a structured-only file they diverge, and
    // `FILES_FLOOR` and the runner's coverage numerator would bound DIFFERENT
    // QUANTITIES — the ARMS_FLOOR/IN-05 defect, one file over. It would fail
    // loudly, but on the ratchet rather than on the corpus, sending the reader
    // to the wrong place. Same predicate, same quantity.
    annotated: perFile.filter((f) => f.prose > 0 || f.twins > 0),
    perFile,
  };
}

describe("corpus re-derivation", () => {
  it("finds a non-empty corpus — otherwise every assertion below would be vacuous", () => {
    const { filesTotal, annotated } = rederive();
    expect(filesTotal).toBeGreaterThan(0);
    expect(annotated.length).toBeGreaterThan(0);
  });

  it("agrees with the parser's own scanCorpus, computed two different ways", () => {
    const mine = rederive();
    const theirs = scanCorpus(GATE_DIR);

    expect(theirs.filesTotal).toBe(mine.filesTotal);
    expect(theirs.filesAnnotated).toBe(mine.annotated.length);
    expect(theirs.annotatedFiles).toEqual(mine.annotated.map((f) => f.name));
  });

  it("SP-I04: the two predicates agree on a STRUCTURED-ONLY file — driven, because the real corpus cannot show it", () => {
    // ⛔ WHY A SYNTHETIC CORPUS. The real corpus has exactly one annotated file
    // and it carries BOTH marker kinds, so `prose > 0` and `prose > 0 || twins
    // > 0` are indistinguishable on it — the arm above would pass either way.
    // The divergence appears the moment 164.4 backfills a structured-only file,
    // which is precisely when nobody will be looking. So the input is built
    // here rather than waited for.
    const dir = mkdtempSync(join(tmpdir(), "floors-corpus-"));
    try {
      const setup = `-- RED-UNDER-SETUP: {"apply":["supabase/tests/test_strategy_shares_rls.sql"]}`;
      const twin = (arm: string) =>
        `  -- RED-UNDER-M: {"arm":"${arm}","waiver":"no first-failure mutation exists"}`;
      writeFileSync(join(dir, "a-both.sql"), [setup, "  -- RED-UNDER: prose", twin("A")].join("\n"));
      // The file the old predicate could not see.
      writeFileSync(join(dir, "b-twin-only.sql"), [setup, twin("B")].join("\n"));
      writeFileSync(join(dir, "c-neither.sql"), "SELECT 1;\n");

      const mine = rederive(dir);
      const theirs = scanCorpus(dir);

      // Calibration: the file really is structured-only, or this proves nothing.
      const twinOnly = mine.perFile.find((f) => f.name === "b-twin-only.sql");
      expect(twinOnly).toBeDefined();
      expect(twinOnly?.prose).toBe(0);
      expect(twinOnly?.twins).toBeGreaterThan(0);

      // The OLD predicate, applied here so the divergence is shown rather than
      // asserted: it drops the structured-only file, the parser's does not.
      const underOldPredicate = mine.perFile.filter((f) => f.prose > 0).map((f) => f.name);
      expect(underOldPredicate).toEqual(["a-both.sql"]);
      expect(theirs.annotatedFiles).toEqual(["a-both.sql", "b-twin-only.sql"]);

      // And the repaired one agrees with the parser, which is the property.
      expect(mine.annotated.map((f) => f.name)).toEqual(theirs.annotatedFiles);
      expect(theirs.filesAnnotated).toBe(mine.annotated.length);
      expect(mine.filesTotal).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("counts markers at line start only — the PARSER's count is STRICTLY below a naive substring count", () => {
    // ⛔ SP-C03. This arm used to read `expect(naive).toBeGreaterThanOrEqual(
    // file.prose)`, which CANNOT FAIL for any input: `naive` counts every
    // `RED-UNDER` substring, `file.prose` counts line-anchored marker lines,
    // each such line contains at least one substring, and the lines are
    // disjoint. Its title said "strictly larger" while it asserted `>=`, and
    // — worse — NEITHER quantity came from the implementation, so it could not
    // detect the failure its own comment describes.
    //
    // Both defects are closed by making the subject `parseFile`, the thing that
    // actually produces the runner's numerator. If it ever stopped anchoring,
    // its count would climb toward the naive one and `>` would red.
    const { annotated } = rederive();
    expect(annotated.length, "no annotated file — every assertion below would be vacuous").toBeGreaterThan(0);
    for (const file of annotated) {
      const path = join(GATE_DIR, file.name);
      const naive = readFileSync(path, "utf8").split("RED-UNDER").length - 1;
      const parsed = parseFile(path).prose.length;
      // The parser and this file's INDEPENDENT re-derivation must agree; they
      // are two different regexes over the same bytes.
      expect(
        parsed,
        `${file.name}: the parser counts ${parsed} prose marker(s), this test's independent scan counts ${file.prose}`,
      ).toBe(file.prose);
      // ⭐ STRICTLY. The corpus header documents the syntax, and every
      // structured twin line also carries the `RED-UNDER` substring, so an
      // anchored count is necessarily below an unanchored one wherever a twin
      // exists — which the parity gate guarantees for every annotated file.
      // MEASURED 2026-08-29 on the real corpus: 30 anchored, 66 naive.
      expect(
        naive,
        `${file.name}: the naive substring count (${naive}) is not STRICTLY above the parser's anchored count (${parsed}). Either the parser stopped anchoring, or this file no longer carries the inflated shapes the anchor exists to exclude.`,
      ).toBeGreaterThan(parsed);
    }
    const totalAnchored = annotated.reduce((n, f) => n + f.prose, 0);
    expect(totalAnchored).toBe(30);
  });
});

describe("FILES_FLOOR ratchet", () => {
  it("matches the measured corpus exactly — drift in EITHER direction fails", () => {
    const { annotated, filesTotal } = rederive();
    expect(
      annotated.length,
      annotated.length < FILES_FLOOR
        ? `REGRESSION: ${annotated.length} of ${filesTotal} gate files are annotated, below the pinned floor of ${FILES_FLOOR}. Annotations were removed.`
        : `RATCHET STALE: ${annotated.length} of ${filesTotal} gate files are now annotated but FILES_FLOOR is still ${FILES_FLOOR}. Raise FILES_FLOOR in scripts/mutation-runner/run.mjs to ${annotated.length}.`,
    ).toBe(FILES_FLOOR);
  });

  it("is a positive integer — a floor of 0 could never fire", () => {
    expect(Number.isInteger(FILES_FLOOR)).toBe(true);
    expect(FILES_FLOOR).toBeGreaterThan(0);
  });
});

describe("ARMS_FLOOR ratchet", () => {
  it("exists as a named constant and is a non-negative integer", () => {
    // Guards against silent deletion.
    expect(Number.isInteger(ARMS_FLOOR)).toBe(true);
    expect(ARMS_FLOOR).toBeGreaterThanOrEqual(0);
  });

  it("never demands more biting arms than the corpus actually declares", () => {
    const totalTwins = rederive().perFile.reduce((n, f) => n + f.twins, 0);
    expect(ARMS_FLOOR).toBeLessThanOrEqual(totalTwins);
  });

  it("is PINNED now that the corpus carries twins — a floor of 0 cannot fire", () => {
    // ⚠️ THIS IS THE ASSERTION THAT CLOSED WINDOWS.md ENTRY 27. Plan 05 shipped
    // ARMS_FLOOR = 0 knowing it could not fire, and wrote this expectation to
    // flip the instant twins appeared. Plan 164.3-08 measured the first green
    // full-corpus run (30/30/0, exit 0, 2026-08-29) and pinned it at 30.
    // A floor invented before that measurement would have been the
    // fabricated-baseline defect; one left at 0 afterwards is a dead control.
    const totalTwins = rederive().perFile.reduce((n, f) => n + f.twins, 0);
    if (totalTwins === 0) {
      expect(ARMS_FLOOR).toBe(0);
    } else {
      expect(
        ARMS_FLOOR,
        `The corpus declares ${totalTwins} RED-UNDER-M twin(s). ARMS_FLOOR must be pinned from a measured full-corpus run (plan 164.3-08), not left at 0.`,
      ).toBeGreaterThan(0);
    }
  });

  it("equals the number of NON-WAIVED twins — the biting count the run measured", () => {
    // ⛔ THE RATCHET'S OTHER DIRECTION, and it is what makes waiver creep
    // visible (T-164.3-21). `biting` in run.mjs is executed-minus-defects, and
    // on a green run every non-waived twin executes and bites — so the floor
    // and the non-waived twin count are the same number by construction.
    // If they drift apart, either an arm was converted to a waiver (the floor
    // must come down, deliberately and in review) or twins were added (the
    // ratchet is stale and must be raised). Both are edits somebody makes on
    // purpose; neither may happen silently.
    //
    // Re-derived here from the corpus with this file's own regexes — NOT read
    // back from run.mjs, which is the artifact under test.
    const perFile = rederive().perFile;
    const twins = perFile.reduce((n, f) => n + f.twins, 0);
    const waivers = perFile.reduce((n, f) => n + f.waivers, 0);
    if (twins === 0) return;
    expect(
      ARMS_FLOOR,
      `The corpus declares ${twins} twin(s) of which ${waivers} are waivers, so a green run bites ${twins - waivers}. ARMS_FLOOR is ${ARMS_FLOOR}. Update the floor in scripts/mutation-runner/run.mjs from a MEASURED run, never from this number.`,
    ).toBe(twins - waivers);
  });
});

describe("IN-05 — CI's floor and the runner's floor bound the SAME quantity", () => {
  // `run.mjs` compares ARMS_FLOOR to `biting` = executed minus (no-red +
  // wrong-first-failure). The ci.yml assertion parsed `arms: E/A/W` and
  // compared raw E to the same constant, then reported an "ARMS_FLOOR
  // regression" naming a quantity the constant was never measured against. On
  // a run with any non-biting arm the two disagree. Two meanings under one
  // name is how a floor decays into a number nobody compares.
  const RUNNER = "scripts/mutation-runner/run.mjs";
  const CI = ".github/workflows/ci.yml";

  it("the runner prints a distinct `biting:` line on a real run", () => {
    // Asserted on the source rather than by running the lane (which needs
    // PostgreSQL): the print must exist in the gate path, and it must be the
    // same variable the floor comparison uses.
    const src = readFileSync(RUNNER, "utf8");
    expect(src).toMatch(/log\(`biting: \$\{bitingArms\}/);
    expect(src).toMatch(/if \(bitingArms < armsFloor\)/);
    // And the floor must NOT be compared against raw executed any more.
    expect(src).not.toMatch(/if \(armsExecuted < armsFloor\)/);
  });

  it("`--parse-only` deliberately does NOT print it — so CI's demand for it also catches a mode swap", () => {
    const res = spawnSync("node", [RUNNER, "--parse-only"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const out = `${res.stdout ?? ""}${res.stderr ?? ""}`;
    expect(res.status).toBe(0);
    expect(out).toMatch(/^arms: 0\//m);
    expect(out).not.toMatch(/^biting: /m);
  });

  it("ci.yml reads the `biting:` line and no longer compares ARMS_FLOOR to executed", () => {
    const ci = readFileSync(CI, "utf8");
    expect(ci).toContain("^biting: [0-9]+ ");
    expect(ci).toContain("ARMS_FLOOR regression: $biting biting arm(s)");
    expect(
      ci,
      "ci.yml still compares raw executed arms to ARMS_FLOOR — the quantity the constant was not measured against.",
    ).not.toContain('if [ "$arms_executed" -lt "$arms_floor" ]');
    // The executed-is-zero MEASURE_FAIL must survive: it is the arm that
    // catches a --parse-only swap.
    expect(ci).toContain('if [ "$arms_executed" -eq 0 ]');
  });
});

describe("SP-C02 — the runner's `--self-test` is WIRED into CI, before the corpus run, unwrapped", () => {
  // ⛔ THE DEFECT. `node scripts/mutation-runner/run.mjs --self-test` was
  // invoked by NOTHING (verified by repo-wide grep), while both sibling jobs
  // run theirs. It is the SOLE proof that the runner's defect kinds can still
  // fire: the full-corpus run CI does execute is GREEN BY CONSTRUCTION at
  // 30/30, so a runner whose defect reporting was disabled would still print
  // `arms: 30/30/0`, clear both floors and exit 0. Vitest covers `neuterArm`,
  // the floors and the identity helpers — never `runCorpus`'s defect reporting,
  // which needs a cluster. So "0 defects" was a number nothing could
  // contradict.
  const CI_TEXT = readFileSync(CI_PATH, "utf8");

  /**
   * The predicate under test, written over ARBITRARY TEXT so it can be
   * calibrated against a copy of ci.yml with the step removed. A predicate only
   * ever applied to the passing input is not evidence.
   */
  const bareRunLines = (text: string) =>
    text
      .split("\n")
      .map((l) => l.trim())
      .filter(
        (l) => l.startsWith("run:") && l.includes("mutation-runner/run.mjs"),
      );

  it("ci.yml invokes it with the EXACT bare command from the script's own header", () => {
    // Mode identity (164.3-RESEARCH Pitfall 2, and this repo's measured
    // gstack-evidence case where a WRAPPED run reddened a suite a direct run
    // passed). Pinning the bare `run:` line stops a future edit adding `npm
    // run`, `npx`, a `|| true`, or a shell wrapper.
    expect(bareRunLines(CI_TEXT)).toEqual([
      "run: node scripts/mutation-runner/run.mjs --self-test",
    ]);
    // It must be the command the script documents, not a variant invented here.
    const header = readFileSync(RUNNER_PATH, "utf8").slice(0, 4000);
    expect(header).toContain("node scripts/mutation-runner/run.mjs --self-test");
  });

  it("CALIBRATION: the same predicate reports the step ABSENT when it is removed", () => {
    // Without this arm, the assertion above could be satisfied by a predicate
    // that matches anything — the shape SP-C01 found one describe block away.
    const without = CI_TEXT.replace(
      "        run: node scripts/mutation-runner/run.mjs --self-test\n",
      "",
    );
    expect(without, "the deletion must actually change the text").not.toBe(CI_TEXT);
    expect(bareRunLines(without)).toEqual([]);
  });

  it("the self-test step comes BEFORE the corpus run — a clean scan proves nothing from a defanged detector", () => {
    const selfTestAt = CI_TEXT.indexOf(
      "run: node scripts/mutation-runner/run.mjs --self-test",
    );
    const corpusAt = CI_TEXT.indexOf(
      'node scripts/mutation-runner/run.mjs > "$RUNNER_LOG" 2>&1',
    );
    expect(selfTestAt, "the self-test invocation is missing").toBeGreaterThan(-1);
    expect(corpusAt, "the corpus invocation is missing").toBeGreaterThan(-1);
    expect(selfTestAt).toBeLessThan(corpusAt);
    // Both live in the SAME job. A self-test wired into some other job would
    // satisfy the ordering above while proving nothing about `sql-mutation`.
    const job = CI_TEXT.slice(
      CI_TEXT.indexOf("\n  sql-mutation:"),
      CI_TEXT.indexOf("\n  plan-anchor-verify:"),
    );
    expect(job.length, "the sql-mutation job slice must be non-empty").toBeGreaterThan(1000);
    expect(job).toContain("run: node scripts/mutation-runner/run.mjs --self-test");
    expect(job).toContain('node scripts/mutation-runner/run.mjs > "$RUNNER_LOG" 2>&1');
    // Nothing in the job may soften a failure into a pass.
    expect(job).not.toContain("continue-on-error");
    expect(job).not.toContain("run.mjs --self-test || true");
  });

  it("every defect kind is either exercised by the self-test or on the reviewed not-covered list — ranged over the runner's OWN list", () => {
    // The two sets are derived, never restated: DEFECT_KINDS is exported by
    // run.mjs, and the exercised set is read out of selfTest()'s source. A new
    // kind added without a scenario fails here BY NAME.
    const src = readFileSync(RUNNER_PATH, "utf8");
    const selfTestBody = src.slice(src.indexOf("function selfTest()"));
    expect(selfTestBody.length, "selfTest() must be findable in the source").toBeGreaterThan(1000);
    const exercised = new Set(
      [...selfTestBody.matchAll(/kind === "([a-z-]+)"/g)].map((m) => m[1]),
    );
    expect(DEFECT_KINDS.length, "an empty kind list would make this arm vacuous").toBeGreaterThan(5);
    expect(exercised.size, "the self-test must assert on at least one kind").toBeGreaterThan(0);
    // Every kind the self-test names must be a real kind — a typo here would
    // silently make a scenario assert on something that can never be reported.
    for (const k of exercised) expect(DEFECT_KINDS).toContain(k);

    const uncovered = DEFECT_KINDS.filter((k: string) => !exercised.has(k)).sort();
    // ⚠️ EXACT SET, so this list cannot grow silently. Each entry is a kind the
    // self-test does not construct, and each has a reason:
    //   parse / parity / bad-file-ref — static, and covered by --parse-only and
    //     by the parser's own vitest file;
    //   neuter-missed / baseline / restore / dirty-checkout — each needs a
    //     corpus deliberately broken in a way that would also break the fixture
    //     corpus for every other scenario. NAMED here rather than implied, so
    //     the gap is visible instead of absent.
    expect(uncovered).toEqual([
      "bad-file-ref",
      "baseline",
      "dirty-checkout",
      "neuter-missed",
      "parity",
      "parse",
      "restore",
    ]);
    // The six kinds SP-C02 names as the self-test's whole purpose.
    expect([...exercised].sort()).toEqual([
      "floor",
      "identity-rewrite",
      "no-red",
      "occurrence-mismatch",
      "synthesised-identity",
      "wrong-first-failure",
    ]);
  });
});

describe("parity invariant", () => {
  it("any file carrying structured twins must have one per prose marker", () => {
    // Bites the moment plan 164.3-08 starts annotating: a partial backfill that
    // annotates the easy arms and leaves the hard ones prose-only fails here.
    for (const file of rederive().perFile) {
      if (file.twins === 0) continue;
      expect(
        file.twins,
        `${file.name}: ${file.prose} prose RED-UNDER marker(s) but ${file.twins} RED-UNDER-M twin(s). Every prose claim needs an executable twin (a waiver counts).`,
      ).toBe(file.prose);
    }
  });
});
