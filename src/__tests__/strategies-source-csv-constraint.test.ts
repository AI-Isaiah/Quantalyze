import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// Regression guard surfaced 2026-05-06 during Phase 18 founder UAT.
//
// Phase 15 migration 093 shipped a `finalize_csv_strategy` SECURITY DEFINER
// RPC that does `INSERT INTO strategies (..., source, ...) VALUES (..., 'csv', ...)`.
// The pre-existing `strategies_source_check` constraint (created by an earlier
// migration before Phase 15) only admitted {legacy, wizard, admin_import,
// allocator_connected}. The Phase 15 PR forgot to ALTER that constraint.
//
// Symptom: every CSV-finalize submission returned HTTP 500 with Postgres error
// `new row for relation "strategies" violates check constraint "strategies_source_check"`.
// Every CSV-onboarded team was blocked. The bug was invisible to existing tests
// because no Phase 15 test exercised the live constraint — they all stubbed Supabase.
//
// Migration 100 (2026-05-06) extends the constraint to admit 'csv' (plus
// {okx, binance, bybit} for Phase 19 BACKBONE-04 forward-compat).
//
// This regression guard is text-only against the migration files — it does not
// hit a live database. The combination of the migration file + this guard
// prevents the constraint from drifting back to the broken state without anyone
// noticing.

const REPO_ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

describe("strategies.source check constraint admits 'csv' (Phase 18 / FIX-03 regression guard)", () => {
  it("migration 20260506211806_strategies_source_csv.sql exists and extends the constraint", () => {
    const filename = "20260506211806_strategies_source_csv.sql";
    const path = join(MIGRATIONS_DIR, filename);
    const sql = readFileSync(path, "utf8");

    // The migration MUST drop the old constraint and add a new one that
    // admits 'csv'. Both are required — adding without dropping leaves the
    // old broken constraint in place; dropping without adding creates a
    // permissive table.
    expect(sql).toMatch(/DROP\s+CONSTRAINT\s+IF\s+EXISTS\s+strategies_source_check/i);
    expect(sql).toMatch(/ADD\s+CONSTRAINT\s+strategies_source_check/i);
    expect(sql).toMatch(/CHECK\s*\(\s*source\s+IN\s*\(/i);

    // The CHECK clause MUST include 'csv' as an admitted value.
    expect(sql).toContain("'csv'");
  });

  it("finalize_csv_strategy RPC (migration 093) inserts source='csv' (proves the constraint actually matters)", () => {
    // If a future refactor changes the RPC to insert source='wizard' instead,
    // this test would still need to be updated — but the new behavior would
    // also need to be intentional. The contract is: whatever value the RPC
    // inserts, the strategies_source_check constraint must admit it.
    const path = join(MIGRATIONS_DIR, "20260501055202_strategy_verifications.sql");
    const sql = readFileSync(path, "utf8");
    // The INSERT INTO strategies block in 093 sets source = 'csv'.
    expect(sql).toMatch(/INSERT\s+INTO\s+strategies[\s\S]+?'pending_review',\s*'csv'/i);
  });

  it("no later migration silently re-narrows the strategies_source_check constraint", () => {
    // If a future migration drops the constraint without re-adding it with
    // 'csv' included, that re-introduces the bug. Walk every migration file
    // numbered >= 100 and assert: any DROP CONSTRAINT strategies_source_check
    // is followed by an ADD CONSTRAINT that includes 'csv'.
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{3,}_.+\.sql$/.test(f))
      .sort();
    for (const file of files) {
      const num = Number.parseInt(file.slice(0, 3), 10);
      if (Number.isNaN(num) || num < 100) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      const drops = sql.match(/DROP\s+CONSTRAINT[^;]+strategies_source_check/gi);
      if (!drops) continue;
      // If the file drops the constraint, it MUST re-add one that includes 'csv'.
      const hasCsvInAdd =
        /ADD\s+CONSTRAINT\s+strategies_source_check[\s\S]+?'csv'/i.test(sql);
      expect(hasCsvInAdd).toBe(true);
    }
  });
});
