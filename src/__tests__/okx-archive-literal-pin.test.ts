import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 167.1.2.2.2.1 OKXHISTORY, D-05 — the one source literal two languages share.
 *
 * `public.apply_okx_archive_rebuild` writes each rebuilt range into
 * `strategy_analytics.series_provenance.reconstructed_ranges` with the source
 * literal `okx_bills_history_archive`. The TypeScript reader
 * (`parseReconstructedRanges`) keeps a range ONLY when its `source` equals
 * `RECONSTRUCTED_SOURCE`. If the two ever disagree the write still succeeds, the
 * reader drops every range as "foreign", and the factsheet silently stops saying
 * which days were rebuilt from the archive: an honesty claim lost with no error.
 *
 * The Python side never sends the literal. The RPC pins it as a function-local
 * CONSTANT, so this pin has exactly two sides: the SQL constant and the TS export.
 *
 * Both files are read RAW from disk. Each read is asserted non-empty AND to contain
 * its own anchor, so a moved or emptied file fails here instead of letting two
 * `undefined`s compare equal. The expected value is also written out once below as
 * an independent literal: neither side can drift together with the other and stay
 * green.
 */

const PINNED_SOURCE = "okx_bills_history_archive";

const root = process.cwd();
const migrationsDir = join(root, "supabase", "migrations");
const tsPath = join(root, "src", "lib", "factsheet", "trade-fetch-provenance.ts");

function migrationPaths(): string[] {
  // Top-level files only: `down/` holds the manual rollback, which carries no function body.
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith("_okx_archive_rebuild.sql"))
    .map((f) => join(migrationsDir, f));
}

describe("D-05 — apply_okx_archive_rebuild and the TS reader share one source literal", () => {
  it("exactly one migration file defines the rebuild function (a rename cannot pass vacuously)", () => {
    const found = migrationPaths();
    expect(found, `found: ${found.join(", ")}`).toHaveLength(1);
  });

  it("reads both sides non-empty, each carrying its own anchor", () => {
    expect(existsSync(tsPath)).toBe(true);
    const sql = readFileSync(migrationPaths()[0], "utf8");
    const ts = readFileSync(tsPath, "utf8");
    expect(sql.length).toBeGreaterThan(0);
    expect(ts.length).toBeGreaterThan(0);
    expect(sql).toContain("apply_okx_archive_rebuild");
    expect(ts).toContain("parseReconstructedRanges");
  });

  it("the SQL function's source constant equals the TS RECONSTRUCTED_SOURCE, and both equal the pinned literal", () => {
    const sql = readFileSync(migrationPaths()[0], "utf8");
    const ts = readFileSync(tsPath, "utf8");

    const sqlMatch = /\bc_source\s+CONSTANT\s+text\s*:=\s*'([^']*)'/.exec(sql);
    const tsMatch = /export\s+const\s+RECONSTRUCTED_SOURCE\s*=\s*"([^"]*)"/.exec(ts);
    expect(sqlMatch, "no `c_source CONSTANT text := '...'` assignment in the migration").not.toBeNull();
    expect(tsMatch, "no `export const RECONSTRUCTED_SOURCE = \"...\"` in trade-fetch-provenance.ts").not.toBeNull();

    expect(sqlMatch![1]).toBe(tsMatch![1]);
    expect(sqlMatch![1]).toBe(PINNED_SOURCE);
    expect(tsMatch![1]).toBe(PINNED_SOURCE);
  });

  it("the function writes the constant into each appended range and filters on it, never a second literal", () => {
    const sql = readFileSync(migrationPaths()[0], "utf8");
    // The appended object takes its `source` from the constant ...
    expect(sql).toMatch(/'source'\s*,\s*c_source\b/);
    // ... and the already-applied check compares against the same constant.
    expect(sql).toMatch(/r\s*->>\s*'source'\s*=\s*c_source\b/);
  });
});
