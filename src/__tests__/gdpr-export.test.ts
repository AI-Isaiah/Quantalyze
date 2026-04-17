/**
 * GDPR export tests — Sprint 6 closeout Task 7.3.
 *
 * Two layers:
 *
 *   1. Pure unit tests against `collectUserExportBundle` with a mocked
 *      Supabase client. Asserts the function enumerates every table in
 *      the manifest and handles both direct + indirect shapes. These
 *      run in every CI pass.
 *   2. Live-DB integration test (skipped when SUPABASE_URL/service key
 *      are missing) that seeds a user with representative rows across
 *      the covered tables, invokes the real export route's assembler,
 *      and asserts each seeded table has rows in the bundle.
 *
 * The manifest itself is tested for shape invariants:
 *   - no duplicate table names
 *   - every `indirect` entry references a valid `parent_table`
 *   - the list is non-empty and alphabetical within groups (regression
 *     guard against accidental re-orderings).
 */

import { describe, it, expect, vi } from "vitest";

// gdpr-export.ts imports "server-only" which throws under vitest+jsdom.
// Matches the audit.test.ts and rbac-matrix.test.ts mock pattern.
vi.mock("server-only", () => ({}));

import {
  USER_EXPORT_TABLES,
  collectUserExportBundle,
  EXPORT_PER_TABLE_ROW_CAP,
  EXPORT_SIZE_CAP_BYTES,
  type UserExportTable,
} from "@/lib/gdpr-export";
import {
  HAS_LIVE_DB,
  createLiveAdminClient,
  createTestUser,
  cleanupLiveDbRow,
  advertiseLiveDbSkipReason,
} from "@/lib/test-helpers/live-db";

describe("USER_EXPORT_TABLES manifest invariants", () => {
  it("is non-empty and has >= 15 entries", () => {
    // Should cover the 14 migration-declared user-owned tables plus
    // several indirect (strategy-scoped, portfolio-scoped) entries.
    expect(USER_EXPORT_TABLES.length).toBeGreaterThanOrEqual(15);
  });

  it("has no duplicate table names", () => {
    const names = USER_EXPORT_TABLES.map((t) => t.table);
    const uniq = new Set(names);
    expect(uniq.size).toBe(names.length);
  });

  it("every 'indirect' entry references a valid parent_table that also appears in the manifest", () => {
    const directNames = new Set(
      USER_EXPORT_TABLES.filter((t) => t.kind === "direct").map(
        (t) => t.table,
      ),
    );
    for (const entry of USER_EXPORT_TABLES) {
      if (entry.kind === "indirect") {
        expect(directNames).toContain(entry.parent_table);
      }
    }
  });

  it("lists direct entries alphabetically (regression guard)", () => {
    const directs = USER_EXPORT_TABLES.filter((t) => t.kind === "direct").map(
      (t) => t.table,
    );
    const sorted = [...directs].sort();
    expect(directs).toEqual(sorted);
  });

  it("EXPORT_PER_TABLE_ROW_CAP and EXPORT_SIZE_CAP_BYTES are sane", () => {
    expect(EXPORT_PER_TABLE_ROW_CAP).toBeGreaterThanOrEqual(1000);
    expect(EXPORT_SIZE_CAP_BYTES).toBe(100 * 1024 * 1024);
  });
});

/**
 * Build a mock Supabase client that answers SELECTs with canned data
 * keyed by table name. Direct queries hit the table directly; indirect
 * queries first select parent ids and then fetch children.
 *
 * The direct-fetch and parent-id-probe both land on the same
 * `from(parent_table).select().eq()` shape, so we differentiate by the
 * projection passed to `.select(arg)`:
 *   - `.select("id")` → parent-id probe (returns {id} rows)
 *   - `.select("*")`  → direct fetch (returns full rows)
 *
 * Each call records the table name so assertions can check the client
 * was driven through every expected table.
 */
function makeMockClient(
  rowsByTable: Record<string, unknown[]>,
) {
  const visited: string[] = [];
  return {
    visited,
    from: (table: string) => {
      visited.push(table);
      return {
        select: (projection: string) => ({
          eq: () => ({
            limit: async () => {
              // Parent-id probe (indirect path's first hop): projection
              // is "id". Return the id field of each seeded row.
              if (projection === "id") {
                const rows = (rowsByTable[table] ?? []) as Array<{
                  id?: string;
                }>;
                return {
                  data: rows
                    .filter((r) => typeof r.id === "string")
                    .map((r) => ({ id: r.id })),
                  error: null,
                };
              }
              // Direct fetch: full rows.
              return { data: rowsByTable[table] ?? [], error: null };
            },
          }),
          in: () => ({
            limit: async () => ({
              data: rowsByTable[table] ?? [],
              error: null,
            }),
          }),
        }),
      };
    },
  };
}

describe("collectUserExportBundle — mocked client", () => {
  it("visits every table in the manifest, wiring direct and indirect paths correctly", async () => {
    const rowsByTable: Record<string, unknown[]> = {
      profiles: [{ id: "u1", display_name: "Alice" }],
      api_keys: [{ id: "k1", user_id: "u1" }],
      strategies: [{ id: "s1", user_id: "u1" }, { id: "s2", user_id: "u1" }],
      trades: [{ id: "t1", strategy_id: "s1" }],
      portfolios: [{ id: "p1", user_id: "u1" }],
      portfolio_strategies: [{ portfolio_id: "p1", strategy_id: "s1" }],
    };
    const mock = makeMockClient(rowsByTable);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "u1");

    // Every manifest table should appear in the bundle.
    const bundleTables = bundle.tables.map((t) => t.table);
    for (const spec of USER_EXPORT_TABLES) {
      expect(bundleTables).toContain(spec.table);
    }

    // Schema shape
    expect(bundle.schema_version).toBe(1);
    expect(bundle.user_id).toBe("u1");
    expect(bundle.truncated_at_size_cap).toBe(false);
    expect(typeof bundle.generated_at).toBe("string");

    // Direct tables with seeded rows should round-trip
    const apiKeysRow = bundle.tables.find((t) => t.table === "api_keys");
    expect(apiKeysRow?.rows.length).toBe(1);
    expect(apiKeysRow?.row_count).toBe(1);

    const strategiesRow = bundle.tables.find((t) => t.table === "strategies");
    expect(strategiesRow?.rows.length).toBe(2);

    // Indirect: trades should be fetched via strategies parent
    const tradesRow = bundle.tables.find((t) => t.table === "trades");
    expect(tradesRow?.rows.length).toBe(1);
  });

  it("enforces EXPORT_SIZE_CAP_BYTES and sets truncated_at_size_cap", async () => {
    // Craft a single table's payload that bloats past the cap.
    const bigRows = Array.from({ length: 10 }, (_, i) => ({
      id: `row${i}`,
      blob: "x".repeat(15 * 1024 * 1024), // 15MB each → 150MB total
    }));
    const rowsByTable: Record<string, unknown[]> = {
      // Put the bloat under the FIRST manifest table (alphabetically
      // that's allocator_preferences).
      allocator_preferences: bigRows,
    };
    const mock = makeMockClient(rowsByTable);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "u1");
    expect(bundle.truncated_at_size_cap).toBe(true);
    // Total serialized UTF-8 byte size should remain under the cap.
    // We assert against TextEncoder byteLength (not JSON.stringify(...).length)
    // so the test matches the cap enforcement in collectUserExportBundle,
    // which uses TextEncoder to handle non-ASCII content correctly.
    const serializedBytes = new TextEncoder().encode(JSON.stringify(bundle))
      .byteLength;
    expect(serializedBytes).toBeLessThanOrEqual(
      EXPORT_SIZE_CAP_BYTES + 1_000_000, // small grace for the envelope
    );
  });

  it("returns zero rows for a user with no data (happy empty path)", async () => {
    const mock = makeMockClient({});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "empty-user");
    expect(bundle.total_row_count).toBe(0);
    expect(bundle.truncated_at_size_cap).toBe(false);
    // Every manifest table is present with row_count=0
    for (const spec of USER_EXPORT_TABLES) {
      const entry = bundle.tables.find((t) => t.table === spec.table);
      expect(entry).toBeDefined();
      expect(entry!.row_count).toBe(0);
    }
  });
});

describe("USER_EXPORT_TABLES — shape type check (compile-time regression)", () => {
  it("accepts DirectUserTable and IndirectUserTable shapes", () => {
    const direct: UserExportTable = {
      kind: "direct",
      table: "test",
      user_column: "user_id",
    };
    const indirect: UserExportTable = {
      kind: "indirect",
      table: "child",
      via_column: "parent_id",
      parent_table: "parent",
      parent_user_column: "user_id",
    };
    expect(direct.kind).toBe("direct");
    expect(indirect.kind).toBe("indirect");
  });
});

describe("GDPR export — live DB integration", () => {
  it.skipIf(!HAS_LIVE_DB)(
    "seeded user has rows in profiles, api_keys, portfolios after export",
    async () => {
      const admin = createLiveAdminClient();
      const ts = Date.now();
      const cleanup: {
        userIds: string[];
        apiKeyIds: string[];
        strategyIds: string[];
      } = { userIds: [], apiKeyIds: [], strategyIds: [] };

      try {
        const userId = await createTestUser(
          admin,
          `gdpr-export-${ts}@test.sec`,
        );
        cleanup.userIds.push(userId);

        // Seed representative rows across a handful of tables
        const { data: keyRow, error: keyErr } = await admin
          .from("api_keys")
          .insert({
            user_id: userId,
            exchange: "binance",
            label: "export-test-key",
            api_key_encrypted: "ct",
            dek_encrypted: "dct",
          })
          .select("id")
          .single();
        if (keyErr) throw new Error(`api_keys seed: ${keyErr.message}`);
        cleanup.apiKeyIds.push(keyRow.id);

        const { error: pErr } = await admin
          .from("portfolios")
          .insert({ user_id: userId, name: "Export test portfolio" });
        if (pErr) throw new Error(`portfolios seed: ${pErr.message}`);

        // Call the assembler directly (not through the HTTP route,
        // which would hit storage + rate-limiter).
        const bundle = await collectUserExportBundle(
          admin as unknown as Parameters<typeof collectUserExportBundle>[0],
          userId,
        );

        const profileRow = bundle.tables.find((t) => t.table === "profiles");
        expect(profileRow?.row_count).toBeGreaterThanOrEqual(1);

        const keyTableRow = bundle.tables.find((t) => t.table === "api_keys");
        expect(keyTableRow?.row_count).toBe(1);

        const portfoliosTableRow = bundle.tables.find(
          (t) => t.table === "portfolios",
        );
        expect(portfoliosTableRow?.row_count).toBeGreaterThanOrEqual(1);

        // Truncation flag should be FALSE for a minimal seed
        expect(bundle.truncated_at_size_cap).toBe(false);
      } finally {
        await cleanupLiveDbRow(admin, cleanup);
      }
    },
    60_000,
  );

  it("advertises skip reason when live DB is unavailable", () => {
    advertiseLiveDbSkipReason("gdpr-export");
    expect(true).toBe(true);
  });
});
