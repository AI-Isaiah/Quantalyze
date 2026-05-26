/**
 * GDPR export — schema-validation regression test (NEW-C16-01).
 *
 * The CRITICAL bug NEW-C16-01: `getOrderColumn` returned `"id"` for
 * every non-audit manifest spec, but FOUR manifest tables
 * (`user_app_roles`, `user_favorites`, `allocator_preferences`,
 * `portfolio_strategies`) have composite / natural PKs and NO `id`
 * column. The resulting `.order("id")` raised Postgres 42703
 * (`column "id" does not exist`), which `fetchRowsForSpec` surfaced as
 * a `fetch_error` -> `partial: true` -> the route returned HTTP 500
 * (`export_partial`) for EVERY user on EVERY call. The Art. 15/20
 * export endpoint was non-functional in production.
 *
 * Why a schema test (not a mock): the existing unit suite mocks
 * `.order()` as a no-op, so the broken `"id"` ordering shipped green —
 * a pure mock CANNOT reproduce the runtime 42703. CI also skips the
 * live-DB integration path. This test closes that gap structurally: it
 * parses the generated `src/lib/database.types.ts` (the single source
 * of truth for the live schema) and asserts that, for EVERY manifest
 * spec, the column the SELECT actually orders by EXISTS on the table
 * the SELECT actually hits. A future regeneration that drops a column,
 * or a manifest edit that adds an id-less table without an
 * `ORDER_COLUMN_OVERRIDES` entry, fails here before it can 500 prod.
 *
 * It also pins the WHY of each override column (the audit's
 * recommended mapping) so a "cleanup" that reverts to `"id"`
 * regresses loudly.
 */

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// gdpr-export.ts imports "server-only" which throws under vitest+jsdom.
vi.mock("server-only", () => ({}));

import {
  USER_EXPORT_TABLES,
  getOrderColumn,
  ORDER_COLUMN_OVERRIDES,
  type UserExportTable,
} from "@/lib/gdpr-export";

const TYPES_FILE = join(process.cwd(), "src", "lib", "database.types.ts");

/**
 * Parse `database.types.ts` and return a map of public-table name to
 * the set of column names declared in its `Row: { ... }` block.
 *
 * The generated file is machine-emitted with a stable shape:
 *
 *   <tablename>: {
 *     Row: {
 *       col_a: string
 *       col_b: number | null
 *       ...
 *     }
 *     Insert: { ... }
 *
 * We capture each table's Row block (from `Row: {` to the first line
 * that closes it at the same indentation) and pull the `col:` keys.
 */
function parseRowColumns(src: string): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  // Match a table entry's Row block. `[\s\S]*?` is lazy so it stops at
  // the FIRST `}` that terminates the Row object (the line before
  // `Insert:`/`Relationships:`). Table names are emitted at a fixed
  // indentation as `      <name>: {`.
  const tableRe =
    /^ {6}([a-z0-9_]+): \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}/gm;
  const colRe = /^ {10}([a-z0-9_]+):/gm;
  for (const tableMatch of src.matchAll(tableRe)) {
    const table = tableMatch[1];
    const body = tableMatch[2];
    const cols = new Set<string>();
    // Each column line: `          <col>: <type>`. Keys are bare
    // identifiers; the generated file never quotes them.
    for (const colMatch of body.matchAll(colRe)) {
      cols.add(colMatch[1]);
    }
    out.set(table, cols);
  }
  return out;
}

/**
 * The table a spec's primary SELECT actually orders by:
 *   - direct    -> spec.table
 *   - projected -> spec.source_table (the SELECT hits the source)
 *   - indirect  -> spec.table (the CHILD select; the parent probe uses
 *                  parent_id_column independently)
 */
function orderedTableForSpec(spec: UserExportTable): string {
  if (spec.kind === "projected") return spec.source_table;
  return spec.table;
}

describe("gdpr-export schema validation — NEW-C16-01 order columns exist", () => {
  const src = readFileSync(TYPES_FILE, "utf8");
  const rowColumns = parseRowColumns(src);

  it("parser found the expected anchor tables", () => {
    // Guard against a silent parser regression (e.g. the generated
    // file's indentation changes) that would make every assertion
    // below vacuously pass.
    expect(rowColumns.size).toBeGreaterThan(20);
    // A table WITH id and one WITHOUT id, to prove both shapes parse.
    expect(rowColumns.get("strategies")?.has("id")).toBe(true);
    expect(rowColumns.get("user_app_roles")?.has("id")).toBe(false);
  });

  it("every manifest spec orders by a column that EXISTS on the table it SELECTs (no 42703)", () => {
    for (const spec of USER_EXPORT_TABLES) {
      const orderCol = getOrderColumn(spec);
      const table = orderedTableForSpec(spec);
      const cols = rowColumns.get(table);
      expect(
        cols,
        `manifest table "${table}" (spec.kind=${spec.kind}) not found in database.types.ts`,
      ).toBeDefined();
      expect(
        cols!.has(orderCol),
        `getOrderColumn ordered ${table} by "${orderCol}" but that column does not exist on ${table} — a .order("${orderCol}") raises Postgres 42703 and 500s the export (NEW-C16-01)`,
      ).toBe(true);
    }
  });

  it("the four id-less tables resolve to their documented NOT-NULL override column, never id", () => {
    // Pins the WHY: each override is the recommended ordering key from
    // the audit. A revert to "id" (the original bug) fails here.
    const expected: Record<string, string> = {
      user_app_roles: "granted_at",
      user_favorites: "created_at",
      allocator_preferences: "updated_at",
      portfolio_strategies: "added_at",
      allocator_equity_snapshots: "asof",
      investor_attestations: "attested_at",
      organization_members: "joined_at",
    };
    expect(ORDER_COLUMN_OVERRIDES).toEqual(expected);

    for (const [table, col] of Object.entries(expected)) {
      const spec = USER_EXPORT_TABLES.find(
        (s) => (s.kind === "projected" ? s.source_table : s.table) === table,
      );
      expect(spec, `manifest is missing an entry for ${table}`).toBeDefined();
      expect(getOrderColumn(spec!)).toBe(col);
      // The id-less tables must NOT have an id column (else the override
      // would be unnecessary) and MUST have the override column.
      expect(rowColumns.get(table)?.has("id")).toBe(false);
      expect(rowColumns.get(table)?.has(col)).toBe(true);
    }
  });

  it("every ORDER_COLUMN_OVERRIDES key is a real id-less manifest table (no stale overrides)", () => {
    const orderedTables = new Set(USER_EXPORT_TABLES.map(orderedTableForSpec));
    for (const table of Object.keys(ORDER_COLUMN_OVERRIDES)) {
      expect(
        orderedTables.has(table),
        `ORDER_COLUMN_OVERRIDES has stale key "${table}" — no manifest spec orders by it`,
      ).toBe(true);
      expect(
        rowColumns.get(table)?.has("id"),
        `${table} HAS an "id" column — the override is unnecessary and masks intent`,
      ).toBe(false);
    }
  });
});
