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
  // H-0456 fix: every select chain now goes through `.order(col,
  // {ascending}).limit(n)`. The mock mirrors that chain so production
  // code paths exercise correctly. `.order()` returns the same shape
  // as the previous direct-`.limit()` step so the existing terminal
  // resolver continues to work.
  const directResolver = (table: string) => async () => ({
    data: rowsByTable[table] ?? [],
    error: null,
  });
  const parentIdResolver = (table: string) => async () => {
    const rows = (rowsByTable[table] ?? []) as Array<{ id?: string }>;
    return {
      data: rows
        .filter((r) => typeof r.id === "string")
        .map((r) => ({ id: r.id })),
      error: null,
    };
  };
  return {
    visited,
    from: (table: string) => {
      visited.push(table);
      return {
        select: (projection: string) => {
          // Parent-id probe (indirect path's first hop): projection
          // is "id". Return the id field of each seeded row.
          // Direct fetch: full rows.
          const limitFn =
            projection === "id" ? parentIdResolver(table) : directResolver(table);
          return {
            eq: () => ({
              order: () => ({ limit: limitFn }),
              limit: limitFn,
            }),
            in: () => ({
              order: () => ({ limit: directResolver(table) }),
              limit: directResolver(table),
            }),
          };
        },
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
    // H-0456 fix: chain `.order(...)` between `.eq()` and `.limit()`.
    const delayedLimit = async () => {
      await new Promise((r) => setTimeout(r, FETCH_LATENCY_MS));
      return { data: [], error: null };
    };
    const mock = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({ limit: delayedLimit }),
            limit: delayedLimit,
          }),
          in: () => ({
            order: () => ({ limit: delayedLimit }),
            limit: delayedLimit,
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
      from: (table: string) => {
        const limit = async () => {
          if (table === "api_keys") {
            throw new Error("simulated network failure for api_keys");
          }
          return { data: [], error: null };
        };
        const indirectLimit = async () => ({ data: [], error: null });
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit }),
              limit,
            }),
            in: () => ({
              order: () => ({ limit: indirectLimit }),
              limit: indirectLimit,
            }),
          }),
        };
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "u-resilient");

    // Issue 5 (audit-2026-05-07 follow-up): the bundle survives, but the
    // failed table is now MARKED with a fetch_error string and the
    // bundle's `partial` flag is set — so the route can refuse to mint
    // a signed URL instead of silently substituting `[]`.
    const apiKeysEntry = bundle.tables.find((t) => t.table === "api_keys");
    expect(apiKeysEntry).toBeDefined();
    expect(apiKeysEntry!.row_count).toBe(0);
    expect(apiKeysEntry!.fetch_error).toBeTruthy();
    expect(apiKeysEntry!.fetch_error).toMatch(/api_keys/);
    expect(bundle.partial).toBe(true);
    expect(bundle.failed_tables).toContain("api_keys");
    // Other tables should still be present in the bundle.
    expect(bundle.tables.length).toBeGreaterThan(10);
  });

  it("Issue 5: a PG error (not a rejection) also sets fetch_error + partial", async () => {
    // Simulate a per-table .from().select().eq().limit() returning an
    // error: { code, message } instead of throwing. This is the path
    // that pre-fix silently substituted [] inside fetchRowsForSpec.
    const mock = {
      from: (table: string) => {
        const limit = async () => {
          if (table === "profiles") {
            return {
              data: null,
              error: { code: "57014", message: "statement timeout" },
            };
          }
          return { data: [], error: null };
        };
        const indirectLimit = async () => ({ data: [], error: null });
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit }),
              limit,
            }),
            in: () => ({
              order: () => ({ limit: indirectLimit }),
              limit: indirectLimit,
            }),
          }),
        };
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "u-pg-err");

    const profilesEntry = bundle.tables.find((t) => t.table === "profiles");
    expect(profilesEntry).toBeDefined();
    expect(profilesEntry!.fetch_error).toBeTruthy();
    expect(profilesEntry!.fetch_error).toMatch(/statement timeout/);
    expect(bundle.partial).toBe(true);
    expect(bundle.failed_tables).toContain("profiles");
  });

  it("Issue 5: a fully successful bundle has partial=false and failed_tables=[]", async () => {
    const emptyLimit = async () => ({ data: [], error: null });
    const mock = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({ limit: emptyLimit }),
            limit: emptyLimit,
          }),
          in: () => ({
            order: () => ({ limit: emptyLimit }),
            limit: emptyLimit,
          }),
        }),
      }),
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "u-clean");

    expect(bundle.partial).toBe(false);
    expect(bundle.failed_tables).toEqual([]);
    for (const t of bundle.tables) {
      expect(t.fetch_error).toBeNull();
    }
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
    // bundle WITH DATA" (i.e. having a NON-EMPTY `tables` array). The
    // legacy code's binary-search re-serialized objects of this shape
    // multiple times; the new code only stringifies leaf rows.
    //
    // H-0454 fix (envelope reservation): the cumulative-size budget
    // stringifies an EMPTY bundle skeleton (`tables: []`) ONCE to
    // seed `bytesUsed`. That's an O(1) call, not a re-serialization
    // — the count below excludes empty-tables shapes specifically so
    // the envelope reservation does not trip the legacy-regression
    // guard.
    const originalStringify = JSON.stringify;
    let bundleShapeWithDataStringifyCalls = 0;
    const spied = (value: unknown, ...rest: Parameters<typeof JSON.stringify>) => {
      if (
        value !== null &&
        typeof value === "object" &&
        "tables" in (value as Record<string, unknown>) &&
        Array.isArray((value as { tables: unknown[] }).tables) &&
        (value as { tables: unknown[] }).tables.length > 0
      ) {
        bundleShapeWithDataStringifyCalls += 1;
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

    // The new path never stringifies a populated bundle shape during
    // collection. The legacy binary-search loop did this multiple
    // times. Strict zero is the contract.
    expect(bundleShapeWithDataStringifyCalls).toBe(0);
  });
});

describe("collectUserExportBundle — M-0520 indirect parent error fails loud (not silent [])", () => {
  it("an indirect parent select error sets fetch_error + bundle.partial=true (not silent [])", async () => {
    // Strategies parent select returns an error. The indirect children
    // (trades, strategy_analytics, funding_fees, reconciliation_reports)
    // MUST all report fetch_error+partial — pre-M-0520, they silently
    // reported row_count=0, truncated_at_cap=false (= GDPR compliance
    // claim "complete export" while the data was actually missing).
    const mock = {
      from: (table: string) => {
        const limit = async () => {
          if (table === "strategies") {
            return {
              data: null,
              error: { code: "57014", message: "parent timeout" },
            };
          }
          return { data: [], error: null };
        };
        const indirectLimit = async () => ({ data: [], error: null });
        return {
          select: () => ({
            eq: () => ({
              order: () => ({ limit }),
              limit,
            }),
            in: () => ({
              order: () => ({ limit: indirectLimit }),
              limit: indirectLimit,
            }),
          }),
        };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "u-parent-err");
    expect(bundle.partial).toBe(true);

    // Every indirect child of strategies should carry a fetch_error.
    const strategyChildren = [
      "trades",
      "strategy_analytics",
      "funding_fees",
      "reconciliation_reports",
    ];
    for (const childName of strategyChildren) {
      const entry = bundle.tables.find((t) => t.table === childName);
      expect(entry).toBeDefined();
      expect(entry!.fetch_error).toBeTruthy();
      expect(entry!.fetch_error).toMatch(/parent select failed for strategies/);
    }
    // The error tables should all appear in failed_tables.
    for (const childName of strategyChildren) {
      expect(bundle.failed_tables).toContain(childName);
    }
  });
});

describe("collectUserExportBundle — H-0453 parent_id_truncated regression", () => {
  it("sets parent_id_truncated when the parent-id probe hits EXPORT_PARENT_ID_CAP", async () => {
    // Build a mock that returns exactly EXPORT_PARENT_ID_CAP parent rows
    // when queried by `.select("id")`. The function should set the flag
    // on every child table that uses that parent.
    //
    // Indirect manifest entries (strategies parents: strategy_analytics,
    // trades, funding_fees, reconciliation_reports; portfolios parents:
    // portfolio_strategies, portfolio_analytics, portfolio_alerts,
    // allocation_events, weight_snapshots) — each child should reflect
    // the truncation flag for its parent.
    const parentRows = Array.from({ length: 2000 }, (_, i) => ({
      id: `parent-${i}`,
    }));
    const mock = {
      from: (table: string) => {
        const probeLimit = async () => ({ data: parentRows, error: null });
        const childLimit = async () => ({
          data: [{ id: `${table}-row-1` }],
          error: null,
        });
        const directLimit = async () => ({ data: [], error: null });
        return {
          select: (projection: string) => {
            // Parent-id probe returns the saturated 2000 rows.
            const limit =
              projection === "id" ? probeLimit : directLimit;
            return {
              eq: () => ({
                order: () => ({ limit }),
                limit,
              }),
              in: () => ({
                order: () => ({ limit: childLimit }),
                limit: childLimit,
              }),
            };
          },
        };
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "u-cap");

    // The indirect children (trades, portfolio_strategies, etc.) should
    // all have parent_id_truncated=true.
    const indirectChildren = bundle.tables.filter((t) =>
      [
        "strategy_analytics",
        "trades",
        "funding_fees",
        "reconciliation_reports",
        "portfolio_strategies",
        "portfolio_analytics",
        "portfolio_alerts",
        "allocation_events",
        "weight_snapshots",
      ].includes(t.table),
    );
    expect(indirectChildren.length).toBeGreaterThan(0);
    for (const entry of indirectChildren) {
      expect(entry.parent_id_truncated).toBe(true);
    }
    // Direct entries should never carry the flag.
    const directEntries = bundle.tables.filter(
      (t) => !indirectChildren.find((c) => c.table === t.table),
    );
    for (const entry of directEntries) {
      expect(entry.parent_id_truncated).toBe(false);
    }
    // Bundle-level summary lists each truncated child.
    expect(bundle.parent_id_truncated_tables.length).toBe(
      indirectChildren.length,
    );
  });

  it("leaves parent_id_truncated=false when parent probe returns < cap", async () => {
    const mock = makeMockClient({
      strategies: [{ id: "s1" }, { id: "s2" }],
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "u-undercap");
    for (const t of bundle.tables) {
      expect(t.parent_id_truncated).toBe(false);
    }
    expect(bundle.parent_id_truncated_tables).toEqual([]);
  });
});

describe("collectUserExportBundle — H-0454 envelope reservation regression", () => {
  it("final upload byte length stays at or below EXPORT_SIZE_CAP_BYTES (envelope-aware)", async () => {
    // A truncating mix: many tables of medium-size payloads. The legacy
    // budget only counted per-row bytes — adding envelope + per-table
    // wrappers + commas pushed actual stringified bytes ~0.5–2MB over
    // the cap. The fixed budget seeds with the envelope, so total
    // serialized bytes are STRICTLY ≤ EXPORT_SIZE_CAP_BYTES.
    const ROW_SIZE = 10 * 1024 * 1024; // 10MB rows
    const rows = Array.from({ length: 12 }, (_, i) => ({
      id: `row-${i}`,
      blob: "x".repeat(ROW_SIZE),
    }));
    const mock = makeMockClient({
      allocator_preferences: rows,
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bundle = await collectUserExportBundle(mock as any, "u-envelope");
    expect(bundle.truncated_at_size_cap).toBe(true);
    const actualBytes = new TextEncoder().encode(JSON.stringify(bundle))
      .byteLength;
    // Strict: the upload size MUST NOT exceed the cap. H-0454 fix.
    expect(actualBytes).toBeLessThanOrEqual(EXPORT_SIZE_CAP_BYTES);
  });
});

describe("collectUserExportBundle — H-0456 ORDER BY determinism regression", () => {
  it("every select chain runs through `.order(col)` so row order is deterministic", async () => {
    // Spy on `.order(...)` invocations across all `from(...).select(...).eq(...)`
    // chains. Every direct, projected, and indirect (parent + child) hop
    // MUST include an explicit ORDER BY — without it Postgres row order
    // is implementation-defined and the size-cap truncation tail is
    // non-deterministic between requests for the same user.
    const orderCalls: Array<{ table: string; col: string }> = [];
    const mock = {
      from: (table: string) => {
        const limit = async () => ({ data: [], error: null });
        return {
          select: () => ({
            eq: () => ({
              order: (col: string) => {
                orderCalls.push({ table, col });
                return { limit };
              },
              // Bare `.limit()` without order is the legacy path; the
              // test mock still exposes it but production code MUST
              // route through `.order(...).limit(...)`. A regression
              // that drops the order step will leave `orderCalls`
              // empty for that table.
              limit,
            }),
            in: () => ({
              order: (col: string) => {
                orderCalls.push({ table, col });
                return { limit };
              },
              limit,
            }),
          }),
        };
      },
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await collectUserExportBundle(mock as any, "u-order");

    // Every direct and projected entry should appear at least once.
    // Indirect entries appear TWICE (parent probe + child select),
    // but a single appearance is sufficient to verify ORDER BY is in
    // the chain.
    const tablesOrdered = new Set(orderCalls.map((c) => c.table));
    const directTables = USER_EXPORT_TABLES.filter(
      (t) => t.kind === "direct",
    ).map((t) => t.table);
    for (const t of directTables) {
      expect(tablesOrdered.has(t)).toBe(true);
    }
    // Indirect children: their `.in().order()` is exercised on the
    // child SELECT.
    const indirectChildren = USER_EXPORT_TABLES.filter(
      (t) => t.kind === "indirect",
    );
    // The empty-parent short-circuit means child selects may not
    // fire when parent returns []. Verify the parents themselves did
    // get an ORDER BY hop.
    const parents = new Set(
      indirectChildren.map((t) => (t.kind === "indirect" ? t.parent_table : "")),
    );
    for (const p of parents) {
      expect(tablesOrdered.has(p)).toBe(true);
    }
  });
});

describe("collectUserExportBundle — H-0456 getOrderColumn per-table column (specialist apply, pr-test HIGH conf-9)", () => {
  it("audit_log projection sorts by created_at; every other table by id", async () => {
    // Spy on `.order(col, ...)` invocations and capture the column
    // passed for each table. The audit_log projected source MUST sort
    // by `created_at` (so size-cap truncation is chronological);
    // every other table MUST sort by `id` (UUID PK).
    const orderCalls: Array<{ table: string; col: string }> = [];
    const mock = {
      from: (table: string) => {
        const limit = async () => ({ data: [], error: null });
        return {
          select: () => ({
            eq: () => ({
              order: (col: string) => {
                orderCalls.push({ table, col });
                return { limit };
              },
              limit,
            }),
            in: () => ({
              order: (col: string) => {
                orderCalls.push({ table, col });
                return { limit };
              },
              limit,
            }),
          }),
        };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await collectUserExportBundle(mock as any, "u-h0456");

    // audit_log (the projected source for audit_log_for_user) sorts
    // by created_at — chronological packing of the size-cap tail.
    const auditCalls = orderCalls.filter((c) => c.table === "audit_log");
    expect(auditCalls.length).toBeGreaterThanOrEqual(1);
    for (const c of auditCalls) expect(c.col).toBe("created_at");

    // Every non-audit_log .order() call uses 'id'.
    const nonAudit = orderCalls.filter((c) => c.table !== "audit_log");
    expect(nonAudit.length).toBeGreaterThan(0);
    for (const c of nonAudit) expect(c.col).toBe("id");
  });
});

describe("USER_EXPORT_TABLES — shape type check (compile-time regression)", () => {
  it("accepts DirectUserTable and IndirectUserTable shapes (M-0522: table names are typed)", () => {
    // M-0522: `table` is narrowed to `keyof Database['public']['Tables']`.
    // Real table names (strategies, trades) compile. A typo like
    // "stratgies" would now fail at tsc time. Use real names so the
    // unit test stays green and serves as compile-time documentation.
    const direct: UserExportTable = {
      kind: "direct",
      table: "user_notes",
      user_column: "user_id",
    };
    const indirect: UserExportTable = {
      kind: "indirect",
      table: "trades",
      via_column: "strategy_id",
      parent_table: "strategies",
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
