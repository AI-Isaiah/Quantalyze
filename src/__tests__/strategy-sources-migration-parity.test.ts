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
 * blocks that touch `strategies_source_check` and extracts the most recent
 * CHECK list. It then asserts the SQL list equals `STRATEGY_SOURCES` as
 * sets. Pure file-read; no network, no Supabase round-trip.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { STRATEGY_SOURCES } from "@/lib/strategy-sources";

describe("STRATEGY_SOURCES ↔ supabase/migrations parity", () => {
  it("the latest strategies_source_check CHECK list equals STRATEGY_SOURCES exactly", () => {
    const migrationsDir = resolve(process.cwd(), "supabase/migrations");
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith(".sql"))
      .map((f) => ({
        name: f,
        path: join(migrationsDir, f),
        mtime: statSync(join(migrationsDir, f)).mtimeMs,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    // Walk newest-to-oldest and find the first migration that adds the
    // strategies_source_check constraint. That's the live constraint shape.
    let constraintList: string[] | null = null;
    for (let i = files.length - 1; i >= 0; i--) {
      const sql = readFileSync(files[i].path, "utf8");
      // Match: ADD CONSTRAINT strategies_source_check CHECK (source IN ( 'a', 'b', ... ));
      const match = sql.match(
        /ADD\s+CONSTRAINT\s+strategies_source_check\s+CHECK\s*\(\s*source\s+IN\s*\(([\s\S]*?)\)\s*\)/i,
      );
      if (match) {
        constraintList = [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
        break;
      }
    }

    expect(
      constraintList,
      "no migration adds strategies_source_check — check this test's regex against the migration shape",
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
