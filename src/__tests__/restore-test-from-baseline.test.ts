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
import { readFileSync, readdirSync } from "node:fs";

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
  it("EXPECTED_ARMS=21 is a live line, exactly once, with its MEASURED date beside it", () => {
    const region = selfTestRegion(SRC);
    expect(
      liveCount(region, "EXPECTED_ARMS=21"),
      "the arm ratchet is no longer a single live `EXPECTED_ARMS=21` line in the self-test region. A commented-out ratchet is not a ratchet, and two of them can disagree.",
    ).toBe(1);

    // SC-9 (`gate-family-meta.test.ts:18-30`): a threshold constant needs a
    // measurement token AND a date beside it, or nobody can tell a measured floor
    // from a guessed one.
    const lines = region.split("\n");
    const at = lines.findIndex((l) => isLive(l) && l.includes("EXPECTED_ARMS=21"));
    const beside = `${lines[at - 1] ?? ""}\n${lines[at]}`;
    expect(
      beside,
      "EXPECTED_ARMS=21 carries no MEASURED date on its own or the preceding line — SC-9",
    ).toContain("MEASURED 2026-09-08");

    // The harness must ASSERT the count, not merely print it.
    expect(liveCount(region, 'if [ "$total" -ne "$EXPECTED_ARMS" ]; then')).toBe(1);
    expect(liveCount(region, 'if [ "$pass" -ne "$total" ]; then')).toBe(1);

    // CALIBRATION — comment the constant out; a whole-file `toContain` would
    // still pass, this pin must not.
    const commented = SRC.replace("\nEXPECTED_ARMS=21\n", "\n# EXPECTED_ARMS=21\n");
    expect(commented).not.toBe(SRC);
    expect(liveCount(selfTestRegion(commented), "EXPECTED_ARMS=21")).toBe(0);

    // CALIBRATION — a second copy of the constant is a disagreement waiting to
    // happen, and must fail the "exactly once" leg.
    const doubled = SRC.replace("\nEXPECTED_ARMS=21\n", "\nEXPECTED_ARMS=21\nEXPECTED_ARMS=21\n");
    expect(doubled).not.toBe(SRC);
    expect(liveCount(selfTestRegion(doubled), "EXPECTED_ARMS=21")).toBe(2);
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
      "\nEXPECTED_ARMS=21\n",
      `\n# ⚠️ THIS IS THE ${interimWord} (Phase 164.8 plan 01)\nEXPECTED_ARMS=21\n`,
    );
    expect(restored).not.toBe(SRC);
    expect(restored.includes(interimWord)).toBe(true);
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
    // The restated list from `prod-prober-wiring.test.ts:93-96`. Three must be
    // ABSENT outright; two are legitimate rc-handling in this script and are an
    // EXACT-SET COUNT with a justification, the `gate-family-meta.test.ts` idiom —
    // pinned at the measured number so a NEW one is a red rather than an
    // unnoticed widening.
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
    // `set +e`   x6 — six measurements whose rc is captured and then CHECKED: five
    //                 `grep -ac` counts (`[ "$rc" -le 1 ] || fail MEASURE_FAIL …`) and
    //                 the shared normalizer's `--function-names` run
    //                 (`[ "$frc" -eq 0 ] || fail MEASURE_FAIL …`). That is the
    //                 OPPOSITE of softening: it turns a broken grep or a crashed
    //                 normalizer into a hard failure instead of a silent zero.
    const run = runRegion(SRC);
    const runLive = liveLines(run).map(({ line }) => line).join("\n");
    for (const token of ["continue-on-error", "exit 0", "::warning"]) {
      expect(
        runLive.includes(token),
        `the --run region now carries the softening token \`${token}\``,
      ).toBe(false);
    }
    const ALLOWED: Record<string, number> = { "|| true": 4, "set +e": 6 };
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
