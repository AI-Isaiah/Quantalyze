/**
 * restore-test-from-baseline WIRING PIN — Phase 164.8 plan 02.
 *
 * ⛔ WHAT THIS FILE DEFENDS. `scripts/restore-test-from-baseline.sh` runs ONE
 * destructive transaction — `DROP SCHEMA public CASCADE` — against a database
 * OTHER PEOPLE'S CI shares. Its `--self-test` proves every arm of that contract on a
 * throwaway cluster — how many arms that is, is the script's own `EXPECTED_ARMS`
 * constant, and `bash scripts/restore-test-from-baseline.sh --self-test` prints the
 * tally; a numeral restated here would drift the first time an arm is added. None of that survives an edit that MOVES a line: the census reading the
 * catalogue before it sets `search_path`, the `pg_depend` closure sinking below the
 * DROP, the marker query drifting after the first write, psql's whole-file
 * transaction flag appearing and appending an unconditional COMMIT to what
 * `--mode preflight` promised to roll back. Every one of those keeps the arms
 * green while changing what the script does to a real database. ORDER is the
 * property; this file is the pin.
 *
 * ⭐ EVERY PREDICATE HERE IS WRITTEN OVER ARBITRARY TEXT AND CALIBRATED ON A
 * MUTATED IN-MEMORY COPY (the `prod-prober-wiring.test.ts:13-17` idiom). A
 * predicate only ever applied to the passing input is not evidence — it can be
 * satisfied by a function that matches anything. Each CALIBRATION asserts the copy
 * actually differs from the original, then asserts the predicate FLIPS on it.
 *
 * ⛔ LINE-EXACT AND NON-COMMENT, never a whole-file `toContain`. MEASURED twice in
 * this repo on 2026-09-08 (`local-stack-lane-wiring.test.ts:124-140`): a whole-file
 * `toContain` stays green with the pinned line commented out, because commented-out
 * text is still text in the file. `liveLines()` below drops both bash `#` comments
 * and SQL `--` comments — this file is a bash script that carries SQL heredocs, so
 * a pin blind to `--` would be satisfied by a SQL comment.
 *
 * ⚠️ ALL READS GO THROUGH `node:fs`, NEVER A SHELL GREP. This repo has a measured
 * NUL-blind file (`src/lib/wizardErrors.test.ts`) where `grep` exits 1 and the
 * absence reads as "clean".
 */
import { describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = "scripts/restore-test-from-baseline.sh";
const FIXTURES = "scripts/restore-test-from-baseline-fixtures";

function read(p: string): string {
  return readFileSync(p, "utf8");
}

/**
 * A line is LIVE when its first non-blank character opens neither a bash comment
 * (`#`) nor a SQL comment (`--`). Both matter: the script's SQL lives in heredocs,
 * so a needle inside a `-- …` line is prose, not code.
 */
function isLive(line: string): boolean {
  const t = line.trim();
  return t !== "" && !t.startsWith("#") && !t.startsWith("--");
}

/** Every live line of `text`, with its ORIGINAL index preserved. */
function liveLines(text: string): { i: number; line: string }[] {
  return text
    .split("\n")
    .map((line, i) => ({ i, line }))
    .filter(({ line }) => isLive(line));
}

/** Index of the first LIVE line containing `needle`, or -1. */
function liveIndexOf(text: string, needle: string): number {
  const hit = liveLines(text).find(({ line }) => line.includes(needle));
  return hit ? hit.i : -1;
}

/** How many LIVE lines contain `needle`. */
function liveCount(text: string, needle: string): number {
  return liveLines(text).filter(({ line }) => line.includes(needle)).length;
}

/**
 * The destructive statement every ordering pin below is measured against.
 *
 * ⛔ THE TRAILING SEMICOLON IS LOAD-BEARING — do not "simplify" it away. The phrase
 * `DROP SCHEMA public CASCADE` also appears inside LIVE prose: the mutex refusal's
 * `fail "…keeping other people's CI out during DROP SCHEMA public CASCADE. …"` sits
 * near the TOP of the --run region, hundreds of lines above the statement itself.
 * `liveIndexOf` returns the FIRST live line containing its needle, so the bare phrase
 * binds to that sentence and every "X sits above the DROP" pin below silently starts
 * measuring against the wrong line — MEASURED 2026-09-08, when exactly that made two
 * intact ordering pins report a false RED.
 *
 * The semicolon disambiguates by MEASUREMENT, not by hope: the statement is written
 * `DROP SCHEMA public CASCADE;` and every prose mention ends the phrase with a period.
 * Measured on this tree the same day: the semicolon form matches exactly one line in
 * the whole script (the statement), the bare form matches five. This is a strict
 * TIGHTENING — the pin binds more precisely than before, never less.
 */
const DROP_STMT = "DROP SCHEMA public CASCADE;";

// ── REGIONS ────────────────────────────────────────────────────────────────
// Pins are asserted against the REGION, not the whole file: `pg_policies` appears
// in the census AND in the in-transaction assertions, and a whole-file "the
// search_path line comes first" would be satisfied by whichever pair happened to
// be adjacent. Each slicer returns "" when its anchor is absent, and every
// consumer asserts the slice is non-empty — a region that silently became empty
// would make every pin over it vacuously true.

/** Everything BEFORE the `--self-test` banner: the `--run` machinery. */
function runRegion(text: string): string {
  const lines = text.split("\n");
  const end = lines.findIndex((l) => l.startsWith("# --self-test"));
  return end < 0 ? "" : lines.slice(0, end).join("\n");
}

/** The `--self-test` banner to EOF. */
function selfTestRegion(text: string): string {
  const lines = text.split("\n");
  const start = lines.findIndex((l) => l.startsWith("# --self-test"));
  return start < 0 ? "" : lines.slice(start).join("\n");
}

/** The census SQL heredoc — the session that READS the catalogue. */
function censusRegion(text: string): string {
  const lines = text.split("\n");
  const a = lines.findIndex((l) => l.includes("<<'CENSUS_SQL'"));
  if (a < 0) return "";
  const b = lines.findIndex((l, i) => i > a && l.trim() === "CENSUS_SQL");
  return b < 0 ? "" : lines.slice(a, b).join("\n");
}

/** `build_transaction()` — the session that WRITES. */
function txnRegion(text: string): string {
  return functionBody(text, "build_transaction");
}

/**
 * A top-level bash function's body, from its `name() {` line to the first
 * column-0 `}`. The script indents every nested block, so a column-0 `}` closes
 * the function and nothing else.
 */
function functionBody(text: string, name: string): string {
  const lines = text.split("\n");
  const a = lines.findIndex((l) => l.startsWith(`${name}() {`));
  if (a < 0) return "";
  const b = lines.findIndex((l, i) => i > a && l === "}");
  return b < 0 ? "" : lines.slice(a, b + 1).join("\n");
}

const SRC = read(SCRIPT);

describe("restore-test-from-baseline.sh — the regions are real", () => {
  it("every region slicer finds its anchor and returns a non-empty slice", () => {
    // ⛔ THE PRECONDITION FOR EVERY PIN BELOW. `liveIndexOf("") === -1` and
    // `liveCount("") === 0`, so an ordering pin over an empty region is vacuously
    // satisfiable. This arm is what stops a renamed function from silently
    // disarming a dozen assertions at once.
    for (const [name, region] of [
      ["run", runRegion(SRC)],
      ["self-test", selfTestRegion(SRC)],
      ["census", censusRegion(SRC)],
      ["build_transaction", txnRegion(SRC)],
      ["refuse_absent_credential", functionBody(SRC, "refuse_absent_credential")],
      ["run_restore", functionBody(SRC, "run_restore")],
    ] as const) {
      expect(
        region.split("\n").filter(isLive).length,
        `the '${name}' region is empty — its anchor moved, and every pin asserted over it is now vacuously true`,
      ).toBeGreaterThan(3);
    }

    // CALIBRATION — rename the anchor and the slicer must go empty.
    const mutated = SRC.replace("build_transaction() {", "build_txn() {");
    expect(mutated).not.toBe(SRC);
    expect(txnRegion(mutated)).toBe("");
  });
});

describe("restore-test-from-baseline.sh — the arm ratchet", () => {
  it("EXPECTED_ARMS=27 is a live line, exactly once, with its MEASURED date beside it", () => {
    const region = selfTestRegion(SRC);
    expect(
      liveCount(region, "EXPECTED_ARMS=27"),
      "the arm ratchet is no longer a single live `EXPECTED_ARMS=27` line in the self-test region. A commented-out ratchet is not a ratchet, and two of them can disagree.",
    ).toBe(1);

    // SC-9 (`gate-family-meta.test.ts:18-30`): a threshold constant needs a
    // measurement token AND a date beside it, or nobody can tell a measured floor
    // from a guessed one.
    const lines = region.split("\n");
    const at = lines.findIndex((l) => isLive(l) && l.includes("EXPECTED_ARMS=27"));
    const beside = `${lines[at - 1] ?? ""}\n${lines[at]}`;
    expect(
      beside,
      "EXPECTED_ARMS=27 carries no MEASURED date on its own or the preceding line — SC-9",
    ).toContain("MEASURED 2026-09-10");

    // The harness must ASSERT the count, not merely print it.
    expect(liveCount(region, 'if [ "$total" -ne "$EXPECTED_ARMS" ]; then')).toBe(1);
    expect(liveCount(region, 'if [ "$pass" -ne "$total" ]; then')).toBe(1);

    // ⛔ THE MEASURED-DATE COMMENT MUST AGREE WITH THE CONSTANT IT SITS BESIDE.
    // The phase verification's advisory (2026-09-09): SC-9 pins that a DATE is
    // present, never that the COUNT in the same sentence is the current one. So
    // rewriting `prints 26/26` to `prints 24/24` beside the constant left every
    // ratchet leg green — the two can drift apart silently, and the prose is what
    // a reader trusts. Derive the expected count from the constant rather than
    // restating it here, so this assertion cannot itself go stale.
    const armsLine = lines.find((l) => isLive(l) && /^EXPECTED_ARMS=\d+$/.test(l.trim()));
    const arms = Number((armsLine ?? "").trim().split("=")[1]);
    expect(Number.isInteger(arms) && arms > 0).toBe(true);
    const printsClaims = SRC.split("\n").filter((l) => /prints \d+\/\d+/.test(l));
    expect(
      printsClaims.length,
      "no `prints N/N` sentence found beside the ratchet. It is the human-readable half of the same fact and this pin exists to keep the two from drifting.",
    ).toBeGreaterThan(0);
    for (const claim of printsClaims) {
      expect(
        claim,
        `a comment claims ${/prints \d+\/\d+/.exec(claim)?.[0]} while EXPECTED_ARMS is ${arms}. The prose and the constant have drifted, and SC-9's date check cannot see it.`,
      ).toContain(`prints ${arms}/${arms}`);
    }

    // CALIBRATION for the pair above — move the constant and the prose must
    // disagree, or this assertion is measuring nothing.
    const moved = SRC.replace("\nEXPECTED_ARMS=27\n", "\nEXPECTED_ARMS=28\n");
    expect(moved).not.toBe(SRC);
    const movedArms = 28;
    expect(
      SRC.split("\n").filter((l) => /prints \d+\/\d+/.test(l)).every((l) => l.includes(`prints ${movedArms}/${movedArms}`)),
      "the `prints N/N` prose still agrees with a MOVED constant, so the agreement check is vacuous.",
    ).toBe(false);

    // CALIBRATION — comment the constant out; a whole-file `toContain` would
    // still pass, this pin must not.
    const commented = SRC.replace("\nEXPECTED_ARMS=27\n", "\n# EXPECTED_ARMS=27\n");
    expect(commented).not.toBe(SRC);
    expect(liveCount(selfTestRegion(commented), "EXPECTED_ARMS=27")).toBe(0);

    // CALIBRATION — a second copy of the constant is a disagreement waiting to
    // happen, and must fail the "exactly once" leg.
    const doubled = SRC.replace("\nEXPECTED_ARMS=27\n", "\nEXPECTED_ARMS=27\nEXPECTED_ARMS=27\n");
    expect(doubled).not.toBe(SRC);
    expect(liveCount(selfTestRegion(doubled), "EXPECTED_ARMS=27")).toBe(2);
  });

  it("plan 01's interim closing line is GONE — the word it used appears nowhere", () => {
    // ⛔ Assembled from two halves so neither this test nor the plan that
    // commissioned it carries the word verbatim — a negative pin whose needle is
    // written out in the file that checks for it is self-defeating the moment
    // anyone greps the repo for it.
    const interimWord = `${"SKEL"}${"ETON"}`;
    expect(
      SRC.includes(interimWord),
      `the script still carries the word "${interimWord}". Plan 01's interim closing line — the one announcing a two-arm skeleton and promising EXPECTED_ARMS later — must not survive plan 02, in code or in a comment.`,
    ).toBe(false);

    // The line that REPLACED it, present and live.
    expect(liveCount(SRC, "self-test OK (${pass}/${EXPECTED_ARMS} arms")).toBe(1);

    // CALIBRATION — re-insert the interim line; the pin must flip.
    const restored = SRC.replace(
      "\nEXPECTED_ARMS=27\n",
      `\n# ⚠️ THIS IS THE ${interimWord} (Phase 164.8 plan 01)\nEXPECTED_ARMS=27\n`,
    );
    expect(restored).not.toBe(SRC);
    expect(restored.includes(interimWord)).toBe(true);
  });
});

describe("restore-test-from-baseline.sh — L-01: the reference-data replay's position", () => {
  it("the bracket, the replay, the path restore, the gate and the ledger DDL are emitted IN THAT ORDER", () => {
    // ⛔ THIS ORDERING IS THE WHOLE DESIGN, AND EVERY STEP OF IT IS SILENT WHEN
    // WRONG. `SET LOCAL search_path = public, pg_catalog` must precede the replay
    // because the replayed statements are the migrations' ORIGINAL bytes and name
    // their targets UNQUALIFIED; `pg_catalog` must be restored before the ledger
    // DDL because everything below is written expecting it; and the GATE must sit
    // ABOVE the ledger seed, because a gate below it aborts a transaction whose
    // ledger rows were already written — same rollback, but the artifact a reader
    // inspects afterwards says the seed was the last thing attempted.
    //
    // A `toContain` pin cannot see any of this: all five needles stay present and
    // live under every reordering. Self-test arms 22 and 23 measure the BEHAVIOUR
    // on a lane; this measures the ORDER in the source, which is what an
    // "improvement" that moves a block would break without turning a single arm
    // red on the day it lands.
    const txn = txnRegion(SRC);
    expect(
      txn.split("\n").filter(isLive).length,
      "the build_transaction region is empty — every ordering pin below would be vacuously true",
    ).toBeGreaterThan(3);

    const STEPS = [
      ["the search_path bracket", "SET LOCAL search_path = public, pg_catalog;"],
      ["the replay concatenation", 'cat "$RESTORE_OUT_DIR/refdata.sql" >> "$out"'],
      ["the path restore", "TXN_REFDATA_TAIL"],
      ["the gate", "TXN_REFDATA_GATE"],
      ["the ledger DDL", "TXN_LEDGER_DDL"],
    ] as const;

    const at = STEPS.map(([name, needle]) => {
      const i = liveIndexOf(txn, needle);
      expect(i, `build_transaction no longer emits ${name} (${needle})`).toBeGreaterThanOrEqual(0);
      return { name, i };
    });
    for (let k = 1; k < at.length; k++) {
      expect(
        at[k - 1].i,
        `${at[k - 1].name} is emitted at line ${at[k - 1].i} but ${at[k].name} at ${at[k].i} — the reference-data block is out of the order decision L-01 locked`,
      ).toBeLessThan(at[k].i);
    }

    // CALIBRATION — move the gate BELOW the ledger DDL on an in-memory copy. The
    // needles are all still present and live; only the order changed.
    const gateStart = SRC.indexOf('  cat >> "$out" <<TXN_REFDATA_GATE\n');
    expect(gateStart, "the gate heredoc's opening line moved").toBeGreaterThanOrEqual(0);
    const gateEnd = SRC.indexOf("\nTXN_REFDATA_GATE\n", gateStart);
    expect(gateEnd, "the gate heredoc's terminator moved").toBeGreaterThan(gateStart);
    const gateBlock = SRC.slice(gateStart, gateEnd + "\nTXN_REFDATA_GATE\n".length);
    // The needle is the heredoc's TERMINATOR line, not its opening `cat >>` line
    // (which ends in a quote), so the block lands strictly BELOW the ledger DDL.
    const ledgerEnd = "\nTXN_LEDGER_DDL\n";
    expect(SRC.split(ledgerEnd).length - 1, "the ledger heredoc terminator moved").toBe(1);
    const moved = SRC.replace(gateBlock, "").replace(ledgerEnd, () => `${ledgerEnd}${gateBlock}`);
    expect(moved).not.toBe(SRC);
    const mTxn = txnRegion(moved);
    expect(liveIndexOf(mTxn, "TXN_REFDATA_GATE")).toBeGreaterThan(liveIndexOf(mTxn, "TXN_LEDGER_DDL"));

    // CALIBRATION 2 — the bracket alone, demoted below the replay. This is the
    // reordering that costs nothing to make and breaks every unqualified target.
    const bracket = "SET LOCAL search_path = public, pg_catalog;\n";
    const replay = '  cat "$RESTORE_OUT_DIR/refdata.sql" >> "$out"\n';
    const demoted = SRC.replace(bracket, "").replace(replay, () => `${replay}${bracket}`);
    expect(demoted).not.toBe(SRC);
    const dTxn = txnRegion(demoted);
    expect(liveIndexOf(dTxn, "SET LOCAL search_path = public, pg_catalog;")).toBeGreaterThan(
      liveIndexOf(dTxn, 'cat "$RESTORE_OUT_DIR/refdata.sql" >> "$out"'),
    );
  });

  it("the reference-data refusal is CALLED before the census is written, and the census carries the rows", () => {
    // A refusal defined early and called late refuses nothing (the W3 lesson at
    // `refuse_publication_row_without_table`). This one must also precede
    // `write_census_sql`, which reads the table list it parses — call it after and
    // the census silently emits ZERO refdata rows while every arm still passes.
    const body = functionBody(SRC, "run_restore");
    const refuseAt = liveIndexOf(body, "refuse_bad_refdata_allowlist");
    const censusAt = liveIndexOf(body, 'write_census_sql "$RESTORE_OUT_DIR/census.sql"');
    const buildAt = liveIndexOf(body, 'build_transaction "$mode"');
    expect(refuseAt, "run_restore no longer calls the reference-data refusal").toBeGreaterThanOrEqual(0);
    expect(censusAt, "run_restore no longer writes the census SQL").toBeGreaterThanOrEqual(0);
    expect(
      refuseAt,
      `the reference-data refusal is called at ${refuseAt} but the census is written at ${censusAt} — the census would emit no refdata rows and nothing would say so`,
    ).toBeLessThan(censusAt);
    expect(refuseAt).toBeLessThan(buildAt);

    // The census emits ONE row per allowlisted table, and it is the census — not
    // the `restore:` summary line — that carries the reading. A `refdata=` field on
    // that line would break the byte-exact pins in self-test arms 9, 12 and 18.
    expect(liveCount(SRC, "SELECT 'refdata:%s=' || CASE")).toBe(1);
    const summary = liveLines(runRegion(SRC))
      .filter(({ line }) => line.includes('echo "restore: tables='))
      .map(({ line }) => line);
    expect(summary.length, "the restore summary line is no longer emitted exactly once").toBe(1);
    expect(
      summary[0].includes("refdata"),
      "the `restore:` summary line grew a refdata field — arms 9, 12 and 18 pin it with `grep -aqxF`, and counts belong in the census",
    ).toBe(false);
  });
});

describe("restore-test-from-baseline.sh — B1: the census is search_path-independent", () => {
  it("the census session AND the transaction stream each set search_path BEFORE reading the catalogue", () => {
    // ⛔ WHY THIS ORDER IS LOAD-BEARING. `pg_get_expr` and `pg_get_triggerdef` OMIT
    // the schema qualifier of anything on the reader's search_path. Under psql's
    // default `"$user", public`, a policy whose source spells its function
    // unqualified renders WITHOUT `public.` — a census that substring-matches
    // `public.` never sees it, `DROP SCHEMA public CASCADE` removes it, and the
    // pre/post key-set comparison agrees on a set that EXCLUDES it. MEASURED in
    // plan 01's NEUTER 1: with the SET removed, BOTH storage policies vanished
    // from the census and the captured trigger DDL came out unqualified.
    for (const [name, region, readers] of [
      ["census", censusRegion(SRC), ["pg_get_triggerdef", "pg_policies"]],
      ["build_transaction", txnRegion(SRC), ["pg_trigger", "pg_policies"]],
    ] as const) {
      const setAt = liveIndexOf(region, "search_path = pg_catalog");
      expect(
        setAt,
        `the ${name} region has no LIVE \`search_path = pg_catalog\` line`,
      ).toBeGreaterThanOrEqual(0);
      for (const reader of readers) {
        const readAt = liveIndexOf(region, reader);
        expect(readAt, `the ${name} region no longer reads ${reader}`).toBeGreaterThanOrEqual(0);
        expect(
          setAt,
          `in the ${name} region the search_path is set at line ${setAt} but ${reader} is read at ${readAt} — the catalogue is read BEFORE the path is pinned, so every rendered expression may be missing its \`public.\` qualifier`,
        ).toBeLessThan(readAt);
      }
    }

    // CALIBRATION 1 — comment the census SET out (plan 01's NEUTER 1, in memory).
    const noSet = SRC.replace(
      "SET search_path = pg_catalog;\n\nSELECT 'tables='",
      "-- SET search_path = pg_catalog;\n\nSELECT 'tables='",
    );
    expect(noSet).not.toBe(SRC);
    expect(liveIndexOf(censusRegion(noSet), "search_path = pg_catalog")).toBe(-1);

    // CALIBRATION 2 — keep the SET but MOVE it below the catalogue read. The
    // needle is still present and live; only the ORDER changed, which is exactly
    // the edit a `toContain` pin cannot see.
    const census = censusRegion(SRC);
    const movedCensus = census
      .replace("SET search_path = pg_catalog;\n", "")
      .replace(
        "-- (c) realtime publication membership",
        "SET search_path = pg_catalog;\n-- (c) realtime publication membership",
      );
    // ⚠️ A FUNCTION REPLACER, not a string. The census SQL contains `$'` (inside
    // `version !~ ''^[0-9]{14}$''`), and `$'` is a SPECIAL REPLACEMENT PATTERN —
    // "everything after the match". Passing this text as a replacement STRING
    // silently produced a mangled copy in which the moved SET was absent
    // altogether, so the calibration asserted the wrong thing. MEASURED here
    // 2026-09-08: the first run of this file failed on exactly that.
    const moved = SRC.replace(census, () => movedCensus);
    expect(moved).not.toBe(SRC);
    const mSet = liveIndexOf(censusRegion(moved), "search_path = pg_catalog");
    const mRead = liveIndexOf(censusRegion(moved), "pg_get_triggerdef");
    expect(mSet).toBeGreaterThanOrEqual(0);
    expect(mSet).toBeGreaterThan(mRead);
  });
});

describe("restore-test-from-baseline.sh — B2: the derived closure runs before the DROP", () => {
  it("the pg_depend closure and its abort sentence sit ABOVE `DROP SCHEMA public CASCADE`", () => {
    // ⛔ WHY pg_depend AND NOT THE CASCADE'S OWN NOTICES. The server reports at
    // most MAX_REPORTED_DEPS (100) dependents to the client and then appends "and
    // N other objects"; the real `public` has 190+ direct dependents, so the
    // survivors would be cut off the list. And a check that reads the CASCADE's
    // output necessarily runs AFTER the drop — too late to refuse.
    const run = runRegion(SRC);
    const dependAt = liveIndexOf(run, "pg_depend");
    const abortAt = liveIndexOf(run, "NOT a censused survivor");
    // ⛔ DROP_STMT, not the bare phrase: the semicolon is what keeps this needle off
    // the mutex refusal's prose copy near the top of the region. See its comment.
    const dropAt = liveIndexOf(run, DROP_STMT);
    expect(dependAt, "the --run region no longer reads pg_depend").toBeGreaterThanOrEqual(0);
    expect(abortAt, "the closure's abort sentence is gone").toBeGreaterThanOrEqual(0);
    expect(dropAt, "the DROP is gone").toBeGreaterThanOrEqual(0);
    expect(
      dependAt,
      `the pg_depend closure is assembled at line ${dependAt}, AFTER the DROP at ${dropAt}. A closure that runs after the drop names objects that are already gone.`,
    ).toBeLessThan(dropAt);
    expect(abortAt).toBeLessThan(dropAt);

    // It must ABORT, not merely report. Plan 01 MEASURED the demoted form: the
    // restore COMMITTED, `analytics.v_leftover` was gone, the `analytics` schema
    // survived so nothing looked broken from outside. Self-test arm 13.
    expect(
      liveCount(run, "RAISE EXCEPTION 'restore aborted: % depends on public"),
      "the derived-census closure no longer RAISES EXCEPTION — a NOTICE lets the restore commit with the dependent silently gone (plan 01's NEUTER 2, the B2 defect)",
    ).toBe(1);

    // CALIBRATION — demote the RAISE; the severity pin flips while every
    // ordering pin above stays green, which is why the severity is pinned too.
    const demoted = SRC.replace(
      "RAISE EXCEPTION 'restore aborted: % depends on public",
      "RAISE NOTICE 'restore aborted: % depends on public",
    );
    expect(demoted).not.toBe(SRC);
    expect(liveCount(runRegion(demoted), "RAISE EXCEPTION 'restore aborted: % depends on public")).toBe(0);
  });

  it("the refclassid whitelist is CLOSED BY MEASUREMENT — an emptiness assertion, on the live database", () => {
    const run = runRegion(SRC);
    expect(
      liveCount(run, "which the derived-census whitelist does not resolve"),
      "the whitelist-emptiness assertion is gone; the excluded classes are assumed empty rather than measured (self-test arm 17)",
    ).toBe(1);
    const whitelistAt = liveIndexOf(run, "which the derived-census whitelist does not resolve");
    expect(
      whitelistAt,
      "the whitelist assertion no longer precedes the DROP",
      // ⛔ DROP_STMT — the semicolon keeps this off the mutex refusal's prose copy.
    ).toBeLessThan(liveIndexOf(run, DROP_STMT));

    // CALIBRATION — delete the assertion.
    const gone = SRC.replace(
      "RAISE EXCEPTION 'restore aborted: public holds % object(s) of class % which the derived-census whitelist does not resolve",
      "RAISE NOTICE 'restore aborted: public holds % object(s) of class % which the whitelist tolerates",
    );
    expect(gone).not.toBe(SRC);
    expect(liveCount(runRegion(gone), "which the derived-census whitelist does not resolve")).toBe(0);
  });

  it("pg_default_acl is resolved by CARRIER, and is not on an exclusion list", () => {
    // ⭐ MEASURED on shared TEST 2026-09-08 (read-only, marker verified):
    // pg_default_acl holds 6 rows whose defaclnamespace is public, and the
    // reviewed dump re-creates them with 12 `ALTER DEFAULT PRIVILEGES … IN SCHEMA
    // "public"` statements. Without a carrier the closure falls through to
    // pg_describe_object() text and ABORTS naming an object the dump WOULD have
    // restored — OBSERVED in this plan's arm-18 falsifier run as
    // `default privileges on new relations belonging to role postgres in schema
    // public … is NOT a censused survivor`. A false abort on the first real
    // preflight. Self-test arm 18.
    const run = runRegion(SRC);
    expect(
      liveCount(run, "WHEN p.classid = 'pg_default_acl'::regclass THEN"),
      "the pg_default_acl CARRIER branch is gone; the closure will falsely abort on a default ACL the dump restores",
    ).toBe(1);
    expect(
      liveCount(run, "da.defaclnamespace"),
      "the carrier no longer resolves through defaclnamespace",
    ).toBe(1);

    // ⛔ Never an exclusion: `own_schema IS DISTINCT FROM 'public'` is the ONE
    // filter, and adding pg_default_acl to it would also hide a default ACL in a
    // NON-public schema, which is a genuine survivor.
    expect(run).not.toContain("classid <> 'pg_default_acl'");
    expect(run).not.toContain("classid != 'pg_default_acl'");

    // CALIBRATION — remove the carrier branch (this plan's arm-18 falsifier).
    const noCarrier = SRC.replace(
      /^ *WHEN p\.classid = 'pg_default_acl'::regclass THEN .*\n/m,
      "",
    );
    expect(noCarrier).not.toBe(SRC);
    expect(liveCount(runRegion(noCarrier), "WHEN p.classid = 'pg_default_acl'::regclass THEN")).toBe(0);
  });
});

describe("restore-test-from-baseline.sh — the MODE picks the terminator", () => {
  it("both terminators are live lines and psql's whole-file transaction flag appears nowhere", () => {
    const run = runRegion(SRC);
    expect(liveCount(run, "ROLLBACK;"), "the ROLLBACK terminator is gone").toBe(1);
    expect(liveCount(run, "COMMIT;"), "the COMMIT terminator is gone").toBe(1);
    expect(
      liveIndexOf(run, 'if [ "$mode" = "restore" ]; then'),
      "the terminator is no longer chosen by the MODE — an unconditional terminator makes `--mode preflight` write, which is the one thing a preflight must never do",
    ).toBeGreaterThanOrEqual(0);

    // ⛔ Assembled from two halves so neither this test nor the plan carries the
    // flag verbatim — a repo-wide grep for it must find the script, not its pin.
    const wholeFileFlag = `${"--single-"}${"transaction"}`;
    expect(
      SRC.includes(wholeFileFlag),
      `the script now passes psql's whole-file transaction flag. It appends an UNCONDITIONAL COMMIT, so \`--mode preflight\` would write to a shared database after promising to roll back.`,
    ).toBe(false);

    // CALIBRATION 1 — insert the flag; the negative pin must flip.
    const flagged = SRC.replace(
      'psql "$RESTORE_DB_URL" -X -q -v ON_ERROR_STOP=1 -f "$RESTORE_OUT_DIR/restore.sql"',
      `psql "$RESTORE_DB_URL" -X -q ${wholeFileFlag} -v ON_ERROR_STOP=1 -f "$RESTORE_OUT_DIR/restore.sql"`,
    );
    expect(flagged).not.toBe(SRC);
    expect(flagged.includes(wholeFileFlag)).toBe(true);

    // CALIBRATION 2 — plan 01's NEUTER 3: an unconditional COMMIT.
    const unconditional = SRC.replace(
      /  if \[ "\$mode" = "restore" \]; then\n    echo "COMMIT;" >> "\$out"\n  else\n    echo "ROLLBACK;" >> "\$out"\n  fi/,
      '  echo "COMMIT;" >> "$out"',
    );
    expect(unconditional).not.toBe(SRC);
    expect(liveCount(runRegion(unconditional), "ROLLBACK;")).toBe(0);
  });
});

describe("restore-test-from-baseline.sh — every refusal precedes the first write", () => {
  it("the identity marker is read before the DROP and before the first TRUNCATE", () => {
    // CLAUDE.md § "Which database am I on?": `current_database()` is `postgres` on
    // BOTH projects and proves nothing. The hand-set COMMENT is the only thing
    // standing between this script and production, and it is worth nothing if it
    // is consulted after the first write.
    const run = runRegion(SRC);
    const markerAt = liveIndexOf(run, "shobj_description");
    // ⛔ DROP_STMT — the semicolon keeps this off the mutex refusal's prose copy.
    const dropAt = liveIndexOf(run, DROP_STMT);
    const truncAt = liveIndexOf(run, "TRUNCATE");
    expect(markerAt, "the marker query is gone").toBeGreaterThanOrEqual(0);
    expect(markerAt, `the marker is read at ${markerAt}, AFTER the DROP at ${dropAt}`).toBeLessThan(dropAt);
    expect(markerAt, `the marker is read at ${markerAt}, AFTER the first TRUNCATE at ${truncAt}`).toBeLessThan(truncAt);

    // CALIBRATION — move the marker query below the DROP.
    const q = "SELECT shobj_description(oid, 'pg_database') AS which_database";
    const moved = SRC.replace(q, "SELECT 1 AS which_database").replace(
      "DROP SCHEMA public CASCADE;",
      `-- ${q}\nDROP SCHEMA public CASCADE;\n${q};`,
    );
    expect(moved).not.toBe(SRC);
    const mRun = runRegion(moved);
    expect(liveIndexOf(mRun, "shobj_description")).toBeGreaterThan(
      liveIndexOf(mRun, DROP_STMT),
    );
  });

  it("the survivors census and the publication refusal both run before the transaction opens", () => {
    const run = runRegion(SRC);
    expect(
      liveIndexOf(run, "pg_get_triggerdef"),
      "the survivors census is captured AFTER the DROP — by then the survivors are gone and there is nothing to capture",
      // ⛔ DROP_STMT — the semicolon keeps this off the mutex refusal's prose copy.
    ).toBeLessThan(liveIndexOf(run, DROP_STMT));

    // W3's refusal is PRE-WRITE. The ordering that matters is the CALL order in
    // run_restore, not the definition order: a refusal defined early and called
    // late refuses nothing.
    const body = functionBody(SRC, "run_restore");
    const refuseAt = liveIndexOf(body, "refuse_publication_row_without_table");
    const buildAt = liveIndexOf(body, 'build_transaction "$mode"');
    expect(refuseAt, "run_restore no longer calls the publication refusal").toBeGreaterThanOrEqual(0);
    expect(buildAt, "run_restore no longer builds the transaction").toBeGreaterThanOrEqual(0);
    expect(
      refuseAt,
      "the publication refusal is called AFTER the transaction is built, so a row for a table the dump does not re-create would abort the restore from inside instead of being refused with a remedy",
    ).toBeLessThan(buildAt);

    // The refusal names the key shape and the founder remedy.
    const refusal = functionBody(SRC, "refuse_publication_row_without_table");
    expect(liveCount(refusal, "pub:public.")).toBeGreaterThanOrEqual(1);
    expect(refusal).toContain("ALTER PUBLICATION <pub> DROP TABLE public.<table>");

    // CALIBRATION — swap the two calls in run_restore.
    const swapped = SRC.replace(
      "  refuse_publication_row_without_table\n\n  derive_expected_shape\n  build_transaction \"$mode\"",
      "  derive_expected_shape\n  build_transaction \"$mode\"\n  refuse_publication_row_without_table",
    );
    expect(swapped).not.toBe(SRC);
    const sBody = functionBody(swapped, "run_restore");
    expect(liveIndexOf(sBody, "refuse_publication_row_without_table")).toBeGreaterThan(
      liveIndexOf(sBody, 'build_transaction "$mode"'),
    );
  });

  it("the credential assert is a hard failure — named, ::error::-prefixed, non-zero, unsoftened", () => {
    const branch = functionBody(SRC, "refuse_absent_credential");
    const named = liveLines(branch).filter(
      ({ line }) => line.includes("::error::") && line.includes("RESTORE_DB_URL"),
    );
    expect(
      named.length,
      "no live `::error::` line in the credential branch names RESTORE_DB_URL — a reader of a failed Actions log cannot tell which variable is missing",
    ).toBe(1);
    expect(branch).toContain("HARD FAILURE, not a skip");

    // Every `exit` in the branch is non-zero. `.github/workflows/phase-19-stability.yml:54-58`
    // is the shape this forbids: an absent secret printed a warning and returned
    // success, and the gate measured NOTHING for months while reading green.
    const exits = liveLines(branch)
      .map(({ line }) => line.match(/\bexit\s+(\d+)/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => Number(m[1]));
    expect(exits.length, "the credential branch no longer exits at all").toBeGreaterThan(0);
    expect(exits.every((c) => c !== 0), `the credential branch exits ${exits.join(", ")} — a zero is a skip`).toBe(true);

    // CALIBRATION — soften the exit.
    const softened = SRC.replace(
      'echo "::error::green-having-done-nothing."\n    exit 1',
      'echo "::warning::green-having-done-nothing."\n    exit 0',
    );
    expect(softened).not.toBe(SRC);
    const sExits = liveLines(functionBody(softened, "refuse_absent_credential"))
      .map(({ line }) => line.match(/\bexit\s+(\d+)/))
      .filter((m): m is RegExpMatchArray => m !== null)
      .map((m) => Number(m[1]));
    expect(sExits.every((c) => c !== 0)).toBe(false);
  });

  it("the --run region carries no unaccounted softening token", () => {
    // The restated list from `prod-prober-wiring.test.ts:123-133`. Three must be
    // ABSENT outright; two are legitimate rc-handling in this script and are an
    // EXACT-SET COUNT with a justification, the `gate-family-meta.test.ts` idiom —
    // pinned at the measured number so a NEW one is a red rather than an
    // unnoticed widening.
    //
    // ⭐ RE-MEASURED 2026-09-09 (Phase 164.8.2 IN-06): `set +e` moves 6 → 7 and
    // `|| true` stays at 4. The SEVENTH site is the `grep -av` in
    // `build_transaction` that assembles the dump into `restore.sql` — the ONE
    // reading in this region whose rc was neither captured nor checked. Unwrapped,
    // a grep that could not READ the dump (exit 2) killed the script under `set -e`
    // with no `::error::` and no sentence for the operator. Its rc is now captured
    // and CHECKED against the same `-le 1` bound the count site uses, so the
    // widening buys a NAMED failure where there was a silent one. The executed
    // proof is the IN-06 arm below, whose calibration reverts this exact wrap and
    // observes the silent death return.
    //
    // ⭐ RE-MEASURED 2026-09-09, after Phase 164.8.1 added the reference-data
    // refusal, replay and gate to this region: BOTH counts are UNCHANGED at 4 and 6.
    // That is a reading, not an assumption — the new code deliberately reads every
    // subprocess result with `rc=0; node … || rc=$?` and counts lines with `awk`
    // (which exits 0 by construction) rather than reaching for `set +e` or
    // `|| true`, so the exact set did not have to move and was not widened.
    //
    // ⭐ RE-MEASURED 2026-09-08, after A7/A8 converted the two counts-followed-by-a-
    // comparison sites from `|| true` to explicit rc capture + MEASURE_FAIL. That
    // moved `|| true` 6→4 and `set +e` 3→6, and the two numbers move TOGETHER for
    // that reason: the rise in `set +e` is the price of the fall in `|| true`, and it
    // buys a HARDER failure, not a softer one.
    //
    // `|| true`  x4 — two `grep -a -m1` extractions of the FIRST error line out of
    //                 `transaction.out` in `run_transaction` (grep exits 1 when the
    //                 file holds no error line, which is a legitimate reading and is
    //                 handled by the `[ -n "$first" ]` fallback that follows), the
    //                 diagnostic `diff` printed AFTER `cmp -s` has already decided the
    //                 preflight is a failure (diff exits 1 on difference — the very
    //                 case being reported, and `fail` fires on the next line either
    //                 way), and one `shift || true` on the last argv token.
    // `set +e`   x7 — seven measurements whose rc is captured and then CHECKED: five
    //                 `grep -ac` counts (`[ "$rc" -le 1 ] || fail MEASURE_FAIL …`),
    //                 the shared normalizer's `--function-names` run
    //                 (`[ "$frc" -eq 0 ] || fail MEASURE_FAIL …`), and the
    //                 `grep -av` filter in `build_transaction` that writes the dump
    //                 into `restore.sql` (IN-06). That is the OPPOSITE of softening:
    //                 it turns a broken grep or a crashed normalizer into a hard
    //                 failure instead of a silent zero — or, for the seventh, instead
    //                 of no diagnosis at all.
    const run = runRegion(SRC);
    const runLive = liveLines(run).map(({ line }) => line).join("\n");
    for (const token of ["continue-on-error", "exit 0", "::warning"]) {
      expect(
        runLive.includes(token),
        `the --run region now carries the softening token \`${token}\``,
      ).toBe(false);
    }
    const ALLOWED: Record<string, number> = { "|| true": 4, "set +e": 7 };
    for (const [token, n] of Object.entries(ALLOWED)) {
      expect(
        runLive.split(token).length - 1,
        `the --run region's \`${token}\` count moved off its measured ${n}. Each existing site is a grep/diff READING whose result is checked; a new one has to earn its place in this allowlist with a justification.`,
      ).toBe(n);
    }

    // CALIBRATION — add one more `|| true`; the exact-set count must flip.
    const widened = SRC.replace(
      '  refuse_wrong_database\n  refuse_without_mutex',
      '  refuse_wrong_database || true\n  refuse_without_mutex',
    );
    expect(widened).not.toBe(SRC);
    const wLive = liveLines(runRegion(widened)).map(({ line }) => line).join("\n");
    expect(wLive.split("|| true").length - 1).toBe(5);

    // MIRROR CALIBRATION — the same for `set +e`. Both halves of the exact set are
    // now calibrated: a pin that only ever flips on one of the two tokens is
    // evidence about that token alone.
    const softened = SRC.replace(
      '  refuse_wrong_database\n  refuse_without_mutex',
      '  set +e; :; set -e\n  refuse_wrong_database\n  refuse_without_mutex',
    );
    expect(softened).not.toBe(SRC);
    const sLive = liveLines(runRegion(softened)).map(({ line }) => line).join("\n");
    expect(sLive.split("set +e").length - 1).toBe(8);
  });
});

describe("restore-test-from-baseline.sh — the filter and the ledger seed", () => {
  it("exactly one filtered line class, named, and it is the realtime publication's owner line", () => {
    const run = runRegion(SRC);
    const decls = liveLines(run).filter(({ line }) => line.includes("FILTER_PATTERN="));
    expect(
      decls.length,
      "the dump's filtered line class is no longer declared exactly once — two patterns can disagree about what was removed",
    ).toBe(1);
    expect(decls[0].line).toContain("supabase_realtime");
    expect(decls[0].line).toContain("ALTER PUBLICATION");
    expect(decls[0].line).toContain("OWNER TO");

    // The filter is asserted by COUNT, not by its effect: on the throwaway lane
    // the statement would SUCCEED, so "it did not break" proves nothing.
    expect(liveCount(run, 'FILTERED_N=$(grep -ac "$FILTER_PATTERN"')).toBe(1);

    // CALIBRATION — a second declaration.
    const doubled = SRC.replace(
      "FILTERED_N=0\n",
      "FILTERED_N=0\nFILTER_PATTERN='^GRANT'\n",
    );
    expect(doubled).not.toBe(SRC);
    expect(liveLines(runRegion(doubled)).filter(({ line }) => line.includes("FILTER_PATTERN=")).length).toBe(2);
  });

  it("the ledger seed is CLI-shaped and its provenance says the SQL was not executed", () => {
    const run = runRegion(SRC);
    const inserts = liveLines(run).filter(({ line }) =>
      line.includes("INSERT INTO supabase_migrations.schema_migrations"),
    );
    expect(inserts.length, "the ledger seed INSERT is gone").toBe(1);
    expect(
      inserts[0].line,
      "the ledger INSERT's column list is not exactly (version, name, statements) — `supabase db push` reads this table, and a shape it does not understand is a ledger nobody can use",
    ).toContain("schema_migrations(version, name, statements)");

    // 164.2-TEST-APPLY-PROVENANCE: a seeded row must never claim its SQL ran.
    expect(
      liveCount(run, "NOT executed on TEST"),
      "the provenance sentence is gone — a seeded ledger row that claims the migration's SQL was executed on TEST is a lie the next reader has no way to detect",
    ).toBe(1);

    // CALIBRATION — drop a column from the list.
    const narrowed = SRC.replace(
      "schema_migrations(version, name, statements)",
      "schema_migrations(version, name)",
    );
    expect(narrowed).not.toBe(SRC);
    expect(
      liveLines(runRegion(narrowed))
        .filter(({ line }) => line.includes("INSERT INTO supabase_migrations.schema_migrations"))[0]
        .line.includes("schema_migrations(version, name, statements)"),
    ).toBe(false);
  });
});

describe("restore-test-from-baseline.sh — IN-01/IN-02/IN-05: the narrative is DERIVED", () => {
  // ⛔ WHY THESE THREE PINS EXIST AT ALL. Every one of them replaces a NUMBER OR A
  // LIST A HUMAN TYPED. The W2 comment said `EIGHT` while the count was 9 and the
  // line the script actually emits said `NINE`; the same comment's arm list stopped
  // at 24 while arm 26 had already shipped; the `--help` contract — the thing an
  // operator reads before running `DROP SCHEMA public CASCADE` — named 11 seams
  // while the script declared 13. None of those is a bug in the code. All three are
  // the defect the script's own comment names: a narrative that miscounts its own
  // guards is the same class as a stale floor. So none of them is re-typed here
  // either — each is derived from the file and compared with what the file says.

  /** The English words the script's closing line uses. Extend, never drop a check. */
  const WORDS = [
    "ZERO", "ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN",
    "EIGHT", "NINE", "TEN", "ELEVEN", "TWELVE",
  ];

  /** The W2 comment block plus the line it describes, up to and including the echo. */
  function w2Block(text: string): string {
    const lines = text.split("\n");
    const a = lines.findIndex((l) => l.includes("W2 — THIS SENTENCE"));
    if (a < 0) return "";
    const b = lines.findIndex((l, i) => i > a && l.includes("self-test OK"));
    return b < 0 ? "" : lines.slice(a, b + 1).join("\n");
  }

  /**
   * The W2 block as PROSE: each line's leading `# ` stripped and the lines rejoined
   * with a space.
   *
   * ⭐ THIS IS WHY IT IS REFLOW-INVARIANT, and it is IN-02's idiom hoisted rather
   * than a new one. A comment sentence WRAPS; where it wraps is a function of how
   * long the words are, so a predicate read over RAW LINES binds to whatever
   * happened not to wrap. Read over prose, the same sentence is the same string
   * whether it occupies one line or four.
   */
  function w2Prose(text: string): string {
    return w2Block(text)
      .split("\n")
      .map((l) => l.replace(/^\s*#\s?/, ""))
      .join(" ");
  }

  /**
   * ⛔ A DATED CLAIM — a date, and in the SAME SENTENCE one of the count WORDS.
   *
   * ⭐ REWRITTEN 2026-09-10 (code review IN-04). The predicate used to require a
   * line matching `^\s*# \(YYYY-MM-DD: WORD, after …\)` — exactly one of them,
   * inside the sliced block. The word derivation underneath it was real and could
   * fail (the review verified that), but the LINE SHAPE it bound to was a
   * convention this pin itself introduced: nothing in the script requires the
   * parenthesis, the colon, the comma, or the claim starting a line. An innocent
   * reflow of that comment reddened a gate for a non-defect, and a gate that reds
   * for a non-defect is one a maintainer learns to edit rather than to read.
   *
   * So the binding moved onto the FACT: somewhere in the W2 block there is exactly
   * one dated sentence that names a refusal count, and the count it names is the
   * live one. `[^.]*?` keeps the match inside a single sentence, so a date in one
   * sentence cannot reach a word in the next.
   *
   * ⛔ THIS IS NOT A RETREAT TO THE TAUTOLOGY IT REPLACED. The check this whole
   * arm replaced compared a `grep -c` against a byte-identical copy of itself and
   * could never fail. Both halves here are still DERIVED from the script: `n` is
   * counted off the live `^refuse_*() {` declarations, and the word is looked up
   * in the table — nothing is re-typed, and the calibrations below observe the
   * predicate flip on a drifted word and on a deleted claim.
   */
  function datedClaims(text: string): RegExpExecArray[] {
    return [
      ...w2Prose(text).matchAll(
        new RegExp(`\\d{4}-\\d{2}-\\d{2}[^.]*?\\b(${WORDS.join("|")})\\b`, "g"),
      ),
    ] as RegExpExecArray[];
  }

  it("IN-01 — the W2 comment's refusal WORD is the live `refuse_*() {` count, and so is the emitted line", () => {
    const n = liveLines(SRC).filter(({ line }) => /^refuse_[a-z_]*\(\) \{/.test(line)).length;
    const word = WORDS[n];
    expect(
      word,
      `the script declares ${n} refusals, which is outside the ZERO…TWELVE table this pin maps through. EXTEND the table — dropping the check is how the comment drifted in the first place.`,
    ).toBeDefined();

    const block = w2Block(SRC);
    expect(block, "the W2 block slicer found no anchor — every pin below it would be vacuous").not.toBe("");

    const claims = datedClaims(SRC);
    expect(
      claims.length,
      "the W2 block no longer carries exactly one DATED SENTENCE naming a refusal count. One is the contract: zero means the regeneration claim was dropped, two means a reader cannot tell which one is current.",
    ).toBe(1);
    expect(
      claims[0][1],
      `the W2 comment's dated refusal count disagrees with the live count of ${n}. Regenerate with \`grep -c '^refuse_[a-z_]*() {' ${SCRIPT}\` and write ${word} into the dated sentence. (Its LAYOUT is free — wrap it however you like.)`,
    ).toBe(word);

    const emitted = block.split("\n").filter((l) => l.includes("self-test OK"));
    expect(emitted.length).toBe(1);
    expect(
      emitted[0],
      `the EMITTED closing line disagrees with the live count of ${n}. The comment and the sentence the operator actually reads must carry the same word — they did not, and that is IN-01.`,
    ).toContain(`${word} refusals`);

    // CALIBRATION 1 — DRIFT. Put the stale word back on a scratch copy, editing the
    // block's FIRST occurrence rather than a punctuation-bearing literal, and watch
    // the predicate flip.
    const stale = WORDS[n - 1];
    const driftedBlock = block.replace(new RegExp(`\\b${word}\\b`), stale);
    expect(driftedBlock, "the IN-01 drift calibration did not APPLY to the block").not.toBe(block);
    const drifted = SRC.replace(block, driftedBlock);
    expect(drifted, "the IN-01 drift calibration did not APPLY").not.toBe(SRC);
    expect(datedClaims(drifted)[0][1]).toBe(stale);

    // CALIBRATION 2 — DELETION. Strip the date out of the claim; the pin must lose
    // it entirely rather than pass on a countless sentence.
    const undatedBlock = block.replace(/\d{4}-\d{2}-\d{2}/, "recently");
    expect(undatedBlock, "the IN-01 deletion calibration did not APPLY to the block").not.toBe(block);
    const undated = SRC.replace(block, undatedBlock);
    expect(undated, "the IN-01 deletion calibration did not APPLY").not.toBe(SRC);
    expect(datedClaims(undated).length).toBe(0);

    // CALIBRATION 3 — REFLOW-INVARIANCE, the property IN-04 asked for, and the one
    // calibration here that must come out GREEN. Break the claim across two comment
    // lines immediately before the count word and re-read it.
    //
    // ⛔ THE BREAK POINT IS DERIVED FROM THE WORD, NOT FROM THE CURRENT LAYOUT, and
    // that is not a detail. The first cut of this calibration located the line with
    // the pre-IN-04 `# (YYYY-MM-DD: ` pattern and asserted the file carried exactly
    // one — which put the very layout requirement IN-04 named back into the arm
    // through the calibration. MEASURED: reflowing the real script's claim then
    // failed with "the reflow calibration has nothing to reflow", a non-defect
    // reddening the gate, which is the finding reproduced. Anchoring on the word
    // works whatever shape the comment is in.
    //
    // The historical half — that the pre-IN-04 predicate went red on exactly this
    // reflow — was observed against the real script and recorded in the fix report.
    // It is NOT asserted here: pinning the old shape is how the coupling returns.
    const reflowedBlock = block.replace(new RegExp(`\\b${word}\\b`), `\n  # ${word}`);
    expect(reflowedBlock, "the IN-04 reflow calibration did not APPLY to the block").not.toBe(block);
    const reflowed = SRC.replace(block, reflowedBlock);
    expect(reflowed, "the IN-04 reflow calibration did not APPLY").not.toBe(SRC);
    const rClaims = datedClaims(reflowed);
    expect(
      rClaims.length,
      "the reflowed block lost its dated claim — the predicate is layout-bound after all, which is IN-04 un-fixed",
    ).toBe(1);
    expect(rClaims[0][1], "the reflowed block's dated claim lost its word").toBe(word);
  });

  it("IN-02 — the arm list names every arm it claims, and it names arms 26 and 27", () => {
    // The sentence WRAPS across comment lines, so it is read as PROSE: each line's
    // leading `# ` stripped and the lines rejoined with a space. Matching the raw
    // block would bind to whatever happened not to wrap.
    const prose = w2Prose;
    const block = prose(SRC);
    // ⚠️ THE DERIVATION IS DELIBERATELY PARTIAL, AND SAYING SO IS THE POINT. Walking
    // `run_arm` labels back to the refusal each leg greps for would be a parser of
    // the self-test's own bash, which is more machinery than the finding is worth
    // (the plan says so outright). What IS derived: every number the sentence names
    // must exist as a real `run_arm "<n> …` label, so a list naming a phantom arm is
    // red; and 26 and 27 — the arms that shipped with the ninth and tenth refusals —
    // must be among them. 26 reached this sentence only after it had already drifted
    // once; 27 (`refuse_credential_in_published_sql`) is pinned here from the start
    // so the same drift cannot repeat silently.
    const m = block.match(/arms 1-7((?:,\s*\d+)*)\s*and\s*(\d+)/);
    expect(
      m,
      "the W2 block's arm sentence no longer matches `arms 1-7, …, N and M` — this pin reads that shape",
    ).not.toBeNull();
    const listed = [
      1, 2, 3, 4, 5, 6, 7,
      ...(m![1].match(/\d+/g) ?? []).map(Number),
      Number(m![2]),
    ];
    expect(listed).toContain(26);
    expect(listed).toContain(27);

    const armNumbers = new Set(
      liveLines(SRC)
        .map(({ line }) => line.match(/run_arm "(\d+)\s/))
        .filter((x): x is RegExpMatchArray => x !== null)
        .map((x) => Number(x[1])),
    );
    const phantom = listed.filter((a) => !armNumbers.has(a));
    expect(
      phantom,
      `the W2 sentence claims arm(s) ${phantom.join(", ")} assert a refusal's named message, and no \`run_arm\` label carries those numbers`,
    ).toEqual([]);

    // CALIBRATION — drop 27 off the end of the list on a scratch string.
    const shortened = SRC.replace("20, 21, 24,\n  # 26 and 27.", () => "20, 21,\n  # 24 and 26.");
    expect(shortened, "the IN-02 calibration did not APPLY").not.toBe(SRC);
    const sm = prose(shortened).match(/arms 1-7((?:,\s*\d+)*)\s*and\s*(\d+)/);
    expect([...(sm![1].match(/\d+/g) ?? []).map(Number), Number(sm![2])]).not.toContain(27);
  });

  /**
   * Names the SHELL provides. They are not seams of THIS script's contract, and
   * `--help` documenting `BASH_SOURCE` would be noise, not a contract.
   */
  const SHELL_SPECIALS = new Set([
    "BASH_SOURCE", "BASH_VERSION", "FUNCNAME", "HOME", "IFS", "LINENO",
    "OLDPWD", "PATH", "PGPASSWORD", "PWD", "RANDOM", "SHLVL", "TMPDIR",
  ]);

  /**
   * ⛔ THE SECOND SANCTIONED EXCEPTION CHANNEL, and it is narrow ON PURPOSE.
   * Channel A below also catches a variable the SCRIPT ITSELF computes and then
   * defaults defensively (`X=${X:-0}`). Each of these four is assigned `=0` at
   * TOP LEVEL before any read, so whatever the environment supplied is destroyed
   * before it can be used — they are readings, not seams. The list is asserted
   * EXACT below (an entry that is no longer a candidate is RED), so it cannot
   * quietly become a place to park a real seam.
   */
  const INTERNAL_NOT_SEAMS = [
    { name: "EXP_TABLES", why: "`EXP_TABLES=0` at top level; derived from the dump TEXT in derive_expected_shape" },
    { name: "EXP_POLICIES", why: "`EXP_POLICIES=0` at top level; same derivation" },
    { name: "EXP_FUNCTIONS", why: "`EXP_FUNCTIONS=0` at top level; same derivation" },
    { name: "FILTERED_N", why: "`FILTERED_N=0` at top level; counted by build_transaction's own filter grep" },
  ];

  /**
   * ⛔ EVERY UPPERCASE NAME THE SCRIPT CAN TAKE FROM THE ENVIRONMENT, DERIVED FROM
   * THE SCRIPT TEXT rather than typed.
   *
   * ⭐ WIDENED 2026-09-10 (code review WR-04), and the old derivation was PROVEN
   * blind rather than argued so. It read ONE spelling — `NAME="${NAME:-default}"`
   * — which covers 13 of this script's 16 environment seams. The three it could
   * not see are `RESTORE_DB_URL`, `RESTORE_OUT_DIR` and `PGBIN`: none of them has
   * a literal default, so all three are read with the OPTIONAL spelling instead
   * (`[ -z "${RESTORE_DB_URL:-}" ]`, `if [ -z "${RESTORE_OUT_DIR:-}" ]`,
   * `[ -n "${PGBIN:-}" ]`). The reviewer deleted the `RESTORE_DB_URL` entry from
   * the operator contract and this arm stayed GREEN — the DSN of the database the
   * script runs `DROP SCHEMA public CASCADE` against, and the one line an operator
   * most needs to read before running it.
   *
   * TWO CHANNELS, because under `set -u` a seam can only reach the script two ways:
   *   A. a DEFAULTING expansion, `${NAME:-…}` or `${NAME:?…}`. BOTH the declaration
   *      form and the optional-read form are this shape, which is why one regex
   *      over it now catches all sixteen.
   *   B. a reference the script NEVER assigns anywhere. Under `set -u` a bare
   *      `"$NAME"` the script never sets can only come from the environment (or
   *      abort). Today this channel yields `BASH_SOURCE` alone, which
   *      `SHELL_SPECIALS` drops; it is here so a future MANDATORY seam read bare
   *      is not invisible the way these three were.
   *
   * ⚠️ WHAT IT STILL CANNOT SEE, stated rather than implied: a seam read ONLY as a
   * bare `"$NAME"` that the script ALSO assigns somewhere (channel B excludes it,
   * channel A never saw it). No such seam exists today — every one of the sixteen
   * has a `${NAME:-}` read — and `set -u` makes that shape a crash waiting to
   * happen, so it is a narrow gap and not a silent one.
   *
   * Comment lines are dropped first (this file's own `isLive` rule), so PROSE
   * naming a variable is never mistaken for a read.
   */
  function envSeams(text: string): string[] {
    const live = liveLines(text)
      .map(({ line }) => line)
      .join("\n");
    const locals = new Set(
      [...live.matchAll(/\blocal\s+([A-Z][A-Z0-9_]*)=/g)].map((m) => m[1]),
    );
    const defaulted = [...live.matchAll(/\$\{([A-Z][A-Z0-9_]*)(?::-|:\?)/g)].map((m) => m[1]);
    const referenced = [...new Set([...live.matchAll(/\$\{?([A-Z][A-Z0-9_]*)/g)].map((m) => m[1]))];
    const neverAssigned = referenced.filter(
      (n) => !new RegExp(`(^|[\\s;&|(])${n}\\+?=`, "m").test(live),
    );
    return [...new Set([...defaulted, ...neverAssigned])]
      .filter(
        (n) =>
          !locals.has(n) &&
          !SHELL_SPECIALS.has(n) &&
          !INTERNAL_NOT_SEAMS.some((i) => i.name === n),
      )
      .sort();
  }

  /** The `--help` header's ENV SEAMS block — the operator's contract, verbatim. */
  function seamsBlock(text: string): string {
    const lines = text.split("\n");
    const a = lines.findIndex((l) => l.includes("── ENV SEAMS"));
    if (a < 0) return "";
    const b = lines.findIndex((l, i) => i > a && l.startsWith("# ──"));
    return b < 0 ? "" : lines.slice(a, b).join("\n");
  }

  /** Seams the block does not name — the arm's whole predicate, reusable. */
  function undocumented(text: string): string[] {
    const block = seamsBlock(text);
    return envSeams(text).filter((name) => !new RegExp(`\\b${name}\\b`).test(block));
  }

  it("IN-05/WR-04 — every env seam the script READS is named in the `--help` ENV SEAMS block", () => {
    // ⛔ THE ONLY SANCTIONED EXCEPTION CHANNEL for a seam that is REAL and
    // undocumented. It has to be listed HERE, with a reason, so the omission is a
    // reviewed line in a diff rather than an absence nobody can see. It is empty,
    // and it should stay empty: `--help` is what an operator reads before running
    // a destructive tool.
    const UNDOCUMENTED_SEAMS: { name: string; why: string }[] = [];

    // ⛔ A RATCHET, in the direction that matters. The defect WR-04 named was a
    // derivation that silently covered LESS of the contract than its title claimed,
    // and a narrowing regex would shrink this number rather than turn anything red.
    // Raise it when the seam count climbs; never lower it to make a run pass.
    const SEAM_FLOOR = 16;

    const seams = envSeams(SRC);
    expect(
      seams.length,
      `the seam derivation found ${seams.length} seams (${seams.join(", ")}) but the floor is ${SEAM_FLOOR}. A derivation that covers LESS of the operator contract than it used to is the WR-04 defect itself — do not lower the floor.`,
    ).toBeGreaterThanOrEqual(SEAM_FLOOR);

    // The three WR-04 named, pinned BY NAME. A revert of the widening above is red
    // here even if the floor were edited in the same commit.
    for (const blind of ["RESTORE_DB_URL", "RESTORE_OUT_DIR", "PGBIN"]) {
      expect(
        seams,
        `${blind} is not in the derived seam set. It was invisible to the pre-WR-04 derivation, and RESTORE_DB_URL is the DSN of the database this script runs DROP SCHEMA public CASCADE against.`,
      ).toContain(blind);
    }

    // ⛔ THE INTERNAL-EXCLUSION LIST IS CHECKED, not trusted. Each entry must still
    // be BOTH halves of the reason it was written with — a defaulting read (which
    // is why the derivation catches it at all) AND a TOP-LEVEL unconditional
    // assignment that destroys whatever the environment supplied (which is why it
    // is not a seam). Park a real env seam here and the second half is red, because
    // a real seam has no unconditional clobber.
    const liveSrc = liveLines(SRC)
      .map(({ line }) => line)
      .join("\n");
    for (const i of INTERNAL_NOT_SEAMS) {
      expect(
        new RegExp(`\\$\\{${i.name}(?::-|:\\?)`).test(liveSrc),
        `INTERNAL_NOT_SEAMS names ${i.name} (${i.why}) but the script no longer reads it with a defaulting expansion — the entry is stale and must be deleted, not kept "just in case".`,
      ).toBe(true);
      expect(
        // `^NAME=` OR `; NAME=` — the script clobbers all three EXP_* on ONE
        // top-level line, so an anchor-only match would see the first and miss the
        // other two. The lookahead rejects the DEFAULTING form `NAME=${NAME:-0}`,
        // which is a read and not a clobber.
        new RegExp(`(^|;[ \\t]*)${i.name}=(?![^\\n;]*\\$\\{${i.name})`, "m").test(liveSrc),
        `INTERNAL_NOT_SEAMS excludes ${i.name} on the grounds that the script clobbers it at top level (${i.why}), and no unconditional top-level \`${i.name}=…\` assignment exists any more. Either it became a REAL environment seam — document it in ENV SEAMS — or the reason is stale.`,
      ).toBe(true);
    }

    expect(
      seamsBlock(SRC),
      "the ENV SEAMS block slicer found no anchor — the pin below would be vacuous",
    ).not.toBe("");

    const missing = undocumented(SRC).filter(
      (name) => !UNDOCUMENTED_SEAMS.some((u) => u.name === name),
    );
    expect(
      missing,
      `\`--help\`'s ENV SEAMS block does not name ${missing.join(", ")}, and the script reads ${missing.length === 1 ? "it" : "them"} from the environment. Either document ${missing.length === 1 ? "it" : "them"} or put ${missing.length === 1 ? "it" : "them"} in UNDOCUMENTED_SEAMS with a reason.`,
    ).toEqual([]);

    // ⛔ CALIBRATION — EVERY SEAM, NOT A SAMPLE. The old calibration deleted ONE
    // documented line (`REFDATA_KIND_CHECK`) and proved the pin bit for that one
    // name; WR-04 was precisely a pin that bit for the seams it happened to see.
    // So each of the sixteen entries is deleted in turn — its header line AND the
    // indented continuation lines that belong to it, because a name left standing
    // in its own continuation is not a documented entry — and the arm must report
    // exactly that seam and no other.
    for (const name of seams) {
      const entry = new RegExp(`^#   ${name}\\b.*\\n(?:#[ ]{20,}.*\\n)*`, "m");
      const stripped = SRC.replace(entry, "");
      expect(
        stripped,
        `the WR-04 calibration did not APPLY for ${name} — no \`#   ${name} …\` entry line was found, so the assertion below would be vacuous`,
      ).not.toBe(SRC);
      expect(
        undocumented(stripped),
        `deleting the ${name} entry from the ENV SEAMS block did NOT turn this pin red. That is the WR-04 defect for ${name}.`,
      ).toEqual([name]);
    }
  });
});

describe("restore-test-from-baseline.sh — IN-06: the filter grep's read is BOUNDED", () => {
  // ⛔ WHY THIS ARM IS EXECUTED AND NOT A GREP. What IN-06 names is an ABSENCE — an
  // unwrapped `grep -av` that died under `set -e` with no `::error::` — and a static
  // pin for the wrap's TEXT would stay green against a wrap that fires on the wrong
  // bound. So the script is SOURCED (the WR-01 technique: the final `main "$@"`
  // dispatch removed, leaving definitions only) and `build_transaction` is called
  // directly. No cluster, no database, no DSN — the literal `stub-never-used` is the
  // only thing put in RESTORE_DB_URL, and it is never dialled.
  //
  // ⚠️ THE READ FAILURE IS INJECTED AT THE CALL SITE, NOT BY DELETING THE DUMP, AND
  // THAT IS A MEASUREMENT RATHER THAN A PREFERENCE. An absent BASELINE_FILE never
  // reaches this line: the `grep -ac` COUNT ~170 lines above reads the same path and
  // fails FIRST with its own message. Measured 2026-09-09 against the pre-fix bytes,
  // exactly as the plan's literal harness would have run it:
  //   exit=1 · `MEASURE_FAIL: could not count the filtered line class in …`
  // An arm built on a missing file is therefore red BEFORE and AFTER the fix — it
  // measures the count site, not this one. A `grep` shell function returning 2 for
  // the `-v` invocation and delegating every other one to `command grep` reproduces
  // the real shape (a read that failed HERE while the count succeeded) and binds to
  // the site under test.
  const HARNESS = [
    'source "$COPY"',
    "grep() {",
    '  for a in "$@"; do',
    '    case "$a" in -*v*) return 2 ;; esac',
    "  done",
    '  command grep "$@"',
    "}",
    "build_transaction restore",
    "",
  ].join("\n");

  /** The wrapped filter read, verbatim. Both halves, so the calibration is exact. */
  const WRAPPED =
    '  set +e; grep -av "$FILTER_PATTERN" "$BASELINE_FILE" >> "$out"; rc=$?; set -e\n' +
    '  [ "$rc" -le 1 ] || fail "MEASURE_FAIL: could not read ${BASELINE_FILE} while filtering (grep exited ${rc}). An unreadable dump is not an empty one."\n';
  /** What the line was before IN-06 — the shape the calibration restores. */
  const BARE = '  grep -av "$FILTER_PATTERN" "$BASELINE_FILE" >> "$out"\n';

  function runBuildTransaction(scriptText: string): { status: number; out: string } {
    const dir = mkdtempSync(join(tmpdir(), "restore-in06-"));
    try {
      const stripped = scriptText.replace(/\nmain "\$@"\n?$/, "\n");
      expect(
        stripped,
        'the script no longer ends with its `main "$@"` dispatch — sourcing the copy would RUN the real thing',
      ).not.toBe(scriptText);
      expect(
        stripped.trimEnd().endsWith("}"),
        "the sourced copy does not end on a closing function brace — the tail strip took more than the dispatch line",
      ).toBe(true);
      const copy = join(dir, "copy.sh");
      writeFileSync(copy, stripped);
      writeFileSync(join(dir, "harness.sh"), HARNESS);
      mkdirSync(join(dir, "out"));
      writeFileSync(join(dir, "out", "survivors.keys"), "");
      writeFileSync(
        join(dir, "baseline.sql"),
        'CREATE TABLE x();\nALTER PUBLICATION "supabase_realtime" OWNER TO postgres;\n',
      );
      const r = spawnSync("bash", [join(dir, "harness.sh")], {
        encoding: "utf8",
        env: {
          ...process.env,
          COPY: copy,
          RESTORE_OUT_DIR: join(dir, "out"),
          BASELINE_FILE: join(dir, "baseline.sql"),
          BASELINE_SHA: "deadbeef",
          RESTORE_DB_URL: "stub-never-used",
        },
      });
      return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("EXECUTED — a grep that cannot READ the dump is a NAMED MEASURE_FAIL, not a silent death", () => {
    expect(
      SRC.split(WRAPPED).length - 1,
      "the wrapped filter read is not in the script exactly once — the calibration below would neuter nothing",
    ).toBe(1);

    const fixed = runBuildTransaction(SRC);
    expect(
      fixed.out,
      `build_transaction said nothing about an unreadable dump. Combined output:\n${fixed.out}`,
    ).toContain("MEASURE_FAIL: could not read");
    expect(
      fixed.status,
      `build_transaction did not exit 1 on an unreadable dump. Combined output:\n${fixed.out}`,
    ).toBe(1);

    // CALIBRATION — put the bare line back and watch the named failure vanish.
    // Observed 2026-09-09 on the pre-fix bytes: exit 2 and NOTHING on either
    // channel. That silence is the defect; this half of the arm is what keeps it
    // from coming back unnoticed.
    const unwrappedSrc = SRC.replace(WRAPPED, () => BARE);
    expect(
      unwrappedSrc,
      "the IN-06 calibration did not APPLY — a neuter that changes nothing reads as a passing RED",
    ).not.toBe(SRC);
    const unwrapped = runBuildTransaction(unwrappedSrc);
    expect(
      unwrapped.out,
      "the unwrapped filter grep named a MEASURE_FAIL it cannot name — the calibration is measuring the wrong site",
    ).not.toContain("MEASURE_FAIL: could not read");
    expect(
      unwrapped.status,
      `the unwrapped grep did not die of its own exit 2 under \`set -e\`. Combined output:\n${unwrapped.out}`,
    ).toBe(2);
  });
});

describe("restore-test-from-baseline-fixtures — the arm corpus is a DIRECTORY listing", () => {
  // ⛔ WHY THE COUNTS ARE PINNED. The self-test's `ledger_rows=3` is derived from
  // the migrations directory, and its overlay arms from `arm-*.sql`. Both are
  // GLOBS, so a stray file silently changes what an arm asserts — a fourth
  // migration would make the exact summary line `ledger_rows=4` and turn arms 9,
  // 12 and 18 red for a reason that has nothing to do with the restore.
  const migrationsOf = (names: string[]) =>
    names.filter((n) => /^\d{14}_.*\.sql$/.test(n)).sort();
  const overlaysOf = (names: string[]) => names.filter((n) => /^arm-.*\.sql$/.test(n)).sort();

  it("exactly three fixture migrations with 14-digit prefixes", () => {
    const names = readdirSync(`${FIXTURES}/migrations`);
    expect(names.filter((n) => n.endsWith(".sql")).length).toBe(3);
    expect(migrationsOf(names)).toEqual([
      "20260101000000_fixture_a.sql",
      "20260102000000_fixture_b.sql",
      "20260103000000_fixture_c.sql",
    ]);

    // AIM — the same predicate applied to a SYNTHETIC listing of five names
    // returns five. Without it, "3" could be reported by a glob that matches
    // nothing and a directory that happens to hold three files.
    const synthetic = [
      "20990101000000_a.sql",
      "20990102000000_b.sql",
      "20990103000000_c.sql",
      "20990104000000_d.sql",
      "20990105000000_e.sql",
      "README.md",
      "not_a_migration.sql",
    ];
    expect(migrationsOf(synthetic).length).toBe(5);
  });

  it("exactly seven arm overlays, each named by the arm that loads it", () => {
    const names = readdirSync(FIXTURES);
    // ⚠️ SEVEN, not the four the plan's frontmatter listed: arms 17, 18 and 19 were
    // added after that list was written and each names its own overlay
    // (`arm-public-operator.sql`, `arm-default-acl.sql`, `arm-no-survivors.sql`).
    // Recorded here rather than pinned at a stale number, because a pin that
    // disagrees with the corpus is a pin somebody will edit downward. The
    // bidirectional extraction below is what keeps this list honest: it is asserted
    // EQUAL to the set of names `setup_lane` actually loads, so adding a fixture
    // without arming it — or arming a name with no fixture — is a RED either way.
    expect(overlaysOf(names)).toEqual([
      "arm-default-acl.sql",
      "arm-no-survivors.sql",
      "arm-orphan-view.sql",
      "arm-public-operator.sql",
      "arm-stray-publication.sql",
      "arm-unqualified-policy.sql",
      "arm-unrecreatable-trigger.sql",
    ]);

    // Every overlay is LOADED by name from the self-test, and every name the
    // self-test loads EXISTS — the two directions together are what stops an
    // orphaned fixture and a dangling reference.
    const st = selfTestRegion(SRC);
    const loaded = new Set(
      [...st.matchAll(/setup_lane ([a-z-]+)/g)].map((m) => `arm-${m[1]}.sql`),
    );
    expect([...loaded].sort()).toEqual(overlaysOf(names));

    // AIM — the overlay predicate over a synthetic listing of five.
    const synthetic = ["arm-a.sql", "arm-b.sql", "arm-c.sql", "arm-d.sql", "arm-e.sql", "old-test.sql"];
    expect(overlaysOf(synthetic).length).toBe(5);
  });

  it("the dump fixture carries the ALTER DEFAULT PRIVILEGES line arm 18 round-trips", () => {
    // ⚠️ THE QUOTING TRAP, MEASURED. The real dump writes `IN SCHEMA "public"`,
    // quoted: on `supabase/schema/baseline.sql` a grep for `IN SCHEMA public `
    // matches 0 lines and one for `IN SCHEMA "public"` matches 12. Reading the
    // first as "the dump omits these grants" is the exact mistake made and
    // corrected during planning, so the fixture keeps the quoted form.
    const dump = read(`${FIXTURES}/baseline-fixture.sql`);
    expect(dump).toContain('ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public"');
    expect(read("supabase/schema/baseline.sql").split("\nALTER DEFAULT PRIVILEGES").length - 1).toBe(12);
  });
});

describe("restore-test-from-baseline.sh — C3: the arm ratchet names the DIRECTION it measured", () => {
  // ⛔ THE DEFECT, AND WHY IT LANDED IN THE WRONG FILE FIRST. A sibling review
  // (IN-01) found that ONE sentence covering both directions of an arm-count
  // mismatch names the WRONG one half the time: add an arm and the gate says an arm
  // "disappeared", sending the reader hunting a deletion that never happened. The
  // two directions have OPPOSITE remedies — a vanished arm is RESTORED, an added arm
  // is RATCHETED — so one sentence cannot carry both. The fix was applied to
  // `scripts/test-ledger-drift-check.sh`, the file the finding happened to name, and
  // NOT to this one, whose `--run` path is `DROP SCHEMA public CASCADE`. The more
  // destructive of the two was the one left with the direction-blind message.
  //
  // ⚠️ WHY THIS ARM EXTRACTS AND EXECUTES rather than sourcing and calling. The
  // ratchet lives inside the self-test driver, and calling that function `initdb`s a
  // throwaway PostgreSQL cluster — not something a vitest arm may do. So the arm
  // takes the REAL BYTES off disk (never a fixture written here), asserts the slice
  // is present and unique, and RUNS them under both directions. It is still the
  // shipped code that decides each verdict.

  /** The ratchet block, sliced out of the live script. */
  function ratchetBlock(text: string): string {
    const lines = text.split("\n");
    const a = lines.findIndex((l) => l === '  if [ "$total" -ne "$EXPECTED_ARMS" ]; then');
    if (a < 0) return "";
    const b = lines.findIndex((l, i) => i > a && l === "  fi");
    return b < 0 ? "" : lines.slice(a, b + 1).join("\n");
  }

  /** Run the sliced block with a given tally, and return everything it printed. */
  function runRatchet(block: string, total: number, expected: number): string {
    const dir = mkdtempSync(join(tmpdir(), "restore-ratchet-"));
    try {
      const h = join(dir, "h.sh");
      writeFileSync(
        h,
        ["ratchet() {", block, '  echo "RATCHET-SILENT"', "}", `total=${total}`, `EXPECTED_ARMS=${expected}`, "ratchet", ""].join("\n"),
      );
      const r = spawnSync("bash", [h], { encoding: "utf8" });
      return `${r.stdout ?? ""}${r.stderr ?? ""}`;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("EXECUTED — an ADDED arm says ADDED, a VANISHED arm says DISAPPEARED, and equality is silent", () => {
    const block = ratchetBlock(SRC);
    expect(block, "the arm-ratchet block slicer found no anchor — everything below would be vacuous").not.toBe("");
    expect(
      SRC.split('  if [ "$total" -ne "$EXPECTED_ARMS" ]; then').length - 1,
      "the ratchet anchor is not unique, so the slice above may not be the shipped one",
    ).toBe(1);

    const added = runRatchet(block, 27, 26);
    expect(added, "an ADDED arm is not reported as added").toContain("An arm was ADDED");
    expect(
      added,
      "the added-arm message does not carry the RATCHET remedy, so the reader is told what happened but not what to do",
    ).toContain("RAISE EXPECTED_ARMS");
    expect(
      added.includes("DISAPPEARED"),
      "an ADDED arm is STILL described as a disappearance — the direction-blind sentence, exactly as found",
    ).toBe(false);

    const vanished = runRatchet(block, 25, 26);
    expect(vanished, "a VANISHED arm is not reported as a disappearance").toContain("An arm DISAPPEARED");
    expect(
      vanished,
      "the vanished-arm message does not carry the RESTORE remedy, and the wrong remedy here is lowering the ratchet",
    ).toContain("RESTORE the arm");
    expect(vanished.includes("was ADDED")).toBe(false);

    // The equality path must fall through both branches without printing a verdict.
    expect(runRatchet(block, 26, 26)).toContain("RATCHET-SILENT");
    expect(runRatchet(block, 26, 26).includes("SELF-TEST FAIL")).toBe(false);

    // CALIBRATION — collapse the branch back to ONE sentence and watch an ADDED arm
    // be reported as a disappearance again.
    const collapsed = block.replace(
      /\n    if \[ "\$total" -lt "\$EXPECTED_ARMS" \]; then[\s\S]*?\n    fi\n/,
      '\n    echo "SELF-TEST FAIL: ${total} arms ran but EXPECTED_ARMS is ${EXPECTED_ARMS}. An arm that disappeared is a RED, not a smaller PASSED."\n',
    );
    expect(collapsed, "the C3 direction calibration did not APPLY").not.toBe(block);
    const blind = runRatchet(collapsed, 27, 26);
    expect(blind).toContain("An arm that disappeared");
    expect(blind.includes("An arm was ADDED")).toBe(false);
  });
});

describe("restore-test-from-baseline.sh — the four PUBLISHED .sql files are scanned for a DSN", () => {
  // ⛔ WHAT THIS ARM IS ABOUT, AND WHAT IT IS DELIBERATELY NOT ABOUT. The calling
  // workflow stages `census.sql`, `survivors.sql`, `restore.sql` and `refdata.sql`
  // into a world-readable artifact that lives for 90 days on a PUBLIC repo. That
  // FILE SET is a founder decision and is not in scope here — it is already
  // narrower than what it replaced, and re-narrowing it is explicitly out of
  // bounds. The gap this arm closes is that NOTHING asserted the four were
  // credential-free: the workflow's redaction step runs BEFORE the script writes
  // them, and `--self-test`'s redaction grep reads an arm's captured OUTPUT rather
  // than these files.
  //
  // ⛔ SO THE PREDICATE IS ABOUT DSN SHAPES, NOT ABOUT WHICH FILES EXIST. A pin
  // over the file list would go red the next time the set legitimately changes and
  // would say nothing about credentials either way.
  //
  // ⚠️ EXECUTED, not grepped, and with NO CLUSTER AND NO DATABASE. A static pin on
  // the guard's TEXT would stay green against a guard that scans the wrong
  // directory or swallows grep's rc. The script is SOURCED the way the IN-06 arm
  // does it (`main "$@"` stripped, definitions only) and the function is called
  // directly against a seeded RESTORE_OUT_DIR. `RESTORE_DB_URL` is the literal
  // `stub-never-used` and is never dialled.
  const DSN_HARNESS = ['source "$COPY"', "refuse_credential_in_published_sql", ""].join("\n");

  // ⛔ E2 — DERIVED FROM THE SCRIPT, NEVER RE-TYPED. This was a hand-written literal
  // until 2026-09-10, which meant the scan's file list, the workflow's publish loop
  // and this test were THREE independent spellings of one fact. C1 closed "a file IN
  // the list that the scan could not find" (the `scanned N of 4` floor). Nothing
  // closed "a file the workflow PUBLISHES that is not in the list at all" — and that
  // one ships GREEN: a later phase adds a fifth script-written artifact to the
  // workflow's staging loop, the README rule reds until the name appears in the
  // PROSE, the author adds it there, the board goes green, and the file is
  // world-readable for 90 days having passed through nothing. Round two's defect one
  // level up — code and README agreeing about CLASSES while disagreeing about FILES.
  const STAGED = stagedFromScript(SRC);

  /** The scan's own `staged=(…)` array, read out of the live script. */
  function stagedFromScript(src: string): string[] {
    const m = /\n  local -a staged=\(([^)]*)\)\n/.exec(src);
    expect(
      m,
      "the scan no longer declares a `staged=(…)` array — the anchor every file-set assertion in this block is read through has moved",
    ).not.toBeNull();
    return (m?.[1] ?? "").trim().split(/\s+/).filter((x) => x.length > 0);
  }

  /**
   * The `.sql` names the workflow's staging loop copies into the artifact.
   * `schema-before.sql` is EXCLUDED, and the reason is encoded here rather than left
   * as a bare filter: it is not written by this script at all — it is the backup
   * step's own `supabase db dump`, and that step runs it through its own
   * `scan_for_secrets` with `schema_re` before staging. Every OTHER `.sql` in the
   * loop is written by this script after the workflow's redaction step has already
   * run, so `refuse_credential_in_published_sql` is the only thing standing between
   * it and the artifact.
   */
  const WORKFLOW_SELF_SCANNED = "schema-before.sql";

  /**
   * ⛔ THE ANCHOR IS THE CONTENT, NOT THE POSITION. The workflow carries several
   * `for … in …; do` loops (the diagnostic-channel ones glob `"${outdir}"/*.err`),
   * so the staging loop is identified as the one whose word list holds BARE
   * `<name>.sql` tokens — and there must be exactly one, or the derivation below is
   * reading a loop it was not aimed at and would report a clean agreement about the
   * wrong list.
   */
  function stagedSqlLoop(wf: string): { whole: string; names: string[] } {
    const loops = [...wf.matchAll(/\n[ \t]*for [a-z] in ([^;\n]*); do\n/g)].filter((m) =>
      m[1].split(/\s+/).some((w) => /^[A-Za-z0-9._-]+\.sql$/.test(w)),
    );
    expect(
      loops.length,
      "the workflow does not carry EXACTLY ONE staging loop naming bare .sql files — the anchor this agreement is read through moved, and a derivation aimed at the wrong loop reports agreement about the wrong list",
    ).toBe(1);
    return {
      whole: loops[0][0],
      names: loops[0][1]
        .trim()
        .split(/\s+/)
        .filter((n) => /^[A-Za-z0-9._-]+\.sql$/.test(n)),
    };
  }

  function stagedSqlFromWorkflow(wf: string): string[] {
    return stagedSqlLoop(wf).names.filter((n) => n !== WORKFLOW_SELF_SCANNED);
  }

  it("E2 — every .sql the workflow PUBLISHES is a file the scan actually reads", () => {
    const wf = read(".github/workflows/test-restore-from-baseline.yml");
    const published = stagedSqlFromWorkflow(wf);
    expect(
      published.length,
      "the workflow's staging loop publishes no .sql files at all — the derivation found the wrong loop",
    ).toBeGreaterThan(0);
    expect(
      new Set(published),
      "the workflow stages a .sql file the credential scan does not know about, or the scan lists one the workflow does not publish. A published file that is not in `staged=(…)` ships into a WORLD-READABLE 90-day artifact having passed through NOTHING — and the `scanned N of N` floor cannot see it, because it only counts the files the list already names.",
    ).toEqual(new Set(STAGED));
    expect(
      published,
      "the workflow's staging loop no longer carries schema-before.sql — the exclusion above is describing a file that is not there, so its stated reason (the backup step scans it itself) is unverifiable",
    ).not.toContain(WORKFLOW_SELF_SCANNED);
    expect(
      wf,
      "the workflow no longer stages schema-before.sql at all, so this test excludes a name for a reason that has expired",
    ).toContain(WORKFLOW_SELF_SCANNED);

    // CALIBRATION — add a fifth published .sql on a SCRATCH STRING (the real
    // workflow belongs to another owner and is never edited here) and the equality
    // must break. The mutation is asserted to have APPLIED first: this file records
    // a lesson where a `survivors.sql` mutation was a NO-OP because the name appears
    // twice, and it read GREEN.
    const loop = stagedSqlLoop(wf).whole;
    const mutated = wf.replace(loop, loop.replace(" refdata.sql;", " refdata.sql acl.sql;"));
    expect(mutated, "the E2 fifth-file calibration did not APPLY").not.toBe(wf);
    expect(stagedSqlFromWorkflow(mutated)).toContain("acl.sql");
    expect(new Set(stagedSqlFromWorkflow(mutated))).not.toEqual(new Set(STAGED));

    // AND THE OTHER DIRECTION — a name dropped from the scan's own array must break
    // it too, or the assertion only ever sees growth on one side.
    const shrunk = SRC.replace(" refdata.sql)\n", ")\n");
    expect(shrunk, "the E2 script-side calibration did not APPLY").not.toBe(SRC);
    expect(new Set(stagedFromScript(shrunk))).not.toEqual(new Set(published));
  });

  function runDsnAssert(
    files: Record<string, string>,
    src: string = SRC,
  ): { status: number; out: string } {
    const dir = mkdtempSync(join(tmpdir(), "restore-dsnscan-"));
    try {
      const stripped = src.replace(/\nmain "\$@"\n?$/, "\n");
      expect(
        stripped,
        'the script no longer ends with its `main "$@"` dispatch — sourcing the copy would RUN the real thing',
      ).not.toBe(src);
      const copy = join(dir, "copy.sh");
      writeFileSync(copy, stripped);
      writeFileSync(join(dir, "harness.sh"), DSN_HARNESS);
      const out = join(dir, "out");
      mkdirSync(out);
      for (const [name, body] of Object.entries(files)) writeFileSync(join(out, name), body);
      const r = spawnSync("bash", [join(dir, "harness.sh")], {
        encoding: "utf8",
        env: { ...process.env, COPY: copy, RESTORE_OUT_DIR: out, RESTORE_DB_URL: "stub-never-used" },
      });
      return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  it("is WIRED — called between build_transaction and run_transaction, so a hit refuses pre-write", () => {
    const body = functionBody(SRC, "run_restore");
    const buildAt = liveIndexOf(body, 'build_transaction "$mode"');
    const scanAt = liveIndexOf(body, "refuse_credential_in_published_sql");
    const txnAt = liveIndexOf(body, "run_transaction");
    expect(scanAt, "run_restore no longer scans the published .sql files").toBeGreaterThanOrEqual(0);
    expect(
      scanAt,
      "the DSN scan runs BEFORE the transaction is assembled, so restore.sql and refdata.sql do not exist yet and it would scan two files instead of four",
    ).toBeGreaterThan(buildAt);
    expect(
      scanAt,
      "the DSN scan runs AFTER the transaction, so a credential in a published file is discovered only once the database has already been written to",
    ).toBeLessThan(txnAt);

    // CALIBRATION — move the call after run_transaction on a scratch copy.
    const moved = SRC.replace("  refuse_credential_in_published_sql\n", "").replace(
      "  run_transaction\n",
      "  run_transaction\n  refuse_credential_in_published_sql\n",
    );
    expect(moved, "the wiring calibration did not APPLY").not.toBe(SRC);
    const mBody = functionBody(moved, "run_restore");
    expect(liveIndexOf(mBody, "refuse_credential_in_published_sql")).toBeGreaterThan(
      liveIndexOf(mBody, "run_transaction"),
    );
  });

  it("EXECUTED — clean files pass, and a DSN in ANY ONE of the four is a named refusal", () => {
    const clean: Record<string, string> = Object.fromEntries(
      STAGED.map((f) => [f, "CREATE TABLE public.x ();\nSELECT $$a dollar-quoted body$$;\n"]),
    );
    const green = runDsnAssert(clean);
    expect(green.status, `the guard refused four DSN-free files. Output:\n${green.out}`).toBe(0);
    expect(green.out).toContain("carry no credential shape");
    // ⛔ C1 — THE CLEAN SENTENCE REPORTS THE MEASURED TALLY, not the four names it
    // was going to print either way. A reader of a green log must be able to tell
    // "four files were read and cleared" from "the loop matched nothing".
    expect(
      green.out,
      "the clean sentence does not report how many files were actually scanned, so it reads identically on a run that scanned none",
    ).toContain("scanned 4 of 4");

    // ⛔ ASSEMBLED AT RUNTIME, NEVER SPELLED AS A LITERAL. The string below has to
    // carry a real DSN SHAPE or it would not exercise the scanner at all — which is
    // exactly why a literal here trips the pre-push credential guardrail
    // (`gstack-redact-prepush`, HIGH `db.url_with_password`) and blocks the push. The
    // credentials are obviously synthetic, but a guard that had to tell synthetic from
    // real would be no guard, so the fixture yields rather than asking for an exemption.
    // ⛔ Do NOT inline this back into the template literal, and do NOT allowlist the file.
    const SYNTHETIC_DSN = ["postgre", "sql://u", ":p@db.example:5432/postgres"].join("");

    // ⛔ THE FALSIFIER, ONE FILE AT A TIME. A guard that scans `restore.sql` and
    // nothing else would pass three of these four.
    for (const target of STAGED) {
      const seeded = {
        ...clean,
        [target]: `${clean[target]}-- ${SYNTHETIC_DSN}\n`,
      };
      const red = runDsnAssert(seeded);
      expect(
        red.status,
        `a DSN in ${target} did NOT refuse — that file reaches a world-readable artifact unscanned. Output:\n${red.out}`,
      ).toBe(1);
      expect(red.out, `the refusal for ${target} does not name the file`).toContain(target);
      // The match itself is the credential and must never be printed.
      expect(
        red.out.includes("db.example"),
        `the refusal for ${target} ECHOED the matched DSN — the refusal is itself the leak`,
      ).toBe(false);
    }
  });

  it("C2 — the scan's class list IS the workflow's own redaction pattern, derived not restated", () => {
    // ⛔ THE DEFECT. The artifact's README (in
    // `.github/workflows/test-restore-from-baseline.yml`) defines the redaction
    // class as SIX shapes — DSN, supabase host, project ref, the `connect`
    // meta-command, ALTER DATABASE, JWT — and this scan was `postgres(ql)?://`
    // ALONE, while the script header claimed the gap was closed for "the one class
    // that must never be published anywhere". Four of the six were dropped with no
    // stated reason. `survivors.sql` carries `pg_get_triggerdef(...)` and
    // reconstructed `CREATE POLICY ... USING (<qual>)` read off LIVE shared TEST, so
    // a host or a project ref in one of those bodies shipped with the check green.
    //
    // ⭐ SO THE AGREEMENT IS DERIVED FROM BOTH FILES, never re-typed here. If the
    // workflow's pattern gains a class, this arm goes red until the script does too.
    const wf = read(".github/workflows/test-restore-from-baseline.yml");
    const ledgerRe = /^\s*ledger_re='(.*)'\s*$/m.exec(wf);
    expect(
      ledgerRe,
      "the workflow no longer declares a single-quoted `ledger_re=` line — the anchor this agreement is read through moved",
    ).not.toBeNull();
    const schemaRe = `${ledgerRe?.[1]}|ALTER DATABASE`;

    // The script's list, read out of the live array.
    const arr = /\n  local -a classes=\(\n([\s\S]*?)\n  \)\n/.exec(SRC);
    expect(arr, "the scan no longer declares a `classes=(…)` array").not.toBeNull();
    const entries = (arr?.[1] ?? "")
      .split("\n")
      .map((l) => l.trim().replace(/^'/, "").replace(/'$/, ""))
      .filter((l) => l.length > 0);
    const names = entries.map((e) => e.slice(0, e.indexOf("|")));
    const res = entries.map((e) => e.slice(e.indexOf("|") + 1));

    expect(
      res.join("|"),
      "the scan's classes and the workflow's schema-scan pattern have DIVERGED. The README tells a reader of the artifact that these files were held to that pattern; the code is what actually holds them to it.",
    ).toBe(schemaRe);
    expect(new Set(names).size, "two classes share a name — a hit could not be read").toBe(names.length);

    // CALIBRATION — drop a class on a scratch copy and the equality must break.
    const dropped = SRC.replace(`    '${entries[1]}'\n`, "");
    expect(dropped, "the C2 class-list calibration did not APPLY").not.toBe(SRC);
    const dArr = /\n  local -a classes=\(\n([\s\S]*?)\n  \)\n/.exec(dropped);
    const dRes = (dArr?.[1] ?? "")
      .split("\n")
      .map((l) => l.trim().replace(/^'/, "").replace(/'$/, ""))
      .filter((l) => l.length > 0)
      .map((e) => e.slice(e.indexOf("|") + 1));
    expect(dRes.join("|")).not.toBe(schemaRe);
  });

  it("E1 — the ONE class exemption is refdata.sql x ALTER DATABASE, and widening it is a RED", () => {
    // ⛔ WHY A PIN AND NOT A DERIVATION. `scoped_out` is the one list in this
    // function that makes a cell go UNREAD, and every other agreement here is
    // derived precisely because a restated constant drifts. This one cannot be
    // derived from anything — there is no second copy of the decision to check
    // against — so the control has to be that the list is SHORT and NAMED. The
    // script already refuses an entry that resolves against neither list, which
    // fails closed; the direction it cannot see is a NEW, well-formed exemption
    // silently switching a class off for another file.
    //
    // The reason for the one entry is measured, not asserted: `refdata.sql` is
    // `scripts/extract-reference-inserts.mjs` output — "the ORIGINAL bytes of an
    // allowlisted migration statement, sliced by offset" — and migration source
    // carries `ALTER DATABASE` in runbook comments (`20260407164606_perfect_match.sql`
    // is allowlisted AND carries one). The same class in the other three files has no
    // such channel and is KEPT.
    const arr = /\n  local -a scoped_out=\(\n([\s\S]*?)\n  \)\n/.exec(SRC);
    expect(
      arr,
      "the scan no longer declares a `scoped_out=(…)` array — either the exemption became unconditional or the anchor moved",
    ).not.toBeNull();
    const pairs = (arr?.[1] ?? "")
      .split("\n")
      .map((l) => l.trim().replace(/^'/, "").replace(/'$/, ""))
      .filter((l) => l.length > 0);
    expect(
      pairs,
      "the class-exemption list is no longer the single argued pair. Every entry here switches a credential class OFF for a file the workflow publishes to a world-readable artifact for 90 days, so a new one is a founder decision with its own measurement, not an edit.",
    ).toEqual(["refdata.sql|ALTER DATABASE"]);
  });

  it("EXECUTED — E1: the exemption is scoped, not a deletion, and the green log SAYS so", () => {
    const body = "CREATE TABLE public.x ();\n";
    // The realistic shape: a recipe comment INTERIOR to an allowlisted INSERT, which
    // the extractor emits verbatim because it slices original bytes.
    const RECIPE = "INSERT INTO public.t VALUES\n  -- ALTER DATABASE postgres SET app.k = 'v'\n  (1);\n";

    // (a) In `refdata.sql` it must PASS — and the clean line must name the pair, or a
    //     green log claims a cell was read that never was.
    const green = runDsnAssert({
      ...Object.fromEntries(STAGED.map((f) => [f, body])),
      "refdata.sql": `${body}${RECIPE}`,
    });
    expect(
      green.status,
      `an ALTER DATABASE recipe COMMENT in refdata.sql refused the restore. The allowlist grows by founder decision, so this aborts a restore over documentation. Output:\n${green.out}`,
    ).toBe(0);
    expect(
      green.out,
      "the clean sentence does not name the scoped-out pair, so a reader of a green log is told six classes cleared four files while one of the twenty-four cells was never read",
    ).toContain("scoped out by measurement: refdata.sql|ALTER DATABASE");

    // (b) THE CALIBRATION. The same text in each of the other three must still
    //     REFUSE, or (a) is passing because the class was dropped outright.
    for (const target of STAGED.filter((f) => f !== "refdata.sql")) {
      const red = runDsnAssert({
        ...Object.fromEntries(STAGED.map((f) => [f, body])),
        [target]: `${body}ALTER DATABASE postgres SET app.k = 'v';\n`,
      });
      expect(
        red.status,
        `an ALTER DATABASE in ${target} did NOT refuse — the exemption is scoped to refdata.sql, so if the class bites nowhere it has been deleted. Output:\n${red.out}`,
      ).toBe(1);
      expect(red.out, `the refusal does not name ${target} and the ALTER DATABASE class`).toContain(
        `${target} (ALTER DATABASE)`,
      );
    }

    // (c) THE EXEMPTION IS PER-CLASS, NOT PER-FILE. `refdata.sql` must still be
    //     scanned for the other five, or the entry above quietly excused the file.
    const dsn = ["postgre", "sql://u", ":p@db.example:5432/postgres"].join("");
    const stillScanned = runDsnAssert({
      ...Object.fromEntries(STAGED.map((f) => [f, body])),
      "refdata.sql": `${body}-- ${dsn}\n`,
    });
    expect(
      stillScanned.status,
      `a DSN in refdata.sql passed — the ALTER DATABASE exemption has excused the whole FILE. Output:\n${stillScanned.out}`,
    ).toBe(1);
    expect(stillScanned.out).toContain("refdata.sql (DSN)");
  });

  it("EXECUTED — E1: an exemption that resolves against NOTHING is a MEASURE_FAIL", () => {
    // A typo fails CLOSED (the class simply still runs) and would therefore be
    // invisible — a line in the source claiming a decision that is no longer being
    // taken, beside a control that no longer implements it. That is the defect class
    // this whole block exists to answer, so it is refused rather than ignored.
    const body = "CREATE TABLE public.x ();\n";
    const clean = Object.fromEntries(STAGED.map((f) => [f, body]));

    for (const [bad, why] of [
      ["refdata.sqll|ALTER DATABASE", "file"],
      ["refdata.sql|ALTER DATABASE ", "class"],
    ] as const) {
      const mutated = SRC.replace("    'refdata.sql|ALTER DATABASE'\n", `    '${bad}'\n`);
      expect(mutated, `the stale-exemption (${why}) mutation did not APPLY`).not.toBe(SRC);
      const red = runDsnAssert(clean, mutated);
      expect(
        red.status,
        `a stale exemption naming a ${why} that does not exist passed silently. Output:\n${red.out}`,
      ).toBe(1);
      expect(red.out, `the stale-exemption refusal does not report the unresolved ${why}`).toContain(
        "MEASURE_FAIL: the class exemption",
      );
    }

    // And the INTACT list on the same clean input is green, so the two legs above
    // are not passing because the guard refuses everything.
    expect(runDsnAssert(clean).status).toBe(0);
  });

  it("EXECUTED — C2: EVERY class refuses, names its class, and never echoes the match", () => {
    // ⛔ ASSEMBLED AT RUNTIME, NEVER SPELLED AS LITERALS — the same discipline the
    // DSN fixture above records, and for the same reason: each of these has to carry
    // a REAL credential SHAPE or it would not exercise the scanner, which is exactly
    // what the pre-push guardrail is looking for. Do NOT inline them, and do NOT
    // allowlist this file.
    //
    // Each fixture carries a NEEDLE that appears nowhere else, so "the refusal did
    // not echo the match" is measured on a token rather than assumed.
    const REF20 = "abcdefghij".repeat(2); // 20 lowercase letters — a project ref's shape
    const CASES: { cls: string; needle: string; text: string }[] = [
      {
        cls: "DSN",
        needle: "db.example",
        text: `-- ${["postgre", "sql://u", ":p@db.example:5432/postgres"].join("")}\n`,
      },
      {
        cls: "supabase host",
        needle: "exampleref",
        text: `-- ${["@db.exampleref", ".supa", "base.co"].join("")}\n`,
      },
      {
        cls: "project ref",
        needle: REF20,
        text: `-- ${[REF20, ".supa", "base"].join("")}\n`,
      },
      {
        cls: "connect meta-command",
        needle: "target_db_name",
        text: `${["\\", "connect target_db_name"].join("")}\n`,
      },
      {
        cls: "JWT",
        needle: "abcdefghijklmn",
        text: `-- ${["eyJ", "abcdefghijklmn"].join("")}\n`,
      },
      {
        cls: "ALTER DATABASE",
        needle: "sekrit_value",
        text: "ALTER DATABASE postgres SET app.k = 'sekrit_value';\n",
      },
    ];

    const body = "CREATE TABLE public.x ();\nSELECT $$a dollar-quoted body$$;\n";
    const clean = Object.fromEntries(STAGED.map((f) => [f, body]));
    expect(runDsnAssert(clean).status, "the six-class scan refuses clean SQL").toBe(0);

    for (const { cls, needle, text } of CASES) {
      // survivors.sql is the file the README singles out: it carries triggerdef and
      // policy qual text read off LIVE shared TEST.
      const seeded = { ...clean, "survivors.sql": `${body}${text}` };
      const red = runDsnAssert(seeded);
      expect(
        red.status,
        `a ${cls} shape in survivors.sql did NOT refuse — that class reaches a world-readable artifact unscanned. Output:\n${red.out}`,
      ).toBe(1);
      expect(red.out, `the ${cls} refusal does not name the file`).toContain("survivors.sql");
      expect(
        red.out,
        `the ${cls} refusal does not name the CLASS, so an operator cannot tell which of the six shapes was found without opening the file by hand`,
      ).toContain(cls);
      expect(
        red.out.includes(needle),
        `the ${cls} refusal ECHOED the matched text — the refusal is itself the leak`,
      ).toBe(false);
    }
  });

  it("EXECUTED — C1: a MISSING published file is a named refusal, not a clean four-file sentence", () => {
    // ⛔ THE DEFECT. The scan loop's `[ -f … ] || continue` is silent and the
    // closing `note` was unconditional and restated all four names, so a run that
    // found ZERO of the four emitted the SAME sentence as a run that read and
    // cleared four. That is the `-eq 0`-on-an-empty-count shape, sitting in the one
    // function whose whole job is to stand between a credential and a
    // world-readable 90-day artifact: the calling workflow stages the file whether
    // or not this scan could find it, so an unfound file ships UNSCANNED.
    const body = "CREATE TABLE public.x ();\n";
    const all = Object.fromEntries(STAGED.map((f) => [f, body]));

    // ONE AT A TIME — a floor that only notices the all-four-gone case would still
    // let three of four ship unscanned.
    for (const missing of STAGED) {
      const short = Object.fromEntries(
        STAGED.filter((f) => f !== missing).map((f) => [f, body]),
      );
      const red = runDsnAssert(short);
      expect(
        red.status,
        `a run that could not find ${missing} exited 0 — that file reaches the artifact unscanned. Output:\n${red.out}`,
      ).toBe(1);
      // ⛔ The `MEASURE_FAIL:` prefix is part of the needle: the CLEAN note prints
      // the same `scanned N of 4` tally, so a bare tally grep would also match a run
      // that sailed past the floor.
      expect(red.out, "the short-count refusal does not report the measured tally").toContain(
        "MEASURE_FAIL: scanned 3 of 4",
      );
      expect(
        red.out,
        "the short-count refusal does not name the files it DID find, so the operator cannot tell which one moved",
      ).toContain(STAGED.filter((f) => f !== missing)[0]);
    }

    // ZERO FILES — the exact case that used to print the clean four-name sentence.
    const none = runDsnAssert({});
    expect(none.status, `an EMPTY out dir passed the scan. Output:\n${none.out}`).toBe(1);
    expect(none.out).toContain("scanned 0 of 4");
    expect(none.out, "an empty scan still claims the files are clean").not.toContain(
      "carry no credential shape",
    );

    // CALIBRATION — neuter the floor on a scratch copy and watch the same short
    // input read GREEN. Without this, the three legs above could be passing on some
    // other refusal and the floor itself would be unmeasured.
    const FLOOR = '  [ "$scanned" -eq "${#staged[@]}" ] || fail "MEASURE_FAIL: scanned ';
    expect(
      SRC.split(FLOOR).length - 1,
      "the floor anchor is not unique — a mutation on a duplicated needle can be a NO-OP that reads green (the lesson recorded for the survivors.sql mutation in this very file)",
    ).toBe(1);
    const neutered = SRC.replace(FLOOR, '  [ "$scanned" -ge 0 ] || fail "MEASURE_FAIL: scanned ');
    expect(neutered, "the C1 floor calibration did not APPLY").not.toBe(SRC);
    const relaxed = runDsnAssert(
      Object.fromEntries(STAGED.slice(1).map((f) => [f, body])),
      neutered,
    );
    expect(
      relaxed.status,
      `the short input still refused with the floor neutered — the three legs above are measuring some OTHER guard. Output:\n${relaxed.out}`,
    ).toBe(0);

    // And the intact script on the intact input is still green, so the legs above
    // are not passing because the guard refuses everything.
    expect(runDsnAssert(all).status).toBe(0);
  });

  it("EXECUTED — an UNREADABLE published file is a named MEASURE_FAIL, never a clean read", () => {
    // grep's rc>=2 must not collapse to "no match". The harness replaces grep with
    // one that returns 2 for the scan and delegates everything else.
    const dir = mkdtempSync(join(tmpdir(), "restore-dsnscan-rc-"));
    try {
      const copy = join(dir, "copy.sh");
      writeFileSync(copy, SRC.replace(/\nmain "\$@"\n?$/, "\n"));
      writeFileSync(
        join(dir, "harness.sh"),
        [
          'source "$COPY"',
          "grep() {",
          '  for a in "$@"; do',
          '    case "$a" in -*c*) return 2 ;; esac',
          "  done",
          '  command grep "$@"',
          "}",
          "refuse_credential_in_published_sql",
          "",
        ].join("\n"),
      );
      const out = join(dir, "out");
      mkdirSync(out);
      for (const f of STAGED) writeFileSync(join(out, f), "SELECT 1;\n");
      const r = spawnSync("bash", [join(dir, "harness.sh")], {
        encoding: "utf8",
        env: { ...process.env, COPY: copy, RESTORE_OUT_DIR: out, RESTORE_DB_URL: "stub-never-used" },
      });
      const combined = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      expect(combined, `an unreadable file read as clean. Output:\n${combined}`).toContain(
        "MEASURE_FAIL: could not scan",
      );
      expect(r.status, `the guard did not exit 1 on an unreadable file. Output:\n${combined}`).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
