import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

// Regression guard for audit-2026-05-07 G12.A.3 — trades.side CHECK constraint.
//
// Migration 001 created `trades` with `side TEXT NOT NULL` and no CHECK
// constraint. positions.side has CHECK (side IN ('long','short')) but
// trades.side was unconstrained, while worker code branches on
// 'buy' / 'sell' / 'long' / 'short' interchangeably. _compute_volume_metrics
// historically aliased `long_volume_pct = buy_pct`. The audit (HIGH conf=10)
// flagged the type-conflation as a recurring source of silent metric bugs.
//
// Migration 112 adds a CHECK constraint admitting only {'buy','sell'}.
// This test:
//   1. Asserts migration 112 contains both ADD CONSTRAINT and VALIDATE.
//   2. Asserts the constraint name `trades_side_check` is present.
//   3. Asserts the migration includes a self-verifying DO block that fails
//      loud if the constraint is dropped or weakened in a later migration.
//   4. Walks every later migration and asserts no silent DROP without
//      re-add (mirrors strategies-source-csv-constraint.test.ts pattern).
//
// Pure text-based regression — no live DB required.

const REPO_ROOT = join(__dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");

describe("trades.side CHECK constraint (audit-2026-05-07 G12.A.3 regression guard)", () => {
  const filename = "20260510181440_trades_side_check_constraint.sql";
  const path = join(MIGRATIONS_DIR, filename);

  it("migration 112 exists", () => {
    const sql = readFileSync(path, "utf8");
    expect(sql.length).toBeGreaterThan(0);
  });

  it("migration 112 ADDs the trades_side_check CHECK constraint admitting {buy,sell}", () => {
    const sql = readFileSync(path, "utf8");
    expect(sql).toMatch(/ADD\s+CONSTRAINT\s+trades_side_check/i);
    expect(sql).toMatch(/CHECK\s*\(\s*side\s+IN\s*\(\s*'buy'\s*,\s*'sell'\s*\)\s*\)/i);
  });

  it("migration 112 uses NOT VALID + VALIDATE for short-lock-window apply", () => {
    // NOT VALID makes the ADD CONSTRAINT a metadata-only ALTER (no table
    // scan); VALIDATE in a separate statement allows reads to continue
    // during the scan. Required pattern for a non-empty production
    // table — locks the whole table briefly otherwise.
    const sql = readFileSync(path, "utf8");
    expect(sql).toMatch(/NOT\s+VALID/i);
    expect(sql).toMatch(/VALIDATE\s+CONSTRAINT\s+trades_side_check/i);
  });

  it("migration 112 RAISEs if existing rows violate the constraint (no silent breakage)", () => {
    // The migration must survey existing distinct side values BEFORE
    // adding the constraint and RAISE with a clear admin-actionable
    // message if anything is outside {buy,sell}. We do NOT silently
    // delete or coerce — preserves the audit trail of bad data.
    const sql = readFileSync(path, "utf8");
    expect(sql).toMatch(/side\s+NOT\s+IN\s*\(\s*'buy'\s*,\s*'sell'\s*\)/i);
    expect(sql).toMatch(/RAISE\s+EXCEPTION/i);
    expect(sql).toMatch(/G12\.A\.3/);
  });

  it("migration 112 includes a self-verifying DO block via pg_constraint", () => {
    // Self-verify: assert the constraint actually exists in pg_constraint
    // after CREATE so a future migration that silently drops it fails
    // loud at apply time.
    const sql = readFileSync(path, "utf8");
    expect(sql).toMatch(/pg_catalog\.pg_constraint/);
    expect(sql).toMatch(/trades_side_check/);
    expect(sql).toMatch(/Migration 112 verification failed/);
  });

  it("no later migration silently drops trades_side_check without re-adding it", () => {
    // If a future migration drops the constraint, it MUST re-add an
    // equivalent or stronger CHECK that includes both 'buy' and 'sell'.
    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => /^\d{3,}_.+\.sql$/.test(f))
      .sort();
    for (const file of files) {
      const num = Number.parseInt(file.slice(0, 3), 10);
      if (Number.isNaN(num) || num <= 112) continue;
      const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
      const drops = sql.match(/DROP\s+CONSTRAINT[^;]*trades_side_check/gi);
      if (!drops) continue;
      // If this file drops the constraint, it must also re-ADD a CHECK
      // that admits 'buy' and 'sell'.
      const reAddsBuyAndSell =
        /ADD\s+CONSTRAINT\s+\w+[\s\S]+?CHECK[\s\S]+?'buy'[\s\S]+?'sell'/i.test(sql) ||
        /ADD\s+CONSTRAINT\s+\w+[\s\S]+?CHECK[\s\S]+?'sell'[\s\S]+?'buy'/i.test(sql);
      expect(reAddsBuyAndSell).toBe(true);
    }
  });
});
