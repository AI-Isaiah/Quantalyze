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
  chmodSync,
  mkdirSync,
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
  WAIVED_CEILING,
  absurdityViolations,
  laneSpawnFailure,
  runCorpus,
  scopeDirForFile,
} from "../../scripts/mutation-runner/run.mjs";
import { parseFile, scanCorpus } from "../../scripts/mutation-runner/parse.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const GATE_DIR = join(REPO_ROOT, "supabase", "tests");
const CI_PATH = join(REPO_ROOT, ".github", "workflows", "ci.yml");
const RUNNER_PATH = join(REPO_ROOT, "scripts", "mutation-runner", "run.mjs");
const SELFTEST_DIR = join(REPO_ROOT, "scripts", "mutation-runner", "fixtures", "selftest");
const LANE_SH = join(REPO_ROOT, "scripts", "pg-lane", "run.sh");

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

describe("WAIVED_CEILING — the waiver count is bounded from ABOVE, in lockstep with the floors", () => {
  // ⛔ THE HOLE (164.3.1 red team). A waiver is a counted twin: it satisfies
  // parity, raises `filesAnnotated`/`armsAnnotated`, never spawns a lane and
  // never lowers `biting`. ARMS_FLOOR catches an EXISTING arm converted to a
  // waiver (biting drops) but not a NEW prose marker paired with a waiver twin
  // — annotated coverage could be inflated across all 70 unannotated files
  // with zero new arms and every floor green. So the count is pinned at its
  // measured value and drift in EITHER direction fails, exactly as
  // FILES_FLOOR / ARMS_FLOOR are pinned above.
  it("is a non-negative integer", () => {
    expect(Number.isInteger(WAIVED_CEILING)).toBe(true);
    expect(WAIVED_CEILING).toBeGreaterThanOrEqual(0);
  });

  it("matches the measured corpus exactly — drift in EITHER direction fails", () => {
    // Re-derived with this file's own regex, NOT read back from run.mjs.
    const waivers = rederive().perFile.reduce((n, f) => n + f.waivers, 0);
    expect(
      WAIVED_CEILING,
      waivers > WAIVED_CEILING
        ? `WAIVER CREEP: the corpus declares ${waivers} waiver(s), above the pinned ceiling of ${WAIVED_CEILING}. Each waiver is an arm the runner will never prove can fail — raising WAIVED_CEILING in scripts/mutation-runner/run.mjs is a reviewed edit, never a side effect.`
        : `CEILING STALE: the corpus declares ${waivers} waiver(s) but WAIVED_CEILING is ${WAIVED_CEILING}. Lower it to ${waivers} so a re-added waiver is caught.`,
    ).toBe(waivers);
  });

  it("the runner compares armsWaived against it in the gate path, and ci.yml reads the same constant", () => {
    const src = readFileSync(RUNNER_PATH, "utf8");
    expect(src).toMatch(/if \(armsWaived > waivedCeiling\)/);
    expect(src).toContain("WAIVED_CEILING exceeded:");
    const ci = readFileSync(CI_PATH, "utf8");
    expect(ci).toContain("m.FILES_FLOOR, m.ARMS_FLOOR, m.WAIVED_CEILING");
    expect(ci).toContain('if [ "$arms_waived" -gt "$waived_ceiling" ]');
    // No literal restated in the workflow.
    expect(ci).not.toMatch(/waived_ceiling" -(eq|ne|lt|gt) "?[0-9]/);
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

  // 30 s: a real-corpus spawn, matching the sibling spawn tests' budget.
  it("`--parse-only` deliberately does NOT print it — so CI's demand for it also catches a mode swap", { timeout: 30_000 }, () => {
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
    //   baseline / restore / dirty-checkout — each needs a corpus deliberately
    //     broken in a way that would also break the fixture corpus for every
    //     other scenario. NAMED here rather than implied, so the gap is visible
    //     instead of absent.
    //   neuter-missed LEFT this list in 164.3.1-11: the compound-head corpus
    //     entry (fixtures/selftest/compound-head-gate.sql, scenario 9) refuses
    //     a neuter INSIDE its own file — the [R4-C01] `SET ROLE postgres; IF
    //     NOT ok THEN` shape — without touching the corpus every other scenario
    //     shares, so the kind is now exercised through a real lane.
    //   absurdity (164.3.1-10) LEFT this list 2026-09-02: `runCorpus` takes an
    //     injectable lane runner, and scenario 14 drives a stub that never
    //     touches `laneTally` through the REAL verdict loop — executed=N with
    //     lane-invocations=0 by construction — so the FIRE direction is now a
    //     permanent, cluster-free scenario rather than a one-off neuter
    //     recorded in a SUMMARY. `lane-unrunnable` (scenario 15) is exercised
    //     the same way.
    expect(uncovered).toEqual([
      "bad-file-ref",
      "baseline",
      "dirty-checkout",
      "parity",
      "parse",
      "restore",
    ]);
    // The six kinds SP-C02 names as the self-test's whole purpose, plus
    // neuter-missed (164.3.1-11, scenario 9), absurdity (scenario 14) and
    // lane-unrunnable (scenario 15) — see the list above.
    expect([...exercised].sort()).toEqual([
      "absurdity",
      "floor",
      "identity-rewrite",
      "lane-unrunnable",
      "neuter-missed",
      "no-red",
      "occurrence-mismatch",
      "synthesised-identity",
      "wrong-first-failure",
    ]);
  });
});

describe("SP-L02 — the meta-command preflight cannot report 'clean' for a file it could not read", () => {
  // ⛔ Each grep in that step ended `>/dev/null 2>&1`, and the second redirect
  // discards the ERROR channel: grep exits 0 on a hit, 1 on none, and >= 2 when
  // it could not read the file at all — so an unreadable or unstattable file
  // read as CLEAN. The step's own MEASURE_FAIL covered only a zero-length glob.
  //
  // ⭐ These arms EXTRACT AND RUN THE REAL `run:` BLOCK from ci.yml. Copying it
  // into the test would produce a second program that can agree with itself
  // while CI's diverges — the defect class this phase exists for. What runs
  // here is the workflow's own text.

  /** The step's `run:` block, dedented, straight out of ci.yml. */
  function preflightScript(): string {
    const ci = readFileSync(CI_PATH, "utf8");
    const stepAt = ci.indexOf(
      "- name: Preflight - reject psql meta-commands in every file the runner executes",
    );
    expect(stepAt, "the preflight step was renamed or removed").toBeGreaterThan(-1);
    const runAt = ci.indexOf("\n        run: |\n", stepAt);
    expect(runAt, "the preflight step no longer carries a `run: |` block").toBeGreaterThan(-1);
    const body = ci.slice(runAt + "\n        run: |\n".length);
    const out: string[] = [];
    for (const line of body.split("\n")) {
      if (line.trim() !== "" && !line.startsWith("          ")) break;
      out.push(line.slice(10));
    }
    return out.join("\n");
  }

  /** Run it in a throwaway tree carrying the globs it scans. */
  function runPreflight(files: Record<string, string>, lock?: string) {
    const dir = mkdtempSync(join(tmpdir(), "preflight-"));
    try {
      for (const [rel, content] of Object.entries(files)) {
        const abs = join(dir, rel);
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, content);
      }
      const script = join(dir, "preflight.sh");
      writeFileSync(script, preflightScript());
      if (lock) chmodSync(join(dir, lock), 0o000);
      const res = spawnSync("bash", [script], {
        cwd: dir,
        encoding: "utf8",
      });
      if (lock) chmodSync(join(dir, lock), 0o644);
      return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  const CLEAN = "SELECT 1;\nDO $$ BEGIN RAISE NOTICE 'ok'; END $$;\n";

  it("GREEN: a clean corpus passes and says how many files it read", () => {
    const r = runPreflight({ "supabase/tests/test_a.sql": CLEAN });
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("Preflight clean: 1 file(s)");
  });

  it("the detector still FIRES on each refused meta-command — otherwise nothing below is evidence", () => {
    for (const [label, content] of [
      ["\\!", "SELECT 1;\n\\! curl http://x\n"],
      ["\\copy", "SELECT 1;\n\\copy t FROM 'f.csv'\n"],
      ["\\COPY", "SELECT 1;\n\\COPY t FROM 'f.csv'\n"],
      ["\\o", "SELECT 1;\n\\o /tmp/out\n"],
    ] as const) {
      const r = runPreflight({ "supabase/tests/test_a.sql": content });
      expect(r.status, `${label} was not refused: ${r.out}`).toBe(1);
      expect(r.out).toContain(label);
    }
  });

  it("RED: an UNREADABLE file is a MEASURE_FAIL — it must not read as clean", () => {
    const r = runPreflight(
      {
        "supabase/tests/test_a.sql": CLEAN,
        "supabase/tests/test_locked.sql": CLEAN,
      },
      "supabase/tests/test_locked.sql",
    );
    expect(r.status, `a file the preflight could not read was reported clean:\n${r.out}`).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL: grep exited");
    expect(r.out).toContain("has NOT cleared it");
    expect(r.out).not.toContain("Preflight clean:");
  });

  it("the error channel is no longer discarded — no `2>/dev/null` on the scan", () => {
    // The mechanism, pinned directly: the redirect is what made an unreadable
    // file indistinguishable from a clean one.
    const script = preflightScript();
    expect(script.length, "the extracted block is empty — the extractor broke").toBeGreaterThan(400);
    // ⚠️ COMMENTS STRIPPED: the block's own comment QUOTES the redirect it
    // removed, and that prose is worth keeping. The subject is the code.
    const code = script
      .split("\n")
      .filter((l) => !/^\s*#/.test(l))
      .join("\n");
    expect(code, "the comment stripper removed the code as well").toContain("grep -anE");
    expect(code).not.toContain("2>/dev/null");
    expect(code).not.toContain("2>&1");
    expect(code).toContain('elif [ "$rc" -gt 1 ]; then');
  });
});

describe("164.3.1-10 — the runner's absurdity floor (D-09): two INDEPENDENT tallies, cross-checked", () => {
  // ⛔ THE DEFECT. `armsExecuted` was ONE tally incremented in the verdict
  // loop, and nothing compared it to what actually ran. A runner whose lane
  // path was stubbed or skipped would still print `arms: 30/30/0`, `biting:
  // 30`, clear both floors and exit 0 — the parse-only shape, reached INSIDE
  // the process where the CI step's `--parse-only` guard cannot see it. That
  // is VAC-08's 253-of-262 in mirror image: a gate holding every number needed
  // to know its own verdict was absurd, and never comparing them.
  //
  // The numbers below are QUOTED from plan 09's committed re-derivation
  // (164.3.1-09-REDERIVATION.md §2 and §6 — HEAD a305a71a, 2026-09-01: 30 arms
  // executed, biting 30, 1 annotated file of 71). They are not re-measured
  // here, and they are deliberately NOT read back from run.mjs, which is the
  // artifact under test — a pin that reads its expectation off the subject
  // agrees with it by construction.
  const LEGIT = { armsExecuted: 30, laneInvocations: 30, biting: 30 };

  it("the kind exists — a violation must be able to reach the defect table under its own name", () => {
    expect(DEFECT_KINDS).toContain("absurdity");
  });

  // ── SILENT direction ────────────────────────────────────────────────────
  it("SILENT on the measured legitimate shape — the plan-09 numbers, 30/30/30", () => {
    expect(absurdityViolations(LEGIT)).toEqual([]);
  });

  it("SILENT on ordinary partial shapes — fewer biting than executed is a CORPUS finding, not an absurdity", () => {
    // A non-biting arm lowers `biting` and is reported by its own kind
    // (`no-red` etc.) and by ARMS_FLOOR. The absurdity floor must stay out of
    // that lane, or it fires on every honest regression and gets disabled.
    expect(absurdityViolations({ armsExecuted: 30, laneInvocations: 30, biting: 12 })).toEqual([]);
    expect(absurdityViolations({ armsExecuted: 30, laneInvocations: 30, biting: 0 })).toEqual([]);
    // A run that executed nothing and claims nothing is consistent (the
    // executed-is-zero MEASURE_FAIL belongs to the CI step, not to this rule).
    expect(absurdityViolations({ armsExecuted: 0, laneInvocations: 0, biting: 0 })).toEqual([]);
  });

  // ── FIRES direction ─────────────────────────────────────────────────────
  // Each arm asserts the evidence, not just that SOMETHING fired: the message
  // must carry all three numbers in a machine-readable tail and say that it is
  // the GATE failing, not the corpus (SC-7, D-12).
  const evidence = (v: string, e: number, l: number, b: number) => {
    expect(v).toMatch(/GATE failing, not the corpus/);
    expect(v).toMatch(new RegExp(`executed=${e}\\b`));
    expect(v).toMatch(new RegExp(`lane-invocations=${l}\\b`));
    expect(v).toMatch(new RegExp(`biting=${b}\\b`));
  };

  it("FIRES on the parse-only shape — 30 arms CLAIMED executed with ZERO lanes spawned", () => {
    const v = absurdityViolations({ armsExecuted: 30, laneInvocations: 0, biting: 30 });
    expect(v).toHaveLength(1);
    evidence(v[0], 30, 0, 30);
    expect(v[0]).toMatch(/CLAIMED/);
  });

  it("FIRES on a single missing lane too — the rule is exact, not a tolerance", () => {
    const v = absurdityViolations({ armsExecuted: 30, laneInvocations: 29, biting: 30 });
    expect(v).toHaveLength(1);
    evidence(v[0], 30, 29, 30);
  });

  it("FIRES on unaccounted lanes — more arm lanes spawned than the verdict loop counted", () => {
    const v = absurdityViolations({ armsExecuted: 30, laneInvocations: 31, biting: 30 });
    expect(v).toHaveLength(1);
    evidence(v[0], 30, 31, 30);
    expect(v[0]).toMatch(/UNACCOUNTED/);
  });

  it("FIRES on the impossible count — biting above executed", () => {
    const v = absurdityViolations({ armsExecuted: 30, laneInvocations: 30, biting: 31 });
    expect(v).toHaveLength(1);
    evidence(v[0], 30, 30, 31);
  });

  it("FIRES on an UNMEASURABLE input — an absent number is a MEASURE_FAIL, never a silent pass", () => {
    for (const bad of [
      { armsExecuted: Number.NaN, laneInvocations: 30, biting: 30 },
      { armsExecuted: 30, laneInvocations: undefined, biting: 30 },
      { armsExecuted: 30, laneInvocations: 30, biting: -1 },
      { armsExecuted: 30.5, laneInvocations: 30, biting: 30 },
    ]) {
      const v = absurdityViolations(bad as never);
      expect(v.length, JSON.stringify(bad)).toBeGreaterThan(0);
      expect(v[0]).toMatch(/MEASURE_FAIL/);
    }
  });

  // ── INDEPENDENCE — the SP-C05 one-code-path check ───────────────────────
  it("the two tallies live in two code paths: the lane runner counts at the spawn, the verdict loop counts separately", () => {
    // One variable incremented in two places would agree with itself by
    // construction. Pinned on the source, like IN-05 above: the lane tally is
    // incremented INSIDE runLane and nowhere in runCorpus; `armsExecuted` is
    // incremented inside runCorpus and nowhere in runLane.
    const src = readFileSync(RUNNER_PATH, "utf8");
    // Each function is sliced from its own header to its own column-0 closing
    // brace, so prose in a NEIGHBOURING block cannot make this pin red or green.
    const fnBody = (header: string) => {
      const at = src.indexOf(header);
      expect(at, `${header} not found`).toBeGreaterThan(-1);
      const end = src.indexOf("\n}\n", at);
      expect(end, `${header} has no column-0 closing brace`).toBeGreaterThan(at);
      return src.slice(at, end + 2);
    };
    const runLaneBody = fnBody("function runLane(");
    const runCorpusBody = fnBody("export function runCorpus(");

    expect(runLaneBody).toMatch(/laneTally\[leg\] \+= 1/);
    expect(runLaneBody).not.toMatch(/armsExecuted/);
    expect(runCorpusBody).toMatch(/armsExecuted \+= 1/);
    expect(runCorpusBody).not.toMatch(/laneTally(\[[^\]]*\]|\.\w+)\s*(\+=|=|\+\+|--)/);
  });

  // ── FIRE direction THROUGH THE WIRING — an injected lane runner ────────
  /** A lane runner that "succeeds" without ever spawning: `laneTally` is untouched. */
  const severedLane = () => ({ status: 0, output: "", seconds: 0, measureFail: null, invoked: true });

  it("FIRES through runCorpus's real verdict loop: a lane runner that never spawns → exit 1 with `absurdity` naming executed=N lane-invocations=0", () => {
    // Until 2026-09-02 this direction was pinned only by a one-off byte-backed
    // neuter of `laneTally[leg] += 1` recorded in 164.3.1-10-SUMMARY.md. The
    // stub above reaches the same severed shape through the injectable
    // `laneRunner`, so the loop → addDefect("absurdity") → exitCode 1 wiring
    // is driven on every vitest run, with no cluster.
    const r = runCorpus({
      scopeDir: SELFTEST_DIR,
      onlyFile: "nonbiting-gate.sql",
      armsFloor: 0,
      laneRunner: severedLane,
      log: () => {},
    });
    expect(r.armsExecuted, "the stub must have been driven for at least one arm").toBeGreaterThanOrEqual(1);
    expect(r.laneInvocations).toBe(0);
    expect(r.exitCode).toBe(1);
    const absurd = r.defects.filter((d: { kind: string }) => d.kind === "absurdity");
    expect(absurd).toHaveLength(1);
    evidence(absurd[0].detail, r.armsExecuted, 0, r.bitingArms);
    expect(absurd[0].detail).toMatch(/CLAIMED/);
  });

  // ── `lane-unrunnable` — the lane the runner could not RUN ───────────────
  it("laneSpawnFailure classifies ENOENT / ENOBUFS / a signal / a missing status as 'lane could not run', and a real exit status as null", () => {
    expect(laneSpawnFailure({ error: { code: "ENOENT" }, status: null, signal: null })).toBe("lane could not run: ENOENT");
    expect(laneSpawnFailure({ error: { code: "ENOBUFS" }, status: null, signal: null })).toBe("lane could not run: ENOBUFS");
    expect(laneSpawnFailure({ status: null, signal: "SIGKILL" })).toBe("lane could not run: SIGKILL");
    expect(laneSpawnFailure({ status: null, signal: null })).toMatch(/^lane could not run: no exit status/);
    // The lane's own exit statuses are NOT spawn failures — 0 is green, 3 is
    // the failing psql's status, both are measurements.
    expect(laneSpawnFailure({ status: 0, signal: null })).toBeNull();
    expect(laneSpawnFailure({ status: 3, signal: null })).toBeNull();
  });

  it("through the wiring: an arm lane that never STARTED (ENOENT) is a `lane-unrunnable` MEASURE_FAIL — not wrong-first-failure, not executed, not biting", () => {
    // Pre-fix `status: null` fell through `!== 0`, the empty output carried
    // no identity, and the arm was reported as `wrong-first-failure` — an
    // instrument failure wearing a corpus defect's name.
    const dead = ({ leg }: { leg: string }) =>
      leg === "arm"
        ? { status: null, output: "", seconds: 0, measureFail: "lane could not run: ENOENT", invoked: false }
        : { status: 0, output: "", seconds: 0, measureFail: null, invoked: true };
    const r = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "nonbiting-gate.sql", armsFloor: 0, laneRunner: dead, log: () => {} });
    expect(r.exitCode).toBe(1);
    const mine = r.defects.filter((d: { kind: string; arm: string | null }) => d.kind === "lane-unrunnable" && d.arm === "NONBITE 1");
    expect(mine).toHaveLength(1);
    expect(mine[0].detail).toContain("lane could not run: ENOENT");
    expect(mine[0].detail).toContain("this arm was NOT judged");
    expect(r.defects.map((d: { kind: string }) => d.kind)).not.toContain("wrong-first-failure");
    expect(r.defects.map((d: { kind: string }) => d.kind)).not.toContain("no-red");
    // A spawn that never happened is counted by NEITHER tally, so the two
    // still agree and no absurdity is reported for it.
    expect(r.armsExecuted).toBe(0);
    expect(r.laneInvocations).toBe(0);
    expect(r.bitingArms).toBe(0);
    expect(r.defects.map((d: { kind: string }) => d.kind)).not.toContain("absurdity");
  });

  it("through the wiring: an arm lane that STARTED and was signalled counts as executed but never as biting", () => {
    const killed = ({ leg }: { leg: string }) =>
      leg === "arm"
        ? { status: null, output: "", seconds: 0, measureFail: "lane could not run: SIGKILL", invoked: true }
        : { status: 0, output: "", seconds: 0, measureFail: null, invoked: true };
    const r = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "nonbiting-gate.sql", armsFloor: 0, laneRunner: killed, log: () => {} });
    expect(r.exitCode).toBe(1);
    expect(r.defects.some((d: { kind: string }) => d.kind === "lane-unrunnable")).toBe(true);
    expect(r.armsExecuted).toBe(1);
    // biting = executed − unjudged: an arm nobody judged cannot be biting.
    expect(r.bitingArms).toBe(0);
    // (The stub never touches `laneTally`, so the severed-tally absurdity
    // also fires here — that is the stub's shape, not this arm's subject.)
  });

  // ── PRINT CONTRACT — the wiring that prints, not a string constant ──────
  it("the runner PRINTS the lane tally beside coverage/arms/biting — driven through runCorpus's real summary block", () => {
    // A narrowed run whose --file matches no gate in the selftest corpus: no
    // lane is spawned, so no cluster is needed here, and the REAL summary
    // block still runs and prints. What this pins is the wiring — the line
    // exists, in the runner's own format, in its place beside the three lines
    // the CI count-recheck step already parses. A NON-ZERO count through real
    // lanes is asserted by `--self-test` scenario 6 (2 arms, 2 lanes), which
    // the sql-mutation job runs with a cluster.
    const lines: string[] = [];
    const r = runCorpus({
      scopeDir: SELFTEST_DIR,
      onlyFile: "no-such-gate.sql",
      onlyArm: null,
      filesFloor: FILES_FLOOR,
      armsFloor: 0,
      log: (s: string) => {
        lines.push(s);
      },
    });
    const at = (re: RegExp) => lines.findIndex((l) => re.test(l));
    const coverage = at(/^coverage: files \d+\/\d+$/);
    const arms = at(/^arms: \d+\/\d+\/\d+ /);
    const biting = at(/^biting: \d+ /);
    const lane = at(/^lane-invocations: \d+ /);
    expect(coverage, "no coverage line").toBeGreaterThan(-1);
    expect(arms, "no arms line").toBeGreaterThan(coverage);
    expect(biting, "no biting line").toBeGreaterThan(arms);
    expect(lane, `no lane-invocations line; printed:\n${lines.join("\n")}`).toBeGreaterThan(biting);
    // The printed count is the number the cross-check used, exposed on the
    // result exactly as `bitingArms` is for the self-test.
    expect(r.armsExecuted).toBe(0);
    expect(r.laneInvocations).toBe(0);
    expect(lines[lane]).toMatch(/^lane-invocations: 0 /);
    expect(r.defects.some((d: { kind: string }) => d.kind === "absurdity")).toBe(false);
  });
});

describe("164.3.1-10 — CI re-asserts the cross-check out of process (the anti-parse-only pattern, extended)", () => {
  // The runner's in-process floor is half the deliverable. The other half is
  // the sql-mutation job's count-recheck step reading the printed line back
  // and failing on absence or disagreement — otherwise a runner that stopped
  // printing the second tally passes CI quietly, which is the defect class
  // this phase exists for. Both halves are pinned here: the TEXT (so the
  // parse cannot be deleted silently) and the BEHAVIOUR (the step's real
  // `run:` block, extracted from ci.yml and executed — SP-L02's idiom, the
  // same one the preflight pins above use — because a CI-only shell bug is
  // otherwise invisible until the never-yet-observed ubuntu run).
  const CI_TEXT = readFileSync(CI_PATH, "utf8");

  it("ci.yml parses the lane-invocations line with the missing-line MEASURE_FAIL discipline and asserts exact agreement", () => {
    const job = CI_TEXT.slice(
      CI_TEXT.indexOf("\n  sql-mutation:"),
      CI_TEXT.indexOf("\n  plan-anchor-verify:"),
    );
    expect(job.length, "the sql-mutation job slice must be non-empty").toBeGreaterThan(1000);
    expect(job).toContain("^lane-invocations: [0-9]+ ");
    expect(job).toContain("NO 'lane-invocations: N' line");
    expect(job).toContain('if [ "$lane_invocations" -ne "$arms_executed" ]');
    // Evidence, not conclusion (SC-7): the violation names every parsed number.
    expect(job).toContain("executed=$arms_executed lane-invocations=$lane_invocations biting=$biting");
    // The executed-is-zero MEASURE_FAIL and the biting arm both survive — the
    // new assertion sits BESIDE its siblings, it does not replace them.
    expect(job).toContain('if [ "$arms_executed" -eq 0 ]');
    expect(job).toContain('if [ "$biting" -gt "$arms_executed" ]');
    // No literal count restated in the workflow.
    expect(job).not.toMatch(/lane_invocations" -(eq|ne|lt|gt) "?30/);
  });

  /** The count-recheck step's `run:` block, dedented, straight out of ci.yml. */
  function countRecheckScript(): string {
    const stepAt = CI_TEXT.indexOf(
      "- name: Assert the run PRINTED its coverage and cleared both floors",
    );
    expect(stepAt, "the count-recheck step was renamed or removed").toBeGreaterThan(-1);
    const runAt = CI_TEXT.indexOf("\n        run: |\n", stepAt);
    expect(runAt, "the count-recheck step no longer carries a `run: |` block").toBeGreaterThan(-1);
    const body = CI_TEXT.slice(runAt + "\n        run: |\n".length);
    const out: string[] = [];
    for (const line of body.split("\n")) {
      if (line.trim() !== "" && !line.startsWith("          ")) break;
      out.push(line.slice(10));
    }
    return out.join("\n");
  }

  /** Run the extracted block from REPO_ROOT (it imports run.mjs by relative path) against `log`. */
  function runCountRecheck(log: string) {
    const dir = mkdtempSync(join(tmpdir(), "count-recheck-"));
    try {
      const logPath = join(dir, "mutation-runner.log");
      writeFileSync(logPath, log);
      const script = join(dir, "count-recheck.sh");
      writeFileSync(script, countRecheckScript());
      const res = spawnSync("bash", [script], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: { ...process.env, RUNNER_LOG: logPath },
      });
      return { status: res.status, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  // The summary lines in the runner's OWN printed format — the same four
  // shapes the print-contract pin above asserts on real runner output — at the
  // plan-09 numbers. Built once so the RED arms below are one-line mutations
  // of the GREEN input rather than independently-typed fixtures.
  const GREEN_LOG = [
    "mutation-runner: scope supabase/tests",
    "  baseline  supabase/tests/test_strategy_shares_rls.sql — exit 0 (1.8s)",
    "  arm SHAPE 1                  exit   3  RED (identity ok)  (1.7s)",
    "  restore   supabase/tests/test_strategy_shares_rls.sql — exit 0 (1.8s)",
    "",
    "coverage: files 1/71",
    "arms: 30/30/0   (executed/annotated/waived)",
    "biting: 30   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)",
    "lane-invocations: 30   (arm lanes actually spawned — tallied inside runLane, independent of the 30 the verdict loop counted; plus 1 baseline / 1 restore leg(s))",
    "per-arm lane time: mean 1.7s over 30 arm run(s)",
    "",
    "✅ No defects. Every annotated arm bit its own arm first.",
    "",
  ].join("\n");

  it("GREEN: a log whose two tallies agree passes and says so", () => {
    const r = runCountRecheck(GREEN_LOG);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("the runner's two tallies agree");
    expect(r.out).toContain("30 arm lane(s) spawned");
  });

  it("RED: the lane-invocations line ABSENT is a MEASURE_FAIL — the runner stopped reporting, or --parse-only was swapped in", () => {
    const without = GREEN_LOG.replace(/^lane-invocations: .*\n/m, "");
    expect(without, "the deletion must actually change the log").not.toBe(GREEN_LOG);
    const r = runCountRecheck(without);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
    expect(r.out).toContain("NO 'lane-invocations: N' line");
    expect(r.out).not.toContain("two tallies agree");
  });

  it("RED: the parse-only shape — 30 executed claimed, 0 lanes counted — fails naming all three numbers", () => {
    const severed = GREEN_LOG.replace(/^lane-invocations: 30 /m, "lane-invocations: 0 ");
    expect(severed).not.toBe(GREEN_LOG);
    const r = runCountRecheck(severed);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("GATE failing, not the corpus");
    expect(r.out).toContain("executed=30 lane-invocations=0 biting=30");
    expect(r.out).not.toContain("two tallies agree");
  });

  it("RED: a single unaccounted lane also fails — the relation is exact", () => {
    const extra = GREEN_LOG.replace(/^lane-invocations: 30 /m, "lane-invocations: 31 ");
    const r = runCountRecheck(extra);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("executed=30 lane-invocations=31 biting=30");
  });

  it("RED: a NON-NUMERIC lane-invocations count is a MEASURE_FAIL, never parsed as a number", () => {
    const garbled = GREEN_LOG.replace(/^lane-invocations: 30 /m, "lane-invocations: abc ");
    expect(garbled).not.toBe(GREEN_LOG);
    const r = runCountRecheck(garbled);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
    expect(r.out).toContain("NO 'lane-invocations: N' line");
    expect(r.out).not.toContain("two tallies agree");
  });

  it("RED: a waived count above WAIVED_CEILING fails naming both numbers — the W field is read, not ignored", () => {
    // The GREEN log carries `arms: 30/30/0`; one waiver against a ceiling read
    // out of run.mjs (0 today) must fail. The executed and biting counts are
    // untouched, so nothing else in the step can be what fired.
    const waived = GREEN_LOG.replace(/^arms: 30\/30\/0 /m, `arms: 30/30/${WAIVED_CEILING + 1} `);
    expect(waived).not.toBe(GREEN_LOG);
    const r = runCountRecheck(waived);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain(`WAIVED_CEILING exceeded: ${WAIVED_CEILING + 1} waived arm(s) > ceiling ${WAIVED_CEILING}`);
    expect(r.out).not.toContain("two tallies agree");
    // And the ceiling itself is printed beside the floors it was read with.
    expect(r.out).toContain(`WAIVED_CEILING=${WAIVED_CEILING}`);
  });

  it("the siblings still bite in the same extracted block — executed-is-zero and biting-above-executed", () => {
    // Calibration for the extract-and-run harness itself: if the extraction
    // returned an empty or truncated block, these established arms would not
    // fire either, and the GREEN arm above would be passing on nothing.
    const zero = GREEN_LOG.replace(/^arms: 30\/30\/0 /m, "arms: 0/30/0 ");
    const z = runCountRecheck(zero);
    expect(z.status, z.out).toBe(1);
    expect(z.out).toContain("ZERO arms executed");
    const spliced = GREEN_LOG.replace(/^biting: 30 /m, "biting: 31 ");
    const s = runCountRecheck(spliced);
    expect(s.status, s.out).toBe(1);
    expect(s.out).toContain("biting (31) exceeds executed (30)");
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

describe("IN-02 — `--file` scope derivation", () => {
  it("an ABSOLUTE gate path scopes the run to the gate's own directory, exactly as the relative spelling does", () => {
    // MEASURED pre-fix: `join(cwd, "/abs/…")` yields `<cwd>/abs/…`, so the
    // scope was `<cwd>/<REPO_ROOT>/supabase/tests` and `--file` found no gate
    // there — exit 1 with "no line-start RED-UNDER markers", for a gate that
    // carries thirty.
    const rel = "supabase/tests/test_strategy_shares_rls.sql";
    const expected = join(REPO_ROOT, "supabase", "tests");
    expect(scopeDirForFile(rel, REPO_ROOT)).toBe(expected);
    expect(scopeDirForFile(join(REPO_ROOT, rel), REPO_ROOT)).toBe(expected);
    // Independent of where the command is typed from.
    expect(scopeDirForFile(join(REPO_ROOT, rel), join(REPO_ROOT, "scripts"))).toBe(expected);
    expect(scopeDirForFile(join(REPO_ROOT, rel), "/somewhere/unrelated")).toBe(expected);
  });
});

describe("`--file` outside the repo is REFUSED", () => {
  it("throws for an absolute path and for a relative path that escapes REPO_ROOT, and still accepts an inside path", () => {
    // `relative(REPO_ROOT, abs)` for an outside path begins with `..`; joined
    // back onto REPO_ROOT that scoped the run to an ARBITRARY directory whose
    // every *.sql the runner would copy and execute.
    expect(() => scopeDirForFile("/etc/passwd", REPO_ROOT)).toThrow(/INSIDE the repo/);
    expect(() => scopeDirForFile("../../outside/gate.sql", REPO_ROOT)).toThrow(/INSIDE the repo/);
    expect(() => scopeDirForFile("gate.sql", "/somewhere/unrelated")).toThrow(/INSIDE the repo/);
    expect(scopeDirForFile("supabase/tests/x.sql", REPO_ROOT)).toBe(join(REPO_ROOT, "supabase", "tests"));
  });
});

describe("scripts/pg-lane/run.sh — the psql invocation the attribution grammar depends on (read-only pin)", () => {
  it("passes `-v VERBOSITY=verbose` on the shared psql wrapper", () => {
    // The runner refuses any ERROR block without a `LOCATION:` sentinel and
    // without the `P0001:` SQLSTATE token, both of which ONLY verbose prints.
    // Drop the flag and every arm MEASURE_FAILs — so the flag is pinned here
    // on the script's bytes. run.sh itself is not edited by this pin.
    const sh = readFileSync(LANE_SH, "utf8");
    const psqlLines = sh.split("\n").filter((l) => /^\s*psqlq\(\)\s*\{/.test(l));
    expect(psqlLines, "the psqlq() wrapper was renamed or removed").toHaveLength(1);
    expect(psqlLines[0]).toContain("-v VERBOSITY=verbose");
    expect(psqlLines[0]).toContain("-v ON_ERROR_STOP=1");
    // Every leg goes through the wrapper, never a bare `psql`.
    const bare = sh.split("\n").filter((l) => /^\s*psql\s/.test(l) && !/^\s*#/.test(l));
    expect(bare).toEqual([]);
  });
});

describe("IN-03 — ONE spelling of the arm-identity grammar", () => {
  it("run.mjs spells the `TEST FAILED (<id>)` regex literal exactly once — every other reader derives from IDENTITY_RE.source", () => {
    // MEASURED pre-fix: FIVE literal spellings (IDENTITY_RE, armIdentities,
    // armIdentitiesInOrder, failureBranches, the baseline reader) in the file
    // whose own header says a list restated in a second place is a second
    // thing to drift. 164.4 widens the identity grammar; it must find ONE.
    const src = readFileSync(RUNNER_PATH, "utf8");
    const literal = "/TEST FAILED \\(([^)]*)\\)/";
    const spellings = src.split(literal).length - 1;
    expect(
      spellings,
      "a second literal spelling of the identity grammar is a second thing to drift — derive it from IDENTITY_RE.source",
    ).toBe(1);
    // Non-vacuity: the one spelling is the exported-by-name definition.
    expect(src).toContain(`const IDENTITY_RE = ${literal}g;`);
  });
});
