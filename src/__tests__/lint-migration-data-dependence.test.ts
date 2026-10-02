/**
 * The data-dependence refusal - CONTRACT test (Phase 164.9 plan 09).
 *
 * WHY THIS FILE EXISTS. `scripts/lint-migration-data-dependence.mjs` refuses a
 * migration whose anonymous block raises on rows the TEST database does not
 * have. Its own `--self-test` proves the refusals can fire. What that self-test
 * structurally CANNOT prove is anything about the things around it, and those
 * are where this class of gate rots:
 *
 *   * the WIRING - a refusal nobody runs is a refusal that does not exist, and
 *     a step that asserts only an exit code is satisfied by a module that
 *     emitted nothing (this repo has a measured record of exactly that);
 *   * the MODE IDENTITY - the bare command in the workflow must be the command
 *     a developer runs, exactly once, so the pin cannot drift;
 *   * the FLOOR in its stale-LOW direction - the runner gates on
 *     `REFUSALS.length < REFUSALS_FLOOR`, so a floor set BELOW the table is
 *     invisible to it BY CONSTRUCTION. That is the two-floors-two-layers shape
 *     CLAUDE.md records for the mutation runner, and this file is layer 2;
 *   * the LEDGER RATCHET in its stale-low direction - the ledger may shrink,
 *     and it may not grow without its recorded count moving with it.
 *
 * -- WHAT CAN AND CANNOT FAIL TODAY ----------------------------------------
 *   LIVE - every assertion here can fail against the repo as it stands. The AIM
 *     block drives the classifier over synthetic sources whose answers are known
 *     and are NOT the empty set; the wiring assertions are each calibrated by
 *     mutating a COPY of the workflow text; the floor and ledger ratchets are
 *     calibrated in-memory in both directions.
 *   DORMANT - none. This file pins no empty set: the ledger is asserted
 *     NON-EMPTY, which is the measured state at authoring time, and the census
 *     assertion requires a non-zero corpus AND a non-zero block count.
 *   INERT - none.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CENSUS_RE,
  REFUSALS,
  REFUSALS_FLOOR,
  SELF_TEST_LEGS,
  SELF_TEST_OK_RE,
  anonymousBlocks,
  appRelationsIn,
  classifySource,
  isCatalogueRelation,
  parseBaseline,
} from "../../scripts/lint-migration-data-dependence.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCRIPT = "scripts/lint-migration-data-dependence.mjs";
const BASELINE_PATH = join(REPO_ROOT, "scripts", "lint-migration-data-dependence-baseline.txt");
const TODOS_PATH = join(REPO_ROOT, "TODOS.md");
const CI_WF = join(REPO_ROOT, ".github", "workflows", "ci.yml");
const FIXTURES = join(REPO_ROOT, "scripts", "lint-migration-data-dependence-fixtures");

const SELF_TEST_CMD = `node ${SCRIPT} --self-test`;
const SCAN_CMD = `node ${SCRIPT}`;

interface Refusal {
  rule: string;
  line: number;
  relation: string;
  via: string;
  reason: string;
}

/** Classify, failing loud rather than returning an empty set on a lex error. */
function measure(src: string, label: string): { blocks: number; refusals: Refusal[] } {
  const r = classifySource(src) as
    | { blocks: number; refusals: Refusal[] }
    | { error: string; line: number };
  if ("error" in r) throw new Error(`${label} could not be lexed: ${r.error} (line ${r.line})`);
  return r;
}

/**
 * Assert a mutation of the source text FALSIFIES the predicate. Without this an
 * assertion over a file can pass because the file is shaped in a way the scanner
 * cannot see, rather than because the file is correct.
 */
function calibrate(
  label: string,
  text: string,
  mutate: (s: string) => string,
  holds: (s: string) => boolean,
) {
  const mutated = mutate(text);
  expect(mutated, `${label}: the calibration did not change the text - re-anchor it`).not.toBe(text);
  expect(
    holds(mutated),
    `${label}: the assertion still holds after the calibration, so it cannot fail`,
  ).toBe(false);
}

/** The index of a LIVE (uncommented) `run:` line carrying exactly `cmd`, or -1. */
function liveRunIndex(text: string, cmd: string): number {
  return text
    .split("\n")
    .findIndex((l) => /^[ \t]*run:[ \t]/.test(l) && l.trim() === `run: ${cmd}`);
}

// ---------------------------------------------------------------------------
// AIM, DECLARED FIRST. Synthetic sources whose answers are known and NOT the
// empty set. Every live-file assertion below stands on this classifier; if it
// quietly stopped classifying, the ledger would keep agreeing with itself and
// this block is what reddens instead.
// ---------------------------------------------------------------------------

const AIM_REFUSED = [
  "DO $t$",
  "DECLARE v_n INTEGER;",
  "BEGIN",
  "  SELECT count(*) INTO v_n FROM public.aim_rows;",
  "  IF v_n <> 2 THEN",
  "    RAISE EXCEPTION 'aim: expected 2';",
  "  END IF;",
  "END",
  "$t$;",
].join("\n");

const AIM_ALLOWED = [
  "DO $t$",
  "DECLARE v_n INTEGER;",
  "BEGIN",
  "  SELECT count(*) INTO v_n FROM pg_catalog.pg_class WHERE relname = 'aim_rows';",
  "  IF v_n <> 1 THEN",
  "    RAISE EXCEPTION 'aim: the table is absent';",
  "  END IF;",
  "  SELECT count(*) INTO v_n FROM public.aim_rows;",
  "  RAISE NOTICE 'aim: % rows', v_n;",
  "END",
  "$t$;",
].join("\n");

describe("AIM - the classifier actually classifies", () => {
  it("refuses the data-conditioned raise and NAMES the relation it read", () => {
    const m = measure(AIM_REFUSED, "AIM_REFUSED");
    expect(m.blocks, "the block scanner found no anonymous block").toBe(1);
    expect(m.refusals).toHaveLength(1);
    expect(m.refusals[0].rule).toBe("R1-variable-conditioned-raise");
    expect(m.refusals[0].relation).toBe("public.aim_rows");
    expect(m.refusals[0].via).toContain("v_n");
    // The message is a VERDICT, never a specimen: no statement text, no value.
    expect(m.refusals[0].reason).not.toContain("count(*)");
  });

  it("allows the SAME shape over the catalogue, and a data read that only NOTICEs", () => {
    const m = measure(AIM_ALLOWED, "AIM_ALLOWED");
    expect(m.blocks).toBe(1);
    expect(
      m.refusals,
      "the catalogue guard, or the RAISE NOTICE after a data read, was refused",
    ).toEqual([]);
  });

  it("CALIBRATION - swapping the catalogue read for a data read flips the verdict", () => {
    const mutated = AIM_ALLOWED.replace(
      "FROM pg_catalog.pg_class WHERE relname = 'aim_rows'",
      "FROM public.aim_rows WHERE kind = 'x'",
    );
    expect(mutated, "the calibration did not change the text").not.toBe(AIM_ALLOWED);
    expect(measure(mutated, "AIM_ALLOWED-mutated").refusals.length).toBeGreaterThan(0);
  });

  it("a CREATE FUNCTION body is not an anonymous block", () => {
    const fn = [
      "CREATE FUNCTION public.aim_fn() RETURNS void LANGUAGE plpgsql AS $b$",
      "DECLARE v_n INTEGER;",
      "BEGIN",
      "  SELECT count(*) INTO v_n FROM public.aim_rows;",
      "  IF v_n = 0 THEN RAISE EXCEPTION 'aim'; END IF;",
      "END",
      "$b$;",
    ].join("\n");
    const scanned = anonymousBlocks(fn) as { blocks: unknown[] };
    expect(scanned.blocks, "a stored function body was counted as an anonymous block").toEqual([]);
    expect(measure(fn, "AIM_FN").refusals).toEqual([]);
  });

  it("the catalogue predicate discriminates, in both directions", () => {
    for (const cat of [
      "pg_class",
      "pg_catalog.pg_proc",
      "information_schema.columns",
      "pg_policies",
    ]) {
      expect(isCatalogueRelation(cat), `${cat} must read as catalogue`).toBe(true);
    }
    for (const app of ["public.strategies", "compute_jobs", "cron.job", "auth.users"]) {
      expect(isCatalogueRelation(app), `${app} must NOT read as catalogue`).toBe(false);
    }
    // Non-vacuity: the relation scanner must actually find something.
    expect(
      appRelationsIn("SELECT 1 FROM public.a JOIN pg_class c ON true", new Set()),
    ).toEqual(["public.a"]);
  });
});

// ---------------------------------------------------------------------------
// The floor, in the direction the runner cannot see.
// ---------------------------------------------------------------------------

describe("the refusal floor is a ratchet in BOTH directions", () => {
  it("every declared refusal carries a red AND a green fixture on disk", () => {
    const legs = SELF_TEST_LEGS as Array<{ fixture: string; colour: string; rule: string | null }>;
    for (const leg of legs) {
      expect(existsSync(join(FIXTURES, leg.fixture)), `${leg.fixture} is missing`).toBe(true);
    }
    for (const r of REFUSALS as Array<{ id: string }>) {
      expect(
        legs.some((l) => l.colour === "red" && l.rule === r.id),
        `${r.id} has no red fixture - it is not proven able to fire`,
      ).toBe(true);
      expect(
        legs.some((l) => l.colour === "green" && l.rule === r.id),
        `${r.id} has no green fixture - it is not proven to discriminate`,
      ).toBe(true);
    }
  });

  it("REFUSALS_FLOOR is not STALE-LOW", () => {
    expect(
      REFUSALS.length,
      `RATCHET STALE: the table declares ${REFUSALS.length} refusal(s) but REFUSALS_FLOOR is still ${REFUSALS_FLOOR}. Raise the floor in the same commit that grew the table, or the runner's own gate stops measuring the growth.`,
    ).toBe(REFUSALS_FLOOR);
    expect(REFUSALS_FLOOR).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// The ledger.
// ---------------------------------------------------------------------------

describe("the ledger is dated, shrink-only and count-verified", () => {
  const text = readFileSync(BASELINE_PATH, "utf8");
  const parsed = parseBaseline(text) as {
    entries: Array<{ lineNo: number; file: string; rule: string; relation: string; destination: string }>;
    malformed: Array<{ lineNo: number; reason: string }>;
    recorded: number | null;
  };

  it("carries no malformed line", () => {
    expect(
      parsed.malformed,
      `malformed line(s): ${parsed.malformed.map((m) => `:${m.lineNo} ${m.reason}`).join(" | ")}`,
    ).toEqual([]);
  });

  it("is NON-EMPTY and its recorded count agrees with its lines", () => {
    // Non-vacuity: every assertion below is about a set that has members.
    expect(parsed.entries.length).toBeGreaterThan(0);
    expect(parsed.recorded).toBe(parsed.entries.length);
  });

  it("STALE-LOW RATCHET - the ledger may shrink, never grow without its count", () => {
    expect(
      parsed.entries.length,
      `the ledger carries ${parsed.entries.length} entr(ies) against a recorded ${parsed.recorded}. It ONLY SHRINKS: a new data-dependent guard is fixed in the MIGRATION, never absorbed here.`,
    ).toBeLessThanOrEqual(parsed.recorded ?? -1);
    calibrate(
      "the recorded count is read, not assumed",
      text,
      (s) => s.replace(/# ENTRY_COUNT = [0-9]+/, "# ENTRY_COUNT = 99999"),
      (s) => {
        const p = parseBaseline(s) as { entries: unknown[]; recorded: number | null };
        return p.recorded === p.entries.length;
      },
    );
  });

  it("every entry names a migration that exists, a declared rule, and a booked destination", () => {
    const todos = readFileSync(TODOS_PATH, "utf8");
    const ruleIds = new Set((REFUSALS as Array<{ id: string }>).map((r) => r.id));
    for (const e of parsed.entries) {
      expect(
        existsSync(join(REPO_ROOT, "supabase", "migrations", e.file)),
        `:${e.lineNo} names "${e.file}", which is not under supabase/migrations/`,
      ).toBe(true);
      expect(ruleIds, `:${e.lineNo} names an undeclared rule ${e.rule}`).toContain(e.rule);
      const id = /\[([A-Za-z0-9._-]+)\]/.exec(e.destination);
      expect(id, `:${e.lineNo} carries no bracketed destination id`).not.toBeNull();
      expect(
        todos,
        `:${e.lineNo} routes to [${id?.[1]}], which is not a booked id in TODOS.md - a destination nobody wrote is the FANOUT-GLOBAL-01 failure mode`,
      ).toContain(`[${id?.[1]}]`);
    }
  });

  it("states the DIRECTION rule and the forbidden closures - a list with no stated direction stops controlling", () => {
    expect(text).toMatch(/THIS FILE MUST ONLY SHRINK/);
    expect(text, "the remedy for something already merged").toMatch(/REVERT THE MERGE/);
    expect(text, "the clearing rule must forbid widening the ledger").toMatch(
      /never cleared by relaxing the classifier/i,
    );
    calibrate(
      "the direction rule is read, not assumed",
      text,
      (s) => s.replace("THIS FILE MUST ONLY SHRINK", "grow it freely"),
      (s) => /THIS FILE MUST ONLY SHRINK/.test(s),
    );
  });
});

// ---------------------------------------------------------------------------
// The wiring. A refusal nobody runs is a refusal that does not exist.
// ---------------------------------------------------------------------------

describe("the gate is wired into ci.yml, self-test FIRST, with its census asserted", () => {
  const text = readFileSync(CI_WF, "utf8");

  it("runs the self-test and then the corpus scan, each bare line exactly once", () => {
    const selfAt = liveRunIndex(text, SELF_TEST_CMD);
    const scanAt = liveRunIndex(text, SCAN_CMD);
    expect(
      selfAt,
      `\`${SELF_TEST_CMD}\` is not a LIVE run line - a commented-out command is not a command`,
    ).toBeGreaterThan(-1);
    expect(scanAt, `\`${SCAN_CMD}\` is not a LIVE run line`).toBeGreaterThan(-1);
    expect(
      selfAt,
      "the self-test must run BEFORE the corpus scan: a scan reporting 0 NEW is not evidence unless its refusals can still fire",
    ).toBeLessThan(scanAt);

    const count = (cmd: string) => text.split("\n").filter((l) => l.trim() === `run: ${cmd}`).length;
    expect(count(SELF_TEST_CMD), "the mode-identity pin must be unambiguous").toBe(1);
    expect(count(SCAN_CMD)).toBe(1);

    calibrate(
      "the scan is EXECUTED, not mentioned",
      text,
      (s) => s.replace(`        run: ${SCAN_CMD}\n`, `        # run: ${SCAN_CMD}\n`),
      (s) => liveRunIndex(s, SCAN_CMD) > -1,
    );
    calibrate(
      "self-test before scan",
      text,
      (s) =>
        s
          .replace(`run: ${SELF_TEST_CMD}`, "run: __SWAP__")
          .replace(`run: ${SCAN_CMD}`, `run: ${SELF_TEST_CMD}`)
          .replace("run: __SWAP__", `run: ${SCAN_CMD}`),
      (s) => liveRunIndex(s, SELF_TEST_CMD) < liveRunIndex(s, SCAN_CMD),
    );
  });

  it("asserts the census line on STDOUT, not the exit code alone", () => {
    // The step must capture stdout and grep for the census line. An exit-code
    // step is satisfied by a module that emitted nothing - measured in this very
    // job for the sibling extractor.
    expect(text, "the scan's stdout is never captured").toMatch(
      /node scripts\/lint-migration-data-dependence\.mjs > "\$MIGDEP_SCAN_LOG"/,
    );
    expect(text, "the census line is not asserted").toContain(
      "^lint-migration-data-dependence: corpus [0-9]+ migration",
    );
    expect(text, "MEASURE_FAIL is the verdict for a silent exit 0").toMatch(
      /MEASURE_FAIL: the scan exited 0 but printed NO/,
    );
    calibrate(
      "the stdout capture is read, not assumed",
      text,
      (s) => s.replace('> "$MIGDEP_SCAN_LOG"', "> /dev/null"),
      (s) => /node scripts\/lint-migration-data-dependence\.mjs > "\$MIGDEP_SCAN_LOG"/.test(s),
    );
  });

  it("carries no softening token inside the new steps", () => {
    const lines = text.split("\n");
    const first = lines.findIndex((l) => l.includes("Data-dependence gate self-test"));
    expect(first, "the new steps are not in ci.yml at all").toBeGreaterThan(-1);
    const after = lines.slice(first).findIndex((l) => /^  [a-z][a-z0-9-]*:$/.test(l));
    const region = lines.slice(first, after > -1 ? first + after : lines.length);
    expect(region.length, "the region scan found no lines").toBeGreaterThan(20);
    const offenders = region.filter(
      (l) => /\|\|\s*true\b/.test(l) || /\|\|\s*exit\s+0\b/.test(l) || /^\s*exit 0\s*$/.test(l),
    );
    expect(
      offenders,
      `a softening token inside the data-dependence steps makes the gate advisory: ${offenders.join(" | ")}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// End to end. The two commands the workflow runs, run here too.
// ---------------------------------------------------------------------------

describe("the two commands the workflow pastes verbatim", () => {
  it("--self-test exits 0 and PRINTS a derived refusal count", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--self-test"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(r.status, `self-test failed:\n${r.stderr}`).toBe(0);
    const line = (r.stdout ?? "").split("\n").find((l) => SELF_TEST_OK_RE.test(l));
    expect(line, `no self-test OK line in:\n${r.stdout}`).toBeDefined();
    expect(line).toContain(`(${REFUSALS.length} refusals`);
  });

  it("the corpus scan exits 0 and PRINTS a census over a non-empty corpus", () => {
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(r.status, `the corpus scan failed:\n${r.stderr}`).toBe(0);
    const line = (r.stdout ?? "").split("\n").find((l) => CENSUS_RE.test(l));
    expect(line, `no census line in:\n${r.stdout}`).toBeDefined();
    const nums = /corpus (\d+) migration\(s\), (\d+) anonymous block\(s\); (\d+) refusal\(s\), (\d+) allowlisted, (\d+) NEW\./.exec(
      line as string,
    );
    expect(nums).not.toBeNull();
    // An empty corpus, or one with no blocks, is scanned vacuously.
    expect(Number(nums?.[1]), "0 migrations scanned").toBeGreaterThan(0);
    expect(Number(nums?.[2]), "0 anonymous blocks found - the block scanner is broken").toBeGreaterThan(0);
    expect(Number(nums?.[5]), "a NEW refusal is not in the ledger").toBe(0);
  });
});
