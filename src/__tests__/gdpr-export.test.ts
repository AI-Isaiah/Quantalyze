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

  it("binary-search trimmer packs optimally — fills the cap without under-packing (I3)", async () => {
    // Regression guard for I3: the prior halving loop stopped at the
    // first pivot that fit, potentially leaving 30-50% of the cap
    // unused. With proper binary search, the fitting row_count should
    // pack the cap tightly.
    //
    // Construct ~10 rows each sized so that 6 rows fit under the cap
    // but 7 don't. A halving-only loop would find `pivot=5` (half of
    // 10) on first try, which fits → it stops, leaving row 6 on the
    // floor. Binary search finds 6. We verify the row_count reflects
    // the tight pack.
    const rowBytes = Math.floor((EXPORT_SIZE_CAP_BYTES / 6) * 0.95);
    const tightlyPackableRows = Array.from({ length: 10 }, (_, i) => ({
      id: `row${i}`,
      blob: "x".repeat(rowBytes),
    }));
    const mock = makeMockClient({
      allocator_preferences: tightlyPackableRows,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "u1");
    expect(bundle.truncated_at_size_cap).toBe(true);

    const trimmedTable = bundle.tables.find(
      (t) => t.table === "allocator_preferences",
    );
    expect(trimmedTable).toBeDefined();
    // With halving-only logic, row_count would have been 5 (or fewer).
    // Binary search should yield 6 — the exact tight-pack target.
    expect(trimmedTable!.row_count).toBeGreaterThanOrEqual(6);
    expect(trimmedTable!.truncated_at_cap).toBe(true);

    const serializedBytes = new TextEncoder().encode(JSON.stringify(bundle))
      .byteLength;
    expect(serializedBytes).toBeLessThanOrEqual(
      EXPORT_SIZE_CAP_BYTES + 1_000_000,
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

describe("collectUserExportBundle — parallel fetch (P449 regression)", () => {
  /**
   * Pin the bounded-concurrency model. The legacy implementation
   * iterated USER_EXPORT_TABLES with a sequential `await`, so 31
   * fetches at ~100ms each cost ~3.1s of wall time. The new path
   * runs them in batches of EXPORT_FETCH_CONCURRENCY=10 — so total
   * wall time should be ~3 batches × per-batch latency ~= 300ms.
   *
   * Strategy: inject a 50ms artificial delay into every fetch. If
   * the implementation is sequential, 28+ fetches × 50ms > 1400ms.
   * If parallel (cap 10), 3 batches × 50ms ~= 150ms (allow generous
   * scheduler slop; assert < 800ms).
   */
  it("collapses sequential fetches into bounded-concurrency batches", async () => {
    const FETCH_LATENCY_MS = 50;
    const mock = {
      from: () => ({
        select: (projection: string) => ({
          eq: () => ({
            limit: async () => {
              await new Promise((r) => setTimeout(r, FETCH_LATENCY_MS));
              if (projection === "id") return { data: [], error: null };
              return { data: [], error: null };
            },
          }),
          in: () => ({
            limit: async () => {
              await new Promise((r) => setTimeout(r, FETCH_LATENCY_MS));
              return { data: [], error: null };
            },
          }),
        }),
      }),
    };

    const t0 = Date.now();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await collectUserExportBundle(mock as any, "u-parallel");
    const elapsedMs = Date.now() - t0;

    // Sequential floor: 28+ tables * 50ms = 1400+ ms.
    // Parallel ceiling (concurrency=10, manifest ~28 entries):
    //   ceil(28/10)=3 batches * 50ms = 150ms + JS overhead.
    // Assert well under the sequential floor.
    expect(elapsedMs).toBeLessThan(800);
  });

  it("uses Promise.allSettled — one rejected fetch does not abort the bundle", async () => {
    // Make one specific table reject; everything else succeeds.
    const mock = {
      from: (table: string) => ({
        select: (projection: string) => ({
          eq: () => ({
            limit: async () => {
              if (table === "api_keys") {
                throw new Error("simulated network failure for api_keys");
              }
              if (projection === "id") return { data: [], error: null };
              return { data: [], error: null };
            },
          }),
          in: () => ({
            limit: async () => ({ data: [], error: null }),
          }),
        }),
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "u-resilient");

    // The failed table appears with rows=[] (best-effort), bundle survives.
    const apiKeysEntry = bundle.tables.find((t) => t.table === "api_keys");
    expect(apiKeysEntry).toBeDefined();
    expect(apiKeysEntry!.row_count).toBe(0);
    // Other tables should still be present in the bundle.
    expect(bundle.tables.length).toBeGreaterThan(10);
  });
});

describe("collectUserExportBundle — cumulative-size budget (P450 regression)", () => {
  /**
   * Pin the O(n) cumulative-byte-budget behavior. The legacy
   * implementation re-serialized the full bundle inside a binary
   * search at every truncation step — O(log n) full stringifications.
   * The new path stringifies each row at most once.
   *
   * Strategy: instrument JSON.stringify. With ~10 large rows that
   * trigger truncation, the legacy binary search re-serialized the
   * whole bundle ~log2(10) ~= 4 times (each time over a 100MB
   * payload). The new code calls JSON.stringify ONCE per row (10
   * times) plus a small constant. Assert the call count stays under
   * a tight ceiling.
   */
  it("does not re-serialize the full bundle on truncation (O(n) not O(log n))", async () => {
    const ROW_SIZE = 12 * 1024 * 1024; // 12MB per row, 10 rows = 120MB > cap
    const rows = Array.from({ length: 10 }, (_, i) => ({
      id: `r${i}`,
      blob: "x".repeat(ROW_SIZE),
    }));
    const mock = makeMockClient({ allocator_preferences: rows });

    // Count JSON.stringify calls on objects "shaped like a full
    // bundle" (i.e. having a `tables` array). The legacy code's
    // binary-search re-serialized objects of this shape multiple
    // times; the new code only stringifies leaf rows.
    const originalStringify = JSON.stringify;
    let bundleShapeStringifyCalls = 0;
    const spied = (value: unknown, ...rest: Parameters<typeof JSON.stringify>) => {
      if (
        value !== null &&
        typeof value === "object" &&
        "tables" in (value as Record<string, unknown>) &&
        Array.isArray((value as { tables: unknown }).tables)
      ) {
        bundleShapeStringifyCalls += 1;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return originalStringify(value as any, ...(rest as any));
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (JSON as any).stringify = spied;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bundle = await collectUserExportBundle(mock as any, "u-budget");
      expect(bundle.truncated_at_size_cap).toBe(true);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (JSON as any).stringify = originalStringify;
    }

    // The new path never stringifies a "bundle-shaped" object during
    // collection. The legacy binary-search loop did this multiple
    // times. Strict zero is acceptable; any drift to >0 indicates a
    // regression into full-bundle re-serialization.
    expect(bundleShapeStringifyCalls).toBe(0);
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

  it.skipIf(HAS_LIVE_DB)(
    "advertises skip reason when live DB is unavailable",
    () => {
      advertiseLiveDbSkipReason("gdpr-export");
      expect(true).toBe(true);
    },
  );
});
