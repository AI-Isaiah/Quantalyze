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
  gateSectionCount,
  laneSpawnFailure,
  runCorpus,
  scopeDirForFile,
  sectionOfIdentity,
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

/**
 * A COMMENT-MASKED projection of JavaScript source.
 *
 * ⛔ WHY. Several pins below assert that run.mjs CALLS something. A `readFileSync`
 * match sees comments too, so a pin written over raw source is satisfied by
 * prose — the extractor-reads-comments class this very phase fixed in the
 * defect-kind scan one describe block away. MEASURED 2026-09-02 at HEAD: run.mjs
 * carries comment lines naming `perFile`, `fileRows`, `perFileRows` and
 * `logPerFileRows`; none happened to match the call-site shapes, so the pins
 * were sound and one comment edit away from unfalsifiable.
 *
 * Every `//` line comment and `/* … *\/` block becomes spaces (line structure
 * preserved); string, template and regex literals are copied through, so a
 * `//` inside `"https://…"` or inside `/^\s*\/\//` does not swallow the rest of
 * the line. The `prev`-character rule is the standard regex-vs-divide
 * heuristic: a `/` opens a literal only after an operator or an opening
 * bracket.
 */
export function maskJsComments(src: string): string {
  const out: string[] = [];
  let i = 0;
  let prev = "";
  const copyDelimited = (close: (c: string) => boolean) => {
    while (i < src.length) {
      const ch = src[i];
      if (ch === "\\") {
        out.push(ch);
        i++;
        if (i < src.length) {
          out.push(src[i]);
          i++;
        }
        continue;
      }
      out.push(ch);
      i++;
      if (close(ch)) return;
    }
  };
  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < src.length && src[i] !== "\n") {
        out.push(" ");
        i++;
      }
      continue;
    }
    if (c === "/" && d === "*") {
      out.push("  ");
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) {
        out.push(src[i] === "\n" ? "\n" : " ");
        i++;
      }
      out.push("  ");
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out.push(c);
      i++;
      copyDelimited((ch) => ch === c);
      prev = c;
      continue;
    }
    if (c === "/" && (prev === "" || /[(,=:[!&|?{};+\-*%~^<>]/.test(prev))) {
      out.push(c);
      i++;
      let inClass = false;
      copyDelimited((ch) => {
        if (ch === "[") inClass = true;
        else if (ch === "]") inClass = false;
        return ch === "/" && !inClass;
      });
      prev = "/";
      continue;
    }
    out.push(c);
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return out.join("");
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
      // RE-MEASURED 2026-09-03 (plan 164.4-02, the reference file's 15
      // un-twinned sections closed): 45 anchored, 96 naive.
      // RE-MEASURED 2026-09-03 (plan 164.4-04, the ledger_refresh family's
      // 15 + 15 + 11 sections annotated — the phase's first FILE move):
      // 86 anchored, 187 naive, across FOUR annotated files.
      // RE-MEASURED 2026-09-03 (plan 164.4-05, the tenant-isolation batch's
      // 11 + 10 + 9 + 9 + 9 sections annotated — the second FILE move):
      // 134 anchored, across NINE annotated files.
      // RE-MEASURED 2026-09-03 (plan 164.4-06, the private-by-default /
      // venue-identity / capital-ownership-column / per-key-dailies batch's
      // 8 + 7 + 7 + 7 sections annotated — the third FILE move):
      // 163 anchored, across THIRTEEN annotated files.
      // RE-MEASURED 2026-09-03 (plan 164.4-07, the csv-finalize-fold /
      // funding-fees / allocator-derived-equity / user-notes batch's
      // 7 + 7 + 6 + 6 sections annotated — the fourth FILE move):
      // 189 anchored, across SEVENTEEN annotated files.
      // RE-MEASURED 2026-09-04 (plan 164.4-08, the csv-double-submit /
      // trust-signals / verified-cohort-rank / downgrade-sweep / scenarios-RLS
      // / series-completeness batch's 5 + 5 + 5 + 5 + 5 + 5 sections — the
      // fifth FILE move): 219 anchored, across TWENTY-THREE annotated files.
      // RE-MEASURED 2026-09-04 (plan 164.4-09, the wizard-session tenant-scope
      // / wizard-composite-fence / weight-snapshot-seed-SECDEF /
      // csv-finalize-auth-guard / resync-retry batch's 5 + 5 + 4 + 3 + 3
      // sections — the sixth FILE move): 239 anchored, across TWENTY-EIGHT
      // annotated files. The batch was REDUCED from the planned six files:
      // test_compute_jobs_error_kind_copy_parity.sql is un-baselineable until
      // the pg-lane can host pg_cron ([REDUNDER-PGCRON]) and stays `pending:`.
      // One of the 30 (trust-signals assertion 5) became anchorable only after
      // the founder-decided REORDER that put the anon-EXECUTE precondition
      // ahead of the assertions that depend on it — see [REDUNDER-WAIVER-01].
      // RE-MEASURED 2026-09-04 (plan 164.4-10, the allocator-equity-pre-terminus
      // / enqueue-dedupe / metrics-by-basis / set-compute-job-progress batch's
      // 2 + 2 + 2 + 2 sections — the seventh FILE move): 247 anchored, across
      // THIRTY-TWO annotated files. These are the last non-mixed idiom files;
      // the 8 still `pending:` are the 7 mixed ones plan 11 takes plus
      // test_compute_jobs_error_kind_copy_parity.sql, still deferred to
      // Phase 164.4.1 PGCRON-LANE.
      expect(
        naive,
        `${file.name}: the naive substring count (${naive}) is not STRICTLY above the parser's anchored count (${parsed}). Either the parser stopped anchoring, or this file no longer carries the inflated shapes the anchor exists to exclude.`,
      ).toBeGreaterThan(parsed);
    }
    const totalAnchored = annotated.reduce((n, f) => n + f.prose, 0);
    expect(totalAnchored).toBe(247);
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
    // 164.4-01: the classification is printed in BOTH modes, so the static mode
    // and the gate say the same thing about the same corpus. This is the arm
    // that runs the REAL runner — the GREEN_LOG fixture below is synthetic, and
    // a fixture alone would not notice the runner dropping the line.
    const printed = out.match(/^unreachable: (\d+) file\(s\) .*$/m);
    expect(printed, "`--parse-only` must print the `unreachable:` line too").not.toBeNull();
    const named = (printed?.[0].match(/[A-Za-z0-9_]+\.sql/g) ?? []).length;
    expect(named, "the line must NAME every file it counts").toBe(Number(printed?.[1]));
    expect(out).toMatch(/^ {2}pending: \d+ idiom file\(s\) without RED-UNDER — /m);

    // 164.4-01: the PER-FILE ROW, on REAL runner output. Until 2026-09-02 that
    // row was asserted only against the synthetic GREEN_LOG below, so a wording
    // change in `logPerFileRows` stayed green in vitest and surfaced only as a
    // CI MEASURE_FAIL from the count-recheck step. The regex is the shape
    // ci.yml greps, re-spelled here deliberately (the two readers must agree
    // about the same bytes without one being derived from the other).
    const ROW_RE =
      /^ {2}file .+: sections \d+ \/ judged \d+ \/ annotated \d+ \/ waived \d+ \/ biting \d+$/gm;
    const rows = out.match(ROW_RE) ?? [];
    expect(
      rows.length,
      `\`--parse-only\` must print the per-file row ci.yml greps; printed:\n${out}`,
    ).toBeGreaterThan(0);
    // The same cross-check ci.yml makes: one row per counted annotated file.
    const cov = out.match(/^coverage: files (\d+)\/\d+$/m);
    expect(cov, "`--parse-only` must print the coverage line").not.toBeNull();
    expect(
      rows.length,
      "one row per annotated file — a file counted as coverage but not described (or the reverse)",
    ).toBe(Number(cov?.[1]));
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
    //   parity / bad-file-ref — static, and covered by --parse-only and
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
    //   parse LEFT this list in 164.4-01: scenario 16 drives
    //     fixtures/selftest/fixture-target-gate.sql, whose twin targets a
    //     pg-lane stand-in, and asserts the `parse` defect naming the stand-in.
    //     ⚠️ That scenario's NEGATIVE assertion about the apply-list kind is
    //     deliberately spelled through the kind LIST rather than an equality,
    //     because this extractor scans SOURCE — comments included — and would
    //     read the absence-assertion as coverage: a kind credited as exercised
    //     by an arm that only proves it did not appear.
    //   lane-blocked-stale (164.4-03) was NEVER on this list: scenario 17
    //     drives the lane-blocked fixture pair with an injected probe leg,
    //     AVAILABLE against absent, and asserts the AVAILABLE arm exits 1 with
    //     the defect naming the still-classified file while the absent arm
    //     exits 0 with none. Same corpus, same stub, one marker apart.
    expect(uncovered).toEqual([
      "bad-file-ref",
      "baseline",
      "dirty-checkout",
      "parity",
      "restore",
    ]);
    // The six kinds SP-C02 names as the self-test's whole purpose, plus
    // neuter-missed (164.3.1-11, scenario 9), absurdity (scenario 14),
    // lane-unrunnable (scenario 15), parse (164.4-01, scenario 16) and
    // lane-blocked-stale (164.4-03, scenario 17) — see the list above.
    expect([...exercised].sort()).toEqual([
      "absurdity",
      "floor",
      "identity-rewrite",
      "lane-blocked-stale",
      "lane-unrunnable",
      "neuter-missed",
      "no-red",
      "occurrence-mismatch",
      "parse",
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

  // ── 164.4-01: the two PER-FILE cross-sums, both directions ──────────────
  // The columns and the aggregate are two derivations over the same run — the
  // aggregate subtracts the non-biting defect kinds globally, each column
  // subtracts the ones naming its own file. A relation that cannot fire is not
  // a floor, so each is proven SILENT on the real shape and FIRING on a drift
  // of exactly one.
  const REF_ROW = { name: "test_strategy_shares_rls.sql", annotated: 30, biting: 30 };

  it("SILENT when the per-file rows sum to the aggregate — the measured 30/30 shape", () => {
    expect(
      absurdityViolations({ ...LEGIT, perFile: [REF_ROW], armsAnnotated: 30 }),
    ).toEqual([]);
    // And absent columns stay a no-op: the three-count callers above are
    // unchanged by this addition.
    expect(absurdityViolations(LEGIT)).toEqual([]);
  });

  it("FIRES when the per-file biting column does not sum to the aggregate", () => {
    const v = absurdityViolations({
      ...LEGIT,
      perFile: [{ ...REF_ROW, biting: 29 }],
      armsAnnotated: 30,
    });
    expect(v).toHaveLength(1);
    evidence(v[0], 30, 30, 30);
    expect(v[0]).toMatch(/sums to 29 biting arm\(s\) but the aggregate reports 30/);
  });

  it("FIRES when the per-file annotated column does not sum to armsAnnotated", () => {
    const v = absurdityViolations({
      ...LEGIT,
      perFile: [{ ...REF_ROW, annotated: 29 }],
      armsAnnotated: 30,
    });
    expect(v).toHaveLength(1);
    evidence(v[0], 30, 30, 30);
    expect(v[0]).toMatch(/sums to 29 annotated twin\(s\) but the aggregate reports 30/);
  });

  it("FIRES on an UNMEASURABLE per-file column — an absent column is not a column of zeroes", () => {
    const v = absurdityViolations({
      ...LEGIT,
      perFile: [{ ...REF_ROW, biting: undefined } as never],
      armsAnnotated: 30,
    });
    expect(v.length).toBeGreaterThan(0);
    expect(v[0]).toMatch(/MEASURE_FAIL/);
    expect(v[0]).toMatch(/not a non-negative integer/);
  });

  it("the runner WIRES the cross-sums in — not merely defines them — in BOTH modes, over a COMMENT-MASKED projection", () => {
    // A helper nothing calls is a control that cannot fire. Pinned on the
    // source, in the shape the independence check below uses — but on the
    // COMMENT-MASKED source, because run.mjs carries prose naming every token
    // below and a pin a comment can satisfy is not a pin.
    const src = readFileSync(RUNNER_PATH, "utf8");
    const code = maskJsComments(src);

    // CALIBRATION (SP-L02: the same predicate, on mutilated input). Without it
    // a masker that silently returned its input would leave every assertion
    // below exactly as weak as the raw-source version it replaced.
    expect(
      maskJsComments("const x = 1; // logPerFileRows(fileRows, log);\n"),
      "a trailing line comment must not survive the mask",
    ).not.toContain("logPerFileRows");
    expect(
      maskJsComments("/**\n * logPerFileRows(fileRows, log);\n */\nlogPerFileRows(fileRows, log);\n"),
      "the block comment must go and the CODE must stay",
    ).toContain("logPerFileRows(fileRows, log);");
    expect(
      maskJsComments('const u = "https://example.test/x"; const v = 1;'),
      "a `//` inside a string literal must not swallow the rest of the line",
    ).toContain("const v = 1;");
    expect(code.length, "the mask ate the file — it must remove comments, not code").toBeGreaterThan(
      src.length / 2,
    );

    /** A function body from the MASKED source, header to its column-0 close. */
    const fnBody = (header: string) => {
      const at = code.indexOf(header);
      expect(at, `${header} not found in the masked source`).toBeGreaterThan(-1);
      const end = code.indexOf("\n}\n", at);
      expect(end, `${header} has no column-0 closing brace`).toBeGreaterThan(at);
      return code.slice(at, end + 2);
    };

    // ── The gate path. ──
    const runCorpusBody = fnBody("export function runCorpus({");
    expect(runCorpusBody).toMatch(/absurdityViolations\(\{[\s\S]{0,200}perFile: fileRows/);
    expect(runCorpusBody).toMatch(/logPerFileRows\(fileRows, log\)/);

    // ── The STATIC path, whose call site is spelled DIFFERENTLY and was
    // therefore covered by nothing: `parseOnlyCorpus` builds its rows inline.
    // `--parse-only` is what CI runs where there is no cluster, and it prints
    // the same per-file row shape the count-recheck step greps, so a wiring
    // deletion there is exactly as invisible as one in the gate path.
    const parseOnlyBody = fnBody("export function parseOnlyCorpus({");
    expect(parseOnlyBody).toMatch(/logPerFileRows\(perFileRows\(perFileTallies, defects\), log\)/);
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
  // 164.4-03: the runner drives a `probe` leg once per lane-spawning run and
  // reads a LANE-PROBE marker off its output. A stub that answers it with an
  // empty string is reported as "the lane was NOT measured" — a MEASURE_FAIL by
  // design, so a stub cannot quietly stop measuring the lane. Every stub below
  // therefore answers the probe leg with what a real absent-pg_cron lane prints,
  // and each arm asserts that no probe MEASURE_FAIL was raised, which is what
  // keeps these three stubs honest rather than merely quiet.
  const PROBE_ABSENT = { status: 0, output: "NOTICE:  LANE-PROBE: pg_cron absent", seconds: 0, measureFail: null, invoked: true };
  const noProbeMeasureFail = (defects: { kind: string; detail: string }[]) =>
    !defects.some((d) => d.kind === "lane-unrunnable" && d.detail.includes("LANE-PROBE"));

  /** A lane runner that "succeeds" without ever spawning: `laneTally` is untouched. */
  const severedLane = ({ leg }: { leg: string }) =>
    leg === "probe" ? PROBE_ABSENT : { status: 0, output: "", seconds: 0, measureFail: null, invoked: true };

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
    expect(noProbeMeasureFail(r.defects), "the stub must have ANSWERED the probe leg").toBe(true);
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
    const dead = ({ leg }: { leg: string }) => {
      if (leg === "arm")
        return { status: null, output: "", seconds: 0, measureFail: "lane could not run: ENOENT", invoked: false };
      if (leg === "probe") return PROBE_ABSENT;
      return { status: 0, output: "", seconds: 0, measureFail: null, invoked: true };
    };
    const r = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "nonbiting-gate.sql", armsFloor: 0, laneRunner: dead, log: () => {} });
    expect(r.exitCode).toBe(1);
    const mine = r.defects.filter((d: { kind: string; arm: string | null }) => d.kind === "lane-unrunnable" && d.arm === "NONBITE 1");
    expect(mine).toHaveLength(1);
    // The ARM's lane is what could not run — not the probe. Without this the
    // arm would still pass with a second, unrelated lane-unrunnable beside it.
    expect(noProbeMeasureFail(r.defects), "the stub must have ANSWERED the probe leg").toBe(true);
    expect(r.defects.filter((d: { kind: string }) => d.kind === "lane-unrunnable")).toHaveLength(1);
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
    const killed = ({ leg }: { leg: string }) => {
      if (leg === "arm")
        return { status: null, output: "", seconds: 0, measureFail: "lane could not run: SIGKILL", invoked: true };
      if (leg === "probe") return PROBE_ABSENT;
      return { status: 0, output: "", seconds: 0, measureFail: null, invoked: true };
    };
    const r = runCorpus({ scopeDir: SELFTEST_DIR, onlyFile: "nonbiting-gate.sql", armsFloor: 0, laneRunner: killed, log: () => {} });
    expect(r.exitCode).toBe(1);
    expect(r.defects.some((d: { kind: string }) => d.kind === "lane-unrunnable")).toBe(true);
    expect(noProbeMeasureFail(r.defects), "the stub must have ANSWERED the probe leg").toBe(true);
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
    "coverage: files 32/71",
    // 164.4-01: the exclusion, named. Two synthetic basenames rather than the
    // real 27 — the arms below mutate the COUNT against the NAMES, and a
    // fixture carrying the live corpus would have to move on every batch.
    "unreachable: 2 file(s) raise outside the runner's identity idiom — a.sql b.sql (TODOS [REDUNDER-NONIDIOM])",
    // 164.4-03: the DEFERRAL, named, and what the lane itself said about the
    // reason. Synthetic basenames for the same reason as the line above — the
    // arms below mutate the COUNT against the NAMES, and a fixture carrying the
    // live four would have to move the day [REDUNDER-PGCRON] is closed.
    "lane-blocked: 2 file(s) probe pg_extension for pg_cron, which the pg-lane cannot host — d.sql e.sql (deferred 2026-09-03, TODOS [REDUNDER-PGCRON])",
    "lane-probe: pg_cron absent — lane-blocked class is current",
    // ⚠️ SYNTHETIC, like the two lines above, and deliberately NOT moved to the
    // live 36. The `pending:` line is the only summary line the count-recheck
    // step does NOT validate (the print-contract pin at :427 asserts its SHAPE
    // against REAL runner output with `\d+`, never a literal), so a fixture
    // claiming 36 while naming one file would be internally inconsistent for
    // no gain — and would have to move on every batch.
    "  pending: 1 idiom file(s) without RED-UNDER — c.sql",
    "arms: 247/247/0   (executed/annotated/waived)",
    "biting: 247   (executed arms that reddened their OWN arm first — the quantity ARMS_FLOOR bounds)",
    "lane-invocations: 247   (arm lanes actually spawned — tallied inside runLane, independent of the 247 the verdict loop counted; plus 32 baseline / 32 restore leg(s))",
    // 164.4-01: the per-file breakdown. These THIRTY-TWO rows are the real,
    // measured shape at plan 164.4-10, which annotated the last four non-mixed
    // idiom files (allocator-equity-pre-terminus / enqueue-dedupe /
    // metrics-by-basis / set-compute-job-progress, 2 sections each): their
    // `biting` column must SUM to the aggregate `biting:` above (6 + 2 + 7 + 10 + 7 + 9 + 7 + 7 + 3 + 5 + 2 + 7 + 5 + 5 + 15 + 15 + 11 + 2 + 3 + 5 + 9 + 5 + 2 + 8 + 5 + 9 + 45 + 5 + 6 + 4 + 5 + 11 =
    // 247) and their COUNT must equal the `coverage:` numerator (32), both of
    // which the count-recheck step asserts.
    "  file test_allocator_equity_derived_rls.sql: sections 6 / judged 6 / annotated 6 / waived 0 / biting 6",
    "  file test_allocator_equity_pre_terminus_flag.sql: sections 2 / judged 2 / annotated 2 / waived 0 / biting 2",
    "  file test_api_keys_venue_identity_uniq.sql: sections 7 / judged 7 / annotated 7 / waived 0 / biting 7",
    "  file test_capital_ownership_allocation_guard.sql: sections 10 / judged 10 / annotated 10 / waived 0 / biting 10",
    "  file test_capital_ownership_column.sql: sections 7 / judged 7 / annotated 7 / waived 0 / biting 7",
    "  file test_create_wizard_strategy_for_key.sql: sections 9 / judged 9 / annotated 9 / waived 0 / biting 9",
    "  file test_csv_daily_returns_perkey_rls.sql: sections 7 / judged 7 / annotated 7 / waived 0 / biting 7",
    "  file test_csv_finalize_atomic_fold.sql: sections 7 / judged 7 / annotated 7 / waived 0 / biting 7",
    "  file test_csv_finalize_auth_guard.sql: sections 3 / judged 3 / annotated 3 / waived 0 / biting 3",
    "  file test_csv_finalize_double_submit.sql: sections 5 / judged 5 / annotated 5 / waived 0 / biting 5",
    "  file test_enqueue_compute_job_dedupe_non_terminal.sql: sections 2 / judged 2 / annotated 2 / waived 0 / biting 2",
    "  file test_funding_fees_rls.sql: sections 7 / judged 7 / annotated 7 / waived 0 / biting 7",
    "  file test_get_published_trust_signals.sql: sections 5 / judged 5 / annotated 5 / waived 0 / biting 5",
    "  file test_get_verified_cohort_rank_gate.sql: sections 5 / judged 5 / annotated 5 / waived 0 / biting 5",
    "  file test_ledger_refresh_composite_arm.sql: sections 15 / judged 15 / annotated 15 / waived 0 / biting 15",
    "  file test_ledger_refresh_fanout.sql: sections 15 / judged 15 / annotated 15 / waived 0 / biting 15",
    "  file test_ledger_refresh_staleness.sql: sections 11 / judged 11 / annotated 11 / waived 0 / biting 11",
    "  file test_metrics_by_basis_write.sql: sections 2 / judged 2 / annotated 2 / waived 0 / biting 2",
    "  file test_resync_retry_single_job.sql: sections 3 / judged 3 / annotated 3 / waived 0 / biting 3",
    "  file test_scenario_downgrade_sweep.sql: sections 5 / judged 5 / annotated 5 / waived 0 / biting 5",
    "  file test_scenario_shares_rls.sql: sections 9 / judged 9 / annotated 9 / waived 0 / biting 9",
    "  file test_scenarios_rls.sql: sections 5 / judged 5 / annotated 5 / waived 0 / biting 5",
    "  file test_set_compute_job_progress.sql: sections 2 / judged 2 / annotated 2 / waived 0 / biting 2",
    "  file test_strategies_private_owner_isolation.sql: sections 8 / judged 8 / annotated 8 / waived 0 / biting 8",
    "  file test_strategy_analytics_series_completeness.sql: sections 5 / judged 5 / annotated 5 / waived 0 / biting 5",
    "  file test_strategy_keys_rls.sql: sections 9 / judged 9 / annotated 9 / waived 0 / biting 9",
    "  file test_strategy_shares_rls.sql: sections 35 / judged 45 / annotated 45 / waived 0 / biting 45",
    "  file test_strategy_verifications_wizard_session_tenant_scope.sql: sections 5 / judged 5 / annotated 5 / waived 0 / biting 5",
    "  file test_user_notes_dashboard_scope.sql: sections 6 / judged 6 / annotated 6 / waived 0 / biting 6",
    "  file test_weight_snapshot_seed_secdef.sql: sections 4 / judged 4 / annotated 4 / waived 0 / biting 4",
    "  file test_wizard_composite_fence.sql: sections 5 / judged 5 / annotated 5 / waived 0 / biting 5",
    "  file test_wizard_composite_members.sql: sections 11 / judged 11 / annotated 11 / waived 0 / biting 11",
    "per-arm lane time: mean 1.0s over 247 arm run(s)",
    "",
    "✅ No defects. Every annotated arm bit its own arm first.",
    "",
  ].join("\n");

  it("GREEN: a log whose two tallies agree passes and says so", () => {
    const r = runCountRecheck(GREEN_LOG);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("the runner's two tallies agree");
    expect(r.out).toContain("247 arm lane(s) spawned");
  });

  // ── 164.4-01, criterion 1 as amended: a SILENT EXCLUSION must fail here ──
  // `coverage: files N/71` is a ratio over every `.sql` in the scope dir, and
  // this phase's end state deliberately leaves the non-idiom files uncovered.
  // The runner names them; these two arms prove the CI step can fail when it
  // stops naming them, and when the count it claims contradicts the names it
  // printed. Without them the assertion would be a line nothing tests.
  it("RED: the unreachable line ABSENT is a MEASURE_FAIL — a silent exclusion fails like a missing annotation", () => {
    const without = GREEN_LOG.replace(/^unreachable: .*\n/m, "");
    expect(without, "the deletion must actually change the log").not.toBe(GREEN_LOG);
    const r = runCountRecheck(without);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
    expect(r.out).toContain("NO 'unreachable:");
    expect(r.out).not.toContain("two tallies agree");
  });

  it("RED: a CLAIMED count that disagrees with the NAMES printed beside it fails, quoting both numbers", () => {
    const lying = GREEN_LOG.replace(/^unreachable: 2 file\(s\) /m, "unreachable: 3 file(s) ");
    expect(lying).not.toBe(GREEN_LOG);
    const r = runCountRecheck(lying);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
    expect(r.out).toContain("CLAIMS 3 excluded file(s) but NAMES 2");
    expect(r.out).not.toContain("two tallies agree");
  });

  // ── 164.4-03, criterion 4: a SILENT DEFERRAL must fail here too ─────────
  // Four idiom files are deferred because the pg-lane cannot host pg_cron. Left
  // inside `  pending:` they would read, at the phase's end, as work nobody got
  // to — the repudiation shape criterion 4 exists to close. These two arms
  // prove the CI step fails when the runner stops naming them, and when the
  // count it claims contradicts the names it printed.
  it("RED: the lane-blocked line ABSENT is a MEASURE_FAIL — a silent deferral fails like a missing annotation", () => {
    const without = GREEN_LOG.replace(/^lane-blocked: .*\n/m, "");
    expect(without, "the deletion must actually change the log").not.toBe(GREEN_LOG);
    const r = runCountRecheck(without);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
    expect(r.out).toContain("NO 'lane-blocked:");
    expect(r.out).not.toContain("two tallies agree");
  });

  it("RED: a CLAIMED deferred count that disagrees with the NAMES printed beside it fails, quoting both numbers", () => {
    const lying = GREEN_LOG.replace(/^lane-blocked: 2 file\(s\) /m, "lane-blocked: 3 file(s) ");
    expect(lying).not.toBe(GREEN_LOG);
    const r = runCountRecheck(lying);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
    expect(r.out).toContain("CLAIMS 3 deferred file(s) but NAMES 2");
    expect(r.out).not.toContain("two tallies agree");
  });

  // ── 164.4-03, threat T-164.4-11: the reason must have been MEASURED ─────
  // The lane-blocked class is derived from the corpus; its printed reason is a
  // claim about the LANE. A run that stopped probing would keep printing four
  // deferred files with nothing able to contradict them. CI's job is to notice
  // the probe went MISSING — the one failure the runner cannot report about
  // itself, since a runner that never probed also never raises the defect.
  it("RED: the lane-probe line ABSENT is a MEASURE_FAIL — an unmeasured deferral reason is not a measurement", () => {
    const without = GREEN_LOG.replace(/^lane-probe: .*\n/m, "");
    expect(without, "the deletion must actually change the log").not.toBe(GREEN_LOG);
    const r = runCountRecheck(without);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
    expect(r.out).toContain("NO 'lane-probe:");
    expect(r.out).not.toContain("two tallies agree");
  });

  it("RED: the runner's UNREADABLE probe form does not satisfy the lane-probe assertion", () => {
    // The runner prints `lane-probe: UNREADABLE …` when the probe lane returned
    // no marker. That IS a printed lane-probe line, so a lazier grep (`^lane-probe:`)
    // would accept it and the missing measurement would pass CI while the
    // in-process MEASURE_FAIL carried the whole burden. The `(absent|AVAILABLE)`
    // alternation is what refuses it, and this arm is what keeps that alternation.
    const unreadable = GREEN_LOG.replace(
      /^lane-probe: .*$/m,
      "lane-probe: UNREADABLE — the probe lane printed no LANE-PROBE marker, so pg_cron availability was NOT measured and the lane-blocked class is unverified",
    );
    expect(unreadable, "the substitution must actually change the log").not.toBe(GREEN_LOG);
    expect(unreadable, "the substituted line is still a lane-probe line").toMatch(/^lane-probe: /m);
    const r = runCountRecheck(unreadable);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
    expect(r.out).toContain("NO 'lane-probe:");
  });

  // ── The ZERO boundary, both directions ───────────────────────────────────
  // GREEN_LOG always NAMES files, so until 2026-09-02 the empty excluded set —
  // `unreachable: 0 file(s) … — `, which is the SUCCESSOR PHASE'S STATED END
  // STATE — was untested on both sides. Under `set -euo pipefail` the name
  // count's `grep -o` matched nothing, exited 1, pipefail propagated, and the
  // step aborted with NO `::error::` line at all while the numeric guard beneath
  // it was dead code. The `|| true` on that pipeline is the fix; these two arms
  // are what make it, and the guard it revives, load-bearing.
  const ZERO_EXCLUDED =
    "unreachable: 0 file(s) raise outside the runner's identity idiom —  (TODOS [REDUNDER-NONIDIOM])";

  it("GREEN: an EMPTY excluded set passes — the successor phase's end state is not an opaque abort", () => {
    const none = GREEN_LOG.replace(/^unreachable: .*$/m, ZERO_EXCLUDED);
    // Without this the arm goes vacuous the moment the runner's wording moves:
    // a regex that stops matching leaves GREEN_LOG untouched and the assertion
    // below would then be re-asserting the ALREADY-COVERED non-empty case.
    expect(none, "the substitution must actually change the log").not.toBe(GREEN_LOG);
    expect(none, "the substituted line must name NO file").not.toMatch(/^unreachable: .*\.sql/m);
    const r = runCountRecheck(none);
    expect(r.status, r.out).toBe(0);
    expect(r.out).toContain("the runner's two tallies agree");
  });

  it("RED: zero NAMES under a NON-ZERO claim still fails — `|| true` must not have made the mismatch a pass-everything", () => {
    // The paired direction. The fix suppresses grep's exit status, so the only
    // thing left standing between a nameless exclusion claim and a green board
    // is the `-ne` comparison the suppression revived. If someone ever swallows
    // the comparison too, this arm — not CI — is what says so.
    const nameless = GREEN_LOG.replace(
      /^unreachable: .*$/m,
      ZERO_EXCLUDED.replace("unreachable: 0 ", "unreachable: 2 "),
    );
    expect(nameless, "the substitution must actually change the log").not.toBe(GREEN_LOG);
    const r = runCountRecheck(nameless);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
    expect(r.out).toContain("CLAIMS 2 excluded file(s) but NAMES 0");
    expect(r.out).not.toContain("two tallies agree");
  });

  // ── 164.4-01, threat T-164.4-05: a file that judged NOTHING still counts as
  // coverage. `coverage: files N/71` cannot tell a red-baseline file from one
  // whose every arm bit. The per-file rows can, and these three arms prove the
  // CI step fails when the rows vanish, when they disagree with the coverage
  // numerator, and when their `biting` column does not add up to the aggregate.
  it("RED: NO per-file rows is a MEASURE_FAIL — a breakdown that stopped printing is not a clean one", () => {
    const without = GREEN_LOG.replace(/^ {2}file .*\n/gm, "");
    expect(without, "the deletion must actually change the log").not.toBe(GREEN_LOG);
    const r = runCountRecheck(without);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
    expect(r.out).toContain("NO '  file <name>: sections");
    expect(r.out).not.toContain("two tallies agree");
  });

  it("RED: more per-file rows than the coverage numerator claims fails, naming both counts", () => {
    const extra = GREEN_LOG.replace(
      /^ {2}file test_strategy_shares_rls\.sql: .*$/m,
      (line) =>
        `${line}\n  file test_a_thirty_third_annotated_gate.sql: sections 15 / judged 0 / annotated 0 / waived 0 / biting 0`,
    );
    expect(extra).not.toBe(GREEN_LOG);
    const r = runCountRecheck(extra);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("printed 33 per-file row(s) but reported 32 annotated file(s)");
    expect(r.out).not.toContain("two tallies agree");
  });

  it("RED: a per-file biting column that does not SUM to the aggregate fails, naming both sums", () => {
    const short = GREEN_LOG.replace(/^( {2}file .*)biting 45$/m, "$1biting 44");
    expect(short, "the mutation must actually change the log").not.toBe(GREEN_LOG);
    const r = runCountRecheck(short);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("rows sum to 246 biting arm(s) but the aggregate");
    expect(r.out).toContain("reports 247");
    expect(r.out).not.toContain("two tallies agree");
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

  it("RED: the parse-only shape — 247 executed claimed, 0 lanes counted — fails naming all three numbers", () => {
    const severed = GREEN_LOG.replace(/^lane-invocations: 247 /m, "lane-invocations: 0 ");
    expect(severed).not.toBe(GREEN_LOG);
    const r = runCountRecheck(severed);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("GATE failing, not the corpus");
    expect(r.out).toContain("executed=247 lane-invocations=0 biting=247");
    expect(r.out).not.toContain("two tallies agree");
  });

  it("RED: a single unaccounted lane also fails — the relation is exact", () => {
    const extra = GREEN_LOG.replace(/^lane-invocations: 247 /m, "lane-invocations: 248 ");
    const r = runCountRecheck(extra);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("executed=247 lane-invocations=248 biting=247");
  });

  it("RED: a NON-NUMERIC lane-invocations count is a MEASURE_FAIL, never parsed as a number", () => {
    const garbled = GREEN_LOG.replace(/^lane-invocations: 247 /m, "lane-invocations: abc ");
    expect(garbled).not.toBe(GREEN_LOG);
    const r = runCountRecheck(garbled);
    expect(r.status, r.out).toBe(1);
    expect(r.out).toContain("MEASURE_FAIL");
    expect(r.out).toContain("NO 'lane-invocations: N' line");
    expect(r.out).not.toContain("two tallies agree");
  });

  it("RED: a waived count above WAIVED_CEILING fails naming both numbers — the W field is read, not ignored", () => {
    // The GREEN log carries `arms: 247/247/0`; one waiver against a ceiling read
    // out of run.mjs (0 today) must fail. The executed and biting counts are
    // untouched, so nothing else in the step can be what fired.
    const waived = GREEN_LOG.replace(/^arms: 247\/247\/0 /m, `arms: 247/247/${WAIVED_CEILING + 1} `);
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
    const zero = GREEN_LOG.replace(/^arms: 247\/247\/0 /m, "arms: 0/247/0 ");
    const z = runCountRecheck(zero);
    expect(z.status, z.out).toBe(1);
    expect(z.out).toContain("ZERO arms executed");
    const spliced = GREEN_LOG.replace(/^biting: 247 /m, "biting: 248 ");
    const s = runCountRecheck(spliced);
    expect(s.status, s.out).toBe(1);
    expect(s.out).toContain("biting (248) exceeds executed (247)");
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

describe("164.4-01 — the SECTION denominator: `sectionOfIdentity` / `gateSectionCount`", () => {
  // ⛔ WHY THIS EXISTS. `sections` is the DENOMINATOR the per-file row prints,
  // and CI's row regex only requires `sections [0-9]+` to EXIST — it never
  // reads the value. A suffix rule that regressed to collapse every identity
  // into one section would print `sections 1` on every run and nothing would
  // notice. Plan 164.4-02 will pin `annotated >= sections`, which would then
  // rest on an unverified denominator: a coverage claim measured against a
  // number nobody compared to the corpus is this phase's whole subject.
  //
  // The reference file is `test_strategy_shares_rls.sql`, the one annotated
  // gate. MEASURED 2026-09-02 at HEAD by `node scripts/mutation-runner/run.mjs
  // --parse-only`, which prints `sections 35` for it, and independently by
  // calling `gateSectionCount` on the file's bytes: 35, agreeing with the
  // doc-comment claim beside the function in run.mjs.
  const REFERENCE_GATE = "test_strategy_shares_rls.sql";

  it.each([
    // Documented shapes, quoted from the rule's own doc-comment in run.mjs.
    ["SHAPE 2a", "SHAPE 2"],
    ["TRIGGER 3d-i", "TRIGGER 3"],
    ["ANON 1b-grant", "ANON 1"],
    // No suffix — the identity IS its own section, unchanged.
    ["SHAPE 2", "SHAPE 2"],
    ["OWNER 7", "OWNER 7"],
    // ⭐ MULTI-DIGIT. `SHAPE 10` must NOT become `SHAPE 1`: a rule that ate the
    // trailing digit would silently merge section 10 into section 1 and shrink
    // every denominator past nine sections — the direction that makes a
    // half-annotated file read as complete.
    ["SHAPE 10", "SHAPE 10"],
    ["SHAPE 10b", "SHAPE 10"],
    ["TRIGGER 12c-i", "TRIGGER 12"],
  ])("sectionOfIdentity(%j) === %j", (id: string, section: string) => {
    expect(sectionOfIdentity(id)).toBe(section);
  });

  it("is not the identity function, and not a constant — the two failure directions of a collapsed rule", () => {
    // A rule that returned its input unchanged would over-count sections; one
    // that collapsed everything would under-count. Both are pinned by shape
    // here so a regression fails on the RULE, not only on the number below.
    expect(sectionOfIdentity("SHAPE 2a")).not.toBe("SHAPE 2a");
    expect(new Set(["SHAPE 1a", "SHAPE 2a", "SHAPE 10a"].map(sectionOfIdentity)).size).toBe(3);
  });

  it("gateSectionCount is PINNED on the reference gate at its MEASURED value", () => {
    const text = readFileSync(join(GATE_DIR, REFERENCE_GATE), "utf8");
    const sections = gateSectionCount(text);
    expect(
      sections,
      `${REFERENCE_GATE}: gateSectionCount now reads ${sections}. It was MEASURED at 35 on 2026-09-02 (\`--parse-only\` prints \`sections 35\` for this file). If the gate genuinely gained or lost assertion groups, re-measure and move this pin deliberately; if it did not, the suffix rule or the attribution scan regressed and the printed denominator is now wrong for every file.`,
    ).toBe(35);
    // Non-vacuity in the collapse direction, stated separately from the pin:
    // the whole risk is a denominator that quietly becomes 1.
    expect(sections).toBeGreaterThan(1);
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
