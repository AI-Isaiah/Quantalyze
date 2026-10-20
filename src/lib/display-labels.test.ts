/**
 * Phase 170.1.2 LABELS (D-01) — the label vocabularies agree with the database.
 *
 * WHY THIS EXISTS. A label map is hand-typed in TypeScript while the values it
 * labels are a SQL CHECK set. When the database admits a new value (a new
 * compute-job kind, say) and the map lacks it, the page falls through to the
 * fallback label and an operator reads "Other job" for a real job. This census
 * parses `supabase/schema/baseline.sql` and fails when a vocabulary's key set
 * differs from its CHECK set, in either direction, naming the constraint.
 *
 * The census reads the committed baseline dump, so a migration newer than the
 * dump is invisible to it. The last test in this file closes that gap: it fails
 * when a migration the dump does not carry touches a constraint under test, and
 * the fix is to re-dump the baseline (or extend the vocabulary) in that commit.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { COMPUTE_JOB_KIND_LABELS, computeJobKindLabel, labelOf } from "./display-labels";

const REPO_ROOT = join(__dirname, "..", "..");

function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--[^\n]*/g, "");
}

const BASELINE = stripSqlComments(
  readFileSync(join(REPO_ROOT, "supabase", "schema", "baseline.sql"), "utf8"),
);

/**
 * The value list of `CONSTRAINT "<name>" CHECK (("<col>" = ANY (ARRAY[...])))`
 * in the baseline dump, with the `::"text"` casts dropped. Throws unless the
 * constraint appears exactly once, so a rename or a second declaration fails
 * loud instead of comparing against nothing.
 */
function checkSet(constraintName: string): string[] {
  const re = new RegExp(
    `CONSTRAINT "${constraintName}" CHECK \\(\\("[a-z_]+" = ANY \\(ARRAY\\[([^\\]]*)\\]`,
    "g",
  );
  const matches = [...BASELINE.matchAll(re)];
  if (matches.length !== 1) {
    throw new Error(
      `${constraintName}: expected exactly 1 ARRAY check in baseline.sql, found ${matches.length}`,
    );
  }
  const values = [...matches[0][1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  expect(values.length, `${constraintName} captured no values`).toBeGreaterThan(0);
  return values;
}

function expectSameSet(constraint: string, keys: string[]) {
  const sql = checkSet(constraint);
  const onlyInSql = sql.filter((v) => !keys.includes(v));
  const onlyInTs = keys.filter((k) => !sql.includes(k));
  expect(
    { onlyInSql, onlyInTs },
    `${constraint}: the label map and the database CHECK set differ. onlyInSql = values the database admits with no label; onlyInTs = labels for values the database no longer admits.`,
  ).toEqual({ onlyInSql: [], onlyInTs: [] });
}

describe("labelOf", () => {
  const map = { a: "Alpha" };

  it("returns the label for an own key", () => {
    expect(labelOf(map, "a", "Fallback")).toBe("Alpha");
  });

  it("returns the fallback for a value outside the map, never the raw value", () => {
    expect(labelOf(map, "nope", "Fallback")).toBe("Fallback");
  });

  it("returns the fallback for prototype keys and non-strings", () => {
    expect(labelOf(map, "constructor", "Fallback")).toBe("Fallback");
    expect(labelOf(map, "__proto__", "Fallback")).toBe("Fallback");
    expect(labelOf(map, "toString", "Fallback")).toBe("Fallback");
    expect(labelOf(map, null, "Fallback")).toBe("Fallback");
    expect(labelOf(map, undefined, "Fallback")).toBe("Fallback");
  });
});

describe("compute-job kind vocabulary", () => {
  it("labels a real kind", () => {
    expect(computeJobKindLabel("sync_trades")).toBe("Trade sync");
  });

  it("falls back to 'Other job' outside the closed set, never the raw value", () => {
    expect(computeJobKindLabel("nope")).toBe("Other job");
    expect(computeJobKindLabel("constructor")).toBe("Other job");
    expect(computeJobKindLabel("__proto__")).toBe("Other job");
    expect(computeJobKindLabel(null)).toBe("Other job");
  });

  it("covers exactly compute_jobs_kind_check", () => {
    expectSameSet("compute_jobs_kind_check", Object.keys(COMPUTE_JOB_KIND_LABELS));
  });
});

describe("census freshness", () => {
  // Constraint names under test. Extended with every vocabulary.
  const CONSTRAINTS = ["compute_jobs_kind_check"];

  it("no migration newer than the baseline touches a constraint under test", () => {
    const carried = readFileSync(
      join(REPO_ROOT, "supabase", "schema", "baseline-carried-migrations.txt"),
      "utf8",
    )
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\d{14}_.*\.sql$/.test(l))
      .sort();
    const lastCarried = carried[carried.length - 1];
    expect(lastCarried, "baseline-carried-migrations.txt lists no migration").toBeTruthy();

    const migrationsDir = join(REPO_ROOT, "supabase", "migrations");
    const newer = readdirSync(migrationsDir)
      .filter((f) => /^\d{14}_.*\.sql$/.test(f))
      .filter((f) => f > lastCarried)
      .sort();
    const offenders: string[] = [];
    for (const f of newer) {
      const sql = stripSqlComments(readFileSync(join(migrationsDir, f), "utf8"));
      for (const c of CONSTRAINTS) {
        if (sql.includes(c)) offenders.push(`${f} mentions ${c}`);
      }
    }
    expect(
      offenders,
      "a migration newer than baseline.sql changes a constraint whose label map the census checks against the dump; re-dump the baseline in that commit, or the census compares a stale set",
    ).toEqual([]);
  });
});
