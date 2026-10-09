import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 167.1.2.2.2 TRADESYNC (SC-1, the 164.7 rule): registration of the
 * `cron_sync_tick` pg_cron job is a founder LIVE op through the go-live
 * runbook, never a migration. Both migrations auto-apply to TEST then PROD
 * with no human gate, so a schedule call inside either one would arm a
 * daily secret-bearing outbound POST the moment the PR merges.
 *
 * Why a dedicated raw-text census and not
 * `analytics-service/tests/test_ledger_refresh_gates.py::
 * test_3a_no_schedule_in_any_phase_migration`: that gate selects by closed
 * timestamp windows and covers no migration stamped after 20261009150000.
 * Widening those windows is the move its own docstring forbids, so this file
 * names its two migrations by suffix instead.
 *
 * The scan reads the file RAW, comments included. A header that quotes the
 * dotted call fails the build on purpose: prose headers here say "the pg_cron
 * schedule call" and nothing more. `'a' || 'b'` concatenations are folded
 * before the scan so an assembled call is as visible as a literal one.
 *
 * RESIDUAL (recorded, not closed): a call assembled through a variable across
 * statements is invisible to any static scan. The runbook rule is what bounds it.
 */

const MIGRATIONS_DIR = join(process.cwd(), "supabase", "migrations");

/** The two migrations this phase ships, named by suffix so a restamp survives. */
const PHASE_MIGRATIONS = [
  { suffix: "_cron_sync_tick.sql", anchor: "cron_sync_tick" },
  {
    suffix: "_strategy_analytics_trade_fetch_provenance.sql",
    anchor: "trades_fetched_at",
  },
] as const;

const SCHEDULE_TOKENS = ["cron.schedule", "cron.unschedule"] as const;

const SQL_CONCAT_RE = /'((?:[^']|'')*)'\s*\|\|\s*'((?:[^']|'')*)'/gs;

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

describe("167.1.2.2.2 migrations schedule nothing (SC-1)", () => {
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
        const folded = foldSqlConcatenations(raw).toLowerCase();
        const offenders = SCHEDULE_TOKENS.filter((t) => folded.includes(t));
        expect(
          offenders,
          `${matches[0]} carries ${offenders.join(", ")}. Registration is a founder live op through the go-live runbook, never a migration.`,
        ).toEqual([]);
      });
    });
  }
});
