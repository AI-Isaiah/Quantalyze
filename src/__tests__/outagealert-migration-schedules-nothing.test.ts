import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 164.6.8 OUTAGEALERT (D-10): registration of the `ops_staleness_check`
 * pg_cron job is a founder LIVE op through `docs/runbooks/ops-staleness-go-live.md`,
 * never a migration. Migrations auto-apply to TEST and then PROD with no human
 * gate (CLAUDE.md, 2026-09-23: the Production reviewer gate is gone), so a
 * schedule call inside the migration would arm an hourly secret-bearing
 * outbound POST the moment the PR merges.
 *
 * Why a dedicated raw-text census and not
 * `analytics-service/tests/test_ledger_refresh_gates.py::
 * test_3a_no_schedule_in_any_phase_migration`: that gate selects by closed
 * timestamp windows and covers no migration stamped after 20261009150000.
 * Widening those windows is the move its own docstring forbids, so this file
 * names its migration by suffix instead (the sibling is
 * `tradesync-migrations-schedule-nothing.test.ts`).
 *
 * The scan reads the file RAW, comments included. A header that quotes the
 * dotted call fails the build on purpose: prose headers here say "the pg_cron
 * schedule call" and nothing more. `'a' || 'b'` concatenations are folded
 * before the scan so an assembled call is as visible as a literal one.
 *
 * The forbidden tokens are built from parts below so this file does not itself
 * carry the dotted call in its source.
 *
 * RESIDUAL (recorded, not closed): a call assembled through a variable across
 * statements is invisible to any static scan. The runbook rule is what bounds it.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** The one migration this phase ships, named by suffix so a restamp survives. */
const SUFFIX = "_ops_staleness_check.sql";
const ANCHOR = "ops_staleness_check";

const SCHEDULE_TOKENS = [
  ["cron", "schedule"].join("."),
  ["cron", "unschedule"].join("."),
] as const;

const SQL_CONCAT_RE = /'((?:[^']|'')*)'\s*\|\|\s*'((?:[^']|'')*)'/g;

/** Collapse `'a' || 'b'` into `'ab'`, repeatedly (mirror of the python gate). */
function foldSqlConcatenations(text: string): string {
  let folded = text;
  for (let i = 0; i < 32; i++) {
    const collapsed = folded.replace(
      SQL_CONCAT_RE,
      (_m, a: string, b: string) => `'${a}${b}'`,
    );
    if (collapsed === folded) break;
    folded = collapsed;
  }
  return folded;
}

/** The scan under test: which forbidden tokens does this raw text carry? */
function scheduleOffenders(raw: string): string[] {
  const folded = foldSqlConcatenations(raw).toLowerCase();
  return SCHEDULE_TOKENS.filter((t) => folded.includes(t));
}

describe("164.6.8 ops_staleness_check migration schedules nothing (D-10)", () => {
  const matches = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(SUFFIX));

  it("exists exactly once (a rename that loses it must not pass vacuously)", () => {
    expect(matches, `files ending ${SUFFIX}`).toHaveLength(1);
  });

  it("reads non-empty and carries its own anchor token", () => {
    const body = readFileSync(join(MIGRATIONS_DIR, matches[0]), "utf8");
    expect(body.length).toBeGreaterThan(0);
    expect(body).toContain(ANCHOR);
  });

  it("contains no pg_cron schedule or unschedule call, comments included", () => {
    const raw = readFileSync(join(MIGRATIONS_DIR, matches[0]), "utf8");
    const offenders = scheduleOffenders(raw);
    expect(
      offenders,
      `${matches[0]} carries ${offenders.join(", ")}. Registration is a founder live op through docs/runbooks/ops-staleness-go-live.md, never a migration.`,
    ).toEqual([]);
  });

  describe("calibration: the scan can fail (in memory, the migration is never written)", () => {
    const [schedule, unschedule] = SCHEDULE_TOKENS;

    it("catches a token sitting in a comment", () => {
      expect(scheduleOffenders(`-- see ${schedule}(...) later\nSELECT 1;`)).toEqual([schedule]);
    });

    it("catches a token assembled by string concatenation", () => {
      const assembled = `SELECT 'cron.sch' || 'edule'('x', '* * * * *', 'SELECT 1');`;
      expect(scheduleOffenders(assembled)).toEqual([schedule]);
    });

    it("catches the unschedule form, in any case", () => {
      expect(scheduleOffenders(`SELECT ${unschedule.toUpperCase()}('x');`)).toEqual([unschedule]);
    });

    it("passes clean prose that names the call without the dotted token", () => {
      expect(scheduleOffenders("-- the pg_cron schedule call lives in the runbook")).toEqual([]);
    });
  });
});
