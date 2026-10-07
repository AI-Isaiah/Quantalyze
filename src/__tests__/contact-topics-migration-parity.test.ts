/**
 * Phase 164.6.6.3.5 DOMAINONE (plan 03) — CONTACT_TOPICS / CONTACT_SOURCES drift
 * guard.
 *
 * `CONTACT_TOPICS` and `CONTACT_SOURCES` (src/lib/contact.ts) are the runtime
 * source of truth for the Topic select, the route's Zod enum and every pointer
 * href. The database enforces the same two lists through
 * `for_quants_leads_topic_check` and `for_quants_leads_source_check`
 * (migration 20261008120000). The two are hand-typed in separate languages, so
 * they can drift silently: a TS topic with no SQL twin passes Zod and then 23514s
 * at Postgres, turning a submitted message into a 500; a SQL value with no TS twin
 * is a row the founder CRM cannot label.
 *
 * Same shape as strategy-sources-migration-parity.test.ts: walk the migrations
 * newest first, take the LAST `ADD CONSTRAINT <name> CHECK (...)` of the newest
 * file that defines the constraint, compare as SETS. Pure file read.
 *
 * ⚠️ The topic CHECK is `topic IS NULL OR topic IN (...)` (the column is NULL for
 * request_call rows), so the regex tolerates the `<col> IS NULL OR` prefix that
 * the strategy-sources analog does not have.
 *
 * Comments are stripped first, so a comment that quotes an
 * `ADD CONSTRAINT … CHECK` line cannot masquerade as the live constraint.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { CONTACT_SOURCES, CONTACT_TOPICS } from "@/lib/contact";

/** Build the ADD CONSTRAINT matcher for one named `<col> IN (...)` CHECK. */
function addConstraintRe(constraint: string, column: string): RegExp {
  return new RegExp(
    String.raw`ADD\s+CONSTRAINT\s+${constraint}\s+CHECK\s*\(\s*(?:${column}\s+IS\s+NULL\s+OR\s+)?${column}\s+IN\s*\(([\s\S]*?)\)\s*\)`,
    "gi",
  );
}

/** Strip `-- line` and block SQL comments. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

function migrationNumber(name: string): number {
  const match = name.match(/^(\d+)/);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

/**
 * The LAST CHECK list of the NEWEST migration that adds `constraint`, or null
 * when none does. Exported-in-spirit for the self-test below.
 */
function latestCheckList(
  files: { name: string; sql: string }[],
  constraint: string,
  column: string,
): string[] | null {
  const re = addConstraintRe(constraint, column);
  const ordered = [...files].sort(
    (a, b) => migrationNumber(a.name) - migrationNumber(b.name),
  );
  for (let i = ordered.length - 1; i >= 0; i--) {
    const matches = [...stripSqlComments(ordered[i].sql).matchAll(re)];
    if (matches.length > 0) {
      const last = matches[matches.length - 1];
      return [...last[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    }
  }
  return null;
}

function readMigrations(): { name: string; sql: string }[] {
  const dir = resolve(process.cwd(), "supabase/migrations");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => ({ name: f, sql: readFileSync(join(dir, f), "utf8") }));
}

describe("CONTACT_TOPICS / CONTACT_SOURCES ↔ supabase/migrations parity", () => {
  const files = readMigrations();

  it.each([
    ["for_quants_leads_topic_check", "topic", CONTACT_TOPICS],
    ["for_quants_leads_source_check", "source", CONTACT_SOURCES],
  ] as const)(
    "the latest %s list equals its TS constant exactly",
    (constraint, column, tsValues) => {
      const sqlValues = latestCheckList(files, constraint, column);

      expect(
        sqlValues,
        `no migration adds ${constraint} — check the regex against the migration shape`,
      ).not.toBeNull();
      expect(
        sqlValues?.length,
        `${constraint} parsed to an empty list — a parser that matches nothing reports agreement forever`,
      ).toBeGreaterThan(0);

      const sqlSet = new Set(sqlValues ?? []);
      const tsSet = new Set<string>(tsValues);
      const onlyInSql = [...sqlSet].filter((v) => !tsSet.has(v));
      const onlyInTs = [...tsSet].filter((v) => !sqlSet.has(v));

      expect(
        { onlyInSql, onlyInTs },
        `${column} list drifted between src/lib/contact.ts and ${constraint}. ` +
          "Either add the missing values to the other side, or write a migration " +
          "that moves the SQL CHECK to match TS.",
      ).toEqual({ onlyInSql: [], onlyInTs: [] });
    },
  );

  describe("parser self-test (both polarities)", () => {
    const live = `ALTER TABLE t DROP CONSTRAINT IF EXISTS c_topic_check;
      ALTER TABLE t ADD CONSTRAINT c_topic_check
        CHECK (topic IS NULL OR topic IN ('a', 'b'));`;

    it("reads a CHECK with the IS NULL OR prefix", () => {
      expect(
        latestCheckList([{ name: "1_x.sql", sql: live }], "c_topic_check", "topic"),
      ).toEqual(["a", "b"]);
    });

    it("reads a CHECK without the prefix", () => {
      expect(
        latestCheckList(
          [
            {
              name: "1_x.sql",
              sql: "ALTER TABLE t ADD CONSTRAINT c_source_check CHECK (source IN ('x','y'));",
            },
          ],
          "c_source_check",
          "source",
        ),
      ).toEqual(["x", "y"]);
    });

    it("ignores a commented-out constraint", () => {
      const commented = `-- ALTER TABLE t ADD CONSTRAINT c_topic_check CHECK (topic IN ('zzz'));
        /* ADD CONSTRAINT c_topic_check CHECK (topic IN ('yyy')) */`;
      expect(
        latestCheckList(
          [{ name: "1_x.sql", sql: commented }],
          "c_topic_check",
          "topic",
        ),
      ).toBeNull();
    });

    it("takes the newest migration by number, not by name order", () => {
      const older = "ALTER TABLE t ADD CONSTRAINT c_topic_check CHECK (topic IN ('old'));";
      const newer = "ALTER TABLE t ADD CONSTRAINT c_topic_check CHECK (topic IN ('new'));";
      expect(
        latestCheckList(
          [
            { name: "1000_a.sql", sql: older },
            { name: "20260101000000_b.sql", sql: newer },
          ],
          "c_topic_check",
          "topic",
        ),
      ).toEqual(["new"]);
    });
  });
});
