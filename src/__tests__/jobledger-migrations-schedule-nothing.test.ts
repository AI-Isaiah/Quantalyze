import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 227 JOBLEDGER (SC-2, the 164.7 rule): registration of the
 * `first_hop_enqueue_sweep` pg_cron job is a post-merge live op through
 * `docs/runbooks/jobledger-go-live.md`, never a migration. All seven phase
 * migrations auto-apply to TEST and then PROD with no human gate (CLAUDE.md,
 * 2026-09-23: the Production reviewer gate is gone), so a schedule call inside
 * any one of them would arm a job the moment the PR merges. Plans 04, 05 and 07
 * deliberately ship callables and a trigger instead.
 *
 * Why a dedicated raw-text census and not
 * `analytics-service/tests/test_ledger_refresh_gates.py::
 * test_3a_no_schedule_in_any_phase_migration`: that gate selects by closed
 * timestamp windows and covers no migration stamped after 20261009150000.
 * Widening those windows is the move its own docstring forbids, so this file
 * names its seven migrations by suffix instead (siblings:
 * `tradesync-migrations-schedule-nothing.test.ts` and
 * `outagealert-migration-schedules-nothing.test.ts`).
 *
 * The scan reads each file RAW, comments included. A header that quotes the
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

/** The seven migrations this phase ships, named by suffix so a restamp survives. */
const PHASE_MIGRATIONS = [
  { suffix: "_jobledger_attempt_failures.sql", anchor: "compute_job_attempt_failures" },
  { suffix: "_jobledger_reset_ledger_and_bridge.sql", anchor: "reset_stalled_compute_jobs" },
  { suffix: "_compute_job_claim_renewal.sql", anchor: "renew_compute_job_claims" },
  { suffix: "_reconcile_readmit_exhaustions.sql", anchor: "record_reconcile_readmit_exhaustions" },
  { suffix: "_first_hop_enqueue_sweep.sql", anchor: "first_hop_enqueue_sweep" },
  { suffix: "_poll_positions_cohort.sql", anchor: "enqueue_poll_positions_for_all_strategies" },
  { suffix: "_orphan_reaped_attempt_record.sql", anchor: "record_orphan_reaped_attempt" },
] as const;

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

describe("227 JOBLEDGER migrations schedule nothing (SC-2)", () => {
  const all = readdirSync(MIGRATIONS_DIR);

  for (const { suffix, anchor } of PHASE_MIGRATIONS) {
    describe(suffix, () => {
      const matches = all.filter((f) => f.endsWith(suffix));

      it("exists exactly once (a rename that loses it must not pass vacuously)", () => {
        expect(matches, `files ending ${suffix}`).toHaveLength(1);
      });

      it("reads non-empty and carries its own anchor token", () => {
        const body = readFileSync(join(MIGRATIONS_DIR, matches[0]), "utf8");
        expect(body.length).toBeGreaterThan(0);
        expect(body).toContain(anchor);
      });

      it("contains no pg_cron schedule or unschedule call, comments included", () => {
        const raw = readFileSync(join(MIGRATIONS_DIR, matches[0]), "utf8");
        const offenders = scheduleOffenders(raw);
        expect(
          offenders,
          `${matches[0]} carries ${offenders.join(", ")}. Registration is a post-merge live op through docs/runbooks/jobledger-go-live.md, never a migration.`,
        ).toEqual([]);
      });
    });
  }

  describe("calibration: the scan can fail (in memory, no migration is written)", () => {
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
