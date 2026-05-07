/**
 * Phase 18 / Claude adversarial 2026-05-07 — STRATEGY_SOURCES drift guard.
 *
 * `STRATEGY_SOURCES` (src/lib/strategy-sources.ts) is the runtime source of
 * truth for the `strategies.source` enum: AdminTabs.sourceBadgeLabel uses it
 * for an exhaustiveness `Record<StrategySource, string>` lookup, downstream
 * code paths import its `isStrategySource` type guard, and migration 100's
 * SQL CHECK constraint must agree exactly. The two are hand-typed in
 * separate languages, so they can drift silently — adding a value to the
 * SQL CHECK without updating TS would let prod insert rows the admin UI
 * cannot label; adding a value to TS without a paired migration would
 * crash inserts at the Postgres layer.
 *
 * This test scans every supabase/migrations/*.sql file for ALTER TABLE
 * blocks that touch `strategies_source_check` and extracts the LATEST
 * (last) CHECK list from the LATEST migration file. It then asserts the
 * SQL list equals `STRATEGY_SOURCES` as sets. Pure file-read; no network,
 * no Supabase round-trip.
 *
 * Round-2 hardening:
 *  - Sort migrations by extracted leading numeric prefix, NOT lex (so
 *    `1000_*.sql` doesn't sort before `100_*.sql`).
 *  - Use matchAll + last-match-per-file (matches Postgres last-wins
 *    semantics for repeated ADD CONSTRAINT in one file).
 *  - Strip SQL comments (-- and / * ... * /) before regex so a comment
 *    that quotes `ADD CONSTRAINT strategies_source_check ...` cannot
 *    silently masquerade as the live constraint.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { STRATEGY_SOURCES } from "@/lib/strategy-sources";

const ADD_CONSTRAINT_RE =
  /ADD\s+CONSTRAINT\s+strategies_source_check\s+CHECK\s*\(\s*source\s+IN\s*\(([\s\S]*?)\)\s*\)/gi;

/** Strip `-- line` and `/* block * /` SQL comments. Conservative: a `--`
 *  inside a string literal would be incorrectly treated as a comment, but
 *  no Phase 18 migration has that shape. */
function stripSqlComments(sql: string): string {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "");
}

function migrationNumber(name: string): number {
  const match = name.match(/^(\d+)/);
  return match ? Number.parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
}

describe("STRATEGY_SOURCES ↔ supabase/migrations parity", () => {
  it("the latest strategies_source_check CHECK list equals STRATEGY_SOURCES exactly", () => {
    const migrationsDir = resolve(process.cwd(), "supabase/migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => ({
        name: f,
        path: join(migrationsDir, f),
      }))
      .sort((a, b) => migrationNumber(a.name) - migrationNumber(b.name));

    // Walk newest-to-oldest. Stop at the first migration that ADDs
    // strategies_source_check; within that file pick the LAST add
    // (Postgres last-wins) — the previous matchAll handles a fix-and-revert
    // sequence in one file.
    let constraintList: string[] | null = null;
    for (let i = files.length - 1; i >= 0; i--) {
      const sql = stripSqlComments(readFileSync(files[i].path, "utf8"));
      const matches = [...sql.matchAll(ADD_CONSTRAINT_RE)];
      if (matches.length > 0) {
        const last = matches[matches.length - 1];
        constraintList = [...last[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
        break;
      }
    }

    expect(
      constraintList,
      "no migration adds strategies_source_check — check the regex against the migration shape",
    ).not.toBeNull();

    const sqlSet = new Set(constraintList ?? []);
    const tsSet = new Set(STRATEGY_SOURCES);

    const onlyInSql = [...sqlSet].filter((v) => !tsSet.has(v as never));
    const onlyInTs = [...tsSet].filter((v) => !sqlSet.has(v));

    expect(
      { onlyInSql, onlyInTs },
      "STRATEGY_SOURCES drifted from the latest strategies_source_check migration. " +
        "Either add the missing values to the other side, or write a migration that " +
        "narrows the SQL CHECK to match TS.",
    ).toEqual({ onlyInSql: [], onlyInTs: [] });
  });
});
