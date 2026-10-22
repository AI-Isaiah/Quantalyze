import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Phase 167.2.1.1.2 ACCTREBUILD, D-03 / AR-3 — the boundary record's two-language contract.
 *
 * `public.replace_allocator_equity_snapshots_window` writes the rebuild seam as ONE
 * `allocator_equity_derived` row: `kind = 'snapshot_rebuild_boundary'`, payload
 * `{"boundary_date": "YYYY-MM-DD"}`. The TypeScript reader (`parseSnapshotRebuildBoundary`,
 * `SNAPSHOT_REBUILD_BOUNDARY_KIND`) keeps a boundary ONLY when the payload carries the key
 * `boundary_date`. If the SQL writer and the TS reader ever disagree the write still
 * succeeds, the reader finds no row or no key and names no boundary: the seam is lost
 * with no error and no compiler between the two languages to say so.
 *
 * Both files are read RAW from disk. Each read is asserted non-empty AND to contain its
 * own anchor, so a moved or emptied file fails here instead of letting two `undefined`s
 * compare equal. The expected values are also written out once below as independent
 * literals: neither side can drift together with the other and stay green.
 *
 * The SQL is read with `--` comment lines stripped, so a stale comment that still names
 * the old literal cannot satisfy a statement-level assertion.
 */

const PINNED_KIND = "snapshot_rebuild_boundary";
const PINNED_KEY = "boundary_date";

const root = process.cwd();
const migrationsDir = join(root, "supabase", "migrations");
const tsPath = join(root, "src", "lib", "snapshot-rebuild-boundary.ts");

function migrationPaths(): string[] {
  // Top-level files only: `down/` holds the manual rollback, which carries no function body.
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith("_replace_allocator_equity_snapshots_window.sql"))
    .map((f) => join(migrationsDir, f));
}

/** The migration with whole-line `--` comments removed. */
function readSqlStatements(): string {
  return readFileSync(migrationPaths()[0], "utf8")
    .split("\n")
    .filter((line) => !/^\s*--/.test(line))
    .join("\n");
}

describe("D-03 — replace_allocator_equity_snapshots_window and the TS reader share one boundary kind and key", () => {
  it("exactly one migration file defines the window-replace function (a rename cannot pass vacuously)", () => {
    const found = migrationPaths();
    expect(found, `found: ${found.join(", ")}`).toHaveLength(1);
  });

  it("reads both sides non-empty, each carrying its own anchor", () => {
    expect(existsSync(tsPath)).toBe(true);
    const sql = readSqlStatements();
    const ts = readFileSync(tsPath, "utf8");
    expect(sql.length).toBeGreaterThan(0);
    expect(ts.length).toBeGreaterThan(0);
    expect(sql).toContain("replace_allocator_equity_snapshots_window");
    expect(ts).toContain("parseSnapshotRebuildBoundary");
  });

  it("the TS SNAPSHOT_REBUILD_BOUNDARY_KIND equals the pinned kind", () => {
    const ts = readFileSync(tsPath, "utf8");
    const tsMatch = /export\s+const\s+SNAPSHOT_REBUILD_BOUNDARY_KIND\s*=\s*"([^"]*)"/.exec(ts);
    expect(tsMatch, "no `export const SNAPSHOT_REBUILD_BOUNDARY_KIND = \"...\"` in snapshot-rebuild-boundary.ts").not.toBeNull();
    expect(tsMatch![1]).toBe(PINNED_KIND);
  });

  it("the SQL writes and deletes the boundary row under the same kind, never a second literal", () => {
    const sql = readSqlStatements();
    // The upsert names the kind as the second inserted value ...
    expect(sql).toMatch(
      new RegExp(`VALUES\\s*\\(\\s*p_allocator_id\\s*,\\s*'${PINNED_KIND}'\\s*,`),
    );
    // ... and the no-older-day branch deletes the same kind.
    expect(sql).toMatch(new RegExp(`\\bd\\.kind\\s*=\\s*'${PINNED_KIND}'`));
    // Every quoted occurrence of a boundary-looking kind is the pinned one: a typo'd second
    // literal fails here even if the two statements above still match.
    const quoted = [...sql.matchAll(/'(snapshot_rebuild_[a-z_]*)'/g)].map((m) => m[1]);
    expect(quoted.length).toBeGreaterThanOrEqual(2);
    expect(new Set(quoted)).toEqual(new Set([PINNED_KIND]));
  });

  it("the SQL payload key equals the key the TS parser reads, and both equal the pinned key", () => {
    const sql = readSqlStatements();
    const ts = readFileSync(tsPath, "utf8");
    const sqlMatch = /jsonb_build_object\s*\(\s*'([^']*)'\s*,/.exec(sql);
    expect(sqlMatch, "no `jsonb_build_object('<key>', ...)` in the migration").not.toBeNull();
    expect(sqlMatch![1]).toBe(PINNED_KEY);

    const tsMatch = /\(payload as Record<string, unknown>\)\.([A-Za-z_]+)/.exec(ts);
    expect(tsMatch, "the TS parser no longer reads the payload key as `(payload as Record<string, unknown>).<key>`").not.toBeNull();
    expect(tsMatch![1]).toBe(PINNED_KEY);
    expect(tsMatch![1]).toBe(sqlMatch![1]);
  });
});
